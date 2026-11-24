import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/security/authz";
import {
  apiSuccess,
  AppError,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import { normalizeAnswerText } from "@/lib/security/sanitize";
import { upsertQuestionProgress } from "@/lib/supabase/progress-helper";
import { uuidSchema } from "@/lib/validation/common";
import { recordSessionAnswerSchema } from "@/lib/validation/learning";

interface RouteContext {
  params: Promise<{ sessionId: string }>;
}

export async function POST(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const { sessionId } = await context.params;
    const id = uuidSchema.parse(sessionId);

    const body = await parseJsonBody(request);
    const input = recordSessionAnswerSchema.parse(body);

    const { data: session, error: sessErr } = await supabase
      .from("study_sessions")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (sessErr) throw sessErr;
    if (!session) {
      throw new AppError("NOT_FOUND", "Study session not found.", 404);
    }

    const { data: question, error: qErr } = await supabase
      .from("questions")
      .select("id, study_set_id, question_type, back_text")
      .eq("id", input.question_id)
      .maybeSingle();

    if (qErr) throw qErr;
    if (!question) {
      throw new AppError("NOT_FOUND", "Question not found.", 404);
    }

    // Deterministic server-side grading if caller didn't explicitly supply self-assessed is_correct
    let isCorrect = input.is_correct;

    if (isCorrect === undefined) {
      if (
        question.question_type === "single_choice" ||
        question.question_type === "multiple_choice" ||
        question.question_type === "true_false"
      ) {
        const { data: options, error: optErr } = await supabase
          .from("question_options")
          .select("id, is_correct")
          .eq("question_id", question.id);
        if (optErr) throw optErr;

        const correctIds = (options ?? [])
          .filter((o) => o.is_correct)
          .map((o) => o.id)
          .sort();
        const selectedIds = Array.from(new Set(input.selected_option_ids)).sort();

        isCorrect =
          correctIds.length > 0 &&
          correctIds.length === selectedIds.length &&
          correctIds.every((cid, idx) => cid === selectedIds[idx]);
      } else if (input.self_rating) {
        isCorrect = input.self_rating !== "again";
      } else if (input.typed_answer !== undefined && input.typed_answer !== null) {
        const { data: accepted, error: accErr } = await supabase
          .from("question_accepted_answers")
          .select("answer_text, normalized_answer, match_mode")
          .eq("question_id", question.id);
        if (accErr) throw accErr;

        if (accepted && accepted.length > 0) {
          isCorrect = accepted.some((acc) => {
            const normUser = normalizeAnswerText(
              input.typed_answer ?? "",
              acc.match_mode,
            );
            const normAcc = normalizeAnswerText(acc.answer_text, acc.match_mode);
            return normUser.length > 0 && normUser === normAcc;
          });
        } else if (question.back_text) {
          const normUser = normalizeAnswerText(
            input.typed_answer,
            "ignore_diacritics",
          );
          const normBack = normalizeAnswerText(
            question.back_text,
            "ignore_diacritics",
          );
          isCorrect = normUser.length > 0 && normUser === normBack;
        } else {
          isCorrect = false;
        }
      } else {
        isCorrect = false;
      }
    }

    const { data: answerRow, error: ansErr } = await supabase
      .from("study_session_answers")
      .insert({
        session_id: session.id,
        user_id: user.id,
        study_set_id: question.study_set_id,
        question_id: question.id,
        selected_option_ids: input.selected_option_ids,
        typed_answer: input.typed_answer ?? null,
        is_correct: isCorrect,
        self_rating: input.self_rating ?? null,
        response_time_ms: input.response_time_ms ?? null,
      })
      .select("*")
      .single();

    if (ansErr) throw ansErr;

    // Update running session counters
    const { error: updSessErr } = await supabase
      .from("study_sessions")
      .update({
        completed_items: session.completed_items + 1,
        correct_items: session.correct_items + (isCorrect ? 1 : 0),
      })
      .eq("id", session.id)
      .eq("user_id", user.id);

    if (updSessErr) throw updSessErr;

    let progress = null;
    if (input.update_progress) {
      progress = await upsertQuestionProgress({
        supabase,
        userId: user.id,
        studySetId: question.study_set_id,
        questionId: question.id,
        isCorrect,
        selfRating: input.self_rating ?? null,
      });
    }

    return apiSuccess(
      {
        answer: answerRow,
        is_correct: isCorrect,
        progress,
      },
      undefined,
      { status: 201 },
    );
  } catch (err) {
    return handleApiError(err);
  }
}
