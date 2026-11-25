"use client";

import * as React from "react";
import Link from "next/link";
import { isSupabaseConfiguredClient } from "@/components/layout/api-client";
import { BrandLogo } from "@/components/layout/brand-logo";
import { LanguageToggle } from "@/components/layout/language-toggle";
import { ServiceSetupNotice } from "@/components/layout/service-setup-notice";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { FadeIn } from "@/components/motion";
import { useI18n } from "@/lib/i18n";

export function AuthShell({ children }: { children: React.ReactNode }) {
  const configured = isSupabaseConfiguredClient();
  const { locale } = useI18n();
  const vi = locale === "vi";

  return (
    <div className="bg-background text-foreground flex min-h-dvh flex-col">
      <header className="border-border bg-card/95 border-b backdrop-blur-xs">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Link
            href="/"
            prefetch={false}
            aria-label="StudyHub"
            className="inline-flex min-h-11 items-center"
          >
            <BrandLogo />
          </Link>
          <div className="flex items-center gap-1.5">
            <LanguageToggle />
            <ThemeToggle compact />
          </div>
        </div>
      </header>

      <main
        id="main-content"
        className="flex flex-1 flex-col items-center justify-center px-4 py-7 sm:py-10"
      >
        <FadeIn aboveFold className="w-full max-w-md space-y-5">
          <div className="flex flex-col items-center gap-1.5 text-center">
            <BrandLogo variant="main" size="md" priority="high" />
            <p className="text-muted-foreground text-xs font-medium">
              {vi
                ? "Học thông minh · Ôn tập hiệu quả · Thi thử linh hoạt"
                : "Study Smart · Review Effectively · Flexible Mock Exams"}
            </p>
          </div>
          {!configured && <ServiceSetupNotice />}
          {children}
        </FadeIn>
      </main>
    </div>
  );
}
