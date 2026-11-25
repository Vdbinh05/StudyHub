"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AlertCircle,
  CheckSquare,
  Copy,
  Flag,
  FolderInput,
  Image as ImageIcon,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Printer,
  Save,
  Search,
  Settings,
  Trash2,
  Upload,
  Volume2,
} from "lucide-react";
import { toast } from "sonner";
import { getQuestionTypeLabel } from "@/components/import/import-copy";
import {
  apiFetch,
  getFriendlyErrorMessage,
  isSupabaseConfiguredClient,
} from "@/components/layout/api-client";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { FadeIn } from "@/components/motion";
import { computeQuestionDuplicateFingerprint } from "@/lib/import/validator";
import {
  getOptionMedia,
  getQuestionExplanationMedia,
  getQuestionPromptMedia,
  hasAnyQuestionImages,
} from "@/lib/media/question-media";
import { invalidateStudySetCaches } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { PdfExportDialog } from "./PdfExportDialog";
import { ReportsInboxPanel } from "./ReportsInboxPanel";
import { UnifiedQuestionEditorModal } from "./UnifiedQuestionEditorModal";
import { V3_QUESTION_TYPES, type QuestionMediaFilter } from "@/types/v3";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";
import type {
  DifficultyLevel,
  Folder,
  MemberRole,
  Question,
  QuestionType,
  StudySet,
  StudySetType,
  Tag,
  Visibility,
} from "@/types/domain";

interface StudySetEditorDetail extends StudySet {
  role?: MemberRole | "public_viewer";
  can_edit?: boolean;
  is_owner?: boolean;
  can_clone?: boolean;
  chapters?: Array<string | { name: string; count: number }>;
  tags?: Tag[];
}

const MEDIA_FILTER_OPTIONS: ReadonlyArray<{
  value: QuestionMediaFilter;
  vi: string;
  en: string;
}> = [
  { value: "all", vi: "Tất cả", en: "All" },
  { value: "has_images", vi: "Có ảnh", en: "Has images" },
  { value: "no_images", vi: "Chưa có ảnh", en: "No images" },
  { value: "missing_media", vi: "Thiếu/lỗi ảnh", en: "Missing/broken" },
  { value: "needs_media_review", vi: "Cần rà soát ảnh", en: "Needs review" },
];

function EditorDeepLinkObserver({
  onQuestionParam,
}: {
  onQuestionParam: (questionId: string) => void;
}) {
  const searchParams = useSearchParams();
  const targetId = searchParams.get("questionId") || searchParams.get("edit");
  const lastHandledRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    if (!targetId) {
      lastHandledRef.current = null;
      return;
    }
    if (lastHandledRef.current === targetId) return;
    lastHandledRef.current = targetId;
    onQuestionParam(targetId);
  }, [targetId, onQuestionParam]);

  return null;
}

function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function countQuestionImages(q: Question): number {
  const promptCount = getQuestionPromptMedia(q).length;
  const expCount = getQuestionExplanationMedia(q).length;
  const optCount = (q.options ?? []).reduce(
    (sum, opt) => sum + getOptionMedia(opt).length,
    0,
  );
  return promptCount + expCount + optCount;
}

export function QuestionEditorView({ setId }: { setId: string }) {
  const { locale, t } = useI18n();
  const vi = locale === "vi";
  const router = useRouter();
  const queryClient = useQueryClient();
  const configured = isSupabaseConfiguredClient();

  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [chapterFilter, setChapterFilter] = React.useState("all");
  const [difficultyFilter, setDifficultyFilter] = React.useState<"all" | DifficultyLevel>("all");
  const [typeFilter, setTypeFilter] = React.useState<"all" | QuestionType>("all");
  const [tagFilter, setTagFilter] = React.useState("all");
  const [mediaFilter, setMediaFilter] = React.useState<QuestionMediaFilter>("all");
  const [page, setPage] = React.useState(1);

  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [bulkChapter, setBulkChapter] = React.useState("");
  const [bulkDifficulty, setBulkDifficulty] = React.useState<"keep" | DifficultyLevel>("keep");
  const [bulkAddTags, setBulkAddTags] = React.useState("");
  const [bulkRemoveTagId, setBulkRemoveTagId] = React.useState("none");
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = React.useState(false);
  const [transferDialogOpen, setTransferDialogOpen] = React.useState(false);
  const [transferMode, setTransferMode] = React.useState<"copy" | "move">("copy");
  const [transferTargetSetId, setTransferTargetSetId] = React.useState("");
  const [duplicateFinderOpen, setDuplicateFinderOpen] = React.useState(false);
  const [deletingQuestion, setDeletingQuestion] = React.useState<{
    id: string;
    num: number;
    prompt: string;
  } | null>(null);

  const [editorOpen, setEditorOpen] = React.useState(false);
  const [activeQuestionId, setActiveQuestionId] = React.useState<string | null>(null);
  const [pendingDeepLinkQuestionId, setPendingDeepLinkQuestionId] = React.useState<string | null>(
    null,
  );

  // Set settings state
  const [setTitle, setSetTitle] = React.useState("");
  const [setSubject, setSetSubject] = React.useState("");
  const [setDescription, setSetDescription] = React.useState("");
  const [setFolderId, setSetFolderId] = React.useState("none");
  const [setType, setSetType] = React.useState<StudySetType>("multiple_choice");
  const [setVisibility, setSetVisibility] = React.useState<Visibility>("private");
  const [durationDraft, setDurationDraft] = React.useState("45");
  const [passDraft, setPassDraft] = React.useState("70");
  const [deleteSetOpen, setDeleteSetOpen] = React.useState(false);

  const listParentRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const setQuery = useQuery<StudySetEditorDetail>({
    queryKey: ["study-set", setId],
    enabled: configured,
    queryFn: async () => {
      const res = await apiFetch<StudySetEditorDetail>(`/api/sets/${setId}`);
      return res.data;
    },
  });

  const foldersQuery = useQuery<Folder[]>({
    queryKey: ["folders"],
    enabled: configured,
    queryFn: async () => {
      const res = await apiFetch<Folder[]>("/api/folders");
      return Array.isArray(res.data) ? res.data : [];
    },
  });

  const targetSetsQuery = useQuery<StudySet[]>({
    queryKey: ["study-sets-transfer-targets"],
    enabled: configured && transferDialogOpen,
    queryFn: async () => {
      const res = await apiFetch<StudySet[]>("/api/sets?pageSize=100");
      return Array.isArray(res.data)
        ? res.data.filter((s) => s.id !== setId)
        : [];
    },
  });

  const questionsQuery = useQuery<{ items: Question[]; total: number }>({
    queryKey: [
      "editor-questions",
      setId,
      page,
      debouncedSearch,
      chapterFilter,
      difficultyFilter,
      typeFilter,
      tagFilter,
      mediaFilter,
    ],
    enabled: configured && Boolean(setQuery.data),
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", "500");
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (chapterFilter !== "all") params.set("chapter", chapterFilter);
      if (difficultyFilter !== "all") params.set("difficulty", difficultyFilter);
      if (typeFilter !== "all") params.set("questionType", typeFilter);
      if (tagFilter !== "all") params.set("tagId", tagFilter);
      if (mediaFilter !== "all") params.set("mediaFilter", mediaFilter);
      const res = await apiFetch<Question[]>(
        `/api/sets/${setId}/questions?${params.toString()}`,
      );
      const items = Array.isArray(res.data) ? res.data : [];
      return { items, total: Number(res.meta?.total ?? items.length) };
    },
  });

  React.useEffect(() => {
    if (!setQuery.data) return;
    const s = setQuery.data;
    setSetTitle(s.title);
    setSetSubject(s.subject ?? "");
    setSetDescription(s.description ?? "");
    setSetFolderId(s.folder_id ?? "none");
    setSetType(s.set_type);
    setSetVisibility(s.visibility);
    setDurationDraft(String(s.default_exam_duration_minutes));
    setPassDraft(String(s.default_pass_threshold));
  }, [setQuery.data]);

  const deleteQuestionMutation = useMutation({
    mutationFn: async (questionId: string) => {
      await apiFetch(`/api/sets/${setId}/questions/${questionId}`, {
        method: "DELETE",
      });
    },
    onSuccess: async () => {
      setDeletingQuestion(null);
      await invalidateStudySetCaches(queryClient, setId);
      toast.success(vi ? "Đã xóa câu hỏi." : "Question deleted.");
    },
    onError: (err) => {
      toast.error(getFriendlyErrorMessage(err, locale));
    },
  });

  const bulkUpdateMutation = useMutation({
    mutationFn: async () => {
      const addTagsList = bulkAddTags
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const body: Record<string, unknown> = {
        question_ids: Array.from(selectedIds),
      };
      if (bulkChapter.trim().length > 0) body.chapter = bulkChapter.trim();
      if (bulkDifficulty !== "keep") body.difficulty = bulkDifficulty;
      if (addTagsList.length > 0) body.add_tags = addTagsList;
      if (bulkRemoveTagId !== "none") body.remove_tag_ids = [bulkRemoveTagId];

      if (Object.keys(body).length === 1) {
        throw new Error(
          vi
            ? "Chọn ít nhất một thay đổi (chương, độ khó hoặc thẻ) trước khi áp dụng."
            : "Choose at least one update (chapter, difficulty, or tag) before applying.",
        );
      }

      await apiFetch(`/api/sets/${setId}/questions/bulk`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    },
    onSuccess: async () => {
      setSelectedIds(new Set());
      setBulkChapter("");
      setBulkDifficulty("keep");
      setBulkAddTags("");
      setBulkRemoveTagId("none");
      await invalidateStudySetCaches(queryClient, setId);
      toast.success(vi ? "Đã cập nhật hàng loạt." : "Bulk update applied.");
    },
    onError: (err) => {
      toast.error(getFriendlyErrorMessage(err, locale));
    },
  });

  const bulkTransferMutation = useMutation({
    mutationFn: async () => {
      if (!transferTargetSetId) {
        throw new Error(
          vi ? "Vui lòng chọn học phần đích." : "Please select a destination study set.",
        );
      }
      const selectedQuestions = (questionsQuery.data?.items ?? []).filter((q) =>
        selectedIds.has(q.id),
      );
      if (selectedQuestions.length === 0) return;

      const payloadQuestions = selectedQuestions.map((q) => ({
        question_type: q.question_type,
        chapter: q.chapter ?? null,
        prompt: q.prompt,
        prompt_rich: q.prompt_rich ?? null,
        prompt_image_url: q.prompt_image_url ?? null,
        back_text: q.back_text ?? null,
        back_rich: q.back_rich ?? null,
        back_image_url: q.back_image_url ?? null,
        explanation: q.explanation ?? null,
        explanation_rich: q.explanation_rich ?? null,
        hint: q.hint ?? null,
        audio_url: q.audio_url ?? null,
        audio_transcript: q.audio_transcript ?? null,
        type_payload: q.type_payload ?? null,
        difficulty: q.difficulty,
        options: (q.options ?? []).map((o, idx) => ({
          position: idx,
          label: o.label,
          content: o.content,
          content_rich: o.content_rich ?? null,
          image_url: o.image_url ?? null,
          image_alt: o.image_alt ?? null,
          is_correct: o.is_correct,
        })),
        accepted_answers: (q.accepted_answers ?? []).map((a) => ({
          answer_text: a.answer_text,
          match_mode: a.match_mode,
        })),
        tags: (q.tags ?? []).map((t) => t.name),
      }));

      await apiFetch(`/api/sets/${transferTargetSetId}/questions/bulk`, {
        method: "POST",
        body: JSON.stringify({ questions: payloadQuestions }),
      });

      if (transferMode === "move") {
        await apiFetch(`/api/sets/${setId}/questions/bulk`, {
          method: "DELETE",
          body: JSON.stringify({ question_ids: selectedQuestions.map((q) => q.id) }),
        });
      }
    },
    onSuccess: async () => {
      const destId = transferTargetSetId;
      setSelectedIds(new Set());
      setTransferDialogOpen(false);
      setTransferTargetSetId("");
      await Promise.all([
        invalidateStudySetCaches(queryClient, setId),
        destId ? invalidateStudySetCaches(queryClient, destId) : Promise.resolve(),
      ]);
      toast.success(
        transferMode === "move"
          ? vi
            ? "Đã di chuyển câu hỏi sang học phần đích (lịch sử thi cũ vẫn được bảo toàn)."
            : "Questions moved to target study set (past exam history preserved)."
          : vi
            ? "Đã sao chép câu hỏi sang học phần đích."
            : "Questions copied to target study set.",
      );
    },
    onError: (err) => {
      toast.error(getFriendlyErrorMessage(err, locale));
    },
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: async () => {
      await apiFetch(`/api/sets/${setId}/questions/bulk`, {
        method: "DELETE",
        body: JSON.stringify({
          question_ids: Array.from(selectedIds),
        }),
      });
    },
    onSuccess: async () => {
      setSelectedIds(new Set());
      setBulkDeleteConfirmOpen(false);
      await invalidateStudySetCaches(queryClient, setId);
      toast.success(vi ? "Đã xóa các câu hỏi đã chọn." : "Selected questions deleted.");
    },
    onError: (err) => {
      toast.error(getFriendlyErrorMessage(err, locale));
    },
  });

  const isOwner =
    setQuery.data?.is_owner === true || setQuery.data?.role === "owner";
  const canEdit =
    typeof setQuery.data?.can_edit === "boolean"
      ? setQuery.data.can_edit
      : setQuery.data?.role === "owner" || setQuery.data?.role === "editor";

  const updateSetMutation = useMutation({
    mutationFn: async () => {
      const durationMinutes = clampInt(durationDraft, 1, 300, 45);
      const passThreshold = clampInt(passDraft, 1, 100, 70);
      const payload: Record<string, unknown> = {
        title: setTitle.trim(),
        subject: setSubject.trim() || null,
        description: setDescription.trim() || null,
        set_type: setType,
        default_exam_duration_minutes: durationMinutes,
        default_pass_threshold: passThreshold,
      };
      if (isOwner) {
        payload.folder_id = setFolderId === "none" ? null : setFolderId;
        payload.visibility = setVisibility;
      }
      await apiFetch(`/api/sets/${setId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: async () => {
      await invalidateStudySetCaches(queryClient, setId);
      toast.success(t("settings.savedSuccess"));
    },
    onError: (err) => {
      toast.error(getFriendlyErrorMessage(err, locale));
    },
  });

  const deleteSetMutation = useMutation({
    mutationFn: async () => {
      await apiFetch(`/api/sets/${setId}`, { method: "DELETE" });
    },
    onSuccess: async () => {
      await invalidateStudySetCaches(queryClient, setId);
      toast.success(vi ? "Đã xóa học phần." : "Study set deleted.");
      router.push("/library");
    },
    onError: (err) => {
      toast.error(getFriendlyErrorMessage(err, locale));
    },
  });

  // Open target question automatically when navigated via `?questionId=` or `?edit=` (authorized editors only!)
  React.useEffect(() => {
    if (!pendingDeepLinkQuestionId || !setQuery.data) return;
    if (canEdit) {
      setActiveQuestionId(pendingDeepLinkQuestionId);
      setEditorOpen(true);
    }
    setPendingDeepLinkQuestionId(null);
  }, [pendingDeepLinkQuestionId, setQuery.data, canEdit]);

  const handleDeepLinkParam = React.useCallback((targetId: string) => {
    setPendingDeepLinkQuestionId(targetId);
  }, []);

  const questions = React.useMemo(
    () => questionsQuery.data?.items ?? [],
    [questionsQuery.data?.items],
  );
  const pageQuestionIds = React.useMemo(
    () => questions.map((item) => item.id),
    [questions],
  );
  const totalCount = questionsQuery.data?.total ?? questions.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / 500));

  const availableChapters = React.useMemo(() => {
    const discovered = new Set<string>();
    for (const ch of setQuery.data?.chapters ?? []) {
      const name = typeof ch === "string" ? ch : ch.name;
      if (name) discovered.add(name);
    }
    for (const q of questions) {
      if (q.chapter) discovered.add(q.chapter);
    }
    return Array.from(discovered);
  }, [setQuery.data?.chapters, questions]);

  const availableTags = React.useMemo(() => {
    const tagMap = new Map<string, Tag>();
    for (const tag of setQuery.data?.tags ?? []) {
      tagMap.set(tag.id, tag);
    }
    for (const q of questions) {
      for (const tag of q.tags ?? []) {
        tagMap.set(tag.id, tag);
      }
    }
    return Array.from(tagMap.values());
  }, [setQuery.data?.tags, questions]);

  // Safe deterministic duplicate groups (prompt + sorted options + correct answers + media; NEVER collides distinct questions!)
  const duplicateGroups = React.useMemo(() => {
    const groups = new Map<string, Question[]>();
    for (const q of questions) {
      const fp = computeQuestionDuplicateFingerprint({
        prompt: q.prompt,
        promptImageUrl: q.prompt_image_url,
        backText: q.back_text,
        options: (q.options ?? []).map((o) => ({
          content: o.content,
          isCorrect: o.is_correct,
          imageUrl: o.image_url,
        })),
        acceptedAnswers: (q.accepted_answers ?? []).map((a) => ({
          answerText: a.answer_text,
        })),
      });
      if (!fp) continue;
      const list = groups.get(fp) ?? [];
      list.push(q);
      groups.set(fp, list);
    }
    return Array.from(groups.values()).filter((g) => g.length > 1);
  }, [questions]);

  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: questions.length,
    getScrollElement: () => listParentRef.current,
    estimateSize: () => 92,
    overscan: 8,
  });

  if (!configured) {
    return (
      <EmptyState
        icon={AlertCircle}
        title={vi ? "Không thể mở trình chỉnh sửa" : "Editor unavailable"}
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
    return <Skeleton className="h-96 w-full rounded-xl" />;
  }

  if (setQuery.error || !setQuery.data) {
    return (
      <EmptyState
        icon={AlertCircle}
        title={vi ? "Không thể mở trình chỉnh sửa" : "Cannot open editor"}
        description={getFriendlyErrorMessage(setQuery.error, locale)}
        action={
          <Button asChild>
            <Link href="/library">{t("library.title")}</Link>
          </Button>
        }
      />
    );
  }

  const hasActiveFilters =
    Boolean(debouncedSearch) ||
    chapterFilter !== "all" ||
    difficultyFilter !== "all" ||
    typeFilter !== "all" ||
    tagFilter !== "all" ||
    mediaFilter !== "all";

  const openCreateQuestionModal = () => {
    if (!canEdit) return;
    setActiveQuestionId(null);
    setEditorOpen(true);
  };

  const openEditQuestionModal = (qOrId: Question | string) => {
    if (!canEdit) return;
    setActiveQuestionId(typeof qOrId === "string" ? qOrId : qOrId.id);
    setEditorOpen(true);
  };

  const activeQuestionIndex = activeQuestionId
    ? pageQuestionIds.indexOf(activeQuestionId)
    : -1;
  const activeInitialQuestion =
    activeQuestionId && activeQuestionIndex >= 0
      ? questions[activeQuestionIndex]
      : null;

  return (
    <FadeIn aboveFold className="space-y-6">
      <React.Suspense fallback={null}>
        <EditorDeepLinkObserver onQuestionParam={handleDeepLinkParam} />
      </React.Suspense>
      <PageHeader
        title={`${canEdit ? t("common.edit") : vi ? "Xem câu hỏi" : "View questions"}: ${setQuery.data.title}`}
        breadcrumbs={[
          { label: t("library.title"), href: "/library" },
          { label: setQuery.data.title, href: `/sets/${setId}` },
          { label: canEdit ? t("common.edit") : vi ? "Chỉ xem" : "Read-only" },
        ]}
        actions={
          canEdit ? (
            <>
              <PdfExportDialog
                studySetId={setId}
                defaultTitle={setQuery.data.title}
                defaultSubject={setQuery.data.subject ?? ""}
                locale={locale}
              />
              <Button size="sm" variant="outline" className="min-h-11 sm:min-h-9" asChild>
                <Link href={`/sets/${setId}/import`}>
                  <Upload className="size-4" aria-hidden="true" />
                  <span>{t("library.importSet")}</span>
                </Link>
              </Button>
              <Button
                size="sm"
                className="min-h-11 sm:min-h-9"
                onClick={openCreateQuestionModal}
              >
                <Plus className="size-4" aria-hidden="true" />
                <span>{vi ? "Thêm câu hỏi" : "Add question"}</span>
              </Button>
            </>
          ) : (
            <Button size="sm" variant="outline" className="min-h-11 sm:min-h-9" asChild>
              <Link href={`/sets/${setId}`}>
                {vi ? "Quay lại học phần" : "Back to study set"}
              </Link>
            </Button>
          )
        }
      />

      {!canEdit && (
        <div
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-warning/40 bg-warning-subtle px-4 py-3 text-sm text-warning-subtle-foreground"
        >
          <div className="flex items-start gap-2.5">
            <Lock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-medium">
                {vi
                  ? "Bạn đang ở chế độ chỉ xem (Viewer)"
                  : "Read-only access (Viewer)"}
              </p>
              <p className="text-xs opacity-90">
                {vi
                  ? "Bạn có thể xem danh sách câu hỏi và học tập, nhưng chỉ chủ sở hữu hoặc biên tập viên mới có quyền thêm, sửa hoặc xóa câu hỏi."
                  : "You can browse and study these questions, but only the owner or editors can add, edit, or delete questions."}
              </p>
            </div>
          </div>
          <Button size="sm" variant="outline" className="min-h-11 sm:min-h-9" asChild>
            <Link href={`/sets/${setId}`}>
              {vi ? "Mở chế độ học" : "Open study modes"}
            </Link>
          </Button>
        </div>
      )}

      <Tabs defaultValue="questions">
        <TabsList>
          <TabsTrigger value="questions" className="min-h-11 sm:min-h-9">
            {vi ? "Danh sách câu hỏi" : "Questions"} ({totalCount.toLocaleString()})
          </TabsTrigger>
          {canEdit && (
            <>
              <TabsTrigger value="reports" className="min-h-11 sm:min-h-9">
                <Flag className="size-3.5" aria-hidden="true" />
                <span>{vi ? "Báo cáo lỗi" : "Reports"}</span>
              </TabsTrigger>
              <TabsTrigger value="settings" className="min-h-11 sm:min-h-9">
                <Settings className="size-3.5" aria-hidden="true" />
                <span>{vi ? "Thông tin học phần" : "Set Settings"}</span>
              </TabsTrigger>
            </>
          )}
        </TabsList>

        {/* Questions Tab */}
        <TabsContent value="questions" className="mt-4 space-y-4">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <search className="relative min-w-56 flex-1 sm:max-w-xs">
                <Search
                  className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
                  aria-hidden="true"
                />
                <Input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={
                    vi ? "Tìm câu hỏi hoặc số câu (#123)..." : "Search questions or #123..."
                  }
                  aria-label={vi ? "Tìm câu hỏi hoặc số câu" : "Search questions or number"}
                  className="pl-9"
                />
              </search>

              {/* Chapter filter (SH-033) */}
              {availableChapters.length > 0 && (
                <Select
                  value={chapterFilter}
                  onValueChange={(v) => {
                    setChapterFilter(v);
                    setPage(1);
                  }}
                >
                  <SelectTrigger
                    className="w-44"
                    aria-label={vi ? "Lọc theo chương" : "Filter by chapter"}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      {vi ? "Tất cả chương" : "All chapters"}
                    </SelectItem>
                    {availableChapters.map((ch) => (
                      <SelectItem key={ch} value={ch}>
                        {ch}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {/* Difficulty filter (SH-033) */}
              <Select
                value={difficultyFilter}
                onValueChange={(v) => {
                  setDifficultyFilter(v as "all" | DifficultyLevel);
                  setPage(1);
                }}
              >
                <SelectTrigger
                  className="w-36"
                  aria-label={vi ? "Lọc theo độ khó" : "Filter by difficulty"}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {vi ? "Mọi độ khó" : "All difficulties"}
                  </SelectItem>
                  <SelectItem value="easy">{t("difficulty.easy")}</SelectItem>
                  <SelectItem value="medium">{t("difficulty.medium")}</SelectItem>
                  <SelectItem value="hard">{t("difficulty.hard")}</SelectItem>
                </SelectContent>
              </Select>

              {/* Question Type filter (SH-033) */}
              <Select
                value={typeFilter}
                onValueChange={(v) => {
                  setTypeFilter(v as "all" | QuestionType);
                  setPage(1);
                }}
              >
                <SelectTrigger
                  className="w-40"
                  aria-label={vi ? "Lọc theo dạng câu" : "Filter by question type"}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {vi ? "Mọi dạng câu" : "All types"}
                  </SelectItem>
                  {V3_QUESTION_TYPES.map((qType) => (
                    <SelectItem key={qType} value={qType}>
                      {getQuestionTypeLabel(qType, locale)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Tag filter (SH-033) */}
              {availableTags.length > 0 && (
                <Select
                  value={tagFilter}
                  onValueChange={(v) => {
                    setTagFilter(v);
                    setPage(1);
                  }}
                >
                  <SelectTrigger
                    className="w-40"
                    aria-label={vi ? "Lọc theo thẻ" : "Filter by tag"}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">
                      {vi ? "Tất cả thẻ" : "All tags"}
                    </SelectItem>
                    {availableTags.map((tag) => (
                      <SelectItem key={tag.id} value={tag.id}>
                        {tag.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {hasActiveFilters && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setSearch("");
                    setDebouncedSearch("");
                    setChapterFilter("all");
                    setDifficultyFilter("all");
                    setTypeFilter("all");
                    setTagFilter("all");
                    setMediaFilter("all");
                    setPage(1);
                  }}
                >
                  {t("common.reset")}
                </Button>
              )}
              {canEdit && questions.length > 0 && (
                <div className="ml-auto flex flex-wrap items-center gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="min-h-11 sm:min-h-9"
                    onClick={() => {
                      const allSelected =
                        questions.length > 0 &&
                        questions.every((q) => selectedIds.has(q.id));
                      setSelectedIds(
                        allSelected
                          ? new Set()
                          : new Set(questions.map((q) => q.id)),
                      );
                    }}
                  >
                    <CheckSquare className="mr-1.5 size-3.5" aria-hidden="true" />
                    {questions.every((q) => selectedIds.has(q.id))
                      ? vi
                        ? "Bỏ chọn trang"
                        : "Clear page"
                      : vi
                        ? "Chọn cả trang"
                        : "Select page"}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="min-h-11 sm:min-h-9"
                    onClick={() => setDuplicateFinderOpen(true)}
                  >
                    <Copy className="mr-1.5 size-3.5" aria-hidden="true" />
                    {vi ? "Tìm trùng lặp" : "Duplicates"}
                    {duplicateGroups.length > 0 && (
                      <Badge variant="secondary" className="ml-1.5 px-1.5 py-0 text-[10px]">
                        {duplicateGroups.length}
                      </Badge>
                    )}
                  </Button>
                </div>
              )}
            </div>

            {/* 5 Lightweight Media Review Filter Pills (V32-053) */}
            <div
              role="group"
              aria-label={vi ? "Lọc câu hỏi theo hình ảnh" : "Filter questions by media"}
              className="flex flex-wrap items-center gap-1.5"
            >
              {MEDIA_FILTER_OPTIONS.map((opt) => {
                const active = mediaFilter === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => {
                      setMediaFilter(opt.value);
                      setPage(1);
                    }}
                    className={cn(
                      "inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
                    )}
                  >
                    {opt.value === "has_images" && (
                      <ImageIcon className="size-3" aria-hidden="true" />
                    )}
                    <span>{vi ? opt.vi : opt.en}</span>
                  </button>
                );
              })}
            </div>

            {canEdit && selectedIds.size > 0 && (
              <div className="border-primary/30 bg-accent flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
                <span className="text-accent-foreground font-mono text-xs font-semibold tabular-nums">
                  {selectedIds.size} {vi ? "đã chọn" : "selected"}
                </span>
                <Input
                  value={bulkChapter}
                  onChange={(e) => setBulkChapter(e.target.value)}
                  placeholder={vi ? "Gán chương..." : "Assign chapter..."}
                  className="bg-card h-8 w-36 text-xs"
                />
                <Select
                  value={bulkDifficulty}
                  onValueChange={(v) => setBulkDifficulty(v as "keep" | DifficultyLevel)}
                >
                  <SelectTrigger className="bg-card h-8 w-32 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="keep">{vi ? "Giữ độ khó" : "Keep difficulty"}</SelectItem>
                    <SelectItem value="easy">{t("difficulty.easy")}</SelectItem>
                    <SelectItem value="medium">{t("difficulty.medium")}</SelectItem>
                    <SelectItem value="hard">{t("difficulty.hard")}</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  value={bulkAddTags}
                  onChange={(e) => setBulkAddTags(e.target.value)}
                  placeholder={vi ? "+ Thêm thẻ (a, b)" : "+ Add tags (a, b)"}
                  className="bg-card h-8 w-36 text-xs"
                />
                {availableTags.length > 0 && (
                  <Select value={bulkRemoveTagId} onValueChange={setBulkRemoveTagId}>
                    <SelectTrigger className="bg-card h-8 w-36 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">{vi ? "Gỡ thẻ…" : "Remove tag…"}</SelectItem>
                      {availableTags.map((tag) => (
                        <SelectItem key={tag.id} value={tag.id}>
                          − {tag.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={bulkUpdateMutation.isPending}
                  onClick={() => bulkUpdateMutation.mutate()}
                >
                  {vi ? "Áp dụng" : "Apply"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setTransferMode("copy");
                    setTransferDialogOpen(true);
                  }}
                >
                  <FolderInput className="mr-1 size-3.5" aria-hidden="true" />
                  {vi ? "Chép / Chuyển" : "Copy / Move"}
                </Button>
                <PdfExportDialog
                  studySetId={setId}
                  questionIds={Array.from(selectedIds)}
                  defaultTitle={`${setQuery.data.title} (${selectedIds.size})`}
                  defaultSubject={setQuery.data.subject ?? ""}
                  locale={locale}
                  trigger={
                    <Button size="sm" variant="outline">
                      <Printer className="mr-1 size-3.5" aria-hidden="true" />
                      {vi ? "Xuất PDF chọn" : "Export Selected PDF"}
                    </Button>
                  }
                />
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => setBulkDeleteConfirmOpen(true)}
                >
                  <Trash2 className="size-3.5" aria-hidden="true" />
                  <span>{t("common.delete")}</span>
                </Button>
              </div>
            )}
          </div>

          {questionsQuery.isLoading ? (
            <Skeleton className="h-80 w-full rounded-xl" />
          ) : questions.length === 0 ? (
            <EmptyState
              icon={canEdit ? Plus : Search}
              title={
                hasActiveFilters
                  ? vi
                    ? "Không tìm thấy câu hỏi phù hợp"
                    : "No matching questions"
                  : vi
                    ? "Chưa có câu hỏi nào"
                    : "No questions yet"
              }
              description={
                hasActiveFilters
                  ? vi
                    ? "Thử đặt lại bộ lọc hoặc thay đổi từ khóa tìm kiếm."
                    : "Try clearing filters or adjusting your search keywords."
                  : canEdit
                    ? vi
                      ? "Bấm \"Thêm câu hỏi\" để tạo câu trắc nghiệm hoặc flashcard, hoặc dùng công cụ Nhập từ file."
                      : "Click \"Add question\" to author a new multiple-choice question or flashcard, or bulk import from a file."
                    : vi
                      ? "Học phần này hiện chưa có câu hỏi nào."
                      : "This study set does not have any questions yet."
              }
              action={
                hasActiveFilters ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setSearch("");
                      setDebouncedSearch("");
                      setChapterFilter("all");
                      setDifficultyFilter("all");
                      setTypeFilter("all");
                      setTagFilter("all");
                      setMediaFilter("all");
                      setPage(1);
                    }}
                  >
                    {t("common.reset")}
                  </Button>
                ) : canEdit ? (
                  <Button onClick={openCreateQuestionModal}>
                    <Plus className="size-4" aria-hidden="true" />
                    <span>{vi ? "Thêm câu hỏi" : "Add question"}</span>
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <Card>
              <CardContent className="p-0">
                <div
                  ref={listParentRef}
                  className="max-h-[620px] overflow-y-auto p-3"
                >
                  <div
                    style={{
                      height: `${rowVirtualizer.getTotalSize()}px`,
                      width: "100%",
                      position: "relative",
                    }}
                  >
                    {rowVirtualizer.getVirtualItems().map((vRow) => {
                      const q = questions[vRow.index];
                      if (!q) return null;
                      const checked = selectedIds.has(q.id);
                      const globalNum =
                        typeof q.position === "number" && Number.isFinite(q.position)
                          ? q.position + 1
                          : (page - 1) * 500 + vRow.index + 1;
                      const imageCount = countQuestionImages(q);
                      const hasImage = imageCount > 0 || hasAnyQuestionImages(q);
                      const hasAudio =
                        Boolean(q.audio_url) ||
                        Boolean(q.audio_media_id) ||
                        (q.type_payload?.type === "listening" &&
                          Boolean(q.type_payload.audio_url));

                      const rowContent = (
                        <>
                          <p className="text-foreground line-clamp-1 text-sm font-medium">
                            {q.prompt || (vi ? "(Câu hỏi hình ảnh)" : "(Image question)")}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            <Badge variant="secondary">
                              {getQuestionTypeLabel(q.question_type, locale)}
                            </Badge>
                            <Badge variant="outline">
                              {t(`difficulty.${q.difficulty}`)}
                            </Badge>
                            {q.chapter && (
                              <Badge variant="outline">{q.chapter}</Badge>
                            )}
                            {hasImage && (
                              <Badge
                                variant="outline"
                                className="gap-1 border-primary/25 bg-primary/5 text-primary"
                              >
                                <ImageIcon className="size-3" aria-hidden="true" />
                                <span>
                                  {imageCount > 1
                                    ? vi
                                      ? `${imageCount} ảnh`
                                      : `${imageCount} images`
                                    : vi
                                      ? "Ảnh"
                                      : "Image"}
                                </span>
                              </Badge>
                            )}
                            {hasAudio && (
                              <Badge
                                variant="outline"
                                className="gap-1 border-accent-foreground/20 bg-accent text-accent-foreground"
                              >
                                <Volume2 className="size-3" aria-hidden="true" />
                                <span>{vi ? "Âm thanh" : "Audio"}</span>
                              </Badge>
                            )}
                            <span className="text-muted-foreground text-xs">
                              {q.options && q.options.length > 0
                                ? `${q.options.length} ${vi ? "đáp án" : "options"}`
                                : q.back_text
                                  ? vi
                                    ? "Thẻ 2 mặt"
                                    : "Flashcard"
                                  : ""}
                            </span>
                          </div>
                        </>
                      );

                      return (
                        <div
                          key={q.id}
                          data-index={vRow.index}
                          ref={rowVirtualizer.measureElement}
                          style={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: "100%",
                            transform: `translateY(${vRow.start}px)`,
                          }}
                          className="pb-2"
                        >
                          <div className="border-border bg-background hover:border-primary/40 flex items-center gap-2 rounded-lg border px-2.5 py-2.5 transition-colors sm:gap-3 sm:px-3.5 sm:py-3">
                            {canEdit && (
                              <div className="flex min-h-11 min-w-11 shrink-0 items-center justify-center sm:min-h-8 sm:min-w-8">
                                <Checkbox
                                  checked={checked}
                                  aria-label={`${vi ? "Chọn câu" : "Select question"} #${globalNum}`}
                                  onCheckedChange={(val) => {
                                    setSelectedIds((prev) => {
                                      const next = new Set(prev);
                                      if (val) next.add(q.id);
                                      else next.delete(q.id);
                                      return next;
                                    });
                                  }}
                                />
                              </div>
                            )}
                            <span className="text-muted-foreground w-9 shrink-0 font-mono text-xs tabular-nums sm:w-10">
                              #{globalNum}
                            </span>
                            {canEdit ? (
                              <button
                                type="button"
                                onClick={() => openEditQuestionModal(q)}
                                className="min-w-0 flex-1 rounded-md py-0.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              >
                                {rowContent}
                              </button>
                            ) : (
                              <div className="min-w-0 flex-1 py-0.5 text-left">
                                {rowContent}
                              </div>
                            )}
                            {canEdit && (
                              <div className="flex shrink-0 items-center gap-1">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="min-h-11 min-w-11 text-muted-foreground hover:text-foreground sm:size-9 sm:min-h-9 sm:min-w-9"
                                  aria-label={`${vi ? "Chỉnh sửa câu" : "Edit question"} #${globalNum}`}
                                  title={vi ? "Chỉnh sửa" : "Edit"}
                                  onClick={() => openEditQuestionModal(q)}
                                >
                                  <Pencil className="size-4" aria-hidden="true" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="min-h-11 min-w-11 text-destructive hover:bg-destructive-subtle sm:size-9 sm:min-h-9 sm:min-w-9"
                                  aria-label={`${t("common.delete")} #${globalNum}`}
                                  title={t("common.delete")}
                                  onClick={() =>
                                    setDeletingQuestion({
                                      id: q.id,
                                      num: globalNum,
                                      prompt: q.prompt,
                                    })
                                  }
                                >
                                  <Trash2 className="size-4" aria-hidden="true" />
                                </Button>
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
                      {vi ? `Trang ${page} / ${totalPages}` : `Page ${page} of ${totalPages}`}
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
        </TabsContent>

        {/* Reports Inbox Tab (editors & owner only) */}
        {canEdit && (
          <TabsContent value="reports" className="mt-4">
            <ReportsInboxPanel
              studySetId={setId}
              locale={locale}
              onEditQuestion={(questionId) => {
                openEditQuestionModal(questionId);
              }}
            />
          </TabsContent>
        )}

        {/* Set Metadata Settings Tab (editors & owner only) */}
        {canEdit && (
          <TabsContent value="settings" className="mt-4 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {vi ? "Cập nhật thông tin học phần" : "Study Set Details"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (setTitle.trim()) updateSetMutation.mutate();
                }}
                className="space-y-4"
              >
                <div className="space-y-1.5">
                  <Label htmlFor="edit-set-title">{vi ? "Tên học phần" : "Title"}</Label>
                  <Input
                    id="edit-set-title"
                    required
                    value={setTitle}
                    onChange={(e) => setSetTitle(e.target.value)}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-set-subject">{vi ? "Môn học" : "Subject"}</Label>
                    <Input
                      id="edit-set-subject"
                      value={setSubject}
                      onChange={(e) => setSetSubject(e.target.value)}
                    />
                  </div>
                  {isOwner && (
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-set-folder">{t("nav.folders")}</Label>
                      <Select value={setFolderId} onValueChange={setSetFolderId}>
                        <SelectTrigger id="edit-set-folder">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">
                            {vi ? "Không thuộc thư mục" : "No folder"}
                          </SelectItem>
                          {(foldersQuery.data ?? []).map((f) => (
                            <SelectItem key={f.id} value={f.id}>
                              {f.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-set-type">{vi ? "Loại" : "Set type"}</Label>
                    <Select
                      value={setType}
                      onValueChange={(v) => setSetType(v as StudySetType)}
                    >
                      <SelectTrigger id="edit-set-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="multiple_choice">
                          {t("library.typeMultipleChoice")}
                        </SelectItem>
                        <SelectItem value="flashcards">
                          {t("library.typeFlashcards")}
                        </SelectItem>
                        <SelectItem value="mixed">{t("library.typeMixed")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {isOwner && (
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-set-vis">{vi ? "Hiển thị" : "Visibility"}</Label>
                      <Select
                        value={setVisibility}
                        onValueChange={(v) => setSetVisibility(v as Visibility)}
                      >
                        <SelectTrigger id="edit-set-vis">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="private">
                            {t("library.visibilityPrivate")}
                          </SelectItem>
                          <SelectItem value="shared">
                            {t("library.visibilityShared")}
                          </SelectItem>
                          <SelectItem value="unlisted">
                            {t("library.visibilityUnlisted")}
                          </SelectItem>
                          <SelectItem value="public">
                            {t("library.visibilityPublic")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="edit-set-desc">{vi ? "Mô tả" : "Description"}</Label>
                  <Textarea
                    id="edit-set-desc"
                    rows={3}
                    value={setDescription}
                    onChange={(e) => setSetDescription(e.target.value)}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-set-dur">{t("exam.timeLimitMinutes")}</Label>
                    <Input
                      id="edit-set-dur"
                      type="text"
                      inputMode="numeric"
                      value={durationDraft}
                      onChange={(e) =>
                        setDurationDraft(e.target.value.replace(/[^0-9]/g, ""))
                      }
                      onBlur={() =>
                        setDurationDraft(String(clampInt(durationDraft, 1, 300, 45)))
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-set-pass">{t("exam.passThreshold")}</Label>
                    <Input
                      id="edit-set-pass"
                      type="text"
                      inputMode="numeric"
                      value={passDraft}
                      onChange={(e) =>
                        setPassDraft(e.target.value.replace(/[^0-9]/g, ""))
                      }
                      onBlur={() =>
                        setPassDraft(String(clampInt(passDraft, 1, 100, 70)))
                      }
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                  {isOwner ? (
                    <Button
                      type="button"
                      variant="outline"
                      className="text-destructive border-destructive/30 hover:bg-destructive-subtle"
                      onClick={() => setDeleteSetOpen(true)}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                      <span>{vi ? "Xóa học phần" : "Delete study set"}</span>
                    </Button>
                  ) : (
                    <span className="text-muted-foreground text-xs">
                      {vi
                        ? "Chỉ chủ sở hữu học phần mới có thể đổi quyền hiển thị hoặc xóa học phần."
                        : "Only the set owner can change visibility, folder, or delete this study set."}
                    </span>
                  )}
                  <Button type="submit" disabled={updateSetMutation.isPending}>
                    {updateSetMutation.isPending ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Save className="size-4" aria-hidden="true" />
                    )}
                    <span>{t("settings.saveChanges")}</span>
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
          </TabsContent>
        )}
      </Tabs>

      {/* Shared Unified Multi-Image Question Editor Modal (V32-053) */}
      {canEdit && (
        <UnifiedQuestionEditorModal
          open={editorOpen}
          onOpenChange={setEditorOpen}
          studySetId={setId}
          questionId={activeQuestionId}
          initialQuestion={activeInitialQuestion}
          questionIds={pageQuestionIds}
          currentIndex={activeQuestionIndex >= 0 ? activeQuestionIndex : undefined}
          onNavigateQuestion={(nextQuestionId) => {
            setActiveQuestionId(nextQuestionId);
          }}
          chapters={availableChapters}
          defaultQuestionType={
            setQuery.data.set_type === "flashcards" ? "flashcard" : "single_choice"
          }
          locale={locale}
        />
      )}

      {/* Bulk Copy / Move Selected Questions to Another Study Set */}
      <Dialog open={transferDialogOpen} onOpenChange={setTransferDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {vi
                ? `Sao chép / Di chuyển ${selectedIds.size} câu hỏi`
                : `Copy / Move ${selectedIds.size} selected questions`}
            </DialogTitle>
            <DialogDescription>
              {vi
                ? "Chọn học phần đích bạn có quyền chỉnh sửa. Lịch sử bài thi trước đây luôn được bảo toàn."
                : "Choose an authorized destination study set. Past exam attempt snapshots are always preserved."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Button
                type="button"
                size="sm"
                variant={transferMode === "copy" ? "default" : "outline"}
                onClick={() => setTransferMode("copy")}
              >
                {vi ? "Sao chép (Giữ bản gốc)" : "Copy (Keep originals)"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant={transferMode === "move" ? "default" : "outline"}
                onClick={() => setTransferMode("move")}
              >
                {vi ? "Di chuyển (Xóa ở bộ này)" : "Move (Remove from this set)"}
              </Button>
            </div>
            <div className="space-y-1.5">
              <Label>{vi ? "Học phần đích" : "Destination Study Set"}</Label>
              <Select
                value={transferTargetSetId}
                onValueChange={setTransferTargetSetId}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={vi ? "Chọn học phần..." : "Select study set..."}
                  />
                </SelectTrigger>
                <SelectContent>
                  {(targetSetsQuery.data ?? []).map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setTransferDialogOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              disabled={!transferTargetSetId || bulkTransferMutation.isPending}
              onClick={() => bulkTransferMutation.mutate()}
            >
              {bulkTransferMutation.isPending && (
                <Loader2 className="mr-1.5 size-4 animate-spin" />
              )}
              {transferMode === "move"
                ? vi
                  ? "Xác nhận di chuyển"
                  : "Confirm Move"
                : vi
                  ? "Xác nhận sao chép"
                  : "Confirm Copy"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Safe Duplicate Finder Dialog (Exact Fingerprint Only — Never Auto-Merges Distinct Options/Media) */}
      <Dialog open={duplicateFinderOpen} onOpenChange={setDuplicateFinderOpen}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Copy className="size-4 text-primary" aria-hidden="true" />
              {vi ? "Tìm câu hỏi trùng lặp an toàn" : "Safe Duplicate Finder"}
            </DialogTitle>
            <DialogDescription>
              {vi
                ? "Chỉ đánh dấu trùng khi nội dung câu hỏi, danh sách phương án, đáp án đúng và hình ảnh khớp 100%. Không bao giờ gộp nhầm câu cùng tiêu đề nhưng khác đáp án."
                : "Flags duplicates ONLY when prompt, sorted options, correct answers, and media match 100%. Never merges similar prompts with different answers or images."}
            </DialogDescription>
          </DialogHeader>

          {duplicateGroups.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {vi
                ? "Không phát hiện câu hỏi trùng lặp chính xác nào trong trang hiện tại."
                : "No exact duplicate questions detected on the current page."}
            </p>
          ) : (
            <div className="space-y-3">
              {duplicateGroups.map((group, gIdx) => (
                <div
                  key={group[0].id}
                  className="space-y-2 rounded-lg border border-border bg-muted/20 p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-foreground">
                      {vi
                        ? `Nhóm trùng #${gIdx + 1} (${group.length} bản giống nhau)`
                        : `Duplicate group #${gIdx + 1} (${group.length} identical copies)`}
                    </span>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => {
                        setSelectedIds((prev) => {
                          const next = new Set(prev);
                          // Select all extra copies after keeping the first one
                          group.slice(1).forEach((dup) => next.add(dup.id));
                          return next;
                        });
                        setDuplicateFinderOpen(false);
                        toast.info(
                          vi
                            ? `Đã chọn ${group.length - 1} bản trùng để bạn kiểm tra và xóa trong thanh thao tác hàng loạt.`
                            : `Selected ${group.length - 1} extra copy(s) for review in the bulk action bar.`,
                        );
                      }}
                    >
                      {vi ? `Chọn ${group.length - 1} bản thừa` : `Select ${group.length - 1} extra`}
                    </Button>
                  </div>
                  <p className="line-clamp-2 text-sm text-foreground">{group[0].prompt}</p>
                </div>
              ))}
            </div>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setDuplicateFinderOpen(false)}
            >
              {vi ? "Đóng" : "Close"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Single Question Delete Confirmation (fixes SH-037 / L-01) */}
      <AlertDialog
        open={Boolean(deletingQuestion)}
        onOpenChange={(open) => !open && setDeletingQuestion(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {vi
                ? `Xóa câu hỏi #${deletingQuestion?.num ?? ""}?`
                : `Delete question #${deletingQuestion?.num ?? ""}?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deletingQuestion?.prompt
                ? `${deletingQuestion.prompt.slice(0, 140)}${deletingQuestion.prompt.length > 140 ? "…" : ""}`
                : vi
                  ? "Hành động này không thể hoàn tác. Lịch sử bài thi cũ vẫn được bảo toàn."
                  : "This cannot be undone. Past exam attempt snapshots remain immutable."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel autoFocus>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteQuestionMutation.isPending}
              onClick={() =>
                deletingQuestion && deleteQuestionMutation.mutate(deletingQuestion.id)
              }
            >
              {deleteQuestionMutation.isPending && (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              )}
              <span>{t("common.delete")}</span>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Delete Confirm */}
      <AlertDialog
        open={bulkDeleteConfirmOpen}
        onOpenChange={setBulkDeleteConfirmOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {vi
                ? `Xóa ${selectedIds.size} câu hỏi đã chọn?`
                : `Delete ${selectedIds.size} selected questions?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {vi
                ? "Hành động này không thể hoàn tác. Lịch sử bài thi cũ vẫn được bảo toàn."
                : "This cannot be undone. Past exam attempt snapshots remain immutable."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel autoFocus>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => bulkDeleteMutation.mutate()}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Set Confirm (Owner-only) */}
      {isOwner && (
        <AlertDialog open={deleteSetOpen} onOpenChange={setDeleteSetOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {vi ? "Xóa học phần này?" : "Delete this study set?"}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("library.deleteSetConfirm")}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel autoFocus>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => deleteSetMutation.mutate()}
              >
                {t("common.delete")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </FadeIn>
  );
}
