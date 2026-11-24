import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/security/authz";
import {
  apiSuccess,
  AppError,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import { uuidSchema } from "@/lib/validation/common";
import { updateFolderSchema } from "@/lib/validation/folders";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const { id } = await context.params;
    const folderId = uuidSchema.parse(id);

    const [{ data: folder, error: folderError }, { data: sets, error: setsError }] =
      await Promise.all([
        supabase
          .from("folders")
          .select("*")
          .eq("id", folderId)
          .eq("owner_id", user.id)
          .maybeSingle(),
        supabase
          .from("study_sets")
          .select("*")
          .eq("folder_id", folderId)
          .eq("owner_id", user.id)
          .eq("is_archived", false)
          .order("updated_at", { ascending: false }),
      ]);

    if (folderError) throw folderError;
    if (setsError) throw setsError;
    if (!folder) {
      throw new AppError("NOT_FOUND", "Folder not found.", 404);
    }

    return apiSuccess({
      ...folder,
      study_sets: sets ?? [],
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
    const folderId = uuidSchema.parse(id);
    const body = await parseJsonBody(request);
    const input = updateFolderSchema.parse(body);

    if (input.parent_id === folderId) {
      throw new AppError(
        "VALIDATION_ERROR",
        "A folder cannot be its own parent.",
        400,
      );
    }

    if (input.parent_id) {
      const { data: allOwnedFolders, error: foldersErr } = await supabase
        .from("folders")
        .select("id, parent_id")
        .eq("owner_id", user.id);

      if (foldersErr) throw foldersErr;

      const parentById = new Map(
        (allOwnedFolders ?? []).map((f) => [f.id, f.parent_id]),
      );

      if (!parentById.has(input.parent_id)) {
        throw new AppError("NOT_FOUND", "Parent folder not found.", 404);
      }

      // Guard against multi-hop circular hierarchies (A -> B -> A) (DB-P2-2)
      let cursor: string | null | undefined = input.parent_id;
      let depth = 0;
      while (cursor && depth < 32) {
        if (cursor === folderId) {
          throw new AppError(
            "VALIDATION_ERROR",
            "Circular folder hierarchy is not allowed.",
            400,
          );
        }
        cursor = parentById.get(cursor);
        depth += 1;
      }
    }

    const { data, error } = await supabase
      .from("folders")
      .update(input)
      .eq("id", folderId)
      .eq("owner_id", user.id)
      .select("*")
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      throw new AppError("NOT_FOUND", "Folder not found.", 404);
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
    const folderId = uuidSchema.parse(id);

    const { data, error } = await supabase
      .from("folders")
      .delete()
      .eq("id", folderId)
      .eq("owner_id", user.id)
      .select("id")
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      throw new AppError("NOT_FOUND", "Folder not found.", 404);
    }

    return apiSuccess({ deleted: true, id: folderId });
  } catch (err) {
    return handleApiError(err);
  }
}
