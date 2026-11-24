import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/security/authz";
import {
  apiSuccess,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import { computeExamPreview } from "@/lib/supabase/exam-engine";
import { examPreviewRequestSchema } from "@/lib/validation/exams";

/**
 * Dry-run V2.0 Exam Preview endpoint.
 * Validates exact integer counts, computes Strategies A–E allocations,
 * checks anti-repeat fallback counts, and computes Full Coverage batch plans
 * with ZERO question or answer leakage.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const body = await parseJsonBody(request);
    const input = examPreviewRequestSchema.parse(body);

    const { preview } = await computeExamPreview({
      supabase,
      userId: user.id,
      sources: input.sources,
      requestedQuestionCount: input.requested_question_count,
      allocationStrategy: input.allocation_strategy,
      selectionPolicy: input.selection_policy,
      fullCoverageMode: input.full_coverage_mode,
      questionsPerExam: input.questions_per_exam,
      durationLimitSeconds: input.duration_limit_seconds ?? null,
      filters: input.filters,
    });

    return apiSuccess(preview);
  } catch (err) {
    return handleApiError(err);
  }
}
