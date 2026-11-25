// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  detectSpeechLanguage,
  TtsController,
  type SpeechSynthesisLike,
  type SpeechSynthesisUtteranceLike,
  type SpeechSynthesisVoiceLike,
} from "@/lib/audio/tts";
import {
  appendAdaptiveLearnSeeds,
  computeAdaptiveLearnProgress,
  createAdaptiveLearnState,
  recordAdaptiveLearnStep,
  type AdaptiveLearnItemSeed,
} from "@/lib/learning/adaptive-learn";
import {
  dedupeQuestionMediaImages,
  formatCorrectAnswerDisplay,
  formatExamSnapshotCorrectAnswer,
  isMultiSelectChoiceQuestion,
  type FormatAnswerQuestionLike,
} from "@/lib/learning/answer-display";
import {
  clearLocalCheckpoint,
  loadLocalCheckpoint,
  pruneLocalCheckpointsForUser,
  saveLocalCheckpoint,
} from "@/lib/learning/checkpoints";
import {
  buildExamDraftKey,
  clearExamDraft,
  EXAM_DRAFT_TTL_MS,
  loadExamDraft,
  pruneStaleExamDrafts,
  saveExamDraft,
  type ExamDraftEntry,
} from "@/lib/learning/exam-draft";
import { localizeAllocationError } from "@/components/exam/exam-labels";
import { deterministicShuffleBySeed } from "@/components/learning/V3StructuredPracticeControls";
import type { ExamSnapshotQuestion, Question } from "@/types/domain";

function makeBaseQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: overrides.id ?? "q-1",
    study_set_id: "set-1",
    position: 0,
    question_type: "single_choice",
    prompt: "Sample prompt",
    prompt_image_url: null,
    back_text: null,
    back_image_url: null,
    hint: null,
    explanation: null,
    chapter: null,
    difficulty: "medium",
    source_metadata: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    options: [],
    accepted_answers: [],
    ...overrides,
  };
}

class FakeUtterance implements SpeechSynthesisUtteranceLike {
  text: string;
  lang = "";
  voice: SpeechSynthesisVoiceLike | null = null;
  rate = 1;
  pitch = 1;
  volume = 1;
  onstart: (() => void) | null = null;
  onend: (() => void) | null = null;
  onerror: ((event: { error?: string }) => void) | null = null;
  onpause: (() => void) | null = null;
  onresume: (() => void) | null = null;
  constructor(text: string) {
    this.text = text;
  }
}

class LegacyOnVoicesChangedSynth implements SpeechSynthesisLike {
  voices: SpeechSynthesisVoiceLike[] = [];
  speaking = false;
  paused = false;
  spoken: FakeUtterance[] = [];
  onvoiceschanged: (() => void) | null = null;

  getVoices(): SpeechSynthesisVoiceLike[] {
    return this.voices;
  }
  speak(utterance: SpeechSynthesisUtteranceLike): void {
    this.speaking = true;
    this.spoken.push(utterance as FakeUtterance);
  }
  cancel(): void {
    this.speaking = false;
    this.paused = false;
  }
  pause(): void {
    this.paused = true;
  }
  resume(): void {
    this.paused = false;
  }
}

describe("StudyHub V3.2 Learning & Exam Regressions", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  describe("V32-003 & V32-050: formatCorrectAnswerDisplay across all 13 question types (ZERO [object Object])", () => {
    it("formats short_answer accepted_answers cleanly without [object Object]", () => {
      const q: FormatAnswerQuestionLike = {
        question_type: "short_answer",
        accepted_answers: [
          { answer_text: "Tokyo", match_mode: "case_insensitive" },
          { answer_text: "Tōkyō", match_mode: "ignore_diacritics" },
        ],
      };
      const out = formatCorrectAnswerDisplay(q, "vi");
      expect(out).toBe("Tokyo / Tōkyō");
      expect(out).not.toContain("[object Object]");
    });

    it("formats flashcard back_text cleanly", () => {
      const q: FormatAnswerQuestionLike = {
        question_type: "flashcard",
        back_text: "Độ cao so với mực nước biển",
      };
      expect(formatCorrectAnswerDisplay(q, "vi")).toBe(
        "Độ cao so với mực nước biển",
      );
    });

    it("formats single_choice, multiple_choice, true_false, and image-only image_choice", () => {
      expect(
        formatCorrectAnswerDisplay(
          {
            question_type: "single_choice",
            options: [
              { id: "1", label: "A", content: "Sai", image_url: null, is_correct: false },
              { id: "2", label: "B", content: "Đúng", image_url: null, is_correct: true },
            ],
          },
          "vi",
        ),
      ).toBe("Đúng");

      expect(
        formatCorrectAnswerDisplay(
          {
            question_type: "multiple_choice",
            options: [
              { id: "1", label: "A", content: "Nitơ", image_url: null, is_correct: true },
              { id: "2", label: "B", content: "Oxy", image_url: null, is_correct: true },
              { id: "3", label: "C", content: "Sắt", image_url: null, is_correct: false },
            ],
          },
          "vi",
        ),
      ).toBe("Nitơ · Oxy");

      expect(
        formatCorrectAnswerDisplay(
          {
            question_type: "true_false",
            options: [
              { id: "1", label: "A", content: "Đúng", image_url: null, is_correct: true },
              { id: "2", label: "B", content: "Sai", image_url: null, is_correct: false },
            ],
          },
          "vi",
        ),
      ).toBe("Đúng");

      expect(
        formatCorrectAnswerDisplay(
          {
            question_type: "image_choice",
            type_payload: { type: "image_choice", selection_mode: "single" },
            options: [
              {
                id: "1",
                label: "A",
                content: "",
                image_url: "https://example.com/a.png",
                is_correct: true,
              },
            ],
          },
          "vi",
        ),
      ).toContain("A");
    });

    it("formats numerical, fill_in_blank, ordering, matching, image_hotspot, reading_passage, and listening", () => {
      expect(
        formatCorrectAnswerDisplay(
          {
            question_type: "numerical",
            type_payload: {
              type: "numerical",
              correct_value: 9.8,
              unit: "m/s2",
              unit_required: true,
            },
          },
          "en",
        ),
      ).toBe("9.8 m/s2");

      expect(
        formatCorrectAnswerDisplay(
          {
            question_type: "fill_in_blank",
            type_payload: {
              type: "fill_in_blank",
              blanks: [
                { blank_id: "b1", accepted_answers: ["alpha", "Alpha"] },
                { blank_id: "b2", accepted_answers: ["beta"] },
              ],
            },
          },
          "en",
        ),
      ).toBe("[1] alpha / Alpha · [2] beta");

      expect(
        formatCorrectAnswerDisplay(
          {
            question_type: "ordering",
            type_payload: {
              type: "ordering",
              items: [
                { id: "i2", text: "Second", correct_position: 1 },
                { id: "i1", text: "First", correct_position: 0 },
                { id: "i3", text: "Third", correct_position: 2 },
              ],
            },
          },
          "en",
        ),
      ).toBe("1. First → 2. Second → 3. Third");

      expect(
        formatCorrectAnswerDisplay(
          {
            question_type: "matching",
            type_payload: {
              type: "matching",
              pairs: [
                { id: "p1", left_text: "H2O", right_id: "r1", right_text: "Water" },
                { id: "p2", left_text: "O2", right_id: "r2", right_text: "Oxygen" },
              ],
            },
          },
          "en",
        ),
      ).toBe("H2O → Water · O2 → Oxygen");

      expect(
        formatCorrectAnswerDisplay(
          {
            question_type: "image_hotspot",
            type_payload: {
              type: "image_hotspot",
              image_url: "https://example.com/plane.png",
              target_hotspots: [
                {
                  id: "h1",
                  label: "Cockpit",
                  shape: "point",
                  geometry: { shape: "point", x: 0.2, y: 0.5, radius: 0.05 },
                },
                {
                  id: "h2",
                  label: "Rudder",
                  shape: "point",
                  geometry: { shape: "point", x: 0.9, y: 0.3, radius: 0.05 },
                },
              ],
            },
          },
          "en",
        ),
      ).toBe("Cockpit, Rudder");

      expect(
        formatCorrectAnswerDisplay(
          {
            question_type: "reading_passage",
            type_payload: {
              type: "reading_passage",
              passage_text: "Short passage",
              sub_answer_kind: "short_answer",
            },
            accepted_answers: [{ answer_text: "Stratosphere" }],
          },
          "en",
        ),
      ).toBe("Stratosphere");

      expect(
        formatCorrectAnswerDisplay(
          {
            question_type: "listening",
            type_payload: {
              type: "listening",
              audio_url: "https://example.com/a.mp3",
              sub_answer_kind: "fill_in_blank",
            },
            accepted_answers: [{ answer_text: "altitude" }],
          },
          "en",
        ),
      ).toBe("altitude");
    });

    it("formats submitted exam snapshot questions cleanly", () => {
      const snap = {
        id: "aq-1",
        attempt_id: "att-1",
        question_id: "q-1",
        position: 0,
        question_type: "short_answer",
        prompt_snapshot: "Capital of Japan?",
        prompt_image_url_snapshot: null,
        explanation_snapshot: null,
        options_snapshot: [],
        accepted_answers_snapshot: [
          { answer_text: "Tokyo", match_mode: "case_insensitive" },
        ],
        selected_option_ids: [],
        typed_answer: "Kyoto",
        is_flagged: false,
        is_correct: false,
        answered_at: null,
      } as unknown as ExamSnapshotQuestion;

      expect(formatExamSnapshotCorrectAnswer(snap, "vi")).toBe("Tokyo");
    });
  });

  describe("V32-020/021: isMultiSelectChoiceQuestion & deterministicShuffleBySeed", () => {
    it("detects multi-select across V1 and V3 choice types", () => {
      expect(
        isMultiSelectChoiceQuestion({ question_type: "multiple_choice" }),
      ).toBe(true);
      expect(
        isMultiSelectChoiceQuestion({
          question_type: "image_choice",
          type_payload: { type: "image_choice", selection_mode: "multiple" },
        }),
      ).toBe(true);
      expect(
        isMultiSelectChoiceQuestion({
          question_type: "image_choice",
          type_payload: { type: "image_choice", selection_mode: "single" },
        }),
      ).toBe(false);
      expect(
        isMultiSelectChoiceQuestion({
          question_type: "reading_passage",
          type_payload: {
            type: "reading_passage",
            sub_answer_kind: "multiple_choice",
          },
        }),
      ).toBe(true);
      expect(
        isMultiSelectChoiceQuestion({
          question_type: "listening",
          type_payload: {
            type: "listening",
            sub_answer_kind: "multiple_choice",
          },
        }),
      ).toBe(true);
      expect(
        isMultiSelectChoiceQuestion({
          question_type: "listening",
          type_payload: {
            type: "listening",
            sub_answer_kind: "single_choice",
          },
        }),
      ).toBe(false);
    });

    it("deterministically shuffles matching choices without 1:1 giveaway order", () => {
      const input = ["R1", "R2", "R3", "R4"];
      const a = deterministicShuffleBySeed(input, "match:q-123");
      const b = deterministicShuffleBySeed(input, "match:q-123");
      expect(a).toEqual(b);
      expect([...a].sort()).toEqual([...input].sort());
      expect(a).not.toEqual(input);
    });
  });

  describe("V32-022 / RU-08: dedupeQuestionMediaImages eliminates duplicate DOCX images", () => {
    it("deduplicates media_snapshot entries matching prompt_image_url via proxy ?path= or exact URL", () => {
      const promptUrl =
        "/api/media/proxy?path=u1%2Fset1%2Fdocx-img-01.png&token=abc";
      const result = dedupeQuestionMediaImages(promptUrl, [
        {
          id: "att-1",
          storage_path: "u1/set1/docx-img-01.png",
          url: "/api/media/proxy?path=u1%2Fset1%2Fdocx-img-01.png&token=xyz",
        },
        {
          id: "att-2",
          storage_path: "u1/set1/docx-img-02.png",
          url: "/api/media/proxy?path=u1%2Fset1%2Fdocx-img-02.png&token=xyz",
        },
      ]);

      expect(result.promptImageUrl).toBe(promptUrl);
      expect(result.attachments).toHaveLength(1);
      expect(result.attachments[0].id).toBe("att-2");
    });
  });

  describe("V32-004 / V32-005 / RU-02 / MEM-02: User-partitioned exam-draft persistence & pruning", () => {
    const sampleEntry: ExamDraftEntry = {
      selectedOptionIds: ["opt-1"],
      typedAnswer: "",
      structuredResponse: null,
      confidence: "certain",
      hintUsed: false,
      isFlagged: true,
      clientSeq: 7,
    };

    it("persists currentQuestionIndex (Q200) & entries partitioned by userId", () => {
      const now = 1_750_000_000_000;
      saveExamDraft("user-a", "attempt-250", { "aq-200": sampleEntry }, 199, now);

      const loadedA = loadExamDraft("user-a", "attempt-250", now + 5000);
      expect(loadedA).not.toBeNull();
      expect(loadedA?.currentQuestionIndex).toBe(199);
      expect(loadedA?.entries["aq-200"]?.selectedOptionIds).toEqual(["opt-1"]);
      expect(loadedA?.entries["aq-200"]?.isFlagged).toBe(true);

      // Cross-account isolation: User B cannot read User A's exam draft!
      expect(loadExamDraft("user-b", "attempt-250", now + 5000)).toBeNull();

      clearExamDraft("user-a", "attempt-250");
      expect(loadExamDraft("user-a", "attempt-250", now + 5000)).toBeNull();
    });

    it("prunes legacy v2 drafts, >7d expired drafts, and enforces max 20 entries (MEM-02)", () => {
      const baseNow = 1_750_000_000_000;
      window.localStorage.setItem(
        "studyhub-exam-draft-v2-legacy-attempt",
        JSON.stringify({ entries: {} }),
      );

      // Write 1 expired draft (8 days old) + 23 fresh drafts
      window.localStorage.setItem(
        buildExamDraftKey("user-a", "expired-att"),
        JSON.stringify({
          version: 3,
          userId: "user-a",
          attemptId: "expired-att",
          updatedAt: baseNow - EXAM_DRAFT_TTL_MS - 10_000,
          currentQuestionIndex: 0,
          entries: {},
        }),
      );
      for (let i = 0; i < 23; i += 1) {
        window.localStorage.setItem(
          buildExamDraftKey("user-a", `att-${i}`),
          JSON.stringify({
            version: 3,
            userId: "user-a",
            attemptId: `att-${i}`,
            updatedAt: baseNow + i * 1000,
            currentQuestionIndex: i,
            entries: {},
          }),
        );
      }

      const removed = pruneStaleExamDrafts(baseNow + 25_000);
      // 1 legacy + 1 expired + 3 oldest overflow = 5 removed
      expect(removed).toBe(5);
      expect(
        window.localStorage.getItem("studyhub-exam-draft-v2-legacy-attempt"),
      ).toBeNull();
      expect(loadExamDraft("user-a", "expired-att", baseNow + 25_000)).toBeNull();
      expect(loadExamDraft("user-a", "att-0", baseNow + 25_000)).toBeNull();
      expect(loadExamDraft("user-a", "att-22", baseNow + 25_000)?.currentQuestionIndex).toBe(22);
    });
  });

  describe("V32-027 / RU-06 / V32-015: Adaptive Learn true progress & progressive streaming append", () => {
    it("reports non-zero visited count, index, and percent after 5 answers even before graduation (RU-06)", () => {
      const seeds: AdaptiveLearnItemSeed[] = Array.from({ length: 15 }, (_, idx) => ({
        question: makeBaseQuestion({ id: `q-${idx + 1}` }),
        progress: null,
        isStarred: false,
      }));
      let state = createAdaptiveLearnState(seeds, {
        objective: "master",
        batchSize: 7,
      });

      const initialProgress = computeAdaptiveLearnProgress(state);
      expect(initialProgress.visitedCount).toBe(0);
      expect(initialProgress.progressPercent).toBe(0);
      expect(initialProgress.currentIndex).toBe(0);

      // Answer 5 cards at Stage 1/2 (none graduated yet because targetStage = 5)
      for (let i = 0; i < 5; i += 1) {
        const card = state.activeQueue[0]!;
        const q = seeds.find((s) => s.question.id === card.questionId)!.question;
        state = recordAdaptiveLearnStep(state, q, { isCorrect: true }).nextState;
      }

      expect(state.graduatedIds).toHaveLength(0);
      const after5 = computeAdaptiveLearnProgress(state);
      expect(after5.visitedCount).toBe(5);
      expect(after5.currentIndex).toBe(5);
      expect(after5.progressPercent).toBeGreaterThan(0);
      expect(after5.progressPercent).toBeLessThan(100);
    });

    it("appends background-streamed pages without disturbing activeQueue[0] or duplicating IDs", () => {
      const page1: AdaptiveLearnItemSeed[] = Array.from({ length: 3 }, (_, idx) => ({
        question: makeBaseQuestion({ id: `q-${idx + 1}` }),
        progress: null,
        isStarred: false,
      }));
      const page2: AdaptiveLearnItemSeed[] = [
        page1[0], // duplicate from page 1
        { question: makeBaseQuestion({ id: "q-4" }), progress: null, isStarred: false },
        { question: makeBaseQuestion({ id: "q-5" }), progress: null, isStarred: false },
      ];

      const state = createAdaptiveLearnState(page1, { batchSize: 2 });
      const firstIdBefore = state.activeQueue[0]?.questionId;
      const merged = appendAdaptiveLearnSeeds(state, page2);

      expect(merged.activeQueue[0]?.questionId).toBe(firstIdBefore);
      expect(merged.totalItems).toBe(5);
      expect(merged.pendingQueue.map((c) => c.questionId)).toContain("q-4");
      expect(merged.pendingQueue.map((c) => c.questionId)).toContain("q-5");
    });
  });

  describe("V32-027: User-partitioned checkpoint pruning", () => {
    it("prunes stale & overflow checkpoints per user without touching another user", () => {
      const now = Date.now();
      saveLocalCheckpoint({
        version: 1,
        userId: "user-b",
        studySetId: "set-1",
        mode: "practice",
        sessionKey: "practice:set-1:all",
        currentIndex: 3,
        totalItems: 10,
        progressPercent: 30,
        stateJson: {},
        committedEventKeys: [],
        updatedAt: new Date(now).toISOString(),
      });

      for (let i = 0; i < 35; i += 1) {
        window.localStorage.setItem(
          `studyhub-v3-checkpoint:user-a:practice:set-${i}:all`,
          JSON.stringify({
            version: 1,
            userId: "user-a",
            studySetId: `set-${i}`,
            mode: "practice",
            sessionKey: `practice:set-${i}:all`,
            currentIndex: i,
            totalItems: 50,
            progressPercent: 20,
            stateJson: {},
            committedEventKeys: [],
            updatedAt: new Date(now + i * 1000).toISOString(),
          }),
        );
      }

      const removed = pruneLocalCheckpointsForUser("user-a", now + 40_000);
      expect(removed).toBe(5);
      // User B untouched
      expect(loadLocalCheckpoint("user-b", "practice:set-1:all")?.currentIndex).toBe(3);
      clearLocalCheckpoint("user-b", "practice:set-1:all");
    });
  });

  describe("V32-031 / RU-05 / MEM-05: TTS auto-language detection & legacy listener cleanup", () => {
    it("detects English vs Vietnamese accurately regardless of UI locale fallback", () => {
      expect(detectSpeechLanguage("altitude", "vi-VN")).toBe("en-US");
      expect(
        detectSpeechLanguage("The atmosphere consists of nitrogen and oxygen", "vi-VN"),
      ).toBe("en-US");
      expect(detectSpeechLanguage("Khí tượng hàng không Việt Nam", "en-US")).toBe(
        "vi-VN",
      );
      expect(detectSpeechLanguage("Hà Nội", "en-US")).toBe("vi-VN");
      expect(detectSpeechLanguage("12345", "vi-VN")).toBe("vi-VN");
    });

    it("selects English voice automatically when lang='auto' speaks English card text", () => {
      const synth = new LegacyOnVoicesChangedSynth();
      synth.voices = [
        {
          voiceURI: "vi-1",
          name: "Vietnamese Local",
          lang: "vi-VN",
          localService: true,
          default: false,
        },
        {
          voiceURI: "en-1",
          name: "English US Local",
          lang: "en-US",
          localService: true,
          default: true,
        },
      ];
      const ctrl = new TtsController({
        synthesis: synth,
        UtteranceCtor: FakeUtterance,
      });

      const res = ctrl.speak({ text: "altitude", lang: "auto" });
      expect(res.ok).toBe(true);
      expect(synth.spoken).toHaveLength(1);
      expect(synth.spoken[0].lang).toBe("en-US");
      expect(synth.spoken[0].voice?.voiceURI).toBe("en-1");
    });

    it("cleans up legacy onvoiceschanged listeners out-of-order without leak (MEM-05)", () => {
      const synth = new LegacyOnVoicesChangedSynth();
      const ctrl = new TtsController({
        synthesis: synth,
        UtteranceCtor: FakeUtterance,
      });
      const callsA: number[] = [];
      const callsB: number[] = [];

      const unsubA = ctrl.subscribeVoices((v) => callsA.push(v.length));
      const unsubB = ctrl.subscribeVoices((v) => callsB.push(v.length));
      expect(synth.onvoiceschanged).not.toBeNull();

      // Unsubscribe A first (out of LIFO order) — B must still receive events
      unsubA();
      synth.voices = [
        {
          voiceURI: "en-1",
          name: "English",
          lang: "en-US",
          localService: true,
          default: true,
        },
      ];
      synth.onvoiceschanged?.();
      expect(callsA).toEqual([]);
      expect(callsB).toEqual([1]);

      // Unsubscribe B — legacy onvoiceschanged handler must be released cleanly
      unsubB();
      expect(synth.onvoiceschanged).toBeNull();
    });
  });

  describe("V32-017: localizeAllocationError", () => {
    it("localizes exam allocation error codes to Vietnamese and English", () => {
      expect(
        localizeAllocationError(
          "vi",
          "EMPTY_SUBJECTS",
          "Select at least one study set or folder.",
        ),
      ).toContain("học phần");
      expect(
        localizeAllocationError(
          "en",
          "EMPTY_SUBJECTS",
          "Select at least one study set or folder.",
        ),
      ).toContain("study set");
      expect(
        localizeAllocationError("vi", "EXCEEDS_AVAILABLE", undefined, 50),
      ).toContain("vượt quá");
    });
  });
});
