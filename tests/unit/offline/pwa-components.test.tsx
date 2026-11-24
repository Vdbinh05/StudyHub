import "fake-indexeddb/auto";
import fs from "node:fs";
import path from "node:path";
import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n";
import {
  clearUserOfflineData,
  closeAllOfflineDbs,
  getAllDownloadedSets,
  getLocalNote,
  putDownloadedSet,
  putLocalNote,
} from "@/lib/offline/db";
import { InstallAppCard } from "@/components/pwa/InstallAppCard";
import { OfflineDownloadButton } from "@/components/pwa/OfflineDownloadButton";
import { OfflineManagerPanel } from "@/components/pwa/OfflineManagerPanel";
import {
  isActiveExamRoutePath,
  PwaProvider,
} from "@/components/pwa/PwaProvider";

const mockUsePathname = vi.fn<() => string>(() => "/dashboard");

vi.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
  useSearchParams: () => new URLSearchParams(),
}));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const SET_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const Q_1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function renderWithI18n(ui: React.ReactElement) {
  return render(<I18nProvider defaultLocale="en">{ui}</I18nProvider>);
}

afterEach(async () => {
  cleanup();
  mockUsePathname.mockReturnValue("/dashboard");
  await clearUserOfflineData(USER_ID);
  await closeAllOfflineDbs();
  vi.restoreAllMocks();
});

describe("PWA Components (`src/components/pwa/*`)", () => {
  it("accurately identifies active timed exam routes for SW update deferral", () => {
    expect(isActiveExamRoutePath("/exams/attempt-123")).toBe(true);
    expect(isActiveExamRoutePath("/sets/set-1/test")).toBe(true);
    expect(isActiveExamRoutePath("/exams")).toBe(false);
    expect(isActiveExamRoutePath("/exams/new")).toBe(false);
    expect(isActiveExamRoutePath("/exams/attempt-123/results")).toBe(false);
    expect(isActiveExamRoutePath("/dashboard")).toBe(false);
    expect(isActiveExamRoutePath("/offline")).toBe(false);
  });

  it("renders genuine Chromium install button, iOS Safari guide, installed badge, and honest unsupported fallback", async () => {
    // 1. Chromium prompt ready
    const onInstallClick = vi.fn().mockResolvedValue("accepted");
    const { rerender } = renderWithI18n(
      <InstallAppCard
        overrideCanInstall={true}
        overrideIos={false}
        overrideStandalone={false}
        onInstallClick={onInstallClick}
      />,
    );
    const installBtn = screen.getByRole("button", { name: /install app/i });
    fireEvent.click(installBtn);
    await waitFor(() => expect(onInstallClick).toHaveBeenCalledTimes(1));

    // 2. iOS Safari guide (no broken install button)
    rerender(
      <I18nProvider defaultLocale="en">
        <InstallAppCard
          overrideCanInstall={false}
          overrideIos={true}
          overrideStandalone={false}
        />
      </I18nProvider>,
    );
    expect(screen.getByTestId("ios-install-guide")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /install app/i })).toBeNull();

    // 3. Unsupported browser note (no broken install button)
    rerender(
      <I18nProvider defaultLocale="en">
        <InstallAppCard
          overrideCanInstall={false}
          overrideIos={false}
          overrideStandalone={false}
        />
      </I18nProvider>,
    );
    expect(screen.getByTestId("install-unsupported-note")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /install app/i })).toBeNull();

    // 4. Already installed standalone badge
    rerender(
      <I18nProvider defaultLocale="en">
        <InstallAppCard overrideStandalone={true} />
      </I18nProvider>,
    );
    expect(screen.getByText(/installed/i)).toBeInTheDocument();
  });

  it("defers Service Worker update reloads during active exams and posts APPLY_UPDATE on safe routes", async () => {
    const postMessage = vi.fn();
    const fakeWaiting = { postMessage } as unknown as ServiceWorker;
    const registerMock = vi.fn().mockResolvedValue({
      waiting: fakeWaiting,
      installing: null,
      addEventListener: vi.fn(),
    });

    Object.defineProperty(navigator, "serviceWorker", {
      value: {
        register: registerMock,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        controller: {},
      },
      configurable: true,
    });

    // Active exam route -> MUST defer update (no Update button!)
    mockUsePathname.mockReturnValue("/exams/live-attempt-1");
    const { unmount } = renderWithI18n(
      <PwaProvider userId={USER_ID}>
        <div>Active Exam</div>
      </PwaProvider>,
    );

    await waitFor(() =>
      expect(screen.getByTestId("pwa-update-banner")).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: /update now/i })).toBeNull();
    expect(postMessage).not.toHaveBeenCalled();
    unmount();

    // Safe dashboard route -> Update button appears and sends APPLY_UPDATE on explicit click
    mockUsePathname.mockReturnValue("/dashboard");
    renderWithI18n(
      <PwaProvider userId={USER_ID}>
        <div>Dashboard</div>
      </PwaProvider>,
    );

    const updateBtn = await screen.findByRole("button", { name: /update now/i });
    fireEvent.click(updateBtn);
    expect(postMessage).toHaveBeenCalledWith({ type: "APPLY_UPDATE" });
  });

  it("renders OfflineManagerPanel with downloaded sets, note conflict resolution, privacy disclosure, and confirmed clear data", async () => {
    await putDownloadedSet(USER_ID, {
      user_id: USER_ID,
      set_id: SET_ID,
      title: "Offline Aviation Set",
      subject: "Meteorology",
      description: null,
      set_type: "mixed",
      visibility: "private",
      source_language: "vi",
      content_version: 1,
      server_updated_at: "2026-11-24T10:00:00.000Z",
      downloaded_at: "2026-11-24T11:00:00.000Z",
      downloaded_chapters: null,
      question_count: 24,
      diagram_count: 1,
      media_count: 3,
      media_bytes: 512000,
      estimated_total_bytes: 520000,
      include_media: true,
      status: "ready",
      failed_media_urls: [],
      last_error: null,
      passages: [],
    });

    await putLocalNote(USER_ID, {
      question_id: Q_1,
      study_set_id: SET_ID,
      user_id: USER_ID,
      content_text: "Offline draft text",
      content_rich: null,
      version: 2,
      base_version: 1,
      dirty: true,
      updated_at: "2026-11-24T12:00:00.000Z",
      conflict: {
        detected_at: "2026-11-24T12:05:00.000Z",
        event_id: "evt-conflict-1",
        local_text: "Offline draft text",
        local_rich: null,
        local_updated_at: "2026-11-24T12:00:00.000Z",
        local_base_version: 1,
        server_text: "Server canonical text v3",
        server_rich: null,
        server_version: 3,
        server_updated_at: "2026-11-24T12:01:00.000Z",
      },
    });

    renderWithI18n(<OfflineManagerPanel userId={USER_ID} />);

    // Displays downloaded set, privacy disclosure, and both versions of the note conflict
    expect(await screen.findByText("Offline Aviation Set")).toBeInTheDocument();
    expect(screen.getByTestId("offline-privacy-disclosure")).toBeInTheDocument();
    expect(screen.getByTestId("note-conflicts-section")).toBeInTheDocument();
    expect(screen.getByText("Offline draft text")).toBeInTheDocument();
    expect(screen.getByText("Server canonical text v3")).toBeInTheDocument();

    // Resolve conflict by keeping server version
    fireEvent.click(screen.getByRole("button", { name: /keep server/i }));
    await waitFor(() =>
      expect(screen.queryByTestId("note-conflicts-section")).toBeNull(),
    );
    const resolvedNote = await getLocalNote(USER_ID, Q_1);
    expect(resolvedNote?.content_text).toBe("Server canonical text v3");
    expect(resolvedNote?.conflict).toBeNull();

    // Clear Local Data opens confirmation AlertDialog and clears IndexedDB upon confirm
    fireEvent.click(screen.getByTestId("clear-local-data-button"));
    const confirmAction = await screen.findByTestId("confirm-clear-local-data");
    fireEvent.click(confirmAction);

    await waitFor(async () => {
      const remainingSets = await getAllDownloadedSets(USER_ID);
      expect(remainingSets).toHaveLength(0);
    });
  });

  it("displays text-only media guard inside OfflineDownloadButton when set has required media", async () => {
    renderWithI18n(
      <OfflineDownloadButton
        userId={USER_ID}
        setId={SET_ID}
        setTitle="Visual Anatomy Set"
        chapters={["Ch 1", "Ch 2"]}
        questionCount={12}
        estimatedMediaCount={6}
        hasRequiredMedia={true}
      />,
    );

    fireEvent.click(screen.getByTestId("offline-download-trigger"));
    expect(
      await screen.findByTestId("text-only-guard-notice"),
    ).toBeInTheDocument();
  });

  it("keeps PwaProvider free of static @supabase/client and @/lib/offline barrel imports (V3-PERF-03)", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/components/pwa/PwaProvider.tsx"),
      "utf8",
    );
    expect(source).not.toMatch(/^import\s+[^t].*from\s+["']@\/lib\/supabase\/client["']/m);
    expect(source).not.toMatch(/^import\s+\{[^}]*\}\s+from\s+["']@\/lib\/offline["']/m);
    expect(source).toContain('import("@/lib/supabase/client")');
    expect(source).toContain('import("@/lib/offline/db")');
  });
});
