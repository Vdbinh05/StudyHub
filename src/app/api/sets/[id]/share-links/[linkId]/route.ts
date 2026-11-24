import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth, requireStudySetAccess } from "@/lib/security/authz";
import {
  apiSuccess,
  AppError,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import { sharePermissionSchema, uuidSchema } from "@/lib/validation/common";
import type { TablesUpdate } from "@/types/database";

interface RouteContext {
  params: Promise<{ id: string; linkId: string }>;
}

const updateShareLinkSchema = z.object({
  permission: sharePermissionSchema.optional(),
  allow_clone: z.boolean().optional(),
  revoke: z.boolean().optional(),
  expires_at: z.string().datetime().nullable().optional(),
});

export async function PATCH(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const { id, linkId } = await context.params;
    const setId = uuidSchema.parse(id);
    const parsedLinkId = uuidSchema.parse(linkId);

    await requireStudySetAccess(supabase, setId, user.id, "owner");

    const body = await parseJsonBody(request);
    const input = updateShareLinkSchema.parse(body);

    const payload: TablesUpdate<"study_set_share_links"> = {};
    if (input.permission !== undefined) payload.permission = input.permission;
    if (input.allow_clone !== undefined) payload.allow_clone = input.allow_clone;
    if (input.expires_at !== undefined) payload.expires_at = input.expires_at;
    if (input.revoke === true) payload.revoked_at = new Date().toISOString();

    const { data, error } = await supabase
      .from("study_set_share_links")
      .update(payload)
      .eq("id", parsedLinkId)
      .eq("study_set_id", setId)
      .select("*")
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      throw new AppError("NOT_FOUND", "Share link not found.", 404);
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
    const { id, linkId } = await context.params;
    const setId = uuidSchema.parse(id);
    const parsedLinkId = uuidSchema.parse(linkId);

    await requireStudySetAccess(supabase, setId, user.id, "owner");

    // Soft-revoke to keep audit trail intact
    const { data, error } = await supabase
      .from("study_set_share_links")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", parsedLinkId)
      .eq("study_set_id", setId)
      .select("id, revoked_at")
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      throw new AppError("NOT_FOUND", "Share link not found.", 404);
    }

    return apiSuccess({ revoked: true, id: data.id, revoked_at: data.revoked_at });
  } catch (err) {
    return handleApiError(err);
  }
}
