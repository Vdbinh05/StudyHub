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
  Loader2,
  Play,
  UploadCloud,
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
}: ImportOptionsPanelProps) {
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
      <CardContent className="space-y-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Append vs Replace */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-muted-foreground">
              {locale === "en" ? "Target Mode" : "Chế độ ghi dữ liệu"}
            </Label>
            <div
              role="radiogroup"
              aria-label={locale === "en" ? "Target Mode" : "Chế độ ghi dữ liệu"}
              className="grid grid-cols-2 gap-2"
            >
              <button
                type="button"
                role="radio"
                aria-checked={mode === "append"}
                onClick={() => onModeChange("append")}
                className={cn(
                  "min-h-[44px] rounded-lg border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  mode === "append"
                    ? "border-primary bg-primary/5 font-medium text-foreground ring-1 ring-primary"
                    : "border-border bg-card text-muted-foreground hover:bg-muted/40",
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
                  "min-h-[44px] rounded-lg border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  mode === "replace"
                    ? "border-destructive bg-destructive-subtle font-medium text-destructive-subtle-foreground ring-1 ring-destructive"
                    : "border-border bg-card text-muted-foreground hover:bg-muted/40",
                )}
              >
                {locale === "en" ? "Replace Entire Set" : "Thay thế toàn bộ"}
              </button>
            </div>
            {mode === "replace" && (
              <p className="flex items-center gap-1.5 text-xs text-destructive">
                <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true" />
                {locale === "en"
                  ? "Existing questions in this study set will be deleted before importing (confirmation required)."
                  : "Toàn bộ câu hỏi hiện có trong học phần sẽ bị xóa trước khi nhập (cần xác nhận trước khi chạy)."}
              </p>
            )}
          </div>

          {/* Duplicate Policy */}
          <div className="space-y-2">
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
                    "min-h-[44px] rounded-lg border px-2.5 py-2 text-center text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    duplicatePolicy === opt.id
                      ? "border-primary bg-primary/5 text-foreground ring-1 ring-primary"
                      : "border-border bg-card text-muted-foreground hover:bg-muted/40",
                  )}
                >
                  {locale === "en" ? opt.en : opt.vi}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Default Chapter & Tags */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="import-default-chapter">
              {locale === "en"
                ? "Default Chapter (for untagged questions)"
                : "Chương mặc định (nếu câu hỏi chưa có chương)"}
            </Label>
            <Input
              id="import-default-chapter"
              value={defaultChapter}
              onChange={(e) => onDefaultChapterChange(e.target.value)}
              placeholder={locale === "en" ? "e.g. Chapter 1" : "VD: Chương 1"}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="import-default-tags">
              {locale === "en"
                ? "Default Tags (comma separated)"
                : "Nhãn (Tags) mặc định (cách nhau bằng dấu phẩy)"}
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
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-muted/30 p-3.5">
          <div>
            <Label htmlFor="import-skip-invalid" className="text-sm font-medium">
              {locale === "en"
                ? "Skip invalid rows during import"
                : "Tự động bỏ qua các câu còn lỗi khi lưu"}
            </Label>
            <p className="text-xs text-muted-foreground">
              {summary.errorCount > 0
                ? locale === "en"
                  ? `${summary.errorCount} question(s) currently have errors. Fix them above or enable this option to import only valid rows.`
                  : `Hiện có ${summary.errorCount} câu bị lỗi. Hãy sửa trực tiếp ở trên hoặc bật tùy chọn này để chỉ lưu các câu hợp lệ.`
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
      </CardContent>
    </Card>
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
  existingQuestionCount?: number;
  readyCount: number;
  errorCount: number;
  skipInvalidRows: boolean;
  mode: "append" | "replace";
  duplicatePolicy: DuplicatePolicy;
  progress: CommitProgressState;
  onBack: () => void;
  onStartCommit: () => void;
  headingRef?: React.Ref<HTMLHeadingElement>;
}

export function StepCommit({
  locale,
  studySetId,
  studySetTitle,
  existingQuestionCount = 0,
  readyCount,
  errorCount,
  skipInvalidRows,
  mode,
  duplicatePolicy,
  progress,
  onBack,
  onStartCommit,
  headingRef,
}: StepCommitProps) {
  const [confirmReplaceOpen, setConfirmReplaceOpen] = React.useState(false);

  const percent =
    progress.totalChunks > 0
      ? Math.round((progress.completedChunks / progress.totalChunks) * 100)
      : progress.status === "completed"
        ? 100
        : 0;

  const blockedByErrors = errorCount > 0 && !skipInvalidRows;

  const handlePrimaryImportClick = () => {
    if (mode === "replace") {
      setConfirmReplaceOpen(true);
      return;
    }
    onStartCommit();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2
            ref={headingRef}
            data-import-step="6"
            tabIndex={-1}
            className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {locale === "en"
              ? "Step 6: Confirm & Commit to Question Bank"
              : "Bước 6: Xác nhận & Lưu vào ngân hàng câu hỏi"}
          </h2>
        </CardTitle>
        <CardDescription>
          {locale === "en"
            ? `Target study set: ${studySetTitle}. Questions are saved in safe 500-row idempotent chunks.`
            : `Học phần đích: ${studySetTitle}. Dữ liệu được lưu theo từng lô 500 câu an toàn, chống trùng lặp khi thử lại.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {progress.status === "idle" && (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-border bg-muted/30 p-4">
                <p className="text-xs text-muted-foreground">
                  {locale === "en" ? "Ready to Import" : "Số câu sẽ nhập"}
                </p>
                <p className="mt-1 text-2xl font-semibold text-foreground tabular-nums">
                  {readyCount.toLocaleString()}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-muted/30 p-4">
                <p className="text-xs text-muted-foreground">
                  {locale === "en" ? "Target Mode" : "Chế độ ghi"}
                </p>
                <p className="mt-1 text-base font-semibold text-foreground">
                  {mode === "replace"
                    ? locale === "en"
                      ? "Replace Existing"
                      : "Thay thế toàn bộ"
                    : locale === "en"
                      ? "Append"
                      : "Thêm nối tiếp"}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-muted/30 p-4">
                <p className="text-xs text-muted-foreground">
                  {locale === "en" ? "Duplicate Policy" : "Xử lý trùng lặp"}
                </p>
                <p className="mt-1 text-base font-semibold text-foreground">
                  {duplicatePolicy === "skip"
                    ? locale === "en"
                      ? "Skip Duplicates"
                      : "Bỏ qua câu trùng"
                    : duplicatePolicy === "replace"
                      ? locale === "en"
                        ? "Replace Duplicates"
                        : "Ghi đè câu trùng"
                      : locale === "en"
                        ? "Keep Both"
                        : "Giữ cả hai"}
                </p>
              </div>
            </div>

            {blockedByErrors && (
              <div
                role="alert"
                className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
              >
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>
                  {locale === "en"
                    ? `${errorCount} question(s) still have validation errors. Go back to Step 5 to fix them or enable "Skip invalid rows".`
                    : `Còn ${errorCount} câu bị lỗi kiểm tra. Hãy quay lại Bước 5 để chỉnh sửa hoặc bật "Tự động bỏ qua các câu còn lỗi".`}
                </span>
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button type="button" variant="outline" className="min-h-[44px]" onClick={onBack}>
                <ArrowLeft className="mr-2 size-4" aria-hidden="true" />
                {locale === "en" ? "Back to Review" : "Quay lại chỉnh sửa"}
              </Button>
              <Button
                type="button"
                size="lg"
                variant={mode === "replace" ? "destructive" : "default"}
                className="min-h-[44px]"
                disabled={blockedByErrors || readyCount === 0}
                onClick={handlePrimaryImportClick}
              >
                <UploadCloud className="mr-2 size-4" aria-hidden="true" />
                {mode === "replace"
                  ? locale === "en"
                    ? `Replace & Import ${readyCount.toLocaleString()} Question(s)`
                    : `Thay thế & Nhập ${readyCount.toLocaleString()} câu hỏi`
                  : locale === "en"
                    ? `Import ${readyCount.toLocaleString()} Question(s)`
                    : `Nhập ${readyCount.toLocaleString()} câu hỏi`}
              </Button>
            </div>

            <AlertDialog
              open={confirmReplaceOpen}
              onOpenChange={setConfirmReplaceOpen}
            >
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
                      setConfirmReplaceOpen(false);
                      onStartCommit();
                    }}
                  >
                    {locale === "en"
                      ? "Delete Existing & Import"
                      : "Xóa câu cũ & Nhập mới"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}

        {progress.status === "committing" && (
          <div className="space-y-4 py-4" aria-live="polite">
            <div className="flex items-center justify-between text-sm">
              <span className="inline-flex items-center gap-2 font-medium text-foreground">
                <Loader2 className="size-4 animate-spin text-primary" aria-hidden="true" />
                {locale === "en"
                  ? `Saving batch ${Math.min(progress.completedChunks + 1, progress.totalChunks)} of ${progress.totalChunks}…`
                  : `Đang lưu lô ${Math.min(progress.completedChunks + 1, progress.totalChunks)} / ${progress.totalChunks}…`}
              </span>
              <span className="font-semibold text-primary tabular-nums">{percent}%</span>
            </div>
            <Progress value={percent} />
            <p className="text-xs text-muted-foreground tabular-nums">
              {locale === "en"
                ? `${progress.importedCount.toLocaleString()} imported so far`
                : `Đã lưu ${progress.importedCount.toLocaleString()} câu hỏi`}
            </p>
          </div>
        )}

        {progress.status === "error" && (
          <div className="space-y-4">
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>{progress.errorMessage}</span>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Button type="button" variant="outline" className="min-h-[44px]" onClick={onBack}>
                <ArrowLeft className="mr-2 size-4" aria-hidden="true" />
                {locale === "en" ? "Back" : "Quay lại"}
              </Button>
              <Button type="button" className="min-h-[44px]" onClick={onStartCommit}>
                {locale === "en" ? "Retry Import" : "Thử nhập lại"}
              </Button>
            </div>
          </div>
        )}

        {progress.status === "completed" && (
          <div className="space-y-6 py-2" aria-live="polite">
            <div className="flex items-start gap-3 rounded-xl border border-success/30 bg-success-subtle p-5">
              <CheckCircle2
                className="mt-0.5 size-6 shrink-0 text-success-subtle-foreground"
                aria-hidden="true"
              />
              <div>
                <h3 className="text-base font-semibold text-foreground">
                  {locale === "en"
                    ? "Import Completed Successfully"
                    : "Nhập câu hỏi thành công!"}
                </h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {locale === "en"
                    ? `${progress.importedCount.toLocaleString()} question(s) added (${progress.skippedCount.toLocaleString()} skipped, ${progress.replacedCount.toLocaleString()} replaced). Study set now has ${progress.totalSetQuestions.toLocaleString()} questions.`
                    : `Đã thêm ${progress.importedCount.toLocaleString()} câu hỏi (${progress.skippedCount.toLocaleString()} bỏ qua, ${progress.replacedCount.toLocaleString()} ghi đè). Học phần hiện có ${progress.totalSetQuestions.toLocaleString()} câu hỏi.`}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button asChild size="lg" className="min-h-[44px]">
                <Link href={`/sets/${studySetId}`}>
                  <BookOpen className="mr-2 size-4" aria-hidden="true" />
                  {locale === "en" ? "View Study Set" : "Xem học phần"}
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="min-h-[44px]">
                <Link href={`/sets/${studySetId}/practice`}>
                  <Play className="mr-2 size-4" aria-hidden="true" />
                  {locale === "en" ? "Start Practice" : "Luyện trắc nghiệm"}
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="min-h-[44px]">
                <Link href={`/sets/${studySetId}/test`}>
                  <ClipboardCheck className="mr-2 size-4" aria-hidden="true" />
                  {locale === "en" ? "Start Mock Exam" : "Làm bài thi thử"}
                </Link>
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
