import type {
  ExamAttemptAnswer,
  ExamSnapshotOption,
  ExamSnapshotQuestion,
} from "@/types/domain";
import { gradeChoiceSelection } from "./shuffle";
import { gradeWriteAnswer } from "./write-grader";

export interface ExamAnswerInput {
  selected_option_ids?: readonly string[] | null;
  typed_answer?: string | null;
}

export interface ExamQuestionGradeResult {
  attemptQuestionId: string;
  isCorrect: boolean;
  isUnanswered: boolean;
}

export interface ChapterAccuracyBreakdown {
  chapter: string;
  total: number;
  correct: number;
  wrong: number;
  unanswered: number;
  accuracyPercent: number;
}

export interface ExamScoreSummary {
  totalQuestions: number;
  answeredCount: number;
  correctCount: number;
  wrongCount: number;
  unansweredCount: number;
  scorePercent: number;
  passed: boolean;
  perQuestionResults: ExamQuestionGradeResult[];
  chapterBreakdown: ChapterAccuracyBreakdown[];
}

export type SanitizedExamSnapshotQuestion = Omit<
  ExamSnapshotQuestion,
  "correct_option_ids" | "accepted_answers_snapshot" | "explanation_snapshot"
>;

/**
 * Deterministically grade a single snapshotted exam question.
 * Choice questions are ALWAYS graded by stable option UUID (never display letter or index).
 */
export function gradeExamQuestion(
  question: ExamSnapshotQuestion,
  answer: ExamAnswerInput | null | undefined,
): ExamQuestionGradeResult {
  if (question.question_type === "short_answer") {
    const typed = answer?.typed_answer?.trim() ?? "";
    if (!typed) {
      return {
        attemptQuestionId: question.id,
        isCorrect: false,
        isUnanswered: true,
      };
    }
    const accepted = question.accepted_answers_snapshot ?? [];
    const writeResult = gradeWriteAnswer(typed, accepted, { strict: false });
    return {
      attemptQuestionId: question.id,
      isCorrect: writeResult.isCorrect,
      isUnanswered: false,
    };
  }

  const selected = (answer?.selected_option_ids ?? []).filter(Boolean);
  if (selected.length === 0) {
    return {
      attemptQuestionId: question.id,
      isCorrect: false,
      isUnanswered: true,
    };
  }

  const correctIds = question.correct_option_ids ?? [];
  const isCorrect = gradeChoiceSelection(selected, correctIds);

  return {
    attemptQuestionId: question.id,
    isCorrect,
    isUnanswered: false,
  };
}

/**
 * Score a complete exam attempt and compute chapter-level accuracy breakdown.
 */
export function scoreExamAttempt(
  questions: readonly ExamSnapshotQuestion[],
  answers: readonly ExamAttemptAnswer[],
  passThreshold: number = 70,
  uncategorizedLabel: string = "Khác",
): ExamScoreSummary {
  const answerMap = new Map<string, ExamAttemptAnswer>();
  for (const ans of answers) {
    answerMap.set(ans.attempt_question_id, ans);
  }

  const perQuestionResults: ExamQuestionGradeResult[] = [];
  const chapterMap = new Map<string, ChapterAccuracyBreakdown>();

  let answeredCount = 0;
  let correctCount = 0;
  let wrongCount = 0;
  let unansweredCount = 0;

  for (const question of questions) {
    const answer = answerMap.get(question.id);
    const result = gradeExamQuestion(question, answer);
    perQuestionResults.push(result);

    const chapterKey = question.chapter_snapshot?.trim() || uncategorizedLabel;
    let bucket = chapterMap.get(chapterKey);
    if (!bucket) {
      bucket = {
        chapter: chapterKey,
        total: 0,
        correct: 0,
        wrong: 0,
        unanswered: 0,
        accuracyPercent: 0,
      };
      chapterMap.set(chapterKey, bucket);
    }

    bucket.total += 1;

    if (result.isUnanswered) {
      unansweredCount += 1;
      bucket.unanswered += 1;
    } else {
      answeredCount += 1;
      if (result.isCorrect) {
        correctCount += 1;
        bucket.correct += 1;
      } else {
        wrongCount += 1;
        bucket.wrong += 1;
      }
    }
  }

  const totalQuestions = questions.length;
  const scorePercent =
    totalQuestions === 0
      ? 0
      : Math.round((correctCount / totalQuestions) * 10_000) / 100;

  const chapterBreakdown = Array.from(chapterMap.values()).map((bucket) => ({
    ...bucket,
    accuracyPercent:
      bucket.total === 0
        ? 0
        : Math.round((bucket.correct / bucket.total) * 100),
  }));

  return {
    totalQuestions,
    answeredCount,
    correctCount,
    wrongCount,
    unansweredCount,
    scorePercent,
    passed: scorePercent >= passThreshold,
    perQuestionResults,
    chapterBreakdown,
  };
}

/**
 * Compute remaining exam time strictly from wall-clock `expires_at` ISO timestamp.
 * Never relies on decrementing a tick counter — survives browser refresh and tab throttling cleanly.
 * `serverClockOffsetMs` = serverNowMs - clientNowMs at sync time.
 */
export function calculateRemainingMs(
  expiresAtIso: string | null | undefined,
  nowMs: number = Date.now(),
  serverClockOffsetMs: number = 0,
): number | null {
  if (!expiresAtIso) return null;
  const expiresMs = Date.parse(expiresAtIso);
  if (Number.isNaN(expiresMs)) return null;
  const adjustedNow = nowMs + serverClockOffsetMs;
  return Math.max(0, expiresMs - adjustedNow);
}

/**
 * Check whether an exam has expired based on server wall-clock `expires_at`.
 */
export function isExamExpired(
  expiresAtIso: string | null | undefined,
  nowMs: number = Date.now(),
  serverClockOffsetMs: number = 0,
): boolean {
  const remaining = calculateRemainingMs(expiresAtIso, nowMs, serverClockOffsetMs);
  return remaining !== null && remaining <= 0;
}

/**
 * Format remaining milliseconds as MM:SS or HH:MM:SS (rounding up partial seconds so 00:00 means truly expired).
 */
export function formatCountdownMs(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");

  if (hours > 0) {
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Strip all sensitive answer fields from snapshotted exam questions before sending to client pre-submit.
 */
export function sanitizeExamQuestionsForClient(
  questions: readonly ExamSnapshotQuestion[],
): SanitizedExamSnapshotQuestion[] {
  return questions.map((q) => {
    const cleanOptions: ExamSnapshotOption[] = q.options_snapshot.map((opt) => ({
      id: opt.id,
      label: opt.label,
      content: opt.content,
      image_url: opt.image_url,
      position: opt.position,
    }));

    return {
      id: q.id,
      attempt_id: q.attempt_id,
      question_id: q.question_id,
      position: q.position,
      question_type: q.question_type,
      chapter_snapshot: q.chapter_snapshot,
      prompt_snapshot: q.prompt_snapshot,
      prompt_image_url_snapshot: q.prompt_image_url_snapshot,
      options_snapshot: cleanOptions,
      created_at: q.created_at,
    };
  });
}
