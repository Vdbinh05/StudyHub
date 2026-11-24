"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import {
  AlertCircle,
  BarChart3,
  BookMarked,
  Clock,
  FileCheck2,
  FolderPlus,
  History,
  Home,
  Layers,
  Library,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Share2,
  Star,
  Upload,
  User,
  Users,
} from "lucide-react";
import { toast } from "sonner";
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
import { Input } from "@/components/ui/input";
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
import { cn } from "@/lib/utils";
import type { Locale, Profile, ThemePreference, UserPreferences } from "@/types/domain";
import { apiFetch, ApiError, isSupabaseConfiguredClient } from "./api-client";
import { BrandLogo } from "./brand-logo";
import { LanguageToggle } from "./language-toggle";
import { ThemeToggle } from "./theme-toggle";

interface NavItem {
  id: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  labelVi: string;
  labelEn: string;
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
    labelVi: "Thư viện của tôi",
    labelEn: "My Library",
    group: "core",
    match: (p, sp) =>
      (p === "/library" && !sp.get("type") && !sp.get("action")) ||
      p.startsWith("/folders/"),
  },
  {
    id: "question-bank",
    href: "/library?type=multiple_choice",
    icon: BookMarked,
    labelVi: "Ngân hàng câu hỏi",
    labelEn: "Question Bank",
    group: "core",
    match: (p, sp) => p === "/library" && sp.get("type") === "multiple_choice",
  },
  {
    id: "flashcards",
    href: "/library?type=flashcards",
    icon: Layers,
    labelVi: "Flashcards",
    labelEn: "Flashcards",
    group: "study",
    match: (p, sp) => p === "/library" && sp.get("type") === "flashcards",
  },
  {
    id: "mock-exams",
    href: "/library?action=test",
    icon: FileCheck2,
    labelVi: "Thi thử",
    labelEn: "Mock Exams",
    group: "study",
    match: (p, sp) => p === "/library" && sp.get("action") === "test",
  },
  {
    id: "review",
    href: "/review",
    icon: RotateCcw,
    labelVi: "Câu hỏi đã sai",
    labelEn: "Review Mistakes",
    group: "study",
    match: (p) => p === "/review",
  },
  {
    id: "starred",
    href: "/starred",
    icon: Star,
    labelVi: "Câu hỏi đánh dấu",
    labelEn: "Starred",
    group: "study",
    match: (p) => p === "/starred",
  },
  {
    id: "history",
    href: "/history",
    icon: History,
    labelVi: "Lịch sử học tập",
    labelEn: "Study History",
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
    labelVi: "Được chia sẻ với tôi",
    labelEn: "Shared with Me",
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
    match: (p) => p === "/settings" || p === "/profile",
  },
];

const FOCUS_ROUTE_PATTERN =
  /^\/sets\/[^/]+\/(flashcards|learn|practice|write|match|test)(?:\/|$)/;

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
  const { locale, setLocale, t } = useI18n();
  const { setTheme } = useTheme();

  const collapsed = React.useSyncExternalStore(
    subscribeSidebar,
    readSidebarCollapsed,
    () => false,
  );
  const [mobileMoreOpen, setMobileMoreOpen] = React.useState(false);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [signingOut, setSigningOut] = React.useState(false);
  const syncedPrefsRef = React.useRef(false);

  const toggleSidebar = () => {
    writeSidebarCollapsed(!collapsed);
  };

  const isFocusRoute = FOCUS_ROUTE_PATTERN.test(pathname);
  const supabaseConfigured = isSupabaseConfiguredClient();

  const { data: profileData, error: profileError } = useQuery<ProfileBundle | null>({
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

  const { data: prefsData } = useQuery<UserPreferences | null>({
    queryKey: ["user-preferences"],
    enabled: supabaseConfigured && !isFocusRoute && Boolean(profileData?.profile),
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      try {
        const res = await apiFetch<UserPreferences>("/api/preferences");
        return res.data;
      } catch {
        return null;
      }
    },
  });

  const activePreferences = prefsData ?? profileData?.preferences ?? null;

  React.useEffect(() => {
    if (!activePreferences || syncedPrefsRef.current) return;
    syncedPrefsRef.current = true;
    if (activePreferences.language === "vi" || activePreferences.language === "en") {
      setLocale(activePreferences.language);
    }
    if (
      activePreferences.theme === "light" ||
      activePreferences.theme === "dark" ||
      activePreferences.theme === "system"
    ) {
      setTheme(activePreferences.theme);
    }
  }, [activePreferences, setLocale, setTheme]);

  const persistPreference = React.useCallback(
    async (patch: Partial<Pick<UserPreferences, "language" | "theme">>) => {
      if (!supabaseConfigured || !profileData?.profile) return;
      try {
        await apiFetch("/api/preferences", {
          method: "PATCH",
          body: JSON.stringify(patch),
        });
        queryClient.invalidateQueries({ queryKey: ["user-preferences"] });
      } catch {
        // Non-blocking preference sync
      }
    },
    [supabaseConfigured, profileData?.profile, queryClient],
  );

  const handleGlobalSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = searchQuery.trim();
    const target = trimmed
      ? `/library?search=${encodeURIComponent(trimmed)}`
      : "/library";
    router.push(target);
  };

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
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

  if (isFocusRoute) {
    return (
      <div className="bg-background text-foreground min-h-screen overflow-x-clip">
        <main id="main-content" className="min-h-screen">
          {children}
        </main>
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
        className={cn(
          "group relative flex min-h-10 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
          active
            ? "bg-accent text-accent-foreground font-semibold"
            : "text-muted-foreground hover:bg-secondary hover:text-foreground",
          collapsed && "justify-center px-2",
        )}
      >
        {active && (
          <span
            aria-hidden="true"
            className="bg-primary absolute inset-y-1.5 left-0 w-1 rounded-r-full"
          />
        )}
        <Icon className="size-4 shrink-0" aria-hidden="true" />
        {!collapsed && <span className="truncate">{label}</span>}
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

  const mobileTabs = [
    {
      href: "/dashboard",
      icon: Home,
      label: locale === "vi" ? "Tổng quan" : "Home",
      active: pathname === "/dashboard",
    },
    {
      href: "/library",
      icon: Library,
      label: locale === "vi" ? "Thư viện" : "Library",
      active: pathname.startsWith("/library") || pathname.startsWith("/folders"),
    },
    {
      href: "/review",
      icon: RotateCcw,
      label: locale === "vi" ? "Ôn tập" : "Review",
      active: pathname === "/review" || pathname === "/starred",
    },
    {
      href: "/statistics",
      icon: BarChart3,
      label: locale === "vi" ? "Thống kê" : "Stats",
      active: pathname === "/statistics" || pathname === "/history",
    },
  ];

  return (
    <div className="bg-background text-foreground flex min-h-screen w-full overflow-x-clip">
      {/* Desktop Collapsible Sidebar */}
      <aside
        aria-label={locale === "vi" ? "Điều hướng chính" : "Primary navigation"}
        className={cn(
          "border-sidebar-border bg-sidebar hidden shrink-0 flex-col border-r lg:sticky lg:top-0 lg:flex lg:h-screen",
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
                <Button asChild size="icon" className="w-full">
                  <Link href="/sets/new" aria-label={t("library.newSet")}>
                    <Plus className="size-4" aria-hidden="true" />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="right">{t("library.newSet")}</TooltipContent>
            </Tooltip>
          ) : (
            <Button asChild className="w-full justify-start gap-2">
              <Link href="/sets/new">
                <Plus className="size-4" aria-hidden="true" />
                <span>{t("library.newSet")}</span>
              </Link>
            </Button>
          )}
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-2.5 pb-4">
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

            <form
              onSubmit={handleGlobalSearch}
              role="search"
              className="relative hidden max-w-md flex-1 sm:block"
            >
              <Search
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
                aria-hidden="true"
              />
              <Input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                enterKeyHint="search"
                placeholder={t("library.searchPlaceholder")}
                aria-label={t("library.searchPlaceholder")}
                className="bg-background h-9 pl-9"
              />
            </form>
          </div>

          <div className="flex shrink-0 items-center gap-1 sm:gap-1.5">
            {/* Quick Create Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  className="h-9 gap-1.5 px-2.5 sm:px-3"
                  aria-label={locale === "vi" ? "Tạo nhanh" : "Quick create"}
                >
                  <Plus className="size-4" aria-hidden="true" />
                  <span className="hidden sm:inline">
                    {locale === "vi" ? "Tạo mới" : "Create"}
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel>
                  {locale === "vi" ? "Tạo nhanh" : "Quick Create"}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/sets/new">
                    <Plus className="size-4" aria-hidden="true" />
                    <span>{t("library.newSet")}</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/library?create=folder">
                    <FolderPlus className="size-4" aria-hidden="true" />
                    <span>{t("library.newFolder")}</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/library?action=import">
                    <Upload className="size-4" aria-hidden="true" />
                    <span>{t("library.importSet")}</span>
                  </Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <LanguageToggle
              onPersist={(next: Locale) => void persistPreference({ language: next })}
            />
            <ThemeToggle
              compact
              onPersist={(next: ThemePreference) => void persistPreference({ theme: next })}
            />

            {/* User Menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 gap-2 rounded-full pr-2 pl-1"
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
                    <span>{locale === "vi" ? "Lịch sử học tập" : "Study History"}</span>
                  </Link>
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
          </div>
        </header>

        {showConfigBanner && (
          <div
            role="status"
            className="border-warning/30 bg-warning-subtle text-warning-subtle-foreground flex items-center gap-2.5 border-b px-4 py-2.5 text-xs sm:px-6 sm:text-sm"
          >
            <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
            <span>
              {locale === "vi"
                ? "Supabase chưa được cấu hình (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY). Hãy thiết lập file .env.local để bật xác thực và lưu trữ dữ liệu thật."
                : "Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY). Configure .env.local to enable real authentication and database persistence."}
            </span>
          </div>
        )}

        {/* Primary Page Content */}
        <main
          id="main-content"
          className="mx-auto w-full max-w-7xl flex-1 px-4 pt-5 pb-24 sm:px-6 sm:pt-6 lg:pb-10"
        >
          {children}
        </main>
      </div>

      {/* Mobile One-Hand Bottom Navigation (< 1024px) */}
      <nav
        aria-label={locale === "vi" ? "Điều hướng di động" : "Mobile navigation"}
        className="border-border bg-card/95 fixed inset-x-0 bottom-0 z-40 border-t backdrop-blur-xs lg:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="grid h-16 grid-cols-5 items-center px-1">
          {mobileTabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={tab.active ? "page" : undefined}
                className={cn(
                  "flex min-h-11 flex-col items-center justify-center gap-1 rounded-lg px-1 py-1.5 text-[11px] font-medium transition-colors",
                  tab.active
                    ? "text-primary font-semibold"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="size-5 shrink-0" aria-hidden="true" />
                <span className="max-w-full truncate">{tab.label}</span>
              </Link>
            );
          })}

          <Sheet open={mobileMoreOpen} onOpenChange={setMobileMoreOpen}>
            <SheetTrigger asChild>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground flex min-h-11 flex-col items-center justify-center gap-1 rounded-lg px-1 py-1.5 text-[11px] font-medium transition-colors"
                aria-label={t("common.more")}
              >
                <Menu className="size-5 shrink-0" aria-hidden="true" />
                <span>{t("common.more")}</span>
              </button>
            </SheetTrigger>
            <SheetContent side="bottom" className="max-h-[82dvh] overflow-y-auto rounded-t-2xl">
              <SheetHeader>
                <SheetTitle>{locale === "vi" ? "Tất cả mục" : "Navigation"}</SheetTitle>
                <SheetDescription>
                  {locale === "vi"
                    ? "Truy cập nhanh các tính năng ôn tập, chia sẻ và cài đặt."
                    : "Quick access to study modes, sharing, and account settings."}
                </SheetDescription>
              </SheetHeader>

              <form onSubmit={(e) => { handleGlobalSearch(e); setMobileMoreOpen(false); }} className="relative mt-2">
                <Search
                  className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
                  aria-hidden="true"
                />
                <Input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  enterKeyHint="search"
                  placeholder={t("library.searchPlaceholder")}
                  aria-label={t("library.searchPlaceholder")}
                  className="pl-9"
                />
              </form>

              <div className="mt-3 grid grid-cols-2 gap-2">
                {NAV_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const active = item.match(pathname, searchParams);
                  const label = locale === "vi" ? item.labelVi : item.labelEn;
                  return (
                    <Link
                      key={item.id}
                      href={item.href}
                      onClick={() => setMobileMoreOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "flex min-h-11 items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors",
                        active
                          ? "border-primary/40 bg-accent text-accent-foreground font-semibold"
                          : "border-border bg-card text-foreground hover:bg-secondary",
                      )}
                    >
                      <Icon className="size-4 shrink-0" aria-hidden="true" />
                      <span className="truncate">{label}</span>
                    </Link>
                  );
                })}
              </div>

              <Separator className="my-3" />

              <div className="flex flex-wrap items-center justify-between gap-2 pb-2">
                <div className="flex items-center gap-2">
                  <LanguageToggle
                    onPersist={(next: Locale) => void persistPreference({ language: next })}
                  />
                  <ThemeToggle
                    onPersist={(next: ThemePreference) => void persistPreference({ theme: next })}
                  />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={signingOut}
                  onClick={() => {
                    setMobileMoreOpen(false);
                    void handleSignOut();
                  }}
                  className="text-destructive border-destructive/30 hover:bg-destructive-subtle"
                >
                  <LogOut className="size-4" aria-hidden="true" />
                  <span>{t("nav.signOut")}</span>
                </Button>
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
        <div className="bg-background min-h-screen w-full" aria-busy="true" />
      }
    >
      <AppShellInner>{children}</AppShellInner>
    </React.Suspense>
  );
}
