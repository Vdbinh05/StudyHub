"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  Clock,
  Flame,
  Play,
  Target,
  XCircle,
} from "lucide-react";
import {
  apiFetch,
  formatMinutes,
  getFriendlyErrorMessage,
  isSupabaseConfiguredClient,
} from "@/components/layout/api-client";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { FadeIn } from "@/components/motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useI18n } from "@/lib/i18n";
import {
  getMasteryLabel,
  normalizeActivityPoints,
  normalizeMasteryCounts,
  normalizeTopicList,
  type StatisticsSummary,
} from "./analytics-types";

const ActivityChart = dynamic(
  () => import("./activity-charts").then((m) => m.ActivityChart),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[240px] w-full rounded-lg" />,
  },
);

const AccuracyTrendChart = dynamic(
  () => import("./activity-charts").then((m) => m.AccuracyTrendChart),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[240px] w-full rounded-lg" />,
  },
);

type StatsRange = "7d" | "30d" | "90d";

const GENERIC_CHAPTER_PLACEHOLDERS = new Set([
  "",
  "general",
  "chung",
  "uncategorized",
  "none",
  "null",
]);

function isRealChapter(chapter: string | null | undefined): chapter is string {
  if (!chapter) return false;
  return !GENERIC_CHAPTER_PLACEHOLDERS.has(chapter.trim().toLowerCase());
}

function parseRangeFromDays(rawDays: string | null): StatsRange {
  if (rawDays === "7" || rawDays === "7d") return "7d";
  if (rawDays === "90" || rawDays === "90d") return "90d";
  return "30d";
}

function parseStatistics(raw: unknown): StatisticsSummary {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const summary = (
    obj.summary && typeof obj.summary === "object" ? obj.summary : obj
  ) as Record<string, unknown>;
  const mastery = normalizeMasteryCounts(
    obj.mastery_distribution ?? obj.mastery ?? obj.mastery_breakdown,
  );
  const dailyActivity = normalizeActivityPoints(obj.dailyActivity ?? obj.daily_activity);
  const perfList = normalizeTopicList(obj.performanceBySet ?? obj.performance_by_set);

  const summedCorrect = perfList.reduce((acc, item) => acc + item.correctCount, 0);
  const summedAnswered = perfList.reduce((acc, item) => acc + item.totalAnswered, 0);
  const dailyAnswered = dailyActivity.reduce((acc, d) => acc + d.answered, 0);
  const dailyCorrect = dailyActivity.reduce((acc, d) => acc + d.correct, 0);

  const totalAnswered =
    Number(
      summary.totalAnswered ??
        summary.total_answered ??
        Math.max(summedAnswered, dailyAnswered),
    ) || 0;
  const totalCorrect =
    Number(
      summary.totalCorrect ??
        summary.total_correct ??
        Math.max(summedCorrect, dailyCorrect),
    ) || 0;
  const overallAccuracy =
    summary.overall_accuracy_percent !== undefined ||
    summary.overallAccuracy !== undefined ||
    summary.overall_accuracy !== undefined
      ? Math.round(
          Number(
            summary.overall_accuracy_percent ??
              summary.overallAccuracy ??
              summary.overall_accuracy,
          ) || 0,
        )
      : totalAnswered > 0
        ? Math.round((totalCorrect / totalAnswered) * 100)
        : 0;

  const rawTrend = Array.isArray(
    obj.exam_score_trend ?? obj.examTrend ?? obj.exam_trend,
  )
    ? ((obj.exam_score_trend ?? obj.examTrend ?? obj.exam_trend) as Array<
        Record<string, unknown>
      >)
    : [];

  return {
    streakDays:
      Number(
        summary.current_streak_days ?? summary.streakDays ?? summary.streak_days ?? 0,
      ) || 0,
    longestStreakDays:
      Number(
        summary.longest_streak_days ??
          summary.longestStreakDays ??
          summary.current_streak_days ??
          summary.streakDays ??
          0,
      ) || 0,
    totalAnswered,
    totalCorrect,
    overallAccuracy,
    totalStudySeconds:
      Number(summary.totalStudySeconds ?? summary.total_study_seconds ?? 0) || 0,
    masteredQuestions:
      Number(
        summary.mastered_count ??
          summary.masteredQuestions ??
          summary.mastered_questions ??
          mastery.mastered,
      ) || 0,
    dueForReview: Number(summary.dueForReview ?? summary.due_for_review ?? 0) || 0,
    mastery,
    dailyActivity,
    examTrend: rawTrend.map((item) => ({
      attemptId: String(item.attemptId ?? item.attempt_id ?? item.id ?? ""),
      studySetId:
        item.studySetId || item.study_set_id
          ? String(item.studySetId ?? item.study_set_id)
          : null,
      title: String(item.title ?? item.study_set_title_snapshot ?? ""),
      date: String(item.date ?? item.submitted_at ?? "").slice(5, 10),
      scorePercent: Number(item.scorePercent ?? item.score_percent ?? 0) || 0,
      passed: Boolean(item.passed),
    })),
    performanceBySet: perfList,
    weakTopics: normalizeTopicList(obj.weakTopics ?? obj.weak_topics),
  };
}

function StatisticsViewInner() {
  const { locale, t } = useI18n();
  const vi = locale === "vi";
  const router = useRouter();
  const searchParams = useSearchParams();
  const configured = isSupabaseConfiguredClient();

  const range = parseRangeFromDays(searchParams.get("days"));
  const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;

  const setRange = (next: StatsRange) => {
    const nextDays = next === "7d" ? "7" : next === "90d" ? "90" : "30";
    router.replace(`/statistics?days=${nextDays}`);
  };

  const { data, isLoading, error, refetch } = useQuery<StatisticsSummary>({
    queryKey: ["statistics", days],
    enabled: configured,
    queryFn: async () => {
      const res = await apiFetch<unknown>(`/api/statistics?days=${days}`);
      return parseStatistics(res.data);
    },
  });

  const rangeOptions: Array<{ value: StatsRange; label: string }> = [
    { value: "7d", label: vi ? "7 ngày" : "7 days" },
    { value: "30d", label: vi ? "30 ngày" : "30 days" },
    { value: "90d", label: vi ? "90 ngày" : "90 days" },
  ];

  return (
    <FadeIn aboveFold className="space-y-6">
      <PageHeader
        title={t("stats.title")}
        description={t("stats.subtitle")}
        actions={
          <div
            role="group"
            aria-label={vi ? "Khoảng thời gian thống kê" : "Statistics timeframe"}
            className="bg-muted inline-flex rounded-lg p-1"
          >
            {rangeOptions.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setRange(opt.value)}
                aria-pressed={range === opt.value}
                className={
                  range === opt.value
                    ? "bg-card text-foreground min-h-9 rounded-md px-3 py-1 text-xs font-semibold shadow-xs"
                    : "text-muted-foreground hover:text-foreground min-h-9 rounded-md px-3 py-1 text-xs font-medium transition-colors"
                }
              >
                {opt.label}
              </button>
            ))}
          </div>
        }
      />

      {!configured ? (
        <EmptyState
          icon={BarChart3}
          title={vi ? "Chưa thể tải thống kê học tập" : "Statistics unavailable"}
          description={t("common.serviceUnavailableDesc")}
        />
      ) : isLoading ? (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Skeleton className="h-72 rounded-xl" />
            <Skeleton className="h-72 rounded-xl" />
          </div>
        </div>
      ) : error ? (
        <EmptyState
          icon={AlertCircle}
          title={vi ? "Không thể tải thống kê" : "Unable to load statistics"}
          description={getFriendlyErrorMessage(error, locale)}
          action={<Button onClick={() => void refetch()}>{t("common.retry")}</Button>}
        />
      ) : !data || (data.totalAnswered === 0 && data.examTrend.length === 0) ? (
        <EmptyState
          icon={BarChart3}
          title={vi ? "Chưa có dữ liệu thống kê" : "No learning analytics yet"}
          description={
            vi
              ? "Hãy hoàn thành một phiên học hoặc bài thi thử để StudyHub tính toán độ chính xác, chuỗi ngày học và chủ đề cần củng cố."
              : "Complete a study session or mock exam so StudyHub can compute your accuracy trend, streak, and weak topics."
          }
          action={
            <Button asChild>
              <Link href="/exams/new">{t("nav.customExam")}</Link>
            </Button>
          }
          secondaryAction={
            <Button asChild variant="outline">
              <Link href="/library">{t("library.title")}</Link>
            </Button>
          }
        />
      ) : (
        <>
          {/* KPI Strip */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-muted-foreground text-xs font-medium">
                    {t("stats.streakDays")}
                  </p>
                  <p className="text-foreground mt-1 font-mono text-2xl font-bold tabular-nums">
                    {data.streakDays} {vi ? "ngày" : "days"}
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {vi
                      ? `Kỷ lục: ${data.longestStreakDays} ngày`
                      : `Best: ${data.longestStreakDays} days`}
                  </p>
                </div>
                <div className="bg-warning-subtle text-warning-subtle-foreground flex size-9 items-center justify-center rounded-lg">
                  <Flame className="size-4" aria-hidden="true" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-muted-foreground text-xs font-medium">
                    {t("stats.overallAccuracy")}
                  </p>
                  <p className="text-foreground mt-1 font-mono text-2xl font-bold tabular-nums">
                    {data.overallAccuracy}%
                  </p>
                  <p className="text-muted-foreground mt-0.5 font-mono text-xs tabular-nums">
                    {data.totalCorrect}/{data.totalAnswered} {vi ? "câu đúng" : "correct"}
                  </p>
                </div>
                <div className="bg-accent text-accent-foreground flex size-9 items-center justify-center rounded-lg">
                  <Target className="size-4" aria-hidden="true" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-muted-foreground text-xs font-medium">
                    {t("stats.studyTime")}
                  </p>
                  <p className="text-foreground mt-1 font-mono text-2xl font-bold tabular-nums">
                    {formatMinutes(data.totalStudySeconds, locale)}
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {vi ? "Tổng thời gian luyện tập" : "Cumulative practice time"}
                  </p>
                </div>
                <div className="bg-secondary text-foreground flex size-9 items-center justify-center rounded-lg">
                  <Clock className="size-4" aria-hidden="true" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-muted-foreground text-xs font-medium">
                    {t("stats.masteredQuestions")}
                  </p>
                  <p className="text-foreground mt-1 font-mono text-2xl font-bold tabular-nums">
                    {data.masteredQuestions}
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-xs">
                    {vi
                      ? `${data.dueForReview} câu cần ôn hôm nay`
                      : `${data.dueForReview} due today`}
                  </p>
                </div>
                <div className="bg-success-subtle text-success-subtle-foreground flex size-9 items-center justify-center rounded-lg">
                  <CheckCircle2 className="size-4" aria-hidden="true" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Charts */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {vi ? "Tần suất học tập" : "Study Activity"}
                </CardTitle>
                <CardDescription>
                  {vi
                    ? "Tổng câu trả lời và câu trả lời đúng theo ngày."
                    : "Total answered vs. correct answers by day."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ActivityChart data={data.dailyActivity} variant="area" height={240} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("stats.accuracyTrend")}</CardTitle>
                <CardDescription>
                  {vi
                    ? "Biến động độ chính xác qua các ngày học hoặc bài thi."
                    : "Accuracy trajectory across recent study days and exams."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <AccuracyTrendChart
                  data={
                    data.examTrend.length >= 2
                      ? data.examTrend.map((e) => ({
                          label: e.date,
                          accuracy: Math.round(e.scorePercent),
                          title: e.title,
                        }))
                      : data.dailyActivity
                          .filter((d) => d.answered > 0)
                          .map((d) => ({ label: d.label, accuracy: d.accuracy }))
                  }
                  height={240}
                />
              </CardContent>
            </Card>
          </div>

          {/* Mastery Breakdown & Weak Topics */}
          <div className="grid gap-6 lg:grid-cols-12">
            <Card className="lg:col-span-5">
              <CardHeader>
                <CardTitle className="text-base">{t("stats.masteryBreakdown")}</CardTitle>
                <CardDescription>
                  {vi
                    ? "Phân bổ câu hỏi theo lịch lặp lại ngắt quãng."
                    : "Spaced-repetition mastery distribution."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {(["mastered", "familiar", "learning", "new"] as const).map((level) => {
                  const total =
                    data.mastery.new +
                    data.mastery.learning +
                    data.mastery.familiar +
                    data.mastery.mastered;
                  const count = data.mastery[level];
                  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                  return (
                    <div key={level} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-foreground font-medium">
                          {getMasteryLabel(level, locale)}
                        </span>
                        <span className="text-muted-foreground font-mono tabular-nums">
                          {count} ({pct}%)
                        </span>
                      </div>
                      <Progress value={pct} aria-label={getMasteryLabel(level, locale)} />
                    </div>
                  );
                })}
              </CardContent>
            </Card>

            <Card className="lg:col-span-7">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <AlertTriangle className="text-warning size-4" aria-hidden="true" />
                  <span>{vi ? "Chủ đề cần cải thiện" : "Weak Topics to Practice"}</span>
                </CardTitle>
                <CardDescription>
                  {vi
                    ? "Các học phần hoặc chương có tỷ lệ đúng thấp nhất — bấm để luyện ngay."
                    : "Sets or chapters with the lowest accuracy — jump straight into practice."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {data.weakTopics.length === 0 ? (
                  <p className="text-muted-foreground py-6 text-center text-sm">
                    {vi
                      ? "Tuyệt vời! Chưa phát hiện chủ đề yếu nổi bật."
                      : "No weak topics flagged right now."}
                  </p>
                ) : (
                  <ul className="divide-border divide-y">
                    {data.weakTopics.map((topic, idx) => {
                      const validChapter = isRealChapter(topic.chapter)
                        ? topic.chapter
                        : null;
                      const practiceHref = topic.studySetId
                        ? `/sets/${topic.studySetId}/practice${validChapter ? `?chapter=${encodeURIComponent(validChapter)}` : ""}`
                        : "/review";
                      return (
                        <li
                          key={`${topic.studySetId}-${validChapter ?? "all"}-${idx}`}
                          className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                        >
                          <div className="min-w-0">
                            <p className="text-foreground truncate text-sm font-medium">
                              {topic.studySetTitle}
                            </p>
                            <p className="text-muted-foreground text-xs">
                              {validChapter
                                ? `${vi ? "Chương" : "Chapter"}: ${validChapter}`
                                : vi
                                  ? "Toàn bộ học phần"
                                  : "Entire study set"}
                              {" · "}
                              <span className="font-mono tabular-nums">
                                {topic.wrongCount} {vi ? "lần sai" : "mistakes"}
                              </span>
                            </p>
                          </div>
                          <div className="flex items-center gap-2.5">
                            <Badge variant={topic.accuracy < 60 ? "destructive" : "warning"}>
                              {topic.accuracy < 60 ? (
                                <XCircle className="size-3" aria-hidden="true" />
                              ) : (
                                <AlertTriangle className="size-3" aria-hidden="true" />
                              )}
                              <span>{Math.round(topic.accuracy)}%</span>
                            </Badge>
                            <Button size="sm" variant="outline" asChild>
                              <Link
                                href={practiceHref}
                                aria-label={`${vi ? "Ôn ngay" : "Practice"} ${topic.studySetTitle}`}
                              >
                                <Play className="size-3.5" aria-hidden="true" />
                                <span>{vi ? "Ôn ngay" : "Practice"}</span>
                              </Link>
                            </Button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Performance by Subject / Set */}
          {data.performanceBySet.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {vi
                    ? "Hiệu quả theo học phần & chương"
                    : "Performance by Study Set & Chapter"}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div
                  tabIndex={0}
                  role="region"
                  aria-label={
                    vi ? "Bảng hiệu quả theo học phần" : "Performance by set table"
                  }
                  className="responsive-table-region"
                >
                  <Table>
                    <TableCaption className="sr-only">
                      {vi
                        ? "Hiệu quả học tập theo từng học phần và chương"
                        : "Accuracy performance by study set and chapter"}
                    </TableCaption>
                    <TableHeader>
                      <TableRow>
                        <TableHead scope="col">{vi ? "Học phần" : "Study Set"}</TableHead>
                        <TableHead scope="col">
                          {vi ? "Chương / Môn" : "Chapter / Subject"}
                        </TableHead>
                        <TableHead scope="col">{vi ? "Lượt làm" : "Answered"}</TableHead>
                        <TableHead scope="col">{t("study.accuracy")}</TableHead>
                        <TableHead scope="col" className="text-right">
                          {t("common.actions")}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.performanceBySet.map((row, idx) => {
                        const displayChapter = isRealChapter(row.chapter)
                          ? row.chapter
                          : (row.subject ?? "—");
                        return (
                          <TableRow key={`${row.studySetId}-${row.chapter ?? idx}`}>
                            <TableCell className="font-medium">
                              {row.studySetTitle}
                            </TableCell>
                            <TableCell className="text-muted-foreground text-xs">
                              {displayChapter}
                            </TableCell>
                            <TableCell className="font-mono text-xs tabular-nums">
                              {row.totalAnswered}
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant={
                                  row.accuracy >= 80
                                    ? "success"
                                    : row.accuracy >= 60
                                      ? "warning"
                                      : "destructive"
                                }
                              >
                                {row.accuracy >= 80 ? (
                                  <CheckCircle2 className="size-3" aria-hidden="true" />
                                ) : row.accuracy >= 60 ? (
                                  <AlertTriangle className="size-3" aria-hidden="true" />
                                ) : (
                                  <XCircle className="size-3" aria-hidden="true" />
                                )}
                                <span>{Math.round(row.accuracy)}%</span>
                              </Badge>
                            </TableCell>
                            <TableCell className="text-right">
                              {row.studySetId && (
                                <Button variant="ghost" size="sm" asChild>
                                  <Link href={`/sets/${row.studySetId}`}>
                                    {vi ? "Mở học phần" : "Open set"}
                                  </Link>
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </FadeIn>
  );
}

export function StatisticsView() {
  return (
    <React.Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
      <StatisticsViewInner />
    </React.Suspense>
  );
}
