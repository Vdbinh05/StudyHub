import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, requireStudySetAccess } from "@/lib/security/authz";
import {
  apiSuccess,
  AppError,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
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

    const [
      { data: questions, error: qErr },
      { data: options, error: optErr },
      { data: sets, error: setErr },
    ] = await Promise.all([
      supabase.from("questions").select("*").in("id", qIds),
      supabase
        .from("question_options")
        .select("*")
        .in("question_id", qIds)
        .order("position", { ascending: true }),
      supabase.from("study_sets").select("id, title, subject").in("id", setIds),
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

    const items = starRows
      .map((star) => {
        const q = qMap.get(star.question_id);
        if (!q) return null;
        return {
          starred_at: star.created_at,
          study_set: setMap.get(star.study_set_id) ?? null,
          question: {
            ...q,
            options: optMap.get(q.id) ?? [],
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

    let studySetId = input.study_set_id;
    if (!studySetId) {
      const { data: q, error: qErr } = await supabase
        .from("questions")
        .select("study_set_id")
        .eq("id", input.question_id)
        .maybeSingle();
      if (qErr) throw qErr;
      if (!q) {
        throw new AppError("NOT_FOUND", "Question not found.", 404);
      }
      studySetId = q.study_set_id;
    }

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
    if (insErr) throw insErr;

    return apiSuccess(
      { starred: true, question_id: input.question_id },
      undefined,
      { status: 201 },
    );
  } catch (err) {
    return handleApiError(err);
  }
}
