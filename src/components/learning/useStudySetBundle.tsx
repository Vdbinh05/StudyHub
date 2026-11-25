"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, BookOpen, RefreshCw } from "lucide-react";
import { useOptionalPwa } from "@/components/pwa/PwaProvider";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useI18n } from "@/lib/i18n";
import {
  fetchAccessibleSets,
  fetchStudySet,
  fetchStudySetQuestionsPage,
  toggleStarQuestion,
  type HydratedStudyQuestion,
} from "@/lib/learning/api-client";
import type {
  MemberRole,
  Question,
  StudySet,
  UserQuestionProgress,
} from "@/types/domain";
import { lText } from "./learning-copy";

export type StudySetWithAccess = StudySet & {
  can_edit?: boolean;
  role?: MemberRole | "public_viewer";
  member_role?: MemberRole;
  is_owner?: boolean;
};

/**
 * Determine whether the current user is allowed to edit questions in a study set.
 * Trusts explicit server-authoritative `can_edit` / `role` / `member_role` flags first,
 * falling back to strict `owner_id === authenticatedUserId` match only when role metadata is absent.
 * NEVER grants edit rights to read-only viewers or public shares.
 */
export function resolveCanEditStudySet(
  studySet: StudySetWithAccess | null | undefined,
  authenticatedUserId?: string | null,
): boolean {
  if (!studySet) return false;
  if (typeof studySet.can_edit === "boolean") return studySet.can_edit;
  if (typeof studySet.is_owner === "boolean" && studySet.is_owner) return true;
  const role = studySet.role ?? studySet.member_role;
  if (role === "owner" || role === "editor") return true;
  if (role === "viewer" || role === "public_viewer") return false;
  return Boolean(authenticatedUserId && studySet.owner_id === authenticatedUserId);
}

export interface StudySetBundle {
  studySet: StudySetWithAccess;
  questions: Question[];
  progressMap: Map<string, UserQuestionProgress>;
  starredIds: Set<string>;
  chapters: string[];
  /** Total questions reported by backend (may exceed `questions.length` while background pages stream in). */
  totalQuestions: number;
  /** True while pages 2..N are streaming in the background after Page 1 rendered Q1 immediately. */
  isLoadingMore: boolean;
  /** Monotonic ID incremented only on fresh Page-1 fetch so background merges never self-abort. */
  fetchId: number;
}

const STREAM_PAGE_SIZE = 50;
const STREAM_CONCURRENCY = 2;
let nextBundleFetchId = 1;

function normalizeProgressEntry(
  question: HydratedStudyQuestion,
): UserQuestionProgress | null {
  const raw = question.progress;
  if (!raw || typeof raw !== "object") return null;
  return {
    id: raw.id ?? question.id,
    user_id: raw.user_id ?? "",
    study_set_id: raw.study_set_id ?? question.study_set_id,
    question_id: raw.question_id ?? question.id,
    mastery_level: raw.mastery_level ?? "new",
    correct_count: raw.correct_count ?? 0,
    wrong_count: raw.wrong_count ?? 0,
    consecutive_correct: raw.consecutive_correct ?? 0,
    consecutive_wrong: raw.consecutive_wrong ?? 0,
    ease_factor: raw.ease_factor ?? 2.5,
    interval_days: raw.interval_days ?? 0,
    repetitions: raw.repetitions ?? 0,
    last_reviewed_at: raw.last_reviewed_at ?? null,
    last_wrong_at: raw.last_wrong_at ?? null,
    next_review_at: raw.next_review_at ?? null,
    last_confidence: raw.last_confidence ?? null,
    low_confidence_count: raw.low_confidence_count ?? 0,
    high_conf_wrong_count: raw.high_conf_wrong_count ?? 0,
    guess_correct_count: raw.guess_correct_count ?? 0,
    independent_recall_count: raw.independent_recall_count ?? 0,
    hint_used_count: raw.hint_used_count ?? 0,
    mistake_status: raw.mistake_status ?? "active",
    progress_generation: raw.progress_generation,
    updated_at: raw.updated_at ?? raw.last_reviewed_at ?? question.updated_at,
  };
}

function buildBundleFromQuestions(
  studySet: StudySet,
  hydratedQuestions: readonly HydratedStudyQuestion[],
  totalQuestions: number,
  isLoadingMore: boolean,
  fetchId: number,
): StudySetBundle {
  const progressMap = new Map<string, UserQuestionProgress>();
  const starredIds = new Set<string>();
  const chapterSet = new Set<string>();
  const seenIds = new Set<string>();
  const questions: Question[] = [];

  for (const q of hydratedQuestions) {
    if (!q?.id || seenIds.has(q.id)) continue;
    seenIds.add(q.id);
    questions.push(q);

    if (q.is_starred) {
      starredIds.add(q.id);
    }
    const normProgress = normalizeProgressEntry(q);
    if (normProgress) {
      progressMap.set(q.id, normProgress);
    }
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
    totalQuestions: Math.max(totalQuestions, questions.length),
    isLoadingMore,
    fetchId,
  };
}

function mergeStreamedPageIntoBundle(
  prev: StudySetBundle,
  incoming: readonly HydratedStudyQuestion[],
  totalQuestions: number,
  isLoadingMore: boolean,
): StudySetBundle {
  const existingIds = new Set(prev.questions.map((q) => q.id));
  const nextQuestions = [...prev.questions];
  const nextProgressMap = new Map(prev.progressMap);
  const nextStarredIds = new Set(prev.starredIds);
  const nextChapters = new Set(prev.chapters);

  for (const q of incoming) {
    if (!q?.id || existingIds.has(q.id)) continue;
    existingIds.add(q.id);
    nextQuestions.push(q);

    if (q.is_starred) {
      nextStarredIds.add(q.id);
    }
    const normProgress = normalizeProgressEntry(q);
    if (normProgress && !nextProgressMap.has(q.id)) {
      nextProgressMap.set(q.id, normProgress);
    }
    if (q.chapter && q.chapter.trim()) {
      nextChapters.add(q.chapter.trim());
    }
  }

  return {
    ...prev,
    questions: nextQuestions,
    progressMap: nextProgressMap,
    starredIds: nextStarredIds,
    chapters: Array.from(nextChapters),
    totalQuestions: Math.max(prev.totalQuestions, totalQuestions, nextQuestions.length),
    isLoadingMore,
  };
}

function extractCachedStudySet(raw: unknown): StudySetWithAccess | null {
  if (!raw || typeof raw !== "object") return null;
  if (
    "set" in raw &&
    raw.set &&
    typeof raw.set === "object" &&
    "id" in raw.set &&
    "title" in raw.set
  ) {
    const wrapped = raw as {
      set: StudySetWithAccess;
      role?: MemberRole | "public_viewer";
      can_edit?: boolean;
    };
    return {
      ...wrapped.set,
      role: wrapped.role ?? wrapped.set.role,
      can_edit: wrapped.can_edit ?? wrapped.set.can_edit,
    };
  }
  if ("id" in raw && "title" in raw) {
    return raw as StudySetWithAccess;
  }
  return null;
}

/**
 * Resolve the currently authenticated user's ID from verified client identity providers
 * (`PwaProvider.activeUserId` seeded from server layout, or cached `["current-profile"]`).
 * NEVER falls back to `studySet.owner_id` (fixes `FUNC-17` cross-account checkpoint leak).
 */
export function useAuthenticatedUserId(): string | null {
  const pwa = useOptionalPwa();
  const queryClient = useQueryClient();

  if (pwa?.activeUserId && pwa.activeUserId.trim().length > 0) {
    return pwa.activeUserId.trim();
  }

  const cachedProfile = queryClient.getQueryData<{
    profile?: { id?: string } | null;
    id?: string;
  } | null>(["current-profile"]);

  const profileId = cachedProfile?.profile?.id ?? cachedProfile?.id ?? null;
  return profileId && profileId.trim().length > 0 ? profileId.trim() : null;
}

export function useStudySetBundle(
  setId: string,
  options?: { enabled?: boolean; maxQuestions?: number },
) {
  const queryClient = useQueryClient();
  const enabled = options?.enabled ?? true;
  const maxQuestions = options?.maxQuestions ?? 10_000;
  const streamingRunIdRef = React.useRef(0);

  const query = useQuery<StudySetBundle>({
    queryKey: ["study-set-bundle", setId, maxQuestions],
    enabled: Boolean(setId) && enabled,
    queryFn: async ({ signal }) => {
      // Seed studySet from React Query cache (`["study-set", setId]`) when recently fetched on `/sets/[id]`
      const cachedSetState = queryClient.getQueryState<unknown>([
        "study-set",
        setId,
      ]);
      const isFreshCached =
        Boolean(cachedSetState?.dataUpdatedAt) &&
        Date.now() - (cachedSetState?.dataUpdatedAt ?? 0) < 60_000;
      const cachedStudySet = isFreshCached
        ? extractCachedStudySet(cachedSetState?.data)
        : null;

      // V32-015: Eliminate redundant `/api/progress` and `/api/starred` calls!
      // Request Page 1 (`pageSize=50`) immediately alongside studySet metadata so Q1 renders ASAP.
      const firstPageSize = Math.min(STREAM_PAGE_SIZE, Math.max(1, maxQuestions));
      const [studySet, page1] = await Promise.all([
        cachedStudySet ? Promise.resolve(cachedStudySet) : fetchStudySet(setId),
        fetchStudySetQuestionsPage(setId, 1, firstPageSize, signal),
      ]);

      if (!cachedStudySet && studySet) {
        queryClient.setQueryData(["study-set", setId], studySet);
      }

      const reportedTotal =
        typeof page1.total === "number"
          ? Math.min(page1.total, maxQuestions)
          : Math.min(
              Math.max(page1.items.length, studySet.question_count ?? page1.items.length),
              maxQuestions,
            );
      const hasMore =
        page1.hasMore &&
        page1.items.length >= firstPageSize &&
        page1.items.length < reportedTotal;

      return buildBundleFromQuestions(
        studySet,
        page1.items.slice(0, maxQuestions),
        reportedTotal,
        hasMore,
        nextBundleFetchId++,
      );
    },
    staleTime: 30_000,
  });

  // Progressive rolling loader: fetch pages 2..N in bounded batches (`concurrency = 2`)
  // and append cleanly into React Query cache without resetting Q1 or duplicating items.
  const bundleFetchId = query.data?.fetchId ?? 0;

  React.useEffect(() => {
    const queryKey = ["study-set-bundle", setId, maxQuestions] as const;
    const snapshot = queryClient.getQueryData<StudySetBundle>(queryKey);
    if (!enabled || !setId || !bundleFetchId || !snapshot?.isLoadingMore) return;

    const targetTotal = Math.min(snapshot.totalQuestions, maxQuestions);
    if (snapshot.questions.length >= targetTotal) return;

    const runId = ++streamingRunIdRef.current;
    const controller = new AbortController();

    const run = async () => {
      const firstPageSize = Math.min(STREAM_PAGE_SIZE, Math.max(1, maxQuestions));
      const totalPages = Math.ceil(targetTotal / firstPageSize);
      const startPage = Math.max(
        2,
        Math.floor(snapshot.questions.length / firstPageSize) + 1,
      );

      try {
        for (let page = startPage; page <= totalPages; page += STREAM_CONCURRENCY) {
          if (controller.signal.aborted || runId !== streamingRunIdRef.current) {
            return;
          }
          const batchPages: number[] = [];
          for (
            let p = page;
            p < page + STREAM_CONCURRENCY && p <= totalPages;
            p += 1
          ) {
            batchPages.push(p);
          }

          const batchResults = await Promise.all(
            batchPages.map((p) =>
              fetchStudySetQuestionsPage(setId, p, firstPageSize, controller.signal),
            ),
          );

          if (controller.signal.aborted || runId !== streamingRunIdRef.current) {
            return;
          }

          const combinedItems: HydratedStudyQuestion[] = [];
          let latestTotal = targetTotal;
          let batchEndedEarly = false;
          for (const res of batchResults) {
            combinedItems.push(...res.items);
            if (typeof res.total === "number") {
              latestTotal = Math.min(res.total, maxQuestions);
            }
            if (res.items.length < firstPageSize || !res.hasMore) {
              batchEndedEarly = true;
            }
          }

          const nextBatchStart = page + STREAM_CONCURRENCY;
          const stillMore = !batchEndedEarly && nextBatchStart <= totalPages;

          queryClient.setQueryData<StudySetBundle>(queryKey, (prev) => {
            if (!prev || prev.fetchId !== bundleFetchId) return prev;
            const remainingBudget = Math.max(0, maxQuestions - prev.questions.length);
            const sliceToAppend = combinedItems.slice(0, remainingBudget);
            return mergeStreamedPageIntoBundle(
              prev,
              sliceToAppend,
              latestTotal,
              stillMore && prev.questions.length + sliceToAppend.length < latestTotal,
            );
          });

          if (!stillMore) {
            break;
          }
        }
      } catch {
        // On abort or transient error, mark background loading stopped without clobbering Page 1
        if (!controller.signal.aborted && runId === streamingRunIdRef.current) {
          queryClient.setQueryData<StudySetBundle>(queryKey, (prev) =>
            prev && prev.fetchId === bundleFetchId
              ? { ...prev, isLoadingMore: false }
              : prev,
          );
        }
      }
    };

    void run();

    return () => {
      controller.abort();
    };
  }, [enabled, setId, maxQuestions, bundleFetchId, queryClient]);

  const toggleStar = React.useCallback(
    async (questionId: string) => {
      const queryKey = ["study-set-bundle", setId, maxQuestions];
      const previous = queryClient.getQueryData<StudySetBundle>(queryKey);

      // Optimistic toggle
      if (previous) {
        const nextSet = new Set(previous.starredIds);
        if (nextSet.has(questionId)) {
          nextSet.delete(questionId);
        } else {
          nextSet.add(questionId);
        }
        queryClient.setQueryData<StudySetBundle>(queryKey, {
          ...previous,
          starredIds: nextSet,
        });
      }

      try {
        await toggleStarQuestion(questionId, setId);
      } catch (err) {
        if (previous) {
          queryClient.setQueryData(queryKey, previous);
        }
        throw err;
      }
    },
    [maxQuestions, queryClient, setId],
  );

  const updateLocalProgress = React.useCallback(
    (progress: UserQuestionProgress) => {
      queryClient.setQueryData<StudySetBundle>(
        ["study-set-bundle", setId, maxQuestions],
        (prev) => {
          if (!prev) return prev;
          const nextMap = new Map(prev.progressMap);
          nextMap.set(progress.question_id, progress);
          return { ...prev, progressMap: nextMap };
        },
      );
    },
    [maxQuestions, queryClient, setId],
  );

  /**
   * Update a single question in-place inside React Query cache after contextual editing
   * (V32-053) without triggering a full refetch or resetting active study sessions.
   */
  const updateLocalQuestion = React.useCallback(
    (updated: Question) => {
      queryClient.setQueryData<StudySetBundle>(
        ["study-set-bundle", setId, maxQuestions],
        (prev) => {
          if (!prev) return prev;
          let replaced = false;
          const nextQuestions = prev.questions.map((q) => {
            if (q.id !== updated.id) return q;
            replaced = true;
            return {
              ...q,
              ...updated,
              is_starred: updated.is_starred ?? q.is_starred,
              progress: updated.progress ?? q.progress,
            };
          });
          if (!replaced) return prev;
          const nextChapters = new Set(prev.chapters);
          if (updated.chapter && updated.chapter.trim()) {
            nextChapters.add(updated.chapter.trim());
          }
          return {
            ...prev,
            questions: nextQuestions,
            chapters: Array.from(nextChapters),
          };
        },
      );
    },
    [maxQuestions, queryClient, setId],
  );

  const activeUserId = useAuthenticatedUserId();
  const canEdit = React.useMemo(
    () => resolveCanEditStudySet(query.data?.studySet, activeUserId),
    [query.data?.studySet, activeUserId],
  );

  return {
    ...query,
    canEdit,
    toggleStar,
    updateLocalProgress,
    updateLocalQuestion,
  };
}

/**
 * Multi-set RBAC helper for cross-set views (`CustomPracticeClient`, `ReviewMistakesClient`,
 * `StarredQuestionsClient`, `ExamResultsClient`).
 * Computes the set of study_set IDs the authenticated user owns OR has `editor` role on.
 */
export function useEditableSetIds(enabled = true) {
  const activeUserId = useAuthenticatedUserId();

  const editableQuery = useQuery<Set<string>>({
    queryKey: ["editable-study-set-ids", activeUserId ?? "anon"],
    enabled: enabled && Boolean(activeUserId),
    staleTime: 60_000,
    queryFn: async () => {
      const editable = new Set<string>();
      const [allSets, sharedRes] = await Promise.all([
        fetchAccessibleSets(10).catch(() => [] as StudySetWithAccess[]),
        fetch("/api/sets?scope=shared&page=1&pageSize=100")
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ]);

      for (const s of allSets as StudySetWithAccess[]) {
        if (resolveCanEditStudySet(s, activeUserId)) {
          editable.add(s.id);
        }
      }

      const sharedItems = Array.isArray(sharedRes?.data)
        ? (sharedRes.data as StudySetWithAccess[])
        : [];
      for (const s of sharedItems) {
        if (s.member_role === "editor" || s.member_role === "owner" || s.can_edit === true) {
          editable.add(s.id);
        }
      }
      return editable;
    },
  });

  const canEditSet = React.useCallback(
    (studySetId: string | null | undefined): boolean => {
      if (!studySetId) return false;
      return editableQuery.data?.has(studySetId) ?? false;
    },
    [editableQuery.data],
  );

  return {
    editableSetIds: editableQuery.data,
    canEditSet,
    isLoading: editableQuery.isLoading,
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
