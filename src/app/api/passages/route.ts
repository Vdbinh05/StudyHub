import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, requireStudySetAccess } from "@/lib/security/authz";
import {
  apiSuccess,
  AppError,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import { uuidSchema } from "@/lib/validation/common";
import { createPassageSchema } from "@/lib/validation/v3";
import type { Json } from "@/types/database";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const rawSetId =
      request.nextUrl.searchParams.get("studySetId") ??
      request.nextUrl.searchParams.get("study_set_id");
    if (!rawSetId) {
      throw new AppError("VALIDATION_ERROR", "studySetId query parameter is required.", 400);
    }
    const studySetId = uuidSchema.parse(rawSetId);
    await requireStudySetAccess(supabase, studySetId, user.id, "read");

    const { data, error } = await supabase
      .from("shared_passages")
      .select("*")
      .eq("study_set_id", studySetId)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });

    if (error) throw error;
    return apiSuccess(data ?? []);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const body = createPassageSchema.parse(await parseJsonBody(request));
    await requireStudySetAccess(supabase, body.study_set_id, user.id, "edit");

    const { data, error } = await supabase
      .from("shared_passages")
      .insert({
        study_set_id: body.study_set_id,
        owner_id: user.id,
        title: body.title,
        content_text: body.content_text,
        content_rich: (body.content_rich ?? null) as Json | null,
        audio_media_id: body.audio_media_id ?? null,
        transcript: body.transcript ?? null,
        source_reference: body.source_reference ?? null,
        sort_order: body.sort_order,
      })
      .select("*")
      .single();

    if (error) throw error;

    if (body.audio_media_id) {
      await supabase
        .from("content_media_relations")
        .upsert(
          {
            media_id: body.audio_media_id,
            entity_type: "shared_passage",
            entity_id: data.id,
            role: "audio",
            sort_order: 0,
          },
          { onConflict: "media_id,entity_type,entity_id,role" },
        )
        .select("id");
    }

    return apiSuccess(data, undefined, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
