import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/security/authz";
import {
  apiSuccess,
  AppError,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import { createFolderSchema } from "@/lib/validation/folders";

export async function GET(): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();

    const [{ data: folders, error: foldersError }, { data: sets, error: setsError }] =
      await Promise.all([
        supabase
          .from("folders")
          .select("*")
          .eq("owner_id", user.id)
          .order("sort_order", { ascending: true })
          .order("created_at", { ascending: true }),
        supabase
          .from("study_sets")
          .select("id, folder_id")
          .eq("owner_id", user.id)
          .eq("is_archived", false),
      ]);

    if (foldersError) throw foldersError;
    if (setsError) throw setsError;

    const countsByFolder = new Map<string, number>();
    for (const s of sets ?? []) {
      if (s.folder_id) {
        countsByFolder.set(s.folder_id, (countsByFolder.get(s.folder_id) ?? 0) + 1);
      }
    }

    const enriched = (folders ?? []).map((folder) => ({
      ...folder,
      study_set_count: countsByFolder.get(folder.id) ?? 0,
    }));

    return apiSuccess(enriched, { total: enriched.length });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const body = await parseJsonBody(request);
    const input = createFolderSchema.parse(body);

    if (input.parent_id) {
      const { data: parent, error: parentError } = await supabase
        .from("folders")
        .select("id")
        .eq("id", input.parent_id)
        .eq("owner_id", user.id)
        .maybeSingle();

      if (parentError) throw parentError;
      if (!parent) {
        throw new AppError("NOT_FOUND", "Parent folder not found.", 404);
      }
    }

    const { data, error } = await supabase
      .from("folders")
      .insert({
        owner_id: user.id,
        name: input.name,
        description: input.description ?? null,
        parent_id: input.parent_id ?? null,
        color: input.color,
        icon: input.icon,
        sort_order: input.sort_order,
      })
      .select("*")
      .single();

    if (error) throw error;

    return apiSuccess(data, undefined, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
