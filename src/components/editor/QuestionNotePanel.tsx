"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { BookMarked, Check, Loader2, Lock, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { apiFetch, getFriendlyErrorMessage } from "@/components/layout/api-client";
import { RichContentRenderer } from "@/components/richtext/RichContentRenderer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { plainTextToRichTextDoc, richTextToPlainText } from "@/lib/richtext";
import { cn } from "@/lib/utils";
import type { Locale } from "@/types/domain";
import type { RichTextDoc, UserQuestionNote } from "@/types/v3";

const RichTextEditor = dynamic(
  () => import("@/components/richtext/RichTextEditor").then((m) => m.RichTextEditor),
  { ssr: false },
);

export interface QuestionNotePanelProps {
  questionId: string;
  studySetId: string;
  locale?: Locale;
  /** Security & exam fairness: strictly hides personal notes during an active timed exam! */
  hiddenDuringActiveExam?: boolean;
  compact?: boolean;
  className?: string;
}

export function QuestionNotePanel({
  questionId,
  studySetId,
  locale = "vi",
  hiddenDuringActiveExam = false,
  compact = false,
  className,
}: QuestionNotePanelProps): React.ReactElement | null {
  const isVi = locale === "vi";
  const [loadedQuestionId, setLoadedQuestionId] = React.useState<string | null>(null);
  const loading = !hiddenDuringActiveExam && loadedQuestionId !== questionId;
  const [saving, setSaving] = React.useState(false);
  const [useRichMode, setUseRichMode] = React.useState(false);
  const [note, setNote] = React.useState<UserQuestionNote | null>(null);
  const [contentText, setContentText] = React.useState("");
  const [contentRich, setContentRich] = React.useState<RichTextDoc | null>(null);
  const [isDirty, setIsDirty] = React.useState(false);
  const [savedAtLabel, setSavedAtLabel] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (hiddenDuringActiveExam) return;
    let cancelled = false;
    apiFetch<UserQuestionNote[]>(
      `/api/notes?questionId=${encodeURIComponent(questionId)}&pageSize=1`,
    )
      .then((res) => {
        if (cancelled) return;
        const found = Array.isArray(res.data) ? (res.data[0] ?? null) : null;
        setNote(found);
        setContentText(found?.content_text ?? "");
        setContentRich(found?.content_rich ?? null);
        setIsDirty(false);
      })
      .catch(() => {
        if (!cancelled) {
          setNote(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadedQuestionId(questionId);
      });

    return () => {
      cancelled = true;
    };
  }, [questionId, hiddenDuringActiveExam]);

  if (hiddenDuringActiveExam) {
    return null;
  }

  const handleSave = async (): Promise<void> => {
    const plain = contentRich
      ? richTextToPlainText(contentRich, contentText)
      : contentText.trim();
    if (!plain) {
      toast.error(
        isVi
          ? "Vui lòng nhập nội dung ghi chú trước khi lưu."
          : "Enter a note before saving.",
      );
      return;
    }

    setSaving(true);
    try {
      const res = await apiFetch<UserQuestionNote>("/api/notes", {
        method: "PUT",
        body: JSON.stringify({
          question_id: questionId,
          study_set_id: studySetId,
          content_text: plain,
          content_rich: contentRich ?? plainTextToRichTextDoc(plain),
          base_version: note?.version,
        }),
      });
      setNote(res.data);
      setContentText(res.data.content_text);
      setContentRich(res.data.content_rich ?? null);
      setIsDirty(false);
      setSavedAtLabel(isVi ? "Đã lưu" : "Saved");
      toast.success(isVi ? "Đã lưu ghi chú cá nhân." : "Personal note saved.");
    } catch (err) {
      toast.error(getFriendlyErrorMessage(err, locale));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!note) return;
    setSaving(true);
    try {
      await apiFetch(`/api/notes?questionId=${encodeURIComponent(questionId)}`, {
        method: "DELETE",
      });
      setNote(null);
      setContentText("");
      setContentRich(null);
      setIsDirty(false);
      setSavedAtLabel(null);
      toast.success(isVi ? "Đã xóa ghi chú cá nhân." : "Personal note deleted.");
    } catch (err) {
      toast.error(getFriendlyErrorMessage(err, locale));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      aria-label={isVi ? "Ghi chú cá nhân" : "Personal study note"}
      className={cn(
        "rounded-lg border border-border bg-card p-3 space-y-2.5",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <BookMarked className="size-4 text-primary" aria-hidden="true" />
          <span className="text-xs font-semibold text-foreground">
            {isVi ? "Ghi chú cá nhân" : "Personal Note"}
          </span>
          <Badge variant="outline" className="gap-1 text-[10px] font-normal">
            <Lock className="size-2.5" aria-hidden="true" />
            {isVi ? "Chỉ mình bạn thấy" : "Private to you"}
          </Badge>
          {savedAtLabel && !isDirty && (
            <span className="inline-flex items-center gap-1 text-[11px] text-success">
              <Check className="size-3" aria-hidden="true" />
              {savedAtLabel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setUseRichMode((v) => !v)}
          >
            {useRichMode
              ? isVi
                ? "Chế độ đơn giản"
                : "Plain text"
              : isVi
                ? "Định dạng / Công thức"
                : "Rich / Math"}
          </Button>
          {note && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={saving}
              onClick={() => void handleDelete()}
              className="h-7 px-2 text-xs text-destructive hover:text-destructive"
              aria-label={isVi ? "Xóa ghi chú" : "Delete note"}
            >
              <Trash2 className="size-3.5" aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
          {isVi ? "Đang tải ghi chú…" : "Loading note…"}
        </div>
      ) : (
        <>
          {useRichMode ? (
            <RichTextEditor
              locale={locale}
              compact={compact}
              value={contentRich}
              fallbackPlainText={contentText}
              placeholder={
                isVi
                  ? "Viết mẹo ghi nhớ, công thức hoặc lỗi hay gặp…"
                  : "Write mnemonics, formulas, or common pitfalls…"
              }
              onChange={(doc, plain) => {
                setContentRich(doc);
                setContentText(plain);
                setIsDirty(true);
              }}
            />
          ) : (
            <Textarea
              rows={compact ? 2 : 3}
              value={contentText}
              onChange={(e) => {
                setContentText(e.target.value);
                setContentRich(null);
                setIsDirty(true);
              }}
              placeholder={
                isVi
                  ? "Viết mẹo ghi nhớ riêng cho câu hỏi này (hỗ trợ $LaTeX$)…"
                  : "Write your personal note for this question (supports $LaTeX$)…"
              }
              className="text-sm"
            />
          )}

          {!useRichMode && contentText.includes("$") && (
            <div className="rounded-md border border-border/60 bg-muted/20 px-2.5 py-1.5 text-xs">
              <RichContentRenderer plainText={contentText} inline />
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            <Button
              type="button"
              size="sm"
              disabled={saving || !isDirty}
              onClick={() => void handleSave()}
              className="h-8 gap-1.5"
            >
              {saving ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="size-3.5" aria-hidden="true" />
              )}
              {isVi ? "Lưu ghi chú" : "Save Note"}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
