"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  CheckCircle2,
  Clock,
  Flag,
  HelpCircle,
  Layers,
  Loader2,
  Play,
  RotateCcw,
  Search,
  Shuffle,
  Target,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FocusModeShell } from "@/components/learning/FocusModeShell";
import { lText } from "@/components/learning/learning-copy";
import {
  StudyErrorState,
  StudyLoadingSkeleton,
} from "@/components/learning/useStudySetBundle";
import { useI18n } from "@/lib/i18n";
import {
  createExamAttempt,
  fetchExamAttempt,
  isSafeDisplayImageUrl,
  issueCoverageNextExam,
  type ExamAttemptPayload,
} from "@/lib/learning/api-client";
import { scoreExamAttempt } from "@/lib/learning/exam-scoring";
import { indexToOptionLabel } from "@/lib/learning/shuffle";
import type {
  ExamChapterBreakdown,
  ExamSourceInput,
  ExamSubjectBreakdown,
  ExamTagBreakdown,
} from "@/types/domain";
import { cn, formatDuration } from "@/lib/utils";

type ReviewFilter = "all" | "incorrect" | "unanswered" | "flagged" | "correct";

interface ExamResultsClientProps {
  setId?: string | null;
  attemptId: string;
}

export function ExamResultsClient({
  setId,
  attemptId,
}: ExamResultsClientProps) {
  const router = useRouter();
  const { locale, t } = useI18n();

  const [reviewFilter, setReviewFilter] = React.useState<ReviewFilter>("all");
  const [subjectFilter, setSubjectFilter] = React.useState<string>("all");
  const [reviewSearch, setReviewSearch] = React.useState<string>("");
  const [breakdownTab, setBreakdownTab] = React.useState<
    "subject" | "chapter" | "tag"
  >("subject");
  const [isRetaking, setIsRetaking] = React.useState(false);
  const [isContinuingCoverage, setIsContinuingCoverage] = React.useState(false);

  const reviewScrollRef = React.useRef<HTMLDivElement | null>(null);

  const resultQuery = useQuery<ExamAttemptPayload>({
    queryKey: ["exam-result", attemptId],
    queryFn: () => fetchExamAttempt(attemptId),
    staleTime: 60_000,
  });

  const payload = resultQuery.data;
  const attempt = payload?.attempt;
  const questions = React.useMemo(
    () =>
      [...(payload?.questions ?? [])].sort((a, b) => a.position - b.position),
    [payload?.questions],
  );
  const answers = React.useMemo(
    () => payload?.answers ?? [],
    [payload?.answers],
  );

  const backHref = setId ? `/sets/${setId}` : "/exams";
  const resumeHref = setId
    ? `/sets/${setId}/test?attemptId=${attemptId}`
    : `/exams/${attemptId}`;

  const answerMap = React.useMemo(() => {
    const map = new Map<string, (typeof answers)[number]>();
    for (const a of answers) {
      map.set(a.attempt_question_id, a);
    }
    return map;
  }, [answers]);

  // Deterministic fallback summary (respecting server `answer.is_correct` whenever present!)
  const computedSummary = React.useMemo(() => {
    if (!attempt) return null;
    return scoreExamAttempt(
      questions,
      answers,
      attempt.pass_threshold,
      lText(locale, "Chưa phân chương", "Uncategorized"),
      attempt.study_set_title_snapshot || lText(locale, "Học phần", "Subject"),
    );
  }, [answers, attempt, locale, questions]);

  // Prefer server-computed breakdowns when available, otherwise use deterministic client breakdowns
  const subjectBreakdown = React.useMemo<ExamSubjectBreakdown[]>(() => {
    if (payload?.subject_breakdown && payload.subject_breakdown.length > 0) {
      return payload.subject_breakdown;
    }
    return (computedSummary?.subjectBreakdown ?? []).map((b) => ({
      study_set_id: b.studySetId,
      subject_title: b.subjectTitle,
      total: b.total,
      correct: b.correct,
      wrong: b.wrong,
      unanswered: b.unanswered,
      accuracy_percent: b.accuracyPercent,
    }));
  }, [computedSummary?.subjectBreakdown, payload?.subject_breakdown]);

  const chapterBreakdown = React.useMemo<ExamChapterBreakdown[]>(() => {
    if (payload?.chapter_breakdown && payload.chapter_breakdown.length > 0) {
      return payload.chapter_breakdown;
    }
    return (computedSummary?.chapterBreakdown ?? []).map((b) => ({
      study_set_id: b.studySetId ?? null,
      subject_title: b.subjectTitle ?? null,
      chapter: b.chapter,
      total: b.total,
      correct: b.correct,
      wrong: b.wrong,
      unanswered: b.unanswered,
      accuracy_percent: b.accuracyPercent,
    }));
  }, [computedSummary?.chapterBreakdown, payload?.chapter_breakdown]);

  const tagBreakdown = React.useMemo<ExamTagBreakdown[]>(() => {
    if (payload?.tag_breakdown && payload.tag_breakdown.length > 0) {
      return payload.tag_breakdown;
    }
    return (computedSummary?.tagBreakdown ?? []).map((b) => ({
      tag_id: b.tagId,
      tag_name: b.tagName,
      total: b.total,
      correct: b.correct,
      wrong: b.wrong,
      unanswered: b.unanswered,
      accuracy_percent: b.accuracyPercent,
    }));
  }, [computedSummary?.tagBreakdown, payload?.tag_breakdown]);

  // Weakest subject with a real study_set_id for 1-click Practice Weakest Subject CTA
  const weakestSubject = React.useMemo(() => {
    const withId = subjectBreakdown.filter((s) => Boolean(s.study_set_id) && s.total > 0);
    if (withId.length === 0) return null;
    return [...withId].sort(
      (a, b) => a.accuracy_percent - b.accuracy_percent || b.wrong - a.wrong,
    )[0];
  }, [subjectBreakdown]);

  // Collect all source study_set_ids from attempt + sources + questions (fixes SH-023 multi-set drop!)
  const allSourceSetIds = React.useMemo(() => {
    const ids = new Set<string>();
    for (const s of payload?.sources ?? []) {
      if (s.study_set_id) ids.add(s.study_set_id);
    }
    for (const q of questions) {
      if (q.source_study_set_id) ids.add(q.source_study_set_id);
    }
    if (attempt?.study_set_id) ids.add(attempt.study_set_id);
    if (setId) ids.add(setId);
    for (const extra of attempt?.config?.additional_study_set_ids ?? []) {
      ids.add(extra);
    }
    return Array.from(ids);
  }, [attempt, payload?.sources, questions, setId]);

  const perQuestionStatusMap = React.useMemo(() => {
    const map = new Map<string, { isCorrect: boolean; isUnanswered: boolean }>();
    for (const r of computedSummary?.perQuestionResults ?? []) {
      map.set(r.attemptQuestionId, {
        isCorrect: r.isCorrect,
        isUnanswered: r.isUnanswered,
      });
    }
    return map;
  }, [computedSummary]);

  const filteredQuestions = React.useMemo(() => {
    const searchLower = reviewSearch.trim().toLowerCase();
    return questions.filter((q) => {
      const ans = answerMap.get(q.id);
      const status = perQuestionStatusMap.get(q.id);
      const isUnanswered = status?.isUnanswered ?? true;
      const isCorrect =
        !isUnanswered && typeof ans?.is_correct === "boolean"
          ? ans.is_correct
          : status?.isCorrect ?? false;
      const isFlagged = Boolean(ans?.is_flagged);

      if (subjectFilter !== "all") {
        const subKey = q.source_study_set_id ?? q.source_subject_title ?? "";
        if (subKey !== subjectFilter) return false;
      }

      if (searchLower) {
        const hay =
          `${q.prompt_snapshot} ${q.chapter_snapshot ?? ""} ${q.source_subject_title ?? ""}`.toLowerCase();
        if (!hay.includes(searchLower)) return false;
      }

      switch (reviewFilter) {
        case "incorrect":
          return !isUnanswered && !isCorrect;
        case "unanswered":
          return isUnanswered;
        case "flagged":
          return isFlagged;
        case "correct":
          return !isUnanswered && isCorrect;
        case "all":
        default:
          return true;
      }
    });
  }, [
    answerMap,
    perQuestionStatusMap,
    questions,
    reviewFilter,
    reviewSearch,
    subjectFilter,
  ]);

  // Virtualized 500–1,000Q question review list (zero DOM explosion!)
  // eslint-disable-next-line react-hooks/incompatible-library
  const reviewVirtualizer = useVirtualizer({
    count: filteredQuestions.length,
    getScrollElement: () => reviewScrollRef.current,
    estimateSize: () => 290,
    overscan: 4,
  });

  // Retake Exact Exam preserving ALL multi-subject sources & question IDs (fixes SH-023!)
  const handleRetakeSameExam = React.useCallback(async () => {
    if (!attempt) return;
    const sourceQuestionIds = questions
      .map((q) => q.question_id)
      .filter((id): id is string => Boolean(id));

    if (sourceQuestionIds.length === 0) {
      router.push(`/exams/new?cloneAttemptId=${attempt.id}`);
      return;
    }

    const sources: ExamSourceInput[] = allSourceSetIds.map((id) => ({
      source_type: "study_set",
      id,
    }));

    setIsRetaking(true);
    try {
      const created = await createExamAttempt({
        study_set_id: attempt.study_set_id ?? allSourceSetIds[0] ?? null,
        additional_study_set_ids:
          allSourceSetIds.length > 1 ? allSourceSetIds.slice(1) : undefined,
        sources: sources.length > 0 ? sources : undefined,
        title: attempt.study_set_title_snapshot,
        question_count: sourceQuestionIds.length,
        duration_limit_seconds: attempt.duration_limit_seconds,
        shuffle_questions: false,
        shuffle_options: attempt.config?.shuffle_options ?? true,
        show_subject_names: attempt.show_subject_names ?? true,
        show_chapter_names: attempt.show_chapter_names ?? true,
        allow_navigation: attempt.allow_navigation ?? true,
        pass_threshold: attempt.pass_threshold,
        question_ids: sourceQuestionIds,
      });
      router.push(`/exams/${created.attempt.id}`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("common.errorGeneric"),
      );
      setIsRetaking(false);
    }
  }, [allSourceSetIds, attempt, questions, router, t]);

  // Create Test from Incorrect Questions via clean POST (NEVER 3,700-char `?questionIds=` URL!)
  const handleCreateExamFromMistakes = React.useCallback(async () => {
    if (!attempt) return;
    const wrongSourceIds = questions
      .filter((q) => {
        const ans = answerMap.get(q.id);
        const st = perQuestionStatusMap.get(q.id);
        const isUnanswered = st?.isUnanswered ?? true;
        const isCorrect =
          !isUnanswered && typeof ans?.is_correct === "boolean"
            ? ans.is_correct
            : st?.isCorrect ?? false;
        return !isCorrect && Boolean(q.question_id);
      })
      .map((q) => q.question_id!);

    if (wrongSourceIds.length === 0) return;

    const sources: ExamSourceInput[] = allSourceSetIds.map((id) => ({
      source_type: "study_set",
      id,
    }));

    setIsRetaking(true);
    try {
      const created = await createExamAttempt({
        study_set_id: attempt.study_set_id ?? allSourceSetIds[0] ?? null,
        additional_study_set_ids:
          allSourceSetIds.length > 1 ? allSourceSetIds.slice(1) : undefined,
        sources: sources.length > 0 ? sources : undefined,
        title: lText(
          locale,
          `Thi lại câu sai (${wrongSourceIds.length} câu) — ${attempt.study_set_title_snapshot}`,
          `Mistakes Retest (${wrongSourceIds.length}Q) — ${attempt.study_set_title_snapshot}`,
        ),
        question_count: wrongSourceIds.length,
        duration_limit_seconds: null,
        shuffle_questions: true,
        shuffle_options: true,
        show_subject_names: true,
        show_chapter_names: true,
        allow_navigation: true,
        pass_threshold: attempt.pass_threshold,
        question_ids: wrongSourceIds,
      });
      router.push(`/exams/${created.attempt.id}`);
    } catch {
      setIsRetaking(false);
      // Fallback cleanly to Builder seeded by attemptId (short URL!)
      router.push(`/exams/new?sourceAttemptId=${attempt.id}&mode=mistakes`);
    }
  }, [allSourceSetIds, answerMap, attempt, locale, perQuestionStatusMap, questions, router]);

  const handleContinueCoverage = React.useCallback(async () => {
    const cycleId = attempt?.coverage_cycle_id;
    if (!cycleId) return;
    setIsContinuingCoverage(true);
    try {
      const nextExam = await issueCoverageNextExam(cycleId);
      router.push(`/exams/${nextExam.attempt.id}`);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : lText(
              locale,
              "Mở bảng điều khiển Chu kỳ Phủ để xem chi tiết.",
              "Opening Coverage Cycles dashboard for details.",
            ),
      );
      router.push("/exams/new?tab=coverage");
      setIsContinuingCoverage(false);
    }
  }, [attempt?.coverage_cycle_id, locale, router]);

  if (resultQuery.isLoading) {
    return (
      <FocusModeShell backHref={backHref} title={t("exam.reviewAnswers")}>
        <StudyLoadingSkeleton />
      </FocusModeShell>
    );
  }

  if (resultQuery.isError || !attempt || !computedSummary) {
    return (
      <FocusModeShell backHref={backHref} title={t("exam.reviewAnswers")}>
        <StudyErrorState
          message={
            resultQuery.error instanceof Error
              ? resultQuery.error.message
              : undefined
          }
          onRetry={() => void resultQuery.refetch()}
          backHref={backHref}
        />
      </FocusModeShell>
    );
  }

  if (attempt.status === "in_progress") {
    return (
      <FocusModeShell
        backHref={backHref}
        title={attempt.study_set_title_snapshot}
      >
        <Card className="mx-auto my-12 max-w-lg">
          <CardContent className="space-y-4 py-8 text-center">
            <h2 className="text-lg font-semibold">
              {lText(
                locale,
                "Bài thi này vẫn đang trong quá trình làm",
                "This exam attempt is still in progress",
              )}
            </h2>
            <Button asChild className="min-h-11">
              <Link href={resumeHref}>
                {lText(locale, "Quay lại phòng thi", "Return to Live Exam")}
              </Link>
            </Button>
          </CardContent>
        </Card>
      </FocusModeShell>
    );
  }

  const wrongAndMissedCount = attempt.wrong_count + attempt.unanswered_count;
  const avgSecPerQ =
    attempt.total_questions > 0
      ? Math.round(attempt.time_spent_seconds / attempt.total_questions)
      : 0;
  const flaggedCount = answers.filter((a) => a.is_flagged).length;

  return (
    <FocusModeShell
      backHref={backHref}
      backLabel={setId ? lText(locale, "Về học phần", "Back to Set") : lText(locale, "Trung tâm thi", "Exam Hub")}
      title={attempt.study_set_title_snapshot}
      subtitle={lText(locale, "Kết quả bài thi", "Exam Results")}
    >
      <div className="mx-auto w-full max-w-5xl space-y-6">
        {/* Hero Score Summary (True Weighted Overall Accuracy) */}
        <Card>
          <CardContent className="space-y-6 py-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  {attempt.passed ? (
                    <Badge variant="success" className="px-3 py-1 text-sm">
                      <CheckCircle2 className="size-4" aria-hidden="true" />
                      {t("exam.passed")} (≥ {attempt.pass_threshold}%)
                    </Badge>
                  ) : (
                    <Badge variant="destructive" className="px-3 py-1 text-sm">
                      <XCircle className="size-4" aria-hidden="true" />
                      {t("exam.failed")} ({lText(locale, "Yêu cầu", "Required")} ≥{" "}
                      {attempt.pass_threshold}%)
                    </Badge>
                  )}
                  {attempt.status === "expired" ? (
                    <Badge variant="warning">
                      <Clock className="size-3" aria-hidden="true" />
                      {lText(
                        locale,
                        "Tự động nộp khi hết giờ",
                        "Auto-submitted on timeout",
                      )}
                    </Badge>
                  ) : null}
                  {subjectBreakdown.length > 1 ? (
                    <Badge variant="accent">
                      {subjectBreakdown.length}{" "}
                      {lText(locale, "môn học", "subjects")}
                    </Badge>
                  ) : null}
                </div>

                <h2 className="text-3xl font-bold tracking-tight tabular-nums">
                  {Number(attempt.score_percent).toFixed(2)}%{" "}
                  <span className="text-base font-normal text-muted-foreground">
                    ({attempt.correct_count} / {attempt.total_questions}{" "}
                    {lText(locale, "câu đúng", "correct")})
                  </span>
                </h2>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {lText(locale, "Thời gian làm bài:", "Time spent:")}{" "}
                  {formatDuration(attempt.time_spent_seconds)} · ~{avgSecPerQ}
                  {lText(locale, " giây/câu", "s/question")}
                </p>
              </div>

              {/* Action Buttons (ZERO 3,700-char `?questionIds=` URLs!) */}
              <div className="flex flex-wrap gap-2">
                {attempt.coverage_cycle_id ? (
                  <Button
                    type="button"
                    className="min-h-10"
                    disabled={isContinuingCoverage}
                    onClick={() => void handleContinueCoverage()}
                  >
                    {isContinuingCoverage ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Layers className="size-4" aria-hidden="true" />
                    )}
                    {lText(
                      locale,
                      "Tiếp tục Chu kỳ Phủ 100%",
                      "Continue Full Coverage",
                    )}
                  </Button>
                ) : null}

                {wrongAndMissedCount > 0 ? (
                  <Button
                    type="button"
                    variant={attempt.coverage_cycle_id ? "outline" : "default"}
                    className="min-h-10"
                    disabled={isRetaking}
                    onClick={() => void handleCreateExamFromMistakes()}
                  >
                    <Play className="size-4" aria-hidden="true" />
                    {lText(
                      locale,
                      `Tạo đề từ ${wrongAndMissedCount} câu sai`,
                      `Create Test from ${wrongAndMissedCount} Missed`,
                    )}
                  </Button>
                ) : null}

                {weakestSubject?.study_set_id ? (
                  <Button variant="secondary" className="min-h-10" asChild>
                    <Link
                      href={`/practice?setId=${weakestSubject.study_set_id}`}
                    >
                      <Target className="size-4" aria-hidden="true" />
                      {lText(locale, "Luyện môn yếu nhất", "Practice Weakest Subject")}
                    </Link>
                  </Button>
                ) : null}

                <Button
                  type="button"
                  variant="outline"
                  className="min-h-10"
                  disabled={isRetaking}
                  onClick={() => void handleRetakeSameExam()}
                >
                  {isRetaking ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <RotateCcw className="size-4" aria-hidden="true" />
                  )}
                  {lText(locale, "Làm lại chính xác đề này", "Retake Exact Exam")}
                </Button>

                <Button variant="outline" className="min-h-10" asChild>
                  <Link href={`/exams/new?cloneAttemptId=${attempt.id}`}>
                    <Shuffle className="size-4" aria-hidden="true" />
                    {lText(locale, "Tạo đề ngẫu nhiên mới", "Generate New Random Exam")}
                  </Link>
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-lg border border-border bg-success-subtle/60 p-3.5">
                <div className="flex items-center gap-1.5 text-xs font-medium text-success-subtle-foreground">
                  <CheckCircle2 className="size-4" aria-hidden="true" />
                  {t("study.correct")}
                </div>
                <p className="mt-1 text-2xl font-bold tabular-nums">
                  {attempt.correct_count}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-destructive-subtle/60 p-3.5">
                <div className="flex items-center gap-1.5 text-xs font-medium text-destructive-subtle-foreground">
                  <XCircle className="size-4" aria-hidden="true" />
                  {t("study.incorrect")}
                </div>
                <p className="mt-1 text-2xl font-bold tabular-nums">
                  {attempt.wrong_count}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-secondary/60 p-3.5">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <HelpCircle className="size-4" aria-hidden="true" />
                  {t("exam.unanswered")}
                </div>
                <p className="mt-1 text-2xl font-bold tabular-nums">
                  {attempt.unanswered_count}
                </p>
              </div>
              <div className="rounded-lg border border-border bg-card p-3.5">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Clock className="size-4" aria-hidden="true" />
                  {t("study.timeSpent")}
                </div>
                <p className="mt-1 font-mono text-2xl font-bold tabular-nums">
                  {formatDuration(attempt.time_spent_seconds)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Per-Subject, Per-Chapter & Per-Tag Accuracy Breakdowns */}
        <Card>
          <Tabs
            value={breakdownTab}
            onValueChange={(v) =>
              setBreakdownTab(v as "subject" | "chapter" | "tag")
            }
          >
            <CardHeader className="pb-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle className="text-base">
                  {lText(
                    locale,
                    "Phân tích độ chính xác chi tiết",
                    "Detailed Accuracy Breakdown",
                  )}
                </CardTitle>

                <div className="overflow-x-auto">
                  <TabsList className="inline-flex w-max flex-nowrap">
                    <TabsTrigger value="subject">
                      {lText(locale, "Theo môn học", "By Subject")} (
                      {subjectBreakdown.length})
                    </TabsTrigger>
                    <TabsTrigger value="chapter">
                      {lText(locale, "Theo chương", "By Chapter")} (
                      {chapterBreakdown.length})
                    </TabsTrigger>
                    {tagBreakdown.length > 0 ? (
                      <TabsTrigger value="tag">
                        {lText(locale, "Theo thẻ", "By Tag")} (
                        {tagBreakdown.length})
                      </TabsTrigger>
                    ) : null}
                  </TabsList>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <TabsContent value="subject" className="mt-0">
                <div
                  tabIndex={0}
                  role="region"
                  aria-label={lText(
                    locale,
                    "Bảng độ chính xác theo môn học",
                    "Per-subject accuracy breakdown",
                  )}
                  className="overflow-x-auto"
                >
                  <Table>
                    <caption className="sr-only">
                      {lText(
                        locale,
                        "Độ chính xác theo từng môn học và tổng điểm trọng số",
                        "Accuracy breakdown by subject with weighted overall score",
                      )}
                    </caption>
                    <TableHeader>
                      <TableRow>
                        <TableHead scope="col">
                          {lText(locale, "Môn học", "Subject")}
                        </TableHead>
                        <TableHead scope="col" className="text-right">
                          {lText(locale, "Đúng / Tổng", "Correct / Total")}
                        </TableHead>
                        <TableHead scope="col" className="text-right">
                          {t("study.incorrect")}
                        </TableHead>
                        <TableHead scope="col" className="w-44 text-right">
                          {t("study.accuracy")}
                        </TableHead>
                        <TableHead scope="col" className="text-right">
                          {lText(locale, "Hành động", "Action")}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {subjectBreakdown.map((row) => (
                        <TableRow
                          key={row.study_set_id ?? row.subject_title}
                        >
                          <TableCell className="font-medium">
                            {row.subject_title}
                          </TableCell>
                          <TableCell className="text-right tabular-nums font-semibold">
                            {row.correct} / {row.total}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-destructive-subtle-foreground">
                            {row.wrong}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Progress
                                value={row.accuracy_percent}
                                className="h-2 w-20"
                                aria-label={`${row.subject_title}: ${row.accuracy_percent}%`}
                              />
                              <span className="w-14 text-xs font-semibold tabular-nums">
                                {row.accuracy_percent.toFixed(2)}%
                              </span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            {row.study_set_id ? (
                              <Button variant="ghost" size="sm" asChild>
                                <Link href={`/practice?setId=${row.study_set_id}`}>
                                  {lText(locale, "Luyện môn này", "Practice")}
                                </Link>
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>

              <TabsContent value="chapter" className="mt-0">
                <div
                  tabIndex={0}
                  role="region"
                  aria-label={lText(
                    locale,
                    "Bảng độ chính xác theo chương",
                    "Per-chapter accuracy breakdown",
                  )}
                  className="overflow-x-auto"
                >
                  <Table>
                    <caption className="sr-only">
                      {lText(
                        locale,
                        "Bảng độ chính xác theo chương",
                        "Chapter accuracy table",
                      )}
                    </caption>
                    <TableHeader>
                      <TableRow>
                        <TableHead scope="col">
                          {lText(locale, "Chương", "Chapter")}
                        </TableHead>
                        <TableHead scope="col" className="text-right">
                          {t("study.correct")}
                        </TableHead>
                        <TableHead scope="col" className="text-right">
                          {t("study.incorrect")}
                        </TableHead>
                        <TableHead scope="col" className="text-right">
                          {t("exam.unanswered")}
                        </TableHead>
                        <TableHead scope="col" className="w-40 text-right">
                          {t("study.accuracy")}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {chapterBreakdown.map((row) => (
                        <TableRow key={`${row.study_set_id ?? ""}-${row.chapter}`}>
                          <TableCell className="font-medium">
                            {row.chapter}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-success-subtle-foreground">
                            {row.correct}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-destructive-subtle-foreground">
                            {row.wrong}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {row.unanswered}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Progress
                                value={row.accuracy_percent}
                                className="h-2 w-20"
                                aria-label={`${row.chapter}: ${row.accuracy_percent}%`}
                              />
                              <span className="w-12 text-xs font-semibold tabular-nums">
                                {Math.round(row.accuracy_percent)}%
                              </span>
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </TabsContent>

              {tagBreakdown.length > 0 ? (
                <TabsContent value="tag" className="mt-0">
                  <div
                    tabIndex={0}
                    role="region"
                    aria-label={lText(
                      locale,
                      "Bảng độ chính xác theo thẻ",
                      "Per-tag accuracy breakdown",
                    )}
                    className="overflow-x-auto"
                  >
                    <Table>
                      <caption className="sr-only">
                        {lText(locale, "Bảng độ chính xác theo thẻ", "Tag accuracy table")}
                      </caption>
                      <TableHeader>
                        <TableRow>
                          <TableHead scope="col">{lText(locale, "Thẻ", "Tag")}</TableHead>
                          <TableHead scope="col" className="text-right">
                            {lText(locale, "Đúng / Tổng", "Correct / Total")}
                          </TableHead>
                          <TableHead scope="col" className="w-44 text-right">
                            {t("study.accuracy")}
                          </TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {tagBreakdown.map((row) => (
                          <TableRow key={row.tag_id}>
                            <TableCell className="font-medium">
                              #{row.tag_name}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {row.correct} / {row.total}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-2">
                                <Progress
                                  value={row.accuracy_percent}
                                  className="h-2 w-20"
                                  aria-label={`#${row.tag_name}: ${row.accuracy_percent.toFixed(1)}%`}
                                />
                                <span className="w-14 text-xs font-semibold tabular-nums">
                                  {row.accuracy_percent.toFixed(1)}%
                                </span>
                              </div>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </TabsContent>
              ) : null}
            </CardContent>
          </Tabs>
        </Card>

        {/* Virtualized 500–1,000Q Question-by-Question Review */}
        {attempt.show_review_after_submit === false ? (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              {lText(
                locale,
                "Cấu hình bài thi này đã tắt phần xem lại chi tiết đáp án sau khi nộp.",
                "Detailed answer review after submission was disabled in this exam's settings.",
              )}
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-lg font-semibold">
                  {t("exam.reviewAnswers")} ({filteredQuestions.length})
                </h2>

                {/* Single-row horizontal scroll TabsList (per modern-web-guidance tabs guide!) */}
                <Tabs
                  value={reviewFilter}
                  onValueChange={(v) => setReviewFilter(v as ReviewFilter)}
                  className="max-w-full"
                >
                  <div className="overflow-x-auto pb-1">
                    <TabsList className="inline-flex w-max flex-nowrap">
                      <TabsTrigger value="all" className="shrink-0">
                        {t("common.all")} ({questions.length})
                      </TabsTrigger>
                      <TabsTrigger value="incorrect" className="shrink-0">
                        {lText(locale, "Câu sai", "Incorrect")} ({attempt.wrong_count})
                      </TabsTrigger>
                      <TabsTrigger value="unanswered" className="shrink-0">
                        {t("exam.unanswered")} ({attempt.unanswered_count})
                      </TabsTrigger>
                      <TabsTrigger value="flagged" className="shrink-0">
                        {lText(locale, "Đánh dấu", "Marked")} ({flaggedCount})
                      </TabsTrigger>
                      <TabsTrigger value="correct" className="shrink-0">
                        {t("study.correct")} ({attempt.correct_count})
                      </TabsTrigger>
                    </TabsList>
                  </div>
                  <TabsContent value={reviewFilter} className="hidden" />
                </Tabs>
              </div>

              {/* Subject Filter + Keyword Search for 500Q review */}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <search className="relative flex-1">
                  <Search
                    className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <Input
                    value={reviewSearch}
                    onChange={(e) => setReviewSearch(e.target.value)}
                    placeholder={lText(
                      locale,
                      "Tìm nhanh trong danh sách câu hỏi đã thi...",
                      "Search reviewed questions...",
                    )}
                    aria-label={lText(
                      locale,
                      "Tìm kiếm câu hỏi đã thi",
                      "Search reviewed questions",
                    )}
                    className="pl-9 min-h-10"
                  />
                </search>

                {subjectBreakdown.length > 1 ? (
                  <Select value={subjectFilter} onValueChange={setSubjectFilter}>
                    <SelectTrigger
                      className="min-h-10 sm:w-64"
                      aria-label={lText(locale, "Lọc theo môn học", "Filter by subject")}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">
                        {lText(locale, "Tất cả môn học", "All subjects")}
                      </SelectItem>
                      {subjectBreakdown.map((sub) => (
                        <SelectItem
                          key={sub.study_set_id ?? sub.subject_title}
                          value={sub.study_set_id ?? sub.subject_title}
                        >
                          {sub.subject_title} ({sub.total})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : null}
              </div>
            </div>

            {filteredQuestions.length === 0 ? (
              <Card>
                <CardContent className="py-8 text-center text-sm text-muted-foreground">
                  {lText(
                    locale,
                    "Không có câu hỏi nào trong nhóm lọc này.",
                    "No questions in this filter category.",
                  )}
                </CardContent>
              </Card>
            ) : (
              /* Virtualized Scroll Container — handles 500–1,000Q smoothly! */
              <div
                ref={reviewScrollRef}
                role="region"
                className="max-h-[75dvh] overflow-y-auto pr-1"
                tabIndex={0}
                aria-label={lText(locale, "Danh sách chi tiết đáp án", "Question review list")}
              >
                <div
                  style={{
                    height: `${reviewVirtualizer.getTotalSize()}px`,
                    position: "relative",
                    width: "100%",
                  }}
                >
                  {reviewVirtualizer.getVirtualItems().map((vItem) => {
                    const q = filteredQuestions[vItem.index];
                    if (!q) return null;

                    const ans = answerMap.get(q.id);
                    const status = perQuestionStatusMap.get(q.id);
                    const isUnanswered = status?.isUnanswered ?? true;
                    const isCorrect =
                      !isUnanswered && typeof ans?.is_correct === "boolean"
                        ? ans.is_correct
                        : status?.isCorrect ?? false;
                    const correctSet = new Set(q.correct_option_ids ?? []);
                    const selectedSet = new Set(ans?.selected_option_ids ?? []);

                    return (
                      <div
                        key={q.id}
                        data-index={vItem.index}
                        ref={reviewVirtualizer.measureElement}
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          transform: `translateY(${vItem.start}px)`,
                        }}
                        className="pb-4"
                      >
                        <Card>
                          <CardContent className="space-y-4 py-5">
                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="outline" className="tabular-nums">
                                {lText(locale, "Câu", "Question")} {q.position + 1}
                              </Badge>
                              {isUnanswered ? (
                                <Badge variant="secondary">
                                  <HelpCircle className="size-3" aria-hidden="true" />
                                  {t("exam.unanswered")}
                                </Badge>
                              ) : isCorrect ? (
                                <Badge variant="success">
                                  <CheckCircle2 className="size-3" aria-hidden="true" />
                                  {t("study.correct")}
                                </Badge>
                              ) : (
                                <Badge variant="destructive">
                                  <XCircle className="size-3" aria-hidden="true" />
                                  {t("study.incorrect")}
                                </Badge>
                              )}
                              {ans?.is_flagged ? (
                                <Badge variant="warning">
                                  <Flag className="size-3" aria-hidden="true" />
                                  {t("exam.flagged")}
                                </Badge>
                              ) : null}
                              {q.source_subject_title ? (
                                <Badge variant="accent">
                                  {q.source_subject_title}
                                </Badge>
                              ) : null}
                              {q.chapter_snapshot ? (
                                <Badge variant="secondary">
                                  {q.chapter_snapshot}
                                </Badge>
                              ) : null}
                            </div>

                            <p className="whitespace-pre-wrap text-base font-medium leading-relaxed">
                              {q.prompt_snapshot}
                            </p>

                            {isSafeDisplayImageUrl(q.prompt_image_url_snapshot) ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={q.prompt_image_url_snapshot}
                                alt={lText(
                                  locale,
                                  "Hình ảnh câu hỏi",
                                  "Question illustration",
                                )}
                                className="max-h-56 rounded-lg border border-border object-contain"
                              />
                            ) : null}

                            {q.question_type === "short_answer" ||
                            q.options_snapshot.length === 0 ? (
                              <div className="grid gap-2 text-sm sm:grid-cols-2">
                                <div className="rounded-lg border border-border bg-secondary/40 p-3">
                                  <p className="text-xs font-semibold text-muted-foreground">
                                    {t("study.yourAnswer")}
                                  </p>
                                  <p className="mt-1 whitespace-pre-wrap">
                                    {ans?.typed_answer || "—"}
                                  </p>
                                </div>
                                <div className="rounded-lg border border-success/40 bg-success-subtle/60 p-3">
                                  <p className="text-xs font-semibold text-success-subtle-foreground">
                                    {t("study.correctAnswer")}
                                  </p>
                                  <p className="mt-1 whitespace-pre-wrap text-foreground">
                                    {(q.accepted_answers_snapshot ?? [])
                                      .map((a) => a.answer_text)
                                      .join(" / ") || "—"}
                                  </p>
                                </div>
                              </div>
                            ) : (
                              <div className="space-y-2">
                                {q.options_snapshot.map((opt, idx) => {
                                  const isOptCorrect = correctSet.has(opt.id);
                                  const isOptSelected = selectedSet.has(opt.id);
                                  let rowStyle = "border-border bg-card";
                                  if (isOptCorrect) {
                                    rowStyle =
                                      "border-success bg-success-subtle text-success-subtle-foreground";
                                  } else if (isOptSelected && !isOptCorrect) {
                                    rowStyle =
                                      "border-destructive bg-destructive-subtle text-destructive-subtle-foreground";
                                  }

                                  return (
                                    <div
                                      key={opt.id}
                                      className={cn(
                                        "flex items-start gap-3 rounded-lg border px-3.5 py-2.5 text-sm",
                                        rowStyle,
                                      )}
                                    >
                                      <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded border border-current/25 text-xs font-semibold">
                                        {indexToOptionLabel(idx)}
                                      </span>
                                      <span className="flex-1 whitespace-pre-wrap leading-relaxed">
                                        {opt.content}
                                      </span>
                                      {isOptCorrect ? (
                                        <Badge variant="success" className="shrink-0">
                                          <CheckCircle2
                                            className="size-3"
                                            aria-hidden="true"
                                          />
                                          {t("study.correctAnswer")}
                                        </Badge>
                                      ) : isOptSelected ? (
                                        <Badge
                                          variant="destructive"
                                          className="shrink-0"
                                        >
                                          <XCircle
                                            className="size-3"
                                            aria-hidden="true"
                                          />
                                          {t("study.yourAnswer")}
                                        </Badge>
                                      ) : null}
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            {q.explanation_snapshot ? (
                              <div className="rounded-lg bg-secondary/60 p-3.5 text-sm text-muted-foreground whitespace-pre-wrap">
                                <strong className="text-foreground">
                                  {t("study.explanation")}:{" "}
                                </strong>
                                {q.explanation_snapshot}
                              </div>
                            ) : null}
                          </CardContent>
                        </Card>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </FocusModeShell>
  );
}
