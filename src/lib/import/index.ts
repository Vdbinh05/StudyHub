import type {
  AnswerRule,
  ImportFormat,
  ImportOptions,
  ImportPreviewResult,
  ImportValidationIssue,
  ParsedQuestion,
} from "@/types/import";
import { parseCsvText } from "./csv-parser";
import { detectImportFormat } from "./detector";
import { parseDocxBuffer, type ExtractedDocxMedia } from "./docx-ooxml-parser";
import { parseEduQuizText } from "./eduquiz-parser";
import { parseStudyHubJson } from "./json-parser";
import { parsePdfBuffer } from "./pdf-parser";
import { parseQuizletText } from "./quizlet-parser";
import { sanitizeFileName } from "./text-utils";
import { validateImportBatch } from "./validator";
import { parseWordAnswerKeyText } from "./word-answer-key-parser";
import { parseXlsxBuffer } from "./xlsx-parser";
import {
  ImportSecurityError,
  MAX_PARSED_QUESTIONS,
  validateAndDecodeTextBytes,
  validateFileExtension,
  validateFileSize,
} from "./zip-guard";

export interface ParseImportInput {
  /** Uploaded binary file bytes (DOCX, XLSX, CSV, TSV, TXT, JSON) */
  fileBytes?: Uint8Array;
  /** Original uploaded file name */
  fileName?: string;
  /** Pasted raw text input */
  rawText?: string;
  /** Parsing options (format override, answer rule, column mapping, delimiters, defaults) */
  options?: ImportOptions;
  /** Legacy existing prompts in the target study set for duplicate detection */
  existingPrompts?: readonly string[];
  /** Existing full duplicate fingerprints (`computeQuestionDuplicateFingerprint`) in the target study set */
  existingFingerprints?: readonly string[];
}

export interface ExtendedImportPreviewResult extends ImportPreviewResult {
  detectedChapters: string[];
  extractedMedia?: Array<Omit<ExtractedDocxMedia, "bytes">>;
}

/**
 * Unified 100% deterministic import orchestrator.
 * Enforces all security guards (extension, size, magic bytes, ZIP bomb, XXE, 50k question cap),
 * detects or applies format, runs the corresponding pure parser, validates all items,
 * and returns a complete ImportPreviewResult.
 */
export async function parseImportInput(
  input: ParseImportInput,
): Promise<ExtendedImportPreviewResult> {
  const opts = input.options ?? {};
  const ruleUsed: AnswerRule = opts.answerRule ?? { mode: "auto" };

  let safeFileName: string | undefined;
  let fileSizeBytes: number | undefined;
  let ext = "";

  if (input.fileBytes) {
    fileSizeBytes = input.fileBytes.byteLength;
    validateFileSize(fileSizeBytes, false);
    if (input.fileName) {
      ext = validateFileExtension(input.fileName);
      safeFileName = sanitizeFileName(input.fileName);
    }
  } else if (input.rawText !== undefined) {
    const rawByteLen = new TextEncoder().encode(input.rawText).byteLength;
    fileSizeBytes = rawByteLen;
    validateFileSize(rawByteLen, true);
    safeFileName = input.fileName ? sanitizeFileName(input.fileName) : "pasted-input.txt";
  } else {
    throw new ImportSecurityError(
      "INVALID_OOXML_STRUCTURE",
      "Either fileBytes or rawText must be provided.",
      400,
    );
  }

  let decodedText: string | undefined;
  const isBinaryExt = ext === ".docx" || ext === ".xlsx" || ext === ".pdf";
  if (input.fileBytes && !isBinaryExt) {
    decodedText = validateAndDecodeTextBytes(input.fileBytes);
  } else if (input.rawText !== undefined) {
    decodedText = input.rawText;
  }

  // Determine format
  const detectedFormat: ImportFormat =
    opts.formatOverride ??
    detectImportFormat({
      fileName: safeFileName,
      textContent: decodedText,
      isBinary: isBinaryExt,
    });

  let rawQuestions: ParsedQuestion[] = [];
  let parserIssues: ImportValidationIssue[] = [];
  let finalFormat: ImportFormat = detectedFormat;
  let sheetNames: string[] | undefined;
  let selectedSheet: string | undefined;
  let headerRowCount: 1 | 2 | undefined;
  let detectedColumns: string[] | undefined;
  let sampleRows: string[][] | undefined;
  let suggestedMapping: ImportPreviewResult["suggestedMapping"];
  let extractedMedia: Array<Omit<ExtractedDocxMedia, "bytes">> | undefined;
  let isScannedPdf: boolean | undefined;
  let pdfPageCount: number | undefined;
  let pdfExtractedPages: number | undefined;

  if (
    detectedFormat === "docx_ooxml" ||
    detectedFormat === "docx_multimedia" ||
    ext === ".docx"
  ) {
    if (!input.fileBytes) {
      throw new ImportSecurityError(
        "INVALID_MAGIC_BYTES",
        "DOCX format requires an uploaded .docx binary file.",
        400,
      );
    }
    const preserveMediaPreviews =
      opts.preserveMediaPreviews === true ||
      opts.formatOverride === "docx_multimedia";
    const docxOut = await parseDocxBuffer(input.fileBytes, {
      answerRule: ruleUsed,
      defaultChapter: opts.defaultChapter,
      defaultTags: opts.defaultTags,
      preservePreviewDataUrls: preserveMediaPreviews,
      stripUnuploadedMedia: !preserveMediaPreviews,
    });
    finalFormat =
      docxOut.extractedMedia.length > 0 && preserveMediaPreviews
        ? "docx_multimedia"
        : "docx_ooxml";
    rawQuestions = docxOut.questions;
    parserIssues = docxOut.issues;
    extractedMedia = docxOut.extractedMedia.map((m) => ({
      rId: m.rId,
      fileName: m.fileName,
      mimeType: m.mimeType,
      ext: m.ext,
      byteLength: m.byteLength,
      previewPath: m.previewPath,
      dataUrl: m.dataUrl,
    }));
  } else if (detectedFormat === "pdf_text" || ext === ".pdf") {
    if (!input.fileBytes) {
      throw new ImportSecurityError(
        "INVALID_PDF",
        "PDF format requires an uploaded .pdf binary file.",
        400,
      );
    }
    const pdfOut = await parsePdfBuffer(input.fileBytes, {
      answerRule: ruleUsed,
      defaultChapter: opts.defaultChapter,
      defaultTags: opts.defaultTags,
      pageRange: opts.pdfPageRange,
      twoColumn: opts.pdfTwoColumn,
    });
    finalFormat = "pdf_text";
    rawQuestions = pdfOut.questions;
    parserIssues = pdfOut.issues;
    isScannedPdf = pdfOut.isScannedPdf;
    pdfPageCount = pdfOut.pageCount;
    pdfExtractedPages = pdfOut.extractedPages;
  } else if (
    detectedFormat === "xlsx_wayground" ||
    detectedFormat === "xlsx_generic" ||
    ext === ".xlsx"
  ) {
    if (!input.fileBytes) {
      throw new ImportSecurityError(
        "INVALID_MAGIC_BYTES",
        "XLSX format requires an uploaded .xlsx binary file.",
        400,
      );
    }
    const xlsxOut = await parseXlsxBuffer(input.fileBytes, {
      sheetName: opts.sheetName,
      hasHeaderRow: opts.hasHeaderRow,
      headerRowCount: opts.headerRowCount,
      columnMapping: opts.columnMapping,
      defaultChapter: opts.defaultChapter,
      defaultTags: opts.defaultTags,
      defaultQuestionType: opts.defaultQuestionType,
    });
    finalFormat = opts.formatOverride ?? xlsxOut.detectedFormat;
    sheetNames = xlsxOut.sheetNames;
    selectedSheet = xlsxOut.selectedSheet;
    headerRowCount = xlsxOut.headerRowCount;
    detectedColumns = xlsxOut.detectedColumns;
    sampleRows = xlsxOut.sampleRows;
    suggestedMapping = xlsxOut.suggestedMapping;
    rawQuestions = xlsxOut.questions;
    parserIssues = xlsxOut.issues;
  } else {
    const text = decodedText ?? "";
    switch (detectedFormat) {
      case "eduquiz_txt": {
        const out = parseEduQuizText(text, {
          answerRule: ruleUsed,
          defaultChapter: opts.defaultChapter,
          defaultTags: opts.defaultTags,
          allowInlineAnswerLine: true,
        });
        rawQuestions = out.questions;
        parserIssues = out.issues;
        break;
      }
      case "word_answer_key": {
        const out = parseWordAnswerKeyText(text, {
          answerRule: ruleUsed,
          defaultChapter: opts.defaultChapter,
          defaultTags: opts.defaultTags,
        });
        rawQuestions = out.questions;
        parserIssues = out.issues;
        break;
      }
      case "quizlet_tsv": {
        const out = parseQuizletText(text, {
          termDelimiter: opts.termDelimiter,
          cardDelimiter: opts.cardDelimiter,
          defaultChapter: opts.defaultChapter,
          defaultTags: opts.defaultTags,
        });
        rawQuestions = out.questions;
        parserIssues = out.issues;
        break;
      }
      case "csv": {
        const out = parseCsvText(text, {
          delimiter: opts.csvDelimiter,
          hasHeaderRow: opts.hasHeaderRow,
          columnMapping: opts.columnMapping,
          defaultChapter: opts.defaultChapter,
          defaultTags: opts.defaultTags,
          defaultQuestionType: opts.defaultQuestionType,
        });
        detectedColumns = out.detectedColumns;
        sampleRows = out.sampleRows;
        suggestedMapping = out.suggestedMapping;
        rawQuestions = out.questions;
        parserIssues = out.issues;
        break;
      }
      case "json": {
        const out = parseStudyHubJson(text, {
          defaultChapter: opts.defaultChapter,
          defaultTags: opts.defaultTags,
        });
        rawQuestions = out.questions;
        parserIssues = out.issues;
        break;
      }
      case "txt_generic":
      default: {
        // txt_generic supports both inline/end answer keys AND asterisk markers
        const out = parseWordAnswerKeyText(text, {
          answerRule: ruleUsed,
          defaultChapter: opts.defaultChapter,
          defaultTags: opts.defaultTags,
        });
        rawQuestions = out.questions;
        parserIssues = out.issues;
        break;
      }
    }
  }

  if (rawQuestions.length > MAX_PARSED_QUESTIONS) {
    throw new ImportSecurityError(
      "QUESTION_LIMIT_EXCEEDED",
      `Parsed ${rawQuestions.length.toLocaleString()} questions, exceeding the safety cap of ${MAX_PARSED_QUESTIONS.toLocaleString()} per import job.`,
      400,
    );
  }

  const validated = validateImportBatch(rawQuestions, {
    existingPrompts: input.existingPrompts,
    existingFingerprints: input.existingFingerprints,
    globalIssues: parserIssues,
  });

  return {
    format: finalFormat,
    fileName: safeFileName,
    fileSizeBytes,
    sheetNames,
    selectedSheet,
    headerRowCount,
    detectedColumns,
    sampleRows,
    suggestedMapping,
    isScannedPdf,
    pdfPageCount,
    pdfExtractedPages,
    questions: validated.questions,
    issues: validated.issues,
    summary: validated.summary,
    ruleUsed,
    detectedChapters: validated.detectedChapters,
    extractedMedia,
  };
}

/**
 * Strip unused heavy parser fields (`rawSource` and per-option `formatting`) before
 * serializing preview payloads over HTTP (cuts ~38% payload bloat on large DOCX files).
 */
export function compactPreviewForTransport(
  preview: ExtendedImportPreviewResult,
): ExtendedImportPreviewResult {
  return {
    ...preview,
    questions: preview.questions.map((q) => {
      const { rawSource: _unusedRaw, ...restQ } = q;
      void _unusedRaw;
      return {
        ...restQ,
        options: q.options.map((o) => {
          const { formatting: _unusedFmt, ...restO } = o;
          void _unusedFmt;
          return restO;
        }),
      };
    }),
  };
}

export {
  chunkArray,
  normalizeForComparison,
  normalizeText,
  sanitizeFileName,
  stripUtf8Bom,
} from "./text-utils";
export {
  ImportSecurityError,
  MAX_IMPORT_FILE_BYTES,
  MAX_RAW_TEXT_BYTES,
  MAX_PARSED_QUESTIONS,
  MAX_UNCOMPRESSED_BYTES,
  MAX_ZIP_ENTRIES,
  MAX_COMPRESSION_RATIO,
  hasPdfMagicBytes,
  inspectAndLoadZip,
  inspectRasterImageBytes,
  readSafeZipEntryBytes,
  readSafeZipTextEntry,
  validateAndDecodeTextBytes,
  validateFileExtension,
  validateFileSize,
} from "./zip-guard";
export { detectImportFormat, isWaygroundHeaders } from "./detector";
export {
  parsePdfBuffer,
  parsePdfPageRange,
  MAX_PDF_PAGES,
  MAX_PDF_TEXT_CHARS,
  type PdfParseOutput,
  type PdfParserConfig,
} from "./pdf-parser";
export { parseEduQuizText } from "./eduquiz-parser";
export { parseWordAnswerKeyText } from "./word-answer-key-parser";
export { parseDocxBuffer } from "./docx-ooxml-parser";
export { parseXlsxBuffer } from "./xlsx-parser";
export { parseCsvText } from "./csv-parser";
export { parseQuizletText } from "./quizlet-parser";
export { parseStudyHubJson } from "./json-parser";
export {
  cleanHeaderLabel,
  deduplicateHeaders,
  mapTabularRowsToQuestions,
  parseQuestionTypeValue,
  suggestColumnMapping,
} from "./tabular-mapper";
export {
  validateImportBatch,
  validateParsedQuestion,
  computeImportSummary,
  computeQuestionDuplicateFingerprint,
} from "./validator";
export {
  generateImportTemplate,
  isSupportedTemplateFormat,
  SUPPORTED_TEMPLATE_FORMATS,
  type ImportTemplateFormat,
} from "./templates";
