import type {
  AnswerDetectionSource,
  AnswerRule,
  ImportValidationIssue,
  ParsedOption,
  ParsedQuestion,
} from "@/types/import";
import {
  generateStableId,
  indexToOptionLabel,
  matchChapterHeader,
  matchExplanationLine,
  matchHintLine,
  normalizeText,
  optionLabelToIndex,
} from "./text-utils";

/**
 * Shared deterministic line matchers for Vietnamese & English MC question banks.
 * All regexes are linear-time (no nested quantifiers / zero ReDoS risk).
 */
export const EXPLICIT_QUESTION_REGEX =
  /^(?:Câu|Cau|CÂU|CAU|Question|QUESTION|Q)\s*(\d+)\s*[:.)\-–—]\s*(.*)$/i;

export const NUMBERED_QUESTION_REGEX = /^(\d{1,6})\s*[.)]\s+(.+)$/;

/**
 * Matches:
 *  - "*B. Text", "* B. Text", "*(B) Text", "[*] B. Text", "[x] B. Text"
 *  - "A. Text", "A) Text", "a. Text", "a) Text", "(A) Text"
 */
export const OPTION_LINE_REGEX =
  /^(?:(\*|\[\*\]|\[[xX]\])\s*)?(?:\(([A-Ha-h])\)|([A-Ha-h])\s*[.)\]:\-])\s*(.*)$/;

/**
 * Matches inline answer key lines:
 *  - "ANSWER: A"
 *  - "Answer: B, C"
 *  - "Correct answer: C"
 *  - "Đáp án: D"
 *  - "Đáp án đúng: A"
 *  - "ĐA: B"
 *  - "Key: A & D"
 */
export const INLINE_ANSWER_LINE_REGEX =
  /^(?:ANSWER|ANS|CORRECT\s*ANSWER|ĐÁP\s*ÁN(?:\s*ĐÚNG)?|DAP\s*AN(?:\s*DUNG)?|ĐA|KEY)\s*[:.\-=]\s*([A-Ha-h](?:\s*(?:,|;|&|\+|\/|\band\b|\bvà\b|\s)\s*[A-Ha-h])*)\s*\.?$/i;

export interface ParsedOptionMatch {
  hasAsterisk: boolean;
  label: string;
  content: string;
}

export function matchOptionLine(line: string): ParsedOptionMatch | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const m = OPTION_LINE_REGEX.exec(trimmed);
  if (!m) return null;
  const marker = m[1];
  const letter = (m[2] ?? m[3] ?? "").toUpperCase();
  const content = (m[4] ?? "").trim();
  if (!letter) return null;
  return {
    hasAsterisk: Boolean(marker),
    label: letter,
    content,
  };
}

export interface ParsedQuestionHeaderMatch {
  localQuestionNumber: number | null;
  promptStart: string;
  isExplicitPrefix: boolean;
}

export function matchQuestionHeader(line: string): ParsedQuestionHeaderMatch | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const explicit = EXPLICIT_QUESTION_REGEX.exec(trimmed);
  if (explicit) {
    return {
      localQuestionNumber: Number.parseInt(explicit[1], 10),
      promptStart: explicit[2].trim(),
      isExplicitPrefix: true,
    };
  }

  const numbered = NUMBERED_QUESTION_REGEX.exec(trimmed);
  if (numbered) {
    return {
      localQuestionNumber: Number.parseInt(numbered[1], 10),
      promptStart: numbered[2].trim(),
      isExplicitPrefix: false,
    };
  }

  return null;
}

export function matchInlineAnswerLine(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const match = INLINE_ANSWER_LINE_REGEX.exec(trimmed);
  if (!match) return null;
  const rawLetters = match[1];
  const letters = rawLetters.match(/[A-Ha-h]/g);
  if (!letters || letters.length === 0) return null;
  return Array.from(new Set(letters.map((l) => l.toUpperCase())));
}

export interface TextParserConfig {
  answerRule?: AnswerRule;
  defaultChapter?: string;
  defaultTags?: string[];
  /** Allow inline answer lines inside EduQuiz / txt_generic when rule allows */
  allowInlineAnswerLine?: boolean;
}

export interface TextParseOutput {
  questions: ParsedQuestion[];
  issues: ImportValidationIssue[];
}

interface DraftQuestion {
  chapter: string | null;
  chapterIndex: number;
  localQuestionNumber: number | null;
  promptLines: string[];
  options: Array<{
    label: string;
    contentLines: string[];
    hasAsterisk: boolean;
  }>;
  inlineAnswerLetters: string[];
  explanationLines: string[];
  hintLines: string[];
  rawLines: string[];
}

function finalizeDraftQuestion(
  draft: DraftQuestion,
  globalIndex: number,
  config: TextParserConfig,
): ParsedQuestion {
  const mode = config.answerRule?.mode ?? "auto";
  const allowAsterisk =
    mode === "auto" ||
    mode === "asterisk_prefix" ||
    Boolean(config.answerRule?.enabledSignals?.includes("asterisk_prefix"));
  const allowInline =
    (config.allowInlineAnswerLine ?? true) &&
    (mode === "auto" ||
      mode === "inline_answer_key" ||
      Boolean(config.answerRule?.enabledSignals?.includes("inline_answer_key")));

  const issues: ImportValidationIssue[] = [];
  const prompt = draft.promptLines.join("\n").trim();

  const asteriskSet = new Set<string>();
  const inlineSet = new Set<string>();

  if (allowAsterisk) {
    for (const opt of draft.options) {
      if (opt.hasAsterisk) {
        asteriskSet.add(opt.label);
      }
    }
  }

  if (allowInline) {
    for (const letter of draft.inlineAnswerLetters) {
      inlineSet.add(letter);
    }
  }

  // Determine active answer set & detect conflicts
  let finalCorrectLabels = new Set<string>();
  const questionDetectedBy: AnswerDetectionSource[] = [];

  if (inlineSet.size > 0 && asteriskSet.size > 0) {
    const inlineSorted = Array.from(inlineSet).sort().join(",");
    const asteriskSorted = Array.from(asteriskSet).sort().join(",");
    if (inlineSorted !== asteriskSorted) {
      issues.push({
        id: generateStableId(),
        code: "ANSWER_SIGNAL_CONFLICT",
        severity: "warning",
        questionIndex: globalIndex,
        message: `Conflicting answers detected: inline answer key (${inlineSorted}) disagrees with asterisk marker (${asteriskSorted}).`,
        details: `inline_answer_key=[${inlineSorted}], asterisk_prefix=[${asteriskSorted}]`,
      });
    }
    // Priority: inline_answer_key > asterisk_prefix (unless rule forces asterisk)
    if (mode === "asterisk_prefix") {
      finalCorrectLabels = asteriskSet;
      questionDetectedBy.push("asterisk_prefix");
    } else {
      finalCorrectLabels = inlineSet;
      questionDetectedBy.push("inline_answer_key");
      if (inlineSorted === asteriskSorted) {
        questionDetectedBy.push("asterisk_prefix");
      }
    }
  } else if (inlineSet.size > 0) {
    finalCorrectLabels = inlineSet;
    questionDetectedBy.push("inline_answer_key");
  } else if (asteriskSet.size > 0) {
    finalCorrectLabels = asteriskSet;
    questionDetectedBy.push("asterisk_prefix");
  }

  // Validate inline answer labels exist in options
  if (inlineSet.size > 0 && draft.options.length > 0) {
    const optionLabelSet = new Set(draft.options.map((o) => o.label));
    for (const letter of inlineSet) {
      if (!optionLabelSet.has(letter)) {
        const idx = optionLabelToIndex(letter);
        if (idx < 0 || idx >= draft.options.length) {
          issues.push({
            id: generateStableId(),
            code: "INVALID_CORRECT_ANSWER",
            severity: "error",
            questionIndex: globalIndex,
            message: `Answer key references option "${letter}" which does not exist in this question.`,
          });
        }
      }
    }
  }

  const parsedOptions: ParsedOption[] = draft.options.map((opt, idx) => {
    const label = opt.label || indexToOptionLabel(idx);
    const isCorrect = finalCorrectLabels.has(label);
    const optSources: AnswerDetectionSource[] = [];
    if (isCorrect) {
      if (inlineSet.has(label) && allowInline) optSources.push("inline_answer_key");
      if (asteriskSet.has(label) && allowAsterisk) optSources.push("asterisk_prefix");
    }
    return {
      id: generateStableId(),
      label,
      content: opt.contentLines.join("\n").trim(),
      isCorrect,
      detectedBy: optSources,
    };
  });

  const correctCount = parsedOptions.filter((o) => o.isCorrect).length;
  const questionType =
    correctCount > 1 ? "multiple_choice" : "single_choice";

  const explanation =
    draft.explanationLines.length > 0
      ? draft.explanationLines.join("\n").trim()
      : null;
  const hint =
    draft.hintLines.length > 0 ? draft.hintLines.join("\n").trim() : null;

  return {
    tempId: generateStableId(),
    index: globalIndex,
    chapter: draft.chapter ?? config.defaultChapter ?? null,
    chapterIndex: draft.chapterIndex,
    localQuestionNumber: draft.localQuestionNumber,
    questionType,
    prompt,
    explanation,
    hint,
    difficulty: "medium",
    tags: config.defaultTags ? [...config.defaultTags] : [],
    options: parsedOptions,
    detectedBy: questionDetectedBy.length > 0 ? questionDetectedBy : ["none"],
    rawSource: draft.rawLines.join("\n"),
    issues,
  };
}

/**
 * Deterministic state-machine parser for EduQuiz TXT (`*B.`) and generic numbered TXT.
 * Handles chapters, multiline stems, multiline options, multiple `*` answers,
 * explanations, hints, and blank-line separated unnumbered questions.
 */
export function parseEduQuizText(
  rawText: string,
  config: TextParserConfig = {},
): TextParseOutput {
  const normalized = normalizeText(rawText);
  const lines = normalized.split("\n");

  const questions: ParsedQuestion[] = [];
  const globalIssues: ImportValidationIssue[] = [];

  let currentChapter: string | null = config.defaultChapter ?? null;
  let chapterIndex = 0;
  let current: DraftQuestion | null = null;
  let state: "idle" | "prompt" | "options" | "explanation" | "hint" = "idle";
  let sawBlankLine = false;

  const flushCurrent = (): void => {
    if (!current) return;
    const hasPrompt = current.promptLines.join("").trim().length > 0;
    const hasOptions = current.options.length > 0;
    if (hasPrompt || hasOptions) {
      questions.push(finalizeDraftQuestion(current, questions.length, config));
    }
    current = null;
    state = "idle";
  };

  for (let i = 0; i < lines.length; i += 1) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    if (trimmed.length === 0) {
      sawBlankLine = true;
      continue;
    }

    // 1. Check Chapter Header (only when idle or after options/blank line)
    const chapterMatch = matchChapterHeader(trimmed);
    if (chapterMatch && (state === "idle" || state === "options" || state === "explanation" || state === "hint" || sawBlankLine)) {
      flushCurrent();
      currentChapter = chapterMatch;
      chapterIndex += 1;
      sawBlankLine = false;
      continue;
    }

    // 2. Check Inline Answer Line (only if we already have an active question with options)
    if (current && current.options.length > 0) {
      const inlineAns = matchInlineAnswerLine(trimmed);
      if (inlineAns) {
        current.inlineAnswerLetters.push(...inlineAns);
        current.rawLines.push(rawLine);
        state = "options";
        sawBlankLine = false;
        continue;
      }
    }

    // 3. Check Explanation / Hint line
    if (current && current.options.length > 0) {
      const exp = matchExplanationLine(trimmed);
      if (exp !== null) {
        current.explanationLines.push(exp);
        current.rawLines.push(rawLine);
        state = "explanation";
        sawBlankLine = false;
        continue;
      }
      const hint = matchHintLine(trimmed);
      if (hint !== null) {
        current.hintLines.push(hint);
        current.rawLines.push(rawLine);
        state = "hint";
        sawBlankLine = false;
        continue;
      }
    }

    // 4. Check Option Line
    const optMatch = matchOptionLine(trimmed);
    if (optMatch && current) {
      // Guard against a fresh question accidentally starting with "A." after blank line if previous already has >= 2 options and label is "A" and there was no prompt?
      // Normally "A." continues options of current question.
      current.options.push({
        label: optMatch.label,
        contentLines: optMatch.content ? [optMatch.content] : [],
        hasAsterisk: optMatch.hasAsterisk,
      });
      current.rawLines.push(rawLine);
      state = "options";
      sawBlankLine = false;
      continue;
    }

    // 5. Check Explicit or Numbered Question Header
    const qHeader = matchQuestionHeader(trimmed);
    if (qHeader) {
      // If we are inside an option block and encounter "1. ..." without blank line and it's NOT explicit prefix ("Câu 1:"),
      // decide whether it starts a new question (if current already has >= 2 options, it almost certainly starts a new question).
      const shouldStartNew =
        !current ||
        qHeader.isExplicitPrefix ||
        current.options.length >= 2 ||
        sawBlankLine;

      if (shouldStartNew) {
        flushCurrent();
        current = {
          chapter: currentChapter,
          chapterIndex,
          localQuestionNumber: qHeader.localQuestionNumber,
          promptLines: qHeader.promptStart ? [qHeader.promptStart] : [],
          options: [],
          inlineAnswerLetters: [],
          explanationLines: [],
          hintLines: [],
          rawLines: [rawLine],
        };
        state = "prompt";
        sawBlankLine = false;
        continue;
      }
    }

    // 6. Continuation or Blank-Line-Separated Unnumbered Question
    if (!current) {
      // Start an unnumbered question block
      current = {
        chapter: currentChapter,
        chapterIndex,
        localQuestionNumber: null,
        promptLines: [trimmed],
        options: [],
        inlineAnswerLetters: [],
        explanationLines: [],
        hintLines: [],
        rawLines: [rawLine],
      };
      state = "prompt";
      sawBlankLine = false;
      continue;
    }

    if (state === "prompt") {
      current.promptLines.push(trimmed);
      current.rawLines.push(rawLine);
      sawBlankLine = false;
      continue;
    }

    if (state === "explanation") {
      if (sawBlankLine) {
        // After explanation + blank line, non-option text begins a new unnumbered question
        flushCurrent();
        current = {
          chapter: currentChapter,
          chapterIndex,
          localQuestionNumber: null,
          promptLines: [trimmed],
          options: [],
          inlineAnswerLetters: [],
          explanationLines: [],
          hintLines: [],
          rawLines: [rawLine],
        };
        state = "prompt";
      } else {
        current.explanationLines.push(trimmed);
        current.rawLines.push(rawLine);
      }
      sawBlankLine = false;
      continue;
    }

    if (state === "hint") {
      if (sawBlankLine) {
        flushCurrent();
        current = {
          chapter: currentChapter,
          chapterIndex,
          localQuestionNumber: null,
          promptLines: [trimmed],
          options: [],
          inlineAnswerLetters: [],
          explanationLines: [],
          hintLines: [],
          rawLines: [rawLine],
        };
        state = "prompt";
      } else {
        current.hintLines.push(trimmed);
        current.rawLines.push(rawLine);
      }
      sawBlankLine = false;
      continue;
    }

    if (state === "options") {
      if (sawBlankLine && current.options.length >= 2) {
        // Blank line followed by plain text after a complete option block -> new unnumbered question
        flushCurrent();
        current = {
          chapter: currentChapter,
          chapterIndex,
          localQuestionNumber: null,
          promptLines: [trimmed],
          options: [],
          inlineAnswerLetters: [],
          explanationLines: [],
          hintLines: [],
          rawLines: [rawLine],
        };
        state = "prompt";
      } else if (current.options.length > 0) {
        // Multiline continuation of the last option
        current.options[current.options.length - 1].contentLines.push(trimmed);
        current.rawLines.push(rawLine);
      }
      sawBlankLine = false;
    }
  }

  flushCurrent();

  return { questions, issues: globalIssues };
}
