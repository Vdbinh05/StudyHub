import type {
  ImportPreviewSummary,
  ImportValidationIssue,
  ImportValidationIssueCode,
  ParsedQuestion,
} from "@/types/import";
import { generateStableId, normalizeForComparison } from "./text-utils";

const VALIDATOR_MANAGED_CODES = new Set<ImportValidationIssueCode>([
  "EMPTY_PROMPT",
  "TOO_FEW_OPTIONS",
  "NO_CORRECT_ANSWER",
  "DUPLICATE_OPTIONS",
  "EMPTY_FLASHCARD_BACK",
  "DUPLICATE_QUESTION_IN_BATCH",
]);

/**
 * Deterministically validate a single ParsedQuestion.
 * Idempotent: clears previously generated validator-managed issues and re-evaluates
 * while preserving parser-emitted diagnostic issues (e.g. ANSWER_SIGNAL_CONFLICT).
 */
export function validateParsedQuestion(
  question: ParsedQuestion,
  index: number,
  options?: { isDuplicate?: boolean; duplicateReason?: string },
): ParsedQuestion {
  const preservedIssues = question.issues.filter(
    (issue) => !VALIDATOR_MANAGED_CODES.has(issue.code),
  );
  const newIssues: ImportValidationIssue[] = [];

  const trimmedPrompt = question.prompt.trim();
  if (!trimmedPrompt) {
    newIssues.push({
      id: generateStableId(),
      code: "EMPTY_PROMPT",
      severity: "error",
      questionIndex: index,
      message: `Question #${index + 1} has an empty prompt.`,
    });
  }

  const isChoice =
    question.questionType === "single_choice" ||
    question.questionType === "multiple_choice" ||
    question.questionType === "true_false" ||
    question.questionType === "image_choice";

  if (isChoice) {
    const nonEmptyOptions = question.options.filter(
      (opt) =>
        opt.content.trim().length > 0 ||
        Boolean(opt.imageUrl?.trim()) ||
        (opt.media !== undefined && opt.media.length > 0),
    );
    if (nonEmptyOptions.length < 2) {
      newIssues.push({
        id: generateStableId(),
        code: "TOO_FEW_OPTIONS",
        severity: "error",
        questionIndex: index,
        message: `Question #${index + 1} has fewer than 2 non-empty options (${nonEmptyOptions.length} found).`,
      });
    }

    // Detect duplicate options within the same question
    const seenOptionTexts = new Map<string, number>();
    question.options.forEach((opt, optIdx) => {
      const norm = normalizeForComparison(opt.content);
      if (!norm) return;
      if (seenOptionTexts.has(norm)) {
        newIssues.push({
          id: generateStableId(),
          code: "DUPLICATE_OPTIONS",
          severity: "warning",
          questionIndex: index,
          optionIndex: optIdx,
          message: `Option ${opt.label} duplicates option ${question.options[seenOptionTexts.get(norm)!]?.label ?? ""}.`,
        });
      } else {
        seenOptionTexts.set(norm, optIdx);
      }
    });

    const correctCount = question.options.filter((opt) => opt.isCorrect).length;
    if (correctCount === 0) {
      newIssues.push({
        id: generateStableId(),
        code: "NO_CORRECT_ANSWER",
        severity: "error",
        questionIndex: index,
        message: `Question #${index + 1} has no correct answer marked.`,
      });
    }
  } else if (question.questionType === "flashcard") {
    if (!question.backText || question.backText.trim().length === 0) {
      newIssues.push({
        id: generateStableId(),
        code: "EMPTY_FLASHCARD_BACK",
        severity: "error",
        questionIndex: index,
        message: `Flashcard #${index + 1} is missing back/definition text.`,
      });
    }
  } else if (question.questionType === "short_answer") {
    const hasAccepted =
      (question.acceptedAnswers?.some((a) => a.answerText.trim().length > 0) ??
        false) ||
      Boolean(question.backText && question.backText.trim().length > 0);
    if (!hasAccepted) {
      newIssues.push({
        id: generateStableId(),
        code: "NO_CORRECT_ANSWER",
        severity: "error",
        questionIndex: index,
        message: `Short-answer question #${index + 1} has no accepted answer.`,
      });
    }
  }

  const isDuplicate = Boolean(options?.isDuplicate);
  if (isDuplicate) {
    newIssues.push({
      id: generateStableId(),
      code: "DUPLICATE_QUESTION_IN_BATCH",
      severity: "warning",
      questionIndex: index,
      message:
        options?.duplicateReason ??
        `Question #${index + 1} duplicates an earlier question.`,
    });
  }

  // Ensure questionIndex is aligned on all preserved issues
  const alignedPreserved = preservedIssues.map((issue) => ({
    ...issue,
    questionIndex: index,
  }));

  return {
    ...question,
    index,
    isDuplicate,
    issues: [...alignedPreserved, ...newIssues],
  };
}

export interface ValidateBatchOptions {
  /** Legacy plain prompts already existing in the target Study Set */
  existingPrompts?: readonly string[];
  /** Full duplicate fingerprints (`computeQuestionDuplicateFingerprint`) already in target Study Set */
  existingFingerprints?: readonly string[];
  globalIssues?: readonly ImportValidationIssue[];
}

export interface ValidateBatchResult {
  questions: ParsedQuestion[];
  issues: ImportValidationIssue[];
  summary: ImportPreviewSummary;
  detectedChapters: string[];
}

/**
 * Compute a deterministic duplicate fingerprint for a question using:
 *   normalizedPrompt + normalizedSortedOptions + normalizedSortedCorrectAnswers
 * (or normalizedPrompt + normalizedAcceptedAnswers/backText for flashcards & short answer).
 *
 * Two questions that share a short stem (e.g. "Which cloud type is shown?") but have
 * distinct options or different correct answers will NEVER falsely collide.
 */
export function computeQuestionDuplicateFingerprint(input: {
  prompt: string;
  promptImageUrl?: string | null;
  promptMedia?: readonly { fileName?: string; rId?: string }[];
  backText?: string | null;
  options?: readonly {
    content: string;
    isCorrect: boolean;
    imageUrl?: string | null;
    media?: readonly { fileName?: string; rId?: string }[];
  }[];
  acceptedAnswers?: readonly { answerText: string }[];
}): string {
  const normPrompt = normalizeForComparison(input.prompt);
  if (!normPrompt) return "";

  const promptMediaTokens: string[] = [];
  if (input.promptImageUrl?.trim()) {
    promptMediaTokens.push(input.promptImageUrl.trim().toLowerCase());
  }
  for (const m of input.promptMedia ?? []) {
    const token = (m.fileName ?? m.rId ?? "").trim().toLowerCase();
    if (token) promptMediaTokens.push(token);
  }
  const promptMediaSig =
    promptMediaTokens.length > 0
      ? `::pm[${Array.from(new Set(promptMediaTokens)).sort().join(",")}]`
      : "";

  const normalizedOptions = (input.options ?? [])
    .map((opt) => {
      const text = normalizeForComparison(opt.content);
      const mediaSig = [
        opt.imageUrl?.trim().toLowerCase() ?? "",
        ...(opt.media ?? []).map((m) => (m.fileName ?? m.rId ?? "").trim().toLowerCase()),
      ]
        .filter(Boolean)
        .sort()
        .join(",");
      const combined = mediaSig ? `${text}[img:${mediaSig}]` : text;
      return {
        text: combined,
        isCorrect: Boolean(opt.isCorrect),
      };
    })
    .filter((opt) => opt.text.length > 0);

  if (normalizedOptions.length > 0) {
    const sortedOptions = normalizedOptions
      .map((o) => o.text)
      .sort()
      .join("\u001f");
    const sortedCorrect = normalizedOptions
      .filter((o) => o.isCorrect)
      .map((o) => o.text)
      .sort()
      .join("\u001f");
    return `choice::${normPrompt}${promptMediaSig}::${sortedOptions}::${sortedCorrect}`;
  }

  const sortedAccepted = (input.acceptedAnswers ?? [])
    .map((a) => normalizeForComparison(a.answerText))
    .filter(Boolean)
    .sort()
    .join("\u001f");
  const normBack = normalizeForComparison(input.backText ?? "");
  return `text::${normPrompt}${promptMediaSig}::${sortedAccepted || normBack}`;
}

/**
 * Validate an entire parsed question batch deterministically:
 * - Preserves original question order
 * - Detects genuine duplicates (prompt + options + correct answer) within batch
 *   AND against existing study set fingerprints/prompts
 * - Computes accurate summary counters
 */
export function validateImportBatch(
  questions: readonly ParsedQuestion[],
  options: ValidateBatchOptions = {},
): ValidateBatchResult {
  const existingPromptSet = new Set<string>();
  if (options.existingPrompts) {
    for (const p of options.existingPrompts) {
      const norm = normalizeForComparison(p);
      if (norm) existingPromptSet.add(norm);
    }
  }

  const existingFingerprintSet = new Set<string>();
  if (options.existingFingerprints) {
    for (const fp of options.existingFingerprints) {
      if (fp) existingFingerprintSet.add(fp);
    }
  }

  const seenInBatch = new Map<string, number>();
  const validatedQuestions: ParsedQuestion[] = [];
  const chaptersSet = new Set<string>();

  for (let i = 0; i < questions.length; i += 1) {
    const q = questions[i];
    if (q.chapter && q.chapter.trim()) {
      chaptersSet.add(q.chapter.trim());
    }

    const normPrompt = normalizeForComparison(q.prompt);
    const fingerprint = computeQuestionDuplicateFingerprint({
      prompt: q.prompt,
      promptImageUrl: q.promptImageUrl,
      promptMedia: q.promptMedia,
      backText: q.backText,
      options: q.options,
      acceptedAnswers: q.acceptedAnswers,
    });

    let isDuplicate = false;
    let duplicateReason: string | undefined;

    if (fingerprint) {
      if (
        existingFingerprintSet.has(fingerprint) ||
        (normPrompt && existingPromptSet.has(normPrompt))
      ) {
        isDuplicate = true;
        duplicateReason = `Question #${i + 1} already exists in this study set.`;
      } else if (seenInBatch.has(fingerprint)) {
        isDuplicate = true;
        duplicateReason = `Question #${i + 1} duplicates question #${seenInBatch.get(fingerprint)! + 1} in this import batch.`;
      } else {
        seenInBatch.set(fingerprint, i);
      }
    }

    validatedQuestions.push(
      validateParsedQuestion(q, i, { isDuplicate, duplicateReason }),
    );
  }

  const summary = computeImportSummary(validatedQuestions);
  const allIssues: ImportValidationIssue[] = [
    ...(options.globalIssues ?? []),
    ...validatedQuestions.flatMap((q) => q.issues),
  ];

  return {
    questions: validatedQuestions,
    issues: allIssues,
    summary,
    detectedChapters: Array.from(chaptersSet),
  };
}

/**
 * Compute deterministic summary metrics for Step 4 Preview & ImportJob diagnostics.
 */
export function computeImportSummary(
  questions: readonly ParsedQuestion[],
): ImportPreviewSummary {
  let validCount = 0;
  let warningCount = 0;
  let errorCount = 0;
  let duplicateCount = 0;
  let missingAnswerCount = 0;
  let conflictCount = 0;

  for (const q of questions) {
    if (q.excluded) continue;

    const hasError = q.issues.some((i) => i.severity === "error");
    const hasWarning = q.issues.some((i) => i.severity === "warning");
    const hasMissingAnswer = q.issues.some(
      (i) =>
        i.code === "NO_CORRECT_ANSWER" || i.code === "EMPTY_FLASHCARD_BACK",
    );
    const hasConflict = q.issues.some(
      (i) =>
        i.code === "ANSWER_SIGNAL_CONFLICT" ||
        i.code === "AMBIGUOUS_ANSWER_KEY_MAPPING",
    );

    if (hasError) {
      errorCount += 1;
    } else {
      validCount += 1;
    }
    if (hasWarning) warningCount += 1;
    if (q.isDuplicate) duplicateCount += 1;
    if (hasMissingAnswer) missingAnswerCount += 1;
    if (hasConflict) conflictCount += 1;
  }

  return {
    totalDetected: questions.length,
    validCount,
    warningCount,
    errorCount,
    duplicateCount,
    missingAnswerCount,
    conflictCount,
  };
}
