import type {
  ConfidenceLevel,
  MasteryLevel,
  Question,
  QuestionType,
  StructuredAnswerResponse,
  UserQuestionProgress,
} from "@/types/domain";
import { isQuestionDue } from "./sm2";

export type LearnObjective =
  | "familiarize"
  | "memorize"
  | "master"
  | "review"
  | "exam_prep";

export interface LearnObjectiveMeta {
  id: LearnObjective;
  viLabel: string;
  enLabel: string;
  viDesc: string;
  enDesc: string;
  /** Target stage an item must reach to graduate from this session. */
  targetStage: LearnStage;
  /** Default starting stage for brand-new items. */
  initialStageForNew: LearnStage;
  /** Whether independent verification after an intervening gap is required. */
  requireIndependentVerification: boolean;
}

/**
 * 5-Stage Deterministic Learn Progression:
 * - Stage 1: Familiarization (exposure / study view)
 * - Stage 2: Recognition (multiple choice / true-false / matching)
 * - Stage 3: Recall (typed write / spell / numerical / fill-in-blank / ordering / hotspot)
 * - Stage 4: Independent Verification (recall after >=2 intervening items, no hint, not guessing)
 * - Stage 5: Scheduled SM-2 Review (graduated; eligible for long-term SM-2 mastered state)
 */
export type LearnStage = 1 | 2 | 3 | 4 | 5;

export const LEARN_STAGE_LABELS: Record<
  LearnStage,
  { vi: string; en: string }
> = {
  1: { vi: "Bước 1 · Làm quen", en: "Stage 1 · Familiarization" },
  2: { vi: "Bước 2 · Nhận diện", en: "Stage 2 · Recognition" },
  3: { vi: "Bước 3 · Tự nhớ lại", en: "Stage 3 · Recall" },
  4: {
    vi: "Bước 4 · Kiểm chứng độc lập",
    en: "Stage 4 · Independent Verification",
  },
  5: { vi: "Bước 5 · Ôn định kỳ SM-2", en: "Stage 5 · Scheduled SM-2" },
};

export const LEARN_OBJECTIVES: readonly LearnObjectiveMeta[] = [
  {
    id: "familiarize",
    viLabel: "Làm quen",
    enLabel: "Familiarize",
    viDesc: "Xem nhanh kiến thức mới rồi kiểm tra nhận diện nhẹ nhàng.",
    enDesc: "Introduce new concepts with guided exposure and recognition.",
    targetStage: 2,
    initialStageForNew: 1,
    requireIndependentVerification: false,
  },
  {
    id: "memorize",
    viLabel: "Ghi nhớ",
    enLabel: "Memorize",
    viDesc: "Nhận diện rồi tự nhớ lại chủ động (tự động ôn lại câu sai).",
    enDesc: "Progress from recognition into active recall with mistake retries.",
    targetStage: 3,
    initialStageForNew: 2,
    requireIndependentVerification: false,
  },
  {
    id: "master",
    viLabel: "Thành thạo",
    enLabel: "Master",
    viDesc:
      "Đủ 5 giai đoạn: Làm quen → Nhận diện → Tự nhớ → Kiểm chứng độc lập → SM-2.",
    enDesc:
      "Full 5-stage mastery: Familiarize → Recognition → Recall → Independent Verification → SM-2.",
    targetStage: 5,
    initialStageForNew: 1,
    requireIndependentVerification: true,
  },
  {
    id: "review",
    viLabel: "Ôn tập",
    enLabel: "Review",
    viDesc: "Ưu tiên câu đến hạn SM-2, câu hay sai và câu độ tự tin thấp.",
    enDesc: "Prioritize due SM-2 items, past mistakes, and low-confidence cards.",
    targetStage: 4,
    initialStageForNew: 2,
    requireIndependentVerification: true,
  },
  {
    id: "exam_prep",
    viLabel: "Luyện thi",
    enLabel: "Exam Prep",
    viDesc:
      "Tập trung câu sai tự tin cao, câu yếu và dạng bài tương thích đề thi.",
    enDesc:
      "Focus on misconceptions, weak areas, and exam-style recall verification.",
    targetStage: 4,
    initialStageForNew: 2,
    requireIndependentVerification: true,
  },
] as const;

export function getLearnObjectiveMeta(
  objective: LearnObjective,
): LearnObjectiveMeta {
  return (
    LEARN_OBJECTIVES.find((o) => o.id === objective) ?? LEARN_OBJECTIVES[2]
  );
}

export type LearnActivityType =
  | "flashcard"
  | "multiple_choice"
  | "write"
  | "spell"
  | "matching"
  | "ordering"
  | "numerical"
  | "fill_in_blank"
  | "diagram_identify"
  | "hotspot"
  | "listening_mc"
  | "reading_mc";

export interface QuestionCompatibilityDescriptor {
  id: string;
  question_type: QuestionType;
  prompt?: string | null;
  prompt_image_url?: string | null;
  back_text?: string | null;
  back_image_url?: string | null;
  audio_url?: string | null;
  audio_media_id?: string | null;
  options?: ReadonlyArray<{ content: string; image_url?: string | null; is_correct: boolean }>;
  accepted_answers?: ReadonlyArray<{ answer_text: string }>;
  type_payload?: Question["type_payload"];
}

/**
 * Determine whether a question has an image-only answer (NO textual target for typed Write/Spell).
 */
export function isImageOnlyQuestion(
  q: QuestionCompatibilityDescriptor,
): boolean {
  if (q.question_type === "image_choice" || q.question_type === "image_hotspot") {
    return true;
  }
  const hasBackText = Boolean(q.back_text && q.back_text.trim().length > 0);
  const hasAcceptedText = Boolean(
    q.accepted_answers &&
      q.accepted_answers.some((a) => a.answer_text.trim().length > 0),
  );
  const correctOpts = (q.options ?? []).filter((o) => o.is_correct);
  const hasCorrectOptionText = correctOpts.some(
    (o) => o.content.trim().length > 0,
  );
  const hasAnyImage =
    Boolean(q.prompt_image_url) ||
    Boolean(q.back_image_url) ||
    (q.options ?? []).some((o) => Boolean(o.image_url));

  return (
    hasAnyImage && !hasBackText && !hasAcceptedText && !hasCorrectOptionText
  );
}

/**
 * Determine strictly compatible Learn activities for any V3 question type.
 * NEVER assigns typed `write` or `spell` to image-only, hotspot, matching, or ordering questions!
 */
export function getCompatibleLearnActivities(
  q: QuestionCompatibilityDescriptor,
): LearnActivityType[] {
  const imageOnly = isImageOnlyQuestion(q);

  switch (q.question_type) {
    case "image_choice":
      return ["flashcard", "multiple_choice"];

    case "image_hotspot":
      return ["flashcard", "hotspot", "diagram_identify"];

    case "numerical":
      return ["flashcard", "numerical"];

    case "fill_in_blank":
      return ["flashcard", "fill_in_blank"];

    case "ordering":
      return ["flashcard", "ordering"];

    case "matching":
      return ["flashcard", "matching"];

    case "reading_passage": {
      const payload = q.type_payload;
      if (
        payload &&
        payload.type === "reading_passage" &&
        payload.sub_answer_kind === "short_answer"
      ) {
        return ["flashcard", "write"];
      }
      return ["flashcard", "reading_mc", "multiple_choice"];
    }

    case "listening": {
      const payload = q.type_payload;
      if (payload && payload.type === "listening") {
        if (payload.sub_answer_kind === "fill_in_blank") {
          return ["flashcard", "fill_in_blank", "spell"];
        }
        if (payload.sub_answer_kind === "short_answer") {
          return ["flashcard", "spell", "write"];
        }
      }
      return ["flashcard", "listening_mc", "multiple_choice"];
    }

    case "short_answer":
      return imageOnly
        ? ["flashcard"]
        : ["flashcard", "write", "spell"];

    case "flashcard": {
      if (imageOnly) return ["flashcard"];
      const hasAudio = Boolean(q.audio_url || q.audio_media_id);
      const textLen = (q.back_text ?? "").trim().length;
      const activities: LearnActivityType[] = ["flashcard", "multiple_choice"];
      if (textLen > 0 && textLen <= 180) {
        activities.push("write");
        if (hasAudio || textLen <= 60) {
          activities.push("spell");
        }
      }
      return activities;
    }

    case "true_false":
      return ["flashcard", "multiple_choice"];

    case "single_choice":
    case "multiple_choice":
    default: {
      if (imageOnly) return ["flashcard", "multiple_choice"];
      const activities: LearnActivityType[] = ["flashcard", "multiple_choice"];
      // Only offer typed recall when there is a single concise textual answer
      const correctOpts = (q.options ?? []).filter((o) => o.is_correct);
      if (
        q.question_type === "single_choice" &&
        correctOpts.length === 1 &&
        correctOpts[0].content.trim().length > 0 &&
        correctOpts[0].content.trim().length <= 80 &&
        !correctOpts[0].image_url
      ) {
        activities.push("write");
      }
      return activities;
    }
  }
}

/**
 * Pick the optimal compatible activity for a question at a given Learn stage.
 */
export function selectActivityForStage(
  q: QuestionCompatibilityDescriptor,
  stage: LearnStage,
): LearnActivityType {
  const compatible = getCompatibleLearnActivities(q);

  if (stage === 1) {
    return "flashcard";
  }

  if (stage === 2) {
    // Recognition stage
    for (const preferred of [
      "multiple_choice",
      "reading_mc",
      "listening_mc",
      "diagram_identify",
      "matching",
      "ordering",
      "fill_in_blank",
      "numerical",
      "write",
    ] as const) {
      if (compatible.includes(preferred)) return preferred;
    }
    return compatible[0] ?? "flashcard";
  }

  // Stage 3 (Recall), Stage 4 (Independent Verification), Stage 5 (SM-2)
  for (const preferred of [
    "numerical",
    "fill_in_blank",
    "hotspot",
    "ordering",
    "matching",
    "spell",
    "write",
    "reading_mc",
    "listening_mc",
    "multiple_choice",
  ] as const) {
    if (compatible.includes(preferred)) return preferred;
  }
  return compatible[0] ?? "flashcard";
}

export interface AdaptiveLearnFilterConfig {
  chapters?: string[];
  tagIds?: string[];
  onlyNew?: boolean;
  onlyIncorrect?: boolean;
  onlyDue?: boolean;
  onlyLowConfidence?: boolean;
  onlyStarred?: boolean;
  maxItems?: number | null;
}

export interface AdaptiveLearnItemSeed {
  question: Question;
  progress: UserQuestionProgress | null;
  isStarred: boolean;
}

/**
 * Filter study set items according to Learn session configuration.
 */
export function filterAdaptiveLearnSeeds(
  seeds: readonly AdaptiveLearnItemSeed[],
  filter: AdaptiveLearnFilterConfig,
  now: Date = new Date(),
): AdaptiveLearnItemSeed[] {
  const chapterSet =
    filter.chapters && filter.chapters.length > 0
      ? new Set(filter.chapters.map((c) => c.trim()))
      : null;
  const tagSet =
    filter.tagIds && filter.tagIds.length > 0 ? new Set(filter.tagIds) : null;

  const filtered = seeds.filter((seed) => {
    const q = seed.question;
    const p = seed.progress;

    if (chapterSet) {
      const ch = (q.chapter ?? "").trim();
      if (!chapterSet.has(ch)) return false;
    }

    if (tagSet) {
      const qTags = q.tags ?? [];
      if (!qTags.some((t) => tagSet.has(t.id))) return false;
    }

    if (filter.onlyStarred && !seed.isStarred) return false;

    if (filter.onlyNew) {
      if (p && p.mastery_level !== "new") return false;
    }

    if (filter.onlyIncorrect) {
      const hasWrong =
        Boolean(p && p.wrong_count > 0) && p?.mistake_status !== "resolved";
      if (!hasWrong) return false;
    }

    if (filter.onlyDue) {
      if (!p || !isQuestionDue(p, now)) return false;
    }

    if (filter.onlyLowConfidence) {
      const lowConf =
        p?.last_confidence === "guessing" ||
        p?.last_confidence === "unsure" ||
        (p?.low_confidence_count ?? 0) > 0 ||
        (p?.high_conf_wrong_count ?? 0) > 0;
      if (!lowConf) return false;
    }

    return true;
  });

  if (
    typeof filter.maxItems === "number" &&
    Number.isInteger(filter.maxItems) &&
    filter.maxItems > 0 &&
    filtered.length > filter.maxItems
  ) {
    return filtered.slice(0, filter.maxItems);
  }

  return filtered;
}

export interface AdaptiveLearnCardState {
  questionId: string;
  questionType: QuestionType;
  stage: LearnStage;
  activity: LearnActivityType;
  recognitionPasses: number;
  recallPasses: number;
  verificationPasses: number;
  missedInSession: boolean;
  forcedCorrectionPending: boolean;
  forcedCorrectionRetries: number;
  /** Number of OTHER cards answered since this card last reached Stage 4 eligibility. */
  interveningTurnsSinceLastSeen: number;
  lastConfidence: ConfidenceLevel | null;
  hadHighConfWrong: boolean;
}

export interface AdaptiveLearnOptions {
  objective?: LearnObjective;
  batchSize?: number;
  /** Enable optional forced correction retype on wrong answers (bounded retries — never endless!). */
  forcedCorrection?: boolean;
  /** Max retries allowed during forced correction before gracefully moving on (clamped 1..3). */
  maxForcedRetries?: number;
  /** Minimum intervening cards required before Stage 4 Independent Verification (default 2). */
  verificationMinGap?: number;
  /** When false (from mode_preferences.learn.enable_written_recall), skip Stage 3+ typed recall where MC exists. */
  enableWrittenRecall?: boolean;
  /** When false (from mode_preferences.learn.require_independent_recall), allow graduation without Stage 4 verification. */
  requireIndependentRecall?: boolean;
  now?: Date;
}

export interface AdaptiveLearnState {
  objective: LearnObjective;
  targetStage: LearnStage;
  batchSize: number;
  forcedCorrection: boolean;
  maxForcedRetries: number;
  verificationMinGap: number;
  roundNumber: number;
  activeQueue: AdaptiveLearnCardState[];
  pendingQueue: AdaptiveLearnCardState[];
  graduatedIds: string[];
  missedIds: string[];
  totalItems: number;
  totalAttempts: number;
  correctAttempts: number;
  sessionCompleted: boolean;
  roundCompleted: boolean;
}

export interface AdaptiveLearnStepInput {
  isCorrect: boolean;
  confidence?: ConfidenceLevel | null;
  usedHint?: boolean;
  /** True when user completed a forced correction retry (clears pending gate without falsely granting mastery). */
  isForcedCorrectionAttempt?: boolean;
  /** True when user explicitly skipped forced correction to avoid being stuck. */
  skipForcedCorrection?: boolean;
}

export interface AdaptiveLearnStepResult {
  nextState: AdaptiveLearnState;
  cardGraduated: boolean;
  enteredForcedCorrection: boolean;
  recognitionCannotMasterNotice: boolean;
  stageTransition: { from: LearnStage; to: LearnStage };
}

function computePriorityScore(
  seed: AdaptiveLearnItemSeed,
  objective: LearnObjective,
  now: Date,
): number {
  const p = seed.progress;
  if (!p) {
    return objective === "review" ? 40 : 65;
  }

  let score = 0;
  // High-confidence misconceptions ALWAYS get top priority above everything else
  if ((p.high_conf_wrong_count ?? 0) > 0) score += 200;
  if (isQuestionDue(p, now)) score += 90;
  if (p.mistake_status === "active" || p.wrong_count > 0) {
    score += 60 + Math.min(30, p.wrong_count * 5);
  }
  if (p.last_confidence === "guessing") score += 50;
  if (p.last_confidence === "unsure") score += 35;

  switch (p.mastery_level as MasteryLevel) {
    case "learning":
      score += 45;
      break;
    case "new":
      score += objective === "familiarize" ? 80 : 40;
      break;
    case "familiar":
      score += 20;
      break;
    case "mastered":
      score += 5;
      break;
  }

  return score;
}

function deriveInitialStage(
  seed: AdaptiveLearnItemSeed,
  objective: LearnObjective,
): LearnStage {
  const meta = getLearnObjectiveMeta(objective);
  const p = seed.progress;

  if (!p || p.mastery_level === "new") {
    return meta.initialStageForNew;
  }
  if (p.mistake_status === "active" || (p.high_conf_wrong_count ?? 0) > 0) {
    return objective === "familiarize" ? 1 : 2;
  }
  if (p.mastery_level === "learning") {
    return 2;
  }
  if (p.mastery_level === "familiar") {
    return 3;
  }
  return objective === "master" ? 4 : 3;
}

function makeCardFromSeed(
  seed: AdaptiveLearnItemSeed,
  objective: LearnObjective,
): AdaptiveLearnCardState {
  const stage = deriveInitialStage(seed, objective);
  return {
    questionId: seed.question.id,
    questionType: seed.question.question_type,
    stage,
    activity: selectActivityForStage(seed.question, stage),
    recognitionPasses: seed.progress && seed.progress.correct_count > 0 ? 1 : 0,
    recallPasses: seed.progress?.independent_recall_count ?? 0,
    verificationPasses: 0,
    missedInSession: false,
    forcedCorrectionPending: false,
    forcedCorrectionRetries: 0,
    interveningTurnsSinceLastSeen: 99,
    lastConfidence: seed.progress?.last_confidence ?? null,
    hadHighConfWrong: (seed.progress?.high_conf_wrong_count ?? 0) > 0,
  };
}

/**
 * Create a deterministic V3 Adaptive Learn state with 5-stage progression and objective rules.
 */
export function createAdaptiveLearnState(
  seeds: readonly AdaptiveLearnItemSeed[],
  options: AdaptiveLearnOptions = {},
): AdaptiveLearnState {
  const objective = options.objective ?? "master";
  const meta = getLearnObjectiveMeta(objective);
  const batchSize = Math.max(1, Math.min(50, options.batchSize ?? 7));
  const forcedCorrection = Boolean(options.forcedCorrection);
  const maxForcedRetries = Math.max(
    1,
    Math.min(3, options.maxForcedRetries ?? 2),
  );
  const verificationMinGap = Math.max(
    1,
    Math.min(5, options.verificationMinGap ?? 2),
  );
  const now = options.now ?? new Date();

  const sorted = [...seeds]
    .map((seed, index) => ({
      seed,
      index,
      priority: computePriorityScore(seed, objective, now),
    }))
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return a.index - b.index;
    })
    .map((x) => makeCardFromSeed(x.seed, objective));

  const activeQueue = sorted.slice(0, batchSize);
  const pendingQueue = sorted.slice(batchSize);
  const isEmpty = activeQueue.length === 0;

  let resolvedTargetStage = meta.targetStage;
  if (options.requireIndependentRecall === false && resolvedTargetStage > 3) {
    resolvedTargetStage = 3;
  }
  if (options.enableWrittenRecall === false && resolvedTargetStage > 2) {
    resolvedTargetStage = 2;
  }

  return {
    objective,
    targetStage: resolvedTargetStage,
    batchSize,
    forcedCorrection,
    maxForcedRetries,
    verificationMinGap,
    roundNumber: 1,
    activeQueue,
    pendingQueue,
    graduatedIds: [],
    missedIds: [],
    totalItems: sorted.length,
    totalAttempts: 0,
    correctAttempts: 0,
    sessionCompleted: isEmpty,
    roundCompleted: isEmpty,
  };
}

/**
 * Append newly streamed study set questions into pendingQueue without disrupting activeQueue[0] (`V32-015`).
 */
export function appendAdaptiveLearnSeeds(
  state: AdaptiveLearnState,
  newSeeds: readonly AdaptiveLearnItemSeed[],
): AdaptiveLearnState {
  if (newSeeds.length === 0) return state;
  const seen = new Set<string>([
    ...state.activeQueue.map((c) => c.questionId),
    ...state.pendingQueue.map((c) => c.questionId),
    ...state.graduatedIds,
  ]);
  const added: AdaptiveLearnCardState[] = [];
  for (const seed of newSeeds) {
    if (seen.has(seed.question.id)) continue;
    seen.add(seed.question.id);
    added.push(makeCardFromSeed(seed, state.objective));
  }
  if (added.length === 0) return state;

  if (state.activeQueue.length === 0 && !state.roundCompleted) {
    const nextActive = added.slice(0, state.batchSize);
    const nextPending = added.slice(state.batchSize);
    return {
      ...state,
      activeQueue: nextActive,
      pendingQueue: [...state.pendingQueue, ...nextPending],
      totalItems: state.totalItems + added.length,
      sessionCompleted: false,
      roundCompleted: false,
    };
  }

  return {
    ...state,
    pendingQueue: [...state.pendingQueue, ...added],
    totalItems: state.totalItems + added.length,
    sessionCompleted: false,
  };
}

export interface AdaptiveLearnProgressMetrics {
  /** Number of unique items graduated or actively progressed in this session (for top counter). */
  visitedCount: number;
  graduatedCount: number;
  totalItems: number;
  /** 0-based saved checkpoint item index for accurate ResumeSessionBanner display (`RU-06`). */
  currentIndex: number;
  /** Stage-weighted 0..100 progress percentage (never 0% once cards have been answered!). */
  progressPercent: number;
}

/**
 * Compute truthful Learn progress reflecting BOTH graduated items AND mid-stage progression (`V32-027` / `RU-06`).
 */
export function computeAdaptiveLearnProgress(
  state: AdaptiveLearnState,
): AdaptiveLearnProgressMetrics {
  const totalItems = Math.max(0, state.totalItems);
  const graduatedCount = state.graduatedIds.length;
  if (totalItems === 0) {
    return {
      visitedCount: 0,
      graduatedCount: 0,
      totalItems: 0,
      currentIndex: 0,
      progressPercent: 0,
    };
  }
  if (state.sessionCompleted) {
    return {
      visitedCount: totalItems,
      graduatedCount,
      totalItems,
      currentIndex: Math.max(0, totalItems - 1),
      progressPercent: 100,
    };
  }

  const meta = getLearnObjectiveMeta(state.objective);
  const span = Math.max(1, state.targetStage - 1);
  let engagedInQueues = 0;
  let partialCredit = 0;

  for (const card of [...state.activeQueue, ...state.pendingQueue]) {
    const hasEngaged =
      card.recognitionPasses > 0 ||
      card.recallPasses > 0 ||
      card.verificationPasses > 0 ||
      card.missedInSession ||
      card.stage > meta.initialStageForNew;
    if (hasEngaged) {
      engagedInQueues += 1;
      const stageFrac = Math.max(0.25, Math.min(0.85, (card.stage - 1) / span));
      partialCredit += stageFrac;
    }
  }

  const visitedCount = Math.min(
    totalItems,
    Math.max(
      graduatedCount + engagedInQueues,
      state.totalAttempts > 0 ? Math.min(totalItems, state.totalAttempts) : 0,
    ),
  );

  const hasActivity = graduatedCount > 0 || state.totalAttempts > 0 || engagedInQueues > 0;
  const rawPercent = Math.round(((graduatedCount + partialCredit) / totalItems) * 100);
  const progressPercent = hasActivity
    ? Math.max(1, Math.min(99, rawPercent || Math.round((visitedCount / totalItems) * 50)))
    : 0;
  const currentIndex = hasActivity
    ? Math.min(Math.max(0, totalItems - 1), visitedCount)
    : 0;

  return {
    visitedCount,
    graduatedCount,
    totalItems,
    currentIndex,
    progressPercent,
  };
}

export function getCurrentAdaptiveCard(
  state: AdaptiveLearnState,
): AdaptiveLearnCardState | null {
  return state.activeQueue[0] ?? null;
}

function reinsertWithGap(
  rest: readonly AdaptiveLearnCardState[],
  card: AdaptiveLearnCardState,
  preferredGap: number,
): AdaptiveLearnCardState[] {
  const idx = Math.min(Math.max(1, preferredGap), rest.length);
  return [...rest.slice(0, idx), card, ...rest.slice(idx)];
}

/**
 * Advance the current card in the 5-stage deterministic Learn engine.
 * - Stage 1 (Familiarization): always advances to Stage 2.
 * - Stage 2 (Recognition): NEVER grants `mastered` / Stage 5 directly!
 * - Stage 3 (Recall): advances to Stage 4 Verification (or graduates if targetStage <= 3 and clean).
 * - Stage 4 (Independent Verification): requires `!usedHint`, `confidence !== "guessing"`, and intervening gap!
 * - Wrong answers: optional bounded forced correction (<= maxForcedRetries), then reinsert 2–4 cards later.
 */
export function recordAdaptiveLearnStep(
  state: AdaptiveLearnState,
  questionDescriptor: QuestionCompatibilityDescriptor,
  step: AdaptiveLearnStepInput,
): AdaptiveLearnStepResult {
  if (state.activeQueue.length === 0) {
    return {
      nextState: state,
      cardGraduated: false,
      enteredForcedCorrection: false,
      recognitionCannotMasterNotice: false,
      stageTransition: { from: 5, to: 5 },
    };
  }

  const [current, ...rawRest] = state.activeQueue;
  // Increment intervening turn counters on all waiting cards when moving past current card
  const bumpRest = (): AdaptiveLearnCardState[] =>
    rawRest.map((c) => ({
      ...c,
      interveningTurnsSinceLastSeen: c.interveningTurnsSinceLastSeen + 1,
    }));

  const fromStage = current.stage;

  // Handle bounded forced-correction retry gate
  if (current.forcedCorrectionPending) {
    const nextRetries = current.forcedCorrectionRetries + 1;
    const exitForced =
      step.isCorrect ||
      step.skipForcedCorrection ||
      nextRetries >= state.maxForcedRetries;

    if (!exitForced) {
      const updated: AdaptiveLearnCardState = {
        ...current,
        forcedCorrectionRetries: nextRetries,
      };
      return {
        nextState: {
          ...state,
          activeQueue: [updated, ...rawRest],
        },
        cardGraduated: false,
        enteredForcedCorrection: true,
        recognitionCannotMasterNotice: false,
        stageTransition: { from: fromStage, to: fromStage },
      };
    }

    // Cleared forced correction -> reinsert after 2–3 cards at Stage 2/3 (never graduates directly!)
    const resetStage: LearnStage = fromStage >= 3 ? 3 : 2;
    const reinserted: AdaptiveLearnCardState = {
      ...current,
      stage: resetStage,
      activity: selectActivityForStage(questionDescriptor, resetStage),
      forcedCorrectionPending: false,
      forcedCorrectionRetries: 0,
      interveningTurnsSinceLastSeen: 0,
    };
    const nextQueue = reinsertWithGap(
      bumpRest(),
      reinserted,
      current.hadHighConfWrong ? 2 : 3,
    );
    return {
      nextState: {
        ...state,
        activeQueue: nextQueue,
      },
      cardGraduated: false,
      enteredForcedCorrection: false,
      recognitionCannotMasterNotice: false,
      stageTransition: { from: fromStage, to: resetStage },
    };
  }

  const totalAttempts = state.totalAttempts + 1;
  const correctAttempts = state.correctAttempts + (step.isCorrect ? 1 : 0);
  const usedHint = Boolean(step.usedHint);
  const confidence = step.confidence ?? null;
  let graduatedIds = state.graduatedIds;
  let missedIds = state.missedIds;

  // Stage 1: Familiarization exposure -> move to Stage 2 Recognition
  if (current.stage === 1) {
    const nextStage: LearnStage = 2;
    const nextCard: AdaptiveLearnCardState = {
      ...current,
      stage: nextStage,
      activity: selectActivityForStage(questionDescriptor, nextStage),
      interveningTurnsSinceLastSeen: 0,
    };
    const nextQueue = reinsertWithGap(bumpRest(), nextCard, 2);
    return {
      nextState: {
        ...state,
        activeQueue: nextQueue,
        totalAttempts,
        correctAttempts,
      },
      cardGraduated: false,
      enteredForcedCorrection: false,
      recognitionCannotMasterNotice: false,
      stageTransition: { from: 1, to: 2 },
    };
  }

  // Wrong answer at Stages 2–4
  if (!step.isCorrect) {
    const isHighConfWrong = confidence === "certain";
    if (!missedIds.includes(current.questionId)) {
      missedIds = [...missedIds, current.questionId];
    }

    // Only engage forced correction when enabled AND item has a text/recallable correction
    const canForceCorrect =
      state.forcedCorrection &&
      !isImageOnlyQuestion(questionDescriptor) &&
      (current.activity === "write" ||
        current.activity === "spell" ||
        current.activity === "numerical" ||
        current.activity === "fill_in_blank");

    if (canForceCorrect) {
      const gatedCard: AdaptiveLearnCardState = {
        ...current,
        missedInSession: true,
        forcedCorrectionPending: true,
        forcedCorrectionRetries: 0,
        lastConfidence: confidence,
        hadHighConfWrong: current.hadHighConfWrong || isHighConfWrong,
      };
      return {
        nextState: {
          ...state,
          activeQueue: [gatedCard, ...rawRest],
          missedIds,
          totalAttempts,
          correctAttempts,
        },
        cardGraduated: false,
        enteredForcedCorrection: true,
        recognitionCannotMasterNotice: false,
        stageTransition: { from: fromStage, to: fromStage },
      };
    }

    // Demote back to Stage 2 (Recognition) on miss and reinsert after 2–3 cards
    const demotedStage: LearnStage = 2;
    const demotedCard: AdaptiveLearnCardState = {
      ...current,
      stage: demotedStage,
      activity: selectActivityForStage(questionDescriptor, demotedStage),
      missedInSession: true,
      interveningTurnsSinceLastSeen: 0,
      lastConfidence: confidence,
      hadHighConfWrong: current.hadHighConfWrong || isHighConfWrong,
    };
    const gap = isHighConfWrong ? 2 : 3;
    const nextQueue = reinsertWithGap(bumpRest(), demotedCard, gap);

    return {
      nextState: {
        ...state,
        activeQueue: nextQueue,
        missedIds,
        totalAttempts,
        correctAttempts,
      },
      cardGraduated: false,
      enteredForcedCorrection: false,
      recognitionCannotMasterNotice: false,
      stageTransition: { from: fromStage, to: demotedStage },
    };
  }

  // Correct answer! Evaluate confidence, hint usage, and stage rules
  const isGuess = confidence === "guessing";
  const isUnsure = confidence === "unsure";
  const isCleanIndependent = !isGuess && !usedHint;
  let recognitionCannotMasterNotice = false;

  let nextStage: LearnStage = current.stage;
  let shouldGraduate = false;

  if (current.stage === 2) {
    // Recognition passed — NEVER directly grants Stage 5 (`mastered`)!
    if (state.targetStage <= 2 && isCleanIndependent && !isUnsure) {
      shouldGraduate = true;
      nextStage = 2;
    } else if (isGuess || usedHint) {
      // Repeat recognition after spacing gap when guessed or hinted
      nextStage = 2;
    } else {
      nextStage = 3;
      if (state.targetStage >= 5) {
        recognitionCannotMasterNotice = true;
      }
    }
  } else if (current.stage === 3) {
    // Active Recall passed
    if (isGuess || usedHint) {
      // Must perform clean recall without guessing/hinting before moving to verification
      nextStage = 3;
    } else if (state.targetStage <= 3 && !isUnsure) {
      shouldGraduate = true;
      nextStage = 3;
    } else {
      // Advance to Stage 4 Independent Verification after an intervening gap
      nextStage = 4;
    }
  } else if (current.stage >= 4) {
    // Stage 4 Independent Verification
    const hasSufficientGap =
      rawRest.length === 0 ||
      current.interveningTurnsSinceLastSeen >=
        Math.min(state.verificationMinGap, rawRest.length);

    if (isCleanIndependent && !isUnsure && hasSufficientGap) {
      nextStage = 5;
      shouldGraduate = true;
    } else {
      // Needs one more spaced independent verification without guessing/hints
      nextStage = 4;
    }
  }

  const bumpedRest = bumpRest();
  let nextQueue: AdaptiveLearnCardState[];

  if (shouldGraduate) {
    nextQueue = bumpedRest;
    if (!graduatedIds.includes(current.questionId)) {
      graduatedIds = [...graduatedIds, current.questionId];
    }
  } else {
    const updatedCard: AdaptiveLearnCardState = {
      ...current,
      stage: nextStage,
      activity: selectActivityForStage(questionDescriptor, nextStage),
      recognitionPasses:
        current.stage === 2
          ? current.recognitionPasses + 1
          : current.recognitionPasses,
      recallPasses:
        current.stage === 3 ? current.recallPasses + 1 : current.recallPasses,
      verificationPasses:
        current.stage >= 4
          ? current.verificationPasses + 1
          : current.verificationPasses,
      interveningTurnsSinceLastSeen: 0,
      lastConfidence: confidence,
    };
    const gap =
      nextStage === 4
        ? Math.max(state.verificationMinGap, 3)
        : isGuess || isUnsure
          ? 3
          : 2;
    nextQueue = reinsertWithGap(bumpedRest, updatedCard, gap);
  }

  const roundCompleted = nextQueue.length === 0;
  const sessionCompleted = roundCompleted && state.pendingQueue.length === 0;

  return {
    nextState: {
      ...state,
      activeQueue: nextQueue,
      graduatedIds,
      missedIds,
      totalAttempts,
      correctAttempts,
      roundCompleted,
      sessionCompleted,
    },
    cardGraduated: shouldGraduate,
    enteredForcedCorrection: false,
    recognitionCannotMasterNotice,
    stageTransition: { from: fromStage, to: nextStage },
  };
}

/**
 * Start the next batch/round when the current round completes.
 */
export function advanceAdaptiveLearnRound(
  state: AdaptiveLearnState,
): AdaptiveLearnState {
  if (!state.roundCompleted || state.pendingQueue.length === 0) {
    return state;
  }
  const nextActive = state.pendingQueue.slice(0, state.batchSize);
  const nextPending = state.pendingQueue.slice(state.batchSize);
  return {
    ...state,
    roundNumber: state.roundNumber + 1,
    activeQueue: nextActive,
    pendingQueue: nextPending,
    roundCompleted: nextActive.length === 0,
    sessionCompleted: nextActive.length === 0 && nextPending.length === 0,
  };
}

export interface AdaptiveLearnSummary {
  roundNumber: number;
  totalItems: number;
  graduatedCount: number;
  remainingInRound: number;
  remainingInPool: number;
  missedCount: number;
  totalAttempts: number;
  correctAttempts: number;
  accuracyPercent: number;
  stageCounts: Record<LearnStage, number>;
}

export function getAdaptiveLearnSummary(
  state: AdaptiveLearnState,
): AdaptiveLearnSummary {
  const stageCounts: Record<LearnStage, number> = {
    1: 0,
    2: 0,
    3: 0,
    4: 0,
    5: state.graduatedIds.length,
  };
  for (const c of state.activeQueue) stageCounts[c.stage] += 1;
  for (const c of state.pendingQueue) stageCounts[c.stage] += 1;

  return {
    roundNumber: state.roundNumber,
    totalItems: state.totalItems,
    graduatedCount: state.graduatedIds.length,
    remainingInRound: state.activeQueue.length,
    remainingInPool: state.pendingQueue.length,
    missedCount: state.missedIds.length,
    totalAttempts: state.totalAttempts,
    correctAttempts: state.correctAttempts,
    accuracyPercent:
      state.totalAttempts > 0
        ? Math.round((state.correctAttempts / state.totalAttempts) * 100)
        : 0,
    stageCounts,
  };
}

const STRICT_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value: string): boolean {
  return STRICT_UUID_REGEX.test(value);
}

/**
 * Prepares a strictly API-valid choice answer payload for `POST /api/sessions/[id]/answers`.
 * - Real DB `question_options` UUIDs -> sends `selected_option_ids` + `{ kind: "options" }`.
 * - Client-synthesized flashcard/vocab recognition distractors (`fc-correct-*` / `fc-dist-*`) ->
 *   sends `selected_option_ids: []` + chosen option text in `typed_answer` and `{ kind: "text" }`
 *   so Zod UUID validation NEVER rejects auto-generated MCQ recognition steps (`V3-UX-02`).
 */
export function buildSessionChoiceAnswerPayload(
  selectedIds: readonly string[],
  displayedOptions: readonly {
    id: string;
    content?: string | null;
    label?: string | null;
  }[],
): {
  selectedOptionIds: string[];
  typedAnswer: string;
  structuredResponse: StructuredAnswerResponse;
} {
  if (selectedIds.length > 0 && selectedIds.every(isValidUuid)) {
    const cleanIds = [...selectedIds];
    return {
      selectedOptionIds: cleanIds,
      typedAnswer: "",
      structuredResponse: {
        kind: "options",
        selected_option_ids: cleanIds,
      },
    };
  }

  const optById = new Map(displayedOptions.map((o) => [o.id, o]));
  const chosenText = selectedIds
    .map((id) => {
      const opt = optById.get(id);
      return (opt?.content ?? opt?.label ?? "").trim();
    })
    .filter(Boolean)
    .join(" | ")
    .slice(0, 5000);

  return {
    selectedOptionIds: [],
    typedAnswer: chosenText,
    structuredResponse: {
      kind: "text",
      value: chosenText,
    },
  };
}
