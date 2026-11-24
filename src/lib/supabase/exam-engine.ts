import { randomInt } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type {
  AllocationStrategy,
  ExamAllocationPreviewItem,
  ExamEligiblePool,
  ExamFilterConfig,
  ExamPreviewResult,
  ExamPreviewWarning,
  ExamSnapshotQuestion,
  ExamSourceInput,
  SelectionPolicy,
} from "@/types/domain";
import { MAX_EXAM_QUESTIONS } from "@/lib/validation/exams";
import {
  chunkArray,
  fetchAllPages,
  fetchInChunks,
  SAFE_IN_CHUNK_SIZE,
} from "./query-helpers";
import { rpcGetExamEligiblePool, rpcResolveDedupedStudySets } from "./rpc";

/**
 * Cryptographic Fisher-Yates shuffle without replacement using `node:crypto.randomInt`.
 */
export function cryptoShuffle<T>(items: readonly T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/**
 * Splits `sources` into deduplicated `folderIds` and `studySetIds` plus per-set custom overrides.
 */
export function extractSourceIds(sources: readonly ExamSourceInput[]): {
  folderIds: string[];
  studySetIds: string[];
  includeSubfolders: boolean;
  customCountsBySet: Map<string, number>;
  customPercentagesBySet: Map<string, number>;
} {
  const folderSet = new Set<string>();
  const setSet = new Set<string>();
  let includeSubfolders = false;
  const customCountsBySet = new Map<string, number>();
  const customPercentagesBySet = new Map<string, number>();

  for (const src of sources) {
    if (src.source_type === "folder") {
      folderSet.add(src.id);
      if (src.include_subfolders !== false) {
        includeSubfolders = true;
      }
    } else {
      setSet.add(src.id);
      if (typeof src.custom_count === "number") {
        customCountsBySet.set(src.id, src.custom_count);
      }
      if (typeof src.custom_percentage === "number") {
        customPercentagesBySet.set(src.id, src.custom_percentage);
      }
    }
  }

  return {
    folderIds: Array.from(folderSet),
    studySetIds: Array.from(setSet),
    includeSubfolders: folderSet.size > 0 ? includeSubfolders : true,
    customCountsBySet,
    customPercentagesBySet,
  };
}

/**
 * Computes exact, zero-drift integer quotas across subjects for Strategies A–E.
 * Matches `exam-allocator.ts` mathematically (including 500/226/133 for N=250 -> 145/66/39).
 */
export function computeSubjectAllocations(params: {
  subjects: Array<{
    study_set_id: string;
    title: string;
    eligible_count: number;
    custom_count?: number | null;
    custom_percentage?: number | null;
  }>;
  requestedCount: number;
  strategy: AllocationStrategy;
}): {
  valid: boolean;
  actualCount: number;
  wasRedistributed: boolean;
  allocations: ExamAllocationPreviewItem[];
  warnings: ExamPreviewWarning[];
  errors: ExamPreviewWarning[];
} {
  const { subjects, requestedCount, strategy } = params;
  const warnings: ExamPreviewWarning[] = [];
  const errors: ExamPreviewWarning[] = [];

  const totalEligible = subjects.reduce((acc, s) => acc + s.eligible_count, 0);

  if (!Number.isInteger(requestedCount) || requestedCount < 1) {
    errors.push({
      code: "INVALID_QUESTION_COUNT",
      message: "Question count must be a positive integer.",
    });
  } else if (requestedCount > MAX_EXAM_QUESTIONS) {
    errors.push({
      code: "EXCEEDS_TECHNICAL_LIMIT",
      message: `Maximum questions per exam is ${MAX_EXAM_QUESTIONS}.`,
    });
  } else if (requestedCount > totalEligible) {
    errors.push({
      code: "EXCEEDS_AVAILABLE_POOL",
      message: `Requested ${requestedCount} questions, but only ${totalEligible} eligible questions are available.`,
      details: { requested: requestedCount, available: totalEligible },
    });
  }

  if (subjects.length === 0 || totalEligible === 0) {
    if (errors.length === 0) {
      errors.push({
        code: "EMPTY_ELIGIBLE_POOL",
        message: "No eligible exam questions match the selected sources and filters.",
      });
    }
    return {
      valid: false,
      actualCount: 0,
      wasRedistributed: false,
      allocations: [],
      warnings,
      errors,
    };
  }

  // Strategy A: Global Random — never fake exact per-subject preview counts before sampling
  if (strategy === "global_random") {
    const valid = errors.length === 0;
    const actualCount = valid ? requestedCount : 0;
    const allocations: ExamAllocationPreviewItem[] = subjects.map((s) => ({
      study_set_id: s.study_set_id,
      title: s.title,
      eligible_count: s.eligible_count,
      requested_count: null,
      requested_percentage: null,
      allocated_count: 0,
      share_percent:
        totalEligible > 0
          ? Math.round((s.eligible_count / totalEligible) * 10000) / 100
          : 0,
      shortfall: 0,
      was_redistributed: false,
    }));
    return {
      valid,
      actualCount,
      wasRedistributed: false,
      allocations,
      warnings,
      errors,
    };
  }

  // Strategy D: Custom Exact Counts
  if (strategy === "custom") {
    let customSum = 0;
    const allocations: ExamAllocationPreviewItem[] = subjects.map((s) => {
      const req = s.custom_count ?? 0;
      if (!Number.isInteger(req) || req < 0) {
        errors.push({
          code: "INVALID_CUSTOM_COUNT",
          message: `Invalid custom count for "${s.title}". Must be a non-negative integer.`,
          details: { study_set_id: s.study_set_id },
        });
      } else if (req > s.eligible_count) {
        errors.push({
          code: "CUSTOM_COUNT_EXCEEDS_ELIGIBLE",
          message: `"${s.title}" only has ${s.eligible_count} eligible questions (requested ${req}).`,
          details: {
            study_set_id: s.study_set_id,
            requested: req,
            available: s.eligible_count,
          },
        });
      }
      customSum += Math.max(0, Math.floor(req));
      return {
        study_set_id: s.study_set_id,
        title: s.title,
        eligible_count: s.eligible_count,
        requested_count: req,
        requested_percentage: null,
        allocated_count: Math.min(Math.max(0, Math.floor(req)), s.eligible_count),
        share_percent:
          requestedCount > 0
            ? Math.round((req / requestedCount) * 10000) / 100
            : 0,
        shortfall: Math.max(0, req - s.eligible_count),
        was_redistributed: false,
      };
    });

    if (customSum !== requestedCount) {
      errors.push({
        code: "CUSTOM_COUNT_SUM_MISMATCH",
        message: `Custom subject counts total ${customSum}, which must equal requested ${requestedCount}.`,
        details: { sum: customSum, requested: requestedCount, diff: requestedCount - customSum },
      });
    }

    return {
      valid: errors.length === 0,
      actualCount: errors.length === 0 ? customSum : 0,
      wasRedistributed: false,
      allocations,
      warnings,
      errors,
    };
  }

  // Strategies B (equal), C (proportional), E (weighted) — iterative capacity-constrained Hamilton
  const weights = new Map<string, number>();

  if (strategy === "weighted") {
    let pctSum = 0;
    for (const s of subjects) {
      const pct = s.custom_percentage ?? 0;
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        errors.push({
          code: "INVALID_WEIGHT",
          message: `Invalid percentage weight for "${s.title}".`,
          details: { study_set_id: s.study_set_id },
        });
      }
      pctSum += pct;
      weights.set(s.study_set_id, Math.max(0, pct));
    }

    if (Math.abs(pctSum - 100) > 0.01) {
      errors.push({
        code: "WEIGHTS_MUST_SUM_TO_100",
        message: `Subject weights total ${Math.round(pctSum * 100) / 100}%, but must equal 100%.`,
        details: { sum: Math.round(pctSum * 100) / 100 },
      });
    }
  } else if (strategy === "equal") {
    for (const s of subjects) {
      weights.set(s.study_set_id, 1);
    }
  } else {
    // proportional
    for (const s of subjects) {
      weights.set(s.study_set_id, s.eligible_count);
    }
  }

  if (errors.length > 0) {
    return {
      valid: false,
      actualCount: 0,
      wasRedistributed: false,
      allocations: subjects.map((s) => ({
        study_set_id: s.study_set_id,
        title: s.title,
        eligible_count: s.eligible_count,
        requested_count: null,
        requested_percentage:
          strategy === "weighted" ? (s.custom_percentage ?? 0) : null,
        allocated_count: 0,
        share_percent: 0,
        shortfall: 0,
        was_redistributed: false,
      })),
      warnings,
      errors,
    };
  }

  // First compute unconstrained ideal targets so we know accurately when redistribution happens
  const totalWeightAll = subjects.reduce(
    (acc, s) => acc + (weights.get(s.study_set_id) ?? 0),
    0,
  );
  const idealTargets = new Map<string, number>();
  for (const s of subjects) {
    const w = weights.get(s.study_set_id) ?? 0;
    idealTargets.set(
      s.study_set_id,
      totalWeightAll > 0 ? (requestedCount * w) / totalWeightAll : 0,
    );
  }

  const allocated = new Map<string, number>(
    subjects.map((s) => [s.study_set_id, 0]),
  );
  const capped = new Set<string>();
  let remaining = requestedCount;
  let wasRedistributed = false;

  // Iteratively allocate using Hamilton largest-remainder with capacity caps
  while (remaining > 0) {
    const active = subjects.filter(
      (s) =>
        !capped.has(s.study_set_id) &&
        (allocated.get(s.study_set_id) ?? 0) < s.eligible_count &&
        (weights.get(s.study_set_id) ?? 0) > 0,
    );

    if (active.length === 0) {
      // Fallback: if weighted subjects with >0% hit capacity, redistribute across ANY subject with remaining capacity
      const fallbackActive = subjects.filter(
        (s) => (allocated.get(s.study_set_id) ?? 0) < s.eligible_count,
      );
      if (fallbackActive.length === 0) break;
      wasRedistributed = true;
      for (const s of fallbackActive) {
        weights.set(s.study_set_id, s.eligible_count - (allocated.get(s.study_set_id) ?? 0));
      }
      capped.clear();
      continue;
    }

    const activeWeightSum = active.reduce(
      (acc, s) => acc + (weights.get(s.study_set_id) ?? 0),
      0,
    );

    const exactList = active.map((s) => {
      const capLeft = s.eligible_count - (allocated.get(s.study_set_id) ?? 0);
      const exact = (remaining * (weights.get(s.study_set_id) ?? 0)) / activeWeightSum;
      return { subject: s, capLeft, exact };
    });

    // If any active subject's exact share exceeds its remaining capacity, cap it first and iterate!
    const overflowed = exactList.filter((item) => item.exact > item.capLeft + 1e-9);
    if (overflowed.length > 0) {
      wasRedistributed = true;
      for (const item of overflowed) {
        allocated.set(item.subject.study_set_id, item.subject.eligible_count);
        remaining -= item.capLeft;
        capped.add(item.subject.study_set_id);
      }
      continue;
    }

    // No active subject overflows capacity -> perform clean Hamilton floor + largest remainder
    let floorSum = 0;
    const withRem = exactList.map((item) => {
      const fl = Math.min(item.capLeft, Math.floor(item.exact));
      floorSum += fl;
      return {
        ...item,
        fl,
        rem: item.exact - Math.floor(item.exact),
      };
    });

    for (const item of withRem) {
      allocated.set(
        item.subject.study_set_id,
        (allocated.get(item.subject.study_set_id) ?? 0) + item.fl,
      );
    }

    let leftover = remaining - floorSum;
    const sortedForRem = [...withRem].sort((a, b) => {
      const remDiff = b.rem - a.rem;
      if (Math.abs(remDiff) > 1e-12) return remDiff;
      if (b.subject.eligible_count !== a.subject.eligible_count) {
        return b.subject.eligible_count - a.subject.eligible_count;
      }
      const titleCmp = a.subject.title.localeCompare(b.subject.title);
      if (titleCmp !== 0) return titleCmp;
      return a.subject.study_set_id.localeCompare(b.subject.study_set_id);
    });

    for (const item of sortedForRem) {
      if (leftover <= 0) break;
      const cur = allocated.get(item.subject.study_set_id) ?? 0;
      if (cur < item.subject.eligible_count) {
        allocated.set(item.subject.study_set_id, cur + 1);
        leftover -= 1;
      }
    }

    remaining = leftover;
    if (remaining > 0) {
      wasRedistributed = true;
    }
  }

  const allocations: ExamAllocationPreviewItem[] = subjects.map((s) => {
    const count = allocated.get(s.study_set_id) ?? 0;
    const ideal = idealTargets.get(s.study_set_id) ?? 0;
    const idealRounded = Math.round(ideal);
    const shortfall = Math.max(0, idealRounded - s.eligible_count);
    return {
      study_set_id: s.study_set_id,
      title: s.title,
      eligible_count: s.eligible_count,
      requested_count: idealRounded,
      requested_percentage:
        strategy === "weighted" ? (s.custom_percentage ?? 0) : null,
      allocated_count: count,
      share_percent:
        requestedCount > 0 ? Math.round((count / requestedCount) * 10000) / 100 : 0,
      shortfall,
      was_redistributed: wasRedistributed && Math.abs(count - ideal) > 1.01,
    };
  });

  if (wasRedistributed) {
    warnings.push({
      code: "SHORTFALL_REDISTRIBUTED",
      message:
        "One or more subjects had fewer eligible questions than their target share; remaining slots were deterministically redistributed across subjects with capacity.",
    });
  }

  const actualCount = allocations.reduce((acc, a) => acc + a.allocated_count, 0);

  return {
    valid: true,
    actualCount,
    wasRedistributed,
    allocations,
    warnings,
    errors,
  };
}

export function buildCoverageBatchSizes(
  totalPool: number,
  questionsPerExam: number,
): number[] {
  if (totalPool <= 0 || questionsPerExam <= 0) return [];
  const sizes: number[] = [];
  let remaining = totalPool;
  while (remaining > 0) {
    const next = Math.min(questionsPerExam, remaining);
    sizes.push(next);
    remaining -= next;
  }
  return sizes;
}

export interface EligibleCandidateRow {
  id: string;
  study_set_id: string;
  chapter: string | null;
  difficulty: string;
  question_type: string;
  is_starred: boolean;
  is_unseen: boolean;
  is_mistake: boolean;
  is_due: boolean;
  wrong_count: number;
  correct_count: number;
  last_reviewed_at: string | null;
  next_review_at: string | null;
  mastery_level: string;
}

/**
 * Fetches all deduplicated candidate exam question metadata for the requested sources + filters
 * using paginated queries (never truncated at 1,000 rows!).
 */
export async function fetchEligibleCandidates(params: {
  supabase: SupabaseClient<Database>;
  userId: string;
  folderIds: string[];
  studySetIds: string[];
  includeSubfolders: boolean;
  filters?: ExamFilterConfig;
  selectionPolicy: SelectionPolicy;
  explicitQuestionIds?: string[];
}): Promise<{
  dedupedSets: Array<{ study_set_id: string; title: string; subject: string | null }>;
  candidates: EligibleCandidateRow[];
  recentQuestionIds: Map<string, number>;
}> {
  const {
    supabase,
    userId,
    folderIds,
    studySetIds,
    includeSubfolders,
    filters,
    selectionPolicy,
    explicitQuestionIds,
  } = params;

  const { data: dedupedSets, error: dedupErr } = await rpcResolveDedupedStudySets(
    supabase,
    {
      p_folder_ids: folderIds,
      p_study_set_ids: studySetIds,
      p_include_subfolders: includeSubfolders,
    },
  );

  if (dedupErr) throw dedupErr;

  const setIds = dedupedSets.map((s) => s.study_set_id);
  if (setIds.length === 0 && (!explicitQuestionIds || explicitQuestionIds.length === 0)) {
    return { dedupedSets: [], candidates: [], recentQuestionIds: new Map() };
  }

  // Fetch all matching non-flashcard questions using safe pagination
  let rawQuestions: Array<{
    id: string;
    study_set_id: string;
    chapter: string | null;
    difficulty: string;
    question_type: string;
  }> = [];

  if (explicitQuestionIds && explicitQuestionIds.length > 0) {
    rawQuestions = await fetchInChunks(
      explicitQuestionIds,
      async (chunk) =>
        supabase
          .from("questions")
          .select("id, study_set_id, chapter, difficulty, question_type")
          .in("id", chunk)
          .neq("question_type", "flashcard"),
      SAFE_IN_CHUNK_SIZE,
    );
  } else {
    for (const setChunk of chunkArray(setIds, SAFE_IN_CHUNK_SIZE)) {
      const pages = await fetchAllPages(async (from, to) => {
        let q = supabase
          .from("questions")
          .select("id, study_set_id, chapter, difficulty, question_type")
          .in("study_set_id", setChunk)
          .neq("question_type", "flashcard")
          .order("study_set_id", { ascending: true })
          .order("position", { ascending: true })
          .range(from, to);

        if (filters?.chapters && filters.chapters.length > 0) {
          q = q.in("chapter", filters.chapters);
        }
        if (filters?.difficulties && filters.difficulties.length > 0) {
          q = q.in("difficulty", filters.difficulties);
        }
        if (filters?.question_types && filters.question_types.length > 0) {
          q = q.in("question_type", filters.question_types);
        }
        return q;
      });
      rawQuestions.push(...pages);
    }
  }

  if (rawQuestions.length === 0) {
    return { dedupedSets, candidates: [], recentQuestionIds: new Map() };
  }

  // Apply tag filter if specified
  if (filters?.tag_ids && filters.tag_ids.length > 0) {
    const qIds = rawQuestions.map((q) => q.id);
    const taggedSet = new Set<string>();
    for (const chunk of chunkArray(qIds, SAFE_IN_CHUNK_SIZE)) {
      const taggedPages = await fetchAllPages(async (from, to) =>
        supabase
          .from("question_tags")
          .select("question_id")
          .in("question_id", chunk)
          .in("tag_id", filters.tag_ids!)
          .order("question_id", { ascending: true })
          .order("tag_id", { ascending: true })
          .range(from, to),
      );
      for (const r of taggedPages) {
        taggedSet.add(r.question_id);
      }
    }
    rawQuestions = rawQuestions.filter((q) => taggedSet.has(q.id));
  }

  if (rawQuestions.length === 0) {
    return { dedupedSets, candidates: [], recentQuestionIds: new Map() };
  }

  const allQIds = rawQuestions.map((q) => q.id);
  const candidateSetIds = Array.from(new Set(rawQuestions.map((q) => q.study_set_id)));

  // For >100-question banks (e.g. 500–10,000Q), query progress & starred rows by study_set_id via
  // paginated `fetchAllPages` instead of issuing up to 200 sequential `.in(question_id)` chunks.
  const [progressRows, starredRows] =
    allQIds.length <= SAFE_IN_CHUNK_SIZE
      ? await Promise.all([
          fetchInChunks(
            allQIds,
            async (chunk) =>
              supabase
                .from("user_question_progress")
                .select(
                  "question_id, mastery_level, correct_count, wrong_count, last_reviewed_at, next_review_at",
                )
                .eq("user_id", userId)
                .in("question_id", chunk),
            SAFE_IN_CHUNK_SIZE,
          ),
          fetchInChunks(
            allQIds,
            async (chunk) =>
              supabase
                .from("starred_questions")
                .select("question_id")
                .eq("user_id", userId)
                .in("question_id", chunk),
            SAFE_IN_CHUNK_SIZE,
          ),
        ])
      : await Promise.all([
          (async () => {
            const out: Array<{
              question_id: string;
              mastery_level: string;
              correct_count: number;
              wrong_count: number;
              last_reviewed_at: string | null;
              next_review_at: string | null;
            }> = [];
            for (const setChunk of chunkArray(candidateSetIds, SAFE_IN_CHUNK_SIZE)) {
              const pages = await fetchAllPages(async (from, to) =>
                supabase
                  .from("user_question_progress")
                  .select(
                    "question_id, mastery_level, correct_count, wrong_count, last_reviewed_at, next_review_at",
                  )
                  .eq("user_id", userId)
                  .in("study_set_id", setChunk)
                  .order("question_id", { ascending: true })
                  .range(from, to),
              );
              out.push(...pages);
            }
            return out;
          })(),
          (async () => {
            const out: Array<{ question_id: string }> = [];
            for (const setChunk of chunkArray(candidateSetIds, SAFE_IN_CHUNK_SIZE)) {
              const pages = await fetchAllPages(async (from, to) =>
                supabase
                  .from("starred_questions")
                  .select("question_id")
                  .eq("user_id", userId)
                  .in("study_set_id", setChunk)
                  .order("question_id", { ascending: true })
                  .range(from, to),
              );
              out.push(...pages);
            }
            return out;
          })(),
        ]);

  const progressMap = new Map(progressRows.map((p) => [p.question_id, p]));
  const starredSet = new Set(starredRows.map((s) => s.question_id));
  const nowMs = Date.now();

  let candidates: EligibleCandidateRow[] = rawQuestions.map((q) => {
    const prog = progressMap.get(q.id);
    const mastery = prog?.mastery_level ?? "new";
    const wrongCount = prog?.wrong_count ?? 0;
    const correctCount = prog?.correct_count ?? 0;
    const isUnseen = !prog;
    const isMistake = wrongCount > 0 && mastery !== "mastered";
    const isDue = Boolean(
      prog?.next_review_at && Date.parse(prog.next_review_at) <= nowMs,
    );

    return {
      id: q.id,
      study_set_id: q.study_set_id,
      chapter: q.chapter,
      difficulty: q.difficulty,
      question_type: q.question_type,
      is_starred: starredSet.has(q.id),
      is_unseen: isUnseen,
      is_mistake: isMistake,
      is_due: isDue,
      wrong_count: wrongCount,
      correct_count: correctCount,
      last_reviewed_at: prog?.last_reviewed_at ?? null,
      next_review_at: prog?.next_review_at ?? null,
      mastery_level: mastery,
    };
  });

  // Strict filters (NEVER silently pad!)
  if (selectionPolicy === "starred_only") {
    candidates = candidates.filter((c) => c.is_starred);
  } else if (selectionPolicy === "incorrect_only") {
    candidates = candidates.filter((c) => c.is_mistake);
  }

  // Fetch recent completed exam question history for anti_repeat policy
  const recentQuestionIds = new Map<string, number>();
  if (selectionPolicy === "anti_repeat") {
    const { data: recentAttempts } = await supabase
      .from("exam_attempts")
      .select("id")
      .eq("user_id", userId)
      .in("status", ["submitted", "expired"])
      .order("submitted_at", { ascending: false })
      .limit(10);

    const attemptIds = (recentAttempts ?? []).map((a) => a.id);
    if (attemptIds.length > 0) {
      const attemptRank = new Map(attemptIds.map((id, idx) => [id, idx]));
      const recentQs = await fetchAllPages(async (from, to) =>
        supabase
          .from("exam_attempt_questions")
          .select("attempt_id, question_id")
          .in("attempt_id", attemptIds)
          .order("attempt_id", { ascending: true })
          .order("position", { ascending: true })
          .range(from, to),
      );

      for (const rq of recentQs) {
        if (!rq.question_id) continue;
        const rank = attemptRank.get(rq.attempt_id) ?? 99;
        const existing = recentQuestionIds.get(rq.question_id);
        if (existing === undefined || rank < existing) {
          recentQuestionIds.set(rq.question_id, rank);
        }
      }
    }
  }

  return { dedupedSets, candidates, recentQuestionIds };
}

/**
 * Selects exactly `targetCount` questions from `pool` strictly honoring `policy` without replacement.
 * Returns selected questions + honest `repeatedCount` (for `anti_repeat`).
 */
export function selectQuestionsByPolicy(
  pool: readonly EligibleCandidateRow[],
  targetCount: number,
  policy: SelectionPolicy,
  recentQuestionIds: Map<string, number> = new Map(),
): { selected: EligibleCandidateRow[]; repeatedCount: number } {
  if (targetCount <= 0 || pool.length === 0) {
    return { selected: [], repeatedCount: 0 };
  }

  const take = Math.min(targetCount, pool.length);

  switch (policy) {
    case "random":
    case "starred_only":
    case "incorrect_only": {
      return {
        selected: cryptoShuffle(pool).slice(0, take),
        repeatedCount: 0,
      };
    }

    case "unseen_first": {
      const unseen = cryptoShuffle(pool.filter((q) => q.is_unseen));
      const seen = cryptoShuffle(pool.filter((q) => !q.is_unseen));
      return {
        selected: [...unseen, ...seen].slice(0, take),
        repeatedCount: 0,
      };
    }

    case "mistakes_first": {
      const mistakes = cryptoShuffle(pool.filter((q) => q.is_mistake)).sort((a, b) => {
        if (b.wrong_count !== a.wrong_count) return b.wrong_count - a.wrong_count;
        const aTime = a.last_reviewed_at ? Date.parse(a.last_reviewed_at) : 0;
        const bTime = b.last_reviewed_at ? Date.parse(b.last_reviewed_at) : 0;
        return bTime - aTime;
      });
      const rest = cryptoShuffle(pool.filter((q) => !q.is_mistake));
      return {
        selected: [...mistakes, ...rest].slice(0, take),
        repeatedCount: 0,
      };
    }

    case "due_for_review": {
      const due = cryptoShuffle(pool.filter((q) => q.is_due)).sort((a, b) => {
        const aTime = a.next_review_at ? Date.parse(a.next_review_at) : 0;
        const bTime = b.next_review_at ? Date.parse(b.next_review_at) : 0;
        return aTime - bTime;
      });
      const rest = cryptoShuffle(pool.filter((q) => !q.is_due));
      return {
        selected: [...due, ...rest].slice(0, take),
        repeatedCount: 0,
      };
    }

    case "weak_topics_first": {
      // Deterministic chapter accuracy ranking (zero AI)
      const topicStats = new Map<string, { correct: number; wrong: number }>();
      for (const q of pool) {
        const key = `${q.study_set_id}::${q.chapter ?? "__uncategorized__"}`;
        const cur = topicStats.get(key) ?? { correct: 0, wrong: 0 };
        cur.correct += q.correct_count;
        cur.wrong += q.wrong_count;
        topicStats.set(key, cur);
      }

      const topicAccuracy = (q: EligibleCandidateRow): number => {
        const key = `${q.study_set_id}::${q.chapter ?? "__uncategorized__"}`;
        const st = topicStats.get(key);
        if (!st || st.correct + st.wrong === 0) return 0.5;
        return st.correct / (st.correct + st.wrong);
      };

      const masteryScore = (m: string): number =>
        m === "learning" ? 0 : m === "new" ? 1 : m === "familiar" ? 2 : 3;

      const ordered = cryptoShuffle(pool).sort((a, b) => {
        const accDiff = topicAccuracy(a) - topicAccuracy(b);
        if (Math.abs(accDiff) > 0.001) return accDiff;
        return masteryScore(a.mastery_level) - masteryScore(b.mastery_level);
      });

      return {
        selected: ordered.slice(0, take),
        repeatedCount: 0,
      };
    }

    case "anti_repeat": {
      const fresh = cryptoShuffle(pool.filter((q) => !recentQuestionIds.has(q.id)));
      const recent = cryptoShuffle(pool.filter((q) => recentQuestionIds.has(q.id))).sort(
        (a, b) => (recentQuestionIds.get(b.id) ?? 0) - (recentQuestionIds.get(a.id) ?? 0),
      );
      const combined = [...fresh, ...recent].slice(0, take);
      const repeatedCount = combined.filter((q) => recentQuestionIds.has(q.id)).length;
      return {
        selected: combined,
        repeatedCount,
      };
    }
  }
}

/**
 * Computes full server-side Preview result (Strategies A–E + optional Full Coverage plan + anti-repeat check).
 * NEVER leaks question bodies or answers!
 */
export async function computeExamPreview(params: {
  supabase: SupabaseClient<Database>;
  userId: string;
  sources: ExamSourceInput[];
  requestedQuestionCount: number;
  allocationStrategy: AllocationStrategy;
  selectionPolicy: SelectionPolicy;
  fullCoverageMode: boolean;
  questionsPerExam?: number;
  durationLimitSeconds: number | null;
  filters?: ExamFilterConfig;
}): Promise<{ pool: ExamEligiblePool; preview: ExamPreviewResult }> {
  const {
    supabase,
    userId,
    sources,
    requestedQuestionCount,
    allocationStrategy,
    selectionPolicy,
    fullCoverageMode,
    questionsPerExam,
    durationLimitSeconds,
    filters,
  } = params;

  const {
    folderIds,
    studySetIds,
    includeSubfolders,
    customCountsBySet,
    customPercentagesBySet,
  } = extractSourceIds(sources);

  const { data: rawPool, error: poolErr } = await rpcGetExamEligiblePool(supabase, {
    p_folder_ids: folderIds,
    p_study_set_ids: studySetIds,
    p_include_subfolders: includeSubfolders,
    p_filters: (filters ?? {}) as Record<string, unknown>,
    p_selection_policy: selectionPolicy,
  });

  if (poolErr || !rawPool) {
    throw poolErr ?? new Error("Failed to compute eligible pool.");
  }

  const overlapSetsRemoved = Math.max(
    0,
    studySetIds.length + folderIds.length - rawPool.deduplicated_set_count,
  );

  const pool: ExamEligiblePool = {
    ...rawPool,
    overlap_sets_removed: overlapSetsRemoved,
  };

  const allocSubjects = pool.subjects.map((s) => ({
    study_set_id: s.study_set_id,
    title: s.title,
    eligible_count: s.eligible_count,
    custom_count: customCountsBySet.get(s.study_set_id) ?? null,
    custom_percentage: customPercentagesBySet.get(s.study_set_id) ?? null,
  }));

  const targetCount = fullCoverageMode
    ? Math.min(questionsPerExam ?? requestedQuestionCount, Math.max(1, pool.total_eligible))
    : requestedQuestionCount;

  const allocResult = computeSubjectAllocations({
    subjects: allocSubjects,
    requestedCount: targetCount,
    strategy: allocationStrategy,
  });

  // Honest repeated-question disclosure for anti_repeat
  let repeatedCount = 0;
  const warnings = [...allocResult.warnings];
  if (selectionPolicy === "anti_repeat" && allocResult.valid) {
    const { candidates, recentQuestionIds } = await fetchEligibleCandidates({
      supabase,
      userId,
      folderIds,
      studySetIds,
      includeSubfolders,
      filters,
      selectionPolicy,
    });
    const freshCount = candidates.filter((c) => !recentQuestionIds.has(c.id)).length;
    if (freshCount < allocResult.actualCount) {
      repeatedCount = allocResult.actualCount - freshCount;
      warnings.push({
        code: "ANTI_REPEAT_FALLBACK",
        message: `Only ${freshCount} fresh questions are available; ${repeatedCount} recently tested questions will be included to reach ${allocResult.actualCount}.`,
        details: { fresh_count: freshCount, repeated_count: repeatedCount },
      });
    }
  }

  const coveragePlan = fullCoverageMode
    ? (() => {
        const batchSize = questionsPerExam ?? requestedQuestionCount;
        const batchSizes = buildCoverageBatchSizes(pool.total_eligible, batchSize);
        return {
          questions_per_exam: batchSize,
          total_exams: batchSizes.length,
          batch_sizes: batchSizes,
        };
      })()
    : null;

  const avgSecondsPerQuestion =
    durationLimitSeconds !== null && allocResult.actualCount > 0
      ? Math.round((durationLimitSeconds / allocResult.actualCount) * 10) / 10
      : null;

  const preview: ExamPreviewResult = {
    valid: allocResult.valid,
    total_eligible: pool.total_eligible,
    requested_question_count: requestedQuestionCount,
    actual_question_count: allocResult.actualCount,
    allocation_strategy: allocationStrategy,
    selection_policy: selectionPolicy,
    duration_limit_seconds: durationLimitSeconds,
    avg_seconds_per_question: avgSecondsPerQuestion,
    was_redistributed: allocResult.wasRedistributed,
    repeated_count: repeatedCount,
    is_random_on_start: allocationStrategy === "global_random",
    allocations: allocResult.allocations,
    coverage_plan: coveragePlan,
    warnings,
    errors: allocResult.errors,
  };

  return { pool, preview };
}

/**
 * Defense-in-depth strip of answer keys/explanations on pre-submit payloads.
 */
export function stripPreSubmitQuestions(
  questions: ExamSnapshotQuestion[],
): ExamSnapshotQuestion[] {
  return questions.map((q) => ({
    id: q.id,
    attempt_id: q.attempt_id,
    question_id: q.question_id,
    position: q.position,
    question_type: q.question_type,
    source_study_set_id: q.source_study_set_id,
    source_subject_title: q.source_subject_title,
    chapter_snapshot: q.chapter_snapshot,
    tags_snapshot: q.tags_snapshot,
    prompt_snapshot: q.prompt_snapshot,
    prompt_image_url_snapshot: q.prompt_image_url_snapshot,
    options_snapshot: (q.options_snapshot ?? []).map((opt) => ({
      id: opt.id,
      label: opt.label,
      content: opt.content,
      image_url: opt.image_url ?? null,
      position: opt.position,
    })),
    created_at: q.created_at,
  }));
}
