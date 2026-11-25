import "fake-indexeddb/auto";
import { deleteDB } from "idb";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearUserOfflineData,
  closeAllOfflineDbs,
  deleteDownloadedSetRecords,
  deleteMediaBlobsForSet,
  getAllDownloadedSets,
  getDiagramsForSet,
  getLocalCheckpoint,
  getLocalNote,
  getMediaBlob,
  getOfflineDbName,
  getQuestionsForSet,
  getStorageEstimate,
  getSyncMeta,
  listSyncQueue,
  normalizeOfflineStorageError,
  OfflineStorageError,
  putDownloadedSet,
  putLocalCheckpoint,
  putLocalNote,
  putMediaBlob,
  putQuestionsForSet,
  putDiagramsForSet,
  putSyncQueueItem,
  putSyncMeta,
  switchOfflineUser,
} from "@/lib/offline/db";
import type {
  OfflineDiagramRecord,
  OfflineDownloadedSetRecord,
  OfflineLocalCheckpointRecord,
  OfflineLocalNoteRecord,
  OfflineMediaBlobRecord,
  OfflineQuestionRecord,
  OfflineSyncQueueRecord,
} from "@/lib/offline/types";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const SET_1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SET_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const Q_1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const DIAG_1 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function makeSetRecord(
  userId: string,
  setId: string,
  title: string,
): OfflineDownloadedSetRecord {
  return {
    user_id: userId,
    set_id: setId,
    title,
    subject: "Meteorology",
    description: null,
    set_type: "mixed",
    visibility: "private",
    source_language: "vi",
    content_version: 3,
    server_updated_at: "2026-11-24T10:00:00.000Z",
    downloaded_at: "2026-11-24T12:00:00.000Z",
    downloaded_chapters: null,
    question_count: 1,
    diagram_count: 1,
    media_count: 1,
    media_bytes: 128,
    estimated_total_bytes: 2048,
    include_media: true,
    status: "ready",
    failed_media_urls: [],
    last_error: null,
    passages: [],
  };
}

function makeQuestionRecord(
  userId: string,
  setId: string,
  questionId: string,
): OfflineQuestionRecord {
  return {
    id: questionId,
    user_id: userId,
    study_set_id: setId,
    question_type: "single_choice",
    position: 0,
    chapter: "Chapter 1",
    prompt: "Private prompt for " + userId,
    prompt_image_url: "/api/uploads/signed-url?path=img1&redirect=1",
    back_text: null,
    back_image_url: null,
    explanation: "Explanation",
    hint: null,
    difficulty: "medium",
    source_metadata: {},
    created_at: "2026-11-24T10:00:00.000Z",
    updated_at: "2026-11-24T10:00:00.000Z",
    options: [
      {
        id: "opt-1",
        question_id: questionId,
        study_set_id: setId,
        position: 0,
        label: "A",
        content: "Option A",
        image_url: null,
        is_correct: true,
        created_at: "2026-11-24T10:00:00.000Z",
      },
    ],
    cached_at: "2026-11-24T12:00:00.000Z",
  };
}

function makeDiagramRecord(
  userId: string,
  setId: string,
  diagramId: string,
): OfflineDiagramRecord {
  return {
    id: diagramId,
    user_id: userId,
    study_set_id: setId,
    owner_id: userId,
    title: "Atmosphere Layers",
    description: null,
    base_media_id: null,
    base_image_url: "/api/uploads/signed-url?path=diag1&redirect=1",
    image_width: 1000,
    image_height: 800,
    content_version: 1,
    created_at: "2026-11-24T10:00:00.000Z",
    updated_at: "2026-11-24T10:00:00.000Z",
    hotspots: [],
    cached_at: "2026-11-24T12:00:00.000Z",
  };
}

function makeBlobRecord(
  userId: string,
  url: string,
  setIds: string[],
): OfflineMediaBlobRecord {
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  return {
    url,
    user_id: userId,
    media_id: null,
    kind: "image",
    mime_type: "image/png",
    size_bytes: bytes.byteLength,
    blob: new Blob([bytes], { type: "image/png" }),
    set_ids: setIds,
    downloaded_at: "2026-11-24T12:00:00.000Z",
  };
}

afterEach(async () => {
  await clearUserOfflineData(USER_A);
  await clearUserOfflineData(USER_B);
  await closeAllOfflineDbs();
  vi.restoreAllMocks();
});

describe("Account-Partitioned IndexedDB Offline Store (`src/lib/offline/db.ts`)", () => {
  it("constructs strictly partitioned database names and rejects empty user IDs", () => {
    expect(getOfflineDbName(USER_A)).toBe(`studyhub-offline-v3:${USER_A}`);
    expect(getOfflineDbName(USER_B)).toBe(`studyhub-offline-v3:${USER_B}`);
    expect(() => getOfflineDbName("")).toThrow(OfflineStorageError);
    expect(() => getOfflineDbName("   ")).toThrow(OfflineStorageError);
  });

  it("enforces strict Account A vs Account B isolation across all 8 stores", async () => {
    const sharedUrl = "/api/uploads/signed-url?path=img1&redirect=1";

    await putDownloadedSet(USER_A, makeSetRecord(USER_A, SET_1, "Account A Private Set"));
    await putQuestionsForSet(USER_A, SET_1, [makeQuestionRecord(USER_A, SET_1, Q_1)]);
    await putDiagramsForSet(USER_A, SET_1, [makeDiagramRecord(USER_A, SET_1, DIAG_1)]);
    await putMediaBlob(USER_A, makeBlobRecord(USER_A, sharedUrl, [SET_1]));

    const cp: OfflineLocalCheckpointRecord = {
      checkpoint_key: `${SET_1}:flashcards:default`,
      user_id: USER_A,
      study_set_id: SET_1,
      mode: "flashcards",
      session_key: "default",
      state_json: { index: 5 },
      progress_percent: 50,
      current_index: 5,
      total_items: 10,
      updated_at: "2026-11-24T12:00:00.000Z",
      synced: false,
    };
    await putLocalCheckpoint(USER_A, cp);

    const note: OfflineLocalNoteRecord = {
      question_id: Q_1,
      study_set_id: SET_1,
      user_id: USER_A,
      content_text: "Secret note belonging only to Account A",
      content_rich: null,
      version: 1,
      base_version: 1,
      dirty: true,
      updated_at: "2026-11-24T12:00:00.000Z",
      conflict: null,
    };
    await putLocalNote(USER_A, note);

    const queueEvent: OfflineSyncQueueRecord = {
      event_id: "evt-a-1",
      user_id: USER_A,
      event_type: "answer",
      study_set_id: SET_1,
      question_id: Q_1,
      client_timestamp: "2026-11-24T12:01:00.000Z",
      progress_generation: 1,
      base_version: null,
      payload: { is_correct: true },
      queue_status: "pending",
      attempt_count: 0,
      last_attempt_at: null,
      next_retry_at: null,
      last_error: null,
      created_at: "2026-11-24T12:01:00.000Z",
    };
    await putSyncQueueItem(USER_A, queueEvent);
    await putSyncMeta(USER_A, {
      key: "state",
      user_id: USER_A,
      last_synced_at: "2026-11-24T12:05:00.000Z",
      current_progress_generation: 2,
      last_sync_status: "success",
      last_sync_error: null,
      stale_reset_notices: [],
      revoked_set_notices: [],
      deleted_notices: [],
      updated_at: "2026-11-24T12:05:00.000Z",
    });

    // Switch to Account B: MUST see zero records from Account A
    await switchOfflineUser(USER_A, USER_B);

    expect(await getAllDownloadedSets(USER_B)).toEqual([]);
    expect(await getQuestionsForSet(USER_B, SET_1)).toEqual([]);
    expect(await getDiagramsForSet(USER_B, SET_1)).toEqual([]);
    expect(await getMediaBlob(USER_B, sharedUrl)).toBeNull();
    expect(await getLocalCheckpoint(USER_B, cp.checkpoint_key)).toBeNull();
    expect(await getLocalNote(USER_B, Q_1)).toBeNull();
    expect(await listSyncQueue(USER_B)).toEqual([]);
    const metaB = await getSyncMeta(USER_B);
    expect(metaB.last_synced_at).toBeNull();
    expect(metaB.current_progress_generation).toBe(1);

    // Account A still retains its own records when queried under USER_A
    expect(await getAllDownloadedSets(USER_A)).toHaveLength(1);
    expect((await getLocalNote(USER_A, Q_1))?.content_text).toContain("Account A");
  });

  it("rejects cross-user record writes with INVALID_USER_PARTITION", async () => {
    await expect(
      putDownloadedSet(USER_B, makeSetRecord(USER_A, SET_1, "Cross-user leak")),
    ).rejects.toMatchObject({
      code: "INVALID_USER_PARTITION",
    });
  });

  it("clears only the logged-out user's offline data via clearUserOfflineData(userId)", async () => {
    await putDownloadedSet(USER_A, makeSetRecord(USER_A, SET_1, "Set A"));
    await putDownloadedSet(USER_B, makeSetRecord(USER_B, SET_2, "Set B"));

    await clearUserOfflineData(USER_A);

    expect(await getAllDownloadedSets(USER_A)).toEqual([]);
    const setsB = await getAllDownloadedSets(USER_B);
    expect(setsB).toHaveLength(1);
    expect(setsB[0]?.title).toBe("Set B");
  });

  it("reference-counts shared media_blobs so deleting Set 1 keeps blobs used by Set 2", async () => {
    const sharedUrl = "/api/uploads/signed-url?path=shared-img&redirect=1";
    const exclusiveUrl = "/api/uploads/signed-url?path=exclusive-img&redirect=1";

    await putDownloadedSet(USER_A, makeSetRecord(USER_A, SET_1, "Set 1"));
    await putDownloadedSet(USER_A, makeSetRecord(USER_A, SET_2, "Set 2"));
    await putMediaBlob(USER_A, makeBlobRecord(USER_A, sharedUrl, [SET_1, SET_2]));
    await putMediaBlob(USER_A, makeBlobRecord(USER_A, exclusiveUrl, [SET_1]));

    await deleteDownloadedSetRecords(USER_A, SET_1);

    // Exclusive blob removed, shared blob retained with only SET_2 reference
    expect(await getMediaBlob(USER_A, exclusiveUrl)).toBeNull();
    const sharedAfterSet1 = await getMediaBlob(USER_A, sharedUrl);
    expect(sharedAfterSet1).not.toBeNull();
    expect(sharedAfterSet1?.set_ids).toEqual([SET_2]);

    // Deleting Set 2 removes the now-unreferenced shared blob
    await deleteMediaBlobsForSet(USER_A, SET_2);
    expect(await getMediaBlob(USER_A, sharedUrl)).toBeNull();
  });

  it("normalizes QuotaExceededError and SecurityError (private browsing) cleanly", () => {
    const quotaDomErr = new DOMException("Storage full", "QuotaExceededError");
    const normQuota = normalizeOfflineStorageError(quotaDomErr);
    expect(normQuota).toBeInstanceOf(OfflineStorageError);
    expect(normQuota.code).toBe("QUOTA_EXCEEDED");

    const secDomErr = new DOMException("Private mode blocked IDB", "SecurityError");
    const normPriv = normalizeOfflineStorageError(secDomErr);
    expect(normPriv).toBeInstanceOf(OfflineStorageError);
    expect(normPriv.code).toBe("PRIVATE_BROWSING");
  });

  it("gracefully estimates storage quota with fallback when navigator.storage is unavailable", async () => {
    const mockEstimate = vi.fn().mockResolvedValue({
      usage: 5 * 1024 * 1024,
      quota: 100 * 1024 * 1024,
    });
    Object.defineProperty(navigator, "storage", {
      value: { estimate: mockEstimate },
      configurable: true,
    });

    const est = await getStorageEstimate();
    expect(est.supported).toBe(true);
    expect(est.usageBytes).toBe(5 * 1024 * 1024);
    expect(est.quotaBytes).toBe(100 * 1024 * 1024);
    expect(est.usagePercent).toBe(5);

    Object.defineProperty(navigator, "storage", {
      value: undefined,
      configurable: true,
    });
    const fallback = await getStorageEstimate();
    expect(fallback.supported).toBe(false);
    expect(fallback.usageBytes).toBe(0);
    expect(fallback.usagePercent).toBeNull();
  });

  it("closes stale openOfflineDb handles via blocking() when another tab deletes the DB (Wave 6)", async () => {
    await putDownloadedSet(USER_A, makeSetRecord(USER_A, SET_1, "Multi-tab Set"));

    // Simulate another tab issuing deleteDB while this tab still holds an open handle
    let blockedFired = false;
    await deleteDB(getOfflineDbName(USER_A), {
      blocked() {
        blockedFired = true;
      },
    });

    // blocking() closed this tab's handle immediately so deleteDB completed without stalling
    expect(blockedFired).toBe(false);
    expect(await getAllDownloadedSets(USER_A)).toEqual([]);
  });

  it("never stalls clearUserOfflineData when an external uncooperative IDB handle blocks deleteDB (Wave 6)", async () => {
    await putDownloadedSet(USER_A, makeSetRecord(USER_A, SET_1, "Blocked Set"));

    // Open a raw external IDB handle that intentionally refuses to close on versionchange
    const stubbornDb = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(getOfflineDbName(USER_A), 1);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    try {
      const startMs = Date.now();
      await clearUserOfflineData(USER_A, { deleteTimeoutMs: 60 });
      const elapsedMs = Date.now() - startMs;

      // Must resolve via bounded timeout rather than hanging indefinitely
      expect(elapsedMs).toBeLessThan(1_000);
    } finally {
      stubbornDb.close();
    }

    // All stores were emptied atomically before deleteDB timeout, so zero stale records remain
    expect(await getAllDownloadedSets(USER_A)).toEqual([]);
  });
});
