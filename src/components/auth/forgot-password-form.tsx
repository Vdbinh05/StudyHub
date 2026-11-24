"use client";

import * as React from "react";
import Link from "next/link";
import { AlertCircle, ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";
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
import { useI18n } from "@/lib/i18n";
import { isSupabaseConfigured, tryCreateClient } from "@/lib/supabase/client";

export function ForgotPasswordForm() {
  const { locale, t } = useI18n();
  const vi = locale === "vi";

  const [email, setEmail] = React.useState("");
  const [touched, setTouched] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  const configured = isSupabaseConfigured();
  const emailInvalid =
    (touched || submitted) &&
    (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()));

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    setFormError(null);

    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      return;
    }

    const supabase = tryCreateClient();
    if (!supabase) {
      setFormError(
        vi ? "Supabase chưa được cấu hình." : "Supabase is not configured.",
      );
      return;
    }

    setLoading(true);
    try {
      const origin = window.location.origin;
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${origin}/auth/callback?next=/reset-password`,
      });
      if (error) {
        setFormError(error.message);
        return;
      }
      setSent(true);
    } catch {
      setFormError(t("common.errorGeneric"));
    } finally {
      setLoading(false);
    }
  };

  if (sent) {
    return (
      <Card className="shadow-sm">
        <CardHeader>
          <div className="bg-success-subtle text-success-subtle-foreground mb-2 flex size-10 items-center justify-center rounded-lg">
            <CheckCircle2 className="size-5" aria-hidden="true" />
          </div>
          <CardTitle className="text-xl">{t("auth.resetPasswordTitle")}</CardTitle>
          <CardDescription>{t("auth.resetPasswordSent")}</CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild variant="outline" className="w-full">
            <Link href="/login">
              <ArrowLeft className="size-4" aria-hidden="true" />
              <span>{t("nav.signIn")}</span>
            </Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-xl">{t("auth.resetPasswordTitle")}</CardTitle>
        <CardDescription>
          {vi
            ? "Nhập email đã đăng ký để nhận liên kết đặt lại mật khẩu."
            : "Enter your account email to receive a password reset link."}
        </CardDescription>
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
            <Label htmlFor="forgot-email">{t("auth.email")}</Label>
            <Input
              id="forgot-email"
              name="email"
              type="email"
              autoComplete="email"
              spellCheck={false}
              enterKeyHint="send"
              required
              placeholder="name@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setTouched(true)}
              aria-invalid={emailInvalid ? "true" : "false"}
              aria-describedby={emailInvalid ? "forgot-email-error" : undefined}
              disabled={!configured || loading}
            />
            {emailInvalid && (
              <p
                id="forgot-email-error"
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
          <Button type="submit" className="h-10 w-full" disabled={!configured || loading}>
            {loading && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            <span>{vi ? "Gửi liên kết đặt lại" : "Send reset link"}</span>
          </Button>
        </form>
      </CardContent>
      <CardFooter className="justify-center border-t pt-4">
        <Link
          href="/login"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-sm font-medium"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          <span>{vi ? "Quay lại đăng nhập" : "Back to sign in"}</span>
        </Link>
      </CardFooter>
    </Card>
  );
}
