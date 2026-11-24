"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertCircle, Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useI18n } from "@/lib/i18n";
import { isSupabaseConfigured, tryCreateClient } from "@/lib/supabase/client";

function sanitizeNextPath(raw: string | null): string {
  if (!raw) return "/dashboard";
  if (raw.startsWith("/") && !raw.startsWith("//")) {
    return raw;
  }
  return "/dashboard";
}

function LoginFormInner() {
  const { locale, t } = useI18n();
  const vi = locale === "vi";
  const router = useRouter();
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
  const [formError, setFormError] = React.useState<string | null>(null);

  const emailInputRef = React.useRef<HTMLInputElement>(null);
  const passwordInputRef = React.useRef<HTMLInputElement>(null);

  const configured = isSupabaseConfigured();
  const nextPath = sanitizeNextPath(searchParams.get("next"));

  const emailInvalid =
    (touched.email || submitted) &&
    (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()));
  const passwordInvalid = (touched.password || submitted) && password.length < 6;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    setFormError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      emailInputRef.current?.focus();
      return;
    }
    if (password.length < 6) {
      passwordInputRef.current?.focus();
      return;
    }

    const supabase = tryCreateClient();
    if (!supabase) {
      setFormError(
        vi
          ? "Supabase chưa được cấu hình. Không thể đăng nhập."
          : "Supabase is not configured. Unable to sign in.",
      );
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });

      if (error) {
        setFormError(
          error.message === "Invalid login credentials"
            ? vi
              ? "Email hoặc mật khẩu không chính xác. Vui lòng kiểm tra lại."
              : "Invalid email or password. Please check and try again."
            : error.message,
        );
        return;
      }

      toast.success(vi ? "Đăng nhập thành công." : "Signed in successfully.");
      router.push(nextPath);
      router.refresh();
    } catch {
      setFormError(t("common.errorGeneric"));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setFormError(null);
    const supabase = tryCreateClient();
    if (!supabase) {
      setFormError(
        vi
          ? "Supabase chưa được cấu hình. Không thể đăng nhập bằng Google."
          : "Supabase is not configured. Unable to sign in with Google.",
      );
      return;
    }

    setOauthLoading(true);
    try {
      const origin = window.location.origin;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(nextPath)}`,
        },
      });
      if (error) {
        setFormError(error.message);
        setOauthLoading(false);
      }
    } catch {
      setFormError(t("common.errorGeneric"));
      setOauthLoading(false);
    }
  };

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-xl">{t("auth.loginTitle")}</CardTitle>
        <CardDescription>{t("auth.loginSubtitle")}</CardDescription>
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

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="login-email">{t("auth.email")}</Label>
            <Input
              ref={emailInputRef}
              id="login-email"
              name="email"
              type="email"
              autoComplete="username"
              spellCheck={false}
              enterKeyHint="next"
              required
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setTouched((prev) => ({ ...prev, email: true }))}
              aria-invalid={emailInvalid ? "true" : "false"}
              aria-describedby={emailInvalid ? "login-email-error" : undefined}
              disabled={!configured || loading}
            />
            {emailInvalid && (
              <p
                id="login-email-error"
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
                className="text-primary text-xs font-medium hover:underline"
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
                disabled={!configured || loading}
                className="pr-10"
              />
              <button
                type="button"
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
                className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2 rounded-md p-1 transition-colors"
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
            className="h-10 w-full"
            disabled={!configured || loading || oauthLoading}
          >
            {loading && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            <span>{t("nav.signIn")}</span>
          </Button>
        </form>

        <div className="relative flex items-center justify-center py-1">
          <Separator />
          <span className="bg-card text-muted-foreground absolute px-2.5 text-xs">
            {vi ? "hoặc" : "or"}
          </span>
        </div>

        <Button
          type="button"
          variant="outline"
          className="h-10 w-full"
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
      </CardContent>

      <CardFooter className="justify-center border-t pt-4">
        <p className="text-muted-foreground text-sm">
          {t("auth.noAccount")}{" "}
          <Link href="/register" className="text-primary font-semibold hover:underline">
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
