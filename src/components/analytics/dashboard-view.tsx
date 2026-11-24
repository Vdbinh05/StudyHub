"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  Clock,
  FileCheck2,
  Flame,
  FolderOpen,
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
  type DailyActivityPoint,
  type DashboardSummary,
} from "./analytics-types";

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

  const candidateContinue =
    ((obj.continueSet ?? obj.continue_set ?? continueList[0] ?? null) as StudySet | null);
  const studiedContinueSet =
    candidateContinue && candidateContinue.last_studied_at
      ? candidateContinue
      : recentSets.find((set) => Boolean(set.last_studied_at)) ?? null;

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
    continueSet: studiedContinueSet,
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
      return vi ? "Học thích ứng" : "Adaptive Learn";
    case "practice":
      return vi ? "Luyện trắc nghiệm" : "Practice";
    case "write":
      return vi ? "Gõ đáp án" : "Write";
    case "spell":
      return vi ? "Nghe & Gõ" : "Spell";
    case "match":
      return vi ? "Ghép thẻ" : "Match";
    case "diagram":
      return vi ? "Sơ đồ tương tác" : "Diagram";
    case "custom_practice":
      return vi ? "Luyện tập tùy chọn" : "Custom Practice";
    case "review":
      return vi ? "Ôn lỗi sai" : "Review Mistakes";
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

function MiniActivityStrip({
  data,
  vi,
}: {
  data: DailyActivityPoint[];
  vi: boolean;
}) {
  const recent = data.slice(-14);
  const totalAnswered = recent.reduce((acc, pt) => acc + pt.answered, 0);
  const maxAnswered = Math.max(1, ...recent.map((pt) => pt.answered));

  if (recent.length === 0 || totalAnswered === 0) {
    return (
      <p className="text-muted-foreground py-3 text-xs">
        {vi
          ? "Chưa có hoạt động trong 14 ngày qua. Bắt đầu một phiên học để ghi nhận tiến độ."
          : "No activity recorded in the last 14 days yet. Start a study session to track progress."}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div
        role="img"
        aria-label={
          vi
            ? `Biểu đồ 14 ngày gần đây: tổng ${totalAnswered} câu đã trả lời`
            : `Last 14 days activity chart: ${totalAnswered} total questions answered`
        }
        className="flex h-20 items-end gap-1.5 pt-2"
      >
        {recent.map((point) => {
          const pct =
            point.answered > 0
              ? Math.max(12, Math.round((point.answered / maxAnswered) * 100))
              : 4;
          return (
            <div
              key={point.date || point.label}
              title={`${point.label || point.date}: ${point.answered} ${vi ? "câu" : "items"}`}
              className="flex h-full flex-1 flex-col items-center justify-end gap-1"
            >
              <div
                className={
                  point.answered > 0
                    ? "bg-primary/85 hover:bg-primary w-full rounded-t-sm transition-colors"
                    : "bg-secondary w-full rounded-t-sm"
                }
                style={{ height: `${pct}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="text-muted-foreground flex items-center justify-between text-[11px] font-mono tabular-nums">
        <span>{recent[0]?.label ?? ""}</span>
        <span>
          {totalAnswered.toLocaleString()} {vi ? "câu / 14 ngày" : "items / 14d"}
        </span>
        <span>{recent[recent.length - 1]?.label ?? ""}</span>
      </div>
    </div>
  );
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

  if (!configured) {
    return (
      <div className="space-y-6">
        <div className="space-y-1">
          <h1 className="text-foreground text-2xl font-bold tracking-tight sm:text-[1.75rem]">
            {vi ? "Trang chủ" : "Home"}
          </h1>
          <p className="text-muted-foreground text-sm">
            {vi
              ? "Không gian học tập, ôn thẻ ghi nhớ và thi thử cá nhân của bạn."
              : "Your workspace for study sets, daily review, and mock exams."}
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
              <Link href="/exams/new" prefetch={false}>
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
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-2">
            <Skeleton className="h-8 w-56" />
            <Skeleton className="h-4 w-44" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-9 w-28" />
          </div>
        </div>
        <Skeleton className="h-28 w-full rounded-xl" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-32 rounded-xl" />
          ))}
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
              ? "Vui lòng đăng nhập để xem trang chủ"
              : "Sign in to view your workspace"
            : vi
              ? "Không thể tải dữ liệu trang chủ"
              : "Unable to load workspace"
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
  const masteredPct =
    summary.totalQuestions > 0
      ? Math.round((summary.masteredQuestions / summary.totalQuestions) * 100)
      : 0;

  const latestCheckpoint = summary.activeCheckpoints[0] ?? null;
  const extraCheckpoints = summary.activeCheckpoints.slice(1, 4);

  const renderCheckpointBanner = (cp: LearningSessionCheckpoint) => {
    const matchedSet =
      summary.recentSets.find((s) => s.id === cp.study_set_id) ??
      (summary.continueSet?.id === cp.study_set_id ? summary.continueSet : null);
    const modeTitle = getCheckpointModeLabel(cp.mode, vi);
    const label = matchedSet ? `${matchedSet.title} · ${modeTitle}` : modeTitle;
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
  };

  return (
    <div className="space-y-5">
      {/* BLOCK 1: Compact Greeting + 3 Quick Actions + Inline Daily Goal */}
      <section className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-foreground text-xl font-bold tracking-tight sm:text-2xl">
                {summary.displayName
                  ? vi
                    ? `Xin chào, ${summary.displayName}`
                    : `Welcome back, ${summary.displayName}`
                  : vi
                    ? "Trang chủ"
                    : "Home"}
              </h1>
              {summary.streakDays > 0 && (
                <Badge variant="warning" className="font-mono tabular-nums">
                  <Flame className="size-3.5" aria-hidden="true" />
                  <span>
                    {summary.streakDays} {vi ? "ngày" : "d"}
                  </span>
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2.5 text-xs">
              <span className="text-muted-foreground">
                {vi ? "Hôm nay:" : "Today:"}{" "}
                <strong className="text-foreground font-mono tabular-nums">
                  {summary.todayAnswered}/{summary.dailyGoal}
                </strong>{" "}
                {vi ? "câu" : "items"}
              </span>
              <div className="w-28 sm:w-36">
                <Progress value={dailyProgressPct} aria-label={t("stats.dailyGoal")} />
              </div>
              <span className="text-muted-foreground font-mono tabular-nums">
                {dailyProgressPct}%
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button asChild size="sm">
              <Link href="/library" prefetch={false}>
                <FolderOpen className="size-4" aria-hidden="true" />
                <span>{vi ? "Thư viện" : "Library"}</span>
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/exams/new" prefetch={false}>
                <FileCheck2 className="size-4" aria-hidden="true" />
                <span>{vi ? "Thi thử" : "Mock Exam"}</span>
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link href="/import" prefetch={false}>
                <Upload className="size-4" aria-hidden="true" />
                <span>{vi ? "Nhập tài liệu" : "Import"}</span>
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Brand-New Empty State OR Student Study Flow */}
      {summary.totalSets === 0 ? (
        <EmptyState
          icon={BookOpen}
          title={vi ? "Bắt đầu học phần đầu tiên của bạn" : "Create your first study set"}
          description={
            vi
              ? "Tạo bộ câu hỏi hoặc flashcard mới, hoặc nhập nhanh từ file Word (.docx), PDF, Excel (.xlsx), CSV, TXT."
              : "Create a new study set, or bulk import an existing DOCX, PDF, XLSX, CSV, or TXT bank."
          }
          action={
            <Button asChild>
              <Link href="/sets/new" prefetch={false}>
                <Plus className="size-4" aria-hidden="true" />
                <span>{t("library.newSet")}</span>
              </Link>
            </Button>
          }
          secondaryAction={
            <Button variant="outline" asChild>
              <Link href="/import" prefetch={false}>
                <Upload className="size-4" aria-hidden="true" />
                <span>{t("library.importSet")}</span>
              </Link>
            </Button>
          }
        />
      ) : (
        <>
          {/* BLOCK 2: Single Unified Continue Learning Card (only when a real checkpoint or studied set exists) */}
          {latestCheckpoint ? (
            <section aria-labelledby="continue-heading" className="space-y-2.5">
              <h2
                id="continue-heading"
                className="text-foreground text-sm font-semibold"
              >
                {t("resume.continueLearning")}
              </h2>
              {renderCheckpointBanner(latestCheckpoint)}
              {extraCheckpoints.length > 0 && (
                <details className="group">
                  <summary className="text-muted-foreground hover:text-foreground inline-flex cursor-pointer list-none items-center gap-1.5 text-xs font-medium select-none">
                    <ChevronDown
                      className="size-3.5 transition-transform group-open:rotate-180"
                      aria-hidden="true"
                    />
                    <span>
                      {vi
                        ? `Xem thêm ${extraCheckpoints.length} phiên học đang dở`
                        : `Show ${extraCheckpoints.length} more active sessions`}
                    </span>
                  </summary>
                  <div className="mt-2.5 space-y-2.5">
                    {extraCheckpoints.map((cp) => renderCheckpointBanner(cp))}
                  </div>
                </details>
              )}
            </section>
          ) : summary.continueSet ? (
            <Card>
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <CardDescription>
                      {vi ? "Tiếp tục học" : "Continue learning"}
                    </CardDescription>
                    <CardTitle className="mt-0.5 truncate text-base sm:text-lg">
                      <Link
                        href={`/sets/${summary.continueSet.id}`}
                        prefetch={false}
                        className="hover:text-primary transition-colors"
                      >
                        {summary.continueSet.title}
                      </Link>
                    </CardTitle>
                  </div>
                  <Badge variant="secondary" className="font-mono tabular-nums">
                    {summary.continueSet.question_count} {vi ? "câu" : "items"}
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
                    <Link
                      href={`/sets/${summary.continueSet.id}/practice`}
                      prefetch={false}
                    >
                      <Play className="size-3.5" aria-hidden="true" />
                      <span>{t("study.practice")}</span>
                    </Link>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <Link
                      href={`/sets/${summary.continueSet.id}/flashcards`}
                      prefetch={false}
                    >
                      <Layers className="size-3.5" aria-hidden="true" />
                      <span>{t("study.flashcards")}</span>
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {/* BLOCK 3: Your Study Sets (Prominent near the top on mobile & desktop) */}
          <section aria-labelledby="recent-sets-heading" className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2
                id="recent-sets-heading"
                className="text-foreground text-base font-semibold sm:text-lg"
              >
                {vi ? "Học phần của bạn" : "Your Study Sets"}
              </h2>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/sets/new" prefetch={false}>
                    <Plus className="size-4" aria-hidden="true" />
                    <span className="hidden sm:inline">{t("library.newSet")}</span>
                  </Link>
                </Button>
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/library" prefetch={false}>
                    <span>{vi ? "Xem tất cả" : "View all"}</span>
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </Link>
                </Button>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {summary.recentSets.slice(0, 6).map((set) => {
                const quickStudyHref =
                  set.set_type === "flashcards"
                    ? `/sets/${set.id}/flashcards`
                    : `/sets/${set.id}/practice`;
                return (
                  <div
                    key={set.id}
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
                        <Link
                          href={`/sets/${set.id}`}
                          prefetch={false}
                          className="hover:text-primary transition-colors"
                        >
                          {set.title}
                        </Link>
                      </h3>
                      {set.subject && (
                        <p className="text-muted-foreground truncate text-xs">
                          {set.subject}
                        </p>
                      )}
                    </div>

                    <div className="border-border flex items-center justify-between gap-2 border-t pt-2.5">
                      <span className="text-muted-foreground truncate text-xs">
                        {set.last_studied_at
                          ? formatRelativeTime(set.last_studied_at, locale)
                          : vi
                            ? "Sẵn sàng học"
                            : "Ready to study"}
                      </span>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Button asChild size="sm" variant="secondary" className="h-8 px-2.5 text-xs">
                          <Link href={quickStudyHref} prefetch={false}>
                            <Play className="size-3" aria-hidden="true" />
                            <span>{vi ? "Học" : "Study"}</span>
                          </Link>
                        </Button>
                        <Button asChild size="sm" variant="ghost" className="h-8 px-2 text-xs">
                          <Link href={`/sets/${set.id}`} prefetch={false}>
                            {vi ? "Chi tiết" : "Open"}
                          </Link>
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>

          {/* BLOCK 4: Compact Review Queue + Recent Exams */}
          <section className="cv-auto grid gap-4 lg:grid-cols-12">
            <Card className="lg:col-span-5">
              <CardContent className="flex h-full flex-col justify-between gap-3 py-1">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <p className="text-muted-foreground text-xs font-medium">
                      {vi ? "Cần ôn tập hôm nay" : "Needs Review"}
                    </p>
                    <p className="text-foreground font-mono text-2xl font-bold tabular-nums">
                      {summary.dueForReview.toLocaleString()}{" "}
                      <span className="text-muted-foreground font-sans text-xs font-normal">
                        {vi ? "câu hỏi" : "questions"}
                      </span>
                    </p>
                    <p className="text-muted-foreground text-xs leading-relaxed">
                      {summary.dueForReview > 0
                        ? vi
                          ? "Ôn lại câu sai và thẻ đến hạn lặp lại để củng cố trí nhớ dài hạn."
                          : "Review mistakes and due spaced-repetition cards to lock in memory."
                        : vi
                          ? "Tuyệt vời! Bạn đã hoàn thành hết câu đến hạn hôm nay."
                          : "All caught up! No due review items remaining today."}
                    </p>
                  </div>
                  <div className="bg-warning-subtle text-warning-subtle-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
                    <RotateCcw className="size-4" aria-hidden="true" />
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Button
                    asChild
                    size="sm"
                    variant={summary.dueForReview > 0 ? "default" : "outline"}
                  >
                    <Link href="/review" prefetch={false}>
                      <RotateCcw className="size-3.5" aria-hidden="true" />
                      <span>
                        {summary.dueForReview > 0
                          ? vi
                            ? `Ôn ngay (${summary.dueForReview})`
                            : `Review now (${summary.dueForReview})`
                          : vi
                            ? "Mở kho lỗi sai"
                            : "Open review queue"}
                      </span>
                    </Link>
                  </Button>
                  <Button asChild size="sm" variant="ghost">
                    <Link href="/practice" prefetch={false}>
                      <span>{vi ? "Luyện tập" : "Practice"}</span>
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="lg:col-span-7">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-sm font-semibold sm:text-base">
                    {vi ? "Lượt thi thử gần đây" : "Recent Exam Attempts"}
                  </CardTitle>
                  <Button variant="ghost" size="sm" asChild>
                    <Link href="/history" prefetch={false}>
                      <span>{t("nav.history")}</span>
                      <ArrowRight className="size-3.5" aria-hidden="true" />
                    </Link>
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {summary.recentExams.length === 0 ? (
                  <div className="flex flex-col items-start justify-between gap-2 py-2 sm:flex-row sm:items-center">
                    <p className="text-muted-foreground text-xs">
                      {t("exam.noAttempts")}
                    </p>
                    <Button asChild size="sm" variant="outline">
                      <Link href="/exams/new" prefetch={false}>
                        <FileCheck2 className="size-3.5" aria-hidden="true" />
                        <span>{vi ? "Làm đề đầu tiên" : "Take first exam"}</span>
                      </Link>
                    </Button>
                  </div>
                ) : (
                  <ul className="divide-border divide-y">
                    {summary.recentExams.slice(0, 3).map((attempt) => {
                      const isInProgress = attempt.status === "in_progress";
                      const targetHref = isInProgress
                        ? `/exams/${attempt.id}`
                        : attempt.study_set_id
                          ? `/sets/${attempt.study_set_id}/results/${attempt.id}`
                          : `/exams/${attempt.id}/results`;
                      return (
                        <li key={attempt.id} className="py-2 first:pt-0 last:pb-0">
                          <Link
                            href={targetHref}
                            prefetch={false}
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
                                <Badge variant="warning">
                                  <span>
                                    {attempt.answered_count}/{attempt.total_questions}
                                  </span>
                                </Badge>
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
          </section>

          {/* BLOCK 5: Compact 3-Stat Strip + Zero-Dependency 14-Day CSS Activity Bar */}
          <Card className="cv-auto">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-sm font-semibold sm:text-base">
                  {vi ? "Tổng quan tiến độ" : "Progress Snapshot"}
                </CardTitle>
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/statistics" prefetch={false}>
                    <span>{vi ? "Thống kê chi tiết" : "Full analytics"}</span>
                    <ArrowRight className="size-3.5" aria-hidden="true" />
                  </Link>
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-secondary/50 rounded-lg p-3">
                  <p className="text-muted-foreground text-xs">
                    {vi ? "Ngân hàng" : "Question bank"}
                  </p>
                  <p className="text-foreground mt-0.5 font-mono text-lg font-bold tabular-nums sm:text-xl">
                    {summary.totalQuestions.toLocaleString()}
                  </p>
                  <p className="text-muted-foreground text-[11px]">
                    {summary.totalSets} {vi ? "học phần" : "sets"}
                  </p>
                </div>

                <div className="bg-secondary/50 rounded-lg p-3">
                  <p className="text-muted-foreground text-xs">
                    {vi ? "Thành thạo" : "Mastered"}
                  </p>
                  <p className="text-foreground mt-0.5 font-mono text-lg font-bold tabular-nums sm:text-xl">
                    {summary.masteredQuestions.toLocaleString()}
                  </p>
                  <p className="text-muted-foreground font-mono text-[11px] tabular-nums">
                    {masteredPct}% {vi ? "tổng câu" : "of total"}
                  </p>
                </div>

                <div className="bg-secondary/50 rounded-lg p-3">
                  <p className="text-muted-foreground text-xs">
                    {vi ? "Độ chính xác" : "Accuracy"}
                  </p>
                  <p className="text-foreground mt-0.5 font-mono text-lg font-bold tabular-nums sm:text-xl">
                    {summary.studyAccuracy}%
                  </p>
                  <p className="text-muted-foreground flex items-center gap-1 text-[11px]">
                    <Target className="size-3" aria-hidden="true" />
                    <span>{vi ? "Trung bình" : "Overall"}</span>
                  </p>
                </div>
              </div>

              <MiniActivityStrip data={summary.activitySeries} vi={vi} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
