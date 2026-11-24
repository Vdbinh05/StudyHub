import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, requireStudySetAccess } from "@/lib/security/authz";
import {
  apiSuccess,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import { paginationQuerySchema, uuidSchema } from "@/lib/validation/common";
import { createSessionSchema } from "@/lib/validation/learning";
import type { Json } from "@/types/database";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const sp = request.nextUrl.searchParams;
    const { page, pageSize } = paginationQuerySchema.parse({
      page: sp.get("page") ?? 1,
      pageSize: sp.get("pageSize") ?? 25,
    });
    const studySetIdParam = sp.get("studySetId");
    const modeParam = sp.get("mode");

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    let query = supabase
      .from("study_sessions")
      .select("*", { count: "exact" })
      .eq("user_id", user.id);

    if (studySetIdParam) {
      query = query.eq("study_set_id", uuidSchema.parse(studySetIdParam));
    }
    if (
      modeParam &&
      ["flashcards", "learn", "practice", "write", "match", "review"].includes(
        modeParam,
      )
    ) {
      query = query.eq(
        "mode",
        modeParam as
          | "flashcards"
          | "learn"
          | "practice"
          | "write"
          | "match"
          | "review",
      );
    }

    const { data, count, error } = await query
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) throw error;

    const rows = data ?? [];
    const setIds = Array.from(new Set(rows.map((r) => r.study_set_id)));
    const { data: sets } =
      setIds.length > 0
        ? await supabase
            .from("study_sets")
            .select("id, title, subject, set_type")
            .in("id", setIds)
        : { data: [] };

    const setMap = new Map((sets ?? []).map((s) => [s.id, s]));
    const enriched = rows.map((r) => ({
      ...r,
      study_set: setMap.get(r.study_set_id) ?? null,
    }));

    const total = count ?? enriched.length;
    return apiSuccess(enriched, {
      total,
      page,
      pageSize,
      hasMore: from + enriched.length < total,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const body = await parseJsonBody(request);
    const input = createSessionSchema.parse(body);

    await requireStudySetAccess(supabase, input.study_set_id, user.id, "read");

    const { data, error } = await supabase
      .from("study_sessions")
      .insert({
        user_id: user.id,
        study_set_id: input.study_set_id,
        mode: input.mode,
        status: "in_progress",
        config: input.config as Json,
        total_items: input.total_items,
      })
      .select("*")
      .single();

    if (error) throw error;

    return apiSuccess(data, undefined, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
