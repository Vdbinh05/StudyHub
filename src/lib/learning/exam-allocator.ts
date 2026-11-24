import type { AllocationStrategy } from "@/types/domain";
import { fisherYatesShuffle, type RngFn } from "./shuffle";

export type { AllocationStrategy };

export type ApiAllocationStrategy =
  | "unweighted_random"
  | "equal"
  | "proportional"
  | "custom_counts"
  | "custom_percentages";

export type AnyAllocationStrategy = AllocationStrategy | ApiAllocationStrategy;

export function normalizeAllocationStrategy(
  strategy: AnyAllocationStrategy,
): AllocationStrategy {
  switch (strategy) {
    case "unweighted_random":
    case "global_random":
      return "global_random";
    case "equal":
      return "equal";
    case "proportional":
      return "proportional";
    case "custom_counts":
    case "custom":
      return "custom";
    case "custom_percentages":
    case "weighted":
      return "weighted";
  }
}

export function toApiAllocationStrategy(
  strategy: AnyAllocationStrategy,
): ApiAllocationStrategy {
  const canonical = normalizeAllocationStrategy(strategy);
  switch (canonical) {
    case "global_random":
      return "unweighted_random";
    case "equal":
      return "equal";
    case "proportional":
      return "proportional";
    case "custom":
      return "custom_counts";
    case "weighted":
      return "custom_percentages";
  }
}

export type QuestionCountErrorCode =
  | "INVALID_NUMBER"
  | "NON_INTEGER"
  | "NON_POSITIVE"
  | "NO_ELIGIBLE_QUESTIONS"
  | "EXCEEDS_AVAILABLE"
  | "EXCEEDS_MAX_LIMIT";

export interface QuestionCountValidationResult {
  valid: boolean;
  value: number | null;
  code?: QuestionCountErrorCode;
  message?: string;
  available: number;
  maxTechnicalLimit: number;
}

/**
 * Strictly validate requested question count without EVER silently reducing or clamping.
 * Rejects 0, negative, decimals, NaN/text, >available, and >maxTechnicalLimit.
 */
export function validateQuestionCount(
  requested: unknown,
  available: number,
  maxTechnicalLimit: number = 5000,
): QuestionCountValidationResult {
  const safeAvailable = Number.isInteger(available) && available >= 0 ? available : 0;
  const safeMaxLimit =
    Number.isInteger(maxTechnicalLimit) && maxTechnicalLimit >= 1
      ? maxTechnicalLimit
      : 5000;

  if (safeAvailable === 0) {
    return {
      valid: false,
      value: null,
      code: "NO_ELIGIBLE_QUESTIONS",
      message: "No eligible questions are available for the selected sources and filters.",
      available: 0,
      maxTechnicalLimit: safeMaxLimit,
    };
  }

  let parsed: number;
  if (typeof requested === "number") {
    parsed = requested;
  } else if (typeof requested === "string") {
    const trimmed = requested.trim();
    if (!trimmed) {
      return {
        valid: false,
        value: null,
        code: "INVALID_NUMBER",
        message: "Question count must be a valid integer.",
        available: safeAvailable,
        maxTechnicalLimit: safeMaxLimit,
      };
    }
    if (!/^[+-]?\d+(\.\d+)?$/.test(trimmed)) {
      return {
        valid: false,
        value: null,
        code: "INVALID_NUMBER",
        message: "Question count must be a valid integer.",
        available: safeAvailable,
        maxTechnicalLimit: safeMaxLimit,
      };
    }
    if (trimmed.includes(".")) {
      return {
        valid: false,
        value: null,
        code: "NON_INTEGER",
        message: "Question count must be a whole integer (decimals are not allowed).",
        available: safeAvailable,
        maxTechnicalLimit: safeMaxLimit,
      };
    }
    parsed = Number(trimmed);
  } else {
    return {
      valid: false,
      value: null,
      code: "INVALID_NUMBER",
      message: "Question count must be a valid integer.",
      available: safeAvailable,
      maxTechnicalLimit: safeMaxLimit,
    };
  }

  if (!Number.isFinite(parsed) || Number.isNaN(parsed)) {
    return {
      valid: false,
      value: null,
      code: "INVALID_NUMBER",
      message: "Question count must be a valid integer.",
      available: safeAvailable,
      maxTechnicalLimit: safeMaxLimit,
    };
  }

  if (!Number.isInteger(parsed)) {
    return {
      valid: false,
      value: null,
      code: "NON_INTEGER",
      message: "Question count must be a whole integer (decimals are not allowed).",
      available: safeAvailable,
      maxTechnicalLimit: safeMaxLimit,
    };
  }

  if (parsed <= 0) {
    return {
      valid: false,
      value: null,
      code: "NON_POSITIVE",
      message: "Question count must be at least 1.",
      available: safeAvailable,
      maxTechnicalLimit: safeMaxLimit,
    };
  }

  if (parsed > safeMaxLimit) {
    return {
      valid: false,
      value: null,
      code: "EXCEEDS_MAX_LIMIT",
      message: `Question count (${parsed}) exceeds the maximum technical limit of ${safeMaxLimit}.`,
      available: safeAvailable,
      maxTechnicalLimit: safeMaxLimit,
    };
  }

  if (parsed > safeAvailable) {
    return {
      valid: false,
      value: null,
      code: "EXCEEDS_AVAILABLE",
      message: `Requested ${parsed} questions, but only ${safeAvailable} eligible questions are available.`,
      available: safeAvailable,
      maxTechnicalLimit: safeMaxLimit,
    };
  }

  return {
    valid: true,
    value: parsed,
    available: safeAvailable,
    maxTechnicalLimit: safeMaxLimit,
  };
}

export interface AllocationSubjectInput {
  subjectId: string;
  title?: string;
  availableCount: number;
  /** Used by Strategy D ('custom') */
  customCount?: number;
  /** Percentage weight 0..100 used by Strategy E ('weighted') */
  weightPercent?: number;
}

export interface SubjectAllocationPreview {
  subjectId: string;
  title: string;
  availableCount: number;
  /** Exact quota to draw. `null` for Strategy A ('global_random') prior to actual sampling! */
  allocatedCount: number | null;
  /** Unconstrained ideal target before capacity capping (for transparency on redistribution). */
  idealCount: number | null;
  /** Expected mean share for informational display (useful for global_random). */
  expectedMean: number;
  minPossible: number;
  maxPossible: number;
  sharePercent: number;
  wasCapped: boolean;
  shortfall: number;
}

export interface AllocationValidationError {
  code:
    | QuestionCountErrorCode
    | "EMPTY_SUBJECTS"
    | "CUSTOM_INVALID_COUNT"
    | "CUSTOM_EXCEEDS_AVAILABLE"
    | "CUSTOM_SUM_MISMATCH"
    | "WEIGHT_INVALID"
    | "WEIGHTS_SUM_NOT_100";
  message: string;
  subjectId?: string;
}

export interface AllocationResult {
  valid: boolean;
  strategy: AllocationStrategy;
  requestedCount: number;
  totalAvailable: number;
  /** Total allocated across subjects; `null` only if invalid, equals `requestedCount` when valid. */
  totalAllocated: number;
  /** True for global_random where exact per-subject counts are determined only upon sampling. */
  isDynamicSampling: boolean;
  /** True if capacity constraints caused redistribution from ideal shares. */
  wasRedistributed: boolean;
  /** True when user should explicitly confirm adjusted quotas (e.g., weighted strategy hit capacity cap). */
  requiresConfirmation: boolean;
  /** For Strategy D ('custom'): requestedCount - sum(customCounts). 0 when valid. */
  remainingUnallocated: number;
  /** For Strategy E ('weighted'): exact sum of provided percentage weights. */
  weightSumPercent: number | null;
  allocations: SubjectAllocationPreview[];
  errors: AllocationValidationError[];
  warnings: string[];
}

export interface ComputeAllocationOptions {
  strategy: AnyAllocationStrategy;
  subjects: readonly AllocationSubjectInput[];
  requestedCount: unknown;
  maxTechnicalLimit?: number;
}

interface InternalSubject {
  idx: number;
  subjectId: string;
  title: string;
  availableCount: number;
  customCount?: number;
  weightPercent?: number;
}

/**
 * Exact integer Largest Remainder allocation (Hamilton's Method) using BigInt
 * to guarantee zero IEEE-754 floating-point drift.
 */
function largestRemainderExact(
  totalSeats: number,
  weights: readonly bigint[],
  tieBreakCapacities: readonly number[],
): number[] {
  const n = weights.length;
  const result = new Array<number>(n).fill(0);
  if (totalSeats <= 0 || n === 0) return result;

  let weightSum = BigInt(0);
  for (const w of weights) {
    weightSum += w;
  }
  if (weightSum <= BigInt(0)) return result;

  const bigSeats = BigInt(totalSeats);
  const remainders: Array<{ idx: number; rem: bigint; cap: number }> = [];
  let assigned = 0;

  for (let i = 0; i < n; i++) {
    const num = bigSeats * weights[i];
    const floorVal = Number(num / weightSum);
    const rem = num % weightSum;
    result[i] = floorVal;
    assigned += floorVal;
    remainders.push({ idx: i, rem, cap: tieBreakCapacities[i] });
  }

  const leftover = totalSeats - assigned;
  if (leftover > 0) {
    // Deterministic sort: highest exact remainder -> highest capacity -> original index
    remainders.sort((a, b) => {
      if (a.rem !== b.rem) return a.rem > b.rem ? -1 : 1;
      if (a.cap !== b.cap) return b.cap - a.cap;
      return a.idx - b.idx;
    });

    for (let k = 0; k < leftover && k < remainders.length; k++) {
      result[remainders[k].idx] += 1;
    }
  }

  return result;
}

/**
 * Iterative capacity-constrained Largest Remainder allocation.
 * Guarantees:
 * - 0 <= allocated[i] <= capacities[i] for every i
 * - sum(allocated) === target (whenever target <= sum(capacities))
 * - Zero floating-point drift via BigInt exact rationals
 */
function allocateWithCapacityRedistribution(
  target: number,
  weights: readonly bigint[],
  capacities: readonly number[],
): {
  allocated: number[];
  ideal: number[];
  wasRedistributed: boolean;
  cappedIndices: Set<number>;
} {
  const n = capacities.length;
  const allocated = new Array<number>(n).fill(0);
  const cappedIndices = new Set<number>();

  // Unconstrained ideal allocation (before capacity capping)
  const ideal = largestRemainderExact(target, weights, capacities);
  let wasRedistributed = false;

  const active = new Set<number>();
  for (let i = 0; i < n; i++) {
    if (capacities[i] > 0 && weights[i] > BigInt(0)) {
      active.add(i);
    }
  }

  let remainingTarget = target;

  while (remainingTarget > 0 && active.size > 0) {
    const activeIndices = Array.from(active);
    const activeWeights = activeIndices.map((i) => weights[i]);
    const activeCaps = activeIndices.map((i) => capacities[i] - allocated[i]);

    const provisional = largestRemainderExact(
      remainingTarget,
      activeWeights,
      activeCaps,
    );

    let anyCappedInPass = false;
    for (let k = 0; k < activeIndices.length; k++) {
      const idx = activeIndices[k];
      const remCap = capacities[idx] - allocated[idx];
      if (provisional[k] >= remCap && remCap > 0 && provisional[k] > remCap) {
        allocated[idx] = capacities[idx];
        remainingTarget -= remCap;
        active.delete(idx);
        cappedIndices.add(idx);
        wasRedistributed = true;
        anyCappedInPass = true;
      }
    }

    if (!anyCappedInPass) {
      // Check if any subject was exactly equal to capacity and got capped relative to ideal
      for (let k = 0; k < activeIndices.length; k++) {
        const idx = activeIndices[k];
        allocated[idx] += provisional[k];
        remainingTarget -= provisional[k];
        if (allocated[idx] < ideal[idx]) {
          cappedIndices.add(idx);
          wasRedistributed = true;
        }
      }
      break;
    }
  }

  // Fallback if positive-weight subjects were all exhausted before meeting target:
  // Fill remaining seats proportionally from remaining subjects that still have capacity.
  if (remainingTarget > 0) {
    const fallbackIndices: number[] = [];
    for (let i = 0; i < n; i++) {
      if (capacities[i] - allocated[i] > 0) {
        fallbackIndices.push(i);
      }
    }

    if (fallbackIndices.length > 0) {
      wasRedistributed = true;
      const fbCaps = fallbackIndices.map((i) => capacities[i] - allocated[i]);
      const fbWeights = fbCaps.map((c) => BigInt(c));
      const fbAlloc = largestRemainderExact(remainingTarget, fbWeights, fbCaps);
      for (let k = 0; k < fallbackIndices.length; k++) {
        const idx = fallbackIndices[k];
        allocated[idx] += fbAlloc[k];
        remainingTarget -= fbAlloc[k];
      }
    }
  }

  // Mark any index whose final allocation < ideal as capped/redistributed
  for (let i = 0; i < n; i++) {
    if (allocated[i] < ideal[i]) {
      cappedIndices.add(i);
      wasRedistributed = true;
    }
  }

  return { allocated, ideal, wasRedistributed, cappedIndices };
}

/**
 * Compute deterministic exam question allocations for all 5 V2.0 strategies (A–E).
 */
export function computeExamAllocation(
  options: ComputeAllocationOptions,
): AllocationResult {
  const strategy = normalizeAllocationStrategy(options.strategy);
  const maxTechnicalLimit = options.maxTechnicalLimit ?? 5000;

  // Deduplicate subjects by subjectId preserving first appearance
  const seenIds = new Set<string>();
  const subjects: InternalSubject[] = [];
  for (const s of options.subjects) {
    if (seenIds.has(s.subjectId)) continue;
    seenIds.add(s.subjectId);
    subjects.push({
      idx: subjects.length,
      subjectId: s.subjectId,
      title: s.title ?? s.subjectId,
      availableCount:
        Number.isInteger(s.availableCount) && s.availableCount >= 0
          ? s.availableCount
          : 0,
      customCount: s.customCount,
      weightPercent: s.weightPercent,
    });
  }

  const totalAvailable = subjects.reduce((sum, s) => sum + s.availableCount, 0);

  if (subjects.length === 0) {
    return {
      valid: false,
      strategy,
      requestedCount: 0,
      totalAvailable: 0,
      totalAllocated: 0,
      isDynamicSampling: strategy === "global_random",
      wasRedistributed: false,
      requiresConfirmation: false,
      remainingUnallocated: 0,
      weightSumPercent: null,
      allocations: [],
      errors: [
        {
          code: "EMPTY_SUBJECTS",
          message: "Select at least one study set or folder.",
        },
      ],
      warnings: [],
    };
  }

  const countCheck = validateQuestionCount(
    options.requestedCount,
    totalAvailable,
    maxTechnicalLimit,
  );

  if (!countCheck.valid || countCheck.value === null) {
    return {
      valid: false,
      strategy,
      requestedCount:
        typeof options.requestedCount === "number" &&
        Number.isFinite(options.requestedCount)
          ? options.requestedCount
          : 0,
      totalAvailable,
      totalAllocated: 0,
      isDynamicSampling: strategy === "global_random",
      wasRedistributed: false,
      requiresConfirmation: false,
      remainingUnallocated: 0,
      weightSumPercent: null,
      allocations: subjects.map((s) => ({
        subjectId: s.subjectId,
        title: s.title,
        availableCount: s.availableCount,
        allocatedCount: strategy === "global_random" ? null : 0,
        idealCount: null,
        expectedMean: 0,
        minPossible: 0,
        maxPossible: s.availableCount,
        sharePercent: 0,
        wasCapped: false,
        shortfall: 0,
      })),
      errors: [
        {
          code: countCheck.code ?? "INVALID_NUMBER",
          message: countCheck.message ?? "Invalid question count.",
        },
      ],
      warnings: [],
    };
  }

  const requestedCount = countCheck.value;
  const capacities = subjects.map((s) => s.availableCount);

  // =========================================================================
  // Strategy A: Global Random (`global_random`)
  // Uniform random sampling across combined deduplicated pool.
  // NEVER fake exact per-subject preview quotas before sampling!
  // =========================================================================
  if (strategy === "global_random") {
    const allocations: SubjectAllocationPreview[] = subjects.map((s) => {
      const otherAvail = totalAvailable - s.availableCount;
      const minPossible = Math.max(0, requestedCount - otherAvail);
      const maxPossible = Math.min(requestedCount, s.availableCount);
      const expectedMean =
        totalAvailable > 0
          ? Math.round(((requestedCount * s.availableCount) / totalAvailable) * 100) /
            100
          : 0;
      const sharePercent =
        totalAvailable > 0
          ? Math.round((s.availableCount / totalAvailable) * 10_000) / 100
          : 0;

      return {
        subjectId: s.subjectId,
        title: s.title,
        availableCount: s.availableCount,
        allocatedCount: null, // Explicitly null — determined only upon sampling!
        idealCount: null,
        expectedMean,
        minPossible,
        maxPossible,
        sharePercent,
        wasCapped: false,
        shortfall: 0,
      };
    });

    return {
      valid: true,
      strategy,
      requestedCount,
      totalAvailable,
      totalAllocated: requestedCount,
      isDynamicSampling: true,
      wasRedistributed: false,
      requiresConfirmation: false,
      remainingUnallocated: 0,
      weightSumPercent: null,
      allocations,
      errors: [],
      warnings: [
        "Global Random samples uniformly without replacement from the combined pool when the exam starts; per-subject counts are not pre-fixed.",
      ],
    };
  }

  // =========================================================================
  // Strategy B: Equal (`equal`)
  // Equal share across non-empty subjects + iterative capacity redistribution.
  // =========================================================================
  if (strategy === "equal") {
    const weights = subjects.map((s) =>
      s.availableCount > 0 ? BigInt(1) : BigInt(0),
    );
    const { allocated, ideal, wasRedistributed, cappedIndices } =
      allocateWithCapacityRedistribution(requestedCount, weights, capacities);

    const allocations: SubjectAllocationPreview[] = subjects.map((s, i) => ({
      subjectId: s.subjectId,
      title: s.title,
      availableCount: s.availableCount,
      allocatedCount: allocated[i],
      idealCount: ideal[i],
      expectedMean: allocated[i],
      minPossible: allocated[i],
      maxPossible: allocated[i],
      sharePercent:
        requestedCount > 0
          ? Math.round((allocated[i] / requestedCount) * 10_000) / 100
          : 0,
      wasCapped: cappedIndices.has(i),
      shortfall: Math.max(0, ideal[i] - allocated[i]),
    }));

    const warnings: string[] = [];
    if (wasRedistributed) {
      warnings.push(
        "Some subjects had fewer questions than an equal share; remaining slots were redistributed across subjects with spare capacity.",
      );
    }

    return {
      valid: true,
      strategy,
      requestedCount,
      totalAvailable,
      totalAllocated: allocated.reduce((a, b) => a + b, 0),
      isDynamicSampling: false,
      wasRedistributed,
      requiresConfirmation: false,
      remainingUnallocated: 0,
      weightSumPercent: null,
      allocations,
      errors: [],
      warnings,
    };
  }

  // =========================================================================
  // Strategy C: Proportional (`proportional`)
  // Exact Hamilton / Largest Remainder Method + capacity redistribution.
  // Verified: [500, 226, 133] for N=250 -> exact [145, 66, 39] (sum 250).
  // =========================================================================
  if (strategy === "proportional") {
    const weights = subjects.map((s) => BigInt(s.availableCount));
    const { allocated, ideal, wasRedistributed, cappedIndices } =
      allocateWithCapacityRedistribution(requestedCount, weights, capacities);

    const allocations: SubjectAllocationPreview[] = subjects.map((s, i) => ({
      subjectId: s.subjectId,
      title: s.title,
      availableCount: s.availableCount,
      allocatedCount: allocated[i],
      idealCount: ideal[i],
      expectedMean: allocated[i],
      minPossible: allocated[i],
      maxPossible: allocated[i],
      sharePercent:
        requestedCount > 0
          ? Math.round((allocated[i] / requestedCount) * 10_000) / 100
          : 0,
      wasCapped: cappedIndices.has(i),
      shortfall: Math.max(0, ideal[i] - allocated[i]),
    }));

    return {
      valid: true,
      strategy,
      requestedCount,
      totalAvailable,
      totalAllocated: allocated.reduce((a, b) => a + b, 0),
      isDynamicSampling: false,
      wasRedistributed,
      requiresConfirmation: false,
      remainingUnallocated: 0,
      weightSumPercent: null,
      allocations,
      errors: [],
      warnings: [],
    };
  }

  // =========================================================================
  // Strategy D: Custom (`custom`)
  // Exact user-defined counts with strict per-subject & sum validation.
  // =========================================================================
  if (strategy === "custom") {
    const errors: AllocationValidationError[] = [];
    const customCounts: number[] = [];
    let sumCustom = 0;

    for (const s of subjects) {
      const raw = s.customCount ?? 0;
      if (
        typeof raw !== "number" ||
        !Number.isFinite(raw) ||
        !Number.isInteger(raw) ||
        raw < 0
      ) {
        errors.push({
          code: "CUSTOM_INVALID_COUNT",
          subjectId: s.subjectId,
          message: `Custom count for "${s.title}" must be a non-negative integer.`,
        });
        customCounts.push(0);
        continue;
      }

      if (raw > s.availableCount) {
        errors.push({
          code: "CUSTOM_EXCEEDS_AVAILABLE",
          subjectId: s.subjectId,
          message: `Custom count (${raw}) for "${s.title}" exceeds its available pool (${s.availableCount}).`,
        });
      }

      customCounts.push(raw);
      sumCustom += raw;
    }

    const remainingUnallocated = requestedCount - sumCustom;
    if (remainingUnallocated !== 0) {
      errors.push({
        code: "CUSTOM_SUM_MISMATCH",
        message:
          remainingUnallocated > 0
            ? `Custom counts sum to ${sumCustom}, leaving ${remainingUnallocated} unallocated questions out of ${requestedCount}.`
            : `Custom counts sum to ${sumCustom}, exceeding the requested total of ${requestedCount} by ${Math.abs(remainingUnallocated)}.`,
      });
    }

    const allocations: SubjectAllocationPreview[] = subjects.map((s, i) => ({
      subjectId: s.subjectId,
      title: s.title,
      availableCount: s.availableCount,
      allocatedCount: customCounts[i],
      idealCount: customCounts[i],
      expectedMean: customCounts[i],
      minPossible: customCounts[i],
      maxPossible: customCounts[i],
      sharePercent:
        requestedCount > 0
          ? Math.round((customCounts[i] / requestedCount) * 10_000) / 100
          : 0,
      wasCapped: customCounts[i] > s.availableCount,
      shortfall: Math.max(0, customCounts[i] - s.availableCount),
    }));

    return {
      valid: errors.length === 0,
      strategy,
      requestedCount,
      totalAvailable,
      totalAllocated: sumCustom,
      isDynamicSampling: false,
      wasRedistributed: false,
      requiresConfirmation: false,
      remainingUnallocated,
      weightSumPercent: null,
      allocations,
      errors,
      warnings: [],
    };
  }

  // =========================================================================
  // Strategy E: Weighted (`weighted`)
  // Percentage weights MUST strictly total 100% -> integer quotas via Largest
  // Remainder + capacity-constrained redistribution with explicit confirmation flag!
  // =========================================================================
  const errors: AllocationValidationError[] = [];
  const weightBasisPoints: bigint[] = [];
  let rawWeightSum = 0;
  let totalBasisPoints = 0;

  for (const s of subjects) {
    const raw = s.weightPercent ?? 0;
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > 100) {
      errors.push({
        code: "WEIGHT_INVALID",
        subjectId: s.subjectId,
        message: `Weight for "${s.title}" must be a number between 0 and 100.`,
      });
      weightBasisPoints.push(BigInt(0));
      continue;
    }
    rawWeightSum += raw;
    const bp = Math.round(raw * 100);
    totalBasisPoints += bp;
    weightBasisPoints.push(BigInt(bp));
  }

  const normalizedWeightSum = Math.round(rawWeightSum * 100) / 100;
  if (errors.length === 0 && (totalBasisPoints !== 10_000 || Math.abs(rawWeightSum - 100) > 1e-6)) {
    errors.push({
      code: "WEIGHTS_SUM_NOT_100",
      message: `Percentage weights must total exactly 100% (currently ${normalizedWeightSum}%).`,
    });
  }

  if (errors.length > 0) {
    return {
      valid: false,
      strategy,
      requestedCount,
      totalAvailable,
      totalAllocated: 0,
      isDynamicSampling: false,
      wasRedistributed: false,
      requiresConfirmation: false,
      remainingUnallocated: 0,
      weightSumPercent: normalizedWeightSum,
      allocations: subjects.map((s) => ({
        subjectId: s.subjectId,
        title: s.title,
        availableCount: s.availableCount,
        allocatedCount: 0,
        idealCount: 0,
        expectedMean: 0,
        minPossible: 0,
        maxPossible: s.availableCount,
        sharePercent: s.weightPercent ?? 0,
        wasCapped: false,
        shortfall: 0,
      })),
      errors,
      warnings: [],
    };
  }

  const { allocated, ideal, wasRedistributed, cappedIndices } =
    allocateWithCapacityRedistribution(
      requestedCount,
      weightBasisPoints,
      capacities,
    );

  const allocations: SubjectAllocationPreview[] = subjects.map((s, i) => ({
    subjectId: s.subjectId,
    title: s.title,
    availableCount: s.availableCount,
    allocatedCount: allocated[i],
    idealCount: ideal[i],
    expectedMean: allocated[i],
    minPossible: allocated[i],
    maxPossible: allocated[i],
    sharePercent:
      requestedCount > 0
        ? Math.round((allocated[i] / requestedCount) * 10_000) / 100
        : 0,
    wasCapped: cappedIndices.has(i),
    shortfall: Math.max(0, ideal[i] - allocated[i]),
  }));

  const warnings: string[] = [];
  if (wasRedistributed) {
    warnings.push(
      "One or more weighted subjects hit their available question cap. Excess slots were redistributed to remaining subjects — please review and confirm the adjusted preview.",
    );
  }

  return {
    valid: true,
    strategy,
    requestedCount,
    totalAvailable,
    totalAllocated: allocated.reduce((a, b) => a + b, 0),
    isDynamicSampling: false,
    wasRedistributed,
    requiresConfirmation: wasRedistributed,
    remainingUnallocated: 0,
    weightSumPercent: normalizedWeightSum,
    allocations,
    errors: [],
    warnings,
  };
}

/**
 * Helper for Strategy A (`global_random`): uniform partial Fisher-Yates sampling without replacement
 * over a combined deduplicated pool. O(N) dedup + O(K) sampling.
 */
export function sampleGlobalRandomPool<
  T extends { id: string; subjectId: string },
>(
  pool: readonly T[],
  requestedCount: number,
  rng: RngFn = Math.random,
): {
  selected: T[];
  realizedCountsBySubject: Record<string, number>;
} {
  // Deduplicate by question id preserving deterministic base array
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const item of pool) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      unique.push(item);
    }
  }

  const count = Math.min(unique.length, Math.max(0, Math.floor(requestedCount)));
  // Partial Fisher-Yates from the front: uniform without replacement in O(count) swaps
  for (let i = 0; i < count; i++) {
    const j = i + Math.floor(rng() * (unique.length - i));
    const tmp = unique[i];
    unique[i] = unique[j];
    unique[j] = tmp;
  }

  const selected = unique.slice(0, count);
  const realizedCountsBySubject: Record<string, number> = {};
  for (const item of selected) {
    realizedCountsBySubject[item.subjectId] =
      (realizedCountsBySubject[item.subjectId] ?? 0) + 1;
  }

  return { selected, realizedCountsBySubject };
}

/**
 * Utility for Strategy D (`custom`) UI: auto-fill custom counts using proportional allocation
 * so the sum matches `requestedCount` cleanly.
 */
export function suggestCustomCounts(
  subjects: readonly AllocationSubjectInput[],
  requestedCount: number,
): Record<string, number> {
  const res = computeExamAllocation({
    strategy: "proportional",
    subjects,
    requestedCount,
  });
  const map: Record<string, number> = {};
  for (const a of res.allocations) {
    map[a.subjectId] = a.allocatedCount ?? 0;
  }
  return map;
}

/**
 * Utility for Strategy E (`weighted`) UI: generate exact 100.00% equal initial percentage weights.
 */
export function suggestEqualWeights(
  subjectIds: readonly string[],
): Record<string, number> {
  const n = subjectIds.length;
  const map: Record<string, number> = {};
  if (n === 0) return map;

  const baseBp = Math.floor(10_000 / n);
  const remBp = 10_000 - baseBp * n;
  for (let i = 0; i < n; i++) {
    const bp = baseBp + (i < remBp ? 1 : 0);
    map[subjectIds[i]] = bp / 100;
  }
  return map;
}

/**
 * Helper to shuffle final exam question list uniformly via Fisher-Yates.
 */
export function shuffleAllocatedExamItems<T>(
  items: readonly T[],
  rng: RngFn = Math.random,
): T[] {
  return fisherYatesShuffle(items, rng);
}
