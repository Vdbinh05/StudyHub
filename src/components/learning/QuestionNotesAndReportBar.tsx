"use client";

import * as React from "react";
import { Flag, Loader2, Pencil, Save, StickyNote, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";
import {
  deleteQuestionNote,
  listQuestionNotes,
  submitQuestionReport,
  upsertQuestionNote,
} from "@/lib/learning/api-client";
import {
  QUESTION_REPORT_CATEGORIES,
  type QuestionReportCategory,
  type UserQuestionNote,
} from "@/types/domain";
import { lText } from "./learning-copy";

const REPORT_CATEGORY_LABELS: Record<
  QuestionReportCategory,
  { vi: string; en: string }
> = {
  wrong_answer: { vi: "Đáp án sai", en: "Wrong answer" },
  typo_formatting: { vi: "Lỗi chính tả / định dạng", en: "Typo / formatting" },
  missing_media: { vi: "Thiếu hình ảnh / media", en: "Missing image / media" },
  broken_audio: { vi: "Âm thanh bị lỗi", en: "Broken audio" },
  ambiguous_wording: { vi: "Câu hỏi mơ hồ", en: "Ambiguous wording" },
  duplicate_question: { vi: "Câu hỏi trùng lặp", en: "Duplicate question" },
  wrong_chapter_tag: { vi: "Sai chương hoặc thẻ", en: "Wrong chapter or tag" },
  diagram_hotspot_error: {
    vi: "Lỗi điểm đánh dấu sơ đồ",
    en: "Diagram hotspot error",
  },
  other: { vi: "Vấn đề khác", en: "Other issue" },
};

export interface QuestionNotesAndReportBarProps {
  studySetId: string;
  questionId: string;
  initialNote?: UserQuestionNote | null;
  showReportButton?: boolean;
  compact?: boolean;
  /** Strictly gated by owner/editor RBAC — never enable for viewers or active live exams! */
  canEdit?: boolean;
  onEditQuestion?: () => void;
  editLabel?: string;
}

export function QuestionNotesAndReportBar({
  studySetId,
  questionId,
  initialNote = null,
  showReportButton = true,
  compact = false,
  canEdit = false,
  onEditQuestion,
  editLabel,
}: QuestionNotesAndReportBarProps) {
  const { locale } = useI18n();
  const [noteOpen, setNoteOpen] = React.useState(Boolean(initialNote?.content_text));
  const [note, setNote] = React.useState<UserQuestionNote | null>(initialNote);
  const [draft, setDraft] = React.useState(initialNote?.content_text ?? "");
  const [loadingNote, setLoadingNote] = React.useState(false);
  const [savingNote, setSavingNote] = React.useState(false);
  const [justSavedOptimistic, setJustSavedOptimistic] = React.useState(false);
  const saveGenRef = React.useRef(0);

  const [reportOpen, setReportOpen] = React.useState(false);
  const [reportCategory, setReportCategory] =
    React.useState<QuestionReportCategory>("wrong_answer");
  const [reportDesc, setReportDesc] = React.useState("");
  const [submittingReport, setSubmittingReport] = React.useState(false);

  const loadedQuestionRef = React.useRef<string | null>(
    initialNote ? questionId : null,
  );

  const handleToggleNote = async () => {
    const nextOpen = !noteOpen;
    setNoteOpen(nextOpen);
    if (nextOpen && loadedQuestionRef.current !== questionId) {
      loadedQuestionRef.current = questionId;
      setLoadingNote(true);
      try {
        const list = await listQuestionNotes({ studySetId, questionId });
        const found = list.find((n) => n.question_id === questionId) ?? null;
        setNote(found);
        setDraft(found?.content_text ?? "");
      } catch {
        // Non-blocking fallback when offline or notes endpoint unavailable
      } finally {
        setLoadingNote(false);
      }
    }
  };

  // Optimistic Save Note feedback (fixes PERF-07 323ms blocking save!)
  const handleSaveNote = async () => {
    const trimmed = draft.trim();
    if (!trimmed) return;

    const gen = ++saveGenRef.current;
    const previousNote = note;
    const nowIso = new Date().toISOString();
    const optimisticNote: UserQuestionNote = {
      id: previousNote?.id ?? `optimistic-${questionId}`,
      user_id: previousNote?.user_id ?? "",
      study_set_id: studySetId,
      question_id: questionId,
      content_text: trimmed,
      content_rich: previousNote?.content_rich ?? null,
      version: (previousNote?.version ?? 0) + 1,
      created_at: previousNote?.created_at ?? nowIso,
      updated_at: nowIso,
    };

    // Instant optimistic UI state + toast without blocking the user
    setNote(optimisticNote);
    setDraft(trimmed);
    setJustSavedOptimistic(true);
    setSavingNote(true);
    toast.success(lText(locale, "Đã lưu ghi chú cá nhân.", "Personal note saved."));

    try {
      const saved = await upsertQuestionNote({
        study_set_id: studySetId,
        question_id: questionId,
        content_text: trimmed,
        base_version: previousNote?.version ?? null,
      });
      if (gen === saveGenRef.current) {
        setNote(saved);
        setDraft(saved.content_text);
      }
    } catch (err) {
      if (gen === saveGenRef.current) {
        setNote(previousNote);
        setJustSavedOptimistic(false);
        toast.error(
          err instanceof Error
            ? err.message
            : lText(locale, "Không thể lưu ghi chú.", "Failed to save note."),
        );
      }
    } finally {
      if (gen === saveGenRef.current) {
        setSavingNote(false);
      }
    }
  };

  const handleDeleteNote = async () => {
    setSavingNote(true);
    try {
      await deleteQuestionNote(questionId);
      setNote(null);
      setDraft("");
      setNoteOpen(false);
      toast.success(lText(locale, "Đã xóa ghi chú.", "Note deleted."));
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : lText(locale, "Không thể xóa ghi chú.", "Failed to delete note."),
      );
    } finally {
      setSavingNote(false);
    }
  };

  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportDesc.trim()) {
      toast.error(
        lText(
          locale,
          "Vui lòng mô tả ngắn gọn lỗi bạn phát hiện.",
          "Please describe the issue briefly.",
        ),
      );
      return;
    }
    setSubmittingReport(true);
    try {
      await submitQuestionReport({
        study_set_id: studySetId,
        question_id: questionId,
        category: reportCategory,
        description: reportDesc.trim(),
      });
      toast.success(
        lText(
          locale,
          "Đã gửi báo lỗi câu hỏi. Cảm ơn bạn đã đóng góp!",
          "Question report submitted. Thank you!",
        ),
      );
      setReportDesc("");
      setReportOpen(false);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : lText(locale, "Không thể gửi báo lỗi.", "Failed to submit report."),
      );
    } finally {
      setSubmittingReport(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          type="button"
          size="sm"
          variant={note?.content_text ? "secondary" : "ghost"}
          className={compact ? "min-h-11 sm:min-h-8 px-2.5 text-xs" : "min-h-11 sm:min-h-9 text-xs"}
          aria-expanded={noteOpen}
          onClick={() => void handleToggleNote()}
        >
          <StickyNote className="size-3.5" aria-hidden="true" />
          {note?.content_text
            ? lText(locale, "Ghi chú của tôi", "My Note")
            : lText(locale, "Thêm ghi chú", "Add Note")}
        </Button>

        {showReportButton ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className={
              compact
                ? "min-h-11 sm:min-h-8 px-2.5 text-xs text-muted-foreground"
                : "min-h-11 sm:min-h-9 text-xs text-muted-foreground"
            }
            onClick={() => setReportOpen(true)}
          >
            <Flag className="size-3.5" aria-hidden="true" />
            {lText(locale, "Báo lỗi câu hỏi", "Report Issue")}
          </Button>
        ) : null}

        {canEdit && onEditQuestion ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className={
              compact
                ? "min-h-11 sm:min-h-8 px-2.5 text-xs text-muted-foreground hover:text-foreground"
                : "min-h-11 sm:min-h-9 text-xs text-muted-foreground hover:text-foreground"
            }
            onClick={onEditQuestion}
          >
            <Pencil className="size-3.5" aria-hidden="true" />
            {editLabel ?? lText(locale, "Chỉnh sửa câu hỏi", "Edit Question")}
          </Button>
        ) : null}
      </div>

      {noteOpen ? (
        <div className="space-y-2 rounded-lg border border-border bg-secondary/25 p-3">
          <div className="flex items-center justify-between gap-2">
            <Label
              htmlFor={`q-note-${questionId}`}
              className="text-xs font-medium text-muted-foreground"
            >
              {lText(
                locale,
                "Ghi chú cá nhân (chỉ mình bạn nhìn thấy)",
                "Private Personal Note (only visible to you)",
              )}
            </Label>
            {loadingNote ? (
              <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
            ) : null}
          </div>
          <Textarea
            id={`q-note-${questionId}`}
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (
                (e.metaKey || e.ctrlKey) &&
                e.key === "Enter" &&
                !e.nativeEvent.isComposing &&
                e.keyCode !== 229
              ) {
                e.preventDefault();
                void handleSaveNote();
              }
            }}
            placeholder={lText(
              locale,
              "Mẹo ghi nhớ, công thức hoặc lý do dễ nhầm...",
              "Mnemonic, formula reminder, or why this is tricky...",
            )}
            className="text-base sm:text-sm"
          />
          <div className="flex flex-wrap items-center justify-end gap-2">
            {note ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 text-xs text-destructive"
                disabled={savingNote}
                onClick={() => void handleDeleteNote()}
              >
                <Trash2 className="size-3.5" aria-hidden="true" />
                {lText(locale, "Xóa", "Delete")}
              </Button>
            ) : null}
            <Button
              type="button"
              size="sm"
              className="min-h-11 sm:min-h-8 text-xs"
              disabled={!draft.trim()}
              onClick={() => void handleSaveNote()}
            >
              <Save className="size-3.5" aria-hidden="true" />
              {justSavedOptimistic && note?.content_text === draft.trim()
                ? lText(locale, "Đã lưu ghi chú", "Note Saved")
                : lText(locale, "Lưu ghi chú", "Save Note")}
            </Button>
          </div>
        </div>
      ) : null}

      {/* Question Issue Report Dialog */}
      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent className="max-w-md overscroll-contain">
          <DialogHeader>
            <DialogTitle>
              {lText(locale, "Báo lỗi câu hỏi", "Report Question Issue")}
            </DialogTitle>
            <DialogDescription>
              {lText(
                locale,
                "Chọn phân loại lỗi để chủ học phần xem xét và cập nhật chính xác hơn.",
                "Select a category so the study set owner can review and fix this question.",
              )}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => void handleSubmitReport(e)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor={`report-cat-${questionId}`}>
                {lText(locale, "Loại lỗi", "Issue Category")}
              </Label>
              <Select
                value={reportCategory}
                onValueChange={(v) =>
                  setReportCategory(v as QuestionReportCategory)
                }
              >
                <SelectTrigger id={`report-cat-${questionId}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {QUESTION_REPORT_CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {lText(
                        locale,
                        REPORT_CATEGORY_LABELS[cat].vi,
                        REPORT_CATEGORY_LABELS[cat].en,
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor={`report-desc-${questionId}`}>
                {lText(locale, "Chi tiết lỗi", "Details")}
              </Label>
              <Textarea
                id={`report-desc-${questionId}`}
                rows={3}
                value={reportDesc}
                onChange={(e) => setReportDesc(e.target.value)}
                placeholder={lText(
                  locale,
                  "Ví dụ: Đáp án B mới là đúng theo chương 3...",
                  "e.g., Option B should be the correct answer per Chapter 3...",
                )}
                maxLength={1000}
              />
            </div>

            <DialogFooter className="gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={submittingReport}
                onClick={() => setReportOpen(false)}
              >
                {lText(locale, "Hủy", "Cancel")}
              </Button>
              <Button
                type="submit"
                disabled={submittingReport || !reportDesc.trim()}
              >
                {submittingReport ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Flag className="size-4" aria-hidden="true" />
                )}
                {lText(locale, "Gửi báo lỗi", "Submit Report")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
