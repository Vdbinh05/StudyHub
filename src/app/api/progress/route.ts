import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, requireStudySetAccess } from "@/lib/security/authz";
import {
  apiSuccess,
  AppError,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import { upsertQuestionProgress } from "@/lib/supabase/progress-helper";
import {
  isMissingRpcError,
  rpcRecordProgressAnswer,
} from "@/lib/supabase/rpc";
import {
  listProgressQuerySchema,
  upsertProgressSchema,
} from "@/lib/validation/learning";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const rawParams = Object.fromEntries(request.nextUrl.searchParams.entries());
    const query = listProgressQuerySchema.parse(rawParams);

    const from = (query.page - 1) * query.pageSize;
    const to = from + query.pageSize - 1;

    let dbQuery = supabase
      .from("user_question_progress")
      .select("*", { count: "exact" })
      .eq("user_id", user.id);

    if (query.studySetId) {
      dbQuery = dbQuery.eq("study_set_id", query.studySetId);
    }
    if (query.masteryLevel) {
      dbQuery = dbQuery.eq("mastery_level", query.masteryLevel);
    }

    const { data, count, error } = await dbQuery
      .order("updated_at", { ascending: false })
      .range(from, to);

    if (error) throw error;

    const rows = data ?? [];
    const total = count ?? rows.length;

    return apiSuccess(rows, {
      total,
      page: query.page,
      pageSize: query.pageSize,
      hasMore: from + rows.length < total,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const body = await parseJsonBody(request);
    const input = upsertProgressSchema.parse(body);

    // DB-02 (Migration 0019): Single-RTT atomic FOR UPDATE SM-2 progress RPC
    const { data: rpcProgress, error: rpcErr } = await rpcRecordProgressAnswer(
      supabase,
      {
        p_question_id: input.question_id,
        p_study_set_id: input.study_set_id ?? null,
        p_is_correct: input.is_correct,
        p_self_rating: input.self_rating ?? null,
        p_confidence: input.confidence ?? null,
        p_hint_used: input.hint_used ?? false,
        p_mode: null,
        p_response_time_ms: null,
        p_override_mastery_level: input.mastery_level ?? null,
        p_override_mistake_status: input.mistake_status ?? null,
        p_override_ease_factor: input.ease_factor ?? null,
        p_override_interval_days: input.interval_days ?? null,
        p_override_repetitions: input.repetitions ?? null,
        p_override_next_review_at:
          input.next_review_at !== undefined ? input.next_review_at : null,
        p_has_override_next_review_at: input.next_review_at !== undefined,
      },
    );
    if (!rpcErr && rpcProgress) {
      return apiSuccess(rpcProgress);
    }
    if (rpcErr && !isMissingRpcError(rpcErr)) {
      if (rpcErr.code === "P0002") {
        throw new AppError("NOT_FOUND", "Question not found.", 404);
      }
      if (rpcErr.code === "22023") {
        throw new AppError(
          "INVALID_REFERENCE",
          "Question does not belong to the specified study set.",
          400,
        );
      }
      throw rpcErr;
    }

    // SH-012 / SEC-003: Always resolve true `questions.study_set_id` from DB (eliminates UUID oracle!)
    const { data: qRow, error: qErr } = await supabase
      .from("questions")
      .select("id, study_set_id")
      .eq("id", input.question_id)
      .maybeSingle();

    if (qErr) throw qErr;
    if (!qRow) {
      throw new AppError("NOT_FOUND", "Question not found.", 404);
    }

    if (input.study_set_id && input.study_set_id !== qRow.study_set_id) {
      throw new AppError(
        "INVALID_REFERENCE",
        "Question does not belong to the specified study set.",
        400,
      );
    }

    await requireStudySetAccess(supabase, qRow.study_set_id, user.id, "read");

    const progress = await upsertQuestionProgress({
      supabase,
      userId: user.id,
      studySetId: qRow.study_set_id,
      questionId: qRow.id,
      isCorrect: input.is_correct,
      selfRating: input.self_rating ?? null,
      confidence: input.confidence ?? null,
      hintUsed: input.hint_used ?? false,
      overrides: {
        mastery_level: input.mastery_level,
        mistake_status: input.mistake_status,
        ease_factor: input.ease_factor,
        interval_days: input.interval_days,
        repetitions: input.repetitions,
        next_review_at: input.next_review_at,
      },
    });

    return apiSuccess(progress);
  } catch (err) {
    return handleApiError(err);
  }
}
