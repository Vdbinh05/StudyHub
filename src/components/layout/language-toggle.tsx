"use client";

import * as React from "react";
import { Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import type { Locale } from "@/types/domain";

interface LanguageToggleProps {
  onPersist?: (locale: Locale) => void;
  className?: string;
}

export function LanguageToggle({ onPersist, className }: LanguageToggleProps) {
  const { locale, setLocale } = useI18n();

  const handleToggle = () => {
    const next: Locale = locale === "vi" ? "en" : "vi";
    setLocale(next);
    onPersist?.(next);
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleToggle}
      aria-label={
        locale === "vi"
          ? "Chuyển ngôn ngữ giao diện sang tiếng Anh"
          : "Switch interface language to Vietnamese"
      }
      className={className ?? "h-9 gap-1.5 px-2.5 font-mono text-xs font-semibold"}
    >
      <Languages className="size-4" aria-hidden="true" />
      <span>{locale.toUpperCase()}</span>
    </Button>
  );
}
