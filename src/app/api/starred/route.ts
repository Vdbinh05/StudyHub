import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, requireStudySetAccess } from "@/lib/security/authz";
import {
  apiSuccess,
  AppError,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import {
  fetchInChunks,
  fetchQuestionRelationsChunked,
  SAFE_IN_CHUNK_SIZE,
} from "@/lib/supabase/query-helpers";
import {
  isMissingRpcError,
  rpcToggleStarredQuestion,
} from "@/lib/supabase/rpc";
import {
  listStarredQuerySchema,
  toggleStarSchema,
} from "@/lib/validation/learning";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const rawParams = Object.fromEntries(request.nextUrl.searchParams.entries());
    const query = listStarredQuerySchema.parse(rawParams);

    const from = (query.page - 1) * query.pageSize;
    const to = from + query.pageSize - 1;

    let dbQuery = supabase
      .from("starred_questions")
      .select("*", { count: "exact" })
      .eq("user_id", user.id);

    if (query.studySetId) {
      dbQuery = dbQuery.eq("study_set_id", query.studySetId);
    }

    const { data: stars, count, error } = await dbQuery
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) throw error;

    const starRows = stars ?? [];
    if (starRows.length === 0) {
      return apiSuccess([], {
        total: 0,
        page: query.page,
        pageSize: query.pageSize,
        hasMore: false,
      });
    }

    const qIds = starRows.map((s) => s.question_id);
    const setIds = Array.from(new Set(starRows.map((s) => s.study_set_id)));

    // SH-005 & BUG-038: Chunk all lookups and include accepted_answers + progress + tags!
    const [questions, relations, sets, progressRows] = await Promise.all([
      fetchInChunks(
        qIds,
        async (chunk) => supabase.from("questions").select("*").in("id", chunk),
        SAFE_IN_CHUNK_SIZE,
      ),
      fetchQuestionRelationsChunked(supabase, qIds),
      fetchInChunks(
        setIds,
        async (chunk) =>
          supabase.from("study_sets").select("id, title, subject").in("id", chunk),
        SAFE_IN_CHUNK_SIZE,
      ),
      fetchInChunks(
        qIds,
        async (chunk) =>
          supabase
            .from("user_question_progress")
            .select("*")
            .eq("user_id", user.id)
            .in("question_id", chunk),
        SAFE_IN_CHUNK_SIZE,
      ),
    ]);

    const qMap = new Map(questions.map((q) => [q.id, q]));
    const setMap = new Map(sets.map((s) => [s.id, s]));
    const progMap = new Map(progressRows.map((p) => [p.question_id, p]));

    const items = starRows
      .map((star) => {
        const q = qMap.get(star.question_id);
        if (!q) return null;
        return {
          starred_at: star.created_at,
          study_set: setMap.get(star.study_set_id) ?? null,
          progress: progMap.get(q.id) ?? null,
          question: {
            ...q,
            media_attachments: relations.questionMediaByQ.get(q.id) ?? [],
            options: relations.optionsByQ.get(q.id) ?? [],
            accepted_answers: relations.answersByQ.get(q.id) ?? [],
            tags: relations.tagsByQ.get(q.id) ?? [],
            is_starred: true,
          },
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    const total = count ?? items.length;
    return apiSuccess(items, {
      total,
      page: query.page,
      pageSize: query.pageSize,
      hasMore: from + items.length < total,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const body = await parseJsonBody(request);
    const input = toggleStarSchema.parse(body);

    // DB-02 (Migration 0019): Atomic single-RTT toggle RPC eliminates double-click 23505 race
    const { data: rpcToggle, error: rpcErr } = await rpcToggleStarredQuestion(
      supabase,
      {
        p_question_id: input.question_id,
        p_study_set_id: input.study_set_id ?? null,
      },
    );
    if (!rpcErr && rpcToggle) {
      return apiSuccess(
        rpcToggle,
        undefined,
        rpcToggle.starred ? { status: 201 } : undefined,
      );
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

    // SH-012 / SEC-003: Always resolve `questions.study_set_id` from DB (never trust caller alone!)
    const { data: q, error: qErr } = await supabase
      .from("questions")
      .select("id, study_set_id")
      .eq("id", input.question_id)
      .maybeSingle();

    if (qErr) throw qErr;
    if (!q) {
      throw new AppError("NOT_FOUND", "Question not found.", 404);
    }

    if (input.study_set_id && input.study_set_id !== q.study_set_id) {
      throw new AppError(
        "INVALID_REFERENCE",
        "Question does not belong to the specified study set.",
        400,
      );
    }

    const studySetId = q.study_set_id;
    await requireStudySetAccess(supabase, studySetId, user.id, "read");

    const { data: existing, error: exErr } = await supabase
      .from("starred_questions")
      .select("question_id")
      .eq("user_id", user.id)
      .eq("question_id", input.question_id)
      .maybeSingle();

    if (exErr) throw exErr;

    if (existing) {
      const { error: delErr } = await supabase
        .from("starred_questions")
        .delete()
        .eq("user_id", user.id)
        .eq("question_id", input.question_id);
      if (delErr) throw delErr;
      return apiSuccess({ starred: false, question_id: input.question_id });
    }

    const { error: insErr } = await supabase.from("starred_questions").insert({
      user_id: user.id,
      question_id: input.question_id,
      study_set_id: studySetId,
    });
    if (insErr) {
      // DB-02 fallback parity: handle concurrent double-click 23505 idempotently
      if (insErr.code === "23505") {
        return apiSuccess({ starred: true, question_id: input.question_id });
      }
      throw insErr;
    }

    return apiSuccess(
      { starred: true, question_id: input.question_id },
      undefined,
      { status: 201 },
    );
  } catch (err) {
    return handleApiError(err);
  }
}
