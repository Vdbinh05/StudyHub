import { NextResponse, type NextRequest } from "next/server";
import { tryCreateClient } from "@/lib/supabase/server";
import { apiSuccess, supabaseNotConfiguredResponse } from "@/lib/security/errors";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const supabase = await tryCreateClient();
  if (!supabase) {
    if (request.headers.get("accept")?.includes("application/json")) {
      return supabaseNotConfiguredResponse();
    }
    return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
  }

  await supabase.auth.signOut();

  if (request.headers.get("accept")?.includes("application/json")) {
    return apiSuccess({ signedOut: true });
  }

  return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
}
