"use client";

import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeftRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Edit3,
  EyeOff,
  Image as ImageIcon,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
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
  ParsedMediaAttachment,
  ParsedOption,
  ParsedQuestion,
} from "@/types/import";
import { getDetectionSourceBadge, getQuestionTypeLabel } from "./import-copy";

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
  onMoveMediaToQuestion?: (
    sourceTempId: string,
    mediaId: string,
    sourceSlot: "prompt" | string,
    targetQuestionIndex: number,
  ) => void;
}

export function VirtualizedPreviewList({
  locale,
  questions,
  summary,
  detectedChapters,
  allowInlineEdit,
  onUpdateQuestion,
  onMoveMediaToQuestion,
}: VirtualizedPreviewListProps) {
  const [filterTab, setFilterTab] = React.useState<PreviewFilterTab>("all");
  const [searchQuery, setSearchQuery] = React.useState("");
  const deferredSearchQuery = React.useDeferredValue(searchQuery);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const scrollParentRef = React.useRef<HTMLDivElement | null>(null);

  const filteredQuestions = React.useMemo(() => {
    const query = deferredSearchQuery.trim().toLowerCase();
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
  }, [questions, filterTab, deferredSearchQuery]);

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

      {/* Filter Toolbar + Search */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          role="toolbar"
          aria-label={locale === "en" ? "Filter parsed questions" : "Lọc câu hỏi đã phân tích"}
          className="flex flex-wrap gap-1.5"
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              aria-pressed={filterTab === tab.id}
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
                          ? "border-warning/50"
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
                          {getQuestionTypeLabel(q.questionType, locale)}
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
                            className="gap-1 border-warning/50 bg-warning-subtle text-warning-subtle-foreground"
                          >
                            <Copy className="size-3" aria-hidden="true" />
                            {locale === "en" ? "Duplicate" : "Trùng lặp"}
                          </Badge>
                        )}
                        {q.ambiguousMedia && (
                          <Badge
                            variant="outline"
                            className="gap-1 border-warning/50 bg-warning-subtle text-warning-subtle-foreground"
                          >
                            <ImageIcon className="size-3" aria-hidden="true" />
                            {locale === "en" ? "Review Image" : "Kiểm tra ảnh nổi"}
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
                                ? "bg-destructive-subtle text-destructive-subtle-foreground"
                                : "bg-warning-subtle text-warning-subtle-foreground",
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
                        key={q.tempId}
                        locale={locale}
                        question={q}
                        totalQuestions={questions.length}
                        onUpdateQuestion={onUpdateQuestion}
                        onToggleOptionCorrect={handleToggleOptionCorrect}
                        onMoveMediaToQuestion={onMoveMediaToQuestion}
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

                        {/* Prompt extracted media thumbnails */}
                        {q.promptMedia && q.promptMedia.length > 0 && (
                          <div className="flex flex-wrap items-start gap-2">
                            {q.promptMedia.map((media, mediaIdx) => (
                              <MediaPreviewChip
                                key={media.id}
                                locale={locale}
                                media={media}
                                canEdit={allowInlineEdit}
                                canMoveLeft={mediaIdx > 0}
                                canMoveRight={mediaIdx < (q.promptMedia?.length ?? 0) - 1}
                                onReorder={(dir) =>
                                  onUpdateQuestion(q.tempId, (prev) => {
                                    const list = [...(prev.promptMedia ?? [])];
                                    const swapIdx = mediaIdx + dir;
                                    if (swapIdx < 0 || swapIdx >= list.length) return prev;
                                    [list[mediaIdx], list[swapIdx]] = [list[swapIdx], list[mediaIdx]];
                                    return { ...prev, promptMedia: list };
                                  })
                                }
                                onRemove={() =>
                                  onUpdateQuestion(q.tempId, (prev) => {
                                    const remaining = (prev.promptMedia ?? []).filter(
                                      (m) => m.id !== media.id,
                                    );
                                    const stillFloating =
                                      remaining.some((m) => m.ambiguous) ||
                                      prev.options.some((o) =>
                                        (o.media ?? []).some((m) => m.ambiguous),
                                      );
                                    return {
                                      ...prev,
                                      promptMedia: remaining.length > 0 ? remaining : undefined,
                                      ambiguousMedia: stillFloating ? true : undefined,
                                      issues: stillFloating
                                        ? prev.issues
                                        : prev.issues.filter(
                                            (i) => i.code !== "AMBIGUOUS_MEDIA_MAPPING",
                                          ),
                                    };
                                  })
                                }
                                onConfirmPlacement={
                                  media.ambiguous
                                    ? () =>
                                        onUpdateQuestion(q.tempId, (prev) => {
                                          const nextPromptMedia = (prev.promptMedia ?? []).map(
                                            (m) =>
                                              m.id === media.id
                                                ? { ...m, ambiguous: false }
                                                : m,
                                          );
                                          const stillFloating =
                                            nextPromptMedia.some((m) => m.ambiguous) ||
                                            prev.options.some((o) =>
                                              (o.media ?? []).some((m) => m.ambiguous),
                                            );
                                          return {
                                            ...prev,
                                            promptMedia: nextPromptMedia,
                                            ambiguousMedia: stillFloating ? true : undefined,
                                            issues: stillFloating
                                              ? prev.issues
                                              : prev.issues.filter(
                                                  (i) => i.code !== "AMBIGUOUS_MEDIA_MAPPING",
                                                ),
                                          };
                                        })
                                    : undefined
                                }
                              />
                            ))}
                          </div>
                        )}

                        {q.questionType === "flashcard" ? (
                          <div className="rounded-lg border border-success/30 bg-success-subtle px-3 py-2 text-sm text-foreground">
                            <span className="mr-2 text-xs font-semibold text-success-subtle-foreground">
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
                                    "flex flex-col gap-1.5 rounded-lg border px-3 py-2 text-left text-xs transition-colors",
                                    opt.isCorrect
                                      ? "border-success/50 bg-success-subtle font-medium text-success-subtle-foreground"
                                      : "border-border bg-background text-foreground",
                                    allowInlineEdit &&
                                      "cursor-pointer hover:border-primary/50",
                                  )}
                                >
                                  <div className="flex items-start gap-2">
                                    <span
                                      className={cn(
                                        "mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                                        opt.isCorrect
                                          ? "bg-success text-success-foreground"
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
                                      {opt.label}.{" "}
                                      {opt.content ||
                                        ((opt.media?.length ?? 0) > 0
                                          ? locale === "en"
                                            ? "(Image option)"
                                            : "(Đáp án hình ảnh)"
                                          : "")}
                                    </span>
                                  </div>
                                  {opt.media && opt.media.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5 pl-7">
                                      {opt.media.map((m) =>
                                        m.dataUrl ? (
                                          // eslint-disable-next-line @next/next/no-img-element
                                          <img
                                            key={m.id}
                                            src={m.dataUrl}
                                            alt={m.alt ?? m.fileName}
                                            className="h-14 max-w-[120px] rounded border border-border object-contain bg-background"
                                          />
                                        ) : (
                                          <Badge key={m.id} variant="outline" className="text-[10px]">
                                            <ImageIcon className="mr-1 size-3" aria-hidden="true" />
                                            {m.fileName}
                                          </Badge>
                                        ),
                                      )}
                                    </div>
                                  )}
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
        tone === "success" && "border-success/30 bg-success-subtle",
        tone === "warning" && "border-warning/30 bg-warning-subtle",
        tone === "error" && "border-destructive/30 bg-destructive-subtle",
        tone === "neutral" && "border-border bg-card",
      )}
    >
      <p className="text-xs text-muted-foreground">{label}</p>
      <p
        className={cn(
          "mt-1 text-xl font-semibold tabular-nums",
          tone === "success" && "text-success-subtle-foreground",
          tone === "warning" && "text-warning-subtle-foreground",
          tone === "error" && "text-destructive-subtle-foreground",
          tone === "neutral" && "text-foreground",
        )}
      >
        {value.toLocaleString()}
      </p>
    </div>
  );
}

interface InlineDraft {
  prompt: string;
  chapter: string;
  explanation: string;
  backText: string;
  optionContents: Record<string, string>;
}

const INLINE_EDIT_DEBOUNCE_MS = 220;

function MediaPreviewChip({
  locale,
  media,
  canEdit,
  canMoveLeft,
  canMoveRight,
  onReorder,
  onRemove,
  onConfirmPlacement,
}: {
  locale: Locale;
  media: ParsedMediaAttachment;
  canEdit: boolean;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  onReorder: (delta: -1 | 1) => void;
  onRemove: () => void;
  onConfirmPlacement?: () => void;
}) {
  return (
    <div
      className={cn(
        "group relative flex flex-col gap-1 rounded-lg border p-1.5 text-xs",
        media.ambiguous
          ? "border-warning/60 bg-warning-subtle/40"
          : "border-border bg-muted/30",
      )}
    >
      {media.dataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={media.dataUrl}
          alt={media.alt ?? media.fileName}
          className="h-20 max-w-[160px] rounded object-contain bg-background"
        />
      ) : (
        <div className="flex h-16 w-28 items-center justify-center rounded bg-muted text-muted-foreground">
          <ImageIcon className="size-5" aria-hidden="true" />
        </div>
      )}
      <div className="flex items-center justify-between gap-1">
        <span className="max-w-[110px] truncate text-[11px] text-muted-foreground" title={media.fileName}>
          {media.fileName}
        </span>
        {canEdit && (
          <div className="flex items-center gap-0.5">
            {canMoveLeft && (
              <button
                type="button"
                title={locale === "en" ? "Move left" : "Sang trái"}
                onClick={() => onReorder(-1)}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <ChevronLeft className="size-3" />
              </button>
            )}
            {canMoveRight && (
              <button
                type="button"
                title={locale === "en" ? "Move right" : "Sang phải"}
                onClick={() => onReorder(1)}
                className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <ChevronRight className="size-3" />
              </button>
            )}
            <button
              type="button"
              title={locale === "en" ? "Remove decorative image" : "Gỡ ảnh"}
              aria-label={locale === "en" ? "Remove image" : "Gỡ ảnh"}
              onClick={onRemove}
              className="rounded p-0.5 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
            >
              <X className="size-3" />
            </button>
          </div>
        )}
      </div>
      {canEdit && onConfirmPlacement && (
        <button
          type="button"
          onClick={onConfirmPlacement}
          className="rounded bg-warning/20 px-1.5 py-0.5 text-[10px] font-medium text-warning-subtle-foreground hover:bg-warning/30"
        >
          {locale === "en" ? "Confirm placement" : "Xác nhận vị trí"}
        </button>
      )}
    </div>
  );
}

function InlineQuestionEditor({
  locale,
  question,
  totalQuestions,
  onUpdateQuestion,
  onToggleOptionCorrect,
  onMoveMediaToQuestion,
}: {
  locale: Locale;
  question: ParsedQuestion;
  totalQuestions: number;
  onUpdateQuestion: (
    tempId: string,
    updater: (q: ParsedQuestion) => ParsedQuestion,
  ) => void;
  onToggleOptionCorrect: (q: ParsedQuestion, optionId: string) => void;
  onMoveMediaToQuestion?: (
    sourceTempId: string,
    mediaId: string,
    sourceSlot: "prompt" | string,
    targetQuestionIndex: number,
  ) => void;
}) {
  const [draft, setDraft] = React.useState<InlineDraft>(() => ({
    prompt: question.prompt,
    chapter: question.chapter ?? "",
    explanation: question.explanation ?? "",
    backText: question.backText ?? "",
    optionContents: Object.fromEntries(
      question.options.map((o) => [o.id, o.content]),
    ),
  }));

  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDraftRef = React.useRef<InlineDraft | null>(null);
  const onUpdateRef = React.useRef(onUpdateQuestion);
  const tempIdRef = React.useRef(question.tempId);

  React.useEffect(() => {
    onUpdateRef.current = onUpdateQuestion;
    tempIdRef.current = question.tempId;
  }, [onUpdateQuestion, question.tempId]);

  const commitDraft = React.useCallback((next: InlineDraft) => {
    pendingDraftRef.current = null;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    onUpdateRef.current(tempIdRef.current, (prev) => ({
      ...prev,
      prompt: next.prompt,
      chapter: next.chapter || null,
      explanation: next.explanation || null,
      backText: prev.questionType === "flashcard" ? next.backText : prev.backText,
      acceptedAnswers:
        prev.questionType === "flashcard"
          ? next.backText.trim()
            ? [{ answerText: next.backText.trim(), matchMode: "case_insensitive" }]
            : []
          : prev.acceptedAnswers,
      options: prev.options.map((o) =>
        Object.prototype.hasOwnProperty.call(next.optionContents, o.id)
          ? { ...o, content: next.optionContents[o.id] }
          : o,
      ),
    }));
  }, []);

  const scheduleCommit = React.useCallback(
    (next: InlineDraft) => {
      pendingDraftRef.current = next;
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        if (pendingDraftRef.current) {
          commitDraft(pendingDraftRef.current);
        }
      }, INLINE_EDIT_DEBOUNCE_MS);
    },
    [commitDraft],
  );

  const flushPending = React.useCallback(() => {
    if (pendingDraftRef.current) {
      commitDraft(pendingDraftRef.current);
    }
  }, [commitDraft]);

  React.useEffect(() => {
    return () => {
      if (pendingDraftRef.current) {
        commitDraft(pendingDraftRef.current);
      } else if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [commitDraft]);

  const updateDraft = (updater: (prev: InlineDraft) => InlineDraft) => {
    setDraft((prev) => {
      const next = updater(prev);
      scheduleCommit(next);
      return next;
    });
  };

  const addOption = () => {
    flushPending();
    const newId = crypto.randomUUID();
    setDraft((prev) => ({
      ...prev,
      optionContents: { ...prev.optionContents, [newId]: "" },
    }));
    onUpdateQuestion(question.tempId, (prev) => {
      const nextLabel = String.fromCharCode(65 + prev.options.length);
      const newOpt: ParsedOption = {
        id: newId,
        label: nextLabel,
        content: "",
        isCorrect: false,
        detectedBy: [],
      };
      return { ...prev, options: [...prev.options, newOpt] };
    });
  };

  const removeOption = (optId: string) => {
    flushPending();
    setDraft((prev) => {
      const nextMap = { ...prev.optionContents };
      delete nextMap[optId];
      return { ...prev, optionContents: nextMap };
    });
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
            value={draft.prompt}
            onBlur={flushPending}
            onChange={(e) => {
              const value = e.target.value;
              updateDraft((prev) => ({ ...prev, prompt: value }));
            }}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor={`edit-chapter-${question.tempId}`} className="text-xs">
            {locale === "en" ? "Chapter" : "Chương / Chủ đề"}
          </Label>
          <Input
            id={`edit-chapter-${question.tempId}`}
            value={draft.chapter}
            onBlur={flushPending}
            onChange={(e) => {
              const value = e.target.value;
              updateDraft((prev) => ({ ...prev, chapter: value }));
            }}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor={`edit-explanation-${question.tempId}`} className="text-xs">
            {locale === "en" ? "Explanation" : "Giải thích"}
          </Label>
          <Input
            id={`edit-explanation-${question.tempId}`}
            value={draft.explanation}
            onBlur={flushPending}
            onChange={(e) => {
              const value = e.target.value;
              updateDraft((prev) => ({ ...prev, explanation: value }));
            }}
          />
        </div>
      </div>

      {/* Embedded Media Management (reassign between Prompt / Options / other Questions, or remove decorative images) */}
      {((question.promptMedia && question.promptMedia.length > 0) ||
        question.options.some((o) => o.media && o.media.length > 0)) && (
        <div className="space-y-2 rounded-lg border border-border bg-background p-2.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
            <ArrowLeftRight className="size-3.5 text-primary" aria-hidden="true" />
            {locale === "en"
              ? "Extracted Images (Reassign or Remove)"
              : "Hình ảnh trích xuất (Gán lại hoặc Xóa)"}
          </div>
          <div className="space-y-1.5">
            {[
              ...(question.promptMedia ?? []).map((m) => ({
                media: m,
                slot: "prompt" as const,
                slotLabel: locale === "en" ? "Prompt" : "Câu hỏi",
              })),
              ...question.options.flatMap((opt) =>
                (opt.media ?? []).map((m) => ({
                  media: m,
                  slot: opt.id,
                  slotLabel: `${locale === "en" ? "Option" : "Đáp án"} ${opt.label}`,
                })),
              ),
            ].map(({ media, slot, slotLabel }) => (
              <div
                key={media.id}
                className="flex flex-wrap items-center gap-2 rounded-md border border-border/70 bg-muted/20 p-1.5 text-xs"
              >
                {media.dataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={media.dataUrl}
                    alt={media.alt ?? media.fileName}
                    className="h-10 w-14 rounded border border-border object-contain bg-background"
                  />
                ) : (
                  <ImageIcon className="size-4 text-muted-foreground" />
                )}
                <span className="max-w-[130px] truncate font-medium">{media.fileName}</span>
                <Badge variant="outline" className="text-[10px]">
                  {slotLabel}
                </Badge>
                <select
                  aria-label={locale === "en" ? "Assign image slot" : "Gán vị trí ảnh"}
                  value={slot}
                  onChange={(e) => {
                    const targetSlot = e.target.value;
                    if (targetSlot === slot) return;
                    onUpdateQuestion(question.tempId, (prev) => {
                      const cleanMedia: ParsedMediaAttachment = {
                        ...media,
                        ambiguous: false,
                      };
                      const nextPromptMedia = (prev.promptMedia ?? []).filter(
                        (m) => m.id !== media.id,
                      );
                      const nextOptions = prev.options.map((o) => ({
                        ...o,
                        media: (o.media ?? []).filter((m) => m.id !== media.id),
                      }));
                      if (targetSlot === "prompt") {
                        nextPromptMedia.push(cleanMedia);
                      } else {
                        const targetOpt = nextOptions.find((o) => o.id === targetSlot);
                        if (targetOpt) {
                          targetOpt.media = [...(targetOpt.media ?? []), cleanMedia];
                        }
                      }
                      const stillFloating =
                        nextPromptMedia.some((m) => m.ambiguous) ||
                        nextOptions.some((o) =>
                          (o.media ?? []).some((m) => m.ambiguous),
                        );
                      return {
                        ...prev,
                        promptMedia:
                          nextPromptMedia.length > 0 ? nextPromptMedia : undefined,
                        options: nextOptions.map((o) => ({
                          ...o,
                          media: o.media && o.media.length > 0 ? o.media : undefined,
                        })),
                        ambiguousMedia: stillFloating ? true : undefined,
                        issues: stillFloating
                          ? prev.issues
                          : prev.issues.filter(
                              (i) => i.code !== "AMBIGUOUS_MEDIA_MAPPING",
                            ),
                      };
                    });
                  }}
                  className="h-7 rounded border border-input bg-background px-1.5 text-xs"
                >
                  <option value="prompt">
                    {locale === "en" ? "Prompt" : "Câu hỏi"}
                  </option>
                  {question.options.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {locale === "en" ? `Option ${opt.label}` : `Đáp án ${opt.label}`}
                    </option>
                  ))}
                </select>
                {onMoveMediaToQuestion && totalQuestions > 1 && (
                  <select
                    aria-label={locale === "en" ? "Move image to question" : "Chuyển ảnh sang câu khác"}
                    defaultValue=""
                    onChange={(e) => {
                      const idxVal = Number.parseInt(e.target.value, 10);
                      if (!Number.isNaN(idxVal) && idxVal !== question.index) {
                        onMoveMediaToQuestion(question.tempId, media.id, slot, idxVal);
                      }
                    }}
                    className="h-7 rounded border border-input bg-background px-1.5 text-xs"
                  >
                    <option value="">
                      {locale === "en" ? "Move to Q#…" : "Chuyển sang câu…"}
                    </option>
                    {Array.from(
                      { length: Math.min(totalQuestions, 200) },
                      (_, i) => i,
                    )
                      .filter((i) => i !== question.index)
                      .map((i) => (
                        <option key={i} value={i}>
                          #{i + 1}
                        </option>
                      ))}
                  </select>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-7 px-2 text-destructive hover:text-destructive"
                  onClick={() =>
                    onUpdateQuestion(question.tempId, (prev) => {
                      const nextPromptMedia = (prev.promptMedia ?? []).filter(
                        (m) => m.id !== media.id,
                      );
                      const nextOptions = prev.options.map((o) => {
                        const rem = (o.media ?? []).filter((m) => m.id !== media.id);
                        return { ...o, media: rem.length > 0 ? rem : undefined };
                      });
                      const stillFloating =
                        nextPromptMedia.some((m) => m.ambiguous) ||
                        nextOptions.some((o) =>
                          (o.media ?? []).some((m) => m.ambiguous),
                        );
                      return {
                        ...prev,
                        promptMedia:
                          nextPromptMedia.length > 0 ? nextPromptMedia : undefined,
                        options: nextOptions,
                        ambiguousMedia: stillFloating ? true : undefined,
                        issues: stillFloating
                          ? prev.issues
                          : prev.issues.filter(
                              (i) => i.code !== "AMBIGUOUS_MEDIA_MAPPING",
                            ),
                      };
                    })
                  }
                >
                  <Trash2 className="mr-1 size-3" />
                  {locale === "en" ? "Remove" : "Xóa"}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {question.questionType === "flashcard" ? (
        <div className="space-y-1">
          <Label htmlFor={`edit-back-${question.tempId}`} className="text-xs">
            {locale === "en" ? "Back / Definition" : "Mặt sau / Định nghĩa"}
          </Label>
          <Textarea
            id={`edit-back-${question.tempId}`}
            rows={2}
            value={draft.backText}
            onBlur={flushPending}
            onChange={(e) => {
              const value = e.target.value;
              updateDraft((prev) => ({ ...prev, backText: value }));
            }}
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
                onCheckedChange={() => {
                  flushPending();
                  onToggleOptionCorrect(question, opt.id);
                }}
                aria-label={`${locale === "en" ? "Mark correct" : "Đánh dấu đúng"} ${opt.label}`}
              />
              <span className="w-5 text-xs font-semibold text-muted-foreground">
                {opt.label}.
              </span>
              <Input
                value={draft.optionContents[opt.id] ?? opt.content}
                onBlur={flushPending}
                onChange={(e) => {
                  const value = e.target.value;
                  updateDraft((prev) => ({
                    ...prev,
                    optionContents: { ...prev.optionContents, [opt.id]: value },
                  }));
                }}
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
