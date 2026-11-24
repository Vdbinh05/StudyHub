import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/security/authz";
import { apiSuccess, handleApiError } from "@/lib/security/errors";
import { listDueQuerySchema } from "@/lib/validation/learning";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const rawParams = Object.fromEntries(request.nextUrl.searchParams.entries());
    const query = listDueQuerySchema.parse(rawParams);

    const nowIso = new Date().toISOString();

    let dbQuery = supabase
      .from("user_question_progress")
      .select("*")
      .eq("user_id", user.id)
      .lte("next_review_at", nowIso);

    if (query.studySetId) {
      dbQuery = dbQuery.eq("study_set_id", query.studySetId);
    }

    const { data: dueProgress, error } = await dbQuery
      .order("next_review_at", { ascending: true })
      .limit(query.limit);

    if (error) throw error;

    const rows = dueProgress ?? [];
    const questionIds = rows.map((r) => r.question_id);

    if (questionIds.length === 0) {
      return apiSuccess([], { total: 0 });
    }

    const [
      { data: questions, error: qErr },
      { data: options, error: optErr },
      { data: accepted, error: accErr },
    ] = await Promise.all([
      supabase.from("questions").select("*").in("id", questionIds),
      supabase
        .from("question_options")
        .select("*")
        .in("question_id", questionIds)
        .order("position", { ascending: true }),
      supabase
        .from("question_accepted_answers")
        .select("*")
        .in("question_id", questionIds),
    ]);

    if (qErr) throw qErr;
    if (optErr) throw optErr;
    if (accErr) throw accErr;

    const qMap = new Map((questions ?? []).map((q) => [q.id, q]));
    const optMap = new Map<string, typeof options>();
    for (const o of options ?? []) {
      const list = optMap.get(o.question_id) ?? [];
      list.push(o);
      optMap.set(o.question_id, list);
    }
    const accMap = new Map<string, typeof accepted>();
    for (const a of accepted ?? []) {
      const list = accMap.get(a.question_id) ?? [];
      list.push(a);
      accMap.set(a.question_id, list);
    }

    const items = rows
      .map((prog) => {
        const q = qMap.get(prog.question_id);
        if (!q) return null;
        return {
          progress: prog,
          question: {
            ...q,
            options: optMap.get(q.id) ?? [],
            accepted_answers: accMap.get(q.id) ?? [],
          },
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    return apiSuccess(items, { total: items.length });
  } catch (err) {
    return handleApiError(err);
  }
}
