"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import {
  AlertTriangle,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Save,
  Trash2,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/components/layout/api-client";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useI18n } from "@/lib/i18n";
import { tryCreateClient } from "@/lib/supabase/client";
import type { Locale, ThemePreference, UserPreferences } from "@/types/domain";

export function SettingsView() {
  const { locale, setLocale, t } = useI18n();
  const vi = locale === "vi";
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [prefDraft, setPrefDraft] = React.useState<{
    language?: Locale;
    theme?: ThemePreference;
    daily_goal?: number;
    default_shuffle_questions?: boolean;
    default_shuffle_options?: boolean;
    show_instant_feedback?: boolean;
    sound_effects?: boolean;
    reduced_motion?: boolean;
  }>({});

  // Password change
  const [newPassword, setNewPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [updatingPassword, setUpdatingPassword] = React.useState(false);

  // Export & Delete data
  const [exportingData, setExportingData] = React.useState(false);
  const [deleteScope, setDeleteScope] = React.useState<"study_data" | "account" | null>(
    null,
  );
  const [confirmPhrase, setConfirmPhrase] = React.useState("");

  const prefsQuery = useQuery<UserPreferences | null>({
    queryKey: ["user-preferences"],
    queryFn: async () => {
      try {
        const res = await apiFetch<UserPreferences>("/api/preferences");
        return res.data;
      } catch {
        return null;
      }
    },
  });

  const prefLang = prefDraft.language ?? prefsQuery.data?.language ?? locale;
  const prefTheme =
    prefDraft.theme ??
    prefsQuery.data?.theme ??
    ((theme as ThemePreference) || "system");
  const dailyGoal = prefDraft.daily_goal ?? prefsQuery.data?.daily_goal ?? 20;
  const shuffleQuestions =
    prefDraft.default_shuffle_questions ??
    prefsQuery.data?.default_shuffle_questions ??
    false;
  const shuffleOptions =
    prefDraft.default_shuffle_options ??
    prefsQuery.data?.default_shuffle_options ??
    true;
  const instantFeedback =
    prefDraft.show_instant_feedback ??
    prefsQuery.data?.show_instant_feedback ??
    true;
  const soundEffects =
    prefDraft.sound_effects ?? prefsQuery.data?.sound_effects ?? false;
  const reducedMotion =
    prefDraft.reduced_motion ?? prefsQuery.data?.reduced_motion ?? false;

  const setPrefLang = (v: Locale) => setPrefDraft((p) => ({ ...p, language: v }));
  const setPrefTheme = (v: ThemePreference) =>
    setPrefDraft((p) => ({ ...p, theme: v }));
  const setDailyGoal = (v: number) => setPrefDraft((p) => ({ ...p, daily_goal: v }));
  const setShuffleQuestions = (v: boolean) =>
    setPrefDraft((p) => ({ ...p, default_shuffle_questions: v }));
  const setShuffleOptions = (v: boolean) =>
    setPrefDraft((p) => ({ ...p, default_shuffle_options: v }));
  const setInstantFeedback = (v: boolean) =>
    setPrefDraft((p) => ({ ...p, show_instant_feedback: v }));
  const setSoundEffects = (v: boolean) =>
    setPrefDraft((p) => ({ ...p, sound_effects: v }));
  const setReducedMotion = (v: boolean) =>
    setPrefDraft((p) => ({ ...p, reduced_motion: v }));

  const savePrefsMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        language: prefLang,
        theme: prefTheme,
        daily_goal: Math.max(1, Math.min(500, dailyGoal)),
        default_shuffle_questions: shuffleQuestions,
        default_shuffle_options: shuffleOptions,
        show_instant_feedback: instantFeedback,
        sound_effects: soundEffects,
        reduced_motion: reducedMotion,
      };
      await apiFetch("/api/preferences", {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      return payload;
    },
    onSuccess: (saved) => {
      setLocale(saved.language);
      setTheme(saved.theme);
      queryClient.invalidateQueries({ queryKey: ["user-preferences"] });
      toast.success(t("settings.savedSuccess"));
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : t("common.errorGeneric"));
    },
  });

  const handlePasswordUpdate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (newPassword.length < 8) {
      toast.error(
        vi
          ? "Mật khẩu mới cần ít nhất 8 ký tự."
          : "New password must be at least 8 characters.",
      );
      return;
    }
    const supabase = tryCreateClient();
    if (!supabase) {
      toast.error(
        vi ? "Supabase chưa được cấu hình." : "Supabase is not configured.",
      );
      return;
    }
    setUpdatingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        toast.error(error.message);
        return;
      }
      setNewPassword("");
      toast.success(
        vi ? "Đã đổi mật khẩu thành công." : "Password updated successfully.",
      );
    } catch {
      toast.error(t("common.errorGeneric"));
    } finally {
      setUpdatingPassword(false);
    }
  };

  const handleExportPersonalData = async () => {
    setExportingData(true);
    try {
      const res = await apiFetch<unknown>("/api/account/data");
      const blob = new Blob([JSON.stringify(res.data, null, 2)], {
        type: "application/json;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `studyhub-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      toast.success(
        vi ? "Đã tải xuống bản sao dữ liệu cá nhân." : "Personal data export downloaded.",
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("common.errorGeneric"));
    } finally {
      setExportingData(false);
    }
  };

  const deleteDataMutation = useMutation({
    mutationFn: async (scope: "study_data" | "account") => {
      await apiFetch("/api/account/data", {
        method: "DELETE",
        body: JSON.stringify({
          confirm: "DELETE_MY_DATA",
          scope,
        }),
      });
      return scope;
    },
    onSuccess: async (scope) => {
      setDeleteScope(null);
      setConfirmPhrase("");
      queryClient.clear();
      if (scope === "account") {
        await fetch("/auth/signout", { method: "POST", credentials: "same-origin" });
        toast.success(vi ? "Đã xóa dữ liệu và đăng xuất." : "Account data cleared and signed out.");
        router.push("/login");
      } else {
        toast.success(vi ? "Đã xóa toàn bộ dữ liệu học tập." : "All study data deleted.");
        router.refresh();
      }
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : t("common.errorGeneric"));
    },
  });

  return (
    <FadeIn className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title={t("settings.title")}
        description={t("settings.subtitle")}
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/profile">
              <User className="size-4" aria-hidden="true" />
              <span>{t("settings.profileTab")}</span>
            </Link>
          </Button>
        }
      />

      <Tabs defaultValue="preferences">
        <TabsList>
          <TabsTrigger value="preferences">{t("settings.preferencesTab")}</TabsTrigger>
          <TabsTrigger value="account">{t("settings.accountTab")}</TabsTrigger>
        </TabsList>

        <TabsContent value="preferences" className="mt-4">
          {prefsQuery.isLoading ? (
            <Skeleton className="h-80 w-full rounded-xl" />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {vi ? "Giao diện, Ngôn ngữ & Tùy chọn học tập" : "Appearance, Language & Study Defaults"}
                </CardTitle>
                <CardDescription>
                  {vi
                    ? "Nội dung câu hỏi và flashcard của bạn luôn giữ nguyên ngôn ngữ gốc, không tự động dịch."
                    : "Your study questions and flashcards are never auto-translated when switching UI language."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    savePrefsMutation.mutate();
                  }}
                  className="space-y-5"
                >
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="pref-language">{t("settings.language")}</Label>
                      <Select
                        value={prefLang}
                        onValueChange={(v) => {
                          const next = v as Locale;
                          setPrefLang(next);
                          setLocale(next);
                        }}
                      >
                        <SelectTrigger id="pref-language">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="vi">{t("settings.languageVi")}</SelectItem>
                          <SelectItem value="en">{t("settings.languageEn")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="pref-theme">{t("settings.theme")}</Label>
                      <Select
                        value={prefTheme}
                        onValueChange={(v) => {
                          const next = v as ThemePreference;
                          setPrefTheme(next);
                          setTheme(next);
                        }}
                      >
                        <SelectTrigger id="pref-theme">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="light">{t("settings.themeLight")}</SelectItem>
                          <SelectItem value="dark">{t("settings.themeDark")}</SelectItem>
                          <SelectItem value="system">{t("settings.themeSystem")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-1.5 sm:max-w-xs">
                    <Label htmlFor="pref-daily-goal">{t("settings.dailyGoal")}</Label>
                    <Input
                      id="pref-daily-goal"
                      type="number"
                      min={1}
                      max={500}
                      value={dailyGoal}
                      onChange={(e) => setDailyGoal(Number(e.target.value) || 20)}
                    />
                  </div>

                  <Separator />

                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-4">
                      <Label htmlFor="pref-shuffle-q" className="cursor-pointer font-normal">
                        {t("settings.defaultShuffleQuestions")}
                      </Label>
                      <Switch
                        id="pref-shuffle-q"
                        checked={shuffleQuestions}
                        onCheckedChange={setShuffleQuestions}
                      />
                    </div>

                    <div className="flex items-center justify-between gap-4">
                      <Label htmlFor="pref-shuffle-o" className="cursor-pointer font-normal">
                        {t("settings.defaultShuffleOptions")}
                      </Label>
                      <Switch
                        id="pref-shuffle-o"
                        checked={shuffleOptions}
                        onCheckedChange={setShuffleOptions}
                      />
                    </div>

                    <div className="flex items-center justify-between gap-4">
                      <Label htmlFor="pref-feedback" className="cursor-pointer font-normal">
                        {t("settings.showExplanationImmediately")}
                      </Label>
                      <Switch
                        id="pref-feedback"
                        checked={instantFeedback}
                        onCheckedChange={setInstantFeedback}
                      />
                    </div>

                    <div className="flex items-center justify-between gap-4">
                      <Label htmlFor="pref-sound" className="cursor-pointer font-normal">
                        {t("settings.soundEffects")}
                      </Label>
                      <Switch
                        id="pref-sound"
                        checked={soundEffects}
                        onCheckedChange={setSoundEffects}
                      />
                    </div>

                    <div className="flex items-center justify-between gap-4">
                      <Label htmlFor="pref-motion" className="cursor-pointer font-normal">
                        {t("settings.reducedMotion")}
                      </Label>
                      <Switch
                        id="pref-motion"
                        checked={reducedMotion}
                        onCheckedChange={setReducedMotion}
                      />
                    </div>
                  </div>

                  <div className="flex justify-end pt-2">
                    <Button type="submit" disabled={savePrefsMutation.isPending}>
                      {savePrefsMutation.isPending ? (
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
          )}
        </TabsContent>

        <TabsContent value="account" className="mt-4 space-y-6">
          {/* Change Password */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <KeyRound className="size-4" aria-hidden="true" />
                <span>{vi ? "Đổi mật khẩu" : "Change Password"}</span>
              </CardTitle>
              <CardDescription>
                {vi
                  ? "Cập nhật mật khẩu mới cho phiên đăng nhập hiện tại của bạn."
                  : "Update the password for your current StudyHub account."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handlePasswordUpdate} className="space-y-4">
                <div className="space-y-1.5 sm:max-w-md">
                  <Label htmlFor="settings-new-password">
                    {vi ? "Mật khẩu mới" : "New password"}
                  </Label>
                  <p className="text-muted-foreground text-xs">
                    {vi ? "Tối thiểu 8 ký tự." : "At least 8 characters."}
                  </p>
                  <div className="relative">
                    <Input
                      id="settings-new-password"
                      name="new-password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      minLength={8}
                      required
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((prev) => !prev)}
                      aria-pressed={showPassword}
                      aria-label={
                        showPassword
                          ? vi
                            ? "Ẩn mật khẩu"
                            : "Hide password"
                          : vi
                            ? "Hiện mật khẩu"
                            : "Show password"
                      }
                      className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2 rounded-md p-1"
                    >
                      {showPassword ? (
                        <EyeOff className="size-4" aria-hidden="true" />
                      ) : (
                        <Eye className="size-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                </div>
                <Button type="submit" disabled={updatingPassword || newPassword.length < 8}>
                  {updatingPassword && (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  )}
                  <span>{vi ? "Cập nhật mật khẩu" : "Update password"}</span>
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Export Personal Data */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {vi ? "Xuất dữ liệu cá nhân" : "Export Personal Data"}
              </CardTitle>
              <CardDescription>
                {vi
                  ? "Tải xuống toàn bộ thư mục, học phần, câu hỏi và lịch sử học tập dưới định dạng JSON."
                  : "Download a portable JSON archive of your folders, study sets, questions, and study history."}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button
                variant="outline"
                disabled={exportingData}
                onClick={() => void handleExportPersonalData()}
              >
                {exportingData ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Download className="size-4" aria-hidden="true" />
                )}
                <span>{vi ? "Tải xuống bản sao JSON" : "Download JSON backup"}</span>
              </Button>
            </CardContent>
          </Card>

          {/* Danger Zone */}
          <Card className="border-destructive/40">
            <CardHeader>
              <CardTitle className="text-destructive flex items-center gap-2 text-base">
                <AlertTriangle className="size-4" aria-hidden="true" />
                <span>{vi ? "Vùng nguy hiểm" : "Danger Zone"}</span>
              </CardTitle>
              <CardDescription>
                {vi
                  ? "Các thao tác bên dưới sẽ xóa vĩnh viễn dữ liệu khỏi cơ sở dữ liệu và không thể hoàn tác."
                  : "Actions below permanently delete your data from the database and cannot be undone."}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Button
                variant="outline"
                className="text-destructive border-destructive/40 hover:bg-destructive-subtle"
                onClick={() => {
                  setConfirmPhrase("");
                  setDeleteScope("study_data");
                }}
              >
                <Trash2 className="size-4" aria-hidden="true" />
                <span>{vi ? "Xóa dữ liệu học tập" : "Clear study data"}</span>
              </Button>

              <Button
                variant="destructive"
                onClick={() => {
                  setConfirmPhrase("");
                  setDeleteScope("account");
                }}
              >
                <Trash2 className="size-4" aria-hidden="true" />
                <span>{vi ? "Xóa toàn bộ tài khoản & dữ liệu" : "Delete account & all data"}</span>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Typed Confirmation Dialog */}
      <AlertDialog
        open={Boolean(deleteScope)}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteScope(null);
            setConfirmPhrase("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteScope === "account"
                ? vi
                  ? "Xác nhận xóa tài khoản và toàn bộ dữ liệu?"
                  : "Confirm account and data deletion?"
                : vi
                  ? "Xác nhận xóa toàn bộ dữ liệu học tập?"
                  : "Confirm study data deletion?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {vi
                ? 'Hành động này không thể hoàn tác. Hãy gõ chính xác "DELETE_MY_DATA" vào ô bên dưới để xác nhận.'
                : 'This action cannot be undone. Type "DELETE_MY_DATA" below to confirm.'}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <Input
            value={confirmPhrase}
            onChange={(e) => setConfirmPhrase(e.target.value)}
            placeholder="DELETE_MY_DATA"
            spellCheck={false}
            aria-label="DELETE_MY_DATA"
          />

          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={confirmPhrase !== "DELETE_MY_DATA" || deleteDataMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                if (deleteScope && confirmPhrase === "DELETE_MY_DATA") {
                  deleteDataMutation.mutate(deleteScope);
                }
              }}
            >
              {deleteDataMutation.isPending && (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              )}
              <span>{t("common.confirm")}</span>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </FadeIn>
  );
}
