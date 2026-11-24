import { describe, expect, it } from "vitest";
import {
  advanceAdaptiveLearnRound,
  buildSessionChoiceAnswerPayload,
  createAdaptiveLearnState,
  filterAdaptiveLearnSeeds,
  getCompatibleLearnActivities,
  getCurrentAdaptiveCard,
  isValidUuid,
  LEARN_OBJECTIVES,
  recordAdaptiveLearnStep,
  selectActivityForStage,
  type AdaptiveLearnItemSeed,
} from "@/lib/learning/adaptive-learn";
import type { Question, UserQuestionProgress } from "@/types/domain";

function makeQuestion(
  id: string,
  overrides: Partial<Question> = {},
): Question {
  return {
    id,
    study_set_id: "set-1",
    question_type: "flashcard",
    position: 0,
    chapter: "Chapter 1",
    prompt: `Term ${id}`,
    prompt_image_url: null,
    back_text: `Answer ${id}`,
    back_image_url: null,
    explanation: null,
    hint: null,
    difficulty: "medium",
    source_metadata: {},
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("Advanced Adaptive Learn Mode Engine (V3)", () => {
  it("defines all 5 learning objectives with clear target stages", () => {
    expect(LEARN_OBJECTIVES.map((o) => o.id)).toEqual([
      "familiarize",
      "memorize",
      "master",
      "review",
      "exam_prep",
    ]);
  });

  it("NEVER assigns text Write or Spell to image-only, image_choice, hotspot, ordering, or matching questions", () => {
    const imgChoice = makeQuestion("q-img", {
      question_type: "image_choice",
      options: [
        {
          id: "o1",
          question_id: "q-img",
          study_set_id: "set-1",
          position: 0,
          label: "A",
          content: "",
          image_url: "/api/uploads/signed-url?path=a.png&redirect=1",
          is_correct: true,
          created_at: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    const imgActivities = getCompatibleLearnActivities(imgChoice);
    expect(imgActivities).not.toContain("write");
    expect(imgActivities).not.toContain("spell");
    expect(selectActivityForStage(imgChoice, 3)).toBe("multiple_choice");

    const hotspot = makeQuestion("q-hot", {
      question_type: "image_hotspot",
      back_text: null,
    });
    expect(getCompatibleLearnActivities(hotspot)).not.toContain("write");
    expect(selectActivityForStage(hotspot, 3)).toBe("hotspot");

    const imageOnlyCard = makeQuestion("q-card-img", {
      question_type: "flashcard",
      back_text: "",
      back_image_url: "/api/uploads/signed-url?path=b.png&redirect=1",
    });
    expect(getCompatibleLearnActivities(imageOnlyCard)).toEqual(["flashcard"]);

    const numerical = makeQuestion("q-num", {
      question_type: "numerical",
      back_text: null,
      type_payload: { type: "numerical", correct_value: 1013.25, unit: "hPa" },
    });
    expect(selectActivityForStage(numerical, 3)).toBe("numerical");
  });

  it("enforces 5-stage mastery progression — Stage 2 Recognition alone NEVER graduates to Stage 5", () => {
    const q1 = makeQuestion("q1");
    const q2 = makeQuestion("q2");
    const q3 = makeQuestion("q3");

    const seeds: AdaptiveLearnItemSeed[] = [q1, q2, q3].map((question) => ({
      question,
      progress: null,
      isStarred: false,
    }));

    let state = createAdaptiveLearnState(seeds, {
      objective: "master",
      batchSize: 3,
      verificationMinGap: 2,
    });

    // q1 starts at Stage 1 Familiarization
    const c1 = getCurrentAdaptiveCard(state)!;
    expect(c1.questionId).toBe("q1");
    expect(c1.stage).toBe(1);

    // Stage 1 -> Stage 2
    const s1 = recordAdaptiveLearnStep(state, q1, { isCorrect: true });
    expect(s1.stageTransition).toEqual({ from: 1, to: 2 });
    expect(s1.cardGraduated).toBe(false);
    state = s1.nextState;

    // Pass Stage 1 for q2 and q3 so q1 comes back at Stage 2
    state = recordAdaptiveLearnStep(state, q2, { isCorrect: true }).nextState;
    state = recordAdaptiveLearnStep(state, q3, { isCorrect: true }).nextState;

    // Find q1 at head (Stage 2 Recognition)
    const atStage2 = getCurrentAdaptiveCard(state)!;
    expect(atStage2.questionId).toBe("q1");
    expect(atStage2.stage).toBe(2);

    // Stage 2 Recognition passed -> moves to Stage 3 Recall, MUST NOT graduate to Stage 5!
    const s2 = recordAdaptiveLearnStep(state, q1, {
      isCorrect: true,
      confidence: "certain",
    });
    expect(s2.cardGraduated).toBe(false);
    expect(s2.stageTransition).toEqual({ from: 2, to: 3 });
    expect(s2.recognitionCannotMasterNotice).toBe(true);
    expect(s2.nextState.graduatedIds).not.toContain("q1");
  });

  it("supports bounded forced correction without infinite loops and always allows skip/exit", () => {
    const q1 = makeQuestion("q1", { question_type: "short_answer" });
    const q2 = makeQuestion("q2", { question_type: "short_answer" });

    const seeds: AdaptiveLearnItemSeed[] = [q1, q2].map((question) => ({
      question,
      progress: {
        id: `p-${question.id}`,
        user_id: "u1",
        study_set_id: "set-1",
        question_id: question.id,
        mastery_level: "familiar",
        correct_count: 2,
        wrong_count: 0,
        consecutive_correct: 2,
        ease_factor: 2.5,
        interval_days: 6,
        repetitions: 2,
        last_reviewed_at: null,
        next_review_at: null,
        updated_at: "2026-01-01T00:00:00.000Z",
      },
      isStarred: false,
    }));

    let state = createAdaptiveLearnState(seeds, {
      objective: "memorize",
      forcedCorrection: true,
      maxForcedRetries: 2,
    });

    // Wrong answer on Stage 3 Write triggers forced correction
    const wrong = recordAdaptiveLearnStep(state, q1, {
      isCorrect: false,
      confidence: "certain",
    });
    expect(wrong.enteredForcedCorrection).toBe(true);
    expect(getCurrentAdaptiveCard(wrong.nextState)?.forcedCorrectionPending).toBe(
      true,
    );
    state = wrong.nextState;

    // 1st failed forced retry stays on card
    const retry1 = recordAdaptiveLearnStep(state, q1, {
      isCorrect: false,
      isForcedCorrectionAttempt: true,
    });
    expect(retry1.enteredForcedCorrection).toBe(true);
    state = retry1.nextState;

    // 2nd failed forced retry hits maxForcedRetries=2 -> gracefully releases card back into queue (no infinite loop!)
    const retry2 = recordAdaptiveLearnStep(state, q1, {
      isCorrect: false,
      isForcedCorrectionAttempt: true,
    });
    expect(retry2.enteredForcedCorrection).toBe(false);
    expect(getCurrentAdaptiveCard(retry2.nextState)?.questionId).toBe("q2");
  });

  it("prioritizes high-confidence misconceptions and due items, and filters by session config", () => {
    const now = new Date("2026-11-24T12:00:00.000Z");
    const makeProg = (
      id: string,
      overrides: Partial<UserQuestionProgress>,
    ): UserQuestionProgress => ({
      id,
      user_id: "u1",
      study_set_id: "set-1",
      question_id: id,
      mastery_level: "learning",
      correct_count: 1,
      wrong_count: 1,
      consecutive_correct: 0,
      ease_factor: 2.5,
      interval_days: 1,
      repetitions: 0,
      last_reviewed_at: "2026-11-20T00:00:00.000Z",
      next_review_at: "2026-11-25T00:00:00.000Z",
      updated_at: "2026-11-20T00:00:00.000Z",
      ...overrides,
    });

    const seeds: AdaptiveLearnItemSeed[] = [
      {
        question: makeQuestion("normal", { chapter: "Ch1" }),
        progress: makeProg("normal", { mastery_level: "mastered", wrong_count: 0 }),
        isStarred: false,
      },
      {
        question: makeQuestion("misconception", { chapter: "Ch2" }),
        progress: makeProg("misconception", {
          high_conf_wrong_count: 2,
          last_confidence: "certain",
          mistake_status: "active",
        }),
        isStarred: true,
      },
      {
        question: makeQuestion("due-item", { chapter: "Ch2" }),
        progress: makeProg("due-item", {
          next_review_at: "2026-11-23T00:00:00.000Z",
          last_confidence: "guessing",
          low_confidence_count: 1,
        }),
        isStarred: false,
      },
    ];

    const state = createAdaptiveLearnState(seeds, {
      objective: "exam_prep",
      batchSize: 2,
      now,
    });
    expect(state.activeQueue[0].questionId).toBe("misconception");
    expect(state.activeQueue[1].questionId).toBe("due-item");
    expect(state.pendingQueue[0].questionId).toBe("normal");

    // Test multi-axis filters
    expect(
      filterAdaptiveLearnSeeds(seeds, { chapters: ["Ch2"], onlyStarred: true }, now).map(
        (s) => s.question.id,
      ),
    ).toEqual(["misconception"]);
    expect(
      filterAdaptiveLearnSeeds(seeds, { onlyDue: true }, now).map(
        (s) => s.question.id,
      ),
    ).toEqual(["due-item"]);
    expect(
      filterAdaptiveLearnSeeds(seeds, { onlyLowConfidence: true }, now).map(
        (s) => s.question.id,
      ),
    ).toEqual(["misconception", "due-item"]);

    // Test round advance
    const doneRound = {
      ...state,
      activeQueue: [],
      roundCompleted: true,
    };
    const nextRound = advanceAdaptiveLearnRound(doneRound);
    expect(nextRound.roundNumber).toBe(2);
    expect(nextRound.activeQueue.map((c) => c.questionId)).toEqual(["normal"]);
  });

  it("maps synthetic flashcard recognition distractor IDs to text payloads instead of invalid UUIDs (V3-UX-02)", () => {
    const validUuid = "11111111-2222-4333-8444-555555555555";
    expect(isValidUuid(validUuid)).toBe(true);
    expect(isValidUuid(`fc-correct-${validUuid}`)).toBe(false);
    expect(isValidUuid(`fc-dist-${validUuid}`)).toBe(false);

    // Real DB question_options UUIDs -> preserve options payload
    const realPayload = buildSessionChoiceAnswerPayload([validUuid], [
      { id: validUuid, content: "Cumulonimbus", label: "A" },
    ]);
    expect(realPayload).toEqual({
      selectedOptionIds: [validUuid],
      typedAnswer: "",
      structuredResponse: {
        kind: "options",
        selected_option_ids: [validUuid],
      },
    });

    // Synthetic client-generated TSV/flashcard recognition distractor -> never sends invalid UUIDs!
    const syntheticId = `fc-correct-${validUuid}`;
    const syntheticPayload = buildSessionChoiceAnswerPayload([syntheticId], [
      {
        id: syntheticId,
        content: "Irregular motion of air resulting from eddies",
        label: "A",
      },
    ]);
    expect(syntheticPayload).toEqual({
      selectedOptionIds: [],
      typedAnswer: "Irregular motion of air resulting from eddies",
      structuredResponse: {
        kind: "text",
        value: "Irregular motion of air resulting from eddies",
      },
    });
  });
});
