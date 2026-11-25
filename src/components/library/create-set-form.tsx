"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Loader2, PenLine, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  apiFetch,
  getFriendlyErrorMessage,
  isSupabaseConfiguredClient,
} from "@/components/layout/api-client";
import { PageHeader } from "@/components/layout/page-header";
import { FadeIn } from "@/components/motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useI18n } from "@/lib/i18n";
import type { Folder, StudySet, StudySetType, Visibility } from "@/types/domain";

function clampInt(raw: string, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function CreateSetFormInner() {
  const { locale, t } = useI18n();
  const vi = locale === "vi";
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const configured = isSupabaseConfiguredClient();

  const initialFolderId = searchParams.get("folderId") ?? "none";

  const [title, setTitle] = React.useState("");
  const [subject, setSubject] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [folderId, setFolderId] = React.useState(initialFolderId);
  const [setType, setSetType] = React.useState<StudySetType>("multiple_choice");
  const [visibility, setVisibility] = React.useState<Visibility>("private");
  const [durationDraft, setDurationDraft] = React.useState("45");
  const [passDraft, setPassDraft] = React.useState("70");
  const [touchedTitle, setTouchedTitle] = React.useState(false);
  const [submitted, setSubmitted] = React.useState(false);

  const titleInputRef = React.useRef<HTMLInputElement>(null);
  const submittingRef = React.useRef(false);

  const foldersQuery = useQuery<Folder[]>({
    queryKey: ["folders"],
    enabled: configured,
    queryFn: async () => {
      const res = await apiFetch<Folder[]>("/api/folders");
      return Array.isArray(res.data) ? res.data : [];
    },
  });

  const createMutation = useMutation({
    mutationFn: async (nextAction: "edit" | "import") => {
      const durationMinutes = clampInt(durationDraft, 1, 300, 45);
      const passThreshold = clampInt(passDraft, 1, 100, 70);
      const res = await apiFetch<StudySet>("/api/sets", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          subject: subject.trim() || null,
          description: description.trim() || null,
          folder_id: folderId === "none" ? null : folderId,
          set_type: setType,
          visibility,
          source_language: locale,
          default_exam_duration_minutes: durationMinutes,
          default_pass_threshold: passThreshold,
        }),
      });
      return { set: res.data, nextAction };
    },
    onSuccess: ({ set, nextAction }) => {
      queryClient.invalidateQueries({ queryKey: ["study-sets"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success(vi ? "Đã tạo học phần mới." : "Study set created.");
      router.push(`/sets/${set.id}/${nextAction}`);
    },
    onError: (err) => {
      submittingRef.current = false;
      toast.error(getFriendlyErrorMessage(err, locale));
    },
  });

  const titleInvalid = (touchedTitle || submitted) && title.trim().length === 0;

  const triggerCreate = (nextAction: "edit" | "import") => {
    if (submittingRef.current || createMutation.isPending) {
      return;
    }
    setSubmitted(true);
    if (!title.trim()) {
      titleInputRef.current?.focus();
      return;
    }
    submittingRef.current = true;
    createMutation.mutate(nextAction);
  };

  return (
    <FadeIn aboveFold className="mx-auto max-w-2xl space-y-6">
      <PageHeader
        title={t("library.newSet")}
        description={
          vi
            ? "Mọi học phần mới mặc định ở chế độ riêng tư. Bạn có thể nhập câu hỏi thủ công hoặc tải file Word/Excel/TXT ngay bước tiếp theo."
            : "Every new study set defaults to private. Add questions manually or bulk import DOCX/XLSX/TXT right after creation."
        }
        breadcrumbs={[
          { label: t("library.title"), href: "/library" },
          { label: t("library.newSet") },
        ]}
      />

      <Card>
        <CardContent className="pt-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              triggerCreate("edit");
            }}
            noValidate
            className="space-y-5"
          >
            <div className="space-y-1.5">
              <Label htmlFor="set-title">
                {vi ? "Tên học phần" : "Study set title"}{" "}
                <span className="text-destructive">*</span>
              </Label>
              <Input
                ref={titleInputRef}
                id="set-title"
                required
                maxLength={200}
                placeholder={
                  vi
                    ? "VD: Ôn thi Triết học Mác - Lênin (600 câu)"
                    : "e.g., Microeconomics Final Bank (600 Qs)"
                }
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => setTouchedTitle(true)}
                aria-invalid={titleInvalid ? "true" : "false"}
                aria-describedby={titleInvalid ? "set-title-error" : undefined}
              />
              {titleInvalid && (
                <p
                  id="set-title-error"
                  role="alert"
                  className="text-destructive flex items-center gap-1.5 text-xs font-medium"
                >
                  <AlertCircle className="size-3.5" aria-hidden="true" />
                  <span>
                    {vi ? "Vui lòng nhập tên học phần." : "Please enter a title."}
                  </span>
                </p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="set-type">{vi ? "Loại học phần" : "Set type"}</Label>
                <Select
                  value={setType}
                  onValueChange={(v) => setSetType(v as StudySetType)}
                >
                  <SelectTrigger id="set-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="multiple_choice">
                      {t("library.typeMultipleChoice")}
                    </SelectItem>
                    <SelectItem value="flashcards">
                      {t("library.typeFlashcards")}
                    </SelectItem>
                    <SelectItem value="mixed">{t("library.typeMixed")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="set-subject">
                  {vi ? "Môn học / Chủ đề" : "Subject / Course"}
                </Label>
                <Input
                  id="set-subject"
                  maxLength={100}
                  placeholder={vi ? "VD: Kinh tế vi mô, Tiếng Anh" : "e.g., Anatomy, English"}
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="set-folder">{t("nav.folders")}</Label>
                <Select value={folderId} onValueChange={setFolderId}>
                  <SelectTrigger id="set-folder">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">
                      {vi ? "Không thuộc thư mục" : "No folder"}
                    </SelectItem>
                    {(foldersQuery.data ?? []).map((f) => (
                      <SelectItem key={f.id} value={f.id}>
                        {f.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="set-visibility">
                  {vi ? "Quyền hiển thị" : "Visibility"}
                </Label>
                <Select
                  value={visibility}
                  onValueChange={(v) => setVisibility(v as Visibility)}
                >
                  <SelectTrigger id="set-visibility">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="private">
                      {t("library.visibilityPrivate")}
                    </SelectItem>
                    <SelectItem value="shared">
                      {t("library.visibilityShared")}
                    </SelectItem>
                    <SelectItem value="unlisted">
                      {t("library.visibilityUnlisted")}
                    </SelectItem>
                    <SelectItem value="public">
                      {t("library.visibilityPublic")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="set-description">
                {vi ? "Mô tả (tùy chọn)" : "Description (optional)"}
              </Label>
              <Textarea
                id="set-description"
                rows={3}
                maxLength={2000}
                placeholder={
                  vi
                    ? "Ghi chú nguồn đề thi, phạm vi chương hoặc lưu ý khi ôn tập..."
                    : "Optional notes about exam scope, chapters, or study tips..."
                }
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="set-duration">
                  {t("exam.timeLimitMinutes")}
                </Label>
                <Input
                  id="set-duration"
                  type="text"
                  inputMode="numeric"
                  value={durationDraft}
                  onChange={(e) => setDurationDraft(e.target.value.replace(/[^0-9]/g, ""))}
                  onBlur={() =>
                    setDurationDraft(String(clampInt(durationDraft, 1, 300, 45)))
                  }
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="set-pass-threshold">
                  {t("exam.passThreshold")}
                </Label>
                <Input
                  id="set-pass-threshold"
                  type="text"
                  inputMode="numeric"
                  value={passDraft}
                  onChange={(e) => setPassDraft(e.target.value.replace(/[^0-9]/g, ""))}
                  onBlur={() =>
                    setPassDraft(String(clampInt(passDraft, 1, 100, 70)))
                  }
                />
              </div>
            </div>

            <div className="border-border flex flex-col gap-2.5 border-t pt-4 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                disabled={createMutation.isPending}
                onClick={() => triggerCreate("import")}
              >
                {createMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Upload className="size-4" aria-hidden="true" />
                )}
                <span>
                  {vi ? "Tạo & Nhập câu hỏi từ file" : "Create & Bulk Import"}
                </span>
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {createMutation.isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <PenLine className="size-4" aria-hidden="true" />
                )}
                <span>
                  {vi ? "Tạo & Chỉnh sửa thủ công" : "Create & Add Questions"}
                </span>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </FadeIn>
  );
}

export function CreateSetForm() {
  return (
    <React.Suspense fallback={<Skeleton className="mx-auto h-96 max-w-2xl rounded-xl" />}>
      <CreateSetFormInner />
    </React.Suspense>
  );
}
