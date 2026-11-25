"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AlertCircle,
  CheckSquare,
  ChevronDown,
  Copy,
  Eye,
  Flag,
  FolderInput,
  Image as ImageIcon,
  ImagePlus,
  Loader2,
  Lock,
  Pencil,
  Plus,
  Printer,
  RotateCcw,
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
import { RichContentRenderer } from "@/components/richtext/RichContentRenderer";
import { computeQuestionDuplicateFingerprint } from "@/lib/import/validator";
import { uploadImageSmart } from "@/lib/media/direct-upload";
import { appendMediaRetryParam } from "@/lib/media/urls";
import { validateQuestionByType } from "@/lib/questions";
import { invalidateStudySetCaches } from "@/lib/query-keys";
import { PdfExportDialog } from "./PdfExportDialog";
import { QuestionNotePanel } from "./QuestionNotePanel";
import { QuestionReportDialog } from "./QuestionReportDialog";
import { ReportsInboxPanel } from "./ReportsInboxPanel";
import {
  createDefaultPayloadForType,
  isChoiceCapableDraft,
  V3QuestionTypeFields,
  type EditableAcceptedAnswer,
  type EditableOption,
  type QuestionDraft,
} from "./V3QuestionTypeFields";
import {
  V3_QUESTION_TYPES,
  type DiagramSet,
  type SharedPassage,
} from "@/types/v3";

const RichTextEditor = dynamic(
  () => import("@/components/richtext/RichTextEditor").then((m) => m.RichTextEditor),
  { ssr: false },
);
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

function PromptImageThumbnail({
  src,
  alt,
  vi,
}: {
  src: string;
  alt: string;
  vi: boolean;
}) {
  const imgRef = React.useRef<HTMLImageElement | null>(null);
  const [state, setState] = React.useState<{
    baseSrc: string;
    resolvedSrc: string;
    status: "loading" | "loaded" | "error";
    autoRetried: boolean;
  }>({
    baseSrc: src,
    resolvedSrc: src,
    status: "loading",
    autoRetried: false,
  });

  const effective =
    state.baseSrc === src
      ? state
      : {
          baseSrc: src,
          resolvedSrc: src,
          status: "loading" as const,
          autoRetried: false,
        };

  React.useEffect(() => {
    const el = imgRef.current;
    if (el && el.complete && el.naturalWidth > 0 && effective.status === "loading") {
      setState({
        baseSrc: src,
        resolvedSrc: effective.resolvedSrc,
        status: "loaded",
        autoRetried: effective.autoRetried,
      });
    }
  }, [src, effective.resolvedSrc, effective.status, effective.autoRetried]);

  const handleError = () => {
    if (!effective.autoRetried && !src.startsWith("blob:") && !src.startsWith("data:")) {
      setState({
        baseSrc: src,
        resolvedSrc: appendMediaRetryParam(src),
        status: "loading",
        autoRetried: true,
      });
      return;
    }
    setState({
      baseSrc: src,
      resolvedSrc: effective.resolvedSrc,
      status: "error",
      autoRetried: true,
    });
  };

  if (effective.status === "error") {
    return (
      <div className="flex h-20 w-40 flex-col items-center justify-center gap-1 rounded-md border border-destructive/30 bg-destructive/5 px-2 text-center">
        <span className="text-[11px] text-destructive">
          {vi ? "Không tải được ảnh" : "Image failed to load"}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1 px-2 text-[11px]"
          onClick={() =>
            setState({
              baseSrc: src,
              resolvedSrc: appendMediaRetryParam(src),
              status: "loading",
              autoRetried: true,
            })
          }
        >
          <RotateCcw className="size-3" aria-hidden="true" />
          {vi ? "Thử lại" : "Retry"}
        </Button>
      </div>
    );
  }

  return (
    <div className="relative flex h-20 min-w-[112px] max-w-[180px] items-center justify-center overflow-hidden rounded-md border border-border bg-background">
      {effective.status === "loading" && (
        <Skeleton
          aria-label={vi ? "Đang tải ảnh minh họa" : "Loading illustration image"}
          className="absolute inset-0 h-full w-full rounded-md"
        />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={effective.resolvedSrc}
        alt={alt}
        decoding="async"
        onLoad={() =>
          setState({
            baseSrc: src,
            resolvedSrc: effective.resolvedSrc,
            status: "loaded",
            autoRetried: effective.autoRetried,
          })
        }
        onError={handleError}
        className={`h-20 max-w-[180px] object-contain transition-opacity duration-150 ${
          effective.status === "loaded" ? "opacity-100" : "opacity-0"
        }`}
      />
    </div>
  );
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
    prompt_rich: null,
    prompt_image_url: "",
    back_text: "",
    back_rich: null,
    chapter: "",
    difficulty: "medium",
    explanation: "",
    explanation_rich: null,
    hint: "",
    tagsText: "",
    audio_url: "",
    audio_transcript: "",
    passage_id: "",
    diagram_id: "",
    options: [
      { localKey: "opt-0", content: "", image_url: "", is_correct: true },
      { localKey: "opt-1", content: "", image_url: "", is_correct: false },
      { localKey: "opt-2", content: "", image_url: "", is_correct: false },
      { localKey: "opt-3", content: "", image_url: "", is_correct: false },
    ],
    accepted_answers: [
      { localKey: "ans-0", answer_text: "", match_mode: "case_insensitive" },
    ],
    type_payload: createDefaultPayloadForType(defaultType),
  };
}

function questionToDraft(q: Question): QuestionDraft {
  const options: EditableOption[] =
    q.options && q.options.length > 0
      ? q.options.map((o, i) => ({
          id: o.id,
          localKey: o.id || `opt-${i}`,
          content: o.content,
          content_rich: o.content_rich ?? null,
          image_url: o.image_url ?? "",
          image_alt: o.image_alt ?? "",
          is_correct: o.is_correct,
        }))
      : [
          { localKey: "opt-0", content: "", image_url: "", is_correct: true },
          { localKey: "opt-1", content: "", image_url: "", is_correct: false },
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
    prompt_rich: q.prompt_rich ?? null,
    prompt_image_url: q.prompt_image_url ?? "",
    back_text: q.back_text ?? "",
    back_rich: q.back_rich ?? null,
    chapter: q.chapter ?? "",
    difficulty: q.difficulty,
    explanation: q.explanation ?? "",
    explanation_rich: q.explanation_rich ?? null,
    hint: q.hint ?? "",
    tagsText: (q.tags ?? []).map((tag) => tag.name).join(", "),
    audio_url: q.audio_url ?? "",
    audio_transcript: q.audio_transcript ?? "",
    passage_id: q.passage_id ?? "",
    diagram_id: q.diagram_id ?? "",
    options,
    accepted_answers: accepted,
    type_payload: q.type_payload ?? createDefaultPayloadForType(q.question_type),
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
  const [useRichPrompt, setUseRichPrompt] = React.useState(false);
  const [showLivePreview, setShowLivePreview] = React.useState(false);
  const [secondaryFieldsOpen, setSecondaryFieldsOpen] = React.useState(false);
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

  const passagesQuery = useQuery<SharedPassage[]>({
    queryKey: ["set-passages", setId],
    enabled: configured,
    queryFn: async () => {
      const res = await apiFetch<SharedPassage[]>(
        `/api/passages?studySetId=${encodeURIComponent(setId)}`,
      );
      return Array.isArray(res.data) ? res.data : [];
    },
  });

  const diagramsQuery = useQuery<DiagramSet[]>({
    queryKey: ["set-diagrams", setId],
    enabled: configured,
    queryFn: async () => {
      const res = await apiFetch<DiagramSet[]>(`/api/sets/${setId}/diagrams`);
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
      const isChoice = isChoiceCapableDraft(current);

      const cleanOptions = isChoice
        ? current.options
            .filter(
              (o) => o.content.trim().length > 0 || Boolean(o.image_url?.trim()),
            )
            .map((o, idx) => ({
              ...(o.id ? { id: o.id } : {}),
              position: idx,
              label: String.fromCharCode(65 + idx),
              content: o.content.trim(),
              content_rich: o.content_rich ?? null,
              image_url: o.image_url?.trim() || null,
              image_alt: o.image_alt?.trim() || null,
              is_correct: o.is_correct,
            }))
        : undefined;

      const needsAccepted =
        current.question_type === "flashcard" ||
        current.question_type === "short_answer" ||
        (current.type_payload?.type === "reading_passage" &&
          current.type_payload.sub_answer_kind === "short_answer") ||
        (current.type_payload?.type === "listening" &&
          current.type_payload.sub_answer_kind === "short_answer");

      const cleanAccepted = needsAccepted
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
        prompt_rich: current.prompt_rich ?? null,
        prompt_image_url: current.prompt_image_url.trim() || null,
        back_text: current.back_text.trim() || null,
        back_rich: current.back_rich ?? null,
        chapter: current.chapter.trim() || null,
        difficulty: current.difficulty,
        explanation: current.explanation.trim() || null,
        explanation_rich: current.explanation_rich ?? null,
        hint: current.hint.trim() || null,
        audio_url: current.audio_url.trim() || null,
        audio_transcript: current.audio_transcript.trim() || null,
        passage_id: current.passage_id || null,
        diagram_id: current.diagram_id || null,
        type_payload: current.type_payload,
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
    onSuccess: async () => {
      await invalidateStudySetCaches(queryClient, setId);
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
      const response = await uploadImageSmart({
        file,
        fileName: file.name,
        purpose: "question",
        studySetId: setId,
      });
      const res = (await response.json()) as {
        data?: UploadedImageResponse;
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(res.error?.message ?? t("common.errorGeneric"));
      }
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
    tagFilter !== "all";

  const submitDraft = () => {
    if (!canEdit) return;
    const validation = validateQuestionByType({
      question_type: draft.question_type,
      prompt: draft.prompt.trim(),
      prompt_rich: draft.prompt_rich ?? null,
      prompt_image_url: draft.prompt_image_url.trim() || null,
      back_text: draft.back_text.trim() || null,
      audio_url: draft.audio_url.trim() || null,
      diagram_id: draft.diagram_id || null,
      passage_id: draft.passage_id || null,
      type_payload: draft.type_payload,
      options: draft.options
        .filter((o) => o.content.trim().length > 0 || Boolean(o.image_url?.trim()))
        .map((o, idx) => ({
          id: o.id ?? o.localKey,
          label: String.fromCharCode(65 + idx),
          content: o.content.trim(),
          image_url: o.image_url?.trim() || null,
          is_correct: o.is_correct,
        })),
      accepted_answers: draft.accepted_answers
        .filter((a) => a.answer_text.trim().length > 0)
        .map((a) => ({
          answer_text: a.answer_text.trim(),
          match_mode: a.match_mode,
        })),
    });

    if (!validation.valid) {
      toast.error(validation.errors[0] ?? (vi ? "Vui lòng kiểm tra lại dữ liệu câu hỏi." : "Please check question fields."));
      return;
    }
    saveQuestionMutation.mutate(draft);
  };

  const handleSaveDraft = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitDraft();
  };

  const openCreateQuestionModal = () => {
    if (!canEdit) return;
    setDraft(
      createEmptyDraft(
        setQuery.data.set_type === "flashcards" ? "flashcard" : "single_choice",
      ),
    );
    setShowLivePreview(false);
    setUseRichPrompt(false);
    setSecondaryFieldsOpen(false);
    setEditorOpen(true);
  };

  const openEditQuestionModal = (q: Question) => {
    if (!canEdit) return;
    setDraft(questionToDraft(q));
    setShowLivePreview(false);
    setUseRichPrompt(Boolean(q.prompt_rich));
    setSecondaryFieldsOpen(false);
    setEditorOpen(true);
  };

  const secondaryFilledCount =
    (draft.explanation.trim() ? 1 : 0) +
    (draft.hint.trim() ? 1 : 0) +
    (draft.tagsText.trim() ? 1 : 0);

  return (
    <FadeIn aboveFold className="space-y-6">
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
                      const globalNum = (page - 1) * 500 + vRow.index + 1;
                      const hasImage =
                        Boolean(q.prompt_image_url) ||
                        Boolean(q.back_image_url) ||
                        Boolean(q.options?.some((opt) => Boolean(opt.image_url))) ||
                        (q.type_payload?.type === "image_hotspot" &&
                          Boolean(q.type_payload.image_url));
                      const hasAudio =
                        Boolean(q.audio_url) ||
                        Boolean(q.audio_media_id) ||
                        (q.type_payload?.type === "listening" &&
                          Boolean(q.type_payload.audio_url));

                      const rowContent = (
                        <>
                          <p className="text-foreground line-clamp-1 text-sm font-medium">
                            {q.prompt}
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
                                <span>{vi ? "Ảnh" : "Image"}</span>
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
                const target = questions.find((item) => item.id === questionId);
                if (target) {
                  openEditQuestionModal(target);
                } else {
                  toast.info(
                    vi
                      ? "Câu hỏi nằm ở trang khác — hãy dùng ô tìm kiếm trong tab Danh sách câu hỏi."
                      : "Question is on another page — search for it in the Questions tab.",
                  );
                }
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

      {/* Add / Edit Single Question Dialog (Sticky Header + Scrollable Body + Sticky Footer — UX31-13 / RU-10) */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="flex max-h-[90dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
          <DialogHeader className="shrink-0 border-b border-border bg-background px-6 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2 pr-8">
              <div>
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
                    ? "Hỗ trợ 12 dạng câu hỏi & thẻ ghi nhớ, công thức toán học và hình ảnh hoặc âm thanh minh họa."
                    : "Supports 12 question types & flashcards, math formulas, and image or audio attachments."}
                </DialogDescription>
              </div>
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant={showLivePreview ? "default" : "outline"}
                  onClick={() => setShowLivePreview((v) => !v)}
                  className="h-8 gap-1 text-xs"
                >
                  <Eye className="size-3.5" aria-hidden="true" />
                  {showLivePreview
                    ? vi
                      ? "Quay lại sửa"
                      : "Back to Edit"
                    : vi
                      ? "Xem trước"
                      : "Preview"}
                </Button>
                {draft.id && (
                  <QuestionReportDialog
                    questionId={draft.id}
                    studySetId={setId}
                    locale={locale}
                  />
                )}
              </div>
            </div>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-4">
            {showLivePreview ? (
              <div className="space-y-4 rounded-lg border border-border bg-muted/20 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">
                    {getQuestionTypeLabel(draft.question_type, locale)}
                  </Badge>
                  <Badge variant="outline">{t(`difficulty.${draft.difficulty}`)}</Badge>
                  {draft.chapter && <Badge variant="outline">{draft.chapter}</Badge>}
                </div>
                <RichContentRenderer
                  richDoc={draft.prompt_rich}
                  plainText={draft.prompt}
                  className="text-base font-medium"
                />
                {draft.prompt_image_url && (
                  <PromptImageThumbnail
                    src={draft.prompt_image_url}
                    alt={vi ? "Ảnh câu hỏi" : "Question image"}
                    vi={vi}
                  />
                )}
                {isChoiceCapableDraft(draft) && (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {draft.options.map((o, idx) => (
                      <div
                        key={o.localKey}
                        className={`rounded-lg border p-2.5 text-sm ${
                          o.is_correct
                            ? "border-success/60 bg-success-subtle"
                            : "border-border bg-card"
                        }`}
                      >
                        <div className="font-medium">
                          {String.fromCharCode(65 + idx)}.{" "}
                          <RichContentRenderer
                            richDoc={o.content_rich}
                            plainText={o.content}
                            inline
                            className="inline"
                          />
                        </div>
                        {o.image_url && (
                          <div className="mt-1.5">
                            <PromptImageThumbnail
                              src={o.image_url}
                              alt={`Option ${String.fromCharCode(65 + idx)}`}
                              vi={vi}
                            />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {draft.explanation && (
                  <div className="rounded-lg border border-border bg-card p-3 text-sm">
                    <div className="mb-1 text-xs font-semibold text-muted-foreground">
                      {t("study.explanation")}
                    </div>
                    <RichContentRenderer
                      richDoc={draft.explanation_rich}
                      plainText={draft.explanation}
                    />
                  </div>
                )}
              </div>
            ) : (
              <form id="question-editor-form" onSubmit={handleSaveDraft} className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="q-type">{vi ? "Dạng câu hỏi" : "Question type"}</Label>
                    <Select
                      value={draft.question_type}
                      onValueChange={(val) => {
                        const nextType = val as QuestionType;
                        setDraft((prev) => {
                          const nextPayload =
                            prev.type_payload?.type === nextType
                              ? prev.type_payload
                              : createDefaultPayloadForType(nextType);

                          if (nextType === "true_false") {
                            return {
                              ...prev,
                              question_type: nextType,
                              type_payload: null,
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
                          if (nextType === "single_choice") {
                            const firstCorrectIdx = prev.options.findIndex((o) => o.is_correct);
                            const keepIdx = firstCorrectIdx >= 0 ? firstCorrectIdx : 0;
                            return {
                              ...prev,
                              question_type: nextType,
                              type_payload: null,
                              options: prev.options.map((o, idx) => ({
                                ...o,
                                is_correct: idx === keepIdx,
                              })),
                            };
                          }
                          return {
                            ...prev,
                            question_type: nextType,
                            type_payload: nextPayload,
                          };
                        });
                      }}
                    >
                      <SelectTrigger id="q-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {V3_QUESTION_TYPES.map((qType) => (
                          <SelectItem key={qType} value={qType}>
                            {getQuestionTypeLabel(qType, locale)}
                          </SelectItem>
                        ))}
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
                  <div className="flex items-center justify-between gap-2">
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
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-xs"
                      onClick={() => setUseRichPrompt((v) => !v)}
                    >
                      {useRichPrompt
                        ? vi
                          ? "Chuyển về văn bản thường"
                          : "Switch to plain text"
                        : vi
                          ? "Soạn thảo nâng cao & Công thức"
                          : "Rich Text & Math Editor"}
                    </Button>
                  </div>

                  {useRichPrompt ? (
                    <RichTextEditor
                      locale={locale}
                      value={draft.prompt_rich}
                      fallbackPlainText={draft.prompt}
                      onChange={(doc, plain) =>
                        setDraft((prev) => ({
                          ...prev,
                          prompt_rich: doc,
                          prompt: plain,
                        }))
                      }
                    />
                  ) : (
                    <Textarea
                      id="q-prompt"
                      rows={3}
                      value={draft.prompt}
                      placeholder={
                        vi
                          ? "Nhập nội dung câu hỏi (hỗ trợ công thức $...$ hoặc $$...$$)"
                          : "Enter question stem (supports $...$ or $$...$$ math)"
                      }
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          prompt: e.target.value,
                          prompt_rich: null,
                        }))
                      }
                    />
                  )}
                </div>

                {/* Optional Image Upload via POST /api/uploads/image */}
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Label htmlFor="q-image-url">
                      {vi
                        ? "Ảnh minh họa (tùy chọn, PNG/JPG/WebP ≤ 5MB)"
                        : "Illustration image (optional, PNG/JPG/WebP ≤ 5MB)"}
                    </Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      asChild
                      disabled={uploadingImage}
                    >
                      <label className="cursor-pointer gap-1.5">
                        {uploadingImage ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <ImagePlus className="size-4" aria-hidden="true" />
                        )}
                        <span>
                          {draft.prompt_image_url
                            ? vi
                              ? "Đổi ảnh"
                              : "Change image"
                            : vi
                              ? "Thêm ảnh minh họa"
                              : "Add image"}
                        </span>
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/gif"
                          className="sr-only"
                          onChange={(e) => void handleImageUpload(e)}
                        />
                      </label>
                    </Button>
                  </div>

                  {draft.prompt_image_url && (
                    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/20 p-2.5">
                      <PromptImageThumbnail
                        src={draft.prompt_image_url}
                        alt={vi ? "Ảnh minh họa câu hỏi" : "Question illustration preview"}
                        vi={vi}
                      />
                      <div className="flex flex-col items-start gap-1">
                        <span className="text-xs font-medium text-foreground">
                          {vi ? "Đã đính kèm ảnh minh họa" : "Image attached"}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                          onClick={() =>
                            setDraft((prev) => ({ ...prev, prompt_image_url: "" }))
                          }
                        >
                          <Trash2 className="mr-1 size-3.5" aria-hidden="true" />
                          {vi ? "Gỡ ảnh" : "Remove image"}
                        </Button>
                      </div>
                    </div>
                  )}

                  <details className="rounded-md border border-border/70 bg-muted/15 px-3 py-1.5">
                    <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                      {draft.prompt_image_url
                        ? vi
                          ? "Xem / chỉnh sửa liên kết ảnh (URL)"
                          : "View / edit image URL"
                        : vi
                          ? "Hoặc dán liên kết ảnh trực tiếp (URL)"
                          : "Or paste an image URL directly"}
                    </summary>
                    <div className="pt-2 pb-1">
                      <Input
                        id="q-image-url"
                        type="text"
                        inputMode="url"
                        placeholder="https://..."
                        value={draft.prompt_image_url}
                        onChange={(e) =>
                          setDraft((prev) => ({ ...prev, prompt_image_url: e.target.value }))
                        }
                      />
                    </div>
                  </details>
                </div>

                {/* Structured Type-Specific Fields */}
                <V3QuestionTypeFields
                  setId={setId}
                  locale={locale}
                  draft={draft}
                  setDraft={setDraft}
                  passages={passagesQuery.data ?? []}
                  diagrams={diagramsQuery.data ?? []}
                />

                {/* Progressive Disclosure: Secondary Explanation, Hint, Tags & Personal Notes (UX31-13 / RU-10) */}
                <div className="rounded-lg border border-border bg-muted/15">
                  <button
                    type="button"
                    aria-expanded={secondaryFieldsOpen}
                    onClick={() => setSecondaryFieldsOpen((prev) => !prev)}
                    className="flex w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left text-xs font-medium text-foreground transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex items-center gap-2">
                      <span>
                        {vi
                          ? "Mở rộng giải thích, gợi ý & thẻ"
                          : "More options: explanation, hint, tags & notes"}
                      </span>
                      {secondaryFilledCount > 0 && (
                        <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                          {secondaryFilledCount}
                        </Badge>
                      )}
                    </span>
                    <ChevronDown
                      className={`size-4 shrink-0 text-muted-foreground transition-transform duration-150 ${
                        secondaryFieldsOpen ? "rotate-180" : ""
                      }`}
                      aria-hidden="true"
                    />
                  </button>

                  {secondaryFieldsOpen && (
                    <div className="space-y-4 border-t border-border px-3.5 py-3.5">
                      <div className="space-y-1.5">
                        <Label htmlFor="q-explanation">
                          {t("study.explanation")} ({vi ? "tùy chọn, hỗ trợ công thức" : "optional, supports math"})
                        </Label>
                        <Textarea
                          id="q-explanation"
                          rows={2}
                          value={draft.explanation}
                          onChange={(e) =>
                            setDraft((prev) => ({
                              ...prev,
                              explanation: e.target.value,
                              explanation_rich: null,
                            }))
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

                      {draft.id && (
                        <QuestionNotePanel
                          questionId={draft.id}
                          studySetId={setId}
                          locale={locale}
                          compact
                        />
                      )}
                    </div>
                  )}
                </div>
              </form>
            )}
          </div>

          <DialogFooter className="shrink-0 border-t border-border bg-background px-6 py-3.5">
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditorOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            {showLivePreview ? (
              <Button
                type="button"
                disabled={saveQuestionMutation.isPending}
                onClick={submitDraft}
              >
                {saveQuestionMutation.isPending && (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                )}
                <span>{vi ? "Lưu câu hỏi" : "Save question"}</span>
              </Button>
            ) : (
              <Button
                type="submit"
                form="question-editor-form"
                disabled={saveQuestionMutation.isPending}
              >
                {saveQuestionMutation.isPending && (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                )}
                <span>{vi ? "Lưu câu hỏi" : "Save question"}</span>
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
