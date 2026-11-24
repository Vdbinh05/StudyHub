import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/security/authz";
import {
  apiSuccess,
  AppError,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import { uuidSchema } from "@/lib/validation/common";
import { updateSessionSchema } from "@/lib/validation/learning";
import type { TablesUpdate } from "@/types/database";

interface RouteContext {
  params: Promise<{ sessionId: string }>;
}

export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const { sessionId } = await context.params;
    const id = uuidSchema.parse(sessionId);

    const [{ data: session, error: sessErr }, { data: answers, error: ansErr }] =
      await Promise.all([
        supabase
          .from("study_sessions")
          .select("*")
          .eq("id", id)
          .eq("user_id", user.id)
          .maybeSingle(),
        supabase
          .from("study_session_answers")
          .select("*")
          .eq("session_id", id)
          .eq("user_id", user.id)
          .order("answered_at", { ascending: true }),
      ]);

    if (sessErr) throw sessErr;
    if (ansErr) throw ansErr;
    if (!session) {
      throw new AppError("NOT_FOUND", "Study session not found.", 404);
    }

    return apiSuccess({
      ...session,
      answers: answers ?? [],
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
    const { sessionId } = await context.params;
    const id = uuidSchema.parse(sessionId);

    const body = await parseJsonBody(request);
    const input = updateSessionSchema.parse(body);

    const { data: existing, error: fetchErr } = await supabase
      .from("study_sessions")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!existing) {
      throw new AppError("NOT_FOUND", "Study session not found.", 404);
    }

    const nowIso = new Date().toISOString();
    const updateData: TablesUpdate<"study_sessions"> = {};
    if (input.status !== undefined) updateData.status = input.status;
    if (input.total_items !== undefined) updateData.total_items = input.total_items;
    if (input.completed_items !== undefined) updateData.completed_items = input.completed_items;
    if (input.correct_items !== undefined) updateData.correct_items = input.correct_items;
    if (input.duration_seconds !== undefined) updateData.duration_seconds = input.duration_seconds;
    if (input.status === "completed" && !existing.completed_at) {
      updateData.completed_at = nowIso;
    }

    const { data, error } = await supabase
      .from("study_sessions")
      .update(updateData)
      .eq("id", id)
      .eq("user_id", user.id)
      .select("*")
      .single();

    if (error) throw error;

    if (input.status === "completed") {
      await supabase
        .from("study_sets")
        .update({ last_studied_at: nowIso })
        .eq("id", existing.study_set_id)
        .eq("owner_id", user.id);
    }

    return apiSuccess(data);
  } catch (err) {
    return handleApiError(err);
  }
}
