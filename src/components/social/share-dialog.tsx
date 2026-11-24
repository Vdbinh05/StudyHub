"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Copy,
  Globe,
  Link2,
  Loader2,
  Lock,
  Plus,
  Trash2,
  UserPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import {
  apiFetch,
  copyToClipboard,
  formatShortDate,
  getFriendlyErrorMessage,
} from "@/components/layout/api-client";
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
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/lib/i18n";
import type {
  SharePermission,
  StudySet,
  StudySetMember,
  StudySetShareLink,
  Visibility,
} from "@/types/domain";

interface ShareDialogProps {
  studySet: Pick<StudySet, "id" | "title" | "visibility">;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ShareDialog({ studySet, open, onOpenChange }: ShareDialogProps) {
  const { locale, t } = useI18n();
  const vi = locale === "vi";
  const queryClient = useQueryClient();

  const [visibilityOverride, setVisibilityOverride] = React.useState<{
    setId: string;
    value: Visibility;
  } | null>(null);
  const visibility =
    visibilityOverride?.setId === studySet.id
      ? visibilityOverride.value
      : studySet.visibility;
  const setVisibility = (value: Visibility) =>
    setVisibilityOverride({ setId: studySet.id, value });

  const [identifier, setIdentifier] = React.useState("");
  const [inviteRole, setInviteRole] = React.useState<SharePermission>("viewer");
  const [linkPermission, setLinkPermission] = React.useState<SharePermission>("viewer");
  const [allowClone, setAllowClone] = React.useState(true);
  const [copiedId, setCopiedId] = React.useState<string | null>(null);

  const [revokingLink, setRevokingLink] = React.useState<StudySetShareLink | null>(null);
  const [removingMember, setRemovingMember] = React.useState<{
    userId: string;
    name: string;
  } | null>(null);

  const membersQuery = useQuery<StudySetMember[]>({
    queryKey: ["set-members", studySet.id],
    enabled: open,
    queryFn: async () => {
      const res = await apiFetch<
        StudySetMember[] | { owner?: unknown; members?: StudySetMember[] }
      >(`/api/sets/${studySet.id}/members`);
      if (Array.isArray(res.data)) return res.data;
      return Array.isArray(res.data?.members) ? res.data.members : [];
    },
  });

  const linksQuery = useQuery<StudySetShareLink[]>({
    queryKey: ["set-share-links", studySet.id],
    enabled: open,
    queryFn: async () => {
      const res = await apiFetch<StudySetShareLink[]>(
        `/api/sets/${studySet.id}/share-links`,
      );
      return Array.isArray(res.data) ? res.data : [];
    },
  });

  const visibilityMutation = useMutation({
    mutationFn: async (next: Visibility) => {
      await apiFetch(`/api/sets/${studySet.id}`, {
        method: "PATCH",
        body: JSON.stringify({ visibility: next }),
      });
    },
    onSuccess: (_, next) => {
      setVisibility(next);
      queryClient.invalidateQueries({ queryKey: ["study-set", studySet.id] });
      queryClient.invalidateQueries({ queryKey: ["study-sets"] });
      toast.success(
        vi ? "Đã cập nhật quyền hiển thị." : "Visibility updated.",
      );
    },
    onError: (err) => {
      toast.error(getFriendlyErrorMessage(err, locale));
    },
  });

  const addMemberMutation = useMutation({
    mutationFn: async () => {
      await apiFetch(`/api/sets/${studySet.id}/members`, {
        method: "POST",
        body: JSON.stringify({ identifier: identifier.trim(), role: inviteRole }),
      });
    },
    onSuccess: () => {
      setIdentifier("");
      queryClient.invalidateQueries({ queryKey: ["set-members", studySet.id] });
      toast.success(vi ? "Đã thêm thành viên." : "Member added.");
    },
    onError: (err) => {
      toast.error(getFriendlyErrorMessage(err, locale));
    },
  });

  const updateMemberMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: SharePermission }) => {
      await apiFetch(`/api/sets/${studySet.id}/members/${userId}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["set-members", studySet.id] });
      toast.success(vi ? "Đã cập nhật vai trò." : "Role updated.");
    },
    onError: (err) => {
      toast.error(getFriendlyErrorMessage(err, locale));
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: async (userId: string) => {
      await apiFetch(`/api/sets/${studySet.id}/members/${userId}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      setRemovingMember(null);
      queryClient.invalidateQueries({ queryKey: ["set-members", studySet.id] });
      toast.success(vi ? "Đã xóa thành viên." : "Member removed.");
    },
    onError: (err) => {
      toast.error(getFriendlyErrorMessage(err, locale));
    },
  });

  const createLinkMutation = useMutation({
    mutationFn: async () => {
      await apiFetch(`/api/sets/${studySet.id}/share-links`, {
        method: "POST",
        body: JSON.stringify({
          permission: linkPermission,
          allow_clone: allowClone,
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["set-share-links", studySet.id] });
      toast.success(vi ? "Đã tạo liên kết chia sẻ." : "Share link created.");
    },
    onError: (err) => {
      toast.error(getFriendlyErrorMessage(err, locale));
    },
  });

  const revokeLinkMutation = useMutation({
    mutationFn: async (linkId: string) => {
      await apiFetch(`/api/sets/${studySet.id}/share-links/${linkId}`, {
        method: "DELETE",
      });
    },
    onSuccess: () => {
      setRevokingLink(null);
      queryClient.invalidateQueries({ queryKey: ["set-share-links", studySet.id] });
      toast.success(vi ? "Đã thu hồi liên kết." : "Share link revoked.");
    },
    onError: (err) => {
      toast.error(getFriendlyErrorMessage(err, locale));
    },
  });

  const handleCopyLink = async (link: StudySetShareLink) => {
    const url = `${window.location.origin}/share/${link.token}`;
    const ok = await copyToClipboard(url);
    if (ok) {
      setCopiedId(link.id);
      toast.success(t("common.copied"));
      setTimeout(() => setCopiedId((prev) => (prev === link.id ? null : prev)), 2000);
    }
  };

  const activeLinks = (linksQuery.data ?? []).filter((l) => !l.revoked_at);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[88dvh] overflow-y-auto overscroll-contain sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{t("friends.shareSet")}</DialogTitle>
            <DialogDescription className="truncate">{studySet.title}</DialogDescription>
          </DialogHeader>

          {/* Visibility Control */}
          <div className="space-y-2">
            <Label htmlFor="share-visibility">
              {vi ? "Chế độ hiển thị" : "Visibility"}
            </Label>
            <Select
              value={visibility}
              onValueChange={(val) => visibilityMutation.mutate(val as Visibility)}
              disabled={visibilityMutation.isPending}
            >
              <SelectTrigger id="share-visibility">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="private">
                  <span className="inline-flex items-center gap-2">
                    <Lock className="size-3.5" aria-hidden="true" />
                    {t("library.visibilityPrivate")}
                  </span>
                </SelectItem>
                <SelectItem value="shared">
                  <span className="inline-flex items-center gap-2">
                    <Users className="size-3.5" aria-hidden="true" />
                    {t("library.visibilityShared")}
                  </span>
                </SelectItem>
                <SelectItem value="unlisted">
                  <span className="inline-flex items-center gap-2">
                    <Link2 className="size-3.5" aria-hidden="true" />
                    {t("library.visibilityUnlisted")}
                  </span>
                </SelectItem>
                <SelectItem value="public">
                  <span className="inline-flex items-center gap-2">
                    <Globe className="size-3.5" aria-hidden="true" />
                    {t("library.visibilityPublic")}
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Separator />

          <Tabs defaultValue="links">
            <TabsList className="w-full">
              <TabsTrigger value="links">
                <Link2 className="size-3.5" aria-hidden="true" />
                <span>{t("friends.shareLink")}</span>
              </TabsTrigger>
              <TabsTrigger value="members">
                <Users className="size-3.5" aria-hidden="true" />
                <span>
                  {vi ? "Thành viên" : "Members"} ({membersQuery.data?.length ?? 0})
                </span>
              </TabsTrigger>
            </TabsList>

            {/* Share Links Tab */}
            <TabsContent value="links" className="mt-3 space-y-4">
              <div className="border-border bg-secondary/40 space-y-3 rounded-lg border p-3.5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="link-permission">
                      {vi ? "Quyền truy cập" : "Permission"}
                    </Label>
                    <Select
                      value={linkPermission}
                      onValueChange={(v) => setLinkPermission(v as SharePermission)}
                    >
                      <SelectTrigger id="link-permission">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="viewer">{t("friends.roleViewer")}</SelectItem>
                        <SelectItem value="editor">{t("friends.roleEditor")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-5">
                    <Label htmlFor="allow-clone-switch" className="cursor-pointer text-xs">
                      {vi ? "Cho phép nhân bản" : "Allow copy / clone"}
                    </Label>
                    <Switch
                      id="allow-clone-switch"
                      checked={allowClone}
                      onCheckedChange={setAllowClone}
                    />
                  </div>
                </div>

                <Button
                  size="sm"
                  className="w-full"
                  disabled={createLinkMutation.isPending}
                  onClick={() => createLinkMutation.mutate()}
                >
                  {createLinkMutation.isPending ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <Plus className="size-4" aria-hidden="true" />
                  )}
                  <span>{vi ? "Tạo liên kết chia sẻ mới" : "Generate new share link"}</span>
                </Button>
              </div>

              {linksQuery.isLoading ? (
                <p className="text-muted-foreground py-4 text-center text-xs">
                  {t("common.loading")}
                </p>
              ) : activeLinks.length === 0 ? (
                <p className="text-muted-foreground py-4 text-center text-xs">
                  {vi
                    ? "Chưa có liên kết chia sẻ đang hoạt động."
                    : "No active share links yet."}
                </p>
              ) : (
                <ul className="space-y-2">
                  {activeLinks.map((link) => {
                    const shortToken = link.token.slice(0, 12);
                    return (
                      <li
                        key={link.id}
                        className="border-border flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge variant="secondary">
                              {link.permission === "editor"
                                ? t("friends.roleEditor")
                                : t("friends.roleViewer")}
                            </Badge>
                            {link.allow_clone && (
                              <Badge variant="outline">
                                {vi ? "Cho sao chép" : "Cloneable"}
                              </Badge>
                            )}
                          </div>
                          <p className="text-muted-foreground font-mono text-[11px]">
                            /share/{shortToken}… · {formatShortDate(link.created_at, locale)}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            aria-label={`${t("friends.copyLink")} /share/${shortToken}`}
                            onClick={() => void handleCopyLink(link)}
                          >
                            {copiedId === link.id ? (
                              <Check className="size-3.5" aria-hidden="true" />
                            ) : (
                              <Copy className="size-3.5" aria-hidden="true" />
                            )}
                            <span>
                              {copiedId === link.id ? t("common.copied") : t("common.copy")}
                            </span>
                          </Button>
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            className="text-destructive hover:bg-destructive-subtle"
                            aria-label={`${t("friends.revokeLink")} /share/${shortToken}`}
                            disabled={revokeLinkMutation.isPending}
                            onClick={() => setRevokingLink(link)}
                          >
                            <Trash2 className="size-4" aria-hidden="true" />
                          </Button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </TabsContent>

            {/* Direct Members Tab */}
            <TabsContent value="members" className="mt-3 space-y-4">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (identifier.trim().length >= 2) {
                    addMemberMutation.mutate();
                  }
                }}
                className="flex flex-col gap-2 sm:flex-row"
              >
                <Input
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  spellCheck={false}
                  placeholder={
                    vi ? "Username hoặc email bạn bè..." : "Friend username or email..."
                  }
                  aria-label={vi ? "Username hoặc email" : "Username or email"}
                  className="flex-1"
                />
                <Select
                  value={inviteRole}
                  onValueChange={(v) => setInviteRole(v as SharePermission)}
                >
                  <SelectTrigger
                    className="w-full sm:w-32"
                    aria-label={vi ? "Vai trò" : "Role"}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="viewer">{t("friends.roleViewer")}</SelectItem>
                    <SelectItem value="editor">{t("friends.roleEditor")}</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  type="submit"
                  disabled={identifier.trim().length < 2 || addMemberMutation.isPending}
                >
                  {addMemberMutation.isPending ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  ) : (
                    <UserPlus className="size-4" aria-hidden="true" />
                  )}
                  <span>{t("common.add")}</span>
                </Button>
              </form>

              {membersQuery.isLoading ? (
                <p className="text-muted-foreground py-4 text-center text-xs">
                  {t("common.loading")}
                </p>
              ) : (membersQuery.data ?? []).length === 0 ? (
                <p className="text-muted-foreground py-4 text-center text-xs">
                  {vi ? "Chưa chia sẻ trực tiếp với ai." : "No direct collaborators yet."}
                </p>
              ) : (
                <ul className="divide-border divide-y rounded-lg border">
                  {(membersQuery.data ?? []).map((member) => {
                    const memberName =
                      member.profile?.display_name ??
                      member.profile?.username ??
                      member.user_id;
                    return (
                      <li
                        key={member.id}
                        className="flex items-center justify-between gap-2 p-3"
                      >
                        <div className="min-w-0">
                          <p className="text-foreground truncate text-sm font-medium">
                            {memberName}
                          </p>
                          {member.profile?.username && (
                            <p className="text-muted-foreground truncate text-xs">
                              @{member.profile.username}
                            </p>
                          )}
                        </div>
                        {member.role === "owner" ? (
                          <Badge variant="accent">{t("friends.roleOwner")}</Badge>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <Select
                              value={member.role}
                              onValueChange={(next) =>
                                updateMemberMutation.mutate({
                                  userId: member.user_id,
                                  role: next as SharePermission,
                                })
                              }
                            >
                              <SelectTrigger
                                className="h-8 w-28 text-xs"
                                aria-label={`${vi ? "Đổi vai trò của" : "Change role for"} ${memberName}`}
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="viewer">
                                  {t("friends.roleViewer")}
                                </SelectItem>
                                <SelectItem value="editor">
                                  {t("friends.roleEditor")}
                                </SelectItem>
                              </SelectContent>
                            </Select>
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              className="text-destructive hover:bg-destructive-subtle"
                              aria-label={`${vi ? "Gỡ quyền truy cập của" : "Remove collaborator"} ${memberName}`}
                              onClick={() =>
                                setRemovingMember({
                                  userId: member.user_id,
                                  name: memberName,
                                })
                              }
                            >
                              <Trash2 className="size-4" aria-hidden="true" />
                            </Button>
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {/* Confirm Revoke Share Link (fixes SH-037 / AN-02) */}
      <AlertDialog
        open={Boolean(revokingLink)}
        onOpenChange={(o) => !o && setRevokingLink(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {vi ? "Thu hồi liên kết chia sẻ này?" : "Revoke this share link?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {vi
                ? "Liên kết sẽ ngừng hoạt động ngay lập tức. Không ai mới có thể mở học phần bằng liên kết này nữa."
                : "This link will stop working immediately and can no longer be redeemed."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel autoFocus>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={revokeLinkMutation.isPending}
              onClick={() => revokingLink && revokeLinkMutation.mutate(revokingLink.id)}
            >
              {t("friends.revokeLink")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Confirm Remove Collaborator (fixes SH-037 / AN-02) */}
      <AlertDialog
        open={Boolean(removingMember)}
        onOpenChange={(o) => !o && setRemovingMember(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {vi
                ? `Gỡ quyền truy cập của ${removingMember?.name ?? ""}?`
                : `Remove ${removingMember?.name ?? ""} from this set?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {vi
                ? "Thành viên này sẽ không còn thấy hoặc chỉnh sửa được học phần của bạn."
                : "This person will lose access to view or edit your study set."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel autoFocus>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={removeMemberMutation.isPending}
              onClick={() =>
                removingMember && removeMemberMutation.mutate(removingMember.userId)
              }
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
