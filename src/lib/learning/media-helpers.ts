import {
  canonicalizeMediaUrlKey,
  getOptionMedia,
  getQuestionBackMedia,
  getQuestionExplanationMedia,
  getQuestionPromptMedia,
  questionMediaToDisplayItem,
} from "@/lib/media/question-media";
import type { MediaDisplayItem } from "@/lib/media/urls";
import type {
  ExamSnapshotOption,
  ExamSnapshotQuestion,
  MediaAttachmentRole,
  Question,
  QuestionMediaAttachment,
  QuestionOption,
  RichTextDoc,
} from "@/types/domain";

export const PROMPT_MEDIA_ROLES: ReadonlySet<MediaAttachmentRole> = new Set([
  "prompt",
  "passage",
  "diagram_base",
]);

export const EXPLANATION_MEDIA_ROLES: ReadonlySet<MediaAttachmentRole> = new Set([
  "explanation",
]);

export const BACK_MEDIA_ROLES: ReadonlySet<MediaAttachmentRole> = new Set([
  "back",
]);

/**
 * Normalize a media URL or storage path into a deduplication key so the same
 * private `study-media` asset is never displayed twice side-by-side (RU-08, V32-053).
 */
export function buildMediaDedupKey(input: {
  media_id?: string | null;
  storage_path?: string | null;
  url?: string | null;
  proxy_url?: string | null;
}): string | null {
  if (input.storage_path && input.storage_path.trim()) {
    return `storage:${input.storage_path.trim()}`;
  }
  const candidate = input.proxy_url ?? input.url ?? "";
  if (candidate.trim()) {
    const key = canonicalizeMediaUrlKey(candidate);
    if (key) return key;
  }
  if (input.media_id && input.media_id.trim()) {
    return `id:${input.media_id.trim()}`;
  }
  return null;
}

/**
 * Convert a hydrated `QuestionMediaAttachment` into a safe `MediaDisplayItem` for `MediaGallery`.
 */
export function attachmentToDisplayItem(
  att: QuestionMediaAttachment,
  fallbackAlt = "",
  fallbackIndex = 0,
): MediaDisplayItem | null {
  const item = questionMediaToDisplayItem(att, fallbackIndex);
  if (!item || item.kind !== "image") return null;
  return {
    ...item,
    alt_text: item.alt_text || fallbackAlt,
  };
}

function attachmentsToDisplayItems(
  attachments: readonly QuestionMediaAttachment[],
  fallbackAlt = "",
): MediaDisplayItem[] {
  const result: MediaDisplayItem[] = [];
  for (let i = 0; i < attachments.length; i += 1) {
    const item = attachmentToDisplayItem(attachments[i], fallbackAlt, i);
    if (item) result.push(item);
  }
  return result;
}

/**
 * Prompt-side images for any `Question` (roles: `prompt`, `passage`, `diagram_base`)
 * deduplicated cleanly against legacy `question.prompt_image_url`.
 * Delegates to canonical `@/lib/media/question-media#getQuestionPromptMedia`.
 */
export function getQuestionPromptAttachments(
  question: Pick<Question, "prompt_image_url" | "media_attachments" | "prompt">,
): QuestionMediaAttachment[] {
  return getQuestionPromptMedia(question);
}

export function getQuestionPromptDisplayItems(
  question: Pick<Question, "prompt_image_url" | "media_attachments" | "prompt">,
  fallbackAlt = "",
): MediaDisplayItem[] {
  return attachmentsToDisplayItems(
    getQuestionPromptMedia(question),
    fallbackAlt || question.prompt.slice(0, 120),
  );
}

/**
 * Explanation-only images for any `Question` (role: `explanation`).
 * MUST ONLY be rendered post-answer / post-flip / post-submit!
 */
export function getQuestionExplanationAttachments(
  question: Pick<Question, "media_attachments">,
): QuestionMediaAttachment[] {
  return getQuestionExplanationMedia(question);
}

export function getQuestionExplanationDisplayItems(
  question: Pick<Question, "media_attachments">,
  fallbackAlt = "",
): MediaDisplayItem[] {
  return attachmentsToDisplayItems(
    getQuestionExplanationMedia(question),
    fallbackAlt,
  );
}

/**
 * Back-face images for a flashcard `Question` (role: `back` + legacy `back_image_url` deduped).
 */
export function getQuestionBackAttachments(
  question: Pick<Question, "back_image_url" | "media_attachments" | "back_text">,
): QuestionMediaAttachment[] {
  return getQuestionBackMedia(question);
}

/**
 * All images attached to a `QuestionOption` or `ExamSnapshotOption`
 * (`media_attachments` / `media` + legacy `image_url`, sorted and deduplicated).
 */
export function getOptionAttachments(
  option:
    | Pick<QuestionOption, "id" | "label" | "image_url" | "image_alt" | "media_attachments">
    | Pick<ExamSnapshotOption, "id" | "label" | "image_url" | "image_alt" | "media">,
): QuestionMediaAttachment[] {
  return getOptionMedia(option);
}

export function getOptionDisplayItems(
  option:
    | Pick<QuestionOption, "id" | "label" | "image_url" | "image_alt" | "media_attachments">
    | Pick<ExamSnapshotOption, "id" | "label" | "image_url" | "image_alt" | "media">,
): MediaDisplayItem[] {
  return attachmentsToDisplayItems(
    getOptionMedia(option),
    option.image_alt ?? option.label,
  );
}

/**
 * Prompt-side images for an `ExamSnapshotQuestion` (SAFE for both live exams and results).
 * Strictly filters `media_snapshot` to `prompt | passage | diagram_base` ONLY —
 * NEVER includes `explanation`, `hint`, `back`, or `option` images!
 */
export function getExamSnapshotPromptDisplayItems(
  question: Pick<
    ExamSnapshotQuestion,
    "prompt_image_url_snapshot" | "media_snapshot" | "prompt_snapshot"
  >,
  fallbackAlt = "",
): MediaDisplayItem[] {
  return attachmentsToDisplayItems(
    getQuestionPromptMedia(question),
    fallbackAlt || question.prompt_snapshot.slice(0, 120),
  );
}

/**
 * Post-submit ONLY explanation images for an `ExamSnapshotQuestion`.
 * Reads `review_media_snapshot` (V32-053) plus legacy pre-0020 `explanation` entries
 * when answer review fields are already revealed. NEVER call during an in-progress exam!
 */
export function getExamSnapshotExplanationDisplayItems(
  question: Pick<
    ExamSnapshotQuestion,
    "review_media_snapshot" | "media_snapshot" | "explanation_snapshot" | "correct_option_ids"
  >,
  fallbackAlt = "",
): MediaDisplayItem[] {
  return attachmentsToDisplayItems(
    getQuestionExplanationMedia(question),
    fallbackAlt,
  );
}

/**
 * Check whether text or TipTap rich AST contains renderable textual content.
 */
export function hasRenderableText(
  plainText: string | null | undefined,
  rich?: RichTextDoc | null,
): boolean {
  if (plainText && plainText.trim().length > 0) return true;
  if (
    rich &&
    typeof rich === "object" &&
    Array.isArray(rich.content) &&
    rich.content.length > 0
  ) {
    return rich.content.some((node) => {
      if (node.text && node.text.trim().length > 0) return true;
      if (
        node.type === "inlineMath" ||
        node.type === "blockMath" ||
        node.type === "image"
      ) {
        return true;
      }
      return Array.isArray(node.content) && node.content.length > 0;
    });
  }
  return false;
}
