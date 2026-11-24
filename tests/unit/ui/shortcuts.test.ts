import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SHORTCUT_CATALOG,
  IME_COMPOSITION_WINDOW_MS,
  ShortcutRegistry,
  findCatalogConflicts,
  isActiveExamRoute,
  isEditableTarget,
  isImeComposingEvent,
  isImeSafeEnterEvent,
  isProtectedBrowserCombo,
  matchesShortcutCombo,
} from "@/lib/shortcuts";

function makeKeyEvent(
  init: KeyboardEventInit & {
    keyCode?: number;
    which?: number;
    isComposing?: boolean;
    timeStamp?: number;
    target?: EventTarget | null;
  },
): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });

  if (init.keyCode !== undefined) {
    Object.defineProperty(event, "keyCode", { value: init.keyCode });
  }
  if (init.which !== undefined) {
    Object.defineProperty(event, "which", { value: init.which });
  }
  if (init.isComposing !== undefined) {
    Object.defineProperty(event, "isComposing", { value: init.isComposing });
  }
  if (init.timeStamp !== undefined) {
    Object.defineProperty(event, "timeStamp", { value: init.timeStamp });
  }
  if (init.target !== undefined) {
    Object.defineProperty(event, "target", { value: init.target });
  }
  return event;
}

describe("StudyHub V3 Keyboard Shortcuts — IME & Input Safety", () => {
  it("suppresses shortcuts when event.isComposing is true", () => {
    const registry = new ShortcutRegistry();
    const handler = vi.fn();
    registry.activateScope("flashcards");
    registry.register({
      id: "flip",
      scope: "flashcards",
      combo: "Space",
      labelVi: "Lật",
      labelEn: "Flip",
      handler,
    });

    const event = makeKeyEvent({ key: " ", code: "Space", isComposing: true });
    expect(isImeComposingEvent(event)).toBe(true);
    expect(registry.handleKeyDown(event)).toBeNull();
    expect(handler).not.toHaveBeenCalled();
  });

  it("suppresses shortcuts when keyCode === 229 (Safari/IME VK_PROCESSKEY)", () => {
    const registry = new ShortcutRegistry();
    const handler = vi.fn();
    registry.activateScope("write");
    registry.register({
      id: "submit",
      scope: "write",
      combo: "Enter",
      allowInInput: true,
      labelVi: "Nộp",
      labelEn: "Submit",
      handler,
    });

    const event = makeKeyEvent({
      key: "Enter",
      keyCode: 229,
      isComposing: false,
    });
    expect(isImeComposingEvent(event)).toBe(true);
    expect(isImeSafeEnterEvent(event)).toBe(false);
    expect(registry.handleKeyDown(event)).toBeNull();
    expect(handler).not.toHaveBeenCalled();
  });

  it("suppresses confirming Enter within 50ms of compositionend (Safari inverted event order)", () => {
    const registry = new ShortcutRegistry();
    const handler = vi.fn();
    registry.activateScope("write");
    registry.register({
      id: "submit",
      scope: "write",
      combo: "Enter",
      allowInInput: true,
      labelVi: "Nộp",
      labelEn: "Submit",
      handler,
    });

    // Forward gap: 25ms after compositionend
    const afterEvent = makeKeyEvent({ key: "Enter", timeStamp: 1025 });
    expect(isImeComposingEvent(afterEvent, 1000)).toBe(true);
    expect(isImeSafeEnterEvent(afterEvent, 1000)).toBe(false);
    expect(
      registry.handleKeyDown(afterEvent, { lastCompositionEndAt: 1000 }),
    ).toBeNull();

    // Inverted Safari timestamp: 10ms before compositionend
    const invertedEvent = makeKeyEvent({ key: "Enter", timeStamp: 990 });
    expect(isImeComposingEvent(invertedEvent, 1000)).toBe(true);
    expect(
      registry.handleKeyDown(invertedEvent, { lastCompositionEndAt: 1000 }),
    ).toBeNull();

    // After 50ms window expires, normal Enter fires cleanly
    const safeEvent = makeKeyEvent({
      key: "Enter",
      timeStamp: 1000 + IME_COMPOSITION_WINDOW_MS + 10,
    });
    expect(isImeSafeEnterEvent(safeEvent, 1000)).toBe(true);
    expect(
      registry.handleKeyDown(safeEvent, { lastCompositionEndAt: 1000 }),
    ).toBe("submit");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("never fires study shortcuts inside input, textarea, select, contenteditable, or .ProseMirror", () => {
    const registry = new ShortcutRegistry();
    const handler = vi.fn();
    registry.activateScope("flashcards");
    registry.register({
      id: "rate-1",
      scope: "flashcards",
      combo: "1",
      labelVi: "Đánh giá 1",
      labelEn: "Rate 1",
      handler,
    });

    const input = document.createElement("input");
    const textarea = document.createElement("textarea");
    const select = document.createElement("select");
    const contentEditable = document.createElement("div");
    contentEditable.setAttribute("contenteditable", "true");
    const proseMirror = document.createElement("div");
    proseMirror.className = "ProseMirror";
    const proseChild = document.createElement("p");
    proseMirror.appendChild(proseChild);

    for (const target of [input, textarea, select, contentEditable, proseChild]) {
      expect(isEditableTarget(target)).toBe(true);
      const ev = makeKeyEvent({ key: "1", target });
      expect(registry.handleKeyDown(ev)).toBeNull();
    }
    expect(handler).not.toHaveBeenCalled();

    // Non-editable target fires normally
    const card = document.createElement("div");
    expect(isEditableTarget(card)).toBe(false);
    const ev = makeKeyEvent({ key: "1", target: card });
    expect(registry.handleKeyDown(ev)).toBe("rate-1");
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("never hijacks critical browser combos (Ctrl+R, Ctrl+T, Ctrl+W, Ctrl+L)", () => {
    const registry = new ShortcutRegistry();
    const handler = vi.fn();
    registry.register({
      id: "hijack-attempt",
      scope: "global",
      combo: "Mod+R",
      allowInInput: true,
      labelVi: "Test",
      labelEn: "Test",
      handler,
    });

    for (const key of ["r", "t", "w", "l", "R", "T", "W", "L"]) {
      const ctrlEv = makeKeyEvent({ key, ctrlKey: true });
      const metaEv = makeKeyEvent({ key, metaKey: true });
      expect(isProtectedBrowserCombo(ctrlEv)).toBe(true);
      expect(isProtectedBrowserCombo(metaEv)).toBe(true);
      expect(registry.handleKeyDown(ctrlEv)).toBeNull();
      expect(registry.handleKeyDown(metaEv)).toBeNull();
    }
    expect(handler).not.toHaveBeenCalled();

    // Ctrl+K / Cmd+K is NOT a protected browser combo so Global Search works
    expect(isProtectedBrowserCombo(makeKeyEvent({ key: "k", ctrlKey: true }))).toBe(
      false,
    );
  });
});

describe("StudyHub V3 Keyboard Shortcuts — Context Priority, Exam Guard & Conflict Checks", () => {
  it("resolves context priority strictly: modal > study mode > global", () => {
    const registry = new ShortcutRegistry();
    const globalHandler = vi.fn();
    const modeHandler = vi.fn();
    const modalHandler = vi.fn();

    registry.register({
      id: "global-arrow",
      scope: "global",
      combo: "ArrowRight",
      labelVi: "Global",
      labelEn: "Global",
      handler: globalHandler,
    });
    registry.register({
      id: "flashcard-arrow",
      scope: "flashcards",
      combo: "ArrowRight",
      labelVi: "Next card",
      labelEn: "Next card",
      handler: modeHandler,
    });

    // When flashcards scope is NOT active, global runs
    expect(registry.handleKeyDown(makeKeyEvent({ key: "ArrowRight" }))).toBe(
      "global-arrow",
    );
    expect(globalHandler).toHaveBeenCalledTimes(1);

    // When flashcards scope IS active, mode takes precedence over global
    const deactivate = registry.activateScope("flashcards");
    expect(registry.handleKeyDown(makeKeyEvent({ key: "ArrowRight" }))).toBe(
      "flashcard-arrow",
    );
    expect(modeHandler).toHaveBeenCalledTimes(1);

    // When modal binding is registered, modal takes highest precedence
    const unsubModal = registry.register({
      id: "modal-arrow",
      scope: "modal",
      combo: "ArrowRight",
      labelVi: "Modal",
      labelEn: "Modal",
      handler: modalHandler,
    });
    expect(
      registry.handleKeyDown(makeKeyEvent({ key: "ArrowRight" }), {
        modalOpen: true,
      }),
    ).toBe("modal-arrow");
    expect(modalHandler).toHaveBeenCalledTimes(1);

    unsubModal();
    deactivate();
  });

  it("enforces hard active-exam route guard for Global Search (Mod+K)", () => {
    expect(isActiveExamRoute("/exams/550e8400-e29b-41d4-a716-446655440000")).toBe(true);
    expect(isActiveExamRoute("/sets/550e8400-e29b-41d4-a716-446655440000/test")).toBe(
      true,
    );
    expect(isActiveExamRoute("/exams")).toBe(false);
    expect(isActiveExamRoute("/exams/new")).toBe(false);
    expect(
      isActiveExamRoute("/exams/550e8400-e29b-41d4-a716-446655440000/results"),
    ).toBe(false);
    expect(isActiveExamRoute("/dashboard")).toBe(false);

    const registry = new ShortcutRegistry();
    const openSearch = vi.fn();
    registry.register({
      id: "global.search",
      scope: "global",
      combo: "Mod+K",
      allowInInput: true,
      allowInExam: false,
      labelVi: "Tìm kiếm",
      labelEn: "Search",
      handler: openSearch,
    });

    // Blocked on live exam attempt route
    expect(
      registry.handleKeyDown(makeKeyEvent({ key: "k", ctrlKey: true }), {
        pathname: "/exams/attempt-123",
      }),
    ).toBeNull();
    // Blocked on set test route
    expect(
      registry.handleKeyDown(makeKeyEvent({ key: "k", metaKey: true }), {
        pathname: "/sets/set-123/test",
      }),
    ).toBeNull();
    expect(openSearch).not.toHaveBeenCalled();

    // Allowed on dashboard & exam results
    expect(
      registry.handleKeyDown(makeKeyEvent({ key: "k", ctrlKey: true }), {
        pathname: "/dashboard",
      }),
    ).toBe("global.search");
    expect(
      registry.handleKeyDown(makeKeyEvent({ key: "k", metaKey: true }), {
        pathname: "/exams/attempt-123/results",
      }),
    ).toBe("global.search");
    expect(openSearch).toHaveBeenCalledTimes(2);
  });

  it("matches shift-produced characters like '?' and prevents modal leakage", () => {
    const questionMarkEv = makeKeyEvent({ key: "?", shiftKey: true });
    expect(matchesShortcutCombo(questionMarkEv, "?")).toBe(true);

    const registry = new ShortcutRegistry();
    const flipHandler = vi.fn();
    const escHandler = vi.fn();
    registry.activateScope("flashcards");
    registry.register({
      id: "flip",
      scope: "flashcards",
      combo: "Space",
      labelVi: "Lật",
      labelEn: "Flip",
      handler: flipHandler,
    });
    registry.register({
      id: "close-modal",
      scope: "modal",
      combo: "Escape",
      labelVi: "Đóng",
      labelEn: "Close",
      handler: escHandler,
    });

    // Background flashcard shortcut suppressed when modalOpen=true
    expect(
      registry.handleKeyDown(makeKeyEvent({ key: " ", code: "Space" }), {
        modalOpen: true,
      }),
    ).toBeNull();
    expect(flipHandler).not.toHaveBeenCalled();

    // Escape still runs inside modal
    expect(
      registry.handleKeyDown(makeKeyEvent({ key: "Escape" }), {
        modalOpen: true,
      }),
    ).toBe("close-modal");
    expect(escHandler).toHaveBeenCalledTimes(1);
  });

  it("has zero intra-scope shortcut conflicts in DEFAULT_SHORTCUT_CATALOG", () => {
    expect(DEFAULT_SHORTCUT_CATALOG.length).toBeGreaterThanOrEqual(20);
    expect(findCatalogConflicts(DEFAULT_SHORTCUT_CATALOG)).toEqual([]);
  });
});

describe("GlobalSearchDialog payload normalization", () => {
  it("maps frozen GlobalSearchResponse items using result_type", async () => {
    const { normalizeSearchPayload } = await import(
      "@/components/layout/GlobalSearchDialog"
    );
    const items = normalizeSearchPayload({
      query: "atmosphere",
      total: 3,
      counts_by_type: { study_set: 1, note: 1, diagram: 1 },
      items: [
        {
          result_type: "study_set",
          id: "set-1",
          study_set_id: "set-1",
          title: "Meteorology 01",
          snippet: "The Atmosphere",
          subtitle: "133 questions",
          href: "/sets/set-1",
          rank: 1,
          updated_at: "2026-01-01T00:00:00Z",
        },
        {
          result_type: "note",
          id: "note-1",
          study_set_id: "set-1",
          title: "Private mnemonic",
          snippet: "Tropopause height",
          subtitle: "Meteorology 01",
          href: "/sets/set-1/edit",
          rank: 0.8,
          updated_at: "2026-01-01T00:00:00Z",
        },
        {
          result_type: "diagram",
          id: "diag-1",
          study_set_id: "set-1",
          title: "Atmospheric Layers",
          snippet: "Troposphere, Stratosphere",
          subtitle: "Meteorology 01",
          href: "/diagrams/diag-1/study",
          rank: 0.7,
          updated_at: "2026-01-01T00:00:00Z",
        },
      ],
    });
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.entity_type)).toEqual([
      "study_set",
      "note",
      "diagram",
    ]);
    expect(items[2]?.href).toBe("/diagrams/diag-1/study");
  });
});
