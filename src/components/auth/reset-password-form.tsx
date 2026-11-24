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
import { useI18n } from "@/lib/i18n";
import { isSupabaseConfigured, tryCreateClient } from "@/lib/supabase/client";

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

  const configured = isSupabaseConfigured();
  const passwordInvalid = (touched || submitted) && password.length < 8;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitted(true);
    setFormError(null);

    if (password.length < 8) return;

    const supabase = tryCreateClient();
    if (!supabase) {
      setFormError(
        vi ? "Supabase chưa được cấu hình." : "Supabase is not configured.",
      );
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setFormError(error.message);
        return;
      }
      setDone(true);
      toast.success(
        vi ? "Đặt lại mật khẩu thành công." : "Password updated successfully.",
      );
      router.push("/dashboard");
      router.refresh();
    } catch {
      setFormError(t("common.errorGeneric"));
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
          <CardTitle className="text-xl">
            {vi ? "Mật khẩu đã được cập nhật" : "Password updated"}
          </CardTitle>
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
        <CardTitle className="text-xl">
          {vi ? "Đặt mật khẩu mới" : "Set a new password"}
        </CardTitle>
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
        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="reset-new-password">
              {vi ? "Mật khẩu mới" : "New password"}
            </Label>
            <p id="reset-password-rules" className="text-muted-foreground text-xs">
              {vi ? "Tối thiểu 8 ký tự." : "At least 8 characters."}
            </p>
            <div className="relative">
              <Input
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
                id="reset-password-error"
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
          <Button type="submit" className="h-10 w-full" disabled={!configured || loading}>
            {loading && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            <span>{vi ? "Cập nhật mật khẩu" : "Update password"}</span>
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
