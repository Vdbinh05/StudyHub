"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { DiagramEditor } from "@/components/diagram/DiagramEditor";
import { DiagramStudyPlayer } from "@/components/diagram/DiagramStudyPlayer";
import { getFriendlyErrorMessage } from "@/components/layout/api-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getDiagramDetail } from "@/lib/diagram/api";
import { useI18n } from "@/lib/i18n";

export function DiagramRouteLoader({
  diagramId,
  view,
}: {
  diagramId: string;
  view: "edit" | "study";
}) {
  const { locale } = useI18n();
  const vi = locale === "vi";
  const queryClient = useQueryClient();

  const diagramQuery = useQuery({
    queryKey: ["diagram-detail", diagramId],
    queryFn: () => getDiagramDetail(diagramId),
  });

  if (diagramQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-64" />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Skeleton className="h-[440px] rounded-xl" />
          <Skeleton className="h-[440px] rounded-xl" />
        </div>
      </div>
    );
  }

  if (diagramQuery.isError || !diagramQuery.data) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
          <p className="text-sm font-medium text-destructive">
            {getFriendlyErrorMessage(
              diagramQuery.error,
              locale,
              vi
                ? "Không tìm thấy sơ đồ hoặc bạn không có quyền truy cập."
                : "Diagram not found or you do not have access.",
            )}
          </p>
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/library">
                <ArrowLeft className="mr-1.5 size-4" aria-hidden="true" />
                {vi ? "Về thư viện" : "Back to library"}
              </Link>
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void diagramQuery.refetch()}
            >
              {vi ? "Thử lại" : "Retry"}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const diagram = diagramQuery.data;
  const backHref = `/sets/${encodeURIComponent(diagram.study_set_id)}/diagrams`;

  if (view === "edit") {
    return (
      <DiagramEditor
        studySetId={diagram.study_set_id}
        initialDiagram={diagram}
        backHref={backHref}
        onSaved={(updated) => {
          queryClient.setQueryData(["diagram-detail", diagramId], updated);
          void queryClient.invalidateQueries({
            queryKey: ["study-set-diagrams", diagram.study_set_id],
          });
        }}
      />
    );
  }

  return <DiagramStudyPlayer diagram={diagram} backHref={backHref} />;
}
