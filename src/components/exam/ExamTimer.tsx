"use client";

import * as React from "react";
import { Clock } from "lucide-react";
import { toast } from "sonner";
import { lText } from "@/components/learning/learning-copy";
import { useI18n } from "@/lib/i18n";
import {
  calculateRemainingMs,
  formatCountdownMs,
} from "@/lib/learning/exam-scoring";
import { cn } from "@/lib/utils";

export interface ExamTimerProps {
  expiresAtIso: string | null | undefined;
  serverClockOffsetMs: number;
  active: boolean;
  autoSubmitOnExpire?: boolean;
  onExpire: () => void;
}

/**
 * Isolated memoized countdown timer leaf.
 * Ticks strictly on second boundaries so timer updates NEVER re-render
 * `LiveExamRunner`, the active question card, or `ExamNavigatorGrid` (SH-028).
 */
export const ExamTimer = React.memo(function ExamTimer({
  expiresAtIso,
  serverClockOffsetMs,
  active,
  autoSubmitOnExpire = true,
  onExpire,
}: ExamTimerProps) {
  const { locale, t } = useI18n();
  const [remainingSeconds, setRemainingSeconds] = React.useState<number | null>(
    () => {
      const ms = calculateRemainingMs(
        expiresAtIso,
        Date.now(),
        serverClockOffsetMs,
      );
      return ms === null ? null : Math.max(0, Math.ceil(ms / 1000));
    },
  );
  const [announcement, setAnnouncement] = React.useState<string>("");

  const warnedFiveMinRef = React.useRef(false);
  const warnedOneMinRef = React.useRef(false);
  const warnedTenSecRef = React.useRef(false);
  const expiredTriggeredRef = React.useRef(false);
  const onExpireRef = React.useRef(onExpire);

  React.useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  React.useEffect(() => {
    if (!active || !expiresAtIso) {
      return;
    }

    const tick = () => {
      const remMs = calculateRemainingMs(
        expiresAtIso,
        Date.now(),
        serverClockOffsetMs,
      );
      if (remMs === null) return;
      const secs = Math.max(0, Math.ceil(remMs / 1000));

      setRemainingSeconds((prev) => (prev === secs ? prev : secs));

      if (secs <= 300 && secs > 60 && !warnedFiveMinRef.current) {
        warnedFiveMinRef.current = true;
        setAnnouncement(
          lText(locale, "Còn 5 phút làm bài.", "5 minutes remaining."),
        );
      }

      if (secs <= 60 && secs > 0 && !warnedOneMinRef.current) {
        warnedOneMinRef.current = true;
        const msg = lText(
          locale,
          "Còn dưới 1 phút! Hệ thống sẽ tự động nộp bài khi hết giờ.",
          "Less than 1 minute remaining! Exam will auto-submit at 00:00.",
        );
        setAnnouncement(msg);
        toast.warning(msg);
      }

      if (secs <= 10 && secs > 0 && !warnedTenSecRef.current) {
        warnedTenSecRef.current = true;
        setAnnouncement(
          lText(locale, "Còn 10 giây cuối cùng.", "10 seconds remaining."),
        );
      }

      if (secs <= 0 && !expiredTriggeredRef.current) {
        expiredTriggeredRef.current = true;
        if (autoSubmitOnExpire) {
          onExpireRef.current();
        }
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [active, autoSubmitOnExpire, expiresAtIso, locale, serverClockOffsetMs]);

  if (remainingSeconds === null) {
    return null;
  }

  const isLowTime = remainingSeconds <= 300;
  const isCriticalTime = remainingSeconds <= 60;

  return (
    <>
      <div
        role="timer"
        aria-label={t("exam.remainingTime")}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-xs sm:text-sm font-semibold tabular-nums",
          isCriticalTime
            ? "border-destructive bg-destructive-subtle text-destructive-subtle-foreground"
            : isLowTime
              ? "border-warning bg-warning-subtle text-warning-subtle-foreground"
              : "border-border bg-card text-foreground",
        )}
      >
        <Clock className="size-3.5 sm:size-4 shrink-0" aria-hidden="true" />
        <span>{formatCountdownMs(remainingSeconds * 1000)}</span>
      </div>
      {/* Polite landmark announcement ONLY at 5m, 1m, 10s milestones */}
      <span className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
    </>
  );
});
