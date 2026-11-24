import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, requireStudySetAccess } from "@/lib/security/authz";
import {
  apiSuccess,
  AppError,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import { uuidSchema } from "@/lib/validation/common";
import { updateReportSchema } from "@/lib/validation/v3";
import type { TablesUpdate } from "@/types/database";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const { id } = await context.params;
    const reportId = uuidSchema.parse(id);
    const body = updateReportSchema.parse(await parseJsonBody(request));

    const { data: existing, error: fetchErr } = await supabase
      .from("question_reports")
      .select("*")
      .eq("id", reportId)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!existing) {
      throw new AppError("NOT_FOUND", "Question report not found.", 404);
    }

    await requireStudySetAccess(supabase, existing.study_set_id, user.id, "edit");

    const patch: TablesUpdate<"question_reports"> = {};
    if (body.status !== undefined) {
      patch.status = body.status;
      if (body.status === "resolved" || body.status === "dismissed") {
        patch.resolved_by = user.id;
        patch.resolved_at = new Date().toISOString();
      } else {
        patch.resolved_by = null;
        patch.resolved_at = null;
      }
    }
    if (body.resolution_note !== undefined) {
      patch.resolution_note = body.resolution_note;
    }

    if (Object.keys(patch).length === 0) {
      throw new AppError("BAD_REQUEST", "No fields provided to update.", 400);
    }

    const { data, error } = await supabase
      .from("question_reports")
      .update(patch)
      .eq("id", reportId)
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
    const reportId = uuidSchema.parse(id);

    const { data: existing, error: fetchErr } = await supabase
      .from("question_reports")
      .select("id, study_set_id, reporter_id")
      .eq("id", reportId)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!existing) {
      throw new AppError("NOT_FOUND", "Question report not found.", 404);
    }

    if (existing.reporter_id !== user.id) {
      await requireStudySetAccess(supabase, existing.study_set_id, user.id, "owner");
    }

    const { data: deletedRow, error } = await supabase
      .from("question_reports")
      .delete()
      .eq("id", reportId)
      .select("id")
      .maybeSingle();

    if (error) throw error;
    if (!deletedRow) {
      throw new AppError(
        "FORBIDDEN",
        "You do not have permission to delete this report.",
        403,
      );
    }
    return apiSuccess({ deleted: true, id: reportId });
  } catch (err) {
    return handleApiError(err);
  }
}
