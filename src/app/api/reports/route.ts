import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, requireStudySetAccess } from "@/lib/security/authz";
import {
  apiSuccess,
  AppError,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import {
  enforceDistributedRateLimit,
  RATE_LIMITS,
} from "@/lib/security/rate-limit";
import {
  createReportSchema,
  listReportsQuerySchema,
} from "@/lib/validation/v3";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const sp = request.nextUrl.searchParams;
    const query = listReportsQuerySchema.parse({
      studySetId: sp.get("studySetId") ?? sp.get("study_set_id") ?? undefined,
      questionId: sp.get("questionId") ?? sp.get("question_id") ?? undefined,
      status: sp.get("status") ?? undefined,
      mineOnly: sp.get("mineOnly") ?? undefined,
      page: sp.get("page") ?? undefined,
      pageSize: sp.get("pageSize") ?? undefined,
    });

    if (query.studySetId) {
      await requireStudySetAccess(supabase, query.studySetId, user.id, "read");
    }

    const from = (query.page - 1) * query.pageSize;
    const to = from + query.pageSize - 1;

    let dbQuery = supabase
      .from("question_reports")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);

    if (query.studySetId) {
      dbQuery = dbQuery.eq("study_set_id", query.studySetId);
    }
    if (query.questionId) {
      dbQuery = dbQuery.eq("question_id", query.questionId);
    }
    if (query.status) {
      dbQuery = dbQuery.eq("status", query.status);
    }
    if (query.mineOnly) {
      dbQuery = dbQuery.eq("reporter_id", user.id);
    }

    const { data, count, error } = await dbQuery;
    if (error) throw error;

    const total = count ?? 0;
    const items = data ?? [];
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
    const limited = await enforceDistributedRateLimit(
      request,
      RATE_LIMITS.REPORT_CREATE,
      user.id,
    );
    if (limited) return limited;

    const body = createReportSchema.parse(await parseJsonBody(request));

    const { data: qRow, error: qErr } = await supabase
      .from("questions")
      .select("id, study_set_id")
      .eq("id", body.question_id)
      .maybeSingle();

    if (qErr) throw qErr;
    if (!qRow) {
      throw new AppError("NOT_FOUND", "Question not found.", 404);
    }
    if (body.study_set_id && body.study_set_id !== qRow.study_set_id) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Question does not belong to the specified study set.",
        400,
      );
    }

    await requireStudySetAccess(supabase, qRow.study_set_id, user.id, "read");

    const { data, error } = await supabase
      .from("question_reports")
      .insert({
        study_set_id: qRow.study_set_id,
        question_id: body.question_id,
        reporter_id: user.id,
        category: body.category,
        description: body.description,
        status: "open",
      })
      .select("*")
      .single();

    if (error) throw error;
    return apiSuccess(data, undefined, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
