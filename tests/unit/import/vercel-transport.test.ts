import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildVercelSafeCommitChunks,
  estimateQuestionPayloadBytes,
  MAX_COMMIT_QUESTIONS_PER_CHUNK,
  VERCEL_SAFE_COMMIT_CHUNK_BYTES,
} from "@/lib/import/commit-chunker";
import {
  compactPreviewForTransport,
  type ExtendedImportPreviewResult,
} from "@/lib/import/index";
import { validateParsedQuestion } from "@/lib/import/validator";
import {
  uploadAudioSmart,
  uploadFileToTempStorage,
  uploadImageSmart,
  VERCEL_SAFE_DIRECT_PAYLOAD_BYTES,
} from "@/lib/media/direct-upload";
import type { ParsedMediaAttachment, ParsedQuestion } from "@/types/import";

function makeQuestion(
  idx: number,
  overrides: Partial<ParsedQuestion> = {},
): ParsedQuestion {
  return {
    tempId: `q-${idx}`,
    index: idx,
    questionType: "single_choice",
    prompt: `Question ${idx + 1}: What is the standard sea-level pressure in ISA?`,
    chapter: "Atmosphere",
    tags: ["aviation", "isa"],
    difficulty: "medium",
    options: [
      {
        id: `o-${idx}-a`,
        label: "A",
        content: "1013.25 hPa",
        isCorrect: true,
        detectedBy: ["asterisk_prefix"],
      },
      {
        id: `o-${idx}-b`,
        label: "B",
        content: "1000.00 hPa",
        isCorrect: false,
        detectedBy: [],
      },
      {
        id: `o-${idx}-c`,
        label: "C",
        content: "1025.00 hPa",
        isCorrect: false,
        detectedBy: [],
      },
      {
        id: `o-${idx}-d`,
        label: "D",
        content: "990.50 hPa",
        isCorrect: false,
        detectedBy: [],
      },
    ],
    acceptedAnswers: [],
    detectedBy: ["asterisk_prefix"],
    issues: [],
    ...overrides,
  };
}

function makeAttachment(
  rId: string,
  overrides: Partial<ParsedMediaAttachment> = {},
): ParsedMediaAttachment {
  return {
    id: `att-${rId}`,
    rId,
    fileName: `${rId}.png`,
    mimeType: "image/png",
    ext: "png",
    byteLength: 1024,
    previewPath: `/docx-media/${rId}.png`,
    anchorType: "inline",
    ...overrides,
  };
}

function makeJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("Vercel Hobby transport hardening", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe("buildVercelSafeCommitChunks", () => {
    it("returns an empty array for empty input", () => {
      expect(buildVercelSafeCommitChunks([])).toEqual([]);
    });

    it("caps chunks at MAX_COMMIT_QUESTIONS_PER_CHUNK (500) for large text banks", () => {
      const rows = Array.from({ length: 1250 }, (_, i) => makeQuestion(i));
      const chunks = buildVercelSafeCommitChunks(rows);

      expect(chunks.map((c) => c.length)).toEqual([500, 500, 250]);
      expect(chunks.flat().map((q) => q.tempId)).toEqual(rows.map((q) => q.tempId));
      for (const chunk of chunks) {
        const serializedBytes = Buffer.byteLength(
          JSON.stringify({ questions: chunk }),
          "utf8",
        );
        expect(serializedBytes).toBeLessThanOrEqual(VERCEL_SAFE_COMMIT_CHUNK_BYTES);
        expect(chunk.length).toBeLessThanOrEqual(MAX_COMMIT_QUESTIONS_PER_CHUNK);
      }
    });

    it("splits multimedia DOCX batches so every JSON chunk stays <= 2.5 MB", () => {
      const fake200KbDataUrl = `data:image/png;base64,${"A".repeat(200_000)}`;
      const rows = Array.from({ length: 40 }, (_, i) =>
        makeQuestion(i, {
          promptMedia: [
            makeAttachment(`rId${i + 1}`, {
              byteLength: 150_000,
              dataUrl: fake200KbDataUrl,
            }),
          ],
        }),
      );

      const chunks = buildVercelSafeCommitChunks(rows);
      expect(chunks.length).toBeGreaterThanOrEqual(4);
      expect(chunks.flat().length).toBe(rows.length);

      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(MAX_COMMIT_QUESTIONS_PER_CHUNK);
        const serializedBytes = Buffer.byteLength(
          JSON.stringify({ questions: chunk }),
          "utf8",
        );
        expect(serializedBytes).toBeLessThanOrEqual(VERCEL_SAFE_COMMIT_CHUNK_BYTES);
      }
    });

    it("preserves tempStoragePath attachments and packs staged batches compactly", () => {
      const rows = Array.from({ length: 600 }, (_, i) =>
        makeQuestion(i, {
          promptMedia: [
            makeAttachment(`rIdP${i}`, {
              tempStoragePath: `user-1/import-media/${"a".repeat(64)}.png`,
            }),
          ],
          options: [
            {
              id: `o-${i}-a`,
              label: "A",
              content: "Diagram A",
              isCorrect: true,
              detectedBy: ["asterisk_prefix"],
              media: [
                makeAttachment(`rIdO${i}`, {
                  tempStoragePath: `user-1/import-media/${"b".repeat(64)}.png`,
                }),
              ],
            },
            {
              id: `o-${i}-b`,
              label: "B",
              content: "Diagram B",
              isCorrect: false,
              detectedBy: [],
            },
          ],
        }),
      );

      const chunks = buildVercelSafeCommitChunks(rows);
      expect(chunks.map((c) => c.length)).toEqual([500, 100]);
      expect(chunks[0][0].promptMedia?.[0].tempStoragePath).toContain("/import-media/");
      expect(chunks[0][0].options[0].media?.[0].tempStoragePath).toContain(
        "/import-media/",
      );
    });

    it("emits a single oversized item in its own 1-question chunk without dropping it", () => {
      const hugeDataUrl = `data:image/png;base64,${"B".repeat(2_600_000)}`;
      const rows = [
        makeQuestion(0),
        makeQuestion(1, {
          promptMedia: [makeAttachment("rIdHuge", { dataUrl: hugeDataUrl })],
        }),
        makeQuestion(2),
      ];

      expect(estimateQuestionPayloadBytes(rows[1])).toBeGreaterThan(
        VERCEL_SAFE_COMMIT_CHUNK_BYTES,
      );
      const chunks = buildVercelSafeCommitChunks(rows);
      expect(chunks.map((c) => c.map((q) => q.tempId))).toEqual([
        ["q-0"],
        ["q-1"],
        ["q-2"],
      ]);
    });

    it("counts explanationMedia bytes in estimateQuestionPayloadBytes and preserves explanationMedia through validateParsedQuestion (V32-054)", () => {
      const expDataUrl = `data:image/png;base64,${"E".repeat(900_000)}`;
      const expAttachment = makeAttachment("rIdExp1", {
        dataUrl: expDataUrl,
        tempStoragePath: `user-1/import-media/${"c".repeat(64)}.png`,
        alt: "Explanation diagram",
      });

      const baseQ = makeQuestion(0);
      const withExpQ = makeQuestion(0, {
        explanation: "See explanation diagram",
        explanationMedia: [expAttachment],
      });

      const baseBytes = estimateQuestionPayloadBytes(baseQ);
      const expBytes = estimateQuestionPayloadBytes(withExpQ);
      expect(expBytes - baseBytes).toBeGreaterThanOrEqual(900_000);

      // 4 questions x ~900 KB explanationMedia = ~3.6 MB -> must split into 2 safe <= 2.5 MB chunks!
      const batch = Array.from({ length: 4 }, (_, i) =>
        validateParsedQuestion(
          makeQuestion(i, {
            explanation: "Diagram explanation",
            explanationMedia: [makeAttachment(`rIdExp${i}`, { dataUrl: expDataUrl })],
          }),
          i,
        ),
      );
      expect(batch[0].explanationMedia).toHaveLength(1);
      expect(batch[0].explanationMedia?.[0].dataUrl).toBe(expDataUrl);

      const chunks = buildVercelSafeCommitChunks(batch);
      expect(chunks.length).toBe(2);
      for (const chunk of chunks) {
        const serializedBytes = Buffer.byteLength(
          JSON.stringify({ questions: chunk }),
          "utf8",
        );
        expect(serializedBytes).toBeLessThanOrEqual(VERCEL_SAFE_COMMIT_CHUNK_BYTES);
      }
    });
  });

  describe("direct-upload threshold routing", () => {
    const studySetId = "00000000-0000-4000-8000-000000000001";

    it("routes <= 3.5 MB images through single-hop FormData POST /api/uploads/image", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        makeJsonResponse({
          data: {
            url: "/api/uploads/signed-url?path=u1/img.png",
            storagePath: "u1/img.png",
            mimeType: "image/png",
            sizeBytes: 1024,
          },
        }),
      );
      vi.stubGlobal("fetch", fetchMock);

      const smallFile = new File([new Uint8Array(1024)], "diagram.png", {
        type: "image/png",
      });

      const res = await uploadImageSmart({
        file: smallFile,
        fileName: "diagram.png",
        purpose: "question_media",
        studySetId,
        width: 800,
        height: 600,
      });

      expect(res.ok).toBe(true);
      const payload = (await res.json()) as { data: { storagePath: string } };
      expect(payload.data.storagePath).toBe("u1/img.png");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("/api/uploads/image");
      expect(init.method).toBe("POST");
      expect(init.body).toBeInstanceOf(FormData);
    });

    it("routes > 3.5 MB images through signed study-temp PUT + JSON finalize", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          makeJsonResponse({
            data: {
              bucket: "study-temp",
              storagePath: "u1/image/staged-1.png",
              signedUrl: "https://storage.example.test/signed/put-1",
              token: "tok-1",
              expiresIn: 900,
            },
          }),
        )
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(
          makeJsonResponse({
            data: {
              url: "/api/uploads/signed-url?path=u1/final.png",
              storagePath: "u1/final.png",
              mimeType: "image/png",
              sizeBytes: VERCEL_SAFE_DIRECT_PAYLOAD_BYTES + 1024,
            },
          }),
        );
      vi.stubGlobal("fetch", fetchMock);

      const largeFile = new File(
        [new Uint8Array(VERCEL_SAFE_DIRECT_PAYLOAD_BYTES + 1024)],
        "huge-chart.png",
        { type: "image/png" },
      );

      const res = await uploadImageSmart({
        file: largeFile,
        fileName: "huge-chart.png",
        purpose: "question_media",
        studySetId,
        width: 1920,
        height: 1080,
      });

      expect(res.ok).toBe(true);
      const payload = (await res.json()) as { data: { storagePath: string } };
      expect(payload.data.storagePath).toBe("u1/final.png");
      expect(fetchMock).toHaveBeenCalledTimes(3);

      // Step 1: mint signed upload URL
      expect(fetchMock.mock.calls[0][0]).toBe("/api/storage/upload-url");
      const signPayload = JSON.parse(String(fetchMock.mock.calls[0][1].body));
      expect(signPayload).toMatchObject({
        purpose: "image",
        imagePurpose: "question_media",
        fileSize: VERCEL_SAFE_DIRECT_PAYLOAD_BYTES + 1024,
      });

      // Step 2: direct PUT to Supabase signed URL
      expect(fetchMock.mock.calls[1][0]).toBe(
        "https://storage.example.test/signed/put-1",
      );
      expect(fetchMock.mock.calls[1][1].method).toBe("PUT");

      // Step 3: JSON finalize to /api/uploads/image
      expect(fetchMock.mock.calls[2][0]).toBe("/api/uploads/image");
      const finalizePayload = JSON.parse(String(fetchMock.mock.calls[2][1].body));
      expect(finalizePayload).toMatchObject({
        storagePath: "u1/image/staged-1.png",
        fileName: "huge-chart.png",
        purpose: "question_media",
        width: 1920,
        height: 1080,
      });
    });

    it("routes <= 3.5 MB vs > 3.5 MB audio files through direct vs signed upload", async () => {
      // 1) Small audio -> direct FormData POST
      const smallFetch = vi.fn().mockResolvedValue(
        makeJsonResponse({
          data: {
            url: "/api/uploads/signed-url?path=u1/clip.webm",
            storagePath: "u1/clip.webm",
            mimeType: "audio/webm",
            sizeBytes: 2048,
            durationMs: 4200,
          },
        }),
      );
      vi.stubGlobal("fetch", smallFetch);

      const smallAudio = new File([new Uint8Array(2048)], "clip.webm", {
        type: "audio/webm",
      });
      const smallRes = await uploadAudioSmart({
        file: smallAudio,
        fileName: "clip.webm",
        studySetId,
        durationMs: 4200,
      });
      expect(smallRes.ok).toBe(true);
      const smallPayload = (await smallRes.json()) as { data: { storagePath: string } };
      expect(smallPayload.data.storagePath).toBe("u1/clip.webm");
      expect(smallFetch).toHaveBeenCalledTimes(1);
      expect(smallFetch.mock.calls[0][0]).toBe("/api/uploads/audio");

      // 2) Large audio -> 3-step signed upload + JSON finalize
      const largeFetch = vi
        .fn()
        .mockResolvedValueOnce(
          makeJsonResponse({
            data: {
              bucket: "study-temp",
              storagePath: "u1/audio/lecture.mp3",
              signedUrl: "https://storage.example.test/signed/audio-1",
              token: "tok-a",
              expiresIn: 900,
            },
          }),
        )
        .mockResolvedValueOnce(new Response(null, { status: 200 }))
        .mockResolvedValueOnce(
          makeJsonResponse({
            data: {
              url: "/api/uploads/signed-url?path=u1/final.mp3",
              storagePath: "u1/final.mp3",
              mimeType: "audio/mpeg",
              sizeBytes: VERCEL_SAFE_DIRECT_PAYLOAD_BYTES + 2048,
              durationMs: 118000,
            },
          }),
        );
      vi.stubGlobal("fetch", largeFetch);

      const largeAudio = new File(
        [new Uint8Array(VERCEL_SAFE_DIRECT_PAYLOAD_BYTES + 2048)],
        "lecture.mp3",
        { type: "audio/mpeg" },
      );
      const largeRes = await uploadAudioSmart({
        file: largeAudio,
        fileName: "lecture.mp3",
        studySetId,
        durationMs: 118000,
      });

      expect(largeRes.ok).toBe(true);
      const largePayload = (await largeRes.json()) as { data: { storagePath: string } };
      expect(largePayload.data.storagePath).toBe("u1/final.mp3");
      expect(largeFetch).toHaveBeenCalledTimes(3);
      expect(largeFetch.mock.calls[0][0]).toBe("/api/storage/upload-url");
      expect(largeFetch.mock.calls[2][0]).toBe("/api/uploads/audio");
      const finalizeAudio = JSON.parse(String(largeFetch.mock.calls[2][1].body));
      expect(finalizeAudio).toMatchObject({
        storagePath: "u1/audio/lecture.mp3",
        fileName: "lecture.mp3",
        studySetId,
        durationMs: 118000,
      });
    });

    it("throws a descriptive error when signed PUT upload fails", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          makeJsonResponse({
            data: {
              bucket: "study-temp",
              storagePath: "u1/import/bank.docx",
              signedUrl: "https://storage.example.test/signed/fail",
              token: "tok-fail",
              expiresIn: 900,
            },
          }),
        )
        .mockResolvedValueOnce(new Response("Forbidden", { status: 403 }));
      vi.stubGlobal("fetch", fetchMock);

      const blob = new Blob([new Uint8Array(128)], {
        type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      });

      await expect(
        uploadFileToTempStorage({
          file: blob,
          fileName: "bank.docx",
          contentType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          purpose: "import",
        }),
      ).rejects.toThrow(/Direct upload to temporary storage failed \(403\)/);
    });
  });

  describe("compactPreviewForTransport", () => {
    it("strips duplicated dataUrl from top-level extractedMedia while preserving metadata", () => {
      const attachedInline = makeAttachment("rId1", {
        dataUrl: "data:image/png;base64,INLINE_DATA",
      });
      const attachedStaged = makeAttachment("rId2", {
        tempStoragePath: "u1/import-media/abc123.png",
      });
      const unattached = makeAttachment("rId3", {
        dataUrl: "data:image/png;base64,UNATTACHED_DATA",
      });

      const preview: ExtendedImportPreviewResult = {
        format: "docx_multimedia",
        fileName: "sample.docx",
        fileSizeBytes: 12345,
        questions: [
          makeQuestion(0, {
            rawSource: "RAW_HEAVY_SOURCE",
            promptMedia: [attachedInline],
            options: [
              {
                id: "o1",
                label: "A",
                content: "Opt A",
                isCorrect: true,
                detectedBy: ["docx_bold"],
                media: [attachedStaged],
                formatting: { bold: true },
              },
              {
                id: "o2",
                label: "B",
                content: "Opt B",
                isCorrect: false,
                detectedBy: [],
              },
            ],
          }),
        ],
        issues: [],
        summary: {
          totalDetected: 1,
          validCount: 1,
          warningCount: 0,
          errorCount: 0,
          duplicateCount: 0,
          missingAnswerCount: 0,
          conflictCount: 0,
        },
        ruleUsed: { mode: "auto" },
        detectedChapters: ["Atmosphere"],
        extractedMedia: [
          { ...attachedInline },
          { ...attachedStaged, dataUrl: "data:image/png;base64,STAGED_DUPLICATE" },
          { ...unattached },
        ],
      };

      const compacted = compactPreviewForTransport(preview);

      // rawSource & formatting stripped
      expect(compacted.questions[0].rawSource).toBeUndefined();
      expect(compacted.questions[0].options[0].formatting).toBeUndefined();

      // question/option attachments retained intact
      expect(compacted.questions[0].promptMedia?.[0].dataUrl).toBe(
        "data:image/png;base64,INLINE_DATA",
      );
      expect(compacted.questions[0].options[0].media?.[0].tempStoragePath).toBe(
        "u1/import-media/abc123.png",
      );

      // extractedMedia metadata preserved, duplicated dataUrls stripped
      expect(compacted.extractedMedia).toHaveLength(3);
      expect(compacted.extractedMedia?.[0]).toMatchObject({
        rId: "rId1",
        fileName: "rId1.png",
        mimeType: "image/png",
      });
      expect(compacted.extractedMedia?.[0].dataUrl).toBeUndefined();
      expect(compacted.extractedMedia?.[1].dataUrl).toBeUndefined();
      expect(compacted.extractedMedia?.[2].dataUrl).toBe(
        "data:image/png;base64,UNATTACHED_DATA",
      );
    });
  });

  describe("bundle hygiene & leaf-import guards", () => {
    const root = process.cwd();

    it("keeps src/lib/media/direct-upload.ts 100% free of @supabase/supabase-js imports", () => {
      const source = fs.readFileSync(
        path.join(root, "src/lib/media/direct-upload.ts"),
        "utf8",
      );
      expect(source).not.toMatch(/from\s+["']@supabase\/(?:supabase-js|ssr)["']/);
      expect(source).not.toMatch(/require\(\s*["']@supabase\/(?:supabase-js|ssr)["']\s*\)/);
      expect(source).not.toMatch(/import\(\s*["']@supabase\/(?:supabase-js|ssr)["']\s*\)/);
    });

    it("enforces runtime='nodejs', maxDuration=60, leaf imports, and distributed rate limits on owned routes", () => {
      const routesWithBarrelBan = [
        "src/app/api/import/commit/route.ts",
        "src/app/api/import/_existing-fingerprints.ts",
        "src/app/api/export/pdf/route.ts",
        "src/app/api/sets/[id]/export/route.ts",
        "src/app/api/import/templates/[format]/route.ts",
      ];

      for (const relPath of routesWithBarrelBan) {
        const src = fs.readFileSync(path.join(root, relPath), "utf8");
        expect(src, `${relPath} must not import @/lib/import barrel`).not.toMatch(
          /from\s+["']@\/lib\/import(?:\/index)?["']/,
        );
      }

      const routeFiles = [
        "src/app/api/import/parse/route.ts",
        "src/app/api/import/commit/route.ts",
        "src/app/api/export/pdf/route.ts",
        "src/app/api/sets/[id]/export/route.ts",
        "src/app/api/import/templates/[format]/route.ts",
      ];

      for (const relPath of routeFiles) {
        const src = fs.readFileSync(path.join(root, relPath), "utf8");
        expect(src, `${relPath} missing runtime='nodejs'`).toMatch(
          /export const runtime = "nodejs";/,
        );
        expect(src, `${relPath} missing maxDuration=60`).toMatch(
          /export const maxDuration = 60;/,
        );
      }

      const rateLimitedRoutes = [
        "src/app/api/import/parse/route.ts",
        "src/app/api/import/commit/route.ts",
        "src/app/api/export/pdf/route.ts",
        "src/app/api/sets/[id]/export/route.ts",
      ];

      for (const relPath of rateLimitedRoutes) {
        const src = fs.readFileSync(path.join(root, relPath), "utf8");
        expect(src, `${relPath} must use enforceDistributedRateLimit`).toMatch(
          /enforceDistributedRateLimit/,
        );
        expect(src, `${relPath} must not call legacy enforceRateLimit`).not.toMatch(
          /\benforceRateLimit\b/,
        );
      }
    });
  });
});
