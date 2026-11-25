import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveLocalizedTitle } from "@/app/providers";
import { mapLoginAuthError } from "@/components/auth/login-form";
import {
  ACTIVE_USER_POINTER_KEY,
  AUTH_BROADCAST_CHANNEL,
  AUTH_EVENT_STORAGE_KEY,
  broadcastAuthEvent,
  purgeAllUserClientState,
  subscribeAuthBroadcastEvents,
  type AuthBroadcastEvent,
} from "@/lib/auth/client-session-cleanup";
import {
  hasStoredLocalPreferences,
  resetLocalPreferencesCache,
} from "@/lib/preferences";
import {
  invalidateExamCaches,
  invalidateLearningCaches,
  invalidateStudySetCaches,
} from "@/lib/query-keys";

describe("StudyHub V3.2 — Client Cache Isolation & Session Cleanup (V32-001 / V32-013)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
    resetLocalPreferencesCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("purges React Query, user-scoped localStorage/sessionStorage keys, and module preference caches", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["dashboard"], { totalSets: 5 });
    queryClient.setQueryData(["study-sets"], [{ id: "set-a" }]);
    queryClient.setQueryData(["current-profile"], {
      profile: { id: "user-a", display_name: "Alice" },
    });

    const cancelSpy = vi.spyOn(queryClient, "cancelQueries");
    const clearSpy = vi.spyOn(queryClient, "clear");

    // Seed all user-scoped persistence layers
    window.localStorage.setItem(
      "studyhub-v3-checkpoint:user-a:practice:set-1:default",
      JSON.stringify({ currentIndex: 12 }),
    );
    window.localStorage.setItem(
      "studyhub-exam-draft-v2-attempt-1",
      JSON.stringify({ answers: { q1: ["opt-1"] } }),
    );
    window.localStorage.setItem(
      "studyhub-exam-draft-v3:user-a:attempt-2",
      JSON.stringify({ currentQuestionIndex: 199 }),
    );
    window.localStorage.setItem(
      "studyhub-user-preferences",
      JSON.stringify({ language: "en", theme: "dark", sound_effects: true }),
    );
    window.localStorage.setItem("studyhub-shortcuts-enabled", "false");
    window.localStorage.setItem("studyhub-sidebar-collapsed", "true");
    window.localStorage.setItem(ACTIVE_USER_POINTER_KEY, "user-a");
    window.localStorage.setItem("unrelated-app-key", "keep-me");
    window.sessionStorage.setItem("studyhub-offline-active-session", "set-1");
    window.sessionStorage.setItem("other-session-key", "keep-session");

    expect(hasStoredLocalPreferences()).toBe(true);

    await purgeAllUserClientState(queryClient, "user-a", { broadcast: false });

    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(clearSpy).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(["dashboard"])).toBeUndefined();
    expect(queryClient.getQueryData(["study-sets"])).toBeUndefined();
    expect(queryClient.getQueryData(["current-profile"])).toBeUndefined();

    expect(
      window.localStorage.getItem(
        "studyhub-v3-checkpoint:user-a:practice:set-1:default",
      ),
    ).toBeNull();
    expect(
      window.localStorage.getItem("studyhub-exam-draft-v2-attempt-1"),
    ).toBeNull();
    expect(
      window.localStorage.getItem("studyhub-exam-draft-v3:user-a:attempt-2"),
    ).toBeNull();
    expect(window.localStorage.getItem("studyhub-user-preferences")).toBeNull();
    expect(window.localStorage.getItem("studyhub-shortcuts-enabled")).toBeNull();
    expect(window.localStorage.getItem("studyhub-sidebar-collapsed")).toBeNull();
    expect(window.localStorage.getItem(ACTIVE_USER_POINTER_KEY)).toBeNull();
    expect(window.localStorage.getItem("unrelated-app-key")).toBe("keep-me");
    expect(
      window.sessionStorage.getItem("studyhub-offline-active-session"),
    ).toBeNull();
    expect(window.sessionStorage.getItem("other-session-key")).toBe(
      "keep-session",
    );
    expect(hasStoredLocalPreferences()).toBe(false);
  });

  it("broadcasts auth events via BroadcastChannel and storage fallback, and notifies peer tabs cleanly", () => {
    const received: AuthBroadcastEvent[] = [];
    const unsubscribe = subscribeAuthBroadcastEvents((evt) => {
      received.push(evt);
    });

    // Simulate a sibling tab broadcasting logout via StorageEvent
    const foreignLogout: AuthBroadcastEvent = {
      type: "logout",
      userId: "user-a",
      timestamp: Date.now(),
      senderId: "peer-tab-2",
    };
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: AUTH_EVENT_STORAGE_KEY,
        newValue: JSON.stringify(foreignLogout),
      }),
    );

    expect(received).toHaveLength(1);
    expect(received[0]?.type).toBe("logout");
    expect(received[0]?.userId).toBe("user-a");

    // Simulate active user pointer switching to user-b in another tab
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: ACTIVE_USER_POINTER_KEY,
        oldValue: "user-a",
        newValue: "user-b",
      }),
    );

    expect(received).toHaveLength(2);
    expect(received[1]?.type).toBe("account-switch");
    expect(received[1]?.userId).toBe("user-b");

    // Same-tab broadcast writes storage fallback but does NOT echo back into same-tab subscriber
    const postedChannels: Array<{ name: string; message: unknown }> = [];
    const OriginalBC = globalThis.BroadcastChannel;
    class MockBroadcastChannel {
      name: string;
      onmessage: ((event: MessageEvent) => void) | null = null;
      constructor(name: string) {
        this.name = name;
      }
      postMessage(message: unknown) {
        postedChannels.push({ name: this.name, message });
      }
      close() {}
    }
    vi.stubGlobal("BroadcastChannel", MockBroadcastChannel);
    try {
      broadcastAuthEvent("account-switch", "user-c");
      expect(postedChannels).toHaveLength(1);
      expect(postedChannels[0]?.name).toBe(AUTH_BROADCAST_CHANNEL);
      expect(
        JSON.parse(window.localStorage.getItem(AUTH_EVENT_STORAGE_KEY) ?? "{}"),
      ).toMatchObject({ type: "account-switch", userId: "user-c" });
      // Did not re-trigger same-tab listener
      expect(received).toHaveLength(2);
    } finally {
      vi.stubGlobal("BroadcastChannel", OriginalBC);
      unsubscribe();
    }
  });
});

describe("StudyHub V3.2 — Centralized React Query Invalidation Helpers (src/lib/query-keys.ts)", () => {
  it("invalidateStudySetCaches marks all study-set related keys stale without touching sibling sets", async () => {
    const qc = new QueryClient();
    const keysToInvalidate = [
      ["study-set", "set-1"],
      ["set-questions", "set-1", 1, "", "all", false],
      ["editor-questions", "set-1", 1],
      ["study-set-bundle", "set-1", 1000],
      ["study-sets", "", "all", "updated_desc", false, false, 1],
      ["dashboard"],
    ];
    for (const key of keysToInvalidate) {
      qc.setQueryData(key, { ok: true });
    }
    qc.setQueryData(["study-set", "set-2"], { ok: true });

    await invalidateStudySetCaches(qc, "set-1");

    for (const key of keysToInvalidate) {
      expect(qc.getQueryState(key)?.isInvalidated).toBe(true);
    }
    expect(qc.getQueryState(["study-set", "set-2"])?.isInvalidated).toBe(false);
  });

  it("invalidateLearningCaches invalidates checkpoints, mistakes, starred, dashboard, and scoped set keys", async () => {
    const qc = new QueryClient();
    const keys = [
      ["set-checkpoints", "set-1"],
      ["checkpoints"],
      ["progress"],
      ["review-mistakes-v3", "all"],
      ["starred-questions", "all"],
      ["dashboard"],
      ["study-set", "set-1"],
      ["study-set-bundle", "set-1", 1000],
    ];
    for (const key of keys) {
      qc.setQueryData(key, { ok: true });
    }

    await invalidateLearningCaches(qc, "set-1");

    for (const key of keys) {
      expect(qc.getQueryState(key)?.isInvalidated).toBe(true);
    }
  });

  it("invalidateExamCaches invalidates exam attempt, live attempt, dashboard, history, coverage, mistakes, and statistics", async () => {
    const qc = new QueryClient();
    const keys = [
      ["exam-attempt", "att-1"],
      ["exam-attempt-live", "att-1"],
      ["exam-result", "att-1"],
      ["dashboard"],
      ["history-exams"],
      ["coverage-cycles", "active"],
      ["review-mistakes-v3", "all"],
      ["statistics", 30],
    ];
    for (const key of keys) {
      qc.setQueryData(key, { ok: true });
    }
    qc.setQueryData(["exam-attempt", "att-other"], { ok: true });

    await invalidateExamCaches(qc, "att-1");

    for (const key of keys) {
      expect(qc.getQueryState(key)?.isInvalidated).toBe(true);
    }
    expect(qc.getQueryState(["exam-attempt", "att-other"])?.isInvalidated).toBe(
      false,
    );
  });
});

describe("StudyHub V3.2 — Login Error Localization & Route Titles (V32-040)", () => {
  it("localizes common Supabase Auth and network errors in both vi and en", () => {
    expect(
      mapLoginAuthError({ message: "Invalid login credentials" }, "vi"),
    ).toContain("Email hoặc mật khẩu không chính xác");
    expect(
      mapLoginAuthError({ message: "Email not confirmed" }, "vi"),
    ).toContain("chưa được xác nhận");
    expect(
      mapLoginAuthError({ message: "Too many requests", status: 429 }, "vi"),
    ).toContain("quá nhanh");
    expect(
      mapLoginAuthError(new TypeError("Failed to fetch"), "vi"),
    ).toContain("Không thể kết nối");

    expect(
      mapLoginAuthError({ message: "Email not confirmed" }, "en"),
    ).toContain("not been confirmed");
    expect(
      mapLoginAuthError({ message: "Too many requests", status: 429 }, "en"),
    ).toContain("Too many");
    expect(
      mapLoginAuthError(new TypeError("Failed to fetch"), "en"),
    ).toContain("Unable to reach the server");
  });

  it("resolves localized English and Vietnamese document titles for /sets/[id] and /folders/[id]", () => {
    expect(
      resolveLocalizedTitle(
        "/sets/550e8400-e29b-41d4-a716-446655440000",
        "en",
      ),
    ).toBe("Study Set | StudyHub");
    expect(
      resolveLocalizedTitle(
        "/sets/550e8400-e29b-41d4-a716-446655440000",
        "vi",
      ),
    ).toBe("Chi tiết học phần | StudyHub");
    expect(resolveLocalizedTitle("/folders/folder-123", "en")).toBe(
      "Folder | StudyHub",
    );
    expect(resolveLocalizedTitle("/folders/folder-123", "vi")).toBe(
      "Thư mục học phần | StudyHub",
    );
    expect(resolveLocalizedTitle("/sets/new", "en")).toBe(
      "Create study set | StudyHub",
    );
  });
});

describe("StudyHub V3.2 — Architecture Security & Cache Contract Guards", () => {
  const root = process.cwd();

  it("fetches server-verified user via auth.getUser() in (app)/layout.tsx and never trusts storedUserId in AuthenticatedProviders", () => {
    const layoutSrc = readFileSync(
      resolve(root, "src/app/(app)/layout.tsx"),
      "utf8",
    );
    expect(layoutSrc).toContain("supabase.auth.getUser()");
    expect(layoutSrc).not.toContain("getSession(");
    expect(layoutSrc).toContain("initialUserId={initialUserId}");

    const providersSrc = readFileSync(
      resolve(root, "src/app/(app)/authenticated-providers.tsx"),
      "utf8",
    );
    expect(providersSrc).toContain("subscribeAuthBroadcastEvents");
    expect(providersSrc).toContain("purgeAllUserClientState");
    expect(providersSrc).not.toMatch(/:\s*storedUserId\s*;/);
  });

  it("enforces server sign-out verification before offline wipe in app-shell.tsx and preserves SW no-cache headers", () => {
    const shellSrc = readFileSync(
      resolve(root, "src/components/layout/app-shell.tsx"),
      "utf8",
    );
    const signoutIdx = shellSrc.indexOf('fetch("/auth/signout"');
    const clearOfflineIdx = shellSrc.indexOf("clearOfflineDataForLogout(");
    const purgeIdx = shellSrc.indexOf("purgeAllUserClientState(");
    expect(signoutIdx).toBeGreaterThan(-1);
    expect(clearOfflineIdx).toBeGreaterThan(signoutIdx);
    expect(purgeIdx).toBeGreaterThan(clearOfflineIdx);
    expect(shellSrc).toContain("if (!response.ok)");

    const nextConfigSrc = readFileSync(resolve(root, "next.config.ts"), "utf8");
    expect(nextConfigSrc).toContain(
      'value: "no-cache, no-store, must-revalidate"',
    );
    expect(nextConfigSrc).toContain('source: "/brand/:path*"');
    expect(nextConfigSrc).toContain('source: "/icons/:path*"');
    expect(nextConfigSrc).toContain(
      "public, max-age=86400, stale-while-revalidate=604800",
    );
  });
});
