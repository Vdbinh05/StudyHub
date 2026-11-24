import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, requireStudySetAccess } from "@/lib/security/authz";
import {
  apiSuccess,
  AppError,
  handleApiError,
  parseOptionalJsonBody,
} from "@/lib/security/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rate-limit";
import { rpcCloneStudySet } from "@/lib/supabase/rpc";
import { uuidSchema } from "@/lib/validation/common";
import { duplicateStudySetSchema } from "@/lib/validation/sets";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * Duplicates a study set atomically inside PostgreSQL via `clone_study_set()` RPC
 * (fixes SH-005 >250Q option truncation, SH-020 duplicate-position option corruption,
 * missing tag copy, and unenforced `allow_clone = false`!).
 */
export async function POST(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const limited = enforceRateLimit(request, RATE_LIMITS.SET_CLONE, user.id);
    if (limited) return limited;

    const { id } = await context.params;
    const sourceSetId = uuidSchema.parse(id);

    let parsedBody: { title?: string; folder_id?: string | null } | undefined;
    const body = await parseOptionalJsonBody(request);
    if (body !== undefined) {
      parsedBody = duplicateStudySetSchema.parse(body);
    }

    const access = await requireStudySetAccess(
      supabase,
      sourceSetId,
      user.id,
      "read",
    );

    if (!access.canClone) {
      throw new AppError(
        "FORBIDDEN",
        "Cloning is disabled for this shared study set.",
        403,
      );
    }

    if (parsedBody?.folder_id) {
      const { data: folder, error: folderError } = await supabase
        .from("folders")
        .select("id")
        .eq("id", parsedBody.folder_id)
        .eq("owner_id", user.id)
        .maybeSingle();

      if (folderError) throw folderError;
      if (!folder) {
        throw new AppError("NOT_FOUND", "Target folder not found.", 404);
      }
    }

    const { data, error } = await rpcCloneStudySet(supabase, {
      p_source_set_id: sourceSetId,
      p_title: parsedBody?.title ?? null,
      p_folder_id: parsedBody?.folder_id ?? null,
    });

    if (error) throw error;
    if (!data?.study_set) {
      throw new AppError("INTERNAL_ERROR", "Failed to duplicate study set.", 500);
    }

    return apiSuccess(data.study_set, { copied_questions: data.copied_questions }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
