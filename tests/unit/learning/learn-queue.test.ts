import { describe, expect, it } from "vitest";
import {
  advanceLearnRound,
  createLearnQueueState,
  getCurrentLearnCard,
  getLearnStats,
  prioritizeLearnQuestions,
  recordLearnAnswer,
  type LearnItemInput,
} from "@/lib/learning/learn-queue";

const now = new Date("2026-05-01T12:00:00.000Z");

function makeItems(count: number): LearnItemInput[] {
  return Array.from({ length: count }, (_, idx) => ({
    questionId: `q-${idx + 1}`,
    masteryLevel: "new",
    nextReviewAt: null,
    wrongCount: 0,
  }));
}

describe("Deterministic Adaptive Learn Queue (learn-queue.ts)", () => {
  it("prioritizes overdue/due items, then learning, then new, then familiar, then mastered", () => {
    const items: LearnItemInput[] = [
      { questionId: "mastered-1", masteryLevel: "mastered", nextReviewAt: "2026-06-01T00:00:00.000Z", wrongCount: 0 },
      { questionId: "new-1", masteryLevel: "new", nextReviewAt: null, wrongCount: 0 },
      { questionId: "familiar-1", masteryLevel: "familiar", nextReviewAt: "2026-05-10T00:00:00.000Z", wrongCount: 0 },
      { questionId: "learning-1", masteryLevel: "learning", nextReviewAt: "2026-05-02T00:00:00.000Z", wrongCount: 2 },
      { questionId: "due-1", masteryLevel: "learning", nextReviewAt: "2026-04-29T00:00:00.000Z", wrongCount: 1 },
    ];

    const prioritized = prioritizeLearnQuestions(items, now);
    expect(prioritized.map((i) => i.questionId)).toEqual([
      "due-1",
      "learning-1",
      "new-1",
      "familiar-1",
      "mastered-1",
    ]);
  });

  it("groups items into rounds of configured batch size", () => {
    const state = createLearnQueueState(makeItems(18), { roundSize: 7, now });
    expect(state.roundNumber).toBe(1);
    expect(state.activeQueue).toHaveLength(7);
    expect(state.pendingPool).toHaveLength(11);
    expect(getCurrentLearnCard(state)?.questionId).toBe("q-1");
  });

  it("re-injects a missed question with a spacing gap (3-5 cards later, NOT immediately next)", () => {
    const state = createLearnQueueState(makeItems(8), {
      roundSize: 8,
      reinsertGap: 4,
      now,
    });

    // Miss q-1 (the current head)
    const afterMiss = recordLearnAnswer(state, false);

    // Next card must NOT be q-1
    expect(getCurrentLearnCard(afterMiss)?.questionId).toBe("q-2");
    // q-1 must appear later in the activeQueue at index 4 (after q-2, q-3, q-4, q-5)
    const reinsertedIdx = afterMiss.activeQueue.findIndex((c) => c.questionId === "q-1");
    expect(reinsertedIdx).toBe(4);
    expect(afterMiss.activeQueue[reinsertedIdx].requiredCorrect).toBe(2);
    expect(afterMiss.activeQueue[reinsertedIdx].streakInRound).toBe(0);
    expect(afterMiss.missedQuestionIds).toContain("q-1");
  });

  it("requires 2 consecutive correct answers after a miss before graduating the item from the round", () => {
    let state = createLearnQueueState(makeItems(4), {
      roundSize: 4,
      reinsertGap: 3,
      now,
    });

    // Miss q-1
    state = recordLearnAnswer(state, false);
    // Answer q-2, q-3, q-4 correctly (new items graduate on 2 correct or configured threshold; default 1 for clean, 2 if missed)
    state = recordLearnAnswer(state, true); // q-2
    state = recordLearnAnswer(state, true); // q-3
    state = recordLearnAnswer(state, true); // q-4

    // Now q-1 is back up
    expect(getCurrentLearnCard(state)?.questionId).toBe("q-1");

    // First correct on q-1 should NOT yet finish round because q-1 needs 2 consecutive correct
    state = recordLearnAnswer(state, true);
    expect(state.roundCompleted).toBe(false);
    expect(getCurrentLearnCard(state)?.questionId).toBe("q-1");

    // Second consecutive correct graduates q-1 and completes the round
    state = recordLearnAnswer(state, true);
    expect(state.roundCompleted).toBe(true);
    expect(state.completedQuestionIds).toContain("q-1");
  });

  it("advances smoothly to the next round and computes accurate session stats", () => {
    let state = createLearnQueueState(makeItems(5), {
      roundSize: 3,
      requiredCorrectClean: 1,
      now,
    });

    state = recordLearnAnswer(state, true); // q-1
    state = recordLearnAnswer(state, true); // q-2
    state = recordLearnAnswer(state, true); // q-3

    expect(state.roundCompleted).toBe(true);
    expect(state.sessionCompleted).toBe(false);

    state = advanceLearnRound(state);
    expect(state.roundNumber).toBe(2);
    expect(state.activeQueue).toHaveLength(2);
    expect(getCurrentLearnCard(state)?.questionId).toBe("q-4");

    state = recordLearnAnswer(state, true); // q-4
    state = recordLearnAnswer(state, true); // q-5

    expect(state.roundCompleted).toBe(true);
    expect(state.sessionCompleted).toBe(true);

    const stats = getLearnStats(state);
    expect(stats.totalQuestions).toBe(5);
    expect(stats.completedQuestions).toBe(5);
    expect(stats.totalAnswers).toBe(5);
    expect(stats.correctAnswers).toBe(5);
    expect(stats.accuracyPercent).toBe(100);
  });
});
