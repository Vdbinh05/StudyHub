import type { SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "@/lib/security/errors";
import type { Database } from "@/types/database";
import type {
  MediaAttachmentRole,
  QuestionAcceptedAnswer,
  QuestionMediaAttachment,
  QuestionOption,
  Tag,
} from "@/types/domain";

export function buildStudyMediaProxyUrl(storagePath: string): string {
  return `/api/uploads/signed-url?path=${encodeURIComponent(storagePath)}&redirect=1`;
}

export interface VerifiedMediaAssetSummary {
  id: string;
  owner_id: string | null;
  study_set_id: string | null;
  storage_path: string;
  proxy_url: string;
  mime_type: string;
  width: number | null;
  height: number | null;
  alt_text: string | null;
  caption: string | null;
}

/**
 * Verifies every supplied `media_id` exists and is editable by the caller for `studySetId`
 * (either belongs to the target editable study set OR is owned directly by the caller).
 * Rejects attaching another user's private media asset with HTTP 403 FORBIDDEN (V32-053).
 */
export async function verifyEditableMediaOwnership(
  supabase: SupabaseClient<Database>,
  userId: string,
  studySetId: string,
  mediaIds: readonly string[],
): Promise<Map<string, VerifiedMediaAssetSummary>> {
  const uniqueIds = Array.from(new Set(mediaIds.filter(Boolean)));
  const verified = new Map<string, VerifiedMediaAssetSummary>();
  if (uniqueIds.length === 0) {
    return verified;
  }

  const rows = await fetchInChunks(
    uniqueIds,
    async (chunk) =>
      supabase
        .from("media_assets")
        .select(
          "id, owner_id, study_set_id, storage_path, mime_type, width, height, alt_text, caption",
        )
        .in("id", chunk),
    SAFE_IN_CHUNK_SIZE,
  );

  for (const row of rows) {
    const allowed =
      row.study_set_id === studySetId ||
      (row.owner_id !== null && row.owner_id === userId);
    if (!allowed) {
      throw new AppError(
        "FORBIDDEN",
        "You do not have permission to attach one or more referenced media assets.",
        403,
      );
    }
    verified.set(row.id, {
      id: row.id,
      owner_id: row.owner_id,
      study_set_id: row.study_set_id,
      storage_path: row.storage_path,
      proxy_url: buildStudyMediaProxyUrl(row.storage_path),
      mime_type: row.mime_type,
      width: row.width,
      height: row.height,
      alt_text: row.alt_text,
      caption: row.caption,
    });
  }

  if (verified.size !== uniqueIds.length) {
    throw new AppError(
      "FORBIDDEN",
      "One or more referenced media assets were not found or are not accessible.",
      403,
    );
  }

  return verified;
}

/**
 * Hydrates `content_media_relations` joined with `media_assets` for any batch of
 * question IDs (`entity_type = 'question'`) and option IDs (`entity_type = 'question_option'`).
 */
export async function hydrateQuestionAndOptionMedia(
  supabase: SupabaseClient<Database>,
  questionIds: readonly string[],
  optionIds: readonly string[],
): Promise<{
  questionMediaByQ: Map<string, QuestionMediaAttachment[]>;
  optionMediaByOpt: Map<string, QuestionMediaAttachment[]>;
}> {
  const questionMediaByQ = new Map<string, QuestionMediaAttachment[]>();
  const optionMediaByOpt = new Map<string, QuestionMediaAttachment[]>();

  if (questionIds.length === 0 && optionIds.length === 0) {
    return { questionMediaByQ, optionMediaByOpt };
  }

  const [qRelations, optRelations] = await Promise.all([
    questionIds.length > 0
      ? fetchInChunks(
          questionIds,
          async (chunk) =>
            supabase
              .from("content_media_relations")
              .select(
                "id, media_id, entity_type, entity_id, role, sort_order, alt_text, caption, created_at",
              )
              .eq("entity_type", "question")
              .in("entity_id", chunk)
              .order("sort_order", { ascending: true })
              .order("created_at", { ascending: true }),
          SAFE_IN_CHUNK_SIZE,
        )
      : Promise.resolve([]),
    optionIds.length > 0
      ? fetchInChunks(
          optionIds,
          async (chunk) =>
            supabase
              .from("content_media_relations")
              .select(
                "id, media_id, entity_type, entity_id, role, sort_order, alt_text, caption, created_at",
              )
              .eq("entity_type", "question_option")
              .in("entity_id", chunk)
              .order("sort_order", { ascending: true })
              .order("created_at", { ascending: true }),
          SAFE_IN_CHUNK_SIZE,
        )
      : Promise.resolve([]),
  ]);

  const allMediaIds = Array.from(
    new Set([
      ...qRelations.map((r) => r.media_id),
      ...optRelations.map((r) => r.media_id),
    ]),
  );

  if (allMediaIds.length === 0) {
    return { questionMediaByQ, optionMediaByOpt };
  }

  const assetRows = await fetchInChunks(
    allMediaIds,
    async (chunk) =>
      supabase
        .from("media_assets")
        .select("id, storage_path, mime_type, width, height, alt_text, caption")
        .in("id", chunk),
    SAFE_IN_CHUNK_SIZE,
  );
  const assetMap = new Map(assetRows.map((a) => [a.id, a]));

  const toAttachment = (
    rel: (typeof qRelations)[number],
  ): QuestionMediaAttachment | null => {
    const asset = assetMap.get(rel.media_id);
    if (!asset) return null;
    const proxyUrl = buildStudyMediaProxyUrl(asset.storage_path);
    return {
      id: rel.id,
      media_id: rel.media_id,
      url: proxyUrl,
      proxy_url: proxyUrl,
      storage_path: asset.storage_path,
      role: rel.role as MediaAttachmentRole,
      sort_order: rel.sort_order,
      alt_text: rel.alt_text ?? asset.alt_text ?? null,
      caption: rel.caption ?? asset.caption ?? null,
      mime_type: asset.mime_type,
      width: asset.width,
      height: asset.height,
      entity_type: rel.entity_type as QuestionMediaAttachment["entity_type"],
      entity_id: rel.entity_id,
      created_at: rel.created_at,
    };
  };

  for (const rel of qRelations) {
    const att = toAttachment(rel);
    if (!att) continue;
    const arr = questionMediaByQ.get(rel.entity_id) ?? [];
    arr.push(att);
    questionMediaByQ.set(rel.entity_id, arr);
  }

  for (const rel of optRelations) {
    const att = toAttachment(rel);
    if (!att) continue;
    const arr = optionMediaByOpt.get(rel.entity_id) ?? [];
    arr.push(att);
    optionMediaByOpt.set(rel.entity_id, arr);
  }

  return { questionMediaByQ, optionMediaByOpt };
}

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
  questionMediaByQ: Map<string, QuestionMediaAttachment[]>;
}> {
  const optionsByQ = new Map<string, QuestionOption[]>();
  const answersByQ = new Map<string, QuestionAcceptedAnswer[]>();
  const tagsByQ = new Map<string, Tag[]>();
  const questionMediaByQ = new Map<string, QuestionMediaAttachment[]>();

  if (questionIds.length === 0) {
    return { optionsByQ, answersByQ, tagsByQ, questionMediaByQ };
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

  const optionIds = (options as QuestionOption[]).map((o) => o.id);
  const tagIds = Array.from(new Set(qTags.map((qt) => qt.tag_id)));

  const [mediaHydrated, tagRows] = await Promise.all([
    hydrateQuestionAndOptionMedia(supabase, questionIds, optionIds),
    tagIds.length > 0
      ? fetchInChunks(
          tagIds,
          async (chunk) => supabase.from("tags").select("*").in("id", chunk),
          SAFE_IN_CHUNK_SIZE,
        )
      : Promise.resolve([]),
  ]);

  for (const [qId, list] of mediaHydrated.questionMediaByQ.entries()) {
    questionMediaByQ.set(qId, list);
  }

  for (const opt of options as QuestionOption[]) {
    const optMedia = mediaHydrated.optionMediaByOpt.get(opt.id) ?? [];
    const hydratedOpt: QuestionOption = {
      ...opt,
      media_attachments: optMedia,
    };
    const arr = optionsByQ.get(opt.question_id) ?? [];
    arr.push(hydratedOpt);
    optionsByQ.set(opt.question_id, arr);
  }

  for (const acc of accepted as QuestionAcceptedAnswer[]) {
    const arr = answersByQ.get(acc.question_id) ?? [];
    arr.push(acc);
    answersByQ.set(acc.question_id, arr);
  }

  if (tagRows.length > 0) {
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

  return { optionsByQ, answersByQ, tagsByQ, questionMediaByQ };
}
