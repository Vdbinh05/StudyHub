import { describe, expect, it } from "vitest";
import {
  createMatchBoard,
  generateMatchRound,
  selectMatchTile,
  type MatchCandidate,
} from "@/lib/learning/match-engine";
import { createSeededRng } from "@/lib/learning/shuffle";

describe("Deterministic Match Mode Engine (match-engine.ts)", () => {
  it("selects N pairs and guarantees NO two cards in the same round share identical definition or prompt text", () => {
    const candidates: MatchCandidate[] = [
      { questionId: "q1", prompt: "2 + 2", answer: "4" },
      { questionId: "q2", prompt: "1 + 3", answer: "4" }, // Duplicate definition "4"!
      { questionId: "q3", prompt: "2 + 2", answer: "Four" }, // Duplicate prompt "2 + 2"!
      { questionId: "q4", prompt: "3 + 3", answer: "6" },
      { questionId: "q5", prompt: "4 + 4", answer: "8" },
      { questionId: "q6", prompt: "5 + 5", answer: "10" },
    ];

    const round = generateMatchRound(candidates, {
      pairCount: 6,
      rng: createSeededRng("match-seed-1"),
    });

    // Duplicate definition & duplicate prompt must be excluded -> max 4 unambiguous pairs
    expect(round.pairs).toHaveLength(4);
    expect(round.tiles).toHaveLength(8);

    const normalizedAnswers = round.pairs.map((p) => p.answer.trim().toLowerCase());
    const normalizedPrompts = round.pairs.map((p) => p.prompt.trim().toLowerCase());
    expect(new Set(normalizedAnswers).size).toBe(round.pairs.length);
    expect(new Set(normalizedPrompts).size).toBe(round.pairs.length);
  });

  it("tracks correct matches, mismatches, and completion time deterministically", () => {
    const candidates: MatchCandidate[] = [
      { questionId: "q1", prompt: "Vietnam", answer: "Hanoi" },
      { questionId: "q2", prompt: "Japan", answer: "Tokyo" },
      { questionId: "q3", prompt: "France", answer: "Paris" },
    ];

    let board = createMatchBoard(candidates, {
      pairCount: 3,
      rng: createSeededRng("match-seed-2"),
      startedAtMs: 1_000,
    });

    const vietnamTile = board.tiles.find((t) => t.side === "prompt" && t.text === "Vietnam")!;
    const hanoiTile = board.tiles.find((t) => t.side === "answer" && t.text === "Hanoi")!;
    const tokyoTile = board.tiles.find((t) => t.side === "answer" && t.text === "Tokyo")!;
    const japanTile = board.tiles.find((t) => t.side === "prompt" && t.text === "Japan")!;
    const franceTile = board.tiles.find((t) => t.side === "prompt" && t.text === "France")!;
    const parisTile = board.tiles.find((t) => t.side === "answer" && t.text === "Paris")!;

    // Wrong pair: Vietnam + Tokyo
    board = selectMatchTile(board, vietnamTile.tileId, 1_500);
    expect(board.selectedTileId).toBe(vietnamTile.tileId);
    board = selectMatchTile(board, tokyoTile.tileId, 2_000);
    expect(board.lastOutcome).toBe("mismatch");
    expect(board.mismatches).toBe(1);
    expect(board.attempts).toBe(1);
    expect(board.matchedPairIds).toHaveLength(0);

    // Correct pair 1: Vietnam + Hanoi
    board = selectMatchTile(board, vietnamTile.tileId, 2_500);
    board = selectMatchTile(board, hanoiTile.tileId, 3_000);
    expect(board.lastOutcome).toBe("match");
    expect(board.matchedPairIds).toContain(vietnamTile.pairId);

    // Correct pair 2 & 3 -> completes board
    board = selectMatchTile(board, japanTile.tileId, 3_500);
    board = selectMatchTile(board, tokyoTile.tileId, 4_000);
    board = selectMatchTile(board, franceTile.tileId, 4_500);
    board = selectMatchTile(board, parisTile.tileId, 5_500);

    expect(board.isCompleted).toBe(true);
    expect(board.elapsedMs).toBe(4_500);
    expect(board.attempts).toBe(4);
    expect(board.mismatches).toBe(1);
  });
});
