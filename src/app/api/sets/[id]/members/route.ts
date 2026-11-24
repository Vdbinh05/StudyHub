import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, requireStudySetAccess } from "@/lib/security/authz";
import {
  apiSuccess,
  AppError,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import {
  enforceDistributedRateLimit,
  RATE_LIMITS,
} from "@/lib/security/rate-limit";
import { fetchInChunks, SAFE_IN_CHUNK_SIZE } from "@/lib/supabase/query-helpers";
import { uuidSchema } from "@/lib/validation/common";
import { addStudySetMemberSchema } from "@/lib/validation/sets";

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
    const setId = uuidSchema.parse(id);

    const access = await requireStudySetAccess(supabase, setId, user.id, "read");

    const { data: members, error } = await supabase
      .from("study_set_members")
      .select("*")
      .eq("study_set_id", setId)
      .order("created_at", { ascending: true });

    if (error) throw error;

    const userIds = Array.from(
      new Set([access.studySet.owner_id, ...(members ?? []).map((m) => m.user_id)]),
    );

    // SH-014 / SEC-005: Strictly omit private `email` from collaborator/owner projections
    const profiles =
      userIds.length > 0
        ? await fetchInChunks(
            userIds,
            async (chunk) =>
              supabase
                .from("profiles")
                .select("id, display_name, username, avatar_url")
                .in("id", chunk),
            SAFE_IN_CHUNK_SIZE,
          )
        : [];

    const profileMap = new Map(profiles.map((p) => [p.id, p]));

    const enriched = (members ?? []).map((m) => ({
      ...m,
      profile: profileMap.get(m.user_id) ?? null,
    }));

    return apiSuccess({
      owner: profileMap.get(access.studySet.owner_id) ?? null,
      members: enriched,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    // SH-040 / SEC-014: Rate-limit member invitation / identifier lookup to prevent enumeration
    const limited = await enforceDistributedRateLimit(
      request,
      RATE_LIMITS.FRIEND_REQUEST,
      user.id,
    );
    if (limited) return limited;

    const { id } = await context.params;
    const setId = uuidSchema.parse(id);

    await requireStudySetAccess(supabase, setId, user.id, "owner");

    const body = await parseJsonBody(request);
    const input = addStudySetMemberSchema.parse(body);

    let targetUserId = input.user_id;
    if (!targetUserId && input.identifier) {
      const { data: found, error: findErr } = await supabase.rpc(
        "find_profile_by_username_or_email",
        { p_query: input.identifier },
      );
      if (findErr) throw findErr;
      targetUserId = found?.[0]?.id;
    }

    if (!targetUserId) {
      throw new AppError(
        "NOT_FOUND",
        "No user found matching that username or email.",
        404,
      );
    }

    if (targetUserId === user.id) {
      throw new AppError(
        "BAD_REQUEST",
        "You are already the owner of this study set.",
        400,
      );
    }

    const { data, error } = await supabase
      .from("study_set_members")
      .upsert(
        {
          study_set_id: setId,
          user_id: targetUserId,
          role: input.role,
          invited_by: user.id,
        },
        { onConflict: "study_set_id,user_id" },
      )
      .select("*")
      .single();

    if (error) throw error;

    await supabase
      .from("study_sets")
      .update({ visibility: "shared" })
      .eq("id", setId)
      .eq("owner_id", user.id)
      .eq("visibility", "private");

    return apiSuccess(data, undefined, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
