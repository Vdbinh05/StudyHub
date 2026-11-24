"use client";

import * as React from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, RefreshCw, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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

export interface StepFormatConfigProps {
  locale: Locale;
  detectedFormat: ImportFormat;
  formatOverride: ImportFormat | undefined;
  onFormatOverrideChange: (format: ImportFormat) => void;
  sheetNames?: string[];
  selectedSheet?: string;
  onSheetChange: (sheet: string) => void;
  hasHeaderRow: boolean;
  onHasHeaderRowChange: (val: boolean) => void;
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
  isParsing: boolean;
  onBack: () => void;
  onNext: () => void;
}

const UNMAPPED_VALUE = "__UNMAPPED__";

export function StepFormatConfig({
  locale,
  detectedFormat,
  formatOverride,
  onFormatOverrideChange,
  sheetNames,
  selectedSheet,
  onSheetChange,
  hasHeaderRow,
  onHasHeaderRowChange,
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
  isParsing,
  onBack,
  onNext,
}: StepFormatConfigProps) {
  const activeFormat = formatOverride ?? detectedFormat;
  const isTabular =
    activeFormat === "xlsx_wayground" ||
    activeFormat === "xlsx_generic" ||
    activeFormat === "csv";
  const isQuizlet = activeFormat === "quizlet_tsv";

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
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle>
              {locale === "en"
                ? "Step 2: Format Detection & Structure"
                : "Bước 2: Định dạng & Cấu trúc dữ liệu"}
            </CardTitle>
            <CardDescription className="mt-1">
              {locale === "en"
                ? "Confirm the auto-detected format or adjust delimiters and column mappings."
                : "Xác nhận định dạng tự nhận diện hoặc tùy chỉnh ký tự phân cách và ánh xạ cột."}
            </CardDescription>
          </div>
          <Badge variant="secondary" className="gap-1.5">
            <CheckCircle2 className="size-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
            {locale === "en" ? "Auto-detected:" : "Tự nhận diện:"}{" "}
            {getFormatLabel(detectedFormat, locale)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="import-format-select">
              {locale === "en" ? "Import Format" : "Định dạng nguồn"}
            </Label>
            <Select
              value={activeFormat}
              onValueChange={(v) => onFormatOverrideChange(v as ImportFormat)}
            >
              <SelectTrigger id="import-format-select" className="min-h-[44px]">
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
            <div className="space-y-2">
              <Label htmlFor="import-sheet-select">
                {locale === "en" ? "Excel Worksheet" : "Trang tính (Sheet)"}
              </Label>
              <Select
                value={selectedSheet ?? sheetNames[0]}
                onValueChange={onSheetChange}
              >
                <SelectTrigger id="import-sheet-select" className="min-h-[44px]">
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

        {/* Quizlet Delimiter Configuration */}
        {isQuizlet && (
          <div className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-muted/30 p-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="quizlet-term-delim">
                {locale === "en"
                  ? "Between Term & Definition"
                  : "Ký tự ngăn cách Thuật ngữ & Định nghĩa"}
              </Label>
              <Select
                value={["\\t", ",", ";", "-", "|"].includes(termDelimiter) ? termDelimiter : "custom"}
                onValueChange={(v) => {
                  if (v !== "custom") onTermDelimiterChange(v);
                }}
              >
                <SelectTrigger id="quizlet-term-delim" className="min-h-[44px]">
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

            <div className="space-y-2">
              <Label htmlFor="quizlet-card-delim">
                {locale === "en" ? "Between Cards" : "Ký tự ngăn cách giữa các thẻ"}
              </Label>
              <Select
                value={["\\n", "\\n\\n", ";"].includes(cardDelimiter) ? cardDelimiter : "custom"}
                onValueChange={(v) => {
                  if (v !== "custom") onCardDelimiterChange(v);
                }}
              >
                <SelectTrigger id="quizlet-card-delim" className="min-h-[44px]">
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
            <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-muted/30 p-3.5">
              <div className="flex items-center gap-3">
                <Switch
                  id="import-header-row"
                  checked={hasHeaderRow}
                  onCheckedChange={onHasHeaderRowChange}
                />
                <Label htmlFor="import-header-row">
                  {locale === "en"
                    ? "First row contains column headers"
                    : "Hàng đầu tiên là tiêu đề cột"}
                </Label>
              </div>
              {activeFormat === "csv" && (
                <div className="flex items-center gap-2">
                  <Label htmlFor="csv-delim" className="text-xs text-muted-foreground">
                    {locale === "en" ? "Delimiter:" : "Phân tách:"}
                  </Label>
                  <Select
                    value={csvDelimiter || "auto"}
                    onValueChange={(v) => onCsvDelimiterChange(v === "auto" ? "" : v)}
                  >
                    <SelectTrigger id="csv-delim" className="w-32">
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
              <div className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">
                  {locale === "en" ? "Column Mapping" : "Ánh xạ cột dữ liệu"}
                </h3>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {mappingFields.map((field) => (
                    <div key={field.key} className="space-y-1.5">
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
                        <SelectTrigger id={`map-${field.key}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={UNMAPPED_VALUE}>
                            {locale === "en" ? "— Not mapped —" : "— Không ánh xạ —"}
                          </SelectItem>
                          {detectedColumns.map((col) => (
                            <SelectItem key={col} value={col}>
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
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">
                  {locale === "en"
                    ? "Sample Rows Preview (first 5 rows)"
                    : "Xem nhanh 5 dòng dữ liệu đầu tiên"}
                </p>
                <div className="overflow-x-auto rounded-lg border border-border">
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
                              className="max-w-[220px] truncate text-xs"
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

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <Button type="button" variant="outline" className="min-h-[44px]" onClick={onBack}>
            <ArrowLeft className="mr-2 size-4" aria-hidden="true" />
            {locale === "en" ? "Back" : "Quay lại"}
          </Button>
          <Button
            type="button"
            className="min-h-[44px]"
            disabled={isParsing}
            onClick={onNext}
          >
            {isParsing ? (
              <>
                <RefreshCw className="mr-2 size-4 animate-spin" aria-hidden="true" />
                {locale === "en" ? "Re-parsing…" : "Đang phân tích lại…"}
              </>
            ) : (
              <>
                {locale === "en" ? "Next: Answer Rules" : "Tiếp: Quy tắc đáp án"}
                <ArrowRight className="ml-2 size-4" aria-hidden="true" />
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export interface StepAnswerRuleProps {
  locale: Locale;
  activeFormat: ImportFormat;
  answerRule: AnswerRule;
  onAnswerRuleChange: (rule: AnswerRule) => void;
  isParsing: boolean;
  onBack: () => void;
  onNext: () => void;
}

export function StepAnswerRule({
  locale,
  activeFormat,
  answerRule,
  onAnswerRuleChange,
  isParsing,
  onBack,
  onNext,
}: StepAnswerRuleProps) {
  const isDocx = activeFormat === "docx_ooxml";
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
    <Card>
      <CardHeader>
        <CardTitle>
          {locale === "en"
            ? "Step 3: Answer Detection Rule"
            : "Bước 3: Chọn quy tắc nhận diện đáp án đúng"}
        </CardTitle>
        <CardDescription>
          {locale === "en"
            ? "Tell StudyHub exactly how correct answers are marked in your document. Zero guesswork — conflicts are always flagged for manual review."
            : "Chọn cách đánh dấu đáp án đúng trong tài liệu của bạn. Không đoán mò — mọi xung đột tín hiệu đều được cảnh báo rõ ràng."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {isTabularOrJson ? (
          <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-foreground">
            <div className="flex items-start gap-3">
              <Sparkles className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <p className="font-medium">
                  {locale === "en"
                    ? "Explicit Structured Answer Mapping Active"
                    : "Đang sử dụng ánh xạ đáp án cấu trúc trực tiếp"}
                </p>
                <p className="mt-1 text-muted-foreground">
                  {locale === "en"
                    ? "Correct answers are read deterministically from your mapped Answer / Back column or JSON isCorrect fields."
                    : "Đáp án đúng được đọc trực tiếp từ cột Đáp án / Mặt sau đã ánh xạ hoặc trường isCorrect trong JSON."}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <div
            role="radiogroup"
            aria-label={
              locale === "en" ? "Answer detection rule" : "Quy tắc nhận diện đáp án"
            }
            className="grid grid-cols-1 gap-3 md:grid-cols-2"
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
                  onClick={() => onAnswerRuleChange({ mode })}
                  className={cn(
                    "flex min-h-[44px] flex-col items-start rounded-xl border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    selected
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "border-border bg-card hover:border-primary/40 hover:bg-muted/40",
                  )}
                >
                  <div className="flex w-full items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-foreground">
                      {info.title}
                    </span>
                    {selected && (
                      <CheckCircle2
                        className="size-4 shrink-0 text-primary"
                        aria-hidden="true"
                      />
                    )}
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                    {info.description}
                  </p>
                </button>
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <Button type="button" variant="outline" className="min-h-[44px]" onClick={onBack}>
            <ArrowLeft className="mr-2 size-4" aria-hidden="true" />
            {locale === "en" ? "Back" : "Quay lại"}
          </Button>
          <Button
            type="button"
            className="min-h-[44px]"
            disabled={isParsing}
            onClick={onNext}
          >
            {isParsing ? (
              <>
                <RefreshCw className="mr-2 size-4 animate-spin" aria-hidden="true" />
                {locale === "en" ? "Parsing…" : "Đang phân tích…"}
              </>
            ) : (
              <>
                {locale === "en" ? "Parse & Preview Questions" : "Phân tích & Xem trước"}
                <ArrowRight className="ml-2 size-4" aria-hidden="true" />
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
