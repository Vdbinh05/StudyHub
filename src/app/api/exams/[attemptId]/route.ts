import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/security/authz";
import { apiSuccess, AppError, handleApiError } from "@/lib/security/errors";
import {
  rpcGetExamAttemptDetail,
  type ExamAttemptPayload,
} from "@/lib/supabase/rpc";
import { uuidSchema } from "@/lib/validation/common";
import type { ExamSnapshotQuestion } from "@/types/domain";

interface RouteContext {
  params: Promise<{ attemptId: string }>;
}

function sanitizeInProgressQuestions(
  questions: ExamSnapshotQuestion[],
): ExamSnapshotQuestion[] {
  return questions.map((q) => ({
    id: q.id,
    attempt_id: q.attempt_id,
    question_id: q.question_id,
    position: q.position,
    question_type: q.question_type,
    chapter_snapshot: q.chapter_snapshot,
    prompt_snapshot: q.prompt_snapshot,
    prompt_image_url_snapshot: q.prompt_image_url_snapshot,
    options_snapshot: (q.options_snapshot ?? []).map((opt) => ({
      id: opt.id,
      label: opt.label,
      content: opt.content,
      image_url: opt.image_url ?? null,
      position: opt.position,
    })),
    created_at: q.created_at,
  }));
}

function buildChapterBreakdown(payload: ExamAttemptPayload) {
  const answerByQId = new Map(
    payload.answers.map((a) => [a.attempt_question_id, a]),
  );

  const chapterMap = new Map<
    string,
    { chapter: string; total: number; correct: number; wrong: number; unanswered: number }
  >();

  for (const q of payload.questions) {
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

export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { supabase } = await requireAuth();
    const { attemptId } = await context.params;
    const id = uuidSchema.parse(attemptId);

    const { data: detail, error } = await rpcGetExamAttemptDetail(supabase, id);
    if (error) throw error;
    if (!detail) {
      throw new AppError("NOT_FOUND", "Exam attempt not found.", 404);
    }

    const serverNowIso = detail.server_now ?? new Date().toISOString();
    const serverNowMs = Date.parse(serverNowIso);

    // Auto-finalize expired in-progress exams atomically via idempotent submit RPC
    if (
      detail.attempt.status === "in_progress" &&
      detail.attempt.expires_at &&
      serverNowMs > Date.parse(detail.attempt.expires_at)
    ) {
      const { data: graded, error: submitErr } = await supabase.rpc(
        "submit_exam_attempt",
        { p_attempt_id: id },
      );
      if (submitErr) throw submitErr;
      const gradedPayload = graded as unknown as ExamAttemptPayload;
      return apiSuccess({
        ...gradedPayload,
        server_now: new Date().toISOString(),
        remaining_seconds: 0,
        chapter_breakdown: buildChapterBreakdown(gradedPayload),
      });
    }

    if (detail.attempt.status === "in_progress") {
      const remainingSeconds = detail.attempt.expires_at
        ? Math.max(
            0,
            Math.floor(
              (Date.parse(detail.attempt.expires_at) - serverNowMs) / 1000,
            ),
          )
        : null;

      return apiSuccess({
        attempt: detail.attempt,
        questions: sanitizeInProgressQuestions(detail.questions),
        answers: detail.answers.map((a) => ({
          id: a.id,
          attempt_id: a.attempt_id,
          attempt_question_id: a.attempt_question_id,
          selected_option_ids: a.selected_option_ids,
          typed_answer: a.typed_answer,
          is_flagged: a.is_flagged,
          updated_at: a.updated_at,
        })),
        server_now: serverNowIso,
        remaining_seconds: remainingSeconds,
      });
    }

    return apiSuccess({
      ...detail,
      server_now: serverNowIso,
      remaining_seconds: 0,
      chapter_breakdown: buildChapterBreakdown(detail),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const { attemptId } = await context.params;
    const id = uuidSchema.parse(attemptId);

    const { data, error } = await supabase
      .from("exam_attempts")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      throw new AppError("NOT_FOUND", "Exam attempt not found.", 404);
    }

    return apiSuccess({ deleted: true, id });
  } catch (err) {
    return handleApiError(err);
  }
}
