import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearUserOfflineData,
  closeAllOfflineDbs,
  getDiagramsForSet,
  getDownloadedSet,
  getMediaBlob,
  getQuestionsForSet,
  OfflineStorageError,
} from "@/lib/offline/db";
import {
  analyzeSetMediaRequirements,
  checkStudySetUpdateStatus,
  deleteDownloadedStudySet,
  downloadStudySetOffline,
  retryFailedMediaDownloads,
  validateDownloadOptions,
} from "@/lib/offline/download-manager";
import type {
  DownloadProgress,
  OfflineDiagramRecord,
  OfflineQuestionRecord,
} from "@/lib/offline/types";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const SET_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function makeBaseQuestion(
  overrides: Partial<OfflineQuestionRecord> = {},
): OfflineQuestionRecord {
  return {
    id: overrides.id ?? "q-1",
    user_id: USER_ID,
    study_set_id: SET_ID,
    question_type: "single_choice",
    position: 0,
    chapter: "Ch 1",
    prompt: "What is the standard sea level pressure?",
    prompt_image_url: null,
    back_text: null,
    back_image_url: null,
    explanation: "1013.25 hPa",
    hint: null,
    difficulty: "medium",
    source_metadata: {},
    created_at: "2026-11-24T10:00:00.000Z",
    updated_at: "2026-11-24T10:00:00.000Z",
    options: [
      {
        id: "opt-a",
        question_id: overrides.id ?? "q-1",
        study_set_id: SET_ID,
        position: 0,
        label: "A",
        content: "1013.25 hPa",
        image_url: null,
        is_correct: true,
        created_at: "2026-11-24T10:00:00.000Z",
      },
    ],
    cached_at: "2026-11-24T10:00:00.000Z",
    ...overrides,
  };
}

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

afterEach(async () => {
  await clearUserOfflineData(USER_ID);
  await closeAllOfflineDbs();
  vi.restoreAllMocks();
});

describe("Download Manager (`src/lib/offline/download-manager.ts`)", () => {
  it("blocks text-only download when set contains image-only, image_choice, listening, or diagram items", () => {
    const imageOnlyQ = makeBaseQuestion({
      id: "q-img-only",
      prompt: "   ",
      prompt_image_url: "/api/uploads/signed-url?path=p1&redirect=1",
    });
    const listeningQ = makeBaseQuestion({
      id: "q-listen",
      question_type: "listening",
      audio_url: "/api/uploads/signed-url?path=a1&redirect=1",
      type_payload: {
        type: "listening",
        audio_url: "/api/uploads/signed-url?path=a1&redirect=1",
        sub_answer_kind: "single_choice",
      },
    });
    const imageChoiceQ = makeBaseQuestion({
      id: "q-ic",
      question_type: "image_choice",
      options: [
        {
          id: "opt-img",
          question_id: "q-ic",
          study_set_id: SET_ID,
          position: 0,
          label: "A",
          content: "",
          image_url: "/api/uploads/signed-url?path=o1&redirect=1",
          is_correct: true,
          created_at: "2026-11-24T10:00:00.000Z",
        },
      ],
    });

    const analysis = analyzeSetMediaRequirements(
      [imageOnlyQ, listeningQ, imageChoiceQ],
      [],
    );
    expect(analysis.requiresMediaForCorrectness).toBe(true);
    expect(analysis.requiredMedia).toHaveLength(3);
    expect(analysis.blockingReasons.length).toBeGreaterThanOrEqual(3);

    expect(() =>
      validateDownloadOptions(analysis, { includeMedia: false }),
    ).toThrowError(OfflineStorageError);
    try {
      validateDownloadOptions(analysis, { includeMedia: false });
    } catch (err) {
      expect((err as OfflineStorageError).code).toBe("MEDIA_REQUIRED_FOR_SET");
    }

    // Allowing media passes cleanly
    expect(() =>
      validateDownloadOptions(analysis, { includeMedia: true }),
    ).not.toThrow();

    // Pure text set allows text-only download
    const textOnlyAnalysis = analyzeSetMediaRequirements([makeBaseQuestion()], []);
    expect(textOnlyAnalysis.requiresMediaForCorrectness).toBe(false);
    expect(() =>
      validateDownloadOptions(textOnlyAnalysis, { includeMedia: false }),
    ).not.toThrow();
  });

  it("blocks text-only download when diagrams exist even if questions are text-only", () => {
    const diagram: OfflineDiagramRecord = {
      id: "d-1",
      user_id: USER_ID,
      study_set_id: SET_ID,
      owner_id: USER_ID,
      title: "Heart Diagram",
      description: null,
      base_media_id: null,
      base_image_url: "/api/uploads/signed-url?path=heart&redirect=1",
      image_width: 800,
      image_height: 600,
      content_version: 1,
      created_at: "2026-11-24T10:00:00.000Z",
      updated_at: "2026-11-24T10:00:00.000Z",
      hotspots: [],
      cached_at: "2026-11-24T10:00:00.000Z",
    };

    const analysis = analyzeSetMediaRequirements([makeBaseQuestion()], [diagram]);
    expect(analysis.requiresMediaForCorrectness).toBe(true);
    expect(() =>
      validateDownloadOptions(analysis, { includeMedia: false }),
    ).toThrowError(OfflineStorageError);
  });

  it("downloads selected chapters + media blobs, reports progress, retries failed media, and checks updates", async () => {
    const imgUrl1 = "/api/uploads/signed-url?path=ch1-img&redirect=1";
    const audioUrl = "/api/uploads/signed-url?path=ch1-audio&redirect=1";
    const ch2ImgUrl = "/api/uploads/signed-url?path=ch2-img&redirect=1";

    let failAudioOnce = true;

    const fetcher = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === `/api/sets/${SET_ID}`) {
        return makeJsonResponse({
          data: {
            set: {
              id: SET_ID,
              owner_id: USER_ID,
              folder_id: null,
              title: "Aviation Meteorology",
              description: "Core chapters",
              subject: "Meteorology",
              set_type: "mixed",
              visibility: "private",
              source_language: "vi",
              question_count: 2,
              default_exam_duration_minutes: 30,
              default_pass_threshold: 70,
              is_archived: false,
              last_studied_at: null,
              content_version: 2,
              created_at: "2026-11-24T10:00:00.000Z",
              updated_at: "2026-11-24T10:00:00.000Z",
            },
          },
        });
      }
      if (url.startsWith(`/api/sets/${SET_ID}/questions`)) {
        return makeJsonResponse({
          data: [
            makeBaseQuestion({
              id: "q-ch1",
              chapter: "Ch 1",
              prompt_image_url: imgUrl1,
              audio_url: audioUrl,
            }),
            makeBaseQuestion({
              id: "q-ch2",
              chapter: "Ch 2",
              position: 1,
              prompt_image_url: ch2ImgUrl,
            }),
          ],
          meta: { total: 2, page: 1, pageSize: 100 },
        });
      }
      if (url === `/api/sets/${SET_ID}/diagrams`) {
        return makeJsonResponse({ data: [] });
      }
      if (url === imgUrl1) {
        return makeBinaryResponse(new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]), "image/png");
      }
      if (url === audioUrl) {
        if (failAudioOnce) {
          failAudioOnce = false;
          return new Response("Temporary error", { status: 503 });
        }
        return makeBinaryResponse(new Uint8Array([73, 68, 51, 4, 0, 0]), "audio/mpeg");
      }
      return new Response("Not Found", { status: 404 });
    });

    const progressEvents: DownloadProgress[] = [];

    const record = await downloadStudySetOffline({
      userId: USER_ID,
      setId: SET_ID,
      chapters: ["Ch 1"],
      includeMedia: true,
      fetcher,
      onProgress: (p) => progressEvents.push(p),
    });

    // Only Ch 1 downloaded; audio failed once -> partial status with 1 failed URL
    expect(record.downloaded_chapters).toEqual(["Ch 1"]);
    expect(record.question_count).toBe(1);
    expect(record.status).toBe("partial");
    expect(record.failed_media_urls).toEqual([audioUrl]);
    expect(progressEvents.some((p) => p.phase === "downloading_media")).toBe(true);

    const savedQs = await getQuestionsForSet(USER_ID, SET_ID);
    expect(savedQs.map((q) => q.id)).toEqual(["q-ch1"]);
    expect(await getMediaBlob(USER_ID, imgUrl1)).not.toBeNull();
    expect(await getMediaBlob(USER_ID, ch2ImgUrl)).toBeNull();

    // Retry failed media succeeds and marks set "ready"
    const retried = await retryFailedMediaDownloads(USER_ID, SET_ID, { fetcher });
    expect(retried.status).toBe("ready");
    expect(retried.failed_media_urls).toEqual([]);
    expect(await getMediaBlob(USER_ID, audioUrl)).not.toBeNull();

    // Update check detects newer server content_version
    const updateFetcher = vi.fn(async () =>
      makeJsonResponse({
        data: {
          set: {
            id: SET_ID,
            content_version: 5,
            updated_at: "2026-11-25T10:00:00.000Z",
          },
        },
      }),
    );
    const updateInfo = await checkStudySetUpdateStatus(USER_ID, SET_ID, updateFetcher);
    expect(updateInfo.hasUpdate).toBe(true);
    expect(updateInfo.localVersion).toBe(2);
    expect(updateInfo.serverVersion).toBe(5);

    // Delete downloaded set cleans up everything
    await deleteDownloadedStudySet(USER_ID, SET_ID);
    expect(await getDownloadedSet(USER_ID, SET_ID)).toBeNull();
    expect(await getQuestionsForSet(USER_ID, SET_ID)).toEqual([]);
    expect(await getDiagramsForSet(USER_ID, SET_ID)).toEqual([]);
    expect(await getMediaBlob(USER_ID, imgUrl1)).toBeNull();
  });

  it("supports clean cancellation via AbortController without unhandled errors", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === `/api/sets/${SET_ID}`) {
        controller.abort();
        return makeJsonResponse({
          data: {
            set: {
              id: SET_ID,
              owner_id: USER_ID,
              title: "Aborted Set",
              subject: null,
              description: null,
              set_type: "mixed",
              visibility: "private",
              source_language: "vi",
              question_count: 1,
              updated_at: "2026-11-24T10:00:00.000Z",
            },
          },
        });
      }
      return makeJsonResponse({ data: [] });
    });

    await expect(
      downloadStudySetOffline({
        userId: USER_ID,
        setId: SET_ID,
        signal: controller.signal,
        fetcher,
      }),
    ).rejects.toMatchObject({ code: "ABORTED" });
  });

  it("rejects proactively with QUOTA_EXCEEDED when estimated bytes exceed remaining browser quota", async () => {
    Object.defineProperty(navigator, "storage", {
      value: {
        estimate: vi.fn().mockResolvedValue({
          usage: 99_999_000,
          quota: 100_000_000, // only ~1 KB free!
        }),
      },
      configurable: true,
    });

    const fetcher = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === `/api/sets/${SET_ID}`) {
        return makeJsonResponse({
          data: {
            set: {
              id: SET_ID,
              owner_id: USER_ID,
              title: "Huge Media Set",
              subject: null,
              description: null,
              set_type: "mixed",
              visibility: "private",
              source_language: "vi",
              question_count: 1,
              updated_at: "2026-11-24T10:00:00.000Z",
            },
          },
        });
      }
      if (url.startsWith(`/api/sets/${SET_ID}/questions`)) {
        return makeJsonResponse({
          data: [
            makeBaseQuestion({
              prompt_image_url: "/api/uploads/signed-url?path=big&redirect=1",
            }),
          ],
          meta: { total: 1, page: 1, pageSize: 100 },
        });
      }
      return makeJsonResponse({ data: [] });
    });

    await expect(
      downloadStudySetOffline({
        userId: USER_ID,
        setId: SET_ID,
        includeMedia: true,
        fetcher,
      }),
    ).rejects.toMatchObject({ code: "QUOTA_EXCEEDED" });
  });
});
