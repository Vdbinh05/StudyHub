import ExcelJS from "exceljs";
import type { QuestionType } from "@/types/domain";
import type {
  ColumnMapping,
  ImportFormat,
  ImportValidationIssue,
  ParsedQuestion,
} from "@/types/import";
import { isWaygroundHeaders } from "./detector";
import {
  mapTabularRowsToQuestions,
  suggestColumnMapping,
} from "./tabular-mapper";
import { generateStableId } from "./text-utils";
import { inspectAndLoadZip } from "./zip-guard";

export interface XlsxParserConfig {
  sheetName?: string;
  hasHeaderRow?: boolean;
  columnMapping?: ColumnMapping;
  defaultChapter?: string;
  defaultTags?: string[];
  defaultQuestionType?: QuestionType;
}

export interface XlsxParseOutput {
  detectedFormat: Extract<ImportFormat, "xlsx_wayground" | "xlsx_generic">;
  sheetNames: string[];
  selectedSheet: string;
  detectedColumns: string[];
  sampleRows: string[][];
  suggestedMapping: ColumnMapping;
  questions: ParsedQuestion[];
  issues: ImportValidationIssue[];
}

/**
 * Extract plain string value from any ExcelJS cell type (primitive, richText, formula, hyperlink).
 */
function cellValueToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.normalize("NFC");
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText
        .map((part) => part.text ?? "")
        .join("")
        .normalize("NFC");
    }
    if ("text" in value && typeof value.text === "string") {
      return value.text.normalize("NFC");
    }
    if ("result" in value && value.result !== undefined) {
      return cellValueToString(value.result as ExcelJS.CellValue);
    }
    if ("hyperlink" in value && typeof value.hyperlink === "string") {
      return value.hyperlink;
    }
  }
  return String(value).normalize("NFC");
}

/**
 * Deterministic XLSX parser using `exceljs` after full ZIP/OOXML security inspection.
 * Auto-detects Wayground/Quizizz templates and supports custom ColumnMapping.
 */
export async function parseXlsxBuffer(
  bytes: Uint8Array,
  config: XlsxParserConfig = {},
): Promise<XlsxParseOutput> {
  // 1. Run archive bomb, magic bytes, macro, and OOXML security guards FIRST
  await inspectAndLoadZip(bytes, "xlsx");

  const workbook = new ExcelJS.Workbook();
  // Create a clean ArrayBuffer slice so ExcelJS works identically in Node and jsdom
  const arrayBuffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  await workbook.xlsx.load(arrayBuffer);

  const sheetNames = workbook.worksheets.map((ws) => ws.name);
  if (sheetNames.length === 0) {
    return {
      detectedFormat: "xlsx_generic",
      sheetNames: [],
      selectedSheet: "",
      detectedColumns: [],
      sampleRows: [],
      suggestedMapping: { prompt: null, correctAnswer: null },
      questions: [],
      issues: [
        {
          id: generateStableId(),
          code: "INVALID_FORMAT",
          severity: "error",
          message: "Workbook contains no worksheets.",
        },
      ],
    };
  }

  const selectedSheet =
    config.sheetName && sheetNames.includes(config.sheetName)
      ? config.sheetName
      : sheetNames[0];

  const worksheet = workbook.getWorksheet(selectedSheet)!;
  const rawMatrix: string[][] = [];
  let maxCols = 0;

  worksheet.eachRow({ includeEmpty: false }, (row) => {
    const colCount = row.cellCount;
    if (colCount > maxCols) maxCols = colCount;
    const rowValues: string[] = [];
    for (let c = 1; c <= Math.max(colCount, maxCols); c += 1) {
      rowValues.push(cellValueToString(row.getCell(c).value).trim());
    }
    if (rowValues.some((v) => v.length > 0)) {
      rawMatrix.push(rowValues);
    }
  });

  if (rawMatrix.length === 0) {
    return {
      detectedFormat: "xlsx_generic",
      sheetNames,
      selectedSheet,
      detectedColumns: [],
      sampleRows: [],
      suggestedMapping: { prompt: null, correctAnswer: null },
      questions: [],
      issues: [
        {
          id: generateStableId(),
          code: "INVALID_FORMAT",
          severity: "error",
          message: `Worksheet "${selectedSheet}" is empty.`,
        },
      ],
    };
  }

  const hasHeaderRow = config.hasHeaderRow ?? true;
  let headers: string[];
  let dataRows: string[][];

  if (hasHeaderRow) {
    headers = rawMatrix[0].map((cell, idx) => cell || `Column ${idx + 1}`);
    dataRows = rawMatrix.slice(1);
  } else {
    headers = Array.from({ length: maxCols }, (_, idx) => `Column ${idx + 1}`);
    dataRows = rawMatrix;
  }

  const detectedFormat: Extract<ImportFormat, "xlsx_wayground" | "xlsx_generic"> =
    isWaygroundHeaders(headers) ? "xlsx_wayground" : "xlsx_generic";

  const suggestedMapping = suggestColumnMapping(headers);
  const mappingToUse = config.columnMapping ?? suggestedMapping;

  const mapped = mapTabularRowsToQuestions({
    headers,
    rows: dataRows,
    mapping: mappingToUse,
    defaultChapter: config.defaultChapter,
    defaultTags: config.defaultTags,
    defaultQuestionType: config.defaultQuestionType,
  });

  return {
    detectedFormat,
    sheetNames,
    selectedSheet,
    detectedColumns: headers,
    sampleRows: dataRows.slice(0, 5),
    suggestedMapping,
    questions: mapped.questions,
    issues: mapped.issues,
  };
}
