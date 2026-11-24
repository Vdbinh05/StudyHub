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
  cleanHeaderLabel,
  deduplicateHeaders,
  mapTabularRowsToQuestions,
  suggestColumnMapping,
} from "./tabular-mapper";
import { generateStableId, stripUtf8Bom } from "./text-utils";
import { inspectAndLoadZip } from "./zip-guard";

export interface XlsxParserConfig {
  sheetName?: string;
  hasHeaderRow?: boolean;
  headerRowCount?: 1 | 2;
  columnMapping?: ColumnMapping;
  defaultChapter?: string;
  defaultTags?: string[];
  defaultQuestionType?: QuestionType;
}

export interface XlsxParseOutput {
  detectedFormat: Extract<ImportFormat, "xlsx_wayground" | "xlsx_generic">;
  sheetNames: string[];
  selectedSheet: string;
  headerRowCount: 1 | 2;
  detectedColumns: string[];
  sampleRows: string[][];
  suggestedMapping: ColumnMapping;
  questions: ParsedQuestion[];
  issues: ImportValidationIssue[];
}

interface ParsedMergeRange {
  startCol: number;
  startRow: number;
  endCol: number;
  endRow: number;
}

function excelLettersToColNumber(letters: string): number {
  let col = 0;
  const upper = letters.toUpperCase();
  for (let i = 0; i < upper.length; i += 1) {
    col = col * 26 + (upper.charCodeAt(i) - 64);
  }
  return col;
}

function parseMergeRange(range: string): ParsedMergeRange | null {
  const match = /^([A-Za-z]+)(\d+):([A-Za-z]+)(\d+)$/.exec(range.trim());
  if (!match) return null;
  const startCol = excelLettersToColNumber(match[1]);
  const startRow = Number.parseInt(match[2], 10);
  const endCol = excelLettersToColNumber(match[3]);
  const endRow = Number.parseInt(match[4], 10);
  if (
    Number.isNaN(startRow) ||
    Number.isNaN(endRow) ||
    startCol <= 0 ||
    endCol <= 0
  ) {
    return null;
  }
  return {
    startCol: Math.min(startCol, endCol),
    startRow: Math.min(startRow, endRow),
    endCol: Math.max(startCol, endCol),
    endRow: Math.max(startRow, endRow),
  };
}

const KNOWN_SUBHEADER_REGEX =
  /^(?:nội\s*dung|noi\s*dung|giải\s*thích|giai\s*thich|text|content|explanation|note|ghi\s*chú|ghi\s*chu|hình\s*ảnh|hinh\s*anh|image|link)$/i;

/**
 * Extract plain string value from any ExcelJS cell type (primitive, richText, formula, hyperlink).
 * Strips stray interior U+FEFF characters and normalizes Unicode to NFC.
 */
function cellValueToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return stripUtf8Bom(value).normalize("NFC");
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "object") {
    if ("richText" in value && Array.isArray(value.richText)) {
      return stripUtf8Bom(
        value.richText.map((part) => part.text ?? "").join(""),
      ).normalize("NFC");
    }
    if ("text" in value && typeof value.text === "string") {
      return stripUtf8Bom(value.text).normalize("NFC");
    }
    if ("result" in value && value.result !== undefined) {
      return cellValueToString(value.result as ExcelJS.CellValue);
    }
    if ("hyperlink" in value && typeof value.hyperlink === "string") {
      return stripUtf8Bom(value.hyperlink);
    }
  }
  return stripUtf8Bom(String(value)).normalize("NFC");
}

function detectMergedTwoRowHeader(
  row1Number: number,
  row2Number: number,
  row1: readonly string[],
  row2: readonly string[],
  merges: readonly ParsedMergeRange[],
  maxCols: number,
): { isTwoRow: boolean; verticalMergeCols: Set<number> } {
  const verticalMergeCols = new Set<number>();
  if (row2Number !== row1Number + 1) {
    return { isTwoRow: false, verticalMergeCols };
  }

  for (const m of merges) {
    if (
      m.startRow <= row1Number &&
      m.endRow >= row2Number &&
      m.startCol === m.endCol
    ) {
      verticalMergeCols.add(m.startCol);
    }
  }

  const horizontalMerges = merges.filter(
    (m) => m.startRow === row1Number && m.endRow === row1Number && m.endCol > m.startCol,
  );

  // Case 1: Explicit ExcelJS horizontal merges in Row 1 with distinct subheaders in Row 2
  if (horizontalMerges.length > 0) {
    let distinctSubheaderCells = 0;
    let conciseSubheaderCells = 0;
    let knownSubheaderHits = 0;

    for (const m of horizontalMerges) {
      const topLabel = cleanHeaderLabel(row1[m.startCol - 1] ?? "").toLowerCase();
      for (let c = m.startCol; c <= Math.min(m.endCol, maxCols); c += 1) {
        const sub = cleanHeaderLabel(row2[c - 1] ?? "");
        if (!sub) continue;
        if (sub.toLowerCase() !== topLabel) {
          distinctSubheaderCells += 1;
          if (sub.length <= 80) conciseSubheaderCells += 1;
          if (KNOWN_SUBHEADER_REGEX.test(sub)) knownSubheaderHits += 1;
        }
      }
    }

    if (
      distinctSubheaderCells >= 2 &&
      conciseSubheaderCells === distinctSubheaderCells &&
      (knownSubheaderHits >= 1 || verticalMergeCols.size >= 1 || horizontalMerges.length >= 2)
    ) {
      return { isTwoRow: true, verticalMergeCols };
    }
  }

  // Case 2: Unmerged/re-saved institutional 2-row header where Row 1 repeats identical
  // adjacent labels and Row 2 contains known subheader pairs (e.g. "Nội dung" / "Giải thích")
  let repeatedAdjacentKnownSubheaders = 0;
  for (let c = 1; c < maxCols; c += 1) {
    const leftTop = cleanHeaderLabel(row1[c - 1] ?? "");
    const rightTop = cleanHeaderLabel(row1[c] ?? "");
    const leftSub = cleanHeaderLabel(row2[c - 1] ?? "");
    const rightSub = cleanHeaderLabel(row2[c] ?? "");
    if (
      leftTop &&
      leftTop.toLowerCase() === rightTop.toLowerCase() &&
      leftSub &&
      rightSub &&
      leftSub.toLowerCase() !== rightSub.toLowerCase() &&
      KNOWN_SUBHEADER_REGEX.test(leftSub) &&
      KNOWN_SUBHEADER_REGEX.test(rightSub)
    ) {
      repeatedAdjacentKnownSubheaders += 1;
    }
  }

  if (repeatedAdjacentKnownSubheaders >= 2) {
    return { isTwoRow: true, verticalMergeCols };
  }

  return { isTwoRow: false, verticalMergeCols };
}

/**
 * Deterministic XLSX parser using `exceljs` after full ZIP/OOXML security inspection.
 * Auto-detects 2-row merged institutional Vietnamese/English headers and Wayground/Quizizz
 * templates, guarantees globally unique column labels, and supports custom ColumnMapping.
 */
export async function parseXlsxBuffer(
  bytes: Uint8Array,
  config: XlsxParserConfig = {},
): Promise<XlsxParseOutput> {
  // 1. Run archive bomb, magic bytes, macro, streaming cap, and XXE guards BEFORE ExcelJS load!
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
      headerRowCount: 1,
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
  const rawRows: Array<{ rowNumber: number; values: string[] }> = [];
  let maxCols = 0;

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const colCount = Math.max(row.cellCount, maxCols);
    const rowValues: string[] = [];
    let lastNonEmptyCol = 0;
    for (let c = 1; c <= colCount; c += 1) {
      const val = cellValueToString(row.getCell(c).value).trim();
      rowValues.push(val);
      if (val.length > 0) {
        lastNonEmptyCol = c;
      }
    }
    if (lastNonEmptyCol > 0) {
      if (lastNonEmptyCol > maxCols) maxCols = lastNonEmptyCol;
      rawRows.push({ rowNumber, values: rowValues });
    }
  });

  if (rawRows.length === 0) {
    return {
      detectedFormat: "xlsx_generic",
      sheetNames,
      selectedSheet,
      headerRowCount: 1,
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

  // Normalize all rows to uniform `maxCols` width
  const normalizedRows = rawRows.map((r) => ({
    rowNumber: r.rowNumber,
    values: Array.from({ length: maxCols }, (_, idx) => r.values[idx] ?? ""),
  }));

  const rawMerges = Array.isArray(worksheet.model?.merges)
    ? (worksheet.model.merges as string[])
    : [];
  const parsedMerges = rawMerges
    .map(parseMergeRange)
    .filter((m): m is ParsedMergeRange => m !== null);

  const hasHeaderRow = config.hasHeaderRow ?? true;
  let headerRowCount: 1 | 2 = 1;
  let headers: string[];
  let dataRows: string[][];

  if (!hasHeaderRow) {
    headers = Array.from({ length: maxCols }, (_, idx) => `Column ${idx + 1}`);
    dataRows = normalizedRows.map((r) => r.values);
  } else {
    const first = normalizedRows[0];
    const second = normalizedRows[1];

    const autoDetection =
      second !== undefined
        ? detectMergedTwoRowHeader(
            first.rowNumber,
            second.rowNumber,
            first.values,
            second.values,
            parsedMerges,
            maxCols,
          )
        : { isTwoRow: false, verticalMergeCols: new Set<number>() };

    const useTwoRows =
      second !== undefined &&
      (config.headerRowCount === 2 ||
        (config.headerRowCount === undefined && autoDetection.isTwoRow));

    if (useTwoRows && second) {
      headerRowCount = 2;
      const compositeHeaders: string[] = [];
      for (let c = 1; c <= maxCols; c += 1) {
        const top = cleanHeaderLabel(first.values[c - 1] ?? "");
        const sub = cleanHeaderLabel(second.values[c - 1] ?? "");
        if (
          autoDetection.verticalMergeCols.has(c) ||
          !sub ||
          sub.toLowerCase() === top.toLowerCase()
        ) {
          compositeHeaders.push(top || `Column ${c}`);
        } else if (top) {
          compositeHeaders.push(`${top} — ${sub}`);
        } else {
          compositeHeaders.push(sub);
        }
      }
      headers = deduplicateHeaders(compositeHeaders);
      dataRows = normalizedRows.slice(2).map((r) => r.values);
    } else {
      headerRowCount = 1;
      headers = deduplicateHeaders(first.values);
      dataRows = normalizedRows.slice(1).map((r) => r.values);
    }
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
    headerRowCount,
    detectedColumns: headers,
    sampleRows: dataRows.slice(0, 5),
    suggestedMapping,
    questions: mapped.questions,
    issues: mapped.issues,
  };
}
