import { describe, expect, it } from "vitest";
import {
  selectQuestionsByPolicy,
  type SelectableQuestionCandidate,
} from "@/lib/learning/exam-selector";

function makeCandidate(
  id: string,
  overrides: Partial<SelectableQuestionCandidate> = {},
): SelectableQuestionCandidate {
  return {
    id,
    subjectId: "set-1",
    chapter: "Ch1",
    tagIds: [],
    isStarred: false,
    masteryLevel: "new",
    correctCount: 0,
    wrongCount: 0,
    consecutiveCorrect: 0,
    lastReviewedAt: null,
    lastWrongAt: null,
    nextReviewAt: null,
    ...overrides,
  };
}

describe("V2.0 Exam Selection Policies Engine (exam-selector.ts)", () => {
  const now = new Date("2026-06-15T12:00:00.000Z");

  it("Policy 1 (random): samples without replacement deterministically with seed", () => {
    const pool = Array.from({ length: 50 }, (_, i) => makeCandidate(`q-${i}`));
    const r1 = selectQuestionsByPolicy(pool, {
      policy: "random",
      count: 20,
      seed: "seed-1",
    });
    const r2 = selectQuestionsByPolicy(pool, {
      policy: "random",
      count: 20,
      seed: "seed-1",
    });

    expect(r1.selected).toHaveLength(20);
    expect(new Set(r1.selected.map((q) => q.id)).size).toBe(20);
    expect(r1.selected.map((q) => q.id)).toEqual(r2.selected.map((q) => q.id));
  });

  it("Policy 2 (unseen_first): prioritizes unanswered questions before filling from seen pool", () => {
    const pool = [
      makeCandidate("seen-1", { correctCount: 2, masteryLevel: "familiar" }),
      makeCandidate("seen-2", { wrongCount: 1, masteryLevel: "learning" }),
      makeCandidate("unseen-1"),
      makeCandidate("unseen-2"),
      makeCandidate("unseen-3"),
    ];

    const res = selectQuestionsByPolicy(pool, {
      policy: "unseen_first",
      count: 4,
      seed: "unseen-seed",
    });

    expect(res.selected).toHaveLength(4);
    const firstThreeIds = new Set(res.selected.slice(0, 3).map((q) => q.id));
    expect(firstThreeIds).toEqual(new Set(["unseen-1", "unseen-2", "unseen-3"]));
    expect(["seen-1", "seen-2"]).toContain(res.selected[3].id);
  });

  it("Policy 3 (mistakes_first): ranks unresolved mistakes by wrongCount & recency first", () => {
    const pool = [
      makeCandidate("clean", { correctCount: 3, masteryLevel: "mastered" }),
      makeCandidate("resolved-mistake", {
        wrongCount: 5,
        correctCount: 5,
        masteryLevel: "mastered",
      }),
      makeCandidate("unres-low", {
        wrongCount: 1,
        correctCount: 0,
        masteryLevel: "learning",
        lastWrongAt: "2026-06-14T10:00:00.000Z",
      }),
      makeCandidate("unres-high-old", {
        wrongCount: 4,
        correctCount: 0,
        masteryLevel: "learning",
        lastWrongAt: "2026-06-01T10:00:00.000Z",
      }),
      makeCandidate("unres-high-new", {
        wrongCount: 4,
        correctCount: 0,
        masteryLevel: "learning",
        lastWrongAt: "2026-06-15T10:00:00.000Z",
      }),
    ];

    const res = selectQuestionsByPolicy(pool, {
      policy: "mistakes_first",
      count: 5,
      seed: "mistakes-seed",
    });

    expect(res.selected.map((q) => q.id)).toEqual([
      "unres-high-new",
      "unres-high-old",
      "unres-low",
      "resolved-mistake",
      "clean",
    ]);
  });

  it("Policy 4 (weak_topics_first): deterministically prioritizes chapters/tags with lowest accuracy & mastery", () => {
    const pool = [
      // Strong chapter: 100% accuracy, mastered
      makeCandidate("strong-1", {
        chapter: "Atmosphere",
        correctCount: 10,
        wrongCount: 0,
        masteryLevel: "mastered",
      }),
      makeCandidate("strong-2", {
        chapter: "Atmosphere",
        correctCount: 8,
        wrongCount: 0,
        masteryLevel: "mastered",
      }),
      // Weak chapter: 20% accuracy, learning
      makeCandidate("weak-1", {
        chapter: "Icing",
        correctCount: 1,
        wrongCount: 4,
        masteryLevel: "learning",
      }),
      makeCandidate("weak-2", {
        chapter: "Icing",
        correctCount: 1,
        wrongCount: 4,
        masteryLevel: "learning",
      }),
    ];

    const res = selectQuestionsByPolicy(pool, {
      policy: "weak_topics_first",
      count: 2,
      seed: "weak-seed",
    });

    expect(new Set(res.selected.map((q) => q.id))).toEqual(
      new Set(["weak-1", "weak-2"]),
    );
  });

  it("Policy 5 (due_for_review): selects SM-2 overdue items (most overdue first) before non-due", () => {
    const pool = [
      makeCandidate("future", {
        masteryLevel: "familiar",
        nextReviewAt: "2026-06-20T12:00:00.000Z",
      }),
      makeCandidate("due-older", {
        masteryLevel: "learning",
        nextReviewAt: "2026-06-10T12:00:00.000Z",
      }),
      makeCandidate("due-recent", {
        masteryLevel: "learning",
        nextReviewAt: "2026-06-15T11:00:00.000Z",
      }),
      makeCandidate("new-no-due"),
    ];

    const res = selectQuestionsByPolicy(pool, {
      policy: "due_for_review",
      count: 3,
      now,
      seed: "due-seed",
    });

    expect(res.selected[0].id).toBe("due-older");
    expect(res.selected[1].id).toBe("due-recent");
    expect(res.selected).toHaveLength(3);
  });

  it("Policy 6 (starred_only): STRICT filter — NEVER silently pads with unstarred questions", () => {
    const pool = [
      makeCandidate("s-1", { isStarred: true }),
      makeCandidate("s-2", { isStarred: true }),
      makeCandidate("u-1", { isStarred: false }),
      makeCandidate("u-2", { isStarred: false }),
      makeCandidate("u-3", { isStarred: false }),
    ];

    const res = selectQuestionsByPolicy(pool, {
      policy: "starred_only",
      count: 5,
      seed: "star-seed",
    });

    expect(res.isStrictFilter).toBe(true);
    expect(res.eligiblePoolCount).toBe(2);
    expect(res.selected).toHaveLength(2);
    expect(res.shortfall).toBe(3);
    expect(res.selected.every((q) => q.isStarred)).toBe(true);
  });

  it("Policy 7 (incorrect_only): STRICT filter — NEVER silently pads with non-mistake questions", () => {
    const pool = [
      makeCandidate("m-1", { wrongCount: 2, masteryLevel: "learning" }),
      makeCandidate("ok-1", { correctCount: 3, wrongCount: 0, masteryLevel: "mastered" }),
      makeCandidate("new-1"),
    ];

    const res = selectQuestionsByPolicy(pool, {
      policy: "incorrect_only",
      count: 3,
      seed: "wrong-seed",
    });

    expect(res.isStrictFilter).toBe(true);
    expect(res.eligiblePoolCount).toBe(1);
    expect(res.selected.map((q) => q.id)).toEqual(["m-1"]);
    expect(res.shortfall).toBe(2);
  });

  it("Policy 8 (anti_repeat): excludes recently completed IDs first and honestly discloses repeats when pool is insufficient", () => {
    const pool = [
      makeCandidate("fresh-1"),
      makeCandidate("fresh-2"),
      makeCandidate("recent-old"),
      makeCandidate("recent-new"),
    ];

    const recentIds = new Set(["recent-old", "recent-new"]);
    const ts = new Map([
      ["recent-old", 1000],
      ["recent-new", 2000],
    ]);

    // Case 1: Fresh pool suffices -> zero repeats
    const noRepeat = selectQuestionsByPolicy(pool, {
      policy: "anti_repeat",
      count: 2,
      recentlyCompletedQuestionIds: recentIds,
      seed: "ar-1",
    });
    expect(noRepeat.hasRepeats).toBe(false);
    expect(noRepeat.repeatedCount).toBe(0);
    expect(new Set(noRepeat.selected.map((q) => q.id))).toEqual(
      new Set(["fresh-1", "fresh-2"]),
    );

    // Case 2: Request 3 -> takes 2 fresh + 1 oldest repeated, with honest disclosure!
    const withRepeat = selectQuestionsByPolicy(pool, {
      policy: "anti_repeat",
      count: 3,
      recentlyCompletedQuestionIds: recentIds,
      recentCompletionTimestamps: ts,
      seed: "ar-2",
    });
    expect(withRepeat.hasRepeats).toBe(true);
    expect(withRepeat.repeatedCount).toBe(1);
    expect(withRepeat.repeatedQuestionIds).toEqual(["recent-old"]);
    expect(withRepeat.disclosure).toContain("1 recently completed");
  });
});
