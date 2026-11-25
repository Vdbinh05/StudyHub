"use client";

import * as React from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  getFriendlyErrorMessage,
  isServiceUnavailableError,
  isSupabaseConfiguredClient,
} from "@/components/layout/api-client";
import type { Locale } from "@/types/domain";
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

const GOOGLE_OAUTH_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_GOOGLE_OAUTH === "true";

// Aligned strictly with `profiles` DB CHECK constraint and `usernameSchema`
const USERNAME_PATTERN = /^[a-z0-9_]{3,30}$/i;

type RegisterErrorState =
  | { kind: "service_unavailable" }
  | { kind: "auth_error"; error: unknown };

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
 * Translates raw English Supabase Auth / GoTrue sign-up errors into calm,
 * student-friendly Vietnamese or English messages.
 */
function mapRegisterAuthError(
  err: unknown,
  locale: Locale,
  fallback: string,
): string {
  if (isServiceUnavailableError(err)) {
    return getFriendlyErrorMessage(err, locale, fallback);
  }

  const vi = locale === "vi";
  const { code, message, status } = extractAuthErrorDetails(err);
  const msg = message.toLowerCase();

  if (
    code === "email_address_invalid" ||
    (code === "validation_failed" && msg.includes("email")) ||
    (msg.includes("email") &&
      (msg.includes("invalid") ||
        msg.includes("validate") ||
        msg.includes("format") ||
        msg.includes("not allowed")))
  ) {
    return vi
      ? "Địa chỉ email không hợp lệ hoặc không được chấp nhận. Vui lòng kiểm tra lại."
      : "This email address is invalid or not accepted. Please check and try another.";
  }

  if (
    code === "user_already_exists" ||
    code === "email_exists" ||
    msg.includes("already registered") ||
    msg.includes("already been registered") ||
    msg.includes("already exists")
  ) {
    return vi
      ? "Email này đã được đăng ký. Vui lòng đăng nhập hoặc dùng email khác."
      : "This email is already registered. Please sign in or use a different email.";
  }

  if (
    code === "weak_password" ||
    msg.includes("password should be") ||
    msg.includes("weak password") ||
    msg.includes("password is too short")
  ) {
    return vi
      ? "Mật khẩu chưa đáp ứng yêu cầu bảo mật. Vui lòng dùng ít nhất 8 ký tự."
      : "Password does not meet security requirements. Please use at least 8 characters.";
  }

  if (
    status === 429 ||
    code === "over_email_send_rate_limit" ||
    code === "over_request_rate_limit" ||
    msg.includes("rate limit") ||
    msg.includes("too many requests") ||
    msg.includes("only request this after")
  ) {
    return vi
      ? "Bạn thao tác quá nhanh. Vui lòng đợi một lát rồi thử lại."
      : "Too many attempts. Please wait a moment and try again.";
  }

  if (
    code === "signup_disabled" ||
    code === "email_provider_disabled" ||
    msg.includes("signups not allowed") ||
    msg.includes("signup is disabled")
  ) {
    return vi
      ? "Tính năng đăng ký hiện đang tạm khóa. Vui lòng thử lại sau."
      : "New registrations are currently unavailable. Please try again later.";
  }

  if (
    code === "provider_disabled" ||
    msg.includes("provider is not enabled") ||
    msg.includes("unsupported provider")
  ) {
    return vi
      ? "Phương thức đăng nhập này hiện chưa được kích hoạt. Vui lòng dùng email và mật khẩu."
      : "This sign-in method is not enabled yet. Please continue with email and password.";
  }

  if (
    msg.includes("database error saving new user") ||
    msg.includes("duplicate key") ||
    msg.includes("profiles_username")
  ) {
    return vi
      ? "Không thể hoàn tất đăng ký — tên người dùng có thể đã tồn tại. Vui lòng thử tên người dùng khác."
      : "Could not finish creating your account — that username may already be taken. Please try another username.";
  }

  if (
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("load failed") ||
    msg.includes("network request failed")
  ) {
    return vi
      ? "Không thể kết nối đến máy chủ. Vui lòng kiểm tra mạng và thử lại."
      : "Unable to reach the server. Please check your connection and try again.";
  }

  return vi
    ? "Không thể tạo tài khoản. Vui lòng kiểm tra lại thông tin và thử lại."
    : fallback || "Could not create your account. Please check your details and try again.";
}

export function RegisterForm() {
  const { locale, t } = useI18n();
  const vi = locale === "vi";

  const [displayName, setDisplayName] = React.useState("");
  const [username, setUsername] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);

  const [touched, setTouched] = React.useState({
    displayName: false,
    username: false,
    email: false,
    password: false,
  });
  const [submitted, setSubmitted] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [oauthLoading, setOauthLoading] = React.useState(false);
  const [formErrorState, setFormErrorState] =
    React.useState<RegisterErrorState | null>(null);
  const [verificationSent, setVerificationSent] = React.useState(false);

  const formError = React.useMemo(() => {
    if (!formErrorState) return null;
    if (formErrorState.kind === "service_unavailable") {
      return t("common.serviceUnavailableDesc");
    }
    return mapRegisterAuthError(
      formErrorState.error,
      locale,
      t("common.errorGeneric"),
    );
  }, [formErrorState, locale, t]);

  const displayNameRef = React.useRef<HTMLInputElement>(null);
  const usernameRef = React.useRef<HTMLInputElement>(null);
  const emailRef = React.useRef<HTMLInputElement>(null);
  const passwordRef = React.useRef<HTMLInputElement>(null);

  const configured = isSupabaseConfiguredClient();
  const controlsDisabled = !configured || loading;

  const displayNameInvalid = (touched.displayName || submitted) && displayName.trim().length < 2;
  const trimmedUsername = username.trim();
  const usernameInvalid =
    (touched.username || submitted) &&
    trimmedUsername.length > 0 &&
    !USERNAME_PATTERN.test(trimmedUsername);
  const emailInvalid =
    (touched.email || submitted) &&
    (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()));
  const passwordInvalid = (touched.password || submitted) && password.length < 8;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    setFormErrorState(null);

    if (displayName.trim().length < 2) {
      displayNameRef.current?.focus();
      return;
    }
    if (trimmedUsername.length > 0 && !USERNAME_PATTERN.test(trimmedUsername)) {
      usernameRef.current?.focus();
      return;
    }
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      emailRef.current?.focus();
      return;
    }
    if (password.length < 8) {
      passwordRef.current?.focus();
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

      const origin = window.location.origin;
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          emailRedirectTo: `${origin}/auth/callback?next=/dashboard`,
          data: {
            display_name: displayName.trim(),
            username: trimmedUsername ? trimmedUsername.toLowerCase() : undefined,
          },
        },
      });

      if (error) {
        setFormErrorState({ kind: "auth_error", error });
        return;
      }

      if (data.session) {
        const nextUserId = data.user?.id ?? null;
        await purgeAllUserClientState(null, nextUserId, { broadcast: false });
        broadcastAuthEvent("account-switch", nextUserId);
        toast.success(
          vi ? "Tạo tài khoản thành công!" : "Account created successfully!",
        );
        window.location.replace(
          new URL("/dashboard", window.location.origin).toString(),
        );
      } else {
        setVerificationSent(true);
      }
    } catch (err) {
      setFormErrorState({ kind: "auth_error", error: err });
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignUp = async () => {
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
          redirectTo: `${origin}/auth/callback?next=/dashboard`,
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

  if (verificationSent) {
    return (
      <Card className="shadow-sm">
        <CardHeader>
          <div className="bg-success-subtle text-success-subtle-foreground mb-2 flex size-10 items-center justify-center rounded-lg">
            <CheckCircle2 className="size-5" aria-hidden="true" />
          </div>
          <h1 className="text-foreground text-xl leading-none font-semibold tracking-tight">
            {vi ? "Kiểm tra email để xác nhận" : "Check your email to confirm"}
          </h1>
          <CardDescription>
            {vi
              ? `Chúng tôi đã gửi liên kết xác nhận đến ${email.trim()}. Vui lòng mở email để hoàn tất đăng ký.`
              : `We sent a verification link to ${email.trim()}. Open it to finish setting up your account.`}
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild variant="outline" className="w-full">
            <Link href="/login">{t("nav.signIn")}</Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <h1 className="text-foreground text-xl leading-none font-semibold tracking-tight">
          {t("auth.signupTitle")}
        </h1>
        <CardDescription>{t("auth.signupSubtitle")}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {formError && (
          <div
            role="alert"
            className="border-destructive/30 bg-destructive-subtle text-destructive-subtle-foreground flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm"
          >
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{formError}</span>
          </div>
        )}

        <form method="post" onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="register-name">{t("auth.displayName")}</Label>
            <Input
              ref={displayNameRef}
              id="register-name"
              name="name"
              type="text"
              autoComplete="name"
              enterKeyHint="next"
              required
              placeholder={vi ? "Nguyễn Văn A" : "Alex Nguyen"}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              onBlur={() => setTouched((prev) => ({ ...prev, displayName: true }))}
              aria-invalid={displayNameInvalid ? "true" : "false"}
              aria-describedby={displayNameInvalid ? "register-name-error" : undefined}
              disabled={controlsDisabled}
            />
            {displayNameInvalid && (
              <p
                id="register-name-error"
                role="alert"
                className="text-destructive flex items-center gap-1.5 text-xs font-medium"
              >
                <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
                <span>
                  {vi
                    ? "Tên hiển thị cần ít nhất 2 ký tự."
                    : "Display name must be at least 2 characters."}
                </span>
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="register-username">
              {t("auth.username")}{" "}
              <span className="text-muted-foreground font-normal">
                ({vi ? "tùy chọn" : "optional"})
              </span>
            </Label>
            <p id="register-username-hint" className="text-muted-foreground text-xs">
              {vi
                ? "3–30 ký tự gồm chữ thường không dấu, số và dấu gạch dưới (_)."
                : "3–30 lowercase letters, numbers, or underscores (_)."}
            </p>
            <Input
              ref={usernameRef}
              id="register-username"
              name="handle"
              type="text"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="next"
              placeholder="minh_study"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              onBlur={() => setTouched((prev) => ({ ...prev, username: true }))}
              aria-invalid={usernameInvalid ? "true" : "false"}
              aria-describedby={
                usernameInvalid
                  ? "register-username-hint register-username-error"
                  : "register-username-hint"
              }
              disabled={controlsDisabled}
            />
            {usernameInvalid && (
              <p
                id="register-username-error"
                role="alert"
                className="text-destructive flex items-center gap-1.5 text-xs font-medium"
              >
                <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
                <span>
                  {vi
                    ? "Username chỉ gồm chữ không dấu, số và dấu gạch dưới _ (3–30 ký tự)."
                    : "Use 3–30 letters, numbers, or underscores (_)."}
                </span>
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="register-email">{t("auth.email")}</Label>
            <Input
              ref={emailRef}
              id="register-email"
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
              aria-describedby={emailInvalid ? "register-email-error" : undefined}
              disabled={controlsDisabled}
            />
            {emailInvalid && (
              <p
                id="register-email-error"
                role="alert"
                className="text-destructive flex items-center gap-1.5 text-xs font-medium"
              >
                <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
                <span>
                  {vi
                    ? "Vui lòng nhập địa chỉ email hợp lệ."
                    : "Please enter a valid email address."}
                </span>
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="register-password">{t("auth.password")}</Label>
            <p id="register-password-rules" className="text-muted-foreground text-xs">
              {vi
                ? "Tối thiểu 8 ký tự. Khuyến nghị dùng trình quản lý mật khẩu."
                : "At least 8 characters. Password managers and pasting are supported."}
            </p>
            <div className="relative">
              <Input
                ref={passwordRef}
                id="register-password"
                name="new-password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                enterKeyHint="done"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={() => setTouched((prev) => ({ ...prev, password: true }))}
                aria-invalid={passwordInvalid ? "true" : "false"}
                aria-describedby={
                  passwordInvalid
                    ? "register-password-rules register-password-error"
                    : "register-password-rules"
                }
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
                id="register-password-error"
                role="alert"
                className="text-destructive flex items-center gap-1.5 text-xs font-medium"
              >
                <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
                <span>
                  {vi
                    ? "Mật khẩu phải có ít nhất 8 ký tự."
                    : "Password must be at least 8 characters."}
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
            <span>{vi ? "Tạo tài khoản" : "Create account"}</span>
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
              onClick={() => void handleGoogleSignUp()}
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
          {t("auth.haveAccount")}{" "}
          <Link href="/login" className="text-primary font-semibold hover:underline">
            {t("nav.signIn")}
          </Link>
        </p>
      </CardFooter>
    </Card>
  );
}
