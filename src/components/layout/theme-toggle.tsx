"use client";

import * as React from "react";
import { Monitor, Moon, Sun } from "lucide-react";
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size={compact ? "icon" : "sm"}
          aria-label={label}
          className={compact ? "size-9" : "h-9 gap-1.5 px-2.5"}
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
              {theme === "dark"
                ? t("settings.themeDark")
                : theme === "light"
                  ? t("settings.themeLight")
                  : t("settings.themeSystem")}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem
          onClick={() => handleSelect("light")}
          className={theme === "light" ? "bg-secondary font-medium" : undefined}
        >
          <Sun className="size-4" aria-hidden="true" />
          <span>{t("settings.themeLight")}</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => handleSelect("dark")}
          className={theme === "dark" ? "bg-secondary font-medium" : undefined}
        >
          <Moon className="size-4" aria-hidden="true" />
          <span>{t("settings.themeDark")}</span>
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={() => handleSelect("system")}
          className={theme === "system" ? "bg-secondary font-medium" : undefined}
        >
          <Monitor className="size-4" aria-hidden="true" />
          <span>{t("settings.themeSystem")}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
