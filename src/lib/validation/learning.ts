import { z } from "zod";
import {
  masteryLevelSchema,
  selfRatingSchema,
  sessionStatusSchema,
  studyModeSchema,
  uuidSchema,
} from "./common";

export const createSessionSchema = z.object({
  study_set_id: uuidSchema,
  mode: studyModeSchema,
  config: z.record(z.string(), z.unknown()).default({}),
  total_items: z.number().int().min(0).max(50_000).default(0),
});

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
  is_correct: z.boolean().optional(),
  self_rating: selfRatingSchema.nullable().optional(),
  response_time_ms: z.number().int().min(0).max(3_600_000).nullable().optional(),
  update_progress: z.boolean().default(true),
});

export const upsertProgressSchema = z.object({
  study_set_id: uuidSchema,
  question_id: uuidSchema,
  is_correct: z.boolean(),
  self_rating: selfRatingSchema.nullable().optional(),
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
  studySetId: uuidSchema.optional(),
  chapter: z.string().trim().max(200).optional(),
  minWrongCount: z.coerce.number().int().min(1).default(1),
  includeResolved: z
    .union([z.literal("true"), z.literal("false")])
    .transform((v) => v === "true")
    .default("false"),
  days: z.coerce.number().int().min(1).max(3650).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export const toggleStarSchema = z.object({
  question_id: uuidSchema,
  study_set_id: uuidSchema.optional(),
});

export const listStarredQuerySchema = z.object({
  studySetId: uuidSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(100),
});

export type CreateSessionInput = z.infer<typeof createSessionSchema>;
export type UpdateSessionInput = z.infer<typeof updateSessionSchema>;
export type RecordSessionAnswerInput = z.infer<typeof recordSessionAnswerSchema>;
export type UpsertProgressInput = z.infer<typeof upsertProgressSchema>;
