"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AlertCircle,
  Check,
  ImagePlus,
  Loader2,
  Plus,
  Save,
  Search,
  Settings,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import {
  apiFetch,
  getFriendlyErrorMessage,
  isSupabaseConfiguredClient,
} from "@/components/layout/api-client";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { FadeIn } from "@/components/motion";
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
import { cn } from "@/lib/utils";
import type {
  AnswerMatchMode,
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
  role?: MemberRole;
  chapters?: Array<string | { name: string; count: number }>;
  tags?: Tag[];
}

interface EditableOption {
  /** Preserves existing UUID on edit; omitted for brand-new options */
  id?: string;
  localKey: string;
  content: string;
  is_correct: boolean;
}

interface EditableAcceptedAnswer {
  id?: string;
  localKey: string;
  answer_text: string;
  match_mode: AnswerMatchMode;
}

interface QuestionDraft {
  id?: string;
  question_type: QuestionType;
  prompt: string;
  prompt_image_url: string;
  back_text: string;
  chapter: string;
  difficulty: DifficultyLevel;
  explanation: string;
  hint: string;
  tagsText: string;
  options: EditableOption[];
  accepted_answers: EditableAcceptedAnswer[];
}

interface UploadedImageResponse {
  path: string;
  signedUrl: string;
  proxyUrl?: string;
  mimeType: string;
  size: number;
}

const ALLOWED_IMAGE_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function createEmptyDraft(defaultType: QuestionType = "single_choice"): QuestionDraft {
  return {
    question_type: defaultType,
    prompt: "",
    prompt_image_url: "",
    back_text: "",
    chapter: "",
    difficulty: "medium",
    explanation: "",
    hint: "",
    tagsText: "",
    options: [
      { localKey: "opt-0", content: "", is_correct: true },
      { localKey: "opt-1", content: "", is_correct: false },
      { localKey: "opt-2", content: "", is_correct: false },
      { localKey: "opt-3", content: "", is_correct: false },
    ],
    accepted_answers: [
      { localKey: "ans-0", answer_text: "", match_mode: "case_insensitive" },
    ],
  };
}

function questionToDraft(q: Question): QuestionDraft {
  const options: EditableOption[] =
    q.options && q.options.length > 0
      ? q.options.map((o, i) => ({
          id: o.id,
          localKey: o.id || `opt-${i}`,
          content: o.content,
          is_correct: o.is_correct,
        }))
      : [
          { localKey: "opt-0", content: "", is_correct: true },
          { localKey: "opt-1", content: "", is_correct: false },
        ];

  const accepted: EditableAcceptedAnswer[] =
    q.accepted_answers && q.accepted_answers.length > 0
      ? q.accepted_answers.map((a, i) => ({
          id: a.id,
          localKey: a.id || `ans-${i}`,
          answer_text: a.answer_text,
          match_mode: a.match_mode,
        }))
      : [{ localKey: "ans-0", answer_text: "", match_mode: "case_insensitive" }];

  return {
    id: q.id,
    question_type: q.question_type,
    prompt: q.prompt,
    prompt_image_url: q.prompt_image_url ?? "",
    back_text: q.back_text ?? "",
    chapter: q.chapter ?? "",
    difficulty: q.difficulty,
    explanation: q.explanation ?? "",
    hint: q.hint ?? "",
    tagsText: (q.tags ?? []).map((tag) => tag.name).join(", "),
    options,
    accepted_answers: accepted,
  };
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
  const [page, setPage] = React.useState(1);

  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set());
  const [bulkChapter, setBulkChapter] = React.useState("");
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = React.useState(false);
  const [deletingQuestion, setDeletingQuestion] = React.useState<{
    id: string;
    num: number;
    prompt: string;
  } | null>(null);

  const [editorOpen, setEditorOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<QuestionDraft>(() => createEmptyDraft());
  const [uploadingImage, setUploadingImage] = React.useState(false);

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

  const saveQuestionMutation = useMutation({
    mutationFn: async (current: QuestionDraft) => {
      const isChoice =
        current.question_type === "single_choice" ||
        current.question_type === "multiple_choice" ||
        current.question_type === "true_false";

      const cleanOptions = isChoice
        ? current.options
            .filter((o) => o.content.trim().length > 0)
            .map((o, idx) => ({
              ...(o.id ? { id: o.id } : {}),
              position: idx,
              label: String.fromCharCode(65 + idx),
              content: o.content.trim(),
              is_correct: o.is_correct,
            }))
        : undefined;

      const cleanAccepted =
        current.question_type === "flashcard" || current.question_type === "short_answer"
          ? current.accepted_answers
              .filter((a) => a.answer_text.trim().length > 0)
              .map((a) => ({
                ...(a.id ? { id: a.id } : {}),
                answer_text: a.answer_text.trim(),
                match_mode: a.match_mode,
              }))
          : undefined;

      const tags = current.tagsText
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const payload = {
        question_type: current.question_type,
        prompt: current.prompt.trim(),
        prompt_image_url: current.prompt_image_url.trim() || null,
        back_text: current.back_text.trim() || null,
        chapter: current.chapter.trim() || null,
        difficulty: current.difficulty,
        explanation: current.explanation.trim() || null,
        hint: current.hint.trim() || null,
        options: cleanOptions,
        accepted_answers: cleanAccepted,
        tags,
      };

      const url = current.id
        ? `/api/sets/${setId}/questions/${current.id}`
        : `/api/sets/${setId}/questions`;
      const method = current.id ? "PATCH" : "POST";

      const res = await apiFetch<Question>(url, {
        method,
        body: JSON.stringify(payload),
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["editor-questions", setId] });
      queryClient.invalidateQueries({ queryKey: ["set-questions", setId] });
      queryClient.invalidateQueries({ queryKey: ["study-set", setId] });
      setEditorOpen(false);
      toast.success(vi ? "Đã lưu câu hỏi." : "Question saved.");
    },
    onError: (err) => {
      toast.error(getFriendlyErrorMessage(err, locale));
    },
  });

  const deleteQuestionMutation = useMutation({
    mutationFn: async (questionId: string) => {
      await apiFetch(`/api/sets/${setId}/questions/${questionId}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      setDeletingQuestion(null);
      queryClient.invalidateQueries({ queryKey: ["editor-questions", setId] });
      queryClient.invalidateQueries({ queryKey: ["set-questions", setId] });
      queryClient.invalidateQueries({ queryKey: ["study-set", setId] });
      toast.success(vi ? "Đã xóa câu hỏi." : "Question deleted.");
    },
    onError: (err) => {
      toast.error(getFriendlyErrorMessage(err, locale));
    },
  });

  const bulkUpdateMutation = useMutation({
    mutationFn: async () => {
      await apiFetch(`/api/sets/${setId}/questions/bulk`, {
        method: "PATCH",
        body: JSON.stringify({
          question_ids: Array.from(selectedIds),
          chapter: bulkChapter.trim() || null,
        }),
      });
    },
    onSuccess: () => {
      setSelectedIds(new Set());
      setBulkChapter("");
      queryClient.invalidateQueries({ queryKey: ["editor-questions", setId] });
      queryClient.invalidateQueries({ queryKey: ["study-set", setId] });
      toast.success(vi ? "Đã cập nhật hàng loạt." : "Bulk update applied.");
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
    onSuccess: () => {
      setSelectedIds(new Set());
      setBulkDeleteConfirmOpen(false);
      queryClient.invalidateQueries({ queryKey: ["editor-questions", setId] });
      queryClient.invalidateQueries({ queryKey: ["study-set", setId] });
      toast.success(vi ? "Đã xóa các câu hỏi đã chọn." : "Selected questions deleted.");
    },
    onError: (err) => {
      toast.error(getFriendlyErrorMessage(err, locale));
    },
  });

  const isOwner =
    setQuery.data?.role === "owner" || setQuery.data?.role === undefined;

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["study-set", setId] });
      queryClient.invalidateQueries({ queryKey: ["study-sets"] });
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["study-sets"] });
      toast.success(vi ? "Đã xóa học phần." : "Study set deleted.");
      router.push("/library");
    },
    onError: (err) => {
      toast.error(getFriendlyErrorMessage(err, locale));
    },
  });

  // Server-validated upload via POST /api/uploads/image (fixes SH-019 & eliminates direct Supabase client import per SH-039)
  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!ALLOWED_IMAGE_MIME.has(file.type)) {
      toast.error(
        vi
          ? "Chỉ chấp nhận ảnh PNG, JPEG, WebP hoặc GIF (không hỗ trợ SVG)."
          : "Only PNG, JPEG, WebP, or GIF images are allowed (SVG is blocked).",
      );
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error(
        vi ? "Ảnh vượt quá giới hạn 5 MB." : "Image exceeds the 5 MB size limit.",
      );
      return;
    }

    setUploadingImage(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("purpose", "question");
      formData.append("studySetId", setId);

      const res = await apiFetch<UploadedImageResponse>("/api/uploads/image", {
        method: "POST",
        body: formData,
      });
      const resolvedUrl =
        res.data?.proxyUrl ?? res.data?.signedUrl ?? res.data?.path ?? "";
      if (!resolvedUrl) {
        throw new Error(t("common.errorGeneric"));
      }
      setDraft((prev) => ({
        ...prev,
        prompt_image_url: resolvedUrl,
      }));
      toast.success(vi ? "Đã tải ảnh lên thành công." : "Image uploaded successfully.");
    } catch (err) {
      toast.error(getFriendlyErrorMessage(err, locale));
    } finally {
      setUploadingImage(false);
    }
  };

  const questions = React.useMemo(
    () => questionsQuery.data?.items ?? [],
    [questionsQuery.data?.items],
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

  const isChoiceDraft =
    draft.question_type === "single_choice" ||
    draft.question_type === "multiple_choice" ||
    draft.question_type === "true_false";

  const hasActiveFilters =
    Boolean(debouncedSearch) ||
    chapterFilter !== "all" ||
    difficultyFilter !== "all" ||
    typeFilter !== "all" ||
    tagFilter !== "all";

  const handleSaveDraft = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.prompt.trim()) {
      toast.error(vi ? "Vui lòng nhập nội dung câu hỏi." : "Question prompt is required.");
      return;
    }
    if (isChoiceDraft) {
      const filled = draft.options.filter((o) => o.content.trim().length > 0);
      if (filled.length < 2) {
        toast.error(vi ? "Cần ít nhất 2 phương án trả lời." : "At least 2 options are required.");
        return;
      }
      if (!filled.some((o) => o.is_correct)) {
        toast.error(
          vi ? "Vui lòng chọn ít nhất 1 đáp án đúng." : "Select at least 1 correct option.",
        );
        return;
      }
    } else if (draft.question_type === "flashcard" && !draft.back_text.trim()) {
      toast.error(
        vi ? "Thẻ Flashcard cần nội dung mặt sau." : "Flashcards require back text.",
      );
      return;
    } else if (
      draft.question_type === "short_answer" &&
      !draft.accepted_answers.some((a) => a.answer_text.trim().length > 0) &&
      !draft.back_text.trim()
    ) {
      toast.error(
        vi
          ? "Câu trả lời ngắn cần ít nhất 1 đáp án chấp nhận."
          : "Short-answer questions require at least one accepted answer.",
      );
      return;
    }
    saveQuestionMutation.mutate(draft);
  };

  return (
    <FadeIn aboveFold className="space-y-6">
      <PageHeader
        title={`${t("common.edit")}: ${setQuery.data.title}`}
        breadcrumbs={[
          { label: t("library.title"), href: "/library" },
          { label: setQuery.data.title, href: `/sets/${setId}` },
          { label: t("common.edit") },
        ]}
        actions={
          <>
            <Button size="sm" variant="outline" asChild>
              <Link href={`/sets/${setId}/import`}>
                <Upload className="size-4" aria-hidden="true" />
                <span>{t("library.importSet")}</span>
              </Link>
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setDraft(
                  createEmptyDraft(
                    setQuery.data.set_type === "flashcards"
                      ? "flashcard"
                      : "single_choice",
                  ),
                );
                setEditorOpen(true);
              }}
            >
              <Plus className="size-4" aria-hidden="true" />
              <span>{vi ? "Thêm câu hỏi" : "Add question"}</span>
            </Button>
          </>
        }
      />

      <Tabs defaultValue="questions">
        <TabsList>
          <TabsTrigger value="questions">
            {vi ? "Danh sách câu hỏi" : "Questions"} ({totalCount.toLocaleString()})
          </TabsTrigger>
          <TabsTrigger value="settings">
            <Settings className="size-3.5" aria-hidden="true" />
            <span>{vi ? "Thông tin học phần" : "Set Settings"}</span>
          </TabsTrigger>
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
                  placeholder={vi ? "Tìm câu hỏi..." : "Search questions..."}
                  aria-label={vi ? "Tìm câu hỏi" : "Search questions"}
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
                  <SelectItem value="single_choice">
                    {t("questionType.single_choice")}
                  </SelectItem>
                  <SelectItem value="multiple_choice">
                    {t("questionType.multiple_choice")}
                  </SelectItem>
                  <SelectItem value="true_false">
                    {t("questionType.true_false")}
                  </SelectItem>
                  <SelectItem value="flashcard">
                    {t("questionType.flashcard")}
                  </SelectItem>
                  <SelectItem value="short_answer">
                    {t("questionType.short_answer")}
                  </SelectItem>
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
                    setPage(1);
                  }}
                >
                  {t("common.reset")}
                </Button>
              )}
            </div>

            {selectedIds.size > 0 && (
              <div className="border-primary/30 bg-accent flex flex-wrap items-center gap-2 rounded-lg border px-3 py-1.5">
                <span className="text-accent-foreground font-mono text-xs font-semibold tabular-nums">
                  {selectedIds.size} {vi ? "đã chọn" : "selected"}
                </span>
                <Input
                  value={bulkChapter}
                  onChange={(e) => setBulkChapter(e.target.value)}
                  placeholder={vi ? "Gán chương..." : "Assign chapter..."}
                  className="bg-card h-8 w-40 text-xs"
                />
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
              icon={Plus}
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
                  : vi
                    ? "Bấm \"Thêm câu hỏi\" để tạo câu trắc nghiệm hoặc flashcard, hoặc dùng công cụ Nhập từ file."
                    : "Click \"Add question\" to author a new multiple-choice question or flashcard, or bulk import from a file."
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
                    }}
                  >
                    {t("common.reset")}
                  </Button>
                ) : (
                  <Button
                    onClick={() => {
                      setDraft(createEmptyDraft());
                      setEditorOpen(true);
                    }}
                  >
                    <Plus className="size-4" aria-hidden="true" />
                    <span>{vi ? "Thêm câu hỏi" : "Add question"}</span>
                  </Button>
                )
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
                      const globalNum = (page - 1) * 500 + vRow.index + 1;
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
                          <div className="border-border bg-background hover:border-primary/40 flex items-center gap-3 rounded-lg border px-3.5 py-3 transition-colors">
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
                            <span className="text-muted-foreground w-10 shrink-0 font-mono text-xs tabular-nums">
                              #{globalNum}
                            </span>
                            <button
                              type="button"
                              onClick={() => {
                                setDraft(questionToDraft(q));
                                setEditorOpen(true);
                              }}
                              className="min-w-0 flex-1 text-left"
                            >
                              <p className="text-foreground line-clamp-1 text-sm font-medium">
                                {q.prompt}
                              </p>
                              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                                <Badge variant="secondary">
                                  {t(`questionType.${q.question_type}`)}
                                </Badge>
                                <Badge variant="outline">
                                  {t(`difficulty.${q.difficulty}`)}
                                </Badge>
                                {q.chapter && (
                                  <Badge variant="outline">{q.chapter}</Badge>
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
                            </button>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="text-destructive hover:bg-destructive-subtle"
                              aria-label={`${t("common.delete")} #${globalNum}`}
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

        {/* Set Metadata Settings Tab */}
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
      </Tabs>

      {/* Add / Edit Single Question Dialog */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto overscroll-contain sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {draft.id
                ? vi
                  ? "Chỉnh sửa câu hỏi"
                  : "Edit question"
                : vi
                  ? "Thêm câu hỏi mới"
                  : "Add new question"}
            </DialogTitle>
            <DialogDescription>
              {vi
                ? "Các phương án cũ giữ nguyên mã định danh để không làm sai lệch thống kê và bài thi trước đó."
                : "Existing answer choices retain stable identifiers so past exam stats remain accurate."}
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSaveDraft} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="q-type">{vi ? "Dạng câu hỏi" : "Question type"}</Label>
                <Select
                  value={draft.question_type}
                  onValueChange={(val) => {
                    const nextType = val as QuestionType;
                    setDraft((prev) => {
                      if (nextType === "true_false") {
                        return {
                          ...prev,
                          question_type: nextType,
                          options: [
                            {
                              id: prev.options[0]?.id,
                              localKey: prev.options[0]?.localKey ?? "tf-0",
                              content: prev.options[0]?.content || (vi ? "Đúng" : "True"),
                              is_correct: true,
                            },
                            {
                              id: prev.options[1]?.id,
                              localKey: prev.options[1]?.localKey ?? "tf-1",
                              content: prev.options[1]?.content || (vi ? "Sai" : "False"),
                              is_correct: false,
                            },
                          ],
                        };
                      }
                      // Collapse multiple correct flags when switching to single_choice (fixes QB-03)
                      if (nextType === "single_choice") {
                        const firstCorrectIdx = prev.options.findIndex((o) => o.is_correct);
                        const keepIdx = firstCorrectIdx >= 0 ? firstCorrectIdx : 0;
                        return {
                          ...prev,
                          question_type: nextType,
                          options: prev.options.map((o, idx) => ({
                            ...o,
                            is_correct: idx === keepIdx,
                          })),
                        };
                      }
                      return { ...prev, question_type: nextType };
                    });
                  }}
                >
                  <SelectTrigger id="q-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="single_choice">
                      {t("questionType.single_choice")}
                    </SelectItem>
                    <SelectItem value="multiple_choice">
                      {t("questionType.multiple_choice")}
                    </SelectItem>
                    <SelectItem value="true_false">
                      {t("questionType.true_false")}
                    </SelectItem>
                    <SelectItem value="flashcard">
                      {t("questionType.flashcard")}
                    </SelectItem>
                    <SelectItem value="short_answer">
                      {t("questionType.short_answer")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="q-chapter">{vi ? "Chương / Phần" : "Chapter"}</Label>
                <Input
                  id="q-chapter"
                  placeholder={vi ? "VD: Chương 1" : "e.g., Chapter 1"}
                  value={draft.chapter}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, chapter: e.target.value }))
                  }
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="q-difficulty">{vi ? "Độ khó" : "Difficulty"}</Label>
                <Select
                  value={draft.difficulty}
                  onValueChange={(v) =>
                    setDraft((prev) => ({ ...prev, difficulty: v as DifficultyLevel }))
                  }
                >
                  <SelectTrigger id="q-difficulty">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="easy">{t("difficulty.easy")}</SelectItem>
                    <SelectItem value="medium">{t("difficulty.medium")}</SelectItem>
                    <SelectItem value="hard">{t("difficulty.hard")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="q-prompt">
                {draft.question_type === "flashcard"
                  ? vi
                    ? "Mặt trước / Thuật ngữ"
                    : "Front / Term"
                  : vi
                    ? "Nội dung câu hỏi"
                    : "Question stem"}{" "}
                <span className="text-destructive">*</span>
              </Label>
              <Textarea
                id="q-prompt"
                required
                rows={3}
                value={draft.prompt}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, prompt: e.target.value }))
                }
              />
            </div>

            {/* Optional Image Upload via POST /api/uploads/image */}
            <div className="space-y-1.5">
              <Label htmlFor="q-image-url">
                {vi
                  ? "Ảnh minh họa (tùy chọn, PNG/JPG/WebP ≤ 5MB)"
                  : "Optional image (PNG/JPG/WebP ≤ 5MB)"}
              </Label>
              <div className="flex gap-2">
                <Input
                  id="q-image-url"
                  type="url"
                  placeholder="https://..."
                  value={draft.prompt_image_url}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, prompt_image_url: e.target.value }))
                  }
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  asChild
                  disabled={uploadingImage}
                >
                  <label className="cursor-pointer">
                    {uploadingImage ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <ImagePlus className="size-4" aria-hidden="true" />
                    )}
                    <span>{vi ? "Tải ảnh" : "Upload"}</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp,image/gif"
                      className="sr-only"
                      onChange={(e) => void handleImageUpload(e)}
                    />
                  </label>
                </Button>
              </div>
            </div>

            {/* Choice Options (2-6) */}
            {isChoiceDraft ? (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between">
                  <Label>
                    {vi
                      ? "Các phương án (bấm nút chữ cái để chọn đáp án đúng)"
                      : "Options (toggle correct answer)"}
                  </Label>
                  {draft.options.length < 6 && draft.question_type !== "true_false" && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setDraft((prev) => ({
                          ...prev,
                          options: [
                            ...prev.options,
                            {
                              localKey: `opt-${Date.now()}-${prev.options.length}`,
                              content: "",
                              is_correct: false,
                            },
                          ],
                        }))
                      }
                    >
                      <Plus className="size-3.5" aria-hidden="true" />
                      <span>{vi ? "Thêm phương án" : "Add option"}</span>
                    </Button>
                  )}
                </div>

                <div className="space-y-2">
                  {draft.options.map((opt, idx) => {
                    const letter = String.fromCharCode(65 + idx);
                    return (
                      <div key={opt.localKey} className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setDraft((prev) => ({
                              ...prev,
                              options: prev.options.map((item, i) => {
                                if (prev.question_type === "multiple_choice") {
                                  return i === idx
                                    ? { ...item, is_correct: !item.is_correct }
                                    : item;
                                }
                                return { ...item, is_correct: i === idx };
                              }),
                            }));
                          }}
                          aria-pressed={opt.is_correct}
                          aria-label={`${vi ? "Đánh dấu đáp án đúng" : "Mark correct"} ${letter}`}
                          className={cn(
                            "flex size-10 shrink-0 items-center justify-center rounded-lg border font-mono text-xs font-bold transition-colors",
                            opt.is_correct
                              ? "border-success bg-success text-success-foreground"
                              : "border-border bg-secondary text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {opt.is_correct ? (
                            <Check className="size-4" aria-hidden="true" />
                          ) : (
                            letter
                          )}
                        </button>
                        <Input
                          value={opt.content}
                          placeholder={`${vi ? "Phương án" : "Option"} ${letter}`}
                          onChange={(e) => {
                            const val = e.target.value;
                            setDraft((prev) => ({
                              ...prev,
                              options: prev.options.map((item, i) =>
                                i === idx ? { ...item, content: val } : item,
                              ),
                            }));
                          }}
                        />
                        {draft.options.length > 2 && draft.question_type !== "true_false" && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`${t("common.delete")} ${letter}`}
                            onClick={() =>
                              setDraft((prev) => ({
                                ...prev,
                                options: prev.options.filter((_, i) => i !== idx),
                              }))
                            }
                          >
                            <Trash2 className="size-4" aria-hidden="true" />
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              /* Flashcard Back & Accepted Answers */
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="q-back-text">
                    {vi ? "Mặt sau / Định nghĩa" : "Back / Definition"}
                  </Label>
                  <Textarea
                    id="q-back-text"
                    rows={3}
                    value={draft.back_text}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, back_text: e.target.value }))
                    }
                  />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label>
                      {vi
                        ? "Đáp án chấp nhận cho chế độ Gõ (Write)"
                        : "Accepted answers for Write mode"}
                    </Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setDraft((prev) => ({
                          ...prev,
                          accepted_answers: [
                            ...prev.accepted_answers,
                            {
                              localKey: `ans-${Date.now()}`,
                              answer_text: "",
                              match_mode: "case_insensitive",
                            },
                          ],
                        }))
                      }
                    >
                      <Plus className="size-3.5" aria-hidden="true" />
                      <span>{t("common.add")}</span>
                    </Button>
                  </div>

                  {draft.accepted_answers.map((ans, idx) => (
                    <div
                      key={ans.localKey}
                      className="flex flex-col gap-2 sm:flex-row sm:items-center"
                    >
                      <Input
                        value={ans.answer_text}
                        placeholder={vi ? "Đáp án chấp nhận..." : "Accepted answer..."}
                        onChange={(e) => {
                          const val = e.target.value;
                          setDraft((prev) => ({
                            ...prev,
                            accepted_answers: prev.accepted_answers.map((item, i) =>
                              i === idx ? { ...item, answer_text: val } : item,
                            ),
                          }));
                        }}
                      />
                      <Select
                        value={ans.match_mode}
                        onValueChange={(v) =>
                          setDraft((prev) => ({
                            ...prev,
                            accepted_answers: prev.accepted_answers.map((item, i) =>
                              i === idx
                                ? { ...item, match_mode: v as AnswerMatchMode }
                                : item,
                            ),
                          }))
                        }
                      >
                        <SelectTrigger className="w-full sm:w-44">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="case_insensitive">
                            {vi ? "Không phân biệt hoa thường" : "Case insensitive"}
                          </SelectItem>
                          <SelectItem value="ignore_diacritics">
                            {vi ? "Bỏ qua dấu tiếng Việt" : "Ignore diacritics"}
                          </SelectItem>
                          <SelectItem value="exact">
                            {vi ? "Chính xác tuyệt đối" : "Exact match"}
                          </SelectItem>
                          <SelectItem value="numeric">
                            {vi ? "So sánh số học" : "Numeric"}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      {draft.accepted_answers.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`${t("common.delete")} ${idx + 1}`}
                          onClick={() =>
                            setDraft((prev) => ({
                              ...prev,
                              accepted_answers: prev.accepted_answers.filter(
                                (_, i) => i !== idx,
                              ),
                            }))
                          }
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="q-explanation">
                {t("study.explanation")} ({vi ? "tùy chọn" : "optional"})
              </Label>
              <Textarea
                id="q-explanation"
                rows={2}
                value={draft.explanation}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, explanation: e.target.value }))
                }
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="q-tags">
                  {vi ? "Thẻ (phân tách bằng dấu phẩy)" : "Tags (comma separated)"}
                </Label>
                <Input
                  id="q-tags"
                  placeholder={vi ? "ôn thi, giữa kỳ" : "midterm, key-concept"}
                  value={draft.tagsText}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, tagsText: e.target.value }))
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="q-hint">{vi ? "Gợi ý (tùy chọn)" : "Hint (optional)"}</Label>
                <Input
                  id="q-hint"
                  value={draft.hint}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, hint: e.target.value }))
                  }
                />
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditorOpen(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={saveQuestionMutation.isPending}>
                {saveQuestionMutation.isPending && (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                )}
                <span>{t("common.save")}</span>
              </Button>
            </DialogFooter>
          </form>
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
