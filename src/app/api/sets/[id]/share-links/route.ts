import { randomBytes } from "node:crypto";
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
import { getAppUrl } from "@/lib/supabase/env";
import { uuidSchema } from "@/lib/validation/common";
import { createShareLinkSchema } from "@/lib/validation/sets";

interface RouteContext {
  params: Promise<{ id: string }>;
}

const MAX_ACTIVE_SHARE_LINKS_PER_SET = 25;

export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const { id } = await context.params;
    const setId = uuidSchema.parse(id);

    await requireStudySetAccess(supabase, setId, user.id, "owner");

    const { data, error } = await supabase
      .from("study_set_share_links")
      .select("*")
      .eq("study_set_id", setId)
      .order("created_at", { ascending: false });

    if (error) throw error;

    const appUrl = getAppUrl();
    const links = (data ?? []).map((link) => ({
      ...link,
      share_url: `${appUrl}/share/${link.token}`,
    }));

    return apiSuccess(links, { total: links.length });
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
    const limited = await enforceDistributedRateLimit(
      request,
      RATE_LIMITS.SHARE_CREATE,
      user.id,
    );
    if (limited) return limited;

    const { id } = await context.params;
    const setId = uuidSchema.parse(id);

    await requireStudySetAccess(supabase, setId, user.id, "owner");

    // SEC-014: Cap active unrevoked share links per set
    const { count: activeCount, error: cntErr } = await supabase
      .from("study_set_share_links")
      .select("id", { count: "exact", head: true })
      .eq("study_set_id", setId)
      .is("revoked_at", null);

    if (cntErr) throw cntErr;
    if ((activeCount ?? 0) >= MAX_ACTIVE_SHARE_LINKS_PER_SET) {
      throw new AppError(
        "CONFLICT",
        `Maximum of ${MAX_ACTIVE_SHARE_LINKS_PER_SET} active share links reached. Revoke an unused link first.`,
        409,
      );
    }

    const body = await parseJsonBody(request);
    const input = createShareLinkSchema.parse(body);

    // >= 192 bits of cryptographic entropy (URL-safe base64url)
    const token = randomBytes(24).toString("base64url");

    let expiresAt: string | null = input.expires_at ?? null;
    if (!expiresAt && input.expires_in_hours) {
      expiresAt = new Date(
        Date.now() + input.expires_in_hours * 60 * 60 * 1000,
      ).toISOString();
    }

    const { data, error } = await supabase
      .from("study_set_share_links")
      .insert({
        study_set_id: setId,
        created_by: user.id,
        token,
        permission: input.permission,
        allow_clone: input.allow_clone,
        expires_at: expiresAt,
      })
      .select("*")
      .single();

    if (error) throw error;

    return apiSuccess(
      {
        ...data,
        share_url: `${getAppUrl()}/share/${data.token}`,
      },
      undefined,
      { status: 201 },
    );
  } catch (err) {
    return handleApiError(err);
  }
}
