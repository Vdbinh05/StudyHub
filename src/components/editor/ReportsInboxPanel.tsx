"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Edit3, Flag, Inbox, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { apiFetch, getFriendlyErrorMessage } from "@/components/layout/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import type { Locale } from "@/types/domain";
import type { QuestionReport, QuestionReportStatus } from "@/types/v3";
import { REPORT_CATEGORY_LABELS } from "./QuestionReportDialog";

export interface ReportsInboxPanelProps {
  studySetId: string;
  locale?: Locale;
  onEditQuestion?: (questionId: string) => void;
}

const STATUS_BADGE: Record<
  QuestionReportStatus,
  { vi: string; en: string; variant: "destructive" | "secondary" | "default" | "outline" }
> = {
  open: { vi: "Đang mở", en: "Open", variant: "destructive" },
  reviewing: { vi: "Đang xem xét", en: "Reviewing", variant: "secondary" },
  resolved: { vi: "Đã xử lý", en: "Resolved", variant: "default" },
  dismissed: { vi: "Bỏ qua", en: "Dismissed", variant: "outline" },
};

export function ReportsInboxPanel({
  studySetId,
  locale = "vi",
  onEditQuestion,
}: ReportsInboxPanelProps): React.ReactElement {
  const isVi = locale === "vi";
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = React.useState<"all" | QuestionReportStatus>("open");
  const [noteDrafts, setNoteDrafts] = React.useState<Record<string, string>>({});

  const reportsQuery = useQuery<QuestionReport[]>({
    queryKey: ["question-reports", studySetId, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ studySetId, pageSize: "100" });
      if (statusFilter !== "all") params.set("status", statusFilter);
      const res = await apiFetch<QuestionReport[]>(`/api/reports?${params.toString()}`);
      return Array.isArray(res.data) ? res.data : [];
    },
  });

  const updateReportMutation = useMutation({
    mutationFn: async (input: {
      reportId: string;
      status: QuestionReportStatus;
      resolutionNote?: string;
    }) => {
      const res = await apiFetch<QuestionReport>(`/api/reports/${input.reportId}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: input.status,
          resolution_note: input.resolutionNote?.trim() || null,
        }),
      });
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["question-reports", studySetId] });
      toast.success(isVi ? "Đã cập nhật trạng thái báo cáo." : "Report status updated.");
    },
    onError: (err) => {
      toast.error(getFriendlyErrorMessage(err, locale));
    },
  });

  const reports = reportsQuery.data ?? [];

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Flag className="size-4 text-warning" aria-hidden="true" />
            {isVi ? "Hộp thư báo lỗi câu hỏi" : "Question Issue Reports"}
          </CardTitle>
          <CardDescription>
            {isVi
              ? "Xem xét các báo cáo từ người học, mở câu hỏi để chỉnh sửa thủ công và đánh dấu đã xử lý."
              : "Review learner issue reports, inspect and edit the question manually, then mark resolved or dismissed."}
          </CardDescription>
        </div>

        <Select
          value={statusFilter}
          onValueChange={(v) => setStatusFilter(v as "all" | QuestionReportStatus)}
        >
          <SelectTrigger className="w-44" aria-label={isVi ? "Lọc trạng thái" : "Filter status"}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{isVi ? "Tất cả trạng thái" : "All statuses"}</SelectItem>
            <SelectItem value="open">{isVi ? "Đang mở" : "Open"}</SelectItem>
            <SelectItem value="reviewing">{isVi ? "Đang xem xét" : "Reviewing"}</SelectItem>
            <SelectItem value="resolved">{isVi ? "Đã xử lý" : "Resolved"}</SelectItem>
            <SelectItem value="dismissed">{isVi ? "Đã bỏ qua" : "Dismissed"}</SelectItem>
          </SelectContent>
        </Select>
      </CardHeader>

      <CardContent className="space-y-3">
        {reportsQuery.isLoading ? (
          <Skeleton className="h-36 w-full rounded-lg" />
        ) : reports.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-10 text-center">
            <Inbox className="mb-2 size-7 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-medium text-foreground">
              {isVi ? "Không có báo cáo nào trong mục này" : "No reports in this view"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {isVi
                ? "Các báo lỗi từ người học sẽ xuất hiện tại đây để bạn kiểm duyệt thủ công."
                : "Learner reports will appear here for manual review."}
            </p>
          </div>
        ) : (
          reports.map((report) => {
            const catMeta = REPORT_CATEGORY_LABELS[report.category];
            const stMeta = STATUS_BADGE[report.status];
            const noteVal =
              noteDrafts[report.id] !== undefined
                ? noteDrafts[report.id]
                : (report.resolution_note ?? "");

            return (
              <div
                key={report.id}
                className="space-y-2.5 rounded-lg border border-border bg-background p-3.5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge variant={stMeta.variant}>
                      {isVi ? stMeta.vi : stMeta.en}
                    </Badge>
                    <Badge variant="secondary">
                      {isVi ? catMeta.vi : catMeta.en}
                    </Badge>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {new Date(report.created_at).toLocaleString(isVi ? "vi-VN" : "en-US")}
                    </span>
                  </div>

                  {onEditQuestion && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => onEditQuestion(report.question_id)}
                      className="h-8 gap-1.5 text-xs"
                    >
                      <Edit3 className="size-3.5" aria-hidden="true" />
                      {isVi ? "Mở câu hỏi để sửa" : "Edit Question"}
                    </Button>
                  )}
                </div>

                <p className="whitespace-pre-wrap text-sm text-foreground">
                  {report.description}
                </p>

                <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center">
                  <Input
                    value={noteVal}
                    onChange={(e) =>
                      setNoteDrafts((prev) => ({ ...prev, [report.id]: e.target.value }))
                    }
                    placeholder={
                      isVi
                        ? "Ghi chú xử lý (tùy chọn)…"
                        : "Resolution note (optional)…"
                    }
                    className="h-8 flex-1 text-xs"
                  />
                  <div className="flex items-center gap-1.5">
                    <Button
                      type="button"
                      size="sm"
                      variant="default"
                      disabled={updateReportMutation.isPending}
                      onClick={() =>
                        updateReportMutation.mutate({
                          reportId: report.id,
                          status: "resolved",
                          resolutionNote: noteVal,
                        })
                      }
                      className="h-8 gap-1 text-xs"
                    >
                      {updateReportMutation.isPending ? (
                        <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <CheckCircle2 className="size-3.5" aria-hidden="true" />
                      )}
                      {isVi ? "Đã xử lý" : "Resolve"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={updateReportMutation.isPending}
                      onClick={() =>
                        updateReportMutation.mutate({
                          reportId: report.id,
                          status: "dismissed",
                          resolutionNote: noteVal,
                        })
                      }
                      className="h-8 gap-1 text-xs"
                    >
                      <XCircle className="size-3.5" aria-hidden="true" />
                      {isVi ? "Bỏ qua" : "Dismiss"}
                    </Button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
