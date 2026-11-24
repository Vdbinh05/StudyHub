import { z } from "zod";
import { isSafeHttpOrStorageUrl } from "@/lib/security/sanitize";

export const uuidSchema = z.string().uuid("Invalid UUID format.");

export const safeUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((val) => isSafeHttpOrStorageUrl(val), {
    message: "URL must be a safe HTTPS URL, relative path, or Storage path.",
  });

export const nullableSafeUrlSchema = z
  .union([safeUrlSchema, z.literal(""), z.null()])
  .transform((val) => (val === "" ? null : val))
  .optional();

export const localeSchema = z.enum(["vi", "en"]);
export const themeSchema = z.enum(["light", "dark", "system"]);
export const studySetTypeSchema = z.enum([
  "multiple_choice",
  "flashcards",
  "mixed",
]);
export const visibilitySchema = z.enum([
  "private",
  "unlisted",
  "public",
  "shared",
]);
export const memberRoleSchema = z.enum(["owner", "editor", "viewer"]);
export const sharePermissionSchema = z.enum(["editor", "viewer"]);
export const questionTypeSchema = z.enum([
  "single_choice",
  "multiple_choice",
  "true_false",
  "flashcard",
  "short_answer",
  "fill_in_blank",
  "numerical",
  "ordering",
  "matching",
  "image_choice",
  "image_hotspot",
  "listening",
  "reading_passage",
]);
export const examQuestionTypeSchema = z.enum([
  "single_choice",
  "multiple_choice",
  "true_false",
  "short_answer",
  "fill_in_blank",
  "numerical",
  "ordering",
  "matching",
  "image_choice",
  "image_hotspot",
  "listening",
  "reading_passage",
]);
export const answerMatchModeSchema = z.enum([
  "exact",
  "case_insensitive",
  "ignore_diacritics",
  "numeric",
]);
export const difficultySchema = z.enum(["easy", "medium", "hard"]);
export const masteryLevelSchema = z.enum([
  "new",
  "learning",
  "familiar",
  "mastered",
]);
export const selfRatingSchema = z.enum(["again", "hard", "good", "easy"]);
export const studyModeSchema = z.enum([
  "flashcards",
  "learn",
  "practice",
  "write",
  "match",
  "review",
  "spell",
  "diagram",
  "custom_practice",
]);
export const sessionStatusSchema = z.enum([
  "in_progress",
  "completed",
  "abandoned",
]);
export const examStatusSchema = z.enum([
  "in_progress",
  "submitted",
  "expired",
  "discarded",
]);
export const friendshipStatusSchema = z.enum([
  "pending",
  "accepted",
  "declined",
  "blocked",
]);

export const allocationStrategySchema = z.enum([
  "global_random",
  "equal",
  "proportional",
  "custom",
  "weighted",
]);

export const selectionPolicySchema = z.enum([
  "random",
  "unseen_first",
  "mistakes_first",
  "weak_topics_first",
  "due_for_review",
  "starred_only",
  "incorrect_only",
  "anti_repeat",
]);

export const examSourceTypeSchema = z.enum(["study_set", "folder"]);
export const coverageCycleStatusSchema = z.enum([
  "active",
  "completed",
  "archived",
]);

export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
});

// V3.0 shared enums
export const confidenceLevelSchema = z.enum(["certain", "unsure", "guessing"]);
export const mistakeStatusSchema = z.enum(["active", "improving", "resolved"]);
export const mediaKindSchema = z.enum(["image", "audio"]);
export const mediaEntityTypeSchema = z.enum([
  "question",
  "question_option",
  "diagram_set",
  "shared_passage",
  "exam_attempt_question",
  "profile",
]);
export const mediaRoleSchema = z.enum([
  "prompt",
  "back",
  "option",
  "explanation",
  "hint",
  "audio",
  "diagram_base",
  "passage",
]);
export const hotspotShapeSchema = z.enum(["point", "rect", "polygon"]);
export const questionReportCategorySchema = z.enum([
  "wrong_answer",
  "typo_formatting",
  "missing_media",
  "broken_audio",
  "ambiguous_wording",
  "duplicate_question",
  "wrong_chapter_tag",
  "diagram_hotspot_error",
  "other",
]);
export const questionReportStatusSchema = z.enum([
  "open",
  "reviewing",
  "resolved",
  "dismissed",
]);
export const progressResetScopeSchema = z.enum([
  "all",
  "study_set",
  "subject",
  "chapter",
  "question",
  "mode",
]);
export const syncEventTypeSchema = z.enum([
  "answer",
  "confidence",
  "star",
  "note_upsert",
  "checkpoint_upsert",
  "mistake_resolve",
]);
export const globalSearchEntityTypeSchema = z.enum([
  "folder",
  "study_set",
  "question",
  "option",
  "tag",
  "chapter",
  "note",
  "diagram",
]);
