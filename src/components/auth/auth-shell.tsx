"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { BrandLogo } from "@/components/layout/brand-logo";
import { LanguageToggle } from "@/components/layout/language-toggle";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { FadeIn } from "@/components/motion";
import { useI18n } from "@/lib/i18n";
import { isSupabaseConfigured } from "@/lib/supabase/client";

export function AuthShell({ children }: { children: React.ReactNode }) {
  const { locale } = useI18n();
  const configured = isSupabaseConfigured();

  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col">
      <header className="border-border bg-card border-b">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Link href="/" aria-label="StudyHub">
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
        className="flex flex-1 flex-col items-center justify-center px-4 py-8 sm:py-12"
      >
        <FadeIn className="w-full max-w-md space-y-4">
          {!configured && (
            <div
              role="alert"
              className="border-warning/40 bg-warning-subtle text-warning-subtle-foreground flex items-start gap-2.5 rounded-xl border p-3.5 text-xs leading-relaxed sm:text-sm"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <div>
                <p className="font-semibold">
                  {locale === "vi"
                    ? "Supabase chưa được cấu hình"
                    : "Supabase is not configured"}
                </p>
                <p className="mt-0.5">
                  {locale === "vi"
                    ? "Vui lòng cấu hình NEXT_PUBLIC_SUPABASE_URL và NEXT_PUBLIC_SUPABASE_ANON_KEY trong .env.local để sử dụng đăng nhập và đăng ký thật."
                    : "Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local to enable real authentication."}
                </p>
              </div>
            </div>
          )}
          {children}
        </FadeIn>
      </main>
    </div>
  );
}
