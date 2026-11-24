import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  isSafeRelativeRedirect,
  requireAuth,
} from "@/lib/security/authz";
import {
  apiError,
  apiSuccess,
  AppError,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import {
  checkRateLimit,
  enforceRateLimit,
  getClientIdentifier,
  RATE_LIMITS,
  resetRateLimitStore,
} from "@/lib/security/rate-limit";
import {
  isSafeHttpOrStorageUrl,
  normalizeAnswerText,
  sanitizeFilename,
  sanitizeText,
  slugifyTag,
  stripDiacritics,
} from "@/lib/security/sanitize";
import {
  MAX_IMAGE_FILE_BYTES,
  MAX_IMPORT_FILE_BYTES,
  validateImageUpload,
  validateImportFile,
} from "@/lib/security/upload";

afterEach(() => {
  resetRateLimitStore();
  vi.unstubAllEnvs();
});

describe("Security: src/lib/security/upload.ts", () => {
  it("blocks forbidden macro, executable, HTML, and SVG extensions", async () => {
    const payload = new TextEncoder().encode("payload");
    const forbidden = [
      "evil.docm",
      "evil.xlsm",
      "legacy.doc",
      "legacy.xls",
      "virus.exe",
      "xss.html",
      "xss.svg",
      "raw.zip",
      "script.js",
      "run.ps1",
    ];

    for (const fileName of forbidden) {
      const res = await validateImportFile(payload, fileName);
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.code).toBe("FORBIDDEN_EXTENSION");
        expect(res.status).toBe(415);
      }
    }
  });

  it("rejects unknown/missing extensions, empty files, and >15 MB payloads", async () => {
    const sample = new TextEncoder().encode("Câu 1: Test");

    const noExt = await validateImportFile(sample, "README");
    expect(noExt.valid).toBe(false);
    if (!noExt.valid) {
      expect(noExt.code).toBe("UNSUPPORTED_EXTENSION");
      expect(noExt.status).toBe(415);
    }

    const emptyRes = await validateImportFile(new Uint8Array(0), "empty.txt");
    expect(emptyRes.valid).toBe(false);
    if (!emptyRes.valid) {
      expect(emptyRes.code).toBe("EMPTY_FILE");
      expect(emptyRes.status).toBe(400);
    }

    const tooLarge = new Uint8Array(MAX_IMPORT_FILE_BYTES + 1);
    tooLarge.fill(0x41);
    const largeRes = await validateImportFile(tooLarge, "massive.txt");
    expect(largeRes.valid).toBe(false);
    if (!largeRes.valid) {
      expect(largeRes.code).toBe("FILE_TOO_LARGE");
      expect(largeRes.status).toBe(413);
    }
  });

  it("validates PK magic bytes and blocks corrupt archives, macros, ZIP Slip, entry bombs, and ratio bombs", async () => {
    // 1. Fake .docx magic bytes
    const fakeDocx = new TextEncoder().encode("plain text disguised as docx");
    const fakeRes = await validateImportFile(fakeDocx, "spoofed.docx");
    expect(fakeRes).toMatchObject({
      valid: false,
      code: "INVALID_MAGIC_BYTES",
      status: 400,
    });

    // 2. Valid PK header but corrupt ZIP body
    const corruptPk = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0xff, 0xee, 0xdd]);
    const corruptRes = await validateImportFile(corruptPk, "corrupt.xlsx");
    expect(corruptRes).toMatchObject({
      valid: false,
      code: "CORRUPT_ARCHIVE",
      status: 400,
    });

    // 3. Embedded vbaProject.bin macro inside .docx
    const macroZip = new JSZip();
    macroZip.file("word/document.xml", "<w:document/>");
    macroZip.file("word/vbaProject.bin", new Uint8Array([1, 2, 3]));
    const macroBuf = await macroZip.generateAsync({ type: "uint8array" });
    expect(await validateImportFile(macroBuf, "macro.docx")).toMatchObject({
      valid: false,
      code: "MACRO_OR_ENCRYPTED_ARCHIVE",
      status: 415,
    });

    // 4. Encrypted archive indicator
    const encZip = new JSZip();
    encZip.file("EncryptionInfo", new Uint8Array([1, 2, 3]));
    const encBuf = await encZip.generateAsync({ type: "uint8array" });
    expect(await validateImportFile(encBuf, "locked.xlsx")).toMatchObject({
      valid: false,
      code: "MACRO_OR_ENCRYPTED_ARCHIVE",
      status: 415,
    });

    // 5. ZIP Slip traversal
    const slipZip = new JSZip();
    slipZip.file("../../etc/passwd", "root:x:0:0");
    const slipBuf = await slipZip.generateAsync({ type: "uint8array" });
    expect(await validateImportFile(slipBuf, "slip.docx")).toMatchObject({
      valid: false,
      code: "ZIP_SLIP_DETECTED",
      status: 400,
    });

    // 6. ZIP entry count bomb (> 500 non-media entries)
    const entryBombZip = new JSZip();
    for (let i = 0; i < 505; i += 1) {
      entryBombZip.file(`word/f_${i}.xml`, "<a/>");
    }
    const entryBombBuf = await entryBombZip.generateAsync({ type: "uint8array" });
    expect(await validateImportFile(entryBombBuf, "entries.docx")).toMatchObject({
      valid: false,
      code: "ZIP_BOMB_ENTRIES",
      status: 400,
    });

    // 7. Compression ratio bomb (> 100:1 on entry >= 64 KB)
    const ratioBombZip = new JSZip();
    ratioBombZip.file("word/bomb.xml", "A".repeat(256 * 1024));
    const ratioBombBuf = await ratioBombZip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
      compressionOptions: { level: 9 },
    });
    expect(await validateImportFile(ratioBombBuf, "ratio.docx")).toMatchObject({
      valid: false,
      code: "ZIP_BOMB_RATIO",
      status: 400,
    });

    // 8. Clean OOXML zip passes
    const cleanZip = new JSZip();
    cleanZip.file("word/document.xml", "<w:document><w:body/></w:document>");
    const cleanBuf = await cleanZip.generateAsync({ type: "uint8array" });
    const cleanRes = await validateImportFile(cleanBuf, "dir/../clean exam.docx");
    expect(cleanRes).toMatchObject({
      valid: true,
      extension: ".docx",
      sanitizedFileName: "dir_._clean exam.docx",
    });
  });

  it("rejects binary NUL bytes and malformed UTF-8 in plain-text imports", async () => {
    const withNul = new Uint8Array([0x41, 0x00, 0x42]);
    expect(await validateImportFile(withNul, "data.csv")).toMatchObject({
      valid: false,
      code: "INVALID_UTF8",
      status: 400,
    });

    const badUtf8 = new Uint8Array([0xff, 0xfe, 0xfd]);
    expect(await validateImportFile(badUtf8, "broken.txt")).toMatchObject({
      valid: false,
      code: "INVALID_UTF8",
      status: 400,
    });

    const validVi = new TextEncoder().encode("Câu 1: Giải tích hàm nhiều biến\n*A. Đúng");
    expect(await validateImportFile(validVi, "giai-tich.txt")).toMatchObject({
      valid: true,
      extension: ".txt",
    });
  });

  it("enforces raster-only magic bytes, 5 MB cap, and strict SVG ban for image uploads", () => {
    // Valid PNG
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
    expect(validateImageUpload(png, "diagram.png", "image/png")).toMatchObject({
      valid: true,
      detectedMime: "image/png",
      extension: "png",
    });

    // Valid JPEG
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00]);
    expect(validateImageUpload(jpeg, "photo.jpg", "image/jpeg")).toMatchObject({
      valid: true,
      detectedMime: "image/jpeg",
      extension: "jpg",
    });

    // Valid WebP
    const webp = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ]);
    expect(validateImageUpload(webp, "card.webp", "image/webp")).toMatchObject({
      valid: true,
      detectedMime: "image/webp",
      extension: "webp",
    });

    // Valid GIF89a
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01]);
    expect(validateImageUpload(gif, "anim.gif", "image/gif")).toMatchObject({
      valid: true,
      detectedMime: "image/gif",
      extension: "gif",
    });

    // SVG rejected by extension OR MIME OR raw bytes disguised as .png
    const svgPayload = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>',
    );
    expect(validateImageUpload(svgPayload, "xss.svg", "image/svg+xml")).toMatchObject({
      valid: false,
      code: "SVG_FORBIDDEN",
      status: 415,
    });
    expect(validateImageUpload(png, "disguised.png", "image/svg+xml")).toMatchObject({
      valid: false,
      code: "SVG_FORBIDDEN",
      status: 415,
    });
    expect(validateImageUpload(svgPayload, "disguised.png", "image/png")).toMatchObject({
      valid: false,
      code: "UNSUPPORTED_IMAGE_FORMAT",
      status: 415,
    });

    // Oversized image > 5 MB rejected with 413
    const hugePng = new Uint8Array(MAX_IMAGE_FILE_BYTES + 1);
    hugePng.set(png);
    expect(validateImageUpload(hugePng, "huge.png", "image/png")).toMatchObject({
      valid: false,
      code: "FILE_TOO_LARGE",
      status: 413,
    });
  });
});

describe("Security: src/lib/security/sanitize.ts", () => {
  it("validates safe HTTP/Storage URLs and blocks XSS/protocol/traversal URLs", () => {
    expect(isSafeHttpOrStorageUrl(null)).toBe(true);
    expect(isSafeHttpOrStorageUrl(undefined)).toBe(true);
    expect(isSafeHttpOrStorageUrl("https://example.supabase.co/storage/v1/object/sign/a.png")).toBe(true);
    expect(isSafeHttpOrStorageUrl("/images/diagram.png")).toBe(true);
    expect(isSafeHttpOrStorageUrl("http://localhost:54321/storage/v1/object/test.png")).toBe(true);
    expect(
      isSafeHttpOrStorageUrl(
        "avatars/11111111-1111-4111-8111-111111111111/avatar.webp",
      ),
    ).toBe(true);

    // Unsafe URLs must be rejected
    expect(isSafeHttpOrStorageUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeHttpOrStorageUrl("  JaVaScRiPt:alert(document.cookie)")).toBe(false);
    expect(isSafeHttpOrStorageUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isSafeHttpOrStorageUrl("vbscript:msgbox(1)")).toBe(false);
    expect(isSafeHttpOrStorageUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeHttpOrStorageUrl("//evil.example/phish.png")).toBe(false);
    expect(isSafeHttpOrStorageUrl("/\\evil.example")).toBe(false);
    expect(isSafeHttpOrStorageUrl("/images/../../etc/passwd")).toBe(false);
    expect(isSafeHttpOrStorageUrl("http://insecure.example.com/img.png")).toBe(false);
    expect(isSafeHttpOrStorageUrl("https://example.com/\x00evil")).toBe(false);
    expect(isSafeHttpOrStorageUrl(`https://example.com/${"a".repeat(2100)}`)).toBe(false);
  });

  it("sanitizes filenames, strips control characters, and normalizes Vietnamese answers deterministically", () => {
    expect(sanitizeFilename("../../secret/../../file\x00name?.docx")).toBe(
      "._._secret_._._filename_.docx",
    );
    expect(sanitizeFilename("   ")).toBe("upload");
    expect(sanitizeText("  Line 1\r\nLine\x00 2\tOK  ")).toBe("Line 1\nLine 2\tOK");
    expect(sanitizeText("abcdef", 3)).toBe("abc");

    expect(stripDiacritics("Đại học Bách Khoa Hà Nội")).toBe("Dai hoc Bach Khoa Ha Noi");
    expect(normalizeAnswerText("  Hà Nội!  ", "ignore_diacritics")).toBe("ha noi");
    expect(normalizeAnswerText("  3,140 ", "numeric")).toBe("3.14");
    expect(normalizeAnswerText("Hello   World", "exact")).toBe("Hello World");
    expect(slugifyTag("Giải Tích 1 — Đề Cương!")).toBe("giai-tich-1-de-cuong");
  });
});

describe("Security: src/lib/security/authz.ts", () => {
  it("blocks open-redirect attacks via isSafeRelativeRedirect", () => {
    expect(isSafeRelativeRedirect("/dashboard")).toBe("/dashboard");
    expect(isSafeRelativeRedirect("/sets/abc-123/test?mode=timed")).toBe(
      "/sets/abc-123/test?mode=timed",
    );

    expect(isSafeRelativeRedirect(null)).toBe("/dashboard");
    expect(isSafeRelativeRedirect("")).toBe("/dashboard");
    expect(isSafeRelativeRedirect("https://evil.com")).toBe("/dashboard");
    expect(isSafeRelativeRedirect("http://evil.com/login")).toBe("/dashboard");
    expect(isSafeRelativeRedirect("//evil.com/phish")).toBe("/dashboard");
    expect(isSafeRelativeRedirect("/\\evil.com")).toBe("/dashboard");
    expect(isSafeRelativeRedirect("/dashboard\r\nSet-Cookie: a=b")).toBe("/dashboard");
    expect(isSafeRelativeRedirect("/redirect?to=https://evil.com")).toBe("/dashboard");
    expect(isSafeRelativeRedirect("javascript:alert(1)")).toBe("/dashboard");
  });

  it("requireAuth fails closed with 503 SUPABASE_NOT_CONFIGURED when env vars are absent", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

    await expect(requireAuth()).rejects.toMatchObject({
      code: "SUPABASE_NOT_CONFIGURED",
      status: 503,
    });
  });
});

describe("Security: src/lib/security/rate-limit.ts", () => {
  it("enforces deterministic sliding-window limits and recovers after window expiry", () => {
    const start = 1_700_000_000_000;
    const windowMs = 60_000;

    const r1 = checkRateLimit("test:actor", 2, windowMs, start);
    expect(r1.allowed).toBe(true);
    expect(r1.remaining).toBe(1);

    const r2 = checkRateLimit("test:actor", 2, windowMs, start + 1000);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(0);

    const r3 = checkRateLimit("test:actor", 2, windowMs, start + 2000);
    expect(r3.allowed).toBe(false);
    expect(r3.remaining).toBe(0);
    expect(r3.retryAfterSeconds).toBe(58);

    // After window elapses past first timestamp, request is allowed again
    const r4 = checkRateLimit("test:actor", 2, windowMs, start + windowMs + 1);
    expect(r4.allowed).toBe(true);
    expect(r4.remaining).toBe(0);
  });

  it("returns 429 JSON error envelope with Retry-After headers when limit exceeded", async () => {
    const req = new Request("http://localhost:3000/api/import/parse", {
      headers: { "x-forwarded-for": "203.0.113.42, 10.0.0.1" },
    });

    const ipId = getClientIdentifier(req);
    expect(ipId).toMatch(/^ip:[0-9a-f]{16}$/);
    expect(getClientIdentifier(req, "user-123")).toBe("user:user-123");

    const tinyConfig = { id: "unit_burst", limit: 1, windowMs: 30_000 };
    expect(enforceRateLimit(req, tinyConfig, "user-123")).toBeNull();

    const blocked = enforceRateLimit(req, tinyConfig, "user-123");
    expect(blocked).not.toBeNull();
    expect(blocked?.status).toBe(429);
    expect(Number(blocked?.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
    expect(blocked?.headers.get("X-RateLimit-Limit")).toBe("1");
    expect(blocked?.headers.get("X-RateLimit-Remaining")).toBe("0");

    const body = await blocked?.json();
    expect(body).toMatchObject({
      error: { code: "RATE_LIMITED" },
    });
    expect(RATE_LIMITS.IMPORT_PARSE.limit).toBe(15);
    expect(RATE_LIMITS.EXAM_START.limit).toBe(30);
  });
});

describe("Security: src/lib/security/errors.ts", () => {
  it("produces uniform JSON envelopes and never leaks raw PostgreSQL SQL details", async () => {
    const okRes = apiSuccess({ ok: true }, { total: 1 }, { status: 201 });
    expect(okRes.status).toBe(201);
    expect(await okRes.json()).toEqual({ data: { ok: true }, meta: { total: 1 } });

    const errRes = apiError("FORBIDDEN", "Denied", 403);
    expect(errRes.status).toBe(403);
    expect(await errRes.json()).toEqual({
      error: { code: "FORBIDDEN", message: "Denied" },
    });

    // ZodError -> 400 VALIDATION_ERROR
    const schema = z.object({ title: z.string().min(3) });
    let zodErr: unknown;
    try {
      schema.parse({ title: "a" });
    } catch (e) {
      zodErr = e;
    }
    const zodRes = handleApiError(zodErr);
    expect(zodRes.status).toBe(400);
    expect(await zodRes.json()).toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });

    // Postgres error must NOT leak raw table/column/SQL message
    const pgConflict = handleApiError({
      code: "23505",
      message: 'duplicate key value violates unique constraint "profiles_username_key" DETAIL: Key (username)=(secret)',
    });
    expect(pgConflict.status).toBe(409);
    const pgConflictBody = await pgConflict.json();
    expect(pgConflictBody.error.code).toBe("CONFLICT");
    expect(JSON.stringify(pgConflictBody)).not.toContain("profiles_username_key");

    const pgRls = handleApiError({ code: "42501", message: "new row violates RLS on study_sets" });
    expect(pgRls.status).toBe(403);
    expect(JSON.stringify(await pgRls.json())).not.toContain("study_sets");

    const unknownErr = handleApiError(new Error("SECRET_INTERNAL_STACK_DETAIL"));
    expect(unknownErr.status).toBe(500);
    expect(JSON.stringify(await unknownErr.json())).not.toContain("SECRET_INTERNAL_STACK_DETAIL");

    // AppError preserves code & status
    const appRes = handleApiError(new AppError("EXAM_EXPIRED", "Time is up.", 409));
    expect(appRes.status).toBe(409);

    // parseJsonBody throws AppError(400) on malformed JSON
    const badReq = new Request("http://localhost:3000/api/sets", {
      method: "POST",
      body: "{not valid json",
    });
    await expect(parseJsonBody(badReq)).rejects.toMatchObject({
      code: "BAD_REQUEST",
      status: 400,
    });
  });
});
