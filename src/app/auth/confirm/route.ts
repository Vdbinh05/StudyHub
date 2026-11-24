import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { tryCreateClient } from "@/lib/supabase/server";
import { isSafeRelativeRedirect } from "@/lib/security/authz";
import {
  enforceDistributedRateLimit,
  RATE_LIMITS,
} from "@/lib/security/rate-limit";

const ALLOWED_OTP_TYPES = new Set<EmailOtpType>([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
]);

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
  const tokenHash = searchParams.get("token_hash");
  const rawType = searchParams.get("type");
  const safeNext = isSafeRelativeRedirect(searchParams.get("next"), "/dashboard");

  const supabase = await tryCreateClient();
  if (!supabase) {
    return redirectNoStore(`${origin}/login?error=supabase_not_configured`);
  }

  if (tokenHash && rawType && ALLOWED_OTP_TYPES.has(rawType as EmailOtpType)) {
    const { error } = await supabase.auth.verifyOtp({
      type: rawType as EmailOtpType,
      token_hash: tokenHash,
    });

    if (!error) {
      if (rawType === "recovery") {
        return redirectNoStore(`${origin}/reset-password`);
      }
      return redirectNoStore(`${origin}${safeNext}`);
    }
  }

  return redirectNoStore(`${origin}/login?error=confirmation_failed`);
}
