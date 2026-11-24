import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/security/authz";
import { apiSuccess, AppError, handleApiError } from "@/lib/security/errors";

type RouteContext = { params: Promise<{ sessionKey: string }> };

function parseSessionKey(raw: string): string {
  const decoded = decodeURIComponent(raw).trim();
  if (!decoded || decoded.length > 120 || !/^[a-zA-Z0-9:_-]+$/.test(decoded)) {
    throw new AppError("VALIDATION_ERROR", "Invalid sessionKey parameter.", 400);
  }
  return decoded;
}

export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const { sessionKey } = await context.params;
    const key = parseSessionKey(sessionKey);

    const { data, error } = await supabase
      .from("learning_session_checkpoints")
      .select("*")
      .eq("user_id", user.id)
      .eq("session_key", key)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      throw new AppError("NOT_FOUND", "Checkpoint not found.", 404);
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
    const { sessionKey } = await context.params;
    const key = parseSessionKey(sessionKey);

    const { error } = await supabase
      .from("learning_session_checkpoints")
      .delete()
      .eq("user_id", user.id)
      .eq("session_key", key);

    if (error) throw error;
    return apiSuccess({ deleted: true, session_key: key });
  } catch (err) {
    return handleApiError(err);
  }
}
