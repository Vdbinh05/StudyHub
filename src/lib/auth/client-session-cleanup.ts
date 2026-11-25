"use client";

import type { QueryClient } from "@tanstack/react-query";
import { resetLocalPreferencesCache } from "@/lib/preferences";

export const AUTH_BROADCAST_CHANNEL = "studyhub-auth";
export const AUTH_EVENT_STORAGE_KEY = "studyhub-auth-event";
export const ACTIVE_USER_POINTER_KEY = "studyhub-offline-active-user";

const USER_SCOPED_LOCAL_PREFIXES = [
  "studyhub-v3-checkpoint:",
  "studyhub-exam-draft-v2-",
  "studyhub-exam-draft-v3:",
] as const;

const USER_SCOPED_LOCAL_EXACT_KEYS = [
  "studyhub-user-preferences",
  "studyhub-shortcuts-enabled",
  "studyhub-sidebar-collapsed",
  "studyhub-offline-known-users",
  ACTIVE_USER_POINTER_KEY,
] as const;

const USER_SCOPED_SESSION_PREFIXES = ["studyhub-offline-"] as const;

export type AuthBroadcastEventType = "logout" | "account-switch";

export interface AuthBroadcastEvent {
  type: AuthBroadcastEventType;
  userId: string | null;
  timestamp: number;
  senderId: string;
}

export interface PurgeUserClientStateOptions {
  /**
   * Broadcast auth state change to peer browser tabs.
   * Defaults to `"logout"`. Pass `false` when handling an incoming broadcast
   * from another tab to prevent broadcast echo loops.
   */
  broadcast?: AuthBroadcastEventType | false;
  /** Optional target userId to advertise in the broadcast event (e.g. new userId on account-switch). */
  broadcastUserId?: string | null;
}

let cachedSenderId: string | null = null;

function getTabSenderId(): string {
  if (cachedSenderId) return cachedSenderId;
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    cachedSenderId = crypto.randomUUID();
  } else {
    cachedSenderId = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
  return cachedSenderId;
}

function isValidAuthBroadcastEvent(raw: unknown): raw is AuthBroadcastEvent {
  if (!raw || typeof raw !== "object") return false;
  const rec = raw as Record<string, unknown>;
  return (
    (rec.type === "logout" || rec.type === "account-switch") &&
    (rec.userId === null || typeof rec.userId === "string") &&
    typeof rec.timestamp === "number" &&
    typeof rec.senderId === "string"
  );
}

/**
 * Broadcasts an authentication boundary event (`logout` or `account-switch`) to
 * all sibling tabs via `BroadcastChannel("studyhub-auth")` AND `localStorage`
 * `storage` event fallback.
 */
export function broadcastAuthEvent(
  type: AuthBroadcastEventType,
  userId: string | null = null,
): void {
  if (typeof window === "undefined") return;

  const payload: AuthBroadcastEvent = {
    type,
    userId,
    timestamp: Date.now(),
    senderId: getTabSenderId(),
  };

  if (typeof BroadcastChannel !== "undefined") {
    try {
      const channel = new BroadcastChannel(AUTH_BROADCAST_CHANNEL);
      channel.postMessage(payload);
      channel.close();
    } catch {
      // Fall through to storage fallback
    }
  }

  try {
    window.localStorage.setItem(AUTH_EVENT_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore storage quota or private-mode restrictions
  }
}

/**
 * Subscribes to cross-tab `logout` and `account-switch` events via both
 * `BroadcastChannel("studyhub-auth")` and `window.addEventListener("storage")`.
 * Deduplicates events emitted by the current tab via `senderId`.
 */
export function subscribeAuthBroadcastEvents(
  onEvent: (event: AuthBroadcastEvent) => void,
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const selfId = getTabSenderId();
  let lastSeenSig = "";

  const dispatch = (evt: AuthBroadcastEvent) => {
    if (evt.senderId === selfId) return;
    const sig = `${evt.senderId}:${evt.timestamp}:${evt.type}:${evt.userId ?? ""}`;
    if (sig === lastSeenSig) return;
    lastSeenSig = sig;
    onEvent(evt);
  };

  let channel: BroadcastChannel | null = null;
  if (typeof BroadcastChannel !== "undefined") {
    try {
      channel = new BroadcastChannel(AUTH_BROADCAST_CHANNEL);
      channel.onmessage = (messageEvent: MessageEvent<unknown>) => {
        if (isValidAuthBroadcastEvent(messageEvent.data)) {
          dispatch(messageEvent.data);
        }
      };
    } catch {
      channel = null;
    }
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key === AUTH_EVENT_STORAGE_KEY && event.newValue) {
      try {
        const parsed = JSON.parse(event.newValue) as unknown;
        if (isValidAuthBroadcastEvent(parsed)) {
          dispatch(parsed);
        }
      } catch {
        // Ignore malformed payloads
      }
      return;
    }

    if (event.key === ACTIVE_USER_POINTER_KEY) {
      const nextUser =
        event.newValue && event.newValue.trim().length > 0
          ? event.newValue.trim()
          : null;
      const prevUser =
        event.oldValue && event.oldValue.trim().length > 0
          ? event.oldValue.trim()
          : null;
      if (prevUser && nextUser === null) {
        dispatch({
          type: "logout",
          userId: prevUser,
          timestamp: Date.now(),
          senderId: "storage-pointer",
        });
      } else if (nextUser && nextUser !== prevUser) {
        dispatch({
          type: "account-switch",
          userId: nextUser,
          timestamp: Date.now(),
          senderId: "storage-pointer",
        });
      }
    }
  };

  window.addEventListener("storage", handleStorage);

  return () => {
    window.removeEventListener("storage", handleStorage);
    if (channel) {
      try {
        channel.close();
      } catch {
        // Ignore close errors
      }
    }
  };
}

/**
 * Deterministically purges ALL user-scoped client state:
 * - Cancels in-flight React Query fetches & clears the cache
 * - Deletes localStorage learning checkpoints (`studyhub-v3-checkpoint:*`),
 *   legacy/partitioned exam drafts (`studyhub-exam-draft-v2-*`, `studyhub-exam-draft-v3:*`),
 *   unpartitioned preference/shortcut/sidebar keys, and the offline active-user pointer
 * - Clears offline sessionStorage pointers
 * - Resets in-memory preferences singletons (`resetLocalPreferencesCache()`)
 * - Broadcasts the auth boundary event to sibling tabs (unless `broadcast: false`)
 */
export async function purgeAllUserClientState(
  queryClient?: QueryClient | null,
  userId?: string | null,
  options?: PurgeUserClientStateOptions,
): Promise<void> {
  if (queryClient) {
    await queryClient.cancelQueries();
    queryClient.clear();
  }

  if (typeof window !== "undefined") {
    try {
      const keysToRemove = new Set<string>(USER_SCOPED_LOCAL_EXACT_KEYS);
      for (let i = 0; i < window.localStorage.length; i += 1) {
        const key = window.localStorage.key(i);
        if (!key) continue;
        if (USER_SCOPED_LOCAL_PREFIXES.some((prefix) => key.startsWith(prefix))) {
          keysToRemove.add(key);
        }
      }
      for (const key of keysToRemove) {
        window.localStorage.removeItem(key);
      }
    } catch {
      // Ignore private-mode / SecurityError storage failures
    }

    try {
      const sessionKeysToRemove: string[] = [];
      for (let i = 0; i < window.sessionStorage.length; i += 1) {
        const key = window.sessionStorage.key(i);
        if (!key) continue;
        if (
          USER_SCOPED_SESSION_PREFIXES.some((prefix) => key.startsWith(prefix))
        ) {
          sessionKeysToRemove.push(key);
        }
      }
      for (const key of sessionKeysToRemove) {
        window.sessionStorage.removeItem(key);
      }
    } catch {
      // Ignore sessionStorage restrictions
    }
  }

  resetLocalPreferencesCache();

  if (options?.broadcast !== false) {
    const eventType: AuthBroadcastEventType = options?.broadcast ?? "logout";
    const broadcastId =
      options?.broadcastUserId !== undefined
        ? options.broadcastUserId
        : (userId ?? null);
    broadcastAuthEvent(eventType, broadcastId);
  }
}
