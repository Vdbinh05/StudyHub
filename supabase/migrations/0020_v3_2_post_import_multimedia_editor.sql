-- ============================================================================
-- StudyHub V3.2 Addendum (V32-053) — Migration 0020:
-- Post-Import Question Editing, Multi-Image Option/Explanation Snapshots,
-- Pre-Submit Explanation-Media Anti-Leak, and Media Review Filters
-- ============================================================================
-- 100% ADDITIVE, NON-DESTRUCTIVE, IDEMPOTENT, PG 17.12 & SUPABASE-MCP-SAFE.
-- ZERO DROP, ZERO DELETE, ZERO TRUNCATE, ZERO CREATE TEMP TABLE.
-- NEVER modifies 0001–0019. 100% (SELECT auth.uid()), 100% SET search_path = ''.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Server-Protected Column: exam_attempt_questions.review_media_snapshot
--    Answer-revealing media roles ('explanation', 'hint', 'back') live ONLY in
--    review_media_snapshot (NO GRANT SELECT to authenticated!), closing the
--    pre-submit explanation-image leak even against direct PostgREST queries!
-- ----------------------------------------------------------------------------
ALTER TABLE public.exam_attempt_questions
  ADD COLUMN IF NOT EXISTS review_media_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb;

REVOKE ALL (review_media_snapshot) ON public.exam_attempt_questions FROM PUBLIC, anon, authenticated;

-- Close pre-submit explanation/hint/back media side-channel via storage & content_media_relations RLS
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
        AND (
          cmr.role NOT IN ('explanation', 'hint', 'back')
          OR ea.status IN ('submitted', 'expired')
        )
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.can_read_exam_snapshot_media(text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_read_exam_snapshot_media(text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.is_exam_attempt_question_reviewable(
  p_eaq_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_eaq_id IS NULL OR p_user_id IS NULL THEN false
    WHEN public.current_jwt_role() IN ('anon', 'authenticated', 'authenticator')
         AND p_user_id IS DISTINCT FROM (SELECT auth.uid()) THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.exam_attempt_questions eaq
      JOIN public.exam_attempts ea
        ON ea.id = eaq.attempt_id
      WHERE eaq.id = p_eaq_id
        AND ea.user_id = p_user_id
        AND ea.status IN ('submitted', 'expired')
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.is_exam_attempt_question_reviewable(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_exam_attempt_question_reviewable(uuid, uuid) TO authenticated, service_role;

ALTER POLICY "content_media_relations_select_readable"
  ON public.content_media_relations
  USING (
    public.can_read_media_asset(media_id, (SELECT auth.uid()))
    AND (
      entity_type <> 'exam_attempt_question'
      OR role NOT IN ('explanation', 'hint', 'back')
      OR public.is_exam_attempt_question_reviewable(entity_id, (SELECT auth.uid()))
    )
  );

-- Freeze review_media_snapshot inside prevent_exam_snapshot_update() while
-- preserving FK ON DELETE SET NULL on question_id / source_study_set_id / audio_media_id_snapshot.
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
    AND NEW.review_media_snapshot IS NOT DISTINCT FROM OLD.review_media_snapshot
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

-- ----------------------------------------------------------------------------
-- 2. Upgraded create_exam_attempt_v2 (18-arg backward-compatible signature):
--    - media_snapshot holds ONLY safe pre-submit roles ('prompt','audio','passage','diagram_base')
--    - review_media_snapshot holds ONLY post-submit roles ('explanation','hint','back')
--    - options_snapshot[i].media[] captures multi-image question_option galleries
--    - Pins ALL question AND question_option content_media_relations onto exam_attempt_question
--      (ON DELETE RESTRICT protection for every historical image!)
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
  v_total integer;
  v_verified_count integer;
  v_distinct_sets integer;
  v_single_set_id uuid;
  v_duration integer;
  v_expires_at timestamptz;
  v_attempt public.exam_attempts%ROWTYPE;
  v_questions_json jsonb;
  v_sources_json jsonb;
  v_remaining integer;
  v_shuffle_opts boolean := COALESCE((p_config->>'shuffle_options')::boolean, false);
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

  IF p_primary_study_set_id IS NOT NULL
     AND NOT public.can_read_study_set(p_primary_study_set_id, v_caller) THEN
    RAISE EXCEPTION 'Study set not found or inaccessible' USING ERRCODE = '42501';
  END IF;

  IF p_preset_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.exam_presets ep WHERE ep.id = p_preset_id AND ep.user_id = v_caller
  ) THEN
    RAISE EXCEPTION 'Preset not found or inaccessible' USING ERRCODE = '42501';
  END IF;

  IF p_coverage_cycle_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.coverage_cycles cc WHERE cc.id = p_coverage_cycle_id AND cc.user_id = v_caller
  ) THEN
    RAISE EXCEPTION 'Coverage cycle not found or inaccessible' USING ERRCODE = '42501';
  END IF;

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

  -- Set-based V3.2 snapshot insertion with multi-image options, safe pre-submit media_snapshot,
  -- and server-protected review_media_snapshot ('explanation', 'hint', 'back')
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
            'content_rich', o.content_rich,
            'image_url', o.image_url,
            'media_id', o.media_id,
            'image_alt', o.image_alt,
            'media', COALESCE((
              SELECT jsonb_agg(
                jsonb_build_object(
                  'id', cmr.id,
                  'media_id', ma.id,
                  'url', '/api/uploads/signed-url?path=' || public.url_encode_query_param(ma.storage_path) || '&redirect=1',
                  'proxy_url', '/api/uploads/signed-url?path=' || public.url_encode_query_param(ma.storage_path) || '&redirect=1',
                  'storage_path', ma.storage_path,
                  'role', cmr.role,
                  'sort_order', cmr.sort_order,
                  'mime_type', ma.mime_type,
                  'width', ma.width,
                  'height', ma.height,
                  'alt_text', COALESCE(cmr.alt_text, ma.alt_text),
                  'caption', COALESCE(cmr.caption, ma.caption)
                )
                ORDER BY cmr.sort_order ASC, cmr.created_at ASC
              )
              FROM public.content_media_relations cmr
              JOIN public.media_assets ma ON ma.id = cmr.media_id
              WHERE cmr.entity_type = 'question_option'
                AND cmr.entity_id = o.id
            ), '[]'::jsonb),
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
        base_opt.id,
        base_opt.content,
        base_opt.content_rich,
        base_opt.image_url,
        base_opt.media_id,
        base_opt.image_alt,
        base_opt.is_correct,
        base_opt.position,
        row_number() OVER (
          ORDER BY
            CASE
              WHEN jsonb_typeof(os.opt_order) = 'array' AND jsonb_array_length(os.opt_order) > 0 THEN
                COALESCE(
                  (
                    SELECT (ord_idx - 1)
                    FROM jsonb_array_elements_text(os.opt_order) WITH ORDINALITY AS u(uid, ord_idx)
                    WHERE u.uid = base_opt.id::text
                    LIMIT 1
                  ),
                  100000 + base_opt.position
                )
              ELSE 0
            END ASC,
            CASE
              WHEN (jsonb_typeof(os.opt_order) <> 'array' OR jsonb_array_length(os.opt_order) = 0)
                   AND v_shuffle_opts THEN base_opt.rand_key
              ELSE ''
            END ASC,
            base_opt.position ASC,
            base_opt.id ASC
        )::integer AS row_ord
      FROM (
        SELECT
          qo.id,
          qo.content,
          qo.content_rich,
          qo.image_url,
          qo.media_id,
          qo.image_alt,
          qo.is_correct,
          qo.position,
          gen_random_uuid()::text AS rand_key
        FROM public.question_options qo
        WHERE qo.question_id = os.question_id
      ) base_opt
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
  ),
  media_snaps AS (
    SELECT
      os.question_id,
      -- Safe pre-submit media ONLY (prompt, audio, passage, diagram_base)
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', cmr.id,
            'media_id', ma.id,
            'url', '/api/uploads/signed-url?path=' || public.url_encode_query_param(ma.storage_path) || '&redirect=1',
            'proxy_url', '/api/uploads/signed-url?path=' || public.url_encode_query_param(ma.storage_path) || '&redirect=1',
            'storage_path', ma.storage_path,
            'role', cmr.role,
            'sort_order', cmr.sort_order,
            'mime_type', ma.mime_type,
            'width', ma.width,
            'height', ma.height,
            'alt_text', COALESCE(cmr.alt_text, ma.alt_text),
            'caption', COALESCE(cmr.caption, ma.caption)
          )
          ORDER BY cmr.sort_order ASC, cmr.created_at ASC
        ) FILTER (WHERE cmr.role IN ('prompt', 'audio', 'passage', 'diagram_base')),
        '[]'::jsonb
      ) AS media_snapshot,
      -- Post-submit ONLY answer-revealing media (explanation, hint, back)
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'id', cmr.id,
            'media_id', ma.id,
            'url', '/api/uploads/signed-url?path=' || public.url_encode_query_param(ma.storage_path) || '&redirect=1',
            'proxy_url', '/api/uploads/signed-url?path=' || public.url_encode_query_param(ma.storage_path) || '&redirect=1',
            'storage_path', ma.storage_path,
            'role', cmr.role,
            'sort_order', cmr.sort_order,
            'mime_type', ma.mime_type,
            'width', ma.width,
            'height', ma.height,
            'alt_text', COALESCE(cmr.alt_text, ma.alt_text),
            'caption', COALESCE(cmr.caption, ma.caption)
          )
          ORDER BY cmr.sort_order ASC, cmr.created_at ASC
        ) FILTER (WHERE cmr.role IN ('explanation', 'hint', 'back')),
        '[]'::jsonb
      ) AS review_media_snapshot
    FROM ordered_sel os
    JOIN public.content_media_relations cmr
      ON cmr.entity_type = 'question' AND cmr.entity_id = os.question_id
    JOIN public.media_assets ma ON ma.id = cmr.media_id
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
    prompt_rich_snapshot,
    prompt_image_url_snapshot,
    audio_media_id_snapshot,
    audio_url_snapshot,
    passage_snapshot,
    diagram_snapshot,
    type_payload_snapshot,
    media_snapshot,
    review_media_snapshot,
    explanation_snapshot,
    explanation_rich_snapshot,
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
    q.prompt_rich,
    q.prompt_image_url,
    q.audio_media_id,
    q.audio_url,
    CASE WHEN sp.id IS NOT NULL THEN
      jsonb_build_object(
        'id', sp.id,
        'title', sp.title,
        'content_text', sp.content_text,
        'content_rich', sp.content_rich,
        'audio_media_id', sp.audio_media_id,
        'source_reference', sp.source_reference
      )
    ELSE NULL END,
    CASE WHEN ds.id IS NOT NULL THEN
      jsonb_build_object(
        'id', ds.id,
        'title', ds.title,
        'base_media_id', ds.base_media_id,
        'base_image_url', ds.base_image_url,
        'image_width', ds.image_width,
        'image_height', ds.image_height
      )
    ELSE NULL END,
    q.type_payload,
    COALESCE(ms.media_snapshot, '[]'::jsonb),
    COALESCE(ms.review_media_snapshot, '[]'::jsonb),
    q.explanation,
    q.explanation_rich,
    COALESCE(ops.options_snapshot, '[]'::jsonb),
    COALESCE(ops.correct_option_ids, '{}'::uuid[]),
    COALESCE(accs.accepted_answers_snapshot, '[]'::jsonb)
  FROM ordered_sel os
  JOIN public.questions q ON q.id = os.question_id
  JOIN public.study_sets s ON s.id = q.study_set_id
  LEFT JOIN public.shared_passages sp ON sp.id = q.passage_id
  LEFT JOIN public.diagram_sets ds ON ds.id = q.diagram_id
  LEFT JOIN opt_snapshots ops ON ops.question_id = q.id
  LEFT JOIN acc_snapshots accs ON accs.question_id = q.id
  LEFT JOIN tag_snapshots ts ON ts.question_id = q.id
  LEFT JOIN media_snaps ms ON ms.question_id = q.id
  ORDER BY os.pos ASC;

  -- Pin ALL question media relations (prompt, explanation, hint, back, audio, etc.)
  INSERT INTO public.content_media_relations (media_id, entity_type, entity_id, role, sort_order, alt_text, caption)
  SELECT DISTINCT
    cmr.media_id,
    'exam_attempt_question',
    eaq.id,
    cmr.role,
    cmr.sort_order,
    cmr.alt_text,
    cmr.caption
  FROM public.exam_attempt_questions eaq
  JOIN public.content_media_relations cmr
    ON cmr.entity_type = 'question'
   AND cmr.entity_id = eaq.question_id
  WHERE eaq.attempt_id = v_attempt.id
  ON CONFLICT DO NOTHING;

  -- Pin question audio_media_id_snapshot
  INSERT INTO public.content_media_relations (media_id, entity_type, entity_id, role, sort_order)
  SELECT DISTINCT
    eaq.audio_media_id_snapshot,
    'exam_attempt_question',
    eaq.id,
    'audio',
    0
  FROM public.exam_attempt_questions eaq
  WHERE eaq.attempt_id = v_attempt.id
    AND eaq.audio_media_id_snapshot IS NOT NULL
  ON CONFLICT DO NOTHING;

  -- Pin primary question_options.media_id
  INSERT INTO public.content_media_relations (media_id, entity_type, entity_id, role, sort_order)
  SELECT DISTINCT
    qo.media_id,
    'exam_attempt_question',
    eaq.id,
    'option',
    qo.position
  FROM public.exam_attempt_questions eaq
  JOIN public.question_options qo ON qo.question_id = eaq.question_id
  WHERE eaq.attempt_id = v_attempt.id
    AND qo.media_id IS NOT NULL
  ON CONFLICT DO NOTHING;

  -- Pin ALL multi-image question_option content_media_relations onto exam_attempt_question (V32-053)
  INSERT INTO public.content_media_relations (media_id, entity_type, entity_id, role, sort_order, alt_text, caption)
  SELECT DISTINCT
    cmr.media_id,
    'exam_attempt_question',
    eaq.id,
    'option',
    cmr.sort_order,
    cmr.alt_text,
    cmr.caption
  FROM public.exam_attempt_questions eaq
  JOIN public.question_options qo ON qo.question_id = eaq.question_id
  JOIN public.content_media_relations cmr
    ON cmr.entity_type = 'question_option'
   AND cmr.entity_id = qo.id
  WHERE eaq.attempt_id = v_attempt.id
  ON CONFLICT DO NOTHING;

  -- Pin diagram base_media_id
  INSERT INTO public.content_media_relations (media_id, entity_type, entity_id, role, sort_order)
  SELECT DISTINCT
    NULLIF(eaq.diagram_snapshot->>'base_media_id', '')::uuid,
    'exam_attempt_question',
    eaq.id,
    'diagram_base',
    0
  FROM public.exam_attempt_questions eaq
  WHERE eaq.attempt_id = v_attempt.id
    AND public.is_strict_uuid(eaq.diagram_snapshot->>'base_media_id')
    AND EXISTS (
      SELECT 1 FROM public.media_assets ma
      WHERE ma.id = (eaq.diagram_snapshot->>'base_media_id')::uuid
    )
  ON CONFLICT DO NOTHING;

  -- Pin passage audio_media_id
  INSERT INTO public.content_media_relations (media_id, entity_type, entity_id, role, sort_order)
  SELECT DISTINCT
    NULLIF(eaq.passage_snapshot->>'audio_media_id', '')::uuid,
    'exam_attempt_question',
    eaq.id,
    'audio',
    0
  FROM public.exam_attempt_questions eaq
  WHERE eaq.attempt_id = v_attempt.id
    AND public.is_strict_uuid(eaq.passage_snapshot->>'audio_media_id')
    AND EXISTS (
      SELECT 1 FROM public.media_assets ma
      WHERE ma.id = (eaq.passage_snapshot->>'audio_media_id')::uuid
    )
  ON CONFLICT DO NOTHING;

  -- Pin type_payload_snapshot media UUIDs (image_hotspot, listening, ordering.items)
  INSERT INTO public.content_media_relations (media_id, entity_type, entity_id, role, sort_order)
  SELECT DISTINCT
    (eaq.type_payload_snapshot->>'image_media_id')::uuid,
    'exam_attempt_question',
    eaq.id,
    'prompt',
    0
  FROM public.exam_attempt_questions eaq
  WHERE eaq.attempt_id = v_attempt.id
    AND public.is_strict_uuid(eaq.type_payload_snapshot->>'image_media_id')
    AND EXISTS (
      SELECT 1 FROM public.media_assets ma
      WHERE ma.id = (eaq.type_payload_snapshot->>'image_media_id')::uuid
    )
  ON CONFLICT DO NOTHING;

  INSERT INTO public.content_media_relations (media_id, entity_type, entity_id, role, sort_order)
  SELECT DISTINCT
    (eaq.type_payload_snapshot->>'audio_media_id')::uuid,
    'exam_attempt_question',
    eaq.id,
    'audio',
    0
  FROM public.exam_attempt_questions eaq
  WHERE eaq.attempt_id = v_attempt.id
    AND public.is_strict_uuid(eaq.type_payload_snapshot->>'audio_media_id')
    AND EXISTS (
      SELECT 1 FROM public.media_assets ma
      WHERE ma.id = (eaq.type_payload_snapshot->>'audio_media_id')::uuid
    )
  ON CONFLICT DO NOTHING;

  INSERT INTO public.content_media_relations (media_id, entity_type, entity_id, role, sort_order)
  SELECT DISTINCT
    (it.val->>'media_id')::uuid,
    'exam_attempt_question',
    eaq.id,
    'option',
    (it.ord - 1)::integer
  FROM public.exam_attempt_questions eaq
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE
      WHEN jsonb_typeof(eaq.type_payload_snapshot->'items') = 'array'
      THEN eaq.type_payload_snapshot->'items'
      ELSE '[]'::jsonb
    END
  ) WITH ORDINALITY AS it(val, ord)
  WHERE eaq.attempt_id = v_attempt.id
    AND public.is_strict_uuid(it.val->>'media_id')
    AND EXISTS (
      SELECT 1 FROM public.media_assets ma
      WHERE ma.id = (it.val->>'media_id')::uuid
    )
  ON CONFLICT DO NOTHING;

  -- Build SAFE pre-submit question array (ZERO answer keys, ZERO explanation/hint/back media!)
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
        'prompt_rich_snapshot', q.prompt_rich_snapshot,
        'prompt_image_url_snapshot', q.prompt_image_url_snapshot,
        'audio_media_id_snapshot', q.audio_media_id_snapshot,
        'audio_url_snapshot', q.audio_url_snapshot,
        'passage_snapshot', q.passage_snapshot,
        'diagram_snapshot', q.diagram_snapshot,
        'type_payload_snapshot', public.sanitize_pre_submit_type_payload_seeded(q.question_type, q.type_payload_snapshot, q.id::text),
        'media_snapshot', COALESCE((
          SELECT jsonb_agg(elem)
          FROM jsonb_array_elements(
            CASE WHEN jsonb_typeof(q.media_snapshot) = 'array' THEN q.media_snapshot ELSE '[]'::jsonb END
          ) AS elem
          WHERE COALESCE(elem->>'role', 'prompt') IN ('prompt', 'audio', 'passage', 'diagram_base')
        ), '[]'::jsonb),
        'options_snapshot', q.options_snapshot,
        'created_at', q.created_at
      )
      ORDER BY q.position ASC
    ),
    '[]'::jsonb
  )
  INTO v_questions_json
  FROM public.exam_attempt_questions q
  WHERE q.attempt_id = v_attempt.id;

  SELECT COALESCE(
    jsonb_agg(to_jsonb(src) ORDER BY src.sort_order ASC),
    '[]'::jsonb
  )
  INTO v_sources_json
  FROM public.exam_attempt_sources src
  WHERE src.attempt_id = v_attempt.id;

  IF p_preset_id IS NOT NULL THEN
    UPDATE public.exam_presets
    SET use_count = use_count + 1,
        last_used_at = v_now
    WHERE id = p_preset_id AND user_id = v_caller;
  END IF;

  v_remaining := CASE
    WHEN v_attempt.expires_at IS NOT NULL THEN
      GREATEST(0, floor(EXTRACT(EPOCH FROM (v_attempt.expires_at - v_now)))::integer)
    ELSE NULL
  END;

  RETURN jsonb_build_object(
    'attempt', to_jsonb(v_attempt),
    'sources', v_sources_json,
    'questions', v_questions_json,
    'answers', '[]'::jsonb,
    'server_now', v_now,
    'remaining_seconds', v_remaining
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_exam_attempt_v2(
  text, uuid, jsonb, jsonb, jsonb, integer, integer,
  text, text, integer, boolean, boolean, boolean, boolean, boolean, boolean, uuid, uuid
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_exam_attempt_v2(
  text, uuid, jsonb, jsonb, jsonb, integer, integer,
  text, text, integer, boolean, boolean, boolean, boolean, boolean, boolean, uuid, uuid
) TO authenticated;

-- ----------------------------------------------------------------------------
-- 3. Upgraded get_exam_attempt_detail(p_attempt_id uuid):
--    - Pre-submit: filters media_snapshot to safe roles ONLY & omits review_media_snapshot
--    - Post-submit ('submitted', 'expired'): returns full to_jsonb(q) incl. review_media_snapshot
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
          'prompt_rich_snapshot', q.prompt_rich_snapshot,
          'prompt_image_url_snapshot', q.prompt_image_url_snapshot,
          'audio_media_id_snapshot', q.audio_media_id_snapshot,
          'audio_url_snapshot', q.audio_url_snapshot,
          'passage_snapshot', q.passage_snapshot,
          'diagram_snapshot', q.diagram_snapshot,
          'type_payload_snapshot', public.sanitize_pre_submit_type_payload_seeded(q.question_type, q.type_payload_snapshot, q.id::text),
          'media_snapshot', COALESCE((
            SELECT jsonb_agg(elem)
            FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(q.media_snapshot) = 'array' THEN q.media_snapshot ELSE '[]'::jsonb END
            ) AS elem
            WHERE COALESCE(elem->>'role', 'prompt') IN ('prompt', 'audio', 'passage', 'diagram_base')
          ), '[]'::jsonb),
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

REVOKE ALL ON FUNCTION public.get_exam_attempt_detail(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_exam_attempt_detail(uuid) TO authenticated;

-- ----------------------------------------------------------------------------
-- 4. Single-RTT get_study_set_questions_page_v2 + backward-compatible 10-arg
--    get_study_set_questions_page wrapper (ZERO DROP FUNCTION / ZERO overload!):
--    - Adds p_media_filter ('all' | 'has_images' | 'no_images' | 'missing_media' | 'needs_media_review')
--    - Adds #123 / 123 question-number search via ordinal display_num & position
--    - Hydrates question + option media_attachments in ONE RTT (no *_rich bloat in summary mode!)
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_study_set_questions_page_v2(
  p_set_id uuid,
  p_fields text DEFAULT 'full',
  p_chapter text DEFAULT NULL,
  p_difficulty text DEFAULT NULL,
  p_question_type text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_starred_only boolean DEFAULT false,
  p_tag_id uuid DEFAULT NULL,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 50,
  p_media_filter text DEFAULT 'all'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller uuid := (SELECT auth.uid());
  v_is_summary boolean := (lower(COALESCE(p_fields, 'full')) = 'summary');
  v_page integer := GREATEST(1, COALESCE(p_page, 1));
  v_page_size integer := GREATEST(1, LEAST(500, COALESCE(p_page_size, 50)));
  v_offset integer := (v_page - 1) * v_page_size;
  v_search_trimmed text := NULLIF(btrim(COALESCE(p_search, '')), '');
  v_like text := NULL;
  v_search_num integer := NULL;
  v_media_filter text := lower(COALESCE(NULLIF(btrim(p_media_filter), ''), 'all'));
  v_total integer := 0;
  v_items jsonb := '[]'::jsonb;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  IF p_set_id IS NULL OR NOT public.can_read_study_set(p_set_id, v_caller) THEN
    RAISE EXCEPTION 'Study set not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_search_trimmed IS NOT NULL THEN
    v_like := '%' || replace(replace(replace(v_search_trimmed, '\', '\\'), '%', '\%'), '_', '\_') || '%';
    IF v_search_trimmed ~ '^#?[0-9]{1,5}$' THEN
      v_search_num := regexp_replace(v_search_trimmed, '^#', '')::integer;
    END IF;
  END IF;

  IF v_media_filter NOT IN ('all', 'has_images', 'no_images', 'missing_media', 'needs_media_review') THEN
    v_media_filter := 'all';
  END IF;

  IF v_is_summary THEN
    WITH numbered AS (
      SELECT
        q.id,
        q.study_set_id,
        q.question_type,
        q.position,
        q.chapter,
        q.prompt,
        q.prompt_image_url,
        q.back_text,
        q.back_image_url,
        q.explanation,
        q.audio_media_id,
        q.audio_url,
        q.passage_id,
        q.diagram_id,
        q.type_payload,
        q.difficulty,
        q.source_metadata,
        q.created_at,
        q.updated_at,
        row_number() OVER (ORDER BY q.position ASC, q.created_at ASC, q.id ASC)::integer AS display_num
      FROM public.questions q
      WHERE q.study_set_id = p_set_id
    ),
    classified AS (
      SELECT
        n.*,
        (
          n.prompt_image_url IS NOT NULL
          OR n.back_image_url IS NOT NULL
          OR EXISTS (
            SELECT 1
            FROM public.content_media_relations cmr
            WHERE cmr.entity_type = 'question'
              AND cmr.entity_id = n.id
              AND cmr.role IN ('prompt', 'back', 'explanation', 'hint')
          )
          OR EXISTS (
            SELECT 1
            FROM public.question_options o
            WHERE o.study_set_id = p_set_id
              AND o.question_id = n.id
              AND (
                o.image_url IS NOT NULL
                OR o.media_id IS NOT NULL
                OR EXISTS (
                  SELECT 1
                  FROM public.content_media_relations cmr_o
                  WHERE cmr_o.entity_type = 'question_option'
                    AND cmr_o.entity_id = o.id
                )
              )
          )
        ) AS has_any_img
      FROM numbered n
    ),
    matched AS (
      SELECT c.*
      FROM classified c
      WHERE (p_chapter IS NULL OR c.chapter = p_chapter)
        AND (p_difficulty IS NULL OR c.difficulty = p_difficulty)
        AND (p_question_type IS NULL OR c.question_type = p_question_type)
        AND (
          v_like IS NULL
          OR (v_search_num IS NOT NULL AND (c.display_num = v_search_num OR c.position = (v_search_num - 1)))
          OR c.prompt ILIKE v_like ESCAPE '\'
          OR COALESCE(c.back_text, '') ILIKE v_like ESCAPE '\'
          OR COALESCE(c.explanation, '') ILIKE v_like ESCAPE '\'
        )
        AND (
          NOT COALESCE(p_starred_only, false)
          OR EXISTS (
            SELECT 1 FROM public.starred_questions sq
            WHERE sq.user_id = v_caller AND sq.question_id = c.id
          )
        )
        AND (
          p_tag_id IS NULL
          OR EXISTS (
            SELECT 1 FROM public.question_tags qt
            WHERE qt.study_set_id = p_set_id AND qt.question_id = c.id AND qt.tag_id = p_tag_id
          )
        )
        AND (
          v_media_filter = 'all'
          OR (v_media_filter = 'has_images' AND c.has_any_img)
          OR (v_media_filter = 'no_images' AND NOT c.has_any_img)
          OR (
            v_media_filter = 'missing_media'
            AND (
              EXISTS (
                SELECT 1 FROM public.question_reports qr
                WHERE qr.question_id = c.id
                  AND qr.category IN ('missing_media', 'broken_audio')
                  AND qr.status IN ('open', 'reviewing')
                  AND (qr.reporter_id = v_caller OR public.can_edit_study_set(p_set_id, v_caller))
              )
              OR EXISTS (
                SELECT 1
                FROM public.content_media_relations cmr_m
                JOIN public.media_assets ma_m ON ma_m.id = cmr_m.media_id
                WHERE cmr_m.entity_type = 'question'
                  AND cmr_m.entity_id = c.id
                  AND ma_m.is_orphaned = true
              )
              OR (c.question_type = 'image_choice' AND NOT c.has_any_img)
              OR (
                c.question_type = 'image_hotspot'
                AND COALESCE(NULLIF(c.type_payload->>'image_url', ''), '') = ''
                AND c.diagram_id IS NULL
              )
            )
          )
          OR (
            v_media_filter = 'needs_media_review'
            AND (
              (
                c.source_metadata->'ambiguous_media' = 'true'::jsonb
                OR lower(COALESCE(c.source_metadata->>'ambiguous_media', '')) = 'true'
              )
              OR (c.source_metadata ? 'floating_media')
              OR (
                NOT c.has_any_img
                AND c.prompt ~* '(hình\s*(bên|trên|dưới|sau|vẽ|minh\s*họa|\d+)|sơ\s*đồ|biểu\s*đồ|ảnh\s*(bên|trên|dưới|sau)|figure\s*\d*|fig\.\s*\d*|diagram|image\s*(above|below|shown)|shown\s*(above|below)|chart\s*(above|below))'
              )
            )
          )
        )
    ),
    counted AS (
      SELECT count(*)::integer AS total_cnt FROM matched
    ),
    paged AS (
      SELECT m.*
      FROM matched m
      ORDER BY m.position ASC, m.created_at ASC, m.id ASC
      LIMIT v_page_size
      OFFSET v_offset
    )
    SELECT
      (SELECT total_cnt FROM counted),
      COALESCE(
        (
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', p.id,
              'study_set_id', p.study_set_id,
              'question_type', p.question_type,
              'position', p.position,
              'chapter', p.chapter,
              'prompt', p.prompt,
              'prompt_image_url', p.prompt_image_url,
              'back_text', p.back_text,
              'back_image_url', p.back_image_url,
              'audio_media_id', p.audio_media_id,
              'audio_url', p.audio_url,
              'passage_id', p.passage_id,
              'diagram_id', p.diagram_id,
              'difficulty', p.difficulty,
              'created_at', p.created_at,
              'updated_at', p.updated_at,
              'media_attachments', COALESCE((
                SELECT jsonb_agg(
                  jsonb_build_object(
                    'id', cmr.id,
                    'media_id', ma.id,
                    'url', '/api/uploads/signed-url?path=' || public.url_encode_query_param(ma.storage_path) || '&redirect=1',
                    'proxy_url', '/api/uploads/signed-url?path=' || public.url_encode_query_param(ma.storage_path) || '&redirect=1',
                    'storage_path', ma.storage_path,
                    'role', cmr.role,
                    'sort_order', cmr.sort_order,
                    'alt_text', COALESCE(cmr.alt_text, ma.alt_text),
                    'caption', COALESCE(cmr.caption, ma.caption),
                    'mime_type', ma.mime_type,
                    'width', ma.width,
                    'height', ma.height
                  )
                  ORDER BY cmr.sort_order ASC, cmr.created_at ASC
                )
                FROM public.content_media_relations cmr
                JOIN public.media_assets ma ON ma.id = cmr.media_id
                WHERE cmr.entity_type = 'question' AND cmr.entity_id = p.id
              ), '[]'::jsonb),
              'options', COALESCE((
                SELECT jsonb_agg(
                  jsonb_build_object(
                    'id', o.id,
                    'question_id', o.question_id,
                    'study_set_id', o.study_set_id,
                    'position', o.position,
                    'label', o.label,
                    'content', o.content,
                    'image_url', o.image_url,
                    'media_id', o.media_id,
                    'image_alt', o.image_alt,
                    'media_attachments', COALESCE((
                      SELECT jsonb_agg(
                        jsonb_build_object(
                          'id', cmr_o.id,
                          'media_id', ma_o.id,
                          'url', '/api/uploads/signed-url?path=' || public.url_encode_query_param(ma_o.storage_path) || '&redirect=1',
                          'proxy_url', '/api/uploads/signed-url?path=' || public.url_encode_query_param(ma_o.storage_path) || '&redirect=1',
                          'storage_path', ma_o.storage_path,
                          'role', cmr_o.role,
                          'sort_order', cmr_o.sort_order,
                          'alt_text', COALESCE(cmr_o.alt_text, ma_o.alt_text),
                          'caption', COALESCE(cmr_o.caption, ma_o.caption),
                          'mime_type', ma_o.mime_type,
                          'width', ma_o.width,
                          'height', ma_o.height
                        )
                        ORDER BY cmr_o.sort_order ASC, cmr_o.created_at ASC
                      )
                      FROM public.content_media_relations cmr_o
                      JOIN public.media_assets ma_o ON ma_o.id = cmr_o.media_id
                      WHERE cmr_o.entity_type = 'question_option' AND cmr_o.entity_id = o.id
                    ), '[]'::jsonb),
                    'is_correct', o.is_correct,
                    'created_at', o.created_at
                  )
                  ORDER BY o.position ASC
                )
                FROM public.question_options o
                WHERE o.study_set_id = p_set_id AND o.question_id = p.id
              ), '[]'::jsonb),
              'accepted_answers', '[]'::jsonb,
              'tags', '[]'::jsonb,
              'is_starred', EXISTS (
                SELECT 1 FROM public.starred_questions sq
                WHERE sq.user_id = v_caller AND sq.question_id = p.id
              ),
              'progress', NULL
            )
            ORDER BY p.position ASC, p.created_at ASC, p.id ASC
          )
          FROM paged p
        ),
        '[]'::jsonb
      )
    INTO v_total, v_items;
  ELSE
    WITH numbered AS (
      SELECT
        q.*,
        row_number() OVER (ORDER BY q.position ASC, q.created_at ASC, q.id ASC)::integer AS display_num
      FROM public.questions q
      WHERE q.study_set_id = p_set_id
    ),
    classified AS (
      SELECT
        n.*,
        (
          n.prompt_image_url IS NOT NULL
          OR n.back_image_url IS NOT NULL
          OR EXISTS (
            SELECT 1
            FROM public.content_media_relations cmr
            WHERE cmr.entity_type = 'question'
              AND cmr.entity_id = n.id
              AND cmr.role IN ('prompt', 'back', 'explanation', 'hint')
          )
          OR EXISTS (
            SELECT 1
            FROM public.question_options o
            WHERE o.study_set_id = p_set_id
              AND o.question_id = n.id
              AND (
                o.image_url IS NOT NULL
                OR o.media_id IS NOT NULL
                OR EXISTS (
                  SELECT 1
                  FROM public.content_media_relations cmr_o
                  WHERE cmr_o.entity_type = 'question_option'
                    AND cmr_o.entity_id = o.id
                )
              )
          )
        ) AS has_any_img
      FROM numbered n
    ),
    matched AS (
      SELECT c.*
      FROM classified c
      WHERE (p_chapter IS NULL OR c.chapter = p_chapter)
        AND (p_difficulty IS NULL OR c.difficulty = p_difficulty)
        AND (p_question_type IS NULL OR c.question_type = p_question_type)
        AND (
          v_like IS NULL
          OR (v_search_num IS NOT NULL AND (c.display_num = v_search_num OR c.position = (v_search_num - 1)))
          OR c.prompt ILIKE v_like ESCAPE '\'
          OR COALESCE(c.back_text, '') ILIKE v_like ESCAPE '\'
          OR COALESCE(c.explanation, '') ILIKE v_like ESCAPE '\'
        )
        AND (
          NOT COALESCE(p_starred_only, false)
          OR EXISTS (
            SELECT 1 FROM public.starred_questions sq
            WHERE sq.user_id = v_caller AND sq.question_id = c.id
          )
        )
        AND (
          p_tag_id IS NULL
          OR EXISTS (
            SELECT 1 FROM public.question_tags qt
            WHERE qt.study_set_id = p_set_id AND qt.question_id = c.id AND qt.tag_id = p_tag_id
          )
        )
        AND (
          v_media_filter = 'all'
          OR (v_media_filter = 'has_images' AND c.has_any_img)
          OR (v_media_filter = 'no_images' AND NOT c.has_any_img)
          OR (
            v_media_filter = 'missing_media'
            AND (
              EXISTS (
                SELECT 1 FROM public.question_reports qr
                WHERE qr.question_id = c.id
                  AND qr.category IN ('missing_media', 'broken_audio')
                  AND qr.status IN ('open', 'reviewing')
                  AND (qr.reporter_id = v_caller OR public.can_edit_study_set(p_set_id, v_caller))
              )
              OR EXISTS (
                SELECT 1
                FROM public.content_media_relations cmr_m
                JOIN public.media_assets ma_m ON ma_m.id = cmr_m.media_id
                WHERE cmr_m.entity_type = 'question'
                  AND cmr_m.entity_id = c.id
                  AND ma_m.is_orphaned = true
              )
              OR (c.question_type = 'image_choice' AND NOT c.has_any_img)
              OR (
                c.question_type = 'image_hotspot'
                AND COALESCE(NULLIF(c.type_payload->>'image_url', ''), '') = ''
                AND c.diagram_id IS NULL
              )
            )
          )
          OR (
            v_media_filter = 'needs_media_review'
            AND (
              (
                c.source_metadata->'ambiguous_media' = 'true'::jsonb
                OR lower(COALESCE(c.source_metadata->>'ambiguous_media', '')) = 'true'
              )
              OR (c.source_metadata ? 'floating_media')
              OR (
                NOT c.has_any_img
                AND c.prompt ~* '(hình\s*(bên|trên|dưới|sau|vẽ|minh\s*họa|\d+)|sơ\s*đồ|biểu\s*đồ|ảnh\s*(bên|trên|dưới|sau)|figure\s*\d*|fig\.\s*\d*|diagram|image\s*(above|below|shown)|shown\s*(above|below)|chart\s*(above|below))'
              )
            )
          )
        )
    ),
    counted AS (
      SELECT count(*)::integer AS total_cnt FROM matched
    ),
    paged AS (
      SELECT m.*
      FROM matched m
      ORDER BY m.position ASC, m.created_at ASC, m.id ASC
      LIMIT v_page_size
      OFFSET v_offset
    )
    SELECT
      (SELECT total_cnt FROM counted),
      COALESCE(
        (
          SELECT jsonb_agg(
            (to_jsonb(p) - 'display_num' - 'has_any_img') || jsonb_build_object(
              'media_attachments', COALESCE((
                SELECT jsonb_agg(
                  jsonb_build_object(
                    'id', cmr.id,
                    'media_id', ma.id,
                    'url', '/api/uploads/signed-url?path=' || public.url_encode_query_param(ma.storage_path) || '&redirect=1',
                    'proxy_url', '/api/uploads/signed-url?path=' || public.url_encode_query_param(ma.storage_path) || '&redirect=1',
                    'storage_path', ma.storage_path,
                    'role', cmr.role,
                    'sort_order', cmr.sort_order,
                    'alt_text', COALESCE(cmr.alt_text, ma.alt_text),
                    'caption', COALESCE(cmr.caption, ma.caption),
                    'mime_type', ma.mime_type,
                    'width', ma.width,
                    'height', ma.height
                  )
                  ORDER BY cmr.sort_order ASC, cmr.created_at ASC
                )
                FROM public.content_media_relations cmr
                JOIN public.media_assets ma ON ma.id = cmr.media_id
                WHERE cmr.entity_type = 'question' AND cmr.entity_id = p.id
              ), '[]'::jsonb),
              'options', COALESCE((
                SELECT jsonb_agg(
                  to_jsonb(o) || jsonb_build_object(
                    'media_attachments', COALESCE((
                      SELECT jsonb_agg(
                        jsonb_build_object(
                          'id', cmr_o.id,
                          'media_id', ma_o.id,
                          'url', '/api/uploads/signed-url?path=' || public.url_encode_query_param(ma_o.storage_path) || '&redirect=1',
                          'proxy_url', '/api/uploads/signed-url?path=' || public.url_encode_query_param(ma_o.storage_path) || '&redirect=1',
                          'storage_path', ma_o.storage_path,
                          'role', cmr_o.role,
                          'sort_order', cmr_o.sort_order,
                          'alt_text', COALESCE(cmr_o.alt_text, ma_o.alt_text),
                          'caption', COALESCE(cmr_o.caption, ma_o.caption),
                          'mime_type', ma_o.mime_type,
                          'width', ma_o.width,
                          'height', ma_o.height
                        )
                        ORDER BY cmr_o.sort_order ASC, cmr_o.created_at ASC
                      )
                      FROM public.content_media_relations cmr_o
                      JOIN public.media_assets ma_o ON ma_o.id = cmr_o.media_id
                      WHERE cmr_o.entity_type = 'question_option' AND cmr_o.entity_id = o.id
                    ), '[]'::jsonb)
                  )
                  ORDER BY o.position ASC
                )
                FROM public.question_options o
                WHERE o.study_set_id = p_set_id AND o.question_id = p.id
              ), '[]'::jsonb),
              'accepted_answers', COALESCE((
                SELECT jsonb_agg(to_jsonb(aa) ORDER BY aa.created_at ASC)
                FROM public.question_accepted_answers aa
                WHERE aa.study_set_id = p_set_id AND aa.question_id = p.id
              ), '[]'::jsonb),
              'tags', COALESCE((
                SELECT jsonb_agg(to_jsonb(t) ORDER BY t.name ASC)
                FROM public.question_tags qt
                JOIN public.tags t ON t.id = qt.tag_id
                WHERE qt.study_set_id = p_set_id AND qt.question_id = p.id
              ), '[]'::jsonb),
              'is_starred', EXISTS (
                SELECT 1 FROM public.starred_questions sq
                WHERE sq.user_id = v_caller AND sq.question_id = p.id
              ),
              'progress', (
                SELECT jsonb_build_object(
                  'question_id', up.question_id,
                  'mastery_level', up.mastery_level,
                  'correct_count', up.correct_count,
                  'wrong_count', up.wrong_count,
                  'consecutive_correct', up.consecutive_correct,
                  'consecutive_wrong', up.consecutive_wrong,
                  'ease_factor', up.ease_factor,
                  'interval_days', up.interval_days,
                  'repetitions', up.repetitions,
                  'last_reviewed_at', up.last_reviewed_at,
                  'last_wrong_at', up.last_wrong_at,
                  'next_review_at', up.next_review_at,
                  'last_confidence', up.last_confidence,
                  'low_confidence_count', up.low_confidence_count,
                  'high_conf_wrong_count', up.high_conf_wrong_count,
                  'guess_correct_count', up.guess_correct_count,
                  'independent_recall_count', up.independent_recall_count,
                  'hint_used_count', up.hint_used_count,
                  'mistake_status', up.mistake_status
                )
                FROM public.user_question_progress up
                WHERE up.user_id = v_caller AND up.question_id = p.id
                LIMIT 1
              )
            )
            ORDER BY p.position ASC, p.created_at ASC, p.id ASC
          )
          FROM paged p
        ),
        '[]'::jsonb
      )
    INTO v_total, v_items;
  END IF;

  RETURN jsonb_build_object(
    'items', v_items,
    'total', COALESCE(v_total, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_study_set_questions_page_v2(uuid, text, text, text, text, text, boolean, uuid, integer, integer, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_study_set_questions_page_v2(uuid, text, text, text, text, text, boolean, uuid, integer, integer, text) TO authenticated;

-- Keep original 10-arg signature delegating cleanly to _v2 (zero DROP FUNCTION, zero PostgREST ambiguity!)
CREATE OR REPLACE FUNCTION public.get_study_set_questions_page(
  p_set_id uuid,
  p_fields text DEFAULT 'full',
  p_chapter text DEFAULT NULL,
  p_difficulty text DEFAULT NULL,
  p_question_type text DEFAULT NULL,
  p_search text DEFAULT NULL,
  p_starred_only boolean DEFAULT false,
  p_tag_id uuid DEFAULT NULL,
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.get_study_set_questions_page_v2(
    p_set_id,
    p_fields,
    p_chapter,
    p_difficulty,
    p_question_type,
    p_search,
    p_starred_only,
    p_tag_id,
    p_page,
    p_page_size,
    'all'
  );
$$;

REVOKE ALL ON FUNCTION public.get_study_set_questions_page(uuid, text, text, text, text, text, boolean, uuid, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_study_set_questions_page(uuid, text, text, text, text, text, boolean, uuid, integer, integer) TO authenticated;

-- ----------------------------------------------------------------------------
-- 5. Upgraded get_practice_question_pool (7-arg backward-compatible signature):
--    Hydrates question + option media_attachments in ONE RTT for Custom Practice
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
        'media_attachments', COALESCE((
          SELECT jsonb_agg(
            jsonb_build_object(
              'id', cmr.id,
              'media_id', ma.id,
              'url', '/api/uploads/signed-url?path=' || public.url_encode_query_param(ma.storage_path) || '&redirect=1',
              'proxy_url', '/api/uploads/signed-url?path=' || public.url_encode_query_param(ma.storage_path) || '&redirect=1',
              'storage_path', ma.storage_path,
              'role', cmr.role,
              'sort_order', cmr.sort_order,
              'alt_text', COALESCE(cmr.alt_text, ma.alt_text),
              'caption', COALESCE(cmr.caption, ma.caption),
              'mime_type', ma.mime_type,
              'width', ma.width,
              'height', ma.height
            )
            ORDER BY cmr.sort_order ASC, cmr.created_at ASC
          )
          FROM public.content_media_relations cmr
          JOIN public.media_assets ma ON ma.id = cmr.media_id
          WHERE cmr.entity_type = 'question' AND cmr.entity_id = s.id
        ), '[]'::jsonb),
        'options', COALESCE((
          SELECT jsonb_agg(
            to_jsonb(o) || jsonb_build_object(
              'media_attachments', COALESCE((
                SELECT jsonb_agg(
                  jsonb_build_object(
                    'id', cmr_o.id,
                    'media_id', ma_o.id,
                    'url', '/api/uploads/signed-url?path=' || public.url_encode_query_param(ma_o.storage_path) || '&redirect=1',
                    'proxy_url', '/api/uploads/signed-url?path=' || public.url_encode_query_param(ma_o.storage_path) || '&redirect=1',
                    'storage_path', ma_o.storage_path,
                    'role', cmr_o.role,
                    'sort_order', cmr_o.sort_order,
                    'alt_text', COALESCE(cmr_o.alt_text, ma_o.alt_text),
                    'caption', COALESCE(cmr_o.caption, ma_o.caption),
                    'mime_type', ma_o.mime_type,
                    'width', ma_o.width,
                    'height', ma_o.height
                  )
                  ORDER BY cmr_o.sort_order ASC, cmr_o.created_at ASC
                )
                FROM public.content_media_relations cmr_o
                JOIN public.media_assets ma_o ON ma_o.id = cmr_o.media_id
                WHERE cmr_o.entity_type = 'question_option' AND cmr_o.entity_id = o.id
              ), '[]'::jsonb)
            )
            ORDER BY o.position ASC
          )
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

REVOKE ALL ON FUNCTION public.get_practice_question_pool(uuid[], uuid[], boolean, jsonb, text, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_practice_question_pool(uuid[], uuid[], boolean, jsonb, text, integer, boolean) TO authenticated;
