-- ============================================================================
-- StudyHub V1.0 — Migration 0004: Storage Bucket & Strict RLS Policies
-- Bucket: study-media (private, raster-only, 5 MB cap, NO SVG)
-- Path conventions:
--   - {owner_id}/{study_set_id}/{uuid}.{ext}
--   - avatars/{user_id}/{uuid}.{ext}
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'study-media',
  'study-media',
  false,
  5242880, -- 5 MB
  ARRAY['image/png', 'image/jpeg', 'image/webp', 'image/gif']::text[]
)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Helper check: authenticated user can read avatar or readable study set media
CREATE POLICY "study_media_select"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'study-media'
    AND (
      -- Own avatar or visible profile's avatar: avatars/{user_id}/{filename}
      (
        (storage.foldername(name))[1] = 'avatars'
        AND (storage.foldername(name))[2] ~ '^[0-9a-f-]{36}$'
        AND public.can_view_profile(((storage.foldername(name))[2])::uuid, (SELECT auth.uid()))
      )
      OR
      -- Study set media: {owner_id}/{study_set_id}/{filename}
      (
        (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
        AND (storage.foldername(name))[2] ~ '^[0-9a-f-]{36}$'
        AND (
          ((storage.foldername(name))[1])::uuid = (SELECT auth.uid())
          OR public.can_read_study_set(((storage.foldername(name))[2])::uuid, (SELECT auth.uid()))
        )
      )
    )
  );

-- INSERT policy (supports uploading own avatars & editable study set images)
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
      OR
      (
        (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
        AND (storage.foldername(name))[2] ~ '^[0-9a-f-]{36}$'
        AND public.can_edit_study_set(((storage.foldername(name))[2])::uuid, (SELECT auth.uid()))
      )
    )
  );

-- UPDATE policy (required alongside INSERT + SELECT for Supabase Storage upserts)
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
      OR
      (
        (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
        AND (storage.foldername(name))[2] ~ '^[0-9a-f-]{36}$'
        AND public.can_edit_study_set(((storage.foldername(name))[2])::uuid, (SELECT auth.uid()))
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
      OR
      (
        (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
        AND (storage.foldername(name))[2] ~ '^[0-9a-f-]{36}$'
        AND public.can_edit_study_set(((storage.foldername(name))[2])::uuid, (SELECT auth.uid()))
      )
    )
  );

-- DELETE policy
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
      OR
      (
        (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$'
        AND (storage.foldername(name))[2] ~ '^[0-9a-f-]{36}$'
        AND public.can_edit_study_set(((storage.foldername(name))[2])::uuid, (SELECT auth.uid()))
      )
    )
  );
