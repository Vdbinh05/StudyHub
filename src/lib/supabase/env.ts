/**
 * Supabase environment configuration helpers.
 * Supports both modern Supabase API keys (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` /
 * `SUPABASE_SECRET_KEY`) and legacy JWT keys (`NEXT_PUBLIC_SUPABASE_ANON_KEY` /
 * `SUPABASE_SERVICE_ROLE_KEY`).
 * Never falls back to fake auth or hardcoded credentials.
 */

export interface SupabaseEnv {
  url: string;
  /** Public client key (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` or legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY`). */
  publishableKey: string;
  /** Backwards-compatible alias for `publishableKey`. */
  anonKey: string;
}

export const SUPABASE_NOT_CONFIGURED_CODE = "SUPABASE_NOT_CONFIGURED" as const;
export const SUPABASE_NOT_CONFIGURED_MESSAGE =
  "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or legacy NEXT_PUBLIC_SUPABASE_ANON_KEY) in .env.local.";

const PLACEHOLDER_URL_MARKERS = [
  "your-project-ref.supabase.co",
  "your-supabase-url",
  "example.supabase.co",
];

const PLACEHOLDER_KEY_MARKERS = [
  "your-supabase-publishable-key",
  "your-publishable-key",
  "your-supabase-anon-key",
  "your-anon-key",
  "your-supabase-secret-key",
  "your-secret-key",
  "your-service-role-key",
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
  // Static `process.env.NEXT_PUBLIC_*` accesses are required so Next.js Turbopack
  // inlines BOTH modern and legacy public keys into browser bundles.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const publishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    "";

  if (!url || !publishableKey) {
    return null;
  }
  if (!isValidHttpUrl(url)) {
    return null;
  }
  if (
    isPlaceholder(url, PLACEHOLDER_URL_MARKERS) ||
    isPlaceholder(publishableKey, PLACEHOLDER_KEY_MARKERS)
  ) {
    return null;
  }

  return { url, publishableKey, anonKey: publishableKey };
}

export function isSupabaseConfigured(): boolean {
  return getSupabaseEnv() !== null;
}

export function getSupabaseSecretKey(): string | null {
  if (typeof window !== "undefined") {
    throw new Error(
      "SECURITY VIOLATION: getSupabaseSecretKey() must never be called on the client.",
    );
  }
  const key =
    process.env.SUPABASE_SECRET_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    "";
  if (!key || isPlaceholder(key, PLACEHOLDER_KEY_MARKERS)) {
    return null;
  }
  return key;
}

/** Backwards-compatible alias for `getSupabaseSecretKey()`. */
export function getSupabaseServiceRoleKey(): string | null {
  return getSupabaseSecretKey();
}

export function isSupabaseAdminConfigured(): boolean {
  if (typeof window !== "undefined") {
    return false;
  }
  return getSupabaseEnv() !== null && getSupabaseSecretKey() !== null;
}

export function getAppUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (raw && isValidHttpUrl(raw)) {
    return raw.replace(/\/+$/, "");
  }
  const vercelProd = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercelProd) {
    const candidate = vercelProd.startsWith("http")
      ? vercelProd
      : `https://${vercelProd}`;
    if (isValidHttpUrl(candidate)) {
      return candidate.replace(/\/+$/, "");
    }
  }
  const vercelPreview = process.env.VERCEL_URL?.trim();
  if (vercelPreview) {
    const candidate = vercelPreview.startsWith("http")
      ? vercelPreview
      : `https://${vercelPreview}`;
    if (isValidHttpUrl(candidate)) {
      return candidate.replace(/\/+$/, "");
    }
  }
  return "http://localhost:3000";
}
