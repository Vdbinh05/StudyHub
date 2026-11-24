import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type {
  QuestionAcceptedAnswer,
  QuestionOption,
  Tag,
} from "@/types/domain";

/**
 * Safe chunk size for PostgREST `.in(...)` queries:
 * - <= 100 UUIDs keeps GET URLs safely under ~4 KB (zero HTTP 414 URI Too Long).
 * - <= 100 questions x up to 10 options stays safely under PostgREST `max_rows = 1000`
 *   (fixes SH-005 / DB-P0-2 silent option truncation!).
 */
export const SAFE_IN_CHUNK_SIZE = 100;
export const SAFE_PAGE_SIZE = 1000;

export function chunkArray<T>(
  items: readonly T[],
  chunkSize: number = SAFE_IN_CHUNK_SIZE,
): T[][] {
  if (items.length === 0) return [];
  const size = Math.max(1, chunkSize);
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export const DEFAULT_CHUNK_CONCURRENCY = 4;

/**
 * Runs a query across chunked ID slices with bounded parallelism (default concurrency = 4)
 * and merges all returned rows in deterministic chunk order.
 */
export async function fetchInChunks<TId, TRow>(
  ids: readonly TId[],
  fetcher: (chunk: TId[]) => Promise<{ data: TRow[] | null; error: unknown }>,
  chunkSize: number = SAFE_IN_CHUNK_SIZE,
  concurrency: number = DEFAULT_CHUNK_CONCURRENCY,
): Promise<TRow[]> {
  const uniqueIds = Array.from(new Set(ids));
  if (uniqueIds.length === 0) return [];

  const chunks = chunkArray(uniqueIds, chunkSize);
  const safeConcurrency = Math.max(1, Math.min(8, Math.floor(concurrency)));
  const results: TRow[] = [];

  for (let i = 0; i < chunks.length; i += safeConcurrency) {
    const windowChunks = chunks.slice(i, i + safeConcurrency);
    const settled = await Promise.all(
      windowChunks.map(async (chunk) => {
        const { data, error } = await fetcher(chunk);
        if (error) throw error;
        return data ?? [];
      }),
    );
    for (const rows of settled) {
      if (rows.length > 0) {
        results.push(...rows);
      }
    }
  }

  return results;
}

/**
 * Fetches all rows from a PostgREST query using `.range(from, to)` pagination
 * so results are NEVER silently truncated at PostgREST's 1,000-row cap.
 */
export async function fetchAllPages<TRow>(
  fetchPage: (
    from: number,
    to: number,
  ) => Promise<{ data: TRow[] | null; error: unknown }>,
  pageSize: number = SAFE_PAGE_SIZE,
  maxRows: number = 50_000,
): Promise<TRow[]> {
  const all: TRow[] = [];
  let offset = 0;

  while (offset < maxRows) {
    const to = Math.min(offset + pageSize - 1, maxRows - 1);
    const { data, error } = await fetchPage(offset, to);
    if (error) throw error;
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < pageSize) {
      break;
    }
    offset += pageSize;
  }

  return all;
}

/**
 * Loads options, accepted answers, and tags for an arbitrary number of question IDs
 * in PostgREST-safe chunks (<= 100 IDs per batch) with zero truncation or HTTP 414.
 */
export async function fetchQuestionRelationsChunked(
  supabase: SupabaseClient<Database>,
  questionIds: readonly string[],
  studySetIdFilter?: string,
): Promise<{
  optionsByQ: Map<string, QuestionOption[]>;
  answersByQ: Map<string, QuestionAcceptedAnswer[]>;
  tagsByQ: Map<string, Tag[]>;
}> {
  const optionsByQ = new Map<string, QuestionOption[]>();
  const answersByQ = new Map<string, QuestionAcceptedAnswer[]>();
  const tagsByQ = new Map<string, Tag[]>();

  if (questionIds.length === 0) {
    return { optionsByQ, answersByQ, tagsByQ };
  }

  const [options, accepted, qTags] = await Promise.all([
    fetchInChunks(
      questionIds,
      async (chunk) => {
        let q = supabase
          .from("question_options")
          .select("*")
          .in("question_id", chunk)
          .order("position", { ascending: true });
        if (studySetIdFilter) {
          q = q.eq("study_set_id", studySetIdFilter);
        }
        return q;
      },
      SAFE_IN_CHUNK_SIZE,
    ),
    fetchInChunks(
      questionIds,
      async (chunk) => {
        let q = supabase
          .from("question_accepted_answers")
          .select("*")
          .in("question_id", chunk)
          .order("created_at", { ascending: true });
        if (studySetIdFilter) {
          q = q.eq("study_set_id", studySetIdFilter);
        }
        return q;
      },
      SAFE_IN_CHUNK_SIZE,
    ),
    fetchInChunks(
      questionIds,
      async (chunk) => {
        let q = supabase
          .from("question_tags")
          .select("question_id, tag_id")
          .in("question_id", chunk);
        if (studySetIdFilter) {
          q = q.eq("study_set_id", studySetIdFilter);
        }
        return q;
      },
      SAFE_IN_CHUNK_SIZE,
    ),
  ]);

  for (const opt of options as QuestionOption[]) {
    const arr = optionsByQ.get(opt.question_id) ?? [];
    arr.push(opt);
    optionsByQ.set(opt.question_id, arr);
  }

  for (const acc of accepted as QuestionAcceptedAnswer[]) {
    const arr = answersByQ.get(acc.question_id) ?? [];
    arr.push(acc);
    answersByQ.set(acc.question_id, arr);
  }

  const tagIds = Array.from(new Set(qTags.map((qt) => qt.tag_id)));
  if (tagIds.length > 0) {
    const tagRows = await fetchInChunks(
      tagIds,
      async (chunk) => supabase.from("tags").select("*").in("id", chunk),
      SAFE_IN_CHUNK_SIZE,
    );
    const tagMap = new Map<string, Tag>(
      (tagRows as Tag[]).map((t) => [t.id, t]),
    );

    for (const qt of qTags) {
      const tag = tagMap.get(qt.tag_id);
      if (tag) {
        const arr = tagsByQ.get(qt.question_id) ?? [];
        arr.push(tag);
        tagsByQ.set(qt.question_id, arr);
      }
    }
  }

  return { optionsByQ, answersByQ, tagsByQ };
}
