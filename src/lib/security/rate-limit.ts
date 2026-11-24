import { createHash } from "node:crypto";
import type { NextResponse } from "next/server";
import { apiError, type ApiErrorEnvelope } from "./errors";

export interface RateLimitConfig {
  id: string;
  limit: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfterSeconds: number;
}

export const RATE_LIMITS = {
  IMPORT_PARSE: { id: "import_parse", limit: 15, windowMs: 5 * 60 * 1000 },
  IMPORT_COMMIT: { id: "import_commit", limit: 120, windowMs: 5 * 60 * 1000 },
  SHARE_REDEEM: { id: "share_redeem", limit: 20, windowMs: 15 * 60 * 1000 },
  SHARE_CREATE: { id: "share_create", limit: 20, windowMs: 15 * 60 * 1000 },
  FRIEND_REQUEST: { id: "friend_request", limit: 20, windowMs: 15 * 60 * 1000 },
  EXAM_START: { id: "exam_start", limit: 30, windowMs: 15 * 60 * 1000 },
  SET_CLONE: { id: "set_clone", limit: 15, windowMs: 15 * 60 * 1000 },
  EXPORT: { id: "export", limit: 15, windowMs: 15 * 60 * 1000 },
  ACCOUNT_RESTORE: { id: "account_restore", limit: 5, windowMs: 15 * 60 * 1000 },
  AUTH_ACTION: { id: "auth_action", limit: 20, windowMs: 15 * 60 * 1000 },
  UPLOAD: { id: "upload", limit: 30, windowMs: 15 * 60 * 1000 },
  AUDIO_UPLOAD: { id: "audio_upload", limit: 20, windowMs: 15 * 60 * 1000 },
  SEARCH: { id: "search", limit: 90, windowMs: 60 * 1000 },
  REPORT_CREATE: { id: "report_create", limit: 20, windowMs: 15 * 60 * 1000 },
  SYNC_EVENTS: { id: "sync_events", limit: 60, windowMs: 60 * 1000 },
  PROGRESS_RESET: { id: "progress_reset", limit: 15, windowMs: 15 * 60 * 1000 },
} as const satisfies Record<string, RateLimitConfig>;

/**
 * NOTE (SEC-021): This deterministic sliding-window store runs in-memory per Node.js process
 * (ideal for single-node / self-hosted deployments with zero external dependencies).
 * For multi-region horizontal serverless scale, back this interface with Upstash Redis or a
 * Postgres rate-limit table.
 */
const MAX_STORE_ENTRIES = 10_000;
const store = new Map<string, number[]>();

function pruneStore(now: number, maxWindowMs: number): void {
  if (store.size < MAX_STORE_ENTRIES) {
    return;
  }
  for (const [key, timestamps] of store.entries()) {
    const fresh = timestamps.filter((t) => now - t < maxWindowMs);
    if (fresh.length === 0) {
      store.delete(key);
    } else {
      store.set(key, fresh);
    }
  }
}

/**
 * Deterministic sliding-window rate limit check.
 */
export function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): RateLimitResult {
  pruneStore(now, windowMs);

  const windowStart = now - windowMs;
  const existing = store.get(key) ?? [];
  const validTimestamps = existing.filter((ts) => ts > windowStart);

  if (validTimestamps.length >= limit) {
    const oldest = validTimestamps[0] ?? now;
    const resetAt = oldest + windowMs;
    const retryAfterSeconds = Math.max(1, Math.ceil((resetAt - now) / 1000));
    store.set(key, validTimestamps);
    return {
      allowed: false,
      limit,
      remaining: 0,
      resetAt,
      retryAfterSeconds,
    };
  }

  validTimestamps.push(now);
  store.set(key, validTimestamps);

  const oldest = validTimestamps[0] ?? now;
  const resetAt = oldest + windowMs;

  return {
    allowed: true,
    limit,
    remaining: Math.max(0, limit - validTimestamps.length),
    resetAt,
    retryAfterSeconds: 0,
  };
}

/**
 * Derives a deterministic rate-limit actor key from `userId` or a SHA-256 hash of request IP.
 */
export function getClientIdentifier(request: Request, userId?: string): string {
  if (userId) {
    return `user:${userId}`;
  }
  const forwardedFor = request.headers.get("x-forwarded-for");
  const realIp = request.headers.get("x-real-ip");
  const rawIp =
    forwardedFor?.split(",")[0]?.trim() || realIp?.trim() || "unknown";
  const digest = createHash("sha256").update(rawIp).digest("hex").slice(0, 16);
  return `ip:${digest}`;
}

/**
 * Enforces a rate limit config. Returns a 429 NextResponse if exceeded, or `null` if allowed.
 */
export function enforceRateLimit(
  request: Request,
  config: RateLimitConfig,
  userId?: string,
): NextResponse<ApiErrorEnvelope> | null {
  const actor = getClientIdentifier(request, userId);
  const key = `${config.id}:${actor}`;
  const result = checkRateLimit(key, config.limit, config.windowMs);

  if (!result.allowed) {
    return apiError(
      "RATE_LIMITED",
      "Too many requests. Please wait a moment and try again.",
      429,
      { retryAfterSeconds: result.retryAfterSeconds },
      {
        "Retry-After": String(result.retryAfterSeconds),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
      },
    );
  }

  return null;
}

/**
 * Clears the in-memory sliding-window store (intended for unit tests).
 */
export function resetRateLimitStore(): void {
  store.clear();
}
