import { NextResponse, type NextRequest } from "next/server";
import { tryCreateClient } from "@/lib/supabase/server";
import { apiSuccess, supabaseNotConfiguredResponse } from "@/lib/security/errors";

function withNoStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const supabase = await tryCreateClient();
  if (!supabase) {
    if (request.headers.get("accept")?.includes("application/json")) {
      return withNoStore(supabaseNotConfiguredResponse());
    }
    return withNoStore(
      NextResponse.redirect(new URL("/login", request.url), { status: 303 }),
    );
  }

  await supabase.auth.signOut();

  if (request.headers.get("accept")?.includes("application/json")) {
    return withNoStore(apiSuccess({ signedOut: true }));
  }

  return withNoStore(
    NextResponse.redirect(new URL("/login", request.url), { status: 303 }),
  );
}
