"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
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
  MoreHorizontal,
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
import {
  apiFetch,
  formatRelativeTime,
  getFriendlyErrorMessage,
  isSupabaseConfiguredClient,
} from "@/components/layout/api-client";
import { EmptyState } from "@/components/layout/empty-state";
import { ResumeSessionBanner } from "@/components/learning/ResumeSessionBanner";
import { ZoomableImage } from "@/components/media/ImageLightbox";
import { useOptionalPwa } from "@/components/pwa/PwaProvider";
import { RichContentRenderer } from "@/components/richtext/RichContentRenderer";
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
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
  QuestionType,
  StudySet,
  V3StudyMode,
} from "@/types/domain";

const OfflineDownloadButton = dynamic(
  () =>
    import("@/components/pwa/OfflineDownloadButton").then(
      (m) => m.OfflineDownloadButton,
    ),
  {
    ssr: false,
    loading: () => (
      <Skeleton className="h-11 w-full rounded-md sm:h-9 sm:w-48" />
    ),
  },
);

const ShareDialog = dynamic(
  () => import("@/components/social/share-dialog").then((m) => m.ShareDialog),
  { ssr: false },
);

const PdfExportDialog = dynamic(
  () =>
    import("@/components/editor/PdfExportDialog").then(
      (m) => m.PdfExportDialog,
    ),
  { ssr: false },
);

const ResetProgressDialog = dynamic(
  () =>
    import("@/components/learning/ResetProgressDialog").then(
      (m) => m.ResetProgressDialog,
    ),
  { ssr: false },
);

const ReportsInboxPanel = dynamic(
  () =>
    import("@/components/editor/ReportsInboxPanel").then(
      (m) => m.ReportsInboxPanel,
    ),
  {
    ssr: false,
    loading: () => <Skeleton className="h-48 w-full rounded-lg" />,
  },
);

const PAGE_SIZE = 50;

interface StudySetDetailResponse extends StudySet {
  role?: MemberRole;
  chapters?: Array<string | { name: string; count: number }>;
  question_type_counts?: Record<string, number>;
  can_edit?: boolean;
}

interface HubQuestion extends Question {
  is_starred?: boolean;
}

interface QuestionsPageData {
  items: HubQuestion[];
  total: number;
  hasMore: boolean;
}

interface ModeSpec {
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

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  // Fire all 4 queries in parallel immediately (eliminates the V3.0 2-RTT waterfall)
  const setQuery = useQuery<StudySetDetailResponse>({
    queryKey: ["study-set", setId],
    enabled: configured,
    queryFn: async () => {
      const res = await apiFetch<StudySetDetailResponse>(`/api/sets/${setId}`);
      return res.data;
    },
  });

  const questionsQueryKey = React.useMemo(
    () =>
      [
        "set-questions",
        setId,
        page,
        debouncedSearch,
        chapterFilter,
        starredOnly,
      ] as const,
    [setId, page, debouncedSearch, chapterFilter, starredOnly],
  );

  const questionsQuery = useQuery<QuestionsPageData>({
    queryKey: questionsQueryKey,
    enabled: configured,
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", String(PAGE_SIZE));
      params.set("fields", "summary");
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (chapterFilter !== "all") params.set("chapter", chapterFilter);
      if (starredOnly) params.set("starredOnly", "true");
      const res = await apiFetch<HubQuestion[]>(
        `/api/sets/${setId}/questions?${params.toString()}`,
      );
      const items = Array.isArray(res.data) ? res.data : [];
      const total = Number(res.meta?.total ?? items.length);
      return {
        items,
        total,
        hasMore: Boolean(res.meta?.hasMore ?? page * PAGE_SIZE < total),
      };
    },
  });

  const diagramsQuery = useQuery<DiagramSet[]>({
    queryKey: ["set-diagrams", setId],
    enabled: configured,
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
    enabled: configured,
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

  // Optimistic star toggling directly against `?fields=summary` `is_starred` (zero `/api/starred` loop!)
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
      await queryClient.cancelQueries({ queryKey: questionsQueryKey });
      const prev = queryClient.getQueryData<QuestionsPageData>(questionsQueryKey);
      if (prev) {
        queryClient.setQueryData<QuestionsPageData>(questionsQueryKey, {
          ...prev,
          items: prev.items.map((item) =>
            item.id === questionId ? { ...item, is_starred: !isStarred } : item,
          ),
        });
      }
      return { prev };
    },
    onError: (err, __, ctx) => {
      if (ctx?.prev) {
        queryClient.setQueryData(questionsQueryKey, ctx.prev);
      }
      toast.error(getFriendlyErrorMessage(err, locale));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["set-questions", setId] });
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

  const isFiltered =
    Boolean(debouncedSearch) || chapterFilter !== "all" || starredOnly;
  const totalQuestionsMatched = questionsQuery.data?.total ?? 0;

  const rawChapters = setQuery.data?.chapters;
  const chapters = React.useMemo(() => {
    const discovered = new Set<string>();
    if (Array.isArray(rawChapters)) {
      for (const ch of rawChapters) {
        const name = typeof ch === "string" ? ch : ch.name;
        if (name) discovered.add(name);
      }
      return Array.from(discovered);
    }
    for (const q of questions) {
      if (q.chapter) discovered.add(q.chapter);
    }
    return Array.from(discovered);
  }, [rawChapters, questions]);

  // Deterministic full-bank mode compatibility from `question_type_counts` + loaded sample
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
    const typeCounts = setQuery.data?.question_type_counts;
    const totalCount = setQuery.data?.question_count ?? questions.length;
    const hasFullSample =
      !isFiltered && questions.length > 0 && questions.length >= totalCount;

    let hasAudioItems = false;
    let hasRequiredMedia = diagrams.length > 0;
    let estimatedMediaCount = diagrams.length;

    for (const q of questions) {
      if (q.audio_url || q.audio_media_id || q.question_type === "listening") {
        hasAudioItems = true;
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

    if (hasFullSample) {
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
          passage_id: q.passage_id,
          diagram_id: q.diagram_id,
          options: q.options,
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
      }
    } else if (typeCounts && Object.keys(typeCounts).length > 0) {
      for (const [rawType, rawNum] of Object.entries(typeCounts)) {
        const num = Number(rawNum) || 0;
        if (num <= 0) continue;
        const descriptor = QUESTION_TYPE_REGISTRY[rawType as QuestionType];
        if (!descriptor) continue;
        if (rawType === "listening") hasAudioItems = true;
        if (
          rawType === "image_choice" ||
          rawType === "image_hotspot" ||
          rawType === "listening"
        ) {
          hasRequiredMedia = true;
        }
        if (descriptor.compatibleModes.includes("flashcards")) counts.flashcards += num;
        if (descriptor.compatibleModes.includes("learn")) counts.learn += num;
        if (descriptor.compatibleModes.includes("practice")) counts.practice += num;
        if (descriptor.compatibleModes.includes("write")) counts.write += num;
        if (descriptor.compatibleModes.includes("spell")) counts.spell += num;
        if (descriptor.compatibleModes.includes("match")) counts.match += num;
        if (descriptor.isExamCompatible) counts.exam += num;
      }
    }

    const evaluated =
      hasFullSample ||
      Boolean(typeCounts && Object.keys(typeCounts).length > 0);

    return {
      counts,
      hasAudioItems,
      hasRequiredMedia,
      estimatedMediaCount,
      evaluated,
    };
  }, [
    questions,
    diagrams.length,
    isFiltered,
    setQuery.data?.question_type_counts,
    setQuery.data?.question_count,
  ]);

  if (!configured) {
    return (
      <EmptyState
        icon={AlertCircle}
        title={vi ? "Không thể tải học phần" : "Study set unavailable"}
        description={t("common.serviceUnavailableDesc")}
        action={
          <Button asChild variant="outline">
            <Link href="/library" prefetch={false}>
              {t("library.title")}
            </Link>
          </Button>
        }
      />
    );
  }

  if (setQuery.isLoading) {
    return (
      <div className="space-y-5" aria-busy="true">
        {/* Mirrors rendered Study-First hero header + mobile 2-row / desktop inline action bar */}
        <header className="space-y-3">
          <Skeleton className="h-4 w-40" />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-7 w-72 max-w-full sm:h-8" />
              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                <Skeleton className="h-5 w-20 rounded-md" />
                <Skeleton className="h-5 w-16 rounded-md" />
                <Skeleton className="h-4 w-28" />
              </div>
            </div>
            <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:shrink-0 sm:items-center">
              <Skeleton className="h-11 w-full rounded-md sm:h-9 sm:w-24" />
              <Skeleton className="h-11 w-full rounded-md sm:h-9 sm:w-24" />
              <Skeleton className="col-span-2 h-11 w-full rounded-md sm:col-span-1 sm:h-9 sm:w-48" />
            </div>
          </div>
        </header>

        {/* Mirrors 4 Core Modes section + secondary disclosure bar */}
        <section className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <Skeleton className="h-5 w-28" />
            <Skeleton className="h-11 w-24 rounded-md sm:h-9" />
          </div>
          <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[6.75rem] rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-11 w-full rounded-xl" />
        </section>

        {/* Mirrors Question Bank heading, filter controls, and preview list */}
        <section className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Skeleton className="h-6 w-44" />
            <div className="flex flex-wrap items-center gap-2">
              <Skeleton className="h-11 w-full rounded-md sm:h-9 sm:w-56" />
              <Skeleton className="h-11 w-28 rounded-md sm:h-9" />
              <Skeleton className="h-11 w-28 rounded-md sm:h-9" />
            </div>
          </div>
          <div className="min-h-[28rem] space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-28 w-full rounded-xl" />
            ))}
          </div>
        </section>
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
            <Link href="/library" prefetch={false}>
              {t("library.title")}
            </Link>
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

  const evalReady = compatibility.evaluated;
  const emptyBankReason = vi
    ? "Thêm câu hỏi để mở khóa chế độ này."
    : "Add questions to unlock this mode.";

  // 4 Core Student-First Modes (prominent above the fold)
  const coreModes: ModeSpec[] = [
    {
      id: "flashcards",
      href: `/sets/${setId}/flashcards`,
      icon: Layers,
      title: t("study.flashcards"),
      subtitle: vi ? "Lật thẻ & phím tắt" : "Flip cards & shortcuts",
      available: hasQuestions && (!evalReady || compatibility.counts.flashcards > 0),
      disabledReason: hasQuestions
        ? t("study.modeUnavailableInsufficientItems")
        : emptyBankReason,
    },
    {
      id: "practice",
      href: `/sets/${setId}/practice`,
      icon: Play,
      title: t("study.practice"),
      subtitle: vi ? "Chấm ngay & giải thích" : "Instant feedback & notes",
      available: hasQuestions && (!evalReady || compatibility.counts.practice > 0),
      disabledReason: hasQuestions
        ? t("study.modeUnavailableInsufficientItems")
        : emptyBankReason,
    },
    {
      id: "learn",
      href: `/sets/${setId}/learn`,
      icon: Repeat,
      title: t("study.learn"),
      subtitle: vi ? "Lặp lại ngắt quãng SM-2" : "Adaptive SM-2 mastery",
      available: hasQuestions && (!evalReady || compatibility.counts.learn > 0),
      disabledReason: hasQuestions
        ? t("study.modeUnavailableInsufficientItems")
        : emptyBankReason,
    },
    {
      id: "test",
      href: `/sets/${setId}/test`,
      icon: FileCheck2,
      title: t("study.exam"),
      subtitle: vi ? "Thi thử bấm giờ" : "Timed mock exam",
      available: hasQuestions && (!evalReady || compatibility.counts.exam > 0),
      disabledReason: hasQuestions
        ? vi
          ? "Yêu cầu câu hỏi có đáp án chấm điểm."
          : "Requires gradable questions."
        : emptyBankReason,
    },
  ];

  // Secondary Modes (tucked inside progressive <details> disclosure, auto-surfaced via pill when relevant)
  const secondaryModes: ModeSpec[] = [
    {
      id: "write",
      href: `/sets/${setId}/write`,
      icon: PenLine,
      title: t("study.write"),
      subtitle: vi ? "Gõ đáp án chủ động" : "Typed recall drill",
      available: hasQuestions && (!evalReady || compatibility.counts.write > 0),
      disabledReason: hasQuestions
        ? vi
          ? "Cần câu hỏi có đáp án văn bản hoặc số."
          : "Requires text or numerical answers."
        : emptyBankReason,
    },
    {
      id: "spell",
      href: `/sets/${setId}/spell`,
      icon: Volume2,
      title: t("study.spell"),
      subtitle: vi ? "Nghe phát âm & gõ lại" : "Listen & type spelling",
      available: hasQuestions && (!evalReady || compatibility.counts.spell > 0),
      disabledReason: hasQuestions ? t("study.modeUnavailableNoAudio") : emptyBankReason,
    },
    {
      id: "match",
      href: `/sets/${setId}/match`,
      icon: Shuffle,
      title: t("study.match"),
      subtitle: vi ? "Ghép cặp bấm giờ" : "Timed pair matching",
      available: hasQuestions && (!evalReady || compatibility.counts.match >= 2),
      disabledReason: hasQuestions
        ? vi
          ? "Cần ít nhất 2 câu hỏi tương thích."
          : "Requires at least 2 compatible items."
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
            ? "Học nhãn tương tác trên hình"
            : "Interactive visual diagram study"
          : canEdit
            ? vi
              ? "Tạo sơ đồ tương tác mới"
              : "Create a visual diagram"
            : vi
              ? "Chưa có sơ đồ"
              : "No diagrams yet",
      available: diagramCount > 0 || canEdit,
      disabledReason: t("study.modeUnavailableNoDiagrams"),
      badgeText:
        diagramCount > 0
          ? vi
            ? `${diagramCount} sơ đồ`
            : `${diagramCount} diagram${diagramCount > 1 ? "s" : ""}`
          : undefined,
    },
  ];

  const primaryStudyHref =
    coreModes.find((m) => m.id === "practice" && m.available)?.href ??
    coreModes.find((m) => m.available)?.href ??
    null;

  const totalPages = Math.max(1, Math.ceil(totalQuestionsMatched / PAGE_SIZE));
  const headingCount = questionsQuery.isLoading
    ? !isFiltered && studySet.question_count > 0
      ? studySet.question_count
      : null
    : totalQuestionsMatched;

  return (
    <div className="space-y-5">
      {/* Study-First Hero Header (compact, 3 clean labeled controls — zero 10-button wall) */}
      <header className="space-y-3">
        <nav
          aria-label="Breadcrumb"
          className="text-muted-foreground flex flex-wrap items-center gap-1 text-xs font-medium"
        >
          <Link
            href="/library"
            prefetch={false}
            className="hover:text-foreground transition-colors"
          >
            {t("library.title")}
          </Link>
          <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="text-foreground truncate" aria-current="page">
            {studySet.title}
          </span>
        </nav>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-foreground text-xl font-bold tracking-tight sm:text-2xl">
                {studySet.title}
              </h1>
              {isFavorite && (
                <Star
                  className="fill-warning text-warning size-4 shrink-0"
                  aria-label={t("library.favorites")}
                />
              )}
            </div>
            {studySet.description && (
              <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
                {studySet.description}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2 pt-0.5 text-xs">
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
              {studySet.subject && (
                <Badge variant="outline">{studySet.subject}</Badge>
              )}
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
          </div>

          {/* 3 clean labeled secondary controls: stable 2-row mobile grid / inline desktop (zero CLS on OfflineDownloadButton load) */}
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:shrink-0 sm:flex-wrap sm:items-center">
            {canEdit && (
              <Button
                size="sm"
                variant="outline"
                asChild
                className="min-h-11 w-full sm:min-h-9 sm:w-auto"
              >
                <Link href={`/sets/${setId}/edit`} prefetch={false}>
                  <Edit3 className="size-4" aria-hidden="true" />
                  <span>{t("common.edit")}</span>
                </Link>
              </Button>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className={cn(
                    "min-h-11 w-full sm:order-3 sm:min-h-9 sm:w-auto",
                    !canEdit && "col-span-2 sm:col-span-1",
                  )}
                  aria-label={vi ? "Thao tác khác cho học phần" : "More study set actions"}
                >
                  <MoreHorizontal className="size-4" aria-hidden="true" />
                  <span>{t("common.actions")}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {isOwner && (
                  <DropdownMenuItem
                    onClick={() => favoriteSetMutation.mutate(!isFavorite)}
                  >
                    <Star
                      className={cn(
                        "size-4",
                        isFavorite && "fill-warning text-warning",
                      )}
                      aria-hidden="true"
                    />
                    <span>
                      {isFavorite
                        ? t("library.unfavoriteSet")
                        : t("library.favoriteSet")}
                    </span>
                  </DropdownMenuItem>
                )}

                {canEdit && (
                  <DropdownMenuItem asChild>
                    <Link href={`/sets/${setId}/import`} prefetch={false}>
                      <Upload className="size-4" aria-hidden="true" />
                      <span>{t("library.importSet")}</span>
                    </Link>
                  </DropdownMenuItem>
                )}

                {hasQuestions && (
                  <DropdownMenuItem asChild>
                    <Link href={`/exams/new?setId=${setId}`} prefetch={false}>
                      <FileCheck2 className="size-4" aria-hidden="true" />
                      <span>{t("library.customExamCta")}</span>
                    </Link>
                  </DropdownMenuItem>
                )}

                {isOwner && (
                  <DropdownMenuItem onClick={() => setShareOpen(true)}>
                    <Share2 className="size-4" aria-hidden="true" />
                    <span>{vi ? "Chia sẻ học phần" : "Share study set"}</span>
                  </DropdownMenuItem>
                )}

                <DropdownMenuSeparator />

                <DropdownMenuItem onClick={() => setPdfExportOpen(true)}>
                  <FileText className="size-4" aria-hidden="true" />
                  <span>{t("v3ImportExport.exportPdfTitle")}</span>
                </DropdownMenuItem>

                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Download className="mr-2 size-4" aria-hidden="true" />
                    <span>{t("library.exportSet")}</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {(["json", "xlsx", "csv", "txt"] as const).map((fmt) => (
                      <DropdownMenuItem key={fmt} asChild>
                        <a
                          href={`/api/sets/${setId}/export?format=${fmt}`}
                          download
                        >
                          {vi
                            ? `Tải xuống ${fmt.toUpperCase()}`
                            : `Download ${fmt.toUpperCase()}`}
                        </a>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>

                <DropdownMenuItem
                  disabled={duplicateMutation.isPending}
                  onClick={() => duplicateMutation.mutate()}
                >
                  <Copy className="size-4" aria-hidden="true" />
                  <span>{t("library.duplicateSet")}</span>
                </DropdownMenuItem>

                {canEdit && (
                  <DropdownMenuItem onClick={() => setReportsOpen(true)}>
                    <Flag className="size-4" aria-hidden="true" />
                    <span>{t("reports.manageReports")}</span>
                  </DropdownMenuItem>
                )}

                <DropdownMenuSeparator />

                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => setResetOpen(true)}
                >
                  <RotateCcw className="size-4" aria-hidden="true" />
                  <span>{t("resume.resetTitle")}</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="col-span-2 sm:order-2 sm:col-span-1">
              <OfflineDownloadButton
                setId={setId}
                setTitle={studySet.title}
                chapters={chapters}
                questionCount={studySet.question_count}
                estimatedMediaCount={compatibility.estimatedMediaCount}
                hasRequiredMedia={compatibility.hasRequiredMedia}
                variant="outline"
                size="sm"
                className="min-h-11 w-full sm:min-h-9 sm:w-auto"
              />
            </div>
          </div>
        </div>
      </header>

      {/* Active Session Checkpoint Resume Banner */}
      {checkpoints.length > 0 && (
        <div className="space-y-2">
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
                await discardCheckpointMutation
                  .mutateAsync(cp.id)
                  .catch(() => {});
                router.push(resolveSetCheckpointHref(setId, cp, true));
              }}
              onDiscard={() => discardCheckpointMutation.mutate(cp.id)}
            />
          ))}
        </div>
      )}

      {/* Study-First Action Area: 4 Core Modes Above the Fold + Progressive Disclosure for Secondary Modes */}
      <section aria-labelledby="study-modes-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2
            id="study-modes-heading"
            className="text-foreground text-sm font-semibold"
          >
            {vi ? "Bắt đầu học" : "Start studying"}
          </h2>

          {primaryStudyHref && checkpoints.length === 0 && (
            <Button size="sm" asChild className="min-h-11 sm:min-h-9">
              <Link href={primaryStudyHref} prefetch={false}>
                <Play className="size-3.5" aria-hidden="true" />
                <span>{vi ? "Học ngay" : "Study now"}</span>
              </Link>
            </Button>
          )}
        </div>

        {!hasQuestions && diagramCount === 0 ? (
          <div className="border-border bg-card flex flex-col items-start justify-between gap-3 rounded-xl border p-4 sm:flex-row sm:items-center">
            <p className="text-muted-foreground text-sm">
              {vi
                ? "Thêm câu hỏi hoặc nhập tệp Word/PDF/Excel để mở khóa các chế độ học."
                : "Add questions or import a Word/PDF/Excel file to unlock study modes."}
            </p>
            {canEdit && (
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" asChild>
                  <Link href={`/sets/${setId}/import`} prefetch={false}>
                    <Upload className="size-4" aria-hidden="true" />
                    <span>{t("library.importSet")}</span>
                  </Link>
                </Button>
                <Button size="sm" variant="outline" asChild>
                  <Link href={`/sets/${setId}/edit`} prefetch={false}>
                    <Edit3 className="size-4" aria-hidden="true" />
                    <span>{vi ? "Thêm thủ công" : "Add manually"}</span>
                  </Link>
                </Button>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* 4 Core Study Modes — 2x2 grid on mobile, 4-column on desktop */}
            <div className="grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
              {coreModes.map((mode) => {
                const Icon = mode.icon;
                if (!mode.available) {
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      disabled
                      title={mode.disabledReason}
                      className="border-border bg-card flex min-h-[6.75rem] flex-col justify-between gap-2 rounded-xl border p-3.5 text-left opacity-55 sm:p-4"
                    >
                      <div className="bg-muted text-muted-foreground flex size-8 items-center justify-center rounded-lg">
                        <Icon className="size-4" aria-hidden="true" />
                      </div>
                      <div className="space-y-0.5">
                        <p className="text-foreground text-sm font-semibold">
                          {mode.title}
                        </p>
                        <p className="text-muted-foreground line-clamp-2 text-xs leading-snug">
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
                    prefetch={false}
                    className="border-border bg-card hover:border-primary/50 hover:bg-accent/40 group flex min-h-[6.75rem] flex-col justify-between gap-2 rounded-xl border p-3.5 transition-colors sm:p-4"
                  >
                    <div className="bg-primary/10 text-primary flex size-8 items-center justify-center rounded-lg">
                      <Icon className="size-4" aria-hidden="true" />
                    </div>
                    <div className="space-y-0.5">
                      <p className="text-foreground text-sm font-semibold">
                        {mode.title}
                      </p>
                      <p className="text-muted-foreground line-clamp-2 text-xs leading-snug">
                        {mode.subtitle}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>

            {/* Auto-surfaced Quick Pills for Diagrams / Audio Spell when relevant */}
            {(diagramCount > 0 || compatibility.hasAudioItems) && (
              <div className="flex flex-wrap items-center gap-2">
                {diagramCount > 0 && (
                  <Button size="sm" variant="secondary" asChild>
                    <Link href={`/sets/${setId}/diagrams`} prefetch={false}>
                      <ImageIcon className="size-4" aria-hidden="true" />
                      <span>
                        {t("study.diagram")} ({diagramCount})
                      </span>
                    </Link>
                  </Button>
                )}
                {compatibility.hasAudioItems && (
                  <Button size="sm" variant="secondary" asChild>
                    <Link href={`/sets/${setId}/spell`} prefetch={false}>
                      <Volume2 className="size-4" aria-hidden="true" />
                      <span>{t("study.spell")}</span>
                    </Link>
                  </Button>
                )}
              </div>
            )}

            {/* Progressive Disclosure for Secondary Modes (Write, Spell, Match, Diagrams, Custom Exam) */}
            <details className="group border-border bg-card/60 rounded-xl border px-3.5 py-2.5">
              <summary className="text-foreground flex cursor-pointer list-none items-center justify-between gap-2 py-0.5 text-xs font-medium select-none">
                <span className="flex items-center gap-2">
                  <span>{vi ? "Chế độ học khác" : "More study modes"}</span>
                  <span className="text-muted-foreground font-normal">
                    {vi
                      ? "(Gõ đáp án, Nghe & Gõ, Ghép thẻ, Sơ đồ)"
                      : "(Write, Spell, Match, Diagrams)"}
                  </span>
                </span>
                <ChevronDown
                  className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-180"
                  aria-hidden="true"
                />
              </summary>

              <div className="mt-3 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                {secondaryModes.map((mode) => {
                  const Icon = mode.icon;
                  if (!mode.available) {
                    return (
                      <div
                        key={mode.id}
                        aria-disabled="true"
                        className="border-border bg-background/70 flex flex-col justify-between gap-1.5 rounded-lg border p-3 opacity-60"
                      >
                        <div className="flex items-center gap-2">
                          <Icon
                            className="text-muted-foreground size-4 shrink-0"
                            aria-hidden="true"
                          />
                          <p className="text-foreground text-xs font-semibold">
                            {mode.title}
                          </p>
                        </div>
                        <p className="text-muted-foreground text-[11px] leading-snug">
                          {mode.disabledReason ?? mode.subtitle}
                        </p>
                      </div>
                    );
                  }
                  return (
                    <Link
                      key={mode.id}
                      href={mode.href}
                      prefetch={false}
                      className="border-border bg-background hover:border-primary/50 hover:bg-accent/40 flex flex-col justify-between gap-1.5 rounded-lg border p-3 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Icon
                            className="text-primary size-4 shrink-0"
                            aria-hidden="true"
                          />
                          <p className="text-foreground text-xs font-semibold">
                            {mode.title}
                          </p>
                        </div>
                        {mode.badgeText && (
                          <Badge variant="secondary" className="text-[10px]">
                            {mode.badgeText}
                          </Badge>
                        )}
                      </div>
                      <p className="text-muted-foreground text-[11px] leading-snug">
                        {mode.subtitle}
                      </p>
                    </Link>
                  );
                })}
              </div>
            </details>
          </>
        )}
      </section>

      {/* Compact Paginated Question Bank Preview (pageSize=50, fields=summary, zero inner scroll trap) */}
      <section aria-labelledby="question-bank-heading" className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2
            id="question-bank-heading"
            className="text-foreground text-base font-semibold"
          >
            {vi ? "Ngân hàng câu hỏi" : "Question Bank"}
            {headingCount !== null && (
              <span className="text-muted-foreground ml-1.5 font-mono text-sm font-normal tabular-nums">
                ({headingCount.toLocaleString()})
              </span>
            )}
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
                className="min-h-11 pl-9 sm:h-9 sm:min-h-9"
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
                  className="min-h-11 min-w-36 flex-1 sm:h-9 sm:min-h-9 sm:w-44 sm:flex-none"
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
              className="min-h-11 sm:min-h-9"
              onClick={() => {
                setStarredOnly((prev) => !prev);
                setPage(1);
              }}
              aria-pressed={starredOnly}
            >
              <Star
                className={cn(
                  "size-4",
                  starredOnly && "fill-warning text-warning",
                )}
                aria-hidden="true"
              />
              <span>{vi ? "Đã đánh dấu" : "Starred"}</span>
            </Button>

            <Button
              size="sm"
              variant="outline"
              className="min-h-11 sm:min-h-9"
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

        <div className={cn(hasQuestions && "min-h-[28rem]")}>
          {questionsQuery.isLoading ? (
            <div className="space-y-3" aria-busy="true">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-28 w-full rounded-xl" />
              ))}
            </div>
          ) : questionsQuery.error ? (
          <EmptyState
            icon={AlertCircle}
            title={vi ? "Không thể tải danh sách câu hỏi" : "Unable to load questions"}
            description={getFriendlyErrorMessage(questionsQuery.error, locale)}
            action={
              <Button onClick={() => void questionsQuery.refetch()}>
                {t("common.retry")}
              </Button>
            }
          />
        ) : questions.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title={
              isFiltered
                ? vi
                  ? "Không tìm thấy câu hỏi phù hợp"
                  : "No matching questions"
                : vi
                  ? "Học phần chưa có câu hỏi nào"
                  : "This study set has no questions yet"
            }
            description={
              isFiltered
                ? vi
                  ? "Thử xóa bộ lọc hoặc từ khóa tìm kiếm."
                  : "Try clearing your search or filter criteria."
                : vi
                  ? "Nhập hàng trăm câu hỏi từ file Word, PDF, Excel, CSV, TXT hoặc thêm thủ công ngay."
                  : "Bulk import questions from DOCX, PDF, XLSX, CSV, or TXT, or add them manually."
            }
            action={
              canEdit && !isFiltered ? (
                <Button asChild>
                  <Link href={`/sets/${setId}/import`} prefetch={false}>
                    <Upload className="size-4" aria-hidden="true" />
                    <span>{t("library.importSet")}</span>
                  </Link>
                </Button>
              ) : undefined
            }
            secondaryAction={
              canEdit && !isFiltered ? (
                <Button variant="outline" asChild>
                  <Link href={`/sets/${setId}/edit`} prefetch={false}>
                    <Edit3 className="size-4" aria-hidden="true" />
                    <span>{vi ? "Thêm thủ công" : "Add manually"}</span>
                  </Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Card className="py-0">
            <CardContent className="p-3 sm:p-4">
              <ol
                className="space-y-3"
                aria-label={vi ? "Danh sách câu hỏi" : "Question list"}
              >
                {questions.map((q, index) => {
                  const isStarred = Boolean(q.is_starred);
                  const globalIdx = (page - 1) * PAGE_SIZE + index + 1;

                  return (
                    <li
                      key={q.id}
                      className={cn(
                        "border-border bg-background rounded-xl border p-3.5 sm:p-4",
                        index >= 6 && "cv-auto",
                      )}
                    >
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
                      ) : (q.back_text || q.back_rich || q.back_image_url) &&
                        showAnswers ? (
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
                    </li>
                  );
                })}
              </ol>

              {totalPages > 1 && (
                <div className="border-border mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs">
                  <span className="text-muted-foreground font-mono tabular-nums">
                    {vi
                      ? `Trang ${page} / ${totalPages} · ${totalQuestionsMatched.toLocaleString()} câu`
                      : `Page ${page} of ${totalPages} · ${totalQuestionsMatched.toLocaleString()} items`}
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
        </div>
      </section>

      {/* Lazy-Loaded Modals — mounted strictly on demand */}
      {isOwner && shareOpen && (
        <ShareDialog
          studySet={studySet}
          open={shareOpen}
          onOpenChange={setShareOpen}
        />
      )}

      {pdfExportOpen && (
        <PdfExportDialog
          studySetId={setId}
          chapter={chapterFilter !== "all" ? chapterFilter : undefined}
          defaultTitle={studySet.title}
          defaultSubject={studySet.subject ?? undefined}
          locale={locale}
          open={pdfExportOpen}
          onOpenChange={setPdfExportOpen}
        />
      )}

      {resetOpen && (
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
            queryClient.invalidateQueries({
              queryKey: ["set-checkpoints", setId],
            });
            queryClient.invalidateQueries({ queryKey: ["dashboard"] });
          }}
        />
      )}

      {canEdit && reportsOpen && (
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
    </div>
  );
}
