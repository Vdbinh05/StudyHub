import type {
  ExamSnapshotOption,
  ExamSnapshotQuestion,
  FillInBlankPayload,
  ImageHotspotPayload,
  ListeningPayload,
  Locale,
  MatchingPayload,
  NumericalPayload,
  OrderingPayload,
  Question,
  QuestionOption,
  QuestionType,
  QuestionTypePayload,
  ReadingPassagePayload,
} from "@/types/domain";
import { getExpectedWriteAnswers } from "./write-grader";

export interface FormatAnswerQuestionLike {
  question_type: QuestionType;
  back_text?: string | null;
  options?: ReadonlyArray<
    Pick<QuestionOption, "id" | "label" | "content" | "image_url" | "is_correct"> & {
      image_alt?: string | null;
    }
  >;
  accepted_answers?: ReadonlyArray<{
    answer_text: string;
    normalized_answer?: string;
    match_mode?: "exact" | "case_insensitive" | "ignore_diacritics" | "numeric";
  }>;
  type_payload?: QuestionTypePayload | null;
}

export interface MediaImageCandidate {
  id?: string | null;
  media_id?: string | null;
  storage_path?: string | null;
  url?: string | null;
  proxy_url?: string | null;
  alt?: string | null;
  alt_text?: string | null;
  caption?: string | null;
  role?: string | null;
}

function normalizeImageDedupKey(rawUrl: string | null | undefined): string {
  if (!rawUrl) return "";
  const trimmed = rawUrl.trim();
  if (!trimmed) return "";

  try {
    const parsed = new URL(trimmed, "https://studyhub.local");
    // Proxy signed-url endpoints carry the underlying storage object path in `?path=...`
    const pathParam = parsed.searchParams.get("path");
    if (pathParam && pathParam.trim().length > 0) {
      return `path:${decodeURIComponent(pathParam).trim()}`;
    }
    const mediaIdParam = parsed.searchParams.get("mediaId");
    if (mediaIdParam && mediaIdParam.trim().length > 0) {
      return `media:${mediaIdParam.trim()}`;
    }
    // Strip transient cache-busting params when comparing direct URLs
    parsed.searchParams.delete("_r");
    parsed.searchParams.delete("token");
    return `url:${parsed.origin}${parsed.pathname}${parsed.search}`;
  } catch {
    return `raw:${trimmed}`;
  }
}

/**
 * Deduplicate a question's primary `promptImageUrl` against its `attachments` / `media_snapshot`
 * by `media_id`, `storage_path`, or normalized URL (fixes `RU-08` duplicate DOCX images in exams).
 */
export function dedupeQuestionMediaImages<T extends MediaImageCandidate>(
  promptImageUrl: string | null | undefined,
  attachments: readonly T[] | null | undefined,
): {
  promptImageUrl: string | null;
  attachments: T[];
} {
  const cleanPrompt =
    typeof promptImageUrl === "string" && promptImageUrl.trim().length > 0
      ? promptImageUrl.trim()
      : null;

  const seenKeys = new Set<string>();
  if (cleanPrompt) {
    seenKeys.add(normalizeImageDedupKey(cleanPrompt));
  }

  const deduped: T[] = [];
  for (const item of attachments ?? []) {
    const candidateKeys: string[] = [];
    if (item.media_id && item.media_id.trim()) {
      candidateKeys.push(`media:${item.media_id.trim()}`);
    }
    if (item.storage_path && item.storage_path.trim()) {
      candidateKeys.push(`path:${item.storage_path.trim()}`);
    }
    const resolvedUrl = item.proxy_url ?? item.url ?? null;
    if (resolvedUrl && resolvedUrl.trim()) {
      candidateKeys.push(normalizeImageDedupKey(resolvedUrl));
    }

    if (candidateKeys.length === 0) continue;
    if (candidateKeys.some((key) => seenKeys.has(key))) {
      continue;
    }

    for (const key of candidateKeys) {
      seenKeys.add(key);
    }
    deduped.push(item);
  }

  return {
    promptImageUrl: cleanPrompt,
    attachments: deduped,
  };
}

/**
 * Determine whether a question (either Study `Question` or Exam `ExamSnapshotQuestion`)
 * expects multiple selected options rather than a single selection.
 */
export function isMultiSelectChoiceQuestion(question: {
  question_type: QuestionType;
  type_payload?: QuestionTypePayload | null;
  type_payload_snapshot?: QuestionTypePayload | null;
  options?: ReadonlyArray<{ is_correct?: boolean }>;
  correct_option_ids?: readonly string[];
}): boolean {
  const payload = question.type_payload ?? question.type_payload_snapshot ?? null;

  if (question.question_type === "multiple_choice") {
    return true;
  }

  if (question.question_type === "image_choice") {
    if (payload && payload.type === "image_choice") {
      return payload.selection_mode === "multiple";
    }
    const correctCount =
      question.correct_option_ids?.length ??
      (question.options ?? []).filter((o) => Boolean(o.is_correct)).length;
    return correctCount > 1;
  }

  if (question.question_type === "reading_passage") {
    return (
      Boolean(payload && payload.type === "reading_passage" && payload.sub_answer_kind === "multiple_choice")
    );
  }

  if (question.question_type === "listening") {
    return (
      Boolean(payload && payload.type === "listening" && payload.sub_answer_kind === "multiple_choice")
    );
  }

  return false;
}

function formatCorrectOptionsText(
  options: FormatAnswerQuestionLike["options"],
  locale: Locale,
  includeLabelForImageOnly = false,
): string {
  const correctOpts = (options ?? []).filter((o) => o.is_correct);
  if (correctOpts.length === 0) return "";
  const imageLabel = locale === "vi" ? "Hình ảnh" : "Image";

  return correctOpts
    .map((o) => {
      const content = o.content?.trim() ?? "";
      if (content.length > 0) {
        return includeLabelForImageOnly && o.label
          ? `${o.label}. ${content}`
          : content;
      }
      if (o.image_url) {
        const alt = o.image_alt?.trim();
        const labelPrefix = o.label ? `${o.label}. ` : "";
        return `${labelPrefix}[${alt || imageLabel}]`;
      }
      return o.label?.trim() ?? "";
    })
    .filter(Boolean)
    .join(" · ");
}

function formatAcceptedWriteText(question: FormatAnswerQuestionLike): string {
  const expected = getExpectedWriteAnswers({
    question_type: question.question_type,
    back_text: question.back_text ?? null,
    accepted_answers: (question.accepted_answers ?? []) as Question["accepted_answers"],
    options: (question.options ?? []) as Question["options"],
  });
  return expected
    .map((item) => item.answer_text.trim())
    .filter(Boolean)
    .join(" / ");
}

/**
 * Format the canonical correct answer for ALL 12 V3 question types (+ flashcard)
 * into crisp, human-readable text. Never prints `[object Object]`.
 */
export function formatCorrectAnswerDisplay(
  question: FormatAnswerQuestionLike,
  locale: Locale = "vi",
): string {
  const payload = question.type_payload ?? null;
  const imageFallback = locale === "vi" ? "Hình ảnh" : "Image";

  switch (question.question_type) {
    case "single_choice":
    case "multiple_choice":
    case "true_false": {
      const opts = formatCorrectOptionsText(question.options, locale, false);
      if (opts) return opts;
      return formatAcceptedWriteText(question);
    }

    case "image_choice": {
      const opts = formatCorrectOptionsText(question.options, locale, true);
      if (opts) return opts;
      return formatAcceptedWriteText(question);
    }

    case "short_answer": {
      const accepted = (question.accepted_answers ?? [])
        .map((a) => a.answer_text.trim())
        .filter(Boolean);
      if (accepted.length > 0) return accepted.join(" / ");
      if (question.back_text?.trim()) return question.back_text.trim();
      return formatCorrectOptionsText(question.options, locale, false);
    }

    case "flashcard": {
      if (question.back_text?.trim()) return question.back_text.trim();
      const accepted = (question.accepted_answers ?? [])
        .map((a) => a.answer_text.trim())
        .filter(Boolean);
      if (accepted.length > 0) return accepted.join(" / ");
      return formatCorrectOptionsText(question.options, locale, false);
    }

    case "numerical": {
      if (payload && payload.type === "numerical") {
        const numPayload = payload as NumericalPayload;
        const unitStr = numPayload.unit?.trim() ? ` ${numPayload.unit.trim()}` : "";
        const base = `${numPayload.correct_value}${unitStr}`;
        if (
          typeof numPayload.abs_tolerance === "number" &&
          numPayload.abs_tolerance > 0
        ) {
          return `${base} (±${numPayload.abs_tolerance})`;
        }
        if (
          typeof numPayload.rel_tolerance === "number" &&
          numPayload.rel_tolerance > 0
        ) {
          const pct = Math.round(numPayload.rel_tolerance * 1000) / 10;
          return `${base} (±${pct}%)`;
        }
        return base;
      }
      return formatAcceptedWriteText(question);
    }

    case "fill_in_blank": {
      if (payload && payload.type === "fill_in_blank") {
        const fibPayload = payload as FillInBlankPayload;
        const blanks = fibPayload.blanks ?? [];
        if (blanks.length === 1) {
          return (blanks[0].accepted_answers ?? [])
            .map((a) => a.trim())
            .filter(Boolean)
            .join(" / ");
        }
        if (blanks.length > 1) {
          return blanks
            .map((blank, idx) => {
              const vals = (blank.accepted_answers ?? [])
                .map((a) => a.trim())
                .filter(Boolean)
                .join(" / ");
              return vals ? `[${idx + 1}] ${vals}` : "";
            })
            .filter(Boolean)
            .join(" · ");
        }
      }
      return formatAcceptedWriteText(question);
    }

    case "ordering": {
      if (payload && payload.type === "ordering") {
        const ordPayload = payload as OrderingPayload;
        const sorted = [...(ordPayload.items ?? [])].sort(
          (a, b) => a.correct_position - b.correct_position,
        );
        return sorted
          .map((item, idx) => {
            const label = item.text?.trim() || `[${imageFallback}]`;
            return `${idx + 1}. ${label}`;
          })
          .join(" → ");
      }
      return formatAcceptedWriteText(question);
    }

    case "matching": {
      if (payload && payload.type === "matching") {
        const matchPayload = payload as MatchingPayload;
        return (matchPayload.pairs ?? [])
          .map((pair) => {
            const left = pair.left_text?.trim() || `[${imageFallback}]`;
            const right = pair.right_text?.trim() || `[${imageFallback}]`;
            return `${left} → ${right}`;
          })
          .join(" · ");
      }
      return formatAcceptedWriteText(question);
    }

    case "image_hotspot": {
      if (payload && payload.type === "image_hotspot") {
        const hsPayload = payload as ImageHotspotPayload;
        const labels = (hsPayload.target_hotspots ?? [])
          .map((t) => t.label?.trim() || t.id)
          .filter(Boolean);
        if (labels.length > 0) {
          return labels.join(", ");
        }
      }
      return formatAcceptedWriteText(question);
    }

    case "reading_passage": {
      const rpPayload =
        payload && payload.type === "reading_passage"
          ? (payload as ReadingPassagePayload)
          : null;
      if (rpPayload?.sub_answer_kind === "short_answer") {
        const accepted = (question.accepted_answers ?? [])
          .map((a) => a.answer_text.trim())
          .filter(Boolean);
        if (accepted.length > 0) return accepted.join(" / ");
        if (question.back_text?.trim()) return question.back_text.trim();
      }
      const opts = formatCorrectOptionsText(question.options, locale, false);
      if (opts) return opts;
      return formatAcceptedWriteText(question);
    }

    case "listening": {
      const listenPayload =
        payload && payload.type === "listening"
          ? (payload as ListeningPayload & { blanks?: FillInBlankPayload["blanks"] })
          : null;
      if (listenPayload?.sub_answer_kind === "fill_in_blank") {
        const blanks = listenPayload.blanks ?? [];
        if (blanks.length === 1) {
          return (blanks[0].accepted_answers ?? [])
            .map((a) => a.trim())
            .filter(Boolean)
            .join(" / ");
        }
        if (blanks.length > 1) {
          return blanks
            .map((blank, idx) => {
              const vals = (blank.accepted_answers ?? [])
                .map((a) => a.trim())
                .filter(Boolean)
                .join(" / ");
              return vals ? `[${idx + 1}] ${vals}` : "";
            })
            .filter(Boolean)
            .join(" · ");
        }
      }
      if (
        listenPayload?.sub_answer_kind === "short_answer" ||
        listenPayload?.sub_answer_kind === "fill_in_blank"
      ) {
        const accepted = (question.accepted_answers ?? [])
          .map((a) => a.answer_text.trim())
          .filter(Boolean);
        if (accepted.length > 0) return accepted.join(" / ");
        if (question.back_text?.trim()) return question.back_text.trim();
      }
      const opts = formatCorrectOptionsText(question.options, locale, false);
      if (opts) return opts;
      return formatAcceptedWriteText(question);
    }

    default:
      return formatAcceptedWriteText(question);
  }
}

/**
 * Helper to adapt an `ExamSnapshotQuestion` (post-submit) for `formatCorrectAnswerDisplay`.
 */
export function formatExamSnapshotCorrectAnswer(
  question: ExamSnapshotQuestion,
  locale: Locale = "vi",
): string {
  const correctSet = new Set(question.correct_option_ids ?? []);
  const options = (question.options_snapshot ?? []).map((opt: ExamSnapshotOption) => ({
    id: opt.id,
    label: opt.label,
    content: opt.content,
    image_url: opt.image_url,
    image_alt: opt.image_alt ?? null,
    is_correct: correctSet.has(opt.id),
  }));

  return formatCorrectAnswerDisplay(
    {
      question_type: question.question_type,
      options,
      accepted_answers: question.accepted_answers_snapshot ?? [],
      type_payload: question.type_payload_snapshot ?? null,
    },
    locale,
  );
}
