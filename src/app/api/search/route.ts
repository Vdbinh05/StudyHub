import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/security/authz";
import { apiSuccess, handleApiError } from "@/lib/security/errors";
import {
  enforceDistributedRateLimit,
  RATE_LIMITS,
} from "@/lib/security/rate-limit";
import { rpcGlobalLibrarySearch } from "@/lib/supabase/rpc";
import { globalSearchQuerySchema } from "@/lib/validation/v3";

/**
 * Deterministic Global Library Search (`Ctrl/Cmd + K`, V3.0).
 * Searches folders, study sets, questions, options, tags, chapters, personal notes (caller's own only!),
 * and diagrams/hotspot labels with strict RLS authorization and zero AI.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const limited = await enforceDistributedRateLimit(
      request,
      RATE_LIMITS.SEARCH,
      user.id,
    );
    if (limited) return limited;

    const sp = request.nextUrl.searchParams;
    const query = globalSearchQuerySchema.parse({
      q: sp.get("q") ?? "",
      type: sp.get("type") ?? undefined,
      limit: sp.get("limit") ?? undefined,
      offset: sp.get("offset") ?? undefined,
    });

    if (!query.q) {
      return apiSuccess({
        query: "",
        items: [],
        counts_by_type: {},
        total: 0,
      });
    }

    const { data, error } = await rpcGlobalLibrarySearch(supabase, {
      query: query.q,
      types: query.type,
      limit: query.limit,
      offset: query.offset,
    });

    if (error) throw error;
    return apiSuccess(
      data ?? {
        query: query.q,
        items: [],
        counts_by_type: {},
        total: 0,
      },
    );
  } catch (err) {
    return handleApiError(err);
  }
}
