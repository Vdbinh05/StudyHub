import { z } from "zod";
import {
  difficultySchema,
  examQuestionTypeSchema,
  examStatusSchema,
  uuidSchema,
} from "./common";

export const createExamSchema = z.object({
  study_set_id: uuidSchema,
  additional_study_set_ids: z.array(uuidSchema).max(20).optional(),
  title: z.string().trim().min(1).max(200).optional(),
  question_count: z.number().int().min(1).max(500).default(30),
  duration_limit_seconds: z.number().int().min(60).max(3600 * 6).nullable().optional(),
  shuffle_questions: z.boolean().default(true),
  shuffle_options: z.boolean().default(true),
  pass_threshold: z.number().int().min(1).max(100).default(70),
  chapters: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
  tag_ids: z.array(uuidSchema).max(50).optional(),
  difficulties: z.array(difficultySchema).max(3).optional(),
  question_types: z.array(examQuestionTypeSchema).max(4).optional(),
  only_starred: z.boolean().default(false),
  only_unmastered: z.boolean().default(false),
  only_mistakes: z.boolean().default(false),
  question_ids: z.array(uuidSchema).max(500).optional(),
});

export const saveExamAnswerItemSchema = z.object({
  attempt_question_id: uuidSchema,
  selected_option_ids: z.array(uuidSchema).max(20).default([]),
  typed_answer: z.string().max(5000).nullable().optional(),
  is_flagged: z.boolean().default(false),
});

export const saveExamAnswersSchema = z.union([
  saveExamAnswerItemSchema,
  z.object({
    answers: z.array(saveExamAnswerItemSchema).min(1).max(200),
  }),
]);

export const listExamsQuerySchema = z.object({
  studySetId: uuidSchema.optional(),
  status: examStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export type CreateExamInput = z.infer<typeof createExamSchema>;
export type SaveExamAnswerItem = z.infer<typeof saveExamAnswerItemSchema>;
