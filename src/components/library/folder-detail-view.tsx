"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  BookOpen,
  Edit3,
  Folder as FolderIcon,
  FolderMinus,
  FolderPlus,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { apiFetch, formatRelativeTime } from "@/components/layout/api-client";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { FadeIn } from "@/components/motion";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Folder, StudySet } from "@/types/domain";
import { FolderDialog, getFolderDotClass } from "./folder-dialog";

export function FolderDetailView({ folderId }: { folderId: string }) {
  const { locale, t } = useI18n();
  const vi = locale === "vi";
  const router = useRouter();
  const queryClient = useQueryClient();

  const [editOpen, setEditOpen] = React.useState(false);
  const [subFolderOpen, setSubFolderOpen] = React.useState(false);
  const [deleteOpen, setDeleteOpen] = React.useState(false);

  const foldersQuery = useQuery<Folder[]>({
    queryKey: ["folders"],
    queryFn: async () => {
      const res = await apiFetch<Folder[]>("/api/folders");
      return Array.isArray(res.data) ? res.data : [];
    },
  });

  const setsQuery = useQuery<StudySet[]>({
    queryKey: ["folder-sets", folderId],
    queryFn: async () => {
      const res = await apiFetch<StudySet[]>(
        `/api/sets?folderId=${encodeURIComponent(folderId)}&pageSize=100`,
      );
      return Array.isArray(res.data) ? res.data : [];
    },
  });

  const deleteFolderMutation = useMutation({
    mutationFn: async () => {
      await apiFetch(`/api/folders/${folderId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["folders"] });
      toast.success(vi ? "Đã xóa thư mục." : "Folder deleted.");
      router.push("/library");
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : t("common.errorGeneric"));
    },
  });

  const removeFromFolderMutation = useMutation({
    mutationFn: async (setId: string) => {
      await apiFetch(`/api/sets/${setId}`, {
        method: "PATCH",
        body: JSON.stringify({ folder_id: null }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["folder-sets", folderId] });
      queryClient.invalidateQueries({ queryKey: ["study-sets"] });
      toast.success(
        vi ? "Đã đưa học phần ra khỏi thư mục." : "Removed study set from folder.",
      );
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : t("common.errorGeneric"));
    },
  });

  const folder = (foldersQuery.data ?? []).find((f) => f.id === folderId) ?? null;
  const subFolders = (foldersQuery.data ?? []).filter((f) => f.parent_id === folderId);
  const sets = setsQuery.data ?? [];

  if (foldersQuery.isLoading || setsQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-72" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (!folder) {
    return (
      <EmptyState
        icon={AlertCircle}
        title={vi ? "Không tìm thấy thư mục" : "Folder not found"}
        description={
          vi
            ? "Thư mục này có thể đã bị xóa hoặc bạn không có quyền truy cập."
            : "This folder may have been deleted or you do not have access to it."
        }
        action={
          <Button asChild>
            <Link href="/library">{t("library.title")}</Link>
          </Button>
        }
      />
    );
  }

  return (
    <FadeIn className="space-y-6">
      <PageHeader
        title={folder.name}
        description={folder.description ?? undefined}
        breadcrumbs={[
          { label: t("library.title"), href: "/library" },
          { label: folder.name },
        ]}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setSubFolderOpen(true)}>
              <FolderPlus className="size-4" aria-hidden="true" />
              <span>{vi ? "Thư mục con" : "Subfolder"}</span>
            </Button>
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Edit3 className="size-4" aria-hidden="true" />
              <span>{t("common.edit")}</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive border-destructive/30 hover:bg-destructive-subtle"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              <span>{t("common.delete")}</span>
            </Button>
            <Button asChild size="sm">
              <Link href={`/sets/new?folderId=${folder.id}`}>
                <Plus className="size-4" aria-hidden="true" />
                <span>{t("library.newSet")}</span>
              </Link>
            </Button>
          </>
        }
      />

      {subFolders.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-foreground text-sm font-semibold">
            {vi ? "Thư mục con" : "Subfolders"} ({subFolders.length})
          </h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {subFolders.map((sub) => (
              <Link
                key={sub.id}
                href={`/folders/${sub.id}`}
                className="border-border bg-card hover:border-primary/40 flex items-center gap-3 rounded-xl border p-3.5 transition-colors"
              >
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-lg text-white",
                    getFolderDotClass(sub.color),
                  )}
                >
                  <FolderIcon className="size-4" aria-hidden="true" />
                </span>
                <span className="text-foreground truncate text-sm font-semibold">
                  {sub.name}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-foreground text-sm font-semibold">
          {vi ? "Học phần trong thư mục" : "Study sets in folder"} ({sets.length})
        </h2>

        {sets.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title={vi ? "Thư mục đang trống" : "No study sets in this folder"}
            description={
              vi
                ? "Tạo học phần mới trực tiếp trong thư mục này hoặc di chuyển học phần có sẵn từ Thư viện."
                : "Create a new study set in this folder or move an existing set from your library."
            }
            action={
              <Button asChild>
                <Link href={`/sets/new?folderId=${folder.id}`}>
                  <Plus className="size-4" aria-hidden="true" />
                  <span>{t("library.newSet")}</span>
                </Link>
              </Button>
            }
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sets.map((set) => (
              <Card key={set.id} className="justify-between gap-2 py-4">
                <CardHeader className="px-4">
                  <div className="flex items-start justify-between gap-2">
                    <Badge variant="secondary">
                      {set.question_count} {vi ? "câu" : "items"}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={vi ? "Đưa ra khỏi thư mục" : "Remove from folder"}
                      onClick={() => removeFromFolderMutation.mutate(set.id)}
                    >
                      <FolderMinus className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                  <CardTitle className="text-base">
                    <Link
                      href={`/sets/${set.id}`}
                      className="hover:text-primary line-clamp-2 transition-colors"
                    >
                      {set.title}
                    </Link>
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4">
                  <p className="text-muted-foreground text-xs">
                    {formatRelativeTime(set.updated_at, locale)}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <FolderDialog open={editOpen} onOpenChange={setEditOpen} folder={folder} />
      <FolderDialog
        open={subFolderOpen}
        onOpenChange={setSubFolderOpen}
        parentId={folder.id}
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {vi ? "Xóa thư mục này?" : "Delete this folder?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {vi
                ? "Các học phần bên trong sẽ không bị xóa mà được chuyển về Thư viện."
                : "Study sets inside will not be deleted; they will move back to your Library."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteFolderMutation.mutate()}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </FadeIn>
  );
}
