"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  Clock,
  Flag,
  HelpCircle,
  Loader2,
  Play,
  RotateCcw,
  Shuffle,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  type ExamAttemptPayload,
} from "@/lib/learning/api-client";
import { scoreExamAttempt } from "@/lib/learning/exam-scoring";
import { indexToOptionLabel } from "@/lib/learning/shuffle";
import { cn, formatDuration } from "@/lib/utils";

type ReviewFilter = "all" | "incorrect" | "unanswered" | "flagged" | "correct";

interface ExamResultsClientProps {
  setId: string;
  attemptId: string;
}

export function ExamResultsClient({
  setId,
  attemptId,
}: ExamResultsClientProps) {
  const router = useRouter();
  const { locale, t } = useI18n();

  const [reviewFilter, setReviewFilter] = React.useState<ReviewFilter>("all");
  const [isRetaking, setIsRetaking] = React.useState(false);

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

  const answerMap = React.useMemo(() => {
    const map = new Map<string, (typeof answers)[number]>();
    for (const a of answers) {
      map.set(a.attempt_question_id, a);
    }
    return map;
  }, [answers]);

  const computedSummary = React.useMemo(() => {
    if (!attempt) return null;
    return scoreExamAttempt(
      questions,
      answers,
      attempt.pass_threshold,
      lText(locale, "Chưa phân chương", "Uncategorized"),
    );
  }, [answers, attempt, locale, questions]);

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
    return questions.filter((q) => {
      const ans = answerMap.get(q.id);
      const status = perQuestionStatusMap.get(q.id);
      const isUnanswered = status?.isUnanswered ?? true;
      const isCorrect =
        typeof ans?.is_correct === "boolean"
          ? ans.is_correct
          : status?.isCorrect ?? false;
      const isFlagged = Boolean(ans?.is_flagged);

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
  }, [answerMap, perQuestionStatusMap, questions, reviewFilter]);

  const handleRetakeSameExam = React.useCallback(async () => {
    if (!attempt) return;
    const sourceQuestionIds = questions
      .map((q) => q.question_id)
      .filter((id): id is string => Boolean(id));

    if (sourceQuestionIds.length === 0) {
      router.push(`/sets/${setId}/test`);
      return;
    }

    setIsRetaking(true);
    try {
      const created = await createExamAttempt({
        study_set_id: attempt.study_set_id ?? setId,
        title: attempt.study_set_title_snapshot,
        question_count: sourceQuestionIds.length,
        duration_limit_seconds: attempt.duration_limit_seconds,
        shuffle_questions: false,
        shuffle_options: attempt.config?.shuffle_options ?? true,
        pass_threshold: attempt.pass_threshold,
        question_ids: sourceQuestionIds,
      });
      router.push(`/sets/${setId}/test?attemptId=${created.attempt.id}`);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("common.errorGeneric"),
      );
      setIsRetaking(false);
    }
  }, [attempt, questions, router, setId, t]);

  if (resultQuery.isLoading) {
    return (
      <FocusModeShell backHref={`/sets/${setId}`} title={t("exam.reviewAnswers")}>
        <StudyLoadingSkeleton />
      </FocusModeShell>
    );
  }

  if (resultQuery.isError || !attempt || !computedSummary) {
    return (
      <FocusModeShell backHref={`/sets/${setId}`} title={t("exam.reviewAnswers")}>
        <StudyErrorState
          message={
            resultQuery.error instanceof Error
              ? resultQuery.error.message
              : undefined
          }
          onRetry={() => void resultQuery.refetch()}
          backHref={`/sets/${setId}`}
        />
      </FocusModeShell>
    );
  }

  if (attempt.status === "in_progress") {
    return (
      <FocusModeShell
        backHref={`/sets/${setId}`}
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
              <Link href={`/sets/${setId}/test?attemptId=${attempt.id}`}>
                {lText(locale, "Quay lại phòng thi", "Return to Live Exam")}
              </Link>
            </Button>
          </CardContent>
        </Card>
      </FocusModeShell>
    );
  }

  const wrongSourceQuestionIds = questions
    .filter((q) => {
      const ans = answerMap.get(q.id);
      const st = perQuestionStatusMap.get(q.id);
      const isCorrect =
        typeof ans?.is_correct === "boolean"
          ? ans.is_correct
          : st?.isCorrect ?? false;
      return !isCorrect && Boolean(q.question_id);
    })
    .map((q) => q.question_id!)
    .slice(0, 100);

  return (
    <FocusModeShell
      backHref={`/sets/${setId}`}
      title={attempt.study_set_title_snapshot}
      subtitle={lText(locale, "Kết quả bài thi", "Exam Results")}
    >
      <div className="mx-auto w-full max-w-4xl space-y-6">
        {/* Hero Score Summary */}
        <Card>
          <CardContent className="space-y-6 py-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
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
                      {lText(locale, "Tự động nộp khi hết giờ", "Auto-submitted on timeout")}
                    </Badge>
                  ) : null}
                </div>
                <h2 className="text-3xl font-bold tracking-tight tabular-nums">
                  {Number(attempt.score_percent).toFixed(1)}%{" "}
                  <span className="text-base font-normal text-muted-foreground">
                    ({attempt.correct_count} / {attempt.total_questions}{" "}
                    {lText(locale, "câu đúng", "correct")})
                  </span>
                </h2>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  className="min-h-10"
                  disabled={isRetaking}
                  onClick={() => void handleRetakeSameExam()}
                >
                  {isRetaking ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <RotateCcw className="size-4" aria-hidden="true" />
                  )}
                  {lText(locale, "Làm lại đề này", "Retake Same Exam")}
                </Button>
                <Button variant="outline" className="min-h-10" asChild>
                  <Link href={`/sets/${setId}/test`}>
                    <Shuffle className="size-4" aria-hidden="true" />
                    {lText(locale, "Tạo đề ngẫu nhiên mới", "New Random Exam")}
                  </Link>
                </Button>
                {wrongSourceQuestionIds.length > 0 ? (
                  <Button variant="secondary" className="min-h-10" asChild>
                    <Link
                      href={`/sets/${setId}/practice?questionIds=${wrongSourceQuestionIds.join(",")}&autostart=1`}
                    >
                      <Play className="size-4" aria-hidden="true" />
                      {t("study.reviewMistakes")} ({wrongSourceQuestionIds.length})
                    </Link>
                  </Button>
                ) : null}
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

        {/* Accuracy by Chapter Breakdown */}
        {computedSummary.chapterBreakdown.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {lText(locale, "Độ chính xác theo chương", "Accuracy by Chapter")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Table>
                <caption className="sr-only">
                  {lText(
                    locale,
                    "Bảng thống kê độ chính xác theo từng chương của bài thi",
                    "Chapter-by-chapter accuracy breakdown table",
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
                  {computedSummary.chapterBreakdown.map((row) => (
                    <TableRow key={row.chapter}>
                      <TableCell className="font-medium">{row.chapter}</TableCell>
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
                            value={row.accuracyPercent}
                            className="h-2 w-20"
                            aria-label={`${row.chapter}: ${row.accuracyPercent}%`}
                          />
                          <span className="w-10 text-xs font-semibold tabular-nums">
                            {row.accuracyPercent}%
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ) : null}

        {/* Filterable Question Review */}
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-lg font-semibold">{t("exam.reviewAnswers")}</h2>
            <Tabs
              value={reviewFilter}
              onValueChange={(v) => setReviewFilter(v as ReviewFilter)}
            >
              <TabsList className="flex-wrap h-auto">
                <TabsTrigger value="all">
                  {t("common.all")} ({questions.length})
                </TabsTrigger>
                <TabsTrigger value="incorrect">
                  {lText(locale, "Câu sai", "Incorrect")} ({attempt.wrong_count})
                </TabsTrigger>
                <TabsTrigger value="unanswered">
                  {t("exam.unanswered")} ({attempt.unanswered_count})
                </TabsTrigger>
                <TabsTrigger value="flagged">
                  {lText(locale, "Đánh dấu", "Marked")} (
                  {answers.filter((a) => a.is_flagged).length})
                </TabsTrigger>
                <TabsTrigger value="correct">
                  {t("study.correct")} ({attempt.correct_count})
                </TabsTrigger>
              </TabsList>
            </Tabs>
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
            <div className="space-y-4">
              {filteredQuestions.map((q) => {
                const ans = answerMap.get(q.id);
                const status = perQuestionStatusMap.get(q.id);
                const isUnanswered = status?.isUnanswered ?? true;
                const isCorrect =
                  typeof ans?.is_correct === "boolean"
                    ? ans.is_correct
                    : status?.isCorrect ?? false;
                const correctSet = new Set(q.correct_option_ids ?? []);
                const selectedSet = new Set(ans?.selected_option_ids ?? []);

                return (
                  <Card key={q.id}>
                    <CardContent className="space-y-4 py-5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
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
                          {q.chapter_snapshot ? (
                            <Badge variant="secondary">
                              {q.chapter_snapshot}
                            </Badge>
                          ) : null}
                        </div>
                      </div>

                      <p className="whitespace-pre-wrap text-base font-medium leading-relaxed">
                        {q.prompt_snapshot}
                      </p>

                      {isSafeDisplayImageUrl(q.prompt_image_url_snapshot) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={q.prompt_image_url_snapshot}
                          alt={lText(locale, "Hình ảnh câu hỏi", "Question illustration")}
                          className="max-h-56 rounded-lg border border-border object-contain"
                        />
                      ) : null}

                      {q.question_type === "short_answer" ||
                      q.options_snapshot.length === 0 ? (
                        <div className="grid gap-2 sm:grid-cols-2 text-sm">
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
                                    <CheckCircle2 className="size-3" aria-hidden="true" />
                                    {t("study.correctAnswer")}
                                  </Badge>
                                ) : isOptSelected ? (
                                  <Badge variant="destructive" className="shrink-0">
                                    <XCircle className="size-3" aria-hidden="true" />
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
                );
              })}
            </div>
          )}
        </div>
      </div>
    </FocusModeShell>
  );
}
