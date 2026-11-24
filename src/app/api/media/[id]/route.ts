import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, requireStudySetAccess } from "@/lib/security/authz";
import {
  apiSuccess,
  AppError,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import { uuidSchema } from "@/lib/validation/common";
import { updateMediaAssetSchema } from "@/lib/validation/v3";
import type { TablesUpdate } from "@/types/database";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { supabase } = await requireAuth();
    const { id } = await context.params;
    const mediaId = uuidSchema.parse(id);

    const { data, error } = await supabase
      .from("media_assets")
      .select("*")
      .eq("id", mediaId)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      throw new AppError("NOT_FOUND", "Media asset not found.", 404);
    }

    return apiSuccess({
      ...data,
      proxy_url: `/api/uploads/signed-url?path=${encodeURIComponent(data.storage_path)}&redirect=1`,
    });
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
    const mediaId = uuidSchema.parse(id);
    const body = updateMediaAssetSchema.parse(await parseJsonBody(request));

    const { data: existing, error: fetchErr } = await supabase
      .from("media_assets")
      .select("id, owner_id, study_set_id")
      .eq("id", mediaId)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!existing) {
      throw new AppError("NOT_FOUND", "Media asset not found.", 404);
    }

    if (existing.study_set_id) {
      await requireStudySetAccess(supabase, existing.study_set_id, user.id, "edit");
    } else if (existing.owner_id !== user.id) {
      throw new AppError("FORBIDDEN", "You cannot modify this media asset.", 403);
    }

    const patch: TablesUpdate<"media_assets"> = {};
    if (body.alt_text !== undefined) patch.alt_text = body.alt_text;
    if (body.caption !== undefined) patch.caption = body.caption;
    if (body.width !== undefined) patch.width = body.width;
    if (body.height !== undefined) patch.height = body.height;
    if (body.duration_ms !== undefined) patch.duration_ms = body.duration_ms;

    if (Object.keys(patch).length === 0) {
      throw new AppError("BAD_REQUEST", "No fields provided to update.", 400);
    }

    const { data, error } = await supabase
      .from("media_assets")
      .update(patch)
      .eq("id", mediaId)
      .select("*")
      .single();

    if (error) throw error;
    return apiSuccess({
      ...data,
      proxy_url: `/api/uploads/signed-url?path=${encodeURIComponent(data.storage_path)}&redirect=1`,
    });
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
    const mediaId = uuidSchema.parse(id);

    const { data: existing, error: fetchErr } = await supabase
      .from("media_assets")
      .select("id, owner_id, study_set_id, storage_bucket, storage_path")
      .eq("id", mediaId)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!existing) {
      throw new AppError("NOT_FOUND", "Media asset not found.", 404);
    }

    // V3-SEC-02: Match RLS `media_assets_delete_owner` strictly (uploader or study-set owner ONLY)
    if (existing.owner_id !== user.id) {
      if (existing.study_set_id) {
        await requireStudySetAccess(supabase, existing.study_set_id, user.id, "owner");
      } else {
        throw new AppError("FORBIDDEN", "Only the owner can delete this media asset.", 403);
      }
    }

    // Attempt DB row delete FIRST with RETURNING verification so ON DELETE RESTRICT protects
    // referenced exam snapshots & questions and zero-row silent RLS denials NEVER touch Storage!
    const { data: deletedRow, error: delErr } = await supabase
      .from("media_assets")
      .delete()
      .eq("id", mediaId)
      .select("id")
      .maybeSingle();

    if (delErr) {
      if (delErr.code === "23503") {
        throw new AppError(
          "CONFLICT",
          "Media asset is currently referenced by questions, diagrams, or exam history and cannot be deleted.",
          409,
        );
      }
      throw delErr;
    }

    if (!deletedRow) {
      throw new AppError(
        "FORBIDDEN",
        "You do not have permission to delete this media asset.",
        403,
      );
    }

    // Only remove storage object AFTER DB deletion is confirmed via RETURNING
    await supabase.storage
      .from(existing.storage_bucket || "study-media")
      .remove([existing.storage_path])
      .catch(() => {});

    return apiSuccess({ deleted: true, id: mediaId });
  } catch (err) {
    return handleApiError(err);
  }
}
