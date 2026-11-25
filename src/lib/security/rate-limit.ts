import { createHash } from "node:crypto";
import type { NextResponse } from "next/server";
import { apiError, type ApiErrorEnvelope } from "./errors";

async function getAdminClientForRateLimit() {
  const hasUrl = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim());
  const hasSecret = Boolean(
    process.env.SUPABASE_SECRET_KEY?.trim() ||
      process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  );
  if (!hasUrl || !hasSecret) {
    return null;
  }
  try {
    const { tryCreateAdminClient } = await import("@/lib/supabase/admin");
    return tryCreateAdminClient();
  } catch {
    return null;
  }
}

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
  EXAM_SUBMIT: { id: "exam_submit", limit: 30, windowMs: 5 * 60 * 1000 },
  CYCLE_RESTART: { id: "cycle_restart", limit: 15, windowMs: 15 * 60 * 1000 },
  BULK_QUESTIONS: { id: "bulk_questions", limit: 30, windowMs: 5 * 60 * 1000 },
  SET_CLONE: { id: "set_clone", limit: 15, windowMs: 15 * 60 * 1000 },
  EXPORT: { id: "export", limit: 15, windowMs: 15 * 60 * 1000 },
  ACCOUNT_DATA: { id: "account_data", limit: 5, windowMs: 10 * 60 * 1000 },
  ACCOUNT_RESTORE: { id: "account_restore", limit: 5, windowMs: 15 * 60 * 1000 },
  AUTH_ACTION: { id: "auth_action", limit: 20, windowMs: 15 * 60 * 1000 },
  UPLOAD: { id: "upload", limit: 30, windowMs: 15 * 60 * 1000 },
  AUDIO_UPLOAD: { id: "audio_upload", limit: 20, windowMs: 15 * 60 * 1000 },
  STORAGE_SIGN: { id: "storage_sign", limit: 40, windowMs: 15 * 60 * 1000 },
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
 * On Vercel, prefers trusted `x-vercel-forwarded-for`, then `x-real-ip`, then `x-forwarded-for`.
 */
export function getClientIdentifier(request: Request, userId?: string): string {
  if (userId) {
    return `user:${userId}`;
  }
  const vercelForwarded = request.headers.get("x-vercel-forwarded-for");
  const realIp = request.headers.get("x-real-ip");
  const forwardedFor = request.headers.get("x-forwarded-for");
  const rawIp =
    vercelForwarded?.split(",")[0]?.trim() ||
    realIp?.trim() ||
    forwardedFor?.split(",")[0]?.trim() ||
    "unknown";
  const digest = createHash("sha256").update(rawIp).digest("hex").slice(0, 16);
  return `ip:${digest}`;
}

function buildRateLimitedResponse(result: RateLimitResult): NextResponse<ApiErrorEnvelope> {
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

/**
 * Enforces a synchronous in-memory rate limit config.
 * Returns a 429 NextResponse if exceeded, or `null` if allowed.
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
    return buildRateLimitedResponse(result);
  }

  return null;
}

export interface DistributedRateLimitOptions {
  bucket: string;
  limit: number;
  windowMs: number;
  userId?: string;
  key?: string;
}

interface PgRateLimitRpcResult {
  allowed?: boolean;
  limit?: number;
  remaining?: number;
  reset_at_ms?: number;
  retry_after_seconds?: number;
}

/**
 * Distributed PostgreSQL rate limiter for Vercel serverless isolates (Migration 0017).
 * Calls `service_role`-only RPC `public.check_and_increment_rate_limit` via `tryCreateAdminClient()`,
 * and gracefully falls back to the deterministic in-memory store when admin env vars are absent
 * (e.g. unit tests or local dev without secret key).
 */
export async function enforceDistributedRateLimit(
  request: Request,
  options: DistributedRateLimitOptions | RateLimitConfig,
  userIdArg?: string,
): Promise<NextResponse<ApiErrorEnvelope> | null> {
  const bucket = "bucket" in options ? options.bucket : options.id;
  const limit = options.limit;
  const windowMs = options.windowMs;
  const userId = "bucket" in options ? options.userId : userIdArg;
  const actor =
    "bucket" in options && options.key
      ? options.key
      : getClientIdentifier(request, userId);
  const bucketKey = `${bucket}:${actor}`.slice(0, 256);

  const admin = await getAdminClientForRateLimit();
  if (!admin) {
    const localResult = checkRateLimit(bucketKey, limit, windowMs);
    return localResult.allowed ? null : buildRateLimitedResponse(localResult);
  }

  try {
    const windowSeconds = Math.max(1, Math.ceil(windowMs / 1000));
    const dynamicRpc = (
      admin.rpc as unknown as (
        fn: string,
        params: Record<string, unknown>,
      ) => Promise<{ data: unknown; error: { message?: string } | null }>
    ).bind(admin);

    const { data, error } = await dynamicRpc("check_and_increment_rate_limit", {
      p_bucket_key: bucketKey,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });

    if (error || !data || typeof data !== "object") {
      const localResult = checkRateLimit(bucketKey, limit, windowMs);
      return localResult.allowed ? null : buildRateLimitedResponse(localResult);
    }

    const parsed = data as PgRateLimitRpcResult;
    const allowed = Boolean(parsed.allowed);
    if (allowed) {
      return null;
    }

    const now = Date.now();
    const resetAt =
      typeof parsed.reset_at_ms === "number" && Number.isFinite(parsed.reset_at_ms)
        ? parsed.reset_at_ms
        : now + windowMs;
    const retryAfterSeconds =
      typeof parsed.retry_after_seconds === "number" && parsed.retry_after_seconds > 0
        ? Math.ceil(parsed.retry_after_seconds)
        : Math.max(1, Math.ceil((resetAt - now) / 1000));

    return buildRateLimitedResponse({
      allowed: false,
      limit: typeof parsed.limit === "number" ? parsed.limit : limit,
      remaining: 0,
      resetAt,
      retryAfterSeconds,
    });
  } catch {
    const localResult = checkRateLimit(bucketKey, limit, windowMs);
    return localResult.allowed ? null : buildRateLimitedResponse(localResult);
  }
}

/**
 * Clears the in-memory sliding-window store (intended for unit tests).
 */
export function resetRateLimitStore(): void {
  store.clear();
}
