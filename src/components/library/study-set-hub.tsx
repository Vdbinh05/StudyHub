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
  FileText,
  Flag,
  Image as ImageIcon,
  Layers,
  PenLine,
  Play,
  Repeat,
  RotateCcw,
  Search,
  Share2,
  Shuffle,
  Star,
  Upload,
  Volume2,
} from "lucide-react";
import { toast } from "sonner";
import { PdfExportDialog } from "@/components/editor/PdfExportDialog";
import { ReportsInboxPanel } from "@/components/editor/ReportsInboxPanel";
import {
  apiFetch,
  formatRelativeTime,
  getFriendlyErrorMessage,
  isSupabaseConfiguredClient,
} from "@/components/layout/api-client";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { ResetProgressDialog } from "@/components/learning/ResetProgressDialog";
import { ResumeSessionBanner } from "@/components/learning/ResumeSessionBanner";
import { ZoomableImage } from "@/components/media/ImageLightbox";
import { FadeIn } from "@/components/motion";
import { OfflineDownloadButton } from "@/components/pwa/OfflineDownloadButton";
import { useOptionalPwa } from "@/components/pwa/PwaProvider";
import { RichContentRenderer } from "@/components/richtext/RichContentRenderer";
import { ShareDialog } from "@/components/social/share-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
import {
  getCompatibleModesForQuestion,
  QUESTION_TYPE_REGISTRY,
} from "@/lib/questions";
import { cn } from "@/lib/utils";
import type {
  DiagramSet,
  LearningSessionCheckpoint,
  MemberRole,
  Question,
  StudySet,
  V3StudyMode,
} from "@/types/domain";

interface StudySetDetailResponse extends StudySet {
  role?: MemberRole;
  chapters?: Array<string | { name: string; count: number }>;
  can_edit?: boolean;
}

interface StarredRow {
  question_id?: string;
  question?: { id: string };
}

interface ModeCardSpec {
  id: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle: string;
  available: boolean;
  disabledReason?: string;
  badgeText?: string;
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

function resolveSetCheckpointHref(
  setId: string,
  checkpoint: LearningSessionCheckpoint,
  fresh = false,
): string {
  const qs = fresh ? "?fresh=1" : "";
  if (checkpoint.mode === "diagram") return `/sets/${setId}/diagrams`;
  if (checkpoint.mode === "custom_practice") return `/practice${qs}`;
  if (checkpoint.mode === "review") return `/review${qs}`;
  return `/sets/${setId}/${checkpoint.mode}${qs}`;
}

export function StudySetHub({ setId }: { setId: string }) {
  const { locale, t } = useI18n();
  const vi = locale === "vi";
  const router = useRouter();
  const queryClient = useQueryClient();
  const configured = isSupabaseConfiguredClient();
  const pwa = useOptionalPwa();

  const [shareOpen, setShareOpen] = React.useState(false);
  const [pdfExportOpen, setPdfExportOpen] = React.useState(false);
  const [resetOpen, setResetOpen] = React.useState(false);
  const [reportsOpen, setReportsOpen] = React.useState(false);

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
    queryKey: [
      "set-questions",
      setId,
      page,
      debouncedSearch,
      chapterFilter,
      starredOnly,
    ],
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

  const diagramsQuery = useQuery<DiagramSet[]>({
    queryKey: ["set-diagrams", setId],
    enabled: configured && Boolean(setQuery.data),
    staleTime: 30_000,
    queryFn: async () => {
      try {
        const res = await apiFetch<{ diagrams?: DiagramSet[] } | DiagramSet[]>(
          `/api/sets/${setId}/diagrams`,
        );
        if (Array.isArray(res.data)) return res.data;
        return Array.isArray(res.data?.diagrams) ? res.data.diagrams : [];
      } catch {
        return [];
      }
    },
  });

  const checkpointsQuery = useQuery<LearningSessionCheckpoint[]>({
    queryKey: ["set-checkpoints", setId],
    enabled: configured && Boolean(setQuery.data),
    staleTime: 15_000,
    queryFn: async () => {
      try {
        const res = await apiFetch<LearningSessionCheckpoint[]>(
          `/api/checkpoints?studySetId=${encodeURIComponent(setId)}&limit=3`,
        );
        return Array.isArray(res.data) ? res.data : [];
      } catch {
        return [];
      }
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

  const discardCheckpointMutation = useMutation({
    mutationFn: async (checkpointId: string) => {
      await apiFetch(`/api/checkpoints?id=${encodeURIComponent(checkpointId)}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["set-checkpoints", setId] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(vi ? "Đã bỏ phiên học dở." : "In-progress session discarded.");
    },
    onError: (err) => {
      toast.error(getFriendlyErrorMessage(err, locale));
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
      const prev = queryClient.getQueryData<StudySetDetailResponse>([
        "study-set",
        setId,
      ]);
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
    mutationFn: async ({
      questionId,
      isStarred,
    }: {
      questionId: string;
      isStarred: boolean;
    }) => {
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
      toast.success(
        vi ? "Đã nhân bản học phần." : "Study set cloned to your library.",
      );
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
  const diagrams = React.useMemo(
    () => diagramsQuery.data ?? [],
    [diagramsQuery.data],
  );
  const checkpoints = React.useMemo(
    () => checkpointsQuery.data ?? [],
    [checkpointsQuery.data],
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

  // Deterministic mode compatibility evaluation across current question bank (§31)
  const compatibility = React.useMemo(() => {
    const counts = {
      flashcards: 0,
      learn: 0,
      practice: 0,
      write: 0,
      spell: 0,
      match: 0,
      exam: 0,
    };
    let hasRequiredMedia = diagrams.length > 0;
    let estimatedMediaCount = diagrams.length;

    for (const q of questions) {
      const modes = getCompatibleModesForQuestion({
        id: q.id,
        question_type: q.question_type,
        prompt: q.prompt,
        prompt_rich: q.prompt_rich,
        prompt_image_url: q.prompt_image_url,
        back_text: q.back_text,
        back_rich: q.back_rich,
        explanation: q.explanation,
        hint: q.hint,
        audio_url: q.audio_url,
        audio_media_id: q.audio_media_id,
        audio_transcript: q.audio_transcript,
        passage_id: q.passage_id,
        diagram_id: q.diagram_id,
        type_payload: q.type_payload,
        options: q.options,
        accepted_answers: q.accepted_answers,
      });

      if (modes.includes("flashcards")) counts.flashcards += 1;
      if (modes.includes("learn")) counts.learn += 1;
      if (modes.includes("practice")) counts.practice += 1;
      if (modes.includes("write")) counts.write += 1;
      if (modes.includes("spell")) counts.spell += 1;
      if (modes.includes("match")) counts.match += 1;
      if (QUESTION_TYPE_REGISTRY[q.question_type]?.isExamCompatible) {
        counts.exam += 1;
      }

      if (
        q.question_type === "image_choice" ||
        q.question_type === "image_hotspot" ||
        q.question_type === "listening" ||
        (Boolean(q.prompt_image_url) && !q.prompt.trim())
      ) {
        hasRequiredMedia = true;
      }
      if (q.prompt_image_url) estimatedMediaCount += 1;
      if (q.back_image_url) estimatedMediaCount += 1;
      if (q.audio_url) estimatedMediaCount += 1;
      for (const opt of q.options ?? []) {
        if (opt.image_url) {
          estimatedMediaCount += 1;
          if (!opt.content.trim()) hasRequiredMedia = true;
        }
      }
    }

    return {
      counts,
      hasRequiredMedia,
      estimatedMediaCount,
      evaluatedFromUnfiltered:
        !debouncedSearch && chapterFilter === "all" && !starredOnly && questions.length > 0,
    };
  }, [questions, diagrams.length, debouncedSearch, chapterFilter, starredOnly]);

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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
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
    isOwner || studySet.role === "editor" || studySet.can_edit === true;
  const hasQuestions = studySet.question_count > 0 || questions.length > 0;
  const isFavorite = Boolean(studySet.is_favorite);
  const diagramCount = diagrams.length;

  const evalReady = compatibility.evaluatedFromUnfiltered;
  const emptyBankReason = vi
    ? "Thêm câu hỏi để mở khóa chế độ này."
    : "Add questions to unlock this mode.";

  const modeCards: ModeCardSpec[] = [
    {
      id: "flashcards",
      href: `/sets/${setId}/flashcards`,
      icon: Layers,
      title: t("study.flashcards"),
      subtitle: vi ? "Thẻ ghi nhớ, âm thanh & phím tắt" : "Rich cards, audio & shortcuts",
      available: hasQuestions && (!evalReady || compatibility.counts.flashcards > 0),
      disabledReason: hasQuestions
        ? t("study.modeUnavailableInsufficientItems")
        : emptyBankReason,
    },
    {
      id: "learn",
      href: `/sets/${setId}/learn`,
      icon: Repeat,
      title: t("study.learn"),
      subtitle: vi ? "Học sâu 5 giai đoạn & SM-2" : "5-stage adaptive & SM-2",
      available: hasQuestions && (!evalReady || compatibility.counts.learn > 0),
      disabledReason: hasQuestions
        ? t("study.modeUnavailableInsufficientItems")
        : emptyBankReason,
    },
    {
      id: "practice",
      href: `/sets/${setId}/practice`,
      icon: Play,
      title: t("study.practice"),
      subtitle: vi ? "Chấm ngay, giải thích & ghi chú" : "Instant check, notes & hints",
      available: hasQuestions && (!evalReady || compatibility.counts.practice > 0),
      disabledReason: hasQuestions
        ? t("study.modeUnavailableInsufficientItems")
        : emptyBankReason,
    },
    {
      id: "write",
      href: `/sets/${setId}/write`,
      icon: PenLine,
      title: t("study.write"),
      subtitle: vi ? "Gõ câu trả lời & so khớp" : "Typed recall & matching",
      available: hasQuestions && (!evalReady || compatibility.counts.write > 0),
      disabledReason: hasQuestions
        ? vi
          ? "Cần câu hỏi có đáp án văn bản hoặc số (không áp dụng cho câu chỉ có ảnh)."
          : "Requires text or numerical answers (unavailable for image-only items)."
        : emptyBankReason,
    },
    {
      id: "spell",
      href: `/sets/${setId}/spell`,
      icon: Volume2,
      title: t("study.spell"),
      subtitle: vi ? "Nghe phát âm / TTS & gõ lại" : "Listen & type spelling drill",
      available: hasQuestions && (!evalReady || compatibility.counts.spell > 0),
      disabledReason: hasQuestions ? t("study.modeUnavailableNoAudio") : emptyBankReason,
    },
    {
      id: "match",
      href: `/sets/${setId}/match`,
      icon: Shuffle,
      title: t("study.match"),
      subtitle: vi ? "Ghép cặp tính giờ" : "Timed pair matching",
      available: hasQuestions && (!evalReady || compatibility.counts.match >= 2),
      disabledReason: hasQuestions
        ? vi
          ? "Cần ít nhất 2 câu hỏi tương thích để ghép cặp."
          : "Requires at least 2 compatible items for matching."
        : emptyBankReason,
    },
    {
      id: "diagram",
      href: `/sets/${setId}/diagrams`,
      icon: ImageIcon,
      title: t("study.diagram"),
      subtitle:
        diagramCount > 0
          ? vi
            ? "6 chế độ học nhãn trên sơ đồ"
            : "6 interactive diagram study modes"
          : canEdit
            ? vi
              ? "Tạo sơ đồ đầu tiên cho học phần"
              : "Create the first diagram"
            : vi
              ? "Chưa có sơ đồ nào"
              : "No diagrams yet",
      available: diagramCount > 0 || canEdit,
      disabledReason: t("study.modeUnavailableNoDiagrams"),
      badgeText:
        diagramCount > 0
          ? vi
            ? `${diagramCount} sơ đồ`
            : `${diagramCount} diagram${diagramCount > 1 ? "s" : ""}`
          : canEdit
            ? vi
              ? "Tạo mới"
              : "Create"
            : undefined,
    },
    {
      id: "test",
      href: `/sets/${setId}/test`,
      icon: FileCheck2,
      title: t("study.exam"),
      subtitle: vi ? "Thi thử bấm giờ chuẩn" : "Timed mock exam",
      available: hasQuestions && (!evalReady || compatibility.counts.exam > 0),
      disabledReason: hasQuestions
        ? vi
          ? "Thi thử yêu cầu câu hỏi có đáp án chấm điểm (ngoài thẻ flashcard đơn thuần)."
          : "Mock exams require gradable questions beyond standalone flashcards."
        : emptyBankReason,
    },
  ];

  const totalPages = Math.max(1, Math.ceil(totalQuestionsMatched / 500));

  return (
    <FadeIn aboveFold className="space-y-6">
      <PageHeader
        title={studySet.title}
        description={studySet.description ?? undefined}
        stackActions
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

            <OfflineDownloadButton
              setId={setId}
              setTitle={studySet.title}
              chapters={chapters}
              questionCount={studySet.question_count}
              estimatedMediaCount={compatibility.estimatedMediaCount}
              hasRequiredMedia={compatibility.hasRequiredMedia}
              variant="outline"
              size="sm"
            />

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
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setReportsOpen(true)}
                >
                  <Flag className="size-4" aria-hidden="true" />
                  <span className="hidden sm:inline">{t("reports.manageReports")}</span>
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
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={() => setPdfExportOpen(true)}>
                  <FileText className="size-4" aria-hidden="true" />
                  <span>{t("v3ImportExport.exportPdfTitle")}</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {(["json", "xlsx", "csv", "txt"] as const).map((fmt) => (
                  <DropdownMenuItem key={fmt} asChild>
                    <a href={`/api/sets/${setId}/export?format=${fmt}`} download>
                      {vi
                        ? `Tải xuống ${fmt.toUpperCase()}`
                        : `Download ${fmt.toUpperCase()}`}
                    </a>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <Button
              size="sm"
              variant="outline"
              onClick={() => setResetOpen(true)}
            >
              <RotateCcw className="size-4" aria-hidden="true" />
              <span className="hidden md:inline">{t("resume.resetTitle")}</span>
            </Button>

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
        {diagramCount > 0 && (
          <Badge variant="secondary" className="font-mono tabular-nums">
            <ImageIcon className="size-3" aria-hidden="true" />
            <span>
              {diagramCount} {vi ? "sơ đồ" : "diagrams"}
            </span>
          </Badge>
        )}
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

      {/* Active Session Checkpoint Resume Banner */}
      {checkpoints.length > 0 && (
        <div className="space-y-2.5">
          {checkpoints.slice(0, 1).map((cp) => (
            <ResumeSessionBanner
              key={cp.id}
              modeLabel={getCheckpointModeLabel(cp.mode, vi)}
              currentIndex={cp.current_index}
              totalItems={cp.total_items}
              progressPercent={cp.progress_percent}
              updatedAt={cp.updated_at}
              source="remote"
              isBusy={discardCheckpointMutation.isPending}
              onContinue={() =>
                router.push(resolveSetCheckpointHref(setId, cp, false))
              }
              onRestart={async () => {
                await discardCheckpointMutation.mutateAsync(cp.id).catch(() => {});
                router.push(resolveSetCheckpointHref(setId, cp, true));
              }}
              onDiscard={() => discardCheckpointMutation.mutate(cp.id)}
            />
          ))}
        </div>
      )}

      {/* 8 Compatibility-Gated Study & Exam Mode Launchers */}
      <section aria-labelledby="study-modes-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="study-modes-heading" className="text-foreground text-sm font-semibold">
            {vi ? "8 Chế độ học & Thi thử" : "8 Study & Exam Modes"}
          </h2>
          {!hasQuestions && diagramCount === 0 && (
            <span className="text-muted-foreground text-xs">
              {vi
                ? "Thêm câu hỏi hoặc sơ đồ để mở khóa các chế độ học."
                : "Add questions or diagrams to unlock study modes."}
            </span>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {modeCards.map((mode) => {
            const Icon = mode.icon;
            if (!mode.available) {
              return (
                <button
                  key={mode.id}
                  type="button"
                  disabled
                  title={mode.disabledReason}
                  className="border-border bg-card flex min-h-24 flex-col justify-between gap-2 rounded-xl border p-4 text-left opacity-60"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="bg-muted text-muted-foreground flex size-9 items-center justify-center rounded-lg">
                      <Icon className="size-4" aria-hidden="true" />
                    </div>
                    <Badge variant="outline" className="text-[10px]">
                      {vi ? "Chưa khả dụng" : "Unavailable"}
                    </Badge>
                  </div>
                  <div className="space-y-0.5">
                    <p className="text-foreground text-sm font-semibold">{mode.title}</p>
                    <p className="text-muted-foreground text-xs leading-snug">
                      {mode.disabledReason ?? mode.subtitle}
                    </p>
                  </div>
                </button>
              );
            }
            return (
              <Link
                key={mode.id}
                href={mode.href}
                className="border-border bg-card hover:border-primary/50 hover:bg-accent/40 group flex min-h-24 flex-col justify-between gap-2 rounded-xl border p-4 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="bg-primary/10 text-primary flex size-9 items-center justify-center rounded-lg">
                    <Icon className="size-4" aria-hidden="true" />
                  </div>
                  {mode.badgeText && (
                    <Badge variant="secondary" className="text-[11px]">
                      {mode.badgeText}
                    </Badge>
                  )}
                </div>
                <div className="space-y-0.5">
                  <p className="text-foreground text-sm font-semibold">{mode.title}</p>
                  <p className="text-muted-foreground text-xs leading-snug">
                    {mode.subtitle}
                  </p>
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
                <SelectTrigger
                  className="h-9 w-44"
                  aria-label={vi ? "Lọc theo chương" : "Filter chapter"}
                >
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
                  ? "Nhập hàng trăm câu hỏi từ file Word, PDF, Excel, CSV, TXT hoặc thêm thủ công ngay."
                  : "Bulk import questions from DOCX, PDF, XLSX, CSV, or TXT, or add them manually."
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
                              {(q.prompt || q.prompt_rich) && (
                                <div className="text-foreground text-sm leading-relaxed font-medium">
                                  <RichContentRenderer
                                    richDoc={q.prompt_rich}
                                    plainText={q.prompt}
                                    enableMathInPlainText
                                  />
                                </div>
                              )}
                              {q.prompt_image_url && (
                                <ZoomableImage
                                  src={q.prompt_image_url}
                                  alt={
                                    q.prompt?.trim().slice(0, 120) ||
                                    (vi
                                      ? `Hình minh họa câu hỏi #${globalIdx}`
                                      : `Question #${globalIdx} image`)
                                  }
                                  aspectClassName="max-h-56"
                                  className="mt-2"
                                />
                              )}
                              {q.audio_url && (
                                <audio
                                  controls
                                  preload="none"
                                  src={q.audio_url}
                                  aria-label={
                                    vi
                                      ? `Âm thanh câu hỏi #${globalIdx}`
                                      : `Audio for question #${globalIdx}`
                                  }
                                  className="mt-2 h-9 max-w-full"
                                />
                              )}
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
                                    <span className="min-w-0 flex-1 space-y-1.5">
                                      {(opt.content || opt.content_rich) && (
                                        <RichContentRenderer
                                          richDoc={opt.content_rich}
                                          plainText={opt.content}
                                          inline
                                          enableMathInPlainText
                                        />
                                      )}
                                      {opt.image_url && (
                                        <ZoomableImage
                                          src={opt.image_url}
                                          alt={
                                            opt.content?.trim().slice(0, 80) ||
                                            (vi
                                              ? `Ảnh phương án ${letter}`
                                              : `Option ${letter} image`)
                                          }
                                          aspectClassName="max-h-28"
                                          className="block"
                                        />
                                      )}
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
                          ) : (q.back_text || q.back_rich || q.back_image_url) && showAnswers ? (
                            <div className="border-success/30 bg-success-subtle text-success-subtle-foreground mt-3 space-y-2 rounded-lg border px-3 py-2 text-xs leading-relaxed">
                              {(q.back_text || q.back_rich) && (
                                <RichContentRenderer
                                  richDoc={q.back_rich}
                                  plainText={q.back_text ?? ""}
                                  enableMathInPlainText
                                />
                              )}
                              {q.back_image_url && (
                                <ZoomableImage
                                  src={q.back_image_url}
                                  alt={
                                    vi
                                      ? `Ảnh mặt sau câu #${globalIdx}`
                                      : `Back image for card #${globalIdx}`
                                  }
                                  aspectClassName="max-h-44"
                                />
                              )}
                            </div>
                          ) : null}

                          {showAnswers && (q.explanation || q.explanation_rich) && (
                            <div className="text-muted-foreground mt-2.5 text-xs leading-relaxed">
                              <span className="text-foreground font-semibold">
                                {t("study.explanation")}:{" "}
                              </span>
                              <RichContentRenderer
                                richDoc={q.explanation_rich}
                                plainText={q.explanation ?? ""}
                                inline
                                enableMathInPlainText
                              />
                            </div>
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

      {/* Modals */}
      {isOwner && (
        <ShareDialog
          studySet={studySet}
          open={shareOpen}
          onOpenChange={setShareOpen}
        />
      )}

      <PdfExportDialog
        studySetId={setId}
        chapter={chapterFilter !== "all" ? chapterFilter : undefined}
        defaultTitle={studySet.title}
        defaultSubject={studySet.subject ?? undefined}
        locale={locale}
        open={pdfExportOpen}
        onOpenChange={setPdfExportOpen}
      />

      <ResetProgressDialog
        open={resetOpen}
        onOpenChange={setResetOpen}
        defaultScope="study_set"
        allowedScopes={
          chapters.length > 0 ? ["study_set", "chapter"] : ["study_set"]
        }
        studySetId={setId}
        studySetTitle={studySet.title}
        subject={studySet.subject ?? undefined}
        chapters={chapters}
        pendingOfflineEventsCount={pwa?.syncSummary?.pendingCount ?? 0}
        onResetComplete={() => {
          queryClient.invalidateQueries({ queryKey: ["study-set", setId] });
          queryClient.invalidateQueries({ queryKey: ["set-checkpoints", setId] });
          queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        }}
      />

      {canEdit && (
        <Dialog open={reportsOpen} onOpenChange={setReportsOpen}>
          <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Flag className="text-primary size-4" aria-hidden="true" />
                <span>{t("reports.manageReports")}</span>
              </DialogTitle>
              <DialogDescription>
                {vi
                  ? "Xem và xử lý các báo lỗi câu hỏi từ bạn học hoặc nhóm chỉnh sửa."
                  : "Review and resolve question issue reports submitted for this study set."}
              </DialogDescription>
            </DialogHeader>
            <ReportsInboxPanel
              studySetId={setId}
              locale={locale}
              onEditQuestion={() => {
                setReportsOpen(false);
                router.push(`/sets/${setId}/edit`);
              }}
            />
          </DialogContent>
        </Dialog>
      )}
    </FadeIn>
  );
}
