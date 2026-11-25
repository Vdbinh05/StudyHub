// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockRequireAuth = vi.fn();
const mockRequireStudySetAccess = vi.fn();
const mockEnforceRateLimit = vi.fn();

vi.mock("@/lib/security/authz", () => ({
  requireAuth: (...args: unknown[]) => mockRequireAuth(...args),
  requireStudySetAccess: (...args: unknown[]) => mockRequireStudySetAccess(...args),
}));

vi.mock("@/lib/security/rate-limit", () => ({
  enforceDistributedRateLimit: (...args: unknown[]) => mockEnforceRateLimit(...args),
  RATE_LIMITS: {
    UPLOAD: { id: "upload", limit: 30, windowMs: 60_000 },
    AUDIO_UPLOAD: { id: "audio_upload", limit: 30, windowMs: 60_000 },
  },
}));

import { POST as imagePost } from "@/app/api/uploads/image/route";
import { POST as audioPost } from "@/app/api/uploads/audio/route";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const SET_ID = "22222222-2222-4222-8222-222222222222";
const EXISTING_IMG_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EXISTING_AUD_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const VALID_PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

const VALID_WAV = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00,
  0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20,
]);

describe("V3.2 Upload SHA-256 Deduplication (V32-048 / DB-13)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEnforceRateLimit.mockResolvedValue(null);
    mockRequireStudySetAccess.mockResolvedValue({
      studySet: { id: SET_ID, owner_id: USER_ID, title: "Demo" },
      role: "owner",
      canRead: true,
      canEdit: true,
      isOwner: true,
      canClone: true,
    });
  });

  it("POST /api/uploads/image reuses existing active media_assets row without uploading duplicate blob", async () => {
    const uploadSpy = vi.fn();
    const insertSpy = vi.fn();
    const existingPath = `${USER_ID}/${SET_ID}/existing-img.png`;

    const mockSupabase = {
      storage: {
        from: () => ({
          upload: uploadSpy,
          createSignedUrl: vi.fn().mockResolvedValue({
            data: { signedUrl: "https://storage.example/signed-existing-img" },
            error: null,
          }),
        }),
      },
      from: (table: string) => {
        if (table === "media_assets") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    eq: () => ({
                      eq: () => ({
                        order: () => ({
                          limit: () => ({
                            maybeSingle: async () => ({
                              data: {
                                id: EXISTING_IMG_ID,
                                storage_path: existingPath,
                                mime_type: "image/png",
                                size_bytes: VALID_PNG.byteLength,
                                width: 1,
                                height: 1,
                              },
                              error: null,
                            }),
                          }),
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
            insert: insertSpy,
          };
        }
        throw new Error(`Unexpected table ${table}`);
      },
    };

    mockRequireAuth.mockResolvedValue({
      supabase: mockSupabase,
      user: { id: USER_ID },
    });

    const fd = new FormData();
    fd.append("file", new File([VALID_PNG], "diagram.png", { type: "image/png" }));
    fd.append("purpose", "question");
    fd.append("studySetId", SET_ID);

    const req = new NextRequest("http://localhost/api/uploads/image", {
      method: "POST",
      body: fd,
    });
    const res = await imagePost(req);
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: { id: string; path: string; deduplicated?: boolean };
    };

    expect(body.data.id).toBe(EXISTING_IMG_ID);
    expect(body.data.path).toBe(existingPath);
    expect(body.data.deduplicated).toBe(true);
    expect(uploadSpy).not.toHaveBeenCalled();
    expect(insertSpy).not.toHaveBeenCalled();
  });

  it("POST /api/uploads/audio reuses existing active media_assets row without uploading duplicate audio blob", async () => {
    const uploadSpy = vi.fn();
    const insertSpy = vi.fn();
    const existingPath = `${USER_ID}/${SET_ID}/audio-existing.wav`;

    const mockSupabase = {
      storage: {
        from: () => ({
          upload: uploadSpy,
          createSignedUrl: vi.fn().mockResolvedValue({
            data: { signedUrl: "https://storage.example/signed-existing-audio" },
            error: null,
          }),
        }),
      },
      from: (table: string) => {
        if (table === "media_assets") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    eq: () => ({
                      eq: () => ({
                        order: () => ({
                          limit: () => ({
                            maybeSingle: async () => ({
                              data: {
                                id: EXISTING_AUD_ID,
                                storage_path: existingPath,
                                mime_type: "audio/wav",
                                size_bytes: VALID_WAV.byteLength,
                                duration_ms: 4200,
                              },
                              error: null,
                            }),
                          }),
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            }),
            insert: insertSpy,
          };
        }
        throw new Error(`Unexpected table ${table}`);
      },
    };

    mockRequireAuth.mockResolvedValue({
      supabase: mockSupabase,
      user: { id: USER_ID },
    });

    const fd = new FormData();
    fd.append("file", new File([VALID_WAV], "clip.wav", { type: "audio/wav" }));
    fd.append("purpose", "listening");
    fd.append("studySetId", SET_ID);

    const req = new NextRequest("http://localhost/api/uploads/audio", {
      method: "POST",
      body: fd,
    });
    const res = await audioPost(req);
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: { id: string; path: string; deduplicated?: boolean; durationMs: number | null };
    };

    expect(body.data.id).toBe(EXISTING_AUD_ID);
    expect(body.data.path).toBe(existingPath);
    expect(body.data.durationMs).toBe(4200);
    expect(body.data.deduplicated).toBe(true);
    expect(uploadSpy).not.toHaveBeenCalled();
    expect(insertSpy).not.toHaveBeenCalled();
  });
});
