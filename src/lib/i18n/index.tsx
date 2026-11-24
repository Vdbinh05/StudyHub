"use client";

import * as React from "react";
import type { Dictionary, Locale, TranslationKey, TranslationParams } from "./types";
import { viDictionary } from "./vi";

const LOCALE_STORAGE_KEY = "studyhub-locale";

interface NodeModuleBuiltin {
  createRequire: (filename: string) => (id: string) => unknown;
}

interface ProcessWithBuiltin {
  getBuiltinModule?: (id: string) => unknown;
}

let cachedEnDictionary: Dictionary | null = null;
let enLoadPromise: Promise<Dictionary> | null = null;
const enLoadedListeners = new Set<() => void>();

function emitEnLoaded(): void {
  for (const listener of enLoadedListeners) {
    listener();
  }
}

/**
 * In Vitest (`NODE_ENV === "test"`), unit tests call `getDictionary("en")` and
 * `translate("en", ...)` synchronously. Next.js replaces `process.env.NODE_ENV`
 * with `"production"` at compile time so this branch is completely dead-code
 * eliminated from browser bundles, saving ~8.5 KB gzip on default Vietnamese loads.
 */
function tryLoadTestEnDictionarySync(): Dictionary | null {
  if (process.env.NODE_ENV !== "test") {
    return null;
  }
  if (cachedEnDictionary) {
    return cachedEnDictionary;
  }
  try {
    const proc = process as unknown as ProcessWithBuiltin;
    const modBuiltin = proc.getBuiltinModule?.("module") as
      | NodeModuleBuiltin
      | undefined;
    if (!modBuiltin) return null;
    const req = modBuiltin.createRequire(import.meta.url);
    const loaded = req("./en.ts") as { enDictionary?: Dictionary };
    if (loaded?.enDictionary) {
      cachedEnDictionary = loaded.enDictionary;
      return cachedEnDictionary;
    }
  } catch {
    // Fallback to async loader
  }
  return null;
}

export function loadEnDictionary(): Promise<Dictionary> {
  if (cachedEnDictionary) {
    return Promise.resolve(cachedEnDictionary);
  }
  if (!enLoadPromise) {
    enLoadPromise = import("./en").then((mod) => {
      cachedEnDictionary = mod.enDictionary;
      emitEnLoaded();
      return mod.enDictionary;
    });
  }
  return enLoadPromise;
}

const localeListeners = new Set<() => void>();

function subscribeLocale(listener: () => void): () => void {
  localeListeners.add(listener);
  enLoadedListeners.add(listener);
  const handleStorage = (event: StorageEvent) => {
    if (event.key === LOCALE_STORAGE_KEY) {
      listener();
    }
  };
  if (typeof window !== "undefined") {
    window.addEventListener("storage", handleStorage);
  }
  return () => {
    localeListeners.delete(listener);
    enLoadedListeners.delete(listener);
    if (typeof window !== "undefined") {
      window.removeEventListener("storage", handleStorage);
    }
  };
}

function readStoredLocale(fallback: Locale): Locale {
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored === "vi" || stored === "en") {
      return stored;
    }
  } catch {
    // Ignore storage read errors in restricted environments
  }
  return fallback;
}

function writeStoredLocale(nextLocale: Locale): void {
  if (nextLocale === "en" && !cachedEnDictionary) {
    void loadEnDictionary();
  }
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, nextLocale);
  } catch {
    // Ignore storage write errors
  }
  for (const listener of localeListeners) {
    listener();
  }
}

export function getDictionary(locale: Locale): Dictionary {
  if (locale === "en") {
    return cachedEnDictionary ?? tryLoadTestEnDictionarySync() ?? viDictionary;
  }
  return viDictionary;
}

export function translate(
  locale: Locale,
  key: TranslationKey,
  params?: TranslationParams,
): string {
  const dict = getDictionary(locale);
  const [section, field] = key.split(".") as [keyof Dictionary, string];
  const sectionObj = dict[section] as Record<string, string> | undefined;
  let value = sectionObj?.[field] ?? key;

  if (params) {
    for (const [paramKey, paramValue] of Object.entries(params)) {
      value = value.replaceAll(`{{${paramKey}}}`, String(paramValue));
    }
  }
  return value;
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (nextLocale: Locale) => void;
  toggleLocale: () => void;
  dict: Dictionary;
  t: (key: TranslationKey, params?: TranslationParams) => string;
}

const I18nContext = React.createContext<I18nContextValue | null>(null);

interface I18nProviderProps {
  children: React.ReactNode;
  defaultLocale?: Locale;
}

export function I18nProvider({
  children,
  defaultLocale = "vi",
}: I18nProviderProps) {
  const locale = React.useSyncExternalStore(
    subscribeLocale,
    () => readStoredLocale(defaultLocale),
    () => defaultLocale,
  );

  // Trigger re-render once lazy-loaded EN dictionary resolves
  const enLoaded = React.useSyncExternalStore(
    subscribeLocale,
    () => cachedEnDictionary !== null,
    () => cachedEnDictionary !== null,
  );

  React.useEffect(() => {
    document.documentElement.lang = locale;
    if (locale === "en" && !cachedEnDictionary) {
      void loadEnDictionary();
    }
  }, [locale]);

  const setLocale = React.useCallback((nextLocale: Locale) => {
    writeStoredLocale(nextLocale);
  }, []);

  const toggleLocale = React.useCallback(() => {
    writeStoredLocale(locale === "vi" ? "en" : "vi");
  }, [locale]);

  const t = React.useCallback(
    (key: TranslationKey, params?: TranslationParams) => {
      void enLoaded;
      return translate(locale, key, params);
    },
    [locale, enLoaded],
  );

  const value = React.useMemo<I18nContextValue>(() => {
    void enLoaded;
    return {
      locale,
      setLocale,
      toggleLocale,
      dict: getDictionary(locale),
      t,
    };
  }, [locale, enLoaded, setLocale, toggleLocale, t]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = React.useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return context;
}

export function useOptionalI18n(): I18nContextValue | null {
  return React.useContext(I18nContext);
}

export type { Dictionary, Locale, TranslationKey, TranslationParams };
