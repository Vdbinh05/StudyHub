"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ImagePlus,
  Loader2,
  Save,
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";
import type { Profile } from "@/types/domain";

interface UploadedAvatarResponse {
  path: string;
  signedUrl: string;
  proxyUrl?: string;
  mimeType: string;
  size: number;
}

const ALLOWED_AVATAR_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const USERNAME_REGEX = /^[a-z0-9_]{3,30}$/;

export function ProfileView() {
  const { locale, t } = useI18n();
  const vi = locale === "vi";
  const queryClient = useQueryClient();
  const configured = isSupabaseConfiguredClient();

  const [draft, setDraft] = React.useState<{
    displayName?: string;
    username?: string;
    bio?: string;
    avatarUrl?: string;
  }>({});
  const [uploadingAvatar, setUploadingAvatar] = React.useState(false);
  const [nameError, setNameError] = React.useState<string | null>(null);
  const [usernameError, setUsernameError] = React.useState<string | null>(null);

  const nameRef = React.useRef<HTMLInputElement>(null);
  const usernameRef = React.useRef<HTMLInputElement>(null);

  const profileQuery = useQuery<Profile>({
    queryKey: ["profile-detail"],
    enabled: configured,
    queryFn: async () => {
      const res = await apiFetch<Profile | { profile: Profile }>("/api/profile");
      const raw = res.data;
      if (raw && typeof raw === "object" && "profile" in raw) {
        return raw.profile;
      }
      return raw as Profile;
    },
  });

  const displayName = draft.displayName ?? profileQuery.data?.display_name ?? "";
  const username = draft.username ?? profileQuery.data?.username ?? "";
  const bio = draft.bio ?? profileQuery.data?.bio ?? "";
  const avatarUrl = draft.avatarUrl ?? profileQuery.data?.avatar_url ?? "";

  const setDisplayName = (val: string) => {
    setNameError(null);
    setDraft((prev) => ({ ...prev, displayName: val }));
  };
  const setUsername = (val: string) => {
    setUsernameError(null);
    setDraft((prev) => ({ ...prev, username: val }));
  };
  const setBio = (val: string) => setDraft((prev) => ({ ...prev, bio: val }));
  const setAvatarUrl = (val: string) =>
    setDraft((prev) => ({ ...prev, avatarUrl: val }));

  const updateMutation = useMutation({
    mutationFn: async () => {
      const trimmedUsername = username.trim().toLowerCase();
      const res = await apiFetch<Profile>("/api/profile", {
        method: "PATCH",
        body: JSON.stringify({
          display_name: displayName.trim(),
          username: trimmedUsername || null,
          bio: bio.trim() || null,
          avatar_url: avatarUrl.trim() || null,
        }),
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile-detail"] });
      queryClient.invalidateQueries({ queryKey: ["current-profile"] });
      toast.success(t("settings.savedSuccess"));
    },
    onError: (err) => {
      toast.error(getFriendlyErrorMessage(err, locale));
    },
  });

  // Server-validated avatar upload via POST /api/uploads/image (fixes SH-019 / BUG-004)
  const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (!ALLOWED_AVATAR_MIME.has(file.type)) {
      toast.error(
        vi
          ? "Chỉ chấp nhận ảnh PNG, JPEG, WebP hoặc GIF (không hỗ trợ SVG)."
          : "Only PNG, JPEG, WebP, or GIF images are allowed.",
      );
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      toast.error(vi ? "Ảnh vượt quá 5 MB." : "Image exceeds 5 MB limit.");
      return;
    }

    setUploadingAvatar(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("purpose", "avatar");

      const res = await apiFetch<UploadedAvatarResponse>("/api/uploads/image", {
        method: "POST",
        body: formData,
      });
      const resolvedUrl =
        res.data?.proxyUrl ?? res.data?.signedUrl ?? res.data?.path ?? "";
      if (!resolvedUrl) {
        throw new Error(t("common.errorGeneric"));
      }
      setAvatarUrl(resolvedUrl);
      toast.success(
        vi
          ? "Đã tải ảnh đại diện. Nhấn Lưu thay đổi để áp dụng."
          : "Avatar uploaded. Click Save changes to apply.",
      );
    } catch (err) {
      toast.error(getFriendlyErrorMessage(err, locale));
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setNameError(null);
    setUsernameError(null);

    if (!displayName.trim()) {
      setNameError(
        vi ? "Vui lòng nhập tên hiển thị." : "Display name is required.",
      );
      nameRef.current?.focus();
      return;
    }

    const trimmedUsername = username.trim().toLowerCase();
    if (trimmedUsername && !USERNAME_REGEX.test(trimmedUsername)) {
      setUsernameError(
        vi
          ? "Username chỉ gồm chữ thường a-z, số 0-9 và dấu gạch dưới _ (3–30 ký tự)."
          : "Username must be 3–30 lowercase letters, numbers, or underscores.",
      );
      usernameRef.current?.focus();
      return;
    }

    updateMutation.mutate();
  };

  if (!configured) {
    return (
      <FadeIn aboveFold className="mx-auto max-w-2xl space-y-6">
        <PageHeader title={t("settings.profileTab")} />
        <EmptyState
          icon={AlertCircle}
          title={vi ? "Chưa thể tải hồ sơ cá nhân" : "Profile unavailable"}
          description={t("common.serviceUnavailableDesc")}
        />
      </FadeIn>
    );
  }

  if (profileQuery.isLoading) {
    return <Skeleton className="mx-auto h-96 max-w-2xl rounded-xl" />;
  }

  if (profileQuery.error || !profileQuery.data) {
    return (
      <EmptyState
        icon={AlertCircle}
        title={vi ? "Không thể tải hồ sơ cá nhân" : "Unable to load profile"}
        description={getFriendlyErrorMessage(profileQuery.error, locale)}
        action={
          <Button onClick={() => void profileQuery.refetch()}>
            {t("common.retry")}
          </Button>
        }
      />
    );
  }

  const initials = (displayName || profileQuery.data.email || "U")
    .trim()
    .slice(0, 2)
    .toUpperCase();

  return (
    <FadeIn aboveFold className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title={t("settings.profileTab")}
        description={
          vi
            ? "Thông tin hiển thị của bạn khi kết bạn và chia sẻ học phần trên StudyHub."
            : "Your public display name and username used when connecting with friends and sharing sets."
        }
      />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {vi ? "Thông tin cá nhân" : "Personal Details"}
          </CardTitle>
          {profileQuery.data.email && (
            <CardDescription>{profileQuery.data.email}</CardDescription>
          )}
        </CardHeader>

        <CardContent>
          <form onSubmit={handleSubmit} noValidate className="space-y-5">
            {/* Avatar Preview + Upload */}
            <div className="flex flex-wrap items-center gap-4">
              <Avatar className="size-16 border">
                {avatarUrl ? (
                  <AvatarImage src={avatarUrl} alt={displayName} />
                ) : null}
                <AvatarFallback className="bg-primary/10 text-primary text-lg font-semibold">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    asChild
                    disabled={uploadingAvatar}
                  >
                    <label className="cursor-pointer">
                      {uploadingAvatar ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <ImagePlus className="size-4" aria-hidden="true" />
                      )}
                      <span>{vi ? "Tải ảnh đại diện" : "Upload avatar"}</span>
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        className="sr-only"
                        onChange={(e) => void handleAvatarUpload(e)}
                      />
                    </label>
                  </Button>
                  {avatarUrl && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setAvatarUrl("")}
                    >
                      {vi ? "Gỡ ảnh" : "Remove"}
                    </Button>
                  )}
                </div>
                <p className="text-muted-foreground text-xs">
                  PNG, JPG, WebP, GIF · {vi ? "Tối đa 5 MB" : "Max 5 MB"}
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="profile-avatar-url">
                {vi ? "Hoặc dán URL ảnh đại diện" : "Or avatar image URL"}
              </Label>
              <Input
                id="profile-avatar-url"
                type="url"
                placeholder="https://..."
                value={avatarUrl}
                onChange={(e) => setAvatarUrl(e.target.value)}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="profile-display-name">
                  {t("auth.displayName")}
                </Label>
                <Input
                  ref={nameRef}
                  id="profile-display-name"
                  required
                  maxLength={100}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  aria-invalid={nameError ? "true" : "false"}
                  aria-describedby={nameError ? "profile-name-error" : undefined}
                />
                {nameError && (
                  <p
                    id="profile-name-error"
                    role="alert"
                    className="text-destructive text-xs font-medium"
                  >
                    {nameError}
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="profile-username">{t("auth.username")}</Label>
                <Input
                  ref={usernameRef}
                  id="profile-username"
                  spellCheck={false}
                  autoCapitalize="none"
                  autoCorrect="off"
                  maxLength={30}
                  placeholder="minh_study"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  aria-invalid={usernameError ? "true" : "false"}
                  aria-describedby={
                    usernameError
                      ? "profile-username-hint profile-username-error"
                      : "profile-username-hint"
                  }
                />
                <p id="profile-username-hint" className="text-muted-foreground text-xs">
                  {vi
                    ? "3–30 ký tự chữ thường (a-z), số và dấu gạch dưới (_)."
                    : "3–30 lowercase letters, numbers, and underscores."}
                </p>
                {usernameError && (
                  <p
                    id="profile-username-error"
                    role="alert"
                    className="text-destructive text-xs font-medium"
                  >
                    {usernameError}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="profile-bio">
                {vi ? "Giới thiệu ngắn" : "Short bio"}
              </Label>
              <Textarea
                id="profile-bio"
                rows={3}
                maxLength={300}
                placeholder={
                  vi
                    ? "VD: Sinh viên năm 3 đang ôn thi môn chuyên ngành..."
                    : "e.g., CS student preparing for finals..."
                }
                value={bio}
                onChange={(e) => setBio(e.target.value)}
              />
            </div>

            <div className="flex justify-end">
              <Button type="submit" disabled={updateMutation.isPending}>
                {updateMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Save className="size-4" aria-hidden="true" />
                )}
                <span>{t("settings.saveChanges")}</span>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </FadeIn>
  );
}
