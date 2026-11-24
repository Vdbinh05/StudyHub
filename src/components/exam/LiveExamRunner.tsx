"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Cloud,
  CloudOff,
  Flag,
  Grid2X2,
  Loader2,
  Send,
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
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { FocusModeShell } from "@/components/learning/FocusModeShell";
import { lText } from "@/components/learning/learning-copy";
import {
  StudyErrorState,
  StudyLoadingSkeleton,
} from "@/components/learning/useStudySetBundle";
import { useI18n } from "@/lib/i18n";
import {
  fetchExamAttempt,
  isEditableEventTarget,
  isSafeDisplayImageUrl,
  saveExamAnswers,
  submitExamAttempt,
  type ExamAnswerSaveItem,
  type ExamAttemptPayload,
} from "@/lib/learning/api-client";
import {
  calculateRemainingMs,
  formatCountdownMs,
} from "@/lib/learning/exam-scoring";
import { indexToOptionLabel } from "@/lib/learning/shuffle";
import { cn } from "@/lib/utils";
import {
  ExamNavigatorGrid,
  type NavigatorQuestionItem,
} from "./ExamNavigatorGrid";

interface LocalAnswerRecord {
  selectedOptionIds: string[];
  typedAnswer: string;
  isFlagged: boolean;
}

interface LiveExamRunnerProps {
  setId: string;
  attemptId: string;
  initialPayload?: ExamAttemptPayload | null;
}

const DRAFT_KEY_PREFIX = "studyhub-exam-draft-";

function readLocalDraft(
  attemptId: string,
): Record<string, LocalAnswerRecord> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`${DRAFT_KEY_PREFIX}${attemptId}`);
    if (!raw) return null;
    return JSON.parse(raw) as Record<string, LocalAnswerRecord>;
  } catch {
    return null;
  }
}

function writeLocalDraft(
  attemptId: string,
  map: Record<string, LocalAnswerRecord>,
): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      `${DRAFT_KEY_PREFIX}${attemptId}`,
      JSON.stringify(map),
    );
  } catch {
    // Ignore quota errors
  }
}

function clearLocalDraft(attemptId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(`${DRAFT_KEY_PREFIX}${attemptId}`);
  } catch {
    // Ignore
  }
}

export function LiveExamRunner({
  setId,
  attemptId,
  initialPayload,
}: LiveExamRunnerProps) {
  const router = useRouter();
  const { locale, t } = useI18n();

  const examQuery = useQuery<ExamAttemptPayload>({
    queryKey: ["exam-attempt-live", attemptId],
    queryFn: () => fetchExamAttempt(attemptId),
    initialData: initialPayload ?? undefined,
    staleTime: 0,
    refetchOnWindowFocus: false,
  });

  const payload = examQuery.data;
  const attempt = payload?.attempt;
  const questions = React.useMemo(
    () =>
      [...(payload?.questions ?? [])].sort((a, b) => a.position - b.position),
    [payload?.questions],
  );

  const [currentIndex, setCurrentIndex] = React.useState(0);
  const [answerMap, setAnswerMap] = React.useState<
    Record<string, LocalAnswerRecord>
  >({});
  const [isOnline, setIsOnline] = React.useState<boolean>(() =>
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const [syncState, setSyncState] = React.useState<
    "saved" | "saving" | "pending_offline" | "error"
  >("saved");
  const [remainingMs, setRemainingMs] = React.useState<number | null>(null);
  const [confirmSubmitOpen, setConfirmSubmitOpen] = React.useState(false);
  const [navSheetOpen, setNavSheetOpen] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const dirtyQueueRef = React.useRef<Map<string, ExamAnswerSaveItem>>(new Map());
  const debounceTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const serverClockOffsetRef = React.useRef<number>(0);
  const submittingRef = React.useRef<boolean>(false);
  const warnedOneMinuteRef = React.useRef<boolean>(false);
  const initializedAnswersRef = React.useRef<boolean>(false);

  // Redirect to results immediately if attempt is already submitted or expired
  React.useEffect(() => {
    if (attempt && attempt.status !== "in_progress") {
      clearLocalDraft(attemptId);
      router.replace(`/sets/${setId}/results/${attemptId}`);
    }
  }, [attempt, attemptId, router, setId]);

  // Hydrate server answers + merge any unsynced local draft + compute wall-clock offset
  React.useEffect(() => {
    if (!payload || initializedAnswersRef.current) return;
    initializedAnswersRef.current = true;

    if (payload.server_now) {
      const serverMs = Date.parse(payload.server_now);
      if (!Number.isNaN(serverMs)) {
        serverClockOffsetRef.current = serverMs - Date.now();
      }
    } else if (
      typeof payload.remaining_seconds === "number" &&
      payload.attempt.expires_at
    ) {
      const expiresMs = Date.parse(payload.attempt.expires_at);
      if (!Number.isNaN(expiresMs)) {
        const expectedServerNow = expiresMs - payload.remaining_seconds * 1000;
        serverClockOffsetRef.current = expectedServerNow - Date.now();
      }
    }

    const hydrated: Record<string, LocalAnswerRecord> = {};
    for (const ans of payload.answers) {
      hydrated[ans.attempt_question_id] = {
        selectedOptionIds: ans.selected_option_ids ?? [],
        typedAnswer: ans.typed_answer ?? "",
        isFlagged: Boolean(ans.is_flagged),
      };
    }

    // Merge local offline draft if present
    const draft = readLocalDraft(attemptId);
    if (draft) {
      for (const [aqId, rec] of Object.entries(draft)) {
        hydrated[aqId] = rec;
        dirtyQueueRef.current.set(aqId, {
          attempt_question_id: aqId,
          selected_option_ids: rec.selectedOptionIds,
          typed_answer: rec.typedAnswer || null,
          is_flagged: rec.isFlagged,
        });
      }
    }

    setAnswerMap(hydrated);
    setRemainingMs(
      calculateRemainingMs(
        payload.attempt.expires_at,
        Date.now(),
        serverClockOffsetRef.current,
      ),
    );
  }, [attemptId, payload]);

  // Flush autosave queue to PUT /api/exams/[attemptId]/answers
  const flushDirtyQueue = React.useCallback(async () => {
    if (dirtyQueueRef.current.size === 0) {
      setSyncState("saved");
      return;
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setSyncState("pending_offline");
      return;
    }

    const batch = Array.from(dirtyQueueRef.current.values());
    setSyncState("saving");
    try {
      await saveExamAnswers(attemptId, batch);
      // Clear only items that weren't modified again mid-flight
      for (const item of batch) {
        const current = dirtyQueueRef.current.get(item.attempt_question_id);
        if (current === item) {
          dirtyQueueRef.current.delete(item.attempt_question_id);
        }
      }
      setSyncState(dirtyQueueRef.current.size === 0 ? "saved" : "saving");
    } catch {
      setSyncState(
        typeof navigator !== "undefined" && !navigator.onLine
          ? "pending_offline"
          : "error",
      );
    }
  }, [attemptId]);

  const scheduleAutosave = React.useCallback(
    (item: ExamAnswerSaveItem, nextFullMap: Record<string, LocalAnswerRecord>) => {
      dirtyQueueRef.current.set(item.attempt_question_id, item);
      writeLocalDraft(attemptId, nextFullMap);

      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        setSyncState("pending_offline");
        return;
      }

      setSyncState("saving");
      debounceTimerRef.current = setTimeout(() => {
        void flushDirtyQueue();
      }, 400);
    },
    [attemptId, flushDirtyQueue],
  );

  // Monitor online / offline status and auto-resync when connection returns!
  React.useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      toast.success(
        lText(
          locale,
          "Đã kết nối lại mạng — đang đồng bộ đáp án...",
          "Back online — syncing saved answers...",
        ),
      );
      void flushDirtyQueue();
    };
    const handleOffline = () => {
      setIsOnline(false);
      setSyncState("pending_offline");
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [flushDirtyQueue, locale]);

  // Idempotent Exam Submit (manual or auto-submit on expiry)
  const executeSubmit = React.useCallback(
    async (reason: "manual" | "expired") => {
      if (submittingRef.current) return;
      submittingRef.current = true;
      setIsSubmitting(true);
      setConfirmSubmitOpen(false);

      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

      try {
        // Flush any remaining unsynced answers first if online
        if (dirtyQueueRef.current.size > 0 && (typeof navigator === "undefined" || navigator.onLine)) {
          await saveExamAnswers(
            attemptId,
            Array.from(dirtyQueueRef.current.values()),
          ).catch(() => {});
          dirtyQueueRef.current.clear();
        }

        await submitExamAttempt(attemptId);
        clearLocalDraft(attemptId);

        if (reason === "expired") {
          toast.info(
            lText(
              locale,
              "Hết giờ làm bài — hệ thống đã tự động nộp và chấm điểm.",
              "Time expired — your exam has been automatically submitted and graded.",
            ),
          );
        } else {
          toast.success(
            lText(locale, "Đã nộp bài thành công!", "Exam submitted successfully!"),
          );
        }

        router.replace(`/sets/${setId}/results/${attemptId}`);
      } catch (err) {
        submittingRef.current = false;
        setIsSubmitting(false);
        toast.error(
          err instanceof Error
            ? err.message
            : lText(
                locale,
                "Không thể nộp bài. Kiểm tra kết nối mạng và thử lại.",
                "Could not submit exam. Please check your connection and retry.",
              ),
        );
      }
    },
    [attemptId, locale, router, setId],
  );

  // Wall-clock countdown timer strictly computed from server expires_at
  React.useEffect(() => {
    if (!attempt || attempt.status !== "in_progress" || !attempt.expires_at) {
      return;
    }

    const tick = () => {
      const rem = calculateRemainingMs(
        attempt.expires_at,
        Date.now(),
        serverClockOffsetRef.current,
      );
      setRemainingMs(rem);

      if (rem !== null && rem <= 60_000 && rem > 0 && !warnedOneMinuteRef.current) {
        warnedOneMinuteRef.current = true;
        toast.warning(
          lText(
            locale,
            "Còn dưới 1 phút! Hệ thống sẽ tự động nộp bài khi hết giờ.",
            "Less than 1 minute remaining! Exam will auto-submit at 00:00.",
          ),
        );
      }

      if (rem !== null && rem <= 0 && !submittingRef.current) {
        void executeSubmit("expired");
      }
    };

    tick();
    const interval = setInterval(tick, 500);
    return () => clearInterval(interval);
  }, [attempt, executeSubmit, locale]);

  const currentQuestion = questions[currentIndex] ?? null;
  const currentRecord: LocalAnswerRecord = currentQuestion
    ? answerMap[currentQuestion.id] ?? {
        selectedOptionIds: [],
        typedAnswer: "",
        isFlagged: false,
      }
    : { selectedOptionIds: [], typedAnswer: "", isFlagged: false };

  const updateCurrentRecord = React.useCallback(
    (updater: (prev: LocalAnswerRecord) => LocalAnswerRecord) => {
      if (!currentQuestion || submittingRef.current) return;
      setAnswerMap((prevMap) => {
        const prevRec = prevMap[currentQuestion.id] ?? {
          selectedOptionIds: [],
          typedAnswer: "",
          isFlagged: false,
        };
        const nextRec = updater(prevRec);
        const nextMap = { ...prevMap, [currentQuestion.id]: nextRec };
        scheduleAutosave(
          {
            attempt_question_id: currentQuestion.id,
            selected_option_ids: nextRec.selectedOptionIds,
            typed_answer: nextRec.typedAnswer.trim() ? nextRec.typedAnswer : null,
            is_flagged: nextRec.isFlagged,
          },
          nextMap,
        );
        return nextMap;
      });
    },
    [currentQuestion, scheduleAutosave],
  );

  const handleSelectOption = React.useCallback(
    (optionId: string) => {
      if (!currentQuestion) return;
      const isMulti = currentQuestion.question_type === "multiple_choice";
      updateCurrentRecord((prev) => {
        if (isMulti) {
          const exists = prev.selectedOptionIds.includes(optionId);
          return {
            ...prev,
            selectedOptionIds: exists
              ? prev.selectedOptionIds.filter((id) => id !== optionId)
              : [...prev.selectedOptionIds, optionId],
          };
        }
        return {
          ...prev,
          selectedOptionIds: [optionId],
        };
      });
    },
    [currentQuestion, updateCurrentRecord],
  );

  const handleToggleFlag = React.useCallback(() => {
    updateCurrentRecord((prev) => ({ ...prev, isFlagged: !prev.isFlagged }));
  }, [updateCurrentRecord]);

  // Keyboard shortcuts during live exam (disabled inside inputs/textareas)
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (confirmSubmitOpen || !currentQuestion || submittingRef.current) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableEventTarget(event.target)) return;

      if (event.key === "ArrowLeft" && currentIndex > 0) {
        event.preventDefault();
        setCurrentIndex((i) => i - 1);
      } else if (
        event.key === "ArrowRight" &&
        currentIndex + 1 < questions.length
      ) {
        event.preventDefault();
        setCurrentIndex((i) => i + 1);
      } else if (event.key === "f" || event.key === "F") {
        event.preventDefault();
        handleToggleFlag();
      } else if (currentQuestion.options_snapshot.length > 0) {
        let idx = -1;
        if (/^[1-6]$/.test(event.key)) idx = Number(event.key) - 1;
        else if (/^[a-fA-F]$/.test(event.key)) {
          idx = event.key.toUpperCase().charCodeAt(0) - 65;
        }
        if (idx >= 0 && idx < currentQuestion.options_snapshot.length) {
          event.preventDefault();
          handleSelectOption(currentQuestion.options_snapshot[idx].id);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    confirmSubmitOpen,
    currentIndex,
    currentQuestion,
    handleSelectOption,
    handleToggleFlag,
    questions.length,
  ]);

  const navigatorItems = React.useMemo<NavigatorQuestionItem[]>(() => {
    return questions.map((q) => {
      const rec = answerMap[q.id];
      const isAnswered = Boolean(
        rec &&
          (rec.selectedOptionIds.length > 0 || rec.typedAnswer.trim().length > 0),
      );
      return {
        attemptQuestionId: q.id,
        position: q.position,
        isAnswered,
        isFlagged: Boolean(rec?.isFlagged),
      };
    });
  }, [answerMap, questions]);

  const answeredCount = navigatorItems.filter((i) => i.isAnswered).length;
  const flaggedCount = navigatorItems.filter((i) => i.isFlagged).length;
  const unansweredCount = navigatorItems.length - answeredCount;

  if (examQuery.isLoading) {
    return (
      <FocusModeShell backHref={`/sets/${setId}`} title={t("exam.title")}>
        <StudyLoadingSkeleton />
      </FocusModeShell>
    );
  }

  if (examQuery.isError || !attempt || !currentQuestion) {
    return (
      <FocusModeShell backHref={`/sets/${setId}`} title={t("exam.title")}>
        <StudyErrorState
          message={
            examQuery.error instanceof Error
              ? examQuery.error.message
              : undefined
          }
          onRetry={() => void examQuery.refetch()}
          backHref={`/sets/${setId}/test`}
        />
      </FocusModeShell>
    );
  }

  const isLowTime = remainingMs !== null && remainingMs <= 5 * 60_000;
  const isCriticalTime = remainingMs !== null && remainingMs <= 60_000;

  return (
    <FocusModeShell
      backHref={`/sets/${setId}`}
      title={attempt.study_set_title_snapshot}
      subtitle={lText(
        locale,
        "Phòng thi thử — Tự động lưu liên tục",
        "Live Mock Exam — Continuous Autosave",
      )}
      progressCurrent={answeredCount}
      progressTotal={questions.length}
      headerRight={
        <div className="flex items-center gap-2">
          {/* Sync status pill */}
          <span
            role="status"
            aria-live="polite"
            className={cn(
              "hidden sm:inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium",
              syncState === "saved" &&
                "bg-success-subtle text-success-subtle-foreground",
              syncState === "saving" && "bg-secondary text-muted-foreground",
              (syncState === "pending_offline" || syncState === "error") &&
                "bg-warning-subtle text-warning-subtle-foreground",
            )}
          >
            {syncState === "saving" ? (
              <>
                <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                {t("common.saving")}
              </>
            ) : syncState === "pending_offline" ? (
              <>
                <CloudOff className="size-3" aria-hidden="true" />
                {lText(locale, "Lưu tạm ngoại tuyến", "Saved offline")}
              </>
            ) : syncState === "error" ? (
              <>
                <AlertTriangle className="size-3" aria-hidden="true" />
                {lText(locale, "Chờ đồng bộ", "Pending sync")}
              </>
            ) : (
              <>
                <Cloud className="size-3" aria-hidden="true" />
                {lText(locale, "Đã lưu", "Saved")}
              </>
            )}
          </span>

          {/* Server-anchored Wall-Clock Countdown Timer */}
          {remainingMs !== null ? (
            <div
              role="timer"
              aria-label={t("exam.remainingTime")}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 font-mono text-sm font-semibold tabular-nums",
                isCriticalTime
                  ? "border-destructive bg-destructive-subtle text-destructive-subtle-foreground"
                  : isLowTime
                    ? "border-warning bg-warning-subtle text-warning-subtle-foreground"
                    : "border-border bg-card text-foreground",
              )}
            >
              <Clock className="size-4" aria-hidden="true" />
              <span>{formatCountdownMs(remainingMs)}</span>
            </div>
          ) : null}

          {/* Mobile Navigator Sheet trigger */}
          <Sheet open={navSheetOpen} onOpenChange={setNavSheetOpen}>
            <SheetTrigger asChild>
              <Button variant="outline" size="sm" className="min-h-9 lg:hidden">
                <Grid2X2 className="size-4" aria-hidden="true" />
                <span className="sr-only sm:not-sr-only">
                  {t("exam.questionNavigator")}
                </span>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-80 overflow-y-auto">
              <SheetHeader>
                <SheetTitle>{t("exam.questionNavigator")}</SheetTitle>
              </SheetHeader>
              <div className="px-4 pb-6">
                <ExamNavigatorGrid
                  items={navigatorItems}
                  currentIndex={currentIndex}
                  onSelectIndex={(idx) => {
                    setCurrentIndex(idx);
                    setNavSheetOpen(false);
                  }}
                  onRequestSubmit={() => {
                    setNavSheetOpen(false);
                    setConfirmSubmitOpen(true);
                  }}
                  isSubmitting={isSubmitting}
                />
              </div>
            </SheetContent>
          </Sheet>
        </div>
      }
    >
      {/* Offline banner */}
      {!isOnline ? (
        <div
          role="alert"
          className="mb-4 flex items-center gap-2 rounded-lg border border-warning/50 bg-warning-subtle px-4 py-3 text-sm text-warning-subtle-foreground"
        >
          <CloudOff className="size-4 shrink-0" aria-hidden="true" />
          <span>
            {lText(
              locale,
              "Mất kết nối mạng — bài làm của bạn đang được lưu cục bộ và sẽ tự động đồng bộ ngay khi có mạng trở lại.",
              "You are offline — your answers are saved locally and will automatically sync once reconnected.",
            )}
          </span>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px] lg:items-start">
        {/* Active Exam Question Card — ZERO answer disclosure */}
        <div className="mx-auto w-full max-w-3xl space-y-4">
          <Card>
            <CardContent className="space-y-5 py-6">
              <div className="flex items-start justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="tabular-nums">
                    {lText(locale, "Câu", "Question")} {currentIndex + 1} /{" "}
                    {questions.length}
                  </Badge>
                  {currentQuestion.chapter_snapshot ? (
                    <Badge variant="secondary">
                      {currentQuestion.chapter_snapshot}
                    </Badge>
                  ) : null}
                  {currentQuestion.question_type === "multiple_choice" ? (
                    <Badge variant="accent">
                      {lText(locale, "Chọn nhiều đáp án", "Multiple choice")}
                    </Badge>
                  ) : null}
                </div>

                <Button
                  variant={currentRecord.isFlagged ? "secondary" : "ghost"}
                  size="sm"
                  className={cn(
                    "min-h-9 shrink-0",
                    currentRecord.isFlagged &&
                      "bg-warning-subtle text-warning-subtle-foreground hover:bg-warning-subtle/80",
                  )}
                  aria-pressed={currentRecord.isFlagged}
                  onClick={handleToggleFlag}
                >
                  <Flag
                    className={cn(
                      "size-4",
                      currentRecord.isFlagged && "fill-current",
                    )}
                    aria-hidden="true"
                  />
                  <span>
                    {currentRecord.isFlagged
                      ? t("exam.unflagQuestion")
                      : t("exam.flagQuestion")}
                  </span>
                </Button>
              </div>

              <div className="space-y-3">
                <h2 className="whitespace-pre-wrap text-lg font-medium leading-relaxed text-foreground">
                  {currentQuestion.prompt_snapshot}
                </h2>
                {isSafeDisplayImageUrl(
                  currentQuestion.prompt_image_url_snapshot,
                ) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={currentQuestion.prompt_image_url_snapshot}
                    alt={lText(locale, "Hình ảnh câu hỏi", "Question illustration")}
                    className="max-h-64 rounded-lg border border-border object-contain"
                  />
                ) : null}
              </div>

              {currentQuestion.question_type === "short_answer" ||
              currentQuestion.options_snapshot.length === 0 ? (
                <div className="space-y-2">
                  <Label htmlFor="exam-short-answer">
                    {t("study.yourAnswer")}
                  </Label>
                  <Textarea
                    id="exam-short-answer"
                    rows={3}
                    value={currentRecord.typedAnswer}
                    onChange={(e) => {
                      const val = e.target.value;
                      updateCurrentRecord((prev) => ({
                        ...prev,
                        typedAnswer: val,
                      }));
                    }}
                    placeholder={lText(
                      locale,
                      "Nhập câu trả lời của bạn...",
                      "Type your answer...",
                    )}
                  />
                </div>
              ) : (
                <div
                  role={
                    currentQuestion.question_type === "multiple_choice"
                      ? "group"
                      : "radiogroup"
                  }
                  aria-label={lText(locale, "Các phương án", "Answer choices")}
                  className="space-y-2.5"
                >
                  {currentQuestion.options_snapshot.map((opt, optIdx) => {
                    const isSelected = currentRecord.selectedOptionIds.includes(
                      opt.id,
                    );
                    const displayLetter = indexToOptionLabel(optIdx);

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
                        onClick={() => handleSelectOption(opt.id)}
                        className={cn(
                          "flex min-h-12 w-full items-start gap-3 rounded-lg border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                          isSelected
                            ? "border-primary bg-accent text-accent-foreground"
                            : "border-border bg-card text-foreground hover:bg-secondary/60",
                        )}
                      >
                        <span
                          className={cn(
                            "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border text-xs font-semibold",
                            isSelected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-secondary text-secondary-foreground",
                          )}
                        >
                          {displayLetter}
                        </span>
                        <span className="flex-1 whitespace-pre-wrap text-sm sm:text-base leading-relaxed">
                          {opt.content}
                        </span>
                        {isSelected ? (
                          <CheckCircle2
                            className="mt-0.5 size-4 shrink-0 text-primary"
                            aria-hidden="true"
                          />
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Bottom Navigation Bar */}
          <div className="flex items-center justify-between gap-3">
            <Button
              variant="outline"
              className="min-h-11"
              disabled={currentIndex === 0}
              onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
              {t("study.previousQuestion")}
            </Button>

            {currentIndex + 1 < questions.length ? (
              <Button
                className="min-h-11"
                onClick={() =>
                  setCurrentIndex((i) => Math.min(questions.length - 1, i + 1))
                }
              >
                {t("study.nextQuestion")}
                <ChevronRight className="size-4" aria-hidden="true" />
              </Button>
            ) : (
              <Button
                className="min-h-11"
                disabled={isSubmitting}
                onClick={() => setConfirmSubmitOpen(true)}
              >
                <Send className="size-4" aria-hidden="true" />
                {t("exam.submitExam")}
              </Button>
            )}
          </div>
        </div>

        {/* Desktop Right Question Navigator */}
        <aside className="hidden lg:block sticky top-20 rounded-xl border border-border bg-card p-4 shadow-xs">
          <h2 className="mb-3 text-sm font-semibold">
            {t("exam.questionNavigator")}
          </h2>
          <ExamNavigatorGrid
            items={navigatorItems}
            currentIndex={currentIndex}
            onSelectIndex={setCurrentIndex}
            onRequestSubmit={() => setConfirmSubmitOpen(true)}
            isSubmitting={isSubmitting}
          />
        </aside>
      </div>

      {/* Confirmation Dialog before manual submit */}
      <AlertDialog open={confirmSubmitOpen} onOpenChange={setConfirmSubmitOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("exam.submitConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>
                  {t("exam.submitConfirmBody", {
                    answered: answeredCount,
                    total: questions.length,
                  })}
                </p>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-md border border-border bg-secondary/50 p-2">
                    <p className="text-xs">{t("exam.answered")}</p>
                    <p className="font-bold text-foreground tabular-nums">
                      {answeredCount}
                    </p>
                  </div>
                  <div className="rounded-md border border-border bg-secondary/50 p-2">
                    <p className="text-xs">{t("exam.unanswered")}</p>
                    <p className="font-bold text-foreground tabular-nums">
                      {unansweredCount}
                    </p>
                  </div>
                  <div className="rounded-md border border-border bg-warning-subtle/60 p-2">
                    <p className="text-xs text-warning-subtle-foreground">
                      {lText(locale, "Đánh dấu", "Flagged")}
                    </p>
                    <p className="font-bold text-warning-subtle-foreground tabular-nums">
                      {flaggedCount}
                    </p>
                  </div>
                </div>
                {unansweredCount > 0 ? (
                  <p className="text-warning-subtle-foreground font-medium">
                    {lText(
                      locale,
                      `Bạn vẫn còn ${unansweredCount} câu chưa trả lời.`,
                      `You still have ${unansweredCount} unanswered question(s).`,
                    )}
                  </p>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={isSubmitting}
              onClick={() => void executeSubmit("manual")}
            >
              {isSubmitting
                ? lText(locale, "Đang chấm điểm...", "Grading...")
                : t("exam.submitExam")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </FocusModeShell>
  );
}
