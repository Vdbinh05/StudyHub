import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";
import { getSupabaseEnv } from "./env";

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/library",
  "/folders",
  "/sets",
  "/review",
  "/starred",
  "/history",
  "/statistics",
  "/shared",
  "/friends",
  "/profile",
  "/settings",
];

const AUTH_REDIRECT_IF_LOGGED_IN = ["/login", "/register", "/forgot-password"];

function matchesPrefix(pathname: string, prefixes: string[]): boolean {
  return prefixes.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

/**
 * Refreshes the Supabase Auth session cookie and guards protected App Router paths.
 * Uses `supabase.auth.getUser()` (never `getSession()`) to verify session authenticity.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const env = getSupabaseEnv();
  if (!env) {
    // Do not crash or fake authentication when Supabase env vars are not yet configured.
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient<Database>(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        supabaseResponse = NextResponse.next({
          request,
        });
        for (const { name, value, options } of cookiesToSet) {
          supabaseResponse.cookies.set(name, value, options);
        }
      },
    },
  });

  // Always verify via getUser() on the server rather than trusting cookie payloads alone.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;

  if (!user && matchesPrefix(pathname, PROTECTED_PREFIXES)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    const nextPath = `${pathname}${search}`;
    if (nextPath.startsWith("/") && !nextPath.startsWith("//")) {
      loginUrl.searchParams.set("next", nextPath);
    }
    return NextResponse.redirect(loginUrl);
  }

  if (user && matchesPrefix(pathname, AUTH_REDIRECT_IF_LOGGED_IN)) {
    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.pathname = "/dashboard";
    dashboardUrl.search = "";
    return NextResponse.redirect(dashboardUrl);
  }

  return supabaseResponse;
}
