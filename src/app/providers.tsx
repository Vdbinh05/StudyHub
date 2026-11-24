"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import { ThemeProvider } from "next-themes";
import { I18nProvider, useI18n } from "@/lib/i18n";
import type { Locale } from "@/types/domain";

const LazyOfflinePwaProvider = dynamic(
  () => import("@/components/pwa/PwaProvider").then((mod) => mod.PwaProvider),
  { ssr: true },
);

const EXACT_ROUTE_TITLES: Record<string, { vi: string; en: string }> = {
  "/": {
    vi: "StudyHub — Nền tảng tự học & luyện thi cá nhân",
    en: "StudyHub — Personal Self-Study & Exam Platform",
  },
  "/login": { vi: "Đăng nhập | StudyHub", en: "Sign in | StudyHub" },
  "/register": { vi: "Đăng ký | StudyHub", en: "Sign up | StudyHub" },
  "/forgot-password": {
    vi: "Quên mật khẩu | StudyHub",
    en: "Forgot password | StudyHub",
  },
  "/reset-password": {
    vi: "Đặt lại mật khẩu | StudyHub",
    en: "Reset password | StudyHub",
  },
  "/dashboard": { vi: "Tổng quan | StudyHub", en: "Dashboard | StudyHub" },
  "/library": { vi: "Thư viện học phần | StudyHub", en: "Library | StudyHub" },
  "/folders": { vi: "Thư mục | StudyHub", en: "Folders | StudyHub" },
  "/import": {
    vi: "Nhập câu hỏi từ file | StudyHub",
    en: "Import questions | StudyHub",
  },
  "/sets/new": {
    vi: "Tạo học phần mới | StudyHub",
    en: "Create study set | StudyHub",
  },
  "/exams": {
    vi: "Đề & Chu kỳ thi | StudyHub",
    en: "Exams & Coverage Cycles | StudyHub",
  },
  "/exams/new": {
    vi: "Thi thử tùy chỉnh | StudyHub",
    en: "Custom Exam Builder | StudyHub",
  },
  "/practice": {
    vi: "Luyện tập tùy chọn | StudyHub",
    en: "Custom Practice | StudyHub",
  },
  "/review": {
    vi: "Ôn tập & Câu đã sai | StudyHub",
    en: "Review & Mistakes | StudyHub",
  },
  "/starred": {
    vi: "Câu hỏi đánh dấu sao | StudyHub",
    en: "Starred Questions | StudyHub",
  },
  "/history": {
    vi: "Lịch sử học tập & Thi thử | StudyHub",
    en: "Study & Exam History | StudyHub",
  },
  "/statistics": {
    vi: "Thống kê học tập | StudyHub",
    en: "Study Statistics | StudyHub",
  },
  "/shared": {
    vi: "Được chia sẻ với tôi | StudyHub",
    en: "Shared with me | StudyHub",
  },
  "/friends": {
    vi: "Bạn bè & Chia sẻ | StudyHub",
    en: "Friends & Sharing | StudyHub",
  },
  "/profile": {
    vi: "Hồ sơ cá nhân | StudyHub",
    en: "Profile | StudyHub",
  },
  "/settings": { vi: "Cài đặt | StudyHub", en: "Settings | StudyHub" },
  "/offline": { vi: "Học ngoại tuyến | StudyHub", en: "Offline Study | StudyHub" },
};

function resolveLocalizedTitle(pathname: string, locale: Locale): string | null {
  const exact = EXACT_ROUTE_TITLES[pathname];
  if (exact) return exact[locale];

  if (/^\/sets\/[^/]+\/edit$/.test(pathname)) {
    return locale === "vi"
      ? "Chỉnh sửa câu hỏi | StudyHub"
      : "Edit questions | StudyHub";
  }
  if (/^\/sets\/[^/]+\/import$/.test(pathname)) {
    return locale === "vi"
      ? "Nhập câu hỏi | StudyHub"
      : "Import questions | StudyHub";
  }
  if (/^\/sets\/[^/]+\/flashcards$/.test(pathname)) {
    return "Flashcards | StudyHub";
  }
  if (/^\/sets\/[^/]+\/learn$/.test(pathname)) {
    return locale === "vi" ? "Học thích ứng | StudyHub" : "Adaptive Learn | StudyHub";
  }
  if (/^\/sets\/[^/]+\/practice$/.test(pathname)) {
    return locale === "vi" ? "Luyện trắc nghiệm | StudyHub" : "Practice | StudyHub";
  }
  if (/^\/sets\/[^/]+\/write$/.test(pathname)) {
    return locale === "vi" ? "Gõ đáp án | StudyHub" : "Write Mode | StudyHub";
  }
  if (/^\/sets\/[^/]+\/spell$/.test(pathname)) {
    return locale === "vi" ? "Nghe & Gõ (Spell) | StudyHub" : "Spell Mode | StudyHub";
  }
  if (/^\/sets\/[^/]+\/match$/.test(pathname)) {
    return locale === "vi" ? "Ghép thẻ | StudyHub" : "Match Mode | StudyHub";
  }
  if (/^\/sets\/[^/]+\/diagrams$/.test(pathname)) {
    return locale === "vi" ? "Sơ đồ tương tác | StudyHub" : "Interactive Diagrams | StudyHub";
  }
  if (/^\/diagrams\/[^/]+\/edit$/.test(pathname)) {
    return locale === "vi" ? "Biên tập sơ đồ | StudyHub" : "Edit Diagram | StudyHub";
  }
  if (/^\/diagrams\/[^/]+\/study$/.test(pathname)) {
    return locale === "vi" ? "Học sơ đồ tương tác | StudyHub" : "Diagram Study | StudyHub";
  }
  if (/^\/sets\/[^/]+\/test$/.test(pathname)) {
    return locale === "vi" ? "Phòng thi thử | StudyHub" : "Mock Exam | StudyHub";
  }
  if (
    /^\/sets\/[^/]+\/results\/[^/]+$/.test(pathname) ||
    /^\/exams\/[^/]+\/results$/.test(pathname)
  ) {
    return locale === "vi" ? "Kết quả bài thi | StudyHub" : "Exam Results | StudyHub";
  }
  if (/^\/exams\/[^/]+$/.test(pathname)) {
    return locale === "vi" ? "Đang làm bài thi | StudyHub" : "Live Exam | StudyHub";
  }
  if (pathname.startsWith("/share/")) {
    return locale === "vi"
      ? "Liên kết chia sẻ học phần | StudyHub"
      : "Shared Study Set | StudyHub";
  }
  return null;
}

function DocumentTitleSync() {
  const { locale } = useI18n();
  const pathname = usePathname() ?? "/";

  React.useEffect(() => {
    const nextTitle = resolveLocalizedTitle(pathname, locale);
    if (!nextTitle) return;

    const applyTitle = () => {
      if (document.title !== nextTitle) {
        document.title = nextTitle;
      }
    };

    applyTitle();
    const rafId = window.requestAnimationFrame(applyTitle);

    let titleObserver: MutationObserver | null = null;
    let headObserver: MutationObserver | null = null;

    if (typeof MutationObserver !== "undefined" && document.head) {
      const observeCurrentTitle = () => {
        titleObserver?.disconnect();
        const titleEl = document.head.querySelector("title");
        if (titleEl) {
          titleObserver = new MutationObserver(applyTitle);
          titleObserver.observe(titleEl, {
            childList: true,
            characterData: true,
            subtree: true,
          });
        }
      };

      observeCurrentTitle();
      headObserver = new MutationObserver((mutations) => {
        let titleChanged = false;
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (node.nodeName === "TITLE") {
              titleChanged = true;
              break;
            }
          }
          if (!titleChanged) {
            for (const node of mutation.removedNodes) {
              if (node.nodeName === "TITLE") {
                titleChanged = true;
                break;
              }
            }
          }
          if (titleChanged) break;
        }
        if (titleChanged) {
          observeCurrentTitle();
          applyTitle();
        }
      });
      headObserver.observe(document.head, { childList: true });
    }

    return () => {
      window.cancelAnimationFrame(rafId);
      titleObserver?.disconnect();
      headObserver?.disconnect();
    };
  }, [pathname, locale]);

  return null;
}

function SkipToContentLink() {
  const { t } = useI18n();
  return (
    <a href="#main-content" className="skip-to-content">
      {t("common.skipToContent")}
    </a>
  );
}

/**
 * Only the standalone `/offline` route lives outside `src/app/(app)/` while still
 * needing `PwaProvider`. Loading it dynamically here keeps `/` and `/login` free of
 * PWA/offline/IDB runtime code.
 */
function RouteScopedPwaBridge({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  if (pathname === "/offline") {
    return <LazyOfflinePwaProvider>{children}</LazyOfflinePwaProvider>;
  }
  return <>{children}</>;
}

/**
 * Lightweight Root Providers for public routes (`/`, `/login`, `/register`, `/share/*`).
 * Authenticated app infrastructure (QueryClient, Preferences, PWA, Shortcuts, Tooltip,
 * Toaster) lives strictly in `src/app/(app)/authenticated-providers.tsx`.
 */
export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      <I18nProvider defaultLocale="vi">
        <SkipToContentLink />
        <DocumentTitleSync />
        <RouteScopedPwaBridge>{children}</RouteScopedPwaBridge>
      </I18nProvider>
    </ThemeProvider>
  );
}
