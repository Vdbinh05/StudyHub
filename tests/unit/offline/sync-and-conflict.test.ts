import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearUserOfflineData,
  closeAllOfflineDbs,
  getDownloadedSet,
  getLocalNote,
  getQuestionsForSet,
  getSyncMeta,
  listNoteConflicts,
  listSyncQueue,
  putDownloadedSet,
  putLocalNote,
  putQuestionsForSet,
} from "@/lib/offline/db";
import {
  buildNoteConflict,
  resolveNoteConflict,
} from "@/lib/offline/conflict-resolver";
import {
  enqueueOfflineEvent,
  getSyncQueueSummary,
  syncPendingEvents,
} from "@/lib/offline/sync-queue";
import type {
  OfflineDownloadedSetRecord,
  OfflineQuestionRecord,
} from "@/lib/offline/types";
import type { LearningSyncEventInput } from "@/types/v3";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const SET_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const Q_1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function seedSet(): OfflineDownloadedSetRecord {
  return {
    user_id: USER_ID,
    set_id: SET_ID,
    title: "Shared Set",
    subject: "Physics",
    description: null,
    set_type: "mixed",
    visibility: "shared",
    source_language: "vi",
    content_version: 1,
    server_updated_at: "2026-11-24T10:00:00.000Z",
    downloaded_at: "2026-11-24T11:00:00.000Z",
    downloaded_chapters: null,
    question_count: 1,
    diagram_count: 0,
    media_count: 0,
    media_bytes: 0,
    estimated_total_bytes: 1024,
    include_media: true,
    status: "ready",
    failed_media_urls: [],
    last_error: null,
    passages: [],
  };
}

function seedQuestion(): OfflineQuestionRecord {
  return {
    id: Q_1,
    user_id: USER_ID,
    study_set_id: SET_ID,
    question_type: "single_choice",
    position: 0,
    chapter: "Ch 1",
    prompt: "Q1",
    prompt_image_url: null,
    back_text: null,
    back_image_url: null,
    explanation: null,
    hint: null,
    difficulty: "easy",
    source_metadata: {},
    created_at: "2026-11-24T10:00:00.000Z",
    updated_at: "2026-11-24T10:00:00.000Z",
    cached_at: "2026-11-24T11:00:00.000Z",
  };
}

afterEach(async () => {
  await clearUserOfflineData(USER_ID);
  await closeAllOfflineDbs();
  vi.restoreAllMocks();
});

describe("Sync Queue & Conflict Resolver (`src/lib/offline/sync-queue.ts` + `conflict-resolver.ts`)", () => {
  it("enqueues events with stable UUIDs, syncs idempotently, and clears applied/duplicate_ignored items", async () => {
    const e1 = await enqueueOfflineEvent(USER_ID, {
      event_type: "answer",
      study_set_id: SET_ID,
      question_id: Q_1,
      payload: { is_correct: true, mode: "practice" },
    });
    const e2 = await enqueueOfflineEvent(USER_ID, {
      event_type: "confidence",
      study_set_id: SET_ID,
      question_id: Q_1,
      payload: { confidence: "certain", is_correct: true, mode: "practice" },
    });
    const e3 = await enqueueOfflineEvent(USER_ID, {
      event_type: "star",
      study_set_id: SET_ID,
      question_id: Q_1,
      payload: { starred: true },
    });

    expect(e1.event_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(new Set([e1.event_id, e2.event_id, e3.event_id]).size).toBe(3);

    const postedBodies: Array<{ events: LearningSyncEventInput[] }> = [];
    const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      postedBodies.push(
        JSON.parse(String(init?.body ?? "{}")) as {
          events: LearningSyncEventInput[];
        },
      );
      return new Response(
        JSON.stringify({
          data: {
            results: [
              { event_id: e1.event_id, status: "applied" },
              { event_id: e2.event_id, status: "duplicate_ignored" },
              { event_id: e3.event_id, status: "applied" },
            ],
            server_now: "2026-11-24T12:30:00.000Z",
            current_progress_generation: 3,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const outcome = await syncPendingEvents(USER_ID, { fetcher });
    expect(outcome.status).toBe("success");
    expect(outcome.appliedCount).toBe(2);
    expect(outcome.duplicateCount).toBe(1);
    expect(postedBodies).toHaveLength(1);
    expect(postedBodies[0]?.events.map((e) => e.event_id)).toEqual([
      e1.event_id,
      e2.event_id,
      e3.event_id,
    ]);

    expect(await listSyncQueue(USER_ID)).toEqual([]);
    const meta = await getSyncMeta(USER_ID);
    expect(meta.last_synced_at).toBe("2026-11-24T12:30:00.000Z");
    expect(meta.current_progress_generation).toBe(3);
  });

  it("preserves the entire pending queue intact on expired HTTP 401 auth and retries cleanly after re-auth", async () => {
    const e1 = await enqueueOfflineEvent(USER_ID, {
      event_type: "answer",
      study_set_id: SET_ID,
      question_id: Q_1,
      payload: { is_correct: true },
    });

    const authExpiredFetcher = vi.fn(async () =>
      new Response(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Expired" } }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const first = await syncPendingEvents(USER_ID, { fetcher: authExpiredFetcher });
    expect(first.status).toBe("auth_required");

    // Pending event MUST NOT be lost!
    const queuedAfter401 = await listSyncQueue(USER_ID);
    expect(queuedAfter401).toHaveLength(1);
    expect(queuedAfter401[0]?.event_id).toBe(e1.event_id);
    expect(queuedAfter401[0]?.queue_status).toBe("auth_required");

    const summary = await getSyncQueueSummary(USER_ID);
    expect(summary.authRequiredCount).toBe(1);
    expect(summary.pendingCount).toBe(1);

    // After user re-authenticates, retry succeeds with the exact same event_id
    const reauthedFetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: {
            results: [{ event_id: e1.event_id, status: "applied" }],
            server_now: "2026-11-24T12:40:00.000Z",
            current_progress_generation: 1,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const second = await syncPendingEvents(USER_ID, {
      fetcher: reauthedFetcher,
      force: true,
    });
    expect(second.status).toBe("success");
    expect(second.appliedCount).toBe(1);
    expect(await listSyncQueue(USER_ID)).toEqual([]);
  });

  it("handles ignored_stale_reset, rejected_revoked (purging revoked set), and rejected_deleted deterministically", async () => {
    await putDownloadedSet(USER_ID, seedSet());
    await putQuestionsForSet(USER_ID, SET_ID, [seedQuestion()]);

    const eReset = await enqueueOfflineEvent(USER_ID, {
      event_type: "answer",
      study_set_id: SET_ID,
      question_id: Q_1,
      payload: { is_correct: true },
    });
    const eRevoked = await enqueueOfflineEvent(USER_ID, {
      event_type: "answer",
      study_set_id: SET_ID,
      question_id: Q_1,
      payload: { is_correct: false },
    });
    const eDeleted = await enqueueOfflineEvent(USER_ID, {
      event_type: "star",
      study_set_id: SET_ID,
      question_id: Q_1,
      payload: { starred: true },
    });

    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: {
            results: [
              {
                event_id: eReset.event_id,
                status: "ignored_stale_reset",
                message: "Progress was reset on another device.",
              },
              {
                event_id: eRevoked.event_id,
                status: "rejected_revoked",
                message: "Access to this shared study set was revoked.",
              },
              {
                event_id: eDeleted.event_id,
                status: "rejected_deleted",
                message: "Question was deleted.",
              },
            ],
            server_now: "2026-11-24T13:00:00.000Z",
            current_progress_generation: 4,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const outcome = await syncPendingEvents(USER_ID, { fetcher });
    expect(outcome.staleResetCount).toBe(1);
    expect(outcome.revokedCount).toBe(1);
    expect(outcome.deletedCount).toBe(1);
    expect(await listSyncQueue(USER_ID)).toEqual([]);

    // Revoked set's cached questions must be purged & set marked revoked (or deleted)
    expect(await getQuestionsForSet(USER_ID, SET_ID)).toEqual([]);
    const setRecord = await getDownloadedSet(USER_ID, SET_ID);
    expect(setRecord === null || setRecord.status === "revoked").toBe(true);

    const meta = await getSyncMeta(USER_ID);
    expect(meta.stale_reset_notices).toHaveLength(1);
    expect(meta.revoked_set_notices).toHaveLength(1);
    expect(meta.deleted_notices).toHaveLength(1);
    expect(meta.current_progress_generation).toBe(4);
  });

  it("preserves BOTH note versions on conflict (never blind LWW) and supports keep_local, keep_server, and keep_merged", async () => {
    await putLocalNote(USER_ID, {
      question_id: Q_1,
      study_set_id: SET_ID,
      user_id: USER_ID,
      content_text: "My offline note edit (device A)",
      content_rich: null,
      version: 2,
      base_version: 1,
      dirty: true,
      updated_at: "2026-11-24T12:10:00.000Z",
      conflict: null,
    });

    const eNote = await enqueueOfflineEvent(USER_ID, {
      event_type: "note_upsert",
      study_set_id: SET_ID,
      question_id: Q_1,
      base_version: 1,
      payload: {
        content_text: "My offline note edit (device A)",
        content_rich: null,
      },
    });

    const conflictFetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          data: {
            results: [
              {
                event_id: eNote.event_id,
                status: "conflict",
                server_version: 3,
                server_data: {
                  content_text: "Updated note from laptop (version 3)",
                  content_rich: null,
                  updated_at: "2026-11-24T12:08:00.000Z",
                },
              },
            ],
            server_now: "2026-11-24T12:15:00.000Z",
            current_progress_generation: 1,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const outcome = await syncPendingEvents(USER_ID, { fetcher: conflictFetcher });
    expect(outcome.conflictCount).toBe(1);

    // Verify BOTH versions are preserved intact!
    const conflicts = await listNoteConflicts(USER_ID);
    expect(conflicts).toHaveLength(1);
    const conflict = conflicts[0]!.conflict!;
    expect(conflict.local_text).toBe("My offline note edit (device A)");
    expect(conflict.server_text).toBe("Updated note from laptop (version 3)");
    expect(conflict.server_version).toBe(3);

    // Resolution 1: keep_merged saves merged text & enqueues fresh note_upsert with base_version = 3
    await resolveNoteConflict(USER_ID, Q_1, {
      strategy: "keep_merged",
      mergedText: "Combined: device A + version 3",
    });

    const resolvedMerged = await getLocalNote(USER_ID, Q_1);
    expect(resolvedMerged?.conflict).toBeNull();
    expect(resolvedMerged?.content_text).toBe("Combined: device A + version 3");
    expect(resolvedMerged?.base_version).toBe(3);

    const queueAfterResolve = await listSyncQueue(USER_ID);
    expect(queueAfterResolve).toHaveLength(1);
    expect(queueAfterResolve[0]?.event_type).toBe("note_upsert");
    expect(queueAfterResolve[0]?.base_version).toBe(3);
    expect(queueAfterResolve[0]?.event_id).not.toBe(eNote.event_id);

    // Resolution 2: buildNoteConflict + keep_server clears conflict without enqueueing write
    const syntheticConflict = buildNoteConflict({
      eventId: "evt-synthetic",
      localText: "Draft local",
      localRich: null,
      localUpdatedAt: "2026-11-24T12:20:00.000Z",
      localBaseVersion: 3,
      serverVersion: 4,
      serverData: {
        content_text: "Canonical server v4",
        updated_at: "2026-11-24T12:19:00.000Z",
      },
    });
    await putLocalNote(USER_ID, {
      ...resolvedMerged!,
      conflict: syntheticConflict,
    });
    await resolveNoteConflict(USER_ID, Q_1, { strategy: "keep_server" });
    const afterKeepServer = await getLocalNote(USER_ID, Q_1);
    expect(afterKeepServer?.conflict).toBeNull();
    expect(afterKeepServer?.content_text).toBe("Canonical server v4");
    expect(afterKeepServer?.version).toBe(4);
    expect(afterKeepServer?.dirty).toBe(false);
  });

  it("coalesces superseded pending checkpoint_upsert events while preserving every answer event", async () => {
    await enqueueOfflineEvent(USER_ID, {
      event_type: "checkpoint_upsert",
      study_set_id: SET_ID,
      payload: { mode: "learn", session_key: "default", current_index: 1 },
    });
    await enqueueOfflineEvent(USER_ID, {
      event_type: "checkpoint_upsert",
      study_set_id: SET_ID,
      payload: { mode: "learn", session_key: "default", current_index: 4 },
    });
    await enqueueOfflineEvent(USER_ID, {
      event_type: "answer",
      study_set_id: SET_ID,
      question_id: Q_1,
      payload: { is_correct: false },
    });
    await enqueueOfflineEvent(USER_ID, {
      event_type: "answer",
      study_set_id: SET_ID,
      question_id: Q_1,
      payload: { is_correct: true },
    });

    const queue = await listSyncQueue(USER_ID);
    const checkpoints = queue.filter((e) => e.event_type === "checkpoint_upsert");
    const answers = queue.filter((e) => e.event_type === "answer");
    expect(checkpoints).toHaveLength(1);
    expect(checkpoints[0]?.payload.current_index).toBe(4);
    expect(answers).toHaveLength(2);
  });
});
