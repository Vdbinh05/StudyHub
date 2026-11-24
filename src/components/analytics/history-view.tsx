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
} from "@/components/layout/api-client";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { FadeIn } from "@/components/motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/lib/i18n";
import type { ExamAttempt, StudySession } from "@/types/domain";

interface SessionWithTitle extends StudySession {
  study_set_title?: string | null;
  study_set?: { id: string; title: string } | null;
}

export function HistoryView() {
  const { locale, t } = useI18n();
  const vi = locale === "vi";
  const [search, setSearch] = React.useState("");

  const examsQuery = useQuery<ExamAttempt[]>({
    queryKey: ["history-exams"],
    queryFn: async () => {
      const res = await apiFetch<ExamAttempt[]>("/api/exams?pageSize=100");
      return Array.isArray(res.data) ? res.data : [];
    },
  });

  const sessionsQuery = useQuery<SessionWithTitle[]>({
    queryKey: ["history-sessions"],
    queryFn: async () => {
      const res = await apiFetch<SessionWithTitle[]>("/api/sessions?pageSize=100");
      return Array.isArray(res.data) ? res.data : [];
    },
  });

  const normalizedSearch = search.trim().toLowerCase();

  const filteredExams = React.useMemo(() => {
    const items = examsQuery.data ?? [];
    if (!normalizedSearch) return items;
    return items.filter((item) =>
      item.study_set_title_snapshot.toLowerCase().includes(normalizedSearch),
    );
  }, [examsQuery.data, normalizedSearch]);

  const filteredSessions = React.useMemo(() => {
    const items = sessionsQuery.data ?? [];
    if (!normalizedSearch) return items;
    return items.filter((item) => {
      const title = item.study_set_title ?? item.study_set?.title ?? "";
      return (
        title.toLowerCase().includes(normalizedSearch) ||
        item.mode.toLowerCase().includes(normalizedSearch)
      );
    });
  }, [sessionsQuery.data, normalizedSearch]);

  const modeLabel = (mode: string) => {
    const labels: Record<string, { vi: string; en: string }> = {
      flashcards: { vi: "Flashcards", en: "Flashcards" },
      learn: { vi: "Học tập", en: "Learn" },
      practice: { vi: "Luyện trắc nghiệm", en: "Practice" },
      write: { vi: "Gõ đáp án", en: "Write" },
      match: { vi: "Ghép thẻ", en: "Match" },
      review: { vi: "Ôn tập SM-2", en: "Review" },
    };
    return labels[mode]?.[locale] ?? mode;
  };

  return (
    <FadeIn className="space-y-6">
      <PageHeader
        title={vi ? "Lịch sử học tập & Thi thử" : "Study & Exam History"}
        description={
          vi
            ? "Xem lại tất cả lượt thi thử (đã chấm bất biến) và phiên ôn tập gần đây."
            : "Review all immutable exam attempts and completed study sessions."
        }
        actions={
          <div className="relative w-full sm:w-64">
            <Search
              className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <Input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={vi ? "Tìm theo tên học phần..." : "Filter by set title..."}
              aria-label={vi ? "Tìm trong lịch sử" : "Filter history"}
              className="pl-9"
            />
          </div>
        }
      />

      <Tabs defaultValue="exams">
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

        <TabsContent value="exams" className="mt-4">
          {examsQuery.isLoading ? (
            <Skeleton className="h-64 w-full rounded-xl" />
          ) : examsQuery.error ? (
            <EmptyState
              icon={AlertCircle}
              title={vi ? "Không thể tải lịch sử thi" : "Failed to load exam history"}
              description={
                examsQuery.error instanceof Error
                  ? examsQuery.error.message
                  : t("common.errorGeneric")
              }
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
                  ? "Hãy chọn một học phần trong thư viện và bắt đầu bài thi thử bấm giờ đầu tiên."
                  : "Pick any study set from your library to launch your first timed mock exam."
              }
              action={
                <Button asChild>
                  <Link href="/library?action=test">
                    <span>{vi ? "Chọn đề thi thử" : "Choose a set to test"}</span>
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
                  className="overflow-x-auto"
                >
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead scope="col">{vi ? "Học phần" : "Study Set"}</TableHead>
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
                        const targetUrl = attempt.study_set_id
                          ? isInProgress
                            ? `/sets/${attempt.study_set_id}/test?attemptId=${attempt.id}`
                            : `/sets/${attempt.study_set_id}/results/${attempt.id}`
                          : null;
                        return (
                          <TableRow key={attempt.id}>
                            <TableCell className="max-w-xs font-medium">
                              <span className="line-clamp-1">
                                {attempt.study_set_title_snapshot}
                              </span>
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
                              {targetUrl ? (
                                <Button variant="ghost" size="sm" asChild>
                                  <Link href={targetUrl}>
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
                              ) : (
                                <span className="text-muted-foreground text-xs">—</span>
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
        </TabsContent>

        <TabsContent value="sessions" className="mt-4">
          {sessionsQuery.isLoading ? (
            <Skeleton className="h-64 w-full rounded-xl" />
          ) : sessionsQuery.error ? (
            <EmptyState
              icon={AlertCircle}
              title={vi ? "Không thể tải phiên học" : "Failed to load study sessions"}
              description={
                sessionsQuery.error instanceof Error
                  ? sessionsQuery.error.message
                  : t("common.errorGeneric")
              }
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
                  className="overflow-x-auto"
                >
                  <Table>
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
                          (vi ? "Học phần" : "Study Set");
                        return (
                          <TableRow key={session.id}>
                            <TableCell className="max-w-xs font-medium">
                              <Link
                                href={`/sets/${session.study_set_id}`}
                                className="hover:text-primary line-clamp-1 transition-colors"
                              >
                                {setTitle}
                              </Link>
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
