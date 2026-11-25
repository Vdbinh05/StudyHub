"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import {
  isActiveExamRoute,
  ShortcutRegistry,
  type ShortcutBinding,
  type ShortcutScope,
} from "@/lib/shortcuts";
import { shouldIgnoreShortcutEvent } from "@/lib/ui/shortcuts";

const GlobalSearchDialog = dynamic(
  () => import("./GlobalSearchDialog").then((mod) => mod.GlobalSearchDialog),
  { ssr: false },
);

const ShortcutHelpModal = dynamic(
  () => import("./ShortcutHelpModal").then((mod) => mod.ShortcutHelpModal),
  { ssr: false },
);

export interface ShortcutContextValue {
  registry: ShortcutRegistry;
  activeScopes: readonly ShortcutScope[];
  registeredBindings: readonly ShortcutBinding[];
  isHelpOpen: boolean;
  openHelp: () => void;
  closeHelp: () => void;
  isSearchOpen: boolean;
  openSearch: () => void;
  closeSearch: () => void;
  isExamRoute: boolean;
  shortcutsEnabled: boolean;
  setShortcutsEnabled: (enabled: boolean) => void;
}

const ShortcutContext = React.createContext<ShortcutContextValue | null>(null);

const SHORTCUTS_ENABLED_STORAGE_KEY = "studyhub-shortcuts-enabled";

function inferScopeFromPathname(pathname: string): ShortcutScope | null {
  if (isActiveExamRoute(pathname)) return "exam";
  if (/^\/sets\/[^/]+\/flashcards$/.test(pathname)) return "flashcards";
  if (/^\/sets\/[^/]+\/learn$/.test(pathname)) return "learn";
  if (/^\/sets\/[^/]+\/practice$/.test(pathname) || pathname === "/practice") {
    return "practice";
  }
  if (/^\/sets\/[^/]+\/write$/.test(pathname)) return "write";
  if (/^\/sets\/[^/]+\/spell$/.test(pathname)) return "spell";
  if (/^\/diagrams\/[^/]+\/study$/.test(pathname)) return "diagram";
  if (
    /^\/sets\/[^/]+\/edit$/.test(pathname) ||
    /^\/diagrams\/[^/]+\/edit$/.test(pathname)
  ) {
    return "editor";
  }
  return null;
}

const enabledListeners = new Set<() => void>();

function subscribeShortcutsEnabled(listener: () => void): () => void {
  enabledListeners.add(listener);
  const handleStorage = (event: StorageEvent) => {
    if (event.key === SHORTCUTS_ENABLED_STORAGE_KEY || event.key === null) {
      listener();
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", handleStorage);
  }
  return () => {
    enabledListeners.delete(listener);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", handleStorage);
    }
  };
}

function getShortcutsEnabledSnapshot(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(SHORTCUTS_ENABLED_STORAGE_KEY) !== "false";
  } catch {
    return true;
  }
}

function setShortcutsEnabledStorage(enabled: boolean): void {
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(
        SHORTCUTS_ENABLED_STORAGE_KEY,
        enabled ? "true" : "false",
      );
    } catch {
      // Ignore private-mode storage errors
    }
  }
  for (const listener of enabledListeners) {
    listener();
  }
}

export function ShortcutProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "/";
  const examRoute = isActiveExamRoute(pathname);
  const registry = React.useMemo(() => new ShortcutRegistry(), []);
  const lastCompositionEndRef = React.useRef<number | null>(null);

  const [helpOpen, setHelpOpen] = React.useState(false);
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [registryVersion, setRegistryVersion] = React.useState(0);

  const shortcutsEnabled = React.useSyncExternalStore(
    subscribeShortcutsEnabled,
    getShortcutsEnabledSnapshot,
    () => true,
  );

  // Re-render modal catalog when bindings/scopes change
  React.useEffect(() => {
    return registry.subscribe(() => {
      setRegistryVersion((v) => v + 1);
    });
  }, [registry]);

  // Activate route-inferred scope automatically
  React.useEffect(() => {
    const inferred = inferScopeFromPathname(pathname);
    if (!inferred) return;
    return registry.activateScope(inferred);
  }, [pathname, registry]);

  const openSearch = React.useCallback(() => {
    if (examRoute) return;
    setHelpOpen(false);
    setSearchOpen(true);
  }, [examRoute]);

  const closeSearch = React.useCallback(() => {
    setSearchOpen(false);
  }, []);

  const openHelp = React.useCallback(() => {
    setSearchOpen(false);
    setHelpOpen(true);
  }, []);

  const closeHelp = React.useCallback(() => {
    setHelpOpen(false);
  }, []);

  // Register global shortcuts (`Mod+K` search, `?` help modal)
  React.useEffect(() => {
    return registry.registerMany([
      {
        id: "global.search",
        scope: "global",
        combo: "Mod+K",
        labelVi: "Mở tìm kiếm toàn thư viện (tắt khi đang thi)",
        labelEn: "Open global library search (disabled during exams)",
        keysDisplay: ["Ctrl", "K"],
        allowInInput: true,
        allowInModal: false,
        allowInExam: false,
        handler: () => openSearch(),
      },
      {
        id: "global.help",
        scope: "global",
        combo: "?",
        labelVi: "Mở bảng hướng dẫn phím tắt",
        labelEn: "Open keyboard shortcuts reference",
        keysDisplay: ["?"],
        allowInInput: false,
        allowInModal: false,
        allowInExam: true,
        preventDefault: true,
        handler: (event) => {
          event.preventDefault();
          openHelp();
        },
      },
    ]);
  }, [registry, openSearch, openHelp]);

  // Single centralized window keydown + capture compositionend listener
  React.useEffect(() => {
    if (typeof window === "undefined") return;

    const handleCompositionEnd = (event: CompositionEvent) => {
      lastCompositionEndRef.current = event.timeStamp;
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      const isEscape = event.key === "Escape";
      const isModK =
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        event.key.toLowerCase() === "k";

      if (
        !isEscape &&
        shouldIgnoreShortcutEvent(event, {
          shortcutsEnabled,
          allowInEditable: isModK,
          allowInModal: false,
          lastCompositionEndAt: lastCompositionEndRef.current,
        })
      ) {
        return;
      }

      registry.handleKeyDown(event, {
        pathname,
        lastCompositionEndAt: lastCompositionEndRef.current,
        modalOpen: helpOpen || searchOpen ? true : undefined,
        shortcutsEnabled,
      });
    };

    window.addEventListener("compositionend", handleCompositionEnd, true);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("compositionend", handleCompositionEnd, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [registry, pathname, helpOpen, searchOpen, shortcutsEnabled]);

  const effectiveSearchOpen = searchOpen && !examRoute;

  const activeScopes = React.useMemo(
    () => {
      void registryVersion;
      return registry.getActiveScopes();
    },
    [registry, registryVersion],
  );

  const registeredBindings = React.useMemo(
    () => {
      void registryVersion;
      return registry.getRegisteredBindings();
    },
    [registry, registryVersion],
  );

  const value = React.useMemo<ShortcutContextValue>(
    () => ({
      registry,
      activeScopes,
      registeredBindings,
      isHelpOpen: helpOpen,
      openHelp,
      closeHelp,
      isSearchOpen: effectiveSearchOpen,
      openSearch,
      closeSearch,
      isExamRoute: examRoute,
      shortcutsEnabled,
      setShortcutsEnabled: setShortcutsEnabledStorage,
    }),
    [
      registry,
      activeScopes,
      registeredBindings,
      helpOpen,
      openHelp,
      closeHelp,
      effectiveSearchOpen,
      openSearch,
      closeSearch,
      examRoute,
      shortcutsEnabled,
    ],
  );

  return (
    <ShortcutContext.Provider value={value}>
      {children}
      {helpOpen ? (
        <ShortcutHelpModal
          open={helpOpen}
          onOpenChange={setHelpOpen}
          activeScopes={activeScopes}
          registeredBindings={registeredBindings}
        />
      ) : null}
      {effectiveSearchOpen ? (
        <GlobalSearchDialog
          open={effectiveSearchOpen}
          onOpenChange={(next) => {
            if (examRoute) {
              setSearchOpen(false);
              return;
            }
            setSearchOpen(next);
          }}
        />
      ) : null}
    </ShortcutContext.Provider>
  );
}

const FALLBACK_REGISTRY = new ShortcutRegistry();

const FALLBACK_SHORTCUT_CONTEXT: ShortcutContextValue = {
  registry: FALLBACK_REGISTRY,
  activeScopes: ["global"],
  registeredBindings: [],
  isHelpOpen: false,
  openHelp: () => {},
  closeHelp: () => {},
  isSearchOpen: false,
  openSearch: () => {},
  closeSearch: () => {},
  isExamRoute: false,
  shortcutsEnabled: true,
  setShortcutsEnabled: setShortcutsEnabledStorage,
};

export function useShortcuts(): ShortcutContextValue {
  const ctx = React.useContext(ShortcutContext);
  return ctx ?? FALLBACK_SHORTCUT_CONTEXT;
}

export function useShortcutScope(scope: ShortcutScope): void {
  const { registry } = useShortcuts();
  React.useEffect(() => {
    return registry.activateScope(scope);
  }, [registry, scope]);
}

export function useRegisterShortcuts(
  bindings: readonly ShortcutBinding[],
  enabled = true,
): void {
  const { registry } = useShortcuts();
  React.useEffect(() => {
    if (!enabled || bindings.length === 0) return;
    return registry.registerMany(bindings);
  }, [registry, bindings, enabled]);
}
