import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/security/authz";
import { apiSuccess, AppError, handleApiError } from "@/lib/security/errors";
import type { ExamAttemptPayload } from "@/lib/supabase/rpc";
import { uuidSchema } from "@/lib/validation/common";

interface RouteContext {
  params: Promise<{ attemptId: string }>;
}

function buildChapterBreakdown(payload: ExamAttemptPayload) {
  const answerByQId = new Map(
    (payload.answers ?? []).map((a) => [a.attempt_question_id, a]),
  );

  const chapterMap = new Map<
    string,
    { chapter: string; total: number; correct: number; wrong: number; unanswered: number }
  >();

  for (const q of payload.questions ?? []) {
    const key = q.chapter_snapshot?.trim() || "Uncategorized";
    const entry = chapterMap.get(key) ?? {
      chapter: key,
      total: 0,
      correct: 0,
      wrong: 0,
      unanswered: 0,
    };
    entry.total += 1;
    const ans = answerByQId.get(q.id);
    const hasAns =
      ans !== undefined &&
      ((ans.selected_option_ids && ans.selected_option_ids.length > 0) ||
        Boolean(ans.typed_answer && ans.typed_answer.trim().length > 0));

    if (!hasAns) {
      entry.unanswered += 1;
    } else if (ans.is_correct) {
      entry.correct += 1;
    } else {
      entry.wrong += 1;
    }
    chapterMap.set(key, entry);
  }

  return Array.from(chapterMap.values()).map((c) => ({
    ...c,
    accuracy_percent:
      c.total > 0 ? Math.round((c.correct / c.total) * 10000) / 100 : 0,
  }));
}

export async function POST(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const { attemptId } = await context.params;
    const id = uuidSchema.parse(attemptId);

    // Verify ownership first before invoking atomic RPC
    const { data: attempt, error: checkErr } = await supabase
      .from("exam_attempts")
      .select("id")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (checkErr) throw checkErr;
    if (!attempt) {
      throw new AppError("NOT_FOUND", "Exam attempt not found.", 404);
    }

    // Atomic, FOR UPDATE locked, strictly server-scored & idempotent RPC
    const { data, error } = await supabase.rpc("submit_exam_attempt", {
      p_attempt_id: id,
    });

    if (error) throw error;
    if (!data) {
      throw new AppError("NOT_FOUND", "Exam attempt not found.", 404);
    }

    const gradedPayload = data as unknown as ExamAttemptPayload;

    return apiSuccess({
      ...gradedPayload,
      chapter_breakdown: buildChapterBreakdown(gradedPayload),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
