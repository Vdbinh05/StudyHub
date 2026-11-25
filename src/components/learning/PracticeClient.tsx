"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Grid2X2,
  Play,
  RotateCcw,
  Settings2,
  Star,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { MediaGallery } from "@/components/media/MediaGallery";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { useI18n } from "@/lib/i18n";
import { useUserPreferences } from "@/lib/preferences";
import { invalidateLearningCaches } from "@/lib/query-keys";
import { shouldIgnoreShortcutEvent } from "@/lib/ui/shortcuts";
import {
  createStudySession,
  deleteCheckpoint,
  isInteractiveControlTarget,
  listCheckpoints,
  recordStudySessionAnswer,
  updateStudySession,
  upsertCheckpoint,
  upsertCheckpointKeepalive,
  upsertQuestionProgress,
} from "@/lib/learning/api-client";
import {
  getOptionDisplayItems,
  getQuestionExplanationDisplayItems,
  getQuestionPromptDisplayItems,
  hasRenderableText,
} from "@/lib/learning/media-helpers";
import {
  formatCorrectAnswerDisplay,
  isMultiSelectChoiceQuestion,
} from "@/lib/learning/answer-display";
import {
  clearLocalCheckpoint,
  loadLocalCheckpoint,
  makeCheckpointSessionKey,
  pickNewestCheckpoint,
  saveLocalCheckpoint,
} from "@/lib/learning/checkpoints";
import {
  ExamNavigatorGrid,
  type NavigatorQuestionItem,
} from "@/components/exam/ExamNavigatorGrid";
import {
  gradeChoiceSelection,
  shuffleOptions,
  shuffleQuestions,
  withOptionDisplayLabels,
  type DisplayedOption,
} from "@/lib/learning/shuffle";
import { applyConfidenceToSm2 } from "@/lib/learning/confidence";
import {
  getExpectedWriteAnswers,
  gradeWriteAnswer,
} from "@/lib/learning/write-grader";
import type {
  ConfidenceLevel,
  Question,
  QuestionOption,
  StructuredAnswerResponse,
} from "@/types/domain";
import { cn, formatDuration } from "@/lib/utils";
import { ConfidenceSelector } from "./ConfidenceSelector";
import { ContextualQuestionEditorModal } from "./ContextualQuestionEditorModal";
import { FocusModeShell } from "./FocusModeShell";
import { lText } from "./learning-copy";
import { QuestionNotesAndReportBar } from "./QuestionNotesAndReportBar";
import { ResumeSessionBanner } from "./ResumeSessionBanner";
import { SafeRichText } from "./SafeRichText";
import {
  StudyEmptyState,
  StudyErrorState,
  StudyLoadingSkeleton,
  useAuthenticatedUserId,
  useStudySetBundle,
} from "./useStudySetBundle";
import {
  gradeStructuredStudyQuestion,
  isStructuredV3Question,
  QuestionContextMedia,
  V3StructuredPracticeControls,
} from "./V3StructuredPracticeControls";

type PracticeFilterMode = "all" | "unanswered" | "wrong" | "starred";

interface PracticeItem {
  question: Question;
  displayedOptions: Array<DisplayedOption<QuestionOption>>;
}

interface PracticeAnswerState {
  selectedOptionIds: string[];
  typedAnswer: string;
  structuredResponse?: StructuredAnswerResponse | null;
  isSubmitted: boolean;
  isCorrect: boolean;
  confidence: ConfidenceLevel | null;
}

interface PracticeCheckpointData {
  questionOrderIds: string[];
  currentIndex: number;
  answeredResults: Record<string, PracticeAnswerState>;
  correctCount: number;
  totalCount: number;
  updatedAt: string | null;
  source: "local" | "remote";
  removedCount: number;
}

interface PracticeClientProps {
  setId: string;
}

function subscribePracticeDesktopLg(callback: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia("(min-width: 1024px)");
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

function getPracticeDesktopLgSnapshot(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(min-width: 1024px)").matches;
}

function getPracticeDesktopLgServerSnapshot(): boolean {
  return false;
}

export function PracticeClient({ setId }: PracticeClientProps) {
  const queryClient = useQueryClient();
  const { locale, t } = useI18n();
  const { preferences, playFeedbackSound } = useUserPreferences();
  const authUserId = useAuthenticatedUserId();
  const isDesktopLg = React.useSyncExternalStore(
    subscribePracticeDesktopLg,
    getPracticeDesktopLgSnapshot,
    getPracticeDesktopLgServerSnapshot,
  );
  const searchParams = useSearchParams();
  const {
    data: bundle,
    isLoading,
    isError,
    error,
    refetch,
    canEdit,
    toggleStar,
    updateLocalProgress,
    updateLocalQuestion,
  } = useStudySetBundle(setId);

  const initialFilterParam = searchParams.get("filter");
  const initialChapterParam = searchParams.get("chapter") ?? "all";
  const initialQuestionIdsParam = searchParams.get("questionIds");
  const wantsManualSetup = searchParams.get("setup") === "1";
  const wantsFreshStart = searchParams.get("fresh") === "1";

  const mcPrefs = preferences.mode_preferences?.mc;
  const shortcutsEnabled = preferences.mode_preferences?.shortcuts?.enabled ?? true;
  const showExplanationOnCorrect = mcPrefs?.show_explanation_on_correct ?? true;
  const autoAdvanceDelayMs =
    typeof mcPrefs?.auto_advance_ms === "number" && mcPrefs.auto_advance_ms > 0
      ? mcPrefs.auto_advance_ms
      : 700;

  // Config state (wired to `user_preferences` + `mode_preferences.mc` — FUNC-14!)
  const [phase, setPhase] = React.useState<"config" | "active" | "complete">(
    wantsManualSetup ? "config" : "active",
  );
  const [filterMode, setFilterMode] = React.useState<PracticeFilterMode>(() => {
    if (initialFilterParam === "mistakes" || initialFilterParam === "wrong") {
      return "wrong";
    }
    if (initialFilterParam === "starred") return "starred";
    if (initialFilterParam === "unanswered") return "unanswered";
    return "all";
  });
  const [selectedChapter, setSelectedChapter] =
    React.useState<string>(initialChapterParam);
  const [selectedTag, setSelectedTag] = React.useState<string>("all");
  const [countMode, setCountMode] = React.useState<"all" | "custom">("all");
  const [customCountInput, setCustomCountInput] = React.useState<string>("20");
  const [shuffleQOverride, setShuffleQOverride] = React.useState<boolean | null>(
    null,
  );
  const [shuffleAOverride, setShuffleAOverride] = React.useState<boolean | null>(
    null,
  );
  const [autoNextOverride, setAutoNextOverride] = React.useState<boolean | null>(
    null,
  );
  const [showExplanationOverride, setShowExplanationOverride] = React.useState<
    boolean | null
  >(null);
  const [confidenceOverride, setConfidenceOverride] = React.useState<
    boolean | null
  >(null);

  const shuffleQ = shuffleQOverride ?? preferences.default_shuffle_questions;
  const shuffleA =
    shuffleAOverride ??
    mcPrefs?.shuffle_options ??
    preferences.default_shuffle_options;
  const autoNext =
    autoNextOverride ??
    Boolean(mcPrefs?.auto_advance_ms && mcPrefs.auto_advance_ms > 0);
  const showExplanation =
    showExplanationOverride ??
    mcPrefs?.instant_feedback ??
    preferences.show_instant_feedback;
  const confidenceEnabled =
    confidenceOverride ?? Boolean(preferences.confidence_enabled);

  const setShuffleQ = React.useCallback((next: boolean) => {
    setShuffleQOverride(next);
  }, []);
  const setShuffleA = React.useCallback((next: boolean) => {
    setShuffleAOverride(next);
  }, []);
  const setAutoNext = React.useCallback((next: boolean) => {
    setAutoNextOverride(next);
  }, []);
  const setShowExplanation = React.useCallback((next: boolean) => {
    setShowExplanationOverride(next);
  }, []);

  const customCount = Math.max(1, Number(customCountInput.trim()) || 20);

  // Active session state
  const [items, setItems] = React.useState<PracticeItem[]>([]);
  const [currentIndex, setCurrentIndex] = React.useState(0);
  const [answers, setAnswers] = React.useState<
    Record<string, PracticeAnswerState>
  >({});
  const [completedDurationSeconds, setCompletedDurationSeconds] =
    React.useState(1);
  const [navSheetOpen, setNavSheetOpen] = React.useState(false);
  const [editingQuestionId, setEditingQuestionId] = React.useState<string | null>(
    null,
  );
  const [resumedBanner, setResumedBanner] = React.useState<{
    currentIndex: number;
    totalItems: number;
    progressPercent: number;
    updatedAt: string | null;
    source: "local" | "remote";
    removedCount: number;
  } | null>(null);
  const [dismissedRemoteResume, setDismissedRemoteResume] =
    React.useState(false);

  const sessionIdRef = React.useRef<string | null>(null);
  const sessionNonceRef = React.useRef<number>(0);
  const startedAtRef = React.useRef<number>(0);
  const questionStartRef = React.useRef<number>(0);
  const autoNextTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const checkpointSyncTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const autoLaunchedRef = React.useRef(false);
  const freshClearedRef = React.useRef(false);
  const savedOrderIdsRef = React.useRef<string[] | null>(null);
  const itemsRef = React.useRef<PracticeItem[]>([]);
  const answersRef = React.useRef<Record<string, PracticeAnswerState>>({});
  const currentIndexRef = React.useRef<number>(0);
  const phaseRef = React.useRef<"config" | "active" | "complete">(phase);
  const totalCountRef = React.useRef<number>(0);

  React.useEffect(() => {
    itemsRef.current = items;
    answersRef.current = answers;
    currentIndexRef.current = currentIndex;
    phaseRef.current = phase;
  }, [answers, currentIndex, items, phase]);

  const practiceSessionKey = React.useMemo(
    () =>
      makeCheckpointSessionKey(
        "practice",
        setId,
        `${filterMode}_${selectedChapter}_${selectedTag}`,
      ),
    [filterMode, selectedChapter, selectedTag, setId],
  );

  // Remote checkpoint query for cross-device Practice Resume (`RU-01`)
  const remoteCheckpointQuery = useQuery({
    queryKey: ["set-checkpoints", setId, "practice", practiceSessionKey],
    queryFn: () =>
      listCheckpoints({
        studySetId: setId,
        mode: "practice",
        sessionKey: practiceSessionKey,
      }),
    enabled: Boolean(setId) && !wantsFreshStart,
    staleTime: 15_000,
  });

  // Honor `?fresh=1` by clearing BOTH local and remote Practice checkpoints immediately (`FUNC-17`)
  React.useEffect(() => {
    if (!wantsFreshStart || freshClearedRef.current) return;
    freshClearedRef.current = true;
    if (authUserId) {
      clearLocalCheckpoint(authUserId, practiceSessionKey);
    }
    void deleteCheckpoint({ sessionKey: practiceSessionKey }).catch(() => {});
  }, [authUserId, practiceSessionKey, wantsFreshStart]);

  React.useEffect(() => {
    return () => {
      if (autoNextTimerRef.current) clearTimeout(autoNextTimerRef.current);
      if (checkpointSyncTimerRef.current) {
        clearTimeout(checkpointSyncTimerRef.current);
      }
    };
  }, []);

  const availableTags = React.useMemo(() => {
    if (!bundle) return [];
    const map = new Map<string, string>();
    for (const q of bundle.questions) {
      for (const tag of q.tags ?? []) {
        map.set(tag.id, tag.name);
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [bundle]);

  const filteredQuestions = React.useMemo(() => {
    if (!bundle) return [];
    let list = bundle.questions;

    if (initialQuestionIdsParam) {
      const idSet = new Set(
        initialQuestionIdsParam
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      );
      if (idSet.size > 0) {
        list = list.filter((q) => idSet.has(q.id));
      }
    }

    if (selectedChapter !== "all") {
      list = list.filter((q) => (q.chapter?.trim() || "") === selectedChapter);
    }

    if (selectedTag !== "all") {
      list = list.filter((q) =>
        (q.tags ?? []).some((tag) => tag.id === selectedTag),
      );
    }

    if (filterMode === "starred") {
      list = list.filter((q) => bundle.starredIds.has(q.id));
    } else if (filterMode === "unanswered") {
      list = list.filter((q) => {
        const p = bundle.progressMap.get(q.id);
        return !p || (p.correct_count === 0 && p.wrong_count === 0);
      });
    } else if (filterMode === "wrong") {
      list = list.filter((q) => {
        const p = bundle.progressMap.get(q.id);
        return Boolean(p && p.wrong_count > 0 && p.mastery_level !== "mastered");
      });
    }

    return list;
  }, [
    bundle,
    filterMode,
    initialQuestionIdsParam,
    selectedChapter,
    selectedTag,
  ]);

  const buildPracticeItem = React.useCallback(
    (q: Question): PracticeItem => {
      const opts = q.options ?? [];
      const displayedOptions = shuffleA
        ? shuffleOptions(opts)
        : withOptionDisplayLabels(opts);
      return { question: q, displayedOptions };
    },
    [shuffleA],
  );

  // Build durable checkpoint payload from current refs/args (`RU-01` & `FUNC-17`)
  const buildCheckpointPayload = React.useCallback(
    (
      nextItems: PracticeItem[],
      nextAnswers: Record<string, PracticeAnswerState>,
      nextIndex: number,
    ) => {
      const orderIds =
        savedOrderIdsRef.current && savedOrderIdsRef.current.length > nextItems.length
          ? savedOrderIdsRef.current
          : nextItems.map((it) => it.question.id);
      const totalCount = Math.max(
        orderIds.length,
        totalCountRef.current,
        nextItems.length,
      );
      const submittedEntries = Object.entries(nextAnswers).filter(
        ([, a]) => a.isSubmitted,
      );
      const answeredCount = submittedEntries.length;
      const correctCount = submittedEntries.filter(([, a]) => a.isCorrect).length;
      const progressPercent =
        totalCount > 0 ? Math.min(100, Math.round((answeredCount / totalCount) * 100)) : 0;

      // Persist compact answeredResults map (preserving exact V1/V3 responses)
      const answeredResults: Record<string, PracticeAnswerState> = {};
      for (const [qId, st] of submittedEntries) {
        answeredResults[qId] = st;
      }

      return {
        study_set_id: setId,
        mode: "practice" as const,
        session_key: practiceSessionKey,
        current_index: Math.max(0, nextIndex),
        total_items: totalCount,
        progress_percent: progressPercent,
        state_json: {
          questionOrderIds: orderIds,
          currentIndex: Math.max(0, nextIndex),
          answeredResults,
          correctCount,
          totalCount,
          filterMode,
          selectedChapter,
          selectedTag,
        },
      };
    },
    [filterMode, practiceSessionKey, selectedChapter, selectedTag, setId],
  );

  const persistPracticeCheckpoint = React.useCallback(
    (
      nextItems: PracticeItem[],
      nextAnswers: Record<string, PracticeAnswerState>,
      nextIndex: number,
      immediateRemote = false,
    ) => {
      if (nextItems.length === 0) return;
      const submittedCount = Object.values(nextAnswers).filter(
        (a) => a.isSubmitted,
      ).length;
      if (submittedCount === 0 && nextIndex === 0) return;

      const payload = buildCheckpointPayload(nextItems, nextAnswers, nextIndex);

      if (authUserId) {
        saveLocalCheckpoint({
          version: 1,
          userId: authUserId,
          studySetId: setId,
          mode: "practice",
          sessionKey: practiceSessionKey,
          currentIndex: payload.current_index,
          totalItems: payload.total_items,
          progressPercent: payload.progress_percent,
          stateJson: payload.state_json,
          committedEventKeys: [],
          updatedAt: new Date().toISOString(),
        });
      }

      if (immediateRemote) {
        if (checkpointSyncTimerRef.current) {
          clearTimeout(checkpointSyncTimerRef.current);
          checkpointSyncTimerRef.current = null;
        }
        upsertCheckpointKeepalive(payload);
        return;
      }

      if (checkpointSyncTimerRef.current) {
        clearTimeout(checkpointSyncTimerRef.current);
      }
      checkpointSyncTimerRef.current = setTimeout(() => {
        checkpointSyncTimerRef.current = null;
        void upsertCheckpoint(payload).catch(() => {});
      }, 600);
    },
    [authUserId, buildCheckpointPayload, practiceSessionKey, setId],
  );

  const clearPracticeCheckpoints = React.useCallback(() => {
    savedOrderIdsRef.current = null;
    setResumedBanner(null);
    setDismissedRemoteResume(true);
    if (checkpointSyncTimerRef.current) {
      clearTimeout(checkpointSyncTimerRef.current);
      checkpointSyncTimerRef.current = null;
    }
    if (authUserId) {
      clearLocalCheckpoint(authUserId, practiceSessionKey);
    }
    void deleteCheckpoint({ sessionKey: practiceSessionKey }).catch(() => {});
  }, [authUserId, practiceSessionKey]);

  const parseCheckpointCandidate = React.useCallback(
    (
      source: "local" | "remote",
      currentIdx: number,
      totalItems: number,
      stateJson: Record<string, unknown>,
      updatedAt: string | null,
    ): PracticeCheckpointData | null => {
      const rawAnswers =
        stateJson.answeredResults && typeof stateJson.answeredResults === "object"
          ? (stateJson.answeredResults as Record<string, PracticeAnswerState>)
          : {};
      const answeredCount = Object.values(rawAnswers).filter(
        (a) => Boolean(a?.isSubmitted),
      ).length;
      if (answeredCount === 0 && currentIdx <= 0) return null;

      const orderIds = Array.isArray(stateJson.questionOrderIds)
        ? stateJson.questionOrderIds.filter((id): id is string => typeof id === "string")
        : [];
      const correctCount =
        typeof stateJson.correctCount === "number"
          ? stateJson.correctCount
          : Object.values(rawAnswers).filter((a) => a?.isSubmitted && a?.isCorrect)
              .length;
      const totalCount =
        typeof stateJson.totalCount === "number" && stateJson.totalCount > 0
          ? stateJson.totalCount
          : Math.max(totalItems, orderIds.length);

      return {
        questionOrderIds: orderIds,
        currentIndex: Math.max(0, currentIdx),
        answeredResults: rawAnswers,
        correctCount,
        totalCount,
        updatedAt,
        source,
        removedCount: 0,
      };
    },
    [],
  );

  const applyResumedPracticeSession = React.useCallback(
    (cp: PracticeCheckpointData, sourceQuestions: Question[]) => {
      if (autoNextTimerRef.current) clearTimeout(autoNextTimerRef.current);
      const qMap = new Map(sourceQuestions.map((q) => [q.id, q]));

      const orderedQuestions: Question[] = [];
      const seen = new Set<string>();
      for (const id of cp.questionOrderIds) {
        const q = qMap.get(id);
        if (q && !seen.has(q.id)) {
          seen.add(q.id);
          orderedQuestions.push(q);
        }
      }
      for (const q of sourceQuestions) {
        if (!seen.has(q.id)) {
          seen.add(q.id);
          orderedQuestions.push(q);
        }
      }

      if (orderedQuestions.length === 0) return;

      savedOrderIdsRef.current =
        cp.questionOrderIds.length > 0 ? [...cp.questionOrderIds] : null;
      const built = orderedQuestions.map(buildPracticeItem);
      const safeIndex = Math.max(0, Math.min(cp.currentIndex, built.length - 1));
      const answeredCount = Object.values(cp.answeredResults).filter(
        (a) => a.isSubmitted,
      ).length;
      const effectiveTotal = Math.max(cp.totalCount, built.length);
      totalCountRef.current = effectiveTotal;

      setItems(built);
      setAnswers(cp.answeredResults);
      setCurrentIndex(safeIndex);
      setPhase("active");
      setDismissedRemoteResume(true);
      setResumedBanner({
        currentIndex: safeIndex,
        totalItems: effectiveTotal,
        progressPercent:
          effectiveTotal > 0
            ? Math.min(100, Math.round((answeredCount / effectiveTotal) * 100))
            : 0,
        updatedAt: cp.updatedAt,
        source: cp.source,
        removedCount: cp.removedCount,
      });

      startedAtRef.current = Date.now();
      questionStartRef.current = Date.now();
      const myNonce = ++sessionNonceRef.current;
      sessionIdRef.current = null;

      void createStudySession({
        study_set_id: setId,
        mode: "practice",
        config: { filterMode, chapter: selectedChapter, resumed: true },
        total_items: effectiveTotal,
      })
        .then((session) => {
          if (myNonce === sessionNonceRef.current) {
            sessionIdRef.current = session.id;
          }
        })
        .catch(() => {});
    },
    [buildPracticeItem, filterMode, selectedChapter, setId],
  );

  const startPracticeSession = React.useCallback(
    async (
      sourceQuestions: Question[],
      options?: { clearSavedCheckpoint?: boolean },
    ) => {
      if (sourceQuestions.length === 0) return;
      if (autoNextTimerRef.current) {
        clearTimeout(autoNextTimerRef.current);
        autoNextTimerRef.current = null;
      }

      if (options?.clearSavedCheckpoint) {
        clearPracticeCheckpoints();
      }

      const ordered = shuffleQ
        ? shuffleQuestions(sourceQuestions)
        : [...sourceQuestions];
      const limited =
        countMode === "custom"
          ? ordered.slice(0, Math.max(1, customCount))
          : ordered;

      const built: PracticeItem[] = limited.map(buildPracticeItem);
      totalCountRef.current =
        countMode === "all" &&
        filterMode === "all" &&
        selectedChapter === "all" &&
        selectedTag === "all" &&
        !initialQuestionIdsParam &&
        bundle
          ? Math.max(built.length, bundle.totalQuestions)
          : built.length;

      savedOrderIdsRef.current = null;
      setResumedBanner(null);
      setDismissedRemoteResume(true);
      setItems(built);
      setCurrentIndex(0);
      setAnswers({});
      setPhase("active");
      startedAtRef.current = Date.now();
      questionStartRef.current = Date.now();

      // Nonce guard so a slow earlier session creation NEVER overwrites a newer restart (`FUNC-28(2)`)
      const myNonce = ++sessionNonceRef.current;
      sessionIdRef.current = null;

      try {
        const session = await createStudySession({
          study_set_id: setId,
          mode: "practice",
          config: {
            filterMode,
            chapter: selectedChapter,
            shuffleQ,
            shuffleA,
            autoNext,
          },
          total_items: totalCountRef.current,
        });
        if (myNonce === sessionNonceRef.current) {
          sessionIdRef.current = session.id;
        }
      } catch {
        // Allow practicing smoothly even if session endpoint is offline
      }
    },
    [
      autoNext,
      buildPracticeItem,
      bundle,
      clearPracticeCheckpoints,
      countMode,
      customCount,
      filterMode,
      initialQuestionIdsParam,
      selectedChapter,
      selectedTag,
      setId,
      shuffleA,
      shuffleQ,
    ],
  );

  // Direct-Start Practice via microtask (zero `setTimeout(0)` macrotask lag & StrictMode-safe — `PERF-02`, `RU-01`):
  // Restores local Practice checkpoint if present (unless `?fresh=1`), otherwise starts Q1 from Page 1 immediately!
  React.useEffect(() => {
    if (!bundle || autoLaunchedRef.current || wantsManualSetup) {
      return;
    }
    if (filteredQuestions.length === 0) {
      return;
    }

    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled || autoLaunchedRef.current) return;
      autoLaunchedRef.current = true;

      if (!wantsFreshStart) {
        const localCp = authUserId
          ? loadLocalCheckpoint(authUserId, practiceSessionKey)
          : null;
        const remoteCp = remoteCheckpointQuery.data?.[0] ?? null;
        const newest = pickNewestCheckpoint(remoteCp, localCp);
        if (newest.source !== "none") {
          const parsed = parseCheckpointCandidate(
            newest.source,
            newest.currentIndex,
            newest.totalItems,
            newest.stateJson,
            newest.updatedAt,
          );
          if (parsed) {
            applyResumedPracticeSession(parsed, filteredQuestions);
            return;
          }
        }
      }

      void startPracticeSession(filteredQuestions);
    });

    return () => {
      cancelled = true;
    };
  }, [
    applyResumedPracticeSession,
    authUserId,
    bundle,
    filteredQuestions,
    parseCheckpointCandidate,
    practiceSessionKey,
    remoteCheckpointQuery.data,
    startPracticeSession,
    wantsFreshStart,
    wantsManualSetup,
  ]);

  // Purely derive remote resume banner if a remote checkpoint arrives before the user answers Q1 (zero effect setState)
  const pendingRemoteResume = React.useMemo<PracticeCheckpointData | null>(() => {
    if (
      wantsFreshStart ||
      wantsManualSetup ||
      !bundle ||
      phase !== "active" ||
      resumedBanner ||
      dismissedRemoteResume
    ) {
      return null;
    }
    const answeredSoFar = Object.values(answers).filter(
      (a) => a.isSubmitted,
    ).length;
    if (answeredSoFar > 0) return null;

    const remoteCp = remoteCheckpointQuery.data?.[0];
    if (!remoteCp) return null;
    return parseCheckpointCandidate(
      "remote",
      remoteCp.current_index,
      remoteCp.total_items,
      remoteCp.state_json ?? {},
      remoteCp.updated_at,
    );
  }, [
    answers,
    bundle,
    dismissedRemoteResume,
    parseCheckpointCandidate,
    phase,
    remoteCheckpointQuery.data,
    resumedBanner,
    wantsFreshStart,
    wantsManualSetup,
  ]);

  // Progressive streaming append: merge Pages 2..N into `items` cleanly without resetting Q1 or shifting answers (`V32-015`)
  React.useEffect(() => {
    if (phase !== "active" || itemsRef.current.length === 0 || filteredQuestions.length === 0) {
      return;
    }
    if (countMode === "custom" && itemsRef.current.length >= customCount) {
      return;
    }
    const existingIds = new Set(itemsRef.current.map((it) => it.question.id));
    const newlyArrived = filteredQuestions.filter((q) => !existingIds.has(q.id));
    if (newlyArrived.length === 0) return;

    const savedOrder = savedOrderIdsRef.current;
    let orderedNew: Question[];
    if (savedOrder && savedOrder.length > 0) {
      const rank = new Map(savedOrder.map((id, i) => [id, i]));
      orderedNew = [...newlyArrived].sort((a, b) => {
        const ra = rank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
        const rb = rank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
        return ra - rb;
      });
    } else {
      orderedNew = shuffleQ ? shuffleQuestions(newlyArrived) : newlyArrived;
    }

    const budget =
      countMode === "custom"
        ? Math.max(0, customCount - itemsRef.current.length)
        : orderedNew.length;
    const toAppend = orderedNew.slice(0, budget).map(buildPracticeItem);
    if (toAppend.length === 0) return;

    setItems((prev) => {
      const prevIds = new Set(prev.map((it) => it.question.id));
      const deduped = toAppend.filter((it) => !prevIds.has(it.question.id));
      if (deduped.length === 0) return prev;
      const merged = [...prev, ...deduped];
      totalCountRef.current = Math.max(totalCountRef.current, merged.length);
      return merged;
    });
  }, [buildPracticeItem, countMode, customCount, filteredQuestions, phase, shuffleQ]);

  // Persist Practice checkpoint synchronously on `pagehide`, `visibilitychange`, and SPA unmount (`RU-01`)
  React.useEffect(() => {
    const flushCheckpointNow = () => {
      if (phaseRef.current !== "active") return;
      persistPracticeCheckpoint(
        itemsRef.current,
        answersRef.current,
        currentIndexRef.current,
        true,
      );
    };
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        flushCheckpointNow();
      }
    };

    window.addEventListener("pagehide", flushCheckpointNow);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("pagehide", flushCheckpointNow);
      document.removeEventListener("visibilitychange", handleVisibility);
      flushCheckpointNow();
    };
  }, [persistPracticeCheckpoint]);

  const currentItem = items[currentIndex] ?? null;
  const isCurrentMultiChoice = currentItem
    ? isMultiSelectChoiceQuestion(currentItem.question)
    : false;
  const isCurrentImageChoice =
    currentItem?.question.question_type === "image_choice";
  const isCurrentStructuredV3 = currentItem
    ? isStructuredV3Question(currentItem.question)
    : false;
  const currentAnswer = React.useMemo<PracticeAnswerState>(() => {
    if (!currentItem) {
      return {
        selectedOptionIds: [],
        typedAnswer: "",
        isSubmitted: false,
        isCorrect: false,
        confidence: null,
      };
    }
    return (
      answers[currentItem.question.id] ?? {
        selectedOptionIds: [],
        typedAnswer: "",
        isSubmitted: false,
        isCorrect: false,
        confidence: null,
      }
    );
  }, [answers, currentItem]);

  const finishPractice = React.useCallback(
    (latestAnswers: Record<string, PracticeAnswerState>) => {
      if (autoNextTimerRef.current) {
        clearTimeout(autoNextTimerRef.current);
        autoNextTimerRef.current = null;
      }
      const durationSeconds = Math.max(
        1,
        Math.round((Date.now() - startedAtRef.current) / 1000),
      );
      setCompletedDurationSeconds(durationSeconds);
      setPhase("complete");
      clearPracticeCheckpoints();
      const submittedList = Object.values(latestAnswers).filter(
        (a) => a.isSubmitted,
      );
      const correctCount = submittedList.filter((a) => a.isCorrect).length;

      if (sessionIdRef.current) {
        updateStudySession(sessionIdRef.current, {
          status: "completed",
          completed_items: submittedList.length,
          correct_items: correctCount,
          duration_seconds: durationSeconds,
        })
          .then(() => void invalidateLearningCaches(queryClient, setId))
          .catch(() => {});
      } else {
        void invalidateLearningCaches(queryClient, setId);
      }
    },
    [clearPracticeCheckpoints, queryClient, setId],
  );

  const persistAnswer = React.useCallback(
    (
      question: Question,
      selectedOptionIds: string[],
      typedAnswer: string | null,
      isCorrect: boolean,
      confidence: ConfidenceLevel | null,
      structuredResponse?: StructuredAnswerResponse | null,
    ) => {
      if (!bundle) return;
      const responseTimeMs = Math.max(0, Date.now() - questionStartRef.current);
      const prevProgress = bundle.progressMap.get(question.id);
      const sm2Outcome = applyConfidenceToSm2({
        previous: prevProgress ?? undefined,
        isCorrect,
        confidence,
      });
      const nextSm2 = sm2Outcome.next;

      if (sessionIdRef.current) {
        recordStudySessionAnswer(sessionIdRef.current, {
          question_id: question.id,
          selected_option_ids: selectedOptionIds,
          typed_answer: typedAnswer,
          structured_response: structuredResponse ?? null,
          confidence,
          is_correct: isCorrect,
          response_time_ms: responseTimeMs,
          update_progress: true,
        })
          .then((res) => {
            if (res.progress) updateLocalProgress(res.progress);
          })
          .catch(() => {
            upsertQuestionProgress({
              study_set_id: setId,
              question_id: question.id,
              is_correct: isCorrect,
              confidence,
              mastery_level: nextSm2.mastery_level,
              ease_factor: nextSm2.ease_factor,
              interval_days: nextSm2.interval_days,
              repetitions: nextSm2.repetitions,
              next_review_at: nextSm2.next_review_at,
            })
              .then(updateLocalProgress)
              .catch(() => {});
          });
      } else {
        upsertQuestionProgress({
          study_set_id: setId,
          question_id: question.id,
          is_correct: isCorrect,
          confidence,
          mastery_level: nextSm2.mastery_level,
          ease_factor: nextSm2.ease_factor,
          interval_days: nextSm2.interval_days,
          repetitions: nextSm2.repetitions,
          next_review_at: nextSm2.next_review_at,
        })
          .then(updateLocalProgress)
          .catch(() => {});
      }
    },
    [bundle, setId, updateLocalProgress],
  );

  const submitCurrentChoice = React.useCallback(
    (selectedIds: string[]) => {
      if (!currentItem || currentAnswer.isSubmitted) return;
      if (selectedIds.length === 0) return;

      const correctIds = (currentItem.question.options ?? [])
        .filter((o) => o.is_correct)
        .map((o) => o.id);

      // Strictly grade by stable option UUID!
      const isCorrect = gradeChoiceSelection(selectedIds, correctIds);
      const submittedConfidence = confidenceEnabled
        ? (currentAnswer.confidence ?? null)
        : null;

      const nextState: PracticeAnswerState = {
        selectedOptionIds: selectedIds,
        typedAnswer: "",
        structuredResponse: {
          kind: "options",
          selected_option_ids: selectedIds,
        },
        isSubmitted: true,
        isCorrect,
        confidence: submittedConfidence,
      };
      const nextAnswers = {
        ...answers,
        [currentItem.question.id]: nextState,
      };
      setAnswers(nextAnswers);
      setDismissedRemoteResume(true);
      playFeedbackSound(isCorrect ? "correct" : "wrong");
      persistAnswer(
        currentItem.question,
        selectedIds,
        null,
        isCorrect,
        submittedConfidence,
        nextState.structuredResponse,
      );
      persistPracticeCheckpoint(items, nextAnswers, currentIndex);

      if (autoNext && isCorrect) {
        if (autoNextTimerRef.current) clearTimeout(autoNextTimerRef.current);
        autoNextTimerRef.current = setTimeout(() => {
          if (currentIndex + 1 < items.length) {
            const nextIdx = currentIndex + 1;
            setCurrentIndex(nextIdx);
            persistPracticeCheckpoint(items, nextAnswers, nextIdx);
            questionStartRef.current = Date.now();
          } else {
            finishPractice(nextAnswers);
          }
        }, autoAdvanceDelayMs);
      }
    },
    [
      answers,
      autoAdvanceDelayMs,
      autoNext,
      confidenceEnabled,
      currentAnswer.confidence,
      currentAnswer.isSubmitted,
      currentIndex,
      currentItem,
      finishPractice,
      items,
      persistAnswer,
      persistPracticeCheckpoint,
      playFeedbackSound,
    ],
  );

  const handleOptionClick = React.useCallback(
    (optionId: string) => {
      if (!currentItem || currentAnswer.isSubmitted) return;
      const isMulti = isMultiSelectChoiceQuestion(currentItem.question);

      if (isMulti) {
        const exists = currentAnswer.selectedOptionIds.includes(optionId);
        const nextSelected = exists
          ? currentAnswer.selectedOptionIds.filter((id) => id !== optionId)
          : [...currentAnswer.selectedOptionIds, optionId];
        setAnswers((prev) => ({
          ...prev,
          [currentItem.question.id]: {
            ...currentAnswer,
            selectedOptionIds: nextSelected,
          },
        }));
      } else {
        submitCurrentChoice([optionId]);
      }
    },
    [currentAnswer, currentItem, submitCurrentChoice],
  );

  const handleSubmitTyped = React.useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!currentItem || currentAnswer.isSubmitted) return;
      const typed = currentAnswer.typedAnswer.trim();
      if (!typed) return;

      const expected = getExpectedWriteAnswers(currentItem.question);
      const graded = gradeWriteAnswer(typed, expected, { strict: false });
      const submittedConfidence = confidenceEnabled
        ? (currentAnswer.confidence ?? null)
        : null;

      const nextState: PracticeAnswerState = {
        selectedOptionIds: [],
        typedAnswer: typed,
        structuredResponse: { kind: "text", value: typed },
        isSubmitted: true,
        isCorrect: graded.isCorrect,
        confidence: submittedConfidence,
      };
      const nextAnswers = {
        ...answers,
        [currentItem.question.id]: nextState,
      };
      setAnswers(nextAnswers);
      setDismissedRemoteResume(true);
      playFeedbackSound(graded.isCorrect ? "correct" : "wrong");
      persistAnswer(
        currentItem.question,
        [],
        typed,
        graded.isCorrect,
        submittedConfidence,
        nextState.structuredResponse,
      );
      persistPracticeCheckpoint(items, nextAnswers, currentIndex);
    },
    [
      answers,
      confidenceEnabled,
      currentAnswer,
      currentIndex,
      currentItem,
      items,
      persistAnswer,
      persistPracticeCheckpoint,
      playFeedbackSound,
    ],
  );

  const handleSubmitStructured = React.useCallback(
    (response: StructuredAnswerResponse) => {
      if (!currentItem || currentAnswer.isSubmitted) return;
      const isCorrect = gradeStructuredStudyQuestion(
        currentItem.question,
        response,
      );
      const submittedConfidence = confidenceEnabled
        ? (currentAnswer.confidence ?? null)
        : null;

      const nextState: PracticeAnswerState = {
        selectedOptionIds: [],
        typedAnswer: "",
        structuredResponse: response,
        isSubmitted: true,
        isCorrect,
        confidence: submittedConfidence,
      };
      const nextAnswers = {
        ...answers,
        [currentItem.question.id]: nextState,
      };
      setAnswers(nextAnswers);
      setDismissedRemoteResume(true);
      playFeedbackSound(isCorrect ? "correct" : "wrong");
      persistAnswer(
        currentItem.question,
        [],
        null,
        isCorrect,
        submittedConfidence,
        response,
      );
      persistPracticeCheckpoint(items, nextAnswers, currentIndex);
    },
    [
      answers,
      confidenceEnabled,
      currentAnswer.confidence,
      currentAnswer.isSubmitted,
      currentIndex,
      currentItem,
      items,
      persistAnswer,
      persistPracticeCheckpoint,
      playFeedbackSound,
    ],
  );

  const handleGoNext = React.useCallback(() => {
    if (autoNextTimerRef.current) {
      clearTimeout(autoNextTimerRef.current);
      autoNextTimerRef.current = null;
    }
    if (currentIndex + 1 < items.length) {
      const nextIdx = currentIndex + 1;
      setCurrentIndex(nextIdx);
      persistPracticeCheckpoint(items, answers, nextIdx);
      questionStartRef.current = Date.now();
    } else {
      finishPractice(answers);
    }
  }, [answers, currentIndex, finishPractice, items, persistPracticeCheckpoint]);

  const handleGoPrev = React.useCallback(() => {
    if (autoNextTimerRef.current) {
      clearTimeout(autoNextTimerRef.current);
      autoNextTimerRef.current = null;
    }
    if (currentIndex > 0) {
      const nextIdx = currentIndex - 1;
      setCurrentIndex(nextIdx);
      persistPracticeCheckpoint(items, answers, nextIdx);
      questionStartRef.current = Date.now();
    }
  }, [answers, currentIndex, items, persistPracticeCheckpoint]);

  // Keyboard shortcuts during active practice (guarded by shared modal/IME/shortcutsEnabled helper — V32-023)
  React.useEffect(() => {
    if (phase !== "active" || !currentItem || navSheetOpen || editingQuestionId) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (shouldIgnoreShortcutEvent(event, { shortcutsEnabled })) return;

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        handleGoPrev();
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        handleGoNext();
        return;
      }
      if (event.key === "s" || event.key === "S") {
        event.preventDefault();
        void toggleStar(currentItem.question.id).catch(() =>
          toast.error(t("common.errorGeneric")),
        );
        return;
      }
      if (event.key === "Enter" && !isInteractiveControlTarget(event.target)) {
        event.preventDefault();
        if (currentAnswer.isSubmitted) {
          handleGoNext();
        } else if (
          isCurrentMultiChoice &&
          currentAnswer.selectedOptionIds.length > 0
        ) {
          submitCurrentChoice(currentAnswer.selectedOptionIds);
        }
        return;
      }

      // 1-6 or A-F selects option by displayed position
      if (
        !currentAnswer.isSubmitted &&
        !isCurrentStructuredV3 &&
        currentItem.displayedOptions.length > 0
      ) {
        let idx = -1;
        if (/^[1-6]$/.test(event.key)) {
          idx = Number(event.key) - 1;
        } else if (/^[a-fA-F]$/.test(event.key)) {
          idx = event.key.toUpperCase().charCodeAt(0) - 65;
        }
        if (idx >= 0 && idx < currentItem.displayedOptions.length) {
          event.preventDefault();
          handleOptionClick(currentItem.displayedOptions[idx].id);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    currentAnswer.isSubmitted,
    currentAnswer.selectedOptionIds,
    currentItem,
    handleGoNext,
    handleGoPrev,
    handleOptionClick,
    isCurrentMultiChoice,
    isCurrentStructuredV3,
    navSheetOpen,
    editingQuestionId,
    phase,
    shortcutsEnabled,
    submitCurrentChoice,
    t,
    toggleStar,
  ]);

  const handleContextualQuestionSaved = React.useCallback(
    (savedQuestion: Question) => {
      updateLocalQuestion(savedQuestion);
      setItems((prev) =>
        prev.map((item) => {
          if (item.question.id !== savedQuestion.id) return item;
          const updatedOpts = savedQuestion.options ?? [];
          const existingOrder = new Map(
            item.displayedOptions.map((o, idx) => [o.id, idx]),
          );
          const orderedOpts = [...updatedOpts].sort((a, b) => {
            const ra = existingOrder.get(a.id);
            const rb = existingOrder.get(b.id);
            if (ra !== undefined && rb !== undefined) return ra - rb;
            if (ra !== undefined) return -1;
            if (rb !== undefined) return 1;
            return a.position - b.position;
          });
          return {
            question: savedQuestion,
            displayedOptions: withOptionDisplayLabels(orderedOpts),
          };
        }),
      );
    },
    [updateLocalQuestion],
  );

  const practiceNavItems = React.useMemo<NavigatorQuestionItem[]>(() => {
    return items.map((item, idx) => {
      const ans = answers[item.question.id];
      return {
        attemptQuestionId: item.question.id,
        position: idx,
        isAnswered: Boolean(ans?.isSubmitted),
        isFlagged: false,
        practiceResult: ans?.isSubmitted
          ? ans.isCorrect
            ? "correct"
            : "incorrect"
          : null,
      };
    });
  }, [answers, items]);

  const handleSelectNavIndex = React.useCallback(
    (idx: number) => {
      // Cancel pending autoNext timer when jumping manually via navigator (SH-025 / BUG-020)!
      if (autoNextTimerRef.current) {
        clearTimeout(autoNextTimerRef.current);
        autoNextTimerRef.current = null;
      }
      setCurrentIndex(idx);
      persistPracticeCheckpoint(itemsRef.current, answersRef.current, idx);
      questionStartRef.current = Date.now();
      setNavSheetOpen(false);
    },
    [persistPracticeCheckpoint],
  );

  if (isLoading) {
    return (
      <FocusModeShell
        backHref={`/sets/${setId}`}
        title={lText(locale, "Luyện tập trắc nghiệm", "Multiple Choice Practice")}
      >
        <StudyLoadingSkeleton />
      </FocusModeShell>
    );
  }

  if (isError || !bundle) {
    return (
      <FocusModeShell
        backHref={`/sets/${setId}`}
        title={lText(locale, "Luyện tập trắc nghiệm", "Multiple Choice Practice")}
      >
        <StudyErrorState
          message={error instanceof Error ? error.message : undefined}
          onRetry={() => void refetch()}
          backHref={`/sets/${setId}`}
        />
      </FocusModeShell>
    );
  }

  const answeredCount = Object.values(answers).filter((a) => a.isSubmitted).length;
  const correctCount = Object.values(answers).filter(
    (a) => a.isSubmitted && a.isCorrect,
  ).length;
  const wrongItems = items.filter((item) => {
    const a = answers[item.question.id];
    return a?.isSubmitted && !a.isCorrect;
  });

  const renderNavigatorGrid = () => (
    <ExamNavigatorGrid
      mode="practice"
      items={practiceNavItems}
      currentIndex={currentIndex}
      answeredCount={answeredCount}
      flaggedCount={0}
      onSelectIndex={handleSelectNavIndex}
    />
  );

  const displayedTotal =
    countMode === "all" &&
    filterMode === "all" &&
    selectedChapter === "all" &&
    selectedTag === "all" &&
    !initialQuestionIdsParam
      ? Math.max(items.length, bundle.totalQuestions)
      : items.length;

  return (
    <FocusModeShell
      backHref={`/sets/${setId}`}
      studySetId={setId}
      activeMode="practice"
      onBeforeBack={() => {
        if (phase === "active") {
          persistPracticeCheckpoint(
            itemsRef.current,
            answersRef.current,
            currentIndexRef.current,
            true,
          );
        }
      }}
      title={bundle.studySet.title}
      subtitle={lText(locale, "Luyện tập trắc nghiệm", "Multiple Choice Practice")}
      progressCurrent={phase === "active" ? answeredCount : undefined}
      progressTotal={phase === "active" ? displayedTotal : undefined}
      headerRight={
        phase === "active" ? (
          <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="size-11 shrink-0 p-0 text-xs sm:h-9 sm:w-auto sm:min-h-9 sm:gap-1 sm:px-2.5 sm:text-sm"
              aria-label={lText(locale, "Tùy chỉnh phiên luyện tập", "Customize practice")}
              onClick={() => {
                // Cancel pending auto-advance when entering settings (`FUNC-28(2)`)
                if (autoNextTimerRef.current) {
                  clearTimeout(autoNextTimerRef.current);
                  autoNextTimerRef.current = null;
                }
                setPhase("config");
              }}
            >
              <Settings2 className="size-4 shrink-0" aria-hidden="true" />
              <span className="hidden sm:inline">
                {lText(locale, "Tùy chỉnh", "Customize")}
              </span>
            </Button>
            <Sheet open={navSheetOpen} onOpenChange={setNavSheetOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="size-11 shrink-0 p-0 sm:h-9 sm:w-auto sm:min-h-9 sm:px-2.5 lg:hidden"
                  aria-label={lText(locale, "Danh sách câu hỏi", "Question navigator")}
                >
                  <Grid2X2 className="size-4 shrink-0" aria-hidden="true" />
                  <span className="hidden sm:inline">
                    {lText(locale, "Câu hỏi", "Questions")}
                  </span>
                </Button>
              </SheetTrigger>
              <SheetContent side="right" className="w-80 overflow-y-auto">
                <SheetHeader>
                  <SheetTitle>{t("exam.questionNavigator")}</SheetTitle>
                </SheetHeader>
                <div className="px-4 pb-6">
                  {navSheetOpen ? renderNavigatorGrid() : null}
                </div>
              </SheetContent>
            </Sheet>
            <Button
              variant="outline"
              size="sm"
              className="min-h-11 shrink-0 whitespace-nowrap px-2.5 text-xs sm:min-h-9 sm:px-3 sm:text-sm"
              onClick={() => finishPractice(answers)}
            >
              <span className="min-[380px]:hidden">
                {lText(locale, "Xong", "Done")}
              </span>
              <span className="hidden min-[380px]:inline">
                {t("common.finish")}
              </span>
            </Button>
          </div>
        ) : phase === "config" && items.length > 0 ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11 shrink-0 whitespace-nowrap px-2.5 text-xs sm:min-h-9 sm:px-3 sm:text-sm"
            onClick={() => setPhase("active")}
          >
            {lText(locale, "Quay lại bài làm", "Resume Session")}
          </Button>
        ) : null
      }
    >
      {phase === "active" && items.length === 0 && filteredQuestions.length > 0 ? (
        <StudyLoadingSkeleton />
      ) : phase === "config" ||
        (phase === "active" &&
          items.length === 0 &&
          filteredQuestions.length === 0) ? (
        <div className="mx-auto w-full max-w-2xl space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Settings2 className="size-5 text-primary" aria-hidden="true" />
                {lText(
                  locale,
                  "Thiết lập phiên luyện tập",
                  "Configure Practice Session",
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {/* Filter Scope */}
              <div className="space-y-2">
                <Label>{lText(locale, "Phạm vi câu hỏi", "Question Scope")}</Label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {(
                    [
                      ["all", lText(locale, "Tất cả", "All")],
                      ["unanswered", lText(locale, "Chưa làm", "Unanswered")],
                      ["wrong", lText(locale, "Đã sai", "Mistakes")],
                      ["starred", lText(locale, "Đánh dấu sao", "Starred")],
                    ] as const
                  ).map(([val, label]) => (
                    <Button
                      key={val}
                      variant={filterMode === val ? "default" : "outline"}
                      size="sm"
                      className="min-h-10"
                      aria-pressed={filterMode === val}
                      onClick={() => setFilterMode(val)}
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Chapter & Tag filters */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="practice-chapter">
                    {lText(locale, "Chương / Chủ đề", "Chapter / Topic")}
                  </Label>
                  <Select
                    value={selectedChapter}
                    onValueChange={setSelectedChapter}
                  >
                    <SelectTrigger id="practice-chapter">
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

                <div className="space-y-2">
                  <Label htmlFor="practice-tag">
                    {lText(locale, "Thẻ (Tag)", "Tag")}
                  </Label>
                  <Select value={selectedTag} onValueChange={setSelectedTag}>
                    <SelectTrigger id="practice-tag">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">
                        {lText(locale, "Tất cả thẻ", "All tags")}
                      </SelectItem>
                      {availableTags.map((tag) => (
                        <SelectItem key={tag.id} value={tag.id}>
                          {tag.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Count */}
              <div className="space-y-2">
                <Label>{lText(locale, "Số câu hỏi", "Number of Questions")}</Label>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant={countMode === "all" ? "default" : "outline"}
                    size="sm"
                    className="min-h-10"
                    onClick={() => setCountMode("all")}
                  >
                    {lText(
                      locale,
                      `Tất cả (${filteredQuestions.length})`,
                      `All (${filteredQuestions.length})`,
                    )}
                  </Button>
                  <Button
                    variant={countMode === "custom" ? "default" : "outline"}
                    size="sm"
                    className="min-h-10"
                    onClick={() => setCountMode("custom")}
                  >
                    {lText(locale, "Tùy chỉnh", "Custom")}
                  </Button>
                  {countMode === "custom" ? (
                    <Input
                      type="text"
                      inputMode="numeric"
                      value={customCountInput}
                      onChange={(e) => setCustomCountInput(e.target.value)}
                      onBlur={() => {
                        const clamped = Math.min(
                          Math.max(1, filteredQuestions.length),
                          Math.max(1, Number(customCountInput.trim()) || 20),
                        );
                        setCustomCountInput(String(clamped));
                      }}
                      aria-label={lText(locale, "Số câu tùy chỉnh", "Custom count")}
                      className="h-10 w-28 tabular-nums"
                    />
                  ) : null}
                </div>
              </div>

              {/* Behavior switches */}
              <div className="grid gap-3 rounded-lg border border-border bg-secondary/30 p-4 sm:grid-cols-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="pr-shuffle-q" className="cursor-pointer">
                    {t("study.shuffleQuestions")}
                  </Label>
                  <Switch
                    id="pr-shuffle-q"
                    checked={shuffleQ}
                    onCheckedChange={setShuffleQ}
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="pr-shuffle-a" className="cursor-pointer">
                    {t("study.shuffleOptions")}
                  </Label>
                  <Switch
                    id="pr-shuffle-a"
                    checked={shuffleA}
                    onCheckedChange={setShuffleA}
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="pr-auto-next" className="cursor-pointer">
                    {lText(locale, "Tự động chuyển khi đúng", "Auto-next when correct")}
                  </Label>
                  <Switch
                    id="pr-auto-next"
                    checked={autoNext}
                    onCheckedChange={setAutoNext}
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="pr-show-exp" className="cursor-pointer">
                    {t("study.showExplanation")}
                  </Label>
                  <Switch
                    id="pr-show-exp"
                    checked={showExplanation}
                    onCheckedChange={setShowExplanation}
                  />
                </div>
                <div className="flex items-center justify-between gap-2 sm:col-span-2">
                  <Label htmlFor="pr-confidence" className="cursor-pointer">
                    {lText(
                      locale,
                      "Ghi nhận mức độ tự tin trước khi trả lời",
                      "Track confidence before answering",
                    )}
                  </Label>
                  <Switch
                    id="pr-confidence"
                    checked={confidenceEnabled}
                    onCheckedChange={(checked) => setConfidenceOverride(checked)}
                  />
                </div>
              </div>

              {filteredQuestions.length === 0 ? (
                <div className="rounded-lg border border-warning/40 bg-warning-subtle p-3 text-sm text-warning-subtle-foreground">
                  {lText(
                    locale,
                    "Không có câu hỏi nào khớp bộ lọc hiện tại. Hãy thay đổi bộ lọc.",
                    "No questions match the current filters. Try adjusting your selection.",
                  )}
                </div>
              ) : null}

              <Button
                size="lg"
                className="min-h-11 w-full"
                disabled={filteredQuestions.length === 0}
                onClick={() =>
                  void startPracticeSession(filteredQuestions, {
                    clearSavedCheckpoint: true,
                  })
                }
              >
                <Play className="size-4" aria-hidden="true" />
                {lText(
                  locale,
                  `Bắt đầu luyện tập (${
                    countMode === "custom"
                      ? Math.min(customCount, filteredQuestions.length)
                      : filteredQuestions.length
                  } câu)`,
                  `Start Practice (${
                    countMode === "custom"
                      ? Math.min(customCount, filteredQuestions.length)
                      : filteredQuestions.length
                  } questions)`,
                )}
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : phase === "complete" ? (
        <div className="mx-auto w-full max-w-3xl space-y-6">
          <Card>
            <CardContent className="space-y-6 py-8">
              <div className="text-center space-y-1">
                <h2 className="text-2xl font-bold">{t("study.sessionComplete")}</h2>
                <p className="text-sm text-muted-foreground">
                  {lText(
                    locale,
                    "Toàn bộ tiến độ và thống kê đã được lưu vào tài khoản của bạn.",
                    "All progress and statistics have been saved to your account.",
                  )}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-lg border border-border bg-card p-4 text-center">
                  <p className="text-xs text-muted-foreground">{t("study.accuracy")}</p>
                  <p className="mt-1 text-2xl font-bold text-primary tabular-nums">
                    {answeredCount > 0
                      ? Math.round((correctCount / answeredCount) * 100)
                      : 0}
                    %
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-success-subtle/60 p-4 text-center">
                  <p className="text-xs text-success-subtle-foreground">
                    {t("study.correct")}
                  </p>
                  <p className="mt-1 text-2xl font-bold tabular-nums">
                    {correctCount}
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-destructive-subtle/60 p-4 text-center">
                  <p className="text-xs text-destructive-subtle-foreground">
                    {t("study.incorrect")}
                  </p>
                  <p className="mt-1 text-2xl font-bold tabular-nums">
                    {wrongItems.length}
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-card p-4 text-center">
                  <p className="text-xs text-muted-foreground">{t("study.timeSpent")}</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums">
                    {formatDuration(completedDurationSeconds)}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap justify-center gap-2">
                {wrongItems.length > 0 ? (
                  <Button
                    onClick={() =>
                      void startPracticeSession(wrongItems.map((w) => w.question))
                    }
                  >
                    <RotateCcw className="size-4" aria-hidden="true" />
                    {t("study.reviewMistakes")} ({wrongItems.length})
                  </Button>
                ) : null}
                <Button variant="outline" onClick={() => setPhase("config")}>
                  {t("study.studyAgain")}
                </Button>
                <Button variant="secondary" asChild>
                  <Link href={`/sets/${setId}/test`}>
                    <ClipboardList className="size-4" aria-hidden="true" />
                    {lText(locale, "Chuyển sang Thi thử", "Switch to Mock Exam")}
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>

          {wrongItems.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {lText(
                    locale,
                    `Danh sách câu chưa đúng (${wrongItems.length})`,
                    `Incorrect Questions (${wrongItems.length})`,
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {wrongItems.map((item, idx) => {
                  const ans = answers[item.question.id];
                  const selectedOpts = item.displayedOptions.filter((o) =>
                    ans?.selectedOptionIds.includes(o.id),
                  );
                  return (
                    <div
                      key={item.question.id}
                      className="cv-auto rounded-lg border border-border p-4 space-y-2"
                    >
                      <div className="flex items-start gap-1.5 text-sm font-medium">
                        <span className="shrink-0 tabular-nums">{idx + 1}.</span>
                        <div className="min-w-0 flex-1">
                          <SafeRichText
                            rich={item.question.prompt_rich}
                            fallbackText={item.question.prompt}
                          />
                        </div>
                      </div>
                      <div className="flex flex-col gap-1 text-xs">
                        <p className="flex items-start gap-1.5 text-destructive-subtle-foreground">
                          <XCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                          <span>
                            <strong>{t("study.yourAnswer")}:</strong>{" "}
                            {selectedOpts.length > 0
                              ? selectedOpts
                                  .map(
                                    (o) =>
                                      o.content.trim() ||
                                      lText(
                                        locale,
                                        `Phương án ${o.displayLabel}`,
                                        `Option ${o.displayLabel}`,
                                      ),
                                  )
                                  .join(", ")
                              : ans?.typedAnswer || "—"}
                          </span>
                        </p>
                        <p className="flex items-start gap-1.5 text-success-subtle-foreground">
                          <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                          <span>
                            <strong>{t("study.correctAnswer")}:</strong>{" "}
                            {formatCorrectAnswerDisplay(item.question, locale) || "—"}
                          </span>
                        </p>
                      </div>
                      {(() => {
                        const wrongExpMedia = getQuestionExplanationDisplayItems(
                          item.question,
                          lText(locale, "Hình ảnh giải thích", "Explanation image"),
                        );
                        if (
                          !item.question.explanation &&
                          !item.question.explanation_rich &&
                          wrongExpMedia.length === 0
                        ) {
                          return null;
                        }
                        return (
                          <div className="space-y-2 rounded-md bg-secondary/60 p-2.5 text-xs text-muted-foreground">
                            {item.question.explanation ||
                            item.question.explanation_rich ? (
                              <div>
                                <strong className="text-foreground">
                                  {t("study.explanation")}:{" "}
                                </strong>
                                <SafeRichText
                                  rich={item.question.explanation_rich}
                                  fallbackText={item.question.explanation}
                                  inline
                                />
                              </div>
                            ) : (
                              <strong className="block text-foreground">
                                {t("study.explanation")}:
                              </strong>
                            )}
                            {wrongExpMedia.length > 0 ? (
                              <MediaGallery
                                items={wrongExpMedia}
                                variant="compact"
                              />
                            ) : null}
                          </div>
                        );
                      })()}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ) : null}
        </div>
      ) : !currentItem ? (
        <StudyEmptyState setId={setId} />
      ) : (
        <div className="space-y-4">
          {resumedBanner ? (
            <ResumeSessionBanner
              modeLabel={lText(locale, "Luyện tập trắc nghiệm", "Practice")}
              currentIndex={resumedBanner.currentIndex}
              totalItems={resumedBanner.totalItems}
              progressPercent={resumedBanner.progressPercent}
              updatedAt={resumedBanner.updatedAt}
              source={resumedBanner.source}
              removedQuestionsCount={resumedBanner.removedCount}
              onContinue={() => setResumedBanner(null)}
              onRestart={() =>
                void startPracticeSession(filteredQuestions, {
                  clearSavedCheckpoint: true,
                })
              }
              onDiscard={() =>
                void startPracticeSession(filteredQuestions, {
                  clearSavedCheckpoint: true,
                })
              }
            />
          ) : pendingRemoteResume ? (
            <ResumeSessionBanner
              modeLabel={lText(locale, "Luyện tập trắc nghiệm", "Practice")}
              currentIndex={pendingRemoteResume.currentIndex}
              totalItems={pendingRemoteResume.totalCount}
              progressPercent={
                pendingRemoteResume.totalCount > 0
                  ? Math.round(
                      (Object.values(pendingRemoteResume.answeredResults).filter(
                        (a) => a.isSubmitted,
                      ).length /
                        pendingRemoteResume.totalCount) *
                        100,
                    )
                  : 0
              }
              updatedAt={pendingRemoteResume.updatedAt}
              source="remote"
              onContinue={() =>
                applyResumedPracticeSession(
                  pendingRemoteResume,
                  filteredQuestions,
                )
              }
              onRestart={() =>
                void startPracticeSession(filteredQuestions, {
                  clearSavedCheckpoint: true,
                })
              }
              onDiscard={() => clearPracticeCheckpoints()}
            />
          ) : null}

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
          {/* Active Question Card (instant 0ms switch — no AnimatePresence mode="wait" delay!) */}
          <div className="mx-auto w-full max-w-3xl space-y-4">
            <div key={currentItem.question.id}>
              <Card>
                  <CardContent className="space-y-5 py-6">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="tabular-nums">
                          {lText(locale, "Câu", "Question")} {currentIndex + 1} /{" "}
                          {displayedTotal}
                        </Badge>
                        {currentItem.question.chapter ? (
                          <Badge variant="secondary">
                            {currentItem.question.chapter}
                          </Badge>
                        ) : null}
                        {isCurrentMultiChoice ? (
                          <Badge variant="accent">
                            {lText(locale, "Chọn nhiều đáp án", "Multiple answers")}
                          </Badge>
                        ) : null}
                        {currentItem.question.question_type === "image_choice" ? (
                          <Badge variant="outline">
                            {lText(locale, "Chọn đáp án hình ảnh", "Image Choice")}
                          </Badge>
                        ) : null}
                      </div>

                      <Button
                        variant="ghost"
                        size="icon"
                        className="min-h-11 min-w-11 sm:min-h-10 sm:min-w-10 shrink-0"
                        aria-pressed={bundle.starredIds.has(currentItem.question.id)}
                        aria-label={
                          bundle.starredIds.has(currentItem.question.id)
                            ? t("study.unstarQuestion")
                            : t("study.starQuestion")
                        }
                        onClick={() =>
                          void toggleStar(currentItem.question.id).catch(() =>
                            toast.error(t("common.errorGeneric")),
                          )
                        }
                      >
                        <Star
                          className={cn(
                            "size-4",
                            bundle.starredIds.has(currentItem.question.id)
                              ? "fill-warning text-warning"
                              : "text-muted-foreground",
                          )}
                          aria-hidden="true"
                        />
                      </Button>
                    </div>

                    <div className="space-y-3">
                      {/* Reading Passage & Listening Audio context (fixes FUNC-08!) */}
                      <QuestionContextMedia question={currentItem.question} />

                      <h2 className="text-lg font-medium leading-relaxed text-foreground">
                        <SafeRichText
                          rich={currentItem.question.prompt_rich}
                          fallbackText={currentItem.question.prompt}
                        />
                      </h2>
                      {currentItem.question.question_type !== "image_hotspot" ? (
                        <MediaGallery
                          items={getQuestionPromptDisplayItems(
                            currentItem.question,
                            lText(
                              locale,
                              "Hình ảnh câu hỏi",
                              "Question illustration",
                            ),
                          )}
                        />
                      ) : null}
                    </div>

                    {/* Pre-answer Confidence Selector (synced with /settings confidence_enabled) */}
                    <ConfidenceSelector
                      enabled={confidenceEnabled}
                      disabled={currentAnswer.isSubmitted}
                      value={currentAnswer.confidence ?? null}
                      onChange={(nextConfidence) =>
                        setAnswers((prev) => ({
                          ...prev,
                          [currentItem.question.id]: {
                            ...(prev[currentItem.question.id] ?? {
                              selectedOptionIds: [],
                              typedAnswer: "",
                              isSubmitted: false,
                              isCorrect: false,
                              confidence: null,
                            }),
                            confidence: nextConfidence,
                          },
                        }))
                      }
                      keyboardMode={
                        currentItem.displayedOptions.length > 0
                          ? "none"
                          : "letters"
                      }
                    />

                    {/* V3 Structured controls vs Choice options vs Typed fallback (`FUNC-08`) */}
                    {isCurrentStructuredV3 ? (
                      <V3StructuredPracticeControls
                        question={currentItem.question}
                        disabled={currentAnswer.isSubmitted}
                        value={currentAnswer.structuredResponse ?? null}
                        onChange={(resp) =>
                          setAnswers((prev) => ({
                            ...prev,
                            [currentItem.question.id]: {
                              ...currentAnswer,
                              structuredResponse: resp,
                            },
                          }))
                        }
                        onSubmit={handleSubmitStructured}
                      />
                    ) : currentItem.displayedOptions.length > 0 ? (
                      <div className="space-y-3">
                        <div
                          role={isCurrentMultiChoice ? "group" : "radiogroup"}
                          aria-label={lText(
                            locale,
                            "Các lựa chọn đáp án",
                            "Answer options",
                          )}
                          className={
                            isCurrentImageChoice
                              ? "grid gap-3 sm:grid-cols-2"
                              : "space-y-2.5"
                          }
                        >
                          {currentItem.displayedOptions.map((option) => {
                            const isSelected =
                              currentAnswer.selectedOptionIds.includes(
                                option.id,
                              );
                            const isCorrectOpt = option.is_correct;
                            const submitted = currentAnswer.isSubmitted;
                            const optionMediaItems = getOptionDisplayItems(option);
                            const hasOptImage = optionMediaItems.length > 0;
                            const hasOptText = hasRenderableText(
                              option.content,
                              option.content_rich,
                            );

                            let stateStyle =
                              "border-border bg-card hover:bg-secondary/60 text-foreground";
                            if (submitted) {
                              if (isCorrectOpt) {
                                stateStyle =
                                  "border-2 border-success bg-success-subtle text-success-subtle-foreground ring-1 ring-success/30";
                              } else if (isSelected && !isCorrectOpt) {
                                stateStyle =
                                  "border-2 border-destructive bg-destructive-subtle text-destructive-subtle-foreground";
                              } else {
                                stateStyle =
                                  "border-border bg-card/60 opacity-75";
                              }
                            } else if (isSelected) {
                              stateStyle =
                                "border-primary bg-accent text-accent-foreground";
                            }

                            return (
                              <div
                                key={option.id}
                                role={isCurrentMultiChoice ? "checkbox" : "radio"}
                                aria-checked={isSelected}
                                aria-disabled={submitted}
                                tabIndex={submitted ? -1 : 0}
                                onClick={() => {
                                  if (!submitted) handleOptionClick(option.id);
                                }}
                                onKeyDown={(e) => {
                                  if (submitted) return;
                                  if (e.target !== e.currentTarget) return;
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    handleOptionClick(option.id);
                                  }
                                }}
                                className={cn(
                                  "flex min-h-12 w-full flex-col items-stretch gap-2 rounded-lg border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                                  submitted ? "cursor-default" : "cursor-pointer",
                                  stateStyle,
                                )}
                              >
                                <div className="flex w-full items-start gap-3">
                                  <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border border-current/25 text-xs font-semibold">
                                    {option.displayLabel}
                                  </span>
                                  <div className="min-w-0 flex-1 text-sm leading-relaxed sm:text-base">
                                    {hasOptText ? (
                                      <SafeRichText
                                        rich={option.content_rich}
                                        fallbackText={option.content}
                                        inline
                                      />
                                    ) : hasOptImage ? (
                                      <span className="text-xs text-muted-foreground">
                                        {lText(
                                          locale,
                                          `Hình phương án ${option.displayLabel}`,
                                          `Option ${option.displayLabel} image`,
                                        )}
                                      </span>
                                    ) : null}
                                  </div>
                                  {submitted && isCorrectOpt ? (
                                    <span className="flex shrink-0 items-center gap-1 text-xs font-semibold">
                                      <CheckCircle2
                                        className="size-4"
                                        aria-hidden="true"
                                      />
                                      <span className="sr-only">
                                        {t("study.correctAnswer")}
                                      </span>
                                    </span>
                                  ) : null}
                                  {submitted &&
                                  isSelected &&
                                  !isCorrectOpt ? (
                                    <span className="flex shrink-0 items-center gap-1 text-xs font-semibold">
                                      <XCircle
                                        className="size-4"
                                        aria-hidden="true"
                                      />
                                      <span className="sr-only">
                                        {t("study.incorrect")}
                                      </span>
                                    </span>
                                  ) : null}
                                </div>

                                {hasOptImage ? (
                                  <MediaGallery
                                    items={optionMediaItems}
                                    variant="option"
                                    className="pt-1"
                                  />
                                ) : null}
                              </div>
                            );
                          })}
                        </div>

                        {isCurrentMultiChoice && !currentAnswer.isSubmitted ? (
                          <Button
                            className="mt-2 min-h-11"
                            disabled={
                              currentAnswer.selectedOptionIds.length === 0
                            }
                            onClick={() =>
                              submitCurrentChoice(
                                currentAnswer.selectedOptionIds,
                              )
                            }
                          >
                            {t("study.checkAnswer")}
                          </Button>
                        ) : null}
                      </div>
                    ) : (
                      <form onSubmit={handleSubmitTyped} className="space-y-3">
                        <Label htmlFor="practice-typed-answer">
                          {t("study.yourAnswer")}
                        </Label>
                        <div className="flex gap-2">
                          <Input
                            id="practice-typed-answer"
                            disabled={currentAnswer.isSubmitted}
                            value={currentAnswer.typedAnswer}
                            onChange={(e) =>
                              setAnswers((prev) => ({
                                ...prev,
                                [currentItem.question.id]: {
                                  ...currentAnswer,
                                  typedAnswer: e.target.value,
                                },
                              }))
                            }
                            placeholder={lText(
                              locale,
                              "Nhập đáp án của bạn...",
                              "Type your answer...",
                            )}
                          />
                          <Button
                            type="submit"
                            disabled={
                              currentAnswer.isSubmitted ||
                              !currentAnswer.typedAnswer.trim()
                            }
                          >
                            {t("study.checkAnswer")}
                          </Button>
                        </div>
                      </form>
                    )}

                    {/* Immediate Feedback Banner */}
                    {currentAnswer.isSubmitted ? (
                      <div
                        role="status"
                        aria-live="polite"
                        className={cn(
                          "rounded-lg border p-4 space-y-2",
                          currentAnswer.isCorrect
                            ? "border-success/40 bg-success-subtle text-success-subtle-foreground"
                            : "border-destructive/40 bg-destructive-subtle text-destructive-subtle-foreground",
                        )}
                      >
                        <div className="flex items-center gap-2 font-semibold text-sm">
                          {currentAnswer.isCorrect ? (
                            <>
                              <CheckCircle2 className="size-4" aria-hidden="true" />
                              <span>{t("study.correct")}</span>
                            </>
                          ) : (
                            <>
                              <XCircle className="size-4" aria-hidden="true" />
                              <span>{t("study.incorrect")}</span>
                            </>
                          )}
                        </div>
                        {!currentAnswer.isCorrect &&
                        (isCurrentStructuredV3 ||
                          currentItem.displayedOptions.length === 0) ? (
                          <div className="text-sm text-foreground/95">
                            <strong>{t("study.correctAnswer")}: </strong>
                            <span>
                              {formatCorrectAnswerDisplay(
                                currentItem.question,
                                locale,
                              ) || "—"}
                            </span>
                          </div>
                        ) : null}
                        {(() => {
                          const expMediaItems = getQuestionExplanationDisplayItems(
                            currentItem.question,
                            lText(locale, "Hình ảnh giải thích", "Explanation image"),
                          );
                          const hasExpContent =
                            Boolean(currentItem.question.explanation) ||
                            Boolean(currentItem.question.explanation_rich) ||
                            expMediaItems.length > 0;
                          if (
                            !showExplanation ||
                            (!showExplanationOnCorrect && currentAnswer.isCorrect) ||
                            !hasExpContent
                          ) {
                            return null;
                          }
                          return (
                            <div className="space-y-2 text-sm text-foreground/90">
                              {currentItem.question.explanation ||
                              currentItem.question.explanation_rich ? (
                                <div>
                                  <strong>{t("study.explanation")}: </strong>
                                  <SafeRichText
                                    rich={currentItem.question.explanation_rich}
                                    fallbackText={currentItem.question.explanation}
                                    inline
                                  />
                                </div>
                              ) : (
                                <strong className="block">
                                  {t("study.explanation")}:
                                </strong>
                              )}
                              {expMediaItems.length > 0 ? (
                                <MediaGallery
                                  items={expMediaItems}
                                  variant="compact"
                                />
                              ) : null}
                            </div>
                          );
                        })()}
                      </div>
                    ) : null}

                    {/* Personal Notes, Report & Contextual Edit Bar */}
                    <div className="border-t border-border/60 pt-3">
                      <QuestionNotesAndReportBar
                        key={currentItem.question.id}
                        studySetId={setId}
                        questionId={currentItem.question.id}
                        showReportButton
                        compact
                        canEdit={canEdit}
                        onEditQuestion={() => {
                          if (autoNextTimerRef.current) {
                            clearTimeout(autoNextTimerRef.current);
                            autoNextTimerRef.current = null;
                          }
                          setEditingQuestionId(currentItem.question.id);
                        }}
                      />
                    </div>
                  </CardContent>
                </Card>
            </div>

            {/* Bottom Prev / Next bar */}
            <div className="flex items-center justify-between gap-3">
              <Button
                variant="outline"
                className="min-h-11"
                disabled={currentIndex === 0}
                onClick={handleGoPrev}
              >
                <ChevronLeft className="size-4" aria-hidden="true" />
                {t("study.previousQuestion")}
              </Button>
              <Button className="min-h-11" onClick={handleGoNext}>
                {currentIndex + 1 >= items.length
                  ? t("common.finish")
                  : t("study.nextQuestion")}
                <ChevronRight className="size-4" aria-hidden="true" />
              </Button>
            </div>
          </div>

          {/* Desktop Right Navigator (Conditionally mounted ONLY on >=1024px — P1-4!) */}
          {isDesktopLg ? (
            <aside className="sticky top-20 rounded-xl border border-border bg-card p-4 shadow-xs">
              <h2 className="mb-3 text-sm font-semibold">
                {t("exam.questionNavigator")}
              </h2>
              {renderNavigatorGrid()}
            </aside>
          ) : null}
          </div>
        </div>
      )}

      <ContextualQuestionEditorModal
        open={Boolean(editingQuestionId) && canEdit}
        onOpenChange={(open) => {
          if (!open) setEditingQuestionId(null);
        }}
        studySetId={setId}
        questionId={editingQuestionId}
        initialQuestion={
          editingQuestionId
            ? (items.find((it) => it.question.id === editingQuestionId)
                ?.question ?? null)
            : null
        }
        chapters={bundle.chapters}
        onSaved={(saved) => handleContextualQuestionSaved(saved)}
      />
    </FocusModeShell>
  );
}
