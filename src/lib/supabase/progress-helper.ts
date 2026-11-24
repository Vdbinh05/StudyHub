import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { MasteryLevel, SelfRating, UserQuestionProgress } from "@/types/domain";

const MIN_EASE_FACTOR = 1.3;
const MAX_EASE_FACTOR = 4.0;
const DEFAULT_EASE_FACTOR = 2.5;
const MAX_INTERVAL_DAYS = 3650;

export interface Sm2UpdateInput {
  supabase: SupabaseClient<Database>;
  userId: string;
  studySetId: string;
  questionId: string;
  isCorrect: boolean;
  selfRating?: SelfRating | null;
  overrides?: {
    mastery_level?: MasteryLevel;
    ease_factor?: number;
    interval_days?: number;
    repetitions?: number;
    next_review_at?: string | null;
  };
}

/**
 * Deterministic SM-2 spaced repetition state transition.
 * Strictly unified 1:1 with `src/lib/learning/sm2.ts` and SQL `submit_exam_attempt()` (SH-029).
 * Quality mapping: again=1, hard=3, good=4, easy=5 (or 4 for correct, 1 for wrong).
 */
export function computeDeterministicSm2(
  existing: Pick<
    UserQuestionProgress,
    | "ease_factor"
    | "interval_days"
    | "repetitions"
    | "correct_count"
    | "wrong_count"
    | "consecutive_correct"
  > | null,
  isCorrect: boolean,
  selfRating?: SelfRating | null,
  now = new Date(),
): {
  mastery_level: MasteryLevel;
  correct_count: number;
  wrong_count: number;
  consecutive_correct: number;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  last_reviewed_at: string;
  next_review_at: string;
} {
  const prevEase = existing ? Number(existing.ease_factor) : DEFAULT_EASE_FACTOR;
  const prevInterval = existing?.interval_days ?? 0;
  const prevReps = existing?.repetitions ?? 0;
  const prevCorrect = existing?.correct_count ?? 0;
  const prevWrong = existing?.wrong_count ?? 0;
  const prevConsec = existing?.consecutive_correct ?? 0;

  let quality: number;
  if (selfRating) {
    quality =
      selfRating === "again"
        ? 1
        : selfRating === "hard"
          ? 3
          : selfRating === "good"
            ? 4
            : 5;
  } else {
    quality = isCorrect ? 4 : 1;
  }

  const passed = quality >= 3 && (selfRating ? true : isCorrect);

  // Classic SM-2 ease factor update clamped to [1.30, 4.00]
  const rawEase =
    prevEase + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  const easeFactor =
    Math.round(Math.min(MAX_EASE_FACTOR, Math.max(MIN_EASE_FACTOR, rawEase)) * 100) /
    100;

  let repetitions: number;
  let intervalDays: number;
  let consecutiveCorrect: number;

  if (!passed) {
    repetitions = 0;
    intervalDays = 1;
    consecutiveCorrect = 0;
  } else {
    if (prevReps === 0) {
      intervalDays = 1;
    } else if (prevReps === 1) {
      intervalDays = 6;
    } else {
      intervalDays = Math.min(
        MAX_INTERVAL_DAYS,
        Math.max(1, Math.round(prevInterval * prevEase)),
      );
    }
    repetitions = prevReps + 1;
    consecutiveCorrect = prevConsec + 1;
  }

  const correctCount = prevCorrect + (passed ? 1 : 0);
  const wrongCount = prevWrong + (passed ? 0 : 1);

  let masteryLevel: MasteryLevel;
  if (correctCount === 0 && wrongCount === 0) {
    masteryLevel = "new";
  } else if (consecutiveCorrect >= 3 && intervalDays >= 14) {
    masteryLevel = "mastered";
  } else if (consecutiveCorrect >= 2 || intervalDays >= 6) {
    masteryLevel = "familiar";
  } else {
    masteryLevel = "learning";
  }

  const nextDate = new Date(now.getTime() + intervalDays * 24 * 60 * 60 * 1000);

  return {
    mastery_level: masteryLevel,
    correct_count: correctCount,
    wrong_count: wrongCount,
    consecutive_correct: consecutiveCorrect,
    ease_factor: easeFactor,
    interval_days: intervalDays,
    repetitions,
    last_reviewed_at: now.toISOString(),
    next_review_at: nextDate.toISOString(),
  };
}

export async function upsertQuestionProgress(
  params: Sm2UpdateInput,
): Promise<UserQuestionProgress> {
  const { supabase, userId, studySetId, questionId, isCorrect, selfRating, overrides } =
    params;

  const { data: existing, error: fetchErr } = await supabase
    .from("user_question_progress")
    .select("*")
    .eq("user_id", userId)
    .eq("question_id", questionId)
    .maybeSingle();

  if (fetchErr) throw fetchErr;

  const computed = computeDeterministicSm2(existing, isCorrect, selfRating);

  const payload = {
    user_id: userId,
    study_set_id: studySetId,
    question_id: questionId,
    mastery_level: overrides?.mastery_level ?? computed.mastery_level,
    correct_count: computed.correct_count,
    wrong_count: computed.wrong_count,
    consecutive_correct: computed.consecutive_correct,
    ease_factor: overrides?.ease_factor ?? computed.ease_factor,
    interval_days: overrides?.interval_days ?? computed.interval_days,
    repetitions: overrides?.repetitions ?? computed.repetitions,
    last_reviewed_at: computed.last_reviewed_at,
    next_review_at:
      overrides?.next_review_at !== undefined
        ? overrides.next_review_at
        : computed.next_review_at,
  };

  const { data, error } = await supabase
    .from("user_question_progress")
    .upsert(payload, { onConflict: "user_id,question_id" })
    .select("*")
    .single();

  if (error) throw error;
  return data as UserQuestionProgress;
}
