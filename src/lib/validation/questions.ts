import { z } from "zod";
import {
  answerMatchModeSchema,
  difficultySchema,
  nullableSafeUrlSchema,
  questionTypeSchema,
  uuidSchema,
} from "./common";

export const questionOptionInputSchema = z.object({
  id: uuidSchema.optional(),
  position: z.number().int().min(0).max(20).optional(),
  label: z.string().trim().min(1).max(10),
  content: z.string().trim().min(1, "Option content is required.").max(4000),
  image_url: nullableSafeUrlSchema,
  is_correct: z.boolean().default(false),
});

export const acceptedAnswerInputSchema = z.object({
  id: uuidSchema.optional(),
  answer_text: z.string().trim().min(1, "Accepted answer is required.").max(1000),
  match_mode: answerMatchModeSchema.default("case_insensitive"),
});

const baseQuestionSchema = z.object({
  question_type: questionTypeSchema.default("single_choice"),
  position: z.number().int().min(0).optional(),
  chapter: z.string().trim().max(200).nullable().optional(),
  prompt: z.string().trim().min(1, "Question prompt is required.").max(10000),
  prompt_image_url: nullableSafeUrlSchema,
  back_text: z.string().trim().max(10000).nullable().optional(),
  back_image_url: nullableSafeUrlSchema,
  explanation: z.string().trim().max(10000).nullable().optional(),
  hint: z.string().trim().max(2000).nullable().optional(),
  difficulty: difficultySchema.default("medium"),
  source_metadata: z.record(z.string(), z.unknown()).optional(),
  options: z.array(questionOptionInputSchema).max(10).optional(),
  accepted_answers: z.array(acceptedAnswerInputSchema).max(20).optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
});

function validateChoiceOptions(
  questionType: string | undefined,
  options: Array<{ is_correct: boolean }> | undefined,
  ctx: z.RefinementCtx,
  requireWhenMissing: boolean,
): void {
  const isChoice =
    questionType === "single_choice" ||
    questionType === "multiple_choice" ||
    questionType === "true_false";

  if (!isChoice && options === undefined) {
    return;
  }

  if (options === undefined) {
    if (isChoice && requireWhenMissing) {
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message: "Choice questions require at least 2 options.",
      });
    }
    return;
  }

  if (isChoice || options.length > 0) {
    if (options.length < 2) {
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message: "Choice questions require at least 2 options.",
      });
      return;
    }

    const correctCount = options.filter((opt) => opt.is_correct).length;
    if (correctCount < 1) {
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message: "Choice questions require at least 1 correct option.",
      });
    } else if (
      (questionType === "single_choice" || questionType === "true_false") &&
      correctCount > 1
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["options"],
        message: "Single-choice and true/false questions must have exactly 1 correct option.",
      });
    }
  }
}

export const createQuestionSchema = baseQuestionSchema.superRefine((data, ctx) => {
  validateChoiceOptions(data.question_type, data.options, ctx, true);

  if (
    data.question_type === "flashcard" &&
    (!data.back_text || data.back_text.trim().length === 0)
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["back_text"],
      message: "Flashcards require back_text.",
    });
  }

  if (
    data.question_type === "short_answer" &&
    (!data.accepted_answers || data.accepted_answers.length === 0)
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["accepted_answers"],
      message: "Short-answer questions require at least 1 accepted answer.",
    });
  }
});

// SH-025 / BUG-017: Validate option/flashcard/short_answer invariants on PATCH too!
export const updateQuestionSchema = baseQuestionSchema
  .partial()
  .superRefine((data, ctx) => {
    validateChoiceOptions(data.question_type, data.options, ctx, false);

    if (
      data.question_type === "flashcard" &&
      data.back_text !== undefined &&
      (!data.back_text || data.back_text.trim().length === 0)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["back_text"],
        message: "Flashcards require non-empty back_text.",
      });
    }

    if (
      data.question_type === "short_answer" &&
      data.accepted_answers !== undefined &&
      data.accepted_answers.length === 0
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["accepted_answers"],
        message: "Short-answer questions require at least 1 accepted answer.",
      });
    }
  });

export const listQuestionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
  chapter: z.string().trim().max(200).optional(),
  search: z.string().trim().max(200).optional(),
  tagId: uuidSchema.optional(),
  difficulty: difficultySchema.optional(),
  questionType: questionTypeSchema.optional(),
  starredOnly: z
    .union([z.literal("true"), z.literal("false")])
    .transform((v) => v === "true")
    .optional(),
});

export const bulkInsertQuestionsSchema = z.object({
  questions: z.array(createQuestionSchema).min(1).max(500),
});

export const bulkUpdateQuestionsSchema = z.object({
  question_ids: z.array(uuidSchema).min(1).max(1000),
  chapter: z.string().trim().max(200).nullable().optional(),
  difficulty: difficultySchema.optional(),
  add_tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
  remove_tag_ids: z.array(uuidSchema).max(20).optional(),
});

export const bulkDeleteQuestionsSchema = z.object({
  question_ids: z.array(uuidSchema).min(1).max(1000),
});

export type CreateQuestionInput = z.infer<typeof createQuestionSchema>;
export type UpdateQuestionInput = z.infer<typeof updateQuestionSchema>;
export type ListQuestionsQuery = z.infer<typeof listQuestionsQuerySchema>;
