"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Check,
  Loader2,
  Search,
  UserMinus,
  UserPlus,
  Users,
  X,
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/lib/i18n";
import type { Friendship, Profile } from "@/types/domain";

interface FriendItem extends Friendship {
  direction?: "incoming" | "outgoing";
  peer?: Profile | null;
  friend?: Profile | null;
}

interface FriendsPayload {
  current_user_id?: string;
  friends?: FriendItem[];
  incoming?: FriendItem[];
  incoming_requests?: FriendItem[];
  outgoing?: FriendItem[];
  outgoing_requests?: FriendItem[];
}

function getPeerProfile(item: FriendItem, currentUserId?: string): Profile | null {
  if (item.friend) return item.friend;
  if (item.peer) return item.peer;
  if (currentUserId) {
    return item.requester_id === currentUserId
      ? (item.addressee ?? null)
      : (item.requester ?? null);
  }
  return item.requester ?? item.addressee ?? null;
}

function getInitials(p: Profile | null): string {
  const s = (p?.display_name || p?.username || "U").trim().toUpperCase();
  return s.slice(0, 2);
}

export function FriendsView() {
  const { locale, t } = useI18n();
  const vi = locale === "vi";
  const queryClient = useQueryClient();
  const configured = isSupabaseConfiguredClient();

  const [searchInput, setSearchInput] = React.useState("");
  const [submittedQuery, setSubmittedQuery] = React.useState("");
  const [removingFriend, setRemovingFriend] = React.useState<{
    id: string;
    name: string;
    isOutgoing?: boolean;
  } | null>(null);

  const profileQuery = useQuery<Profile | null>({
    queryKey: ["current-profile-id"],
    enabled: configured,
    queryFn: async () => {
      try {
        const res = await apiFetch<Profile | { profile: Profile }>("/api/profile");
        const raw = res.data;
        if (raw && typeof raw === "object" && "profile" in raw) return raw.profile;
        return raw as Profile;
      } catch {
        return null;
      }
    },
  });

  const friendsQuery = useQuery<FriendsPayload | FriendItem[]>({
    queryKey: ["friends"],
    enabled: configured,
    queryFn: async () => {
      const res = await apiFetch<FriendsPayload | FriendItem[]>("/api/friends");
      return res.data;
    },
  });

  const userSearchQuery = useQuery<Profile[]>({
    queryKey: ["user-search", submittedQuery],
    enabled: configured && submittedQuery.trim().length >= 3,
    queryFn: async () => {
      const res = await apiFetch<Profile[]>(
        `/api/users/search?q=${encodeURIComponent(submittedQuery.trim())}`,
      );
      return Array.isArray(res.data) ? res.data : [];
    },
  });

  const sendRequestMutation = useMutation({
    mutationFn: async (payload: { addressee_id?: string; identifier?: string }) => {
      await apiFetch("/api/friends", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["friends"] });
      setSearchInput("");
      setSubmittedQuery("");
      toast.success(vi ? "Đã gửi lời mời kết bạn." : "Friend request sent.");
    },
    onError: (err) => {
      toast.error(getFriendlyErrorMessage(err, locale));
    },
  });

  const respondMutation = useMutation({
    mutationFn: async ({
      id,
      action,
    }: {
      id: string;
      action: "accept" | "decline" | "block";
    }) => {
      await apiFetch(`/api/friends/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ action }),
      });
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["friends"] });
      toast.success(
        vars.action === "accept"
          ? vi
            ? "Đã chấp nhận kết bạn."
            : "Friend request accepted."
          : vi
            ? "Đã cập nhật lời mời."
            : "Request updated.",
      );
    },
    onError: (err) => {
      toast.error(getFriendlyErrorMessage(err, locale));
    },
  });

  const removeMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiFetch(`/api/friends/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      setRemovingFriend(null);
      queryClient.invalidateQueries({ queryKey: ["friends"] });
      toast.success(vi ? "Đã xóa kết nối." : "Connection removed.");
    },
    onError: (err) => {
      toast.error(getFriendlyErrorMessage(err, locale));
    },
  });

  const currentUserId = profileQuery.data?.id;

  const { accepted, incoming, outgoing } = React.useMemo(() => {
    const raw = friendsQuery.data;
    if (!raw) return { accepted: [], incoming: [], outgoing: [] };
    if (!Array.isArray(raw)) {
      return {
        accepted: raw.friends ?? [],
        incoming: raw.incoming_requests ?? raw.incoming ?? [],
        outgoing: raw.outgoing_requests ?? raw.outgoing ?? [],
      };
    }
    const acc: FriendItem[] = [];
    const inc: FriendItem[] = [];
    const out: FriendItem[] = [];
    for (const item of raw) {
      if (item.status === "accepted") {
        acc.push(item);
      } else if (item.status === "pending") {
        if (
          item.direction === "incoming" ||
          (currentUserId && item.addressee_id === currentUserId)
        ) {
          inc.push(item);
        } else {
          out.push(item);
        }
      }
    }
    return { accepted: acc, incoming: inc, outgoing: out };
  }, [friendsQuery.data, currentUserId]);

  const handleSearchSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = searchInput.trim();
    if (trimmed.length < 3) {
      toast.error(
        vi
          ? "Nhập tối thiểu 3 ký tự username hoặc email."
          : "Enter at least 3 characters (username or email).",
      );
      return;
    }
    setSubmittedQuery(trimmed);
  };

  return (
    <FadeIn aboveFold className="space-y-6">
      <PageHeader title={t("friends.title")} description={t("friends.subtitle")} />

      {/* Find Friends Card */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">{t("friends.findFriends")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <search>
            <form onSubmit={handleSearchSubmit} className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Search
                  className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
                  aria-hidden="true"
                />
                <Input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  spellCheck={false}
                  placeholder={t("friends.searchByUsername")}
                  aria-label={t("friends.searchByUsername")}
                  className="pl-9"
                  disabled={!configured}
                />
              </div>
              <Button type="submit" variant="secondary" disabled={!configured}>
                <Search className="size-4" aria-hidden="true" />
                <span>{t("common.search")}</span>
              </Button>
              <Button
                type="button"
                disabled={
                  !configured ||
                  searchInput.trim().length < 3 ||
                  sendRequestMutation.isPending
                }
                onClick={() =>
                  sendRequestMutation.mutate({ identifier: searchInput.trim() })
                }
              >
                {sendRequestMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <UserPlus className="size-4" aria-hidden="true" />
                )}
                <span>{t("friends.sendRequest")}</span>
              </Button>
            </form>
          </search>

          {userSearchQuery.isFetching && (
            <p className="text-muted-foreground text-xs">{t("common.loading")}</p>
          )}

          {userSearchQuery.data && userSearchQuery.data.length > 0 && (
            <ul className="divide-border divide-y rounded-lg border">
              {userSearchQuery.data.map((u) => (
                <li
                  key={u.id}
                  className="flex items-center justify-between gap-3 p-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar className="size-8">
                      {u.avatar_url ? (
                        <AvatarImage src={u.avatar_url} alt={u.display_name} />
                      ) : null}
                      <AvatarFallback>{getInitials(u)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="text-foreground truncate text-sm font-medium">
                        {u.display_name}
                      </p>
                      {u.username && (
                        <p className="text-muted-foreground truncate text-xs">
                          @{u.username}
                        </p>
                      )}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    disabled={sendRequestMutation.isPending}
                    aria-label={`${t("friends.sendRequest")} ${u.display_name}`}
                    onClick={() =>
                      sendRequestMutation.mutate({ addressee_id: u.id })
                    }
                  >
                    <UserPlus className="size-3.5" aria-hidden="true" />
                    <span>{t("friends.sendRequest")}</span>
                  </Button>
                </li>
              ))}
            </ul>
          )}

          {submittedQuery &&
            !userSearchQuery.isFetching &&
            userSearchQuery.data?.length === 0 && (
              <p className="text-muted-foreground text-xs">
                {vi
                  ? `Không tìm thấy người dùng khớp với "${submittedQuery}".`
                  : `No users found matching "${submittedQuery}".`}
              </p>
            )}
        </CardContent>
      </Card>

      {/* Friends & Requests Tabs */}
      {!configured ? (
        <EmptyState
          icon={Users}
          title={vi ? "Chưa thể tải danh sách bạn bè" : "Friends unavailable"}
          description={t("common.serviceUnavailableDesc")}
        />
      ) : friendsQuery.isLoading ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : friendsQuery.error ? (
        <EmptyState
          icon={AlertCircle}
          title={vi ? "Không thể tải danh sách bạn bè" : "Unable to load friends"}
          description={getFriendlyErrorMessage(friendsQuery.error, locale)}
          action={
            <Button onClick={() => void friendsQuery.refetch()}>
              {t("common.retry")}
            </Button>
          }
        />
      ) : (
        <Tabs defaultValue="accepted">
          <TabsList>
            <TabsTrigger value="accepted">
              {t("friends.myFriends")} ({accepted.length})
            </TabsTrigger>
            <TabsTrigger value="incoming">
              {t("friends.pendingRequests")} ({incoming.length})
            </TabsTrigger>
            <TabsTrigger value="outgoing">
              {t("friends.sentRequests")} ({outgoing.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="accepted" className="mt-4">
            {accepted.length === 0 ? (
              <EmptyState
                icon={Users}
                title={t("friends.myFriends")}
                description={t("friends.noFriends")}
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {accepted.map((item) => {
                  const peer = getPeerProfile(item, currentUserId);
                  const peerName =
                    peer?.display_name ??
                    peer?.username ??
                    (vi ? "Người dùng" : "User");
                  return (
                    <Card key={item.id} className="py-4">
                      <CardContent className="flex items-center justify-between gap-3 px-4">
                        <div className="flex min-w-0 items-center gap-3">
                          <Avatar className="size-10">
                            {peer?.avatar_url ? (
                              <AvatarImage
                                src={peer.avatar_url}
                                alt={peerName}
                              />
                            ) : null}
                            <AvatarFallback>{getInitials(peer)}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="text-foreground truncate text-sm font-semibold">
                              {peerName}
                            </p>
                            {peer?.username && (
                              <p className="text-muted-foreground truncate text-xs">
                                @{peer.username}
                              </p>
                            )}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          className="text-destructive hover:bg-destructive-subtle"
                          aria-label={`${t("friends.removeFriend")} ${peerName}`}
                          onClick={() =>
                            setRemovingFriend({ id: item.id, name: peerName })
                          }
                        >
                          <UserMinus className="size-4" aria-hidden="true" />
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </TabsContent>

          <TabsContent value="incoming" className="mt-4">
            {incoming.length === 0 ? (
              <EmptyState
                icon={Users}
                title={t("friends.pendingRequests")}
                description={
                  vi
                    ? "Không có lời mời kết bạn nào đang chờ duyệt."
                    : "No incoming friend requests."
                }
              />
            ) : (
              <ul className="divide-border bg-card divide-y rounded-xl border">
                {incoming.map((item) => {
                  const peer = getPeerProfile(item, currentUserId);
                  const peerName = peer?.display_name ?? peer?.username ?? item.requester_id;
                  return (
                    <li
                      key={item.id}
                      className="flex flex-wrap items-center justify-between gap-3 p-4"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar className="size-9">
                          {peer?.avatar_url ? (
                            <AvatarImage src={peer.avatar_url} alt={peerName} />
                          ) : null}
                          <AvatarFallback>{getInitials(peer)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="text-foreground truncate text-sm font-semibold">
                            {peerName}
                          </p>
                          {peer?.username && (
                            <p className="text-muted-foreground text-xs">
                              @{peer.username}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          disabled={respondMutation.isPending}
                          aria-label={`${t("friends.accept")} ${peerName}`}
                          onClick={() =>
                            respondMutation.mutate({ id: item.id, action: "accept" })
                          }
                        >
                          <Check className="size-3.5" aria-hidden="true" />
                          <span>{t("friends.accept")}</span>
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={respondMutation.isPending}
                          aria-label={`${t("friends.decline")} ${peerName}`}
                          onClick={() =>
                            respondMutation.mutate({ id: item.id, action: "decline" })
                          }
                        >
                          <X className="size-3.5" aria-hidden="true" />
                          <span>{t("friends.decline")}</span>
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </TabsContent>

          <TabsContent value="outgoing" className="mt-4">
            {outgoing.length === 0 ? (
              <EmptyState
                icon={Users}
                title={t("friends.sentRequests")}
                description={
                  vi
                    ? "Bạn chưa gửi lời mời kết bạn nào đang chờ phản hồi."
                    : "No pending outgoing friend requests."
                }
              />
            ) : (
              <ul className="divide-border bg-card divide-y rounded-xl border">
                {outgoing.map((item) => {
                  const peer = getPeerProfile(item, currentUserId);
                  const peerName = peer?.display_name ?? peer?.username ?? item.addressee_id;
                  return (
                    <li
                      key={item.id}
                      className="flex items-center justify-between gap-3 p-4"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar className="size-9">
                          {peer?.avatar_url ? (
                            <AvatarImage src={peer.avatar_url} alt={peerName} />
                          ) : null}
                          <AvatarFallback>{getInitials(peer)}</AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <p className="text-foreground truncate text-sm font-semibold">
                            {peerName}
                          </p>
                          <Badge variant="secondary" className="mt-0.5">
                            {vi ? "Đang chờ" : "Pending"}
                          </Badge>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={removeMutation.isPending}
                        aria-label={`${t("common.cancel")} ${peerName}`}
                        onClick={() =>
                          setRemovingFriend({
                            id: item.id,
                            name: peerName,
                            isOutgoing: true,
                          })
                        }
                      >
                        {t("common.cancel")}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </TabsContent>
        </Tabs>
      )}

      {/* Confirm Remove Friend / Cancel Request (fixes SH-037 / AN-02) */}
      <AlertDialog
        open={Boolean(removingFriend)}
        onOpenChange={(o) => !o && setRemovingFriend(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {removingFriend?.isOutgoing
                ? vi
                  ? `Hủy lời mời đã gửi tới ${removingFriend.name}?`
                  : `Cancel request sent to ${removingFriend.name}?`
                : vi
                  ? `Hủy kết bạn với ${removingFriend?.name ?? ""}?`
                  : `Remove ${removingFriend?.name ?? ""} from friends?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {removingFriend?.isOutgoing
                ? vi
                  ? "Người nhận sẽ không còn thấy lời mời kết bạn này nữa."
                  : "They will no longer see your pending friend request."
                : vi
                  ? "Bạn luôn có thể gửi lại lời mời kết bạn sau nếu muốn."
                  : "You can always send a new friend request later."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel autoFocus>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={removeMutation.isPending}
              onClick={() =>
                removingFriend && removeMutation.mutate(removingFriend.id)
              }
            >
              {removingFriend?.isOutgoing
                ? t("common.confirm")
                : t("friends.removeFriend")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </FadeIn>
  );
}
