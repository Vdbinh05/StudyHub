/**
 * Frozen V3.0 TypeScript Contracts for StudyHub V3.0 (Complete Learning Edition).
 * Strictly aligned with additive PostgreSQL migrations `0013`–`0015`.
 * ZERO AI types/fields, ZERO billing/monetization types.
 */

import type { AnswerMatchMode } from "./domain";

// ============================================================================
// 1. Canonical V3 Question Types (12 Exam/Study Types + Flashcard = 13 Total)
// ============================================================================

export const V3_QUESTION_TYPES = [
  "single_choice",
  "multiple_choice",
  "true_false",
  "flashcard",
  "short_answer",
  "fill_in_blank",
  "numerical",
  "image_choice",
  "ordering",
  "matching",
  "image_hotspot",
  "reading_passage",
  "listening",
] as const;

export type V3QuestionType = (typeof V3_QUESTION_TYPES)[number];
export type V3ExamQuestionType = Exclude<V3QuestionType, "flashcard">;

export const V3_EXAM_QUESTION_TYPES: readonly V3ExamQuestionType[] = [
  "single_choice",
  "multiple_choice",
  "true_false",
  "short_answer",
  "fill_in_blank",
  "numerical",
  "image_choice",
  "ordering",
  "matching",
  "image_hotspot",
  "reading_passage",
  "listening",
] as const;

export const V3_STUDY_MODES = [
  "flashcards",
  "learn",
  "practice",
  "write",
  "match",
  "review",
  "spell",
  "diagram",
  "custom_practice",
] as const;

export type V3StudyMode = (typeof V3_STUDY_MODES)[number];

export type V3ImportFormat =
  | "eduquiz_txt"
  | "word_answer_key"
  | "docx_ooxml"
  | "xlsx_wayground"
  | "xlsx_generic"
  | "quizlet_tsv"
  | "csv"
  | "json"
  | "txt_generic"
  | "pdf_text"
  | "docx_multimedia";

// ============================================================================
// 2. Canonical Versioned Rich Text AST (TipTap / ProseMirror JSON v1)
// ============================================================================

export type RichTextMarkType =
  | "bold"
  | "italic"
  | "underline"
  | "strike"
  | "code"
  | "superscript"
  | "subscript"
  | "link";

export interface RichTextMark {
  type: RichTextMarkType;
  attrs?: Record<string, string | number | boolean | null>;
}

export type RichTextNodeType =
  | "doc"
  | "paragraph"
  | "text"
  | "hardBreak"
  | "heading"
  | "bulletList"
  | "orderedList"
  | "listItem"
  | "blockquote"
  | "codeBlock"
  | "table"
  | "tableRow"
  | "tableHeader"
  | "tableCell"
  | "inlineMath"
  | "blockMath"
  | "image";

export interface RichTextNode {
  type: RichTextNodeType;
  attrs?: Record<string, string | number | boolean | null>;
  marks?: RichTextMark[];
  text?: string;
  content?: RichTextNode[];
}

export interface RichTextDoc {
  version: 1;
  type: "doc";
  content: RichTextNode[];
}

// ============================================================================
// 3. Multimedia Assets & Reference Relations
// ============================================================================

export type MediaKind = "image" | "audio";

export type MediaEntityType =
  | "question"
  | "question_option"
  | "diagram_set"
  | "shared_passage"
  | "exam_attempt_question"
  | "profile";

export type MediaAttachmentRole =
  | "prompt"
  | "back"
  | "option"
  | "explanation"
  | "hint"
  | "audio"
  | "diagram_base"
  | "passage";

export interface MediaAsset {
  id: string;
  owner_id: string;
  study_set_id: string | null;
  kind: MediaKind;
  storage_bucket: string;
  storage_path: string;
  proxy_url?: string;
  mime_type: string;
  file_name: string;
  size_bytes: number;
  sha256_hash: string | null;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  alt_text: string | null;
  caption: string | null;
  is_orphaned: boolean;
  created_at: string;
  updated_at: string;
}

export interface ContentMediaRelation {
  id: string;
  media_id: string;
  entity_type: MediaEntityType;
  entity_id: string;
  role: MediaAttachmentRole;
  sort_order: number;
  alt_text: string | null;
  caption: string | null;
  created_at: string;
  media?: MediaAsset;
}

/**
 * Canonical hydrated media attachment shape (V32-053) shared across
 * Question, QuestionOption, ExamSnapshotQuestion, ExamSnapshotOption,
 * UnifiedQuestionEditorModal, MediaGallery, PDF Export, and Offline Bundles.
 */
export interface QuestionMediaAttachment {
  id?: string;
  media_id: string;
  url: string;
  role: MediaAttachmentRole;
  sort_order: number;
  alt_text?: string | null;
  caption?: string | null;
  mime_type?: string | null;
  width?: number | null;
  height?: number | null;
  /** Optional storage/join metadata when hydrated from DB or exam snapshots */
  storage_path?: string | null;
  proxy_url?: string | null;
  entity_type?: MediaEntityType;
  entity_id?: string;
  created_at?: string;
  media?: MediaAsset;
}

export type QuestionMediaFilter =
  | "all"
  | "has_images"
  | "no_images"
  | "missing_media"
  | "needs_media_review";

// ============================================================================
// 4. Shared Reading Passages & Interactive Diagrams
// ============================================================================

export interface SharedPassage {
  id: string;
  study_set_id: string;
  owner_id: string;
  title: string;
  content_text: string;
  content_rich: RichTextDoc | null;
  audio_media_id: string | null;
  transcript: string | null;
  source_reference: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  audio_media?: MediaAsset | null;
}

export type HotspotShape = "point" | "rect" | "polygon";

export interface NormalizedPoint {
  /** Normalized horizontal coordinate in [0, 1] relative to natural image width */
  x: number;
  /** Normalized vertical coordinate in [0, 1] relative to natural image height */
  y: number;
}

export interface PointHotspotGeometry {
  shape: "point";
  x: number;
  y: number;
  /** Normalized hit radius in [0.01, 0.25]; defaults to 0.04 */
  radius?: number;
}

export interface RectHotspotGeometry {
  shape: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PolygonHotspotGeometry {
  shape: "polygon";
  points: NormalizedPoint[];
}

export type HotspotGeometry =
  | PointHotspotGeometry
  | RectHotspotGeometry
  | PolygonHotspotGeometry;

export type DiagramStudyMode =
  | "explore"
  | "identify_location"
  | "name_location"
  | "multiple_choice"
  | "hidden_labels"
  | "review_incorrect";

export interface DiagramHotspot {
  id: string;
  diagram_id: string;
  study_set_id: string;
  label: string;
  accepted_alternatives: string[];
  description: string | null;
  hint: string | null;
  shape: HotspotShape;
  geometry: HotspotGeometry;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface DiagramSet {
  id: string;
  study_set_id: string;
  owner_id: string;
  title: string;
  description: string | null;
  base_media_id: string | null;
  base_image_url: string;
  image_width: number | null;
  image_height: number | null;
  content_version: number;
  created_at: string;
  updated_at: string;
  hotspots?: DiagramHotspot[];
  base_media?: MediaAsset | null;
}

// ============================================================================
// 5. Question Type Payloads (Discriminated Union for All 12 Exam Types)
// ============================================================================

export interface FillInBlankSpec {
  blank_id: string;
  accepted_answers: string[];
  match_mode?: AnswerMatchMode;
  case_sensitive?: boolean;
  hint?: string | null;
}

export interface FillInBlankPayload {
  type: "fill_in_blank";
  /** Template text with `{{blank_id}}` or `___` markers */
  template_text?: string;
  blanks: FillInBlankSpec[];
  require_all_blanks?: boolean;
}

export interface NumericalPayload {
  type: "numerical";
  correct_value: number;
  /** Absolute tolerance (e.g. +/- 0.05) */
  abs_tolerance?: number | null;
  /** Relative tolerance ratio (e.g. 0.02 = 2%) */
  rel_tolerance?: number | null;
  /** Canonical unit (e.g. "kt", "hPa", "m/s") */
  unit?: string | null;
  /** Equivalent accepted unit spellings (e.g. ["kts", "knots"]) */
  accepted_units?: string[];
  unit_required?: boolean;
  significant_figures?: number | null;
}

export interface ImageChoicePayload {
  type: "image_choice";
  selection_mode: "single" | "multiple";
}

export interface OrderingItem {
  id: string;
  text: string;
  rich_text?: RichTextDoc | null;
  image_url?: string | null;
  media_id?: string | null;
  correct_position: number;
}

export interface OrderingPayload {
  type: "ordering";
  items: OrderingItem[];
  allow_partial_credit?: boolean;
}

export interface MatchingPair {
  id: string;
  left_text: string;
  left_rich_text?: RichTextDoc | null;
  left_image_url?: string | null;
  right_id: string;
  right_text: string;
  right_rich_text?: RichTextDoc | null;
  right_image_url?: string | null;
}

export interface MatchingDistractor {
  right_id: string;
  right_text: string;
  right_image_url?: string | null;
}

export interface MatchingPayload {
  type: "matching";
  pairs: MatchingPair[];
  distractors?: MatchingDistractor[];
}

export interface ImageHotspotTarget {
  id: string;
  label: string;
  shape: HotspotShape;
  geometry: HotspotGeometry;
}

export interface ImageHotspotPayload {
  type: "image_hotspot";
  diagram_id?: string | null;
  image_url: string;
  image_media_id?: string | null;
  target_hotspots: ImageHotspotTarget[];
  require_all_targets?: boolean;
}

export interface ReadingPassagePayload {
  type: "reading_passage";
  passage_id?: string | null;
  passage_title?: string | null;
  passage_text?: string | null;
  passage_rich?: RichTextDoc | null;
  sub_answer_kind:
    | "single_choice"
    | "multiple_choice"
    | "true_false"
    | "short_answer";
}

export interface ListeningPayload {
  type: "listening";
  audio_media_id?: string | null;
  audio_url?: string | null;
  transcript?: string | null;
  show_transcript_after_submit?: boolean;
  max_replays?: number | null;
  language?: string | null;
  sub_answer_kind:
    | "single_choice"
    | "multiple_choice"
    | "short_answer"
    | "fill_in_blank";
}

export interface CoreQuestionPayload {
  type:
    | "single_choice"
    | "multiple_choice"
    | "true_false"
    | "short_answer"
    | "flashcard";
  [key: string]: unknown;
}

export type QuestionTypePayload =
  | FillInBlankPayload
  | NumericalPayload
  | ImageChoicePayload
  | OrderingPayload
  | MatchingPayload
  | ImageHotspotPayload
  | ReadingPassagePayload
  | ListeningPayload
  | CoreQuestionPayload;

// ============================================================================
// 6. Structured Answer Responses (All 12 Question Types)
// ============================================================================

export interface OptionsStructuredResponse {
  kind: "options";
  selected_option_ids: string[];
}

export interface TextStructuredResponse {
  kind: "text";
  value: string;
}

export interface BlanksStructuredResponse {
  kind: "blanks";
  /** Map of `blank_id -> typed value` */
  answers: Record<string, string>;
}

export interface NumericalStructuredResponse {
  kind: "numerical";
  value: string;
  numeric_value?: number | null;
  unit?: string | null;
}

export interface OrderingStructuredResponse {
  kind: "ordering";
  ordered_item_ids: string[];
}

export interface MatchingStructuredResponse {
  kind: "matching";
  /** Map of `left_pair_id -> selected right_id` */
  pairs: Record<string, string>;
}

export interface HotspotStructuredResponse {
  kind: "hotspot";
  clicks: NormalizedPoint[];
  selected_hotspot_ids?: string[];
}

export type StructuredAnswerResponse =
  | OptionsStructuredResponse
  | TextStructuredResponse
  | BlanksStructuredResponse
  | NumericalStructuredResponse
  | OrderingStructuredResponse
  | MatchingStructuredResponse
  | HotspotStructuredResponse;

// ============================================================================
// 7. Confidence, Notes, Reports, Checkpoints, Mode Preferences, Sync & Search
// ============================================================================

export type ConfidenceLevel = "certain" | "unsure" | "guessing";
export type MistakeStatus = "active" | "improving" | "resolved";

export interface UserQuestionNote {
  id: string;
  user_id: string;
  study_set_id: string;
  question_id: string;
  content_text: string;
  content_rich: RichTextDoc | null;
  version: number;
  created_at: string;
  updated_at: string;
}

export const QUESTION_REPORT_CATEGORIES = [
  "wrong_answer",
  "typo_formatting",
  "missing_media",
  "broken_audio",
  "ambiguous_wording",
  "duplicate_question",
  "wrong_chapter_tag",
  "diagram_hotspot_error",
  "other",
] as const;

export type QuestionReportCategory =
  (typeof QUESTION_REPORT_CATEGORIES)[number];

export type QuestionReportStatus =
  | "open"
  | "reviewing"
  | "resolved"
  | "dismissed";

export interface QuestionReport {
  id: string;
  study_set_id: string;
  question_id: string;
  reporter_id: string;
  category: QuestionReportCategory;
  description: string;
  status: QuestionReportStatus;
  resolution_note: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface LearningSessionCheckpoint {
  id: string;
  user_id: string;
  study_set_id: string | null;
  mode: V3StudyMode;
  session_key: string;
  state_json: Record<string, unknown>;
  progress_percent: number;
  current_index: number;
  total_items: number;
  device_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface LearningConfidenceEvent {
  id: string;
  user_id: string;
  study_set_id: string;
  question_id: string;
  mode: V3StudyMode | "exam";
  confidence: ConfidenceLevel;
  is_correct: boolean;
  hint_used: boolean;
  response_time_ms: number | null;
  created_at: string;
}

export interface ModePreferences {
  flashcards?: {
    start_side?: "front" | "back";
    auto_play_audio?: boolean;
    show_hints?: boolean;
    show_keyboard_hints?: boolean;
  };
  mc?: {
    instant_feedback?: boolean;
    auto_advance_ms?: number | null;
    shuffle_options?: boolean;
    show_explanation_on_correct?: boolean;
  };
  learn?: {
    objective?: "quick_familiarity" | "exam_prep" | "long_term_retention";
    batch_size?: number;
    enable_written_recall?: boolean;
    require_independent_recall?: boolean;
    ask_confidence?: boolean;
  };
  write?: {
    ignore_diacritics?: boolean;
    ignore_case?: boolean;
    allow_override?: boolean;
  };
  spell?: {
    speech_rate?: number;
    preferred_voice?: string | null;
    preferred_lang?: string;
    auto_play_prompt?: boolean;
    show_hint_letters?: boolean;
    strict_diacritics?: boolean;
  };
  diagram?: {
    default_mode?: DiagramStudyMode;
    show_hotspot_hints?: boolean;
    point_tolerance_scale?: number;
  };
  shortcuts?: {
    enabled?: boolean;
    show_hints?: boolean;
  };
  accessibility?: {
    high_contrast_focus?: boolean;
    large_reading_text?: boolean;
    reduce_motion_override?: boolean;
  };
}

// Offline Sync Protocol
export type OfflineSyncEventType =
  | "answer"
  | "confidence"
  | "star"
  | "note_upsert"
  | "checkpoint_upsert"
  | "mistake_resolve";

export interface LearningSyncEventInput {
  event_id: string;
  event_type: OfflineSyncEventType;
  study_set_id?: string | null;
  question_id?: string | null;
  client_timestamp: string;
  progress_generation?: number;
  base_version?: number | null;
  payload: Record<string, unknown>;
}

export type SyncEventStatus =
  | "applied"
  | "duplicate_ignored"
  | "ignored_stale_reset"
  | "rejected_revoked"
  | "rejected_deleted"
  | "conflict"
  | "invalid";

export interface LearningSyncEventResult {
  event_id: string;
  status: SyncEventStatus;
  message?: string;
  server_version?: number | null;
  server_data?: Record<string, unknown> | null;
}

export interface LearningSyncResponse {
  results: LearningSyncEventResult[];
  server_now: string;
  current_progress_generation: number;
}

// Scoped Progress Reset
export type ProgressResetScope =
  | "all"
  | "study_set"
  | "subject"
  | "chapter"
  | "question"
  | "mode";

export interface ProgressResetRequest {
  scope: ProgressResetScope;
  study_set_id?: string;
  subject?: string;
  chapter?: string;
  question_ids?: string[];
  mode?: V3StudyMode;
  clear_mistakes?: boolean;
  clear_starred?: boolean;
  clear_checkpoints?: boolean;
  confirm: "RESET_PROGRESS";
}

export interface ProgressResetResult {
  reset_progress_count: number;
  cleared_checkpoints_count: number;
  cleared_starred_count: number;
  new_progress_generation: number;
}

// Global Library Search
export type GlobalSearchResultType =
  | "folder"
  | "study_set"
  | "question"
  | "option"
  | "tag"
  | "chapter"
  | "note"
  | "diagram";

export interface GlobalSearchItem {
  result_type: GlobalSearchResultType;
  id: string;
  study_set_id: string | null;
  title: string;
  snippet: string;
  subtitle: string | null;
  href: string;
  rank: number;
  updated_at: string | null;
}

export interface GlobalSearchResponse {
  query: string;
  items: GlobalSearchItem[];
  counts_by_type: Partial<Record<GlobalSearchResultType, number>>;
  total: number;
}
