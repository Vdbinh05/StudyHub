import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n";
import { appendMediaRetryParam } from "@/lib/media/urls";
import { optimizeImageForUpload } from "@/lib/media/validation";
import { ImageLightbox, ZoomableImage } from "@/components/media/ImageLightbox";
import { MediaGallery } from "@/components/media/MediaGallery";
import {
  MediaAttachmentEditor,
  type EditableMediaAttachment,
} from "@/components/media/MediaAttachmentEditor";
import {
  V3QuestionTypeFields,
  type QuestionDraft,
} from "@/components/editor/V3QuestionTypeFields";
import { ReportsInboxPanel } from "@/components/editor/ReportsInboxPanel";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 88,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * 88,
        size: 88,
      })),
    measureElement: () => {},
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as typeof ResizeObserver;
}

vi.mock("@/components/layout/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/layout/api-client")>();
  return {
    ...actual,
    isSupabaseConfiguredClient: () => true,
  };
});

import { QuestionEditorView } from "@/components/editor/question-editor-view";

function makePngBufferWithDims(width: number, height: number): ArrayBuffer {
  const buf = new ArrayBuffer(24);
  const bytes = new Uint8Array(buf);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x00, 0x00, 0x00, 0x0d], 8);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  const view = new DataView(buf);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return buf;
}

/** Creates a browser-like File whose `.arrayBuffer()` works cleanly in jsdom. */
function makeJsdomFile(buf: ArrayBuffer, name: string, type: string): File {
  const file = new File([buf], name, { type });
  if (typeof file.arrayBuffer !== "function") {
    Object.defineProperty(file, "arrayBuffer", {
      value: async () => buf.slice(0),
    });
  }
  return file;
}

function renderWithProviders(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <I18nProvider defaultLocale="vi">{ui}</I18nProvider>
    </QueryClientProvider>,
  );
}

describe("V3.2 Image Optimization & Safari MIME Parity (FUNC-21, FUNC-29(4))", () => {
  const originalImage = globalThis.Image;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.Image = originalImage;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  function mockBrowserCanvas(opts: {
    hasAlpha: boolean;
    toBlobMimeOverride?: string;
    naturalWidth?: number;
    naturalHeight?: number;
  }) {
    URL.createObjectURL = vi.fn(() => "blob:mock-image");
    URL.revokeObjectURL = vi.fn();

    class MockImage {
      naturalWidth = opts.naturalWidth ?? 2400;
      naturalHeight = opts.naturalHeight ?? 1600;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    }
    globalThis.Image = MockImage as unknown as typeof Image;

    const requestedMimes: string[] = [];
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tagName: string) => {
      if (tagName.toLowerCase() !== "canvas") {
        return origCreateElement(tagName);
      }
      const fakeCanvas = {
        width: 0,
        height: 0,
        getContext: () => ({
          imageSmoothingEnabled: true,
          imageSmoothingQuality: "high",
          drawImage: vi.fn(),
          getImageData: () => ({
            data: opts.hasAlpha
              ? new Uint8ClampedArray([255, 0, 0, 128, 0, 255, 0, 255])
              : new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255]),
          }),
        }),
        toBlob: (cb: (b: Blob | null) => void, mime?: string) => {
          requestedMimes.push(mime ?? "");
          const actualMime = opts.toBlobMimeOverride ?? mime ?? "image/png";
          cb(new Blob([new Uint8Array([1, 2, 3, 4])], { type: actualMime }));
        },
      };
      return fakeCanvas as unknown as HTMLCanvasElement;
    }) as typeof document.createElement);

    return { requestedMimes };
  }

  it("re-encodes large opaque PNG photos to universal PDF/Safari image/jpeg (NEVER image/webp)", async () => {
    const { requestedMimes } = mockBrowserCanvas({ hasAlpha: false });
    const file = makeJsdomFile(makePngBufferWithDims(2400, 1600), "photo.png", "image/png");

    const result = await optimizeImageForUpload(file);
    expect(requestedMimes).toEqual(["image/jpeg"]);
    expect(result.wasModified).toBe(true);
    expect(result.file.type).toBe("image/jpeg");
    expect(result.file.name).toBe("photo.jpg");
  });

  it("re-encodes transparent large PNGs to image/png preserving alpha channel", async () => {
    const { requestedMimes } = mockBrowserCanvas({ hasAlpha: true });
    const file = makeJsdomFile(makePngBufferWithDims(2400, 1600), "logo.png", "image/png");

    const result = await optimizeImageForUpload(file);
    expect(requestedMimes).toEqual(["image/png"]);
    expect(result.wasModified).toBe(true);
    expect(result.file.type).toBe("image/png");
    expect(result.file.name).toBe("logo.png");
  });

  it("honors actual blob.type returned by Safari/WebKit fallback so extension and MIME always match (FUNC-29(4))", async () => {
    mockBrowserCanvas({ hasAlpha: false, toBlobMimeOverride: "image/png" });
    const file = makeJsdomFile(
      makePngBufferWithDims(2400, 1600),
      "safari-photo.png",
      "image/png",
    );

    const result = await optimizeImageForUpload(file);
    expect(result.wasModified).toBe(true);
    expect(result.file.type).toBe("image/png");
    expect(result.file.name).toBe("safari-photo.png");
  });
});

describe("V3.2 Signed-URL Retry & Media Error Recovery (FUNC-25, FUNC-31)", () => {
  const originalFetch = globalThis.fetch;
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it("appendMediaRetryParam appends or replaces _r cleanly without duplicating params", () => {
    const first = appendMediaRetryParam(
      "/api/uploads/signed-url?path=a/b.png&redirect=1",
      1001,
    );
    expect(first).toBe("/api/uploads/signed-url?path=a%2Fb.png&redirect=1&_r=1001");

    const second = appendMediaRetryParam(first, 2002);
    expect(second).toBe("/api/uploads/signed-url?path=a%2Fb.png&redirect=1&_r=2002");
  });

  it("MediaGallery, ZoomableImage, and ImageLightbox auto-retry once with &_r= on error and then render retryable fallback UI", () => {
    const baseUrl = "/api/uploads/signed-url?path=set1/chart.png&redirect=1";

    // 1. MediaGallery + ZoomableImage (rendered without open modal hiding them via aria-hidden)
    const inlineView = renderWithProviders(
      <div>
        <MediaGallery
          items={[
            {
              id: "g-1",
              kind: "image",
              url: baseUrl,
              alt_text: "Gallery Chart",
            },
          ]}
        />
        <ZoomableImage src={baseUrl} alt="Zoomable Chart" />
      </div>,
    );

    const galleryImg = inlineView.container.querySelector(
      'img[alt="Gallery Chart"]',
    ) as HTMLImageElement;
    expect(galleryImg.getAttribute("src")).toBe(baseUrl);
    fireEvent.error(galleryImg);
    expect(galleryImg.getAttribute("src")).toMatch(/&_r=\d+/);
    fireEvent.error(galleryImg);
    expect(inlineView.container.querySelector('img[alt="Gallery Chart"]')).toBeNull();

    const zoomImg = inlineView.container.querySelector(
      'img[alt="Zoomable Chart"]',
    ) as HTMLImageElement;
    fireEvent.error(zoomImg);
    expect(zoomImg.getAttribute("src")).toMatch(/&_r=\d+/);
    fireEvent.error(zoomImg);
    expect(inlineView.container.querySelector('img[alt="Zoomable Chart"]')).toBeNull();

    const inlineRetries = screen.getAllByRole("button", { name: /Thử lại/i });
    expect(inlineRetries).toHaveLength(2);

    // Clicking Retry restores <img> with fresh &_r= URL
    fireEvent.click(inlineRetries[0]);
    const retriedGalleryImg = inlineView.container.querySelector(
      'img[alt="Gallery Chart"]',
    );
    expect(retriedGalleryImg).not.toBeNull();
    expect(retriedGalleryImg?.getAttribute("src")).toMatch(/&_r=\d+/);
    inlineView.unmount();

    // 2. ImageLightbox stage auto-retry + retryable fallback
    renderWithProviders(
      <ImageLightbox open onOpenChange={() => {}} src={baseUrl} alt="Lightbox Chart" />,
    );
    const lbImg = screen.getByRole("img", { name: "Lightbox Chart" });
    fireEvent.error(lbImg);
    expect(lbImg.getAttribute("src")).toMatch(/&_r=\d+/);
    fireEvent.error(lbImg);
    expect(screen.queryByRole("img", { name: "Lightbox Chart" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Thử lại/i })).toBeInTheDocument();
  });

  it("MediaAttachmentEditor openCropDialog retries fetch with &_r= and cache:no-store after transient signed-URL failure (FUNC-31)", async () => {
    URL.createObjectURL = vi.fn(() => "blob:crop-preview");
    URL.revokeObjectURL = vi.fn();

    const calls: Array<{ url: string; cache?: RequestCache }> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push({ url, cache: init?.cache });
      if (calls.length === 1) {
        return new Response("Expired signed URL", { status: 403 });
      }
      return new Response(new Blob([makePngBufferWithDims(16, 16)], { type: "image/png" }), {
        status: 200,
      });
    }) as typeof fetch;

    const item: EditableMediaAttachment = {
      localId: "att-1",
      kind: "image",
      storage_path: "u1/s1/fig.png",
      url: "/api/uploads/signed-url?path=u1/s1/fig.png&redirect=1",
      mime_type: "image/png",
      file_name: "fig.png",
      size_bytes: 1024,
      alt_text: "Fig 1",
      caption: "",
      sort_order: 0,
    };

    renderWithProviders(
      <MediaAttachmentEditor
        studySetId="22222222-2222-4222-8222-222222222222"
        value={[item]}
        onChange={vi.fn()}
      />,
    );

    const cropBtn = screen.getByRole("button", { name: /Cắt hoặc xoay ảnh/i });
    fireEvent.click(cropBtn);

    await waitFor(() => {
      expect(calls).toHaveLength(2);
    });
    expect(calls[1].url).toMatch(/&_r=\d+/);
    expect(calls[1].cache).toBe("no-store");
    expect(await screen.findByText(/Cắt & Xoay ảnh/i)).toBeInTheDocument();
  });
});

describe("V3.2 Question Editor, V3 Fields & Reports Inbox Regressions (FUNC-06, FUNC-16, FUNC-23, FUNC-26(2), RU-10, RU-15)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("Fill-in-the-Blank preserves spaces while typing 'Ha Noi' and preserves input focus when editing blank_id (FUNC-06)", () => {
    function Harness() {
      const [draft, setDraft] = React.useState<QuestionDraft>({
        question_type: "fill_in_blank",
        prompt: "Thủ đô của Việt Nam là {{blank1}}",
        prompt_rich: null,
        prompt_image_url: "",
        back_text: "",
        back_rich: null,
        chapter: "",
        difficulty: "medium",
        explanation: "",
        explanation_rich: null,
        hint: "",
        audio_url: "",
        audio_transcript: "",
        passage_id: "",
        diagram_id: "",
        type_payload: {
          type: "fill_in_blank",
          blanks: [{ blank_id: "blank1", accepted_answers: ["Hanoi"] }],
          require_all_blanks: true,
        },
        tagsText: "",
        options: [],
        accepted_answers: [],
      });

      return (
        <div>
          <V3QuestionTypeFields
            setId="22222222-2222-4222-8222-222222222222"
            locale="vi"
            draft={draft}
            setDraft={setDraft}
            passages={[]}
            diagrams={[]}
          />
          <output data-testid="serialized-answers">
            {draft.type_payload?.type === "fill_in_blank"
              ? JSON.stringify(draft.type_payload.blanks[0])
              : ""}
          </output>
        </div>
      );
    }

    renderWithProviders(<Harness />);

    // 1. Typing "Ha " then "Ha Noi" MUST NOT strip the trailing space mid-typing
    const answersInput = screen.getByLabelText("Đáp án đúng ô trống 1") as HTMLInputElement;
    fireEvent.change(answersInput, { target: { value: "Ha " } });
    expect(answersInput.value).toBe("Ha ");
    fireEvent.change(answersInput, { target: { value: "Ha Noi, Hà Nội" } });
    expect(answersInput.value).toBe("Ha Noi, Hà Nội");
    fireEvent.blur(answersInput);
    expect(screen.getByTestId("serialized-answers").textContent).toContain('"Ha Noi"');
    expect(screen.getByTestId("serialized-answers").textContent).toContain('"Hà Nội"');

    // 2. Typing into blank_id MUST keep the exact same DOM node mounted & focused (no key remount)
    const blankIdInput = screen.getByLabelText("Mã ô trống 1") as HTMLInputElement;
    blankIdInput.focus();
    expect(document.activeElement).toBe(blankIdInput);
    fireEvent.change(blankIdInput, { target: { value: "capital_city" } });
    expect(document.activeElement).toBe(blankIdInput);
    expect(blankIdInput.value).toBe("capital_city");
  });

  it("ReportsInboxPanel renders localized Error + Retry state instead of empty state when API fails (FUNC-26(2))", async () => {
    let attempts = 0;
    globalThis.fetch = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        return new Response(
          JSON.stringify({ error: { code: "INTERNAL_ERROR", message: "Database timeout" } }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    renderWithProviders(
      <ReportsInboxPanel
        studySetId="22222222-2222-4222-8222-222222222222"
        locale="vi"
      />,
    );

    expect(
      await screen.findByText(/Không thể tải danh sách báo lỗi/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Không có báo cáo nào/i)).not.toBeInTheDocument();

    const retryBtn = screen.getByRole("button", { name: /Thử lại/i });
    fireEvent.click(retryBtn);

    expect(await screen.findByText(/Không có báo cáo nào/i)).toBeInTheDocument();
    expect(attempts).toBe(2);
  });

  it("QuestionEditorView enforces Viewer RBAC guard (FUNC-16) and UX31-13 modal + row affordances for owners (FUNC-23, RU-10, RU-15)", async () => {
    const SET_ID = "22222222-2222-4222-8222-222222222222";
    const sampleQuestion = {
      id: "q-row-1",
      study_set_id: SET_ID,
      question_type: "single_choice",
      position: 0,
      chapter: "Chương 1",
      prompt: "Câu hỏi có ảnh và âm thanh minh họa",
      prompt_image_url: "/api/uploads/signed-url?path=u1/s1/p.png&redirect=1",
      back_text: null,
      back_image_url: null,
      explanation: "Giải thích chi tiết",
      hint: "Gợi ý nhỏ",
      audio_url: "/api/uploads/signed-url?path=u1/s1/a.mp3&redirect=1",
      difficulty: "medium",
      source_metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      options: [
        {
          id: "opt-1",
          question_id: "q-row-1",
          study_set_id: SET_ID,
          position: 1,
          label: "A",
          content: "Đáp án A",
          image_url: null,
          is_correct: true,
          created_at: new Date().toISOString(),
        },
        {
          id: "opt-2",
          question_id: "q-row-1",
          study_set_id: SET_ID,
          position: 2,
          label: "B",
          content: "Đáp án B",
          image_url: null,
          is_correct: false,
          created_at: new Date().toISOString(),
        },
      ],
    };

    const installFetch = (role: "viewer" | "owner") => {
      globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url === `/api/sets/${SET_ID}`) {
          return new Response(
            JSON.stringify({
              data: {
                id: SET_ID,
                owner_id: "owner-1",
                folder_id: null,
                title: "Học phần Khí tượng",
                description: "",
                subject: "Khí tượng",
                set_type: "multiple_choice",
                visibility: "shared",
                source_language: "vi",
                question_count: 1,
                default_exam_duration_minutes: 45,
                default_pass_threshold: 70,
                is_archived: false,
                last_studied_at: null,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                role,
                can_edit: role === "owner",
                is_owner: role === "owner",
                chapters: ["Chương 1"],
                tags: [],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        if (url.startsWith(`/api/sets/${SET_ID}/questions`)) {
          return new Response(
            JSON.stringify({
              data: [sampleQuestion],
              meta: { total: 1, page: 1, pageSize: 500 },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ data: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch;
    };

    // Part A: Viewer RBAC Guard (FUNC-16)
    installFetch("viewer");
    const viewerView = renderWithProviders(<QuestionEditorView setId={SET_ID} />);
    expect(
      await screen.findByText(/Bạn đang ở chế độ chỉ xem \(Viewer\)/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Thêm câu hỏi/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Chỉnh sửa câu #1/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Xóa #1/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Báo cáo lỗi/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Thông tin học phần/i })).not.toBeInTheDocument();
    viewerView.unmount();

    // Part B: Owner UX31-13 & Row Affordances (FUNC-23, RU-10, RU-15)
    installFetch("owner");
    renderWithProviders(<QuestionEditorView setId={SET_ID} />);

    // Row displays Image & Audio badges + explicit Edit pencil button
    expect(await screen.findByText("Ảnh")).toBeInTheDocument();
    expect(screen.getByText("Âm thanh")).toBeInTheDocument();
    const editBtn = screen.getByRole("button", { name: /Chỉnh sửa câu #1/i });
    fireEvent.click(editBtn);

    // Modal shows student-friendly 12-type copy (NO developer jargon!)
    expect(
      await screen.findByText(/Hỗ trợ 12 dạng câu hỏi & thẻ ghi nhớ/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/13 dạng câu hỏi V3/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/bảo toàn mã định danh/i)).not.toBeInTheDocument();

    // Sticky Save button is rendered with form="question-editor-form"
    const saveBtn = screen.getByRole("button", { name: /Lưu thay đổi|Lưu câu hỏi/i });
    expect(saveBtn).toHaveAttribute("form", "question-editor-form");

    // Secondary fields (Explanation, Hint, Tags) are collapsed by default and expand on click
    const toggleSecondaryBtn = screen.getByRole("button", {
      name: /Mở rộng giải thích, gợi ý & thẻ/i,
    });
    expect(toggleSecondaryBtn).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText(/Gợi ý \(tùy chọn\)/i)).not.toBeInTheDocument();

    fireEvent.click(toggleSecondaryBtn);
    expect(toggleSecondaryBtn).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText(/Gợi ý \(tùy chọn\)/i)).toBeInTheDocument();
  });
});
