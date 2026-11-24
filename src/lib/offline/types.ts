/**
 * StudyHub V3.0 — Offline & PWA Storage Types.
 * Strictly aligned with `@/types/domain` and `@/types/v3`.
 * Zero AI fields, zero payment/billing fields.
 */

import type {
  DifficultyLevel,
  MasteryLevel,
  QuestionAcceptedAnswer,
  QuestionOption,
  SelfRating,
  StudySetType,
  Tag,
  Visibility,
} from "@/types/domain";
import type {
  ConfidenceLevel,
  DiagramSet,
  MediaKind,
  OfflineSyncEventType,
  QuestionTypePayload,
  RichTextDoc,
  SharedPassage,
  StructuredAnswerResponse,
  V3QuestionType,
  V3StudyMode,
} from "@/types/v3";

export type OfflineStorageErrorCode =
  | "IDB_UNAVAILABLE"
  | "PRIVATE_BROWSING"
  | "QUOTA_EXCEEDED"
  | "MEDIA_REQUIRED_FOR_SET"
  | "INVALID_USER_PARTITION"
  | "ABORTED"
  | "NETWORK_ERROR"
  | "AUTH_REQUIRED"
  | "UNKNOWN";

export class OfflineStorageError extends Error {
  readonly code: OfflineStorageErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    code: OfflineStorageErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "OfflineStorageError";
    this.code = code;
    this.details = details;
  }
}

export type DownloadedSetStatus =
  | "ready"
  | "partial"
  | "updating"
  | "revoked"
  | "deleted"
  | "error";

export interface OfflineDownloadedSetRecord {
  user_id: string;
  set_id: string;
  title: string;
  subject: string | null;
  description: string | null;
  set_type: StudySetType;
  visibility: Visibility;
  source_language: string;
  content_version: number;
  server_updated_at: string;
  downloaded_at: string;
  /** `null` means all chapters were downloaded; non-null array lists selected chapters */
  downloaded_chapters: string[] | null;
  question_count: number;
  diagram_count: number;
  media_count: number;
  media_bytes: number;
  estimated_total_bytes: number;
  include_media: boolean;
  status: DownloadedSetStatus;
  failed_media_urls: string[];
  last_error: string | null;
  passages: SharedPassage[];
}

export interface OfflineQuestionProgressSnapshot {
  mastery_level: MasteryLevel;
  correct_count: number;
  wrong_count: number;
  consecutive_correct: number;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  last_reviewed_at: string | null;
  next_review_at: string | null;
  last_confidence?: ConfidenceLevel | null;
}

export interface OfflineQuestionOption extends QuestionOption {
  content_rich?: RichTextDoc | null;
  media_id?: string | null;
}

export interface OfflineQuestionRecord {
  id: string;
  user_id: string;
  study_set_id: string;
  question_type: V3QuestionType;
  position: number;
  chapter: string | null;
  prompt: string;
  prompt_rich?: RichTextDoc | null;
  prompt_image_url: string | null;
  back_text: string | null;
  back_rich?: RichTextDoc | null;
  back_image_url: string | null;
  explanation: string | null;
  explanation_rich?: RichTextDoc | null;
  hint: string | null;
  hint_rich?: RichTextDoc | null;
  difficulty: DifficultyLevel;
  source_metadata: Record<string, unknown>;
  type_payload?: QuestionTypePayload | null;
  passage_id?: string | null;
  audio_url?: string | null;
  audio_media_id?: string | null;
  content_version?: number;
  created_at: string;
  updated_at: string;
  options?: OfflineQuestionOption[];
  accepted_answers?: QuestionAcceptedAnswer[];
  tags?: Tag[];
  is_starred?: boolean;
  local_progress?: OfflineQuestionProgressSnapshot | null;
  cached_at: string;
}

export interface OfflineDiagramRecord extends DiagramSet {
  user_id: string;
  cached_at: string;
}

export interface OfflineMediaBlobRecord {
  /** Canonical media URL or proxy path (primary key) */
  url: string;
  user_id: string;
  media_id: string | null;
  kind: MediaKind;
  mime_type: string;
  size_bytes: number;
  blob: Blob;
  /** Reference list of downloaded study_set IDs using this blob */
  set_ids: string[];
  downloaded_at: string;
}

export interface OfflineLocalCheckpointRecord {
  /** `${study_set_id ?? "global"}:${mode}:${session_key}` */
  checkpoint_key: string;
  user_id: string;
  study_set_id: string | null;
  mode: V3StudyMode;
  session_key: string;
  state_json: Record<string, unknown>;
  progress_percent: number;
  current_index: number;
  total_items: number;
  updated_at: string;
  synced: boolean;
}

export type SyncQueueItemStatus =
  | "pending"
  | "in_flight"
  | "retry_wait"
  | "auth_required"
  | "conflict_hold";

export interface OfflineSyncQueueRecord {
  event_id: string;
  seq?: number;
  user_id: string;
  event_type: OfflineSyncEventType;
  study_set_id: string | null;
  question_id: string | null;
  client_timestamp: string;
  progress_generation: number;
  base_version: number | null;
  payload: Record<string, unknown>;
  queue_status: SyncQueueItemStatus;
  attempt_count: number;
  last_attempt_at: string | null;
  next_retry_at: string | null;
  last_error: string | null;
  created_at: string;
}

export interface NoteConflictRecord {
  detected_at: string;
  event_id: string;
  local_text: string;
  local_rich: RichTextDoc | null;
  local_updated_at: string;
  local_base_version: number | null;
  server_text: string;
  server_rich: RichTextDoc | null;
  server_version: number;
  server_updated_at: string | null;
}

export interface OfflineLocalNoteRecord {
  question_id: string;
  study_set_id: string;
  user_id: string;
  content_text: string;
  content_rich: RichTextDoc | null;
  version: number;
  base_version: number | null;
  dirty: boolean;
  updated_at: string;
  conflict: NoteConflictRecord | null;
}

export interface SyncNoticeRecord {
  id: string;
  event_id: string;
  study_set_id: string | null;
  question_id: string | null;
  message: string;
  occurred_at: string;
}

export type SyncMetaStatus =
  | "idle"
  | "syncing"
  | "success"
  | "auth_required"
  | "offline"
  | "error";

export interface OfflineSyncMetaRecord {
  key: "state";
  user_id: string;
  last_synced_at: string | null;
  current_progress_generation: number;
  last_sync_status: SyncMetaStatus;
  last_sync_error: string | null;
  stale_reset_notices: SyncNoticeRecord[];
  revoked_set_notices: SyncNoticeRecord[];
  deleted_notices: SyncNoticeRecord[];
  updated_at: string;
}

export interface StorageEstimateInfo {
  supported: boolean;
  usageBytes: number;
  quotaBytes: number;
  availableBytes: number | null;
  usagePercent: number | null;
}

export interface OfflineMediaRequirement {
  url: string;
  media_id: string | null;
  kind: MediaKind;
  reason:
    | "prompt_image"
    | "back_image"
    | "option_image"
    | "listening_audio"
    | "passage_audio"
    | "diagram_base"
    | "hotspot_image"
    | "ordering_image"
    | "matching_image";
  estimatedBytes: number;
}

export interface SetMediaAnalysis {
  totalQuestions: number;
  totalDiagrams: number;
  requiredMedia: OfflineMediaRequirement[];
  requiresMediaForCorrectness: boolean;
  blockingReasons: string[];
  estimatedTextBytes: number;
  estimatedMediaBytes: number;
  estimatedTotalBytes: number;
}

export interface DownloadProgress {
  phase: "fetching_metadata" | "fetching_questions" | "saving_content" | "downloading_media" | "complete" | "cancelled" | "error";
  completedItems: number;
  totalItems: number;
  downloadedBytes: number;
  estimatedTotalBytes: number;
  failedUrls: string[];
  message?: string;
}

export interface OfflineStudyActionInput {
  study_set_id: string;
  question_id: string;
  mode: V3StudyMode;
  is_correct: boolean;
  self_rating?: SelfRating | null;
  selected_option_ids?: string[];
  typed_answer?: string | null;
  structured_response?: StructuredAnswerResponse | null;
  confidence?: ConfidenceLevel | null;
  hint_used?: boolean;
  response_time_ms?: number | null;
}
