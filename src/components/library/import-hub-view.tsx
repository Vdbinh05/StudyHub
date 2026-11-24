"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowRight,
  FileSpreadsheet,
  FileText,
  Loader2,
  Plus,
  Search,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import {
  apiFetch,
  getFriendlyErrorMessage,
  isSupabaseConfiguredClient,
} from "@/components/layout/api-client";
import { EmptyState } from "@/components/layout/empty-state";
import { PageHeader } from "@/components/layout/page-header";
import { FadeIn } from "@/components/motion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { useI18n } from "@/lib/i18n";
import type { StudySet, StudySetType } from "@/types/domain";

function titleFromFilename(fileName: string): string {
  return fileName
    .replace(/\.[^/.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function ImportHubView() {
  const { locale, t } = useI18n();
  const vi = locale === "vi";
  const router = useRouter();
  const configured = isSupabaseConfiguredClient();

  const [search, setSearch] = React.useState("");
  const [debouncedSearch, setDebouncedSearch] = React.useState("");
  const [quickTitle, setQuickTitle] = React.useState("");
  const [quickSubject, setQuickSubject] = React.useState("");
  const [quickType, setQuickType] = React.useState<StudySetType>("multiple_choice");

  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [search]);

  const setsQuery = useQuery<StudySet[]>({
    queryKey: ["import-hub-sets", debouncedSearch],
    enabled: configured,
    queryFn: async () => {
      const qs = new URLSearchParams({ pageSize: "100" });
      if (debouncedSearch) qs.set("search", debouncedSearch);
      const res = await apiFetch<StudySet[]>(`/api/sets?${qs.toString()}`);
      return res.data ?? [];
    },
  });

  const createAndOpenImport = useMutation({
    mutationFn: async () => {
      const res = await apiFetch<StudySet>("/api/sets", {
        method: "POST",
        body: JSON.stringify({
          title: quickTitle.trim(),
          subject: quickSubject.trim() || null,
          set_type: quickType,
          visibility: "private",
        }),
      });
      return res.data;
    },
    onSuccess: (created) => {
      toast.success(
        vi
          ? "Đã tạo học phần — đang mở trình nhập câu hỏi."
          : "Study set created — opening import wizard.",
      );
      router.push(`/sets/${created.id}/import`);
    },
    onError: (err) => {
      toast.error(getFriendlyErrorMessage(err, locale));
    },
  });

  const handleFileSuggestTitle = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!quickTitle.trim()) {
      setQuickTitle(titleFromFilename(file.name));
    }
  };

  const sets = setsQuery.data ?? [];

  return (
    <FadeIn aboveFold className="space-y-6">
      <PageHeader
        title={t("import.title")}
        description={
          vi
            ? "Chọn học phần có sẵn hoặc tạo nhanh học phần mới rồi nhập trực tiếp từ Word (.docx), Excel (.xlsx), CSV, TXT hoặc JSON."
            : "Pick an existing study set or create a new one in seconds, then import from Word (.docx), Excel (.xlsx), CSV, TXT, or JSON."
        }
      />

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Fast-path: Create new set & jump straight to Import Wizard */}
        <Card className="lg:col-span-5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Plus className="text-primary size-4" aria-hidden="true" />
              <span>
                {vi
                  ? "Tạo học phần mới & Nhập ngay"
                  : "Create New Set & Import Now"}
              </span>
            </CardTitle>
            <CardDescription>
              {vi
                ? "Nhập nhanh tên học phần (hoặc chọn file để tự điền tên) rồi chuyển thẳng tới bước tải tệp."
                : "Enter a set title (or pick a file to auto-fill the name) and jump straight to the upload wizard."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!quickTitle.trim()) {
                  toast.error(
                    vi
                      ? "Vui lòng nhập tên học phần trước khi tiếp tục."
                      : "Please enter a study set title first.",
                  );
                  return;
                }
                createAndOpenImport.mutate();
              }}
              className="space-y-4"
            >
              <div className="space-y-1.5">
                <Label htmlFor="import-quick-file">
                  {vi ? "Gợi ý tên từ file (tùy chọn)" : "Suggest title from file (optional)"}
                </Label>
                <Input
                  id="import-quick-file"
                  type="file"
                  accept=".docx,.xlsx,.csv,.tsv,.txt,.json"
                  onChange={handleFileSuggestTitle}
                  disabled={!configured}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="import-quick-title">
                  {vi ? "Tên học phần" : "Study set title"}
                </Label>
                <Input
                  id="import-quick-title"
                  value={quickTitle}
                  onChange={(e) => setQuickTitle(e.target.value)}
                  placeholder={
                    vi
                      ? "VD: Khí tượng học — Chương 1 (133 câu)"
                      : "e.g. Meteorology — Chapter 1 (133 Qs)"
                  }
                  disabled={!configured}
                  required
                />
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="import-quick-subject">
                    {vi ? "Môn học (tùy chọn)" : "Subject (optional)"}
                  </Label>
                  <Input
                    id="import-quick-subject"
                    value={quickSubject}
                    onChange={(e) => setQuickSubject(e.target.value)}
                    placeholder={vi ? "VD: Hàng không" : "e.g. Aviation"}
                    disabled={!configured}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="import-quick-type">
                    {vi ? "Loại học phần" : "Set type"}
                  </Label>
                  <Select
                    value={quickType}
                    onValueChange={(v) => setQuickType(v as StudySetType)}
                    disabled={!configured}
                  >
                    <SelectTrigger id="import-quick-type">
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
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={!configured || createAndOpenImport.isPending}
              >
                {createAndOpenImport.isPending ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Upload className="size-4" aria-hidden="true" />
                )}
                <span>
                  {vi ? "Tạo & Mở trình nhập file" : "Create & Open Import Wizard"}
                </span>
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Pick an existing set to import into */}
        <Card className="lg:col-span-7">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileSpreadsheet className="text-primary size-4" aria-hidden="true" />
              <span>
                {vi
                  ? "Nhập vào học phần đã có"
                  : "Import Into an Existing Study Set"}
              </span>
            </CardTitle>
            <CardDescription>
              {vi
                ? "Chọn học phần bạn muốn bổ sung hoặc cập nhật bộ câu hỏi."
                : "Select a study set to append or update questions."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <search>
              <div className="relative">
                <Search
                  className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
                  aria-hidden="true"
                />
                <Input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={t("library.searchPlaceholder")}
                  aria-label={t("library.searchPlaceholder")}
                  className="pl-9"
                  disabled={!configured}
                />
              </div>
            </search>

            {!configured ? (
              <EmptyState
                icon={FileText}
                title={vi ? "Chưa thể tải học phần" : "Study sets unavailable"}
                description={t("common.serviceUnavailableDesc")}
              />
            ) : setsQuery.isLoading ? (
              <div className="space-y-2.5">
                <Skeleton className="h-16 w-full rounded-lg" />
                <Skeleton className="h-16 w-full rounded-lg" />
                <Skeleton className="h-16 w-full rounded-lg" />
              </div>
            ) : setsQuery.isError ? (
              <EmptyState
                icon={FileText}
                title={vi ? "Không thể tải danh sách học phần" : "Unable to load sets"}
                description={getFriendlyErrorMessage(setsQuery.error, locale)}
                action={
                  <Button variant="outline" onClick={() => setsQuery.refetch()}>
                    {t("common.retry")}
                  </Button>
                }
              />
            ) : sets.length === 0 ? (
              <EmptyState
                icon={FileText}
                title={t("library.emptyTitle")}
                description={
                  vi
                    ? "Hãy tạo học phần mới ở khung bên cạnh để bắt đầu nhập đề."
                    : "Create a new study set using the panel beside this to start importing."
                }
              />
            ) : (
              <ul className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
                {sets.map((set) => (
                  <li key={set.id}>
                    <Link
                      href={`/sets/${set.id}/import`}
                      className="border-border bg-background hover:border-primary/40 hover:bg-secondary/50 flex min-h-14 items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-foreground truncate text-sm font-medium">
                          {set.title}
                        </p>
                        <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-2 text-xs">
                          {set.subject && <span>{set.subject}</span>}
                          <Badge variant="secondary" className="text-[11px] font-normal">
                            {t("library.questionsCount", { count: set.question_count })}
                          </Badge>
                        </div>
                      </div>
                      <span className="text-primary inline-flex shrink-0 items-center gap-1 text-xs font-medium">
                        <span>{vi ? "Nhập đề" : "Import"}</span>
                        <ArrowRight className="size-3.5" aria-hidden="true" />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </FadeIn>
  );
}
