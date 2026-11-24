import type { DifficultyLevel, QuestionType } from "@/types/domain";
import type {
  ColumnMapping,
  ImportValidationIssue,
  ParsedOption,
  ParsedQuestion,
} from "@/types/import";
import {
  generateStableId,
  indexToOptionLabel,
  isSafeHttpOrStorageUrl,
  normalizeForComparison,
  optionLabelToIndex,
} from "./text-utils";

/**
 * Deterministically infer a ColumnMapping from detected header names.
 * Supports Wayground / Quizizz headers, standard Vietnamese/English MC headers,
 * and Flashcard Term/Definition headers.
 */
export function suggestColumnMapping(headers: readonly string[]): ColumnMapping {
  const findHeader = (candidates: readonly string[]): string | null => {
    for (const candidate of candidates) {
      const match = headers.find(
        (h) => h.trim().toLowerCase() === candidate.toLowerCase(),
      );
      if (match) return match;
    }
    for (const candidate of candidates) {
      const match = headers.find((h) =>
        h.trim().toLowerCase().includes(candidate.toLowerCase()),
      );
      if (match) return match;
    }
    return null;
  };

  const prompt = findHeader([
    "question text",
    "question",
    "prompt",
    "câu hỏi",
    "cau hoi",
    "term",
    "front",
    "thuật ngữ",
    "mặt trước",
  ]);

  const questionType = findHeader([
    "question type",
    "type",
    "loại câu hỏi",
    "loai cau hoi",
  ]);

  const chapter = findHeader([
    "chapter",
    "chương",
    "chuong",
    "topic",
    "unit",
    "chủ đề",
    "part",
    "phần",
  ]);

  const optionA = findHeader([
    "option 1",
    "option a",
    "a",
    "choice 1",
    "choice a",
    "đáp án a",
    "lua chon a",
  ]);
  const optionB = findHeader([
    "option 2",
    "option b",
    "b",
    "choice 2",
    "choice b",
    "đáp án b",
    "lua chon b",
  ]);
  const optionC = findHeader([
    "option 3",
    "option c",
    "c",
    "choice 3",
    "choice c",
    "đáp án c",
    "lua chon c",
  ]);
  const optionD = findHeader([
    "option 4",
    "option d",
    "d",
    "choice 4",
    "choice d",
    "đáp án d",
    "lua chon d",
  ]);
  const optionE = findHeader([
    "option 5",
    "option e",
    "e",
    "choice 5",
    "choice e",
    "đáp án e",
  ]);
  const optionF = findHeader([
    "option 6",
    "option f",
    "f",
    "choice 6",
    "choice f",
    "đáp án f",
  ]);

  const correctAnswer = findHeader([
    "correct answer",
    "correct",
    "answer",
    "đáp án đúng",
    "dap an dung",
    "đáp án",
    "dap an",
    "key",
  ]);

  const backText = findHeader([
    "back text",
    "back",
    "definition",
    "định nghĩa",
    "mặt sau",
    "meaning",
  ]);

  const explanation = findHeader([
    "answer explanation",
    "explanation",
    "giải thích",
    "giai thich",
    "note",
    "ghi chú",
  ]);

  const hint = findHeader(["hint", "gợi ý", "goi y"]);
  const tags = findHeader(["tags", "tag", "nhãn", "nhan"]);
  const difficulty = findHeader(["difficulty", "độ khó", "do kho", "level"]);

  return {
    prompt,
    questionType,
    chapter,
    optionA,
    optionB,
    optionC,
    optionD,
    optionE,
    optionF,
    correctAnswer,
    backText,
    explanation,
    hint,
    tags,
    difficulty,
  };
}

function parseQuestionTypeValue(raw: string | null | undefined): QuestionType | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (
    v === "multiple choice" ||
    v === "single_choice" ||
    v === "single choice" ||
    v === "mcq" ||
    v === "quiz"
  ) {
    return "single_choice";
  }
  if (
    v === "checkbox" ||
    v === "multiple_choice" ||
    v === "multi_select" ||
    v === "multiple select" ||
    v === "multi"
  ) {
    return "multiple_choice";
  }
  if (v === "true_false" || v === "true/false" || v === "boolean" || v === "đúng/sai") {
    return "true_false";
  }
  if (v === "flashcard" || v === "card" || v === "thẻ") {
    return "flashcard";
  }
  if (
    v === "short_answer" ||
    v === "fill-in-the-blank" ||
    v === "fill in the blank" ||
    v === "open-ended" ||
    v === "short answer"
  ) {
    return "short_answer";
  }
  return null;
}

function parseDifficultyValue(raw: string | null | undefined): DifficultyLevel {
  if (!raw) return "medium";
  const v = raw.trim().toLowerCase();
  if (v === "easy" || v === "dễ" || v === "de" || v === "1") return "easy";
  if (v === "hard" || v === "khó" || v === "kho" || v === "3") return "hard";
  return "medium";
}

/**
 * Resolve a Correct Answer cell value deterministically against parsed options:
 *  (a) 1-based numeric index ("2", "1,3", "1; 4")
 *  (b) Option letter ("B", "A, C", "Option 2")
 *  (c) Exact trimmed (case-insensitive NFC) text match against option contents
 */
export function resolveTabularCorrectIndices(
  rawAnswer: string,
  options: readonly { label: string; content: string }[],
): { indices: number[]; invalidTokens: string[] } {
  const trimmed = rawAnswer.trim();
  if (!trimmed) return { indices: [], invalidTokens: [] };

  // First check exact full-string match against an option's text (handles answers containing commas!)
  const normalizedFull = normalizeForComparison(trimmed);
  const fullMatchIdx = options.findIndex(
    (opt) => normalizeForComparison(opt.content) === normalizedFull,
  );
  if (fullMatchIdx !== -1) {
    return { indices: [fullMatchIdx], invalidTokens: [] };
  }

  // Split by common multi-answer delimiters
  const tokens = trimmed
    .split(/[,;|&\/]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

  const resolvedSet = new Set<number>();
  const invalidTokens: string[] = [];

  for (const token of tokens) {
    // 1. Pure integer (1-based index: 1 -> 0, 2 -> 1, ...)
    if (/^\d+$/.test(token)) {
      const idx = Number.parseInt(token, 10) - 1;
      if (idx >= 0 && idx < options.length) {
        resolvedSet.add(idx);
      } else {
        invalidTokens.push(token);
      }
      continue;
    }

    // 2. "Option N" or "Option A"
    const optNumMatch = /^option\s+(\d+)$/i.exec(token);
    if (optNumMatch) {
      const idx = Number.parseInt(optNumMatch[1], 10) - 1;
      if (idx >= 0 && idx < options.length) {
        resolvedSet.add(idx);
      } else {
        invalidTokens.push(token);
      }
      continue;
    }

    const optLetterMatch = /^(?:option\s+)?([A-Ha-h])\.?$/i.exec(token);
    if (optLetterMatch) {
      const letter = optLetterMatch[1].toUpperCase();
      const byLabel = options.findIndex((o) => o.label === letter);
      if (byLabel !== -1) {
        resolvedSet.add(byLabel);
      } else {
        const idx = optionLabelToIndex(letter);
        if (idx >= 0 && idx < options.length) {
          resolvedSet.add(idx);
        } else {
          invalidTokens.push(token);
        }
      }
      continue;
    }

    // 3. Exact normalized text match against individual option content
    const normToken = normalizeForComparison(token);
    const textIdx = options.findIndex(
      (opt) => normalizeForComparison(opt.content) === normToken,
    );
    if (textIdx !== -1) {
      resolvedSet.add(textIdx);
    } else {
      invalidTokens.push(token);
    }
  }

  return {
    indices: Array.from(resolvedSet).sort((a, b) => a - b),
    invalidTokens,
  };
}

export interface TabularMappingInput {
  headers: string[];
  rows: string[][];
  mapping?: ColumnMapping;
  imageLinkColumn?: string | null;
  defaultChapter?: string;
  defaultTags?: string[];
  defaultQuestionType?: QuestionType;
}

export interface TabularMappingOutput {
  questions: ParsedQuestion[];
  issues: ImportValidationIssue[];
  mappingUsed: ColumnMapping;
}

/**
 * Convert tabular rows (from XLSX or CSV) into ParsedQuestion[] using a ColumnMapping.
 */
export function mapTabularRowsToQuestions(
  input: TabularMappingInput,
): TabularMappingOutput {
  const mapping = input.mapping ?? suggestColumnMapping(input.headers);
  const headerIndex = new Map<string, number>();
  input.headers.forEach((h, i) => {
    headerIndex.set(h, i);
    headerIndex.set(h.trim().toLowerCase(), i);
  });

  const getCell = (row: readonly string[], colName: string | null | undefined): string => {
    if (!colName) return "";
    const exact = headerIndex.get(colName);
    const idx =
      exact !== undefined ? exact : headerIndex.get(colName.trim().toLowerCase());
    if (idx === undefined || idx < 0 || idx >= row.length) return "";
    return (row[idx] ?? "").normalize("NFC").trim();
  };

  // Detect Image Link column if present (e.g., Wayground template)
  const imageCol =
    input.imageLinkColumn ??
    input.headers.find((h) => {
      const l = h.trim().toLowerCase();
      return l === "image link" || l === "image url" || l === "image";
    }) ??
    null;

  const optionCols = [
    mapping.optionA,
    mapping.optionB,
    mapping.optionC,
    mapping.optionD,
    mapping.optionE,
    mapping.optionF,
  ];

  const questions: ParsedQuestion[] = [];
  const globalIssues: ImportValidationIssue[] = [];

  for (let r = 0; r < input.rows.length; r += 1) {
    const row = input.rows[r];
    // Skip completely empty rows
    if (row.every((cell) => cell.trim().length === 0)) continue;

    const qIdx = questions.length;
    const qIssues: ImportValidationIssue[] = [];

    const prompt = getCell(row, mapping.prompt);
    const explicitType = parseQuestionTypeValue(getCell(row, mapping.questionType));
    const chapter = getCell(row, mapping.chapter) || input.defaultChapter || null;
    const explanation = getCell(row, mapping.explanation) || null;
    const hint = getCell(row, mapping.hint) || null;
    const difficulty = parseDifficultyValue(getCell(row, mapping.difficulty));
    const backText = getCell(row, mapping.backText) || null;

    const rawTags = getCell(row, mapping.tags);
    const rowTags = rawTags
      ? rawTags
          .split(/[,;|]/)
          .map((t) => t.trim())
          .filter(Boolean)
      : [];
    const tags = Array.from(new Set([...(input.defaultTags ?? []), ...rowTags]));

    const rawImgUrl = getCell(row, imageCol);
    let promptImageUrl: string | null = null;
    if (rawImgUrl) {
      if (isSafeHttpOrStorageUrl(rawImgUrl)) {
        promptImageUrl = rawImgUrl;
      } else {
        qIssues.push({
          id: generateStableId(),
          code: "INVALID_FORMAT",
          severity: "warning",
          questionIndex: qIdx,
          message: `Row ${r + 2}: Unsafe image URL "${rawImgUrl.slice(0, 40)}" was stripped for security.`,
        });
      }
    }

    // Collect options either from optionA..optionF or a single delimited optionsColumn
    const rawOptions: Array<{ label: string; content: string }> = [];
    for (let i = 0; i < optionCols.length; i += 1) {
      const content = getCell(row, optionCols[i]);
      if (content.length > 0) {
        rawOptions.push({
          label: indexToOptionLabel(rawOptions.length),
          content,
        });
      }
    }

    if (rawOptions.length === 0 && mapping.optionsColumn) {
      const packed = getCell(row, mapping.optionsColumn);
      if (packed) {
        const parts = packed
          .split(/\s*\|\s*|\n+/)
          .map((p) => p.trim())
          .filter(Boolean);
        parts.forEach((content, idx) => {
          rawOptions.push({ label: indexToOptionLabel(idx), content });
        });
      }
    }

    const rawCorrect = getCell(row, mapping.correctAnswer);

    // Decide question type
    let questionType: QuestionType =
      explicitType ?? input.defaultQuestionType ?? "single_choice";
    if (!explicitType) {
      if (rawOptions.length === 0 && (backText || rawCorrect)) {
        questionType = backText ? "flashcard" : "short_answer";
      }
    }

    if (questionType === "flashcard") {
      const finalBack = backText ?? rawCorrect ?? "";
      questions.push({
        tempId: generateStableId(),
        index: qIdx,
        chapter,
        questionType: "flashcard",
        prompt,
        promptImageUrl,
        backText: finalBack || null,
        explanation,
        hint,
        difficulty,
        tags,
        options: [],
        acceptedAnswers: finalBack
          ? [{ answerText: finalBack, matchMode: "case_insensitive" }]
          : [],
        detectedBy: finalBack ? ["column_mapping"] : ["none"],
        issues: qIssues,
      });
      continue;
    }

    if (questionType === "short_answer" && rawOptions.length === 0) {
      const answerItems = rawCorrect
        ? rawCorrect
            .split(/[;|]/)
            .map((a) => a.trim())
            .filter(Boolean)
        : [];
      questions.push({
        tempId: generateStableId(),
        index: qIdx,
        chapter,
        questionType: "short_answer",
        prompt,
        promptImageUrl,
        backText: answerItems[0] ?? null,
        explanation,
        hint,
        difficulty,
        tags,
        options: [],
        acceptedAnswers: answerItems.map((answerText) => ({
          answerText,
          matchMode: "case_insensitive",
        })),
        detectedBy: answerItems.length > 0 ? ["column_mapping"] : ["none"],
        issues: qIssues,
      });
      continue;
    }

    // Choice question: resolve correct answer
    const { indices, invalidTokens } = resolveTabularCorrectIndices(
      rawCorrect,
      rawOptions,
    );

    if (invalidTokens.length > 0) {
      qIssues.push({
        id: generateStableId(),
        code: "INVALID_CORRECT_ANSWER",
        severity: "error",
        questionIndex: qIdx,
        message: `Row ${r + 2}: Correct answer "${rawCorrect}" does not resolve to a valid option (invalid: ${invalidTokens.join(", ")}).`,
      });
    }

    const correctSet = new Set(indices);
    const options: ParsedOption[] = rawOptions.map((opt, idx) => ({
      id: generateStableId(),
      label: opt.label,
      content: opt.content,
      isCorrect: correctSet.has(idx),
      detectedBy: correctSet.has(idx) ? ["column_mapping"] : [],
    }));

    if (indices.length > 1) {
      questionType = "multiple_choice";
    } else if (
      questionType === "single_choice" &&
      options.length === 2 &&
      options.every((o) => /^(?:true|false|đúng|sai)$/i.test(o.content))
    ) {
      questionType = "true_false";
    }

    questions.push({
      tempId: generateStableId(),
      index: qIdx,
      chapter,
      questionType,
      prompt,
      promptImageUrl,
      explanation,
      hint,
      difficulty,
      tags,
      options,
      detectedBy: indices.length > 0 ? ["column_mapping"] : ["none"],
      issues: qIssues,
    });
  }

  return {
    questions,
    issues: globalIssues,
    mappingUsed: mapping,
  };
}
