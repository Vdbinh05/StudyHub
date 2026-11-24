/**
 * Core domain types for StudyHub V1.0.
 * Strictly aligned with `docs/DATABASE.md` (all 20 tables) and `docs/ARCHITECTURE.md`.
 */

export type Locale = "vi" | "en";
export type ThemePreference = "light" | "dark" | "system";

export type StudySetType = "multiple_choice" | "flashcards" | "mixed";
export type Visibility = "private" | "unlisted" | "public" | "shared";
export type MemberRole = "owner" | "editor" | "viewer";
export type SharePermission = Exclude<MemberRole, "owner">;

export type QuestionType =
  | "single_choice"
  | "multiple_choice"
  | "true_false"
  | "flashcard"
  | "short_answer";

export type ExamQuestionType = Exclude<QuestionType, "flashcard">;
export type AnswerMatchMode =
  | "exact"
  | "case_insensitive"
  | "ignore_diacritics"
  | "numeric";

export type DifficultyLevel = "easy" | "medium" | "hard";
export type MasteryLevel = "new" | "learning" | "familiar" | "mastered";
export type SelfRating = "again" | "hard" | "good" | "easy";

export type StudyMode =
  | "flashcards"
  | "learn"
  | "practice"
  | "write"
  | "match"
  | "review";

export type SessionStatus = "in_progress" | "completed" | "abandoned";
export type ExamStatus = "in_progress" | "submitted" | "expired";
export type FriendshipStatus = "pending" | "accepted" | "declined" | "blocked";
export type ImportJobStatus =
  | "pending"
  | "parsing"
  | "preview_ready"
  | "importing"
  | "completed"
  | "failed";

export interface Profile {
  id: string;
  email: string;
  display_name: string;
  username: string | null;
  avatar_url: string | null;
  bio: string | null;
  created_at: string;
  updated_at: string;
}

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
  last_studied_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface StudySetMember {
  id: string;
  study_set_id: string;
  user_id: string;
  role: MemberRole;
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
  image_url: string | null;
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
  prompt_image_url: string | null;
  back_text: string | null;
  back_image_url: string | null;
  explanation: string | null;
  hint: string | null;
  difficulty: DifficultyLevel;
  source_metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  options?: QuestionOption[];
  accepted_answers?: QuestionAcceptedAnswer[];
  tags?: Tag[];
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
  ease_factor: number;
  interval_days: number;
  repetitions: number;
  last_reviewed_at: string | null;
  next_review_at: string | null;
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
  study_set_id: string;
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
  image_url: string | null;
  position: number;
}

export interface ExamAcceptedAnswerSnapshot {
  answer_text: string;
  normalized_answer: string;
  match_mode: AnswerMatchMode;
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
  only_starred?: boolean;
  only_unmastered?: boolean;
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
  chapter_snapshot: string | null;
  prompt_snapshot: string;
  prompt_image_url_snapshot: string | null;
  options_snapshot: ExamSnapshotOption[];
  explanation_snapshot?: string | null;
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
  is_flagged: boolean;
  is_correct: boolean | null;
  updated_at: string;
}

export interface Friendship {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: FriendshipStatus;
  created_at: string;
  updated_at: string;
  requester?: Profile;
  addressee?: Profile;
}
