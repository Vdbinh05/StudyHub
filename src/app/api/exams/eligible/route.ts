import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/security/authz";
import {
  apiSuccess,
  AppError,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import { extractSourceIds } from "@/lib/supabase/exam-engine";
import { rpcGetExamEligiblePool } from "@/lib/supabase/rpc";
import { examEligibleRequestSchema } from "@/lib/validation/exams";
import type { ExamEligiblePool } from "@/types/domain";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase } = await requireAuth();
    const body = await parseJsonBody(request);
    const input = examEligibleRequestSchema.parse(body);

    const fromSources = input.sources ? extractSourceIds(input.sources) : null;
    const folderIds = Array.from(
      new Set([...(input.folder_ids ?? []), ...(fromSources?.folderIds ?? [])]),
    );
    const studySetIds = Array.from(
      new Set([...(input.study_set_ids ?? []), ...(fromSources?.studySetIds ?? [])]),
    );
    const includeSubfolders = fromSources
      ? input.include_subfolders && fromSources.includeSubfolders
      : input.include_subfolders;

    const { data: rawPool, error } = await rpcGetExamEligiblePool(supabase, {
      p_folder_ids: folderIds,
      p_study_set_ids: studySetIds,
      p_include_subfolders: includeSubfolders,
      p_filters: (input.filters ?? {}) as Record<string, unknown>,
      p_selection_policy: input.selection_policy,
    });

    if (error) throw error;
    if (!rawPool) {
      throw new AppError(
        "INTERNAL_ERROR",
        "Failed to resolve eligible exam pool.",
        500,
      );
    }

    const totalRawSelections = studySetIds.length + folderIds.length;
    const overlapSetsRemoved = Math.max(
      0,
      totalRawSelections - rawPool.deduplicated_set_count,
    );

    const pool: ExamEligiblePool = {
      ...rawPool,
      overlap_sets_removed: overlapSetsRemoved,
    };

    return apiSuccess(pool);
  } catch (err) {
    return handleApiError(err);
  }
}
