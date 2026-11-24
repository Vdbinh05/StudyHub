-- ============================================================================
-- StudyHub V3.0 — Migration 0014: Private Personal Notes, Question Reports,
-- Learning Session Checkpoints, Confidence Events & Offline Sync Ledger
-- ============================================================================
-- 100% additive, backward-compatible, PG 17.12 & Supabase-MCP-safe.
-- NEVER modifies migrations 0001–0012. ZERO DROP POLICY, ZERO DROP TRIGGER.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. public.user_question_notes (strictly private to each learner)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_question_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  study_set_id uuid NOT NULL REFERENCES public.study_sets(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  content_text text NOT NULL CHECK (char_length(content_text) <= 10000),
  content_rich jsonb,
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_question_notes_unique_user_q UNIQUE (user_id, question_id),
  CONSTRAINT user_question_notes_set_q_composite_fkey
    FOREIGN KEY (study_set_id, question_id)
    REFERENCES public.questions (study_set_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_question_notes_user_updated
  ON public.user_question_notes (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_question_notes_set_question
  ON public.user_question_notes (study_set_id, question_id);
CREATE INDEX IF NOT EXISTS idx_user_question_notes_question
  ON public.user_question_notes (question_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_set_updated_at_user_question_notes'
      AND tgrelid = 'public.user_question_notes'::regclass
  ) THEN
    CREATE TRIGGER trg_set_updated_at_user_question_notes
      BEFORE UPDATE ON public.user_question_notes
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. public.question_reports (9 categories; visible only to reporter + set owner/editor)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.question_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  study_set_id uuid NOT NULL REFERENCES public.study_sets(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  reporter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  category text NOT NULL CHECK (
    category IN (
      'wrong_answer',
      'typo_formatting',
      'missing_media',
      'broken_audio',
      'ambiguous_wording',
      'duplicate_question',
      'wrong_chapter_tag',
      'diagram_hotspot_error',
      'other'
    )
  ),
  description text NOT NULL CHECK (char_length(trim(description)) BETWEEN 3 AND 2000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')),
  resolution_note text CHECK (resolution_note IS NULL OR char_length(resolution_note) <= 2000),
  resolved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT question_reports_set_q_composite_fkey
    FOREIGN KEY (study_set_id, question_id)
    REFERENCES public.questions (study_set_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_question_reports_set_status
  ON public.question_reports (study_set_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_question_reports_set_question
  ON public.question_reports (study_set_id, question_id);
CREATE INDEX IF NOT EXISTS idx_question_reports_question
  ON public.question_reports (question_id);
CREATE INDEX IF NOT EXISTS idx_question_reports_reporter
  ON public.question_reports (reporter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_question_reports_resolved_by
  ON public.question_reports (resolved_by) WHERE resolved_by IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_set_updated_at_question_reports'
      AND tgrelid = 'public.question_reports'::regclass
  ) THEN
    CREATE TRIGGER trg_set_updated_at_question_reports
      BEFORE UPDATE ON public.question_reports
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 3. public.learning_session_checkpoints (resume learning across refreshes/devices)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.learning_session_checkpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  study_set_id uuid REFERENCES public.study_sets(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (
    mode IN (
      'flashcards', 'learn', 'practice', 'write', 'match', 'review',
      'spell', 'diagram', 'custom_practice'
    )
  ),
  session_key text NOT NULL CHECK (char_length(trim(session_key)) BETWEEN 1 AND 120),
  state_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  progress_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  current_index integer NOT NULL DEFAULT 0 CHECK (current_index >= 0),
  total_items integer NOT NULL DEFAULT 0 CHECK (total_items >= 0),
  device_id text CHECK (device_id IS NULL OR char_length(device_id) <= 120),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT learning_session_checkpoints_user_key_unique UNIQUE (user_id, session_key)
);

CREATE INDEX IF NOT EXISTS idx_lsc_user_updated
  ON public.learning_session_checkpoints (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_lsc_study_set
  ON public.learning_session_checkpoints (study_set_id) WHERE study_set_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_set_updated_at_lsc'
      AND tgrelid = 'public.learning_session_checkpoints'::regclass
  ) THEN
    CREATE TRIGGER trg_set_updated_at_lsc
      BEFORE UPDATE ON public.learning_session_checkpoints
      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 4. public.learning_confidence_events (confidence analytics, strictly private)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.learning_confidence_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  study_set_id uuid NOT NULL REFERENCES public.study_sets(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.questions(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (
    mode IN (
      'flashcards', 'learn', 'practice', 'write', 'match', 'review',
      'spell', 'diagram', 'custom_practice', 'exam'
    )
  ),
  confidence text NOT NULL CHECK (confidence IN ('certain', 'unsure', 'guessing')),
  is_correct boolean NOT NULL,
  hint_used boolean NOT NULL DEFAULT false,
  response_time_ms integer CHECK (response_time_ms IS NULL OR response_time_ms >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lce_set_q_composite_fkey
    FOREIGN KEY (study_set_id, question_id)
    REFERENCES public.questions (study_set_id, id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_lce_user_created
  ON public.learning_confidence_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lce_user_set_q
  ON public.learning_confidence_events (user_id, study_set_id, question_id);
CREATE INDEX IF NOT EXISTS idx_lce_set_question
  ON public.learning_confidence_events (study_set_id, question_id);
CREATE INDEX IF NOT EXISTS idx_lce_question
  ON public.learning_confidence_events (question_id);

-- ----------------------------------------------------------------------------
-- 5. public.learning_sync_events (idempotent offline sync event ledger)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.learning_sync_events (
  event_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (
    event_type IN (
      'answer',
      'confidence',
      'star',
      'note_upsert',
      'checkpoint_upsert',
      'mistake_resolve'
    )
  ),
  study_set_id uuid REFERENCES public.study_sets(id) ON DELETE SET NULL,
  question_id uuid REFERENCES public.questions(id) ON DELETE SET NULL,
  client_timestamp timestamptz NOT NULL,
  progress_generation integer NOT NULL DEFAULT 1 CHECK (progress_generation >= 1),
  status text NOT NULL DEFAULT 'applied' CHECK (
    status IN (
      'applied',
      'duplicate_ignored',
      'ignored_stale_reset',
      'rejected_revoked',
      'rejected_deleted',
      'conflict',
      'invalid'
    )
  ),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result_detail jsonb,
  processed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lse_user_processed
  ON public.learning_sync_events (user_id, processed_at DESC);
CREATE INDEX IF NOT EXISTS idx_lse_study_set
  ON public.learning_sync_events (study_set_id) WHERE study_set_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lse_question
  ON public.learning_sync_events (question_id) WHERE question_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 6. Strict RLS on All 5 New Learning / Notes / Reports / Sync Tables
-- ----------------------------------------------------------------------------
ALTER TABLE public.user_question_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_session_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_confidence_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.learning_sync_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- user_question_notes (STRICTLY private to owner user_id = auth.uid())
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_question_notes' AND policyname = 'user_question_notes_select_own') THEN
    CREATE POLICY "user_question_notes_select_own"
      ON public.user_question_notes FOR SELECT
      TO authenticated
      USING (user_id = (SELECT auth.uid()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_question_notes' AND policyname = 'user_question_notes_insert_own') THEN
    CREATE POLICY "user_question_notes_insert_own"
      ON public.user_question_notes FOR INSERT
      TO authenticated
      WITH CHECK (
        user_id = (SELECT auth.uid())
        AND public.can_read_study_set(study_set_id, (SELECT auth.uid()))
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_question_notes' AND policyname = 'user_question_notes_update_own') THEN
    CREATE POLICY "user_question_notes_update_own"
      ON public.user_question_notes FOR UPDATE
      TO authenticated
      USING (user_id = (SELECT auth.uid()))
      WITH CHECK (
        user_id = (SELECT auth.uid())
        AND public.can_read_study_set(study_set_id, (SELECT auth.uid()))
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'user_question_notes' AND policyname = 'user_question_notes_delete_own') THEN
    CREATE POLICY "user_question_notes_delete_own"
      ON public.user_question_notes FOR DELETE
      TO authenticated
      USING (user_id = (SELECT auth.uid()));
  END IF;

  -- question_reports (reporter + set owner/editor only)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'question_reports' AND policyname = 'question_reports_select_authorized') THEN
    CREATE POLICY "question_reports_select_authorized"
      ON public.question_reports FOR SELECT
      TO authenticated
      USING (
        reporter_id = (SELECT auth.uid())
        OR public.can_edit_study_set(study_set_id, (SELECT auth.uid()))
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'question_reports' AND policyname = 'question_reports_insert_reader') THEN
    CREATE POLICY "question_reports_insert_reader"
      ON public.question_reports FOR INSERT
      TO authenticated
      WITH CHECK (
        reporter_id = (SELECT auth.uid())
        AND status = 'open'
        AND resolved_by IS NULL
        AND public.can_read_study_set(study_set_id, (SELECT auth.uid()))
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'question_reports' AND policyname = 'question_reports_update_editor') THEN
    CREATE POLICY "question_reports_update_editor"
      ON public.question_reports FOR UPDATE
      TO authenticated
      USING (public.can_edit_study_set(study_set_id, (SELECT auth.uid())))
      WITH CHECK (public.can_edit_study_set(study_set_id, (SELECT auth.uid())));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'question_reports' AND policyname = 'question_reports_delete_authorized') THEN
    CREATE POLICY "question_reports_delete_authorized"
      ON public.question_reports FOR DELETE
      TO authenticated
      USING (
        reporter_id = (SELECT auth.uid())
        OR public.is_study_set_owner(study_set_id, (SELECT auth.uid()))
      );
  END IF;

  -- learning_session_checkpoints (strictly private to user_id)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'learning_session_checkpoints' AND policyname = 'lsc_select_own') THEN
    CREATE POLICY "lsc_select_own"
      ON public.learning_session_checkpoints FOR SELECT
      TO authenticated
      USING (user_id = (SELECT auth.uid()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'learning_session_checkpoints' AND policyname = 'lsc_insert_own') THEN
    CREATE POLICY "lsc_insert_own"
      ON public.learning_session_checkpoints FOR INSERT
      TO authenticated
      WITH CHECK (
        user_id = (SELECT auth.uid())
        AND (study_set_id IS NULL OR public.can_read_study_set(study_set_id, (SELECT auth.uid())))
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'learning_session_checkpoints' AND policyname = 'lsc_update_own') THEN
    CREATE POLICY "lsc_update_own"
      ON public.learning_session_checkpoints FOR UPDATE
      TO authenticated
      USING (user_id = (SELECT auth.uid()))
      WITH CHECK (
        user_id = (SELECT auth.uid())
        AND (study_set_id IS NULL OR public.can_read_study_set(study_set_id, (SELECT auth.uid())))
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'learning_session_checkpoints' AND policyname = 'lsc_delete_own') THEN
    CREATE POLICY "lsc_delete_own"
      ON public.learning_session_checkpoints FOR DELETE
      TO authenticated
      USING (user_id = (SELECT auth.uid()));
  END IF;

  -- learning_confidence_events (strictly private to user_id)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'learning_confidence_events' AND policyname = 'lce_select_own') THEN
    CREATE POLICY "lce_select_own"
      ON public.learning_confidence_events FOR SELECT
      TO authenticated
      USING (user_id = (SELECT auth.uid()));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'learning_confidence_events' AND policyname = 'lce_insert_own') THEN
    CREATE POLICY "lce_insert_own"
      ON public.learning_confidence_events FOR INSERT
      TO authenticated
      WITH CHECK (
        user_id = (SELECT auth.uid())
        AND public.can_read_study_set(study_set_id, (SELECT auth.uid()))
      );
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'learning_confidence_events' AND policyname = 'lce_delete_own') THEN
    CREATE POLICY "lce_delete_own"
      ON public.learning_confidence_events FOR DELETE
      TO authenticated
      USING (user_id = (SELECT auth.uid()));
  END IF;

  -- learning_sync_events (strictly private SELECT own; mutations via sync_offline_learning_events RPC)
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'learning_sync_events' AND policyname = 'lse_select_own') THEN
    CREATE POLICY "lse_select_own"
      ON public.learning_sync_events FOR SELECT
      TO authenticated
      USING (user_id = (SELECT auth.uid()));
  END IF;
END $$;
