"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BookOpen,
  Brain,
  CheckSquare,
  ChevronDown,
  Headphones,
  Layers,
  PenLine,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Progress } from "@/components/ui/progress";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { lText } from "./learning-copy";

export type FocusSwitcherMode =
  | "flashcards"
  | "practice"
  | "learn"
  | "spell"
  | "write";

const SWITCHER_MODES: ReadonlyArray<{
  id: FocusSwitcherMode;
  vi: string;
  en: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: "flashcards", vi: "Thẻ ghi nhớ", en: "Flashcards", icon: Layers },
  { id: "practice", vi: "Luyện tập", en: "Practice", icon: CheckSquare },
  { id: "learn", vi: "Học sâu", en: "Learn", icon: Brain },
  { id: "spell", vi: "Nghe & Gõ", en: "Spell", icon: Headphones },
  { id: "write", vi: "Tự luận", en: "Write", icon: PenLine },
];

export interface FocusModeShellProps {
  backHref: string;
  backLabel?: string;
  title: string;
  subtitle?: string;
  /** When provided alongside `activeMode`, renders a compact direct mode switcher (`RU-17`). */
  studySetId?: string;
  activeMode?: FocusSwitcherMode;
  progressCurrent?: number;
  progressTotal?: number;
  headerRight?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /**
   * Set to `true` (default) on dedicated focus routes where AppShell omits `<main>`.
   * Set to `false` if embedded inside a standard AppShell route to avoid nested `<main id="main-content">` (SH-027).
   */
  asMain?: boolean;
  onBeforeBack?: (event: React.MouseEvent<HTMLAnchorElement>) => void;
}

export function FocusModeShell({
  backHref,
  backLabel,
  title,
  subtitle,
  studySetId,
  activeMode,
  progressCurrent,
  progressTotal,
  headerRight,
  children,
  className,
  asMain = true,
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

  const BodyTag = asMain ? "main" : "div";
  const currentModeMeta = activeMode
    ? SWITCHER_MODES.find((m) => m.id === activeMode) ?? null
    : null;
  const CurrentModeIcon = currentModeMeta?.icon ?? BookOpen;

  return (
    <div className="min-h-dvh bg-background text-foreground flex flex-col">
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur-xs">
        {/* Responsive 2-row mobile layout (`<sm`, 320px–639px) + single-row desktop bar (`sm:`):
            Row 1 on mobile keeps every action >=44px & counter strictly single-line with zero horizontal clipping (`V32-035` / `RU-12`).
            Row 2 on mobile gives the set title full horizontal width so it never crushes to 1 letter. */}
        <div className="mx-auto flex max-w-6xl flex-col gap-1 px-2 py-1.5 sm:h-14 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-4 sm:py-0">
          {/* Mobile Row 1 / Desktop Left+Right wrapper using `sm:contents` so desktop stays a clean 3-part row */}
          <div className="flex w-full min-w-0 items-center justify-between gap-1.5 sm:contents">
            {/* Left: Back button + optional Direct Mode Switcher */}
            <div className="flex shrink-0 items-center gap-1 sm:order-1 sm:gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="size-11 shrink-0 p-0 sm:h-9 sm:w-auto sm:min-h-9 sm:min-w-9 sm:px-3"
                asChild
              >
                <Link
                  href={backHref}
                  onClick={onBeforeBack}
                  aria-label={
                    backLabel ??
                    lText(locale, "Quay lại học phần", "Back to study set")
                  }
                >
                  <ArrowLeft className="size-4" aria-hidden="true" />
                  <span className="hidden sm:inline">
                    {backLabel ?? lText(locale, "Quay lại", "Back")}
                  </span>
                </Link>
              </Button>

              {studySetId && currentModeMeta ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-11 min-w-11 shrink-0 gap-1 px-2 text-xs font-medium sm:min-h-9 sm:min-w-0 sm:px-2.5"
                      aria-label={lText(
                        locale,
                        `Chuyển chế độ học (đang ở ${currentModeMeta.vi})`,
                        `Switch study mode (current: ${currentModeMeta.en})`,
                      )}
                    >
                      <CurrentModeIcon className="size-4 text-primary shrink-0 sm:size-3.5" aria-hidden="true" />
                      <span className="hidden sm:inline">
                        {lText(locale, currentModeMeta.vi, currentModeMeta.en)}
                      </span>
                      <ChevronDown className="size-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-48">
                    {SWITCHER_MODES.map((m) => {
                      const Icon = m.icon;
                      const isCurrent = m.id === activeMode;
                      return (
                        <DropdownMenuItem
                          key={m.id}
                          asChild
                          className={cn(
                            "min-h-10 gap-2 cursor-pointer",
                            isCurrent && "bg-accent font-semibold text-accent-foreground",
                          )}
                        >
                          <Link href={`/sets/${studySetId}/${m.id}`}>
                            <Icon className="size-4 shrink-0" aria-hidden="true" />
                            <span>{lText(locale, m.vi, m.en)}</span>
                          </Link>
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>

            {/* Right: Single-line progress counter pill + Mode-specific controls */}
            <div className="flex min-w-0 shrink-0 items-center gap-1 sm:order-3 sm:gap-2">
              {hasProgress ? (
                <span
                  className="shrink-0 whitespace-nowrap rounded-full bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground tabular-nums sm:px-2.5"
                  aria-label={lText(
                    locale,
                    `Tiến độ ${progressCurrent} trên ${progressTotal}`,
                    `Progress ${progressCurrent} of ${progressTotal}`,
                  )}
                >
                  <span className="sm:hidden">
                    {progressCurrent}/{progressTotal}
                  </span>
                  <span className="hidden sm:inline">
                    {progressCurrent} / {progressTotal}
                  </span>
                </span>
              ) : null}
              {headerRight}
            </div>
          </div>

          {/* Title & Subtitle: full-width secondary line on mobile (`<sm`), inline center on desktop (`sm:`) */}
          <div className="flex min-w-0 items-center justify-between gap-2 border-t border-border/50 pt-1 sm:order-2 sm:block sm:flex-1 sm:border-t-0 sm:pt-0">
            <h1 className="min-w-0 truncate text-xs font-semibold text-foreground sm:text-base">
              {title}
            </h1>
            {currentModeMeta ? (
              <span className="shrink-0 whitespace-nowrap text-[11px] font-medium text-muted-foreground sm:hidden">
                {lText(locale, currentModeMeta.vi, currentModeMeta.en)}
              </span>
            ) : null}
            {subtitle ? (
              <p className="hidden truncate text-xs text-muted-foreground sm:block">
                {subtitle}
              </p>
            ) : null}
          </div>
        </div>

        {hasProgress ? (
          <Progress
            value={percent}
            className="h-0.5 rounded-none bg-secondary"
            aria-label={lText(locale, "Thanh tiến độ phiên học", "Session progress")}
          />
        ) : null}
      </header>

      <BodyTag
        {...(asMain ? { id: "main-content" } : {})}
        className={cn(
          "mx-auto flex w-full max-w-6xl flex-1 flex-col px-3 sm:px-4 py-5 sm:py-6",
          className,
        )}
      >
        {children}
      </BodyTag>
    </div>
  );
}
