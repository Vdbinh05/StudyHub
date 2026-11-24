"use client";

import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Check, Flag, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { lText } from "@/components/learning/learning-copy";
import { cn } from "@/lib/utils";

export interface NavigatorQuestionItem {
  attemptQuestionId: string;
  position: number;
  isAnswered: boolean;
  isFlagged: boolean;
}

interface ExamNavigatorGridProps {
  items: NavigatorQuestionItem[];
  currentIndex: number;
  onSelectIndex: (index: number) => void;
  onRequestSubmit: () => void;
  isSubmitting: boolean;
}

const COLUMNS = 5;

export function ExamNavigatorGrid({
  items,
  currentIndex,
  onSelectIndex,
  onRequestSubmit,
  isSubmitting,
}: ExamNavigatorGridProps) {
  const { locale, t } = useI18n();
  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  const answeredCount = items.filter((i) => i.isAnswered).length;
  const flaggedCount = items.filter((i) => i.isFlagged).length;
  const unansweredCount = items.length - answeredCount;

  const rowCount = Math.ceil(items.length / COLUMNS);
  const useVirtual = items.length > 80;

  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 44,
    overscan: 6,
    enabled: useVirtual,
  });

  const renderTile = (item: NavigatorQuestionItem, idx: number) => {
    const isCurrent = idx === currentIndex;
    const statusParts: string[] = [];
    if (item.isAnswered) statusParts.push(t("exam.answered"));
    else statusParts.push(t("exam.unanswered"));
    if (item.isFlagged) statusParts.push(t("exam.flagged"));

    let tileStyle = "border-border bg-card text-foreground hover:bg-secondary";
    if (item.isFlagged) {
      tileStyle =
        "border-warning/60 bg-warning-subtle text-warning-subtle-foreground";
    } else if (item.isAnswered) {
      tileStyle = "border-primary/40 bg-accent text-accent-foreground";
    }

    return (
      <button
        key={item.attemptQuestionId}
        type="button"
        onClick={() => onSelectIndex(idx)}
        aria-current={isCurrent ? "step" : undefined}
        aria-label={`${lText(locale, "Câu", "Question")} ${idx + 1}: ${statusParts.join(", ")}`}
        className={cn(
          "relative flex h-10 w-full items-center justify-center rounded-md border text-xs font-semibold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          tileStyle,
          isCurrent && "ring-2 ring-primary ring-offset-1 ring-offset-background",
        )}
      >
        <span>{idx + 1}</span>
        {item.isFlagged ? (
          <Flag
            className="absolute top-0.5 right-0.5 size-2.5 fill-current"
            aria-hidden="true"
          />
        ) : item.isAnswered ? (
          <Check
            className="absolute top-0.5 right-0.5 size-2.5"
            aria-hidden="true"
          />
        ) : null}
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Legend with explicit icon + text */}
      <div className="grid grid-cols-3 gap-1.5 text-[11px]">
        <div className="flex items-center gap-1 rounded-md border border-primary/30 bg-accent px-2 py-1 text-accent-foreground">
          <Check className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate tabular-nums">
            {t("exam.answered")}: {answeredCount}
          </span>
        </div>
        <div className="flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-muted-foreground">
          <span className="truncate tabular-nums">
            {t("exam.unanswered")}: {unansweredCount}
          </span>
        </div>
        <div className="flex items-center gap-1 rounded-md border border-warning/40 bg-warning-subtle px-2 py-1 text-warning-subtle-foreground">
          <Flag className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate tabular-nums">
            {lText(locale, "Xem lại", "Flag")}: {flaggedCount}
          </span>
        </div>
      </div>

      {/* Question grid (virtualized for large exams) */}
      {useVirtual ? (
        <div
          ref={scrollRef}
          className="h-[340px] overflow-y-auto pr-1"
          aria-label={t("exam.questionNavigator")}
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
              const rowItems = items.slice(startIdx, startIdx + COLUMNS);
              return (
                <div
                  key={vRow.key}
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    transform: `translateY(${vRow.start}px)`,
                  }}
                  className="grid grid-cols-5 gap-1.5 pb-1.5"
                >
                  {rowItems.map((item, offset) =>
                    renderTile(item, startIdx + offset),
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div
          className="grid max-h-[340px] grid-cols-5 gap-1.5 overflow-y-auto pr-1"
          aria-label={t("exam.questionNavigator")}
        >
          {items.map((item, idx) => renderTile(item, idx))}
        </div>
      )}

      <Button
        className="min-h-11 w-full"
        disabled={isSubmitting}
        onClick={onRequestSubmit}
      >
        <Send className="size-4" aria-hidden="true" />
        {isSubmitting
          ? lText(locale, "Đang nộp bài...", "Submitting...")
          : t("exam.submitExam")}
      </Button>
    </div>
  );
}
