import { describe, expect, it } from "vitest";
import {
  createSpellQueueState,
  diffSpelling,
  extractSpellTarget,
  generateSpellHint,
  gradeSpellingAnswer,
  recordSpellQueueAttempt,
} from "@/lib/learning/spell";
import type { Question } from "@/types/domain";

describe("Spell Mode Engine — Listen & Type (V3)", () => {
  it("preserves Vietnamese diacritics by default and supports optional ignoreAccents", () => {
    const strict = gradeSpellingAnswer("khi quyen", ["khí quyển"]);
    expect(strict.isCorrect).toBe(false);
    expect(strict.editDistance).toBe(2);

    const exact = gradeSpellingAnswer("Khí   quyển!", ["khí quyển"]);
    expect(exact.isCorrect).toBe(true);
    expect(exact.matchedAnswer).toBe("khí quyển");

    const relaxed = gradeSpellingAnswer("khi quyen", ["khí quyển"], {
      ignoreAccents: true,
    });
    expect(relaxed.isCorrect).toBe(true);
  });

  it("supports configurable case, whitespace, and punctuation sensitivity", () => {
    expect(
      gradeSpellingAnswer("cumulonimbus", ["Cumulonimbus"], {
        caseSensitive: true,
      }).isCorrect,
    ).toBe(false);

    expect(
      gradeSpellingAnswer("a  b", ["a b"], { ignoreWhitespace: false })
        .isCorrect,
    ).toBe(false);

    expect(
      gradeSpellingAnswer("altimeter", ["altimeter."], {
        ignorePunctuation: false,
      }).isCorrect,
    ).toBe(false);
  });

  it("computes deterministic character-level diffs (equal / insert / delete / substitute)", () => {
    const { editDistance, segments } = diffSpelling("pressure", "presure");
    expect(editDistance).toBe(1);
    expect(segments.some((s) => s.kind === "delete" && s.expected === "s")).toBe(
      true,
    );

    const sub = diffSpelling("cat", "cut");
    expect(sub.editDistance).toBe(1);
    expect(sub.segments).toEqual([
      { kind: "equal", expected: "c", actual: "c" },
      { kind: "substitute", expected: "a", actual: "u" },
      { kind: "equal", expected: "t", actual: "t" },
    ]);
  });

  it("supports multiple accepted answers and picks the closest candidate for diff", () => {
    const ok = gradeSpellingAnswer("QNH", ["Altimeter Setting", "QNH"]);
    expect(ok.isCorrect).toBe(true);
    expect(ok.matchedAnswer).toBe("QNH");

    const near = gradeSpellingAnswer("QFE", ["Altimeter Setting", "QNH"]);
    expect(near.isCorrect).toBe(false);
    expect(near.closestExpected).toBe("QNH");
  });

  it("enforces 5-level Hint Ladder without leaking full spelling upfront (levels 0..3)", () => {
    const h0 = generateSpellHint("troposphere", 0, "Lowest layer of atmosphere");
    expect(h0.usedHint).toBe(false);
    expect(h0.hintText).toBeNull();

    const h1 = generateSpellHint("troposphere", 1, "Lowest layer of atmosphere");
    expect(h1.usedHint).toBe(true);
    expect(h1.revealedAnswer).toBe(false);
    expect(h1.hintText).toBe("Lowest layer of atmosphere");
    expect(h1.hintText).not.toContain("troposphere");

    const h2 = generateSpellHint("troposphere", 2, "Lowest layer");
    expect(h2.revealedAnswer).toBe(false);
    expect(h2.hintText?.startsWith("t _")).toBe(true);
    expect(h2.hintText).not.toContain("troposphere");

    const h3 = generateSpellHint("cold front", 3);
    expect(h3.revealedAnswer).toBe(false);
    expect(h3.wordCount).toBe(2);
    expect(h3.charCount).toBe(9);

    const h4 = generateSpellHint("troposphere", 4);
    expect(h4.usedHint).toBe(true);
    expect(h4.revealedAnswer).toBe(true);
    expect(h4.hintText).toBe("troposphere");
  });

  it("re-prioritizes missed or revealed items in the Spell queue until spelled cleanly", () => {
    let state = createSpellQueueState(["q1", "q2", "q3"]);
    expect(state.totalItems).toBe(3);

    // Miss q1 -> re-queued after 2 cards, requires 2 passes
    state = recordSpellQueueAttempt(state, {
      isCorrect: false,
      usedHint: false,
      revealedAnswer: false,
    });
    expect(state.missedIds).toEqual(["q1"]);
    expect(state.queue.map((i) => i.questionId)).toEqual(["q2", "q3", "q1"]);

    // Spell q2 & q3 cleanly -> both complete
    state = recordSpellQueueAttempt(state, {
      isCorrect: true,
      usedHint: false,
      revealedAnswer: false,
    });
    state = recordSpellQueueAttempt(state, {
      isCorrect: true,
      usedHint: false,
      revealedAnswer: false,
    });
    expect(state.completedIds).toEqual(["q2", "q3"]);
    expect(state.queue.map((i) => i.questionId)).toEqual(["q1"]);

    // q1 needs 2 clean passes after miss
    state = recordSpellQueueAttempt(state, {
      isCorrect: true,
      usedHint: false,
      revealedAnswer: false,
    });
    expect(state.sessionCompleted).toBe(false);
    state = recordSpellQueueAttempt(state, {
      isCorrect: true,
      usedHint: false,
      revealedAnswer: false,
    });
    expect(state.sessionCompleted).toBe(true);
    expect(state.completedIds).toEqual(["q2", "q3", "q1"]);
  });

  it("prefers uploaded audio when extracting spell targets", () => {
    const q: Question = {
      id: "q-audio",
      study_set_id: "set-1",
      question_type: "listening",
      position: 0,
      chapter: "Audio",
      prompt: "Listen and spell the phrase",
      prompt_image_url: null,
      back_text: null,
      back_image_url: null,
      explanation: null,
      hint: null,
      audio_url: "/api/uploads/signed-url?path=audio.mp3&redirect=1",
      audio_transcript: "wind shear",
      type_payload: {
        type: "listening",
        audio_url: "/api/uploads/signed-url?path=audio.mp3&redirect=1",
        transcript: "wind shear",
        sub_answer_kind: "short_answer",
      },
      difficulty: "medium",
      source_metadata: {},
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    };

    const target = extractSpellTarget(q);
    expect(target.isSpellable).toBe(true);
    expect(target.uploadedAudioUrl).toBe(
      "/api/uploads/signed-url?path=audio.mp3&redirect=1",
    );
    expect(target.acceptedAnswers).toEqual(["wind shear"]);
  });
});
