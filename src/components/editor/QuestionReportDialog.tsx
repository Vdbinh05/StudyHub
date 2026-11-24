"use client";

import * as React from "react";
import { Flag, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { apiFetch, getFriendlyErrorMessage } from "@/components/layout/api-client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import type { Locale } from "@/types/domain";
import {
  QUESTION_REPORT_CATEGORIES,
  type QuestionReportCategory,
} from "@/types/v3";

export const REPORT_CATEGORY_LABELS: Record<
  QuestionReportCategory,
  { vi: string; en: string }
> = {
  wrong_answer: { vi: "Đáp án đúng bị sai", en: "Wrong answer key" },
  typo_formatting: { vi: "Lỗi chính tả / định dạng / công thức", en: "Typo, formatting, or formula error" },
  missing_media: { vi: "Thiếu hoặc hỏng hình ảnh", en: "Missing or broken image" },
  broken_audio: { vi: "Âm thanh bị lỗi / không nghe được", en: "Broken or unplayable audio" },
  ambiguous_wording: { vi: "Câu hỏi mơ hồ / nhiều cách hiểu", en: "Ambiguous wording" },
  duplicate_question: { vi: "Câu hỏi bị trùng lặp", en: "Duplicate question" },
  wrong_chapter_tag: { vi: "Sai chương hoặc thẻ phân loại", en: "Wrong chapter or tag" },
  diagram_hotspot_error: { vi: "Lỗi tọa độ / nhãn điểm nóng trên hình", en: "Diagram or hotspot coordinate error" },
  other: { vi: "Vấn đề khác", en: "Other issue" },
};

export interface QuestionReportDialogProps {
  questionId: string;
  studySetId: string;
  locale?: Locale;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onReported?: () => void;
}

export function QuestionReportDialog({
  questionId,
  studySetId,
  locale = "vi",
  trigger,
  open: controlledOpen,
  onOpenChange,
  onReported,
}: QuestionReportDialogProps): React.ReactElement {
  const isVi = locale === "vi";
  const [internalOpen, setInternalOpen] = React.useState(false);
  const open = controlledOpen ?? internalOpen;
  const setOpen = (next: boolean): void => {
    setInternalOpen(next);
    onOpenChange?.(next);
  };

  const [category, setCategory] = React.useState<QuestionReportCategory>("wrong_answer");
  const [description, setDescription] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (!description.trim()) {
      toast.error(
        isVi
          ? "Vui lòng mô tả ngắn gọn lỗi bạn phát hiện."
          : "Please describe the issue briefly.",
      );
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch("/api/reports", {
        method: "POST",
        body: JSON.stringify({
          question_id: questionId,
          study_set_id: studySetId,
          category,
          description: description.trim(),
        }),
      });
      toast.success(
        isVi
          ? "Đã gửi báo cáo lỗi. Chủ sở hữu học phần sẽ xem xét và sửa thủ công."
          : "Issue reported. The set owner will review and update it manually.",
      );
      setDescription("");
      setOpen(false);
      onReported?.();
    } catch (err) {
      toast.error(getFriendlyErrorMessage(err, locale));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger !== undefined ? (
        <DialogTrigger asChild>{trigger}</DialogTrigger>
      ) : (
        <DialogTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 text-xs">
            <Flag className="size-3.5" aria-hidden="true" />
            {isVi ? "Báo lỗi câu hỏi" : "Report issue"}
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Flag className="size-4 text-warning" aria-hidden="true" />
            {isVi ? "Báo lỗi câu hỏi" : "Report Question Issue"}
          </DialogTitle>
          <DialogDescription>
            {isVi
              ? "Báo cáo của bạn sẽ gửi tới hộp thư kiểm duyệt của chủ sở hữu học phần (không tự động thay đổi đáp án)."
              : "Your report goes to the set owner's review inbox (reports never auto-mutate answers)."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="report-category">
              {isVi ? "Phân loại lỗi" : "Issue Category"}
            </Label>
            <Select
              value={category}
              onValueChange={(v) => setCategory(v as QuestionReportCategory)}
            >
              <SelectTrigger id="report-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {QUESTION_REPORT_CATEGORIES.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {isVi
                      ? REPORT_CATEGORY_LABELS[cat].vi
                      : REPORT_CATEGORY_LABELS[cat].en}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="report-description">
              {isVi ? "Mô tả chi tiết" : "Description"}
            </Label>
            <Textarea
              id="report-description"
              rows={4}
              required
              maxLength={2000}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={
                isVi
                  ? "Ví dụ: Đáp án đúng phải là B thay vì A theo giáo trình trang 42…"
                  : "e.g. Correct answer should be B instead of A per textbook page 42…"
              }
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={submitting}
              onClick={() => setOpen(false)}
            >
              {isVi ? "Hủy" : "Cancel"}
            </Button>
            <Button type="submit" disabled={submitting} className="gap-1.5">
              {submitting ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <Send className="size-4" aria-hidden="true" />
              )}
              {isVi ? "Gửi báo cáo" : "Submit Report"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
