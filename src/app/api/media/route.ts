import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, requireStudySetAccess } from "@/lib/security/authz";
import {
  apiSuccess,
  AppError,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import {
  attachMediaRelationSchema,
  listMediaQuerySchema,
} from "@/lib/validation/v3";

function withProxyUrl<T extends { storage_path: string }>(row: T): T & { proxy_url: string } {
  return {
    ...row,
    proxy_url: `/api/uploads/signed-url?path=${encodeURIComponent(row.storage_path)}&redirect=1`,
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const sp = request.nextUrl.searchParams;
    const query = listMediaQuerySchema.parse({
      studySetId: sp.get("studySetId") ?? sp.get("study_set_id") ?? undefined,
      kind: sp.get("kind") ?? undefined,
      page: sp.get("page") ?? undefined,
      pageSize: sp.get("pageSize") ?? undefined,
    });

    if (query.studySetId) {
      await requireStudySetAccess(supabase, query.studySetId, user.id, "read");
    }

    const from = (query.page - 1) * query.pageSize;
    const to = from + query.pageSize - 1;

    let dbQuery = supabase
      .from("media_assets")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, to);

    if (query.studySetId) {
      dbQuery = dbQuery.eq("study_set_id", query.studySetId);
    } else {
      dbQuery = dbQuery.eq("owner_id", user.id);
    }

    if (query.kind) {
      dbQuery = dbQuery.eq("kind", query.kind);
    }

    const { data, count, error } = await dbQuery;
    if (error) throw error;

    const total = count ?? 0;
    const items = (data ?? []).map(withProxyUrl);

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
    const body = attachMediaRelationSchema.parse(await parseJsonBody(request));

    if (body.entity_type === "exam_attempt_question") {
      throw new AppError(
        "FORBIDDEN",
        "Exam snapshot media relations are managed automatically by the server.",
        403,
      );
    }

    const { data: mediaRow, error: mediaErr } = await supabase
      .from("media_assets")
      .select("id, owner_id, study_set_id")
      .eq("id", body.media_id)
      .maybeSingle();

    if (mediaErr) throw mediaErr;
    if (!mediaRow) {
      throw new AppError("NOT_FOUND", "Media asset not found.", 404);
    }
    if (mediaRow.study_set_id) {
      await requireStudySetAccess(supabase, mediaRow.study_set_id, user.id, "edit");
    } else if (mediaRow.owner_id !== user.id) {
      throw new AppError("FORBIDDEN", "You do not have permission to attach this media asset.", 403);
    }

    // V3-SEC-03: Strictly verify caller has edit access on target (entity_type, entity_id)
    // to prevent cross-tenant attachment to another user's private entity UUID.
    if (body.entity_type === "profile") {
      if (body.entity_id !== user.id) {
        throw new AppError("FORBIDDEN", "You can only attach avatar media to your own profile.", 403);
      }
    } else {
      let targetStudySetId: string | null = null;
      if (body.entity_type === "question") {
        const { data: q, error: qErr } = await supabase
          .from("questions")
          .select("study_set_id")
          .eq("id", body.entity_id)
          .maybeSingle();
        if (qErr) throw qErr;
        targetStudySetId = q?.study_set_id ?? null;
      } else if (body.entity_type === "question_option") {
        const { data: opt, error: optErr } = await supabase
          .from("question_options")
          .select("study_set_id")
          .eq("id", body.entity_id)
          .maybeSingle();
        if (optErr) throw optErr;
        targetStudySetId = opt?.study_set_id ?? null;
      } else if (body.entity_type === "diagram_set") {
        const { data: diag, error: diagErr } = await supabase
          .from("diagram_sets")
          .select("study_set_id")
          .eq("id", body.entity_id)
          .maybeSingle();
        if (diagErr) throw diagErr;
        targetStudySetId = diag?.study_set_id ?? null;
      } else if (body.entity_type === "shared_passage") {
        const { data: pass, error: passErr } = await supabase
          .from("shared_passages")
          .select("study_set_id")
          .eq("id", body.entity_id)
          .maybeSingle();
        if (passErr) throw passErr;
        targetStudySetId = pass?.study_set_id ?? null;
      }

      if (!targetStudySetId) {
        throw new AppError("NOT_FOUND", "Target resource not found.", 404);
      }
      await requireStudySetAccess(supabase, targetStudySetId, user.id, "edit");
    }

    const { data, error } = await supabase
      .from("content_media_relations")
      .insert({
        media_id: body.media_id,
        entity_type: body.entity_type,
        entity_id: body.entity_id,
        role: body.role,
        sort_order: body.sort_order,
        alt_text: body.alt_text ?? null,
        caption: body.caption ?? null,
      })
      .select("*")
      .single();

    if (error) throw error;

    return apiSuccess(data, undefined, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
