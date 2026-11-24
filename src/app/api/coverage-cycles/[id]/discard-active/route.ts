import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/security/authz";
import { apiSuccess, AppError, handleApiError } from "@/lib/security/errors";
import { fetchCycleSubjectProgress } from "@/lib/supabase/coverage-helper";
import { rpcDiscardCoverageCycleActiveExam } from "@/lib/supabase/rpc";
import { uuidSchema } from "@/lib/validation/common";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { supabase } = await requireAuth();
    const { id: rawId } = await context.params;
    const id = uuidSchema.parse(rawId);

    const { data, error } = await rpcDiscardCoverageCycleActiveExam(supabase, id);
    if (error) throw error;
    if (!data) {
      throw new AppError("NOT_FOUND", "Coverage cycle not found.", 404);
    }

    const subjectProgress = await fetchCycleSubjectProgress(supabase, id);

    return apiSuccess({
      ...data,
      cycle: {
        ...data.cycle,
        remaining_count: Math.max(
          0,
          data.cycle.total_questions -
            data.cycle.completed_count -
            data.cycle.assigned_count,
        ),
        progress_percent:
          data.cycle.total_questions > 0
            ? Math.round(
                (data.cycle.completed_count / data.cycle.total_questions) * 10000,
              ) / 100
            : 0,
        subject_progress: subjectProgress,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
