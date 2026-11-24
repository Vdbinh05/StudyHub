/**
 * StudyHub V3.0 — Deterministic Offline Sync Queue (`POST /api/sync/events`).
 *
 * Guarantees:
 * - Stable client-generated UUID `event_id` per event for strict server-side idempotency.
 * - Foreground sync + manual Sync Now + `online` listener (never relying solely on Background Sync).
 * - Handles `applied`, `duplicate_ignored`, `ignored_stale_reset`, `rejected_revoked`,
 *   `rejected_deleted`, `conflict` (preserving BOTH note versions), and `invalid`.
 * - Preserves pending queue completely intact on expired `401 Unauthorized` auth sessions!
 */

import type {
  LearningSyncEventInput,
  LearningSyncResponse,
  OfflineSyncEventType,
  RichTextDoc,
} from "@/types/v3";
import {
  buildNoteConflict,
  classifySyncResult,
  createOfflineEventUuid,
} from "./conflict-resolver";
import {
  deleteDownloadedSetRecords,
  deleteSyncQueueItem,
  getDownloadedSet,
  getLocalNote,
  getSyncMeta,
  listNoteConflicts,
  listSyncQueue,
  putDownloadedSet,
  putLocalNote,
  putSyncMeta,
  putSyncQueueItem,
} from "./db";
import type { FetchLike } from "./download-manager";
import type {
  OfflineSyncMetaRecord,
  OfflineSyncQueueRecord,
  SyncNoticeRecord,
} from "./types";

const MAX_SYNC_BATCH_SIZE = 100;
const BASE_RETRY_BACKOFF_MS = 2_000;
const MAX_RETRY_BACKOFF_MS = 5 * 60_000;
const MAX_STORED_NOTICES = 30;

const inFlightByUser = new Map<string, Promise<SyncRunOutcome>>();
let localEnqueueSeq = 0;

export interface EnqueueOfflineEventInput {
  event_id?: string;
  event_type: OfflineSyncEventType;
  study_set_id?: string | null;
  question_id?: string | null;
  client_timestamp?: string;
  progress_generation?: number;
  base_version?: number | null;
  payload: Record<string, unknown>;
}

export interface SyncRunOutcome {
  status: "idle" | "success" | "auth_required" | "offline" | "error";
  processedCount: number;
  appliedCount: number;
  duplicateCount: number;
  staleResetCount: number;
  revokedCount: number;
  deletedCount: number;
  conflictCount: number;
  invalidCount: number;
  remainingPendingCount: number;
  errorMessage?: string;
}

export interface SyncQueueSummary {
  pendingCount: number;
  authRequiredCount: number;
  retryWaitCount: number;
  conflictCount: number;
  lastSyncedAt: string | null;
  lastSyncStatus: OfflineSyncMetaRecord["last_sync_status"];
  lastSyncError: string | null;
  currentProgressGeneration: number;
  staleResetNotices: SyncNoticeRecord[];
  revokedSetNotices: SyncNoticeRecord[];
  deletedNotices: SyncNoticeRecord[];
}

function appendBoundedNotice(
  existing: readonly SyncNoticeRecord[],
  notice: SyncNoticeRecord,
): SyncNoticeRecord[] {
  const next = [notice, ...existing.filter((n) => n.event_id !== notice.event_id)];
  return next.slice(0, MAX_STORED_NOTICES);
}

/**
 * Enqueue a deterministic offline learning event into the user's partitioned IndexedDB queue.
 */
export async function enqueueOfflineEvent(
  userId: string,
  input: EnqueueOfflineEventInput,
): Promise<OfflineSyncQueueRecord> {
  const nowIso = new Date().toISOString();
  const meta = await getSyncMeta(userId);
  const eventId = input.event_id ?? createOfflineEventUuid();

  // Safely coalesce superseded unsent checkpoint events for the exact same session
  if (input.event_type === "checkpoint_upsert") {
    const existingQueue = await listSyncQueue(userId);
    const targetMode = String(input.payload.mode ?? "");
    const targetKey = String(input.payload.session_key ?? "default");
    for (const queued of existingQueue) {
      if (
        queued.event_type === "checkpoint_upsert" &&
        queued.queue_status === "pending" &&
        queued.study_set_id === (input.study_set_id ?? null) &&
        String(queued.payload.mode ?? "") === targetMode &&
        String(queued.payload.session_key ?? "default") === targetKey
      ) {
        await deleteSyncQueueItem(userId, queued.event_id);
      }
    }
  }

  localEnqueueSeq += 1;

  const record: OfflineSyncQueueRecord = {
    event_id: eventId,
    seq: localEnqueueSeq,
    user_id: userId,
    event_type: input.event_type,
    study_set_id: input.study_set_id ?? null,
    question_id: input.question_id ?? null,
    client_timestamp: input.client_timestamp ?? nowIso,
    progress_generation:
      typeof input.progress_generation === "number"
        ? input.progress_generation
        : meta.current_progress_generation,
    base_version: input.base_version ?? null,
    payload: input.payload,
    queue_status: "pending",
    attempt_count: 0,
    last_attempt_at: null,
    next_retry_at: null,
    last_error: null,
    created_at: nowIso,
  };

  await putSyncQueueItem(userId, record);
  return record;
}

function toWireEvent(rec: OfflineSyncQueueRecord): LearningSyncEventInput {
  return {
    event_id: rec.event_id,
    event_type: rec.event_type,
    study_set_id: rec.study_set_id,
    question_id: rec.question_id,
    client_timestamp: rec.client_timestamp,
    progress_generation: rec.progress_generation,
    base_version: rec.base_version,
    payload: rec.payload,
  };
}

function parseSyncResponsePayload(raw: unknown): LearningSyncResponse {
  if (raw && typeof raw === "object" && "data" in raw) {
    const data = (raw as { data: unknown }).data;
    if (data && typeof data === "object" && "results" in data) {
      return data as LearningSyncResponse;
    }
  }
  if (raw && typeof raw === "object" && "results" in raw) {
    return raw as LearningSyncResponse;
  }
  return {
    results: [],
    server_now: new Date().toISOString(),
    current_progress_generation: 0,
  };
}

async function runSyncOnce(
  userId: string,
  options: { fetcher?: FetchLike; force?: boolean } = {},
): Promise<SyncRunOutcome> {
  const fetcher: FetchLike = options.fetcher ?? ((i, init) => fetch(i, init));
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const allQueued = await listSyncQueue(userId);
  const eligible = allQueued.filter((item) => {
    if (item.queue_status === "conflict_hold") return false;
    if (options.force) return true;
    if (item.queue_status === "retry_wait" && item.next_retry_at) {
      const retryMs = Date.parse(item.next_retry_at);
      if (!Number.isNaN(retryMs) && retryMs > nowMs) {
        return false;
      }
    }
    return true;
  });

  if (eligible.length === 0) {
    const remaining = allQueued.filter((q) => q.queue_status !== "conflict_hold").length;
    return {
      status: "idle",
      processedCount: 0,
      appliedCount: 0,
      duplicateCount: 0,
      staleResetCount: 0,
      revokedCount: 0,
      deletedCount: 0,
      conflictCount: 0,
      invalidCount: 0,
      remainingPendingCount: remaining,
    };
  }

  let meta = await getSyncMeta(userId);
  await putSyncMeta(userId, {
    ...meta,
    last_sync_status: "syncing",
    last_sync_error: null,
    updated_at: nowIso,
  });

  const outcome: SyncRunOutcome = {
    status: "success",
    processedCount: 0,
    appliedCount: 0,
    duplicateCount: 0,
    staleResetCount: 0,
    revokedCount: 0,
    deletedCount: 0,
    conflictCount: 0,
    invalidCount: 0,
    remainingPendingCount: eligible.length,
  };

  for (let offset = 0; offset < eligible.length; offset += MAX_SYNC_BATCH_SIZE) {
    const batch = eligible.slice(offset, offset + MAX_SYNC_BATCH_SIZE);
    const byId = new Map(batch.map((ev) => [ev.event_id, ev]));

    let response: Response;
    try {
      response = await fetcher("/api/sync/events", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ events: batch.map(toWireEvent) }),
      });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Network connection unavailable.";
      await markBatchRetryWait(userId, batch, msg, nowMs);
      meta = {
        ...meta,
        last_sync_status: "offline",
        last_sync_error: msg,
        updated_at: new Date().toISOString(),
      };
      await putSyncMeta(userId, meta);
      return {
        ...outcome,
        status: "offline",
        remainingPendingCount: (await listSyncQueue(userId)).filter(
          (q) => q.queue_status !== "conflict_hold",
        ).length,
        errorMessage: msg,
      };
    }

    // CRITICAL: Preserve pending queue intact when auth session expired (401)
    if (response.status === 401) {
      const msg = "Session expired. Sign in again to sync your offline study progress.";
      for (const item of batch) {
        await putSyncQueueItem(userId, {
          ...item,
          queue_status: "auth_required",
          last_attempt_at: nowIso,
          last_error: msg,
        });
      }
      meta = {
        ...meta,
        last_sync_status: "auth_required",
        last_sync_error: msg,
        updated_at: new Date().toISOString(),
      };
      await putSyncMeta(userId, meta);
      return {
        ...outcome,
        status: "auth_required",
        remainingPendingCount: (await listSyncQueue(userId)).filter(
          (q) => q.queue_status !== "conflict_hold",
        ).length,
        errorMessage: msg,
      };
    }

    if (!response.ok) {
      const msg = `Sync endpoint returned HTTP ${response.status}.`;
      await markBatchRetryWait(userId, batch, msg, nowMs);
      meta = {
        ...meta,
        last_sync_status: "error",
        last_sync_error: msg,
        updated_at: new Date().toISOString(),
      };
      await putSyncMeta(userId, meta);
      return {
        ...outcome,
        status: "error",
        remainingPendingCount: (await listSyncQueue(userId)).filter(
          (q) => q.queue_status !== "conflict_hold",
        ).length,
        errorMessage: msg,
      };
    }

    const parsed = parseSyncResponsePayload(await response.json());
    const serverNow = parsed.server_now || new Date().toISOString();

    if (
      typeof parsed.current_progress_generation === "number" &&
      parsed.current_progress_generation >= meta.current_progress_generation
    ) {
      meta = {
        ...meta,
        current_progress_generation: parsed.current_progress_generation,
      };
    }

    for (const result of parsed.results) {
      const event = byId.get(result.event_id);
      if (!event) continue;

      outcome.processedCount += 1;
      const bucket = classifySyncResult(result);

      if (bucket === "applied" || bucket === "duplicate") {
        if (bucket === "applied") outcome.appliedCount += 1;
        else outcome.duplicateCount += 1;

        await deleteSyncQueueItem(userId, event.event_id);

        if (event.event_type === "note_upsert" && event.question_id) {
          const localNote = await getLocalNote(userId, event.question_id);
          if (localNote && !localNote.conflict) {
            const nextVersion =
              typeof result.server_version === "number"
                ? result.server_version
                : localNote.version;
            await putLocalNote(userId, {
              ...localNote,
              version: nextVersion,
              base_version: nextVersion,
              dirty: false,
            });
          }
        }
        continue;
      }

      if (bucket === "stale_reset") {
        outcome.staleResetCount += 1;
        await deleteSyncQueueItem(userId, event.event_id);
        meta = {
          ...meta,
          stale_reset_notices: appendBoundedNotice(meta.stale_reset_notices, {
            id: `reset-${event.event_id}`,
            event_id: event.event_id,
            study_set_id: event.study_set_id,
            question_id: event.question_id,
            message:
              result.message ||
              "Offline study progress was skipped because progress was reset more recently.",
            occurred_at: serverNow,
          }),
        };
        continue;
      }

      if (bucket === "revoked") {
        outcome.revokedCount += 1;
        await deleteSyncQueueItem(userId, event.event_id);
        meta = {
          ...meta,
          revoked_set_notices: appendBoundedNotice(meta.revoked_set_notices, {
            id: `revoked-${event.event_id}`,
            event_id: event.event_id,
            study_set_id: event.study_set_id,
            question_id: event.question_id,
            message:
              result.message ||
              "Access to this shared study set was revoked. Local cached content has been removed.",
            occurred_at: serverNow,
          }),
        };
        if (event.study_set_id) {
          const existingSet = await getDownloadedSet(userId, event.study_set_id);
          await deleteDownloadedSetRecords(userId, event.study_set_id);
          if (existingSet) {
            await putDownloadedSet(userId, {
              ...existingSet,
              question_count: 0,
              diagram_count: 0,
              media_count: 0,
              media_bytes: 0,
              estimated_total_bytes: 0,
              status: "revoked",
              last_error:
                result.message || "Access revoked by study set owner.",
              passages: [],
            });
          }
        }
        continue;
      }

      if (bucket === "deleted") {
        outcome.deletedCount += 1;
        await deleteSyncQueueItem(userId, event.event_id);
        meta = {
          ...meta,
          deleted_notices: appendBoundedNotice(meta.deleted_notices, {
            id: `deleted-${event.event_id}`,
            event_id: event.event_id,
            study_set_id: event.study_set_id,
            question_id: event.question_id,
            message:
              result.message ||
              "The target study set or question was deleted on the server.",
            occurred_at: serverNow,
          }),
        };
        if (event.study_set_id && !event.question_id) {
          await deleteDownloadedSetRecords(userId, event.study_set_id);
        }
        continue;
      }

      if (bucket === "conflict") {
        outcome.conflictCount += 1;
        // Remove conflicting event from retry loop; preserve BOTH versions in notes_local for user resolution!
        await deleteSyncQueueItem(userId, event.event_id);

        if (event.event_type === "note_upsert" && event.question_id) {
          const existingNote = await getLocalNote(userId, event.question_id);
          const localText =
            existingNote?.content_text ??
            (typeof event.payload.content_text === "string"
              ? event.payload.content_text
              : "");
          const localRich =
            existingNote?.content_rich ??
            ((event.payload.content_rich as RichTextDoc | null | undefined) ?? null);

          const conflict = buildNoteConflict({
            eventId: event.event_id,
            localText,
            localRich,
            localUpdatedAt: existingNote?.updated_at ?? event.client_timestamp,
            localBaseVersion: event.base_version,
            serverVersion:
              typeof result.server_version === "number"
                ? result.server_version
                : (existingNote?.version ?? 1) + 1,
            serverData: result.server_data,
            detectedAt: serverNow,
          });

          await putLocalNote(userId, {
            question_id: event.question_id,
            study_set_id: event.study_set_id ?? existingNote?.study_set_id ?? "",
            user_id: userId,
            content_text: localText,
            content_rich: localRich,
            version: existingNote?.version ?? 1,
            base_version: event.base_version,
            dirty: true,
            updated_at: existingNote?.updated_at ?? event.client_timestamp,
            conflict,
          });
        }
        continue;
      }

      // invalid
      outcome.invalidCount += 1;
      await deleteSyncQueueItem(userId, event.event_id);
    }

    meta = {
      ...meta,
      last_synced_at: serverNow,
      last_sync_status: "success",
      last_sync_error: null,
      updated_at: serverNow,
    };
    await putSyncMeta(userId, meta);
  }

  outcome.remainingPendingCount = (await listSyncQueue(userId)).filter(
    (q) => q.queue_status !== "conflict_hold",
  ).length;

  return outcome;
}

async function markBatchRetryWait(
  userId: string,
  batch: readonly OfflineSyncQueueRecord[],
  errorMessage: string,
  nowMs: number,
): Promise<void> {
  const nowIso = new Date(nowMs).toISOString();
  for (const item of batch) {
    const nextAttempt = item.attempt_count + 1;
    const delayMs = Math.min(
      MAX_RETRY_BACKOFF_MS,
      BASE_RETRY_BACKOFF_MS * Math.pow(2, Math.min(8, nextAttempt - 1)),
    );
    await putSyncQueueItem(userId, {
      ...item,
      queue_status: "retry_wait",
      attempt_count: nextAttempt,
      last_attempt_at: nowIso,
      next_retry_at: new Date(nowMs + delayMs).toISOString(),
      last_error: errorMessage,
    });
  }
}

/**
 * Flush queued offline learning events to `POST /api/sync/events`.
 * Single-flight per `userId` to prevent duplicate concurrent network batches.
 */
export async function syncPendingEvents(
  userId: string,
  options: { fetcher?: FetchLike; force?: boolean } = {},
): Promise<SyncRunOutcome> {
  const existing = inFlightByUser.get(userId);
  if (existing) {
    return existing;
  }

  const runPromise = runSyncOnce(userId, options).finally(() => {
    inFlightByUser.delete(userId);
  });
  inFlightByUser.set(userId, runPromise);
  return runPromise;
}

export async function getSyncQueueSummary(
  userId: string,
): Promise<SyncQueueSummary> {
  const [queue, meta, conflicts] = await Promise.all([
    listSyncQueue(userId),
    getSyncMeta(userId),
    listNoteConflicts(userId),
  ]);

  const activeQueue = queue.filter((q) => q.queue_status !== "conflict_hold");
  return {
    pendingCount: activeQueue.length,
    authRequiredCount: activeQueue.filter((q) => q.queue_status === "auth_required")
      .length,
    retryWaitCount: activeQueue.filter((q) => q.queue_status === "retry_wait")
      .length,
    conflictCount: conflicts.length,
    lastSyncedAt: meta.last_synced_at,
    lastSyncStatus: meta.last_sync_status,
    lastSyncError: meta.last_sync_error,
    currentProgressGeneration: meta.current_progress_generation,
    staleResetNotices: meta.stale_reset_notices,
    revokedSetNotices: meta.revoked_set_notices,
    deletedNotices: meta.deleted_notices,
  };
}

export async function clearSyncNotices(userId: string): Promise<void> {
  const meta = await getSyncMeta(userId);
  await putSyncMeta(userId, {
    ...meta,
    stale_reset_notices: [],
    revoked_set_notices: [],
    deleted_notices: [],
    updated_at: new Date().toISOString(),
  });
}
