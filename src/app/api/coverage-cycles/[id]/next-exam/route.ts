import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/security/authz";
import { apiSuccess, AppError, handleApiError } from "@/lib/security/errors";
import {
  enforceDistributedRateLimit,
  RATE_LIMITS,
} from "@/lib/security/rate-limit";
import { issueNextExamForCycle } from "@/lib/supabase/coverage-helper";
import { uuidSchema } from "@/lib/validation/common";
import type { CoverageCycle } from "@/types/domain";

export const runtime = "nodejs";
export const maxDuration = 60;

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const limited = await enforceDistributedRateLimit(
      request,
      RATE_LIMITS.EXAM_START,
      user.id,
    );
    if (limited) return limited;

    const { id: rawId } = await context.params;
    const id = uuidSchema.parse(rawId);

    const { data: cycleRow, error } = await supabase
      .from("coverage_cycles")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) throw error;
    if (!cycleRow) {
      throw new AppError("NOT_FOUND", "Coverage cycle not found.", 404);
    }

    const cycle: CoverageCycle = {
      ...cycleRow,
      source_snapshot: (Array.isArray(cycleRow.source_snapshot)
        ? cycleRow.source_snapshot
        : []) as CoverageCycle["source_snapshot"],
      filter_snapshot: (cycleRow.filter_snapshot ?? {}) as Record<
        string,
        unknown
      >,
    };

    const issued = await issueNextExamForCycle(supabase, user.id, cycle);

    return apiSuccess(issued, undefined, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
