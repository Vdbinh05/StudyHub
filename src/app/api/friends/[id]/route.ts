import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/security/authz";
import {
  apiSuccess,
  AppError,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import { uuidSchema } from "@/lib/validation/common";
import { updateFriendshipSchema } from "@/lib/validation/social";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const { id } = await context.params;
    const friendshipId = uuidSchema.parse(id);

    const body = await parseJsonBody(request);
    const { action } = updateFriendshipSchema.parse(body);

    const { data: existing, error: fetchErr } = await supabase
      .from("friendships")
      .select("*")
      .eq("id", friendshipId)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!existing) {
      throw new AppError("NOT_FOUND", "Friendship record not found.", 404);
    }

    const isAddressee = existing.addressee_id === user.id;
    const isRequester = existing.requester_id === user.id;

    if (!isAddressee && !isRequester) {
      throw new AppError("NOT_FOUND", "Friendship record not found.", 404);
    }

    if ((action === "accept" || action === "decline") && !isAddressee) {
      throw new AppError(
        "FORBIDDEN",
        "Only the recipient of a friend request can accept or decline it.",
        403,
      );
    }

    const nextStatus =
      action === "accept"
        ? "accepted"
        : action === "decline"
          ? "declined"
          : "blocked";

    const { data, error } = await supabase
      .from("friendships")
      .update({ status: nextStatus })
      .eq("id", friendshipId)
      .select("*")
      .single();

    if (error) throw error;

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
    const friendshipId = uuidSchema.parse(id);

    const { data, error } = await supabase
      .from("friendships")
      .delete()
      .eq("id", friendshipId)
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
      .select("id")
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      throw new AppError("NOT_FOUND", "Friendship record not found.", 404);
    }

    return apiSuccess({ deleted: true, id: friendshipId });
  } catch (err) {
    return handleApiError(err);
  }
}
