"use client";

import * as React from "react";
import { AlertTriangle, Loader2, RotateCcw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { useI18n } from "@/lib/i18n";
import { resetLearningProgress } from "@/lib/learning/api-client";
import { clearAllLocalCheckpointsForUser } from "@/lib/learning/checkpoints";
import type {
  ProgressResetResult,
  ProgressResetScope,
  V3StudyMode,
} from "@/types/domain";
import { lText } from "./learning-copy";

export interface ResetProgressDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultScope?: ProgressResetScope;
  /** Optional allowed scopes; defaults to relevant scopes for context. */
  allowedScopes?: ProgressResetScope[];
  studySetId?: string;
  studySetTitle?: string;
  subject?: string;
  chapters?: string[];
  questionIds?: string[];
  mode?: V3StudyMode;
  userId?: string;
  pendingOfflineEventsCount?: number;
  onResetComplete?: (result: ProgressResetResult) => void;
}

const CONFIRM_PHRASE = "RESET_PROGRESS";

export function ResetProgressDialog({
  open,
  onOpenChange,
  defaultScope = "study_set",
  allowedScopes,
  studySetId,
  studySetTitle,
  subject,
  chapters = [],
  questionIds,
  mode,
  userId,
  pendingOfflineEventsCount = 0,
  onResetComplete,
}: ResetProgressDialogProps) {
  const { locale } = useI18n();
  const [scope, setScope] = React.useState<ProgressResetScope>(defaultScope);
  const [selectedChapter, setSelectedChapter] = React.useState<string>(
    chapters[0] ?? "",
  );
  const [clearMistakes, setClearMistakes] = React.useState(true);
  const [clearCheckpoints, setClearCheckpoints] = React.useState(true);
  const [clearStarred, setClearStarred] = React.useState(false);
  const [confirmInput, setConfirmInput] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const scopes: ProgressResetScope[] = React.useMemo(() => {
    if (allowedScopes && allowedScopes.length > 0) return allowedScopes;
    const list: ProgressResetScope[] = [];
    if (studySetId) list.push("study_set");
    if (chapters.length > 0) list.push("chapter");
    if (subject) list.push("subject");
    if (mode) list.push("mode");
    if (questionIds && questionIds.length > 0) list.push("question");
    list.push("all");
    return list;
  }, [allowedScopes, chapters.length, mode, questionIds, studySetId, subject]);

  const requiresTypedConfirm = scope === "all";
  const isConfirmValid =
    !requiresTypedConfirm || confirmInput.trim() === CONFIRM_PHRASE;

  const getScopeLabel = (s: ProgressResetScope): string => {
    switch (s) {
      case "study_set":
        return lText(
          locale,
          studySetTitle ? `Học phần: ${studySetTitle}` : "Học phần hiện tại",
          studySetTitle ? `Study Set: ${studySetTitle}` : "Current Study Set",
        );
      case "chapter":
        return lText(locale, "Theo chương cụ thể", "Specific Chapter");
      case "subject":
        return lText(
          locale,
          subject ? `Môn học: ${subject}` : "Theo môn học",
          subject ? `Subject: ${subject}` : "By Subject",
        );
      case "mode":
        return lText(
          locale,
          `Chỉ phiên đang học dở (${mode ?? ""})`,
          `Active Mode Session Only (${mode ?? ""})`,
        );
      case "question":
        return lText(
          locale,
          `Các câu hỏi đã chọn (${questionIds?.length ?? 0})`,
          `Selected Questions (${questionIds?.length ?? 0})`,
        );
      case "all":
        return lText(
          locale,
          "Toàn bộ tài khoản (Tất cả tiến độ học)",
          "Entire Account (All Learning Progress)",
        );
    }
  };

  const handleConfirmReset = async () => {
    if (!isConfirmValid || isSubmitting) return;
    if (scope === "chapter" && !selectedChapter) {
      toast.error(
        lText(locale, "Vui lòng chọn chương cần đặt lại.", "Please select a chapter."),
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await resetLearningProgress({
        scope,
        study_set_id:
          scope === "study_set" || scope === "chapter" || scope === "mode"
            ? studySetId
            : undefined,
        subject: scope === "subject" ? subject : undefined,
        chapter: scope === "chapter" ? selectedChapter : undefined,
        question_ids: scope === "question" ? questionIds : undefined,
        mode: scope === "mode" ? mode : undefined,
        clear_mistakes: clearMistakes,
        clear_starred: clearStarred,
        clear_checkpoints: clearCheckpoints,
        confirm: "RESET_PROGRESS",
      });

      if (clearCheckpoints && userId) {
        clearAllLocalCheckpointsForUser(
          userId,
          scope === "all" ? null : studySetId ?? null,
        );
      }

      toast.success(
        lText(
          locale,
          `Đã đặt lại ${result.reset_progress_count} bản ghi tiến độ (thế hệ đồng bộ #${result.new_progress_generation}).`,
          `Reset ${result.reset_progress_count} progress record(s) (sync generation #${result.new_progress_generation}).`,
        ),
      );
      setConfirmInput("");
      onResetComplete?.(result);
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : lText(
              locale,
              "Không thể đặt lại tiến độ lúc này.",
              "Could not reset progress right now.",
            ),
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg overscroll-contain">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RotateCcw className="size-4 text-destructive" aria-hidden="true" />
            {lText(locale, "Đặt lại tiến độ học tập", "Reset Learning Progress")}
          </DialogTitle>
          <DialogDescription>
            {lText(
              locale,
              "Chọn phạm vi đặt lại. Khác với “Khởi động lại phiên”, thao tác này đặt lại trạng thái thành thạo SM-2 về Chưa học.",
              "Choose your reset scope. Unlike restarting a session, this resets SM-2 mastery state back to New.",
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {/* Scope selector */}
          <div className="space-y-1.5">
            <Label htmlFor="reset-progress-scope">
              {lText(locale, "Phạm vi đặt lại", "Reset Scope")}
            </Label>
            <Select
              value={scope}
              onValueChange={(v) => setScope(v as ProgressResetScope)}
            >
              <SelectTrigger id="reset-progress-scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {scopes.map((s) => (
                  <SelectItem key={s} value={s}>
                    {getScopeLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {scope === "chapter" && chapters.length > 0 ? (
            <div className="space-y-1.5">
              <Label htmlFor="reset-progress-chapter">
                {lText(locale, "Chương", "Chapter")}
              </Label>
              <Select
                value={selectedChapter}
                onValueChange={setSelectedChapter}
              >
                <SelectTrigger id="reset-progress-chapter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {chapters.map((ch) => (
                    <SelectItem key={ch} value={ch}>
                      {ch}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}

          {/* Explicit breakdown: Restart Session vs Reset Mastery vs Reset Mistakes */}
          <div className="space-y-2.5 rounded-lg border border-border bg-secondary/30 p-3 text-sm">
            <label className="flex cursor-pointer items-start gap-2.5">
              <Checkbox
                checked={clearCheckpoints}
                onCheckedChange={(v) => setClearCheckpoints(Boolean(v))}
                className="mt-0.5"
              />
              <div>
                <p className="font-medium text-foreground">
                  {lText(
                    locale,
                    "Xóa các phiên học đang dở (Restart Session)",
                    "Clear in-progress session checkpoints",
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {lText(
                    locale,
                    "Xóa vị trí đang học dở để bắt đầu vòng mới từ đầu.",
                    "Clears saved mid-session positions so modes start fresh.",
                  )}
                </p>
              </div>
            </label>

            <label className="flex cursor-pointer items-start gap-2.5">
              <Checkbox
                checked={clearMistakes}
                onCheckedChange={(v) => setClearMistakes(Boolean(v))}
                className="mt-0.5"
              />
              <div>
                <p className="font-medium text-foreground">
                  {lText(
                    locale,
                    "Đặt lại bộ đếm lỗi sai & độ tự tin (Reset Mistakes)",
                    "Reset mistake counters & confidence stats",
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {lText(
                    locale,
                    "Đưa câu sai về trạng thái mới học, không còn trong hàng đợi ôn lỗi.",
                    "Clears active mistake counts and low-confidence markers.",
                  )}
                </p>
              </div>
            </label>

            <label className="flex cursor-pointer items-start gap-2.5">
              <Checkbox
                checked={clearStarred}
                onCheckedChange={(v) => setClearStarred(Boolean(v))}
                className="mt-0.5"
              />
              <div>
                <p className="font-medium text-foreground">
                  {lText(
                    locale,
                    "Bỏ gắn sao câu hỏi (Tùy chọn)",
                    "Also clear starred questions (Optional)",
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {lText(
                    locale,
                    "Mặc định giữ nguyên các câu bạn đã gắn sao.",
                    "Starred bookmarks are kept intact by default.",
                  )}
                </p>
              </div>
            </label>
          </div>

          {/* Exam History Preservation Guarantee */}
          <div className="flex items-start gap-2 rounded-lg border border-success/40 bg-success-subtle/50 px-3 py-2.5 text-xs text-success-subtle-foreground">
            <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              {lText(
                locale,
                "Lịch sử bài thi thử (Exam History) và các bản chụp kết quả bài thi được bảo toàn mặc định.",
                "Past Exam History and immutable exam attempt snapshots are preserved by default.",
              )}
            </span>
          </div>

          {/* Offline sync generation warning */}
          <div className="flex items-start gap-2 rounded-lg border border-warning/50 bg-warning-subtle/50 px-3 py-2.5 text-xs text-warning-subtle-foreground">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              {pendingOfflineEventsCount > 0
                ? lText(
                    locale,
                    `Bạn đang có ${pendingOfflineEventsCount} thao tác ngoại tuyến chưa đồng bộ. Sau khi đặt lại, máy chủ sẽ tăng progress_generation để bỏ qua các sự kiện cũ nhằm tránh ghi đè dữ liệu mới.`,
                    `You have ${pendingOfflineEventsCount} pending offline sync event(s). Resetting increments progress_generation so stale offline events are safely ignored.`,
                  )
                : lText(
                    locale,
                    "Hệ thống sẽ tăng progress_generation để các thiết bị ngoại tuyến khác không vô tình ghi đè lại tiến độ cũ khi kết nối lại.",
                    "Resetting increments progress_generation so stale offline events from other devices cannot overwrite your fresh reset.",
                  )}
            </span>
          </div>

          {requiresTypedConfirm ? (
            <div className="space-y-1.5 rounded-lg border border-destructive/40 bg-destructive-subtle/40 p-3">
              <Label
                htmlFor="reset-confirm-phrase"
                className="text-xs font-semibold text-destructive"
              >
                {lText(
                  locale,
                  `Nhập chính xác "${CONFIRM_PHRASE}" để xác nhận đặt lại toàn bộ tài khoản:`,
                  `Type "${CONFIRM_PHRASE}" exactly to confirm account-wide reset:`,
                )}
              </Label>
              <Input
                id="reset-confirm-phrase"
                value={confirmInput}
                onChange={(e) => setConfirmInput(e.target.value)}
                placeholder={CONFIRM_PHRASE}
                className="font-mono"
                autoComplete="off"
              />
            </div>
          ) : null}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            autoFocus
            disabled={isSubmitting}
            onClick={() => onOpenChange(false)}
          >
            {lText(locale, "Hủy", "Cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={!isConfirmValid || isSubmitting}
            onClick={() => void handleConfirmReset()}
          >
            {isSubmitting ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <RotateCcw className="size-4" aria-hidden="true" />
            )}
            {lText(locale, "Xác nhận đặt lại", "Confirm Reset")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
