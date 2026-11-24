"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, BookOpen, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/lib/i18n";
import {
  fetchSetProgress,
  fetchStarredQuestions,
  fetchStudySet,
  fetchStudySetQuestions,
  toggleStarQuestion,
} from "@/lib/learning/api-client";
import type { Question, StudySet, UserQuestionProgress } from "@/types/domain";
import { lText } from "./learning-copy";

export interface StudySetBundle {
  studySet: StudySet;
  questions: Question[];
  progressMap: Map<string, UserQuestionProgress>;
  starredIds: Set<string>;
  chapters: string[];
}

export function useStudySetBundle(setId: string) {
  const queryClient = useQueryClient();

  const query = useQuery<StudySetBundle>({
    queryKey: ["study-set-bundle", setId],
    queryFn: async () => {
      const [studySet, questions, progressList, starredList] = await Promise.all([
        fetchStudySet(setId),
        fetchStudySetQuestions(setId),
        fetchSetProgress(setId).catch(() => [] as UserQuestionProgress[]),
        fetchStarredQuestions(setId).catch(() => []),
      ]);

      const progressMap = new Map<string, UserQuestionProgress>();
      for (const p of progressList) {
        progressMap.set(p.question_id, p);
      }

      const starredIds = new Set<string>(starredList.map((s) => s.question_id));
      const chapterSet = new Set<string>();
      for (const q of questions) {
        if (q.chapter && q.chapter.trim()) {
          chapterSet.add(q.chapter.trim());
        }
      }

      return {
        studySet,
        questions,
        progressMap,
        starredIds,
        chapters: Array.from(chapterSet),
      };
    },
    staleTime: 30_000,
  });

  const toggleStar = React.useCallback(
    async (questionId: string) => {
      const previous = queryClient.getQueryData<StudySetBundle>([
        "study-set-bundle",
        setId,
      ]);

      // Optimistic toggle
      if (previous) {
        const nextSet = new Set(previous.starredIds);
        if (nextSet.has(questionId)) {
          nextSet.delete(questionId);
        } else {
          nextSet.add(questionId);
        }
        queryClient.setQueryData<StudySetBundle>(["study-set-bundle", setId], {
          ...previous,
          starredIds: nextSet,
        });
      }

      try {
        await toggleStarQuestion(questionId, setId);
      } catch (err) {
        if (previous) {
          queryClient.setQueryData(["study-set-bundle", setId], previous);
        }
        throw err;
      }
    },
    [queryClient, setId],
  );

  const updateLocalProgress = React.useCallback(
    (progress: UserQuestionProgress) => {
      queryClient.setQueryData<StudySetBundle>(
        ["study-set-bundle", setId],
        (prev) => {
          if (!prev) return prev;
          const nextMap = new Map(prev.progressMap);
          nextMap.set(progress.question_id, progress);
          return { ...prev, progressMap: nextMap };
        },
      );
    },
    [queryClient, setId],
  );

  return {
    ...query,
    toggleStar,
    updateLocalProgress,
  };
}

export function StudyLoadingSkeleton() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 py-8">
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-72 w-full rounded-xl" />
      <div className="flex justify-between gap-3">
        <Skeleton className="h-11 w-32" />
        <Skeleton className="h-11 w-32" />
      </div>
    </div>
  );
}

export function StudyErrorState({
  message,
  onRetry,
  backHref = "/library",
}: {
  message?: string;
  onRetry?: () => void;
  backHref?: string;
}) {
  const { locale } = useI18n();
  return (
    <Card className="mx-auto my-12 max-w-lg">
      <CardContent className="flex flex-col items-center gap-4 py-8 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-destructive-subtle text-destructive-subtle-foreground">
          <AlertCircle className="size-6" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">
            {lText(locale, "Không thể tải dữ liệu học phần", "Unable to load study set")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {message ??
              lText(
                locale,
                "Vui lòng kiểm tra kết nối mạng hoặc quyền truy cập học phần này.",
                "Please check your connection or permissions for this study set.",
              )}
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {onRetry ? (
            <Button onClick={onRetry}>
              <RefreshCw className="size-4" aria-hidden="true" />
              {lText(locale, "Thử lại", "Retry")}
            </Button>
          ) : null}
          <Button variant="outline" asChild>
            <Link href={backHref}>{lText(locale, "Quay lại thư viện", "Back to Library")}</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function StudyEmptyState({
  setId,
  title,
  description,
  onResetFilters,
}: {
  setId?: string;
  title?: string;
  description?: string;
  onResetFilters?: () => void;
}) {
  const { locale } = useI18n();
  return (
    <Card className="mx-auto my-12 max-w-lg">
      <CardContent className="flex flex-col items-center gap-4 py-8 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-secondary text-muted-foreground">
          <BookOpen className="size-6" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">
            {title ?? lText(locale, "Chưa có câu hỏi phù hợp", "No matching questions")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {description ??
              lText(
                locale,
                "Hãy thêm câu hỏi vào học phần hoặc điều chỉnh bộ lọc để bắt đầu học.",
                "Add questions to this set or adjust your filters to begin studying.",
              )}
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {onResetFilters ? (
            <Button onClick={onResetFilters}>
              {lText(locale, "Đặt lại bộ lọc", "Reset filters")}
            </Button>
          ) : null}
          {setId ? (
            <Button variant="outline" asChild>
              <Link href={`/sets/${setId}/edit`}>
                {lText(locale, "Thêm / chỉnh sửa câu hỏi", "Add / edit questions")}
              </Link>
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
