// @vitest-environment node
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ImportSecurityError, parsePdfBuffer } from "@/lib/import";
import { renderSafeKatexHtml } from "@/lib/richtext/katex";
import { sanitizeRichTextDoc } from "@/lib/security/sanitize";
import { validateAudioUpload } from "@/lib/security/upload";

interface LiveSupabaseConfig {
  url: string;
  publishableKey: string;
  secretKey: string;
}

const PLACEHOLDER_MARKERS = [
  "your-project-ref.supabase.co",
  "your-supabase-",
  "your-publishable-key",
  "your-anon-key",
  "your-secret-key",
  "your-service-role-key",
  "placeholder",
];

function parseDotEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {};
  const out: Record<string, string> = {};
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx <= 0) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function isPlaceholder(val: string): boolean {
  const lower = val.toLowerCase();
  return !val || PLACEHOLDER_MARKERS.some((m) => lower.includes(m));
}

function loadLiveSupabaseConfig(): LiveSupabaseConfig | null {
  const fileEnv = parseDotEnvFile(path.resolve(process.cwd(), ".env.local"));
  const getVar = (name: string): string =>
    (process.env[name]?.trim() || fileEnv[name]?.trim() || "").trim();

  const url = getVar("NEXT_PUBLIC_SUPABASE_URL");
  const publishableKey =
    getVar("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY") ||
    getVar("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const secretKey =
    getVar("SUPABASE_SECRET_KEY") || getVar("SUPABASE_SERVICE_ROLE_KEY");

  if (
    isPlaceholder(url) ||
    isPlaceholder(publishableKey) ||
    isPlaceholder(secretKey)
  ) {
    return null;
  }
  return { url, publishableKey, secretKey };
}

const LIVE_CONFIG = loadLiveSupabaseConfig();
const LIVE_API_BASE_URL = (process.env.LIVE_API_BASE_URL ?? "")
  .trim()
  .replace(/\/+$/, "");

async function mintSsrCookieHeader(
  cfg: LiveSupabaseConfig,
  email: string,
  password: string,
): Promise<string> {
  const jar = new Map<string, string>();
  const ssrClient = createServerClient(cfg.url, cfg.publishableKey, {
    cookies: {
      getAll() {
        return Array.from(jar.entries()).map(([name, value]) => ({
          name,
          value,
        }));
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          if (!value) jar.delete(name);
          else jar.set(name, value);
        }
      },
    },
  });

  const { error } = await ssrClient.auth.signInWithPassword({
    email,
    password,
  });
  if (error) {
    throw new Error(`SSR cookie sign-in failed: ${error.message}`);
  }
  return Array.from(jar.entries())
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

// Minimal valid 1x1 transparent PNG (67 bytes)
const VALID_PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

// Minimal valid 48-byte PCM WAV (RIFF....WAVE)
function createMinimalWavBytes(): Buffer {
  const buf = Buffer.alloc(48);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(40, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16); // PCM chunk size
  buf.writeUInt16LE(1, 20); // PCM format
  buf.writeUInt16LE(1, 22); // mono
  buf.writeUInt32LE(8000, 24); // sample rate
  buf.writeUInt32LE(8000, 28); // byte rate
  buf.writeUInt16LE(1, 32); // block align
  buf.writeUInt16LE(8, 34); // bits per sample
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(4, 40);
  buf.writeUInt32LE(0x80808080, 44);
  return buf;
}

// Minimal valid MP3 with ID3v2 header + MPEG1 Layer3 frame sync
function createMinimalMp3Bytes(): Buffer {
  const header = Buffer.from([
    0x49, 0x44, 0x33, // "ID3"
    0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, // ID3v2.3 size 0
    0xff, 0xfb, 0x90, 0x00, // MPEG1 Layer3 sync
  ]);
  return Buffer.concat([header, Buffer.alloc(64, 0x00)]);
}

const VALID_WAV_BYTES = createMinimalWavBytes();
const VALID_MP3_BYTES = createMinimalMp3Bytes();
const EVIL_SVG_BYTES = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
  "utf8",
);
const EVIL_HTML_BYTES = Buffer.from(
  '<!DOCTYPE html><html><body><script>alert("xss")</script></body></html>',
  "utf8",
);

async function apiFetch(
  pathname: string,
  init: RequestInit = {},
  cookieHeader?: string,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (cookieHeader) {
    headers.set("Cookie", cookieHeader);
  }
  return fetch(`${LIVE_API_BASE_URL}${pathname}`, {
    ...init,
    headers,
    redirect: "manual",
  });
}

// Pure deterministic security checks that run even without live DB credentials
describe("V3.0 Static & Deterministic Security Controls (XSS, KaTeX, PDF Parser)", () => {
  it("strips XSS vectors, unsafe protocols, SVG data URLs, and deep/oversized ASTs in sanitizeRichTextDoc", () => {
    const maliciousDoc = {
      type: "doc",
      content: [
        { type: "script", content: [{ type: "text", text: "alert(1)" }] },
        { type: "iframe", attrs: { src: "https://evil.example" } },
        {
          type: "paragraph",
          attrs: { onclick: "alert(1)", style: "background:url(javascript:alert(1))" },
          content: [
            {
              type: "text",
              text: "Click me",
              marks: [
                { type: "link", attrs: { href: "javascript:alert(1)" } },
                { type: "link", attrs: { href: "data:text/html,<script>alert(1)</script>" } },
                { type: "link", attrs: { href: "vbscript:msgbox(1)" } },
                { type: "bold" },
                { type: "rawHtml" },
              ],
            },
            {
              type: "text",
              text: "Safe link",
              marks: [{ type: "link", attrs: { href: "https://studyhub.example/docs" } }],
            },
          ],
        },
        {
          type: "image",
          attrs: {
            src: "data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+PC9zdmc+",
            onerror: "alert(1)",
          },
        },
        {
          type: "image",
          attrs: {
            src: "javascript:alert(1)",
            alt: "bad",
          },
        },
      ],
    };

    const sanitized = sanitizeRichTextDoc(maliciousDoc);
    expect(sanitized).not.toBeNull();
    const serialized = JSON.stringify(sanitized);

    expect(serialized).not.toContain("javascript:");
    expect(serialized).not.toContain("data:text/html");
    expect(serialized).not.toContain("data:image/svg+xml");
    expect(serialized).not.toContain("vbscript:");
    expect(serialized).not.toContain('"type":"script"');
    expect(serialized).not.toContain('"type":"iframe"');
    expect(serialized).not.toContain('"type":"rawHtml"');
    expect(serialized).not.toContain("onclick");
    expect(serialized).not.toContain("onerror");
    expect(serialized).toContain("https://studyhub.example/docs");
    expect(serialized).toContain('"rel":"noopener noreferrer nofollow"');

    // Verify depth cap (> 12 nested blockquotes truncated safely)
    let nested: Record<string, unknown> = {
      type: "paragraph",
      content: [{ type: "text", text: "too deep" }],
    };
    for (let i = 0; i < 20; i += 1) {
      nested = { type: "blockquote", content: [nested] };
    }
    const deepClean = sanitizeRichTextDoc({ type: "doc", content: [nested] });
    expect(deepClean).not.toBeNull();
    expect(JSON.stringify(deepClean)).not.toContain("too deep");
  });

  it("enforces KaTeX trust: false blocking \\href, \\htmlClass, \\htmlStyle, and raw script injection", () => {
    const valid = renderSafeKatexHtml("\\frac{1}{2} + E = mc^2", false);
    expect(valid.error).toBeUndefined();
    expect(valid.html).toContain('class="katex"');

    const payloads = [
      "\\href{javascript:alert(1)}{click}",
      "\\url{javascript:alert(1)}",
      "\\htmlClass{evil}{x}",
      "\\htmlStyle{background:url(javascript:alert(1))}{x}",
      "\\htmlData{x=1}{y}",
      "<script>alert(1)</script>",
    ];

    for (const payload of payloads) {
      const rendered = renderSafeKatexHtml(payload, false);
      expect(rendered.html.toLowerCase()).not.toContain("<script");
      expect(rendered.html.toLowerCase()).not.toContain("javascript:");
      expect(rendered.html.toLowerCase()).not.toContain("onerror=");
      expect(rendered.html.toLowerCase()).not.toContain("onload=");
      expect(rendered.html.toLowerCase()).not.toContain('href="javascript:');
      expect(rendered.html).not.toContain('class="evil"');
    }
  });

  it("safely rejects non-PDF, corrupted PDF, >15 MB PDF, handles /JS script PDF without executing JS, and disables pdfjs eval", async () => {
    // 1. Source guard: pdf-parser.ts must explicitly disable eval (`isEvalSupported: false`)
    const pdfParserSrc = readFileSync(
      path.resolve(process.cwd(), "src/lib/import/pdf-parser.ts"),
      "utf8",
    );
    expect(pdfParserSrc).toMatch(/isEvalSupported\s*:\s*false/);
    expect(pdfParserSrc).toMatch(/useSystemFonts\s*:\s*false/);

    // 2. Reject HTML disguised as PDF
    await expect(
      parsePdfBuffer(new Uint8Array(EVIL_HTML_BYTES)),
    ).rejects.toThrow(ImportSecurityError);

    // 3. Reject malformed PDF header/body safely
    const corruptPdf = Buffer.from("%PDF-1.7\n1 0 obj\n<< /Broken >>\n%%EOF", "utf8");
    await expect(parsePdfBuffer(new Uint8Array(corruptPdf))).rejects.toThrow(
      ImportSecurityError,
    );

    // 4. Reject > 15 MB PDF before touching pdfjs
    const oversized = new Uint8Array(15 * 1024 * 1024 + 64);
    oversized.set(Buffer.from("%PDF-1.7\n", "ascii"), 0);
    await expect(parsePdfBuffer(oversized)).rejects.toThrow(ImportSecurityError);

    // 5. Minimal PDF containing malicious /OpenAction /JS must never execute script
    const jsPdf = Buffer.from(
      [
        "%PDF-1.4",
        "1 0 obj << /Type /Catalog /Pages 2 0 R /OpenAction << /S /JavaScript /JS (globalThis.__PWNED__ = true) >> >> endobj",
        "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
        "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >> endobj",
        "xref",
        "0 4",
        "0000000000 65535 f ",
        "0000000009 00000 n ",
        "0000000126 00000 n ",
        "0000000183 00000 n ",
        "trailer << /Size 4 /Root 1 0 R >>",
        "startxref",
        "253",
        "%%EOF",
      ].join("\n"),
      "utf8",
    );
    try {
      const parsed = await parsePdfBuffer(new Uint8Array(jsPdf));
      expect(parsed.isScannedPdf).toBe(true);
      expect(parsed.questions).toHaveLength(0);
    } catch (err) {
      expect(err).toBeInstanceOf(ImportSecurityError);
    }
    expect((globalThis as Record<string, unknown>).__PWNED__).toBeUndefined();
  });
});

const runLive = LIVE_CONFIG ? describe : describe.skip;

runLive(
  "Live Supabase Cloud V3.0 Security, 3-Account RLS, Storage, Exam Anti-Leak & Export Audit",
  () => {
    let admin: SupabaseClient;
    let anonClient: SupabaseClient;
    let clientA: SupabaseClient;
    let clientB: SupabaseClient;
    let clientC: SupabaseClient;

    let userAId = "";
    let userBId = "";
    let userCId = "";
    let cookieA = "";
    let cookieB = "";
    let cookieC = "";

    let setASharedViewerId = ""; // Shared A -> B (viewer, allow_clone = false)
    let setAEditorSharedId = ""; // Shared A -> B (editor)
    let setARevocableId = ""; // Shared A -> B (viewer), later revoked during sync test
    let setAPrivateId = ""; // Strictly private to A
    let setBId = ""; // Strictly private to B

    let qASharedViewerId = "";
    let qARevocableId = "";
    let qAPrivateBaseId = "";
    let qAEditorSharedId = "";

    const trackedStoragePaths = new Set<string>();
    const trackedUserIds: string[] = [];

    beforeAll(async () => {
      if (!LIVE_CONFIG) return;

      const clientOpts = {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },
      };

      admin = createClient(LIVE_CONFIG.url, LIVE_CONFIG.secretKey, clientOpts);
      anonClient = createClient(
        LIVE_CONFIG.url,
        LIVE_CONFIG.publishableKey,
        clientOpts,
      );
      clientA = createClient(
        LIVE_CONFIG.url,
        LIVE_CONFIG.publishableKey,
        clientOpts,
      );
      clientB = createClient(
        LIVE_CONFIG.url,
        LIVE_CONFIG.publishableKey,
        clientOpts,
      );
      clientC = createClient(
        LIVE_CONFIG.url,
        LIVE_CONFIG.publishableKey,
        clientOpts,
      );

      const ts = `${Date.now()}-${randomBytes(3).toString("hex")}`;
      const emailA = `v3-sec-a-${ts}@studyhub-test.local`;
      const emailB = `v3-sec-b-${ts}@studyhub-test.local`;
      const emailC = `v3-sec-c-${ts}@studyhub-test.local`;
      const password = `Sh!V3Sec_${randomBytes(12).toString("base64url")}9z`;

      const [resA, resB, resC] = await Promise.all([
        admin.auth.admin.createUser({
          email: emailA,
          password,
          email_confirm: true,
          user_metadata: { display_name: "V3 Sec Audit A" },
        }),
        admin.auth.admin.createUser({
          email: emailB,
          password,
          email_confirm: true,
          user_metadata: { display_name: "V3 Sec Audit B" },
        }),
        admin.auth.admin.createUser({
          email: emailC,
          password,
          email_confirm: true,
          user_metadata: { display_name: "V3 Sec Audit C" },
        }),
      ]);

      if (resA.error || !resA.data.user) {
        throw new Error(`Provision User A failed: ${resA.error?.message}`);
      }
      if (resB.error || !resB.data.user) {
        throw new Error(`Provision User B failed: ${resB.error?.message}`);
      }
      if (resC.error || !resC.data.user) {
        throw new Error(`Provision User C failed: ${resC.error?.message}`);
      }

      userAId = resA.data.user.id;
      userBId = resB.data.user.id;
      userCId = resC.data.user.id;
      trackedUserIds.push(userAId, userBId, userCId);

      const [signA, signB, signC] = await Promise.all([
        clientA.auth.signInWithPassword({ email: emailA, password }),
        clientB.auth.signInWithPassword({ email: emailB, password }),
        clientC.auth.signInWithPassword({ email: emailC, password }),
      ]);
      if (signA.error || signB.error || signC.error) {
        throw new Error(
          `Sign-in failed: ${signA.error?.message ?? signB.error?.message ?? signC.error?.message}`,
        );
      }

      if (LIVE_API_BASE_URL) {
        [cookieA, cookieB, cookieC] = await Promise.all([
          mintSsrCookieHeader(LIVE_CONFIG, emailA, password),
          mintSsrCookieHeader(LIVE_CONFIG, emailB, password),
          mintSsrCookieHeader(LIVE_CONFIG, emailC, password),
        ]);
      }

      // Seed disposable study sets
      const { data: createdSets, error: setErr } = await clientA
        .from("study_sets")
        .insert([
          {
            owner_id: userAId,
            title: "V3 Sec Shared Viewer Set",
            visibility: "shared",
            set_type: "multiple_choice",
          },
          {
            owner_id: userAId,
            title: "V3 Sec Shared Editor Set",
            visibility: "shared",
            set_type: "multiple_choice",
          },
          {
            owner_id: userAId,
            title: "V3 Sec Revocable Set",
            visibility: "shared",
            set_type: "multiple_choice",
          },
          {
            owner_id: userAId,
            title: "V3 Sec Private Set A",
            visibility: "private",
            set_type: "multiple_choice",
          },
        ])
        .select("id, title");

      if (setErr || !createdSets || createdSets.length !== 4) {
        throw new Error(`Seed sets A failed: ${setErr?.message}`);
      }
      const byTitle = new Map(createdSets.map((s) => [s.title, s.id]));
      setASharedViewerId = byTitle.get("V3 Sec Shared Viewer Set")!;
      setAEditorSharedId = byTitle.get("V3 Sec Shared Editor Set")!;
      setARevocableId = byTitle.get("V3 Sec Revocable Set")!;
      setAPrivateId = byTitle.get("V3 Sec Private Set A")!;

      const { data: setB, error: setBErr } = await clientB
        .from("study_sets")
        .insert({
          owner_id: userBId,
          title: "V3 Sec Private Set B",
          visibility: "private",
          set_type: "multiple_choice",
        })
        .select("id")
        .single();
      if (setBErr || !setB) {
        throw new Error(`Seed set B failed: ${setBErr?.message}`);
      }
      setBId = setB.id;

      // Grant memberships to User B ONLY (User C has ZERO access to any of A's sets)
      const { error: memErr } = await clientA.from("study_set_members").insert([
        {
          study_set_id: setASharedViewerId,
          user_id: userBId,
          role: "viewer",
          allow_clone: false,
          invited_by: userAId,
        },
        {
          study_set_id: setAEditorSharedId,
          user_id: userBId,
          role: "editor",
          allow_clone: true,
          invited_by: userAId,
        },
        {
          study_set_id: setARevocableId,
          user_id: userBId,
          role: "viewer",
          allow_clone: false,
          invited_by: userAId,
        },
      ]);
      if (memErr) {
        throw new Error(`Seed memberships failed: ${memErr.message}`);
      }

      // Seed baseline questions on each set
      const { data: baseQs, error: qErr } = await clientA
        .from("questions")
        .insert([
          {
            study_set_id: setASharedViewerId,
            question_type: "single_choice",
            position: 0,
            prompt: "Shared viewer question for notes & reports?",
          },
          {
            study_set_id: setARevocableId,
            question_type: "single_choice",
            position: 0,
            prompt: "Revocable shared question for offline sync?",
          },
          {
            study_set_id: setAPrivateId,
            question_type: "single_choice",
            position: 0,
            prompt: "Private base question A?",
            explanation: "Private explanation A",
          },
          {
            study_set_id: setAEditorSharedId,
            question_type: "single_choice",
            position: 0,
            prompt: "Editor shared baseline question?",
          },
        ])
        .select("id, study_set_id");
      if (qErr || !baseQs || baseQs.length !== 4) {
        throw new Error(`Seed baseline questions failed: ${qErr?.message}`);
      }
      const qBySet = new Map(baseQs.map((q) => [q.study_set_id, q.id]));
      qASharedViewerId = qBySet.get(setASharedViewerId)!;
      qARevocableId = qBySet.get(setARevocableId)!;
      qAPrivateBaseId = qBySet.get(setAPrivateId)!;
      qAEditorSharedId = qBySet.get(setAEditorSharedId)!;

      const { error: optErr } = await clientA.from("question_options").insert([
        {
          question_id: qASharedViewerId,
          study_set_id: setASharedViewerId,
          position: 0,
          label: "A",
          content: "Correct Shared Option",
          is_correct: true,
        },
        {
          question_id: qASharedViewerId,
          study_set_id: setASharedViewerId,
          position: 1,
          label: "B",
          content: "Wrong Shared Option",
          is_correct: false,
        },
        {
          question_id: qAPrivateBaseId,
          study_set_id: setAPrivateId,
          position: 0,
          label: "A",
          content: "Private Correct Option",
          is_correct: true,
        },
        {
          question_id: qAPrivateBaseId,
          study_set_id: setAPrivateId,
          position: 1,
          label: "B",
          content: "Private Wrong Option",
          is_correct: false,
        },
        {
          question_id: qAEditorSharedId,
          study_set_id: setAEditorSharedId,
          position: 0,
          label: "A",
          content: "Editor Correct Option",
          is_correct: true,
        },
        {
          question_id: qAEditorSharedId,
          study_set_id: setAEditorSharedId,
          position: 1,
          label: "B",
          content: "Editor Wrong Option",
          is_correct: false,
        },
      ]);
      if (optErr) {
        throw new Error(`Seed baseline options failed: ${optErr.message}`);
      }
    }, 60_000);

    afterAll(async () => {
      if (!admin) return;
      try {
        // STRICT DATA PRESERVATION: delete ONLY our tracked test objects & our own disposable prefixes!
        const bucket = admin.storage.from("study-media");
        const toRemove = new Set<string>(trackedStoragePaths);

        const ownPrefixes = [
          `avatars/${userAId}`,
          `avatars/${userBId}`,
          `avatars/${userCId}`,
          `${userAId}/${setASharedViewerId}`,
          `${userAId}/${setAEditorSharedId}`,
          `${userAId}/${setARevocableId}`,
          `${userAId}/${setAPrivateId}`,
          `${userBId}/${setBId}`,
        ];

        for (const prefix of ownPrefixes) {
          if (!prefix || prefix.includes("//") || prefix.endsWith("/")) continue;
          const { data: list } = await bucket.list(prefix, { limit: 100 });
          for (const item of list ?? []) {
            if (item.name) {
              toRemove.add(`${prefix}/${item.name}`);
            }
          }
        }

        if (toRemove.size > 0) {
          await bucket.remove(Array.from(toRemove));
        }
      } finally {
        const delErrors: string[] = [];
        for (const uid of trackedUserIds) {
          if (!uid) continue;
          const res = await admin.auth.admin.deleteUser(uid);
          if (res.error) {
            delErrors.push(`Delete tracked user ${uid} failed: ${res.error.message}`);
          }
        }

        // Verify ONLY our tracked disposable users & tracked storage objects are gone
        for (const uid of trackedUserIds) {
          if (!uid) continue;
          const check = await admin.auth.admin.getUserById(uid);
          if (check.data?.user) {
            delErrors.push(`Tracked user ${uid} still exists after cleanup!`);
          }
        }
        if (delErrors.length > 0) {
          throw new Error(delErrors.join("; "));
        }
      }
    }, 60_000);

    it("1. Private Notes Isolation: zero cross-user leak across PostgREST, /api/notes, and global_library_search (bidirectional)", async () => {
      const secretTokenA = `V3NOTE_ALPHA_${randomBytes(4).toString("hex")}`;
      const secretTokenB = `V3NOTE_BETA_${randomBytes(4).toString("hex")}`;

      // User A creates a private note on the shared question
      if (LIVE_API_BASE_URL) {
        const putA = await apiFetch(
          "/api/notes",
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              study_set_id: setASharedViewerId,
              question_id: qASharedViewerId,
              content_text: `My confidential mnemonic ${secretTokenA}`,
            }),
          },
          cookieA,
        );
        expect(putA.status).toBe(201);
      } else {
        const insA = await clientA.from("user_question_notes").insert({
          user_id: userAId,
          study_set_id: setASharedViewerId,
          question_id: qASharedViewerId,
          content_text: `My confidential mnemonic ${secretTokenA}`,
        });
        expect(insA.error).toBeNull();
      }

      // Collaborator B & unrelated User C see 0 rows via direct PostgREST
      const [pgB, pgC] = await Promise.all([
        clientB
          .from("user_question_notes")
          .select("*")
          .eq("question_id", qASharedViewerId),
        clientC
          .from("user_question_notes")
          .select("*")
          .eq("question_id", qASharedViewerId),
      ]);
      expect(pgB.error).toBeNull();
      expect(pgB.data).toHaveLength(0);
      expect(pgC.error).toBeNull();
      expect(pgC.data).toHaveLength(0);

      // User B cannot forge user_id = userAId on insert
      const forgedNote = await clientB.from("user_question_notes").insert({
        user_id: userAId,
        study_set_id: setASharedViewerId,
        question_id: qASharedViewerId,
        content_text: "forged",
      });
      expect(forgedNote.error).not.toBeNull();

      // Direct global_library_search RPC: User B gets ZERO hits & ZERO note counts for A's secret
      const [rpcSearchA, rpcSearchB] = await Promise.all([
        clientA.rpc("global_library_search", { p_query: secretTokenA }),
        clientB.rpc("global_library_search", { p_query: secretTokenA }),
      ]);
      expect(rpcSearchA.error).toBeNull();
      expect((rpcSearchA.data as { total: number }).total).toBeGreaterThanOrEqual(1);
      expect(rpcSearchB.error).toBeNull();
      const rpcSearchBData = rpcSearchB.data as {
        total: number;
        items: unknown[];
        counts_by_type: Record<string, number>;
      };
      expect(rpcSearchBData.total).toBe(0);
      expect(rpcSearchBData.items).toHaveLength(0);
      expect(rpcSearchBData.counts_by_type.note).toBeUndefined();
      expect(JSON.stringify(rpcSearchBData.items)).not.toContain(secretTokenA);
      expect(JSON.stringify(rpcSearchBData)).not.toContain("confidential mnemonic");

      if (LIVE_API_BASE_URL) {
        const [apiNotesB, apiSearchB] = await Promise.all([
          apiFetch(`/api/notes?studySetId=${setASharedViewerId}`, {}, cookieB),
          apiFetch(`/api/search?q=${encodeURIComponent(secretTokenA)}`, {}, cookieB),
        ]);
        expect(apiNotesB.status).toBe(200);
        const notesBJson = (await apiNotesB.json()) as { data: unknown[] };
        expect(notesBJson.data).toHaveLength(0);

        expect(apiSearchB.status).toBe(200);
        const searchBJson = (await apiSearchB.json()) as {
          data: { total: number; counts_by_type: Record<string, number>; items: unknown[] };
        };
        expect(searchBJson.data.total).toBe(0);
        expect(searchBJson.data.items).toHaveLength(0);
        expect(searchBJson.data.counts_by_type.note).toBeUndefined();
        expect(JSON.stringify(searchBJson.data.items)).not.toContain(secretTokenA);
        expect(JSON.stringify(searchBJson)).not.toContain("confidential mnemonic");
      }

      // Bidirectional: User B creates own private note -> Owner A CANNOT read, search, or edit it!
      const putBRes = LIVE_API_BASE_URL
        ? await apiFetch(
            "/api/notes",
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                study_set_id: setASharedViewerId,
                question_id: qASharedViewerId,
                content_text: `Viewer B secret note ${secretTokenB}`,
              }),
            },
            cookieB,
          )
        : null;
      if (putBRes) {
        expect(putBRes.status).toBe(201);
      } else {
        const insB = await clientB.from("user_question_notes").insert({
          user_id: userBId,
          study_set_id: setASharedViewerId,
          question_id: qASharedViewerId,
          content_text: `Viewer B secret note ${secretTokenB}`,
        });
        expect(insB.error).toBeNull();
      }

      const [pgAOwn, pgATamperB, rpcSearchAForB] = await Promise.all([
        clientA
          .from("user_question_notes")
          .select("*")
          .eq("question_id", qASharedViewerId),
        clientA
          .from("user_question_notes")
          .update({ content_text: "Owner hacked B note" })
          .eq("user_id", userBId)
          .eq("question_id", qASharedViewerId)
          .select("id"),
        clientA.rpc("global_library_search", { p_query: secretTokenB }),
      ]);

      expect(pgAOwn.error).toBeNull();
      expect(pgAOwn.data).toHaveLength(1);
      expect(pgAOwn.data?.[0]?.user_id).toBe(userAId);
      expect(JSON.stringify(pgAOwn.data)).not.toContain(secretTokenB);
      expect(pgATamperB.data ?? []).toHaveLength(0);
      const rpcSearchAForBData = rpcSearchAForB.data as {
        total: number;
        items: unknown[];
        counts_by_type: Record<string, number>;
      };
      expect(rpcSearchAForBData.total).toBe(0);
      expect(rpcSearchAForBData.items).toHaveLength(0);
      expect(rpcSearchAForBData.counts_by_type.note).toBeUndefined();
      expect(JSON.stringify(rpcSearchAForBData.items)).not.toContain(secretTokenB);
      expect(JSON.stringify(rpcSearchAForBData)).not.toContain("Viewer B secret note");
    }, 30_000);

    it("2. Question Reports RLS: Viewer B submits, Owner A sees & resolves, User C sees 0 rows, Viewer B cannot self-resolve", async () => {
      let reportId = "";

      if (LIVE_API_BASE_URL) {
        const createRes = await apiFetch(
          "/api/reports",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              study_set_id: setASharedViewerId,
              question_id: qASharedViewerId,
              category: "wrong_answer",
              description: "Option A has a typo.",
            }),
          },
          cookieB,
        );
        expect(createRes.status).toBe(201);
        const created = (await createRes.json()) as {
          data: { id: string; status: string };
        };
        expect(created.data.status).toBe("open");
        reportId = created.data.id;
      } else {
        const ins = await clientB
          .from("question_reports")
          .insert({
            study_set_id: setASharedViewerId,
            question_id: qASharedViewerId,
            reporter_id: userBId,
            category: "wrong_answer",
            description: "Option A has a typo.",
          })
          .select("id")
          .single();
        expect(ins.error).toBeNull();
        reportId = ins.data!.id;
      }

      // Unrelated User C gets 0 rows via PostgREST
      const cDirect = await clientC
        .from("question_reports")
        .select("*")
        .eq("id", reportId);
      expect(cDirect.error).toBeNull();
      expect(cDirect.data).toHaveLength(0);

      // Viewer B CANNOT resolve own report via PostgREST RLS
      const bDirectResolve = await clientB
        .from("question_reports")
        .update({ status: "resolved" })
        .eq("id", reportId)
        .select("id, status");
      expect(bDirectResolve.data ?? []).toHaveLength(0);

      if (LIVE_API_BASE_URL) {
        // User C blocked via HTTP
        const [cList, cPatch, cCreatePrivate] = await Promise.all([
          apiFetch(`/api/reports?studySetId=${setASharedViewerId}`, {}, cookieC),
          apiFetch(
            `/api/reports/${reportId}`,
            {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status: "resolved" }),
            },
            cookieC,
          ),
          apiFetch(
            "/api/reports",
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                study_set_id: setAPrivateId,
                question_id: qAPrivateBaseId,
                category: "typo_formatting",
                description: "Unauthorized report",
              }),
            },
            cookieC,
          ),
        ]);
        expect([403, 404]).toContain(cList.status);
        expect([403, 404]).toContain(cPatch.status);
        expect([403, 404]).toContain(cCreatePrivate.status);

        // Viewer B CANNOT self-resolve via PATCH /api/reports/[id]
        const bPatch = await apiFetch(
          `/api/reports/${reportId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "resolved", resolution_note: "Self-resolved" }),
          },
          cookieB,
        );
        expect(bPatch.status).toBe(403);

        // Owner A sees & resolves report cleanly
        const aList = await apiFetch(
          `/api/reports?studySetId=${setASharedViewerId}`,
          {},
          cookieA,
        );
        expect(aList.status).toBe(200);
        const aListJson = (await aList.json()) as { data: Array<{ id: string }> };
        expect(aListJson.data.some((r) => r.id === reportId)).toBe(true);

        const aResolve = await apiFetch(
          `/api/reports/${reportId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ status: "resolved", resolution_note: "Fixed option A" }),
          },
          cookieA,
        );
        expect(aResolve.status).toBe(200);
        const resolved = (await aResolve.json()) as {
          data: { status: string; resolved_by: string };
        };
        expect(resolved.data.status).toBe("resolved");
        expect(resolved.data.resolved_by).toBe(userAId);

        // Non-owner Editor B cannot delete Owner A's report on setAEditorSharedId
        const ownerRep = await apiFetch(
          "/api/reports",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              study_set_id: setAEditorSharedId,
              question_id: qAEditorSharedId,
              category: "other",
              description: "Owner QA note",
            }),
          },
          cookieA,
        );
        expect(ownerRep.status).toBe(201);
        const ownerRepId = ((await ownerRep.json()) as { data: { id: string } }).data.id;

        const editorDel = await apiFetch(
          `/api/reports/${ownerRepId}`,
          { method: "DELETE" },
          cookieB,
        );
        expect([403, 404]).toContain(editorDel.status);

        // Verify report still exists for Owner A
        const stillThere = await clientA
          .from("question_reports")
          .select("id")
          .eq("id", ownerRepId)
          .maybeSingle();
        expect(stillThere.data?.id).toBe(ownerRepId);
      } else {
        const aUpd = await clientA
          .from("question_reports")
          .update({ status: "resolved", resolved_by: userAId })
          .eq("id", reportId)
          .select("status")
          .single();
        expect(aUpd.error).toBeNull();
        expect(aUpd.data?.status).toBe("resolved");
      }
    }, 30_000);

    it("3. Checkpoints, Confidence & Offline Sync RLS: zero cross-user leak, event_id replay returns invalid, revoked share returns rejected_inaccessible, note_upsert rich text sanitized", async () => {
      const sessionKeyA = `learn:sec-a-${randomBytes(4).toString("hex")}`;
      const eventAId = randomUUID();
      const eventBRevocableOkId = randomUUID();
      const eventBRevokedId = randomUUID();
      const eventAXssNoteId = randomUUID();

      // User A saves checkpoint + syncs an answer+confidence event
      if (LIVE_API_BASE_URL) {
        const cpRes = await apiFetch(
          "/api/checkpoints",
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              study_set_id: setAPrivateId,
              mode: "learn",
              session_key: sessionKeyA,
              state_json: { cursor: 1, secret: "A_ONLY" },
              progress_percent: 50,
              current_index: 1,
              total_items: 2,
            }),
          },
          cookieA,
        );
        expect(cpRes.status).toBe(200);

        const syncARes = await apiFetch(
          "/api/sync/events",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              events: [
                {
                  event_id: eventAId,
                  event_type: "answer",
                  study_set_id: setAPrivateId,
                  question_id: qAPrivateBaseId,
                  client_timestamp: new Date().toISOString(),
                  payload: { is_correct: true, confidence: "certain", mode: "practice" },
                },
              ],
            }),
          },
          cookieA,
        );
        expect(syncARes.status).toBe(200);
        const syncAJson = (await syncARes.json()) as {
          data: { results: Array<{ event_id: string; status: string }> };
        };
        expect(syncAJson.data.results[0]?.status).toBe("applied");
      } else {
        await clientA.from("learning_session_checkpoints").insert({
          user_id: userAId,
          study_set_id: setAPrivateId,
          mode: "learn",
          session_key: sessionKeyA,
          state_json: { cursor: 1 },
          progress_percent: 50,
          current_index: 1,
          total_items: 2,
        });
        const rpcA = await clientA.rpc("sync_offline_learning_events", {
          p_events: [
            {
              event_id: eventAId,
              event_type: "answer",
              study_set_id: setAPrivateId,
              question_id: qAPrivateBaseId,
              client_timestamp: new Date().toISOString(),
              payload: { is_correct: true, confidence: "certain", mode: "practice" },
            },
          ],
        });
        expect(rpcA.error).toBeNull();
      }

      // Direct PostgREST isolation across all 3 tables for User B & User C
      const [
        cpReadB,
        confReadB,
        syncReadB,
        cpReadC,
        cpInsertForge,
        confInsertForge,
        syncInsertForge,
      ] = await Promise.all([
        clientB.from("learning_session_checkpoints").select("*").eq("user_id", userAId),
        clientB.from("learning_confidence_events").select("*").eq("user_id", userAId),
        clientB.from("learning_sync_events").select("*").eq("user_id", userAId),
        clientC.from("learning_session_checkpoints").select("*").eq("user_id", userAId),
        clientB.from("learning_session_checkpoints").insert({
          user_id: userAId,
          mode: "learn",
          session_key: "forged-cp",
        }),
        clientB.from("learning_confidence_events").insert({
          user_id: userAId,
          study_set_id: setASharedViewerId,
          question_id: qASharedViewerId,
          mode: "practice",
          confidence: "certain",
          is_correct: true,
        }),
        clientB.from("learning_sync_events").insert({
          event_id: randomUUID(),
          user_id: userAId,
          event_type: "star",
          client_timestamp: new Date().toISOString(),
          status: "applied",
        }),
      ]);

      expect(cpReadB.data).toHaveLength(0);
      expect(confReadB.data).toHaveLength(0);
      expect(syncReadB.data).toHaveLength(0);
      expect(cpReadC.data).toHaveLength(0);
      expect(cpInsertForge.error).not.toBeNull();
      expect(confInsertForge.error).not.toBeNull();
      expect(syncInsertForge.error).not.toBeNull();

      // User A replaying own eventAId -> duplicate_ignored
      // User B replaying User A's eventAId -> MUST return `invalid` (no disclosure!)
      const [replayA, replayB] = await Promise.all([
        LIVE_API_BASE_URL
          ? apiFetch(
              "/api/sync/events",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  events: [
                    {
                      event_id: eventAId,
                      event_type: "star",
                      study_set_id: setAPrivateId,
                      question_id: qAPrivateBaseId,
                      client_timestamp: new Date().toISOString(),
                      payload: { starred: true },
                    },
                  ],
                }),
              },
              cookieA,
            ).then((r) => r.json() as Promise<{ data: { results: Array<{ status: string; message?: string }> } }>)
          : clientA
              .rpc("sync_offline_learning_events", {
                p_events: [
                  {
                    event_id: eventAId,
                    event_type: "star",
                    study_set_id: setAPrivateId,
                    question_id: qAPrivateBaseId,
                    client_timestamp: new Date().toISOString(),
                    payload: { starred: true },
                  },
                ],
              })
              .then((r) => ({ data: r.data as { results: Array<{ status: string; message?: string }> } })),
        LIVE_API_BASE_URL
          ? apiFetch(
              "/api/sync/events",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  events: [
                    {
                      event_id: eventAId,
                      event_type: "star",
                      study_set_id: setBId,
                      question_id: qASharedViewerId,
                      client_timestamp: new Date().toISOString(),
                      payload: { starred: true },
                    },
                  ],
                }),
              },
              cookieB,
            ).then((r) => r.json() as Promise<{ data: { results: Array<{ status: string; message?: string }> } }>)
          : clientB
              .rpc("sync_offline_learning_events", {
                p_events: [
                  {
                    event_id: eventAId,
                    event_type: "star",
                    study_set_id: setBId,
                    question_id: qASharedViewerId,
                    client_timestamp: new Date().toISOString(),
                    payload: { starred: true },
                  },
                ],
              })
              .then((r) => ({ data: r.data as { results: Array<{ status: string; message?: string }> } })),
      ]);

      expect(replayA.data.results[0]?.status).toBe("duplicate_ignored");
      expect(replayB.data.results[0]?.status).toBe("invalid");
      expect(JSON.stringify(replayB.data)).not.toContain(userAId);
      expect(JSON.stringify(replayB.data)).not.toContain("duplicate");

      // Share revocation test: B syncs OK while shared -> A revokes share -> B syncs opaque `rejected_inaccessible` (SEC-10)!
      const syncBPreRevoke = LIVE_API_BASE_URL
        ? ((await (
            await apiFetch(
              "/api/sync/events",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  events: [
                    {
                      event_id: eventBRevocableOkId,
                      event_type: "star",
                      study_set_id: setARevocableId,
                      question_id: qARevocableId,
                      client_timestamp: new Date().toISOString(),
                      payload: { starred: true },
                    },
                  ],
                }),
              },
              cookieB,
            )
          ).json()) as { data: { results: Array<{ status: string }> } }).data
        : ((
            await clientB.rpc("sync_offline_learning_events", {
              p_events: [
                {
                  event_id: eventBRevocableOkId,
                  event_type: "star",
                  study_set_id: setARevocableId,
                  question_id: qARevocableId,
                  client_timestamp: new Date().toISOString(),
                  payload: { starred: true },
                },
              ],
            })
          ).data as { results: Array<{ status: string }> });

      expect(syncBPreRevoke.results[0]?.status).toBe("applied");

      // Owner A revokes B's membership on setARevocableId
      const revokeRes = await clientA
        .from("study_set_members")
        .delete()
        .eq("study_set_id", setARevocableId)
        .eq("user_id", userBId);
      expect(revokeRes.error).toBeNull();

      // User B tries syncing queued offline event after revocation -> opaque rejected_inaccessible (SEC-10)!
      const syncBPostRevoke = LIVE_API_BASE_URL
        ? ((await (
            await apiFetch(
              "/api/sync/events",
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  events: [
                    {
                      event_id: eventBRevokedId,
                      event_type: "answer",
                      study_set_id: setARevocableId,
                      question_id: qARevocableId,
                      client_timestamp: new Date().toISOString(),
                      payload: { is_correct: true, mode: "practice" },
                    },
                  ],
                }),
              },
              cookieB,
            )
          ).json()) as { data: { results: Array<{ status: string }> } }).data
        : ((
            await clientB.rpc("sync_offline_learning_events", {
              p_events: [
                {
                  event_id: eventBRevokedId,
                  event_type: "answer",
                  study_set_id: setARevocableId,
                  question_id: qARevocableId,
                  client_timestamp: new Date().toISOString(),
                  payload: { is_correct: true, mode: "practice" },
                },
              ],
            })
          ).data as { results: Array<{ status: string }> });

      if (LIVE_API_BASE_URL) {
        // API route always collapses rejected_revoked/rejected_deleted into opaque rejected_inaccessible (SEC-10)
        expect(syncBPostRevoke.results[0]?.status).toBe("rejected_inaccessible");
      } else {
        // Direct RPC returns rejected_inaccessible once Migration 0019 Block (d) is applied (rejected_revoked pre-apply)
        expect(["rejected_inaccessible", "rejected_revoked"]).toContain(
          syncBPostRevoke.results[0]?.status,
        );
      }

      // V3-SEC-04: POST /api/sync/events must sanitize `note_upsert` payload.content_rich!
      if (LIVE_API_BASE_URL) {
        const xssSync = await apiFetch(
          "/api/sync/events",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              events: [
                {
                  event_id: eventAXssNoteId,
                  event_type: "note_upsert",
                  study_set_id: setAPrivateId,
                  question_id: qAPrivateBaseId,
                  client_timestamp: new Date().toISOString(),
                  payload: {
                    content_text: "Offline synced note",
                    content_rich: {
                      type: "doc",
                      content: [
                        { type: "script", content: [{ type: "text", text: "alert(1)" }] },
                        {
                          type: "paragraph",
                          content: [
                            {
                              type: "text",
                              text: "bad link",
                              marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
                            },
                          ],
                        },
                      ],
                    },
                  },
                },
              ],
            }),
          },
          cookieA,
        );
        expect(xssSync.status).toBe(200);

        const storedNote = await clientA
          .from("user_question_notes")
          .select("content_rich")
          .eq("user_id", userAId)
          .eq("question_id", qAPrivateBaseId)
          .single();
        expect(storedNote.error).toBeNull();
        const storedRichStr = JSON.stringify(storedNote.data?.content_rich ?? {});
        expect(storedRichStr).not.toContain("javascript:");
        expect(storedRichStr).not.toContain('"type":"script"');
      }
    }, 30_000);

    it("4. Media & Audio Upload Security + Private Storage Isolation + Cross-Tenant Relation Guard (V3-SEC-03)", async () => {
      if (!LIVE_API_BASE_URL) {
        // Storage-level direct check when HTTP server is not targeted
        const directPngPath = `${userAId}/${setAPrivateId}/direct-${randomUUID()}.png`;
        trackedStoragePaths.add(directPngPath);
        const up = await clientA.storage
          .from("study-media")
          .upload(directPngPath, VALID_PNG_BYTES, { contentType: "image/png" });
        expect(up.error).toBeNull();

        const bSign = await clientB.storage
          .from("study-media")
          .createSignedUrl(directPngPath, 60);
        expect(bSign.error).not.toBeNull();
        return;
      }

      // 1. Valid PNG upload via /api/uploads/image -> 201
      const pngForm = new FormData();
      pngForm.append(
        "file",
        new File([new Uint8Array(VALID_PNG_BYTES)], "diagram.png", { type: "image/png" }),
      );
      pngForm.append("purpose", "question");
      pngForm.append("studySetId", setAPrivateId);
      const pngRes = await apiFetch(
        "/api/uploads/image",
        { method: "POST", body: pngForm },
        cookieA,
      );
      expect(pngRes.status).toBe(201);
      const pngBody = (await pngRes.json()) as {
        data: { mediaId: string; path: string; signedUrl: string };
      };
      trackedStoragePaths.add(pngBody.data.path);

      // 2. Valid WAV & MP3 uploads via /api/uploads/audio -> 201
      const wavForm = new FormData();
      wavForm.append(
        "file",
        new File([new Uint8Array(VALID_WAV_BYTES)], "clip.wav", { type: "audio/wav" }),
      );
      wavForm.append("purpose", "listening");
      wavForm.append("studySetId", setAPrivateId);
      const wavRes = await apiFetch(
        "/api/uploads/audio",
        { method: "POST", body: wavForm },
        cookieA,
      );
      expect(wavRes.status).toBe(201);
      const wavBody = (await wavRes.json()) as {
        data: { mediaId: string; path: string };
      };
      trackedStoragePaths.add(wavBody.data.path);

      const mp3Form = new FormData();
      mp3Form.append(
        "file",
        new File([new Uint8Array(VALID_MP3_BYTES)], "clip.mp3", { type: "audio/mpeg" }),
      );
      mp3Form.append("purpose", "listening");
      mp3Form.append("studySetId", setAPrivateId);
      const mp3Res = await apiFetch(
        "/api/uploads/audio",
        { method: "POST", body: mp3Form },
        cookieA,
      );
      expect(mp3Res.status).toBe(201);
      const mp3Body = (await mp3Res.json()) as {
        data: { mediaId: string; path: string };
      };
      trackedStoragePaths.add(mp3Body.data.path);

      // 3. Reject SVG, disguised HTML-as-PNG, disguised HTML-as-MP3, SVG-as-WAV (415) & oversized (>5MB / >10MB -> 413)
      const makeForm = (
        bytes: Buffer | Uint8Array,
        name: string,
        type: string,
        purpose = "question",
      ): FormData => {
        const fd = new FormData();
        fd.append("file", new File([new Uint8Array(bytes)], name, { type }));
        fd.append("purpose", purpose);
        fd.append("studySetId", setAPrivateId);
        return fd;
      };

      const oversizedImg = Buffer.alloc(5 * 1024 * 1024 + 128);
      VALID_PNG_BYTES.copy(oversizedImg, 0);
      const oversizedAud = Buffer.alloc(10 * 1024 * 1024 + 128);
      VALID_WAV_BYTES.copy(oversizedAud, 0);

      const [svgImg, htmlAsPng, htmlAsMp3, svgAsWav, bigImg, bigAud] =
        await Promise.all([
          apiFetch(
            "/api/uploads/image",
            { method: "POST", body: makeForm(EVIL_SVG_BYTES, "xss.svg", "image/svg+xml") },
            cookieA,
          ),
          apiFetch(
            "/api/uploads/image",
            { method: "POST", body: makeForm(EVIL_HTML_BYTES, "fake.png", "image/png") },
            cookieA,
          ),
          apiFetch(
            "/api/uploads/audio",
            { method: "POST", body: makeForm(EVIL_HTML_BYTES, "fake.mp3", "audio/mpeg", "listening") },
            cookieA,
          ),
          apiFetch(
            "/api/uploads/audio",
            { method: "POST", body: makeForm(EVIL_SVG_BYTES, "fake.wav", "audio/wav", "listening") },
            cookieA,
          ),
          apiFetch(
            "/api/uploads/image",
            { method: "POST", body: makeForm(oversizedImg, "huge.png", "image/png") },
            cookieA,
          ),
          apiFetch(
            "/api/uploads/audio",
            { method: "POST", body: makeForm(oversizedAud, "huge.wav", "audio/wav", "listening") },
            cookieA,
          ),
        ]);

      expect(svgImg.status).toBe(415);
      expect(htmlAsPng.status).toBe(415);
      expect(htmlAsMp3.status).toBe(415);
      expect(svgAsWav.status).toBe(415);
      expect(bigImg.status).toBe(413);
      // Fail-closed rejection: Next.js 16 default 10 MB proxyClientMaxBodySize truncates
      // >10 MB multipart requests before formData() (returning 400) or route handler returns 413.
      expect([400, 413]).toContain(bigAud.status);
      const audCapCheck = validateAudioUpload(
        new Uint8Array(oversizedAud),
        "huge.wav",
        "audio/wav",
      );
      expect(audCapCheck.valid).toBe(false);
      if (!audCapCheck.valid) {
        expect(audCapCheck.status).toBe(413);
        expect(audCapCheck.code).toBe("FILE_TOO_LARGE");
      }

      // 4. Unshared media blocked for User B, User C, and anon
      const encPath = encodeURIComponent(pngBody.data.path);
      const [signB, signC, signAnon, pgMediaB, storageSignB, storageSignAnon] =
        await Promise.all([
          apiFetch(`/api/uploads/signed-url?path=${encPath}`, {}, cookieB),
          apiFetch(`/api/uploads/signed-url?path=${encPath}`, {}, cookieC),
          apiFetch(`/api/uploads/signed-url?path=${encPath}`),
          clientB.from("media_assets").select("*").eq("id", pngBody.data.mediaId),
          clientB.storage.from("study-media").createSignedUrl(pngBody.data.path, 60),
          anonClient.storage.from("study-media").createSignedUrl(pngBody.data.path, 60),
        ]);

      expect([403, 404]).toContain(signB.status);
      expect([403, 404]).toContain(signC.status);
      expect(signAnon.status).toBe(401);
      expect(pgMediaB.data).toHaveLength(0);
      expect(storageSignB.error).not.toBeNull();
      expect(storageSignAnon.error).not.toBeNull();

      // 5. V3-SEC-03: User B cannot attach User B's media asset onto User A's private question!
      const bImgForm = new FormData();
      bImgForm.append(
        "file",
        new File([VALID_PNG_BYTES], "b-own.png", { type: "image/png" }),
      );
      bImgForm.append("purpose", "question");
      bImgForm.append("studySetId", setBId);
      const bImgRes = await apiFetch(
        "/api/uploads/image",
        { method: "POST", body: bImgForm },
        cookieB,
      );
      expect(bImgRes.status).toBe(201);
      const bImg = (await bImgRes.json()) as { data: { mediaId: string; path: string } };
      trackedStoragePaths.add(bImg.data.path);

      const crossAttach = await apiFetch(
        "/api/media",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            media_id: bImg.data.mediaId,
            entity_type: "question",
            entity_id: qAPrivateBaseId,
            role: "prompt",
          }),
        },
        cookieB,
      );
      expect([403, 404]).toContain(crossAttach.status);
    }, 45_000);

    it("5. Historical Exam Snapshot Media Preservation + ON DELETE RESTRICT (409) + Non-Owner Editor Delete Guard (V3-SEC-02)", async () => {
      if (!LIVE_API_BASE_URL) return;

      // 1. Owner A uploads image on setAEditorSharedId & creates a question linked via content_media_relations
      const fd = new FormData();
      fd.append(
        "file",
        new File([VALID_PNG_BYTES], "exam-diagram.png", { type: "image/png" }),
      );
      fd.append("purpose", "question");
      fd.append("studySetId", setAEditorSharedId);
      const upRes = await apiFetch(
        "/api/uploads/image",
        { method: "POST", body: fd },
        cookieA,
      );
      expect(upRes.status).toBe(201);
      const media = (await upRes.json()) as {
        data: { mediaId: string; path: string; proxyUrl: string };
      };
      trackedStoragePaths.add(media.data.path);

      const qCreateRes = await apiFetch(
        `/api/sets/${setAEditorSharedId}/questions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question_type: "single_choice",
            prompt: "Identify this aircraft system diagram",
            prompt_image_url: media.data.proxyUrl,
            media_attachments: [{ media_id: media.data.mediaId, role: "prompt" }],
            options: [
              { label: "A", content: "Pitot-Static", is_correct: true },
              { label: "B", content: "Hydraulic", is_correct: false },
            ],
          }),
        },
        cookieA,
      );
      expect(qCreateRes.status).toBe(201);
      const createdQ = (await qCreateRes.json()) as { data: { id: string } };

      // 2. Collaborator B starts & submits an exam referencing that question
      const examStart = await apiFetch(
        "/api/exams",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            study_set_id: setAEditorSharedId,
            question_ids: [createdQ.data.id],
            question_count: 1,
          }),
        },
        cookieB,
      );
      expect(examStart.status).toBe(201);
      const examBody = (await examStart.json()) as {
        data: { attempt: { id: string } };
      };
      const attemptBId = examBody.data.attempt.id;

      const submitRes = await apiFetch(
        `/api/exams/${attemptBId}/submit`,
        { method: "POST" },
        cookieB,
      );
      expect(submitRes.status).toBe(200);

      // 3. Owner A tries DELETE /api/media/[id] while referenced by exam snapshot -> MUST return 409!
      const ownerDel = await apiFetch(
        `/api/media/${media.data.mediaId}`,
        { method: "DELETE" },
        cookieA,
      );
      expect(ownerDel.status).toBe(409);

      // 4. V3-SEC-02: Non-owner Editor B tries DELETE /api/media/[id] -> MUST return 403 AND NOT delete Storage blob!
      const editorDel = await apiFetch(
        `/api/media/${media.data.mediaId}`,
        { method: "DELETE" },
        cookieB,
      );
      expect(editorDel.status).toBe(403);

      // Verify blob STILL exists in Storage after Editor B's rejected delete
      const ownerSignStillAlive = await apiFetch(
        `/api/uploads/signed-url?path=${encodeURIComponent(media.data.path)}`,
        {},
        cookieA,
      );
      expect(ownerSignStillAlive.status).toBe(200);

      // 5. Owner A revokes User B's share on setAEditorSharedId!
      const revokeEd = await clientA
        .from("study_set_members")
        .delete()
        .eq("study_set_id", setAEditorSharedId)
        .eq("user_id", userBId);
      expect(revokeEd.error).toBeNull();

      // User B can no longer read the study set itself...
      const bSetDenied = await apiFetch(
        `/api/sets/${setAEditorSharedId}`,
        {},
        cookieB,
      );
      expect([403, 404]).toContain(bSetDenied.status);

      // ...YET User B's authorized historical exam snapshot media read is STILL preserved!
      const bHistMedia = await apiFetch(
        `/api/uploads/signed-url?path=${encodeURIComponent(media.data.path)}`,
        {},
        cookieB,
      );
      expect(bHistMedia.status).toBe(200);
      const bHistJson = (await bHistMedia.json()) as { data: { signedUrl: string } };
      expect(bHistJson.data.signedUrl).toContain("token=");

      // Meanwhile unrelated User C is STILL denied access to that exact same media!
      const cDenied = await apiFetch(
        `/api/uploads/signed-url?path=${encodeURIComponent(media.data.path)}`,
        {},
        cookieC,
      );
      expect([403, 404]).toContain(cDenied.status);
    }, 45_000);

    it("6. 12-Type Pre-Submit Exam Anti-Leak (API + Direct PostgREST 42501 column revocation)", async () => {
      // Seed 6 rich answer-bearing V3 question types into setAPrivateId with unique sentinels
      const SENTINEL_BLANK = "SENTINEL_BLANK_KEY_991";
      const SENTINEL_NUM = 42.195;
      const SENTINEL_TRANSCRIPT = "SENTINEL_HIDDEN_AUDIO_TRANSCRIPT_777";
      const SENTINEL_EXPLANATION = "SENTINEL_EXPLANATION_TEXT_888";

      const { data: v3Qs, error: v3QErr } = await clientA
        .from("questions")
        .insert([
          {
            study_set_id: setAPrivateId,
            question_type: "fill_in_blank",
            position: 10,
            prompt: "The capital of Vietnam is {{b1}}.",
            explanation: SENTINEL_EXPLANATION,
            type_payload: {
              type: "fill_in_blank",
              template_text: "The capital of Vietnam is {{b1}}.",
              blanks: [
                {
                  blank_id: "b1",
                  accepted_answers: [SENTINEL_BLANK],
                  match_mode: "case_insensitive",
                },
              ],
              require_all_blanks: true,
            },
          },
          {
            study_set_id: setAPrivateId,
            question_type: "numerical",
            position: 11,
            prompt: "Marathon distance in km?",
            explanation: SENTINEL_EXPLANATION,
            type_payload: {
              type: "numerical",
              correct_value: SENTINEL_NUM,
              abs_tolerance: 0.05,
              unit: "km",
              unit_required: false,
            },
          },
          {
            study_set_id: setAPrivateId,
            question_type: "ordering",
            position: 12,
            prompt: "Order checklist steps",
            explanation: SENTINEL_EXPLANATION,
            type_payload: {
              type: "ordering",
              items: [
                { id: "ord-1", text: "Preflight", correct_position: 0 },
                { id: "ord-2", text: "Engine Start", correct_position: 1 },
                { id: "ord-3", text: "Takeoff", correct_position: 2 },
              ],
              allow_partial_credit: false,
            },
          },
          {
            study_set_id: setAPrivateId,
            question_type: "matching",
            position: 13,
            prompt: "Match ICAO codes",
            explanation: SENTINEL_EXPLANATION,
            type_payload: {
              type: "matching",
              pairs: [
                { id: "L1", left_text: "VVNB", right_id: "R1", right_text: "Noi Bai" },
                { id: "L2", left_text: "VVTS", right_id: "R2", right_text: "Tan Son Nhat" },
              ],
            },
          },
          {
            study_set_id: setAPrivateId,
            question_type: "image_hotspot",
            position: 14,
            prompt: "Click the Pitot Tube on the fuselage",
            explanation: SENTINEL_EXPLANATION,
            type_payload: {
              type: "image_hotspot",
              image_url: "https://studyhub.example/aircraft.png",
              target_hotspots: [
                {
                  id: "hs-pitot",
                  label: "Pitot Tube",
                  shape: "rect",
                  geometry: {
                    shape: "rect",
                    x: 0.234,
                    y: 0.456,
                    width: 0.123,
                    height: 0.111,
                  },
                },
              ],
              require_all_targets: true,
            },
          },
          {
            study_set_id: setAPrivateId,
            question_type: "listening",
            position: 15,
            prompt: "Listen to ATIS and choose the runway.",
            explanation: SENTINEL_EXPLANATION,
            audio_url: "https://studyhub.example/atis.mp3",
            audio_transcript: SENTINEL_TRANSCRIPT,
            type_payload: {
              type: "listening",
              audio_url: "https://studyhub.example/atis.mp3",
              transcript: SENTINEL_TRANSCRIPT,
              show_transcript_after_submit: true,
              sub_answer_kind: "single_choice",
            },
          },
        ])
        .select("id, question_type");

      expect(v3QErr).toBeNull();
      expect(v3Qs).toHaveLength(6);

      const listeningQId = v3Qs!.find((q) => q.question_type === "listening")!.id;
      const { error: lOptErr } = await clientA.from("question_options").insert([
        {
          question_id: listeningQId,
          study_set_id: setAPrivateId,
          position: 0,
          label: "A",
          content: "Runway 11L",
          is_correct: true,
        },
        {
          question_id: listeningQId,
          study_set_id: setAPrivateId,
          position: 1,
          label: "B",
          content: "Runway 29R",
          is_correct: false,
        },
      ]);
      expect(lOptErr).toBeNull();

      const qIds = v3Qs!.map((q) => q.id);

      const assertZeroPreSubmitLeaks = (payload: unknown): void => {
        const raw = JSON.stringify(payload);
        expect(raw).not.toContain('"is_correct"');
        expect(raw).not.toContain('"correct_option_ids"');
        expect(raw).not.toContain('"accepted_answers"');
        expect(raw).not.toContain('"accepted_answers_snapshot"');
        expect(raw).not.toContain('"explanation_snapshot"');
        expect(raw).not.toContain('"explanation_rich_snapshot"');
        expect(raw).not.toContain('"correct_value"');
        expect(raw).not.toContain('"abs_tolerance"');
        expect(raw).not.toContain('"rel_tolerance"');
        expect(raw).not.toContain('"correct_position"');
        expect(raw).not.toContain('"geometry"');
        expect(raw).not.toContain('"target_hotspots"');
        expect(raw).not.toContain(SENTINEL_BLANK);
        expect(raw).not.toContain(String(SENTINEL_NUM));
        expect(raw).not.toContain(SENTINEL_TRANSCRIPT);
        expect(raw).not.toContain(SENTINEL_EXPLANATION);
        expect(raw).not.toContain("0.234");
        expect(raw).not.toContain("0.456");

        // Matching payload must NOT contain paired `"pairs"`, only unlinked `left_items` + `right_items`
        const questions = (payload as { questions: Array<{ question_type: string; type_payload_snapshot?: Record<string, unknown> }> }).questions;
        const matchQ = questions.find((q) => q.question_type === "matching");
        expect(matchQ?.type_payload_snapshot).toBeDefined();
        expect(matchQ?.type_payload_snapshot?.pairs).toBeUndefined();
        expect(Array.isArray(matchQ?.type_payload_snapshot?.left_items)).toBe(true);
        expect(Array.isArray(matchQ?.type_payload_snapshot?.right_items)).toBe(true);
      };

      let attemptId = "";
      if (LIVE_API_BASE_URL) {
        const startRes = await apiFetch(
          "/api/exams",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              study_set_id: setAPrivateId,
              question_ids: qIds,
              question_count: qIds.length,
              shuffle_questions: false,
              shuffle_options: false,
            }),
          },
          cookieA,
        );
        expect(startRes.status).toBe(201);
        const startJson = (await startRes.json()) as {
          data: { attempt: { id: string }; questions: unknown[] };
        };
        attemptId = startJson.data.attempt.id;
        assertZeroPreSubmitLeaks(startJson.data);

        // Repeat anti-leak verification on GET /api/exams/[attemptId] while in_progress
        const getRes = await apiFetch(`/api/exams/${attemptId}`, {}, cookieA);
        expect(getRes.status).toBe(200);
        const getJson = (await getRes.json()) as { data: unknown };
        assertZeroPreSubmitLeaks(getJson.data);
      } else {
        const rpcCreate = await clientA.rpc("create_exam_attempt_v2", {
          p_title_snapshot: "V3 Anti-Leak Direct RPC",
          p_primary_study_set_id: setAPrivateId,
          p_sources: [
            {
              source_type: "study_set",
              study_set_id: setAPrivateId,
              subject_title_snapshot: "V3 Sec Private Set A",
              eligible_count: qIds.length,
              allocated_count: qIds.length,
            },
          ],
          p_selected_items: qIds.map((id) => ({ question_id: id })),
          p_config: { question_count: qIds.length },
          p_duration_limit_seconds: 1800,
          p_pass_threshold: 70,
        });
        expect(rpcCreate.error).toBeNull();
        const created = rpcCreate.data as { attempt: { id: string }; questions: unknown[] };
        attemptId = created.attempt.id;
        assertZeroPreSubmitLeaks(created);
      }

      // Direct PostgREST column-revocation checks MUST fail with PostgreSQL 42501!
      const [colPayload, colExplRich, colLegacyKeys, colSafeA, colSafeB] =
        await Promise.all([
          clientA
            .from("exam_attempt_questions")
            .select("id, type_payload_snapshot")
            .eq("attempt_id", attemptId),
          clientA
            .from("exam_attempt_questions")
            .select("id, explanation_rich_snapshot")
            .eq("attempt_id", attemptId),
          clientA
            .from("exam_attempt_questions")
            .select("id, correct_option_ids, accepted_answers_snapshot, explanation_snapshot")
            .eq("attempt_id", attemptId),
          clientA
            .from("exam_attempt_questions")
            .select("id, prompt_snapshot, options_snapshot")
            .eq("attempt_id", attemptId),
          clientB
            .from("exam_attempt_questions")
            .select("id, prompt_snapshot")
            .eq("attempt_id", attemptId),
        ]);

      expect(colPayload.error?.code).toBe("42501");
      expect(colExplRich.error?.code).toBe("42501");
      expect(colLegacyKeys.error?.code).toBe("42501");
      expect(colSafeA.error).toBeNull();
      expect(colSafeA.data).toHaveLength(6);
      expect(colSafeB.data).toHaveLength(0);

      // Submit exam -> verify post-submit payload DOES reveal grading & transcript cleanly
      if (LIVE_API_BASE_URL) {
        const subRes = await apiFetch(
          `/api/exams/${attemptId}/submit`,
          { method: "POST" },
          cookieA,
        );
        expect(subRes.status).toBe(200);
        const subRaw = JSON.stringify(await subRes.json());
        expect(subRaw).toContain(SENTINEL_BLANK);
        expect(subRaw).toContain(SENTINEL_TRANSCRIPT);
        expect(subRaw).toContain(SENTINEL_EXPLANATION);
      }
    }, 45_000);

    it("7. PDF Export Authorization, Exam Anti-Leak (in_progress & discarded) & Vietnamese Filename Safety (V3-SEC-01)", async () => {
      if (!LIVE_API_BASE_URL) return;

      // 1. Viewer B on setASharedViewerId (allow_clone = false) MUST get 403!
      const bCloneDenied = await apiFetch(
        "/api/export/pdf",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            studySetId: setASharedViewerId,
            mode: "question_paper",
          }),
        },
        cookieB,
      );
      expect(bCloneDenied.status).toBe(403);

      // 2. Unrelated User C on setAPrivateId MUST get 403/404!
      const cDenied = await apiFetch(
        "/api/export/pdf",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            studySetId: setAPrivateId,
            mode: "question_paper",
          }),
        },
        cookieC,
      );
      expect([403, 404]).toContain(cDenied.status);

      // 3. Owner A starts an in-progress exam
      const startRes = await apiFetch(
        "/api/exams",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            study_set_id: setAPrivateId,
            question_ids: [qAPrivateBaseId],
            question_count: 1,
          }),
        },
        cookieA,
      );
      expect(startRes.status).toBe(201);
      const attemptId = (
        (await startRes.json()) as { data: { attempt: { id: string } } }
      ).data.attempt.id;

      // In-progress answer key / explanation / review exports MUST be blocked (403)
      const [inProgKey, inProgExplKey, inProgReview, bStealExam] = await Promise.all([
        apiFetch(
          "/api/export/pdf",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ attemptId, mode: "paper_and_key" }),
          },
          cookieA,
        ),
        apiFetch(
          "/api/export/pdf",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ attemptId, mode: "paper_with_explanations" }),
          },
          cookieA,
        ),
        apiFetch(
          "/api/export/pdf",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ attemptId, mode: "incorrect_review" }),
          },
          cookieA,
        ),
        apiFetch(
          "/api/export/pdf",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ attemptId, mode: "question_paper" }),
          },
          cookieB,
        ),
      ]);
      expect(inProgKey.status).toBe(403);
      expect(inProgExplKey.status).toBe(403);
      expect(inProgReview.status).toBe(403);
      expect(bStealExam.status).toBe(404);

      // In-progress question_paper export with Vietnamese title MUST return 200 valid %PDF- (zero 42501 / ByteString crash!)
      const inProgPaper = await apiFetch(
        "/api/export/pdf",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            attemptId,
            mode: "question_paper",
            title: "Đề thi Khí tượng Hàng không",
          }),
        },
        cookieA,
      );
      expect(inProgPaper.status).toBe(200);
      expect(inProgPaper.headers.get("content-type")).toContain("application/pdf");
      expect(inProgPaper.headers.get("cache-control")).toContain("no-store");
      expect(inProgPaper.headers.get("content-disposition")).toContain("filename*=");
      const paperBuf = Buffer.from(await inProgPaper.arrayBuffer());
      expect(paperBuf.subarray(0, 5).toString("ascii")).toBe("%PDF-");

      // Submit attempt -> paper_and_key export with Vietnamese title MUST succeed (200 valid %PDF-)
      const subRes = await apiFetch(
        `/api/exams/${attemptId}/submit`,
        { method: "POST" },
        cookieA,
      );
      expect(subRes.status).toBe(200);

      const submittedKeyPdf = await apiFetch(
        "/api/export/pdf",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            attemptId,
            mode: "paper_and_key",
            title: "Đáp án Ôn tập Tiếng Việt",
          }),
        },
        cookieA,
      );
      expect(submittedKeyPdf.status).toBe(200);
      const subPdfBuf = Buffer.from(await submittedKeyPdf.arrayBuffer());
      expect(subPdfBuf.subarray(0, 5).toString("ascii")).toBe("%PDF-");

      // Discarded attempt MUST also block answer-key export (403)
      const startDiscard = await apiFetch(
        "/api/exams",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            study_set_id: setAPrivateId,
            question_ids: [qAPrivateBaseId],
            question_count: 1,
          }),
        },
        cookieA,
      );
      expect(startDiscard.status).toBe(201);
      const discardedId = (
        (await startDiscard.json()) as { data: { attempt: { id: string } } }
      ).data.attempt.id;

      const { error: discErr } = await admin
        .from("exam_attempts")
        .update({ status: "discarded" })
        .eq("id", discardedId);
      expect(discErr).toBeNull();

      const discardedKeyExport = await apiFetch(
        "/api/export/pdf",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attemptId: discardedId, mode: "paper_and_key" }),
        },
        cookieA,
      );
      expect(discardedKeyExport.status).toBe(403);
    }, 45_000);

    it("8. V3.0 Security Headers (CSP media/worker/manifest, Permissions-Policy, /sw.js no-store) & Unauthenticated V3 Guards", async () => {
      if (!LIVE_API_BASE_URL) return;

      const [homeRes, swRes, manifestRes, diagRedirect] = await Promise.all([
        apiFetch("/"),
        apiFetch("/sw.js"),
        apiFetch("/manifest.webmanifest"),
        apiFetch(`/diagrams/${randomUUID()}/edit`),
      ]);

      expect(homeRes.status).toBe(200);
      const csp = homeRes.headers.get("content-security-policy") ?? "";
      expect(csp).toContain("media-src");
      expect(csp).toContain("worker-src 'self'");
      expect(csp).toContain("manifest-src 'self'");
      expect(csp).toContain("object-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(homeRes.headers.get("permissions-policy")).toContain("microphone=(self)");
      expect(homeRes.headers.get("permissions-policy")).toContain("camera=()");
      expect(homeRes.headers.get("x-content-type-options")).toBe("nosniff");
      expect(homeRes.headers.get("x-frame-options")).toBe("DENY");

      expect(swRes.status).toBe(200);
      const swCc = (swRes.headers.get("cache-control") ?? "").toLowerCase();
      expect(swCc).toContain("no-store");
      expect(swCc).toContain("no-cache");
      expect(swRes.headers.get("service-worker-allowed")).toBe("/");
      expect(swRes.headers.get("x-content-type-options")).toBe("nosniff");

      expect(manifestRes.status).toBe(200);
      const manifestJson = (await manifestRes.json()) as { name?: string };
      expect(manifestJson.name).toBeTruthy();

      expect([302, 307]).toContain(diagRedirect.status);
      expect(diagRedirect.headers.get("location")).toContain("/login");

      // All unauthenticated V3 API endpoints must return 401
      const unauthChecks = await Promise.all([
        apiFetch("/api/notes"),
        apiFetch("/api/reports"),
        apiFetch("/api/checkpoints"),
        apiFetch("/api/media"),
        apiFetch("/api/search?q=aviation"),
        apiFetch("/api/sync/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ events: [] }),
        }),
        apiFetch("/api/export/pdf", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ studySetId: setAPrivateId }),
        }),
        apiFetch("/api/progress/reset", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scope: "all", confirm: "RESET_PROGRESS" }),
        }),
        apiFetch("/api/uploads/audio", { method: "POST" }),
      ]);

      for (const res of unauthChecks) {
        expect(res.status).toBe(401);
      }
    }, 30_000);
  },
);
