"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { AlertCircle, Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  getFriendlyErrorMessage,
  isServiceUnavailableError,
  isSupabaseConfiguredClient,
} from "@/components/layout/api-client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  broadcastAuthEvent,
  purgeAllUserClientState,
} from "@/lib/auth/client-session-cleanup";
import { useI18n } from "@/lib/i18n";
import type { Locale } from "@/types/domain";

function sanitizeNextPath(raw: string | null): string {
  if (!raw) return "/dashboard";
  const trimmed = raw.trim();
  if (
    trimmed.startsWith("/") &&
    !trimmed.startsWith("//") &&
    !trimmed.startsWith("/\\") &&
    !trimmed.includes("\\") &&
    !trimmed.includes("://") &&
    !/[\x00-\x1F\x7F]/.test(trimmed)
  ) {
    return trimmed;
  }
  return "/dashboard";
}

function mapCallbackError(
  rawCode: string | null,
  rawDesc: string | null,
  vi: boolean,
): string | null {
  if (!rawCode && !rawDesc) return null;
  const combined = `${rawCode ?? ""} ${rawDesc ?? ""}`.toLowerCase();
  if (combined.includes("access_denied") || combined.includes("cancel")) {
    return vi
      ? "Bạn đã hủy đăng nhập hoặc từ chối quyền truy cập."
      : "Sign-in was canceled or access was denied.";
  }
  if (
    combined.includes("otp_expired") ||
    combined.includes("expired") ||
    combined.includes("invalid_token") ||
    combined.includes("invalid_grant")
  ) {
    return vi
      ? "Liên kết xác nhận đã hết hạn hoặc không hợp lệ. Vui lòng thử lại."
      : "The verification link has expired or is invalid. Please request a new one.";
  }
  if (combined.includes("auth_callback_failed") || combined.includes("callback")) {
    return vi
      ? "Không thể hoàn tất xác thực. Vui lòng đăng nhập lại."
      : "Unable to complete authentication. Please sign in again.";
  }
  return vi
    ? "Đăng nhập không thành công. Vui lòng thử lại."
    : "Sign-in failed. Please try again.";
}

function extractAuthErrorDetails(err: unknown): {
  code: string;
  message: string;
  status: number | null;
} {
  if (typeof err === "object" && err !== null) {
    const record = err as Record<string, unknown>;
    const code = typeof record.code === "string" ? record.code.toLowerCase() : "";
    const message =
      typeof record.message === "string"
        ? record.message
        : err instanceof Error
          ? err.message
          : "";
    const status = typeof record.status === "number" ? record.status : null;
    return { code, message, status };
  }
  if (typeof err === "string") {
    return { code: "", message: err, status: null };
  }
  return { code: "", message: "", status: null };
}

/**
 * Translates all Supabase Auth / GoTrue / network sign-in errors into calm,
 * student-friendly Vietnamese or English copy (`V32-040`).
 */
export function mapLoginAuthError(
  err: unknown,
  locale: Locale,
  fallback?: string,
): string {
  if (isServiceUnavailableError(err)) {
    return getFriendlyErrorMessage(err, locale, fallback);
  }

  const vi = locale === "vi";
  const { code, message, status } = extractAuthErrorDetails(err);
  const msg = message.toLowerCase();

  if (
    code === "invalid_credentials" ||
    msg.includes("invalid login credentials") ||
    msg.includes("invalid email or password")
  ) {
    return vi
      ? "Email hoặc mật khẩu không chính xác. Vui lòng kiểm tra lại."
      : "Invalid email or password. Please check and try again.";
  }

  if (
    code === "email_not_confirmed" ||
    msg.includes("email not confirmed") ||
    msg.includes("confirm your email")
  ) {
    return vi
      ? "Email của bạn chưa được xác nhận. Vui lòng kiểm tra hộp thư để kích hoạt tài khoản."
      : "Your email address has not been confirmed yet. Please check your inbox to verify your account.";
  }

  if (
    status === 429 ||
    code === "over_request_rate_limit" ||
    code === "over_email_send_rate_limit" ||
    msg.includes("too many requests") ||
    msg.includes("rate limit")
  ) {
    return vi
      ? "Bạn thao tác quá nhanh. Vui lòng đợi một lát rồi thử lại."
      : "Too many sign-in attempts. Please wait a moment and try again.";
  }

  if (
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("load failed") ||
    msg.includes("network request failed") ||
    msg.includes("fetch failed")
  ) {
    return vi
      ? "Không thể kết nối đến máy chủ. Vui lòng kiểm tra kết nối mạng và thử lại."
      : "Unable to reach the server. Please check your network connection and try again.";
  }

  if (code === "user_banned" || msg.includes("user is banned")) {
    return vi
      ? "Tài khoản này hiện tạm khóa quyền đăng nhập. Vui lòng liên hệ quản trị viên."
      : "This account is currently restricted from signing in.";
  }

  if (
    code === "provider_disabled" ||
    code === "email_provider_disabled" ||
    msg.includes("email logins are disabled") ||
    msg.includes("provider is not enabled")
  ) {
    return vi
      ? "Phương thức đăng nhập này hiện chưa được kích hoạt."
      : "This sign-in method is currently unavailable.";
  }

  return (
    fallback ||
    (vi
      ? "Đăng nhập không thành công. Vui lòng kiểm tra lại thông tin và thử lại."
      : "Sign-in failed. Please check your details and try again.")
  );
}

const GOOGLE_OAUTH_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_GOOGLE_OAUTH === "true";

type LoginErrorState =
  | { kind: "service_unavailable" }
  | { kind: "auth_error"; error: unknown };

function LoginFormInner() {
  const { locale, t } = useI18n();
  const vi = locale === "vi";
  const searchParams = useSearchParams();

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [touched, setTouched] = React.useState<{ email: boolean; password: boolean }>({
    email: false,
    password: false,
  });
  const [submitted, setSubmitted] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [oauthLoading, setOauthLoading] = React.useState(false);
  const [formErrorState, setFormErrorState] = React.useState<LoginErrorState | null>(
    null,
  );

  const emailInputRef = React.useRef<HTMLInputElement>(null);
  const passwordInputRef = React.useRef<HTMLInputElement>(null);

  const configured = isSupabaseConfiguredClient();
  const nextPath = sanitizeNextPath(searchParams.get("next"));
  const callbackError = mapCallbackError(
    searchParams.get("error"),
    searchParams.get("error_description"),
    vi,
  );

  const formError = React.useMemo(() => {
    if (!formErrorState) return null;
    if (formErrorState.kind === "service_unavailable") {
      return t("common.serviceUnavailableDesc");
    }
    return mapLoginAuthError(formErrorState.error, locale);
  }, [formErrorState, locale, t]);

  const activeError = formError ?? callbackError;

  const emailInvalid =
    (touched.email || submitted) &&
    (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()));
  const passwordInvalid = (touched.password || submitted) && password.length < 6;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    setFormErrorState(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      emailInputRef.current?.focus();
      return;
    }
    if (password.length < 6) {
      passwordInputRef.current?.focus();
      return;
    }

    setLoading(true);
    try {
      const { tryCreateClient } = await import("@/lib/supabase/client");
      const supabase = tryCreateClient();
      if (!supabase) {
        setFormErrorState({ kind: "service_unavailable" });
        return;
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });

      if (error) {
        setFormErrorState({ kind: "auth_error", error });
        return;
      }

      // Purge any stale prior-account client caches before entering the authenticated shell (`SEC-01`/`SEC-02`)
      const nextUserId = data.user?.id ?? null;
      await purgeAllUserClientState(null, nextUserId, { broadcast: false });
      broadcastAuthEvent("account-switch", nextUserId);

      toast.success(vi ? "Đăng nhập thành công." : "Signed in successfully.");
      window.location.assign(nextPath);
    } catch (err) {
      setFormErrorState({ kind: "auth_error", error: err });
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setFormErrorState(null);
    setOauthLoading(true);
    try {
      const { tryCreateClient } = await import("@/lib/supabase/client");
      const supabase = tryCreateClient();
      if (!supabase) {
        setFormErrorState({ kind: "service_unavailable" });
        setOauthLoading(false);
        return;
      }
      const origin = window.location.origin;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(nextPath)}`,
        },
      });
      if (error) {
        setFormErrorState({ kind: "auth_error", error });
        setOauthLoading(false);
      }
    } catch (err) {
      setFormErrorState({ kind: "auth_error", error: err });
      setOauthLoading(false);
    }
  };

  const controlsDisabled = !configured || loading;

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <h1 className="text-foreground text-xl leading-none font-semibold tracking-tight">
          {t("auth.loginTitle")}
        </h1>
        <CardDescription>{t("auth.loginSubtitle")}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {activeError && (
          <div
            role="alert"
            className="border-destructive/30 bg-destructive-subtle text-destructive-subtle-foreground flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{activeError}</span>
          </div>
        )}

        <form method="post" onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="login-email">{t("auth.email")}</Label>
            <Input
              ref={emailInputRef}
              id="login-email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              enterKeyHint="next"
              required
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setTouched((prev) => ({ ...prev, email: true }))}
              aria-invalid={emailInvalid ? "true" : "false"}
              aria-describedby={emailInvalid ? "login-email-error" : undefined}
              disabled={controlsDisabled}
            />
            {emailInvalid && (
              <p
                id="login-email-error"
                role="alert"
                className="text-destructive flex items-center gap-1.5 text-xs font-medium"
              >
                <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
                <span>
                  {vi
                    ? "Vui lòng nhập địa chỉ email hợp lệ (VD: ten@example.com)."
                    : "Please enter a valid email address (e.g. you@example.com)."}
                </span>
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="login-password">{t("auth.password")}</Label>
              <Link
                href="/forgot-password"
                prefetch={false}
                className="text-primary inline-flex min-h-11 items-center px-1 text-xs font-medium hover:underline sm:min-h-0 sm:px-0"
              >
                {t("auth.forgotPassword")}
              </Link>
            </div>
            <div className="relative">
              <Input
                ref={passwordInputRef}
                id="login-password"
                name="password"
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                enterKeyHint="done"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={() => setTouched((prev) => ({ ...prev, password: true }))}
                aria-invalid={passwordInvalid ? "true" : "false"}
                aria-describedby={passwordInvalid ? "login-password-error" : undefined}
                disabled={controlsDisabled}
                className="pr-12"
              />
              <button
                type="button"
                disabled={controlsDisabled}
                onClick={() => setShowPassword((prev) => !prev)}
                aria-pressed={showPassword}
                aria-label={
                  showPassword
                    ? vi
                      ? "Ẩn mật khẩu"
                      : "Hide password"
                    : vi
                      ? "Hiện mật khẩu"
                      : "Show password"
                }
                className="text-muted-foreground hover:text-foreground disabled:pointer-events-none disabled:opacity-50 absolute top-1/2 right-0.5 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-md transition-colors sm:h-9 sm:w-9"
              >
                {showPassword ? (
                  <EyeOff className="size-4" aria-hidden="true" />
                ) : (
                  <Eye className="size-4" aria-hidden="true" />
                )}
              </button>
            </div>
            {passwordInvalid && (
              <p
                id="login-password-error"
                role="alert"
                className="text-destructive flex items-center gap-1.5 text-xs font-medium"
              >
                <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
                <span>
                  {vi
                    ? "Mật khẩu phải có ít nhất 6 ký tự."
                    : "Password must be at least 6 characters."}
                </span>
              </p>
            )}
          </div>

          <Button
            type="submit"
            className="min-h-11 w-full sm:min-h-10"
            disabled={!configured || loading || oauthLoading}
          >
            {loading && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            <span>{t("nav.signIn")}</span>
          </Button>
        </form>

        {GOOGLE_OAUTH_ENABLED && (
          <>
            <div className="relative flex items-center justify-center py-1">
              <Separator />
              <span className="bg-card text-muted-foreground absolute px-2.5 text-xs">
                {vi ? "hoặc" : "or"}
              </span>
            </div>

            <Button
              type="button"
              variant="outline"
              className="min-h-11 w-full sm:min-h-10"
              disabled={!configured || loading || oauthLoading}
              onClick={() => void handleGoogleSignIn()}
            >
              {oauthLoading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : (
                <svg className="size-4" viewBox="0 0 24 24" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M21.35 11.1H12v2.92h5.35c-.24 1.38-1.44 4.05-5.35 4.05-3.22 0-5.85-2.67-5.85-5.95s2.63-5.95 5.85-5.95c1.84 0 3.07.78 3.77 1.46l2.57-2.48C16.7 3.63 14.56 2.7 12 2.7 6.86 2.7 2.7 6.86 2.7 12s4.16 9.3 9.3 9.3c5.37 0 8.93-3.77 8.93-9.08 0-.61-.07-1.08-.15-1.12z"
                  />
                </svg>
              )}
              <span>{t("auth.continueWithGoogle")}</span>
            </Button>
          </>
        )}
      </CardContent>

      <CardFooter className="justify-center border-t pt-4">
        <p className="text-muted-foreground text-sm">
          {t("auth.noAccount")}{" "}
          <Link
            href="/register"
            prefetch={false}
            className="text-primary font-semibold hover:underline"
          >
            {t("nav.signUp")}
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}

export function LoginForm() {
  return (
    <React.Suspense fallback={<div className="bg-card h-96 rounded-xl border" />}>
      <LoginFormInner />
    </React.Suspense>
  );
}
