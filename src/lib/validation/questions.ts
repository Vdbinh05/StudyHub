import { z } from "zod";
import {
  answerMatchModeSchema,
  difficultySchema,
  mediaRoleSchema,
  nullableSafeUrlSchema,
  questionTypeSchema,
  uuidSchema,
} from "./common";
import {
  nullableRichTextDocSchema,
  questionTypePayloadSchema,
} from "./v3";

export const questionOptionInputSchema = z
  .object({
    id: uuidSchema.optional(),
    position: z.number().int().min(0).max(20).optional(),
    label: z.string().trim().min(1).max(10),
    content: z.string().trim().max(4000).default(""),
    content_rich: nullableRichTextDocSchema,
    image_url: nullableSafeUrlSchema,
    media_id: uuidSchema.nullable().optional(),
    image_alt: z.string().trim().max(500).nullable().optional(),
    is_correct: z.boolean().default(false),
  })
  .refine(
    (opt) =>
      opt.content.trim().length > 0 ||
      Boolean(opt.image_url) ||
      Boolean(opt.media_id),
    {
      message: "Each option requires text content or an image.",
      path: ["content"],
    },
  );

export const acceptedAnswerInputSchema = z.object({
  id: uuidSchema.optional(),
  answer_text: z.string().trim().min(1, "Accepted answer is required.").max(1000),
  match_mode: answerMatchModeSchema.default("case_insensitive"),
});

export const questionMediaAttachmentInputSchema = z.object({
  media_id: uuidSchema,
  role: mediaRoleSchema.default("prompt"),
  sort_order: z.number().int().min(0).max(100).default(0),
  alt_text: z.string().trim().max(500).nullable().optional(),
  caption: z.string().trim().max(1000).nullable().optional(),
});

const baseQuestionSchema = z.object({
  question_type: questionTypeSchema.default("single_choice"),
  position: z.number().int().min(0).optional(),
  chapter: z.string().trim().max(200).nullable().optional(),
  prompt: z.string().trim().max(10000).default(""),
  prompt_rich: nullableRichTextDocSchema,
  prompt_image_url: nullableSafeUrlSchema,
  back_text: z.string().trim().max(10000).nullable().optional(),
  back_rich: nullableRichTextDocSchema,
  back_image_url: nullableSafeUrlSchema,
  explanation: z.string().trim().max(10000).nullable().optional(),
  explanation_rich: nullableRichTextDocSchema,
  hint: z.string().trim().max(2000).nullable().optional(),
  hint_rich: nullableRichTextDocSchema,
  audio_media_id: uuidSchema.nullable().optional(),
  audio_url: nullableSafeUrlSchema,
  audio_transcript: z.string().trim().max(20_000).nullable().optional(),
  passage_id: uuidSchema.nullable().optional(),
  diagram_id: uuidSchema.nullable().optional(),
  type_payload: questionTypePayloadSchema.nullable().optional(),
  media_attachments: z.array(questionMediaAttachmentInputSchema).max(20).optional(),
  difficulty: difficultySchema.default("medium"),
  source_metadata: z.record(z.string(), z.unknown()).optional(),
  options: z.array(questionOptionInputSchema).max(10).optional(),
  accepted_answers: z.array(acceptedAnswerInputSchema).max(20).optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
});

function validateChoiceOptions(
  questionType: string | undefined,
  options: Array<{ is_correct: boolean }> | undefined,
  typePayload: z.infer<typeof questionTypePayloadSchema> | null | undefined,
  ctx: z.RefinementCtx,
  requireWhenMissing: boolean,
): void {
  const subKind =
    typePayload &&
    (typePayload.type === "listening" || typePayload.type === "reading_passage")
      ? typePayload.sub_answer_kind
      : undefined;

  const isChoice =
    questionType === "single_choice" ||
    questionType === "multiple_choice" ||
    questionType === "true_false" ||
    questionType === "image_choice" ||
    ((questionType === "listening" || questionType === "reading_passage") &&
      (subKind === "single_choice" ||
        subKind === "multiple_choice" ||
        subKind === "true_false"));

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
    } else {
      const isStrictSingle =
        questionType === "single_choice" ||
        questionType === "true_false" ||
        (questionType === "image_choice" &&
          (!typePayload ||
            (typePayload.type === "image_choice" &&
              typePayload.selection_mode !== "multiple"))) ||
        ((questionType === "listening" || questionType === "reading_passage") &&
          (subKind === "single_choice" || subKind === "true_false"));

      if (isStrictSingle && correctCount > 1) {
        ctx.addIssue({
          code: "custom",
          path: ["options"],
          message:
            "Single-choice and true/false questions must have exactly 1 correct option.",
        });
      }
    }
  }
}

export const createQuestionSchema = baseQuestionSchema.superRefine((data, ctx) => {
  const hasPromptContent =
    data.prompt.trim().length > 0 ||
    Boolean(data.prompt_image_url) ||
    Boolean(data.audio_url) ||
    Boolean(data.audio_media_id) ||
    Boolean(data.diagram_id) ||
    Boolean(data.media_attachments && data.media_attachments.length > 0);

  if (!hasPromptContent) {
    ctx.addIssue({
      code: "custom",
      path: ["prompt"],
      message: "Question prompt text, image, audio, or diagram is required.",
    });
  }

  validateChoiceOptions(
    data.question_type,
    data.options,
    data.type_payload,
    ctx,
    true,
  );

  if (
    data.question_type === "flashcard" &&
    (!data.back_text || data.back_text.trim().length === 0) &&
    !data.back_image_url
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["back_text"],
      message: "Flashcards require back_text or back_image_url.",
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

  if (
    data.question_type === "fill_in_blank" &&
    (!data.type_payload || data.type_payload.type !== "fill_in_blank")
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["type_payload"],
      message: "Fill-in-the-blank questions require a fill_in_blank type_payload.",
    });
  }

  if (
    data.question_type === "numerical" &&
    (!data.type_payload || data.type_payload.type !== "numerical")
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["type_payload"],
      message: "Numerical questions require a numerical type_payload.",
    });
  }

  if (
    data.question_type === "ordering" &&
    (!data.type_payload || data.type_payload.type !== "ordering")
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["type_payload"],
      message: "Ordering questions require an ordering type_payload.",
    });
  }

  if (
    data.question_type === "matching" &&
    (!data.type_payload || data.type_payload.type !== "matching")
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["type_payload"],
      message: "Matching questions require a matching type_payload.",
    });
  }

  if (
    data.question_type === "image_hotspot" &&
    (!data.type_payload || data.type_payload.type !== "image_hotspot")
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["type_payload"],
      message: "Image hotspot questions require an image_hotspot type_payload.",
    });
  }
});

// SH-025 / BUG-017 + V3: Validate option/flashcard/short_answer/structured payload invariants on PATCH too!
export const updateQuestionSchema = baseQuestionSchema
  .partial()
  .superRefine((data, ctx) => {
    validateChoiceOptions(
      data.question_type,
      data.options,
      data.type_payload,
      ctx,
      false,
    );

    if (
      data.question_type === "flashcard" &&
      data.back_text !== undefined &&
      (!data.back_text || data.back_text.trim().length === 0) &&
      !data.back_image_url
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["back_text"],
        message: "Flashcards require non-empty back_text or back_image_url.",
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
