import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/security/authz";
import {
  apiSuccess,
  AppError,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import { rpcSaveExamAttemptAnswers } from "@/lib/supabase/rpc";
import { uuidSchema } from "@/lib/validation/common";
import {
  saveExamAnswersSchema,
  type SaveExamAnswerItem,
} from "@/lib/validation/exams";

interface RouteContext {
  params: Promise<{ attemptId: string }>;
}

/**
 * Atomic exam answer autosave (fixes SH-010 / DB-P0-6 / SEC-016):
 * - Enforces Postgres server-clock `expires_at` (`409 EXAM_EXPIRED`)
 * - Verifies `attempt_question_id` belongs to `attemptId`
 * - Applies monotonic `client_seq` stale-write guard
 * - Atomically updates live `exam_attempts.answered_count` & `unanswered_count`
 */
export async function PUT(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { supabase } = await requireAuth();
    const { attemptId } = await context.params;
    const id = uuidSchema.parse(attemptId);

    const body = await parseJsonBody(request);
    const parsed = saveExamAnswersSchema.parse(body);
    const items: SaveExamAnswerItem[] =
      "answers" in parsed ? parsed.answers : [parsed];

    const payload = items.map((item) => ({
      attempt_question_id: item.attempt_question_id,
      selected_option_ids: item.selected_option_ids,
      typed_answer: item.typed_answer ?? null,
      structured_response: item.structured_response ?? null,
      confidence: item.confidence ?? null,
      hint_used: item.hint_used ?? false,
      is_flagged: item.is_flagged,
      client_seq: item.client_seq ?? 0,
    }));

    const { data, error } = await rpcSaveExamAttemptAnswers(
      supabase,
      id,
      payload,
    );

    if (error) throw error;
    if (!data) {
      throw new AppError("NOT_FOUND", "Exam attempt not found.", 404);
    }

    return apiSuccess({
      saved: data.saved ?? [],
      stale_ignored_ids: data.stale_ignored_ids ?? [],
      answered_count: data.answered_count ?? 0,
      server_now: data.server_now ?? new Date().toISOString(),
      remaining_seconds: data.remaining_seconds ?? null,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
