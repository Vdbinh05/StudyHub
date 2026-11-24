import { z } from "zod";
import {
  allocationStrategySchema,
  confidenceLevelSchema,
  coverageCycleStatusSchema,
  difficultySchema,
  examQuestionTypeSchema,
  examSourceTypeSchema,
  examStatusSchema,
  questionTypeSchema,
  selectionPolicySchema,
  studyModeSchema,
  uuidSchema,
} from "./common";
import { structuredAnswerResponseSchema } from "./v3";

export const MAX_EXAM_QUESTIONS = 1000;

export const examFilterSchema = z
  .object({
    chapters: z.array(z.string().trim().min(1).max(200)).max(200).optional(),
    tag_ids: z.array(uuidSchema).max(100).optional(),
    difficulties: z.array(difficultySchema).max(3).optional(),
    question_types: z.array(examQuestionTypeSchema).max(12).optional(),
  })
  .strict();

export const examSourceInputSchema = z.object({
  source_type: examSourceTypeSchema,
  id: uuidSchema,
  include_subfolders: z.boolean().default(true),
  custom_count: z.number().int().min(0).max(MAX_EXAM_QUESTIONS).nullable().optional(),
  custom_percentage: z.number().min(0).max(100).nullable().optional(),
});

export const examEligibleRequestSchema = z
  .object({
    folder_ids: z.array(uuidSchema).max(50).optional(),
    study_set_ids: z.array(uuidSchema).max(100).optional(),
    sources: z.array(examSourceInputSchema).max(100).optional(),
    include_subfolders: z.boolean().default(true),
    selection_policy: selectionPolicySchema.default("random"),
    filters: examFilterSchema.optional(),
  })
  .refine(
    (v) =>
      (v.folder_ids && v.folder_ids.length > 0) ||
      (v.study_set_ids && v.study_set_ids.length > 0) ||
      (v.sources && v.sources.length > 0),
    {
      message: "Select at least one study set or folder.",
    },
  );

export const examPreviewRequestSchema = z.object({
  sources: z.array(examSourceInputSchema).min(1).max(100),
  requested_question_count: z.number().finite().int().min(1).max(MAX_EXAM_QUESTIONS),
  allocation_strategy: allocationStrategySchema.default("proportional"),
  selection_policy: selectionPolicySchema.default("random"),
  full_coverage_mode: z.boolean().default(false),
  questions_per_exam: z.number().finite().int().min(1).max(MAX_EXAM_QUESTIONS).optional(),
  duration_limit_seconds: z.number().int().min(60).max(86400).nullable().optional(),
  pass_threshold: z.number().int().min(1).max(100).default(70),
  filters: examFilterSchema.optional(),
});

/**
 * Unified V1.0 + V2.0 Create Exam Schema.
 * Supports V1 single-set (`study_set_id` + optional `additional_study_set_ids`)
 * AND V2 multi-subject (`sources`, Strategies A–E, 8 Selection Policies, up to 1,000Q).
 */
export const createExamSchema = z
  .object({
    // V1 compatibility fields
    study_set_id: uuidSchema.nullable().optional(),
    additional_study_set_ids: z.array(uuidSchema).max(50).optional(),
    // V2 multi-subject source descriptors
    sources: z.array(examSourceInputSchema).max(100).optional(),
    preset_id: uuidSchema.nullable().optional(),
    title: z.string().trim().min(1).max(200).optional(),
    question_count: z.number().int().min(1).max(MAX_EXAM_QUESTIONS).optional(),
    requested_question_count: z.number().int().min(1).max(MAX_EXAM_QUESTIONS).optional(),
    allocation_strategy: allocationStrategySchema.default("global_random"),
    selection_policy: selectionPolicySchema.optional(),
    duration_limit_seconds: z.number().int().min(60).max(86400).nullable().optional(),
    shuffle_questions: z.boolean().default(true),
    shuffle_options: z.boolean().default(true),
    pass_threshold: z.number().int().min(1).max(100).default(70),
    show_subject_names: z.boolean().default(true),
    show_chapter_names: z.boolean().default(true),
    allow_navigation: z.boolean().default(true),
    allow_mark_for_review: z.boolean().default(true),
    auto_submit_on_expire: z.boolean().default(true),
    show_review_after_submit: z.boolean().default(true),
    // Filters (both top-level V1 and nested V2 `filters` accepted)
    filters: examFilterSchema.optional(),
    chapters: z.array(z.string().trim().min(1).max(200)).max(200).optional(),
    tag_ids: z.array(uuidSchema).max(100).optional(),
    difficulties: z.array(difficultySchema).max(3).optional(),
    question_types: z.array(examQuestionTypeSchema).max(12).optional(),
    only_starred: z.boolean().default(false),
    only_unmastered: z.boolean().default(false),
    only_mistakes: z.boolean().default(false),
    question_ids: z.array(uuidSchema).max(MAX_EXAM_QUESTIONS).optional(),
  })
  .refine(
    (v) =>
      Boolean(v.study_set_id) ||
      Boolean(v.sources && v.sources.length > 0) ||
      Boolean(v.question_ids && v.question_ids.length > 0),
    {
      message: "Provide study_set_id, sources, or explicit question_ids.",
    },
  );

export const saveExamAnswerItemSchema = z.object({
  attempt_question_id: uuidSchema,
  selected_option_ids: z.array(uuidSchema).max(20).default([]),
  typed_answer: z.string().max(5000).nullable().optional(),
  structured_response: structuredAnswerResponseSchema.nullable().optional(),
  confidence: confidenceLevelSchema.nullable().optional(),
  hint_used: z.boolean().optional(),
  is_flagged: z.boolean().default(false),
  client_seq: z.number().int().min(0).default(0),
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

// Exam Presets (Private, Config-Only — NO fixed question_ids!)
export const createExamPresetSchema = z.object({
  name: z.string().trim().min(1, "Preset name is required.").max(160),
  description: z.string().trim().max(500).nullable().optional(),
  is_favorite: z.boolean().default(false),
  sources: z.array(examSourceInputSchema).min(1).max(100),
  requested_question_count: z.number().int().min(1).max(MAX_EXAM_QUESTIONS).nullable().optional(),
  allocation_strategy: allocationStrategySchema.default("proportional"),
  selection_policy: selectionPolicySchema.default("random"),
  full_coverage_mode: z.boolean().default(false),
  duration_limit_seconds: z.number().int().min(60).max(86400).nullable().optional(),
  pass_threshold: z.number().int().min(1).max(100).default(70),
  shuffle_questions: z.boolean().default(true),
  shuffle_options: z.boolean().default(true),
  show_subject_names: z.boolean().default(true),
  show_chapter_names: z.boolean().default(true),
  allow_navigation: z.boolean().default(true),
  allow_mark_for_review: z.boolean().default(true),
  auto_submit_on_expire: z.boolean().default(true),
  show_review_after_submit: z.boolean().default(true),
  filters: examFilterSchema.default({}),
});

export const updateExamPresetSchema = createExamPresetSchema.partial();

export const duplicateExamPresetSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
  })
  .optional();

export const listExamPresetsQuerySchema = z.object({
  favoritesOnly: z
    .union([z.literal("true"), z.literal("false")])
    .transform((v) => v === "true")
    .optional(),
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

// Full Coverage Cycles
export const createCoverageCycleSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  preset_id: uuidSchema.nullable().optional(),
  sources: z.array(examSourceInputSchema).min(1).max(100),
  allocation_strategy: allocationStrategySchema.default("proportional"),
  questions_per_exam: z.number().int().min(1).max(MAX_EXAM_QUESTIONS),
  duration_limit_seconds: z.number().int().min(60).max(86400).nullable().optional(),
  pass_threshold: z.number().int().min(1).max(100).default(70),
  shuffle_options: z.boolean().default(true),
  show_subject_names: z.boolean().default(true),
  show_chapter_names: z.boolean().default(true),
  allow_navigation: z.boolean().default(true),
  allow_mark_for_review: z.boolean().default(true),
  auto_submit_on_expire: z.boolean().default(true),
  show_review_after_submit: z.boolean().default(true),
  filters: examFilterSchema.default({}),
  start_first_exam: z.boolean().default(false),
});

export const restartCoverageCycleSchema = z
  .object({
    refresh_pool: z.boolean().default(false),
    force_discard_active: z.boolean().default(false),
  })
  .optional();

export const listCoverageCyclesQuerySchema = z.object({
  status: coverageCycleStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

// Custom Subset & Multi-Subject Practice
export const practiceQuestionsRequestSchema = z.object({
  sources: z.array(examSourceInputSchema).min(1).max(100),
  mode: studyModeSchema.default("practice"),
  count: z.number().int().min(1).max(2000).nullable().optional(),
  selection_policy: selectionPolicySchema.default("random"),
  shuffle_questions: z.boolean().default(true),
  filters: z
    .object({
      chapters: z.array(z.string().trim().min(1).max(200)).max(200).optional(),
      tag_ids: z.array(uuidSchema).max(100).optional(),
      difficulties: z.array(difficultySchema).max(3).optional(),
      question_types: z.array(questionTypeSchema).max(13).optional(),
    })
    .optional(),
  create_session: z.boolean().default(false),
});

export type CreateExamInput = z.infer<typeof createExamSchema>;
export type SaveExamAnswerItem = z.infer<typeof saveExamAnswerItemSchema>;
export type ExamEligibleRequest = z.infer<typeof examEligibleRequestSchema>;
export type ExamPreviewRequest = z.infer<typeof examPreviewRequestSchema>;
export type CreateExamPresetInput = z.infer<typeof createExamPresetSchema>;
export type UpdateExamPresetInput = z.infer<typeof updateExamPresetSchema>;
export type CreateCoverageCycleInput = z.infer<typeof createCoverageCycleSchema>;
export type PracticeQuestionsRequest = z.infer<typeof practiceQuestionsRequestSchema>;
