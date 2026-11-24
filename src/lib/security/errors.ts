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
      case "PGRST116":
        return apiError("NOT_FOUND", "Requested resource was not found.", 404);
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

/**
 * Safely parses JSON request body, throwing AppError(400) if malformed.
 */
export async function parseJsonBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new AppError("BAD_REQUEST", "Invalid or missing JSON body.", 400);
  }
}
