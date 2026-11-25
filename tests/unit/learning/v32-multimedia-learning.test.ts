import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveCanEditStudySet } from "@/components/learning/useStudySetBundle";
import { projectQuestionToFlashcard } from "@/lib/learning/flashcard-projection";
import { generateMatchRound, questionsToMatchCandidates } from "@/lib/learning/match-engine";
import {
  getExamSnapshotExplanationDisplayItems,
  getExamSnapshotPromptDisplayItems,
  getOptionDisplayItems,
  getQuestionExplanationDisplayItems,
  getQuestionPromptDisplayItems,
  hasRenderableText,
} from "@/lib/learning/media-helpers";
import { extractSpellTarget } from "@/lib/learning/spell";
import type {
  ExamSnapshotQuestion,
  Question,
  QuestionMediaAttachment,
  StudySet,
} from "@/types/domain";

function makeAttachment(
  overrides: Partial<QuestionMediaAttachment> & {
    media_id: string;
    url: string;
    role: QuestionMediaAttachment["role"];
  },
): QuestionMediaAttachment {
  return {
    id: overrides.id ?? `rel-${overrides.media_id}`,
    sort_order: overrides.sort_order ?? 0,
    mime_type: overrides.mime_type ?? "image/png",
    alt_text: overrides.alt_text ?? null,
    caption: overrides.caption ?? null,
    ...overrides,
  };
}

function makeBaseQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: "q-1",
    study_set_id: "set-1",
    question_type: "single_choice",
    position: 0,
    chapter: "Ch 1",
    prompt: "Which structure is shown?",
    prompt_image_url: null,
    back_text: null,
    back_image_url: null,
    explanation: "See diagram",
    hint: null,
    difficulty: "medium",
    source_metadata: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    options: [],
    ...overrides,
  };
}

describe("V32-053 Learning & Exam Multi-Image Helpers & Security Invariants", () => {
  it("deduplicates prompt_image_url against media_attachments and keeps explanation media separate", () => {
    const sharedPath = "user-1/set-1/img1.png";
    const proxyUrl = `/api/uploads/signed-url?path=${encodeURIComponent(sharedPath)}&redirect=1`;

    const q = makeBaseQuestion({
      prompt_image_url: proxyUrl,
      media_attachments: [
        makeAttachment({
          media_id: "m-prompt-1",
          url: proxyUrl,
          storage_path: sharedPath,
          role: "prompt",
          sort_order: 0,
        }),
        makeAttachment({
          media_id: "m-prompt-2",
          url: "/api/uploads/signed-url?path=user-1%2Fset-1%2Fimg2.png&redirect=1",
          role: "prompt",
          sort_order: 1,
        }),
        makeAttachment({
          media_id: "m-exp-1",
          url: "/api/uploads/signed-url?path=user-1%2Fset-1%2Fexp1.png&redirect=1",
          role: "explanation",
          sort_order: 0,
        }),
      ],
    });

    const promptItems = getQuestionPromptDisplayItems(q);
    expect(promptItems).toHaveLength(2);
    expect(promptItems.map((i) => i.media_id)).toEqual(["m-prompt-1", "m-prompt-2"]);

    const expItems = getQuestionExplanationDisplayItems(q);
    expect(expItems).toHaveLength(1);
    expect(expItems[0].media_id).toBe("m-exp-1");
  });

  it("projects Flashcards with separated frontMedia, multi-option backMedia, and explanationMedia", () => {
    const q = makeBaseQuestion({
      question_type: "multiple_choice",
      prompt_image_url: "/api/uploads/signed-url?path=u%2Fs%2Fp1.png&redirect=1",
      media_attachments: [
        makeAttachment({
          media_id: "p1",
          url: "/api/uploads/signed-url?path=u%2Fs%2Fp1.png&redirect=1",
          role: "prompt",
          sort_order: 0,
        }),
        makeAttachment({
          media_id: "p2",
          url: "/api/uploads/signed-url?path=u%2Fs%2Fp2.png&redirect=1",
          role: "prompt",
          sort_order: 1,
        }),
        makeAttachment({
          media_id: "exp1",
          url: "/api/uploads/signed-url?path=u%2Fs%2Fexp.png&redirect=1",
          role: "explanation",
          sort_order: 0,
        }),
      ],
      options: [
        {
          id: "opt-a",
          question_id: "q-1",
          study_set_id: "set-1",
          position: 0,
          label: "A",
          content: "Answer A",
          image_url: null,
          is_correct: true,
          created_at: "2026-01-01T00:00:00Z",
          media_attachments: [
            makeAttachment({
              media_id: "oa-1",
              url: "/api/uploads/signed-url?path=u%2Fs%2Foa1.png&redirect=1",
              role: "option",
              sort_order: 0,
            }),
          ],
        },
        {
          id: "opt-b",
          question_id: "q-1",
          study_set_id: "set-1",
          position: 1,
          label: "B",
          content: "",
          image_url: "/api/uploads/signed-url?path=u%2Fs%2Fob1.png&redirect=1",
          is_correct: true,
          created_at: "2026-01-01T00:00:00Z",
          media_attachments: [
            makeAttachment({
              media_id: "ob-1",
              url: "/api/uploads/signed-url?path=u%2Fs%2Fob1.png&redirect=1",
              role: "option",
              sort_order: 0,
            }),
            makeAttachment({
              media_id: "ob-2",
              url: "/api/uploads/signed-url?path=u%2Fs%2Fob2.png&redirect=1",
              role: "option",
              sort_order: 1,
            }),
          ],
        },
      ],
    });

    const card = projectQuestionToFlashcard(q);
    expect(card.frontMedia).toHaveLength(2);
    expect(card.backMedia).toHaveLength(3); // oa-1, ob-1 (deduped against legacy image_url), ob-2
    expect(card.explanationMedia).toHaveLength(1);
    expect(card.explanationMedia?.[0].media_id).toBe("exp1");
    // Explanation image must NEVER bleed into backMedia
    expect(card.backMedia?.some((m) => m.role === "explanation")).toBe(false);
  });

  it("extracts Match candidates from multi-image attachments including image-only cards", () => {
    const q1 = makeBaseQuestion({
      id: "q-img-only",
      question_type: "flashcard",
      prompt: "",
      back_text: "Mitochondria",
      media_attachments: [
        makeAttachment({
          media_id: "m1",
          url: "/api/uploads/signed-url?path=u%2Fs%2Fmito.png&redirect=1",
          role: "prompt",
        }),
      ],
    });
    const q2 = makeBaseQuestion({
      id: "q-opt-img",
      question_type: "image_choice",
      prompt: "Select benzene ring",
      options: [
        {
          id: "opt-1",
          question_id: "q-opt-img",
          study_set_id: "set-1",
          position: 0,
          label: "A",
          content: "",
          image_url: null,
          is_correct: true,
          created_at: "2026-01-01T00:00:00Z",
          media_attachments: [
            makeAttachment({
              media_id: "m2",
              url: "/api/uploads/signed-url?path=u%2Fs%2Fbenzene.png&redirect=1",
              role: "option",
            }),
          ],
        },
      ],
    });

    const candidates = questionsToMatchCandidates([q1, q2]);
    expect(candidates).toHaveLength(2);
    expect(candidates[0].promptImageUrl).toContain("mito.png");
    expect(candidates[1].answerImageUrl).toContain("benzene.png");

    const round = generateMatchRound(candidates, { pairCount: 2, rng: () => 0.4 });
    expect(round.pairs).toHaveLength(2);
    expect(round.tiles).toHaveLength(4);
    expect(round.tiles.some((t) => t.imageUrl?.includes("mito.png"))).toBe(true);
    expect(round.tiles.some((t) => t.imageUrl?.includes("benzene.png"))).toBe(true);
  });

  it("extractSpellTarget preserves prompt/explanation images and allows text options with illustrations", () => {
    const q = makeBaseQuestion({
      question_type: "single_choice",
      prompt: "Capital of France",
      media_attachments: [
        makeAttachment({
          media_id: "sp-1",
          url: "/api/uploads/signed-url?path=u%2Fs%2Fparis.png&redirect=1",
          role: "prompt",
        }),
        makeAttachment({
          media_id: "se-1",
          url: "/api/uploads/signed-url?path=u%2Fs%2Fmap.png&redirect=1",
          role: "explanation",
        }),
      ],
      options: [
        {
          id: "o-1",
          question_id: "q-1",
          study_set_id: "set-1",
          position: 0,
          label: "A",
          content: "Paris",
          image_url: "/api/uploads/signed-url?path=u%2Fs%2Fopt.png&redirect=1",
          is_correct: true,
          created_at: "2026-01-01T00:00:00Z",
        },
      ],
    });

    const target = extractSpellTarget(q);
    expect(target.isSpellable).toBe(true);
    expect(target.speakText).toBe("Paris");
    expect(target.promptImages).toHaveLength(1);
    expect(target.explanationImages).toHaveLength(1);
  });

  it("enforces strict role separation on ExamSnapshotQuestion (zero pre-submit explanation leak, multi-image options)", () => {
    const inProgressSnapshot: ExamSnapshotQuestion = {
      id: "eaq-1",
      attempt_id: "att-1",
      question_id: "q-1",
      position: 1,
      question_type: "single_choice",
      chapter_snapshot: "Ch 1",
      prompt_snapshot: "Exam question prompt",
      prompt_image_url_snapshot: "/api/uploads/signed-url?path=u%2Fs%2Fp1.png&redirect=1",
      media_snapshot: [
        {
          media_id: "p1",
          role: "prompt",
          sort_order: 0,
          storage_path: "u/s/p1.png",
          proxy_url: "/api/uploads/signed-url?path=u%2Fs%2Fp1.png&redirect=1",
          mime_type: "image/png",
        },
        {
          media_id: "p2",
          role: "passage",
          sort_order: 1,
          storage_path: "u/s/p2.png",
          proxy_url: "/api/uploads/signed-url?path=u%2Fs%2Fp2.png&redirect=1",
          mime_type: "image/png",
        },
        {
          media_id: "leaked-exp",
          role: "explanation",
          sort_order: 2,
          storage_path: "u/s/exp.png",
          proxy_url: "/api/uploads/signed-url?path=u%2Fs%2Fexp.png&redirect=1",
          mime_type: "image/png",
        },
        {
          media_id: "leaked-opt",
          role: "option",
          sort_order: 3,
          storage_path: "u/s/opt.png",
          proxy_url: "/api/uploads/signed-url?path=u%2Fs%2Fopt.png&redirect=1",
          mime_type: "image/png",
        },
      ],
      options_snapshot: [
        {
          id: "opt-1",
          label: "A",
          content: "",
          image_url: "/api/uploads/signed-url?path=u%2Fs%2Fo1.png&redirect=1",
          media: [
            makeAttachment({
              media_id: "o1",
              url: "/api/uploads/signed-url?path=u%2Fs%2Fo1.png&redirect=1",
              role: "option",
              sort_order: 0,
            }),
            makeAttachment({
              media_id: "o2",
              url: "/api/uploads/signed-url?path=u%2Fs%2Fo2.png&redirect=1",
              role: "option",
              sort_order: 1,
            }),
          ],
          position: 0,
        },
      ],
      created_at: "2026-01-01T00:00:00Z",
    };

    // Prompt strictly excludes explanation and option roles, and dedupes p1!
    const promptItems = getExamSnapshotPromptDisplayItems(inProgressSnapshot);
    expect(promptItems.map((i) => i.media_id)).toEqual(["p1", "p2"]);

    // In-progress snapshot returns ZERO explanation media!
    expect(getExamSnapshotExplanationDisplayItems(inProgressSnapshot)).toEqual([]);

    // Post-submit snapshot returns review_media_snapshot explanation images cleanly
    const submittedSnapshot: ExamSnapshotQuestion = {
      ...inProgressSnapshot,
      explanation_snapshot: null, // image-only explanation!
      correct_option_ids: ["opt-1"],
      review_media_snapshot: [
        makeAttachment({
          media_id: "rev-exp-1",
          url: "/api/uploads/signed-url?path=u%2Fs%2Frev-exp.png&redirect=1",
          role: "explanation",
          sort_order: 0,
        }),
      ],
    };
    const postSubmitExp = getExamSnapshotExplanationDisplayItems(submittedSnapshot);
    expect(postSubmitExp.some((i) => i.media_id === "rev-exp-1")).toBe(true);

    // Multi-image option snapshot deduplicates o1 and preserves o2
    const optItems = getOptionDisplayItems(inProgressSnapshot.options_snapshot[0]);
    expect(optItems).toHaveLength(2);
    expect(optItems.map((i) => i.media_id)).toEqual(["o1", "o2"]);
    expect(hasRenderableText("", null)).toBe(false);
    expect(hasRenderableText("Hello", null)).toBe(true);
  });

  it("resolveCanEditStudySet strictly enforces owner/editor RBAC and denies viewers", () => {
    const baseSet: StudySet = {
      id: "set-1",
      owner_id: "owner-1",
      folder_id: null,
      title: "Biology",
      description: null,
      subject: "Bio",
      set_type: "multiple_choice",
      visibility: "private",
      source_language: "vi",
      question_count: 10,
      default_exam_duration_minutes: 15,
      default_pass_threshold: 70,
      is_archived: false,
      last_studied_at: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };

    expect(resolveCanEditStudySet({ ...baseSet, can_edit: false }, "owner-1")).toBe(false);
    expect(resolveCanEditStudySet({ ...baseSet, can_edit: true }, "other-user")).toBe(true);
    expect(resolveCanEditStudySet({ ...baseSet, role: "editor" }, "other-user")).toBe(true);
    expect(resolveCanEditStudySet({ ...baseSet, role: "viewer" }, "other-user")).toBe(false);
    expect(resolveCanEditStudySet({ ...baseSet, role: "public_viewer" }, "other-user")).toBe(false);
    expect(resolveCanEditStudySet(baseSet, "owner-1")).toBe(true);
    expect(resolveCanEditStudySet(baseSet, "other-user")).toBe(false);
    expect(resolveCanEditStudySet(baseSet, null)).toBe(false);
  });

  it("guarantees LiveExamRunner and V3ExamQuestionBody contain ZERO edit controls or pre-submit explanation media", () => {
    const root = process.cwd();
    const liveRunnerSrc = readFileSync(
      path.join(root, "src/components/exam/LiveExamRunner.tsx"),
      "utf8",
    );
    const examBodySrc = readFileSync(
      path.join(root, "src/components/exam/V3ExamQuestionBody.tsx"),
      "utf8",
    );

    for (const src of [liveRunnerSrc, examBodySrc]) {
      expect(src).not.toContain("ContextualQuestionEditorModal");
      expect(src).not.toContain("UnifiedQuestionEditorModal");
      expect(src).not.toContain("review_media_snapshot");
      expect(src).not.toContain("getExamSnapshotExplanationDisplayItems");
      expect(src).not.toContain("getQuestionExplanationMedia");
    }
  });
});
