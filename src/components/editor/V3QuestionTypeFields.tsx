"use client";

import * as React from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ImagePlus,
  Loader2,
  Plus,
  Trash2,
  Volume2,
} from "lucide-react";
import { toast } from "sonner";
import { getFriendlyErrorMessage } from "@/components/layout/api-client";
import { uploadAudioSmart, uploadImageSmart } from "@/lib/media/direct-upload";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { AnswerMatchMode, Locale, QuestionType } from "@/types/domain";
import type {
  DiagramSet,
  FillInBlankSpec,
  MatchingPair,
  OrderingItem,
  QuestionTypePayload,
  RichTextDoc,
  SharedPassage,
} from "@/types/v3";

export interface EditableOption {
  /** Preserves existing UUID on edit; omitted for brand-new options */
  id?: string;
  localKey: string;
  content: string;
  content_rich?: RichTextDoc | null;
  image_url?: string;
  image_alt?: string;
  is_correct: boolean;
}

export interface EditableAcceptedAnswer {
  id?: string;
  localKey: string;
  answer_text: string;
  match_mode: AnswerMatchMode;
}

export interface QuestionDraft {
  id?: string;
  question_type: QuestionType;
  prompt: string;
  prompt_rich?: RichTextDoc | null;
  prompt_image_url: string;
  back_text: string;
  back_rich?: RichTextDoc | null;
  chapter: string;
  difficulty: "easy" | "medium" | "hard";
  explanation: string;
  explanation_rich?: RichTextDoc | null;
  hint: string;
  tagsText: string;
  audio_url: string;
  audio_transcript: string;
  passage_id: string;
  diagram_id: string;
  options: EditableOption[];
  accepted_answers: EditableAcceptedAnswer[];
  type_payload: QuestionTypePayload | null;
}

export function createDefaultPayloadForType(
  type: QuestionType,
): QuestionTypePayload | null {
  switch (type) {
    case "fill_in_blank":
      return {
        type: "fill_in_blank",
        blanks: [
          {
            blank_id: "b1",
            accepted_answers: [""],
            match_mode: "case_insensitive",
          },
        ],
      };
    case "numerical":
      return {
        type: "numerical",
        correct_value: 0,
        abs_tolerance: 0,
        rel_tolerance: null,
        unit: "",
        accepted_units: [],
        unit_required: false,
      };
    case "image_choice":
      return {
        type: "image_choice",
        selection_mode: "single",
      };
    case "ordering":
      return {
        type: "ordering",
        items: [
          { id: crypto.randomUUID(), text: "", correct_position: 0 },
          { id: crypto.randomUUID(), text: "", correct_position: 1 },
          { id: crypto.randomUUID(), text: "", correct_position: 2 },
        ],
      };
    case "matching":
      return {
        type: "matching",
        pairs: [
          { id: crypto.randomUUID(), left_text: "", right_id: crypto.randomUUID(), right_text: "" },
          { id: crypto.randomUUID(), left_text: "", right_id: crypto.randomUUID(), right_text: "" },
        ],
      };
    case "image_hotspot":
      return {
        type: "image_hotspot",
        image_url: "",
        target_hotspots: [
          {
            id: crypto.randomUUID(),
            label: "Zone 1",
            shape: "point",
            geometry: { shape: "point", x: 0.5, y: 0.5, radius: 0.06 },
          },
        ],
      };
    case "reading_passage":
      return {
        type: "reading_passage",
        passage_title: "",
        passage_text: "",
        sub_answer_kind: "single_choice",
      };
    case "listening":
      return {
        type: "listening",
        audio_url: "",
        transcript: "",
        show_transcript_after_submit: true,
        max_replays: null,
        sub_answer_kind: "single_choice",
      };
    default:
      return null;
  }
}

export function isChoiceCapableDraft(draft: QuestionDraft): boolean {
  if (
    draft.question_type === "single_choice" ||
    draft.question_type === "multiple_choice" ||
    draft.question_type === "true_false" ||
    draft.question_type === "image_choice"
  ) {
    return true;
  }
  if (
    draft.question_type === "reading_passage" &&
    draft.type_payload?.type === "reading_passage"
  ) {
    return (
      draft.type_payload.sub_answer_kind === "single_choice" ||
      draft.type_payload.sub_answer_kind === "multiple_choice" ||
      draft.type_payload.sub_answer_kind === "true_false"
    );
  }
  if (
    draft.question_type === "listening" &&
    draft.type_payload?.type === "listening"
  ) {
    return (
      draft.type_payload.sub_answer_kind === "single_choice" ||
      draft.type_payload.sub_answer_kind === "multiple_choice"
    );
  }
  return false;
}

export function parseCommaSeparatedAcceptedAnswers(raw: string): string[] {
  const parts = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts.length > 0 ? parts : [""];
}

interface FillInBlankRowProps {
  blank: FillInBlankSpec;
  idx: number;
  vi: boolean;
  canRemove: boolean;
  onChangeBlankId: (nextId: string) => void;
  onChangeAnswers: (nextAnswers: string[]) => void;
  onChangeMatchMode: (mode: AnswerMatchMode) => void;
  onRemove: () => void;
}

function FillInBlankRow({
  blank,
  idx,
  vi,
  canRemove,
  onChangeBlankId,
  onChangeAnswers,
  onChangeMatchMode,
  onRemove,
}: FillInBlankRowProps): React.ReactElement {
  // Keep raw user-typed draft strings locally so typing spaces ("Ha Noi") or editing
  // blank_id NEVER gets stripped or remounted on keystroke (FUNC-06 / V32-019).
  const [rawBlankId, setRawBlankId] = React.useState<string>(blank.blank_id);
  const [rawAnswers, setRawAnswers] = React.useState<string>(
    blank.accepted_answers.filter((s) => s.length > 0).join(", "),
  );

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
      <Input
        aria-label={vi ? `Mã ô trống ${idx + 1}` : `Blank ID ${idx + 1}`}
        className="sm:col-span-2 font-mono text-xs"
        value={rawBlankId}
        onChange={(e) => {
          const nextRaw = e.target.value;
          setRawBlankId(nextRaw);
          const trimmed = nextRaw.trim();
          onChangeBlankId(trimmed || `b${idx + 1}`);
        }}
        onBlur={() => {
          const normalized = rawBlankId.trim() || `b${idx + 1}`;
          setRawBlankId(normalized);
          onChangeBlankId(normalized);
        }}
      />
      <Input
        aria-label={vi ? `Đáp án đúng ô trống ${idx + 1}` : `Accepted answers for blank ${idx + 1}`}
        className="sm:col-span-6"
        placeholder={vi ? "Đáp án đúng (ngăn cách dấu phẩy)" : "Accepted answers (comma-separated)"}
        value={rawAnswers}
        onChange={(e) => {
          const nextRaw = e.target.value;
          setRawAnswers(nextRaw);
          onChangeAnswers(parseCommaSeparatedAcceptedAnswers(nextRaw));
        }}
        onBlur={() => {
          const parsed = parseCommaSeparatedAcceptedAnswers(rawAnswers);
          const normalizedDisplay = parsed.filter((s) => s.length > 0).join(", ");
          setRawAnswers(normalizedDisplay);
          onChangeAnswers(parsed);
        }}
      />
      <Select
        value={blank.match_mode ?? "case_insensitive"}
        onValueChange={(v) => onChangeMatchMode(v as AnswerMatchMode)}
      >
        <SelectTrigger className="sm:col-span-3">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="case_insensitive">
            {vi ? "Không phân biệt hoa/thường" : "Case-insensitive"}
          </SelectItem>
          <SelectItem value="exact">{vi ? "Chính xác tuyệt đối" : "Exact"}</SelectItem>
          <SelectItem value="ignore_diacritics">
            {vi ? "Bỏ dấu tiếng Việt" : "Ignore diacritics"}
          </SelectItem>
          <SelectItem value="numeric">{vi ? "So sánh số" : "Numeric"}</SelectItem>
        </SelectContent>
      </Select>
      {canRemove && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={vi ? `Xóa ô trống ${idx + 1}` : `Remove blank ${idx + 1}`}
          className="min-h-11 min-w-11 sm:col-span-1 sm:min-h-9 sm:min-w-9"
          onClick={onRemove}
        >
          <Trash2 className="size-4" aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

export interface V3QuestionTypeFieldsProps {
  setId: string;
  locale: Locale;
  draft: QuestionDraft;
  setDraft: React.Dispatch<React.SetStateAction<QuestionDraft>>;
  passages: SharedPassage[];
  diagrams: DiagramSet[];
}

export function V3QuestionTypeFields({
  setId,
  locale,
  draft,
  setDraft,
  passages,
  diagrams,
}: V3QuestionTypeFieldsProps): React.ReactElement {
  const vi = locale === "vi";
  const [uploadingKey, setUploadingKey] = React.useState<string | null>(null);
  const blankResetToken = `${draft.id ?? "new"}:${draft.question_type}`;
  const [blankRowKeys, setBlankRowKeys] = React.useState<{
    token: string;
    keys: string[];
  }>(() => ({
    token: blankResetToken,
    keys:
      draft.type_payload?.type === "fill_in_blank"
        ? draft.type_payload.blanks.map((_, i) => `blank-row-${i}`)
        : [],
  }));
  const blankKeyCounterRef = React.useRef(100);

  const activeBlankKeys = React.useMemo(() => {
    const count =
      draft.type_payload?.type === "fill_in_blank" ? draft.type_payload.blanks.length : 0;
    const base = blankRowKeys.token === blankResetToken ? blankRowKeys.keys : [];
    if (base.length === count) return base;
    return Array.from({ length: count }, (_, i) => base[i] ?? `blank-row-${i}`);
  }, [blankRowKeys, blankResetToken, draft.type_payload]);

  const uploadImageForTarget = async (
    file: File | undefined,
    key: string,
    onSuccess: (proxyUrl: string) => void,
  ): Promise<void> => {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) {
      toast.error(
        vi
          ? "Chỉ chấp nhận ảnh PNG, JPEG, WebP hoặc GIF (từ chối SVG)."
          : "Only PNG, JPEG, WebP, or GIF images are allowed (SVG rejected).",
      );
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error(vi ? "Ảnh vượt quá 5 MB." : "Image exceeds 5 MB.");
      return;
    }
    setUploadingKey(key);
    try {
      const response = await uploadImageSmart({
        file,
        fileName: file.name,
        purpose: "question",
        studySetId: setId,
      });
      const res = (await response.json()) as {
        data?: { proxyUrl?: string; signedUrl?: string; path?: string };
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(res.error?.message ?? "Upload failed");
      }
      const url = res.data?.proxyUrl ?? res.data?.signedUrl ?? res.data?.path ?? "";
      if (!url) throw new Error("Upload failed");
      onSuccess(url);
      toast.success(vi ? "Đã tải ảnh lên." : "Image uploaded.");
    } catch (err) {
      toast.error(getFriendlyErrorMessage(err, locale));
    } finally {
      setUploadingKey(null);
    }
  };

  const uploadAudioFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast.error(vi ? "Tệp âm thanh vượt quá 10 MB." : "Audio file exceeds 10 MB.");
      return;
    }
    setUploadingKey("audio");
    try {
      const response = await uploadAudioSmart({
        file,
        fileName: file.name,
        studySetId: setId,
        purpose: "audio",
      });
      const res = (await response.json()) as {
        data?: { proxyUrl?: string; signedUrl?: string; path?: string };
        error?: { message?: string };
      };
      if (!response.ok) {
        throw new Error(res.error?.message ?? "Upload failed");
      }
      const url = res.data?.proxyUrl ?? res.data?.signedUrl ?? res.data?.path ?? "";
      if (!url) throw new Error("Upload failed");
      setDraft((prev) => ({
        ...prev,
        audio_url: url,
        type_payload:
          prev.type_payload?.type === "listening"
            ? { ...prev.type_payload, audio_url: url }
            : prev.type_payload,
      }));
      toast.success(vi ? "Đã tải tệp âm thanh lên." : "Audio uploaded.");
    } catch (err) {
      toast.error(getFriendlyErrorMessage(err, locale));
    } finally {
      setUploadingKey(null);
    }
  };

  const showChoiceBlock = isChoiceCapableDraft(draft);
  const isMultipleSelection =
    draft.question_type === "multiple_choice" ||
    (draft.question_type === "image_choice" &&
      draft.type_payload?.type === "image_choice" &&
      draft.type_payload.selection_mode === "multiple") ||
    (draft.type_payload?.type === "reading_passage" &&
      draft.type_payload.sub_answer_kind === "multiple_choice") ||
    (draft.type_payload?.type === "listening" &&
      draft.type_payload.sub_answer_kind === "multiple_choice");

  const showShortAnswerBlock =
    draft.question_type === "short_answer" ||
    draft.question_type === "flashcard" ||
    (draft.type_payload?.type === "reading_passage" &&
      draft.type_payload.sub_answer_kind === "short_answer") ||
    (draft.type_payload?.type === "listening" &&
      draft.type_payload.sub_answer_kind === "short_answer");

  return (
    <div className="space-y-4">
      {/* Reading Passage Section */}
      {draft.question_type === "reading_passage" &&
        draft.type_payload?.type === "reading_passage" && (
          <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{vi ? "Đoạn văn dùng chung (tùy chọn)" : "Shared passage (optional)"}</Label>
                <Select
                  value={draft.passage_id || "inline"}
                  onValueChange={(val) => {
                    const selected = passages.find((p) => p.id === val);
                    setDraft((prev) => ({
                      ...prev,
                      passage_id: val === "inline" ? "" : val,
                      type_payload:
                        prev.type_payload?.type === "reading_passage"
                          ? {
                              ...prev.type_payload,
                              passage_id: val === "inline" ? null : val,
                              passage_title: selected?.title ?? prev.type_payload.passage_title,
                              passage_text: selected?.content_text ?? prev.type_payload.passage_text,
                            }
                          : prev.type_payload,
                    }));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inline">
                      {vi ? "Nhập đoạn văn trực tiếp" : "Inline passage text"}
                    </SelectItem>
                    {passages.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{vi ? "Kiểu trả lời câu hỏi con" : "Sub-question answer type"}</Label>
                <Select
                  value={draft.type_payload.sub_answer_kind}
                  onValueChange={(v) =>
                    setDraft((prev) => ({
                      ...prev,
                      type_payload:
                        prev.type_payload?.type === "reading_passage"
                          ? {
                              ...prev.type_payload,
                              sub_answer_kind: v as
                                | "single_choice"
                                | "multiple_choice"
                                | "true_false"
                                | "short_answer",
                            }
                          : prev.type_payload,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="single_choice">{vi ? "Một đáp án" : "Single Choice"}</SelectItem>
                    <SelectItem value="multiple_choice">{vi ? "Nhiều đáp án" : "Multiple Choice"}</SelectItem>
                    <SelectItem value="true_false">{vi ? "Đúng / Sai" : "True / False"}</SelectItem>
                    <SelectItem value="short_answer">{vi ? "Trả lời ngắn" : "Short Answer"}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>{vi ? "Tiêu đề đoạn văn" : "Passage Title"}</Label>
              <Input
                value={draft.type_payload.passage_title ?? ""}
                onChange={(e) => {
                  const val = e.target.value;
                  setDraft((prev) => ({
                    ...prev,
                    type_payload:
                      prev.type_payload?.type === "reading_passage"
                        ? { ...prev.type_payload, passage_title: val }
                        : prev.type_payload,
                  }));
                }}
              />
            </div>
            <div className="space-y-1.5">
              <Label>{vi ? "Nội dung đoạn văn đọc hiểu" : "Passage Content"}</Label>
              <Textarea
                rows={4}
                value={draft.type_payload.passage_text ?? ""}
                onChange={(e) => {
                  const val = e.target.value;
                  setDraft((prev) => ({
                    ...prev,
                    type_payload:
                      prev.type_payload?.type === "reading_passage"
                        ? { ...prev.type_payload, passage_text: val }
                        : prev.type_payload,
                  }));
                }}
              />
            </div>
          </div>
        )}

      {/* Listening Section */}
      {draft.question_type === "listening" &&
        draft.type_payload?.type === "listening" && (() => {
          const activeAudioUrl = draft.audio_url || draft.type_payload.audio_url || "";
          return (
          <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label htmlFor="q-listening-audio-url">
                  {vi ? "Âm thanh (MP3/WAV/M4A/WebM/OGG ≤ 10MB)" : "Audio (≤ 10MB)"}
                </Label>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  asChild
                  disabled={uploadingKey === "audio"}
                >
                  <label className="cursor-pointer gap-1.5">
                    {uploadingKey === "audio" ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <Volume2 className="size-4" aria-hidden="true" />
                    )}
                    <span>
                      {activeAudioUrl
                        ? vi
                          ? "Đổi âm thanh"
                          : "Change audio"
                        : vi
                          ? "Tải âm thanh"
                          : "Upload Audio"}
                    </span>
                    <input
                      type="file"
                      accept="audio/mpeg,audio/mp3,audio/wav,audio/mp4,audio/x-m4a,audio/webm,audio/ogg"
                      className="sr-only"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        e.target.value = "";
                        void uploadAudioFile(f);
                      }}
                    />
                  </label>
                </Button>
              </div>

              {activeAudioUrl && (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-background p-2">
                  <audio
                    controls
                    preload="none"
                    src={activeAudioUrl}
                    className="h-9 max-w-full flex-1"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs text-destructive hover:text-destructive"
                    onClick={() =>
                      setDraft((prev) => ({
                        ...prev,
                        audio_url: "",
                        type_payload:
                          prev.type_payload?.type === "listening"
                            ? { ...prev.type_payload, audio_url: "" }
                            : prev.type_payload,
                      }))
                    }
                  >
                    <Trash2 className="mr-1 size-3.5" aria-hidden="true" />
                    {vi ? "Gỡ" : "Remove"}
                  </Button>
                </div>
              )}

              <details className="rounded-md border border-border/70 bg-background/60 px-3 py-1.5">
                <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                  {activeAudioUrl
                    ? vi
                      ? "Xem / chỉnh sửa liên kết âm thanh (URL)"
                      : "View / edit audio URL"
                    : vi
                      ? "Hoặc dán liên kết âm thanh trực tiếp (URL)"
                      : "Or paste an audio URL directly"}
                </summary>
                <div className="pt-2 pb-1">
                  <Input
                    id="q-listening-audio-url"
                    type="text"
                    inputMode="url"
                    value={activeAudioUrl}
                    placeholder="https://..."
                    onChange={(e) => {
                      const val = e.target.value;
                      setDraft((prev) => ({
                        ...prev,
                        audio_url: val,
                        type_payload:
                          prev.type_payload?.type === "listening"
                            ? { ...prev.type_payload, audio_url: val }
                            : prev.type_payload,
                      }));
                    }}
                  />
                </div>
              </details>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{vi ? "Kiểu trả lời" : "Answer kind"}</Label>
                <Select
                  value={draft.type_payload.sub_answer_kind}
                  onValueChange={(v) =>
                    setDraft((prev) => ({
                      ...prev,
                      type_payload:
                        prev.type_payload?.type === "listening"
                          ? {
                              ...prev.type_payload,
                              sub_answer_kind: v as
                                | "single_choice"
                                | "multiple_choice"
                                | "short_answer",
                            }
                          : prev.type_payload,
                    }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="single_choice">{vi ? "Một đáp án" : "Single Choice"}</SelectItem>
                    <SelectItem value="multiple_choice">{vi ? "Nhiều đáp án" : "Multiple Choice"}</SelectItem>
                    <SelectItem value="short_answer">{vi ? "Trả lời ngắn" : "Short Answer"}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{vi ? "Giới hạn số lần nghe (để trống = không giới hạn)" : "Max replays (empty = unlimited)"}</Label>
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={draft.type_payload.max_replays ?? ""}
                  onChange={(e) => {
                    const n = e.target.value ? Number.parseInt(e.target.value, 10) : null;
                    setDraft((prev) => ({
                      ...prev,
                      type_payload:
                        prev.type_payload?.type === "listening"
                          ? { ...prev.type_payload, max_replays: Number.isFinite(n) ? n : null }
                          : prev.type_payload,
                    }));
                  }}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>{vi ? "Bản chép lời (Transcript — ẩn khi thi, hiện sau khi nộp)" : "Transcript (hidden during exam, shown after submit)"}</Label>
              <Textarea
                rows={2}
                value={draft.audio_transcript}
                onChange={(e) => {
                  const val = e.target.value;
                  setDraft((prev) => ({
                    ...prev,
                    audio_transcript: val,
                    type_payload:
                      prev.type_payload?.type === "listening"
                        ? { ...prev.type_payload, transcript: val }
                        : prev.type_payload,
                  }));
                }}
              />
            </div>
          </div>
          );
        })()}

      {/* Fill in the Blank Section */}
      {draft.question_type === "fill_in_blank" &&
        draft.type_payload?.type === "fill_in_blank" && (
          <div className="space-y-2.5 rounded-lg border border-border bg-muted/20 p-3">
            <div className="flex items-center justify-between">
              <div>
                <Label>{vi ? "Định nghĩa các ô trống ({{b1}}, {{b2}}…)" : "Blank Definitions ({{b1}}, {{b2}}…)"}</Label>
                <p className="text-xs text-muted-foreground">
                  {vi
                    ? "Đặt {{b1}}, {{b2}} trong nội dung câu hỏi. Nhập nhiều đáp án chấp nhận phân cách bằng dấu phẩy."
                    : "Use {{b1}}, {{b2}} placeholders in prompt. Separate multiple accepted answers with commas."}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  blankKeyCounterRef.current += 1;
                  const nextKey = `blank-row-${blankKeyCounterRef.current}`;
                  setBlankRowKeys({
                    token: blankResetToken,
                    keys: [...activeBlankKeys, nextKey],
                  });
                  setDraft((prev) => {
                    if (prev.type_payload?.type !== "fill_in_blank") return prev;
                    const nextNum = prev.type_payload.blanks.length + 1;
                    const nextBlank: FillInBlankSpec = {
                      blank_id: `b${nextNum}`,
                      accepted_answers: [""],
                      match_mode: "case_insensitive",
                    };
                    return {
                      ...prev,
                      type_payload: {
                        ...prev.type_payload,
                        blanks: [...prev.type_payload.blanks, nextBlank],
                      },
                    };
                  });
                }}
              >
                <Plus className="mr-1 size-3.5" aria-hidden="true" />
                {vi ? "Thêm ô trống" : "Add blank"}
              </Button>
            </div>
            {draft.type_payload.blanks.map((blank, idx) => (
              <FillInBlankRow
                key={`${blankResetToken}:${activeBlankKeys[idx] ?? idx}`}
                blank={blank}
                idx={idx}
                vi={vi}
                canRemove={
                  draft.type_payload?.type === "fill_in_blank" &&
                  draft.type_payload.blanks.length > 1
                }
                onChangeBlankId={(val) =>
                  setDraft((prev) => {
                    if (prev.type_payload?.type !== "fill_in_blank") return prev;
                    const blanks = prev.type_payload.blanks.map((b, i) =>
                      i === idx ? { ...b, blank_id: val } : b,
                    );
                    return { ...prev, type_payload: { ...prev.type_payload, blanks } };
                  })
                }
                onChangeAnswers={(list) =>
                  setDraft((prev) => {
                    if (prev.type_payload?.type !== "fill_in_blank") return prev;
                    const blanks = prev.type_payload.blanks.map((b, i) =>
                      i === idx ? { ...b, accepted_answers: list } : b,
                    );
                    return { ...prev, type_payload: { ...prev.type_payload, blanks } };
                  })
                }
                onChangeMatchMode={(mode) =>
                  setDraft((prev) => {
                    if (prev.type_payload?.type !== "fill_in_blank") return prev;
                    const blanks = prev.type_payload.blanks.map((b, i) =>
                      i === idx ? { ...b, match_mode: mode } : b,
                    );
                    return { ...prev, type_payload: { ...prev.type_payload, blanks } };
                  })
                }
                onRemove={() => {
                  setBlankRowKeys({
                    token: blankResetToken,
                    keys: activeBlankKeys.filter((_, i) => i !== idx),
                  });
                  setDraft((prev) => {
                    if (prev.type_payload?.type !== "fill_in_blank") return prev;
                    return {
                      ...prev,
                      type_payload: {
                        ...prev.type_payload,
                        blanks: prev.type_payload.blanks.filter((_, i) => i !== idx),
                      },
                    };
                  });
                }}
              />
            ))}
          </div>
        )}

      {/* Numerical Section */}
      {draft.question_type === "numerical" &&
        draft.type_payload?.type === "numerical" && (
          <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>{vi ? "Giá trị đúng" : "Correct Value"}</Label>
                <Input
                  type="number"
                  step="any"
                  value={draft.type_payload.correct_value}
                  onChange={(e) => {
                    const num = Number(e.target.value);
                    setDraft((prev) => ({
                      ...prev,
                      type_payload:
                        prev.type_payload?.type === "numerical"
                          ? { ...prev.type_payload, correct_value: Number.isFinite(num) ? num : 0 }
                          : prev.type_payload,
                    }));
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{vi ? "Sai số tuyệt đối (±)" : "Abs Tolerance (±)"}</Label>
                <Input
                  type="number"
                  step="any"
                  min={0}
                  value={draft.type_payload.abs_tolerance ?? 0}
                  onChange={(e) => {
                    const num = Number(e.target.value);
                    setDraft((prev) => ({
                      ...prev,
                      type_payload:
                        prev.type_payload?.type === "numerical"
                          ? { ...prev.type_payload, abs_tolerance: Number.isFinite(num) ? Math.max(0, num) : 0 }
                          : prev.type_payload,
                    }));
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label>{vi ? "Đơn vị (VD: hPa, m/s)" : "Unit (e.g. hPa, m/s)"}</Label>
                <Input
                  value={draft.type_payload.unit ?? ""}
                  onChange={(e) => {
                    const unit = e.target.value;
                    setDraft((prev) => ({
                      ...prev,
                      type_payload:
                        prev.type_payload?.type === "numerical"
                          ? { ...prev.type_payload, unit }
                          : prev.type_payload,
                    }));
                  }}
                />
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <Switch
                id="num-unit-required"
                checked={Boolean(draft.type_payload.unit_required)}
                onCheckedChange={(checked) =>
                  setDraft((prev) => ({
                    ...prev,
                    type_payload:
                      prev.type_payload?.type === "numerical"
                        ? { ...prev.type_payload, unit_required: checked }
                        : prev.type_payload,
                  }))
                }
              />
              <Label htmlFor="num-unit-required" className="text-xs font-normal">
                {vi
                  ? "Bắt buộc nhập đúng đơn vị (đơn vị sai chiều vật lý luôn bị tính sai)"
                  : "Require matching unit (wrong units are always marked incorrect)"}
              </Label>
            </div>
          </div>
        )}

      {/* Ordering Section */}
      {draft.question_type === "ordering" &&
        draft.type_payload?.type === "ordering" &&
        (() => {
          const orderingItems = draft.type_payload.items;
          return (
            <div className="space-y-2.5 rounded-lg border border-border bg-muted/20 p-3">
              <div className="flex items-center justify-between">
                <Label>{vi ? "Các bước theo ĐÚNG thứ tự chuẩn (1 → N)" : "Items in CORRECT order (1 → N)"}</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setDraft((prev) => {
                      if (prev.type_payload?.type !== "ordering") return prev;
                      const next: OrderingItem = {
                        id: crypto.randomUUID(),
                        text: "",
                        correct_position: prev.type_payload.items.length,
                      };
                      return {
                        ...prev,
                        type_payload: {
                          ...prev.type_payload,
                          items: [...prev.type_payload.items, next],
                        },
                      };
                    })
                  }
                >
                  <Plus className="mr-1 size-3.5" />
                  {vi ? "Thêm mục" : "Add item"}
                </Button>
              </div>
              {orderingItems.map((item, idx) => (
                <div key={item.id} className="flex items-center gap-2">
                  <span className="w-6 text-center font-mono text-xs font-semibold text-muted-foreground">
                    {idx + 1}.
                  </span>
                  <Input
                    value={item.text}
                    onChange={(e) => {
                      const val = e.target.value;
                      setDraft((prev) => {
                        if (prev.type_payload?.type !== "ordering") return prev;
                        return {
                          ...prev,
                          type_payload: {
                            ...prev.type_payload,
                            items: prev.type_payload.items.map((it, i) =>
                              i === idx ? { ...it, text: val, correct_position: i } : it,
                            ),
                          },
                        };
                      });
                    }}
                  />
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    disabled={idx === 0}
                    aria-label={vi ? "Lên" : "Move up"}
                    onClick={() =>
                      setDraft((prev) => {
                        if (prev.type_payload?.type !== "ordering" || idx === 0) return prev;
                        const list = [...prev.type_payload.items];
                        [list[idx - 1], list[idx]] = [list[idx], list[idx - 1]];
                        return {
                          ...prev,
                          type_payload: {
                            ...prev.type_payload,
                            items: list.map((it, i) => ({ ...it, correct_position: i })),
                          },
                        };
                      })
                    }
                  >
                    <ArrowUp className="size-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    disabled={idx === orderingItems.length - 1}
                    aria-label={vi ? "Xuống" : "Move down"}
                    onClick={() =>
                      setDraft((prev) => {
                        if (
                          prev.type_payload?.type !== "ordering" ||
                          idx >= prev.type_payload.items.length - 1
                        )
                          return prev;
                        const list = [...prev.type_payload.items];
                        [list[idx], list[idx + 1]] = [list[idx + 1], list[idx]];
                        return {
                          ...prev,
                          type_payload: {
                            ...prev.type_payload,
                            items: list.map((it, i) => ({ ...it, correct_position: i })),
                          },
                        };
                      })
                    }
                  >
                    <ArrowDown className="size-3.5" />
                  </Button>
                  {orderingItems.length > 2 && (
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      onClick={() =>
                        setDraft((prev) => {
                          if (prev.type_payload?.type !== "ordering") return prev;
                          return {
                            ...prev,
                            type_payload: {
                              ...prev.type_payload,
                              items: prev.type_payload.items
                                .filter((_, i) => i !== idx)
                                .map((it, i) => ({ ...it, correct_position: i })),
                            },
                          };
                        })
                      }
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          );
        })()}

      {/* Matching Section */}
      {draft.question_type === "matching" &&
        draft.type_payload?.type === "matching" &&
        (() => {
          const matchingPairs = draft.type_payload.pairs;
          return (
            <div className="space-y-2.5 rounded-lg border border-border bg-muted/20 p-3">
              <div className="flex items-center justify-between">
                <Label>{vi ? "Các cặp ghép đúng (Trái ↔ Phải)" : "Matching Pairs (Left ↔ Right)"}</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setDraft((prev) => {
                      if (prev.type_payload?.type !== "matching") return prev;
                      const pair: MatchingPair = {
                        id: crypto.randomUUID(),
                        left_text: "",
                        right_id: crypto.randomUUID(),
                        right_text: "",
                      };
                      return {
                        ...prev,
                        type_payload: {
                          ...prev.type_payload,
                          pairs: [...prev.type_payload.pairs, pair],
                        },
                      };
                    })
                  }
                >
                  <Plus className="mr-1 size-3.5" />
                  {vi ? "Thêm cặp" : "Add pair"}
                </Button>
              </div>
              {matchingPairs.map((pair, idx) => (
                <div key={pair.id} className="flex items-center gap-2">
                  <Input
                    placeholder={vi ? `Vế trái ${idx + 1}` : `Left ${idx + 1}`}
                    value={pair.left_text}
                    onChange={(e) => {
                      const val = e.target.value;
                      setDraft((prev) => {
                        if (prev.type_payload?.type !== "matching") return prev;
                        return {
                          ...prev,
                          type_payload: {
                            ...prev.type_payload,
                            pairs: prev.type_payload.pairs.map((p, i) =>
                              i === idx ? { ...p, left_text: val } : p,
                            ),
                          },
                        };
                      });
                    }}
                  />
                  <span className="text-muted-foreground">↔</span>
                  <Input
                    placeholder={vi ? `Vế phải ${idx + 1}` : `Right ${idx + 1}`}
                    value={pair.right_text}
                    onChange={(e) => {
                      const val = e.target.value;
                      setDraft((prev) => {
                        if (prev.type_payload?.type !== "matching") return prev;
                        return {
                          ...prev,
                          type_payload: {
                            ...prev.type_payload,
                            pairs: prev.type_payload.pairs.map((p, i) =>
                              i === idx ? { ...p, right_text: val } : p,
                            ),
                          },
                        };
                      });
                    }}
                  />
                  {matchingPairs.length > 2 && (
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      onClick={() =>
                        setDraft((prev) => {
                          if (prev.type_payload?.type !== "matching") return prev;
                          return {
                            ...prev,
                            type_payload: {
                              ...prev.type_payload,
                              pairs: prev.type_payload.pairs.filter((_, i) => i !== idx),
                            },
                          };
                        })
                      }
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          );
        })()}

      {/* Image Hotspot Section */}
      {draft.question_type === "image_hotspot" &&
        draft.type_payload?.type === "image_hotspot" && (
          <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>{vi ? "Liên kết Sơ đồ (Diagram) có sẵn" : "Link Existing Diagram"}</Label>
                <Select
                  value={draft.diagram_id || "custom"}
                  onValueChange={(val) => {
                    const found = diagrams.find((d) => d.id === val);
                    setDraft((prev) => ({
                      ...prev,
                      diagram_id: val === "custom" ? "" : val,
                      prompt_image_url: found?.base_image_url ?? prev.prompt_image_url,
                      type_payload:
                        prev.type_payload?.type === "image_hotspot"
                          ? {
                              ...prev.type_payload,
                              diagram_id: val === "custom" ? null : val,
                              image_url: found?.base_image_url ?? prev.type_payload.image_url,
                            }
                          : prev.type_payload,
                    }));
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="custom">
                      {vi ? "Dùng ảnh câu hỏi & tọa độ chuẩn hóa [0..1]" : "Use question image & normalized [0..1] coords"}
                    </SelectItem>
                    {diagrams.map((d) => (
                      <SelectItem key={d.id} value={d.id}>
                        {d.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>{vi ? "Nhãn vùng đáp án" : "Target Hotspot Label"}</Label>
                <Input
                  value={draft.type_payload.target_hotspots[0]?.label ?? ""}
                  onChange={(e) => {
                    const label = e.target.value;
                    setDraft((prev) => {
                      if (prev.type_payload?.type !== "image_hotspot") return prev;
                      const first = prev.type_payload.target_hotspots[0] ?? {
                        id: crypto.randomUUID(),
                        label: "",
                        shape: "point" as const,
                        geometry: { shape: "point" as const, x: 0.5, y: 0.5, radius: 0.06 },
                      };
                      return {
                        ...prev,
                        type_payload: {
                          ...prev.type_payload,
                          image_url: prev.prompt_image_url || prev.type_payload.image_url,
                          target_hotspots: [
                            { ...first, label },
                            ...prev.type_payload.target_hotspots.slice(1),
                          ],
                        },
                      };
                    });
                  }}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {(["x", "y", "radius"] as const).map((coord) => {
                const geom = draft.type_payload?.type === "image_hotspot"
                  ? draft.type_payload.target_hotspots[0]?.geometry
                  : undefined;
                const val =
                  geom && geom.shape === "point"
                    ? coord === "x"
                      ? geom.x
                      : coord === "y"
                        ? geom.y
                        : (geom.radius ?? 0.06)
                    : 0.5;
                return (
                  <div key={coord} className="space-y-1">
                    <Label className="text-xs uppercase">{coord} (0..1)</Label>
                    <Input
                      type="number"
                      step="0.01"
                      min={0}
                      max={1}
                      value={val}
                      onChange={(e) => {
                        const num = Math.min(1, Math.max(0, Number(e.target.value) || 0));
                        setDraft((prev) => {
                          if (prev.type_payload?.type !== "image_hotspot") return prev;
                          const first = prev.type_payload.target_hotspots[0];
                          if (!first || first.geometry.shape !== "point") return prev;
                          return {
                            ...prev,
                            type_payload: {
                              ...prev.type_payload,
                              target_hotspots: [
                                {
                                  ...first,
                                  geometry: { ...first.geometry, [coord]: num },
                                },
                                ...prev.type_payload.target_hotspots.slice(1),
                              ],
                            },
                          };
                        });
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        )}

      {/* Choice Options (Single / Multiple / True-False / Image Choice / Choice sub-kinds) */}
      {showChoiceBlock && (
        <div className="space-y-2.5">
          {draft.question_type === "image_choice" &&
            draft.type_payload?.type === "image_choice" && (
              <div className="flex items-center gap-2">
                <Checkbox
                  id="img-choice-multi"
                  checked={draft.type_payload.selection_mode === "multiple"}
                  onCheckedChange={(checked) =>
                    setDraft((prev) => ({
                      ...prev,
                      type_payload:
                        prev.type_payload?.type === "image_choice"
                          ? {
                              ...prev.type_payload,
                              selection_mode: checked ? "multiple" : "single",
                            }
                          : prev.type_payload,
                    }))
                  }
                />
                <Label htmlFor="img-choice-multi" className="text-xs font-normal">
                  {vi ? "Cho phép chọn nhiều hình đúng" : "Allow multiple correct images"}
                </Label>
              </div>
            )}

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
                        image_url: "",
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
                <div key={opt.localKey} className="space-y-1.5 rounded-lg border border-border/70 p-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setDraft((prev) => ({
                          ...prev,
                          options: prev.options.map((item, i) => {
                            if (isMultipleSelection) {
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
                        "flex size-9 shrink-0 items-center justify-center rounded-lg border font-mono text-xs font-bold transition-colors",
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
                      placeholder={
                        draft.question_type === "image_choice"
                          ? vi
                            ? `Nhãn hình ${letter} (tùy chọn)`
                            : `Image caption ${letter} (optional)`
                          : `${vi ? "Phương án" : "Option"} ${letter}`
                      }
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
                    <Button
                      type="button"
                      variant="outline"
                      size="icon-sm"
                      asChild
                      disabled={uploadingKey === opt.localKey}
                      title={vi ? "Tải ảnh cho phương án" : "Upload option image"}
                    >
                      <label className="cursor-pointer">
                        {uploadingKey === opt.localKey ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <ImagePlus className="size-3.5" />
                        )}
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp,image/gif"
                          className="sr-only"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            e.target.value = "";
                            void uploadImageForTarget(f, opt.localKey, (url) => {
                              setDraft((prev) => ({
                                ...prev,
                                options: prev.options.map((item, i) =>
                                  i === idx ? { ...item, image_url: url } : item,
                                ),
                              }));
                            });
                          }}
                        />
                      </label>
                    </Button>
                    {draft.options.length > 2 && draft.question_type !== "true_false" && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`${vi ? "Xóa" : "Delete"} ${letter}`}
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
                  {opt.image_url && (
                    <div className="flex items-center gap-2 pl-11">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={opt.image_url}
                        alt={opt.image_alt || `Option ${letter}`}
                        loading="lazy"
                        decoding="async"
                        className="h-12 max-w-[120px] rounded border border-border object-contain bg-background"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs text-destructive"
                        onClick={() =>
                          setDraft((prev) => ({
                            ...prev,
                            options: prev.options.map((item, i) =>
                              i === idx ? { ...item, image_url: "" } : item,
                            ),
                          }))
                        }
                      >
                        {vi ? "Gỡ ảnh" : "Remove image"}
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Flashcard Back & Accepted Answers */}
      {showShortAnswerBlock && (
        <div className="space-y-3">
          {draft.question_type === "flashcard" && (
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
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>
                {vi
                  ? "Đáp án chấp nhận (chế độ Gõ / Tự luận ngắn)"
                  : "Accepted answers (Write / Short Answer)"}
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
                <span>{vi ? "Thêm" : "Add"}</span>
              </Button>
            </div>

            {draft.accepted_answers.map((ans, idx) => (
              <div
                key={ans.localKey}
                className="flex flex-col gap-2 sm:flex-row sm:items-center"
              >
                <Input
                  value={ans.answer_text}
                  placeholder={vi ? "Nhập đáp án chấp nhận..." : "Enter accepted answer..."}
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
                  <SelectTrigger className="sm:w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="case_insensitive">
                      {vi ? "Không phân biệt hoa/thường" : "Case-insensitive"}
                    </SelectItem>
                    <SelectItem value="exact">
                      {vi ? "Chính xác tuyệt đối" : "Exact match"}
                    </SelectItem>
                    <SelectItem value="ignore_diacritics">
                      {vi ? "Bỏ dấu tiếng Việt" : "Ignore accents"}
                    </SelectItem>
                    <SelectItem value="numeric">{vi ? "So sánh số" : "Numeric"}</SelectItem>
                  </SelectContent>
                </Select>
                {draft.accepted_answers.length > 1 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() =>
                      setDraft((prev) => ({
                        ...prev,
                        accepted_answers: prev.accepted_answers.filter((_, i) => i !== idx),
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
    </div>
  );
}
