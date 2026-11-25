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
import {
  isMissingRpcError,
  rpcRecordStudySessionAnswer,
} from "@/lib/supabase/rpc";
import { uuidSchema } from "@/lib/validation/common";
import { recordSessionAnswerSchema } from "@/lib/validation/learning";
import type { Json } from "@/types/database";
import type { StudyMode } from "@/types/domain";

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

    // Fast path (Migration 0018): 1 atomic PostgreSQL RPC replaces 9-11 serial queries
    const { data: rpcResult, error: rpcErr } =
      await rpcRecordStudySessionAnswer(supabase, {
        p_session_id: id,
        p_question_id: input.question_id,
        p_selected_option_ids: input.selected_option_ids,
        p_typed_answer: input.typed_answer ?? null,
        p_structured_response: input.structured_response ?? null,
        p_is_correct: input.is_correct ?? null,
        p_self_rating: input.self_rating ?? null,
        p_confidence: input.confidence ?? null,
        p_hint_used: input.hint_used ?? false,
        p_response_time_ms: input.response_time_ms ?? null,
        p_update_progress: input.update_progress,
      });

    if (!rpcErr && rpcResult) {
      return apiSuccess(rpcResult, undefined, { status: 201 });
    }
    if (rpcErr && !isMissingRpcError(rpcErr)) {
      // V32-044 / SEC-14: Map Postgres error codes to static safe messages (never forward raw rpcErr.message)
      if (rpcErr.code === "P0002") {
        throw new AppError(
          "NOT_FOUND",
          "Study session or question not found.",
          404,
        );
      }
      if (rpcErr.code === "22023") {
        throw new AppError(
          "INVALID_REFERENCE",
          "Invalid answer or question reference for this study session.",
          400,
        );
      }
      throw rpcErr;
    }

    // Fallback when Migration 0018 is not yet applied (parallelized session + question fetch)
    const [{ data: session, error: sessErr }, { data: question, error: qErr }] =
      await Promise.all([
        supabase
          .from("study_sessions")
          .select("*")
          .eq("id", id)
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("questions")
          .select("id, study_set_id, question_type, back_text")
          .eq("id", input.question_id)
          .maybeSingle(),
      ]);

    if (sessErr) throw sessErr;
    if (!session) {
      throw new AppError("NOT_FOUND", "Study session not found.", 404);
    }

    if (qErr) throw qErr;
    if (!question) {
      throw new AppError("NOT_FOUND", "Question not found.", 404);
    }

    // SH-012 / SEC-023: Verify the answered question belongs to this session's study set(s)
    const allowedSets = new Set<string>([
      ...(session.study_set_id ? [session.study_set_id] : []),
      ...(session.source_study_set_ids ?? []),
    ]);
    if (allowedSets.size > 0 && !allowedSets.has(question.study_set_id)) {
      throw new AppError(
        "INVALID_REFERENCE",
        "Question does not belong to this study session.",
        400,
      );
    }

    // Server-authoritative deterministic grading for objective choice questions
    const isChoiceQuestion =
      question.question_type === "single_choice" ||
      question.question_type === "multiple_choice" ||
      question.question_type === "true_false" ||
      question.question_type === "image_choice";

    const effectiveSelectedIds =
      input.selected_option_ids.length > 0
        ? input.selected_option_ids
        : input.structured_response?.kind === "options"
          ? input.structured_response.selected_option_ids
          : [];

    let isCorrect: boolean;

    if (isChoiceQuestion && effectiveSelectedIds.length > 0) {
      const { data: options, error: optErr } = await supabase
        .from("question_options")
        .select("id, is_correct")
        .eq("question_id", question.id)
        .eq("study_set_id", question.study_set_id);
      if (optErr) throw optErr;

      const correctIds = (options ?? [])
        .filter((o) => o.is_correct)
        .map((o) => o.id)
        .sort();
      const selectedIds = Array.from(new Set(effectiveSelectedIds)).sort();

      isCorrect =
        correctIds.length > 0 &&
        correctIds.length === selectedIds.length &&
        correctIds.every((cid, idx) => cid === selectedIds[idx]);
    } else if (input.is_correct !== undefined) {
      isCorrect = input.is_correct;
    } else if (input.self_rating) {
      isCorrect = input.self_rating !== "again";
    } else if (input.typed_answer !== undefined && input.typed_answer !== null) {
      const { data: accepted, error: accErr } = await supabase
        .from("question_accepted_answers")
        .select("answer_text, normalized_answer, match_mode")
        .eq("question_id", question.id)
        .eq("study_set_id", question.study_set_id);
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

    const { data: answerRow, error: ansErr } = await supabase
      .from("study_session_answers")
      .insert({
        session_id: session.id,
        user_id: user.id,
        study_set_id: question.study_set_id,
        question_id: question.id,
        selected_option_ids: effectiveSelectedIds,
        typed_answer: input.typed_answer ?? null,
        structured_response: (input.structured_response ?? null) as Json | null,
        confidence: input.confidence ?? null,
        hint_used: input.hint_used ?? false,
        is_correct: isCorrect,
        self_rating: input.self_rating ?? null,
        response_time_ms: input.response_time_ms ?? null,
      })
      .select("*")
      .single();

    if (ansErr) throw ansErr;

    // Recompute exact completed & correct counts from study_session_answers to avoid RMW lost updates
    const [{ count: completedCount }, { count: correctCount }] =
      await Promise.all([
        supabase
          .from("study_session_answers")
          .select("id", { count: "exact", head: true })
          .eq("session_id", session.id)
          .eq("user_id", user.id),
        supabase
          .from("study_session_answers")
          .select("id", { count: "exact", head: true })
          .eq("session_id", session.id)
          .eq("user_id", user.id)
          .eq("is_correct", true),
      ]);

    const { error: updSessErr } = await supabase
      .from("study_sessions")
      .update({
        completed_items: completedCount ?? session.completed_items + 1,
        correct_items: correctCount ?? session.correct_items + (isCorrect ? 1 : 0),
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
        confidence: input.confidence ?? null,
        hintUsed: input.hint_used ?? false,
        mode: session.mode as StudyMode,
        responseTimeMs: input.response_time_ms ?? null,
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
