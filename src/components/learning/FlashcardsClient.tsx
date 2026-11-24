"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeftRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Keyboard,
  Maximize2,
  Mic,
  Minimize2,
  RotateCcw,
  Shuffle,
  Star,
  Volume2,
  VolumeX,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Label } from "@/components/ui/label";
import { useI18n } from "@/lib/i18n";
import { useUserPreferences } from "@/lib/preferences";
import {
  createStudySession,
  deleteCheckpoint,
  isEditableEventTarget,
  isInteractiveControlTarget,
  isSafeDisplayImageUrl,
  listCheckpoints,
  recordStudySessionAnswer,
  updateStudySession,
  upsertCheckpoint,
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
import {
  projectQuestionToFlashcard,
  type ProjectedFlashcard,
} from "@/lib/learning/flashcard-projection";
import { createSeededRng, fisherYatesShuffle } from "@/lib/learning/shuffle";
import { calculateNextReview } from "@/lib/learning/sm2";
import type { SelfRating } from "@/types/domain";
import { cn, formatDuration } from "@/lib/utils";
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
  useStudySetBundle,
} from "./useStudySetBundle";

interface FlashcardsClientProps {
  setId: string;
}

function subscribeReducedMotion(callback: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

function getReducedMotionSnapshot(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function getReducedMotionServerSnapshot(): boolean {
  return false;
}

export function FlashcardsClient({ setId }: FlashcardsClientProps) {
  const { locale, t } = useI18n();
  const { preferences, playFeedbackSound } = useUserPreferences();
  const systemReducedMotion = React.useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot,
  );
  const prefersReducedMotion =
    systemReducedMotion || preferences.reduced_motion;
  const {
    data: bundle,
    isLoading,
    isError,
    error,
    refetch,
    toggleStar,
    updateLocalProgress,
  } = useStudySetBundle(setId);

  const [selectedChapter, setSelectedChapter] = React.useState<string>("all");
  const [starredOnly, setStarredOnly] = React.useState(false);
  const [starredFilterSnapshot, setStarredFilterSnapshot] =
    React.useState<Set<string> | null>(null);
  const [isShuffled, setIsShuffled] = React.useState<boolean>(
    () => preferences.default_shuffle_questions,
  );
  const [swapSides, setSwapSides] = React.useState(false);
  const [reviewSubsetIds, setReviewSubsetIds] = React.useState<string[] | null>(
    null,
  );
  const [shuffleSeed, setShuffleSeed] = React.useState(1);

  const syncedPrefsRef = React.useRef(false);
  React.useEffect(() => {
    if (syncedPrefsRef.current) return;
    syncedPrefsRef.current = true;
    setIsShuffled(preferences.default_shuffle_questions);
  }, [preferences.default_shuffle_questions]);

  const [currentIndex, setCurrentIndex] = React.useState(0);
  const [isFlipped, setIsFlipped] = React.useState(false);
  const [knownIds, setKnownIds] = React.useState<Set<string>>(new Set());
  const [unknownIds, setUnknownIds] = React.useState<Set<string>>(new Set());
  const [isCompleted, setIsCompleted] = React.useState(false);
  const [completedDurationSeconds, setCompletedDurationSeconds] =
    React.useState(1);
  const [isFallbackFullscreen, setIsFallbackFullscreen] = React.useState(false);
  const [isNativeFullscreen, setIsNativeFullscreen] = React.useState(false);
  const [isSpeaking, setIsSpeaking] = React.useState(false);
  const [resetDialogOpen, setResetDialogOpen] = React.useState(false);
  const [pendingResume, setPendingResume] = React.useState<{
    source: "remote" | "local";
    currentIndex: number;
    totalItems: number;
    progressPercent: number;
    updatedAt: string | null;
    removedCount: number;
    knownIds: string[];
    unknownIds: string[];
  } | null>(null);
  const checkpointCheckedRef = React.useRef<string | null>(null);
  const sessionKey = React.useMemo(
    () => makeCheckpointSessionKey("flashcards", setId, selectedChapter),
    [selectedChapter, setId],
  );
  const ttsSupported = React.useSyncExternalStore(
    () => () => {},
    () =>
      typeof window !== "undefined" &&
      "speechSynthesis" in window &&
      typeof SpeechSynthesisUtterance !== "undefined",
    () => false,
  );

  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const sessionIdRef = React.useRef<string | null>(null);
  const sessionStartRef = React.useRef<number>(0);
  const cardShownAtRef = React.useRef<number>(0);

  React.useEffect(() => {
    sessionStartRef.current = Date.now();
    cardShownAtRef.current = Date.now();
  }, []);

  React.useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  React.useEffect(() => {
    const handleFsChange = () => {
      setIsNativeFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener("fullscreenchange", handleFsChange);
    return () => document.removeEventListener("fullscreenchange", handleFsChange);
  }, []);

  // Stable deck ordering: depends ONLY on `bundle?.questions` & explicit seeded shuffle
  // NEVER depends on mutable `bundle` object, preventing deck reshuffle on every card rating (SH-021)!
  const bundleQuestions = bundle?.questions;
  const cards = React.useMemo<ProjectedFlashcard[]>(() => {
    if (!bundleQuestions) return [];
    let filtered = bundleQuestions;

    if (reviewSubsetIds) {
      const idSet = new Set(reviewSubsetIds);
      filtered = filtered.filter((q) => idSet.has(q.id));
    } else {
      if (selectedChapter !== "all") {
        filtered = filtered.filter(
          (q) => (q.chapter?.trim() || "") === selectedChapter,
        );
      }
      if (starredOnly && starredFilterSnapshot) {
        filtered = filtered.filter((q) => starredFilterSnapshot.has(q.id));
      }
    }

    const projected = filtered.map(projectQuestionToFlashcard);
    if (isShuffled) {
      const rng = createSeededRng(
        `${setId}:${selectedChapter}:${starredOnly}:${shuffleSeed}`,
      );
      return fisherYatesShuffle(projected, rng);
    }
    return projected;
  }, [
    bundleQuestions,
    isShuffled,
    reviewSubsetIds,
    selectedChapter,
    setId,
    shuffleSeed,
    starredFilterSnapshot,
    starredOnly,
  ]);

  // Ensure session exists once per deck configuration (never spawns duplicate sessions on rating)
  const studySetIdLoaded = bundle?.studySet.id ?? null;
  React.useEffect(() => {
    if (!studySetIdLoaded || cards.length === 0 || sessionIdRef.current) return;
    let active = true;
    createStudySession({
      study_set_id: setId,
      mode: "flashcards",
      config: {
        chapter: selectedChapter,
        starredOnly,
        shuffled: isShuffled,
        swapSides,
      },
      total_items: cards.length,
    })
      .then((session) => {
        if (active) {
          sessionIdRef.current = session.id;
        }
      })
      .catch(() => {
        // Non-blocking: still allow studying even if offline/unconfigured
      });
    return () => {
      active = false;
    };
  }, [
    cards.length,
    isShuffled,
    selectedChapter,
    setId,
    starredOnly,
    studySetIdLoaded,
    swapSides,
  ]);

  const safeIndex = Math.min(currentIndex, Math.max(0, cards.length - 1));
  const activeCard = cards[safeIndex] ?? null;

  const stopSpeech = React.useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    setIsSpeaking(false);
  }, []);

  const handleSpeak = React.useCallback(
    (text: string) => {
      if (!ttsSupported || !text.trim()) return;
      stopSpeech();
      try {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang =
          bundle?.studySet.source_language === "en" ? "en-US" : "vi-VN";
        utterance.onend = () => setIsSpeaking(false);
        utterance.onerror = () => setIsSpeaking(false);
        setIsSpeaking(true);
        window.speechSynthesis.speak(utterance);
      } catch {
        setIsSpeaking(false);
      }
    },
    [ttsSupported, stopSpeech, bundle],
  );

  const toggleFullscreen = React.useCallback(async () => {
    const el = containerRef.current;
    if (typeof document !== "undefined" && document.fullscreenEnabled && el) {
      try {
        if (document.fullscreenElement) {
          await document.exitFullscreen();
        } else {
          await el.requestFullscreen();
        }
        return;
      } catch {
        // Fallback below
      }
    }
    setIsFallbackFullscreen((prev) => !prev);
  }, []);

  const resetDeckState = React.useCallback((subset: string[] | null = null) => {
    stopSpeech();
    setReviewSubsetIds(subset);
    setCurrentIndex(0);
    setIsFlipped(false);
    setKnownIds(new Set());
    setUnknownIds(new Set());
    setIsCompleted(false);
    setPendingResume(null);
    sessionStartRef.current = Date.now();
    cardShownAtRef.current = Date.now();
    sessionIdRef.current = null;
    if (bundle) {
      clearLocalCheckpoint(bundle.studySet.owner_id, sessionKey);
    }
    void deleteCheckpoint({ sessionKey }).catch(() => {});
  }, [bundle, sessionKey, stopSpeech]);

  const persistFlashcardCheckpoint = React.useCallback(
    (
      nextIndex: number,
      nextKnown: Set<string>,
      nextUnknown: Set<string>,
      completed: boolean,
    ) => {
      if (!bundle || cards.length === 0) return;
      if (completed) {
        clearLocalCheckpoint(bundle.studySet.owner_id, sessionKey);
        void deleteCheckpoint({ sessionKey }).catch(() => {});
        return;
      }
      const pct = Math.min(
        99,
        Math.round(((nextKnown.size + nextUnknown.size) / cards.length) * 100),
      );
      const stateJson = {
        cardIds: cards.map((c) => c.questionId),
        knownIds: Array.from(nextKnown),
        unknownIds: Array.from(nextUnknown),
      };
      saveLocalCheckpoint({
        version: 1,
        userId: bundle.studySet.owner_id,
        studySetId: setId,
        mode: "flashcards",
        sessionKey,
        currentIndex: nextIndex,
        totalItems: cards.length,
        progressPercent: pct,
        stateJson,
        committedEventKeys: [],
        updatedAt: new Date().toISOString(),
      });
      void upsertCheckpoint({
        study_set_id: setId,
        mode: "flashcards",
        session_key: sessionKey,
        state_json: stateJson,
        progress_percent: pct,
        current_index: nextIndex,
        total_items: cards.length,
      }).catch(() => {});
    },
    [bundle, cards, sessionKey, setId],
  );

  // Check for resumable Flashcards checkpoint once per (setId, chapter)
  React.useEffect(() => {
    if (!bundle || cards.length === 0) return;
    const key = `${setId}:${selectedChapter}:${cards.length}`;
    if (checkpointCheckedRef.current === key) return;
    checkpointCheckedRef.current = key;

    const liveIds = new Set(cards.map((c) => c.questionId));
    const localCp = loadLocalCheckpoint(bundle.studySet.owner_id, sessionKey);
    void listCheckpoints({ studySetId: setId, mode: "flashcards", sessionKey })
      .then((remotes) => {
        const picked = pickNewestCheckpoint(remotes[0] ?? null, localCp);
        if (
          picked.source === "none" ||
          picked.currentIndex <= 0 ||
          picked.progressPercent >= 100
        ) {
          return;
        }
        const st = picked.stateJson as {
          cardIds?: string[];
          knownIds?: string[];
          unknownIds?: string[];
        };
        const rec = reconcileCheckpointQuestions(
          Array.isArray(st.cardIds) ? st.cardIds : cards.map((c) => c.questionId),
          liveIds,
          picked.currentIndex,
        );
        if (rec.validIds.length === 0) return;
        setPendingResume({
          source: picked.source,
          currentIndex: rec.safeIndex,
          totalItems: cards.length,
          progressPercent: picked.progressPercent,
          updatedAt: picked.updatedAt,
          removedCount: rec.removedIds.length,
          knownIds: (st.knownIds ?? []).filter((id) => liveIds.has(id)),
          unknownIds: (st.unknownIds ?? []).filter((id) => liveIds.has(id)),
        });
      })
      .catch(() => {});
  }, [bundle, cards, selectedChapter, sessionKey, setId]);

  const goToIndex = React.useCallback(
    (nextIdx: number) => {
      stopSpeech();
      if (nextIdx < 0) return;
      if (nextIdx >= cards.length) {
        const durationSeconds = Math.max(
          1,
          Math.round((Date.now() - sessionStartRef.current) / 1000),
        );
        setCompletedDurationSeconds(durationSeconds);
        setIsCompleted(true);
        if (sessionIdRef.current) {
          updateStudySession(sessionIdRef.current, {
            status: "completed",
            completed_items: knownIds.size + unknownIds.size,
            correct_items: knownIds.size,
            duration_seconds: durationSeconds,
          }).catch(() => {});
        }
        return;
      }
      setCurrentIndex(nextIdx);
      setIsFlipped(false);
      cardShownAtRef.current = Date.now();
    },
    [cards.length, knownIds.size, unknownIds.size, stopSpeech],
  );

  const handleRateCard = React.useCallback(
    async (rating: SelfRating) => {
      if (!activeCard || !bundle) return;
      const isKnown = rating !== "again";
      const responseTimeMs = Math.max(0, Date.now() - cardShownAtRef.current);

      const nextKnown = new Set(knownIds);
      const nextUnknown = new Set(unknownIds);
      if (isKnown) {
        nextKnown.add(activeCard.questionId);
        nextUnknown.delete(activeCard.questionId);
      } else {
        nextUnknown.add(activeCard.questionId);
        nextKnown.delete(activeCard.questionId);
      }
      setKnownIds(nextKnown);
      setUnknownIds(nextUnknown);
      playFeedbackSound(isKnown ? "correct" : "wrong");

      // Deterministic SM-2 progress calculation
      const prevProgress = bundle.progressMap.get(activeCard.questionId);
      const nextSm2 = calculateNextReview(prevProgress, rating);

      // Persist asynchronously without blocking snappy card transitions
      if (sessionIdRef.current) {
        recordStudySessionAnswer(sessionIdRef.current, {
          question_id: activeCard.questionId,
          is_correct: isKnown,
          self_rating: rating,
          response_time_ms: responseTimeMs,
          update_progress: true,
        })
          .then((res) => {
            if (res.progress) updateLocalProgress(res.progress);
          })
          .catch(() => {
            // Fallback to direct progress upsert
            upsertQuestionProgress({
              study_set_id: setId,
              question_id: activeCard.questionId,
              is_correct: isKnown,
              self_rating: rating,
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
          question_id: activeCard.questionId,
          is_correct: isKnown,
          self_rating: rating,
          mastery_level: nextSm2.mastery_level,
          ease_factor: nextSm2.ease_factor,
          interval_days: nextSm2.interval_days,
          repetitions: nextSm2.repetitions,
          next_review_at: nextSm2.next_review_at,
        })
          .then(updateLocalProgress)
          .catch(() => {});
      }

      // Advance to next card or complete
      stopSpeech();
      if (safeIndex + 1 >= cards.length) {
        playFeedbackSound("complete");
        const durationSeconds = Math.max(
          1,
          Math.round((Date.now() - sessionStartRef.current) / 1000),
        );
        setCompletedDurationSeconds(durationSeconds);
        setIsCompleted(true);
        persistFlashcardCheckpoint(safeIndex, nextKnown, nextUnknown, true);
        if (sessionIdRef.current) {
          updateStudySession(sessionIdRef.current, {
            status: "completed",
            completed_items: nextKnown.size + nextUnknown.size,
            correct_items: nextKnown.size,
            duration_seconds: durationSeconds,
          }).catch(() => {});
        }
      } else {
        setCurrentIndex(safeIndex + 1);
        setIsFlipped(false);
        cardShownAtRef.current = Date.now();
        persistFlashcardCheckpoint(safeIndex + 1, nextKnown, nextUnknown, false);
      }
    },
    [
      activeCard,
      bundle,
      cards.length,
      knownIds,
      persistFlashcardCheckpoint,
      playFeedbackSound,
      safeIndex,
      setId,
      stopSpeech,
      unknownIds,
      updateLocalProgress,
    ],
  );

  const handleFlipToggle = React.useCallback(() => {
    // Stop stale speech cleanly whenever flipping sides!
    stopSpeech();
    playFeedbackSound("flip");
    setIsFlipped((prev) => !prev);
  }, [playFeedbackSound, stopSpeech]);

  const handleStarToggle = React.useCallback(async () => {
    if (!activeCard) return;
    try {
      await toggleStar(activeCard.questionId);
    } catch {
      toast.error(t("common.errorGeneric"));
    }
  }, [activeCard, toggleStar, t]);

  // Global keyboard shortcuts: strictly 1=Again, 2=Hard, 3=Good, 4=Easy (SH-021!)
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isCompleted || !activeCard) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableEventTarget(event.target)) return;

      if (event.code === "Space" && !isInteractiveControlTarget(event.target)) {
        event.preventDefault();
        handleFlipToggle();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (safeIndex > 0) goToIndex(safeIndex - 1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        goToIndex(safeIndex + 1);
      } else if (event.key === "1") {
        event.preventDefault();
        void handleRateCard("again");
      } else if (event.key === "2") {
        event.preventDefault();
        void handleRateCard("hard");
      } else if (event.key === "3") {
        event.preventDefault();
        void handleRateCard("good");
      } else if (event.key === "4") {
        event.preventDefault();
        void handleRateCard("easy");
      } else if (event.key === "s" || event.key === "S") {
        event.preventDefault();
        void handleStarToggle();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    activeCard,
    goToIndex,
    handleFlipToggle,
    handleRateCard,
    handleStarToggle,
    isCompleted,
    safeIndex,
  ]);

  if (isLoading) {
    return (
      <FocusModeShell
        backHref={`/sets/${setId}`}
        title={t("study.flashcards")}
      >
        <StudyLoadingSkeleton />
      </FocusModeShell>
    );
  }

  if (isError || !bundle) {
    return (
      <FocusModeShell
        backHref={`/sets/${setId}`}
        title={t("study.flashcards")}
      >
        <StudyErrorState
          message={error instanceof Error ? error.message : undefined}
          onRetry={() => void refetch()}
          backHref={`/sets/${setId}`}
        />
      </FocusModeShell>
    );
  }

  const isStarred = activeCard ? bundle.starredIds.has(activeCard.questionId) : false;
  const frontText = activeCard
    ? swapSides
      ? activeCard.backText
      : activeCard.frontText
    : "";
  const backText = activeCard
    ? swapSides
      ? activeCard.frontText
      : activeCard.backText
    : "";
  const frontImage = activeCard
    ? swapSides
      ? activeCard.backImageUrl
      : activeCard.frontImageUrl
    : null;
  const backImage = activeCard
    ? swapSides
      ? activeCard.frontImageUrl
      : activeCard.backImageUrl
    : null;
  const frontRich = activeCard
    ? swapSides
      ? activeCard.backRich ?? null
      : activeCard.frontRich ?? null
    : null;
  const backRich = activeCard
    ? swapSides
      ? activeCard.frontRich ?? null
      : activeCard.backRich ?? null
    : null;
  const frontAudio = activeCard
    ? swapSides
      ? activeCard.backAudioUrl ?? null
      : activeCard.frontAudioUrl ?? null
    : null;
  const backAudio = activeCard
    ? swapSides
      ? activeCard.frontAudioUrl ?? null
      : activeCard.backAudioUrl ?? null
    : null;
  const frontMedia = activeCard
    ? swapSides
      ? activeCard.backMedia ?? []
      : activeCard.frontMedia ?? []
    : [];
  const backMedia = activeCard
    ? swapSides
      ? activeCard.frontMedia ?? []
      : activeCard.backMedia ?? []
    : [];

  const isFullscreenActive = isNativeFullscreen || isFallbackFullscreen;

  return (
    <div
      ref={containerRef}
      className={cn(
        isFallbackFullscreen && "fixed inset-0 z-50 overflow-y-auto bg-background",
      )}
    >
      <FocusModeShell
        backHref={`/sets/${setId}`}
        title={bundle.studySet.title}
        subtitle={lText(locale, "Chế độ Flashcards", "Flashcards Mode")}
        progressCurrent={cards.length > 0 ? Math.min(safeIndex + 1, cards.length) : 0}
        progressTotal={cards.length}
        headerRight={
          <div className="flex items-center gap-1.5">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="min-h-10 min-w-10"
                  aria-label={t("study.keyboardShortcuts")}
                >
                  <Keyboard className="size-4" aria-hidden="true" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 space-y-2 text-xs">
                <p className="font-semibold text-foreground">
                  {t("study.keyboardShortcuts")}
                </p>
                <ul className="space-y-1.5 text-muted-foreground">
                  <li className="flex justify-between">
                    <span>{t("study.flipCard")}</span>
                    <kbd className="rounded bg-secondary px-1.5 py-0.5 font-mono text-foreground">
                      Space
                    </kbd>
                  </li>
                  <li className="flex justify-between">
                    <span>{lText(locale, "Lại (Chưa thuộc)", "Again")}</span>
                    <kbd className="rounded bg-secondary px-1.5 py-0.5 font-mono text-foreground">
                      1
                    </kbd>
                  </li>
                  <li className="flex justify-between">
                    <span>{lText(locale, "Khó", "Hard")}</span>
                    <kbd className="rounded bg-secondary px-1.5 py-0.5 font-mono text-foreground">
                      2
                    </kbd>
                  </li>
                  <li className="flex justify-between">
                    <span>{lText(locale, "Tốt", "Good")}</span>
                    <kbd className="rounded bg-secondary px-1.5 py-0.5 font-mono text-foreground">
                      3
                    </kbd>
                  </li>
                  <li className="flex justify-between">
                    <span>{lText(locale, "Dễ", "Easy")}</span>
                    <kbd className="rounded bg-secondary px-1.5 py-0.5 font-mono text-foreground">
                      4
                    </kbd>
                  </li>
                  <li className="flex justify-between">
                    <span>{lText(locale, "Thẻ trước / tiếp", "Prev / Next")}</span>
                    <kbd className="rounded bg-secondary px-1.5 py-0.5 font-mono text-foreground">
                      ← / →
                    </kbd>
                  </li>
                  <li className="flex justify-between">
                    <span>{t("study.starQuestion")}</span>
                    <kbd className="rounded bg-secondary px-1.5 py-0.5 font-mono text-foreground">
                      S
                    </kbd>
                  </li>
                </ul>
              </PopoverContent>
            </Popover>

            <Button
              variant="ghost"
              size="icon"
              className="min-h-10 min-w-10"
              onClick={() => void toggleFullscreen()}
              aria-label={
                isFullscreenActive
                  ? lText(locale, "Thoát toàn màn hình", "Exit fullscreen")
                  : lText(locale, "Toàn màn hình", "Enter fullscreen")
              }
            >
              {isFullscreenActive ? (
                <Minimize2 className="size-4" aria-hidden="true" />
              ) : (
                <Maximize2 className="size-4" aria-hidden="true" />
              )}
            </Button>
          </div>
        }
      >
        {/* Filter & deck controls bar */}
        <div className="mx-auto mb-5 flex w-full max-w-3xl flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {bundle.chapters.length > 0 ? (
              <Select
                value={selectedChapter}
                onValueChange={(val) => {
                  setSelectedChapter(val);
                  resetDeckState(null);
                }}
              >
                <SelectTrigger
                  className="h-9 w-[190px]"
                  aria-label={lText(locale, "Lọc theo chương", "Filter by chapter")}
                >
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
            ) : null}

            <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5">
              <Switch
                id="flashcard-starred-only"
                checked={starredOnly}
                onCheckedChange={(checked) => {
                  setStarredOnly(checked);
                  setStarredFilterSnapshot(
                    checked ? new Set(bundle.starredIds) : null,
                  );
                  resetDeckState(null);
                }}
              />
              <Label htmlFor="flashcard-starred-only" className="text-xs cursor-pointer">
                {lText(locale, "Chỉ thẻ gắn sao", "Starred only")} (
                {bundle.starredIds.size})
              </Label>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={isShuffled ? "secondary" : "outline"}
              size="sm"
              className="min-h-9"
              aria-pressed={isShuffled}
              onClick={() => {
                setIsShuffled((prev) => !prev);
                setShuffleSeed((s) => s + 1);
                setCurrentIndex(0);
                setIsFlipped(false);
              }}
            >
              <Shuffle className="size-3.5" aria-hidden="true" />
              {lText(locale, "Trộn thẻ", "Shuffle")}
            </Button>

            <Button
              variant={swapSides ? "secondary" : "outline"}
              size="sm"
              className="min-h-9"
              aria-pressed={swapSides}
              onClick={() => {
                stopSpeech();
                setSwapSides((prev) => !prev);
                setIsFlipped(false);
              }}
            >
              <ArrowLeftRight className="size-3.5" aria-hidden="true" />
              {lText(locale, "Đảo mặt", "Swap sides")}
            </Button>

            <Button
              variant="ghost"
              size="sm"
              className="min-h-9 text-muted-foreground"
              onClick={() => setResetDialogOpen(true)}
            >
              <RotateCcw className="size-3.5" aria-hidden="true" />
              {lText(locale, "Đặt lại", "Reset")}
            </Button>
          </div>
        </div>

        {/* Resumable Checkpoint Banner */}
        {pendingResume ? (
          <div className="mx-auto mb-4 w-full max-w-3xl">
            <ResumeSessionBanner
              modeLabel={lText(locale, "Thẻ ghi nhớ (Flashcards)", "Flashcards")}
              currentIndex={pendingResume.currentIndex}
              totalItems={pendingResume.totalItems}
              progressPercent={pendingResume.progressPercent}
              updatedAt={pendingResume.updatedAt}
              source={pendingResume.source}
              removedQuestionsCount={pendingResume.removedCount}
              onContinue={() => {
                setCurrentIndex(pendingResume.currentIndex);
                setKnownIds(new Set(pendingResume.knownIds));
                setUnknownIds(new Set(pendingResume.unknownIds));
                setIsFlipped(false);
                setPendingResume(null);
              }}
              onRestart={() => resetDeckState(null)}
              onDiscard={() => {
                setPendingResume(null);
                clearLocalCheckpoint(bundle.studySet.owner_id, sessionKey);
                void deleteCheckpoint({ sessionKey }).catch(() => {});
              }}
            />
          </div>
        ) : null}

        {/* Status pills */}
        {cards.length > 0 && !isCompleted ? (
          <div className="mx-auto mb-4 flex w-full max-w-3xl items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <Badge variant="destructive" className="tabular-nums">
                <XCircle className="size-3" aria-hidden="true" />
                {t("study.stillLearning")}: {unknownIds.size}
              </Badge>
              <Badge variant="success" className="tabular-nums">
                <CheckCircle2 className="size-3" aria-hidden="true" />
                {t("study.knowIt")}: {knownIds.size}
              </Badge>
            </div>
            {reviewSubsetIds ? (
              <Badge variant="warning">
                {lText(locale, "Đang ôn thẻ chưa thuộc", "Reviewing unknown cards")}
              </Badge>
            ) : null}
          </div>
        ) : null}

        {cards.length === 0 ? (
          <StudyEmptyState
            setId={setId}
            onResetFilters={
              selectedChapter !== "all" || starredOnly || reviewSubsetIds
                ? () => {
                    setSelectedChapter("all");
                    setStarredOnly(false);
                    resetDeckState(null);
                  }
                : undefined
            }
          />
        ) : isCompleted ? (
          <Card className="mx-auto my-6 w-full max-w-xl">
            <CardContent className="space-y-6 py-8 text-center">
              <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-success-subtle text-success-subtle-foreground">
                <CheckCircle2 className="size-7" aria-hidden="true" />
              </div>
              <div className="space-y-1">
                <h2 className="text-xl font-bold">{t("study.sessionComplete")}</h2>
                <p className="text-sm text-muted-foreground">
                  {lText(
                    locale,
                    `Bạn đã hoàn thành ${cards.length} thẻ trong ${formatDuration(completedDurationSeconds)}.`,
                    `You completed ${cards.length} cards in ${formatDuration(completedDurationSeconds)}.`,
                  )}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 text-left">
                <div className="rounded-lg border border-border bg-success-subtle/60 p-4">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-success-subtle-foreground">
                    <CheckCircle2 className="size-4" aria-hidden="true" />
                    {t("study.knowIt")}
                  </div>
                  <p className="mt-1 text-2xl font-bold tabular-nums">
                    {knownIds.size}
                  </p>
                </div>
                <div className="rounded-lg border border-border bg-destructive-subtle/60 p-4">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-destructive-subtle-foreground">
                    <XCircle className="size-4" aria-hidden="true" />
                    {t("study.stillLearning")}
                  </div>
                  <p className="mt-1 text-2xl font-bold tabular-nums">
                    {unknownIds.size}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap justify-center gap-2 pt-2">
                {unknownIds.size > 0 ? (
                  <Button onClick={() => resetDeckState(Array.from(unknownIds))}>
                    <RotateCcw className="size-4" aria-hidden="true" />
                    {lText(
                      locale,
                      `Ôn lại ${unknownIds.size} thẻ chưa thuộc`,
                      `Review ${unknownIds.size} unknown cards`,
                    )}
                  </Button>
                ) : null}
                <Button variant="outline" onClick={() => resetDeckState(null)}>
                  {t("study.studyAgain")}
                </Button>
                <Button variant="secondary" asChild>
                  <Link href={`/sets/${setId}/learn`}>
                    {lText(locale, "Chuyển sang Chế độ Học", "Switch to Learn Mode")}
                  </Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : activeCard ? (
          <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5">
            {/* 3D Flip Card Container (GPU-composited CSS 3D flip, 0ms card-switch exit delay) */}
            <div style={{ perspective: 1200 }} className="w-full">
              <div key={activeCard.questionId}>
                <div className="relative">
                    {/* Top overlay controls (outside flip button to keep valid semantic HTML) */}
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">
                          {isFlipped
                            ? lText(locale, "Mặt sau (Đáp án)", "Back (Answer)")
                            : lText(locale, "Mặt trước (Câu hỏi)", "Front (Prompt)")}
                        </Badge>
                        {activeCard.chapter ? (
                          <Badge variant="secondary">{activeCard.chapter}</Badge>
                        ) : null}
                        {activeCard.isProjectedFromMc ? (
                          <Badge variant="accent">
                            {lText(locale, "Từ trắc nghiệm", "From MC")}
                          </Badge>
                        ) : null}
                      </div>

                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="min-h-10 min-w-10"
                          disabled={!ttsSupported}
                          onClick={() => {
                            if (isSpeaking) {
                              stopSpeech();
                            } else {
                              handleSpeak(isFlipped ? backText : frontText);
                            }
                          }}
                          aria-label={
                            !ttsSupported
                              ? lText(
                                  locale,
                                  "Trình duyệt không hỗ trợ đọc giọng nói",
                                  "Text-to-speech not supported in this browser",
                                )
                              : isSpeaking
                                ? lText(locale, "Dừng đọc", "Stop reading")
                                : lText(locale, "Đọc nội dung thẻ", "Read card aloud")
                          }
                        >
                          {ttsSupported ? (
                            <Volume2
                              className={cn(
                                "size-4",
                                isSpeaking && "text-primary",
                              )}
                              aria-hidden="true"
                            />
                          ) : (
                            <VolumeX className="size-4 text-muted-foreground" aria-hidden="true" />
                          )}
                        </Button>

                        <Button
                          variant="ghost"
                          size="icon"
                          className="min-h-10 min-w-10"
                          asChild
                          aria-label={lText(
                            locale,
                            "Gắn âm thanh / sửa thẻ",
                            "Attach audio / edit card",
                          )}
                        >
                          <Link
                            href={`/sets/${setId}/edit?questionId=${activeCard.questionId}`}
                            title={lText(
                              locale,
                              "Ghi âm / Sửa thẻ",
                              "Record audio / Edit card",
                            )}
                          >
                            <Mic className="size-4 text-muted-foreground" aria-hidden="true" />
                          </Link>
                        </Button>

                        <Button
                          variant="ghost"
                          size="icon"
                          className="min-h-10 min-w-10"
                          onClick={() => void handleStarToggle()}
                          aria-pressed={isStarred}
                          aria-label={
                            isStarred
                              ? t("study.unstarQuestion")
                              : t("study.starQuestion")
                          }
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
                    </div>

                    {/* Readable Accessible Flip Surface (NO card-erasing aria-label, NO clipping absolute inset-0 — SH-021!) */}
                    <article
                      aria-live="polite"
                      onClick={() => {
                        if (
                          typeof window !== "undefined" &&
                          window.getSelection()?.toString()
                        ) {
                          return;
                        }
                        handleFlipToggle();
                      }}
                      className="cursor-pointer select-text rounded-xl focus-within:ring-2 focus-within:ring-ring"
                    >
                      {prefersReducedMotion ? (
                        <div className="flex min-h-[280px] sm:min-h-[340px] flex-col items-center justify-between rounded-xl border border-border bg-card p-6 sm:p-10 text-center shadow-xs transition-opacity duration-150">
                          <div className="my-auto w-full max-w-2xl space-y-4">
                            <SafeRichText
                              rich={isFlipped ? backRich : frontRich}
                              fallbackText={
                                (isFlipped ? backText : frontText) ||
                                lText(locale, "(Chưa có nội dung)", "(No content)")
                              }
                              className="text-lg font-medium leading-relaxed sm:text-xl"
                            />
                            <div
                              onClick={(e) => e.stopPropagation()}
                              className="flex flex-wrap items-center justify-center gap-3"
                            >
                              <ZoomableImage
                                src={isFlipped ? backImage : frontImage}
                                alt={lText(
                                  locale,
                                  "Hình ảnh minh họa thẻ",
                                  "Flashcard illustration",
                                )}
                                className="mx-auto max-h-56"
                              />
                              {(isFlipped ? backMedia : frontMedia)
                                .filter((m) => m.media?.kind === "image" && m.media.proxy_url)
                                .map((m) => (
                                  <ZoomableImage
                                    key={m.id}
                                    src={m.media?.proxy_url}
                                    alt={m.alt_text ?? m.media?.alt_text ?? ""}
                                    caption={m.caption ?? m.media?.caption}
                                    className="max-h-44"
                                  />
                                ))}
                            </div>
                            {isSafeDisplayImageUrl(
                              isFlipped ? backAudio : frontAudio,
                            ) ? (
                              <div
                                onClick={(e) => e.stopPropagation()}
                                className="mx-auto max-w-md pt-1"
                              >
                                <audio
                                  controls
                                  preload="metadata"
                                  src={(isFlipped ? backAudio : frontAudio) ?? ""}
                                  className="w-full"
                                />
                              </div>
                            ) : null}
                            {isFlipped && (activeCard.explanation || activeCard.explanationRich) ? (
                              <div className="mt-4 rounded-lg bg-secondary/70 p-3.5 text-left text-sm text-muted-foreground">
                                <span className="font-semibold text-foreground">
                                  {t("study.explanation")}:{" "}
                                </span>
                                <SafeRichText
                                  rich={activeCard.explanationRich}
                                  fallbackText={activeCard.explanation}
                                />
                              </div>
                            ) : null}
                          </div>
                          <div className="mt-6 flex items-center justify-center">
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="min-h-10 text-xs text-muted-foreground"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleFlipToggle();
                              }}
                            >
                              {isFlipped
                                ? lText(
                                    locale,
                                    "Lật về mặt trước (Space)",
                                    "Flip to front (Space)",
                                  )
                                : lText(
                                    locale,
                                    "Lật xem đáp án (Space)",
                                    "Flip card (Space)",
                                  )}
                            </Button>
                          </div>
                        </div>
                      ) : (
                        /* CSS Grid single-cell stacking so height expands naturally for tall content with ZERO clipping! */
                        <div
                          style={{
                            transformStyle: "preserve-3d",
                            transform: isFlipped
                              ? "rotateY(180deg)"
                              : "rotateY(0deg)",
                          }}
                          className="grid w-full grid-cols-1 grid-rows-1 transition-transform duration-300 ease-[cubic-bezier(0.2,0,0,1)] motion-reduce:transition-none"
                        >
                          {/* Front face */}
                          <div
                            aria-hidden={isFlipped}
                            style={{ backfaceVisibility: "hidden" }}
                            className="col-start-1 row-start-1 flex min-h-[280px] sm:min-h-[340px] flex-col items-center justify-between rounded-xl border border-border bg-card p-6 sm:p-10 text-center shadow-xs"
                          >
                            <div className="my-auto w-full max-w-2xl space-y-4">
                              <SafeRichText
                                rich={frontRich}
                                fallbackText={
                                  frontText ||
                                  lText(locale, "(Chưa có nội dung)", "(No content)")
                                }
                                className="text-lg font-medium leading-relaxed sm:text-xl"
                              />
                              <div
                                onClick={(e) => e.stopPropagation()}
                                className="flex flex-wrap items-center justify-center gap-3"
                              >
                                <ZoomableImage
                                  src={frontImage}
                                  alt={lText(
                                    locale,
                                    "Hình ảnh mặt trước",
                                    "Front side illustration",
                                  )}
                                  className="mx-auto max-h-56"
                                />
                                {frontMedia
                                  .filter((m) => m.media?.kind === "image" && m.media.proxy_url)
                                  .map((m) => (
                                    <ZoomableImage
                                      key={m.id}
                                      src={m.media?.proxy_url}
                                      alt={m.alt_text ?? m.media?.alt_text ?? ""}
                                      caption={m.caption ?? m.media?.caption}
                                      className="max-h-44"
                                    />
                                  ))}
                              </div>
                              {isSafeDisplayImageUrl(frontAudio) ? (
                                <div
                                  onClick={(e) => e.stopPropagation()}
                                  className="mx-auto max-w-md pt-1"
                                >
                                  <audio
                                    controls
                                    preload="metadata"
                                    src={frontAudio}
                                    className="w-full"
                                  />
                                </div>
                              ) : null}
                              {activeCard.hint || activeCard.hintRich ? (
                                <div className="text-xs text-muted-foreground">
                                  <span className="font-semibold">
                                    {lText(locale, "Gợi ý", "Hint")}:{" "}
                                  </span>
                                  <SafeRichText
                                    rich={activeCard.hintRich}
                                    fallbackText={activeCard.hint}
                                    inline
                                  />
                                </div>
                              ) : null}
                            </div>
                            <div className="mt-6">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                tabIndex={isFlipped ? -1 : 0}
                                className="min-h-10 text-xs text-muted-foreground"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleFlipToggle();
                                }}
                              >
                                {lText(
                                  locale,
                                  "Lật xem đáp án · Space",
                                  "Flip to reveal answer · Space",
                                )}
                              </Button>
                            </div>
                          </div>

                          {/* Back face */}
                          <div
                            aria-hidden={!isFlipped}
                            style={{
                              backfaceVisibility: "hidden",
                              transform: "rotateY(180deg)",
                            }}
                            className="col-start-1 row-start-1 flex min-h-[280px] sm:min-h-[340px] flex-col items-center justify-between rounded-xl border border-primary/40 bg-card p-6 sm:p-10 text-center shadow-xs"
                          >
                            <div className="my-auto w-full max-w-2xl space-y-4">
                              <SafeRichText
                                rich={backRich}
                                fallbackText={
                                  backText ||
                                  lText(locale, "(Chưa có đáp án)", "(No answer)")
                                }
                                className="text-lg font-medium leading-relaxed text-foreground sm:text-xl"
                              />
                              <div
                                onClick={(e) => e.stopPropagation()}
                                className="flex flex-wrap items-center justify-center gap-3"
                              >
                                <ZoomableImage
                                  src={backImage}
                                  alt={lText(
                                    locale,
                                    "Hình ảnh mặt sau",
                                    "Back side illustration",
                                  )}
                                  className="mx-auto max-h-56"
                                />
                                {backMedia
                                  .filter((m) => m.media?.kind === "image" && m.media.proxy_url)
                                  .map((m) => (
                                    <ZoomableImage
                                      key={m.id}
                                      src={m.media?.proxy_url}
                                      alt={m.alt_text ?? m.media?.alt_text ?? ""}
                                      caption={m.caption ?? m.media?.caption}
                                      className="max-h-44"
                                    />
                                  ))}
                              </div>
                              {isSafeDisplayImageUrl(backAudio) ? (
                                <div
                                  onClick={(e) => e.stopPropagation()}
                                  className="mx-auto max-w-md pt-1"
                                >
                                  <audio
                                    controls
                                    preload="metadata"
                                    src={backAudio}
                                    className="w-full"
                                  />
                                </div>
                              ) : null}
                              {activeCard.explanation || activeCard.explanationRich ? (
                                <div className="rounded-lg bg-secondary/70 p-3.5 text-left text-sm text-muted-foreground">
                                  <span className="font-semibold text-foreground">
                                    {t("study.explanation")}:{" "}
                                  </span>
                                  <SafeRichText
                                    rich={activeCard.explanationRich}
                                    fallbackText={activeCard.explanation}
                                  />
                                </div>
                              ) : null}
                            </div>
                            <div className="mt-6">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                tabIndex={isFlipped ? 0 : -1}
                                className="min-h-10 text-xs text-muted-foreground"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleFlipToggle();
                                }}
                              >
                                {lText(
                                  locale,
                                  "Lật về mặt trước · Space",
                                  "Flip to front · Space",
                                )}
                              </Button>
                            </div>
                          </div>
                        </div>
                      )}
                    </article>
                  </div>
              </div>
            </div>

            {/* All 4 SM-2 Rating Controls (1=Again, 2=Hard, 3=Good, 4=Easy — SH-021!) */}
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-12 border-destructive/50 text-destructive-subtle-foreground hover:bg-destructive-subtle"
                  onClick={() => void handleRateCard("again")}
                >
                  <XCircle className="size-4 shrink-0" aria-hidden="true" />
                  <span>{lText(locale, "Lại", "Again")}</span>
                  <kbd className="ml-1 hidden rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px] sm:inline">
                    1
                  </kbd>
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  className="min-h-12 border-warning/50 text-warning-subtle-foreground hover:bg-warning-subtle"
                  onClick={() => void handleRateCard("hard")}
                >
                  <span>{lText(locale, "Khó", "Hard")}</span>
                  <kbd className="ml-1 hidden rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px] sm:inline">
                    2
                  </kbd>
                </Button>

                <Button
                  type="button"
                  variant="default"
                  className="min-h-12"
                  onClick={() => void handleRateCard("good")}
                >
                  <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
                  <span>{lText(locale, "Tốt", "Good")}</span>
                  <kbd className="ml-1 hidden rounded bg-white/20 px-1.5 py-0.5 font-mono text-[11px] sm:inline">
                    3
                  </kbd>
                </Button>

                <Button
                  type="button"
                  variant="success"
                  className="min-h-12"
                  onClick={() => void handleRateCard("easy")}
                >
                  <span>{lText(locale, "Dễ", "Easy")}</span>
                  <kbd className="ml-1 hidden rounded bg-white/20 px-1.5 py-0.5 font-mono text-[11px] sm:inline">
                    4
                  </kbd>
                </Button>
              </div>

              <div className="flex items-center justify-between gap-3">
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  disabled={safeIndex === 0}
                  onClick={() => goToIndex(safeIndex - 1)}
                >
                  <ChevronLeft className="size-4" aria-hidden="true" />
                  {t("common.previous")}
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => goToIndex(safeIndex + 1)}
                >
                  {t("common.next")}
                  <ChevronRight className="size-4" aria-hidden="true" />
                </Button>
              </div>

              {isFlipped ? (
                <div className="pt-1">
                  <QuestionNotesAndReportBar
                    studySetId={setId}
                    questionId={activeCard.questionId}
                    compact
                  />
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        <ResetProgressDialog
          open={resetDialogOpen}
          onOpenChange={setResetDialogOpen}
          defaultScope="study_set"
          studySetId={setId}
          studySetTitle={bundle.studySet.title}
          subject={bundle.studySet.subject ?? undefined}
          chapters={bundle.chapters}
          mode="flashcards"
          userId={bundle.studySet.owner_id}
          onResetComplete={() => {
            void refetch();
            resetDeckState(null);
          }}
        />
      </FocusModeShell>
    </div>
  );
}

export const FlashcardDeck = FlashcardsClient;
