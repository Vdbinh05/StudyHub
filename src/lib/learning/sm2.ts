import type { MasteryLevel, SelfRating } from "@/types/domain";

const DAY_MS = 86_400_000;
const MIN_EASE_FACTOR = 1.3;
const MAX_EASE_FACTOR = 4.0;
const DEFAULT_EASE_FACTOR = 2.5;
const MAX_INTERVAL_DAYS = 3650; // 10-year cap prevents JS Date & Postgres integer overflow

export interface Sm2ProgressState {
  mastery_level: MasteryLevel;
  correct_count: number;
  wrong_count: number;
  consecutive_correct: number;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  last_reviewed_at: string | null;
  next_review_at: string | null;
}

export interface MasteryDerivationInput {
  correct_count: number;
  wrong_count: number;
  consecutive_correct: number;
  interval_days: number;
}

export interface MasterySummary {
  total: number;
  new: number;
  learning: number;
  familiar: number;
  mastered: number;
  due: number;
}

export type ReviewOutcome = SelfRating | boolean;

/**
 * Create a clean initial SM-2 progress state for an unstudied question.
 */
export function createInitialProgressState(): Sm2ProgressState {
  return {
    mastery_level: "new",
    correct_count: 0,
    wrong_count: 0,
    consecutive_correct: 0,
    ease_factor: DEFAULT_EASE_FACTOR,
    interval_days: 0,
    repetitions: 0,
    last_reviewed_at: null,
    next_review_at: null,
  };
}

/**
 * Map a self-rating or binary correctness outcome to a deterministic SM-2 quality score (1..5).
 */
export function ratingToQuality(outcome: ReviewOutcome): number {
  if (typeof outcome === "boolean") {
    return outcome ? 4 : 1;
  }
  switch (outcome) {
    case "again":
      return 1;
    case "hard":
      return 3;
    case "good":
      return 4;
    case "easy":
      return 5;
  }
}

/**
 * Deterministically derive mastery level according to PRD §4.1.
 * NEVER marks a question mastered after a single correct answer.
 */
export function deriveMasteryLevel(input: MasteryDerivationInput): MasteryLevel {
  if (input.correct_count === 0 && input.wrong_count === 0) {
    return "new";
  }
  if (input.consecutive_correct >= 3 && input.interval_days >= 14) {
    return "mastered";
  }
  if (input.consecutive_correct >= 2 || input.interval_days >= 6) {
    return "familiar";
  }
  return "learning";
}

function roundTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Deterministic SM-2 spaced repetition calculation.
 */
export function calculateNextReview(
  previous: Partial<Sm2ProgressState> | null | undefined,
  outcome: ReviewOutcome,
  now: Date = new Date(),
): Sm2ProgressState {
  const prev: Sm2ProgressState = {
    ...createInitialProgressState(),
    ...previous,
  };

  const q = ratingToQuality(outcome);
  const isPass = q >= 3;

  const rawEase =
    prev.ease_factor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
  const ease_factor = Math.min(
    MAX_EASE_FACTOR,
    Math.max(MIN_EASE_FACTOR, roundTwoDecimals(rawEase)),
  );

  let repetitions: number;
  let interval_days: number;
  let consecutive_correct: number;
  let correct_count = prev.correct_count;
  let wrong_count = prev.wrong_count;

  if (!isPass) {
    repetitions = 0;
    interval_days = 1;
    consecutive_correct = 0;
    wrong_count += 1;
  } else {
    if (prev.repetitions === 0) {
      interval_days = 1;
    } else if (prev.repetitions === 1) {
      interval_days = 6;
    } else {
      interval_days = Math.min(
        MAX_INTERVAL_DAYS,
        Math.max(1, Math.round(prev.interval_days * prev.ease_factor)),
      );
    }
    repetitions = prev.repetitions + 1;
    consecutive_correct = prev.consecutive_correct + 1;
    correct_count += 1;
  }

  const mastery_level = deriveMasteryLevel({
    correct_count,
    wrong_count,
    consecutive_correct,
    interval_days,
  });

  const nowMs = now.getTime();
  const last_reviewed_at = new Date(nowMs).toISOString();
  const next_review_at = new Date(nowMs + interval_days * DAY_MS).toISOString();

  return {
    mastery_level,
    correct_count,
    wrong_count,
    consecutive_correct,
    ease_factor,
    interval_days,
    repetitions,
    last_reviewed_at,
    next_review_at,
  };
}

/**
 * Determine whether a tracked question is currently due for SM-2 review.
 */
export function isQuestionDue(
  progress: Pick<Sm2ProgressState, "next_review_at"> | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!progress?.next_review_at) return false;
  const dueMs = Date.parse(progress.next_review_at);
  if (Number.isNaN(dueMs)) return false;
  return dueMs <= now.getTime();
}

/**
 * Aggregate mastery & due counts across a collection of progress records.
 */
export function summarizeMastery(
  items: ReadonlyArray<Pick<Sm2ProgressState, "mastery_level" | "next_review_at">>,
  now: Date = new Date(),
): MasterySummary {
  const summary: MasterySummary = {
    total: items.length,
    new: 0,
    learning: 0,
    familiar: 0,
    mastered: 0,
    due: 0,
  };

  for (const item of items) {
    summary[item.mastery_level] += 1;
    if (isQuestionDue(item, now)) {
      summary.due += 1;
    }
  }

  return summary;
}
