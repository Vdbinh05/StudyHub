// @vitest-environment jsdom
import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UnifiedQuestionEditorModal } from "@/components/editor/UnifiedQuestionEditorModal";
import { StepCommit } from "@/components/import/StepImportOptionsAndCommit";
import { VirtualizedPreviewList } from "@/components/import/VirtualizedPreviewList";
import type { QuestionWithRelations } from "@/types/domain";
import type { ImportPreviewSummary, ParsedQuestion } from "@/types/import";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 220,
    getVirtualItems: () =>
      Array.from({ length: count }, (_, index) => ({
        index,
        key: index,
        start: index * 220,
        size: 220,
      })),
    measureElement: () => {},
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("next/dynamic", () => ({
  default: () => {
    const MockRichEditor = () => null;
    return MockRichEditor;
  },
}));

vi.mock("@/components/editor/QuestionNotePanel", () => ({
  QuestionNotePanel: () => <div data-testid="mock-note-panel" />,
}));

vi.mock("@/components/editor/QuestionReportDialog", () => ({
  QuestionReportDialog: () => <div data-testid="mock-report-dialog" />,
}));

const SET_ID = "11111111-1111-4111-8111-111111111111";
const Q1_ID = "22222222-2222-4222-8222-222222222222";
const Q2_ID = "33333333-3333-4333-8333-333333333333";
const OPT_A_ID = "44444444-4444-4444-8444-444444444444";
const OPT_B_ID = "55555555-5555-4555-8555-555555555555";
const MEDIA_PROMPT_1 = "66666666-6666-4666-8666-666666666666";
const MEDIA_OPT_A_1 = "77777777-7777-4777-8777-777777777777";
const MEDIA_EXP_1 = "88888888-8888-4888-8888-888888888888";

function makeHydratedQuestion(id = Q1_ID): QuestionWithRelations {
  return {
    id,
    study_set_id: SET_ID,
    question_type: "single_choice",
    position: 0,
    chapter: "Chương 1",
    prompt: "Câu hỏi kiểm thử đa ảnh?",
    prompt_image_url: "/api/uploads/signed-url?path=u%2Fs%2Fp1.png&redirect=1",
    back_text: null,
    back_image_url: null,
    explanation: "Lời giải chi tiết",
    hint: null,
    difficulty: "medium",
    source_metadata: {},
    created_at: "2026-11-25T00:00:00Z",
    updated_at: "2026-11-25T00:00:00Z",
    media_attachments: [
      {
        media_id: MEDIA_PROMPT_1,
        url: "/api/uploads/signed-url?path=u%2Fs%2Fp1.png&redirect=1",
        role: "prompt",
        sort_order: 0,
        alt_text: "Sơ đồ câu hỏi",
      },
      {
        media_id: MEDIA_EXP_1,
        url: "/api/uploads/signed-url?path=u%2Fs%2Fexp1.png&redirect=1",
        role: "explanation",
        sort_order: 0,
        alt_text: "Hình giải thích",
      },
    ],
    options: [
      {
        id: OPT_A_ID,
        question_id: id,
        study_set_id: SET_ID,
        position: 0,
        label: "A",
        content: "",
        image_url: "/api/uploads/signed-url?path=u%2Fs%2FoptA.png&redirect=1",
        media_id: MEDIA_OPT_A_1,
        image_alt: "Ảnh đáp án A",
        media_attachments: [
          {
            media_id: MEDIA_OPT_A_1,
            url: "/api/uploads/signed-url?path=u%2Fs%2FoptA.png&redirect=1",
            role: "option",
            sort_order: 0,
            alt_text: "Ảnh đáp án A",
          },
        ],
        is_correct: true,
        created_at: "2026-11-25T00:00:00Z",
      },
      {
        id: OPT_B_ID,
        question_id: id,
        study_set_id: SET_ID,
        position: 1,
        label: "B",
        content: "Phương án B văn bản",
        image_url: null,
        media_id: null,
        image_alt: null,
        media_attachments: [],
        is_correct: false,
        created_at: "2026-11-25T00:00:00Z",
      },
    ],
  };
}

function renderWithQueryClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe("UnifiedQuestionEditorModal & V32-053 Import/Post-Import Flows", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "ResizeObserver",
      class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("hydrates single question, preserves stable option UUIDs + image-only option on single_choice, shows contextNotice, and supports Save & Next", async () => {
    const hydrated = makeHydratedQuestion(Q1_ID);

    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith(`/api/sets/${SET_ID}/questions/${Q1_ID}`) && (!init?.method || init.method === "GET")) {
        return new Response(JSON.stringify({ data: hydrated }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.endsWith(`/api/sets/${SET_ID}/questions/${Q1_ID}`) && init?.method === "PATCH") {
        const body = JSON.parse(String(init.body));
        return new Response(
          JSON.stringify({
            data: {
              ...hydrated,
              prompt: body.prompt,
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      }
      return new Response(JSON.stringify({ data: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const onOpenChange = vi.fn();
    const onNavigateQuestion = vi.fn();
    const onSaved = vi.fn();

    renderWithQueryClient(
      <UnifiedQuestionEditorModal
        open
        onOpenChange={onOpenChange}
        studySetId={SET_ID}
        questionId={Q1_ID}
        questionIds={[Q1_ID, Q2_ID]}
        currentIndex={0}
        onNavigateQuestion={onNavigateQuestion}
        onSaved={onSaved}
        contextNotice="Chỉnh sửa chỉ cập nhật ngân hàng câu hỏi gốc, không thay đổi điểm bài thi đã nộp."
        locale="vi"
      />,
    );

    // Wait for lazy single-question GET hydration
    const promptInput = await screen.findByLabelText(/Nội dung câu hỏi/i);
    await waitFor(() => {
      expect((promptInput as HTMLTextAreaElement).value).toBe("Câu hỏi kiểm thử đa ảnh?");
    });

    // Context disclaimer & explicit multi-image buttons are visible
    expect(
      screen.getByText(/không thay đổi điểm bài thi đã nộp/i),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /Thêm ảnh câu hỏi/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Thêm ảnh A/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Thêm ảnh giải thích/i })).toBeTruthy();
    expect(screen.getByText("Đáp án chỉ dùng hình ảnh")).toBeTruthy();

    // Edit prompt and click "Lưu & Câu tiếp"
    fireEvent.change(promptInput, { target: { value: "Câu hỏi đã cập nhật!" } });
    fireEvent.click(screen.getByRole("button", { name: /Lưu & Câu tiếp/i }));

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
    });

    // Verify PATCH preserved stable option IDs, option media_attachments, and merged prompt+explanation media
    const patchCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "PATCH",
    );
    expect(patchCall).toBeTruthy();
    const patchBody = JSON.parse(String((patchCall![1] as RequestInit).body));
    expect(patchBody.prompt).toBe("Câu hỏi đã cập nhật!");
    expect(patchBody.options[0].id).toBe(OPT_A_ID);
    expect(patchBody.options[0].content).toBe("");
    expect(patchBody.options[0].media_attachments).toHaveLength(1);
    expect(patchBody.options[0].media_attachments[0].media_id).toBe(MEDIA_OPT_A_1);
    expect(patchBody.options[1].id).toBe(OPT_B_ID);
    expect(patchBody.media_attachments.map((m: { role: string }) => m.role)).toEqual([
      "prompt",
      "explanation",
    ]);

    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ id: Q1_ID, prompt: "Câu hỏi đã cập nhật!" }),
      "save_and_next",
    );
    expect(onNavigateQuestion).toHaveBeenCalledWith(Q2_ID, 1);
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("guards unsaved changes on Cancel and preserves draft with Retry button on failed save", async () => {
    const hydrated = makeHydratedQuestion(Q1_ID);

    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return new Response(
          JSON.stringify({ error: { code: "SERVER_ERROR", message: "Temporary DB timeout" } }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ data: hydrated }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    const onOpenChange = vi.fn();

    renderWithQueryClient(
      <UnifiedQuestionEditorModal
        open
        onOpenChange={onOpenChange}
        studySetId={SET_ID}
        questionId={Q1_ID}
        initialQuestion={hydrated}
        locale="vi"
      />,
    );

    const promptInput = await screen.findByLabelText(/Nội dung câu hỏi/i);
    fireEvent.change(promptInput, { target: { value: "Bản nháp chưa lưu" } });

    // Failed save must preserve draft and expose Retry button without closing modal
    fireEvent.click(screen.getByRole("button", { name: /Lưu thay đổi/i }));
    expect(await screen.findByRole("button", { name: /Thử lưu lại/i })).toBeTruthy();
    expect((promptInput as HTMLTextAreaElement).value).toBe("Bản nháp chưa lưu");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    // Clicking Cancel while dirty triggers unsaved-changes confirmation guard
    fireEvent.click(screen.getByRole("button", { name: /^Hủy$/i }));
    expect(await screen.findByText(/Bỏ các thay đổi chưa lưu/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Bỏ thay đổi/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("renders prominent 'Xem và chỉnh sửa câu hỏi' CTA on Post-Import Success screen", () => {
    render(
      <StepCommit
        locale="vi"
        studySetId={SET_ID}
        studySetTitle="Khí tượng hàng không"
        progress={{
          status: "completed",
          completedChunks: 1,
          totalChunks: 1,
          importedCount: 12,
          skippedCount: 0,
          replacedCount: 0,
          totalSetQuestions: 12,
          errorMessage: null,
        }}
        onBack={vi.fn()}
        onRetryCommit={vi.fn()}
        onImportAnother={vi.fn()}
      />,
    );

    const editCta = screen.getByRole("link", { name: /Xem và chỉnh sửa câu hỏi/i });
    expect(editCta.getAttribute("href")).toBe(`/sets/${SET_ID}/edit`);
  });

  it("exposes pre-import image attach controls for prompt, options, and explanation in VirtualizedPreviewList inline editor", () => {
    // jsdom has zero container height; stub getBoundingClientRect so TanStack Virtual renders item 0
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 800,
      height: 600,
      top: 0,
      left: 0,
      bottom: 600,
      right: 800,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    const sampleQuestion: ParsedQuestion = {
      tempId: "tmp-1",
      index: 0,
      questionType: "single_choice",
      prompt: "Biển báo nào chỉ đường một chiều?",
      difficulty: "medium",
      tags: [],
      options: [
        { id: "o1", label: "A", content: "Biển 1", isCorrect: true, detectedBy: ["manual"] },
        { id: "o2", label: "B", content: "Biển 2", isCorrect: false, detectedBy: [] },
      ],
      detectedBy: ["manual"],
      issues: [],
    };

    const summary: ImportPreviewSummary = {
      totalDetected: 1,
      validCount: 1,
      warningCount: 0,
      errorCount: 0,
      duplicateCount: 0,
      missingAnswerCount: 0,
      conflictCount: 0,
    };

    render(
      <VirtualizedPreviewList
        locale="vi"
        questions={[sampleQuestion]}
        summary={summary}
        detectedChapters={[]}
        allowInlineEdit
        onUpdateQuestion={vi.fn()}
      />,
    );

    const editBtn = screen.getByRole("button", { name: /Sửa/i });
    fireEvent.click(editBtn);

    expect(screen.getByRole("button", { name: /Thêm ảnh câu hỏi/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Thêm ảnh A/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Thêm ảnh B/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Thêm ảnh giải thích/i })).toBeTruthy();
  });
});
