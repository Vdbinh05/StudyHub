"use client";

import * as React from "react";
import Link from "next/link";
import { Compass, Home, Library } from "lucide-react";
import { BrandLogo } from "@/components/layout/brand-logo";
import { LandingThemeMenu } from "@/components/layout/landing-locale-shell";
import { LanguageToggle } from "@/components/layout/language-toggle";
import { buttonVariants } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

export function NotFoundView() {
  const { t } = useI18n();

  return (
    <div className="bg-background text-foreground flex min-h-dvh flex-col">
      <header className="border-border bg-card/95 border-b">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Link href="/" aria-label="StudyHub">
            <BrandLogo />
          </Link>
          <div className="flex items-center gap-1">
            <LanguageToggle />
            <LandingThemeMenu />
          </div>
        </div>
      </header>

      <main
        id="main-content"
        className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-4 py-16 text-center"
      >
        <div className="bg-secondary text-primary mb-5 flex size-14 items-center justify-center rounded-2xl">
          <Compass className="size-7" aria-hidden="true" />
        </div>
        <p className="text-muted-foreground font-mono text-sm font-semibold">404</p>
        <h1 className="text-foreground mt-2 text-2xl font-bold tracking-tight sm:text-3xl">
          {t("common.notFoundTitle")}
        </h1>
        <p className="text-muted-foreground mt-2.5 max-w-md text-sm leading-relaxed">
          {t("common.notFoundDescription")}
        </p>

        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/dashboard"
            prefetch={false}
            className={buttonVariants()}
          >
            <Home className="size-4" aria-hidden="true" />
            <span>{t("common.goDashboard")}</span>
          </Link>
          <Link
            href="/library"
            prefetch={false}
            className={buttonVariants({ variant: "outline" })}
          >
            <Library className="size-4" aria-hidden="true" />
            <span>{t("common.goLibrary")}</span>
          </Link>
          <Link href="/" className={buttonVariants({ variant: "ghost" })}>
            {t("common.goHome")}
          </Link>
        </div>
      </main>
    </div>
  );
}
