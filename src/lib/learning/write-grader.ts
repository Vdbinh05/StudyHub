import type { AnswerMatchMode, Question } from "@/types/domain";

export interface AcceptedWriteAnswer {
  answer_text: string;
  normalized_answer?: string;
  match_mode?: AnswerMatchMode;
}

export interface WriteNormalizationOptions {
  ignoreCase?: boolean;
  collapseWhitespace?: boolean;
  ignorePunctuation?: boolean;
  ignoreDiacritics?: boolean;
}

export interface WriteGradeOptions extends WriteNormalizationOptions {
  strict?: boolean;
}

export interface WriteGradeResult {
  isCorrect: boolean;
  matchedAnswer: string | null;
  normalizedUserAnswer: string;
}

/**
 * Strip Vietnamese and Latin combining diacritics deterministically.
 */
function stripDiacritics(input: string): string {
  return input
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .normalize("NFC");
}

/**
 * Deterministically normalize a typed text answer according to explicit flags.
 * Zero fuzzy matching or Levenshtein guessing.
 */
export function normalizeWriteText(
  input: string,
  options: WriteNormalizationOptions = {},
): string {
  let result = input.normalize("NFC").trim();

  if (options.ignoreDiacritics) {
    result = stripDiacritics(result);
  }
  if (options.ignorePunctuation) {
    // Remove punctuation characters while keeping letters, numbers, and whitespace
    result = result.replace(/[^\p{L}\p{N}\s]/gu, " ");
  }
  if (options.collapseWhitespace ?? true) {
    result = result.replace(/\s+/g, " ").trim();
  }
  if (options.ignoreCase) {
    result = result.toLowerCase();
  }

  return result;
}

function parseNumericStrict(input: string): number | null {
  const trimmed = input.trim().replace(/\s+/g, "");
  if (!trimmed) return null;
  // Support standard decimal numbers (with optional leading sign)
  if (!/^[+-]?(\d+(\.\d+)?|\.\d+)$/.test(trimmed)) {
    return null;
  }
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/**
 * Deterministically grade a user's written answer against pre-defined accepted answers.
 */
export function gradeWriteAnswer(
  userInput: string,
  acceptedAnswers: readonly AcceptedWriteAnswer[],
  options: WriteGradeOptions = {},
): WriteGradeResult {
  const trimmedInput = userInput.trim();
  if (!trimmedInput || acceptedAnswers.length === 0) {
    return {
      isCorrect: false,
      matchedAnswer: null,
      normalizedUserAnswer: "",
    };
  }

  const strict = options.strict ?? false;
  const fallbackNormalized = normalizeWriteText(trimmedInput, {
    ignoreCase: !strict && (options.ignoreCase ?? true),
    collapseWhitespace: !strict && (options.collapseWhitespace ?? true),
    ignorePunctuation: !strict && (options.ignorePunctuation ?? true),
    ignoreDiacritics: !strict && (options.ignoreDiacritics ?? false),
  });

  for (const accepted of acceptedAnswers) {
    const mode: AnswerMatchMode = accepted.match_mode ?? "case_insensitive";

    if (mode === "numeric") {
      const userNum = parseNumericStrict(trimmedInput);
      const targetNum = parseNumericStrict(accepted.answer_text);
      if (userNum !== null && targetNum !== null && userNum === targetNum) {
        return {
          isCorrect: true,
          matchedAnswer: accepted.answer_text,
          normalizedUserAnswer: String(userNum),
        };
      }
      continue;
    }

    if (strict || mode === "exact") {
      const normUser = trimmedInput.normalize("NFC");
      const normTarget = accepted.answer_text.trim().normalize("NFC");
      if (normUser === normTarget) {
        return {
          isCorrect: true,
          matchedAnswer: accepted.answer_text,
          normalizedUserAnswer: normUser,
        };
      }
      continue;
    }

    const normOpts: WriteNormalizationOptions = {
      ignoreCase: options.ignoreCase ?? true,
      collapseWhitespace: options.collapseWhitespace ?? true,
      ignorePunctuation: options.ignorePunctuation ?? true,
      ignoreDiacritics:
        mode === "ignore_diacritics" || (options.ignoreDiacritics ?? false),
    };

    const normUser = normalizeWriteText(trimmedInput, normOpts);
    const normTarget = normalizeWriteText(accepted.answer_text, normOpts);

    if (normUser.length > 0 && normUser === normTarget) {
      return {
        isCorrect: true,
        matchedAnswer: accepted.answer_text,
        normalizedUserAnswer: normUser,
      };
    }
  }

  return {
    isCorrect: false,
    matchedAnswer: null,
    normalizedUserAnswer: fallbackNormalized,
  };
}

/**
 * Determine whether expected answers represent long/open-ended definitions
 * where offering explicit self-assessment ("Tôi trả lời đúng" / "Cần ôn lại") is helpful.
 */
export function isLongOpenAnswer(expectedAnswers: readonly string[]): boolean {
  if (expectedAnswers.length === 0) return false;
  return expectedAnswers.every((answer) => {
    const trimmed = answer.trim();
    if (trimmed.includes("\n")) return true;
    if (trimmed.length >= 80) return true;
    const words = trimmed.split(/\s+/).filter(Boolean);
    return words.length >= 12;
  });
}

/**
 * Extract deterministic accepted answers for Write mode from any Question type
 * (short_answer accepted_answers, flashcard back_text, or MC correct options).
 */
export function getExpectedWriteAnswers(
  question: Pick<
    Question,
    "question_type" | "back_text" | "accepted_answers" | "options"
  >,
): AcceptedWriteAnswer[] {
  if (question.accepted_answers && question.accepted_answers.length > 0) {
    return question.accepted_answers.map((a) => ({
      answer_text: a.answer_text,
      normalized_answer: a.normalized_answer,
      match_mode: a.match_mode,
    }));
  }

  if (question.back_text && question.back_text.trim().length > 0) {
    return [
      {
        answer_text: question.back_text.trim(),
        match_mode: "case_insensitive",
      },
    ];
  }

  const correctOpts = (question.options ?? []).filter((o) => o.is_correct);
  if (correctOpts.length > 0) {
    return correctOpts.map((o) => ({
      answer_text: o.content.trim(),
      match_mode: "case_insensitive",
    }));
  }

  return [];
}
