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
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publicKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  return Boolean(url && publicKey);
}

/**
 * Returns true if the error indicates the backend Supabase database is not yet configured.
 */
export function isServiceUnavailableError(err: unknown): boolean {
  if (err instanceof ApiError) {
    if (err.status === 503 || err.code === "SUPABASE_NOT_CONFIGURED") {
      return true;
    }
  }
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (
      msg.includes("supabase") ||
      msg.includes("next_public_supabase") ||
      msg.includes(".env.local")
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Translates raw API or infrastructure errors into calm, student-friendly messages.
 * Never leaks environment variable names or raw Postgres traces in student copy.
 */
export function getFriendlyErrorMessage(
  err: unknown,
  locale: Locale,
  fallback?: string,
): string {
  const vi = locale === "vi";
  if (isServiceUnavailableError(err)) {
    return vi
      ? "Kết nối đến máy chủ dữ liệu học tập hiện chưa sẵn sàng. Vui lòng thử lại sau."
      : "The study database service is temporarily unavailable. Please try again shortly.";
  }
  if (err instanceof ApiError) {
    if (err.status === 401) {
      return vi
        ? "Bạn cần đăng nhập để tiếp tục thao tác này."
        : "Please sign in to continue.";
    }
    if (err.status === 403) {
      return vi
        ? "Bạn không có quyền thực hiện thao tác này."
        : "You do not have permission to perform this action.";
    }
    if (err.status === 404) {
      return vi
        ? "Không tìm thấy nội dung yêu cầu."
        : "The requested item could not be found.";
    }
    if (err.status === 429) {
      return vi
        ? "Bạn thao tác quá nhanh. Vui lòng đợi một lát rồi thử lại."
        : "Too many requests. Please wait a moment and try again.";
    }
    if (err.message && err.message.trim().length > 0) {
      return err.message;
    }
  }
  if (err instanceof Error && err.message.trim().length > 0) {
    return err.message;
  }
  return (
    fallback ??
    (vi
      ? "Đã xảy ra lỗi. Vui lòng thử lại."
      : "Something went wrong. Please try again.")
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
