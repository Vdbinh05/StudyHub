"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { QueryClientContext } from "@tanstack/react-query";
import { RefreshCw, ShieldAlert, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOptionalI18n } from "@/lib/i18n";
import type { SyncQueueSummary, SyncRunOutcome } from "@/lib/offline/sync-queue";
import { invalidateLearningCaches } from "@/lib/query-keys";

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

/**
 * Detect dedicated live exam attempt runner routes (`/exams/[attemptId]`) which render
 * their own server-authoritative offline banner and header sync pill.
 */
export function isLiveExamAttemptRoutePath(
  pathname: string | null | undefined,
): boolean {
  if (!pathname) return false;
  if (/^\/exams\/([^/]+)$/.test(pathname)) {
    const segment = pathname.split("/")[2];
    return Boolean(segment && segment !== "new");
  }
  return false;
}

/**
 * Detect focus study & exam routes where mobile offline status must stay compact and
 * non-stacking (`V32-035` / `RU-12`).
 */
export function isFocusStudyOrExamRoutePath(
  pathname: string | null | undefined,
): boolean {
  if (!pathname) return false;
  if (isActiveExamRoutePath(pathname)) return true;
  if (pathname === "/exams" || pathname.startsWith("/exams/")) return true;
  if (
    /^\/sets\/[^/]+\/(practice|flashcards|learn|write|spell|match|diagrams)(?:\/|$)/.test(
      pathname,
    )
  ) {
    return true;
  }
  if (/^\/diagrams\/[^/]+\/study(?:\/|$)/.test(pathname)) {
    return true;
  }
  return false;
}

export function readStoredActiveUserId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const val = window.localStorage.getItem(ACTIVE_USER_POINTER_KEY);
    return val && val.trim().length > 0 ? val.trim() : null;
  } catch {
    return null;
  }
}

function scheduleAfterLoadIdle(
  task: () => void,
  idleTimeoutMs = 2000,
): () => void {
  if (typeof window === "undefined") return () => undefined;

  let cancelled = false;
  let idleHandle: number | null = null;
  let timerHandle: number | null = null;
  let waitingForLoad = false;

  const runTask = () => {
    if (cancelled) return;
    task();
  };

  const scheduleIdle = () => {
    if (cancelled) return;
    const win = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (typeof win.requestIdleCallback === "function") {
      idleHandle = win.requestIdleCallback(runTask, { timeout: idleTimeoutMs });
    } else {
      const delay = document.readyState === "complete" ? 0 : 350;
      timerHandle = window.setTimeout(runTask, delay);
    }
  };

  if (document.readyState === "complete") {
    scheduleIdle();
  } else {
    waitingForLoad = true;
    window.addEventListener("load", scheduleIdle, { once: true });
  }

  return () => {
    cancelled = true;
    if (waitingForLoad) {
      window.removeEventListener("load", scheduleIdle);
    }
    const win = window as Window & {
      cancelIdleCallback?: (id: number) => void;
    };
    if (idleHandle !== null && typeof win.cancelIdleCallback === "function") {
      win.cancelIdleCallback(idleHandle);
    }
    if (timerHandle !== null) {
      window.clearTimeout(timerHandle);
    }
  };
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
  const queryClient = React.useContext(QueryClientContext);
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

  const hasExplicitUserId = explicitUserId !== undefined;
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
  const [resolvedUserId, setResolvedUserId] = React.useState<string | null>(() =>
    hasExplicitUserId ? explicitUserId : readStoredActiveUserId(),
  );
  const [syncSummaryEntry, setSyncSummaryEntry] = React.useState<{
    userId: string;
    summary: SyncQueueSummary;
  } | null>(null);
  const [isSyncing, setIsSyncing] = React.useState(false);
  const [offlineRevision, setOfflineRevision] = React.useState(0);

  // Initialize from stored pointer so an account transition on fresh mount (userA -> userB)
  // ALWAYS closes userA's IndexedDB handle before opening userB's partition (`SEC-01`).
  const prevUserIdRef = React.useRef<string | null>(readStoredActiveUserId());
  const partitionSwitchPromiseRef = React.useRef<Promise<void>>(Promise.resolve());
  const reloadingForUpdateRef = React.useRef(false);

  // Strictly trust server-verified explicitUserId when provided (never fall back to stale localStorage)
  const activeUserId = hasExplicitUserId ? explicitUserId : resolvedUserId;
  // User-tagged syncSummary derivation prevents any 1-frame cross-account flash (`SEC-01`)
  const syncSummary =
    activeUserId && syncSummaryEntry?.userId === activeUserId
      ? syncSummaryEntry.summary
      : null;
  const pendingSyncCount = syncSummary?.pendingCount ?? 0;
  const isExamActive = examLockManual || isActiveExamRoutePath(pathname);
  const isUpdateDeferred = isExamActive || pendingSyncCount > 0;
  const updateAvailable = waitingWorker !== null;

  const activeUserIdRef = React.useRef<string | null>(activeUserId);
  const isExamActiveRef = React.useRef<boolean>(isExamActive);
  const pendingSyncCountRef = React.useRef<number>(pendingSyncCount);

  React.useEffect(() => {
    activeUserIdRef.current = activeUserId;
  }, [activeUserId]);

  React.useEffect(() => {
    isExamActiveRef.current = isExamActive;
  }, [isExamActive]);

  React.useEffect(() => {
    pendingSyncCountRef.current = pendingSyncCount;
  }, [pendingSyncCount]);

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

  // Register Service Worker (`/sw.js`) deferred until window load + idle so SW startup
  // never competes with FCP/LCP on mobile (never auto-skipWaiting; clean listener teardown for MEM-03).
  React.useEffect(() => {
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      typeof navigator.serviceWorker.register !== "function"
    ) {
      return;
    }

    let cancelled = false;
    let activeRegistration: ServiceWorkerRegistration | null = null;
    let handleUpdateFound: (() => void) | null = null;
    const installingCleanups = new Set<() => void>();

    const handleControllerChange = () => {
      if (
        reloadingForUpdateRef.current &&
        !isExamActiveRef.current &&
        pendingSyncCountRef.current === 0
      ) {
        window.location.reload();
      }
    };

    navigator.serviceWorker.addEventListener(
      "controllerchange",
      handleControllerChange,
    );

    const attachInstallingListener = (installing: ServiceWorker | null) => {
      if (!installing || cancelled) return;
      const handleStateChange = () => {
        if (cancelled) return;
        if (
          installing.state === "installed" &&
          navigator.serviceWorker.controller
        ) {
          setWaitingWorker(installing);
        }
        if (
          installing.state === "installed" ||
          installing.state === "redundant"
        ) {
          if (typeof installing.removeEventListener === "function") {
            installing.removeEventListener("statechange", handleStateChange);
          }
          installingCleanups.delete(cleanup);
        }
      };
      const cleanup = () => {
        if (typeof installing.removeEventListener === "function") {
          installing.removeEventListener("statechange", handleStateChange);
        }
      };
      installingCleanups.add(cleanup);
      if (typeof installing.addEventListener === "function") {
        installing.addEventListener("statechange", handleStateChange);
      }
    };

    const cancelDeferred = scheduleAfterLoadIdle(() => {
      if (cancelled) return;
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .then((registration) => {
          if (cancelled) return;
          setSwRegistered(true);

          if (registration.waiting) {
            setWaitingWorker(registration.waiting);
          }

          if (registration.installing) {
            attachInstallingListener(registration.installing);
          }

          const onUpdateFound = () => {
            if (cancelled) return;
            attachInstallingListener(registration.installing);
          };

          activeRegistration = registration;
          handleUpdateFound = onUpdateFound;
          if (typeof registration.addEventListener === "function") {
            registration.addEventListener("updatefound", onUpdateFound);
          }
        })
        .catch(() => {
          // Non-fatal in unsupported dev contexts or private windows
        });
    }, 2000);

    return () => {
      cancelled = true;
      cancelDeferred();
      navigator.serviceWorker.removeEventListener(
        "controllerchange",
        handleControllerChange,
      );
      if (
        activeRegistration &&
        handleUpdateFound &&
        typeof activeRegistration.removeEventListener === "function"
      ) {
        activeRegistration.removeEventListener("updatefound", handleUpdateFound);
      }
      for (const cleanupInstalling of installingCleanups) {
        cleanupInstalling();
      }
      installingCleanups.clear();
    };
  }, []);

  // Track authenticated account safely via explicit userId (preferred: zero @supabase/supabase-js
  // bundle on app routes) or lazy-loaded fallback when mounted standalone.
  React.useEffect(() => {
    let mounted = true;
    let unsubscribeAuth: (() => void) | null = null;
    let cancelIdleDb: (() => void) | null = null;

    if (explicitUserId !== undefined) {
      const prev = prevUserIdRef.current ?? readStoredActiveUserId();
      prevUserIdRef.current = explicitUserId;
      writeStoredActiveUserId(explicitUserId);

      if (prev && prev !== explicitUserId) {
        // Immediate account switch isolation (P0 security guarantee — SEC-01):
        // close userA's IndexedDB handle BEFORE opening userB's DB or scheduling syncNow().
        const switchTask = import("@/lib/offline/db")
          .then(async ({ setActiveOfflineUserId, switchOfflineUser }) => {
            await switchOfflineUser(prev, explicitUserId);
            if (!mounted) return;
            setActiveOfflineUserId(explicitUserId);
            setSyncSummaryEntry(null);
            setOfflineRevision((r) => r + 1);
          })
          .catch(() => undefined);
        partitionSwitchPromiseRef.current = switchTask;
      } else if (explicitUserId) {
        // Same account as stored pointer — defer IndexedDB module activation to idle
        cancelIdleDb = scheduleAfterLoadIdle(() => {
          void import("@/lib/offline/db").then(({ setActiveOfflineUserId }) => {
            if (!mounted) return;
            setActiveOfflineUserId(explicitUserId);
          });
        }, 2500);
      }

      return () => {
        mounted = false;
        cancelIdleDb?.();
      };
    }

    const storedPointer = readStoredActiveUserId();
    if (storedPointer) {
      prevUserIdRef.current = storedPointer;
    }

    const skipClientAuthBootstrap =
      isPublicUnauthRoutePath(pathname) && !storedPointer;

    if (skipClientAuthBootstrap) {
      return () => {
        mounted = false;
      };
    }

    cancelIdleDb = scheduleAfterLoadIdle(() => {
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
                const switchTask = switchOfflineUser(prev, nextId).catch(
                  () => undefined,
                );
                partitionSwitchPromiseRef.current = switchTask;
                await switchTask;
              }
              if (!mounted) return;
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
            setSyncSummaryEntry(null);
            const clearTask = clearOfflineDataForLogout(prev).catch(
              () => undefined,
            );
            partitionSwitchPromiseRef.current = clearTask;
            setOfflineRevision((r) => r + 1);
            return;
          }

          const nextId = session?.user?.id ?? null;
          if (nextId && nextId !== prevUserIdRef.current) {
            const prev = prevUserIdRef.current;
            prevUserIdRef.current = nextId;
            const switchTask = switchOfflineUser(prev, nextId).catch(
              () => undefined,
            );
            partitionSwitchPromiseRef.current = switchTask;
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
    }, 2500);

    return () => {
      mounted = false;
      cancelIdleDb?.();
      unsubscribeAuth?.();
    };
  }, [explicitUserId, pathname]);

  const refreshOfflineState = React.useCallback(async () => {
    if (!activeUserId) {
      setSyncSummaryEntry(null);
      return;
    }
    try {
      await partitionSwitchPromiseRef.current;
      if (activeUserIdRef.current !== activeUserId) {
        return;
      }
      const { getSyncQueueSummary } = await import("@/lib/offline/sync-queue");
      const summary = await getSyncQueueSummary(activeUserId);
      if (activeUserIdRef.current !== activeUserId) {
        return;
      }
      setSyncSummaryEntry({ userId: activeUserId, summary });
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
        await partitionSwitchPromiseRef.current;
        if (activeUserIdRef.current !== activeUserId || !getOnlineSnapshot()) {
          return null;
        }
        const { syncPendingEvents } = await import("@/lib/offline/sync-queue");
        const outcome = await syncPendingEvents(activeUserId, { force });
        if (activeUserIdRef.current !== activeUserId) {
          return outcome;
        }
        if (outcome.appliedCount > 0 && queryClient) {
          await invalidateLearningCaches(queryClient);
        }
        await refreshOfflineState();
        return outcome;
      } catch {
        return null;
      } finally {
        setIsSyncing(false);
      }
    },
    [activeUserId, queryClient, refreshOfflineState],
  );

  // Load initial sync summary & auto-sync when online or returning to foreground (deferred to idle)
  React.useEffect(() => {
    if (!activeUserId) {
      return;
    }

    let active = true;
    const cancelDeferred = scheduleAfterLoadIdle(() => {
      void (async () => {
        try {
          await partitionSwitchPromiseRef.current;
          if (!active || activeUserIdRef.current !== activeUserId) return;
          const { getSyncQueueSummary } = await import("@/lib/offline/sync-queue");
          const summary = await getSyncQueueSummary(activeUserId);
          if (!active || activeUserIdRef.current !== activeUserId) return;
          setSyncSummaryEntry({ userId: activeUserId, summary });
          const hasAutoSyncablePending =
            summary.pendingCount > summary.authRequiredCount;
          if (isOnline && hasAutoSyncablePending) {
            await syncNow(false);
          }
        } catch {
          // Ignore IDB errors in restricted environments
        }
      })();
    }, 2500);

    const handleVisibility = () => {
      if (
        document.visibilityState === "visible" &&
        getOnlineSnapshot() &&
        activeUserIdRef.current === activeUserId
      ) {
        void syncNow(false);
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      active = false;
      cancelDeferred();
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
    if (!waitingWorker || isExamActive || pendingSyncCount > 0) {
      return;
    }
    reloadingForUpdateRef.current = true;
    waitingWorker.postMessage({ type: "APPLY_UPDATE" });
  }, [waitingWorker, isExamActive, pendingSyncCount]);

  const clearCurrentUserOfflineData = React.useCallback(async () => {
    if (!activeUserId) return;
    await partitionSwitchPromiseRef.current;
    const { clearUserOfflineData } = await import("@/lib/offline/db");
    await clearUserOfflineData(activeUserId);
    setSyncSummaryEntry(null);
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
  const isOfflineHubRoute = pathname === "/offline";
  const isLiveExamRoute = isLiveExamAttemptRoutePath(pathname);
  const isCompactFocusRoute = isFocusStudyOrExamRoutePath(pathname);
  const shouldRenderOfflineBanner =
    !hideBanners && !isOnline && !isOfflineHubRoute && !isLiveExamRoute;

  return (
    <PwaContext.Provider value={contextValue}>
      {shouldRenderOfflineBanner &&
        (isCompactFocusRoute ? (
          <div
            role="status"
            aria-live="polite"
            data-testid="pwa-offline-banner"
            data-variant="compact"
            className="border-warning/30 bg-warning-subtle text-warning-subtle-foreground border-b px-3 py-1 text-xs"
          >
            <div className="mx-auto flex max-w-6xl items-center justify-center gap-2">
              <WifiOff className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="font-medium">
                {vi ? "Ngoại tuyến" : "Offline"}
              </span>
              {pendingSyncCount > 0 && (
                <span className="tabular-nums opacity-90">
                  ·{" "}
                  {vi
                    ? `${pendingSyncCount} chờ đồng bộ`
                    : `${pendingSyncCount} pending sync`}
                </span>
              )}
            </div>
          </div>
        ) : (
          <div
            role="status"
            aria-live="polite"
            data-testid="pwa-offline-banner"
            data-variant="standard"
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
              {pendingSyncCount > 0 && (
                <span className="shrink-0 font-medium tabular-nums">
                  {i18n
                    ? i18n.t("pwa.pendingSyncCount", {
                        count: pendingSyncCount,
                      })
                    : vi
                      ? `${pendingSyncCount} mục chờ đồng bộ`
                      : `${pendingSyncCount} pending sync`}
                </span>
              )}
            </div>
          </div>
        ))}

      {!hideBanners && updateAvailable && (
        <div
          role="status"
          aria-live="polite"
          data-testid="pwa-update-banner"
          className="border-primary/25 bg-accent text-accent-foreground border-b px-4 py-2.5 text-xs sm:text-sm"
        >
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              {isUpdateDeferred ? (
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
                    : pendingSyncCount > 0
                      ? vi
                        ? `Bản cập nhật đang tạm hoãn để đồng bộ an toàn ${pendingSyncCount} mục ngoại tuyến trước.`
                        : `Update paused until ${pendingSyncCount} pending offline item(s) finish syncing.`
                      : i18n
                        ? i18n.t("pwa.updateAvailableDesc")
                        : vi
                          ? "Tải lại ứng dụng để áp dụng các cải tiến mới nhất."
                          : "Reload the app to apply the latest improvements."}
                </p>
              </div>
            </div>
            {!isUpdateDeferred && (
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
