"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Brain,
  CheckCheck,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Clock,
  Filter,
  Layers,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Shuffle,
  Star,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/lib/i18n";
import {
  fetchAccessibleSets,
  fetchDueQuestions,
  fetchMistakes,
  isSafeDisplayImageUrl,
  listExams,
  resolveMistake,
  toggleStarQuestion,
  unstarQuestion,
  upsertQuestionProgress,
  type DueQuestionItem,
  type MistakeItem,
} from "@/lib/learning/api-client";
import { calculateNextReview, isQuestionDue } from "@/lib/learning/sm2";
import { getExpectedWriteAnswers } from "@/lib/learning/write-grader";
import {
  V3_QUESTION_TYPES,
  type MasteryLevel,
  type QuestionType,
} from "@/types/domain";
import { cn } from "@/lib/utils";
import { lText } from "./learning-copy";
import { QuestionNotesAndReportBar } from "./QuestionNotesAndReportBar";
import { SafeRichText, ZoomableImage } from "./SafeRichText";

const QUESTION_TYPE_LABELS: Record<QuestionType, { vi: string; en: string }> = {
  single_choice: { vi: "Trắc nghiệm (1 đáp án)", en: "Single Choice" },
  multiple_choice: { vi: "Trắc nghiệm (nhiều đáp án)", en: "Multiple Choice" },
  true_false: { vi: "Đúng / Sai", en: "True / False" },
  flashcard: { vi: "Thẻ ghi nhớ", en: "Flashcard" },
  short_answer: { vi: "Trả lời ngắn", en: "Short Answer" },
  fill_in_blank: { vi: "Điền vào chỗ trống", en: "Fill in the Blank" },
  numerical: { vi: "Tính toán số", en: "Numerical" },
  image_choice: { vi: "Chọn hình ảnh", en: "Image Choice" },
  ordering: { vi: "Sắp xếp thứ tự", en: "Ordering" },
  matching: { vi: "Ghép cặp", en: "Matching" },
  image_hotspot: { vi: "Điểm trên hình ảnh", en: "Image Hotspot" },
  reading_passage: { vi: "Đọc hiểu", en: "Reading Passage" },
  listening: { vi: "Nghe hiểu", en: "Listening" },
};

const MASTERY_LABELS: Record<MasteryLevel, { vi: string; en: string }> = {
  new: { vi: "Mới", en: "New" },
  learning: { vi: "Đang học", en: "Learning" },
  familiar: { vi: "Quen thuộc", en: "Familiar" },
  mastered: { vi: "Thành thạo", en: "Mastered" },
};

export function ReviewMistakesClient() {
  const { locale, t } = useI18n();
  const queryClient = useQueryClient();

  // ALL 15 V3 Mistake Filters
  const [selectedSubject, setSelectedSubject] = React.useState<string>("all"); // 1
  const [selectedSetId, setSelectedSetId] = React.useState<string>("all"); // 2
  const [selectedChapter, setSelectedChapter] = React.useState<string>("all"); // 3
  const [selectedTagId, setSelectedTagId] = React.useState<string>("all"); // 4
  const [selectedQuestionType, setSelectedQuestionType] =
    React.useState<string>("all"); // 5
  const [daysFilter, setDaysFilter] = React.useState<string>("all"); // 6
  const [minWrongCount, setMinWrongCount] = React.useState<number>(1); // 7
  const [minConsecutiveWrong, setMinConsecutiveWrong] =
    React.useState<number>(0); // 8
  const [selectedExamAttemptId, setSelectedExamAttemptId] =
    React.useState<string>("all"); // 9
  const [onlyLowConfidence, setOnlyLowConfidence] = React.useState(false); // 10
  const [onlyHighConfWrong, setOnlyHighConfWrong] = React.useState(false); // 11
  const [onlyGuessCorrect, setOnlyGuessCorrect] = React.useState(false); // 12
  const [onlyDue, setOnlyDue] = React.useState(false); // 13
  const [onlyStarred, setOnlyStarred] = React.useState(false); // 14
  const [selectedMastery, setSelectedMastery] = React.useState<string>("all"); // 15

  // Historical vs Unresolved vs Corrected vs SM-2 Due tabs (NEVER deletes history!)
  const [activeTab, setActiveTab] = React.useState<string>("unresolved");

  // Inline Due SM-2 review state
  const [dueSessionActive, setDueSessionActive] = React.useState(false);
  const [dueIndex, setDueIndex] = React.useState(0);
  const [dueRevealed, setDueRevealed] = React.useState(false);

  const setsQuery = useQuery({
    queryKey: ["accessible-sets"],
    queryFn: () => fetchAccessibleSets(),
    staleTime: 60_000,
  });

  const recentExamsQuery = useQuery({
    queryKey: ["review-recent-exams"],
    queryFn: () => listExams({ status: "submitted", page: 1, pageSize: 20 }),
    staleTime: 60_000,
  });

  // Always load full mistake history (`includeResolved: true`) so Unresolved/Corrected/Historical tabs stay instant & accurate!
  const mistakesQuery = useQuery({
    queryKey: [
      "review-mistakes-v3",
      selectedSetId,
      selectedChapter,
      minWrongCount,
      daysFilter,
      selectedQuestionType,
      selectedMastery,
      selectedExamAttemptId,
      onlyHighConfWrong,
      onlyGuessCorrect,
      onlyLowConfidence,
      onlyDue,
      onlyStarred,
    ],
    queryFn: () =>
      fetchMistakes({
        studySetId: selectedSetId !== "all" ? selectedSetId : undefined,
        subject: selectedSubject !== "all" ? selectedSubject : undefined,
        chapter: selectedChapter !== "all" ? selectedChapter : undefined,
        tagId: selectedTagId !== "all" ? selectedTagId : undefined,
        questionType:
          selectedQuestionType !== "all"
            ? (selectedQuestionType as QuestionType)
            : undefined,
        minWrongCount,
        minConsecutiveWrong:
          minConsecutiveWrong > 0 ? minConsecutiveWrong : undefined,
        includeResolved: true,
        examAttemptId:
          selectedExamAttemptId !== "all" ? selectedExamAttemptId : undefined,
        highConfWrongOnly: onlyHighConfWrong || undefined,
        guessCorrectOnly: onlyGuessCorrect || undefined,
        lowConfidenceOnly: onlyLowConfidence || undefined,
        dueOnly: onlyDue || undefined,
        starredOnly: onlyStarred || undefined,
        masteryLevel:
          selectedMastery !== "all"
            ? (selectedMastery as MasteryLevel)
            : undefined,
        days: daysFilter !== "all" ? Number(daysFilter) : undefined,
        pageSize: 200,
      }),
  });

  const dueQuery = useQuery({
    queryKey: ["review-due", selectedSetId],
    queryFn: () =>
      fetchDueQuestions(selectedSetId !== "all" ? selectedSetId : undefined, 100),
  });

  const allSets = React.useMemo(() => setsQuery.data ?? [], [setsQuery.data]);
  const rawMistakes = React.useMemo(
    () => mistakesQuery.data?.items ?? [],
    [mistakesQuery.data?.items],
  );
  const dueItems = React.useMemo(() => dueQuery.data ?? [], [dueQuery.data]);

  const setMetaMap = React.useMemo(() => {
    const map = new Map<string, { title: string; subject: string | null }>();
    for (const s of allSets) {
      map.set(s.id, { title: s.title, subject: s.subject });
    }
    return map;
  }, [allSets]);

  const availableSubjects = React.useMemo(() => {
    const set = new Set<string>();
    for (const s of allSets) {
      if (s.subject?.trim()) set.add(s.subject.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [allSets]);

  const availableChapters = React.useMemo(() => {
    const set = new Set<string>();
    for (const item of rawMistakes) {
      const ch = item.chapter ?? item.question?.chapter;
      if (ch && ch.trim()) set.add(ch.trim());
    }
    return Array.from(set);
  }, [rawMistakes]);

  const availableTags = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const item of rawMistakes) {
      for (const tag of item.question?.tags ?? []) {
        if (!map.has(tag.id)) map.set(tag.id, tag.name);
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [rawMistakes]);

  // Deterministic client-side filter enforcement across ALL 15 criteria (guarantees 100% accuracy!)
  const filteredMistakes = React.useMemo(() => {
    const now = new Date();
    const cutoffMs =
      daysFilter !== "all"
        ? now.getTime() - Number(daysFilter) * 86_400_000
        : null;

    return rawMistakes.filter((item) => {
      const setMeta = setMetaMap.get(item.study_set_id);
      const itemSubject = (item.subject ?? setMeta?.subject ?? "").trim();

      if (selectedSubject !== "all" && itemSubject !== selectedSubject) {
        return false;
      }
      if (selectedSetId !== "all" && item.study_set_id !== selectedSetId) {
        return false;
      }
      if (
        selectedChapter !== "all" &&
        (item.chapter ?? item.question?.chapter ?? "").trim() !== selectedChapter
      ) {
        return false;
      }
      if (selectedTagId !== "all") {
        const hasTag = (item.question?.tags ?? []).some(
          (tag) => tag.id === selectedTagId,
        );
        if (!hasTag) return false;
      }
      if (
        selectedQuestionType !== "all" &&
        item.question?.question_type !== selectedQuestionType
      ) {
        return false;
      }
      if (cutoffMs !== null && item.last_wrong_at) {
        const wrongMs = Date.parse(item.last_wrong_at);
        if (!Number.isNaN(wrongMs) && wrongMs < cutoffMs) return false;
      }
      if (item.wrong_count < minWrongCount) return false;
      if ((item.consecutive_wrong ?? 0) < minConsecutiveWrong) return false;
      if (
        selectedExamAttemptId !== "all" &&
        item.recent_exam_attempt_id &&
        item.recent_exam_attempt_id !== selectedExamAttemptId
      ) {
        return false;
      }
      if (onlyLowConfidence) {
        const lowConf =
          item.last_confidence === "unsure" ||
          item.last_confidence === "guessing" ||
          (item.low_confidence_count ?? 0) > 0;
        if (!lowConf) return false;
      }
      if (onlyHighConfWrong && (item.high_conf_wrong_count ?? 0) === 0) {
        return false;
      }
      if (onlyGuessCorrect && (item.guess_correct_count ?? 0) === 0) {
        return false;
      }
      if (
        onlyDue &&
        !isQuestionDue({ next_review_at: item.next_review_at ?? null }, now)
      ) {
        return false;
      }
      if (onlyStarred && !item.is_starred) return false;
      if (selectedMastery !== "all" && item.mastery_level !== selectedMastery) {
        return false;
      }
      return true;
    });
  }, [
    daysFilter,
    minConsecutiveWrong,
    minWrongCount,
    onlyDue,
    onlyGuessCorrect,
    onlyHighConfWrong,
    onlyLowConfidence,
    onlyStarred,
    rawMistakes,
    selectedChapter,
    selectedExamAttemptId,
    selectedMastery,
    selectedQuestionType,
    selectedSetId,
    selectedSubject,
    selectedTagId,
    setMetaMap,
  ]);

  const unresolvedItems = React.useMemo(
    () =>
      filteredMistakes.filter(
        (m) => m.needs_review || m.mistake_status === "active",
      ),
    [filteredMistakes],
  );
  const correctedItems = React.useMemo(
    () =>
      filteredMistakes.filter(
        (m) => !m.needs_review && m.mistake_status !== "active",
      ),
    [filteredMistakes],
  );
  const misconceptionCount = React.useMemo(
    () => filteredMistakes.filter((m) => (m.high_conf_wrong_count ?? 0) > 0).length,
    [filteredMistakes],
  );

  const visibleListForTab =
    activeTab === "unresolved"
      ? unresolvedItems
      : activeTab === "corrected"
        ? correctedItems
        : filteredMistakes;

  const activeAdvancedFilterCount =
    (selectedSubject !== "all" ? 1 : 0) +
    (selectedTagId !== "all" ? 1 : 0) +
    (selectedQuestionType !== "all" ? 1 : 0) +
    (minConsecutiveWrong > 0 ? 1 : 0) +
    (selectedExamAttemptId !== "all" ? 1 : 0) +
    (selectedMastery !== "all" ? 1 : 0) +
    (onlyLowConfidence ? 1 : 0) +
    (onlyHighConfWrong ? 1 : 0) +
    (onlyGuessCorrect ? 1 : 0) +
    (onlyDue ? 1 : 0) +
    (onlyStarred ? 1 : 0);

  const resetAllFilters = () => {
    setSelectedSubject("all");
    setSelectedSetId("all");
    setSelectedChapter("all");
    setSelectedTagId("all");
    setSelectedQuestionType("all");
    setDaysFilter("all");
    setMinWrongCount(1);
    setMinConsecutiveWrong(0);
    setSelectedExamAttemptId("all");
    setOnlyLowConfidence(false);
    setOnlyHighConfWrong(false);
    setOnlyGuessCorrect(false);
    setOnlyDue(false);
    setOnlyStarred(false);
    setSelectedMastery("all");
  };

  const handleResolve = React.useCallback(
    async (questionId: string) => {
      try {
        await resolveMistake(questionId);
        toast.success(
          lText(
            locale,
            "Đã đánh dấu câu hỏi là đã khắc phục (lịch sử vẫn được giữ nguyên).",
            "Marked as resolved (mistake history preserved).",
          ),
        );
        await queryClient.invalidateQueries({ queryKey: ["review-mistakes-v3"] });
      } catch {
        toast.error(t("common.errorGeneric"));
      }
    },
    [locale, queryClient, t],
  );

  const handleToggleStar = React.useCallback(
    async (item: MistakeItem) => {
      try {
        if (item.is_starred) {
          await unstarQuestion(item.question_id);
        } else {
          await toggleStarQuestion(item.question_id, item.study_set_id);
        }
        await queryClient.invalidateQueries({ queryKey: ["review-mistakes-v3"] });
        await queryClient.invalidateQueries({ queryKey: ["starred-questions"] });
      } catch {
        toast.error(t("common.errorGeneric"));
      }
    },
    [queryClient, t],
  );

  const handleRateDue = React.useCallback(
    async (item: DueQuestionItem, rating: "again" | "hard" | "good" | "easy") => {
      const nextSm2 = calculateNextReview(item.progress, rating);
      try {
        await upsertQuestionProgress({
          study_set_id: item.progress.study_set_id,
          question_id: item.question.id,
          is_correct: rating !== "again",
          self_rating: rating,
          mastery_level: nextSm2.mastery_level,
          ease_factor: nextSm2.ease_factor,
          interval_days: nextSm2.interval_days,
          repetitions: nextSm2.repetitions,
          next_review_at: nextSm2.next_review_at,
        });
      } catch {
        toast.error(t("common.errorGeneric"));
        return;
      }

      if (dueIndex + 1 >= dueItems.length) {
        setDueSessionActive(false);
        setDueIndex(0);
        setDueRevealed(false);
        toast.success(t("study.sessionComplete"));
        await queryClient.invalidateQueries({ queryKey: ["review-due"] });
      } else {
        setDueIndex((i) => i + 1);
        setDueRevealed(false);
      }
    },
    [dueIndex, dueItems.length, queryClient, t],
  );

  // Action deep links (preserving multi-subject SH-024!)
  const affectedSetIds = React.useMemo(() => {
    if (selectedSetId !== "all") return [selectedSetId];
    return Array.from(
      new Set(visibleListForTab.map((m) => m.study_set_id).filter(Boolean)),
    );
  }, [selectedSetId, visibleListForTab]);

  const buildActionHref = (
    base: "/practice" | "/exams/new",
    extra?: Record<string, string>,
  ) => {
    const qs = new URLSearchParams({ mode: "mistakes", ...(extra ?? {}) });
    if (selectedSetId !== "all") {
      qs.set("setId", selectedSetId);
    } else if (affectedSetIds.length > 0) {
      qs.set("setIds", affectedSetIds.join(","));
    }
    if (selectedChapter !== "all") {
      qs.set("chapter", selectedChapter);
    }
    return `${base}?${qs.toString()}`;
  };

  const primarySetForSingleMode =
    selectedSetId !== "all" ? selectedSetId : affectedSetIds[0] ?? null;

  const renderMistakeCard = (item: MistakeItem) => {
    const q = item.question;
    const setTitle =
      item.study_set_title ??
      setMetaMap.get(item.study_set_id)?.title ??
      lText(locale, "Học phần", "Study Set");
    const correctOptions = (q.options ?? []).filter((o) => o.is_correct);
    const wrongOptions = (q.options ?? []).filter((o) =>
      (item.last_selected_option_ids ?? []).includes(o.id),
    );
    const expectedWrite = getExpectedWriteAnswers(q);
    const audioSrc =
      q.audio_url ??
      (q.type_payload?.type === "listening" ? q.type_payload.audio_url : null);

    return (
      <Card key={item.question_id}>
        <CardContent className="space-y-4 p-5">
          {/* Badges & Top Actions */}
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary">{setTitle}</Badge>
              {item.chapter ? (
                <Badge variant="outline">{item.chapter}</Badge>
              ) : null}
              <Badge variant="outline" className="text-[11px]">
                {lText(
                  locale,
                  QUESTION_TYPE_LABELS[q.question_type]?.vi ?? q.question_type,
                  QUESTION_TYPE_LABELS[q.question_type]?.en ?? q.question_type,
                )}
              </Badge>
              <Badge variant="destructive" className="tabular-nums">
                {lText(
                  locale,
                  `Sai ${item.wrong_count} lần`,
                  `Wrong ${item.wrong_count}×`,
                )}
              </Badge>
              {(item.consecutive_wrong ?? 0) >= 2 ? (
                <Badge variant="destructive" className="text-[11px] tabular-nums">
                  {lText(
                    locale,
                    `Sai liên tiếp ${item.consecutive_wrong}`,
                    `${item.consecutive_wrong}× streak wrong`,
                  )}
                </Badge>
              ) : null}
              {(item.high_conf_wrong_count ?? 0) > 0 ? (
                <Badge
                  variant="warning"
                  className="gap-1 text-[11px]"
                >
                  <ShieldAlert className="size-3" aria-hidden="true" />
                  {lText(
                    locale,
                    `Sai tự tin cao (${item.high_conf_wrong_count})`,
                    `Misconception (${item.high_conf_wrong_count})`,
                  )}
                </Badge>
              ) : null}
              {(item.guess_correct_count ?? 0) > 0 ? (
                <Badge variant="outline" className="text-[11px]">
                  {lText(
                    locale,
                    `Đúng do đoán (${item.guess_correct_count})`,
                    `Guess hit (${item.guess_correct_count})`,
                  )}
                </Badge>
              ) : null}
              <Badge variant={item.needs_review ? "warning" : "success"}>
                {item.needs_review
                  ? lText(locale, "Chưa khắc phục", "Unresolved")
                  : lText(locale, "Đã khắc phục", "Corrected")}
              </Badge>
              <Badge variant="outline" className="text-[11px]">
                {lText(
                  locale,
                  MASTERY_LABELS[item.mastery_level]?.vi ?? item.mastery_level,
                  MASTERY_LABELS[item.mastery_level]?.en ?? item.mastery_level,
                )}
              </Badge>
            </div>

            <div className="flex items-center gap-1.5">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-9"
                aria-label={lText(locale, "Gắn sao câu này", "Toggle star")}
                aria-pressed={Boolean(item.is_starred)}
                onClick={() => void handleToggleStar(item)}
              >
                <Star
                  className={cn(
                    "size-4",
                    item.is_starred
                      ? "fill-warning text-warning"
                      : "text-muted-foreground",
                  )}
                  aria-hidden="true"
                />
              </Button>
              {item.needs_review ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-9 text-xs"
                  onClick={() => void handleResolve(item.question_id)}
                >
                  <CheckCheck className="size-3.5" aria-hidden="true" />
                  {lText(locale, "Đánh dấu đã hiểu", "Mark Resolved")}
                </Button>
              ) : null}
            </div>
          </div>

          {/* Original Prompt + Multimedia (lazy audio below fold per modern-web-guidance!) */}
          <div className="space-y-3">
            <SafeRichText
              rich={q.prompt_rich}
              fallbackText={q.prompt}
              className="text-sm font-medium leading-relaxed sm:text-base"
            />
            <ZoomableImage
              src={q.prompt_image_url}
              alt={lText(locale, "Hình ảnh câu hỏi", "Question image")}
              lazy
            />
            {isSafeDisplayImageUrl(audioSrc) ? (
              <audio
                controls
                preload="none"
                src={audioSrc}
                className="w-full max-w-md"
              />
            ) : null}
          </div>

          {/* Previous Wrong Answer vs Correct Answer */}
          <div className="grid gap-2.5 sm:grid-cols-2">
            {(wrongOptions.length > 0 || item.last_typed_answer) ? (
              <div className="rounded-lg border border-destructive/40 bg-destructive-subtle/40 p-3 text-xs">
                <p className="font-semibold text-destructive-subtle-foreground">
                  {lText(locale, "Câu trả lời sai gần nhất:", "Your last wrong answer:")}
                </p>
                <p className="mt-1 whitespace-pre-wrap text-foreground">
                  {wrongOptions.length > 0
                    ? wrongOptions.map((o) => o.content || o.label).join(" / ")
                    : item.last_typed_answer}
                </p>
              </div>
            ) : null}

            <div className="rounded-lg border border-success/40 bg-success-subtle/40 p-3 text-xs">
              <p className="font-semibold text-success-subtle-foreground">
                {lText(locale, "Đáp án đúng:", "Correct answer:")}
              </p>
              <p className="mt-1 whitespace-pre-wrap text-foreground">
                {correctOptions.length > 0
                  ? correctOptions.map((o) => o.content || o.label).join(" / ")
                  : expectedWrite.length > 0
                    ? expectedWrite.join(" / ")
                    : q.back_text || "—"}
              </p>
            </div>
          </div>

          {/* Explanation */}
          {q.explanation || q.explanation_rich ? (
            <div className="rounded-lg bg-secondary/50 p-3 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">
                {t("study.explanation")}:{" "}
              </span>
              <SafeRichText
                rich={q.explanation_rich}
                fallbackText={q.explanation}
              />
            </div>
          ) : null}

          {/* Timestamps & Personal Notes + Report Bar */}
          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
              {item.last_reviewed_at ? (
                <span>
                  {lText(locale, "Ôn gần nhất:", "Last reviewed:")}{" "}
                  {new Date(item.last_reviewed_at).toLocaleDateString(
                    locale === "vi" ? "vi-VN" : "en-US",
                  )}
                </span>
              ) : null}
              {item.last_confidence ? (
                <span>
                  {lText(locale, "Tự tin gần nhất:", "Last confidence:")}{" "}
                  <strong>
                    {item.last_confidence === "certain"
                      ? lText(locale, "Chắc chắn", "Certain")
                      : item.last_confidence === "unsure"
                        ? lText(locale, "Phân vân", "Unsure")
                        : lText(locale, "Đoán mò", "Guessing")}
                  </strong>
                </span>
              ) : null}
            </div>

            <QuestionNotesAndReportBar
              studySetId={item.study_set_id}
              questionId={item.question_id}
              compact
            />
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      {/* Header + Action Strip */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {lText(locale, "Ôn tập & Phân tích Câu sai", "Advanced Review & Mistakes")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {lText(
              locale,
              "15 bộ lọc chuyên sâu, tách biệt lỗi chưa khắc phục với toàn bộ lịch sử (không bao giờ xóa lịch sử sai), ghi chú cá nhân và ôn SM-2.",
              "15 targeted filters, separating unresolved errors from preserved history, personal notes, and SM-2 spaced repetition.",
            )}
          </p>
        </div>

        {affectedSetIds.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild className="min-h-10">
              <Link href={buildActionHref("/practice")}>
                <Play className="size-4" aria-hidden="true" />
                {lText(locale, "Luyện tất cả câu lọc", "Practice Filtered")}
              </Link>
            </Button>
            <Button variant="secondary" asChild className="min-h-10">
              <Link href={buildActionHref("/practice", { count: "20" })}>
                <Shuffle className="size-4" aria-hidden="true" />
                {lText(locale, "Luyện 20 câu ngẫu nhiên", "Practice 20 Random")}
              </Link>
            </Button>
            {primarySetForSingleMode ? (
              <>
                <Button variant="outline" asChild className="min-h-10">
                  <Link href={`/sets/${primarySetForSingleMode}/learn`}>
                    <Brain className="size-4" aria-hidden="true" />
                    {lText(locale, "Học thích ứng", "Learn")}
                  </Link>
                </Button>
                <Button variant="outline" asChild className="min-h-10">
                  <Link href={`/sets/${primarySetForSingleMode}/flashcards`}>
                    <Layers className="size-4" aria-hidden="true" />
                    {lText(locale, "Flashcards", "Flashcards")}
                  </Link>
                </Button>
              </>
            ) : null}
            <Button variant="outline" asChild className="min-h-10">
              <Link href={buildActionHref("/exams/new")}>
                <ClipboardList className="size-4" aria-hidden="true" />
                {lText(locale, "Thi thử câu sai", "Custom Exam")}
              </Link>
            </Button>
          </div>
        ) : null}
      </div>

      {/* KPI Summary Strip */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card>
          <CardContent className="flex items-center justify-between py-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                {lText(locale, "Chưa khắc phục", "Unresolved")}
              </p>
              <p className="mt-1 text-2xl font-bold text-destructive tabular-nums">
                {unresolvedItems.length}
              </p>
            </div>
            <div className="flex size-10 items-center justify-center rounded-lg bg-destructive-subtle text-destructive-subtle-foreground">
              <XCircle className="size-5" aria-hidden="true" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center justify-between py-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                {lText(locale, "Sai tự tin cao", "Misconceptions")}
              </p>
              <p className="mt-1 text-2xl font-bold text-warning-subtle-foreground tabular-nums">
                {misconceptionCount}
              </p>
            </div>
            <div className="flex size-10 items-center justify-center rounded-lg bg-warning-subtle text-warning-subtle-foreground">
              <ShieldAlert className="size-5" aria-hidden="true" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center justify-between py-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                {lText(locale, "Đã khắc phục", "Corrected")}
              </p>
              <p className="mt-1 text-2xl font-bold text-success tabular-nums">
                {correctedItems.length}
              </p>
            </div>
            <div className="flex size-10 items-center justify-center rounded-lg bg-success-subtle text-success-subtle-foreground">
              <CheckCheck className="size-5" aria-hidden="true" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center justify-between py-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                {lText(locale, "Đến hạn SM-2", "SM-2 Due")}
              </p>
              <p className="mt-1 text-2xl font-bold text-primary tabular-nums">
                {dueItems.length}
              </p>
            </div>
            <div className="flex size-10 items-center justify-center rounded-lg bg-accent text-accent-foreground">
              <Clock className="size-5" aria-hidden="true" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Primary + Collapsible 15-Filter Panel */}
      <Card>
        <CardContent className="space-y-4 py-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="rev-set" className="text-xs">
                {lText(locale, "Học phần", "Study Set")}
              </Label>
              <Select
                value={selectedSetId}
                onValueChange={(v) => {
                  setSelectedSetId(v);
                  setSelectedChapter("all");
                }}
              >
                <SelectTrigger id="rev-set" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {lText(locale, "Tất cả học phần", "All study sets")}
                  </SelectItem>
                  {allSets.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rev-chapter" className="text-xs">
                {lText(locale, "Chương", "Chapter")}
              </Label>
              <Select value={selectedChapter} onValueChange={setSelectedChapter}>
                <SelectTrigger id="rev-chapter" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {lText(locale, "Tất cả chương", "All chapters")}
                  </SelectItem>
                  {availableChapters.map((ch) => (
                    <SelectItem key={ch} value={ch}>
                      {ch}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rev-wrong-count" className="text-xs">
                {lText(locale, "Số lần sai tối thiểu", "Min Wrong Count")}
              </Label>
              <Select
                value={String(minWrongCount)}
                onValueChange={(v) => setMinWrongCount(Number(v))}
              >
                <SelectTrigger id="rev-wrong-count" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">&ge; 1</SelectItem>
                  <SelectItem value="2">&ge; 2</SelectItem>
                  <SelectItem value="3">&ge; 3</SelectItem>
                  <SelectItem value="5">&ge; 5</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rev-days" className="text-xs">
                {lText(locale, "Thời điểm sai gần nhất", "Last Wrong Date")}
              </Label>
              <Select value={daysFilter} onValueChange={setDaysFilter}>
                <SelectTrigger id="rev-days" className="h-9">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {lText(locale, "Mọi thời điểm", "All time")}
                  </SelectItem>
                  <SelectItem value="7">
                    {lText(locale, "7 ngày qua", "Last 7 days")}
                  </SelectItem>
                  <SelectItem value="14">
                    {lText(locale, "14 ngày qua", "Last 14 days")}
                  </SelectItem>
                  <SelectItem value="30">
                    {lText(locale, "30 ngày qua", "Last 30 days")}
                  </SelectItem>
                  <SelectItem value="90">
                    {lText(locale, "90 ngày qua", "Last 90 days")}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Native <details> Advanced Filter Drawer (11 more filters -> 15 total!) */}
          <details className="rounded-lg border border-border bg-secondary/20 p-3">
            <summary className="flex cursor-pointer list-none items-center justify-between text-xs font-semibold text-foreground">
              <span className="flex items-center gap-1.5">
                <Filter className="size-3.5 text-primary" aria-hidden="true" />
                {lText(
                  locale,
                  "Bộ lọc nâng cao (Môn học, Thẻ, Loại câu, Đề thi gần đây, Tự tin, SM-2...)",
                  "Advanced Filters (Subject, Tag, Question Type, Recent Exam, Confidence, Mastery...)",
                )}
                {activeAdvancedFilterCount > 0 ? (
                  <Badge variant="default" className="ml-1 text-[10px]">
                    {activeAdvancedFilterCount}
                  </Badge>
                ) : null}
              </span>
              <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
            </summary>

            <div className="mt-4 space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-1">
                  <Label htmlFor="rev-subject" className="text-xs">
                    {lText(locale, "Môn học", "Subject")}
                  </Label>
                  <Select value={selectedSubject} onValueChange={setSelectedSubject}>
                    <SelectTrigger id="rev-subject" className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">
                        {lText(locale, "Tất cả môn học", "All subjects")}
                      </SelectItem>
                      {availableSubjects.map((sub) => (
                        <SelectItem key={sub} value={sub}>
                          {sub}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="rev-tag" className="text-xs">
                    {lText(locale, "Thẻ (Tag)", "Tag")}
                  </Label>
                  <Select value={selectedTagId} onValueChange={setSelectedTagId}>
                    <SelectTrigger id="rev-tag" className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">
                        {lText(locale, "Tất cả thẻ", "All tags")}
                      </SelectItem>
                      {availableTags.map((tag) => (
                        <SelectItem key={tag.id} value={tag.id}>
                          #{tag.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="rev-qtype" className="text-xs">
                    {lText(locale, "Loại câu hỏi (13 dạng)", "Question Type")}
                  </Label>
                  <Select
                    value={selectedQuestionType}
                    onValueChange={setSelectedQuestionType}
                  >
                    <SelectTrigger id="rev-qtype" className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">
                        {lText(locale, "Tất cả loại câu", "All types")}
                      </SelectItem>
                      {V3_QUESTION_TYPES.map((qt) => (
                        <SelectItem key={qt} value={qt}>
                          {lText(
                            locale,
                            QUESTION_TYPE_LABELS[qt].vi,
                            QUESTION_TYPE_LABELS[qt].en,
                          )}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="rev-consec-wrong" className="text-xs">
                    {lText(locale, "Sai liên tiếp", "Consecutive Wrong")}
                  </Label>
                  <Select
                    value={String(minConsecutiveWrong)}
                    onValueChange={(v) => setMinConsecutiveWrong(Number(v))}
                  >
                    <SelectTrigger id="rev-consec-wrong" className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">
                        {lText(locale, "Bất kỳ", "Any")}
                      </SelectItem>
                      <SelectItem value="2">&ge; 2</SelectItem>
                      <SelectItem value="3">&ge; 3</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="rev-exam" className="text-xs">
                    {lText(locale, "Bài thi gần đây", "Recent Exam")}
                  </Label>
                  <Select
                    value={selectedExamAttemptId}
                    onValueChange={setSelectedExamAttemptId}
                  >
                    <SelectTrigger id="rev-exam" className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">
                        {lText(locale, "Tất cả bài thi", "All exams")}
                      </SelectItem>
                      {(recentExamsQuery.data ?? []).map((ex) => (
                        <SelectItem key={ex.id} value={ex.id}>
                          {ex.study_set_title_snapshot} ({ex.score_percent}%)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="rev-mastery" className="text-xs">
                    {lText(locale, "Trạng thái thành thạo", "Mastery State")}
                  </Label>
                  <Select value={selectedMastery} onValueChange={setSelectedMastery}>
                    <SelectTrigger id="rev-mastery" className="h-9 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">
                        {lText(locale, "Tất cả mức độ", "All mastery states")}
                      </SelectItem>
                      {(["new", "learning", "familiar", "mastered"] as const).map(
                        (m) => (
                          <SelectItem key={m} value={m}>
                            {lText(locale, MASTERY_LABELS[m].vi, MASTERY_LABELS[m].en)}
                          </SelectItem>
                        ),
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
                <div className="flex items-center justify-between rounded-md border border-border bg-card px-2.5 py-2 text-xs">
                  <Label htmlFor="rev-lowconf" className="cursor-pointer">
                    {lText(locale, "Tự tin thấp", "Low Confidence")}
                  </Label>
                  <Switch
                    id="rev-lowconf"
                    checked={onlyLowConfidence}
                    onCheckedChange={setOnlyLowConfidence}
                  />
                </div>
                <div className="flex items-center justify-between rounded-md border border-border bg-card px-2.5 py-2 text-xs">
                  <Label htmlFor="rev-highwrong" className="cursor-pointer">
                    {lText(locale, "Sai tự tin cao", "Misconceptions")}
                  </Label>
                  <Switch
                    id="rev-highwrong"
                    checked={onlyHighConfWrong}
                    onCheckedChange={setOnlyHighConfWrong}
                  />
                </div>
                <div className="flex items-center justify-between rounded-md border border-border bg-card px-2.5 py-2 text-xs">
                  <Label htmlFor="rev-guesshit" className="cursor-pointer">
                    {lText(locale, "Đúng do đoán", "Guess Hits")}
                  </Label>
                  <Switch
                    id="rev-guesshit"
                    checked={onlyGuessCorrect}
                    onCheckedChange={setOnlyGuessCorrect}
                  />
                </div>
                <div className="flex items-center justify-between rounded-md border border-border bg-card px-2.5 py-2 text-xs">
                  <Label htmlFor="rev-due" className="cursor-pointer">
                    {lText(locale, "Đến hạn SM-2", "SM-2 Due")}
                  </Label>
                  <Switch
                    id="rev-due"
                    checked={onlyDue}
                    onCheckedChange={setOnlyDue}
                  />
                </div>
                <div className="flex items-center justify-between rounded-md border border-border bg-card px-2.5 py-2 text-xs">
                  <Label htmlFor="rev-star" className="cursor-pointer">
                    {lText(locale, "Chỉ gắn sao", "Starred Only")}
                  </Label>
                  <Switch
                    id="rev-star"
                    checked={onlyStarred}
                    onCheckedChange={setOnlyStarred}
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-xs"
                  onClick={resetAllFilters}
                >
                  <RotateCcw className="size-3.5" aria-hidden="true" />
                  {lText(locale, "Đặt lại tất cả bộ lọc", "Reset all 15 filters")}
                </Button>
              </div>
            </div>
          </details>
        </CardContent>
      </Card>

      {/* Tabs: Unresolved / Corrected / Full Historical / SM-2 Due */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="overflow-x-auto pb-1">
          <TabsList className="inline-flex w-max flex-nowrap">
            <TabsTrigger value="unresolved">
              {lText(locale, "Chưa khắc phục", "Unresolved")} (
              {unresolvedItems.length})
            </TabsTrigger>
            <TabsTrigger value="corrected">
              {lText(locale, "Đã khắc phục", "Corrected")} (
              {correctedItems.length})
            </TabsTrigger>
            <TabsTrigger value="historical">
              {lText(locale, "Toàn bộ lịch sử", "All Historical")} (
              {filteredMistakes.length})
            </TabsTrigger>
            <TabsTrigger value="due">
              {lText(locale, "Đến hạn SM-2", "SM-2 Due")} ({dueItems.length})
            </TabsTrigger>
          </TabsList>
        </div>

        {(["unresolved", "corrected", "historical"] as const).map((tabKey) => {
          const list =
            tabKey === "unresolved"
              ? unresolvedItems
              : tabKey === "corrected"
                ? correctedItems
                : filteredMistakes;
          return (
            <TabsContent key={tabKey} value={tabKey} className="mt-4 space-y-3">
              {mistakesQuery.isLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-36 w-full" />
                  <Skeleton className="h-36 w-full" />
                </div>
              ) : mistakesQuery.isError ? (
                <Card>
                  <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
                    <AlertCircle className="size-8 text-destructive" aria-hidden="true" />
                    <p className="text-sm text-muted-foreground">
                      {t("common.errorGeneric")}
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void mistakesQuery.refetch()}
                    >
                      <RefreshCw className="size-4" aria-hidden="true" />
                      {t("common.retry")}
                    </Button>
                  </CardContent>
                </Card>
              ) : list.length === 0 ? (
                <Card>
                  <CardContent className="py-12 text-center">
                    <CheckCircle2
                      className="mx-auto mb-3 size-10 text-success"
                      aria-hidden="true"
                    />
                    <p className="font-medium">
                      {tabKey === "unresolved"
                        ? lText(
                            locale,
                            "Không còn lỗi sai nào chưa khắc phục trong bộ lọc này!",
                            "Zero unresolved mistakes in this filter!",
                          )
                        : lText(
                            locale,
                            "Không có mục nào khớp bộ lọc hiện tại.",
                            "No items match the current filters.",
                          )}
                    </p>
                  </CardContent>
                </Card>
              ) : (
                list.map(renderMistakeCard)
              )}
            </TabsContent>
          );
        })}

        {/* SM-2 Due Review Queue */}
        <TabsContent value="due" className="mt-4 space-y-4">
          {dueQuery.isLoading ? (
            <Skeleton className="h-44 w-full" />
          ) : dueItems.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <CheckCircle2
                  className="mx-auto mb-3 size-10 text-success"
                  aria-hidden="true"
                />
                <p className="font-medium">
                  {lText(
                    locale,
                    "Bạn đã hoàn thành toàn bộ lịch ôn SM-2 hôm nay!",
                    "You cleared your SM-2 due queue for today!",
                  )}
                </p>
              </CardContent>
            </Card>
          ) : dueSessionActive && dueItems[dueIndex] ? (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base tabular-nums">
                    {lText(
                      locale,
                      `Ôn tập SM-2 (${dueIndex + 1} / ${dueItems.length})`,
                      `SM-2 Review (${dueIndex + 1} / ${dueItems.length})`,
                    )}
                  </CardTitle>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setDueSessionActive(false)}
                  >
                    {lText(locale, "Đóng", "Close")}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <SafeRichText
                  rich={dueItems[dueIndex].question.prompt_rich}
                  fallbackText={dueItems[dueIndex].question.prompt}
                  className="text-base font-medium"
                />
                {!dueRevealed ? (
                  <Button type="button" onClick={() => setDueRevealed(true)}>
                    {lText(locale, "Hiện đáp án", "Reveal Answer")}
                  </Button>
                ) : (
                  <div className="space-y-4">
                    <div className="rounded-lg border border-primary/30 bg-accent/30 p-3.5 text-sm">
                      <SafeRichText
                        rich={dueItems[dueIndex].question.back_rich}
                        fallbackText={
                          dueItems[dueIndex].question.back_text ||
                          (dueItems[dueIndex].question.options ?? [])
                            .filter((o) => o.is_correct)
                            .map((o) => o.content)
                            .join(" / ") ||
                          getExpectedWriteAnswers(
                            dueItems[dueIndex].question,
                          ).join(" / ")
                        }
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      {(
                        [
                          { r: "again", vi: "Lại", en: "Again" },
                          { r: "hard", vi: "Khó", en: "Hard" },
                          { r: "good", vi: "Tốt", en: "Good" },
                          { r: "easy", vi: "Dễ", en: "Easy" },
                        ] as const
                      ).map((btn) => (
                        <Button
                          key={btn.r}
                          type="button"
                          variant={btn.r === "good" ? "default" : "outline"}
                          onClick={() =>
                            void handleRateDue(dueItems[dueIndex], btn.r)
                          }
                        >
                          {lText(locale, btn.vi, btn.en)}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
                <p className="text-sm text-muted-foreground">
                  {lText(
                    locale,
                    `Có ${dueItems.length} câu hỏi đến hạn ôn lặp lại ngắt quãng SM-2.`,
                    `You have ${dueItems.length} question(s) due for SM-2 spaced repetition.`,
                  )}
                </p>
                <Button
                  type="button"
                  onClick={() => {
                    setDueIndex(0);
                    setDueRevealed(false);
                    setDueSessionActive(true);
                  }}
                >
                  <Play className="size-4" aria-hidden="true" />
                  {lText(locale, "Bắt đầu phiên ôn SM-2 ngay", "Start SM-2 Review Now")}
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
