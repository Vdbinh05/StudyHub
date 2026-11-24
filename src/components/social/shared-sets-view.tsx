"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Copy,
  Edit3,
  Play,
  Share2,
} from "lucide-react";
import { toast } from "sonner";
import {
  apiFetch,
  formatRelativeTime,
  getFriendlyErrorMessage,
  isSupabaseConfiguredClient,
} from "@/components/layout/api-client";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { FadeIn } from "@/components/motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/lib/i18n";
import type { MemberRole, StudySet } from "@/types/domain";

interface SharedStudySet extends StudySet {
  role?: MemberRole;
  member_role?: MemberRole;
  owner_name?: string | null;
  owner?: { display_name?: string | null; username?: string | null } | null;
  allow_clone?: boolean;
}

export function SharedSetsView() {
  const { locale, t } = useI18n();
  const vi = locale === "vi";
  const router = useRouter();
  const queryClient = useQueryClient();
  const configured = isSupabaseConfiguredClient();

  const sharedQuery = useQuery<SharedStudySet[]>({
    queryKey: ["shared-sets"],
    enabled: configured,
    queryFn: async () => {
      const res = await apiFetch<SharedStudySet[]>(
        "/api/sets?scope=shared&pageSize=100",
      );
      return Array.isArray(res.data) ? res.data : [];
    },
  });

  const cloneMutation = useMutation({
    mutationFn: async (setId: string) => {
      const res = await apiFetch<StudySet>(`/api/sets/${setId}/duplicate`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      return res.data;
    },
    onSuccess: (cloned) => {
      queryClient.invalidateQueries({ queryKey: ["study-sets"] });
      toast.success(
        vi
          ? "Đã sao chép học phần vào thư viện của bạn."
          : "Copied study set to your library.",
      );
      router.push(`/sets/${cloned.id}`);
    },
    onError: (err) => {
      toast.error(getFriendlyErrorMessage(err, locale));
    },
  });

  const sets = sharedQuery.data ?? [];

  return (
    <FadeIn aboveFold className="space-y-6">
      <PageHeader
        title={vi ? "Được chia sẻ với tôi" : "Shared with Me"}
        description={
          vi
            ? "Các học phần được bạn bè chia sẻ trực tiếp hoặc bạn đã mở qua liên kết chia sẻ."
            : "Study sets shared with you by friends or redeemed via share links."
        }
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/friends">{t("nav.friends")}</Link>
          </Button>
        }
      />

      {!configured ? (
        <EmptyState
          icon={Share2}
          title={vi ? "Chưa thể tải học phần chia sẻ" : "Shared sets unavailable"}
          description={t("common.serviceUnavailableDesc")}
        />
      ) : sharedQuery.isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : sharedQuery.error ? (
        <EmptyState
          icon={AlertCircle}
          title={vi ? "Không thể tải danh sách chia sẻ" : "Unable to load shared sets"}
          description={getFriendlyErrorMessage(sharedQuery.error, locale)}
          action={
            <Button onClick={() => void sharedQuery.refetch()}>
              {t("common.retry")}
            </Button>
          }
        />
      ) : sets.length === 0 ? (
        <EmptyState
          icon={Share2}
          title={vi ? "Chưa có học phần nào được chia sẻ" : "No sets shared with you yet"}
          description={
            vi
              ? "Khi bạn bè chia sẻ học phần cho username của bạn hoặc gửi liên kết chia sẻ, học phần sẽ hiển thị tại đây."
              : "When friends share a set with your username or send you a share link, it will appear here."
          }
          action={
            <Button asChild variant="outline">
              <Link href="/friends">{t("friends.findFriends")}</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sets.map((set) => {
            const role = set.role ?? set.member_role ?? "viewer";
            const canClone = set.allow_clone !== false;
            return (
              <Card key={set.id} className="justify-between gap-3 py-4">
                <CardHeader className="gap-2 px-4">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant={role === "editor" ? "accent" : "secondary"}>
                      {role === "editor"
                        ? t("friends.roleEditor")
                        : t("friends.roleViewer")}
                    </Badge>
                    <span className="text-muted-foreground font-mono text-xs tabular-nums">
                      {set.question_count} {vi ? "câu" : "items"}
                    </span>
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

                <CardContent className="space-y-1 px-4 text-xs">
                  {(set.owner?.display_name || set.owner?.username || set.owner_name) && (
                    <p className="text-muted-foreground">
                      {vi ? "Chủ sở hữu: " : "Owner: "}
                      <span className="text-foreground font-medium">
                        {set.owner?.display_name ??
                          (set.owner?.username ? `@${set.owner.username}` : set.owner_name)}
                      </span>
                    </p>
                  )}
                  <p className="text-muted-foreground">
                    {formatRelativeTime(set.updated_at, locale)}
                  </p>
                </CardContent>

                <CardFooter className="gap-2 border-t px-4 pt-3">
                  <Button size="sm" asChild className="flex-1">
                    <Link href={`/sets/${set.id}`}>
                      <Play className="size-3.5" aria-hidden="true" />
                      <span>{vi ? "Học ngay" : "Study"}</span>
                    </Link>
                  </Button>
                  {role === "editor" && (
                    <Button size="sm" variant="outline" asChild>
                      <Link
                        href={`/sets/${set.id}/edit`}
                        aria-label={`${t("common.edit")} ${set.title}`}
                      >
                        <Edit3 className="size-3.5" aria-hidden="true" />
                      </Link>
                    </Button>
                  )}
                  {canClone && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={cloneMutation.isPending}
                      onClick={() => cloneMutation.mutate(set.id)}
                      aria-label={`${t("library.duplicateSet")} ${set.title}`}
                    >
                      <Copy className="size-3.5" aria-hidden="true" />
                    </Button>
                  )}
                </CardFooter>
              </Card>
            );
          })}
        </div>
      )}
    </FadeIn>
  );
}
