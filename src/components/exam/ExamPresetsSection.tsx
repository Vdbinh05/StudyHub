"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bookmark,
  Copy,
  Loader2,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Search,
  SlidersHorizontal,
  Star,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
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
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { lText } from "@/components/learning/learning-copy";
import { useI18n } from "@/lib/i18n";
import {
  createExamAttempt,
  deleteExamPreset,
  duplicateExamPreset,
  listExamPresets,
  updateExamPreset,
} from "@/lib/learning/api-client";
import type {
  ExamPreset,
  ExamSourceInput,
} from "@/types/domain";
import { cn } from "@/lib/utils";
import { getAllocationLabel, getPolicyLabel } from "./exam-labels";

export { getAllocationLabel, getPolicyLabel };

interface ExamPresetsSectionProps {
  onSelectPresetInBuilder?: (preset: ExamPreset) => void;
  compact?: boolean;
}

export function ExamPresetsSection({
  onSelectPresetInBuilder,
  compact = false,
}: ExamPresetsSectionProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { locale } = useI18n();

  const [search, setSearch] = React.useState("");
  const [favoritesOnly, setFavoritesOnly] = React.useState(false);
  const [launchingId, setLaunchingId] = React.useState<string | null>(null);
  const [renameTarget, setRenameTarget] = React.useState<ExamPreset | null>(null);
  const [renameDraft, setRenameDraft] = React.useState("");
  const [deleteTarget, setDeleteTarget] = React.useState<ExamPreset | null>(null);
  const [isMutating, setIsMutating] = React.useState(false);

  const presetsQuery = useQuery({
    queryKey: ["exam-presets", favoritesOnly, search],
    queryFn: () => listExamPresets({ favoritesOnly, search }),
    staleTime: 20_000,
  });

  const presets = presetsQuery.data ?? [];

  const handleToggleFavorite = async (preset: ExamPreset) => {
    try {
      await updateExamPreset(preset.id, { is_favorite: !preset.is_favorite });
      await queryClient.invalidateQueries({ queryKey: ["exam-presets"] });
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : lText(locale, "Không thể cập nhật yêu thích.", "Could not update favorite."),
      );
    }
  };

  const handleLaunchPreset = async (preset: ExamPreset) => {
    const sources: ExamSourceInput[] = (preset.sources ?? [])
      .map((s): ExamSourceInput | null => {
        const targetId = s.source_type === "folder" ? s.folder_id : s.study_set_id;
        if (!targetId) return null;
        return {
          source_type: s.source_type,
          id: targetId,
          include_subfolders: s.include_subfolders,
          custom_count: s.custom_count,
          custom_percentage: s.custom_percentage,
        };
      })
      .filter((x): x is ExamSourceInput => x !== null);

    if (sources.length === 0) {
      router.push(`/exams/new?presetId=${preset.id}`);
      return;
    }

    const questionCount =
      preset.requested_question_count ??
      Math.max(1, preset.current_eligible_count ?? 30);

    setLaunchingId(preset.id);
    try {
      const created = await createExamAttempt({
        sources,
        preset_id: preset.id,
        title: preset.name,
        question_count: questionCount,
        allocation_strategy: preset.allocation_strategy,
        selection_policy: preset.selection_policy,
        duration_limit_seconds: preset.duration_limit_seconds,
        pass_threshold: preset.pass_threshold,
        shuffle_questions: preset.shuffle_questions,
        shuffle_options: preset.shuffle_options,
        show_subject_names: preset.show_subject_names,
        show_chapter_names: preset.show_chapter_names,
        allow_navigation: preset.allow_navigation,
        allow_mark_for_review: preset.allow_mark_for_review,
        auto_submit_on_expire: preset.auto_submit_on_expire,
        show_review_after_submit: preset.show_review_after_submit,
        filters: preset.filters,
      });
      await queryClient.invalidateQueries({ queryKey: ["exam-presets"] });
      router.push(`/exams/${created.attempt.id}`);
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : lText(
              locale,
              "Không thể tạo đề từ mẫu này. Hãy mở trình tạo để điều chỉnh.",
              "Could not launch exam from preset. Open in builder to adjust.",
            ),
      );
      setLaunchingId(null);
    }
  };

  const handleDuplicate = async (preset: ExamPreset) => {
    try {
      await duplicateExamPreset(preset.id);
      toast.success(
        lText(locale, "Đã nhân bản mẫu đề.", "Preset duplicated."),
      );
      await queryClient.invalidateQueries({ queryKey: ["exam-presets"] });
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : lText(locale, "Không thể nhân bản mẫu đề.", "Failed to duplicate preset."),
      );
    }
  };

  const handleRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameTarget || !renameDraft.trim()) return;
    setIsMutating(true);
    try {
      await updateExamPreset(renameTarget.id, { name: renameDraft.trim() });
      toast.success(lText(locale, "Đã đổi tên mẫu đề.", "Preset renamed."));
      setRenameTarget(null);
      await queryClient.invalidateQueries({ queryKey: ["exam-presets"] });
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : lText(locale, "Không thể đổi tên mẫu đề.", "Failed to rename preset."),
      );
    } finally {
      setIsMutating(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!deleteTarget) return;
    setIsMutating(true);
    try {
      await deleteExamPreset(deleteTarget.id);
      toast.success(lText(locale, "Đã xóa mẫu đề.", "Preset deleted."));
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: ["exam-presets"] });
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : lText(locale, "Không thể xóa mẫu đề.", "Failed to delete preset."),
      );
    } finally {
      setIsMutating(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground">
          {lText(
            locale,
            "Mẫu đề chỉ lưu cấu hình (môn học, tỷ lệ phân bổ, số câu, thời gian, chính sách chọn). Mỗi lần bấm Thi ngay sẽ tự động rút bộ câu hỏi mới.",
            "Presets store configuration only (sources, allocation, size, time, selection policy). Every launch generates a fresh randomized exam.",
          )}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          <search className="relative flex-1 sm:w-56 sm:flex-none">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={lText(locale, "Tìm mẫu đề...", "Search presets...")}
              aria-label={lText(locale, "Tìm kiếm mẫu đề", "Search presets")}
              className="pl-9 min-h-10"
            />
          </search>
          <Button
            type="button"
            variant={favoritesOnly ? "secondary" : "outline"}
            size="sm"
            className="min-h-10"
            aria-pressed={favoritesOnly}
            onClick={() => setFavoritesOnly((prev) => !prev)}
          >
            <Star
              className={cn(
                "size-4",
                favoritesOnly && "fill-warning text-warning",
              )}
              aria-hidden="true"
            />
            {lText(locale, "Yêu thích", "Favorites")}
          </Button>
          {!compact ? (
            <Button asChild size="sm" className="min-h-10">
              <Link href="/exams/new">
                <Plus className="size-4" aria-hidden="true" />
                {lText(locale, "Tạo mẫu mới", "New Preset")}
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      {presetsQuery.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Skeleton className="h-44 rounded-xl" />
          <Skeleton className="h-44 rounded-xl" />
        </div>
      ) : presets.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <div className="flex size-12 items-center justify-center rounded-full bg-secondary text-muted-foreground">
              <Bookmark className="size-5" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-semibold">
                {lText(locale, "Chưa có mẫu đề nào được lưu", "No saved exam presets yet")}
              </h3>
              <p className="max-w-md text-sm text-muted-foreground">
                {lText(
                  locale,
                  "Thiết lập đề thi nhiều môn, tỷ lệ phân bổ và thời gian làm bài trong Trình tạo đề rồi lưu làm mẫu để thi lại chỉ với 1 chạm.",
                  "Configure a multi-subject exam in the Custom Builder and save it as a preset for 1-click randomized launches.",
                )}
              </p>
            </div>
            <Button asChild className="min-h-11">
              <Link href="/exams/new">
                <Plus className="size-4" aria-hidden="true" />
                {lText(locale, "Tạo đề & lưu mẫu đầu tiên", "Create & Save First Preset")}
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {presets.map((preset) => {
            const sourceList = preset.sources ?? [];
            const visibleSources = sourceList.slice(0, 3);
            const extraSourceCount = Math.max(0, sourceList.length - 3);
            const mins = preset.duration_limit_seconds
              ? Math.round(preset.duration_limit_seconds / 60)
              : null;

            return (
              <Card key={preset.id} className="flex flex-col justify-between">
                <CardContent className="flex h-full flex-col justify-between gap-4 py-5">
                  <div className="space-y-3">
                    {/* Row 1: Favorite + Name + Overflow */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-start gap-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="min-h-11 min-w-11 shrink-0 -ml-2 -mt-1.5"
                          aria-pressed={preset.is_favorite}
                          aria-label={
                            preset.is_favorite
                              ? lText(
                                  locale,
                                  `Bỏ yêu thích mẫu đề ${preset.name}`,
                                  `Unfavorite preset ${preset.name}`,
                                )
                              : lText(
                                  locale,
                                  `Đánh dấu yêu thích mẫu đề ${preset.name}`,
                                  `Favorite preset ${preset.name}`,
                                )
                          }
                          onClick={() => void handleToggleFavorite(preset)}
                        >
                          <Star
                            className={cn(
                              "size-4",
                              preset.is_favorite
                                ? "fill-warning text-warning"
                                : "text-muted-foreground",
                            )}
                            aria-hidden="true"
                          />
                        </Button>
                        <div className="min-w-0">
                          <h3 className="truncate text-base font-semibold text-foreground">
                            {preset.name}
                          </h3>
                          {preset.description ? (
                            <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                              {preset.description}
                            </p>
                          ) : null}
                        </div>
                      </div>

                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="min-h-10 min-w-10 shrink-0"
                            aria-label={lText(
                              locale,
                              `Tùy chọn cho mẫu đề ${preset.name}`,
                              `Actions for preset ${preset.name}`,
                            )}
                          >
                            <MoreHorizontal className="size-4" aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => {
                              setRenameTarget(preset);
                              setRenameDraft(preset.name);
                            }}
                          >
                            <Pencil className="size-4" aria-hidden="true" />
                            {lText(locale, "Đổi tên", "Rename")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => void handleDuplicate(preset)}
                          >
                            <Copy className="size-4" aria-hidden="true" />
                            {lText(locale, "Nhân bản", "Duplicate")}
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setDeleteTarget(preset)}
                          >
                            <Trash2 className="size-4" aria-hidden="true" />
                            {lText(locale, "Xóa mẫu đề", "Delete Preset")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    {/* Row 2: Sources */}
                    {visibleSources.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {visibleSources.map((src) => (
                          <Badge
                            key={src.id}
                            variant="secondary"
                            className="max-w-[180px] truncate text-xs"
                            title={src.title ?? undefined}
                          >
                            {src.title ??
                              (src.source_type === "folder"
                                ? lText(locale, "Thư mục", "Folder")
                                : lText(locale, "Học phần", "Study Set"))}
                          </Badge>
                        ))}
                        {extraSourceCount > 0 ? (
                          <Badge variant="outline" className="text-xs tabular-nums">
                            +{extraSourceCount}{" "}
                            {lText(locale, "nguồn khác", "more")}
                          </Badge>
                        ) : null}
                      </div>
                    ) : null}

                    {/* Row 3: Specs summary */}
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground tabular-nums">
                      <span className="font-medium text-foreground">
                        {preset.requested_question_count
                          ? `${preset.requested_question_count} ${lText(locale, "câu", "Q")}`
                          : lText(locale, "Tất cả câu", "All Q")}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {mins
                          ? `${mins} ${lText(locale, "phút", "min")}`
                          : lText(locale, "Không giới hạn giờ", "Unlimited")}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {getAllocationLabel(locale, preset.allocation_strategy)}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{getPolicyLabel(locale, preset.selection_policy)}</span>
                    </div>
                  </div>

                  {/* Row 4: Actions */}
                  <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border">
                    <Button
                      type="button"
                      size="sm"
                      className="min-h-10 flex-1"
                      disabled={launchingId === preset.id}
                      onClick={() => void handleLaunchPreset(preset)}
                    >
                      {launchingId === preset.id ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Play className="size-4" aria-hidden="true" />
                      )}
                      {lText(locale, "Tạo đề ngẫu nhiên mới", "Launch New Random Exam")}
                    </Button>
                    {onSelectPresetInBuilder ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="min-h-10"
                        onClick={() => onSelectPresetInBuilder(preset)}
                      >
                        <SlidersHorizontal className="size-4" aria-hidden="true" />
                        {lText(locale, "Chỉnh sửa", "Edit")}
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        className="min-h-10"
                        asChild
                      >
                        <Link href={`/exams/new?presetId=${preset.id}`}>
                          <SlidersHorizontal className="size-4" aria-hidden="true" />
                          {lText(locale, "Mở trình tạo", "Open in Builder")}
                        </Link>
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Rename Modal */}
      <Dialog
        open={Boolean(renameTarget)}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
      >
        <DialogContent className="overscroll-contain">
          <DialogHeader>
            <DialogTitle>
              {lText(locale, "Đổi tên mẫu đề", "Rename Exam Preset")}
            </DialogTitle>
            <DialogDescription>
              {lText(
                locale,
                "Đặt tên dễ nhớ cho cấu hình đề thi này.",
                "Choose a clear name for this exam configuration.",
              )}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleRenameSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="rename-preset-input">
                {lText(locale, "Tên mẫu đề", "Preset Name")}
              </Label>
              <Input
                id="rename-preset-input"
                value={renameDraft}
                onChange={(e) => setRenameDraft(e.target.value)}
                maxLength={160}
                autoFocus
                required
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRenameTarget(null)}
              >
                {lText(locale, "Hủy", "Cancel")}
              </Button>
              <Button type="submit" disabled={isMutating || !renameDraft.trim()}>
                {isMutating ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : null}
                {lText(locale, "Lưu tên mới", "Save Name")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog (autofocus on Cancel per modern-web-guidance dialog rule) */}
      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent className="overscroll-contain">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {lText(locale, "Xóa mẫu đề thi?", "Delete Exam Preset?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {lText(
                locale,
                `Bạn có chắc muốn xóa mẫu đề "${deleteTarget?.name ?? ""}"? Lịch sử các bài thi bạn đã làm trước đây vẫn sẽ được giữ nguyên.`,
                `Delete preset "${deleteTarget?.name ?? ""}"? Your past exam history will remain intact.`,
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel autoFocus disabled={isMutating}>
              {lText(locale, "Hủy", "Cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isMutating}
              onClick={() => void handleDeleteConfirm()}
            >
              {lText(locale, "Xóa mẫu đề", "Delete Preset")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
