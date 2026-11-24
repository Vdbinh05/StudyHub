-- ============================================================================
-- StudyHub V2.0 — Migration 0005: Universal Custom Exam Engine, Exam Presets,
-- Full Coverage Cycles, Multi-Subject Practice & V1.0 Security/Scale Hardening
-- ============================================================================
-- Non-destructive, backwards-compatible, idempotent where applicable.
-- Migrations 0001–0004 remain strictly untouched.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================================
-- PART A: V1.0 Security, RLS, Referential Integrity & Performance Hardening
-- ============================================================================

-- ----------------------------------------------------------------------------
-- A1. Composite unique keys & foreign keys (fixes SH-012 / SEC-003, SH-040 / SEC-016)
-- Prevents cross-tenant injection via mismatched denormalized study_set_id / attempt_id.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'questions_set_id_id_unique'
      AND conrelid = 'public.questions'::regclass
  ) THEN
    ALTER TABLE public.questions
      ADD CONSTRAINT questions_set_id_id_unique UNIQUE (study_set_id, id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'exam_attempt_questions_attempt_id_id_unique'
      AND conrelid = 'public.exam_attempt_questions'::regclass
  ) THEN
    ALTER TABLE public.exam_attempt_questions
      ADD CONSTRAINT exam_attempt_questions_attempt_id_id_unique UNIQUE (attempt_id, id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'question_options_set_q_composite_fkey'
      AND conrelid = 'public.question_options'::regclass
  ) THEN
    ALTER TABLE public.question_options
      ADD CONSTRAINT question_options_set_q_composite_fkey
      FOREIGN KEY (study_set_id, question_id)
      REFERENCES public.questions (study_set_id, id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'question_accepted_answers_set_q_composite_fkey'
      AND conrelid = 'public.question_accepted_answers'::regclass
  ) THEN
    ALTER TABLE public.question_accepted_answers
      ADD CONSTRAINT question_accepted_answers_set_q_composite_fkey
      FOREIGN KEY (study_set_id, question_id)
      REFERENCES public.questions (study_set_id, id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'question_tags_set_q_composite_fkey'
      AND conrelid = 'public.question_tags'::regclass
  ) THEN
    ALTER TABLE public.question_tags
      ADD CONSTRAINT question_tags_set_q_composite_fkey
      FOREIGN KEY (study_set_id, question_id)
      REFERENCES public.questions (study_set_id, id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_question_progress_set_q_composite_fkey'
      AND conrelid = 'public.user_question_progress'::regclass
  ) THEN
    ALTER TABLE public.user_question_progress
      ADD CONSTRAINT user_question_progress_set_q_composite_fkey
      FOREIGN KEY (study_set_id, question_id)
      REFERENCES public.questions (study_set_id, id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'starred_questions_set_q_composite_fkey'
      AND conrelid = 'public.starred_questions'::regclass
  ) THEN
    ALTER TABLE public.starred_questions
      ADD CONSTRAINT starred_questions_set_q_composite_fkey
      FOREIGN KEY (study_set_id, question_id)
      REFERENCES public.questions (study_set_id, id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'study_session_answers_set_q_composite_fkey'
      AND conrelid = 'public.study_session_answers'::regclass
  ) THEN
    ALTER TABLE public.study_session_answers
      ADD CONSTRAINT study_session_answers_set_q_composite_fkey
      FOREIGN KEY (study_set_id, question_id)
      REFERENCES public.questions (study_set_id, id)
      ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'exam_attempt_answers_attempt_q_composite_fkey'
      AND conrelid = 'public.exam_attempt_answers'::regclass
  ) THEN
    ALTER TABLE public.exam_attempt_answers
      ADD CONSTRAINT exam_attempt_answers_attempt_q_composite_fkey
      FOREIGN KEY (attempt_id, attempt_question_id)
      REFERENCES public.exam_attempt_questions (attempt_id, id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- A2. Harden SECURITY DEFINER RLS helpers (fixes SH-014, SH-015, SH-040 / SEC-005/007/009/016)
-- Prevents cross-user authorization oracle probing on PostgREST 10+/PG 15 (`request.jwt.claims` JSON
-- and legacy `request.jwt.claim.role`), and removes blanket 'unlisted' enumeration.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_jwt_role()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('request.jwt.claim.role', true), ''),
    NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    CASE
      WHEN session_user IN ('anon', 'authenticated', 'authenticator') THEN session_user
      WHEN current_user IN ('anon', 'authenticated', 'authenticator') THEN current_user
      ELSE ''
    END
  );
$$;

REVOKE ALL ON FUNCTION public.current_jwt_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_jwt_role() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_study_set_owner(p_set_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_user_id IS NULL THEN false
    WHEN public.current_jwt_role() IN ('anon', 'authenticated', 'authenticator')
         AND p_user_id IS DISTINCT FROM (SELECT auth.uid()) THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.study_sets s
      WHERE s.id = p_set_id
        AND s.owner_id = p_user_id
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.can_read_study_set(p_set_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN public.current_jwt_role() IN ('anon', 'authenticated', 'authenticator')
         AND p_user_id IS NOT NULL
         AND p_user_id IS DISTINCT FROM (SELECT auth.uid()) THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.study_sets s
      WHERE s.id = p_set_id
        AND (
          -- SH-015: Strictly 'public' only; 'unlisted' cannot be enumerated via PostgREST
          s.visibility = 'public'
          OR (p_user_id IS NOT NULL AND s.owner_id = p_user_id)
          OR (
            p_user_id IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM public.study_set_members m
              WHERE m.study_set_id = s.id
                AND m.user_id = p_user_id
            )
          )
        )
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.can_edit_study_set(p_set_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_user_id IS NULL THEN false
    WHEN public.current_jwt_role() IN ('anon', 'authenticated', 'authenticator')
         AND p_user_id IS DISTINCT FROM (SELECT auth.uid()) THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.study_sets s
      WHERE s.id = p_set_id
        AND (
          s.owner_id = p_user_id
          OR EXISTS (
            SELECT 1
            FROM public.study_set_members m
            WHERE m.study_set_id = s.id
              AND m.user_id = p_user_id
              AND m.role IN ('owner', 'editor')
          )
        )
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.can_view_profile(p_profile_id uuid, p_viewer_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_viewer_id IS NULL THEN false
    WHEN public.current_jwt_role() IN ('anon', 'authenticated', 'authenticator')
         AND p_viewer_id IS DISTINCT FROM (SELECT auth.uid()) THEN false
    WHEN p_profile_id = p_viewer_id THEN true
    WHEN EXISTS (
      SELECT 1
      FROM public.friendships f
      WHERE (
        -- Accepted & pending participants can view each other's non-email public profile
        -- (profiles.email is column-revoked from authenticated)
        f.status IN ('accepted', 'pending')
        AND (
          (f.requester_id = p_viewer_id AND f.addressee_id = p_profile_id)
          OR (f.addressee_id = p_viewer_id AND f.requester_id = p_profile_id)
        )
      ) OR (
        -- Only the blocker can view the blocked user's non-email profile to manage/unblock
        f.status = 'blocked'
        AND f.blocked_by = p_viewer_id
        AND (
          (f.requester_id = p_viewer_id AND f.addressee_id = p_profile_id)
          OR (f.addressee_id = p_viewer_id AND f.requester_id = p_profile_id)
        )
      )
    ) THEN true
    WHEN EXISTS (
      SELECT 1
      FROM public.study_sets s
      JOIN public.study_set_members m ON m.study_set_id = s.id
      WHERE (s.owner_id = p_viewer_id AND m.user_id = p_profile_id)
         OR (s.owner_id = p_profile_id AND m.user_id = p_viewer_id)
    ) THEN true
    WHEN EXISTS (
      SELECT 1
      FROM public.study_set_members m1
      JOIN public.study_set_members m2 ON m1.study_set_id = m2.study_set_id
      WHERE m1.user_id = p_viewer_id
        AND m2.user_id = p_profile_id
    ) THEN true
    ELSE false
  END;
$$;

-- SH-015: Remove 'unlisted' from anon SELECT policy on study_sets
DROP POLICY IF EXISTS "study_sets_select_public_anon" ON public.study_sets;
CREATE POLICY "study_sets_select_public_anon"
  ON public.study_sets FOR SELECT
  TO anon
  USING (visibility = 'public');

-- ----------------------------------------------------------------------------
-- A3. Private email protection & profile security hardening (fixes SH-014, SH-040 / SEC-005/013)
-- Revoke direct SELECT on profiles.email for authenticated users; expose own full
-- profile (including email) exclusively through self-only get_my_profile() RPC.
-- ----------------------------------------------------------------------------
REVOKE SELECT ON public.profiles FROM anon, authenticated;
GRANT SELECT (
  id,
  display_name,
  username,
  avatar_url,
  bio,
  created_at,
  updated_at
) ON public.profiles TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_profile()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_row public.profiles%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_row
  FROM public.profiles
  WHERE id = v_caller;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_profile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_profile() TO authenticated;

-- Prevent direct PostgREST spoofing of profiles.email (SEC-013)
-- Uses pg_trigger_depth() = 1 so internal auth.users -> profiles sync trigger never trips.
CREATE OR REPLACE FUNCTION public.guard_profiles_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
BEGIN
  IF v_caller IS NOT NULL AND pg_trigger_depth() = 1 AND NEW.email IS DISTINCT FROM OLD.email THEN
    RAISE EXCEPTION 'Email cannot be changed directly on profiles.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_profiles_update ON public.profiles;
CREATE TRIGGER trg_guard_profiles_update
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_profiles_update();

-- Sync verified auth.users email changes into profiles safely
CREATE OR REPLACE FUNCTION public.sync_profile_email_from_auth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email AND NEW.email IS NOT NULL THEN
    UPDATE public.profiles
    SET email = NEW.email,
        updated_at = now()
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_email_updated ON auth.users;
CREATE TRIGGER on_auth_user_email_updated
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_email_from_auth();

-- Harden handle_new_user(): sanitize avatar_url (https:// only) and cap display_name
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_display_name text;
  v_username text;
  v_avatar text;
BEGIN
  v_display_name := NULLIF(
    left(
      trim(COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.raw_user_meta_data->>'full_name', '')),
      100
    ),
    ''
  );
  IF v_display_name IS NULL THEN
    v_display_name := left(split_part(COALESCE(NEW.email, 'user'), '@', 1), 100);
  END IF;

  v_username := lower(NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'username', '')), ''));
  IF v_username IS NOT NULL AND v_username !~ '^[a-z0-9_]{3,30}$' THEN
    v_username := NULL;
  END IF;

  v_avatar := NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'avatar_url', '')), '');
  IF v_avatar IS NOT NULL AND v_avatar !~* '^https://' THEN
    v_avatar := NULL;
  END IF;

  INSERT INTO public.profiles (id, email, display_name, username, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    v_display_name,
    v_username,
    v_avatar
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_preferences (user_id)
  VALUES (NEW.id)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
EXCEPTION
  WHEN unique_violation THEN
    INSERT INTO public.profiles (id, email, display_name, username, avatar_url)
    VALUES (
      NEW.id,
      COALESCE(NEW.email, ''),
      v_display_name,
      NULL,
      v_avatar
    )
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.user_preferences (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;

    RETURN NEW;
END;
$$;

-- Safe URL scheme CHECK constraints (NOT VALID for safe non-destructive migration)
-- Uses `/[^/\\]` so protocol-relative `//evil.com` and `/\evil.com` are rejected while `/api/...` passes.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'profiles_avatar_url_safe_chk'
      AND conrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_avatar_url_safe_chk
      CHECK (
        avatar_url IS NULL
        OR avatar_url ~* '^(https://|/[^/\\]|avatars/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)'
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'questions_prompt_image_url_safe_chk'
      AND conrelid = 'public.questions'::regclass
  ) THEN
    ALTER TABLE public.questions
      ADD CONSTRAINT questions_prompt_image_url_safe_chk
      CHECK (
        prompt_image_url IS NULL
        OR prompt_image_url ~* '^(https://|/[^/\\]|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)'
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'questions_back_image_url_safe_chk'
      AND conrelid = 'public.questions'::regclass
  ) THEN
    ALTER TABLE public.questions
      ADD CONSTRAINT questions_back_image_url_safe_chk
      CHECK (
        back_image_url IS NULL
        OR back_image_url ~* '^(https://|/[^/\\]|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)'
      ) NOT VALID;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'question_options_image_url_safe_chk'
      AND conrelid = 'public.question_options'::regclass
  ) THEN
    ALTER TABLE public.question_options
      ADD CONSTRAINT question_options_image_url_safe_chk
      CHECK (
        image_url IS NULL
        OR image_url ~* '^(https://|/[^/\\]|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/)'
      ) NOT VALID;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- A4. study_sets.is_favorite + Editor-to-Owner Hijack Guard (fixes SH-001, SH-033, SEC-023)
-- ----------------------------------------------------------------------------
ALTER TABLE public.study_sets
  ADD COLUMN IF NOT EXISTS is_favorite boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_study_sets_owner_favorite
  ON public.study_sets (owner_id, is_favorite DESC, updated_at DESC);

CREATE OR REPLACE FUNCTION public.guard_study_set_owner_fields()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
BEGIN
  IF v_caller IS NOT NULL THEN
    IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
      RAISE EXCEPTION 'owner_id cannot be reassigned.' USING ERRCODE = '42501';
    END IF;

    IF pg_trigger_depth() = 1 AND NEW.question_count IS DISTINCT FROM OLD.question_count THEN
      RAISE EXCEPTION 'question_count is maintained automatically.' USING ERRCODE = '42501';
    END IF;

    IF OLD.owner_id <> v_caller AND (
      NEW.visibility IS DISTINCT FROM OLD.visibility
      OR NEW.folder_id IS DISTINCT FROM OLD.folder_id
      OR NEW.is_archived IS DISTINCT FROM OLD.is_archived
      OR NEW.is_favorite IS DISTINCT FROM OLD.is_favorite
    ) THEN
      RAISE EXCEPTION 'Only the study set owner may change visibility, folder, archive, or favorite status.'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.folder_id IS NOT NULL AND NEW.folder_id IS DISTINCT FROM OLD.folder_id THEN
      IF NOT EXISTS (
        SELECT 1
        FROM public.folders f
        WHERE f.id = NEW.folder_id
          AND f.owner_id = OLD.owner_id
      ) THEN
        RAISE EXCEPTION 'Folder does not belong to the study set owner.' USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_study_set_owner_fields ON public.study_sets;
CREATE TRIGGER trg_guard_study_set_owner_fields
  BEFORE UPDATE ON public.study_sets
  FOR EACH ROW EXECUTE FUNCTION public.guard_study_set_owner_fields();

-- Tighten folder ownership checks in RLS WITH CHECK (SEC-023)
DROP POLICY IF EXISTS "study_sets_insert_own" ON public.study_sets;
CREATE POLICY "study_sets_insert_own"
  ON public.study_sets FOR INSERT
  TO authenticated
  WITH CHECK (
    owner_id = (SELECT auth.uid())
    AND (
      folder_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.folders f
        WHERE f.id = folder_id AND f.owner_id = (SELECT auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS "folders_insert_own" ON public.folders;
CREATE POLICY "folders_insert_own"
  ON public.folders FOR INSERT
  TO authenticated
  WITH CHECK (
    owner_id = (SELECT auth.uid())
    AND (
      parent_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.folders p
        WHERE p.id = parent_id AND p.owner_id = (SELECT auth.uid())
      )
    )
  );

DROP POLICY IF EXISTS "folders_update_own" ON public.folders;
CREATE POLICY "folders_update_own"
  ON public.folders FOR UPDATE
  TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (
    owner_id = (SELECT auth.uid())
    AND (
      parent_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.folders p
        WHERE p.id = parent_id AND p.owner_id = (SELECT auth.uid())
      )
    )
  );

-- ----------------------------------------------------------------------------
-- A5. Prevent multi-hop cycles in folders hierarchy (fixes DB-P2-2)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_folder_cycle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_has_cycle boolean;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'A folder cannot be its own parent.' USING ERRCODE = '22023';
  END IF;

  WITH RECURSIVE ancestors AS (
    SELECT f.id, f.parent_id, 1 AS depth
    FROM public.folders f
    WHERE f.id = NEW.parent_id
    UNION ALL
    SELECT p.id, p.parent_id, a.depth + 1
    FROM public.folders p
    JOIN ancestors a ON a.parent_id = p.id
    WHERE a.depth < 32
  )
  SELECT EXISTS (SELECT 1 FROM ancestors WHERE id = NEW.id) INTO v_has_cycle;

  IF v_has_cycle THEN
    RAISE EXCEPTION 'Circular folder hierarchy is not allowed.' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_folder_cycle ON public.folders;
CREATE TRIGGER trg_prevent_folder_cycle
  BEFORE INSERT OR UPDATE OF parent_id ON public.folders
  FOR EACH ROW EXECUTE FUNCTION public.prevent_folder_cycle();

-- ----------------------------------------------------------------------------
-- A6. Statement-level study_sets.question_count sync (fixes SH-029, SH-038)
-- Eliminates 10,000-statement write amplification during bulk imports.
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS trg_sync_study_set_question_count ON public.questions;
DROP TRIGGER IF EXISTS trg_sync_study_set_question_count_ins ON public.questions;
DROP TRIGGER IF EXISTS trg_sync_study_set_question_count_del ON public.questions;

CREATE OR REPLACE FUNCTION public.sync_study_set_question_count_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.study_sets s
  SET question_count = s.question_count + agg.cnt
  FROM (
    SELECT study_set_id, count(*)::integer AS cnt
    FROM new_rows
    GROUP BY study_set_id
  ) agg
  WHERE s.id = agg.study_set_id;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_study_set_question_count_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.study_sets s
  SET question_count = GREATEST(0, s.question_count - agg.cnt)
  FROM (
    SELECT study_set_id, count(*)::integer AS cnt
    FROM old_rows
    GROUP BY study_set_id
  ) agg
  WHERE s.id = agg.study_set_id;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_sync_study_set_question_count_ins
  AFTER INSERT ON public.questions
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.sync_study_set_question_count_insert();

CREATE TRIGGER trg_sync_study_set_question_count_del
  AFTER DELETE ON public.questions
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.sync_study_set_question_count_delete();

-- ----------------------------------------------------------------------------
-- A7. Fix friendships blocked_by + anti-takeover trigger (fixes SH-002 / SEC-002 / SEC-006)
-- ----------------------------------------------------------------------------
ALTER TABLE public.friendships
  ADD COLUMN IF NOT EXISTS blocked_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.guard_friendships_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
BEGIN
  IF NEW.requester_id IS DISTINCT FROM OLD.requester_id
     OR NEW.addressee_id IS DISTINCT FROM OLD.addressee_id THEN
    RAISE EXCEPTION 'Friendship participants cannot be modified.' USING ERRCODE = '42501';
  END IF;

  IF v_caller IS NOT NULL THEN
    IF OLD.status = 'blocked' AND OLD.blocked_by IS DISTINCT FROM v_caller THEN
      RAISE EXCEPTION 'Only the user who created a block may modify it.' USING ERRCODE = '42501';
    END IF;

    IF NEW.status IN ('accepted', 'declined') THEN
      IF OLD.status <> 'pending' OR OLD.addressee_id <> v_caller THEN
        RAISE EXCEPTION 'Only the addressee of a pending request may accept or decline it.'
          USING ERRCODE = '42501';
      END IF;
      NEW.blocked_by := NULL;
    ELSIF NEW.status = 'blocked' THEN
      IF OLD.requester_id <> v_caller AND OLD.addressee_id <> v_caller THEN
        RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
      END IF;
      NEW.blocked_by := v_caller;
    ELSIF NEW.status = 'pending' AND OLD.status <> 'pending' THEN
      RAISE EXCEPTION 'Invalid friendship state transition.' USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_friendships_update ON public.friendships;
CREATE TRIGGER trg_guard_friendships_update
  BEFORE UPDATE ON public.friendships
  FOR EACH ROW EXECUTE FUNCTION public.guard_friendships_update();

DROP POLICY IF EXISTS "friendships_update_participant" ON public.friendships;
CREATE POLICY "friendships_update_participant"
  ON public.friendships FOR UPDATE
  TO authenticated
  USING (
    (status = 'pending' AND addressee_id = (SELECT auth.uid()))
    OR (status <> 'blocked' AND (requester_id = (SELECT auth.uid()) OR addressee_id = (SELECT auth.uid())))
    OR (status = 'blocked' AND blocked_by = (SELECT auth.uid()))
  )
  WITH CHECK (
    (addressee_id = (SELECT auth.uid()) AND status IN ('accepted', 'declined'))
    OR (
      (requester_id = (SELECT auth.uid()) OR addressee_id = (SELECT auth.uid()))
      AND status = 'blocked'
      AND blocked_by = (SELECT auth.uid())
    )
  );

DROP POLICY IF EXISTS "friendships_delete_participant" ON public.friendships;
CREATE POLICY "friendships_delete_participant"
  ON public.friendships FOR DELETE
  TO authenticated
  USING (
    (status <> 'blocked' AND (requester_id = (SELECT auth.uid()) OR addressee_id = (SELECT auth.uid())))
    OR (status = 'blocked' AND blocked_by = (SELECT auth.uid()))
  );

-- ----------------------------------------------------------------------------
-- A8. study_set_members.allow_clone + shared tags SELECT RLS (fixes SH-020, DB-P2-3)
-- ----------------------------------------------------------------------------
ALTER TABLE public.study_set_members
  ADD COLUMN IF NOT EXISTS allow_clone boolean NOT NULL DEFAULT true;

DROP POLICY IF EXISTS "tags_select_readable_via_sets" ON public.tags;
CREATE POLICY "tags_select_readable_via_sets"
  ON public.tags FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.question_tags qt
      WHERE qt.tag_id = id
        AND public.can_read_study_set(qt.study_set_id, (SELECT auth.uid()))
    )
  );

-- ----------------------------------------------------------------------------
-- A9. Fix normalize_short_answer() numeric trailing-zero bug (fixes SH-007 / DB-P0-3)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_short_answer(p_input text, p_mode text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_text text;
  v_num numeric;
BEGIN
  v_text := regexp_replace(trim(COALESCE(p_input, '')), '\s+', ' ', 'g');

  IF p_mode = 'exact' THEN
    RETURN v_text;
  ELSIF p_mode = 'numeric' THEN
    v_text := replace(regexp_replace(v_text, '\s+', '', 'g'), ',', '.');
    IF v_text = '' THEN
      RETURN '';
    END IF;
    BEGIN
      v_num := v_text::numeric;
      IF v_num = 0 THEN
        RETURN '0';
      END IF;
      -- PostgreSQL 13+ trim_scale preserves integer zeros: 100.00 -> '100', 10 -> '10', 1.50 -> '1.5'
      RETURN trim_scale(v_num)::text;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RETURN lower(v_text);
    END;
  ELSIF p_mode = 'ignore_diacritics' THEN
    v_text := lower(v_text);
    v_text := translate(
      v_text,
      'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ',
      'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd'
    );
    v_text := regexp_replace(v_text, '[].,;:!?''"()[{}]+', ' ', 'g');
    RETURN regexp_replace(trim(v_text), '\s+', ' ', 'g');
  ELSE
    -- case_insensitive: aligned 1:1 with src/lib/learning/write-grader.ts
    v_text := lower(v_text);
    v_text := regexp_replace(v_text, '^[].,;:!?''"()[{}]+|[].,;:!?''"()[{}]+$', '', 'g');
    RETURN regexp_replace(trim(v_text), '\s+', ' ', 'g');
  END IF;
END;
$$;

-- ----------------------------------------------------------------------------
-- A10. Tighten storage.objects RLS for study-media (fixes SH-019 / SEC-011 / DB-P1-6)
-- Strict UUID regex + owner_id folder prefix binding.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_strict_uuid(p_val text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT p_val IS NOT NULL
    AND p_val ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
$$;

CREATE OR REPLACE FUNCTION public.can_access_study_media_path(
  p_folder1 text,
  p_folder2 text,
  p_require_edit boolean
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN NOT public.is_strict_uuid(p_folder1) OR NOT public.is_strict_uuid(p_folder2) THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.study_sets s
      WHERE s.id = p_folder2::uuid
        AND s.owner_id = p_folder1::uuid
        AND (
          CASE
            WHEN p_require_edit THEN public.can_edit_study_set(s.id, (SELECT auth.uid()))
            ELSE public.can_read_study_set(s.id, (SELECT auth.uid()))
          END
        )
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.can_access_study_media_path(text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_study_media_path(text, text, boolean) TO authenticated;

DROP POLICY IF EXISTS "study_media_select" ON storage.objects;
DROP POLICY IF EXISTS "study_media_insert" ON storage.objects;
DROP POLICY IF EXISTS "study_media_update" ON storage.objects;
DROP POLICY IF EXISTS "study_media_delete" ON storage.objects;

CREATE POLICY "study_media_select"
  ON storage.objects FOR SELECT
  TO authenticated
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
    )
  );

CREATE POLICY "study_media_insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'study-media'
    AND (
      (
        (storage.foldername(name))[1] = 'avatars'
        AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
      )
      OR public.can_access_study_media_path(
        (storage.foldername(name))[1],
        (storage.foldername(name))[2],
        true
      )
    )
  );

CREATE POLICY "study_media_update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'study-media'
    AND (
      (
        (storage.foldername(name))[1] = 'avatars'
        AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
      )
      OR public.can_access_study_media_path(
        (storage.foldername(name))[1],
        (storage.foldername(name))[2],
        true
      )
    )
  )
  WITH CHECK (
    bucket_id = 'study-media'
    AND (
      (
        (storage.foldername(name))[1] = 'avatars'
        AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
      )
      OR public.can_access_study_media_path(
        (storage.foldername(name))[1],
        (storage.foldername(name))[2],
        true
      )
    )
  );

CREATE POLICY "study_media_delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'study-media'
    AND (
      (
        (storage.foldername(name))[1] = 'avatars'
        AND (storage.foldername(name))[2] = (SELECT auth.uid())::text
      )
      OR public.can_access_study_media_path(
        (storage.foldername(name))[1],
        (storage.foldername(name))[2],
        true
      )
    )
  );

-- ----------------------------------------------------------------------------
-- A11. Hot performance indexes for 10,000+ question banks
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_questions_set_type_chapter
  ON public.questions (study_set_id, question_type, chapter);
CREATE INDEX IF NOT EXISTS idx_questions_prompt_trgm
  ON public.questions USING gin (prompt gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_study_sets_title_trgm
  ON public.study_sets USING gin (title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_questions_source_metadata_idem
  ON public.questions (study_set_id, (source_metadata->>'import_idempotency_key'))
  WHERE source_metadata ? 'import_idempotency_key';
CREATE INDEX IF NOT EXISTS idx_exam_attempts_user_in_progress
  ON public.exam_attempts (user_id, created_at DESC)
  WHERE status = 'in_progress';

-- ============================================================================
-- PART B: V2.0 New Tables (Presets, Full Coverage Cycles, Multi-Subject Sources)
-- ============================================================================

-- B1. exam_presets (strictly private, config-only templates — zero fixed question IDs)
CREATE TABLE IF NOT EXISTS public.exam_presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 1 AND 160),
  description text CHECK (description IS NULL OR char_length(description) <= 500),
  is_favorite boolean NOT NULL DEFAULT false,
  requested_question_count integer CHECK (
    requested_question_count IS NULL OR requested_question_count BETWEEN 1 AND 5000
  ),
  allocation_strategy text NOT NULL DEFAULT 'proportional' CHECK (
    allocation_strategy IN ('global_random', 'equal', 'proportional', 'custom', 'weighted')
  ),
  selection_policy text NOT NULL DEFAULT 'random' CHECK (
    selection_policy IN (
      'random', 'unseen_first', 'mistakes_first', 'weak_topics_first',
      'due_for_review', 'starred_only', 'incorrect_only', 'anti_repeat'
    )
  ),
  full_coverage_mode boolean NOT NULL DEFAULT false,
  duration_limit_seconds integer CHECK (
    duration_limit_seconds IS NULL OR duration_limit_seconds BETWEEN 60 AND 86400
  ),
  pass_threshold integer NOT NULL DEFAULT 70 CHECK (pass_threshold BETWEEN 1 AND 100),
  shuffle_questions boolean NOT NULL DEFAULT true,
  shuffle_options boolean NOT NULL DEFAULT true,
  show_subject_names boolean NOT NULL DEFAULT true,
  show_chapter_names boolean NOT NULL DEFAULT true,
  allow_navigation boolean NOT NULL DEFAULT true,
  allow_mark_for_review boolean NOT NULL DEFAULT true,
  auto_submit_on_expire boolean NOT NULL DEFAULT true,
  show_review_after_submit boolean NOT NULL DEFAULT true,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  use_count integer NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  last_used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exam_presets_user_fav_updated
  ON public.exam_presets (user_id, is_favorite DESC, updated_at DESC);

DROP TRIGGER IF EXISTS trg_set_updated_at_exam_presets ON public.exam_presets;
CREATE TRIGGER trg_set_updated_at_exam_presets
  BEFORE UPDATE ON public.exam_presets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- B2. exam_preset_sources
CREATE TABLE IF NOT EXISTS public.exam_preset_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  preset_id uuid NOT NULL REFERENCES public.exam_presets(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('study_set', 'folder')),
  study_set_id uuid REFERENCES public.study_sets(id) ON DELETE CASCADE,
  folder_id uuid REFERENCES public.folders(id) ON DELETE CASCADE,
  include_subfolders boolean NOT NULL DEFAULT true,
  custom_count integer CHECK (custom_count IS NULL OR custom_count >= 0),
  custom_percentage numeric(5,2) CHECK (
    custom_percentage IS NULL OR (custom_percentage >= 0 AND custom_percentage <= 100)
  ),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT exam_preset_sources_target_chk CHECK (
    (source_type = 'study_set' AND study_set_id IS NOT NULL AND folder_id IS NULL)
    OR (source_type = 'folder' AND folder_id IS NOT NULL AND study_set_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_exam_preset_sources_set
  ON public.exam_preset_sources (preset_id, study_set_id) WHERE study_set_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_exam_preset_sources_folder
  ON public.exam_preset_sources (preset_id, folder_id) WHERE folder_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_exam_preset_sources_preset_id
  ON public.exam_preset_sources (preset_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_exam_preset_sources_study_set_id
  ON public.exam_preset_sources (study_set_id) WHERE study_set_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_exam_preset_sources_folder_id
  ON public.exam_preset_sources (folder_id) WHERE folder_id IS NOT NULL;

-- B3. coverage_cycles (Full Coverage / No-Repeat Exam Series)
CREATE TABLE IF NOT EXISTS public.coverage_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  preset_id uuid REFERENCES public.exam_presets(id) ON DELETE SET NULL,
  title text NOT NULL CHECK (char_length(trim(title)) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
  source_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  filter_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  allocation_strategy text NOT NULL DEFAULT 'proportional' CHECK (
    allocation_strategy IN ('global_random', 'equal', 'proportional', 'custom', 'weighted')
  ),
  questions_per_exam integer NOT NULL CHECK (questions_per_exam BETWEEN 1 AND 2000),
  total_questions integer NOT NULL CHECK (total_questions > 0),
  assigned_count integer NOT NULL DEFAULT 0 CHECK (assigned_count >= 0),
  answered_count integer NOT NULL DEFAULT 0 CHECK (answered_count >= 0),
  completed_count integer NOT NULL DEFAULT 0 CHECK (completed_count >= 0),
  active_attempt_id uuid REFERENCES public.exam_attempts(id) ON DELETE SET NULL,
  cycle_number integer NOT NULL DEFAULT 1 CHECK (cycle_number >= 1),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coverage_cycles_user_status
  ON public.coverage_cycles (user_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_coverage_cycles_preset_id
  ON public.coverage_cycles (preset_id) WHERE preset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_coverage_cycles_active_attempt_id
  ON public.coverage_cycles (active_attempt_id) WHERE active_attempt_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_set_updated_at_coverage_cycles ON public.coverage_cycles;
CREATE TRIGGER trg_set_updated_at_coverage_cycles
  BEFORE UPDATE ON public.coverage_cycles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- B4. Extend exam_attempts, exam_attempt_questions, exam_attempt_answers, study_sessions
ALTER TABLE public.exam_attempts
  ADD COLUMN IF NOT EXISTS allocation_strategy text NOT NULL DEFAULT 'global_random',
  ADD COLUMN IF NOT EXISTS selection_policy text NOT NULL DEFAULT 'random',
  ADD COLUMN IF NOT EXISTS requested_question_count integer,
  ADD COLUMN IF NOT EXISTS show_subject_names boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_chapter_names boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_navigation boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_mark_for_review boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS auto_submit_on_expire boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_review_after_submit boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS coverage_cycle_id uuid REFERENCES public.coverage_cycles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS preset_id uuid REFERENCES public.exam_presets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_multi_subject boolean NOT NULL DEFAULT false;

DO $$
DECLARE
  v_conname text;
BEGIN
  SELECT conname INTO v_conname
  FROM pg_constraint
  WHERE conrelid = 'public.exam_attempts'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%in_progress%submitted%expired%'
    AND pg_get_constraintdef(oid) NOT LIKE '%discarded%';

  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.exam_attempts DROP CONSTRAINT %I', v_conname);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'exam_attempts_status_v2_chk'
      AND conrelid = 'public.exam_attempts'::regclass
  ) THEN
    ALTER TABLE public.exam_attempts
      ADD CONSTRAINT exam_attempts_status_v2_chk
      CHECK (status IN ('in_progress', 'submitted', 'expired', 'discarded'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'exam_attempts_allocation_strategy_chk'
      AND conrelid = 'public.exam_attempts'::regclass
  ) THEN
    ALTER TABLE public.exam_attempts
      ADD CONSTRAINT exam_attempts_allocation_strategy_chk
      CHECK (allocation_strategy IN ('global_random', 'equal', 'proportional', 'custom', 'weighted'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'exam_attempts_selection_policy_chk'
      AND conrelid = 'public.exam_attempts'::regclass
  ) THEN
    ALTER TABLE public.exam_attempts
      ADD CONSTRAINT exam_attempts_selection_policy_chk
      CHECK (selection_policy IN (
        'random', 'unseen_first', 'mistakes_first', 'weak_topics_first',
        'due_for_review', 'starred_only', 'incorrect_only', 'anti_repeat'
      ));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_exam_attempts_coverage_cycle_id
  ON public.exam_attempts (coverage_cycle_id) WHERE coverage_cycle_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_exam_attempts_preset_id
  ON public.exam_attempts (preset_id) WHERE preset_id IS NOT NULL;

-- Extend exam_attempt_questions while keeping sensitive answer/explanation columns REVOKED!
ALTER TABLE public.exam_attempt_questions
  ADD COLUMN IF NOT EXISTS source_study_set_id uuid REFERENCES public.study_sets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_subject_title text,
  ADD COLUMN IF NOT EXISTS tags_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb;

GRANT SELECT (
  source_study_set_id,
  source_subject_title,
  tags_snapshot
) ON public.exam_attempt_questions TO authenticated;

CREATE INDEX IF NOT EXISTS idx_exam_attempt_questions_source_set
  ON public.exam_attempt_questions (attempt_id, source_study_set_id)
  WHERE source_study_set_id IS NOT NULL;

-- Extend exam_attempt_answers with monotonic stale-write guard
ALTER TABLE public.exam_attempt_answers
  ADD COLUMN IF NOT EXISTS client_seq bigint NOT NULL DEFAULT 0 CHECK (client_seq >= 0);

-- Extend study_sessions for multi-subject custom practice
ALTER TABLE public.study_sessions
  ALTER COLUMN study_set_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS source_study_set_ids uuid[] NOT NULL DEFAULT '{}'::uuid[];

-- B5. exam_attempt_sources
CREATE TABLE IF NOT EXISTS public.exam_attempt_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES public.exam_attempts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source_type text NOT NULL DEFAULT 'study_set' CHECK (source_type IN ('study_set', 'folder')),
  study_set_id uuid REFERENCES public.study_sets(id) ON DELETE SET NULL,
  folder_id uuid REFERENCES public.folders(id) ON DELETE SET NULL,
  subject_title_snapshot text NOT NULL,
  eligible_count integer NOT NULL DEFAULT 0 CHECK (eligible_count >= 0),
  requested_count integer CHECK (requested_count IS NULL OR requested_count >= 0),
  requested_percentage numeric(5,2) CHECK (
    requested_percentage IS NULL OR (requested_percentage >= 0 AND requested_percentage <= 100)
  ),
  allocated_count integer NOT NULL DEFAULT 0 CHECK (allocated_count >= 0),
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_exam_attempt_sources_attempt
  ON public.exam_attempt_sources (attempt_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_exam_attempt_sources_user
  ON public.exam_attempt_sources (user_id);
CREATE INDEX IF NOT EXISTS idx_exam_attempt_sources_study_set
  ON public.exam_attempt_sources (study_set_id) WHERE study_set_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_exam_attempt_sources_folder
  ON public.exam_attempt_sources (folder_id) WHERE folder_id IS NOT NULL;

-- B6. coverage_cycle_questions
CREATE TABLE IF NOT EXISTS public.coverage_cycle_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES public.coverage_cycles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  question_id uuid REFERENCES public.questions(id) ON DELETE SET NULL,
  source_study_set_id uuid REFERENCES public.study_sets(id) ON DELETE SET NULL,
  source_subject_title text NOT NULL,
  pool_order integer NOT NULL CHECK (pool_order >= 0),
  state text NOT NULL DEFAULT 'unassigned' CHECK (state IN ('unassigned', 'assigned', 'completed')),
  assigned_attempt_id uuid REFERENCES public.exam_attempts(id) ON DELETE SET NULL,
  completed_attempt_id uuid REFERENCES public.exam_attempts(id) ON DELETE SET NULL,
  was_answered boolean NOT NULL DEFAULT false,
  last_is_correct boolean,
  times_assigned integer NOT NULL DEFAULT 0 CHECK (times_assigned >= 0),
  assigned_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coverage_cycle_questions_unique_order UNIQUE (cycle_id, pool_order)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_coverage_cycle_questions_q
  ON public.coverage_cycle_questions (cycle_id, question_id) WHERE question_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_coverage_cycle_questions_pool
  ON public.coverage_cycle_questions (cycle_id, state, pool_order);
CREATE INDEX IF NOT EXISTS idx_coverage_cycle_questions_source_state
  ON public.coverage_cycle_questions (cycle_id, source_study_set_id, state);
CREATE INDEX IF NOT EXISTS idx_coverage_cycle_questions_assigned_attempt
  ON public.coverage_cycle_questions (assigned_attempt_id) WHERE assigned_attempt_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_coverage_cycle_questions_completed_attempt
  ON public.coverage_cycle_questions (completed_attempt_id) WHERE completed_attempt_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_coverage_cycle_questions_question_id
  ON public.coverage_cycle_questions (question_id) WHERE question_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_coverage_cycle_questions_source_set
  ON public.coverage_cycle_questions (source_study_set_id) WHERE source_study_set_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_coverage_cycle_questions_user
  ON public.coverage_cycle_questions (user_id);

-- Partial FK indexes preventing seq scans on parent deletes (DB audit Wave 3)
CREATE INDEX IF NOT EXISTS idx_exam_attempt_questions_source_study_set_id
  ON public.exam_attempt_questions (source_study_set_id) WHERE source_study_set_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_friendships_blocked_by
  ON public.friendships (blocked_by) WHERE blocked_by IS NOT NULL;

-- Release assigned coverage cycle questions if an active exam_attempt is deleted directly
CREATE OR REPLACE FUNCTION public.release_coverage_cycle_on_attempt_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_assigned integer;
BEGIN
  IF OLD.coverage_cycle_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM public.coverage_cycles WHERE id = OLD.coverage_cycle_id) THEN
      UPDATE public.coverage_cycle_questions
      SET state = 'unassigned',
          assigned_attempt_id = NULL,
          assigned_at = NULL,
          was_answered = false
      WHERE cycle_id = OLD.coverage_cycle_id
        AND assigned_attempt_id = OLD.id
        AND state = 'assigned';

      SELECT count(*)::integer INTO v_assigned
      FROM public.coverage_cycle_questions
      WHERE cycle_id = OLD.coverage_cycle_id
        AND state = 'assigned';

      UPDATE public.coverage_cycles
      SET active_attempt_id = CASE
            WHEN active_attempt_id = OLD.id THEN NULL
            ELSE active_attempt_id
          END,
          assigned_count = v_assigned,
          updated_at = now()
      WHERE id = OLD.coverage_cycle_id;
    END IF;
  END IF;

  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_release_coverage_cycle_on_attempt_delete ON public.exam_attempts;
CREATE TRIGGER trg_release_coverage_cycle_on_attempt_delete
  BEFORE DELETE ON public.exam_attempts
  FOR EACH ROW EXECUTE FUNCTION public.release_coverage_cycle_on_attempt_delete();

-- B7. coverage_cycle_attempts
CREATE TABLE IF NOT EXISTS public.coverage_cycle_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id uuid NOT NULL REFERENCES public.coverage_cycles(id) ON DELETE CASCADE,
  attempt_id uuid NOT NULL REFERENCES public.exam_attempts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  sequence_number integer NOT NULL CHECK (sequence_number >= 1),
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'discarded')),
  assigned_question_count integer NOT NULL CHECK (assigned_question_count > 0),
  answered_question_count integer NOT NULL DEFAULT 0 CHECK (answered_question_count >= 0),
  completed_question_count integer NOT NULL DEFAULT 0 CHECK (completed_question_count >= 0),
  discarded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT coverage_cycle_attempts_unique_pair UNIQUE (cycle_id, attempt_id),
  CONSTRAINT coverage_cycle_attempts_unique_seq UNIQUE (cycle_id, sequence_number)
);

CREATE INDEX IF NOT EXISTS idx_coverage_cycle_attempts_cycle
  ON public.coverage_cycle_attempts (cycle_id, sequence_number DESC);
CREATE INDEX IF NOT EXISTS idx_coverage_cycle_attempts_attempt
  ON public.coverage_cycle_attempts (attempt_id);
CREATE INDEX IF NOT EXISTS idx_coverage_cycle_attempts_user
  ON public.coverage_cycle_attempts (user_id);

-- ============================================================================
-- PART C: Strict RLS on ALL 6 New V2.0 Tables (TO authenticated, (SELECT auth.uid()))
-- ============================================================================
ALTER TABLE public.exam_presets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_preset_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_attempt_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coverage_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coverage_cycle_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.coverage_cycle_attempts ENABLE ROW LEVEL SECURITY;

-- exam_presets (strictly private to owner)
DROP POLICY IF EXISTS "exam_presets_select_own" ON public.exam_presets;
DROP POLICY IF EXISTS "exam_presets_insert_own" ON public.exam_presets;
DROP POLICY IF EXISTS "exam_presets_update_own" ON public.exam_presets;
DROP POLICY IF EXISTS "exam_presets_delete_own" ON public.exam_presets;

CREATE POLICY "exam_presets_select_own"
  ON public.exam_presets FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "exam_presets_insert_own"
  ON public.exam_presets FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "exam_presets_update_own"
  ON public.exam_presets FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "exam_presets_delete_own"
  ON public.exam_presets FOR DELETE
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- exam_preset_sources
DROP POLICY IF EXISTS "exam_preset_sources_select_own" ON public.exam_preset_sources;
DROP POLICY IF EXISTS "exam_preset_sources_insert_own" ON public.exam_preset_sources;
DROP POLICY IF EXISTS "exam_preset_sources_update_own" ON public.exam_preset_sources;
DROP POLICY IF EXISTS "exam_preset_sources_delete_own" ON public.exam_preset_sources;

CREATE POLICY "exam_preset_sources_select_own"
  ON public.exam_preset_sources FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.exam_presets ep
      WHERE ep.id = preset_id AND ep.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "exam_preset_sources_insert_own"
  ON public.exam_preset_sources FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.exam_presets ep
      WHERE ep.id = preset_id AND ep.user_id = (SELECT auth.uid())
    )
    AND (
      (source_type = 'study_set' AND public.can_read_study_set(study_set_id, (SELECT auth.uid())))
      OR (
        source_type = 'folder'
        AND EXISTS (
          SELECT 1 FROM public.folders f
          WHERE f.id = folder_id AND f.owner_id = (SELECT auth.uid())
        )
      )
    )
  );

CREATE POLICY "exam_preset_sources_update_own"
  ON public.exam_preset_sources FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.exam_presets ep
      WHERE ep.id = preset_id AND ep.user_id = (SELECT auth.uid())
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.exam_presets ep
      WHERE ep.id = preset_id AND ep.user_id = (SELECT auth.uid())
    )
    AND (
      (source_type = 'study_set' AND public.can_read_study_set(study_set_id, (SELECT auth.uid())))
      OR (
        source_type = 'folder'
        AND EXISTS (
          SELECT 1 FROM public.folders f
          WHERE f.id = folder_id AND f.owner_id = (SELECT auth.uid())
        )
      )
    )
  );

CREATE POLICY "exam_preset_sources_delete_own"
  ON public.exam_preset_sources FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.exam_presets ep
      WHERE ep.id = preset_id AND ep.user_id = (SELECT auth.uid())
    )
  );

-- exam_attempt_sources (read own; created via server RPC)
DROP POLICY IF EXISTS "exam_attempt_sources_select_own" ON public.exam_attempt_sources;
CREATE POLICY "exam_attempt_sources_select_own"
  ON public.exam_attempt_sources FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- coverage_cycles (read & delete own; mutations via atomic RPCs)
DROP POLICY IF EXISTS "coverage_cycles_select_own" ON public.coverage_cycles;
DROP POLICY IF EXISTS "coverage_cycles_delete_own" ON public.coverage_cycles;
CREATE POLICY "coverage_cycles_select_own"
  ON public.coverage_cycles FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY "coverage_cycles_delete_own"
  ON public.coverage_cycles FOR DELETE
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- coverage_cycle_questions (read own; mutations via atomic RPCs)
DROP POLICY IF EXISTS "coverage_cycle_questions_select_own" ON public.coverage_cycle_questions;
CREATE POLICY "coverage_cycle_questions_select_own"
  ON public.coverage_cycle_questions FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- coverage_cycle_attempts (read own; mutations via atomic RPCs)
DROP POLICY IF EXISTS "coverage_cycle_attempts_select_own" ON public.coverage_cycle_attempts;
CREATE POLICY "coverage_cycle_attempts_select_own"
  ON public.coverage_cycle_attempts FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- Update study_sessions insert & update policies to enforce readability on both study_set_id and source_study_set_ids
DROP POLICY IF EXISTS "study_sessions_insert_own" ON public.study_sessions;
CREATE POLICY "study_sessions_insert_own"
  ON public.study_sessions FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND (
      study_set_id IS NOT NULL
      OR cardinality(source_study_set_ids) > 0
    )
    AND (
      study_set_id IS NULL
      OR public.can_read_study_set(study_set_id, (SELECT auth.uid()))
    )
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(COALESCE(source_study_set_ids, '{}'::uuid[])) AS sid
      WHERE NOT public.can_read_study_set(sid, (SELECT auth.uid()))
    )
  );

DROP POLICY IF EXISTS "study_sessions_update_own" ON public.study_sessions;
CREATE POLICY "study_sessions_update_own"
  ON public.study_sessions FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND (
      study_set_id IS NOT NULL
      OR cardinality(source_study_set_ids) > 0
    )
    AND (
      study_set_id IS NULL
      OR public.can_read_study_set(study_set_id, (SELECT auth.uid()))
    )
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(COALESCE(source_study_set_ids, '{}'::uuid[])) AS sid
      WHERE NOT public.can_read_study_set(sid, (SELECT auth.uid()))
    )
  );

-- ============================================================================
-- PART D: Atomic Server-Side PostgreSQL RPCs (Zero Client Answer Forgery / 0 Leaks)
-- ============================================================================

-- SH-013 / SEC-004: Revoke direct client access to V1 create_exam_attempt()
REVOKE ALL ON FUNCTION public.create_exam_attempt(uuid, text, jsonb, integer, integer, jsonb)
  FROM PUBLIC, anon, authenticated;

-- ----------------------------------------------------------------------------
-- D1. resolve_deduped_study_sets — recursive folder expansion + set deduplication
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_deduped_study_sets(
  p_folder_ids uuid[] DEFAULT '{}'::uuid[],
  p_study_set_ids uuid[] DEFAULT '{}'::uuid[],
  p_include_subfolders boolean DEFAULT true
)
RETURNS TABLE (
  study_set_id uuid,
  title text,
  subject text,
  question_count integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  WITH RECURSIVE folder_tree AS (
    SELECT f.id, ARRAY[f.id] AS path, 1 AS depth
    FROM public.folders f
    WHERE f.owner_id = v_caller
      AND f.id = ANY(COALESCE(p_folder_ids, '{}'::uuid[]))
    UNION ALL
    SELECT child.id, ft.path || child.id, ft.depth + 1
    FROM public.folders child
    JOIN folder_tree ft ON child.parent_id = ft.id
    WHERE p_include_subfolders
      AND child.owner_id = v_caller
      AND ft.depth < 32
      AND NOT (child.id = ANY(ft.path))
  ),
  candidate_sets AS (
    SELECT s.id
    FROM public.study_sets s
    WHERE s.owner_id = v_caller
      AND s.is_archived = false
      AND s.folder_id IN (SELECT id FROM folder_tree)
    UNION
    SELECT DISTINCT unnest(COALESCE(p_study_set_ids, '{}'::uuid[])) AS id
  )
  SELECT DISTINCT ON (s.id)
    s.id AS study_set_id,
    s.title,
    s.subject,
    s.question_count
  FROM candidate_sets cs
  JOIN public.study_sets s ON s.id = cs.id
  WHERE public.can_read_study_set(s.id, v_caller)
  ORDER BY s.id;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_deduped_study_sets(uuid[], uuid[], boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_deduped_study_sets(uuid[], uuid[], boolean) TO authenticated;

-- ----------------------------------------------------------------------------
-- D2. get_exam_eligible_pool — immune to PostgREST max_rows = 1000
-- Computes deduplicated counts, subjects, chapters, tags, types, and policy tiers.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_exam_eligible_pool(
  p_folder_ids uuid[] DEFAULT '{}'::uuid[],
  p_study_set_ids uuid[] DEFAULT '{}'::uuid[],
  p_include_subfolders boolean DEFAULT true,
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_selection_policy text DEFAULT 'random'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_chapters text[];
  v_tag_ids uuid[];
  v_difficulties text[];
  v_qtypes text[];
  v_result jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(array_agg(x), '{}'::text[]) INTO v_chapters
  FROM jsonb_array_elements_text(COALESCE(p_filters->'chapters', '[]'::jsonb)) AS x;

  SELECT COALESCE(array_agg(x::uuid), '{}'::uuid[]) INTO v_tag_ids
  FROM jsonb_array_elements_text(COALESCE(p_filters->'tag_ids', '[]'::jsonb)) AS x;

  SELECT COALESCE(array_agg(x), '{}'::text[]) INTO v_difficulties
  FROM jsonb_array_elements_text(COALESCE(p_filters->'difficulties', '[]'::jsonb)) AS x;

  SELECT COALESCE(array_agg(x), '{}'::text[]) INTO v_qtypes
  FROM jsonb_array_elements_text(COALESCE(p_filters->'question_types', '[]'::jsonb)) AS x;

  WITH dedup_sets AS (
    SELECT * FROM public.resolve_deduped_study_sets(
      p_folder_ids, p_study_set_ids, p_include_subfolders
    )
  ),
  unfiltered_q AS (
    SELECT
      q.id,
      q.study_set_id,
      ds.title AS subject_title,
      ds.subject,
      q.question_type,
      q.chapter,
      q.difficulty,
      p.mastery_level,
      COALESCE(p.correct_count, 0) AS correct_count,
      COALESCE(p.wrong_count, 0) AS wrong_count,
      p.next_review_at,
      (sq.question_id IS NOT NULL) AS is_starred,
      (p.id IS NULL) AS is_unseen,
      (COALESCE(p.wrong_count, 0) > 0 AND COALESCE(p.mastery_level, 'new') <> 'mastered') AS is_mistake,
      (p.next_review_at IS NOT NULL AND p.next_review_at <= now()) AS is_due,
      (COALESCE(p.mastery_level, 'new') <> 'mastered') AS is_unmastered
    FROM dedup_sets ds
    JOIN public.questions q ON q.study_set_id = ds.study_set_id
    LEFT JOIN public.user_question_progress p
      ON p.question_id = q.id AND p.user_id = v_caller
    LEFT JOIN public.starred_questions sq
      ON sq.question_id = q.id AND sq.user_id = v_caller
    WHERE q.question_type <> 'flashcard'
      AND (cardinality(v_difficulties) = 0 OR q.difficulty = ANY(v_difficulties))
      AND (cardinality(v_qtypes) = 0 OR q.question_type = ANY(v_qtypes))
  ),
  -- Policy-filtered facet pool BEFORE chapter/tag filters so multi-select filter chips stay visible
  facet_q AS (
    SELECT *
    FROM unfiltered_q
    WHERE CASE p_selection_policy
      WHEN 'starred_only' THEN is_starred
      WHEN 'incorrect_only' THEN is_mistake
      ELSE true
    END
  ),
  base_q AS (
    SELECT *
    FROM unfiltered_q uq
    WHERE (cardinality(v_chapters) = 0 OR uq.chapter = ANY(v_chapters))
      AND (
        cardinality(v_tag_ids) = 0
        OR EXISTS (
          SELECT 1
          FROM public.question_tags qt
          WHERE qt.question_id = uq.id
            AND qt.tag_id = ANY(v_tag_ids)
        )
      )
  ),
  policy_q AS (
    SELECT *
    FROM base_q
    WHERE CASE p_selection_policy
      WHEN 'starred_only' THEN is_starred
      WHEN 'incorrect_only' THEN is_mistake
      ELSE true
    END
  ),
  subject_agg AS (
    SELECT
      ds.study_set_id,
      ds.title,
      ds.subject,
      count(bq.id)::integer AS total_exam_questions,
      count(pq.id)::integer AS eligible_count,
      count(pq.id) FILTER (WHERE pq.is_unseen)::integer AS unseen_count,
      count(pq.id) FILTER (WHERE pq.is_mistake)::integer AS mistakes_count,
      count(pq.id) FILTER (WHERE pq.is_starred)::integer AS starred_count,
      count(pq.id) FILTER (WHERE pq.is_unmastered)::integer AS unmastered_count,
      count(pq.id) FILTER (WHERE pq.is_due)::integer AS due_count
    FROM dedup_sets ds
    LEFT JOIN base_q bq ON bq.study_set_id = ds.study_set_id
    LEFT JOIN policy_q pq ON pq.id = bq.id
    GROUP BY ds.study_set_id, ds.title, ds.subject
    ORDER BY ds.title ASC
  ),
  chapter_agg AS (
    SELECT
      fq.study_set_id,
      fq.subject_title,
      fq.chapter,
      count(*)::integer AS cnt
    FROM facet_q fq
    WHERE fq.chapter IS NOT NULL AND char_length(trim(fq.chapter)) > 0
    GROUP BY fq.study_set_id, fq.subject_title, fq.chapter
    ORDER BY fq.subject_title ASC, fq.chapter ASC
  ),
  tag_agg AS (
    SELECT
      t.id,
      t.name,
      t.color,
      count(DISTINCT fq.id)::integer AS cnt
    FROM facet_q fq
    JOIN public.question_tags qt ON qt.question_id = fq.id
    JOIN public.tags t ON t.id = qt.tag_id
    GROUP BY t.id, t.name, t.color
    ORDER BY cnt DESC, t.name ASC
  ),
  qtype_agg AS (
    SELECT pq.question_type, count(*)::integer AS cnt
    FROM policy_q pq
    GROUP BY pq.question_type
  ),
  diff_agg AS (
    SELECT pq.difficulty, count(*)::integer AS cnt
    FROM policy_q pq
    GROUP BY pq.difficulty
  )
  SELECT jsonb_build_object(
    'total_eligible', (SELECT count(*)::integer FROM policy_q),
    'deduplicated_set_count', (SELECT count(*)::integer FROM dedup_sets),
    'subjects', COALESCE((SELECT jsonb_agg(to_jsonb(sa)) FROM subject_agg sa), '[]'::jsonb),
    'chapters', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'study_set_id', ca.study_set_id,
        'subject_title', ca.subject_title,
        'chapter', ca.chapter,
        'count', ca.cnt
      ))
      FROM chapter_agg ca
    ), '[]'::jsonb),
    'tags', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ta.id,
        'name', ta.name,
        'color', ta.color,
        'count', ta.cnt
      ))
      FROM tag_agg ta
    ), '[]'::jsonb),
    'question_type_counts', COALESCE((
      SELECT jsonb_object_agg(question_type, cnt) FROM qtype_agg
    ), '{}'::jsonb),
    'difficulty_counts', COALESCE((
      SELECT jsonb_object_agg(difficulty, cnt) FROM diff_agg
    ), '{}'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_exam_eligible_pool(uuid[], uuid[], boolean, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_exam_eligible_pool(uuid[], uuid[], boolean, jsonb, text) TO authenticated;

-- ----------------------------------------------------------------------------
-- D3. create_exam_attempt_v2 — ZERO client-injected question bodies/answers!
-- Resolves all prompts, options, correct_option_ids, accepted_answers, tags,
-- explanations, and source subjects strictly inside PostgreSQL.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_exam_attempt_v2(
  p_title_snapshot text,
  p_primary_study_set_id uuid,
  p_sources jsonb,
  p_selected_items jsonb,
  p_config jsonb,
  p_duration_limit_seconds integer,
  p_pass_threshold integer,
  p_allocation_strategy text DEFAULT 'global_random',
  p_selection_policy text DEFAULT 'random',
  p_requested_question_count integer DEFAULT NULL,
  p_show_subject_names boolean DEFAULT true,
  p_show_chapter_names boolean DEFAULT true,
  p_allow_navigation boolean DEFAULT true,
  p_allow_mark_for_review boolean DEFAULT true,
  p_auto_submit_on_expire boolean DEFAULT true,
  p_show_review_after_submit boolean DEFAULT true,
  p_preset_id uuid DEFAULT NULL,
  p_coverage_cycle_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_now timestamptz := now();
  v_expires_at timestamptz;
  v_total integer;
  v_verified_count integer;
  v_distinct_sets integer;
  v_single_set_id uuid;
  v_duration integer;
  v_attempt public.exam_attempts%ROWTYPE;
  v_sanitized_questions jsonb;
  v_sources_json jsonb;
  v_remaining integer;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_selected_items IS NULL OR jsonb_typeof(p_selected_items) <> 'array' THEN
    RAISE EXCEPTION 'Selected items array is required' USING ERRCODE = '22023';
  END IF;

  v_total := jsonb_array_length(p_selected_items);
  IF v_total <= 0 OR v_total > 2000 THEN
    RAISE EXCEPTION 'Exam must contain between 1 and 2000 questions' USING ERRCODE = '22023';
  END IF;

  -- Verify primary set access if provided
  IF p_primary_study_set_id IS NOT NULL
     AND NOT public.can_read_study_set(p_primary_study_set_id, v_caller) THEN
    RAISE EXCEPTION 'Study set not found or inaccessible' USING ERRCODE = '42501';
  END IF;

  -- Verify preset ownership if provided
  IF p_preset_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.exam_presets ep WHERE ep.id = p_preset_id AND ep.user_id = v_caller
  ) THEN
    RAISE EXCEPTION 'Preset not found or inaccessible' USING ERRCODE = '42501';
  END IF;

  -- Verify coverage cycle ownership if provided
  IF p_coverage_cycle_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.coverage_cycles cc WHERE cc.id = p_coverage_cycle_id AND cc.user_id = v_caller
  ) THEN
    RAISE EXCEPTION 'Coverage cycle not found or inaccessible' USING ERRCODE = '42501';
  END IF;

  -- Verify EVERY selected question is unique, exists, is non-flashcard, and caller has read access
  SELECT
    count(DISTINCT q.id)::integer,
    count(DISTINCT q.study_set_id)::integer,
    min(q.study_set_id::text)::uuid
  INTO v_verified_count, v_distinct_sets, v_single_set_id
  FROM jsonb_array_elements(p_selected_items) WITH ORDINALITY AS item(val, ord)
  JOIN public.questions q ON q.id = (item.val->>'question_id')::uuid
  WHERE q.question_type <> 'flashcard'
    AND public.can_read_study_set(q.study_set_id, v_caller);

  IF v_verified_count <> v_total THEN
    RAISE EXCEPTION 'One or more selected questions are missing, invalid, or inaccessible.'
      USING ERRCODE = '42501';
  END IF;

  IF p_duration_limit_seconds IS NOT NULL AND p_duration_limit_seconds > 0 THEN
    v_duration := p_duration_limit_seconds;
    v_expires_at := v_now + make_interval(secs => v_duration);
  ELSE
    v_duration := NULL;
    v_expires_at := NULL;
  END IF;

  INSERT INTO public.exam_attempts (
    user_id,
    study_set_id,
    study_set_title_snapshot,
    status,
    config,
    total_questions,
    answered_count,
    unanswered_count,
    pass_threshold,
    duration_limit_seconds,
    started_at,
    expires_at,
    allocation_strategy,
    selection_policy,
    requested_question_count,
    show_subject_names,
    show_chapter_names,
    allow_navigation,
    allow_mark_for_review,
    auto_submit_on_expire,
    show_review_after_submit,
    preset_id,
    coverage_cycle_id,
    is_multi_subject
  ) VALUES (
    v_caller,
    CASE WHEN v_distinct_sets = 1 THEN COALESCE(p_primary_study_set_id, v_single_set_id) ELSE NULL END,
    left(trim(COALESCE(NULLIF(p_title_snapshot, ''), 'Custom Exam')), 200),
    'in_progress',
    COALESCE(p_config, '{}'::jsonb),
    v_total,
    0,
    v_total,
    GREATEST(1, LEAST(100, COALESCE(p_pass_threshold, 70))),
    v_duration,
    v_now,
    v_expires_at,
    COALESCE(p_allocation_strategy, 'global_random'),
    COALESCE(p_selection_policy, 'random'),
    COALESCE(p_requested_question_count, v_total),
    COALESCE(p_show_subject_names, true),
    COALESCE(p_show_chapter_names, true),
    COALESCE(p_allow_navigation, true),
    COALESCE(p_allow_mark_for_review, true),
    COALESCE(p_auto_submit_on_expire, true),
    COALESCE(p_show_review_after_submit, true),
    p_preset_id,
    p_coverage_cycle_id,
    (v_distinct_sets > 1)
  )
  RETURNING * INTO v_attempt;

  -- Snapshot source breakdown rows after verifying caller authorization on every referenced set/folder
  IF p_sources IS NOT NULL AND jsonb_typeof(p_sources) = 'array' AND jsonb_array_length(p_sources) > 0 THEN
    IF EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_sources) AS src(val)
      WHERE (
        NULLIF(src.val->>'study_set_id', '') IS NOT NULL
        AND NOT public.can_read_study_set((src.val->>'study_set_id')::uuid, v_caller)
      ) OR (
        NULLIF(src.val->>'folder_id', '') IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM public.folders f
          WHERE f.id = (src.val->>'folder_id')::uuid
            AND f.owner_id = v_caller
        )
      )
    ) THEN
      RAISE EXCEPTION 'One or more exam sources are missing or inaccessible.'
        USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.exam_attempt_sources (
      attempt_id,
      user_id,
      source_type,
      study_set_id,
      folder_id,
      subject_title_snapshot,
      eligible_count,
      requested_count,
      requested_percentage,
      allocated_count,
      sort_order
    )
    SELECT
      v_attempt.id,
      v_caller,
      COALESCE(NULLIF(src.val->>'source_type', ''), 'study_set'),
      NULLIF(src.val->>'study_set_id', '')::uuid,
      NULLIF(src.val->>'folder_id', '')::uuid,
      COALESCE(NULLIF(src.val->>'subject_title_snapshot', ''), NULLIF(src.val->>'title', ''), 'Study Set'),
      GREATEST(0, COALESCE((src.val->>'eligible_count')::integer, 0)),
      CASE WHEN src.val ? 'requested_count' AND src.val->>'requested_count' IS NOT NULL
           THEN GREATEST(0, (src.val->>'requested_count')::integer) ELSE NULL END,
      CASE WHEN src.val ? 'requested_percentage' AND src.val->>'requested_percentage' IS NOT NULL
           THEN GREATEST(0, LEAST(100, (src.val->>'requested_percentage')::numeric(5,2))) ELSE NULL END,
      GREATEST(0, COALESCE((src.val->>'allocated_count')::integer, 0)),
      (src.ord - 1)::integer
    FROM jsonb_array_elements(p_sources) WITH ORDINALITY AS src(val, ord);
  END IF;

  -- Set-based snapshot insertion strictly from DB tables (zero client-supplied text/keys!)
  WITH ordered_sel AS (
    SELECT
      (item.val->>'question_id')::uuid AS question_id,
      (item.ord - 1)::integer AS pos,
      COALESCE(item.val->'option_ids_order', '[]'::jsonb) AS opt_order
    FROM jsonb_array_elements(p_selected_items) WITH ORDINALITY AS item(val, ord)
  ),
  opt_snapshots AS (
    SELECT
      os.question_id,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', o.id,
            'label', chr(65 + (row_ord - 1)),
            'content', o.content,
            'image_url', o.image_url,
            'position', (row_ord - 1)
          )
          ORDER BY row_ord ASC
        ),
        '[]'::jsonb
      ) AS options_snapshot,
      COALESCE(
        array_agg(o.id ORDER BY o.position ASC) FILTER (WHERE o.is_correct),
        '{}'::uuid[]
      ) AS correct_option_ids
    FROM ordered_sel os
    JOIN LATERAL (
      SELECT
        qo.id,
        qo.content,
        qo.image_url,
        qo.is_correct,
        qo.position,
        row_number() OVER (
          ORDER BY
            COALESCE(
              (
                SELECT (ord_idx - 1)
                FROM jsonb_array_elements_text(os.opt_order) WITH ORDINALITY AS u(uid, ord_idx)
                WHERE u.uid = qo.id::text
                LIMIT 1
              ),
              100000 + qo.position
            ) ASC,
            qo.position ASC,
            qo.id ASC
        )::integer AS row_ord
      FROM public.question_options qo
      WHERE qo.question_id = os.question_id
    ) o ON true
    GROUP BY os.question_id
  ),
  acc_snapshots AS (
    SELECT
      os.question_id,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'answer_text', aa.answer_text,
            'normalized_answer', aa.normalized_answer,
            'match_mode', aa.match_mode
          )
          ORDER BY aa.created_at ASC
        ),
        '[]'::jsonb
      ) AS accepted_answers_snapshot
    FROM ordered_sel os
    JOIN public.question_accepted_answers aa ON aa.question_id = os.question_id
    GROUP BY os.question_id
  ),
  tag_snapshots AS (
    SELECT
      os.question_id,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', t.id,
            'name', t.name,
            'color', t.color
          )
          ORDER BY t.name ASC
        ),
        '[]'::jsonb
      ) AS tags_snapshot
    FROM ordered_sel os
    JOIN public.question_tags qt ON qt.question_id = os.question_id
    JOIN public.tags t ON t.id = qt.tag_id
    GROUP BY os.question_id
  )
  INSERT INTO public.exam_attempt_questions (
    attempt_id,
    question_id,
    position,
    question_type,
    source_study_set_id,
    source_subject_title,
    chapter_snapshot,
    tags_snapshot,
    prompt_snapshot,
    prompt_image_url_snapshot,
    explanation_snapshot,
    options_snapshot,
    correct_option_ids,
    accepted_answers_snapshot
  )
  SELECT
    v_attempt.id,
    q.id,
    os.pos,
    q.question_type,
    q.study_set_id,
    s.title,
    q.chapter,
    COALESCE(ts.tags_snapshot, '[]'::jsonb),
    q.prompt,
    q.prompt_image_url,
    q.explanation,
    COALESCE(ops.options_snapshot, '[]'::jsonb),
    COALESCE(ops.correct_option_ids, '{}'::uuid[]),
    COALESCE(accs.accepted_answers_snapshot, '[]'::jsonb)
  FROM ordered_sel os
  JOIN public.questions q ON q.id = os.question_id
  JOIN public.study_sets s ON s.id = q.study_set_id
  LEFT JOIN opt_snapshots ops ON ops.question_id = q.id
  LEFT JOIN acc_snapshots accs ON accs.question_id = q.id
  LEFT JOIN tag_snapshots ts ON ts.question_id = q.id
  ORDER BY os.pos ASC;

  -- Increment preset usage metrics if launched from a preset
  IF p_preset_id IS NOT NULL THEN
    UPDATE public.exam_presets
    SET use_count = use_count + 1,
        last_used_at = v_now
    WHERE id = p_preset_id AND user_id = v_caller;
  END IF;

  -- Strictly strip answer keys & explanations pre-submit; honor subject/chapter visibility flags
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', q.id,
        'attempt_id', q.attempt_id,
        'question_id', q.question_id,
        'position', q.position,
        'question_type', q.question_type,
        'source_study_set_id', CASE WHEN v_attempt.show_subject_names THEN q.source_study_set_id ELSE NULL END,
        'source_subject_title', CASE WHEN v_attempt.show_subject_names THEN q.source_subject_title ELSE NULL END,
        'chapter_snapshot', CASE WHEN v_attempt.show_chapter_names THEN q.chapter_snapshot ELSE NULL END,
        'tags_snapshot', q.tags_snapshot,
        'prompt_snapshot', q.prompt_snapshot,
        'prompt_image_url_snapshot', q.prompt_image_url_snapshot,
        'options_snapshot', q.options_snapshot,
        'created_at', q.created_at
      )
      ORDER BY q.position ASC
    ),
    '[]'::jsonb
  )
  INTO v_sanitized_questions
  FROM public.exam_attempt_questions q
  WHERE q.attempt_id = v_attempt.id;

  SELECT COALESCE(jsonb_agg(to_jsonb(src) ORDER BY src.sort_order ASC), '[]'::jsonb)
  INTO v_sources_json
  FROM public.exam_attempt_sources src
  WHERE src.attempt_id = v_attempt.id;

  v_remaining := CASE
    WHEN v_attempt.expires_at IS NOT NULL THEN
      GREATEST(0, floor(EXTRACT(EPOCH FROM (v_attempt.expires_at - v_now)))::integer)
    ELSE NULL
  END;

  RETURN jsonb_build_object(
    'attempt', to_jsonb(v_attempt),
    'sources', v_sources_json,
    'questions', v_sanitized_questions,
    'answers', '[]'::jsonb,
    'server_now', v_now,
    'remaining_seconds', v_remaining
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_exam_attempt_v2(
  text, uuid, jsonb, jsonb, jsonb, integer, integer,
  text, text, integer, boolean, boolean, boolean, boolean, boolean, boolean, uuid, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_exam_attempt_v2(
  text, uuid, jsonb, jsonb, jsonb, integer, integer,
  text, text, integer, boolean, boolean, boolean, boolean, boolean, boolean, uuid, uuid
) TO authenticated;

-- ----------------------------------------------------------------------------
-- D4. save_exam_attempt_answers — Monotonic client_seq + atomic answered_count
-- Fixes SH-010 / DB-P0-6 / SEC-016
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.save_exam_attempt_answers(
  p_attempt_id uuid,
  p_answers jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_now timestamptz := now();
  v_attempt public.exam_attempts%ROWTYPE;
  v_item jsonb;
  v_q_id uuid;
  v_sel uuid[];
  v_typed text;
  v_flagged boolean;
  v_seq bigint;
  v_stale_ids uuid[] := '{}'::uuid[];
  v_saved_ids uuid[] := '{}'::uuid[];
  v_answered_count integer;
  v_remaining integer;
  v_saved_rows jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_answers IS NULL OR jsonb_typeof(p_answers) <> 'array' THEN
    RAISE EXCEPTION 'Answers array is required' USING ERRCODE = '22023';
  END IF;

  -- Acquire FOR NO KEY UPDATE upfront so concurrent autosaves never deadlock upgrading FOR SHARE -> UPDATE
  SELECT * INTO v_attempt
  FROM public.exam_attempts
  WHERE id = p_attempt_id
  FOR NO KEY UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exam attempt not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_attempt.user_id <> v_caller THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_attempt.status <> 'in_progress' THEN
    RAISE EXCEPTION 'Exam attempt is already closed' USING ERRCODE = 'P0004';
  END IF;

  IF v_attempt.expires_at IS NOT NULL AND v_now > v_attempt.expires_at THEN
    RAISE EXCEPTION 'Exam time limit has expired' USING ERRCODE = 'P0003';
  END IF;

  -- Process each answer with cross-attempt check + atomic monotonic client_seq guard
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_answers)
  LOOP
    v_q_id := (v_item->>'attempt_question_id')::uuid;

    IF NOT EXISTS (
      SELECT 1
      FROM public.exam_attempt_questions eq
      WHERE eq.id = v_q_id AND eq.attempt_id = p_attempt_id
    ) THEN
      RAISE EXCEPTION 'Question does not belong to this exam attempt' USING ERRCODE = '23503';
    END IF;

    SELECT COALESCE(array_agg(DISTINCT x::uuid), '{}'::uuid[])
    INTO v_sel
    FROM jsonb_array_elements_text(COALESCE(v_item->'selected_option_ids', '[]'::jsonb)) AS x;

    v_typed := CASE
      WHEN v_item ? 'typed_answer' AND v_item->>'typed_answer' IS NOT NULL
      THEN left(v_item->>'typed_answer', 5000)
      ELSE NULL
    END;
    v_flagged := COALESCE((v_item->>'is_flagged')::boolean, false);
    v_seq := GREATEST(0, COALESCE((v_item->>'client_seq')::bigint, 0));

    INSERT INTO public.exam_attempt_answers (
      attempt_id,
      attempt_question_id,
      user_id,
      selected_option_ids,
      typed_answer,
      is_flagged,
      is_correct,
      client_seq,
      updated_at
    ) VALUES (
      p_attempt_id,
      v_q_id,
      v_caller,
      v_sel,
      v_typed,
      v_flagged,
      NULL,
      v_seq,
      v_now
    )
    ON CONFLICT (attempt_id, attempt_question_id) DO UPDATE
    SET selected_option_ids = EXCLUDED.selected_option_ids,
        typed_answer = EXCLUDED.typed_answer,
        is_flagged = EXCLUDED.is_flagged,
        client_seq = GREATEST(public.exam_attempt_answers.client_seq, EXCLUDED.client_seq),
        updated_at = v_now
    WHERE (public.exam_attempt_answers.client_seq = 0 AND EXCLUDED.client_seq = 0)
       OR EXCLUDED.client_seq >= public.exam_attempt_answers.client_seq;

    IF FOUND THEN
      v_saved_ids := array_append(v_saved_ids, v_q_id);
    ELSE
      v_stale_ids := array_append(v_stale_ids, v_q_id);
    END IF;
  END LOOP;

  -- Atomically recompute live answered_count & unanswered_count on exam_attempts
  SELECT count(*)::integer INTO v_answered_count
  FROM public.exam_attempt_answers a
  JOIN public.exam_attempt_questions q ON q.id = a.attempt_question_id
  WHERE a.attempt_id = p_attempt_id
    AND (
      (q.question_type = 'short_answer' AND a.typed_answer IS NOT NULL AND char_length(trim(a.typed_answer)) > 0)
      OR (q.question_type <> 'short_answer' AND COALESCE(array_length(a.selected_option_ids, 1), 0) > 0)
    );

  UPDATE public.exam_attempts
  SET answered_count = v_answered_count,
      unanswered_count = GREATEST(0, total_questions - v_answered_count)
  WHERE id = p_attempt_id
    AND status = 'in_progress';

  SELECT COALESCE(jsonb_agg(to_jsonb(a)), '[]'::jsonb)
  INTO v_saved_rows
  FROM public.exam_attempt_answers a
  WHERE a.attempt_id = p_attempt_id
    AND a.attempt_question_id = ANY(v_saved_ids);

  v_remaining := CASE
    WHEN v_attempt.expires_at IS NOT NULL THEN
      GREATEST(0, floor(EXTRACT(EPOCH FROM (v_attempt.expires_at - v_now)))::integer)
    ELSE NULL
  END;

  RETURN jsonb_build_object(
    'saved', v_saved_rows,
    'stale_ignored_ids', to_jsonb(v_stale_ids),
    'answered_count', v_answered_count,
    'server_now', v_now,
    'remaining_seconds', v_remaining
  );
END;
$$;

REVOKE ALL ON FUNCTION public.save_exam_attempt_answers(uuid, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_exam_attempt_answers(uuid, jsonb) TO authenticated;

-- ----------------------------------------------------------------------------
-- D5. Helper for post-submit exam breakdowns (subject, chapter, tag)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.build_exam_breakdowns(p_attempt_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH q_graded AS (
    SELECT
      q.id,
      q.source_study_set_id,
      COALESCE(NULLIF(q.source_subject_title, ''), 'General') AS subject_title,
      COALESCE(NULLIF(q.chapter_snapshot, ''), 'Uncategorized') AS chapter,
      q.tags_snapshot,
      (
        CASE
          WHEN q.question_type = 'short_answer' THEN
            a.id IS NOT NULL AND a.typed_answer IS NOT NULL AND char_length(trim(a.typed_answer)) > 0
          ELSE
            a.id IS NOT NULL AND COALESCE(array_length(a.selected_option_ids, 1), 0) > 0
        END
      ) AS has_answer,
      COALESCE(a.is_correct, false) AS is_correct
    FROM public.exam_attempt_questions q
    LEFT JOIN public.exam_attempt_answers a
      ON a.attempt_id = q.attempt_id AND a.attempt_question_id = q.id
    WHERE q.attempt_id = p_attempt_id
  ),
  subj AS (
    SELECT
      source_study_set_id AS study_set_id,
      subject_title,
      count(*)::integer AS total,
      count(*) FILTER (WHERE has_answer AND is_correct)::integer AS correct,
      count(*) FILTER (WHERE has_answer AND NOT is_correct)::integer AS wrong,
      count(*) FILTER (WHERE NOT has_answer)::integer AS unanswered,
      CASE WHEN count(*) > 0
        THEN round((count(*) FILTER (WHERE has_answer AND is_correct))::numeric * 100.0 / count(*)::numeric, 2)
        ELSE 0.00
      END AS accuracy_percent
    FROM q_graded
    GROUP BY source_study_set_id, subject_title
    ORDER BY accuracy_percent ASC, subject_title ASC
  ),
  chap AS (
    SELECT
      source_study_set_id AS study_set_id,
      subject_title,
      chapter,
      count(*)::integer AS total,
      count(*) FILTER (WHERE has_answer AND is_correct)::integer AS correct,
      count(*) FILTER (WHERE has_answer AND NOT is_correct)::integer AS wrong,
      count(*) FILTER (WHERE NOT has_answer)::integer AS unanswered,
      CASE WHEN count(*) > 0
        THEN round((count(*) FILTER (WHERE has_answer AND is_correct))::numeric * 100.0 / count(*)::numeric, 2)
        ELSE 0.00
      END AS accuracy_percent
    FROM q_graded
    GROUP BY source_study_set_id, subject_title, chapter
    ORDER BY accuracy_percent ASC, chapter ASC
  ),
  tags_exp AS (
    SELECT
      (t->>'id') AS tag_id,
      COALESCE(t->>'name', 'Tag') AS tag_name,
      q.has_answer,
      q.is_correct
    FROM q_graded q
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(q.tags_snapshot, '[]'::jsonb)) AS t
    WHERE t ? 'id'
  ),
  tag_agg AS (
    SELECT
      tag_id,
      tag_name,
      count(*)::integer AS total,
      count(*) FILTER (WHERE has_answer AND is_correct)::integer AS correct,
      count(*) FILTER (WHERE has_answer AND NOT is_correct)::integer AS wrong,
      count(*) FILTER (WHERE NOT has_answer)::integer AS unanswered,
      CASE WHEN count(*) > 0
        THEN round((count(*) FILTER (WHERE has_answer AND is_correct))::numeric * 100.0 / count(*)::numeric, 2)
        ELSE 0.00
      END AS accuracy_percent
    FROM tags_exp
    GROUP BY tag_id, tag_name
    ORDER BY accuracy_percent ASC, tag_name ASC
  )
  SELECT jsonb_build_object(
    'subject_breakdown', COALESCE((SELECT jsonb_agg(to_jsonb(s)) FROM subj s), '[]'::jsonb),
    'chapter_breakdown', COALESCE((SELECT jsonb_agg(to_jsonb(c)) FROM chap c), '[]'::jsonb),
    'tag_breakdown', COALESCE((SELECT jsonb_agg(to_jsonb(tg)) FROM tag_agg tg), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.build_exam_breakdowns(uuid) FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- D6. Upgraded submit_exam_attempt() — Set-Based Grading, Unified SM-2,
-- Per-Question source_study_set_id, Coverage Cycle Progression & Full Breakdowns
-- Fixes SH-006, SH-007, SH-029, SH-040
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_exam_attempt(p_attempt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_jwt_role text := public.current_jwt_role();
  v_pre_cycle_id uuid;
  v_pre_user_id uuid;
  v_attempt public.exam_attempts%ROWTYPE;
  v_now timestamptz := now();
  v_final_status text;
  v_time_spent integer;
  v_answered_count integer := 0;
  v_correct_count integer := 0;
  v_wrong_count integer := 0;
  v_unanswered_count integer := 0;
  v_score_percent numeric(5,2) := 0.00;
  v_passed boolean := false;
  v_breakdowns jsonb;
  v_cycle_json jsonb := NULL;
  v_cycle_newly_completed integer := 0;
  v_cycle_total integer;
  v_cycle_completed integer;
  v_cycle_assigned integer;
  v_cycle_answered integer;
  v_cycle_unassigned integer;
  v_cycle_status text;
  v_result jsonb;
BEGIN
  -- 1. Strict caller guard (SH-029 / SEC-016)
  IF v_caller IS NULL AND v_jwt_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  -- 2. Acquire parent coverage_cycles lock BEFORE exam_attempts to match discard/restart lock order (zero AB-BA deadlock)
  SELECT ea.coverage_cycle_id, ea.user_id INTO v_pre_cycle_id, v_pre_user_id
  FROM public.exam_attempts ea
  WHERE ea.id = p_attempt_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exam attempt not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_caller IS NOT NULL AND v_pre_user_id <> v_caller THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_pre_cycle_id IS NOT NULL THEN
    PERFORM 1
    FROM public.coverage_cycles cc
    WHERE cc.id = v_pre_cycle_id
    FOR UPDATE;
  END IF;

  -- Lock attempt exclusively for concurrency safety & idempotency
  SELECT * INTO v_attempt
  FROM public.exam_attempts
  WHERE id = p_attempt_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Exam attempt not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_caller IS NOT NULL AND v_attempt.user_id <> v_caller THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE = '42501';
  END IF;

  IF v_attempt.status = 'discarded' THEN
    RAISE EXCEPTION 'Discarded exam attempt cannot be submitted' USING ERRCODE = 'P0004';
  END IF;

  -- 3. Idempotent return if already finalized
  IF v_attempt.status IN ('submitted', 'expired') THEN
    v_breakdowns := public.build_exam_breakdowns(p_attempt_id);
    IF v_attempt.coverage_cycle_id IS NOT NULL THEN
      SELECT to_jsonb(cc) INTO v_cycle_json
      FROM public.coverage_cycles cc
      WHERE cc.id = v_attempt.coverage_cycle_id;
    END IF;

    SELECT jsonb_build_object(
      'attempt', to_jsonb(v_attempt),
      'sources', COALESCE((
        SELECT jsonb_agg(to_jsonb(s) ORDER BY s.sort_order ASC)
        FROM public.exam_attempt_sources s WHERE s.attempt_id = p_attempt_id
      ), '[]'::jsonb),
      'questions', COALESCE((
        SELECT jsonb_agg(to_jsonb(q) ORDER BY q.position ASC)
        FROM public.exam_attempt_questions q WHERE q.attempt_id = p_attempt_id
      ), '[]'::jsonb),
      'answers', COALESCE((
        SELECT jsonb_agg(to_jsonb(a))
        FROM public.exam_attempt_answers a WHERE a.attempt_id = p_attempt_id
      ), '[]'::jsonb),
      'subject_breakdown', v_breakdowns->'subject_breakdown',
      'chapter_breakdown', v_breakdowns->'chapter_breakdown',
      'tag_breakdown', v_breakdowns->'tag_breakdown',
      'coverage_cycle', v_cycle_json
    ) INTO v_result;
    RETURN v_result;
  END IF;

  -- Lock parent coverage cycle if linked (consistent lock order)
  IF v_attempt.coverage_cycle_id IS NOT NULL THEN
    PERFORM 1 FROM public.coverage_cycles WHERE id = v_attempt.coverage_cycle_id FOR UPDATE;
  END IF;

  -- 4. Determine submitted vs expired from server clock
  IF v_attempt.expires_at IS NOT NULL AND v_now > v_attempt.expires_at THEN
    v_final_status := 'expired';
  ELSE
    v_final_status := 'submitted';
  END IF;

  v_time_spent := GREATEST(0, floor(EXTRACT(EPOCH FROM (v_now - v_attempt.started_at)))::integer);
  IF v_attempt.duration_limit_seconds IS NOT NULL THEN
    v_time_spent := LEAST(v_time_spent, v_attempt.duration_limit_seconds);
  END IF;

  -- 5. Set-based deterministic grading for all snapshot questions (zero N+1 loops!)
  CREATE TEMP TABLE IF NOT EXISTS _tmp_exam_graded (
    attempt_question_id uuid PRIMARY KEY,
    question_id uuid,
    answer_id uuid,
    resolved_study_set_id uuid,
    has_answer boolean NOT NULL,
    is_correct boolean NOT NULL
  ) ON COMMIT DROP;

  TRUNCATE _tmp_exam_graded;

  INSERT INTO _tmp_exam_graded (
    attempt_question_id,
    question_id,
    answer_id,
    resolved_study_set_id,
    has_answer,
    is_correct
  )
  SELECT
    q.id,
    q.question_id,
    a.id,
    COALESCE(q.source_study_set_id, live_q.study_set_id, v_attempt.study_set_id),
    CASE
      WHEN a.id IS NULL THEN false
      WHEN q.question_type = 'short_answer' THEN
        a.typed_answer IS NOT NULL AND char_length(trim(a.typed_answer)) > 0
      ELSE
        COALESCE(array_length(a.selected_option_ids, 1), 0) > 0
    END AS has_answer,
    CASE
      WHEN a.id IS NULL THEN false
      WHEN q.question_type = 'short_answer' THEN (
        a.typed_answer IS NOT NULL
        AND char_length(trim(a.typed_answer)) > 0
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(COALESCE(q.accepted_answers_snapshot, '[]'::jsonb)) AS acc
          WHERE char_length(
            public.normalize_short_answer(
              COALESCE(acc->>'answer_text', acc->>'normalized_answer', ''),
              COALESCE(acc->>'match_mode', 'case_insensitive')
            )
          ) > 0
            AND public.normalize_short_answer(
              a.typed_answer,
              COALESCE(acc->>'match_mode', 'case_insensitive')
            ) = public.normalize_short_answer(
              COALESCE(acc->>'answer_text', acc->>'normalized_answer', ''),
              COALESCE(acc->>'match_mode', 'case_insensitive')
            )
        )
      )
      ELSE (
        COALESCE(array_length(a.selected_option_ids, 1), 0) > 0
        AND COALESCE(array_length(q.correct_option_ids, 1), 0) > 0
        -- Single-choice & true/false must select exactly 1 option
        AND (
          q.question_type = 'multiple_choice'
          OR (SELECT count(DISTINCT x) FROM unnest(a.selected_option_ids) AS x) = 1
        )
        AND (
          SELECT COALESCE(array_agg(DISTINCT x ORDER BY x), '{}'::uuid[])
          FROM unnest(a.selected_option_ids) AS x
        ) = (
          SELECT COALESCE(array_agg(DISTINCT x ORDER BY x), '{}'::uuid[])
          FROM unnest(q.correct_option_ids) AS x
        )
      )
    END AS is_correct
  FROM public.exam_attempt_questions q
  LEFT JOIN public.exam_attempt_answers a
    ON a.attempt_id = p_attempt_id AND a.attempt_question_id = q.id
  LEFT JOIN public.questions live_q
    ON live_q.id = q.question_id
  WHERE q.attempt_id = p_attempt_id;

  -- 6. Bulk update exam_attempt_answers.is_correct
  UPDATE public.exam_attempt_answers a
  SET is_correct = CASE WHEN g.has_answer THEN g.is_correct ELSE false END,
      updated_at = v_now
  FROM _tmp_exam_graded g
  WHERE a.id = g.answer_id;

  -- 7. Aggregate exact totals (true weighted accuracy: totalCorrect / totalQuestions)
  SELECT
    count(*) FILTER (WHERE has_answer)::integer,
    count(*) FILTER (WHERE has_answer AND is_correct)::integer,
    count(*) FILTER (WHERE has_answer AND NOT is_correct)::integer,
    count(*) FILTER (WHERE NOT has_answer)::integer
  INTO v_answered_count, v_correct_count, v_wrong_count, v_unanswered_count
  FROM _tmp_exam_graded;

  IF v_attempt.total_questions > 0 THEN
    v_score_percent := round((v_correct_count::numeric * 100.0) / v_attempt.total_questions::numeric, 2);
  END IF;
  v_passed := v_score_percent >= v_attempt.pass_threshold;

  -- 8. Set-based SM-2 upsert using per-question source_study_set_id (fixes SH-006 & SH-029!)
  -- Unified 1:1 with src/lib/learning/sm2.ts (q=4 for correct, q=1 for wrong, cap=3650d,
  -- mastered iff consecutive_correct >= 3 AND interval_days >= 14).
  WITH answered_valid AS (
    SELECT DISTINCT ON (g.question_id)
      g.question_id,
      live_q.study_set_id AS true_study_set_id,
      g.is_correct
    FROM _tmp_exam_graded g
    JOIN public.questions live_q ON live_q.id = g.question_id
    WHERE g.has_answer
      AND g.question_id IS NOT NULL
    ORDER BY g.question_id
  ),
  computed AS (
    SELECT
      av.question_id,
      av.true_study_set_id,
      av.is_correct,
      COALESCE(p.correct_count, 0) + CASE WHEN av.is_correct THEN 1 ELSE 0 END AS new_correct,
      COALESCE(p.wrong_count, 0) + CASE WHEN av.is_correct THEN 0 ELSE 1 END AS new_wrong,
      CASE WHEN av.is_correct THEN COALESCE(p.consecutive_correct, 0) + 1 ELSE 0 END AS new_consec,
      CASE WHEN av.is_correct THEN COALESCE(p.repetitions, 0) + 1 ELSE 0 END AS new_reps,
      LEAST(
        4.00,
        GREATEST(
          1.30,
          round(
            COALESCE(p.ease_factor, 2.50)
            + CASE WHEN av.is_correct THEN 0.00::numeric ELSE -0.54::numeric END,
            2
          )
        )
      )::numeric(4,2) AS new_ease,
      CASE
        WHEN NOT av.is_correct THEN 1
        WHEN COALESCE(p.repetitions, 0) = 0 THEN 1
        WHEN COALESCE(p.repetitions, 0) = 1 THEN 6
        ELSE LEAST(
          3650,
          GREATEST(1, round(COALESCE(p.interval_days, 1)::numeric * COALESCE(p.ease_factor, 2.50))::integer)
        )
      END AS new_interval
    FROM answered_valid av
    LEFT JOIN public.user_question_progress p
      ON p.user_id = v_attempt.user_id AND p.question_id = av.question_id
  )
  INSERT INTO public.user_question_progress (
    user_id,
    study_set_id,
    question_id,
    mastery_level,
    correct_count,
    wrong_count,
    consecutive_correct,
    ease_factor,
    interval_days,
    repetitions,
    last_reviewed_at,
    next_review_at,
    updated_at
  )
  SELECT
    v_attempt.user_id,
    c.true_study_set_id,
    c.question_id,
    CASE
      WHEN c.new_consec >= 3 AND c.new_interval >= 14 THEN 'mastered'
      WHEN c.new_consec >= 2 OR c.new_interval >= 6 THEN 'familiar'
      ELSE 'learning'
    END,
    c.new_correct,
    c.new_wrong,
    c.new_consec,
    c.new_ease,
    c.new_interval,
    c.new_reps,
    v_now,
    v_now + make_interval(days => c.new_interval),
    v_now
  FROM computed c
  ON CONFLICT (user_id, question_id) DO UPDATE
  SET study_set_id = EXCLUDED.study_set_id,
      mastery_level = EXCLUDED.mastery_level,
      correct_count = EXCLUDED.correct_count,
      wrong_count = EXCLUDED.wrong_count,
      consecutive_correct = EXCLUDED.consecutive_correct,
      ease_factor = EXCLUDED.ease_factor,
      interval_days = EXCLUDED.interval_days,
      repetitions = EXCLUDED.repetitions,
      last_reviewed_at = EXCLUDED.last_reviewed_at,
      next_review_at = EXCLUDED.next_review_at,
      updated_at = EXCLUDED.updated_at;

  -- 9. Finalize exam_attempts row
  UPDATE public.exam_attempts
  SET status = v_final_status,
      answered_count = v_answered_count,
      correct_count = v_correct_count,
      wrong_count = v_wrong_count,
      unanswered_count = v_unanswered_count,
      score_percent = v_score_percent,
      passed = v_passed,
      time_spent_seconds = v_time_spent,
      submitted_at = v_now
  WHERE id = p_attempt_id
  RETURNING * INTO v_attempt;

  -- Update last_studied_at ONLY for sets owned by this user across all source sets
  UPDATE public.study_sets s
  SET last_studied_at = v_now
  WHERE s.owner_id = v_attempt.user_id
    AND s.id IN (
      SELECT DISTINCT resolved_study_set_id
      FROM _tmp_exam_graded
      WHERE resolved_study_set_id IS NOT NULL
    );

  -- 10. Atomically advance linked Full Coverage Cycle (answered -> completed, unanswered -> unassigned!)
  IF v_attempt.coverage_cycle_id IS NOT NULL THEN
    -- Answered questions become completed
    UPDATE public.coverage_cycle_questions cq
    SET state = 'completed',
        assigned_attempt_id = NULL,
        completed_attempt_id = p_attempt_id,
        was_answered = true,
        last_is_correct = g.is_correct,
        completed_at = v_now
    FROM _tmp_exam_graded g
    WHERE cq.cycle_id = v_attempt.coverage_cycle_id
      AND cq.assigned_attempt_id = p_attempt_id
      AND cq.question_id = g.question_id
      AND g.has_answer = true;

    GET DIAGNOSTICS v_cycle_newly_completed = ROW_COUNT;

    -- Unanswered questions revert cleanly to unassigned so zero questions are silently lost
    UPDATE public.coverage_cycle_questions cq
    SET state = 'unassigned',
        assigned_attempt_id = NULL,
        was_answered = false
    WHERE cq.cycle_id = v_attempt.coverage_cycle_id
      AND cq.assigned_attempt_id = p_attempt_id
      AND cq.state = 'assigned';

    UPDATE public.coverage_cycle_attempts
    SET status = 'completed',
        answered_question_count = v_answered_count,
        completed_question_count = v_cycle_newly_completed
    WHERE cycle_id = v_attempt.coverage_cycle_id
      AND attempt_id = p_attempt_id;

    SELECT
      count(*)::integer,
      count(*) FILTER (WHERE state = 'completed')::integer,
      count(*) FILTER (WHERE state = 'assigned')::integer,
      count(*) FILTER (WHERE was_answered)::integer,
      count(*) FILTER (WHERE state = 'unassigned' AND question_id IS NOT NULL)::integer
    INTO v_cycle_total, v_cycle_completed, v_cycle_assigned, v_cycle_answered, v_cycle_unassigned
    FROM public.coverage_cycle_questions
    WHERE cycle_id = v_attempt.coverage_cycle_id;

    v_cycle_status := CASE
      WHEN v_cycle_assigned = 0 AND v_cycle_unassigned = 0 THEN 'completed'
      ELSE 'active'
    END;

    UPDATE public.coverage_cycles
    SET status = v_cycle_status,
        assigned_count = v_cycle_assigned,
        answered_count = v_cycle_answered,
        completed_count = v_cycle_completed,
        active_attempt_id = CASE WHEN active_attempt_id = p_attempt_id THEN NULL ELSE active_attempt_id END,
        completed_at = CASE WHEN v_cycle_status = 'completed' THEN COALESCE(completed_at, v_now) ELSE NULL END,
        updated_at = v_now
    WHERE id = v_attempt.coverage_cycle_id;

    SELECT to_jsonb(cc) INTO v_cycle_json
    FROM public.coverage_cycles cc
    WHERE cc.id = v_attempt.coverage_cycle_id;
  END IF;

  -- 11. Build subject, chapter & tag breakdowns and return complete graded payload
  v_breakdowns := public.build_exam_breakdowns(p_attempt_id);

  SELECT jsonb_build_object(
    'attempt', to_jsonb(v_attempt),
    'sources', COALESCE((
      SELECT jsonb_agg(to_jsonb(s) ORDER BY s.sort_order ASC)
      FROM public.exam_attempt_sources s WHERE s.attempt_id = p_attempt_id
    ), '[]'::jsonb),
    'questions', COALESCE((
      SELECT jsonb_agg(to_jsonb(q) ORDER BY q.position ASC)
      FROM public.exam_attempt_questions q WHERE q.attempt_id = p_attempt_id
    ), '[]'::jsonb),
    'answers', COALESCE((
      SELECT jsonb_agg(to_jsonb(a))
      FROM public.exam_attempt_answers a WHERE a.attempt_id = p_attempt_id
    ), '[]'::jsonb),
    'subject_breakdown', v_breakdowns->'subject_breakdown',
    'chapter_breakdown', v_breakdowns->'chapter_breakdown',
    'tag_breakdown', v_breakdowns->'tag_breakdown',
    'coverage_cycle', v_cycle_json
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.submit_exam_attempt(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_exam_attempt(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- D7. Upgraded get_exam_attempt_detail() — V2.0 Anti-Leak + Full Breakdowns
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_exam_attempt_detail(p_attempt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_now timestamptz := now();
  v_attempt public.exam_attempts%ROWTYPE;
  v_questions jsonb;
  v_answers jsonb;
  v_sources jsonb;
  v_breakdowns jsonb := NULL;
  v_remaining integer;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_attempt
  FROM public.exam_attempts
  WHERE id = p_attempt_id
    AND user_id = v_caller;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(s) ORDER BY s.sort_order ASC), '[]'::jsonb)
  INTO v_sources
  FROM public.exam_attempt_sources s
  WHERE s.attempt_id = p_attempt_id;

  IF v_attempt.status IN ('submitted', 'expired') THEN
    SELECT COALESCE(jsonb_agg(to_jsonb(q) ORDER BY q.position ASC), '[]'::jsonb)
    INTO v_questions
    FROM public.exam_attempt_questions q
    WHERE q.attempt_id = p_attempt_id;

    v_breakdowns := public.build_exam_breakdowns(p_attempt_id);
  ELSE
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', q.id,
          'attempt_id', q.attempt_id,
          'question_id', q.question_id,
          'position', q.position,
          'question_type', q.question_type,
          'source_study_set_id', CASE WHEN v_attempt.show_subject_names THEN q.source_study_set_id ELSE NULL END,
          'source_subject_title', CASE WHEN v_attempt.show_subject_names THEN q.source_subject_title ELSE NULL END,
          'chapter_snapshot', CASE WHEN v_attempt.show_chapter_names THEN q.chapter_snapshot ELSE NULL END,
          'tags_snapshot', q.tags_snapshot,
          'prompt_snapshot', q.prompt_snapshot,
          'prompt_image_url_snapshot', q.prompt_image_url_snapshot,
          'options_snapshot', q.options_snapshot,
          'created_at', q.created_at
        )
        ORDER BY q.position ASC
      ),
      '[]'::jsonb
    )
    INTO v_questions
    FROM public.exam_attempt_questions q
    WHERE q.attempt_id = p_attempt_id;
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(a)), '[]'::jsonb)
  INTO v_answers
  FROM public.exam_attempt_answers a
  WHERE a.attempt_id = p_attempt_id;

  v_remaining := CASE
    WHEN v_attempt.status = 'in_progress' AND v_attempt.expires_at IS NOT NULL THEN
      GREATEST(0, floor(EXTRACT(EPOCH FROM (v_attempt.expires_at - v_now)))::integer)
    ELSE NULL
  END;

  RETURN jsonb_build_object(
    'attempt', to_jsonb(v_attempt),
    'sources', v_sources,
    'questions', v_questions,
    'answers', v_answers,
    'subject_breakdown', COALESCE(v_breakdowns->'subject_breakdown', '[]'::jsonb),
    'chapter_breakdown', COALESCE(v_breakdowns->'chapter_breakdown', '[]'::jsonb),
    'tag_breakdown', COALESCE(v_breakdowns->'tag_breakdown', '[]'::jsonb),
    'server_now', v_now,
    'remaining_seconds', v_remaining
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_exam_attempt_detail(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_exam_attempt_detail(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- D8. Full Coverage Cycle Atomic Lifecycle RPCs
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_coverage_cycle(
  p_title text,
  p_source_snapshot jsonb,
  p_filter_snapshot jsonb,
  p_allocation_strategy text,
  p_questions_per_exam integer,
  p_pool_items jsonb,
  p_preset_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_total integer;
  v_verified integer;
  v_cycle public.coverage_cycles%ROWTYPE;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_pool_items IS NULL OR jsonb_typeof(p_pool_items) <> 'array' THEN
    RAISE EXCEPTION 'Pool items array is required' USING ERRCODE = '22023';
  END IF;

  v_total := jsonb_array_length(p_pool_items);
  IF v_total <= 0 OR v_total > 10000 THEN
    RAISE EXCEPTION 'Coverage pool must contain between 1 and 10000 questions' USING ERRCODE = '22023';
  END IF;

  IF p_preset_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.exam_presets ep WHERE ep.id = p_preset_id AND ep.user_id = v_caller
  ) THEN
    RAISE EXCEPTION 'Preset not found or inaccessible' USING ERRCODE = '42501';
  END IF;

  SELECT count(DISTINCT q.id)::integer INTO v_verified
  FROM jsonb_array_elements(p_pool_items) AS item(val)
  JOIN public.questions q ON q.id = (item.val->>'question_id')::uuid
  WHERE q.question_type <> 'flashcard'
    AND public.can_read_study_set(q.study_set_id, v_caller);

  IF v_verified <> v_total THEN
    RAISE EXCEPTION 'Coverage pool contains duplicate, missing, or inaccessible questions.'
      USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.coverage_cycles (
    user_id,
    preset_id,
    title,
    status,
    source_snapshot,
    filter_snapshot,
    allocation_strategy,
    questions_per_exam,
    total_questions,
    assigned_count,
    answered_count,
    completed_count,
    cycle_number
  ) VALUES (
    v_caller,
    p_preset_id,
    left(trim(COALESCE(NULLIF(p_title, ''), 'Full Coverage Cycle')), 200),
    'active',
    COALESCE(p_source_snapshot, '[]'::jsonb),
    COALESCE(p_filter_snapshot, '{}'::jsonb),
    COALESCE(p_allocation_strategy, 'proportional'),
    GREATEST(1, LEAST(2000, p_questions_per_exam)),
    v_total,
    0,
    0,
    0,
    1
  )
  RETURNING * INTO v_cycle;

  INSERT INTO public.coverage_cycle_questions (
    cycle_id,
    user_id,
    question_id,
    source_study_set_id,
    source_subject_title,
    pool_order,
    state
  )
  SELECT
    v_cycle.id,
    v_caller,
    q.id,
    q.study_set_id,
    s.title,
    (item.ord - 1)::integer,
    'unassigned'
  FROM jsonb_array_elements(p_pool_items) WITH ORDINALITY AS item(val, ord)
  JOIN public.questions q ON q.id = (item.val->>'question_id')::uuid
  JOIN public.study_sets s ON s.id = q.study_set_id
  ORDER BY item.ord ASC;

  RETURN to_jsonb(v_cycle);
END;
$$;

REVOKE ALL ON FUNCTION public.create_coverage_cycle(text, jsonb, jsonb, text, integer, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_coverage_cycle(text, jsonb, jsonb, text, integer, jsonb, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.issue_coverage_cycle_next_exam(
  p_cycle_id uuid,
  p_selected_items jsonb,
  p_sources jsonb,
  p_title_snapshot text,
  p_config jsonb,
  p_duration_limit_seconds integer,
  p_pass_threshold integer,
  p_show_subject_names boolean DEFAULT true,
  p_show_chapter_names boolean DEFAULT true,
  p_allow_navigation boolean DEFAULT true,
  p_allow_mark_for_review boolean DEFAULT true,
  p_auto_submit_on_expire boolean DEFAULT true,
  p_show_review_after_submit boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_now timestamptz := now();
  v_cycle public.coverage_cycles%ROWTYPE;
  v_next_seq integer;
  v_selected_ids uuid[];
  v_unassigned_match integer;
  v_created jsonb;
  v_attempt_id uuid;
  v_assigned_cnt integer;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  -- Lock cycle row exclusively to guarantee zero overlapping / double issuance
  SELECT * INTO v_cycle
  FROM public.coverage_cycles
  WHERE id = p_cycle_id AND user_id = v_caller
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Coverage cycle not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_cycle.active_attempt_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.exam_attempts ea
      WHERE ea.id = v_cycle.active_attempt_id AND ea.status = 'in_progress'
    ) THEN
      RAISE EXCEPTION 'ACTIVE_ATTEMPT_EXISTS:%', v_cycle.active_attempt_id USING ERRCODE = 'P0005';
    END IF;
  END IF;

  SELECT COALESCE(array_agg((item.val->>'question_id')::uuid), '{}'::uuid[])
  INTO v_selected_ids
  FROM jsonb_array_elements(COALESCE(p_selected_items, '[]'::jsonb)) AS item(val);

  IF COALESCE(array_length(v_selected_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'CYCLE_ALREADY_COMPLETED' USING ERRCODE = 'P0006';
  END IF;

  -- Verify all selected questions are currently unassigned inside this cycle
  SELECT count(*)::integer INTO v_unassigned_match
  FROM public.coverage_cycle_questions cq
  WHERE cq.cycle_id = p_cycle_id
    AND cq.state = 'unassigned'
    AND cq.question_id = ANY(v_selected_ids);

  IF v_unassigned_match <> array_length(v_selected_ids, 1) THEN
    RAISE EXCEPTION 'Selected questions are no longer unassigned in this coverage cycle.'
      USING ERRCODE = 'P0007';
  END IF;

  SELECT COALESCE(max(sequence_number), 0) + 1 INTO v_next_seq
  FROM public.coverage_cycle_attempts
  WHERE cycle_id = p_cycle_id;

  -- Create the real exam attempt atomically via create_exam_attempt_v2
  v_created := public.create_exam_attempt_v2(
    p_title_snapshot,
    NULL,
    p_sources,
    p_selected_items,
    p_config,
    p_duration_limit_seconds,
    p_pass_threshold,
    v_cycle.allocation_strategy,
    'random',
    array_length(v_selected_ids, 1),
    p_show_subject_names,
    p_show_chapter_names,
    p_allow_navigation,
    p_allow_mark_for_review,
    p_auto_submit_on_expire,
    p_show_review_after_submit,
    v_cycle.preset_id,
    p_cycle_id
  );

  v_attempt_id := (v_created->'attempt'->>'id')::uuid;

  UPDATE public.coverage_cycle_questions
  SET state = 'assigned',
      assigned_attempt_id = v_attempt_id,
      times_assigned = times_assigned + 1,
      assigned_at = v_now
  WHERE cycle_id = p_cycle_id
    AND question_id = ANY(v_selected_ids);

  INSERT INTO public.coverage_cycle_attempts (
    cycle_id,
    attempt_id,
    user_id,
    sequence_number,
    status,
    assigned_question_count
  ) VALUES (
    p_cycle_id,
    v_attempt_id,
    v_caller,
    v_next_seq,
    'in_progress',
    array_length(v_selected_ids, 1)
  );

  SELECT count(*)::integer INTO v_assigned_cnt
  FROM public.coverage_cycle_questions
  WHERE cycle_id = p_cycle_id AND state = 'assigned';

  UPDATE public.coverage_cycles
  SET active_attempt_id = v_attempt_id,
      assigned_count = v_assigned_cnt,
      status = 'active',
      updated_at = v_now
  WHERE id = p_cycle_id;

  RETURN v_created || jsonb_build_object(
    'cycle_id', p_cycle_id,
    'sequence_number', v_next_seq
  );
END;
$$;

REVOKE ALL ON FUNCTION public.issue_coverage_cycle_next_exam(
  uuid, jsonb, jsonb, text, jsonb, integer, integer,
  boolean, boolean, boolean, boolean, boolean, boolean
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.issue_coverage_cycle_next_exam(
  uuid, jsonb, jsonb, text, jsonb, integer, integer,
  boolean, boolean, boolean, boolean, boolean, boolean
) TO authenticated;

CREATE OR REPLACE FUNCTION public.discard_coverage_cycle_active_exam(p_cycle_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_now timestamptz := now();
  v_cycle public.coverage_cycles%ROWTYPE;
  v_active_id uuid;
  v_reverted integer := 0;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cycle
  FROM public.coverage_cycles
  WHERE id = p_cycle_id AND user_id = v_caller
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Coverage cycle not found' USING ERRCODE = 'P0002';
  END IF;

  v_active_id := v_cycle.active_attempt_id;
  IF v_active_id IS NULL THEN
    RETURN jsonb_build_object(
      'cycle', to_jsonb(v_cycle),
      'discarded_attempt_id', NULL,
      'reverted_questions', 0
    );
  END IF;

  -- Mark attempt as discarded ONLY if still in_progress
  UPDATE public.exam_attempts
  SET status = 'discarded'
  WHERE id = v_active_id
    AND user_id = v_caller
    AND status = 'in_progress';

  -- Revert ALL assigned questions of that attempt cleanly back to unassigned
  UPDATE public.coverage_cycle_questions
  SET state = 'unassigned',
      assigned_attempt_id = NULL,
      was_answered = false
  WHERE cycle_id = p_cycle_id
    AND assigned_attempt_id = v_active_id
    AND state = 'assigned';

  GET DIAGNOSTICS v_reverted = ROW_COUNT;

  UPDATE public.coverage_cycle_attempts
  SET status = 'discarded',
      discarded_at = v_now
  WHERE cycle_id = p_cycle_id
    AND attempt_id = v_active_id
    AND status = 'in_progress';

  UPDATE public.coverage_cycles
  SET active_attempt_id = NULL,
      assigned_count = (
        SELECT count(*)::integer FROM public.coverage_cycle_questions
        WHERE cycle_id = p_cycle_id AND state = 'assigned'
      ),
      updated_at = v_now
  WHERE id = p_cycle_id
  RETURNING * INTO v_cycle;

  RETURN jsonb_build_object(
    'cycle', to_jsonb(v_cycle),
    'discarded_attempt_id', v_active_id,
    'reverted_questions', v_reverted
  );
END;
$$;

REVOKE ALL ON FUNCTION public.discard_coverage_cycle_active_exam(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.discard_coverage_cycle_active_exam(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.restart_coverage_cycle(
  p_cycle_id uuid,
  p_new_pool_items jsonb DEFAULT NULL,
  p_force_discard_active boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_now timestamptz := now();
  v_cycle public.coverage_cycles%ROWTYPE;
  v_total integer;
  v_shift integer;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_cycle
  FROM public.coverage_cycles
  WHERE id = p_cycle_id AND user_id = v_caller
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Coverage cycle not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_cycle.active_attempt_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.exam_attempts ea
      WHERE ea.id = v_cycle.active_attempt_id AND ea.status = 'in_progress'
    ) THEN
      IF NOT COALESCE(p_force_discard_active, false) THEN
        RAISE EXCEPTION 'ACTIVE_ATTEMPT_EXISTS:%', v_cycle.active_attempt_id USING ERRCODE = 'P0005';
      END IF;
      PERFORM public.discard_coverage_cycle_active_exam(p_cycle_id);
    END IF;
  END IF;

  IF p_new_pool_items IS NOT NULL AND jsonb_typeof(p_new_pool_items) = 'array' AND jsonb_array_length(p_new_pool_items) > 0 THEN
    DELETE FROM public.coverage_cycle_questions WHERE cycle_id = p_cycle_id;

    INSERT INTO public.coverage_cycle_questions (
      cycle_id,
      user_id,
      question_id,
      source_study_set_id,
      source_subject_title,
      pool_order,
      state
    )
    SELECT
      p_cycle_id,
      v_caller,
      q.id,
      q.study_set_id,
      s.title,
      (item.ord - 1)::integer,
      'unassigned'
    FROM jsonb_array_elements(p_new_pool_items) WITH ORDINALITY AS item(val, ord)
    JOIN public.questions q ON q.id = (item.val->>'question_id')::uuid
    JOIN public.study_sets s ON s.id = q.study_set_id
    WHERE q.question_type <> 'flashcard'
      AND public.can_read_study_set(q.study_set_id, v_caller)
    ORDER BY item.ord ASC;
  ELSE
    -- Re-shuffle existing cycle questions deterministically using non-negative two-pass shift
    -- (preserves pool_order >= 0 CHECK constraint and UNIQUE(cycle_id, pool_order) at every step)
    SELECT COALESCE(max(pool_order), 0) + 1 INTO v_shift
    FROM public.coverage_cycle_questions
    WHERE cycle_id = p_cycle_id;

    WITH reshuffled AS (
      SELECT id, (row_number() OVER (ORDER BY gen_random_uuid()) - 1)::integer AS new_order
      FROM public.coverage_cycle_questions
      WHERE cycle_id = p_cycle_id
    )
    UPDATE public.coverage_cycle_questions cq
    SET pool_order = v_shift + r.new_order,
        state = 'unassigned',
        assigned_attempt_id = NULL,
        completed_attempt_id = NULL,
        was_answered = false,
        last_is_correct = NULL,
        assigned_at = NULL,
        completed_at = NULL
    FROM reshuffled r
    WHERE cq.id = r.id;

    UPDATE public.coverage_cycle_questions
    SET pool_order = pool_order - v_shift
    WHERE cycle_id = p_cycle_id AND pool_order >= v_shift;
  END IF;

  SELECT count(*)::integer INTO v_total
  FROM public.coverage_cycle_questions
  WHERE cycle_id = p_cycle_id;

  IF v_total <= 0 THEN
    RAISE EXCEPTION 'Cannot restart an empty coverage cycle.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.coverage_cycles
  SET status = 'active',
      total_questions = v_total,
      assigned_count = 0,
      answered_count = 0,
      completed_count = 0,
      active_attempt_id = NULL,
      cycle_number = cycle_number + 1,
      started_at = v_now,
      completed_at = NULL,
      updated_at = v_now
  WHERE id = p_cycle_id
  RETURNING * INTO v_cycle;

  RETURN to_jsonb(v_cycle);
END;
$$;

REVOKE ALL ON FUNCTION public.restart_coverage_cycle(uuid, jsonb, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.restart_coverage_cycle(uuid, jsonb, boolean) TO authenticated;

-- Set-based SQL aggregation for coverage cycle per-subject progress (eliminates N+1 row downloads)
CREATE OR REPLACE FUNCTION public.get_coverage_cycle_subject_progress(
  p_cycle_ids uuid[]
)
RETURNS TABLE (
  cycle_id uuid,
  study_set_id uuid,
  subject_title text,
  total integer,
  completed integer,
  assigned integer,
  remaining integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    cq.cycle_id,
    cq.source_study_set_id AS study_set_id,
    cq.source_subject_title AS subject_title,
    count(*)::integer AS total,
    count(*) FILTER (WHERE cq.state = 'completed')::integer AS completed,
    count(*) FILTER (WHERE cq.state = 'assigned')::integer AS assigned,
    count(*) FILTER (WHERE cq.state = 'unassigned')::integer AS remaining
  FROM public.coverage_cycle_questions cq
  WHERE cq.user_id = (SELECT auth.uid())
    AND (SELECT auth.uid()) IS NOT NULL
    AND cq.cycle_id = ANY(COALESCE(p_cycle_ids, '{}'::uuid[]))
  GROUP BY cq.cycle_id, cq.source_study_set_id, cq.source_subject_title
  ORDER BY cq.cycle_id, cq.source_subject_title ASC;
$$;

REVOKE ALL ON FUNCTION public.get_coverage_cycle_subject_progress(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_coverage_cycle_subject_progress(uuid[]) TO authenticated;

-- ----------------------------------------------------------------------------
-- D9. Upgraded redeem_share_link() + Atomic clone_study_set() (fixes SH-020 / P1-8)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.redeem_share_link(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_link public.study_set_share_links%ROWTYPE;
  v_set public.study_sets%ROWTYPE;
  v_existing public.study_set_members%ROWTYPE;
  v_granted_role text;
  v_granted_clone boolean;
  v_did_change boolean := false;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_link
  FROM public.study_set_share_links
  WHERE token = p_token
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error_code', 'NOT_FOUND');
  END IF;

  IF v_link.revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('error_code', 'REVOKED');
  END IF;

  IF v_link.expires_at IS NOT NULL AND v_link.expires_at <= now() THEN
    RETURN jsonb_build_object('error_code', 'EXPIRED');
  END IF;

  SELECT * INTO v_set
  FROM public.study_sets
  WHERE id = v_link.study_set_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error_code', 'NOT_FOUND');
  END IF;

  IF v_set.owner_id = v_caller THEN
    v_granted_role := 'owner';
    v_granted_clone := true;
  ELSE
    SELECT * INTO v_existing
    FROM public.study_set_members
    WHERE study_set_id = v_set.id
      AND user_id = v_caller;

    IF NOT FOUND THEN
      INSERT INTO public.study_set_members (study_set_id, user_id, role, allow_clone, invited_by)
      VALUES (v_set.id, v_caller, v_link.permission, v_link.allow_clone, v_link.created_by);
      v_granted_role := v_link.permission;
      v_granted_clone := v_link.allow_clone;
      v_did_change := true;
    ELSE
      v_granted_role := CASE
        WHEN v_existing.role = 'viewer' AND v_link.permission = 'editor' THEN 'editor'
        ELSE v_existing.role
      END;
      v_granted_clone := v_existing.allow_clone OR v_link.allow_clone;

      IF v_granted_role IS DISTINCT FROM v_existing.role
         OR v_granted_clone IS DISTINCT FROM v_existing.allow_clone THEN
        UPDATE public.study_set_members
        SET role = v_granted_role,
            allow_clone = v_granted_clone
        WHERE id = v_existing.id;
        v_did_change := true;
      END IF;
    END IF;

    IF v_did_change THEN
      UPDATE public.study_set_share_links
      SET use_count = use_count + 1
      WHERE id = v_link.id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'study_set_id', v_set.id,
    'title', v_set.title,
    'role', v_granted_role,
    'allow_clone', v_granted_clone
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.clone_study_set(
  p_source_set_id uuid,
  p_title text DEFAULT NULL,
  p_folder_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_src public.study_sets%ROWTYPE;
  v_member_clone boolean;
  v_new_set public.study_sets%ROWTYPE;
  v_target_title text;
  v_copied_q integer := 0;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF NOT public.can_read_study_set(p_source_set_id, v_caller) THEN
    RAISE EXCEPTION 'Study set not found or inaccessible' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_src
  FROM public.study_sets
  WHERE id = p_source_set_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Study set not found' USING ERRCODE = 'P0002';
  END IF;

  -- Enforce allow_clone for non-owner shared sets (SH-020 / SEC-012)
  IF v_src.owner_id <> v_caller AND v_src.visibility <> 'public' THEN
    SELECT m.allow_clone INTO v_member_clone
    FROM public.study_set_members m
    WHERE m.study_set_id = p_source_set_id
      AND m.user_id = v_caller;

    IF COALESCE(v_member_clone, false) = false THEN
      RAISE EXCEPTION 'Cloning is disabled for this shared study set.' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Verify target folder ownership
  IF p_folder_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.folders f WHERE f.id = p_folder_id AND f.owner_id = v_caller
  ) THEN
    RAISE EXCEPTION 'Target folder not found' USING ERRCODE = 'P0002';
  END IF;

  v_target_title := left(
    trim(COALESCE(NULLIF(p_title, ''), v_src.title || ' (Copy)')),
    200
  );

  INSERT INTO public.study_sets (
    owner_id,
    folder_id,
    title,
    description,
    subject,
    set_type,
    visibility,
    source_language,
    default_exam_duration_minutes,
    default_pass_threshold
  ) VALUES (
    v_caller,
    p_folder_id,
    v_target_title,
    v_src.description,
    v_src.subject,
    v_src.set_type,
    'private',
    v_src.source_language,
    v_src.default_exam_duration_minutes,
    v_src.default_pass_threshold
  )
  RETURNING * INTO v_new_set;

  -- Deterministic 1:1 old_id -> new_id UUID mapping (never collides on duplicate position!)
  CREATE TEMP TABLE IF NOT EXISTS _tmp_clone_qmap (
    old_id uuid PRIMARY KEY,
    new_id uuid NOT NULL,
    new_pos integer NOT NULL
  ) ON COMMIT DROP;

  TRUNCATE _tmp_clone_qmap;

  INSERT INTO _tmp_clone_qmap (old_id, new_id, new_pos)
  SELECT
    q.id,
    gen_random_uuid(),
    (row_number() OVER (ORDER BY q.position ASC, q.created_at ASC, q.id ASC) - 1)::integer
  FROM public.questions q
  WHERE q.study_set_id = p_source_set_id;

  INSERT INTO public.questions (
    id,
    study_set_id,
    question_type,
    position,
    chapter,
    prompt,
    prompt_image_url,
    back_text,
    back_image_url,
    explanation,
    hint,
    difficulty,
    source_metadata
  )
  SELECT
    m.new_id,
    v_new_set.id,
    q.question_type,
    m.new_pos,
    q.chapter,
    q.prompt,
    q.prompt_image_url,
    q.back_text,
    q.back_image_url,
    q.explanation,
    q.hint,
    q.difficulty,
    q.source_metadata
  FROM _tmp_clone_qmap m
  JOIN public.questions q ON q.id = m.old_id;

  GET DIAGNOSTICS v_copied_q = ROW_COUNT;

  INSERT INTO public.question_options (
    question_id,
    study_set_id,
    position,
    label,
    content,
    image_url,
    is_correct
  )
  SELECT
    m.new_id,
    v_new_set.id,
    o.position,
    o.label,
    o.content,
    o.image_url,
    o.is_correct
  FROM _tmp_clone_qmap m
  JOIN public.question_options o ON o.question_id = m.old_id
  ORDER BY m.new_pos ASC, o.position ASC;

  INSERT INTO public.question_accepted_answers (
    question_id,
    study_set_id,
    answer_text,
    normalized_answer,
    match_mode
  )
  SELECT
    m.new_id,
    v_new_set.id,
    aa.answer_text,
    aa.normalized_answer,
    aa.match_mode
  FROM _tmp_clone_qmap m
  JOIN public.question_accepted_answers aa ON aa.question_id = m.old_id;

  -- Copy tags into caller's tag namespace and link question_tags
  INSERT INTO public.tags (owner_id, name, slug, color)
  SELECT DISTINCT
    v_caller,
    t.name,
    t.slug,
    t.color
  FROM _tmp_clone_qmap m
  JOIN public.question_tags qt ON qt.question_id = m.old_id
  JOIN public.tags t ON t.id = qt.tag_id
  ON CONFLICT (owner_id, slug) DO NOTHING;

  INSERT INTO public.question_tags (question_id, tag_id, study_set_id)
  SELECT DISTINCT
    m.new_id,
    caller_t.id,
    v_new_set.id
  FROM _tmp_clone_qmap m
  JOIN public.question_tags qt ON qt.question_id = m.old_id
  JOIN public.tags src_t ON src_t.id = qt.tag_id
  JOIN public.tags caller_t ON caller_t.owner_id = v_caller AND caller_t.slug = src_t.slug
  ON CONFLICT DO NOTHING;

  -- Refresh final row with trigger-synced question_count
  SELECT * INTO v_new_set
  FROM public.study_sets
  WHERE id = v_new_set.id;

  RETURN jsonb_build_object(
    'study_set', to_jsonb(v_new_set),
    'copied_questions', v_copied_q
  );
END;
$$;

REVOKE ALL ON FUNCTION public.clone_study_set(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.clone_study_set(uuid, text, uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- D10. get_practice_question_pool — Multi-subject custom subset practice RPC
-- Zero PostgREST max_rows=1000 truncation, zero 414 URI Too Long!
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_practice_question_pool(
  p_folder_ids uuid[] DEFAULT '{}'::uuid[],
  p_study_set_ids uuid[] DEFAULT '{}'::uuid[],
  p_include_subfolders boolean DEFAULT true,
  p_filters jsonb DEFAULT '{}'::jsonb,
  p_selection_policy text DEFAULT 'random',
  p_count integer DEFAULT NULL,
  p_shuffle boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_chapters text[];
  v_tag_ids uuid[];
  v_difficulties text[];
  v_qtypes text[];
  v_limit integer;
  v_result jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(array_agg(x), '{}'::text[]) INTO v_chapters
  FROM jsonb_array_elements_text(COALESCE(p_filters->'chapters', '[]'::jsonb)) AS x;

  SELECT COALESCE(array_agg(x::uuid), '{}'::uuid[]) INTO v_tag_ids
  FROM jsonb_array_elements_text(COALESCE(p_filters->'tag_ids', '[]'::jsonb)) AS x;

  SELECT COALESCE(array_agg(x), '{}'::text[]) INTO v_difficulties
  FROM jsonb_array_elements_text(COALESCE(p_filters->'difficulties', '[]'::jsonb)) AS x;

  SELECT COALESCE(array_agg(x), '{}'::text[]) INTO v_qtypes
  FROM jsonb_array_elements_text(COALESCE(p_filters->'question_types', '[]'::jsonb)) AS x;

  v_limit := CASE
    WHEN p_count IS NOT NULL AND p_count > 0 THEN LEAST(p_count, 2000)
    ELSE 2000
  END;

  WITH dedup_sets AS (
    SELECT * FROM public.resolve_deduped_study_sets(
      p_folder_ids, p_study_set_ids, p_include_subfolders
    )
  ),
  candidates AS (
    SELECT
      q.*,
      ds.title AS source_subject_title,
      (sq.question_id IS NOT NULL) AS is_starred,
      to_jsonb(p) AS progress_json,
      CASE p_selection_policy
        WHEN 'unseen_first' THEN CASE WHEN p.id IS NULL THEN 0 ELSE 1 END
        WHEN 'mistakes_first' THEN
          CASE WHEN COALESCE(p.wrong_count, 0) > 0 AND COALESCE(p.mastery_level, 'new') <> 'mastered' THEN 0 ELSE 1 END
        WHEN 'due_for_review' THEN
          CASE WHEN p.next_review_at IS NOT NULL AND p.next_review_at <= now() THEN 0 ELSE 1 END
        WHEN 'weak_topics_first' THEN
          CASE WHEN COALESCE(p.wrong_count, 0) > COALESCE(p.correct_count, 0) THEN 0 ELSE 1 END
        ELSE 0
      END AS priority_tier,
      COALESCE(p.wrong_count, 0) AS wrong_cnt
    FROM dedup_sets ds
    JOIN public.questions q ON q.study_set_id = ds.study_set_id
    LEFT JOIN public.user_question_progress p
      ON p.question_id = q.id AND p.user_id = v_caller
    LEFT JOIN public.starred_questions sq
      ON sq.question_id = q.id AND sq.user_id = v_caller
    WHERE (cardinality(v_chapters) = 0 OR q.chapter = ANY(v_chapters))
      AND (cardinality(v_difficulties) = 0 OR q.difficulty = ANY(v_difficulties))
      AND (cardinality(v_qtypes) = 0 OR q.question_type = ANY(v_qtypes))
      AND (
        cardinality(v_tag_ids) = 0
        OR EXISTS (
          SELECT 1 FROM public.question_tags qt
          WHERE qt.question_id = q.id AND qt.tag_id = ANY(v_tag_ids)
        )
      )
      AND CASE p_selection_policy
        WHEN 'starred_only' THEN (sq.question_id IS NOT NULL)
        WHEN 'incorrect_only' THEN (COALESCE(p.wrong_count, 0) > 0 AND COALESCE(p.mastery_level, 'new') <> 'mastered')
        ELSE true
      END
  ),
  selected AS (
    SELECT *
    FROM candidates
    ORDER BY
      priority_tier ASC,
      CASE WHEN p_selection_policy = 'mistakes_first' THEN -wrong_cnt ELSE 0 END ASC,
      CASE WHEN p_shuffle THEN random() ELSE 0 END ASC,
      position ASC,
      id ASC
    LIMIT v_limit
  ),
  enriched AS (
    SELECT
      to_jsonb(s) - 'progress_json' - 'priority_tier' - 'wrong_cnt'
      || jsonb_build_object(
        'progress', s.progress_json,
        'options', COALESCE((
          SELECT jsonb_agg(to_jsonb(o) ORDER BY o.position ASC)
          FROM public.question_options o
          WHERE o.question_id = s.id
        ), '[]'::jsonb),
        'accepted_answers', COALESCE((
          SELECT jsonb_agg(to_jsonb(aa) ORDER BY aa.created_at ASC)
          FROM public.question_accepted_answers aa
          WHERE aa.question_id = s.id
        ), '[]'::jsonb),
        'tags', COALESCE((
          SELECT jsonb_agg(to_jsonb(t) ORDER BY t.name ASC)
          FROM public.question_tags qt
          JOIN public.tags t ON t.id = qt.tag_id
          WHERE qt.question_id = s.id
        ), '[]'::jsonb)
      ) AS q_obj
    FROM selected s
  )
  SELECT jsonb_build_object(
    'total_eligible', (SELECT count(*)::integer FROM candidates),
    'sources', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('study_set_id', ds.study_set_id, 'title', ds.title))
      FROM dedup_sets ds
    ), '[]'::jsonb),
    'questions', COALESCE((SELECT jsonb_agg(e.q_obj) FROM enriched e), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_practice_question_pool(uuid[], uuid[], boolean, jsonb, text, integer, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_practice_question_pool(uuid[], uuid[], boolean, jsonb, text, integer, boolean) TO authenticated;
