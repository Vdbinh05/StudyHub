"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCheck,
  CheckCircle2,
  ClipboardList,
  Clock,
  Filter,
  Play,
  RefreshCw,
  RotateCcw,
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
  resolveMistake,
  toggleStarQuestion,
  upsertQuestionProgress,
  type DueQuestionItem,
  type MistakeItem,
} from "@/lib/learning/api-client";
import { calculateNextReview } from "@/lib/learning/sm2";
import { getExpectedWriteAnswers } from "@/lib/learning/write-grader";
import { cn } from "@/lib/utils";
import { lText } from "./learning-copy";

export function ReviewMistakesClient() {
  const { locale, t } = useI18n();
  const queryClient = useQueryClient();

  const [selectedSetId, setSelectedSetId] = React.useState<string>("all");
  const [selectedChapter, setSelectedChapter] = React.useState<string>("all");
  const [minWrongCount, setMinWrongCount] = React.useState<number>(1);
  const [daysFilter, setDaysFilter] = React.useState<string>("all");
  const [includeResolved, setIncludeResolved] = React.useState<boolean>(true);
  const [activeTab, setActiveTab] = React.useState<string>("mistakes");

  // Inline Due SM-2 review state
  const [dueSessionActive, setDueSessionActive] = React.useState(false);
  const [dueIndex, setDueIndex] = React.useState(0);
  const [dueRevealed, setDueRevealed] = React.useState(false);

  const setsQuery = useQuery({
    queryKey: ["accessible-sets"],
    queryFn: fetchAccessibleSets,
    staleTime: 60_000,
  });

  const mistakesQuery = useQuery({
    queryKey: [
      "review-mistakes",
      selectedSetId,
      selectedChapter,
      minWrongCount,
      daysFilter,
      includeResolved,
    ],
    queryFn: () =>
      fetchMistakes({
        studySetId: selectedSetId !== "all" ? selectedSetId : undefined,
        chapter: selectedChapter !== "all" ? selectedChapter : undefined,
        minWrongCount,
        includeResolved,
        days: daysFilter !== "all" ? Number(daysFilter) : undefined,
      }),
  });

  const dueQuery = useQuery({
    queryKey: ["review-due", selectedSetId],
    queryFn: () =>
      fetchDueQuestions(selectedSetId !== "all" ? selectedSetId : undefined, 100),
  });

  const mistakes = React.useMemo(
    () => mistakesQuery.data?.items ?? [],
    [mistakesQuery.data?.items],
  );
  const dueItems = React.useMemo(
    () => dueQuery.data ?? [],
    [dueQuery.data],
  );

  const availableChapters = React.useMemo(() => {
    const set = new Set<string>();
    for (const item of mistakes) {
      const ch = item.chapter ?? item.question?.chapter;
      if (ch && ch.trim()) set.add(ch.trim());
    }
    return Array.from(set);
  }, [mistakes]);

  const setTitleMap = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const s of setsQuery.data ?? []) {
      map.set(s.id, s.title);
    }
    return map;
  }, [setsQuery.data]);

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
        await queryClient.invalidateQueries({ queryKey: ["review-mistakes"] });
      } catch {
        toast.error(t("common.errorGeneric"));
      }
    },
    [locale, queryClient, t],
  );

  const handleToggleStar = React.useCallback(
    async (item: MistakeItem) => {
      try {
        await toggleStarQuestion(item.question_id, item.study_set_id);
        await queryClient.invalidateQueries({ queryKey: ["review-mistakes"] });
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

  // Target set for 1-click Practice / Test launch
  const launchSetId =
    selectedSetId !== "all"
      ? selectedSetId
      : mistakes[0]?.study_set_id ?? null;

  const filteredQuestionIdsForLaunch = React.useMemo(() => {
    if (!launchSetId) return [];
    return mistakes
      .filter((m) => m.study_set_id === launchSetId && m.needs_review)
      .slice(0, 100)
      .map((m) => m.question_id);
  }, [launchSetId, mistakes]);

  const needsReviewCount = mistakes.filter((m) => m.needs_review).length;
  const resolvedCount = mistakes.filter((m) => !m.needs_review).length;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {lText(locale, "Ôn tập & Câu hỏi đã sai", "Review & Mistakes")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {lText(
              locale,
              "Lọc câu hỏi hay sai, phân biệt lỗi cần ôn với lịch sử đã khắc phục, và ôn tập lặp lại ngắt quãng SM-2.",
              "Filter missed questions, distinguish active review items from resolved history, and clear your SM-2 due queue.",
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {launchSetId ? (
            <>
              <Button asChild className="min-h-10">
                <Link
                  href={`/sets/${launchSetId}/practice?filter=mistakes${
                    filteredQuestionIdsForLaunch.length > 0
                      ? `&questionIds=${filteredQuestionIdsForLaunch.join(",")}`
                      : ""
                  }`}
                >
                  <Play className="size-4" aria-hidden="true" />
                  {lText(locale, "Luyện tập câu sai", "Practice Mistakes")}
                </Link>
              </Button>
              <Button variant="outline" asChild className="min-h-10">
                <Link href={`/sets/${launchSetId}/test?onlyMistakes=true`}>
                  <ClipboardList className="size-4" aria-hidden="true" />
                  {lText(locale, "Thi thử câu sai", "Test Mistakes")}
                </Link>
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {/* Summary KPI strip */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center justify-between py-4">
            <div>
              <p className="text-xs font-medium text-muted-foreground">
                {lText(locale, "Cần ôn lại ngay", "Needs Review")}
              </p>
              <p className="mt-1 text-2xl font-bold text-destructive tabular-nums">
                {needsReviewCount}
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
                {lText(locale, "Đã khắc phục (Lịch sử)", "Resolved History")}
              </p>
              <p className="mt-1 text-2xl font-bold text-success tabular-nums">
                {resolvedCount}
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
                {lText(locale, "Đến hạn SM-2 hôm nay", "SM-2 Due Today")}
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

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="mistakes" className="gap-1.5">
            <RotateCcw className="size-4" aria-hidden="true" />
            {lText(locale, "Ngân hàng câu sai", "Mistake Bank")} ({mistakes.length})
          </TabsTrigger>
          <TabsTrigger value="due" className="gap-1.5">
            <Clock className="size-4" aria-hidden="true" />
            {lText(locale, "Hàng đợi đến hạn SM-2", "SM-2 Due Queue")} ({dueItems.length})
          </TabsTrigger>
        </TabsList>

        {/* Tab 1: Mistakes Bank */}
        <TabsContent value="mistakes" className="mt-4 space-y-4">
          {/* Filter Bar */}
          <Card>
            <CardContent className="grid gap-3 py-4 sm:grid-cols-2 lg:grid-cols-5">
              <div className="space-y-1.5">
                <Label htmlFor="rev-set" className="text-xs">
                  {lText(locale, "Học phần", "Study Set")}
                </Label>
                <Select
                  value={selectedSetId}
                  onValueChange={(val) => {
                    setSelectedSetId(val);
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
                    {(setsQuery.data ?? []).map((s) => (
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
                <Select
                  value={selectedChapter}
                  onValueChange={setSelectedChapter}
                >
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
                <Label htmlFor="rev-min-wrong" className="text-xs">
                  {lText(locale, "Số lần sai tối thiểu", "Min mistakes")}
                </Label>
                <Select
                  value={String(minWrongCount)}
                  onValueChange={(v) => setMinWrongCount(Number(v))}
                >
                  <SelectTrigger id="rev-min-wrong" className="h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">≥ 1 {lText(locale, "lần", "time")}</SelectItem>
                    <SelectItem value="2">≥ 2 {lText(locale, "lần", "times")}</SelectItem>
                    <SelectItem value="3">≥ 3 {lText(locale, "lần", "times")}</SelectItem>
                    <SelectItem value="5">≥ 5 {lText(locale, "lần", "times")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="rev-days" className="text-xs">
                  {lText(locale, "Khoảng thời gian", "Timeframe")}
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
                      {lText(locale, "7 ngày gần đây", "Last 7 days")}
                    </SelectItem>
                    <SelectItem value="30">
                      {lText(locale, "30 ngày gần đây", "Last 30 days")}
                    </SelectItem>
                    <SelectItem value="90">
                      {lText(locale, "90 ngày gần đây", "Last 90 days")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-end pb-1.5">
                <div className="flex items-center gap-2">
                  <Switch
                    id="rev-include-resolved"
                    checked={includeResolved}
                    onCheckedChange={setIncludeResolved}
                  />
                  <Label
                    htmlFor="rev-include-resolved"
                    className="text-xs cursor-pointer"
                  >
                    {lText(locale, "Hiện lịch sử đã khắc phục", "Show resolved history")}
                  </Label>
                </div>
              </div>
            </CardContent>
          </Card>

          {mistakesQuery.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-32 w-full rounded-xl" />
              <Skeleton className="h-32 w-full rounded-xl" />
            </div>
          ) : mistakesQuery.isError ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
                <AlertCircle className="size-8 text-destructive" aria-hidden="true" />
                <p className="text-sm text-muted-foreground">
                  {lText(
                    locale,
                    "Không thể tải danh sách câu sai.",
                    "Could not load mistakes list.",
                  )}
                </p>
                <Button variant="outline" onClick={() => void mistakesQuery.refetch()}>
                  <RefreshCw className="size-4" aria-hidden="true" />
                  {t("common.retry")}
                </Button>
              </CardContent>
            </Card>
          ) : mistakes.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                <div className="flex size-12 items-center justify-center rounded-full bg-success-subtle text-success-subtle-foreground">
                  <CheckCircle2 className="size-6" aria-hidden="true" />
                </div>
                <h2 className="text-lg font-semibold">
                  {lText(
                    locale,
                    "Không có câu hỏi sai nào khớp bộ lọc!",
                    "No mistakes match your filters!",
                  )}
                </h2>
                <p className="max-w-md text-sm text-muted-foreground">
                  {lText(
                    locale,
                    "Mọi câu hỏi bạn trả lời sai trong Luyện tập, Học tập, Gõ đáp án hoặc Thi thử sẽ tự động tập hợp tại đây.",
                    "Any question you miss in Practice, Learn, Write, or Mock Exams will automatically appear here for targeted review.",
                  )}
                </p>
                <Button variant="outline" asChild>
                  <Link href="/library">{t("nav.library")}</Link>
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {mistakes.map((item) => {
                const q = item.question;
                const setTitle =
                  item.study_set_title ??
                  setTitleMap.get(item.study_set_id) ??
                  lText(locale, "Học phần", "Study Set");
                const correctOpts = (q.options ?? []).filter((o) => o.is_correct);
                const selectedOpts = (q.options ?? []).filter((o) =>
                  (item.last_selected_option_ids ?? []).includes(o.id),
                );
                const correctDisplay =
                  correctOpts.length > 0
                    ? correctOpts.map((o) => o.content).join(", ")
                    : getExpectedWriteAnswers(q)
                        .map((a) => a.answer_text)
                        .join(" / ");
                const selectedDisplay =
                  selectedOpts.length > 0
                    ? selectedOpts.map((o) => o.content).join(", ")
                    : item.last_typed_answer || null;

                return (
                  <Card key={item.question_id}>
                    <CardContent className="space-y-3 py-5">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          {item.needs_review ? (
                            <Badge variant="destructive">
                              <XCircle className="size-3" aria-hidden="true" />
                              {lText(locale, "Cần ôn lại", "Still needs review")}
                            </Badge>
                          ) : (
                            <Badge variant="success">
                              <CheckCircle2 className="size-3" aria-hidden="true" />
                              {lText(
                                locale,
                                "Đã khắc phục (Lịch sử sai)",
                                "Resolved (Historical mistake)",
                              )}
                            </Badge>
                          )}
                          <Badge variant="outline" className="tabular-nums">
                            {lText(locale, "Sai", "Wrong")}: {item.wrong_count} ·{" "}
                            {lText(locale, "Đúng", "Right")}: {item.correct_count}
                          </Badge>
                          <Link
                            href={`/sets/${item.study_set_id}`}
                            className="text-xs font-medium text-primary hover:underline"
                          >
                            {setTitle}
                          </Link>
                          {q.chapter ? (
                            <Badge variant="secondary">{q.chapter}</Badge>
                          ) : null}
                        </div>

                        <div className="flex items-center gap-1.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="min-h-9 min-w-9"
                            aria-pressed={Boolean(item.is_starred)}
                            aria-label={
                              item.is_starred
                                ? t("study.unstarQuestion")
                                : t("study.starQuestion")
                            }
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
                              variant="outline"
                              size="sm"
                              className="min-h-9"
                              onClick={() => void handleResolve(item.question_id)}
                            >
                              <CheckCheck className="size-4" aria-hidden="true" />
                              {lText(locale, "Đánh dấu đã khắc phục", "Mark resolved")}
                            </Button>
                          ) : null}
                        </div>
                      </div>

                      <p className="whitespace-pre-wrap text-sm font-medium leading-relaxed sm:text-base">
                        {q.prompt}
                      </p>

                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="rounded-lg border border-destructive/30 bg-destructive-subtle/50 p-3 text-xs sm:text-sm">
                          <div className="flex items-center gap-1.5 font-semibold text-destructive-subtle-foreground">
                            <XCircle className="size-3.5" aria-hidden="true" />
                            <span>
                              {lText(locale, "Lựa chọn sai gần nhất", "Last wrong answer")}
                            </span>
                          </div>
                          <p className="mt-1 text-foreground">
                            {selectedDisplay ??
                              lText(locale, "Không có dữ liệu lựa chọn", "No recorded selection")}
                          </p>
                        </div>

                        <div className="rounded-lg border border-success/30 bg-success-subtle/50 p-3 text-xs sm:text-sm">
                          <div className="flex items-center gap-1.5 font-semibold text-success-subtle-foreground">
                            <CheckCircle2 className="size-3.5" aria-hidden="true" />
                            <span>{t("study.correctAnswer")}</span>
                          </div>
                          <p className="mt-1 text-foreground whitespace-pre-wrap">
                            {correctDisplay || "—"}
                          </p>
                        </div>
                      </div>

                      {q.explanation ? (
                        <p className="rounded-md bg-secondary/50 p-3 text-xs text-muted-foreground whitespace-pre-wrap">
                          <strong className="text-foreground">
                            {t("study.explanation")}:{" "}
                          </strong>
                          {q.explanation}
                        </p>
                      ) : null}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* Tab 2: SM-2 Due Review Queue */}
        <TabsContent value="due" className="mt-4 space-y-4">
          {dueQuery.isLoading ? (
            <Skeleton className="h-44 w-full rounded-xl" />
          ) : dueItems.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                <div className="flex size-12 items-center justify-center rounded-full bg-success-subtle text-success-subtle-foreground">
                  <CheckCircle2 className="size-6" aria-hidden="true" />
                </div>
                <h2 className="text-lg font-semibold">
                  {lText(
                    locale,
                    "Bạn đã hoàn thành toàn bộ thẻ đến hạn hôm nay!",
                    "You're all caught up on SM-2 due reviews!",
                  )}
                </h2>
                <p className="text-sm text-muted-foreground">
                  {lText(
                    locale,
                    "Thuật toán lặp lại ngắt quãng SM-2 sẽ tự động nhắc lại câu hỏi đúng thời điểm tối ưu.",
                    "Deterministic SM-2 spaced repetition will surface items right when they're due.",
                  )}
                </p>
              </CardContent>
            </Card>
          ) : dueSessionActive && dueItems[dueIndex] ? (
            <Card className="mx-auto max-w-3xl">
              <CardHeader className="flex flex-row items-center justify-between gap-2">
                <CardTitle className="text-base">
                  {lText(locale, "Phiên ôn tập SM-2", "SM-2 Review Session")} (
                  {dueIndex + 1} / {dueItems.length})
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDueSessionActive(false)}
                >
                  {t("common.close")}
                </Button>
              </CardHeader>
              <CardContent className="space-y-5">
                <p className="whitespace-pre-wrap text-lg font-medium leading-relaxed">
                  {dueItems[dueIndex].question.prompt}
                </p>

                {dueRevealed ? (
                  <div className="space-y-4">
                    <div className="rounded-lg border border-success/40 bg-success-subtle p-4 space-y-2">
                      <p className="text-xs font-semibold text-success-subtle-foreground">
                        {t("study.correctAnswer")}
                      </p>
                      <p className="whitespace-pre-wrap text-base font-medium text-foreground">
                        {(dueItems[dueIndex].question.options ?? [])
                          .filter((o) => o.is_correct)
                          .map((o) => o.content)
                          .join(", ") ||
                          getExpectedWriteAnswers(dueItems[dueIndex].question)
                            .map((a) => a.answer_text)
                            .join(" / ") ||
                          dueItems[dueIndex].question.back_text ||
                          "—"}
                      </p>
                      {dueItems[dueIndex].question.explanation ? (
                        <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                          {dueItems[dueIndex].question.explanation}
                        </p>
                      ) : null}
                    </div>

                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <Button
                        variant="destructive"
                        className="min-h-11"
                        onClick={() =>
                          void handleRateDue(dueItems[dueIndex], "again")
                        }
                      >
                        {lText(locale, "Quên (1 ngày)", "Again (1d)")}
                      </Button>
                      <Button
                        variant="outline"
                        className="min-h-11"
                        onClick={() =>
                          void handleRateDue(dueItems[dueIndex], "hard")
                        }
                      >
                        {lText(locale, "Khó", "Hard")}
                      </Button>
                      <Button
                        variant="default"
                        className="min-h-11"
                        onClick={() =>
                          void handleRateDue(dueItems[dueIndex], "good")
                        }
                      >
                        {lText(locale, "Tốt", "Good")}
                      </Button>
                      <Button
                        variant="success"
                        className="min-h-11"
                        onClick={() =>
                          void handleRateDue(dueItems[dueIndex], "easy")
                        }
                      >
                        {lText(locale, "Dễ", "Easy")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button
                    size="lg"
                    className="min-h-11 w-full"
                    onClick={() => setDueRevealed(true)}
                  >
                    {lText(locale, "Hiện đáp án", "Show Answer")}
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="flex flex-col items-center gap-4 py-8 text-center">
                <div className="flex items-center gap-2 text-primary font-semibold">
                  <Filter className="size-5" aria-hidden="true" />
                  <span>
                    {lText(
                      locale,
                      `Có ${dueItems.length} câu hỏi đến hạn ôn tập SM-2`,
                      `${dueItems.length} items due for SM-2 spaced repetition`,
                    )}
                  </span>
                </div>
                <Button
                  size="lg"
                  className="min-h-11"
                  onClick={() => {
                    setDueIndex(0);
                    setDueRevealed(false);
                    setDueSessionActive(true);
                  }}
                >
                  <Play className="size-4" aria-hidden="true" />
                  {lText(locale, "Bắt đầu ôn tập đến hạn", "Start Due Review Session")}
                </Button>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
