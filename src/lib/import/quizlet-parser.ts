import type { ImportValidationIssue, ParsedQuestion } from "@/types/import";
import { generateStableId, normalizeText } from "./text-utils";

export interface QuizletParserConfig {
  termDelimiter?: string;
  cardDelimiter?: string;
  defaultChapter?: string;
  defaultTags?: string[];
}

export interface QuizletParseOutput {
  questions: ParsedQuestion[];
  issues: ImportValidationIssue[];
}

/**
 * Resolve shorthand delimiter tokens (e.g. "\\t", "\\n", "\\n\\n") from UI inputs.
 */
function resolveDelimiter(value: string | undefined, fallback: string): string {
  if (value === undefined || value === "") return fallback;
  return value.replace(/\\t/g, "\t").replace(/\\n/g, "\n");
}

/**
 * Deterministic Quizlet TSV / custom-delimiter flashcard parser.
 * Splits cards by `cardDelimiter` (default "\n") and splits each card into
 * Front/Term and Back/Definition by `termDelimiter` (default "\t").
 */
export function parseQuizletText(
  rawText: string,
  config: QuizletParserConfig = {},
): QuizletParseOutput {
  const normalized = normalizeText(rawText);
  const termDelimiter = resolveDelimiter(config.termDelimiter, "\t");
  const cardDelimiter = resolveDelimiter(config.cardDelimiter, "\n");

  const rawCards = normalized.split(cardDelimiter);
  const questions: ParsedQuestion[] = [];
  const issues: ImportValidationIssue[] = [];

  for (const rawCard of rawCards) {
    const trimmedCard = rawCard.trim();
    if (!trimmedCard) continue;

    const splitIdx = rawCard.indexOf(termDelimiter);
    let term: string;
    let definition: string;

    if (splitIdx === -1) {
      term = trimmedCard;
      definition = "";
      issues.push({
        id: generateStableId(),
        code: "EMPTY_FLASHCARD_BACK",
        severity: "error",
        questionIndex: questions.length,
        message: `Card #${questions.length + 1} is missing the term/definition delimiter.`,
      });
    } else {
      term = rawCard.slice(0, splitIdx).trim();
      definition = rawCard.slice(splitIdx + termDelimiter.length).trim();
    }

    const qIssues: ImportValidationIssue[] = [];
    if (!term) {
      qIssues.push({
        id: generateStableId(),
        code: "EMPTY_PROMPT",
        severity: "error",
        questionIndex: questions.length,
        message: `Flashcard #${questions.length + 1} has an empty front/term.`,
      });
    }
    if (!definition) {
      qIssues.push({
        id: generateStableId(),
        code: "EMPTY_FLASHCARD_BACK",
        severity: "error",
        questionIndex: questions.length,
        message: `Flashcard #${questions.length + 1} has an empty back/definition.`,
      });
    }

    questions.push({
      tempId: generateStableId(),
      index: questions.length,
      chapter: config.defaultChapter ?? null,
      questionType: "flashcard",
      prompt: term,
      backText: definition,
      explanation: null,
      hint: null,
      difficulty: "medium",
      tags: config.defaultTags ? [...config.defaultTags] : [],
      options: [],
      acceptedAnswers: definition
        ? [{ answerText: definition, matchMode: "case_insensitive" }]
        : [],
      detectedBy: definition ? ["column_mapping"] : ["none"],
      rawSource: rawCard,
      issues: qIssues,
    });
  }

  return { questions, issues };
}
