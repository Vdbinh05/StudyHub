import {
  isEditableTarget,
  isImeComposingEvent,
  isImeSafeEnterEvent,
  isActiveExamRoute,
  isProtectedBrowserCombo,
  hasOpenModalInDom,
} from "@/lib/shortcuts";

export {
  isEditableTarget,
  isImeComposingEvent,
  isImeSafeEnterEvent,
  isActiveExamRoute,
  isProtectedBrowserCombo,
  hasOpenModalInDom,
};

export interface ShouldIgnoreShortcutOptions {
  /** Whether keyboard shortcuts are enabled in user preferences (defaults to true). */
  shortcutsEnabled?: boolean;
  /** Allow firing while focus is inside an editable input/textarea/contenteditable. */
  allowInEditable?: boolean;
  /** Allow firing while a modal dialog, alertdialog, or Radix popover/select is open. */
  allowInModal?: boolean;
  /** Optional timestamp of the most recent `compositionend` event for Safari IME safety. */
  lastCompositionEndAt?: number | null;
}

const OPEN_OVERLAY_SELECTOR =
  '[role="dialog"]:not([data-state="closed"]), [role="alertdialog"]:not([data-state="closed"]), [data-radix-popper-content-wrapper], dialog[open]';

/**
 * Returns true if any modal dialog, alertdialog, native open <dialog>, or
 * Radix popper menu/select/popover is currently open in the DOM.
 */
export function hasOpenOverlayInDom(): boolean {
  if (typeof document === "undefined") return false;
  return Boolean(document.querySelector(OPEN_OVERLAY_SELECTOR));
}

/**
 * Shared keyboard-shortcut event guard for study modes, exams, and global listeners.
 * Prevents shortcuts from firing when:
 * - Already handled (`event.defaultPrevented`)
 * - Shortcuts disabled via user preference (`shortcutsEnabled === false`)
 * - IME composition is active (Vietnamese Telex/VNI, CJK, Safari keyCode 229)
 * - Focus is inside an editable element (unless `allowInEditable: true`)
 * - Any modal dialog, alertdialog, or Radix popover/select is open (unless `allowInModal: true`)
 */
export function shouldIgnoreShortcutEvent(
  event: KeyboardEvent,
  options?: ShouldIgnoreShortcutOptions,
): boolean {
  if (event.defaultPrevented) {
    return true;
  }

  if (options?.shortcutsEnabled === false) {
    return true;
  }

  if (isImeComposingEvent(event, options?.lastCompositionEndAt ?? null)) {
    return true;
  }

  if (!options?.allowInEditable && isEditableTarget(event.target)) {
    return true;
  }

  if (!options?.allowInModal && hasOpenOverlayInDom()) {
    return true;
  }

  return false;
}
