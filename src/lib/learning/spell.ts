import type { Question, QuestionMediaAttachment } from "@/types/domain";
import {
  getQuestionExplanationAttachments,
  getQuestionPromptAttachments,
} from "./media-helpers";

function stripVietnameseDiacritics(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .normalize("NFC");
}

export interface SpellGradingOptions {
  /** Default `false` (case-insensitive). */
  caseSensitive?: boolean;
  /** Default `true` (trims edges and collapses repeated spaces). */
  ignoreWhitespace?: boolean;
  /** Default `true` (ignores trailing/surrounding punctuation while preserving letters/digits). */
  ignorePunctuation?: boolean;
  /** Default `false` — PRESERVES Vietnamese diacritics by default! */
  ignoreAccents?: boolean;
}

export type SpellDiffKind = "equal" | "insert" | "delete" | "substitute";

export interface SpellDiffSegment {
  kind: SpellDiffKind;
  expected: string;
  actual: string;
}

export interface SpellGradeResult {
  isCorrect: boolean;
  matchedAnswer: string | null;
  closestExpected: string;
  editDistance: number;
  similarityPercent: number;
  diff: SpellDiffSegment[];
}

export type SpellHintLevel = 0 | 1 | 2 | 3 | 4;

export interface SpellHintOutput {
  level: SpellHintLevel;
  usedHint: boolean;
  revealedAnswer: boolean;
  viLabel: string;
  enLabel: string;
  /** Text displayed to the learner — NEVER exposes full spelling at levels 0..3! */
  hintText: string | null;
  wordCount: number;
  charCount: number;
}

export interface SpellTargetDescriptor {
  questionId: string;
  studySetId: string;
  /** Text spoken by TTS when uploaded audio is absent or TTS is chosen. */
  speakText: string;
  /** All accepted spellings (primary + accepted_answers). */
  acceptedAnswers: string[];
  /** Clue/definition shown ONLY when learner requests Hint Level 1 (or opts to show clue). */
  definitionClue: string | null;
  /** Uploaded audio URL if available (takes precedence over TTS when selected). */
  uploadedAudioUrl: string | null;
  chapter: string | null;
  explanation: string | null;
  /** Prompt-side visual cues (multi-image attachments + legacy prompt_image_url). */
  promptImages?: QuestionMediaAttachment[];
  /** Post-check explanation images (NEVER rendered before submitting). */
  explanationImages?: QuestionMediaAttachment[];
  /** True if the question has at least one spellable textual target. */
  isSpellable: boolean;
}

/**
 * Normalize a string for Spell Mode comparison according to explicit sensitivity flags.
 * Preserves Vietnamese diacritics by default (`ignoreAccents: false`).
 */
export function normalizeForSpell(
  raw: string,
  options: SpellGradingOptions = {},
): string {
  const {
    caseSensitive = false,
    ignoreWhitespace = true,
    ignorePunctuation = true,
    ignoreAccents = false,
  } = options;

  let text = raw.normalize("NFC");
  if (ignorePunctuation) {
    text = text.replace(/[.,;:!?'"()[\]{}«»“”‘’…—–]/g, "");
  }
  if (ignoreWhitespace) {
    text = text.trim().replace(/\s+/g, " ");
  }
  if (!caseSensitive) {
    text = text.toLocaleLowerCase("vi");
  }
  if (ignoreAccents) {
    text = stripVietnameseDiacritics(text);
  }
  return text;
}

/**
 * Deterministic character-level diff (`equal` / `insert` / `delete` / `substitute`)
 * using dynamic programming edit-script alignment over Unicode code points (NFC).
 */
export function diffSpelling(
  expectedRaw: string,
  actualRaw: string,
): { editDistance: number; segments: SpellDiffSegment[] } {
  const expChars = Array.from(expectedRaw.normalize("NFC"));
  const actChars = Array.from(actualRaw.normalize("NFC"));
  const m = expChars.length;
  const n = actChars.length;

  // DP table: dp[i][j] = min edit distance between expChars[0..i-1] and actChars[0..j-1]
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = expChars[i - 1] === actChars[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1, // delete from expected (missing in actual)
        dp[i][j - 1] + 1, // insert in actual (extra char typed)
        dp[i - 1][j - 1] + cost, // match or substitute
      );
    }
  }

  // Deterministic backtrack
  const ops: SpellDiffSegment[] = [];
  let i = m;
  let j = n;
  while (i > 0 || j > 0) {
    if (
      i > 0 &&
      j > 0 &&
      expChars[i - 1] === actChars[j - 1] &&
      dp[i][j] === dp[i - 1][j - 1]
    ) {
      ops.push({ kind: "equal", expected: expChars[i - 1], actual: actChars[j - 1] });
      i -= 1;
      j -= 1;
    } else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
      ops.push({
        kind: "substitute",
        expected: expChars[i - 1],
        actual: actChars[j - 1],
      });
      i -= 1;
      j -= 1;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      ops.push({ kind: "delete", expected: expChars[i - 1], actual: "" });
      i -= 1;
    } else {
      ops.push({ kind: "insert", expected: "", actual: actChars[j - 1] });
      j -= 1;
    }
  }

  ops.reverse();

  // Coalesce adjacent segments of the same kind for crisp UI rendering
  const merged: SpellDiffSegment[] = [];
  for (const op of ops) {
    const last = merged[merged.length - 1];
    if (last && last.kind === op.kind) {
      last.expected += op.expected;
      last.actual += op.actual;
    } else {
      merged.push({ ...op });
    }
  }

  return { editDistance: dp[m][n], segments: merged };
}

/**
 * Grade a typed spelling attempt deterministically against one or more accepted answers.
 */
export function gradeSpellingAnswer(
  typed: string,
  acceptedAnswers: readonly string[],
  options: SpellGradingOptions = {},
): SpellGradeResult {
  const validTargets = acceptedAnswers
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (validTargets.length === 0) {
    return {
      isCorrect: false,
      matchedAnswer: null,
      closestExpected: "",
      editDistance: Array.from(typed.trim()).length,
      similarityPercent: 0,
      diff: typed ? [{ kind: "insert", expected: "", actual: typed }] : [],
    };
  }

  const normalizedActual = normalizeForSpell(typed, options);

  // Check for an exact normalized match first
  for (const target of validTargets) {
    const normalizedExpected = normalizeForSpell(target, options);
    if (normalizedActual === normalizedExpected && normalizedExpected.length > 0) {
      return {
        isCorrect: true,
        matchedAnswer: target,
        closestExpected: target,
        editDistance: 0,
        similarityPercent: 100,
        diff: [{ kind: "equal", expected: target, actual: typed.trim() || target }],
      };
    }
  }

  // Otherwise pick the closest accepted answer by character edit distance
  let bestTarget = validTargets[0];
  let bestDiff = diffSpelling(
    normalizeForSpell(validTargets[0], options),
    normalizedActual,
  );

  for (let idx = 1; idx < validTargets.length; idx++) {
    const candidate = validTargets[idx];
    const candidateDiff = diffSpelling(
      normalizeForSpell(candidate, options),
      normalizedActual,
    );
    if (candidateDiff.editDistance < bestDiff.editDistance) {
      bestTarget = candidate;
      bestDiff = candidateDiff;
    }
  }

  const maxLen = Math.max(
    Array.from(normalizeForSpell(bestTarget, options)).length,
    Array.from(normalizedActual).length,
    1,
  );
  const similarityPercent = Math.max(
    0,
    Math.round(((maxLen - bestDiff.editDistance) / maxLen) * 100),
  );

  return {
    isCorrect: false,
    matchedAnswer: null,
    closestExpected: bestTarget,
    editDistance: bestDiff.editDistance,
    similarityPercent,
    diff: bestDiff.segments,
  };
}

/**
 * 5-Level Deterministic Spell Hint Ladder (NEVER reveals full spelling upfront at Levels 0–3!):
 * - Level 0: None (`usedHint: false`)
 * - Level 1: Show definition / prompt clue
 * - Level 2: First letter of each word (masked remainder with `_`)
 * - Level 3: Word count & character length per word
 * - Level 4: Reveal full spelling (`revealedAnswer: true`, `usedHint: true`)
 */
export function generateSpellHint(
  target: string,
  level: SpellHintLevel,
  definitionClue?: string | null,
): SpellHintOutput {
  const cleanTarget = target.trim().normalize("NFC");
  const words = cleanTarget ? cleanTarget.split(/\s+/) : [];
  const wordCount = words.length;
  const charCount = words.reduce((sum, w) => sum + Array.from(w).length, 0);

  switch (level) {
    case 0:
      return {
        level: 0,
        usedHint: false,
        revealedAnswer: false,
        viLabel: "Không gợi ý",
        enLabel: "No Hint",
        hintText: null,
        wordCount,
        charCount,
      };
    case 1:
      return {
        level: 1,
        usedHint: true,
        revealedAnswer: false,
        viLabel: "Gợi ý 1 · Nghĩa / Mô tả",
        enLabel: "Hint 1 · Definition",
        hintText: definitionClue?.trim() || null,
        wordCount,
        charCount,
      };
    case 2: {
      // First letter + masked blanks per word (never reveals full word unless 1-char word -> masked `_`)
      const masked = words
        .map((w) => {
          const chars = Array.from(w);
          if (chars.length <= 1) return "_";
          return `${chars[0]}${" _".repeat(chars.length - 1)}`;
        })
        .join("   ");
      return {
        level: 2,
        usedHint: true,
        revealedAnswer: false,
        viLabel: "Gợi ý 2 · Chữ cái đầu",
        enLabel: "Hint 2 · First Letter",
        hintText: masked,
        wordCount,
        charCount,
      };
    }
    case 3: {
      const lengths = words.map((w) => Array.from(w).length).join(" + ");
      return {
        level: 3,
        usedHint: true,
        revealedAnswer: false,
        viLabel: "Gợi ý 3 · Độ dài từ",
        enLabel: "Hint 3 · Word Length",
        hintText:
          wordCount > 1
            ? `${wordCount} (${lengths}) · ${charCount}`
            : `${charCount}`,
        wordCount,
        charCount,
      };
    }
    case 4:
      return {
        level: 4,
        usedHint: true,
        revealedAnswer: true,
        viLabel: "Hiện đáp án",
        enLabel: "Reveal Answer",
        hintText: cleanTarget,
        wordCount,
        charCount,
      };
  }
}

/**
 * Extract a deterministic Listen & Type target from any StudyHub question.
 * Respects uploaded audio when present (`audio_url` or `listening` payload).
 */
export function extractSpellTarget(question: Question): SpellTargetDescriptor {
  const listeningAudio =
    question.type_payload?.type === "listening"
      ? question.type_payload.audio_url ?? null
      : null;
  const relationAudio =
    question.media_attachments?.find((m) => m.role === "audio")?.media
      ?.proxy_url ??
    question.media_attachments?.find((m) => m.role === "audio")?.url ??
    null;
  const uploadedAudioUrl =
    question.audio_url ?? listeningAudio ?? relationAudio ?? null;

  const accepted: string[] = [];
  const pushUnique = (val: string | null | undefined) => {
    const trimmed = val?.trim();
    if (trimmed && !accepted.includes(trimmed)) {
      accepted.push(trimmed);
    }
  };

  let definitionClue: string | null = null;

  if (question.question_type === "flashcard") {
    // Classic language/vocabulary flashcard: hear the term (prompt) or back?
    // If prompt is concise (<=80 chars) and back_text is longer definition, spell the prompt with back_text as clue!
    // Otherwise spell back_text with prompt as clue.
    const promptText = question.prompt.trim();
    const backText = (question.back_text ?? "").trim();
    if (
      promptText.length > 0 &&
      backText.length > 0 &&
      promptText.length <= 80 &&
      backText.length > promptText.length
    ) {
      pushUnique(promptText);
      definitionClue = backText;
    } else if (backText.length > 0) {
      pushUnique(backText);
      definitionClue = promptText || null;
    } else {
      pushUnique(promptText);
    }
  } else if (question.accepted_answers && question.accepted_answers.length > 0) {
    for (const a of question.accepted_answers) {
      pushUnique(a.answer_text);
    }
    definitionClue = question.prompt.trim() || null;
  } else if (question.type_payload?.type === "fill_in_blank") {
    for (const blank of question.type_payload.blanks) {
      for (const ans of blank.accepted_answers) {
        pushUnique(ans);
      }
    }
    definitionClue = question.prompt.trim() || null;
  } else if (question.type_payload?.type === "listening") {
    if (question.audio_transcript?.trim()) {
      pushUnique(question.audio_transcript);
    } else if (question.type_payload.transcript?.trim()) {
      pushUnique(question.type_payload.transcript);
    } else {
      for (const opt of question.options ?? []) {
        if (opt.is_correct) pushUnique(opt.content);
      }
    }
    definitionClue = question.prompt.trim() || null;
  } else if (
    question.question_type === "single_choice" ||
    question.question_type === "true_false"
  ) {
    const correctOpts = (question.options ?? []).filter(
      (o) => o.is_correct && o.content.trim().length > 0,
    );
    if (correctOpts.length === 1 && correctOpts[0].content.trim().length <= 120) {
      pushUnique(correctOpts[0].content);
      definitionClue = question.prompt.trim() || null;
    }
  }

  const speakText = accepted[0] ?? "";
  const promptImages = getQuestionPromptAttachments(question);
  const explanationImages = getQuestionExplanationAttachments(question);

  return {
    questionId: question.id,
    studySetId: question.study_set_id,
    speakText,
    acceptedAnswers: accepted,
    definitionClue,
    uploadedAudioUrl,
    chapter: question.chapter,
    explanation: question.explanation,
    promptImages,
    explanationImages,
    isSpellable: accepted.length > 0,
  };
}

export interface SpellQueueItem {
  questionId: string;
  requiredCleanPasses: number;
  cleanPasses: number;
  missedCount: number;
  usedReveal: boolean;
}

export interface SpellQueueState {
  queue: SpellQueueItem[];
  completedIds: string[];
  missedIds: string[];
  totalItems: number;
  totalAttempts: number;
  correctAttempts: number;
  cleanIndependentAttempts: number;
  sessionCompleted: boolean;
}

export function createSpellQueueState(
  questionIds: readonly string[],
): SpellQueueState {
  const queue: SpellQueueItem[] = questionIds.map((questionId) => ({
    questionId,
    requiredCleanPasses: 1,
    cleanPasses: 0,
    missedCount: 0,
    usedReveal: false,
  }));
  return {
    queue,
    completedIds: [],
    missedIds: [],
    totalItems: queue.length,
    totalAttempts: 0,
    correctAttempts: 0,
    cleanIndependentAttempts: 0,
    sessionCompleted: queue.length === 0,
  };
}

/**
 * Record a Spell Mode attempt.
 * Missed items or items where the learner revealed the answer are automatically
 * prioritized back into the queue after 2–3 cards until spelled cleanly!
 */
export function recordSpellQueueAttempt(
  state: SpellQueueState,
  input: { isCorrect: boolean; usedHint: boolean; revealedAnswer: boolean },
): SpellQueueState {
  if (state.queue.length === 0) return state;

  const [current, ...rest] = state.queue;
  const totalAttempts = state.totalAttempts + 1;
  const correctAttempts = state.correctAttempts + (input.isCorrect ? 1 : 0);
  const isClean = input.isCorrect && !input.usedHint && !input.revealedAnswer;
  const cleanIndependentAttempts =
    state.cleanIndependentAttempts + (isClean ? 1 : 0);

  let completedIds = state.completedIds;
  let missedIds = state.missedIds;
  let nextQueue: SpellQueueItem[];

  if (input.isCorrect && !input.revealedAnswer) {
    const nextPasses = current.cleanPasses + 1;
    if (nextPasses >= current.requiredCleanPasses) {
      nextQueue = rest;
      if (!completedIds.includes(current.questionId)) {
        completedIds = [...completedIds, current.questionId];
      }
    } else {
      const updated: SpellQueueItem = {
        ...current,
        cleanPasses: nextPasses,
      };
      const insertAt = Math.min(2, rest.length);
      nextQueue = [
        ...rest.slice(0, insertAt),
        updated,
        ...rest.slice(insertAt),
      ];
    }
  } else {
    // Missed or revealed -> require clean pass and re-prioritize after 2 items
    if (!missedIds.includes(current.questionId)) {
      missedIds = [...missedIds, current.questionId];
    }
    const updated: SpellQueueItem = {
      ...current,
      cleanPasses: 0,
      requiredCleanPasses: Math.max(current.requiredCleanPasses, 2),
      missedCount: current.missedCount + 1,
      usedReveal: current.usedReveal || input.revealedAnswer,
    };
    const insertAt = Math.min(2, rest.length);
    nextQueue = [
      ...rest.slice(0, insertAt),
      updated,
      ...rest.slice(insertAt),
    ];
  }

  return {
    ...state,
    queue: nextQueue,
    completedIds,
    missedIds,
    totalAttempts,
    correctAttempts,
    cleanIndependentAttempts,
    sessionCompleted: nextQueue.length === 0,
  };
}
