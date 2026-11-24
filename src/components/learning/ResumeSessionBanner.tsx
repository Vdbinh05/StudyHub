"use client";

import * as React from "react";
import { AlertTriangle, Play, RotateCcw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { lText } from "./learning-copy";

export interface ResumeSessionBannerProps {
  modeLabel: string;
  currentIndex: number;
  totalItems: number;
  progressPercent: number;
  updatedAt?: string | null;
  source?: "remote" | "local";
  /** Number of saved questions that were deleted from the set since checkpoint save. */
  removedQuestionsCount?: number;
  onContinue: () => void;
  onRestart: () => void;
  onDiscard: () => void;
  isBusy?: boolean;
  className?: string;
}

export function ResumeSessionBanner({
  modeLabel,
  currentIndex,
  totalItems,
  progressPercent,
  updatedAt,
  source = "remote",
  removedQuestionsCount = 0,
  onContinue,
  onRestart,
  onDiscard,
  isBusy = false,
  className,
}: ResumeSessionBannerProps) {
  const { locale } = useI18n();
  const clampedPercent = Math.max(0, Math.min(100, Math.round(progressPercent)));

  const updatedLabel = React.useMemo(() => {
    if (!updatedAt) return null;
    try {
      return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(updatedAt));
    } catch {
      return null;
    }
  }, [locale, updatedAt]);

  return (
    <Card
      className={cn(
        "border-primary/35 bg-accent/40 shadow-xs",
        className,
      )}
    >
      <CardContent className="space-y-3 py-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="default">
                {lText(locale, "Đang học dở", "In-Progress Session")}
              </Badge>
              <span className="text-sm font-semibold text-foreground">
                {modeLabel}
              </span>
              {source === "local" ? (
                <Badge variant="outline" className="text-[11px]">
                  {lText(locale, "Bản lưu ngoại tuyến", "Saved Offline")}
                </Badge>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground tabular-nums">
              {lText(
                locale,
                `Đã lưu tại câu ${Math.min(currentIndex + 1, Math.max(1, totalItems))}/${totalItems} (${clampedPercent}%)`,
                `Saved at item ${Math.min(currentIndex + 1, Math.max(1, totalItems))}/${totalItems} (${clampedPercent}%)`,
              )}
              {updatedLabel ? ` · ${updatedLabel}` : ""}
            </p>
            {removedQuestionsCount > 0 ? (
              <p className="flex items-center gap-1.5 text-xs text-warning-subtle-foreground">
                <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
                {lText(
                  locale,
                  `${removedQuestionsCount} câu hỏi trong phiên trước đã bị xóa khỏi học phần và được bỏ qua an toàn.`,
                  `${removedQuestionsCount} question(s) from the prior session were deleted and safely skipped.`,
                )}
              </p>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="min-h-10"
              disabled={isBusy}
              onClick={onContinue}
            >
              <Play className="size-4" aria-hidden="true" />
              {lText(locale, "Tiếp tục học", "Continue")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="min-h-10"
              disabled={isBusy}
              onClick={onRestart}
            >
              <RotateCcw className="size-4" aria-hidden="true" />
              {lText(locale, "Bắt đầu lại", "Restart")}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="min-h-10 text-muted-foreground hover:text-destructive"
              disabled={isBusy}
              onClick={onDiscard}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              {lText(locale, "Xóa tạm", "Discard")}
            </Button>
          </div>
        </div>

        <Progress
          value={clampedPercent}
          className="h-1.5"
          aria-label={lText(
            locale,
            `Tiến độ phiên đang học dở: ${clampedPercent}%`,
            `Saved session progress: ${clampedPercent}%`,
          )}
        />
      </CardContent>
    </Card>
  );
}
