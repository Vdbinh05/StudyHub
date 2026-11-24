import { readFileSync } from "node:fs";
import path from "node:path";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { exportStudySet, sanitizeCsvCell } from "@/lib/export";
import { parseXlsxBuffer } from "@/lib/import/xlsx-parser";
import {
  ImportSecurityError,
  inspectAndLoadZip,
  readSafeZipEntryBytes,
} from "@/lib/import/zip-guard";
import { isSafeRelativeRedirect } from "@/lib/security/authz";
import { AppError, parseJsonBody } from "@/lib/security/errors";
import {
  isSafeHttpOrStorageUrl,
  isValidStudyMediaPath,
  normalizeAnswerText,
  sanitizePostgrestSearch,
} from "@/lib/security/sanitize";
import { stripPreSubmitQuestions } from "@/lib/supabase/exam-engine";
import type { ExamSnapshotQuestion, Question } from "@/types/domain";

const ROOT_DIR = process.cwd();
const sql0005 = readFileSync(
  path.join(ROOT_DIR, "supabase/migrations/0005_v2_custom_exams_and_coverage.sql"),
  "utf8",
);
const nextConfigSrc = readFileSync(path.join(ROOT_DIR, "next.config.ts"), "utf8");
const supabaseConfigToml = readFileSync(
  path.join(ROOT_DIR, "supabase/config.toml"),
  "utf8",
);
const loginFormSrc = readFileSync(
  path.join(ROOT_DIR, "src/components/auth/login-form.tsx"),
  "utf8",
);
const uploadImageRouteSrc = readFileSync(
  path.join(ROOT_DIR, "src/app/api/uploads/image/route.ts"),
  "utf8",
);
const examDetailRouteSrc = readFileSync(
  path.join(ROOT_DIR, "src/app/api/exams/[attemptId]/route.ts"),
  "utf8",
);

function stripSqlComments(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
}

function extractSqlFunctionBody(sql: string, fnName: string): string {
  const escaped = fnName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = sql.match(
    new RegExp(
      `CREATE OR REPLACE FUNCTION\\s+public\\.${escaped}\\s*\\([\\s\\S]*?\\$\\$;`,
      "i",
    ),
  );
  return match?.[0] ?? "";
}

/**
 * Overwrites declared uncompressedSize in a specific Central Directory entry (PK\x01\x02)
 * so header-only ZIP bomb checks see a tiny 100-byte entry while the actual
 * DEFLATE stream expands to >200 KB (simulating a forged-header ZIP bomb).
 */
function forgeCentralDirectoryUncompressedSize(
  raw: Uint8Array,
  targetEntryName: string,
  fakeSize: number,
): Uint8Array {
  const forged = new Uint8Array(raw);
  const view = new DataView(forged.buffer, forged.byteOffset, forged.byteLength);
  const decoder = new TextDecoder("utf-8");

  // Locate EOCD (PK\x05\x06) to find exact Central Directory range
  let eocdOffset = -1;
  for (let i = forged.byteLength - 22; i >= Math.max(0, forged.byteLength - 65557); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) return forged;

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  let cursor = view.getUint32(eocdOffset + 16, true);
  for (let i = 0; i < totalEntries && cursor + 46 <= forged.byteLength; i += 1) {
    if (view.getUint32(cursor, true) !== 0x02014b50) break;
    const nameLen = view.getUint16(cursor + 28, true);
    const extraLen = view.getUint16(cursor + 30, true);
    const commentLen = view.getUint16(cursor + 32, true);
    const name = decoder.decode(forged.subarray(cursor + 46, cursor + 46 + nameLen));
    if (name === targetEntryName) {
      view.setUint32(cursor + 24, fakeSize, true);
    }
    cursor += 46 + nameLen + extraLen + commentLen;
  }
  return forged;
}

describe("Security Regression: Migration 0005 RLS, Triggers, Grants & V2.0 RPCs", () => {
  const V2_TABLES = [
    "exam_presets",
    "exam_preset_sources",
    "exam_attempt_sources",
    "coverage_cycles",
    "coverage_cycle_questions",
    "coverage_cycle_attempts",
  ] as const;

  it("enables RLS on all 6 V2.0 tables and wraps every auth.uid() in (SELECT auth.uid())", () => {
    for (const table of V2_TABLES) {
      expect(sql0005, `Missing CREATE TABLE public.${table}`).toMatch(
        new RegExp(`CREATE TABLE(?: IF NOT EXISTS)? public\\.${table}\\b`, "i"),
      );
      expect(sql0005, `Missing ENABLE ROW LEVEL SECURITY on public.${table}`).toMatch(
        new RegExp(`ALTER TABLE public\\.${table}\\s+ENABLE ROW LEVEL SECURITY;`, "i"),
      );
    }

    const executableSql = stripSqlComments(sql0005);
    expect(executableSql).not.toMatch(/\bauth\.role\s*\(\s*\)/i);

    const wrapped = executableSql.match(/\(\s*SELECT\s+auth\.uid\s*\(\s*\)\s*\)/gi) ?? [];
    const total = executableSql.match(/\bauth\.uid\s*\(\s*\)/gi) ?? [];
    expect(total.length).toBeGreaterThan(25);
    expect(wrapped.length).toBe(total.length);
  });

  it("enforces SET search_path = '' on every SECURITY DEFINER function in 0005", () => {
    const fnBlocks = sql0005.split(/CREATE OR REPLACE FUNCTION\s+/i).slice(1);
    const secDefBlocks = fnBlocks.filter((block) =>
      /\bSECURITY DEFINER\b/i.test(block.split(/AS \$\$/i)[0] ?? ""),
    );

    expect(secDefBlocks.length).toBeGreaterThanOrEqual(15);
    for (const block of secDefBlocks) {
      const header = block.split(/AS \$\$/i)[0] ?? "";
      const fnName = header.match(/^([^\s(]+)/)?.[1] ?? "unknown";
      expect(header, `${fnName} missing SET search_path = ''`).toMatch(
        /SET\s+search_path\s*=\s*''/i,
      );
    }
  });

  it("SEC-001: guards study_sets against editor-to-owner hijack and direct question_count tampering", () => {
    const guardFn = extractSqlFunctionBody(sql0005, "guard_study_set_owner_fields");
    expect(guardFn).toContain("NEW.owner_id IS DISTINCT FROM OLD.owner_id");
    expect(guardFn).toContain("NEW.question_count IS DISTINCT FROM OLD.question_count");
    expect(guardFn).toContain("NEW.visibility IS DISTINCT FROM OLD.visibility");
    expect(guardFn).toContain("NEW.folder_id IS DISTINCT FROM OLD.folder_id");
    expect(guardFn).toContain("NEW.is_archived IS DISTINCT FROM OLD.is_archived");
    expect(guardFn).toContain("NEW.is_favorite IS DISTINCT FROM OLD.is_favorite");
    expect(sql0005).toMatch(
      /CREATE TRIGGER trg_guard_study_set_owner_fields[\s\S]*?BEFORE UPDATE ON public\.study_sets/i,
    );
  });

  it("SEC-002 & SEC-006: enforces friendships state machine, blocked_by attribution, and block deletion lock", () => {
    expect(sql0005).toMatch(/ADD COLUMN IF NOT EXISTS blocked_by uuid/i);
    const fn = extractSqlFunctionBody(sql0005, "guard_friendships_update");
    expect(fn).toContain("NEW.requester_id IS DISTINCT FROM OLD.requester_id");
    expect(fn).toContain("NEW.addressee_id IS DISTINCT FROM OLD.addressee_id");
    expect(fn).toMatch(/OLD\.status = 'blocked'/);
    expect(fn).toMatch(/OLD\.blocked_by IS DISTINCT FROM v_caller/);
    expect(fn).toMatch(/NEW\.status IN \('accepted',\s*'declined'\)/);
    expect(sql0005).toMatch(
      /CREATE TRIGGER trg_guard_friendships_update[\s\S]*?BEFORE UPDATE ON public\.friendships/i,
    );
    expect(sql0005).toMatch(
      /CREATE POLICY "friendships_delete_participant"[\s\S]*?status = 'blocked' AND blocked_by = \(SELECT auth\.uid\(\)\)/i,
    );
  });

  it("SEC-003: enforces composite cross-set foreign keys on all 6 child tables + exam_attempt_answers", () => {
    const childConstraints = [
      "question_options_set_q_composite_fkey",
      "question_accepted_answers_set_q_composite_fkey",
      "question_tags_set_q_composite_fkey",
      "user_question_progress_set_q_composite_fkey",
      "starred_questions_set_q_composite_fkey",
      "study_session_answers_set_q_composite_fkey",
      "exam_attempt_answers_attempt_q_composite_fkey",
    ];
    for (const cname of childConstraints) {
      expect(sql0005, `Missing composite FK constraint ${cname}`).toContain(cname);
    }
  });

  it("SEC-004: revokes V1 create_exam_attempt from client roles and hardens create_exam_attempt_v2", () => {
    expect(sql0005).toMatch(
      /REVOKE ALL ON FUNCTION public\.create_exam_attempt\s*\([\s\S]*?\)\s*FROM PUBLIC,\s*anon,\s*authenticated;/i,
    );

    const v2Fn = extractSqlFunctionBody(sql0005, "create_exam_attempt_v2");
    expect(v2Fn).toMatch(/count\s*\(\s*DISTINCT\s+q\.id\s*\)/i);
    expect(v2Fn).toMatch(/public\.can_read_study_set\s*\(\s*q\.study_set_id\s*,\s*v_caller\s*\)/i);
    // Must authorize p_sources study_set_id / folder_id before inserting into exam_attempt_sources
    expect(v2Fn).toMatch(/can_read_study_set\s*\([\s\S]*?study_set_id/i);
    expect(v2Fn).toMatch(/FROM public\.folders[\s\S]*?owner_id\s*=\s*v_caller/i);
  });

  it("SEC-005 & SEC-007: revokes profiles.email direct SELECT and removes 'unlisted' blanket readability", () => {
    expect(sql0005).toMatch(/REVOKE SELECT ON public\.profiles FROM anon,\s*authenticated;/i);
    const grantProfiles = sql0005.match(
      /GRANT SELECT\s*\(([\s\S]*?)\)\s*ON public\.profiles TO authenticated;/i,
    );
    expect(grantProfiles).not.toBeNull();
    expect(grantProfiles?.[1] ?? "").not.toMatch(/\bemail\b/i);
    expect(sql0005).toMatch(/CREATE OR REPLACE FUNCTION public\.get_my_profile\(\)/i);

    const canReadFn = stripSqlComments(
      extractSqlFunctionBody(sql0005, "can_read_study_set"),
    );
    expect(canReadFn).toContain("s.visibility = 'public'");
    expect(canReadFn).not.toContain("'unlisted'");

    const anonPolicy = sql0005.match(
      /CREATE POLICY "study_sets_select_public_anon"[\s\S]*?;/i,
    )?.[0] ?? "";
    expect(anonPolicy).toContain("visibility = 'public'");
    expect(anonPolicy).not.toContain("'unlisted'");
  });

  it("SEC-009 & SEC-016: resolves JWT role from BOTH request.jwt.claim.role and request.jwt.claims JSON (fail-closed on PG 15 / PostgREST 10+)", () => {
    const roleFn = extractSqlFunctionBody(sql0005, "current_jwt_role");
    expect(roleFn).toContain("request.jwt.claim.role");
    expect(roleFn).toContain("request.jwt.claims");
    expect(roleFn).toContain("authenticator");

    for (const helperName of [
      "is_study_set_owner",
      "can_read_study_set",
      "can_edit_study_set",
      "can_view_profile",
    ]) {
      const fn = extractSqlFunctionBody(sql0005, helperName);
      expect(fn, `${helperName} must use public.current_jwt_role()`).toContain(
        "public.current_jwt_role()",
      );
      expect(fn, `${helperName} must not rely solely on legacy request.jwt.claim.role`).not.toContain(
        "current_setting('request.jwt.claim.role'",
      );
    }

    const submitFn = extractSqlFunctionBody(sql0005, "submit_exam_attempt");
    expect(submitFn).toContain("public.current_jwt_role()");
    expect(submitFn).not.toContain("current_setting('request.jwt.claim.role'");
    expect(submitFn).toMatch(/v_jwt_role IS DISTINCT FROM 'service_role'/i);
  });

  it("SEC-011, SEC-012 & SEC-013: enforces Storage RLS, allow_clone persistence, profile email lock, and strict ^/[^/\\\\] URL checks", () => {
    expect(sql0005).toMatch(/CREATE OR REPLACE FUNCTION public\.can_access_study_media_path/i);
    expect(sql0005).toMatch(/ADD COLUMN IF NOT EXISTS allow_clone boolean NOT NULL DEFAULT true/i);

    const cloneFn = extractSqlFunctionBody(sql0005, "clone_study_set");
    expect(cloneFn).toContain("allow_clone");

    const profGuard = extractSqlFunctionBody(sql0005, "guard_profiles_update");
    expect(profGuard).toContain("NEW.email IS DISTINCT FROM OLD.email");

    // All 4 URL CHECK constraints must forbid protocol-relative `//` and `/\`
    const urlCheckMatches = sql0005.match(
      /_url_safe_chk[\s\S]*?~\* '([^']+)'/g,
    ) ?? [];
    expect(urlCheckMatches.length).toBe(4);
    for (const chk of urlCheckMatches) {
      expect(chk, `Loose ^/ regex in ${chk}`).not.toContain("(https://|/|");
      expect(chk, `Expected ^/[^/\\\\] guard in ${chk}`).toContain("/[^/\\\\]|");
    }
  });

  it("enforces multi-subject study_sessions INSERT and UPDATE RLS against unreadable source_study_set_ids", () => {
    const insertPolicy = sql0005.match(
      /CREATE POLICY "study_sessions_insert_own"[\s\S]*?;/i,
    )?.[0] ?? "";
    const updatePolicy = sql0005.match(
      /CREATE POLICY "study_sessions_update_own"[\s\S]*?;/i,
    )?.[0] ?? "";
    expect(insertPolicy).toContain("source_study_set_ids");
    expect(insertPolicy).toContain("can_read_study_set");
    expect(updatePolicy).toContain("WITH CHECK");
    expect(updatePolicy).toContain("source_study_set_ids");
    expect(updatePolicy).toContain("can_read_study_set");
  });

  it("preserves numeric 0, 10, 100 in PostgreSQL normalize_short_answer and TypeScript normalizeAnswerText", () => {
    const sqlNorm = extractSqlFunctionBody(sql0005, "normalize_short_answer");
    expect(sqlNorm).toContain("trim_scale(v_num)");
    expect(sqlNorm).toMatch(/IF v_num = 0 THEN\s*RETURN '0';/i);
    expect(sqlNorm).not.toMatch(/rtrim\s*\([^)]*'0'\s*\)/i);

    expect(normalizeAnswerText("0", "numeric")).toBe("0");
    expect(normalizeAnswerText("-0", "numeric")).toBe("0");
    expect(normalizeAnswerText("0.00", "numeric")).toBe("0");
    expect(normalizeAnswerText("10", "numeric")).toBe("10");
    expect(normalizeAnswerText("100", "numeric")).toBe("100");
    expect(normalizeAnswerText("100.00", "numeric")).toBe("100");
    expect(normalizeAnswerText("1,50", "numeric")).toBe("1.5");
    expect(normalizeAnswerText("-10", "numeric")).toBe("-10");
    expect(normalizeAnswerText("-273.150", "numeric")).toBe("-273.15");
  });
});

describe("Security Regression: CSV Formula Injection Neutralization (SEC-017)", () => {
  it("neutralizes =, +, -, @, tab, CR formula triggers while preserving pure negative numbers", async () => {
    const dangerousCells = [
      "=CMD|' /C calc'!A0",
      "+1+1",
      "-cmd|' /C calc'!A0",
      "@SUM(A1:A10)",
      "\t=HYPERLINK(\"https://evil.example\")",
      "\r=1+1",
    ];
    for (const cell of dangerousCells) {
      expect(sanitizeCsvCell(cell)).toBe(`'${cell}`);
    }

    // Pure negative numbers must remain uncorrupted
    expect(sanitizeCsvCell("-1")).toBe("-1");
    expect(sanitizeCsvCell("-42")).toBe("-42");
    expect(sanitizeCsvCell("-273.15")).toBe("-273.15");
    expect(sanitizeCsvCell("Normal text")).toBe("Normal text");

    const sampleQuestion: Question = {
      id: "11111111-1111-4111-8111-111111111111",
      study_set_id: "22222222-2222-4222-8222-222222222222",
      question_type: "single_choice",
      position: 0,
      chapter: "=IMPORTXML(\"https://evil.example\",\"//a\")",
      prompt: "@SUM(1+1)*cmd",
      prompt_image_url: null,
      back_text: null,
      back_image_url: null,
      explanation: "+2+3",
      hint: "-273.15",
      difficulty: "medium",
      source_metadata: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      options: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          question_id: "11111111-1111-4111-8111-111111111111",
          study_set_id: "22222222-2222-4222-8222-222222222222",
          position: 0,
          label: "A",
          content: "=HYPERLINK(\"https://evil.example\",\"click\")",
          image_url: null,
          is_correct: true,
          created_at: new Date().toISOString(),
        },
        {
          id: "44444444-4444-4444-8444-444444444444",
          question_id: "11111111-1111-4111-8111-111111111111",
          study_set_id: "22222222-2222-4222-8222-222222222222",
          position: 1,
          label: "B",
          content: "-10",
          image_url: null,
          is_correct: false,
          created_at: new Date().toISOString(),
        },
      ],
      accepted_answers: [],
      tags: [],
    };

    const exported = await exportStudySet(
      {
        id: "22222222-2222-4222-8222-222222222222",
        title: "Formula Safety Test",
        description: null,
        subject: null,
        set_type: "multiple_choice",
      },
      [sampleQuestion],
      { format: "csv" },
    );

    const csvText = new TextDecoder().decode(exported.content);
    expect(csvText).toContain("'=IMPORTXML");
    expect(csvText).toContain("'@SUM(1+1)*cmd");
    expect(csvText).toContain("'=HYPERLINK");
    expect(csvText).toContain("'+2+3");
    // Pure negative numbers remain unquoted with apostrophe
    expect(csvText).toContain(",-10,");
    expect(csvText).toContain(",-273.15,");
  });
});

describe("Security Regression: Forged ZIP Bomb & XLSX XXE Guards (SEC-010)", () => {
  it("blocks a forged-header ZIP decompression ratio bomb during streaming read", async () => {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
    );
    zip.file(
      "xl/workbook.xml",
      '<?xml version="1.0" encoding="UTF-8"?><workbook></workbook>',
    );
    // 250 KB of repeated 'A' compresses to <350 bytes (>700:1 actual ratio)
    zip.file("xl/sharedStrings.xml", "A".repeat(250_000));

    const compressed = await zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
      compressionOptions: { level: 9 },
    });

    // Forge Central Directory uncompressedSize for xl/sharedStrings.xml to claim only 100 bytes!
    const forgedBomb = forgeCentralDirectoryUncompressedSize(
      compressed,
      "xl/sharedStrings.xml",
      100,
    );

    await expect(inspectAndLoadZip(forgedBomb, "xlsx")).rejects.toMatchObject({
      name: "ImportSecurityError",
      code: "ZIP_RATIO_BOMB_DETECTED",
    });

    // Also verify readSafeZipEntryBytes directly enforces cumulative byte budget
    const loaded = await JSZip.loadAsync(compressed);
    const hugeEntry = loaded.file("xl/sharedStrings.xml")!;
    const tinyBudget = { remainingBytes: 1024 };
    await expect(
      readSafeZipEntryBytes(hugeEntry, tinyBudget, {
        compressedSize: 300,
        entryName: "xl/sharedStrings.xml",
      }),
    ).rejects.toBeInstanceOf(ImportSecurityError);
  });

  it("blocks XXE DOCTYPE/ENTITY inside XLSX XML parts BEFORE ExcelJS loads the workbook", async () => {
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>',
    );
    zip.file(
      "xl/workbook.xml",
      '<?xml version="1.0" encoding="UTF-8"?><workbook></workbook>',
    );
    zip.file(
      "xl/sharedStrings.xml",
      '<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><sst><si><t>&xxe;</t></si></sst>',
    );

    const bytes = await zip.generateAsync({ type: "uint8array" });

    await expect(parseXlsxBuffer(bytes)).rejects.toMatchObject({
      name: "ImportSecurityError",
      code: "XXE_FORBIDDEN",
    });
  });
});

describe("Security Regression: CSP/HSTS, Redirects, Sanitization & Route Defense-in-Depth", () => {
  it("SEC-022: gates localhost/unsafe-eval CSP to dev and enables HSTS in production", () => {
    expect(nextConfigSrc).toContain("Strict-Transport-Security");
    expect(nextConfigSrc).toContain("max-age=63072000");
    // Ensure localhost/ws/unsafe-eval are conditional on isDev
    expect(nextConfigSrc).toMatch(/isDev\s*\?\s*"[^"]*unsafe-eval[^"]*"\s*:\s*""/);
    expect(nextConfigSrc).toMatch(/isDev\s*\?\s*"[^"]*127\.0\.0\.1[^"]*"\s*:\s*""/);
    // SEC-020: secure_password_change enabled in supabase/config.toml
    expect(supabaseConfigToml).toMatch(/secure_password_change\s*=\s*true/);
  });

  it("SEC-015: blocks //, /\\, \\, absolute URLs, and control characters in redirect sanitizers", () => {
    const badRedirects = [
      "//evil.com",
      "/\\evil.com",
      "/\\\\evil.com",
      "\\evil.com",
      "https://evil.com/dashboard",
      "javascript:alert(1)",
      "/dashboard\r\nSet-Cookie: a=b",
      "/dashboard\x00evil",
    ];
    for (const candidate of badRedirects) {
      expect(isSafeRelativeRedirect(candidate, "/dashboard")).toBe("/dashboard");
    }
    expect(isSafeRelativeRedirect("/exams/new?preset=1", "/dashboard")).toBe(
      "/exams/new?preset=1",
    );

    // Login form client sanitizer must also explicitly block /\ and \
    expect(loginFormSrc).toContain('!trimmed.startsWith("//")');
    expect(loginFormSrc).toContain('!trimmed.startsWith("/\\\\")');
    expect(loginFormSrc).toContain('!trimmed.includes("\\\\")');
  });

  it("SEC-018 & SEC-021: strips PostgREST filter operators and enforces streaming JSON body caps (413)", async () => {
    expect(sanitizePostgrestSearch('foo,id.eq.1,prompt.ilike.*%_"\\()')).toBe(
      "foo id eq 1 prompt ilike",
    );
    expect(isSafeHttpOrStorageUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeHttpOrStorageUrl("//evil.com/a.png")).toBe(false);
    expect(isSafeHttpOrStorageUrl("/\\evil.com/a.png")).toBe(false);
    expect(isSafeHttpOrStorageUrl("/api/uploads/signed-url?path=avatars%2F1&redirect=1")).toBe(
      true,
    );
    expect(isValidStudyMediaPath("avatars/../../../etc/passwd")).toBe(false);
    expect(
      isValidStudyMediaPath(
        "avatars/11111111-1111-4111-8111-111111111111/photo.png",
      ),
    ).toBe(true);

    // Streaming 413 check (even without Content-Length header!)
    const bigPayload = JSON.stringify({ data: "x".repeat(2048) });
    const req = new Request("http://localhost/api/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: bigPayload,
    });
    await expect(parseJsonBody(req, 512)).rejects.toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
      status: 413,
    } satisfies Partial<AppError>);
  });

  it("enforces pre-submit exam stripping, discarded exam guard, and pre-buffer image size cap", () => {
    const rawQ = {
      id: "q1",
      attempt_id: "a1",
      question_id: "orig1",
      position: 0,
      question_type: "single_choice" as const,
      source_study_set_id: "s1",
      source_subject_title: "Math",
      chapter_snapshot: "Ch1",
      tags_snapshot: [],
      prompt_snapshot: "2+2?",
      prompt_image_url_snapshot: null,
      options_snapshot: [
        { id: "o1", label: "A", content: "4", image_url: null, position: 0, is_correct: true },
      ],
      correct_option_ids: ["o1"],
      accepted_answers_snapshot: [{ answer_text: "4", normalized_answer: "4", match_mode: "exact" as const }],
      explanation_snapshot: "Secret explanation",
      created_at: new Date().toISOString(),
    } as unknown as ExamSnapshotQuestion;

    const stripped = stripPreSubmitQuestions([rawQ]);
    expect(stripped).toHaveLength(1);
    expect("correct_option_ids" in stripped[0]).toBe(false);
    expect("accepted_answers_snapshot" in stripped[0]).toBe(false);
    expect("explanation_snapshot" in stripped[0]).toBe(false);
    expect("is_correct" in stripped[0].options_snapshot[0]).toBe(false);

    // Pre-buffer size guard before arrayBuffer() in /api/uploads/image
    const sizeCheckPos = uploadImageRouteSrc.indexOf("fileEntry.size > MAX_IMAGE_FILE_BYTES");
    const arrayBufferPos = uploadImageRouteSrc.indexOf("fileEntry.arrayBuffer()");
    expect(sizeCheckPos).toBeGreaterThan(-1);
    expect(arrayBufferPos).toBeGreaterThan(-1);
    expect(sizeCheckPos).toBeLessThan(arrayBufferPos);

    // Defense-in-depth: discarded attempts also pass through stripPreSubmitQuestions()
    expect(examDetailRouteSrc).toMatch(
      /detail\.attempt\.status === "in_progress"\s*\|\|\s*detail\.attempt\.status === "discarded"/,
    );
  });
});
