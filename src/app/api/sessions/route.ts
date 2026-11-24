import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, requireStudySetAccess } from "@/lib/security/authz";
import {
  apiSuccess,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import { fetchInChunks, SAFE_IN_CHUNK_SIZE } from "@/lib/supabase/query-helpers";
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
    const setIds = Array.from(
      new Set(
        rows
          .map((r) => r.study_set_id)
          .filter((id): id is string => Boolean(id)),
      ),
    );
    const sets =
      setIds.length > 0
        ? await fetchInChunks(
            setIds,
            async (chunk) =>
              supabase
                .from("study_sets")
                .select("id, title, subject, set_type")
                .in("id", chunk),
            SAFE_IN_CHUNK_SIZE,
          )
        : [];

    const setMap = new Map(sets.map((s) => [s.id, s]));
    const enriched = rows.map((r) => ({
      ...r,
      study_set: r.study_set_id ? (setMap.get(r.study_set_id) ?? null) : null,
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

    const sourceIds = Array.from(
      new Set([
        ...(input.study_set_id ? [input.study_set_id] : []),
        ...(input.source_study_set_ids ?? []),
      ]),
    );

    await Promise.all(
      sourceIds.map((sid) => requireStudySetAccess(supabase, sid, user.id, "read")),
    );

    const singleSetId = sourceIds.length === 1 ? sourceIds[0] : null;

    const { data, error } = await supabase
      .from("study_sessions")
      .insert({
        user_id: user.id,
        study_set_id: singleSetId,
        source_study_set_ids: sourceIds,
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
