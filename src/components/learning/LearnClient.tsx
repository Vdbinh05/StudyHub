"use client";

import * as React from "react";
import Link from "next/link";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  Brain,
  CheckCircle2,
  Clock,
  RotateCcw,
  Star,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
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
import { useI18n } from "@/lib/i18n";
import { useUserPreferences } from "@/lib/preferences";
import {
  createStudySession,
  isEditableEventTarget,
  isInteractiveControlTarget,
  isSafeDisplayImageUrl,
  recordStudySessionAnswer,
  updateStudySession,
  upsertQuestionProgress,
} from "@/lib/learning/api-client";
import {
  advanceLearnRound,
  createLearnQueueState,
  getCurrentLearnCard,
  getLearnStats,
  recordLearnAnswer,
  type LearnItemInput,
  type LearnQueueState,
} from "@/lib/learning/learn-queue";
import {
  createSeededRng,
  gradeChoiceSelection,
  shuffleOptions,
  withOptionDisplayLabels,
  type DisplayedOption,
} from "@/lib/learning/shuffle";
import {
  calculateNextReview,
  createInitialProgressState,
  summarizeMastery,
} from "@/lib/learning/sm2";
import {
  getExpectedWriteAnswers,
  gradeWriteAnswer,
} from "@/lib/learning/write-grader";
import type { Question, QuestionOption } from "@/types/domain";
import { cn, formatDuration } from "@/lib/utils";
import { FocusModeShell } from "./FocusModeShell";
import { lText } from "./learning-copy";
import {
  StudyEmptyState,
  StudyErrorState,
  StudyLoadingSkeleton,
  useStudySetBundle,
} from "./useStudySetBundle";

interface LearnClientProps {
  setId: string;
}

export function LearnClient({ setId }: LearnClientProps) {
  const { locale, t } = useI18n();
  const { preferences, playFeedbackSound } = useUserPreferences();
  const prefersReducedMotion = useReducedMotion() || preferences.reduced_motion;
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
  const [roundSize, setRoundSize] = React.useState<number>(7);
  const [queueState, setQueueState] = React.useState<LearnQueueState | null>(
    null,
  );
  const [completedDurationSeconds, setCompletedDurationSeconds] =
    React.useState(1);
  const [selectedOptionIds, setSelectedOptionIds] = React.useState<string[]>([]);
  const [typedAnswer, setTypedAnswer] = React.useState("");
  const [feedback, setFeedback] = React.useState<{
    submitted: boolean;
    isCorrect: boolean;
    expectedText: string;
  } | null>(null);
  const [turnCounter, setTurnCounter] = React.useState(0);

  const sessionIdRef = React.useRef<string | null>(null);
  const initializedKeyRef = React.useRef<string | null>(null);
  const startedAtRef = React.useRef<number>(0);
  const cardStartRef = React.useRef<number>(0);
  const lastCompositionEndRef = React.useRef<number | null>(null);
  const bundleRef = React.useRef(bundle);

  React.useEffect(() => {
    bundleRef.current = bundle;
  }, [bundle]);

  React.useEffect(() => {
    startedAtRef.current = Date.now();
    cardStartRef.current = Date.now();
  }, []);

  const bundleQuestions = bundle?.questions;

  const questionMap = React.useMemo(() => {
    const map = new Map<string, Question>();
    for (const q of bundleQuestions ?? []) {
      map.set(q.id, q);
    }
    return map;
  }, [bundleQuestions]);

  const filteredQuestions = React.useMemo(() => {
    if (!bundleQuestions) return [];
    if (selectedChapter === "all") return bundleQuestions;
    return bundleQuestions.filter(
      (q) => (q.chapter?.trim() || "") === selectedChapter,
    );
  }, [bundleQuestions, selectedChapter]);

  const masterySummary = React.useMemo(() => {
    if (!bundle) {
      return { total: 0, new: 0, learning: 0, familiar: 0, mastered: 0, due: 0 };
    }
    const items = filteredQuestions.map(
      (q) => bundle.progressMap.get(q.id) ?? createInitialProgressState(),
    );
    return summarizeMastery(items);
  }, [bundle, filteredQuestions]);

  const initQueue = React.useCallback(
    (questions: Question[], size: number, chapter: string) => {
      const currentBundle = bundleRef.current;
      if (!currentBundle) return;
      const inputs: LearnItemInput[] = questions.map((q) => {
        const p = currentBundle.progressMap.get(q.id);
        return {
          questionId: q.id,
          masteryLevel: p?.mastery_level ?? "new",
          nextReviewAt: p?.next_review_at ?? null,
          wrongCount: p?.wrong_count ?? 0,
        };
      });
      const initial = createLearnQueueState(inputs, {
        roundSize: size,
        reinsertGap: 4,
      });
      setQueueState(initial);
      setSelectedOptionIds([]);
      setTypedAnswer("");
      setFeedback(null);
      setTurnCounter((c) => c + 1);
      startedAtRef.current = Date.now();
      cardStartRef.current = Date.now();
      sessionIdRef.current = null;

      if (questions.length > 0) {
        createStudySession({
          study_set_id: setId,
          mode: "learn",
          config: { chapter, roundSize: size },
          total_items: questions.length,
        })
          .then((s) => {
            sessionIdRef.current = s.id;
          })
          .catch(() => {});
      }
    },
    [setId],
  );

  // Initialize queue & study session STRICTLY ONCE per (studySetId, selectedChapter, roundSize).
  // NEVER depends on mutable `bundle` object, preventing orphaned sessions & mid-feedback queue jumps (SH-008)!
  const studySetIdLoaded = bundle?.studySet.id ?? null;
  const sessionKey = studySetIdLoaded
    ? `${studySetIdLoaded}:${selectedChapter}:${roundSize}`
    : null;

  React.useEffect(() => {
    if (!sessionKey || initializedKeyRef.current === sessionKey) return;
    initializedKeyRef.current = sessionKey;
    initQueue(filteredQuestions, roundSize, selectedChapter);
  }, [filteredQuestions, initQueue, roundSize, selectedChapter, sessionKey]);

  const currentCard = queueState ? getCurrentLearnCard(queueState) : null;
  const currentQuestion = currentCard
    ? questionMap.get(currentCard.questionId) ?? null
    : null;

  const displayedOptions = React.useMemo<Array<DisplayedOption<QuestionOption>>>(() => {
    if (!currentQuestion || !currentQuestion.options?.length) return [];
    if (!preferences.default_shuffle_options) {
      return withOptionDisplayLabels(currentQuestion.options);
    }
    const rng = createSeededRng(`${currentQuestion.id}-turn-${turnCounter}`);
    return shuffleOptions(currentQuestion.options, rng);
  }, [currentQuestion, preferences.default_shuffle_options, turnCounter]);

  const persistLearnOutcome = React.useCallback(
    (
      question: Question,
      isCorrect: boolean,
      chosenOptionIds: string[],
      typed: string | null,
    ) => {
      if (!bundle) return;
      const responseTimeMs = Math.max(0, Date.now() - cardStartRef.current);
      const prevProgress = bundle.progressMap.get(question.id);
      const nextSm2 = calculateNextReview(prevProgress, isCorrect);

      if (sessionIdRef.current) {
        recordStudySessionAnswer(sessionIdRef.current, {
          question_id: question.id,
          selected_option_ids: chosenOptionIds,
          typed_answer: typed,
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

  const handleSubmitChoice = React.useCallback(
    (optionIds: string[]) => {
      if (!currentQuestion || feedback?.submitted) return;
      if (optionIds.length === 0) return;

      const correctOpts = (currentQuestion.options ?? []).filter(
        (o) => o.is_correct,
      );
      const correctIds = correctOpts.map((o) => o.id);
      const isCorrect = gradeChoiceSelection(optionIds, correctIds);

      setSelectedOptionIds(optionIds);
      setFeedback({
        submitted: true,
        isCorrect,
        expectedText: correctOpts.map((o) => o.content).join(", "),
      });
      playFeedbackSound(isCorrect ? "correct" : "wrong");
      persistLearnOutcome(currentQuestion, isCorrect, optionIds, null);
    },
    [currentQuestion, feedback?.submitted, persistLearnOutcome, playFeedbackSound],
  );

  const handleOptionSelect = React.useCallback(
    (optionId: string) => {
      if (!currentQuestion || feedback?.submitted) return;
      if (currentQuestion.question_type === "multiple_choice") {
        setSelectedOptionIds((prev) =>
          prev.includes(optionId)
            ? prev.filter((id) => id !== optionId)
            : [...prev, optionId],
        );
      } else {
        handleSubmitChoice([optionId]);
      }
    },
    [currentQuestion, feedback?.submitted, handleSubmitChoice],
  );

  const handleSubmitTyped = React.useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!currentQuestion || feedback?.submitted) return;
      const trimmed = typedAnswer.trim();
      if (!trimmed) return;

      const expected = getExpectedWriteAnswers(currentQuestion);
      const graded = gradeWriteAnswer(trimmed, expected, { strict: false });

      setFeedback({
        submitted: true,
        isCorrect: graded.isCorrect,
        expectedText: expected.map((a) => a.answer_text).join(" / "),
      });
      playFeedbackSound(graded.isCorrect ? "correct" : "wrong");
      persistLearnOutcome(currentQuestion, graded.isCorrect, [], trimmed);
    },
    [
      currentQuestion,
      feedback?.submitted,
      persistLearnOutcome,
      playFeedbackSound,
      typedAnswer,
    ],
  );

  const handleContinueAfterFeedback = React.useCallback(() => {
    if (!queueState || !feedback?.submitted) return;
    const nextState = recordLearnAnswer(queueState, feedback.isCorrect);
    setQueueState(nextState);
    setSelectedOptionIds([]);
    setTypedAnswer("");
    setFeedback(null);
    setTurnCounter((c) => c + 1);
    cardStartRef.current = Date.now();

    if (nextState.sessionCompleted) {
      playFeedbackSound("complete");
      const durationSeconds = Math.max(
        1,
        Math.round((Date.now() - startedAtRef.current) / 1000),
      );
      setCompletedDurationSeconds(durationSeconds);
      if (sessionIdRef.current) {
        updateStudySession(sessionIdRef.current, {
          status: "completed",
          completed_items: nextState.completedQuestionIds.length,
          correct_items: nextState.correctAnswers,
          duration_seconds: durationSeconds,
        }).catch(() => {});
      }
    }
  }, [feedback, playFeedbackSound, queueState]);

  const handleAdvanceRound = React.useCallback(() => {
    if (!queueState) return;
    const nextState = advanceLearnRound(queueState);
    setQueueState(nextState);
    setSelectedOptionIds([]);
    setTypedAnswer("");
    setFeedback(null);
    setTurnCounter((c) => c + 1);
    cardStartRef.current = Date.now();
  }, [queueState]);

  // Keyboard shortcuts (strictly guarding buttons/links on Enter/Space — LM-06!)
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableEventTarget(event.target)) return;

      if (queueState?.roundCompleted && !queueState.sessionCompleted) {
        if (event.key === "Enter" && !isInteractiveControlTarget(event.target)) {
          event.preventDefault();
          handleAdvanceRound();
        }
        return;
      }

      if (!currentQuestion) return;

      if (
        feedback?.submitted &&
        (event.key === "Enter" || event.code === "Space") &&
        !isInteractiveControlTarget(event.target)
      ) {
        event.preventDefault();
        handleContinueAfterFeedback();
        return;
      }

      if (!feedback?.submitted && displayedOptions.length > 0) {
        let idx = -1;
        if (/^[1-6]$/.test(event.key)) {
          idx = Number(event.key) - 1;
        } else if (/^[a-fA-F]$/.test(event.key)) {
          idx = event.key.toUpperCase().charCodeAt(0) - 65;
        }
        if (idx >= 0 && idx < displayedOptions.length) {
          event.preventDefault();
          handleOptionSelect(displayedOptions[idx].id);
        } else if (
          event.key === "Enter" &&
          currentQuestion.question_type === "multiple_choice" &&
          selectedOptionIds.length > 0
        ) {
          event.preventDefault();
          handleSubmitChoice(selectedOptionIds);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    currentQuestion,
    displayedOptions,
    feedback?.submitted,
    handleAdvanceRound,
    handleContinueAfterFeedback,
    handleOptionSelect,
    handleSubmitChoice,
    queueState?.roundCompleted,
    queueState?.sessionCompleted,
    selectedOptionIds,
  ]);

  if (isLoading) {
    return (
      <FocusModeShell backHref={`/sets/${setId}`} title={t("study.learn")}>
        <StudyLoadingSkeleton />
      </FocusModeShell>
    );
  }

  if (isError || !bundle) {
    return (
      <FocusModeShell backHref={`/sets/${setId}`} title={t("study.learn")}>
        <StudyErrorState
          message={error instanceof Error ? error.message : undefined}
          onRetry={() => void refetch()}
          backHref={`/sets/${setId}`}
        />
      </FocusModeShell>
    );
  }

  const stats = queueState ? getLearnStats(queueState) : null;

  return (
    <FocusModeShell
      backHref={`/sets/${setId}`}
      title={bundle.studySet.title}
      subtitle={lText(
        locale,
        "Chế độ Học thích ứng (SM-2)",
        "Adaptive Learn Mode (SM-2)",
      )}
      progressCurrent={stats?.completedQuestions ?? 0}
      progressTotal={stats?.totalQuestions ?? 0}
    >
      {/* Mastery Breakdown Strip + Controls */}
      <div className="mx-auto mb-5 w-full max-w-3xl space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <Badge variant="outline" className="tabular-nums">
              {t("study.masteryNew")}: {masterySummary.new}
            </Badge>
            <Badge variant="warning" className="tabular-nums">
              {t("study.masteryLearning")}: {masterySummary.learning}
            </Badge>
            <Badge variant="accent" className="tabular-nums">
              {t("study.masteryFamiliar")}: {masterySummary.familiar}
            </Badge>
            <Badge variant="success" className="tabular-nums">
              {t("study.masteryMastered")}: {masterySummary.mastered}
            </Badge>
            {masterySummary.due > 0 ? (
              <Badge variant="destructive" className="tabular-nums">
                <Clock className="size-3" aria-hidden="true" />
                {lText(locale, "Đến hạn", "Due")}: {masterySummary.due}
              </Badge>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            {bundle.chapters.length > 0 ? (
              <Select
                value={selectedChapter}
                onValueChange={setSelectedChapter}
              >
                <SelectTrigger
                  className="h-8 w-[160px] text-xs"
                  aria-label={lText(locale, "Chọn chương", "Select chapter")}
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

            <Select
              value={String(roundSize)}
              onValueChange={(v) => setRoundSize(Number(v))}
            >
              <SelectTrigger
                className="h-8 w-[120px] text-xs"
                aria-label={lText(locale, "Số câu mỗi vòng", "Round size")}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="5">
                  5 {lText(locale, "câu/vòng", "/ round")}
                </SelectItem>
                <SelectItem value="7">
                  7 {lText(locale, "câu/vòng", "/ round")}
                </SelectItem>
                <SelectItem value="10">
                  10 {lText(locale, "câu/vòng", "/ round")}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {filteredQuestions.length === 0 || !queueState ? (
        <StudyEmptyState
          setId={setId}
          onResetFilters={
            selectedChapter !== "all"
              ? () => setSelectedChapter("all")
              : undefined
          }
        />
      ) : queueState.sessionCompleted ? (
        <Card className="mx-auto my-6 w-full max-w-xl">
          <CardContent className="space-y-6 py-8 text-center">
            <div className="mx-auto flex size-14 items-center justify-center rounded-full bg-success-subtle text-success-subtle-foreground">
              <Brain className="size-7" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <h2 className="text-xl font-bold">{t("study.sessionComplete")}</h2>
              <p className="text-sm text-muted-foreground">
                {lText(
                  locale,
                  `Bạn đã hoàn thành tất cả ${stats?.totalQuestions ?? 0} câu qua ${queueState.roundNumber} vòng học trong ${formatDuration(completedDurationSeconds)}.`,
                  `Completed all ${stats?.totalQuestions ?? 0} items across ${queueState.roundNumber} rounds in ${formatDuration(completedDurationSeconds)}.`,
                )}
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">{t("study.accuracy")}</p>
                <p className="mt-1 text-xl font-bold text-primary tabular-nums">
                  {stats?.accuracyPercent ?? 0}%
                </p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">
                  {lText(locale, "Lượt trả lời", "Attempts")}
                </p>
                <p className="mt-1 text-xl font-bold tabular-nums">
                  {stats?.totalAnswers ?? 0}
                </p>
              </div>
              <div className="rounded-lg border border-border p-3">
                <p className="text-xs text-muted-foreground">
                  {lText(locale, "Đã củng cố", "Reinforced")}
                </p>
                <p className="mt-1 text-xl font-bold tabular-nums">
                  {stats?.missedCount ?? 0}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <Button
                onClick={() =>
                  initQueue(filteredQuestions, roundSize, selectedChapter)
                }
              >
                <RotateCcw className="size-4" aria-hidden="true" />
                {t("study.studyAgain")}
              </Button>
              <Button variant="outline" asChild>
                <Link href={`/sets/${setId}/test`}>
                  {lText(locale, "Thi thử ngay", "Take Mock Exam")}
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : queueState.roundCompleted ? (
        <Card className="mx-auto my-6 w-full max-w-xl">
          <CardHeader className="text-center">
            <CardTitle className="text-xl">
              {lText(
                locale,
                `Hoàn thành vòng ${queueState.roundNumber}!`,
                `Round ${queueState.roundNumber} Complete!`,
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 text-center">
            <p className="text-sm text-muted-foreground">
              {lText(
                locale,
                `Đã hoàn tất ${stats?.completedQuestions ?? 0}/${stats?.totalQuestions ?? 0} câu. Còn ${stats?.remainingInPool ?? 0} câu cho vòng tiếp theo.`,
                `Completed ${stats?.completedQuestions ?? 0}/${stats?.totalQuestions ?? 0} items. ${stats?.remainingInPool ?? 0} items left for upcoming rounds.`,
              )}
            </p>
            <Button size="lg" className="min-h-11" onClick={handleAdvanceRound}>
              {lText(
                locale,
                `Tiếp tục vòng ${queueState.roundNumber + 1}`,
                `Continue to Round ${queueState.roundNumber + 1}`,
              )}
              <ArrowRight className="size-4" aria-hidden="true" />
            </Button>
          </CardContent>
        </Card>
      ) : currentCard && currentQuestion ? (
        <div className="mx-auto w-full max-w-3xl space-y-4">
          <AnimatePresence mode="wait">
            <motion.div
              key={`${currentQuestion.id}-${turnCounter}`}
              initial={{ opacity: 0, y: prefersReducedMotion ? 0 : 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: prefersReducedMotion ? 0 : -8 }}
              transition={{ duration: 0.16, ease: [0.2, 0, 0, 1] }}
            >
              <Card>
                <CardContent className="space-y-5 py-6">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className="tabular-nums">
                        {lText(locale, "Vòng", "Round")} {queueState.roundNumber} ·{" "}
                        {lText(locale, "Còn", "Left")}{" "}
                        {queueState.activeQueue.length}
                      </Badge>
                      {currentCard.missedInSession ? (
                        <Badge variant="warning">
                          {lText(
                            locale,
                            `Đang củng cố (${currentCard.streakInRound}/${currentCard.requiredCorrect})`,
                            `Reinforcing (${currentCard.streakInRound}/${currentCard.requiredCorrect})`,
                          )}
                        </Badge>
                      ) : null}
                      {currentQuestion.chapter ? (
                        <Badge variant="secondary">{currentQuestion.chapter}</Badge>
                      ) : null}
                    </div>

                    <Button
                      variant="ghost"
                      size="icon"
                      className="min-h-10 min-w-10"
                      aria-pressed={bundle.starredIds.has(currentQuestion.id)}
                      aria-label={
                        bundle.starredIds.has(currentQuestion.id)
                          ? t("study.unstarQuestion")
                          : t("study.starQuestion")
                      }
                      onClick={() =>
                        void toggleStar(currentQuestion.id).catch(() =>
                          toast.error(t("common.errorGeneric")),
                        )
                      }
                    >
                      <Star
                        className={cn(
                          "size-4",
                          bundle.starredIds.has(currentQuestion.id)
                            ? "fill-warning text-warning"
                            : "text-muted-foreground",
                        )}
                        aria-hidden="true"
                      />
                    </Button>
                  </div>

                  <div className="space-y-3">
                    <h2 className="whitespace-pre-wrap text-lg font-medium leading-relaxed">
                      {currentQuestion.prompt}
                    </h2>
                    {isSafeDisplayImageUrl(currentQuestion.prompt_image_url) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={currentQuestion.prompt_image_url}
                        alt={lText(locale, "Hình ảnh câu hỏi", "Question illustration")}
                        className="max-h-60 rounded-lg border border-border object-contain"
                      />
                    ) : null}
                  </div>

                  {displayedOptions.length > 0 ? (
                    <div
                      role={
                        currentQuestion.question_type === "multiple_choice"
                          ? "group"
                          : "radiogroup"
                      }
                      className="space-y-2.5"
                    >
                      {displayedOptions.map((opt) => {
                        const isSelected = selectedOptionIds.includes(opt.id);
                        const submitted = Boolean(feedback?.submitted);
                        let style =
                          "border-border bg-card hover:bg-secondary/60 text-foreground";
                        if (submitted) {
                          if (opt.is_correct) {
                            style =
                              "border-success bg-success-subtle text-success-subtle-foreground";
                          } else if (isSelected && !opt.is_correct) {
                            style =
                              "border-destructive bg-destructive-subtle text-destructive-subtle-foreground";
                          } else {
                            style = "border-border opacity-75";
                          }
                        } else if (isSelected) {
                          style =
                            "border-primary bg-accent text-accent-foreground";
                        }

                        return (
                          <button
                            key={opt.id}
                            type="button"
                            role={
                              currentQuestion.question_type === "multiple_choice"
                                ? "checkbox"
                                : "radio"
                            }
                            aria-checked={isSelected}
                            disabled={submitted}
                            onClick={() => handleOptionSelect(opt.id)}
                            className={cn(
                              "flex min-h-12 w-full items-start gap-3 rounded-lg border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                              style,
                            )}
                          >
                            <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border border-current/25 text-xs font-semibold">
                              {opt.displayLabel}
                            </span>
                            <span className="flex-1 whitespace-pre-wrap text-sm sm:text-base leading-relaxed">
                              {opt.content}
                            </span>
                            {submitted && opt.is_correct ? (
                              <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                            ) : null}
                            {submitted && isSelected && !opt.is_correct ? (
                              <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                            ) : null}
                          </button>
                        );
                      })}

                      {currentQuestion.question_type === "multiple_choice" &&
                      !feedback?.submitted ? (
                        <Button
                          className="mt-2 min-h-11"
                          disabled={selectedOptionIds.length === 0}
                          onClick={() => handleSubmitChoice(selectedOptionIds)}
                        >
                          {t("study.checkAnswer")}
                        </Button>
                      ) : null}
                    </div>
                  ) : (
                    <form onSubmit={handleSubmitTyped} className="space-y-3">
                      <Label htmlFor="learn-typed-input">
                        {t("study.yourAnswer")}
                      </Label>
                      <div className="flex gap-2">
                        <Input
                          id="learn-typed-input"
                          disabled={Boolean(feedback?.submitted)}
                          value={typedAnswer}
                          onChange={(e) => setTypedAnswer(e.target.value)}
                          onCompositionEnd={(e) => {
                            lastCompositionEndRef.current = e.timeStamp;
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              if (
                                e.nativeEvent.isComposing ||
                                (lastCompositionEndRef.current !== null &&
                                  Math.abs(
                                    e.timeStamp - lastCompositionEndRef.current,
                                  ) < 50)
                              ) {
                                return;
                              }
                              handleSubmitTyped();
                            }
                          }}
                          placeholder={lText(
                            locale,
                            "Nhập đáp án rồi nhấn Enter...",
                            "Type your answer and press Enter...",
                          )}
                        />
                        <Button
                          type="submit"
                          disabled={
                            Boolean(feedback?.submitted) || !typedAnswer.trim()
                          }
                        >
                          {t("study.checkAnswer")}
                        </Button>
                      </div>
                    </form>
                  )}

                  {feedback?.submitted ? (
                    <div
                      role="status"
                      aria-live="polite"
                      className={cn(
                        "rounded-lg border p-4 space-y-2.5",
                        feedback.isCorrect
                          ? "border-success/40 bg-success-subtle text-success-subtle-foreground"
                          : "border-destructive/40 bg-destructive-subtle text-destructive-subtle-foreground",
                      )}
                    >
                      <div className="flex items-center gap-2 font-semibold text-sm">
                        {feedback.isCorrect ? (
                          <>
                            <CheckCircle2 className="size-4" aria-hidden="true" />
                            <span>{t("study.correct")}</span>
                          </>
                        ) : (
                          <>
                            <XCircle className="size-4" aria-hidden="true" />
                            <span>
                              {lText(
                                locale,
                                "Chưa đúng — câu này sẽ xuất hiện lại sau vài thẻ để củng cố.",
                                "Incorrect — this item will reappear in a few cards to reinforce.",
                              )}
                            </span>
                          </>
                        )}
                      </div>

                      {!feedback.isCorrect && feedback.expectedText ? (
                        <p className="text-sm text-foreground">
                          <strong>{t("study.correctAnswer")}: </strong>
                          {feedback.expectedText}
                        </p>
                      ) : null}

                      {currentQuestion.explanation ? (
                        <p className="text-sm text-foreground/90 whitespace-pre-wrap">
                          <strong>{t("study.explanation")}: </strong>
                          {currentQuestion.explanation}
                        </p>
                      ) : null}

                      <Button
                        className="mt-1 min-h-10"
                        onClick={handleContinueAfterFeedback}
                      >
                        {lText(locale, "Tiếp tục", "Continue")}
                        <ArrowRight className="size-4" aria-hidden="true" />
                      </Button>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </motion.div>
          </AnimatePresence>
        </div>
      ) : null}
    </FocusModeShell>
  );
}
