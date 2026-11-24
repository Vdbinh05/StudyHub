import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/security/authz";
import { apiSuccess, handleApiError } from "@/lib/security/errors";
import { uuidSchema } from "@/lib/validation/common";

interface RouteContext {
  params: Promise<{ questionId: string }>;
}

export async function DELETE(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const { questionId } = await context.params;
    const qId = uuidSchema.parse(questionId);

    const { error } = await supabase
      .from("starred_questions")
      .delete()
      .eq("user_id", user.id)
      .eq("question_id", qId);

    if (error) throw error;

    return apiSuccess({ starred: false, question_id: qId });
  } catch (err) {
    return handleApiError(err);
  }
}
