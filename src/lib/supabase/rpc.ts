import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type {
  ConfidenceLevel,
  CoverageCycle,
  ExamAttempt,
  ExamAttemptAnswer,
  ExamAttemptSource,
  ExamChapterBreakdown,
  ExamEligiblePool,
  ExamSnapshotQuestion,
  ExamSubjectBreakdown,
  ExamTagBreakdown,
  GlobalSearchResponse,
  GlobalSearchResultType,
  LearningSyncEventInput,
  LearningSyncResponse,
  PracticePoolResponse,
  Profile,
  ProgressResetRequest,
  ProgressResetResult,
  SharePermission,
  StructuredAnswerResponse,
  StudySet,
  StudySetType,
} from "@/types/domain";

export interface ExamAttemptPayload {
  attempt: ExamAttempt;
  sources?: ExamAttemptSource[];
  questions: ExamSnapshotQuestion[];
  answers: ExamAttemptAnswer[];
  subject_breakdown?: ExamSubjectBreakdown[];
  chapter_breakdown?: ExamChapterBreakdown[];
  tag_breakdown?: ExamTagBreakdown[];
  coverage_cycle?: CoverageCycle | null;
  server_now?: string;
  remaining_seconds?: number | null;
}

export interface SaveExamAnswersRpcResult {
  saved: ExamAttemptAnswer[];
  stale_ignored_ids: string[];
  answered_count: number;
  server_now: string;
  remaining_seconds: number | null;
}

export interface ShareLinkPreview {
  link_id: string;
  study_set_id: string;
  title: string;
  description: string | null;
  subject: string | null;
  set_type: StudySetType;
  question_count: number;
  owner_name: string;
  permission: SharePermission;
  allow_clone: boolean;
  expires_at: string | null;
}

export interface RedeemShareLinkResult {
  error_code?: "NOT_FOUND" | "REVOKED" | "EXPIRED";
  study_set_id?: string;
  title?: string;
  role?: "owner" | "editor" | "viewer";
  allow_clone?: boolean;
}

export interface DedupedStudySetRow {
  study_set_id: string;
  title: string;
  subject: string | null;
  question_count: number;
}

type RpcError = { code?: string; message: string } | null;

type DynamicRpcFn = (
  fn: string,
  params?: Record<string, unknown>,
) => Promise<{ data: unknown; error: RpcError }>;

function getDynamicRpc(supabase: SupabaseClient<Database>): DynamicRpcFn {
  return (supabase.rpc as unknown as DynamicRpcFn).bind(supabase);
}

export async function rpcGetMyProfile(
  supabase: SupabaseClient<Database>,
): Promise<{ data: Profile | null; error: RpcError }> {
  const rpc = getDynamicRpc(supabase);
  const { data, error } = await rpc("get_my_profile");
  return { data: (data as Profile | null) ?? null, error };
}

export async function rpcResolveDedupedStudySets(
  supabase: SupabaseClient<Database>,
  params: {
    p_folder_ids: string[];
    p_study_set_ids: string[];
    p_include_subfolders?: boolean;
  },
): Promise<{ data: DedupedStudySetRow[]; error: RpcError }> {
  const rpc = getDynamicRpc(supabase);
  const { data, error } = await rpc("resolve_deduped_study_sets", params);
  return {
    data: Array.isArray(data) ? (data as DedupedStudySetRow[]) : [],
    error,
  };
}

export async function rpcGetExamEligiblePool(
  supabase: SupabaseClient<Database>,
  params: {
    p_folder_ids: string[];
    p_study_set_ids: string[];
    p_include_subfolders?: boolean;
    p_filters?: Record<string, unknown>;
    p_selection_policy?: string;
  },
): Promise<{ data: Omit<ExamEligiblePool, "overlap_sets_removed"> | null; error: RpcError }> {
  const rpc = getDynamicRpc(supabase);
  const { data, error } = await rpc("get_exam_eligible_pool", params);
  return {
    data: (data as Omit<ExamEligiblePool, "overlap_sets_removed"> | null) ?? null,
    error,
  };
}

export async function rpcCreateExamAttemptV2(
  supabase: SupabaseClient<Database>,
  params: {
    p_title_snapshot: string;
    p_primary_study_set_id: string | null;
    p_sources: Array<Record<string, unknown>>;
    p_selected_items: Array<{ question_id: string; option_ids_order?: string[] }>;
    p_config: Record<string, unknown>;
    p_duration_limit_seconds: number | null;
    p_pass_threshold: number;
    p_allocation_strategy?: string;
    p_selection_policy?: string;
    p_requested_question_count?: number | null;
    p_show_subject_names?: boolean;
    p_show_chapter_names?: boolean;
    p_allow_navigation?: boolean;
    p_allow_mark_for_review?: boolean;
    p_auto_submit_on_expire?: boolean;
    p_show_review_after_submit?: boolean;
    p_preset_id?: string | null;
    p_coverage_cycle_id?: string | null;
  },
): Promise<{ data: ExamAttemptPayload | null; error: RpcError }> {
  const rpc = getDynamicRpc(supabase);
  const { data, error } = await rpc("create_exam_attempt_v2", params);
  return {
    data: (data as ExamAttemptPayload | null) ?? null,
    error,
  };
}

export async function rpcSaveExamAttemptAnswers(
  supabase: SupabaseClient<Database>,
  attemptId: string,
  answers: Array<{
    attempt_question_id: string;
    selected_option_ids: string[];
    typed_answer?: string | null;
    structured_response?: StructuredAnswerResponse | null;
    confidence?: ConfidenceLevel | null;
    hint_used?: boolean;
    is_flagged?: boolean;
    client_seq?: number;
  }>,
): Promise<{ data: SaveExamAnswersRpcResult | null; error: RpcError }> {
  const rpc = getDynamicRpc(supabase);
  const { data, error } = await rpc("save_exam_attempt_answers", {
    p_attempt_id: attemptId,
    p_answers: answers,
  });
  return {
    data: (data as SaveExamAnswersRpcResult | null) ?? null,
    error,
  };
}

export async function rpcSubmitExamAttempt(
  supabase: SupabaseClient<Database>,
  attemptId: string,
): Promise<{ data: ExamAttemptPayload | null; error: RpcError }> {
  const rpc = getDynamicRpc(supabase);
  const { data, error } = await rpc("submit_exam_attempt", {
    p_attempt_id: attemptId,
  });
  return {
    data: (data as ExamAttemptPayload | null) ?? null,
    error,
  };
}

export async function rpcGetExamAttemptDetail(
  supabase: SupabaseClient<Database>,
  attemptId: string,
): Promise<{ data: ExamAttemptPayload | null; error: RpcError }> {
  const rpc = getDynamicRpc(supabase);
  const { data, error } = await rpc("get_exam_attempt_detail", {
    p_attempt_id: attemptId,
  });
  return {
    data: (data as ExamAttemptPayload | null) ?? null,
    error,
  };
}

export async function rpcCreateCoverageCycle(
  supabase: SupabaseClient<Database>,
  params: {
    p_title: string;
    p_source_snapshot: Array<Record<string, unknown>>;
    p_filter_snapshot: Record<string, unknown>;
    p_allocation_strategy: string;
    p_questions_per_exam: number;
    p_pool_items: Array<{ question_id: string }>;
    p_preset_id?: string | null;
  },
): Promise<{ data: CoverageCycle | null; error: RpcError }> {
  const rpc = getDynamicRpc(supabase);
  const { data, error } = await rpc("create_coverage_cycle", params);
  return { data: (data as CoverageCycle | null) ?? null, error };
}

export async function rpcIssueCoverageCycleNextExam(
  supabase: SupabaseClient<Database>,
  params: {
    p_cycle_id: string;
    p_selected_items: Array<{ question_id: string; option_ids_order?: string[] }>;
    p_sources: Array<Record<string, unknown>>;
    p_title_snapshot: string;
    p_config: Record<string, unknown>;
    p_duration_limit_seconds: number | null;
    p_pass_threshold: number;
    p_show_subject_names?: boolean;
    p_show_chapter_names?: boolean;
    p_allow_navigation?: boolean;
    p_allow_mark_for_review?: boolean;
    p_auto_submit_on_expire?: boolean;
    p_show_review_after_submit?: boolean;
  },
): Promise<{
  data: (ExamAttemptPayload & {
    cycle_id?: string;
    sequence_number?: number;
    already_completed?: boolean;
    status?: string;
  }) | null;
  error: RpcError;
}> {
  const rpc = getDynamicRpc(supabase);
  const { data, error } = await rpc("issue_coverage_cycle_next_exam", params);
  return {
    data:
      (data as (ExamAttemptPayload & {
        cycle_id?: string;
        sequence_number?: number;
        already_completed?: boolean;
        status?: string;
      }) | null) ?? null,
    error,
  };
}

export async function rpcDiscardCoverageCycleActiveExam(
  supabase: SupabaseClient<Database>,
  cycleId: string,
): Promise<{
  data: {
    cycle: CoverageCycle;
    discarded_attempt_id: string | null;
    reverted_questions: number;
  } | null;
  error: RpcError;
}> {
  const rpc = getDynamicRpc(supabase);
  const { data, error } = await rpc("discard_coverage_cycle_active_exam", {
    p_cycle_id: cycleId,
  });
  return {
    data:
      (data as {
        cycle: CoverageCycle;
        discarded_attempt_id: string | null;
        reverted_questions: number;
      } | null) ?? null,
    error,
  };
}

export async function rpcRestartCoverageCycle(
  supabase: SupabaseClient<Database>,
  params: {
    p_cycle_id: string;
    p_new_pool_items?: Array<{ question_id: string }> | null;
    p_force_discard_active?: boolean;
  },
): Promise<{ data: CoverageCycle | null; error: RpcError }> {
  const rpc = getDynamicRpc(supabase);
  const { data, error } = await rpc("restart_coverage_cycle", params);
  return { data: (data as CoverageCycle | null) ?? null, error };
}

export interface CoverageCycleSubjectProgressRow {
  cycle_id: string;
  study_set_id: string | null;
  subject_title: string;
  total: number;
  completed: number;
  assigned: number;
  remaining: number;
}

export async function rpcGetCoverageCycleSubjectProgress(
  supabase: SupabaseClient<Database>,
  cycleIds: string[],
): Promise<{ data: CoverageCycleSubjectProgressRow[]; error: RpcError }> {
  if (cycleIds.length === 0) {
    return { data: [], error: null };
  }
  const rpc = getDynamicRpc(supabase);
  const { data, error } = await rpc("get_coverage_cycle_subject_progress", {
    p_cycle_ids: cycleIds,
  });
  return {
    data: Array.isArray(data) ? (data as CoverageCycleSubjectProgressRow[]) : [],
    error,
  };
}

export async function rpcCloneStudySet(
  supabase: SupabaseClient<Database>,
  params: {
    p_source_set_id: string;
    p_title?: string | null;
    p_folder_id?: string | null;
  },
): Promise<{
  data: { study_set: StudySet; copied_questions: number } | null;
  error: RpcError;
}> {
  const rpc = getDynamicRpc(supabase);
  const { data, error } = await rpc("clone_study_set", params);
  return {
    data: (data as { study_set: StudySet; copied_questions: number } | null) ?? null,
    error,
  };
}

export async function rpcGetPracticeQuestionPool(
  supabase: SupabaseClient<Database>,
  params: {
    p_folder_ids: string[];
    p_study_set_ids: string[];
    p_include_subfolders?: boolean;
    p_filters?: Record<string, unknown>;
    p_selection_policy?: string;
    p_count?: number | null;
    p_shuffle?: boolean;
  },
): Promise<{
  data: Omit<PracticePoolResponse, "session"> | null;
  error: RpcError;
}> {
  const rpc = getDynamicRpc(supabase);
  const { data, error } = await rpc("get_practice_question_pool", params);
  return {
    data: (data as Omit<PracticePoolResponse, "session"> | null) ?? null,
    error,
  };
}

export async function rpcPreviewShareLink(
  supabase: SupabaseClient<Database>,
  token: string,
): Promise<{ data: ShareLinkPreview | null; error: RpcError }> {
  const rpc = getDynamicRpc(supabase);
  const { data, error } = await rpc("preview_share_link", {
    p_token: token,
  });
  return {
    data: (data as ShareLinkPreview | null) ?? null,
    error,
  };
}

export async function rpcRedeemShareLink(
  supabase: SupabaseClient<Database>,
  token: string,
): Promise<{ data: RedeemShareLinkResult | null; error: RpcError }> {
  const rpc = getDynamicRpc(supabase);
  const { data, error } = await rpc("redeem_share_link", {
    p_token: token,
  });
  return {
    data: (data as RedeemShareLinkResult | null) ?? null,
    error,
  };
}

export async function rpcResetLearningProgress(
  supabase: SupabaseClient<Database>,
  params: Omit<ProgressResetRequest, "confirm">,
): Promise<{ data: ProgressResetResult | null; error: RpcError }> {
  const rpc = getDynamicRpc(supabase);
  const { data, error } = await rpc("reset_learning_progress", {
    p_scope: params.scope,
    p_study_set_id: params.study_set_id ?? null,
    p_subject: params.subject ?? null,
    p_chapter: params.chapter ?? null,
    p_question_ids: params.question_ids ?? null,
    p_mode: params.mode ?? null,
    p_clear_mistakes: params.clear_mistakes ?? true,
    p_clear_starred: params.clear_starred ?? false,
    p_clear_checkpoints: params.clear_checkpoints ?? true,
  });
  return {
    data: (data as ProgressResetResult | null) ?? null,
    error,
  };
}

export async function rpcGlobalLibrarySearch(
  supabase: SupabaseClient<Database>,
  params: {
    query: string;
    types?: GlobalSearchResultType[];
    limit?: number;
    offset?: number;
  },
): Promise<{ data: GlobalSearchResponse | null; error: RpcError }> {
  const rpc = getDynamicRpc(supabase);
  const { data, error } = await rpc("global_library_search", {
    p_query: params.query,
    p_types: params.types && params.types.length > 0 ? params.types : null,
    p_limit: params.limit ?? 30,
    p_offset: params.offset ?? 0,
  });
  return {
    data: (data as GlobalSearchResponse | null) ?? null,
    error,
  };
}

export async function rpcSyncOfflineLearningEvents(
  supabase: SupabaseClient<Database>,
  events: LearningSyncEventInput[],
): Promise<{ data: LearningSyncResponse | null; error: RpcError }> {
  const rpc = getDynamicRpc(supabase);
  const { data, error } = await rpc("sync_offline_learning_events", {
    p_events: events,
  });
  return {
    data: (data as LearningSyncResponse | null) ?? null,
    error,
  };
}

/**
 * Detects whether a Supabase RPC error indicates a not-yet-applied migration function
 * (`42883` undefined_function or PostgREST `PGRST202` schema cache miss) so routes can
 * gracefully fall back during rolling deployments.
 */
export function isMissingRpcError(error: RpcError | null | undefined): boolean {
  if (!error) return false;
  return (
    error.code === "42883" ||
    error.code === "PGRST202" ||
    error.message.includes("Could not find the function")
  );
}

export async function rpcGetDashboardSummary(
  supabase: SupabaseClient<Database>,
): Promise<{ data: Record<string, unknown> | null; error: RpcError }> {
  const rpc = getDynamicRpc(supabase);
  const { data, error } = await rpc("get_dashboard_summary");
  return {
    data:
      data && typeof data === "object"
        ? (data as Record<string, unknown>)
        : null,
    error,
  };
}

export async function rpcGetStudySetSummary(
  supabase: SupabaseClient<Database>,
  setId: string,
): Promise<{ data: Record<string, unknown> | null; error: RpcError }> {
  const rpc = getDynamicRpc(supabase);
  const { data, error } = await rpc("get_study_set_summary", {
    p_set_id: setId,
  });
  return {
    data:
      data && typeof data === "object"
        ? (data as Record<string, unknown>)
        : null,
    error,
  };
}

export async function rpcRecordStudySessionAnswer(
  supabase: SupabaseClient<Database>,
  params: {
    p_session_id: string;
    p_question_id: string;
    p_selected_option_ids: string[];
    p_typed_answer: string | null;
    p_structured_response: StructuredAnswerResponse | null;
    p_is_correct: boolean | null;
    p_self_rating: string | null;
    p_confidence: ConfidenceLevel | null;
    p_hint_used: boolean;
    p_response_time_ms: number | null;
    p_update_progress: boolean;
  },
): Promise<{
  data: {
    answer: Record<string, unknown>;
    is_correct: boolean;
    progress: Record<string, unknown> | null;
  } | null;
  error: RpcError;
}> {
  const rpc = getDynamicRpc(supabase);
  const { data, error } = await rpc("record_study_session_answer", params);
  return {
    data:
      data && typeof data === "object"
        ? (data as {
            answer: Record<string, unknown>;
            is_correct: boolean;
            progress: Record<string, unknown> | null;
          })
        : null,
    error,
  };
}

export async function rpcToggleStarredQuestion(
  supabase: SupabaseClient<Database>,
  params: { p_question_id: string; p_study_set_id?: string | null },
): Promise<{
  data: { starred: boolean; question_id: string } | null;
  error: RpcError;
}> {
  const rpc = getDynamicRpc(supabase);
  const { data, error } = await rpc("toggle_starred_question", params);
  return {
    data:
      data && typeof data === "object"
        ? (data as { starred: boolean; question_id: string })
        : null,
    error,
  };
}

export async function rpcRecordProgressAnswer(
  supabase: SupabaseClient<Database>,
  params: {
    p_question_id: string;
    p_study_set_id?: string | null;
    p_is_correct: boolean;
    p_self_rating?: string | null;
    p_confidence?: ConfidenceLevel | null;
    p_hint_used?: boolean;
    p_mode?: string | null;
    p_response_time_ms?: number | null;
    p_override_mastery_level?: string | null;
    p_override_mistake_status?: string | null;
    p_override_ease_factor?: number | null;
    p_override_interval_days?: number | null;
    p_override_repetitions?: number | null;
    p_override_next_review_at?: string | null;
    p_has_override_next_review_at?: boolean;
  },
): Promise<{ data: Record<string, unknown> | null; error: RpcError }> {
  const rpc = getDynamicRpc(supabase);
  const { data, error } = await rpc("record_progress_answer", params);
  return {
    data:
      data && typeof data === "object"
        ? (data as Record<string, unknown>)
        : null,
    error,
  };
}

export async function rpcBumpStudySetContentVersion(
  supabase: SupabaseClient<Database>,
  setId: string,
): Promise<{ data: number | null; error: RpcError }> {
  const rpc = getDynamicRpc(supabase);
  const { data, error } = await rpc("bump_study_set_content_version", {
    p_set_id: setId,
  });
  return {
    data: typeof data === "number" ? data : null,
    error,
  };
}

export async function rpcAllocateQuestionPosition(
  supabase: SupabaseClient<Database>,
  setId: string,
): Promise<{ data: number | null; error: RpcError }> {
  const rpc = getDynamicRpc(supabase);
  const { data, error } = await rpc("allocate_question_position", {
    p_set_id: setId,
  });
  return {
    data: typeof data === "number" ? data : null,
    error,
  };
}

export async function rpcPatchUserPreferences(
  supabase: SupabaseClient<Database>,
  patch: Record<string, unknown>,
): Promise<{ data: Record<string, unknown> | null; error: RpcError }> {
  const rpc = getDynamicRpc(supabase);
  const { data, error } = await rpc("patch_user_preferences", {
    p_patch: patch,
  });
  return {
    data:
      data && typeof data === "object"
        ? (data as Record<string, unknown>)
        : null,
    error,
  };
}

export async function rpcSaveDiagramPatch(
  supabase: SupabaseClient<Database>,
  params: {
    p_diagram_id: string;
    p_patch: Record<string, unknown>;
    p_hotspots?: Array<Record<string, unknown>> | null;
    p_replace_hotspots?: boolean;
  },
): Promise<{ data: { diagram: Record<string, unknown> } | null; error: RpcError }> {
  const rpc = getDynamicRpc(supabase);
  const { data, error } = await rpc("save_diagram_patch", params);
  return {
    data:
      data && typeof data === "object"
        ? (data as { diagram: Record<string, unknown> })
        : null,
    error,
  };
}

export async function rpcListAccessibleStudySets(
  supabase: SupabaseClient<Database>,
  params: {
    p_scope: string;
    p_search?: string | null;
    p_folder_id?: string | null;
    p_set_type?: string | null;
    p_visibility?: string | null;
    p_include_archived?: boolean;
    p_favorites_only?: boolean;
    p_sort?: string;
    p_page?: number;
    p_page_size?: number;
  },
): Promise<{
  data: { items: Array<Record<string, unknown>>; total: number } | null;
  error: RpcError;
}> {
  const rpc = getDynamicRpc(supabase);
  const { data, error } = await rpc("list_accessible_study_sets", params);
  return {
    data:
      data && typeof data === "object"
        ? (data as { items: Array<Record<string, unknown>>; total: number })
        : null,
    error,
  };
}

export async function rpcGetStudySetQuestionsPage(
  supabase: SupabaseClient<Database>,
  params: {
    p_set_id: string;
    p_fields?: string;
    p_chapter?: string | null;
    p_difficulty?: string | null;
    p_question_type?: string | null;
    p_search?: string | null;
    p_starred_only?: boolean;
    p_tag_id?: string | null;
    p_page?: number;
    p_page_size?: number;
  },
): Promise<{
  data: { items: Array<Record<string, unknown>>; total: number } | null;
  error: RpcError;
}> {
  const rpc = getDynamicRpc(supabase);
  const { data, error } = await rpc("get_study_set_questions_page", params);
  return {
    data:
      data && typeof data === "object"
        ? (data as { items: Array<Record<string, unknown>>; total: number })
        : null,
    error,
  };
}

export async function rpcGetUserStatisticsSummary(
  supabase: SupabaseClient<Database>,
  days: number,
): Promise<{ data: Record<string, unknown> | null; error: RpcError }> {
  const rpc = getDynamicRpc(supabase);
  const { data, error } = await rpc("get_user_statistics_summary", {
    p_days: days,
  });
  return {
    data:
      data && typeof data === "object"
        ? (data as Record<string, unknown>)
        : null,
    error,
  };
}

export async function rpcGetUserMistakesPage(
  supabase: SupabaseClient<Database>,
  params: {
    p_study_set_id?: string | null;
    p_subject?: string | null;
    p_chapter?: string | null;
    p_tag_id?: string | null;
    p_question_type?: string | null;
    p_days?: number | null;
    p_min_wrong_count?: number;
    p_min_consecutive_wrong?: number | null;
    p_exam_attempt_id?: string | null;
    p_recent_exam_only?: boolean;
    p_confidence?: string | null;
    p_low_confidence?: boolean;
    p_high_conf_wrong?: boolean;
    p_guess_correct?: boolean;
    p_due_only?: boolean;
    p_starred_only?: boolean;
    p_mastery_level?: string | null;
    p_effective_tab?: string | null;
    p_include_resolved?: boolean;
    p_sort?: string;
    p_page?: number;
    p_page_size?: number;
  },
): Promise<{
  data: { items: Array<Record<string, unknown>>; total: number } | null;
  error: RpcError;
}> {
  const rpc = getDynamicRpc(supabase);
  const { data, error } = await rpc("get_user_mistakes_page", params);
  return {
    data:
      data && typeof data === "object"
        ? (data as { items: Array<Record<string, unknown>>; total: number })
        : null,
    error,
  };
}
