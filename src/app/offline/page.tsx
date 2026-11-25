"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowRight,
  BookOpen,
  Languages,
  RefreshCw,
  Wifi,
  WifiOff,
} from "lucide-react";
import { BrandLogo } from "@/components/layout/brand-logo";
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
import {
  PwaProvider,
  readStoredActiveUserId,
  useOptionalPwa,
} from "@/components/pwa/PwaProvider";
import { useOptionalI18n } from "@/lib/i18n";
import {
  clearActiveOfflineSessionState,
  loadActiveOfflineSessionState,
  saveActiveOfflineSessionState,
  type OfflineCapableMode,
} from "@/lib/offline/offline-session";

interface ActiveSessionSelection {
  setId: string;
  mode: OfflineCapableMode;
  questionIndex: number;
}

function subscribeHydration(): () => void {
  return () => undefined;
}

function subscribeStoredUserPointer(callback: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener("storage", callback);
  };
}

function subscribeOfflinePageOnline(callback: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function getOfflinePageOnlineSnapshot(): boolean {
  if (typeof navigator === "undefined") return false;
  return navigator.onLine;
}

/**
 * Ensures `/offline` always has a live `PwaProvider` even when the Service Worker serves
 * the precached `/offline` shell as a fallback under another URL (e.g. `/sets/[id]`),
 * where `RouteScopedPwaBridge` (`pathname === "/offline"`) did not mount `PwaProvider`.
 */
function OfflinePwaBoundary({ children }: { children: React.ReactNode }) {
  const existingPwa = useOptionalPwa();
  if (existingPwa) {
    return <>{children}</>;
  }
  return <PwaProvider hideBanners>{children}</PwaProvider>;
}

function OfflinePageContent() {
  const searchParams = useSearchParams();
  const i18n = useOptionalI18n();
  const pwa = useOptionalPwa();

  const locale = i18n?.locale ?? "vi";
  const vi = locale === "vi";

  // Server snapshot is strictly `false` so precached `/offline` HTML NEVER flashes green "Trực tuyến"
  // while `navigator.onLine === false` (`RU-07`).
  const isOnline = React.useSyncExternalStore(
    subscribeOfflinePageOnline,
    getOfflinePageOnlineSnapshot,
    () => false,
  );

  const hydrated = React.useSyncExternalStore(
    subscribeHydration,
    () => true,
    () => false,
  );
  const storedUserId = React.useSyncExternalStore(
    subscribeStoredUserPointer,
    readStoredActiveUserId,
    () => null,
  );
  // `undefined` = not explicitly changed by user yet (restore from URL/sessionStorage);
  // `null` = user explicitly exited back to the offline hub;
  // `ActiveSessionSelection` = active session chosen by user.
  const [selectedSession, setSelectedSession] = React.useState<
    ActiveSessionSelection | null | undefined
  >(undefined);

  const querySetId = searchParams?.get("setId")?.trim() || null;
  const activeUserId = pwa?.activeUserId ?? storedUserId;

  const restoredSession = React.useMemo<ActiveSessionSelection | null>(() => {
    if (!hydrated || !activeUserId) return null;
    const restored = loadActiveOfflineSessionState(activeUserId);
    if (querySetId) {
      if (restored && restored.setId === querySetId) {
        return restored;
      }
      return {
        setId: querySetId,
        mode: "flashcards",
        questionIndex: 0,
      };
    }
    return restored;
  }, [hydrated, activeUserId, querySetId]);

  const activeSession =
    selectedSession === undefined ? restoredSession : selectedSession;

  const handleStartStudySet = React.useCallback(
    (setId: string) => {
      const next: ActiveSessionSelection = {
        setId,
        mode: "flashcards",
        questionIndex: 0,
      };
      setSelectedSession(next);
      if (activeUserId) {
        saveActiveOfflineSessionState({
          userId: activeUserId,
          ...next,
        });
      }
    },
    [activeUserId],
  );

  const handleSessionStateChange = React.useCallback(
    (state: {
      setId: string;
      mode: OfflineCapableMode;
      questionIndex: number;
    }) => {
      if (!activeUserId) return;
      saveActiveOfflineSessionState({
        userId: activeUserId,
        setId: state.setId,
        mode: state.mode,
        questionIndex: state.questionIndex,
      });
    },
    [activeUserId],
  );

  const handleExitStudy = React.useCallback(() => {
    clearActiveOfflineSessionState();
    setSelectedSession(null);
  }, []);

  const handleRetryConnection = () => {
    if (typeof window !== "undefined") {
      window.location.reload();
    }
  };

  const isStudyingOffline = Boolean(hydrated && activeSession && activeUserId);

  return (
    <main
      id="main-content"
      className="mx-auto flex min-h-dvh w-full max-w-4xl flex-col gap-6 px-4 py-8 sm:px-6"
    >
      {/* Top Bar */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <BrandLogo variant="icon" size="md" />
          <div>
            <p className="text-sm font-extrabold leading-tight tracking-tight">
              <span className="text-brand-navy dark:text-foreground">Study</span>
              <span className="text-primary">Hub</span>
            </p>
            <p className="text-muted-foreground text-xs">
              {vi ? "Trung tâm học ngoại tuyến" : "Offline Study Hub"}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant={isOnline ? "success" : "warning"}
            data-testid="offline-page-network-badge"
          >
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
              aria-label={
                vi
                  ? "Chuyển ngôn ngữ giao diện sang tiếng Anh"
                  : "Switch interface language to Vietnamese"
              }
              className="min-h-11 min-w-11 gap-1.5 px-2.5 font-mono text-xs font-semibold sm:min-h-9 sm:min-w-9"
              data-testid="offline-language-toggle"
            >
              <Languages className="size-4" aria-hidden="true" />
              <span>{locale.toUpperCase()}</span>
            </Button>
          )}
        </div>
      </header>

      {/* Hero Status Card — hidden during active offline study so no contradictory warning appears (`RU-07`) */}
      {!isStudyingOffline && (
        <Card className="border-border" data-testid="offline-fallback-hero">
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
      )}

      {/* Active Offline Study Session OR Offline Manager */}
      {!hydrated ? (
        <Card className="border-border">
          <CardContent className="p-6 text-sm text-muted-foreground">
            {vi
              ? "Đang kiểm tra bộ nhớ ngoại tuyến trên thiết bị..."
              : "Checking local offline storage on this device..."}
          </CardContent>
        </Card>
      ) : isStudyingOffline && activeSession && activeUserId ? (
        <OfflineStudyRunner
          userId={activeUserId}
          setId={activeSession.setId}
          initialMode={activeSession.mode}
          initialQuestionIndex={activeSession.questionIndex}
          onSessionStateChange={handleSessionStateChange}
          onExit={handleExitStudy}
        />
      ) : (
        <>
          <OfflineManagerPanel
            userId={activeUserId}
            onStudySetOffline={handleStartStudySet}
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
      <OfflinePwaBoundary>
        <OfflinePageContent />
      </OfflinePwaBoundary>
    </React.Suspense>
  );
}
