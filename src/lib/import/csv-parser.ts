import Papa from "papaparse";
import type { QuestionType } from "@/types/domain";
import type {
  ColumnMapping,
  ImportValidationIssue,
  ParsedQuestion,
} from "@/types/import";
import {
  deduplicateHeaders,
  mapTabularRowsToQuestions,
  suggestColumnMapping,
} from "./tabular-mapper";
import { generateStableId, normalizeText } from "./text-utils";

export interface CsvParserConfig {
  delimiter?: string;
  hasHeaderRow?: boolean;
  columnMapping?: ColumnMapping;
  defaultChapter?: string;
  defaultTags?: string[];
  defaultQuestionType?: QuestionType;
}

export interface CsvParseOutput {
  detectedColumns: string[];
  sampleRows: string[][];
  suggestedMapping: ColumnMapping;
  questions: ParsedQuestion[];
  issues: ImportValidationIssue[];
}

/**
 * Deterministic CSV parser using `papaparse`.
 * Strips UTF-8 BOM, preserves Vietnamese Unicode NFC, respects quoted commas and
 * multiline cells, and maps columns via ColumnMapping.
 */
export function parseCsvText(
  rawText: string,
  config: CsvParserConfig = {},
): CsvParseOutput {
  const normalized = normalizeText(rawText);
  const parsed = Papa.parse<string[]>(normalized, {
    delimiter: config.delimiter || "",
    skipEmptyLines: "greedy",
    header: false,
  });

  const issues: ImportValidationIssue[] = [];
  for (const err of parsed.errors) {
    // Ignore benign UndetectableDelimiter warning on single-column inputs
    if (err.code === "UndetectableDelimiter") continue;
    issues.push({
      id: generateStableId(),
      code: "INVALID_FORMAT",
      severity: "warning",
      message: `CSV parse warning${err.row !== undefined ? ` on row ${err.row + 1}` : ""}: ${err.message}`,
    });
  }

  const rawMatrix = parsed.data
    .map((row) => row.map((cell) => (cell ?? "").normalize("NFC").trim()))
    .filter((row) => row.some((cell) => cell.length > 0));

  if (rawMatrix.length === 0) {
    return {
      detectedColumns: [],
      sampleRows: [],
      suggestedMapping: { prompt: null, correctAnswer: null },
      questions: [],
      issues: [
        ...issues,
        {
          id: generateStableId(),
          code: "INVALID_FORMAT",
          severity: "error",
          message: "CSV input contains no data rows.",
        },
      ],
    };
  }

  const maxCols = rawMatrix.reduce((max, row) => Math.max(max, row.length), 0);
  const hasHeaderRow = config.hasHeaderRow ?? true;

  let headers: string[];
  let dataRows: string[][];
  if (hasHeaderRow) {
    headers = deduplicateHeaders(
      Array.from({ length: maxCols }, (_, idx) => rawMatrix[0][idx] ?? ""),
    );
    dataRows = rawMatrix.slice(1);
  } else {
    headers = Array.from({ length: maxCols }, (_, idx) => `Column ${idx + 1}`);
    dataRows = rawMatrix;
  }

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
    detectedColumns: headers,
    sampleRows: dataRows.slice(0, 5),
    suggestedMapping,
    questions: mapped.questions,
    issues: [...issues, ...mapped.issues],
  };
}
