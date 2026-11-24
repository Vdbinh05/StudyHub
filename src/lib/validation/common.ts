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
]);
export const examQuestionTypeSchema = z.enum([
  "single_choice",
  "multiple_choice",
  "true_false",
  "short_answer",
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
