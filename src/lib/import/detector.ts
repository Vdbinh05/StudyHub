import type { ImportFormat } from "@/types/import";
import { getFileExtension, normalizeText } from "./text-utils";

const ASTERISK_OPTION_LINE_REGEX = /^\s*\*\s*(?:\(?[A-Ha-h]\)|[A-Ha-h]\s*[.)\]:\-])/m;
const INLINE_ANSWER_LINE_REGEX =
  /^\s*(?:ANSWER|ANS|CORRECT\s*ANSWER|ĐÁP\s*ÁN(?:\s*ĐÚNG)?|DAP\s*AN(?:\s*DUNG)?|ĐA|KEY)\s*[:.\-=]\s*[A-Ha-h]/im;
const END_KEY_HEADER_REGEX =
  /^\s*(?:BẢNG\s*ĐÁP\s*ÁN|BANG\s*DAP\s*AN|ĐÁP\s*ÁN|DAP\s*AN|ANSWER\s*KEY|KEY)\s*[:\-]?\s*$/im;
const OPTION_LINE_REGEX = /^\s*\*?\s*[A-Ha-h]\s*[.)\]:\-]\s+\S/m;
const QUESTION_PREFIX_REGEX =
  /^\s*(?:(?:Câu|Cau|Question|Q)\s*\d+\s*[:.)\-]|\d+\s*[.)])\s+\S/im;

export interface FormatDetectionInput {
  fileName?: string;
  textContent?: string;
  isBinary?: boolean;
  xlsxHeaders?: string[];
}

const WAYGROUND_HEADER_SIGNALS = new Set([
  "question text",
  "question type",
  "option 1",
  "option 2",
  "correct answer",
  "time in seconds",
  "image link",
  "answer explanation",
]);

/**
 * Deterministically detect whether an XLSX header row matches Wayground / Quizizz format.
 */
export function isWaygroundHeaders(headers: readonly string[]): boolean {
  const normalized = headers.map((h) => h.trim().toLowerCase());
  let hits = 0;
  for (const h of normalized) {
    if (WAYGROUND_HEADER_SIGNALS.has(h)) {
      hits += 1;
    }
  }
  const hasPrompt = normalized.includes("question text");
  const hasOption1 = normalized.includes("option 1");
  return (hasPrompt && hasOption1) || hits >= 3;
}

/**
 * Deterministically detect the ImportFormat from file extension and/or content.
 * Zero heuristics or AI: strictly ordered structural checks.
 */
export function detectImportFormat(input: FormatDetectionInput): ImportFormat {
  const ext = input.fileName ? getFileExtension(input.fileName) : "";

  if (ext === ".docx") return "docx_ooxml";
  if (ext === ".pdf") return "pdf_text";
  if (ext === ".xlsx") {
    if (input.xlsxHeaders && isWaygroundHeaders(input.xlsxHeaders)) {
      return "xlsx_wayground";
    }
    return "xlsx_generic";
  }
  if (ext === ".json") return "json";
  if (ext === ".csv") return "csv";
  if (ext === ".tsv") return "quizlet_tsv";

  const rawText = input.textContent ? normalizeText(input.textContent).trim() : "";
  if (!rawText) {
    return ext === ".txt" ? "txt_generic" : "eduquiz_txt";
  }

  // 1. Check JSON text (pasted JSON)
  if (
    (rawText.startsWith("{") && rawText.endsWith("}")) ||
    (rawText.startsWith("[") && rawText.endsWith("]"))
  ) {
    try {
      const parsed: unknown = JSON.parse(rawText);
      if (parsed && typeof parsed === "object") {
        return "json";
      }
    } catch {
      // Not valid JSON, continue checking text formats
    }
  }

  // 2. Check EduQuiz asterisk marker (*A., *B., etc.)
  if (ASTERISK_OPTION_LINE_REGEX.test(rawText)) {
    return "eduquiz_txt";
  }

  // 3. Check inline or end-of-document answer key
  if (INLINE_ANSWER_LINE_REGEX.test(rawText) || END_KEY_HEADER_REGEX.test(rawText)) {
    return "word_answer_key";
  }

  // 4. Check Quizlet TSV (majority of non-empty lines contain a tab and no MC option lines)
  const nonEmptyLines = rawText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const hasOptions = OPTION_LINE_REGEX.test(rawText);
  if (!hasOptions && nonEmptyLines.length > 0) {
    const tabLines = nonEmptyLines.filter((l) => l.includes("\t")).length;
    if (tabLines / nonEmptyLines.length >= 0.5) {
      return "quizlet_tsv";
    }

    // Check CSV pasted text (header row with commas + standard question/option words)
    const firstLineLower = nonEmptyLines[0].toLowerCase();
    if (
      firstLineLower.includes(",") &&
      (firstLineLower.includes("question") ||
        firstLineLower.includes("prompt") ||
        firstLineLower.includes("option") ||
        firstLineLower.includes("answer") ||
        firstLineLower.includes("câu hỏi"))
    ) {
      return "csv";
    }
  }

  // 5. Generic numbered questions with options
  if (hasOptions || QUESTION_PREFIX_REGEX.test(rawText)) {
    return "txt_generic";
  }

  return "txt_generic";
}
