/**
 * Core domain types for StudyHub V3.0 (Complete Learning Edition).
 * Strictly aligned with PostgreSQL migrations `0001`–`0015` (36 canonical tables)
 * and the V2.0/V3.0 Custom Exam, Multimedia, Diagram, Confidence & Offline Sync contracts.
 */

import type {
  ConfidenceLevel,
  ContentMediaRelation,
  DiagramSet,
  MediaAttachmentRole,
  MistakeStatus,
  ModePreferences,
  QuestionTypePayload,
  RichTextDoc,
  SharedPassage,
  StructuredAnswerResponse,
  V3ExamQuestionType,
  V3QuestionType,
  V3StudyMode,
} from "./v3";

export * from "./v3";

export type Locale = "vi" | "en";
export type ThemePreference = "light" | "dark" | "system";

export type StudySetType = "multiple_choice" | "flashcards" | "mixed";
export type Visibility = "private" | "unlisted" | "public" | "shared";
export type MemberRole = "owner" | "editor" | "viewer";
export type SharePermission = Exclude<MemberRole, "owner">;

export type CoreQuestionType =
  | "single_choice"
  | "multiple_choice"
  | "true_false"
  | "flashcard"
  | "short_answer";

export type QuestionType = V3QuestionType;
export type ExamQuestionType = V3ExamQuestionType;
export type AnswerMatchMode =
  | "exact"
  | "case_insensitive"
  | "ignore_diacritics"
  | "numeric";

export type DifficultyLevel = "easy" | "medium" | "hard";
export type MasteryLevel = "new" | "learning" | "familiar" | "mastered";
export type SelfRating = "again" | "hard" | "good" | "easy";

export type StudyMode = V3StudyMode;

export type SessionStatus = "in_progress" | "completed" | "abandoned";
export type ExamStatus = "in_progress" | "submitted" | "expired" | "discarded";
export type FriendshipStatus = "pending" | "accepted" | "declined" | "blocked";
export type ImportJobStatus =
  | "pending"
  | "parsing"
  | "preview_ready"
  | "importing"
  | "completed"
  | "failed";

/** V2.0 Multi-Subject Allocation Strategies (A–E) */
export type AllocationStrategy =
  | "global_random"
  | "equal"
  | "proportional"
  | "custom"
  | "weighted";

/** V2.0 Deterministic Question Selection Policies (1–8) */
export type SelectionPolicy =
  | "random"
  | "unseen_first"
  | "mistakes_first"
  | "weak_topics_first"
  | "due_for_review"
  | "starred_only"
  | "incorrect_only"
  | "anti_repeat";

export type ExamSourceType = "study_set" | "folder";
export type CoverageCycleStatus = "active" | "completed" | "archived";
export type CoverageQuestionState = "unassigned" | "assigned" | "completed";
export type CoverageAttemptStatus = "in_progress" | "completed" | "discarded";

export interface Profile {
  id: string;
  email?: string;
  display_name: string;
  username: string | null;
  avatar_url: string | null;
  bio: string | null;
  created_at: string;
  updated_at: string;
}

/** Peer-safe profile projection (never leaks private email). */
export type PublicProfile = Omit<Profile, "email">;

export interface UserPreferences {
  user_id: string;
  language: Locale;
  theme: ThemePreference;
  daily_goal: number;
  default_shuffle_questions: boolean;
  default_shuffle_options: boolean;
  show_instant_feedback: boolean;
  sound_effects: boolean;
  reduced_motion: boolean;
  confidence_enabled?: boolean;
  mode_preferences?: ModePreferences;
  progress_generation?: number;
  updated_at: string;
}

export interface Folder {
  id: string;
  owner_id: string;
  parent_id: string | null;
  name: string;
  description: string | null;
  color: string;
  icon: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface StudySet {
  id: string;
  owner_id: string;
  folder_id: string | null;
  title: string;
  description: string | null;
  subject: string | null;
  set_type: StudySetType;
  visibility: Visibility;
  source_language: string;
  question_count: number;
  default_exam_duration_minutes: number;
  default_pass_threshold: number;
  is_archived: boolean;
  is_favorite?: boolean;
  content_version?: number;
  last_studied_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface StudySetMember {
  id: string;
  study_set_id: string;
  user_id: string;
  role: MemberRole;
  allow_clone?: boolean;
  invited_by: string | null;
  created_at: string;
  profile?: Profile;
}

export interface StudySetShareLink {
  id: string;
  study_set_id: string;
  created_by: string;
  token: string;
  permission: SharePermission;
  allow_clone: boolean;
  expires_at: string | null;
  revoked_at: string | null;
  use_count: number;
  created_at: string;
}

export interface QuestionOption {
  /** Stable UUID identifying this option regardless of shuffled display order */
  id: string;
  question_id: string;
  study_set_id: string;
  position: number;
  label: string;
  content: string;
  content_rich?: RichTextDoc | null;
  image_url: string | null;
  media_id?: string | null;
  image_alt?: string | null;
  is_correct: boolean;
  created_at: string;
}

export interface QuestionAcceptedAnswer {
  id: string;
  question_id: string;
  study_set_id: string;
  answer_text: string;
  normalized_answer: string;
  match_mode: AnswerMatchMode;
  created_at: string;
}

export interface Tag {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  color: string;
  created_at: string;
}

export interface QuestionTag {
  question_id: string;
  tag_id: string;
  study_set_id: string;
  created_at: string;
}

export interface Question {
  id: string;
  study_set_id: string;
  question_type: QuestionType;
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
  audio_media_id?: string | null;
  audio_url?: string | null;
  audio_transcript?: string | null;
  passage_id?: string | null;
  diagram_id?: string | null;
  type_payload?: QuestionTypePayload | null;
  difficulty: DifficultyLevel;
  source_metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  options?: QuestionOption[];
  accepted_answers?: QuestionAcceptedAnswer[];
  tags?: Tag[];
  media_attachments?: ContentMediaRelation[];
  passage?: SharedPassage | null;
  diagram?: DiagramSet | null;
}

export interface UserQuestionProgress {
  id: string;
  user_id: string;
  study_set_id: string;
  question_id: string;
  mastery_level: MasteryLevel;
  correct_count: number;
  wrong_count: number;
  consecutive_correct: number;
  consecutive_wrong?: number;
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  last_reviewed_at: string | null;
  last_wrong_at?: string | null;
  next_review_at: string | null;
  last_confidence?: ConfidenceLevel | null;
  low_confidence_count?: number;
  high_conf_wrong_count?: number;
  guess_correct_count?: number;
  independent_recall_count?: number;
  hint_used_count?: number;
  mistake_status?: MistakeStatus;
  progress_generation?: number;
  updated_at: string;
}

export interface StarredQuestion {
  user_id: string;
  question_id: string;
  study_set_id: string;
  created_at: string;
}

export interface StudySession {
  id: string;
  user_id: string;
  study_set_id: string | null;
  source_study_set_ids?: string[];
  mode: StudyMode;
  status: SessionStatus;
  config: Record<string, unknown>;
  total_items: number;
  completed_items: number;
  correct_items: number;
  duration_seconds: number;
  started_at: string;
  completed_at: string | null;
  created_at: string;
}

export interface StudySessionAnswer {
  id: string;
  session_id: string;
  user_id: string;
  study_set_id: string;
  question_id: string;
  selected_option_ids: string[];
  typed_answer: string | null;
  structured_response?: StructuredAnswerResponse | null;
  confidence?: ConfidenceLevel | null;
  hint_used?: boolean;
  is_correct: boolean;
  self_rating: SelfRating | null;
  response_time_ms: number | null;
  answered_at: string;
}

/**
 * Snapshot option stored inside `exam_attempt_questions.options_snapshot`.
 * SECURITY: NEVER includes `is_correct` (correct answers live in server-protected `correct_option_ids`).
 */
export interface ExamSnapshotOption {
  id: string;
  label: string;
  content: string;
  content_rich?: RichTextDoc | null;
  image_url: string | null;
  media_id?: string | null;
  image_alt?: string | null;
  position: number;
}

export interface ExamAcceptedAnswerSnapshot {
  answer_text: string;
  normalized_answer: string;
  match_mode: AnswerMatchMode;
}

export interface ExamTagSnapshot {
  id: string;
  name: string;
  color?: string | null;
}

export interface ExamFilterConfig {
  chapters?: string[];
  tag_ids?: string[];
  difficulties?: DifficultyLevel[];
  question_types?: ExamQuestionType[];
}

export interface ExamSourceInput {
  source_type: ExamSourceType;
  id: string;
  include_subfolders?: boolean;
  custom_count?: number | null;
  custom_percentage?: number | null;
}

export interface ExamConfig {
  question_count: number;
  duration_limit_seconds: number | null;
  shuffle_questions: boolean;
  shuffle_options: boolean;
  pass_threshold: number;
  chapters?: string[];
  tag_ids?: string[];
  difficulties?: DifficultyLevel[];
  question_types?: ExamQuestionType[];
  only_starred?: boolean;
  only_unmastered?: boolean;
  only_mistakes?: boolean;
  allocation_strategy?: AllocationStrategy;
  selection_policy?: SelectionPolicy;
  show_subject_names?: boolean;
  show_chapter_names?: boolean;
  allow_navigation?: boolean;
  allow_mark_for_review?: boolean;
  auto_submit_on_expire?: boolean;
  show_review_after_submit?: boolean;
  additional_study_set_ids?: string[];
  sources?: ExamSourceInput[];
  preset_id?: string | null;
  coverage_cycle_id?: string | null;
}

export interface ExamAttempt {
  id: string;
  user_id: string;
  study_set_id: string | null;
  study_set_title_snapshot: string;
  status: ExamStatus;
  config: ExamConfig;
  total_questions: number;
  answered_count: number;
  correct_count: number;
  wrong_count: number;
  unanswered_count: number;
  score_percent: number;
  pass_threshold: number;
  passed: boolean;
  duration_limit_seconds: number | null;
  time_spent_seconds: number;
  started_at: string;
  expires_at: string | null;
  submitted_at: string | null;
  created_at: string;
  allocation_strategy?: AllocationStrategy;
  selection_policy?: SelectionPolicy;
  requested_question_count?: number | null;
  show_subject_names?: boolean;
  show_chapter_names?: boolean;
  allow_navigation?: boolean;
  allow_mark_for_review?: boolean;
  auto_submit_on_expire?: boolean;
  show_review_after_submit?: boolean;
  coverage_cycle_id?: string | null;
  preset_id?: string | null;
  is_multi_subject?: boolean;
}

/**
 * Immutable question snapshot captured at exam creation time.
 * `explanation_snapshot`, `correct_option_ids`, and `accepted_answers_snapshot`
 * are omitted while `attempt.status === 'in_progress'`.
 */
export interface ExamSnapshotQuestion {
  id: string;
  attempt_id: string;
  question_id: string | null;
  position: number;
  question_type: ExamQuestionType;
  source_study_set_id?: string | null;
  source_subject_title?: string | null;
  chapter_snapshot: string | null;
  tags_snapshot?: ExamTagSnapshot[];
  prompt_snapshot: string;
  prompt_rich_snapshot?: RichTextDoc | null;
  prompt_image_url_snapshot: string | null;
  audio_media_id_snapshot?: string | null;
  audio_url_snapshot?: string | null;
  passage_snapshot?: Partial<SharedPassage> | null;
  diagram_snapshot?: Partial<DiagramSet> | null;
  type_payload_snapshot?: QuestionTypePayload | null;
  media_snapshot?: Array<{
    media_id: string;
    role: MediaAttachmentRole;
    storage_path: string;
    proxy_url: string;
    mime_type: string;
    alt_text?: string | null;
    caption?: string | null;
  }>;
  options_snapshot: ExamSnapshotOption[];
  explanation_snapshot?: string | null;
  explanation_rich_snapshot?: RichTextDoc | null;
  correct_option_ids?: string[];
  accepted_answers_snapshot?: ExamAcceptedAnswerSnapshot[];
  created_at: string;
}

export interface ExamAttemptAnswer {
  id: string;
  attempt_id: string;
  attempt_question_id: string;
  user_id: string;
  selected_option_ids: string[];
  typed_answer: string | null;
  structured_response?: StructuredAnswerResponse | null;
  confidence?: ConfidenceLevel | null;
  hint_used?: boolean;
  is_flagged: boolean;
  is_correct: boolean | null;
  client_seq?: number;
  updated_at: string;
}

export interface ExamAttemptSource {
  id: string;
  attempt_id: string;
  user_id: string;
  source_type: ExamSourceType;
  study_set_id: string | null;
  folder_id: string | null;
  subject_title_snapshot: string;
  eligible_count: number;
  requested_count: number | null;
  requested_percentage: number | null;
  allocated_count: number;
  sort_order: number;
  created_at: string;
}

export interface ExamPresetSource {
  id: string;
  preset_id: string;
  source_type: ExamSourceType;
  study_set_id: string | null;
  folder_id: string | null;
  include_subfolders: boolean;
  custom_count: number | null;
  custom_percentage: number | null;
  sort_order: number;
  created_at: string;
  title?: string | null;
}

export interface ExamPreset {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  is_favorite: boolean;
  requested_question_count: number | null;
  allocation_strategy: AllocationStrategy;
  selection_policy: SelectionPolicy;
  full_coverage_mode: boolean;
  duration_limit_seconds: number | null;
  pass_threshold: number;
  shuffle_questions: boolean;
  shuffle_options: boolean;
  show_subject_names: boolean;
  show_chapter_names: boolean;
  allow_navigation: boolean;
  allow_mark_for_review: boolean;
  auto_submit_on_expire: boolean;
  show_review_after_submit: boolean;
  filters: ExamFilterConfig;
  use_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
  sources?: ExamPresetSource[];
  current_eligible_count?: number;
}

export interface CoverageSubjectProgress {
  study_set_id: string | null;
  subject_title: string;
  total: number;
  completed: number;
  assigned: number;
  remaining: number;
}

export interface CoverageCycleAttempt {
  id: string;
  cycle_id: string;
  attempt_id: string;
  user_id: string;
  sequence_number: number;
  status: CoverageAttemptStatus;
  assigned_question_count: number;
  answered_question_count: number;
  completed_question_count: number;
  discarded_at: string | null;
  created_at: string;
  score_percent?: number | null;
  passed?: boolean | null;
  exam_status?: ExamStatus;
}

export interface CoverageCycleQuestion {
  id: string;
  cycle_id: string;
  user_id: string;
  question_id: string | null;
  source_study_set_id: string | null;
  source_subject_title: string;
  pool_order: number;
  state: CoverageQuestionState;
  assigned_attempt_id: string | null;
  completed_attempt_id: string | null;
  was_answered: boolean;
  last_is_correct: boolean | null;
  times_assigned: number;
  assigned_at: string | null;
  completed_at: string | null;
  created_at: string;
}

export interface CoverageCycle {
  id: string;
  user_id: string;
  preset_id: string | null;
  title: string;
  status: CoverageCycleStatus;
  source_snapshot: Array<{
    study_set_id: string;
    title: string;
    subject?: string | null;
    custom_count?: number | null;
    custom_percentage?: number | null;
  }>;
  filter_snapshot: Record<string, unknown>;
  allocation_strategy: AllocationStrategy;
  questions_per_exam: number;
  total_questions: number;
  assigned_count: number;
  answered_count: number;
  completed_count: number;
  remaining_count?: number;
  progress_percent?: number;
  active_attempt_id: string | null;
  cycle_number: number;
  started_at: string;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  subject_progress?: CoverageSubjectProgress[];
  attempts?: CoverageCycleAttempt[];
  active_attempt?: {
    id: string;
    status: ExamStatus;
    total_questions: number;
    answered_count: number;
    started_at: string;
    expires_at: string | null;
  } | null;
}

export interface ExamEligibleSubject {
  study_set_id: string;
  title: string;
  subject: string | null;
  total_exam_questions: number;
  eligible_count: number;
  unseen_count: number;
  mistakes_count: number;
  starred_count: number;
  unmastered_count: number;
  due_count: number;
}

export interface ExamEligibleChapter {
  study_set_id: string;
  subject_title: string;
  chapter: string;
  count: number;
}

export interface ExamEligibleTag {
  id: string;
  name: string;
  color: string;
  count: number;
}

export interface ExamEligiblePool {
  total_eligible: number;
  deduplicated_set_count: number;
  overlap_sets_removed: number;
  subjects: ExamEligibleSubject[];
  chapters: ExamEligibleChapter[];
  tags: ExamEligibleTag[];
  question_type_counts: Partial<Record<ExamQuestionType, number>>;
  difficulty_counts: Partial<Record<DifficultyLevel, number>>;
}

export interface ExamAllocationPreviewItem {
  study_set_id: string;
  title: string;
  eligible_count: number;
  requested_count: number | null;
  requested_percentage: number | null;
  allocated_count: number;
  share_percent: number;
  shortfall: number;
  was_redistributed: boolean;
}

export interface ExamPreviewWarning {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ExamPreviewResult {
  valid: boolean;
  total_eligible: number;
  requested_question_count: number;
  actual_question_count: number;
  allocation_strategy: AllocationStrategy;
  selection_policy: SelectionPolicy;
  duration_limit_seconds: number | null;
  avg_seconds_per_question: number | null;
  was_redistributed: boolean;
  repeated_count: number;
  is_random_on_start: boolean;
  allocations: ExamAllocationPreviewItem[];
  coverage_plan?: {
    questions_per_exam: number;
    total_exams: number;
    batch_sizes: number[];
  } | null;
  warnings: ExamPreviewWarning[];
  errors: ExamPreviewWarning[];
}

export interface ExamSubjectBreakdown {
  study_set_id: string | null;
  subject_title: string;
  total: number;
  correct: number;
  wrong: number;
  unanswered: number;
  accuracy_percent: number;
}

export interface ExamChapterBreakdown {
  study_set_id?: string | null;
  subject_title?: string | null;
  chapter: string;
  total: number;
  correct: number;
  wrong: number;
  unanswered: number;
  accuracy_percent: number;
}

export interface ExamTagBreakdown {
  tag_id: string;
  tag_name: string;
  total: number;
  correct: number;
  wrong: number;
  unanswered: number;
  accuracy_percent: number;
}

export interface PracticeQuestionItem extends Question {
  source_subject_title?: string | null;
  is_starred?: boolean;
  progress?: UserQuestionProgress | null;
}

export interface PracticePoolResponse {
  session: StudySession | null;
  total_eligible: number;
  sources: Array<{ study_set_id: string; title: string }>;
  questions: PracticeQuestionItem[];
}

export interface Friendship {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: FriendshipStatus;
  blocked_by?: string | null;
  created_at: string;
  updated_at: string;
  requester?: Profile;
  addressee?: Profile;
}
