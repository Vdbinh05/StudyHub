import { NextResponse, type NextRequest } from "next/server";
import { tryCreateClient } from "@/lib/supabase/server";
import { apiSuccess, supabaseNotConfiguredResponse } from "@/lib/security/errors";

function withPrivateNoStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Vary", "Cookie");
  return response;
}

function relativeLoginRedirect(): NextResponse {
  // V32-013: Always emit a relative Location so reverse-proxy / localhost host differences
  // never trigger cross-origin CSP connect-src 'self' blocks on non-JSON callers.
  return new NextResponse(null, {
    status: 303,
    headers: {
      Location: "/login",
      "Cache-Control": "private, no-store",
      Vary: "Cookie",
    },
  });
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const wantsJson = request.headers.get("accept")?.includes("application/json");
  const supabase = await tryCreateClient();
  if (!supabase) {
    if (wantsJson) {
      return withPrivateNoStore(supabaseNotConfiguredResponse());
    }
    return relativeLoginRedirect();
  }

  await supabase.auth.signOut();

  if (wantsJson) {
    return withPrivateNoStore(apiSuccess({ ok: true, signedOut: true }));
  }

  return relativeLoginRedirect();
}
