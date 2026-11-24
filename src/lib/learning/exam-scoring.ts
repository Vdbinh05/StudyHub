import type {
  AnswerMatchMode,
  ExamAttemptAnswer,
  ExamSnapshotOption,
  ExamSnapshotQuestion,
  ExamTagSnapshot,
} from "@/types/domain";
import { gradeChoiceSelection } from "./shuffle";
import { normalizeShortAnswerSqlCompatible } from "./write-grader";

export interface ExamAnswerInput {
  selected_option_ids?: readonly string[] | null;
  typed_answer?: string | null;
}

export interface ExamQuestionGradeResult {
  attemptQuestionId: string;
  isCorrect: boolean;
  isUnanswered: boolean;
}

export type ExamTagSnapshotItem = ExamTagSnapshot;

/**
 * Extended snapshot shape carrying optional V2.0 multi-subject & tag attribution.
 * Backwards-compatible with V1.0 `ExamSnapshotQuestion`.
 */
export type ExtendedExamSnapshotQuestion = ExamSnapshotQuestion;

export interface SubjectAccuracyBreakdown {
  studySetId: string | null;
  subjectTitle: string;
  total: number;
  correct: number;
  wrong: number;
  unanswered: number;
  accuracyPercent: number;
}

export interface ChapterAccuracyBreakdown {
  chapter: string;
  studySetId?: string | null;
  subjectTitle?: string | null;
  total: number;
  correct: number;
  wrong: number;
  unanswered: number;
  accuracyPercent: number;
}

export interface TagAccuracyBreakdown {
  tagId: string;
  tagName: string;
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
  /** True weighted overall accuracy = (correctCount / totalQuestions) * 100. NEVER unweighted average of subject percentages! */
  scorePercent: number;
  passed: boolean;
  perQuestionResults: ExamQuestionGradeResult[];
  subjectBreakdown: SubjectAccuracyBreakdown[];
  chapterBreakdown: ChapterAccuracyBreakdown[];
  tagBreakdown: TagAccuracyBreakdown[];
}

export type SanitizedExamSnapshotQuestion = Omit<
  ExtendedExamSnapshotQuestion,
  "correct_option_ids" | "accepted_answers_snapshot" | "explanation_snapshot"
>;

/**
 * Round percentage deterministically to 2 decimal places (`totalCorrect / totalQuestions * 100`).
 */
export function calculateWeightedAccuracyPercent(
  correctCount: number,
  totalQuestions: number,
): number {
  if (totalQuestions <= 0 || correctCount <= 0) return 0;
  return Math.round((correctCount / totalQuestions) * 10_000) / 100;
}

/**
 * Deterministically grade a single snapshotted exam question aligned 1:1 with `0005` SQL `submit_exam_attempt()`.
 * - Choice questions are ALWAYS graded by stable option UUID (never display letter or index).
 * - `single_choice` and `true_false` strictly require exactly 1 distinct selected option UUID.
 * - `short_answer` uses `normalizeShortAnswerSqlCompatible` matching PostgreSQL `trim_scale()` & diacritic rules 1:1.
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
    let isCorrect = false;
    for (const acc of accepted) {
      const mode: AnswerMatchMode = acc.match_mode ?? "case_insensitive";
      const userNorm = normalizeShortAnswerSqlCompatible(typed, mode);
      const targetNorm = normalizeShortAnswerSqlCompatible(
        acc.answer_text,
        mode,
      );
      if (userNorm.length > 0 && targetNorm.length > 0 && userNorm === targetNorm) {
        isCorrect = true;
        break;
      }
    }

    return {
      attemptQuestionId: question.id,
      isCorrect,
      isUnanswered: false,
    };
  }

  const distinctSelected = Array.from(
    new Set((answer?.selected_option_ids ?? []).filter(Boolean)),
  );
  if (distinctSelected.length === 0) {
    return {
      attemptQuestionId: question.id,
      isCorrect: false,
      isUnanswered: true,
    };
  }

  // Single-choice / True-False guard: never pass if >1 option UUID was crafted
  if (
    (question.question_type === "single_choice" ||
      question.question_type === "true_false") &&
    distinctSelected.length > 1
  ) {
    return {
      attemptQuestionId: question.id,
      isCorrect: false,
      isUnanswered: false,
    };
  }

  const correctIds = question.correct_option_ids ?? [];
  const isCorrect = gradeChoiceSelection(distinctSelected, correctIds);

  return {
    attemptQuestionId: question.id,
    isCorrect,
    isUnanswered: false,
  };
}

/**
 * Score a complete exam attempt and compute weighted overall accuracy,
 * per-subject accuracy, per-chapter accuracy, and per-tag accuracy breakdowns.
 * Overall accuracy is ALWAYS `totalCorrect / totalQuestions` — NEVER unweighted average of subject percentages.
 */
export function scoreExamAttempt(
  questions: readonly ExtendedExamSnapshotQuestion[],
  answers: readonly ExamAttemptAnswer[],
  passThreshold: number = 70,
  uncategorizedLabel: string = "Khác",
  defaultSubjectLabel: string = "Chung",
): ExamScoreSummary {
  const answerMap = new Map<string, ExamAttemptAnswer>();
  for (const ans of answers) {
    answerMap.set(ans.attempt_question_id, ans);
  }

  const perQuestionResults: ExamQuestionGradeResult[] = [];
  const subjectMap = new Map<string, SubjectAccuracyBreakdown>();
  const chapterMap = new Map<string, ChapterAccuracyBreakdown>();
  const tagMap = new Map<string, TagAccuracyBreakdown>();

  let answeredCount = 0;
  let correctCount = 0;
  let wrongCount = 0;
  let unansweredCount = 0;

  for (const question of questions) {
    const answer = answerMap.get(question.id);
    const computed = gradeExamQuestion(question, answer);

    // If server already graded this answer (`is_correct` boolean present & not unanswered), honor server authority
    const isUnanswered = computed.isUnanswered;
    const isCorrect =
      !isUnanswered && typeof answer?.is_correct === "boolean"
        ? answer.is_correct
        : computed.isCorrect;

    perQuestionResults.push({
      attemptQuestionId: question.id,
      isCorrect,
      isUnanswered,
    });

    // Subject bucket
    const subjectId = question.source_study_set_id ?? null;
    const subjectTitle =
      question.source_subject_title?.trim() || defaultSubjectLabel;
    const subjectKey = subjectId ?? `title::${subjectTitle}`;
    let subjectBucket = subjectMap.get(subjectKey);
    if (!subjectBucket) {
      subjectBucket = {
        studySetId: subjectId,
        subjectTitle,
        total: 0,
        correct: 0,
        wrong: 0,
        unanswered: 0,
        accuracyPercent: 0,
      };
      subjectMap.set(subjectKey, subjectBucket);
    }
    subjectBucket.total += 1;

    // Chapter bucket
    const chapterKey = question.chapter_snapshot?.trim() || uncategorizedLabel;
    let chapterBucket = chapterMap.get(chapterKey);
    if (!chapterBucket) {
      chapterBucket = {
        chapter: chapterKey,
        total: 0,
        correct: 0,
        wrong: 0,
        unanswered: 0,
        accuracyPercent: 0,
      };
      chapterMap.set(chapterKey, chapterBucket);
    }
    chapterBucket.total += 1;

    // Tag buckets
    const tags = question.tags_snapshot ?? [];
    const seenTagsForQ = new Set<string>();
    for (const rawTag of tags) {
      const tagId = typeof rawTag === "string" ? rawTag : rawTag.id;
      const tagName = typeof rawTag === "string" ? rawTag : rawTag.name;
      if (!tagId || !tagName || seenTagsForQ.has(tagId)) continue;
      seenTagsForQ.add(tagId);

      let tagBucket = tagMap.get(tagId);
      if (!tagBucket) {
        tagBucket = {
          tagId,
          tagName,
          total: 0,
          correct: 0,
          wrong: 0,
          unanswered: 0,
          accuracyPercent: 0,
        };
        tagMap.set(tagId, tagBucket);
      }
      tagBucket.total += 1;
      if (isUnanswered) tagBucket.unanswered += 1;
      else if (isCorrect) tagBucket.correct += 1;
      else tagBucket.wrong += 1;
    }

    if (isUnanswered) {
      unansweredCount += 1;
      subjectBucket.unanswered += 1;
      chapterBucket.unanswered += 1;
    } else {
      answeredCount += 1;
      if (isCorrect) {
        correctCount += 1;
        subjectBucket.correct += 1;
        chapterBucket.correct += 1;
      } else {
        wrongCount += 1;
        subjectBucket.wrong += 1;
        chapterBucket.wrong += 1;
      }
    }
  }

  const totalQuestions = questions.length;
  const scorePercent = calculateWeightedAccuracyPercent(
    correctCount,
    totalQuestions,
  );

  const subjectBreakdown = Array.from(subjectMap.values()).map((bucket) => ({
    ...bucket,
    accuracyPercent: calculateWeightedAccuracyPercent(
      bucket.correct,
      bucket.total,
    ),
  }));

  const chapterBreakdown = Array.from(chapterMap.values()).map((bucket) => ({
    ...bucket,
    accuracyPercent:
      bucket.total === 0
        ? 0
        : Math.round((bucket.correct / bucket.total) * 100),
  }));

  const tagBreakdown = Array.from(tagMap.values()).map((bucket) => ({
    ...bucket,
    accuracyPercent: calculateWeightedAccuracyPercent(
      bucket.correct,
      bucket.total,
    ),
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
    subjectBreakdown,
    chapterBreakdown,
    tagBreakdown,
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
  const remaining = calculateRemainingMs(
    expiresAtIso,
    nowMs,
    serverClockOffsetMs,
  );
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
 * Optionally masks subject/chapter titles according to exam room settings.
 */
export function sanitizeExamQuestionsForClient(
  questions: readonly ExtendedExamSnapshotQuestion[],
  options?: {
    showSubjectNames?: boolean;
    showChapterNames?: boolean;
  },
): SanitizedExamSnapshotQuestion[] {
  const showSubject = options?.showSubjectNames ?? true;
  const showChapter = options?.showChapterNames ?? true;

  return questions.map((q) => {
    const cleanOptions: ExamSnapshotOption[] = q.options_snapshot.map((opt) => ({
      id: opt.id,
      label: opt.label,
      content: opt.content,
      image_url: opt.image_url,
      position: opt.position,
    }));

    const base: SanitizedExamSnapshotQuestion = {
      id: q.id,
      attempt_id: q.attempt_id,
      question_id: q.question_id,
      position: q.position,
      question_type: q.question_type,
      chapter_snapshot: showChapter ? q.chapter_snapshot : null,
      prompt_snapshot: q.prompt_snapshot,
      prompt_image_url_snapshot: q.prompt_image_url_snapshot,
      options_snapshot: cleanOptions,
      created_at: q.created_at,
    };

    if (q.source_study_set_id !== undefined) {
      base.source_study_set_id = q.source_study_set_id;
    }
    if (q.source_subject_title !== undefined) {
      base.source_subject_title = showSubject ? q.source_subject_title : null;
    }
    if (q.tags_snapshot !== undefined) {
      base.tags_snapshot = q.tags_snapshot;
    }

    return base;
  });
}
