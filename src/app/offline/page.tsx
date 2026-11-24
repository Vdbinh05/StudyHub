"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowRight,
  BookOpen,
  RefreshCw,
  Wifi,
  WifiOff,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { InstallAppCard } from "@/components/pwa/InstallAppCard";
import { OfflineManagerPanel } from "@/components/pwa/OfflineManagerPanel";
import { OfflineStudyRunner } from "@/components/pwa/OfflineStudyRunner";
import { useOptionalPwa } from "@/components/pwa/PwaProvider";
import { useOptionalI18n } from "@/lib/i18n";

function OfflinePageContent() {
  const searchParams = useSearchParams();
  const i18n = useOptionalI18n();
  const pwa = useOptionalPwa();

  const locale = i18n?.locale ?? "vi";
  const vi = locale === "vi";
  const isOnline = pwa?.isOnline ?? true;
  const activeUserId = pwa?.activeUserId ?? null;

  const initialSetId = searchParams?.get("setId") ?? null;
  const [selectedSetId, setSelectedSetId] = React.useState<
    string | null | undefined
  >(undefined);
  const studyingSetId =
    selectedSetId === undefined ? initialSetId : selectedSetId;

  const handleRetryConnection = () => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6"
    >
      {/* Top Bar */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="bg-primary text-primary-foreground flex size-9 items-center justify-center rounded-lg font-bold tracking-tight">
            SH
          </div>
          <div>
            <p className="text-sm font-semibold leading-tight">StudyHub</p>
            <p className="text-muted-foreground text-xs">
              {vi ? "Trung tâm học ngoại tuyến" : "Offline Study Hub"}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={isOnline ? "success" : "warning"}>
            {isOnline ? (
              <Wifi className="size-3" aria-hidden="true" />
            ) : (
              <WifiOff className="size-3" aria-hidden="true" />
            )}
            {isOnline
              ? i18n
                ? i18n.t("pwa.online")
                : vi
                  ? "Trực tuyến"
                  : "Online"
              : i18n
                ? i18n.t("pwa.offline")
                : vi
                  ? "Ngoại tuyến"
                  : "Offline"}
          </Badge>

          {i18n && (
            <Button
              size="sm"
              variant="outline"
              onClick={i18n.toggleLocale}
              aria-label={vi ? "Chuyển sang tiếng Anh" : "Switch to Vietnamese"}
            >
              {locale === "vi" ? "EN" : "VI"}
            </Button>
          )}
        </div>
      </header>

      {/* Hero Status Card */}
      <Card className="border-border">
        <CardHeader className="gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {isOnline ? (
              <BookOpen className="text-primary size-5" aria-hidden="true" />
            ) : (
              <WifiOff className="text-warning size-5" aria-hidden="true" />
            )}
            <h1 className="text-xl leading-snug font-semibold tracking-tight">
              {isOnline
                ? vi
                  ? "Đã kết nối mạng trở lại"
                  : "You are back online"
                : i18n
                  ? i18n.t("pwa.offlineUnavailableTitle")
                  : vi
                    ? "Nội dung này chưa được tải ngoại tuyến"
                    : "This page is unavailable offline"}
            </h1>
          </div>
          <CardDescription>
            {isOnline
              ? vi
                ? "Bạn có thể đồng bộ các câu trả lời đã làm ngoại tuyến hoặc tiếp tục quay lại bảng điều khiển."
                : "You can sync your queued offline study progress now or return to your dashboard."
              : i18n
                ? i18n.t("pwa.offlineUnavailableDesc")
                : vi
                  ? "Vui lòng kiểm tra kết nối mạng và thử lại, hoặc chọn một học phần đã tải xuống bên dưới để tiếp tục ôn tập."
                  : "Check your connection to reconnect, or study any of your downloaded sets below."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button onClick={handleRetryConnection}>
            <RefreshCw className="size-4" aria-hidden="true" />
            {vi ? "Thử kết nối lại" : "Reconnect & retry"}
          </Button>
          {isOnline && (
            <Button variant="outline" asChild>
              <Link href="/dashboard">
                {vi ? "Về trang tổng quan" : "Go to Dashboard"}
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Active Offline Study Session OR Offline Manager */}
      {studyingSetId && activeUserId ? (
        <OfflineStudyRunner
          userId={activeUserId}
          setId={studyingSetId}
          onExit={() => setSelectedSetId(null)}
        />
      ) : (
        <>
          <OfflineManagerPanel
            userId={activeUserId}
            onStudySetOffline={(setId) => setSelectedSetId(setId)}
          />
          <InstallAppCard />
        </>
      )}
    </main>
  );
}

export default function OfflinePage() {
  return (
    <React.Suspense
      fallback={
        <main
          id="main-content"
          className="mx-auto flex min-h-dvh max-w-4xl items-center justify-center p-6 text-sm text-muted-foreground"
        >
          StudyHub…
        </main>
      }
    >
      <OfflinePageContent />
    </React.Suspense>
  );
}
