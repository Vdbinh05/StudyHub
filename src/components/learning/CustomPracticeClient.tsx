"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock,
  Folder as FolderIcon,
  Grid2X2,
  Layers,
  Loader2,
  Play,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Star,
  X,
  XCircle,
  Zap,
  ZoomIn,
} from "lucide-react";
import { toast } from "sonner";
import { AudioPlayer } from "@/components/audio/AudioPlayer";
import { ImageLightbox } from "@/components/media/ImageLightbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ExamNavigatorGrid,
  type NavigatorQuestionItem,
} from "@/components/exam/ExamNavigatorGrid";
import { useI18n } from "@/lib/i18n";
import { useUserPreferences } from "@/lib/preferences";
import {
  fetchAccessibleFolders,
  fetchAccessibleSets,
  fetchExamEligiblePool,
  fetchPracticeQuestionPool,
  isEditableEventTarget,
  isInteractiveControlTarget,
  isSafeDisplayImageUrl,
  recordStudySessionAnswer,
  toggleStarQuestion,
  unstarQuestion,
  updateStudySession,
  upsertQuestionProgress,
} from "@/lib/learning/api-client";
import { validateQuestionCount } from "@/lib/learning/exam-allocator";
import {
  gradeChoiceSelection,
  shuffleOptions,
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
  DifficultyLevel,
  ExamFilterConfig,
  ExamQuestionType,
  ExamSourceInput,
  PracticeQuestionItem,
  QuestionOption,
  SelectionPolicy,
} from "@/types/domain";
import { cn, formatDuration } from "@/lib/utils";
import { ConfidenceSelector } from "./ConfidenceSelector";
import { lText } from "./learning-copy";
import { QuestionNotesAndReportBar } from "./QuestionNotesAndReportBar";
import { SafeRichText, ZoomableImage } from "./SafeRichText";

const SUBSET_PRESETS = [20, 50, 100, 250] as const;
const MAX_PRACTICE_QUESTIONS = 2000;

const PRACTICE_POLICIES: Array<{
  value: SelectionPolicy;
  viTitle: string;
  enTitle: string;
  viDesc: string;
  enDesc: string;
}> = [
  {
    value: "random",
    viTitle: "Tất cả (Ngẫu nhiên)",
    enTitle: "All (Random)",
    viDesc: "Lấy mẫu ngẫu nhiên không lặp từ các bộ đã chọn.",
    enDesc: "Uniform random sampling across selected sources.",
  },
  {
    value: "unseen_first",
    viTitle: "Ưu tiên chưa làm",
    enTitle: "Unseen First",
    viDesc: "Ưu tiên câu chưa luyện lần nào trước khi bổ sung.",
    enDesc: "Prioritizes questions you have not practiced yet.",
  },
  {
    value: "incorrect_only",
    viTitle: "Chỉ câu đã sai",
    enTitle: "Incorrect Only",
    viDesc: "Chỉ lọc nghiêm ngặt các câu từng trả lời sai (không tự bù câu khác).",
    enDesc: "Strictly filters previously missed questions (never pads).",
  },
  {
    value: "starred_only",
    viTitle: "Chỉ câu gắn sao",
    enTitle: "Starred Only",
    viDesc: "Chỉ lọc nghiêm ngặt các câu bạn đã đánh dấu sao.",
    enDesc: "Strictly filters questions you have starred.",
  },
  {
    value: "weak_topics_first",
    viTitle: "Chủ đề yếu nhất",
    enTitle: "Weak Topics First",
    viDesc: "Ưu tiên các chương/chủ đề có tỷ lệ đúng thấp nhất.",
    enDesc: "Prioritizes chapters and topics with lowest accuracy.",
  },
  {
    value: "due_for_review",
    viTitle: "Đến hạn SM-2",
    enTitle: "Due for SM-2 Review",
    viDesc: "Ưu tiên các câu đã đến lịch ôn tập lặp lại ngắt quãng.",
    enDesc: "Prioritizes questions due under SM-2 spaced repetition.",
  },
];

const ALL_DIFFICULTIES: DifficultyLevel[] = ["easy", "medium", "hard"];
const ALL_PRACTICE_TYPES: ExamQuestionType[] = [
  "single_choice",
  "multiple_choice",
  "true_false",
  "short_answer",
];

interface ActivePracticeItem {
  question: PracticeQuestionItem;
  displayedOptions: Array<DisplayedOption<QuestionOption>>;
}

interface PracticeAnswerState {
  selectedOptionIds: string[];
  typedAnswer: string;
  isSubmitted: boolean;
  isCorrect: boolean;
  confidence?: ConfidenceLevel | null;
}

function resolveInitialPolicy(modeParam: string | null): SelectionPolicy {
  switch (modeParam) {
    case "mistakes":
    case "wrong":
    case "incorrect":
      return "incorrect_only";
    case "starred":
      return "starred_only";
    case "unseen":
    case "unanswered":
      return "unseen_first";
    case "due":
      return "due_for_review";
    case "weak":
      return "weak_topics_first";
    default:
      return "random";
  }
}

function subscribeCustomPracticeDesktopLg(callback: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia("(min-width: 1024px)");
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

function getCustomPracticeDesktopLgSnapshot(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(min-width: 1024px)").matches;
}

function getCustomPracticeDesktopLgServerSnapshot(): boolean {
  return false;
}

export function CustomPracticeClient() {
  const { locale, t } = useI18n();
  const { preferences, playFeedbackSound } = useUserPreferences();
  const isDesktopLg = React.useSyncExternalStore(
    subscribeCustomPracticeDesktopLg,
    getCustomPracticeDesktopLgSnapshot,
    getCustomPracticeDesktopLgServerSnapshot,
  );
  const searchParams = useSearchParams();

  // Read URL deep-link params (?setId=, ?setIds=, ?folderId=, ?mode=, ?chapter=)
  const urlSetId = searchParams.get("setId");
  const urlSetIds = searchParams.get("setIds");
  const urlFolderId = searchParams.get("folderId");
  const urlMode = searchParams.get("mode");
  const urlChapter = searchParams.get("chapter");

  const [phase, setPhase] = React.useState<"setup" | "active" | "complete">(
    "setup",
  );
  const [optionLightbox, setOptionLightbox] = React.useState<{
    src: string;
    alt: string;
  } | null>(null);

  // Source selection state
  const [selectedSetIds, setSelectedSetIds] = React.useState<string[]>(() => {
    const ids = new Set<string>();
    if (urlSetId) ids.add(urlSetId);
    if (urlSetIds) {
      for (const raw of urlSetIds.split(",")) {
        const trimmed = raw.trim();
        if (trimmed) ids.add(trimmed);
      }
    }
    return Array.from(ids);
  });
  const [selectedFolderIds, setSelectedFolderIds] = React.useState<string[]>(
    () => (urlFolderId ? [urlFolderId] : []),
  );
  const [sourceSearch, setSourceSearch] = React.useState("");

  // Subset & policy state
  const [selectionPolicy, setSelectionPolicy] = React.useState<SelectionPolicy>(
    () => resolveInitialPolicy(urlMode),
  );
  const [countMode, setCountMode] = React.useState<"all" | "custom">("custom");
  const [customCountInput, setCustomCountInput] = React.useState<string>("50");
  const [countEditedAtPool, setCountEditedAtPool] = React.useState<
    number | null
  >(null);

  // Fine-grained filters
  const [selectedChapters, setSelectedChapters] = React.useState<string[]>(
    () => (urlChapter ? [urlChapter] : []),
  );
  const [selectedDifficulties, setSelectedDifficulties] = React.useState<
    DifficultyLevel[]
  >([]);
  const [selectedTypes, setSelectedTypes] = React.useState<ExamQuestionType[]>(
    [],
  );

  // Behavior options (hydrated from user_preferences — SH-032)
  const [shuffleQ, setShuffleQ] = React.useState<boolean>(
    () => preferences.default_shuffle_questions,
  );
  const [shuffleA, setShuffleA] = React.useState<boolean>(
    () => preferences.default_shuffle_options,
  );
  const [showExplanation, setShowExplanation] = React.useState<boolean>(
    () => preferences.show_instant_feedback,
  );
  const [autoNext, setAutoNext] = React.useState<boolean>(false);

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

  // Active practice session state
  const [isLaunching, setIsLaunching] = React.useState(false);
  const [sessionId, setSessionId] = React.useState<string | null>(null);
  const [items, setItems] = React.useState<ActivePracticeItem[]>([]);
  const [currentIndex, setCurrentIndex] = React.useState(0);
  const [answers, setAnswers] = React.useState<
    Record<string, PracticeAnswerState>
  >({});
  const [starredIds, setStarredIds] = React.useState<Set<string>>(
    () => new Set(),
  );
  const [navSheetOpen, setNavSheetOpen] = React.useState(false);
  const [sessionStartedAt, setSessionStartedAt] = React.useState<number>(0);
  const [elapsedSeconds, setElapsedSeconds] = React.useState<number>(0);

  const autoNextTimerRef = React.useRef<number | null>(null);
  const clearAutoNextTimer = React.useCallback(() => {
    if (autoNextTimerRef.current !== null) {
      window.clearTimeout(autoNextTimerRef.current);
      autoNextTimerRef.current = null;
    }
  }, []);

  React.useEffect(() => {
    return () => {
      clearAutoNextTimer();
    };
  }, [clearAutoNextTimer]);

  // Load accessible sets & folders
  const setsQuery = useQuery({
    queryKey: ["accessible-sets-all"],
    queryFn: () => fetchAccessibleSets(),
    staleTime: 60_000,
  });

  const foldersQuery = useQuery({
    queryKey: ["accessible-folders-all"],
    queryFn: () => fetchAccessibleFolders(),
    staleTime: 60_000,
  });

  const activeSets = React.useMemo(
    () =>
      (setsQuery.data ?? []).filter(
        (s) => !s.is_archived && s.question_count > 0,
      ),
    [setsQuery.data],
  );

  const folders = React.useMemo(
    () => foldersQuery.data ?? [],
    [foldersQuery.data],
  );

  // Build canonical ExamSourceInput[]
  const sources = React.useMemo<ExamSourceInput[]>(() => {
    const list: ExamSourceInput[] = [];
    for (const folderId of selectedFolderIds) {
      list.push({
        source_type: "folder",
        id: folderId,
        include_subfolders: true,
      });
    }
    for (const setId of selectedSetIds) {
      list.push({
        source_type: "study_set",
        id: setId,
      });
    }
    return list;
  }, [selectedFolderIds, selectedSetIds]);

  const activeFilters = React.useMemo<ExamFilterConfig>(() => {
    const f: ExamFilterConfig = {};
    if (selectedChapters.length > 0) f.chapters = selectedChapters;
    if (selectedDifficulties.length > 0) f.difficulties = selectedDifficulties;
    if (selectedTypes.length > 0) f.question_types = selectedTypes;
    return f;
  }, [selectedChapters, selectedDifficulties, selectedTypes]);

  // Live deduplicated eligible question count from server
  const eligibleQuery = useQuery({
    queryKey: [
      "practice-eligible-pool",
      selectedFolderIds,
      selectedSetIds,
      selectionPolicy,
      activeFilters,
    ],
    queryFn: () =>
      fetchExamEligiblePool({
        sources,
        selection_policy: selectionPolicy,
        filters: activeFilters,
      }),
    enabled: phase === "setup" && sources.length > 0,
    staleTime: 15_000,
  });

  const eligiblePool = eligibleQuery.data ?? null;
  const totalEligible = eligiblePool?.total_eligible ?? 0;

  // Auto-clamp untouched/stale positive integer count when eligible pool loads or shrinks below it,
  // while preserving strict validation on explicit out-of-range user edits against the current pool.
  const resolvedCustomCountInput = React.useMemo(() => {
    if (countMode === "all" || totalEligible <= 0) return customCountInput;
    if (countEditedAtPool === totalEligible) return customCountInput;
    const trimmed = customCountInput.trim();
    if (/^\d+$/.test(trimmed)) {
      const parsed = Number(trimmed);
      if (Number.isSafeInteger(parsed) && parsed > totalEligible) {
        return String(totalEligible);
      }
    }
    return customCountInput;
  }, [countEditedAtPool, countMode, customCountInput, totalEligible]);

  // Validate requested subset size strictly without silent reduction
  const countValidation = React.useMemo(() => {
    if (sources.length === 0) {
      return { valid: false, value: 0, error: null as string | null };
    }
    if (countMode === "all") {
      if (totalEligible <= 0) {
        return {
          valid: false,
          value: 0,
          error: lText(
            locale,
            "Không có câu hỏi nào phù hợp với bộ lọc hiện tại.",
            "No questions match the current filters.",
          ),
        };
      }
      const cappedAll = Math.min(totalEligible, MAX_PRACTICE_QUESTIONS);
      return { valid: true, value: cappedAll, error: null };
    }

    const res = validateQuestionCount(
      resolvedCustomCountInput.trim(),
      totalEligible,
      MAX_PRACTICE_QUESTIONS,
    );
    if (!res.valid) {
      let msg = res.message ?? "";
      if (res.code === "EXCEEDS_AVAILABLE") {
        msg = lText(
          locale,
          `Số câu yêu cầu (${resolvedCustomCountInput.trim()}) vượt quá số câu hợp lệ hiện có (${totalEligible}). Hãy giảm số câu hoặc bỏ bớt bộ lọc.`,
          `Requested count (${resolvedCustomCountInput.trim()}) exceeds available questions (${totalEligible}). Reduce count or relax filters.`,
        );
      } else if (
        res.code === "NON_POSITIVE" ||
        res.code === "NON_INTEGER" ||
        res.code === "INVALID_NUMBER"
      ) {
        msg = lText(
          locale,
          "Vui lòng nhập số nguyên dương hợp lệ (ví dụ: 20, 50, 100).",
          "Please enter a valid positive integer (e.g., 20, 50, 100).",
        );
      } else if (res.code === "EXCEEDS_MAX_LIMIT") {
        msg = lText(
          locale,
          `Tối đa ${MAX_PRACTICE_QUESTIONS} câu mỗi phiên luyện tập.`,
          `Maximum ${MAX_PRACTICE_QUESTIONS} questions per practice session.`,
        );
      } else if (res.code === "NO_ELIGIBLE_QUESTIONS") {
        msg = lText(
          locale,
          "Không có câu hỏi nào phù hợp với bộ lọc hiện tại.",
          "No questions match the current filters.",
        );
      }
      return { valid: false, value: 0, error: msg };
    }

    return { valid: true, value: res.value ?? 0, error: null };
  }, [countMode, locale, resolvedCustomCountInput, sources.length, totalEligible]);

  // Filtered sets list for search UI
  const filteredSets = React.useMemo(() => {
    const q = sourceSearch.trim().toLowerCase();
    if (!q) return activeSets;
    return activeSets.filter(
      (s) =>
        s.title.toLowerCase().includes(q) ||
        (s.subject ?? "").toLowerCase().includes(q),
    );
  }, [activeSets, sourceSearch]);

  // Deduplicated chapter options across selected sources
  const availableChapters = React.useMemo(() => {
    const seen = new Map<
      string,
      { chapter: string; count: number; subjectTitles: string[] }
    >();
    for (const ch of eligiblePool?.chapters ?? []) {
      const existing = seen.get(ch.chapter);
      if (existing) {
        existing.count += ch.count;
        if (!existing.subjectTitles.includes(ch.subject_title)) {
          existing.subjectTitles.push(ch.subject_title);
        }
      } else {
        seen.set(ch.chapter, {
          chapter: ch.chapter,
          count: ch.count,
          subjectTitles: [ch.subject_title],
        });
      }
    }
    return Array.from(seen.values());
  }, [eligiblePool?.chapters]);

  const toggleSetSelection = React.useCallback((setId: string) => {
    setSelectedSetIds((prev) =>
      prev.includes(setId) ? prev.filter((id) => id !== setId) : [...prev, setId],
    );
  }, []);

  const toggleFolderSelection = React.useCallback((folderId: string) => {
    setSelectedFolderIds((prev) =>
      prev.includes(folderId)
        ? prev.filter((id) => id !== folderId)
        : [...prev, folderId],
    );
  }, []);

  const toggleChapterFilter = React.useCallback((chapter: string) => {
    setSelectedChapters((prev) =>
      prev.includes(chapter)
        ? prev.filter((c) => c !== chapter)
        : [...prev, chapter],
    );
  }, []);

  const toggleDifficultyFilter = React.useCallback((diff: DifficultyLevel) => {
    setSelectedDifficulties((prev) =>
      prev.includes(diff) ? prev.filter((d) => d !== diff) : [...prev, diff],
    );
  }, []);

  const toggleTypeFilter = React.useCallback((qtype: ExamQuestionType) => {
    setSelectedTypes((prev) =>
      prev.includes(qtype) ? prev.filter((t) => t !== qtype) : [...prev, qtype],
    );
  }, []);

  // Launch Custom Practice Session via POST /api/practice/questions
  const launchPractice = React.useCallback(
    async (overrideCount?: number | "all") => {
      if (sources.length === 0) {
        toast.error(
          lText(
            locale,
            "Vui lòng chọn ít nhất một học phần hoặc thư mục.",
            "Please select at least one study set or folder.",
          ),
        );
        return;
      }

      let requestedCount: number | null = null;
      if (overrideCount === "all") {
        requestedCount =
          totalEligible > 0
            ? Math.min(totalEligible, MAX_PRACTICE_QUESTIONS)
            : null;
      } else if (typeof overrideCount === "number") {
        requestedCount = overrideCount;
      } else if (countMode === "all") {
        requestedCount = Math.min(totalEligible, MAX_PRACTICE_QUESTIONS);
      } else {
        if (!countValidation.valid) {
          toast.error(
            countValidation.error ??
              lText(locale, "Số câu không hợp lệ.", "Invalid question count."),
          );
          return;
        }
        requestedCount = countValidation.value;
      }

      setIsLaunching(true);
      try {
        const res = await fetchPracticeQuestionPool({
          sources,
          mode: "practice",
          count: requestedCount,
          selection_policy: selectionPolicy,
          shuffle_questions: shuffleQ,
          filters: activeFilters,
          create_session: true,
        });

        if (res.questions.length === 0) {
          toast.error(
            lText(
              locale,
              "Không tìm thấy câu hỏi phù hợp. Hãy kiểm tra lại chính sách chọn câu hoặc bộ lọc.",
              "No matching questions found. Check your selection policy or filters.",
            ),
          );
          return;
        }

        const prepared: ActivePracticeItem[] = res.questions.map((q) => {
          const ordered = [...(q.options ?? [])].sort(
            (a, b) => a.position - b.position,
          );
          const finalOpts = shuffleA ? shuffleOptions(ordered) : ordered;
          return {
            question: q,
            displayedOptions: withOptionDisplayLabels(finalOpts),
          };
        });

        const initialStarred = new Set<string>();
        for (const q of res.questions) {
          if (q.is_starred) initialStarred.add(q.id);
        }

        clearAutoNextTimer();
        setItems(prepared);
        setAnswers({});
        setStarredIds(initialStarred);
        setCurrentIndex(0);
        setSessionId(res.session?.id ?? null);
        setSessionStartedAt(Date.now());
        setElapsedSeconds(0);
        setPhase("active");
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : t("common.errorGeneric"),
        );
      } finally {
        setIsLaunching(false);
      }
    },
    [
      activeFilters,
      clearAutoNextTimer,
      countMode,
      countValidation.error,
      countValidation.valid,
      countValidation.value,
      locale,
      selectionPolicy,
      shuffleA,
      shuffleQ,
      sources,
      t,
      totalEligible,
    ],
  );

  const currentItem = items[currentIndex];
  const currentAnswer: PracticeAnswerState = currentItem
    ? answers[currentItem.question.id] ?? {
        selectedOptionIds: [],
        typedAnswer: "",
        isSubmitted: false,
        isCorrect: false,
      }
    : {
        selectedOptionIds: [],
        typedAnswer: "",
        isSubmitted: false,
        isCorrect: false,
      };

  const finishPractice = React.useCallback(
    (answersSnapshot?: Record<string, PracticeAnswerState>) => {
      clearAutoNextTimer();
      const map = answersSnapshot ?? answers;
      const secs = Math.max(
        1,
        Math.round((Date.now() - sessionStartedAt) / 1000),
      );
      setElapsedSeconds(secs);
      setPhase("complete");
      playFeedbackSound("complete");

      if (sessionId) {
        const submittedList = Object.values(map).filter((a) => a.isSubmitted);
        const correctCount = submittedList.filter((a) => a.isCorrect).length;
        void updateStudySession(sessionId, {
          status: "completed",
          total_items: items.length,
          completed_items: submittedList.length,
          correct_items: correctCount,
          duration_seconds: secs,
        }).catch(() => {});
      }
    },
    [
      answers,
      clearAutoNextTimer,
      items.length,
      playFeedbackSound,
      sessionId,
      sessionStartedAt,
    ],
  );

  const persistAnswer = React.useCallback(
    async (
      question: PracticeQuestionItem,
      selectedOptionIds: string[],
      typedAnswer: string,
      isCorrect: boolean,
      confidence: ConfidenceLevel | null,
    ) => {
      try {
        if (sessionId) {
          await recordStudySessionAnswer(sessionId, {
            question_id: question.id,
            selected_option_ids: selectedOptionIds,
            typed_answer: typedAnswer || null,
            confidence,
            is_correct: isCorrect,
            update_progress: true,
          });
        } else {
          const prev = question.progress ?? null;
          const sm2 = applyConfidenceToSm2({
            previous: prev ?? undefined,
            isCorrect,
            confidence,
          }).next;
          await upsertQuestionProgress({
            study_set_id: question.study_set_id,
            question_id: question.id,
            is_correct: isCorrect,
            confidence,
            self_rating: isCorrect ? "good" : "again",
            ease_factor: sm2.ease_factor,
            interval_days: sm2.interval_days,
            repetitions: sm2.repetitions,
            next_review_at: sm2.next_review_at,
            mastery_level: sm2.mastery_level,
          });
        }
      } catch {
        // Non-blocking telemetry failure during local practice flow
      }
    },
    [sessionId],
  );

  const submitCurrentAnswer = React.useCallback(
    (overrideSelectedIds?: string[]) => {
      if (!currentItem) return;
      const q = currentItem.question;
      const existing = answers[q.id];
      if (existing?.isSubmitted) return;

      const selectedIds =
        overrideSelectedIds ?? existing?.selectedOptionIds ?? [];
      const typed = existing?.typedAnswer ?? "";
      const submittedConfidence = preferences.confidence_enabled
        ? (existing?.confidence ?? null)
        : null;

      let isCorrect = false;
      if (q.question_type === "short_answer") {
        if (!typed.trim()) return;
        const expected = getExpectedWriteAnswers(q);
        isCorrect = gradeWriteAnswer(typed, expected).isCorrect;
      } else {
        if (selectedIds.length === 0) return;
        const correctOptionIds = (q.options ?? [])
          .filter((opt) => opt.is_correct)
          .map((opt) => opt.id);
        isCorrect = gradeChoiceSelection(selectedIds, correctOptionIds);
      }

      const nextState: PracticeAnswerState = {
        selectedOptionIds: selectedIds,
        typedAnswer: typed,
        isSubmitted: true,
        isCorrect,
        confidence: submittedConfidence,
      };
      const nextAnswers = { ...answers, [q.id]: nextState };
      setAnswers(nextAnswers);
      playFeedbackSound(isCorrect ? "correct" : "wrong");

      void persistAnswer(q, selectedIds, typed, isCorrect, submittedConfidence);

      if (autoNext && isCorrect) {
        clearAutoNextTimer();
        autoNextTimerRef.current = window.setTimeout(() => {
          autoNextTimerRef.current = null;
          setCurrentIndex((prev) =>
            prev < items.length - 1 ? prev + 1 : prev,
          );
        }, 750);
      }
    },
    [
      answers,
      autoNext,
      clearAutoNextTimer,
      currentItem,
      items.length,
      persistAnswer,
      playFeedbackSound,
      preferences.confidence_enabled,
    ],
  );

  const handleToggleOption = React.useCallback(
    (optionId: string) => {
      if (!currentItem) return;
      const q = currentItem.question;
      const existing = answers[q.id];
      if (existing?.isSubmitted) return;

      const isMulti =
        q.question_type === "multiple_choice" ||
        (q.type_payload?.type === "image_choice" &&
          q.type_payload.selection_mode === "multiple");
      if (isMulti) {
        const prev = existing?.selectedOptionIds ?? [];
        const nextIds = prev.includes(optionId)
          ? prev.filter((id) => id !== optionId)
          : [...prev, optionId];
        setAnswers((map) => ({
          ...map,
          [q.id]: {
            selectedOptionIds: nextIds,
            typedAnswer: "",
            isSubmitted: false,
            isCorrect: false,
          },
        }));
      } else {
        submitCurrentAnswer([optionId]);
      }
    },
    [answers, currentItem, submitCurrentAnswer],
  );

  const handleToggleStar = React.useCallback(async () => {
    if (!currentItem) return;
    const qId = currentItem.question.id;
    const nextStarred = !starredIds.has(qId);
    setStarredIds((prev) => {
      const next = new Set(prev);
      if (nextStarred) next.add(qId);
      else next.delete(qId);
      return next;
    });
    try {
      if (nextStarred) {
        await toggleStarQuestion(qId, currentItem.question.study_set_id);
      } else {
        await unstarQuestion(qId);
      }
    } catch {
      // Revert on failure
      setStarredIds((prev) => {
        const next = new Set(prev);
        if (nextStarred) next.delete(qId);
        else next.add(qId);
        return next;
      });
      toast.error(t("common.errorGeneric"));
    }
  }, [currentItem, starredIds, t]);

  const handleSelectNavIndex = React.useCallback(
    (idx: number) => {
      clearAutoNextTimer();
      setCurrentIndex(idx);
      setNavSheetOpen(false);
    },
    [clearAutoNextTimer],
  );

  const handleRestartWrongOnly = React.useCallback(() => {
    const wrongItems = items.filter((item) => {
      const a = answers[item.question.id];
      return !a?.isSubmitted || !a.isCorrect;
    });
    if (wrongItems.length === 0) return;

    const reshuffled = wrongItems.map((item) => {
      const ordered = [...(item.question.options ?? [])].sort(
        (a, b) => a.position - b.position,
      );
      const finalOpts = shuffleA ? shuffleOptions(ordered) : ordered;
      return {
        question: item.question,
        displayedOptions: withOptionDisplayLabels(finalOpts),
      };
    });

    clearAutoNextTimer();
    setItems(reshuffled);
    setAnswers({});
    setCurrentIndex(0);
    setSessionId(null);
    setSessionStartedAt(Date.now());
    setElapsedSeconds(0);
    setPhase("active");
  }, [answers, clearAutoNextTimer, items, shuffleA]);

  // Keyboard shortcuts during active practice (strictly guarded against inputs/modals/sheets)
  React.useEffect(() => {
    if (phase !== "active" || !currentItem || navSheetOpen || optionLightbox) {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isEditableEventTarget(e.target)) return;
      if (document.querySelector('[role="dialog"]')) return;

      const key = e.key.toLowerCase();
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        clearAutoNextTimer();
        setCurrentIndex((prev) => Math.max(0, prev - 1));
        return;
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        clearAutoNextTimer();
        setCurrentIndex((prev) => Math.min(items.length - 1, prev + 1));
        return;
      }
      if (key === "s") {
        e.preventDefault();
        void handleToggleStar();
        return;
      }
      if (e.key === "Enter" && !isInteractiveControlTarget(e.target)) {
        if (currentAnswer.isSubmitted) {
          e.preventDefault();
          clearAutoNextTimer();
          if (currentIndex < items.length - 1) {
            setCurrentIndex((prev) => prev + 1);
          } else {
            finishPractice();
          }
        } else if (
          currentItem.question.question_type === "multiple_choice" &&
          currentAnswer.selectedOptionIds.length > 0
        ) {
          e.preventDefault();
          submitCurrentAnswer();
        }
        return;
      }

      if (
        !currentAnswer.isSubmitted &&
        currentItem.question.question_type !== "short_answer"
      ) {
        const num = Number(e.key);
        if (
          !Number.isNaN(num) &&
          num >= 1 &&
          num <= currentItem.displayedOptions.length
        ) {
          e.preventDefault();
          handleToggleOption(currentItem.displayedOptions[num - 1].id);
          return;
        }
        const letterIdx = key.charCodeAt(0) - 97;
        if (
          key.length === 1 &&
          letterIdx >= 0 &&
          letterIdx < currentItem.displayedOptions.length
        ) {
          e.preventDefault();
          handleToggleOption(currentItem.displayedOptions[letterIdx].id);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    clearAutoNextTimer,
    currentAnswer.isSubmitted,
    currentAnswer.selectedOptionIds.length,
    currentIndex,
    currentItem,
    finishPractice,
    handleToggleOption,
    handleToggleStar,
    items.length,
    navSheetOpen,
    optionLightbox,
    phase,
    submitCurrentAnswer,
  ]);

  // Navigator items for virtualized ExamNavigatorGrid (always called unconditionally!)
  const navigatorItems = React.useMemo<NavigatorQuestionItem[]>(() => {
    return items.map((item, idx) => {
      const a = answers[item.question.id];
      const isAnswered = Boolean(a?.isSubmitted);
      return {
        attemptQuestionId: item.question.id,
        position: idx + 1,
        isAnswered,
        isFlagged: starredIds.has(item.question.id),
        subjectId: item.question.study_set_id,
        subjectTitle: item.question.source_subject_title ?? null,
        practiceResult: isAnswered
          ? a.isCorrect
            ? "correct"
            : "incorrect"
          : null,
      };
    });
  }, [answers, items, starredIds]);

  // Per-subject breakdown for completion screen
  const completionSubjectStats = React.useMemo(() => {
    const map = new Map<
      string,
      { title: string; total: number; correct: number; wrong: number }
    >();
    for (const item of items) {
      const sid = item.question.study_set_id;
      const title =
        item.question.source_subject_title ??
        activeSets.find((s) => s.id === sid)?.title ??
        lText(locale, "Học phần", "Study Set");
      const a = answers[item.question.id];
      const entry = map.get(sid) ?? { title, total: 0, correct: 0, wrong: 0 };
      entry.total += 1;
      if (a?.isSubmitted) {
        if (a.isCorrect) entry.correct += 1;
        else entry.wrong += 1;
      }
      map.set(sid, entry);
    }
    return Array.from(map.entries()).map(([setId, stat]) => ({
      setId,
      ...stat,
      accuracy:
        stat.total > 0 ? Math.round((stat.correct / stat.total) * 100) : 0,
    }));
  }, [activeSets, answers, items, locale]);

  // Build deep-link to Exam Builder with currently selected sources
  const switchToExamHref = React.useMemo(() => {
    const qs = new URLSearchParams();
    if (selectedSetIds.length === 1 && selectedFolderIds.length === 0) {
      qs.set("setId", selectedSetIds[0]);
    } else if (selectedSetIds.length > 0) {
      qs.set("setIds", selectedSetIds.join(","));
    }
    if (selectedFolderIds.length === 1) {
      qs.set("folderId", selectedFolderIds[0]);
    }
    if (selectionPolicy !== "random") {
      qs.set("policy", selectionPolicy);
    }
    const str = qs.toString();
    return str ? `/exams/new?${str}` : "/exams/new";
  }, [selectedFolderIds, selectedSetIds, selectionPolicy]);

  // ============================================================================
  // RENDER: PHASE 1 — CUSTOM PRACTICE SETUP
  // ============================================================================
  if (phase === "setup") {
    const isSourcesLoading = setsQuery.isLoading || foldersQuery.isLoading;

    return (
      <div className="mx-auto w-full max-w-6xl space-y-6 pb-20 lg:pb-8">
        {/* Page Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight">
                {lText(
                  locale,
                  "Luyện tập trắc nghiệm tùy chỉnh",
                  "Custom Subset Practice",
                )}
              </h1>
              <Badge variant="secondary" className="gap-1">
                <BookOpen className="size-3" aria-hidden="true" />
                {lText(locale, "Không tính giờ · Hiện đáp án ngay", "Untimed · Instant Feedback")}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {lText(
                locale,
                "Chọn 1 hoặc nhiều học phần, lọc theo câu chưa làm / câu sai / câu gắn sao và luyện tập phản hồi tức thì cùng SM-2.",
                "Pick one or multiple subjects, filter by unseen / mistakes / starred questions, and practice with instant feedback and SM-2 tracking.",
              )}
            </p>
          </div>

          <Button variant="outline" asChild className="min-h-10 shrink-0">
            <Link href={switchToExamHref}>
              <ClipboardList className="size-4" aria-hidden="true" />
              {lText(locale, "Chuyển sang Thi thử tính giờ", "Switch to Timed Exam")}
            </Link>
          </Button>
        </div>

        {/* Quick Launch Strip when sources already have eligible questions */}
        {sources.length > 0 && totalEligible > 0 ? (
          <Card className="border-primary/25 bg-accent/30">
            <CardContent className="flex flex-col gap-3 py-3.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Zap className="size-4 text-primary" aria-hidden="true" />
                <span>
                  {lText(
                    locale,
                    `Luyện nhanh (${totalEligible} câu hợp lệ):`,
                    `Quick Practice (${totalEligible} eligible):`,
                  )}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {SUBSET_PRESETS.filter((n) => n < totalEligible).map((n) => (
                  <Button
                    key={n}
                    type="button"
                    size="sm"
                    variant="secondary"
                    className="min-h-9 tabular-nums"
                    disabled={isLaunching}
                    onClick={() => void launchPractice(n)}
                  >
                    {n} {lText(locale, "câu", "Q")}
                  </Button>
                ))}
                <Button
                  type="button"
                  size="sm"
                  className="min-h-9 tabular-nums"
                  disabled={isLaunching}
                  onClick={() => void launchPractice("all")}
                >
                  {isLaunching ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Play className="size-3.5" aria-hidden="true" />
                  )}
                  {lText(
                    locale,
                    `Tất cả (${Math.min(totalEligible, MAX_PRACTICE_QUESTIONS)})`,
                    `All (${Math.min(totalEligible, MAX_PRACTICE_QUESTIONS)})`,
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          {/* Left Column: Sources, Subset Size, Policy, Filters & Options */}
          <div className="space-y-6">
            {/* Step 1: Multi-Subject & Folder Picker */}
            <Card>
              <CardHeader className="pb-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Layers className="size-4 text-primary" aria-hidden="true" />
                    {lText(
                      locale,
                      "1. Chọn học phần & thư mục nguồn",
                      "1. Select Study Sets & Folders",
                    )}
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={activeSets.length === 0}
                      onClick={() =>
                        setSelectedSetIds(activeSets.map((s) => s.id))
                      }
                    >
                      {lText(locale, "Chọn tất cả", "Select all")}
                    </Button>
                    {selectedSetIds.length > 0 || selectedFolderIds.length > 0 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setSelectedSetIds([]);
                          setSelectedFolderIds([]);
                          setSelectedChapters([]);
                        }}
                      >
                        <X className="size-3.5" aria-hidden="true" />
                        {lText(locale, "Bỏ chọn", "Clear")}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {isSourcesLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-9 w-full" />
                    <Skeleton className="h-14 w-full" />
                    <Skeleton className="h-14 w-full" />
                  </div>
                ) : activeSets.length === 0 && folders.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                    <p>
                      {lText(
                        locale,
                        "Bạn chưa có học phần nào có câu hỏi để luyện tập.",
                        "You do not have any study sets with questions yet.",
                      )}
                    </p>
                    <Button asChild size="sm" className="mt-3">
                      <Link href="/sets/new">
                        {lText(locale, "Tạo học phần mới", "Create Study Set")}
                      </Link>
                    </Button>
                  </div>
                ) : (
                  <>
                    {/* Folders quick chips */}
                    {folders.length > 0 ? (
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-muted-foreground">
                          {lText(
                            locale,
                            "Thư mục (tự động gom cả thư mục con)",
                            "Folders (includes subfolders automatically)",
                          )}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {folders.map((folder) => {
                            const checked = selectedFolderIds.includes(folder.id);
                            return (
                              <button
                                key={folder.id}
                                type="button"
                                aria-pressed={checked}
                                onClick={() => toggleFolderSelection(folder.id)}
                                className={cn(
                                  "inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                                  checked
                                    ? "border-primary bg-primary/10 text-primary"
                                    : "border-border bg-card hover:bg-muted/60",
                                )}
                              >
                                <FolderIcon className="size-3.5" aria-hidden="true" />
                                <span>{folder.name}</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}

                    {/* Study sets search & list */}
                    <search className="relative block">
                      <Search
                        className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <Input
                        value={sourceSearch}
                        onChange={(e) => setSourceSearch(e.target.value)}
                        className="h-9 pl-9"
                        placeholder={lText(
                          locale,
                          "Tìm học phần theo tên hoặc môn học...",
                          "Search study sets by title or subject...",
                        )}
                      />
                    </search>

                    <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                      {filteredSets.map((set) => {
                        const checked = selectedSetIds.includes(set.id);
                        return (
                          <label
                            key={set.id}
                            className={cn(
                              "flex cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2.5 transition-colors",
                              checked
                                ? "border-primary/60 bg-primary/5"
                                : "border-border bg-card hover:bg-muted/50",
                            )}
                          >
                            <div className="flex min-w-0 items-center gap-3">
                              <Checkbox
                                checked={checked}
                                onCheckedChange={() => toggleSetSelection(set.id)}
                              />
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium">
                                  {set.title}
                                </p>
                                {set.subject ? (
                                  <p className="truncate text-xs text-muted-foreground">
                                    {set.subject}
                                  </p>
                                ) : null}
                              </div>
                            </div>
                            <Badge variant="secondary" className="shrink-0 tabular-nums">
                              {set.question_count} {lText(locale, "câu", "Q")}
                            </Badge>
                          </label>
                        );
                      })}
                      {filteredSets.length === 0 ? (
                        <p className="py-4 text-center text-xs text-muted-foreground">
                          {lText(
                            locale,
                            "Không tìm thấy học phần khớp từ khóa.",
                            "No study sets match your search.",
                          )}
                        </p>
                      ) : null}
                    </div>

                    {eligiblePool && eligiblePool.overlap_sets_removed > 0 ? (
                      <p className="flex items-center gap-1.5 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
                        <CheckCircle2 className="size-3.5 text-success shrink-0" aria-hidden="true" />
                        {lText(
                          locale,
                          `Đã tự động loại bỏ ${eligiblePool.overlap_sets_removed} học phần trùng lặp giữa thư mục và lựa chọn riêng lẻ (không đếm đúp).`,
                          `Automatically deduplicated ${eligiblePool.overlap_sets_removed} overlapping set(s) between folders and individual selections.`,
                        )}
                      </p>
                    ) : null}
                  </>
                )}
              </CardContent>
            </Card>

            {/* Step 2: Subset Count & Selection Policy */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <SlidersHorizontal
                    className="size-4 text-primary"
                    aria-hidden="true"
                  />
                  {lText(
                    locale,
                    "2. Số lượng câu & Chính sách chọn câu",
                    "2. Subset Size & Selection Policy",
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {/* Subset Size */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">
                    {lText(locale, "Số câu muốn luyện", "Number of Questions")}
                  </Label>
                  <div className="flex flex-wrap items-center gap-2">
                    {SUBSET_PRESETS.map((preset) => {
                      const active =
                        countMode === "custom" &&
                        resolvedCustomCountInput.trim() === String(preset);
                      return (
                        <Button
                          key={preset}
                          type="button"
                          size="sm"
                          variant={active ? "default" : "outline"}
                          className="min-h-9 tabular-nums"
                          onClick={() => {
                            setCountMode("custom");
                            setCustomCountInput(String(preset));
                            setCountEditedAtPool(
                              totalEligible > 0 ? totalEligible : null,
                            );
                          }}
                        >
                          {preset}
                        </Button>
                      );
                    })}
                    <Button
                      type="button"
                      size="sm"
                      variant={countMode === "all" ? "default" : "outline"}
                      className="min-h-9"
                      onClick={() => setCountMode("all")}
                    >
                      {lText(locale, "Tất cả", "All")}
                      {totalEligible > 0 ? ` (${totalEligible})` : ""}
                    </Button>
                    <div className="flex items-center gap-2">
                      <Input
                        type="text"
                        inputMode="numeric"
                        aria-label={lText(
                          locale,
                          "Nhập số câu tùy chỉnh",
                          "Custom question count",
                        )}
                        className="h-9 w-24 tabular-nums"
                        value={
                          countMode === "all"
                            ? String(totalEligible || "")
                            : resolvedCustomCountInput
                        }
                        onFocus={() => {
                          if (countMode === "all") {
                            setCountMode("custom");
                            setCustomCountInput(
                              String(Math.min(Math.max(totalEligible, 1), 250)),
                            );
                            setCountEditedAtPool(
                              totalEligible > 0 ? totalEligible : null,
                            );
                          }
                        }}
                        onChange={(e) => {
                          setCountMode("custom");
                          setCustomCountInput(e.target.value);
                          setCountEditedAtPool(
                            totalEligible > 0 ? totalEligible : null,
                          );
                        }}
                        placeholder="50"
                      />
                    </div>
                  </div>
                  {sources.length > 0 &&
                  !eligibleQuery.isLoading &&
                  countValidation.error ? (
                    <p
                      role="alert"
                      className="flex items-start gap-1.5 text-xs font-medium text-destructive"
                    >
                      <AlertCircle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                      <span>{countValidation.error}</span>
                    </p>
                  ) : null}
                </div>

                {/* Selection Policy */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">
                    {lText(locale, "Chính sách chọn câu", "Selection Policy")}
                  </Label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {PRACTICE_POLICIES.map((pol) => {
                      const active = selectionPolicy === pol.value;
                      return (
                        <button
                          key={pol.value}
                          type="button"
                          aria-pressed={active}
                          onClick={() => setSelectionPolicy(pol.value)}
                          className={cn(
                            "rounded-lg border p-3 text-left transition-colors",
                            active
                              ? "border-primary bg-primary/5 ring-1 ring-primary/30"
                              : "border-border bg-card hover:bg-muted/50",
                          )}
                        >
                          <p className="text-sm font-semibold">
                            {lText(locale, pol.viTitle, pol.enTitle)}
                          </p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {lText(locale, pol.viDesc, pol.enDesc)}
                          </p>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Optional Fine Filters (<details> disclosure) */}
                <details className="rounded-lg border border-border bg-muted/20 p-3">
                  <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium">
                    <span>
                      {lText(
                        locale,
                        "Bộ lọc nâng cao (Chương, Độ khó, Loại câu hỏi)",
                        "Advanced Filters (Chapters, Difficulty, Question Types)",
                      )}
                      {selectedChapters.length +
                        selectedDifficulties.length +
                        selectedTypes.length >
                      0
                        ? ` (${selectedChapters.length + selectedDifficulties.length + selectedTypes.length})`
                        : ""}
                    </span>
                    <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
                  </summary>

                  <div className="mt-4 space-y-4">
                    {/* Chapters */}
                    {availableChapters.length > 0 ? (
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-muted-foreground">
                          {lText(locale, "Chương", "Chapters")}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {availableChapters.map((ch) => {
                            const active = selectedChapters.includes(ch.chapter);
                            return (
                              <button
                                key={ch.chapter}
                                type="button"
                                aria-pressed={active}
                                onClick={() => toggleChapterFilter(ch.chapter)}
                                className={cn(
                                  "inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                                  active
                                    ? "border-primary bg-primary/10 text-primary"
                                    : "border-border bg-card hover:bg-muted",
                                )}
                              >
                                <span>{ch.chapter}</span>
                                <span className="text-muted-foreground tabular-nums">
                                  ({ch.count})
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ) : null}

                    {/* Difficulty */}
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-muted-foreground">
                        {lText(locale, "Độ khó", "Difficulty")}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {ALL_DIFFICULTIES.map((diff) => {
                          const active = selectedDifficulties.includes(diff);
                          const label =
                            diff === "easy"
                              ? lText(locale, "Dễ", "Easy")
                              : diff === "medium"
                                ? lText(locale, "Trung bình", "Medium")
                                : lText(locale, "Khó", "Hard");
                          return (
                            <button
                              key={diff}
                              type="button"
                              aria-pressed={active}
                              onClick={() => toggleDifficultyFilter(diff)}
                              className={cn(
                                "rounded-md border px-3 py-1 text-xs font-medium transition-colors",
                                active
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border bg-card hover:bg-muted",
                              )}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Question Types */}
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-muted-foreground">
                        {lText(locale, "Loại câu hỏi", "Question Types")}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {ALL_PRACTICE_TYPES.map((qtype) => {
                          const active = selectedTypes.includes(qtype);
                          const label =
                            qtype === "single_choice"
                              ? lText(locale, "1 đáp án", "Single Choice")
                              : qtype === "multiple_choice"
                                ? lText(locale, "Nhiều đáp án", "Multiple Choice")
                                : qtype === "true_false"
                                  ? lText(locale, "Đúng / Sai", "True / False")
                                  : lText(locale, "Tự luận ngắn", "Short Answer");
                          return (
                            <button
                              key={qtype}
                              type="button"
                              aria-pressed={active}
                              onClick={() => toggleTypeFilter(qtype)}
                              className={cn(
                                "rounded-md border px-3 py-1 text-xs font-medium transition-colors",
                                active
                                  ? "border-primary bg-primary/10 text-primary"
                                  : "border-border bg-card hover:bg-muted",
                              )}
                            >
                              {label}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </details>

                {/* Behavior Toggles */}
                <div className="grid gap-3 pt-1 sm:grid-cols-2">
                  <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
                    <Label htmlFor="cp-shuffle-q" className="cursor-pointer text-sm">
                      {lText(locale, "Trộn thứ tự câu hỏi", "Shuffle questions")}
                    </Label>
                    <Switch
                      id="cp-shuffle-q"
                      checked={shuffleQ}
                      onCheckedChange={setShuffleQ}
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
                    <Label htmlFor="cp-shuffle-a" className="cursor-pointer text-sm">
                      {lText(locale, "Trộn thứ tự đáp án", "Shuffle options")}
                    </Label>
                    <Switch
                      id="cp-shuffle-a"
                      checked={shuffleA}
                      onCheckedChange={setShuffleA}
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
                    <Label htmlFor="cp-explain" className="cursor-pointer text-sm">
                      {lText(locale, "Hiện giải thích ngay", "Instant explanation")}
                    </Label>
                    <Switch
                      id="cp-explain"
                      checked={showExplanation}
                      onCheckedChange={setShowExplanation}
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
                    <Label htmlFor="cp-autonext" className="cursor-pointer text-sm">
                      {lText(
                        locale,
                        "Tự chuyển câu khi đúng",
                        "Auto-advance on correct",
                      )}
                    </Label>
                    <Switch
                      id="cp-autonext"
                      checked={autoNext}
                      onCheckedChange={setAutoNext}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Right Column: Sticky Live Summary & Launch CTA */}
          <div className="space-y-4">
            <Card className="lg:sticky lg:top-20">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  {lText(locale, "Tóm tắt phiên luyện tập", "Practice Summary")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-border bg-muted/40 p-3">
                    <p className="text-xs text-muted-foreground">
                      {lText(locale, "Số câu hợp lệ", "Eligible Pool")}
                    </p>
                    <p className="mt-1 text-2xl font-bold tabular-nums">
                      {sources.length === 0 ? (
                        "0"
                      ) : eligibleQuery.isLoading ? (
                        <Loader2 className="mt-1 size-5 animate-spin text-muted-foreground" />
                      ) : (
                        totalEligible
                      )}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border bg-muted/40 p-3">
                    <p className="text-xs text-muted-foreground">
                      {lText(locale, "Sẽ luyện tập", "Session Size")}
                    </p>
                    <p className="mt-1 text-2xl font-bold text-primary tabular-nums">
                      {countValidation.valid ? countValidation.value : "—"}
                    </p>
                  </div>
                </div>

                {eligiblePool && eligiblePool.subjects.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      {lText(
                        locale,
                        `Các môn đã chọn (${eligiblePool.deduplicated_set_count})`,
                        `Selected Subjects (${eligiblePool.deduplicated_set_count})`,
                      )}
                    </p>
                    <div className="max-h-40 space-y-1.5 overflow-y-auto">
                      {eligiblePool.subjects.map((sub) => (
                        <div
                          key={sub.study_set_id}
                          className="flex items-center justify-between gap-2 text-xs"
                        >
                          <span className="truncate font-medium">
                            {sub.title}
                          </span>
                          <Badge variant="outline" className="shrink-0 tabular-nums">
                            {sub.eligible_count}
                          </Badge>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {lText(
                      locale,
                      "Chọn ít nhất 1 học phần hoặc thư mục ở bên trái để xem số lượng câu hợp lệ.",
                      "Select at least one study set or folder on the left to inspect your eligible question pool.",
                    )}
                  </p>
                )}

                <div className="space-y-2 border-t border-border pt-3">
                  <Button
                    type="button"
                    size="lg"
                    className="min-h-11 w-full"
                    disabled={
                      isLaunching ||
                      sources.length === 0 ||
                      eligibleQuery.isLoading ||
                      !countValidation.valid
                    }
                    onClick={() => void launchPractice()}
                  >
                    {isLaunching ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Play className="size-4" aria-hidden="true" />
                    )}
                    {lText(locale, "Bắt đầu luyện tập", "Start Practice")}
                  </Button>
                  <p className="text-center text-[11px] text-muted-foreground">
                    {lText(
                      locale,
                      "Không tính giờ · Đáp án hiển thị ngay · Cập nhật tiến độ SM-2 tự động",
                      "Untimed · Immediate feedback · Updates SM-2 progress automatically",
                    )}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================================
  // RENDER: PHASE 3 — PRACTICE COMPLETION SUMMARY
  // ============================================================================
  if (phase === "complete") {
    const submittedList = Object.values(answers).filter((a) => a.isSubmitted);
    const correctCount = submittedList.filter((a) => a.isCorrect).length;
    const wrongCount = submittedList.length - correctCount;
    const skippedCount = items.length - submittedList.length;
    const accuracy =
      items.length > 0 ? Math.round((correctCount / items.length) * 100) : 0;
    const incorrectOrSkippedCount = wrongCount + skippedCount;

    return (
      <div className="mx-auto w-full max-w-4xl space-y-6 py-4">
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto mb-2 flex size-14 items-center justify-center rounded-full bg-success-subtle text-success-subtle-foreground">
              <CheckCircle2 className="size-7" aria-hidden="true" />
            </div>
            <CardTitle className="text-2xl">
              {lText(locale, "Hoàn thành phiên luyện tập!", "Practice Complete!")}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {lText(
                locale,
                `Bạn đạt độ chính xác ${accuracy}% trong ${formatDuration(elapsedSeconds)}.`,
                `You achieved ${accuracy}% accuracy in ${formatDuration(elapsedSeconds)}.`,
              )}
            </p>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-border bg-success-subtle/60 p-3.5 text-center">
                <p className="text-xs font-medium text-success-subtle-foreground">
                  {t("study.correct")}
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums">
                  {correctCount}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-destructive-subtle/60 p-3.5 text-center">
                <p className="text-xs font-medium text-destructive-subtle-foreground">
                  {t("study.incorrect")}
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums">
                  {wrongCount}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-secondary/60 p-3.5 text-center">
                <p className="text-xs font-medium text-muted-foreground">
                  {lText(locale, "Bỏ qua", "Skipped")}
                </p>
                <p className="mt-1 text-2xl font-bold tabular-nums">
                  {skippedCount}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-card p-3.5 text-center">
                <p className="text-xs font-medium text-muted-foreground">
                  {t("study.timeSpent")}
                </p>
                <p className="mt-1 font-mono text-2xl font-bold tabular-nums">
                  {formatDuration(elapsedSeconds)}
                </p>
              </div>
            </div>

            {/* Per-Subject Breakdown when practicing multiple subjects */}
            {completionSubjectStats.length > 1 ? (
              <div className="space-y-2">
                <h2 className="text-sm font-semibold">
                  {lText(locale, "Kết quả theo từng môn học", "Accuracy by Subject")}
                </h2>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{lText(locale, "Môn học", "Subject")}</TableHead>
                        <TableHead className="text-right">
                          {lText(locale, "Đúng / Tổng", "Correct / Total")}
                        </TableHead>
                        <TableHead className="text-right">
                          {lText(locale, "Tỷ lệ đúng", "Accuracy")}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {completionSubjectStats.map((row) => (
                        <TableRow key={row.setId}>
                          <TableCell className="font-medium">
                            {row.title}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {row.correct} / {row.total}
                          </TableCell>
                          <TableCell className="text-right font-semibold tabular-nums">
                            {row.accuracy}%
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            ) : null}

            <div className="flex flex-wrap justify-center gap-3">
              {incorrectOrSkippedCount > 0 ? (
                <Button
                  type="button"
                  className="min-h-10"
                  onClick={handleRestartWrongOnly}
                >
                  <RotateCcw className="size-4" aria-hidden="true" />
                  {lText(
                    locale,
                    `Luyện lại câu sai / bỏ qua (${incorrectOrSkippedCount})`,
                    `Retry Missed Questions (${incorrectOrSkippedCount})`,
                  )}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                className="min-h-10"
                onClick={() => setPhase("setup")}
              >
                <SlidersHorizontal className="size-4" aria-hidden="true" />
                {lText(locale, "Đổi cấu hình luyện tập", "Configure New Practice")}
              </Button>
              <Button variant="outline" asChild className="min-h-10">
                <Link href={switchToExamHref}>
                  <ClipboardList className="size-4" aria-hidden="true" />
                  {lText(locale, "Thi thử với các môn này", "Take Timed Exam")}
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ============================================================================
  // RENDER: PHASE 2 — ACTIVE CUSTOM PRACTICE SESSION
  // ============================================================================
  const q = currentItem?.question;
  if (!currentItem || !q) {
    return (
      <div className="mx-auto max-w-2xl py-12 text-center">
        <Button type="button" onClick={() => setPhase("setup")}>
          {lText(locale, "Quay lại cấu hình", "Back to Setup")}
        </Button>
      </div>
    );
  }

  const isMultiCurrent =
    q.question_type === "multiple_choice" ||
    (q.type_payload?.type === "image_choice" &&
      q.type_payload.selection_mode === "multiple");
  const isImageChoiceLayout = q.question_type === "image_choice";

  const submittedValues = Object.values(answers).filter((a) => a.isSubmitted);
  const liveCorrect = submittedValues.filter((a) => a.isCorrect).length;
  const liveWrong = submittedValues.length - liveCorrect;
  const isStarred = starredIds.has(q.id);
  const expectedWriteAnswers =
    q.question_type === "short_answer" ? getExpectedWriteAnswers(q) : [];

  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 pb-20 lg:pb-6">
      {/* Compact Session Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-2.5 sm:px-4">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="min-h-9"
            onClick={() => {
              clearAutoNextTimer();
              setPhase("setup");
            }}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">
              {lText(locale, "Cấu hình", "Setup")}
            </span>
          </Button>
          <Badge variant="outline" className="tabular-nums">
            {lText(
              locale,
              `Câu ${currentIndex + 1} / ${items.length}`,
              `Q ${currentIndex + 1} / ${items.length}`,
            )}
          </Badge>
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-success tabular-nums">
            <CheckCircle2 className="size-3.5" aria-hidden="true" />
            {liveCorrect}
          </span>
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-destructive tabular-nums">
            <XCircle className="size-3.5" aria-hidden="true" />
            {liveWrong}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-10"
            aria-label={
              isStarred
                ? lText(locale, "Bỏ gắn sao câu này", "Remove star")
                : lText(locale, "Gắn sao câu này", "Star question")
            }
            aria-pressed={isStarred}
            onClick={() => void handleToggleStar()}
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

          {/* Mobile Navigator Sheet */}
          <Sheet open={navSheetOpen} onOpenChange={setNavSheetOpen}>
            <SheetTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-10 lg:hidden"
              >
                <Grid2X2 className="size-4" aria-hidden="true" />
                {lText(locale, "Danh sách", "Navigator")}
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[320px] sm:w-[360px]">
              <SheetHeader>
                <SheetTitle>
                  {lText(locale, "Điều hướng câu hỏi", "Question Navigator")}
                </SheetTitle>
              </SheetHeader>
              <div className="mt-4">
                {navSheetOpen ? (
                  <ExamNavigatorGrid
                    items={navigatorItems}
                    currentIndex={currentIndex}
                    onSelectIndex={handleSelectNavIndex}
                    mode="practice"
                  />
                ) : null}
              </div>
            </SheetContent>
          </Sheet>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="min-h-10"
            onClick={() => finishPractice()}
          >
            <Clock className="size-3.5" aria-hidden="true" />
            {lText(locale, "Kết thúc", "Finish")}
          </Button>
        </div>
      </div>

      {/* Main Content + Desktop Virtualized Navigator */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="space-y-4">
          <div key={q.id}>
            <Card>
                <CardContent className="space-y-5 p-5 sm:p-6">
                  {/* Context metadata badges */}
                  <div className="flex flex-wrap items-center gap-2">
                    {q.source_subject_title ? (
                      <Badge variant="secondary">
                        {q.source_subject_title}
                      </Badge>
                    ) : null}
                    {q.chapter ? (
                      <Badge variant="outline">{q.chapter}</Badge>
                    ) : null}
                    <Badge variant="outline" className="text-[11px]">
                      {q.question_type === "multiple_choice"
                        ? lText(locale, "Chọn nhiều đáp án", "Multiple Choice")
                        : q.question_type === "image_choice"
                          ? lText(locale, "Chọn đáp án hình ảnh", "Image Choice")
                          : q.question_type === "true_false"
                            ? lText(locale, "Đúng / Sai", "True / False")
                            : q.question_type === "short_answer"
                              ? lText(locale, "Tự luận ngắn", "Short Answer")
                              : lText(locale, "Trắc nghiệm", "Single Choice")}
                    </Badge>
                  </div>

                  {/* Question Prompt (RichText + KaTeX + Zoomable Lightbox + Audio) */}
                  <div className="space-y-3">
                    <div className="text-base font-medium leading-relaxed sm:text-lg">
                      <SafeRichText
                        rich={q.prompt_rich}
                        fallbackText={q.prompt}
                      />
                    </div>
                    {q.prompt_image_url ? (
                      <ZoomableImage
                        src={q.prompt_image_url}
                        alt={lText(
                          locale,
                          "Hình ảnh câu hỏi",
                          "Question illustration",
                        )}
                      />
                    ) : null}
                    {q.audio_url ? (
                      <AudioPlayer
                        src={q.audio_url}
                        transcript={q.audio_transcript}
                        compact
                        preload="metadata"
                      />
                    ) : null}
                  </div>

                  {/* Pre-answer Confidence Selector (synced with /settings) */}
                  <ConfidenceSelector
                    enabled={Boolean(preferences.confidence_enabled)}
                    disabled={currentAnswer.isSubmitted}
                    value={currentAnswer.confidence ?? null}
                    onChange={(nextConfidence) =>
                      setAnswers((prev) => ({
                        ...prev,
                        [q.id]: {
                          ...(prev[q.id] ?? {
                            selectedOptionIds: [],
                            typedAnswer: "",
                            isSubmitted: false,
                            isCorrect: false,
                          }),
                          confidence: nextConfidence,
                        },
                      }))
                    }
                    keyboardMode={
                      q.question_type === "short_answer" ? "letters" : "none"
                    }
                  />

                  {/* Answer Area */}
                  {q.question_type === "short_answer" ? (
                    <div className="space-y-3">
                      <Input
                        value={currentAnswer.typedAnswer}
                        readOnly={currentAnswer.isSubmitted}
                        onChange={(e) => {
                          if (currentAnswer.isSubmitted) return;
                          setAnswers((prev) => ({
                            ...prev,
                            [q.id]: {
                              ...currentAnswer,
                              typedAnswer: e.target.value,
                            },
                          }));
                        }}
                        onKeyDown={(e) => {
                          if (
                            e.key === "Enter" &&
                            !e.nativeEvent.isComposing &&
                            e.keyCode !== 229 &&
                            !currentAnswer.isSubmitted
                          ) {
                            e.preventDefault();
                            submitCurrentAnswer();
                          }
                        }}
                        placeholder={lText(
                          locale,
                          "Nhập câu trả lời của bạn...",
                          "Type your answer...",
                        )}
                        className="h-11"
                      />
                      {!currentAnswer.isSubmitted ? (
                        <Button
                          type="button"
                          disabled={!currentAnswer.typedAnswer.trim()}
                          onClick={() => submitCurrentAnswer()}
                        >
                          {lText(locale, "Kiểm tra đáp án", "Check Answer")}
                        </Button>
                      ) : null}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div
                        role={isMultiCurrent ? "group" : "radiogroup"}
                        aria-label={lText(
                          locale,
                          "Các lựa chọn đáp án",
                          "Answer options",
                        )}
                        className={
                          isImageChoiceLayout
                            ? "grid gap-3 sm:grid-cols-2"
                            : "space-y-2.5"
                        }
                      >
                        {currentItem.displayedOptions.map((opt) => {
                          const isSelected =
                            currentAnswer.selectedOptionIds.includes(opt.id);
                          const isCorrectOpt = opt.is_correct;
                          const revealed = currentAnswer.isSubmitted;
                          const hasOptImage = isSafeDisplayImageUrl(
                            opt.image_url,
                          );
                          const hasOptText =
                            opt.content.trim().length > 0 ||
                            Boolean(opt.content_rich);

                          let toneClass =
                            "border-border bg-card hover:bg-muted/60";
                          if (revealed) {
                            if (isCorrectOpt) {
                              toneClass =
                                "border-success bg-success-subtle/70 text-foreground";
                            } else if (isSelected && !isCorrectOpt) {
                              toneClass =
                                "border-destructive bg-destructive-subtle/70 text-foreground";
                            } else {
                              toneClass =
                                "border-border bg-card opacity-70";
                            }
                          } else if (isSelected) {
                            toneClass =
                              "border-primary bg-primary/10 ring-1 ring-primary/30";
                          }

                          return (
                            <div key={opt.id} className="relative">
                              <button
                                type="button"
                                role={isMultiCurrent ? "checkbox" : "radio"}
                                aria-checked={isSelected}
                                disabled={revealed}
                                onClick={() => handleToggleOption(opt.id)}
                                className={cn(
                                  "flex min-h-12 w-full flex-col items-stretch gap-2 rounded-xl border p-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                                  toneClass,
                                )}
                              >
                                <div className="flex w-full items-start gap-3">
                                  <span
                                    className={cn(
                                      "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border text-xs font-bold",
                                      revealed && isCorrectOpt
                                        ? "border-success bg-success text-success-foreground"
                                        : revealed &&
                                            isSelected &&
                                            !isCorrectOpt
                                          ? "border-destructive bg-destructive text-destructive-foreground"
                                          : isSelected
                                            ? "border-primary bg-primary text-primary-foreground"
                                            : "border-border bg-muted text-muted-foreground",
                                    )}
                                  >
                                    {opt.displayLabel}
                                  </span>
                                  <div className="min-w-0 flex-1 text-sm leading-relaxed sm:text-base">
                                    {hasOptText ? (
                                      <SafeRichText
                                        rich={opt.content_rich}
                                        fallbackText={opt.content}
                                        inline
                                      />
                                    ) : hasOptImage ? (
                                      <span className="text-xs text-muted-foreground">
                                        {lText(
                                          locale,
                                          `Hình phương án ${opt.displayLabel}`,
                                          `Option ${opt.displayLabel} image`,
                                        )}
                                      </span>
                                    ) : null}
                                  </div>
                                  {revealed && isCorrectOpt ? (
                                    <CheckCircle2
                                      className="mt-0.5 size-5 shrink-0 text-success"
                                      aria-hidden="true"
                                    />
                                  ) : revealed &&
                                    isSelected &&
                                    !isCorrectOpt ? (
                                    <XCircle
                                      className="mt-0.5 size-5 shrink-0 text-destructive"
                                      aria-hidden="true"
                                    />
                                  ) : null}
                                </div>

                                {hasOptImage ? (
                                  <div className="w-full pt-1">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      src={opt.image_url ?? ""}
                                      alt={
                                        opt.image_alt ||
                                        opt.content ||
                                        lText(
                                          locale,
                                          `Hình phương án ${opt.displayLabel}`,
                                          `Option ${opt.displayLabel} image`,
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
                                    `Phóng to hình phương án ${opt.displayLabel}`,
                                    `Zoom option ${opt.displayLabel} image`,
                                  )}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setOptionLightbox({
                                      src: opt.image_url!,
                                      alt:
                                        opt.image_alt ||
                                        opt.content ||
                                        lText(
                                          locale,
                                          `Hình phương án ${opt.displayLabel}`,
                                          `Option ${opt.displayLabel} image`,
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

                      {isMultiCurrent && !currentAnswer.isSubmitted ? (
                        <Button
                          type="button"
                          className="mt-2 min-h-10"
                          disabled={
                            currentAnswer.selectedOptionIds.length === 0
                          }
                          onClick={() => submitCurrentAnswer()}
                        >
                          {lText(locale, "Kiểm tra đáp án", "Check Answer")}
                        </Button>
                      ) : null}
                    </div>
                  )}

                  {/* Instant Feedback & Explanation Banner */}
                  {currentAnswer.isSubmitted ? (
                    <div
                      role="status"
                      className={cn(
                        "space-y-2 rounded-xl border p-4 text-sm",
                        currentAnswer.isCorrect
                          ? "border-success/50 bg-success-subtle/60"
                          : "border-destructive/50 bg-destructive-subtle/60",
                      )}
                    >
                      <div className="flex items-center gap-2 font-semibold">
                        {currentAnswer.isCorrect ? (
                          <>
                            <CheckCircle2
                              className="size-4 text-success"
                              aria-hidden="true"
                            />
                            <span className="text-success-subtle-foreground">
                              {lText(locale, "Chính xác!", "Correct!")}
                            </span>
                          </>
                        ) : (
                          <>
                            <XCircle
                              className="size-4 text-destructive"
                              aria-hidden="true"
                            />
                            <span className="text-destructive-subtle-foreground">
                              {lText(locale, "Chưa chính xác", "Incorrect")}
                            </span>
                          </>
                        )}
                      </div>

                      {!currentAnswer.isCorrect &&
                      q.question_type === "short_answer" &&
                      expectedWriteAnswers.length > 0 ? (
                        <p className="text-xs">
                          <span className="font-medium">
                            {lText(locale, "Đáp án đúng: ", "Accepted answer: ")}
                          </span>
                          {expectedWriteAnswers.join(" / ")}
                        </p>
                      ) : null}

                      {showExplanation &&
                      (q.explanation || q.explanation_rich) ? (
                        <div className="border-t border-border/50 pt-2 text-xs leading-relaxed text-foreground/90">
                          <span className="font-semibold">
                            {lText(locale, "Giải thích: ", "Explanation: ")}
                          </span>
                          <SafeRichText
                            rich={q.explanation_rich}
                            fallbackText={q.explanation}
                            inline
                          />
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {/* Personal Notes & Question Error Report Bar */}
                  <div className="border-t border-border/60 pt-3">
                    <QuestionNotesAndReportBar
                      key={q.id}
                      studySetId={q.study_set_id}
                      questionId={q.id}
                      showReportButton
                      compact
                    />
                  </div>
                </CardContent>
              </Card>
          </div>

          {/* Navigation Action Bar */}
          <div className="flex items-center justify-between gap-3">
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={currentIndex === 0}
              onClick={() => {
                clearAutoNextTimer();
                setCurrentIndex((prev) => Math.max(0, prev - 1));
              }}
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
              {lText(locale, "Câu trước", "Previous")}
            </Button>

            {currentIndex < items.length - 1 ? (
              <Button
                type="button"
                className="min-h-11"
                onClick={() => {
                  clearAutoNextTimer();
                  setCurrentIndex((prev) =>
                    Math.min(items.length - 1, prev + 1),
                  );
                }}
              >
                {lText(locale, "Câu tiếp theo", "Next Question")}
                <ChevronRight className="size-4" aria-hidden="true" />
              </Button>
            ) : (
              <Button
                type="button"
                className="min-h-11"
                onClick={() => finishPractice()}
              >
                <CheckCircle2 className="size-4" aria-hidden="true" />
                {lText(locale, "Xem tổng kết", "View Summary")}
              </Button>
            )}
          </div>
        </div>

        {/* Desktop Virtualized Question Navigator (Conditionally mounted ONLY on >=1024px — P1-4!) */}
        {isDesktopLg ? (
          <aside>
            <Card className="sticky top-20">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  {lText(locale, "Điều hướng câu hỏi", "Question Navigator")}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0">
                <ExamNavigatorGrid
                  items={navigatorItems}
                  currentIndex={currentIndex}
                  onSelectIndex={handleSelectNavIndex}
                  mode="practice"
                />
              </CardContent>
            </Card>
          </aside>
        ) : null}
      </div>

      <ImageLightbox
        open={Boolean(optionLightbox)}
        onOpenChange={(open) => {
          if (!open) setOptionLightbox(null);
        }}
        src={optionLightbox?.src}
        alt={optionLightbox?.alt}
      />
    </div>
  );
}
