"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileCheck2,
  History,
  Play,
  Search,
  XCircle,
} from "lucide-react";
import {
  apiFetch,
  formatDateTime,
  formatMinutes,
  getFriendlyErrorMessage,
  isSupabaseConfiguredClient,
} from "@/components/layout/api-client";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { FadeIn } from "@/components/motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/lib/i18n";
import type { ExamAttempt, ExamStatus, StudyMode, StudySession } from "@/types/domain";

interface SessionWithTitle extends StudySession {
  study_set_title?: string | null;
  study_set?: { id: string; title: string } | null;
}

export function HistoryView() {
  const { locale, t } = useI18n();
  const vi = locale === "vi";
  const configured = isSupabaseConfiguredClient();

  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<"all" | ExamStatus>("all");
  const [modeFilter, setModeFilter] = React.useState<"all" | StudyMode>("all");

  const examsQuery = useQuery<ExamAttempt[]>({
    queryKey: ["history-exams"],
    enabled: configured,
    queryFn: async () => {
      const res = await apiFetch<ExamAttempt[]>("/api/exams?pageSize=100");
      return Array.isArray(res.data) ? res.data : [];
    },
  });

  const sessionsQuery = useQuery<SessionWithTitle[]>({
    queryKey: ["history-sessions"],
    enabled: configured,
    queryFn: async () => {
      const res = await apiFetch<SessionWithTitle[]>("/api/sessions?pageSize=100");
      return Array.isArray(res.data) ? res.data : [];
    },
  });

  const normalizedSearch = search.trim().toLowerCase();

  const filteredExams = React.useMemo(() => {
    const items = examsQuery.data ?? [];
    return items.filter((item) => {
      if (statusFilter !== "all" && item.status !== statusFilter) return false;
      if (
        normalizedSearch &&
        !item.study_set_title_snapshot.toLowerCase().includes(normalizedSearch)
      ) {
        return false;
      }
      return true;
    });
  }, [examsQuery.data, normalizedSearch, statusFilter]);

  const filteredSessions = React.useMemo(() => {
    const items = sessionsQuery.data ?? [];
    return items.filter((item) => {
      if (modeFilter !== "all" && item.mode !== modeFilter) return false;
      if (!normalizedSearch) return true;
      const title = item.study_set_title ?? item.study_set?.title ?? "";
      return (
        title.toLowerCase().includes(normalizedSearch) ||
        item.mode.toLowerCase().includes(normalizedSearch)
      );
    });
  }, [sessionsQuery.data, normalizedSearch, modeFilter]);

  const modeLabel = (mode: string) => {
    const labels: Record<string, { vi: string; en: string }> = {
      flashcards: { vi: "Flashcards", en: "Flashcards" },
      learn: { vi: "Học sâu", en: "Learn" },
      practice: { vi: "Luyện trắc nghiệm", en: "Practice" },
      write: { vi: "Gõ đáp án", en: "Write" },
      match: { vi: "Ghép thẻ", en: "Match" },
      review: { vi: "Ôn tập SM-2", en: "Review" },
    };
    return labels[mode]?.[locale] ?? mode;
  };

  return (
    <FadeIn aboveFold className="space-y-6">
      <PageHeader
        title={vi ? "Lịch sử học tập & Thi thử" : "Study & Exam History"}
        description={
          vi
            ? "Xem lại tất cả lượt thi thử (đơn môn và đa môn) và phiên ôn tập gần đây."
            : "Review all single- and multi-subject exam attempts and completed study sessions."
        }
        actions={
          <search className="relative w-full sm:w-64">
            <Search
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={vi ? "Tìm theo tên đề thi / học phần..." : "Filter by title..."}
              aria-label={vi ? "Tìm trong lịch sử" : "Filter history"}
              className="pl-9"
            />
          </search>
        }
      />

      <Tabs defaultValue="exams">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="exams">
              <FileCheck2 className="size-4" aria-hidden="true" />
              <span>
                {t("exam.historyTitle")} ({filteredExams.length})
              </span>
            </TabsTrigger>
            <TabsTrigger value="sessions">
              <History className="size-4" aria-hidden="true" />
              <span>
                {t("stats.recentSessions")} ({filteredSessions.length})
              </span>
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="exams" className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as "all" | ExamStatus)}
            >
              <SelectTrigger
                className="w-44"
                aria-label={vi ? "Lọc theo trạng thái bài thi" : "Filter exam status"}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {vi ? "Tất cả trạng thái" : "All statuses"}
                </SelectItem>
                <SelectItem value="submitted">
                  {vi ? "Đã nộp bài" : "Submitted"}
                </SelectItem>
                <SelectItem value="in_progress">
                  {vi ? "Đang làm dở" : "In progress"}
                </SelectItem>
                <SelectItem value="expired">
                  {vi ? "Hết giờ" : "Timed out"}
                </SelectItem>
              </SelectContent>
            </Select>

            <Button asChild size="sm" variant="outline">
              <Link href="/exams/new">
                <FileCheck2 className="size-4" aria-hidden="true" />
                <span>{t("nav.customExam")}</span>
              </Link>
            </Button>
          </div>

          {!configured ? (
            <EmptyState
              icon={FileCheck2}
              title={vi ? "Chưa thể tải lịch sử thi" : "Exam history unavailable"}
              description={t("common.serviceUnavailableDesc")}
            />
          ) : examsQuery.isLoading ? (
            <Skeleton className="h-64 w-full rounded-xl" />
          ) : examsQuery.error ? (
            <EmptyState
              icon={AlertCircle}
              title={vi ? "Không thể tải lịch sử thi" : "Failed to load exam history"}
              description={getFriendlyErrorMessage(examsQuery.error, locale)}
              action={
                <Button onClick={() => void examsQuery.refetch()}>
                  {t("common.retry")}
                </Button>
              }
            />
          ) : filteredExams.length === 0 ? (
            <EmptyState
              icon={FileCheck2}
              title={t("exam.noAttempts")}
              description={
                vi
                  ? "Tạo đề thi thử tùy chỉnh cho một hoặc nhiều môn học để theo dõi điểm số tại đây."
                  : "Launch a single- or multi-subject custom mock exam to track your scores here."
              }
              action={
                <Button asChild>
                  <Link href="/exams/new">
                    <span>{vi ? "Tạo đề thi thử đầu tiên" : "Create your first exam"}</span>
                  </Link>
                </Button>
              }
            />
          ) : (
            <Card>
              <CardContent className="p-0">
                <div
                  tabIndex={0}
                  role="region"
                  aria-label={t("exam.historyTitle")}
                  className="responsive-table-region"
                >
                  <Table>
                    <TableCaption className="sr-only">
                      {t("exam.historyTitle")}
                    </TableCaption>
                    <TableHeader>
                      <TableRow>
                        <TableHead scope="col">{vi ? "Đề thi / Học phần" : "Exam / Set"}</TableHead>
                        <TableHead scope="col">{t("exam.score")}</TableHead>
                        <TableHead scope="col">{vi ? "Đúng / Tổng" : "Correct"}</TableHead>
                        <TableHead scope="col">{vi ? "Trạng thái" : "Status"}</TableHead>
                        <TableHead scope="col">{t("study.timeSpent")}</TableHead>
                        <TableHead scope="col">{vi ? "Thời điểm" : "Date"}</TableHead>
                        <TableHead scope="col" className="text-right">
                          {t("common.actions")}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredExams.map((attempt) => {
                        const isInProgress = attempt.status === "in_progress";
                        const isMultiSubject = attempt.study_set_id === null;
                        // Support both single-set AND multi-subject exams (fixes SH-036 / AN-01)
                        const targetUrl = isInProgress
                          ? `/exams/${attempt.id}`
                          : attempt.study_set_id
                            ? `/sets/${attempt.study_set_id}/results/${attempt.id}`
                            : `/exams/${attempt.id}/results`;
                        return (
                          <TableRow key={attempt.id}>
                            <TableCell className="max-w-xs font-medium">
                              <div className="space-y-1">
                                <span className="line-clamp-1">
                                  {attempt.study_set_title_snapshot}
                                </span>
                                {isMultiSubject && (
                                  <Badge variant="outline" className="text-[10px]">
                                    {t("exam.multiSubjectBadge")}
                                  </Badge>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="font-mono font-semibold tabular-nums">
                              {isInProgress ? "—" : `${Math.round(attempt.score_percent)}%`}
                            </TableCell>
                            <TableCell className="font-mono text-xs tabular-nums">
                              {isInProgress
                                ? `${attempt.answered_count}/${attempt.total_questions}`
                                : `${attempt.correct_count}/${attempt.total_questions}`}
                            </TableCell>
                            <TableCell>
                              {isInProgress ? (
                                <Badge variant="warning">
                                  <Clock className="size-3" aria-hidden="true" />
                                  <span>{vi ? "Đang làm" : "In progress"}</span>
                                </Badge>
                              ) : attempt.passed ? (
                                <Badge variant="success">
                                  <CheckCircle2 className="size-3" aria-hidden="true" />
                                  <span>{t("exam.passed")}</span>
                                </Badge>
                              ) : (
                                <Badge variant="destructive">
                                  <XCircle className="size-3" aria-hidden="true" />
                                  <span>{t("exam.failed")}</span>
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-muted-foreground font-mono text-xs tabular-nums">
                              {formatMinutes(attempt.time_spent_seconds, locale)}
                            </TableCell>
                            <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                              {formatDateTime(attempt.submitted_at ?? attempt.started_at, locale)}
                            </TableCell>
                            <TableCell className="text-right">
                              <Button variant="ghost" size="sm" asChild>
                                <Link
                                  href={targetUrl}
                                  aria-label={
                                    isInProgress
                                      ? `${vi ? "Tiếp tục" : "Resume"} ${attempt.study_set_title_snapshot}`
                                      : `${vi ? "Xem kết quả" : "Review"} ${attempt.study_set_title_snapshot}`
                                  }
                                >
                                  {isInProgress ? (
                                    <>
                                      <Play className="size-3.5" aria-hidden="true" />
                                      <span>{vi ? "Tiếp tục" : "Resume"}</span>
                                    </>
                                  ) : (
                                    <>
                                      <ExternalLink className="size-3.5" aria-hidden="true" />
                                      <span>{vi ? "Chi tiết" : "Review"}</span>
                                    </>
                                  )}
                                </Link>
                              </Button>
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
        </TabsContent>

        <TabsContent value="sessions" className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={modeFilter}
              onValueChange={(v) => setModeFilter(v as "all" | StudyMode)}
            >
              <SelectTrigger
                className="w-44"
                aria-label={vi ? "Lọc theo chế độ học" : "Filter study mode"}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">
                  {vi ? "Tất cả chế độ" : "All modes"}
                </SelectItem>
                <SelectItem value="flashcards">Flashcards</SelectItem>
                <SelectItem value="practice">{t("study.practice")}</SelectItem>
                <SelectItem value="learn">{t("study.learn")}</SelectItem>
                <SelectItem value="write">{t("study.write")}</SelectItem>
                <SelectItem value="match">{t("study.match")}</SelectItem>
                <SelectItem value="review">{vi ? "Ôn tập SM-2" : "SM-2 Review"}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {!configured ? (
            <EmptyState
              icon={History}
              title={vi ? "Chưa thể tải phiên học" : "Sessions unavailable"}
              description={t("common.serviceUnavailableDesc")}
            />
          ) : sessionsQuery.isLoading ? (
            <Skeleton className="h-64 w-full rounded-xl" />
          ) : sessionsQuery.error ? (
            <EmptyState
              icon={AlertCircle}
              title={vi ? "Không thể tải phiên học" : "Failed to load study sessions"}
              description={getFriendlyErrorMessage(sessionsQuery.error, locale)}
              action={
                <Button onClick={() => void sessionsQuery.refetch()}>
                  {t("common.retry")}
                </Button>
              }
            />
          ) : filteredSessions.length === 0 ? (
            <EmptyState
              icon={History}
              title={vi ? "Chưa có phiên học nào" : "No study sessions yet"}
              description={
                vi
                  ? "Các phiên học Flashcards, Learn, Practice, Write và Match của bạn sẽ xuất hiện tại đây."
                  : "Your Flashcards, Learn, Practice, Write, and Match sessions will appear here."
              }
              action={
                <Button asChild>
                  <Link href="/library">{t("library.title")}</Link>
                </Button>
              }
            />
          ) : (
            <Card>
              <CardContent className="p-0">
                <div
                  tabIndex={0}
                  role="region"
                  aria-label={t("stats.recentSessions")}
                  className="responsive-table-region"
                >
                  <Table>
                    <TableCaption className="sr-only">
                      {t("stats.recentSessions")}
                    </TableCaption>
                    <TableHeader>
                      <TableRow>
                        <TableHead scope="col">{vi ? "Học phần" : "Study Set"}</TableHead>
                        <TableHead scope="col">{vi ? "Chế độ" : "Mode"}</TableHead>
                        <TableHead scope="col">{vi ? "Hoàn thành" : "Completed"}</TableHead>
                        <TableHead scope="col">{t("study.accuracy")}</TableHead>
                        <TableHead scope="col">{t("study.timeSpent")}</TableHead>
                        <TableHead scope="col">{vi ? "Thời điểm" : "Date"}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {filteredSessions.map((session) => {
                        const accuracy =
                          session.completed_items > 0
                            ? Math.round(
                                (session.correct_items / session.completed_items) * 100,
                              )
                            : 0;
                        const setTitle =
                          session.study_set_title ??
                          session.study_set?.title ??
                          (session.study_set_id
                            ? vi
                              ? "Học phần"
                              : "Study Set"
                            : vi
                              ? "Luyện tập nhiều môn"
                              : "Multi-subject practice");
                        return (
                          <TableRow key={session.id}>
                            <TableCell className="max-w-xs font-medium">
                              {session.study_set_id ? (
                                <Link
                                  href={`/sets/${session.study_set_id}`}
                                  className="hover:text-primary line-clamp-1 transition-colors"
                                >
                                  {setTitle}
                                </Link>
                              ) : (
                                <span className="line-clamp-1">{setTitle}</span>
                              )}
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary">{modeLabel(session.mode)}</Badge>
                            </TableCell>
                            <TableCell className="font-mono text-xs tabular-nums">
                              {session.completed_items}/{session.total_items}
                            </TableCell>
                            <TableCell className="font-mono text-xs font-semibold tabular-nums">
                              {accuracy}%
                            </TableCell>
                            <TableCell className="text-muted-foreground font-mono text-xs tabular-nums">
                              {formatMinutes(session.duration_seconds, locale)}
                            </TableCell>
                            <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                              {formatDateTime(session.completed_at ?? session.started_at, locale)}
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
        </TabsContent>
      </Tabs>
    </FadeIn>
  );
}
