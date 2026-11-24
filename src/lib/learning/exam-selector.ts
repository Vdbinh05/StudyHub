import type { MasteryLevel, SelectionPolicy } from "@/types/domain";
import { createSeededRng, fisherYatesShuffle, type RngFn } from "./shuffle";
import { isQuestionDue } from "./sm2";

export type { SelectionPolicy };

/**
 * Optional API / SQL enum aliases used by backend endpoints.
 */
export type ApiSelectionPolicy =
  | "random_all"
  | "prioritize_unseen"
  | "only_unseen"
  | "prioritize_mistakes"
  | "only_mistakes"
  | "only_starred"
  | "only_unmastered"
  | "full_coverage_cycle"
  | "due_for_review"
  | "anti_repeat"
  | "weak_topics_first";

export type AnySelectionPolicy = SelectionPolicy | ApiSelectionPolicy;

export function normalizeSelectionPolicy(
  policy: AnySelectionPolicy,
): SelectionPolicy {
  switch (policy) {
    case "random":
    case "random_all":
    case "full_coverage_cycle":
      return "random";
    case "unseen_first":
    case "prioritize_unseen":
    case "only_unseen":
      return "unseen_first";
    case "mistakes_first":
    case "prioritize_mistakes":
      return "mistakes_first";
    case "weak_topics_first":
    case "only_unmastered":
      return "weak_topics_first";
    case "due_for_review":
      return "due_for_review";
    case "starred_only":
    case "only_starred":
      return "starred_only";
    case "incorrect_only":
    case "only_mistakes":
      return "incorrect_only";
    case "anti_repeat":
      return "anti_repeat";
  }
}

export function isStrictFilterPolicy(policy: SelectionPolicy): boolean {
  return policy === "starred_only" || policy === "incorrect_only";
}

export interface SelectableQuestionCandidate {
  id: string;
  subjectId: string;
  chapter?: string | null;
  tagIds?: readonly string[];
  isStarred?: boolean;
  masteryLevel?: MasteryLevel;
  correctCount?: number;
  wrongCount?: number;
  consecutiveCorrect?: number;
  lastReviewedAt?: string | null;
  lastWrongAt?: string | null;
  nextReviewAt?: string | null;
}

export interface SelectionOptions {
  policy: SelectionPolicy;
  count: number;
  now?: Date;
  seed?: string | number;
  rng?: RngFn;
  /** Question IDs seen in recent completed exams (used by `anti_repeat`). */
  recentlyCompletedQuestionIds?: ReadonlySet<string> | readonly string[];
  /** Optional map of questionId -> completion timestamp ms (oldest repeated first when anti_repeat must repeat). */
  recentCompletionTimestamps?: ReadonlyMap<string, number>;
}

export interface SelectionResult<T extends SelectableQuestionCandidate> {
  policy: SelectionPolicy;
  requestedCount: number;
  eligiblePoolCount: number;
  selected: T[];
  isStrictFilter: boolean;
  shortfall: number;
  /** Populated for `anti_repeat`: how many selected questions had to be repeated due to insufficient unseen/non-recent pool. */
  repeatedCount: number;
  repeatedQuestionIds: string[];
  hasRepeats: boolean;
  disclosure: string | null;
}

function getCorrect(q: SelectableQuestionCandidate): number {
  return Math.max(0, q.correctCount ?? 0);
}

function getWrong(q: SelectableQuestionCandidate): number {
  return Math.max(0, q.wrongCount ?? 0);
}

function isUnseen(q: SelectableQuestionCandidate): boolean {
  return getCorrect(q) === 0 && getWrong(q) === 0;
}

function isUnresolvedMistake(q: SelectableQuestionCandidate): boolean {
  return getWrong(q) > 0 && q.masteryLevel !== "mastered";
}

function parseIsoMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
}

function masteryRankScore(level: MasteryLevel | undefined): number {
  switch (level) {
    case "learning":
      return 0;
    case "new":
    case undefined:
      return 1;
    case "familiar":
      return 2;
    case "mastered":
      return 3;
  }
}

/**
 * Deterministic topic (chapter & tag) weakness scoring — 100% deterministic, ZERO AI!
 * Lower score = weaker topic (prioritized first).
 */
function computeTopicWeaknessMap(
  candidates: readonly SelectableQuestionCandidate[],
): {
  chapterScore: Map<string, number>;
  tagScore: Map<string, number>;
} {
  interface Bucket {
    correct: number;
    wrong: number;
    masterySum: number;
    count: number;
  }

  const chapterBuckets = new Map<string, Bucket>();
  const tagBuckets = new Map<string, Bucket>();

  const add = (map: Map<string, Bucket>, key: string, q: SelectableQuestionCandidate) => {
    const b = map.get(key) ?? { correct: 0, wrong: 0, masterySum: 0, count: 0 };
    b.correct += getCorrect(q);
    b.wrong += getWrong(q);
    b.masterySum += masteryRankScore(q.masteryLevel);
    b.count += 1;
    map.set(key, b);
  };

  for (const q of candidates) {
    const ch = q.chapter?.trim();
    if (ch) {
      add(chapterBuckets, `${q.subjectId}::${ch}`, q);
    }
    for (const tagId of q.tagIds ?? []) {
      add(tagBuckets, tagId, q);
    }
  }

  const scoreBucket = (b: Bucket): number => {
    const attempts = b.correct + b.wrong;
    const avgMasteryNorm = b.count > 0 ? b.masterySum / (b.count * 3) : 0.5;
    if (attempts === 0) {
      // Unstudied topics sit below mastered (1.0) and above actively missed weak topics (<0.5)
      return 0.55 + avgMasteryNorm * 0.1;
    }
    const accuracy = b.correct / attempts;
    // Deterministic blend of observed accuracy (75%) + average SM-2 mastery tier (25%)
    return accuracy * 0.75 + avgMasteryNorm * 0.25;
  };

  const chapterScore = new Map<string, number>();
  for (const [k, b] of chapterBuckets.entries()) {
    chapterScore.set(k, scoreBucket(b));
  }

  const tagScore = new Map<string, number>();
  for (const [k, b] of tagBuckets.entries()) {
    tagScore.set(k, scoreBucket(b));
  }

  return { chapterScore, tagScore };
}

/**
 * Deterministically rank mistakes:
 * 1. Unresolved mistakes (`wrongCount > 0 && masteryLevel !== 'mastered'`) before resolved mistakes
 * 2. Higher `wrongCount` first
 * 3. Higher mistake rate `wrong / (correct + wrong)` first
 * 4. More recent `lastWrongAt` / `lastReviewedAt` first
 * 5. Shuffled tie-break for equal items
 */
function rankMistakeTier<T extends SelectableQuestionCandidate>(
  items: readonly T[],
  rng: RngFn,
): T[] {
  // Pre-shuffle so ties have unbiased deterministic/seeded randomness
  const shuffled = fisherYatesShuffle(items, rng);
  return shuffled.sort((a, b) => {
    const aUnres = isUnresolvedMistake(a) ? 1 : 0;
    const bUnres = isUnresolvedMistake(b) ? 1 : 0;
    if (aUnres !== bUnres) return bUnres - aUnres;

    const aWrong = getWrong(a);
    const bWrong = getWrong(b);
    if (aWrong !== bWrong) return bWrong - aWrong;

    const aAttempts = getCorrect(a) + aWrong;
    const bAttempts = getCorrect(b) + bWrong;
    const aRate = aAttempts > 0 ? aWrong / aAttempts : 0;
    const bRate = bAttempts > 0 ? bWrong / bAttempts : 0;
    if (Math.abs(aRate - bRate) > 1e-9) return bRate - aRate;

    const aTime = parseIsoMs(a.lastWrongAt ?? a.lastReviewedAt);
    const bTime = parseIsoMs(b.lastWrongAt ?? b.lastReviewedAt);
    if (aTime !== bTime) return bTime - aTime;

    return 0;
  });
}

/**
 * Filter a candidate pool strictly when policy is a strict filter (`starred_only`, `incorrect_only`),
 * or return the deduplicated pool unchanged for prioritization policies.
 */
export function filterCandidatesByPolicy<T extends SelectableQuestionCandidate>(
  candidates: readonly T[],
  policy: SelectionPolicy,
): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const c of candidates) {
    if (!seen.has(c.id)) {
      seen.add(c.id);
      deduped.push(c);
    }
  }

  if (policy === "starred_only") {
    return deduped.filter((q) => Boolean(q.isStarred));
  }
  if (policy === "incorrect_only") {
    return deduped.filter((q) => getWrong(q) > 0);
  }
  return deduped;
}

/**
 * Select `count` questions from `candidates` using one of the 8 V2.0 Selection Policies.
 * Strictly without replacement (zero duplicate question IDs in output).
 * Strict filter policies (`starred_only`, `incorrect_only`) NEVER pad with non-matching items.
 */
export function selectQuestionsByPolicy<T extends SelectableQuestionCandidate>(
  candidates: readonly T[],
  options: SelectionOptions,
): SelectionResult<T> {
  const { policy, now = new Date() } = options;
  const rng: RngFn =
    options.rng ??
    (options.seed !== undefined ? createSeededRng(options.seed) : Math.random);
  const requestedCount = Math.max(0, Math.floor(options.count));
  const strict = isStrictFilterPolicy(policy);

  const eligible = filterCandidatesByPolicy(candidates, policy);

  if (requestedCount === 0 || eligible.length === 0) {
    return {
      policy,
      requestedCount,
      eligiblePoolCount: eligible.length,
      selected: [],
      isStrictFilter: strict,
      shortfall: requestedCount,
      repeatedCount: 0,
      repeatedQuestionIds: [],
      hasRepeats: false,
      disclosure:
        eligible.length === 0 && strict
          ? policy === "starred_only"
            ? "No starred questions match your current filters."
            : "No previously missed questions match your current filters."
          : null,
    };
  }

  // Policy 1: random
  if (policy === "random") {
    const selected = fisherYatesShuffle(eligible, rng).slice(0, requestedCount);
    return {
      policy,
      requestedCount,
      eligiblePoolCount: eligible.length,
      selected,
      isStrictFilter: false,
      shortfall: Math.max(0, requestedCount - selected.length),
      repeatedCount: 0,
      repeatedQuestionIds: [],
      hasRepeats: false,
      disclosure: null,
    };
  }

  // Policy 2: unseen_first
  if (policy === "unseen_first") {
    const unseen: T[] = [];
    const seen: T[] = [];
    for (const q of eligible) {
      if (isUnseen(q)) unseen.push(q);
      else seen.push(q);
    }
    const ordered = [
      ...fisherYatesShuffle(unseen, rng),
      ...fisherYatesShuffle(seen, rng),
    ];
    const selected = ordered.slice(0, requestedCount);
    return {
      policy,
      requestedCount,
      eligiblePoolCount: eligible.length,
      selected,
      isStrictFilter: false,
      shortfall: Math.max(0, requestedCount - selected.length),
      repeatedCount: 0,
      repeatedQuestionIds: [],
      hasRepeats: false,
      disclosure:
        unseen.length < selected.length
          ? `Included all ${unseen.length} unseen questions and filled ${selected.length - unseen.length} from previously seen questions.`
          : null,
    };
  }

  // Policy 3: mistakes_first
  if (policy === "mistakes_first") {
    const mistakes: T[] = [];
    const nonMistakes: T[] = [];
    for (const q of eligible) {
      if (getWrong(q) > 0) mistakes.push(q);
      else nonMistakes.push(q);
    }
    const ordered = [
      ...rankMistakeTier(mistakes, rng),
      ...fisherYatesShuffle(nonMistakes, rng),
    ];
    const selected = ordered.slice(0, requestedCount);
    return {
      policy,
      requestedCount,
      eligiblePoolCount: eligible.length,
      selected,
      isStrictFilter: false,
      shortfall: Math.max(0, requestedCount - selected.length),
      repeatedCount: 0,
      repeatedQuestionIds: [],
      hasRepeats: false,
      disclosure: null,
    };
  }

  // Policy 4: weak_topics_first (deterministic chapter/tag accuracy + mastery ranking)
  if (policy === "weak_topics_first") {
    const { chapterScore, tagScore } = computeTopicWeaknessMap(eligible);
    const shuffled = fisherYatesShuffle(eligible, rng);

    const questionWeakness = (q: T): number => {
      const topicScores: number[] = [];
      const ch = q.chapter?.trim();
      if (ch) {
        const s = chapterScore.get(`${q.subjectId}::${ch}`);
        if (s !== undefined) topicScores.push(s);
      }
      for (const tid of q.tagIds ?? []) {
        const s = tagScore.get(tid);
        if (s !== undefined) topicScores.push(s);
      }
      const weakestTopic =
        topicScores.length > 0 ? Math.min(...topicScores) : 0.6;
      const attempts = getCorrect(q) + getWrong(q);
      const qAcc = attempts > 0 ? getCorrect(q) / attempts : 0.55;
      const qMastery = masteryRankScore(q.masteryLevel) / 3;
      // 65% weakest topic score + 20% question accuracy + 15% individual mastery
      return weakestTopic * 0.65 + qAcc * 0.2 + qMastery * 0.15;
    };

    const scored = shuffled.map((item) => ({
      item,
      score: questionWeakness(item),
    }));
    scored.sort((a, b) => a.score - b.score);

    const selected = scored.slice(0, requestedCount).map((s) => s.item);
    return {
      policy,
      requestedCount,
      eligiblePoolCount: eligible.length,
      selected,
      isStrictFilter: false,
      shortfall: Math.max(0, requestedCount - selected.length),
      repeatedCount: 0,
      repeatedQuestionIds: [],
      hasRepeats: false,
      disclosure: null,
    };
  }

  // Policy 5: due_for_review (SM-2 next_review_at <= now prioritized most-overdue first)
  if (policy === "due_for_review") {
    const due: T[] = [];
    const notDue: T[] = [];
    for (const q of eligible) {
      if (isQuestionDue({ next_review_at: q.nextReviewAt ?? null }, now)) {
        due.push(q);
      } else {
        notDue.push(q);
      }
    }

    const dueOrdered = fisherYatesShuffle(due, rng).sort(
      (a, b) => parseIsoMs(a.nextReviewAt) - parseIsoMs(b.nextReviewAt),
    );
    const ordered = [...dueOrdered, ...fisherYatesShuffle(notDue, rng)];
    const selected = ordered.slice(0, requestedCount);

    return {
      policy,
      requestedCount,
      eligiblePoolCount: eligible.length,
      selected,
      isStrictFilter: false,
      shortfall: Math.max(0, requestedCount - selected.length),
      repeatedCount: 0,
      repeatedQuestionIds: [],
      hasRepeats: false,
      disclosure:
        due.length < selected.length
          ? `Included all ${due.length} SM-2 due questions and filled ${selected.length - due.length} from remaining eligible questions.`
          : null,
    };
  }

  // Policy 6: starred_only (STRICT — NEVER silently pad with unstarred!)
  if (policy === "starred_only") {
    const selected = fisherYatesShuffle(eligible, rng).slice(0, requestedCount);
    const shortfall = Math.max(0, requestedCount - selected.length);
    return {
      policy,
      requestedCount,
      eligiblePoolCount: eligible.length,
      selected,
      isStrictFilter: true,
      shortfall,
      repeatedCount: 0,
      repeatedQuestionIds: [],
      hasRepeats: false,
      disclosure:
        shortfall > 0
          ? `Only ${eligible.length} starred questions are available (strict filter — unstarred questions are never padded).`
          : null,
    };
  }

  // Policy 7: incorrect_only (STRICT — NEVER silently pad with non-mistakes!)
  if (policy === "incorrect_only") {
    const selected = rankMistakeTier(eligible, rng).slice(0, requestedCount);
    const shortfall = Math.max(0, requestedCount - selected.length);
    return {
      policy,
      requestedCount,
      eligiblePoolCount: eligible.length,
      selected,
      isStrictFilter: true,
      shortfall,
      repeatedCount: 0,
      repeatedQuestionIds: [],
      hasRepeats: false,
      disclosure:
        shortfall > 0
          ? `Only ${eligible.length} previously missed questions are available (strict filter — non-mistake questions are never padded).`
          : null,
    };
  }

  // Policy 8: anti_repeat
  // Excludes recently completed exam questions first; if pool insufficient, honestly
  // discloses exact `repeatedCount` and `repeatedQuestionIds`.
  const recentSet =
    options.recentlyCompletedQuestionIds instanceof Set
      ? options.recentlyCompletedQuestionIds
      : new Set(options.recentlyCompletedQuestionIds ?? []);

  const fresh: T[] = [];
  const recent: T[] = [];
  for (const q of eligible) {
    if (recentSet.has(q.id)) recent.push(q);
    else fresh.push(q);
  }

  const freshShuffled = fisherYatesShuffle(fresh, rng);
  let recentOrdered = fisherYatesShuffle(recent, rng);
  if (options.recentCompletionTimestamps) {
    const tsMap = options.recentCompletionTimestamps;
    recentOrdered = recentOrdered.sort(
      (a, b) => (tsMap.get(a.id) ?? 0) - (tsMap.get(b.id) ?? 0),
    );
  }

  const takenFresh = freshShuffled.slice(0, requestedCount);
  const stillNeeded = Math.max(0, requestedCount - takenFresh.length);
  const takenRepeated =
    stillNeeded > 0 ? recentOrdered.slice(0, stillNeeded) : [];
  const selected = [...takenFresh, ...takenRepeated];
  const repeatedIds = takenRepeated.map((q) => q.id);

  return {
    policy,
    requestedCount,
    eligiblePoolCount: eligible.length,
    selected,
    isStrictFilter: false,
    shortfall: Math.max(0, requestedCount - selected.length),
    repeatedCount: takenRepeated.length,
    repeatedQuestionIds: repeatedIds,
    hasRepeats: takenRepeated.length > 0,
    disclosure:
      takenRepeated.length > 0
        ? `Only ${fresh.length} non-recent questions were available; ${takenRepeated.length} recently completed question(s) had to be repeated to reach ${selected.length} questions.`
        : null,
  };
}
