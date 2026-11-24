import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/security/authz";
import { apiSuccess, handleApiError } from "@/lib/security/errors";
import {
  fetchAllPages,
  fetchInChunks,
  fetchQuestionRelationsChunked,
  SAFE_IN_CHUNK_SIZE,
} from "@/lib/supabase/query-helpers";
import { listMistakesQuerySchema } from "@/lib/validation/learning";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const rawParams = Object.fromEntries(request.nextUrl.searchParams.entries());
    const query = listMistakesQuerySchema.parse(rawParams);

    const cutoffIso = query.days
      ? new Date(Date.now() - query.days * 86_400_000).toISOString()
      : null;

    // SH-005: Paginate all matching mistake progress rows cleanly
    const allProgress = await fetchAllPages(async (from, to) => {
      let dbQuery = supabase
        .from("user_question_progress")
        .select("*")
        .eq("user_id", user.id)
        .gte("wrong_count", query.minWrongCount);

      if (query.studySetId) {
        dbQuery = dbQuery.eq("study_set_id", query.studySetId);
      }
      if (!query.includeResolved) {
        dbQuery = dbQuery.neq("mastery_level", "mastered");
      }
      if (cutoffIso) {
        dbQuery = dbQuery.gte("last_reviewed_at", cutoffIso);
      }

      return dbQuery
        .order("wrong_count", { ascending: false })
        .order("last_reviewed_at", { ascending: false })
        .range(from, to);
    });

    if (allProgress.length === 0) {
      return apiSuccess([], {
        total: 0,
        page: query.page,
        pageSize: query.pageSize,
        hasMore: false,
      });
    }

    const allQuestionIds = allProgress.map((p) => p.question_id);

    // Fetch questions in chunks first so chapter filtering runs before pagination
    const questions = await fetchInChunks(
      allQuestionIds,
      async (chunk) => {
        let qQuery = supabase.from("questions").select("*").in("id", chunk);
        if (query.chapter) {
          qQuery = qQuery.eq("chapter", query.chapter);
        }
        return qQuery;
      },
      SAFE_IN_CHUNK_SIZE,
    );

    const qMap = new Map(questions.map((q) => [q.id, q]));
    const filteredProgress = allProgress.filter((p) => qMap.has(p.question_id));

    const total = filteredProgress.length;
    const from = (query.page - 1) * query.pageSize;
    const pagedProgress = filteredProgress.slice(from, from + query.pageSize);

    if (pagedProgress.length === 0) {
      return apiSuccess([], {
        total,
        page: query.page,
        pageSize: query.pageSize,
        hasMore: false,
      });
    }

    const pageQIds = pagedProgress.map((p) => p.question_id);
    const pageSetIds = Array.from(new Set(pagedProgress.map((p) => p.study_set_id)));

    // SH-005 & SH-024: Chunked relations (options + accepted_answers + tags),
    // PLUS wrong answers from BOTH study_session_answers AND exam_attempt_answers!
    const [
      relations,
      sets,
      sessionWrongRows,
      examWrongQuestions,
      starredRows,
    ] = await Promise.all([
      fetchQuestionRelationsChunked(supabase, pageQIds),
      fetchInChunks(
        pageSetIds,
        async (chunk) =>
          supabase
            .from("study_sets")
            .select("id, title, subject")
            .in("id", chunk),
        SAFE_IN_CHUNK_SIZE,
      ),
      fetchInChunks(
        pageQIds,
        async (chunk) =>
          supabase
            .from("study_session_answers")
            .select("question_id, selected_option_ids, typed_answer, answered_at")
            .eq("user_id", user.id)
            .eq("is_correct", false)
            .in("question_id", chunk)
            .order("answered_at", { ascending: false }),
        SAFE_IN_CHUNK_SIZE,
      ),
      fetchInChunks(
        pageQIds,
        async (chunk) =>
          supabase
            .from("exam_attempt_questions")
            .select("id, question_id")
            .in("question_id", chunk),
        SAFE_IN_CHUNK_SIZE,
      ),
      fetchInChunks(
        pageQIds,
        async (chunk) =>
          supabase
            .from("starred_questions")
            .select("question_id")
            .eq("user_id", user.id)
            .in("question_id", chunk),
        SAFE_IN_CHUNK_SIZE,
      ),
    ]);

    const attemptQToOrigQ = new Map<string, string>();
    const attemptQIds: string[] = [];
    for (const eq of examWrongQuestions) {
      if (eq.question_id) {
        attemptQToOrigQ.set(eq.id, eq.question_id);
        attemptQIds.push(eq.id);
      }
    }

    const examWrongAnswers =
      attemptQIds.length > 0
        ? await fetchInChunks(
            attemptQIds,
            async (chunk) =>
              supabase
                .from("exam_attempt_answers")
                .select(
                  "attempt_question_id, selected_option_ids, typed_answer, updated_at",
                )
                .eq("user_id", user.id)
                .eq("is_correct", false)
                .in("attempt_question_id", chunk)
                .order("updated_at", { ascending: false }),
            SAFE_IN_CHUNK_SIZE,
          )
        : [];

    const setMap = new Map(sets.map((s) => [s.id, s]));
    const starredSet = new Set(starredRows.map((s) => s.question_id));

    const lastWrongMap = new Map<
      string,
      {
        selected_option_ids: string[];
        typed_answer: string | null;
        answered_at: string;
        source: "session" | "exam";
      }
    >();

    for (const ans of sessionWrongRows) {
      const prev = lastWrongMap.get(ans.question_id);
      if (!prev || ans.answered_at > prev.answered_at) {
        lastWrongMap.set(ans.question_id, {
          selected_option_ids: ans.selected_option_ids,
          typed_answer: ans.typed_answer,
          answered_at: ans.answered_at,
          source: "session",
        });
      }
    }

    for (const ans of examWrongAnswers) {
      const origQId = attemptQToOrigQ.get(ans.attempt_question_id);
      if (!origQId) continue;
      const prev = lastWrongMap.get(origQId);
      if (!prev || ans.updated_at > prev.answered_at) {
        lastWrongMap.set(origQId, {
          selected_option_ids: ans.selected_option_ids,
          typed_answer: ans.typed_answer,
          answered_at: ans.updated_at,
          source: "exam",
        });
      }
    }

    const combined = pagedProgress
      .map((prog) => {
        const q = qMap.get(prog.question_id);
        if (!q) return null;
        return {
          progress: prog,
          resolved: prog.mastery_level === "mastered",
          is_starred: starredSet.has(q.id),
          last_wrong_answer: lastWrongMap.get(q.id) ?? null,
          study_set: setMap.get(prog.study_set_id) ?? null,
          question: {
            ...q,
            options: relations.optionsByQ.get(q.id) ?? [],
            accepted_answers: relations.answersByQ.get(q.id) ?? [],
            tags: relations.tagsByQ.get(q.id) ?? [],
          },
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    return apiSuccess(combined, {
      total,
      page: query.page,
      pageSize: query.pageSize,
      hasMore: from + combined.length < total,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
