import type {
  AnswerMatchMode,
  DifficultyLevel,
  ImportJobStatus,
  QuestionType,
} from "./domain";

/**
 * Deterministic Multi-Format Import & Export types for StudyHub V1.0.
 * Strictly aligned with `docs/IMPORT_FORMATS.md` & `docs/DATABASE.md` (`import_jobs`).
 * Zero AI heuristics: every detected answer carries an explicit audit trail.
 */

export type ImportFormat =
  | "eduquiz_txt"
  | "word_answer_key"
  | "docx_ooxml"
  | "xlsx_wayground"
  | "xlsx_generic"
  | "quizlet_tsv"
  | "csv"
  | "json"
  | "txt_generic";

export type AnswerDetectionSource =
  | "asterisk_prefix"
  | "inline_answer_key"
  | "end_answer_key"
  | "docx_bold"
  | "docx_highlight"
  | "docx_font_color"
  | "docx_underline"
  | "column_mapping"
  | "json_explicit"
  | "manual"
  | "none";

export type AnswerRuleMode =
  | "auto"
  | "asterisk_prefix"
  | "inline_answer_key"
  | "end_answer_key"
  | "docx_bold"
  | "docx_highlight"
  | "docx_font_color"
  | "docx_underline";

export interface AnswerRule {
  mode: AnswerRuleMode;
  enabledSignals?: Exclude<AnswerRuleMode, "auto">[];
  priorityOrder?: Exclude<AnswerRuleMode, "auto">[];
  targetFontColors?: string[];
  targetHighlightColors?: string[];
}

export type ImportIssueSeverity = "error" | "warning" | "info";

export type ImportValidationIssueCode =
  | "EMPTY_PROMPT"
  | "TOO_FEW_OPTIONS"
  | "NO_CORRECT_ANSWER"
  | "DUPLICATE_OPTIONS"
  | "ANSWER_SIGNAL_CONFLICT"
  | "AMBIGUOUS_ANSWER_KEY_MAPPING"
  | "EMPTY_FLASHCARD_BACK"
  | "DUPLICATE_QUESTION_IN_BATCH"
  | "INVALID_CORRECT_ANSWER"
  | "EMBEDDED_IMAGE_SKIPPED"
  | "UNPARSED_BLOCK"
  | "INVALID_FORMAT";

export interface ImportValidationIssue {
  id: string;
  code: ImportValidationIssueCode;
  severity: ImportIssueSeverity;
  questionIndex?: number;
  optionIndex?: number;
  message: string;
  details?: string;
}

export interface OptionFormattingMeta {
  bold?: boolean;
  underline?: boolean;
  highlight?: string | null;
  shading?: string | null;
  fontColor?: string | null;
}

export interface ParsedOption {
  /** Temporary stable UUID generated during parse for UI editing & preview */
  id: string;
  label: string;
  content: string;
  isCorrect: boolean;
  imageUrl?: string | null;
  detectedBy: AnswerDetectionSource[];
  formatting?: OptionFormattingMeta;
}

export interface ParsedAcceptedAnswer {
  answerText: string;
  matchMode: AnswerMatchMode;
}

export interface ParsedQuestion {
  tempId: string;
  index: number;
  chapter?: string | null;
  chapterIndex?: number;
  localQuestionNumber?: number | null;
  questionType: QuestionType;
  prompt: string;
  promptImageUrl?: string | null;
  backText?: string | null;
  backImageUrl?: string | null;
  explanation?: string | null;
  hint?: string | null;
  difficulty: DifficultyLevel;
  tags: string[];
  options: ParsedOption[];
  acceptedAnswers?: ParsedAcceptedAnswer[];
  detectedBy: AnswerDetectionSource[];
  rawSource?: string;
  isDuplicate?: boolean;
  excluded?: boolean;
  issues: ImportValidationIssue[];
}

export interface ColumnMapping {
  prompt: string | null;
  questionType?: string | null;
  chapter?: string | null;
  optionA?: string | null;
  optionB?: string | null;
  optionC?: string | null;
  optionD?: string | null;
  optionE?: string | null;
  optionF?: string | null;
  optionsColumn?: string | null;
  correctAnswer: string | null;
  backText?: string | null;
  explanation?: string | null;
  hint?: string | null;
  tags?: string | null;
  difficulty?: string | null;
}

export interface ImportPreviewSummary {
  totalDetected: number;
  validCount: number;
  warningCount: number;
  errorCount: number;
  duplicateCount: number;
  missingAnswerCount: number;
  conflictCount: number;
}

export interface ImportPreviewResult {
  format: ImportFormat;
  fileName?: string;
  fileSizeBytes?: number;
  sheetNames?: string[];
  selectedSheet?: string;
  headerRowCount?: 1 | 2;
  detectedColumns?: string[];
  sampleRows?: string[][];
  suggestedMapping?: ColumnMapping;
  questions: ParsedQuestion[];
  issues: ImportValidationIssue[];
  summary: ImportPreviewSummary;
  ruleUsed: AnswerRule;
}

export interface ImportOptions {
  formatOverride?: ImportFormat;
  sheetName?: string;
  hasHeaderRow?: boolean;
  headerRowCount?: 1 | 2;
  answerRule?: AnswerRule;
  columnMapping?: ColumnMapping;
  csvDelimiter?: string;
  termDelimiter?: string;
  cardDelimiter?: string;
  defaultQuestionType?: QuestionType;
  defaultChapter?: string;
  defaultTags?: string[];
  mode?: "append" | "replace";
  skipInvalidRows?: boolean;
}

export interface ImportJob {
  id: string;
  user_id: string;
  study_set_id: string | null;
  source_format: ImportFormat;
  file_name: string;
  file_size_bytes: number;
  status: ImportJobStatus;
  total_detected: number;
  valid_count: number;
  warning_count: number;
  error_count: number;
  imported_count: number;
  answer_rule: AnswerRule | Record<string, unknown>;
  diagnostics: ImportValidationIssue[];
  created_at: string;
  completed_at: string | null;
}

export interface ExportOptions {
  format: "json" | "csv" | "xlsx";
  includeExplanations?: boolean;
  includeTags?: boolean;
  includeDifficulty?: boolean;
  includeChapters?: boolean;
}
