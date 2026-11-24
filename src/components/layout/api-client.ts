import type { Locale } from "@/types/domain";

export interface ApiEnvelope<T> {
  data: T;
  meta?: {
    total?: number;
    page?: number;
    pageSize?: number;
    hasMore?: boolean;
    [key: string]: unknown;
  };
}

export interface ApiErrorPayload {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function isSupabaseConfiguredClient(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );
}

/**
 * Typed JSON fetch wrapper aligned with StudyHub's uniform `{ data, meta? }` / `{ error }` contract.
 */
export async function apiFetch<T>(
  url: string,
  init?: RequestInit,
): Promise<ApiEnvelope<T>> {
  const headers = new Headers(init?.headers);
  if (init?.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, {
    credentials: "same-origin",
    ...init,
    headers,
  });

  const contentType = response.headers.get("content-type") ?? "";
  const isJson = contentType.includes("application/json");

  if (!response.ok) {
    if (isJson) {
      const payload = (await response.json().catch(() => null)) as
        | ApiErrorPayload
        | { message?: string }
        | null;
      if (payload && "error" in payload && payload.error) {
        throw new ApiError(
          payload.error.code ?? "API_ERROR",
          payload.error.message ?? response.statusText,
          response.status,
          payload.error.details,
        );
      }
      if (payload && "message" in payload && payload.message) {
        throw new ApiError("API_ERROR", payload.message, response.status);
      }
    }
    throw new ApiError(
      response.status === 401
        ? "UNAUTHORIZED"
        : response.status === 503
          ? "SUPABASE_NOT_CONFIGURED"
          : "HTTP_ERROR",
      response.statusText || "Request failed",
      response.status,
    );
  }

  if (response.status === 204 || !isJson) {
    return { data: undefined as T };
  }

  const parsed = (await response.json()) as ApiEnvelope<T> | T;
  if (parsed && typeof parsed === "object" && "data" in parsed) {
    return parsed as ApiEnvelope<T>;
  }
  return { data: parsed as T };
}

export function formatShortDate(iso: string | null | undefined, locale: Locale): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

export function formatDateTime(iso: string | null | undefined, locale: Locale): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatRelativeTime(iso: string | null | undefined, locale: Locale): string {
  if (!iso) return locale === "vi" ? "Chưa học" : "Not studied";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const diffSeconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (diffSeconds < 60) return locale === "vi" ? "Vừa xong" : "Just now";
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return locale === "vi" ? `${diffMinutes} phút trước` : `${diffMinutes}m ago`;
  }
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return locale === "vi" ? `${diffHours} giờ trước` : `${diffHours}h ago`;
  }
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) {
    return locale === "vi" ? `${diffDays} ngày trước` : `${diffDays}d ago`;
  }
  return formatShortDate(iso, locale);
}

export function formatMinutes(totalSeconds: number, locale: Locale): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  if (hours > 0) {
    return locale === "vi" ? `${hours}g ${minutes}p` : `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return locale === "vi" ? `${minutes} phút` : `${minutes}m`;
  }
  return locale === "vi" ? `${safe} giây` : `${safe}s`;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback below
    }
  }
  return false;
}
