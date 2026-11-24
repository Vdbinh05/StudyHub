import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { MemberRole, StudySet } from "@/types/domain";
import { tryCreateClient } from "@/lib/supabase/server";
import { SUPABASE_NOT_CONFIGURED_MESSAGE } from "@/lib/supabase/env";
import { AppError } from "./errors";

export interface AuthContext {
  supabase: SupabaseClient<Database>;
  user: User;
}

export interface OptionalAuthContext {
  supabase: SupabaseClient<Database>;
  user: User | null;
}

export type StudySetAccessLevel = "read" | "edit" | "owner";

export interface StudySetAccessResult {
  studySet: StudySet;
  role: MemberRole | "public_viewer";
  canRead: boolean;
  canEdit: boolean;
  isOwner: boolean;
  canClone: boolean;
}

/**
 * Authenticates the current request via `supabase.auth.getUser()` (never `getSession()`).
 * Throws `AppError(503, SUPABASE_NOT_CONFIGURED)` if env vars are missing,
 * or `AppError(401, UNAUTHORIZED)` if unauthenticated.
 */
export async function requireAuth(): Promise<AuthContext> {
  const supabase = await tryCreateClient();
  if (!supabase) {
    throw new AppError(
      "SUPABASE_NOT_CONFIGURED",
      SUPABASE_NOT_CONFIGURED_MESSAGE,
      503,
    );
  }

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new AppError(
      "UNAUTHORIZED",
      "Authentication is required to access this resource.",
      401,
    );
  }

  return { supabase, user };
}

/**
 * Returns the Supabase client and authenticated user if present (`user: null` if anonymous).
 * Throws `503 SUPABASE_NOT_CONFIGURED` if Supabase env vars are missing.
 */
export async function getOptionalAuth(): Promise<OptionalAuthContext> {
  const supabase = await tryCreateClient();
  if (!supabase) {
    throw new AppError(
      "SUPABASE_NOT_CONFIGURED",
      SUPABASE_NOT_CONFIGURED_MESSAGE,
      503,
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { supabase, user: user ?? null };
}

/**
 * Defense-in-depth authorization check for a study set.
 * Verifies ownership (`study_sets.owner_id` exclusively), explicit `study_set_members` role,
 * or strictly `public` visibility (never blanket-exposing `'unlisted'`).
 * Avoids existence leaks by throwing 404 when the caller has no read access.
 */
export async function requireStudySetAccess(
  supabase: SupabaseClient<Database>,
  studySetId: string,
  userId: string,
  required: StudySetAccessLevel,
): Promise<StudySetAccessResult> {
  const { data: setRow, error: setError } = await supabase
    .from("study_sets")
    .select("*")
    .eq("id", studySetId)
    .maybeSingle();

  if (setError) {
    throw setError;
  }

  if (!setRow) {
    throw new AppError("NOT_FOUND", "Study set not found.", 404);
  }

  const studySet = setRow as StudySet;

  if (studySet.owner_id === userId) {
    return {
      studySet,
      role: "owner",
      canRead: true,
      canEdit: true,
      isOwner: true,
      canClone: true,
    };
  }

  const { data: memberRow, error: memberError } = await supabase
    .from("study_set_members")
    .select("role, allow_clone")
    .eq("study_set_id", studySetId)
    .eq("user_id", userId)
    .maybeSingle();

  if (memberError) {
    throw memberError;
  }

  const memberRole: MemberRole | null = memberRow?.role ?? null;
  // SH-015 / SEC-007: Only 'public' sets are globally readable without membership
  const isPublicReadable = studySet.visibility === "public";

  const canRead = memberRole !== null || isPublicReadable;
  const canEdit = memberRole === "editor" || memberRole === "owner";
  // SH-001 / SEC-001: Only true `study_sets.owner_id === userId` (handled above) is owner
  const isOwner = false;
  // SH-020 / SEC-012: Enforce share-link `allow_clone` on non-public member access
  const canClone = isPublicReadable || Boolean(memberRow?.allow_clone);

  if (!canRead) {
    throw new AppError("NOT_FOUND", "Study set not found.", 404);
  }

  if (required === "owner") {
    throw new AppError(
      "FORBIDDEN",
      "Only the study set owner can perform this action.",
      403,
    );
  }

  if (required === "edit" && !canEdit) {
    throw new AppError(
      "FORBIDDEN",
      "Editor or owner permission is required to modify this study set.",
      403,
    );
  }

  return {
    studySet,
    role: memberRole ?? "public_viewer",
    canRead,
    canEdit,
    isOwner,
    canClone,
  };
}

/**
 * Prevents open-redirect attacks by allowing ONLY clean relative app paths.
 */
export function isSafeRelativeRedirect(
  path: string | null | undefined,
  fallback = "/dashboard",
): string {
  if (!path) {
    return fallback;
  }
  const trimmed = path.trim();
  if (!trimmed.startsWith("/")) {
    return fallback;
  }
  if (trimmed.startsWith("//") || trimmed.startsWith("/\\")) {
    return fallback;
  }
  if (/[\x00-\x1F\x7F\\]/.test(trimmed) || trimmed.includes("://")) {
    return fallback;
  }
  return trimmed;
}
