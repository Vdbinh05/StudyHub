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
      <body className="min-h-dvh bg-[#f7faff] text-[#14214f] antialiased dark:bg-[#0b1224] dark:text-[#f1f6ff]">
        <main className="mx-auto flex min-h-dvh max-w-lg flex-col items-center justify-center px-6 py-12 text-center">
          <div className="w-full rounded-xl border border-[#d9e7ff] bg-white p-8 shadow-sm dark:border-[#1f3056] dark:bg-[#111b33]">
            <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-full bg-[#fee2e2] text-[#b91c1c] dark:bg-[#3b1219] dark:text-[#fca5a5]">
              <AlertTriangle className="size-6" aria-hidden="true" />
            </div>
            <h1 className="text-xl font-semibold tracking-tight">
              {vi ? "Đã xảy ra lỗi không mong muốn" : "Something went wrong"}
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-[#4a5b82] dark:text-[#9db2d9]">
              {vi
                ? "StudyHub gặp sự cố khi tải trang này. Bạn có thể thử tải lại hoặc quay về trang chủ."
                : "StudyHub ran into an unexpected error while rendering this page. You can retry or return to the home page."}
            </p>
            <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => reset()}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-[#3458db] px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#2545be] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3458db] dark:bg-[#6b96ff] dark:text-[#09132b] dark:hover:bg-[#82a7ff]"
              >
                <RotateCcw className="size-4" aria-hidden="true" />
                <span>{vi ? "Thử lại" : "Try again"}</span>
              </button>
              <Link
                href="/"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-[#d9e7ff] bg-white px-5 py-2.5 text-sm font-medium text-[#14214f] transition-colors hover:bg-[#eef4ff] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3458db] dark:border-[#1f3056] dark:bg-[#172342] dark:text-[#f1f6ff] dark:hover:bg-[#1f3056]"
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
