import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { Database } from "@/types/database";
import { isSafeRelativeRedirect } from "@/lib/security/authz";
import { getSupabaseEnv } from "./env";

const PROTECTED_PREFIXES = [
  "/dashboard",
  "/library",
  "/folders",
  "/sets",
  "/diagrams",
  "/exams",
  "/practice",
  "/import",
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

function copyCookies(source: NextResponse, target: NextResponse): NextResponse {
  for (const cookie of source.cookies.getAll()) {
    target.cookies.set(cookie);
  }
  return target;
}

/**
 * Fast cookie presence check for Supabase SSR auth tokens (`sb-*-auth-token*`).
 * Never trusts the cookie payload itself — only avoids an unnecessary Auth RTT
 * when no session cookie exists at all.
 */
export function hasSupabaseAuthCookie(
  request: Pick<NextRequest, "cookies">,
): boolean {
  return request.cookies
    .getAll()
    .some(
      (cookie) =>
        cookie.name.startsWith("sb-") &&
        !cookie.name.endsWith("-code-verifier") &&
        (cookie.name.includes("-auth-token") ||
          cookie.name === "sb-access-token"),
    );
}

/**
 * Refreshes the Supabase Auth session cookie and guards protected App Router paths.
 * Uses `supabase.auth.getUser()` (never `getSession()`) whenever an auth cookie is present.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;

  // Offline fallback shell must never block on an Auth network round-trip
  if (pathname === "/offline") {
    return NextResponse.next({ request });
  }

  const env = getSupabaseEnv();

  if (!env) {
    // SH-026: Redirect protected routes cleanly to /login?setup=1 instead of rendering
    // full app chrome that spams 503 retries across multiple hooks/queries.
    if (matchesPrefix(pathname, PROTECTED_PREFIXES)) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = "/login";
      loginUrl.search = "";
      loginUrl.searchParams.set("setup", "1");
      const safeNext = isSafeRelativeRedirect(`${pathname}${search}`, "");
      if (safeNext) {
        loginUrl.searchParams.set("next", safeNext);
      }
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next({ request });
  }

  // Fast-path when NO Supabase auth cookie is present (0 ms, zero Auth network RTT):
  // - Protected routes redirect immediately to /login?next=...
  // - Public/auth routes pass straight through without instantiating Supabase SSR
  if (!hasSupabaseAuthCookie(request)) {
    if (matchesPrefix(pathname, PROTECTED_PREFIXES)) {
      const loginUrl = request.nextUrl.clone();
      loginUrl.pathname = "/login";
      loginUrl.search = "";
      const safeNext = isSafeRelativeRedirect(`${pathname}${search}`, "");
      if (safeNext) {
        loginUrl.searchParams.set("next", safeNext);
      }
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({
    request,
  });

  const supabase = createServerClient<Database>(env.url, env.publishableKey, {
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
  let user = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    user = null;
  }

  if (!user && matchesPrefix(pathname, PROTECTED_PREFIXES)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    const safeNext = isSafeRelativeRedirect(`${pathname}${search}`, "");
    if (safeNext) {
      loginUrl.searchParams.set("next", safeNext);
    }
    // SEC-015: Preserve refreshed/cleared auth cookies on redirect response
    return copyCookies(supabaseResponse, NextResponse.redirect(loginUrl));
  }

  if (user && matchesPrefix(pathname, AUTH_REDIRECT_IF_LOGGED_IN)) {
    const dashboardUrl = request.nextUrl.clone();
    dashboardUrl.pathname = "/dashboard";
    dashboardUrl.search = "";
    return copyCookies(supabaseResponse, NextResponse.redirect(dashboardUrl));
  }

  return supabaseResponse;
}
