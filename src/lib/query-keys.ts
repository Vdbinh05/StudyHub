import type { QueryClient } from "@tanstack/react-query";

/**
 * Centralized React Query key factories and invalidation helpers.
 * Ensures study sets, learning sessions, exams, and offline sync never leave
 * fragmented or stale client caches across StudyHub routes.
 */
export const queryKeys = {
  currentProfile: ["current-profile"] as const,
  profileDetail: ["profile-detail"] as const,
  userPreferences: ["user-preferences"] as const,
  dashboard: ["dashboard"] as const,
  statistics: ["statistics"] as const,
  studySets: ["study-sets"] as const,
  accessibleSets: ["accessible-sets"] as const,
  accessibleSetsAll: ["accessible-sets-all"] as const,
  importHubSets: ["import-hub-sets"] as const,
  folders: ["folders"] as const,
  folderSets: (folderId?: string) =>
    folderId ? (["folder-sets", folderId] as const) : (["folder-sets"] as const),
  studySet: (studySetId: string) => ["study-set", studySetId] as const,
  studySetMeta: (studySetId: string) => ["study-set-meta", studySetId] as const,
  setQuestions: (studySetId: string) => ["set-questions", studySetId] as const,
  editorQuestions: (studySetId: string) =>
    ["editor-questions", studySetId] as const,
  studySetBundle: (studySetId: string) =>
    ["study-set-bundle", studySetId] as const,
  setDiagrams: (studySetId: string) => ["set-diagrams", studySetId] as const,
  studySetDiagrams: (studySetId: string) =>
    ["study-set-diagrams", studySetId] as const,
  setPassages: (studySetId: string) => ["set-passages", studySetId] as const,
  setCheckpoints: (studySetId?: string) =>
    studySetId
      ? (["set-checkpoints", studySetId] as const)
      : (["set-checkpoints"] as const),
  checkpoints: ["checkpoints"] as const,
  progress: ["progress"] as const,
  reviewMistakes: ["review-mistakes-v3"] as const,
  reviewDue: ["review-due"] as const,
  reviewRecentExams: ["review-recent-exams"] as const,
  starredQuestions: ["starred-questions"] as const,
  historySessions: ["history-sessions"] as const,
  historyExams: ["history-exams"] as const,
  examsHubInProgress: ["exams-hub-in-progress"] as const,
  examsHubRecent: ["exams-hub-recent"] as const,
  inProgressExams: (studySetId?: string) =>
    studySetId
      ? (["in-progress-exams", studySetId] as const)
      : (["in-progress-exams"] as const),
  coverageCycles: ["coverage-cycles"] as const,
  examAttempt: (attemptId?: string) =>
    attemptId
      ? (["exam-attempt", attemptId] as const)
      : (["exam-attempt"] as const),
  examAttemptLive: (attemptId?: string) =>
    attemptId
      ? (["exam-attempt-live", attemptId] as const)
      : (["exam-attempt-live"] as const),
  examResult: (attemptId?: string) =>
    attemptId
      ? (["exam-result", attemptId] as const)
      : (["exam-result"] as const),
} as const;

/**
 * Invalidate all React Query caches tied to a study set after creating, editing,
 * importing, bulk-modifying, or deleting questions/metadata.
 */
export async function invalidateStudySetCaches(
  queryClient: QueryClient,
  studySetId: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["study-set", studySetId] }),
    queryClient.invalidateQueries({ queryKey: ["study-set-meta", studySetId] }),
    queryClient.invalidateQueries({ queryKey: ["set-questions", studySetId] }),
    queryClient.invalidateQueries({
      queryKey: ["editor-questions", studySetId],
    }),
    queryClient.invalidateQueries({
      queryKey: ["study-set-bundle", studySetId],
    }),
    queryClient.invalidateQueries({ queryKey: ["set-diagrams", studySetId] }),
    queryClient.invalidateQueries({
      queryKey: ["study-set-diagrams", studySetId],
    }),
    queryClient.invalidateQueries({ queryKey: ["set-passages", studySetId] }),
    queryClient.invalidateQueries({ queryKey: ["study-sets"] }),
    queryClient.invalidateQueries({ queryKey: ["accessible-sets"] }),
    queryClient.invalidateQueries({ queryKey: ["accessible-sets-all"] }),
    queryClient.invalidateQueries({ queryKey: ["import-hub-sets"] }),
    queryClient.invalidateQueries({ queryKey: ["folder-sets"] }),
    queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
  ]);
}

/**
 * Invalidate learning checkpoints, progress, mistakes, starred items, and dashboard
 * caches after answering questions, resetting progress, or flushing offline sync.
 */
export async function invalidateLearningCaches(
  queryClient: QueryClient,
  studySetId?: string,
): Promise<void> {
  const tasks: Promise<void>[] = [
    queryClient.invalidateQueries({
      queryKey: studySetId
        ? ["set-checkpoints", studySetId]
        : ["set-checkpoints"],
    }),
    queryClient.invalidateQueries({ queryKey: ["checkpoints"] }),
    queryClient.invalidateQueries({ queryKey: ["progress"] }),
    queryClient.invalidateQueries({ queryKey: ["review-mistakes-v3"] }),
    queryClient.invalidateQueries({ queryKey: ["review-due"] }),
    queryClient.invalidateQueries({ queryKey: ["starred-questions"] }),
    queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
    queryClient.invalidateQueries({ queryKey: ["statistics"] }),
    queryClient.invalidateQueries({ queryKey: ["history-sessions"] }),
  ];

  if (studySetId) {
    tasks.push(
      queryClient.invalidateQueries({ queryKey: ["study-set", studySetId] }),
      queryClient.invalidateQueries({
        queryKey: ["study-set-bundle", studySetId],
      }),
      queryClient.invalidateQueries({
        queryKey: ["set-questions", studySetId],
      }),
    );
  }

  await Promise.all(tasks);
}

/**
 * Invalidate live exam, results, history, coverage cycle, mistakes, and dashboard
 * caches after submitting or discarding an exam attempt.
 */
export async function invalidateExamCaches(
  queryClient: QueryClient,
  attemptId?: string,
): Promise<void> {
  const tasks: Promise<void>[] = [
    queryClient.invalidateQueries({
      queryKey: attemptId ? ["exam-attempt", attemptId] : ["exam-attempt"],
    }),
    queryClient.invalidateQueries({
      queryKey: attemptId
        ? ["exam-attempt-live", attemptId]
        : ["exam-attempt-live"],
    }),
    queryClient.invalidateQueries({
      queryKey: attemptId ? ["exam-result", attemptId] : ["exam-result"],
    }),
    queryClient.invalidateQueries({ queryKey: ["dashboard"] }),
    queryClient.invalidateQueries({ queryKey: ["history-exams"] }),
    queryClient.invalidateQueries({ queryKey: ["exams-hub-in-progress"] }),
    queryClient.invalidateQueries({ queryKey: ["exams-hub-recent"] }),
    queryClient.invalidateQueries({ queryKey: ["in-progress-exams"] }),
    queryClient.invalidateQueries({ queryKey: ["coverage-cycles"] }),
    queryClient.invalidateQueries({ queryKey: ["review-mistakes-v3"] }),
    queryClient.invalidateQueries({ queryKey: ["review-recent-exams"] }),
    queryClient.invalidateQueries({ queryKey: ["statistics"] }),
  ];

  await Promise.all(tasks);
}
