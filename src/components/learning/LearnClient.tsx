"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Brain,
  CheckCircle2,
  ChevronDown,
  Clock,
  Crosshair,
  Layers,
  RotateCcw,
  Settings2,
  SkipForward,
  Star,
  Target,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/lib/i18n";
import { useUserPreferences } from "@/lib/preferences";
import {
  advanceAdaptiveLearnRound,
  appendAdaptiveLearnSeeds,
  buildSessionChoiceAnswerPayload,
  computeAdaptiveLearnProgress,
  createAdaptiveLearnState,
  filterAdaptiveLearnSeeds,
  getAdaptiveLearnSummary,
  getCurrentAdaptiveCard,
  getLearnObjectiveMeta,
  isValidUuid,
  LEARN_OBJECTIVES,
  LEARN_STAGE_LABELS,
  recordAdaptiveLearnStep,
  type AdaptiveLearnFilterConfig,
  type AdaptiveLearnItemSeed,
  type AdaptiveLearnState,
  type LearnObjective,
} from "@/lib/learning/adaptive-learn";
import {
  formatCorrectAnswerDisplay,
  isMultiSelectChoiceQuestion,
} from "@/lib/learning/answer-display";
import {
  createStudySession,
  deleteCheckpoint,
  isInteractiveControlTarget,
  isSafeDisplayImageUrl,
  listCheckpoints,
  recordStudySessionAnswer,
  updateStudySession,
  upsertCheckpoint,
  upsertCheckpointKeepalive,
  upsertQuestionProgress,
} from "@/lib/learning/api-client";
import {
  clearLocalCheckpoint,
  loadLocalCheckpoint,
  makeCheckpointSessionKey,
  pickNewestCheckpoint,
  reconcileCheckpointQuestions,
  saveLocalCheckpoint,
} from "@/lib/learning/checkpoints";
import { applyConfidenceToSm2 } from "@/lib/learning/confidence";
import { projectQuestionToFlashcard } from "@/lib/learning/flashcard-projection";
import {
  createSeededRng,
  gradeChoiceSelection,
  shuffleOptions,
  withOptionDisplayLabels,
  type DisplayedOption,
} from "@/lib/learning/shuffle";
import {
  createInitialProgressState,
  summarizeMastery,
} from "@/lib/learning/sm2";
import {
  getExpectedWriteAnswers,
  gradeWriteAnswer,
} from "@/lib/learning/write-grader";
import { gradeQuestionResponse } from "@/lib/questions";
import { invalidateLearningCaches } from "@/lib/query-keys";
import { shouldIgnoreShortcutEvent } from "@/lib/ui/shortcuts";
import type {
  ConfidenceLevel,
  NormalizedPoint,
  Question,
  QuestionOption,
  StructuredAnswerResponse,
} from "@/types/domain";
import { cn, formatDuration } from "@/lib/utils";
import { ConfidenceSelector } from "./ConfidenceSelector";
import { FocusModeShell } from "./FocusModeShell";
import { lText } from "./learning-copy";
import { QuestionNotesAndReportBar } from "./QuestionNotesAndReportBar";
import { ResetProgressDialog } from "./ResetProgressDialog";
import { ResumeSessionBanner } from "./ResumeSessionBanner";
import { SafeRichText, ZoomableImage } from "./SafeRichText";
import {
  StudyEmptyState,
  StudyErrorState,
  StudyLoadingSkeleton,
  useAuthenticatedUserId,
  useStudySetBundle,
} from "./useStudySetBundle";
import { deterministicShuffleBySeed } from "./V3StructuredPracticeControls";

function mapPreferenceLearnObjective(
  prefObj?: "quick_familiarity" | "exam_prep" | "long_term_retention",
): LearnObjective {
  switch (prefObj) {
    case "quick_familiarity":
      return "familiarize";
    case "exam_prep":
      return "exam_prep";
    case "long_term_retention":
    default:
      return "master";
  }
}

export interface LearnClientProps {
  setId: string;
}

interface LearnFeedbackState {
  isCorrect: boolean;
  expectedText: string;
  explanation?: string | null;
  explanationRich?: Question["explanation_rich"];
  stageMessage?: string | null;
  isForcedCorrectionPrompt?: boolean;
}

export function LearnClient({ setId }: LearnClientProps) {
  const { locale, t } = useI18n();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const isFreshLaunch = searchParams.get("fresh") === "1";
  const { preferences, playFeedbackSound } = useUserPreferences();
  const authenticatedUserId = useAuthenticatedUserId();
  const learnPrefs = preferences.mode_preferences?.learn;

  const {
    data: bundle,
    isLoading,
    isError,
    error,
    refetch,
    toggleStar,
    updateLocalProgress,
  } = useStudySetBundle(setId);

  // Clean simple default mode + full session configuration hydrated from mode_preferences.learn (V32-025)
  const [objective, setObjective] = React.useState<LearnObjective>(() =>
    mapPreferenceLearnObjective(learnPrefs?.objective),
  );
  const [pendingObjectiveSwitch, setPendingObjectiveSwitch] =
    React.useState<LearnObjective | null>(null);
  const [goalPopoverOpen, setGoalPopoverOpen] = React.useState(false);
  const [selectedChapter, setSelectedChapter] = React.useState<string>("all");
  const [selectedTagId, setSelectedTagId] = React.useState<string>("all");
  const [onlyNew, setOnlyNew] = React.useState(false);
  const [onlyIncorrect, setOnlyIncorrect] = React.useState(false);
  const [onlyDue, setOnlyDue] = React.useState(false);
  const [onlyLowConfidence, setOnlyLowConfidence] = React.useState(false);
  const [onlyStarred, setOnlyStarred] = React.useState(false);
  const [maxItems, setMaxItems] = React.useState<string>("all");
  const [roundSize, setRoundSize] = React.useState<number>(
    () => learnPrefs?.batch_size ?? 7,
  );
  const [forcedCorrection, setForcedCorrection] = React.useState<boolean>(false);
  const [confidenceOverride, setConfidenceOverride] = React.useState<
    boolean | null
  >(null);
  const confidenceEnabled =
    confidenceOverride ??
    (Boolean(preferences.confidence_enabled) ||
      Boolean(learnPrefs?.ask_confidence));
  const setConfidenceEnabled = React.useCallback((next: boolean) => {
    setConfidenceOverride(next);
  }, []);
  const [configNonce, setConfigNonce] = React.useState(0);

  // Active Learn state
  const [rawLearnState, setLearnState] =
    React.useState<AdaptiveLearnState | null>(null);
  const [completedDurationSeconds, setCompletedDurationSeconds] =
    React.useState(1);

  // Per-item interaction state
  const [selectedOptionIds, setSelectedOptionIds] = React.useState<string[]>([]);
  const [typedAnswer, setTypedAnswer] = React.useState("");
  const [forcedCorrectionDraft, setForcedCorrectionDraft] = React.useState("");
  const [blankAnswers, setBlankAnswers] = React.useState<Record<string, string>>(
    {},
  );
  const [numericalValue, setNumericalValue] = React.useState("");
  const [numericalUnit, setNumericalUnit] = React.useState("");
  const [orderedIds, setOrderedIds] = React.useState<string[]>([]);
  const [matchingPairs, setMatchingPairs] = React.useState<
    Record<string, string>
  >({});
  const [hotspotClicks, setHotspotClicks] = React.useState<NormalizedPoint[]>(
    [],
  );
  const [keyboardCursor, setKeyboardCursor] = React.useState<NormalizedPoint>({
    x: 0.5,
    y: 0.5,
  });
  const [selectedConfidence, setSelectedConfidence] =
    React.useState<ConfidenceLevel | null>(null);
  const [pendingNextState, setPendingNextState] =
    React.useState<AdaptiveLearnState | null>(null);
  const [feedback, setFeedback] = React.useState<LearnFeedbackState | null>(null);
  const [resetDialogOpen, setResetDialogOpen] = React.useState(false);

  const requestObjectiveChange = React.useCallback(
    (nextObj: LearnObjective) => {
      if (nextObj === objective) {
        setGoalPopoverOpen(false);
        return;
      }
      if (
        rawLearnState &&
        rawLearnState.totalAttempts > 0 &&
        !rawLearnState.sessionCompleted
      ) {
        setGoalPopoverOpen(false);
        setPendingObjectiveSwitch(nextObj);
      } else {
        setGoalPopoverOpen(false);
        setObjective(nextObj);
      }
    },
    [objective, rawLearnState],
  );

  // Checkpoint resume banner state
  const sessionKey = React.useMemo(
    () =>
      makeCheckpointSessionKey(
        "learn",
        setId,
        `${objective}_${selectedChapter}`,
      ),
    [objective, selectedChapter, setId],
  );
  const [pendingResume, setPendingResume] = React.useState<{
    source: "remote" | "local";
    currentIndex: number;
    totalItems: number;
    progressPercent: number;
    updatedAt: string | null;
    removedCount: number;
    restoredState: AdaptiveLearnState;
  } | null>(null);

  const sessionIdRef = React.useRef<string | null>(null);
  const sessionStartRef = React.useRef<number>(0);
  const cardStartRef = React.useRef<number>(0);
  const initializedKeyRef = React.useRef<string | null>(null);

  const bundleQuestions = bundle?.questions;

  const questionMap = React.useMemo(() => {
    const map = new Map<string, Question>();
    for (const q of bundleQuestions ?? []) {
      map.set(q.id, q);
    }
    return map;
  }, [bundleQuestions]);

  const allTags = React.useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    for (const q of bundleQuestions ?? []) {
      for (const tag of q.tags ?? []) {
        if (!map.has(tag.id)) map.set(tag.id, { id: tag.id, name: tag.name });
      }
    }
    return Array.from(map.values());
  }, [bundleQuestions]);

  const filterConfig = React.useMemo<AdaptiveLearnFilterConfig>(() => {
    return {
      chapters: selectedChapter !== "all" ? [selectedChapter] : undefined,
      tagIds: selectedTagId !== "all" ? [selectedTagId] : undefined,
      onlyNew,
      onlyIncorrect,
      onlyDue,
      onlyLowConfidence,
      onlyStarred,
      maxItems: maxItems === "all" ? null : Number(maxItems) || null,
    };
  }, [
    maxItems,
    onlyDue,
    onlyIncorrect,
    onlyLowConfidence,
    onlyNew,
    onlyStarred,
    selectedChapter,
    selectedTagId,
  ]);

  const filteredSeeds = React.useMemo<AdaptiveLearnItemSeed[]>(() => {
    if (!bundleQuestions || !bundle) return [];
    const seeds: AdaptiveLearnItemSeed[] = bundleQuestions.map((question) => ({
      question,
      progress: bundle.progressMap.get(question.id) ?? null,
      isStarred: bundle.starredIds.has(question.id),
    }));
    return filterAdaptiveLearnSeeds(seeds, filterConfig);
  }, [bundle, bundleQuestions, filterConfig]);

  const masterySummary = React.useMemo(() => {
    if (!bundle) {
      return { total: 0, new: 0, learning: 0, familiar: 0, mastered: 0, due: 0 };
    }
    return summarizeMastery(
      filteredSeeds.map(
        (s) => s.progress ?? createInitialProgressState(),
      ),
    );
  }, [bundle, filteredSeeds]);

  const clearCardInputs = React.useCallback((question?: Question | null) => {
    setSelectedOptionIds([]);
    setTypedAnswer("");
    setForcedCorrectionDraft("");
    setBlankAnswers({});
    setNumericalValue("");
    setNumericalUnit("");
    setMatchingPairs({});
    setHotspotClicks([]);
    setSelectedConfidence(null);
    setFeedback(null);
    if (question?.type_payload?.type === "ordering") {
      // Deterministic initial shuffle for ordering items
      const items = question.type_payload.items;
      const rng = createSeededRng(question.id.length * 31 + items.length);
      const copy = [...items];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      setOrderedIds(copy.map((it) => it.id));
    } else {
      setOrderedIds([]);
    }
  }, []);

  // Initialize queue & session strictly ONCE per explicit config key (preserves SH-008 fix!)
  const bundleRef = React.useRef(bundle);
  const seedsRef = React.useRef(filteredSeeds);
  React.useEffect(() => {
    bundleRef.current = bundle;
    seedsRef.current = filteredSeeds;
  }, [bundle, filteredSeeds]);

  const initConfigKey = [
    setId,
    objective,
    selectedChapter,
    selectedTagId,
    onlyNew,
    onlyIncorrect,
    onlyDue,
    onlyLowConfidence,
    onlyStarred,
    maxItems,
    roundSize,
    forcedCorrection,
    learnPrefs?.enable_written_recall ?? true,
    learnPrefs?.require_independent_recall ?? true,
    configNonce,
    bundleQuestions && bundleQuestions.length > 0 ? "ready" : "empty",
  ].join("|");

  React.useEffect(() => {
    const activeBundle = bundleRef.current;
    if (!activeBundle) return;
    if (initializedKeyRef.current === initConfigKey) return;
    initializedKeyRef.current = initConfigKey;

    const currentSeeds = seedsRef.current;
    const nextState = createAdaptiveLearnState(currentSeeds, {
      objective,
      batchSize: roundSize,
      forcedCorrection,
      maxForcedRetries: 2,
      enableWrittenRecall: learnPrefs?.enable_written_recall,
      requireIndependentRecall: learnPrefs?.require_independent_recall,
    });
    setLearnState(nextState);
    setPendingNextState(null);
    const firstCard = getCurrentAdaptiveCard(nextState);
    clearCardInputs(
      firstCard ? activeBundle.questions.find((q) => q.id === firstCard.questionId) : null,
    );
    sessionStartRef.current = Date.now();
    cardStartRef.current = Date.now();
    sessionIdRef.current = null;

    if (currentSeeds.length > 0) {
      void createStudySession({
        study_set_id: setId,
        mode: "learn",
        config: { objective, chapter: selectedChapter, roundSize, forcedCorrection },
        total_items: currentSeeds.length,
      })
        .then((s) => {
          sessionIdRef.current = s.id;
        })
        .catch(() => {});

      // Honor ?fresh=1 (FUNC-17): clear local + remote checkpoints and start fresh
      if (isFreshLaunch) {
        if (authenticatedUserId) {
          clearLocalCheckpoint(authenticatedUserId, sessionKey);
        }
        void deleteCheckpoint({ sessionKey }).catch(() => {});
        setPendingResume(null);
        return;
      }

      // Check resumable checkpoints keyed by authenticatedUserId (NEVER bundle.studySet.owner_id — FUNC-17!)
      const liveSet = new Set(currentSeeds.map((s) => s.question.id));
      const localCp = authenticatedUserId
        ? loadLocalCheckpoint(authenticatedUserId, sessionKey)
        : null;
      void listCheckpoints({ studySetId: setId, mode: "learn", sessionKey })
        .then((remotes) => {
          const picked = pickNewestCheckpoint(remotes[0] ?? null, localCp);
          if (picked.source === "none" || picked.progressPercent >= 100) {
            setPendingResume(null);
            return;
          }
          const saved = picked.stateJson as { learnState?: AdaptiveLearnState };
          if (!saved.learnState) return;
          const allSavedIds = [
            ...saved.learnState.activeQueue.map((c) => c.questionId),
            ...saved.learnState.pendingQueue.map((c) => c.questionId),
          ];
          const rec = reconcileCheckpointQuestions(allSavedIds, liveSet, 0);
          if (rec.validIds.length === 0) {
            setPendingResume(null);
            return;
          }
          const cleaned: AdaptiveLearnState = {
            ...saved.learnState,
            activeQueue: saved.learnState.activeQueue.filter((c) =>
              liveSet.has(c.questionId),
            ),
            pendingQueue: saved.learnState.pendingQueue.filter((c) =>
              liveSet.has(c.questionId),
            ),
            graduatedIds: saved.learnState.graduatedIds.filter((id) =>
              liveSet.has(id),
            ),
            missedIds: saved.learnState.missedIds.filter((id) =>
              liveSet.has(id),
            ),
          };
          if (cleaned.activeQueue.length === 0 && cleaned.pendingQueue.length > 0) {
            cleaned.activeQueue = cleaned.pendingQueue.slice(0, cleaned.batchSize);
            cleaned.pendingQueue = cleaned.pendingQueue.slice(cleaned.batchSize);
          }
          if (cleaned.activeQueue.length === 0) return;

          // Compute accurate progress for Resume banner (V32-027 / RU-06)
          const restoredProgress = computeAdaptiveLearnProgress(cleaned);
          setPendingResume({
            source: picked.source,
            currentIndex: Math.max(picked.currentIndex, restoredProgress.currentIndex),
            totalItems: cleaned.totalItems,
            progressPercent: Math.max(
              picked.progressPercent,
              restoredProgress.progressPercent,
            ),
            updatedAt: picked.updatedAt,
            removedCount: rec.removedIds.length,
            restoredState: cleaned,
          });
        })
        .catch(() => {});
    }
  }, [
    authenticatedUserId,
    clearCardInputs,
    forcedCorrection,
    initConfigKey,
    isFreshLaunch,
    learnPrefs?.enable_written_recall,
    learnPrefs?.require_independent_recall,
    objective,
    roundSize,
    selectedChapter,
    sessionKey,
    setId,
  ]);

  // Progressive background streaming append (100% pure derived state — V32-015):
  // Appends Pages 2..N into pendingQueue without resetting activeQueue[0] or causing effect setState cascades.
  const learnState = React.useMemo(
    () =>
      rawLearnState
        ? appendAdaptiveLearnSeeds(rawLearnState, filteredSeeds)
        : null,
    [filteredSeeds, rawLearnState],
  );

  const currentCard = learnState
    ? getCurrentAdaptiveCard(learnState)
    : null;
  const currentQuestion = currentCard
    ? questionMap.get(currentCard.questionId) ?? null
    : null;

  // Build deterministic MC options for current question (including distractor generation for Flashcards!)
  const displayedOptions = React.useMemo<Array<DisplayedOption<QuestionOption>>>(() => {
    if (!currentQuestion || !currentCard) return [];
    const opts = currentQuestion.options ?? [];
    if (opts.length > 0) {
      const sorted = [...opts].sort((a, b) => a.position - b.position);
      if (!preferences.default_shuffle_options) {
        return withOptionDisplayLabels(sorted);
      }
      const rng = createSeededRng(
        currentQuestion.id.length * 17 +
          (learnState?.totalAttempts ?? 0) * 13 +
          currentCard.stage,
      );
      return shuffleOptions(sorted, rng);
    }

    // Generate deterministic recognition distractors for flashcard items at Stage 2
    if (
      currentCard.activity === "multiple_choice" &&
      currentQuestion.back_text?.trim() &&
      bundleQuestions &&
      bundleQuestions.length >= 2
    ) {
      const correctOpt: QuestionOption = {
        id: `fc-correct-${currentQuestion.id}`,
        question_id: currentQuestion.id,
        study_set_id: setId,
        position: 0,
        label: "A",
        content: currentQuestion.back_text.trim(),
        image_url: currentQuestion.back_image_url,
        is_correct: true,
        created_at: currentQuestion.created_at,
      };
      const distractors: QuestionOption[] = [];
      const seen = new Set<string>([correctOpt.content.toLowerCase()]);
      for (const other of bundleQuestions) {
        if (other.id === currentQuestion.id) continue;
        const candidateText = (
          other.back_text ??
          other.options?.find((o) => o.is_correct)?.content ??
          ""
        ).trim();
        if (!candidateText || seen.has(candidateText.toLowerCase())) continue;
        seen.add(candidateText.toLowerCase());
        distractors.push({
          id: `fc-dist-${other.id}`,
          question_id: currentQuestion.id,
          study_set_id: setId,
          position: distractors.length + 1,
          label: "",
          content: candidateText,
          image_url: other.back_image_url,
          is_correct: false,
          created_at: other.created_at,
        });
        if (distractors.length >= 3) break;
      }
      if (distractors.length >= 1) {
        const rng = createSeededRng(
          currentQuestion.id.length * 19 + (learnState?.totalAttempts ?? 0),
        );
        return shuffleOptions([correctOpt, ...distractors], rng);
      }
    }

    return [];
  }, [
    bundleQuestions,
    currentCard,
    currentQuestion,
    learnState?.totalAttempts,
    preferences.default_shuffle_options,
    setId,
  ]);

  const saveLearnCheckpoint = React.useCallback(
    (nextState: AdaptiveLearnState, keepalive: boolean = false) => {
      if (!bundle) return;
      if (nextState.sessionCompleted) {
        if (authenticatedUserId) {
          clearLocalCheckpoint(authenticatedUserId, sessionKey);
        }
        void deleteCheckpoint({ sessionKey }).catch(() => {});
        return;
      }
      const progress = computeAdaptiveLearnProgress(nextState);
      const stateJson = { learnState: nextState };
      if (authenticatedUserId) {
        saveLocalCheckpoint({
          version: 1,
          userId: authenticatedUserId,
          studySetId: setId,
          mode: "learn",
          sessionKey,
          currentIndex: progress.currentIndex,
          totalItems: progress.totalItems,
          progressPercent: progress.progressPercent,
          stateJson,
          committedEventKeys: [],
          updatedAt: new Date().toISOString(),
        });
      }
      const remotePayload = {
        study_set_id: setId,
        mode: "learn" as const,
        session_key: sessionKey,
        state_json: stateJson,
        progress_percent: progress.progressPercent,
        current_index: progress.currentIndex,
        total_items: progress.totalItems,
      };
      if (keepalive) {
        upsertCheckpointKeepalive(remotePayload);
      } else {
        void upsertCheckpoint(remotePayload).catch(() => {});
      }
    },
    [authenticatedUserId, bundle, sessionKey, setId],
  );

  // Flush Learn checkpoint synchronously on pagehide / hidden tab so progress is never dropped (V32-027)
  const latestLearnStateRef = React.useRef<AdaptiveLearnState | null>(null);
  React.useEffect(() => {
    latestLearnStateRef.current = pendingNextState ?? learnState;
  }, [learnState, pendingNextState]);

  React.useEffect(() => {
    const flushNow = () => {
      const state = latestLearnStateRef.current;
      if (!state || state.sessionCompleted || state.totalAttempts === 0) return;
      saveLearnCheckpoint(state, true);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") flushNow();
    };
    window.addEventListener("pagehide", flushNow);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", flushNow);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [saveLearnCheckpoint]);

  const persistProgressAndAdvance = React.useCallback(
    (
      question: Question,
      isCorrect: boolean,
      expectedText: string,
      selectedIds: string[],
      typedText: string,
      structuredResponse: StructuredAnswerResponse | null,
      skipImmediateFeedback: boolean = false,
    ) => {
      if (!learnState || !currentCard || !bundle) return;

      const confidence = confidenceEnabled ? selectedConfidence : null;
      const isRecognitionOnly = currentCard.stage <= 2;

      // Record in SM-2 + Confidence engine (except pure Stage 1 exposure)
      if (currentCard.stage >= 2) {
        const prevProgress = bundle.progressMap.get(question.id) ?? null;
        const sm2 = applyConfidenceToSm2({
          previous: prevProgress ?? undefined,
          isCorrect,
          confidence,
          isRecognitionOnly,
        });
        updateLocalProgress({
          ...(prevProgress ?? {
            id: `local-${question.id}`,
            user_id: "",
            study_set_id: setId,
            question_id: question.id,
            updated_at: new Date().toISOString(),
          }),
          ...sm2.next,
          updated_at: new Date().toISOString(),
        });

        const responseTimeMs = Math.max(0, Date.now() - cardStartRef.current);
        const safeSelectedIds = selectedIds.filter(isValidUuid);
        const safeStructuredResponse: StructuredAnswerResponse | null =
          structuredResponse?.kind === "options" &&
          !structuredResponse.selected_option_ids.every(isValidUuid)
            ? { kind: "text", value: typedText }
            : structuredResponse;
        if (sessionIdRef.current) {
          void recordStudySessionAnswer(sessionIdRef.current, {
            question_id: question.id,
            selected_option_ids: safeSelectedIds,
            typed_answer: typedText || null,
            structured_response: safeStructuredResponse,
            confidence,
            is_correct: isCorrect,
            response_time_ms: responseTimeMs,
            update_progress: true,
          }).catch(() => {});
        } else {
          void upsertQuestionProgress({
            study_set_id: setId,
            question_id: question.id,
            is_correct: isCorrect,
            confidence,
            ...sm2.next,
          }).catch(() => {});
        }
      }

      const stepRes = recordAdaptiveLearnStep(learnState, question, {
        isCorrect,
        confidence,
      });

      if (skipImmediateFeedback) {
        setLearnState(stepRes.nextState);
        saveLearnCheckpoint(stepRes.nextState);
        const nextCard = getCurrentAdaptiveCard(stepRes.nextState);
        clearCardInputs(nextCard ? questionMap.get(nextCard.questionId) : null);
        cardStartRef.current = Date.now();
        return;
      }

      playFeedbackSound(isCorrect ? "correct" : "wrong");

      // If bounded forced correction engaged, keep current card active until corrected or skipped
      if (stepRes.enteredForcedCorrection) {
        setLearnState(stepRes.nextState);
        setFeedback({
          isCorrect: false,
          expectedText,
          explanation: question.explanation,
          explanationRich: question.explanation_rich,
          isForcedCorrectionPrompt: true,
          stageMessage: lText(
            locale,
            "Hãy gõ lại đáp án đúng một lần để củng cố trí nhớ (hoặc bấm Bỏ qua để tiếp tục).",
            "Retype the correct answer once to reinforce recall (or click Skip to continue).",
          ),
        });
        return;
      }

      const stageMessage = stepRes.recognitionCannotMasterNotice
        ? lText(
            locale,
            "Đã vượt qua Bước 2 (Nhận diện) — chuyển sang Bước 3 (Tự nhớ lại). Nhận diện đơn lẻ chưa đủ để đạt Thành thạo.",
            "Passed Stage 2 (Recognition) — advancing to Stage 3 (Recall). Recognition alone never grants Mastered.",
          )
        : stepRes.cardGraduated
          ? lText(
              locale,
              "Tuyệt vời! Bạn đã hoàn thành mục tiêu cho câu này.",
              "Well done! You completed the objective for this item.",
            )
          : confidence === "guessing" && isCorrect
            ? lText(
                locale,
                "Bạn chọn đúng nhưng đang Đoán mò — câu này sẽ được ôn lại để kiểm chứng độc lập.",
                "Correct on a guess — scheduled back for independent verification.",
              )
            : confidence === "certain" && !isCorrect
              ? lText(
                  locale,
                  "Lỗi tự tin cao (nhầm lẫn kiến thức) — ưu tiên xuất hiện lại sớm.",
                  "High-confidence mistake flagged — prioritized for early review.",
                )
              : null;

      setFeedback({
        isCorrect,
        expectedText,
        explanation: question.explanation,
        explanationRich: question.explanation_rich,
        stageMessage,
      });

      // Defer queue transition until user clicks "Continue" so feedback never jumps mid-read (SH-008!)
      setPendingNextState(stepRes.nextState);
      // Persist checkpoint immediately so navigating back before clicking Continue still saves progress (RU-06)
      saveLearnCheckpoint(stepRes.nextState);
    },
    [
      bundle,
      clearCardInputs,
      confidenceEnabled,
      currentCard,
      learnState,
      locale,
      playFeedbackSound,
      questionMap,
      saveLearnCheckpoint,
      selectedConfidence,
      setId,
      updateLocalProgress,
    ],
  );

  const handleContinueAfterFeedback = React.useCallback(() => {
    const nextState = pendingNextState;
    if (!nextState) return;
    setPendingNextState(null);
    setLearnState(nextState);
    saveLearnCheckpoint(nextState);

    if (nextState.sessionCompleted) {
      const dur = Math.max(
        1,
        Math.round((Date.now() - sessionStartRef.current) / 1000),
      );
      setCompletedDurationSeconds(dur);
      playFeedbackSound("complete");
      if (sessionIdRef.current) {
        void updateStudySession(sessionIdRef.current, {
          status: "completed",
          total_items: nextState.totalItems,
          completed_items: nextState.graduatedIds.length,
          correct_items: nextState.correctAttempts,
          duration_seconds: dur,
        })
          .then(() => {
            invalidateLearningCaches(queryClient, setId);
          })
          .catch(() => {});
      } else {
        invalidateLearningCaches(queryClient, setId);
      }
      return;
    }

    const nextCard = getCurrentAdaptiveCard(nextState);
    clearCardInputs(nextCard ? questionMap.get(nextCard.questionId) : null);
    cardStartRef.current = Date.now();
  }, [
    clearCardInputs,
    pendingNextState,
    playFeedbackSound,
    queryClient,
    questionMap,
    saveLearnCheckpoint,
    setId,
  ]);

  const handleSubmitCurrentActivity = React.useCallback(
    (overrideOptionIds?: string[]) => {
      if (!currentQuestion || !currentCard || !learnState) return;

      // Bounded forced correction submission
      if (currentCard.forcedCorrectionPending) {
        const expected = getExpectedWriteAnswers(currentQuestion);
        const check = gradeWriteAnswer(forcedCorrectionDraft, expected);
        const stepRes = recordAdaptiveLearnStep(learnState, currentQuestion, {
          isCorrect: check.isCorrect,
          isForcedCorrectionAttempt: true,
        });
        setLearnState(stepRes.nextState);
        if (!stepRes.enteredForcedCorrection) {
          saveLearnCheckpoint(stepRes.nextState);
          const nextCard = getCurrentAdaptiveCard(stepRes.nextState);
          clearCardInputs(nextCard ? questionMap.get(nextCard.questionId) : null);
          cardStartRef.current = Date.now();
        } else {
          toast.error(
            lText(
              locale,
              "Chưa khớp đáp án chuẩn — hãy thử lại hoặc bấm Bỏ qua.",
              "Not quite matching yet — try once more or click Skip.",
            ),
          );
        }
        return;
      }

      if (feedback) return;

      const activity = currentCard.activity;

      // Stage 1 Flashcard Familiarization
      if (activity === "flashcard") {
        persistProgressAndAdvance(
          currentQuestion,
          true,
          "",
          [],
          "",
          null,
          true,
        );
        return;
      }

      // Multiple Choice / Image Choice / Reading MC / Listening MC
      if (
        activity === "multiple_choice" ||
        activity === "reading_mc" ||
        activity === "listening_mc"
      ) {
        const ids = overrideOptionIds ?? selectedOptionIds;
        if (ids.length === 0) return;
        const correctIds = displayedOptions
          .filter((o) => o.is_correct)
          .map((o) => o.id);
        const isCorrect = gradeChoiceSelection(ids, correctIds);
        const expectedText = displayedOptions
          .filter((o) => o.is_correct)
          .map((o) => o.content || o.label)
          .join(" / ");
        const answerPayload = buildSessionChoiceAnswerPayload(
          ids,
          displayedOptions,
        );
        persistProgressAndAdvance(
          currentQuestion,
          isCorrect,
          expectedText,
          answerPayload.selectedOptionIds,
          answerPayload.typedAnswer,
          answerPayload.structuredResponse,
        );
        return;
      }

      // Write / Spell recall (V32-003 FUNC-02: formatCorrectAnswerDisplay — ZERO [object Object]!)
      if (activity === "write" || activity === "spell") {
        if (!typedAnswer.trim()) return;
        const expected = getExpectedWriteAnswers(currentQuestion);
        const isCorrect = gradeWriteAnswer(typedAnswer, expected).isCorrect;
        const formattedExpected =
          formatCorrectAnswerDisplay(currentQuestion, locale) ||
          expected.map((e) => e.answer_text).filter(Boolean).join(" / ");
        persistProgressAndAdvance(
          currentQuestion,
          isCorrect,
          formattedExpected,
          [],
          typedAnswer.trim(),
          { kind: "text", value: typedAnswer.trim() },
        );
        return;
      }

      // Numerical recall
      if (activity === "numerical" && currentQuestion.type_payload?.type === "numerical") {
        if (!numericalValue.trim()) return;
        const resp: StructuredAnswerResponse = {
          kind: "numerical",
          value: numericalValue.trim(),
          unit: numericalUnit.trim() || null,
        };
        const grade = gradeQuestionResponse(currentQuestion, resp);
        const expectedText = formatCorrectAnswerDisplay(currentQuestion, locale);
        persistProgressAndAdvance(
          currentQuestion,
          grade.isCorrect,
          expectedText,
          [],
          `${numericalValue.trim()} ${numericalUnit.trim()}`.trim(),
          resp,
        );
        return;
      }

      // Fill in the blank (also supports listening + fill_in_blank)
      if (
        activity === "fill_in_blank" &&
        (currentQuestion.type_payload?.type === "fill_in_blank" ||
          (currentQuestion.type_payload?.type === "listening" &&
            currentQuestion.type_payload.sub_answer_kind === "fill_in_blank"))
      ) {
        const resp: StructuredAnswerResponse = {
          kind: "blanks",
          answers: blankAnswers,
        };
        const grade = gradeQuestionResponse(currentQuestion, resp);
        const expectedText = formatCorrectAnswerDisplay(currentQuestion, locale);
        persistProgressAndAdvance(
          currentQuestion,
          grade.isCorrect,
          expectedText,
          [],
          Object.values(blankAnswers).join(" | "),
          resp,
        );
        return;
      }

      // Ordering
      if (activity === "ordering" && currentQuestion.type_payload?.type === "ordering") {
        const resp: StructuredAnswerResponse = {
          kind: "ordering",
          ordered_item_ids: orderedIds,
        };
        const grade = gradeQuestionResponse(currentQuestion, resp);
        const expectedText = [...currentQuestion.type_payload.items]
          .sort((a, b) => a.correct_position - b.correct_position)
          .map((it, i) => `${i + 1}. ${it.text}`)
          .join(" → ");
        persistProgressAndAdvance(
          currentQuestion,
          grade.isCorrect,
          expectedText,
          [],
          "",
          resp,
        );
        return;
      }

      // Matching
      if (activity === "matching" && currentQuestion.type_payload?.type === "matching") {
        const resp: StructuredAnswerResponse = {
          kind: "matching",
          pairs: matchingPairs,
        };
        const grade = gradeQuestionResponse(currentQuestion, resp);
        const expectedText = currentQuestion.type_payload.pairs
          .map((p) => `${p.left_text} = ${p.right_text}`)
          .join(" · ");
        persistProgressAndAdvance(
          currentQuestion,
          grade.isCorrect,
          expectedText,
          [],
          "",
          resp,
        );
        return;
      }

      // Hotspot / Diagram Identify
      if (
        (activity === "hotspot" || activity === "diagram_identify") &&
        currentQuestion.type_payload?.type === "image_hotspot"
      ) {
        if (hotspotClicks.length === 0) return;
        const resp: StructuredAnswerResponse = {
          kind: "hotspot",
          clicks: hotspotClicks,
        };
        const grade = gradeQuestionResponse(currentQuestion, resp);
        const expectedText = currentQuestion.type_payload.target_hotspots
          .map((h) => h.label)
          .join(", ");
        persistProgressAndAdvance(
          currentQuestion,
          grade.isCorrect,
          expectedText,
          [],
          "",
          resp,
        );
      }
    },
    [
      blankAnswers,
      clearCardInputs,
      currentCard,
      currentQuestion,
      displayedOptions,
      feedback,
      forcedCorrectionDraft,
      hotspotClicks,
      learnState,
      locale,
      matchingPairs,
      numericalUnit,
      numericalValue,
      orderedIds,
      persistProgressAndAdvance,
      questionMap,
      saveLearnCheckpoint,
      selectedOptionIds,
      typedAnswer,
    ],
  );

  const shortcutsEnabled =
    preferences.mode_preferences?.shortcuts?.enabled !== false;

  // Keyboard shortcuts (strictly guarded against inputs, IME, dialogs & user shortcut toggle — V32-023)
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!currentCard || !currentQuestion) return;
      if (shouldIgnoreShortcutEvent(e, { shortcutsEnabled })) return;

      if (feedback && !feedback.isForcedCorrectionPrompt) {
        if (e.key === "Enter" && !isInteractiveControlTarget(e.target)) {
          e.preventDefault();
          handleContinueAfterFeedback();
        }
        return;
      }

      if (
        (currentCard.activity === "multiple_choice" ||
          currentCard.activity === "reading_mc" ||
          currentCard.activity === "listening_mc") &&
        displayedOptions.length > 0
      ) {
        const num = Number(e.key);
        if (!Number.isNaN(num) && num >= 1 && num <= displayedOptions.length) {
          e.preventDefault();
          const opt = displayedOptions[num - 1];
          if (isMultiSelectChoiceQuestion(currentQuestion)) {
            setSelectedOptionIds((prev) =>
              prev.includes(opt.id)
                ? prev.filter((id) => id !== opt.id)
                : [...prev, opt.id],
            );
          } else {
            handleSubmitCurrentActivity([opt.id]);
          }
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    currentCard,
    currentQuestion,
    displayedOptions,
    feedback,
    handleContinueAfterFeedback,
    handleSubmitCurrentActivity,
    shortcutsEnabled,
  ]);

  if (isLoading) {
    return (
      <FocusModeShell
        backHref={`/sets/${setId}`}
        studySetId={setId}
        activeMode="learn"
        title={t("study.learn")}
      >
        <StudyLoadingSkeleton />
      </FocusModeShell>
    );
  }

  if (isError || !bundle) {
    return (
      <FocusModeShell
        backHref={`/sets/${setId}`}
        studySetId={setId}
        activeMode="learn"
        title={t("study.learn")}
      >
        <StudyErrorState
          message={error instanceof Error ? error.message : undefined}
          onRetry={() => void refetch()}
          backHref={`/sets/${setId}`}
        />
      </FocusModeShell>
    );
  }

  const summary = learnState ? getAdaptiveLearnSummary(learnState) : null;
  const learnProgress = learnState
    ? computeAdaptiveLearnProgress(learnState)
    : null;
  const activeObjectiveMeta = getLearnObjectiveMeta(objective);
  const isCurrentMultiChoice = currentQuestion
    ? isMultiSelectChoiceQuestion(currentQuestion)
    : false;
  const isStarred = currentQuestion
    ? bundle.starredIds.has(currentQuestion.id)
    : false;
  const projectedFlashcard = currentQuestion
    ? projectQuestionToFlashcard(currentQuestion)
    : null;

  return (
    <FocusModeShell
      backHref={`/sets/${setId}`}
      studySetId={setId}
      activeMode="learn"
      title={bundle.studySet.title}
      subtitle={lText(locale, "Học thích ứng", "Adaptive Learn")}
      progressCurrent={learnProgress?.visitedCount ?? 0}
      progressTotal={learnProgress?.totalItems ?? 0}
      headerRight={
        <div className="flex items-center gap-1.5">
          {summary ? (
            <Badge variant="outline" className="hidden md:inline-flex tabular-nums">
              {lText(locale, `Vòng ${summary.roundNumber}`, `Round ${summary.roundNumber}`)} ·{" "}
              {lText(locale, "Thuộc", "Done")} {summary.graduatedCount}/{summary.totalItems}
            </Badge>
          ) : null}

          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11 sm:min-h-9"
              >
                <Settings2 className="size-4" aria-hidden="true" />
                <span className="hidden sm:inline">
                  {lText(locale, "Bộ lọc & Tùy chọn", "Filters & Options")}
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="learn-objective" className="text-xs font-semibold">
                  {lText(locale, "Mục tiêu học", "Learning Goal")}
                </Label>
                <Select
                  value={objective}
                  onValueChange={(v) => requestObjectiveChange(v as LearnObjective)}
                >
                  <SelectTrigger id="learn-objective" className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LEARN_OBJECTIVES.map((obj) => (
                      <SelectItem key={obj.id} value={obj.id}>
                        {lText(locale, obj.viLabel, obj.enLabel)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor="learn-batch" className="text-[11px]">
                    {lText(locale, "Số câu / vòng", "Batch size")}
                  </Label>
                  <Select
                    value={String(roundSize)}
                    onValueChange={(v) => setRoundSize(Number(v))}
                  >
                    <SelectTrigger id="learn-batch" className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[5, 7, 10, 15, 20].map((n) => (
                        <SelectItem key={n} value={String(n)}>
                          {n}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="learn-limit" className="text-[11px]">
                    {lText(locale, "Giới hạn phiên", "Session limit")}
                  </Label>
                  <Select value={maxItems} onValueChange={setMaxItems}>
                    <SelectTrigger id="learn-limit" className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">
                        {lText(locale, "Tất cả", "All")}
                      </SelectItem>
                      <SelectItem value="10">10</SelectItem>
                      <SelectItem value="20">20</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {bundle.chapters.length > 0 ? (
                <div className="space-y-1">
                  <Label htmlFor="learn-chapter" className="text-[11px]">
                    {lText(locale, "Chương", "Chapter")}
                  </Label>
                  <Select
                    value={selectedChapter}
                    onValueChange={setSelectedChapter}
                  >
                    <SelectTrigger id="learn-chapter" className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">
                        {lText(locale, "Tất cả chương", "All chapters")}
                      </SelectItem>
                      {bundle.chapters.map((ch) => (
                        <SelectItem key={ch} value={ch}>
                          {ch}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              {allTags.length > 0 ? (
                <div className="space-y-1">
                  <Label htmlFor="learn-tag" className="text-[11px]">
                    {lText(locale, "Thẻ (Tag)", "Tag")}
                  </Label>
                  <Select value={selectedTagId} onValueChange={setSelectedTagId}>
                    <SelectTrigger id="learn-tag" className="h-8 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">
                        {lText(locale, "Tất cả thẻ", "All tags")}
                      </SelectItem>
                      {allTags.map((tag) => (
                        <SelectItem key={tag.id} value={tag.id}>
                          #{tag.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ) : null}

              <div className="space-y-2 border-t border-border pt-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <Label htmlFor="lf-new" className="cursor-pointer">
                    {lText(locale, "Chỉ câu mới", "New items only")}
                  </Label>
                  <Switch id="lf-new" checked={onlyNew} onCheckedChange={setOnlyNew} />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="lf-wrong" className="cursor-pointer">
                    {lText(locale, "Chỉ câu đã sai", "Incorrect only")}
                  </Label>
                  <Switch
                    id="lf-wrong"
                    checked={onlyIncorrect}
                    onCheckedChange={setOnlyIncorrect}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="lf-due" className="cursor-pointer">
                    {lText(locale, "Chỉ câu đến hạn SM-2", "Due for SM-2")}
                  </Label>
                  <Switch id="lf-due" checked={onlyDue} onCheckedChange={setOnlyDue} />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="lf-lowconf" className="cursor-pointer">
                    {lText(locale, "Độ tự tin thấp / Nhầm lẫn", "Low confidence")}
                  </Label>
                  <Switch
                    id="lf-lowconf"
                    checked={onlyLowConfidence}
                    onCheckedChange={setOnlyLowConfidence}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="lf-star" className="cursor-pointer">
                    {lText(locale, "Chỉ câu gắn sao", "Starred only")}
                  </Label>
                  <Switch
                    id="lf-star"
                    checked={onlyStarred}
                    onCheckedChange={setOnlyStarred}
                  />
                </div>
              </div>

              <div className="space-y-2 border-t border-border pt-2.5 text-xs">
                <div className="flex items-center justify-between">
                  <Label htmlFor="lf-conf" className="cursor-pointer">
                    {lText(
                      locale,
                      "Hỏi mức độ tự tin trước đáp án",
                      "Ask confidence pre-reveal",
                    )}
                  </Label>
                  <Switch
                    id="lf-conf"
                    checked={confidenceEnabled}
                    onCheckedChange={setConfidenceEnabled}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="lf-force" className="cursor-pointer">
                    {lText(
                      locale,
                      "Bắt buộc gõ lại khi trả lời sai (tối đa 2 lần)",
                      "Forced correction on mistakes (max 2 retries)",
                    )}
                  </Label>
                  <Switch
                    id="lf-force"
                    checked={forcedCorrection}
                    onCheckedChange={setForcedCorrection}
                  />
                </div>
              </div>

              <div className="border-t border-border pt-2.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="w-full text-destructive"
                  onClick={() => setResetDialogOpen(true)}
                >
                  <RotateCcw className="size-3.5" aria-hidden="true" />
                  {lText(locale, "Đặt lại tiến độ học...", "Reset Learning Progress...")}
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      }
    >
      <div className="mx-auto w-full max-w-3xl space-y-4">
        {/* Compact Goal Selector Popover & Mastery Summary (V32-032 / UX31-11) */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2">
          <Popover open={goalPopoverOpen} onOpenChange={setGoalPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11 gap-1.5 text-xs font-medium sm:min-h-9"
              >
                <Target className="size-3.5 text-primary" aria-hidden="true" />
                <span>
                  {lText(locale, "Mục tiêu", "Goal")}:{" "}
                  <strong>
                    {lText(
                      locale,
                      activeObjectiveMeta.viLabel,
                      activeObjectiveMeta.enLabel,
                    )}
                  </strong>
                </span>
                <ChevronDown className="size-3.5 text-muted-foreground" aria-hidden="true" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80 space-y-1.5 p-2">
              <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {lText(locale, "Chọn mục tiêu phiên học", "Choose Session Goal")}
              </p>
              {LEARN_OBJECTIVES.map((obj) => {
                const isSelected = objective === obj.id;
                return (
                  <button
                    key={obj.id}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => requestObjectiveChange(obj.id)}
                    className={cn(
                      "flex min-h-11 w-full flex-col items-start rounded-lg border px-2.5 py-2 text-left transition-colors",
                      isSelected
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-transparent hover:bg-muted/60",
                    )}
                  >
                    <span className="text-xs font-semibold">
                      {lText(locale, obj.viLabel, obj.enLabel)}
                    </span>
                    <span className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                      {lText(locale, obj.viDesc, obj.enDesc)}
                    </span>
                  </button>
                );
              })}
            </PopoverContent>
          </Popover>

          <div className="flex items-center gap-2 text-xs text-muted-foreground tabular-nums">
            <span>
              {lText(locale, "Đã thành thạo", "Mastered")}:{" "}
              <strong className="text-foreground">
                {masterySummary.mastered}/{masterySummary.total}
              </strong>
            </span>
          </div>
        </div>

        {/* Resume Checkpoint Banner */}
        {pendingResume ? (
          <ResumeSessionBanner
            modeLabel={lText(locale, "Học thích ứng", "Adaptive Learn")}
            currentIndex={pendingResume.currentIndex}
            totalItems={pendingResume.totalItems}
            progressPercent={pendingResume.progressPercent}
            updatedAt={pendingResume.updatedAt}
            source={pendingResume.source}
            removedQuestionsCount={pendingResume.removedCount}
            onContinue={() => {
              setLearnState(pendingResume.restoredState);
              const first = getCurrentAdaptiveCard(pendingResume.restoredState);
              clearCardInputs(first ? questionMap.get(first.questionId) : null);
              setPendingResume(null);
            }}
            onRestart={() => {
              setPendingResume(null);
              if (authenticatedUserId) {
                clearLocalCheckpoint(authenticatedUserId, sessionKey);
              }
              void deleteCheckpoint({ sessionKey }).catch(() => {});
              setConfigNonce((n) => n + 1);
            }}
            onDiscard={() => {
              setPendingResume(null);
              if (authenticatedUserId) {
                clearLocalCheckpoint(authenticatedUserId, sessionKey);
              }
              void deleteCheckpoint({ sessionKey }).catch(() => {});
            }}
          />
        ) : null}

        {/* Empty filtered state */}
        {filteredSeeds.length === 0 ? (
          <StudyEmptyState
            setId={setId}
            onResetFilters={() => {
              setSelectedChapter("all");
              setSelectedTagId("all");
              setOnlyNew(false);
              setOnlyIncorrect(false);
              setOnlyDue(false);
              setOnlyLowConfidence(false);
              setOnlyStarred(false);
              setMaxItems("all");
            }}
          />
        ) : learnState?.sessionCompleted ? (
          <Card>
            <CardHeader className="text-center">
              <div className="mx-auto mb-2 flex size-14 items-center justify-center rounded-full bg-success-subtle text-success-subtle-foreground">
                <Brain className="size-7" aria-hidden="true" />
              </div>
              <CardTitle className="text-2xl">
                {lText(locale, "Hoàn thành phiên Học!", "Learn Session Complete!")}
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                {lText(
                  locale,
                  `Hoàn thành ${learnState.graduatedIds.length}/${learnState.totalItems} câu trong ${formatDuration(completedDurationSeconds)}.`,
                  `Completed ${learnState.graduatedIds.length}/${learnState.totalItems} items in ${formatDuration(completedDurationSeconds)}.`,
                )}
              </p>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-lg border border-border bg-success-subtle/60 p-3">
                  <p className="text-xs text-success-subtle-foreground">
                    {lText(locale, "Độ chính xác", "Accuracy")}
                  </p>
                  <p className="mt-1 text-xl font-bold tabular-nums">
                    {summary?.accuracyPercent ?? 0}%
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-secondary/50 p-3">
                  <p className="text-xs text-muted-foreground">
                    {lText(locale, "Tổng lượt trả lời", "Attempts")}
                  </p>
                  <p className="mt-1 text-xl font-bold tabular-nums">
                    {learnState.totalAttempts}
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-card p-3">
                  <p className="text-xs text-muted-foreground">
                    <Clock className="mx-auto mb-0.5 size-3.5" aria-hidden="true" />
                    {t("study.timeSpent")}
                  </p>
                  <p className="mt-1 font-mono text-xl font-bold tabular-nums">
                    {formatDuration(completedDurationSeconds)}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap justify-center gap-3">
                <Button
                  type="button"
                  onClick={() => setConfigNonce((n) => n + 1)}
                >
                  <RotateCcw className="size-4" aria-hidden="true" />
                  {lText(locale, "Học vòng mới", "Start Another Session")}
                </Button>
                <Button variant="outline" asChild>
                  <Link href={`/sets/${setId}`}>
                    {lText(locale, "Về học phần", "Back to Set")}
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : learnState?.roundCompleted && learnState.pendingQueue.length > 0 ? (
          <Card>
            <CardContent className="space-y-4 py-8 text-center">
              <Badge variant="success" className="mx-auto">
                {lText(
                  locale,
                  `Hoàn thành Vòng ${learnState.roundNumber}!`,
                  `Round ${learnState.roundNumber} Complete!`,
                )}
              </Badge>
              <p className="text-sm text-muted-foreground">
                {lText(
                  locale,
                  `Còn ${learnState.pendingQueue.length} câu hỏi trong hàng đợi tiếp theo.`,
                  `${learnState.pendingQueue.length} item(s) remaining in the next batch.`,
                )}
              </p>
              <Button
                type="button"
                size="lg"
                onClick={() => {
                  const advanced = advanceAdaptiveLearnRound(learnState);
                  setLearnState(advanced);
                  saveLearnCheckpoint(advanced);
                  const nextCard = getCurrentAdaptiveCard(advanced);
                  clearCardInputs(
                    nextCard ? questionMap.get(nextCard.questionId) : null,
                  );
                }}
              >
                <ArrowRight className="size-4" aria-hidden="true" />
                {lText(locale, "Tiếp tục sang vòng tiếp theo", "Continue to Next Round")}
              </Button>
            </CardContent>
          </Card>
        ) : currentCard && currentQuestion ? (
          <div
            key={`${currentQuestion.id}-st${currentCard.stage}-${learnState?.totalAttempts ?? 0}`}
          >
            <Card>
                <CardContent className="space-y-5 p-5 sm:p-6">
                  {/* Stage Badge & Question Context */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="default" className="gap-1">
                        <Layers className="size-3" aria-hidden="true" />
                        {lText(
                          locale,
                          LEARN_STAGE_LABELS[currentCard.stage].vi,
                          LEARN_STAGE_LABELS[currentCard.stage].en,
                        )}
                      </Badge>
                      {currentQuestion.chapter ? (
                        <Badge variant="outline">{currentQuestion.chapter}</Badge>
                      ) : null}
                      {currentCard.hadHighConfWrong ? (
                        <Badge variant="destructive" className="text-[11px]">
                          {lText(locale, "Ưu tiên sửa nhầm lẫn", "Misconception Focus")}
                        </Badge>
                      ) : null}
                    </div>

                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={lText(locale, "Gắn sao câu này", "Toggle star")}
                      aria-pressed={isStarred}
                      onClick={() => void toggleStar(currentQuestion.id)}
                    >
                      <Star
                        className={cn(
                          "size-4",
                          isStarred
                            ? "fill-warning text-warning"
                            : "text-muted-foreground",
                        )}
                        aria-hidden="true"
                      />
                    </Button>
                  </div>

                  {/* Reading Passage Context if present */}
                  {currentQuestion.type_payload?.type === "reading_passage" &&
                  (currentQuestion.passage?.content_text ||
                    currentQuestion.type_payload.passage_text) ? (
                    <div className="rounded-lg border border-border bg-secondary/30 p-3.5 text-sm">
                      {currentQuestion.passage?.title ||
                      currentQuestion.type_payload.passage_title ? (
                        <p className="mb-1.5 font-semibold text-foreground">
                          {currentQuestion.passage?.title ??
                            currentQuestion.type_payload.passage_title}
                        </p>
                      ) : null}
                      <SafeRichText
                        rich={
                          currentQuestion.passage?.content_rich ??
                          currentQuestion.type_payload.passage_rich
                        }
                        fallbackText={
                          currentQuestion.passage?.content_text ??
                          currentQuestion.type_payload.passage_text
                        }
                      />
                    </div>
                  ) : null}

                  {/* Listening Audio Player if present */}
                  {isSafeDisplayImageUrl(
                    currentQuestion.audio_url ??
                      (currentQuestion.type_payload?.type === "listening"
                        ? currentQuestion.type_payload.audio_url
                        : null),
                  ) ? (
                    <audio
                      controls
                      preload="metadata"
                      src={
                        (currentQuestion.audio_url ??
                          (currentQuestion.type_payload?.type === "listening"
                            ? currentQuestion.type_payload.audio_url
                            : "")) ||
                        ""
                      }
                      className="w-full"
                    />
                  ) : null}

                  {/* Prompt & Prompt Images */}
                  <div className="space-y-3">
                    <SafeRichText
                      rich={currentQuestion.prompt_rich}
                      fallbackText={currentQuestion.prompt}
                      className="text-base font-medium leading-relaxed sm:text-lg"
                    />
                    <ZoomableImage
                      src={currentQuestion.prompt_image_url}
                      alt={lText(locale, "Hình ảnh câu hỏi", "Question image")}
                    />
                  </div>

                  {/* Pre-Reveal Confidence Selector (Steps 2–4 only) */}
                  {currentCard.stage >= 2 && !currentCard.forcedCorrectionPending ? (
                    <ConfidenceSelector
                      enabled={confidenceEnabled}
                      disabled={Boolean(feedback)}
                      value={selectedConfidence}
                      onChange={setSelectedConfidence}
                      keyboardMode="letters"
                    />
                  ) : null}

                  {/* ACTIVITY RENDERER */}
                  {currentCard.forcedCorrectionPending ? (
                    <div className="space-y-3 rounded-xl border border-warning/60 bg-warning-subtle/40 p-4">
                      <p className="text-sm font-medium text-warning-subtle-foreground">
                        {feedback?.stageMessage}
                      </p>
                      <p className="rounded-md bg-background/80 px-3 py-2 text-sm font-semibold text-foreground">
                        {lText(locale, "Đáp án chuẩn: ", "Correct answer: ")}
                        {feedback?.expectedText}
                      </p>
                      <Input
                        value={forcedCorrectionDraft}
                        onChange={(e) => setForcedCorrectionDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (
                            e.key === "Enter" &&
                            !e.nativeEvent.isComposing &&
                            e.keyCode !== 229
                          ) {
                            e.preventDefault();
                            handleSubmitCurrentActivity();
                          }
                        }}
                        placeholder={lText(
                          locale,
                          "Gõ lại đáp án đúng tại đây...",
                          "Retype the correct answer here...",
                        )}
                      />
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (!learnState) return;
                            const skipped = recordAdaptiveLearnStep(
                              learnState,
                              currentQuestion,
                              { isCorrect: false, skipForcedCorrection: true },
                            );
                            setLearnState(skipped.nextState);
                            saveLearnCheckpoint(skipped.nextState);
                            const nc = getCurrentAdaptiveCard(skipped.nextState);
                            clearCardInputs(
                              nc ? questionMap.get(nc.questionId) : null,
                            );
                          }}
                        >
                          <SkipForward className="size-4" aria-hidden="true" />
                          {lText(locale, "Bỏ qua & học lại sau", "Skip for now")}
                        </Button>
                        <Button
                          type="button"
                          disabled={!forcedCorrectionDraft.trim()}
                          onClick={() => handleSubmitCurrentActivity()}
                        >
                          {lText(locale, "Xác nhận sửa lỗi", "Confirm Correction")}
                        </Button>
                      </div>
                    </div>
                  ) : currentCard.activity === "flashcard" && projectedFlashcard ? (
                    <div className="space-y-4 rounded-xl border border-primary/25 bg-accent/25 p-4">
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wide text-primary">
                          {lText(locale, "Đáp án / Kiến thức cần nhớ", "Key Answer")}
                        </p>
                        <SafeRichText
                          rich={projectedFlashcard.backRich}
                          fallbackText={projectedFlashcard.backText}
                          className="text-base font-medium text-foreground"
                        />
                        <ZoomableImage
                          src={projectedFlashcard.backImageUrl}
                          alt={lText(locale, "Hình ảnh đáp án", "Answer image")}
                        />
                        {projectedFlashcard.explanation ||
                        projectedFlashcard.explanationRich ? (
                          <div className="rounded-lg bg-background/80 p-3 text-xs text-muted-foreground">
                            <SafeRichText
                              rich={projectedFlashcard.explanationRich}
                              fallbackText={projectedFlashcard.explanation}
                            />
                          </div>
                        ) : null}
                      </div>
                      <Button
                        type="button"
                        className="min-h-11 w-full sm:w-auto"
                        onClick={() => handleSubmitCurrentActivity()}
                      >
                        <CheckCircle2 className="size-4" aria-hidden="true" />
                        {lText(
                          locale,
                          "Đã ghi nhớ sơ bộ — chuyển sang Bước 2",
                          "Got it — Advance to Stage 2",
                        )}
                      </Button>
                    </div>
                  ) : currentCard.activity === "multiple_choice" ||
                    currentCard.activity === "reading_mc" ||
                    currentCard.activity === "listening_mc" ? (
                    <div className="space-y-2.5">
                      <div
                        className={cn(
                          currentQuestion.question_type === "image_choice"
                            ? "grid grid-cols-1 gap-3 sm:grid-cols-2"
                            : "space-y-2.5",
                        )}
                      >
                        {displayedOptions.map((opt) => {
                          const isSelected = selectedOptionIds.includes(opt.id);
                          const revealed = Boolean(feedback);
                          const tone = revealed
                            ? opt.is_correct
                              ? "border-success bg-success-subtle/70"
                              : isSelected
                                ? "border-destructive bg-destructive-subtle/70"
                                : "border-border opacity-70"
                            : isSelected
                              ? "border-primary bg-primary/10 ring-1 ring-primary/30"
                              : "border-border bg-card hover:bg-muted/60";

                          return (
                            <button
                              key={opt.id}
                              type="button"
                              disabled={revealed}
                              aria-pressed={isSelected}
                              onClick={() => {
                                if (isCurrentMultiChoice) {
                                  setSelectedOptionIds((prev) =>
                                    prev.includes(opt.id)
                                      ? prev.filter((id) => id !== opt.id)
                                      : [...prev, opt.id],
                                  );
                                } else {
                                  setSelectedOptionIds([opt.id]);
                                  handleSubmitCurrentActivity([opt.id]);
                                }
                              }}
                              className={cn(
                                "flex min-h-12 w-full flex-col gap-2 rounded-xl border p-3.5 text-left transition-colors",
                                tone,
                              )}
                            >
                              <div className="flex w-full items-start gap-3">
                                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border border-border bg-muted text-xs font-bold">
                                  {opt.displayLabel}
                                </span>
                                <div className="flex-1 text-sm">
                                  {opt.content || opt.content_rich ? (
                                    <SafeRichText
                                      rich={opt.content_rich}
                                      fallbackText={opt.content}
                                    />
                                  ) : null}
                                </div>
                              </div>
                              {isSafeDisplayImageUrl(opt.image_url) ? (
                                <div className="flex min-h-24 w-full items-center justify-center">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img
                                    src={opt.image_url}
                                    alt={opt.image_alt ?? opt.content ?? opt.displayLabel}
                                    loading="lazy"
                                    decoding="async"
                                    className="max-h-40 rounded-md border border-border object-contain"
                                  />
                                </div>
                              ) : null}
                            </button>
                          );
                        })}
                      </div>

                      {isCurrentMultiChoice && !feedback ? (
                        <Button
                          type="button"
                          className="min-h-11 sm:min-h-9"
                          disabled={selectedOptionIds.length === 0}
                          onClick={() => handleSubmitCurrentActivity()}
                        >
                          {lText(locale, "Kiểm tra đáp án", "Check Answer")}
                        </Button>
                      ) : null}
                    </div>
                  ) : currentCard.activity === "numerical" &&
                    currentQuestion.type_payload?.type === "numerical" ? (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          type="text"
                          inputMode="decimal"
                          value={numericalValue}
                          readOnly={Boolean(feedback)}
                          onChange={(e) => setNumericalValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (
                              e.key === "Enter" &&
                              !e.nativeEvent.isComposing &&
                              e.keyCode !== 229 &&
                              !feedback
                            ) {
                              e.preventDefault();
                              handleSubmitCurrentActivity();
                            }
                          }}
                          placeholder={lText(locale, "Nhập giá trị số...", "Enter numeric value...")}
                          className="min-h-11 w-48 tabular-nums sm:min-h-9"
                        />
                        {currentQuestion.type_payload.unit_required ? (
                          <Input
                            value={numericalUnit}
                            readOnly={Boolean(feedback)}
                            onChange={(e) => setNumericalUnit(e.target.value)}
                            placeholder={lText(
                              locale,
                              "Nhập đơn vị...",
                              "Enter unit...",
                            )}
                            className="min-h-11 w-36 sm:min-h-9"
                          />
                        ) : currentQuestion.type_payload.unit ? (
                          <Badge variant="outline" className="min-h-9 px-3 text-xs">
                            {currentQuestion.type_payload.unit}
                          </Badge>
                        ) : null}
                      </div>
                      {!feedback ? (
                        <Button
                          type="button"
                          className="min-h-11 sm:min-h-9"
                          disabled={!numericalValue.trim()}
                          onClick={() => handleSubmitCurrentActivity()}
                        >
                          {lText(locale, "Kiểm tra kết quả số", "Check Numerical Answer")}
                        </Button>
                      ) : null}
                    </div>
                  ) : currentCard.activity === "fill_in_blank" &&
                    (currentQuestion.type_payload?.type === "fill_in_blank" ||
                      (currentQuestion.type_payload?.type === "listening" &&
                        currentQuestion.type_payload.sub_answer_kind ===
                          "fill_in_blank")) ? (
                    <div className="space-y-3">
                      {(currentQuestion.type_payload.type === "fill_in_blank"
                        ? currentQuestion.type_payload.blanks
                        : [
                            {
                              blank_id: "blank_1",
                              accepted_answers: getExpectedWriteAnswers(
                                currentQuestion,
                              ).map((a) => a.answer_text),
                              hint: null as string | null,
                            },
                          ]
                      ).map((blank, idx) => (
                        <div key={blank.blank_id} className="space-y-1">
                          <Label htmlFor={`learn-blank-${blank.blank_id}`} className="text-xs">
                            {lText(locale, `Ô trống #${idx + 1}`, `Blank #${idx + 1}`)}
                            {blank.hint ? ` (${blank.hint})` : ""}
                          </Label>
                          <Input
                            id={`learn-blank-${blank.blank_id}`}
                            readOnly={Boolean(feedback)}
                            value={blankAnswers[blank.blank_id] ?? ""}
                            onChange={(e) =>
                              setBlankAnswers((prev) => ({
                                ...prev,
                                [blank.blank_id]: e.target.value,
                              }))
                            }
                            className="min-h-11 sm:min-h-9"
                          />
                        </div>
                      ))}
                      {!feedback ? (
                        <Button
                          type="button"
                          className="min-h-11 sm:min-h-9"
                          onClick={() => handleSubmitCurrentActivity()}
                        >
                          {lText(locale, "Kiểm tra chỗ trống", "Check Blanks")}
                        </Button>
                      ) : null}
                    </div>
                  ) : currentCard.activity === "ordering" &&
                    currentQuestion.type_payload?.type === "ordering" ? (
                    <div className="space-y-2.5">
                      {orderedIds.map((itemId, idx) => {
                        const item =
                          currentQuestion.type_payload?.type === "ordering"
                            ? currentQuestion.type_payload.items.find(
                                (it) => it.id === itemId,
                              )
                            : null;
                        if (!item) return null;
                        return (
                          <div
                            key={itemId}
                            className="flex items-center justify-between gap-2 rounded-lg border border-border bg-card px-3 py-2.5"
                          >
                            <div className="flex items-center gap-2.5 text-sm">
                              <Badge variant="outline" className="tabular-nums">
                                {idx + 1}
                              </Badge>
                              <span>{item.text}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="size-11 sm:size-9"
                                disabled={Boolean(feedback) || idx === 0}
                                aria-label={lText(locale, "Di chuyển lên", "Move up")}
                                onClick={() => {
                                  setOrderedIds((prev) => {
                                    const copy = [...prev];
                                    [copy[idx - 1], copy[idx]] = [
                                      copy[idx],
                                      copy[idx - 1],
                                    ];
                                    return copy;
                                  });
                                }}
                              >
                                <ArrowUp className="size-4" aria-hidden="true" />
                              </Button>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="size-11 sm:size-9"
                                disabled={
                                  Boolean(feedback) || idx === orderedIds.length - 1
                                }
                                aria-label={lText(locale, "Di chuyển xuống", "Move down")}
                                onClick={() => {
                                  setOrderedIds((prev) => {
                                    const copy = [...prev];
                                    [copy[idx], copy[idx + 1]] = [
                                      copy[idx + 1],
                                      copy[idx],
                                    ];
                                    return copy;
                                  });
                                }}
                              >
                                <ArrowDown className="size-4" aria-hidden="true" />
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                      {!feedback ? (
                        <Button
                          type="button"
                          className="min-h-11 sm:min-h-9"
                          onClick={() => handleSubmitCurrentActivity()}
                        >
                          {lText(locale, "Kiểm tra thứ tự", "Check Order")}
                        </Button>
                      ) : null}
                    </div>
                  ) : currentCard.activity === "matching" &&
                    currentQuestion.type_payload?.type === "matching" ? (
                    (() => {
                      const rawRightChoices = [
                        ...currentQuestion.type_payload.pairs.map((p) => ({
                          id: p.right_id,
                          text: p.right_text,
                        })),
                        ...(currentQuestion.type_payload.distractors ?? []).map(
                          (d) => ({ id: d.right_id, text: d.right_text }),
                        ),
                      ];
                      // Deterministic shuffle so right column never exposes 1:1 row order (V32-021 FUNC-09)
                      const rightChoices = deterministicShuffleBySeed(
                        rawRightChoices,
                        `learn-match:${currentQuestion.id}`,
                      );
                      return (
                        <div className="space-y-3">
                          {currentQuestion.type_payload.pairs.map((pair) => (
                            <div
                              key={pair.id}
                              className="grid items-center gap-2 rounded-lg border border-border p-3 sm:grid-cols-2"
                            >
                              <span className="text-sm font-medium">
                                {pair.left_text}
                              </span>
                              <Select
                                disabled={Boolean(feedback)}
                                value={matchingPairs[pair.id] ?? ""}
                                onValueChange={(val) =>
                                  setMatchingPairs((prev) => ({
                                    ...prev,
                                    [pair.id]: val,
                                  }))
                                }
                              >
                                <SelectTrigger className="min-h-11 sm:min-h-9">
                                  <SelectValue
                                    placeholder={lText(
                                      locale,
                                      "Chọn đáp án ghép cặp...",
                                      "Choose matching item...",
                                    )}
                                  />
                                </SelectTrigger>
                                <SelectContent>
                                  {rightChoices.map((rc) => (
                                    <SelectItem key={rc.id} value={rc.id}>
                                      {rc.text}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          ))}
                          {!feedback ? (
                            <Button
                              type="button"
                              className="min-h-11 sm:min-h-9"
                              onClick={() => handleSubmitCurrentActivity()}
                            >
                              {lText(locale, "Kiểm tra ghép cặp", "Check Matches")}
                            </Button>
                          ) : null}
                        </div>
                      );
                    })()
                  ) : (currentCard.activity === "hotspot" ||
                      currentCard.activity === "diagram_identify") &&
                    currentQuestion.type_payload?.type === "image_hotspot" ? (
                    (() => {
                      const hp = currentQuestion.type_payload;
                      const requireAll = Boolean(hp.require_all_targets);
                      const maxClicks = requireAll
                        ? Math.max(1, hp.target_hotspots.length)
                        : 1;
                      const addPoint = (pt: NormalizedPoint) => {
                        if (feedback) return;
                        const clamped = {
                          x: Math.max(0, Math.min(1, pt.x)),
                          y: Math.max(0, Math.min(1, pt.y)),
                        };
                        if (!requireAll) {
                          setHotspotClicks([clamped]);
                          return;
                        }
                        setHotspotClicks((prev) => {
                          const next = [...prev, clamped];
                          return next.length > maxClicks
                            ? next.slice(next.length - maxClicks)
                            : next;
                        });
                      };
                      return (
                        <div className="space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                            <span>
                              {requireAll
                                ? lText(
                                    locale,
                                    `Nhấp chọn ${maxClicks} điểm mục tiêu trên ảnh (${hotspotClicks.length}/${maxClicks}):`,
                                    `Click ${maxClicks} target points on the image (${hotspotClicks.length}/${maxClicks}):`,
                                  )
                                : lText(
                                    locale,
                                    "Nhấp vào vị trí đúng trên hình ảnh (hoặc dùng phím mũi tên + Enter):",
                                    "Click or tap the target location on the image (or use arrow keys + Enter):",
                                  )}
                            </span>
                            {hotspotClicks.length > 0 && !feedback ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() => setHotspotClicks([])}
                              >
                                {lText(locale, "Xóa điểm", "Clear pins")}
                              </Button>
                            ) : null}
                          </div>
                          {isSafeDisplayImageUrl(hp.image_url) ? (
                            <div className="flex flex-col items-start gap-2">
                              {/* Tight inline-block wrapper matching exact img box (V32-036 FUNC-25) */}
                              <div
                                role="button"
                                tabIndex={feedback ? -1 : 0}
                                aria-label={lText(
                                  locale,
                                  "Vùng chọn điểm trên ảnh. Dùng phím mũi tên di chuyển tâm ngắm và Enter để đặt điểm.",
                                  "Image hotspot canvas. Use arrow keys to move crosshair and Enter to place pin.",
                                )}
                                onKeyDown={(e) => {
                                  if (feedback) return;
                                  const step = e.shiftKey ? 0.1 : 0.03;
                                  if (e.key === "ArrowLeft") {
                                    e.preventDefault();
                                    setKeyboardCursor((c) => ({
                                      ...c,
                                      x: Math.max(0, c.x - step),
                                    }));
                                  } else if (e.key === "ArrowRight") {
                                    e.preventDefault();
                                    setKeyboardCursor((c) => ({
                                      ...c,
                                      x: Math.min(1, c.x + step),
                                    }));
                                  } else if (e.key === "ArrowUp") {
                                    e.preventDefault();
                                    setKeyboardCursor((c) => ({
                                      ...c,
                                      y: Math.max(0, c.y - step),
                                    }));
                                  } else if (e.key === "ArrowDown") {
                                    e.preventDefault();
                                    setKeyboardCursor((c) => ({
                                      ...c,
                                      y: Math.min(1, c.y + step),
                                    }));
                                  } else if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    addPoint(keyboardCursor);
                                  }
                                }}
                                className="relative inline-block max-w-full overflow-hidden rounded-lg border border-border bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={hp.image_url}
                                  alt={lText(locale, "Hình ảnh điểm đánh dấu", "Hotspot image")}
                                  loading="lazy"
                                  decoding="async"
                                  className="block max-h-80 w-auto max-w-full cursor-crosshair select-none object-contain"
                                  onClick={(e) => {
                                    if (feedback) return;
                                    const rect = e.currentTarget.getBoundingClientRect();
                                    if (rect.width <= 0 || rect.height <= 0) return;
                                    const x = (e.clientX - rect.left) / rect.width;
                                    const y = (e.clientY - rect.top) / rect.height;
                                    setKeyboardCursor({ x, y });
                                    addPoint({ x, y });
                                  }}
                                />
                                {!feedback ? (
                                  <span
                                    aria-hidden="true"
                                    style={{
                                      left: `${keyboardCursor.x * 100}%`,
                                      top: `${keyboardCursor.y * 100}%`,
                                    }}
                                    className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 text-primary/70"
                                  >
                                    <Crosshair className="size-4" />
                                  </span>
                                ) : null}
                                {hotspotClicks.map((pt, i) => (
                                  <span
                                    key={i}
                                    style={{
                                      left: `${pt.x * 100}%`,
                                      top: `${pt.y * 100}%`,
                                    }}
                                    className="pointer-events-none absolute flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white bg-primary text-[10px] font-bold text-primary-foreground shadow"
                                  >
                                    {i + 1}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ) : null}
                          {!feedback ? (
                            <div>
                              <Button
                                type="button"
                                className="min-h-11 sm:min-h-9"
                                disabled={hotspotClicks.length === 0}
                                onClick={() => handleSubmitCurrentActivity()}
                              >
                                {lText(locale, "Kiểm tra vị trí", "Check Location")}
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      );
                    })()
                  ) : (
                    /* Default Recall Input (Write / Spell) */
                    <div className="space-y-3">
                      <Input
                        value={typedAnswer}
                        readOnly={Boolean(feedback)}
                        onChange={(e) => {
                          if (!feedback) setTypedAnswer(e.target.value);
                        }}
                        onKeyDown={(e) => {
                          if (
                            e.key === "Enter" &&
                            !e.nativeEvent.isComposing &&
                            e.keyCode !== 229 &&
                            !feedback
                          ) {
                            e.preventDefault();
                            handleSubmitCurrentActivity();
                          }
                        }}
                        placeholder={lText(
                          locale,
                          "Nhập câu trả lời của bạn...",
                          "Type your answer...",
                        )}
                        className="min-h-11"
                      />
                      {!feedback ? (
                        <Button
                          type="button"
                          disabled={!typedAnswer.trim()}
                          onClick={() => handleSubmitCurrentActivity()}
                        >
                          {lText(locale, "Kiểm tra đáp án", "Check Answer")}
                        </Button>
                      ) : null}
                    </div>
                  )}

                  {/* Feedback Banner (after standard check) */}
                  {feedback && !feedback.isForcedCorrectionPrompt ? (
                    <div
                      role="status"
                      className={cn(
                        "space-y-3 rounded-xl border p-4 text-sm",
                        feedback.isCorrect
                          ? "border-success/50 bg-success-subtle/60"
                          : "border-destructive/50 bg-destructive-subtle/60",
                      )}
                    >
                      <div className="flex items-center gap-2 font-semibold">
                        {feedback.isCorrect ? (
                          <>
                            <CheckCircle2
                              className="size-5 text-success"
                              aria-hidden="true"
                            />
                            <span className="text-success-subtle-foreground">
                              {lText(locale, "Chính xác!", "Correct!")}
                            </span>
                          </>
                        ) : (
                          <>
                            <XCircle
                              className="size-5 text-destructive"
                              aria-hidden="true"
                            />
                            <span className="text-destructive-subtle-foreground">
                              {lText(locale, "Chưa chính xác", "Incorrect")}
                            </span>
                          </>
                        )}
                      </div>

                      {!feedback.isCorrect && feedback.expectedText ? (
                        <p className="text-xs text-foreground">
                          <span className="font-semibold">
                            {lText(locale, "Đáp án đúng: ", "Correct answer: ")}
                          </span>
                          {feedback.expectedText}
                        </p>
                      ) : null}

                      {feedback.stageMessage ? (
                        <p className="text-xs font-medium text-foreground/90">
                          {feedback.stageMessage}
                        </p>
                      ) : null}

                      {feedback.explanation || feedback.explanationRich ? (
                        <div className="border-t border-border/50 pt-2 text-xs text-muted-foreground">
                          <span className="font-semibold text-foreground">
                            {t("study.explanation")}:{" "}
                          </span>
                          <SafeRichText
                            rich={feedback.explanationRich}
                            fallbackText={feedback.explanation}
                          />
                        </div>
                      ) : null}

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                        <QuestionNotesAndReportBar
                          studySetId={setId}
                          questionId={currentQuestion.id}
                          compact
                        />
                        <Button
                          type="button"
                          onClick={handleContinueAfterFeedback}
                          className="min-h-10"
                        >
                          {lText(locale, "Tiếp tục", "Continue")}
                          <ArrowRight className="size-4" aria-hidden="true" />
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
          </div>
        ) : null}
      </div>

      <AlertDialog
        open={Boolean(pendingObjectiveSwitch)}
        onOpenChange={(open) => {
          if (!open) setPendingObjectiveSwitch(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {lText(
                locale,
                "Đổi mục tiêu phiên học hiện tại?",
                "Switch current session goal?",
              )}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {lText(
                locale,
                "Đổi mục tiêu sẽ sắp xếp lại hàng đợi phiên hiện tại theo mục tiêu mới. Tiến độ SM-2 các câu bạn vừa làm vẫn được lưu an toàn.",
                "Switching goals will rebuild the current session queue for the new goal. SM-2 progress for answered cards stays safely saved.",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {lText(locale, "Giữ nguyên", "Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingObjectiveSwitch) {
                  setObjective(pendingObjectiveSwitch);
                  setPendingObjectiveSwitch(null);
                }
              }}
            >
              {lText(locale, "Đổi mục tiêu", "Switch Goal")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ResetProgressDialog
        open={resetDialogOpen}
        onOpenChange={setResetDialogOpen}
        defaultScope="study_set"
        studySetId={setId}
        studySetTitle={bundle.studySet.title}
        subject={bundle.studySet.subject ?? undefined}
        chapters={bundle.chapters}
        mode="learn"
        userId={authenticatedUserId ?? ""}
        onResetComplete={() => {
          void refetch();
          setConfigNonce((n) => n + 1);
        }}
      />
    </FocusModeShell>
  );
}

export const LearnSessionClient = LearnClient;
