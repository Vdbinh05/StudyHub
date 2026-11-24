import { NextResponse, type NextRequest } from "next/server";
import { getOptionalAuth, requireAuth } from "@/lib/security/authz";
import { apiSuccess, AppError, handleApiError } from "@/lib/security/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rate-limit";
import { rpcPreviewShareLink, rpcRedeemShareLink } from "@/lib/supabase/rpc";

interface RouteContext {
  params: Promise<{ token: string }>;
}

function validateTokenFormat(token: string): string {
  const trimmed = token.trim();
  if (trimmed.length < 16 || trimmed.length > 128 || !/^[A-Za-z0-9_-]+$/.test(trimmed)) {
    throw new AppError("NOT_FOUND", "Share link is invalid or expired.", 404);
  }
  return trimmed;
}

export async function GET(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const limited = enforceRateLimit(request, RATE_LIMITS.SHARE_REDEEM);
    if (limited) return limited;

    const { token } = await context.params;
    const validToken = validateTokenFormat(token);
    const { supabase } = await getOptionalAuth();

    const { data, error } = await rpcPreviewShareLink(supabase, validToken);
    if (error) throw error;
    if (!data) {
      throw new AppError(
        "NOT_FOUND",
        "Share link is invalid, revoked, or expired.",
        404,
      );
    }

    return apiSuccess(data);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const limited = enforceRateLimit(request, RATE_LIMITS.SHARE_REDEEM, user.id);
    if (limited) return limited;

    const { token } = await context.params;
    const validToken = validateTokenFormat(token);

    const { data, error } = await rpcRedeemShareLink(supabase, validToken);
    if (error) throw error;

    if (!data || data.error_code) {
      if (data?.error_code === "REVOKED") {
        throw new AppError("FORBIDDEN", "This share link has been revoked.", 410);
      }
      if (data?.error_code === "EXPIRED") {
        throw new AppError("FORBIDDEN", "This share link has expired.", 410);
      }
      throw new AppError("NOT_FOUND", "Share link not found.", 404);
    }

    return apiSuccess(data);
  } catch (err) {
    return handleApiError(err);
  }
}
