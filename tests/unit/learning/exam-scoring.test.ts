import { describe, expect, it } from "vitest";
import {
  calculateRemainingMs,
  formatCountdownMs,
  gradeExamQuestion,
  isExamExpired,
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
});
