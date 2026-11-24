"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  Bookmark,
  CheckCircle2,
  ClipboardList,
  Clock,
  Layers,
  Loader2,
  Play,
  Plus,
  RotateCcw,
  XCircle,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { lText } from "@/components/learning/learning-copy";
import { useI18n } from "@/lib/i18n";
import { useUserPreferences } from "@/lib/preferences";
import {
  createExamAttempt,
  fetchAccessibleSets,
  fetchExamEligiblePool,
  listExams,
} from "@/lib/learning/api-client";
import {
  calculateRemainingMs,
  formatCountdownMs,
} from "@/lib/learning/exam-scoring";
import type { ExamSourceInput, SelectionPolicy } from "@/types/domain";
import { formatDuration } from "@/lib/utils";
import { CoverageCyclesSection } from "./CoverageCyclesSection";
import { ExamPresetsSection } from "./ExamPresetsSection";

export function ExamHubClient() {
  const router = useRouter();
  const { locale } = useI18n();
  const { preferences } = useUserPreferences();

  const [quickBusyKey, setQuickBusyKey] = React.useState<string | null>(null);

  const setsQuery = useQuery({
    queryKey: ["accessible-sets-all"],
    queryFn: () => fetchAccessibleSets(),
    staleTime: 60_000,
  });

  const inProgressQuery = useQuery({
    queryKey: ["exams-hub-in-progress"],
    queryFn: () => listExams({ status: "in_progress", page: 1, pageSize: 10 }),
    staleTime: 10_000,
  });

  const recentExamsQuery = useQuery({
    queryKey: ["exams-hub-recent"],
    queryFn: () => listExams({ page: 1, pageSize: 12 }),
    staleTime: 20_000,
  });

  const activeExams = (inProgressQuery.data ?? []).filter((att) => {
    if (att.status !== "in_progress") return false;
    if (!att.expires_at) return true;
    const rem = calculateRemainingMs(att.expires_at);
    return rem === null || rem > 0;
  });

  const recentFinished = (recentExamsQuery.data ?? []).filter(
    (att) => att.status === "submitted" || att.status === "expired",
  );

  const allSets = (setsQuery.data ?? []).filter(
    (s) => !s.is_archived && s.question_count > 0,
  );

  const handleQuickStart = async (
    key: string,
    targetCount: number | "all",
    minutes: number | null,
    policy: SelectionPolicy = "random",
  ) => {
    if (allSets.length === 0) {
      toast.error(
        lText(
          locale,
          "Chưa có học phần nào có câu hỏi để tạo đề nhanh.",
          "No study sets with questions found for Quick Test.",
        ),
      );
      return;
    }

    const setIds = allSets.map((s) => s.id);
    const sources: ExamSourceInput[] = setIds.map((id) => ({
      source_type: "study_set",
      id,
    }));

    setQuickBusyKey(key);
    try {
      const eligible = await fetchExamEligiblePool({
        study_set_ids: setIds,
        selection_policy: policy,
      });

      if (eligible.total_eligible === 0) {
        toast.error(
          lText(
            locale,
            "Không tìm thấy câu hỏi phù hợp.",
            "No eligible questions found.",
          ),
        );
        setQuickBusyKey(null);
        return;
      }

      const finalCount =
        targetCount === "all"
          ? Math.min(1000, eligible.total_eligible)
          : Math.min(targetCount, eligible.total_eligible);

      const created = await createExamAttempt({
        sources,
        title:
          targetCount === "all"
            ? lText(locale, `Thi nhanh tất cả (${finalCount} câu)`, `Quick Test All (${finalCount}Q)`)
            : lText(locale, `Thi nhanh ${finalCount} câu`, `Quick Test ${finalCount}Q`),
        question_count: finalCount,
        allocation_strategy:
          setIds.length > 1 ? "proportional" : "global_random",
        selection_policy: policy,
        duration_limit_seconds: minutes ? minutes * 60 : null,
        pass_threshold: 70,
        shuffle_questions: preferences.default_shuffle_questions,
        shuffle_options: preferences.default_shuffle_options,
        show_subject_names: true,
        show_chapter_names: true,
        allow_navigation: true,
        allow_mark_for_review: true,
        auto_submit_on_expire: true,
        show_review_after_submit: true,
      });

      router.push(`/exams/${created.attempt.id}`);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : lText(locale, "Không thể tạo đề thi nhanh.", "Failed to start quick exam."),
      );
      setQuickBusyKey(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {lText(locale, "Trung tâm Đề thi & Chu kỳ Phủ", "Exams, Presets & Coverage Hub")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {lText(
              locale,
              "Khởi chạy đề thi thử nhanh, quản lý mẫu đề nhiều môn và theo dõi tiến độ phủ 100% ngân hàng câu hỏi.",
              "Launch quick tests, manage multi-subject presets, and track 100% Full Coverage exam cycles.",
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button asChild className="min-h-11">
            <Link href="/exams/new">
              <Plus className="size-4" aria-hidden="true" />
              {lText(locale, "Tạo đề thi tùy chỉnh", "Custom Exam Builder")}
            </Link>
          </Button>
          <Button variant="outline" asChild className="min-h-11">
            <Link href="/practice">
              <Play className="size-4" aria-hidden="true" />
              {lText(locale, "Luyện tập tự do", "Custom Practice")}
            </Link>
          </Button>
        </div>
      </div>

      {/* Quick Test Fast-Path Strip */}
      <Card>
        <CardContent className="space-y-3 py-4">
          <div className="flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <Zap className="size-4 text-primary" aria-hidden="true" />
              {lText(locale, "Thi nhanh 1 chạm", "Quick Test Strip")}
            </h2>
            <Link
              href="/exams/new"
              className="text-xs font-medium text-primary hover:underline"
            >
              {lText(locale, "Tùy chỉnh chi tiết →", "Full customization →")}
            </Link>
          </div>
          <div className="flex flex-wrap gap-2">
            {(
              [
                { key: "20", label: lText(locale, "20 câu · 15p", "20Q · 15m"), count: 20 as const, mins: 15 },
                { key: "50", label: lText(locale, "50 câu · 45p", "50Q · 45m"), count: 50 as const, mins: 45 },
                { key: "100", label: lText(locale, "100 câu · 90p", "100Q · 90m"), count: 100 as const, mins: 90 },
                { key: "250", label: lText(locale, "250 câu · 180p", "250Q · 180m"), count: 250 as const, mins: 180 },
                { key: "all", label: lText(locale, "Tất cả · Không giờ", "All · Untimed"), count: "all" as const, mins: null },
              ] as const
            ).map((item) => (
              <Button
                key={item.key}
                type="button"
                variant="outline"
                size="sm"
                className="min-h-10 tabular-nums"
                disabled={quickBusyKey !== null || allSets.length === 0}
                onClick={() => void handleQuickStart(item.key, item.count, item.mins)}
              >
                {quickBusyKey === item.key ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <Play className="size-3.5 text-primary" aria-hidden="true" />
                )}
                {item.label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Active In-Progress Exams */}
      {activeExams.length > 0 ? (
        <section className="space-y-3" aria-labelledby="active-exams-heading">
          <h2 id="active-exams-heading" className="text-base font-semibold">
            {lText(locale, "Đề thi đang làm dở", "In-Progress Exams")} ({activeExams.length})
          </h2>
          <div className="grid gap-3 md:grid-cols-2">
            {activeExams.map((att) => {
              const rem = calculateRemainingMs(att.expires_at);
              return (
                <Card key={att.id} className="border-primary/40 bg-accent/30">
                  <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 space-y-1">
                      <p className="truncate text-sm font-semibold">
                        {att.study_set_title_snapshot}
                      </p>
                      <p className="text-xs text-muted-foreground tabular-nums">
                        {lText(locale, "Đã trả lời", "Answered")}:{" "}
                        <strong className="text-foreground">
                          {att.answered_count}/{att.total_questions}
                        </strong>
                        {rem !== null
                          ? ` · ${lText(locale, "Còn", "Left")}: ${formatCountdownMs(rem)}`
                          : ` · ${lText(locale, "Không giới hạn giờ", "Untimed")}`}
                      </p>
                    </div>
                    <Button asChild size="sm" className="min-h-10 shrink-0">
                      <Link href={`/exams/${att.id}`}>
                        <RotateCcw className="size-4" aria-hidden="true" />
                        {lText(locale, "Tiếp tục", "Resume")}
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      ) : null}

      {/* Full Coverage Cycles Dashboard */}
      <section className="space-y-3" aria-labelledby="coverage-cycles-heading">
        <div className="flex items-center justify-between gap-2">
          <h2
            id="coverage-cycles-heading"
            className="flex items-center gap-2 text-lg font-semibold"
          >
            <Layers className="size-5 text-primary" aria-hidden="true" />
            {lText(locale, "Chu kỳ Phủ 100% Ngân hàng", "Full Coverage Cycles")}
          </h2>
        </div>
        <CoverageCyclesSection />
      </section>

      {/* Saved Exam Presets */}
      <section className="space-y-3" aria-labelledby="exam-presets-heading">
        <h2
          id="exam-presets-heading"
          className="flex items-center gap-2 text-lg font-semibold"
        >
          <Bookmark className="size-5 text-primary" aria-hidden="true" />
          {lText(locale, "Mẫu đề thi đã lưu", "Saved Exam Presets")}
        </h2>
        <ExamPresetsSection />
      </section>

      {/* Recent Completed Exams */}
      <section className="space-y-3" aria-labelledby="recent-exams-heading">
        <div className="flex items-center justify-between gap-2">
          <h2
            id="recent-exams-heading"
            className="flex items-center gap-2 text-lg font-semibold"
          >
            <ClipboardList className="size-5 text-primary" aria-hidden="true" />
            {lText(locale, "Bài thi gần đây", "Recent Completed Exams")}
          </h2>
          <Link
            href="/history"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            {lText(locale, "Xem toàn bộ lịch sử", "Full history")}
            <ArrowRight className="size-3.5" aria-hidden="true" />
          </Link>
        </div>

        <Card>
          <CardHeader className="sr-only">
            <CardTitle>{lText(locale, "Bài thi gần đây", "Recent Exams")}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {recentExamsQuery.isLoading ? (
              <div className="space-y-2 p-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </div>
            ) : recentFinished.length === 0 ? (
              <div className="py-10 text-center text-sm text-muted-foreground">
                {lText(
                  locale,
                  "Bạn chưa hoàn thành bài thi thử nào. Hãy tạo bài thi đầu tiên!",
                  "You haven't completed any mock exams yet. Create your first exam above!",
                )}
              </div>
            ) : (
              <div
                tabIndex={0}
                role="region"
                aria-labelledby="recent-exams-heading"
                className="overflow-x-auto"
              >
                <Table>
                  <caption className="sr-only">
                    {lText(locale, "Danh sách bài thi thử gần đây", "Recent mock exam attempts")}
                  </caption>
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">{lText(locale, "Bài thi", "Exam")}</TableHead>
                      <TableHead scope="col" className="text-right">
                        {lText(locale, "Kết quả", "Score")}
                      </TableHead>
                      <TableHead scope="col" className="text-right">
                        {lText(locale, "Trạng thái", "Status")}
                      </TableHead>
                      <TableHead scope="col" className="text-right">
                        {lText(locale, "Thời gian", "Time")}
                      </TableHead>
                      <TableHead scope="col" className="text-right">
                        {lText(locale, "Chi tiết", "Action")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentFinished.map((att) => (
                      <TableRow key={att.id}>
                        <TableCell className="font-medium">
                          <div className="max-w-[280px] truncate">
                            {att.study_set_title_snapshot}
                          </div>
                          <div className="text-xs text-muted-foreground tabular-nums">
                            {att.correct_count}/{att.total_questions}{" "}
                            {lText(locale, "câu đúng", "correct")}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">
                          {Number(att.score_percent).toFixed(1)}%
                        </TableCell>
                        <TableCell className="text-right">
                          {att.passed ? (
                            <Badge variant="success">
                              <CheckCircle2 className="size-3" aria-hidden="true" />
                              {lText(locale, "Đạt", "Passed")}
                            </Badge>
                          ) : (
                            <Badge variant="destructive">
                              <XCircle className="size-3" aria-hidden="true" />
                              {lText(locale, "Chưa đạt", "Failed")}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground tabular-nums">
                          <span className="inline-flex items-center gap-1">
                            <Clock className="size-3" aria-hidden="true" />
                            {formatDuration(att.time_spent_seconds)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" asChild>
                            <Link href={`/exams/${att.id}/results`}>
                              {lText(locale, "Xem kết quả", "Results")}
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
