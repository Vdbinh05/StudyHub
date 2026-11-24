"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BarChart3,
  BookOpenCheck,
  Clock,
  FileCheck2,
  FolderPlus,
  History,
  Home,
  Keyboard,
  Layers,
  Library,
  LogIn,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  Share2,
  Star,
  Upload,
  User,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import { toast } from "sonner";
import { clearOfflineDataForLogout, useOptionalPwa } from "@/components/pwa/PwaProvider";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useI18n } from "@/lib/i18n";
import { useUserPreferences } from "@/lib/preferences";
import { cn } from "@/lib/utils";
import type { Locale, Profile, ThemePreference, UserPreferences } from "@/types/domain";
import { apiFetch, ApiError, isSupabaseConfiguredClient } from "./api-client";
import { BrandLogo } from "./brand-logo";
import { LanguageToggle } from "./language-toggle";
import { ServiceSetupNotice } from "./service-setup-notice";
import { useShortcuts } from "./ShortcutProvider";
import { ThemeToggle } from "./theme-toggle";

interface NavItem {
  id: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  labelVi: string;
  labelEn: string;
  shortLabelVi?: string;
  shortLabelEn?: string;
  group: "core" | "study" | "activity" | "social" | "system";
  match: (pathname: string, searchParams: URLSearchParams) => boolean;
}

const NAV_ITEMS: NavItem[] = [
  {
    id: "dashboard",
    href: "/dashboard",
    icon: Home,
    labelVi: "Tổng quan",
    labelEn: "Dashboard",
    group: "core",
    match: (p) => p === "/dashboard",
  },
  {
    id: "library",
    href: "/library",
    icon: Library,
    labelVi: "Thư viện",
    labelEn: "Library",
    group: "core",
    match: (p) =>
      p === "/library" ||
      p === "/folders" ||
      p.startsWith("/folders/") ||
      p === "/import" ||
      p === "/sets/new",
  },
  {
    id: "custom-exam",
    href: "/exams/new",
    icon: FileCheck2,
    labelVi: "Thi thử tùy chỉnh",
    labelEn: "Custom Exam",
    shortLabelVi: "Thi thử mới",
    shortLabelEn: "Custom Exam",
    group: "study",
    match: (p) => p === "/exams/new",
  },
  {
    id: "practice",
    href: "/practice",
    icon: BookOpenCheck,
    labelVi: "Luyện tập",
    labelEn: "Practice",
    group: "study",
    match: (p) => p === "/practice",
  },
  {
    id: "exams-hub",
    href: "/exams",
    icon: Layers,
    labelVi: "Đề & Chu kỳ thi",
    labelEn: "Exams & Cycles",
    shortLabelVi: "Đề & Chu kỳ",
    shortLabelEn: "Exams & Cycles",
    group: "study",
    match: (p) => p === "/exams",
  },
  {
    id: "review",
    href: "/review",
    icon: RotateCcw,
    labelVi: "Câu đã sai",
    labelEn: "Review Mistakes",
    shortLabelVi: "Ôn câu sai",
    shortLabelEn: "Mistakes",
    group: "study",
    match: (p) => p === "/review",
  },
  {
    id: "starred",
    href: "/starred",
    icon: Star,
    labelVi: "Đánh dấu sao",
    labelEn: "Starred",
    shortLabelVi: "Gắn sao",
    shortLabelEn: "Starred",
    group: "study",
    match: (p) => p === "/starred",
  },
  {
    id: "history",
    href: "/history",
    icon: History,
    labelVi: "Lịch sử",
    labelEn: "History",
    group: "activity",
    match: (p) => p === "/history",
  },
  {
    id: "statistics",
    href: "/statistics",
    icon: BarChart3,
    labelVi: "Thống kê",
    labelEn: "Statistics",
    group: "activity",
    match: (p) => p === "/statistics",
  },
  {
    id: "shared",
    href: "/shared",
    icon: Share2,
    labelVi: "Được chia sẻ",
    labelEn: "Shared",
    group: "social",
    match: (p) => p === "/shared",
  },
  {
    id: "friends",
    href: "/friends",
    icon: Users,
    labelVi: "Bạn bè",
    labelEn: "Friends",
    group: "social",
    match: (p) => p === "/friends",
  },
  {
    id: "settings",
    href: "/settings",
    icon: Settings,
    labelVi: "Cài đặt",
    labelEn: "Settings",
    group: "system",
    // Strictly match /settings so /profile does NOT wrongly highlight Settings
    match: (p) => p === "/settings",
  },
];

// Focus routes render their own single <main id="main-content"> and focus header
const FOCUS_ROUTE_PATTERN =
  /^(\/sets\/[^/]+\/(flashcards|learn|practice|write|spell|match|test|results)(?:\/|$)|\/exams\/(?!new(?:\/|$))[^/]+(?:\/|$))/;

const SIDEBAR_STORAGE_KEY = "studyhub-sidebar-collapsed";
const sidebarListeners = new Set<() => void>();

function subscribeSidebar(listener: () => void): () => void {
  sidebarListeners.add(listener);
  return () => {
    sidebarListeners.delete(listener);
  };
}

function readSidebarCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeSidebarCollapsed(next: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next));
  } catch {
    // Ignore storage write errors
  }
  for (const listener of sidebarListeners) {
    listener();
  }
}

function getInitials(name?: string | null, email?: string | null): string {
  const source = (name?.trim() || email?.trim() || "U").toUpperCase();
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[parts.length - 1][0]}`;
  }
  return source.slice(0, 2);
}

interface ProfileBundle {
  profile: Profile | null;
  preferences?: UserPreferences | null;
}

function AppShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { locale, t } = useI18n();
  const { updatePreferences } = useUserPreferences();
  const { openSearch, openHelp, isExamRoute } = useShortcuts();
  const pwa = useOptionalPwa();

  const collapsed = React.useSyncExternalStore(
    subscribeSidebar,
    readSidebarCollapsed,
    () => false,
  );
  const [mobileMoreOpen, setMobileMoreOpen] = React.useState(false);
  const [signingOut, setSigningOut] = React.useState(false);

  const toggleSidebar = () => {
    writeSidebarCollapsed(!collapsed);
  };

  const isFocusRoute = FOCUS_ROUTE_PATTERN.test(pathname);
  const supabaseConfigured = isSupabaseConfiguredClient();

  const {
    data: profileData,
    error: profileError,
    isLoading: profileLoading,
  } = useQuery<ProfileBundle | null>({
    queryKey: ["current-profile"],
    enabled: supabaseConfigured && !isFocusRoute,
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      try {
        const res = await apiFetch<Profile | ProfileBundle>("/api/profile");
        const raw = res.data;
        if (raw && typeof raw === "object" && "profile" in raw) {
          return raw as ProfileBundle;
        }
        return { profile: raw as Profile, preferences: null };
      } catch (err) {
        if (err instanceof ApiError && (err.status === 401 || err.status === 503)) {
          return null;
        }
        throw err;
      }
    },
  });

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await clearOfflineDataForLogout(profileData?.profile?.id);
      await fetch("/auth/signout", { method: "POST", credentials: "same-origin" });
      queryClient.clear();
      router.push("/login");
      router.refresh();
    } catch {
      toast.error(
        locale === "vi"
          ? "Không thể đăng xuất lúc này. Vui lòng thử lại."
          : "Unable to sign out right now. Please try again.",
      );
    } finally {
      setSigningOut(false);
    }
  };

  // Focus mode routes provide their own single <main id="main-content">
  if (isFocusRoute) {
    return (
      <div className="bg-background text-foreground min-h-dvh overflow-x-clip">
        {children}
      </div>
    );
  }

  const profile = profileData?.profile ?? null;
  const displayName =
    profile?.display_name ||
    profile?.username ||
    (locale === "vi" ? "Tài khoản" : "Account");

  const showConfigBanner =
    !supabaseConfigured ||
    (profileError instanceof ApiError &&
      profileError.code === "SUPABASE_NOT_CONFIGURED");

  const isOnline = pwa?.isOnline ?? true;
  const isSyncing = pwa?.isSyncing ?? false;
  const pendingSyncCount = pwa?.syncSummary?.pendingCount ?? 0;

  const renderNavLink = (item: NavItem, onNavigate?: () => void) => {
    const active = item.match(pathname, searchParams);
    const Icon = item.icon;
    const label = locale === "vi" ? item.labelVi : item.labelEn;

    const linkEl = (
      <Link
        key={item.id}
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        aria-label={collapsed ? label : undefined}
        className={cn(
          "group relative flex min-h-10 items-center gap-3 rounded-lg border-l-[3px] px-3 py-2 text-sm font-medium transition-colors",
          active
            ? "border-primary bg-accent text-accent-foreground font-semibold"
            : "text-muted-foreground hover:bg-secondary hover:text-foreground border-transparent",
          collapsed && "justify-center border-l-0 px-2",
        )}
      >
        {active && collapsed && (
          <span
            aria-hidden="true"
            className="border-primary absolute inset-y-1.5 left-0 border-l-[3px]"
          />
        )}
        <Icon className="size-4 shrink-0" aria-hidden="true" />
        <span className={collapsed ? "sr-only" : "truncate"}>{label}</span>
      </Link>
    );

    if (collapsed) {
      return (
        <Tooltip key={item.id} delayDuration={150}>
          <TooltipTrigger asChild>{linkEl}</TooltipTrigger>
          <TooltipContent side="right">{label}</TooltipContent>
        </Tooltip>
      );
    }
    return linkEl;
  };

  // Mobile 1-hand 5-tab bar: Dashboard | Library | Custom Exam (center) | Review | More
  const mobileTabs = [
    {
      href: "/dashboard",
      icon: Home,
      label: locale === "vi" ? "Tổng quan" : "Home",
      active: pathname === "/dashboard",
      featured: false,
    },
    {
      href: "/library",
      icon: Library,
      label: locale === "vi" ? "Thư viện" : "Library",
      active:
        pathname.startsWith("/library") ||
        pathname.startsWith("/folders") ||
        pathname === "/import",
      featured: false,
    },
    {
      href: "/exams/new",
      icon: FileCheck2,
      label: locale === "vi" ? "Thi thử" : "Exam",
      active: pathname === "/exams/new" || pathname === "/exams",
      featured: true,
    },
    {
      href: "/review",
      icon: RotateCcw,
      label: locale === "vi" ? "Ôn sai" : "Review",
      active: pathname === "/review" || pathname === "/practice",
      featured: false,
    },
  ];

  // Mobile "More" sheet items with crisp non-truncating labels
  const mobileSheetLinks = [
    {
      href: "/exams",
      icon: Layers,
      label: locale === "vi" ? "Đề & Chu kỳ" : "Exams & Cycles",
      active: pathname === "/exams",
    },
    {
      href: "/practice",
      icon: BookOpenCheck,
      label: locale === "vi" ? "Luyện tập" : "Practice",
      active: pathname === "/practice",
    },
    {
      href: "/starred",
      icon: Star,
      label: locale === "vi" ? "Gắn sao" : "Starred",
      active: pathname === "/starred",
    },
    {
      href: "/history",
      icon: History,
      label: locale === "vi" ? "Lịch sử thi" : "History",
      active: pathname === "/history",
    },
    {
      href: "/statistics",
      icon: BarChart3,
      label: locale === "vi" ? "Thống kê" : "Statistics",
      active: pathname === "/statistics",
    },
    {
      href: "/shared",
      icon: Share2,
      label: locale === "vi" ? "Được chia sẻ" : "Shared",
      active: pathname === "/shared",
    },
    {
      href: "/friends",
      icon: Users,
      label: locale === "vi" ? "Bạn bè" : "Friends",
      active: pathname === "/friends",
    },
    {
      href: "/import",
      icon: Upload,
      label: locale === "vi" ? "Nhập từ file" : "Import File",
      active: pathname === "/import",
    },
    {
      href: "/profile",
      icon: User,
      label: locale === "vi" ? "Hồ sơ" : "Profile",
      active: pathname === "/profile",
    },
    {
      href: "/settings",
      icon: Settings,
      label: locale === "vi" ? "Cài đặt" : "Settings",
      active: pathname === "/settings",
    },
  ];

  return (
    <div className="bg-background text-foreground flex min-h-dvh w-full overflow-x-clip">
      {/* Desktop Collapsible Sidebar */}
      <aside
        aria-label={locale === "vi" ? "Chính" : "Primary"}
        className={cn(
          "border-sidebar-border bg-sidebar hidden shrink-0 flex-col border-r lg:sticky lg:top-0 lg:flex lg:h-dvh",
          collapsed ? "w-[68px]" : "w-[248px]",
        )}
      >
        <div
          className={cn(
            "border-sidebar-border flex h-14 items-center border-b px-3",
            collapsed ? "justify-center" : "justify-between",
          )}
        >
          <Link
            href="/dashboard"
            className="focus-visible:ring-ring flex items-center rounded-md focus-visible:ring-2"
            aria-label="StudyHub"
          >
            <BrandLogo collapsed={collapsed} />
          </Link>
          {!collapsed && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={toggleSidebar}
              aria-label={locale === "vi" ? "Thu gọn thanh bên" : "Collapse sidebar"}
              className="text-muted-foreground"
            >
              <PanelLeftClose className="size-4" aria-hidden="true" />
            </Button>
          )}
        </div>

        <div className="p-2.5">
          {collapsed ? (
            <Tooltip delayDuration={150}>
              <TooltipTrigger asChild>
                <Button asChild variant="outline" size="icon" className="w-full">
                  <Link href="/exams/new" aria-label={t("nav.customExam")}>
                    <FileCheck2 className="size-4" aria-hidden="true" />
                    <span className="sr-only">{t("nav.customExam")}</span>
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">{t("nav.customExam")}</TooltipContent>
            </Tooltip>
          ) : (
            <Button asChild variant="outline" className="w-full justify-start gap-2">
              <Link href="/exams/new">
                <FileCheck2 className="text-primary size-4" aria-hidden="true" />
                <span>{t("nav.customExam")}</span>
              </Link>
            </Button>
          )}
        </div>

        <nav
          aria-label={locale === "vi" ? "Danh mục học tập" : "Study sections"}
          className="flex-1 space-y-1 overflow-y-auto px-2.5 pb-4"
        >
          {NAV_ITEMS.filter((i) => i.group === "core").map((item) =>
            renderNavLink(item),
          )}
          <Separator className="my-2" />
          {NAV_ITEMS.filter((i) => i.group === "study").map((item) =>
            renderNavLink(item),
          )}
          <Separator className="my-2" />
          {NAV_ITEMS.filter((i) => i.group === "activity").map((item) =>
            renderNavLink(item),
          )}
          <Separator className="my-2" />
          {NAV_ITEMS.filter((i) => i.group === "social").map((item) =>
            renderNavLink(item),
          )}
          <Separator className="my-2" />
          {NAV_ITEMS.filter((i) => i.group === "system").map((item) =>
            renderNavLink(item),
          )}
        </nav>

        {collapsed && (
          <div className="border-sidebar-border border-t p-2.5">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleSidebar}
              aria-label={locale === "vi" ? "Mở rộng thanh bên" : "Expand sidebar"}
              className="text-muted-foreground w-full"
            >
              <PanelLeftOpen className="size-4" aria-hidden="true" />
            </Button>
          </div>
        )}
      </aside>

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Context Bar */}
        <header className="border-border bg-card/95 sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b px-3 backdrop-blur-xs sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Link
              href="/dashboard"
              className="flex shrink-0 items-center lg:hidden"
              aria-label="StudyHub"
            >
              <BrandLogo />
            </Link>

            {!isExamRoute && (
              <div className="hidden max-w-md flex-1 sm:block">
                <button
                  type="button"
                  onClick={openSearch}
                  aria-label={t("search.dialogTitle")}
                  className="border-input bg-background text-muted-foreground hover:bg-secondary/60 hover:text-foreground focus-visible:ring-ring flex h-9 w-full items-center justify-between gap-2 rounded-md border px-3 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <Search className="size-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">{t("search.triggerPlaceholder")}</span>
                  </span>
                  <kbd className="border-border bg-muted text-muted-foreground hidden shrink-0 rounded border px-1.5 py-0.5 font-mono text-[11px] font-medium md:inline-block">
                    Ctrl K
                  </kbd>
                </button>
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
            {/* Online / Offline / Sync Status Pill (desktop/tablet) */}
            <Link
              href={isOnline ? "/settings?tab=offline" : "/offline"}
              aria-label={
                isOnline
                  ? isSyncing
                    ? t("pwa.syncing")
                    : pendingSyncCount > 0
                      ? t("pwa.pendingSyncCount", { count: pendingSyncCount })
                      : t("pwa.online")
                  : t("pwa.offline")
              }
              className={cn(
                "hidden min-h-9 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors md:inline-flex",
                !isOnline
                  ? "border-warning/40 bg-warning-subtle text-warning-subtle-foreground"
                  : pendingSyncCount > 0 || isSyncing
                    ? "border-primary/30 bg-primary-subtle text-primary"
                    : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {!isOnline ? (
                <>
                  <WifiOff className="size-3.5 shrink-0" aria-hidden="true" />
                  <span>{t("pwa.offline")}</span>
                </>
              ) : isSyncing ? (
                <>
                  <RefreshCw className="size-3.5 shrink-0 animate-spin" aria-hidden="true" />
                  <span>{t("pwa.syncing")}</span>
                </>
              ) : pendingSyncCount > 0 ? (
                <>
                  <RefreshCw className="size-3.5 shrink-0" aria-hidden="true" />
                  <span>{pendingSyncCount}</span>
                </>
              ) : (
                <>
                  <Wifi className="text-success size-3.5 shrink-0" aria-hidden="true" />
                  <span className="hidden xl:inline">{t("pwa.online")}</span>
                </>
              )}
            </Link>

            {/* Quick Create Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="min-h-11 min-w-11 gap-1.5 px-2.5 sm:min-h-9 sm:min-w-0 sm:px-3"
                  aria-label={locale === "vi" ? "Tạo nhanh" : "Quick create"}
                >
                  <Plus className="size-4" aria-hidden="true" />
                  <span className="hidden sm:inline">
                    {locale === "vi" ? "Tạo mới" : "Create"}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  {locale === "vi" ? "Tạo nhanh" : "Quick Create"}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/exams/new">
                    <FileCheck2 className="size-4" aria-hidden="true" />
                    <span>{t("nav.customExam")}</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/sets/new">
                    <Plus className="size-4" aria-hidden="true" />
                    <span>{t("library.newSet")}</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/import">
                    <Upload className="size-4" aria-hidden="true" />
                    <span>{t("library.importSet")}</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/library?create=folder">
                    <FolderPlus className="size-4" aria-hidden="true" />
                    <span>{t("library.newFolder")}</span>
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <LanguageToggle
              onPersist={(next: Locale) => void updatePreferences({ language: next })}
            />
            <ThemeToggle
              compact
              onPersist={(next: ThemePreference) =>
                void updatePreferences({ theme: next })
              }
            />

            {/* User Menu or Sign-In Link */}
            {!profile && !profileLoading ? (
              <Button asChild size="sm" variant="ghost" className="min-h-11 sm:min-h-9">
                <Link href="/login">
                  <LogIn className="size-4" aria-hidden="true" />
                  <span className="hidden sm:inline">{t("nav.signIn")}</span>
                </Link>
              </Button>
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="min-h-11 min-w-11 gap-2 rounded-full pr-2 pl-1 sm:min-h-9 sm:min-w-0"
                    aria-label={locale === "vi" ? "Menu tài khoản" : "Account menu"}
                  >
                    <Avatar className="size-7">
                      {profile?.avatar_url ? (
                        <AvatarImage src={profile.avatar_url} alt={displayName} />
                      ) : null}
                      <AvatarFallback className="bg-primary/10 text-primary text-xs">
                        {getInitials(profile?.display_name, profile?.email)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="hidden max-w-28 truncate text-xs font-medium md:inline">
                      {displayName}
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-0.5">
                      <p className="text-foreground truncate text-sm font-semibold">
                        {displayName}
                      </p>
                      {profile?.email && (
                        <p className="text-muted-foreground truncate text-xs">
                          {profile.email}
                        </p>
                      )}
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link href="/profile">
                      <User className="size-4" aria-hidden="true" />
                      <span>{t("settings.profileTab")}</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/settings">
                      <Settings className="size-4" aria-hidden="true" />
                      <span>{t("nav.settings")}</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/history">
                      <Clock className="size-4" aria-hidden="true" />
                      <span>{t("nav.history")}</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={openHelp}>
                    <Keyboard className="size-4" aria-hidden="true" />
                    <span>{t("study.keyboardShortcuts")}</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    disabled={signingOut}
                    onClick={() => void handleSignOut()}
                  >
                    <LogOut className="size-4" aria-hidden="true" />
                    <span>{t("nav.signOut")}</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </header>

        {showConfigBanner && <ServiceSetupNotice compact />}

        {/* Primary Page Content — generous mobile bottom padding so bottom nav never clips content */}
        <main
          id="main-content"
          className="mx-auto w-full max-w-7xl flex-1 px-4 pt-5 pb-[calc(6.5rem+env(safe-area-inset-bottom,0px))] sm:px-6 sm:pt-6 md:pb-24 lg:pb-10"
        >
          {children}
        </main>
      </div>

      {/* Mobile One-Hand Bottom Navigation (< 1024px) */}
      <nav
        aria-label={locale === "vi" ? "Thanh dưới" : "Bottom bar"}
        className="border-border bg-card/95 fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur-xs lg:hidden"
        style={{ paddingBottom: "max(0.25rem, env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="grid h-16 grid-cols-5 items-stretch px-1">
          {mobileTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={tab.active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 flex-col items-center justify-center gap-1 border-t-2 px-1 py-1.5 text-[11px] font-medium transition-colors",
                  tab.active
                    ? "border-primary text-primary font-semibold"
                    : "text-muted-foreground hover:text-foreground border-transparent",
                  tab.featured && !tab.active && "text-foreground",
                )}
              >
                <Icon className="size-5 shrink-0" aria-hidden="true" />
                <span className="max-w-full truncate leading-none">{tab.label}</span>
              </Link>
            );
          })}

          <Sheet open={mobileMoreOpen} onOpenChange={setMobileMoreOpen}>
            <SheetTrigger asChild>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground flex min-h-11 flex-col items-center justify-center gap-1 border-t-2 border-transparent px-1 py-1.5 text-[11px] font-medium transition-colors"
                aria-label={t("common.more")}
              >
                <Menu className="size-5 shrink-0" aria-hidden="true" />
                <span className="leading-none">{t("common.more")}</span>
              </button>
            </SheetTrigger>
            <SheetContent
              side="bottom"
              className="max-h-[84dvh] overflow-y-auto overscroll-contain rounded-t-2xl pb-[max(1.5rem,env(safe-area-inset-bottom,0px))]"
            >
              <SheetHeader>
                <SheetTitle>{locale === "vi" ? "Tất cả mục" : "More"}</SheetTitle>
                <SheetDescription>
                  {locale === "vi"
                    ? "Truy cập nhanh các tính năng ôn tập, chia sẻ và cài đặt."
                    : "Quick access to study modes, sharing, and account settings."}
                </SheetDescription>
              </SheetHeader>

              <div className="mt-2 flex flex-col gap-2">
                {!isExamRoute && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setMobileMoreOpen(false);
                      openSearch();
                    }}
                    className="text-muted-foreground min-h-11 w-full justify-start gap-2 font-normal"
                  >
                    <Search className="size-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">{t("search.triggerPlaceholder")}</span>
                  </Button>
                )}
                <div className="flex items-center gap-2">
                  <Link
                    href={isOnline ? "/settings?tab=offline" : "/offline"}
                    onClick={() => setMobileMoreOpen(false)}
                    className={cn(
                      "flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-medium",
                      !isOnline
                        ? "border-warning/40 bg-warning-subtle text-warning-subtle-foreground"
                        : "border-border bg-card text-foreground",
                    )}
                  >
                    {isOnline ? (
                      <Wifi className="text-success size-3.5 shrink-0" aria-hidden="true" />
                    ) : (
                      <WifiOff className="size-3.5 shrink-0" aria-hidden="true" />
                    )}
                    <span>
                      {!isOnline
                        ? t("pwa.offline")
                        : pendingSyncCount > 0
                          ? t("pwa.pendingSyncCount", { count: pendingSyncCount })
                          : t("pwa.online")}
                    </span>
                  </Link>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setMobileMoreOpen(false);
                      openHelp();
                    }}
                    className="min-h-10 shrink-0 gap-1.5"
                  >
                    <Keyboard className="size-3.5" aria-hidden="true" />
                    <span>{t("study.keyboardShortcuts")}</span>
                  </Button>
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                {mobileSheetLinks.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileMoreOpen(false)}
                      aria-current={item.active ? "page" : undefined}
                      className={cn(
                        "flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors",
                        item.active
                          ? "border-primary bg-accent text-accent-foreground font-semibold"
                          : "border-border bg-card text-foreground hover:bg-secondary",
                      )}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden="true" />
                      <span className="leading-snug">{item.label}</span>
                    </Link>
                  );
                })}
              </div>

              <Separator className="my-3" />

              <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
                <div className="flex items-center gap-2">
                  <LanguageToggle
                    onPersist={(next: Locale) =>
                      void updatePreferences({ language: next })
                    }
                  />
                  <ThemeToggle
                    onPersist={(next: ThemePreference) =>
                      void updatePreferences({ theme: next })
                    }
                  />
                </div>
                {profile && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={signingOut}
                    onClick={() => {
                      setMobileMoreOpen(false);
                      void handleSignOut();
                    }}
                    className="text-destructive border-destructive/30 hover:bg-destructive-subtle min-h-11"
                  >
                    <LogOut className="size-4" aria-hidden="true" />
                    <span>{t("nav.signOut")}</span>
                  </Button>
                )}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </nav>
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <React.Suspense
      fallback={
        <div className="bg-background min-h-dvh w-full" aria-busy="true" />
      }
    >
      <AppShellInner>{children}</AppShellInner>
    </React.Suspense>
  );
}
