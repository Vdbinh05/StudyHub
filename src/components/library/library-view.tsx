"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Archive,
  BookOpen,
  Copy,
  Download,
  Edit3,
  FileCheck2,
  Folder as FolderIcon,
  FolderInput,
  FolderPlus,
  Layers,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  Share2,
  Star,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import {
  apiFetch,
  formatRelativeTime,
  getFriendlyErrorMessage,
  isSupabaseConfiguredClient,
} from "@/components/layout/api-client";
import { EmptyState } from "@/components/layout/empty-state";
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
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { Folder, StudySet, StudySetType } from "@/types/domain";
import { FolderDialog, getFolderDotClass } from "./folder-dialog";

const ShareDialog = dynamic(
  () => import("@/components/social/share-dialog").then((m) => m.ShareDialog),
  { ssr: false },
);

type SortOption = "updated_desc" | "created_desc" | "title_asc" | "last_studied_desc";
const PAGE_SIZE = 48;

function LibraryViewInner() {
  const { locale, t } = useI18n();
  const vi = locale === "vi";
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const configured = isSupabaseConfiguredClient();

  const urlSearch = searchParams.get("search") ?? "";
  const rawUrlType = searchParams.get("type");
  const typeFilter: "all" | StudySetType =
    rawUrlType === "multiple_choice" ||
    rawUrlType === "flashcards" ||
    rawUrlType === "mixed"
      ? rawUrlType
      : "all";
  const urlAction = searchParams.get("action");
  const urlCreate = searchParams.get("create");

  const [sortBy, setSortBy] = React.useState<SortOption>("updated_desc");
  const [showArchived, setShowArchived] = React.useState(false);
  const [favoritesOnly, setFavoritesOnly] = React.useState(false);
  const [page, setPage] = React.useState(1);

  const [searchDraft, setSearchDraft] = React.useState<{
    baseUrl: string;
    value: string;
  } | null>(null);
  const searchInput =
    searchDraft && searchDraft.baseUrl === urlSearch ? searchDraft.value : urlSearch;
  const setSearchInput = (value: string) =>
    setSearchDraft({ baseUrl: urlSearch, value });

  const [debouncedSearch, setDebouncedSearch] = React.useState(urlSearch.trim());
  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const [folderDialogOpen, setFolderDialogOpen] = React.useState(false);
  const [editingFolder, setEditingFolder] = React.useState<Folder | null>(null);
  const [deletingFolder, setDeletingFolder] = React.useState<Folder | null>(null);

  const [deletingSet, setDeletingSet] = React.useState<StudySet | null>(null);
  const [sharingSet, setSharingSet] = React.useState<StudySet | null>(null);
  const [movingSet, setMovingSet] = React.useState<StudySet | null>(null);
  const [moveTargetFolderId, setMoveTargetFolderId] = React.useState<string>("none");

  const effectiveFolderDialogOpen = folderDialogOpen || urlCreate === "folder";
  const effectiveEditingFolder = urlCreate === "folder" ? null : editingFolder;

  const handleFolderDialogChange = (open: boolean) => {
    setFolderDialogOpen(open);
    if (!open) {
      setEditingFolder(null);
      if (urlCreate === "folder") {
        const next = new URLSearchParams(searchParams.toString());
        next.delete("create");
        router.replace(`/library${next.toString() ? `?${next}` : ""}`);
      }
    }
  };

  const foldersQuery = useQuery<Folder[]>({
    queryKey: ["folders"],
    enabled: configured,
    queryFn: async () => {
      const res = await apiFetch<Folder[]>("/api/folders");
      return Array.isArray(res.data) ? res.data : [];
    },
  });

  const setsQuery = useQuery<{ items: StudySet[]; total: number; hasMore: boolean }>({
    queryKey: [
      "study-sets",
      debouncedSearch,
      typeFilter,
      sortBy,
      showArchived,
      favoritesOnly,
      page,
    ],
    enabled: configured,
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set("scope", "owned");
      params.set("sort", sortBy);
      params.set("page", String(page));
      params.set("pageSize", String(PAGE_SIZE));
      if (debouncedSearch) params.set("search", debouncedSearch);
      if (typeFilter !== "all") params.set("type", typeFilter);
      if (showArchived) params.set("includeArchived", "true");
      if (favoritesOnly) params.set("favoritesOnly", "true");
      const res = await apiFetch<StudySet[]>(`/api/sets?${params.toString()}`);
      const items = Array.isArray(res.data) ? res.data : [];
      return {
        items,
        total: Number(res.meta?.total ?? items.length),
        hasMore: Boolean(res.meta?.hasMore),
      };
    },
  });

  const deleteFolderMutation = useMutation({
    mutationFn: async (folderId: string) => {
      await apiFetch(`/api/folders/${folderId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["folders"] });
      queryClient.invalidateQueries({ queryKey: ["study-sets"] });
      setDeletingFolder(null);
      toast.success(vi ? "Đã xóa thư mục." : "Folder deleted.");
    },
    onError: (err) => {
      toast.error(getFriendlyErrorMessage(err, locale));
    },
  });

  const deleteSetMutation = useMutation({
    mutationFn: async (setId: string) => {
      await apiFetch(`/api/sets/${setId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["study-sets"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      setDeletingSet(null);
      toast.success(vi ? "Đã xóa học phần." : "Study set deleted.");
    },
    onError: (err) => {
      toast.error(getFriendlyErrorMessage(err, locale));
    },
  });

  const duplicateSetMutation = useMutation({
    mutationFn: async (setId: string) => {
      const res = await apiFetch<StudySet>(`/api/sets/${setId}/duplicate`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["study-sets"] });
      toast.success(vi ? "Đã nhân bản học phần." : "Study set duplicated.");
    },
    onError: (err) => {
      toast.error(getFriendlyErrorMessage(err, locale));
    },
  });

  const moveSetMutation = useMutation({
    mutationFn: async ({ setId, folderId }: { setId: string; folderId: string | null }) => {
      await apiFetch(`/api/sets/${setId}`, {
        method: "PATCH",
        body: JSON.stringify({ folder_id: folderId }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["study-sets"] });
      setMovingSet(null);
      toast.success(vi ? "Đã di chuyển học phần." : "Study set moved.");
    },
    onError: (err) => {
      toast.error(getFriendlyErrorMessage(err, locale));
    },
  });

  const archiveSetMutation = useMutation({
    mutationFn: async ({ setId, archived }: { setId: string; archived: boolean }) => {
      await apiFetch(`/api/sets/${setId}`, {
        method: "PATCH",
        body: JSON.stringify({ is_archived: archived }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["study-sets"] });
      toast.success(vi ? "Đã cập nhật trạng thái lưu trữ." : "Archive status updated.");
    },
    onError: (err) => {
      toast.error(getFriendlyErrorMessage(err, locale));
    },
  });

  const favoriteSetMutation = useMutation({
    mutationFn: async ({ setId, favorite }: { setId: string; favorite: boolean }) => {
      await apiFetch(`/api/sets/${setId}`, {
        method: "PATCH",
        body: JSON.stringify({ is_favorite: favorite }),
      });
    },
    onMutate: async ({ setId, favorite }) => {
      const queryKey = [
        "study-sets",
        debouncedSearch,
        typeFilter,
        sortBy,
        showArchived,
        favoritesOnly,
        page,
      ];
      await queryClient.cancelQueries({ queryKey });
      const prev = queryClient.getQueryData<{
        items: StudySet[];
        total: number;
        hasMore: boolean;
      }>(queryKey);
      if (prev) {
        queryClient.setQueryData(queryKey, {
          ...prev,
          items: prev.items.map((s) =>
            s.id === setId ? { ...s, is_favorite: favorite } : s,
          ),
        });
      }
      return { prev, queryKey };
    },
    onError: (err, _, ctx) => {
      if (ctx?.prev) {
        queryClient.setQueryData(ctx.queryKey, ctx.prev);
      }
      toast.error(getFriendlyErrorMessage(err, locale));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["study-sets"] });
    },
  });

  const folders = React.useMemo(
    () => foldersQuery.data ?? [],
    [foldersQuery.data],
  );
  const rootFolders = React.useMemo(
    () => folders.filter((f) => !f.parent_id),
    [folders],
  );
  const rawSets = React.useMemo(
    () => setsQuery.data?.items ?? [],
    [setsQuery.data?.items],
  );
  const sets = React.useMemo(() => {
    const filtered = favoritesOnly
      ? rawSets.filter((s) => Boolean(s.is_favorite))
      : rawSets;
    return [...filtered].sort((a, b) => {
      const favDiff = Number(Boolean(b.is_favorite)) - Number(Boolean(a.is_favorite));
      return favDiff;
    });
  }, [rawSets, favoritesOnly]);

  const totalSets = setsQuery.data?.total ?? sets.length;
  const totalPages = Math.max(1, Math.ceil(totalSets / PAGE_SIZE));

  const getVisibilityLabel = (v: StudySet["visibility"]) => {
    switch (v) {
      case "public":
        return t("library.visibilityPublic");
      case "unlisted":
        return t("library.visibilityUnlisted");
      case "shared":
        return t("library.visibilityShared");
      default:
        return t("library.visibilityPrivate");
    }
  };

  const getTypeLabel = (type: StudySetType) => {
    switch (type) {
      case "flashcards":
        return t("library.typeFlashcards");
      case "mixed":
        return t("library.typeMixed");
      default:
        return t("library.typeMultipleChoice");
    }
  };

  const pageTitle =
    urlAction === "import"
      ? vi
        ? "Chọn học phần để nhập từ file"
        : "Choose Set to Import Into"
      : urlAction === "test"
        ? vi
          ? "Chọn học phần thi thử"
          : "Choose Set for Mock Exam"
        : typeFilter === "multiple_choice"
          ? vi
            ? "Ngân hàng câu hỏi"
            : "Question Bank"
          : typeFilter === "flashcards"
            ? "Flashcards"
            : t("library.title");

  return (
    <div className="space-y-5">
      {/* Full-width mobile-safe header (prevents UX31-06 title crushing at 360px/390px) */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h1 className="text-foreground text-xl font-bold tracking-tight sm:text-2xl">
            {pageTitle}
          </h1>
          <p className="text-muted-foreground max-w-2xl text-sm leading-relaxed">
            {t("library.subtitle")}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" className="min-h-11 sm:min-h-8">
            <Link href="/sets/new" prefetch={false}>
              <Plus className="size-4" aria-hidden="true" />
              <span>{t("library.newSet")}</span>
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="min-h-11 sm:min-h-8">
            <Link href="/import" prefetch={false}>
              <Upload className="size-4" aria-hidden="true" />
              <span>{t("library.importSet")}</span>
            </Link>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="min-h-11 sm:min-h-8"
            onClick={() => {
              setEditingFolder(null);
              setFolderDialogOpen(true);
            }}
          >
            <FolderPlus className="size-4" aria-hidden="true" />
            <span>{t("library.newFolder")}</span>
          </Button>
        </div>
      </div>

      {/* Contextual guidance when navigating from ?action=import or ?action=test */}
      {(urlAction === "import" || urlAction === "test") && (
        <div className="border-primary/30 bg-accent text-accent-foreground flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm">
          <div className="flex items-center gap-2.5">
            {urlAction === "import" ? (
              <Upload className="size-4 shrink-0" aria-hidden="true" />
            ) : (
              <FileCheck2 className="size-4 shrink-0" aria-hidden="true" />
            )}
            <span>
              {urlAction === "import"
                ? vi
                  ? "Chọn một học phần bên dưới để nhập câu hỏi từ Word/PDF/Excel/CSV/TXT, hoặc mở trang nhập nhanh."
                  : "Pick a study set below to bulk import questions, or open the quick import hub."
                : vi
                  ? "Chọn một học phần bên dưới hoặc tạo đề thi tổng hợp nhiều môn ngay."
                  : "Pick any study set below or launch the multi-subject Custom Exam Builder."}
            </span>
          </div>
          <Button size="sm" variant="outline" asChild>
            <Link href={urlAction === "import" ? "/import" : "/exams/new"} prefetch={false}>
              {urlAction === "import"
                ? vi
                  ? "Mở trang nhập nhanh"
                  : "Open Import Hub"
                : t("library.customExamCta")}
            </Link>
          </Button>
        </div>
      )}

      {/* Search & Filter Controls — single canonical search bar on /library */}
      <div className="flex flex-col gap-2.5 lg:flex-row lg:items-center lg:justify-between">
        <search className="relative w-full lg:max-w-sm">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden="true"
          />
          <Input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t("library.searchPlaceholder")}
            aria-label={t("library.searchPlaceholder")}
            className="pl-9"
          />
        </search>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={typeFilter}
            onValueChange={(val) => {
              const next = val as "all" | StudySetType;
              const params = new URLSearchParams(searchParams.toString());
              if (next === "all") params.delete("type");
              else params.set("type", next);
              setPage(1);
              router.replace(`/library${params.toString() ? `?${params}` : ""}`);
            }}
          >
            <SelectTrigger className="min-w-36 flex-1 sm:w-40 sm:flex-none" aria-label={t("common.filter")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("library.allSets")}</SelectItem>
              <SelectItem value="multiple_choice">{t("library.typeMultipleChoice")}</SelectItem>
              <SelectItem value="flashcards">{t("library.typeFlashcards")}</SelectItem>
              <SelectItem value="mixed">{t("library.typeMixed")}</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={sortBy}
            onValueChange={(v) => {
              setSortBy(v as SortOption);
              setPage(1);
            }}
          >
            <SelectTrigger className="min-w-40 flex-1 sm:w-44 sm:flex-none" aria-label={t("common.sort")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="updated_desc">
                {vi ? "Cập nhật gần nhất" : "Recently updated"}
              </SelectItem>
              <SelectItem value="last_studied_desc">
                {vi ? "Học gần nhất" : "Recently studied"}
              </SelectItem>
              <SelectItem value="created_desc">
                {vi ? "Mới tạo nhất" : "Newest first"}
              </SelectItem>
              <SelectItem value="title_asc">
                {vi ? "Tên A → Z" : "Title A → Z"}
              </SelectItem>
            </SelectContent>
          </Select>

          <Button
            variant={favoritesOnly ? "secondary" : "outline"}
            size="sm"
            className="min-h-11 sm:min-h-8"
            onClick={() => {
              setFavoritesOnly((prev) => !prev);
              setPage(1);
            }}
            aria-pressed={favoritesOnly}
          >
            <Star
              className={cn("size-4", favoritesOnly && "fill-warning text-warning")}
              aria-hidden="true"
            />
            <span>{t("library.favorites")}</span>
          </Button>

          <Button
            variant={showArchived ? "secondary" : "outline"}
            size="sm"
            className="min-h-11 sm:min-h-8"
            onClick={() => {
              setShowArchived((prev) => !prev);
              setPage(1);
            }}
            aria-pressed={showArchived}
          >
            <Archive className="size-4" aria-hidden="true" />
            <span>{t("library.archived")}</span>
          </Button>
        </div>
      </div>

      {/* Folders Section */}
      {rootFolders.length > 0 && (
        <section aria-labelledby="folders-heading" className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h2 id="folders-heading" className="text-foreground text-sm font-semibold">
              {t("nav.folders")} ({rootFolders.length})
            </h2>
            <Link
              href="/folders"
              prefetch={false}
              className="text-primary text-xs font-medium hover:underline"
            >
              {vi ? "Quản lý thư mục" : "Manage folders"}
            </Link>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {rootFolders.map((folder) => (
              <div
                key={folder.id}
                className="border-border bg-card hover:border-primary/40 flex items-center justify-between gap-2 rounded-xl border p-3.5 transition-colors"
              >
                <Link
                  href={`/folders/${folder.id}`}
                  prefetch={false}
                  className="flex min-w-0 flex-1 items-center gap-3"
                >
                  <span
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-lg text-white",
                      getFolderDotClass(folder.color),
                    )}
                    aria-hidden="true"
                  >
                    <FolderIcon className="size-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-foreground truncate text-sm font-semibold">
                      {folder.name}
                    </p>
                    {folder.description && (
                      <p className="text-muted-foreground truncate text-xs">
                        {folder.description}
                      </p>
                    )}
                  </div>
                </Link>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`${t("common.actions")} ${folder.name}`}
                    >
                      <MoreHorizontal className="size-4" aria-hidden="true" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem asChild>
                      <Link href={`/exams/new?folderId=${folder.id}`} prefetch={false}>
                        <FileCheck2 className="size-4" aria-hidden="true" />
                        <span>{vi ? "Thi thử thư mục" : "Exam this folder"}</span>
                      </Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        setEditingFolder(folder);
                        setFolderDialogOpen(true);
                      }}
                    >
                      <Edit3 className="size-4" aria-hidden="true" />
                      <span>{t("common.edit")}</span>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      variant="destructive"
                      onClick={() => setDeletingFolder(folder)}
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                      <span>{t("common.delete")}</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Study Sets Grid */}
      <section aria-labelledby="sets-heading" className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 id="sets-heading" className="text-foreground text-sm font-semibold">
            {t("library.mySets")}
            {configured && Boolean(setsQuery.data) && !setsQuery.error && (
              <span className="text-muted-foreground ml-1.5 font-mono text-xs font-normal tabular-nums">
                ({totalSets})
              </span>
            )}
          </h2>
        </div>

        {!configured ? (
          <EmptyState
            icon={BookOpen}
            title={vi ? "Chưa thể tải thư viện học phần" : "Library unavailable"}
            description={t("common.serviceUnavailableDesc")}
          />
        ) : setsQuery.isLoading ||
          (setsQuery.isFetching && !setsQuery.data) ||
          (!setsQuery.data && !setsQuery.error) ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-44 rounded-xl" />
            ))}
          </div>
        ) : setsQuery.error ? (
          <EmptyState
            icon={AlertCircle}
            title={vi ? "Không thể tải thư viện" : "Unable to load library"}
            description={getFriendlyErrorMessage(setsQuery.error, locale)}
            action={
              <Button onClick={() => void setsQuery.refetch()}>
                {t("common.retry")}
              </Button>
            }
          />
        ) : sets.length === 0 ? (
          <EmptyState
            icon={BookOpen}
            title={
              favoritesOnly
                ? vi
                  ? "Chưa có học phần yêu thích"
                  : "No favorite study sets yet"
                : t("library.emptyTitle")
            }
            description={
              favoritesOnly
                ? vi
                  ? "Bấm biểu tượng ngôi sao trên học phần bất kỳ để ghim lên đầu thư viện."
                  : "Click the star icon on any study set to pin it to the top of your library."
                : t("library.emptyDescription")
            }
            action={
              favoritesOnly ? (
                <Button variant="outline" onClick={() => setFavoritesOnly(false)}>
                  {t("library.allSets")}
                </Button>
              ) : (
                <Button asChild>
                  <Link href="/sets/new" prefetch={false}>
                    <Plus className="size-4" aria-hidden="true" />
                    <span>{t("library.newSet")}</span>
                  </Link>
                </Button>
              )
            }
            secondaryAction={
              !favoritesOnly ? (
                <Button variant="outline" asChild>
                  <Link href="/import" prefetch={false}>
                    <Upload className="size-4" aria-hidden="true" />
                    <span>{t("library.importSet")}</span>
                  </Link>
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {sets.map((set, idx) => {
                const isFav = Boolean(set.is_favorite);
                const primaryHref =
                  urlAction === "import"
                    ? `/sets/${set.id}/import`
                    : urlAction === "test"
                      ? `/exams/new?setId=${set.id}`
                      : `/sets/${set.id}`;

                return (
                  <Card
                    key={set.id}
                    className={cn(
                      "justify-between gap-3 py-4",
                      idx >= 3 && "cv-auto",
                    )}
                  >
                    <CardHeader className="gap-2 px-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="secondary">{getTypeLabel(set.set_type)}</Badge>
                          <Badge variant="outline">{getVisibilityLabel(set.visibility)}</Badge>
                        </div>

                        <div className="flex shrink-0 items-center gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="min-h-11 min-w-11 sm:min-h-8 sm:min-w-8"
                            aria-pressed={isFav}
                            aria-label={
                              isFav
                                ? `${t("library.unfavoriteSet")}: ${set.title}`
                                : `${t("library.favoriteSet")}: ${set.title}`
                            }
                            onClick={() =>
                              favoriteSetMutation.mutate({
                                setId: set.id,
                                favorite: !isFav,
                              })
                            }
                          >
                            <Star
                              className={cn(
                                "size-4",
                                isFav
                                  ? "fill-warning text-warning"
                                  : "text-muted-foreground",
                              )}
                              aria-hidden="true"
                            />
                          </Button>

                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="min-h-11 min-w-11 sm:min-h-8 sm:min-w-8"
                                aria-label={`${t("common.actions")} ${set.title}`}
                              >
                                <MoreHorizontal className="size-4" aria-hidden="true" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-52">
                              <DropdownMenuItem asChild>
                                <Link href={`/exams/new?setId=${set.id}`} prefetch={false}>
                                  <FileCheck2 className="size-4" aria-hidden="true" />
                                  <span>{t("library.customExamCta")}</span>
                                </Link>
                              </DropdownMenuItem>
                              <DropdownMenuItem asChild>
                                <Link href={`/sets/${set.id}/edit`} prefetch={false}>
                                  <Edit3 className="size-4" aria-hidden="true" />
                                  <span>{t("common.edit")}</span>
                                </Link>
                              </DropdownMenuItem>
                              <DropdownMenuItem asChild>
                                <Link href={`/sets/${set.id}/import`} prefetch={false}>
                                  <Upload className="size-4" aria-hidden="true" />
                                  <span>{t("library.importSet")}</span>
                                </Link>
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setSharingSet(set)}>
                                <Share2 className="size-4" aria-hidden="true" />
                                <span>{t("friends.shareSet")}</span>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => duplicateSetMutation.mutate(set.id)}
                              >
                                <Copy className="size-4" aria-hidden="true" />
                                <span>{t("library.duplicateSet")}</span>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => {
                                  setMovingSet(set);
                                  setMoveTargetFolderId(set.folder_id ?? "none");
                                }}
                              >
                                <FolderInput className="size-4" aria-hidden="true" />
                                <span>{vi ? "Chuyển thư mục" : "Move to folder"}</span>
                              </DropdownMenuItem>

                              <DropdownMenuSub>
                                <DropdownMenuSubTrigger>
                                  <Download className="mr-2 size-4" aria-hidden="true" />
                                  <span>{t("library.exportSet")}</span>
                                </DropdownMenuSubTrigger>
                                <DropdownMenuSubContent>
                                  {(["json", "xlsx", "csv", "txt"] as const).map((fmt) => (
                                    <DropdownMenuItem key={fmt} asChild>
                                      <a
                                        href={`/api/sets/${set.id}/export?format=${fmt}`}
                                        download
                                      >
                                        {fmt.toUpperCase()}
                                      </a>
                                    </DropdownMenuItem>
                                  ))}
                                </DropdownMenuSubContent>
                              </DropdownMenuSub>

                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() =>
                                  archiveSetMutation.mutate({
                                    setId: set.id,
                                    archived: !set.is_archived,
                                  })
                                }
                              >
                                <Archive className="size-4" aria-hidden="true" />
                                <span>
                                  {set.is_archived
                                    ? vi
                                      ? "Khôi phục"
                                      : "Unarchive"
                                    : vi
                                      ? "Lưu trữ"
                                      : "Archive"}
                                </span>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() => setDeletingSet(set)}
                              >
                                <Trash2 className="size-4" aria-hidden="true" />
                                <span>{t("common.delete")}</span>
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>

                      <CardTitle className="text-base">
                        <Link
                          href={primaryHref}
                          prefetch={false}
                          className="hover:text-primary line-clamp-2 transition-colors"
                        >
                          {set.title}
                        </Link>
                      </CardTitle>
                    </CardHeader>

                    <CardContent className="space-y-2 px-4">
                      {set.description && (
                        <p className="text-muted-foreground line-clamp-2 text-xs leading-relaxed">
                          {set.description}
                        </p>
                      )}
                      <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                        <span className="font-mono font-medium tabular-nums">
                          {set.question_count} {vi ? "câu hỏi" : "questions"}
                        </span>
                        {set.subject && <span className="truncate">{set.subject}</span>}
                        <span>{formatRelativeTime(set.updated_at, locale)}</span>
                      </div>
                    </CardContent>

                    <CardFooter className="gap-2 border-t px-4 pt-3">
                      {urlAction === "import" ? (
                        <Button size="sm" asChild className="min-h-11 w-full sm:min-h-8">
                          <Link href={`/sets/${set.id}/import`} prefetch={false}>
                            <Upload className="size-3.5" aria-hidden="true" />
                            <span>{t("library.importSet")}</span>
                          </Link>
                        </Button>
                      ) : urlAction === "test" ? (
                        <Button size="sm" asChild className="min-h-11 w-full sm:min-h-8">
                          <Link href={`/exams/new?setId=${set.id}`} prefetch={false}>
                            <FileCheck2 className="size-3.5" aria-hidden="true" />
                            <span>{t("exam.startExam")}</span>
                          </Link>
                        </Button>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="default"
                            asChild
                            className="min-h-11 flex-1 sm:min-h-8"
                          >
                            <Link href={`/sets/${set.id}`} prefetch={false}>
                              <Play className="size-3.5" aria-hidden="true" />
                              <span>{vi ? "Mở học phần" : "Open"}</span>
                            </Link>
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            asChild
                            className="min-h-11 min-w-11 sm:min-h-8 sm:min-w-8"
                          >
                            <Link
                              href={`/sets/${set.id}/${set.set_type === "flashcards" ? "flashcards" : "practice"}`}
                              prefetch={false}
                              aria-label={`${t("study.startStudy")} ${set.title}`}
                            >
                              <Layers className="size-3.5" aria-hidden="true" />
                            </Link>
                          </Button>
                        </>
                      )}
                    </CardFooter>
                  </Card>
                );
              })}
            </div>

            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-2 text-xs">
                <span className="text-muted-foreground font-mono tabular-nums">
                  {vi
                    ? `Trang ${page} / ${totalPages}`
                    : `Page ${page} of ${totalPages}`}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    {t("common.previous")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  >
                    {t("common.next")}
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {/* Dialogs */}
      <FolderDialog
        open={effectiveFolderDialogOpen}
        onOpenChange={handleFolderDialogChange}
        folder={effectiveEditingFolder}
      />

      {sharingSet && (
        <ShareDialog
          studySet={sharingSet}
          open={Boolean(sharingSet)}
          onOpenChange={(open) => !open && setSharingSet(null)}
        />
      )}

      {/* Move to Folder Dialog */}
      <Dialog open={Boolean(movingSet)} onOpenChange={(o) => !o && setMovingSet(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{vi ? "Chuyển học phần vào thư mục" : "Move to folder"}</DialogTitle>
          </DialogHeader>
          <Select value={moveTargetFolderId} onValueChange={setMoveTargetFolderId}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">
                {vi ? "Không thuộc thư mục nào" : "No folder (Unfiled)"}
              </SelectItem>
              {folders.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMovingSet(null)}>
              {t("common.cancel")}
            </Button>
            <Button
              disabled={moveSetMutation.isPending}
              onClick={() => {
                if (!movingSet) return;
                moveSetMutation.mutate({
                  setId: movingSet.id,
                  folderId: moveTargetFolderId === "none" ? null : moveTargetFolderId,
                });
              }}
            >
              {t("common.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Folder Confirmation */}
      <AlertDialog
        open={Boolean(deletingFolder)}
        onOpenChange={(o) => !o && setDeletingFolder(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {vi ? "Xóa thư mục này?" : "Delete this folder?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {vi
                ? `Thư mục "${deletingFolder?.name}" sẽ bị xóa. Các học phần bên trong vẫn được giữ nguyên trong thư viện.`
                : `Folder "${deletingFolder?.name}" will be deleted. Study sets inside will remain safely in your library.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel autoFocus>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deletingFolder && deleteFolderMutation.mutate(deletingFolder.id)}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Set Confirmation */}
      <AlertDialog
        open={Boolean(deletingSet)}
        onOpenChange={(o) => !o && setDeletingSet(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {vi ? "Xác nhận xóa học phần?" : "Delete study set?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("library.deleteSetConfirm")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel autoFocus>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deletingSet && deleteSetMutation.mutate(deletingSet.id)}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function LibraryView() {
  return (
    <React.Suspense fallback={<Skeleton className="h-96 w-full rounded-xl" />}>
      <LibraryViewInner />
    </React.Suspense>
  );
}
