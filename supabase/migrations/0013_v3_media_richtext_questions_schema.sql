-- ============================================================================
-- StudyHub V3.0 — Migration 0013: Multimedia Storage, Media Assets, Rich Text,
-- 12 Question Types, Shared Passages & Interactive Diagrams Schema
-- ============================================================================
-- 100% additive, backward-compatible, PG 17.12 & Supabase-MCP-safe.
-- NEVER modifies migrations 0001–0012. ZERO DROP POLICY, ZERO DROP TRIGGER.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Upgrade private `study-media` Storage bucket (images <=5 MB + audio <=10 MB, ZERO SVG/HTML)
-- ----------------------------------------------------------------------------
UPDATE storage.buckets
SET public = false,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY[
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/gif',
      'audio/mpeg',
      'audio/mp3',
      'audio/wav',
      'audio/x-wav',
      'audio/mp4',
      'audio/x-m4a',
      'audio/aac',
      'audio/webm',
      'audio/ogg'
    ]
WHERE id = 'study-media';

-- ----------------------------------------------------------------------------
-- 2. New Table: public.media_assets
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  study_set_id uuid REFERENCES public.study_sets(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('image', 'audio')),
  storage_bucket text NOT NULL DEFAULT 'study-media',
  storage_path text NOT NULL CHECK (char_length(trim(storage_path)) BETWEEN 3 AND 512),
  mime_type text NOT NULL CHECK (
    mime_type IN (
      'image/png', 'image/jpeg', 'image/webp', 'image/gif',
      'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav',
      'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/webm', 'audio/ogg'
    )
  ),
  file_name text NOT NULL CHECK (char_length(trim(file_name)) BETWEEN 1 AND 255),
  size_bytes integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  sha256_hash text CHECK (sha256_hash IS NULL OR sha256_hash ~ '^[0-9a-f]{64}$'),
  width integer CHECK (width IS NULL OR width > 0),
  height integer CHECK (height IS NULL OR height > 0),
  duration_ms integer CHECK (duration_ms IS NULL OR (duration_ms >= 0 AND duration_ms <= 600000)),
  alt_text text CHECK (alt_text IS NULL OR char_length(alt_text) <= 500),
  caption text CHECK (caption IS NULL OR char_length(caption) <= 1000),
  is_orphaned boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT media_assets_kind_size_chk CHECK (
    (kind = 'image' AND size_bytes <= 5242880 AND mime_type LIKE 'image/%')
    OR (kind = 'audio' AND size_bytes <= 10485760 AND mime_type LIKE 'audio/%')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_media_assets_bucket_path
  ON public.media_assets (storage_bucket, storage_path);
CREATE INDEX IF NOT EXISTS idx_media_assets_owner_created
  ON public.media_assets (owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_assets_study_set
  ON public.media_assets (study_set_id) WHERE study_set_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_media_assets_owner_sha256
  ON public.media_assets (owner_id, sha256_hash) WHERE sha256_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_media_assets_orphaned
  ON public.media_assets (is_orphaned) WHERE is_orphaned = true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_set_updated_at_media_assets'
      AND tgrelid = 'public.media_assets'::regclass
  ) THEN
    CREATE TRIGGER trg_set_updated_at_media_assets
      BEFORE UPDATE ON public.media_assets
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 3. New Table: public.content_media_relations
--    ON DELETE RESTRICT on media_id prevents deleting exam/question-referenced media!
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.content_media_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  media_id uuid NOT NULL REFERENCES public.media_assets(id) ON DELETE RESTRICT,
  entity_type text NOT NULL CHECK (
    entity_type IN (
      'question',
      'question_option',
      'diagram_set',
      'shared_passage',
      'exam_attempt_question',
      'profile'
    )
  ),
  entity_id uuid NOT NULL,
  role text NOT NULL CHECK (
    role IN ('prompt', 'back', 'option', 'explanation', 'hint', 'audio', 'diagram_base', 'passage')
  ),
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  alt_text text CHECK (alt_text IS NULL OR char_length(alt_text) <= 500),
  caption text CHECK (caption IS NULL OR char_length(caption) <= 1000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_content_media_rel_unique
  ON public.content_media_relations (media_id, entity_type, entity_id, role);
CREATE INDEX IF NOT EXISTS idx_content_media_rel_entity
  ON public.content_media_relations (entity_type, entity_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_content_media_rel_media
  ON public.content_media_relations (media_id);

-- ----------------------------------------------------------------------------
-- 4. New Table: public.shared_passages
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.shared_passages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  study_set_id uuid NOT NULL REFERENCES public.study_sets(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 200),
  content_text text NOT NULL CHECK (char_length(trim(content_text)) BETWEEN 1 AND 40000),
  content_rich jsonb,
  audio_media_id uuid REFERENCES public.media_assets(id) ON DELETE SET NULL,
  transcript text CHECK (transcript IS NULL OR char_length(transcript) <= 40000),
  source_reference text CHECK (source_reference IS NULL OR char_length(source_reference) <= 500),
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shared_passages_set_order
  ON public.shared_passages (study_set_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_shared_passages_owner
  ON public.shared_passages (owner_id);
CREATE INDEX IF NOT EXISTS idx_shared_passages_audio_media
  ON public.shared_passages (audio_media_id) WHERE audio_media_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_set_updated_at_shared_passages'
      AND tgrelid = 'public.shared_passages'::regclass
  ) THEN
    CREATE TRIGGER trg_set_updated_at_shared_passages
      BEFORE UPDATE ON public.shared_passages
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 5. New Tables: public.diagram_sets & public.diagram_hotspots
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.diagram_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  study_set_id uuid NOT NULL REFERENCES public.study_sets(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 200),
  description text CHECK (description IS NULL OR char_length(description) <= 2000),
  base_media_id uuid REFERENCES public.media_assets(id) ON DELETE SET NULL,
  base_image_url text NOT NULL CHECK (
    base_image_url ~* '^(https://|/[^/\\]|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)'
  ),
  image_width integer CHECK (image_width IS NULL OR image_width > 0),
  image_height integer CHECK (image_height IS NULL OR image_height > 0),
  content_version integer NOT NULL DEFAULT 1 CHECK (content_version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_diagram_sets_study_set
  ON public.diagram_sets (study_set_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_diagram_sets_owner
  ON public.diagram_sets (owner_id);
CREATE INDEX IF NOT EXISTS idx_diagram_sets_base_media
  ON public.diagram_sets (base_media_id) WHERE base_media_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_set_updated_at_diagram_sets'
      AND tgrelid = 'public.diagram_sets'::regclass
  ) THEN
    CREATE TRIGGER trg_set_updated_at_diagram_sets
      BEFORE UPDATE ON public.diagram_sets
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.diagram_hotspots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  diagram_id uuid NOT NULL REFERENCES public.diagram_sets(id) ON DELETE CASCADE,
  study_set_id uuid NOT NULL REFERENCES public.study_sets(id) ON DELETE CASCADE,
  label text NOT NULL CHECK (char_length(trim(label)) BETWEEN 1 AND 200),
  accepted_alternatives text[] NOT NULL DEFAULT '{}'::text[],
  description text CHECK (description IS NULL OR char_length(description) <= 2000),
  hint text CHECK (hint IS NULL OR char_length(hint) <= 500),
  shape text NOT NULL CHECK (shape IN ('point', 'rect', 'polygon')),
  geometry jsonb NOT NULL,
  sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_diagram_hotspots_diagram_order
  ON public.diagram_hotspots (diagram_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_diagram_hotspots_study_set
  ON public.diagram_hotspots (study_set_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_set_updated_at_diagram_hotspots'
      AND tgrelid = 'public.diagram_hotspots'::regclass
  ) THEN
    CREATE TRIGGER trg_set_updated_at_diagram_hotspots
      BEFORE UPDATE ON public.diagram_hotspots
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 6. Additive Columns & Widened CHECKs on Existing Tables
-- ----------------------------------------------------------------------------

-- 6a. study_sets.content_version (for offline download invalidation)
ALTER TABLE public.study_sets
  ADD COLUMN IF NOT EXISTS content_version integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'study_sets_content_version_chk'
      AND conrelid = 'public.study_sets'::regclass
  ) THEN
    ALTER TABLE public.study_sets
      ADD CONSTRAINT study_sets_content_version_chk CHECK (content_version >= 1);
  END IF;
END $$;

-- 6b. user_preferences V3 columns
ALTER TABLE public.user_preferences
  ADD COLUMN IF NOT EXISTS confidence_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS mode_preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS progress_generation integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_preferences_progress_generation_chk'
      AND conrelid = 'public.user_preferences'::regclass
  ) THEN
    ALTER TABLE public.user_preferences
      ADD CONSTRAINT user_preferences_progress_generation_chk CHECK (progress_generation >= 1);
  END IF;
END $$;

-- 6c. questions V3 rich text, multimedia, passage/diagram links, type_payload, 13 question types, image/audio-only prompt support
ALTER TABLE public.questions
  ADD COLUMN IF NOT EXISTS prompt_rich jsonb,
  ADD COLUMN IF NOT EXISTS back_rich jsonb,
  ADD COLUMN IF NOT EXISTS explanation_rich jsonb,
  ADD COLUMN IF NOT EXISTS hint_rich jsonb,
  ADD COLUMN IF NOT EXISTS audio_media_id uuid REFERENCES public.media_assets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS audio_url text,
  ADD COLUMN IF NOT EXISTS audio_transcript text,
  ADD COLUMN IF NOT EXISTS passage_id uuid REFERENCES public.shared_passages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS diagram_id uuid REFERENCES public.diagram_sets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS type_payload jsonb;

CREATE INDEX IF NOT EXISTS idx_questions_audio_media_id
  ON public.questions (audio_media_id) WHERE audio_media_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_questions_passage_id
  ON public.questions (passage_id) WHERE passage_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_questions_diagram_id
  ON public.questions (diagram_id) WHERE diagram_id IS NOT NULL;

DO $$
DECLARE
  v_conname text;
BEGIN
  -- Widen questions.question_type CHECK to all 13 V3 types
  FOR v_conname IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.questions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%question_type%'
      AND conname <> 'questions_question_type_v3_chk'
  LOOP
    EXECUTE format('ALTER TABLE public.questions DROP CONSTRAINT %I', v_conname);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'questions_question_type_v3_chk'
      AND conrelid = 'public.questions'::regclass
  ) THEN
    ALTER TABLE public.questions
      ADD CONSTRAINT questions_question_type_v3_chk
      CHECK (
        question_type IN (
          'single_choice', 'multiple_choice', 'true_false', 'flashcard', 'short_answer',
          'fill_in_blank', 'numerical', 'image_choice', 'ordering', 'matching',
          'image_hotspot', 'reading_passage', 'listening'
        )
      );
  END IF;

  -- Widen questions.prompt CHECK so image-only / audio-only / diagram-only questions are permitted
  FOR v_conname IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.questions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%char_length(trim(prompt))%'
      AND conname <> 'questions_prompt_or_media_v3_chk'
  LOOP
    EXECUTE format('ALTER TABLE public.questions DROP CONSTRAINT %I', v_conname);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'questions_prompt_or_media_v3_chk'
      AND conrelid = 'public.questions'::regclass
  ) THEN
    ALTER TABLE public.questions
      ADD CONSTRAINT questions_prompt_or_media_v3_chk
      CHECK (
        char_length(prompt) <= 10000
        AND (
          char_length(trim(prompt)) >= 1
          OR prompt_image_url IS NOT NULL
          OR audio_media_id IS NOT NULL
          OR audio_url IS NOT NULL
          OR diagram_id IS NOT NULL
        )
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'questions_audio_url_safe_chk'
      AND conrelid = 'public.questions'::regclass
  ) THEN
    ALTER TABLE public.questions
      ADD CONSTRAINT questions_audio_url_safe_chk
      CHECK (
        audio_url IS NULL
        OR audio_url ~* '^(https://|/[^/\\]|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)'
      ) NOT VALID;
  END IF;
END $$;

-- 6d. question_options V3 rich text, media_id, image_alt, image-only option support
ALTER TABLE public.question_options
  ADD COLUMN IF NOT EXISTS content_rich jsonb,
  ADD COLUMN IF NOT EXISTS media_id uuid REFERENCES public.media_assets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS image_alt text;

CREATE INDEX IF NOT EXISTS idx_question_options_media_id
  ON public.question_options (media_id) WHERE media_id IS NOT NULL;

DO $$
DECLARE
  v_conname text;
BEGIN
  FOR v_conname IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.question_options'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%char_length(trim(content))%'
      AND conname <> 'question_options_content_or_image_v3_chk'
  LOOP
    EXECUTE format('ALTER TABLE public.question_options DROP CONSTRAINT %I', v_conname);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'question_options_content_or_image_v3_chk'
      AND conrelid = 'public.question_options'::regclass
  ) THEN
    ALTER TABLE public.question_options
      ADD CONSTRAINT question_options_content_or_image_v3_chk
      CHECK (
        char_length(content) <= 4000
        AND (
          char_length(trim(content)) >= 1
          OR image_url IS NOT NULL
          OR media_id IS NOT NULL
        )
      ) NOT VALID;
  END IF;
END $$;

-- 6e. exam_attempt_questions V3 snapshot columns + strict column-level anti-leak GRANTs + updated immutability trigger
ALTER TABLE public.exam_attempt_questions
  ADD COLUMN IF NOT EXISTS prompt_rich_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS audio_media_id_snapshot uuid REFERENCES public.media_assets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS audio_url_snapshot text,
  ADD COLUMN IF NOT EXISTS passage_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS diagram_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS type_payload_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS media_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS explanation_rich_snapshot jsonb;

CREATE INDEX IF NOT EXISTS idx_exam_attempt_questions_audio_media
  ON public.exam_attempt_questions (audio_media_id_snapshot)
  WHERE audio_media_id_snapshot IS NOT NULL;

-- Safe pre-submit columns ONLY; type_payload_snapshot & explanation_rich_snapshot stay strictly server-protected!
GRANT SELECT (
  prompt_rich_snapshot,
  audio_media_id_snapshot,
  audio_url_snapshot,
  passage_snapshot,
  diagram_snapshot,
  media_snapshot
) ON public.exam_attempt_questions TO authenticated;

DO $$
DECLARE
  v_conname text;
BEGIN
  FOR v_conname IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.exam_attempt_questions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%question_type%'
      AND conname <> 'exam_attempt_questions_type_v3_chk'
  LOOP
    EXECUTE format('ALTER TABLE public.exam_attempt_questions DROP CONSTRAINT %I', v_conname);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'exam_attempt_questions_type_v3_chk'
      AND conrelid = 'public.exam_attempt_questions'::regclass
  ) THEN
    ALTER TABLE public.exam_attempt_questions
      ADD CONSTRAINT exam_attempt_questions_type_v3_chk
      CHECK (
        question_type IN (
          'single_choice', 'multiple_choice', 'true_false', 'short_answer',
          'fill_in_blank', 'numerical', 'image_choice', 'ordering', 'matching',
          'image_hotspot', 'reading_passage', 'listening'
        )
      );
  END IF;
END $$;

-- Update prevent_exam_snapshot_update() to freeze ALL V1+V2+V3 snapshot columns while permitting FK ON DELETE SET NULL
CREATE OR REPLACE FUNCTION public.prevent_exam_snapshot_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (
    NEW.id IS NOT DISTINCT FROM OLD.id
    AND NEW.attempt_id IS NOT DISTINCT FROM OLD.attempt_id
    AND NEW.position IS NOT DISTINCT FROM OLD.position
    AND NEW.question_type IS NOT DISTINCT FROM OLD.question_type
    AND NEW.source_subject_title IS NOT DISTINCT FROM OLD.source_subject_title
    AND NEW.chapter_snapshot IS NOT DISTINCT FROM OLD.chapter_snapshot
    AND NEW.tags_snapshot IS NOT DISTINCT FROM OLD.tags_snapshot
    AND NEW.prompt_snapshot IS NOT DISTINCT FROM OLD.prompt_snapshot
    AND NEW.prompt_rich_snapshot IS NOT DISTINCT FROM OLD.prompt_rich_snapshot
    AND NEW.prompt_image_url_snapshot IS NOT DISTINCT FROM OLD.prompt_image_url_snapshot
    AND NEW.audio_url_snapshot IS NOT DISTINCT FROM OLD.audio_url_snapshot
    AND NEW.passage_snapshot IS NOT DISTINCT FROM OLD.passage_snapshot
    AND NEW.diagram_snapshot IS NOT DISTINCT FROM OLD.diagram_snapshot
    AND NEW.type_payload_snapshot IS NOT DISTINCT FROM OLD.type_payload_snapshot
    AND NEW.media_snapshot IS NOT DISTINCT FROM OLD.media_snapshot
    AND NEW.explanation_snapshot IS NOT DISTINCT FROM OLD.explanation_snapshot
    AND NEW.explanation_rich_snapshot IS NOT DISTINCT FROM OLD.explanation_rich_snapshot
    AND NEW.options_snapshot IS NOT DISTINCT FROM OLD.options_snapshot
    AND NEW.correct_option_ids IS NOT DISTINCT FROM OLD.correct_option_ids
    AND NEW.accepted_answers_snapshot IS NOT DISTINCT FROM OLD.accepted_answers_snapshot
    AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
    AND (NEW.question_id IS NULL OR NEW.question_id = OLD.question_id)
    AND (NEW.source_study_set_id IS NULL OR NEW.source_study_set_id = OLD.source_study_set_id)
    AND (NEW.audio_media_id_snapshot IS NULL OR NEW.audio_media_id_snapshot = OLD.audio_media_id_snapshot)
    AND (
      NEW.question_id IS DISTINCT FROM OLD.question_id
      OR NEW.source_study_set_id IS DISTINCT FROM OLD.source_study_set_id
      OR NEW.audio_media_id_snapshot IS DISTINCT FROM OLD.audio_media_id_snapshot
    )
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'exam_attempt_questions rows are immutable and cannot be updated.';
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_exam_snapshot_update() FROM PUBLIC, anon, authenticated;

-- 6f. exam_attempt_answers & study_session_answers V3 structured response + confidence + hint_used
ALTER TABLE public.exam_attempt_answers
  ADD COLUMN IF NOT EXISTS structured_response jsonb,
  ADD COLUMN IF NOT EXISTS confidence text,
  ADD COLUMN IF NOT EXISTS hint_used boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'exam_attempt_answers_confidence_chk'
      AND conrelid = 'public.exam_attempt_answers'::regclass
  ) THEN
    ALTER TABLE public.exam_attempt_answers
      ADD CONSTRAINT exam_attempt_answers_confidence_chk
      CHECK (confidence IS NULL OR confidence IN ('certain', 'unsure', 'guessing'));
  END IF;
END $$;

ALTER TABLE public.study_session_answers
  ADD COLUMN IF NOT EXISTS structured_response jsonb,
  ADD COLUMN IF NOT EXISTS confidence text,
  ADD COLUMN IF NOT EXISTS hint_used boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'study_session_answers_confidence_chk'
      AND conrelid = 'public.study_session_answers'::regclass
  ) THEN
    ALTER TABLE public.study_session_answers
      ADD CONSTRAINT study_session_answers_confidence_chk
      CHECK (confidence IS NULL OR confidence IN ('certain', 'unsure', 'guessing'));
  END IF;
END $$;

-- 6g. study_sessions.mode widened to include spell, diagram, custom_practice
DO $$
DECLARE
  v_conname text;
BEGIN
  FOR v_conname IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.study_sessions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%mode%'
      AND conname <> 'study_sessions_mode_v3_chk'
  LOOP
    EXECUTE format('ALTER TABLE public.study_sessions DROP CONSTRAINT %I', v_conname);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'study_sessions_mode_v3_chk'
      AND conrelid = 'public.study_sessions'::regclass
  ) THEN
    ALTER TABLE public.study_sessions
      ADD CONSTRAINT study_sessions_mode_v3_chk
      CHECK (
        mode IN (
          'flashcards', 'learn', 'practice', 'write', 'match', 'review',
          'spell', 'diagram', 'custom_practice'
        )
      );
  END IF;
END $$;

-- 6h. user_question_progress V3 confidence, recall & mistake tracking columns
ALTER TABLE public.user_question_progress
  ADD COLUMN IF NOT EXISTS consecutive_wrong integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_wrong_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_confidence text,
  ADD COLUMN IF NOT EXISTS low_confidence_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS high_conf_wrong_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS guess_correct_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS independent_recall_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS hint_used_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mistake_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS progress_generation integer NOT NULL DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uqp_v3_metrics_chk'
      AND conrelid = 'public.user_question_progress'::regclass
  ) THEN
    ALTER TABLE public.user_question_progress
      ADD CONSTRAINT uqp_v3_metrics_chk CHECK (
        consecutive_wrong >= 0
        AND low_confidence_count >= 0
        AND high_conf_wrong_count >= 0
        AND guess_correct_count >= 0
        AND independent_recall_count >= 0
        AND hint_used_count >= 0
        AND progress_generation >= 1
        AND (last_confidence IS NULL OR last_confidence IN ('certain', 'unsure', 'guessing'))
        AND mistake_status IN ('active', 'improving', 'resolved')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_uqp_user_mistake_status
  ON public.user_question_progress (user_id, mistake_status, updated_at DESC)
  WHERE wrong_count > 0;

-- 6i. import_jobs.source_format widened to include pdf_text & docx_multimedia
DO $$
DECLARE
  v_conname text;
BEGIN
  FOR v_conname IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.import_jobs'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%source_format%'
      AND conname <> 'import_jobs_source_format_v3_chk'
  LOOP
    EXECUTE format('ALTER TABLE public.import_jobs DROP CONSTRAINT %I', v_conname);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'import_jobs_source_format_v3_chk'
      AND conrelid = 'public.import_jobs'::regclass
  ) THEN
    ALTER TABLE public.import_jobs
      ADD CONSTRAINT import_jobs_source_format_v3_chk
      CHECK (
        source_format IN (
          'eduquiz_txt', 'word_answer_key', 'docx_ooxml', 'xlsx_wayground',
          'xlsx_generic', 'quizlet_tsv', 'csv', 'json', 'txt_generic',
          'pdf_text', 'docx_multimedia'
        )
      );
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 7. Strict RLS on All 5 New V3 Media/Passage/Diagram Tables + Historical Exam Media Access
--    (ZERO DROP POLICY, ZERO recursion, direct owner short-circuit on INSERT...RETURNING!)
-- ----------------------------------------------------------------------------
ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_media_relations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shared_passages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diagram_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diagram_hotspots ENABLE ROW LEVEL SECURITY;

-- Hardened helper allowing authenticated exam takers to read media linked to their own exam snapshots
CREATE OR REPLACE FUNCTION public.can_read_exam_snapshot_media(
  p_storage_path text,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_storage_path IS NULL OR p_user_id IS NULL THEN false
    WHEN public.current_jwt_role() IN ('anon', 'authenticated', 'authenticator')
         AND p_user_id IS DISTINCT FROM (SELECT auth.uid()) THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.media_assets ma
      JOIN public.content_media_relations cmr
        ON cmr.media_id = ma.id
       AND cmr.entity_type = 'exam_attempt_question'
      JOIN public.exam_attempt_questions eaq
        ON eaq.id = cmr.entity_id
      JOIN public.exam_attempts ea
        ON ea.id = eaq.attempt_id
      WHERE ma.storage_bucket = 'study-media'
        AND ma.storage_path = p_storage_path
        AND ea.user_id = p_user_id
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.can_read_exam_snapshot_media(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_exam_snapshot_media(text, uuid) TO authenticated, service_role;

-- Hardened helper to authorize content_media_relations rows cleanly without RLS recursion
CREATE OR REPLACE FUNCTION public.can_read_media_asset(
  p_media_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_media_id IS NULL OR p_user_id IS NULL THEN false
    WHEN public.current_jwt_role() IN ('anon', 'authenticated', 'authenticator')
         AND p_user_id IS DISTINCT FROM (SELECT auth.uid()) THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.media_assets ma
      WHERE ma.id = p_media_id
        AND (
          ma.owner_id = p_user_id
          OR (ma.study_set_id IS NOT NULL AND public.can_read_study_set(ma.study_set_id, p_user_id))
          OR public.can_read_exam_snapshot_media(ma.storage_path, p_user_id)
        )
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.can_read_media_asset(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_media_asset(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.can_edit_media_asset(
  p_media_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_media_id IS NULL OR p_user_id IS NULL THEN false
    WHEN public.current_jwt_role() IN ('anon', 'authenticated', 'authenticator')
         AND p_user_id IS DISTINCT FROM (SELECT auth.uid()) THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.media_assets ma
      WHERE ma.id = p_media_id
        AND (
          ma.owner_id = p_user_id
          OR (ma.study_set_id IS NOT NULL AND public.can_edit_study_set(ma.study_set_id, p_user_id))
        )
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.can_edit_media_asset(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_edit_media_asset(uuid, uuid) TO authenticated, service_role;

-- Upgrade storage.objects SELECT policy cleanly via ALTER POLICY to support historical exam snapshot media
ALTER POLICY "study_media_select" ON storage.objects
  USING (
    bucket_id = 'study-media'
    AND (
      (
        (storage.foldername(name))[1] = 'avatars'
        AND public.is_strict_uuid((storage.foldername(name))[2])
        AND public.can_view_profile(((storage.foldername(name))[2])::uuid, (SELECT auth.uid()))
      )
      OR public.can_access_study_media_path(
        (storage.foldername(name))[1],
        (storage.foldername(name))[2],
        false
      )
      OR public.can_read_exam_snapshot_media(name, (SELECT auth.uid()))
    )
  );

-- Idempotent policies on media_assets, content_media_relations, shared_passages, diagram_sets, diagram_hotspots
DO $$
BEGIN
  -- media_assets
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'media_assets' AND policyname = 'media_assets_select_readable') THEN
    CREATE POLICY "media_assets_select_readable"
      ON public.media_assets FOR SELECT
      TO authenticated
      USING (
        owner_id = (SELECT auth.uid())
        OR (study_set_id IS NOT NULL AND public.can_read_study_set(study_set_id, (SELECT auth.uid())))
        OR public.can_read_exam_snapshot_media(storage_path, (SELECT auth.uid()))
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'media_assets' AND policyname = 'media_assets_insert_own') THEN
    CREATE POLICY "media_assets_insert_own"
      ON public.media_assets FOR INSERT
      TO authenticated
      WITH CHECK (
        owner_id = (SELECT auth.uid())
        AND (study_set_id IS NULL OR public.can_edit_study_set(study_set_id, (SELECT auth.uid())))
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'media_assets' AND policyname = 'media_assets_update_editable') THEN
    CREATE POLICY "media_assets_update_editable"
      ON public.media_assets FOR UPDATE
      TO authenticated
      USING (
        owner_id = (SELECT auth.uid())
        OR (study_set_id IS NOT NULL AND public.can_edit_study_set(study_set_id, (SELECT auth.uid())))
      )
      WITH CHECK (
        owner_id = (SELECT auth.uid())
        OR (study_set_id IS NOT NULL AND public.can_edit_study_set(study_set_id, (SELECT auth.uid())))
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'media_assets' AND policyname = 'media_assets_delete_owner') THEN
    CREATE POLICY "media_assets_delete_owner"
      ON public.media_assets FOR DELETE
      TO authenticated
      USING (
        owner_id = (SELECT auth.uid())
        OR (study_set_id IS NOT NULL AND public.is_study_set_owner(study_set_id, (SELECT auth.uid())))
      );
  END IF;

  -- content_media_relations
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'content_media_relations' AND policyname = 'content_media_relations_select_readable') THEN
    CREATE POLICY "content_media_relations_select_readable"
      ON public.content_media_relations FOR SELECT
      TO authenticated
      USING (public.can_read_media_asset(media_id, (SELECT auth.uid())));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'content_media_relations' AND policyname = 'content_media_relations_insert_editable') THEN
    CREATE POLICY "content_media_relations_insert_editable"
      ON public.content_media_relations FOR INSERT
      TO authenticated
      WITH CHECK (
        entity_type <> 'exam_attempt_question'
        AND public.can_edit_media_asset(media_id, (SELECT auth.uid()))
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'content_media_relations' AND policyname = 'content_media_relations_update_editable') THEN
    CREATE POLICY "content_media_relations_update_editable"
      ON public.content_media_relations FOR UPDATE
      TO authenticated
      USING (
        entity_type <> 'exam_attempt_question'
        AND public.can_edit_media_asset(media_id, (SELECT auth.uid()))
      )
      WITH CHECK (
        entity_type <> 'exam_attempt_question'
        AND public.can_edit_media_asset(media_id, (SELECT auth.uid()))
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'content_media_relations' AND policyname = 'content_media_relations_delete_editable') THEN
    CREATE POLICY "content_media_relations_delete_editable"
      ON public.content_media_relations FOR DELETE
      TO authenticated
      USING (
        entity_type <> 'exam_attempt_question'
        AND public.can_edit_media_asset(media_id, (SELECT auth.uid()))
      );
  END IF;

  -- shared_passages
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'shared_passages' AND policyname = 'shared_passages_select_readable') THEN
    CREATE POLICY "shared_passages_select_readable"
      ON public.shared_passages FOR SELECT
      TO authenticated
      USING (
        owner_id = (SELECT auth.uid())
        OR public.can_read_study_set(study_set_id, (SELECT auth.uid()))
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'shared_passages' AND policyname = 'shared_passages_insert_editable') THEN
    CREATE POLICY "shared_passages_insert_editable"
      ON public.shared_passages FOR INSERT
      TO authenticated
      WITH CHECK (
        owner_id = (SELECT auth.uid())
        AND public.can_edit_study_set(study_set_id, (SELECT auth.uid()))
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'shared_passages' AND policyname = 'shared_passages_update_editable') THEN
    CREATE POLICY "shared_passages_update_editable"
      ON public.shared_passages FOR UPDATE
      TO authenticated
      USING (public.can_edit_study_set(study_set_id, (SELECT auth.uid())))
      WITH CHECK (public.can_edit_study_set(study_set_id, (SELECT auth.uid())));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'shared_passages' AND policyname = 'shared_passages_delete_editable') THEN
    CREATE POLICY "shared_passages_delete_editable"
      ON public.shared_passages FOR DELETE
      TO authenticated
      USING (public.can_edit_study_set(study_set_id, (SELECT auth.uid())));
  END IF;

  -- diagram_sets
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'diagram_sets' AND policyname = 'diagram_sets_select_readable') THEN
    CREATE POLICY "diagram_sets_select_readable"
      ON public.diagram_sets FOR SELECT
      TO authenticated
      USING (
        owner_id = (SELECT auth.uid())
        OR public.can_read_study_set(study_set_id, (SELECT auth.uid()))
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'diagram_sets' AND policyname = 'diagram_sets_insert_editable') THEN
    CREATE POLICY "diagram_sets_insert_editable"
      ON public.diagram_sets FOR INSERT
      TO authenticated
      WITH CHECK (
        owner_id = (SELECT auth.uid())
        AND public.can_edit_study_set(study_set_id, (SELECT auth.uid()))
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'diagram_sets' AND policyname = 'diagram_sets_update_editable') THEN
    CREATE POLICY "diagram_sets_update_editable"
      ON public.diagram_sets FOR UPDATE
      TO authenticated
      USING (public.can_edit_study_set(study_set_id, (SELECT auth.uid())))
      WITH CHECK (public.can_edit_study_set(study_set_id, (SELECT auth.uid())));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'diagram_sets' AND policyname = 'diagram_sets_delete_editable') THEN
    CREATE POLICY "diagram_sets_delete_editable"
      ON public.diagram_sets FOR DELETE
      TO authenticated
      USING (public.can_edit_study_set(study_set_id, (SELECT auth.uid())));
  END IF;

  -- diagram_hotspots
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'diagram_hotspots' AND policyname = 'diagram_hotspots_select_readable') THEN
    CREATE POLICY "diagram_hotspots_select_readable"
      ON public.diagram_hotspots FOR SELECT
      TO authenticated
      USING (public.can_read_study_set(study_set_id, (SELECT auth.uid())));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'diagram_hotspots' AND policyname = 'diagram_hotspots_insert_editable') THEN
    CREATE POLICY "diagram_hotspots_insert_editable"
      ON public.diagram_hotspots FOR INSERT
      TO authenticated
      WITH CHECK (public.can_edit_study_set(study_set_id, (SELECT auth.uid())));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'diagram_hotspots' AND policyname = 'diagram_hotspots_update_editable') THEN
    CREATE POLICY "diagram_hotspots_update_editable"
      ON public.diagram_hotspots FOR UPDATE
      TO authenticated
      USING (public.can_edit_study_set(study_set_id, (SELECT auth.uid())))
      WITH CHECK (public.can_edit_study_set(study_set_id, (SELECT auth.uid())));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'diagram_hotspots' AND policyname = 'diagram_hotspots_delete_editable') THEN
    CREATE POLICY "diagram_hotspots_delete_editable"
      ON public.diagram_hotspots FOR DELETE
      TO authenticated
      USING (public.can_edit_study_set(study_set_id, (SELECT auth.uid())));
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 8. Polymorphic Cleanup Triggers for `content_media_relations`
--    Preserves `ON DELETE RESTRICT` while an exam snapshot/entity still exists,
--    and cleans up relations cleanly when an exam attempt, question, or user account is deleted!
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.cleanup_entity_media_relations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.content_media_relations
  WHERE entity_type = TG_ARGV[0]
    AND entity_id = OLD.id;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_entity_media_relations() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cleanup_profile_media_relations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Clear relations on media owned by the account being deleted so media_assets cascades cleanly
  DELETE FROM public.content_media_relations cmr
  USING public.media_assets ma
  WHERE cmr.media_id = ma.id
    AND ma.owner_id = OLD.id;
  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_profile_media_relations() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_cleanup_media_rel_exam_q' AND tgrelid = 'public.exam_attempt_questions'::regclass) THEN
    CREATE TRIGGER trg_cleanup_media_rel_exam_q
      BEFORE DELETE ON public.exam_attempt_questions
      FOR EACH ROW EXECUTE FUNCTION public.cleanup_entity_media_relations('exam_attempt_question');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_cleanup_media_rel_question' AND tgrelid = 'public.questions'::regclass) THEN
    CREATE TRIGGER trg_cleanup_media_rel_question
      BEFORE DELETE ON public.questions
      FOR EACH ROW EXECUTE FUNCTION public.cleanup_entity_media_relations('question');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_cleanup_media_rel_option' AND tgrelid = 'public.question_options'::regclass) THEN
    CREATE TRIGGER trg_cleanup_media_rel_option
      BEFORE DELETE ON public.question_options
      FOR EACH ROW EXECUTE FUNCTION public.cleanup_entity_media_relations('question_option');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_cleanup_media_rel_diagram' AND tgrelid = 'public.diagram_sets'::regclass) THEN
    CREATE TRIGGER trg_cleanup_media_rel_diagram
      BEFORE DELETE ON public.diagram_sets
      FOR EACH ROW EXECUTE FUNCTION public.cleanup_entity_media_relations('diagram_set');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_cleanup_media_rel_passage' AND tgrelid = 'public.shared_passages'::regclass) THEN
    CREATE TRIGGER trg_cleanup_media_rel_passage
      BEFORE DELETE ON public.shared_passages
      FOR EACH ROW EXECUTE FUNCTION public.cleanup_entity_media_relations('shared_passage');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_cleanup_media_rel_profile' AND tgrelid = 'public.profiles'::regclass) THEN
    CREATE TRIGGER trg_cleanup_media_rel_profile
      BEFORE DELETE ON public.profiles
      FOR EACH ROW EXECUTE FUNCTION public.cleanup_profile_media_relations();
  END IF;
END $$;

