"use client";

import * as React from "react";
import { enDictionary } from "./en";
import type { Dictionary, Locale, TranslationKey, TranslationParams } from "./types";
import { viDictionary } from "./vi";

const LOCALE_STORAGE_KEY = "studyhub-locale";

const dictionaries: Record<Locale, Dictionary> = {
  vi: viDictionary,
  en: enDictionary,
};

const localeListeners = new Set<() => void>();

function subscribeLocale(listener: () => void): () => void {
  localeListeners.add(listener);
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
  return dictionaries[locale] ?? viDictionary;
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

  React.useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const setLocale = React.useCallback((nextLocale: Locale) => {
    writeStoredLocale(nextLocale);
  }, []);

  const toggleLocale = React.useCallback(() => {
    writeStoredLocale(locale === "vi" ? "en" : "vi");
  }, [locale]);

  const t = React.useCallback(
    (key: TranslationKey, params?: TranslationParams) =>
      translate(locale, key, params),
    [locale],
  );

  const value = React.useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      toggleLocale,
      dict: getDictionary(locale),
      t,
    }),
    [locale, setLocale, toggleLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = React.useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return context;
}

export type { Dictionary, Locale, TranslationKey, TranslationParams };
