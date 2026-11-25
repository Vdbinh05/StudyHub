"use client";

import * as React from "react";
import dynamic from "next/dynamic";
import type { Question, QuestionWithRelations } from "@/types/domain";

const LazyUnifiedQuestionEditorModal = dynamic(
  () =>
    import("@/components/editor/UnifiedQuestionEditorModal").then(
      (m) => m.UnifiedQuestionEditorModal,
    ),
  { ssr: false },
);

export interface ContextualQuestionEditorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  studySetId: string;
  questionId: string | null;
  initialQuestion?: Question | null;
  questionIds?: string[];
  currentIndex?: number;
  onNavigateQuestion?: (nextQuestionId: string, nextIndex: number) => void;
  onSaved?: (
    savedQuestion: QuestionWithRelations,
    action: "save" | "save_and_next",
  ) => void;
  contextNotice?: string | null;
  chapters?: string[];
}

/**
 * Lazy-loaded contextual wrapper around `UnifiedQuestionEditorModal` (V32-053).
 * Never downloads heavy TipTap/editor bundles until a user with owner/editor
 * permissions explicitly opens the contextual editor.
 */
export function ContextualQuestionEditorModal({
  open,
  onOpenChange,
  studySetId,
  questionId,
  initialQuestion,
  questionIds,
  currentIndex,
  onNavigateQuestion,
  onSaved,
  contextNotice,
  chapters,
}: ContextualQuestionEditorModalProps) {
  if (!open || !studySetId || !questionId) {
    return null;
  }

  const normalizedInitial: QuestionWithRelations | null = initialQuestion
    ? {
        ...initialQuestion,
        options: initialQuestion.options ?? [],
      }
    : null;

  return (
    <LazyUnifiedQuestionEditorModal
      open={open}
      onOpenChange={onOpenChange}
      studySetId={studySetId}
      questionId={questionId}
      initialQuestion={normalizedInitial}
      questionIds={questionIds}
      currentIndex={currentIndex}
      onNavigateQuestion={onNavigateQuestion}
      onSaved={onSaved}
      contextNotice={contextNotice}
      chapters={chapters}
    />
  );
}
