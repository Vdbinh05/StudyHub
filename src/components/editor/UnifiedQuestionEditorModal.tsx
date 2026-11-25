"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  Eye,
  Info,
  Loader2,
  RotateCcw,
  Save,
} from "lucide-react";
import { toast } from "sonner";
import { getQuestionTypeLabel } from "@/components/import/import-copy";
import { apiFetch, getFriendlyErrorMessage } from "@/components/layout/api-client";
import {
  extractClipboardImageFiles,
  MediaAttachmentEditor,
  questionMediaAttachmentsToEditable,
  type EditableMediaAttachment,
  type MediaAttachmentEditorHandle,
} from "@/components/media/MediaAttachmentEditor";
import { MediaGallery } from "@/components/media/MediaGallery";
import { RichContentRenderer } from "@/components/richtext/RichContentRenderer";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Textarea } from "@/components/ui/textarea";
import { useOptionalI18n } from "@/lib/i18n";
import {
  getOptionMedia,
  getQuestionBackMedia,
  getQuestionExplanationMedia,
  getQuestionPromptMedia,
  type QuestionMediaAttachment,
} from "@/lib/media/question-media";
import { validateQuestionByType } from "@/lib/questions";
import { invalidateStudySetCaches } from "@/lib/query-keys";
import type {
  DifficultyLevel,
  Locale,
  Question,
  QuestionOption,
  QuestionType,
  QuestionWithRelations,
} from "@/types/domain";
import {
  V3_QUESTION_TYPES,
  type DiagramSet,
  type MediaAttachmentRole,
  type SharedPassage,
} from "@/types/v3";
import { QuestionNotePanel } from "./QuestionNotePanel";
import { QuestionReportDialog } from "./QuestionReportDialog";
import {
  createDefaultPayloadForType,
  isChoiceCapableDraft,
  V3QuestionTypeFields,
  type EditableAcceptedAnswer,
  type EditableOption,
  type QuestionDraft,
} from "./V3QuestionTypeFields";

const RichTextEditor = dynamic(
  () => import("@/components/richtext/RichTextEditor").then((m) => m.RichTextEditor),
  { ssr: false },
);

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MANAGED_QUESTION_ROLES: ReadonlySet<MediaAttachmentRole> = new Set([
  "prompt",
  "back",
  "explanation",
]);

export interface UnifiedQuestionEditorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studySetId: string;
  questionId: string | null;
  initialQuestion?: Question | QuestionWithRelations | null;
  questionIds?: string[];
  currentIndex?: number;
  onNavigateQuestion?: (nextQuestionId: string, nextIndex: number) => void;
  onSaved?: (
    savedQuestion: QuestionWithRelations,
    action: "save" | "save_and_next",
  ) => void;
  contextNotice?: string | null;
  chapters?: string[];
  /** Optional default question type when creating a brand-new question (`questionId === null`). */
  defaultQuestionType?: QuestionType;
  /** Optional explicit locale override (defaults to active I18n context or `"vi"`). */
  locale?: Locale;
}

type PendingGuardAction =
  | { type: "close" }
  | { type: "navigate"; nextQuestionId: string; nextIndex: number };

function createEmptyDraft(
  defaultType: QuestionType = "single_choice",
): QuestionDraft {
  return {
    question_type: defaultType,
    prompt: "",
    prompt_rich: null,
    prompt_image_url: "",
    prompt_media: [],
    back_text: "",
    back_rich: null,
    back_image_url: "",
    back_media: [],
    chapter: "",
    difficulty: "medium",
    explanation: "",
    explanation_rich: null,
    explanation_media: [],
    hint: "",
    tagsText: "",
    audio_url: "",
    audio_transcript: "",
    passage_id: "",
    diagram_id: "",
    options: [
      { localKey: "opt-0", content: "", image_url: "", media_attachments: [], is_correct: true },
      { localKey: "opt-1", content: "", image_url: "", media_attachments: [], is_correct: false },
      { localKey: "opt-2", content: "", image_url: "", media_attachments: [], is_correct: false },
      { localKey: "opt-3", content: "", image_url: "", media_attachments: [], is_correct: false },
    ],
    accepted_answers: [
      { localKey: "ans-0", answer_text: "", match_mode: "case_insensitive" },
    ],
    type_payload: createDefaultPayloadForType(defaultType),
  };
}

function questionToDraft(q: Question): QuestionDraft {
  const promptMedia = questionMediaAttachmentsToEditable(getQuestionPromptMedia(q));
  const backMedia = questionMediaAttachmentsToEditable(getQuestionBackMedia(q));
  const explanationMedia = questionMediaAttachmentsToEditable(
    getQuestionExplanationMedia(q),
  );

  const options: EditableOption[] =
    q.options && q.options.length > 0
      ? q.options.map((o, i) => {
          const optMedia = questionMediaAttachmentsToEditable(getOptionMedia(o));
          return {
            id: o.id,
            localKey: o.id || `opt-${i}`,
            content: o.content ?? "",
            content_rich: o.content_rich ?? null,
            image_url: optMedia[0]?.url ?? o.image_url ?? "",
            media_id: optMedia[0]?.media_id ?? o.media_id ?? null,
            image_alt: optMedia[0]?.alt_text ?? o.image_alt ?? "",
            media_attachments: optMedia,
            is_correct: Boolean(o.is_correct),
          };
        })
      : [
          { localKey: "opt-0", content: "", image_url: "", media_attachments: [], is_correct: true },
          { localKey: "opt-1", content: "", image_url: "", media_attachments: [], is_correct: false },
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
    prompt: q.prompt ?? "",
    prompt_rich: q.prompt_rich ?? null,
    prompt_image_url: promptMedia[0]?.url ?? q.prompt_image_url ?? "",
    prompt_media: promptMedia,
    back_text: q.back_text ?? "",
    back_rich: q.back_rich ?? null,
    back_image_url: backMedia[0]?.url ?? q.back_image_url ?? "",
    back_media: backMedia,
    chapter: q.chapter ?? "",
    difficulty: q.difficulty,
    explanation: q.explanation ?? "",
    explanation_rich: q.explanation_rich ?? null,
    explanation_media: explanationMedia,
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

function serializeDraftForDirtyCheck(draft: QuestionDraft): string {
  const mapMedia = (list?: EditableMediaAttachment[]) =>
    (list ?? []).map((m) => ({
      media_id: m.media_id ?? null,
      url: m.url,
      alt_text: m.alt_text,
      caption: m.caption,
      sort_order: m.sort_order,
    }));

  return JSON.stringify({
    question_type: draft.question_type,
    prompt: draft.prompt,
    prompt_rich: draft.prompt_rich ?? null,
    prompt_image_url: draft.prompt_image_url,
    prompt_media: mapMedia(draft.prompt_media),
    back_text: draft.back_text,
    back_rich: draft.back_rich ?? null,
    back_image_url: draft.back_image_url ?? "",
    back_media: mapMedia(draft.back_media),
    chapter: draft.chapter,
    difficulty: draft.difficulty,
    explanation: draft.explanation,
    explanation_rich: draft.explanation_rich ?? null,
    explanation_media: mapMedia(draft.explanation_media),
    hint: draft.hint,
    tagsText: draft.tagsText,
    audio_url: draft.audio_url,
    audio_transcript: draft.audio_transcript,
    passage_id: draft.passage_id,
    diagram_id: draft.diagram_id,
    type_payload: draft.type_payload ?? null,
    options: draft.options.map((o) => ({
      id: o.id ?? null,
      content: o.content,
      image_url: o.image_url ?? "",
      is_correct: o.is_correct,
      media: mapMedia(o.media_attachments),
    })),
    accepted_answers: draft.accepted_answers.map((a) => ({
      id: a.id ?? null,
      answer_text: a.answer_text,
      match_mode: a.match_mode,
    })),
  });
}

function toPayloadMediaAttachments(
  items: readonly EditableMediaAttachment[],
  role: MediaAttachmentRole,
): Array<{
  media_id: string;
  url?: string | null;
  role: MediaAttachmentRole;
  sort_order: number;
  alt_text: string | null;
  caption: string | null;
}> {
  const seen = new Set<string>();
  const out: Array<{
    media_id: string;
    url?: string | null;
    role: MediaAttachmentRole;
    sort_order: number;
    alt_text: string | null;
    caption: string | null;
  }> = [];

  for (const item of items) {
    if (!item.media_id || !UUID_REGEX.test(item.media_id)) continue;
    if (seen.has(item.media_id)) continue;
    seen.add(item.media_id);
    out.push({
      media_id: item.media_id,
      url: item.url || null,
      role,
      sort_order: out.length,
      alt_text: item.alt_text.trim() || null,
      caption: item.caption.trim() || null,
    });
  }
  return out;
}

function editableToPreviewAttachments(
  items: readonly EditableMediaAttachment[],
  role: MediaAttachmentRole,
): QuestionMediaAttachment[] {
  return items.map((item, idx) => ({
    id: item.localId,
    media_id: item.media_id || `preview-${item.localId}`,
    url: item.url,
    role,
    sort_order: idx,
    alt_text: item.alt_text || null,
    caption: item.caption || null,
    mime_type: item.mime_type || null,
    width: item.width ?? null,
    height: item.height ?? null,
  }));
}

function collectPersistedMediaIds(q: Question | null | undefined): Set<string> {
  const ids = new Set<string>();
  if (!q) return ids;
  for (const att of q.media_attachments ?? []) {
    if (att.media_id && UUID_REGEX.test(att.media_id)) ids.add(att.media_id);
  }
  for (const opt of q.options ?? []) {
    if (opt.media_id && UUID_REGEX.test(opt.media_id)) ids.add(opt.media_id);
    for (const att of opt.media_attachments ?? []) {
      if (att.media_id && UUID_REGEX.test(att.media_id)) ids.add(att.media_id);
    }
  }
  return ids;
}

function patchQuestionInCachedValue(
  cached: unknown,
  saved: QuestionWithRelations,
): unknown {
  if (!cached || typeof cached !== "object") return cached;
  if (Array.isArray(cached)) {
    let changed = false;
    const next = cached.map((item) => {
      if (item && typeof item === "object" && (item as { id?: string }).id === saved.id) {
        changed = true;
        return { ...item, ...saved };
      }
      return item;
    });
    return changed ? next : cached;
  }

  const record = cached as Record<string, unknown>;
  if (Array.isArray(record.items)) {
    let changed = false;
    const nextItems = record.items.map((item) => {
      if (item && typeof item === "object" && (item as { id?: string }).id === saved.id) {
        changed = true;
        return { ...item, ...saved };
      }
      return item;
    });
    return changed ? { ...record, items: nextItems } : cached;
  }

  if (Array.isArray(record.questions)) {
    let changed = false;
    const nextQuestions = record.questions.map((item) => {
      if (item && typeof item === "object" && (item as { id?: string }).id === saved.id) {
        changed = true;
        return { ...item, ...saved };
      }
      return item;
    });
    return changed ? { ...record, questions: nextQuestions } : cached;
  }

  if (record.id === saved.id) {
    return { ...record, ...saved };
  }

  return cached;
}

export function UnifiedQuestionEditorModal(
  props: UnifiedQuestionEditorModalProps,
): React.ReactElement {
  if (!props.open) {
    return (
      <Dialog open={false} onOpenChange={props.onOpenChange}>
        <DialogContent className="hidden" />
      </Dialog>
    );
  }
  const sessionKey = `${props.studySetId}:${props.questionId ?? "new"}`;
  return <UnifiedQuestionEditorModalInner key={sessionKey} {...props} />;
}

function UnifiedQuestionEditorModalInner({
  open,
  onOpenChange,
  studySetId,
  questionId,
  initialQuestion,
  questionIds,
  currentIndex,
  onNavigateQuestion,
  onSaved,
  contextNotice,
  chapters = [],
  defaultQuestionType = "single_choice",
  locale: localeProp,
}: UnifiedQuestionEditorModalProps): React.ReactElement {
  const i18n = useOptionalI18n();
  const locale: Locale = localeProp ?? i18n?.locale ?? "vi";
  const vi = locale === "vi";
  const queryClient = useQueryClient();
  const chapterDatalistId = React.useId();

  const promptMediaRef = React.useRef<MediaAttachmentEditorHandle | null>(null);
  const explanationMediaRef = React.useRef<MediaAttachmentEditorHandle | null>(null);

  // Single-question lazy hydration via GET /api/sets/[id]/questions/[questionId]
  const detailQuery = useQuery<QuestionWithRelations>({
    queryKey: ["question-detail", studySetId, questionId],
    enabled: open && Boolean(studySetId) && Boolean(questionId),
    staleTime: 10_000,
    queryFn: async () => {
      const res = await apiFetch<QuestionWithRelations>(
        `/api/sets/${studySetId}/questions/${questionId}`,
      );
      return {
        ...res.data,
        options: Array.isArray(res.data.options) ? res.data.options : [],
      };
    },
  });

  const authoritativeQuestion = React.useMemo<Question | null>(() => {
    if (!questionId) return null;
    if (detailQuery.data && detailQuery.data.id === questionId) {
      return detailQuery.data;
    }
    if (initialQuestion && initialQuestion.id === questionId) {
      return initialQuestion;
    }
    return null;
  }, [questionId, detailQuery.data, initialQuestion]);

  const baseDraft = React.useMemo<QuestionDraft>(
    () =>
      authoritativeQuestion
        ? questionToDraft(authoritativeQuestion)
        : createEmptyDraft(defaultQuestionType),
    [authoritativeQuestion, defaultQuestionType],
  );
  const cleanSnapshot = React.useMemo(
    () => serializeDraftForDirtyCheck(baseDraft),
    [baseDraft],
  );
  const persistedMediaIds = React.useMemo(
    () => collectPersistedMediaIds(authoritativeQuestion),
    [authoritativeQuestion],
  );
  const preservedOtherAttachments = React.useMemo(
    () =>
      (authoritativeQuestion?.media_attachments ?? []).filter(
        (att) =>
          !MANAGED_QUESTION_ROLES.has(att.role) &&
          Boolean(att.media_id && UUID_REGEX.test(att.media_id)),
      ),
    [authoritativeQuestion],
  );

  const [editedDraft, setEditedDraft] = React.useState<QuestionDraft | null>(null);
  const [richPromptOverride, setRichPromptOverride] = React.useState<boolean | null>(null);
  const [showLivePreview, setShowLivePreview] = React.useState(false);
  const [secondaryOverride, setSecondaryOverride] = React.useState<boolean | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [pendingGuardAction, setPendingGuardAction] =
    React.useState<PendingGuardAction | null>(null);

  const draft = editedDraft ?? baseDraft;
  const setDraft: React.Dispatch<React.SetStateAction<QuestionDraft>> = React.useCallback(
    (updater) => {
      setEditedDraft((prev) => {
        const current = prev ?? baseDraft;
        return typeof updater === "function" ? updater(current) : updater;
      });
    },
    [baseDraft],
  );

  const useRichPrompt = richPromptOverride ?? Boolean(authoritativeQuestion?.prompt_rich);
  const secondaryFieldsOpen =
    secondaryOverride ?? ((baseDraft.explanation_media?.length ?? 0) > 0);

  const isDirty = React.useMemo(
    () => editedDraft !== null && serializeDraftForDirtyCheck(editedDraft) !== cleanSnapshot,
    [editedDraft, cleanSnapshot],
  );

  const savingRef = React.useRef(false);
  const isDirtyRef = React.useRef(isDirty);
  const sessionUploadedMediaIdsRef = React.useRef<Set<string>>(new Set());
  const persistedMediaIdsRef = React.useRef<Set<string>>(persistedMediaIds);

  React.useEffect(() => {
    isDirtyRef.current = isDirty;
  }, [isDirty]);

  React.useEffect(() => {
    persistedMediaIdsRef.current = persistedMediaIds;
  }, [persistedMediaIds]);

  // Auxiliary lookups (only fetched when needed for reading_passage / image_hotspot)
  const needsPassages = open && draft.question_type === "reading_passage";
  const needsDiagrams = open && draft.question_type === "image_hotspot";

  const passagesQuery = useQuery<SharedPassage[]>({
    queryKey: ["set-passages", studySetId],
    enabled: needsPassages && Boolean(studySetId),
    staleTime: 60_000,
    queryFn: async () => {
      const res = await apiFetch<SharedPassage[]>(
        `/api/passages?studySetId=${encodeURIComponent(studySetId)}`,
      );
      return Array.isArray(res.data) ? res.data : [];
    },
  });

  const diagramsQuery = useQuery<DiagramSet[]>({
    queryKey: ["set-diagrams", studySetId],
    enabled: needsDiagrams && Boolean(studySetId),
    staleTime: 60_000,
    queryFn: async () => {
      const res = await apiFetch<DiagramSet[]>(`/api/sets/${studySetId}/diagrams`);
      return Array.isArray(res.data) ? res.data : [];
    },
  });

  const cleanupUnreferencedSessionUploads = React.useCallback(() => {
    const idsToClean = Array.from(sessionUploadedMediaIdsRef.current).filter(
      (id) => UUID_REGEX.test(id) && !persistedMediaIdsRef.current.has(id),
    );
    sessionUploadedMediaIdsRef.current.clear();
    if (idsToClean.length === 0) return;

    // Best-effort cleanup via DELETE /api/uploads/image/[mediaId] (409-safe if referenced!)
    for (const mediaId of idsToClean) {
      void fetch(`/api/uploads/image/${encodeURIComponent(mediaId)}`, {
        method: "DELETE",
        credentials: "same-origin",
      }).catch(() => undefined);
    }
  }, []);

  const resolvedIndex = React.useMemo(() => {
    if (typeof currentIndex === "number" && currentIndex >= 0) return currentIndex;
    if (questionId && questionIds && questionIds.length > 0) {
      const found = questionIds.indexOf(questionId);
      return found >= 0 ? found : -1;
    }
    return -1;
  }, [currentIndex, questionId, questionIds]);

  const totalNavigable = questionIds?.length ?? 0;
  const canNavigate = Boolean(onNavigateQuestion && totalNavigable > 1 && resolvedIndex >= 0);
  const canGoPrev = canNavigate && resolvedIndex > 0;
  const canGoNext = canNavigate && resolvedIndex < totalNavigable - 1;

  const executeGuardAction = React.useCallback(
    (action: PendingGuardAction) => {
      setPendingGuardAction(null);
      cleanupUnreferencedSessionUploads();
      if (action.type === "close") {
        onOpenChange(false);
      } else if (onNavigateQuestion) {
        onNavigateQuestion(action.nextQuestionId, action.nextIndex);
      }
    },
    [cleanupUnreferencedSessionUploads, onNavigateQuestion, onOpenChange],
  );

  const requestGuardedAction = React.useCallback(
    (action: PendingGuardAction) => {
      if (savingRef.current) return;
      if (isDirtyRef.current) {
        setPendingGuardAction(action);
        return;
      }
      executeGuardAction(action);
    },
    [executeGuardAction],
  );

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      requestGuardedAction({ type: "close" });
    } else {
      onOpenChange(true);
    }
  };

  const handleTrackUploadedMedia = React.useCallback((mediaId: string) => {
    if (UUID_REGEX.test(mediaId)) {
      sessionUploadedMediaIdsRef.current.add(mediaId);
    }
  }, []);

  const performSave = async (action: "save" | "save_and_next") => {
    if (savingRef.current) return;

    const promptMedia = draft.prompt_media ?? [];
    const backMedia = draft.back_media ?? [];
    const explanationMedia = draft.explanation_media ?? [];
    const primaryPromptUrl = promptMedia[0]?.url || draft.prompt_image_url.trim() || null;
    const primaryBackUrl = backMedia[0]?.url || draft.back_image_url?.trim() || null;

    const isChoice = isChoiceCapableDraft(draft);
    const validDraftOptions = isChoice
      ? draft.options.filter(
          (o) =>
            o.content.trim().length > 0 ||
            Boolean(o.image_url?.trim()) ||
            Boolean(o.media_id) ||
            Boolean(o.media_attachments && o.media_attachments.length > 0),
        )
      : [];

    const validation = validateQuestionByType({
      question_type: draft.question_type,
      prompt: draft.prompt.trim(),
      prompt_rich: draft.prompt_rich ?? null,
      prompt_image_url: primaryPromptUrl,
      back_text: draft.back_text.trim() || null,
      back_image_url: primaryBackUrl,
      audio_url: draft.audio_url.trim() || null,
      diagram_id: draft.diagram_id || null,
      passage_id: draft.passage_id || null,
      type_payload: draft.type_payload,
      media_attachments: [
        ...promptMedia.map((m) => ({ media_id: m.media_id, url: m.url, role: "prompt" })),
        ...backMedia.map((m) => ({ media_id: m.media_id, url: m.url, role: "back" })),
        ...explanationMedia.map((m) => ({
          media_id: m.media_id,
          url: m.url,
          role: "explanation",
        })),
      ],
      options: validDraftOptions.map((o, idx) => ({
        id: o.id ?? o.localKey,
        label: String.fromCharCode(65 + idx),
        content: o.content.trim(),
        image_url: o.media_attachments?.[0]?.url || o.image_url?.trim() || null,
        media_id: o.media_attachments?.[0]?.media_id || o.media_id || null,
        media_attachments: (o.media_attachments ?? []).map((m) => ({
          media_id: m.media_id,
          url: m.url,
        })),
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
      const msg =
        validation.errors[0] ??
        (vi ? "Vui lòng kiểm tra lại dữ liệu câu hỏi." : "Please check question fields.");
      setSaveError(msg);
      toast.error(msg);
      return;
    }

    const cleanOptions = isChoice
      ? validDraftOptions.map((o, idx) => {
          const optAtts = toPayloadMediaAttachments(o.media_attachments ?? [], "option");
          const firstMedia = o.media_attachments?.[0];
          const primaryUrl = firstMedia?.url || o.image_url?.trim() || null;
          const primaryMediaId =
            (firstMedia?.media_id && UUID_REGEX.test(firstMedia.media_id)
              ? firstMedia.media_id
              : null) ??
            (o.media_id && UUID_REGEX.test(o.media_id) ? o.media_id : null);

          return {
            ...(o.id && UUID_REGEX.test(o.id) ? { id: o.id } : {}),
            position: idx,
            label: String.fromCharCode(65 + idx),
            content: o.content.trim(),
            content_rich: o.content_rich ?? null,
            image_url: primaryUrl,
            media_id: primaryMediaId,
            image_alt: firstMedia?.alt_text.trim() || o.image_alt?.trim() || null,
            media_attachments: optAtts,
            is_correct: o.is_correct,
          };
        })
      : undefined;

    const needsAccepted =
      draft.question_type === "flashcard" ||
      draft.question_type === "short_answer" ||
      (draft.type_payload?.type === "reading_passage" &&
        draft.type_payload.sub_answer_kind === "short_answer") ||
      (draft.type_payload?.type === "listening" &&
        draft.type_payload.sub_answer_kind === "short_answer");

    const cleanAccepted = needsAccepted
      ? draft.accepted_answers
          .filter((a) => a.answer_text.trim().length > 0)
          .map((a) => ({
            ...(a.id && UUID_REGEX.test(a.id) ? { id: a.id } : {}),
            answer_text: a.answer_text.trim(),
            match_mode: a.match_mode,
          }))
      : undefined;

    const tags = draft.tagsText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const preservedOtherPayload = preservedOtherAttachments
      .filter((att) => Boolean(att.media_id && UUID_REGEX.test(att.media_id)))
      .map((att, idx) => ({
        media_id: att.media_id,
        url: att.url || null,
        role: att.role,
        sort_order: typeof att.sort_order === "number" ? att.sort_order : idx,
        alt_text: att.alt_text ?? null,
        caption: att.caption ?? null,
      }));

    const mergedQuestionMediaAttachments = [
      ...toPayloadMediaAttachments(promptMedia, "prompt"),
      ...toPayloadMediaAttachments(backMedia, "back"),
      ...toPayloadMediaAttachments(explanationMedia, "explanation"),
      ...preservedOtherPayload,
    ].slice(0, 20);

    const payload = {
      question_type: draft.question_type,
      prompt: draft.prompt.trim(),
      prompt_rich: draft.prompt_rich ?? null,
      prompt_image_url: primaryPromptUrl,
      back_text: draft.back_text.trim() || null,
      back_rich: draft.back_rich ?? null,
      back_image_url: primaryBackUrl,
      chapter: draft.chapter.trim() || null,
      difficulty: draft.difficulty,
      explanation: draft.explanation.trim() || null,
      explanation_rich: draft.explanation_rich ?? null,
      hint: draft.hint.trim() || null,
      audio_url: draft.audio_url.trim() || null,
      audio_transcript: draft.audio_transcript.trim() || null,
      passage_id: draft.passage_id || null,
      diagram_id: draft.diagram_id || null,
      type_payload: draft.type_payload,
      media_attachments: mergedQuestionMediaAttachments,
      options: cleanOptions,
      accepted_answers: cleanAccepted,
      tags,
    };

    savingRef.current = true;
    setIsSaving(true);
    setSaveError(null);

    try {
      const isUpdate = Boolean(questionId);
      const endpoint = isUpdate
        ? `/api/sets/${studySetId}/questions/${questionId}`
        : `/api/sets/${studySetId}/questions`;
      const method = isUpdate ? "PATCH" : "POST";

      const res = await apiFetch<QuestionWithRelations>(endpoint, {
        method,
        body: JSON.stringify(payload),
      });

      const savedQuestion: QuestionWithRelations = {
        ...res.data,
        options: Array.isArray(res.data.options)
          ? (res.data.options as QuestionOption[])
          : [],
      };

      // Mark session uploads as persisted so Cancel never deletes them
      sessionUploadedMediaIdsRef.current.clear();
      persistedMediaIdsRef.current = collectPersistedMediaIds(savedQuestion);
      setEditedDraft(null);

      // Targeted React Query cache updates (zero full-bank reload, preserves scroll & filters!)
      queryClient.setQueryData(["question-detail", studySetId, savedQuestion.id], savedQuestion);
      if (isUpdate) {
        const listPrefixes = [
          ["editor-questions", studySetId],
          ["study-set-questions", studySetId],
          ["study-set-questions-page", studySetId],
          ["study-set-bundle", studySetId],
          ["mistakes"],
          ["starred"],
        ];
        for (const queryKey of listPrefixes) {
          queryClient.setQueriesData({ queryKey }, (prev) =>
            patchQuestionInCachedValue(prev, savedQuestion),
          );
        }
        void queryClient.invalidateQueries({ queryKey: ["study-set", studySetId] });
      } else {
        await invalidateStudySetCaches(queryClient, studySetId);
      }

      toast.success(
        action === "save_and_next"
          ? vi
            ? "Đã lưu & chuyển sang câu tiếp theo."
            : "Saved & advancing to next question."
          : vi
            ? "Đã lưu thay đổi câu hỏi."
            : "Question changes saved.",
      );

      onSaved?.(savedQuestion, action);

      if (action === "save_and_next" && canGoNext && questionIds && onNavigateQuestion) {
        const nextIndex = resolvedIndex + 1;
        const nextQuestionId = questionIds[nextIndex];
        if (nextQuestionId) {
          onNavigateQuestion(nextQuestionId, nextIndex);
          return;
        }
      }

      onOpenChange(false);
    } catch (err) {
      const friendly = getFriendlyErrorMessage(
        err,
        locale,
        vi
          ? "Không thể lưu câu hỏi. Bản nháp của bạn vẫn được giữ nguyên."
          : "Could not save question. Your draft has been preserved.",
      );
      setSaveError(friendly);
      toast.error(friendly);
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  };

  const handleFormSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void performSave("save");
  };

  const isWaitingForInitialHydration =
    open &&
    Boolean(questionId) &&
    detailQuery.isLoading &&
    (!initialQuestion || initialQuestion.id !== questionId);

  const secondaryFilledCount =
    (draft.explanation.trim() ? 1 : 0) +
    ((draft.explanation_media?.length ?? 0) > 0 ? 1 : 0) +
    (draft.hint.trim() ? 1 : 0) +
    (draft.tagsText.trim() ? 1 : 0);

  const previewPromptAttachments = editableToPreviewAttachments(
    draft.prompt_media ?? [],
    "prompt",
  );
  const previewExplanationAttachments = editableToPreviewAttachments(
    draft.explanation_media ?? [],
    "explanation",
  );
  const previewBackAttachments = editableToPreviewAttachments(
    draft.back_media ?? [],
    "back",
  );

  return (
    <>
      <Dialog open={open} onOpenChange={handleDialogOpenChange}>
        <DialogContent
          className="flex max-h-[92dvh] w-[calc(100vw-1rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:w-full"
          onEscapeKeyDown={(event) => {
            if (isDirtyRef.current || savingRef.current) {
              event.preventDefault();
              requestGuardedAction({ type: "close" });
            }
          }}
          onInteractOutside={(event) => {
            if (isDirtyRef.current || savingRef.current) {
              event.preventDefault();
              requestGuardedAction({ type: "close" });
            }
          }}
        >
          {/* Sticky Compact Header */}
          <DialogHeader className="shrink-0 border-b border-border bg-background px-4 py-3 sm:px-6 sm:py-4">
            <div className="flex flex-wrap items-start justify-between gap-2 pr-8">
              <div className="min-w-0 space-y-0.5">
                <div className="flex flex-wrap items-center gap-2">
                  <DialogTitle className="text-base sm:text-lg">
                    {questionId
                      ? vi
                        ? "Chỉnh sửa câu hỏi"
                        : "Edit question"
                      : vi
                        ? "Thêm câu hỏi mới"
                        : "Add new question"}
                  </DialogTitle>
                  {canNavigate && (
                    <Badge variant="secondary" className="font-mono text-xs tabular-nums">
                      #{resolvedIndex + 1} / {totalNavigable}
                    </Badge>
                  )}
                  {isDirty && (
                    <Badge
                      variant="outline"
                      className="border-warning/50 bg-warning-subtle text-[11px] text-warning-subtle-foreground"
                    >
                      {vi ? "Chưa lưu" : "Unsaved"}
                    </Badge>
                  )}
                </div>
                <DialogDescription className="text-xs">
                  {vi
                    ? "Hỗ trợ 12 dạng câu hỏi & thẻ ghi nhớ, đa ảnh câu hỏi, từng đáp án A/B/C/D, ảnh giải thích và dán ảnh nhanh (Ctrl+V)."
                    : "Supports 12 question types & flashcards, multi-image prompts, per-option images (A/B/C/D), explanation images, and Ctrl+V paste."}
                </DialogDescription>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {canNavigate && questionIds && (
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!canGoPrev || isSaving}
                      onClick={() =>
                        requestGuardedAction({
                          type: "navigate",
                          nextQuestionId: questionIds[resolvedIndex - 1],
                          nextIndex: resolvedIndex - 1,
                        })
                      }
                      aria-label={vi ? "Câu trước" : "Previous question"}
                      className="h-9 gap-1 px-2.5 text-xs sm:h-8"
                    >
                      <ArrowLeft className="size-3.5" aria-hidden="true" />
                      <span className="hidden sm:inline">{vi ? "Câu trước" : "Prev"}</span>
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={!canGoNext || isSaving}
                      onClick={() =>
                        requestGuardedAction({
                          type: "navigate",
                          nextQuestionId: questionIds[resolvedIndex + 1],
                          nextIndex: resolvedIndex + 1,
                        })
                      }
                      aria-label={vi ? "Câu tiếp" : "Next question"}
                      className="h-9 gap-1 px-2.5 text-xs sm:h-8"
                    >
                      <span className="hidden sm:inline">{vi ? "Câu tiếp" : "Next"}</span>
                      <ArrowRight className="size-3.5" aria-hidden="true" />
                    </Button>
                  </div>
                )}

                <Button
                  type="button"
                  size="sm"
                  variant={showLivePreview ? "default" : "outline"}
                  onClick={() => setShowLivePreview((v) => !v)}
                  className="h-9 gap-1 px-2.5 text-xs sm:h-8"
                >
                  <Eye className="size-3.5" aria-hidden="true" />
                  <span>
                    {showLivePreview
                      ? vi
                        ? "Quay lại sửa"
                        : "Back to Edit"
                      : vi
                        ? "Xem trước"
                        : "Preview"}
                  </span>
                </Button>

                {questionId && (
                  <QuestionReportDialog
                    questionId={questionId}
                    studySetId={studySetId}
                    locale={locale}
                  />
                )}
              </div>
            </div>
          </DialogHeader>

          {/* Optional Contextual Disclaimer Banner (e.g. Exam Results immutable snapshot notice) */}
          {contextNotice && (
            <div
              role="note"
              className="flex items-start gap-2 border-b border-border bg-accent/50 px-4 py-2.5 text-xs text-foreground sm:px-6"
            >
              <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
              <span>{contextNotice}</span>
            </div>
          )}

          {/* Scrollable Body */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
            {isWaitingForInitialHydration ? (
              <div className="space-y-4">
                <Skeleton className="h-10 w-full rounded-lg" />
                <Skeleton className="h-28 w-full rounded-lg" />
                <Skeleton className="h-44 w-full rounded-lg" />
              </div>
            ) : detailQuery.isError && questionId && !initialQuestion ? (
              <div
                role="alert"
                className="flex flex-col items-center justify-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center"
              >
                <AlertCircle className="size-7 text-destructive" aria-hidden="true" />
                <p className="text-sm font-medium text-foreground">
                  {vi ? "Không thể tải chi tiết câu hỏi" : "Could not load question details"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {getFriendlyErrorMessage(detailQuery.error, locale)}
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void detailQuery.refetch()}
                  className="gap-1.5"
                >
                  <RotateCcw className="size-3.5" aria-hidden="true" />
                  <span>{vi ? "Thử lại" : "Retry"}</span>
                </Button>
              </div>
            ) : showLivePreview ? (
              <div className="space-y-4 rounded-xl border border-border bg-muted/20 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">
                    {getQuestionTypeLabel(draft.question_type, locale)}
                  </Badge>
                  <Badge variant="outline">
                    {draft.difficulty === "easy"
                      ? vi
                        ? "Dễ"
                        : "Easy"
                      : draft.difficulty === "hard"
                        ? vi
                          ? "Khó"
                          : "Hard"
                        : vi
                          ? "Trung bình"
                          : "Medium"}
                  </Badge>
                  {draft.chapter.trim() && <Badge variant="outline">{draft.chapter.trim()}</Badge>}
                </div>

                {draft.prompt.trim() && (
                  <RichContentRenderer
                    richDoc={draft.prompt_rich}
                    plainText={draft.prompt}
                    className="text-base font-medium"
                  />
                )}

                <MediaGallery
                  items={previewPromptAttachments}
                  fallbackImageUrl={draft.prompt_image_url || null}
                  fallbackAlt={vi ? "Ảnh câu hỏi" : "Question image"}
                />

                {draft.question_type === "flashcard" && (
                  <div className="space-y-2 rounded-lg border border-border bg-card p-3">
                    <div className="text-xs font-semibold text-muted-foreground">
                      {vi ? "Mặt sau / Định nghĩa" : "Back / Definition"}
                    </div>
                    {draft.back_text.trim() && (
                      <RichContentRenderer
                        richDoc={draft.back_rich}
                        plainText={draft.back_text}
                      />
                    )}
                    <MediaGallery
                      items={previewBackAttachments}
                      fallbackImageUrl={draft.back_image_url || null}
                      variant="compact"
                    />
                  </div>
                )}

                {isChoiceCapableDraft(draft) && (
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                    {draft.options.map((o, idx) => {
                      const letter = String.fromCharCode(65 + idx);
                      const optAtts = editableToPreviewAttachments(
                        o.media_attachments ?? [],
                        "option",
                      );
                      return (
                        <div
                          key={o.localKey}
                          className={`space-y-2 rounded-lg border p-3 text-sm ${
                            o.is_correct
                              ? "border-success/60 bg-success-subtle"
                              : "border-border bg-card"
                          }`}
                        >
                          <div className="font-medium">
                            <span className="font-mono">{letter}.</span>{" "}
                            {o.content.trim() ? (
                              <RichContentRenderer
                                richDoc={o.content_rich}
                                plainText={o.content}
                                inline
                                className="inline"
                              />
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                {vi ? "(Đáp án hình ảnh)" : "(Image option)"}
                              </span>
                            )}
                          </div>
                          <MediaGallery
                            items={optAtts}
                            fallbackImageUrl={o.image_url || null}
                            fallbackAlt={`Option ${letter}`}
                            variant="option"
                          />
                        </div>
                      );
                    })}
                  </div>
                )}

                {(draft.explanation.trim() || previewExplanationAttachments.length > 0) && (
                  <div className="space-y-2 rounded-lg border border-border bg-card p-3 text-sm">
                    <div className="text-xs font-semibold text-muted-foreground">
                      {vi ? "Giải thích" : "Explanation"}
                    </div>
                    {draft.explanation.trim() && (
                      <RichContentRenderer
                        richDoc={draft.explanation_rich}
                        plainText={draft.explanation}
                      />
                    )}
                    <MediaGallery
                      items={previewExplanationAttachments}
                      variant="compact"
                    />
                  </div>
                )}
              </div>
            ) : (
              <form
                id="question-editor-form"
                onSubmit={handleFormSubmit}
                className="space-y-4"
              >
                {saveError && (
                  <div
                    role="alert"
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/30 bg-destructive-subtle px-3.5 py-2.5 text-xs text-destructive-subtle-foreground"
                  >
                    <div className="flex items-start gap-2">
                      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                      <span>{saveError}</span>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={isSaving}
                      onClick={() => void performSave("save")}
                      className="h-7 gap-1 text-xs"
                    >
                      <RotateCcw className="size-3" aria-hidden="true" />
                      <span>{vi ? "Thử lưu lại" : "Retry save"}</span>
                    </Button>
                  </div>
                )}

                {/* Metadata Strip */}
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="uq-type">{vi ? "Dạng câu hỏi" : "Question type"}</Label>
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
                                  media_attachments: prev.options[0]?.media_attachments ?? [],
                                  image_url: prev.options[0]?.image_url ?? "",
                                  is_correct: true,
                                },
                                {
                                  id: prev.options[1]?.id,
                                  localKey: prev.options[1]?.localKey ?? "tf-1",
                                  content: prev.options[1]?.content || (vi ? "Sai" : "False"),
                                  media_attachments: prev.options[1]?.media_attachments ?? [],
                                  image_url: prev.options[1]?.image_url ?? "",
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
                      <SelectTrigger id="uq-type">
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
                    <Label htmlFor="uq-chapter">{vi ? "Chương / Phần" : "Chapter"}</Label>
                    <Input
                      id="uq-chapter"
                      list={chapters.length > 0 ? chapterDatalistId : undefined}
                      placeholder={vi ? "VD: Chương 1" : "e.g., Chapter 1"}
                      value={draft.chapter}
                      onChange={(e) =>
                        setDraft((prev) => ({ ...prev, chapter: e.target.value }))
                      }
                    />
                    {chapters.length > 0 && (
                      <datalist id={chapterDatalistId}>
                        {chapters.map((ch) => (
                          <option key={ch} value={ch} />
                        ))}
                      </datalist>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="uq-difficulty">{vi ? "Độ khó" : "Difficulty"}</Label>
                    <Select
                      value={draft.difficulty}
                      onValueChange={(v) =>
                        setDraft((prev) => ({ ...prev, difficulty: v as DifficultyLevel }))
                      }
                    >
                      <SelectTrigger id="uq-difficulty">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="easy">{vi ? "Dễ" : "Easy"}</SelectItem>
                        <SelectItem value="medium">{vi ? "Trung bình" : "Medium"}</SelectItem>
                        <SelectItem value="hard">{vi ? "Khó" : "Hard"}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Question Prompt + Multi-Image Zone (zone-scoped Ctrl+V paste!) */}
                <div
                  onPaste={(event) => {
                    const pastedImages = extractClipboardImageFiles(event.clipboardData);
                    if (pastedImages.length > 0) {
                      event.preventDefault();
                      event.stopPropagation();
                      promptMediaRef.current?.pasteFiles(pastedImages);
                    }
                  }}
                  className="space-y-3 rounded-xl border border-border/80 bg-muted/10 p-3.5"
                >
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Label htmlFor="uq-prompt">
                        {draft.question_type === "flashcard"
                          ? vi
                            ? "Mặt trước / Thuật ngữ"
                            : "Front / Term"
                          : vi
                            ? "Nội dung câu hỏi"
                            : "Question stem"}
                      </Label>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() => setRichPromptOverride(!useRichPrompt)}
                      >
                        {useRichPrompt
                          ? vi
                            ? "Văn bản thường"
                            : "Plain text"
                          : vi
                            ? "Soạn thảo nâng cao & Công thức"
                            : "Rich Text & Math"}
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
                        id="uq-prompt"
                        rows={3}
                        value={draft.prompt}
                        placeholder={
                          vi
                            ? "Nhập nội dung câu hỏi (hỗ trợ $...$ và dán ảnh Ctrl+V trực tiếp)"
                            : "Enter question stem (supports $...$ math and Ctrl+V image paste)"
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

                  <MediaAttachmentEditor
                    ref={promptMediaRef}
                    studySetId={studySetId}
                    role="prompt"
                    allowImages
                    allowAudio={false}
                    maxItems={8}
                    label={vi ? "Ảnh minh họa câu hỏi" : "Question images"}
                    addButtonLabel={vi ? "Thêm ảnh câu hỏi" : "Add question image"}
                    zoneName={vi ? "Khu vực ảnh câu hỏi" : "Question images zone"}
                    value={draft.prompt_media ?? []}
                    onMediaUploaded={handleTrackUploadedMedia}
                    onChange={(nextMedia) =>
                      setDraft((prev) => ({
                        ...prev,
                        prompt_media: nextMedia,
                        prompt_image_url: nextMedia[0]?.url ?? "",
                      }))
                    }
                  />
                </div>

                {/* Type-Specific Fields (Options with per-option multi-image + reorder + image-only!) */}
                <V3QuestionTypeFields
                  setId={studySetId}
                  locale={locale}
                  draft={draft}
                  setDraft={setDraft}
                  passages={passagesQuery.data ?? []}
                  diagrams={diagramsQuery.data ?? []}
                  onMediaUploaded={handleTrackUploadedMedia}
                />

                {/* Secondary Progressive Disclosure: Explanation + Explanation Images, Hint, Tags, Notes */}
                <div className="rounded-xl border border-border bg-muted/15">
                  <button
                    type="button"
                    aria-expanded={secondaryFieldsOpen}
                    onClick={() => setSecondaryOverride(!secondaryFieldsOpen)}
                    className="flex min-h-11 w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left text-xs font-medium text-foreground transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span>
                        {vi
                          ? "Mở rộng giải thích, gợi ý & thẻ (hỗ trợ ảnh giải thích)"
                          : "More options: explanation, explanation images, hint & tags"}
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
                      <div
                        onPaste={(event) => {
                          const pastedImages = extractClipboardImageFiles(event.clipboardData);
                          if (pastedImages.length > 0) {
                            event.preventDefault();
                            event.stopPropagation();
                            explanationMediaRef.current?.pasteFiles(pastedImages);
                          }
                        }}
                        className="space-y-3"
                      >
                        <div className="space-y-1.5">
                          <Label htmlFor="uq-explanation">
                            {vi
                              ? "Giải thích (tùy chọn, hỗ trợ công thức)"
                              : "Explanation (optional, supports math)"}
                          </Label>
                          <Textarea
                            id="uq-explanation"
                            rows={2}
                            value={draft.explanation}
                            placeholder={
                              vi
                                ? "Nhập lời giải chi tiết hoặc dán ảnh giải thích (Ctrl+V)..."
                                : "Enter detailed explanation or paste explanation images (Ctrl+V)..."
                            }
                            onChange={(e) =>
                              setDraft((prev) => ({
                                ...prev,
                                explanation: e.target.value,
                                explanation_rich: null,
                              }))
                            }
                          />
                        </div>

                        <MediaAttachmentEditor
                          ref={explanationMediaRef}
                          studySetId={studySetId}
                          role="explanation"
                          allowImages
                          allowAudio={false}
                          maxItems={6}
                          label={vi ? "Ảnh minh họa giải thích" : "Explanation images"}
                          addButtonLabel={
                            vi ? "Thêm ảnh giải thích" : "Add explanation image"
                          }
                          zoneName={
                            vi ? "Khu vực ảnh giải thích" : "Explanation images zone"
                          }
                          value={draft.explanation_media ?? []}
                          onMediaUploaded={handleTrackUploadedMedia}
                          onChange={(nextMedia) =>
                            setDraft((prev) => ({
                              ...prev,
                              explanation_media: nextMedia,
                            }))
                          }
                        />
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1.5">
                          <Label htmlFor="uq-tags">
                            {vi ? "Thẻ (phân tách bằng dấu phẩy)" : "Tags (comma separated)"}
                          </Label>
                          <Input
                            id="uq-tags"
                            placeholder={vi ? "ôn thi, giữa kỳ" : "midterm, key-concept"}
                            value={draft.tagsText}
                            onChange={(e) =>
                              setDraft((prev) => ({ ...prev, tagsText: e.target.value }))
                            }
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label htmlFor="uq-hint">
                            {vi ? "Gợi ý (tùy chọn)" : "Hint (optional)"}
                          </Label>
                          <Input
                            id="uq-hint"
                            value={draft.hint}
                            onChange={(e) =>
                              setDraft((prev) => ({ ...prev, hint: e.target.value }))
                            }
                          />
                        </div>
                      </div>

                      {questionId && (
                        <QuestionNotePanel
                          questionId={questionId}
                          studySetId={studySetId}
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

          {/* Mobile Keyboard-Safe Compact Single-Row Sticky Footer (zero clipping at 360/390/430px) */}
          <div className="flex shrink-0 flex-row flex-wrap items-center justify-end gap-2 border-t border-border bg-background px-4 py-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom))] sm:px-6 sm:py-3">
            <Button
              type="button"
              variant="outline"
              disabled={isSaving}
              onClick={() => requestGuardedAction({ type: "close" })}
              className="min-h-11 px-3.5 text-sm sm:min-h-9"
            >
              {vi ? "Hủy" : "Cancel"}
            </Button>

            <Button
              type={showLivePreview ? "button" : "submit"}
              form={showLivePreview ? undefined : "question-editor-form"}
              variant={canGoNext ? "secondary" : "default"}
              disabled={isSaving || isWaitingForInitialHydration}
              onClick={showLivePreview ? () => void performSave("save") : undefined}
              className="min-h-11 gap-1.5 px-4 text-sm sm:min-h-9"
            >
              {isSaving ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="size-4" aria-hidden="true" />
              )}
              <span>
                {questionId
                  ? vi
                    ? "Lưu thay đổi"
                    : "Save changes"
                  : vi
                    ? "Lưu câu hỏi"
                    : "Save question"}
              </span>
            </Button>

            {canGoNext && (
              <Button
                type="button"
                disabled={isSaving || isWaitingForInitialHydration}
                onClick={() => void performSave("save_and_next")}
                className="min-h-11 gap-1.5 px-4 text-sm sm:min-h-9"
              >
                {isSaving ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <ArrowRight className="size-4" aria-hidden="true" />
                )}
                <span>{vi ? "Lưu & Câu tiếp" : "Save & Next"}</span>
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Unsaved Changes Dirty Guard Confirmation */}
      <AlertDialog
        open={Boolean(pendingGuardAction)}
        onOpenChange={(isOpen) => {
          if (!isOpen) setPendingGuardAction(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {vi ? "Bỏ các thay đổi chưa lưu?" : "Discard unsaved changes?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {vi
                ? "Bạn có thay đổi chưa được lưu trên câu hỏi này. Nếu rời đi ngay bây giờ, các chỉnh sửa và ảnh vừa tải lên chưa lưu sẽ bị hủy."
                : "You have unsaved edits on this question. Leaving now will discard your edits and clean up any unsaved uploaded images."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {vi ? "Ở lại chỉnh sửa" : "Keep editing"}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingGuardAction) {
                  executeGuardAction(pendingGuardAction);
                }
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {vi ? "Bỏ thay đổi" : "Discard changes"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
