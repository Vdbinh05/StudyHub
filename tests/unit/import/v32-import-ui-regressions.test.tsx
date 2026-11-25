import * as React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n";
import {
  clearPendingImportFile,
  setPendingImportFile,
} from "@/lib/import/pending-file-handoff";
import type {
  ImportPreviewResult,
  ImportPreviewSummary,
  ParsedMediaAttachment,
  ParsedQuestion,
} from "@/types/import";

vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: ({ count }: { count: number }) => ({
    getTotalSize: () => count * 120,
    getVirtualItems: () =>
      Array.from({ length: Math.min(count, 5) }, (_, index) => ({
        index,
        key: index,
        start: index * 120,
        size: 120,
      })),
    measureElement: () => {},
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { VirtualizedPreviewList } from "@/components/import/VirtualizedPreviewList";
import { ImportWizard } from "@/components/import/ImportWizard";

function makeParsedQ(
  idx: number,
  overrides: Partial<ParsedQuestion> = {},
): ParsedQuestion {
  return {
    tempId: `q-${idx}`,
    index: idx - 1,
    questionType: "single_choice",
    prompt: `Câu hỏi số ${idx}`,
    promptMedia: [],
    options: [
      {
        id: `opt-${idx}-a`,
        label: "A",
        content: "A. Hà Nội",
        isCorrect: true,
        media: [],
        detectedBy: ["asterisk_prefix"],
      },
      {
        id: `opt-${idx}-b`,
        label: "B",
        content: "(B) TP. Hồ Chí Minh",
        isCorrect: false,
        media: [],
        detectedBy: ["none"],
      },
    ],
    acceptedAnswers: [],
    tags: [],
    difficulty: "medium",
    detectedBy: ["asterisk_prefix"],
    issues: [],
    ...overrides,
  };
}

function makeSummary(total: number): ImportPreviewSummary {
  return {
    totalDetected: total,
    validCount: total,
    warningCount: 0,
    errorCount: 0,
    duplicateCount: 0,
    missingAnswerCount: 0,
    conflictCount: 0,
  };
}

function renderWithProviders(ui: React.ReactElement, queryClient?: QueryClient) {
  const qc =
    queryClient ??
    new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
  return {
    queryClient: qc,
    ...render(
      <QueryClientProvider client={qc}>
        <I18nProvider defaultLocale="vi">{ui}</I18nProvider>
      </QueryClientProvider>,
    ),
  };
}

describe("V3.2 VirtualizedPreviewList Regressions (FUNC-27(2), RU-14)", () => {
  it("renders signed previewUrl thumbnails for staged DOCX images, strips duplicated option prefixes, and lifts the 200-question Move cap", () => {
    const stagedMedia: ParsedMediaAttachment & { previewUrl?: string } = {
      id: "m-staged-1",
      rId: "rId5",
      fileName: "large-diagram.png",
      mimeType: "image/png",
      ext: "png",
      byteLength: 1_800_000,
      previewPath: "/docx-media/large-diagram.png",
      tempStoragePath: "u1/import-media/large-diagram.png",
      previewUrl: "https://storage.example/signed-thumb-1.png",
      anchorType: "inline",
    };

    // 250 questions (> 200 cap!) with staged media attached to Q1
    const questions: ParsedQuestion[] = Array.from({ length: 250 }, (_, i) =>
      i === 0
        ? makeParsedQ(1, { promptMedia: [stagedMedia] })
        : makeParsedQ(i + 1),
    );
    const onMoveMediaToQuestion = vi.fn();

    renderWithProviders(
      <VirtualizedPreviewList
        questions={questions}
        summary={makeSummary(250)}
        detectedChapters={[]}
        allowInlineEdit
        locale="vi"
        onUpdateQuestion={vi.fn()}
        onMoveMediaToQuestion={onMoveMediaToQuestion}
      />,
    );

    // 1. FUNC-27(2): Staged >1.5MB image renders real <img> using signed previewUrl (not blank gray icon!)
    const thumbImg = screen.getByRole("img", { name: "large-diagram.png" });
    expect(thumbImg).toHaveAttribute(
      "src",
      "https://storage.example/signed-thumb-1.png",
    );

    // 2. RU-14: Duplicated option prefixes ("A. Hà Nội", "(B) TP. Hồ Chí Minh") stripped cleanly
    expect(screen.getAllByText("Hà Nội").length).toBeGreaterThan(0);
    expect(screen.queryByText(/A\.\s*Hà Nội/)).not.toBeInTheDocument();
    expect(screen.getAllByText("TP. Hồ Chí Minh").length).toBeGreaterThan(0);
    expect(screen.queryByText(/\(B\)\s*TP\. Hồ Chí Minh/)).not.toBeInTheDocument();

    // 3. FUNC-27(2): Open Q1 inline editor -> >200 questions uses numeric target input (max=250) and moves attachment to Q240!
    const editButtons = screen.getAllByRole("button", { name: /^Sửa$/i });
    fireEvent.click(editButtons[0]);

    const targetInput = screen.getByRole("spinbutton", {
      name: /Chuyển ảnh sang số câu/i,
    });
    expect(targetInput).toHaveAttribute("max", "250");
    fireEvent.change(targetInput, { target: { value: "240" } });
    const moveBtn = screen.getByRole("button", { name: /^Chuyển$/i });
    fireEvent.click(moveBtn);
    expect(onMoveMediaToQuestion).toHaveBeenCalledWith("q-1", "m-staged-1", "prompt", 239);
  });
});

describe("V3.2 ImportWizard Regressions (FUNC-12, FUNC-13, RU-13)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    clearPendingImportFile();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    clearPendingImportFile();
  });

  it("consumes pending /import handoff File automatically, guards stale parse races, and invalidates study set caches on commit", async () => {
    const SET_ID = "22222222-2222-4222-8222-222222222222";
    const fileA = new File(["Question A"], "file-a.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });

    // Simulate /import hub handing off fileA
    setPendingImportFile(SET_ID, fileA);

    let resolveFirstParse!: (res: Response) => void;
    let firstSignal: AbortSignal | undefined;
    const commitPayloads: Array<Record<string, unknown>> = [];

    const makePreviewPayload = (
      fileName: string,
      prompt: string,
    ): { data: ImportPreviewResult } => ({
      data: {
        format: "txt_generic",
        fileName,
        fileSizeBytes: 120,
        questions: [makeParsedQ(1, { tempId: `tmp-${fileName}`, prompt })],
        issues: [],
        summary: makeSummary(1),
        ruleUsed: { mode: "auto" },
      },
    });

    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("/api/import/parse")) {
        const callNum = fetchMock.mock.calls.filter((c) =>
          String(c[0]).includes("/api/import/parse"),
        ).length;

        if (callNum === 1) {
          firstSignal = init?.signal ?? undefined;
          return new Promise<Response>((resolve) => {
            resolveFirstParse = resolve;
          });
        }

        // Second parse (File B) resolves immediately
        return Promise.resolve(
          new Response(
            JSON.stringify(
              makePreviewPayload("file-b.txt", "Câu hỏi từ File B mới hơn"),
            ),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      if (url.includes("/api/import/commit")) {
        if (typeof init?.body === "string") {
          commitPayloads.push(JSON.parse(init.body) as Record<string, unknown>);
        }
        return Promise.resolve(
          new Response(
            JSON.stringify({
              data: {
                importJobId: "33333333-3333-4333-8333-333333333333",
                importedCount: 1,
                skippedCount: 0,
                replacedCount: 0,
                totalSetQuestions: 1,
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      }

      return Promise.resolve(new Response(JSON.stringify({ data: {} }), { status: 200 }));
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    renderWithProviders(
      <ImportWizard
        studySetId={SET_ID}
        studySetTitle="Học phần Test"
        existingQuestionCount={0}
      />,
      queryClient,
    );

    // 1. RU-13: Mount auto-consumes handed-off fileA and starts parse #1
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/import/parse",
        expect.objectContaining({ method: "POST" }),
      );
    });

    // 2. FUNC-13: User cancels slow File A and picks File B -> File A's AbortController is aborted!
    const cancelBtn = await screen.findByRole("button", {
      name: /Hủy & chọn tệp khác/i,
    });
    fireEvent.click(cancelBtn);
    expect(firstSignal?.aborted).toBe(true);

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).not.toBeNull();
    const fileB = new File(["Question B"], "file-b.txt", { type: "text/plain" });
    fireEvent.change(fileInput, { target: { files: [fileB] } });

    // File B preview appears
    await waitFor(() => {
      expect(screen.getByText("Câu hỏi từ File B mới hơn")).toBeInTheDocument();
    });

    // Late resolution of File A MUST NOT overwrite File B!
    await act(async () => {
      resolveFirstParse(
        new Response(
          JSON.stringify(
            makePreviewPayload("file-a.docx", "Câu hỏi cũ từ File A"),
          ),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    });

    expect(screen.getByText("Câu hỏi từ File B mới hơn")).toBeInTheDocument();
    expect(screen.queryByText("Câu hỏi cũ từ File A")).not.toBeInTheDocument();

    // 3. FUNC-12 + SEC-12: Clicking Import sends isFinalChunk: true and invalidates study set caches!
    const importButtons = screen.getAllByRole("button", { name: /Nhập 1 câu hỏi/i });
    fireEvent.click(importButtons[0]);

    await waitFor(() => {
      expect(commitPayloads).toHaveLength(1);
    });
    expect(commitPayloads[0]).toMatchObject({
      studySetId: SET_ID,
      isFirstChunk: true,
      isFinalChunk: true,
    });

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["study-set", SET_ID],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["set-questions", SET_ID],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["editor-questions", SET_ID],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["study-sets"],
      });
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["dashboard"],
      });
    });
  });
});
