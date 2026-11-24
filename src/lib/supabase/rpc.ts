import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type {
  ExamAttempt,
  ExamAttemptAnswer,
  ExamSnapshotQuestion,
  SharePermission,
  StudySetType,
} from "@/types/domain";

export interface ExamAttemptPayload {
  attempt: ExamAttempt;
  questions: ExamSnapshotQuestion[];
  answers: ExamAttemptAnswer[];
  server_now?: string;
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

type DynamicRpcFn = (
  fn: string,
  params?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { code?: string; message: string } | null }>;

function getDynamicRpc(supabase: SupabaseClient<Database>): DynamicRpcFn {
  return (supabase.rpc as unknown as DynamicRpcFn).bind(supabase);
}

export async function rpcCreateExamAttempt(
  supabase: SupabaseClient<Database>,
  params: {
    p_study_set_id: string;
    p_title_snapshot: string;
    p_config: Record<string, unknown>;
    p_duration_limit_seconds: number | null;
    p_pass_threshold: number;
    p_questions: Array<Record<string, unknown>>;
  },
): Promise<{ data: ExamAttemptPayload | null; error: { code?: string; message: string } | null }> {
  const rpc = getDynamicRpc(supabase);
  const { data, error } = await rpc("create_exam_attempt", params);
  return {
    data: (data as ExamAttemptPayload | null) ?? null,
    error,
  };
}

export async function rpcGetExamAttemptDetail(
  supabase: SupabaseClient<Database>,
  attemptId: string,
): Promise<{ data: ExamAttemptPayload | null; error: { code?: string; message: string } | null }> {
  const rpc = getDynamicRpc(supabase);
  const { data, error } = await rpc("get_exam_attempt_detail", {
    p_attempt_id: attemptId,
  });
  return {
    data: (data as ExamAttemptPayload | null) ?? null,
    error,
  };
}

export async function rpcPreviewShareLink(
  supabase: SupabaseClient<Database>,
  token: string,
): Promise<{ data: ShareLinkPreview | null; error: { code?: string; message: string } | null }> {
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
): Promise<{ data: RedeemShareLinkResult | null; error: { code?: string; message: string } | null }> {
  const rpc = getDynamicRpc(supabase);
  const { data, error } = await rpc("redeem_share_link", {
    p_token: token,
  });
  return {
    data: (data as RedeemShareLinkResult | null) ?? null,
    error,
  };
}
