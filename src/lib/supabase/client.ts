import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  getSupabaseEnv,
  isSupabaseConfigured,
  SUPABASE_NOT_CONFIGURED_MESSAGE,
} from "./env";

export { isSupabaseConfigured };

/**
 * Creates a typed browser Supabase client using `@supabase/ssr`.
 * Throws a clear configuration error if Supabase env vars are missing.
 */
export function createClient(): SupabaseClient<Database> {
  const env = getSupabaseEnv();
  if (!env) {
    throw new Error(SUPABASE_NOT_CONFIGURED_MESSAGE);
  }
  return createBrowserClient<Database>(env.url, env.anonKey);
}

/**
 * Returns a browser Supabase client or `null` when Supabase env vars are not configured.
 */
export function tryCreateClient(): SupabaseClient<Database> | null {
  const env = getSupabaseEnv();
  if (!env) {
    return null;
  }
  return createBrowserClient<Database>(env.url, env.anonKey);
}
