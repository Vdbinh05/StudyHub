import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import type { Database } from "@/types/database";
import {
  getSupabaseEnv,
  isSupabaseConfigured,
  SUPABASE_NOT_CONFIGURED_MESSAGE,
} from "./env";

export { isSupabaseConfigured };

/**
 * Creates a typed server Supabase client bound to Next.js request cookies.
 * Throws if Supabase env vars are not configured.
 */
export async function createClient(): Promise<SupabaseClient<Database>> {
  const client = await tryCreateClient();
  if (!client) {
    throw new Error(SUPABASE_NOT_CONFIGURED_MESSAGE);
  }
  return client;
}

/**
 * Creates a typed server Supabase client, or returns `null` when Supabase env vars are not configured.
 */
export async function tryCreateClient(): Promise<SupabaseClient<Database> | null> {
  const env = getSupabaseEnv();
  if (!env) {
    return null;
  }

  const cookieStore = await cookies();

  return createServerClient<Database>(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // `setAll` can be called from a Server Component where mutating cookies is not allowed.
          // Session refresh is handled in `src/proxy.ts`.
        }
      },
    },
  });
}
