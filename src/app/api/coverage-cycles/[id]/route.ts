import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/security/authz";
import { apiSuccess, AppError, handleApiError } from "@/lib/security/errors";
import { fetchCycleSubjectProgress } from "@/lib/supabase/coverage-helper";
import { fetchInChunks, SAFE_IN_CHUNK_SIZE } from "@/lib/supabase/query-helpers";
import { uuidSchema } from "@/lib/validation/common";
import type { CoverageCycle, CoverageCycleAttempt } from "@/types/domain";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(
  _request: NextRequest,
  context: RouteContext,
): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const { id: rawId } = await context.params;
    const id = uuidSchema.parse(rawId);

    const { data: cycle, error } = await supabase
      .from("coverage_cycles")
      .select("*")
      .eq("id", id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) throw error;
    if (!cycle) {
      throw new AppError("NOT_FOUND", "Coverage cycle not found.", 404);
    }

    const [{ data: attemptLinks, error: linkErr }, subjectProgress] =
      await Promise.all([
        supabase
          .from("coverage_cycle_attempts")
          .select("*")
          .eq("cycle_id", id)
          .eq("user_id", user.id)
          .order("sequence_number", { ascending: false }),
        fetchCycleSubjectProgress(supabase, id),
      ]);

    if (linkErr) throw linkErr;

    const attemptIds = (attemptLinks ?? []).map((a) => a.attempt_id);
    const attemptMeta = new Map<
      string,
      {
        id: string;
        status: CoverageCycle["active_attempt"] extends infer T
          ? T extends { status: infer S }
            ? S
            : never
          : never;
        total_questions: number;
        answered_count: number;
        score_percent: number;
        passed: boolean;
        started_at: string;
        expires_at: string | null;
      }
    >();

    if (attemptIds.length > 0) {
      const rows = await fetchInChunks(
        attemptIds,
        async (chunk) =>
          supabase
            .from("exam_attempts")
            .select(
              "id, status, total_questions, answered_count, score_percent, passed, started_at, expires_at",
            )
            .eq("user_id", user.id)
            .in("id", chunk),
        SAFE_IN_CHUNK_SIZE,
      );
      for (const r of rows) {
        attemptMeta.set(r.id, r);
      }
    }

    const attempts: CoverageCycleAttempt[] = (attemptLinks ?? []).map((link) => {
      const meta = attemptMeta.get(link.attempt_id);
      return {
        ...link,
        score_percent: meta ? Number(meta.score_percent) : null,
        passed: meta ? meta.passed : null,
        exam_status: meta?.status,
      };
    });

    const activeMeta = cycle.active_attempt_id
      ? attemptMeta.get(cycle.active_attempt_id)
      : undefined;

    const remainingCount = Math.max(
      0,
      cycle.total_questions - cycle.completed_count - cycle.assigned_count,
    );
    const progressPercent =
      cycle.total_questions > 0
        ? Math.round((cycle.completed_count / cycle.total_questions) * 10000) /
          100
        : 0;

    const enriched: CoverageCycle = {
      ...cycle,
      source_snapshot: (Array.isArray(cycle.source_snapshot)
        ? cycle.source_snapshot
        : []) as CoverageCycle["source_snapshot"],
      filter_snapshot: (cycle.filter_snapshot ?? {}) as Record<string, unknown>,
      remaining_count: remainingCount,
      progress_percent: progressPercent,
      subject_progress: subjectProgress,
      attempts,
      active_attempt: activeMeta
        ? {
            id: activeMeta.id,
            status: activeMeta.status,
            total_questions: activeMeta.total_questions,
            answered_count: activeMeta.answered_count,
            started_at: activeMeta.started_at,
            expires_at: activeMeta.expires_at,
          }
        : null,
    };

    return apiSuccess(enriched);
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
    const { id: rawId } = await context.params;
    const id = uuidSchema.parse(rawId);

    const { data, error } = await supabase
      .from("coverage_cycles")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      throw new AppError("NOT_FOUND", "Coverage cycle not found.", 404);
    }

    return apiSuccess({ deleted: true, id });
  } catch (err) {
    return handleApiError(err);
  }
}
