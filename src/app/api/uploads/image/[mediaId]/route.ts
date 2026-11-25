import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/security/authz";
import { apiSuccess, AppError, handleApiError } from "@/lib/security/errors";
import {
  enforceDistributedRateLimit,
  RATE_LIMITS,
} from "@/lib/security/rate-limit";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { uuidSchema } from "@/lib/validation/common";

export const runtime = "nodejs";
export const maxDuration = 30;

interface RouteContext {
  params: Promise<{ mediaId: string }>;
}

/**
 * Safe cancel-cleanup endpoint for unreferenced temporary image uploads (V32-053).
 * Deletes the `media_assets` row and its private Storage object ONLY when:
 *   1. Caller is the exact `owner_id` of the asset, AND
 *   2. ZERO rows in `content_media_relations`, `questions`, `question_options`,
 *      `diagram_sets`, `shared_passages`, or `exam_attempt_questions` reference it.
 * Returns HTTP 409 CONFLICT if still referenced (never deletes shared/historical media!).
 */
export async function DELETE(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const limited = await enforceDistributedRateLimit(
      request,
      RATE_LIMITS.UPLOAD,
      user.id,
    );
    if (limited) return limited;

    const { mediaId: rawMediaId } = await context.params;
    const mediaId = uuidSchema.parse(rawMediaId);

    const { data: asset, error: assetErr } = await supabase
      .from("media_assets")
      .select("id, owner_id, study_set_id, storage_bucket, storage_path")
      .eq("id", mediaId)
      .maybeSingle();

    if (assetErr) throw assetErr;
    if (!asset) {
      throw new AppError("NOT_FOUND", "Media asset not found.", 404);
    }

    if (asset.owner_id !== user.id) {
      throw new AppError(
        "FORBIDDEN",
        "You can only delete your own unreferenced media uploads.",
        403,
      );
    }

    // Use admin client when configured so cross-tenant exam snapshots or shared set references are never missed
    const checkClient = tryCreateAdminClient() ?? supabase;
    const encodedPath = encodeURIComponent(asset.storage_path);
    const slashEncodedPath = asset.storage_path.replace(/\//g, "%2F");
    const pathPattern = `%${asset.storage_path}%`;
    const encodedPattern = `%${encodedPath}%`;
    const slashEncodedPattern = `%${slashEncodedPath}%`;

    const [cmrRes, qRes, optRes, diagRes, passRes, examQRes] = await Promise.all([
      checkClient
        .from("content_media_relations")
        .select("id", { count: "exact", head: true })
        .eq("media_id", mediaId),
      checkClient
        .from("questions")
        .select("id", { count: "exact", head: true })
        .or(
          `audio_media_id.eq.${mediaId},prompt_image_url.ilike.${pathPattern},prompt_image_url.ilike.${encodedPattern},prompt_image_url.ilike.${slashEncodedPattern},back_image_url.ilike.${pathPattern},back_image_url.ilike.${encodedPattern},back_image_url.ilike.${slashEncodedPattern}`,
        ),
      checkClient
        .from("question_options")
        .select("id", { count: "exact", head: true })
        .or(
          `media_id.eq.${mediaId},image_url.ilike.${pathPattern},image_url.ilike.${encodedPattern},image_url.ilike.${slashEncodedPattern}`,
        ),
      checkClient
        .from("diagram_sets")
        .select("id", { count: "exact", head: true })
        .or(
          `base_media_id.eq.${mediaId},base_image_url.ilike.${pathPattern},base_image_url.ilike.${encodedPattern},base_image_url.ilike.${slashEncodedPattern}`,
        ),
      checkClient
        .from("shared_passages")
        .select("id", { count: "exact", head: true })
        .eq("audio_media_id", mediaId),
      checkClient
        .from("exam_attempt_questions")
        .select("id", { count: "exact", head: true })
        .eq("audio_media_id_snapshot", mediaId),
    ]);

    const refCount =
      (cmrRes.count ?? 0) +
      (qRes.count ?? 0) +
      (optRes.count ?? 0) +
      (diagRes.count ?? 0) +
      (passRes.count ?? 0) +
      (examQRes.count ?? 0);

    if (refCount > 0) {
      throw new AppError(
        "CONFLICT",
        "Media asset is still referenced by questions, options, diagrams, or exam snapshots and cannot be deleted.",
        409,
      );
    }

    // Delete DB row FIRST with `.select("id").maybeSingle()` (DB ON DELETE RESTRICT is final defense)
    const { data: deleted, error: delErr } = await supabase
      .from("media_assets")
      .delete()
      .eq("id", mediaId)
      .eq("owner_id", user.id)
      .select("id")
      .maybeSingle();

    if (delErr) {
      if (delErr.code === "23503") {
        throw new AppError(
          "CONFLICT",
          "Media asset is still referenced and cannot be deleted.",
          409,
        );
      }
      throw delErr;
    }

    if (!deleted) {
      throw new AppError("NOT_FOUND", "Media asset not found.", 404);
    }

    // Remove Storage blob strictly after DB row delete succeeded
    if (asset.storage_bucket === "study-media" && asset.storage_path) {
      const storageClient = tryCreateAdminClient() ?? supabase;
      await storageClient.storage
        .from("study-media")
        .remove([asset.storage_path])
        .catch(() => {
          // Non-fatal if Storage object was already absent
        });
    }

    return apiSuccess({ deleted: true, id: mediaId });
  } catch (err) {
    return handleApiError(err);
  }
}
