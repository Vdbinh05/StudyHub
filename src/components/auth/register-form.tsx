"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2 } from "lucide-react";
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

export function RegisterForm() {
  const { locale, t } = useI18n();
  const vi = locale === "vi";
  const router = useRouter();

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
  const [formError, setFormError] = React.useState<string | null>(null);
  const [verificationSent, setVerificationSent] = React.useState(false);

  const displayNameRef = React.useRef<HTMLInputElement>(null);
  const usernameRef = React.useRef<HTMLInputElement>(null);
  const emailRef = React.useRef<HTMLInputElement>(null);
  const passwordRef = React.useRef<HTMLInputElement>(null);

  const configured = isSupabaseConfigured();

  const displayNameInvalid = (touched.displayName || submitted) && displayName.trim().length < 2;
  const trimmedUsername = username.trim();
  const usernameInvalid =
    (touched.username || submitted) &&
    trimmedUsername.length > 0 &&
    !/^[a-z0-9_]{3,30}$/i.test(trimmedUsername);
  const emailInvalid =
    (touched.email || submitted) &&
    (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()));
  const passwordInvalid = (touched.password || submitted) && password.length < 8;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    setFormError(null);

    if (displayName.trim().length < 2) {
      displayNameRef.current?.focus();
      return;
    }
    if (trimmedUsername.length > 0 && !/^[a-z0-9_]{3,30}$/i.test(trimmedUsername)) {
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

    const supabase = tryCreateClient();
    if (!supabase) {
      setFormError(
        vi
          ? "Supabase chưa được cấu hình. Không thể tạo tài khoản."
          : "Supabase is not configured. Unable to create account.",
      );
      return;
    }

    setLoading(true);
    try {
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
        setFormError(error.message);
        return;
      }

      if (data.session) {
        toast.success(
          vi ? "Tạo tài khoản thành công!" : "Account created successfully!",
        );
        router.push("/dashboard");
        router.refresh();
      } else {
        setVerificationSent(true);
      }
    } catch {
      setFormError(t("common.errorGeneric"));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleSignUp = async () => {
    setFormError(null);
    const supabase = tryCreateClient();
    if (!supabase) {
      setFormError(
        vi
          ? "Supabase chưa được cấu hình."
          : "Supabase is not configured.",
      );
      return;
    }
    setOauthLoading(true);
    try {
      const origin = window.location.origin;
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${origin}/auth/callback?next=/dashboard`,
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

  if (verificationSent) {
    return (
      <Card className="shadow-sm">
        <CardHeader>
          <div className="bg-success-subtle text-success-subtle-foreground mb-2 flex size-10 items-center justify-center rounded-lg">
            <CheckCircle2 className="size-5" aria-hidden="true" />
          </div>
          <CardTitle className="text-xl">
            {vi ? "Kiểm tra email để xác nhận" : "Check your email to confirm"}
          </CardTitle>
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
        <CardTitle className="text-xl">{t("auth.signupTitle")}</CardTitle>
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

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
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
              disabled={!configured || loading}
            />
            {displayNameInvalid && (
              <p
                id="register-name-error"
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
                ? "3–30 ký tự gồm chữ, số, dấu chấm, gạch ngang hoặc gạch dưới."
                : "3–30 letters, numbers, dots, hyphens, or underscores."}
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
              disabled={!configured || loading}
            />
            {usernameInvalid && (
              <p
                id="register-username-error"
                className="text-destructive flex items-center gap-1.5 text-xs font-medium"
              >
                <AlertCircle className="size-3.5 shrink-0" aria-hidden="true" />
                <span>
                  {vi
                    ? "Username chỉ gồm chữ không dấu, số, ., _, - (3–30 ký tự)."
                    : "Use 3–30 letters, numbers, '.', '_', or '-'."}
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
              autoComplete="username"
              spellCheck={false}
              enterKeyHint="next"
              required
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setTouched((prev) => ({ ...prev, email: true }))}
              aria-invalid={emailInvalid ? "true" : "false"}
              aria-describedby={emailInvalid ? "register-email-error" : undefined}
              disabled={!configured || loading}
            />
            {emailInvalid && (
              <p
                id="register-email-error"
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
            {/* Place password guidance above the input so mobile keyboards do not obscure it */}
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
                id="register-password-error"
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
            className="h-10 w-full"
            disabled={!configured || loading || oauthLoading}
          >
            {loading && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            <span>{vi ? "Tạo tài khoản" : "Create account"}</span>
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
