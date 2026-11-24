"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Save,
  Trash2,
  Upload,
  User,
} from "lucide-react";
import { toast } from "sonner";
import {
  apiFetch,
  getFriendlyErrorMessage,
  isServiceUnavailableError,
  isSupabaseConfiguredClient,
} from "@/components/layout/api-client";
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
import { useUserPreferences } from "@/lib/preferences";
import { tryCreateClient } from "@/lib/supabase/client";
import type { Locale, ThemePreference } from "@/types/domain";

interface RestoreSummary {
  restored?: {
    folders?: number;
    sets?: number;
    study_sets?: number;
    questions?: number;
  };
}

interface ParsedBackupPreview {
  fileName: string;
  payload: Record<string, unknown>;
  foldersCount: number;
  setsCount: number;
  questionsCount: number;
}

function clampGoal(raw: string): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return 20;
  return Math.max(1, Math.min(500, parsed));
}

export function SettingsView() {
  const { locale, setLocale, t } = useI18n();
  const vi = locale === "vi";
  const { setTheme } = useTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const configured = isSupabaseConfiguredClient();

  const {
    preferences,
    isLoading: prefsLoading,
    isSaving: prefsSaving,
    updatePreferences,
    playFeedbackSound,
  } = useUserPreferences();

  const [dailyGoalOverride, setDailyGoalOverride] = React.useState<string | null>(
    null,
  );
  const dailyGoalDraft = dailyGoalOverride ?? String(preferences.daily_goal);

  const prefLang: Locale = preferences.language;
  const prefTheme: ThemePreference = preferences.theme;
  const shuffleQuestions = preferences.default_shuffle_questions;
  const shuffleOptions = preferences.default_shuffle_options;
  const instantFeedback = preferences.show_instant_feedback;
  const soundEffects = preferences.sound_effects;
  const reducedMotion = preferences.reduced_motion;

  // Password change
  const [newPassword, setNewPassword] = React.useState("");
  const [passwordError, setPasswordError] = React.useState<string | null>(null);
  const [showPassword, setShowPassword] = React.useState(false);
  const [updatingPassword, setUpdatingPassword] = React.useState(false);
  const passwordInputRef = React.useRef<HTMLInputElement>(null);

  // Export, Restore & Delete data
  const [exportingData, setExportingData] = React.useState(false);
  const [backupPreview, setBackupPreview] = React.useState<ParsedBackupPreview | null>(
    null,
  );
  const [restoreConfirmOpen, setRestoreConfirmOpen] = React.useState(false);
  const [restoreResultText, setRestoreResultText] = React.useState<string | null>(
    null,
  );
  const [deleteScope, setDeleteScope] = React.useState<"study_data" | "account" | null>(
    null,
  );
  const [confirmPhrase, setConfirmPhrase] = React.useState("");

  const handleSavePreferences = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const goal = clampGoal(dailyGoalDraft);
    setDailyGoalOverride(null);

    try {
      await updatePreferences(
        {
          language: prefLang,
          theme: prefTheme,
          daily_goal: goal,
          default_shuffle_questions: shuffleQuestions,
          default_shuffle_options: shuffleOptions,
          show_instant_feedback: instantFeedback,
          sound_effects: soundEffects,
          reduced_motion: reducedMotion,
        },
        { persistRemote: configured, throwOnError: true },
      );
      toast.success(
        configured
          ? t("settings.savedSuccess")
          : vi
            ? "Đã lưu tùy chọn trên trình duyệt này."
            : "Preferences saved locally in this browser.",
      );
    } catch (err) {
      if (isServiceUnavailableError(err)) {
        toast.success(
          vi
            ? "Đã lưu tùy chọn trên trình duyệt này."
            : "Preferences saved locally in this browser.",
        );
        return;
      }
      toast.error(getFriendlyErrorMessage(err, locale));
    }
  };

  const handlePasswordUpdate = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordError(null);
    if (newPassword.length < 8) {
      const msg = vi
        ? "Mật khẩu mới cần ít nhất 8 ký tự."
        : "New password must be at least 8 characters.";
      setPasswordError(msg);
      passwordInputRef.current?.focus();
      return;
    }
    const supabase = tryCreateClient();
    if (!supabase) {
      toast.error(t("common.serviceUnavailableDesc"));
      return;
    }
    setUpdatingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        toast.error(getFriendlyErrorMessage(error, locale));
        return;
      }
      setNewPassword("");
      toast.success(
        vi ? "Đã đổi mật khẩu thành công." : "Password updated successfully.",
      );
    } catch (err) {
      toast.error(getFriendlyErrorMessage(err, locale));
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
      toast.error(getFriendlyErrorMessage(err, locale));
    } finally {
      setExportingData(false);
    }
  };

  const handleSelectBackupFile = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    if (file.size > 15 * 1024 * 1024) {
      toast.error(
        vi ? "Tệp sao lưu vượt quá giới hạn 15 MB." : "Backup file exceeds 15 MB limit.",
      );
      return;
    }

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Record<string, unknown>;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("invalid");
      }
      const root =
        parsed.data && typeof parsed.data === "object" && !Array.isArray(parsed.data)
          ? (parsed.data as Record<string, unknown>)
          : parsed;

      const foldersArr = Array.isArray(root.folders) ? root.folders : [];
      const setsArr = Array.isArray(root.study_sets)
        ? root.study_sets
        : Array.isArray(root.sets)
          ? root.sets
          : [];
      const questionsArr = Array.isArray(root.questions) ? root.questions : [];

      setRestoreResultText(null);
      setBackupPreview({
        fileName: file.name,
        payload: root,
        foldersCount: foldersArr.length,
        setsCount: setsArr.length,
        questionsCount: questionsArr.length,
      });
    } catch {
      toast.error(
        vi
          ? "Tệp JSON không hợp lệ. Vui lòng chọn tệp sao lưu được xuất từ StudyHub."
          : "Invalid JSON file. Please select a backup exported from StudyHub.",
      );
    }
  };

  const restoreMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await apiFetch<RestoreSummary>("/api/account/restore", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      return res.data;
    },
    onSuccess: (result) => {
      setRestoreConfirmOpen(false);
      setBackupPreview(null);
      const r = result?.restored;
      const summaryText = r
        ? vi
          ? `Đã khôi phục ${r.folders ?? 0} thư mục, ${r.sets ?? r.study_sets ?? 0} học phần và ${r.questions ?? 0} câu hỏi.`
          : `Restored ${r.folders ?? 0} folders, ${r.sets ?? r.study_sets ?? 0} study sets, and ${r.questions ?? 0} questions.`
        : vi
          ? "Đã khôi phục dữ liệu từ bản sao lưu thành công."
          : "Account backup restored successfully.";
      setRestoreResultText(summaryText);
      toast.success(summaryText);
      queryClient.invalidateQueries({ queryKey: ["folders"] });
      queryClient.invalidateQueries({ queryKey: ["study-sets"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["history-exams"] });
    },
    onError: (err) => {
      toast.error(getFriendlyErrorMessage(err, locale));
    },
  });

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
        toast.success(
          vi ? "Đã xóa dữ liệu và đăng xuất." : "Account data cleared and signed out.",
        );
        router.push("/login");
      } else {
        toast.success(
          vi ? "Đã xóa toàn bộ dữ liệu học tập." : "All study data deleted.",
        );
        router.refresh();
      }
    },
    onError: (err) => {
      toast.error(getFriendlyErrorMessage(err, locale));
    },
  });

  return (
    <FadeIn aboveFold className="mx-auto max-w-3xl space-y-6">
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
          {prefsLoading ? (
            <Skeleton className="h-80 w-full rounded-xl" />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {vi
                    ? "Giao diện, Ngôn ngữ & Tùy chọn học tập"
                    : "Appearance, Language & Study Defaults"}
                </CardTitle>
                <CardDescription>
                  {vi
                    ? "Các tùy chọn này áp dụng trực tiếp cho Flashcards, Luyện tập, Thi thử và hiệu ứng chuyển động. Nội dung câu hỏi luôn giữ nguyên bản, không tự động dịch."
                    : "These defaults directly drive Flashcards, Practice, Exam setup, sound cues, and motion settings. Your study content is never auto-translated."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={(e) => void handleSavePreferences(e)} className="space-y-5">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="pref-language">{t("settings.language")}</Label>
                      <Select
                        value={prefLang}
                        onValueChange={(v) => {
                          const next = v as Locale;
                          setLocale(next);
                          void updatePreferences(
                            { language: next },
                            { persistRemote: false },
                          );
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
                          setTheme(next);
                          void updatePreferences(
                            { theme: next },
                            { persistRemote: false },
                          );
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
                      type="text"
                      inputMode="numeric"
                      value={dailyGoalDraft}
                      onChange={(e) =>
                        setDailyGoalOverride(e.target.value.replace(/[^0-9]/g, ""))
                      }
                      onBlur={() => {
                        const clamped = clampGoal(dailyGoalDraft);
                        setDailyGoalOverride(null);
                        void updatePreferences(
                          { daily_goal: clamped },
                          { persistRemote: false },
                        );
                      }}
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
                        onCheckedChange={(val) => {
                          void updatePreferences(
                            { default_shuffle_questions: val },
                            { persistRemote: false },
                          );
                        }}
                      />
                    </div>

                    <div className="flex items-center justify-between gap-4">
                      <Label htmlFor="pref-shuffle-o" className="cursor-pointer font-normal">
                        {t("settings.defaultShuffleOptions")}
                      </Label>
                      <Switch
                        id="pref-shuffle-o"
                        checked={shuffleOptions}
                        onCheckedChange={(val) => {
                          void updatePreferences(
                            { default_shuffle_options: val },
                            { persistRemote: false },
                          );
                        }}
                      />
                    </div>

                    <div className="flex items-center justify-between gap-4">
                      <Label htmlFor="pref-feedback" className="cursor-pointer font-normal">
                        {t("settings.showExplanationImmediately")}
                      </Label>
                      <Switch
                        id="pref-feedback"
                        checked={instantFeedback}
                        onCheckedChange={(val) => {
                          void updatePreferences(
                            { show_instant_feedback: val },
                            { persistRemote: false },
                          );
                        }}
                      />
                    </div>

                    <div className="flex items-center justify-between gap-4">
                      <Label htmlFor="pref-sound" className="cursor-pointer font-normal">
                        {t("settings.soundEffects")}
                      </Label>
                      <Switch
                        id="pref-sound"
                        checked={soundEffects}
                        onCheckedChange={(val) => {
                          void updatePreferences(
                            { sound_effects: val },
                            { persistRemote: false },
                          ).then(() => {
                            if (val) playFeedbackSound("flip");
                          });
                        }}
                      />
                    </div>

                    <div className="flex items-center justify-between gap-4">
                      <Label htmlFor="pref-motion" className="cursor-pointer font-normal">
                        {t("settings.reducedMotion")}
                      </Label>
                      <Switch
                        id="pref-motion"
                        checked={reducedMotion}
                        onCheckedChange={(val) => {
                          void updatePreferences(
                            { reduced_motion: val },
                            { persistRemote: false },
                          );
                        }}
                      />
                    </div>
                  </div>

                  <div className="flex justify-end pt-2">
                    <Button type="submit" disabled={prefsSaving}>
                      {prefsSaving ? (
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
              <form onSubmit={(e) => void handlePasswordUpdate(e)} noValidate className="space-y-4">
                <div className="space-y-1.5 sm:max-w-md">
                  <Label htmlFor="settings-new-password">
                    {vi ? "Mật khẩu mới" : "New password"}
                  </Label>
                  <p id="settings-password-hint" className="text-muted-foreground text-xs">
                    {vi ? "Tối thiểu 8 ký tự." : "At least 8 characters."}
                  </p>
                  <div className="relative">
                    <Input
                      ref={passwordInputRef}
                      id="settings-new-password"
                      name="new-password"
                      type={showPassword ? "text" : "password"}
                      autoComplete="new-password"
                      minLength={8}
                      required
                      value={newPassword}
                      onChange={(e) => {
                        setPasswordError(null);
                        setNewPassword(e.target.value);
                      }}
                      aria-invalid={passwordError ? "true" : "false"}
                      aria-describedby={
                        passwordError
                          ? "settings-password-hint settings-password-error"
                          : "settings-password-hint"
                      }
                      className="pr-12"
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
                      className="text-muted-foreground hover:text-foreground absolute top-1/2 right-0.5 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-md sm:h-9 sm:w-9"
                    >
                      {showPassword ? (
                        <EyeOff className="size-4" aria-hidden="true" />
                      ) : (
                        <Eye className="size-4" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                  {passwordError && (
                    <p
                      id="settings-password-error"
                      role="alert"
                      className="text-destructive text-xs font-medium"
                    >
                      {passwordError}
                    </p>
                  )}
                </div>
                <Button type="submit" disabled={updatingPassword}>
                  {updatingPassword && (
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  )}
                  <span>{vi ? "Cập nhật mật khẩu" : "Update password"}</span>
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Export & Restore Personal Data (SH-033) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {vi ? "Sao lưu & Khôi phục dữ liệu cá nhân" : "Personal Backup & Restore"}
              </CardTitle>
              <CardDescription>
                {vi
                  ? "Tải xuống bản sao JSON toàn bộ thư mục, học phần và câu hỏi, hoặc khôi phục lại từ bản sao StudyHub đã lưu."
                  : "Download a portable JSON archive of your folders, study sets, and questions, or restore from a saved StudyHub JSON backup."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap items-center gap-3">
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

                <Button variant="outline" asChild disabled={restoreMutation.isPending}>
                  <label className="cursor-pointer">
                    <Upload className="size-4" aria-hidden="true" />
                    <span>{t("settings.restoreBackup")}</span>
                    <input
                      type="file"
                      accept=".json,application/json"
                      className="sr-only"
                      onChange={(e) => void handleSelectBackupFile(e)}
                    />
                  </label>
                </Button>
              </div>

              {backupPreview && (
                <div className="border-primary/30 bg-accent/50 flex flex-col gap-3 rounded-lg border p-3.5 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0 space-y-0.5">
                    <p className="text-foreground truncate font-medium">
                      {backupPreview.fileName}
                    </p>
                    <p className="text-muted-foreground font-mono text-xs tabular-nums">
                      {vi
                        ? `${backupPreview.foldersCount} thư mục · ${backupPreview.setsCount} học phần · ${backupPreview.questionsCount} câu hỏi`
                        : `${backupPreview.foldersCount} folders · ${backupPreview.setsCount} study sets · ${backupPreview.questionsCount} questions`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setBackupPreview(null)}
                    >
                      {t("common.cancel")}
                    </Button>
                    <Button
                      size="sm"
                      disabled={restoreMutation.isPending}
                      onClick={() => setRestoreConfirmOpen(true)}
                    >
                      {restoreMutation.isPending && (
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      )}
                      <span>{vi ? "Khôi phục ngay" : "Restore now"}</span>
                    </Button>
                  </div>
                </div>
              )}

              {restoreResultText && (
                <div
                  role="status"
                  className="border-success/30 bg-success-subtle text-success-subtle-foreground flex items-center gap-2 rounded-lg border px-3.5 py-2.5 text-sm"
                >
                  <CheckCircle2 className="size-4 shrink-0" aria-hidden="true" />
                  <span>{restoreResultText}</span>
                </div>
              )}
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
                <span>
                  {vi ? "Xóa toàn bộ tài khoản & dữ liệu" : "Delete account & all data"}
                </span>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Confirm Backup Restore Dialog */}
      <AlertDialog open={restoreConfirmOpen} onOpenChange={setRestoreConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {vi ? "Khôi phục dữ liệu từ bản sao JSON?" : "Restore data from JSON backup?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {vi
                ? `Hệ thống sẽ nhập các thư mục, học phần và câu hỏi từ "${backupPreview?.fileName ?? ""}" vào tài khoản của bạn mà không xóa các học phần hiện có.`
                : `Folders, study sets, and questions from "${backupPreview?.fileName ?? ""}" will be restored into your account alongside existing items.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel autoFocus>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={restoreMutation.isPending || !backupPreview}
              onClick={(e) => {
                e.preventDefault();
                if (backupPreview) {
                  restoreMutation.mutate(backupPreview.payload);
                }
              }}
            >
              {restoreMutation.isPending && (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              )}
              <span>{t("common.confirm")}</span>
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Typed Confirmation Dialog for Danger Zone */}
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
            <AlertDialogCancel autoFocus>{t("common.cancel")}</AlertDialogCancel>
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
