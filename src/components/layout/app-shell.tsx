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
  Library,
  LogIn,
  LogOut,
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
  group: "primary" | "secondary";
  prefetch?: boolean;
  match: (pathname: string, searchParams: URLSearchParams) => boolean;
}

// V3.1 Clean 2-Group Student Sidebar — zero duplicate CTAs, prefetch={false} on secondary links
const NAV_ITEMS: NavItem[] = [
  {
    id: "dashboard",
    href: "/dashboard",
    icon: Home,
    labelVi: "Trang chủ",
    labelEn: "Home",
    group: "primary",
    prefetch: true,
    match: (p) => p === "/dashboard",
  },
  {
    id: "library",
    href: "/library",
    icon: Library,
    labelVi: "Thư viện",
    labelEn: "Library",
    group: "primary",
    prefetch: true,
    match: (p) =>
      p === "/library" ||
      p === "/folders" ||
      p.startsWith("/folders/") ||
      p === "/import" ||
      p === "/sets/new" ||
      p.startsWith("/sets/"),
  },
  {
    id: "exams",
    href: "/exams/new",
    icon: FileCheck2,
    labelVi: "Thi thử",
    labelEn: "Mock Exam",
    group: "primary",
    prefetch: false,
    match: (p) => p === "/exams/new" || p === "/exams",
  },
  {
    id: "review",
    href: "/review",
    icon: RotateCcw,
    labelVi: "Ôn lỗi sai",
    labelEn: "Mistakes",
    group: "primary",
    prefetch: false,
    match: (p) => p === "/review",
  },
  {
    id: "practice",
    href: "/practice",
    icon: BookOpenCheck,
    labelVi: "Luyện tập",
    labelEn: "Practice",
    group: "primary",
    prefetch: false,
    match: (p) => p === "/practice",
  },
  {
    id: "starred",
    href: "/starred",
    icon: Star,
    labelVi: "Đánh dấu sao",
    labelEn: "Starred",
    group: "secondary",
    prefetch: false,
    match: (p) => p === "/starred",
  },
  {
    id: "history",
    href: "/history",
    icon: History,
    labelVi: "Lịch sử",
    labelEn: "History",
    group: "secondary",
    prefetch: false,
    match: (p) => p === "/history",
  },
  {
    id: "statistics",
    href: "/statistics",
    icon: BarChart3,
    labelVi: "Thống kê",
    labelEn: "Statistics",
    group: "secondary",
    prefetch: false,
    match: (p) => p === "/statistics",
  },
  {
    id: "shared",
    href: "/shared",
    icon: Share2,
    labelVi: "Được chia sẻ",
    labelEn: "Shared",
    group: "secondary",
    prefetch: false,
    match: (p) => p === "/shared",
  },
  {
    id: "friends",
    href: "/friends",
    icon: Users,
    labelVi: "Bạn bè",
    labelEn: "Friends",
    group: "secondary",
    prefetch: false,
    match: (p) => p === "/friends",
  },
  {
    id: "settings",
    href: "/settings",
    icon: Settings,
    labelVi: "Cài đặt",
    labelEn: "Settings",
    group: "secondary",
    prefetch: false,
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
  const vi = locale === "vi";
  const { updatePreferences } = useUserPreferences();
  const { openSearch, openHelp, isExamRoute } = useShortcuts();
  const pwa = useOptionalPwa();

  const collapsed = React.useSyncExternalStore(
    subscribeSidebar,
    readSidebarCollapsed,
    () => false,
  );
  const [personalSheetOpen, setPersonalSheetOpen] = React.useState(false);
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
        vi
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
    (vi ? "Tài khoản" : "Account");

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
    const label = vi ? item.labelVi : item.labelEn;

    const linkEl = (
      <Link
        key={item.id}
        href={item.href}
        prefetch={item.prefetch ?? false}
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

  // Mobile 4-Tab Bottom Navigation: Trang chủ | Thư viện | Thi thử | Cá nhân
  const mobilePrimaryTabs = [
    {
      href: "/dashboard",
      icon: Home,
      label: vi ? "Trang chủ" : "Home",
      active: pathname === "/dashboard",
      prefetch: true,
    },
    {
      href: "/library",
      icon: Library,
      label: vi ? "Thư viện" : "Library",
      active:
        pathname.startsWith("/library") ||
        pathname.startsWith("/folders") ||
        pathname.startsWith("/sets/") ||
        pathname === "/import",
      prefetch: true,
    },
    {
      href: "/exams/new",
      icon: FileCheck2,
      label: vi ? "Thi thử" : "Exam",
      active: pathname === "/exams/new" || pathname === "/exams",
      prefetch: false,
    },
  ];

  const isPersonalRoute =
    pathname === "/review" ||
    pathname === "/starred" ||
    pathname === "/practice" ||
    pathname === "/history" ||
    pathname === "/statistics" ||
    pathname === "/shared" ||
    pathname === "/friends" ||
    pathname === "/profile" ||
    pathname === "/settings";

  // Compact Mobile Personal Sheet — zero desktop Shortcuts, zero duplicate VI/Theme toggles
  const mobilePersonalLinks = [
    {
      href: "/review",
      icon: RotateCcw,
      label: vi ? "Ôn lỗi sai" : "Mistakes",
      active: pathname === "/review",
    },
    {
      href: "/starred",
      icon: Star,
      label: vi ? "Câu đánh dấu" : "Starred",
      active: pathname === "/starred",
    },
    {
      href: "/practice",
      icon: BookOpenCheck,
      label: vi ? "Luyện tập" : "Practice",
      active: pathname === "/practice",
    },
    {
      href: "/history",
      icon: History,
      label: vi ? "Lịch sử thi" : "History",
      active: pathname === "/history",
    },
    {
      href: "/statistics",
      icon: BarChart3,
      label: vi ? "Thống kê" : "Statistics",
      active: pathname === "/statistics",
    },
    {
      href: "/shared",
      icon: Share2,
      label: vi ? "Chia sẻ" : "Shared",
      active: pathname === "/shared",
    },
    {
      href: "/friends",
      icon: Users,
      label: vi ? "Bạn bè" : "Friends",
      active: pathname === "/friends",
    },
    {
      href: "/profile",
      icon: User,
      label: vi ? "Hồ sơ" : "Profile",
      active: pathname === "/profile",
    },
  ];

  return (
    <div className="bg-background text-foreground flex min-h-dvh w-full overflow-x-clip">
      {/* Desktop Collapsible 2-Group Sidebar */}
      <aside
        aria-label={vi ? "Điều hướng chính" : "Primary"}
        className={cn(
          "border-sidebar-border bg-sidebar hidden shrink-0 flex-col border-r lg:sticky lg:top-0 lg:flex lg:h-dvh",
          collapsed ? "w-[68px]" : "w-[236px]",
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
              aria-label={vi ? "Thu gọn thanh bên" : "Collapse sidebar"}
              className="text-muted-foreground"
            >
              <PanelLeftClose className="size-4" aria-hidden="true" />
            </Button>
          )}
        </div>

        <nav
          aria-label={vi ? "Danh mục học tập" : "Study sections"}
          className="flex-1 space-y-1 overflow-y-auto px-2.5 py-3"
        >
          {NAV_ITEMS.filter((i) => i.group === "primary").map((item) =>
            renderNavLink(item),
          )}

          <Separator className="my-3" />

          {!collapsed && (
            <p className="text-muted-foreground px-3 pb-1 text-[11px] font-semibold tracking-wide uppercase">
              {vi ? "Cá nhân" : "Personal"}
            </p>
          )}
          {NAV_ITEMS.filter((i) => i.group === "secondary").map((item) =>
            renderNavLink(item),
          )}
        </nav>

        {collapsed && (
          <div className="border-sidebar-border border-t p-2.5">
            <Button
              variant="ghost"
              size="icon"
              onClick={toggleSidebar}
              aria-label={vi ? "Mở rộng thanh bên" : "Expand sidebar"}
              className="text-muted-foreground w-full"
            >
              <PanelLeftOpen className="size-4" aria-hidden="true" />
            </Button>
          </div>
        )}
      </aside>

      {/* Main Content Area */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top Context Bar — compact single row (< 56px), zero tablet/mobile overlap */}
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
              <div className="hidden min-w-0 max-w-md flex-1 sm:block">
                <button
                  type="button"
                  onClick={openSearch}
                  aria-label={t("search.dialogTitle")}
                  className="border-input bg-background text-muted-foreground hover:bg-secondary/60 hover:text-foreground focus-visible:ring-ring flex h-9 w-full min-w-0 items-center justify-between gap-2 overflow-hidden rounded-md border px-3 text-sm transition-colors focus-visible:ring-2 focus-visible:outline-none"
                >
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <Search className="size-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">{t("search.triggerPlaceholder")}</span>
                  </span>
                  <kbd className="border-border bg-muted text-muted-foreground hidden shrink-0 rounded border px-1.5 py-0.5 font-mono text-[11px] font-medium lg:inline-block">
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
              prefetch={false}
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
                  aria-label={vi ? "Tạo mới" : "Quick create"}
                >
                  <Plus className="size-4" aria-hidden="true" />
                  <span className="hidden sm:inline">
                    {vi ? "Tạo mới" : "Create"}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  {vi ? "Tạo nhanh" : "Quick Create"}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/sets/new" prefetch={false}>
                    <Plus className="size-4" aria-hidden="true" />
                    <span>{t("library.newSet")}</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/import" prefetch={false}>
                    <Upload className="size-4" aria-hidden="true" />
                    <span>{t("library.importSet")}</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/library?create=folder" prefetch={false}>
                    <FolderPlus className="size-4" aria-hidden="true" />
                    <span>{t("library.newFolder")}</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/exams/new" prefetch={false}>
                    <FileCheck2 className="size-4" aria-hidden="true" />
                    <span>{vi ? "Tạo đề thi thử" : "Create Mock Exam"}</span>
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
                <Link href="/login" prefetch={false}>
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
                    className="min-h-11 min-w-11 gap-2 rounded-full px-1.5 sm:min-h-9 sm:min-w-0 lg:pr-2 lg:pl-1"
                    aria-label={vi ? "Menu tài khoản" : "Account menu"}
                  >
                    <Avatar className="size-7">
                      {profile?.avatar_url ? (
                        <AvatarImage src={profile.avatar_url} alt={displayName} />
                      ) : null}
                      <AvatarFallback className="bg-primary/10 text-primary text-xs">
                        {getInitials(profile?.display_name, profile?.email)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="hidden max-w-28 truncate text-xs font-medium lg:inline">
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
                    <Link href="/profile" prefetch={false}>
                      <User className="size-4" aria-hidden="true" />
                      <span>{t("settings.profileTab")}</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/settings" prefetch={false}>
                      <Settings className="size-4" aria-hidden="true" />
                      <span>{t("nav.settings")}</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem asChild>
                    <Link href="/history" prefetch={false}>
                      <Clock className="size-4" aria-hidden="true" />
                      <span>{t("nav.history")}</span>
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={openHelp} className="hidden lg:flex">
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

        {/* Primary Page Content — generous mobile bottom padding so bottom nav never clips */}
        <main
          id="main-content"
          className="mx-auto w-full max-w-6xl flex-1 px-4 pt-5 pb-[calc(6.5rem+env(safe-area-inset-bottom,0px))] sm:px-6 sm:pt-6 md:pb-24 lg:pb-10"
        >
          {children}
        </main>
      </div>

      {/* Mobile 4-Tab Bottom Navigation (< 1024px) — Crisp Vietnamese diacritics & >=44px targets */}
      <nav
        aria-label={vi ? "Điều hướng di động" : "Mobile navigation"}
        className="border-border bg-card/95 fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur-xs lg:hidden"
        style={{ paddingBottom: "max(0.25rem, env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="grid h-16 grid-cols-4 items-stretch px-1">
          {mobilePrimaryTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                prefetch={tab.prefetch}
                aria-current={tab.active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 flex-col items-center justify-center gap-1 border-t-2 px-1 py-1.5 text-xs font-medium transition-colors",
                  tab.active
                    ? "border-primary text-primary font-semibold"
                    : "text-muted-foreground hover:text-foreground border-transparent",
                )}
              >
                <Icon className="size-5 shrink-0" aria-hidden="true" />
                <span className="max-w-full truncate leading-normal">{tab.label}</span>
              </Link>
            );
          })}

          <Sheet open={personalSheetOpen} onOpenChange={setPersonalSheetOpen}>
            <SheetTrigger asChild>
              <button
                type="button"
                aria-current={isPersonalRoute ? "page" : undefined}
                className={cn(
                  "flex min-h-11 flex-col items-center justify-center gap-1 border-t-2 px-1 py-1.5 text-xs font-medium transition-colors",
                  isPersonalRoute
                    ? "border-primary text-primary font-semibold"
                    : "text-muted-foreground hover:text-foreground border-transparent",
                )}
                aria-label={vi ? "Cá nhân" : "Personal"}
              >
                <User className="size-5 shrink-0" aria-hidden="true" />
                <span className="max-w-full truncate leading-normal">
                  {vi ? "Cá nhân" : "Me"}
                </span>
              </button>
            </SheetTrigger>
            <SheetContent
              side="bottom"
              className="max-h-[82dvh] overflow-y-auto overscroll-contain rounded-t-2xl pb-[max(1.5rem,env(safe-area-inset-bottom,0px))]"
            >
              <SheetHeader>
                <SheetTitle>{vi ? "Cá nhân & Tiện ích" : "Personal"}</SheetTitle>
                <SheetDescription>
                  {vi
                    ? "Ôn lỗi sai, lịch sử thi, thống kê, bạn bè và cài đặt học ngoại tuyến."
                    : "Mistakes review, exam history, statistics, sharing, and offline settings."}
                </SheetDescription>
              </SheetHeader>

              <div className="mt-2 flex flex-col gap-2">
                {!isExamRoute && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setPersonalSheetOpen(false);
                      openSearch();
                    }}
                    className="text-muted-foreground min-h-11 w-full justify-start gap-2 font-normal"
                  >
                    <Search className="size-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">{t("search.triggerPlaceholder")}</span>
                  </Button>
                )}

                <Link
                  href={isOnline ? "/settings?tab=offline" : "/offline"}
                  prefetch={false}
                  onClick={() => setPersonalSheetOpen(false)}
                  className={cn(
                    "flex min-h-11 items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm font-medium",
                    !isOnline
                      ? "border-warning/40 bg-warning-subtle text-warning-subtle-foreground"
                      : "border-border bg-card text-foreground hover:bg-secondary",
                  )}
                >
                  <span className="flex items-center gap-2">
                    {isOnline ? (
                      <Wifi className="text-success size-4 shrink-0" aria-hidden="true" />
                    ) : (
                      <WifiOff className="size-4 shrink-0" aria-hidden="true" />
                    )}
                    <span>
                      {vi ? "Cài đặt & Ngoại tuyến" : "Settings & Offline"}
                    </span>
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {!isOnline
                      ? t("pwa.offline")
                      : pendingSyncCount > 0
                        ? t("pwa.pendingSyncCount", { count: pendingSyncCount })
                        : t("pwa.online")}
                  </span>
                </Link>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                {mobilePersonalLinks.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      prefetch={false}
                      onClick={() => setPersonalSheetOpen(false)}
                      aria-current={item.active ? "page" : undefined}
                      className={cn(
                        "flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
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

              {profile && (
                <>
                  <Separator className="my-3" />
                  <div className="flex items-center justify-between gap-3 pb-1">
                    <div className="min-w-0">
                      <p className="text-foreground truncate text-sm font-semibold">
                        {displayName}
                      </p>
                      {profile.email && (
                        <p className="text-muted-foreground truncate text-xs">
                          {profile.email}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={signingOut}
                      onClick={() => {
                        setPersonalSheetOpen(false);
                        void handleSignOut();
                      }}
                      className="text-destructive border-destructive/30 hover:bg-destructive-subtle min-h-11 shrink-0"
                    >
                      <LogOut className="size-4" aria-hidden="true" />
                      <span>{t("nav.signOut")}</span>
                    </Button>
                  </div>
                </>
              )}
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
