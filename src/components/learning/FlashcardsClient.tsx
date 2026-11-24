"use client";

import * as React from "react";
import Link from "next/link";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import {
  ArrowLeftRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Keyboard,
  Maximize2,
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
import {
  createStudySession,
  isEditableEventTarget,
  isSafeDisplayImageUrl,
  recordStudySessionAnswer,
  updateStudySession,
  upsertQuestionProgress,
} from "@/lib/learning/api-client";
import {
  projectQuestionToFlashcard,
  type ProjectedFlashcard,
} from "@/lib/learning/flashcard-projection";
import { fisherYatesShuffle } from "@/lib/learning/shuffle";
import { calculateNextReview } from "@/lib/learning/sm2";
import type { SelfRating } from "@/types/domain";
import { cn, formatDuration } from "@/lib/utils";
import { FocusModeShell } from "./FocusModeShell";
import { lText } from "./learning-copy";
import {
  StudyEmptyState,
  StudyErrorState,
  StudyLoadingSkeleton,
  useStudySetBundle,
} from "./useStudySetBundle";

interface FlashcardsClientProps {
  setId: string;
}

export function FlashcardsClient({ setId }: FlashcardsClientProps) {
  const { locale, t } = useI18n();
  const prefersReducedMotion = useReducedMotion();
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
  const [isShuffled, setIsShuffled] = React.useState(false);
  const [swapSides, setSwapSides] = React.useState(false);
  const [reviewSubsetIds, setReviewSubsetIds] = React.useState<string[] | null>(
    null,
  );
  const [shuffleSeed, setShuffleSeed] = React.useState(0);

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

  const cards = React.useMemo<ProjectedFlashcard[]>(() => {
    if (!bundle) return [];
    let filtered = bundle.questions;

    if (reviewSubsetIds) {
      const idSet = new Set(reviewSubsetIds);
      filtered = filtered.filter((q) => idSet.has(q.id));
    } else {
      if (selectedChapter !== "all") {
        filtered = filtered.filter(
          (q) => (q.chapter?.trim() || "") === selectedChapter,
        );
      }
      if (starredOnly) {
        filtered = filtered.filter((q) => bundle.starredIds.has(q.id));
      }
    }

    const projected = filtered.map(projectQuestionToFlashcard);
    if (isShuffled) {
      return fisherYatesShuffle(projected);
    }
    return projected;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle, selectedChapter, starredOnly, isShuffled, reviewSubsetIds, shuffleSeed]);

  // Ensure session exists once cards load
  React.useEffect(() => {
    if (!bundle || cards.length === 0 || sessionIdRef.current) return;
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
  }, [bundle, cards.length, setId, selectedChapter, starredOnly, isShuffled, swapSides]);

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
    sessionStartRef.current = Date.now();
    cardShownAtRef.current = Date.now();
    sessionIdRef.current = null;
  }, [stopSpeech]);

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
      if (safeIndex + 1 >= cards.length) {
        const durationSeconds = Math.max(
          1,
          Math.round((Date.now() - sessionStartRef.current) / 1000),
        );
        setCompletedDurationSeconds(durationSeconds);
        setIsCompleted(true);
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
      }
    },
    [
      activeCard,
      bundle,
      cards.length,
      knownIds,
      safeIndex,
      setId,
      unknownIds,
      updateLocalProgress,
    ],
  );

  const handleStarToggle = React.useCallback(async () => {
    if (!activeCard) return;
    try {
      await toggleStar(activeCard.questionId);
    } catch {
      toast.error(t("common.errorGeneric"));
    }
  }, [activeCard, toggleStar, t]);

  // Global keyboard shortcuts (strictly ignoring editable inputs!)
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isCompleted || !activeCard) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableEventTarget(event.target)) return;

      if (event.code === "Space") {
        event.preventDefault();
        setIsFlipped((prev) => !prev);
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
        void handleRateCard("good");
      } else if (event.key === "3") {
        event.preventDefault();
        void handleRateCard("hard");
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
                    <span>{t("study.stillLearning")}</span>
                    <kbd className="rounded bg-secondary px-1.5 py-0.5 font-mono text-foreground">
                      1
                    </kbd>
                  </li>
                  <li className="flex justify-between">
                    <span>{t("study.knowIt")}</span>
                    <kbd className="rounded bg-secondary px-1.5 py-0.5 font-mono text-foreground">
                      2
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
                setSwapSides((prev) => !prev);
                setIsFlipped(false);
              }}
            >
              <ArrowLeftRight className="size-3.5" aria-hidden="true" />
              {lText(locale, "Đảo mặt", "Swap sides")}
            </Button>
          </div>
        </div>

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
            {/* 3D Flip Card Container */}
            <div style={{ perspective: 1200 }} className="w-full">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeCard.questionId}
                  initial={{ opacity: 0, x: prefersReducedMotion ? 0 : 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: prefersReducedMotion ? 0 : -12 }}
                  transition={{ duration: 0.18, ease: [0.2, 0, 0, 1] }}
                >
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

                    {/* Interactive Flip Surface */}
                    <button
                      type="button"
                      onClick={() => setIsFlipped((prev) => !prev)}
                      aria-label={
                        isFlipped
                          ? lText(locale, "Lật về mặt trước", "Flip to front")
                          : lText(locale, "Lật xem đáp án mặt sau", "Flip to reveal back")
                      }
                      className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-xl"
                    >
                      {prefersReducedMotion ? (
                        <div className="flex min-h-[300px] sm:min-h-[360px] flex-col items-center justify-center rounded-xl border border-border bg-card p-6 sm:p-10 text-center shadow-xs transition-opacity duration-150">
                          <div className="max-w-2xl space-y-4">
                            <p className="whitespace-pre-wrap text-lg font-medium leading-relaxed sm:text-xl">
                              {(isFlipped ? backText : frontText) ||
                                lText(locale, "(Chưa có nội dung)", "(No content)")}
                            </p>
                            {isSafeDisplayImageUrl(isFlipped ? backImage : frontImage) ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={(isFlipped ? backImage : frontImage) ?? ""}
                                alt={lText(locale, "Hình ảnh minh họa thẻ", "Flashcard illustration")}
                                className="mx-auto max-h-48 rounded-lg border border-border object-contain"
                              />
                            ) : null}
                            {isFlipped && activeCard.explanation ? (
                              <div className="mt-4 rounded-lg bg-secondary/70 p-3 text-left text-sm text-muted-foreground">
                                <span className="font-semibold text-foreground">
                                  {t("study.explanation")}:{" "}
                                </span>
                                <span className="whitespace-pre-wrap">
                                  {activeCard.explanation}
                                </span>
                              </div>
                            ) : null}
                          </div>
                          <p className="mt-6 text-xs text-muted-foreground">
                            {lText(
                              locale,
                              "Bấm vào thẻ hoặc nhấn Space để lật",
                              "Click card or press Space to flip",
                            )}
                          </p>
                        </div>
                      ) : (
                        <motion.div
                          animate={{ rotateY: isFlipped ? 180 : 0 }}
                          transition={{ duration: 0.32, ease: [0.2, 0, 0, 1] }}
                          style={{ transformStyle: "preserve-3d" }}
                          className="relative min-h-[300px] sm:min-h-[360px] w-full"
                        >
                          {/* Front face */}
                          <div
                            style={{ backfaceVisibility: "hidden" }}
                            className="absolute inset-0 flex flex-col items-center justify-center rounded-xl border border-border bg-card p-6 sm:p-10 text-center shadow-xs"
                          >
                            <div className="max-w-2xl space-y-4 overflow-y-auto">
                              <p className="whitespace-pre-wrap text-lg font-medium leading-relaxed sm:text-xl">
                                {frontText ||
                                  lText(locale, "(Chưa có nội dung)", "(No content)")}
                              </p>
                              {isSafeDisplayImageUrl(frontImage) ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={frontImage}
                                  alt={lText(locale, "Hình ảnh mặt trước", "Front side illustration")}
                                  className="mx-auto max-h-44 rounded-lg border border-border object-contain"
                                />
                              ) : null}
                              {activeCard.hint ? (
                                <p className="text-xs text-muted-foreground">
                                  {lText(locale, "Gợi ý", "Hint")}: {activeCard.hint}
                                </p>
                              ) : null}
                            </div>
                            <p className="mt-6 text-xs text-muted-foreground">
                              {lText(
                                locale,
                                "Bấm vào thẻ hoặc nhấn Space để lật",
                                "Click card or press Space to flip",
                              )}
                            </p>
                          </div>

                          {/* Back face */}
                          <div
                            style={{
                              backfaceVisibility: "hidden",
                              transform: "rotateY(180deg)",
                            }}
                            className="absolute inset-0 flex flex-col items-center justify-center rounded-xl border border-primary/30 bg-card p-6 sm:p-10 text-center shadow-xs"
                          >
                            <div className="max-w-2xl space-y-4 overflow-y-auto">
                              <p className="whitespace-pre-wrap text-lg font-medium leading-relaxed text-foreground sm:text-xl">
                                {backText ||
                                  lText(locale, "(Chưa có đáp án)", "(No answer)")}
                              </p>
                              {isSafeDisplayImageUrl(backImage) ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  src={backImage}
                                  alt={lText(locale, "Hình ảnh mặt sau", "Back side illustration")}
                                  className="mx-auto max-h-44 rounded-lg border border-border object-contain"
                                />
                              ) : null}
                              {activeCard.explanation ? (
                                <div className="rounded-lg bg-secondary/70 p-3 text-left text-sm text-muted-foreground">
                                  <span className="font-semibold text-foreground">
                                    {t("study.explanation")}:{" "}
                                  </span>
                                  <span className="whitespace-pre-wrap">
                                    {activeCard.explanation}
                                  </span>
                                </div>
                              ) : null}
                            </div>
                            <p className="mt-6 text-xs text-muted-foreground">
                              {lText(
                                locale,
                                "Nhấn 1 (Cần ôn lại) hoặc 2 (Đã thuộc)",
                                "Press 1 (Still Learning) or 2 (Known)",
                              )}
                            </p>
                          </div>
                        </motion.div>
                      )}
                    </button>
                  </div>
                </motion.div>
              </AnimatePresence>
            </div>

            {/* Action Controls */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <Button
                variant="outline"
                className="min-h-11"
                disabled={safeIndex === 0}
                onClick={() => goToIndex(safeIndex - 1)}
              >
                <ChevronLeft className="size-4" aria-hidden="true" />
                {t("common.previous")}
              </Button>

              <div className="grid grid-cols-2 gap-2.5 sm:flex sm:items-center">
                <Button
                  variant="outline"
                  className="min-h-11 border-destructive/40 text-destructive-subtle-foreground hover:bg-destructive-subtle"
                  onClick={() => void handleRateCard("again")}
                >
                  <XCircle className="size-4" aria-hidden="true" />
                  <span>{t("study.stillLearning")}</span>
                  <kbd className="ml-1 hidden rounded bg-secondary px-1.5 py-0.5 font-mono text-[11px] sm:inline">
                    1
                  </kbd>
                </Button>

                <Button
                  variant="success"
                  className="min-h-11"
                  onClick={() => void handleRateCard("good")}
                >
                  <CheckCircle2 className="size-4" aria-hidden="true" />
                  <span>{t("study.knowIt")}</span>
                  <kbd className="ml-1 hidden rounded bg-white/20 px-1.5 py-0.5 font-mono text-[11px] sm:inline">
                    2
                  </kbd>
                </Button>
              </div>

              <Button
                variant="outline"
                className="min-h-11"
                onClick={() => goToIndex(safeIndex + 1)}
              >
                {t("common.next")}
                <ChevronRight className="size-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
        ) : null}
      </FocusModeShell>
    </div>
  );
}
