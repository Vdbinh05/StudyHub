"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import {
  ApiError,
  apiFetch,
  isSupabaseConfiguredClient,
} from "@/components/layout/api-client";
import { useI18n } from "@/lib/i18n";
import type {
  Locale,
  ModePreferences,
  ThemePreference,
  UserPreferences,
} from "@/types/domain";

const STORAGE_KEY = "studyhub-user-preferences";
const SHORTCUTS_ENABLED_KEY = "studyhub-shortcuts-enabled";

const PUBLIC_UNAUTH_PATHS = new Set([
  "/",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
]);

export type FeedbackSoundKind = "correct" | "wrong" | "complete" | "flip";

export interface StudyHubPreferences {
  language: Locale;
  theme: ThemePreference;
  daily_goal: number;
  /** Alias for `daily_goal` kept permanently in sync for learning/exam consumers */
  daily_goal_questions: number;
  default_shuffle_questions: boolean;
  default_shuffle_options: boolean;
  show_instant_feedback: boolean;
  sound_effects: boolean;
  reduced_motion: boolean;
  confidence_enabled: boolean;
  mode_preferences: ModePreferences;
}

export interface UpdateUserPreferencesInput {
  language?: Locale;
  theme?: ThemePreference;
  daily_goal?: number;
  daily_goal_questions?: number;
  default_shuffle_questions?: boolean;
  default_shuffle_options?: boolean;
  show_instant_feedback?: boolean;
  sound_effects?: boolean;
  reduced_motion?: boolean;
  confidence_enabled?: boolean;
  mode_preferences?: ModePreferences;
}

export interface UpdatePreferencesOptions {
  persistRemote?: boolean;
  throwOnError?: boolean;
}

export interface PlayFeedbackSoundOptions {
  /** Bypass stale React state check (e.g., immediate preview on first enable). */
  force?: boolean;
}

export interface PreferencesContextValue {
  preferences: StudyHubPreferences;
  isLoading: boolean;
  isSaving: boolean;
  isServerSynced: boolean;
  updatePreferences: (
    patch: UpdateUserPreferencesInput,
    options?: UpdatePreferencesOptions,
  ) => Promise<StudyHubPreferences>;
  refreshPreferences: () => Promise<void>;
  playFeedbackSound: (
    kind: FeedbackSoundKind,
    options?: PlayFeedbackSoundOptions,
  ) => void;
}

export const DEFAULT_MODE_PREFERENCES: ModePreferences = {
  flashcards: {
    start_side: "front",
    auto_play_audio: false,
    show_hints: true,
    show_keyboard_hints: true,
  },
  mc: {
    instant_feedback: true,
    auto_advance_ms: null,
    shuffle_options: true,
    show_explanation_on_correct: true,
  },
  learn: {
    objective: "exam_prep",
    batch_size: 10,
    enable_written_recall: true,
    require_independent_recall: true,
    ask_confidence: false,
  },
  write: {
    ignore_diacritics: false,
    ignore_case: true,
    allow_override: true,
  },
  spell: {
    speech_rate: 1.0,
    preferred_voice: null,
    preferred_lang: "vi-VN",
    auto_play_prompt: true,
    show_hint_letters: true,
    strict_diacritics: true,
  },
  diagram: {
    default_mode: "identify_location",
    show_hotspot_hints: true,
    point_tolerance_scale: 1.0,
  },
  shortcuts: {
    enabled: true,
    show_hints: true,
  },
  accessibility: {
    high_contrast_focus: false,
    large_reading_text: false,
    reduce_motion_override: false,
  },
};

export const DEFAULT_USER_PREFERENCES: StudyHubPreferences = {
  language: "vi",
  theme: "system",
  daily_goal: 20,
  daily_goal_questions: 20,
  default_shuffle_questions: false,
  default_shuffle_options: true,
  show_instant_feedback: true,
  sound_effects: false,
  reduced_motion: false,
  confidence_enabled: false,
  mode_preferences: DEFAULT_MODE_PREFERENCES,
};

function mergeModePrefs(
  base: ModePreferences | null | undefined,
  incoming: ModePreferences | null | undefined,
): ModePreferences {
  const b = base ?? DEFAULT_MODE_PREFERENCES;
  const inc = incoming ?? {};
  return {
    flashcards: { ...DEFAULT_MODE_PREFERENCES.flashcards, ...b.flashcards, ...inc.flashcards },
    mc: { ...DEFAULT_MODE_PREFERENCES.mc, ...b.mc, ...inc.mc },
    learn: { ...DEFAULT_MODE_PREFERENCES.learn, ...b.learn, ...inc.learn },
    write: { ...DEFAULT_MODE_PREFERENCES.write, ...b.write, ...inc.write },
    spell: { ...DEFAULT_MODE_PREFERENCES.spell, ...b.spell, ...inc.spell },
    diagram: { ...DEFAULT_MODE_PREFERENCES.diagram, ...b.diagram, ...inc.diagram },
    shortcuts: { ...DEFAULT_MODE_PREFERENCES.shortcuts, ...b.shortcuts, ...inc.shortcuts },
    accessibility: {
      ...DEFAULT_MODE_PREFERENCES.accessibility,
      ...b.accessibility,
      ...inc.accessibility,
    },
  };
}

function clampDailyGoal(value: unknown, fallback = 20): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(1, Math.min(500, Math.round(num)));
}

function normalizePreferences(
  raw: Partial<StudyHubPreferences> | Partial<UserPreferences> | null | undefined,
  base: StudyHubPreferences = DEFAULT_USER_PREFERENCES,
): StudyHubPreferences {
  if (!raw) return base;
  const rawGoal =
    "daily_goal" in raw && raw.daily_goal !== undefined
      ? raw.daily_goal
      : "daily_goal_questions" in raw && raw.daily_goal_questions !== undefined
        ? raw.daily_goal_questions
        : base.daily_goal;
  const goal = clampDailyGoal(rawGoal, base.daily_goal);

  const language: Locale =
    raw.language === "vi" || raw.language === "en" ? raw.language : base.language;
  const theme: ThemePreference =
    raw.theme === "light" || raw.theme === "dark" || raw.theme === "system"
      ? raw.theme
      : base.theme;

  const rawConfidence =
    "confidence_enabled" in raw && typeof raw.confidence_enabled === "boolean"
      ? raw.confidence_enabled
      : base.confidence_enabled;

  const rawModePrefs =
    "mode_preferences" in raw &&
    raw.mode_preferences &&
    typeof raw.mode_preferences === "object"
      ? (raw.mode_preferences as ModePreferences)
      : undefined;

  return {
    language,
    theme,
    daily_goal: goal,
    daily_goal_questions: goal,
    default_shuffle_questions:
      typeof raw.default_shuffle_questions === "boolean"
        ? raw.default_shuffle_questions
        : base.default_shuffle_questions,
    default_shuffle_options:
      typeof raw.default_shuffle_options === "boolean"
        ? raw.default_shuffle_options
        : base.default_shuffle_options,
    show_instant_feedback:
      typeof raw.show_instant_feedback === "boolean"
        ? raw.show_instant_feedback
        : base.show_instant_feedback,
    sound_effects:
      typeof raw.sound_effects === "boolean"
        ? raw.sound_effects
        : base.sound_effects,
    reduced_motion:
      typeof raw.reduced_motion === "boolean"
        ? raw.reduced_motion
        : base.reduced_motion,
    confidence_enabled: rawConfidence,
    mode_preferences: mergeModePrefs(base.mode_preferences, rawModePrefs),
  };
}

let cachedRawPrefs: string | null | undefined;
let cachedParsedPrefs: StudyHubPreferences = DEFAULT_USER_PREFERENCES;
const prefsListeners = new Set<() => void>();

function emitPrefsChange(): void {
  for (const listener of prefsListeners) {
    listener();
  }
}

/**
 * Purges module-level preference singletons and local storage preference keys.
 * Invoked during logout and account-switch cleanup to prevent cross-account bleed.
 */
export function resetLocalPreferencesCache(): void {
  cachedRawPrefs = undefined;
  cachedParsedPrefs = DEFAULT_USER_PREFERENCES;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
      window.localStorage.removeItem(SHORTCUTS_ENABLED_KEY);
    } catch {
      // Ignore private-mode storage errors
    }
  }
  emitPrefsChange();
}

function subscribeLocalPreferences(listener: () => void): () => void {
  prefsListeners.add(listener);
  const handleStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) {
      cachedRawPrefs = undefined;
      listener();
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", handleStorage);
  }
  return () => {
    prefsListeners.delete(listener);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", handleStorage);
    }
  };
}

function getLocalPreferencesSnapshot(): StudyHubPreferences {
  if (typeof window === "undefined") return DEFAULT_USER_PREFERENCES;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === cachedRawPrefs) {
      return cachedParsedPrefs;
    }
    cachedRawPrefs = raw;
    if (!raw) {
      cachedParsedPrefs = DEFAULT_USER_PREFERENCES;
      return cachedParsedPrefs;
    }
    const parsed = JSON.parse(raw) as Partial<StudyHubPreferences>;
    cachedParsedPrefs = normalizePreferences(parsed);
    return cachedParsedPrefs;
  } catch {
    return cachedParsedPrefs;
  }
}

function getServerPreferencesSnapshot(): StudyHubPreferences {
  return DEFAULT_USER_PREFERENCES;
}

function writeLocalPreferences(prefs: StudyHubPreferences): void {
  const serialized = JSON.stringify(prefs);
  cachedRawPrefs = serialized;
  cachedParsedPrefs = prefs;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, serialized);
    } catch {
      // Ignore storage quota or private-mode restrictions
    }
  }
  emitPrefsChange();
}

const emptySubscribe = () => () => {};

function playDeterministicTone(kind: FeedbackSoundKind): void {
  if (typeof window === "undefined") return;
  const AudioCtx =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!AudioCtx) return;

  try {
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    if (kind === "correct") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(523.25, now); // C5
      osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.08); // E5
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
      osc.start(now);
      osc.stop(now + 0.17);
    } else if (kind === "wrong") {
      osc.type = "triangle";
      osc.frequency.setValueAtTime(240, now);
      osc.frequency.linearRampToValueAtTime(190, now + 0.12);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      osc.start(now);
      osc.stop(now + 0.19);
    } else if (kind === "complete") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(523.25, now);
      osc.frequency.setValueAtTime(659.25, now + 0.08);
      osc.frequency.setValueAtTime(783.99, now + 0.16);
      gain.gain.setValueAtTime(0.06, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.start(now);
      osc.stop(now + 0.31);
    } else {
      // subtle card flip click
      osc.type = "sine";
      osc.frequency.setValueAtTime(380, now);
      gain.gain.setValueAtTime(0.03, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);
      osc.start(now);
      osc.stop(now + 0.07);
    }

    osc.onended = () => {
      void ctx.close().catch(() => {});
    };
  } catch {
    // Ignore autoplay/audio-device restrictions
  }
}

const PreferencesContext = React.createContext<PreferencesContextValue | null>(
  null,
);

export function hasStoredLocalPreferences(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return Boolean(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return false;
  }
}

export interface PreferencesProviderProps {
  children: React.ReactNode;
  /** Optional server/profile-hydrated preferences to avoid duplicate GET /api/preferences calls */
  initialPreferences?: UserPreferences | null;
  /** Skip automatic GET /api/preferences when parent already fetches `/api/profile` */
  deferRemoteFetch?: boolean;
}

export function PreferencesProvider({
  children,
  initialPreferences,
  deferRemoteFetch = false,
}: PreferencesProviderProps) {
  const pathname = usePathname() ?? "/";
  const queryClient = useQueryClient();
  const { setLocale } = useI18n();
  const { setTheme } = useTheme();

  const preferences = React.useSyncExternalStore(
    subscribeLocalPreferences,
    getLocalPreferencesSnapshot,
    getServerPreferencesSnapshot,
  );
  const hydratedLocal = React.useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
  const [isSaving, setIsSaving] = React.useState(false);

  // Monotonic mutation sequence guard & live ref to prevent stale closures / out-of-order overwrites
  const mutationSeqRef = React.useRef(0);
  const inFlightCountRef = React.useRef(0);
  const latestPrefsRef = React.useRef<StudyHubPreferences>(preferences);
  const lastSyncedServerSigRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    latestPrefsRef.current = preferences;
  }, [preferences]);

  const applyServerPreferences = React.useCallback(
    (serverPrefs: UserPreferences | null | undefined) => {
      if (!serverPrefs) return;
      const sig = JSON.stringify(serverPrefs);
      if (sig === lastSyncedServerSigRef.current) return;
      // Do not clobber optimistic local toggles if a user mutation is currently in flight
      if (inFlightCountRef.current > 0) return;

      lastSyncedServerSigRef.current = sig;
      const merged = normalizePreferences(serverPrefs, DEFAULT_USER_PREFERENCES);
      latestPrefsRef.current = merged;
      writeLocalPreferences(merged);

      // Sync persisted account language, theme & shortcut flag on fresh browser login
      setLocale(merged.language);
      setTheme(merged.theme);
      if (
        merged.mode_preferences?.shortcuts?.enabled !== undefined &&
        typeof window !== "undefined"
      ) {
        try {
          window.localStorage.setItem(
            SHORTCUTS_ENABLED_KEY,
            merged.mode_preferences.shortcuts.enabled ? "true" : "false",
          );
        } catch {
          // Ignore storage errors
        }
      }
    },
    [setLocale, setTheme],
  );

  React.useEffect(() => {
    applyServerPreferences(initialPreferences);
  }, [initialPreferences, applyServerPreferences]);

  const shouldFetchRemote =
    !deferRemoteFetch &&
    isSupabaseConfiguredClient() &&
    !PUBLIC_UNAUTH_PATHS.has(pathname);

  const remoteQuery = useQuery<UserPreferences | null>({
    queryKey: ["user-preferences"],
    enabled: shouldFetchRemote,
    initialData: initialPreferences ?? undefined,
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      try {
        const res = await apiFetch<UserPreferences>("/api/preferences");
        if (res.data) {
          applyServerPreferences(res.data);
        }
        return res.data;
      } catch (err) {
        if (
          err instanceof ApiError &&
          (err.status === 401 ||
            err.status === 403 ||
            err.status === 503 ||
            err.code === "SUPABASE_NOT_CONFIGURED")
        ) {
          return null;
        }
        return null;
      }
    },
  });

  // Apply reduced_motion & accessibility attributes onto <html> so CSS respects Settings toggles
  React.useEffect(() => {
    if (typeof document === "undefined") return;
    const reduce =
      preferences.reduced_motion ||
      Boolean(preferences.mode_preferences?.accessibility?.reduce_motion_override);
    if (reduce) {
      document.documentElement.dataset.reducedMotion = "true";
    } else {
      delete document.documentElement.dataset.reducedMotion;
    }

    if (preferences.mode_preferences?.accessibility?.high_contrast_focus) {
      document.documentElement.dataset.highContrastFocus = "true";
    } else {
      delete document.documentElement.dataset.highContrastFocus;
    }

    if (preferences.mode_preferences?.accessibility?.large_reading_text) {
      document.documentElement.dataset.largeText = "true";
    } else {
      delete document.documentElement.dataset.largeText;
    }
  }, [
    preferences.reduced_motion,
    preferences.mode_preferences?.accessibility?.reduce_motion_override,
    preferences.mode_preferences?.accessibility?.high_contrast_focus,
    preferences.mode_preferences?.accessibility?.large_reading_text,
  ]);

  const updatePreferences = React.useCallback(
    async (
      patch: UpdateUserPreferencesInput,
      options?: UpdatePreferencesOptions,
    ): Promise<StudyHubPreferences> => {
      // Read live synchronous snapshot rather than stale React render closure
      const currentBase =
        typeof window !== "undefined"
          ? getLocalPreferencesSnapshot()
          : latestPrefsRef.current;
      const next = normalizePreferences(patch, currentBase);
      latestPrefsRef.current = next;
      writeLocalPreferences(next);

      if (patch.language) {
        setLocale(patch.language);
      }
      if (patch.theme) {
        setTheme(patch.theme);
      }
      if (
        patch.mode_preferences?.shortcuts?.enabled !== undefined &&
        typeof window !== "undefined"
      ) {
        try {
          window.localStorage.setItem(
            SHORTCUTS_ENABLED_KEY,
            patch.mode_preferences.shortcuts.enabled ? "true" : "false",
          );
        } catch {
          // Ignore storage errors
        }
      }

      const seq = ++mutationSeqRef.current;

      if (options?.persistRemote === false || !isSupabaseConfiguredClient()) {
        return next;
      }

      inFlightCountRef.current += 1;
      setIsSaving(true);
      try {
        const payload: Record<string, unknown> = {};
        if (patch.language !== undefined) payload.language = next.language;
        if (patch.theme !== undefined) payload.theme = next.theme;
        if (
          patch.daily_goal !== undefined ||
          patch.daily_goal_questions !== undefined
        ) {
          payload.daily_goal = next.daily_goal;
        }
        if (patch.default_shuffle_questions !== undefined) {
          payload.default_shuffle_questions = next.default_shuffle_questions;
        }
        if (patch.default_shuffle_options !== undefined) {
          payload.default_shuffle_options = next.default_shuffle_options;
        }
        if (patch.show_instant_feedback !== undefined) {
          payload.show_instant_feedback = next.show_instant_feedback;
        }
        if (patch.sound_effects !== undefined) {
          payload.sound_effects = next.sound_effects;
        }
        if (patch.reduced_motion !== undefined) {
          payload.reduced_motion = next.reduced_motion;
        }
        if (patch.confidence_enabled !== undefined) {
          payload.confidence_enabled = next.confidence_enabled;
        }
        if (patch.mode_preferences !== undefined) {
          payload.mode_preferences = patch.mode_preferences;
        }

        const res = await apiFetch<UserPreferences>("/api/preferences", {
          method: "PATCH",
          body: JSON.stringify(payload),
        });

        // Monotonic guard: ignore stale server response if a newer toggle already ran
        if (seq !== mutationSeqRef.current) {
          return latestPrefsRef.current;
        }

        const synced = normalizePreferences(res.data, next);
        lastSyncedServerSigRef.current = res.data ? JSON.stringify(res.data) : null;
        latestPrefsRef.current = synced;
        writeLocalPreferences(synced);
        queryClient.setQueryData(["user-preferences"], res.data);
        queryClient.setQueryData(
          ["current-profile"],
          (prev: unknown) => {
            if (prev && typeof prev === "object" && "profile" in prev) {
              return {
                ...(prev as Record<string, unknown>),
                preferences: res.data,
              };
            }
            return prev;
          },
        );
        return synced;
      } catch (err) {
        if (options?.throwOnError) {
          throw err;
        }
        return latestPrefsRef.current;
      } finally {
        inFlightCountRef.current = Math.max(0, inFlightCountRef.current - 1);
        setIsSaving(inFlightCountRef.current > 0);
      }
    },
    [queryClient, setLocale, setTheme],
  );

  const refreshPreferences = React.useCallback(async () => {
    if (!isSupabaseConfiguredClient()) return;
    if (deferRemoteFetch) {
      await queryClient.refetchQueries({ queryKey: ["user-preferences"] });
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["user-preferences"] });
  }, [deferRemoteFetch, queryClient]);

  const playFeedbackSound = React.useCallback(
    (kind: FeedbackSoundKind, options?: PlayFeedbackSoundOptions) => {
      if (!options?.force && !latestPrefsRef.current.sound_effects) return;
      playDeterministicTone(kind);
    },
    [],
  );

  const value = React.useMemo<PreferencesContextValue>(
    () => ({
      preferences,
      isLoading: !hydratedLocal || (shouldFetchRemote && remoteQuery.isLoading),
      isSaving,
      isServerSynced: Boolean(initialPreferences ?? remoteQuery.data),
      updatePreferences,
      refreshPreferences,
      playFeedbackSound,
    }),
    [
      preferences,
      hydratedLocal,
      shouldFetchRemote,
      remoteQuery.isLoading,
      remoteQuery.data,
      initialPreferences,
      isSaving,
      updatePreferences,
      refreshPreferences,
      playFeedbackSound,
    ],
  );

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}

const FALLBACK_CONTEXT_VALUE: PreferencesContextValue = {
  preferences: DEFAULT_USER_PREFERENCES,
  isLoading: false,
  isSaving: false,
  isServerSynced: false,
  updatePreferences: async (patch) =>
    normalizePreferences(patch, DEFAULT_USER_PREFERENCES),
  refreshPreferences: async () => {},
  playFeedbackSound: () => {},
};

export function useUserPreferences(): PreferencesContextValue {
  const ctx = React.useContext(PreferencesContext);
  return ctx ?? FALLBACK_CONTEXT_VALUE;
}
