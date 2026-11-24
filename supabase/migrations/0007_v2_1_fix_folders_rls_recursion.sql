-- ============================================================================
-- StudyHub V2.1 — Migration 0007: Fix PostgreSQL 17 `folders` RLS Recursion (`42P17`)
-- ============================================================================
-- Fixes self-recursion on `public.folders` INSERT/UPDATE policies caught during
-- live PG 17.12 testing (`42P17: infinite recursion detected in policy for relation "folders"`).
-- Uses a hardened SECURITY DEFINER helper `public.is_folder_owner(uuid, uuid)` with
-- `current_jwt_role()` anti-oracle guard and idempotent `ALTER POLICY` statements.
--
-- Non-destructive and idempotent. Migrations 0001–0004 remain strictly untouched.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.is_folder_owner(p_folder_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_folder_id IS NULL OR p_user_id IS NULL THEN false
    WHEN public.current_jwt_role() IN ('anon', 'authenticated', 'authenticator')
         AND p_user_id IS DISTINCT FROM (SELECT auth.uid()) THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.folders f
      WHERE f.id = p_folder_id
        AND f.owner_id = p_user_id
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.is_folder_owner(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_folder_owner(uuid, uuid) TO authenticated, service_role;

ALTER POLICY "folders_insert_own" ON public.folders
  WITH CHECK (
    owner_id = (SELECT auth.uid())
    AND (
      parent_id IS NULL
      OR public.is_folder_owner(parent_id, (SELECT auth.uid()))
    )
  );

ALTER POLICY "folders_update_own" ON public.folders
  USING (owner_id = (SELECT auth.uid()))
  WITH CHECK (
    owner_id = (SELECT auth.uid())
    AND (
      parent_id IS NULL
      OR public.is_folder_owner(parent_id, (SELECT auth.uid()))
    )
  );
