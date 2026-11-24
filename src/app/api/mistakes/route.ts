import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/security/authz";
import { apiSuccess, handleApiError } from "@/lib/security/errors";
import { listMistakesQuerySchema } from "@/lib/validation/learning";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const rawParams = Object.fromEntries(request.nextUrl.searchParams.entries());
    const query = listMistakesQuerySchema.parse(rawParams);

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

    if (query.days) {
      const cutoff = new Date(
        Date.now() - query.days * 24 * 60 * 60 * 1000,
      ).toISOString();
      dbQuery = dbQuery.gte("last_reviewed_at", cutoff);
    }

    const { data: progressRows, error } = await dbQuery
      .order("wrong_count", { ascending: false })
      .order("last_reviewed_at", { ascending: false });

    if (error) throw error;

    const allProgress = progressRows ?? [];
    if (allProgress.length === 0) {
      return apiSuccess([], {
        total: 0,
        page: query.page,
        pageSize: query.pageSize,
        hasMore: false,
      });
    }

    const allQuestionIds = allProgress.map((p) => p.question_id);
    const allSetIds = Array.from(new Set(allProgress.map((p) => p.study_set_id)));

    let qQuery = supabase.from("questions").select("*").in("id", allQuestionIds);
    if (query.chapter) {
      qQuery = qQuery.eq("chapter", query.chapter);
    }

    const [
      { data: questions, error: qErr },
      { data: options, error: optErr },
      { data: sets, error: setErr },
      { data: lastWrongAnswers },
      { data: starred },
    ] = await Promise.all([
      qQuery,
      supabase
        .from("question_options")
        .select("*")
        .in("question_id", allQuestionIds)
        .order("position", { ascending: true }),
      supabase
        .from("study_sets")
        .select("id, title, subject")
        .in("id", allSetIds),
      supabase
        .from("study_session_answers")
        .select("question_id, selected_option_ids, typed_answer, answered_at")
        .eq("user_id", user.id)
        .eq("is_correct", false)
        .in("question_id", allQuestionIds)
        .order("answered_at", { ascending: false })
        .limit(500),
      supabase
        .from("starred_questions")
        .select("question_id")
        .eq("user_id", user.id)
        .in("question_id", allQuestionIds),
    ]);

    if (qErr) throw qErr;
    if (optErr) throw optErr;
    if (setErr) throw setErr;

    const qMap = new Map((questions ?? []).map((q) => [q.id, q]));
    const setMap = new Map((sets ?? []).map((s) => [s.id, s]));
    const optMap = new Map<string, typeof options>();
    for (const o of options ?? []) {
      const list = optMap.get(o.question_id) ?? [];
      list.push(o);
      optMap.set(o.question_id, list);
    }
    const lastWrongMap = new Map<
      string,
      { selected_option_ids: string[]; typed_answer: string | null; answered_at: string }
    >();
    for (const ans of lastWrongAnswers ?? []) {
      if (!lastWrongMap.has(ans.question_id)) {
        lastWrongMap.set(ans.question_id, {
          selected_option_ids: ans.selected_option_ids,
          typed_answer: ans.typed_answer,
          answered_at: ans.answered_at,
        });
      }
    }
    const starredSet = new Set((starred ?? []).map((s) => s.question_id));

    const combined = allProgress
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
            options: optMap.get(q.id) ?? [],
          },
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    const total = combined.length;
    const from = (query.page - 1) * query.pageSize;
    const paged = combined.slice(from, from + query.pageSize);

    return apiSuccess(paged, {
      total,
      page: query.page,
      pageSize: query.pageSize,
      hasMore: from + paged.length < total,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
