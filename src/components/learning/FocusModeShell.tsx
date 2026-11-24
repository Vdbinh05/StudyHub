"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { lText } from "./learning-copy";

export interface FocusModeShellProps {
  backHref: string;
  backLabel?: string;
  title: string;
  subtitle?: string;
  progressCurrent?: number;
  progressTotal?: number;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  onBeforeBack?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}

export function FocusModeShell({
  backHref,
  backLabel,
  title,
  subtitle,
  progressCurrent,
  progressTotal,
  headerRight,
  children,
  className,
  onBeforeBack,
}: FocusModeShellProps) {
  const { locale } = useI18n();
  const hasProgress =
    typeof progressCurrent === "number" &&
    typeof progressTotal === "number" &&
    progressTotal > 0;
  const percent = hasProgress
    ? Math.min(100, Math.round((progressCurrent / progressTotal) * 100))
    : 0;

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur-xs">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <Button
              variant="ghost"
              size="sm"
              className="min-h-10 min-w-10 px-2 sm:px-3"
              asChild
            >
              <Link
                href={backHref}
                onClick={onBeforeBack}
                aria-label={backLabel ?? lText(locale, "Quay lại học phần", "Back to study set")}
              >
                <ArrowLeft className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">
                  {backLabel ?? lText(locale, "Quay lại", "Back")}
                </span>
              </Link>
            </Button>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold sm:text-base">
                {title}
              </h1>
              {subtitle ? (
                <p className="truncate text-xs text-muted-foreground">
                  {subtitle}
                </p>
              ) : null}
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {hasProgress ? (
              <span
                className="rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-secondary-foreground tabular-nums"
                aria-label={lText(
                  locale,
                  `Tiến độ ${progressCurrent} trên ${progressTotal}`,
                  `Progress ${progressCurrent} of ${progressTotal}`,
                )}
              >
                {progressCurrent} / {progressTotal}
              </span>
            ) : null}
            {headerRight}
          </div>
        </div>

        {hasProgress ? (
          <Progress
            value={percent}
            className="h-1 rounded-none bg-secondary"
            aria-label={lText(locale, "Thanh tiến độ phiên học", "Session progress")}
          />
        ) : null}
      </header>

      <main
        id="main-content"
        className={cn(
          "mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 py-6",
          className,
        )}
      >
        {children}
      </main>
    </div>
  );
}
