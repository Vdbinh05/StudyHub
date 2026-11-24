"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { RefreshCw, ShieldAlert, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOptionalI18n } from "@/lib/i18n";
import type { SyncQueueSummary, SyncRunOutcome } from "@/lib/offline/sync-queue";

const ACTIVE_USER_POINTER_KEY = "studyhub-offline-active-user";

const PUBLIC_UNAUTH_EXACT_ROUTES = new Set([
  "/",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
]);

function isPublicUnauthRoutePath(pathname: string | null | undefined): boolean {
  if (!pathname) return true;
  if (PUBLIC_UNAUTH_EXACT_ROUTES.has(pathname)) return true;
  if (pathname.startsWith("/share/")) return true;
  return false;
}

export interface BeforeInstallPromptEvent extends Event {
  readonly platforms?: string[];
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}

export interface PwaContextValue {
  isOnline: boolean;
  isStandalone: boolean;
  isIos: boolean;
  isIosSafari: boolean;
  canInstallPrompt: boolean;
  installOutcome: "idle" | "accepted" | "dismissed";
  promptInstall: () => Promise<"accepted" | "dismissed" | "unavailable">;
  swRegistered: boolean;
  updateAvailable: boolean;
  isExamActive: boolean;
  setExamLockActive: (active: boolean) => void;
  applyAppUpdate: () => void;
  activeUserId: string | null;
  syncSummary: SyncQueueSummary | null;
  isSyncing: boolean;
  offlineRevision: number;
  syncNow: (force?: boolean) => Promise<SyncRunOutcome | null>;
  refreshOfflineState: () => Promise<void>;
  clearCurrentUserOfflineData: () => Promise<void>;
}

const PwaContext = React.createContext<PwaContextValue | null>(null);

/**
 * Detect active timed exam routes where forced Service Worker reloads MUST be deferred.
 */
export function isActiveExamRoutePath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  if (/^\/sets\/[^/]+\/test(?:\/|$)/.test(pathname)) {
    return true;
  }
  if (/^\/exams\/([^/]+)$/.test(pathname)) {
    const segment = pathname.split("/")[2];
    if (segment && segment !== "new") {
      return true;
    }
  }
  return false;
}

function readStoredActiveUserId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const val = window.localStorage.getItem(ACTIVE_USER_POINTER_KEY);
    return val && val.trim().length > 0 ? val.trim() : null;
  } catch {
    return null;
  }
}

function writeStoredActiveUserId(userId: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (userId && userId.trim().length > 0) {
      window.localStorage.setItem(ACTIVE_USER_POINTER_KEY, userId.trim());
    } else {
      window.localStorage.removeItem(ACTIVE_USER_POINTER_KEY);
    }
  } catch {
    // Ignore storage restrictions
  }
}

/**
 * Helper invoked on sign-out to purge the active account's offline IndexedDB cleanly.
 */
export async function clearOfflineDataForLogout(userId?: string | null): Promise<void> {
  const targetId = userId?.trim() || readStoredActiveUserId();
  writeStoredActiveUserId(null);
  const { clearUserOfflineData, listKnownOfflineUsers } = await import(
    "@/lib/offline/db"
  );
  if (targetId) {
    await clearUserOfflineData(targetId).catch(() => undefined);
    return;
  }
  const known = listKnownOfflineUsers();
  await Promise.allSettled(known.map((id) => clearUserOfflineData(id)));
}

function detectPlatformCapabilities(): {
  isStandalone: boolean;
  isIos: boolean;
  isIosSafari: boolean;
} {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return { isStandalone: false, isIos: false, isIosSafari: false };
  }

  const nav = navigator as Navigator & { standalone?: boolean };
  const isStandalone =
    Boolean(nav.standalone) ||
    Boolean(window.matchMedia?.("(display-mode: standalone)").matches);

  const ua = navigator.userAgent || "";
  const isIos =
    /iPad|iPhone|iPod/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isWebKit = /WebKit/i.test(ua);
  const isNonSafariIos = /CriOS|FxiOS|OPiOS|EdgiOS/i.test(ua);
  const isIosSafari = isIos && isWebKit && !isNonSafariIos;

  return { isStandalone, isIos, isIosSafari };
}

const SSR_PLATFORM_CAPABILITIES = {
  isStandalone: false,
  isIos: false,
  isIosSafari: false,
} as const;

let cachedClientPlatform: {
  isStandalone: boolean;
  isIos: boolean;
  isIosSafari: boolean;
} | null = null;

function subscribePlatformCapabilities(callback: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const onInstalled = () => {
    cachedClientPlatform = null;
    callback();
  };
  window.addEventListener("appinstalled", onInstalled);
  const mql = window.matchMedia?.("(display-mode: standalone)");
  mql?.addEventListener?.("change", onInstalled);
  return () => {
    window.removeEventListener("appinstalled", onInstalled);
    mql?.removeEventListener?.("change", onInstalled);
  };
}

function getPlatformCapabilitiesSnapshot(): {
  isStandalone: boolean;
  isIos: boolean;
  isIosSafari: boolean;
} {
  if (!cachedClientPlatform) {
    cachedClientPlatform = detectPlatformCapabilities();
  }
  return cachedClientPlatform;
}

function subscribeOnlineStatus(callback: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function getOnlineSnapshot(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}

export interface PwaProviderProps {
  children: React.ReactNode;
  /** Optional explicit userId override (useful in tests or authenticated shells) */
  userId?: string | null;
  /** Hide top status banners if parent renders custom banners */
  hideBanners?: boolean;
}

export function PwaProvider({
  children,
  userId: explicitUserId,
  hideBanners = false,
}: PwaProviderProps) {
  const pathname = usePathname();
  const i18n = useOptionalI18n();
  const locale = i18n?.locale ?? "vi";

  const isOnline = React.useSyncExternalStore(
    subscribeOnlineStatus,
    getOnlineSnapshot,
    () => true,
  );

  const detectedPlatform = React.useSyncExternalStore(
    subscribePlatformCapabilities,
    getPlatformCapabilitiesSnapshot,
    () => SSR_PLATFORM_CAPABILITIES,
  );
  const [installedOverride, setInstalledOverride] = React.useState(false);
  const platform = React.useMemo(
    () => ({
      ...detectedPlatform,
      isStandalone: detectedPlatform.isStandalone || installedOverride,
    }),
    [detectedPlatform, installedOverride],
  );

  const [deferredPrompt, setDeferredPrompt] =
    React.useState<BeforeInstallPromptEvent | null>(null);
  const [installOutcome, setInstallOutcome] = React.useState<
    "idle" | "accepted" | "dismissed"
  >("idle");
  const [swRegistered, setSwRegistered] = React.useState(false);
  const [waitingWorker, setWaitingWorker] = React.useState<ServiceWorker | null>(
    null,
  );
  const [examLockManual, setExamLockManual] = React.useState(false);
  const [resolvedUserId, setResolvedUserId] = React.useState<string | null>(
    () => explicitUserId ?? readStoredActiveUserId(),
  );
  const [syncSummaryState, setSyncSummaryState] =
    React.useState<SyncQueueSummary | null>(null);
  const [isSyncing, setIsSyncing] = React.useState(false);
  const [offlineRevision, setOfflineRevision] = React.useState(0);

  const prevUserIdRef = React.useRef<string | null>(
    explicitUserId ?? readStoredActiveUserId(),
  );
  const reloadingForUpdateRef = React.useRef(false);

  const activeUserId = explicitUserId !== undefined ? explicitUserId : resolvedUserId;
  const syncSummary = activeUserId ? syncSummaryState : null;
  const isExamActive = examLockManual || isActiveExamRoutePath(pathname);
  const updateAvailable = waitingWorker !== null;

  // Capture beforeinstallprompt & appinstalled lifecycle events
  React.useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setInstallOutcome("accepted");
      setInstalledOverride(true);
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstallPrompt,
      );
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  // Register Service Worker (`/sw.js`) with safe update detection (never auto-skipWaiting)
  React.useEffect(() => {
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      typeof navigator.serviceWorker.register !== "function"
    ) {
      return;
    }

    let cancelled = false;

    const handleControllerChange = () => {
      if (reloadingForUpdateRef.current) {
        window.location.reload();
      }
    };

    navigator.serviceWorker.addEventListener(
      "controllerchange",
      handleControllerChange,
    );

    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((registration) => {
        if (cancelled) return;
        setSwRegistered(true);

        if (registration.waiting) {
          setWaitingWorker(registration.waiting);
        }

        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (
              installing.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              setWaitingWorker(installing);
            }
          });
        });
      })
      .catch(() => {
        // Non-fatal in unsupported dev contexts or private windows
      });

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        handleControllerChange,
      );
    };
  }, []);

  // Track authenticated account safely via lazy-loaded Supabase & IndexedDB modules
  // (avoids pulling @supabase & idb chunks into anonymous landing/auth routes).
  React.useEffect(() => {
    let mounted = true;
    let unsubscribeAuth: (() => void) | null = null;

    if (explicitUserId !== undefined) {
      const prev = prevUserIdRef.current;
      prevUserIdRef.current = explicitUserId;
      writeStoredActiveUserId(explicitUserId);
      if (prev || explicitUserId) {
        void import("@/lib/offline/db").then(
          async ({ setActiveOfflineUserId, switchOfflineUser }) => {
            if (!mounted) return;
            if (prev !== explicitUserId) {
              await switchOfflineUser(prev, explicitUserId);
            }
            setActiveOfflineUserId(explicitUserId);
          },
        );
      }
      return () => {
        mounted = false;
      };
    }

    const storedPointer = readStoredActiveUserId();
    const skipClientAuthBootstrap =
      isPublicUnauthRoutePath(pathname) && !storedPointer;

    if (skipClientAuthBootstrap) {
      return () => {
        mounted = false;
      };
    }

    void (async () => {
      const [{ tryCreateClient }, { setActiveOfflineUserId, switchOfflineUser }] =
        await Promise.all([
          import("@/lib/supabase/client"),
          import("@/lib/offline/db"),
        ]);

      if (!mounted) return;

      if (storedPointer) {
        setActiveOfflineUserId(storedPointer);
        prevUserIdRef.current = storedPointer;
      }

      const supabase = tryCreateClient();
      if (!supabase) return;

      if (getOnlineSnapshot()) {
        void supabase.auth
          .getUser()
          .then(async ({ data }) => {
            if (!mounted) return;
            const nextId = data.user?.id ?? null;
            const prev = prevUserIdRef.current;
            if (prev && prev !== nextId) {
              await switchOfflineUser(prev, nextId);
            }
            prevUserIdRef.current = nextId;
            setResolvedUserId(nextId);
            setActiveOfflineUserId(nextId);
            writeStoredActiveUserId(nextId);
          })
          .catch(() => {
            // Keep offline pointer when unreachable
          });
      }

      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((event, session) => {
        if (!mounted) return;
        if (event === "SIGNED_OUT") {
          const prev = prevUserIdRef.current;
          prevUserIdRef.current = null;
          setResolvedUserId(null);
          setSyncSummaryState(null);
          void clearOfflineDataForLogout(prev);
          setOfflineRevision((r) => r + 1);
          return;
        }

        const nextId = session?.user?.id ?? null;
        if (nextId && nextId !== prevUserIdRef.current) {
          const prev = prevUserIdRef.current;
          prevUserIdRef.current = nextId;
          void switchOfflineUser(prev, nextId);
          setResolvedUserId(nextId);
          setActiveOfflineUserId(nextId);
          writeStoredActiveUserId(nextId);
          setOfflineRevision((r) => r + 1);
        }
      });

      if (!mounted) {
        subscription.unsubscribe();
      } else {
        unsubscribeAuth = () => subscription.unsubscribe();
      }
    })();

    return () => {
      mounted = false;
      unsubscribeAuth?.();
    };
  }, [explicitUserId, pathname]);

  const refreshOfflineState = React.useCallback(async () => {
    if (!activeUserId) {
      setSyncSummaryState(null);
      return;
    }
    try {
      const { getSyncQueueSummary } = await import("@/lib/offline/sync-queue");
      const summary = await getSyncQueueSummary(activeUserId);
      setSyncSummaryState(summary);
      setOfflineRevision((r) => r + 1);
    } catch {
      // IndexedDB unavailable or private mode
    }
  }, [activeUserId]);

  const syncNow = React.useCallback(
    async (force: boolean = false): Promise<SyncRunOutcome | null> => {
      if (!activeUserId || !getOnlineSnapshot()) {
        return null;
      }
      setIsSyncing(true);
      try {
        const { syncPendingEvents } = await import("@/lib/offline/sync-queue");
        const outcome = await syncPendingEvents(activeUserId, { force });
        await refreshOfflineState();
        return outcome;
      } catch {
        return null;
      } finally {
        setIsSyncing(false);
      }
    },
    [activeUserId, refreshOfflineState],
  );

  // Load initial sync summary & auto-sync when online or returning to foreground
  React.useEffect(() => {
    if (!activeUserId) {
      return;
    }

    let active = true;
    void (async () => {
      try {
        const { getSyncQueueSummary } = await import("@/lib/offline/sync-queue");
        const summary = await getSyncQueueSummary(activeUserId);
        if (!active) return;
        setSyncSummaryState(summary);
        if (isOnline && summary.pendingCount > 0) {
          await syncNow(false);
        }
      } catch {
        // Ignore IDB errors in restricted environments
      }
    })();

    const handleVisibility = () => {
      if (
        document.visibilityState === "visible" &&
        getOnlineSnapshot() &&
        activeUserId
      ) {
        void syncNow(false);
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      active = false;
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [activeUserId, isOnline, syncNow]);

  const promptInstall = React.useCallback(async () => {
    if (!deferredPrompt) {
      return "unavailable" as const;
    }
    try {
      await deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      setInstallOutcome(choice.outcome);
      if (choice.outcome === "accepted") {
        setDeferredPrompt(null);
      }
      return choice.outcome;
    } catch {
      return "unavailable" as const;
    }
  }, [deferredPrompt]);

  const applyAppUpdate = React.useCallback(() => {
    if (!waitingWorker || isExamActive) {
      return;
    }
    reloadingForUpdateRef.current = true;
    waitingWorker.postMessage({ type: "APPLY_UPDATE" });
  }, [waitingWorker, isExamActive]);

  const clearCurrentUserOfflineData = React.useCallback(async () => {
    if (!activeUserId) return;
    const { clearUserOfflineData } = await import("@/lib/offline/db");
    await clearUserOfflineData(activeUserId);
    setSyncSummaryState(null);
    setOfflineRevision((r) => r + 1);
  }, [activeUserId]);

  const contextValue = React.useMemo<PwaContextValue>(
    () => ({
      isOnline,
      isStandalone: platform.isStandalone,
      isIos: platform.isIos,
      isIosSafari: platform.isIosSafari,
      canInstallPrompt: deferredPrompt !== null && !platform.isStandalone,
      installOutcome,
      promptInstall,
      swRegistered,
      updateAvailable,
      isExamActive,
      setExamLockActive: setExamLockManual,
      applyAppUpdate,
      activeUserId,
      syncSummary,
      isSyncing,
      offlineRevision,
      syncNow,
      refreshOfflineState,
      clearCurrentUserOfflineData,
    }),
    [
      isOnline,
      platform.isStandalone,
      platform.isIos,
      platform.isIosSafari,
      deferredPrompt,
      installOutcome,
      promptInstall,
      swRegistered,
      updateAvailable,
      isExamActive,
      applyAppUpdate,
      activeUserId,
      syncSummary,
      isSyncing,
      offlineRevision,
      syncNow,
      refreshOfflineState,
      clearCurrentUserOfflineData,
    ],
  );

  const vi = locale === "vi";

  return (
    <PwaContext.Provider value={contextValue}>
      {!hideBanners && !isOnline && (
        <div
          role="status"
          aria-live="polite"
          data-testid="pwa-offline-banner"
          className="border-warning/30 bg-warning-subtle text-warning-subtle-foreground border-b px-4 py-2 text-xs sm:text-sm"
        >
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <WifiOff className="size-4 shrink-0" aria-hidden="true" />
              <span className="truncate font-medium">
                {i18n
                  ? i18n.t("pwa.offlineBanner")
                  : vi
                    ? "Bạn đang ngoại tuyến — các học phần đã tải vẫn sẵn sàng để luyện tập."
                    : "You are offline — downloaded study sets remain available for practice."}
              </span>
            </div>
            {syncSummary && syncSummary.pendingCount > 0 && (
              <span className="shrink-0 font-medium tabular-nums">
                {i18n
                  ? i18n.t("pwa.pendingSyncCount", {
                      count: syncSummary.pendingCount,
                    })
                  : vi
                    ? `${syncSummary.pendingCount} mục chờ đồng bộ`
                    : `${syncSummary.pendingCount} pending sync`}
              </span>
            )}
          </div>
        </div>
      )}

      {!hideBanners && updateAvailable && (
        <div
          role="status"
          aria-live="polite"
          data-testid="pwa-update-banner"
          className="border-primary/25 bg-accent text-accent-foreground border-b px-4 py-2.5 text-xs sm:text-sm"
        >
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              {isExamActive ? (
                <ShieldAlert className="size-4 shrink-0" aria-hidden="true" />
              ) : (
                <RefreshCw className="size-4 shrink-0" aria-hidden="true" />
              )}
              <div className="min-w-0">
                <p className="font-medium">
                  {i18n
                    ? i18n.t("pwa.updateAvailableTitle")
                    : vi
                      ? "Đã có phiên bản StudyHub mới"
                      : "A new version of StudyHub is available"}
                </p>
                <p className="text-muted-foreground text-xs">
                  {isExamActive
                    ? i18n
                      ? i18n.t("pwa.updateDeferredExam")
                      : vi
                        ? "Bản cập nhật sẽ được áp dụng sau khi bạn nộp bài thi hiện tại."
                        : "The update will be applied after you finish your active exam."
                    : i18n
                      ? i18n.t("pwa.updateAvailableDesc")
                      : vi
                        ? "Tải lại ứng dụng để áp dụng các cải tiến mới nhất."
                        : "Reload the app to apply the latest improvements."}
                </p>
              </div>
            </div>
            {!isExamActive && (
              <Button size="sm" onClick={applyAppUpdate}>
                <RefreshCw className="size-3.5" aria-hidden="true" />
                {i18n
                  ? i18n.t("pwa.applyUpdate")
                  : vi
                    ? "Cập nhật ngay"
                    : "Update now"}
              </Button>
            )}
          </div>
        </div>
      )}

      {children}
    </PwaContext.Provider>
  );
}

export function usePwa(): PwaContextValue {
  const ctx = React.useContext(PwaContext);
  if (!ctx) {
    throw new Error("usePwa must be used within a PwaProvider");
  }
  return ctx;
}

export function useOptionalPwa(): PwaContextValue | null {
  return React.useContext(PwaContext);
}
