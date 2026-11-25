"use client";

import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, CheckCircle2, Flag, Send, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { lText } from "@/components/learning/learning-copy";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

export interface NavigatorQuestionItem {
  attemptQuestionId: string;
  position: number;
  isAnswered: boolean;
  isFlagged: boolean;
  /** Optional subject attribution for multi-subject filtering */
  subjectId?: string | null;
  subjectTitle?: string | null;
  /** Optional correctness indicator for Practice Mode reuse */
  practiceResult?: "correct" | "incorrect" | null;
}

export interface ExamNavigatorGridProps {
  items: NavigatorQuestionItem[];
  currentIndex: number;
  answeredCount?: number;
  flaggedCount?: number;
  onSelectIndex: (index: number) => void;
  onRequestSubmit?: () => void;
  isSubmitting?: boolean;
  allowNavigation?: boolean;
  mode?: "exam" | "practice";
  jumpInputRef?: React.RefObject<HTMLInputElement | null>;
}

type NavigatorFilter = "all" | "unanswered" | "flagged";

const COLUMNS = 5;
// Exact row height: 44px (>=44px WCAG touch target) + 6px bottom gap = 50px -> ZERO drift at 500–1,000Q!
const ROW_HEIGHT_PX = 50;

export const ExamNavigatorGrid = React.memo(function ExamNavigatorGrid({
  items,
  currentIndex,
  answeredCount: answeredCountProp,
  flaggedCount: flaggedCountProp,
  onSelectIndex,
  onRequestSubmit,
  isSubmitting = false,
  allowNavigation = true,
  mode = "exam",
  jumpInputRef,
}: ExamNavigatorGridProps) {
  const { locale, t } = useI18n();
  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  const [statusFilter, setStatusFilter] = React.useState<NavigatorFilter>("all");
  const [subjectFilter, setSubjectFilter] = React.useState<string>("all");
  const [jumpDraft, setJumpDraft] = React.useState<string>("");

  const answeredCount =
    answeredCountProp ?? items.filter((i) => i.isAnswered).length;
  const flaggedCount =
    flaggedCountProp ?? items.filter((i) => i.isFlagged).length;
  const unansweredCount = items.length - answeredCount;

  // Distinct subjects list when multi-subject exam
  const subjects = React.useMemo(() => {
    const map = new Map<string, { id: string; title: string; count: number }>();
    for (const item of items) {
      if (!item.subjectTitle) continue;
      const key = item.subjectId ?? item.subjectTitle;
      const existing = map.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        map.set(key, { id: key, title: item.subjectTitle, count: 1 });
      }
    }
    return Array.from(map.values());
  }, [items]);

  // Map filtered items keeping their original global index!
  const filteredEntries = React.useMemo(() => {
    const out: Array<{ item: NavigatorQuestionItem; globalIndex: number }> = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (statusFilter === "unanswered" && item.isAnswered) continue;
      if (statusFilter === "flagged" && !item.isFlagged) continue;
      if (subjectFilter !== "all") {
        const key = item.subjectId ?? item.subjectTitle ?? "";
        if (key !== subjectFilter) continue;
      }
      out.push({ item, globalIndex: i });
    }
    return out;
  }, [items, statusFilter, subjectFilter]);

  const rowCount = Math.ceil(filteredEntries.length / COLUMNS);
  const useVirtual = filteredEntries.length > 60;

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT_PX,
    overscan: 6,
    enabled: useVirtual,
  });

  const filteredEntriesRef = React.useRef(filteredEntries);
  filteredEntriesRef.current = filteredEntries;

  // Auto-scroll active question row ONLY when `currentIndex` or active filters change
  // — NEVER on answerMap / flag updates (fixes PERF-07!)
  React.useEffect(() => {
    if (!useVirtual) return;
    const posInFiltered = filteredEntriesRef.current.findIndex(
      (e) => e.globalIndex === currentIndex,
    );
    if (posInFiltered < 0) return;
    const activeRow = Math.floor(posInFiltered / COLUMNS);
    rowVirtualizer.scrollToIndex(activeRow, { align: "auto" });
  }, [currentIndex, statusFilter, subjectFilter, rowVirtualizer, useVirtual]);

  const handleJumpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const num = Number(jumpDraft.trim());
    if (Number.isInteger(num) && num >= 1 && num <= items.length) {
      onSelectIndex(num - 1);
      setJumpDraft("");
    }
  };

  const renderTile = (item: NavigatorQuestionItem, globalIndex: number) => {
    const isCurrent = globalIndex === currentIndex;
    const statusParts: string[] = [];

    if (mode === "practice" && item.practiceResult) {
      statusParts.push(
        item.practiceResult === "correct"
          ? t("study.correct")
          : t("study.incorrect"),
      );
    } else if (item.isAnswered) {
      statusParts.push(t("exam.answered"));
    } else {
      statusParts.push(t("exam.unanswered"));
    }
    if (item.isFlagged) statusParts.push(t("exam.flagged"));
    if (item.subjectTitle) statusParts.push(item.subjectTitle);

    // Dual-state clarity (BUG-033): Flagged preserves Answered tint AND adds amber ring/badge!
    let tileStyle = "border-input bg-card text-foreground hover:bg-secondary";
    if (mode === "practice" && item.practiceResult === "correct") {
      tileStyle =
        "border-success/60 bg-success-subtle text-success-subtle-foreground";
    } else if (mode === "practice" && item.practiceResult === "incorrect") {
      tileStyle =
        "border-destructive/60 bg-destructive-subtle text-destructive-subtle-foreground";
    } else if (item.isAnswered && item.isFlagged) {
      tileStyle =
        "border-warning bg-accent text-accent-foreground";
    } else if (item.isFlagged) {
      tileStyle =
        "border-warning/70 bg-warning-subtle text-warning-subtle-foreground";
    } else if (item.isAnswered) {
      tileStyle = "border-primary/50 bg-accent text-accent-foreground";
    }

    return (
      <button
        key={item.attemptQuestionId}
        type="button"
        disabled={!allowNavigation && !isCurrent}
        onClick={() => onSelectIndex(globalIndex)}
        aria-current={isCurrent ? "step" : undefined}
        aria-label={`${lText(locale, "Câu", "Question")} ${globalIndex + 1}: ${statusParts.join(", ")}`}
        className={cn(
          "relative flex h-11 w-full items-center justify-center rounded-md border text-xs font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
          tileStyle,
          isCurrent && "ring-2 ring-primary ring-offset-1 ring-offset-background",
        )}
      >
        <span>{globalIndex + 1}</span>
        {/* Top-right Flag icon visible even when answered */}
        {item.isFlagged ? (
          <Flag
            className="absolute top-0.5 right-0.5 size-2.5 text-warning-subtle-foreground fill-current"
            aria-hidden="true"
          />
        ) : null}
        {/* Bottom-right Answered / Correct / Incorrect icon (color-independent!) */}
        {mode === "practice" && item.practiceResult === "correct" ? (
          <CheckCircle2
            className="absolute bottom-0.5 right-0.5 size-2.5"
            aria-hidden="true"
          />
        ) : mode === "practice" && item.practiceResult === "incorrect" ? (
          <XCircle
            className="absolute bottom-0.5 right-0.5 size-2.5"
            aria-hidden="true"
          />
        ) : item.isAnswered ? (
          <Check
            className="absolute bottom-0.5 right-0.5 size-2.5"
            aria-hidden="true"
          />
        ) : null}
      </button>
    );
  };

  return (
    <nav
      aria-label={t("exam.questionNavigator")}
      className="flex flex-col gap-3"
    >
      {/* Legend (flex-wrap, non-truncating 12px labels with icons) */}
      <div className="flex flex-wrap items-center gap-1.5 text-xs">
        <span className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-accent px-2 py-1 text-accent-foreground tabular-nums">
          <Check className="size-3 shrink-0" aria-hidden="true" />
          {t("exam.answered")}: {answeredCount}
        </span>
        <span className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-muted-foreground tabular-nums">
          {t("exam.unanswered")}: {unansweredCount}
        </span>
        {mode === "exam" ? (
          <span className="inline-flex items-center gap-1 rounded-md border border-warning/50 bg-warning-subtle px-2 py-1 text-warning-subtle-foreground tabular-nums">
            <Flag className="size-3 shrink-0" aria-hidden="true" />
            {lText(locale, "Đánh dấu", "Marked")}: {flaggedCount}
          </span>
        ) : null}
      </div>

      {/* Filter Pills */}
      <div
        role="group"
        aria-label={lText(locale, "Lọc câu hỏi", "Filter questions")}
        className="grid grid-cols-3 gap-1"
      >
        <Button
          type="button"
          size="sm"
          variant={statusFilter === "all" ? "default" : "outline"}
          className="min-h-11 sm:min-h-9 px-2 text-xs tabular-nums"
          aria-pressed={statusFilter === "all"}
          onClick={() => setStatusFilter("all")}
        >
          {lText(locale, "Tất cả", "All")} ({items.length})
        </Button>
        <Button
          type="button"
          size="sm"
          variant={statusFilter === "unanswered" ? "default" : "outline"}
          className="min-h-11 sm:min-h-9 px-2 text-xs tabular-nums"
          aria-pressed={statusFilter === "unanswered"}
          onClick={() => setStatusFilter("unanswered")}
        >
          {lText(locale, "Chưa làm", "Open")} ({unansweredCount})
        </Button>
        {mode === "exam" ? (
          <Button
            type="button"
            size="sm"
            variant={statusFilter === "flagged" ? "default" : "outline"}
            className="min-h-11 sm:min-h-9 px-2 text-xs tabular-nums"
            aria-pressed={statusFilter === "flagged"}
            onClick={() => setStatusFilter("flagged")}
          >
            {lText(locale, "Đánh dấu", "Flag")} ({flaggedCount})
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="min-h-11 sm:min-h-9 px-2 text-xs"
            onClick={() => {
              setStatusFilter("all");
              setSubjectFilter("all");
            }}
          >
            {lText(locale, "Đặt lại", "Reset")}
          </Button>
        )}
      </div>

      {/* Subject Filter Dropdown (multi-subject exams) */}
      {subjects.length > 1 ? (
        <Select value={subjectFilter} onValueChange={setSubjectFilter}>
          <SelectTrigger
            className="h-9 text-xs"
            aria-label={lText(locale, "Lọc theo môn học", "Filter by subject")}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              {lText(locale, "Tất cả môn học", "All subjects")} ({items.length})
            </SelectItem>
            {subjects.map((sub) => (
              <SelectItem key={sub.id} value={sub.id}>
                {sub.title} ({sub.count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}

      {/* Quick Jump # input for 250–1,000Q banks */}
      {items.length > 30 && allowNavigation ? (
        <form onSubmit={handleJumpSubmit} className="flex items-center gap-1.5">
          <Input
            ref={jumpInputRef}
            type="text"
            inputMode="numeric"
            value={jumpDraft}
            onChange={(e) => setJumpDraft(e.target.value)}
            placeholder={lText(
              locale,
              `Tới câu # (1–${items.length})`,
              `Jump to # (1–${items.length})`,
            )}
            aria-label={lText(locale, "Nhảy nhanh tới câu số", "Jump to question number")}
            className="h-9 text-xs tabular-nums"
          />
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            className="min-h-11 sm:min-h-9 shrink-0 px-3 text-xs"
            disabled={!jumpDraft.trim()}
          >
            {lText(locale, "Đi", "Go")}
          </Button>
        </form>
      ) : null}

      {/* Zero-drift Virtualized Question Grid with subtle scroll cue (RU-21) */}
      {filteredEntries.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
          {lText(locale, "Không có câu hỏi nào trong bộ lọc này.", "No questions match this filter.")}
        </p>
      ) : useVirtual ? (
        <div className="relative">
          <div
            ref={scrollRef}
            className="h-[340px] overflow-y-auto pr-1 pb-4"
            tabIndex={0}
          >
            <div
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                position: "relative",
                width: "100%",
              }}
            >
              {rowVirtualizer.getVirtualItems().map((vRow) => {
                const startIdx = vRow.index * COLUMNS;
                const rowEntries = filteredEntries.slice(
                  startIdx,
                  startIdx + COLUMNS,
                );
                return (
                  <div
                    key={vRow.key}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      height: `${ROW_HEIGHT_PX}px`,
                      transform: `translateY(${vRow.start}px)`,
                    }}
                    className="grid grid-cols-5 gap-1.5 pb-1.5"
                  >
                    {rowEntries.map((entry) =>
                      renderTile(entry.item, entry.globalIndex),
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          {rowCount > 6 ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 h-6 rounded-b-md bg-gradient-to-t from-card via-card/75 to-transparent"
            />
          ) : null}
        </div>
      ) : (
        <div className="relative">
          <div className="grid max-h-[340px] grid-cols-5 gap-1.5 overflow-y-auto pr-1 pb-3">
            {filteredEntries.map((entry) =>
              renderTile(entry.item, entry.globalIndex),
            )}
          </div>
          {rowCount > 6 ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 h-6 rounded-b-md bg-gradient-to-t from-card via-card/75 to-transparent"
            />
          ) : null}
        </div>
      )}

      {mode === "exam" && onRequestSubmit ? (
        <Button
          type="button"
          className="min-h-11 w-full"
          disabled={isSubmitting}
          onClick={onRequestSubmit}
        >
          <Send className="size-4" aria-hidden="true" />
          {isSubmitting
            ? lText(locale, "Đang nộp bài...", "Submitting...")
            : t("exam.submitExam")}
        </Button>
      ) : null}
    </nav>
  );
});
