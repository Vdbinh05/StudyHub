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
  stripUtf8Bom,
} from "./text-utils";

/**
 * Clean a spreadsheet/CSV header cell into a single-line NFC label with stray BOMs removed.
 */
export function cleanHeaderLabel(raw: string): string {
  return stripUtf8Bom(raw)
    .normalize("NFC")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Convert a 0-based column index to Excel column letters (0 -> "A", 5 -> "F", 26 -> "AA").
 */
export function colIndexToExcelLetter(zeroBasedIndex: number): string {
  let n = zeroBasedIndex + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out || "A";
}

/**
 * Ensure every column header is non-empty and globally unique (case-insensitively).
 * Unique headers are preserved verbatim; colliding headers are disambiguated
 * deterministically using their Excel column letter (e.g. `Header [G]`, `Header [J]`).
 */
export function deduplicateHeaders(rawHeaders: readonly string[]): string[] {
  const cleaned = rawHeaders.map(
    (h, idx) => cleanHeaderLabel(h) || `Column ${idx + 1}`,
  );
  const counts = new Map<string, number>();
  for (const label of cleaned) {
    const key = label.toLowerCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const usedLower = new Set<string>();
  return cleaned.map((label, idx) => {
    const key = label.toLowerCase();
    let candidate =
      (counts.get(key) ?? 0) > 1
        ? `${label} [${colIndexToExcelLetter(idx)}]`
        : label;
    if (usedLower.has(candidate.toLowerCase())) {
      let suffix = 2;
      while (usedLower.has(`${candidate} (${suffix})`.toLowerCase())) {
        suffix += 1;
      }
      candidate = `${candidate} (${suffix})`;
    }
    usedLower.add(candidate.toLowerCase());
    return candidate;
  });
}

function foldHeaderForMatching(raw: string): string {
  return cleanHeaderLabel(raw)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/\s+/g, " ")
    .trim();
}

function isExplanationSubcolumn(folded: string): boolean {
  return /\b(?:giai thich|explanation|note|ghi chu)\b/.test(folded);
}

function isContentSubcolumn(folded: string): boolean {
  return /[—–\-:|]\s*(?:noi dung|text|content)\b/.test(folded);
}

function stripContentSubcolumn(folded: string): string {
  return folded
    .replace(/^\[[a-z]+\]\s*/i, "")
    .replace(/\s*\[[a-z]+\]\s*$/i, "")
    .replace(/\s*[—–\-:|]\s*(?:noi dung|text|content)\s*$/, "")
    .trim();
}

function hasWordBoundaryPhrase(haystack: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`).test(haystack);
}

/**
 * Deterministically infer a ColumnMapping from detected header names.
 * Supports institutional 2-row merged Vietnamese templates, Wayground / Quizizz headers,
 * standard Vietnamese/English MC headers, and Flashcard Term/Definition headers.
 *
 * Strictly avoids naive 1-letter `.includes()` matching and prevents assigning the same
 * column index to multiple fields.
 */
export function suggestColumnMapping(headers: readonly string[]): ColumnMapping {
  const foldedHeaders = headers.map((h) => foldHeaderForMatching(h));
  const usedIndices = new Set<number>();

  const pickBest = (
    scorer: (folded: string, base: string, hasContentSub: boolean) => number,
  ): string | null => {
    let bestIdx = -1;
    let bestScore = 0;

    for (let i = 0; i < headers.length; i += 1) {
      if (usedIndices.has(i)) continue;
      const folded = foldedHeaders[i];
      if (!folded) continue;
      const hasContentSub = isContentSubcolumn(folded);
      const base = stripContentSubcolumn(folded);
      const score = scorer(folded, base, hasContentSub);
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }

    if (bestIdx !== -1) {
      usedIndices.add(bestIdx);
      return headers[bestIdx];
    }
    return null;
  };

  // 1. Prompt / Question / Term
  const promptExact = new Set([
    "noi dung cau hoi",
    "question text",
    "question",
    "prompt",
    "cau hoi",
    "term",
    "front",
    "thuat ngu",
    "mat truoc",
  ]);
  const promptPhrases = [
    "noi dung cau hoi",
    "question text",
    "cau hoi",
    "question",
    "prompt",
    "thuat ngu",
    "mat truoc",
  ];
  const prompt = pickBest((folded, base, hasContentSub) => {
    if (isExplanationSubcolumn(folded)) return 0;
    if (
      /\b(?:ma|code|id|dang|loai|type|dap an|phuong an|option|choice|answer|key|tag|tags|nhan|chapter|chuong|difficulty|do kho)\b/.test(
        base,
      )
    ) {
      return 0;
    }
    if (promptExact.has(base)) return hasContentSub ? 110 : 100;
    for (const phrase of promptPhrases) {
      if (hasWordBoundaryPhrase(base, phrase)) {
        return hasContentSub ? 80 : 70;
      }
    }
    return 0;
  });

  // 2. Question Type (e.g., "Dạng câu hỏi", "Question Type")
  const typeExact = new Set([
    "question type",
    "question_type",
    "dang cau hoi",
    "loai cau hoi",
    "type",
  ]);
  const questionType = pickBest((folded, base) => {
    if (isExplanationSubcolumn(folded)) return 0;
    if (typeExact.has(base)) return 100;
    if (
      hasWordBoundaryPhrase(base, "question type") ||
      hasWordBoundaryPhrase(base, "dang cau hoi") ||
      hasWordBoundaryPhrase(base, "loai cau hoi")
    ) {
      return 80;
    }
    return 0;
  });

  // 3. Option A..F (resolved BEFORE correctAnswer so "Đáp án A" never maps to correctAnswer)
  const pickOption = (slotIndex: number): string | null => {
    const num = slotIndex + 1;
    const letter = String.fromCharCode(97 + slotIndex); // a..f
    const exactCandidates = new Set([
      `option ${num}`,
      `option ${letter}`,
      `option_${num}`,
      `option_${letter}`,
      `choice ${num}`,
      `choice ${letter}`,
      `phuong an lua chon ${num}`,
      `phuong an lua chon ${letter}`,
      `phuong an ${num}`,
      `phuong an ${letter}`,
      `lua chon ${num}`,
      `lua chon ${letter}`,
      `dap an ${num}`,
      `dap an ${letter}`,
      `answer ${num}`,
      `answer ${letter}`,
      `pa${num}`,
      `pa ${num}`,
      `pa${letter}`,
      `pa ${letter}`,
    ]);
    const singleLetterExact = new Set([letter, `${letter}.`, `(${letter})`]);
    const numRegex = new RegExp(
      `(?:^|[^a-z0-9])(?:option|choice|phuong an(?:\\s+lua chon)?|lua chon|dap an|pa)\\s*${num}(?:$|[^a-z0-9])`,
    );
    const letterRegex = new RegExp(
      `(?:^|[^a-z0-9])(?:option|choice|phuong an(?:\\s+lua chon)?|lua chon|dap an)\\s*${letter}(?:$|[^a-z0-9])`,
    );

    return pickBest((folded, base, hasContentSub) => {
      if (isExplanationSubcolumn(folded)) return 0;
      if (/\b(?:hint|goi y|correct|dung)\b/.test(base)) return 0;
      if (exactCandidates.has(base)) return hasContentSub ? 110 : 100;
      if (singleLetterExact.has(base)) return hasContentSub ? 95 : 85;
      if (numRegex.test(base) || letterRegex.test(base)) {
        return hasContentSub ? 80 : 70;
      }
      return 0;
    });
  };

  const optionA = pickOption(0);
  const optionB = pickOption(1);
  const optionC = pickOption(2);
  const optionD = pickOption(3);
  const optionE = pickOption(4);
  const optionF = pickOption(5);

  // 4. Correct Answer
  const correctExact = new Set([
    "correct answer",
    "correct_answer",
    "dap an dung",
    "dap an",
    "correct",
    "answer",
    "answer key",
    "key",
    "da",
  ]);
  const correctAnswer = pickBest((folded, base) => {
    if (isExplanationSubcolumn(folded)) return 0;
    if (/\b(?:dap an|answer)\s*[a-f1-6]\b/.test(base)) return 0;
    if (correctExact.has(base)) return 100;
    if (
      hasWordBoundaryPhrase(base, "correct answer") ||
      hasWordBoundaryPhrase(base, "dap an dung") ||
      hasWordBoundaryPhrase(base, "answer key") ||
      hasWordBoundaryPhrase(base, "dap an")
    ) {
      return 75;
    }
    return 0;
  });

  // 5. Back Text (Flashcards)
  const backExact = new Set([
    "back text",
    "back_text",
    "back",
    "definition",
    "dinh nghia",
    "mat sau",
    "meaning",
  ]);
  const backText = pickBest((folded, base) => {
    if (isExplanationSubcolumn(folded)) return 0;
    if (backExact.has(base)) return 100;
    if (
      hasWordBoundaryPhrase(base, "back text") ||
      hasWordBoundaryPhrase(base, "definition") ||
      hasWordBoundaryPhrase(base, "dinh nghia") ||
      hasWordBoundaryPhrase(base, "mat sau")
    ) {
      return 75;
    }
    return 0;
  });

  // 6. Question-level Explanation (prefer question explanation, never option-level explanation)
  const explanationExact = new Set([
    "answer explanation",
    "explanation",
    "giai thich",
    "note",
    "ghi chu",
    "loi giai",
  ]);
  const explanation = pickBest((folded, base) => {
    // Reject per-option explanation subcolumns (e.g. "Phương án lựa chọn 1 — Giải thích")
    if (/\b(?:phuong an|option|choice|lua chon)\b/.test(folded)) return 0;
    if (/\bdap an\s*[a-f1-6]\b/.test(folded)) return 0;
    if (explanationExact.has(folded) || explanationExact.has(base)) return 100;
    if (/[—–\-:|]\s*(?:giai thich|explanation|loi giai)\b/.test(folded)) return 95;
    if (
      hasWordBoundaryPhrase(folded, "answer explanation") ||
      hasWordBoundaryPhrase(folded, "explanation") ||
      hasWordBoundaryPhrase(folded, "giai thich") ||
      hasWordBoundaryPhrase(folded, "ghi chu")
    ) {
      return 75;
    }
    return 0;
  });

  // 7. Chapter / Topic
  const chapterExact = new Set([
    "chapter",
    "chuong",
    "topic",
    "unit",
    "chu de",
    "part",
    "phan",
    "module",
    "section",
  ]);
  const chapter = pickBest((folded, base) => {
    if (isExplanationSubcolumn(folded)) return 0;
    if (chapterExact.has(base)) return 100;
    if (
      hasWordBoundaryPhrase(base, "chapter") ||
      hasWordBoundaryPhrase(base, "chuong") ||
      hasWordBoundaryPhrase(base, "chu de") ||
      hasWordBoundaryPhrase(base, "topic")
    ) {
      return 75;
    }
    return 0;
  });

  // 8. Hint
  const hintExact = new Set(["hint", "goi y"]);
  const hint = pickBest((folded, base) => {
    if (hintExact.has(base)) return 100;
    if (hasWordBoundaryPhrase(base, "hint") || hasWordBoundaryPhrase(base, "goi y")) {
      return 75;
    }
    return 0;
  });

  // 9. Tags
  const tagsExact = new Set(["tags", "tag", "nhan", "labels"]);
  const tags = pickBest((folded, base) => {
    if (tagsExact.has(base)) return 100;
    if (hasWordBoundaryPhrase(base, "tags") || hasWordBoundaryPhrase(base, "nhan")) {
      return 75;
    }
    return 0;
  });

  // 10. Difficulty
  const diffExact = new Set(["difficulty", "do kho", "level", "muc do"]);
  const difficulty = pickBest((folded, base) => {
    if (diffExact.has(base)) return 100;
    if (
      hasWordBoundaryPhrase(base, "difficulty") ||
      hasWordBoundaryPhrase(base, "do kho")
    ) {
      return 75;
    }
    return 0;
  });

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

export function parseQuestionTypeValue(
  raw: string | null | undefined,
): QuestionType | null {
  if (!raw) return null;
  const v = foldHeaderForMatching(raw);
  if (
    v === "sc" ||
    v === "single" ||
    v === "single_choice" ||
    v === "single choice" ||
    v === "multiple_choice_single" ||
    v === "multiple choice single" ||
    v === "multiple choice" ||
    v === "mcq" ||
    v === "quiz" ||
    v === "mot dap an" ||
    v === "trac nghiem 1 dap an"
  ) {
    return "single_choice";
  }
  if (
    v === "mc" ||
    v === "checkbox" ||
    v === "multiple_choice" ||
    v === "multiple_choice_multi" ||
    v === "multiple choice multi" ||
    v === "multi_select" ||
    v === "multiple select" ||
    v === "multi" ||
    v === "nhieu dap an" ||
    v === "trac nghiem nhieu dap an"
  ) {
    return "multiple_choice";
  }
  if (
    v === "tf" ||
    v === "t/f" ||
    v === "true_false" ||
    v === "true/false" ||
    v === "true false" ||
    v === "boolean" ||
    v === "dung/sai" ||
    v === "dung sai"
  ) {
    return "true_false";
  }
  if (
    v === "fc" ||
    v === "flashcard" ||
    v === "card" ||
    v === "the" ||
    v === "the ghi nho"
  ) {
    return "flashcard";
  }
  if (
    v === "sa" ||
    v === "short" ||
    v === "short_answer" ||
    v === "fill-in-the-blank" ||
    v === "fill in the blank" ||
    v === "open-ended" ||
    v === "short answer" ||
    v === "tu luan" ||
    v === "dien khuyet"
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
 * Strip redundant leading option letter prefixes (e.g. `a) `, `A. `, `b) `) from a row's
 * options ONLY when all non-empty options carry prefixes matching their sequential option labels.
 * Preserves technical terms (e.g., "AS.", "CB.", "FL 300") completely intact.
 */
function stripRedundantOptionPrefixes(
  rawOptions: Array<{ label: string; content: string }>,
): Array<{ label: string; content: string; originalContent: string }> {
  if (rawOptions.length < 2) {
    return rawOptions.map((o) => ({ ...o, originalContent: o.content }));
  }

  const parsed = rawOptions.map((opt) => {
    const m = /^([A-Ha-h])\s*[.)]\s+(.+)$/s.exec(opt.content);
    if (m && m[1].toUpperCase() === opt.label && m[2].trim().length > 0) {
      return { ...opt, stripped: m[2].trim(), matched: true };
    }
    return { ...opt, stripped: opt.content, matched: false };
  });

  if (parsed.every((p) => p.matched)) {
    return parsed.map((p) => ({
      label: p.label,
      content: p.stripped,
      originalContent: p.content,
    }));
  }

  return rawOptions.map((o) => ({ ...o, originalContent: o.content }));
}

const TABULAR_PROMPT_NUMBER_PREFIX_REGEX =
  /^(?:(?:Câu|Cau|Question|Q)\s*\d{1,5}\s*[:.)\-–—]|\d{1,5}\s*[.)])\s+(.+)$/is;

/**
 * Convert tabular rows (from XLSX or CSV) into ParsedQuestion[] using a ColumnMapping.
 */
export function mapTabularRowsToQuestions(
  input: TabularMappingInput,
): TabularMappingOutput {
  const uniqueHeaders = deduplicateHeaders(input.headers);
  const mapping = input.mapping ?? suggestColumnMapping(uniqueHeaders);
  const headerIndex = new Map<string, number>();

  // Preserve exact original header keys AND deduplicated keys without ever overwriting an earlier column!
  input.headers.forEach((h, i) => {
    const cleaned = cleanHeaderLabel(h);
    if (h && !headerIndex.has(h)) headerIndex.set(h, i);
    if (cleaned && !headerIndex.has(cleaned)) headerIndex.set(cleaned, i);
    const lower = cleaned.toLowerCase();
    if (lower && !headerIndex.has(lower)) headerIndex.set(lower, i);
  });
  uniqueHeaders.forEach((h, i) => {
    if (!headerIndex.has(h)) headerIndex.set(h, i);
    const lower = h.toLowerCase();
    if (!headerIndex.has(lower)) headerIndex.set(lower, i);
  });

  const getCell = (row: readonly string[], colName: string | null | undefined): string => {
    if (!colName) return "";
    const exact = headerIndex.get(colName);
    const cleaned = cleanHeaderLabel(colName);
    const idx =
      exact !== undefined
        ? exact
        : (headerIndex.get(cleaned) ?? headerIndex.get(cleaned.toLowerCase()));
    if (idx === undefined || idx < 0 || idx >= row.length) return "";
    return stripUtf8Bom(row[idx] ?? "").normalize("NFC").trim();
  };

  // Detect Image Link column if present (e.g., Wayground template or Vietnamese image header)
  const imageCol =
    input.imageLinkColumn ??
    uniqueHeaders.find((h) => {
      const f = foldHeaderForMatching(h);
      if (isExplanationSubcolumn(f)) return false;
      const base = stripContentSubcolumn(f);
      return (
        base === "image link" ||
        base === "image url" ||
        base === "image" ||
        base === "hinh anh" ||
        base === "link anh" ||
        base === "anh minh hoa"
      );
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

  // Determine deterministically whether this sheet prefixes question prompts with "1. ", "2. ", etc.
  let nonEmptyPromptCount = 0;
  let numberedPromptCount = 0;
  for (const row of input.rows) {
    if (row.every((cell) => stripUtf8Bom(cell).trim().length === 0)) continue;
    const p = getCell(row, mapping.prompt);
    if (!p) continue;
    nonEmptyPromptCount += 1;
    if (TABULAR_PROMPT_NUMBER_PREFIX_REGEX.test(p)) {
      numberedPromptCount += 1;
    }
  }
  const shouldStripPromptNumbers =
    nonEmptyPromptCount >= 2 && numberedPromptCount / nonEmptyPromptCount >= 0.7;

  const questions: ParsedQuestion[] = [];
  const globalIssues: ImportValidationIssue[] = [];

  for (let r = 0; r < input.rows.length; r += 1) {
    const row = input.rows[r];
    // Skip completely empty rows
    if (row.every((cell) => stripUtf8Bom(cell).trim().length === 0)) continue;

    const qIdx = questions.length;
    const qIssues: ImportValidationIssue[] = [];

    let prompt = getCell(row, mapping.prompt);
    if (shouldStripPromptNumbers && prompt) {
      const pm = TABULAR_PROMPT_NUMBER_PREFIX_REGEX.exec(prompt);
      if (pm && pm[1].trim().length > 0) {
        prompt = pm[1].trim();
      }
    }

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
    const collectedOptions: Array<{ label: string; content: string }> = [];
    for (let i = 0; i < optionCols.length; i += 1) {
      const content = getCell(row, optionCols[i]);
      if (content.length > 0) {
        collectedOptions.push({
          label: indexToOptionLabel(collectedOptions.length),
          content,
        });
      }
    }

    if (collectedOptions.length === 0 && mapping.optionsColumn) {
      const packed = getCell(row, mapping.optionsColumn);
      if (packed) {
        const parts = packed
          .split(/\s*\|\s*|\n+/)
          .map((p) => p.trim())
          .filter(Boolean);
        parts.forEach((content, idx) => {
          collectedOptions.push({ label: indexToOptionLabel(idx), content });
        });
      }
    }

    const rawOptions = stripRedundantOptionPrefixes(collectedOptions);
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

    // Choice question: resolve correct answer against cleaned options first,
    // falling back to original pre-strip option text if the answer cell also had "a) ..." prefix
    let resolved = resolveTabularCorrectIndices(rawCorrect, rawOptions);
    if (resolved.indices.length === 0 && resolved.invalidTokens.length > 0) {
      const fallback = resolveTabularCorrectIndices(
        rawCorrect,
        rawOptions.map((o) => ({ label: o.label, content: o.originalContent })),
      );
      if (fallback.indices.length > 0 && fallback.invalidTokens.length === 0) {
        resolved = fallback;
      }
    }
    const { indices, invalidTokens } = resolved;

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
