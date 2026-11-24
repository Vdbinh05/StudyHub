import { describe, expect, it } from "vitest";
import {
  applyConfidenceToSm2,
  calculateConfidenceNeutralExamScore,
  CONFIDENCE_OPTIONS,
  createInitialV3ProgressState,
  mapKeyToConfidence,
  summarizeConfidenceCalibration,
} from "@/lib/learning/confidence";

describe("Confidence Level & Deterministic SM-2 Integration (V3)", () => {
  const FIXED_NOW = new Date("2026-11-24T12:00:00.000Z");

  it("exposes all 3 confidence options with VI/EN labels and keyboard shortcuts", () => {
    expect(CONFIDENCE_OPTIONS.map((o) => o.level)).toEqual([
      "certain",
      "unsure",
      "guessing",
    ]);
    expect(mapKeyToConfidence("1")).toBe("certain");
    expect(mapKeyToConfidence("C")).toBe("certain");
    expect(mapKeyToConfidence("2")).toBe("unsure");
    expect(mapKeyToConfidence("u")).toBe("unsure");
    expect(mapKeyToConfidence("3")).toBe("guessing");
    expect(mapKeyToConfidence("G")).toBe("guessing");
    expect(mapKeyToConfidence("x")).toBeNull();
  });

  it("correct + certain progresses SM-2 normally and increments independent_recall_count", () => {
    let state = createInitialV3ProgressState();

    // 3 consecutive independent certain recalls -> mastered (1 -> 6 -> 15d)
    const r1 = applyConfidenceToSm2({
      previous: state,
      isCorrect: true,
      confidence: "certain",
      usedHint: false,
      now: FIXED_NOW,
    });
    expect(r1.isIndependentRecall).toBe(true);
    expect(r1.next.independent_recall_count).toBe(1);
    expect(r1.next.interval_days).toBe(1);
    expect(r1.reviewPriorityBoost).toBe(0);
    state = r1.next;

    const r2 = applyConfidenceToSm2({
      previous: state,
      isCorrect: true,
      confidence: "certain",
      usedHint: false,
      now: FIXED_NOW,
    });
    expect(r2.next.interval_days).toBe(6);
    expect(r2.next.independent_recall_count).toBe(2);
    state = r2.next;

    const r3 = applyConfidenceToSm2({
      previous: state,
      isCorrect: true,
      confidence: "certain",
      usedHint: false,
      now: FIXED_NOW,
    });
    expect(r3.next.interval_days).toBeGreaterThanOrEqual(14);
    expect(r3.next.mastery_level).toBe("mastered");
    expect(r3.next.independent_recall_count).toBe(3);
  });

  it("correct + guessing counts as correct, increments guess_correct_count, and NEVER advances to mastered", () => {
    const nearlyMastered = {
      ...createInitialV3ProgressState(),
      mastery_level: "familiar" as const,
      correct_count: 2,
      consecutive_correct: 2,
      repetitions: 2,
      interval_days: 6,
      ease_factor: 2.5,
    };

    const res = applyConfidenceToSm2({
      previous: nearlyMastered,
      isCorrect: true,
      confidence: "guessing",
      now: FIXED_NOW,
    });

    expect(res.next.correct_count).toBe(3); // score still correct!
    expect(res.isGuessHit).toBe(true);
    expect(res.next.guess_correct_count).toBe(1);
    expect(res.next.low_confidence_count).toBe(1);
    expect(res.next.interval_days).toBe(1);
    expect(res.next.mastery_level).not.toBe("mastered");
    expect(res.masteryBlockedReason).toBe("guessing");
    expect(res.next.independent_recall_count).toBe(0);
    expect(res.recommendedReinsertGap).toBe(4);
  });

  it("correct + unsure counts as correct but caps interval <= 4 days and flags extra review", () => {
    const familiar = {
      ...createInitialV3ProgressState(),
      mastery_level: "familiar" as const,
      correct_count: 2,
      consecutive_correct: 2,
      repetitions: 2,
      interval_days: 6,
      ease_factor: 2.5,
    };

    const res = applyConfidenceToSm2({
      previous: familiar,
      isCorrect: true,
      confidence: "unsure",
      now: FIXED_NOW,
    });

    expect(res.next.correct_count).toBe(3);
    expect(res.next.interval_days).toBeLessThanOrEqual(4);
    expect(res.next.mastery_level).not.toBe("mastered");
    expect(res.next.low_confidence_count).toBe(1);
    expect(res.reviewPriorityBoost).toBeGreaterThan(0);
  });

  it("incorrect + certain flags misconception with highest review priority and tightest reinsert gap", () => {
    const res = applyConfidenceToSm2({
      previous: createInitialV3ProgressState(),
      isCorrect: false,
      confidence: "certain",
      now: FIXED_NOW,
    });

    expect(res.isMisconception).toBe(true);
    expect(res.next.high_conf_wrong_count).toBe(1);
    expect(res.next.wrong_count).toBe(1);
    expect(res.next.consecutive_wrong).toBe(1);
    expect(res.next.mistake_status).toBe("active");
    expect(res.reviewPriorityBoost).toBe(100);
    expect(res.recommendedReinsertGap).toBe(2);

    const standardWrong = applyConfidenceToSm2({
      previous: createInitialV3ProgressState(),
      isCorrect: false,
      confidence: "unsure",
      now: FIXED_NOW,
    });
    expect(res.reviewPriorityBoost).toBeGreaterThan(
      standardWrong.reviewPriorityBoost,
    );
    expect(standardWrong.recommendedReinsertGap).toBe(3);
  });

  it("usedHint or isRecognitionOnly blocks promotion to mastered even when certain", () => {
    const ready = {
      ...createInitialV3ProgressState(),
      mastery_level: "familiar" as const,
      correct_count: 2,
      consecutive_correct: 2,
      repetitions: 2,
      interval_days: 6,
      ease_factor: 2.5,
    };

    const withHint = applyConfidenceToSm2({
      previous: ready,
      isCorrect: true,
      confidence: "certain",
      usedHint: true,
      now: FIXED_NOW,
    });
    expect(withHint.next.mastery_level).not.toBe("mastered");
    expect(withHint.next.hint_used_count).toBe(1);
    expect(withHint.masteryBlockedReason).toBe("hint_used");

    const recogOnly = applyConfidenceToSm2({
      previous: ready,
      isCorrect: true,
      confidence: "certain",
      isRecognitionOnly: true,
      now: FIXED_NOW,
    });
    expect(recogOnly.next.mastery_level).not.toBe("mastered");
    expect(recogOnly.masteryBlockedReason).toBe("recognition_only");
  });

  it("P0 INVARIANT: confidence NEVER changes exam score or pass/fail outcome", () => {
    const allCertain = calculateConfidenceNeutralExamScore(
      [
        { isCorrect: true, confidence: "certain" },
        { isCorrect: true, confidence: "certain" },
        { isCorrect: true, confidence: "certain" },
        { isCorrect: false, confidence: "certain" },
      ],
      70,
    );
    const allGuessing = calculateConfidenceNeutralExamScore(
      [
        { isCorrect: true, confidence: "guessing" },
        { isCorrect: true, confidence: "unsure" },
        { isCorrect: true, confidence: "guessing" },
        { isCorrect: false, confidence: "guessing" },
      ],
      70,
    );
    const noConfidence = calculateConfidenceNeutralExamScore(
      [
        { isCorrect: true, confidence: null },
        { isCorrect: true, confidence: null },
        { isCorrect: true, confidence: null },
        { isCorrect: false, confidence: null },
      ],
      70,
    );

    expect(allGuessing).toEqual(allCertain);
    expect(noConfidence).toEqual(allCertain);
    expect(allCertain).toEqual({
      total: 4,
      correct: 3,
      scorePercent: 75,
      passed: true,
    });
  });

  it("summarizes metacognitive calibration accurately", () => {
    const summary = summarizeConfidenceCalibration([
      { confidence: "certain", isCorrect: true },
      { confidence: "certain", isCorrect: false },
      { confidence: "unsure", isCorrect: true },
      { confidence: "guessing", isCorrect: true },
      { confidence: "guessing", isCorrect: false },
      { confidence: null, isCorrect: true },
    ]);

    expect(summary.totalTagged).toBe(5);
    expect(summary.untagged).toBe(1);
    expect(summary.misconceptionCount).toBe(1);
    expect(summary.guessingHitCount).toBe(1);
    expect(summary.fragileCorrectCount).toBe(1);
    expect(summary.overconfidenceRate).toBe(50);
    expect(summary.certain.accuracyPercent).toBe(50);
    expect(summary.guessing.accuracyPercent).toBe(50);
  });
});
