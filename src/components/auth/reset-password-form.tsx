"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  getFriendlyErrorMessage,
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
import { useI18n } from "@/lib/i18n";

export function ResetPasswordForm() {
  const { locale, t } = useI18n();
  const vi = locale === "vi";
  const router = useRouter();

  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [touched, setTouched] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [done, setDone] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);

  const passwordRef = React.useRef<HTMLInputElement>(null);

  const configured = isSupabaseConfiguredClient();
  const controlsDisabled = !configured || loading;
  const passwordInvalid = (touched || submitted) && password.length < 8;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    setFormError(null);

    if (password.length < 8) {
      passwordRef.current?.focus();
      return;
    }

    setLoading(true);
    try {
      const { tryCreateClient } = await import("@/lib/supabase/client");
      const supabase = tryCreateClient();
      if (!supabase) {
        setFormError(t("common.serviceUnavailableDesc"));
        return;
      }
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setFormError(getFriendlyErrorMessage(error, locale));
        return;
      }
      setDone(true);
      toast.success(
        vi ? "Đặt lại mật khẩu thành công." : "Password updated successfully.",
      );
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setFormError(getFriendlyErrorMessage(err, locale, t("common.errorGeneric")));
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <Card className="shadow-sm">
        <CardHeader>
          <div className="bg-success-subtle text-success-subtle-foreground mb-2 flex size-10 items-center justify-center rounded-lg">
            <CheckCircle2 className="size-5" aria-hidden="true" />
          </div>
          <h1 className="text-foreground text-xl leading-none font-semibold tracking-tight">
            {vi ? "Mật khẩu đã được cập nhật" : "Password updated"}
          </h1>
          <CardDescription>
            {vi
              ? "Bạn có thể tiếp tục sử dụng StudyHub với mật khẩu mới."
              : "You can now continue using StudyHub with your new password."}
          </CardDescription>
        </CardHeader>
        <CardFooter>
          <Button asChild className="w-full">
            <Link href="/dashboard">{t("nav.dashboard")}</Link>
          </Button>
        </CardFooter>
      </Card>
    );
  }

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <h1 className="text-foreground text-xl leading-none font-semibold tracking-tight">
          {vi ? "Đặt mật khẩu mới" : "Set a new password"}
        </h1>
        <CardDescription>
          {vi
            ? "Chọn mật khẩu mới an toàn cho tài khoản StudyHub của bạn."
            : "Choose a strong new password for your StudyHub account."}
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
        <form method="post" onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="reset-new-password">
              {vi ? "Mật khẩu mới" : "New password"}
            </Label>
            <p id="reset-password-rules" className="text-muted-foreground text-xs">
              {vi ? "Tối thiểu 8 ký tự." : "At least 8 characters."}
            </p>
            <div className="relative">
              <Input
                ref={passwordRef}
                id="reset-new-password"
                name="new-password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                enterKeyHint="done"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onBlur={() => setTouched(true)}
                aria-invalid={passwordInvalid ? "true" : "false"}
                aria-describedby={
                  passwordInvalid
                    ? "reset-password-rules reset-password-error"
                    : "reset-password-rules"
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
                id="reset-password-error"
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
            disabled={controlsDisabled}
          >
            {loading && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            <span>{vi ? "Cập nhật mật khẩu" : "Update password"}</span>
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
