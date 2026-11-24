"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Cloud,
  CloudOff,
  Flag,
  Grid2X2,
  Keyboard,
  Loader2,
  RefreshCw,
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  LearningApiError,
  saveExamAnswers,
  submitExamAttempt,
  type ExamAnswerSaveItem,
  type ExamAttemptPayload,
} from "@/lib/learning/api-client";
import { indexToOptionLabel } from "@/lib/learning/shuffle";
import { cn } from "@/lib/utils";
import {
  ExamNavigatorGrid,
  type NavigatorQuestionItem,
} from "./ExamNavigatorGrid";
import { ExamTimer } from "./ExamTimer";

interface LocalAnswerRecord {
  selectedOptionIds: string[];
  typedAnswer: string;
  isFlagged: boolean;
  clientSeq: number;
  updatedAtMs: number;
}

interface LiveExamRunnerProps {
  setId?: string | null;
  attemptId: string;
  initialPayload?: ExamAttemptPayload | null;
}

const DRAFT_KEY_PREFIX = "studyhub-exam-draft-v2-";

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
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const payload = examQuery.data;
  const attempt = payload?.attempt;
  const questions = React.useMemo(
    () =>
      [...(payload?.questions ?? [])].sort((a, b) => a.position - b.position),
    [payload?.questions],
  );

  const resultsPath = setId
    ? `/sets/${setId}/results/${attemptId}`
    : `/exams/${attemptId}/results`;
  const backHref = setId ? `/sets/${setId}` : "/exams";

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
  const [serverClockOffsetMs, setServerClockOffsetMs] = React.useState(0);
  const [confirmSubmitOpen, setConfirmSubmitOpen] = React.useState(false);
  const [exitModalOpen, setExitModalOpen] = React.useState(false);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);
  const [navSheetOpen, setNavSheetOpen] = React.useState(false);
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const dirtyQueueRef = React.useRef<Map<string, ExamAnswerSaveItem>>(new Map());
  const debounceTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const draftWriteTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const clientSeqRef = React.useRef<number>(1);
  const submittingRef = React.useRef<boolean>(false);
  const initializedAnswersRef = React.useRef<boolean>(false);
  const jumpInputRef = React.useRef<HTMLInputElement | null>(null);

  // Redirect to results immediately if attempt is already submitted/expired
  React.useEffect(() => {
    if (
      attempt &&
      attempt.status !== "in_progress" &&
      attempt.status !== "discarded"
    ) {
      clearLocalDraft(attemptId);
      router.replace(resultsPath);
    }
  }, [attempt, attemptId, resultsPath, router]);

  // Hydrate server answers + merge ONLY strictly newer local draft entries (`client_seq` / `updatedAtMs`)
  React.useEffect(() => {
    if (!payload || initializedAnswersRef.current) return;
    initializedAnswersRef.current = true;

    let offset = 0;
    if (payload.server_now) {
      const serverMs = Date.parse(payload.server_now);
      if (!Number.isNaN(serverMs)) {
        offset = serverMs - Date.now();
      }
    } else if (
      typeof payload.remaining_seconds === "number" &&
      payload.attempt.expires_at
    ) {
      const expiresMs = Date.parse(payload.attempt.expires_at);
      if (!Number.isNaN(expiresMs)) {
        const expectedServerNow = expiresMs - payload.remaining_seconds * 1000;
        offset = expectedServerNow - Date.now();
      }
    }
    setServerClockOffsetMs(offset);

    let maxSeq = 1;
    const hydrated: Record<string, LocalAnswerRecord> = {};
    for (const ans of payload.answers) {
      const srvSeq = ans.client_seq ?? 0;
      const srvMs = Date.parse(ans.updated_at) || 0;
      if (srvSeq >= maxSeq) maxSeq = srvSeq + 1;
      hydrated[ans.attempt_question_id] = {
        selectedOptionIds: ans.selected_option_ids ?? [],
        typedAnswer: ans.typed_answer ?? "",
        isFlagged: Boolean(ans.is_flagged),
        clientSeq: srvSeq,
        updatedAtMs: srvMs,
      };
    }

    // Merge local offline draft ONLY when local entry is newer than server (fixes BUG-009!)
    const draft = readLocalDraft(attemptId);
    if (draft) {
      for (const [aqId, rec] of Object.entries(draft)) {
        const serverRec = hydrated[aqId];
        const isLocalNewer =
          !serverRec ||
          (rec.clientSeq > 0 && rec.clientSeq > serverRec.clientSeq) ||
          (rec.updatedAtMs > 0 && rec.updatedAtMs > serverRec.updatedAtMs + 1000);

        if (isLocalNewer) {
          const nextSeq = Math.max(rec.clientSeq, maxSeq);
          maxSeq = nextSeq + 1;
          hydrated[aqId] = { ...rec, clientSeq: nextSeq };
          dirtyQueueRef.current.set(aqId, {
            attempt_question_id: aqId,
            selected_option_ids: rec.selectedOptionIds,
            typed_answer: rec.typedAnswer || null,
            is_flagged: rec.isFlagged,
            client_seq: nextSeq,
          });
        }
      }
    }

    clientSeqRef.current = maxSeq;
    setAnswerMap(hydrated);
  }, [attemptId, payload]);

  // Flush autosave queue in <=150 chunks with monotonic client_seq (fixes SH-010!)
  const flushDirtyQueue = React.useCallback(async (): Promise<boolean> => {
    if (dirtyQueueRef.current.size === 0) {
      setSyncState("saved");
      return true;
    }
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setSyncState("pending_offline");
      return false;
    }

    const batch = Array.from(dirtyQueueRef.current.values());
    setSyncState("saving");
    try {
      const res = await saveExamAnswers(attemptId, batch);
      if (res.server_now) {
        const srvMs = Date.parse(res.server_now);
        if (!Number.isNaN(srvMs)) {
          setServerClockOffsetMs(srvMs - Date.now());
        }
      }
      // Clear only items that were not superseded mid-flight
      for (const item of batch) {
        const current = dirtyQueueRef.current.get(item.attempt_question_id);
        if (current && current.client_seq === item.client_seq) {
          dirtyQueueRef.current.delete(item.attempt_question_id);
        }
      }
      setSyncState(dirtyQueueRef.current.size === 0 ? "saved" : "saving");
      return true;
    } catch (err) {
      if (
        err instanceof LearningApiError &&
        (err.code === "EXAM_EXPIRED" || err.status === 409)
      ) {
        toast.info(
          lText(
            locale,
            "Bài thi đã hết giờ hoặc đã được nộp.",
            "This exam has expired or was already submitted.",
          ),
        );
        router.replace(resultsPath);
        return false;
      }
      setSyncState(
        typeof navigator !== "undefined" && !navigator.onLine
          ? "pending_offline"
          : "error",
      );
      return false;
    }
  }, [attemptId, locale, resultsPath, router]);

  // Flush merged local draft once hydrated if there are unsynced offline items
  React.useEffect(() => {
    if (dirtyQueueRef.current.size > 0 && isOnline) {
      void flushDirtyQueue();
    }
  }, [flushDirtyQueue, isOnline]);

  const scheduleAutosave = React.useCallback(
    (
      item: ExamAnswerSaveItem,
      nextFullMap: Record<string, LocalAnswerRecord>,
    ) => {
      dirtyQueueRef.current.set(item.attempt_question_id, item);

      // Debounce localStorage JSON serialization (300ms) to keep 500Q clicks <1ms!
      if (draftWriteTimerRef.current) clearTimeout(draftWriteTimerRef.current);
      draftWriteTimerRef.current = setTimeout(() => {
        writeLocalDraft(attemptId, nextFullMap);
      }, 300);

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

  // Monitor online / offline events and auto-resync cleanly when network returns
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
      if (draftWriteTimerRef.current) clearTimeout(draftWriteTimerRef.current);
    };
  }, [flushDirtyQueue, locale]);

  // Idempotent Exam Submit — NEVER swallows failed answer flush!
  const executeSubmit = React.useCallback(
    async (reason: "manual" | "expired") => {
      if (submittingRef.current) return;
      submittingRef.current = true;
      setIsSubmitting(true);
      setConfirmSubmitOpen(false);

      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

      try {
        if (dirtyQueueRef.current.size > 0) {
          if (typeof navigator !== "undefined" && !navigator.onLine) {
            if (reason === "manual") {
              submittingRef.current = false;
              setIsSubmitting(false);
              toast.error(
                lText(
                  locale,
                  "Bạn đang ngoại tuyến và còn đáp án chưa đồng bộ. Hãy kết nối mạng trước khi nộp bài.",
                  "You are offline with unsynced answers. Reconnect before submitting.",
                ),
              );
              return;
            }
          } else {
            // Chunked flush (<=150/batch); if manual submit & flush fails, HALT submit so answers are NEVER lost (SH-010)!
            const flushed = await flushDirtyQueue();
            if (!flushed && reason === "manual") {
              submittingRef.current = false;
              setIsSubmitting(false);
              toast.error(
                lText(
                  locale,
                  "Không thể đồng bộ đáp án cuối lên máy chủ. Vui lòng bấm Thử lại trước khi nộp bài.",
                  "Could not sync final answers to the server. Please retry before submitting.",
                ),
              );
              return;
            }
          }
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

        router.replace(resultsPath);
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
    [attemptId, flushDirtyQueue, locale, resultsPath, router],
  );

  const handleTimerExpire = React.useCallback(() => {
    void executeSubmit("expired");
  }, [executeSubmit]);

  const handleSafeExit = React.useCallback(async () => {
    setExitModalOpen(false);
    if (dirtyQueueRef.current.size > 0) {
      writeLocalDraft(attemptId, answerMap);
      await flushDirtyQueue();
    }
    router.push(backHref);
  }, [answerMap, attemptId, backHref, flushDirtyQueue, router]);

  const allowNavigation = attempt?.allow_navigation ?? true;
  const allowMarkForReview = attempt?.allow_mark_for_review ?? true;
  const showSubjectNames = attempt?.show_subject_names ?? true;
  const showChapterNames = attempt?.show_chapter_names ?? true;
  const autoSubmitOnExpire = attempt?.auto_submit_on_expire ?? true;

  const currentQuestion = questions[currentIndex] ?? null;
  const currentRecord: LocalAnswerRecord = currentQuestion
    ? answerMap[currentQuestion.id] ?? {
        selectedOptionIds: [],
        typedAnswer: "",
        isFlagged: false,
        clientSeq: 0,
        updatedAtMs: 0,
      }
    : {
        selectedOptionIds: [],
        typedAnswer: "",
        isFlagged: false,
        clientSeq: 0,
        updatedAtMs: 0,
      };

  const updateCurrentRecord = React.useCallback(
    (updater: (prev: LocalAnswerRecord) => LocalAnswerRecord) => {
      if (!currentQuestion || submittingRef.current) return;
      const nextSeq = clientSeqRef.current++;
      const nowMs = Date.now();
      setAnswerMap((prevMap) => {
        const prevRec = prevMap[currentQuestion.id] ?? {
          selectedOptionIds: [],
          typedAnswer: "",
          isFlagged: false,
          clientSeq: 0,
          updatedAtMs: 0,
        };
        const updated = updater(prevRec);
        const nextRec: LocalAnswerRecord = {
          ...updated,
          clientSeq: nextSeq,
          updatedAtMs: nowMs,
        };
        const nextMap = { ...prevMap, [currentQuestion.id]: nextRec };
        scheduleAutosave(
          {
            attempt_question_id: currentQuestion.id,
            selected_option_ids: nextRec.selectedOptionIds,
            typed_answer: nextRec.typedAnswer.trim() ? nextRec.typedAnswer : null,
            is_flagged: nextRec.isFlagged,
            client_seq: nextSeq,
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
    if (!allowMarkForReview) return;
    updateCurrentRecord((prev) => ({ ...prev, isFlagged: !prev.isFlagged }));
  }, [allowMarkForReview, updateCurrentRecord]);

  const handleSelectNavIndex = React.useCallback(
    (idx: number) => {
      if (!allowNavigation) return;
      setCurrentIndex(idx);
    },
    [allowNavigation],
  );

  const handleSelectNavIndexFromSheet = React.useCallback(
    (idx: number) => {
      if (!allowNavigation) return;
      setCurrentIndex(idx);
      setNavSheetOpen(false);
    },
    [allowNavigation],
  );

  const handleOpenSubmitModal = React.useCallback(() => {
    setNavSheetOpen(false);
    setConfirmSubmitOpen(true);
  }, []);

  // Keyboard shortcuts strictly guarded against inputs AND ALL open modals/sheets (SH-028)!
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        confirmSubmitOpen ||
        exitModalOpen ||
        navSheetOpen ||
        shortcutsOpen ||
        !currentQuestion ||
        submittingRef.current
      ) {
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        setConfirmSubmitOpen(true);
        return;
      }

      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableEventTarget(event.target)) return;

      if (event.key === "?") {
        event.preventDefault();
        setShortcutsOpen(true);
        return;
      }

      if (event.key === "g" || event.key === "G") {
        if (jumpInputRef.current) {
          event.preventDefault();
          jumpInputRef.current.focus();
        }
        return;
      }

      if (
        (event.key === "ArrowLeft" || event.key === "j" || event.key === "J") &&
        currentIndex > 0 &&
        allowNavigation
      ) {
        event.preventDefault();
        setCurrentIndex((i) => i - 1);
      } else if (
        (event.key === "ArrowRight" || event.key === "k" || event.key === "K") &&
        currentIndex + 1 < questions.length
      ) {
        event.preventDefault();
        setCurrentIndex((i) => i + 1);
      } else if (
        (event.key === "m" ||
          event.key === "M" ||
          event.key === "f" ||
          event.key === "F") &&
        allowMarkForReview
      ) {
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
    allowMarkForReview,
    allowNavigation,
    confirmSubmitOpen,
    currentIndex,
    currentQuestion,
    exitModalOpen,
    handleSelectOption,
    handleToggleFlag,
    navSheetOpen,
    questions.length,
    shortcutsOpen,
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
        subjectId: showSubjectNames ? q.source_study_set_id ?? null : null,
        subjectTitle: showSubjectNames ? q.source_subject_title ?? null : null,
      };
    });
  }, [answerMap, questions, showSubjectNames]);

  const { answeredCount, flaggedCount, unansweredCount } = React.useMemo(() => {
    let ans = 0;
    let flg = 0;
    for (const item of navigatorItems) {
      if (item.isAnswered) ans += 1;
      if (item.isFlagged) flg += 1;
    }
    return {
      answeredCount: ans,
      flaggedCount: flg,
      unansweredCount: navigatorItems.length - ans,
    };
  }, [navigatorItems]);

  if (examQuery.isLoading) {
    return (
      <FocusModeShell backHref={backHref} title={t("exam.title")}>
        <StudyLoadingSkeleton />
      </FocusModeShell>
    );
  }

  if (examQuery.isError || !attempt || !currentQuestion) {
    return (
      <FocusModeShell backHref={backHref} title={t("exam.title")}>
        <StudyErrorState
          message={
            examQuery.error instanceof Error
              ? examQuery.error.message
              : undefined
          }
          onRetry={() => void examQuery.refetch()}
          backHref={backHref}
        />
      </FocusModeShell>
    );
  }

  return (
    <FocusModeShell
      backHref={backHref}
      backLabel={lText(locale, "Thoát", "Exit")}
      onBeforeBack={(e) => {
        e.preventDefault();
        setExitModalOpen(true);
      }}
      title={attempt.study_set_title_snapshot}
      subtitle={lText(
        locale,
        "Phòng thi thử — Tự động lưu liên tục",
        "Live Mock Exam — Continuous Autosave",
      )}
      progressCurrent={answeredCount}
      progressTotal={questions.length}
      className="pb-24 lg:pb-8"
      headerRight={
        <div className="flex items-center gap-1.5 sm:gap-2">
          {/* Visible Autosave Status Pill on BOTH Mobile & Desktop + Retry on Error (SH-010 / SH-028) */}
          {syncState === "error" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1 border-destructive/60 bg-destructive-subtle px-2 text-xs text-destructive-subtle-foreground"
              onClick={() => void flushDirtyQueue()}
            >
              <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="hidden sm:inline">
                {lText(locale, "Lỗi lưu", "Save error")}
              </span>
              <RefreshCw className="size-3 shrink-0" aria-hidden="true" />
              <span>{lText(locale, "Thử lại", "Retry")}</span>
            </Button>
          ) : (
            <span
              role="status"
              aria-live="polite"
              className={cn(
                "inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] sm:text-xs font-medium",
                syncState === "saved" &&
                  "bg-success-subtle text-success-subtle-foreground",
                syncState === "saving" && "bg-secondary text-muted-foreground",
                syncState === "pending_offline" &&
                  "bg-warning-subtle text-warning-subtle-foreground",
              )}
            >
              {syncState === "saving" ? (
                <>
                  <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                  <span className="hidden xs:inline sm:inline">
                    {lText(locale, "Đang lưu", "Saving")}
                  </span>
                </>
              ) : syncState === "pending_offline" ? (
                <>
                  <CloudOff className="size-3" aria-hidden="true" />
                  <span className="hidden sm:inline">
                    {lText(locale, "Ngoại tuyến", "Offline")}
                  </span>
                </>
              ) : (
                <>
                  <Cloud className="size-3" aria-hidden="true" />
                  <span className="hidden sm:inline">
                    {lText(locale, "Đã lưu", "Saved")}
                  </span>
                </>
              )}
            </span>
          )}

          {/* Isolated Memoized Countdown Timer (ZERO parent re-renders!) */}
          <ExamTimer
            expiresAtIso={attempt.expires_at}
            serverClockOffsetMs={serverClockOffsetMs}
            active={attempt.status === "in_progress"}
            autoSubmitOnExpire={autoSubmitOnExpire}
            onExpire={handleTimerExpire}
          />

          {/* Keyboard Help button (desktop) */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="hidden lg:inline-flex min-h-9 min-w-9"
            aria-label={t("study.keyboardShortcuts")}
            onClick={() => setShortcutsOpen(true)}
          >
            <Keyboard className="size-4" aria-hidden="true" />
          </Button>

          {/* Desktop Quick Submit */}
          <Button
            type="button"
            size="sm"
            className="hidden sm:inline-flex min-h-9"
            disabled={isSubmitting}
            onClick={handleOpenSubmitModal}
          >
            <Send className="size-3.5" aria-hidden="true" />
            {t("exam.submitExam")}
          </Button>
        </div>
      }
    >
      {/* Offline Banner — explicitly states server-authoritative deadline! */}
      {!isOnline ? (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2.5 rounded-lg border border-warning/60 bg-warning-subtle px-4 py-3 text-xs sm:text-sm text-warning-subtle-foreground"
        >
          <CloudOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            {lText(
              locale,
              "Mất kết nối mạng — bài làm đang được lưu cục bộ và sẽ tự đồng bộ khi có mạng lại. Lưu ý: thời hạn nộp bài vẫn được tính theo đồng hồ máy chủ.",
              "You are offline — answers are cached locally and will resync when reconnected. Note: the exam deadline remains strictly server-authoritative.",
            )}
          </span>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_312px] lg:items-start">
        {/* Active Question Stage — ZERO answer disclosure pre-submit */}
        <div className="mx-auto w-full max-w-3xl space-y-4">
          <Card>
            <CardContent className="space-y-5 py-5 sm:py-6">
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline" className="tabular-nums">
                    {lText(locale, "Câu", "Question")} {currentIndex + 1} /{" "}
                    {questions.length}
                  </Badge>
                  {showSubjectNames && currentQuestion.source_subject_title ? (
                    <Badge variant="accent">
                      {currentQuestion.source_subject_title}
                    </Badge>
                  ) : null}
                  {showChapterNames && currentQuestion.chapter_snapshot ? (
                    <Badge variant="secondary">
                      {currentQuestion.chapter_snapshot}
                    </Badge>
                  ) : null}
                  {currentQuestion.question_type === "multiple_choice" ? (
                    <Badge variant="outline">
                      {lText(locale, "Chọn nhiều đáp án", "Multiple choice")}
                    </Badge>
                  ) : null}
                </div>

                {allowMarkForReview ? (
                  <Button
                    type="button"
                    variant={currentRecord.isFlagged ? "secondary" : "ghost"}
                    size="sm"
                    className={cn(
                      "min-h-11 sm:min-h-9 shrink-0",
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
                    <span className="hidden sm:inline">
                      {currentRecord.isFlagged
                        ? t("exam.unflagQuestion")
                        : t("exam.flagQuestion")}
                    </span>
                    <kbd className="ml-1 hidden rounded bg-background/60 px-1 py-0.5 font-mono text-[10px] lg:inline">
                      M
                    </kbd>
                  </Button>
                ) : null}
              </div>

              <div className="space-y-3">
                <h2 className="max-w-[68ch] whitespace-pre-wrap text-base sm:text-lg font-medium leading-relaxed text-foreground">
                  {currentQuestion.prompt_snapshot}
                </h2>
                {isSafeDisplayImageUrl(
                  currentQuestion.prompt_image_url_snapshot,
                ) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={currentQuestion.prompt_image_url_snapshot}
                    alt={lText(
                      locale,
                      "Hình ảnh câu hỏi",
                      "Question illustration",
                    )}
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
                    className="text-base sm:text-sm"
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
                          "flex min-h-[52px] w-full items-start gap-3 rounded-lg border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                          isSelected
                            ? "border-2 border-primary bg-accent text-accent-foreground"
                            : "border-input bg-card text-foreground hover:bg-secondary/60",
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
                          <Check
                            className="mt-1 size-4 shrink-0 text-primary"
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

          {/* Desktop Footer Navigation Controls */}
          <div className="hidden items-center justify-between gap-3 lg:flex">
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={currentIndex === 0 || !allowNavigation}
              onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
              {t("study.previousQuestion")}
            </Button>

            {currentIndex + 1 < questions.length ? (
              <Button
                type="button"
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
                type="button"
                className="min-h-11"
                disabled={isSubmitting}
                onClick={handleOpenSubmitModal}
              >
                <Send className="size-4" aria-hidden="true" />
                {t("exam.submitExam")}
              </Button>
            )}
          </div>
        </div>

        {/* Desktop Right Navigator Rail (Memoized, Zero-Drift Virtualized!) */}
        <aside className="hidden lg:block sticky top-20 rounded-xl border border-border bg-card p-4 shadow-xs">
          <h2 className="mb-3 text-sm font-semibold">
            {t("exam.questionNavigator")}
          </h2>
          <ExamNavigatorGrid
            items={navigatorItems}
            currentIndex={currentIndex}
            answeredCount={answeredCount}
            flaggedCount={flaggedCount}
            onSelectIndex={handleSelectNavIndex}
            onRequestSubmit={handleOpenSubmitModal}
            isSubmitting={isSubmitting}
            allowNavigation={allowNavigation}
            jumpInputRef={jumpInputRef}
          />
        </aside>
      </div>

      {/* Mobile Sticky Bottom Action Bar (<lg, compact single row <12% viewport height) */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 px-2 py-2 backdrop-blur-xs lg:hidden pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-xl items-center gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-11 flex-1 min-w-0 gap-1 whitespace-nowrap px-1.5 text-xs"
            disabled={currentIndex === 0 || !allowNavigation}
            onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
          >
            <ChevronLeft className="size-3.5 shrink-0" aria-hidden="true" />
            <span>{lText(locale, "Trước", "Prev")}</span>
          </Button>

          <Button
            type="button"
            variant={currentRecord.isFlagged ? "secondary" : "outline"}
            size="sm"
            className={cn(
              "min-h-11 shrink-0 gap-1 whitespace-nowrap px-2 text-xs",
              currentRecord.isFlagged &&
                "border-warning/60 bg-warning-subtle text-warning-subtle-foreground",
            )}
            disabled={!allowMarkForReview}
            aria-pressed={currentRecord.isFlagged}
            onClick={handleToggleFlag}
          >
            <Flag
              className={cn(
                "size-3.5 shrink-0",
                currentRecord.isFlagged && "fill-current",
              )}
              aria-hidden="true"
            />
            <span>{lText(locale, "Đánh dấu", "Flag")}</span>
          </Button>

          <Sheet open={navSheetOpen} onOpenChange={setNavSheetOpen}>
            <SheetTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11 flex-1 min-w-0 gap-1 whitespace-nowrap px-1.5 text-xs tabular-nums"
              >
                <Grid2X2 className="size-3.5 shrink-0" aria-hidden="true" />
                <span>
                  {answeredCount}/{questions.length}
                </span>
              </Button>
            </SheetTrigger>
            <SheetContent
              side="bottom"
              className="h-[82dvh] overflow-y-auto overscroll-contain rounded-t-2xl"
            >
              <SheetHeader>
                <SheetTitle>{t("exam.questionNavigator")}</SheetTitle>
              </SheetHeader>
              <div className="px-4 pb-6 pt-2">
                <ExamNavigatorGrid
                  items={navigatorItems}
                  currentIndex={currentIndex}
                  answeredCount={answeredCount}
                  flaggedCount={flaggedCount}
                  onSelectIndex={handleSelectNavIndexFromSheet}
                  onRequestSubmit={handleOpenSubmitModal}
                  isSubmitting={isSubmitting}
                  allowNavigation={allowNavigation}
                />
              </div>
            </SheetContent>
          </Sheet>

          {currentIndex + 1 < questions.length ? (
            <Button
              type="button"
              size="sm"
              className="min-h-11 flex-1 min-w-0 gap-1 whitespace-nowrap px-1.5 text-xs"
              onClick={() =>
                setCurrentIndex((i) => Math.min(questions.length - 1, i + 1))
              }
            >
              <span>{lText(locale, "Tiếp", "Next")}</span>
              <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              className="min-h-11 flex-1 min-w-0 gap-1 whitespace-nowrap px-1.5 text-xs"
              disabled={isSubmitting}
              onClick={handleOpenSubmitModal}
            >
              <Send className="size-3.5 shrink-0" aria-hidden="true" />
              <span>{lText(locale, "Nộp bài", "Submit")}</span>
            </Button>
          )}
        </div>
      </div>

      {/* Submit Confirmation Modal */}
      <AlertDialog open={confirmSubmitOpen} onOpenChange={setConfirmSubmitOpen}>
        <AlertDialogContent className="overscroll-contain">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {lText(locale, "Xác nhận nộp bài thi?", "Submit Exam Attempt?")}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>
                  {lText(
                    locale,
                    "Sau khi nộp bài, hệ thống sẽ chấm điểm tự động và khóa kết quả bài thi này.",
                    "Once submitted, your answers will be locked and graded automatically.",
                  )}
                </p>
                <div className="grid grid-cols-3 gap-2 text-center tabular-nums">
                  <div className="rounded-md border border-border bg-secondary/40 p-2">
                    <p className="text-[11px] text-muted-foreground">
                      {t("exam.answered")}
                    </p>
                    <p className="text-base font-bold text-foreground">
                      {answeredCount}
                    </p>
                  </div>
                  <div className="rounded-md border border-border bg-secondary/40 p-2">
                    <p className="text-[11px] text-muted-foreground">
                      {t("exam.unanswered")}
                    </p>
                    <p className="text-base font-bold text-foreground">
                      {unansweredCount}
                    </p>
                  </div>
                  <div className="rounded-md border border-border bg-secondary/40 p-2">
                    <p className="text-[11px] text-muted-foreground">
                      {lText(locale, "Đánh dấu", "Marked")}
                    </p>
                    <p className="text-base font-bold text-foreground">
                      {flaggedCount}
                    </p>
                  </div>
                </div>
                {unansweredCount > 0 && allowNavigation ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      const firstOpen = navigatorItems.findIndex(
                        (i) => !i.isAnswered,
                      );
                      if (firstOpen >= 0) setCurrentIndex(firstOpen);
                      setConfirmSubmitOpen(false);
                    }}
                  >
                    {lText(
                      locale,
                      `Xem câu chưa làm đầu tiên (còn ${unansweredCount} câu)`,
                      `Jump to first unanswered (${unansweredCount} left)`,
                    )}
                  </Button>
                ) : null}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel autoFocus disabled={isSubmitting}>
              {lText(locale, "Tiếp tục làm bài", "Continue Exam")}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isSubmitting}
              onClick={() => void executeSubmit("manual")}
            >
              {isSubmitting ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              {t("exam.submitExam")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Safe Exit Confirmation Modal (flushes pending autosave before leaving!) */}
      <AlertDialog open={exitModalOpen} onOpenChange={setExitModalOpen}>
        <AlertDialogContent className="overscroll-contain">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {lText(locale, "Tạm thoát khỏi phòng thi?", "Leave Exam Room?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {lText(
                locale,
                "Các câu bạn đã chọn sẽ được đồng bộ ngay trước khi thoát. Lưu ý: nếu bài thi có giới hạn thời gian, đồng hồ máy chủ vẫn tiếp tục đếm.",
                "Your answers will be flushed before leaving. Note: if this exam is timed, the server clock continues running.",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel autoFocus>
              {lText(locale, "Ở lại làm tiếp", "Stay in Exam")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleSafeExit()}>
              {lText(locale, "Lưu & Thoát tạm", "Save & Leave")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Keyboard Shortcuts Help Dialog */}
      <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
        <DialogContent className="max-w-sm overscroll-contain">
          <DialogHeader>
            <DialogTitle>{t("study.keyboardShortcuts")}</DialogTitle>
          </DialogHeader>
          <ul className="space-y-2 text-sm">
            <li className="flex justify-between">
              <span className="text-muted-foreground">
                {lText(locale, "Chọn đáp án A–F", "Select option A–F")}
              </span>
              <kbd className="rounded bg-secondary px-2 py-0.5 font-mono text-xs">
                A–F / 1–6
              </kbd>
            </li>
            <li className="flex justify-between">
              <span className="text-muted-foreground">
                {lText(locale, "Câu trước / Câu tiếp", "Prev / Next question")}
              </span>
              <kbd className="rounded bg-secondary px-2 py-0.5 font-mono text-xs">
                ← / →
              </kbd>
            </li>
            <li className="flex justify-between">
              <span className="text-muted-foreground">
                {lText(locale, "Đánh dấu xem lại", "Mark for review")}
              </span>
              <kbd className="rounded bg-secondary px-2 py-0.5 font-mono text-xs">
                M / F
              </kbd>
            </li>
            <li className="flex justify-between">
              <span className="text-muted-foreground">
                {lText(locale, "Nhảy nhanh tới câu #", "Jump to question #")}
              </span>
              <kbd className="rounded bg-secondary px-2 py-0.5 font-mono text-xs">
                G
              </kbd>
            </li>
            <li className="flex justify-between">
              <span className="text-muted-foreground">
                {lText(locale, "Mở hộp thoại nộp bài", "Open submit dialog")}
              </span>
              <kbd className="rounded bg-secondary px-2 py-0.5 font-mono text-xs">
                Ctrl/Cmd + Enter
              </kbd>
            </li>
          </ul>
        </DialogContent>
      </Dialog>
    </FocusModeShell>
  );
}
