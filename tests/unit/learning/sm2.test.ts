import { describe, expect, it } from "vitest";
import {
  calculateNextReview,
  createInitialProgressState,
  deriveMasteryLevel,
  isQuestionDue,
  ratingToQuality,
  summarizeMastery,
} from "@/lib/learning/sm2";

describe("SM-2 Spaced Repetition Engine (sm2.ts)", () => {
  const baseNow = new Date("2026-05-01T10:00:00.000Z");

  it("maps SelfRating and boolean outcomes deterministically to SM-2 quality", () => {
    expect(ratingToQuality("again")).toBe(1);
    expect(ratingToQuality("hard")).toBe(3);
    expect(ratingToQuality("good")).toBe(4);
    expect(ratingToQuality("easy")).toBe(5);
    expect(ratingToQuality(false)).toBe(1);
    expect(ratingToQuality(true)).toBe(4);
  });

  it("NEVER marks a question as mastered after a single correct answer (even 'easy')", () => {
    const initial = createInitialProgressState();
    const afterOneGood = calculateNextReview(initial, "good", baseNow);
    const afterOneEasy = calculateNextReview(initial, "easy", baseNow);

    expect(afterOneGood.consecutive_correct).toBe(1);
    expect(afterOneGood.interval_days).toBe(1);
    expect(afterOneGood.mastery_level).toBe("learning");
    expect(afterOneGood.mastery_level).not.toBe("mastered");

    expect(afterOneEasy.consecutive_correct).toBe(1);
    expect(afterOneEasy.interval_days).toBe(1);
    expect(afterOneEasy.mastery_level).toBe("learning");
    expect(afterOneEasy.mastery_level).not.toBe("mastered");
  });

  it("progresses deterministically: new -> learning -> familiar -> mastered over 3 consecutive 'good' reviews", () => {
    let state = createInitialProgressState();
    expect(state.mastery_level).toBe("new");

    // Review 1: good (q=4) -> rep 1, interval 1, consec 1 -> learning
    state = calculateNextReview(state, "good", baseNow);
    expect(state.correct_count).toBe(1);
    expect(state.wrong_count).toBe(0);
    expect(state.repetitions).toBe(1);
    expect(state.interval_days).toBe(1);
    expect(state.ease_factor).toBe(2.5);
    expect(state.mastery_level).toBe("learning");
    expect(state.next_review_at).toBe("2026-05-02T10:00:00.000Z");

    // Review 2: good (q=4) -> rep 2, interval 6, consec 2 -> familiar
    const day2 = new Date("2026-05-02T10:00:00.000Z");
    state = calculateNextReview(state, "good", day2);
    expect(state.correct_count).toBe(2);
    expect(state.repetitions).toBe(2);
    expect(state.interval_days).toBe(6);
    expect(state.consecutive_correct).toBe(2);
    expect(state.mastery_level).toBe("familiar");
    expect(state.next_review_at).toBe("2026-05-08T10:00:00.000Z");

    // Review 3: good (q=4) -> rep 3, interval round(6 * 2.5) = 15 >= 14, consec 3 -> mastered
    const day8 = new Date("2026-05-08T10:00:00.000Z");
    state = calculateNextReview(state, "good", day8);
    expect(state.correct_count).toBe(3);
    expect(state.repetitions).toBe(3);
    expect(state.interval_days).toBe(15);
    expect(state.consecutive_correct).toBe(3);
    expect(state.mastery_level).toBe("mastered");
  });

  it("resets consecutive_correct, repetitions, and interval_days to 1 on wrong answer while preserving history", () => {
    let state = createInitialProgressState();
    state = calculateNextReview(state, "good", baseNow);
    state = calculateNextReview(state, "good", baseNow);
    state = calculateNextReview(state, "good", baseNow);
    expect(state.mastery_level).toBe("mastered");

    const afterMiss = calculateNextReview(state, "again", baseNow);
    expect(afterMiss.correct_count).toBe(3);
    expect(afterMiss.wrong_count).toBe(1);
    expect(afterMiss.consecutive_correct).toBe(0);
    expect(afterMiss.repetitions).toBe(0);
    expect(afterMiss.interval_days).toBe(1);
    expect(afterMiss.mastery_level).toBe("learning");
    expect(afterMiss.ease_factor).toBeLessThan(state.ease_factor);
  });

  it("enforces ease_factor floor of 1.30 and ceiling of 4.00", () => {
    let low = createInitialProgressState();
    for (let i = 0; i < 20; i++) {
      low = calculateNextReview(low, "again", baseNow);
    }
    expect(low.ease_factor).toBe(1.3);

    let high = createInitialProgressState();
    for (let i = 0; i < 30; i++) {
      high = calculateNextReview(high, "easy", baseNow);
    }
    expect(high.ease_factor).toBe(4);
  });

  it("derives mastery levels strictly according to PRD §4.1 rules", () => {
    expect(
      deriveMasteryLevel({
        correct_count: 0,
        wrong_count: 0,
        consecutive_correct: 0,
        interval_days: 0,
      }),
    ).toBe("new");

    expect(
      deriveMasteryLevel({
        correct_count: 1,
        wrong_count: 0,
        consecutive_correct: 1,
        interval_days: 1,
      }),
    ).toBe("learning");

    expect(
      deriveMasteryLevel({
        correct_count: 2,
        wrong_count: 0,
        consecutive_correct: 2,
        interval_days: 6,
      }),
    ).toBe("familiar");

    // 3 consecutive correct with interval < 14 stays familiar until interval >= 14
    expect(
      deriveMasteryLevel({
        correct_count: 3,
        wrong_count: 0,
        consecutive_correct: 3,
        interval_days: 13,
      }),
    ).toBe("familiar");

    expect(
      deriveMasteryLevel({
        correct_count: 3,
        wrong_count: 0,
        consecutive_correct: 3,
        interval_days: 14,
      }),
    ).toBe("mastered");
  });

  it("checks due status and summarizes mastery counts accurately", () => {
    const dueItem = {
      ...createInitialProgressState(),
      mastery_level: "learning" as const,
      next_review_at: "2026-05-01T09:00:00.000Z",
    };
    const futureItem = {
      ...createInitialProgressState(),
      mastery_level: "mastered" as const,
      next_review_at: "2026-05-10T10:00:00.000Z",
    };
    const newItem = createInitialProgressState();

    expect(isQuestionDue(dueItem, baseNow)).toBe(true);
    expect(isQuestionDue(futureItem, baseNow)).toBe(false);
    expect(isQuestionDue(newItem, baseNow)).toBe(false);

    const summary = summarizeMastery([dueItem, futureItem, newItem], baseNow);
    expect(summary).toEqual({
      total: 3,
      new: 1,
      learning: 1,
      familiar: 0,
      mastered: 1,
      due: 1,
    });
  });
});
