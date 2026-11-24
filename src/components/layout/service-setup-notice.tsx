"use client";

import * as React from "react";
import { AlertCircle } from "lucide-react";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";

interface ServiceSetupNoticeProps {
  compact?: boolean;
  className?: string;
}

/**
 * Calm, student-friendly notice shown when the study database service is not configured.
 * Technical environment details are hidden inside a collapsible <details> disclosure
 * for workspace administrators rather than exposed as raw developer jargon to students.
 */
export function ServiceSetupNotice({
  compact = false,
  className,
}: ServiceSetupNoticeProps) {
  const { t, locale } = useI18n();
  const vi = locale === "vi";

  return (
    <div
      role="status"
      className={cn(
        "border-warning/30 bg-warning-subtle text-warning-subtle-foreground rounded-lg border px-4 py-3 text-sm",
        compact && "rounded-none border-x-0 border-t-0 py-2.5 text-xs sm:text-sm",
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-medium">{t("common.serviceUnavailableTitle")}</p>
          <p className="opacity-90">{t("common.serviceUnavailableDesc")}</p>
          <details className="pt-1 text-xs">
            <summary className="cursor-pointer font-medium underline-offset-4 hover:underline">
              {t("common.technicalDetails")}
            </summary>
            <p className="mt-1.5 opacity-90">
              {vi
                ? "Quản trị viên cần thiết lập biến môi trường NEXT_PUBLIC_SUPABASE_URL và NEXT_PUBLIC_SUPABASE_ANON_KEY trong .env.local và khởi chạy cơ sở dữ liệu Supabase để bật đăng nhập và lưu trữ."
                : "Administrators need to configure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local and connect a Supabase project to enable authentication and persistence."}
            </p>
          </details>
        </div>
      </div>
    </div>
  );
}
