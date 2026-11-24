"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Filter,
  Play,
  RefreshCw,
  Search,
  Star,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/lib/i18n";
import {
  fetchAccessibleSets,
  fetchStarredQuestions,
  unstarQuestion,
} from "@/lib/learning/api-client";
import { getExpectedWriteAnswers } from "@/lib/learning/write-grader";
import { lText } from "./learning-copy";
import { SafeRichText, ZoomableImage } from "./SafeRichText";

export function StarredQuestionsClient() {
  const { locale, t } = useI18n();
  const queryClient = useQueryClient();

  const [selectedSetId, setSelectedSetId] = React.useState<string>("all");
  const [selectedChapter, setSelectedChapter] = React.useState<string>("all");
  const [searchTerm, setSearchTerm] = React.useState<string>("");

  const setsQuery = useQuery({
    queryKey: ["accessible-sets"],
    queryFn: () => fetchAccessibleSets(),
    staleTime: 60_000,
  });

  const starredQuery = useQuery({
    queryKey: ["starred-questions", selectedSetId],
    queryFn: () =>
      fetchStarredQuestions(selectedSetId !== "all" ? selectedSetId : undefined),
  });

  const allStarred = React.useMemo(
    () => starredQuery.data ?? [],
    [starredQuery.data],
  );

  const availableChapters = React.useMemo(() => {
    const set = new Set<string>();
    for (const item of allStarred) {
      const ch = item.question?.chapter;
      if (ch && ch.trim()) set.add(ch.trim());
    }
    return Array.from(set);
  }, [allStarred]);

  const filtered = React.useMemo(() => {
    const qLower = searchTerm.trim().toLowerCase();
    return allStarred.filter((item) => {
      if (selectedChapter !== "all") {
        if ((item.question?.chapter?.trim() || "") !== selectedChapter) {
          return false;
        }
      }
      if (qLower) {
        const prompt = item.question?.prompt?.toLowerCase() ?? "";
        const chapter = item.question?.chapter?.toLowerCase() ?? "";
        return prompt.includes(qLower) || chapter.includes(qLower);
      }
      return true;
    });
  }, [allStarred, searchTerm, selectedChapter]);

  const setTitleMap = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const s of setsQuery.data ?? []) {
      map.set(s.id, s.title);
    }
    return map;
  }, [setsQuery.data]);

  const handleUnstar = React.useCallback(
    async (questionId: string) => {
      try {
        await unstarQuestion(questionId);
        toast.success(
          lText(locale, "Đã bỏ đánh dấu sao.", "Removed from starred questions."),
        );
        await queryClient.invalidateQueries({ queryKey: ["starred-questions"] });
      } catch {
        toast.error(t("common.errorGeneric"));
      }
    },
    [locale, queryClient, t],
  );

  // True multi-subject Practice & Exam launch across ALL affected sets (fixes SH-024!)
  const affectedSetIds = React.useMemo(() => {
    if (selectedSetId !== "all") return [selectedSetId];
    return Array.from(
      new Set(filtered.map((item) => item.study_set_id).filter(Boolean)),
    );
  }, [filtered, selectedSetId]);

  const practiceStarredHref = React.useMemo(() => {
    const qs = new URLSearchParams({ mode: "starred" });
    if (selectedSetId !== "all") qs.set("setId", selectedSetId);
    else if (affectedSetIds.length > 0) qs.set("setIds", affectedSetIds.join(","));
    if (selectedChapter !== "all") qs.set("chapter", selectedChapter);
    return `/practice?${qs.toString()}`;
  }, [affectedSetIds, selectedChapter, selectedSetId]);

  const testStarredHref = React.useMemo(() => {
    const qs = new URLSearchParams({ mode: "starred" });
    if (selectedSetId !== "all") qs.set("setId", selectedSetId);
    else if (affectedSetIds.length > 0) qs.set("setIds", affectedSetIds.join(","));
    return `/exams/new?${qs.toString()}`;
  }, [affectedSetIds, selectedSetId]);

  const formatMastery = (level: string): string => {
    switch (level) {
      case "new":
        return t("study.masteryNew");
      case "learning":
        return t("study.masteryLearning");
      case "familiar":
        return t("study.masteryFamiliar");
      case "mastered":
        return t("study.masteryMastered");
      default:
        return level;
    }
  };

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {lText(locale, "Câu hỏi đánh dấu sao", "Starred Questions")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {lText(
              locale,
              "Tổng hợp các câu hỏi quan trọng bạn đã đánh dấu trên toàn bộ học phần.",
              "All bookmarked questions across your study sets in one focused view.",
            )}
          </p>
        </div>

        {affectedSetIds.length > 0 && filtered.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild className="min-h-11">
              <Link href={practiceStarredHref}>
                <Play className="size-4" aria-hidden="true" />
                {lText(
                  locale,
                  affectedSetIds.length > 1
                    ? `Luyện câu gắn sao (${affectedSetIds.length} môn)`
                    : "Luyện câu đánh dấu",
                  affectedSetIds.length > 1
                    ? `Practice Starred (${affectedSetIds.length} sets)`
                    : "Practice Starred",
                )}
              </Link>
            </Button>
            <Button variant="outline" asChild className="min-h-11">
              <Link href={testStarredHref} prefetch={false}>
                <ClipboardList className="size-4" aria-hidden="true" />
                {lText(locale, "Thi thử câu đánh dấu", "Test Starred")}
              </Link>
            </Button>
          </div>
        ) : null}
      </div>

      {/* Compact Search + Collapsible Set/Chapter Filter (keeps starred cards visible on mobile Screen 1) */}
      <div className="space-y-2">
        <div className="relative">
          <Search
            className="pointer-events-none absolute top-3 left-3 size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            id="starred-search"
            className="min-h-10 pl-9"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            aria-label={t("common.search")}
            placeholder={lText(
              locale,
              "Tìm theo nội dung câu hỏi...",
              "Search question text...",
            )}
          />
        </div>

        <details className="group rounded-xl border border-border bg-card">
          <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-2 px-3.5 py-2 text-xs font-medium text-foreground select-none [&::-webkit-details-marker]:hidden">
            <span className="flex items-center gap-1.5">
              <Filter className="size-3.5 text-primary" aria-hidden="true" />
              {lText(locale, "Lọc theo học phần & chương", "Filter by study set & chapter")}
              {selectedSetId !== "all" || selectedChapter !== "all" ? (
                <Badge variant="default" className="text-[10px] tabular-nums">
                  {(selectedSetId !== "all" ? 1 : 0) +
                    (selectedChapter !== "all" ? 1 : 0)}
                </Badge>
              ) : null}
            </span>
            <ChevronDown
              className="size-4 text-muted-foreground transition-transform group-open:rotate-180"
              aria-hidden="true"
            />
          </summary>

          <div className="grid gap-3 border-t border-border p-3.5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="starred-set" className="text-xs">
                {lText(locale, "Học phần", "Study Set")}
              </Label>
              <Select
                value={selectedSetId}
                onValueChange={(val) => {
                  setSelectedSetId(val);
                  setSelectedChapter("all");
                }}
              >
                <SelectTrigger id="starred-set" className="h-9">
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
              <Label htmlFor="starred-chapter" className="text-xs">
                {lText(locale, "Chương", "Chapter")}
              </Label>
              <Select
                value={selectedChapter}
                onValueChange={setSelectedChapter}
              >
                <SelectTrigger id="starred-chapter" className="h-9">
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
          </div>
        </details>
      </div>

      {starredQuery.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
        </div>
      ) : starredQuery.isError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <AlertCircle className="size-8 text-destructive" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">
              {lText(
                locale,
                "Không thể tải danh sách câu đánh dấu sao.",
                "Could not load starred questions.",
              )}
            </p>
            <Button variant="outline" onClick={() => void starredQuery.refetch()}>
              <RefreshCw className="size-4" aria-hidden="true" />
              {t("common.retry")}
            </Button>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-warning-subtle text-warning-subtle-foreground">
              <Star className="size-6" aria-hidden="true" />
            </div>
            <h2 className="text-lg font-semibold">
              {lText(locale, "Chưa có câu hỏi đánh dấu sao", "No starred questions yet")}
            </h2>
            <p className="max-w-md text-sm text-muted-foreground">
              {lText(
                locale,
                "Nhấn biểu tượng ngôi sao (hoặc phím S) khi học để lưu nhanh những câu hỏi khó cần ôn kỹ.",
                "Click the star icon (or press S) while studying to bookmark important questions.",
              )}
            </p>
            <Button variant="outline" asChild>
              <Link href="/library">{t("nav.library")}</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((item, idx) => {
            const q = item.question;
            const setTitle =
              item.study_set_title ??
              setTitleMap.get(item.study_set_id) ??
              lText(locale, "Học phần", "Study Set");
            const correctDisplay = q
              ? (q.options ?? [])
                  .filter((o) => o.is_correct)
                  .map((o) => o.content)
                  .join(", ") ||
                getExpectedWriteAnswers(q)
                  .map((a) => a.answer_text)
                  .join(" / ")
              : "";

            return (
              <Card
                key={`${item.study_set_id}-${item.question_id}`}
                className={idx >= 2 ? "cv-auto" : undefined}
              >
                <CardContent className="space-y-3 py-5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/sets/${item.study_set_id}`}
                        prefetch={false}
                        className="text-xs font-medium text-primary hover:underline"
                      >
                        {setTitle}
                      </Link>
                      {q?.chapter ? (
                        <Badge variant="secondary">{q.chapter}</Badge>
                      ) : null}
                      {item.progress?.mastery_level ? (
                        <Badge variant="outline">
                          {formatMastery(item.progress.mastery_level)}
                        </Badge>
                      ) : null}
                    </div>

                    <Button
                      variant="ghost"
                      size="sm"
                      className="min-h-9 text-warning-subtle-foreground"
                      onClick={() => void handleUnstar(item.question_id)}
                    >
                      <Star className="size-4 fill-warning text-warning" aria-hidden="true" />
                      {t("study.unstarQuestion")}
                    </Button>
                  </div>

                  <div className="space-y-2.5">
                    <div className="text-sm font-medium leading-relaxed sm:text-base">
                      <SafeRichText
                        rich={q?.prompt_rich}
                        fallbackText={q?.prompt ?? item.question_id}
                      />
                    </div>
                    {q?.prompt_image_url ? (
                      <ZoomableImage
                        src={q.prompt_image_url}
                        alt={lText(
                          locale,
                          "Hình ảnh câu hỏi",
                          "Question illustration",
                        )}
                        lazy
                      />
                    ) : null}
                  </div>

                  {correctDisplay ? (
                    <div className="rounded-lg border border-success/30 bg-success-subtle/50 p-3 text-xs sm:text-sm">
                      <div className="flex items-center gap-1.5 font-semibold text-success-subtle-foreground">
                        <CheckCircle2 className="size-3.5" aria-hidden="true" />
                        <span>{t("study.correctAnswer")}</span>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-foreground">
                        {correctDisplay}
                      </p>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
