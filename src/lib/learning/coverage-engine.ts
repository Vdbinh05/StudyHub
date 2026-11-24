import type {
  AllocationStrategy,
  CoverageAttemptStatus,
  CoverageCycleStatus,
  CoverageQuestionState,
} from "@/types/domain";
import {
  computeExamAllocation,
  normalizeAllocationStrategy,
  type AnyAllocationStrategy,
} from "./exam-allocator";
import { createSeededRng, fisherYatesShuffle, type RngFn } from "./shuffle";

export type {
  CoverageAttemptStatus,
  CoverageCycleStatus,
  CoverageQuestionState,
};

export interface CoveragePoolItemInput {
  questionId: string;
  subjectId: string;
  subjectTitle: string;
}

export interface CoverageCycleQuestion {
  questionId: string;
  subjectId: string;
  subjectTitle: string;
  poolOrder: number;
  state: CoverageQuestionState;
  assignedAttemptId: string | null;
  completedAttemptId: string | null;
  wasAnswered: boolean;
  lastIsCorrect: boolean | null;
  timesAssigned: number;
}

export interface CoverageCycleAttemptRecord {
  attemptId: string;
  sequenceNumber: number;
  status: CoverageAttemptStatus;
  assignedQuestionIds: string[];
  assignedCount: number;
  answeredCount: number;
  completedCount: number;
  correctCount: number;
}

export interface CoverageCycleState {
  id: string;
  title: string;
  status: CoverageCycleStatus;
  allocationStrategy: AllocationStrategy;
  questionsPerExam: number;
  cycleNumber: number;
  totalQuestions: number;
  assignedCount: number;
  answeredCount: number;
  completedCount: number;
  remainingCount: number;
  activeAttemptId: string | null;
  items: CoverageCycleQuestion[];
  attempts: CoverageCycleAttemptRecord[];
}

export interface CoverageSeriesPlan {
  totalQuestions: number;
  questionsPerExam: number;
  examSizes: number[];
  examCount: number;
  hasSmallerFinalExam: boolean;
  formattedPlan: string;
}

export interface CoverageSubjectProgress {
  subjectId: string;
  subjectTitle: string;
  total: number;
  completed: number;
  assigned: number;
  remaining: number;
  completedPercent: number;
}

export interface CoverageProgressSummary {
  totalQuestions: number;
  completedCount: number;
  assignedCount: number;
  answeredCount: number;
  remainingCount: number;
  completedPercent: number;
  inProgressPercent: number;
  remainingPercent: number;
  plannedRemainingExamSizes: number[];
  perSubject: CoverageSubjectProgress[];
  mistakeQuestionIds: string[];
}

export interface CoverageExamOutcome {
  questionId: string;
  wasAnswered: boolean;
  isCorrect: boolean;
}

export class CoverageCycleError extends Error {
  readonly code:
    | "EMPTY_POOL"
    | "INVALID_BATCH_SIZE"
    | "ACTIVE_ATTEMPT_EXISTS"
    | "NO_ACTIVE_ATTEMPT"
    | "ATTEMPT_MISMATCH"
    | "CYCLE_ALREADY_COMPLETED";

  constructor(
    code: CoverageCycleError["code"],
    message: string,
  ) {
    super(message);
    this.name = "CoverageCycleError";
    this.code = code;
  }
}

/**
 * Deterministically divide an N-question snapshot into sequential non-overlapping exam sizes.
 * Supports smaller final exam without discarding remaining questions!
 * Examples:
 * - planCoverageSeries(500, 250) -> examSizes: [250, 250], formattedPlan: "250 + 250"
 * - planCoverageSeries(500, 120) -> examSizes: [120, 120, 120, 120, 20], formattedPlan: "120 × 4 + 20"
 */
export function planCoverageSeries(
  totalQuestions: number,
  questionsPerExam: number,
): CoverageSeriesPlan {
  const safeTotal = Math.max(0, Math.floor(totalQuestions));
  const safeBatch = Math.max(1, Math.floor(questionsPerExam));

  if (safeTotal === 0) {
    return {
      totalQuestions: 0,
      questionsPerExam: safeBatch,
      examSizes: [],
      examCount: 0,
      hasSmallerFinalExam: false,
      formattedPlan: "0",
    };
  }

  const fullExams = Math.floor(safeTotal / safeBatch);
  const remainder = safeTotal % safeBatch;
  const examSizes: number[] = [];

  for (let i = 0; i < fullExams; i++) {
    examSizes.push(safeBatch);
  }
  if (remainder > 0) {
    examSizes.push(remainder);
  }

  let formattedPlan: string;
  if (examSizes.length <= 3) {
    formattedPlan = examSizes.join(" + ");
  } else if (remainder > 0) {
    formattedPlan = `${safeBatch} × ${fullExams} + ${remainder}`;
  } else {
    formattedPlan = `${safeBatch} × ${fullExams}`;
  }

  return {
    totalQuestions: safeTotal,
    questionsPerExam: safeBatch,
    examSizes,
    examCount: examSizes.length,
    hasSmallerFinalExam: remainder > 0 && fullExams > 0,
    formattedPlan,
  };
}

function recomputeCounts(
  items: readonly CoverageCycleQuestion[],
): {
  totalQuestions: number;
  assignedCount: number;
  answeredCount: number;
  completedCount: number;
  remainingCount: number;
} {
  let assignedCount = 0;
  let answeredCount = 0;
  let completedCount = 0;
  let remainingCount = 0;

  for (const item of items) {
    if (item.wasAnswered) answeredCount += 1;
    if (item.state === "completed") completedCount += 1;
    else if (item.state === "assigned") assignedCount += 1;
    else remainingCount += 1;
  }

  return {
    totalQuestions: items.length,
    assignedCount,
    answeredCount,
    completedCount,
    remainingCount,
  };
}

/**
 * Create a new Full Coverage Cycle snapshot with deduplicated question IDs and shuffled queue order.
 */
export function createCoverageCycle(
  pool: readonly CoveragePoolItemInput[],
  options: {
    id: string;
    title: string;
    questionsPerExam: number;
    allocationStrategy?: AnyAllocationStrategy;
    seed?: string | number;
    rng?: RngFn;
  },
): CoverageCycleState {
  if (!Number.isInteger(options.questionsPerExam) || options.questionsPerExam < 1) {
    throw new CoverageCycleError(
      "INVALID_BATCH_SIZE",
      "Questions per exam must be a positive integer.",
    );
  }

  // Deduplicate by questionId so no question can ever overlap within a cycle
  const seen = new Set<string>();
  const uniquePool: CoveragePoolItemInput[] = [];
  for (const item of pool) {
    if (!seen.has(item.questionId)) {
      seen.add(item.questionId);
      uniquePool.push(item);
    }
  }

  if (uniquePool.length === 0) {
    throw new CoverageCycleError(
      "EMPTY_POOL",
      "Cannot create a Full Coverage Cycle with an empty question pool.",
    );
  }

  const rng: RngFn =
    options.rng ??
    (options.seed !== undefined ? createSeededRng(options.seed) : Math.random);

  const shuffled = fisherYatesShuffle(uniquePool, rng);
  const items: CoverageCycleQuestion[] = shuffled.map((entry, idx) => ({
    questionId: entry.questionId,
    subjectId: entry.subjectId,
    subjectTitle: entry.subjectTitle,
    poolOrder: idx,
    state: "unassigned",
    assignedAttemptId: null,
    completedAttemptId: null,
    wasAnswered: false,
    lastIsCorrect: null,
    timesAssigned: 0,
  }));

  const strategy = normalizeAllocationStrategy(
    options.allocationStrategy ?? "proportional",
  );

  return {
    id: options.id,
    title: options.title,
    status: "active",
    allocationStrategy: strategy,
    questionsPerExam: options.questionsPerExam,
    cycleNumber: 1,
    totalQuestions: items.length,
    assignedCount: 0,
    answeredCount: 0,
    completedCount: 0,
    remainingCount: items.length,
    activeAttemptId: null,
    items,
    attempts: [],
  };
}

/**
 * Issue the next non-overlapping exam in a Full Coverage Cycle.
 * - Rejects if an active attempt is already in progress (`ACTIVE_ATTEMPT_EXISTS`).
 * - Supports smaller final exam without discarding remaining questions.
 * - Guarantees ZERO overlapping question IDs across exams in the cycle.
 */
export function issueNextCoverageExam(
  cycle: CoverageCycleState,
  attemptId: string,
  options?: {
    overrideCount?: number;
    shuffleExamOrder?: boolean;
    seed?: string | number;
    rng?: RngFn;
  },
): {
  cycle: CoverageCycleState;
  attempt: CoverageCycleAttemptRecord;
  selectedQuestionIds: string[];
} {
  if (cycle.activeAttemptId !== null) {
    throw new CoverageCycleError(
      "ACTIVE_ATTEMPT_EXISTS",
      `Cycle already has an active in-progress exam (${cycle.activeAttemptId}). Resume or discard it before issuing the next exam.`,
    );
  }

  const unassigned = cycle.items
    .filter((item) => item.state === "unassigned")
    .sort((a, b) => a.poolOrder - b.poolOrder);

  if (unassigned.length === 0) {
    throw new CoverageCycleError(
      "CYCLE_ALREADY_COMPLETED",
      "All questions in this coverage cycle have already been completed.",
    );
  }

  const requested =
    options?.overrideCount !== undefined
      ? Math.max(1, Math.floor(options.overrideCount))
      : cycle.questionsPerExam;
  const drawSize = Math.min(requested, unassigned.length);

  let drawnItems: CoverageCycleQuestion[];

  // Respect proportional or equal multi-subject distribution across remaining pool when applicable
  if (
    drawSize < unassigned.length &&
    (cycle.allocationStrategy === "proportional" ||
      cycle.allocationStrategy === "equal")
  ) {
    const bySubject = new Map<string, CoverageCycleQuestion[]>();
    for (const item of unassigned) {
      const list = bySubject.get(item.subjectId) ?? [];
      list.push(item);
      bySubject.set(item.subjectId, list);
    }

    if (bySubject.size > 1) {
      const alloc = computeExamAllocation({
        strategy: cycle.allocationStrategy,
        requestedCount: drawSize,
        subjects: Array.from(bySubject.entries()).map(([subjectId, list]) => ({
          subjectId,
          title: list[0].subjectTitle,
          availableCount: list.length,
        })),
      });

      const picked: CoverageCycleQuestion[] = [];
      for (const a of alloc.allocations) {
        const list = bySubject.get(a.subjectId) ?? [];
        const take = a.allocatedCount ?? 0;
        picked.push(...list.slice(0, take));
      }
      drawnItems = picked;
    } else {
      drawnItems = unassigned.slice(0, drawSize);
    }
  } else {
    drawnItems = unassigned.slice(0, drawSize);
  }

  if (options?.shuffleExamOrder) {
    const rng: RngFn =
      options.rng ??
      (options.seed !== undefined ? createSeededRng(options.seed) : Math.random);
    drawnItems = fisherYatesShuffle(drawnItems, rng);
  }

  const drawnSet = new Set(drawnItems.map((d) => d.questionId));
  const nextItems: CoverageCycleQuestion[] = cycle.items.map((item) => {
    if (!drawnSet.has(item.questionId)) return item;
    return {
      ...item,
      state: "assigned",
      assignedAttemptId: attemptId,
      timesAssigned: item.timesAssigned + 1,
    };
  });

  const selectedQuestionIds = drawnItems.map((d) => d.questionId);
  const sequenceNumber = cycle.attempts.length + 1;
  const attemptRecord: CoverageCycleAttemptRecord = {
    attemptId,
    sequenceNumber,
    status: "in_progress",
    assignedQuestionIds: selectedQuestionIds,
    assignedCount: selectedQuestionIds.length,
    answeredCount: 0,
    completedCount: 0,
    correctCount: 0,
  };

  const counts = recomputeCounts(nextItems);
  const nextCycle: CoverageCycleState = {
    ...cycle,
    ...counts,
    activeAttemptId: attemptId,
    items: nextItems,
    attempts: [...cycle.attempts, attemptRecord],
  };

  return {
    cycle: nextCycle,
    attempt: attemptRecord,
    selectedQuestionIds,
  };
}

/**
 * Abandon / discard the currently active in-progress exam.
 * Reverts ALL its `assigned` questions back to `unassigned` without marking ANY completed!
 */
export function discardActiveCoverageExam(
  cycle: CoverageCycleState,
  attemptId?: string,
): CoverageCycleState {
  if (cycle.activeAttemptId === null) {
    throw new CoverageCycleError(
      "NO_ACTIVE_ATTEMPT",
      "There is no active in-progress exam to discard.",
    );
  }
  if (attemptId && attemptId !== cycle.activeAttemptId) {
    throw new CoverageCycleError(
      "ATTEMPT_MISMATCH",
      `Attempt ${attemptId} is not the active attempt (${cycle.activeAttemptId}).`,
    );
  }

  const targetAttemptId = cycle.activeAttemptId;
  const nextItems: CoverageCycleQuestion[] = cycle.items.map((item) => {
    if (item.state === "assigned" && item.assignedAttemptId === targetAttemptId) {
      return {
        ...item,
        state: "unassigned",
        assignedAttemptId: null,
      };
    }
    return item;
  });

  const nextAttempts: CoverageCycleAttemptRecord[] = cycle.attempts.map((a) =>
    a.attemptId === targetAttemptId ? { ...a, status: "discarded" } : a,
  );

  const counts = recomputeCounts(nextItems);
  return {
    ...cycle,
    ...counts,
    status: "active",
    activeAttemptId: null,
    items: nextItems,
    attempts: nextAttempts,
  };
}

/**
 * Complete/submit an active exam inside a Full Coverage Cycle.
 * Tracks `assigned` vs `answered` vs `completed` separately:
 * - Answered questions transition `assigned -> completed` (`wasAnswered = true`).
 * - Unanswered questions revert `assigned -> unassigned` so they are never silently dropped from 100% coverage!
 */
export function completeCoverageExam(
  cycle: CoverageCycleState,
  attemptId: string,
  outcomes: readonly CoverageExamOutcome[],
): CoverageCycleState {
  if (cycle.activeAttemptId !== attemptId) {
    throw new CoverageCycleError(
      "ATTEMPT_MISMATCH",
      `Attempt ${attemptId} does not match active cycle attempt (${cycle.activeAttemptId ?? "none"}).`,
    );
  }

  const outcomeMap = new Map<string, CoverageExamOutcome>();
  for (const o of outcomes) {
    outcomeMap.set(o.questionId, o);
  }

  let attemptAnswered = 0;
  let attemptCompleted = 0;
  let attemptCorrect = 0;

  const nextItems: CoverageCycleQuestion[] = cycle.items.map((item) => {
    if (item.state !== "assigned" || item.assignedAttemptId !== attemptId) {
      return item;
    }
    const outcome = outcomeMap.get(item.questionId);
    const wasAnswered = Boolean(outcome?.wasAnswered);

    if (wasAnswered) {
      attemptAnswered += 1;
      attemptCompleted += 1;
      if (outcome?.isCorrect) attemptCorrect += 1;
      return {
        ...item,
        state: "completed",
        assignedAttemptId: null,
        completedAttemptId: attemptId,
        wasAnswered: true,
        lastIsCorrect: Boolean(outcome?.isCorrect),
      };
    }

    // Unanswered question returns to remaining pool (NEVER silently marked completed!)
    return {
      ...item,
      state: "unassigned",
      assignedAttemptId: null,
      wasAnswered: false,
    };
  });

  const nextAttempts: CoverageCycleAttemptRecord[] = cycle.attempts.map((a) =>
    a.attemptId === attemptId
      ? {
          ...a,
          status: "completed",
          answeredCount: attemptAnswered,
          completedCount: attemptCompleted,
          correctCount: attemptCorrect,
        }
      : a,
  );

  const counts = recomputeCounts(nextItems);
  const isAllDone = counts.remainingCount === 0 && counts.assignedCount === 0;

  return {
    ...cycle,
    ...counts,
    status: isAllDone ? "completed" : "active",
    activeAttemptId: null,
    items: nextItems,
    attempts: nextAttempts,
  };
}

/**
 * Restart a Full Coverage Cycle for another full pass (`cycleNumber + 1`),
 * preserving historical attempts while resetting all questions to `unassigned` in a freshly shuffled order.
 */
export function restartCoverageCycle(
  cycle: CoverageCycleState,
  options?: {
    forceDiscardActive?: boolean;
    refreshedPool?: readonly CoveragePoolItemInput[];
    seed?: string | number;
    rng?: RngFn;
  },
): CoverageCycleState {
  let working = cycle;
  if (working.activeAttemptId !== null) {
    if (!options?.forceDiscardActive) {
      throw new CoverageCycleError(
        "ACTIVE_ATTEMPT_EXISTS",
        "Cannot restart a cycle while an exam is still in progress unless forceDiscardActive is true.",
      );
    }
    working = discardActiveCoverageExam(working);
  }

  const sourcePool: CoveragePoolItemInput[] = options?.refreshedPool
    ? (() => {
        const seen = new Set<string>();
        const list: CoveragePoolItemInput[] = [];
        for (const p of options.refreshedPool) {
          if (!seen.has(p.questionId)) {
            seen.add(p.questionId);
            list.push(p);
          }
        }
        return list;
      })()
    : working.items.map((item) => ({
        questionId: item.questionId,
        subjectId: item.subjectId,
        subjectTitle: item.subjectTitle,
      }));

  if (sourcePool.length === 0) {
    throw new CoverageCycleError(
      "EMPTY_POOL",
      "Cannot restart coverage cycle with an empty question pool.",
    );
  }

  const rng: RngFn =
    options?.rng ??
    (options?.seed !== undefined ? createSeededRng(options.seed) : Math.random);

  const shuffled = fisherYatesShuffle(sourcePool, rng);
  const nextItems: CoverageCycleQuestion[] = shuffled.map((entry, idx) => ({
    questionId: entry.questionId,
    subjectId: entry.subjectId,
    subjectTitle: entry.subjectTitle,
    poolOrder: idx,
    state: "unassigned",
    assignedAttemptId: null,
    completedAttemptId: null,
    wasAnswered: false,
    lastIsCorrect: null,
    timesAssigned: 0,
  }));

  return {
    ...working,
    status: "active",
    cycleNumber: working.cycleNumber + 1,
    totalQuestions: nextItems.length,
    assignedCount: 0,
    answeredCount: 0,
    completedCount: 0,
    remainingCount: nextItems.length,
    activeAttemptId: null,
    items: nextItems,
  };
}

/**
 * Compute detailed tri-state progress summary & per-subject coverage breakdown for dashboard UI.
 */
export function getCoverageProgressSummary(
  cycle: CoverageCycleState,
): CoverageProgressSummary {
  const total = cycle.totalQuestions;
  const pct = (n: number) =>
    total === 0 ? 0 : Math.round((n / total) * 10_000) / 100;

  const subjectMap = new Map<string, CoverageSubjectProgress>();
  const mistakeQuestionIds: string[] = [];

  for (const item of cycle.items) {
    let bucket = subjectMap.get(item.subjectId);
    if (!bucket) {
      bucket = {
        subjectId: item.subjectId,
        subjectTitle: item.subjectTitle,
        total: 0,
        completed: 0,
        assigned: 0,
        remaining: 0,
        completedPercent: 0,
      };
      subjectMap.set(item.subjectId, bucket);
    }
    bucket.total += 1;
    if (item.state === "completed") bucket.completed += 1;
    else if (item.state === "assigned") bucket.assigned += 1;
    else bucket.remaining += 1;

    if (item.state === "completed" && item.lastIsCorrect === false) {
      mistakeQuestionIds.push(item.questionId);
    }
  }

  const perSubject = Array.from(subjectMap.values()).map((b) => ({
    ...b,
    completedPercent:
      b.total === 0 ? 0 : Math.round((b.completed / b.total) * 10_000) / 100,
  }));

  const remainingPlan = planCoverageSeries(
    cycle.remainingCount,
    cycle.questionsPerExam,
  );

  return {
    totalQuestions: total,
    completedCount: cycle.completedCount,
    assignedCount: cycle.assignedCount,
    answeredCount: cycle.answeredCount,
    remainingCount: cycle.remainingCount,
    completedPercent: pct(cycle.completedCount),
    inProgressPercent: pct(cycle.assignedCount),
    remainingPercent: pct(cycle.remainingCount),
    plannedRemainingExamSizes: remainingPlan.examSizes,
    perSubject,
    mistakeQuestionIds,
  };
}
