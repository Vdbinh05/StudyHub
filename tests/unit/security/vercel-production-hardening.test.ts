import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  enforceDistributedRateLimit,
  getClientIdentifier,
  RATE_LIMITS,
} from "@/lib/security/rate-limit";
import {
  createChunkedByteStream,
  streamBinaryResponse,
  streamJsonResponse,
} from "@/lib/security/stream-response";
import { getAppUrl } from "@/lib/supabase/env";
import {
  consumeTempUploadBytes,
  isOwnedTempStoragePath,
  TEMP_STORAGE_BUCKET,
} from "@/lib/supabase/temp-storage";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("Vercel Hobby Production Hardening: Temp Storage Helpers", () => {
  const userA = "11111111-1111-4111-8111-111111111111";
  const userB = "22222222-2222-4222-8222-222222222222";
  const fileUuid = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

  it("validates strictly owned temp storage paths and rejects traversal / cross-user / wrong purpose", () => {
    expect(
      isOwnedTempStoragePath(
        `${userA}/import/${fileUuid}.docx`,
        userA,
        "import",
      ),
    ).toBe(true);
    expect(
      isOwnedTempStoragePath(
        `${userA}/image/${fileUuid}.png`,
        userA,
        "image",
      ),
    ).toBe(true);
    expect(
      isOwnedTempStoragePath(
        `${userA}/audio/${fileUuid}.webm`,
        userA,
        "audio",
      ),
    ).toBe(true);
    expect(
      isOwnedTempStoragePath(
        `${userA}/restore/${fileUuid}.json`,
        userA,
        "restore",
      ),
    ).toBe(true);

    // Cross-user path rejected
    expect(
      isOwnedTempStoragePath(
        `${userB}/import/${fileUuid}.docx`,
        userA,
        "import",
      ),
    ).toBe(false);

    // Wrong purpose rejected
    expect(
      isOwnedTempStoragePath(
        `${userA}/image/${fileUuid}.png`,
        userA,
        "import",
      ),
    ).toBe(false);

    // Path traversal, nested paths, backslashes, or non-UUID filenames rejected
    expect(
      isOwnedTempStoragePath(
        `${userA}/import/../${userB}/${fileUuid}.docx`,
        userA,
        "import",
      ),
    ).toBe(false);
    expect(
      isOwnedTempStoragePath(
        `${userA}/import/nested/${fileUuid}.docx`,
        userA,
        "import",
      ),
    ).toBe(false);
    // Leading dots, spaces/special chars, missing extensions, or leading slash rejected
    expect(
      isOwnedTempStoragePath(
        `${userA}/import/.hidden.docx`,
        userA,
        "import",
      ),
    ).toBe(false);
    expect(
      isOwnedTempStoragePath(
        `${userA}/import/noextension`,
        userA,
        "import",
      ),
    ).toBe(false);
    expect(
      isOwnedTempStoragePath(
        `/${userA}/import/${fileUuid}.docx`,
        userA,
        "import",
      ),
    ).toBe(false);
    expect(
      isOwnedTempStoragePath(
        `${userA}/import-media/img-0123456789abcdef.png`,
        userA,
        "import-media",
      ),
    ).toBe(true);
  });

  it("consumeTempUploadBytes rejects cross-user paths BEFORE touching Supabase storage", async () => {
    const download = vi.fn();
    const remove = vi.fn();
    const fakeSupabase = {
      storage: {
        from: vi.fn(() => ({ download, remove })),
      },
    };

    await expect(
      consumeTempUploadBytes(fakeSupabase as never, {
        userId: userA,
        storagePath: `${userB}/import/${fileUuid}.docx`,
        expectedPurpose: "import",
        maxBytes: 15 * 1024 * 1024,
      }),
    ).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });

    expect(download).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });

  it("consumeTempUploadBytes enforces maxBytes and cleans up oversized temp files", async () => {
    const oversized = new Uint8Array(1024);
    const remove = vi.fn(async () => ({ data: [], error: null }));
    const download = vi.fn(async () => ({
      data: {
        size: oversized.byteLength,
        arrayBuffer: async () =>
          oversized.buffer.slice(
            oversized.byteOffset,
            oversized.byteOffset + oversized.byteLength,
          ),
      },
      error: null,
    }));
    const fakeSupabase = {
      storage: {
        from: vi.fn((bucket: string) => {
          expect(bucket).toBe(TEMP_STORAGE_BUCKET);
          return { download, remove };
        }),
      },
    };

    const storagePath = `${userA}/restore/${fileUuid}.json`;
    await expect(
      consumeTempUploadBytes(fakeSupabase as never, {
        userId: userA,
        storagePath,
        expectedPurpose: "restore",
        maxBytes: 512,
      }),
    ).rejects.toMatchObject({ status: 413, code: "PAYLOAD_TOO_LARGE" });

    expect(remove).toHaveBeenCalledWith([storagePath]);
  });

  it("consumeTempUploadBytes returns exact bytes and idempotent cleanup()", async () => {
    const payload = new TextEncoder().encode('{"hello":"studyhub"}');
    const remove = vi.fn(async () => ({ data: [], error: null }));
    const download = vi.fn(async () => ({
      data: {
        size: payload.byteLength,
        arrayBuffer: async () =>
          payload.buffer.slice(
            payload.byteOffset,
            payload.byteOffset + payload.byteLength,
          ),
      },
      error: null,
    }));
    const fakeSupabase = {
      storage: {
        from: vi.fn(() => ({ download, remove })),
      },
    };

    const storagePath = `${userA}/restore/${fileUuid}.json`;
    const result = await consumeTempUploadBytes(fakeSupabase as never, {
      userId: userA,
      storagePath,
      expectedPurpose: "restore",
      maxBytes: 1024,
    });

    expect(Array.from(result.bytes)).toEqual(Array.from(payload));
    await result.cleanup();
    await result.cleanup(); // idempotent second call
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith([storagePath]);
  });
});

describe("Vercel Hobby Production Hardening: Streaming Responses", () => {
  it("streams binary bytes in chunks and strictly omits Content-Length", async () => {
    const input = new Uint8Array(150_000);
    for (let i = 0; i < input.length; i++) {
      input[i] = i % 251;
    }

    const res = streamBinaryResponse(input, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="exam.pdf"',
        "Content-Length": "150000", // Must be stripped!
      },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-length")).toBeNull();
    expect(res.headers.get("content-disposition")).toContain("exam.pdf");

    const out = new Uint8Array(await res.arrayBuffer());
    expect(out.byteLength).toBe(input.byteLength);
    expect(out[0]).toBe(input[0]);
    expect(out[149_999]).toBe(input[149_999]);
  });

  it("streams JSON exports cleanly without Content-Length", async () => {
    const payload = {
      schema_version: "studyhub-v2",
      study_sets: [{ id: "1", title: "Toán cao cấp" }],
    };

    const res = streamJsonResponse(payload, {
      headers: {
        "Cache-Control": "no-store",
      },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-length")).toBeNull();

    const parsed = await res.json();
    expect(parsed).toEqual(payload);
  });

  it("createChunkedByteStream handles empty buffers gracefully", async () => {
    const stream = createChunkedByteStream(new Uint8Array(0));
    const res = new Response(stream);
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(buf.byteLength).toBe(0);
  });
});

describe("Vercel Hobby Production Hardening: Distributed Rate Limiting & App URL", () => {
  it("prioritizes x-vercel-forwarded-for over x-real-ip and x-forwarded-for", () => {
    const reqWithSpoof = new NextRequest("https://studyhub.vercel.app/api/search", {
      headers: {
        "x-vercel-forwarded-for": "203.0.113.10, 10.0.0.1",
        "x-real-ip": "198.51.100.77",
        "x-forwarded-for": "192.0.2.5",
      },
    });
    const reqClean = new NextRequest("https://studyhub.vercel.app/api/search", {
      headers: {
        "x-vercel-forwarded-for": "203.0.113.10",
      },
    });
    const reqOther = new NextRequest("https://studyhub.vercel.app/api/search", {
      headers: {
        "x-vercel-forwarded-for": "198.51.100.77",
      },
    });

    const id1 = getClientIdentifier(reqWithSpoof);
    const id2 = getClientIdentifier(reqClean);
    const id3 = getClientIdentifier(reqOther);

    expect(id1).toMatch(/^ip:[0-9a-f]{16}$/);
    expect(id1).toBe(id2);
    expect(id1).not.toBe(id3);
  });

  it("falls back to in-memory rate limiting when admin client is absent and returns 429 headers", async () => {
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    expect(RATE_LIMITS.STORAGE_SIGN.limit).toBe(40);
    expect(RATE_LIMITS.STORAGE_SIGN.windowMs).toBe(15 * 60_000);

    const uniqueKey = `test-dist-${Date.now()}-${Math.random()}`;
    const req = new NextRequest("https://studyhub.vercel.app/api/storage/upload-url", {
      headers: { "x-vercel-forwarded-for": "203.0.113.42" },
    });

    const r1 = await enforceDistributedRateLimit(req, {
      bucket: uniqueKey,
      limit: 2,
      windowMs: 60_000,
    });
    expect(r1).toBeNull();

    const r2 = await enforceDistributedRateLimit(req, {
      bucket: uniqueKey,
      limit: 2,
      windowMs: 60_000,
    });
    expect(r2).toBeNull();

    const r3 = await enforceDistributedRateLimit(req, {
      bucket: uniqueKey,
      limit: 2,
      windowMs: 60_000,
    });
    expect(r3).not.toBeNull();
    expect(r3?.status).toBe(429);
    expect(r3?.headers.get("retry-after")).toBeTruthy();
    expect(r3?.headers.get("x-ratelimit-limit")).toBe("2");
    expect(r3?.headers.get("x-ratelimit-remaining")).toBe("0");

    const body = (await r3?.json()) as { error?: { code?: string } };
    expect(body.error?.code).toBe("RATE_LIMITED");
  });

  it("resolves getAppUrl() in exact Vercel priority order", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://studyhub.example.com/";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "studyhub-prod.vercel.app";
    process.env.VERCEL_URL = "studyhub-preview.vercel.app";
    expect(getAppUrl()).toBe("https://studyhub.example.com");

    delete process.env.NEXT_PUBLIC_APP_URL;
    expect(getAppUrl()).toBe("https://studyhub-prod.vercel.app");

    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    expect(getAppUrl()).toBe("https://studyhub-preview.vercel.app");

    delete process.env.VERCEL_URL;
    expect(getAppUrl()).toBe("http://localhost:3000");
  });
});

describe("Vercel Hobby Production Hardening: Route Config & Auth Cache-Control Static Checks", () => {
  const heavyRoutes = [
    "src/app/api/storage/upload-url/route.ts",
    "src/app/api/uploads/image/route.ts",
    "src/app/api/uploads/audio/route.ts",
    "src/app/api/account/restore/route.ts",
    "src/app/api/account/data/route.ts",
    "src/app/api/exams/route.ts",
    "src/app/api/exams/[attemptId]/submit/route.ts",
    "src/app/api/coverage-cycles/route.ts",
    "src/app/api/coverage-cycles/[id]/next-exam/route.ts",
    "src/app/api/sets/[id]/duplicate/route.ts",
    "src/app/api/sets/[id]/questions/bulk/route.ts",
    "src/app/api/sync/events/route.ts",
  ];

  it("declares runtime = 'nodejs' and maxDuration = 60 on all owned heavy routes", () => {
    for (const relPath of heavyRoutes) {
      const content = readFileSync(path.resolve(process.cwd(), relPath), "utf8");
      expect(content, `${relPath} missing runtime = "nodejs"`).toMatch(
        /export const runtime = "nodejs";/,
      );
      expect(content, `${relPath} missing maxDuration = 60`).toMatch(
        /export const maxDuration = 60;/,
      );
    }
  });

  it("sets Cache-Control: no-store on all auth callback/confirm/signout routes", () => {
    for (const relPath of [
      "src/app/auth/callback/route.ts",
      "src/app/auth/confirm/route.ts",
      "src/app/auth/signout/route.ts",
    ]) {
      const content = readFileSync(path.resolve(process.cwd(), relPath), "utf8");
      expect(content, `${relPath} missing Cache-Control: no-store`).toMatch(
        /["']Cache-Control["']\s*[,:]\s*["'](?:private,\s*)?no-store["']/,
      );
    }
  });
});
