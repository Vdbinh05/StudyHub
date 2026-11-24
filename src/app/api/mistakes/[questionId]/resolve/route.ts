import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/security/authz";
import { apiSuccess, AppError, handleApiError } from "@/lib/security/errors";
import { uuidSchema } from "@/lib/validation/common";

interface RouteContext {
  params: Promise<{ questionId: string }>;
}

/**
 * Marks a mistake as resolved without deleting historical `wrong_count` or session/exam history.
 */
export async function POST(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const { questionId } = await context.params;
    const qId = uuidSchema.parse(questionId);

    const now = new Date();
    const nextReview = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    const { data, error } = await supabase
      .from("user_question_progress")
      .update({
        mastery_level: "mastered",
        consecutive_correct: 4,
        interval_days: 14,
        last_reviewed_at: now.toISOString(),
        next_review_at: nextReview.toISOString(),
      })
      .eq("user_id", user.id)
      .eq("question_id", qId)
      .select("*")
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      throw new AppError(
        "NOT_FOUND",
        "No mistake record found for this question.",
        404,
      );
    }

    return apiSuccess(data);
  } catch (err) {
    return handleApiError(err);
  }
}
