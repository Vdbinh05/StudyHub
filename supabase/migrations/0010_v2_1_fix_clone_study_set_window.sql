-- ============================================================================
-- StudyHub V2.1 — Migration 0010: Harden & Sync `public.clone_study_set()`
-- ============================================================================
-- Ensures live `public.clone_study_set(uuid, text, uuid)` executes `row_number() OVER (...)`
-- strictly outside any aggregate function (eliminating PG 17 `42803: aggregate function calls
-- cannot contain window function calls`), preserves 1:1 UUID mapping via `_tmp_clone_qmap`,
-- enforces `allow_clone` on shared sets (SH-020 / SEC-012), copies options/accepted answers/tags
-- atomically, and revokes default Supabase Cloud `anon` EXECUTE privileges.
--
-- Non-destructive and idempotent. Migrations 0001–0004 remain strictly untouched.
-- ============================================================================

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

  -- Deterministic 1:1 old_id -> new_id UUID mapping (window computed outside any aggregate!)
  CREATE TEMP TABLE IF NOT EXISTS _tmp_clone_qmap (
    old_id uuid PRIMARY KEY,
    new_id uuid NOT NULL,
    new_pos integer NOT NULL
  ) ON COMMIT DROP;

  TRUNCATE _tmp_clone_qmap;

  INSERT INTO _tmp_clone_qmap (old_id, new_id, new_pos)
  SELECT
    ranked.id,
    gen_random_uuid(),
    ranked.new_pos
  FROM (
    SELECT
      q.id,
      (row_number() OVER (ORDER BY q.position ASC, q.created_at ASC, q.id ASC) - 1)::integer AS new_pos
    FROM public.questions q
    WHERE q.study_set_id = p_source_set_id
  ) ranked;

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

REVOKE ALL ON FUNCTION public.clone_study_set(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.clone_study_set(uuid, text, uuid) TO authenticated;
