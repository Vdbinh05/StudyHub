import type { Question } from "@/types/domain";
import {
  getOptionAttachments,
  getQuestionBackAttachments,
  getQuestionPromptAttachments,
} from "./media-helpers";
import { fisherYatesShuffle, type RngFn } from "./shuffle";

export interface MatchCandidate {
  questionId: string;
  prompt: string;
  answer: string;
  promptImageUrl?: string | null;
  answerImageUrl?: string | null;
}

export interface MatchPair {
  pairId: string;
  questionId: string;
  prompt: string;
  answer: string;
}

export interface MatchTile {
  tileId: string;
  pairId: string;
  questionId: string;
  side: "prompt" | "answer";
  text: string;
  imageUrl: string | null;
}

export interface MatchRound {
  pairs: MatchPair[];
  tiles: MatchTile[];
}

export interface MatchRoundOptions {
  pairCount?: number;
  rng?: RngFn;
  startedAtMs?: number;
}

export interface MatchBoardState {
  pairs: MatchPair[];
  tiles: MatchTile[];
  selectedTileId: string | null;
  matchedPairIds: string[];
  lastPairTileIds: [string, string] | null;
  lastOutcome: "idle" | "selected" | "match" | "mismatch";
  attempts: number;
  mismatches: number;
  startedAtMs: number;
  completedAtMs: number | null;
  elapsedMs: number;
  isCompleted: boolean;
}

function normalizeForUniqueness(text: string): string {
  return text.normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Project StudyHub questions into MatchCandidates (supports flashcards, short_answer,
 * MC questions, and image-bearing / image-only prompts or answers).
 */
export function questionsToMatchCandidates(
  questions: readonly Question[],
): MatchCandidate[] {
  const result: MatchCandidate[] = [];
  for (const q of questions) {
    const prompt = q.prompt.trim();
    const promptImages = getQuestionPromptAttachments(q);
    const promptImageUrl = promptImages[0]?.url ?? q.prompt_image_url ?? null;
    if (!prompt && !promptImageUrl) continue;

    let answer = "";
    const backImages = getQuestionBackAttachments(q);
    let answerImageUrl: string | null = backImages[0]?.url ?? q.back_image_url ?? null;

    if (q.back_text && q.back_text.trim()) {
      answer = q.back_text.trim();
    } else if (q.accepted_answers && q.accepted_answers.length > 0) {
      answer = q.accepted_answers[0].answer_text.trim();
    } else if (q.options && q.options.length > 0) {
      const correctOpts = q.options.filter((o) => o.is_correct);
      if (correctOpts.length > 0) {
        answer = correctOpts
          .map((o) => o.content.trim())
          .filter(Boolean)
          .join("; ");
        for (const opt of correctOpts) {
          const optImgs = getOptionAttachments(opt);
          if (optImgs[0]?.url) {
            answerImageUrl = optImgs[0].url;
            break;
          }
          if (opt.image_url) {
            answerImageUrl = opt.image_url;
            break;
          }
        }
      }
    }

    if (!answer && !answerImageUrl) continue;
    result.push({
      questionId: q.id,
      prompt,
      answer,
      promptImageUrl,
      answerImageUrl,
    });
  }
  return result;
}

/**
 * Generate a Match round of up to `pairCount` pairs.
 * Strictly guarantees NO two cards in the same round share identical normalized definition or prompt text/image.
 */
export function generateMatchRound(
  candidates: readonly MatchCandidate[],
  options: MatchRoundOptions = {},
): MatchRound {
  const pairCount = Math.max(1, options.pairCount ?? 6);
  const rng = options.rng ?? Math.random;

  const shuffledCandidates = fisherYatesShuffle(candidates, rng);
  const seenPrompts = new Set<string>();
  const seenAnswers = new Set<string>();
  const pairs: MatchPair[] = [];
  const rawTiles: MatchTile[] = [];

  for (const candidate of shuffledCandidates) {
    if (pairs.length >= pairCount) break;
    const normPrompt =
      normalizeForUniqueness(candidate.prompt) ||
      (candidate.promptImageUrl ? `img:${candidate.promptImageUrl}` : "");
    const normAnswer =
      normalizeForUniqueness(candidate.answer) ||
      (candidate.answerImageUrl ? `img:${candidate.answerImageUrl}` : "");

    if (!normPrompt || !normAnswer) continue;
    if (seenPrompts.has(normPrompt) || seenAnswers.has(normAnswer)) {
      continue; // Skip ambiguous duplicate definitions/prompts
    }

    seenPrompts.add(normPrompt);
    seenAnswers.add(normAnswer);

    const pairId = `pair-${pairs.length + 1}-${candidate.questionId}`;
    pairs.push({
      pairId,
      questionId: candidate.questionId,
      prompt: candidate.prompt.trim(),
      answer: candidate.answer.trim(),
    });

    rawTiles.push(
      {
        tileId: `${pairId}-prompt`,
        pairId,
        questionId: candidate.questionId,
        side: "prompt",
        text: candidate.prompt.trim(),
        imageUrl: candidate.promptImageUrl ?? null,
      },
      {
        tileId: `${pairId}-answer`,
        pairId,
        questionId: candidate.questionId,
        side: "answer",
        text: candidate.answer.trim(),
        imageUrl: candidate.answerImageUrl ?? null,
      },
    );
  }

  return {
    pairs,
    tiles: fisherYatesShuffle(rawTiles, rng),
  };
}

/**
 * Create a fresh playable MatchBoardState.
 */
export function createMatchBoard(
  candidates: readonly MatchCandidate[],
  options: MatchRoundOptions = {},
): MatchBoardState {
  const round = generateMatchRound(candidates, options);
  const startedAtMs = options.startedAtMs ?? Date.now();

  return {
    pairs: round.pairs,
    tiles: round.tiles,
    selectedTileId: null,
    matchedPairIds: [],
    lastPairTileIds: null,
    lastOutcome: "idle",
    attempts: 0,
    mismatches: 0,
    startedAtMs,
    completedAtMs: round.pairs.length === 0 ? startedAtMs : null,
    elapsedMs: 0,
    isCompleted: round.pairs.length === 0,
  };
}

/**
 * Handle selecting a tile on the Match board deterministically.
 */
export function selectMatchTile(
  board: MatchBoardState,
  tileId: string,
  nowMs: number = Date.now(),
): MatchBoardState {
  if (board.isCompleted) return board;

  const clicked = board.tiles.find((t) => t.tileId === tileId);
  if (!clicked) return board;

  // Ignore already-matched tiles
  if (board.matchedPairIds.includes(clicked.pairId)) {
    return board;
  }

  // Clicking the currently selected tile deselects it
  if (board.selectedTileId === tileId) {
    return {
      ...board,
      selectedTileId: null,
      lastPairTileIds: null,
      lastOutcome: "idle",
    };
  }

  // First tile of a pair selection
  if (!board.selectedTileId) {
    return {
      ...board,
      selectedTileId: tileId,
      lastPairTileIds: null,
      lastOutcome: "selected",
    };
  }

  const first = board.tiles.find((t) => t.tileId === board.selectedTileId);
  if (!first) {
    return {
      ...board,
      selectedTileId: tileId,
      lastPairTileIds: null,
      lastOutcome: "selected",
    };
  }

  const attempts = board.attempts + 1;
  const isMatch = first.pairId === clicked.pairId && first.side !== clicked.side;

  if (isMatch) {
    const matchedPairIds = [...board.matchedPairIds, clicked.pairId];
    const isCompleted = matchedPairIds.length >= board.pairs.length;
    const elapsedMs = Math.max(0, nowMs - board.startedAtMs);

    return {
      ...board,
      selectedTileId: null,
      matchedPairIds,
      lastPairTileIds: [first.tileId, clicked.tileId],
      lastOutcome: "match",
      attempts,
      completedAtMs: isCompleted ? nowMs : null,
      elapsedMs,
      isCompleted,
    };
  }

  return {
    ...board,
    selectedTileId: null,
    lastPairTileIds: [first.tileId, clicked.tileId],
    lastOutcome: "mismatch",
    attempts,
    mismatches: board.mismatches + 1,
    elapsedMs: Math.max(0, nowMs - board.startedAtMs),
  };
}
