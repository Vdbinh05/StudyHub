import { resolveSafeMediaUrl, type MediaDisplayItem } from "@/lib/media/urls";
import type {
  ContentMediaRelation,
  MediaAttachmentRole,
  QuestionMediaAttachment,
  QuestionTypePayload,
} from "@/types/v3";

export type { QuestionMediaAttachment } from "@/types/v3";

const SAFE_PROMPT_ROLES: ReadonlySet<MediaAttachmentRole> = new Set([
  "prompt",
  "diagram_base",
  "passage",
]);

export interface RawMediaAttachmentLike {
  id?: string | null;
  media_id?: string | null;
  url?: string | null;
  proxy_url?: string | null;
  storage_path?: string | null;
  role?: MediaAttachmentRole | string | null;
  sort_order?: number | null;
  alt_text?: string | null;
  caption?: string | null;
  mime_type?: string | null;
  width?: number | null;
  height?: number | null;
  entity_type?: QuestionMediaAttachment["entity_type"];
  entity_id?: string;
  created_at?: string;
  media?: ContentMediaRelation["media"] | null;
}

export interface OptionMediaLike {
  id?: string | null;
  image_url?: string | null;
  media_id?: string | null;
  image_alt?: string | null;
  media_attachments?: readonly RawMediaAttachmentLike[] | null;
  /** Exam snapshot option multi-image array (`options_snapshot[i].media`) */
  media?: readonly RawMediaAttachmentLike[] | null;
}

export interface QuestionMediaLike {
  id?: string | null;
  prompt_image_url?: string | null;
  prompt_image_url_snapshot?: string | null;
  back_image_url?: string | null;
  diagram_id?: string | null;
  diagram?: { base_image_url?: string | null } | null;
  diagram_snapshot?: { base_image_url?: string | null } | null;
  media_attachments?: readonly RawMediaAttachmentLike[] | null;
  media_snapshot?: readonly RawMediaAttachmentLike[] | null;
  review_media_snapshot?: readonly RawMediaAttachmentLike[] | null;
  /** Used strictly to guard legacy post-submit exam snapshot fallback */
  explanation_snapshot?: string | null;
  correct_option_ids?: readonly string[] | null;
  type_payload?: QuestionTypePayload | null;
  type_payload_snapshot?: QuestionTypePayload | null;
  options?: readonly OptionMediaLike[] | null;
  options_snapshot?: readonly OptionMediaLike[] | null;
}

const VALID_ROLES: ReadonlySet<string> = new Set<MediaAttachmentRole>([
  "prompt",
  "back",
  "option",
  "explanation",
  "hint",
  "audio",
  "diagram_base",
  "passage",
]);

function normalizeRole(
  raw: MediaAttachmentRole | string | null | undefined,
  fallback: MediaAttachmentRole = "prompt",
): MediaAttachmentRole {
  if (typeof raw === "string" && VALID_ROLES.has(raw)) {
    return raw as MediaAttachmentRole;
  }
  return fallback;
}

function isAudioAttachment(raw: {
  role?: MediaAttachmentRole | string | null;
  mime_type?: string | null;
  media?: { kind?: string; mime_type?: string | null } | null;
}): boolean {
  if (raw.role === "audio") return true;
  if (raw.media?.kind === "audio") return true;
  const mime = raw.mime_type ?? raw.media?.mime_type ?? "";
  return mime.toLowerCase().startsWith("audio/");
}

/**
 * Canonical dedupe key for a resolved media URL so legacy `prompt_image_url` /
 * `option.image_url` never duplicates an equivalent `content_media_relations` row
 * (even when query params like `_r=` or signed redirect flags differ).
 */
export function canonicalizeMediaUrlKey(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("blob:") || trimmed.startsWith("data:")) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed, "https://studyhub.local");
    if (parsed.pathname === "/api/uploads/signed-url") {
      const storagePath = parsed.searchParams.get("path")?.trim();
      if (storagePath) {
        return `storage:${storagePath}`;
      }
    }
    parsed.searchParams.delete("_r");
    if (trimmed.startsWith("/")) {
      return `${parsed.pathname}${parsed.search}`;
    }
    return parsed.toString();
  } catch {
    return trimmed;
  }
}

function toNormalizedAttachment(
  raw: RawMediaAttachmentLike,
  fallbackIndex: number,
  fallbackRole: MediaAttachmentRole = "prompt",
): QuestionMediaAttachment | null {
  const asset = raw.media ?? null;
  const storagePath = raw.storage_path ?? asset?.storage_path ?? null;
  const proxyUrl = raw.proxy_url ?? asset?.proxy_url ?? null;
  const safeUrl = resolveSafeMediaUrl({
    proxy_url: proxyUrl,
    url: raw.url ?? null,
    storage_path: storagePath,
  });
  if (!safeUrl) return null;

  const mediaId =
    (typeof raw.media_id === "string" && raw.media_id.trim()) ||
    (typeof asset?.id === "string" && asset.id.trim()) ||
    `legacy:${canonicalizeMediaUrlKey(safeUrl)}`;

  const sortOrder =
    typeof raw.sort_order === "number" && Number.isFinite(raw.sort_order)
      ? Math.max(0, Math.floor(raw.sort_order))
      : fallbackIndex;

  return {
    ...(raw.id ? { id: raw.id } : {}),
    media_id: mediaId,
    url: safeUrl,
    role: normalizeRole(raw.role, fallbackRole),
    sort_order: sortOrder,
    alt_text: raw.alt_text ?? asset?.alt_text ?? null,
    caption: raw.caption ?? asset?.caption ?? null,
    mime_type: raw.mime_type ?? asset?.mime_type ?? null,
    width: raw.width ?? asset?.width ?? null,
    height: raw.height ?? asset?.height ?? null,
    storage_path: storagePath,
    proxy_url: proxyUrl,
    ...(raw.entity_type ? { entity_type: raw.entity_type } : {}),
    ...(raw.entity_id ? { entity_id: raw.entity_id } : {}),
    ...(raw.created_at ? { created_at: raw.created_at } : {}),
    ...(asset ? { media: asset } : {}),
  };
}

/**
 * Normalizes, validates safe URLs, deterministically sorts by `sort_order`,
 * and deduplicates media attachments by `media_id` and canonical URL/storage path.
 */
export function normalizeMediaAttachmentList(
  list: readonly RawMediaAttachmentLike[] | null | undefined,
  defaultRole: MediaAttachmentRole = "prompt",
): QuestionMediaAttachment[] {
  if (!list || list.length === 0) return [];

  const indexed: Array<{ item: QuestionMediaAttachment; originalIdx: number }> = [];
  for (let i = 0; i < list.length; i += 1) {
    const raw = list[i];
    if (!raw) continue;
    const normalized = toNormalizedAttachment(raw, i, defaultRole);
    if (!normalized) continue;
    indexed.push({ item: normalized, originalIdx: i });
  }

  indexed.sort((a, b) => {
    if (a.item.sort_order !== b.item.sort_order) {
      return a.item.sort_order - b.item.sort_order;
    }
    return a.originalIdx - b.originalIdx;
  });

  const seenMediaIds = new Set<string>();
  const seenUrlKeys = new Set<string>();
  const result: QuestionMediaAttachment[] = [];

  for (const { item } of indexed) {
    const isSyntheticId = item.media_id.startsWith("legacy:");
    const urlKey = canonicalizeMediaUrlKey(item.url);

    if (!isSyntheticId && seenMediaIds.has(item.media_id)) {
      continue;
    }
    if (urlKey && seenUrlKeys.has(urlKey)) {
      continue;
    }

    if (!isSyntheticId) seenMediaIds.add(item.media_id);
    if (urlKey) seenUrlKeys.add(urlKey);

    result.push({
      ...item,
      sort_order: result.length,
    });
  }

  return result;
}

/**
 * Returns deduplicated visual prompt media attachments for a Question or ExamSnapshotQuestion.
 * Strictly filters to safe pre-submit roles (`prompt`, `diagram_base`, `passage`) and
 * never leaks `explanation`, `hint`, or `back` media into the prompt slot.
 */
export function getQuestionPromptMedia(
  q: QuestionMediaLike | null | undefined,
): QuestionMediaAttachment[] {
  if (!q) return [];

  const candidates: RawMediaAttachmentLike[] = [];

  if (Array.isArray(q.media_attachments)) {
    for (const rel of q.media_attachments) {
      if (!rel || isAudioAttachment(rel)) continue;
      const role = normalizeRole(rel.role, "prompt");
      if (SAFE_PROMPT_ROLES.has(role)) {
        candidates.push(rel);
      }
    }
  }

  if (Array.isArray(q.media_snapshot)) {
    for (const rel of q.media_snapshot) {
      if (!rel || isAudioAttachment(rel)) continue;
      const role = normalizeRole(rel.role, "prompt");
      if (SAFE_PROMPT_ROLES.has(role)) {
        candidates.push(rel);
      }
    }
  }

  const legacyUrl = q.prompt_image_url ?? q.prompt_image_url_snapshot ?? null;
  if (legacyUrl) {
    candidates.push({
      id: "legacy-prompt-image",
      media_id: `legacy:prompt:${canonicalizeMediaUrlKey(legacyUrl)}`,
      url: legacyUrl,
      role: "prompt",
      sort_order: candidates.length,
    });
  }

  return normalizeMediaAttachmentList(candidates, "prompt");
}

/**
 * Returns deduplicated visual back-side media attachments (e.g. Flashcards back image).
 */
export function getQuestionBackMedia(
  q: QuestionMediaLike | null | undefined,
): QuestionMediaAttachment[] {
  if (!q) return [];

  const candidates: RawMediaAttachmentLike[] = [];

  if (Array.isArray(q.media_attachments)) {
    for (const rel of q.media_attachments) {
      if (!rel || isAudioAttachment(rel)) continue;
      if (rel.role === "back") candidates.push(rel);
    }
  }

  if (Array.isArray(q.review_media_snapshot)) {
    for (const rel of q.review_media_snapshot) {
      if (!rel || isAudioAttachment(rel)) continue;
      if (rel.role === "back") candidates.push(rel);
    }
  }

  if (q.back_image_url) {
    candidates.push({
      id: "legacy-back-image",
      media_id: `legacy:back:${canonicalizeMediaUrlKey(q.back_image_url)}`,
      url: q.back_image_url,
      role: "back",
      sort_order: candidates.length,
    });
  }

  return normalizeMediaAttachmentList(candidates, "back");
}

/**
 * Returns deduplicated visual explanation media attachments.
 * On ExamSnapshotQuestion, reads from post-submit-only `review_media_snapshot`
 * (and only inspects legacy `media_snapshot` when answer review fields are already present).
 */
export function getQuestionExplanationMedia(
  q: QuestionMediaLike | null | undefined,
): QuestionMediaAttachment[] {
  if (!q) return [];

  const candidates: RawMediaAttachmentLike[] = [];

  if (Array.isArray(q.media_attachments)) {
    for (const rel of q.media_attachments) {
      if (!rel || isAudioAttachment(rel)) continue;
      if (rel.role === "explanation") {
        candidates.push(rel);
      }
    }
  }

  if (Array.isArray(q.review_media_snapshot)) {
    for (const rel of q.review_media_snapshot) {
      if (!rel || isAudioAttachment(rel)) continue;
      if (rel.role === "explanation") {
        candidates.push(rel);
      }
    }
  }

  // Backward compatibility for historical pre-0020 submitted snapshots only
  const isRevealedExamSnapshot =
    q.explanation_snapshot !== undefined || Array.isArray(q.correct_option_ids);
  if (isRevealedExamSnapshot && Array.isArray(q.media_snapshot)) {
    for (const rel of q.media_snapshot) {
      if (!rel || isAudioAttachment(rel)) continue;
      if (rel.role === "explanation") {
        candidates.push(rel);
      }
    }
  }

  return normalizeMediaAttachmentList(candidates, "explanation");
}

/**
 * Returns deduplicated visual media attachments for a QuestionOption or ExamSnapshotOption.
 */
export function getOptionMedia(
  opt: OptionMediaLike | null | undefined,
): QuestionMediaAttachment[] {
  if (!opt) return [];

  const candidates: RawMediaAttachmentLike[] = [];

  if (Array.isArray(opt.media_attachments)) {
    for (const rel of opt.media_attachments) {
      if (!rel || isAudioAttachment(rel)) continue;
      candidates.push({ ...rel, role: "option" });
    }
  }

  if (Array.isArray(opt.media)) {
    for (const rel of opt.media) {
      if (!rel || isAudioAttachment(rel)) continue;
      candidates.push({ ...rel, role: "option" });
    }
  }

  if (opt.image_url) {
    candidates.push({
      id: opt.id ? `legacy-option-${opt.id}` : "legacy-option-image",
      media_id: opt.media_id || `legacy:option:${canonicalizeMediaUrlKey(opt.image_url)}`,
      url: opt.image_url,
      role: "option",
      sort_order: candidates.length,
      alt_text: opt.image_alt ?? null,
    });
  }

  return normalizeMediaAttachmentList(candidates, "option");
}

/**
 * Returns true if the question has ANY attached visual image across prompt, back,
 * explanation, options, diagram, or structured type payload (hotspot/ordering/matching).
 */
export function hasAnyQuestionImages(
  q: QuestionMediaLike | null | undefined,
): boolean {
  if (!q) return false;
  if (getQuestionPromptMedia(q).length > 0) return true;
  if (getQuestionBackMedia(q).length > 0) return true;
  if (getQuestionExplanationMedia(q).length > 0) return true;

  const opts = q.options ?? q.options_snapshot ?? [];
  for (const opt of opts) {
    if (getOptionMedia(opt).length > 0) return true;
  }

  if (q.diagram_id || q.diagram?.base_image_url || q.diagram_snapshot?.base_image_url) {
    return true;
  }

  const payload = q.type_payload ?? q.type_payload_snapshot ?? null;
  if (payload) {
    if (payload.type === "image_hotspot" && Boolean(payload.image_url || payload.image_media_id)) {
      return true;
    }
    if (
      payload.type === "ordering" &&
      Array.isArray(payload.items) &&
      payload.items.some((item) => Boolean(item.image_url || item.media_id))
    ) {
      return true;
    }
    if (
      payload.type === "matching" &&
      Array.isArray(payload.pairs) &&
      payload.pairs.some((pair) => Boolean(pair.left_image_url || pair.right_image_url))
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Converts a `QuestionMediaAttachment` into a `MediaDisplayItem` for `MediaGallery`.
 */
export function questionMediaToDisplayItem(
  att: QuestionMediaAttachment,
  index = 0,
): MediaDisplayItem | null {
  const safeUrl = resolveSafeMediaUrl({
    proxy_url: att.proxy_url ?? att.media?.proxy_url ?? null,
    url: att.url,
    storage_path: att.storage_path ?? att.media?.storage_path ?? null,
  });
  if (!safeUrl) return null;

  return {
    id: att.id || `${att.role}-${att.media_id}-${index}`,
    media_id: att.media_id,
    kind: isAudioAttachment(att) ? "audio" : "image",
    url: safeUrl,
    storage_path: att.storage_path ?? att.media?.storage_path ?? null,
    mime_type: att.mime_type ?? att.media?.mime_type ?? null,
    file_name: att.media?.file_name ?? null,
    alt_text: att.alt_text ?? att.media?.alt_text ?? "",
    caption: att.caption ?? att.media?.caption ?? null,
    width: att.width ?? att.media?.width ?? null,
    height: att.height ?? att.media?.height ?? null,
    duration_ms: att.media?.duration_ms ?? null,
    sort_order: att.sort_order,
  };
}
