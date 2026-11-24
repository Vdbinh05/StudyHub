/**
 * StudyHub V3.0 — Deterministic Sync Conflict Resolver.
 * Preserves BOTH local and server note versions on concurrent edits (NEVER blind LWW).
 */

import type { LearningSyncEventResult, RichTextDoc, SyncEventStatus } from "@/types/v3";
import {
  deleteSyncQueueItem,
  getLocalNote,
  getSyncMeta,
  putLocalNote,
  putSyncQueueItem,
} from "./db";
import type { NoteConflictRecord, OfflineLocalNoteRecord } from "./types";

export function createOfflineEventUuid(): string {
  if (
    typeof globalThis !== "undefined" &&
    globalThis.crypto &&
    typeof globalThis.crypto.randomUUID === "function"
  ) {
    return globalThis.crypto.randomUUID();
  }

  // RFC 4122 v4 deterministic fallback using getRandomValues if available
  const bytes = new Uint8Array(16);
  if (
    typeof globalThis !== "undefined" &&
    globalThis.crypto &&
    typeof globalThis.crypto.getRandomValues === "function"
  ) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 16; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type SyncResultBucket =
  | "applied"
  | "duplicate"
  | "stale_reset"
  | "revoked"
  | "deleted"
  | "conflict"
  | "invalid";

export function classifySyncEventStatus(status: SyncEventStatus): SyncResultBucket {
  switch (status) {
    case "applied":
      return "applied";
    case "duplicate_ignored":
      return "duplicate";
    case "ignored_stale_reset":
      return "stale_reset";
    case "rejected_revoked":
      return "revoked";
    case "rejected_deleted":
      return "deleted";
    case "conflict":
      return "conflict";
    case "invalid":
    default:
      return "invalid";
  }
}

export function classifySyncResult(result: LearningSyncEventResult): SyncResultBucket {
  return classifySyncEventStatus(result.status);
}

export interface BuildNoteConflictInput {
  eventId: string;
  localText: string;
  localRich: RichTextDoc | null;
  localUpdatedAt: string;
  localBaseVersion: number | null;
  serverVersion: number;
  serverData?: Record<string, unknown> | null;
  detectedAt?: string;
}

function parseRichTextDoc(value: unknown): RichTextDoc | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<RichTextDoc>;
  if (candidate.type === "doc" && Array.isArray(candidate.content)) {
    return {
      version: 1,
      type: "doc",
      content: candidate.content,
    };
  }
  return null;
}

/**
 * Build a lossless `NoteConflictRecord` preserving both local and server copies.
 */
export function buildNoteConflict(input: BuildNoteConflictInput): NoteConflictRecord {
  const serverObj = input.serverData ?? {};
  const serverText =
    typeof serverObj.content_text === "string" ? serverObj.content_text : "";
  const serverRich = parseRichTextDoc(serverObj.content_rich);
  const serverUpdatedAt =
    typeof serverObj.updated_at === "string" ? serverObj.updated_at : null;

  return {
    detected_at: input.detectedAt ?? new Date().toISOString(),
    event_id: input.eventId,
    local_text: input.localText,
    local_rich: input.localRich,
    local_updated_at: input.localUpdatedAt,
    local_base_version: input.localBaseVersion,
    server_text: serverText,
    server_rich: serverRich,
    server_version: Math.max(1, Number(input.serverVersion) || 1),
    server_updated_at: serverUpdatedAt,
  };
}

export type NoteConflictResolution =
  | { strategy: "keep_local" }
  | { strategy: "keep_server" }
  | { strategy: "keep_merged"; mergedText: string; mergedRich?: RichTextDoc | null };

/**
 * Resolve a stored note conflict cleanly:
 * - `keep_server`: adopts server version, marks clean, clears conflict (no write queued).
 * - `keep_local`: preserves local text, updates `base_version` to server's latest version,
 *   clears conflict, and enqueues a fresh `note_upsert` sync event.
 * - `keep_merged`: saves user's merged text, updates `base_version` to server's latest version,
 *   clears conflict, and enqueues a fresh `note_upsert` sync event.
 */
export async function resolveNoteConflict(
  userId: string,
  questionId: string,
  resolution: NoteConflictResolution,
): Promise<OfflineLocalNoteRecord | null> {
  const note = await getLocalNote(userId, questionId);
  if (!note || !note.conflict) {
    return note;
  }

  const conflict = note.conflict;
  const nowIso = new Date().toISOString();

  // Remove any previously held conflicting event
  await deleteSyncQueueItem(userId, conflict.event_id).catch(() => undefined);

  if (resolution.strategy === "keep_server") {
    const updated: OfflineLocalNoteRecord = {
      ...note,
      content_text: conflict.server_text,
      content_rich: conflict.server_rich,
      version: conflict.server_version,
      base_version: conflict.server_version,
      dirty: false,
      updated_at: conflict.server_updated_at ?? nowIso,
      conflict: null,
    };
    await putLocalNote(userId, updated);
    return updated;
  }

  const nextText =
    resolution.strategy === "keep_merged"
      ? resolution.mergedText
      : conflict.local_text;
  const nextRich =
    resolution.strategy === "keep_merged"
      ? (resolution.mergedRich ?? null)
      : conflict.local_rich;

  const updated: OfflineLocalNoteRecord = {
    ...note,
    content_text: nextText,
    content_rich: nextRich,
    version: conflict.server_version + 1,
    base_version: conflict.server_version,
    dirty: true,
    updated_at: nowIso,
    conflict: null,
  };

  await putLocalNote(userId, updated);

  const meta = await getSyncMeta(userId);
  const freshEventId = createOfflineEventUuid();

  await putSyncQueueItem(userId, {
    event_id: freshEventId,
    user_id: userId,
    event_type: "note_upsert",
    study_set_id: note.study_set_id,
    question_id: note.question_id,
    client_timestamp: nowIso,
    progress_generation: meta.current_progress_generation,
    base_version: conflict.server_version,
    payload: {
      content_text: nextText,
      content_rich: nextRich,
    },
    queue_status: "pending",
    attempt_count: 0,
    last_attempt_at: null,
    next_retry_at: null,
    last_error: null,
    created_at: nowIso,
  });

  return updated;
}

/**
 * Determine whether an offline progress event is stale relative to a newer server reset generation.
 */
export function isEventStaleAgainstReset(
  eventGeneration: number,
  serverGeneration: number,
): boolean {
  return eventGeneration < serverGeneration;
}
