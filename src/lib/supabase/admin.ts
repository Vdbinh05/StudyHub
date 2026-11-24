import "server-only";
import { createClient as createSupabaseJsClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  getSupabaseEnv,
  getSupabaseServiceRoleKey,
  SUPABASE_NOT_CONFIGURED_MESSAGE,
} from "./env";

// Runtime server-only guard (protects SUPABASE_SERVICE_ROLE_KEY from ever entering client bundles/execution)
if (typeof window !== "undefined") {
  throw new Error(
    "SECURITY VIOLATION: src/lib/supabase/admin.ts is server-only and must never be imported in client code.",
  );
}

/**
 * Creates a privileged server-only Supabase client using `SUPABASE_SERVICE_ROLE_KEY`.
 * Use ONLY for trusted server operations (e.g., exam snapshot creation/grading fallback,
 * share link token verification before membership grant, account deletion).
 * NEVER expose this client or its key to browser code.
 */
export function createAdminClient(): SupabaseClient<Database> {
  const client = tryCreateAdminClient();
  if (!client) {
    throw new Error(
      `${SUPABASE_NOT_CONFIGURED_MESSAGE} Also ensure SUPABASE_SERVICE_ROLE_KEY is set on the server.`,
    );
  }
  return client;
}

/**
 * Returns a server-only admin Supabase client or `null` if URL or service role key is missing.
 */
export function tryCreateAdminClient(): SupabaseClient<Database> | null {
  if (typeof window !== "undefined") {
    throw new Error(
      "SECURITY VIOLATION: tryCreateAdminClient() cannot run in the browser.",
    );
  }

  const env = getSupabaseEnv();
  const serviceRoleKey = getSupabaseServiceRoleKey();
  if (!env || !serviceRoleKey) {
    return null;
  }

  return createSupabaseJsClient<Database>(env.url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
