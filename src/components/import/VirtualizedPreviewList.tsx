"use client";

import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AlertCircle,
  AlertTriangle,
  BookOpen,
  Check,
  CheckCircle2,
  Copy,
  Edit3,
  EyeOff,
  Plus,
  RotateCcw,
  Search,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Locale } from "@/types/domain";
import type {
  ImportPreviewSummary,
  ParsedOption,
  ParsedQuestion,
} from "@/types/import";
import { getDetectionSourceBadge } from "./import-copy";

export type PreviewFilterTab =
  | "all"
  | "errors"
  | "warnings"
  | "duplicates"
  | "valid";

export interface VirtualizedPreviewListProps {
  locale: Locale;
  questions: ParsedQuestion[];
  summary: ImportPreviewSummary;
  detectedChapters: string[];
  allowInlineEdit: boolean;
  onUpdateQuestion: (tempId: string, updater: (q: ParsedQuestion) => ParsedQuestion) => void;
}

export function VirtualizedPreviewList({
  locale,
  questions,
  summary,
  detectedChapters,
  allowInlineEdit,
  onUpdateQuestion,
}: VirtualizedPreviewListProps) {
  const [filterTab, setFilterTab] = React.useState<PreviewFilterTab>("all");
  const [searchQuery, setSearchQuery] = React.useState("");
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const scrollParentRef = React.useRef<HTMLDivElement | null>(null);

  const filteredQuestions = React.useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return questions.filter((q) => {
      const hasError = q.issues.some((i) => i.severity === "error");
      const hasWarning = q.issues.some((i) => i.severity === "warning");

      if (filterTab === "errors" && !hasError) return false;
      if (filterTab === "warnings" && !hasWarning) return false;
      if (filterTab === "duplicates" && !q.isDuplicate) return false;
      if (filterTab === "valid" && hasError) return false;

      if (query) {
        const hay =
          `${q.prompt} ${q.chapter ?? ""} ${q.options.map((o) => o.content).join(" ")}`.toLowerCase();
        if (!hay.includes(query)) return false;
      }
      return true;
    });
  }, [questions, filterTab, searchQuery]);

  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: filteredQuestions.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: (index) => {
      const item = filteredQuestions[index];
      if (!item) return 220;
      if (item.tempId === editingId) return 460;
      return item.options.length > 0 ? 220 + item.options.length * 32 : 180;
    },
    overscan: 6,
  });

  const tabs: Array<{ id: PreviewFilterTab; label: string; count: number }> = [
    {
      id: "all",
      label: locale === "en" ? "All" : "Tất cả",
      count: questions.length,
    },
    {
      id: "errors",
      label: locale === "en" ? "Errors" : "Lỗi",
      count: summary.errorCount,
    },
    {
      id: "warnings",
      label: locale === "en" ? "Warnings / Conflicts" : "Cảnh báo / Xung đột",
      count: summary.warningCount,
    },
    {
      id: "duplicates",
      label: locale === "en" ? "Duplicates" : "Trùng lặp",
      count: summary.duplicateCount,
    },
    {
      id: "valid",
      label: locale === "en" ? "Valid" : "Hợp lệ",
      count: summary.validCount,
    },
  ];

  const handleToggleOptionCorrect = (q: ParsedQuestion, optionId: string) => {
    onUpdateQuestion(q.tempId, (prev) => {
      const nextOptions = prev.options.map((opt) =>
        opt.id === optionId
          ? {
              ...opt,
              isCorrect: !opt.isCorrect,
              detectedBy: !opt.isCorrect ? ["manual" as const] : [],
            }
          : opt,
      );
      const correctCount = nextOptions.filter((o) => o.isCorrect).length;
      return {
        ...prev,
        questionType:
          prev.questionType === "true_false"
            ? "true_false"
            : correctCount > 1
              ? "multiple_choice"
              : "single_choice",
        options: nextOptions,
        detectedBy: correctCount > 0 ? ["manual"] : ["none"],
        // Resolving manually clears ANSWER_SIGNAL_CONFLICT
        issues: prev.issues.filter((i) => i.code !== "ANSWER_SIGNAL_CONFLICT"),
      };
    });
  };

  return (
    <div className="space-y-4">
      {/* Summary KPI Strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <SummaryKpi
          label={locale === "en" ? "Total Detected" : "Tổng phát hiện"}
          value={summary.totalDetected}
          tone="neutral"
        />
        <SummaryKpi
          label={locale === "en" ? "Valid" : "Hợp lệ"}
          value={summary.validCount}
          tone="success"
        />
        <SummaryKpi
          label={locale === "en" ? "Missing Answer" : "Thiếu đáp án"}
          value={summary.missingAnswerCount}
          tone={summary.missingAnswerCount > 0 ? "error" : "neutral"}
        />
        <SummaryKpi
          label={locale === "en" ? "Format Errors" : "Tổng câu lỗi"}
          value={summary.errorCount}
          tone={summary.errorCount > 0 ? "error" : "neutral"}
        />
        <SummaryKpi
          label={locale === "en" ? "Conflicts" : "Xung đột"}
          value={summary.conflictCount}
          tone={summary.conflictCount > 0 ? "warning" : "neutral"}
        />
        <SummaryKpi
          label={locale === "en" ? "Duplicates" : "Trùng lặp"}
          value={summary.duplicateCount}
          tone={summary.duplicateCount > 0 ? "warning" : "neutral"}
        />
      </div>

      {/* Detected Chapters */}
      {detectedChapters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 px-3.5 py-2.5 text-xs">
          <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
            <BookOpen className="size-3.5 text-primary" aria-hidden="true" />
            {locale === "en"
              ? `Detected Chapters (${detectedChapters.length}):`
              : `Các chương phát hiện (${detectedChapters.length}):`}
          </span>
          {detectedChapters.slice(0, 12).map((ch) => (
            <Badge key={ch} variant="secondary" className="font-normal">
              {ch}
            </Badge>
          ))}
          {detectedChapters.length > 12 && (
            <Badge variant="outline">+{detectedChapters.length - 12}</Badge>
          )}
        </div>
      )}

      {/* Filter Tabs + Search */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          role="tablist"
          aria-label={locale === "en" ? "Filter parsed questions" : "Lọc câu hỏi đã phân tích"}
          className="flex flex-wrap gap-1.5"
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={filterTab === tab.id}
              onClick={() => setFilterTab(tab.id)}
              className={cn(
                "inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                filterTab === tab.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-foreground hover:bg-muted",
              )}
            >
              <span>{tab.label}</span>
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[11px] tabular-nums",
                  filterTab === tab.id
                    ? "bg-primary-foreground/20 text-primary-foreground"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {tab.count.toLocaleString()}
              </span>
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={locale === "en" ? "Search questions…" : "Tìm câu hỏi…"}
            aria-label={locale === "en" ? "Search parsed questions" : "Tìm câu hỏi đã phân tích"}
            className="pl-9"
          />
        </div>
      </div>

      {/* Virtualized Question List (handles 10,000+ rows smoothly) */}
      {filteredQuestions.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {locale === "en"
              ? "No questions match the selected filter."
              : "Không có câu hỏi nào phù hợp với bộ lọc hiện tại."}
          </CardContent>
        </Card>
      ) : (
        <div
          ref={scrollParentRef}
          className="h-[540px] overflow-y-auto rounded-xl border border-border bg-muted/20 p-3"
          tabIndex={0}
          aria-label={locale === "en" ? "Parsed questions list" : "Danh sách câu hỏi xem trước"}
        >
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            {rowVirtualizer.getVirtualItems().map((virtualRow) => {
              const q = filteredQuestions[virtualRow.index];
              if (!q) return null;
              const isEditing = allowInlineEdit && editingId === q.tempId;
              const hasError = q.issues.some((i) => i.severity === "error");
              const hasWarning = q.issues.some((i) => i.severity === "warning");

              return (
                <div
                  key={q.tempId}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  className="pb-3"
                >
                  <div
                    className={cn(
                      "rounded-xl border bg-card p-4 transition-colors",
                      q.excluded && "opacity-55",
                      hasError
                        ? "border-destructive/50"
                        : hasWarning
                          ? "border-amber-500/50"
                          : "border-border",
                    )}
                  >
                    {/* Header Row */}
                    <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-semibold text-foreground tabular-nums">
                          #{q.index + 1}
                        </span>
                        {q.chapter && (
                          <Badge variant="outline" className="max-w-[220px] truncate text-xs">
                            {q.chapter}
                          </Badge>
                        )}
                        <Badge variant="secondary" className="text-xs">
                          {q.questionType}
                        </Badge>
                        {q.detectedBy.map((src) => (
                          <Badge
                            key={src}
                            variant={src === "none" ? "destructive" : "outline"}
                            className="text-xs"
                          >
                            {getDetectionSourceBadge(src, locale)}
                          </Badge>
                        ))}
                        {q.isDuplicate && (
                          <Badge
                            variant="outline"
                            className="gap-1 border-amber-500/50 text-amber-700 dark:text-amber-400"
                          >
                            <Copy className="size-3" aria-hidden="true" />
                            {locale === "en" ? "Duplicate" : "Trùng lặp"}
                          </Badge>
                        )}
                        {q.excluded && (
                          <Badge variant="secondary" className="gap-1">
                            <EyeOff className="size-3" aria-hidden="true" />
                            {locale === "en" ? "Excluded" : "Đã loại trừ"}
                          </Badge>
                        )}
                      </div>

                      {allowInlineEdit && (
                        <div className="flex items-center gap-1.5">
                          <Button
                            type="button"
                            variant={isEditing ? "default" : "outline"}
                            size="sm"
                            onClick={() =>
                              setEditingId(isEditing ? null : q.tempId)
                            }
                          >
                            <Edit3 className="mr-1.5 size-3.5" aria-hidden="true" />
                            {isEditing
                              ? locale === "en"
                                ? "Done"
                                : "Xong"
                              : locale === "en"
                                ? "Edit"
                                : "Sửa"}
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              onUpdateQuestion(q.tempId, (prev) => ({
                                ...prev,
                                excluded: !prev.excluded,
                              }))
                            }
                          >
                            {q.excluded ? (
                              <>
                                <RotateCcw className="mr-1 size-3.5" aria-hidden="true" />
                                {locale === "en" ? "Restore" : "Khôi phục"}
                              </>
                            ) : (
                              <>
                                <EyeOff className="mr-1 size-3.5" aria-hidden="true" />
                                {locale === "en" ? "Skip" : "Bỏ qua"}
                              </>
                            )}
                          </Button>
                        </div>
                      )}
                    </div>

                    {/* Issues Banner */}
                    {q.issues.length > 0 && (
                      <div className="mb-3 space-y-1.5">
                        {q.issues.map((issue) => (
                          <div
                            key={issue.id}
                            className={cn(
                              "flex items-start gap-2 rounded-lg px-3 py-2 text-xs",
                              issue.severity === "error"
                                ? "bg-destructive/10 text-destructive"
                                : "bg-amber-500/10 text-amber-800 dark:text-amber-300",
                            )}
                          >
                            {issue.severity === "error" ? (
                              <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                            ) : (
                              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                            )}
                            <span>{issue.message}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Inline Edit Mode vs Read Preview Mode */}
                    {isEditing ? (
                      <InlineQuestionEditor
                        locale={locale}
                        question={q}
                        onUpdateQuestion={onUpdateQuestion}
                        onToggleOptionCorrect={handleToggleOptionCorrect}
                      />
                    ) : (
                      <div className="space-y-2.5">
                        <p className="whitespace-pre-wrap text-sm font-medium leading-relaxed text-foreground">
                          {q.prompt || (
                            <span className="italic text-destructive">
                              {locale === "en" ? "(Empty prompt)" : "(Trống nội dung câu hỏi)"}
                            </span>
                          )}
                        </p>

                        {q.questionType === "flashcard" ? (
                          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-sm text-foreground">
                            <span className="mr-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                              {locale === "en" ? "Back:" : "Mặt sau:"}
                            </span>
                            <span className="whitespace-pre-wrap">
                              {q.backText || "—"}
                            </span>
                          </div>
                        ) : (
                          q.options.length > 0 && (
                            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                              {q.options.map((opt) => (
                                <button
                                  key={opt.id}
                                  type="button"
                                  disabled={!allowInlineEdit}
                                  onClick={() =>
                                    allowInlineEdit &&
                                    handleToggleOptionCorrect(q, opt.id)
                                  }
                                  className={cn(
                                    "flex items-start gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors",
                                    opt.isCorrect
                                      ? "border-emerald-500/50 bg-emerald-500/10 font-medium text-emerald-900 dark:text-emerald-200"
                                      : "border-border bg-background text-foreground",
                                    allowInlineEdit &&
                                      "cursor-pointer hover:border-primary/50",
                                  )}
                                >
                                  <span
                                    className={cn(
                                      "mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                                      opt.isCorrect
                                        ? "bg-emerald-600 text-white"
                                        : "bg-muted text-muted-foreground",
                                    )}
                                  >
                                    {opt.isCorrect ? (
                                      <Check className="size-3" aria-hidden="true" />
                                    ) : (
                                      opt.label
                                    )}
                                  </span>
                                  <span className="min-w-0 flex-1 whitespace-pre-wrap break-words">
                                    {opt.label}. {opt.content}
                                  </span>
                                </button>
                              ))}
                            </div>
                          )
                        )}

                        {q.explanation && (
                          <p className="rounded-md bg-muted/50 px-3 py-1.5 text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">
                              {locale === "en" ? "Explanation: " : "Giải thích: "}
                            </span>
                            {q.explanation}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryKpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "neutral" | "success" | "warning" | "error";
}) {
  return (
    <div
      className={cn(
        "rounded-xl border p-3",
        tone === "success" && "border-emerald-500/30 bg-emerald-500/5",
        tone === "warning" && "border-amber-500/30 bg-amber-500/5",
        tone === "error" && "border-destructive/30 bg-destructive/5",
        tone === "neutral" && "border-border bg-card",
      )}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-xl font-semibold tabular-nums",
          tone === "success" && "text-emerald-700 dark:text-emerald-400",
          tone === "warning" && "text-amber-700 dark:text-amber-400",
          tone === "error" && "text-destructive",
          tone === "neutral" && "text-foreground",
        )}
      >
        {value.toLocaleString()}
      </p>
    </div>
  );
}

function InlineQuestionEditor({
  locale,
  question,
  onUpdateQuestion,
  onToggleOptionCorrect,
}: {
  locale: Locale;
  question: ParsedQuestion;
  onUpdateQuestion: (
    tempId: string,
    updater: (q: ParsedQuestion) => ParsedQuestion,
  ) => void;
  onToggleOptionCorrect: (q: ParsedQuestion, optionId: string) => void;
}) {
  const addOption = () => {
    onUpdateQuestion(question.tempId, (prev) => {
      const nextLabel = String.fromCharCode(65 + prev.options.length);
      const newOpt: ParsedOption = {
        id: crypto.randomUUID(),
        label: nextLabel,
        content: "",
        isCorrect: false,
        detectedBy: [],
      };
      return { ...prev, options: [...prev.options, newOpt] };
    });
  };

  const removeOption = (optId: string) => {
    onUpdateQuestion(question.tempId, (prev) => ({
      ...prev,
      options: prev.options
        .filter((o) => o.id !== optId)
        .map((o, idx) => ({ ...o, label: String.fromCharCode(65 + idx) })),
    }));
  };

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor={`edit-prompt-${question.tempId}`} className="text-xs">
            {locale === "en" ? "Question Prompt / Front" : "Nội dung câu hỏi / Mặt trước"}
          </Label>
          <Textarea
            id={`edit-prompt-${question.tempId}`}
            rows={2}
            value={question.prompt}
            onChange={(e) =>
              onUpdateQuestion(question.tempId, (prev) => ({
                ...prev,
                prompt: e.target.value,
              }))
            }
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor={`edit-chapter-${question.tempId}`} className="text-xs">
            {locale === "en" ? "Chapter" : "Chương / Chủ đề"}
          </Label>
          <Input
            id={`edit-chapter-${question.tempId}`}
            value={question.chapter ?? ""}
            onChange={(e) =>
              onUpdateQuestion(question.tempId, (prev) => ({
                ...prev,
                chapter: e.target.value || null,
              }))
            }
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor={`edit-explanation-${question.tempId}`} className="text-xs">
            {locale === "en" ? "Explanation" : "Giải thích"}
          </Label>
          <Input
            id={`edit-explanation-${question.tempId}`}
            value={question.explanation ?? ""}
            onChange={(e) =>
              onUpdateQuestion(question.tempId, (prev) => ({
                ...prev,
                explanation: e.target.value || null,
              }))
            }
          />
        </div>
      </div>

      {question.questionType === "flashcard" ? (
        <div className="space-y-1">
          <Label htmlFor={`edit-back-${question.tempId}`} className="text-xs">
            {locale === "en" ? "Back / Definition" : "Mặt sau / Định nghĩa"}
          </Label>
          <Textarea
            id={`edit-back-${question.tempId}`}
            rows={2}
            value={question.backText ?? ""}
            onChange={(e) =>
              onUpdateQuestion(question.tempId, (prev) => ({
                ...prev,
                backText: e.target.value,
                acceptedAnswers: e.target.value.trim()
                  ? [{ answerText: e.target.value.trim(), matchMode: "case_insensitive" }]
                  : [],
              }))
            }
          />
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-foreground">
              {locale === "en"
                ? "Options (check correct answer(s))"
                : "Các phương án (tích chọn đáp án đúng)"}
            </span>
            {question.options.length < 6 && (
              <Button type="button" variant="outline" size="sm" onClick={addOption}>
                <Plus className="mr-1 size-3.5" aria-hidden="true" />
                {locale === "en" ? "Add Option" : "Thêm đáp án"}
              </Button>
            )}
          </div>
          {question.options.map((opt) => (
            <div key={opt.id} className="flex items-center gap-2">
              <Checkbox
                id={`opt-check-${opt.id}`}
                checked={opt.isCorrect}
                onCheckedChange={() => onToggleOptionCorrect(question, opt.id)}
                aria-label={`${locale === "en" ? "Mark correct" : "Đánh dấu đúng"} ${opt.label}`}
              />
              <span className="w-5 text-xs font-semibold text-muted-foreground">
                {opt.label}.
              </span>
              <Input
                value={opt.content}
                onChange={(e) =>
                  onUpdateQuestion(question.tempId, (prev) => ({
                    ...prev,
                    options: prev.options.map((o) =>
                      o.id === opt.id ? { ...o, content: e.target.value } : o,
                    ),
                  }))
                }
                className="flex-1"
              />
              {question.options.length > 2 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={locale === "en" ? "Delete option" : "Xóa lựa chọn"}
                  onClick={() => removeOption(opt.id)}
                >
                  <Trash2 className="size-4 text-muted-foreground" aria-hidden="true" />
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export { CheckCircle2 };
