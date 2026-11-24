"use client";

import type { Locale } from "@/types/domain";

/**
 * Bilingual UI copy helper for Learning & Exam modes.
 * Supports instant Vietnamese (`vi`, default) & English (`en`) switching
 * without mutating user-authored study content.
 */
export function lText(locale: Locale, vi: string, en: string): string {
  return locale === "en" ? en : vi;
}
