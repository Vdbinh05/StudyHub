"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";
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
      richColors
      closeButton
    />
  );
}

/**
 * Single shared authenticated user bootstrap:
 * - Shares `["current-profile"]` with `AppShell` and `ProfileView` so only ONE
 *   `GET /api/profile` request fires on authenticated app load.
 * - Seeds `["user-preferences"]` from the same response -> ZERO duplicate `GET /api/preferences`.
 * - Supplies explicit `userId` to `PwaProvider` -> ZERO `@supabase/supabase-js` dynamic import
 *   or redundant browser `auth.getUser()` on authenticated routes.
 */
function AuthenticatedBootstrap({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/dashboard";
  const queryClient = useQueryClient();
  const supabaseConfigured = isSupabaseConfiguredClient();
  const isFocusRoute = FOCUS_ROUTE_PATTERN.test(pathname);

  const [storedUserId] = React.useState<string | null>(() =>
    readStoredActiveUserId(),
  );
  const [hasCachedPrefs] = React.useState<boolean>(() =>
    hasStoredLocalPreferences(),
  );

  // On focus routes (e.g. live exam / flashcards / practice), skip eager /api/profile
  // if we already have cached local preferences & stored user pointer from prior navigation.
  const shouldFetchProfile =
    supabaseConfigured && (!isFocusRoute || !storedUserId || !hasCachedPrefs);

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

  const resolvedUserId: string | null = profileQuery.data?.profile?.id
    ? profileQuery.data.profile.id
    : profileQuery.isSuccess && profileQuery.data === null
      ? null
      : storedUserId;

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
}: {
  children: React.ReactNode;
}) {
  const [queryClient] = React.useState(makeQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthenticatedBootstrap>{children}</AuthenticatedBootstrap>
    </QueryClientProvider>
  );
}
