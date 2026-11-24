export {
  DEFAULT_SHORTCUT_CATALOG,
  IME_COMPOSITION_WINDOW_MS,
  ShortcutRegistry,
  findCatalogConflicts,
  hasOpenModalInDom,
  isActiveExamRoute,
  isEditableTarget,
  isImeComposingEvent,
  isImeSafeEnterEvent,
  isProtectedBrowserCombo,
  matchesShortcutCombo,
  parseCombo,
} from "./registry";

export type {
  ParsedCombo,
  ShortcutBinding,
  ShortcutCatalogItem,
  ShortcutDispatchContext,
  ShortcutScope,
} from "./registry";
