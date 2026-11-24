"use client";

import * as React from "react";
import Link from "next/link";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  CheckCircle2,
  RotateCcw,
  Settings2,
  Star,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";
import { useUserPreferences } from "@/lib/preferences";
import {
  createStudySession,
  isSafeDisplayImageUrl,
  recordStudySessionAnswer,
  updateStudySession,
  upsertQuestionProgress,
} from "@/lib/learning/api-client";
import { createSeededRng, fisherYatesShuffle } from "@/lib/learning/shuffle";
import { calculateNextReview } from "@/lib/learning/sm2";
import {
  getExpectedWriteAnswers,
  gradeWriteAnswer,
  isLongOpenAnswer,
} from "@/lib/learning/write-grader";
import type { Question } from "@/types/domain";
import { cn, formatDuration } from "@/lib/utils";
import { FocusModeShell } from "./FocusModeShell";
import { lText } from "./learning-copy";
import {
  StudyEmptyState,
  StudyErrorState,
  StudyLoadingSkeleton,
  useStudySetBundle,
} from "./useStudySetBundle";

interface WriteClientProps {
  setId: string;
}

export function WriteClient({ setId }: WriteClientProps) {
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

  const [selectedChapter, setSelectedChapter] = React.useState("all");
  const [strictMode, setStrictMode] = React.useState(false);
  const [ignoreCase, setIgnoreCase] = React.useState(true);
  const [collapseWhitespace, setCollapseWhitespace] = React.useState(true);
  const [ignorePunctuation, setIgnorePunctuation] = React.useState(true);
  const [ignoreDiacritics, setIgnoreDiacritics] = React.useState(false);

  const [subsetIds, setSubsetIds] = React.useState<string[] | null>(null);
  const [currentIndex, setCurrentIndex] = React.useState(0);
  const [inputValue, setInputValue] = React.useState("");
  const [result, setResult] = React.useState<{
    checked: boolean;
    isCorrect: boolean;
    awaitingSelfAssess: boolean;
    pendingPersist: boolean;
    userAnswer: string;
    acceptedTexts: string[];
  } | null>(null);

  const [correctIds, setCorrectIds] = React.useState<Set<string>>(new Set());
  const [missedIds, setMissedIds] = React.useState<Set<string>>(new Set());
  const [isCompleted, setIsCompleted] = React.useState(false);
  const [completedDurationSeconds, setCompletedDurationSeconds] =
    React.useState(1);

  const inputRef = React.useRef<HTMLTextAreaElement | null>(null);
  const lastCompositionEndRef = React.useRef<number | null>(null);
  const sessionIdRef = React.useRef<string | null>(null);
  const startedAtRef = React.useRef<number>(0);
  const cardStartRef = React.useRef<number>(0);

  const bundleQuestions = bundle?.questions;
  const questions = React.useMemo(() => {
    if (!bundleQuestions) return [];
    let list = bundleQuestions.filter(
      (q) => getExpectedWriteAnswers(q).length > 0,
    );
    if (subsetIds) {
      const set = new Set(subsetIds);
      list = list.filter((q) => set.has(q.id));
    } else if (selectedChapter !== "all") {
      list = list.filter((q) => (q.chapter?.trim() || "") === selectedChapter);
    }
    if (preferences.default_shuffle_questions) {
      return fisherYatesShuffle(
        list,
        createSeededRng(`write:${setId}:${selectedChapter}:${subsetIds?.length ?? 0}`),
      );
    }
    return list;
  }, [
    bundleQuestions,
    preferences.default_shuffle_questions,
    selectedChapter,
    setId,
    subsetIds,
  ]);

  React.useEffect(() => {
    startedAtRef.current = Date.now();
    cardStartRef.current = Date.now();
  }, []);

  const studySetIdLoaded = bundle?.studySet.id ?? null;
  React.useEffect(() => {
    if (!studySetIdLoaded || questions.length === 0 || sessionIdRef.current) return;
    let active = true;
    createStudySession({
      study_set_id: setId,
      mode: "write",
      config: { strictMode, ignoreCase, ignorePunctuation, ignoreDiacritics },
      total_items: questions.length,
    })
      .then((s) => {
        if (active) sessionIdRef.current = s.id;
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [
    ignoreCase,
    ignoreDiacritics,
    ignorePunctuation,
    questions.length,
    setId,
    strictMode,
    studySetIdLoaded,
  ]);

  const currentQuestion: Question | null = questions[currentIndex] ?? null;
  const expectedAnswers = React.useMemo(
    () => (currentQuestion ? getExpectedWriteAnswers(currentQuestion) : []),
    [currentQuestion],
  );
  const isLongAnswer = React.useMemo(
    () => isLongOpenAnswer(expectedAnswers.map((a) => a.answer_text)),
    [expectedAnswers],
  );

  // Persists a question outcome ONCE and returns exact updated counts synchronously (fixes SH-022!).
  const persistWriteResult = React.useCallback(
    (
      question: Question,
      isCorrect: boolean,
      typed: string,
    ): { correctCount: number; missedCount: number } => {
      const responseTimeMs = Math.max(0, Date.now() - cardStartRef.current);
      const prevProgress = bundle?.progressMap.get(question.id);
      const nextSm2 = calculateNextReview(prevProgress, isCorrect);

      const nextCorrect = new Set(correctIds);
      const nextMissed = new Set(missedIds);
      if (isCorrect) {
        nextCorrect.add(question.id);
        nextMissed.delete(question.id);
      } else {
        nextMissed.add(question.id);
        nextCorrect.delete(question.id);
      }
      setCorrectIds(nextCorrect);
      setMissedIds(nextMissed);

      if (sessionIdRef.current) {
        recordStudySessionAnswer(sessionIdRef.current, {
          question_id: question.id,
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

      return {
        correctCount: nextCorrect.size,
        missedCount: nextMissed.size,
      };
    },
    [bundle?.progressMap, correctIds, missedIds, setId, updateLocalProgress],
  );

  const finalizeOrMoveNext = React.useCallback(
    (countsOverride?: { correctCount: number; missedCount: number }) => {
      const finalCorrect = countsOverride?.correctCount ?? correctIds.size;
      const finalMissed = countsOverride?.missedCount ?? missedIds.size;

      if (currentIndex + 1 >= questions.length) {
        playFeedbackSound("complete");
        const durationSeconds = Math.max(
          1,
          Math.round((Date.now() - startedAtRef.current) / 1000),
        );
        setCompletedDurationSeconds(durationSeconds);
        setIsCompleted(true);
        if (sessionIdRef.current) {
          updateStudySession(sessionIdRef.current, {
            status: "completed",
            completed_items: finalCorrect + finalMissed,
            correct_items: finalCorrect,
            duration_seconds: durationSeconds,
          }).catch(() => {});
        }
      } else {
        setCurrentIndex((i) => i + 1);
        setInputValue("");
        setResult(null);
        cardStartRef.current = Date.now();
        setTimeout(() => inputRef.current?.focus(), 40);
      }
    },
    [
      correctIds.size,
      currentIndex,
      missedIds.size,
      playFeedbackSound,
      questions.length,
    ],
  );

  const handleCheck = React.useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      if (!currentQuestion || result?.checked) return;
      const trimmed = inputValue.trim();
      if (!trimmed) return;

      const graded = gradeWriteAnswer(trimmed, expectedAnswers, {
        strict: strictMode,
        ignoreCase,
        collapseWhitespace,
        ignorePunctuation,
        ignoreDiacritics,
      });

      const acceptedTexts = expectedAnswers.map((a) => a.answer_text);

      // Long open-ended answer: await explicit self-assessment before persisting
      if (!graded.isCorrect && isLongAnswer) {
        setResult({
          checked: true,
          isCorrect: false,
          awaitingSelfAssess: true,
          pendingPersist: true,
          userAnswer: trimmed,
          acceptedTexts,
        });
        return;
      }

      // If graded wrong with a non-empty typed answer, defer DB persistence until user either
      // clicks Next (commits false once) OR clicks "Override: I was right" (commits true once).
      // Eliminates double-recording wrong+right and SM-2 corruption (SH-022)!
      if (!graded.isCorrect) {
        playFeedbackSound("wrong");
        setResult({
          checked: true,
          isCorrect: false,
          awaitingSelfAssess: false,
          pendingPersist: true,
          userAnswer: trimmed,
          acceptedTexts,
        });
        return;
      }

      playFeedbackSound("correct");
      setResult({
        checked: true,
        isCorrect: true,
        awaitingSelfAssess: false,
        pendingPersist: false,
        userAnswer: trimmed,
        acceptedTexts,
      });
      persistWriteResult(currentQuestion, true, trimmed);
    },
    [
      collapseWhitespace,
      currentQuestion,
      expectedAnswers,
      ignoreCase,
      ignoreDiacritics,
      ignorePunctuation,
      inputValue,
      isLongAnswer,
      persistWriteResult,
      playFeedbackSound,
      result?.checked,
      strictMode,
    ],
  );

  const handleAdvance = React.useCallback(() => {
    let counts: { correctCount: number; missedCount: number } | undefined;
    if (currentQuestion && result?.pendingPersist) {
      counts = persistWriteResult(
        currentQuestion,
        result.isCorrect,
        result.userAnswer,
      );
    }
    finalizeOrMoveNext(counts);
  }, [currentQuestion, finalizeOrMoveNext, persistWriteResult, result]);

  const handleSelfAssess = React.useCallback(
    (isRight: boolean) => {
      if (!currentQuestion || !result) return;
      playFeedbackSound(isRight ? "correct" : "wrong");
      const counts = persistWriteResult(
        currentQuestion,
        isRight,
        result.userAnswer,
      );
      setResult({
        ...result,
        isCorrect: isRight,
        awaitingSelfAssess: false,
        pendingPersist: false,
      });
      finalizeOrMoveNext(counts);
    },
    [
      currentQuestion,
      finalizeOrMoveNext,
      persistWriteResult,
      playFeedbackSound,
      result,
    ],
  );

  const restartWrite = React.useCallback((nextSubset: string[] | null = null) => {
    setSubsetIds(nextSubset);
    setCurrentIndex(0);
    setInputValue("");
    setResult(null);
    setCorrectIds(new Set());
    setMissedIds(new Set());
    setIsCompleted(false);
    startedAtRef.current = Date.now();
    cardStartRef.current = Date.now();
    sessionIdRef.current = null;
    setTimeout(() => inputRef.current?.focus(), 40);
  }, []);

  if (isLoading) {
    return (
      <FocusModeShell backHref={`/sets/${setId}`} title={t("study.write")}>
        <StudyLoadingSkeleton />
      </FocusModeShell>
    );
  }

  if (isError || !bundle) {
    return (
      <FocusModeShell backHref={`/sets/${setId}`} title={t("study.write")}>
        <StudyErrorState
          message={error instanceof Error ? error.message : undefined}
          onRetry={() => void refetch()}
          backHref={`/sets/${setId}`}
        />
      </FocusModeShell>
    );
  }

  return (
    <FocusModeShell
      backHref={`/sets/${setId}`}
      title={bundle.studySet.title}
      subtitle={lText(locale, "Chế độ Gõ đáp án", "Write Mode")}
      progressCurrent={questions.length > 0 ? Math.min(currentIndex + 1, questions.length) : 0}
      progressTotal={questions.length}
      headerRight={
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="min-h-9">
              <Settings2 className="size-4" aria-hidden="true" />
              <span>{lText(locale, "Quy tắc chấm", "Grading")}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 space-y-3 text-sm">
            <p className="font-semibold">
              {lText(locale, "Quy tắc so khớp đáp án", "Answer Matching Rules")}
            </p>
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="wr-strict" className="cursor-pointer">
                {lText(locale, "Chế độ chặt chẽ (chính xác từng ký tự)", "Strict exact match")}
              </Label>
              <Switch
                id="wr-strict"
                checked={strictMode}
                onCheckedChange={setStrictMode}
              />
            </div>
            {!strictMode ? (
              <div className="space-y-2.5 border-t border-border pt-2.5">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="wr-case" className="cursor-pointer text-xs">
                    {lText(locale, "Bỏ qua chữ hoa/thường", "Ignore letter case")}
                  </Label>
                  <Switch
                    id="wr-case"
                    checked={ignoreCase}
                    onCheckedChange={setIgnoreCase}
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="wr-space" className="cursor-pointer text-xs">
                    {lText(locale, "Gộp khoảng trắng thừa", "Collapse whitespace")}
                  </Label>
                  <Switch
                    id="wr-space"
                    checked={collapseWhitespace}
                    onCheckedChange={setCollapseWhitespace}
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="wr-punct" className="cursor-pointer text-xs">
                    {lText(locale, "Bỏ qua dấu câu", "Ignore punctuation")}
                  </Label>
                  <Switch
                    id="wr-punct"
                    checked={ignorePunctuation}
                    onCheckedChange={setIgnorePunctuation}
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="wr-diacritics" className="cursor-pointer text-xs">
                    {lText(locale, "Bỏ qua dấu tiếng Việt", "Ignore diacritics")}
                  </Label>
                  <Switch
                    id="wr-diacritics"
                    checked={ignoreDiacritics}
                    onCheckedChange={setIgnoreDiacritics}
                  />
                </div>
              </div>
            ) : null}
          </PopoverContent>
        </Popover>
      }
    >
      {/* Filter bar */}
      <div className="mx-auto mb-5 flex w-full max-w-3xl flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs">
          <Badge variant="success" className="tabular-nums">
            <CheckCircle2 className="size-3" aria-hidden="true" />
            {t("study.correct")}: {correctIds.size}
          </Badge>
          <Badge variant="destructive" className="tabular-nums">
            <XCircle className="size-3" aria-hidden="true" />
            {t("study.incorrect")}: {missedIds.size}
          </Badge>
          <Badge variant="outline">
            {strictMode
              ? lText(locale, "Chấm chặt chẽ", "Strict")
              : lText(locale, "Chấm linh hoạt", "Flexible")}
          </Badge>
        </div>

        {bundle.chapters.length > 0 ? (
          <Select
            value={selectedChapter}
            onValueChange={(val) => {
              setSelectedChapter(val);
              restartWrite(null);
            }}
          >
            <SelectTrigger className="h-8 w-[180px] text-xs">
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
      </div>

      {questions.length === 0 ? (
        <StudyEmptyState
          setId={setId}
          onResetFilters={
            selectedChapter !== "all" || subsetIds
              ? () => {
                  setSelectedChapter("all");
                  restartWrite(null);
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
                  `Hoàn thành ${questions.length} câu trong ${formatDuration(completedDurationSeconds)}.`,
                  `Completed ${questions.length} items in ${formatDuration(completedDurationSeconds)}.`,
                )}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-border bg-success-subtle/60 p-4">
                <p className="text-xs text-success-subtle-foreground">
                  {t("study.correct")}
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums">
                  {correctIds.size}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-destructive-subtle/60 p-4">
                <p className="text-xs text-destructive-subtle-foreground">
                  {t("study.incorrect")}
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums">
                  {missedIds.size}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              {missedIds.size > 0 ? (
                <Button onClick={() => restartWrite(Array.from(missedIds))}>
                  <RotateCcw className="size-4" aria-hidden="true" />
                  {lText(
                    locale,
                    `Gõ lại ${missedIds.size} câu sai`,
                    `Retry ${missedIds.size} missed`,
                  )}
                </Button>
              ) : null}
              <Button variant="outline" onClick={() => restartWrite(null)}>
                {t("study.studyAgain")}
              </Button>
              <Button variant="secondary" asChild>
                <Link href={`/sets/${setId}`}>
                  {lText(locale, "Về học phần", "Back to Set")}
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : currentQuestion ? (
        <div className="mx-auto w-full max-w-3xl space-y-4">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentQuestion.id}
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
                        {currentIndex + 1} / {questions.length}
                      </Badge>
                      {currentQuestion.chapter ? (
                        <Badge variant="secondary">{currentQuestion.chapter}</Badge>
                      ) : null}
                      {isLongAnswer ? (
                        <Badge variant="accent">
                          {lText(locale, "Hỗ trợ tự đánh giá", "Self-assessment supported")}
                        </Badge>
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
                        className="max-h-56 rounded-lg border border-border object-contain"
                      />
                    ) : null}
                  </div>

                  <form onSubmit={handleCheck} className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="write-mode-input">
                        {t("study.yourAnswer")}
                      </Label>
                      <p
                        id="write-mode-hint"
                        className="text-xs text-muted-foreground"
                      >
                        {lText(
                          locale,
                          "Nhấn Enter để kiểm tra đáp án (Shift + Enter để xuống dòng).",
                          "Press Enter to check answer (Shift + Enter for new line).",
                        )}
                      </p>
                      <Textarea
                        ref={inputRef}
                        id="write-mode-input"
                        aria-describedby="write-mode-hint"
                        rows={isLongAnswer ? 3 : 2}
                        readOnly={Boolean(result?.checked)}
                        value={inputValue}
                        onChange={(e) => {
                          if (!result?.checked) setInputValue(e.target.value);
                        }}
                        onCompositionEnd={(e) => {
                          lastCompositionEndRef.current = e.timeStamp;
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            // IME-safe Enter check (Vietnamese Telex/VNI + Safari WebKit bug 165004)
                            if (
                              e.nativeEvent.isComposing ||
                              e.nativeEvent.keyCode === 229
                            ) {
                              return;
                            }
                            if (
                              lastCompositionEndRef.current !== null &&
                              Math.abs(e.timeStamp - lastCompositionEndRef.current) < 50
                            ) {
                              return;
                            }
                            if (result?.checked && !result.awaitingSelfAssess) {
                              handleAdvance();
                            } else if (!result?.checked) {
                              handleCheck();
                            }
                          }
                        }}
                        placeholder={lText(
                          locale,
                          "Nhập câu trả lời của bạn tại đây...",
                          "Type your answer here...",
                        )}
                      />
                    </div>

                    {!result?.checked ? (
                      <div className="flex items-center justify-between gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            const acceptedTexts = expectedAnswers.map(
                              (a) => a.answer_text,
                            );
                            playFeedbackSound("wrong");
                            setResult({
                              checked: true,
                              isCorrect: false,
                              awaitingSelfAssess: false,
                              pendingPersist: false,
                              userAnswer: "",
                              acceptedTexts,
                            });
                            persistWriteResult(currentQuestion, false, "");
                          }}
                        >
                          {lText(locale, "Không biết / Xem đáp án", "Don't know / Show answer")}
                        </Button>
                        <Button
                          type="submit"
                          className="min-h-11"
                          disabled={!inputValue.trim()}
                        >
                          {t("study.checkAnswer")}
                        </Button>
                      </div>
                    ) : null}
                  </form>

                  {/* Grading Result & Optional Self-Assessment */}
                  {result?.checked ? (
                    <div
                      role="status"
                      aria-live="polite"
                      className={cn(
                        "rounded-lg border p-4 space-y-3",
                        result.isCorrect
                          ? "border-success/40 bg-success-subtle text-success-subtle-foreground"
                          : result.awaitingSelfAssess
                            ? "border-warning/40 bg-warning-subtle text-warning-subtle-foreground"
                            : "border-destructive/40 bg-destructive-subtle text-destructive-subtle-foreground",
                      )}
                    >
                      <div className="flex items-center gap-2 text-sm font-semibold">
                        {result.isCorrect ? (
                          <>
                            <CheckCircle2 className="size-4" aria-hidden="true" />
                            <span>{t("study.correct")}</span>
                          </>
                        ) : result.awaitingSelfAssess ? (
                          <span>
                            {lText(
                              locale,
                              "So sánh với đáp án gốc và tự đánh giá:",
                              "Compare with the original answer and self-assess:",
                            )}
                          </span>
                        ) : (
                          <>
                            <XCircle className="size-4" aria-hidden="true" />
                            <span>{t("study.incorrect")}</span>
                          </>
                        )}
                      </div>

                      <div className="space-y-1.5 text-sm text-foreground">
                        {result.userAnswer ? (
                          <p className="whitespace-pre-wrap">
                            <strong>{t("study.yourAnswer")}: </strong>
                            {result.userAnswer}
                          </p>
                        ) : null}
                        <p className="whitespace-pre-wrap">
                          <strong>{t("study.correctAnswer")}: </strong>
                          {result.acceptedTexts.join(" / ")}
                        </p>
                        {currentQuestion.explanation ? (
                          <p className="pt-1 text-muted-foreground whitespace-pre-wrap">
                            <strong className="text-foreground">
                              {t("study.explanation")}:{" "}
                            </strong>
                            {currentQuestion.explanation}
                          </p>
                        ) : null}
                      </div>

                      {result.awaitingSelfAssess ? (
                        <div className="flex flex-wrap gap-2 pt-1">
                          <Button
                            variant="success"
                            className="min-h-10"
                            onClick={() => handleSelfAssess(true)}
                          >
                            <CheckCircle2 className="size-4" aria-hidden="true" />
                            {lText(locale, "Tôi trả lời đúng", "I was right")}
                          </Button>
                          <Button
                            variant="outline"
                            className="min-h-10"
                            onClick={() => handleSelfAssess(false)}
                          >
                            <XCircle className="size-4" aria-hidden="true" />
                            {lText(locale, "Cần ôn lại", "Need review")}
                          </Button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <Button className="min-h-10" onClick={handleAdvance}>
                            {currentIndex + 1 >= questions.length
                              ? t("common.finish")
                              : t("study.nextQuestion")}
                            <ArrowRight className="size-4" aria-hidden="true" />
                          </Button>
                          {!result.isCorrect && result.userAnswer ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleSelfAssess(true)}
                            >
                              {lText(
                                locale,
                                "Ghi nhận: Tôi trả lời đúng",
                                "Override: I was right",
                              )}
                            </Button>
                          ) : null}
                        </div>
                      )}
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
