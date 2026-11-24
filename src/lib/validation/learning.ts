import { z } from "zod";
import {
  confidenceLevelSchema,
  masteryLevelSchema,
  mistakeStatusSchema,
  questionTypeSchema,
  selfRatingSchema,
  sessionStatusSchema,
  studyModeSchema,
  uuidSchema,
} from "./common";
import { structuredAnswerResponseSchema } from "./v3";

const boolQuerySchema = z
  .union([z.literal("true"), z.literal("false")])
  .transform((v) => v === "true");

export const createSessionSchema = z
  .object({
    study_set_id: uuidSchema.nullable().optional(),
    source_study_set_ids: z.array(uuidSchema).max(50).optional(),
    mode: studyModeSchema,
    config: z.record(z.string(), z.unknown()).default({}),
    total_items: z.number().int().min(0).max(50_000).default(0),
  })
  .refine(
    (v) =>
      Boolean(v.study_set_id) ||
      Boolean(v.source_study_set_ids && v.source_study_set_ids.length > 0),
    {
      message: "Provide study_set_id or at least one source_study_set_id.",
    },
  );

export const updateSessionSchema = z.object({
  status: sessionStatusSchema.optional(),
  total_items: z.number().int().min(0).max(50_000).optional(),
  completed_items: z.number().int().min(0).max(50_000).optional(),
  correct_items: z.number().int().min(0).max(50_000).optional(),
  duration_seconds: z.number().int().min(0).max(86_400 * 7).optional(),
});

export const recordSessionAnswerSchema = z.object({
  question_id: uuidSchema,
  selected_option_ids: z.array(uuidSchema).max(20).default([]),
  typed_answer: z.string().max(5000).nullable().optional(),
  structured_response: structuredAnswerResponseSchema.nullable().optional(),
  is_correct: z.boolean().optional(),
  self_rating: selfRatingSchema.nullable().optional(),
  confidence: confidenceLevelSchema.nullable().optional(),
  hint_used: z.boolean().optional(),
  response_time_ms: z.number().int().min(0).max(3_600_000).nullable().optional(),
  update_progress: z.boolean().default(true),
});

export const upsertProgressSchema = z.object({
  study_set_id: uuidSchema.optional(),
  question_id: uuidSchema,
  is_correct: z.boolean(),
  self_rating: selfRatingSchema.nullable().optional(),
  confidence: confidenceLevelSchema.nullable().optional(),
  hint_used: z.boolean().optional(),
  mistake_status: mistakeStatusSchema.optional(),
  mastery_level: masteryLevelSchema.optional(),
  ease_factor: z.number().min(1.3).max(4.0).optional(),
  interval_days: z.number().int().min(0).max(3650).optional(),
  repetitions: z.number().int().min(0).max(10_000).optional(),
  next_review_at: z.string().datetime().nullable().optional(),
});

export const listProgressQuerySchema = z.object({
  studySetId: uuidSchema.optional(),
  masteryLevel: masteryLevelSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
});

export const listDueQuerySchema = z.object({
  studySetId: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const listMistakesQuerySchema = z.object({
  // All 15 V3 Mistake Bank filters (100% backward-compatible with V2.1 callers!)
  subject: z.string().trim().max(120).optional(),
  studySetId: uuidSchema.optional(),
  chapter: z.string().trim().max(200).optional(),
  tagId: uuidSchema.optional(),
  questionType: questionTypeSchema.optional(),
  minWrongCount: z.coerce.number().int().min(1).default(1),
  minConsecutiveWrong: z.coerce.number().int().min(1).max(1000).optional(),
  examAttemptId: uuidSchema.optional(),
  recentExamOnly: boolQuerySchema.optional(),
  confidence: confidenceLevelSchema.optional(),
  lowConfidence: boolQuerySchema.optional(),
  lowConfidenceOnly: boolQuerySchema.optional(),
  highConfWrong: boolQuerySchema.optional(),
  highConfWrongOnly: boolQuerySchema.optional(),
  guessCorrect: boolQuerySchema.optional(),
  guessCorrectOnly: boolQuerySchema.optional(),
  dueOnly: boolQuerySchema.optional(),
  starredOnly: boolQuerySchema.optional(),
  masteryLevel: masteryLevelSchema.optional(),
  mistakeStatus: mistakeStatusSchema.optional(),
  tab: z.enum(["all", "active", "improving", "resolved", "unresolved"]).optional(),
  includeResolved: boolQuerySchema.default(false),
  days: z.coerce.number().int().min(1).max(3650).optional(),
  sort: z
    .enum([
      "wrong_count",
      "recent_wrong",
      "consecutive_wrong",
      "high_conf_wrong",
      "due_first",
    ])
    .default("wrong_count"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const toggleStarSchema = z.object({
  question_id: uuidSchema,
  study_set_id: uuidSchema.optional(),
});

// SH-009: Allow up to 500 per page cleanly while chunking DB relation fetches internally
export const listStarredQuerySchema = z.object({
  studySetId: uuidSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
});

export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type UpdateSessionInput = z.infer<typeof updateSessionSchema>;
export type RecordSessionAnswerInput = z.infer<typeof recordSessionAnswerSchema>;
export type UpsertProgressInput = z.infer<typeof upsertProgressSchema>;
