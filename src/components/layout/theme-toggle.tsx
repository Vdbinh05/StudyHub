"use client";

import * as React from "react";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18n } from "@/lib/i18n";
import type { ThemePreference } from "@/types/domain";

interface ThemeToggleProps {
  onPersist?: (theme: ThemePreference) => void;
  compact?: boolean;
}

const emptySubscribe = () => () => {};

export function ThemeToggle({ onPersist, compact = false }: ThemeToggleProps) {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const { t, locale } = useI18n();
  const mounted = React.useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );

  const handleSelect = (next: ThemePreference) => {
    setTheme(next);
    onPersist?.(next);
  };

  const label = locale === "vi" ? "Đổi giao diện sáng tối" : "Switch color theme";
  const activeTheme = mounted ? (theme ?? "system") : "system";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size={compact ? "icon" : "sm"}
          aria-label={label}
          className={
            compact
              ? "min-h-11 min-w-11 sm:min-h-9 sm:min-w-9 sm:size-9"
              : "min-h-11 gap-1.5 px-2.5 sm:min-h-9"
          }
        >
          {!mounted ? (
            <Sun className="size-4" aria-hidden="true" />
          ) : resolvedTheme === "dark" ? (
            <Moon className="size-4" aria-hidden="true" />
          ) : (
            <Sun className="size-4" aria-hidden="true" />
          )}
          {!compact && (
            <span className="hidden text-xs font-medium xl:inline">
              {activeTheme === "dark"
                ? t("settings.themeDark")
                : activeTheme === "light"
                  ? t("settings.themeLight")
                  : t("settings.themeSystem")}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem
          role="menuitemradio"
          aria-checked={activeTheme === "light"}
          onClick={() => handleSelect("light")}
          className={activeTheme === "light" ? "bg-secondary font-medium" : undefined}
        >
          <Sun className="size-4" aria-hidden="true" />
          <span>{t("settings.themeLight")}</span>
          {activeTheme === "light" && (
            <Check className="text-primary ml-auto size-4" aria-hidden="true" />
          )}
        </DropdownMenuItem>
        <DropdownMenuItem
          role="menuitemradio"
          aria-checked={activeTheme === "dark"}
          onClick={() => handleSelect("dark")}
          className={activeTheme === "dark" ? "bg-secondary font-medium" : undefined}
        >
          <Moon className="size-4" aria-hidden="true" />
          <span>{t("settings.themeDark")}</span>
          {activeTheme === "dark" && (
            <Check className="text-primary ml-auto size-4" aria-hidden="true" />
          )}
        </DropdownMenuItem>
        <DropdownMenuItem
          role="menuitemradio"
          aria-checked={activeTheme === "system"}
          onClick={() => handleSelect("system")}
          className={activeTheme === "system" ? "bg-secondary font-medium" : undefined}
        >
          <Monitor className="size-4" aria-hidden="true" />
          <span>{t("settings.themeSystem")}</span>
          {activeTheme === "system" && (
            <Check className="text-primary ml-auto size-4" aria-hidden="true" />
          )}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
