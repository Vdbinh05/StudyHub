import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/security/authz";
import {
  apiSuccess,
  AppError,
  handleApiError,
  parseOptionalJsonBody,
} from "@/lib/security/errors";
import {
  enforceDistributedRateLimit,
  RATE_LIMITS,
} from "@/lib/security/rate-limit";
import { fetchCycleSubjectProgress } from "@/lib/supabase/coverage-helper";
import {
  cryptoShuffle,
  extractSourceIds,
  fetchEligibleCandidates,
} from "@/lib/supabase/exam-engine";
import { rpcRestartCoverageCycle } from "@/lib/supabase/rpc";
import { uuidSchema } from "@/lib/validation/common";
import { restartCoverageCycleSchema } from "@/lib/validation/exams";
import type { ExamFilterConfig, ExamSourceInput } from "@/types/domain";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function POST(
  request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const limited = await enforceDistributedRateLimit(
      request,
      RATE_LIMITS.CYCLE_RESTART,
      user.id,
    );
    if (limited) return limited;

    const { id: rawId } = await context.params;
    const id = uuidSchema.parse(rawId);

    let refreshPool = false;
    let forceDiscardActive = false;
    const body = await parseOptionalJsonBody(request);
    if (body !== undefined) {
      const parsed = restartCoverageCycleSchema.parse(body);
      refreshPool = parsed?.refresh_pool ?? false;
      forceDiscardActive = parsed?.force_discard_active ?? false;
    }

    let newPoolItems: Array<{ question_id: string }> | null = null;
    if (refreshPool) {
      const { data: cycleRow, error: fetchErr } = await supabase
        .from("coverage_cycles")
        .select("source_snapshot, filter_snapshot")
        .eq("id", id)
        .eq("user_id", user.id)
        .maybeSingle();

      if (fetchErr) throw fetchErr;
      if (!cycleRow) {
        throw new AppError("NOT_FOUND", "Coverage cycle not found.", 404);
      }

      const filterSnap = (cycleRow.filter_snapshot ?? {}) as Record<
        string,
        unknown
      >;
      const rawSources = Array.isArray(filterSnap.sources)
        ? (filterSnap.sources as ExamSourceInput[])
        : Array.isArray(cycleRow.source_snapshot)
          ? (
              cycleRow.source_snapshot as Array<{ study_set_id?: string }>
            )
              .filter((s) => Boolean(s.study_set_id))
              .map((s) => ({
                source_type: "study_set" as const,
                id: s.study_set_id!,
                include_subfolders: true,
              }))
          : [];

      const { folderIds, studySetIds, includeSubfolders } =
        extractSourceIds(rawSources);

      const { candidates } = await fetchEligibleCandidates({
        supabase,
        userId: user.id,
        folderIds,
        studySetIds,
        includeSubfolders,
        filters: (filterSnap.filters ?? {}) as ExamFilterConfig,
        selectionPolicy: "random",
      });

      if (candidates.length === 0) {
        throw new AppError(
          "BAD_REQUEST",
          "No eligible questions remain in the refreshed pool.",
          400,
        );
      }

      newPoolItems = cryptoShuffle(candidates).map((c) => ({
        question_id: c.id,
      }));
    }

    const { data: restarted, error } = await rpcRestartCoverageCycle(supabase, {
      p_cycle_id: id,
      p_new_pool_items: newPoolItems,
      p_force_discard_active: forceDiscardActive,
    });

    if (error) throw error;
    if (!restarted) {
      throw new AppError("NOT_FOUND", "Coverage cycle not found.", 404);
    }

    const subjectProgress = await fetchCycleSubjectProgress(supabase, id);

    return apiSuccess({
      ...restarted,
      remaining_count: Math.max(
        0,
        restarted.total_questions -
          restarted.completed_count -
          restarted.assigned_count,
      ),
      progress_percent: 0,
      subject_progress: subjectProgress,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
