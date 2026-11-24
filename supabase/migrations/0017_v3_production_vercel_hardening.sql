-- ============================================================================
-- StudyHub V3.0 — Migration 0017: Vercel Hobby Production Hardening
--   1. Private `study-temp` Storage bucket (20 MB) + strict `{auth.uid()}` RLS
--      for direct browser uploads (> 4.5 MB Vercel Hobby body limit bypass)
--   2. Distributed PostgreSQL rate limiting (`public.api_rate_limits` deny-all
--      RLS + atomic `service_role`-only `check_and_increment_rate_limit` RPC)
-- ============================================================================
-- 100% additive, PG 17.12 & Supabase-MCP-safe.
-- NEVER modifies 0001–0016. ZERO DROP POLICY, ZERO DROP TRIGGER, ZERO TEMP TABLE.
-- ZERO new anon/authenticated SECURITY DEFINER grants.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Private `study-temp` Bucket (20 MB, NO SVG, NO HTML) + Own-Prefix RLS
-- ----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'study-temp',
  'study-temp',
  false,
  20971520, -- 20 MB ceiling (covers 15 MB imports, 12 MB backups, 10 MB audio, 5 MB images)
  ARRAY[
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/pdf',
    'text/csv',
    'text/tab-separated-values',
    'text/plain',
    'application/json',
    'application/octet-stream',
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/gif',
    'audio/mpeg',
    'audio/wav',
    'audio/x-wav',
    'audio/mp4',
    'audio/m4a',
    'audio/x-m4a',
    'audio/aac',
    'audio/webm',
    'audio/ogg'
  ]
)
ON CONFLICT (id) DO UPDATE
SET public = false,
    file_size_limit = 20971520,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'study_temp_select_own'
  ) THEN
    CREATE POLICY "study_temp_select_own"
      ON storage.objects FOR SELECT
      TO authenticated
      USING (
        bucket_id = 'study-temp'
        AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'study_temp_insert_own'
  ) THEN
    CREATE POLICY "study_temp_insert_own"
      ON storage.objects FOR INSERT
      TO authenticated
      WITH CHECK (
        bucket_id = 'study-temp'
        AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects' AND policyname = 'study_temp_delete_own'
  ) THEN
    CREATE POLICY "study_temp_delete_own"
      ON storage.objects FOR DELETE
      TO authenticated
      USING (
        bucket_id = 'study-temp'
        AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
      );
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. Distributed Serverless Rate Limit Store (`public.api_rate_limits`)
--    Strict deny-all RLS (zero client policies); accessed ONLY via server-side
--    `service_role` calling `public.check_and_increment_rate_limit()`.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.api_rate_limits (
  bucket_key text PRIMARY KEY CHECK (char_length(bucket_key) BETWEEN 1 AND 256),
  hit_count integer NOT NULL DEFAULT 1 CHECK (hit_count >= 0),
  window_start timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_api_rate_limits_expires_at
  ON public.api_rate_limits (expires_at);

ALTER TABLE public.api_rate_limits ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.api_rate_limits FROM PUBLIC, anon, authenticated;

-- Atomic server-only rate limit check & increment with opportunistic pruning (~5% of calls)
CREATE OR REPLACE FUNCTION public.check_and_increment_rate_limit(
  p_bucket_key text,
  p_limit integer,
  p_window_seconds integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := now();
  v_limit integer := GREATEST(1, LEAST(100000, COALESCE(p_limit, 1)));
  v_window_sec integer := GREATEST(1, LEAST(86400, COALESCE(p_window_seconds, 60)));
  v_key text := left(trim(COALESCE(p_bucket_key, '')), 256);
  v_new_expires timestamptz := v_now + make_interval(secs => v_window_sec);
  v_count integer;
  v_expires timestamptz;
  v_allowed boolean;
  v_retry_after integer;
BEGIN
  IF char_length(v_key) = 0 THEN
    RAISE EXCEPTION 'bucket_key is required' USING ERRCODE = '22023';
  END IF;

  -- Opportunistically prune expired rows (~3.1% of calls, overflow-safe bitwise mask) to keep Free-Tier DB tiny
  IF (hashtext(v_key || v_now::text) & 31) = 0 THEN
    DELETE FROM public.api_rate_limits
    WHERE expires_at < v_now - interval '5 minutes';
  END IF;

  INSERT INTO public.api_rate_limits (bucket_key, hit_count, window_start, expires_at)
  VALUES (v_key, 1, v_now, v_new_expires)
  ON CONFLICT (bucket_key) DO UPDATE
  SET hit_count = CASE
        WHEN public.api_rate_limits.expires_at <= v_now THEN 1
        WHEN public.api_rate_limits.hit_count <= v_limit THEN public.api_rate_limits.hit_count + 1
        ELSE public.api_rate_limits.hit_count
      END,
      window_start = CASE
        WHEN public.api_rate_limits.expires_at <= v_now THEN v_now
        ELSE public.api_rate_limits.window_start
      END,
      expires_at = CASE
        WHEN public.api_rate_limits.expires_at <= v_now THEN v_new_expires
        ELSE public.api_rate_limits.expires_at
      END
  RETURNING hit_count, expires_at INTO v_count, v_expires;

  v_allowed := v_count <= v_limit;
  v_retry_after := CASE
    WHEN v_allowed THEN 0
    ELSE GREATEST(1, ceil(EXTRACT(EPOCH FROM (v_expires - v_now)))::integer)
  END;

  RETURN jsonb_build_object(
    'allowed', v_allowed,
    'limit', v_limit,
    'remaining', GREATEST(0, v_limit - v_count),
    'reset_at_ms', floor(EXTRACT(EPOCH FROM v_expires) * 1000)::bigint,
    'retry_after_seconds', v_retry_after
  );
END;
$$;

REVOKE ALL ON FUNCTION public.check_and_increment_rate_limit(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_and_increment_rate_limit(text, integer, integer) TO service_role;
