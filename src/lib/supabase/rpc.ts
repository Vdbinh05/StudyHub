import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type {
  CoverageCycle,
  ExamAttempt,
  ExamAttemptAnswer,
  ExamAttemptSource,
  ExamChapterBreakdown,
  ExamEligiblePool,
  ExamSnapshotQuestion,
  ExamSubjectBreakdown,
  ExamTagBreakdown,
  PracticePoolResponse,
  Profile,
  SharePermission,
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
  data: (ExamAttemptPayload & { cycle_id?: string; sequence_number?: number }) | null;
  error: RpcError;
}> {
  const rpc = getDynamicRpc(supabase);
  const { data, error } = await rpc("issue_coverage_cycle_next_exam", params);
  return {
    data:
      (data as (ExamAttemptPayload & { cycle_id?: string; sequence_number?: number }) | null) ??
      null,
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
