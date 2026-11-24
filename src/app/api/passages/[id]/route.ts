import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, requireStudySetAccess } from "@/lib/security/authz";
import {
  apiSuccess,
  AppError,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import { uuidSchema } from "@/lib/validation/common";
import { updatePassageSchema } from "@/lib/validation/v3";
import type { Json, TablesUpdate } from "@/types/database";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const { id } = await context.params;
    const passageId = uuidSchema.parse(id);

    const { data, error } = await supabase
      .from("shared_passages")
      .select("*")
      .eq("id", passageId)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      throw new AppError("NOT_FOUND", "Passage not found.", 404);
    }

    await requireStudySetAccess(supabase, data.study_set_id, user.id, "read");
    return apiSuccess(data);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const { id } = await context.params;
    const passageId = uuidSchema.parse(id);
    const body = updatePassageSchema.parse(await parseJsonBody(request));

    const { data: existing, error: fetchErr } = await supabase
      .from("shared_passages")
      .select("id, study_set_id")
      .eq("id", passageId)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!existing) {
      throw new AppError("NOT_FOUND", "Passage not found.", 404);
    }

    await requireStudySetAccess(supabase, existing.study_set_id, user.id, "edit");

    const patch: TablesUpdate<"shared_passages"> = {};
    if (body.title !== undefined) patch.title = body.title;
    if (body.content_text !== undefined) patch.content_text = body.content_text;
    if (body.content_rich !== undefined) {
      patch.content_rich = (body.content_rich ?? null) as Json | null;
    }
    if (body.audio_media_id !== undefined) patch.audio_media_id = body.audio_media_id;
    if (body.transcript !== undefined) patch.transcript = body.transcript;
    if (body.source_reference !== undefined) patch.source_reference = body.source_reference;
    if (body.sort_order !== undefined) patch.sort_order = body.sort_order;

    if (Object.keys(patch).length === 0) {
      throw new AppError("BAD_REQUEST", "No fields provided to update.", 400);
    }

    const { data, error } = await supabase
      .from("shared_passages")
      .update(patch)
      .eq("id", passageId)
      .select("*")
      .single();

    if (error) throw error;

    if (body.audio_media_id !== undefined) {
      await supabase
        .from("content_media_relations")
        .delete()
        .eq("entity_type", "shared_passage")
        .eq("entity_id", passageId)
        .eq("role", "audio");

      if (body.audio_media_id) {
        await supabase.from("content_media_relations").insert({
          media_id: body.audio_media_id,
          entity_type: "shared_passage",
          entity_id: passageId,
          role: "audio",
          sort_order: 0,
        });
      }
    }

    return apiSuccess(data);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function DELETE(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const { id } = await context.params;
    const passageId = uuidSchema.parse(id);

    const { data: existing, error: fetchErr } = await supabase
      .from("shared_passages")
      .select("id, study_set_id")
      .eq("id", passageId)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!existing) {
      throw new AppError("NOT_FOUND", "Passage not found.", 404);
    }

    await requireStudySetAccess(supabase, existing.study_set_id, user.id, "edit");

    const { error } = await supabase
      .from("shared_passages")
      .delete()
      .eq("id", passageId);

    if (error) throw error;
    return apiSuccess({ deleted: true, id: passageId });
  } catch (err) {
    return handleApiError(err);
  }
}
