import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, requireStudySetAccess } from "@/lib/security/authz";
import {
  apiSuccess,
  AppError,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import { uuidSchema } from "@/lib/validation/common";
import {
  listCheckpointsQuerySchema,
  upsertCheckpointSchema,
} from "@/lib/validation/v3";
import type { Json } from "@/types/database";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const sp = request.nextUrl.searchParams;
    const query = listCheckpointsQuerySchema.parse({
      studySetId: sp.get("studySetId") ?? sp.get("study_set_id") ?? undefined,
      mode: sp.get("mode") ?? undefined,
      sessionKey: sp.get("sessionKey") ?? sp.get("session_key") ?? undefined,
      limit: sp.get("limit") ?? undefined,
    });

    let dbQuery = supabase
      .from("learning_session_checkpoints")
      .select("*")
      .eq("user_id", user.id)
      .order("updated_at", { ascending: false })
      .limit(query.limit);

    if (query.studySetId) {
      dbQuery = dbQuery.eq("study_set_id", query.studySetId);
    }
    if (query.mode) {
      dbQuery = dbQuery.eq("mode", query.mode);
    }
    if (query.sessionKey) {
      dbQuery = dbQuery.eq("session_key", query.sessionKey);
    }

    const { data, error } = await dbQuery;
    if (error) throw error;
    return apiSuccess(data ?? []);
  } catch (err) {
    return handleApiError(err);
  }
}

async function handleUpsert(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const body = upsertCheckpointSchema.parse(await parseJsonBody(request));

    if (body.study_set_id) {
      await requireStudySetAccess(supabase, body.study_set_id, user.id, "read");
    }

    const { data, error } = await supabase
      .from("learning_session_checkpoints")
      .upsert(
        {
          user_id: user.id,
          study_set_id: body.study_set_id ?? null,
          mode: body.mode,
          session_key: body.session_key,
          state_json: body.state_json as Json,
          progress_percent: body.progress_percent,
          current_index: body.current_index,
          total_items: body.total_items,
          device_id: body.device_id ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,session_key" },
      )
      .select("*")
      .single();

    if (error) throw error;
    return apiSuccess(data);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  return handleUpsert(request);
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleUpsert(request);
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const sp = request.nextUrl.searchParams;
    const rawId = sp.get("id");
    const rawKey = sp.get("sessionKey") ?? sp.get("session_key");

    if (!rawId && !rawKey) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Provide id or sessionKey query parameter to delete a checkpoint.",
        400,
      );
    }

    let dbQuery = supabase
      .from("learning_session_checkpoints")
      .delete()
      .eq("user_id", user.id);

    if (rawId) {
      dbQuery = dbQuery.eq("id", uuidSchema.parse(rawId));
    }
    if (rawKey) {
      dbQuery = dbQuery.eq("session_key", rawKey.trim().slice(0, 120));
    }

    const { error } = await dbQuery;
    if (error) throw error;
    return apiSuccess({ deleted: true });
  } catch (err) {
    return handleApiError(err);
  }
}
