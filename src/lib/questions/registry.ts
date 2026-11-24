import type { QuestionType, StudyMode } from "@/types/domain";
import type {
  FillInBlankPayload,
  HotspotGeometry,
  ImageChoicePayload,
  ImageHotspotPayload,
  ListeningPayload,
  MatchingPayload,
  NumericalPayload,
  OrderingPayload,
  QuestionTypePayload,
  ReadingPassagePayload,
  RichTextDoc,
  StructuredAnswerResponse,
} from "@/types/v3";
import {
  gradeFillInBlankResponse,
  gradeImageHotspotResponse,
  gradeMatchingResponse,
  gradeMultipleChoiceByUuid,
  gradeNumericalResponse,
  gradeOrderingResponse,
  gradeShortAnswerResponse,
  gradeSingleChoiceByUuid,
  type GradeAcceptedAnswerLike,
  type GradeOptionLike,
  type GradeOptions,
  type QuestionGradeResult,
} from "./scoring";

export interface QuestionLike {
  id?: string;
  question_type: QuestionType;
  prompt: string;
  prompt_rich?: RichTextDoc | null;
  prompt_image_url?: string | null;
  back_text?: string | null;
  back_rich?: RichTextDoc | null;
  explanation?: string | null;
  hint?: string | null;
  audio_url?: string | null;
  audio_media_id?: string | null;
  audio_transcript?: string | null;
  passage_id?: string | null;
  diagram_id?: string | null;
  type_payload?: QuestionTypePayload | null;
  options?: readonly GradeOptionLike[];
  accepted_answers?: readonly GradeAcceptedAnswerLike[];
}

export interface QuestionValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ResponseValidationResult {
  valid: boolean;
  error?: string;
}

export interface QuestionTypeDescriptor {
  type: QuestionType;
  labelVi: string;
  labelEn: string;
  isExamCompatible: boolean;
  compatibleModes: readonly StudyMode[];
  supportsOffline: boolean;
  supportsPdfPaper: boolean;
  validateQuestion: (question: QuestionLike) => QuestionValidationResult;
  validateResponse: (
    question: QuestionLike,
    response: StructuredAnswerResponse,
  ) => ResponseValidationResult;
  gradeResponse: (
    question: QuestionLike,
    response: StructuredAnswerResponse,
    options?: GradeOptions,
  ) => QuestionGradeResult;
  extractPlainText: (question: QuestionLike) => string;
}

function isValidNormalizedCoord(n: number): boolean {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
}

function isValidHotspotGeometry(g: HotspotGeometry | undefined): boolean {
  if (!g) return false;
  if (g.shape === "point") {
    return (
      isValidNormalizedCoord(g.x) &&
      isValidNormalizedCoord(g.y) &&
      (g.radius === undefined ||
        (Number.isFinite(g.radius) && g.radius >= 0.005 && g.radius <= 0.5))
    );
  }
  if (g.shape === "rect") {
    return (
      isValidNormalizedCoord(g.x) &&
      isValidNormalizedCoord(g.y) &&
      Number.isFinite(g.width) &&
      Number.isFinite(g.height) &&
      g.width > 0 &&
      g.height > 0 &&
      g.x + g.width <= 1.0001 &&
      g.y + g.height <= 1.0001
    );
  }
  if (g.shape === "polygon") {
    return (
      Array.isArray(g.points) &&
      g.points.length >= 3 &&
      g.points.every((p) => isValidNormalizedCoord(p.x) && isValidNormalizedCoord(p.y))
    );
  }
  return false;
}

function defaultExtractPlainText(question: QuestionLike): string {
  const parts: string[] = [];
  if (question.prompt?.trim()) parts.push(question.prompt.trim());
  if (question.back_text?.trim()) parts.push(question.back_text.trim());
  if (question.options && question.options.length > 0) {
    for (const o of question.options) {
      if (o.content?.trim()) parts.push(o.content.trim());
    }
  }
  if (question.explanation?.trim()) parts.push(question.explanation.trim());
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function validateChoiceOptions(
  question: QuestionLike,
  opts: { allowImageOnly?: boolean; exactTwo?: boolean } = {},
): QuestionValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!question.prompt?.trim() && !question.prompt_image_url) {
    errors.push("Question prompt cannot be empty.");
  }
  const items = question.options ?? [];
  const validItems = items.filter((o) => {
    const hasText = Boolean(o.content && o.content.trim().length > 0);
    const hasImage = Boolean(o.image_url || o.media_id);
    return opts.allowImageOnly ? hasText || hasImage : hasText;
  });

  if (opts.exactTwo) {
    if (validItems.length !== 2) {
      errors.push("True/False questions require exactly 2 options.");
    }
  } else if (validItems.length < 2) {
    errors.push("Choice questions require at least 2 valid options.");
  }

  const correctCount = validItems.filter((o) => o.is_correct).length;
  if (correctCount === 0) {
    errors.push("At least one correct option must be marked.");
  }

  return { valid: errors.length === 0, errors, warnings };
}

function validateOptionsResponse(
  response: StructuredAnswerResponse,
): ResponseValidationResult {
  if (response.kind !== "options") {
    return { valid: false, error: 'Expected response kind "options".' };
  }
  if (!Array.isArray(response.selected_option_ids)) {
    return { valid: false, error: "selected_option_ids must be an array." };
  }
  return { valid: true };
}

function gradeSubInteraction(
  subKind:
    | "single_choice"
    | "multiple_choice"
    | "true_false"
    | "short_answer"
    | "fill_in_blank",
  question: QuestionLike,
  response: StructuredAnswerResponse,
  options?: GradeOptions,
): QuestionGradeResult {
  switch (subKind) {
    case "single_choice":
    case "true_false":
      if (response.kind !== "options") {
        return {
          isCorrect: false,
          scoreRatio: 0,
          gradingMode: "deterministic",
          reason: "response_kind_mismatch",
        };
      }
      return gradeSingleChoiceByUuid(
        question.options ?? [],
        response.selected_option_ids,
      );
    case "multiple_choice":
      if (response.kind !== "options") {
        return {
          isCorrect: false,
          scoreRatio: 0,
          gradingMode: "deterministic",
          reason: "response_kind_mismatch",
        };
      }
      return gradeMultipleChoiceByUuid(
        question.options ?? [],
        response.selected_option_ids,
        { partialCredit: options?.partialCredit },
      );
    case "short_answer":
      if (response.kind !== "text") {
        return {
          isCorrect: false,
          scoreRatio: 0,
          gradingMode: "deterministic",
          reason: "response_kind_mismatch",
        };
      }
      return gradeShortAnswerResponse(
        question.accepted_answers ?? [],
        question.back_text,
        response.value,
        { selfAssessedCorrect: options?.selfAssessedCorrect },
      );
    case "fill_in_blank": {
      if (response.kind !== "blanks") {
        return {
          isCorrect: false,
          scoreRatio: 0,
          gradingMode: "deterministic",
          reason: "response_kind_mismatch",
        };
      }
      const rawPayload = question.type_payload as unknown as
        | { blanks?: FillInBlankPayload["blanks"]; require_all_blanks?: boolean }
        | null;
      return gradeFillInBlankResponse(
        {
          type: "fill_in_blank",
          blanks: rawPayload?.blanks ?? [],
          require_all_blanks: rawPayload?.require_all_blanks,
        },
        response,
        { partialCredit: options?.partialCredit },
      );
    }
  }
}

export const QUESTION_TYPE_REGISTRY: Record<QuestionType, QuestionTypeDescriptor> = {
  single_choice: {
    type: "single_choice",
    labelVi: "Một đáp án",
    labelEn: "Single Choice",
    isExamCompatible: true,
    compatibleModes: ["flashcards", "learn", "practice", "review", "custom_practice"],
    supportsOffline: true,
    supportsPdfPaper: true,
    validateQuestion: (q) => validateChoiceOptions(q),
    validateResponse: (_q, r) => validateOptionsResponse(r),
    gradeResponse: (q, r) =>
      r.kind === "options"
        ? gradeSingleChoiceByUuid(q.options ?? [], r.selected_option_ids)
        : {
            isCorrect: false,
            scoreRatio: 0,
            gradingMode: "deterministic",
            reason: "response_kind_mismatch",
          },
    extractPlainText: defaultExtractPlainText,
  },

  multiple_choice: {
    type: "multiple_choice",
    labelVi: "Nhiều đáp án",
    labelEn: "Multiple Choice",
    isExamCompatible: true,
    compatibleModes: ["flashcards", "learn", "practice", "review", "custom_practice"],
    supportsOffline: true,
    supportsPdfPaper: true,
    validateQuestion: (q) => validateChoiceOptions(q),
    validateResponse: (_q, r) => validateOptionsResponse(r),
    gradeResponse: (q, r, opts) =>
      r.kind === "options"
        ? gradeMultipleChoiceByUuid(q.options ?? [], r.selected_option_ids, {
            partialCredit: opts?.partialCredit,
          })
        : {
            isCorrect: false,
            scoreRatio: 0,
            gradingMode: "deterministic",
            reason: "response_kind_mismatch",
          },
    extractPlainText: defaultExtractPlainText,
  },

  true_false: {
    type: "true_false",
    labelVi: "Đúng / Sai",
    labelEn: "True / False",
    isExamCompatible: true,
    compatibleModes: ["flashcards", "learn", "practice", "review", "custom_practice"],
    supportsOffline: true,
    supportsPdfPaper: true,
    validateQuestion: (q) => validateChoiceOptions(q, { exactTwo: true }),
    validateResponse: (_q, r) => validateOptionsResponse(r),
    gradeResponse: (q, r) =>
      r.kind === "options"
        ? gradeSingleChoiceByUuid(q.options ?? [], r.selected_option_ids)
        : {
            isCorrect: false,
            scoreRatio: 0,
            gradingMode: "deterministic",
            reason: "response_kind_mismatch",
          },
    extractPlainText: defaultExtractPlainText,
  },

  flashcard: {
    type: "flashcard",
    labelVi: "Thẻ ghi nhớ",
    labelEn: "Flashcard",
    isExamCompatible: false,
    compatibleModes: ["flashcards", "learn", "write", "spell", "match", "review"],
    supportsOffline: true,
    supportsPdfPaper: true,
    validateQuestion: (q) => {
      const errors: string[] = [];
      if (!q.prompt?.trim() && !q.prompt_image_url) {
        errors.push("Flashcard front cannot be empty.");
      }
      if (!q.back_text?.trim()) {
        errors.push("Flashcard back/definition cannot be empty.");
      }
      return { valid: errors.length === 0, errors, warnings: [] };
    },
    validateResponse: (_q, r) =>
      r.kind === "text"
        ? { valid: true }
        : { valid: false, error: 'Expected response kind "text".' },
    gradeResponse: (q, r, opts) =>
      r.kind === "text"
        ? gradeShortAnswerResponse(
            q.accepted_answers ?? [],
            q.back_text,
            r.value,
            { selfAssessedCorrect: opts?.selfAssessedCorrect },
          )
        : {
            isCorrect: false,
            scoreRatio: 0,
            gradingMode: "deterministic",
            reason: "response_kind_mismatch",
          },
    extractPlainText: defaultExtractPlainText,
  },

  short_answer: {
    type: "short_answer",
    labelVi: "Tự luận ngắn",
    labelEn: "Short Answer",
    isExamCompatible: true,
    compatibleModes: [
      "flashcards",
      "learn",
      "practice",
      "write",
      "spell",
      "review",
      "custom_practice",
    ],
    supportsOffline: true,
    supportsPdfPaper: true,
    validateQuestion: (q) => {
      const errors: string[] = [];
      if (!q.prompt?.trim() && !q.prompt_image_url) {
        errors.push("Question prompt cannot be empty.");
      }
      const hasAccepted =
        Boolean(q.back_text?.trim()) ||
        Boolean(q.accepted_answers?.some((a) => a.answer_text.trim().length > 0));
      if (!hasAccepted) {
        errors.push("Short-answer questions require at least one accepted answer.");
      }
      return { valid: errors.length === 0, errors, warnings: [] };
    },
    validateResponse: (_q, r) =>
      r.kind === "text"
        ? { valid: true }
        : { valid: false, error: 'Expected response kind "text".' },
    gradeResponse: (q, r, opts) =>
      r.kind === "text"
        ? gradeShortAnswerResponse(
            q.accepted_answers ?? [],
            q.back_text,
            r.value,
            { selfAssessedCorrect: opts?.selfAssessedCorrect },
          )
        : {
            isCorrect: false,
            scoreRatio: 0,
            gradingMode: "deterministic",
            reason: "response_kind_mismatch",
          },
    extractPlainText: defaultExtractPlainText,
  },

  fill_in_blank: {
    type: "fill_in_blank",
    labelVi: "Điền khuyết",
    labelEn: "Fill in the Blank",
    isExamCompatible: true,
    compatibleModes: ["learn", "practice", "write", "review", "custom_practice"],
    supportsOffline: true,
    supportsPdfPaper: true,
    validateQuestion: (q) => {
      const errors: string[] = [];
      if (!q.prompt?.trim()) errors.push("Question prompt cannot be empty.");
      const payload = q.type_payload as FillInBlankPayload | null | undefined;
      if (!payload || payload.type !== "fill_in_blank" || !payload.blanks?.length) {
        errors.push("Fill-in-the-blank requires at least 1 configured blank.");
      } else {
        const seenIds = new Set<string>();
        for (const b of payload.blanks) {
          if (!b.blank_id?.trim()) errors.push("Each blank requires a blank_id.");
          if (seenIds.has(b.blank_id)) {
            errors.push(`Duplicate blank_id "${b.blank_id}".`);
          }
          seenIds.add(b.blank_id);
          if (!b.accepted_answers?.some((a) => a.trim().length > 0)) {
            errors.push(`Blank "${b.blank_id}" requires at least 1 accepted answer.`);
          }
        }
      }
      return { valid: errors.length === 0, errors, warnings: [] };
    },
    validateResponse: (_q, r) =>
      r.kind === "blanks" && r.answers && typeof r.answers === "object"
        ? { valid: true }
        : { valid: false, error: 'Expected response kind "blanks".' },
    gradeResponse: (q, r, opts) => {
      const payload = q.type_payload as FillInBlankPayload | null | undefined;
      if (!payload || payload.type !== "fill_in_blank" || r.kind !== "blanks") {
        return {
          isCorrect: false,
          scoreRatio: 0,
          gradingMode: "deterministic",
          reason: "response_kind_mismatch",
        };
      }
      return gradeFillInBlankResponse(payload, r, {
        partialCredit: opts?.partialCredit,
      });
    },
    extractPlainText: (q) => {
      const payload = q.type_payload as FillInBlankPayload | null | undefined;
      const base = defaultExtractPlainText(q);
      const tpl = payload?.type === "fill_in_blank" ? payload.template_text ?? "" : "";
      return [base, tpl].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    },
  },

  numerical: {
    type: "numerical",
    labelVi: "Đáp án số",
    labelEn: "Numerical",
    isExamCompatible: true,
    compatibleModes: ["learn", "practice", "write", "review", "custom_practice"],
    supportsOffline: true,
    supportsPdfPaper: true,
    validateQuestion: (q) => {
      const errors: string[] = [];
      if (!q.prompt?.trim()) errors.push("Question prompt cannot be empty.");
      const payload = q.type_payload as NumericalPayload | null | undefined;
      if (
        !payload ||
        payload.type !== "numerical" ||
        typeof payload.correct_value !== "number" ||
        !Number.isFinite(payload.correct_value)
      ) {
        errors.push("Numerical questions require a finite correct_value.");
      }
      if (
        payload?.abs_tolerance !== undefined &&
        payload.abs_tolerance !== null &&
        payload.abs_tolerance < 0
      ) {
        errors.push("abs_tolerance cannot be negative.");
      }
      if (
        payload?.rel_tolerance !== undefined &&
        payload.rel_tolerance !== null &&
        payload.rel_tolerance < 0
      ) {
        errors.push("rel_tolerance cannot be negative.");
      }
      return { valid: errors.length === 0, errors, warnings: [] };
    },
    validateResponse: (_q, r) =>
      r.kind === "numerical"
        ? { valid: true }
        : { valid: false, error: 'Expected response kind "numerical".' },
    gradeResponse: (q, r) => {
      const payload = q.type_payload as NumericalPayload | null | undefined;
      if (!payload || payload.type !== "numerical" || r.kind !== "numerical") {
        return {
          isCorrect: false,
          scoreRatio: 0,
          gradingMode: "deterministic",
          reason: "response_kind_mismatch",
        };
      }
      return gradeNumericalResponse(payload, r);
    },
    extractPlainText: (q) => {
      const payload = q.type_payload as NumericalPayload | null | undefined;
      const unit = payload?.type === "numerical" && payload.unit ? payload.unit : "";
      return [defaultExtractPlainText(q), unit].filter(Boolean).join(" ").trim();
    },
  },

  image_choice: {
    type: "image_choice",
    labelVi: "Chọn theo hình ảnh",
    labelEn: "Image Choice",
    isExamCompatible: true,
    // Deliberately excludes text-only write/spell modes!
    compatibleModes: ["flashcards", "learn", "practice", "review", "custom_practice"],
    supportsOffline: true,
    supportsPdfPaper: true,
    validateQuestion: (q) => validateChoiceOptions(q, { allowImageOnly: true }),
    validateResponse: (_q, r) => validateOptionsResponse(r),
    gradeResponse: (q, r, opts) => {
      if (r.kind !== "options") {
        return {
          isCorrect: false,
          scoreRatio: 0,
          gradingMode: "deterministic",
          reason: "response_kind_mismatch",
        };
      }
      const payload = q.type_payload as ImageChoicePayload | null | undefined;
      const correctCount = (q.options ?? []).filter((o) => o.is_correct).length;
      const isMulti =
        payload?.type === "image_choice"
          ? payload.selection_mode === "multiple"
          : correctCount > 1;
      return isMulti
        ? gradeMultipleChoiceByUuid(q.options ?? [], r.selected_option_ids, {
            partialCredit: opts?.partialCredit,
          })
        : gradeSingleChoiceByUuid(q.options ?? [], r.selected_option_ids);
    },
    extractPlainText: defaultExtractPlainText,
  },

  ordering: {
    type: "ordering",
    labelVi: "Sắp xếp thứ tự",
    labelEn: "Ordering",
    isExamCompatible: true,
    compatibleModes: ["learn", "practice", "review", "custom_practice"],
    supportsOffline: true,
    supportsPdfPaper: true,
    validateQuestion: (q) => {
      const errors: string[] = [];
      if (!q.prompt?.trim()) errors.push("Question prompt cannot be empty.");
      const payload = q.type_payload as OrderingPayload | null | undefined;
      if (!payload || payload.type !== "ordering" || !payload.items || payload.items.length < 2) {
        errors.push("Ordering questions require at least 2 items.");
      } else {
        const ids = new Set<string>();
        for (const item of payload.items) {
          if (!item.id?.trim()) errors.push("Each ordering item requires a stable id.");
          if (ids.has(item.id)) errors.push(`Duplicate ordering item id "${item.id}".`);
          ids.add(item.id);
          if (!item.text?.trim() && !item.image_url && !item.media_id) {
            errors.push(`Ordering item "${item.id}" must have text or an image.`);
          }
        }
      }
      return { valid: errors.length === 0, errors, warnings: [] };
    },
    validateResponse: (_q, r) =>
      r.kind === "ordering" && Array.isArray(r.ordered_item_ids)
        ? { valid: true }
        : { valid: false, error: 'Expected response kind "ordering".' },
    gradeResponse: (q, r, opts) => {
      const payload = q.type_payload as OrderingPayload | null | undefined;
      if (!payload || payload.type !== "ordering" || r.kind !== "ordering") {
        return {
          isCorrect: false,
          scoreRatio: 0,
          gradingMode: "deterministic",
          reason: "response_kind_mismatch",
        };
      }
      return gradeOrderingResponse(payload, r, {
        partialCredit: opts?.partialCredit,
      });
    },
    extractPlainText: (q) => {
      const payload = q.type_payload as OrderingPayload | null | undefined;
      const itemsText =
        payload?.type === "ordering"
          ? payload.items.map((i) => i.text).filter(Boolean).join(" ")
          : "";
      return [defaultExtractPlainText(q), itemsText].filter(Boolean).join(" ").trim();
    },
  },

  matching: {
    type: "matching",
    labelVi: "Ghép cặp",
    labelEn: "Matching",
    isExamCompatible: true,
    compatibleModes: ["learn", "practice", "match", "review", "custom_practice"],
    supportsOffline: true,
    supportsPdfPaper: true,
    validateQuestion: (q) => {
      const errors: string[] = [];
      if (!q.prompt?.trim()) errors.push("Question prompt cannot be empty.");
      const payload = q.type_payload as MatchingPayload | null | undefined;
      if (!payload || payload.type !== "matching" || !payload.pairs || payload.pairs.length < 2) {
        errors.push("Matching questions require at least 2 pairs.");
      } else {
        const leftIds = new Set<string>();
        const rightIds = new Set<string>();
        for (const pair of payload.pairs) {
          if (!pair.id?.trim() || !pair.right_id?.trim()) {
            errors.push("Each matching pair requires stable id and right_id.");
          }
          if (leftIds.has(pair.id)) errors.push(`Duplicate pair id "${pair.id}".`);
          if (rightIds.has(pair.right_id)) {
            errors.push(`Duplicate right_id "${pair.right_id}".`);
          }
          leftIds.add(pair.id);
          rightIds.add(pair.right_id);
        }
      }
      return { valid: errors.length === 0, errors, warnings: [] };
    },
    validateResponse: (_q, r) =>
      r.kind === "matching" && r.pairs && typeof r.pairs === "object"
        ? { valid: true }
        : { valid: false, error: 'Expected response kind "matching".' },
    gradeResponse: (q, r, opts) => {
      const payload = q.type_payload as MatchingPayload | null | undefined;
      if (!payload || payload.type !== "matching" || r.kind !== "matching") {
        return {
          isCorrect: false,
          scoreRatio: 0,
          gradingMode: "deterministic",
          reason: "response_kind_mismatch",
        };
      }
      return gradeMatchingResponse(payload, r, {
        partialCredit: opts?.partialCredit,
      });
    },
    extractPlainText: (q) => {
      const payload = q.type_payload as MatchingPayload | null | undefined;
      const pairsText =
        payload?.type === "matching"
          ? payload.pairs
              .map((p) => `${p.left_text} ${p.right_text}`)
              .join(" ")
          : "";
      return [defaultExtractPlainText(q), pairsText].filter(Boolean).join(" ").trim();
    },
  },

  image_hotspot: {
    type: "image_hotspot",
    labelVi: "Điểm nóng trên hình",
    labelEn: "Image Hotspot",
    isExamCompatible: true,
    compatibleModes: ["diagram", "learn", "practice", "review", "custom_practice"],
    supportsOffline: true,
    supportsPdfPaper: true,
    validateQuestion: (q) => {
      const errors: string[] = [];
      if (!q.prompt?.trim()) errors.push("Question prompt cannot be empty.");
      const payload = q.type_payload as ImageHotspotPayload | null | undefined;
      if (!payload || payload.type !== "image_hotspot") {
        errors.push("Image hotspot questions require an image_hotspot payload.");
      } else {
        if (!payload.image_url?.trim() && !payload.image_media_id) {
          errors.push("Image hotspot requires a base image URL or media_id.");
        }
        if (!payload.target_hotspots?.length) {
          errors.push("Image hotspot requires at least 1 target hotspot.");
        } else {
          for (const target of payload.target_hotspots) {
            if (!isValidHotspotGeometry(target.geometry)) {
              errors.push(`Hotspot "${target.label || target.id}" has invalid [0,1] geometry.`);
            }
          }
        }
      }
      return { valid: errors.length === 0, errors, warnings: [] };
    },
    validateResponse: (_q, r) =>
      r.kind === "hotspot" && Array.isArray(r.clicks)
        ? { valid: true }
        : { valid: false, error: 'Expected response kind "hotspot".' },
    gradeResponse: (q, r) => {
      const payload = q.type_payload as ImageHotspotPayload | null | undefined;
      if (!payload || payload.type !== "image_hotspot" || r.kind !== "hotspot") {
        return {
          isCorrect: false,
          scoreRatio: 0,
          gradingMode: "deterministic",
          reason: "response_kind_mismatch",
        };
      }
      return gradeImageHotspotResponse(payload, r);
    },
    extractPlainText: (q) => {
      const payload = q.type_payload as ImageHotspotPayload | null | undefined;
      const labels =
        payload?.type === "image_hotspot"
          ? payload.target_hotspots.map((t) => t.label).join(" ")
          : "";
      return [defaultExtractPlainText(q), labels].filter(Boolean).join(" ").trim();
    },
  },

  reading_passage: {
    type: "reading_passage",
    labelVi: "Đọc hiểu theo đoạn",
    labelEn: "Reading Passage",
    isExamCompatible: true,
    compatibleModes: ["learn", "practice", "review", "custom_practice"],
    supportsOffline: true,
    supportsPdfPaper: true,
    validateQuestion: (q) => {
      const errors: string[] = [];
      const payload = q.type_payload as ReadingPassagePayload | null | undefined;
      if (!payload || payload.type !== "reading_passage") {
        errors.push("Reading passage questions require a reading_passage payload.");
        return { valid: false, errors, warnings: [] };
      }
      if (!payload.passage_id && !q.passage_id && !payload.passage_text?.trim()) {
        errors.push("Reading passage question must reference a passage_id or inline passage_text.");
      }
      if (
        payload.sub_answer_kind === "single_choice" ||
        payload.sub_answer_kind === "multiple_choice" ||
        payload.sub_answer_kind === "true_false"
      ) {
        const sub = validateChoiceOptions(q, {
          exactTwo: payload.sub_answer_kind === "true_false",
        });
        errors.push(...sub.errors);
      } else {
        const hasAccepted =
          Boolean(q.back_text?.trim()) ||
          Boolean(q.accepted_answers?.some((a) => a.answer_text.trim().length > 0));
        if (!hasAccepted) {
          errors.push("Reading passage short-answer subquestion requires an accepted answer.");
        }
      }
      return { valid: errors.length === 0, errors, warnings: [] };
    },
    validateResponse: (q, r) => {
      const payload = q.type_payload as ReadingPassagePayload | null | undefined;
      const subKind = payload?.type === "reading_passage" ? payload.sub_answer_kind : "single_choice";
      if (subKind === "short_answer") {
        return r.kind === "text"
          ? { valid: true }
          : { valid: false, error: 'Expected response kind "text".' };
      }
      return validateOptionsResponse(r);
    },
    gradeResponse: (q, r, opts) => {
      const payload = q.type_payload as ReadingPassagePayload | null | undefined;
      const subKind = payload?.type === "reading_passage" ? payload.sub_answer_kind : "single_choice";
      return gradeSubInteraction(subKind, q, r, opts);
    },
    extractPlainText: (q) => {
      const payload = q.type_payload as ReadingPassagePayload | null | undefined;
      const passage =
        payload?.type === "reading_passage"
          ? [payload.passage_title, payload.passage_text].filter(Boolean).join(" ")
          : "";
      return [passage, defaultExtractPlainText(q)].filter(Boolean).join(" ").trim();
    },
  },

  listening: {
    type: "listening",
    labelVi: "Nghe hiểu",
    labelEn: "Listening",
    isExamCompatible: true,
    compatibleModes: ["learn", "practice", "spell", "review", "custom_practice"],
    supportsOffline: true,
    // Supported on paper with explicit audio-limitation / optional transcript notice
    supportsPdfPaper: true,
    validateQuestion: (q) => {
      const errors: string[] = [];
      const warnings: string[] = [];
      const payload = q.type_payload as ListeningPayload | null | undefined;
      if (!payload || payload.type !== "listening") {
        errors.push("Listening questions require a listening payload.");
        return { valid: false, errors, warnings };
      }
      const hasAudio = Boolean(
        payload.audio_media_id || payload.audio_url || q.audio_media_id || q.audio_url,
      );
      if (!hasAudio) {
        errors.push("Listening questions require an uploaded audio_media_id or audio_url.");
      }
      if (!payload.transcript?.trim() && !q.audio_transcript?.trim()) {
        warnings.push("No transcript attached; audio-only item cannot be printed verbatim on paper.");
      }
      if (
        payload.sub_answer_kind === "single_choice" ||
        payload.sub_answer_kind === "multiple_choice"
      ) {
        errors.push(...validateChoiceOptions(q).errors);
      } else if (payload.sub_answer_kind === "short_answer") {
        const hasAccepted =
          Boolean(q.back_text?.trim()) ||
          Boolean(q.accepted_answers?.some((a) => a.answer_text.trim().length > 0));
        if (!hasAccepted) {
          errors.push("Listening short-answer subquestion requires an accepted answer.");
        }
      }
      return { valid: errors.length === 0, errors, warnings };
    },
    validateResponse: (q, r) => {
      const payload = q.type_payload as ListeningPayload | null | undefined;
      const subKind = payload?.type === "listening" ? payload.sub_answer_kind : "single_choice";
      if (subKind === "short_answer") {
        return r.kind === "text"
          ? { valid: true }
          : { valid: false, error: 'Expected response kind "text".' };
      }
      if (subKind === "fill_in_blank") {
        return r.kind === "blanks"
          ? { valid: true }
          : { valid: false, error: 'Expected response kind "blanks".' };
      }
      return validateOptionsResponse(r);
    },
    gradeResponse: (q, r, opts) => {
      const payload = q.type_payload as ListeningPayload | null | undefined;
      const subKind = payload?.type === "listening" ? payload.sub_answer_kind : "single_choice";
      return gradeSubInteraction(subKind, q, r, opts);
    },
    extractPlainText: (q) => {
      const payload = q.type_payload as ListeningPayload | null | undefined;
      const transcript =
        payload?.type === "listening"
          ? payload.transcript ?? q.audio_transcript ?? ""
          : q.audio_transcript ?? "";
      return [defaultExtractPlainText(q), transcript].filter(Boolean).join(" ").trim();
    },
  },
};

export function getQuestionTypeDescriptor(
  type: QuestionType,
): QuestionTypeDescriptor {
  return QUESTION_TYPE_REGISTRY[type];
}

export function validateQuestionByType(
  question: QuestionLike,
): QuestionValidationResult {
  return QUESTION_TYPE_REGISTRY[question.question_type].validateQuestion(question);
}

export function validateResponseByType(
  question: QuestionLike,
  response: StructuredAnswerResponse,
): ResponseValidationResult {
  return QUESTION_TYPE_REGISTRY[question.question_type].validateResponse(
    question,
    response,
  );
}

export function gradeQuestionResponse(
  question: QuestionLike,
  response: StructuredAnswerResponse,
  options?: GradeOptions,
): QuestionGradeResult {
  return QUESTION_TYPE_REGISTRY[question.question_type].gradeResponse(
    question,
    response,
    options,
  );
}

/**
 * Returns compatible study modes for a specific question instance — additionally filtering
 * out text-only `write`/`spell` when a question has image-only content and no text answer.
 */
export function getCompatibleModesForQuestion(
  question: QuestionLike,
): StudyMode[] {
  const base = [...QUESTION_TYPE_REGISTRY[question.question_type].compatibleModes];
  const hasTextBackOrAccepted =
    Boolean(question.back_text?.trim()) ||
    Boolean(question.accepted_answers?.some((a) => a.answer_text.trim().length > 0));

  if (question.question_type === "flashcard" && !hasTextBackOrAccepted) {
    return base.filter((m) => m !== "write" && m !== "spell");
  }
  return base;
}

export function extractQuestionPlainText(question: QuestionLike): string {
  return QUESTION_TYPE_REGISTRY[question.question_type].extractPlainText(question);
}
