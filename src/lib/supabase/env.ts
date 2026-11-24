/**
 * Supabase environment configuration helpers.
 * Never falls back to fake auth or hardcoded credentials.
 */

export interface SupabaseEnv {
  url: string;
  anonKey: string;
}

export const SUPABASE_NOT_CONFIGURED_CODE = "SUPABASE_NOT_CONFIGURED" as const;
export const SUPABASE_NOT_CONFIGURED_MESSAGE =
  "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.";

const PLACEHOLDER_URL_MARKERS = [
  "your-project-ref.supabase.co",
  "your-supabase-url",
  "example.supabase.co",
];

const PLACEHOLDER_KEY_MARKERS = [
  "your-supabase-anon-key",
  "your-anon-key",
  "placeholder",
];

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function isPlaceholder(value: string, markers: string[]): boolean {
  const lower = value.toLowerCase();
  return markers.some((marker) => lower.includes(marker));
}

export function getSupabaseEnv(): SupabaseEnv | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";

  if (!url || !anonKey) {
    return null;
  }
  if (!isValidHttpUrl(url)) {
    return null;
  }
  if (
    isPlaceholder(url, PLACEHOLDER_URL_MARKERS) ||
    isPlaceholder(anonKey, PLACEHOLDER_KEY_MARKERS)
  ) {
    return null;
  }

  return { url, anonKey };
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseEnv() !== null;
}

export function getSupabaseServiceRoleKey(): string | null {
  if (typeof window !== "undefined") {
    throw new Error(
      "SECURITY VIOLATION: getSupabaseServiceRoleKey() must never be called on the client.",
    );
  }
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  if (!key || isPlaceholder(key, PLACEHOLDER_KEY_MARKERS)) {
    return null;
  }
  return key;
}

export function getAppUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (raw && isValidHttpUrl(raw)) {
    return raw.replace(/\/+$/, "");
  }
  return "http://localhost:3000";
}
