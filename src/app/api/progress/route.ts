import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, requireStudySetAccess } from "@/lib/security/authz";
import {
  apiSuccess,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import { upsertQuestionProgress } from "@/lib/supabase/progress-helper";
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

    await requireStudySetAccess(supabase, input.study_set_id, user.id, "read");

    const progress = await upsertQuestionProgress({
      supabase,
      userId: user.id,
      studySetId: input.study_set_id,
      questionId: input.question_id,
      isCorrect: input.is_correct,
      selfRating: input.self_rating ?? null,
      overrides: {
        mastery_level: input.mastery_level,
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
