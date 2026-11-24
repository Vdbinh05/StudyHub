"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation } from "@tanstack/react-query";
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Loader2,
  LogIn,
} from "lucide-react";
import { toast } from "sonner";
import {
  apiFetch,
  ApiError,
  getFriendlyErrorMessage,
} from "@/components/layout/api-client";
import { BrandLogo } from "@/components/layout/brand-logo";
import { LanguageToggle } from "@/components/layout/language-toggle";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { FadeIn } from "@/components/motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";

interface RedeemResponse {
  study_set_id: string;
  /** Canonical API fields returned by /api/share-links/[token]/redeem (fixes SH-030) */
  title?: string;
  role?: "owner" | "editor" | "viewer";
  /** Legacy fallbacks */
  study_set_title?: string;
  permission?: "viewer" | "editor";
  allow_clone?: boolean;
  question_count?: number;
  study_set?: {
    id: string;
    title: string;
    description?: string | null;
    question_count?: number;
  };
}

export function ShareRedeemView({ token }: { token: string }) {
  const { locale, t } = useI18n();
  const vi = locale === "vi";
  const router = useRouter();

  const [needsAuth, setNeedsAuth] = React.useState(false);
  const [redeemed, setRedeemed] = React.useState<RedeemResponse | null>(null);
  const [errorMsg, setErrorMsg] = React.useState<string | null>(null);

  const redeemMutation = useMutation({
    mutationFn: async () => {
      const res = await apiFetch<RedeemResponse>(
        `/api/share-links/${encodeURIComponent(token)}/redeem`,
        { method: "POST" },
      );
      return res.data;
    },
    onSuccess: (data) => {
      setRedeemed(data);
      setErrorMsg(null);
      setNeedsAuth(false);
      toast.success(
        vi ? "Đã mở quyền truy cập học phần." : "Access granted to study set.",
      );
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 401) {
        setNeedsAuth(true);
        return;
      }
      setErrorMsg(
        getFriendlyErrorMessage(
          err,
          locale,
          vi
            ? "Liên kết chia sẻ không hợp lệ hoặc đã bị thu hồi."
            : "This share link is invalid, expired, or revoked.",
        ),
      );
    },
  });

  const studySetId = redeemed?.study_set?.id ?? redeemed?.study_set_id;
  const studySetTitle =
    redeemed?.title ??
    redeemed?.study_set?.title ??
    redeemed?.study_set_title ??
    (vi ? "Học phần được chia sẻ" : "Shared Study Set");
  const grantedRole = redeemed?.role ?? redeemed?.permission;
  const questionCount =
    redeemed?.study_set?.question_count ?? redeemed?.question_count;

  return (
    <div className="bg-background text-foreground flex min-h-dvh flex-col">
      <header className="border-border bg-card border-b">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4 sm:px-6">
          <Link href="/" aria-label="StudyHub">
            <BrandLogo />
          </Link>
          <div className="flex items-center gap-1.5">
            <LanguageToggle />
            <ThemeToggle compact />
          </div>
        </div>
      </header>

      <main
        id="main-content"
        className="flex flex-1 items-center justify-center px-4 py-12"
      >
        <FadeIn aboveFold className="w-full max-w-md">
          <Card className="shadow-sm">
            {redeemed && studySetId ? (
              <>
                <CardHeader>
                  <div className="bg-success-subtle text-success-subtle-foreground mb-2 flex size-10 items-center justify-center rounded-lg">
                    <CheckCircle2 className="size-5" aria-hidden="true" />
                  </div>
                  <h1 className="text-foreground text-xl leading-none font-semibold tracking-tight">
                    {studySetTitle}
                  </h1>
                  <CardDescription>
                    {vi
                      ? "Học phần đã được thêm vào danh sách Được chia sẻ với tôi."
                      : "This study set has been added to your Shared with Me list."}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-2">
                  {grantedRole && (
                    <Badge variant="accent">
                      {grantedRole === "owner"
                        ? t("friends.roleOwner")
                        : grantedRole === "editor"
                          ? t("friends.roleEditor")
                          : t("friends.roleViewer")}
                    </Badge>
                  )}
                  {questionCount !== undefined && (
                    <Badge variant="secondary" className="font-mono tabular-nums">
                      {questionCount} {vi ? "câu hỏi" : "questions"}
                    </Badge>
                  )}
                </CardContent>
                <CardFooter className="gap-2">
                  <Button
                    className="w-full"
                    onClick={() => router.push(`/sets/${studySetId}`)}
                  >
                    <span>{vi ? "Mở học phần ngay" : "Open study set"}</span>
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </Button>
                </CardFooter>
              </>
            ) : needsAuth ? (
              <>
                <CardHeader>
                  <div className="bg-accent text-accent-foreground mb-2 flex size-10 items-center justify-center rounded-lg">
                    <LogIn className="size-5" aria-hidden="true" />
                  </div>
                  <h1 className="text-foreground text-xl leading-none font-semibold tracking-tight">
                    {vi ? "Đăng nhập để mở học phần chia sẻ" : "Sign in to open shared set"}
                  </h1>
                  <CardDescription>
                    {vi
                      ? "Vui lòng đăng nhập tài khoản StudyHub của bạn để nhận quyền truy cập liên kết chia sẻ này."
                      : "Please sign in to your StudyHub account to redeem this share link."}
                  </CardDescription>
                </CardHeader>
                <CardFooter className="flex-col gap-2">
                  <Button asChild className="w-full">
                    <Link href={`/login?next=${encodeURIComponent(`/share/${token}`)}`}>
                      {t("nav.signIn")}
                    </Link>
                  </Button>
                  <Button asChild variant="outline" className="w-full">
                    <Link href="/register">{t("nav.signUp")}</Link>
                  </Button>
                </CardFooter>
              </>
            ) : (
              <>
                <CardHeader>
                  <div className="bg-primary/10 text-primary mb-2 flex size-10 items-center justify-center rounded-lg">
                    <BookOpen className="size-5" aria-hidden="true" />
                  </div>
                  <h1 className="text-foreground text-xl leading-none font-semibold tracking-tight">
                    {vi ? "Liên kết chia sẻ học phần" : "Shared Study Set Link"}
                  </h1>
                  <CardDescription>
                    {vi
                      ? "Nhấn xác nhận để mở học phần này trong tài khoản StudyHub của bạn."
                      : "Confirm below to access this shared study set in your StudyHub account."}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {errorMsg && (
                    <div
                      role="alert"
                      className="border-destructive/30 bg-destructive-subtle text-destructive-subtle-foreground flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm"
                    >
                      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                      <span>{errorMsg}</span>
                    </div>
                  )}
                </CardContent>
                <CardFooter className="flex-col gap-2">
                  <Button
                    className="w-full"
                    disabled={redeemMutation.isPending}
                    onClick={() => redeemMutation.mutate()}
                  >
                    {redeemMutation.isPending && (
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    )}
                    <span>{vi ? "Mở học phần được chia sẻ" : "Open shared study set"}</span>
                  </Button>
                </CardFooter>
              </>
            )}
          </Card>
        </FadeIn>
      </main>
    </div>
  );
}
