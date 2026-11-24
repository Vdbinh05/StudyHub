import { NextResponse, type NextRequest } from "next/server";
import { tryCreateClient } from "@/lib/supabase/server";
import { isSafeRelativeRedirect } from "@/lib/security/authz";
import {
  enforceDistributedRateLimit,
  RATE_LIMITS,
} from "@/lib/security/rate-limit";

function redirectNoStore(url: string): NextResponse {
  const res = NextResponse.redirect(url);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const limited = await enforceDistributedRateLimit(
    request,
    RATE_LIMITS.AUTH_ACTION,
  );
  if (limited) {
    limited.headers.set("Cache-Control", "no-store");
    return limited;
  }

  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const safeNext = isSafeRelativeRedirect(searchParams.get("next"), "/dashboard");

  const supabase = await tryCreateClient();
  if (!supabase) {
    return redirectNoStore(`${origin}/login?error=supabase_not_configured`);
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return redirectNoStore(`${origin}${safeNext}`);
    }
  }

  return redirectNoStore(`${origin}/login?error=auth_callback_failed`);
}
