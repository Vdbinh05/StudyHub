import { describe, expect, it } from "vitest";
import {
  calculateRemainingMs,
  formatCountdownMs,
  gradeExamQuestion,
  isExamExpired,
  normalizeMatchingExamPayload,
  sanitizeExamQuestionsForClient,
  scoreExamAttempt,
} from "@/lib/learning/exam-scoring";
import { createSeededRng, shuffleOptions } from "@/lib/learning/shuffle";
import type { ExamAttemptAnswer, ExamSnapshotQuestion } from "@/types/domain";

function makeSnapshotQuestion(
  overrides: Partial<ExamSnapshotQuestion> = {},
): ExamSnapshotQuestion {
  return {
    id: "aq-1",
    attempt_id: "att-1",
    question_id: "q-1",
    position: 0,
    question_type: "single_choice",
    chapter_snapshot: "Chương 1",
    prompt_snapshot: "Thủ đô của Việt Nam là gì?",
    prompt_image_url_snapshot: null,
    options_snapshot: [
      { id: "opt-a", label: "A", content: "TP.HCM", image_url: null, position: 0 },
      { id: "opt-b", label: "B", content: "Hà Nội", image_url: null, position: 1 },
      { id: "opt-c", label: "C", content: "Đà Nẵng", image_url: null, position: 2 },
    ],
    correct_option_ids: ["opt-b"],
    accepted_answers_snapshot: [],
    explanation_snapshot: "Hà Nội là thủ đô của nước CHXHCN Việt Nam.",
    created_at: "2026-05-01T10:00:00.000Z",
    ...overrides,
  };
}

describe("Deterministic Exam Scoring & Wall-Clock Timer Engine (exam-scoring.ts)", () => {
  it("grades single_choice and multiple_choice strictly by stable option UUID regardless of option shuffling", () => {
    const q1 = makeSnapshotQuestion();
    // Shuffle options_snapshot order and relabel A/B/C
    const shuffled = shuffleOptions(q1.options_snapshot, createSeededRng("shuffle-exam-1"));
    const shuffledQ1: ExamSnapshotQuestion = {
      ...q1,
      options_snapshot: shuffled.map((o, i) => ({
        id: o.id,
        label: o.displayLabel,
        content: o.content,
        image_url: o.image_url,
        position: i,
      })),
    };

    // Selecting Hà Nội's UUID ("opt-b") is ALWAYS correct regardless of display position
    const resCorrect = gradeExamQuestion(shuffledQ1, {
      selected_option_ids: ["opt-b"],
      typed_answer: null,
    });
    expect(resCorrect.isCorrect).toBe(true);
    expect(resCorrect.isUnanswered).toBe(false);

    // Selecting wrong UUID is always wrong
    const resWrong = gradeExamQuestion(shuffledQ1, {
      selected_option_ids: ["opt-a"],
      typed_answer: null,
    });
    expect(resWrong.isCorrect).toBe(false);

    // Multiple choice requires exact UUID set match
    const multiQ = makeSnapshotQuestion({
      id: "aq-multi",
      question_type: "multiple_choice",
      correct_option_ids: ["opt-a", "opt-c"],
    });
    expect(
      gradeExamQuestion(multiQ, {
        selected_option_ids: ["opt-c", "opt-a"],
        typed_answer: null,
      }).isCorrect,
    ).toBe(true);
    expect(
      gradeExamQuestion(multiQ, {
        selected_option_ids: ["opt-a"],
        typed_answer: null,
      }).isCorrect,
    ).toBe(false);
  });

  it("grades short_answer deterministically using accepted_answers_snapshot", () => {
    const shortQ = makeSnapshotQuestion({
      id: "aq-short",
      question_type: "short_answer",
      options_snapshot: [],
      correct_option_ids: [],
      accepted_answers_snapshot: [
        { answer_text: "H2O", normalized_answer: "h2o", match_mode: "case_insensitive" },
      ],
    });

    expect(
      gradeExamQuestion(shortQ, { selected_option_ids: [], typed_answer: " h2o " }).isCorrect,
    ).toBe(true);
    expect(
      gradeExamQuestion(shortQ, { selected_option_ids: [], typed_answer: "CO2" }).isCorrect,
    ).toBe(false);
    expect(
      gradeExamQuestion(shortQ, { selected_option_ids: [], typed_answer: "   " }).isUnanswered,
    ).toBe(true);
  });

  it("computes exam score, pass/fail status, and chapter-level accuracy breakdown accurately", () => {
    const questions: ExamSnapshotQuestion[] = [
      makeSnapshotQuestion({ id: "aq-1", position: 0, chapter_snapshot: "Chương 1", correct_option_ids: ["opt-b"] }),
      makeSnapshotQuestion({ id: "aq-2", position: 1, chapter_snapshot: "Chương 1", correct_option_ids: ["opt-a"] }),
      makeSnapshotQuestion({ id: "aq-3", position: 2, chapter_snapshot: "Chương 2", correct_option_ids: ["opt-c"] }),
      makeSnapshotQuestion({ id: "aq-4", position: 3, chapter_snapshot: "Chương 2", correct_option_ids: ["opt-b"] }),
    ];

    const answers: ExamAttemptAnswer[] = [
      {
        id: "ans-1",
        attempt_id: "att-1",
        attempt_question_id: "aq-1",
        user_id: "u-1",
        selected_option_ids: ["opt-b"], // correct
        typed_answer: null,
        is_flagged: false,
        is_correct: null,
        updated_at: "2026-05-01T10:01:00.000Z",
      },
      {
        id: "ans-2",
        attempt_id: "att-1",
        attempt_question_id: "aq-2",
        user_id: "u-1",
        selected_option_ids: ["opt-c"], // wrong
        typed_answer: null,
        is_flagged: true,
        is_correct: null,
        updated_at: "2026-05-01T10:02:00.000Z",
      },
      {
        id: "ans-3",
        attempt_id: "att-1",
        attempt_question_id: "aq-3",
        user_id: "u-1",
        selected_option_ids: ["opt-c"], // correct
        typed_answer: null,
        is_flagged: false,
        is_correct: null,
        updated_at: "2026-05-01T10:03:00.000Z",
      },
      // aq-4 unanswered
    ];

    const summary = scoreExamAttempt(questions, answers, 50);
    expect(summary.totalQuestions).toBe(4);
    expect(summary.answeredCount).toBe(3);
    expect(summary.correctCount).toBe(2);
    expect(summary.wrongCount).toBe(1);
    expect(summary.unansweredCount).toBe(1);
    expect(summary.scorePercent).toBe(50);
    expect(summary.passed).toBe(true);

    // Chapter breakdown
    expect(summary.chapterBreakdown).toEqual([
      {
        chapter: "Chương 1",
        total: 2,
        correct: 1,
        wrong: 1,
        unanswered: 0,
        accuracyPercent: 50,
      },
      {
        chapter: "Chương 2",
        total: 2,
        correct: 1,
        wrong: 0,
        unanswered: 1,
        accuracyPercent: 50,
      },
    ]);

    // With higher pass threshold (70%), same attempt fails
    expect(scoreExamAttempt(questions, answers, 70).passed).toBe(false);
  });

  it("computes remaining countdown strictly from wall-clock expires_at (survives refresh & detects expiry)", () => {
    const expiresAt = "2026-05-01T10:45:00.000Z";
    const before = Date.parse("2026-05-01T10:30:00.000Z");
    const after = Date.parse("2026-05-01T10:46:00.000Z");

    expect(calculateRemainingMs(expiresAt, before)).toBe(15 * 60 * 1000);
    expect(isExamExpired(expiresAt, before)).toBe(false);
    expect(formatCountdownMs(15 * 60 * 1000)).toBe("15:00");
    expect(formatCountdownMs(3661 * 1000)).toBe("01:01:01");

    // Server clock offset (+5s means server is 5s ahead of client -> 5s less remaining)
    expect(calculateRemainingMs(expiresAt, before, 5_000)).toBe(15 * 60 * 1000 - 5_000);

    // Expired clamps to 0
    expect(calculateRemainingMs(expiresAt, after)).toBe(0);
    expect(isExamExpired(expiresAt, after)).toBe(true);

    // Untimed exam returns null
    expect(calculateRemainingMs(null, before)).toBeNull();
    expect(isExamExpired(null, after)).toBe(false);
  });

  it("strips all answer secrets pre-submit via sanitizeExamQuestionsForClient", () => {
    const q = makeSnapshotQuestion();
    const sanitized = sanitizeExamQuestionsForClient([q]);
    expect(sanitized).toHaveLength(1);
    expect("correct_option_ids" in sanitized[0]).toBe(false);
    expect("accepted_answers_snapshot" in sanitized[0]).toBe(false);
    expect("explanation_snapshot" in sanitized[0]).toBe(false);
    for (const opt of sanitized[0].options_snapshot) {
      expect("is_correct" in opt).toBe(false);
    }
  });

  it("computes true weighted overall accuracy (NEVER unweighted average of subject percentages) and subject/tag breakdowns", () => {
    // Subject A: 9 questions (all 9 correct -> 100%)
    // Subject B: 1 question (0 correct -> 0%)
    // True weighted overall = 9/10 = 90%, NOT unweighted avg (100% + 0%) / 2 = 50%!
    const questions: ExamSnapshotQuestion[] = [
      ...Array.from({ length: 9 }, (_, i) =>
        makeSnapshotQuestion({
          id: `aq-a-${i}`,
          position: i,
          source_study_set_id: "set-a",
          source_subject_title: "Principles of Flight",
          chapter_snapshot: "Lift",
          tags_snapshot: [{ id: "tag-aero", name: "Aero" }],
          correct_option_ids: ["opt-b"],
        }),
      ),
      makeSnapshotQuestion({
        id: "aq-b-0",
        position: 9,
        source_study_set_id: "set-b",
        source_subject_title: "Meteorology",
        chapter_snapshot: "Clouds",
        tags_snapshot: [{ id: "tag-met", name: "Met" }],
        correct_option_ids: ["opt-b"],
      }),
    ];

    const answers: ExamAttemptAnswer[] = [
      ...Array.from({ length: 9 }, (_, i) => ({
        id: `ans-a-${i}`,
        attempt_id: "att-mix",
        attempt_question_id: `aq-a-${i}`,
        user_id: "u-1",
        selected_option_ids: ["opt-b"],
        typed_answer: null,
        is_flagged: false,
        is_correct: null,
        updated_at: "2026-05-01T10:01:00.000Z",
      })),
      {
        id: "ans-b-0",
        attempt_id: "att-mix",
        attempt_question_id: "aq-b-0",
        user_id: "u-1",
        selected_option_ids: ["opt-a"], // wrong
        typed_answer: null,
        is_flagged: false,
        is_correct: null,
        updated_at: "2026-05-01T10:02:00.000Z",
      },
    ];

    const summary = scoreExamAttempt(questions, answers, 70);
    expect(summary.scorePercent).toBe(90);
    expect(summary.passed).toBe(true);
    expect(summary.subjectBreakdown).toEqual([
      {
        studySetId: "set-a",
        subjectTitle: "Principles of Flight",
        total: 9,
        correct: 9,
        wrong: 0,
        unanswered: 0,
        accuracyPercent: 100,
      },
      {
        studySetId: "set-b",
        subjectTitle: "Meteorology",
        total: 1,
        correct: 0,
        wrong: 1,
        unanswered: 0,
        accuracyPercent: 0,
      },
    ]);
    expect(summary.tagBreakdown).toHaveLength(2);
  });

  it("rejects single_choice with multiple crafted option UUIDs and grades numeric 0/10/100 accurately", () => {
    const sc = makeSnapshotQuestion({
      id: "aq-sc",
      question_type: "single_choice",
      correct_option_ids: ["opt-b"],
    });
    expect(
      gradeExamQuestion(sc, { selected_option_ids: ["opt-b", "opt-a"] }).isCorrect,
    ).toBe(false);

    const numZero = makeSnapshotQuestion({
      id: "aq-num-0",
      question_type: "short_answer",
      options_snapshot: [],
      correct_option_ids: [],
      accepted_answers_snapshot: [
        { answer_text: "0", normalized_answer: "0", match_mode: "numeric" },
      ],
    });
    expect(gradeExamQuestion(numZero, { typed_answer: "0" }).isCorrect).toBe(true);
    expect(gradeExamQuestion(numZero, { typed_answer: "0.00" }).isCorrect).toBe(true);

    const numHundred = makeSnapshotQuestion({
      id: "aq-num-100",
      question_type: "short_answer",
      options_snapshot: [],
      correct_option_ids: [],
      accepted_answers_snapshot: [
        { answer_text: "100", normalized_answer: "100", match_mode: "numeric" },
      ],
    });
    expect(gradeExamQuestion(numHundred, { typed_answer: "1" }).isCorrect).toBe(false);
    expect(gradeExamQuestion(numHundred, { typed_answer: "100.0" }).isCorrect).toBe(
      true,
    );
  });

  it("normalizes both pre-submit sanitized matching payloads (left_items/right_items) and post-submit pairs without throwing (V3-UX-05)", () => {
    // Pre-submit anti-leak shape from PostgreSQL sanitize_pre_submit_type_payload (NO `pairs` field!)
    const preSubmit = normalizeMatchingExamPayload({
      type: "matching",
      left_items: [
        { id: "p1", left_text: "METAR", left_rich_text: null, left_image_url: null },
        { id: "p2", left_text: "TAF", left_rich_text: null, left_image_url: null },
      ],
      right_items: [
        { right_id: "r2", right_text: "Forecast", right_rich_text: null, right_image_url: null },
        { right_id: "r1", right_text: "Observation", right_rich_text: null, right_image_url: null },
      ],
    });
    expect(preSubmit.leftItems).toHaveLength(2);
    expect(preSubmit.leftItems[0]).toMatchObject({ id: "p1", left_text: "METAR" });
    expect(preSubmit.rightItems).toHaveLength(2);
    expect(preSubmit.rightItems[0]).toMatchObject({ right_id: "r2", right_text: "Forecast" });

    // Post-submit / stored DB shape with pairs + distractors
    const postSubmit = normalizeMatchingExamPayload({
      type: "matching",
      pairs: [
        { id: "p1", left_text: "Lift", right_id: "r1", right_text: "Upward force" },
      ],
      distractors: [{ right_id: "d1", right_text: "Distractor" }],
    });
    expect(postSubmit.leftItems).toHaveLength(1);
    expect(postSubmit.rightItems.map((r) => r.right_id)).toEqual(["r1", "d1"]);

    // Null/malformed defensive safety
    expect(normalizeMatchingExamPayload(null)).toEqual({
      leftItems: [],
      rightItems: [],
    });
    expect(normalizeMatchingExamPayload({ type: "matching" })).toEqual({
      leftItems: [],
      rightItems: [],
    });
  });
});
