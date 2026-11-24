"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
  ZoomIn,
} from "lucide-react";
import { toast } from "sonner";
import { AudioPlayer } from "@/components/audio/AudioPlayer";
import { ImageLightbox } from "@/components/media/ImageLightbox";
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
import type { ConfidenceLevel, Question, QuestionOption } from "@/types/domain";
import { cn, formatDuration } from "@/lib/utils";
import { ConfidenceSelector } from "./ConfidenceSelector";
import { FocusModeShell } from "./FocusModeShell";
import { lText } from "./learning-copy";
import { QuestionNotesAndReportBar } from "./QuestionNotesAndReportBar";
import { SafeRichText, ZoomableImage } from "./SafeRichText";
import {
  StudyEmptyState,
  StudyErrorState,
  StudyLoadingSkeleton,
  useStudySetBundle,
} from "./useStudySetBundle";

type PracticeFilterMode = "all" | "unanswered" | "wrong" | "starred";

interface PracticeItem {
  question: Question;
  displayedOptions: Array<DisplayedOption<QuestionOption>>;
}

interface PracticeAnswerState {
  selectedOptionIds: string[];
  typedAnswer: string;
  isSubmitted: boolean;
  isCorrect: boolean;
  confidence: ConfidenceLevel | null;
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
  const { locale, t } = useI18n();
  const { preferences, playFeedbackSound } = useUserPreferences();
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
    toggleStar,
    updateLocalProgress,
  } = useStudySetBundle(setId);

  const initialFilterParam = searchParams.get("filter");
  const initialChapterParam = searchParams.get("chapter") ?? "all";
  const initialQuestionIdsParam = searchParams.get("questionIds");

  // Config state (hydrated with user_preferences defaults — SH-032!)
  const [phase, setPhase] = React.useState<"config" | "active" | "complete">(
    "config",
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
  const [shuffleQ, setShuffleQ] = React.useState<boolean>(
    () => preferences.default_shuffle_questions,
  );
  const [shuffleA, setShuffleA] = React.useState<boolean>(
    () => preferences.default_shuffle_options,
  );
  const [autoNext, setAutoNext] = React.useState<boolean>(false);
  const [showExplanation, setShowExplanation] = React.useState<boolean>(
    () => preferences.show_instant_feedback,
  );
  const [confidenceOverride, setConfidenceOverride] = React.useState<
    boolean | null
  >(null);
  const confidenceEnabled =
    confidenceOverride ?? Boolean(preferences.confidence_enabled);

  const syncedPrefsRef = React.useRef(false);
  React.useEffect(() => {
    if (syncedPrefsRef.current) return;
    syncedPrefsRef.current = true;
    setShuffleQ(preferences.default_shuffle_questions);
    setShuffleA(preferences.default_shuffle_options);
    setShowExplanation(preferences.show_instant_feedback);
  }, [
    preferences.default_shuffle_options,
    preferences.default_shuffle_questions,
    preferences.show_instant_feedback,
  ]);

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
  const [optionLightbox, setOptionLightbox] = React.useState<{
    src: string;
    alt: string;
  } | null>(null);

  const sessionIdRef = React.useRef<string | null>(null);
  const startedAtRef = React.useRef<number>(0);
  const questionStartRef = React.useRef<number>(0);
  const autoNextTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const autoLaunchedRef = React.useRef(false);

  React.useEffect(() => {
    return () => {
      if (autoNextTimerRef.current) clearTimeout(autoNextTimerRef.current);
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

  const startPracticeSession = React.useCallback(
    async (sourceQuestions: Question[]) => {
      if (sourceQuestions.length === 0) return;
      if (autoNextTimerRef.current) clearTimeout(autoNextTimerRef.current);

      const ordered = shuffleQ
        ? shuffleQuestions(sourceQuestions)
        : [...sourceQuestions];
      const limited =
        countMode === "custom"
          ? ordered.slice(0, Math.max(1, customCount))
          : ordered;

      const built: PracticeItem[] = limited.map((q) => {
        const opts = q.options ?? [];
        const displayedOptions = shuffleA
          ? shuffleOptions(opts)
          : withOptionDisplayLabels(opts);
        return { question: q, displayedOptions };
      });

      setItems(built);
      setCurrentIndex(0);
      setAnswers({});
      setPhase("active");
      startedAtRef.current = Date.now();
      questionStartRef.current = Date.now();
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
          total_items: built.length,
        });
        sessionIdRef.current = session.id;
      } catch {
        // Allow practicing smoothly even if session endpoint is offline
      }
    },
    [
      autoNext,
      countMode,
      customCount,
      filterMode,
      selectedChapter,
      setId,
      shuffleA,
      shuffleQ,
    ],
  );

  // Direct-Start Practice (UX31-07): immediately launch Q1 with sensible defaults unless `?setup=1` is requested
  const wantsManualSetup = searchParams.get("setup") === "1";
  React.useEffect(() => {
    if (
      !bundle ||
      autoLaunchedRef.current ||
      phase !== "config" ||
      filteredQuestions.length === 0 ||
      wantsManualSetup
    ) {
      return;
    }
    autoLaunchedRef.current = true;
    const timer = setTimeout(() => {
      void startPracticeSession(filteredQuestions);
    }, 0);
    return () => clearTimeout(timer);
  }, [
    bundle,
    filteredQuestions,
    phase,
    startPracticeSession,
    wantsManualSetup,
  ]);

  const currentItem = items[currentIndex] ?? null;
  const isCurrentMultiChoice =
    currentItem?.question.question_type === "multiple_choice" ||
    (currentItem?.question.type_payload?.type === "image_choice" &&
      currentItem.question.type_payload.selection_mode === "multiple");
  const isCurrentImageChoice =
    currentItem?.question.question_type === "image_choice";
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
      if (autoNextTimerRef.current) clearTimeout(autoNextTimerRef.current);
      const durationSeconds = Math.max(
        1,
        Math.round((Date.now() - startedAtRef.current) / 1000),
      );
      setCompletedDurationSeconds(durationSeconds);
      setPhase("complete");
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
        }).catch(() => {});
      }
    },
    [],
  );

  const persistAnswer = React.useCallback(
    (
      question: Question,
      selectedOptionIds: string[],
      typedAnswer: string | null,
      isCorrect: boolean,
      confidence: ConfidenceLevel | null,
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
        isSubmitted: true,
        isCorrect,
        confidence: submittedConfidence,
      };
      const nextAnswers = {
        ...answers,
        [currentItem.question.id]: nextState,
      };
      setAnswers(nextAnswers);
      playFeedbackSound(isCorrect ? "correct" : "wrong");
      persistAnswer(
        currentItem.question,
        selectedIds,
        null,
        isCorrect,
        submittedConfidence,
      );

      if (autoNext && isCorrect) {
        if (autoNextTimerRef.current) clearTimeout(autoNextTimerRef.current);
        autoNextTimerRef.current = setTimeout(() => {
          if (currentIndex + 1 < items.length) {
            setCurrentIndex((i) => i + 1);
            questionStartRef.current = Date.now();
          } else {
            finishPractice(nextAnswers);
          }
        }, 700);
      }
    },
    [
      answers,
      autoNext,
      confidenceEnabled,
      currentAnswer.confidence,
      currentAnswer.isSubmitted,
      currentIndex,
      currentItem,
      finishPractice,
      items.length,
      persistAnswer,
      playFeedbackSound,
    ],
  );

  const handleOptionClick = React.useCallback(
    (optionId: string) => {
      if (!currentItem || currentAnswer.isSubmitted) return;
      const isMulti =
        currentItem.question.question_type === "multiple_choice" ||
        (currentItem.question.type_payload?.type === "image_choice" &&
          currentItem.question.type_payload.selection_mode === "multiple");

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
        isSubmitted: true,
        isCorrect: graded.isCorrect,
        confidence: submittedConfidence,
      };
      const nextAnswers = {
        ...answers,
        [currentItem.question.id]: nextState,
      };
      setAnswers(nextAnswers);
      playFeedbackSound(graded.isCorrect ? "correct" : "wrong");
      persistAnswer(
        currentItem.question,
        [],
        typed,
        graded.isCorrect,
        submittedConfidence,
      );
    },
    [
      answers,
      confidenceEnabled,
      currentAnswer,
      currentItem,
      persistAnswer,
      playFeedbackSound,
    ],
  );

  const handleGoNext = React.useCallback(() => {
    if (autoNextTimerRef.current) clearTimeout(autoNextTimerRef.current);
    if (currentIndex + 1 < items.length) {
      setCurrentIndex(currentIndex + 1);
      questionStartRef.current = Date.now();
    } else {
      finishPractice(answers);
    }
  }, [answers, currentIndex, finishPractice, items.length]);

  const handleGoPrev = React.useCallback(() => {
    if (autoNextTimerRef.current) clearTimeout(autoNextTimerRef.current);
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
      questionStartRef.current = Date.now();
    }
  }, [currentIndex]);

  // Keyboard shortcuts during active practice
  React.useEffect(() => {
    if (phase !== "active" || !currentItem || navSheetOpen || optionLightbox) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isEditableEventTarget(event.target)) return;
      if (document.querySelector('[role="dialog"]')) return;

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
          currentItem.question.question_type === "multiple_choice" &&
          currentAnswer.selectedOptionIds.length > 0
        ) {
          submitCurrentChoice(currentAnswer.selectedOptionIds);
        }
        return;
      }

      // 1-6 or A-F selects option by displayed position
      if (!currentAnswer.isSubmitted && currentItem.displayedOptions.length > 0) {
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
    navSheetOpen,
    optionLightbox,
    phase,
    submitCurrentChoice,
    t,
    toggleStar,
  ]);

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

  const handleSelectNavIndex = React.useCallback((idx: number) => {
    // Cancel pending autoNext timer when jumping manually via navigator (SH-025 / BUG-020)!
    if (autoNextTimerRef.current) {
      clearTimeout(autoNextTimerRef.current);
      autoNextTimerRef.current = null;
    }
    setCurrentIndex(idx);
    questionStartRef.current = Date.now();
    setNavSheetOpen(false);
  }, []);

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

  return (
    <FocusModeShell
      backHref={`/sets/${setId}`}
      title={bundle.studySet.title}
      subtitle={lText(locale, "Luyện tập trắc nghiệm", "Multiple Choice Practice")}
      progressCurrent={phase === "active" ? answeredCount : undefined}
      progressTotal={phase === "active" ? items.length : undefined}
      headerRight={
        phase === "active" ? (
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-9 gap-1 px-2 text-xs sm:px-2.5 sm:text-sm"
              onClick={() => setPhase("config")}
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
                  className="min-h-9 lg:hidden"
                >
                  <Grid2X2 className="size-4" aria-hidden="true" />
                  <span>{lText(locale, "Câu hỏi", "Questions")}</span>
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
              className="min-h-9"
              onClick={() => finishPractice(answers)}
            >
              {t("common.finish")}
            </Button>
          </div>
        ) : phase === "config" && items.length > 0 ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="min-h-9"
            onClick={() => setPhase("active")}
          >
            {lText(locale, "Quay lại bài làm", "Resume Session")}
          </Button>
        ) : null
      }
    >
      {phase === "config" &&
      !wantsManualSetup &&
      items.length === 0 &&
      filteredQuestions.length > 0 ? (
        <StudyLoadingSkeleton />
      ) : phase === "config" ? (
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
                onClick={() => void startPracticeSession(filteredQuestions)}
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
                  const correctOpts = item.displayedOptions.filter(
                    (o) => o.is_correct,
                  );
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
                            {correctOpts.length > 0
                              ? correctOpts
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
                              : getExpectedWriteAnswers(item.question)
                                  .map((a) => a.answer_text)
                                  .join(" / ")}
                          </span>
                        </p>
                      </div>
                      {item.question.explanation ||
                      item.question.explanation_rich ? (
                        <div className="rounded-md bg-secondary/60 p-2.5 text-xs text-muted-foreground">
                          <strong className="text-foreground">
                            {t("study.explanation")}:{" "}
                          </strong>
                          <SafeRichText
                            rich={item.question.explanation_rich}
                            fallbackText={item.question.explanation}
                            inline
                          />
                        </div>
                      ) : null}
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
                          {items.length}
                        </Badge>
                        {currentItem.question.chapter ? (
                          <Badge variant="secondary">
                            {currentItem.question.chapter}
                          </Badge>
                        ) : null}
                        {currentItem.question.question_type === "multiple_choice" ||
                        (currentItem.question.type_payload?.type === "image_choice" &&
                          currentItem.question.type_payload.selection_mode ===
                            "multiple") ? (
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
                        className="min-h-10 min-w-10 shrink-0"
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
                      <h2 className="text-lg font-medium leading-relaxed text-foreground">
                        <SafeRichText
                          rich={currentItem.question.prompt_rich}
                          fallbackText={currentItem.question.prompt}
                        />
                      </h2>
                      {currentItem.question.prompt_image_url ? (
                        <ZoomableImage
                          src={currentItem.question.prompt_image_url}
                          alt={lText(
                            locale,
                            "Hình ảnh câu hỏi",
                            "Question illustration",
                          )}
                        />
                      ) : null}
                      {currentItem.question.audio_url ? (
                        <AudioPlayer
                          src={currentItem.question.audio_url}
                          transcript={currentItem.question.audio_transcript}
                          compact
                          preload="metadata"
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

                    {/* Choice options vs typed fallback */}
                    {currentItem.displayedOptions.length > 0 ? (
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
                            const hasOptImage = isSafeDisplayImageUrl(
                              option.image_url,
                            );
                            const hasOptText =
                              option.content.trim().length > 0 ||
                              Boolean(option.content_rich);

                            let stateStyle =
                              "border-border bg-card hover:bg-secondary/60 text-foreground";
                            if (submitted) {
                              if (isCorrectOpt) {
                                stateStyle =
                                  "border-success bg-success-subtle text-success-subtle-foreground";
                              } else if (isSelected && !isCorrectOpt) {
                                stateStyle =
                                  "border-destructive bg-destructive-subtle text-destructive-subtle-foreground";
                              } else {
                                stateStyle =
                                  "border-border bg-card/60 opacity-75";
                              }
                            } else if (isSelected) {
                              stateStyle =
                                "border-primary bg-accent text-accent-foreground";
                            }

                            return (
                              <div key={option.id} className="relative">
                                <button
                                  type="button"
                                  role={isCurrentMultiChoice ? "checkbox" : "radio"}
                                  aria-checked={isSelected}
                                  disabled={submitted}
                                  onClick={() => handleOptionClick(option.id)}
                                  className={cn(
                                    "flex min-h-12 w-full flex-col items-stretch gap-2 rounded-lg border px-4 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
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
                                    <div className="w-full pt-1">
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img
                                        src={option.image_url ?? ""}
                                        alt={
                                          option.image_alt ||
                                          option.content ||
                                          lText(
                                            locale,
                                            `Hình phương án ${option.displayLabel}`,
                                            `Option ${option.displayLabel} image`,
                                          )
                                        }
                                        loading="lazy"
                                        decoding="async"
                                        className="mx-auto max-h-44 w-auto rounded-md border border-border object-contain"
                                      />
                                    </div>
                                  ) : null}
                                </button>

                                {hasOptImage ? (
                                  <Button
                                    type="button"
                                    size="icon"
                                    variant="secondary"
                                    className="absolute right-2 bottom-2 size-8 opacity-90 shadow-xs"
                                    aria-label={lText(
                                      locale,
                                      `Phóng to hình phương án ${option.displayLabel}`,
                                      `Zoom option ${option.displayLabel} image`,
                                    )}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setOptionLightbox({
                                        src: option.image_url!,
                                        alt:
                                          option.image_alt ||
                                          option.content ||
                                          lText(
                                            locale,
                                            `Hình phương án ${option.displayLabel}`,
                                            `Option ${option.displayLabel} image`,
                                          ),
                                      });
                                    }}
                                  >
                                    <ZoomIn
                                      className="size-3.5"
                                      aria-hidden="true"
                                    />
                                  </Button>
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
                        {showExplanation &&
                        (currentItem.question.explanation ||
                          currentItem.question.explanation_rich) ? (
                          <div className="text-sm text-foreground/90">
                            <strong>{t("study.explanation")}: </strong>
                            <SafeRichText
                              rich={currentItem.question.explanation_rich}
                              fallbackText={currentItem.question.explanation}
                              inline
                            />
                          </div>
                        ) : null}
                      </div>
                    ) : null}

                    {/* Personal Notes & Question Error Report Bar */}
                    <div className="border-t border-border/60 pt-3">
                      <QuestionNotesAndReportBar
                        key={currentItem.question.id}
                        studySetId={setId}
                        questionId={currentItem.question.id}
                        showReportButton
                        compact
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
      )}

      <ImageLightbox
        open={Boolean(optionLightbox)}
        onOpenChange={(open) => {
          if (!open) setOptionLightbox(null);
        }}
        src={optionLightbox?.src}
        alt={optionLightbox?.alt}
      />
    </FocusModeShell>
  );
}
