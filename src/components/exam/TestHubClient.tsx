"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ClipboardList,
  Clock,
  Layers,
  Loader2,
  Play,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { FocusModeShell } from "@/components/learning/FocusModeShell";
import { lText } from "@/components/learning/learning-copy";
import {
  StudyEmptyState,
  StudyErrorState,
  StudyLoadingSkeleton,
  useStudySetBundle,
} from "@/components/learning/useStudySetBundle";
import { useI18n } from "@/lib/i18n";
import {
  createExamAttempt,
  fetchAccessibleSets,
  listExams,
  type ExamAttemptPayload,
} from "@/lib/learning/api-client";
import {
  calculateRemainingMs,
  formatCountdownMs,
} from "@/lib/learning/exam-scoring";
import type { ExamQuestionType } from "@/types/domain";
import { LiveExamRunner } from "./LiveExamRunner";

interface TestHubClientProps {
  setId: string;
}

const ALL_EXAM_TYPES: ExamQuestionType[] = [
  "single_choice",
  "multiple_choice",
  "true_false",
  "short_answer",
];

export function TestHubClient({ setId }: TestHubClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { locale, t } = useI18n();

  const attemptIdParam = searchParams.get("attemptId");
  const initialOnlyMistakes = searchParams.get("onlyMistakes") === "true";
  const initialOnlyStarred = searchParams.get("onlyStarred") === "true";

  const [manualAttemptId, setManualAttemptId] = React.useState<string | null>(
    null,
  );
  const [createdPayload, setCreatedPayload] =
    React.useState<ExamAttemptPayload | null>(null);

  const activeAttemptId = manualAttemptId ?? attemptIdParam;

  const {
    data: bundle,
    isLoading,
    isError,
    error,
    refetch,
  } = useStudySetBundle(setId);

  const inProgressQuery = useQuery({
    queryKey: ["in-progress-exams", setId],
    queryFn: () => listExams({ studySetId: setId, status: "in_progress" }),
    enabled: !activeAttemptId,
    staleTime: 0,
  });

  const accessibleSetsQuery = useQuery({
    queryKey: ["accessible-sets"],
    queryFn: fetchAccessibleSets,
    enabled: !activeAttemptId,
    staleTime: 60_000,
  });

  // Builder Form State (nullable overrides fall back cleanly to studySet defaults without setState-in-effect)
  const [titleOverride, setTitleOverride] = React.useState<string | null>(null);
  const [extraSetIds, setExtraSetIds] = React.useState<string[]>([]);
  const [selectedChapters, setSelectedChapters] = React.useState<string[]>([]);
  const [questionCountPresetOverride, setQuestionCountPreset] = React.useState<
    "all" | "20" | "30" | "50" | "100" | "custom" | null
  >(null);
  const [customCount, setCustomCount] = React.useState<number>(30);
  const [timePresetOverride, setTimePreset] = React.useState<
    "none" | "15" | "30" | "45" | "60" | "90" | "custom" | null
  >(null);
  const [customMinutesOverride, setCustomMinutes] = React.useState<
    number | null
  >(null);
  const [shuffleQuestions, setShuffleQuestions] = React.useState<boolean>(true);
  const [shuffleOptions, setShuffleOptions] = React.useState<boolean>(true);
  const [selectedTypes, setSelectedTypes] =
    React.useState<ExamQuestionType[]>(ALL_EXAM_TYPES);
  const [onlyMistakes, setOnlyMistakes] =
    React.useState<boolean>(initialOnlyMistakes);
  const [onlyStarred, setOnlyStarred] =
    React.useState<boolean>(initialOnlyStarred);
  const [onlyUnmastered, setOnlyUnmastered] = React.useState<boolean>(false);
  const [passThresholdOverride, setPassThreshold] = React.useState<
    number | null
  >(null);
  const [isCreating, setIsCreating] = React.useState<boolean>(false);

  const defaultMins = bundle?.studySet.default_exam_duration_minutes || 45;
  const defaultTimePreset: "15" | "30" | "45" | "60" | "90" | "custom" = [
    "15",
    "30",
    "45",
    "60",
    "90",
  ].includes(String(defaultMins))
    ? (String(defaultMins) as "15" | "30" | "45" | "60" | "90")
    : "custom";

  const title =
    titleOverride ??
    (bundle
      ? `${lText(locale, "Thi thử", "Mock Exam")} — ${bundle.studySet.title}`
      : "");
  const questionCountPreset =
    questionCountPresetOverride ??
    (bundle && bundle.questions.length > 0 && bundle.questions.length < 30
      ? "all"
      : "30");
  const timePreset = timePresetOverride ?? defaultTimePreset;
  const customMinutes = customMinutesOverride ?? defaultMins;
  const passThreshold =
    passThresholdOverride ?? (bundle?.studySet.default_pass_threshold || 70);

  // If currently taking an exam, render LiveExamRunner
  if (activeAttemptId) {
    return (
      <LiveExamRunner
        setId={setId}
        attemptId={activeAttemptId}
        initialPayload={createdPayload}
      />
    );
  }

  if (isLoading) {
    return (
      <FocusModeShell backHref={`/sets/${setId}`} title={t("exam.setupTitle")}>
        <StudyLoadingSkeleton />
      </FocusModeShell>
    );
  }

  if (isError || !bundle) {
    return (
      <FocusModeShell backHref={`/sets/${setId}`} title={t("exam.setupTitle")}>
        <StudyErrorState
          message={error instanceof Error ? error.message : undefined}
          onRetry={() => void refetch()}
          backHref={`/sets/${setId}`}
        />
      </FocusModeShell>
    );
  }

  if (bundle.questions.length === 0) {
    return (
      <FocusModeShell
        backHref={`/sets/${setId}`}
        title={bundle.studySet.title}
        subtitle={t("exam.setupTitle")}
      >
        <StudyEmptyState setId={setId} />
      </FocusModeShell>
    );
  }

  const activeResumeAttempts = (inProgressQuery.data ?? []).filter((att) => {
    if (att.status !== "in_progress") return false;
    if (!att.expires_at) return true;
    const rem = calculateRemainingMs(att.expires_at);
    return rem === null || rem > 0;
  });

  const otherSets = (accessibleSetsQuery.data ?? []).filter(
    (s) => s.id !== setId && s.question_count > 0,
  );

  const toggleChapter = (chapter: string) => {
    setSelectedChapters((prev) =>
      prev.includes(chapter)
        ? prev.filter((c) => c !== chapter)
        : [...prev, chapter],
    );
  };

  const toggleExtraSet = (id: string) => {
    setExtraSetIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const toggleQuestionType = (qt: ExamQuestionType) => {
    setSelectedTypes((prev) => {
      if (prev.includes(qt)) {
        return prev.length > 1 ? prev.filter((x) => x !== qt) : prev;
      }
      return [...prev, qt];
    });
  };

  const resolvedQuestionCount = (() => {
    if (questionCountPreset === "all") {
      return Math.min(500, Math.max(1, bundle.questions.length + extraSetIds.length * 100));
    }
    if (questionCountPreset === "custom") {
      return Math.min(500, Math.max(1, customCount));
    }
    return Number(questionCountPreset);
  })();

  const resolvedDurationSeconds = (() => {
    if (timePreset === "none") return null;
    if (timePreset === "custom") return Math.max(60, customMinutes * 60);
    return Number(timePreset) * 60;
  })();

  const handleStartExam = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);
    try {
      const payload = await createExamAttempt({
        study_set_id: setId,
        additional_study_set_ids:
          extraSetIds.length > 0 ? extraSetIds : undefined,
        title: title.trim() || undefined,
        question_count: resolvedQuestionCount,
        duration_limit_seconds: resolvedDurationSeconds,
        shuffle_questions: shuffleQuestions,
        shuffle_options: shuffleOptions,
        pass_threshold: Math.min(100, Math.max(1, passThreshold)),
        chapters: selectedChapters.length > 0 ? selectedChapters : undefined,
        question_types:
          selectedTypes.length < ALL_EXAM_TYPES.length
            ? selectedTypes
            : undefined,
        only_mistakes: onlyMistakes,
        only_starred: onlyStarred,
        only_unmastered: onlyUnmastered,
      });

      setCreatedPayload(payload);
      setManualAttemptId(payload.attempt.id);
      router.replace(`/sets/${setId}/test?attemptId=${payload.attempt.id}`);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : lText(
              locale,
              "Không thể tạo bài thi với bộ lọc hiện tại.",
              "Could not generate exam with the selected filters.",
            ),
      );
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <FocusModeShell
      backHref={`/sets/${setId}`}
      title={bundle.studySet.title}
      subtitle={t("exam.setupTitle")}
    >
      <div className="mx-auto w-full max-w-3xl space-y-6">
        {/* Resume In-Progress Exam Banner */}
        {activeResumeAttempts.length > 0 ? (
          <Card className="border-primary/40 bg-accent/50">
            <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant="default">
                    {lText(locale, "Đang làm dở", "In Progress")}
                  </Badge>
                  <span className="text-sm font-semibold">
                    {activeResumeAttempts[0].study_set_title_snapshot}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {lText(locale, "Đã trả lời", "Answered")}:{" "}
                  {activeResumeAttempts[0].answered_count}/
                  {activeResumeAttempts[0].total_questions}
                  {activeResumeAttempts[0].expires_at
                    ? ` · ${lText(locale, "Còn lại", "Remaining")}: ${formatCountdownMs(
                        calculateRemainingMs(activeResumeAttempts[0].expires_at) ?? 0,
                      )}`
                    : ""}
                </p>
              </div>
              <Button
                className="min-h-10 shrink-0"
                onClick={() => {
                  const id = activeResumeAttempts[0].id;
                  setManualAttemptId(id);
                  router.replace(`/sets/${setId}/test?attemptId=${id}`);
                }}
              >
                <RotateCcw className="size-4" aria-hidden="true" />
                {lText(locale, "Tiếp tục bài thi", "Resume Exam")}
              </Button>
            </CardContent>
          </Card>
        ) : null}

        {/* Exam Builder Form */}
        <form onSubmit={handleStartExam}>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <ClipboardList className="size-5 text-primary" aria-hidden="true" />
                {t("exam.setupTitle")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Exam Title */}
              <div className="space-y-2">
                <Label htmlFor="exam-title">
                  {lText(locale, "Tên bài thi", "Exam Title")}
                </Label>
                <Input
                  id="exam-title"
                  value={title}
                  onChange={(e) => setTitleOverride(e.target.value)}
                  maxLength={200}
                  placeholder={lText(
                    locale,
                    "Ví dụ: Thi thử giữa kỳ...",
                    "e.g., Midterm Mock Exam...",
                  )}
                />
              </div>

              {/* Question Count */}
              <div className="space-y-2">
                <Label>{t("exam.questionCount")}</Label>
                <div className="flex flex-wrap items-center gap-2">
                  {(
                    [
                      ["all", lText(locale, `Tất cả (${bundle.questions.length})`, `All (${bundle.questions.length})`)],
                      ["20", "20"],
                      ["30", "30"],
                      ["50", "50"],
                      ["100", "100"],
                      ["custom", lText(locale, "Tùy chỉnh", "Custom")],
                    ] as const
                  ).map(([val, label]) => (
                    <Button
                      key={val}
                      type="button"
                      variant={questionCountPreset === val ? "default" : "outline"}
                      size="sm"
                      className="min-h-10 tabular-nums"
                      aria-pressed={questionCountPreset === val}
                      onClick={() => setQuestionCountPreset(val)}
                    >
                      {label}
                    </Button>
                  ))}
                  {questionCountPreset === "custom" ? (
                    <Input
                      type="number"
                      min={1}
                      max={500}
                      value={customCount}
                      onChange={(e) =>
                        setCustomCount(Math.max(1, Number(e.target.value) || 1))
                      }
                      aria-label={lText(locale, "Số câu hỏi tùy chỉnh", "Custom question count")}
                      className="h-10 w-24 tabular-nums"
                    />
                  ) : null}
                </div>
              </div>

              {/* Time Limit */}
              <div className="space-y-2">
                <Label className="flex items-center gap-1.5">
                  <Clock className="size-4 text-muted-foreground" aria-hidden="true" />
                  {t("exam.timeLimitMinutes")}
                </Label>
                <div className="flex flex-wrap items-center gap-2">
                  {(
                    [
                      ["none", t("exam.noTimeLimit")],
                      ["15", "15m"],
                      ["30", "30m"],
                      ["45", "45m"],
                      ["60", "60m"],
                      ["90", "90m"],
                      ["custom", lText(locale, "Tùy chỉnh", "Custom")],
                    ] as const
                  ).map(([val, label]) => (
                    <Button
                      key={val}
                      type="button"
                      variant={timePreset === val ? "default" : "outline"}
                      size="sm"
                      className="min-h-10 tabular-nums"
                      aria-pressed={timePreset === val}
                      onClick={() => setTimePreset(val)}
                    >
                      {label}
                    </Button>
                  ))}
                  {timePreset === "custom" ? (
                    <Input
                      type="number"
                      min={1}
                      max={360}
                      value={customMinutes}
                      onChange={(e) =>
                        setCustomMinutes(Math.max(1, Number(e.target.value) || 1))
                      }
                      aria-label={lText(locale, "Số phút tùy chỉnh", "Custom minutes")}
                      className="h-10 w-24 tabular-nums"
                    />
                  ) : null}
                </div>
              </div>

              {/* Chapters Multi-Select */}
              {bundle.chapters.length > 0 ? (
                <div className="space-y-2">
                  <Label>
                    {lText(
                      locale,
                      "Lọc theo chương (bỏ trống để lấy tất cả)",
                      "Filter by chapters (leave empty for all)",
                    )}
                  </Label>
                  <div className="flex flex-wrap gap-2">
                    {bundle.chapters.map((ch) => {
                      const active = selectedChapters.includes(ch);
                      return (
                        <Button
                          key={ch}
                          type="button"
                          variant={active ? "secondary" : "outline"}
                          size="sm"
                          className="min-h-9"
                          aria-pressed={active}
                          onClick={() => toggleChapter(ch)}
                        >
                          {ch}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {/* Multi-Set Combination */}
              {otherSets.length > 0 ? (
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">
                    <Layers className="size-4 text-muted-foreground" aria-hidden="true" />
                    {lText(
                      locale,
                      "Kết hợp thêm học phần khác (tùy chọn)",
                      "Combine additional study sets (optional)",
                    )}
                  </Label>
                  <div className="grid max-h-40 gap-2 overflow-y-auto rounded-lg border border-border p-3 sm:grid-cols-2">
                    {otherSets.map((s) => {
                      const checked = extraSetIds.includes(s.id);
                      return (
                        <label
                          key={s.id}
                          className="flex cursor-pointer items-center gap-2 text-xs"
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => toggleExtraSet(s.id)}
                          />
                          <span className="truncate flex-1">{s.title}</span>
                          <span className="text-muted-foreground tabular-nums">
                            ({s.question_count})
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {/* Question Types */}
              <div className="space-y-2">
                <Label>{lText(locale, "Loại câu hỏi", "Question Types")}</Label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {(
                    [
                      ["single_choice", lText(locale, "Một đáp án", "Single Choice")],
                      ["multiple_choice", lText(locale, "Nhiều đáp án", "Multiple Choice")],
                      ["true_false", lText(locale, "Đúng / Sai", "True / False")],
                      ["short_answer", lText(locale, "Trả lời ngắn", "Short Answer")],
                    ] as const
                  ).map(([qt, label]) => (
                    <label
                      key={qt}
                      className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs"
                    >
                      <Checkbox
                        checked={selectedTypes.includes(qt)}
                        onCheckedChange={() => toggleQuestionType(qt)}
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Shuffle, Scope & Pass Threshold */}
              <div className="grid gap-3 rounded-lg border border-border bg-secondary/30 p-4 sm:grid-cols-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="ex-shuffle-q" className="cursor-pointer">
                    {t("study.shuffleQuestions")}
                  </Label>
                  <Switch
                    id="ex-shuffle-q"
                    checked={shuffleQuestions}
                    onCheckedChange={setShuffleQuestions}
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="ex-shuffle-a" className="cursor-pointer">
                    {t("study.shuffleOptions")}
                  </Label>
                  <Switch
                    id="ex-shuffle-a"
                    checked={shuffleOptions}
                    onCheckedChange={setShuffleOptions}
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="ex-only-mistakes" className="cursor-pointer">
                    {lText(locale, "Chỉ câu đã sai", "Mistakes only")}
                  </Label>
                  <Switch
                    id="ex-only-mistakes"
                    checked={onlyMistakes}
                    onCheckedChange={setOnlyMistakes}
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="ex-only-starred" className="cursor-pointer">
                    {lText(locale, "Chỉ câu đánh dấu sao", "Starred only")}
                  </Label>
                  <Switch
                    id="ex-only-starred"
                    checked={onlyStarred}
                    onCheckedChange={setOnlyStarred}
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="ex-only-unmastered" className="cursor-pointer">
                    {lText(locale, "Chỉ câu chưa thành thạo", "Unmastered only")}
                  </Label>
                  <Switch
                    id="ex-only-unmastered"
                    checked={onlyUnmastered}
                    onCheckedChange={setOnlyUnmastered}
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="ex-pass-threshold">
                    {t("exam.passThreshold")}
                  </Label>
                  <Input
                    id="ex-pass-threshold"
                    type="number"
                    min={1}
                    max={100}
                    value={passThreshold}
                    onChange={(e) =>
                      setPassThreshold(
                        Math.min(100, Math.max(1, Number(e.target.value) || 70)),
                      )
                    }
                    className="h-9 w-20 text-right tabular-nums"
                  />
                </div>
              </div>

              <Button
                type="submit"
                size="lg"
                className="min-h-12 w-full"
                disabled={isCreating}
              >
                {isCreating ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    {lText(locale, "Đang khởi tạo đề thi...", "Generating exam...")}
                  </>
                ) : (
                  <>
                    <Play className="size-4" aria-hidden="true" />
                    {t("exam.startExam")}
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </form>
      </div>
    </FocusModeShell>
  );
}
