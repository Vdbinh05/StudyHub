import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/security/authz";
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
import {
  computeLiveCoverageMetrics,
  fetchCycleSubjectProgress,
  fetchCyclesSubjectProgressBatch,
  issueNextExamForCycle,
} from "@/lib/supabase/coverage-helper";
import {
  cryptoShuffle,
  extractSourceIds,
  fetchEligibleCandidates,
} from "@/lib/supabase/exam-engine";
import { fetchInChunks, SAFE_IN_CHUNK_SIZE } from "@/lib/supabase/query-helpers";
import { rpcCreateCoverageCycle } from "@/lib/supabase/rpc";
import {
  createCoverageCycleSchema,
  listCoverageCyclesQuerySchema,
} from "@/lib/validation/exams";
import type { CoverageCycle } from "@/types/domain";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const rawParams = Object.fromEntries(request.nextUrl.searchParams.entries());
    const query = listCoverageCyclesQuerySchema.parse(rawParams);

    const from = (query.page - 1) * query.pageSize;
    const to = from + query.pageSize - 1;

    let dbQuery = supabase
      .from("coverage_cycles")
      .select("*", { count: "exact" })
      .eq("user_id", user.id);

    if (query.status) {
      dbQuery = dbQuery.eq("status", query.status);
    }

    const { data: rows, count, error } = await dbQuery
      .order("updated_at", { ascending: false })
      .range(from, to);

    if (error) throw error;

    const cycleRows = rows ?? [];
    const activeIds = cycleRows
      .map((c) => c.active_attempt_id)
      .filter((id): id is string => Boolean(id));

    const activeAttemptMap = new Map<
      string,
      NonNullable<CoverageCycle["active_attempt"]>
    >();
    if (activeIds.length > 0) {
      const attempts = await fetchInChunks(
        activeIds,
        async (chunk) =>
          supabase
            .from("exam_attempts")
            .select(
              "id, status, total_questions, answered_count, started_at, expires_at",
            )
            .eq("user_id", user.id)
            .in("id", chunk),
        SAFE_IN_CHUNK_SIZE,
      );
      for (const a of attempts) {
        activeAttemptMap.set(a.id, a);
      }
    }

    const progressByCycle = await fetchCyclesSubjectProgressBatch(
      supabase,
      cycleRows.map((c) => c.id),
    );

    const enriched: CoverageCycle[] = await Promise.all(
      cycleRows.map(async (c) => {
        const subjectProgress = progressByCycle.get(c.id) ?? [];
        const activeAttempt = c.active_attempt_id
          ? (activeAttemptMap.get(c.active_attempt_id) ?? null)
          : null;
        const live = await computeLiveCoverageMetrics(
          supabase,
          user.id,
          c,
          subjectProgress,
          Boolean(activeAttempt && activeAttempt.status === "in_progress"),
        );

        return {
          ...c,
          status: live.status,
          completed_at: live.completed_at,
          assigned_count: live.assigned_count,
          active_attempt_id: live.active_attempt_id,
          source_snapshot: (Array.isArray(c.source_snapshot)
            ? c.source_snapshot
            : []) as CoverageCycle["source_snapshot"],
          filter_snapshot: (c.filter_snapshot ?? {}) as Record<string, unknown>,
          remaining_count: live.remaining_count,
          progress_percent: live.progress_percent,
          subject_progress: subjectProgress,
          active_attempt: live.active_attempt_id ? activeAttempt : null,
        };
      }),
    );

    const total = count ?? enriched.length;
    return apiSuccess(enriched, {
      total,
      page: query.page,
      pageSize: query.pageSize,
      hasMore: from + enriched.length < total,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const limited = await enforceDistributedRateLimit(
      request,
      RATE_LIMITS.EXAM_START,
      user.id,
    );
    if (limited) return limited;

    const body = await parseJsonBody(request);
    const input = createCoverageCycleSchema.parse(body);

    const {
      folderIds,
      studySetIds,
      includeSubfolders,
      customCountsBySet,
      customPercentagesBySet,
    } = extractSourceIds(input.sources);

    const { dedupedSets, candidates } = await fetchEligibleCandidates({
      supabase,
      userId: user.id,
      folderIds,
      studySetIds,
      includeSubfolders,
      filters: input.filters,
      selectionPolicy: "random",
    });

    if (candidates.length === 0) {
      throw new AppError(
        "BAD_REQUEST",
        "No exam-eligible questions matched the selected sources and filters.",
        400,
      );
    }

    const shuffledPool = cryptoShuffle(candidates).map((c) => ({
      question_id: c.id,
    }));

    const sourceSnapshot = dedupedSets.map((s) => ({
      study_set_id: s.study_set_id,
      title: s.title,
      subject: s.subject,
      custom_count: customCountsBySet.get(s.study_set_id) ?? null,
      custom_percentage: customPercentagesBySet.get(s.study_set_id) ?? null,
    }));

    const filterSnapshot: Record<string, unknown> = {
      sources: input.sources,
      filters: input.filters,
      duration_limit_seconds: input.duration_limit_seconds ?? null,
      pass_threshold: input.pass_threshold,
      shuffle_options: input.shuffle_options,
      show_subject_names: input.show_subject_names,
      show_chapter_names: input.show_chapter_names,
      allow_navigation: input.allow_navigation,
      allow_mark_for_review: input.allow_mark_for_review,
      auto_submit_on_expire: input.auto_submit_on_expire,
      show_review_after_submit: input.show_review_after_submit,
    };

    const title =
      input.title ??
      (dedupedSets.length === 1
        ? `${dedupedSets[0].title} — Full Coverage`
        : `Full Coverage (${dedupedSets.length} subjects)`);

    const { data: cycle, error: rpcErr } = await rpcCreateCoverageCycle(
      supabase,
      {
        p_title: title,
        p_source_snapshot: sourceSnapshot,
        p_filter_snapshot: filterSnapshot,
        p_allocation_strategy: input.allocation_strategy,
        p_questions_per_exam: Math.min(input.questions_per_exam, shuffledPool.length),
        p_pool_items: shuffledPool,
        p_preset_id: input.preset_id ?? null,
      },
    );

    if (rpcErr) throw rpcErr;
    if (!cycle) {
      throw new AppError("INTERNAL_ERROR", "Failed to create coverage cycle.", 500);
    }

    let firstExam = null;
    if (input.start_first_exam) {
      firstExam = await issueNextExamForCycle(supabase, user.id, cycle);
    }

    const subjectProgress = await fetchCycleSubjectProgress(supabase, cycle.id);

    // Refresh cycle counters if first exam was issued
    const { data: refreshed } = await supabase
      .from("coverage_cycles")
      .select("*")
      .eq("id", cycle.id)
      .eq("user_id", user.id)
      .single();

    const finalCycle = (refreshed ?? cycle) as CoverageCycle;

    return apiSuccess(
      {
        cycle: {
          ...finalCycle,
          remaining_count: Math.max(
            0,
            finalCycle.total_questions -
              finalCycle.completed_count -
              finalCycle.assigned_count,
          ),
          progress_percent:
            finalCycle.total_questions > 0
              ? Math.round(
                  (finalCycle.completed_count / finalCycle.total_questions) * 10000,
                ) / 100
              : 0,
          subject_progress: subjectProgress,
        },
        first_exam: firstExam,
      },
      undefined,
      { status: 201 },
    );
  } catch (err) {
    return handleApiError(err);
  }
}
