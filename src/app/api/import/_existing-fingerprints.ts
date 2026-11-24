import type { SupabaseClient } from "@supabase/supabase-js";
import {
  chunkArray,
  computeQuestionDuplicateFingerprint,
  normalizeForComparison,
} from "@/lib/import";
import type { Database } from "@/types/database";

const QUESTION_PAGE_SIZE = 1000;
const IN_QUERY_CHUNK_SIZE = 120;
const MAX_EXISTING_SCAN = 50_000;

export interface ExistingFingerprintsResult {
  fingerprints: string[];
  fingerprintToIds: Map<string, string[]>;
}

/**
 * Paginated, chunked reader that fetches existing question duplicate fingerprints
 * without ever hitting PostgREST's 1,000-row silent truncation cap or HTTP 414 URI limits (SH-005 / SH-017).
 *
 * When `candidateNormalizedPrompts` is provided, only existing questions whose normalized
 * prompt appears in the candidate set trigger `question_options` / `question_accepted_answers`
 * fetches — producing 100% identical fingerprints while cutting O(N²) option/answer queries
 * down to ~0 on distinct 10,000-question chunked imports.
 */
export async function fetchExistingQuestionFingerprints(
  supabase: SupabaseClient<Database>,
  studySetId: string,
  candidateNormalizedPrompts?: ReadonlySet<string>,
): Promise<ExistingFingerprintsResult> {
  const fingerprintToIds = new Map<string, string[]>();

  if (candidateNormalizedPrompts && candidateNormalizedPrompts.size === 0) {
    return { fingerprints: [], fingerprintToIds };
  }

  let offset = 0;

  while (offset < MAX_EXISTING_SCAN) {
    const { data: qRows, error: qErr } = await supabase
      .from("questions")
      .select("id, prompt, back_text")
      .eq("study_set_id", studySetId)
      .order("id", { ascending: true })
      .range(offset, offset + QUESTION_PAGE_SIZE - 1);

    if (qErr) throw qErr;
    if (!qRows || qRows.length === 0) break;

    const matchingRows = candidateNormalizedPrompts
      ? qRows.filter((row) =>
          candidateNormalizedPrompts.has(normalizeForComparison(row.prompt)),
        )
      : qRows;

    if (matchingRows.length > 0) {
      const qIds = matchingRows.map((row) => row.id);
      const optionsByQ = new Map<
        string,
        Array<{ content: string; isCorrect: boolean }>
      >();
      const acceptedByQ = new Map<string, Array<{ answerText: string }>>();

      // Chunk .in() queries to <= 120 UUIDs (~4.4 KB URL, <= 960 options < 1,000 PostgREST cap)
      for (const idChunk of chunkArray(qIds, IN_QUERY_CHUNK_SIZE)) {
        const [optRes, accRes] = await Promise.all([
          supabase
            .from("question_options")
            .select("question_id, content, is_correct")
            .eq("study_set_id", studySetId)
            .in("question_id", idChunk),
          supabase
            .from("question_accepted_answers")
            .select("question_id, answer_text")
            .eq("study_set_id", studySetId)
            .in("question_id", idChunk),
        ]);

        if (optRes.error) throw optRes.error;
        if (accRes.error) throw accRes.error;

        for (const opt of optRes.data ?? []) {
          const list = optionsByQ.get(opt.question_id);
          const item = { content: opt.content, isCorrect: opt.is_correct };
          if (list) list.push(item);
          else optionsByQ.set(opt.question_id, [item]);
        }

        for (const acc of accRes.data ?? []) {
          const list = acceptedByQ.get(acc.question_id);
          const item = { answerText: acc.answer_text };
          if (list) list.push(item);
          else acceptedByQ.set(acc.question_id, [item]);
        }
      }

      for (const row of matchingRows) {
        const fp = computeQuestionDuplicateFingerprint({
          prompt: row.prompt,
          backText: row.back_text,
          options: optionsByQ.get(row.id) ?? [],
          acceptedAnswers: acceptedByQ.get(row.id) ?? [],
        });
        if (!fp) continue;
        const list = fingerprintToIds.get(fp);
        if (list) list.push(row.id);
        else fingerprintToIds.set(fp, [row.id]);
      }
    }

    if (qRows.length < QUESTION_PAGE_SIZE) break;
    offset += QUESTION_PAGE_SIZE;
  }

  return {
    fingerprints: Array.from(fingerprintToIds.keys()),
    fingerprintToIds,
  };
}
