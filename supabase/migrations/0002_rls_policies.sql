-- ============================================================================
-- StudyHub V1.0 — Migration 0002: Authorization Helpers & Row-Level Security
-- Strict RLS on all 20 tables using (SELECT auth.uid()) initPlan caching
-- and explicit TO authenticated / TO anon roles (zero auth.role() usage).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Authorization Helper Functions (SECURITY DEFINER, SET search_path = '')
-- Prevents infinite RLS recursion across study_sets, members, and profiles.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_study_set_owner(p_set_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.study_sets s
    WHERE s.id = p_set_id
      AND s.owner_id = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.can_read_study_set(p_set_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.study_sets s
    WHERE s.id = p_set_id
      AND (
        s.visibility IN ('public', 'unlisted')
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
  );
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
    WHEN p_profile_id = p_viewer_id THEN true
    WHEN EXISTS (
      SELECT 1
      FROM public.friendships f
      WHERE f.status IN ('pending', 'accepted')
        AND (
          (f.requester_id = p_viewer_id AND f.addressee_id = p_profile_id)
          OR (f.addressee_id = p_viewer_id AND f.requester_id = p_profile_id)
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

REVOKE ALL ON FUNCTION public.is_study_set_owner(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_read_study_set(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_edit_study_set(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_view_profile(uuid, uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_study_set_owner(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_study_set(uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_edit_study_set(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_view_profile(uuid, uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- Enable RLS on ALL 20 tables
-- ----------------------------------------------------------------------------
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_set_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_set_share_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_accepted_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_question_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.starred_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.study_session_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_attempt_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exam_attempt_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.friendships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.import_jobs ENABLE ROW LEVEL SECURITY;

-- ----------------------------------------------------------------------------
-- 1. profiles
-- ----------------------------------------------------------------------------
CREATE POLICY "profiles_select_visible"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (public.can_view_profile(id, (SELECT auth.uid())));

CREATE POLICY "profiles_insert_own"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (id = (SELECT auth.uid()));

CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (id = (SELECT auth.uid()))
  WITH CHECK (id = (SELECT auth.uid()));

-- ----------------------------------------------------------------------------
-- 2. user_preferences
-- ----------------------------------------------------------------------------
CREATE POLICY "user_preferences_select_own"
  ON public.user_preferences FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "user_preferences_insert_own"
  ON public.user_preferences FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "user_preferences_update_own"
  ON public.user_preferences FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "user_preferences_delete_own"
  ON public.user_preferences FOR DELETE
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ----------------------------------------------------------------------------
-- 3. folders
-- ----------------------------------------------------------------------------
CREATE POLICY "folders_select_own"
  ON public.folders FOR SELECT
  TO authenticated
  USING (owner_id = (SELECT auth.uid()));

CREATE POLICY "folders_insert_own"
  ON public.folders FOR INSERT
  TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid()));

CREATE POLICY "folders_update_own"
  ON public.folders FOR UPDATE
  TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));

CREATE POLICY "folders_delete_own"
  ON public.folders FOR DELETE
  TO authenticated
  USING (owner_id = (SELECT auth.uid()));

-- ----------------------------------------------------------------------------
-- 4. study_sets
-- ----------------------------------------------------------------------------
CREATE POLICY "study_sets_select_readable"
  ON public.study_sets FOR SELECT
  TO authenticated
  USING (public.can_read_study_set(id, (SELECT auth.uid())));

CREATE POLICY "study_sets_select_public_anon"
  ON public.study_sets FOR SELECT
  TO anon
  USING (visibility IN ('public', 'unlisted'));

CREATE POLICY "study_sets_insert_own"
  ON public.study_sets FOR INSERT
  TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid()));

CREATE POLICY "study_sets_update_editable"
  ON public.study_sets FOR UPDATE
  TO authenticated
  USING (public.can_edit_study_set(id, (SELECT auth.uid())))
  WITH CHECK (public.can_edit_study_set(id, (SELECT auth.uid())));

CREATE POLICY "study_sets_delete_own"
  ON public.study_sets FOR DELETE
  TO authenticated
  USING (owner_id = (SELECT auth.uid()));

-- ----------------------------------------------------------------------------
-- 5. study_set_members
-- ----------------------------------------------------------------------------
CREATE POLICY "study_set_members_select"
  ON public.study_set_members FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    OR public.is_study_set_owner(study_set_id, (SELECT auth.uid()))
  );

CREATE POLICY "study_set_members_insert_owner"
  ON public.study_set_members FOR INSERT
  TO authenticated
  WITH CHECK (public.is_study_set_owner(study_set_id, (SELECT auth.uid())));

CREATE POLICY "study_set_members_update_owner"
  ON public.study_set_members FOR UPDATE
  TO authenticated
  USING (public.is_study_set_owner(study_set_id, (SELECT auth.uid())))
  WITH CHECK (public.is_study_set_owner(study_set_id, (SELECT auth.uid())));

CREATE POLICY "study_set_members_delete"
  ON public.study_set_members FOR DELETE
  TO authenticated
  USING (
    public.is_study_set_owner(study_set_id, (SELECT auth.uid()))
    OR user_id = (SELECT auth.uid())
  );

-- ----------------------------------------------------------------------------
-- 6. study_set_share_links
-- ----------------------------------------------------------------------------
CREATE POLICY "study_set_share_links_select_owner"
  ON public.study_set_share_links FOR SELECT
  TO authenticated
  USING (public.is_study_set_owner(study_set_id, (SELECT auth.uid())));

CREATE POLICY "study_set_share_links_insert_owner"
  ON public.study_set_share_links FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_study_set_owner(study_set_id, (SELECT auth.uid()))
    AND created_by = (SELECT auth.uid())
  );

CREATE POLICY "study_set_share_links_update_owner"
  ON public.study_set_share_links FOR UPDATE
  TO authenticated
  USING (public.is_study_set_owner(study_set_id, (SELECT auth.uid())))
  WITH CHECK (public.is_study_set_owner(study_set_id, (SELECT auth.uid())));

CREATE POLICY "study_set_share_links_delete_owner"
  ON public.study_set_share_links FOR DELETE
  TO authenticated
  USING (public.is_study_set_owner(study_set_id, (SELECT auth.uid())));

-- ----------------------------------------------------------------------------
-- 7. questions
-- ----------------------------------------------------------------------------
CREATE POLICY "questions_select_readable"
  ON public.questions FOR SELECT
  TO authenticated
  USING (public.can_read_study_set(study_set_id, (SELECT auth.uid())));

CREATE POLICY "questions_select_public_anon"
  ON public.questions FOR SELECT
  TO anon
  USING (public.can_read_study_set(study_set_id, NULL));

CREATE POLICY "questions_insert_editable"
  ON public.questions FOR INSERT
  TO authenticated
  WITH CHECK (public.can_edit_study_set(study_set_id, (SELECT auth.uid())));

CREATE POLICY "questions_update_editable"
  ON public.questions FOR UPDATE
  TO authenticated
  USING (public.can_edit_study_set(study_set_id, (SELECT auth.uid())))
  WITH CHECK (public.can_edit_study_set(study_set_id, (SELECT auth.uid())));

CREATE POLICY "questions_delete_editable"
  ON public.questions FOR DELETE
  TO authenticated
  USING (public.can_edit_study_set(study_set_id, (SELECT auth.uid())));

-- ----------------------------------------------------------------------------
-- 8. question_options
-- ----------------------------------------------------------------------------
CREATE POLICY "question_options_select_readable"
  ON public.question_options FOR SELECT
  TO authenticated
  USING (public.can_read_study_set(study_set_id, (SELECT auth.uid())));

CREATE POLICY "question_options_select_public_anon"
  ON public.question_options FOR SELECT
  TO anon
  USING (public.can_read_study_set(study_set_id, NULL));

CREATE POLICY "question_options_insert_editable"
  ON public.question_options FOR INSERT
  TO authenticated
  WITH CHECK (public.can_edit_study_set(study_set_id, (SELECT auth.uid())));

CREATE POLICY "question_options_update_editable"
  ON public.question_options FOR UPDATE
  TO authenticated
  USING (public.can_edit_study_set(study_set_id, (SELECT auth.uid())))
  WITH CHECK (public.can_edit_study_set(study_set_id, (SELECT auth.uid())));

CREATE POLICY "question_options_delete_editable"
  ON public.question_options FOR DELETE
  TO authenticated
  USING (public.can_edit_study_set(study_set_id, (SELECT auth.uid())));

-- ----------------------------------------------------------------------------
-- 9. question_accepted_answers
-- ----------------------------------------------------------------------------
CREATE POLICY "question_accepted_answers_select_readable"
  ON public.question_accepted_answers FOR SELECT
  TO authenticated
  USING (public.can_read_study_set(study_set_id, (SELECT auth.uid())));

CREATE POLICY "question_accepted_answers_select_public_anon"
  ON public.question_accepted_answers FOR SELECT
  TO anon
  USING (public.can_read_study_set(study_set_id, NULL));

CREATE POLICY "question_accepted_answers_insert_editable"
  ON public.question_accepted_answers FOR INSERT
  TO authenticated
  WITH CHECK (public.can_edit_study_set(study_set_id, (SELECT auth.uid())));

CREATE POLICY "question_accepted_answers_update_editable"
  ON public.question_accepted_answers FOR UPDATE
  TO authenticated
  USING (public.can_edit_study_set(study_set_id, (SELECT auth.uid())))
  WITH CHECK (public.can_edit_study_set(study_set_id, (SELECT auth.uid())));

CREATE POLICY "question_accepted_answers_delete_editable"
  ON public.question_accepted_answers FOR DELETE
  TO authenticated
  USING (public.can_edit_study_set(study_set_id, (SELECT auth.uid())));

-- ----------------------------------------------------------------------------
-- 10. tags
-- ----------------------------------------------------------------------------
CREATE POLICY "tags_select_own"
  ON public.tags FOR SELECT
  TO authenticated
  USING (owner_id = (SELECT auth.uid()));

CREATE POLICY "tags_insert_own"
  ON public.tags FOR INSERT
  TO authenticated
  WITH CHECK (owner_id = (SELECT auth.uid()));

CREATE POLICY "tags_update_own"
  ON public.tags FOR UPDATE
  TO authenticated
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (owner_id = (SELECT auth.uid()));

CREATE POLICY "tags_delete_own"
  ON public.tags FOR DELETE
  TO authenticated
  USING (owner_id = (SELECT auth.uid()));

-- ----------------------------------------------------------------------------
-- 11. question_tags
-- ----------------------------------------------------------------------------
CREATE POLICY "question_tags_select_readable"
  ON public.question_tags FOR SELECT
  TO authenticated
  USING (public.can_read_study_set(study_set_id, (SELECT auth.uid())));

CREATE POLICY "question_tags_insert_editable"
  ON public.question_tags FOR INSERT
  TO authenticated
  WITH CHECK (
    public.can_edit_study_set(study_set_id, (SELECT auth.uid()))
    AND EXISTS (
      SELECT 1
      FROM public.tags t
      WHERE t.id = tag_id
        AND t.owner_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "question_tags_delete_editable"
  ON public.question_tags FOR DELETE
  TO authenticated
  USING (public.can_edit_study_set(study_set_id, (SELECT auth.uid())));

-- ----------------------------------------------------------------------------
-- 12. user_question_progress
-- ----------------------------------------------------------------------------
CREATE POLICY "user_question_progress_select_own"
  ON public.user_question_progress FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "user_question_progress_insert_own"
  ON public.user_question_progress FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND public.can_read_study_set(study_set_id, (SELECT auth.uid()))
  );

CREATE POLICY "user_question_progress_update_own"
  ON public.user_question_progress FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "user_question_progress_delete_own"
  ON public.user_question_progress FOR DELETE
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ----------------------------------------------------------------------------
-- 13. starred_questions
-- ----------------------------------------------------------------------------
CREATE POLICY "starred_questions_select_own"
  ON public.starred_questions FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "starred_questions_insert_own"
  ON public.starred_questions FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND public.can_read_study_set(study_set_id, (SELECT auth.uid()))
  );

CREATE POLICY "starred_questions_delete_own"
  ON public.starred_questions FOR DELETE
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ----------------------------------------------------------------------------
-- 14. study_sessions
-- ----------------------------------------------------------------------------
CREATE POLICY "study_sessions_select_own"
  ON public.study_sessions FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "study_sessions_insert_own"
  ON public.study_sessions FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND public.can_read_study_set(study_set_id, (SELECT auth.uid()))
  );

CREATE POLICY "study_sessions_update_own"
  ON public.study_sessions FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "study_sessions_delete_own"
  ON public.study_sessions FOR DELETE
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ----------------------------------------------------------------------------
-- 15. study_session_answers (append-only)
-- ----------------------------------------------------------------------------
CREATE POLICY "study_session_answers_select_own"
  ON public.study_session_answers FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "study_session_answers_insert_own"
  ON public.study_session_answers FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.study_sessions ss
      WHERE ss.id = session_id
        AND ss.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "study_session_answers_delete_own"
  ON public.study_session_answers FOR DELETE
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ----------------------------------------------------------------------------
-- 16. exam_attempts (INSERT/UPDATE handled strictly via Server RPC / Route Handler)
-- ----------------------------------------------------------------------------
CREATE POLICY "exam_attempts_select_own"
  ON public.exam_attempts FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "exam_attempts_delete_own"
  ON public.exam_attempts FOR DELETE
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- ----------------------------------------------------------------------------
-- 17. exam_attempt_questions (Column-level REVOKE blocks pre-submit answer leakage)
-- ----------------------------------------------------------------------------
CREATE POLICY "exam_attempt_questions_select_own"
  ON public.exam_attempt_questions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.exam_attempts ea
      WHERE ea.id = attempt_id
        AND ea.user_id = (SELECT auth.uid())
    )
  );

-- Enforce strict column-level privilege restriction on exam_attempt_questions so
-- direct client PostgREST SELECT can NEVER read correct_option_ids,
-- accepted_answers_snapshot, or explanation_snapshot.
REVOKE ALL ON public.exam_attempt_questions FROM anon, authenticated;
GRANT SELECT (
  id,
  attempt_id,
  question_id,
  position,
  question_type,
  chapter_snapshot,
  prompt_snapshot,
  prompt_image_url_snapshot,
  options_snapshot,
  created_at
) ON public.exam_attempt_questions TO authenticated;

-- ----------------------------------------------------------------------------
-- 18. exam_attempt_answers
-- ----------------------------------------------------------------------------
CREATE POLICY "exam_attempt_answers_select_own"
  ON public.exam_attempt_answers FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "exam_attempt_answers_insert_in_progress"
  ON public.exam_attempt_answers FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND is_correct IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.exam_attempts ea
      WHERE ea.id = attempt_id
        AND ea.user_id = (SELECT auth.uid())
        AND ea.status = 'in_progress'
        AND (ea.expires_at IS NULL OR now() <= ea.expires_at)
    )
  );

CREATE POLICY "exam_attempt_answers_update_in_progress"
  ON public.exam_attempt_answers FOR UPDATE
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.exam_attempts ea
      WHERE ea.id = attempt_id
        AND ea.user_id = (SELECT auth.uid())
        AND ea.status = 'in_progress'
        AND (ea.expires_at IS NULL OR now() <= ea.expires_at)
    )
  )
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND is_correct IS NULL
    AND EXISTS (
      SELECT 1
      FROM public.exam_attempts ea
      WHERE ea.id = attempt_id
        AND ea.user_id = (SELECT auth.uid())
        AND ea.status = 'in_progress'
        AND (ea.expires_at IS NULL OR now() <= ea.expires_at)
    )
  );

-- ----------------------------------------------------------------------------
-- 19. friendships
-- ----------------------------------------------------------------------------
CREATE POLICY "friendships_select_participant"
  ON public.friendships FOR SELECT
  TO authenticated
  USING (
    requester_id = (SELECT auth.uid())
    OR addressee_id = (SELECT auth.uid())
  );

CREATE POLICY "friendships_insert_requester"
  ON public.friendships FOR INSERT
  TO authenticated
  WITH CHECK (
    requester_id = (SELECT auth.uid())
    AND status = 'pending'
  );

CREATE POLICY "friendships_update_participant"
  ON public.friendships FOR UPDATE
  TO authenticated
  USING (
    addressee_id = (SELECT auth.uid())
    OR requester_id = (SELECT auth.uid())
  )
  WITH CHECK (
    (addressee_id = (SELECT auth.uid()) AND status IN ('accepted', 'declined', 'blocked'))
    OR (requester_id = (SELECT auth.uid()) AND status = 'blocked')
  );

CREATE POLICY "friendships_delete_participant"
  ON public.friendships FOR DELETE
  TO authenticated
  USING (
    requester_id = (SELECT auth.uid())
    OR addressee_id = (SELECT auth.uid())
  );

-- ----------------------------------------------------------------------------
-- 20. import_jobs
-- ----------------------------------------------------------------------------
CREATE POLICY "import_jobs_select_own"
  ON public.import_jobs FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "import_jobs_insert_own"
  ON public.import_jobs FOR INSERT
  TO authenticated
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "import_jobs_update_own"
  ON public.import_jobs FOR UPDATE
  TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

CREATE POLICY "import_jobs_delete_own"
  ON public.import_jobs FOR DELETE
  TO authenticated
  USING (user_id = (SELECT auth.uid()));
