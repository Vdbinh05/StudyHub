"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ClipboardCheck,
  Edit3,
  Layers,
  Loader2,
  Play,
  PlusCircle,
} from "lucide-react";
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
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import type { Locale } from "@/types/domain";
import type { ImportPreviewSummary } from "@/types/import";

export type DuplicatePolicy = "skip" | "keep_both" | "replace";

export interface ImportOptionsPanelProps {
  locale: Locale;
  mode: "append" | "replace";
  onModeChange: (mode: "append" | "replace") => void;
  duplicatePolicy: DuplicatePolicy;
  onDuplicatePolicyChange: (policy: DuplicatePolicy) => void;
  skipInvalidRows: boolean;
  onSkipInvalidRowsChange: (val: boolean) => void;
  defaultChapter: string;
  onDefaultChapterChange: (val: string) => void;
  defaultTagsText: string;
  onDefaultTagsTextChange: (val: string) => void;
  summary: ImportPreviewSummary;
  embedded?: boolean;
}

export function ImportOptionsPanel({
  locale,
  mode,
  onModeChange,
  duplicatePolicy,
  onDuplicatePolicyChange,
  skipInvalidRows,
  onSkipInvalidRowsChange,
  defaultChapter,
  onDefaultChapterChange,
  defaultTagsText,
  onDefaultTagsTextChange,
  summary,
  embedded = false,
}: ImportOptionsPanelProps) {
  const inner = (
    <div className="space-y-4">
      {embedded && (
        <div>
          <h3 className="text-sm font-semibold text-foreground">
            {locale === "en" ? "Save & Duplicate Options" : "Tùy chọn lưu & Xử lý trùng lặp"}
          </h3>
          <p className="text-xs text-muted-foreground">
            {locale === "en"
              ? "Choose how imported questions are merged into this study set."
              : "Chọn cách thêm câu hỏi vào học phần và xử lý các câu trùng lặp."}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Append vs Replace */}
        <div className="min-w-0 space-y-2">
          <Label className="text-xs font-semibold text-muted-foreground">
            {locale === "en" ? "Save Mode" : "Chế độ ghi dữ liệu"}
          </Label>
          <div
            role="radiogroup"
            aria-label={locale === "en" ? "Save Mode" : "Chế độ ghi dữ liệu"}
            className="grid grid-cols-2 gap-2"
          >
            <button
              type="button"
              role="radio"
              aria-checked={mode === "append"}
              onClick={() => onModeChange("append")}
              className={cn(
                "min-h-[44px] rounded-lg border px-3 py-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm",
                mode === "append"
                  ? "border-primary bg-primary/5 font-medium text-foreground ring-1 ring-primary"
                  : "border-border bg-background text-muted-foreground hover:bg-muted/40",
              )}
            >
              {locale === "en" ? "Append to Set" : "Thêm nối tiếp"}
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === "replace"}
              onClick={() => onModeChange("replace")}
              className={cn(
                "min-h-[44px] rounded-lg border px-3 py-2 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm",
                mode === "replace"
                  ? "border-destructive bg-destructive-subtle font-medium text-destructive-subtle-foreground ring-1 ring-destructive"
                  : "border-border bg-background text-muted-foreground hover:bg-muted/40",
              )}
            >
              {locale === "en" ? "Replace Entire Set" : "Thay thế toàn bộ"}
            </button>
          </div>
          {mode === "replace" && (
            <p className="flex items-start gap-1.5 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
              <span>
                {locale === "en"
                  ? "Existing questions in this study set will be deleted before importing (confirmation required)."
                  : "Toàn bộ câu hỏi hiện có trong học phần sẽ bị xóa trước khi nhập (cần xác nhận trước khi chạy)."}
              </span>
            </p>
          )}
        </div>

        {/* Duplicate Policy */}
        <div className="min-w-0 space-y-2">
          <Label className="text-xs font-semibold text-muted-foreground">
            {locale === "en" ? "Duplicate Handling" : "Xử lý câu trùng lặp"}
          </Label>
          <div
            role="radiogroup"
            aria-label={locale === "en" ? "Duplicate Handling" : "Xử lý câu trùng lặp"}
            className="grid grid-cols-3 gap-2"
          >
            {(
              [
                { id: "skip", vi: "Bỏ qua", en: "Skip" },
                { id: "keep_both", vi: "Giữ cả hai", en: "Keep Both" },
                { id: "replace", vi: "Ghi đè", en: "Replace" },
              ] as const
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                role="radio"
                aria-checked={duplicatePolicy === opt.id}
                onClick={() => onDuplicatePolicyChange(opt.id)}
                className={cn(
                  "min-h-[44px] rounded-lg border px-2 py-2 text-center text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  duplicatePolicy === opt.id
                    ? "border-primary bg-primary/5 text-foreground ring-1 ring-primary"
                    : "border-border bg-background text-muted-foreground hover:bg-muted/40",
                )}
              >
                {locale === "en" ? opt.en : opt.vi}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Default Chapter & Tags */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="import-default-chapter" className="text-xs">
            {locale === "en"
              ? "Default Chapter (optional)"
              : "Chương mặc định (tùy chọn)"}
          </Label>
          <Input
            id="import-default-chapter"
            value={defaultChapter}
            onChange={(e) => onDefaultChapterChange(e.target.value)}
            placeholder={locale === "en" ? "e.g. Chapter 1" : "VD: Chương 1"}
          />
        </div>
        <div className="min-w-0 space-y-1.5">
          <Label htmlFor="import-default-tags" className="text-xs">
            {locale === "en"
              ? "Default Tags (comma separated)"
              : "Nhãn mặc định (cách nhau bằng dấu phẩy)"}
          </Label>
          <Input
            id="import-default-tags"
            value={defaultTagsText}
            onChange={(e) => onDefaultTagsTextChange(e.target.value)}
            placeholder={locale === "en" ? "midterm, week-1" : "giua-ky, chuong-1"}
          />
        </div>
      </div>

      {/* Skip Invalid Rows Toggle */}
      <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/30 p-3">
        <div className="min-w-0">
          <Label htmlFor="import-skip-invalid" className="text-xs font-medium sm:text-sm">
            {locale === "en"
              ? "Skip invalid rows during import"
              : "Tự động bỏ qua các câu còn lỗi khi lưu"}
          </Label>
          <p className="text-xs text-muted-foreground">
            {summary.errorCount > 0
              ? locale === "en"
                ? `${summary.errorCount} question(s) currently have errors. Fix them below or enable this to import only valid rows.`
                : `Hiện có ${summary.errorCount} câu bị lỗi. Sửa trực tiếp bên dưới hoặc bật tùy chọn này để chỉ lưu câu hợp lệ.`
              : locale === "en"
                ? "All questions are valid and ready to import."
                : "Tất cả câu hỏi đều hợp lệ và sẵn sàng để lưu."}
          </p>
        </div>
        <Switch
          id="import-skip-invalid"
          checked={skipInvalidRows}
          onCheckedChange={onSkipInvalidRowsChange}
        />
      </div>
    </div>
  );

  if (embedded) {
    return inner;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          {locale === "en" ? "Import & Duplicate Options" : "Tùy chọn nhập & Xử lý trùng lặp"}
        </CardTitle>
        <CardDescription>
          {locale === "en"
            ? "Choose how imported questions are merged into your study set."
            : "Chọn cách thêm câu hỏi vào học phần và xử lý các câu trùng lặp."}
        </CardDescription>
      </CardHeader>
      <CardContent>{inner}</CardContent>
    </Card>
  );
}

export interface ReplaceConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locale: Locale;
  studySetTitle: string;
  existingQuestionCount: number;
  readyCount: number;
  onConfirm: () => void;
}

export function ReplaceConfirmDialog({
  open,
  onOpenChange,
  locale,
  studySetTitle,
  existingQuestionCount,
  readyCount,
  onConfirm,
}: ReplaceConfirmDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-5 shrink-0" aria-hidden="true" />
            {locale === "en"
              ? "Confirm Replace Entire Study Set"
              : "Xác nhận thay thế toàn bộ học phần"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {locale === "en"
              ? `This action will permanently delete ${
                  existingQuestionCount > 0
                    ? `all ${existingQuestionCount.toLocaleString()} existing question(s)`
                    : "all existing questions"
                } in "${studySetTitle}" and replace them with ${readyCount.toLocaleString()} imported question(s). Past exam snapshots remain untouched, but removed questions cannot be undone.`
              : `Thao tác này sẽ xóa vĩnh viễn ${
                  existingQuestionCount > 0
                    ? `toàn bộ ${existingQuestionCount.toLocaleString()} câu hỏi hiện có`
                    : "toàn bộ câu hỏi hiện có"
                } trong học phần "${studySetTitle}" và thay bằng ${readyCount.toLocaleString()} câu hỏi mới. Lịch sử bài thi cũ được giữ nguyên, nhưng câu hỏi bị xóa không thể hoàn tác.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel autoFocus>
            {locale === "en" ? "Cancel" : "Hủy bỏ"}
          </AlertDialogCancel>
          <AlertDialogAction
            className={buttonVariants({ variant: "destructive" })}
            onClick={() => {
              onOpenChange(false);
              onConfirm();
            }}
          >
            {locale === "en" ? "Delete Existing & Import" : "Xóa câu cũ & Nhập mới"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export interface CommitProgressState {
  status: "idle" | "committing" | "completed" | "error";
  completedChunks: number;
  totalChunks: number;
  importedCount: number;
  skippedCount: number;
  replacedCount: number;
  totalSetQuestions: number;
  errorMessage: string | null;
}

export interface StepCommitProps {
  locale: Locale;
  studySetId: string;
  studySetTitle: string;
  progress: CommitProgressState;
  onBack: () => void;
  onRetryCommit: () => void;
  onImportAnother: () => void;
  headingRef?: React.Ref<HTMLHeadingElement>;
}

export function StepCommit({
  locale,
  studySetId,
  studySetTitle,
  progress,
  onBack,
  onRetryCommit,
  onImportAnother,
  headingRef,
}: StepCommitProps) {
  const percent =
    progress.totalChunks > 0
      ? Math.round((progress.completedChunks / progress.totalChunks) * 100)
      : progress.status === "completed"
        ? 100
        : 0;

  return (
    <Card>
      <CardHeader className="p-4 pb-3 sm:p-6 sm:pb-4">
        <CardTitle>
          <h2
            ref={headingRef}
            data-import-step="3"
            tabIndex={-1}
            className="rounded-sm text-base font-semibold text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 sm:text-lg"
          >
            {progress.status === "completed"
              ? locale === "en"
                ? "Import Complete"
                : "Hoàn tất nhập câu hỏi"
              : progress.status === "error"
                ? locale === "en"
                  ? "Import Interrupted"
                  : "Quá trình lưu gặp sự cố"
                : locale === "en"
                  ? "Saving Questions…"
                  : "Đang lưu câu hỏi vào học phần…"}
          </h2>
        </CardTitle>
        <CardDescription className="truncate text-sm">
          {locale === "en"
            ? `Study set: ${studySetTitle}`
            : `Học phần: ${studySetTitle}`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 p-4 pt-0 sm:p-6 sm:pt-0">
        {(progress.status === "committing" || progress.status === "idle") && (
          <div className="space-y-4 py-3" aria-live="polite">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="inline-flex min-w-0 items-center gap-2 font-medium text-foreground">
                <Loader2 className="size-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
                <span className="truncate">
                  {progress.totalChunks > 1
                    ? locale === "en"
                      ? `Saving batch ${Math.min(progress.completedChunks + 1, progress.totalChunks)} of ${progress.totalChunks}…`
                      : `Đang lưu lô ${Math.min(progress.completedChunks + 1, progress.totalChunks)} / ${progress.totalChunks}…`
                    : locale === "en"
                      ? "Saving questions to your study set…"
                      : "Đang lưu câu hỏi vào học phần của bạn…"}
                </span>
              </span>
              <span className="shrink-0 font-semibold text-primary tabular-nums">
                {percent}%
              </span>
            </div>
            <Progress value={percent} />
            <p className="text-xs text-muted-foreground tabular-nums">
              {locale === "en"
                ? `${progress.importedCount.toLocaleString()} saved so far`
                : `Đã lưu ${progress.importedCount.toLocaleString()} câu hỏi`}
            </p>
          </div>
        )}

        {progress.status === "error" && (
          <div className="space-y-4">
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 p-3.5 text-sm text-destructive"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span className="min-w-0 break-words">{progress.errorMessage}</span>
            </div>
            <div className="flex flex-col-reverse gap-2.5 sm:flex-row sm:items-center sm:justify-between">
              <Button
                type="button"
                variant="outline"
                className="min-h-[44px] w-full sm:w-auto"
                onClick={onBack}
              >
                <ArrowLeft className="mr-2 size-4" aria-hidden="true" />
                {locale === "en" ? "Back to Preview" : "Quay lại xem trước"}
              </Button>
              <Button
                type="button"
                className="min-h-[44px] w-full sm:w-auto"
                onClick={onRetryCommit}
              >
                {locale === "en" ? "Retry Import" : "Thử nhập lại"}
              </Button>
            </div>
          </div>
        )}

        {progress.status === "completed" && (
          <div className="space-y-5 py-1" aria-live="polite">
            <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-success-subtle p-4 sm:p-5">
              <CheckCircle2
                className="mt-0.5 size-6 shrink-0 text-success-subtle-foreground"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-foreground">
                  {locale === "en"
                    ? "Import Completed Successfully"
                    : "Nhập câu hỏi thành công!"}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {locale === "en"
                    ? `Added ${progress.importedCount.toLocaleString()} question(s)${
                        progress.skippedCount > 0 || progress.replacedCount > 0
                          ? ` (${progress.skippedCount.toLocaleString()} skipped, ${progress.replacedCount.toLocaleString()} replaced)`
                          : ""
                      }. This study set now has ${progress.totalSetQuestions.toLocaleString()} question(s).`
                    : `Đã thêm ${progress.importedCount.toLocaleString()} câu hỏi${
                        progress.skippedCount > 0 || progress.replacedCount > 0
                          ? ` (${progress.skippedCount.toLocaleString()} bỏ qua, ${progress.replacedCount.toLocaleString()} ghi đè)`
                          : ""
                      }. Học phần hiện có ${progress.totalSetQuestions.toLocaleString()} câu hỏi.`}
                </p>
              </div>
            </div>

            {/* Primary 1-Tap Study & Edit CTAs + Secondary Actions */}
            <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
              <Button asChild size="lg" className="min-h-[44px] w-full sm:w-auto">
                <Link href={`/sets/${studySetId}/practice`}>
                  <Play className="mr-2 size-4" aria-hidden="true" />
                  {locale === "en" ? "Start Studying" : "Học ngay"}
                </Link>
              </Button>
              <Button
                asChild
                variant="secondary"
                size="lg"
                className="min-h-[44px] w-full sm:w-auto"
              >
                <Link href={`/sets/${studySetId}/edit`}>
                  <Edit3 className="mr-2 size-4" aria-hidden="true" />
                  {locale === "en"
                    ? "Review & Edit Questions"
                    : "Xem và chỉnh sửa câu hỏi"}
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                size="lg"
                className="min-h-[44px] w-full sm:w-auto"
              >
                <Link href={`/sets/${studySetId}/flashcards`}>
                  <Layers className="mr-2 size-4" aria-hidden="true" />
                  Flashcards
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                size="lg"
                className="min-h-[44px] w-full sm:w-auto"
              >
                <Link href={`/sets/${studySetId}/test`}>
                  <ClipboardCheck className="mr-2 size-4" aria-hidden="true" />
                  {locale === "en" ? "Mock Exam" : "Thi thử"}
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                size="lg"
                className="min-h-[44px] w-full sm:w-auto"
              >
                <Link href={`/sets/${studySetId}`}>
                  <BookOpen className="mr-2 size-4" aria-hidden="true" />
                  {locale === "en" ? "View Study Set" : "Xem học phần"}
                </Link>
              </Button>
            </div>

            <div className="border-t border-border pt-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-h-[40px] text-muted-foreground hover:text-foreground"
                onClick={onImportAnother}
              >
                <PlusCircle className="mr-1.5 size-4" aria-hidden="true" />
                {locale === "en" ? "Import another file" : "Nhập thêm tệp khác"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
