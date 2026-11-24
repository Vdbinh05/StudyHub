import { describe, expect, it } from "vitest";
import {
  QUESTION_TYPE_REGISTRY,
  extractQuestionPlainText,
  getCompatibleModesForQuestion,
  gradeQuestionResponse,
  parseNumericalInput,
  validateQuestionByType,
  validateResponseByType,
  type QuestionLike,
} from "@/lib/questions";
import { V3_QUESTION_TYPES } from "@/types/v3";

describe("V3 12-Question-Type Registry & Deterministic Graders", () => {
  it("declares descriptors, modes, offline & PDF flags for all 13 QuestionTypes (12 exam + flashcard)", () => {
    for (const type of V3_QUESTION_TYPES) {
      const desc = QUESTION_TYPE_REGISTRY[type];
      expect(desc).toBeDefined();
      expect(desc.type).toBe(type);
      expect(desc.labelVi.length).toBeGreaterThan(0);
      expect(desc.labelEn.length).toBeGreaterThan(0);
      expect(desc.compatibleModes.length).toBeGreaterThan(0);
      expect(typeof desc.supportsOffline).toBe("boolean");
      expect(typeof desc.supportsPdfPaper).toBe("boolean");
    }
    expect(QUESTION_TYPE_REGISTRY.flashcard.isExamCompatible).toBe(false);
    expect(QUESTION_TYPE_REGISTRY.image_choice.compatibleModes).not.toContain("write");
    expect(QUESTION_TYPE_REGISTRY.image_choice.compatibleModes).not.toContain("spell");
  });

  it("grades single_choice, true_false, and multiple_choice (exact + strict partial_credit without wrong-guess credit)", () => {
    const mc: QuestionLike = {
      question_type: "multiple_choice",
      prompt: "Select all prime numbers:",
      options: [
        { id: "opt-2", content: "2", is_correct: true },
        { id: "opt-3", content: "3", is_correct: true },
        { id: "opt-4", content: "4", is_correct: false },
        { id: "opt-6", content: "6", is_correct: false },
      ],
    };

    expect(validateQuestionByType(mc).valid).toBe(true);
    // Exact match -> 1.0
    expect(
      gradeQuestionResponse(mc, {
        kind: "options",
        selected_option_ids: ["opt-3", "opt-2"],
      }),
    ).toMatchObject({ isCorrect: true, scoreRatio: 1 });

    // Default (no partial credit) -> 0
    expect(
      gradeQuestionResponse(mc, {
        kind: "options",
        selected_option_ids: ["opt-2"],
      }),
    ).toMatchObject({ isCorrect: false, scoreRatio: 0 });

    // Explicit partial credit: 1 right, 0 wrong -> 0.5
    expect(
      gradeQuestionResponse(
        mc,
        { kind: "options", selected_option_ids: ["opt-2"] },
        { partialCredit: true },
      ),
    ).toMatchObject({ isCorrect: false, scoreRatio: 0.5 });

    // Explicit partial credit: 1 right + 1 wrong -> penalized to 0 (no accidental wrong-selection credit!)
    expect(
      gradeQuestionResponse(
        mc,
        { kind: "options", selected_option_ids: ["opt-2", "opt-4"] },
        { partialCredit: true },
      ),
    ).toMatchObject({ isCorrect: false, scoreRatio: 0 });

    // Explicit partial credit: all 4 selected -> 0 (2 right - 2 wrong = 0)
    expect(
      gradeQuestionResponse(
        mc,
        { kind: "options", selected_option_ids: ["opt-2", "opt-3", "opt-4", "opt-6"] },
        { partialCredit: true },
      ),
    ).toMatchObject({ isCorrect: false, scoreRatio: 0 });
  });

  it("grades fill_in_blank across multiple blanks preserving decimals, negatives, and diacritics", () => {
    const q: QuestionLike = {
      question_type: "fill_in_blank",
      prompt: "Water freezes at {{b1}} °C and ISA pressure is {{b2}} hPa in {{b3}}.",
      type_payload: {
        type: "fill_in_blank",
        blanks: [
          { blank_id: "b1", accepted_answers: ["0"], match_mode: "numeric" },
          { blank_id: "b2", accepted_answers: ["-0.5", "1013.25"], match_mode: "numeric" },
          { blank_id: "b3", accepted_answers: ["Hà Nội"], match_mode: "case_insensitive" },
        ],
      },
    };

    expect(validateQuestionByType(q).valid).toBe(true);
    expect(
      gradeQuestionResponse(q, {
        kind: "blanks",
        answers: { b1: "0", b2: "-0.5", b3: "hà nội" },
      }),
    ).toMatchObject({ isCorrect: true, scoreRatio: 1 });

    // Must not strip diacritics when match_mode is case_insensitive (not ignore_diacritics)
    expect(
      gradeQuestionResponse(q, {
        kind: "blanks",
        answers: { b1: "0", b2: "1013.25", b3: "ha noi" },
      }),
    ).toMatchObject({ isCorrect: false, scoreRatio: 0 });

    // Partial credit returns 2/3
    expect(
      gradeQuestionResponse(
        q,
        { kind: "blanks", answers: { b1: "0", b2: "1013.25", b3: "ha noi" } },
        { partialCredit: true },
      ).scoreRatio,
    ).toBeCloseTo(0.6667, 3);
  });

  it("grades numerical with integers (0/10/100), negatives (-0.5), scientific notation, tolerances, and strict unit rejection", () => {
    expect(parseNumericalInput("0")).toEqual({ value: 0, unit: null });
    expect(parseNumericalInput("10")).toEqual({ value: 10, unit: null });
    expect(parseNumericalInput("100")).toEqual({ value: 100, unit: null });
    expect(parseNumericalInput("-0.5")).toEqual({ value: -0.5, unit: null });
    expect(parseNumericalInput("1.5e-2 m/s")).toEqual({ value: 0.015, unit: "m/s" });
    expect(parseNumericalInput("3.0 × 10^8 m/s")).toEqual({ value: 3e8, unit: "m/s" });

    const qZero: QuestionLike = {
      question_type: "numerical",
      prompt: "Freezing point in °C?",
      type_payload: { type: "numerical", correct_value: 0 },
    };
    expect(gradeQuestionResponse(qZero, { kind: "numerical", value: "0" }).isCorrect).toBe(true);
    expect(gradeQuestionResponse(qZero, { kind: "numerical", value: "10" }).isCorrect).toBe(false);

    const qTen: QuestionLike = {
      question_type: "numerical",
      prompt: "10 x 1 = ?",
      type_payload: { type: "numerical", correct_value: 10 },
    };
    expect(gradeQuestionResponse(qTen, { kind: "numerical", value: "10" }).isCorrect).toBe(true);
    expect(gradeQuestionResponse(qTen, { kind: "numerical", value: "100" }).isCorrect).toBe(false);
    expect(gradeQuestionResponse(qTen, { kind: "numerical", value: "1" }).isCorrect).toBe(false);

    const qUnit: QuestionLike = {
      question_type: "numerical",
      prompt: "Standard sea-level pressure?",
      type_payload: {
        type: "numerical",
        correct_value: 1013.25,
        abs_tolerance: 0.25,
        unit: "hPa",
        accepted_units: ["mb"],
        unit_required: true,
      },
    };
    expect(gradeQuestionResponse(qUnit, { kind: "numerical", value: "1013.5 hPa" }).isCorrect).toBe(true);
    expect(gradeQuestionResponse(qUnit, { kind: "numerical", value: "1013.25 mb" }).isCorrect).toBe(true);
    // Missing required unit -> rejected
    expect(gradeQuestionResponse(qUnit, { kind: "numerical", value: "1013.25" })).toMatchObject({
      isCorrect: false,
      reason: "missing_unit",
    });
    // Dimensionally wrong unit -> ALWAYS rejected!
    expect(gradeQuestionResponse(qUnit, { kind: "numerical", value: "1013.25 kt" })).toMatchObject({
      isCorrect: false,
      reason: "wrong_unit",
    });
  });

  it("validates image-only image_choice options and grades by stable option UUID", () => {
    const q: QuestionLike = {
      question_type: "image_choice",
      prompt: "Which diagram shows a cold front?",
      type_payload: { type: "image_choice", selection_mode: "single" },
      options: [
        { id: "img-opt-1", content: "", image_url: "/api/uploads/signed-url?path=u/s/a.png&redirect=1", is_correct: false },
        { id: "img-opt-2", content: "", image_url: "/api/uploads/signed-url?path=u/s/b.png&redirect=1", is_correct: true },
      ],
    };

    expect(validateQuestionByType(q).valid).toBe(true);
    expect(
      gradeQuestionResponse(q, { kind: "options", selected_option_ids: ["img-opt-2"] }).isCorrect,
    ).toBe(true);
    expect(getCompatibleModesForQuestion(q)).not.toContain("write");
  });

  it("grades ordering by stable item IDs and matching with duplicate display labels by stable pair IDs", () => {
    const ordering: QuestionLike = {
      question_type: "ordering",
      prompt: "Order atmospheric layers from lowest to highest:",
      type_payload: {
        type: "ordering",
        items: [
          { id: "i-trop", text: "Troposphere", correct_position: 0 },
          { id: "i-strat", text: "Stratosphere", correct_position: 1 },
          { id: "i-meso", text: "Mesosphere", correct_position: 2 },
        ],
      },
    };
    expect(validateQuestionByType(ordering).valid).toBe(true);
    expect(
      gradeQuestionResponse(ordering, {
        kind: "ordering",
        ordered_item_ids: ["i-trop", "i-strat", "i-meso"],
      }).isCorrect,
    ).toBe(true);
    expect(
      gradeQuestionResponse(ordering, {
        kind: "ordering",
        ordered_item_ids: ["i-strat", "i-trop", "i-meso"],
      }).isCorrect,
    ).toBe(false);

    // Matching with duplicate right-side display label ("Gas") distinguished strictly by right_id!
    const matching: QuestionLike = {
      question_type: "matching",
      prompt: "Match each substance to its specific slot:",
      type_payload: {
        type: "matching",
        pairs: [
          { id: "p1", left_text: "Oxygen", right_id: "r1", right_text: "Gas" },
          { id: "p2", left_text: "Nitrogen", right_id: "r2", right_text: "Gas" },
        ],
      },
    };
    expect(validateQuestionByType(matching).valid).toBe(true);
    expect(
      gradeQuestionResponse(matching, {
        kind: "matching",
        pairs: { p1: "r1", p2: "r2" },
      }).isCorrect,
    ).toBe(true);
    // Swapping r1/r2 fails even though display text is identical
    expect(
      gradeQuestionResponse(matching, {
        kind: "matching",
        pairs: { p1: "r2", p2: "r1" },
      }).isCorrect,
    ).toBe(false);
  });

  it("grades image_hotspot (point, rect, polygon), reading_passage, listening, and explicit short_answer self_assessed", () => {
    const hotspot: QuestionLike = {
      question_type: "image_hotspot",
      prompt: "Click the triangle region:",
      type_payload: {
        type: "image_hotspot",
        image_url: "/api/uploads/signed-url?path=u/s/diag.png&redirect=1",
        target_hotspots: [
          {
            id: "hs-poly",
            label: "Apex zone",
            shape: "polygon",
            geometry: {
              shape: "polygon",
              points: [
                { x: 0.2, y: 0.2 },
                { x: 0.8, y: 0.2 },
                { x: 0.5, y: 0.8 },
              ],
            },
          },
        ],
      },
    };
    expect(validateQuestionByType(hotspot).valid).toBe(true);
    expect(
      gradeQuestionResponse(hotspot, { kind: "hotspot", clicks: [{ x: 0.5, y: 0.4 }] }).isCorrect,
    ).toBe(true);
    expect(
      gradeQuestionResponse(hotspot, { kind: "hotspot", clicks: [{ x: 0.1, y: 0.9 }] }).isCorrect,
    ).toBe(false);
    // Keyboard accessible selection
    expect(
      gradeQuestionResponse(hotspot, {
        kind: "hotspot",
        clicks: [],
        selected_hotspot_ids: ["hs-poly"],
      }).isCorrect,
    ).toBe(true);

    // Reading passage
    const passage: QuestionLike = {
      question_type: "reading_passage",
      prompt: "What is the main idea?",
      type_payload: {
        type: "reading_passage",
        passage_title: "Passage 1",
        passage_text: "The jet stream flows west to east.",
        sub_answer_kind: "single_choice",
      },
      options: [
        { id: "p-a", content: "West to east", is_correct: true },
        { id: "p-b", content: "East to west", is_correct: false },
      ],
    };
    expect(validateQuestionByType(passage).valid).toBe(true);
    expect(
      gradeQuestionResponse(passage, { kind: "options", selected_option_ids: ["p-a"] }).isCorrect,
    ).toBe(true);
    expect(extractQuestionPlainText(passage)).toContain("jet stream");

    // Listening
    const listening: QuestionLike = {
      question_type: "listening",
      prompt: "Type the runway heading announced:",
      type_payload: {
        type: "listening",
        audio_url: "/api/uploads/signed-url?path=u/s/clip.mp3&redirect=1",
        transcript: "Runway two seven",
        show_transcript_after_submit: true,
        max_replays: 2,
        sub_answer_kind: "short_answer",
      },
      accepted_answers: [{ answer_text: "27", match_mode: "numeric" }],
    };
    expect(validateQuestionByType(listening).valid).toBe(true);
    expect(validateResponseByType(listening, { kind: "text", value: "27" }).valid).toBe(true);
    expect(gradeQuestionResponse(listening, { kind: "text", value: "27" }).isCorrect).toBe(true);

    // Short answer explicit self_assessed distinction
    const sa: QuestionLike = {
      question_type: "short_answer",
      prompt: "Define adiabatic lapse rate:",
      accepted_answers: [{ answer_text: "Temperature change without heat exchange" }],
    };
    const autoFail = gradeQuestionResponse(sa, { kind: "text", value: "Cooling with height no heat transfer" });
    expect(autoFail).toMatchObject({ isCorrect: false, gradingMode: "deterministic" });
    const selfPass = gradeQuestionResponse(
      sa,
      { kind: "text", value: "Cooling with height no heat transfer" },
      { selfAssessedCorrect: true },
    );
    expect(selfPass).toMatchObject({ isCorrect: true, gradingMode: "self_assessed" });
  });
});
