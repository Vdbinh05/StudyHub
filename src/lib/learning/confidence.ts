import type {
  ConfidenceLevel,
  MasteryLevel,
  MistakeStatus,
  SelfRating,
} from "@/types/domain";
import {
  calculateNextReview,
  createInitialProgressState,
  type Sm2ProgressState,
} from "./sm2";

export const CONFIDENCE_LEVELS: readonly ConfidenceLevel[] = [
  "certain",
  "unsure",
  "guessing",
] as const;

export interface ConfidenceOptionMeta {
  level: ConfidenceLevel;
  viLabel: string;
  enLabel: string;
  viShort: string;
  enShort: string;
  viDesc: string;
  enDesc: string;
  numberKey: "1" | "2" | "3";
  letterKey: "c" | "u" | "g";
}

export const CONFIDENCE_OPTIONS: readonly ConfidenceOptionMeta[] = [
  {
    level: "certain",
    viLabel: "Chắc chắn",
    enLabel: "Certain",
    viShort: "Chắc chắn",
    enShort: "Certain",
    viDesc: "Tôi nhớ rõ kiến thức và tự tin với câu trả lời này.",
    enDesc: "I clearly recall this concept and feel confident.",
    numberKey: "1",
    letterKey: "c",
  },
  {
    level: "unsure",
    viLabel: "Phân vân",
    enLabel: "Unsure",
    viShort: "Phân vân",
    enShort: "Unsure",
    viDesc: "Tôi nhớ mang máng, cần ôn thêm để củng cố.",
    enDesc: "I am somewhat unsure and could use extra review.",
    numberKey: "2",
    letterKey: "u",
  },
  {
    level: "guessing",
    viLabel: "Đoán mò",
    enLabel: "Guessing",
    viShort: "Đoán mò",
    enShort: "Guessing",
    viDesc: "Tôi đang đoán — dù đúng cũng chưa nên tính là đã thuộc.",
    enDesc: "I am guessing — even if right, keep it in review.",
    numberKey: "3",
    letterKey: "g",
  },
] as const;

export interface V3Sm2ProgressState extends Sm2ProgressState {
  consecutive_wrong: number;
  last_wrong_at: string | null;
  last_confidence: ConfidenceLevel | null;
  low_confidence_count: number;
  high_conf_wrong_count: number;
  guess_correct_count: number;
  independent_recall_count: number;
  hint_used_count: number;
  mistake_status: MistakeStatus;
}

export interface ConfidenceSm2Input {
  previous?: Partial<V3Sm2ProgressState> | null;
  isCorrect: boolean;
  confidence?: ConfidenceLevel | null;
  selfRating?: SelfRating | null;
  usedHint?: boolean;
  /** Recognition-only stages (e.g. MC in Learn Stage 2) NEVER grant `mastered` alone. */
  isRecognitionOnly?: boolean;
  now?: Date;
}

export type MasteryBlockedReason =
  | "guessing"
  | "hint_used"
  | "recognition_only"
  | null;

export interface ConfidenceSm2Outcome {
  next: V3Sm2ProgressState;
  /** 0..100 deterministic review priority boost (highest for incorrect + certain misconceptions). */
  reviewPriorityBoost: number;
  /** Recommended intervening cards before reinserting in active session queue (null = no immediate reinsert). */
  recommendedReinsertGap: number | null;
  isMisconception: boolean;
  isGuessHit: boolean;
  isIndependentRecall: boolean;
  masteryBlockedReason: MasteryBlockedReason;
}

const DAY_MS = 86_400_000;
const MIN_EASE_FACTOR = 1.3;
const UNSURE_MAX_INTERVAL_DAYS = 4;

export function createInitialV3ProgressState(): V3Sm2ProgressState {
  return {
    ...createInitialProgressState(),
    consecutive_wrong: 0,
    last_wrong_at: null,
    last_confidence: null,
    low_confidence_count: 0,
    high_conf_wrong_count: 0,
    guess_correct_count: 0,
    independent_recall_count: 0,
    hint_used_count: 0,
    mistake_status: "resolved",
  };
}

function capMasteryBelowMastered(level: MasteryLevel): MasteryLevel {
  return level === "mastered" ? "familiar" : level;
}

function roundTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Deterministic SM-2 + Confidence integration.
 * Extends the canonical `calculateNextReview()` algorithm without creating a conflicting scheduler:
 * - `correct + certain` (no hint, not recognition-only): normal SM-2 progression + `independent_recall_count++`
 * - `correct + unsure`: counts as correct, caps interval <= 4 days and flags extra review priority
 * - `correct + guessing`: counts as correct, `guess_correct_count++`, interval=1 day, NEVER advances to `mastered`
 * - `incorrect + certain`: flags misconception (`high_conf_wrong_count++`), highest review priority (`100`)
 * - `incorrect + unsure/guessing`: standard SM-2 mistake penalty + 3-item reinsertion gap
 */
export function applyConfidenceToSm2(
  input: ConfidenceSm2Input,
): ConfidenceSm2Outcome {
  const now = input.now ?? new Date();
  const nowMs = now.getTime();
  const nowIso = new Date(nowMs).toISOString();
  const confidence: ConfidenceLevel | null = input.confidence ?? null;
  const usedHint = Boolean(input.usedHint);
  const isRecognitionOnly = Boolean(input.isRecognitionOnly);

  const prev: V3Sm2ProgressState = {
    ...createInitialV3ProgressState(),
    ...input.previous,
  };

  // Determine the SM-2 review outcome fed into the canonical scheduler
  const sm2Input: SelfRating | boolean = !input.isCorrect
    ? "again"
    : input.selfRating
      ? input.selfRating
      : confidence === "unsure" || confidence === "guessing" || usedHint
        ? "hard"
        : true;

  const baseSm2 = calculateNextReview(prev, sm2Input, now);

  let mastery_level: MasteryLevel = baseSm2.mastery_level;
  let interval_days = baseSm2.interval_days;
  let repetitions = baseSm2.repetitions;
  let consecutive_correct = baseSm2.consecutive_correct;
  let ease_factor = baseSm2.ease_factor;

  let consecutive_wrong = prev.consecutive_wrong;
  let last_wrong_at = prev.last_wrong_at;
  let low_confidence_count = prev.low_confidence_count;
  let high_conf_wrong_count = prev.high_conf_wrong_count;
  let guess_correct_count = prev.guess_correct_count;
  let independent_recall_count = prev.independent_recall_count;
  const hint_used_count = prev.hint_used_count + (usedHint ? 1 : 0);
  let mistake_status: MistakeStatus = prev.mistake_status;

  let reviewPriorityBoost = 0;
  let recommendedReinsertGap: number | null = null;
  let isMisconception = false;
  let isGuessHit = false;
  let isIndependentRecall = false;
  let masteryBlockedReason: MasteryBlockedReason = null;

  if (input.isCorrect) {
    consecutive_wrong = 0;

    if (confidence === "guessing") {
      isGuessHit = true;
      guess_correct_count += 1;
      low_confidence_count += 1;
      // Score stays correct, but a lucky guess NEVER advances to mastered or long intervals
      interval_days = 1;
      repetitions = Math.min(prev.repetitions, 1);
      consecutive_correct = Math.min(consecutive_correct, 2);
      mastery_level =
        prev.mastery_level === "mastered"
          ? "familiar"
          : capMasteryBelowMastered(mastery_level);
      masteryBlockedReason = "guessing";
      reviewPriorityBoost = 75;
      recommendedReinsertGap = 4;
    } else if (confidence === "unsure") {
      low_confidence_count += 1;
      interval_days = Math.min(interval_days, UNSURE_MAX_INTERVAL_DAYS);
      if (usedHint) {
        mastery_level = capMasteryBelowMastered(mastery_level);
        masteryBlockedReason = "hint_used";
      } else if (isRecognitionOnly) {
        mastery_level = capMasteryBelowMastered(mastery_level);
        masteryBlockedReason = "recognition_only";
      } else {
        // Capped interval (<14d) naturally prevents premature mastered promotion
        mastery_level = capMasteryBelowMastered(mastery_level);
      }
      reviewPriorityBoost = 45;
      recommendedReinsertGap = 4;
    } else {
      // `certain` or confidence disabled (`null`)
      if (usedHint) {
        mastery_level = capMasteryBelowMastered(mastery_level);
        interval_days = Math.min(interval_days, 6);
        masteryBlockedReason = "hint_used";
        reviewPriorityBoost = 25;
      } else if (isRecognitionOnly) {
        mastery_level = capMasteryBelowMastered(mastery_level);
        masteryBlockedReason = "recognition_only";
        reviewPriorityBoost = 10;
      } else {
        isIndependentRecall = true;
        independent_recall_count += 1;
        reviewPriorityBoost = 0;
      }
    }

    // Update mistake lifecycle deterministically without erasing wrong_count history
    if (prev.wrong_count > 0) {
      if (confidence === "guessing" || usedHint) {
        mistake_status =
          prev.mistake_status === "resolved" ? "improving" : prev.mistake_status;
      } else if (consecutive_correct >= 2) {
        mistake_status = "resolved";
      } else {
        mistake_status = "improving";
      }
    } else {
      mistake_status = "resolved";
    }
  } else {
    // Incorrect response
    consecutive_wrong = prev.consecutive_wrong + 1;
    last_wrong_at = nowIso;
    mistake_status = "active";

    if (confidence === "certain") {
      // High-confidence misconception: highest review priority + tighter ease adjustment
      isMisconception = true;
      high_conf_wrong_count += 1;
      ease_factor = Math.max(
        MIN_EASE_FACTOR,
        roundTwoDecimals(ease_factor - 0.05),
      );
      reviewPriorityBoost = 100;
      recommendedReinsertGap = 2;
    } else {
      if (confidence === "unsure" || confidence === "guessing") {
        low_confidence_count += 1;
      }
      reviewPriorityBoost = 70;
      recommendedReinsertGap = 3;
    }
  }

  const next_review_at = new Date(nowMs + interval_days * DAY_MS).toISOString();

  return {
    next: {
      mastery_level,
      correct_count: baseSm2.correct_count,
      wrong_count: baseSm2.wrong_count,
      consecutive_correct,
      consecutive_wrong,
      ease_factor,
      interval_days,
      repetitions,
      last_reviewed_at: nowIso,
      last_wrong_at,
      next_review_at,
      last_confidence: confidence ?? prev.last_confidence,
      low_confidence_count,
      high_conf_wrong_count,
      guess_correct_count,
      independent_recall_count,
      hint_used_count,
      mistake_status,
    },
    reviewPriorityBoost,
    recommendedReinsertGap,
    isMisconception,
    isGuessHit,
    isIndependentRecall,
    masteryBlockedReason,
  };
}

export interface ConfidenceCalibrationEntry {
  confidence: ConfidenceLevel | null | undefined;
  isCorrect: boolean;
}

export interface ConfidenceBucketStats {
  total: number;
  correct: number;
  wrong: number;
  accuracyPercent: number;
}

export interface ConfidenceCalibrationSummary {
  totalTagged: number;
  untagged: number;
  certain: ConfidenceBucketStats;
  unsure: ConfidenceBucketStats;
  guessing: ConfidenceBucketStats;
  /** High-confidence wrong answers (misconceptions) */
  misconceptionCount: number;
  /** Correct answers marked as guessing (lucky hits) */
  guessingHitCount: number;
  /** Correct answers marked as unsure (fragile knowledge) */
  fragileCorrectCount: number;
  /** Overconfidence rate among certain answers (0..100) */
  overconfidenceRate: number;
}

function emptyBucket(): ConfidenceBucketStats {
  return { total: 0, correct: 0, wrong: 0, accuracyPercent: 0 };
}

function finalizeBucket(bucket: ConfidenceBucketStats): ConfidenceBucketStats {
  return {
    ...bucket,
    accuracyPercent:
      bucket.total > 0
        ? Math.round((bucket.correct / bucket.total) * 10000) / 100
        : 0,
  };
}

/**
 * Deterministic post-session / post-exam metacognitive calibration summary.
 * Pure analytics — NEVER alters exam score or pass/fail outcome.
 */
export function summarizeConfidenceCalibration(
  entries: readonly ConfidenceCalibrationEntry[],
): ConfidenceCalibrationSummary {
  const certain = emptyBucket();
  const unsure = emptyBucket();
  const guessing = emptyBucket();
  let untagged = 0;

  for (const entry of entries) {
    if (!entry.confidence) {
      untagged += 1;
      continue;
    }
    const target =
      entry.confidence === "certain"
        ? certain
        : entry.confidence === "unsure"
          ? unsure
          : guessing;
    target.total += 1;
    if (entry.isCorrect) target.correct += 1;
    else target.wrong += 1;
  }

  const finalCertain = finalizeBucket(certain);
  const finalUnsure = finalizeBucket(unsure);
  const finalGuessing = finalizeBucket(guessing);

  return {
    totalTagged: certain.total + unsure.total + guessing.total,
    untagged,
    certain: finalCertain,
    unsure: finalUnsure,
    guessing: finalGuessing,
    misconceptionCount: finalCertain.wrong,
    guessingHitCount: finalGuessing.correct,
    fragileCorrectCount: finalUnsure.correct,
    overconfidenceRate:
      finalCertain.total > 0
        ? Math.round((finalCertain.wrong / finalCertain.total) * 10000) / 100
        : 0,
  };
}

/**
 * Map keyboard shortcuts (`1`/`2`/`3` or `c`/`u`/`g`) to a ConfidenceLevel.
 */
export function mapKeyToConfidence(key: string): ConfidenceLevel | null {
  const k = key.toLowerCase();
  if (k === "1" || k === "c") return "certain";
  if (k === "2" || k === "u") return "unsure";
  if (k === "3" || k === "g") return "guessing";
  return null;
}

/**
 * P0 Invariant Verification Helper:
 * Exam score depends strictly on correctness of answers (`isCorrect`), NEVER on `confidence`.
 */
export function calculateConfidenceNeutralExamScore(
  items: ReadonlyArray<{ isCorrect: boolean; confidence?: ConfidenceLevel | null }>,
  passThreshold: number = 70,
): {
  total: number;
  correct: number;
  scorePercent: number;
  passed: boolean;
} {
  const total = items.length;
  let correct = 0;
  for (const item of items) {
    if (item.isCorrect) correct += 1;
  }
  const scorePercent =
    total > 0 ? Math.round((correct / total) * 10000) / 100 : 0;
  return {
    total,
    correct,
    scorePercent,
    passed: scorePercent >= passThreshold,
  };
}
