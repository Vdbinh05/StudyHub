import type {
  AnswerDetectionSource,
  ImportValidationIssue,
  ParsedQuestion,
} from "@/types/import";
import {
  parseEduQuizText,
  type TextParseOutput,
  type TextParserConfig,
} from "./eduquiz-parser";
import {
  generateStableId,
  matchChapterHeader,
  normalizeText,
  optionLabelToIndex,
} from "./text-utils";

/**
 * Header marking the start of a separate end-of-document Answer Key section.
 */
export const END_ANSWER_KEY_HEADER_REGEX =
  /^(?:#{1,3}\s*)?(?:BẢNG\s*ĐÁP\s*ÁN|BANG\s*DAP\s*AN|ĐÁP\s*ÁN(?:\s*CHI\s*TIẾT|\s*THAM\s*KHẢO)?|DAP\s*AN(?:\s*CHI\s*TIET)?|ANSWER\s*KEY|ANSWERS|KEY)\s*[:\-–—]?\s*$/i;

/**
 * Matches individual key pairs like:
 *  - "1.A", "1. A", "1) B", "1-C", "1: D", "Câu 1: A", "Q1. B", "1A", "1. A, C"
 */
const ANSWER_KEY_PAIR_REGEX =
  /(?:(?:Câu|Cau|CÂU|Question|Q)\s*)?(\d{1,6})\s*(?:[:.)\-–—]\s*|\s+)([A-Ha-h](?:\s*(?:,|;|&|\+|\/)\s*[A-Ha-h])*)(?=\s|$|\||;)/gi;

const COMPACT_NUMBER_LETTER_REGEX = /\b(\d{1,6})([A-Ha-h])\b/g;

export interface ParsedAnswerKeyEntry {
  chapterTitle: string | null;
  chapterIndex: number;
  localQuestionNumber: number;
  letters: string[];
  rawLine: string;
}

/**
 * Parse lines of an end-of-document answer key block into structured entries.
 * Deterministically tracks chapter headers AND automatic chapter resets when
 * numbering restarts (e.g. 1..50 then 1..50).
 */
export function parseEndAnswerKeyBlock(
  keyLines: readonly string[],
  firstQuestionChapterIndex = 0,
): { entries: ParsedAnswerKeyEntry[]; issues: ImportValidationIssue[] } {
  const entries: ParsedAnswerKeyEntry[] = [];
  const issues: ImportValidationIssue[] = [];

  let currentChapterTitle: string | null = null;
  let currentChapterIndex = firstQuestionChapterIndex;
  let explicitChapterSeen = false;
  let lastLocalNumber = -1;

  for (const rawLine of keyLines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    // Skip repeated "ĐÁP ÁN" header lines inside the block
    if (END_ANSWER_KEY_HEADER_REGEX.test(trimmed)) {
      continue;
    }

    // Check for explicit chapter heading inside the answer key section
    const chapterMatch = matchChapterHeader(trimmed);
    if (chapterMatch) {
      if (explicitChapterSeen || entries.length > 0) {
        currentChapterIndex += 1;
      } else {
        // Align first explicit chapter in key with first chapter of document (1 if document used chapter headers)
        currentChapterIndex = Math.max(1, firstQuestionChapterIndex);
      }
      explicitChapterSeen = true;
      currentChapterTitle = chapterMatch;
      lastLocalNumber = -1;
      continue;
    }

    // Extract pairs from the line (supports grid rows like "1.A  2.B  3.C  4.D" or table rows "1\tA")
    let matchedAny = false;
    ANSWER_KEY_PAIR_REGEX.lastIndex = 0;
    let m: RegExpExecArray | null = ANSWER_KEY_PAIR_REGEX.exec(trimmed);
    while (m !== null) {
      matchedAny = true;
      const num = Number.parseInt(m[1], 10);
      const rawLetters = m[2].match(/[A-Ha-h]/g) ?? [];
      const letters = Array.from(new Set(rawLetters.map((l) => l.toUpperCase())));

      // Deterministic multi-chapter reset detection when chapter headers were omitted in key:
      // If question number resets downward (e.g., 10 -> 1 or 50 -> 1), increment chapter index!
      if (lastLocalNumber > 0 && num <= lastLocalNumber && !explicitChapterSeen) {
        currentChapterIndex += 1;
      }
      lastLocalNumber = num;

      entries.push({
        chapterTitle: currentChapterTitle,
        chapterIndex: currentChapterIndex,
        localQuestionNumber: num,
        letters,
        rawLine: trimmed,
      });

      m = ANSWER_KEY_PAIR_REGEX.exec(trimmed);
    }

    // Fallback for ultra-compact grid like "1A 2B 3C 4D"
    if (!matchedAny) {
      COMPACT_NUMBER_LETTER_REGEX.lastIndex = 0;
      let cm: RegExpExecArray | null = COMPACT_NUMBER_LETTER_REGEX.exec(trimmed);
      while (cm !== null) {
        matchedAny = true;
        const num = Number.parseInt(cm[1], 10);
        const letter = cm[2].toUpperCase();

        if (lastLocalNumber > 0 && num <= lastLocalNumber && !explicitChapterSeen) {
          currentChapterIndex += 1;
        }
        lastLocalNumber = num;

        entries.push({
          chapterTitle: currentChapterTitle,
          chapterIndex: currentChapterIndex,
          localQuestionNumber: num,
          letters: [letter],
          rawLine: trimmed,
        });

        cm = COMPACT_NUMBER_LETTER_REGEX.exec(trimmed);
      }
    }

    if (!matchedAny) {
      issues.push({
        id: generateStableId(),
        code: "UNPARSED_BLOCK",
        severity: "warning",
        message: `Unrecognized line in answer key section: "${trimmed.slice(0, 80)}"`,
      });
    }
  }

  return { entries, issues };
}

/**
 * Apply parsed end-of-document answer key entries to a list of ParsedQuestions
 * using deterministic (chapterIndex, localQuestionNumber) mapping with zero silent overwrites.
 */
export function applyEndAnswerKeyToQuestions(
  questions: ParsedQuestion[],
  keyEntries: readonly ParsedAnswerKeyEntry[],
  ruleMode: string = "auto",
): ImportValidationIssue[] {
  const issues: ImportValidationIssue[] = [];
  if (keyEntries.length === 0) return issues;

  // Build chapter-scoped lookup: Map<`${chapterIndex}:${localNum}`, ParsedQuestion[]>
  // Also assign fallback sequential chapter-local numbers if questions lacked explicit numbers.
  const byChapterAndNum = new Map<string, ParsedQuestion[]>();
  const chapterCounters = new Map<number, number>();

  // Detect distinct question chapterIndices in document order to align with key chapterIndices
  const distinctQuestionChapters: number[] = [];
  for (const q of questions) {
    const chIdx = q.chapterIndex ?? 0;
    if (!distinctQuestionChapters.includes(chIdx)) {
      distinctQuestionChapters.push(chIdx);
    }
  }

  const distinctKeyChapters: number[] = [];
  for (const e of keyEntries) {
    if (!distinctKeyChapters.includes(e.chapterIndex)) {
      distinctKeyChapters.push(e.chapterIndex);
    }
  }

  // Map key chapter ordinal -> question chapterIndex when chapter counts match
  const keyChapterRemap = new Map<number, number>();
  for (let i = 0; i < distinctKeyChapters.length; i += 1) {
    if (i < distinctQuestionChapters.length) {
      keyChapterRemap.set(distinctKeyChapters[i], distinctQuestionChapters[i]);
    } else {
      keyChapterRemap.set(distinctKeyChapters[i], distinctKeyChapters[i]);
    }
  }

  for (const q of questions) {
    const chIdx = q.chapterIndex ?? 0;
    const nextSeq = (chapterCounters.get(chIdx) ?? 0) + 1;
    chapterCounters.set(chIdx, nextSeq);
    const num = q.localQuestionNumber ?? nextSeq;
    const compositeKey = `${chIdx}:${num}`;
    const list = byChapterAndNum.get(compositeKey);
    if (list) {
      list.push(q);
    } else {
      byChapterAndNum.set(compositeKey, [q]);
    }
  }

  // Track which question tempIds were already assigned by end_answer_key to catch duplicate keys
  const assignedQuestions = new Map<string, string[]>();

  for (const entry of keyEntries) {
    const mappedChapterIndex =
      keyChapterRemap.get(entry.chapterIndex) ?? entry.chapterIndex;
    const compositeKey = `${mappedChapterIndex}:${entry.localQuestionNumber}`;
    const matchedQuestions = byChapterAndNum.get(compositeKey);

    if (!matchedQuestions || matchedQuestions.length === 0) {
      issues.push({
        id: generateStableId(),
        code: "AMBIGUOUS_ANSWER_KEY_MAPPING",
        severity: "warning",
        message: `Answer key entry (chapter #${mappedChapterIndex}, question ${entry.localQuestionNumber} -> ${entry.letters.join(",")}) did not match any parsed question.`,
      });
      continue;
    }

    if (matchedQuestions.length > 1) {
      issues.push({
        id: generateStableId(),
        code: "AMBIGUOUS_ANSWER_KEY_MAPPING",
        severity: "error",
        questionIndex: matchedQuestions[0].index,
        message: `Ambiguous answer key mapping: ${matchedQuestions.length} questions share number ${entry.localQuestionNumber} in the same chapter. Please resolve manually.`,
      });
      continue;
    }

    const target = matchedQuestions[0];
    const previousKey = assignedQuestions.get(target.tempId);
    if (previousKey) {
      const prevStr = previousKey.join(",");
      const nextStr = entry.letters.join(",");
      target.issues.push({
        id: generateStableId(),
        code: "AMBIGUOUS_ANSWER_KEY_MAPPING",
        severity: "warning",
        questionIndex: target.index,
        message: `Duplicate answer key entry for question ${entry.localQuestionNumber}: previously "${prevStr}", also found "${nextStr}".`,
      });
      continue;
    }
    assignedQuestions.set(target.tempId, entry.letters);

    // Check for conflict with existing detected answer (e.g. inline key or asterisk or docx formatting)
    const existingCorrectLabels = target.options
      .filter((o) => o.isCorrect)
      .map((o) => o.label)
      .sort();
    const newCorrectLabels = [...entry.letters].sort();

    if (
      existingCorrectLabels.length > 0 &&
      existingCorrectLabels.join(",") !== newCorrectLabels.join(",")
    ) {
      target.issues.push({
        id: generateStableId(),
        code: "ANSWER_SIGNAL_CONFLICT",
        severity: "warning",
        questionIndex: target.index,
        message: `Conflicting answer signals: end answer key (${newCorrectLabels.join(",")}) disagrees with existing signal ${target.detectedBy.join("/")} (${existingCorrectLabels.join(",")}).`,
      });

      // Respect priority: inline_answer_key > end_answer_key > asterisk_prefix/docx_*
      const hasInline = target.detectedBy.includes("inline_answer_key");
      if (hasInline && ruleMode !== "end_answer_key") {
        continue;
      }
    }

    // Validate letters exist in question options
    const optionLabels = new Set(target.options.map((o) => o.label));
    for (const letter of entry.letters) {
      if (!optionLabels.has(letter)) {
        const idx = optionLabelToIndex(letter);
        if (idx < 0 || idx >= target.options.length) {
          target.issues.push({
            id: generateStableId(),
            code: "INVALID_CORRECT_ANSWER",
            severity: "error",
            questionIndex: target.index,
            message: `End answer key specifies "${letter}" for question ${entry.localQuestionNumber}, which does not exist.`,
          });
        }
      }
    }

    const newSet = new Set(entry.letters);
    for (const opt of target.options) {
      if (newSet.has(opt.label)) {
        opt.isCorrect = true;
        if (!opt.detectedBy.includes("end_answer_key")) {
          opt.detectedBy.push("end_answer_key");
        }
      } else if (
        ruleMode === "end_answer_key" ||
        existingCorrectLabels.length === 0 ||
        !target.detectedBy.includes("inline_answer_key")
      ) {
        opt.isCorrect = false;
      }
    }

    const updatedSources: AnswerDetectionSource[] = target.detectedBy.filter(
      (s) => s !== "none",
    );
    if (!updatedSources.includes("end_answer_key")) {
      updatedSources.push("end_answer_key");
    }
    target.detectedBy = updatedSources;

    const correctCount = target.options.filter((o) => o.isCorrect).length;
    if (correctCount > 1) {
      target.questionType = "multiple_choice";
    } else if (correctCount === 1) {
      target.questionType = "single_choice";
    }
  }

  return issues;
}

/**
 * Split raw text into [questionBodyText, endAnswerKeyLines] if an end-of-document
 * answer key section header is present.
 */
export function splitEndAnswerKeySection(rawText: string): {
  bodyText: string;
  keyLines: string[];
} {
  const normalized = normalizeText(rawText);
  const lines = normalized.split("\n");

  // Search from the bottom up or find the last standalone Answer Key section header
  // that occurs after at least some question content.
  let splitIndex = -1;
  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (END_ANSWER_KEY_HEADER_REGEX.test(trimmed)) {
      // Ensure there is non-empty question content before this header
      const hasContentBefore = lines
        .slice(0, i)
        .some((l) => l.trim().length > 0);
      if (hasContentBefore) {
        splitIndex = i;
        break;
      }
    }
  }

  if (splitIndex === -1) {
    return { bodyText: normalized, keyLines: [] };
  }

  return {
    bodyText: lines.slice(0, splitIndex).join("\n"),
    keyLines: lines.slice(splitIndex + 1),
  };
}

/**
 * Deterministic parser for Word Answer-Key format (inline ANSWER:/Đáp án: AND
 * end-of-document answer keys with multi-chapter question number reset handling).
 */
export function parseWordAnswerKeyText(
  rawText: string,
  config: TextParserConfig = {},
): TextParseOutput {
  const { bodyText, keyLines } = splitEndAnswerKeySection(rawText);

  const mode = config.answerRule?.mode ?? "auto";
  const allowEndKey =
    mode === "auto" ||
    mode === "end_answer_key" ||
    Boolean(config.answerRule?.enabledSignals?.includes("end_answer_key"));

  const bodyResult = parseEduQuizText(bodyText, {
    ...config,
    allowInlineAnswerLine:
      mode === "auto" ||
      mode === "inline_answer_key" ||
      Boolean(config.answerRule?.enabledSignals?.includes("inline_answer_key")),
  });

  const allIssues: ImportValidationIssue[] = [...bodyResult.issues];

  if (allowEndKey && keyLines.length > 0) {
    const firstChapterIndex =
      bodyResult.questions.length > 0
        ? (bodyResult.questions[0].chapterIndex ?? 0)
        : 0;
    const { entries, issues: keyParseIssues } = parseEndAnswerKeyBlock(
      keyLines,
      firstChapterIndex,
    );
    allIssues.push(...keyParseIssues);

    const mappingIssues = applyEndAnswerKeyToQuestions(
      bodyResult.questions,
      entries,
      mode,
    );
    allIssues.push(...mappingIssues);
  }

  return {
    questions: bodyResult.questions,
    issues: allIssues,
  };
}
