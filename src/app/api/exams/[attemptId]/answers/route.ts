import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/security/authz";
import {
  apiSuccess,
  AppError,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import { uuidSchema } from "@/lib/validation/common";
import {
  saveExamAnswersSchema,
  type SaveExamAnswerItem,
} from "@/lib/validation/exams";

interface RouteContext {
  params: Promise<{ attemptId: string }>;
}

export async function PUT(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const { attemptId } = await context.params;
    const id = uuidSchema.parse(attemptId);

    const body = await parseJsonBody(request);
    const parsed = saveExamAnswersSchema.parse(body);
    const items: SaveExamAnswerItem[] =
      "answers" in parsed ? parsed.answers : [parsed];

    const { data: attempt, error: attErr } = await supabase
      .from("exam_attempts")
      .select("id, user_id, status, expires_at")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (attErr) throw attErr;
    if (!attempt) {
      throw new AppError("NOT_FOUND", "Exam attempt not found.", 404);
    }

    if (attempt.status !== "in_progress") {
      throw new AppError(
        "CONFLICT",
        "Exam attempt has already been submitted and can no longer be modified.",
        409,
      );
    }

    if (attempt.expires_at && Date.now() > Date.parse(attempt.expires_at)) {
      throw new AppError(
        "EXAM_EXPIRED",
        "Exam time limit has expired. Submit the exam to view your graded result.",
        409,
      );
    }

    const rows = items.map((item) => ({
      attempt_id: id,
      attempt_question_id: item.attempt_question_id,
      user_id: user.id,
      selected_option_ids: item.selected_option_ids,
      typed_answer: item.typed_answer ?? null,
      is_flagged: item.is_flagged,
      is_correct: null, // Strictly server-graded on submit; clients cannot set is_correct
    }));

    const { data: saved, error: saveErr } = await supabase
      .from("exam_attempt_answers")
      .upsert(rows, { onConflict: "attempt_id,attempt_question_id" })
      .select(
        "id, attempt_id, attempt_question_id, selected_option_ids, typed_answer, is_flagged, updated_at",
      );

    if (saveErr) throw saveErr;

    const serverNow = new Date().toISOString();
    const remainingSeconds = attempt.expires_at
      ? Math.max(
          0,
          Math.floor(
            (Date.parse(attempt.expires_at) - Date.parse(serverNow)) / 1000,
          ),
        )
      : null;

    return apiSuccess({
      saved: saved ?? [],
      server_now: serverNow,
      remaining_seconds: remainingSeconds,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
