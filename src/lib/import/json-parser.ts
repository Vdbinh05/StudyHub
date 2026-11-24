import { z } from "zod";
import type {
  ImportValidationIssue,
  ParsedOption,
  ParsedQuestion,
} from "@/types/import";
import {
  generateStableId,
  indexToOptionLabel,
  isSafeHttpOrStorageUrl,
  normalizeText,
} from "./text-utils";

const JsonOptionSchema = z.object({
  id: z.string().optional(),
  label: z.string().optional(),
  content: z.string(),
  isCorrect: z.boolean().optional(),
  is_correct: z.boolean().optional(),
  imageUrl: z.string().nullable().optional(),
  image_url: z.string().nullable().optional(),
});

const JsonAcceptedAnswerSchema = z.object({
  answerText: z.string().optional(),
  answer_text: z.string().optional(),
  matchMode: z
    .enum(["exact", "case_insensitive", "ignore_diacritics", "numeric"])
    .optional(),
  match_mode: z
    .enum(["exact", "case_insensitive", "ignore_diacritics", "numeric"])
    .optional(),
});

const JsonQuestionSchema = z.object({
  questionType: z
    .enum([
      "single_choice",
      "multiple_choice",
      "true_false",
      "flashcard",
      "short_answer",
    ])
    .optional(),
  question_type: z
    .enum([
      "single_choice",
      "multiple_choice",
      "true_false",
      "flashcard",
      "short_answer",
    ])
    .optional(),
  chapter: z.string().nullable().optional(),
  prompt: z.string(),
  promptImageUrl: z.string().nullable().optional(),
  prompt_image_url: z.string().nullable().optional(),
  backText: z.string().nullable().optional(),
  back_text: z.string().nullable().optional(),
  backImageUrl: z.string().nullable().optional(),
  back_image_url: z.string().nullable().optional(),
  explanation: z.string().nullable().optional(),
  hint: z.string().nullable().optional(),
  difficulty: z.enum(["easy", "medium", "hard"]).optional(),
  tags: z.array(z.string()).optional(),
  options: z.array(JsonOptionSchema).optional(),
  acceptedAnswers: z.array(JsonAcceptedAnswerSchema).optional(),
  accepted_answers: z.array(JsonAcceptedAnswerSchema).optional(),
});

export const StudyHubJsonEnvelopeSchema = z.object({
  schema_version: z.string().min(1),
  exported_at: z.string().optional(),
  study_set: z
    .object({
      title: z.string().optional(),
      description: z.string().nullable().optional(),
      subject: z.string().nullable().optional(),
      set_type: z.enum(["multiple_choice", "flashcards", "mixed"]).optional(),
    })
    .optional(),
  questions: z.array(JsonQuestionSchema),
});

const FlatQuestionArraySchema = z.array(JsonQuestionSchema);

export interface JsonParserConfig {
  defaultChapter?: string;
  defaultTags?: string[];
}

export interface JsonParseOutput {
  questions: ParsedQuestion[];
  issues: ImportValidationIssue[];
  schemaVersion?: string;
}

/**
 * Deterministic Zod-validated parser for StudyHub JSON exports (with `schema_version`)
 * as well as flat JSON arrays of question objects. Supports lossless round-trips.
 */
export function parseStudyHubJson(
  rawText: string,
  config: JsonParserConfig = {},
): JsonParseOutput {
  const normalized = normalizeText(rawText).trim();
  const issues: ImportValidationIssue[] = [];

  let rawParsed: unknown;
  try {
    rawParsed = JSON.parse(normalized);
  } catch (err) {
    return {
      questions: [],
      issues: [
        {
          id: generateStableId(),
          code: "INVALID_FORMAT",
          severity: "error",
          message: `Invalid JSON syntax: ${err instanceof Error ? err.message : "Unable to parse JSON"}`,
        },
      ],
    };
  }

  let rawQuestions: Array<z.infer<typeof JsonQuestionSchema>> = [];
  let schemaVersion: string | undefined;

  if (Array.isArray(rawParsed)) {
    const flatCheck = FlatQuestionArraySchema.safeParse(rawParsed);
    if (!flatCheck.success) {
      return {
        questions: [],
        issues: [
          {
            id: generateStableId(),
            code: "INVALID_FORMAT",
            severity: "error",
            message: `JSON array does not match StudyHub question schema: ${flatCheck.error.issues[0]?.message ?? "invalid fields"}`,
          },
        ],
      };
    }
    rawQuestions = flatCheck.data;
  } else {
    const envCheck = StudyHubJsonEnvelopeSchema.safeParse(rawParsed);
    if (!envCheck.success) {
      return {
        questions: [],
        issues: [
          {
            id: generateStableId(),
            code: "INVALID_FORMAT",
            severity: "error",
            message: `JSON object does not match StudyHub schema (requires schema_version and questions[]): ${envCheck.error.issues[0]?.message ?? "invalid fields"}`,
          },
        ],
      };
    }
    rawQuestions = envCheck.data.questions;
    schemaVersion = envCheck.data.schema_version;
  }

  const questions: ParsedQuestion[] = rawQuestions.map((item, idx) => {
    const qIssues: ImportValidationIssue[] = [];
    const rawOptions = item.options ?? [];

    const options: ParsedOption[] = rawOptions.map((opt, optIdx) => {
      const isCorrect = Boolean(opt.isCorrect ?? opt.is_correct ?? false);
      const rawImg = opt.imageUrl ?? opt.image_url ?? null;
      const safeImg = rawImg && isSafeHttpOrStorageUrl(rawImg) ? rawImg.trim() : null;
      if (rawImg && !safeImg) {
        qIssues.push({
          id: generateStableId(),
          code: "INVALID_FORMAT",
          severity: "warning",
          questionIndex: idx,
          optionIndex: optIdx,
          message: `Unsafe option image URL was stripped for security.`,
        });
      }
      return {
        id: generateStableId(),
        label: (opt.label ?? indexToOptionLabel(optIdx)).toUpperCase(),
        content: opt.content.normalize("NFC").trim(),
        isCorrect,
        imageUrl: safeImg,
        detectedBy: isCorrect ? ["json_explicit"] : [],
      };
    });

    const correctCount = options.filter((o) => o.isCorrect).length;
    const backText = (item.backText ?? item.back_text ?? null)?.normalize("NFC").trim() || null;

    let questionType = item.questionType ?? item.question_type;
    if (!questionType) {
      if (options.length === 0 && backText) {
        questionType = "flashcard";
      } else if (correctCount > 1) {
        questionType = "multiple_choice";
      } else {
        questionType = "single_choice";
      }
    }

    const rawPromptImg = item.promptImageUrl ?? item.prompt_image_url ?? null;
    const promptImageUrl =
      rawPromptImg && isSafeHttpOrStorageUrl(rawPromptImg)
        ? rawPromptImg.trim()
        : null;
    if (rawPromptImg && !promptImageUrl) {
      qIssues.push({
        id: generateStableId(),
        code: "INVALID_FORMAT",
        severity: "warning",
        questionIndex: idx,
        message: "Unsafe prompt image URL was stripped for security.",
      });
    }

    const rawBackImg = item.backImageUrl ?? item.back_image_url ?? null;
    const backImageUrl =
      rawBackImg && isSafeHttpOrStorageUrl(rawBackImg) ? rawBackImg.trim() : null;

    const rawAccepted = item.acceptedAnswers ?? item.accepted_answers ?? [];
    const acceptedAnswers = rawAccepted
      .map((a) => ({
        answerText: (a.answerText ?? a.answer_text ?? "").normalize("NFC").trim(),
        matchMode: a.matchMode ?? a.match_mode ?? ("case_insensitive" as const),
      }))
      .filter((a) => a.answerText.length > 0);

    const tags = Array.from(
      new Set([
        ...(config.defaultTags ?? []),
        ...(item.tags ?? []).map((t) => t.normalize("NFC").trim()).filter(Boolean),
      ]),
    );

    const hasExplicitAnswer =
      correctCount > 0 ||
      (questionType === "flashcard" && Boolean(backText)) ||
      (questionType === "short_answer" && acceptedAnswers.length > 0);

    return {
      tempId: generateStableId(),
      index: idx,
      chapter:
        item.chapter?.normalize("NFC").trim() || config.defaultChapter || null,
      questionType,
      prompt: item.prompt.normalize("NFC").trim(),
      promptImageUrl,
      backText,
      backImageUrl,
      explanation: item.explanation?.normalize("NFC").trim() || null,
      hint: item.hint?.normalize("NFC").trim() || null,
      difficulty: item.difficulty ?? "medium",
      tags,
      options,
      acceptedAnswers,
      detectedBy: hasExplicitAnswer ? ["json_explicit"] : ["none"],
      issues: qIssues,
    };
  });

  return { questions, issues, schemaVersion };
}
