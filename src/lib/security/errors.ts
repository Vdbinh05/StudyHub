import { NextResponse } from "next/server";
import { ZodError } from "zod";
import {
  SUPABASE_NOT_CONFIGURED_CODE,
  SUPABASE_NOT_CONFIGURED_MESSAGE,
} from "@/lib/supabase/env";

export type ApiErrorCode =
  | "BAD_REQUEST"
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "PAYLOAD_TOO_LARGE"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "RATE_LIMITED"
  | "SUPABASE_NOT_CONFIGURED"
  | "EXAM_EXPIRED"
  | "ACTIVE_ATTEMPT_EXISTS"
  | "CYCLE_ALREADY_COMPLETED"
  | "INVALID_REFERENCE"
  | "INTERNAL_ERROR";

export interface ApiMeta {
  total?: number;
  page?: number;
  pageSize?: number;
  hasMore?: boolean;
  [key: string]: unknown;
}

export interface ApiSuccessEnvelope<T> {
  data: T;
  meta?: ApiMeta;
}

export interface ApiErrorEnvelope {
  error: {
    code: ApiErrorCode | string;
    message: string;
    details?: unknown;
  };
}

export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(
    code: ApiErrorCode,
    message: string,
    status: number,
    details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function apiSuccess<T>(
  data: T,
  meta?: ApiMeta,
  init?: ResponseInit,
): NextResponse<ApiSuccessEnvelope<T>> {
  const body: ApiSuccessEnvelope<T> = meta ? { data, meta } : { data };
  return NextResponse.json(body, init);
}

export function apiError(
  code: ApiErrorCode | string,
  message: string,
  status: number,
  details?: unknown,
  headers?: HeadersInit,
): NextResponse<ApiErrorEnvelope> {
  const body: ApiErrorEnvelope = {
    error: details !== undefined ? { code, message, details } : { code, message },
  };
  return NextResponse.json(body, { status, headers });
}

export function supabaseNotConfiguredResponse(): NextResponse<ApiErrorEnvelope> {
  return apiError(
    SUPABASE_NOT_CONFIGURED_CODE,
    SUPABASE_NOT_CONFIGURED_MESSAGE,
    503,
  );
}

interface PostgresLikeError {
  code?: string;
  message?: string;
}

function isPostgresLikeError(value: unknown): value is PostgresLikeError {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    typeof (value as { code?: unknown }).code === "string"
  );
}

/**
 * Converts unknown errors into safe, uniform API JSON error responses
 * without ever leaking raw PostgreSQL SQL details or stack traces.
 */
export function handleApiError(err: unknown): NextResponse<ApiErrorEnvelope> {
  if (err instanceof AppError) {
    return apiError(err.code, err.message, err.status, err.details);
  }

  if (err instanceof ZodError) {
    const fieldErrors = err.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    }));
    return apiError(
      "VALIDATION_ERROR",
      "Invalid request input.",
      400,
      fieldErrors,
    );
  }

  if (isPostgresLikeError(err)) {
    switch (err.code) {
      case "23505":
        return apiError(
          "CONFLICT",
          "A record with this unique value already exists.",
          409,
        );
      case "23503":
        return apiError(
          "INVALID_REFERENCE",
          "Referenced resource does not exist or cannot be linked.",
          400,
        );
      case "22P02":
      case "22023":
        return apiError(
          "BAD_REQUEST",
          "Invalid identifier or parameter format.",
          400,
        );
      case "23514":
        return apiError(
          "VALIDATION_ERROR",
          "Input violates data constraints.",
          400,
        );
      case "42501":
        return apiError(
          "FORBIDDEN",
          "You do not have permission to perform this action.",
          403,
        );
      case "P0002":
      case "PGRST116":
        return apiError("NOT_FOUND", "Requested resource was not found.", 404);
      case "P0003":
        return apiError(
          "EXAM_EXPIRED",
          "Exam time limit has expired. Submit the exam to view your results.",
          409,
        );
      case "P0004":
      case "P0007":
        return apiError(
          "CONFLICT",
          "This operation cannot be completed in the current state.",
          409,
        );
      case "P0005": {
        const match = err.message?.match(/ACTIVE_ATTEMPT_EXISTS:([0-9a-f-]{36})/i);
        return apiError(
          "ACTIVE_ATTEMPT_EXISTS",
          "An exam is already in progress for this coverage cycle. Resume or discard it before starting the next exam.",
          409,
          match ? { active_attempt_id: match[1] } : undefined,
        );
      }
      case "P0006":
        return apiError(
          "CYCLE_ALREADY_COMPLETED",
          "All questions in this coverage cycle have already been completed.",
          409,
        );
      default:
        return apiError(
          "INTERNAL_ERROR",
          "A database error occurred while processing your request.",
          500,
        );
    }
  }

  if (err instanceof SyntaxError) {
    return apiError("BAD_REQUEST", "Malformed JSON request body.", 400);
  }

  return apiError(
    "INTERNAL_ERROR",
    "An unexpected error occurred while processing your request.",
    500,
  );
}

const DEFAULT_MAX_JSON_BYTES = 1_048_576; // 1 MB default cap (SEC-021 / SH-043)

async function readCappedBodyText(
  request: Request,
  maxBytes: number,
): Promise<string> {
  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader) {
    const declared = Number(contentLengthHeader);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new AppError(
        "PAYLOAD_TOO_LARGE",
        `Request payload exceeds maximum allowed size (${Math.round(maxBytes / 1024)} KB).`,
        413,
      );
    }
  }

  try {
    if (request.body) {
      const reader = request.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          total += value.byteLength;
          if (total > maxBytes) {
            await reader.cancel().catch(() => {});
            throw new AppError(
              "PAYLOAD_TOO_LARGE",
              `Request payload exceeds maximum allowed size (${Math.round(maxBytes / 1024)} KB).`,
              413,
            );
          }
          chunks.push(value);
        }
      }
      const merged = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        merged.set(chunk, offset);
        offset += chunk.byteLength;
      }
      return new TextDecoder("utf-8").decode(merged);
    }

    const rawText = await request.text();
    if (Buffer.byteLength(rawText, "utf8") > maxBytes) {
      throw new AppError(
        "PAYLOAD_TOO_LARGE",
        `Request payload exceeds maximum allowed size (${Math.round(maxBytes / 1024)} KB).`,
        413,
      );
    }
    return rawText;
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError("BAD_REQUEST", "Invalid or unreadable JSON body.", 400);
  }
}

/**
 * Safely parses JSON request body with a pre-parse byte cap,
 * throwing AppError(413) if oversized or AppError(400) if missing/malformed.
 */
export async function parseJsonBody(
  request: Request,
  maxBytes: number = DEFAULT_MAX_JSON_BYTES,
): Promise<unknown> {
  const rawText = await readCappedBodyText(request, maxBytes);

  if (!rawText || rawText.trim().length === 0) {
    throw new AppError("BAD_REQUEST", "Invalid or missing JSON body.", 400);
  }

  try {
    return JSON.parse(rawText) as unknown;
  } catch {
    throw new AppError("BAD_REQUEST", "Invalid or missing JSON body.", 400);
  }
}

/**
 * Safely parses an optional JSON request body (supports HTTP/2 & chunked transfer encoding
 * without `Content-Length`). Returns `undefined` when the request body is empty,
 * throws AppError(413) if oversized, or AppError(400) if non-empty JSON is malformed.
 */
export async function parseOptionalJsonBody(
  request: Request,
  maxBytes: number = DEFAULT_MAX_JSON_BYTES,
): Promise<unknown | undefined> {
  const rawText = await readCappedBodyText(request, maxBytes);

  if (!rawText || rawText.trim().length === 0) {
    return undefined;
  }

  try {
    return JSON.parse(rawText) as unknown;
  } catch {
    throw new AppError("BAD_REQUEST", "Invalid JSON body.", 400);
  }
}
