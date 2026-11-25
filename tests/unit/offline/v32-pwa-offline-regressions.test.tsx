import "fake-indexeddb/auto";
import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OfflinePage from "@/app/offline/page";
import { OfflineManagerPanel } from "@/components/pwa/OfflineManagerPanel";
import { OfflineStudyRunner } from "@/components/pwa/OfflineStudyRunner";
import {
  isFocusStudyOrExamRoutePath,
  isLiveExamAttemptRoutePath,
  PwaProvider,
  readStoredActiveUserId,
  usePwa,
  type PwaContextValue,
} from "@/components/pwa/PwaProvider";
import { I18nProvider } from "@/lib/i18n";
import { classifySyncEventStatus } from "@/lib/offline/conflict-resolver";
import {
  clearUserOfflineData,
  closeAllOfflineDbs,
  getActiveOfflineUserId,
  getDownloadedSet,
  getQuestionsForSet,
  listSyncQueue,
  putDiagramsForSet,
  putDownloadedSet,
  putMediaBlob,
  putQuestionsForSet,
} from "@/lib/offline/db";
import {
  clearActiveOfflineSessionState,
  formatOfflineSessionHash,
  parseOfflineSessionHash,
} from "@/lib/offline/offline-session";
import {
  computeSyncRetryDelayMs,
  enqueueOfflineEvent,
  syncPendingEvents,
} from "@/lib/offline/sync-queue";
import type {
  OfflineDiagramRecord,
  OfflineDownloadedSetRecord,
  OfflineQuestionRecord,
} from "@/lib/offline/types";

const mockUsePathname = vi.fn<() => string>(() => "/dashboard");
const mockSearchParams = vi.fn<() => URLSearchParams>(
  () => new URLSearchParams(),
);

vi.mock("next/navigation", () => ({
  usePathname: () => mockUsePathname(),
  useSearchParams: () => mockSearchParams(),
}));

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const SET_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const Q_IMG_CHOICE = "c1111111-1111-4111-8111-111111111111";
const Q_NUMERICAL = "c2222222-2222-4222-8222-222222222222";
const Q_ORDERING = "c3333333-3333-4333-8333-333333333333";
const Q_MATCHING = "c4444444-4444-4444-8444-444444444444";
const Q_BLANKS = "c5555555-5555-4555-8555-555555555555";
const Q_HOTSPOT = "c6666666-6666-4666-8666-666666666666";

function setNavigatorOnline(online: boolean): void {
  Object.defineProperty(navigator, "onLine", {
    value: online,
    configurable: true,
  });
}

function makeSet(userId: string, setId = SET_ID): OfflineDownloadedSetRecord {
  return {
    user_id: userId,
    set_id: setId,
    title: "V3.2 Offline Verification Set",
    subject: "Aviation",
    description: null,
    set_type: "mixed",
    visibility: "private",
    source_language: "vi",
    content_version: 2,
    server_updated_at: "2026-11-25T10:00:00.000Z",
    downloaded_at: "2026-11-25T11:00:00.000Z",
    downloaded_chapters: null,
    question_count: 6,
    diagram_count: 2,
    media_count: 4,
    media_bytes: 512,
    estimated_total_bytes: 4096,
    include_media: true,
    status: "ready",
    failed_media_urls: [],
    last_error: null,
    passages: [],
  };
}

function makeV3Questions(userId: string): OfflineQuestionRecord[] {
  const ts = "2026-11-25T10:00:00.000Z";
  return [
    {
      id: Q_IMG_CHOICE,
      user_id: userId,
      study_set_id: SET_ID,
      question_type: "image_choice",
      position: 0,
      chapter: "Ch 1",
      prompt: "Select BOTH correct cloud diagrams",
      prompt_image_url: null,
      back_text: null,
      back_image_url: null,
      explanation: "A and C are cumulus clouds.",
      hint: null,
      difficulty: "medium",
      source_metadata: {},
      type_payload: { type: "image_choice", selection_mode: "multiple" },
      created_at: ts,
      updated_at: ts,
      cached_at: ts,
      options: [
        {
          id: "opt-img-a",
          question_id: Q_IMG_CHOICE,
          study_set_id: SET_ID,
          position: 0,
          label: "A",
          content: "",
          image_url: "/api/uploads/signed-url?path=opt-a.png&redirect=1",
          is_correct: true,
          created_at: ts,
        },
        {
          id: "opt-img-b",
          question_id: Q_IMG_CHOICE,
          study_set_id: SET_ID,
          position: 1,
          label: "B",
          content: "",
          image_url: "/api/uploads/signed-url?path=opt-b.png&redirect=1",
          is_correct: false,
          created_at: ts,
        },
        {
          id: "opt-img-c",
          question_id: Q_IMG_CHOICE,
          study_set_id: SET_ID,
          position: 2,
          label: "C",
          content: "Cumulus",
          image_url: "/api/uploads/signed-url?path=opt-c.png&redirect=1",
          is_correct: true,
          created_at: ts,
        },
      ],
    },
    {
      id: Q_NUMERICAL,
      user_id: userId,
      study_set_id: SET_ID,
      question_type: "numerical",
      position: 1,
      chapter: "Ch 1",
      prompt: "Enter standard gravity with unit",
      prompt_image_url: null,
      back_text: null,
      back_image_url: null,
      explanation: null,
      hint: null,
      difficulty: "medium",
      source_metadata: {},
      type_payload: {
        type: "numerical",
        correct_value: 9.81,
        abs_tolerance: 0.05,
        unit: "m/s^2",
        unit_required: true,
      },
      created_at: ts,
      updated_at: ts,
      cached_at: ts,
    },
    {
      id: Q_ORDERING,
      user_id: userId,
      study_set_id: SET_ID,
      question_type: "ordering",
      position: 2,
      chapter: "Ch 1",
      prompt: "Order layers lowest to highest",
      prompt_image_url: null,
      back_text: null,
      back_image_url: null,
      explanation: null,
      hint: null,
      difficulty: "medium",
      source_metadata: {},
      type_payload: {
        type: "ordering",
        items: [
          { id: "ord-1", text: "Troposphere", correct_position: 0 },
          { id: "ord-2", text: "Stratosphere", correct_position: 1 },
        ],
      },
      created_at: ts,
      updated_at: ts,
      cached_at: ts,
    },
    {
      id: Q_MATCHING,
      user_id: userId,
      study_set_id: SET_ID,
      question_type: "matching",
      position: 3,
      chapter: "Ch 1",
      prompt: "Match instruments",
      prompt_image_url: null,
      back_text: null,
      back_image_url: null,
      explanation: null,
      hint: null,
      difficulty: "medium",
      source_metadata: {},
      type_payload: {
        type: "matching",
        pairs: [
          { id: "m1", left_text: "Barometer", right_id: "r1", right_text: "Pressure" },
          { id: "m2", left_text: "Anemometer", right_id: "r2", right_text: "Wind" },
        ],
      },
      created_at: ts,
      updated_at: ts,
      cached_at: ts,
    },
    {
      id: Q_BLANKS,
      user_id: userId,
      study_set_id: SET_ID,
      question_type: "fill_in_blank",
      position: 4,
      chapter: "Ch 1",
      prompt: "Complete ISA pressure",
      prompt_image_url: null,
      back_text: null,
      back_image_url: null,
      explanation: null,
      hint: null,
      difficulty: "easy",
      source_metadata: {},
      type_payload: {
        type: "fill_in_blank",
        template_text: "Sea level pressure is {{b1}} hPa.",
        blanks: [
          {
            blank_id: "b1",
            accepted_answers: ["1013.25", "1013"],
            match_mode: "case_insensitive",
          },
        ],
      },
      created_at: ts,
      updated_at: ts,
      cached_at: ts,
    },
    {
      id: Q_HOTSPOT,
      user_id: userId,
      study_set_id: SET_ID,
      question_type: "image_hotspot",
      position: 5,
      chapter: "Ch 1",
      prompt: "Tap the pitot tube",
      prompt_image_url: null,
      back_text: null,
      back_image_url: null,
      explanation: null,
      hint: null,
      difficulty: "medium",
      source_metadata: {},
      type_payload: {
        type: "image_hotspot",
        image_url: "/api/uploads/signed-url?path=pitot.png&redirect=1",
        target_hotspots: [
          {
            id: "t1",
            label: "Pitot tube",
            shape: "rect",
            geometry: { shape: "rect", x: 0.4, y: 0.4, width: 0.2, height: 0.2 },
          },
        ],
        require_all_targets: true,
      },
      created_at: ts,
      updated_at: ts,
      cached_at: ts,
    },
  ];
}

function makeTwoDiagrams(userId: string): OfflineDiagramRecord[] {
  const ts = "2026-11-25T10:00:00.000Z";
  return [
    {
      id: "diag-1",
      user_id: userId,
      study_set_id: SET_ID,
      owner_id: userId,
      title: "Diagram One",
      description: null,
      base_media_id: null,
      base_image_url: "/api/uploads/signed-url?path=diag1.png&redirect=1",
      image_width: 800,
      image_height: 600,
      content_version: 1,
      created_at: ts,
      updated_at: ts,
      cached_at: ts,
      hotspots: [
        {
          id: "hs-1",
          diagram_id: "diag-1",
          study_set_id: SET_ID,
          label: "Zone Alpha",
          accepted_alternatives: [],
          description: null,
          hint: null,
          shape: "rect",
          geometry: { shape: "rect", x: 0.0, y: 0.0, width: 0.4, height: 0.4 },
          sort_order: 0,
          created_at: ts,
          updated_at: ts,
        },
      ],
    },
    {
      id: "diag-2",
      user_id: userId,
      study_set_id: SET_ID,
      owner_id: userId,
      title: "Diagram Two",
      description: null,
      base_media_id: null,
      base_image_url: "/api/uploads/signed-url?path=diag2.png&redirect=1",
      image_width: 800,
      image_height: 600,
      content_version: 1,
      created_at: ts,
      updated_at: ts,
      cached_at: ts,
      hotspots: [
        {
          id: "hs-2",
          diagram_id: "diag-2",
          study_set_id: SET_ID,
          label: "Zone Bravo",
          accepted_alternatives: [],
          description: null,
          hint: null,
          shape: "rect",
          geometry: { shape: "rect", x: 0.5, y: 0.5, width: 0.4, height: 0.4 },
          sort_order: 0,
          created_at: ts,
          updated_at: ts,
        },
      ],
    },
  ];
}

beforeEach(() => {
  setNavigatorOnline(true);
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  mockUsePathname.mockReturnValue("/dashboard");
  mockSearchParams.mockReturnValue(new URLSearchParams());
});

afterEach(async () => {
  cleanup();
  clearActiveOfflineSessionState();
  await clearUserOfflineData(USER_A);
  await clearUserOfflineData(USER_B);
  await closeAllOfflineDbs();
  vi.restoreAllMocks();
});

describe("V3.2 Mobile, PWA & Offline Stability Regressions", () => {
  it("V32-001 (SEC-01): PwaProvider strictly trusts explicit userId (even null) and switches away from stale USER_A before opening USER_B", async () => {
    // Simulate stale localStorage pointer left by expired User A session
    window.localStorage.setItem("studyhub-offline-active-user", USER_A);
    await putDownloadedSet(USER_A, makeSet(USER_A));

    let observedCtx: PwaContextValue | null = null;
    function Inspector() {
      observedCtx = usePwa();
      return <div data-testid="active-uid">{observedCtx.activeUserId ?? "none"}</div>;
    }

    // 1. Explicit `null` must NEVER fall back to stale USER_A!
    const { rerender } = render(
      <I18nProvider defaultLocale="vi">
        <PwaProvider userId={null}>
          <Inspector />
        </PwaProvider>
      </I18nProvider>,
    );
    expect(screen.getByTestId("active-uid")).toHaveTextContent("none");
    await waitFor(() => {
      expect(readStoredActiveUserId()).toBeNull();
    });

    // 2. Re-seed stale pointer for USER_A, then mount with explicit USER_B -> must switch away cleanly
    window.localStorage.setItem("studyhub-offline-active-user", USER_A);
    rerender(
      <I18nProvider defaultLocale="vi">
        <PwaProvider userId={USER_B}>
          <Inspector />
        </PwaProvider>
      </I18nProvider>,
    );

    expect(screen.getByTestId("active-uid")).toHaveTextContent(USER_B);
    await waitFor(() => {
      expect(readStoredActiveUserId()).toBe(USER_B);
      expect(getActiveOfflineUserId()).toBe(USER_B);
    });
  });

  it("V32-013 (SEC-08): PwaProvider.syncNow() invalidates React Query learning caches when applied > 0 and safely works outside QueryClientProvider", async () => {
    const ev = await enqueueOfflineEvent(USER_A, {
      event_type: "answer",
      study_set_id: SET_ID,
      question_id: Q_IMG_CHOICE,
      payload: { is_correct: true, mode: "practice" },
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            results: [{ event_id: ev.event_id, status: "applied" }],
            server_now: "2026-11-25T12:00:00.000Z",
            current_progress_generation: 2,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    let capturedPwa: PwaContextValue | null = null;

    function Trigger() {
      capturedPwa = usePwa();
      return null;
    }

    const { unmount } = render(
      <QueryClientProvider client={queryClient}>
        <I18nProvider defaultLocale="en">
          <PwaProvider userId={USER_A}>
            <Trigger />
          </PwaProvider>
        </I18nProvider>
      </QueryClientProvider>,
    );

    await act(async () => {
      const outcome = await capturedPwa!.syncNow(true);
      expect(outcome?.appliedCount).toBe(1);
    });

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["dashboard"] });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["progress"] });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["review-mistakes-v3"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["checkpoints"] });
    unmount();

    // Outside QueryClientProvider (public /offline) must never throw
    const ev2 = await enqueueOfflineEvent(USER_A, {
      event_type: "star",
      study_set_id: SET_ID,
      question_id: Q_IMG_CHOICE,
      payload: { starred: true },
    });
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: {
            results: [{ event_id: ev2.event_id, status: "applied" }],
            server_now: "2026-11-25T12:01:00.000Z",
            current_progress_generation: 2,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    render(
      <I18nProvider defaultLocale="en">
        <PwaProvider userId={USER_A}>
          <Trigger />
        </PwaProvider>
      </I18nProvider>,
    );

    await act(async () => {
      const outcome = await capturedPwa!.syncNow(true);
      expect(outcome?.appliedCount).toBe(1);
    });
  });

  it("V32-042 (MEM-03): removes Service Worker updatefound, statechange, and controllerchange listeners cleanly on unmount", async () => {
    let updateFoundCb: (() => void) | null = null;
    const installingRemove = vi.fn();
    const installingWorker = {
      state: "installing",
      addEventListener: vi.fn(),
      removeEventListener: installingRemove,
    } as unknown as ServiceWorker;

    const regRemove = vi.fn();
    const regAdd = vi.fn((type: string, cb: () => void) => {
      if (type === "updatefound") updateFoundCb = cb;
    });

    const swRemove = vi.fn();
    Object.defineProperty(navigator, "serviceWorker", {
      value: {
        register: vi.fn().mockResolvedValue({
          waiting: null,
          installing: null,
          addEventListener: regAdd,
          removeEventListener: regRemove,
          get installingWorker() {
            return installingWorker;
          },
        }),
        addEventListener: vi.fn(),
        removeEventListener: swRemove,
        controller: {},
      },
      configurable: true,
    });

    // Attach installing dynamically when updatefound fires
    const fakeReg = {
      waiting: null,
      installing: null as ServiceWorker | null,
      addEventListener: regAdd,
      removeEventListener: regRemove,
    };
    (navigator.serviceWorker.register as ReturnType<typeof vi.fn>).mockResolvedValue(
      fakeReg,
    );

    const { unmount } = render(
      <I18nProvider defaultLocale="en">
        <PwaProvider userId={USER_A}>
          <div>App</div>
        </PwaProvider>
      </I18nProvider>,
    );

    await waitFor(() => expect(regAdd).toHaveBeenCalledWith("updatefound", expect.any(Function)));

    act(() => {
      fakeReg.installing = installingWorker;
      updateFoundCb?.();
    });

    expect(installingWorker.addEventListener).toHaveBeenCalledWith(
      "statechange",
      expect.any(Function),
    );

    unmount();

    expect(regRemove).toHaveBeenCalledWith("updatefound", expect.any(Function));
    expect(installingRemove).toHaveBeenCalledWith(
      "statechange",
      expect.any(Function),
    );
    expect(swRemove).toHaveBeenCalledWith(
      "controllerchange",
      expect.any(Function),
    );
  });

  it("defers SW APPLY_UPDATE when pendingSyncCount > 0 (never reloads until pending queue drains)", async () => {
    setNavigatorOnline(false);
    await enqueueOfflineEvent(USER_A, {
      event_type: "answer",
      study_set_id: SET_ID,
      question_id: Q_IMG_CHOICE,
      payload: { is_correct: true },
    });

    const postMessage = vi.fn();
    Object.defineProperty(navigator, "serviceWorker", {
      value: {
        register: vi.fn().mockResolvedValue({
          waiting: { postMessage } as unknown as ServiceWorker,
          installing: null,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        }),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        controller: {},
      },
      configurable: true,
    });

    let ctx: PwaContextValue | null = null;
    function Capture() {
      ctx = usePwa();
      return null;
    }

    render(
      <I18nProvider defaultLocale="en">
        <PwaProvider userId={USER_A}>
          <Capture />
        </PwaProvider>
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("pwa-update-banner")).toBeInTheDocument();
      expect(ctx?.syncSummary?.pendingCount).toBe(1);
    });

    // Update CTA must be hidden while pendingSyncCount > 0
    expect(screen.queryByRole("button", { name: /update now/i })).toBeNull();
    act(() => {
      ctx?.applyAppUpdate();
    });
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("V32-035 (RU-12): deduplicates mobile offline banners across live exams, focus study routes, and standard routes", () => {
    setNavigatorOnline(false);

    expect(isLiveExamAttemptRoutePath("/exams/attempt-42")).toBe(true);
    expect(isLiveExamAttemptRoutePath("/exams/new")).toBe(false);
    expect(isFocusStudyOrExamRoutePath("/sets/set-1/practice")).toBe(true);
    expect(isFocusStudyOrExamRoutePath("/dashboard")).toBe(false);

    // 1. Live exam runner -> suppresses top PwaProvider banner so LiveExamRunner owns the single warning
    mockUsePathname.mockReturnValue("/exams/attempt-42");
    const { rerender } = render(
      <I18nProvider defaultLocale="vi">
        <PwaProvider userId={USER_A}>
          <div>Exam</div>
        </PwaProvider>
      </I18nProvider>,
    );
    expect(screen.queryByTestId("pwa-offline-banner")).toBeNull();

    // 2. Focus study route -> renders compact non-stacking status bar
    mockUsePathname.mockReturnValue("/sets/set-1/practice");
    rerender(
      <I18nProvider defaultLocale="vi">
        <PwaProvider userId={USER_A}>
          <div>Practice</div>
        </PwaProvider>
      </I18nProvider>,
    );
    const compactBanner = screen.getByTestId("pwa-offline-banner");
    expect(compactBanner).toHaveAttribute("data-variant", "compact");

    // 3. Standard dashboard route -> renders standard offline banner
    mockUsePathname.mockReturnValue("/dashboard");
    rerender(
      <I18nProvider defaultLocale="vi">
        <PwaProvider userId={USER_A}>
          <div>Dashboard</div>
        </PwaProvider>
      </I18nProvider>,
    );
    expect(screen.getByTestId("pwa-offline-banner")).toHaveAttribute(
      "data-variant",
      "standard",
    );
  });

  it("V32-029 (RU-07 & RU-19): /offline accurately shows Offline state without outer PwaProvider, hides fallback hero during active study, standardizes VI/EN toggle, and resumes after F5 reload", async () => {
    setNavigatorOnline(false);
    window.localStorage.setItem("studyhub-offline-active-user", USER_A);
    await putDownloadedSet(USER_A, makeSet(USER_A));
    await putQuestionsForSet(USER_A, SET_ID, makeV3Questions(USER_A));

    // Render standalone OfflinePage WITHOUT an outer PwaProvider (simulating SW serving /offline at /sets/[id])
    mockUsePathname.mockReturnValue(`/sets/${SET_ID}`);
    const firstRender = render(
      <I18nProvider defaultLocale="vi">
        <OfflinePage />
      </I18nProvider>,
    );

    // Must immediately show "Ngoại tuyến" (NEVER green "Trực tuyến")
    const badge = screen.getByTestId("offline-page-network-badge");
    expect(badge).toHaveTextContent(/Ngoại tuyến/i);
    expect(badge).not.toHaveTextContent(/Trực tuyến/i);

    // Language toggle shows active locale "VI" (not inverted "EN") and toggles cleanly
    const langBtn = screen.getByTestId("offline-language-toggle");
    expect(langBtn).toHaveTextContent("VI");

    // Downloaded set loads immediately (NOT "Đăng nhập để xem...")
    expect(
      await screen.findByText("V3.2 Offline Verification Set"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("offline-fallback-hero")).toBeInTheDocument();

    // Start studying offline -> fallback hero ("Nội dung này chưa được tải ngoại tuyến") MUST vanish!
    fireEvent.click(screen.getByRole("button", { name: /Học ngoại tuyến/i }));
    expect(await screen.findByTestId("offline-study-runner")).toBeInTheDocument();
    expect(screen.queryByTestId("offline-fallback-hero")).toBeNull();

    // Switch to Practice mode and verify hash/sessionStorage persistence
    fireEvent.click(screen.getByRole("tab", { name: /Luyện tập/i }));
    await waitFor(() => {
      const parsed = parseOfflineSessionHash(window.location.hash);
      expect(parsed?.setId).toBe(SET_ID);
      expect(parsed?.mode).toBe("practice");
    });

    // Simulate F5 reload while offline at card index 1 (second question)
    window.history.replaceState(
      null,
      "",
      formatOfflineSessionHash({
        setId: SET_ID,
        mode: "practice",
        questionIndex: 1,
      }),
    );
    firstRender.unmount();

    render(
      <I18nProvider defaultLocale="vi">
        <OfflinePage />
      </I18nProvider>,
    );

    // Must resume directly into Practice Q2 (Numerical) with hero still hidden!
    expect(await screen.findByTestId("offline-study-runner")).toBeInTheDocument();
    expect(await screen.findByText(/Enter standard gravity with unit/i)).toBeInTheDocument();
    expect(screen.queryByTestId("offline-fallback-hero")).toBeNull();
  });

  it("V32-029 (FUNC-19) & MEM-04: OfflineStudyRunner renders option images, multi-select, numerical strict unit_required, ordering/matching/blanks/hotspot, multi-diagram switcher + <img> coords + diagram sync event, double-click guard, and revokes blobs on unmount", async () => {
    setNavigatorOnline(false);
    await putDownloadedSet(USER_A, makeSet(USER_A));
    await putQuestionsForSet(USER_A, SET_ID, makeV3Questions(USER_A));
    await putDiagramsForSet(USER_A, SET_ID, makeTwoDiagrams(USER_A));

    const mediaUrls = [
      "/api/uploads/signed-url?path=opt-a.png&redirect=1",
      "/api/uploads/signed-url?path=opt-b.png&redirect=1",
      "/api/uploads/signed-url?path=opt-c.png&redirect=1",
      "/api/uploads/signed-url?path=pitot.png&redirect=1",
      "/api/uploads/signed-url?path=diag1.png&redirect=1",
      "/api/uploads/signed-url?path=diag2.png&redirect=1",
    ];
    for (const url of mediaUrls) {
      await putMediaBlob(USER_A, {
        url,
        user_id: USER_A,
        media_id: null,
        kind: "image",
        mime_type: "image/png",
        size_bytes: 8,
        blob: new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], {
          type: "image/png",
        }),
        set_ids: [SET_ID],
        downloaded_at: "2026-11-25T11:00:00.000Z",
      });
    }

    let blobCounter = 0;
    const createdUrls: string[] = [];
    const revokedUrls: string[] = [];
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
      const next = `blob:v32-test-${++blobCounter}`;
      createdUrls.push(next);
      return next;
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation((u) => {
      revokedUrls.push(u);
    });

    const { unmount } = render(
      <I18nProvider defaultLocale="en">
        <OfflineStudyRunner
          userId={USER_A}
          setId={SET_ID}
          initialMode="practice"
          onExit={vi.fn()}
        />
      </I18nProvider>,
    );

    // Q1: image_choice multi-select renders option images (never blank "A.")
    expect(
      await screen.findByTestId("offline-option-image-opt-img-a"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("offline-option-image-opt-img-b"),
    ).toBeInTheDocument();

    const optABtn = screen.getByTestId("offline-option-opt-img-a");
    const optCBtn = screen.getByTestId("offline-option-opt-img-c");
    fireEvent.click(optABtn);
    fireEvent.click(optCBtn);

    // Rapid double-click on Check answer MUST enqueue ONLY 1 sync event (`submittingRef` guard)
    const checkBtn = screen.getByRole("button", { name: /check answer/i });
    fireEvent.click(checkBtn);
    fireEvent.click(checkBtn);

    await waitFor(async () => {
      const queue = await listSyncQueue(USER_A);
      const answerEvts = queue.filter((e) => e.event_type === "answer");
      expect(answerEvts).toHaveLength(1);
      expect(answerEvts[0]?.payload.is_correct).toBe(true);
    });

    // Q2: Numerical with `unit_required: true` — MUST fail if unit omitted (never auto-injected!)
    fireEvent.click(screen.getByRole("button", { name: /next question/i }));
    const numInput = await screen.findByLabelText(/numeric value/i);
    const unitInput = screen.getByTestId("offline-numerical-unit-input");
    fireEvent.change(numInput, { target: { value: "9.81" } });
    // Leave unit blank!
    expect((unitInput as HTMLInputElement).value).toBe("");
    fireEvent.click(screen.getByRole("button", { name: /check answer/i }));
    expect(await screen.findByText(/Correct answer: 9.81 m\/s\^2/i)).toBeInTheDocument();

    // Q3: Ordering renders interactive up/down controls
    fireEvent.click(screen.getByRole("button", { name: /next question/i }));
    expect(await screen.findByTestId("offline-ordering")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /check answer/i }));

    // Q4: Matching renders selects with shuffled right options
    fireEvent.click(screen.getByRole("button", { name: /next question/i }));
    expect(await screen.findByTestId("offline-matching")).toBeInTheDocument();
    const selects = screen.getAllByRole("combobox");
    expect(selects).toHaveLength(2);
    fireEvent.change(selects[0]!, { target: { value: "r1" } });
    fireEvent.change(selects[1]!, { target: { value: "r2" } });
    fireEvent.click(screen.getByRole("button", { name: /check answer/i }));
    expect(await screen.findByText(/All pairs matched correctly/i)).toBeInTheDocument();

    // Q5: Fill-in-the-blank renders labeled blank inputs and grades
    fireEvent.click(screen.getByRole("button", { name: /next question/i }));
    expect(await screen.findByTestId("offline-fill-in-blank")).toBeInTheDocument();
    const blankInput = screen.getByPlaceholderText(/fill in blank/i);
    fireEvent.change(blankInput, { target: { value: "1013.25" } });
    fireEvent.click(screen.getByRole("button", { name: /check answer/i }));
    expect(await screen.findByText(/Correct!/i)).toBeInTheDocument();

    // Q6: Image hotspot normalizes click against `<img>` bounding rect and grades hit!
    fireEvent.click(screen.getByRole("button", { name: /next question/i }));
    const hotspotImg = await screen.findByTestId("offline-hotspot-question-image");
    vi.spyOn(hotspotImg, "getBoundingClientRect").mockReturnValue({
      left: 100,
      top: 200,
      width: 200,
      height: 100,
      right: 300,
      bottom: 300,
      x: 100,
      y: 200,
      toJSON: () => ({}),
    });
    // Click at center (x=200 => 0.5, y=250 => 0.5 -> inside rect [0.4..0.6, 0.4..0.6])
    fireEvent.click(hotspotImg, { clientX: 200, clientY: 250 });
    fireEvent.click(screen.getByRole("button", { name: /check answer/i }));
    expect(await screen.findByText(/Target hotspot hit/i)).toBeInTheDocument();

    // Switch to Diagram mode -> verify multi-diagram switcher reaches Diagram Two and records offline progress!
    fireEvent.click(screen.getByRole("tab", { name: /Diagram/i }));
    expect(await screen.findByTestId("offline-diagram-switcher")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /2\. Diagram Two/i }));

    const diagImg = await screen.findByTestId("offline-diagram-image");
    vi.spyOn(diagImg, "getBoundingClientRect").mockReturnValue({
      left: 50,
      top: 50,
      width: 400,
      height: 200,
      right: 450,
      bottom: 250,
      x: 50,
      y: 50,
      toJSON: () => ({}),
    });
    // Diagram Two hotspot is rect x:[0.5..0.9], y:[0.5..0.9] -> click (x=0.7, y=0.7) => clientX=330, clientY=190
    fireEvent.click(diagImg, { clientX: 330, clientY: 190 });
    expect(await screen.findByText(/Correct: Zone Bravo/i)).toBeInTheDocument();

    await waitFor(async () => {
      const queue = await listSyncQueue(USER_A);
      const diagCheckpoint = queue.find(
        (e) =>
          e.event_type === "checkpoint_upsert" && e.payload.mode === "diagram",
      );
      expect(diagCheckpoint).toBeDefined();
    });

    // Unmount MUST revoke 100% of created object URLs (MEM-04)
    unmount();
    expect(createdUrls.length).toBeGreaterThan(0);
    for (const u of createdUrls) {
      expect(revokedUrls).toContain(u);
    }
  });

  it("SEC-10 & Retry Backoff: handles rejected_inaccessible, respects HTTP 429 Retry-After / timeout backoff, pauses automatic sync on 401, and guards OfflineManagerPanel double-clicks (FUNC-31)", async () => {
    // 1. classifySyncEventStatus supports rejected_inaccessible
    expect(classifySyncEventStatus("rejected_inaccessible")).toBe("inaccessible");

    // 2. Bounded exponential backoff + Retry-After clamping
    expect(computeSyncRetryDelayMs(1)).toBe(2_000);
    expect(computeSyncRetryDelayMs(2)).toBe(4_000);
    expect(computeSyncRetryDelayMs(1, "45")).toBe(45_000);
    expect(computeSyncRetryDelayMs(20, "999999")).toBe(300_000);

    // 3. rejected_inaccessible purges local set and increments inaccessibleCount
    await putDownloadedSet(USER_A, makeSet(USER_A));
    await putQuestionsForSet(USER_A, SET_ID, makeV3Questions(USER_A));
    const evInaccessible = await enqueueOfflineEvent(USER_A, {
      event_type: "answer",
      study_set_id: SET_ID,
      question_id: Q_IMG_CHOICE,
      payload: { is_correct: true },
    });

    const inaccOutcome = await syncPendingEvents(USER_A, {
      fetcher: vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: {
              results: [
                {
                  event_id: evInaccessible.event_id,
                  status: "rejected_inaccessible",
                },
              ],
              server_now: "2026-11-25T13:00:00.000Z",
              current_progress_generation: 2,
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    });

    expect(inaccOutcome.inaccessibleCount).toBe(1);
    expect(await listSyncQueue(USER_A)).toEqual([]);
    expect(await getQuestionsForSet(USER_A, SET_ID)).toEqual([]);
    const postSet = await getDownloadedSet(USER_A, SET_ID);
    expect(postSet === null || postSet.status === "revoked").toBe(true);

    // 4. HTTP 429 schedules retry_wait and skips immediate non-forced retry loop
    await enqueueOfflineEvent(USER_A, {
      event_type: "answer",
      study_set_id: SET_ID,
      question_id: Q_IMG_CHOICE,
      payload: { is_correct: true },
    });
    const rateLimitFetcher = vi.fn(async () =>
      new Response("Rate limited", {
        status: 429,
        headers: { "Retry-After": "30" },
      }),
    );
    const rlOutcome = await syncPendingEvents(USER_A, {
      fetcher: rateLimitFetcher,
    });
    expect(rlOutcome.status).toBe("error");
    expect(rateLimitFetcher).toHaveBeenCalledTimes(1);

    // Immediate background retry MUST NOT fire network call while inside backoff window
    const skippedOutcome = await syncPendingEvents(USER_A, {
      fetcher: rateLimitFetcher,
      force: false,
    });
    expect(skippedOutcome.status).toBe("idle");
    expect(rateLimitFetcher).toHaveBeenCalledTimes(1);

    // 5. Network timeout aborts cleanly and schedules retry_wait
    const hangingFetcher = vi.fn(
      (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        }),
    );
    const timeoutOutcome = await syncPendingEvents(USER_A, {
      fetcher: hangingFetcher,
      force: true,
      timeoutMs: 25,
    });
    expect(timeoutOutcome.status).toBe("offline");
    expect(timeoutOutcome.errorMessage).toMatch(/timed out/i);

    // 6. HTTP 401 marks queue auth_required and PAUSES automatic non-forced sync (0 calls!)
    const unauthFetcher = vi.fn(async () =>
      new Response("Unauthorized", { status: 401 }),
    );
    const authFail = await syncPendingEvents(USER_A, {
      fetcher: unauthFetcher,
      force: true,
    });
    expect(authFail.status).toBe("auth_required");
    expect(unauthFetcher).toHaveBeenCalledTimes(1);

    const pausedAuto = await syncPendingEvents(USER_A, {
      fetcher: unauthFetcher,
      force: false,
    });
    expect(pausedAuto.status).toBe("auth_required");
    expect(unauthFetcher).toHaveBeenCalledTimes(1); // Zero extra retries!

    // 7. OfflineManagerPanel displays auth recovery callout & syncingRef blocks double-clicks (`FUNC-31`)
    let resolvePendingFetch: ((res: Response) => void) | null = null;
    const panelFetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolvePendingFetch = resolve;
        }),
    );

    render(
      <I18nProvider defaultLocale="vi">
        <OfflineManagerPanel userId={USER_A} />
      </I18nProvider>,
    );

    expect(
      await screen.findByTestId("sync-auth-required-callout"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("sync-auth-required-badge")).toHaveTextContent(
      /Đăng nhập lại để đồng bộ/i,
    );

    const syncBtn = screen.getByTestId("sync-now-button");
    fireEvent.click(syncBtn);
    fireEvent.click(syncBtn);
    fireEvent.click(syncBtn);

    await waitFor(() => expect(panelFetchSpy).toHaveBeenCalledTimes(1));

    await act(async () => {
      resolvePendingFetch?.(new Response("Unauthorized", { status: 401 }));
    });
    await waitFor(() => expect(syncBtn).not.toBeDisabled());
  });

  it("V32-029 (FUNC-19): switchMode restores saved correctCount accurately and ignores stale rapid mode switches", async () => {
    await putDownloadedSet(USER_A, makeSet(USER_A));
    await putQuestionsForSet(USER_A, SET_ID, makeV3Questions(USER_A));

    // Seed a saved checkpoint for `learn` at index 2 with correctCount = 2
    const { saveOfflineCheckpoint } = await import("@/lib/offline/offline-session");
    await saveOfflineCheckpoint(USER_A, {
      study_set_id: SET_ID,
      mode: "learn",
      session_key: "offline",
      current_index: 2,
      total_items: 6,
      state_json: { correctCount: 2 },
      enqueueSync: false,
    });

    render(
      <I18nProvider defaultLocale="en">
        <OfflineStudyRunner
          userId={USER_A}
          setId={SET_ID}
          initialMode="flashcards"
          onExit={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(await screen.findByTestId("offline-study-runner")).toBeInTheDocument();

    // Switch rapidly flashcards -> write -> learn; final active mode MUST be `learn` at restored item 3/6
    fireEvent.click(screen.getByRole("tab", { name: /Write/i }));
    fireEvent.click(screen.getByRole("tab", { name: /Learn/i }));

    expect(
      await screen.findByText(/Restored your offline session at item 3\/6/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Learn/i })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});
