/**
 * StudyHub V3.0 — Account-Partitioned IndexedDB Offline Database (`idb`).
 *
 * Privacy & Isolation Guarantees:
 * - Every account gets a dedicated IndexedDB database: `studyhub-offline-v3:${userId}`.
 * - Every read and write additionally enforces `record.user_id === userId`.
 * - Switching accounts closes previous handles cleanly so Account B NEVER sees Account A's data.
 * - `clearUserOfflineData(userId)` permanently wipes that account's offline DB on logout or user action.
 */

import { deleteDB, openDB, type DBSchema, type IDBPDatabase } from "idb";
import {
  OfflineStorageError,
  type OfflineDiagramRecord,
  type OfflineDownloadedSetRecord,
  type OfflineLocalCheckpointRecord,
  type OfflineLocalNoteRecord,
  type OfflineMediaBlobRecord,
  type OfflineQuestionRecord,
  type OfflineSyncMetaRecord,
  type OfflineSyncQueueRecord,
  type StorageEstimateInfo,
} from "./types";

export { OfflineStorageError };

export const OFFLINE_DB_PREFIX = "studyhub-offline-v3:";
export const OFFLINE_DB_VERSION = 1;
const KNOWN_USERS_STORAGE_KEY = "studyhub-offline-known-users";
const DELETE_DB_TIMEOUT_MS = 1_500;
const CLOSE_DB_TIMEOUT_MS = 1_500;

export interface StudyHubOfflineSchema extends DBSchema {
  downloaded_sets: {
    key: string;
    value: OfflineDownloadedSetRecord;
    indexes: {
      by_downloaded_at: string;
      by_status: string;
    };
  };
  questions: {
    key: string;
    value: OfflineQuestionRecord;
    indexes: {
      by_set: string;
      by_set_position: [string, number];
    };
  };
  diagrams: {
    key: string;
    value: OfflineDiagramRecord;
    indexes: {
      by_set: string;
    };
  };
  media_blobs: {
    key: string;
    value: OfflineMediaBlobRecord;
    indexes: {
      by_set_ids: string;
      by_media_id: string;
    };
  };
  local_checkpoints: {
    key: string;
    value: OfflineLocalCheckpointRecord;
    indexes: {
      by_set: string;
      by_updated_at: string;
    };
  };
  sync_queue: {
    key: string;
    value: OfflineSyncQueueRecord;
    indexes: {
      by_created_at: string;
      by_set: string;
      by_status: string;
    };
  };
  notes_local: {
    key: string;
    value: OfflineLocalNoteRecord;
    indexes: {
      by_set: string;
    };
  };
  sync_meta: {
    key: string;
    value: OfflineSyncMetaRecord;
  };
}

const openConnections = new Map<string, Promise<IDBPDatabase<StudyHubOfflineSchema>>>();
const pendingClears = new Map<string, Promise<void>>();
let activeOfflineUserId: string | null = null;

function validateUserId(userId: string): string {
  const trimmed = typeof userId === "string" ? userId.trim() : "";
  if (!trimmed || trimmed.length > 128) {
    throw new OfflineStorageError(
      "INVALID_USER_PARTITION",
      "A valid authenticated userId is required for offline storage partitioning.",
    );
  }
  return trimmed;
}

function assertRecordPartition(userId: string, recordUserId: string): void {
  if (recordUserId !== userId) {
    throw new OfflineStorageError(
      "INVALID_USER_PARTITION",
      "Refused cross-account offline storage access.",
      { expectedUserId: userId },
    );
  }
}

export function getOfflineDbName(userId: string): string {
  const safeId = validateUserId(userId);
  return `${OFFLINE_DB_PREFIX}${safeId}`;
}

export function getActiveOfflineUserId(): string | null {
  return activeOfflineUserId;
}

export function setActiveOfflineUserId(userId: string | null): void {
  activeOfflineUserId = userId ? validateUserId(userId) : null;
}

function rememberKnownOfflineUser(userId: string): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(KNOWN_USERS_STORAGE_KEY);
    const list: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    if (!list.includes(userId)) {
      list.push(userId);
      window.localStorage.setItem(KNOWN_USERS_STORAGE_KEY, JSON.stringify(list));
    }
  } catch {
    // Ignore restricted localStorage environments
  }
}

function forgetKnownOfflineUser(userId: string): void {
  if (typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(KNOWN_USERS_STORAGE_KEY);
    if (!raw) return;
    const list = (JSON.parse(raw) as string[]).filter((id) => id !== userId);
    if (list.length === 0) {
      window.localStorage.removeItem(KNOWN_USERS_STORAGE_KEY);
    } else {
      window.localStorage.setItem(KNOWN_USERS_STORAGE_KEY, JSON.stringify(list));
    }
  } catch {
    // Ignore restricted localStorage environments
  }
}

export function listKnownOfflineUsers(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KNOWN_USERS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

export function isIndexedDbAvailable(): boolean {
  return typeof globalThis !== "undefined" && typeof globalThis.indexedDB !== "undefined";
}

export function normalizeOfflineStorageError(err: unknown): OfflineStorageError {
  if (err instanceof OfflineStorageError) {
    return err;
  }

  if (err && typeof err === "object") {
    const name = "name" in err ? String((err as { name?: unknown }).name ?? "") : "";
    const message =
      "message" in err ? String((err as { message?: unknown }).message ?? "") : "";
    const lower = `${name} ${message}`.toLowerCase();

    if (
      name === "QuotaExceededError" ||
      name === "NS_ERROR_DOM_QUOTA_REACHED" ||
      lower.includes("quota") ||
      lower.includes("disk full") ||
      lower.includes("storage limit")
    ) {
      return new OfflineStorageError(
        "QUOTA_EXCEEDED",
        "Local browser storage quota has been exceeded. Delete unused offline study sets to free space.",
      );
    }

    if (
      name === "SecurityError" ||
      name === "InvalidStateError" ||
      lower.includes("private browsing") ||
      lower.includes("securityerror") ||
      lower.includes("access to indexeddb")
    ) {
      return new OfflineStorageError(
        "PRIVATE_BROWSING",
        "Offline storage is restricted in this browser session (for example, Private Browsing mode).",
      );
    }

    if (name === "AbortError") {
      return new OfflineStorageError("ABORTED", "Offline storage operation was cancelled.");
    }

    return new OfflineStorageError(
      "UNKNOWN",
      message || "An unexpected offline storage error occurred.",
    );
  }

  return new OfflineStorageError(
    "UNKNOWN",
    typeof err === "string" ? err : "An unexpected offline storage error occurred.",
  );
}

export async function getStorageEstimate(): Promise<StorageEstimateInfo> {
  if (
    typeof navigator === "undefined" ||
    !navigator.storage ||
    typeof navigator.storage.estimate !== "function"
  ) {
    return {
      supported: false,
      usageBytes: 0,
      quotaBytes: 0,
      availableBytes: null,
      usagePercent: null,
    };
  }

  try {
    const estimate = await navigator.storage.estimate();
    const usageBytes = Math.max(0, Number(estimate.usage ?? 0));
    const quotaBytes = Math.max(0, Number(estimate.quota ?? 0));
    const availableBytes =
      quotaBytes > 0 ? Math.max(0, quotaBytes - usageBytes) : null;
    const usagePercent =
      quotaBytes > 0
        ? Math.min(100, Math.round((usageBytes / quotaBytes) * 1000) / 10)
        : null;

    return {
      supported: true,
      usageBytes,
      quotaBytes,
      availableBytes,
      usagePercent,
    };
  } catch {
    return {
      supported: false,
      usageBytes: 0,
      quotaBytes: 0,
      availableBytes: null,
      usagePercent: null,
    };
  }
}

export async function openOfflineDb(
  userId: string,
): Promise<IDBPDatabase<StudyHubOfflineSchema>> {
  const safeId = validateUserId(userId);
  if (!isIndexedDbAvailable()) {
    throw new OfflineStorageError(
      "IDB_UNAVAILABLE",
      "IndexedDB is not available in this environment.",
    );
  }

  const inFlightClear = pendingClears.get(safeId);
  if (inFlightClear) {
    await inFlightClear.catch(() => undefined);
  }

  const existing = openConnections.get(safeId);
  if (existing) {
    return existing;
  }

  const dbName = getOfflineDbName(safeId);
  let openedDb: IDBPDatabase<StudyHubOfflineSchema> | null = null;
  const promise = openDB<StudyHubOfflineSchema>(dbName, OFFLINE_DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("downloaded_sets")) {
        const store = db.createObjectStore("downloaded_sets", {
          keyPath: "set_id",
        });
        store.createIndex("by_downloaded_at", "downloaded_at");
        store.createIndex("by_status", "status");
      }

      if (!db.objectStoreNames.contains("questions")) {
        const store = db.createObjectStore("questions", {
          keyPath: "id",
        });
        store.createIndex("by_set", "study_set_id");
        store.createIndex("by_set_position", ["study_set_id", "position"]);
      }

      if (!db.objectStoreNames.contains("diagrams")) {
        const store = db.createObjectStore("diagrams", {
          keyPath: "id",
        });
        store.createIndex("by_set", "study_set_id");
      }

      if (!db.objectStoreNames.contains("media_blobs")) {
        const store = db.createObjectStore("media_blobs", {
          keyPath: "url",
        });
        store.createIndex("by_set_ids", "set_ids", { multiEntry: true });
        store.createIndex("by_media_id", "media_id");
      }

      if (!db.objectStoreNames.contains("local_checkpoints")) {
        const store = db.createObjectStore("local_checkpoints", {
          keyPath: "checkpoint_key",
        });
        store.createIndex("by_set", "study_set_id");
        store.createIndex("by_updated_at", "updated_at");
      }

      if (!db.objectStoreNames.contains("sync_queue")) {
        const store = db.createObjectStore("sync_queue", {
          keyPath: "event_id",
        });
        store.createIndex("by_created_at", "created_at");
        store.createIndex("by_set", "study_set_id");
        store.createIndex("by_status", "queue_status");
      }

      if (!db.objectStoreNames.contains("notes_local")) {
        const store = db.createObjectStore("notes_local", {
          keyPath: "question_id",
        });
        store.createIndex("by_set", "study_set_id");
      }

      if (!db.objectStoreNames.contains("sync_meta")) {
        db.createObjectStore("sync_meta", {
          keyPath: "key",
        });
      }
    },
    blocking(_currentVersion, _blockedVersion, event) {
      // Close stale handles immediately when another tab upgrades or deletes this user's DB
      openConnections.delete(safeId);
      if (activeOfflineUserId === safeId) {
        activeOfflineUserId = null;
      }
      try {
        openedDb?.close();
      } catch {
        // Ignore already closed db
      }
      try {
        const targetDb = event.target as IDBDatabase | null;
        targetDb?.close();
      } catch {
        // Ignore already closed db
      }
    },
    terminated() {
      openConnections.delete(safeId);
    },
  })
    .then((db) => {
      openedDb = db;
      return db;
    })
    .catch((err: unknown) => {
      openConnections.delete(safeId);
      throw normalizeOfflineStorageError(err);
    });

  openConnections.set(safeId, promise);
  activeOfflineUserId = safeId;
  rememberKnownOfflineUser(safeId);
  return promise;
}

export async function closeOfflineDb(
  userId: string,
  timeoutMs: number = CLOSE_DB_TIMEOUT_MS,
): Promise<void> {
  const safeId = validateUserId(userId);
  const existing = openConnections.get(safeId);
  openConnections.delete(safeId);
  if (activeOfflineUserId === safeId) {
    activeOfflineUserId = null;
  }
  if (!existing) {
    return;
  }

  let timerId: ReturnType<typeof setTimeout> | null = null;
  const closeTask = existing
    .then((db) => {
      db.close();
    })
    .catch(() => {
      // Ignore already closed/failed db
    });

  try {
    await Promise.race([
      closeTask,
      new Promise<void>((resolve) => {
        timerId = setTimeout(resolve, Math.max(0, timeoutMs));
      }),
    ]);
  } finally {
    if (timerId !== null) {
      clearTimeout(timerId);
    }
  }
}

export async function closeAllOfflineDbs(): Promise<void> {
  const entries = Array.from(openConnections.entries());
  openConnections.clear();
  activeOfflineUserId = null;
  await Promise.allSettled(
    entries.map(async ([, promise]) => {
      let timerId: ReturnType<typeof setTimeout> | null = null;
      const closeTask = promise
        .then((db) => {
          db.close();
        })
        .catch(() => undefined);
      try {
        await Promise.race([
          closeTask,
          new Promise<void>((resolve) => {
            timerId = setTimeout(resolve, CLOSE_DB_TIMEOUT_MS);
          }),
        ]);
      } finally {
        if (timerId !== null) {
          clearTimeout(timerId);
        }
      }
    }),
  );
}

/**
 * Safely switches offline storage partition from one account to another.
 * Closes the previous account's DB handle (bounded timeout) so Account B never shares connections or state with Account A.
 */
export async function switchOfflineUser(
  previousUserId: string | null | undefined,
  nextUserId: string | null | undefined,
): Promise<void> {
  if (previousUserId && previousUserId.trim()) {
    await closeOfflineDb(previousUserId, CLOSE_DB_TIMEOUT_MS);
  }
  if (nextUserId && nextUserId.trim()) {
    activeOfflineUserId = validateUserId(nextUserId);
  } else {
    activeOfflineUserId = null;
  }
}

const ALL_STORE_NAMES = [
  "downloaded_sets",
  "questions",
  "diagrams",
  "media_blobs",
  "local_checkpoints",
  "sync_queue",
  "notes_local",
  "sync_meta",
] as const;

/**
 * Permanently clears all offline data for a specific user (call on logout or explicit Clear Local Data).
 * Atomically empties all 8 object stores first (preventing stale data reads even if another tab
 * delays `deleteDB`), closes the connection, and deletes the user-partitioned database with a
 * bounded timeout fallback so multi-tab sign-out never stalls indefinitely.
 */
export async function clearUserOfflineData(
  userId: string,
  options: { deleteTimeoutMs?: number } = {},
): Promise<void> {
  const safeId = validateUserId(userId);
  const existingClear = pendingClears.get(safeId);
  if (existingClear) {
    return existingClear;
  }

  const deleteTimeoutMs =
    typeof options.deleteTimeoutMs === "number" && options.deleteTimeoutMs >= 0
      ? options.deleteTimeoutMs
      : DELETE_DB_TIMEOUT_MS;

  const clearPromise = (async () => {
    const existingConn = openConnections.get(safeId);
    if (existingConn) {
      try {
        const db = await existingConn;
        const presentStores = ALL_STORE_NAMES.filter((name) =>
          db.objectStoreNames.contains(name),
        );
        if (presentStores.length > 0) {
          const tx = db.transaction(presentStores, "readwrite");
          for (const storeName of presentStores) {
            await tx.objectStore(storeName).clear();
          }
          await tx.done;
        }
      } catch {
        // Proceed with closing & deleting DB
      }
    }

    await closeOfflineDb(safeId, deleteTimeoutMs);
    forgetKnownOfflineUser(safeId);

    if (!isIndexedDbAvailable()) {
      return;
    }

    let timerId: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    const deleteTask = deleteDB(getOfflineDbName(safeId), {
      blocked() {
        // Another tab still holds a handle; bounded timeout below prevents sign-out stall
      },
    });

    try {
      await Promise.race([
        deleteTask.finally(() => {
          settled = true;
        }),
        new Promise<void>((resolve) => {
          timerId = setTimeout(() => {
            if (!settled) {
              deleteTask.catch(() => undefined);
            }
            resolve();
          }, deleteTimeoutMs);
        }),
      ]);
    } catch (err) {
      throw normalizeOfflineStorageError(err);
    } finally {
      if (timerId !== null) {
        clearTimeout(timerId);
      }
    }
  })().finally(() => {
    pendingClears.delete(safeId);
  });

  pendingClears.set(safeId, clearPromise);
  return clearPromise;
}

// ============================================================================
// Downloaded Sets Store
// ============================================================================

export async function putDownloadedSet(
  userId: string,
  record: OfflineDownloadedSetRecord,
): Promise<void> {
  const safeId = validateUserId(userId);
  assertRecordPartition(safeId, record.user_id);
  try {
    const db = await openOfflineDb(safeId);
    await db.put("downloaded_sets", record);
  } catch (err) {
    throw normalizeOfflineStorageError(err);
  }
}

export async function getDownloadedSet(
  userId: string,
  setId: string,
): Promise<OfflineDownloadedSetRecord | null> {
  const safeId = validateUserId(userId);
  const db = await openOfflineDb(safeId);
  const rec = await db.get("downloaded_sets", setId);
  if (!rec) return null;
  assertRecordPartition(safeId, rec.user_id);
  return rec;
}

export async function getAllDownloadedSets(
  userId: string,
): Promise<OfflineDownloadedSetRecord[]> {
  const safeId = validateUserId(userId);
  const db = await openOfflineDb(safeId);
  const all = await db.getAll("downloaded_sets");
  return all
    .filter((rec) => rec.user_id === safeId)
    .sort((a, b) => b.downloaded_at.localeCompare(a.downloaded_at));
}

// ============================================================================
// Questions Store
// ============================================================================

export async function putQuestionsForSet(
  userId: string,
  setId: string,
  questions: readonly OfflineQuestionRecord[],
  replaceExisting: boolean = true,
): Promise<void> {
  const safeId = validateUserId(userId);
  for (const q of questions) {
    assertRecordPartition(safeId, q.user_id);
  }
  try {
    const db = await openOfflineDb(safeId);
    const tx = db.transaction("questions", "readwrite");
    if (replaceExisting) {
      const existingKeys = await tx.store.index("by_set").getAllKeys(setId);
      for (const key of existingKeys) {
        await tx.store.delete(key);
      }
    }
    for (const q of questions) {
      await tx.store.put(q);
    }
    await tx.done;
  } catch (err) {
    throw normalizeOfflineStorageError(err);
  }
}

export async function putQuestion(
  userId: string,
  question: OfflineQuestionRecord,
): Promise<void> {
  const safeId = validateUserId(userId);
  assertRecordPartition(safeId, question.user_id);
  try {
    const db = await openOfflineDb(safeId);
    await db.put("questions", question);
  } catch (err) {
    throw normalizeOfflineStorageError(err);
  }
}

export async function getQuestionById(
  userId: string,
  questionId: string,
): Promise<OfflineQuestionRecord | null> {
  const safeId = validateUserId(userId);
  const db = await openOfflineDb(safeId);
  const rec = await db.get("questions", questionId);
  if (!rec) return null;
  assertRecordPartition(safeId, rec.user_id);
  return rec;
}

export async function getQuestionsForSet(
  userId: string,
  setId: string,
): Promise<OfflineQuestionRecord[]> {
  const safeId = validateUserId(userId);
  const db = await openOfflineDb(safeId);
  const rows = await db.getAllFromIndex("questions", "by_set", setId);
  return rows
    .filter((q) => q.user_id === safeId)
    .sort((a, b) => a.position - b.position);
}

// ============================================================================
// Diagrams Store
// ============================================================================

export async function putDiagramsForSet(
  userId: string,
  setId: string,
  diagrams: readonly OfflineDiagramRecord[],
  replaceExisting: boolean = true,
): Promise<void> {
  const safeId = validateUserId(userId);
  for (const d of diagrams) {
    assertRecordPartition(safeId, d.user_id);
  }
  try {
    const db = await openOfflineDb(safeId);
    const tx = db.transaction("diagrams", "readwrite");
    if (replaceExisting) {
      const existingKeys = await tx.store.index("by_set").getAllKeys(setId);
      for (const key of existingKeys) {
        await tx.store.delete(key);
      }
    }
    for (const d of diagrams) {
      await tx.store.put(d);
    }
    await tx.done;
  } catch (err) {
    throw normalizeOfflineStorageError(err);
  }
}

export async function getDiagramsForSet(
  userId: string,
  setId: string,
): Promise<OfflineDiagramRecord[]> {
  const safeId = validateUserId(userId);
  const db = await openOfflineDb(safeId);
  const rows = await db.getAllFromIndex("diagrams", "by_set", setId);
  return rows.filter((d) => d.user_id === safeId);
}

// ============================================================================
// Media Blobs Store (Reference-Counted per Set)
// ============================================================================

export async function putMediaBlob(
  userId: string,
  record: OfflineMediaBlobRecord,
): Promise<void> {
  const safeId = validateUserId(userId);
  assertRecordPartition(safeId, record.user_id);
  try {
    const db = await openOfflineDb(safeId);
    const existing = await db.get("media_blobs", record.url);
    const mergedSetIds = Array.from(
      new Set([...(existing?.set_ids ?? []), ...record.set_ids]),
    );
    await db.put("media_blobs", {
      ...record,
      set_ids: mergedSetIds,
    });
  } catch (err) {
    throw normalizeOfflineStorageError(err);
  }
}

export async function getMediaBlob(
  userId: string,
  url: string,
): Promise<OfflineMediaBlobRecord | null> {
  const safeId = validateUserId(userId);
  const db = await openOfflineDb(safeId);
  const rec = await db.get("media_blobs", url);
  if (!rec) return null;
  assertRecordPartition(safeId, rec.user_id);
  return rec;
}

export async function getMediaBlobsForSet(
  userId: string,
  setId: string,
): Promise<OfflineMediaBlobRecord[]> {
  const safeId = validateUserId(userId);
  const db = await openOfflineDb(safeId);
  const rows = await db.getAllFromIndex("media_blobs", "by_set_ids", setId);
  return rows.filter((b) => b.user_id === safeId);
}

export async function deleteMediaBlobsForSet(
  userId: string,
  setId: string,
): Promise<number> {
  const safeId = validateUserId(userId);
  const db = await openOfflineDb(safeId);
  const tx = db.transaction("media_blobs", "readwrite");
  const rows = await tx.store.index("by_set_ids").getAll(setId);
  let deletedCount = 0;

  for (const row of rows) {
    if (row.user_id !== safeId) continue;
    const remainingSetIds = row.set_ids.filter((id) => id !== setId);
    if (remainingSetIds.length === 0) {
      await tx.store.delete(row.url);
      deletedCount += 1;
    } else {
      await tx.store.put({ ...row, set_ids: remainingSetIds });
    }
  }

  await tx.done;
  return deletedCount;
}

export async function deleteDownloadedSetRecords(
  userId: string,
  setId: string,
): Promise<void> {
  const safeId = validateUserId(userId);
  const db = await openOfflineDb(safeId);

  const tx = db.transaction(
    ["downloaded_sets", "questions", "diagrams", "local_checkpoints"],
    "readwrite",
  );
  await tx.objectStore("downloaded_sets").delete(setId);

  const qKeys = await tx.objectStore("questions").index("by_set").getAllKeys(setId);
  for (const key of qKeys) {
    await tx.objectStore("questions").delete(key);
  }

  const dKeys = await tx.objectStore("diagrams").index("by_set").getAllKeys(setId);
  for (const key of dKeys) {
    await tx.objectStore("diagrams").delete(key);
  }

  const cpKeys = await tx
    .objectStore("local_checkpoints")
    .index("by_set")
    .getAllKeys(setId);
  for (const key of cpKeys) {
    await tx.objectStore("local_checkpoints").delete(key);
  }

  await tx.done;
  await deleteMediaBlobsForSet(safeId, setId);
}

// ============================================================================
// Local Checkpoints Store
// ============================================================================

export async function putLocalCheckpoint(
  userId: string,
  record: OfflineLocalCheckpointRecord,
): Promise<void> {
  const safeId = validateUserId(userId);
  assertRecordPartition(safeId, record.user_id);
  try {
    const db = await openOfflineDb(safeId);
    await db.put("local_checkpoints", record);
  } catch (err) {
    throw normalizeOfflineStorageError(err);
  }
}

export async function getLocalCheckpoint(
  userId: string,
  checkpointKey: string,
): Promise<OfflineLocalCheckpointRecord | null> {
  const safeId = validateUserId(userId);
  const db = await openOfflineDb(safeId);
  const rec = await db.get("local_checkpoints", checkpointKey);
  if (!rec) return null;
  assertRecordPartition(safeId, rec.user_id);
  return rec;
}

export async function deleteLocalCheckpoint(
  userId: string,
  checkpointKey: string,
): Promise<void> {
  const safeId = validateUserId(userId);
  const db = await openOfflineDb(safeId);
  await db.delete("local_checkpoints", checkpointKey);
}

export async function listLocalCheckpoints(
  userId: string,
  setId?: string,
): Promise<OfflineLocalCheckpointRecord[]> {
  const safeId = validateUserId(userId);
  const db = await openOfflineDb(safeId);
  const rows = setId
    ? await db.getAllFromIndex("local_checkpoints", "by_set", setId)
    : await db.getAll("local_checkpoints");
  return rows
    .filter((cp) => cp.user_id === safeId)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
}

// ============================================================================
// Sync Queue Store
// ============================================================================

export async function putSyncQueueItem(
  userId: string,
  record: OfflineSyncQueueRecord,
): Promise<void> {
  const safeId = validateUserId(userId);
  assertRecordPartition(safeId, record.user_id);
  try {
    const db = await openOfflineDb(safeId);
    await db.put("sync_queue", record);
  } catch (err) {
    throw normalizeOfflineStorageError(err);
  }
}

export async function deleteSyncQueueItem(
  userId: string,
  eventId: string,
): Promise<void> {
  const safeId = validateUserId(userId);
  const db = await openOfflineDb(safeId);
  await db.delete("sync_queue", eventId);
}

export async function listSyncQueue(
  userId: string,
): Promise<OfflineSyncQueueRecord[]> {
  const safeId = validateUserId(userId);
  const db = await openOfflineDb(safeId);
  const rows = await db.getAll("sync_queue");
  return rows
    .filter((item) => item.user_id === safeId)
    .sort(
      (a, b) =>
        a.created_at.localeCompare(b.created_at) ||
        (a.seq ?? 0) - (b.seq ?? 0) ||
        a.event_id.localeCompare(b.event_id),
    );
}

// ============================================================================
// Local Notes Store
// ============================================================================

export async function putLocalNote(
  userId: string,
  record: OfflineLocalNoteRecord,
): Promise<void> {
  const safeId = validateUserId(userId);
  assertRecordPartition(safeId, record.user_id);
  try {
    const db = await openOfflineDb(safeId);
    await db.put("notes_local", record);
  } catch (err) {
    throw normalizeOfflineStorageError(err);
  }
}

export async function getLocalNote(
  userId: string,
  questionId: string,
): Promise<OfflineLocalNoteRecord | null> {
  const safeId = validateUserId(userId);
  const db = await openOfflineDb(safeId);
  const rec = await db.get("notes_local", questionId);
  if (!rec) return null;
  assertRecordPartition(safeId, rec.user_id);
  return rec;
}

export async function listLocalNotes(
  userId: string,
  setId?: string,
): Promise<OfflineLocalNoteRecord[]> {
  const safeId = validateUserId(userId);
  const db = await openOfflineDb(safeId);
  const rows = setId
    ? await db.getAllFromIndex("notes_local", "by_set", setId)
    : await db.getAll("notes_local");
  return rows.filter((n) => n.user_id === safeId);
}

export async function listNoteConflicts(
  userId: string,
): Promise<OfflineLocalNoteRecord[]> {
  const notes = await listLocalNotes(userId);
  return notes.filter((n) => n.conflict !== null);
}

// ============================================================================
// Sync Meta Store
// ============================================================================

export function createDefaultSyncMeta(userId: string): OfflineSyncMetaRecord {
  const safeId = validateUserId(userId);
  return {
    key: "state",
    user_id: safeId,
    last_synced_at: null,
    current_progress_generation: 1,
    last_sync_status: "idle",
    last_sync_error: null,
    stale_reset_notices: [],
    revoked_set_notices: [],
    deleted_notices: [],
    updated_at: new Date(0).toISOString(),
  };
}

export async function getSyncMeta(
  userId: string,
): Promise<OfflineSyncMetaRecord> {
  const safeId = validateUserId(userId);
  const db = await openOfflineDb(safeId);
  const rec = await db.get("sync_meta", "state");
  if (!rec) {
    return createDefaultSyncMeta(safeId);
  }
  assertRecordPartition(safeId, rec.user_id);
  return rec;
}

export async function putSyncMeta(
  userId: string,
  record: OfflineSyncMetaRecord,
): Promise<void> {
  const safeId = validateUserId(userId);
  assertRecordPartition(safeId, record.user_id);
  try {
    const db = await openOfflineDb(safeId);
    await db.put("sync_meta", record);
  } catch (err) {
    throw normalizeOfflineStorageError(err);
  }
}

export async function getLocalOfflineBytesBreakdown(userId: string): Promise<{
  downloadedSetsCount: number;
  questionsCount: number;
  diagramsCount: number;
  mediaCount: number;
  mediaBytes: number;
  totalEstimatedBytes: number;
  pendingSyncCount: number;
  noteConflictsCount: number;
}> {
  const safeId = validateUserId(userId);
  const db = await openOfflineDb(safeId);
  const [sets, questions, diagrams, media, queue, notes] = await Promise.all([
    db.getAll("downloaded_sets"),
    db.getAll("questions"),
    db.getAll("diagrams"),
    db.getAll("media_blobs"),
    db.getAll("sync_queue"),
    db.getAll("notes_local"),
  ]);

  const userSets = sets.filter((s) => s.user_id === safeId);
  const userMedia = media.filter((m) => m.user_id === safeId);
  const mediaBytes = userMedia.reduce((acc, m) => acc + Math.max(0, m.size_bytes), 0);
  const textBytes =
    userSets.reduce((acc, s) => acc + Math.max(0, s.estimated_total_bytes - s.media_bytes), 0);

  return {
    downloadedSetsCount: userSets.length,
    questionsCount: questions.filter((q) => q.user_id === safeId).length,
    diagramsCount: diagrams.filter((d) => d.user_id === safeId).length,
    mediaCount: userMedia.length,
    mediaBytes,
    totalEstimatedBytes: textBytes + mediaBytes,
    pendingSyncCount: queue.filter(
      (q) => q.user_id === safeId && q.queue_status !== "conflict_hold",
    ).length,
    noteConflictsCount: notes.filter((n) => n.user_id === safeId && n.conflict !== null)
      .length,
  };
}
