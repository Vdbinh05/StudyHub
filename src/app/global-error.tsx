"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Home, RotateCcw } from "lucide-react";
import "./globals.css";

const LOCALE_STORAGE_KEY = "studyhub-locale";

function detectLocale(): "vi" | "en" {
  if (typeof window === "undefined") return "vi";
  try {
    return window.localStorage.getItem(LOCALE_STORAGE_KEY) === "en" ? "en" : "vi";
  } catch {
    return "vi";
  }
}

export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [locale] = React.useState<"vi" | "en">(detectLocale);
  const vi = locale === "vi";

  return (
    <html lang={locale}>
      <body className="min-h-dvh bg-[#f8fafc] text-[#0f172a] antialiased dark:bg-[#0b1120] dark:text-[#f8fafc]">
        <main className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center px-6 py-12 text-center">
          <div className="w-full rounded-xl border border-[#e2e8f0] bg-white p-8 shadow-sm dark:border-[#1e293b] dark:bg-[#111827]">
            <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-[#fee2e2] text-[#b91c1c] dark:bg-[#7f1d1d]/30 dark:text-[#fca5a5]">
              <AlertTriangle className="size-6" aria-hidden="true" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">
              {vi ? "Đã xảy ra lỗi không mong muốn" : "Something went wrong"}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-[#475569] dark:text-[#94a3b8]">
              {vi
                ? "StudyHub gặp sự cố khi tải trang này. Bạn có thể thử tải lại hoặc quay về trang chủ."
                : "StudyHub ran into an unexpected error while rendering this page. You can retry or return to the home page."}
            </p>
            <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => reset()}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[#4338ca] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#3730a3] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4338ca]"
              >
                <RotateCcw className="size-4" aria-hidden="true" />
                <span>{vi ? "Thử lại" : "Try again"}</span>
              </button>
              <Link
                href="/"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-[#cbd5e1] bg-white px-5 py-2.5 text-sm font-medium text-[#0f172a] transition-colors hover:bg-[#f1f5f9] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#4338ca] dark:border-[#334155] dark:bg-[#1e293b] dark:text-[#f8fafc] dark:hover:bg-[#334155]"
              >
                <Home className="size-4" aria-hidden="true" />
                <span>{vi ? "Về trang chủ" : "Back to home"}</span>
              </Link>
            </div>
          </div>
        </main>
      </body>
    </html>
  );
}
