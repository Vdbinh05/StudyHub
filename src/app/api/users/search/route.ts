import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/security/authz";
import { apiSuccess, handleApiError } from "@/lib/security/errors";
import {
  enforceDistributedRateLimit,
  RATE_LIMITS,
} from "@/lib/security/rate-limit";
import { userSearchQuerySchema } from "@/lib/validation/social";

/**
 * Exact-match username or email lookup via SECURITY DEFINER RPC.
 * Never returns a bulk user list (prevents user enumeration).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const limited = await enforceDistributedRateLimit(
      request,
      RATE_LIMITS.FRIEND_REQUEST,
      user.id,
    );
    if (limited) return limited;

    const q = request.nextUrl.searchParams.get("q") ?? "";
    const parsed = userSearchQuerySchema.parse({ q });

    const { data, error } = await supabase.rpc(
      "find_profile_by_username_or_email",
      { p_query: parsed.q },
    );

    if (error) throw error;

    return apiSuccess(data ?? [], { total: (data ?? []).length });
  } catch (err) {
    return handleApiError(err);
  }
}
