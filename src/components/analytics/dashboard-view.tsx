"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  BookOpenCheck,
  CheckCircle2,
  Clock,
  FileCheck2,
  Flame,
  Layers,
  Play,
  Plus,
  RotateCcw,
  Target,
  Upload,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  apiFetch,
  ApiError,
  formatRelativeTime,
  formatShortDate,
  getFriendlyErrorMessage,
  isSupabaseConfiguredClient,
} from "@/components/layout/api-client";
import { EmptyState } from "@/components/layout/empty-state";
import { ResumeSessionBanner } from "@/components/learning/ResumeSessionBanner";
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
import { useI18n } from "@/lib/i18n";
import type {
  ExamAttempt,
  LearningSessionCheckpoint,
  StudySession,
  StudySet,
  V3StudyMode,
} from "@/types/domain";
import {
  normalizeActivityPoints,
  type DashboardSummary,
} from "./analytics-types";

const ActivityChart = dynamic(
  () => import("./activity-charts").then((m) => m.ActivityChart),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[220px] w-full rounded-lg" />,
  },
);

function parseDashboardResponse(raw: unknown): DashboardSummary {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const kpi = (
    obj.kpis && typeof obj.kpis === "object"
      ? obj.kpis
      : obj.kpi && typeof obj.kpi === "object"
        ? obj.kpi
        : obj
  ) as Record<string, unknown>;
  const profileObj = (
    obj.profile && typeof obj.profile === "object" ? obj.profile : null
  ) as Record<string, unknown> | null;
  const recentSets = Array.isArray(obj.recentSets ?? obj.recent_sets)
    ? ((obj.recentSets ?? obj.recent_sets) as StudySet[])
    : [];
  const continueList = Array.isArray(obj.continue_learning)
    ? (obj.continue_learning as StudySet[])
    : [];
  const recentExams = Array.isArray(obj.recentExams ?? obj.recent_exams)
    ? ((obj.recentExams ?? obj.recent_exams) as ExamAttempt[])
    : [];
  const recentSessions = Array.isArray(obj.recentSessions ?? obj.recent_sessions)
    ? ((obj.recentSessions ?? obj.recent_sessions) as StudySession[])
    : [];
  const activeCheckpoints = Array.isArray(obj.active_checkpoints ?? obj.activeCheckpoints)
    ? ((obj.active_checkpoints ?? obj.activeCheckpoints) as LearningSessionCheckpoint[])
    : [];

  const continueSet =
    ((obj.continueSet ?? obj.continue_set ?? continueList[0] ?? recentSets[0]) ??
      null) as StudySet | null;

  return {
    displayName:
      typeof profileObj?.display_name === "string"
        ? profileObj.display_name
        : typeof obj.displayName === "string"
          ? obj.displayName
          : typeof obj.display_name === "string"
            ? obj.display_name
            : null,
    totalSets: Number(kpi.totalSets ?? kpi.total_sets ?? recentSets.length ?? 0) || 0,
    totalQuestions: Number(kpi.totalQuestions ?? kpi.total_questions ?? 0) || 0,
    masteredQuestions:
      Number(kpi.masteredQuestions ?? kpi.mastered_count ?? kpi.mastered_questions ?? 0) || 0,
    dueForReview: Number(kpi.dueForReview ?? kpi.due_for_review ?? 0) || 0,
    studyAccuracy:
      Math.round(
        Number(
          kpi.studyAccuracy ??
            kpi.accuracy_percent ??
            kpi.study_accuracy ??
            kpi.overall_accuracy ??
            0,
        ) || 0,
      ),
    streakDays:
      Number(kpi.streakDays ?? kpi.streak_days ?? kpi.current_streak_days ?? 0) || 0,
    dailyGoal: Number(kpi.dailyGoal ?? kpi.daily_goal ?? 20) || 20,
    todayAnswered:
      Number(kpi.todayAnswered ?? kpi.today_answers ?? kpi.today_answered ?? 0) || 0,
    continueSet,
    recentSets,
    recentExams,
    recentSessions,
    activeCheckpoints,
    activitySeries: normalizeActivityPoints(
      obj.activity_14d ??
        obj.activitySeries ??
        obj.activity_series ??
        obj.dailyActivity ??
        obj.daily_activity,
    ),
  };
}

function getCheckpointModeLabel(mode: V3StudyMode, vi: boolean): string {
  switch (mode) {
    case "flashcards":
      return "Flashcards";
    case "learn":
      return vi ? "Học sâu (Learn)" : "Adaptive Learn";
    case "practice":
      return vi ? "Luyện trắc nghiệm" : "Practice";
    case "write":
      return vi ? "Gõ đáp án (Write)" : "Write";
    case "spell":
      return vi ? "Nghe & Gõ (Spell)" : "Spell";
    case "match":
      return vi ? "Ghép thẻ (Match)" : "Match";
    case "diagram":
      return vi ? "Sơ đồ tương tác" : "Diagram";
    case "custom_practice":
      return vi ? "Luyện tập tùy chọn" : "Custom Practice";
    case "review":
      return vi ? "Ôn câu sai" : "Review Mistakes";
  }
}

function resolveCheckpointHref(
  checkpoint: LearningSessionCheckpoint,
  fresh = false,
): string {
  const qs = fresh ? "?fresh=1" : "";
  if (checkpoint.mode === "custom_practice") return `/practice${qs}`;
  if (checkpoint.mode === "review") return `/review${qs}`;
  if (checkpoint.study_set_id) {
    if (checkpoint.mode === "diagram") {
      return `/sets/${checkpoint.study_set_id}/diagrams`;
    }
    return `/sets/${checkpoint.study_set_id}/${checkpoint.mode}${qs}`;
  }
  return "/library";
}

export function DashboardView() {
  const { locale, t } = useI18n();
  const vi = locale === "vi";
  const router = useRouter();
  const queryClient = useQueryClient();
  const configured = isSupabaseConfiguredClient();

  const { data, isLoading, error, refetch } = useQuery<DashboardSummary>({
    queryKey: ["dashboard"],
    enabled: configured,
    queryFn: async () => {
      const res = await apiFetch<unknown>("/api/dashboard");
      return parseDashboardResponse(res.data);
    },
  });

  const discardCheckpointMutation = useMutation({
    mutationFn: async (checkpointId: string) => {
      await apiFetch(`/api/checkpoints?id=${encodeURIComponent(checkpointId)}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(vi ? "Đã bỏ phiên học dở." : "In-progress session discarded.");
    },
    onError: (err) => {
      toast.error(getFriendlyErrorMessage(err, locale));
    },
  });

  // Deduplicated calm state when backend isn't configured (AppShell already displays the single setup banner)
  if (!configured) {
    return (
      <FadeIn aboveFold className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-foreground text-2xl font-bold tracking-tight sm:text-[1.75rem]">
            {t("nav.dashboard")}
          </h1>
          <p className="text-muted-foreground text-sm">
            {vi
              ? "Không gian tổng quan tiến độ học tập, bộ câu hỏi và thi thử của bạn."
              : "Your overview for study sets, daily progress, and custom mock exams."}
          </p>
        </div>

        <EmptyState
          icon={BookOpen}
          title={vi ? "Sẵn sàng bắt đầu học tập" : "Ready to start studying"}
          description={
            vi
              ? "Khi máy chủ dữ liệu sẵn sàng, bạn có thể đăng nhập để đồng bộ thư viện câu hỏi, lịch sử thi thử và thống kê."
              : "Once the study database is connected, sign in to sync your question banks, mock exams, and analytics."
          }
          action={
            <Button asChild>
              <Link href="/exams/new">
                <FileCheck2 className="size-4" aria-hidden="true" />
                <span>{t("exam.customBuilderTitle")}</span>
              </Link>
            </Button>
          }
          secondaryAction={
            <Button asChild variant="outline">
              <Link href="/login">{t("nav.signIn")}</Link>
            </Button>
          }
        />
      </FadeIn>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Skeleton className="h-9 w-64" />
          <div className="flex gap-2">
            <Skeleton className="h-9 w-32" />
            <Skeleton className="h-9 w-32" />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-12">
          <Skeleton className="h-80 rounded-xl lg:col-span-7" />
          <Skeleton className="h-80 rounded-xl lg:col-span-5" />
        </div>
      </div>
    );
  }

  if (error) {
    const isUnauth = error instanceof ApiError && error.status === 401;
    return (
      <EmptyState
        icon={AlertCircle}
        title={
          isUnauth
            ? vi
              ? "Vui lòng đăng nhập để xem tổng quan"
              : "Sign in to view your dashboard"
            : vi
              ? "Không thể tải dữ liệu tổng quan"
              : "Unable to load dashboard"
        }
        description={getFriendlyErrorMessage(error, locale)}
        action={
          isUnauth ? (
            <Button asChild>
              <Link href="/login">{t("nav.signIn")}</Link>
            </Button>
          ) : (
            <Button onClick={() => void refetch()}>{t("common.retry")}</Button>
          )
        }
      />
    );
  }

  const summary = data!;
  const dailyProgressPct =
    summary.dailyGoal > 0
      ? Math.min(100, Math.round((summary.todayAnswered / summary.dailyGoal) * 100))
      : 0;

  return (
    <FadeIn aboveFold className="space-y-6">
      {/* Compact Header & Quick Actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-foreground text-2xl font-bold tracking-tight sm:text-[1.75rem]">
              {summary.displayName
                ? vi
                  ? `Xin chào, ${summary.displayName}`
                  : `Welcome back, ${summary.displayName}`
                : t("nav.dashboard")}
            </h1>
            {summary.streakDays > 0 && (
              <Badge variant="warning" className="font-mono tabular-nums">
                <Flame className="size-3.5" aria-hidden="true" />
                <span>
                  {summary.streakDays} {vi ? "ngày liên tiếp" : "day streak"}
                </span>
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground text-sm">
            {vi
              ? `Mục tiêu hôm nay: ${summary.todayAnswered}/${summary.dailyGoal} câu hỏi.`
              : `Today's goal: ${summary.todayAnswered}/${summary.dailyGoal} questions answered.`}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm">
            <Link href="/exams/new">
              <FileCheck2 className="size-4" aria-hidden="true" />
              <span>{t("nav.customExam")}</span>
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/sets/new">
              <Plus className="size-4" aria-hidden="true" />
              <span>{t("library.newSet")}</span>
            </Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/import">
              <Upload className="size-4" aria-hidden="true" />
              <span>{t("library.importSet")}</span>
            </Link>
          </Button>
          {summary.dueForReview > 0 && (
            <Button asChild size="sm" variant="secondary">
              <Link href="/review">
                <RotateCcw className="size-4" aria-hidden="true" />
                <span>
                  {vi
                    ? `Ôn tập (${summary.dueForReview})`
                    : `Review (${summary.dueForReview})`}
                </span>
              </Link>
            </Button>
          )}
        </div>
      </div>

      {/* Daily Goal Progress Bar */}
      <div className="border-border bg-card flex flex-col gap-2 rounded-xl border px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5 text-sm">
          <Target className="text-primary size-4 shrink-0" aria-hidden="true" />
          <span className="font-medium">{t("stats.dailyGoal")}</span>
          <span className="text-muted-foreground font-mono text-xs tabular-nums">
            {summary.todayAnswered} / {summary.dailyGoal} ({dailyProgressPct}%)
          </span>
        </div>
        <div className="w-full sm:w-64">
          <Progress
            value={dailyProgressPct}
            aria-label={t("stats.dailyGoal")}
          />
        </div>
      </div>

      {/* V3.0 Continue Learning Active Session Checkpoints */}
      {summary.activeCheckpoints.length > 0 && (
        <section aria-labelledby="continue-checkpoints-heading" className="space-y-3">
          <h2
            id="continue-checkpoints-heading"
            className="text-foreground text-sm font-semibold"
          >
            {t("resume.continueLearning")}
          </h2>
          <div className="space-y-2.5">
            {summary.activeCheckpoints.slice(0, 2).map((cp) => {
              const matchedSet =
                summary.recentSets.find((s) => s.id === cp.study_set_id) ??
                (summary.continueSet?.id === cp.study_set_id
                  ? summary.continueSet
                  : null);
              const modeTitle = getCheckpointModeLabel(cp.mode, vi);
              const label = matchedSet
                ? `${matchedSet.title} · ${modeTitle}`
                : modeTitle;
              return (
                <ResumeSessionBanner
                  key={cp.id}
                  modeLabel={label}
                  currentIndex={cp.current_index}
                  totalItems={cp.total_items}
                  progressPercent={cp.progress_percent}
                  updatedAt={cp.updated_at}
                  source="remote"
                  isBusy={discardCheckpointMutation.isPending}
                  onContinue={() => router.push(resolveCheckpointHref(cp, false))}
                  onRestart={async () => {
                    await discardCheckpointMutation.mutateAsync(cp.id).catch(() => {});
                    router.push(resolveCheckpointHref(cp, true));
                  }}
                  onDiscard={() => discardCheckpointMutation.mutate(cp.id)}
                />
              );
            })}
          </div>
        </section>
      )}

      {/* KPI Strip */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="flex items-start justify-between gap-3">
            <div>
              <p className="text-muted-foreground text-xs font-medium">
                {vi ? "Tổng số câu hỏi" : "Total Questions"}
              </p>
              <p className="text-foreground mt-1 font-mono text-2xl font-bold tabular-nums">
                {summary.totalQuestions.toLocaleString()}
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs">
                {vi ? `Trong ${summary.totalSets} học phần` : `Across ${summary.totalSets} sets`}
              </p>
            </div>
            <div className="bg-secondary text-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
              <BookOpen className="size-4" aria-hidden="true" />
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
                {summary.masteredQuestions.toLocaleString()}
              </p>
              <p className="text-muted-foreground mt-0.5 text-xs tabular-nums">
                {summary.totalQuestions > 0
                  ? `${Math.round((summary.masteredQuestions / summary.totalQuestions) * 100)}% ${vi ? "tổng ngân hàng" : "of total bank"}`
                  : vi
                    ? "Bắt đầu ôn tập để tích lũy"
                    : "Start studying to build mastery"}
              </p>
            </div>
            <div className="bg-success-subtle text-success-subtle-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
              <CheckCircle2 className="size-4" aria-hidden="true" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-start justify-between gap-3">
            <div>
              <p className="text-muted-foreground text-xs font-medium">
                {t("stats.dueForReview")}
              </p>
              <p className="text-foreground mt-1 font-mono text-2xl font-bold tabular-nums">
                {summary.dueForReview.toLocaleString()}
              </p>
              <Link
                href="/review"
                className="text-primary mt-0.5 inline-flex items-center gap-1 text-xs font-medium hover:underline"
              >
                <span>{vi ? "Mở hàng đợi ôn tập" : "Open review queue"}</span>
                <ArrowRight className="size-3" aria-hidden="true" />
              </Link>
            </div>
            <div className="bg-warning-subtle text-warning-subtle-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
              <RotateCcw className="size-4" aria-hidden="true" />
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
                {summary.studyAccuracy}%
              </p>
              <Link
                href="/statistics"
                className="text-primary mt-0.5 inline-flex items-center gap-1 text-xs font-medium hover:underline"
              >
                <span>{vi ? "Xem thống kê chi tiết" : "View full analytics"}</span>
                <ArrowRight className="size-3" aria-hidden="true" />
              </Link>
            </div>
            <div className="bg-accent text-accent-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
              <Target className="size-4" aria-hidden="true" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* V2.0 Custom Exam Builder & Full Coverage Quick Launch Card */}
      <Card>
        <CardContent className="flex flex-col gap-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-lg">
              <FileCheck2 className="size-5" aria-hidden="true" />
            </div>
            <div className="space-y-0.5">
              <h2 className="text-foreground text-base font-semibold">
                {t("exam.customBuilderTitle")}
              </h2>
              <p className="text-muted-foreground text-xs leading-relaxed sm:text-sm">
                {t("exam.customBuilderSubtitle")}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Button asChild size="sm">
              <Link href="/exams/new">
                <FileCheck2 className="size-4" aria-hidden="true" />
                <span>{vi ? "Tạo đề thi mới" : "Build exam"}</span>
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/exams">
                <Layers className="size-4" aria-hidden="true" />
                <span>{t("nav.examsHub")}</span>
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/practice">
                <BookOpenCheck className="size-4" aria-hidden="true" />
                <span>{t("nav.practice")}</span>
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Empty State for Brand-New Users */}
      {summary.totalSets === 0 ? (
        <EmptyState
          icon={BookOpen}
          title={vi ? "Bắt đầu học phần đầu tiên của bạn" : "Create your first study set"}
          description={
            vi
              ? "Tạo bộ câu hỏi trắc nghiệm hoặc flashcard mới, hoặc nhập nhanh từ file Word (.docx), Excel (.xlsx), CSV, TXT có sẵn."
              : "Create a new multiple-choice or flashcard set, or bulk import an existing DOCX, XLSX, CSV, or TXT question bank."
          }
          action={
            <Button asChild>
              <Link href="/sets/new">
                <Plus className="size-4" aria-hidden="true" />
                <span>{t("library.newSet")}</span>
              </Link>
            </Button>
          }
          secondaryAction={
            <Button variant="outline" asChild>
              <Link href="/import">
                <Upload className="size-4" aria-hidden="true" />
                <span>{t("library.importSet")}</span>
              </Link>
            </Button>
          }
        />
      ) : (
        <>
          {/* Continue Learning Card */}
          {summary.continueSet && (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <CardDescription>
                      {vi ? "Tiếp tục học" : "Continue learning"}
                    </CardDescription>
                    <CardTitle className="mt-0.5 text-lg">
                      <Link
                        href={`/sets/${summary.continueSet.id}`}
                        className="hover:text-primary transition-colors"
                      >
                        {summary.continueSet.title}
                      </Link>
                    </CardTitle>
                  </div>
                  <Badge variant="secondary" className="font-mono tabular-nums">
                    {summary.continueSet.question_count}{" "}
                    {vi ? "câu hỏi" : "questions"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-muted-foreground text-xs">
                  {vi ? "Học gần nhất: " : "Last studied: "}
                  {formatRelativeTime(summary.continueSet.last_studied_at, locale)}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Button asChild size="sm">
                    <Link href={`/sets/${summary.continueSet.id}/practice`}>
                      <Play className="size-3.5" aria-hidden="true" />
                      <span>{t("study.practice")}</span>
                    </Link>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/sets/${summary.continueSet.id}/flashcards`}>
                      <Layers className="size-3.5" aria-hidden="true" />
                      <span>{t("study.flashcards")}</span>
                    </Link>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/exams/new?setId=${summary.continueSet.id}`}>
                      <FileCheck2 className="size-3.5" aria-hidden="true" />
                      <span>{t("study.exam")}</span>
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Activity Chart & Recent Exam Scores */}
          <div className="grid gap-6 lg:grid-cols-12">
            <Card className="lg:col-span-7">
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">
                      {vi ? "Hoạt động học tập gần đây" : "Recent Learning Activity"}
                    </CardTitle>
                    <CardDescription>
                      {vi
                        ? "Số câu hỏi bạn đã trả lời mỗi ngày."
                        : "Questions answered per day."}
                    </CardDescription>
                  </div>
                  <Button variant="ghost" size="sm" asChild>
                    <Link href="/statistics">{t("nav.stats")}</Link>
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <ActivityChart data={summary.activitySeries} variant="bar" height={220} />
              </CardContent>
            </Card>

            <Card className="lg:col-span-5">
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <CardTitle className="text-base">
                      {vi ? "Điểm thi thử gần đây" : "Recent Exam Scores"}
                    </CardTitle>
                    <CardDescription>
                      {vi
                        ? "Bấm vào lượt thi để tiếp tục hoặc xem kết quả."
                        : "Open any attempt to resume or review results."}
                    </CardDescription>
                  </div>
                  <Button variant="ghost" size="sm" asChild>
                    <Link href="/history">{t("nav.history")}</Link>
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {summary.recentExams.length === 0 ? (
                  <p className="text-muted-foreground py-8 text-center text-sm">
                    {t("exam.noAttempts")}
                  </p>
                ) : (
                  <ul className="divide-border divide-y">
                    {summary.recentExams.slice(0, 5).map((attempt) => {
                      const isInProgress = attempt.status === "in_progress";
                      const targetHref = isInProgress
                        ? `/exams/${attempt.id}`
                        : attempt.study_set_id
                          ? `/sets/${attempt.study_set_id}/results/${attempt.id}`
                          : `/exams/${attempt.id}/results`;
                      return (
                        <li key={attempt.id} className="py-2.5 first:pt-0 last:pb-0">
                          <Link
                            href={targetHref}
                            className="hover:bg-secondary/60 flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 transition-colors"
                          >
                            <div className="min-w-0">
                              <p className="text-foreground truncate text-sm font-medium">
                                {attempt.study_set_title_snapshot}
                              </p>
                              <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                                <Clock className="size-3" aria-hidden="true" />
                                <span>
                                  {formatShortDate(
                                    attempt.submitted_at ?? attempt.created_at,
                                    locale,
                                  )}
                                </span>
                              </p>
                            </div>
                            <div className="flex shrink-0 items-center gap-2">
                              {isInProgress ? (
                                <>
                                  <span className="text-muted-foreground font-mono text-xs tabular-nums">
                                    {attempt.answered_count}/{attempt.total_questions}
                                  </span>
                                  <Badge variant="warning">
                                    <Clock className="size-3" aria-hidden="true" />
                                    <span>{vi ? "Đang làm" : "In progress"}</span>
                                  </Badge>
                                </>
                              ) : (
                                <>
                                  <span className="font-mono text-sm font-semibold tabular-nums">
                                    {Math.round(attempt.score_percent)}%
                                  </span>
                                  <Badge
                                    variant={attempt.passed ? "success" : "destructive"}
                                  >
                                    {attempt.passed ? (
                                      <CheckCircle2 className="size-3" aria-hidden="true" />
                                    ) : (
                                      <XCircle className="size-3" aria-hidden="true" />
                                    )}
                                    <span>
                                      {attempt.passed ? t("exam.passed") : t("exam.failed")}
                                    </span>
                                  </Badge>
                                </>
                              )}
                            </div>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Recent Study Sets */}
          <section aria-labelledby="recent-sets-heading" className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 id="recent-sets-heading" className="text-foreground text-lg font-semibold">
                {vi ? "Học phần gần đây" : "Recent Study Sets"}
              </h2>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/library">
                  <span>{vi ? "Xem tất cả" : "View all"}</span>
                  <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              </Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {summary.recentSets.slice(0, 6).map((set) => (
                <Link
                  key={set.id}
                  href={`/sets/${set.id}`}
                  className="border-border bg-card hover:border-primary/40 flex flex-col justify-between gap-3 rounded-xl border p-4 shadow-xs transition-colors"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant="secondary">
                        {set.set_type === "flashcards"
                          ? t("library.typeFlashcards")
                          : set.set_type === "mixed"
                            ? t("library.typeMixed")
                            : t("library.typeMultipleChoice")}
                      </Badge>
                      <span className="text-muted-foreground font-mono text-xs tabular-nums">
                        {set.question_count} {vi ? "câu" : "items"}
                      </span>
                    </div>
                    <h3 className="text-foreground line-clamp-2 text-sm font-semibold">
                      {set.title}
                    </h3>
                    {set.subject && (
                      <p className="text-muted-foreground truncate text-xs">
                        {set.subject}
                      </p>
                    )}
                  </div>
                  <p className="text-muted-foreground text-xs">
                    {formatRelativeTime(set.last_studied_at ?? set.updated_at, locale)}
                  </p>
                </Link>
              ))}
            </div>
          </section>
        </>
      )}
    </FadeIn>
  );
}
