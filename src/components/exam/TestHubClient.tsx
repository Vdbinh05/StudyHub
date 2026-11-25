"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FocusModeShell } from "@/components/learning/FocusModeShell";
import { lText } from "@/components/learning/learning-copy";
import { useI18n } from "@/lib/i18n";
import { fetchStudySet, listExams } from "@/lib/learning/api-client";
import {
  calculateRemainingMs,
  formatCountdownMs,
} from "@/lib/learning/exam-scoring";
import { CustomExamBuilderClient } from "./CustomExamBuilderClient";
import { LiveExamRunner } from "./LiveExamRunner";

interface TestHubClientProps {
  setId: string;
}

/**
 * `/sets/[id]/test` Hub:
 * - When `?attemptId=` is present, renders `LiveExamRunner` directly WITHOUT fetching 2,000 set questions (SH-023!).
 * - Otherwise renders Resume In-Progress Banner + the V2.0 `CustomExamBuilderClient` pre-seeded with `setId`
 *   (completely replacing the fake `extraSetIds * 100` V1 placeholder!).
 */
export function TestHubClient({ setId }: TestHubClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { locale, t } = useI18n();

  const attemptIdParam = searchParams.get("attemptId");
  const [manualAttemptId, setManualAttemptId] = React.useState<string | null>(
    null,
  );
  const activeAttemptId = manualAttemptId ?? attemptIdParam;

  // Lightweight metadata-only fetch (NEVER downloads 2,000 questions when resuming!)
  const setMetaQuery = useQuery({
    queryKey: ["study-set-meta", setId],
    queryFn: () => fetchStudySet(setId),
    enabled: !activeAttemptId,
    staleTime: 60_000,
  });

  const inProgressQuery = useQuery({
    queryKey: ["in-progress-exams", setId],
    queryFn: () => listExams({ studySetId: setId, status: "in_progress" }),
    enabled: !activeAttemptId,
    staleTime: 5_000,
  });

  if (activeAttemptId) {
    return (
      <LiveExamRunner
        key={activeAttemptId}
        setId={setId}
        attemptId={activeAttemptId}
      />
    );
  }

  const activeResumeAttempts = (inProgressQuery.data ?? []).filter((att) => {
    if (att.status !== "in_progress") return false;
    if (!att.expires_at) return true;
    const rem = calculateRemainingMs(att.expires_at);
    return rem === null || rem > 0;
  });

  return (
    <FocusModeShell
      backHref={`/sets/${setId}`}
      title={setMetaQuery.data?.title ?? t("exam.setupTitle")}
      subtitle={t("exam.setupTitle")}
    >
      <div className="space-y-6">
        {/* Resume In-Progress Exam Banner (with live server answered_count!) */}
        {activeResumeAttempts.length > 0 ? (
          <Card className="mx-auto w-full max-w-6xl border-primary/40 bg-accent/50">
            <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant="default">
                    {lText(locale, "Đang làm dở", "In Progress")}
                  </Badge>
                  <span className="text-sm font-semibold">
                    {activeResumeAttempts[0].study_set_title_snapshot}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {lText(locale, "Đã trả lời", "Answered")}:{" "}
                  {activeResumeAttempts[0].answered_count}/
                  {activeResumeAttempts[0].total_questions}
                  {activeResumeAttempts[0].expires_at
                    ? ` · ${lText(locale, "Còn lại", "Remaining")}: ${formatCountdownMs(
                        calculateRemainingMs(activeResumeAttempts[0].expires_at) ??
                          0,
                      )}`
                    : ""}
                </p>
              </div>
              <Button
                type="button"
                className="min-h-11 shrink-0"
                onClick={() => {
                  const id = activeResumeAttempts[0].id;
                  setManualAttemptId(id);
                  router.replace(`/sets/${setId}/test?attemptId=${id}`);
                }}
              >
                <RotateCcw className="size-4" aria-hidden="true" />
                {lText(locale, "Tiếp tục bài thi", "Resume Exam")}
              </Button>
            </CardContent>
          </Card>
        ) : null}

        <CustomExamBuilderClient initialSetId={setId} embedded />
      </div>
    </FocusModeShell>
  );
}
