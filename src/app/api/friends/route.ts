import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/security/authz";
import {
  apiSuccess,
  AppError,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rate-limit";
import { fetchInChunks, SAFE_IN_CHUNK_SIZE } from "@/lib/supabase/query-helpers";
import { createFriendRequestSchema } from "@/lib/validation/social";

export async function GET(): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();

    const { data: rows, error } = await supabase
      .from("friendships")
      .select("*")
      .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
      .order("updated_at", { ascending: false });

    if (error) throw error;

    // SH-002 / SEC-006: Hide blocks initiated by the other user from the blocked user's payload
    const friendships = (rows ?? []).filter(
      (f) => f.status !== "blocked" || f.blocked_by === user.id,
    );

    const otherIds = Array.from(
      new Set(
        friendships.map((f) =>
          f.requester_id === user.id ? f.addressee_id : f.requester_id,
        ),
      ),
    );

    const profiles =
      otherIds.length > 0
        ? await fetchInChunks(
            otherIds,
            async (chunk) =>
              supabase
                .from("profiles")
                .select("id, display_name, username, avatar_url, bio")
                .in("id", chunk),
            SAFE_IN_CHUNK_SIZE,
          )
        : [];

    const profileMap = new Map(profiles.map((p) => [p.id, p]));

    const enriched = friendships.map((f) => {
      const otherId =
        f.requester_id === user.id ? f.addressee_id : f.requester_id;
      return {
        ...f,
        direction: f.requester_id === user.id ? "outgoing" : "incoming",
        friend: profileMap.get(otherId) ?? null,
      };
    });

    return apiSuccess({
      current_user_id: user.id,
      friends: enriched.filter((f) => f.status === "accepted"),
      incoming_requests: enriched.filter(
        (f) => f.status === "pending" && f.direction === "incoming",
      ),
      outgoing_requests: enriched.filter(
        (f) => f.status === "pending" && f.direction === "outgoing",
      ),
      blocked: enriched.filter(
        (f) => f.status === "blocked" && f.blocked_by === user.id,
      ),
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const limited = enforceRateLimit(
      request,
      RATE_LIMITS.FRIEND_REQUEST,
      user.id,
    );
    if (limited) return limited;

    const body = await parseJsonBody(request);
    const input = createFriendRequestSchema.parse(body);

    let targetId = input.addressee_id;
    if (!targetId && input.identifier) {
      const { data: found, error: findErr } = await supabase.rpc(
        "find_profile_by_username_or_email",
        { p_query: input.identifier },
      );
      if (findErr) throw findErr;
      targetId = found?.[0]?.id;
    }

    if (!targetId) {
      throw new AppError(
        "NOT_FOUND",
        "No user found matching that username or email.",
        404,
      );
    }

    if (targetId === user.id) {
      throw new AppError(
        "BAD_REQUEST",
        "You cannot send a friend request to yourself.",
        400,
      );
    }

    const { data: existing, error: exErr } = await supabase
      .from("friendships")
      .select("*")
      .or(
        `and(requester_id.eq.${user.id},addressee_id.eq.${targetId}),and(requester_id.eq.${targetId},addressee_id.eq.${user.id})`,
      )
      .maybeSingle();

    if (exErr) throw exErr;

    if (existing) {
      if (existing.status === "accepted") {
        throw new AppError("CONFLICT", "You are already friends.", 409);
      }
      if (existing.status === "pending") {
        throw new AppError(
          "CONFLICT",
          "A friend request is already pending between you and this user.",
          409,
        );
      }
      if (existing.status === "blocked") {
        throw new AppError(
          "FORBIDDEN",
          "Cannot send a friend request to this user.",
          403,
        );
      }
      const { error: delOldErr } = await supabase
        .from("friendships")
        .delete()
        .eq("id", existing.id);
      if (delOldErr) throw delOldErr;
    }

    const { data, error } = await supabase
      .from("friendships")
      .insert({
        requester_id: user.id,
        addressee_id: targetId,
        status: "pending",
      })
      .select("*")
      .single();

    if (error) throw error;

    return apiSuccess(data, undefined, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
