"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  Edit3,
  Eye,
  EyeOff,
  FileCheck2,
  Layers,
  PenLine,
  Play,
  Repeat,
  Search,
  Share2,
  Shuffle,
  Star,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import {
  apiFetch,
  formatRelativeTime,
  getFriendlyErrorMessage,
  isSupabaseConfiguredClient,
} from "@/components/layout/api-client";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { FadeIn } from "@/components/motion";
import { ShareDialog } from "@/components/social/share-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { MemberRole, Question, StudySet } from "@/types/domain";

interface StudySetDetailResponse extends StudySet {
  role?: MemberRole;
  chapters?: Array<string | { name: string; count: number }>;
  can_edit?: boolean;
}

interface StarredRow {
  question_id?: string;
  question?: { id: string };
}

export function StudySetHub({ setId }: { setId: string }) {
  const { locale, t } = useI18n();
  const vi = locale === "vi";
  const router = useRouter();
  const queryClient = useQueryClient();
  const configured = isSupabaseConfiguredClient();

  const [shareOpen, setShareOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [chapterFilter, setChapterFilter] = React.useState("all");
  const [starredOnly, setStarredOnly] = React.useState(false);
  const [showAnswers, setShowAnswers] = React.useState(true);
  const [page, setPage] = React.useState(1);

  const listParentRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const setQuery = useQuery<StudySetDetailResponse>({
    queryKey: ["study-set", setId],
    enabled: configured,
    queryFn: async () => {
      const res = await apiFetch<StudySetDetailResponse>(`/api/sets/${setId}`);
      return res.data;
    },
  });

  const questionsQuery = useQuery<{ items: Question[]; total: number }>({
    queryKey: ["set-questions", setId, page, debouncedSearch, chapterFilter, starredOnly],
    enabled: configured && Boolean(setQuery.data),
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", "500");
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (chapterFilter !== "all") params.set("chapter", chapterFilter);
      if (starredOnly) params.set("starredOnly", "true");
      const res = await apiFetch<Question[]>(
        `/api/sets/${setId}/questions?${params.toString()}`,
      );
      const items = Array.isArray(res.data) ? res.data : [];
      return {
        items,
        total: Number(res.meta?.total ?? items.length),
      };
    },
  });

  // Paginated fetch respecting Zod max(200) on /api/starred (fixes SH-009)
  const starredQuery = useQuery<Set<string>>({
    queryKey: ["starred-ids", setId],
    enabled: configured && Boolean(setQuery.data),
    queryFn: async () => {
      try {
        const ids = new Set<string>();
        let starPage = 1;
        let hasMore = true;
        while (hasMore && starPage <= 25) {
          const res = await apiFetch<StarredRow[]>(
            `/api/starred?studySetId=${encodeURIComponent(setId)}&page=${starPage}&pageSize=200`,
          );
          const list = Array.isArray(res.data) ? res.data : [];
          for (const r of list) {
            const qId = r.question?.id ?? r.question_id;
            if (qId) ids.add(qId);
          }
          hasMore = Boolean(res.meta?.hasMore) && list.length === 200;
          starPage += 1;
        }
        return ids;
      } catch {
        return new Set<string>();
      }
    },
  });

  const favoriteSetMutation = useMutation({
    mutationFn: async (nextFav: boolean) => {
      await apiFetch(`/api/sets/${setId}`, {
        method: "PATCH",
        body: JSON.stringify({ is_favorite: nextFav }),
      });
    },
    onMutate: async (nextFav) => {
      await queryClient.cancelQueries({ queryKey: ["study-set", setId] });
      const prev = queryClient.getQueryData<StudySetDetailResponse>(["study-set", setId]);
      if (prev) {
        queryClient.setQueryData(["study-set", setId], {
          ...prev,
          is_favorite: nextFav,
        });
      }
      return { prev };
    },
    onError: (err, _, ctx) => {
      if (ctx?.prev) {
        queryClient.setQueryData(["study-set", setId], ctx.prev);
      }
      toast.error(getFriendlyErrorMessage(err, locale));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["study-set", setId] });
      queryClient.invalidateQueries({ queryKey: ["study-sets"] });
    },
  });

  const starMutation = useMutation({
    mutationFn: async ({ questionId, isStarred }: { questionId: string; isStarred: boolean }) => {
      if (isStarred) {
        await apiFetch(`/api/starred/${questionId}`, { method: "DELETE" });
      } else {
        await apiFetch(`/api/starred`, {
          method: "POST",
          body: JSON.stringify({ question_id: questionId, study_set_id: setId }),
        });
      }
    },
    onMutate: async ({ questionId, isStarred }) => {
      await queryClient.cancelQueries({ queryKey: ["starred-ids", setId] });
      const prev = queryClient.getQueryData<Set<string>>(["starred-ids", setId]);
      const next = new Set(prev ?? []);
      if (isStarred) next.delete(questionId);
      else next.add(questionId);
      queryClient.setQueryData(["starred-ids", setId], next);
      return { prev };
    },
    onError: (err, __, ctx) => {
      if (ctx?.prev) {
        queryClient.setQueryData(["starred-ids", setId], ctx.prev);
      }
      toast.error(getFriendlyErrorMessage(err, locale));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["starred-ids", setId] });
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiFetch<StudySet>(`/api/sets/${setId}/duplicate`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      return res.data;
    },
    onSuccess: (cloned) => {
      queryClient.invalidateQueries({ queryKey: ["study-sets"] });
      toast.success(vi ? "Đã nhân bản học phần." : "Study set cloned to your library.");
      router.push(`/sets/${cloned.id}`);
    },
    onError: (err) => {
      toast.error(getFriendlyErrorMessage(err, locale));
    },
  });

  const questions = React.useMemo(
    () => questionsQuery.data?.items ?? [],
    [questionsQuery.data?.items],
  );
  const totalQuestionsMatched = questionsQuery.data?.total ?? questions.length;
  const starredSet = starredQuery.data ?? new Set<string>();

  const chapters = React.useMemo(() => {
    const fromSet = setQuery.data?.chapters ?? [];
    const discovered = new Set<string>();
    for (const ch of fromSet) {
      const name = typeof ch === "string" ? ch : ch.name;
      if (name) discovered.add(name);
    }
    for (const q of questions) {
      if (q.chapter) discovered.add(q.chapter);
    }
    return Array.from(discovered);
  }, [setQuery.data?.chapters, questions]);

  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: questions.length,
    getScrollElement: () => listParentRef.current,
    estimateSize: () => 152,
    overscan: 6,
  });

  if (!configured) {
    return (
      <EmptyState
        icon={AlertCircle}
        title={vi ? "Không thể tải học phần" : "Study set unavailable"}
        description={t("common.serviceUnavailableDesc")}
        action={
          <Button asChild variant="outline">
            <Link href="/library">{t("library.title")}</Link>
          </Button>
        }
      />
    );
  }

  if (setQuery.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-14 w-96" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  if (setQuery.error || !setQuery.data) {
    return (
      <EmptyState
        icon={AlertCircle}
        title={vi ? "Không tìm thấy học phần" : "Study set not found"}
        description={
          setQuery.error
            ? getFriendlyErrorMessage(setQuery.error, locale)
            : vi
              ? "Học phần không tồn tại hoặc bạn không có quyền truy cập."
              : "This study set does not exist or you do not have access to it."
        }
        action={
          <Button asChild>
            <Link href="/library">{t("library.title")}</Link>
          </Button>
        }
      />
    );
  }

  const studySet = setQuery.data;
  const isOwner = studySet.role === "owner" || studySet.role === undefined;
  const canEdit =
    isOwner ||
    studySet.role === "editor" ||
    studySet.can_edit === true;
  const hasQuestions = studySet.question_count > 0 || questions.length > 0;
  const isFavorite = Boolean(studySet.is_favorite);

  const modeCards = [
    {
      href: `/sets/${setId}/flashcards`,
      icon: Layers,
      title: t("study.flashcards"),
      subtitle: vi ? "Lật thẻ & phím tắt" : "Flip cards & shortcuts",
    },
    {
      href: `/sets/${setId}/practice`,
      icon: Play,
      title: t("study.practice"),
      subtitle: vi ? "Chấm ngay & giải thích" : "Instant check & notes",
    },
    {
      href: `/sets/${setId}/learn`,
      icon: Repeat,
      title: t("study.learn"),
      subtitle: vi ? "Học thích ứng SM-2" : "Adaptive SM-2 queue",
    },
    {
      href: `/sets/${setId}/write`,
      icon: PenLine,
      title: t("study.write"),
      subtitle: vi ? "Gõ câu trả lời" : "Typed recall check",
    },
    {
      href: `/sets/${setId}/match`,
      icon: Shuffle,
      title: t("study.match"),
      subtitle: vi ? "Ghép cặp tính giờ" : "Timed pair matching",
    },
    {
      href: `/sets/${setId}/test`,
      icon: FileCheck2,
      title: t("study.exam"),
      subtitle: vi ? "Thi thử bấm giờ" : "Timed mock exam",
    },
  ];

  const totalPages = Math.max(1, Math.ceil(totalQuestionsMatched / 500));

  return (
    <FadeIn aboveFold className="space-y-6">
      <PageHeader
        title={studySet.title}
        description={studySet.description ?? undefined}
        breadcrumbs={[
          { label: t("library.title"), href: "/library" },
          { label: studySet.title },
        ]}
        actions={
          <>
            {hasQuestions && (
              <Button size="sm" asChild>
                <Link href={`/exams/new?setId=${setId}`}>
                  <FileCheck2 className="size-4" aria-hidden="true" />
                  <span>{t("library.customExamCta")}</span>
                </Link>
              </Button>
            )}

            {isOwner && (
              <Button
                size="sm"
                variant="outline"
                aria-pressed={isFavorite}
                aria-label={
                  isFavorite ? t("library.unfavoriteSet") : t("library.favoriteSet")
                }
                onClick={() => favoriteSetMutation.mutate(!isFavorite)}
              >
                <Star
                  className={cn(
                    "size-4",
                    isFavorite ? "fill-warning text-warning" : "text-muted-foreground",
                  )}
                  aria-hidden="true"
                />
                <span className="hidden sm:inline">{t("library.favorites")}</span>
              </Button>
            )}

            {canEdit && (
              <>
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/sets/${setId}/import`}>
                    <Upload className="size-4" aria-hidden="true" />
                    <span>{t("library.importSet")}</span>
                  </Link>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/sets/${setId}/edit`}>
                    <Edit3 className="size-4" aria-hidden="true" />
                    <span>{t("common.edit")}</span>
                  </Link>
                </Button>
              </>
            )}

            {/* Owner-only Share action (hidden from editor & viewer roles — fixes SH-037) */}
            {isOwner && (
              <Button size="sm" variant="outline" onClick={() => setShareOpen(true)}>
                <Share2 className="size-4" aria-hidden="true" />
                <span>{vi ? "Chia sẻ" : "Share"}</span>
              </Button>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline">
                  <Download className="size-4" aria-hidden="true" />
                  <span>{t("library.exportSet")}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {(["json", "xlsx", "csv", "txt"] as const).map((fmt) => (
                  <DropdownMenuItem key={fmt} asChild>
                    <a href={`/api/sets/${setId}/export?format=${fmt}`} download>
                      {vi ? `Tải xuống ${fmt.toUpperCase()}` : `Download ${fmt.toUpperCase()}`}
                    </a>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              size="sm"
              variant="secondary"
              disabled={duplicateMutation.isPending}
              onClick={() => duplicateMutation.mutate()}
            >
              <Copy className="size-4" aria-hidden="true" />
              <span>{t("library.duplicateSet")}</span>
            </Button>
          </>
        }
      />

      {/* Metadata Badges */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant="secondary" className="font-mono tabular-nums">
          {studySet.question_count} {vi ? "câu hỏi" : "questions"}
        </Badge>
        {studySet.subject && <Badge variant="outline">{studySet.subject}</Badge>}
        <Badge variant="outline">
          <Clock className="size-3" aria-hidden="true" />
          <span>
            {studySet.default_exam_duration_minutes} {vi ? "phút" : "min"}
          </span>
        </Badge>
        <span className="text-muted-foreground">
          {vi ? "Cập nhật: " : "Updated: "}
          {formatRelativeTime(studySet.updated_at, locale)}
        </span>
      </div>

      {/* 1-Click Study & Exam Mode Launchers */}
      <section aria-labelledby="study-modes-heading" className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 id="study-modes-heading" className="text-foreground text-sm font-semibold">
            {vi ? "Chế độ học & Thi thử" : "Study & Exam Modes"}
          </h2>
          {!hasQuestions && (
            <span className="text-muted-foreground text-xs">
              {vi
                ? "Thêm câu hỏi để mở khóa các chế độ học."
                : "Add questions to unlock study modes."}
            </span>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {modeCards.map((mode) => {
            const Icon = mode.icon;
            if (!hasQuestions) {
              return (
                <button
                  key={mode.href}
                  type="button"
                  disabled
                  className="border-border bg-card flex min-h-24 flex-col justify-between gap-2 rounded-xl border p-4 text-left opacity-55"
                >
                  <div className="bg-primary/10 text-primary flex size-9 items-center justify-center rounded-lg">
                    <Icon className="size-4" aria-hidden="true" />
                  </div>
                  <div>
                    <p className="text-foreground text-sm font-semibold">{mode.title}</p>
                    <p className="text-muted-foreground text-xs">{mode.subtitle}</p>
                  </div>
                </button>
              );
            }
            return (
              <Link
                key={mode.href}
                href={mode.href}
                className="border-border bg-card hover:border-primary/50 hover:bg-accent/40 group flex min-h-24 flex-col justify-between gap-2 rounded-xl border p-4 transition-colors"
              >
                <div className="bg-primary/10 text-primary flex size-9 items-center justify-center rounded-lg">
                  <Icon className="size-4" aria-hidden="true" />
                </div>
                <div>
                  <p className="text-foreground text-sm font-semibold">{mode.title}</p>
                  <p className="text-muted-foreground text-xs">{mode.subtitle}</p>
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Virtualized Question Bank Preview */}
      <section aria-labelledby="question-bank-heading" className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 id="question-bank-heading" className="text-foreground text-base font-semibold">
            {vi ? "Ngân hàng câu hỏi" : "Question Bank"}{" "}
            <span className="text-muted-foreground font-mono text-sm font-normal tabular-nums">
              ({totalQuestionsMatched.toLocaleString()})
            </span>
          </h2>

          <div className="flex flex-wrap items-center gap-2">
            <search className="relative w-full sm:w-56">
              <Search
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
                aria-hidden="true"
              />
              <Input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={vi ? "Tìm trong câu hỏi..." : "Search questions..."}
                aria-label={vi ? "Tìm trong câu hỏi" : "Search questions"}
                className="h-9 pl-9"
              />
            </search>

            {chapters.length > 0 && (
              <Select
                value={chapterFilter}
                onValueChange={(v) => {
                  setChapterFilter(v);
                  setPage(1);
                }}
              >
                <SelectTrigger className="h-9 w-44" aria-label={vi ? "Lọc theo chương" : "Filter chapter"}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {vi ? "Tất cả chương" : "All chapters"}
                  </SelectItem>
                  {chapters.map((ch) => (
                    <SelectItem key={ch} value={ch}>
                      {ch}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            <Button
              size="sm"
              variant={starredOnly ? "secondary" : "outline"}
              onClick={() => {
                setStarredOnly((prev) => !prev);
                setPage(1);
              }}
              aria-pressed={starredOnly}
            >
              <Star
                className={cn("size-4", starredOnly && "fill-warning text-warning")}
                aria-hidden="true"
              />
              <span>{vi ? "Đã đánh dấu" : "Starred"}</span>
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowAnswers((prev) => !prev)}
              aria-pressed={showAnswers}
            >
              {showAnswers ? (
                <EyeOff className="size-4" aria-hidden="true" />
              ) : (
                <Eye className="size-4" aria-hidden="true" />
              )}
              <span>
                {showAnswers
                  ? vi
                    ? "Ẩn đáp án"
                    : "Hide answers"
                  : vi
                    ? "Hiện đáp án"
                    : "Show answers"}
              </span>
            </Button>
          </div>
        </div>

        {questionsQuery.isLoading ? (
          <Skeleton className="h-80 w-full rounded-xl" />
        ) : questions.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title={
              debouncedSearch || chapterFilter !== "all" || starredOnly
                ? vi
                  ? "Không tìm thấy câu hỏi phù hợp"
                  : "No matching questions"
                : vi
                  ? "Học phần chưa có câu hỏi nào"
                  : "This study set has no questions yet"
            }
            description={
              debouncedSearch || chapterFilter !== "all" || starredOnly
                ? vi
                  ? "Thử xóa bộ lọc hoặc từ khóa tìm kiếm."
                  : "Try clearing your search or filter criteria."
                : vi
                  ? "Nhập hàng trăm câu hỏi từ file Word, Excel, CSV, TXT hoặc thêm thủ công ngay."
                  : "Bulk import questions from DOCX, XLSX, CSV, or TXT, or add them manually."
            }
            action={
              canEdit ? (
                <Button asChild>
                  <Link href={`/sets/${setId}/import`}>
                    <Upload className="size-4" aria-hidden="true" />
                    <span>{t("library.importSet")}</span>
                  </Link>
                </Button>
              ) : undefined
            }
            secondaryAction={
              canEdit ? (
                <Button variant="outline" asChild>
                  <Link href={`/sets/${setId}/edit`}>
                    <Edit3 className="size-4" aria-hidden="true" />
                    <span>{vi ? "Thêm thủ công" : "Add manually"}</span>
                  </Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Card>
            <CardContent className="p-0">
              <div
                ref={listParentRef}
                className="max-h-[640px] overflow-y-auto p-3 sm:p-4"
                role="list"
                aria-label={vi ? "Danh sách câu hỏi" : "Question list"}
              >
                <div
                  style={{
                    height: `${rowVirtualizer.getTotalSize()}px`,
                    width: "100%",
                    position: "relative",
                  }}
                >
                  {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                    const q = questions[virtualRow.index];
                    if (!q) return null;
                    const isStarred = starredSet.has(q.id);
                    const globalIdx = (page - 1) * 500 + virtualRow.index + 1;

                    return (
                      <div
                        key={q.id}
                        data-index={virtualRow.index}
                        ref={rowVirtualizer.measureElement}
                        role="listitem"
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          transform: `translateY(${virtualRow.start}px)`,
                        }}
                        className="pb-3"
                      >
                        <div className="border-border bg-background rounded-xl border p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1 space-y-1.5">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="bg-secondary text-foreground rounded px-1.5 py-0.5 font-mono text-xs font-semibold tabular-nums">
                                  #{globalIdx}
                                </span>
                                {q.chapter && (
                                  <Badge variant="outline">{q.chapter}</Badge>
                                )}
                                <Badge variant="secondary">
                                  {t(`difficulty.${q.difficulty}`)}
                                </Badge>
                                <Badge variant="outline">
                                  {t(`questionType.${q.question_type}`)}
                                </Badge>
                              </div>
                              <p className="text-foreground text-sm leading-relaxed font-medium whitespace-pre-wrap">
                                {q.prompt}
                              </p>
                            </div>

                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={
                                isStarred
                                  ? `${t("study.unstarQuestion")} #${globalIdx}`
                                  : `${t("study.starQuestion")} #${globalIdx}`
                              }
                              aria-pressed={isStarred}
                              onClick={() =>
                                starMutation.mutate({ questionId: q.id, isStarred })
                              }
                            >
                              <Star
                                className={cn(
                                  "size-4",
                                  isStarred
                                    ? "fill-warning text-warning"
                                    : "text-muted-foreground",
                                )}
                                aria-hidden="true"
                              />
                            </Button>
                          </div>

                          {/* Options or Flashcard Back */}
                          {q.options && q.options.length > 0 ? (
                            <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
                              {q.options.map((opt, idx) => {
                                const letter = String.fromCharCode(65 + idx);
                                const highlightCorrect = showAnswers && opt.is_correct;
                                return (
                                  <li
                                    key={opt.id}
                                    className={cn(
                                      "flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-relaxed",
                                      highlightCorrect
                                        ? "border-success/40 bg-success-subtle text-success-subtle-foreground font-medium"
                                        : "border-border bg-card text-foreground",
                                    )}
                                  >
                                    <span className="font-mono font-semibold">
                                      {letter}.
                                    </span>
                                    <span className="flex-1 whitespace-pre-wrap">
                                      {opt.content}
                                    </span>
                                    {highlightCorrect && (
                                      <CheckCircle2
                                        className="mt-0.5 size-3.5 shrink-0"
                                        aria-label={t("study.correctAnswer")}
                                      />
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          ) : q.back_text && showAnswers ? (
                            <div className="border-success/30 bg-success-subtle text-success-subtle-foreground mt-3 rounded-lg border px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap">
                              {q.back_text}
                            </div>
                          ) : null}

                          {showAnswers && q.explanation && (
                            <p className="text-muted-foreground mt-2.5 text-xs leading-relaxed">
                              <span className="text-foreground font-semibold">
                                {t("study.explanation")}:{" "}
                              </span>
                              {q.explanation}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {totalPages > 1 && (
                <div className="border-border flex items-center justify-between border-t px-4 py-3 text-xs">
                  <span className="text-muted-foreground font-mono tabular-nums">
                    {vi
                      ? `Trang ${page} / ${totalPages}`
                      : `Page ${page} of ${totalPages}`}
                  </span>
                  <div className="flex items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      {t("common.previous")}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    >
                      {t("common.next")}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </section>

      {isOwner && (
        <ShareDialog
          studySet={studySet}
          open={shareOpen}
          onOpenChange={setShareOpen}
        />
      )}
    </FadeIn>
  );
}
