"use client";

import * as React from "react";
import { CheckCircle2, RefreshCw, ScanSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { Locale } from "@/types/domain";
import type {
  AnswerRule,
  AnswerRuleMode,
  ColumnMapping,
  ImportFormat,
} from "@/types/import";
import { getAnswerRuleLabel, getFormatLabel } from "./import-copy";

const ALL_FORMATS: ImportFormat[] = [
  "eduquiz_txt",
  "word_answer_key",
  "docx_ooxml",
  "docx_multimedia",
  "pdf_text",
  "xlsx_wayground",
  "xlsx_generic",
  "quizlet_tsv",
  "csv",
  "json",
  "txt_generic",
];

const ANSWER_RULES: AnswerRuleMode[] = [
  "auto",
  "asterisk_prefix",
  "inline_answer_key",
  "end_answer_key",
  "docx_bold",
  "docx_highlight",
  "docx_font_color",
  "docx_underline",
];

const UNMAPPED_VALUE = "__UNMAPPED__";

export interface FormatConfigSectionProps {
  locale: Locale;
  detectedFormat: ImportFormat;
  formatOverride: ImportFormat | undefined;
  onFormatOverrideChange: (format: ImportFormat) => void;
  sheetNames?: string[];
  selectedSheet?: string;
  onSheetChange: (sheet: string) => void;
  hasHeaderRow: boolean;
  onHasHeaderRowChange: (val: boolean) => void;
  headerRowCount?: 1 | 2;
  onHeaderRowCountChange?: (rows: 1 | 2) => void;
  detectedColumns?: string[];
  sampleRows?: string[][];
  columnMapping: ColumnMapping;
  onColumnMappingChange: (mapping: ColumnMapping) => void;
  termDelimiter: string;
  onTermDelimiterChange: (val: string) => void;
  cardDelimiter: string;
  onCardDelimiterChange: (val: string) => void;
  csvDelimiter: string;
  onCsvDelimiterChange: (val: string) => void;
  pdfPageRange?: string;
  onPdfPageRangeChange?: (val: string) => void;
  pdfTwoColumn?: boolean;
  onPdfTwoColumnChange?: (val: boolean) => void;
  isScannedPdf?: boolean;
  pdfPageCount?: number;
  isParsing: boolean;
  onApplyReparse: () => void;
}

export function FormatConfigSection({
  locale,
  detectedFormat,
  formatOverride,
  onFormatOverrideChange,
  sheetNames,
  selectedSheet,
  onSheetChange,
  hasHeaderRow,
  onHasHeaderRowChange,
  headerRowCount = 1,
  onHeaderRowCountChange,
  detectedColumns,
  sampleRows,
  columnMapping,
  onColumnMappingChange,
  termDelimiter,
  onTermDelimiterChange,
  cardDelimiter,
  onCardDelimiterChange,
  csvDelimiter,
  onCsvDelimiterChange,
  pdfPageRange = "",
  onPdfPageRangeChange,
  pdfTwoColumn = false,
  onPdfTwoColumnChange,
  isScannedPdf = false,
  pdfPageCount,
  isParsing,
  onApplyReparse,
}: FormatConfigSectionProps) {
  const activeFormat = formatOverride ?? detectedFormat;
  const isTabular =
    activeFormat === "xlsx_wayground" ||
    activeFormat === "xlsx_generic" ||
    activeFormat === "csv";
  const isQuizlet = activeFormat === "quizlet_tsv";
  const isPdf = activeFormat === "pdf_text";

  const updateMapField = (field: keyof ColumnMapping, value: string) => {
    onColumnMappingChange({
      ...columnMapping,
      [field]: value === UNMAPPED_VALUE ? null : value,
    });
  };

  const mappingFields: Array<{
    key: keyof ColumnMapping;
    labelVi: string;
    labelEn: string;
    required?: boolean;
  }> = [
    { key: "prompt", labelVi: "Câu hỏi / Mặt trước", labelEn: "Question / Term", required: true },
    { key: "correctAnswer", labelVi: "Đáp án đúng", labelEn: "Correct Answer" },
    { key: "questionType", labelVi: "Dạng câu hỏi (SC/MC/TF)", labelEn: "Question Type (SC/MC/TF)" },
    { key: "optionA", labelVi: "Lựa chọn A (Option 1)", labelEn: "Option A (Option 1)" },
    { key: "optionB", labelVi: "Lựa chọn B (Option 2)", labelEn: "Option B (Option 2)" },
    { key: "optionC", labelVi: "Lựa chọn C (Option 3)", labelEn: "Option C (Option 3)" },
    { key: "optionD", labelVi: "Lựa chọn D (Option 4)", labelEn: "Option D (Option 4)" },
    { key: "optionE", labelVi: "Lựa chọn E (Option 5)", labelEn: "Option E (Option 5)" },
    { key: "optionF", labelVi: "Lựa chọn F (Option 6)", labelEn: "Option F (Option 6)" },
    { key: "backText", labelVi: "Mặt sau (Flashcard)", labelEn: "Back / Definition" },
    { key: "chapter", labelVi: "Chương / Chủ đề", labelEn: "Chapter / Topic" },
    { key: "explanation", labelVi: "Giải thích", labelEn: "Explanation" },
    { key: "difficulty", labelVi: "Độ khó", labelEn: "Difficulty" },
    { key: "tags", labelVi: "Thẻ (Tags)", labelEn: "Tags" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            {locale === "en" ? "Format & Structure" : "Định dạng & Cấu trúc tệp"}
          </h3>
          <p className="text-xs text-muted-foreground">
            {locale === "en"
              ? "Change format, Excel sheet, column mapping, or PDF layout if needed."
              : "Điều chỉnh định dạng, trang tính Excel, ánh xạ cột hoặc bố cục PDF khi cần."}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="min-h-[38px]"
          disabled={isParsing}
          onClick={onApplyReparse}
        >
          <RefreshCw
            className={cn("mr-1.5 size-3.5", isParsing && "animate-spin")}
            aria-hidden="true"
          />
          {isParsing
            ? locale === "en"
              ? "Updating…"
              : "Đang cập nhật…"
            : locale === "en"
              ? "Apply & Re-parse"
              : "Áp dụng & Phân tích lại"}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="import-format-select" className="text-xs">
            {locale === "en" ? "Source Format" : "Định dạng nguồn"}
          </Label>
          <Select
            value={activeFormat}
            onValueChange={(v) => onFormatOverrideChange(v as ImportFormat)}
          >
            <SelectTrigger id="import-format-select" className="min-h-[42px] w-full min-w-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ALL_FORMATS.map((fmt) => (
                <SelectItem key={fmt} value={fmt}>
                  {getFormatLabel(fmt, locale)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {sheetNames && sheetNames.length > 0 && (
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="import-sheet-select" className="text-xs">
              {locale === "en" ? "Excel Worksheet" : "Trang tính (Sheet)"}
            </Label>
            <Select
              value={selectedSheet ?? sheetNames[0]}
              onValueChange={onSheetChange}
            >
              <SelectTrigger id="import-sheet-select" className="min-h-[42px] w-full min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {sheetNames.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {/* PDF Selectable-Text Options */}
      {isPdf && (
        <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3.5">
          {isScannedPdf && (
            <div
              role="alert"
              className="rounded-lg border border-warning/50 bg-warning-subtle px-3 py-2 text-xs text-warning-subtle-foreground"
            >
              {locale === "en"
                ? "This PDF appears to be scanned / image-only with no selectable text layer. StudyHub does not run AI OCR — please export as selectable-text PDF or Word (.docx) before importing."
                : "Tệp PDF này là bản quét (scan / chỉ gồm hình ảnh), không có lớp văn bản chọn được. StudyHub không dùng AI OCR — vui lòng chuyển sang PDF có văn bản hoặc tệp Word (.docx) trước khi nhập."}
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="min-w-0 space-y-1.5">
              <Label htmlFor="pdf-page-range" className="text-xs">
                {locale === "en"
                  ? `Page range (optional${pdfPageCount ? `, 1–${pdfPageCount}` : ""})`
                  : `Khoảng trang (tùy chọn${pdfPageCount ? `, 1–${pdfPageCount}` : ""})`}
              </Label>
              <Input
                id="pdf-page-range"
                value={pdfPageRange}
                onChange={(e) => onPdfPageRangeChange?.(e.target.value)}
                placeholder={locale === "en" ? "e.g. 1-5, 8" : "VD: 1-5, 8"}
              />
            </div>
            <div className="flex items-center gap-3 self-end pb-1">
              <Switch
                id="pdf-two-column"
                checked={pdfTwoColumn}
                onCheckedChange={(v) => onPdfTwoColumnChange?.(v)}
              />
              <Label htmlFor="pdf-two-column" className="text-xs sm:text-sm">
                {locale === "en"
                  ? "Two-column reading order (left then right)"
                  : "Bố cục 2 cột (đọc cột trái trước, phải sau)"}
              </Label>
            </div>
          </div>
        </div>
      )}

      {/* Quizlet Delimiter Configuration */}
      {isQuizlet && (
        <div className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-muted/30 p-3.5 sm:grid-cols-2">
          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="quizlet-term-delim" className="text-xs">
              {locale === "en"
                ? "Between Term & Definition"
                : "Ngăn cách Thuật ngữ & Định nghĩa"}
            </Label>
            <Select
              value={
                ["\\t", ",", ";", "-", "|"].includes(termDelimiter)
                  ? termDelimiter
                  : "custom"
              }
              onValueChange={(v) => {
                if (v !== "custom") onTermDelimiterChange(v);
              }}
            >
              <SelectTrigger id="quizlet-term-delim" className="min-h-[42px] w-full min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="\t">Tab (\t)</SelectItem>
                <SelectItem value=",">{locale === "en" ? "Comma (,)" : "Dấu phẩy (,)"}</SelectItem>
                <SelectItem value=";">{locale === "en" ? "Semicolon (;)" : "Dấu chấm phẩy (;)"}</SelectItem>
                <SelectItem value="-">{locale === "en" ? "Dash (-)" : "Dấu gạch ngang (-)"}</SelectItem>
                <SelectItem value="|">{locale === "en" ? "Pipe (|)" : "Dấu gạch đứng (|)"}</SelectItem>
                <SelectItem value="custom">{locale === "en" ? "Custom…" : "Tùy chỉnh…"}</SelectItem>
              </SelectContent>
            </Select>
            <Input
              aria-label={locale === "en" ? "Custom term delimiter" : "Ký tự ngăn cách tùy chỉnh"}
              value={termDelimiter}
              onChange={(e) => onTermDelimiterChange(e.target.value)}
              placeholder="\t"
            />
          </div>

          <div className="min-w-0 space-y-1.5">
            <Label htmlFor="quizlet-card-delim" className="text-xs">
              {locale === "en" ? "Between Cards" : "Ngăn cách giữa các thẻ"}
            </Label>
            <Select
              value={
                ["\\n", "\\n\\n", ";"].includes(cardDelimiter)
                  ? cardDelimiter
                  : "custom"
              }
              onValueChange={(v) => {
                if (v !== "custom") onCardDelimiterChange(v);
              }}
            >
              <SelectTrigger id="quizlet-card-delim" className="min-h-[42px] w-full min-w-0">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="\n">{locale === "en" ? "New line (\\n)" : "Xuống dòng (\\n)"}</SelectItem>
                <SelectItem value="\n\n">{locale === "en" ? "Blank line (\\n\\n)" : "Dòng trống (\\n\\n)"}</SelectItem>
                <SelectItem value=";">{locale === "en" ? "Semicolon (;)" : "Dấu chấm phẩy (;)"}</SelectItem>
                <SelectItem value="custom">{locale === "en" ? "Custom…" : "Tùy chỉnh…"}</SelectItem>
              </SelectContent>
            </Select>
            <Input
              aria-label={locale === "en" ? "Custom card delimiter" : "Ký tự ngăn cách thẻ tùy chỉnh"}
              value={cardDelimiter}
              onChange={(e) => onCardDelimiterChange(e.target.value)}
              placeholder="\n"
            />
          </div>
        </div>
      )}

      {/* CSV & XLSX Column Mapping + Sample Rows */}
      {isTabular && (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <Switch
                id="import-header-row"
                checked={hasHeaderRow}
                onCheckedChange={onHasHeaderRowChange}
              />
              <Label htmlFor="import-header-row" className="text-xs sm:text-sm">
                {locale === "en"
                  ? "First row contains column headers"
                  : "Hàng đầu tiên là tiêu đề cột"}
              </Label>
            </div>
            {hasHeaderRow &&
              (activeFormat === "xlsx_generic" || activeFormat === "xlsx_wayground") &&
              onHeaderRowCountChange && (
                <div className="flex min-w-0 items-center gap-2">
                  <Label
                    htmlFor="xlsx-header-rows"
                    className="shrink-0 text-xs text-muted-foreground"
                  >
                    {locale === "en" ? "Header rows:" : "Số hàng tiêu đề:"}
                  </Label>
                  <Select
                    value={String(headerRowCount)}
                    onValueChange={(v) => onHeaderRowCountChange(v === "2" ? 2 : 1)}
                  >
                    <SelectTrigger id="xlsx-header-rows" className="w-full min-w-0 sm:w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">
                        {locale === "en" ? "1 row (Standard)" : "1 hàng (Chuẩn)"}
                      </SelectItem>
                      <SelectItem value="2">
                        {locale === "en"
                          ? "2 rows (Merged headers)"
                          : "2 hàng (Tiêu đề gộp)"}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            {activeFormat === "csv" && (
              <div className="flex min-w-0 items-center gap-2">
                <Label htmlFor="csv-delim" className="shrink-0 text-xs text-muted-foreground">
                  {locale === "en" ? "Delimiter:" : "Phân tách:"}
                </Label>
                <Select
                  value={csvDelimiter || "auto"}
                  onValueChange={(v) => onCsvDelimiterChange(v === "auto" ? "" : v)}
                >
                  <SelectTrigger id="csv-delim" className="w-full min-w-0 sm:w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">{locale === "en" ? "Auto" : "Tự động"}</SelectItem>
                    <SelectItem value=",">Comma (,)</SelectItem>
                    <SelectItem value=";">Semicolon (;)</SelectItem>
                    <SelectItem value="\t">Tab</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {detectedColumns && detectedColumns.length > 0 && (
            <div className="space-y-2.5">
              <p className="text-xs font-semibold text-foreground">
                {locale === "en" ? "Column Mapping" : "Ánh xạ cột dữ liệu"}
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {mappingFields.map((field) => (
                  <div key={field.key} className="min-w-0 space-y-1">
                    <Label
                      htmlFor={`map-${field.key}`}
                      className="text-xs text-muted-foreground"
                    >
                      {locale === "en" ? field.labelEn : field.labelVi}
                      {field.required && <span className="ml-1 text-destructive">*</span>}
                    </Label>
                    <Select
                      value={columnMapping[field.key] ?? UNMAPPED_VALUE}
                      onValueChange={(val) => updateMapField(field.key, val)}
                    >
                      <SelectTrigger id={`map-${field.key}`} className="w-full min-w-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={UNMAPPED_VALUE}>
                          {locale === "en" ? "— Not mapped —" : "— Không ánh xạ —"}
                        </SelectItem>
                        {detectedColumns.map((col, colIdx) => (
                          <SelectItem key={`${colIdx}-${col}`} value={col}>
                            {col}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {detectedColumns && sampleRows && sampleRows.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">
                {locale === "en"
                  ? "Sample Rows Preview (first 5 rows)"
                  : "Xem nhanh 5 dòng đầu tiên"}
              </p>
              <div className="max-w-full overflow-x-auto rounded-lg border border-border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {detectedColumns.map((col, idx) => (
                        <TableHead key={`${col}-${idx}`} className="whitespace-nowrap text-xs">
                          {col}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sampleRows.slice(0, 5).map((row, rIdx) => (
                      <TableRow key={rIdx}>
                        {detectedColumns.map((_, cIdx) => (
                          <TableCell
                            key={cIdx}
                            className="max-w-[200px] truncate text-xs"
                          >
                            {row[cIdx] ?? ""}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export interface AnswerRuleSectionProps {
  locale: Locale;
  activeFormat: ImportFormat;
  answerRule: AnswerRule;
  onAnswerRuleChange: (rule: AnswerRule) => void;
  isParsing: boolean;
}

export function AnswerRuleSection({
  locale,
  activeFormat,
  answerRule,
  onAnswerRuleChange,
  isParsing,
}: AnswerRuleSectionProps) {
  const isDocx = activeFormat === "docx_ooxml" || activeFormat === "docx_multimedia";
  const isTabularOrJson =
    activeFormat === "xlsx_wayground" ||
    activeFormat === "xlsx_generic" ||
    activeFormat === "csv" ||
    activeFormat === "json" ||
    activeFormat === "quizlet_tsv";

  const visibleRules: AnswerRuleMode[] = isDocx
    ? ANSWER_RULES
    : ["auto", "asterisk_prefix", "inline_answer_key", "end_answer_key"];

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-foreground">
          {locale === "en" ? "Answer Detection Rule" : "Cách nhận diện đáp án đúng"}
        </h3>
        <p className="text-xs text-muted-foreground">
          {locale === "en"
            ? "Choose how correct answers are marked in your document. Selecting a rule re-checks your preview immediately."
            : "Chọn cách đánh dấu đáp án đúng trong tài liệu. Chọn quy tắc mới sẽ cập nhật ngay danh sách xem trước."}
        </p>
      </div>

      {isTabularOrJson ? (
        <div className="rounded-lg border border-border bg-muted/30 p-3.5 text-xs text-foreground sm:text-sm">
          <div className="flex items-start gap-2.5">
            <ScanSearch className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
            <div>
              <p className="font-medium">
                {locale === "en"
                  ? "Reading answers directly from your spreadsheet / JSON column"
                  : "Đang đọc đáp án trực tiếp từ cột Đáp án / Mặt sau hoặc tệp JSON"}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {locale === "en"
                  ? "Adjust column mapping above if answers are in a different column."
                  : "Nếu đáp án nằm ở cột khác, bạn có thể đổi ở phần Ánh xạ cột phía trên."}
              </p>
            </div>
          </div>
        </div>
      ) : (
        <div
          role="radiogroup"
          aria-label={
            locale === "en" ? "Answer detection rule" : "Cách nhận diện đáp án đúng"
          }
          className="grid grid-cols-1 gap-2 sm:grid-cols-2"
        >
          {visibleRules.map((mode) => {
            const info = getAnswerRuleLabel(mode, locale);
            const selected = answerRule.mode === mode;
            return (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={isParsing}
                onClick={() => onAnswerRuleChange({ mode })}
                className={cn(
                  "flex min-h-[44px] flex-col items-start rounded-lg border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
                  selected
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border bg-background hover:border-primary/40 hover:bg-muted/40",
                )}
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-foreground sm:text-sm">
                    {info.title}
                  </span>
                  {selected && (
                    <CheckCircle2
                      className="size-4 shrink-0 text-primary"
                      aria-hidden="true"
                    />
                  )}
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {info.description}
                </p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
