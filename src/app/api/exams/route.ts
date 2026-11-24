import { NextResponse, type NextRequest } from "next/server";
import { requireAuth, requireStudySetAccess } from "@/lib/security/authz";
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
  computeSubjectAllocations,
  cryptoShuffle,
  extractSourceIds,
  fetchEligibleCandidates,
  selectQuestionsByPolicy,
  stripPreSubmitQuestions,
} from "@/lib/supabase/exam-engine";
import { fetchInChunks, SAFE_IN_CHUNK_SIZE } from "@/lib/supabase/query-helpers";
import { rpcCreateExamAttemptV2 } from "@/lib/supabase/rpc";
import { createExamSchema, listExamsQuerySchema } from "@/lib/validation/exams";
import type {
  ExamFilterConfig,
  ExamSourceInput,
  SelectionPolicy,
} from "@/types/domain";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const rawParams = Object.fromEntries(request.nextUrl.searchParams.entries());
    const query = listExamsQuerySchema.parse(rawParams);

    const from = (query.page - 1) * query.pageSize;
    const to = from + query.pageSize - 1;

    let dbQuery = supabase
      .from("exam_attempts")
      .select("*", { count: "exact" })
      .eq("user_id", user.id);

    if (query.studySetId) {
      dbQuery = dbQuery.eq("study_set_id", query.studySetId);
    }
    if (query.status) {
      dbQuery = dbQuery.eq("status", query.status);
    }

    const { data, count, error } = await dbQuery
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) throw error;

    const rows = data ?? [];
    const total = count ?? rows.length;

    return apiSuccess(rows, {
      total,
      page: query.page,
      pageSize: query.pageSize,
      hasMore: from + rows.length < total,
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
    const input = createExamSchema.parse(body);

    // Resolve sources (supports V1 study_set_id + additional_study_set_ids OR V2 sources[])
    const normalizedSources: ExamSourceInput[] = [];
    if (input.sources && input.sources.length > 0) {
      normalizedSources.push(...input.sources);
    } else {
      if (input.study_set_id) {
        normalizedSources.push({
          source_type: "study_set",
          id: input.study_set_id,
          include_subfolders: true,
        });
      }
      for (const extraId of input.additional_study_set_ids ?? []) {
        normalizedSources.push({
          source_type: "study_set",
          id: extraId,
          include_subfolders: true,
        });
      }
    }

    // Merge V1 top-level filters & V2 nested `filters`
    const filters: ExamFilterConfig = {
      chapters: input.filters?.chapters ?? input.chapters,
      tag_ids: input.filters?.tag_ids ?? input.tag_ids,
      difficulties: input.filters?.difficulties ?? input.difficulties,
      question_types: input.filters?.question_types ?? input.question_types,
    };

    // Map V1 boolean toggles onto canonical V2 SelectionPolicy if selection_policy wasn't set
    const selectionPolicy: SelectionPolicy =
      input.selection_policy ??
      (input.only_starred
        ? "starred_only"
        : input.only_mistakes
          ? "incorrect_only"
          : "random");

    const {
      folderIds,
      studySetIds,
      includeSubfolders,
      customCountsBySet,
      customPercentagesBySet,
    } = extractSourceIds(normalizedSources);

    // V3.1 P1-4: Parallelize primaryStudySet access check with candidate resolution
    const [primaryAccess, eligibleResult] = await Promise.all([
      input.study_set_id
        ? requireStudySetAccess(supabase, input.study_set_id, user.id, "read")
        : Promise.resolve(null),
      fetchEligibleCandidates({
        supabase,
        userId: user.id,
        folderIds,
        studySetIds,
        includeSubfolders,
        filters,
        selectionPolicy,
        explicitQuestionIds: input.question_ids,
        requireProgress: Boolean(input.only_unmastered),
      }),
    ]);

    const primaryStudySet = primaryAccess?.studySet ?? null;
    const { dedupedSets, candidates: initialCandidates, recentQuestionIds } =
      eligibleResult;

    let candidates = initialCandidates;
    if (input.only_unmastered) {
      candidates = candidates.filter((c) => c.mastery_level !== "mastered");
    }

    if (candidates.length === 0) {
      throw new AppError(
        "BAD_REQUEST",
        "No exam-eligible questions matched the selected sources and filters.",
        400,
      );
    }

    // Group candidates by subject (`study_set_id`)
    const bySubject = new Map<string, typeof candidates>();
    for (const c of candidates) {
      const arr = bySubject.get(c.study_set_id) ?? [];
      arr.push(c);
      bySubject.set(c.study_set_id, arr);
    }

    // Build subject metadata list (includes sets discovered from explicit question_ids)
    const setMetaMap = new Map(dedupedSets.map((s) => [s.study_set_id, s]));
    const missingSetIds = Array.from(bySubject.keys()).filter(
      (id) => !setMetaMap.has(id),
    );
    if (missingSetIds.length > 0) {
      const extraSets = await fetchInChunks(
        missingSetIds,
        async (chunk) =>
          supabase.from("study_sets").select("id, title, subject").in("id", chunk),
        SAFE_IN_CHUNK_SIZE,
      );
      for (const s of extraSets) {
        setMetaMap.set(s.id, {
          study_set_id: s.id,
          title: s.title,
          subject: s.subject,
        });
      }
    }

    const orderedSubjects = Array.from(bySubject.keys())
      .map((id) => {
        const meta = setMetaMap.get(id);
        return {
          study_set_id: id,
          title: meta?.title ?? "Study Set",
          eligible_count: bySubject.get(id)?.length ?? 0,
          custom_count: customCountsBySet.get(id) ?? null,
          custom_percentage: customPercentagesBySet.get(id) ?? null,
        };
      })
      .sort((a, b) => a.title.localeCompare(b.title));

    const isV2Request = Boolean(input.sources && input.sources.length > 0);
    const requestedCount =
      input.requested_question_count ??
      input.question_count ??
      (isV2Request ? candidates.length : Math.min(30, candidates.length));

    // In V2 mode, NEVER silently reduce requestedCount > available!
    // In V1 mode with explicit question_ids, honor exact pool length.
    const effectiveRequestedCount = isV2Request
      ? requestedCount
      : Math.min(requestedCount, candidates.length);

    const allocation = computeSubjectAllocations({
      subjects: orderedSubjects,
      requestedCount: effectiveRequestedCount,
      strategy: input.allocation_strategy,
    });

    if (!allocation.valid) {
      throw new AppError(
        "VALIDATION_ERROR",
        allocation.errors[0]?.message ?? "Invalid exam allocation configuration.",
        400,
        allocation.errors,
      );
    }

    // Sample questions strictly without replacement
    let chosen: typeof candidates = [];
    const actualCountBySet = new Map<string, number>();

    if (input.allocation_strategy === "global_random") {
      const { selected } = selectQuestionsByPolicy(
        candidates,
        allocation.actualCount,
        selectionPolicy,
        recentQuestionIds,
      );
      chosen = selected;
      for (const q of chosen) {
        actualCountBySet.set(
          q.study_set_id,
          (actualCountBySet.get(q.study_set_id) ?? 0) + 1,
        );
      }
    } else {
      for (const slot of allocation.allocations) {
        if (slot.allocated_count <= 0) continue;
        const subjectPool = bySubject.get(slot.study_set_id) ?? [];
        const { selected } = selectQuestionsByPolicy(
          subjectPool,
          slot.allocated_count,
          selectionPolicy,
          recentQuestionIds,
        );
        chosen.push(...selected);
        actualCountBySet.set(slot.study_set_id, selected.length);
      }
    }

    if (input.shuffle_questions) {
      chosen = cryptoShuffle(chosen);
    }

    if (chosen.length === 0) {
      throw new AppError(
        "BAD_REQUEST",
        "No questions could be selected for this exam.",
        400,
      );
    }

    // If shuffle_options is ON, compute cryptographic option UUID orders in chunks (<= 100 Qs)
    // Actual option text & is_correct are resolved EXCLUSIVELY inside PostgreSQL (SH-013 / SEC-004)!
    const selectedIds = chosen.map((c) => c.id);
    const optionOrderByQ = new Map<string, string[]>();

    if (input.shuffle_options) {
      const optRows = await fetchInChunks(
        selectedIds,
        async (chunk) =>
          supabase
            .from("question_options")
            .select("id, question_id, position")
            .in("question_id", chunk)
            .order("position", { ascending: true }),
        SAFE_IN_CHUNK_SIZE,
      );

      const grouped = new Map<string, string[]>();
      for (const row of optRows) {
        const arr = grouped.get(row.question_id) ?? [];
        arr.push(row.id);
        grouped.set(row.question_id, arr);
      }

      for (const [qId, optIds] of grouped.entries()) {
        optionOrderByQ.set(qId, cryptoShuffle(optIds));
      }
    }

    const selectedItemsPayload = chosen.map((q) => ({
      question_id: q.id,
      ...(optionOrderByQ.has(q.id)
        ? { option_ids_order: optionOrderByQ.get(q.id) }
        : {}),
    }));

    const sourcesPayload = orderedSubjects.map((s) => {
      const alloc = allocation.allocations.find(
        (a) => a.study_set_id === s.study_set_id,
      );
      return {
        source_type: "study_set",
        study_set_id: s.study_set_id,
        subject_title_snapshot: s.title,
        eligible_count: s.eligible_count,
        requested_count: alloc?.requested_count ?? null,
        requested_percentage: alloc?.requested_percentage ?? null,
        allocated_count: actualCountBySet.get(s.study_set_id) ?? 0,
      };
    });

    // Preserve explicit `null` for unlimited time! Only inherit V1 default when omitted on single-set V1 calls.
    const durationLimitSeconds =
      input.duration_limit_seconds !== undefined
        ? input.duration_limit_seconds
        : !isV2Request && primaryStudySet
          ? primaryStudySet.default_exam_duration_minutes * 60
          : null;

    const passThreshold =
      input.pass_threshold ?? primaryStudySet?.default_pass_threshold ?? 70;

    const titleSnapshot =
      input.title ??
      (orderedSubjects.length === 1
        ? orderedSubjects[0].title
        : primaryStudySet
          ? `${primaryStudySet.title} (+${orderedSubjects.length - 1})`
          : `Custom Exam (${orderedSubjects.length} subjects)`);

    const examConfig = {
      question_count: chosen.length,
      duration_limit_seconds: durationLimitSeconds,
      shuffle_questions: input.shuffle_questions,
      shuffle_options: input.shuffle_options,
      pass_threshold: passThreshold,
      chapters: filters.chapters,
      tag_ids: filters.tag_ids,
      difficulties: filters.difficulties,
      question_types: filters.question_types,
      only_starred: input.only_starred,
      only_unmastered: input.only_unmastered,
      only_mistakes: input.only_mistakes,
      allocation_strategy: input.allocation_strategy,
      selection_policy: selectionPolicy,
      show_subject_names: input.show_subject_names,
      show_chapter_names: input.show_chapter_names,
      allow_navigation: input.allow_navigation,
      allow_mark_for_review: input.allow_mark_for_review,
      auto_submit_on_expire: input.auto_submit_on_expire,
      show_review_after_submit: input.show_review_after_submit,
      additional_study_set_ids: input.additional_study_set_ids,
      sources: normalizedSources,
      preset_id: input.preset_id ?? null,
    };

    const { data: created, error: rpcErr } = await rpcCreateExamAttemptV2(
      supabase,
      {
        p_title_snapshot: titleSnapshot,
        p_primary_study_set_id:
          orderedSubjects.length === 1 ? orderedSubjects[0].study_set_id : null,
        p_sources: sourcesPayload,
        p_selected_items: selectedItemsPayload,
        p_config: examConfig,
        p_duration_limit_seconds: durationLimitSeconds,
        p_pass_threshold: passThreshold,
        p_allocation_strategy: input.allocation_strategy,
        p_selection_policy: selectionPolicy,
        p_requested_question_count: requestedCount,
        p_show_subject_names: input.show_subject_names,
        p_show_chapter_names: input.show_chapter_names,
        p_allow_navigation: input.allow_navigation,
        p_allow_mark_for_review: input.allow_mark_for_review,
        p_auto_submit_on_expire: input.auto_submit_on_expire,
        p_show_review_after_submit: input.show_review_after_submit,
        p_preset_id: input.preset_id ?? null,
        p_coverage_cycle_id: null,
      },
    );

    if (rpcErr) throw rpcErr;
    if (!created) {
      throw new AppError("INTERNAL_ERROR", "Failed to create exam attempt.", 500);
    }

    const serverNow = created.server_now ?? new Date().toISOString();
    const remainingSeconds =
      created.remaining_seconds !== undefined
        ? created.remaining_seconds
        : created.attempt.expires_at
          ? Math.max(
              0,
              Math.floor(
                (Date.parse(created.attempt.expires_at) - Date.parse(serverNow)) /
                  1000,
              ),
            )
          : null;

    return apiSuccess(
      {
        attempt: created.attempt,
        sources: created.sources ?? [],
        questions: stripPreSubmitQuestions(created.questions),
        answers: [],
        server_now: serverNow,
        remaining_seconds: remainingSeconds,
      },
      undefined,
      { status: 201 },
    );
  } catch (err) {
    return handleApiError(err);
  }
}
