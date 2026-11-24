import "server-only";
import { createClient as createSupabaseJsClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  getSupabaseEnv,
  getSupabaseSecretKey,
  isSupabaseAdminConfigured,
  SUPABASE_NOT_CONFIGURED_MESSAGE,
} from "./env";

export { isSupabaseAdminConfigured };

// Runtime server-only guard (protects SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY from client bundles)
if (typeof window !== "undefined") {
  throw new Error(
    "SECURITY VIOLATION: src/lib/supabase/admin.ts is server-only and must never be imported in client code.",
  );
}

/**
 * Creates a privileged server-only Supabase client using `SUPABASE_SECRET_KEY`
 * (`sb_secret_...`) or legacy `SUPABASE_SERVICE_ROLE_KEY`.
 * Use ONLY for trusted server operations (e.g., account deletion via Auth Admin API).
 * NEVER expose this client or its key to browser code.
 */
export function createAdminClient(): SupabaseClient<Database> {
  const client = tryCreateAdminClient();
  if (!client) {
    throw new Error(
      `${SUPABASE_NOT_CONFIGURED_MESSAGE} Also ensure SUPABASE_SECRET_KEY (or legacy SUPABASE_SERVICE_ROLE_KEY) is set on the server.`,
    );
  }
  return client;
}

/**
 * Returns a server-only admin Supabase client or `null` if URL or secret/service-role key is missing.
 */
export function tryCreateAdminClient(): SupabaseClient<Database> | null {
  if (typeof window !== "undefined") {
    throw new Error(
      "SECURITY VIOLATION: tryCreateAdminClient() cannot run in the browser.",
    );
  }

  const env = getSupabaseEnv();
  const secretKey = getSupabaseSecretKey();
  if (!env || !secretKey) {
    return null;
  }

  return createSupabaseJsClient<Database>(env.url, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
