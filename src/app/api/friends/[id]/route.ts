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

    // SH-002 / SEC-006: Prevent blocked users from modifying a block created by the other user
    if (existing.status === "blocked" && existing.blocked_by !== user.id) {
      throw new AppError(
        "FORBIDDEN",
        "You do not have permission to modify this block.",
        403,
      );
    }

    if (action === "accept" || action === "decline") {
      if (!isAddressee) {
        throw new AppError(
          "FORBIDDEN",
          "Only the recipient of a friend request can accept or decline it.",
          403,
        );
      }
      if (existing.status !== "pending") {
        throw new AppError(
          "CONFLICT",
          "Only pending friend requests can be accepted or declined.",
          409,
        );
      }
    }

    const nextStatus: "accepted" | "declined" | "blocked" =
      action === "accept"
        ? "accepted"
        : action === "decline"
          ? "declined"
          : "blocked";

    const updatePayload: {
      status: "accepted" | "declined" | "blocked";
      blocked_by: string | null;
    } =
      nextStatus === "blocked"
        ? { status: "blocked", blocked_by: user.id }
        : { status: nextStatus, blocked_by: null };

    const { data, error } = await supabase
      .from("friendships")
      .update(updatePayload)
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

    const { data: existing, error: fetchErr } = await supabase
      .from("friendships")
      .select("id, requester_id, addressee_id, status, blocked_by")
      .eq("id", friendshipId)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (
      !existing ||
      (existing.requester_id !== user.id && existing.addressee_id !== user.id)
    ) {
      throw new AppError("NOT_FOUND", "Friendship record not found.", 404);
    }

    // SH-002 / SEC-006: Blocked user CANNOT delete a block created by someone else
    if (existing.status === "blocked" && existing.blocked_by !== user.id) {
      throw new AppError(
        "FORBIDDEN",
        "Only the user who created this block can remove it.",
        403,
      );
    }

    const { data, error } = await supabase
      .from("friendships")
      .delete()
      .eq("id", friendshipId)
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
