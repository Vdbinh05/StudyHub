import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, requireStudySetAccess } from "@/lib/security/authz";
import {
  apiSuccess,
  AppError,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import { uuidSchema } from "@/lib/validation/common";
import { updateStudySetMemberSchema } from "@/lib/validation/sets";

interface RouteContext {
  params: Promise<{ id: string; userId: string }>;
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const { id, userId } = await context.params;
    const setId = uuidSchema.parse(id);
    const targetUserId = uuidSchema.parse(userId);

    await requireStudySetAccess(supabase, setId, user.id, "owner");

    const body = await parseJsonBody(request);
    const { role } = updateStudySetMemberSchema.parse(body);

    const { data, error } = await supabase
      .from("study_set_members")
      .update({ role })
      .eq("study_set_id", setId)
      .eq("user_id", targetUserId)
      .select("*")
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      throw new AppError("NOT_FOUND", "Member not found on this study set.", 404);
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
    const { id, userId } = await context.params;
    const setId = uuidSchema.parse(id);
    const targetUserId = uuidSchema.parse(userId);

    // Owner can remove anyone; a member can leave (remove themselves)
    const access = await requireStudySetAccess(supabase, setId, user.id, "read");
    if (!access.isOwner && targetUserId !== user.id) {
      throw new AppError(
        "FORBIDDEN",
        "Only the study set owner can remove other members.",
        403,
      );
    }

    const { data, error } = await supabase
      .from("study_set_members")
      .delete()
      .eq("study_set_id", setId)
      .eq("user_id", targetUserId)
      .select("id")
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      throw new AppError("NOT_FOUND", "Member not found on this study set.", 404);
    }

    return apiSuccess({ removed: true, user_id: targetUserId });
  } catch (err) {
    return handleApiError(err);
  }
}
