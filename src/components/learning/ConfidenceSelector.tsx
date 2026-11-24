"use client";

import * as React from "react";
import { CheckCircle2, HelpCircle, ShieldAlert } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { isEditableEventTarget } from "@/lib/learning/api-client";
import {
  CONFIDENCE_OPTIONS,
  mapKeyToConfidence,
} from "@/lib/learning/confidence";
import type { ConfidenceLevel } from "@/types/domain";
import { cn } from "@/lib/utils";
import { lText } from "./learning-copy";

export interface ConfidenceSelectorProps {
  value: ConfidenceLevel | null;
  onChange: (value: ConfidenceLevel | null) => void;
  /** When false, renders nothing so there are zero extra clicks when disabled. */
  enabled?: boolean;
  /** Lock selection once correctness has been revealed (confidence must be pre-reveal). */
  disabled?: boolean;
  /** Enable keyboard shortcuts (`C`/`U`/`G`, and optionally `1`/`2`/`3` when not conflicting with MC options). */
  keyboardMode?: "none" | "letters" | "letters_and_numbers";
  /** Show calm disclosure that confidence never alters exam score. */
  isExamContext?: boolean;
  compact?: boolean;
  className?: string;
}

export function ConfidenceSelector({
  value,
  onChange,
  enabled = true,
  disabled = false,
  keyboardMode = "letters",
  isExamContext = false,
  compact = false,
  className,
}: ConfidenceSelectorProps) {
  const { locale } = useI18n();

  React.useEffect(() => {
    if (!enabled || disabled || keyboardMode === "none") return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.isComposing || e.keyCode === 229) return;
      if (isEditableEventTarget(e.target)) return;

      const key = e.key.toLowerCase();
      if (
        keyboardMode === "letters" &&
        (key === "1" || key === "2" || key === "3")
      ) {
        return;
      }

      const mapped = mapKeyToConfidence(key);
      if (!mapped) return;

      e.preventDefault();
      onChange(value === mapped ? null : mapped);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [disabled, enabled, keyboardMode, onChange, value]);

  if (!enabled) return null;

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-secondary/30 px-3 py-2.5",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">
          {lText(
            locale,
            "Mức độ tự tin trước khi kiểm tra:",
            "Confidence before checking:",
          )}
        </span>
        {isExamContext ? (
          <span className="text-[11px] text-muted-foreground">
            {lText(
              locale,
              "Không ảnh hưởng điểm bài thi",
              "Never affects exam score",
            )}
          </span>
        ) : null}
      </div>

      <div
        role="radiogroup"
        aria-label={lText(locale, "Chọn mức độ tự tin", "Select confidence level")}
        className={cn(
          "mt-2 grid grid-cols-3 gap-2",
          compact && "gap-1.5",
        )}
      >
        {CONFIDENCE_OPTIONS.map((opt) => {
          const selected = value === opt.level;
          const Icon =
            opt.level === "certain"
              ? CheckCircle2
              : opt.level === "unsure"
                ? HelpCircle
                : ShieldAlert;

          const selectedTone =
            opt.level === "certain"
              ? "border-success bg-success-subtle text-success-subtle-foreground ring-1 ring-success/40"
              : opt.level === "unsure"
                ? "border-warning bg-warning-subtle text-warning-subtle-foreground ring-1 ring-warning/40"
                : "border-primary bg-accent text-accent-foreground ring-1 ring-primary/40";

          const shortcutLabel =
            keyboardMode === "letters_and_numbers"
              ? `${opt.numberKey}/${opt.letterKey.toUpperCase()}`
              : keyboardMode === "letters"
                ? opt.letterKey.toUpperCase()
                : null;

          return (
            <button
              key={opt.level}
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              title={lText(locale, opt.viDesc, opt.enDesc)}
              onClick={() => onChange(selected ? null : opt.level)}
              className={cn(
                "flex min-h-10 items-center justify-center gap-1.5 rounded-md border px-2 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60",
                selected
                  ? selectedTone
                  : "border-border bg-card text-foreground hover:bg-muted/60",
              )}
            >
              <Icon className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">
                {lText(locale, opt.viShort, opt.enShort)}
              </span>
              {shortcutLabel && !compact ? (
                <kbd className="hidden rounded bg-background/70 px-1 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline">
                  {shortcutLabel}
                </kbd>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
