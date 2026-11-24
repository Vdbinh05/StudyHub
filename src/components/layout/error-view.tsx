"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Home, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";

interface ErrorBoundaryViewProps {
  reset: () => void;
  fullPage?: boolean;
}

export function ErrorBoundaryView({
  reset,
  fullPage = false,
}: ErrorBoundaryViewProps) {
  const { t } = useI18n();

  const content = (
    <div
      role="alert"
      className="border-border bg-card mx-auto flex w-full max-w-lg flex-col items-center rounded-2xl border px-6 py-12 text-center shadow-xs"
    >
      <div className="bg-destructive-subtle text-destructive-subtle-foreground mb-4 flex size-12 items-center justify-center rounded-xl">
        <AlertTriangle className="size-6" aria-hidden="true" />
      </div>
      <h1 className="text-foreground text-xl font-bold tracking-tight">
        {t("common.errorBoundaryTitle")}
      </h1>
      <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
        {t("common.errorBoundaryDescription")}
      </p>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Button type="button" onClick={() => reset()}>
          <RotateCcw className="size-4" aria-hidden="true" />
          <span>{t("common.retry")}</span>
        </Button>
        <Button asChild variant="outline">
          <Link href="/dashboard">
            <Home className="size-4" aria-hidden="true" />
            <span>{t("common.goDashboard")}</span>
          </Link>
        </Button>
      </div>
    </div>
  );

  if (fullPage) {
    return (
      <main
        id="main-content"
        className="bg-background text-foreground flex min-h-dvh items-center justify-center px-4 py-12"
      >
        {content}
      </main>
    );
  }

  return <div className="py-12">{content}</div>;
}
