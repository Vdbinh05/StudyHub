"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Layers,
  Loader2,
  Play,
  Plus,
  RotateCcw,
  Trash2,
  XCircle,
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
import { Skeleton } from "@/components/ui/skeleton";
import { lText } from "@/components/learning/learning-copy";
import { useI18n } from "@/lib/i18n";
import {
  deleteCoverageCycle,
  discardCoverageActiveExam,
  issueCoverageNextExam,
  listCoverageCycles,
  restartCoverageCycleApi,
} from "@/lib/learning/api-client";
import { planCoverageSeries } from "@/lib/learning/coverage-engine";
import type { CoverageCycle } from "@/types/domain";
import { getAllocationLabel } from "./exam-labels";

interface CoverageCyclesSectionProps {
  compact?: boolean;
}

export function CoverageCyclesSection({
  compact = false,
}: CoverageCyclesSectionProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { locale } = useI18n();

  const [statusFilter, setStatusFilter] = React.useState<
    "all" | "active" | "completed"
  >("all");
  const [busyCycleId, setBusyCycleId] = React.useState<string | null>(null);
  const busyLockRef = React.useRef<boolean>(false);
  const [discardTarget, setDiscardTarget] =
    React.useState<CoverageCycle | null>(null);
  const [restartTarget, setRestartTarget] =
    React.useState<CoverageCycle | null>(null);
  const [deleteTarget, setDeleteTarget] =
    React.useState<CoverageCycle | null>(null);

  const cyclesQuery = useQuery({
    queryKey: ["coverage-cycles", statusFilter],
    queryFn: () =>
      listCoverageCycles(statusFilter === "all" ? undefined : statusFilter),
    staleTime: 15_000,
  });

  const cycles = cyclesQuery.data ?? [];

  const handleIssueNextExam = async (cycle: CoverageCycle) => {
    if (busyLockRef.current) return;
    busyLockRef.current = true;
    setBusyCycleId(cycle.id);
    try {
      const payload = await issueCoverageNextExam(cycle.id);
      // Seed React Query caches before routing for 0ms exam hydration (PERF-04)
      queryClient.setQueryData(["exam-attempt", payload.attempt.id], payload);
      queryClient.setQueryData(["exam-attempt-live", payload.attempt.id], payload);
      void queryClient.invalidateQueries({ queryKey: ["coverage-cycles"] });
      router.push(`/exams/${payload.attempt.id}`);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : lText(
              locale,
              "Không thể tạo đề tiếp theo cho chu kỳ này.",
              "Could not generate the next exam for this cycle.",
            ),
      );
      busyLockRef.current = false;
      setBusyCycleId(null);
    }
  };

  const handleConfirmDiscard = async () => {
    if (!discardTarget || busyLockRef.current) return;
    busyLockRef.current = true;
    setBusyCycleId(discardTarget.id);
    try {
      await discardCoverageActiveExam(discardTarget.id);
      toast.success(
        lText(
          locale,
          "Đã hủy đề đang làm dở và trả toàn bộ câu hỏi về ngân hàng chưa thi.",
          "Active exam discarded — all its questions were returned to the remaining pool.",
        ),
      );
      setDiscardTarget(null);
      await queryClient.invalidateQueries({ queryKey: ["coverage-cycles"] });
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : lText(locale, "Không thể hủy đề đang làm.", "Could not discard active exam."),
      );
    } finally {
      busyLockRef.current = false;
      setBusyCycleId(null);
    }
  };

  const handleConfirmRestart = async () => {
    if (!restartTarget || busyLockRef.current) return;
    busyLockRef.current = true;
    setBusyCycleId(restartTarget.id);
    try {
      await restartCoverageCycleApi(restartTarget.id, {
        refresh_pool: true,
        force_discard_active: Boolean(restartTarget.active_attempt_id),
      });
      toast.success(
        lText(
          locale,
          "Đã bắt đầu chu kỳ mới với thứ tự xáo trộn lại hoàn toàn.",
          "Started a fresh coverage cycle with reshuffled pool.",
        ),
      );
      setRestartTarget(null);
      await queryClient.invalidateQueries({ queryKey: ["coverage-cycles"] });
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : lText(locale, "Không thể khởi động lại chu kỳ.", "Failed to restart cycle."),
      );
    } finally {
      busyLockRef.current = false;
      setBusyCycleId(null);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || busyLockRef.current) return;
    busyLockRef.current = true;
    setBusyCycleId(deleteTarget.id);
    try {
      await deleteCoverageCycle(deleteTarget.id);
      toast.success(
        lText(
          locale,
          "Đã xóa chu kỳ phủ. Lịch sử các bài thi đã nộp vẫn được giữ lại.",
          "Coverage cycle deleted. Submitted exam attempts remain in your history.",
        ),
      );
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: ["coverage-cycles"] });
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : lText(locale, "Không thể xóa chu kỳ.", "Failed to delete cycle."),
      );
    } finally {
      busyLockRef.current = false;
      setBusyCycleId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="group"
          aria-label={lText(locale, "Lọc trạng thái chu kỳ", "Filter cycle status")}
          className="flex flex-wrap items-center gap-1.5"
        >
          {(
            [
              ["all", lText(locale, "Tất cả", "All")],
              ["active", lText(locale, "Đang thực hiện", "Active")],
              ["completed", lText(locale, "Hoàn thành 100%", "Completed")],
            ] as const
          ).map(([val, label]) => (
            <Button
              key={val}
              type="button"
              size="sm"
              variant={statusFilter === val ? "default" : "outline"}
              className="min-h-11 sm:min-h-9"
              aria-pressed={statusFilter === val}
              onClick={() => setStatusFilter(val)}
            >
              {label}
            </Button>
          ))}
        </div>

        {!compact ? (
          <Button asChild size="sm" className="min-h-10">
            <Link href="/exams/new?coverage=1">
              <Plus className="size-4" aria-hidden="true" />
              {lText(locale, "Tạo chu kỳ phủ 100%", "New Coverage Cycle")}
            </Link>
          </Button>
        ) : null}
      </div>

      {cyclesQuery.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-52 rounded-xl" />
        </div>
      ) : cycles.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-secondary text-muted-foreground">
              <Layers className="size-5" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-semibold">
                {lText(
                  locale,
                  "Chưa có Chu kỳ Phủ hết ngân hàng nào",
                  "No Full Coverage Cycles yet",
                )}
              </h3>
              <p className="max-w-md text-sm text-muted-foreground">
                {lText(
                  locale,
                  "Chế độ Phủ 100% chia toàn bộ ngân hàng (ví dụ 500 câu thành 250 + 250 hoặc 120 × 4 + 20) thành các đề thi liên tiếp không bao giờ lặp câu hỏi.",
                  "Full Coverage splits an entire bank (e.g. 500 questions into 250 + 250 or 120 × 4 + 20) into sequential non-overlapping exams.",
                )}
              </p>
            </div>
            <Button asChild className="min-h-11">
              <Link href="/exams/new?coverage=1">
                <Plus className="size-4" aria-hidden="true" />
                {lText(locale, "Bắt đầu chu kỳ phủ 100%", "Start Full Coverage Cycle")}
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {cycles.map((cycle) => {
            const total = Math.max(1, cycle.total_questions);
            const completed = cycle.completed_count;
            const assigned = cycle.assigned_count;
            const remaining =
              cycle.remaining_count ?? Math.max(0, total - completed - assigned);
            const completedPct = Math.min(100, Math.round((completed / total) * 100));
            const assignedPct = Math.min(
              100 - completedPct,
              Math.round((assigned / total) * 100),
            );
            const remainingPlan = planCoverageSeries(
              remaining,
              cycle.questions_per_exam,
            );
            const nextBatchSize = Math.min(cycle.questions_per_exam, remaining);
            const isBusy = busyCycleId === cycle.id;
            const sourceSetIds = (cycle.source_snapshot ?? [])
              .map((s) => s.study_set_id)
              .filter(Boolean);

            return (
              <Card key={cycle.id}>
                <CardContent className="space-y-5 py-5">
                  {/* Header */}
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-base font-semibold text-foreground">
                          {cycle.title}
                        </h3>
                        <Badge variant="outline" className="tabular-nums">
                          {lText(locale, "Chu kỳ", "Cycle")} #{cycle.cycle_number}
                        </Badge>
                        {cycle.status === "completed" ? (
                          <Badge variant="success">
                            <CheckCircle2 className="size-3" aria-hidden="true" />
                            {lText(locale, "Hoàn thành 100%", "100% Completed")}
                          </Badge>
                        ) : (
                          <Badge variant="accent">
                            <Clock className="size-3" aria-hidden="true" />
                            {lText(locale, "Đang thực hiện", "Active")}
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
                        <span>
                          {cycle.questions_per_exam}{" "}
                          {lText(locale, "câu/đề", "Q/exam")}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          {getAllocationLabel(locale, cycle.allocation_strategy)}
                        </span>
                        {cycle.source_snapshot.slice(0, 3).map((src) => (
                          <Badge
                            key={src.study_set_id}
                            variant="secondary"
                            className="max-w-[160px] truncate text-[11px]"
                          >
                            {src.title}
                          </Badge>
                        ))}
                        {cycle.source_snapshot.length > 3 ? (
                          <span className="text-[11px]">
                            +{cycle.source_snapshot.length - 3}
                          </span>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="min-h-11 sm:min-h-9"
                        disabled={isBusy}
                        onClick={() => setRestartTarget(cycle)}
                      >
                        <RotateCcw className="size-4" aria-hidden="true" />
                        {lText(locale, "Đặt lại", "Restart")}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="min-h-11 min-w-11 sm:min-h-9 sm:min-w-9 text-muted-foreground hover:text-destructive"
                        disabled={isBusy}
                        aria-label={lText(
                          locale,
                          `Xóa chu kỳ ${cycle.title}`,
                          `Delete cycle ${cycle.title}`,
                        )}
                        onClick={() => setDeleteTarget(cycle)}
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </Button>
                    </div>
                  </div>

                  {/* Tri-State Progress Bar (Completed / In-Progress / Remaining — color + icon + text!) */}
                  <div className="space-y-2">
                    <div
                      className="flex h-3 w-full overflow-hidden rounded-full bg-secondary border border-border"
                      role="img"
                      aria-label={lText(
                        locale,
                        `Hoàn thành ${completed}, đang làm ${assigned}, còn lại ${remaining} trên ${cycle.total_questions} câu`,
                        `Completed ${completed}, in progress ${assigned}, remaining ${remaining} of ${cycle.total_questions} questions`,
                      )}
                    >
                      {completedPct > 0 ? (
                        <div
                          className="h-full bg-primary transition-all"
                          style={{ width: `${completedPct}%` }}
                        />
                      ) : null}
                      {assignedPct > 0 ? (
                        <div
                          className="h-full bg-warning/75 transition-all"
                          style={{ width: `${assignedPct}%` }}
                        />
                      ) : null}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs tabular-nums">
                      <span className="inline-flex items-center gap-1.5 font-medium text-primary">
                        <CheckCircle2 className="size-3.5" aria-hidden="true" />
                        {lText(locale, "Hoàn thành", "Completed")}: {completed}/
                        {cycle.total_questions} ({completedPct}%)
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-warning-subtle-foreground">
                        <Clock className="size-3.5" aria-hidden="true" />
                        {lText(locale, "Đang thi dở", "In Progress")}: {assigned}
                      </span>
                      <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                        <Layers className="size-3.5" aria-hidden="true" />
                        {lText(locale, "Còn lại", "Remaining")}: {remaining}
                        {remaining > 0
                          ? ` (${remainingPlan.formattedPlan})`
                          : ""}
                      </span>
                    </div>
                  </div>

                  {/* Explicit Active Attempt Guard Banner */}
                  {cycle.active_attempt_id ? (
                    <div
                      role="status"
                      className="flex flex-col gap-3 rounded-lg border border-warning/50 bg-warning-subtle p-4 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex items-start gap-2.5 text-sm text-warning-subtle-foreground">
                        <AlertTriangle
                          className="mt-0.5 size-4 shrink-0"
                          aria-hidden="true"
                        />
                        <div>
                          <p className="font-semibold">
                            {lText(
                              locale,
                              "Có 1 đề thi trong chu kỳ đang làm dở",
                              "An exam in this cycle is currently in progress",
                            )}
                          </p>
                          <p className="text-xs opacity-90 tabular-nums">
                            {cycle.active_attempt
                              ? lText(
                                  locale,
                                  `Đã trả lời ${cycle.active_attempt.answered_count}/${cycle.active_attempt.total_questions} câu. Hoàn thành hoặc hủy đề này trước khi tạo đề tiếp theo.`,
                                  `Answered ${cycle.active_attempt.answered_count}/${cycle.active_attempt.total_questions}. Finish or discard before generating the next exam.`,
                                )
                              : lText(
                                  locale,
                                  "Tiếp tục làm bài hoặc hủy để trả câu hỏi về ngân hàng chưa thi.",
                                  "Resume this attempt or discard it to return questions to the remaining pool.",
                                )}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <Button asChild size="sm" className="min-h-10">
                          <Link href={`/exams/${cycle.active_attempt_id}`}>
                            <Play className="size-4" aria-hidden="true" />
                            {lText(locale, "Tiếp tục làm", "Resume Exam")}
                          </Link>
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="min-h-10 border-destructive/40 text-destructive hover:bg-destructive-subtle"
                          disabled={isBusy}
                          onClick={() => setDiscardTarget(cycle)}
                        >
                          <XCircle className="size-4" aria-hidden="true" />
                          {lText(locale, "Hủy & trả câu về ngân hàng", "Discard Active")}
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  {/* Per-Subject Coverage Breakdown */}
                  {cycle.subject_progress && cycle.subject_progress.length > 1 ? (
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {cycle.subject_progress.map((sp) => {
                        const spPct =
                          sp.total > 0
                            ? Math.round((sp.completed / sp.total) * 100)
                            : 0;
                        return (
                          <div
                            key={sp.study_set_id ?? sp.subject_title}
                            className="rounded-lg border border-border bg-secondary/30 px-3 py-2 text-xs"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate font-medium text-foreground">
                                {sp.subject_title}
                              </span>
                              <span className="shrink-0 tabular-nums text-muted-foreground">
                                {sp.completed}/{sp.total}
                              </span>
                            </div>
                            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                              <div
                                className="h-full bg-primary"
                                style={{ width: `${spPct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}

                  {/* Attempt History inside Cycle */}
                  {cycle.attempts && cycle.attempts.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-2">
                      {cycle.attempts.map((att) => (
                        <Link
                          key={att.id}
                          href={
                            att.status === "in_progress"
                              ? `/exams/${att.attempt_id}`
                              : att.status === "completed"
                                ? `/exams/${att.attempt_id}/results`
                                : "#"
                          }
                          aria-disabled={att.status === "discarded"}
                          className={
                            att.status === "discarded"
                              ? "pointer-events-none inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary/40 px-2.5 py-1 text-xs text-muted-foreground line-through tabular-nums"
                              : "inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground hover:bg-secondary transition-colors tabular-nums"
                          }
                        >
                          <span>
                            {lText(locale, "Đề", "Exam")} #{att.sequence_number}
                          </span>
                          <span className="text-muted-foreground">
                            ({att.assigned_question_count}
                            {lText(locale, "c", "Q")})
                          </span>
                          {typeof att.score_percent === "number" &&
                          att.status === "completed" ? (
                            <Badge
                              variant={att.passed ? "success" : "destructive"}
                              className="px-1.5 py-0 text-[10px]"
                            >
                              {att.score_percent.toFixed(0)}%
                            </Badge>
                          ) : att.status === "discarded" ? (
                            <span className="text-[10px]">
                              {lText(locale, "Đã hủy", "Discarded")}
                            </span>
                          ) : null}
                        </Link>
                      ))}
                    </div>
                  ) : null}

                  {/* Footer Actions */}
                  <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                    {cycle.status === "completed" ? (
                      <>
                        <Button
                          type="button"
                          size="sm"
                          className="min-h-10"
                          disabled={isBusy}
                          onClick={() => setRestartTarget(cycle)}
                        >
                          <RotateCcw className="size-4" aria-hidden="true" />
                          {lText(
                            locale,
                            "Bắt đầu chu kỳ mới (Xáo trộn lại)",
                            "Start New Cycle (Reshuffle)",
                          )}
                        </Button>
                        {sourceSetIds.length > 0 ? (
                          <Button
                            variant="outline"
                            size="sm"
                            className="min-h-10"
                            asChild
                          >
                            <Link
                              href={`/exams/new?mode=mistakes&setIds=${sourceSetIds.join(",")}`}
                            >
                              {lText(
                                locale,
                                "Ôn các câu sai trong chu kỳ",
                                "Review Cycle Mistakes",
                              )}
                            </Link>
                          </Button>
                        ) : null}
                      </>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        className="min-h-10"
                        disabled={Boolean(cycle.active_attempt_id) || isBusy || remaining === 0}
                        onClick={() => void handleIssueNextExam(cycle)}
                      >
                        {isBusy ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <Play className="size-4" aria-hidden="true" />
                        )}
                        {lText(
                          locale,
                          `Tạo đề tiếp theo (${nextBatchSize} câu)`,
                          `Next Exam (${nextBatchSize} questions)`,
                        )}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Discard Active Exam Confirmation */}
      <AlertDialog
        open={Boolean(discardTarget)}
        onOpenChange={(open) => {
          if (!open) setDiscardTarget(null);
        }}
      >
        <AlertDialogContent className="overscroll-contain">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {lText(
                locale,
                "Hủy đề đang làm dở & trả câu hỏi về ngân hàng?",
                "Discard active exam & return questions to pool?",
              )}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {lText(
                locale,
                "Đề thi đang dở sẽ bị hủy. Toàn bộ câu hỏi của đề này sẽ quay về nhóm Chưa thi (không bị đánh dấu hoàn thành giả) để bạn gặp lại ở đề tiếp theo.",
                "The active in-progress attempt will be marked discarded. All its questions will return to the remaining unassigned pool without ever being marked completed.",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel autoFocus>
              {lText(locale, "Giữ lại & tiếp tục", "Keep & Resume")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void handleConfirmDiscard()}
            >
              {lText(locale, "Xác nhận hủy đề", "Discard Active Exam")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Restart Cycle Confirmation */}
      <AlertDialog
        open={Boolean(restartTarget)}
        onOpenChange={(open) => {
          if (!open) setRestartTarget(null);
        }}
      >
        <AlertDialogContent className="overscroll-contain">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {lText(locale, "Khởi động chu kỳ phủ mới?", "Restart Coverage Cycle?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {lText(
                locale,
                "Toàn bộ ngân hàng câu hỏi sẽ được xáo trộn lại cho chu kỳ tiếp theo. Mọi kết quả bài thi bạn đã nộp vẫn được giữ nguyên trong Lịch sử.",
                "The entire question pool will be reshuffled for the next cycle. All past submitted attempts stay preserved in your History.",
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel autoFocus>
              {lText(locale, "Hủy", "Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleConfirmRestart()}>
              {lText(locale, "Bắt đầu chu kỳ mới", "Start Fresh Cycle")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Cycle Confirmation */}
      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent className="overscroll-contain">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {lText(locale, "Xóa chu kỳ phủ 100%?", "Delete Full Coverage Cycle?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {lText(
                locale,
                `Xóa chu kỳ "${deleteTarget?.title ?? ""}"? Các bài thi đã nộp vẫn được giữ trong Lịch sử thi.`,
                `Delete cycle "${deleteTarget?.title ?? ""}"? Submitted exam attempts remain intact in Exam History.`,
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel autoFocus>
              {lText(locale, "Hủy", "Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => void handleConfirmDelete()}
            >
              {lText(locale, "Xóa chu kỳ", "Delete Cycle")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
