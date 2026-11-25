"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import {
  ApiError,
  apiFetch,
  isSupabaseConfiguredClient,
} from "@/components/layout/api-client";
import { ShortcutProvider } from "@/components/layout/ShortcutProvider";
import {
  PwaProvider,
  readStoredActiveUserId,
} from "@/components/pwa/PwaProvider";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  purgeAllUserClientState,
  subscribeAuthBroadcastEvents,
} from "@/lib/auth/client-session-cleanup";
import {
  hasStoredLocalPreferences,
  PreferencesProvider,
} from "@/lib/preferences";
import type { Profile, UserPreferences } from "@/types/domain";

const FOCUS_ROUTE_PATTERN =
  /^(\/sets\/[^/]+\/(flashcards|learn|practice|write|spell|match|test|results)(?:\/|$)|\/exams\/(?!new(?:\/|$))[^/]+(?:\/|$))/;

interface ProfileBundle {
  profile: Profile | null;
  preferences?: UserPreferences | null;
}

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: (failureCount, error) => {
          if (failureCount >= 1) return false;
          if (error instanceof ApiError) {
            if (
              error.status === 400 ||
              error.status === 401 ||
              error.status === 403 ||
              error.status === 404 ||
              error.status === 503 ||
              error.code === "SUPABASE_NOT_CONFIGURED"
            ) {
              return false;
            }
          }
          return true;
        },
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}

function ResponsiveToaster() {
  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  return (
    <Toaster
      position={isMobile ? "top-center" : "bottom-right"}
      offset={isMobile ? { top: 12 } : { bottom: 24, right: 20 }}
      mobileOffset={{ top: 12, left: 12, right: 12 }}
      richColors
      closeButton
    />
  );
}

/**
 * Single shared authenticated user bootstrap:
 * - Receives server-verified `initialUserId` from `src/app/(app)/layout.tsx` (`supabase.auth.getUser()`),
 *   so we NEVER trust `localStorage["studyhub-offline-active-user"]` before server verification (`SEC-01`).
 * - Shares `["current-profile"]` with `AppShell` and `ProfileView` so only ONE
 *   `GET /api/profile` request fires on authenticated app load.
 * - Seeds `["user-preferences"]` from the same response -> ZERO duplicate `GET /api/preferences`.
 * - Purges React Query & local caches immediately on user-id transition or cross-tab auth broadcast (`SEC-02`/`SEC-03`).
 */
function AuthenticatedBootstrap({
  children,
  initialUserId = null,
}: {
  children: React.ReactNode;
  initialUserId?: string | null;
}) {
  const pathname = usePathname() ?? "/dashboard";
  const queryClient = useQueryClient();
  const supabaseConfigured = isSupabaseConfiguredClient();
  const isFocusRoute = FOCUS_ROUTE_PATTERN.test(pathname);

  const [stalePointerOnMount] = React.useState<string | null>(() => {
    const storedPointer = readStoredActiveUserId();
    return storedPointer && initialUserId && storedPointer !== initialUserId
      ? storedPointer
      : null;
  });
  const [hasCachedPrefs] = React.useState<boolean>(() =>
    hasStoredLocalPreferences(),
  );

  // If a prior user's session expired without UI Sign Out, purge their stale local state immediately
  React.useEffect(() => {
    if (stalePointerOnMount) {
      void purgeAllUserClientState(queryClient, stalePointerOnMount, {
        broadcast: false,
      });
    }
  }, [stalePointerOnMount, queryClient]);

  // On focus routes, only skip eager /api/profile when we have a SERVER-VERIFIED initialUserId,
  // no cross-account mismatch, and local preferences already exist.
  const shouldFetchProfile =
    supabaseConfigured &&
    (!isFocusRoute ||
      !initialUserId ||
      Boolean(stalePointerOnMount) ||
      !hasCachedPrefs);

  const profileQuery = useQuery<ProfileBundle | null>({
    queryKey: ["current-profile"],
    enabled: shouldFetchProfile,
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      try {
        const res = await apiFetch<Profile | ProfileBundle>("/api/profile");
        const raw = res.data;
        const bundle: ProfileBundle =
          raw && typeof raw === "object" && "profile" in raw
            ? (raw as ProfileBundle)
            : { profile: raw as Profile, preferences: null };

        if (bundle.preferences !== undefined) {
          queryClient.setQueryData(
            ["user-preferences"],
            bundle.preferences ?? null,
          );
        }
        return bundle;
      } catch (err) {
        if (err instanceof ApiError && (err.status === 401 || err.status === 503)) {
          return null;
        }
        throw err;
      }
    },
  });

  // Strictly server-verified identity only — NEVER fall back to untrusted localStorage pointer
  const resolvedUserId: string | null =
    profileQuery.isSuccess && profileQuery.data === null
      ? null
      : (profileQuery.data?.profile?.id ?? initialUserId ?? null);

  const prevUserIdRef = React.useRef<string | null>(resolvedUserId);
  const resolvedUserIdRef = React.useRef<string | null>(resolvedUserId);

  React.useEffect(() => {
    resolvedUserIdRef.current = resolvedUserId;
    const prev = prevUserIdRef.current;
    if (prev !== resolvedUserId) {
      prevUserIdRef.current = resolvedUserId;
      if (prev !== null) {
        void purgeAllUserClientState(queryClient, prev, { broadcast: false });
      }
    }
  }, [resolvedUserId, queryClient]);

  // Multi-tab isolation: purge React Query & redirect/reload immediately when another tab logs out or switches accounts
  React.useEffect(() => {
    return subscribeAuthBroadcastEvents((event) => {
      const currentId = resolvedUserIdRef.current;
      if (event.type === "logout") {
        void purgeAllUserClientState(queryClient, currentId, {
          broadcast: false,
        }).finally(() => {
          window.location.replace("/login");
        });
        return;
      }

      if (event.type === "account-switch" && event.userId !== currentId) {
        void purgeAllUserClientState(queryClient, currentId, {
          broadcast: false,
        }).finally(() => {
          window.location.reload();
        });
      }
    });
  }, [queryClient]);

  return (
    <PreferencesProvider
      initialPreferences={profileQuery.data?.preferences ?? null}
      deferRemoteFetch
    >
      <PwaProvider userId={resolvedUserId}>
        <ShortcutProvider>
          <TooltipProvider>
            {children}
            <ResponsiveToaster />
          </TooltipProvider>
        </ShortcutProvider>
      </PwaProvider>
    </PreferencesProvider>
  );
}

export function AuthenticatedProviders({
  children,
  initialUserId = null,
}: {
  children: React.ReactNode;
  initialUserId?: string | null;
}) {
  const [queryClient] = React.useState(makeQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthenticatedBootstrap initialUserId={initialUserId}>
        {children}
      </AuthenticatedBootstrap>
    </QueryClientProvider>
  );
}
