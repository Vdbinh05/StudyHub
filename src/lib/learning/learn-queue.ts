import type { MasteryLevel } from "@/types/domain";
import { isQuestionDue } from "./sm2";

export interface LearnItemInput {
  questionId: string;
  masteryLevel: MasteryLevel;
  nextReviewAt: string | null;
  wrongCount: number;
}

export interface LearnQueueCard {
  questionId: string;
  requiredCorrect: number;
  streakInRound: number;
  missedInSession: boolean;
}

export interface LearnQueueOptions {
  roundSize?: number;
  reinsertGap?: number;
  requiredCorrectClean?: number;
  requiredCorrectAfterMiss?: number;
  now?: Date;
}

export interface LearnQueueState {
  roundNumber: number;
  roundSize: number;
  reinsertGap: number;
  requiredCorrectClean: number;
  requiredCorrectAfterMiss: number;
  activeQueue: LearnQueueCard[];
  pendingPool: LearnItemInput[];
  completedQuestionIds: string[];
  missedQuestionIds: string[];
  totalQuestions: number;
  totalAnswers: number;
  correctAnswers: number;
  roundCompleted: boolean;
  sessionCompleted: boolean;
}

export interface LearnStats {
  roundNumber: number;
  totalQuestions: number;
  completedQuestions: number;
  remainingInRound: number;
  remainingInPool: number;
  missedCount: number;
  totalAnswers: number;
  correctAnswers: number;
  accuracyPercent: number;
}

const DEFAULT_ROUND_SIZE = 7;
const DEFAULT_REINSERT_GAP = 4; // 3-5 cards spacing gap
const DEFAULT_REQUIRED_CLEAN = 1;
const DEFAULT_REQUIRED_AFTER_MISS = 2;

function getPriorityRank(item: LearnItemInput, now: Date): number {
  if (isQuestionDue({ next_review_at: item.nextReviewAt }, now)) {
    return 0; // Due / overdue highest priority
  }
  switch (item.masteryLevel) {
    case "learning":
      return 1;
    case "new":
      return 2;
    case "familiar":
      return 3;
    case "mastered":
      return 4;
  }
}

/**
 * Deterministically sort questions by learning priority:
 * Due/Overdue -> Learning (most missed first) -> New -> Familiar -> Mastered.
 */
export function prioritizeLearnQuestions(
  items: readonly LearnItemInput[],
  now: Date = new Date(),
): LearnItemInput[] {
  return items
    .map((item, originalIndex) => ({
      item,
      originalIndex,
      rank: getPriorityRank(item, now),
      dueTime: item.nextReviewAt ? Date.parse(item.nextReviewAt) : Number.POSITIVE_INFINITY,
    }))
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      if (a.rank === 0 && a.dueTime !== b.dueTime) {
        return a.dueTime - b.dueTime; // Most overdue first
      }
      if (a.item.wrongCount !== b.item.wrongCount) {
        return b.item.wrongCount - a.item.wrongCount; // Most missed first
      }
      return a.originalIndex - b.originalIndex;
    })
    .map((entry) => entry.item);
}

function buildRoundCards(
  pool: readonly LearnItemInput[],
  roundSize: number,
  requiredCorrectClean: number,
): { activeQueue: LearnQueueCard[]; remainingPool: LearnItemInput[] } {
  const slice = pool.slice(0, roundSize);
  const remainingPool = pool.slice(roundSize);
  const activeQueue: LearnQueueCard[] = slice.map((item) => ({
    questionId: item.questionId,
    requiredCorrect: requiredCorrectClean,
    streakInRound: 0,
    missedInSession: false,
  }));
  return { activeQueue, remainingPool };
}

/**
 * Initialize a deterministic adaptive Learn queue state.
 */
export function createLearnQueueState(
  items: readonly LearnItemInput[],
  options: LearnQueueOptions = {},
): LearnQueueState {
  const roundSize = Math.max(1, options.roundSize ?? DEFAULT_ROUND_SIZE);
  const reinsertGap = Math.max(1, options.reinsertGap ?? DEFAULT_REINSERT_GAP);
  const requiredCorrectClean = Math.max(
    1,
    options.requiredCorrectClean ?? DEFAULT_REQUIRED_CLEAN,
  );
  const requiredCorrectAfterMiss = Math.max(
    2,
    options.requiredCorrectAfterMiss ?? DEFAULT_REQUIRED_AFTER_MISS,
  );
  const now = options.now ?? new Date();

  const prioritized = prioritizeLearnQuestions(items, now);
  const { activeQueue, remainingPool } = buildRoundCards(
    prioritized,
    roundSize,
    requiredCorrectClean,
  );

  const isEmpty = activeQueue.length === 0;

  return {
    roundNumber: 1,
    roundSize,
    reinsertGap,
    requiredCorrectClean,
    requiredCorrectAfterMiss,
    activeQueue,
    pendingPool: remainingPool,
    completedQuestionIds: [],
    missedQuestionIds: [],
    totalQuestions: prioritized.length,
    totalAnswers: 0,
    correctAnswers: 0,
    roundCompleted: isEmpty,
    sessionCompleted: isEmpty,
  };
}

/**
 * Get the current card at the head of the active Learn queue.
 */
export function getCurrentLearnCard(
  state: LearnQueueState,
): LearnQueueCard | null {
  return state.activeQueue[0] ?? null;
}

/**
 * Record an answer for the current card in the Learn queue.
 * Missed cards are re-injected after `reinsertGap` (3-5 cards later, never immediately next when other cards exist)
 * and require `requiredCorrectAfterMiss` (2) consecutive correct answers to graduate.
 */
export function recordLearnAnswer(
  state: LearnQueueState,
  isCorrect: boolean,
): LearnQueueState {
  if (state.activeQueue.length === 0) {
    return state;
  }

  const [current, ...rest] = state.activeQueue;
  const totalAnswers = state.totalAnswers + 1;
  const correctAnswers = state.correctAnswers + (isCorrect ? 1 : 0);

  let nextQueue: LearnQueueCard[];
  let completedQuestionIds = state.completedQuestionIds;
  let missedQuestionIds = state.missedQuestionIds;

  if (isCorrect) {
    const nextStreak = current.streakInRound + 1;
    if (nextStreak >= current.requiredCorrect) {
      // Graduated from this round!
      nextQueue = rest;
      if (!completedQuestionIds.includes(current.questionId)) {
        completedQuestionIds = [...completedQuestionIds, current.questionId];
      }
    } else {
      // Still needs another consecutive correct answer — re-insert with spacing gap
      const updatedCard: LearnQueueCard = {
        ...current,
        streakInRound: nextStreak,
      };
      const insertAt = Math.min(state.reinsertGap, rest.length);
      nextQueue = [
        ...rest.slice(0, insertAt),
        updatedCard,
        ...rest.slice(insertAt),
      ];
    }
  } else {
    // Missed: reset streak, require 2 consecutive correct, re-insert after spacing gap
    const updatedCard: LearnQueueCard = {
      ...current,
      streakInRound: 0,
      requiredCorrect: Math.max(
        current.requiredCorrect,
        state.requiredCorrectAfterMiss,
      ),
      missedInSession: true,
    };

    const insertAt = Math.min(state.reinsertGap, rest.length);
    nextQueue = [
      ...rest.slice(0, insertAt),
      updatedCard,
      ...rest.slice(insertAt),
    ];

    if (!missedQuestionIds.includes(current.questionId)) {
      missedQuestionIds = [...missedQuestionIds, current.questionId];
    }
  }

  const roundCompleted = nextQueue.length === 0;
  const sessionCompleted = roundCompleted && state.pendingPool.length === 0;

  return {
    ...state,
    activeQueue: nextQueue,
    completedQuestionIds,
    missedQuestionIds,
    totalAnswers,
    correctAnswers,
    roundCompleted,
    sessionCompleted,
  };
}

/**
 * Advance to the next round once the current round is completed.
 */
export function advanceLearnRound(state: LearnQueueState): LearnQueueState {
  if (!state.roundCompleted || state.pendingPool.length === 0) {
    return state;
  }

  const { activeQueue, remainingPool } = buildRoundCards(
    state.pendingPool,
    state.roundSize,
    state.requiredCorrectClean,
  );

  return {
    ...state,
    roundNumber: state.roundNumber + 1,
    activeQueue,
    pendingPool: remainingPool,
    roundCompleted: activeQueue.length === 0,
    sessionCompleted: activeQueue.length === 0 && remainingPool.length === 0,
  };
}

/**
 * Compute live Learn session progress statistics.
 */
export function getLearnStats(state: LearnQueueState): LearnStats {
  const accuracyPercent =
    state.totalAnswers === 0
      ? 0
      : Math.round((state.correctAnswers / state.totalAnswers) * 100);

  return {
    roundNumber: state.roundNumber,
    totalQuestions: state.totalQuestions,
    completedQuestions: state.completedQuestionIds.length,
    remainingInRound: state.activeQueue.length,
    remainingInPool: state.pendingPool.length,
    missedCount: state.missedQuestionIds.length,
    totalAnswers: state.totalAnswers,
    correctAnswers: state.correctAnswers,
    accuracyPercent,
  };
}
