import { describe, expect, it } from "vitest";
import {
  buildLearningEventKey,
  makeCheckpointSessionKey,
  pickNewestCheckpoint,
  reconcileCheckpointQuestions,
} from "@/lib/learning/checkpoints";
import type { LearningSessionCheckpoint } from "@/types/domain";

describe("Learning Session Checkpoints & Reconciliation (V3)", () => {
  it("builds deterministic session keys and idempotent event keys", () => {
    const key = makeCheckpointSessionKey("spell", "set-123", "Ch 1");
    expect(key).toBe("spell:set-123:Ch_1");
    expect(buildLearningEventKey(key, "q-1", 1)).toBe("spell:set-123:Ch_1:q-1:1");
    expect(buildLearningEventKey(key, "q-1", 1)).toBe(
      buildLearningEventKey(key, "q-1", 1),
    );
  });

  it("cleanly reconciles checkpoints when source questions were deleted", () => {
    const saved = ["q1", "q2", "q3", "q4", "q5"];
    const live = new Set(["q2", "q4", "q5"]);

    // User was at index 3 (q4); q1 & q3 were deleted before index 3 -> safeIndex shifts to 1 (q4)!
    const res = reconcileCheckpointQuestions(saved, live, 3);
    expect(res.hasDrift).toBe(true);
    expect(res.validIds).toEqual(["q2", "q4", "q5"]);
    expect(res.removedIds).toEqual(["q1", "q3"]);
    expect(res.safeIndex).toBe(1);
    expect(res.validIds[res.safeIndex]).toBe("q4");

    // All questions deleted -> safeIndex = 0 without crash
    const empty = reconcileCheckpointQuestions(saved, new Set(), 4);
    expect(empty.validIds).toEqual([]);
    expect(empty.safeIndex).toBe(0);
  });

  it("picks the newest checkpoint between remote server and local offline fallback", () => {
    const remote: LearningSessionCheckpoint = {
      id: "cp-1",
      user_id: "u1",
      study_set_id: "set-1",
      mode: "learn",
      session_key: "learn:set-1:default",
      state_json: { step: 2 },
      progress_percent: 40,
      current_index: 2,
      total_items: 5,
      device_id: null,
      created_at: "2026-11-24T10:00:00.000Z",
      updated_at: "2026-11-24T10:05:00.000Z",
    };

    const newerLocal = {
      version: 1 as const,
      userId: "u1",
      studySetId: "set-1",
      mode: "learn" as const,
      sessionKey: "learn:set-1:default",
      currentIndex: 3,
      totalItems: 5,
      progressPercent: 60,
      stateJson: { step: 3 },
      committedEventKeys: ["e1"],
      updatedAt: "2026-11-24T10:09:00.000Z",
    };

    const pickedLocal = pickNewestCheckpoint(remote, newerLocal);
    expect(pickedLocal.source).toBe("local");
    expect(pickedLocal.currentIndex).toBe(3);
    expect(pickedLocal.checkpointId).toBe("cp-1");

    const olderLocal = {
      ...newerLocal,
      updatedAt: "2026-11-24T10:01:00.000Z",
    };
    const pickedRemote = pickNewestCheckpoint(remote, olderLocal);
    expect(pickedRemote.source).toBe("remote");
    expect(pickedRemote.currentIndex).toBe(2);
  });
});
