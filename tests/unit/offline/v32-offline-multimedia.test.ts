// @vitest-environment jsdom
import "fake-indexeddb/auto";
import "@testing-library/jest-dom/vitest";
import * as React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "@/lib/i18n";
import {
  getOptionMedia,
  getQuestionBackMedia,
  getQuestionExplanationMedia,
  getQuestionPromptMedia,
} from "@/lib/media/question-media";
import {
  clearUserOfflineData,
  closeAllOfflineDbs,
  getMediaBlob,
  OfflineStorageError,
  putDownloadedSet,
  putMediaBlob,
  putQuestionsForSet,
} from "@/lib/offline/db";
import {
  analyzeSetMediaRequirements,
  deleteDownloadedStudySet,
  downloadStudySetOffline,
  validateDownloadOptions,
} from "@/lib/offline/download-manager";
import {
  collectOfflineQuestionMediaUrls,
  loadOfflineStudyBundle,
  mapOfflineMediaAttachments,
  resolveOfflineQuestionMediaMap,
} from "@/lib/offline/offline-session";
import type {
  OfflineDownloadedSetRecord,
  OfflineQuestionRecord,
} from "@/lib/offline/types";
import { OfflineStudyRunner } from "@/components/pwa/OfflineStudyRunner";

const USER_ID = "33333333-3333-4333-8333-333333333333";
const SET_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const MP3_BYTES = new Uint8Array([73, 68, 51, 4, 0, 0, 0, 0]);

function makeJsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeBinaryResponse(bytes: Uint8Array, mime = "image/png"): Response {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Response(new Blob([copy], { type: mime }), {
    status: 200,
    headers: { "Content-Type": mime },
  });
}

function setNavigatorOnline(online: boolean): void {
  Object.defineProperty(window.navigator, "onLine", {
    configurable: true,
    get: () => online,
  });
}

function makeDownloadedSet(): OfflineDownloadedSetRecord {
  return {
    user_id: USER_ID,
    set_id: SET_ID,
    title: "Multi-Image Offline Biology",
    subject: "Biology",
    description: "V32-053 multi-image offline study set",
    set_type: "mixed",
    visibility: "private",
    source_language: "en",
    content_version: 3,
    server_updated_at: "2026-11-26T00:00:00.000Z",
    downloaded_at: "2026-11-26T00:10:00.000Z",
    downloaded_chapters: null,
    question_count: 1,
    diagram_count: 0,
    media_count: 9,
    media_bytes: 9 * 8,
    estimated_total_bytes: 2048,
    include_media: true,
    status: "ready",
    failed_media_urls: [],
    last_error: null,
    passages: [],
  };
}

function makeMultiImageQuestion(
  overrides: Partial<OfflineQuestionRecord> = {},
): OfflineQuestionRecord {
  return {
    id: overrides.id ?? "q-multi-1",
    user_id: USER_ID,
    study_set_id: SET_ID,
    question_type: "image_choice",
    position: 0,
    chapter: "Cell Anatomy",
    prompt: "Compare both cell micrographs and select the matching organelle diagrams.",
    prompt_image_url: "/api/uploads/signed-url?path=prompt-1.png&redirect=1",
    back_text: "Mitochondria inner cristae + ATP synthase",
    back_image_url: "/api/uploads/signed-url?path=back-1.png&redirect=1",
    explanation: "Cristae increase surface area for oxidative phosphorylation.",
    hint: "Look closely at the folded inner membrane.",
    difficulty: "medium",
    source_metadata: {},
    media_attachments: [
      {
        id: "rel-prompt-1",
        media_id: "media-prompt-1",
        url: "/api/uploads/signed-url?path=prompt-1.png&redirect=1",
        role: "prompt",
        sort_order: 0,
        alt_text: "Prompt micrograph 1",
        mime_type: "image/png",
      },
      {
        id: "rel-prompt-2",
        media_id: "media-prompt-2",
        url: "/api/uploads/signed-url?path=prompt-2.png&redirect=1",
        role: "prompt",
        sort_order: 1,
        alt_text: "Prompt micrograph 2",
        mime_type: "image/png",
      },
      {
        id: "rel-back-1",
        media_id: "media-back-1",
        url: "/api/uploads/signed-url?path=back-1.png&redirect=1",
        role: "back",
        sort_order: 0,
        alt_text: "Back diagram 1",
        mime_type: "image/png",
      },
      {
        id: "rel-back-2",
        media_id: "media-back-2",
        url: "/api/uploads/signed-url?path=back-2.png&redirect=1",
        role: "back",
        sort_order: 1,
        alt_text: "Back diagram 2",
        mime_type: "image/png",
      },
      {
        id: "rel-exp-1",
        media_id: "media-exp-1",
        url: "/api/uploads/signed-url?path=exp-1.png&redirect=1",
        role: "explanation",
        sort_order: 0,
        alt_text: "Explanation figure 1",
        mime_type: "image/png",
      },
      {
        id: "rel-exp-2",
        media_id: "media-exp-2",
        url: "/api/uploads/signed-url?path=exp-2.png&redirect=1",
        role: "explanation",
        sort_order: 1,
        alt_text: "Explanation figure 2",
        mime_type: "image/png",
      },
      {
        id: "rel-hint-1",
        media_id: "media-hint-1",
        url: "/api/uploads/signed-url?path=hint-1.png&redirect=1",
        role: "hint",
        sort_order: 0,
        alt_text: "Hint zoom",
        mime_type: "image/png",
      },
    ],
    options: [
      {
        id: "opt-a",
        question_id: overrides.id ?? "q-multi-1",
        study_set_id: SET_ID,
        position: 0,
        label: "A",
        content: "Chloroplast",
        image_url: "/api/uploads/signed-url?path=opt-a-1.png&redirect=1",
        media_id: "media-opt-a-1",
        media_attachments: [
          {
            id: "rel-opt-a-1",
            media_id: "media-opt-a-1",
            url: "/api/uploads/signed-url?path=opt-a-1.png&redirect=1",
            role: "option",
            sort_order: 0,
            alt_text: "Option A image 1",
            mime_type: "image/png",
          },
          {
            id: "rel-opt-a-2",
            media_id: "media-opt-a-2",
            url: "/api/uploads/signed-url?path=opt-a-2.png&redirect=1",
            role: "option",
            sort_order: 1,
            alt_text: "Option A image 2",
            mime_type: "image/png",
          },
        ],
        is_correct: false,
        created_at: "2026-11-26T00:00:00.000Z",
      },
      {
        id: "opt-b",
        question_id: overrides.id ?? "q-multi-1",
        study_set_id: SET_ID,
        position: 1,
        label: "B",
        content: "",
        image_url: null,
        media_attachments: [
          {
            id: "rel-opt-b-1",
            media_id: "media-opt-b-1",
            url: "/api/uploads/signed-url?path=opt-b-1.png&redirect=1",
            role: "option",
            sort_order: 0,
            alt_text: "Option B image 1",
            mime_type: "image/png",
          },
          {
            id: "rel-opt-b-2",
            media_id: "media-opt-b-2",
            url: "/api/uploads/signed-url?path=opt-b-2.png&redirect=1",
            role: "option",
            sort_order: 1,
            alt_text: "Option B image 2",
            mime_type: "image/png",
          },
        ],
        is_correct: true,
        created_at: "2026-11-26T00:00:00.000Z",
      },
    ],
    created_at: "2026-11-26T00:00:00.000Z",
    updated_at: "2026-11-26T00:00:00.000Z",
    cached_at: "2026-11-26T00:10:00.000Z",
    ...overrides,
  };
}

async function seedAllQuestionMediaBlobs(question: OfflineQuestionRecord): Promise<string[]> {
  const urls = collectOfflineQuestionMediaUrls(question);
  for (const url of urls) {
    await putMediaBlob(USER_ID, {
      url,
      user_id: USER_ID,
      media_id: null,
      kind: url.includes("audio") ? "audio" : "image",
      mime_type: url.includes("audio") ? "audio/mpeg" : "image/png",
      size_bytes: 8,
      blob: new Blob([url.includes("audio") ? MP3_BYTES : PNG_BYTES], {
        type: url.includes("audio") ? "audio/mpeg" : "image/png",
      }),
      set_ids: [SET_ID],
      downloaded_at: "2026-11-26T00:10:00.000Z",
    });
  }
  return urls;
}

function TestEnProvider({ children }: { children?: React.ReactNode }) {
  const Provider = I18nProvider as React.ComponentType<{
    defaultLocale?: "vi" | "en";
    children?: React.ReactNode;
  }>;
  return React.createElement(Provider, { defaultLocale: "en" }, children);
}

beforeEach(() => {
  setNavigatorOnline(false);
});

afterEach(async () => {
  cleanup();
  await clearUserOfflineData(USER_ID);
  await closeAllOfflineDbs();
  vi.restoreAllMocks();
});

describe("V32-053 Offline Multimedia Parity (Multi-Image Caching, Mapping, Rendering & Cleanup)", () => {
  it("analyzeSetMediaRequirements extracts ALL question & option media_attachments, deduplicates legacy URLs, and enforces text-only guards", () => {
    const richQuestion = makeMultiImageQuestion({
      media_attachments: [
        ...(makeMultiImageQuestion().media_attachments ?? []),
        {
          id: "rel-audio-1",
          media_id: "media-audio-1",
          url: "/api/uploads/signed-url?path=audio-clip.mp3&redirect=1",
          role: "audio",
          sort_order: 0,
          mime_type: "audio/mpeg",
        },
      ],
    });

    const analysis = analyzeSetMediaRequirements([richQuestion], []);

    // 2 prompt + 2 back + 2 explanation + 1 hint + 1 audio + 2 opt-a + 2 opt-b = 12 unique URLs
    // (legacy prompt_image_url, back_image_url, and opt-a image_url MUST deduplicate cleanly!)
    expect(analysis.requiredMedia).toHaveLength(12);

    const byUrl = new Map(analysis.requiredMedia.map((r) => [r.url, r]));
    expect(byUrl.get("/api/uploads/signed-url?path=prompt-1.png&redirect=1")?.media_id).toBe(
      "media-prompt-1",
    );
    expect(byUrl.get("/api/uploads/signed-url?path=prompt-2.png&redirect=1")?.reason).toBe(
      "prompt_image",
    );
    expect(byUrl.get("/api/uploads/signed-url?path=back-2.png&redirect=1")?.reason).toBe(
      "back_image",
    );
    expect(byUrl.get("/api/uploads/signed-url?path=exp-1.png&redirect=1")?.reason).toBe(
      "explanation_image",
    );
    expect(byUrl.get("/api/uploads/signed-url?path=exp-2.png&redirect=1")?.reason).toBe(
      "explanation_image",
    );
    expect(byUrl.get("/api/uploads/signed-url?path=hint-1.png&redirect=1")?.reason).toBe(
      "hint_image",
    );
    expect(byUrl.get("/api/uploads/signed-url?path=audio-clip.mp3&redirect=1")?.kind).toBe(
      "audio",
    );
    expect(byUrl.get("/api/uploads/signed-url?path=opt-a-2.png&redirect=1")?.reason).toBe(
      "option_image",
    );
    expect(byUrl.get("/api/uploads/signed-url?path=opt-b-1.png&redirect=1")?.reason).toBe(
      "option_image",
    );
    expect(byUrl.get("/api/uploads/signed-url?path=opt-b-2.png&redirect=1")?.reason).toBe(
      "option_image",
    );

    // Image-only option defined solely via media_attachments MUST trigger image_only_option guard!
    expect(analysis.requiresMediaForCorrectness).toBe(true);
    expect(analysis.blockingReasons).toContain("image_only_option");

    // Image-only prompt defined solely via media_attachments MUST trigger image_only_question guard!
    const imageOnlyPromptQ = makeMultiImageQuestion({
      id: "q-img-only-att",
      question_type: "single_choice",
      prompt: "   ",
      prompt_image_url: null,
      back_image_url: null,
      media_attachments: [
        {
          id: "rel-only-prompt",
          media_id: "media-only-prompt",
          url: "/api/uploads/signed-url?path=only-prompt.png&redirect=1",
          role: "prompt",
          sort_order: 0,
        },
      ],
      options: [
        {
          id: "opt-text-a",
          question_id: "q-img-only-att",
          study_set_id: SET_ID,
          position: 0,
          label: "A",
          content: "Text option A",
          image_url: null,
          is_correct: true,
          created_at: "2026-11-26T00:00:00.000Z",
        },
      ],
    });
    const promptOnlyAnalysis = analyzeSetMediaRequirements([imageOnlyPromptQ], []);
    expect(promptOnlyAnalysis.requiresMediaForCorrectness).toBe(true);
    expect(promptOnlyAnalysis.blockingReasons).toContain("image_only_question");
    expect(() =>
      validateDownloadOptions(promptOnlyAnalysis, { includeMedia: false }),
    ).toThrowError(OfflineStorageError);
  });

  it("downloadStudySetOffline caches all multi-image prompt/option/back/explanation blobs, maps blob URLs without duplicates, and revokes 100% cleanly", async () => {
    const question = makeMultiImageQuestion();
    const expectedUrls = collectOfflineQuestionMediaUrls(question);
    expect(expectedUrls).toHaveLength(11);

    const fetchedMediaUrls = new Set<string>();
    const fetcher = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === `/api/sets/${SET_ID}`) {
        return makeJsonResponse({
          data: {
            set: {
              id: SET_ID,
              owner_id: USER_ID,
              folder_id: null,
              title: "Multi-Image Offline Biology",
              description: "Test",
              subject: "Biology",
              set_type: "mixed",
              visibility: "private",
              source_language: "en",
              question_count: 1,
              default_exam_duration_minutes: 30,
              default_pass_threshold: 70,
              is_archived: false,
              last_studied_at: null,
              content_version: 3,
              created_at: "2026-11-26T00:00:00.000Z",
              updated_at: "2026-11-26T00:00:00.000Z",
            },
          },
        });
      }
      if (url.startsWith(`/api/sets/${SET_ID}/questions`)) {
        return makeJsonResponse({
          data: [question],
          meta: { total: 1, page: 1, pageSize: 100 },
        });
      }
      if (url === `/api/sets/${SET_ID}/diagrams`) {
        return makeJsonResponse({ data: [] });
      }
      if (expectedUrls.includes(url)) {
        fetchedMediaUrls.add(url);
        return makeBinaryResponse(PNG_BYTES, "image/png");
      }
      return new Response("Not Found", { status: 404 });
    });

    const record = await downloadStudySetOffline({
      userId: USER_ID,
      setId: SET_ID,
      includeMedia: true,
      fetcher,
    });

    expect(record.status).toBe("ready");
    expect(record.media_count).toBe(11);
    expect(record.failed_media_urls).toEqual([]);
    expect(fetchedMediaUrls.size).toBe(11);

    for (const url of expectedUrls) {
      const blobRec = await getMediaBlob(USER_ID, url);
      expect(blobRec).not.toBeNull();
      expect(blobRec?.set_ids).toContain(SET_ID);
    }

    // Track object URL creation & revocation strictly
    let counter = 0;
    const activeBlobUrls = new Set<string>();
    const createSpy = vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
      const next = `blob:v32-multi-${++counter}`;
      activeBlobUrls.add(next);
      return next;
    });
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation((u) => {
      activeBlobUrls.delete(u);
    });

    const bundle = await loadOfflineStudyBundle(USER_ID, SET_ID);
    expect(bundle).not.toBeNull();
    const hydratedQ = bundle!.questions[0]!;

    const mediaMap = await resolveOfflineQuestionMediaMap(bundle!, hydratedQ);
    expect(Object.keys(mediaMap)).toHaveLength(11);
    expect(createSpy).toHaveBeenCalledTimes(11);

    // Calling again reuses cached blob URLs (0 extra createObjectURL calls)
    const mediaMapSecond = await resolveOfflineQuestionMediaMap(bundle!, hydratedQ);
    expect(mediaMapSecond).toEqual(mediaMap);
    expect(createSpy).toHaveBeenCalledTimes(11);

    // Shared question-media helpers map cleanly onto offline blob URLs
    const mappedPrompt = mapOfflineMediaAttachments(
      getQuestionPromptMedia(hydratedQ),
      mediaMap,
      { isOnline: false },
    );
    expect(mappedPrompt.items).toHaveLength(2);
    expect(mappedPrompt.missingOfflineCount).toBe(0);
    expect(mappedPrompt.items.every((i) => i.url.startsWith("blob:"))).toBe(true);

    const mappedBack = mapOfflineMediaAttachments(
      getQuestionBackMedia(hydratedQ),
      mediaMap,
      { isOnline: false },
    );
    expect(mappedBack.items).toHaveLength(2);

    const mappedExplanation = mapOfflineMediaAttachments(
      getQuestionExplanationMedia(hydratedQ),
      mediaMap,
      { isOnline: false },
    );
    expect(mappedExplanation.items).toHaveLength(2);

    const mappedOptB = mapOfflineMediaAttachments(
      getOptionMedia(hydratedQ.options![1]!),
      mediaMap,
      { isOnline: false },
    );
    expect(mappedOptB.items).toHaveLength(2);
    expect(mappedOptB.items.every((i) => i.url.startsWith("blob:"))).toBe(true);

    // Missing offline media while offline reports missingOfflineCount without leaking raw URL
    const missingMapped = mapOfflineMediaAttachments(
      getQuestionExplanationMedia(hydratedQ),
      {},
      { isOnline: false },
    );
    expect(missingMapped.items).toHaveLength(0);
    expect(missingMapped.missingOfflineCount).toBe(2);

    // Revoke MUST release 100% of object URLs
    bundle!.revokeAllMediaUrls();
    expect(revokeSpy).toHaveBeenCalledTimes(11);
    expect(activeBlobUrls.size).toBe(0);

    // Reference-counted deletion removes all unreferenced media blobs
    await deleteDownloadedStudySet(USER_ID, SET_ID);
    for (const url of expectedUrls) {
      expect(await getMediaBlob(USER_ID, url)).toBeNull();
    }
  });

  it("OfflineStudyRunner renders multi-image prompt, multi-image options (including image-only), hides explanation images pre-check, reveals them post-check, and revokes all blob URLs on unmount", async () => {
    const question = makeMultiImageQuestion();
    await putDownloadedSet(USER_ID, makeDownloadedSet());
    await putQuestionsForSet(USER_ID, SET_ID, [question]);
    await seedAllQuestionMediaBlobs(question);

    let counter = 0;
    const activeBlobUrls = new Set<string>();
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
      const next = `blob:v32-practice-${++counter}`;
      activeBlobUrls.add(next);
      return next;
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation((u) => {
      activeBlobUrls.delete(u);
    });

    const { unmount } = render(
      React.createElement(OfflineStudyRunner, {
        userId: USER_ID,
        setId: SET_ID,
        initialMode: "practice",
        onExit: vi.fn(),
      }),
      { wrapper: TestEnProvider },
    );

    // 1. Multi-image prompt renders BOTH cached blob images via MediaGallery
    const promptGallery = await screen.findByTestId("offline-prompt-media-gallery");
    const promptImgs = promptGallery.querySelectorAll("img");
    expect(promptImgs).toHaveLength(2);
    expect(promptImgs[0]?.getAttribute("src")).toMatch(/^blob:v32-practice-/);
    expect(promptImgs[1]?.getAttribute("src")).toMatch(/^blob:v32-practice-/);

    // 2. Option A (text + 2 images) renders BOTH cached blob images
    const optAGallery = screen.getByTestId("offline-option-image-opt-a");
    const optAImgs = optAGallery.querySelectorAll("img");
    expect(optAImgs).toHaveLength(2);
    expect(optAImgs[0]?.getAttribute("src")).toMatch(/^blob:v32-practice-/);
    expect(optAImgs[1]?.getAttribute("src")).toMatch(/^blob:v32-practice-/);

    // 3. Option B (image-only with content: "", image_url: null, 2 media_attachments) renders BOTH images + accessible select button
    const optBGallery = screen.getByTestId("offline-option-image-opt-b");
    const optBImgs = optBGallery.querySelectorAll("img");
    expect(optBImgs).toHaveLength(2);
    expect(optBImgs[0]?.getAttribute("src")).toMatch(/^blob:v32-practice-/);
    expect(optBImgs[1]?.getAttribute("src")).toMatch(/^blob:v32-practice-/);

    // Verify zero nested <button> inside option selection button (HTML5 & a11y valid)
    const optBSelectBtn = screen.getByTestId("offline-option-opt-b");
    expect(optBSelectBtn.querySelector("button")).toBeNull();

    // 4. Anti-leak: explanation images MUST NOT appear before checking answer!
    expect(screen.queryByTestId("offline-explanation-media-gallery")).toBeNull();
    expect(screen.queryByTestId("offline-explanation-section")).toBeNull();

    // 5. Select image-only Option B and check answer -> explanation text + BOTH explanation images appear!
    fireEvent.click(optBSelectBtn);
    fireEvent.click(screen.getByRole("button", { name: /check answer/i }));

    const expGallery = await screen.findByTestId("offline-explanation-media-gallery");
    const expImgs = expGallery.querySelectorAll("img");
    expect(expImgs).toHaveLength(2);
    expect(expImgs[0]?.getAttribute("src")).toMatch(/^blob:v32-practice-/);
    expect(expImgs[1]?.getAttribute("src")).toMatch(/^blob:v32-practice-/);
    expect(
      screen.getByText(/Cristae increase surface area for oxidative phosphorylation/i),
    ).toBeInTheDocument();

    // 6. Unmount revokes 100% of created blob URLs (zero memory leaks!)
    expect(activeBlobUrls.size).toBeGreaterThan(0);
    unmount();
    await waitFor(() => {
      expect(activeBlobUrls.size).toBe(0);
    });
  });

  it("OfflineStudyRunner Flashcards mode reveals multi-image back AND explanation galleries only after flip, and revokes all blob URLs on unmount", async () => {
    const question = makeMultiImageQuestion();
    await putDownloadedSet(USER_ID, makeDownloadedSet());
    await putQuestionsForSet(USER_ID, SET_ID, [question]);
    await seedAllQuestionMediaBlobs(question);

    let counter = 0;
    const activeBlobUrls = new Set<string>();
    vi.spyOn(URL, "createObjectURL").mockImplementation(() => {
      const next = `blob:v32-fc-${++counter}`;
      activeBlobUrls.add(next);
      return next;
    });
    vi.spyOn(URL, "revokeObjectURL").mockImplementation((u) => {
      activeBlobUrls.delete(u);
    });

    const { unmount } = render(
      React.createElement(OfflineStudyRunner, {
        userId: USER_ID,
        setId: SET_ID,
        initialMode: "flashcards",
        onExit: vi.fn(),
      }),
      { wrapper: TestEnProvider },
    );

    // Front side shows 2 prompt images; back & explanation galleries hidden until flip
    const promptGallery = await screen.findByTestId("offline-prompt-media-gallery");
    expect(promptGallery.querySelectorAll("img")).toHaveLength(2);
    expect(screen.queryByTestId("offline-back-media-gallery")).toBeNull();
    expect(screen.queryByTestId("offline-explanation-media-gallery")).toBeNull();

    // Flip card -> both back (2 images) AND explanation (2 images) render via cached blob URLs
    fireEvent.click(screen.getByRole("button", { name: /flip card/i }));

    const backGallery = await screen.findByTestId("offline-back-media-gallery");
    const backImgs = backGallery.querySelectorAll("img");
    expect(backImgs).toHaveLength(2);
    expect(backImgs[0]?.getAttribute("src")).toMatch(/^blob:v32-fc-/);
    expect(backImgs[1]?.getAttribute("src")).toMatch(/^blob:v32-fc-/);

    const expGallery = screen.getByTestId("offline-explanation-media-gallery");
    const expImgs = expGallery.querySelectorAll("img");
    expect(expImgs).toHaveLength(2);
    expect(expImgs[0]?.getAttribute("src")).toMatch(/^blob:v32-fc-/);
    expect(expImgs[1]?.getAttribute("src")).toMatch(/^blob:v32-fc-/);

    // Unmount revokes 100% of blob URLs
    expect(activeBlobUrls.size).toBeGreaterThan(0);
    unmount();
    await waitFor(() => {
      expect(activeBlobUrls.size).toBe(0);
    });
  });
});
