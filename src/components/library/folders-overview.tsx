"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  FileCheck2,
  Folder as FolderIcon,
  FolderPlus,
  Library,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import {
  apiFetch,
  getFriendlyErrorMessage,
  isSupabaseConfiguredClient,
} from "@/components/layout/api-client";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { FadeIn } from "@/components/motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";
import type { Folder } from "@/types/domain";

export function FoldersOverview() {
  const { locale, t } = useI18n();
  const vi = locale === "vi";
  const queryClient = useQueryClient();
  const configured = isSupabaseConfiguredClient();

  const [createOpen, setCreateOpen] = React.useState(false);
  const [folderName, setFolderName] = React.useState("");
  const [folderDesc, setFolderDesc] = React.useState("");

  const foldersQuery = useQuery<Folder[]>({
    queryKey: ["folders"],
    enabled: configured,
    queryFn: async () => {
      const res = await apiFetch<Folder[]>("/api/folders");
      return res.data ?? [];
    },
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiFetch<Folder>("/api/folders", {
        method: "POST",
        body: JSON.stringify({
          name: folderName.trim(),
          description: folderDesc.trim() || null,
        }),
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["folders"] });
      setCreateOpen(false);
      setFolderName("");
      setFolderDesc("");
      toast.success(vi ? "Đã tạo thư mục mới." : "Folder created.");
    },
    onError: (err) => {
      toast.error(getFriendlyErrorMessage(err, locale));
    },
  });

  const folders = React.useMemo(
    () => foldersQuery.data ?? [],
    [foldersQuery.data],
  );
  const folderNameMap = React.useMemo(
    () => new Map(folders.map((f) => [f.id, f.name])),
    [folders],
  );

  return (
    <FadeIn aboveFold className="space-y-6">
      <PageHeader
        title={t("nav.folders")}
        description={
          vi
            ? "Sắp xếp học phần theo môn học, kỳ thi hoặc chuyên đề để luyện thi tổng hợp nhanh chóng."
            : "Organize study sets by course, exam track, or subject for quick multi-set mock exams."
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" asChild>
              <Link href="/library">
                <Library className="size-4" aria-hidden="true" />
                <span>{t("nav.library")}</span>
              </Link>
            </Button>
            <Button type="button" onClick={() => setCreateOpen(true)} disabled={!configured}>
              <FolderPlus className="size-4" aria-hidden="true" />
              <span>{t("library.newFolder")}</span>
            </Button>
          </div>
        }
      />

      {!configured ? (
        <EmptyState
          icon={FolderIcon}
          title={vi ? "Chưa thể tải danh sách thư mục" : "Folders unavailable right now"}
          description={t("common.serviceUnavailableDesc")}
          action={
            <Button asChild variant="outline">
              <Link href="/library">{t("common.goLibrary")}</Link>
            </Button>
          }
        />
      ) : foldersQuery.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-36 rounded-xl" />
          <Skeleton className="h-36 rounded-xl" />
          <Skeleton className="h-36 rounded-xl" />
        </div>
      ) : foldersQuery.isError ? (
        <EmptyState
          icon={FolderIcon}
          title={vi ? "Không thể tải danh sách thư mục" : "Unable to load folders"}
          description={getFriendlyErrorMessage(foldersQuery.error, locale)}
          action={
            <Button type="button" variant="outline" onClick={() => foldersQuery.refetch()}>
              {t("common.retry")}
            </Button>
          }
        />
      ) : folders.length === 0 ? (
        <EmptyState
          icon={FolderIcon}
          title={vi ? "Chưa có thư mục nào" : "No folders yet"}
          description={
            vi
              ? "Tạo thư mục đầu tiên để gom các học phần cùng môn và thi thử toàn bộ thư mục chỉ với một chạm."
              : "Create your first folder to group related subjects and launch folder-wide mock exams in one click."
          }
          action={
            <Button type="button" onClick={() => setCreateOpen(true)}>
              <FolderPlus className="size-4" aria-hidden="true" />
              <span>{t("library.newFolder")}</span>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {folders.map((folder) => {
            const parentName = folder.parent_id
              ? folderNameMap.get(folder.parent_id)
              : null;
            return (
              <Card
                key={folder.id}
                className="flex flex-col justify-between transition-colors hover:border-primary/40"
              >
                <CardHeader className="pb-2">
                  <div className="flex items-start gap-3">
                    <div className="bg-accent text-accent-foreground flex size-10 shrink-0 items-center justify-center rounded-lg">
                      <FolderIcon className="size-5" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <CardTitle className="truncate text-base">
                        <Link
                          href={`/folders/${folder.id}`}
                          className="hover:text-primary transition-colors"
                        >
                          {folder.name}
                        </Link>
                      </CardTitle>
                      {parentName && (
                        <p className="text-muted-foreground mt-0.5 truncate text-xs">
                          {vi ? `Trong: ${parentName}` : `In: ${parentName}`}
                        </p>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {folder.description && (
                    <p className="text-muted-foreground line-clamp-2 text-sm">
                      {folder.description}
                    </p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <Button asChild size="sm" variant="outline" className="flex-1">
                      <Link href={`/folders/${folder.id}`}>
                        <span>{vi ? "Mở thư mục" : "Open folder"}</span>
                        <ArrowRight className="size-3.5" aria-hidden="true" />
                      </Link>
                    </Button>
                    <Button asChild size="sm" variant="secondary">
                      <Link href={`/exams/new?folderId=${folder.id}`}>
                        <FileCheck2 className="size-3.5" aria-hidden="true" />
                        <span>{vi ? "Thi thử" : "Exam"}</span>
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("library.newFolder")}</DialogTitle>
            <DialogDescription>
              {vi
                ? "Đặt tên cho thư mục để gom nhóm các bộ câu hỏi của bạn."
                : "Give your folder a clear name to organize your study sets."}
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!folderName.trim()) {
                toast.error(
                  vi ? "Vui lòng nhập tên thư mục." : "Please enter a folder name.",
                );
                return;
              }
              createMutation.mutate();
            }}
            className="space-y-4"
          >
            <div className="space-y-1.5">
              <Label htmlFor="folders-new-name">
                {vi ? "Tên thư mục" : "Folder name"}
              </Label>
              <Input
                id="folders-new-name"
                value={folderName}
                onChange={(e) => setFolderName(e.target.value)}
                placeholder={vi ? "VD: Khí tượng hàng không" : "e.g. Aviation Meteorology"}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="folders-new-desc">
                {vi ? "Mô tả (tùy chọn)" : "Description (optional)"}
              </Label>
              <Textarea
                id="folders-new-desc"
                value={folderDesc}
                onChange={(e) => setFolderDesc(e.target.value)}
                rows={2}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending && (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                )}
                <span>{t("common.create")}</span>
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </FadeIn>
  );
}
