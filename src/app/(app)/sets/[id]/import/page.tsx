import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertCircle } from "lucide-react";
import { ImportWizard } from "@/components/import/ImportWizard";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SUPABASE_NOT_CONFIGURED_MESSAGE } from "@/lib/supabase/env";
import { tryCreateClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Nhập câu hỏi — StudyHub",
};

interface ImportPageProps {
  params: Promise<{ id: string }>;
}

export default async function StudySetImportPage({ params }: ImportPageProps) {
  const { id } = await params;

  const supabase = await tryCreateClient();
  if (!supabase) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-amber-700 dark:text-amber-400">
              <AlertCircle className="size-5" aria-hidden="true" />
              Chưa cấu hình kết nối Supabase
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <p>{SUPABASE_NOT_CONFIGURED_MESSAGE}</p>
            <Button asChild variant="outline">
              <Link href="/dashboard">Quay lại Tổng quan</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/sets/${id}/import`)}`);
  }

  const { data: studySet } = await supabase
    .from("study_sets")
    .select("id, title, owner_id, question_count")
    .eq("id", id)
    .maybeSingle();

  if (!studySet) {
    notFound();
  }

  let canEdit = studySet.owner_id === user.id;
  if (!canEdit) {
    const { data: member } = await supabase
      .from("study_set_members")
      .select("role")
      .eq("study_set_id", id)
      .eq("user_id", user.id)
      .maybeSingle();
    canEdit = member?.role === "editor" || member?.role === "owner";
  }

  if (!canEdit) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-destructive">
              <AlertCircle className="size-5" aria-hidden="true" />
              Không có quyền nhập câu hỏi
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <p>
              Chỉ chủ sở hữu hoặc cộng tác viên có quyền chỉnh sửa (Editor) mới có
              thể nhập câu hỏi vào học phần này.
            </p>
            <Button asChild variant="outline">
              <Link href={`/sets/${id}`}>Quay lại học phần</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <ImportWizard
      studySetId={studySet.id}
      studySetTitle={studySet.title}
      existingQuestionCount={studySet.question_count ?? 0}
    />
  );
}
