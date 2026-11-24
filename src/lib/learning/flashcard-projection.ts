import type { ContentMediaRelation, Question, RichTextDoc } from "@/types/domain";

export interface ProjectedFlashcard {
  questionId: string;
  studySetId: string;
  chapter: string | null;
  frontText: string;
  frontRich?: RichTextDoc | null;
  frontImageUrl: string | null;
  frontAudioUrl?: string | null;
  frontMedia?: ContentMediaRelation[];
  backText: string;
  backRich?: RichTextDoc | null;
  backImageUrl: string | null;
  backAudioUrl?: string | null;
  backMedia?: ContentMediaRelation[];
  explanation: string | null;
  explanationRich?: RichTextDoc | null;
  hint: string | null;
  hintRich?: RichTextDoc | null;
  isProjectedFromMc: boolean;
}

/**
 * Project any StudyHub V1/V2/V3 Question deterministically into a clean multimedia
 * front/back Flashcard representation with Rich Text AST, image galleries, and independent audio.
 */
export function projectQuestionToFlashcard(question: Question): ProjectedFlashcard {
  const frontText = question.prompt.trim();
  const frontRich = question.prompt_rich ?? null;
  const frontImageUrl = question.prompt_image_url ?? null;

  const attachments = question.media_attachments ?? [];
  const frontMedia = attachments.filter(
    (m) => m.role === "prompt" || m.role === "diagram_base" || m.role === "passage",
  );
  const backMedia = attachments.filter(
    (m) => m.role === "back" || m.role === "explanation",
  );
  const audioAttachments = attachments.filter((m) => m.role === "audio");
  const frontAudioUrl =
    question.audio_url ??
    (question.type_payload?.type === "listening"
      ? question.type_payload.audio_url ?? null
      : null) ??
    audioAttachments[0]?.media?.proxy_url ??
    null;
  const backAudioUrl = audioAttachments[1]?.media?.proxy_url ?? null;

  if (
    question.question_type === "flashcard" ||
    (question.back_text && question.back_text.trim()) ||
    question.back_rich
  ) {
    return {
      questionId: question.id,
      studySetId: question.study_set_id,
      chapter: question.chapter,
      frontText,
      frontRich,
      frontImageUrl,
      frontAudioUrl,
      frontMedia,
      backText: question.back_text?.trim() || "",
      backRich: question.back_rich ?? null,
      backImageUrl: question.back_image_url ?? null,
      backAudioUrl,
      backMedia,
      explanation: question.explanation,
      explanationRich: question.explanation_rich ?? null,
      hint: question.hint,
      hintRich: question.hint_rich ?? null,
      isProjectedFromMc: false,
    };
  }

  // Numerical payload projection
  if (question.type_payload?.type === "numerical") {
    const unit = question.type_payload.unit ? ` ${question.type_payload.unit}` : "";
    return {
      questionId: question.id,
      studySetId: question.study_set_id,
      chapter: question.chapter,
      frontText,
      frontRich,
      frontImageUrl,
      frontAudioUrl,
      frontMedia,
      backText: `${question.type_payload.correct_value}${unit}`,
      backRich: null,
      backImageUrl: question.back_image_url ?? null,
      backAudioUrl,
      backMedia,
      explanation: question.explanation,
      explanationRich: question.explanation_rich ?? null,
      hint: question.hint,
      hintRich: question.hint_rich ?? null,
      isProjectedFromMc: false,
    };
  }

  // Ordering payload projection
  if (question.type_payload?.type === "ordering") {
    const ordered = [...question.type_payload.items].sort(
      (a, b) => a.correct_position - b.correct_position,
    );
    return {
      questionId: question.id,
      studySetId: question.study_set_id,
      chapter: question.chapter,
      frontText,
      frontRich,
      frontImageUrl,
      frontAudioUrl,
      frontMedia,
      backText: ordered.map((item, idx) => `${idx + 1}. ${item.text}`).join("\n"),
      backRich: null,
      backImageUrl: null,
      backAudioUrl,
      backMedia,
      explanation: question.explanation,
      explanationRich: question.explanation_rich ?? null,
      hint: question.hint,
      hintRich: question.hint_rich ?? null,
      isProjectedFromMc: false,
    };
  }

  // Matching payload projection
  if (question.type_payload?.type === "matching") {
    return {
      questionId: question.id,
      studySetId: question.study_set_id,
      chapter: question.chapter,
      frontText,
      frontRich,
      frontImageUrl,
      frontAudioUrl,
      frontMedia,
      backText: question.type_payload.pairs
        .map((p) => `${p.left_text} → ${p.right_text}`)
        .join("\n"),
      backRich: null,
      backImageUrl: null,
      backAudioUrl,
      backMedia,
      explanation: question.explanation,
      explanationRich: question.explanation_rich ?? null,
      hint: question.hint,
      hintRich: question.hint_rich ?? null,
      isProjectedFromMc: false,
    };
  }

  // Fill-in-the-blank payload projection
  if (question.type_payload?.type === "fill_in_blank") {
    return {
      questionId: question.id,
      studySetId: question.study_set_id,
      chapter: question.chapter,
      frontText,
      frontRich,
      frontImageUrl,
      frontAudioUrl,
      frontMedia,
      backText: question.type_payload.blanks
        .map((b, idx) => `(${idx + 1}) ${b.accepted_answers.join(" / ")}`)
        .join("\n"),
      backRich: null,
      backImageUrl: null,
      backAudioUrl,
      backMedia,
      explanation: question.explanation,
      explanationRich: question.explanation_rich ?? null,
      hint: question.hint,
      hintRich: question.hint_rich ?? null,
      isProjectedFromMc: false,
    };
  }

  // Image hotspot payload projection
  if (question.type_payload?.type === "image_hotspot") {
    return {
      questionId: question.id,
      studySetId: question.study_set_id,
      chapter: question.chapter,
      frontText,
      frontRich,
      frontImageUrl: frontImageUrl ?? question.type_payload.image_url ?? null,
      frontAudioUrl,
      frontMedia,
      backText: question.type_payload.target_hotspots
        .map((h) => h.label)
        .join(", "),
      backRich: null,
      backImageUrl: question.type_payload.image_url ?? null,
      backAudioUrl,
      backMedia,
      explanation: question.explanation,
      explanationRich: question.explanation_rich ?? null,
      hint: question.hint,
      hintRich: question.hint_rich ?? null,
      isProjectedFromMc: false,
    };
  }

  if (question.accepted_answers && question.accepted_answers.length > 0) {
    return {
      questionId: question.id,
      studySetId: question.study_set_id,
      chapter: question.chapter,
      frontText,
      frontRich,
      frontImageUrl,
      frontAudioUrl,
      frontMedia,
      backText: question.accepted_answers.map((a) => a.answer_text).join(" / "),
      backRich: null,
      backImageUrl: null,
      backAudioUrl,
      backMedia,
      explanation: question.explanation,
      explanationRich: question.explanation_rich ?? null,
      hint: question.hint,
      hintRich: question.hint_rich ?? null,
      isProjectedFromMc: false,
    };
  }

  const correctOptions = (question.options ?? []).filter((o) => o.is_correct);
  const backText =
    correctOptions.length > 0
      ? correctOptions
          .map((o) => o.content.trim() || o.label)
          .filter(Boolean)
          .join("\n")
      : "";

  return {
    questionId: question.id,
    studySetId: question.study_set_id,
    chapter: question.chapter,
    frontText,
    frontRich,
    frontImageUrl,
    frontAudioUrl,
    frontMedia,
    backText,
    backRich:
      correctOptions.length === 1 ? (correctOptions[0].content_rich ?? null) : null,
    backImageUrl: correctOptions[0]?.image_url ?? null,
    backAudioUrl,
    backMedia,
    explanation: question.explanation,
    explanationRich: question.explanation_rich ?? null,
    hint: question.hint,
    hintRich: question.hint_rich ?? null,
    isProjectedFromMc: true,
  };
}
