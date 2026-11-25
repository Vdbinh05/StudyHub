import { describe, expect, it } from "vitest";
import {
  canonicalizeMediaUrlKey,
  getOptionMedia,
  getQuestionBackMedia,
  getQuestionExplanationMedia,
  getQuestionPromptMedia,
  hasAnyQuestionImages,
  normalizeMediaAttachmentList,
  type QuestionMediaAttachment,
} from "@/lib/media/question-media";
import { validateQuestionByType } from "@/lib/questions/registry";

describe("question-media helpers (V32-053)", () => {
  const signedA = "/api/uploads/signed-url?path=u1%2Fs1%2Fa.png&redirect=1";
  const signedARetry = "/api/uploads/signed-url?path=u1%2Fs1%2Fa.png&redirect=1&_r=171000000";
  const signedB = "/api/uploads/signed-url?path=u1%2Fs1%2Fb.jpg&redirect=1";
  const signedExp = "/api/uploads/signed-url?path=u1%2Fs1%2Fexp.png&redirect=1";
  const signedOpt1 = "/api/uploads/signed-url?path=u1%2Fs1%2Fopt1.png&redirect=1";
  const signedOpt2 = "/api/uploads/signed-url?path=u1%2Fs1%2Fopt2.png&redirect=1";

  it("canonicalizes storage proxy URLs ignoring cache-bust _r params", () => {
    expect(canonicalizeMediaUrlKey(signedA)).toBe(canonicalizeMediaUrlKey(signedARetry));
    expect(canonicalizeMediaUrlKey(signedA)).toBe("storage:u1/s1/a.png");
  });

  it("normalizes, sorts by sort_order, deduplicates by media_id & URL, and blocks unsafe URLs", () => {
    const list = normalizeMediaAttachmentList([
      {
        media_id: "11111111-1111-4111-8111-111111111111",
        url: signedB,
        role: "prompt",
        sort_order: 2,
      },
      {
        media_id: "22222222-2222-4222-8222-222222222222",
        url: signedA,
        role: "prompt",
        sort_order: 0,
        alt_text: "Diagram A",
      },
      // Duplicate by URL with _r cache-bust param
      {
        media_id: "legacy:dup",
        url: signedARetry,
        role: "prompt",
        sort_order: 1,
      },
      // Unsafe XSS URL must be dropped
      {
        media_id: "33333333-3333-4333-8333-333333333333",
        url: "javascript:alert(1)",
        role: "prompt",
        sort_order: 3,
      },
      {
        media_id: "44444444-4444-4444-8444-444444444444",
        url: "data:text/html,<script>alert(1)</script>",
        role: "prompt",
        sort_order: 4,
      },
    ]);

    expect(list).toHaveLength(2);
    expect(list[0].url).toBe(signedA);
    expect(list[0].sort_order).toBe(0);
    expect(list[0].alt_text).toBe("Diagram A");
    expect(list[1].url).toBe(signedB);
    expect(list[1].sort_order).toBe(1);
  });

  it("getQuestionPromptMedia returns ordered multi-image prompt media, dedupes legacy URL, and NEVER leaks explanation/hint/back", () => {
    const attachments: QuestionMediaAttachment[] = [
      {
        media_id: "11111111-1111-4111-8111-111111111111",
        url: signedA,
        role: "prompt",
        sort_order: 0,
      },
      {
        media_id: "22222222-2222-4222-8222-222222222222",
        url: signedB,
        role: "prompt",
        sort_order: 1,
      },
      {
        media_id: "33333333-3333-4333-8333-333333333333",
        url: signedExp,
        role: "explanation",
        sort_order: 0,
      },
      {
        media_id: "44444444-4444-4444-8444-444444444444",
        url: "/api/uploads/signed-url?path=u1%2Fs1%2Fhint.png&redirect=1",
        role: "hint",
        sort_order: 0,
      },
      {
        media_id: "55555555-5555-4555-8555-555555555555",
        url: "/api/uploads/signed-url?path=u1%2Fs1%2Fback.png&redirect=1",
        role: "back",
        sort_order: 0,
      },
    ];

    const promptMedia = getQuestionPromptMedia({
      prompt_image_url: signedARetry, // duplicate of attachments[0]
      media_attachments: attachments,
    });

    expect(promptMedia.map((m) => m.url)).toEqual([signedA, signedB]);
    expect(getQuestionExplanationMedia({ media_attachments: attachments }).map((m) => m.url)).toEqual([
      signedExp,
    ]);
    expect(getQuestionBackMedia({ media_attachments: attachments })).toHaveLength(1);
  });

  it("prevents pre-submit explanation media leak on ExamSnapshotQuestion and reads review_media_snapshot post-submit", () => {
    // Pre-submit snapshot (no explanation_snapshot, no correct_option_ids, no review_media_snapshot)
    const preSubmitSnap = {
      prompt_image_url_snapshot: signedA,
      media_snapshot: [
        { media_id: "m1", url: signedA, role: "prompt" as const, sort_order: 0 },
        // Even if a malicious/legacy pre-submit snapshot contained explanation, getQuestionPromptMedia & getQuestionExplanationMedia reject it pre-submit!
        { media_id: "m-exp", url: signedExp, role: "explanation" as const, sort_order: 0 },
      ],
    };

    expect(getQuestionPromptMedia(preSubmitSnap).map((m) => m.url)).toEqual([signedA]);
    expect(getQuestionExplanationMedia(preSubmitSnap)).toEqual([]);

    // Post-submit snapshot with Migration 0020 `review_media_snapshot`
    const postSubmitSnap = {
      prompt_image_url_snapshot: signedA,
      media_snapshot: [
        { media_id: "m1", url: signedA, role: "prompt" as const, sort_order: 0 },
      ],
      review_media_snapshot: [
        { media_id: "m-exp", url: signedExp, role: "explanation" as const, sort_order: 0 },
      ],
      correct_option_ids: ["opt-1"],
    };

    expect(getQuestionPromptMedia(postSubmitSnap).map((m) => m.url)).toEqual([signedA]);
    expect(getQuestionExplanationMedia(postSubmitSnap).map((m) => m.url)).toEqual([signedExp]);
  });

  it("getOptionMedia supports QuestionOption.media_attachments[], ExamSnapshotOption.media[], and legacy image_url deduplication", () => {
    const optMedia = getOptionMedia({
      id: "opt-a",
      image_url: signedOpt1,
      image_alt: "Option A chart 1",
      media_attachments: [
        {
          media_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          url: signedOpt1,
          role: "option",
          sort_order: 0,
          alt_text: "Option A chart 1",
        },
        {
          media_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          url: signedOpt2,
          role: "option",
          sort_order: 1,
          alt_text: "Option A chart 2",
        },
      ],
    });
    expect(optMedia.map((m) => m.url)).toEqual([signedOpt1, signedOpt2]);

    const examOptMedia = getOptionMedia({
      id: "opt-a",
      image_url: signedOpt1,
      media: [
        {
          media_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          url: signedOpt1,
          role: "option",
          sort_order: 0,
        },
        {
          media_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          url: signedOpt2,
          role: "option",
          sort_order: 1,
        },
      ],
    });
    expect(examOptMedia.map((m) => m.url)).toEqual([signedOpt1, signedOpt2]);
  });

  it("hasAnyQuestionImages detects prompt, option, explanation, back, diagram & payload images", () => {
    expect(hasAnyQuestionImages({ prompt_image_url: null, options: [{ image_url: null }] })).toBe(
      false,
    );
    expect(hasAnyQuestionImages({ prompt_image_url: signedA })).toBe(true);
    expect(
      hasAnyQuestionImages({
        options: [
          {
            media_attachments: [
              { media_id: "m1", url: signedOpt1, role: "option", sort_order: 0 },
            ],
          },
        ],
      }),
    ).toBe(true);
    expect(
      hasAnyQuestionImages({
        media_attachments: [
          { media_id: "m-exp", url: signedExp, role: "explanation", sort_order: 0 },
        ],
      }),
    ).toBe(true);
    expect(
      hasAnyQuestionImages({
        type_payload: {
          type: "image_hotspot",
          image_url: signedA,
          target_hotspots: [],
        },
      }),
    ).toBe(true);
  });

  it("allows image-only options on single_choice, multiple_choice, true_false, and image_choice without converting question type", () => {
    const imageOnlyOptions = [
      {
        id: "opt-1",
        content: "",
        image_url: signedOpt1,
        is_correct: true,
      },
      {
        id: "opt-2",
        content: "",
        media_attachments: [{ media_id: "m-opt-2", url: signedOpt2 }],
        is_correct: false,
      },
    ];

    expect(
      validateQuestionByType({
        question_type: "single_choice",
        prompt: "Chọn biển báo đúng:",
        options: imageOnlyOptions,
      }).valid,
    ).toBe(true);

    expect(
      validateQuestionByType({
        question_type: "multiple_choice",
        prompt: "Chọn các sơ đồ hợp lệ:",
        options: imageOnlyOptions,
      }).valid,
    ).toBe(true);

    expect(
      validateQuestionByType({
        question_type: "true_false",
        prompt: "Hình này có đúng không?",
        options: imageOnlyOptions,
      }).valid,
    ).toBe(true);

    expect(
      validateQuestionByType({
        question_type: "image_choice",
        prompt: "",
        prompt_image_url: signedA,
        options: imageOnlyOptions,
      }).valid,
    ).toBe(true);
  });
});
