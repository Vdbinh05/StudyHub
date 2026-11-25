import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type {
  AllocationStrategy,
  CoverageCycle,
  CoverageSubjectProgress,
  ExamSourceInput,
} from "@/types/domain";
import { AppError } from "@/lib/security/errors";
import {
  computeSubjectAllocations,
  cryptoShuffle,
  stripPreSubmitQuestions,
} from "./exam-engine";
import { fetchAllPages, fetchInChunks, SAFE_IN_CHUNK_SIZE } from "./query-helpers";
import {
  rpcGetCoverageCycleSubjectProgress,
  rpcIssueCoverageCycleNextExam,
  type ExamAttemptPayload,
} from "./rpc";

/**
 * Verifies the user has read access to every study_set source and owns every folder source.
 */
export async function verifyPresetSourcesAccess(
  supabase: SupabaseClient<Database>,
  userId: string,
  sources: readonly ExamSourceInput[],
): Promise<void> {
  const folderIds = Array.from(
    new Set(sources.filter((s) => s.source_type === "folder").map((s) => s.id)),
  );
  const setIds = Array.from(
    new Set(sources.filter((s) => s.source_type === "study_set").map((s) => s.id)),
  );

  if (folderIds.length > 0) {
    const ownedFolders = await fetchInChunks(
      folderIds,
      async (chunk) =>
        supabase
          .from("folders")
          .select("id")
          .eq("owner_id", userId)
          .in("id", chunk),
      SAFE_IN_CHUNK_SIZE,
    );
    if (ownedFolders.length !== folderIds.length) {
      throw new AppError(
        "FORBIDDEN",
        "One or more selected folders were not found or belong to another user.",
        403,
      );
    }
  }

  if (setIds.length > 0) {
    // RLS on study_sets ensures only readable sets are returned
    const readableSets = await fetchInChunks(
      setIds,
      async (chunk) => supabase.from("study_sets").select("id").in("id", chunk),
      SAFE_IN_CHUNK_SIZE,
    );
    if (readableSets.length !== setIds.length) {
      throw new AppError(
        "FORBIDDEN",
        "One or more selected study sets were not found or are inaccessible.",
        403,
      );
    }
  }
}

/**
 * Computes per-subject breakdown (`completed / assigned / remaining`) for multiple coverage cycles
 * in ONE set-based SQL `GROUP BY` RPC call (zero N+1 full `coverage_cycle_questions` downloads).
 */
export async function fetchCyclesSubjectProgressBatch(
  supabase: SupabaseClient<Database>,
  cycleIds: readonly string[],
): Promise<Map<string, CoverageSubjectProgress[]>> {
  const result = new Map<string, CoverageSubjectProgress[]>();
  const uniqueIds = Array.from(new Set(cycleIds));
  if (uniqueIds.length === 0) {
    return result;
  }

  for (const id of uniqueIds) {
    result.set(id, []);
  }

  const { data, error } = await rpcGetCoverageCycleSubjectProgress(
    supabase,
    uniqueIds,
  );
  if (error) throw error;

  for (const row of data) {
    const arr = result.get(row.cycle_id) ?? [];
    arr.push({
      study_set_id: row.study_set_id,
      subject_title: row.subject_title,
      total: Number(row.total),
      completed: Number(row.completed),
      assigned: Number(row.assigned),
      remaining: Number(row.remaining),
    });
    result.set(row.cycle_id, arr);
  }

  return result;
}

/**
 * Computes per-subject breakdown (`completed / assigned / remaining`) for a single coverage cycle.
 */
export async function fetchCycleSubjectProgress(
  supabase: SupabaseClient<Database>,
  cycleId: string,
): Promise<CoverageSubjectProgress[]> {
  const batch = await fetchCyclesSubjectProgressBatch(supabase, [cycleId]);
  return batch.get(cycleId) ?? [];
}

/**
 * Computes live remaining/total counts excluding mid-cycle deleted questions (`question_id IS NULL`)
 * and cleanly transitions wedged active cycles with 0 live unassigned/assigned questions to `completed` (V32-010 / FUNC-07).
 */
export async function computeLiveCoverageMetrics(
  supabase: SupabaseClient<Database>,
  userId: string,
  cycle: {
    id: string;
    status: string;
    total_questions: number;
    completed_count: number;
    assigned_count: number;
    active_attempt_id: string | null;
    completed_at: string | null;
  },
  subjectProgress: readonly CoverageSubjectProgress[],
  hasInProgressActiveAttempt: boolean,
): Promise<{
  status: CoverageCycle["status"];
  completed_at: string | null;
  assigned_count: number;
  active_attempt_id: string | null;
  remaining_count: number;
  progress_percent: number;
}> {
  const liveRemaining =
    subjectProgress.length > 0
      ? subjectProgress.reduce((sum, s) => sum + Math.max(0, s.remaining), 0)
      : Math.max(0, cycle.total_questions - cycle.completed_count - cycle.assigned_count);

  const liveAssigned =
    subjectProgress.length > 0
      ? subjectProgress.reduce((sum, s) => sum + Math.max(0, s.assigned), 0)
      : Math.max(0, cycle.assigned_count);

  const liveCompleted =
    subjectProgress.length > 0
      ? subjectProgress.reduce((sum, s) => sum + Math.max(0, s.completed), 0)
      : Math.max(0, cycle.completed_count);

  let status = cycle.status as CoverageCycle["status"];
  let completedAt = cycle.completed_at;
  let activeAttemptId = cycle.active_attempt_id;
  let assignedCount = liveAssigned;

  if (
    status === "active" &&
    !hasInProgressActiveAttempt &&
    liveRemaining === 0 &&
    liveAssigned === 0
  ) {
    const nowIso = completedAt ?? new Date().toISOString();
    await supabase
      .from("coverage_cycles")
      .update({
        status: "completed",
        completed_at: nowIso,
        assigned_count: 0,
        active_attempt_id: null,
      })
      .eq("id", cycle.id)
      .eq("user_id", userId);

    status = "completed";
    completedAt = nowIso;
    activeAttemptId = null;
    assignedCount = 0;
  }

  const effectiveTotal = Math.max(0, liveCompleted + assignedCount + liveRemaining);
  const progressPercent =
    status === "completed"
      ? 100
      : effectiveTotal > 0
        ? Math.round((liveCompleted / effectiveTotal) * 10000) / 100
        : 0;

  return {
    status,
    completed_at: completedAt,
    assigned_count: assignedCount,
    active_attempt_id: activeAttemptId,
    remaining_count: liveRemaining,
    progress_percent: progressPercent,
  };
}

/**
 * Selects the next unassigned batch of questions for a coverage cycle respecting its
 * `allocation_strategy` and `questions_per_exam`, then issues the exam atomically via RPC.
 */
export async function issueNextExamForCycle(
  supabase: SupabaseClient<Database>,
  userId: string,
  cycle: CoverageCycle,
): Promise<ExamAttemptPayload & { cycle_id?: string; sequence_number?: number }> {
  if (cycle.active_attempt_id) {
    const { data: activeRow } = await supabase
      .from("exam_attempts")
      .select("id, status")
      .eq("id", cycle.active_attempt_id)
      .eq("user_id", userId)
      .maybeSingle();

    if (activeRow && activeRow.status === "in_progress") {
      throw new AppError(
        "ACTIVE_ATTEMPT_EXISTS",
        "An exam is already in progress for this coverage cycle. Resume or discard it before starting the next exam.",
        409,
        { active_attempt_id: activeRow.id },
      );
    }
  }

  const unassigned = await fetchAllPages(async (from, to) =>
    supabase
      .from("coverage_cycle_questions")
      .select("question_id, source_study_set_id, source_subject_title, pool_order")
      .eq("cycle_id", cycle.id)
      .eq("state", "unassigned")
      .not("question_id", "is", null)
      .order("pool_order", { ascending: true })
      .range(from, to),
  );

  if (unassigned.length === 0) {
    // V32-010 / FUNC-07: If all remaining questions were deleted mid-cycle, transition cycle to `completed`
    if (cycle.status === "active") {
      const { count: assignedCount } = await supabase
        .from("coverage_cycle_questions")
        .select("id", { count: "exact", head: true })
        .eq("cycle_id", cycle.id)
        .eq("state", "assigned");

      if ((assignedCount ?? 0) === 0) {
        await supabase
          .from("coverage_cycles")
          .update({
            status: "completed",
            completed_at: cycle.completed_at ?? new Date().toISOString(),
            assigned_count: 0,
            active_attempt_id: null,
          })
          .eq("id", cycle.id)
          .eq("user_id", userId);
      }
    }

    throw new AppError(
      "CYCLE_ALREADY_COMPLETED",
      "All questions in this coverage cycle have already been completed.",
      409,
    );
  }

  const batchSize = Math.min(cycle.questions_per_exam, unassigned.length);

  // Group remaining unassigned questions by source subject
  const bySubject = new Map<string, typeof unassigned>();
  const subjectTitleById = new Map<string, string>();
  for (const row of unassigned) {
    const sId = row.source_study_set_id ?? "unknown";
    subjectTitleById.set(sId, row.source_subject_title);
    const arr = bySubject.get(sId) ?? [];
    arr.push(row);
    bySubject.set(sId, arr);
  }

  const sourceSnapshotArr = Array.isArray(cycle.source_snapshot)
    ? cycle.source_snapshot
    : [];
  const snapshotMeta = new Map(
    sourceSnapshotArr.map((s) => [s.study_set_id, s]),
  );

  const strategy: AllocationStrategy = cycle.allocation_strategy;
  const subjectsList = Array.from(bySubject.entries())
    .map(([sId, items]) => {
      const snap = snapshotMeta.get(sId);
      return {
        study_set_id: sId,
        title: subjectTitleById.get(sId) ?? snap?.title ?? "Study Set",
        eligible_count: items.length,
        custom_count: snap?.custom_count ?? null,
        custom_percentage: snap?.custom_percentage ?? null,
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title));

  // For custom/weighted on later batches when remaining < custom sum, gracefully fall back to proportional
  const effectiveStrategy: AllocationStrategy =
    strategy === "custom" &&
    subjectsList.reduce((acc, s) => acc + (s.custom_count ?? 0), 0) !== batchSize
      ? "proportional"
      : strategy;

  const alloc = computeSubjectAllocations({
    subjects: subjectsList,
    requestedCount: batchSize,
    strategy: effectiveStrategy,
  });

  let picked: typeof unassigned = [];
  const actualCountBySet = new Map<string, number>();

  if (!alloc.valid || effectiveStrategy === "global_random") {
    picked = unassigned.slice(0, batchSize);
    for (const r of picked) {
      const sId = r.source_study_set_id ?? "unknown";
      actualCountBySet.set(sId, (actualCountBySet.get(sId) ?? 0) + 1);
    }
  } else {
    for (const slot of alloc.allocations) {
      if (slot.allocated_count <= 0) continue;
      const group = bySubject.get(slot.study_set_id) ?? [];
      const slice = group.slice(0, slot.allocated_count);
      picked.push(...slice);
      actualCountBySet.set(slot.study_set_id, slice.length);
    }
  }

  picked = cryptoShuffle(picked);

  const filterCfg = (cycle.filter_snapshot ?? {}) as Record<string, unknown>;
  const shuffleOptions = filterCfg.shuffle_options !== false;
  const durationLimitSeconds =
    typeof filterCfg.duration_limit_seconds === "number"
      ? filterCfg.duration_limit_seconds
      : null;
  const passThreshold =
    typeof filterCfg.pass_threshold === "number" ? filterCfg.pass_threshold : 70;
  const showSubjectNames = filterCfg.show_subject_names !== false;
  const showChapterNames = filterCfg.show_chapter_names !== false;
  const allowNavigation = filterCfg.allow_navigation !== false;
  const allowMarkForReview = filterCfg.allow_mark_for_review !== false;
  const autoSubmitOnExpire = filterCfg.auto_submit_on_expire !== false;
  const showReviewAfterSubmit = filterCfg.show_review_after_submit !== false;

  const pickedIds = picked
    .map((p) => p.question_id)
    .filter((id): id is string => Boolean(id));

  const optionOrderByQ = new Map<string, string[]>();
  if (shuffleOptions && pickedIds.length > 0) {
    const optRows = await fetchInChunks(
      pickedIds,
      async (chunk) =>
        supabase
          .from("question_options")
          .select("id, question_id, position")
          .in("question_id", chunk)
          .order("position", { ascending: true }),
      SAFE_IN_CHUNK_SIZE,
    );
    const grouped = new Map<string, string[]>();
    for (const o of optRows) {
      const arr = grouped.get(o.question_id) ?? [];
      arr.push(o.id);
      grouped.set(o.question_id, arr);
    }
    for (const [qId, optIds] of grouped.entries()) {
      optionOrderByQ.set(qId, cryptoShuffle(optIds));
    }
  }

  const selectedItems = pickedIds.map((qId) => ({
    question_id: qId,
    ...(optionOrderByQ.has(qId)
      ? { option_ids_order: optionOrderByQ.get(qId) }
      : {}),
  }));

  const sourcesPayload = subjectsList.map((s) => ({
    source_type: "study_set",
    study_set_id: s.study_set_id === "unknown" ? null : s.study_set_id,
    subject_title_snapshot: s.title,
    eligible_count: s.eligible_count,
    requested_count: null,
    requested_percentage: null,
    allocated_count: actualCountBySet.get(s.study_set_id) ?? 0,
  }));

  const { count: existingAttemptsCount } = await supabase
    .from("coverage_cycle_attempts")
    .select("id", { count: "exact", head: true })
    .eq("cycle_id", cycle.id);

  const nextNum = (existingAttemptsCount ?? 0) + 1;
  const titleSnapshot = `${cycle.title} — #${nextNum}`;

  const { data: issued, error: rpcErr } = await rpcIssueCoverageCycleNextExam(
    supabase,
    {
      p_cycle_id: cycle.id,
      p_selected_items: selectedItems,
      p_sources: sourcesPayload,
      p_title_snapshot: titleSnapshot,
      p_config: {
        ...filterCfg,
        shuffle_options: shuffleOptions,
        question_count: selectedItems.length,
        duration_limit_seconds: durationLimitSeconds,
        pass_threshold: passThreshold,
        allocation_strategy: cycle.allocation_strategy,
        coverage_cycle_id: cycle.id,
      },
      p_duration_limit_seconds: durationLimitSeconds,
      p_pass_threshold: passThreshold,
      p_show_subject_names: showSubjectNames,
      p_show_chapter_names: showChapterNames,
      p_allow_navigation: allowNavigation,
      p_allow_mark_for_review: allowMarkForReview,
      p_auto_submit_on_expire: autoSubmitOnExpire,
      p_show_review_after_submit: showReviewAfterSubmit,
    },
  );

  if (rpcErr) throw rpcErr;
  if (issued?.already_completed) {
    throw new AppError(
      "CYCLE_ALREADY_COMPLETED",
      "All questions in this coverage cycle have already been completed.",
      409,
    );
  }
  if (!issued) {
    throw new AppError(
      "INTERNAL_ERROR",
      "Failed to issue next coverage exam.",
      500,
    );
  }

  return {
    ...issued,
    questions: stripPreSubmitQuestions(issued.questions),
    answers: [],
  };
}
