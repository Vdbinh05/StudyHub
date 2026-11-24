"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Eye,
  EyeOff,
  Gauge,
  KeyRound,
  Keyboard,
  Loader2,
  RotateCcw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Upload,
  User,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";
import {
  apiFetch,
  getFriendlyErrorMessage,
  isServiceUnavailableError,
  isSupabaseConfiguredClient,
} from "@/components/layout/api-client";
import { PageHeader } from "@/components/layout/page-header";
import { useShortcuts } from "@/components/layout/ShortcutProvider";
import { ResetProgressDialog } from "@/components/learning/ResetProgressDialog";
import { FadeIn } from "@/components/motion";
import { InstallAppCard } from "@/components/pwa/InstallAppCard";
import { OfflineManagerPanel } from "@/components/pwa/OfflineManagerPanel";
import {
  clearOfflineDataForLogout,
  useOptionalPwa,
} from "@/components/pwa/PwaProvider";
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
import {
  DEFAULT_MODE_PREFERENCES,
  useUserPreferences,
} from "@/lib/preferences";
import { tryCreateClient } from "@/lib/supabase/client";
import type {
  DiagramStudyMode,
  Locale,
  ModePreferences,
  ThemePreference,
} from "@/types/domain";

type SettingsTabKey = "preferences" | "modes" | "offline" | "reset" | "account";

const VALID_TABS = new Set<SettingsTabKey>([
  "preferences",
  "modes",
  "offline",
  "reset",
  "account",
]);

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

function resolveTabParam(raw: string | null): SettingsTabKey {
  if (raw && VALID_TABS.has(raw as SettingsTabKey)) {
    return raw as SettingsTabKey;
  }
  return "preferences";
}

function SettingsViewInner() {
  const { locale, setLocale, t } = useI18n();
  const vi = locale === "vi";
  const { setTheme } = useTheme();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const configured = isSupabaseConfiguredClient();
  const pwa = useOptionalPwa();
  const { openHelp, setShortcutsEnabled } = useShortcuts();

  const urlTab = resolveTabParam(searchParams.get("tab"));
  const [selectedTab, setSelectedTab] = React.useState<SettingsTabKey | null>(null);
  const activeTab: SettingsTabKey = selectedTab ?? urlTab;

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
  const confidenceEnabled = preferences.confidence_enabled;
  const modePrefs: ModePreferences = preferences.mode_preferences ?? DEFAULT_MODE_PREFERENCES;

  // Progress Reset Dialog
  const [resetDialogOpen, setResetDialogOpen] = React.useState(false);

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

  const patchModeSection = <K extends keyof ModePreferences>(
    section: K,
    patch: NonNullable<ModePreferences[K]>,
  ) => {
    const nextSection = {
      ...(modePrefs[section] ?? {}),
      ...patch,
    } as NonNullable<ModePreferences[K]>;
    if (section === "shortcuts" && "enabled" in patch && typeof patch.enabled === "boolean") {
      setShortcutsEnabled(patch.enabled);
    }
    void updatePreferences(
      { mode_preferences: { [section]: nextSection } },
      { persistRemote: false },
    );
  };

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
          confidence_enabled: confidenceEnabled,
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

  const handleSaveModePreferences = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();
    try {
      await updatePreferences(
        {
          confidence_enabled: confidenceEnabled,
          mode_preferences: modePrefs,
        },
        { persistRemote: configured, throwOnError: true },
      );
      toast.success(
        configured
          ? t("settings.savedSuccess")
          : vi
            ? "Đã lưu tùy chọn chế độ học trên trình duyệt này."
            : "Mode preferences saved locally in this browser.",
      );
    } catch (err) {
      if (isServiceUnavailableError(err)) {
        toast.success(
          vi
            ? "Đã lưu tùy chọn chế độ học trên trình duyệt này."
            : "Mode preferences saved locally in this browser.",
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
        await clearOfflineDataForLogout(pwa?.activeUserId);
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

  const handleTabChange = (val: string) => {
    const next = resolveTabParam(val);
    setSelectedTab(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next === "preferences") {
      params.delete("tab");
    } else {
      params.set("tab", next);
    }
    const qs = params.toString();
    router.replace(`/settings${qs ? `?${qs}` : ""}`, { scroll: false });
  };

  return (
    <FadeIn aboveFold className="mx-auto max-w-4xl space-y-6">
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

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <div className="overflow-x-auto pb-1">
          <TabsList className="w-max min-w-full sm:min-w-0">
            <TabsTrigger value="preferences">{t("settings.preferencesTab")}</TabsTrigger>
            <TabsTrigger value="modes">
              <SlidersHorizontal className="size-3.5" aria-hidden="true" />
              <span>{t("settings.modePrefsTab")}</span>
            </TabsTrigger>
            <TabsTrigger value="offline">
              <WifiOff className="size-3.5" aria-hidden="true" />
              <span>{t("settings.offlineTab")}</span>
            </TabsTrigger>
            <TabsTrigger value="reset">
              <RotateCcw className="size-3.5" aria-hidden="true" />
              <span>{t("settings.resetTab")}</span>
            </TabsTrigger>
            <TabsTrigger value="account">{t("settings.accountTab")}</TabsTrigger>
          </TabsList>
        </div>

        {/* TAB 1: General Study Preferences & Confidence Toggle */}
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
                <form
                  onSubmit={(e) => void handleSavePreferences(e)}
                  className="space-y-5"
                >
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
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-0.5">
                        <Label
                          htmlFor="pref-confidence"
                          className="flex cursor-pointer items-center gap-1.5 font-medium"
                        >
                          <Gauge className="text-primary size-4" aria-hidden="true" />
                          <span>{t("confidence.enableToggle")}</span>
                        </Label>
                        <p className="text-muted-foreground text-xs leading-relaxed">
                          {t("confidence.enableDescription")}{" "}
                          {t("confidence.examDisclaimer")}
                        </p>
                      </div>
                      <Switch
                        id="pref-confidence"
                        checked={confidenceEnabled}
                        onCheckedChange={(val) => {
                          void updatePreferences(
                            { confidence_enabled: val },
                            { persistRemote: false },
                          );
                        }}
                      />
                    </div>

                    <Separator />

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

        {/* TAB 2: Learning Mode Preferences, Shortcuts & Accessibility (§29) */}
        <TabsContent value="modes" className="mt-4">
          {prefsLoading ? (
            <Skeleton className="h-96 w-full rounded-xl" />
          ) : (
            <form
              onSubmit={(e) => void handleSaveModePreferences(e)}
              className="space-y-4"
            >
              {/* Flashcards & Multiple Choice */}
              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">
                      {t("modePrefs.flashcardsSection")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="mp-fc-side">{t("modePrefs.cardFrontSide")}</Label>
                      <Select
                        value={modePrefs.flashcards?.start_side ?? "front"}
                        onValueChange={(v) =>
                          patchModeSection("flashcards", {
                            start_side: v as "front" | "back",
                          })
                        }
                      >
                        <SelectTrigger id="mp-fc-side">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="front">
                            {vi ? "Mặt trước (Câu hỏi / Thuật ngữ)" : "Front (Prompt / Term)"}
                          </SelectItem>
                          <SelectItem value="back">
                            {vi ? "Mặt sau (Đáp án / Định nghĩa)" : "Back (Answer / Definition)"}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <Label htmlFor="mp-fc-audio" className="cursor-pointer font-normal">
                        {t("modePrefs.autoPlayAudio")}
                      </Label>
                      <Switch
                        id="mp-fc-audio"
                        checked={Boolean(modePrefs.flashcards?.auto_play_audio)}
                        onCheckedChange={(val) =>
                          patchModeSection("flashcards", { auto_play_audio: val })
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <Label htmlFor="mp-fc-hints" className="cursor-pointer font-normal">
                        {t("modePrefs.showHints")}
                      </Label>
                      <Switch
                        id="mp-fc-hints"
                        checked={modePrefs.flashcards?.show_hints ?? true}
                        onCheckedChange={(val) =>
                          patchModeSection("flashcards", { show_hints: val })
                        }
                      />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">
                      {t("modePrefs.practiceSection")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="mp-mc-advance">{t("modePrefs.autoAdvance")}</Label>
                      <Select
                        value={String(modePrefs.mc?.auto_advance_ms ?? 0)}
                        onValueChange={(v) => {
                          const ms = Number(v);
                          patchModeSection("mc", {
                            auto_advance_ms: ms > 0 ? ms : null,
                          });
                        }}
                      >
                        <SelectTrigger id="mp-mc-advance">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="0">{vi ? "Tắt (tự bấm tiếp)" : "Off (manual)"}</SelectItem>
                          <SelectItem value="800">0.8s</SelectItem>
                          <SelectItem value="1500">1.5s</SelectItem>
                          <SelectItem value="2500">2.5s</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <Label htmlFor="mp-mc-shuffle" className="cursor-pointer font-normal">
                        {t("study.shuffleOptions")}
                      </Label>
                      <Switch
                        id="mp-mc-shuffle"
                        checked={modePrefs.mc?.shuffle_options ?? true}
                        onCheckedChange={(val) =>
                          patchModeSection("mc", { shuffle_options: val })
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <Label htmlFor="mp-mc-expl" className="cursor-pointer font-normal">
                        {vi
                          ? "Hiện giải thích ngay cả khi chọn đúng"
                          : "Show explanation even when correct"}
                      </Label>
                      <Switch
                        id="mp-mc-expl"
                        checked={modePrefs.mc?.show_explanation_on_correct ?? true}
                        onCheckedChange={(val) =>
                          patchModeSection("mc", { show_explanation_on_correct: val })
                        }
                      />
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Adaptive Learn & Write */}
              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">
                      {t("modePrefs.learnSection")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="mp-learn-obj">{t("learnV3.objectiveLabel")}</Label>
                      <Select
                        value={modePrefs.learn?.objective ?? "exam_prep"}
                        onValueChange={(v) =>
                          patchModeSection("learn", {
                            objective: v as
                              | "quick_familiarity"
                              | "exam_prep"
                              | "long_term_retention",
                          })
                        }
                      >
                        <SelectTrigger id="mp-learn-obj">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="quick_familiarity">
                            {t("learnV3.objectiveQuickReview")}
                          </SelectItem>
                          <SelectItem value="exam_prep">
                            {t("learnV3.objectiveExamPrep")}
                          </SelectItem>
                          <SelectItem value="long_term_retention">
                            {t("learnV3.objectiveMasterAll")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <Label htmlFor="mp-learn-write" className="cursor-pointer font-normal">
                        {vi ? "Bật câu hỏi gõ gợi nhớ trong Học sâu" : "Enable written recall stage"}
                      </Label>
                      <Switch
                        id="mp-learn-write"
                        checked={modePrefs.learn?.enable_written_recall ?? true}
                        onCheckedChange={(val) =>
                          patchModeSection("learn", { enable_written_recall: val })
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <Label htmlFor="mp-learn-indep" className="cursor-pointer font-normal">
                        {vi
                          ? "Yêu cầu trả lời không dùng gợi ý để thành thạo"
                          : "Require hint-free recall for mastery"}
                      </Label>
                      <Switch
                        id="mp-learn-indep"
                        checked={modePrefs.learn?.require_independent_recall ?? true}
                        onCheckedChange={(val) =>
                          patchModeSection("learn", { require_independent_recall: val })
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <Label htmlFor="mp-learn-conf" className="cursor-pointer font-normal">
                        {t("modePrefs.showConfidencePrompt")}
                      </Label>
                      <Switch
                        id="mp-learn-conf"
                        checked={Boolean(modePrefs.learn?.ask_confidence)}
                        onCheckedChange={(val) =>
                          patchModeSection("learn", { ask_confidence: val })
                        }
                      />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">
                      {t("modePrefs.writeSection")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between gap-4">
                      <Label htmlFor="mp-write-case" className="cursor-pointer font-normal">
                        {vi ? "Bỏ qua chữ hoa / thường" : "Ignore uppercase / lowercase"}
                      </Label>
                      <Switch
                        id="mp-write-case"
                        checked={modePrefs.write?.ignore_case ?? true}
                        onCheckedChange={(val) =>
                          patchModeSection("write", { ignore_case: val })
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <Label htmlFor="mp-write-diac" className="cursor-pointer font-normal">
                        {vi ? "Bỏ qua dấu tiếng Việt khi chấm" : "Ignore diacritics when grading"}
                      </Label>
                      <Switch
                        id="mp-write-diac"
                        checked={Boolean(modePrefs.write?.ignore_diacritics)}
                        onCheckedChange={(val) =>
                          patchModeSection("write", { ignore_diacritics: val })
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <Label htmlFor="mp-write-override" className="cursor-pointer font-normal">
                        {vi
                          ? "Cho phép tự xác nhận 'Tôi đã trả lời đúng'"
                          : "Allow manual 'Override: I was right'"}
                      </Label>
                      <Switch
                        id="mp-write-override"
                        checked={modePrefs.write?.allow_override ?? true}
                        onCheckedChange={(val) =>
                          patchModeSection("write", { allow_override: val })
                        }
                      />
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Spell & Diagram */}
              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">
                      {t("modePrefs.spellSection")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="mp-spell-rate">{t("modePrefs.ttsRate")}</Label>
                      <Select
                        value={String(modePrefs.spell?.speech_rate ?? 1)}
                        onValueChange={(v) =>
                          patchModeSection("spell", { speech_rate: Number(v) })
                        }
                      >
                        <SelectTrigger id="mp-spell-rate">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="0.6">0.6x ({vi ? "Chậm" : "Slow"})</SelectItem>
                          <SelectItem value="0.8">0.8x</SelectItem>
                          <SelectItem value="1">1.0x ({vi ? "Chuẩn" : "Normal"})</SelectItem>
                          <SelectItem value="1.25">1.25x</SelectItem>
                          <SelectItem value="1.5">1.5x ({vi ? "Nhanh" : "Fast"})</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <Label htmlFor="mp-spell-auto" className="cursor-pointer font-normal">
                        {t("modePrefs.autoPlayAudio")}
                      </Label>
                      <Switch
                        id="mp-spell-auto"
                        checked={modePrefs.spell?.auto_play_prompt ?? true}
                        onCheckedChange={(val) =>
                          patchModeSection("spell", { auto_play_prompt: val })
                        }
                      />
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <Label htmlFor="mp-spell-diac" className="cursor-pointer font-normal">
                        {t("modePrefs.strictAccents")}
                      </Label>
                      <Switch
                        id="mp-spell-diac"
                        checked={modePrefs.spell?.strict_diacritics ?? true}
                        onCheckedChange={(val) =>
                          patchModeSection("spell", { strict_diacritics: val })
                        }
                      />
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">
                      {t("modePrefs.diagramSection")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="mp-diag-mode">
                        {vi ? "Chế độ học sơ đồ mặc định" : "Default diagram study mode"}
                      </Label>
                      <Select
                        value={modePrefs.diagram?.default_mode ?? "identify_location"}
                        onValueChange={(v) =>
                          patchModeSection("diagram", {
                            default_mode: v as DiagramStudyMode,
                          })
                        }
                      >
                        <SelectTrigger id="mp-diag-mode">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="explore">{t("diagram.modeExplore")}</SelectItem>
                          <SelectItem value="identify_location">
                            {t("diagram.modeIdentify")}
                          </SelectItem>
                          <SelectItem value="name_location">
                            {t("diagram.modeName")}
                          </SelectItem>
                          <SelectItem value="multiple_choice">
                            {t("diagram.modeMultipleChoice")}
                          </SelectItem>
                          <SelectItem value="hidden_labels">
                            {t("diagram.modeHiddenLabels")}
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <Label htmlFor="mp-diag-hints" className="cursor-pointer font-normal">
                        {t("modePrefs.showHints")}
                      </Label>
                      <Switch
                        id="mp-diag-hints"
                        checked={modePrefs.diagram?.show_hotspot_hints ?? true}
                        onCheckedChange={(val) =>
                          patchModeSection("diagram", { show_hotspot_hints: val })
                        }
                      />
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Shortcuts & Accessibility */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Keyboard className="text-primary size-4" aria-hidden="true" />
                    <span>{t("modePrefs.accessibilitySection")}</span>
                  </CardTitle>
                  <CardDescription>{t("shortcuts.imeSafetyNote")}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <Label htmlFor="mp-sc-enabled" className="cursor-pointer font-normal">
                      {t("shortcuts.enableShortcuts")}
                    </Label>
                    <Switch
                      id="mp-sc-enabled"
                      checked={modePrefs.shortcuts?.enabled ?? true}
                      onCheckedChange={(val) =>
                        patchModeSection("shortcuts", { enabled: val })
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <Label htmlFor="mp-a11y-focus" className="cursor-pointer font-normal">
                      {t("modePrefs.highContrastFocus")}
                    </Label>
                    <Switch
                      id="mp-a11y-focus"
                      checked={Boolean(modePrefs.accessibility?.high_contrast_focus)}
                      onCheckedChange={(val) =>
                        patchModeSection("accessibility", { high_contrast_focus: val })
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <Label htmlFor="mp-a11y-text" className="cursor-pointer font-normal">
                      {t("modePrefs.largeText")}
                    </Label>
                    <Switch
                      id="mp-a11y-text"
                      checked={Boolean(modePrefs.accessibility?.large_reading_text)}
                      onCheckedChange={(val) =>
                        patchModeSection("accessibility", { large_reading_text: val })
                      }
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                    <Button type="button" variant="outline" size="sm" onClick={openHelp}>
                      <Keyboard className="size-4" aria-hidden="true" />
                      <span>{t("shortcuts.openHelp")}</span>
                    </Button>
                    <Button type="submit" disabled={prefsSaving}>
                      {prefsSaving ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Save className="size-4" aria-hidden="true" />
                      )}
                      <span>{t("settings.saveChanges")}</span>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </form>
          )}
        </TabsContent>

        {/* TAB 3: PWA Install & Offline Learning Manager (§25–27) */}
        <TabsContent value="offline" className="mt-4 space-y-6">
          <InstallAppCard />
          <OfflineManagerPanel
            onStudySetOffline={(setId) =>
              router.push(`/offline?setId=${encodeURIComponent(setId)}`)
            }
          />
        </TabsContent>

        {/* TAB 4: Scoped / Account-Wide Progress Reset (§19) */}
        <TabsContent value="reset" className="mt-4 space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <RotateCcw className="text-primary size-4" aria-hidden="true" />
                <span>{t("resume.resetTitle")}</span>
              </CardTitle>
              <CardDescription>{t("resume.resetSubtitle")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="border-success/30 bg-success-subtle text-success-subtle-foreground flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm">
                <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <p className="leading-relaxed">
                  {t("resume.resetPreserveHistoryNotice")}
                </p>
              </div>
              <p className="text-muted-foreground text-sm leading-relaxed">
                {vi
                  ? "Muốn đặt lại riêng một học phần hoặc một chương cụ thể? Hãy mở trang chi tiết học phần đó và chọn nút Đặt lại tiến độ."
                  : "Want to reset a single study set or chapter instead? Open that study set's overview page and choose Reset Progress."}
              </p>
              <Button
                type="button"
                variant="outline"
                disabled={!configured}
                onClick={() => setResetDialogOpen(true)}
              >
                <RotateCcw className="size-4" aria-hidden="true" />
                <span>
                  {vi ? "Đặt lại toàn bộ tiến độ học tập..." : "Reset all study progress..."}
                </span>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 5: Account Security, JSON Backup & Danger Zone */}
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
              <form
                onSubmit={(e) => void handlePasswordUpdate(e)}
                noValidate
                className="space-y-4"
              >
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
                  ? "Các thao tác bên dưới sẽ xóa vĩnh viễn dữ liệu khỏi cơ sở dữ liệu và không thể hoàn tác. (Nếu bạn chỉ muốn học lại từ đầu mà giữ nguyên câu hỏi và lịch sử thi, hãy dùng mục Đặt lại tiến độ.)"
                  : "Actions below permanently delete your data from the database and cannot be undone. (If you only want to study fresh while preserving sets & exam history, use Reset Progress instead.)"}
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

      {/* Account-Wide Progress Reset Dialog */}
      <ResetProgressDialog
        open={resetDialogOpen}
        onOpenChange={setResetDialogOpen}
        defaultScope="all"
        allowedScopes={["all"]}
        userId={pwa?.activeUserId ?? undefined}
        pendingOfflineEventsCount={pwa?.syncSummary?.pendingCount ?? 0}
        onResetComplete={() => {
          queryClient.invalidateQueries({ queryKey: ["dashboard"] });
          queryClient.invalidateQueries({ queryKey: ["statistics"] });
        }}
      />

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
              disabled={
                confirmPhrase !== "DELETE_MY_DATA" || deleteDataMutation.isPending
              }
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

export function SettingsView() {
  return (
    <React.Suspense
      fallback={
        <div className="mx-auto max-w-4xl space-y-6">
          <Skeleton className="h-12 w-64" />
          <Skeleton className="h-96 w-full rounded-xl" />
        </div>
      }
    >
      <SettingsViewInner />
    </React.Suspense>
  );
}
