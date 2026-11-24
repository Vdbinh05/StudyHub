import type { Question } from "@/types/domain";

export interface ProjectedFlashcard {
  questionId: string;
  studySetId: string;
  chapter: string | null;
  frontText: string;
  frontImageUrl: string | null;
  backText: string;
  backImageUrl: string | null;
  explanation: string | null;
  hint: string | null;
  isProjectedFromMc: boolean;
}

/**
 * Project any StudyHub Question (flashcard, multiple-choice, true/false, short_answer)
 * deterministically into a clean front/back Flashcard representation.
 */
export function projectQuestionToFlashcard(question: Question): ProjectedFlashcard {
  const frontText = question.prompt.trim();
  const frontImageUrl = question.prompt_image_url ?? null;

  if (question.question_type === "flashcard" || (question.back_text && question.back_text.trim())) {
    return {
      questionId: question.id,
      studySetId: question.study_set_id,
      chapter: question.chapter,
      frontText,
      frontImageUrl,
      backText: question.back_text?.trim() || "",
      backImageUrl: question.back_image_url ?? null,
      explanation: question.explanation,
      hint: question.hint,
      isProjectedFromMc: false,
    };
  }

  if (question.accepted_answers && question.accepted_answers.length > 0) {
    return {
      questionId: question.id,
      studySetId: question.study_set_id,
      chapter: question.chapter,
      frontText,
      frontImageUrl,
      backText: question.accepted_answers.map((a) => a.answer_text).join(" / "),
      backImageUrl: null,
      explanation: question.explanation,
      hint: question.hint,
      isProjectedFromMc: false,
    };
  }

  const correctOptions = (question.options ?? []).filter((o) => o.is_correct);
  const backText =
    correctOptions.length > 0
      ? correctOptions.map((o) => o.content.trim()).join("\n")
      : "";

  return {
    questionId: question.id,
    studySetId: question.study_set_id,
    chapter: question.chapter,
    frontText,
    frontImageUrl,
    backText,
    backImageUrl: correctOptions[0]?.image_url ?? null,
    explanation: question.explanation,
    hint: question.hint,
    isProjectedFromMc: true,
  };
}
