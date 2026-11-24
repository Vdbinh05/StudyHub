"use client";

import * as React from "react";
import Link from "next/link";
import { BrandLogo } from "@/components/layout/brand-logo";
import { LanguageToggle } from "@/components/layout/language-toggle";
import { ServiceSetupNotice } from "@/components/layout/service-setup-notice";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { FadeIn } from "@/components/motion";
import { isSupabaseConfigured } from "@/lib/supabase/client";

export function AuthShell({ children }: { children: React.ReactNode }) {
  const configured = isSupabaseConfigured();

  return (
    <div className="bg-background text-foreground flex min-h-dvh flex-col">
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
        <FadeIn aboveFold className="w-full max-w-md space-y-4">
          {!configured && <ServiceSetupNotice />}
          {children}
        </FadeIn>
      </main>
    </div>
  );
}
