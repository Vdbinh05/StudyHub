/**
 * StudyHub V3.0 — Centralized, IME-Safe Keyboard Shortcuts Registry
 *
 * Pure deterministic registry with:
 * - Context-aware priority (modal > active study mode > global)
 * - Strict IME composition safety (isComposing, keyCode===229, 50ms compositionend window)
 * - Editable target suppression (input, textarea, select, contenteditable, .ProseMirror)
 * - Protected browser combo guards (Ctrl/Cmd+R/T/W/L/N/Q/C/V/X/A/Z/Y)
 * - Hard active-exam guard preventing answer-leaking global shortcuts
 */

export type ShortcutScope =
  | "global"
  | "modal"
  | "flashcards"
  | "learn"
  | "practice"
  | "write"
  | "spell"
  | "diagram"
  | "exam"
  | "editor";

export interface ShortcutBinding {
  id: string;
  scope: ShortcutScope;
  /** Key combo such as "Mod+K", "?", "Space", "ArrowRight", "1", "Escape", "a" */
  combo: string;
  /** Optional alternate combos triggering the same action */
  aliases?: readonly string[];
  labelVi: string;
  labelEn: string;
  /** Human-readable keycaps shown in ShortcutHelpModal */
  keysDisplay?: readonly string[];
  /** Allow firing while focus is inside an editable element (default: false) */
  allowInInput?: boolean;
  /** Allow firing while a modal dialog is open (default: true for modal scope or Escape, else false) */
  allowInModal?: boolean;
  /** Allow firing on active exam routes (default: true for exam/modal scope, false for search/nav) */
  allowInExam?: boolean;
  /** Call event.preventDefault() when matched (default: true) */
  preventDefault?: boolean;
  /** Dynamic enable guard */
  enabled?: boolean | (() => boolean);
  handler: (event: KeyboardEvent) => void;
}

export interface ShortcutCatalogItem {
  id: string;
  scope: ShortcutScope;
  combo: string;
  keysDisplay: readonly string[];
  labelVi: string;
  labelEn: string;
}

export interface ParsedCombo {
  key: string;
  mod: boolean;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
}

export interface ShortcutDispatchContext {
  pathname?: string;
  lastCompositionEndAt?: number | null;
  modalOpen?: boolean;
  shortcutsEnabled?: boolean;
}

const SCOPE_PRIORITY: Record<ShortcutScope, number> = {
  global: 10,
  editor: 40,
  flashcards: 50,
  learn: 50,
  practice: 50,
  write: 50,
  spell: 50,
  diagram: 50,
  exam: 60,
  modal: 100,
};

const EDITABLE_SELECTOR =
  'input, textarea, select, option, [contenteditable="true"], [contenteditable=""], .ProseMirror, [role="textbox"], [role="combobox"], [role="searchbox"]';

const PROTECTED_MOD_KEYS = new Set([
  "r",
  "t",
  "w",
  "l",
  "n",
  "q",
  "c",
  "v",
  "x",
  "a",
  "z",
  "y",
  "p",
  "f",
]);

/**
 * Window in milliseconds after `compositionend` during which confirming Enter/keystrokes
 * must still be suppressed to protect Safari (WebKit bug 165004) IME users.
 */
export const IME_COMPOSITION_WINDOW_MS = 50;

/**
 * Returns true if the KeyboardEvent occurred during IME composition or within
 * 50ms of `compositionend` (per Modern Web Guidance: `ime-safe-enter-submit`).
 */
export function isImeComposingEvent(
  event: Pick<KeyboardEvent, "isComposing" | "key" | "keyCode" | "timeStamp"> & {
    which?: number;
  },
  lastCompositionEndAt: number | null = null,
): boolean {
  if (event.isComposing) return true;
  if (event.keyCode === 229 || event.which === 229) return true;
  if (event.key === "Process" || event.key === "Dead") return true;
  if (
    lastCompositionEndAt !== null &&
    typeof event.timeStamp === "number" &&
    Math.abs(event.timeStamp - lastCompositionEndAt) < IME_COMPOSITION_WINDOW_MS
  ) {
    return true;
  }
  return false;
}

/**
 * Helper for custom Enter-to-submit handlers inside inputs, textareas, and command palettes.
 */
export function isImeSafeEnterEvent(
  event: Pick<
    KeyboardEvent,
    "key" | "shiftKey" | "isComposing" | "keyCode" | "timeStamp"
  > & { which?: number },
  lastCompositionEndAt: number | null = null,
  options?: { allowShift?: boolean },
): boolean {
  if (event.key !== "Enter") return false;
  if (!options?.allowShift && event.shiftKey) return false;
  return !isImeComposingEvent(event, lastCompositionEndAt);
}

/**
 * Returns true if focus is currently inside a text input, textarea, select,
 * contenteditable region, or TipTap/ProseMirror rich-text editor.
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false;
  const node = target as Partial<HTMLElement> & { nodeType?: number };
  if (node.nodeType !== 1) return false;

  const tag = (node.tagName ?? "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "OPTION") {
    return true;
  }
  if (node.isContentEditable === true) {
    return true;
  }
  const contentEditableAttr = node.getAttribute?.("contenteditable");
  if (contentEditableAttr === "" || contentEditableAttr === "true") {
    return true;
  }
  if (typeof node.closest === "function" && node.closest(EDITABLE_SELECTOR)) {
    return true;
  }
  return false;
}

/**
 * Protects critical browser shortcuts (`Ctrl+R`, `Ctrl+T`, `Ctrl+W`, `Ctrl+L`, clipboard, etc.)
 * so StudyHub NEVER hijacks browser navigation, tabs, reload, or text editing.
 */
export function isProtectedBrowserCombo(
  event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">,
): boolean {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) {
    return false;
  }
  const lowerKey = event.key.toLowerCase();
  if (PROTECTED_MOD_KEYS.has(lowerKey)) {
    return true;
  }
  return false;
}

/**
 * Hard exam route guard: matches live exam taking routes where Global Search
 * and answer-lookup shortcuts must NEVER open.
 */
export function isActiveExamRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const clean = pathname.split("?")[0]?.replace(/\/+$/, "") || "/";
  if (/^\/sets\/[^/]+\/test$/.test(clean)) {
    return true;
  }
  // /exams/[attemptId] is active exam; /exams, /exams/new, and /exams/[id]/results are NOT
  const examMatch = /^\/exams\/([^/]+)$/.exec(clean);
  if (examMatch && examMatch[1] !== "new") {
    return true;
  }
  return false;
}

/**
 * Detects whether a modal dialog or alertdialog is currently open in the DOM.
 */
export function hasOpenModalInDom(): boolean {
  if (typeof document === "undefined") return false;
  return Boolean(
    document.querySelector(
      '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], dialog[open]',
    ),
  );
}

/**
 * Normalizes a shortcut combo string such as "Mod+K", "Shift+/", "Space", "1", "?".
 */
export function parseCombo(combo: string): ParsedCombo {
  const parts = combo
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);

  let mod = false;
  let ctrl = false;
  let meta = false;
  let alt = false;
  let shift = false;
  let rawKey = "";

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === "mod" || lower === "cmdorctrl") {
      mod = true;
    } else if (lower === "ctrl" || lower === "control") {
      ctrl = true;
    } else if (lower === "meta" || lower === "cmd" || lower === "command") {
      meta = true;
    } else if (lower === "alt" || lower === "option") {
      alt = true;
    } else if (lower === "shift") {
      shift = true;
    } else {
      rawKey = part;
    }
  }

  return {
    key: normalizeKeyToken(rawKey),
    mod,
    ctrl,
    meta,
    alt,
    shift,
  };
}

function normalizeKeyToken(token: string): string {
  const lower = token.toLowerCase();
  if (lower === "space" || lower === "spacebar" || token === " ") return "space";
  if (lower === "esc" || lower === "escape") return "escape";
  if (lower === "enter" || lower === "return") return "enter";
  if (lower === "left" || lower === "arrowleft") return "arrowleft";
  if (lower === "right" || lower === "arrowright") return "arrowright";
  if (lower === "up" || lower === "arrowup") return "arrowup";
  if (lower === "down" || lower === "arrowdown") return "arrowdown";
  if (lower === "plus") return "+";
  if (lower === "minus") return "-";
  return lower;
}

function normalizeEventKey(event: Pick<KeyboardEvent, "key" | "code">): string {
  if (event.key === " " || event.code === "Space") return "space";
  return normalizeKeyToken(event.key);
}

/**
 * Tests whether a DOM KeyboardEvent matches a parsed or string shortcut combo.
 */
export function matchesShortcutCombo(
  event: Pick<
    KeyboardEvent,
    "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey"
  >,
  combo: string,
): boolean {
  const parsed = parseCombo(combo);
  const eventKey = normalizeEventKey(event);

  if (parsed.key !== eventKey) {
    return false;
  }

  if (parsed.mod) {
    if (!(event.ctrlKey || event.metaKey)) return false;
  } else {
    if (parsed.ctrl !== Boolean(event.ctrlKey)) return false;
    if (parsed.meta !== Boolean(event.metaKey)) return false;
  }

  if (parsed.alt !== Boolean(event.altKey)) return false;

  // Characters produced via Shift on standard keyboards (like "?") naturally have shiftKey=true
  const shiftProducedChars = new Set(["?", "!", "+", "*", "(", ")", ":"]);
  if (shiftProducedChars.has(parsed.key)) {
    return true;
  }

  if (parsed.shift !== Boolean(event.shiftKey)) return false;
  return true;
}

interface RegisteredEntry {
  binding: ShortcutBinding;
  order: number;
}

/**
 * Pure, framework-agnostic shortcut registry supporting dynamic scopes,
 * deterministic conflict resolution, and strict IME/input/exam guards.
 */
export class ShortcutRegistry {
  private entries = new Map<string, RegisteredEntry>();
  private orderCounter = 0;
  private activeScopes = new Set<ShortcutScope>(["global"]);
  private listeners = new Set<() => void>();

  register(binding: ShortcutBinding): () => void {
    const key = `${binding.scope}::${binding.id}`;
    this.entries.set(key, {
      binding,
      order: ++this.orderCounter,
    });
    this.notify();
    return () => {
      const existing = this.entries.get(key);
      if (existing && existing.binding === binding) {
        this.entries.delete(key);
        this.notify();
      }
    };
  }

  registerMany(bindings: readonly ShortcutBinding[]): () => void {
    const unsubs = bindings.map((b) => this.register(b));
    return () => {
      for (const unsub of unsubs) {
        unsub();
      }
    };
  }

  activateScope(scope: ShortcutScope): () => void {
    this.activeScopes.add(scope);
    this.notify();
    return () => {
      if (scope !== "global") {
        this.activeScopes.delete(scope);
        this.notify();
      }
    };
  }

  getActiveScopes(): ShortcutScope[] {
    return Array.from(this.activeScopes);
  }

  getRegisteredBindings(): ShortcutBinding[] {
    return Array.from(this.entries.values())
      .sort((a, b) => {
        const prioDiff = SCOPE_PRIORITY[b.binding.scope] - SCOPE_PRIORITY[a.binding.scope];
        if (prioDiff !== 0) return prioDiff;
        return b.order - a.order;
      })
      .map((entry) => entry.binding);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  /**
   * Dispatches a KeyboardEvent against registered bindings.
   * Returns the matched binding ID, or null if suppressed/unmatched.
   */
  handleKeyDown(
    event: KeyboardEvent,
    context: ShortcutDispatchContext = {},
  ): string | null {
    if (event.defaultPrevented) return null;

    // 1. Strict IME safety — NEVER fire while composing or within 50ms of compositionend
    if (isImeComposingEvent(event, context.lastCompositionEndAt ?? null)) {
      return null;
    }

    // 2. Never hijack protected browser shortcuts (Ctrl+R, Ctrl+T, Ctrl+W, Ctrl+L, clipboard...)
    if (isProtectedBrowserCombo(event)) {
      return null;
    }

    const inInput = isEditableTarget(event.target);
    const inModal = context.modalOpen ?? hasOpenModalInDom();
    const inExam = isActiveExamRoute(context.pathname);
    const shortcutsEnabled = context.shortcutsEnabled ?? true;

    const candidates = Array.from(this.entries.values()).sort((a, b) => {
      const prioDiff = SCOPE_PRIORITY[b.binding.scope] - SCOPE_PRIORITY[a.binding.scope];
      if (prioDiff !== 0) return prioDiff;
      return b.order - a.order;
    });

    for (const { binding } of candidates) {
      // Allow global + modal bindings always; study-mode bindings require their scope active or registered
      if (
        binding.scope !== "global" &&
        binding.scope !== "modal" &&
        !this.activeScopes.has(binding.scope)
      ) {
        continue;
      }

      // If user turned off study shortcuts, still allow Escape and modal controls
      if (
        !shortcutsEnabled &&
        binding.scope !== "modal" &&
        normalizeKeyToken(binding.combo) !== "escape"
      ) {
        continue;
      }

      // Input suppression unless explicitly opted in (e.g., Mod+K or Escape)
      if (inInput && !binding.allowInInput) {
        continue;
      }

      // Modal guard
      const allowInModal =
        binding.allowInModal ??
        (binding.scope === "modal" || normalizeKeyToken(binding.combo) === "escape");
      if (inModal && !allowInModal) {
        continue;
      }

      // Hard exam guard
      const allowInExam =
        binding.allowInExam ??
        (binding.scope === "exam" || binding.scope === "modal");
      if (inExam && !allowInExam) {
        continue;
      }

      // Dynamic enabled guard
      if (typeof binding.enabled === "function") {
        if (!binding.enabled()) continue;
      } else if (binding.enabled === false) {
        continue;
      }

      const combos = [binding.combo, ...(binding.aliases ?? [])];
      const matched = combos.some((c) => matchesShortcutCombo(event, c));
      if (!matched) continue;

      if (binding.preventDefault !== false) {
        event.preventDefault();
      }
      binding.handler(event);
      return binding.id;
    }

    return null;
  }
}

/**
 * Conflict-checked reference catalog of StudyHub V3.0 shortcuts displayed in ShortcutHelpModal.
 */
export const DEFAULT_SHORTCUT_CATALOG: readonly ShortcutCatalogItem[] = [
  // Global
  {
    id: "global.search",
    scope: "global",
    combo: "Mod+K",
    keysDisplay: ["Ctrl", "K"],
    labelVi: "Mở tìm kiếm toàn thư viện (tắt khi đang thi)",
    labelEn: "Open global library search (disabled during exams)",
  },
  {
    id: "global.help",
    scope: "global",
    combo: "?",
    keysDisplay: ["?"],
    labelVi: "Mở bảng hướng dẫn phím tắt",
    labelEn: "Open keyboard shortcuts reference",
  },
  {
    id: "global.escape",
    scope: "global",
    combo: "Escape",
    keysDisplay: ["Esc"],
    labelVi: "Đóng hộp thoại hoặc cửa sổ phóng to ảnh",
    labelEn: "Close active dialog or image lightbox",
  },
  // Flashcards
  {
    id: "flashcards.flip",
    scope: "flashcards",
    combo: "Space",
    keysDisplay: ["Space"],
    labelVi: "Lật mặt trước / mặt sau thẻ",
    labelEn: "Flip flashcard front / back",
  },
  {
    id: "flashcards.prev",
    scope: "flashcards",
    combo: "ArrowLeft",
    keysDisplay: ["←"],
    labelVi: "Chuyển sang thẻ trước",
    labelEn: "Previous flashcard",
  },
  {
    id: "flashcards.next",
    scope: "flashcards",
    combo: "ArrowRight",
    keysDisplay: ["→"],
    labelVi: "Chuyển sang thẻ tiếp theo",
    labelEn: "Next flashcard",
  },
  {
    id: "flashcards.rateAgain",
    scope: "flashcards",
    combo: "1",
    keysDisplay: ["1"],
    labelVi: "Đánh giá: Quên / Học lại",
    labelEn: "Rate: Again",
  },
  {
    id: "flashcards.rateHard",
    scope: "flashcards",
    combo: "2",
    keysDisplay: ["2"],
    labelVi: "Đánh giá: Khó",
    labelEn: "Rate: Hard",
  },
  {
    id: "flashcards.rateGood",
    scope: "flashcards",
    combo: "3",
    keysDisplay: ["3"],
    labelVi: "Đánh giá: Tốt",
    labelEn: "Rate: Good",
  },
  {
    id: "flashcards.rateEasy",
    scope: "flashcards",
    combo: "4",
    keysDisplay: ["4"],
    labelVi: "Đánh giá: Dễ",
    labelEn: "Rate: Easy",
  },
  {
    id: "flashcards.star",
    scope: "flashcards",
    combo: "s",
    keysDisplay: ["S"],
    labelVi: "Gắn / bỏ dấu sao thẻ hiện tại",
    labelEn: "Star / unstar current card",
  },
  {
    id: "flashcards.audio",
    scope: "flashcards",
    combo: "r",
    keysDisplay: ["R"],
    labelVi: "Phát âm thanh / đọc văn bản thẻ",
    labelEn: "Play card audio / text-to-speech",
  },
  // Practice & Learn
  {
    id: "practice.option1",
    scope: "practice",
    combo: "1",
    keysDisplay: ["1–6"],
    labelVi: "Chọn nhanh phương án 1–6 (hoặc A–F)",
    labelEn: "Select option 1–6 (or A–F)",
  },
  {
    id: "practice.next",
    scope: "practice",
    combo: "Enter",
    keysDisplay: ["Enter"],
    labelVi: "Kiểm tra hoặc sang câu tiếp theo",
    labelEn: "Check answer or continue to next question",
  },
  {
    id: "practice.hint",
    scope: "practice",
    combo: "h",
    keysDisplay: ["H"],
    labelVi: "Hiện / ẩn gợi ý câu hỏi",
    labelEn: "Toggle question hint",
  },
  {
    id: "learn.option1",
    scope: "learn",
    combo: "1",
    keysDisplay: ["1–4"],
    labelVi: "Chọn đáp án trong vòng nhận diện",
    labelEn: "Select option in recognition stage",
  },
  {
    id: "learn.next",
    scope: "learn",
    combo: "Enter",
    keysDisplay: ["Enter"],
    labelVi: "Xác nhận hoặc sang câu tiếp theo (an toàn IME)",
    labelEn: "Submit or continue (IME-safe)",
  },
  {
    id: "learn.hint",
    scope: "learn",
    combo: "h",
    keysDisplay: ["H"],
    labelVi: "Mở gợi ý câu hỏi",
    labelEn: "Reveal question hint",
  },
  // Write & Spell
  {
    id: "write.submit",
    scope: "write",
    combo: "Enter",
    keysDisplay: ["Enter"],
    labelVi: "Nộp câu trả lời (không cắt ngang bộ gõ tiếng Việt/IME)",
    labelEn: "Submit typed answer (IME-safe)",
  },
  {
    id: "spell.replay",
    scope: "spell",
    combo: "Alt+R",
    keysDisplay: ["Alt", "R"],
    labelVi: "Nghe lại âm thanh câu hỏi",
    labelEn: "Replay question audio",
  },
  {
    id: "spell.submit",
    scope: "spell",
    combo: "Enter",
    keysDisplay: ["Enter"],
    labelVi: "Kiểm tra chính tả (an toàn IME)",
    labelEn: "Check spelling (IME-safe)",
  },
  // Diagram
  {
    id: "diagram.zoomIn",
    scope: "diagram",
    combo: "+",
    keysDisplay: ["+"],
    labelVi: "Phóng to sơ đồ",
    labelEn: "Zoom in diagram",
  },
  {
    id: "diagram.zoomOut",
    scope: "diagram",
    combo: "-",
    keysDisplay: ["-"],
    labelVi: "Thu nhỏ sơ đồ",
    labelEn: "Zoom out diagram",
  },
  {
    id: "diagram.resetZoom",
    scope: "diagram",
    combo: "0",
    keysDisplay: ["0"],
    labelVi: "Đặt lại mức thu phóng mặc định",
    labelEn: "Reset diagram zoom",
  },
  // Exam
  {
    id: "exam.prev",
    scope: "exam",
    combo: "ArrowLeft",
    keysDisplay: ["←"],
    labelVi: "Câu trước trong bài thi",
    labelEn: "Previous exam question",
  },
  {
    id: "exam.next",
    scope: "exam",
    combo: "ArrowRight",
    keysDisplay: ["→"],
    labelVi: "Câu tiếp theo trong bài thi",
    labelEn: "Next exam question",
  },
  {
    id: "exam.optionSelect",
    scope: "exam",
    combo: "1",
    keysDisplay: ["1–6 / A–F"],
    labelVi: "Chọn phương án trắc nghiệm",
    labelEn: "Select multiple-choice option",
  },
  {
    id: "exam.flag",
    scope: "exam",
    combo: "f",
    keysDisplay: ["F / M"],
    labelVi: "Đánh dấu câu cần xem lại",
    labelEn: "Flag question for review",
  },
  {
    id: "exam.navigator",
    scope: "exam",
    combo: "g",
    keysDisplay: ["G"],
    labelVi: "Mở / đóng bảng điều hướng câu hỏi",
    labelEn: "Toggle question navigator grid",
  },
] as const;

/**
 * Verifies that no two catalog items inside the same scope share the same normalized combo.
 */
export function findCatalogConflicts(
  items: readonly ShortcutCatalogItem[] = DEFAULT_SHORTCUT_CATALOG,
): Array<{ scope: ShortcutScope; combo: string; ids: string[] }> {
  const seen = new Map<string, string[]>();
  for (const item of items) {
    const parsed = parseCombo(item.combo);
    const sig = `${item.scope}::${parsed.mod ? "M" : ""}${parsed.ctrl ? "C" : ""}${parsed.meta ? "W" : ""}${parsed.alt ? "A" : ""}${parsed.shift ? "S" : ""}:${parsed.key}`;
    const list = seen.get(sig) ?? [];
    list.push(item.id);
    seen.set(sig, list);
  }
  const conflicts: Array<{ scope: ShortcutScope; combo: string; ids: string[] }> = [];
  for (const [sig, ids] of seen.entries()) {
    if (ids.length > 1) {
      const [scope, combo] = sig.split("::") as [ShortcutScope, string];
      conflicts.push({ scope, combo, ids });
    }
  }
  return conflicts;
}
