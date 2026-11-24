"use client";

import * as React from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Compass,
  Edit3,
  Image as ImageIcon,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { DiagramEditor } from "@/components/diagram/DiagramEditor";
import {
  apiFetch,
  formatRelativeTime,
  getFriendlyErrorMessage,
} from "@/components/layout/api-client";
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
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { deleteDiagram, listStudySetDiagrams } from "@/lib/diagram/api";
import { useI18n } from "@/lib/i18n";
import { resolveSafeMediaUrl } from "@/lib/media/urls";
import type { DiagramSet } from "@/types/v3";

interface SetSummary {
  id: string;
  title: string;
  can_edit?: boolean;
  role?: "owner" | "editor" | "viewer";
}

export function StudySetDiagramsHub({ setId }: { setId: string }) {
  const { locale } = useI18n();
  const vi = locale === "vi";
  const queryClient = useQueryClient();

  const [creatingNew, setCreatingNew] = React.useState(false);
  const [deleteTarget, setDeleteTarget] = React.useState<DiagramSet | null>(null);

  const setQuery = useQuery({
    queryKey: ["study-set", setId],
    queryFn: async () => {
      const res = await apiFetch<SetSummary>(`/api/sets/${encodeURIComponent(setId)}`);
      return res.data;
    },
  });

  const diagramsQuery = useQuery({
    queryKey: ["study-set-diagrams", setId],
    queryFn: () => listStudySetDiagrams(setId),
  });

  const deleteMutation = useMutation({
    mutationFn: (diagramId: string) => deleteDiagram(diagramId),
    onSuccess: () => {
      toast.success(vi ? "Đã xóa sơ đồ." : "Diagram deleted.");
      setDeleteTarget(null);
      void queryClient.invalidateQueries({ queryKey: ["study-set-diagrams", setId] });
    },
    onError: (err) => {
      toast.error(
        getFriendlyErrorMessage(
          err,
          locale,
          vi ? "Không thể xóa sơ đồ." : "Could not delete diagram.",
        ),
      );
    },
  });

  const canEdit =
    setQuery.data?.can_edit ??
    (setQuery.data?.role === "owner" || setQuery.data?.role === "editor" || !setQuery.data?.role);

  if (creatingNew) {
    return (
      <div className="space-y-4">
        <DiagramEditor
          studySetId={setId}
          onSaved={() => {
            setCreatingNew(false);
            void queryClient.invalidateQueries({ queryKey: ["study-set-diagrams", setId] });
          }}
        />
        <div className="flex justify-start">
          <Button
            type="button"
            variant="ghost"
            onClick={() => setCreatingNew(false)}
            className="min-h-10 gap-1.5"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            <span>{vi ? "Hủy tạo mới" : "Cancel creation"}</span>
          </Button>
        </div>
      </div>
    );
  }

  const diagrams = diagramsQuery.data ?? [];

  return (
    <FadeIn aboveFold className="space-y-6">
      <PageHeader
        title={vi ? "Sơ đồ tương tác (Diagram)" : "Interactive Diagrams"}
        description={
          setQuery.data?.title
            ? vi
              ? `Học phần: ${setQuery.data.title} · Gắn nhãn điểm, vùng chữ nhật hoặc đa giác và luyện tập theo 6 chế độ.`
              : `Study set: ${setQuery.data.title} · Label points, rectangles, or polygons and drill across 6 modes.`
            : vi
              ? "Gắn nhãn vị trí lên sơ đồ kỹ thuật và luyện nhận diện trực quan."
              : "Label technical diagrams and drill location recognition across 6 interactive modes."
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline" size="sm" className="min-h-10 gap-1.5 sm:min-h-9">
              <Link href={`/sets/${encodeURIComponent(setId)}`}>
                <ArrowLeft className="size-4" aria-hidden="true" />
                <span>{vi ? "Về học phần" : "Back to set"}</span>
              </Link>
            </Button>
            {canEdit && (
              <Button
                type="button"
                size="sm"
                onClick={() => setCreatingNew(true)}
                className="min-h-10 gap-1.5 sm:min-h-9"
              >
                <Plus className="size-4" aria-hidden="true" />
                <span>{vi ? "Tạo sơ đồ mới" : "Create diagram"}</span>
              </Button>
            )}
          </div>
        }
      />

      {diagramsQuery.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-64 rounded-xl" />
          ))}
        </div>
      ) : diagramsQuery.isError ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm text-destructive">
              {getFriendlyErrorMessage(
                diagramsQuery.error,
                locale,
                vi ? "Không thể tải danh sách sơ đồ." : "Could not load diagrams.",
              )}
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => void diagramsQuery.refetch()}
            >
              {vi ? "Thử lại" : "Retry"}
            </Button>
          </CardContent>
        </Card>
      ) : diagrams.length === 0 ? (
        <EmptyState
          icon={Compass}
          title={
            vi ? "Chưa có sơ đồ nào trong học phần này" : "No diagrams in this study set yet"
          }
          description={
            vi
              ? "Tải lên hình ảnh giải phẫu, bản đồ khí tượng, sơ đồ mạch điện hoặc thiết bị để tạo bài luyện nhận diện vị trí."
              : "Upload anatomy charts, weather maps, circuit schematics, or technical diagrams to practice visual location recall."
          }
          action={
            canEdit ? (
              <Button
                type="button"
                onClick={() => setCreatingNew(true)}
                className="min-h-11 gap-2"
              >
                <Plus className="size-4" aria-hidden="true" />
                <span>{vi ? "Tạo sơ đồ đầu tiên" : "Create your first diagram"}</span>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {diagrams.map((diagram) => {
            const thumbUrl = resolveSafeMediaUrl({
              url: diagram.base_image_url,
              proxy_url: diagram.base_media?.proxy_url,
              storage_path: diagram.base_media?.storage_path,
            });
            const hotspotCount = diagram.hotspots?.length ?? 0;

            return (
              <Card key={diagram.id} className="flex flex-col overflow-hidden">
                <div className="relative flex aspect-video items-center justify-center overflow-hidden border-b border-border bg-muted/40 p-2">
                  {thumbUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={thumbUrl}
                      alt={diagram.title}
                      loading="lazy"
                      decoding="async"
                      className="max-h-full max-w-full object-contain"
                    />
                  ) : (
                    <ImageIcon className="size-8 text-muted-foreground" aria-hidden="true" />
                  )}
                  <Badge
                    variant="secondary"
                    className="absolute right-2 bottom-2 tabular-nums shadow-xs"
                  >
                    {vi ? `${hotspotCount} nhãn` : `${hotspotCount} labels`}
                  </Badge>
                </div>

                <CardContent className="flex flex-1 flex-col justify-between gap-3 pt-4">
                  <div className="min-w-0 space-y-1">
                    <h2 className="truncate text-base font-semibold text-foreground">
                      {diagram.title}
                    </h2>
                    {diagram.description && (
                      <p className="line-clamp-2 text-xs text-muted-foreground">
                        {diagram.description}
                      </p>
                    )}
                    <p className="text-[11px] text-muted-foreground">
                      {formatRelativeTime(diagram.updated_at, locale)}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button asChild size="sm" className="min-h-10 flex-1 gap-1.5 sm:min-h-9">
                      <Link href={`/diagrams/${encodeURIComponent(diagram.id)}/study`}>
                        <Play className="size-3.5" aria-hidden="true" />
                        <span>{vi ? "Học sơ đồ" : "Study"}</span>
                      </Link>
                    </Button>
                    {canEdit && (
                      <>
                        <Button
                          asChild
                          variant="outline"
                          size="sm"
                          className="min-h-10 gap-1.5 sm:min-h-9"
                        >
                          <Link href={`/diagrams/${encodeURIComponent(diagram.id)}/edit`}>
                            <Edit3 className="size-3.5" aria-hidden="true" />
                            <span>{vi ? "Sửa" : "Edit"}</span>
                          </Link>
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteTarget(diagram)}
                          aria-label={vi ? `Xóa sơ đồ ${diagram.title}` : `Delete ${diagram.title}`}
                          className="min-h-10 min-w-10 text-destructive hover:text-destructive sm:min-h-9 sm:min-w-9"
                        >
                          <Trash2 className="size-4" aria-hidden="true" />
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Destructive Delete Confirmation Dialog (Cancel autoFocused for safety) */}
      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {vi ? "Xóa sơ đồ tương tác?" : "Delete interactive diagram?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {vi
                ? `Bạn có chắc chắn muốn xóa sơ đồ "${deleteTarget?.title ?? ""}" và toàn bộ các nhãn vị trí bên trong? Hành động này không thể hoàn tác.`
                : `Are you sure you want to delete "${deleteTarget?.title ?? ""}" and all its hotspots? This action cannot be undone.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel autoFocus disabled={deleteMutation.isPending}>
              {vi ? "Hủy" : "Cancel"}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteMutation.isPending}
              onClick={() => {
                if (deleteTarget) deleteMutation.mutate(deleteTarget.id);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {vi ? "Xóa sơ đồ" : "Delete diagram"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </FadeIn>
  );
}
