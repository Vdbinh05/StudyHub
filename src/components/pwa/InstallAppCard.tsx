"use client";

import * as React from "react";
import {
  CheckCircle2,
  Download,
  PlusSquare,
  Share,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useOptionalI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { useOptionalPwa } from "./PwaProvider";

export interface InstallAppCardProps {
  className?: string;
  /** Optional explicit overrides (helpful in tests or isolated previews) */
  overrideStandalone?: boolean;
  overrideIos?: boolean;
  overrideCanInstall?: boolean;
  onInstallClick?: () => Promise<"accepted" | "dismissed" | "unavailable">;
}

export function InstallAppCard({
  className,
  overrideStandalone,
  overrideIos,
  overrideCanInstall,
  onInstallClick,
}: InstallAppCardProps) {
  const i18n = useOptionalI18n();
  const pwa = useOptionalPwa();
  const locale = i18n?.locale ?? "vi";
  const vi = locale === "vi";

  const [installing, setInstalling] = React.useState(false);
  const [feedback, setFeedback] = React.useState<"idle" | "accepted" | "dismissed">(
    pwa?.installOutcome ?? "idle",
  );

  const isStandalone = overrideStandalone ?? pwa?.isStandalone ?? false;
  const isIos = overrideIos ?? pwa?.isIos ?? false;
  const canInstall = overrideCanInstall ?? pwa?.canInstallPrompt ?? false;

  const handleInstall = async () => {
    const trigger = onInstallClick ?? pwa?.promptInstall;
    if (!trigger) return;
    setInstalling(true);
    try {
      const outcome = await trigger();
      if (outcome === "accepted" || outcome === "dismissed") {
        setFeedback(outcome);
      }
    } finally {
      setInstalling(false);
    }
  };

  return (
    <Card className={cn("border-border", className)}>
      <CardHeader className="gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="border-border bg-background flex size-10 shrink-0 items-center justify-center rounded-xl border p-1 shadow-xs">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/icons/icon-192.png"
                alt=""
                aria-hidden="true"
                width={32}
                height={32}
                loading="lazy"
                className="size-8 object-contain"
              />
            </div>
            <CardTitle className="text-base">
              {i18n
                ? i18n.t("pwa.installTitle")
                : vi
                  ? "Cài đặt ứng dụng StudyHub"
                  : "Install StudyHub App"}
            </CardTitle>
          </div>
          {isStandalone && (
            <Badge variant="success">
              <CheckCircle2 className="size-3" aria-hidden="true" />
              {vi ? "Đã cài đặt" : "Installed"}
            </Badge>
          )}
        </div>
        <CardDescription>
          {i18n
            ? i18n.t("pwa.installDescription")
            : vi
              ? "Mở StudyHub như ứng dụng độc lập, truy cập nhanh hơn và học các bộ câu hỏi đã tải khi không có mạng."
              : "Launch StudyHub in its own window and keep downloaded study sets ready offline."}
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-3">
        {isStandalone ? (
          <p className="text-muted-foreground text-sm">
            {vi
              ? "StudyHub đang chạy ở chế độ ứng dụng độc lập trên thiết bị này."
              : "StudyHub is currently running in standalone app mode on this device."}
          </p>
        ) : canInstall ? (
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={handleInstall} disabled={installing}>
              <Download className="size-4" aria-hidden="true" />
              {installing
                ? vi
                  ? "Đang mở hộp thoại cài đặt..."
                  : "Opening install prompt..."
                : i18n
                  ? i18n.t("pwa.installButton")
                  : vi
                    ? "Cài đặt ứng dụng"
                    : "Install app"}
            </Button>
            {feedback === "dismissed" && (
              <span className="text-muted-foreground text-xs">
                {vi
                  ? "Bạn có thể nhấn cài đặt lại bất cứ lúc nào."
                  : "You can install StudyHub anytime from here."}
              </span>
            )}
          </div>
        ) : isIos ? (
          <div
            data-testid="ios-install-guide"
            className="bg-secondary/60 border-border space-y-2 rounded-lg border p-3.5 text-sm"
          >
            <p className="font-medium">
              {i18n
                ? i18n.t("pwa.iosInstallTitle")
                : vi
                  ? "Cài đặt trên iPhone / iPad (Safari)"
                  : "Install on iPhone / iPad (Safari)"}
            </p>
            <ol className="text-muted-foreground space-y-2 text-xs sm:text-sm">
              <li className="flex items-start gap-2">
                <Share
                  className="text-primary mt-0.5 size-4 shrink-0"
                  aria-hidden="true"
                />
                <span>
                  {vi
                    ? "1. Mở trang này bằng Safari và nhấn biểu tượng Chia sẻ (Share) ở thanh công cụ."
                    : "1. Open this page in Safari and tap the Share icon in the browser toolbar."}
                </span>
              </li>
              <li className="flex items-start gap-2">
                <PlusSquare
                  className="text-primary mt-0.5 size-4 shrink-0"
                  aria-hidden="true"
                />
                <span>
                  {vi
                    ? '2. Cuộn xuống và chọn "Thêm vào Màn hình chính" (Add to Home Screen), sau đó nhấn Thêm.'
                    : '2. Scroll down and select "Add to Home Screen", then tap Add.'}
                </span>
              </li>
            </ol>
          </div>
        ) : (
          <p
            data-testid="install-unsupported-note"
            className="text-muted-foreground bg-secondary/50 border-border rounded-lg border p-3 text-xs sm:text-sm"
          >
            {vi
              ? "Trình duyệt hiện tại chưa hỗ trợ nút cài đặt trực tiếp một chạm (hoặc ứng dụng đã sẵn sàng trên thanh địa chỉ). Bạn vẫn có thể tải học phần để học ngoại tuyến bình thường trên Chrome, Edge hoặc Safari."
              : "One-click install prompt is not available in this browser right now (or can be launched from your browser address bar menu). Offline study set downloads still work normally."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
