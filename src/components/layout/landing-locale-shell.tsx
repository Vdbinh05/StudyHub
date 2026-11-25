"use client";

import * as React from "react";
import Link from "next/link";
import { Check, Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { buttonVariants } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { ThemePreference } from "@/types/domain";
import { LanguageToggle } from "./language-toggle";

interface LandingLocaleShellProps {
  brandLogo: React.ReactNode;
  viNav: React.ReactNode;
  enNav: React.ReactNode;
  viHeaderActions: React.ReactNode;
  enHeaderActions: React.ReactNode;
  viContent: React.ReactNode;
  enContent: React.ReactNode;
}

const emptySubscribe = () => () => {};

/**
 * Zero-Radix WCAG 2.2 AA theme menu exclusively for the public landing page (`/`)
 * and root `not-found` boundary. Eliminates `@radix-ui/react-dropdown-menu` (~46–49 KB gz)
 * from `/` while preserving exact `role="menu"`, `role="menuitemradio"`, `aria-checked`,
 * Escape/Arrow-key navigation, outside-click dismissal, and bilingual labels.
 */
export function LandingThemeMenu() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const { t, locale } = useI18n();
  const mounted = React.useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );

  const [open, setOpen] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const itemRefs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = React.useId();

  const label = locale === "vi" ? "Đổi giao diện sáng tối" : "Switch color theme";
  const activeTheme = mounted ? (theme ?? "system") : "system";

  React.useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const options: Array<{
    value: ThemePreference;
    label: string;
    icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" | "false" }>;
  }> = [
    { value: "light", label: t("settings.themeLight"), icon: Sun },
    { value: "dark", label: t("settings.themeDark"), icon: Moon },
    { value: "system", label: t("settings.themeSystem"), icon: Monitor },
  ];

  const handleSelect = (next: ThemePreference) => {
    setTheme(next);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = itemRefs.current.filter(
      (el): el is HTMLButtonElement => el !== null,
    );
    if (items.length === 0) return;
    const currentIndex = items.findIndex((el) => el === document.activeElement);

    if (event.key === "ArrowDown") {
      event.preventDefault();
      items[(currentIndex + 1 + items.length) % items.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      items[(currentIndex - 1 + items.length) % items.length]?.focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      items[items.length - 1]?.focus();
    }
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          buttonVariants({ variant: "ghost", size: "icon" }),
          "min-h-11 min-w-11 sm:size-9 sm:min-h-9 sm:min-w-9",
        )}
      >
        {!mounted ? (
          <Sun className="size-4" aria-hidden="true" />
        ) : resolvedTheme === "dark" ? (
          <Moon className="size-4" aria-hidden="true" />
        ) : (
          <Sun className="size-4" aria-hidden="true" />
        )}
      </button>

      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={handleMenuKeyDown}
          className="bg-popover text-popover-foreground border-border absolute top-full right-0 z-50 mt-1.5 w-44 rounded-md border p-1 shadow-md"
        >
          {options.map((opt, idx) => {
            const Icon = opt.icon;
            const checked = activeTheme === opt.value;
            return (
              <button
                key={opt.value}
                ref={(el) => {
                  itemRefs.current[idx] = el;
                }}
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                onClick={() => handleSelect(opt.value)}
                className={cn(
                  "hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground flex w-full items-center gap-2 rounded-sm px-2 py-2 text-left text-sm transition-colors outline-none sm:py-1.5",
                  checked && "bg-secondary font-medium",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                <span>{opt.label}</span>
                {checked && (
                  <Check
                    className="text-primary ml-auto size-4 shrink-0"
                    aria-hidden="true"
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Minimal Client Island for the public landing page (`/`).
 * Keeps 100% of marketing sections, feature grids, icons, and copy as
 * zero-JS React Server Components while allowing instant VI/EN switching
 * and persistent focus on the language/theme controls.
 */
export function LandingLocaleShell({
  brandLogo,
  viNav,
  enNav,
  viHeaderActions,
  enHeaderActions,
  viContent,
  enContent,
}: LandingLocaleShellProps) {
  const { locale } = useI18n();
  const isEn = locale === "en";

  return (
    <div className="bg-background text-foreground flex min-h-dvh flex-col overflow-x-clip">
      <header className="border-border bg-card/90 sticky top-0 z-30 border-b backdrop-blur-xs">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-2 px-3 sm:h-16 sm:gap-4 sm:px-6">
          <Link
            href="/"
            prefetch={false}
            aria-label="StudyHub"
            className="inline-flex min-h-11 shrink-0 items-center"
          >
            {brandLogo}
          </Link>

          {isEn ? enNav : viNav}

          <div className="flex shrink-0 items-center gap-1 sm:gap-2">
            <LanguageToggle />
            <LandingThemeMenu />
            {isEn ? enHeaderActions : viHeaderActions}
          </div>
        </div>
      </header>

      {isEn ? enContent : viContent}
    </div>
  );
}
