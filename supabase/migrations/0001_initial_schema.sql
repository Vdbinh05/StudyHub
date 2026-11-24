-- ============================================================================
-- StudyHub V1.0 — Migration 0001: Initial Schema & Performance Indexes
-- All 20 canonical tables matching docs/DATABASE.md & src/types/database.ts 1:1
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. profiles
-- ----------------------------------------------------------------------------
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  display_name text NOT NULL,
  username text UNIQUE CHECK (username IS NULL OR username ~ '^[a-z0-9_]{3,30}$'),
  avatar_url text,
  bio text CHECK (bio IS NULL OR char_length(bio) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 2. user_preferences
-- ----------------------------------------------------------------------------
CREATE TABLE public.user_preferences (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  language text NOT NULL DEFAULT 'vi' CHECK (language IN ('vi', 'en')),
  theme text NOT NULL DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system')),
  daily_goal integer NOT NULL DEFAULT 20 CHECK (daily_goal BETWEEN 1 AND 500),
  default_shuffle_questions boolean NOT NULL DEFAULT false,
  default_shuffle_options boolean NOT NULL DEFAULT true,
  show_instant_feedback boolean NOT NULL DEFAULT true,
  sound_effects boolean NOT NULL DEFAULT false,
  reduced_motion boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 3. folders
-- ----------------------------------------------------------------------------
CREATE TABLE public.folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES public.folders(id) ON DELETE SET NULL,
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 120),
  description text CHECK (description IS NULL OR char_length(description) <= 500),
  color text NOT NULL DEFAULT 'indigo',
  icon text NOT NULL DEFAULT 'folder',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 4. study_sets
-- ----------------------------------------------------------------------------
CREATE TABLE public.study_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  folder_id uuid REFERENCES public.folders(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 200),
  description text CHECK (description IS NULL OR char_length(description) <= 2000),
  subject text CHECK (subject IS NULL OR char_length(subject) <= 100),
  set_type text NOT NULL DEFAULT 'multiple_choice' CHECK (set_type IN ('multiple_choice', 'flashcards', 'mixed')),
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'unlisted', 'public', 'shared')),
  source_language text NOT NULL DEFAULT 'vi',
  question_count integer NOT NULL DEFAULT 0 CHECK (question_count >= 0),
  default_exam_duration_minutes integer NOT NULL DEFAULT 45 CHECK (default_exam_duration_minutes BETWEEN 1 AND 300),
  default_pass_threshold integer NOT NULL DEFAULT 70 CHECK (default_pass_threshold BETWEEN 1 AND 100),
  is_archived boolean NOT NULL DEFAULT false,
  last_studied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 5. study_set_members
-- ----------------------------------------------------------------------------
CREATE TABLE public.study_set_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  study_set_id uuid NOT NULL REFERENCES public.study_sets(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'viewer' CHECK (role IN ('owner', 'editor', 'viewer')),
  invited_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT study_set_members_unique UNIQUE (study_set_id, user_id)
);

-- ----------------------------------------------------------------------------
-- 6. study_set_share_links
-- ----------------------------------------------------------------------------
CREATE TABLE public.study_set_share_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  study_set_id uuid NOT NULL REFERENCES public.study_sets(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE CHECK (char_length(token) >= 16),
  permission text NOT NULL DEFAULT 'viewer' CHECK (permission IN ('viewer', 'editor')),
  allow_clone boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  revoked_at timestamptz,
  use_count integer NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 7. questions
-- ----------------------------------------------------------------------------
CREATE TABLE public.questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  study_set_id uuid NOT NULL REFERENCES public.study_sets(id) ON DELETE CASCADE,
  question_type text NOT NULL DEFAULT 'single_choice' CHECK (
    question_type IN ('single_choice', 'multiple_choice', 'true_false', 'flashcard', 'short_answer')
  ),
  position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
  chapter text CHECK (chapter IS NULL OR char_length(chapter) <= 200),
  prompt text NOT NULL CHECK (char_length(trim(prompt)) >= 1),
  prompt_image_url text,
  back_text text,
  back_image_url text,
  explanation text,
  hint text,
  difficulty text NOT NULL DEFAULT 'medium' CHECK (difficulty IN ('easy', 'medium', 'hard')),
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 8. question_options
-- ----------------------------------------------------------------------------
CREATE TABLE public.question_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  study_set_id uuid NOT NULL REFERENCES public.study_sets(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
  label text NOT NULL,
  content text NOT NULL,
  image_url text,
  is_correct boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 9. question_accepted_answers
-- ----------------------------------------------------------------------------
CREATE TABLE public.question_accepted_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  study_set_id uuid NOT NULL REFERENCES public.study_sets(id) ON DELETE CASCADE,
  answer_text text NOT NULL CHECK (char_length(trim(answer_text)) >= 1),
  normalized_answer text NOT NULL,
  match_mode text NOT NULL DEFAULT 'case_insensitive' CHECK (
    match_mode IN ('exact', 'case_insensitive', 'ignore_diacritics', 'numeric')
  ),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 10. tags
-- ----------------------------------------------------------------------------
CREATE TABLE public.tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 50),
  slug text NOT NULL,
  color text NOT NULL DEFAULT 'slate',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tags_owner_slug_unique UNIQUE (owner_id, slug)
);

-- ----------------------------------------------------------------------------
-- 11. question_tags
-- ----------------------------------------------------------------------------
CREATE TABLE public.question_tags (
  question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  study_set_id uuid NOT NULL REFERENCES public.study_sets(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (question_id, tag_id)
);

-- ----------------------------------------------------------------------------
-- 12. user_question_progress
-- ----------------------------------------------------------------------------
CREATE TABLE public.user_question_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  study_set_id uuid NOT NULL REFERENCES public.study_sets(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  mastery_level text NOT NULL DEFAULT 'new' CHECK (mastery_level IN ('new', 'learning', 'familiar', 'mastered')),
  correct_count integer NOT NULL DEFAULT 0 CHECK (correct_count >= 0),
  wrong_count integer NOT NULL DEFAULT 0 CHECK (wrong_count >= 0),
  consecutive_correct integer NOT NULL DEFAULT 0 CHECK (consecutive_correct >= 0),
  ease_factor numeric(4,2) NOT NULL DEFAULT 2.50 CHECK (ease_factor >= 1.30 AND ease_factor <= 4.00),
  interval_days integer NOT NULL DEFAULT 0 CHECK (interval_days >= 0),
  repetitions integer NOT NULL DEFAULT 0 CHECK (repetitions >= 0),
  last_reviewed_at timestamptz,
  next_review_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_question_progress_unique UNIQUE (user_id, question_id)
);

-- ----------------------------------------------------------------------------
-- 13. starred_questions
-- ----------------------------------------------------------------------------
CREATE TABLE public.starred_questions (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  study_set_id uuid NOT NULL REFERENCES public.study_sets(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, question_id)
);

-- ----------------------------------------------------------------------------
-- 14. study_sessions
-- ----------------------------------------------------------------------------
CREATE TABLE public.study_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  study_set_id uuid NOT NULL REFERENCES public.study_sets(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('flashcards', 'learn', 'practice', 'write', 'match', 'review')),
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'abandoned')),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  total_items integer NOT NULL DEFAULT 0 CHECK (total_items >= 0),
  completed_items integer NOT NULL DEFAULT 0 CHECK (completed_items >= 0),
  correct_items integer NOT NULL DEFAULT 0 CHECK (correct_items >= 0),
  duration_seconds integer NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 15. study_session_answers
-- ----------------------------------------------------------------------------
CREATE TABLE public.study_session_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.study_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  study_set_id uuid NOT NULL REFERENCES public.study_sets(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  selected_option_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  typed_answer text,
  is_correct boolean NOT NULL,
  self_rating text CHECK (self_rating IS NULL OR self_rating IN ('again', 'hard', 'good', 'easy')),
  response_time_ms integer CHECK (response_time_ms IS NULL OR response_time_ms >= 0),
  answered_at timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 16. exam_attempts
-- ----------------------------------------------------------------------------
CREATE TABLE public.exam_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  study_set_id uuid REFERENCES public.study_sets(id) ON DELETE SET NULL,
  study_set_title_snapshot text NOT NULL,
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted', 'expired')),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  total_questions integer NOT NULL CHECK (total_questions > 0),
  answered_count integer NOT NULL DEFAULT 0 CHECK (answered_count >= 0),
  correct_count integer NOT NULL DEFAULT 0 CHECK (correct_count >= 0),
  wrong_count integer NOT NULL DEFAULT 0 CHECK (wrong_count >= 0),
  unanswered_count integer NOT NULL DEFAULT 0 CHECK (unanswered_count >= 0),
  score_percent numeric(5,2) NOT NULL DEFAULT 0.00 CHECK (score_percent >= 0 AND score_percent <= 100),
  pass_threshold integer NOT NULL DEFAULT 70 CHECK (pass_threshold BETWEEN 1 AND 100),
  passed boolean NOT NULL DEFAULT false,
  duration_limit_seconds integer CHECK (duration_limit_seconds IS NULL OR duration_limit_seconds > 0),
  time_spent_seconds integer NOT NULL DEFAULT 0 CHECK (time_spent_seconds >= 0),
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 17. exam_attempt_questions (Immutable Exam Snapshot)
-- ----------------------------------------------------------------------------
CREATE TABLE public.exam_attempt_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES public.exam_attempts(id) ON DELETE CASCADE,
  question_id uuid REFERENCES public.questions(id) ON DELETE SET NULL,
  position integer NOT NULL CHECK (position >= 0),
  question_type text NOT NULL CHECK (question_type IN ('single_choice', 'multiple_choice', 'true_false', 'short_answer')),
  chapter_snapshot text,
  prompt_snapshot text NOT NULL,
  prompt_image_url_snapshot text,
  explanation_snapshot text,
  options_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  correct_option_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  accepted_answers_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exam_attempt_questions_unique_pos UNIQUE (attempt_id, position)
);

-- ----------------------------------------------------------------------------
-- 18. exam_attempt_answers
-- ----------------------------------------------------------------------------
CREATE TABLE public.exam_attempt_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES public.exam_attempts(id) ON DELETE CASCADE,
  attempt_question_id uuid NOT NULL REFERENCES public.exam_attempt_questions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  selected_option_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  typed_answer text,
  is_flagged boolean NOT NULL DEFAULT false,
  is_correct boolean,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exam_attempt_answers_unique UNIQUE (attempt_id, attempt_question_id)
);

-- ----------------------------------------------------------------------------
-- 19. friendships
-- ----------------------------------------------------------------------------
CREATE TABLE public.friendships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requester_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  addressee_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'blocked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT friendships_no_self CHECK (requester_id <> addressee_id)
);

CREATE UNIQUE INDEX friendships_pair_unique_idx
  ON public.friendships (LEAST(requester_id, addressee_id), GREATEST(requester_id, addressee_id));

-- ----------------------------------------------------------------------------
-- 20. import_jobs
-- ----------------------------------------------------------------------------
CREATE TABLE public.import_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  study_set_id uuid REFERENCES public.study_sets(id) ON DELETE SET NULL,
  source_format text NOT NULL CHECK (
    source_format IN (
      'eduquiz_txt',
      'word_answer_key',
      'docx_ooxml',
      'xlsx_wayground',
      'xlsx_generic',
      'quizlet_tsv',
      'csv',
      'json',
      'txt_generic'
    )
  ),
  file_name text NOT NULL,
  file_size_bytes integer NOT NULL CHECK (file_size_bytes >= 0),
  status text NOT NULL DEFAULT 'pending' CHECK (
    status IN ('pending', 'parsing', 'preview_ready', 'importing', 'completed', 'failed')
  ),
  total_detected integer NOT NULL DEFAULT 0 CHECK (total_detected >= 0),
  valid_count integer NOT NULL DEFAULT 0 CHECK (valid_count >= 0),
  warning_count integer NOT NULL DEFAULT 0 CHECK (warning_count >= 0),
  error_count integer NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  imported_count integer NOT NULL DEFAULT 0 CHECK (imported_count >= 0),
  answer_rule jsonb NOT NULL DEFAULT '{}'::jsonb,
  diagnostics jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

-- ============================================================================
-- Performance & Foreign Key Indexes (docs/DATABASE.md §3)
-- ============================================================================

-- Profiles
CREATE INDEX idx_profiles_email_lower ON public.profiles (lower(email));

-- Folders
CREATE INDEX idx_folders_owner_id ON public.folders (owner_id, sort_order);
CREATE INDEX idx_folders_parent_id ON public.folders (parent_id) WHERE parent_id IS NOT NULL;

-- Study Sets
CREATE INDEX idx_study_sets_owner_id ON public.study_sets (owner_id, updated_at DESC);
CREATE INDEX idx_study_sets_folder_id ON public.study_sets (folder_id) WHERE folder_id IS NOT NULL;
CREATE INDEX idx_study_sets_visibility ON public.study_sets (visibility, created_at DESC) WHERE visibility = 'public';
CREATE INDEX idx_study_sets_created_at ON public.study_sets (created_at DESC);

-- Study Set Members & Share Links
CREATE INDEX idx_study_set_members_user_id ON public.study_set_members (user_id);
CREATE INDEX idx_study_set_members_study_set_id ON public.study_set_members (study_set_id);
CREATE INDEX idx_study_set_members_invited_by ON public.study_set_members (invited_by) WHERE invited_by IS NOT NULL;
CREATE INDEX idx_study_set_share_links_study_set_id ON public.study_set_share_links (study_set_id);
CREATE INDEX idx_study_set_share_links_created_by ON public.study_set_share_links (created_by);

-- Questions, Options & Accepted Answers
CREATE INDEX idx_questions_study_set_position ON public.questions (study_set_id, position);
CREATE INDEX idx_questions_study_set_chapter ON public.questions (study_set_id, chapter) WHERE chapter IS NOT NULL;
CREATE INDEX idx_questions_created_at ON public.questions (created_at DESC);
CREATE INDEX idx_question_options_question_id ON public.question_options (question_id, position);
CREATE INDEX idx_question_options_study_set_id ON public.question_options (study_set_id);
CREATE INDEX idx_question_accepted_answers_question_id ON public.question_accepted_answers (question_id);
CREATE INDEX idx_question_accepted_answers_study_set_id ON public.question_accepted_answers (study_set_id);

-- Tags
CREATE INDEX idx_tags_owner_id ON public.tags (owner_id);
CREATE INDEX idx_question_tags_tag_id ON public.question_tags (tag_id);
CREATE INDEX idx_question_tags_study_set_id ON public.question_tags (study_set_id);

-- Spaced Repetition Progress & Stars
CREATE INDEX idx_user_question_progress_user_due ON public.user_question_progress (user_id, next_review_at) WHERE next_review_at IS NOT NULL;
CREATE INDEX idx_user_question_progress_user_set ON public.user_question_progress (user_id, study_set_id, mastery_level);
CREATE INDEX idx_user_question_progress_question_id ON public.user_question_progress (question_id);
CREATE INDEX idx_user_question_progress_study_set_id ON public.user_question_progress (study_set_id);
CREATE INDEX idx_starred_questions_user_created ON public.starred_questions (user_id, created_at DESC);
CREATE INDEX idx_starred_questions_study_set_id ON public.starred_questions (study_set_id);
CREATE INDEX idx_starred_questions_question_id ON public.starred_questions (question_id);

-- Study Sessions
CREATE INDEX idx_study_sessions_user_created ON public.study_sessions (user_id, created_at DESC);
CREATE INDEX idx_study_sessions_study_set_id ON public.study_sessions (study_set_id);
CREATE INDEX idx_study_session_answers_session_id ON public.study_session_answers (session_id);
CREATE INDEX idx_study_session_answers_user_answered ON public.study_session_answers (user_id, answered_at DESC);
CREATE INDEX idx_study_session_answers_question_id ON public.study_session_answers (question_id);
CREATE INDEX idx_study_session_answers_study_set_id ON public.study_session_answers (study_set_id);

-- Exam Attempts
CREATE INDEX idx_exam_attempts_user_created ON public.exam_attempts (user_id, created_at DESC);
CREATE INDEX idx_exam_attempts_study_set_id ON public.exam_attempts (study_set_id) WHERE study_set_id IS NOT NULL;
CREATE INDEX idx_exam_attempt_questions_attempt_id ON public.exam_attempt_questions (attempt_id, position);
CREATE INDEX idx_exam_attempt_questions_question_id ON public.exam_attempt_questions (question_id) WHERE question_id IS NOT NULL;
CREATE INDEX idx_exam_attempt_answers_attempt_id ON public.exam_attempt_answers (attempt_id);
CREATE INDEX idx_exam_attempt_answers_attempt_question_id ON public.exam_attempt_answers (attempt_question_id);
CREATE INDEX idx_exam_attempt_answers_user_id ON public.exam_attempt_answers (user_id);

-- Friendships & Import Jobs
CREATE INDEX idx_friendships_requester_id ON public.friendships (requester_id, status);
CREATE INDEX idx_friendships_addressee_id ON public.friendships (addressee_id, status);
CREATE INDEX idx_import_jobs_user_created ON public.import_jobs (user_id, created_at DESC);
CREATE INDEX idx_import_jobs_study_set_id ON public.import_jobs (study_set_id) WHERE study_set_id IS NOT NULL;
