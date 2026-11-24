import { NextResponse, type NextRequest } from "next/server";
import { tryCreateClient } from "@/lib/supabase/server";
import { isSafeRelativeRedirect } from "@/lib/security/authz";
import { enforceRateLimit, RATE_LIMITS } from "@/lib/security/rate-limit";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const limited = enforceRateLimit(request, RATE_LIMITS.AUTH_ACTION);
  if (limited) {
    return limited;
  }

  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const safeNext = isSafeRelativeRedirect(searchParams.get("next"), "/dashboard");

  const supabase = await tryCreateClient();
  if (!supabase) {
    return NextResponse.redirect(`${origin}/login?error=supabase_not_configured`);
  }

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${safeNext}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
