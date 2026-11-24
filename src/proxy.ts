import type { NextRequest, NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

/**
 * Next.js 16 request proxy for Supabase SSR session refresh and route protection.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match App Router page routes only. Exclude:
     * - api/* and auth/* (every Route Handler authenticates directly via `requireAuth()`/`tryCreateClient()`
     *   and security headers are enforced globally in `next.config.ts`, avoiding 2x `auth.getUser()` RTTs)
     * - _next/static, _next/image, favicon.ico, manifest, sw.js, and static asset extensions
     */
    "/((?!api(?:/|$)|auth(?:/|$)|_next/static|_next/image|favicon.ico|manifest\\.webmanifest|sw\\.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|webmanifest)$).*)",
  ],
};
