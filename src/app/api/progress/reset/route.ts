import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/security/authz";
import {
  apiSuccess,
  AppError,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rate-limit";
import { rpcResetLearningProgress } from "@/lib/supabase/rpc";
import { progressResetSchema } from "@/lib/validation/v3";

/**
 * Scoped Reset Learning Progress (V3.0).
 * Resets ONLY caller's learning progress/checkpoints/optional stars in the requested scope,
 * bumps `user_preferences.progress_generation` for offline sync safety, and strictly
 * preserves all `exam_attempts` history, study sets, questions, diagrams, and personal notes.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const limited = enforceRateLimit(request, RATE_LIMITS.PROGRESS_RESET, user.id);
    if (limited) return limited;

    const body = progressResetSchema.parse(await parseJsonBody(request));

    const { data, error } = await rpcResetLearningProgress(supabase, {
      scope: body.scope,
      study_set_id: body.study_set_id,
      subject: body.subject,
      chapter: body.chapter,
      question_ids: body.question_ids,
      mode: body.mode,
      clear_mistakes: body.clear_mistakes,
      clear_starred: body.clear_starred,
      clear_checkpoints: body.clear_checkpoints,
    });

    if (error) throw error;
    if (!data) {
      throw new AppError("INTERNAL_ERROR", "Failed to reset learning progress.", 500);
    }

    return apiSuccess(data);
  } catch (err) {
    return handleApiError(err);
  }
}
