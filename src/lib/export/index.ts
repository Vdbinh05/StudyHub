import ExcelJS from "exceljs";
import Papa from "papaparse";
import type { Question, StudySet } from "@/types/domain";
import { indexToOptionLabel, sanitizeFileName } from "@/lib/import/text-utils";

export {
  exportStudySetToPdf,
  type PdfAnswerKeyEntry,
  type PdfEmbeddedImage,
  type PdfExportMode,
  type PdfExportOption,
  type PdfExportOptions,
  type PdfExportQuestion,
  type PdfExportResult,
  type PdfOrientation,
} from "./pdf-exporter";

export type StudySetExportFormat = "json" | "csv" | "txt" | "xlsx";

export interface StudySetExportOptions {
  format: StudySetExportFormat;
  /** For txt: "eduquiz" (*B.) or "answer_key" (Đáp án: B). Default "eduquiz". */
  txtStyle?: "eduquiz" | "answer_key";
  /** For xlsx: "standard" or "wayground". Default "standard". */
  xlsxStyle?: "standard" | "wayground";
  includeExplanations?: boolean;
  includeTags?: boolean;
  includeDifficulty?: boolean;
  includeChapters?: boolean;
}

export interface StudySetExportOutput {
  content: Uint8Array;
  fileName: string;
  contentType: string;
}

function buildSafeBaseFileName(title: string): string {
  const slug = sanitizeFileName(title)
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9\u00C0-\u024F\u1E00-\u1EFF\-_]/g, "")
    .slice(0, 80);
  return slug || "studyhub-export";
}

function sortedOptions(q: Question) {
  return [...(q.options ?? [])].sort((a, b) => a.position - b.position);
}

function exportToJson(
  studySet: Pick<StudySet, "id" | "title" | "description" | "subject" | "set_type">,
  questions: readonly Question[],
  opts: StudySetExportOptions,
): StudySetExportOutput {
  const payload = {
    schema_version: "1.0",
    exported_at: new Date().toISOString(),
    study_set: {
      title: studySet.title,
      description: studySet.description,
      subject: studySet.subject,
      set_type: studySet.set_type,
    },
    questions: questions.map((q) => {
      const options = sortedOptions(q).map((opt, idx) => ({
        label: opt.label || indexToOptionLabel(idx),
        content: opt.content,
        isCorrect: opt.is_correct,
        imageUrl: opt.image_url,
      }));
      const acceptedAnswers = (q.accepted_answers ?? []).map((a) => ({
        answerText: a.answer_text,
        matchMode: a.match_mode,
      }));

      return {
        questionType: q.question_type,
        chapter: opts.includeChapters === false ? null : q.chapter,
        prompt: q.prompt,
        promptImageUrl: q.prompt_image_url,
        backText: q.back_text,
        backImageUrl: q.back_image_url,
        explanation: opts.includeExplanations === false ? null : q.explanation,
        hint: q.hint,
        difficulty: opts.includeDifficulty === false ? "medium" : q.difficulty,
        tags:
          opts.includeTags === false
            ? []
            : (q.tags ?? []).map((t) => t.name),
        options,
        acceptedAnswers,
      };
    }),
  };

  const text = JSON.stringify(payload, null, 2);
  return {
    content: new TextEncoder().encode(text),
    fileName: `${buildSafeBaseFileName(studySet.title)}.json`,
    contentType: "application/json; charset=utf-8",
  };
}

/**
 * Neutralize OWASP CSV Formula Injection (CWE-1236) triggers (`=`, `+`, `-`, `@`, `\t`, `\r`)
 * by prefixing a single quote `'`, while preserving pure negative numeric literals (e.g. `-1`, `-273.15`).
 */
export function sanitizeCsvCell(value: string): string {
  if (!value) return value;
  if (/^[=+\-@\t\r]/.test(value) && !/^-\d+(?:\.\d+)?$/.test(value)) {
    return `'${value}`;
  }
  return value;
}

function exportToCsv(
  studySet: Pick<StudySet, "title">,
  questions: readonly Question[],
  opts: StudySetExportOptions,
): StudySetExportOutput {
  const headers = [
    "Chapter",
    "Question Type",
    "Question",
    "Option A",
    "Option B",
    "Option C",
    "Option D",
    "Option E",
    "Option F",
    "Correct Answer",
    "Back Text",
    "Explanation",
    "Hint",
    "Difficulty",
    "Tags",
  ];

  const rows: string[][] = [headers];

  for (const q of questions) {
    const options = sortedOptions(q);
    const optCells = Array.from({ length: 6 }, (_, idx) =>
      sanitizeCsvCell(options[idx]?.content ?? ""),
    );
    const correctLetters = options
      .map((opt, idx) =>
        opt.is_correct ? opt.label || indexToOptionLabel(idx) : null,
      )
      .filter((v): v is string => v !== null)
      .join(", ");

    const correctValue =
      options.length > 0
        ? correctLetters
        : (q.accepted_answers?.map((a) => a.answer_text).join("; ") ??
          q.back_text ??
          "");

    rows.push([
      sanitizeCsvCell(opts.includeChapters === false ? "" : (q.chapter ?? "")),
      q.question_type,
      sanitizeCsvCell(q.prompt),
      ...optCells,
      sanitizeCsvCell(correctValue),
      sanitizeCsvCell(q.back_text ?? ""),
      sanitizeCsvCell(
        opts.includeExplanations === false ? "" : (q.explanation ?? ""),
      ),
      sanitizeCsvCell(q.hint ?? ""),
      opts.includeDifficulty === false ? "" : q.difficulty,
      sanitizeCsvCell(
        opts.includeTags === false
          ? ""
          : (q.tags ?? []).map((t) => t.name).join(", "),
      ),
    ]);
  }

  // Prefix UTF-8 BOM so Excel opens Vietnamese text without mojibake
  const csvText = "\uFEFF" + Papa.unparse(rows);
  return {
    content: new TextEncoder().encode(csvText),
    fileName: `${buildSafeBaseFileName(studySet.title)}.csv`,
    contentType: "text/csv; charset=utf-8",
  };
}

function exportToTxt(
  studySet: Pick<StudySet, "title">,
  questions: readonly Question[],
  opts: StudySetExportOptions,
): StudySetExportOutput {
  const style = opts.txtStyle ?? "eduquiz";
  const lines: string[] = [];
  let lastChapter: string | null = null;
  let localCounter = 0;

  for (const q of questions) {
    const chapter = opts.includeChapters === false ? null : (q.chapter ?? null);
    if (chapter && chapter !== lastChapter) {
      if (lines.length > 0) lines.push("");
      lines.push(chapter);
      lines.push("");
      lastChapter = chapter;
      localCounter = 0;
    }

    localCounter += 1;

    if (q.question_type === "flashcard") {
      lines.push(`${q.prompt}\t${q.back_text ?? ""}`);
      continue;
    }

    lines.push(`Câu ${localCounter}: ${q.prompt}`);
    const options = sortedOptions(q);
    const correctLetters: string[] = [];

    options.forEach((opt, idx) => {
      const label = opt.label || indexToOptionLabel(idx);
      if (opt.is_correct) correctLetters.push(label);
      const prefix = style === "eduquiz" && opt.is_correct ? "*" : "";
      lines.push(`${prefix}${label}. ${opt.content}`);
    });

    if (style === "answer_key" && correctLetters.length > 0) {
      lines.push(`Đáp án: ${correctLetters.join(", ")}`);
    } else if (
      options.length === 0 &&
      (q.back_text || (q.accepted_answers && q.accepted_answers.length > 0))
    ) {
      const ans =
        q.accepted_answers?.map((a) => a.answer_text).join("; ") ??
        q.back_text ??
        "";
      lines.push(`Đáp án: ${ans}`);
    }

    if (opts.includeExplanations !== false && q.explanation) {
      lines.push(`Giải thích: ${q.explanation}`);
    }
    if (q.hint) {
      lines.push(`Gợi ý: ${q.hint}`);
    }

    lines.push("");
  }

  return {
    content: new TextEncoder().encode(lines.join("\n").trim() + "\n"),
    fileName: `${buildSafeBaseFileName(studySet.title)}.txt`,
    contentType: "text/plain; charset=utf-8",
  };
}

async function exportToXlsx(
  studySet: Pick<StudySet, "title">,
  questions: readonly Question[],
  opts: StudySetExportOptions,
): Promise<StudySetExportOutput> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "StudyHub";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("Questions");
  const xlsxStyle = opts.xlsxStyle ?? "standard";

  if (xlsxStyle === "wayground") {
    sheet.addRow([
      "Question Text",
      "Question Type",
      "Option 1",
      "Option 2",
      "Option 3",
      "Option 4",
      "Option 5",
      "Correct Answer",
      "Time in seconds",
      "Image Link",
      "Answer Explanation",
    ]);

    for (const q of questions) {
      const options = sortedOptions(q);
      const correctIndices = options
        .map((opt, idx) => (opt.is_correct ? String(idx + 1) : null))
        .filter((v): v is string => v !== null)
        .join(",");

      const waygroundType =
        q.question_type === "multiple_choice"
          ? "Checkbox"
          : q.question_type === "short_answer" || q.question_type === "flashcard"
            ? "Fill-in-the-Blank"
            : "Multiple Choice";

      sheet.addRow([
        q.prompt,
        waygroundType,
        options[0]?.content ?? "",
        options[1]?.content ?? "",
        options[2]?.content ?? "",
        options[3]?.content ?? "",
        options[4]?.content ?? "",
        options.length > 0 ? correctIndices : (q.back_text ?? ""),
        30,
        q.prompt_image_url ?? "",
        opts.includeExplanations === false ? "" : (q.explanation ?? ""),
      ]);
    }
  } else {
    sheet.addRow([
      "Chapter",
      "Question Type",
      "Question",
      "Option A",
      "Option B",
      "Option C",
      "Option D",
      "Option E",
      "Option F",
      "Correct Answer",
      "Back Text",
      "Explanation",
      "Hint",
      "Difficulty",
      "Tags",
    ]);

    for (const q of questions) {
      const options = sortedOptions(q);
      const correctLetters = options
        .map((opt, idx) =>
          opt.is_correct ? opt.label || indexToOptionLabel(idx) : null,
        )
        .filter((v): v is string => v !== null)
        .join(", ");

      sheet.addRow([
        opts.includeChapters === false ? "" : (q.chapter ?? ""),
        q.question_type,
        q.prompt,
        options[0]?.content ?? "",
        options[1]?.content ?? "",
        options[2]?.content ?? "",
        options[3]?.content ?? "",
        options[4]?.content ?? "",
        options[5]?.content ?? "",
        options.length > 0 ? correctLetters : (q.back_text ?? ""),
        q.back_text ?? "",
        opts.includeExplanations === false ? "" : (q.explanation ?? ""),
        q.hint ?? "",
        opts.includeDifficulty === false ? "" : q.difficulty,
        opts.includeTags === false
          ? ""
          : (q.tags ?? []).map((t) => t.name).join(", "),
      ]);
    }
  }

  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true };

  const arrayBuffer = await workbook.xlsx.writeBuffer();
  return {
    content: new Uint8Array(arrayBuffer as ArrayBuffer),
    fileName: `${buildSafeBaseFileName(studySet.title)}.xlsx`,
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}

/**
 * Deterministically export a StudySet + its Questions to JSON, CSV, TXT, or XLSX.
 */
export async function exportStudySet(
  studySet: Pick<StudySet, "id" | "title" | "description" | "subject" | "set_type">,
  questions: readonly Question[],
  options: StudySetExportOptions,
): Promise<StudySetExportOutput> {
  const ordered = [...questions].sort((a, b) => a.position - b.position);

  switch (options.format) {
    case "json":
      return exportToJson(studySet, ordered, options);
    case "csv":
      return exportToCsv(studySet, ordered, options);
    case "txt":
      return exportToTxt(studySet, ordered, options);
    case "xlsx":
      return exportToXlsx(studySet, ordered, options);
  }
}
