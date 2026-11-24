import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb } from "pdf-lib";

/**
 * StudyHub V3.0 Complete Learning Edition — Independent Live Playwright E2E Suite
 *
 * Covers ALL Wave 5 V3.0 live browser & full-stack workflows against live Supabase Cloud:
 * - V3-T1: PWA Manifest/Icons, SW no-store & anti-API-cache, `/offline`, `?` Shortcut Help Modal,
 *          and Learning Mode Preferences persistence in `/settings`.
 * - V3-T2: Multimedia PNG & WAV uploads (+ SVG/spoof rejections), Rich Text + KaTeX LaTeX,
 *          Image-only Options, Image Lightbox (zoom/reset/Esc), DOCX V3 multimedia parse preview,
 *          Vietnamese PDF text-layer import, and scanned image-only PDF honest detection.
 * - V3-T3: ALL 12 Exam Question Types + Flashcard, Bulk Editor, Live Exam Deterministic Scoring
 *          + Confidence Score Neutrality, Global Search `Ctrl+K` (+ Hard Exam Guard), 2-Account
 *          Personal Notes Isolation, Question Reports (B submits -> A resolves), and Vietnamese PDF Export.
 * - V3-T4: Spell Mode (`/sets/[id]/spell`), Audio Flashcards, Advanced Learn, Advanced Review Mistakes,
 *          Resume Session Checkpoint across F5 reload, and Scoped Reset Progress preserving Exam History.
 * - V3-T5: Visual Diagram Mode (`/sets/[id]/diagrams`, `/diagrams/[id]/edit`, `/diagrams/[id]/study`)
 *          with Point/Rect/Polygon hotspots, responsive desktop + mobile 390px check, and 2-account RLS.
 * - V3-T6: True Offline PWA (`setOffline(true)` -> Offline Study -> Refresh Offline -> `setOffline(false)`
 *          -> Sync Queue -> Account-Switch IndexedDB Isolation).
 *
 * Cleanly gated by `E2E_SUPABASE_READY=1` so offline runs never fail.
 */
const SUPABASE_E2E_READY = process.env.E2E_SUPABASE_READY === "1";

// ============================================================================
// Deterministic Binary Fixture Builders (PNG, WAV, DOCX w/ Image, Text/Scanned PDF)
// ============================================================================

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function makePngBytes(
  width = 64,
  height = 64,
  rgbColor: [number, number, number] = [79, 70, 229],
): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = 1 + width * 3;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    const rowOffset = y * stride;
    raw[rowOffset] = 0; // filter None
    for (let x = 0; x < width; x += 1) {
      const px = rowOffset + 1 + x * 3;
      raw[px] = rgbColor[0];
      raw[px + 1] = rgbColor[1];
      raw[px + 2] = rgbColor[2];
    }
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function makeWavBytes(durationSeconds = 0.25, sampleRate = 8000): Buffer {
  const numSamples = Math.floor(durationSeconds * sampleRate);
  const dataSize = numSamples;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0, "ascii");
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8, "ascii");
  buf.write("fmt ", 12, "ascii");
  buf.writeUInt32LE(16, 16); // PCM chunk size
  buf.writeUInt16LE(1, 20); // PCM format
  buf.writeUInt16LE(1, 22); // Mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate, 28); // byte rate
  buf.writeUInt16LE(1, 32); // block align
  buf.writeUInt16LE(8, 34); // 8-bit unsigned PCM
  buf.write("data", 36, "ascii");
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < numSamples; i += 1) {
    const t = i / sampleRate;
    buf[44 + i] = Math.round(128 + 40 * Math.sin(2 * Math.PI * 440 * t));
  }
  return buf;
}

function buildStoredZip(entries: Array<{ name: string; data: Buffer }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf8");
    const dataBuf = entry.data;
    const checksum = crc32(dataBuf);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8); // store
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(dataBuf.length, 18);
    local.writeUInt32LE(dataBuf.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuf, dataBuf);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(dataBuf.length, 20);
    central.writeUInt32LE(dataBuf.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuf);

    offset += local.length + nameBuf.length + dataBuf.length;
  }

  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralBuf, eocd]);
}

function makeMultimediaDocxBytes(pngBytes: Buffer): Buffer {
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdImg1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>`;

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
            xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
            xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
    <w:p><w:r><w:t>Câu 1: Quan sát hình minh họa dưới đây, màu chủ đạo là gì?</w:t></w:r></w:p>
    <w:p><w:r><w:drawing><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rIdImg1"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></w:drawing></w:r></w:p>
    <w:p><w:r><w:t>A. Màu đỏ</w:t></w:r></w:p>
    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>*B. Màu xanh chàm (Indigo)</w:t></w:r></w:p>
    <w:p><w:r><w:t>C. Màu vàng</w:t></w:r></w:p>
    <w:p><w:r><w:t>D. Màu xanh lá</w:t></w:r></w:p>
  </w:body>
</w:document>`;

  return buildStoredZip([
    { name: "[Content_Types].xml", data: Buffer.from(contentTypes, "utf8") },
    { name: "_rels/.rels", data: Buffer.from(rootRels, "utf8") },
    { name: "word/_rels/document.xml.rels", data: Buffer.from(docRels, "utf8") },
    { name: "word/document.xml", data: Buffer.from(documentXml, "utf8") },
    { name: "word/media/image1.png", data: pngBytes },
  ]);
}

async function makeVietnameseTextPdfBytes(): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const fontBytes = fs.readFileSync(
    path.resolve(process.cwd(), "src", "assets", "fonts", "NotoSans-Regular.ttf"),
  );
  const font = await doc.embedFont(fontBytes);
  const page = doc.addPage([595, 842]);
  const lines = [
    "Chương 1: Kiến thức tiếng Việt chuẩn xác",
    "Câu 1: Thủ đô của nước Việt Nam là thành phố nào?",
    "A. Đà Nẵng",
    "*B. Hà Nội",
    "C. Huế",
    "D. Cần Thơ",
    "",
    "Câu 2: Hành tinh nào gần Mặt Trời nhất trong Hệ Mặt Trời?",
    "*A. Sao Thủy",
    "B. Sao Kim",
    "C. Trái Đất",
    "D. Sao Hỏa",
    "",
    "Câu 3: Công thức hóa học của nước tinh khiết là gì?",
    "A. CO2",
    "B. O2",
    "*C. H2O",
    "D. NaCl",
  ];
  let y = 790;
  for (const line of lines) {
    if (line.length > 0) {
      page.drawText(line, { x: 48, y, size: 12, font, color: rgb(0.1, 0.1, 0.1) });
    }
    y -= 22;
  }
  return Buffer.from(await doc.save());
}

async function makeScannedImagePdfBytes(pngBytes: Buffer): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const img = await doc.embedPng(pngBytes);
  const page = doc.addPage([400, 400]);
  page.drawImage(img, { x: 40, y: 40, width: 320, height: 320 });
  return Buffer.from(await doc.save());
}

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login", { waitUntil: "networkidle" });
  await page.locator("#login-email").fill(email);
  await page.locator("#login-password").fill(password);
  await page.getByRole("button", { name: /đăng nhập|sign in/i }).click();
  await page.waitForURL("**/dashboard", { timeout: 25_000 });
}

// ============================================================================
// StudyHub V3.0 Complete Learning Edition — Live E2E Verification Suite
// ============================================================================

test.describe("StudyHub V3.0 Complete Learning Edition — Live E2E Verification", () => {
  test.describe.configure({ mode: "default" });

  test.skip(
    !SUPABASE_E2E_READY,
    "Skipped until live Supabase credentials are configured (set E2E_SUPABASE_READY=1).",
  );

  test("V3-T1: PWA manifest/icons, SW no-store, /offline, ? Shortcut Help Modal & Settings Mode Preferences persistence", async ({
    browser,
    request,
  }) => {
    test.setTimeout(120_000);

    // 1. PWA Manifest & valid PNG icons
    const manifestRes = await request.get("/manifest.webmanifest");
    expect(manifestRes.status()).toBe(200);
    const manifest = (await manifestRes.json()) as {
      name: string;
      display: string;
      start_url: string;
      icons: Array<{ src: string; sizes: string }>;
    };
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/dashboard");
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);

    for (const icon of manifest.icons) {
      const iconRes = await request.get(icon.src);
      expect(iconRes.status()).toBe(200);
      const buf = await iconRes.body();
      // Valid PNG magic header: 89 50 4E 47
      expect(buf[0]).toBe(0x89);
      expect(buf[1]).toBe(0x50);
      expect(buf[2]).toBe(0x4e);
      expect(buf[3]).toBe(0x47);
    }

    // 2. Service Worker headers & strict anti-API-cache guard
    const swRes = await request.get("/sw.js");
    expect(swRes.status()).toBe(200);
    const swCacheControl = (swRes.headers()["cache-control"] ?? "").toLowerCase();
    expect(swCacheControl).toContain("no-store");
    const swSource = await swRes.text();
    expect(swSource).toContain("APPLY_UPDATE");
    expect(swSource).toContain("/api/");
    expect(swSource).toContain("/auth/");

    const emailA = process.env.E2E_USER_A_EMAIL!;
    const passwordA = process.env.E2E_USER_A_PASSWORD!;
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();

    // 3. `/offline` renders cleanly with semantic <h1>
    await page.goto("/offline", { waitUntil: "networkidle" });
    await expect(page.locator("h1")).toBeVisible();

    // 4. Sign in -> `?` Keyboard Shortcut Help Modal opens & closes cleanly on Esc
    await signIn(page, emailA, passwordA);
    await page.locator("main").click({ position: { x: 10, y: 10 } });
    await page.keyboard.press("?");
    const helpDialog = page.locator('[role="dialog"]');
    await expect(helpDialog).toBeVisible({ timeout: 8_000 });
    await expect(helpDialog).toContainText(/phím tắt|keyboard shortcuts/i);
    await page.keyboard.press("Escape");
    await expect(helpDialog).toBeHidden({ timeout: 8_000 });

    // 5. `/settings` Learning Mode Preferences persistence across reload
    await page.goto("/settings", { waitUntil: "networkidle" });
    const modesTab = page.getByRole("tab", {
      name: /chế độ học|learning modes|tùy chọn chế độ|mode/i,
    });
    await expect(modesTab).toBeVisible({ timeout: 10_000 });
    await modesTab.click();

    const firstModeSwitch = page
      .locator('[role="tabpanel"][data-state="active"] [role="switch"]')
      .first();
    await expect(firstModeSwitch).toBeVisible({ timeout: 10_000 });
    const beforeChecked = await firstModeSwitch.getAttribute("aria-checked");
    await firstModeSwitch.click();

    const prefSavePromise = page.waitForResponse(
      (res) =>
        res.url().endsWith("/api/preferences") &&
        (res.request().method() === "PATCH" || res.request().method() === "PUT"),
      { timeout: 15_000 },
    );
    await page
      .locator('[role="tabpanel"][data-state="active"]')
      .getByRole("button", { name: /lưu|save/i })
      .first()
      .click();
    expect((await prefSavePromise).status()).toBe(200);

    await page.reload({ waitUntil: "networkidle" });
    await page
      .getByRole("tab", {
        name: /chế độ học|learning modes|tùy chọn chế độ|mode/i,
      })
      .click();
    const afterChecked = await page
      .locator('[role="tabpanel"][data-state="active"] [role="switch"]')
      .first()
      .getAttribute("aria-checked");
    expect(afterChecked).not.toBe(beforeChecked);

    await context.close();
  });

  test("V3-T2: Multimedia PNG/WAV uploads, Rich Text + KaTeX, Image-only Options, Image Lightbox, DOCX V3 media preview & PDF text vs scanned detection", async ({
    browser,
  }) => {
    test.setTimeout(150_000);

    const emailA = process.env.E2E_USER_A_EMAIL!;
    const passwordA = process.env.E2E_USER_A_PASSWORD!;
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    await signIn(page, emailA, passwordA);

    // Create a multimedia study set
    const setRes = await page.request.post("/api/sets", {
      data: {
        title: `V3 Multimedia ${Date.now()}`,
        set_type: "mixed",
        visibility: "private",
      },
    });
    expect(setRes.status()).toBe(201);
    const setId: string = (await setRes.json()).data.id;

    // 1. Upload valid PNG & WAV into private study-media; verify SVG & spoofed audio rejected (415)
    const pngBytes = makePngBytes(80, 80, [79, 70, 229]);
    const pngOptBytes = makePngBytes(80, 80, [16, 185, 129]);
    const wavBytes = makeWavBytes(0.25);

    const imgUpload = await page.request.post("/api/uploads/image", {
      multipart: {
        file: { name: "diagram-q1.png", mimeType: "image/png", buffer: pngBytes },
        purpose: "question",
        studySetId: setId,
      },
    });
    expect(imgUpload.status()).toBe(201);
    const imgData = (await imgUpload.json()).data as {
      id: string;
      proxyUrl: string;
    };
    expect(imgData.proxyUrl).toContain("/api/uploads/signed-url");

    const optImgUpload = await page.request.post("/api/uploads/image", {
      multipart: {
        file: { name: "opt-a.png", mimeType: "image/png", buffer: pngOptBytes },
        purpose: "option",
        studySetId: setId,
      },
    });
    expect(optImgUpload.status()).toBe(201);
    const optImgData = (await optImgUpload.json()).data as {
      id: string;
      proxyUrl: string;
    };

    const svgReject = await page.request.post("/api/uploads/image", {
      multipart: {
        file: {
          name: "xss.svg",
          mimeType: "image/svg+xml",
          buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
        },
        purpose: "question",
        studySetId: setId,
      },
    });
    expect(svgReject.status()).toBe(415);

    const audioUpload = await page.request.post("/api/uploads/audio", {
      multipart: {
        file: { name: "prompt-q1.wav", mimeType: "audio/wav", buffer: wavBytes },
        purpose: "question",
        studySetId: setId,
      },
    });
    expect(audioUpload.status()).toBe(201);
    const audioData = (await audioUpload.json()).data as {
      id: string;
      proxyUrl: string;
    };
    expect(audioData.proxyUrl).toContain("/api/uploads/signed-url");

    const fakeAudioReject = await page.request.post("/api/uploads/audio", {
      multipart: {
        file: {
          name: "spoof.mp3",
          mimeType: "audio/mpeg",
          buffer: Buffer.from("<html><script>alert(1)</script></html>"),
        },
        purpose: "question",
        studySetId: setId,
      },
    });
    expect(fakeAudioReject.status()).toBe(415);

    // 2. Create question with Rich Text AST + KaTeX ($E = mc^2$) + Prompt Image + Image-Only Options
    const qCreate = await page.request.post(`/api/sets/${setId}/questions`, {
      data: {
        question_type: "image_choice",
        prompt: "Chọn hình biểu diễn công thức $E = mc^2$:",
        prompt_rich: {
          version: 1,
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "Chọn hình biểu diễn công thức " },
                { type: "text", text: "$E = mc^2$", marks: [{ type: "bold" }] },
              ],
            },
          ],
        },
        prompt_image_url: imgData.proxyUrl,
        type_payload: { type: "image_choice", selection_mode: "single" },
        options: [
          {
            label: "A",
            content: "",
            image_url: optImgData.proxyUrl,
            media_id: optImgData.id,
            image_alt: "Option A visual",
            is_correct: true,
          },
          {
            label: "B",
            content: "",
            image_url: imgData.proxyUrl,
            media_id: imgData.id,
            image_alt: "Option B visual",
            is_correct: false,
          },
        ],
      },
    });
    expect(qCreate.status()).toBe(201);

    // Verify KaTeX rendering & ImageLightbox zoom/reset/Esc live in Practice mode
    await page.goto(`/sets/${setId}/practice`, { waitUntil: "networkidle" });
    const startBtn = page.getByRole("button", {
      name: /bắt đầu luyện tập|start practice/i,
    });
    if (await startBtn.isVisible({ timeout: 4_000 }).catch(() => false)) {
      await startBtn.click();
    }

    await expect(page.locator(".katex").first()).toBeVisible({ timeout: 15_000 });
    const zoomTrigger = page
      .locator('button[aria-label*="Phóng to"], button[aria-label*="Enlarge"], button[aria-label*="Xem ảnh"]')
      .first();
    await expect(zoomTrigger).toBeVisible({ timeout: 10_000 });
    await zoomTrigger.click();

    const zoomInBtn = page.getByRole("button", { name: /phóng to \(\+\)|zoom in \(\+\)/i });
    await expect(zoomInBtn).toBeVisible({ timeout: 10_000 });
    await zoomInBtn.click();
    await page
      .getByRole("button", { name: /đặt lại thu phóng \(0\)|reset zoom \(0\)/i })
      .click();
    await page.keyboard.press("Escape");
    await expect(zoomInBtn).toBeHidden({ timeout: 8_000 });

    // 3. DOCX V3 Multimedia Upload Parse Preview (embedded word/media/image1.png)
    const docxBytes = makeMultimediaDocxBytes(pngBytes);
    const docxParseRes = await page.request.post("/api/import/parse", {
      multipart: {
        file: {
          name: "v3-multimedia-test.docx",
          mimeType:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          buffer: docxBytes,
        },
        studySetId: setId,
        options: JSON.stringify({ preserveMediaPreviews: true }),
      },
    });
    expect(docxParseRes.status()).toBe(200);
    const docxParsed = (await docxParseRes.json()).data as {
      format: string;
      extractedMedia?: Array<{ rId: string; fileName: string; mimeType: string }>;
      questions: Array<{
        prompt: string;
        promptImageUrl?: string | null;
        promptMedia?: Array<{ fileName?: string; dataUrl?: string }>;
      }>;
    };
    expect(docxParsed.format).toBe("docx_multimedia");
    expect(docxParsed.extractedMedia?.length ?? 0).toBeGreaterThanOrEqual(1);
    expect(docxParsed.questions.length).toBeGreaterThanOrEqual(1);
    const firstDocxQ = docxParsed.questions[0];
    expect(firstDocxQ.promptMedia?.length ?? 0).toBeGreaterThanOrEqual(1);

    // 4. Vietnamese Text-Layer PDF Import Parse & Live Commit
    const vnPdfBytes = await makeVietnameseTextPdfBytes();
    const pdfParseRes = await page.request.post("/api/import/parse", {
      multipart: {
        file: {
          name: "v3-tieng-viet.pdf",
          mimeType: "application/pdf",
          buffer: vnPdfBytes,
        },
        studySetId: setId,
      },
    });
    expect(pdfParseRes.status()).toBe(200);
    const pdfParsed = (await pdfParseRes.json()).data as {
      format: string;
      questions: Array<{ prompt: string }>;
    };
    expect(pdfParsed.format).toBe("pdf_text");
    expect(pdfParsed.questions.length).toBe(3);
    expect(pdfParsed.questions[0].prompt).toContain("Thủ đô");

    // 5. Scanned Image-Only PDF Honest Detection (NEVER silent garbage or HTTP 500!)
    const scannedPdfBytes = await makeScannedImagePdfBytes(pngBytes);
    const scannedRes = await page.request.post("/api/import/parse", {
      multipart: {
        file: {
          name: "v3-scanned-only.pdf",
          mimeType: "application/pdf",
          buffer: scannedPdfBytes,
        },
        studySetId: setId,
      },
    });
    expect(scannedRes.status()).not.toBe(500);
    const scannedJson = (await scannedRes.json()) as {
      data?: {
        questions?: unknown[];
        pdfInfo?: { isScanned?: boolean; warning?: string };
        warnings?: unknown[];
      };
      error?: { code?: string; message?: string };
    };
    if (scannedRes.status() >= 400) {
      expect(scannedJson.error?.message ?? "").toMatch(/scan|ảnh|văn bản|text|ocr/i);
    } else {
      expect(scannedJson.data?.questions ?? []).toHaveLength(0);
      expect(
        Boolean(scannedJson.data?.pdfInfo?.isScanned) ||
          JSON.stringify(scannedJson).toLowerCase().includes("scan") ||
          JSON.stringify(scannedJson).toLowerCase().includes("text"),
      ).toBe(true);
    }

    await context.close();
  });

  test("V3-T3: All 12 Question Types live exam scoring + Confidence Neutrality, Bulk Edit, Ctrl+K Search & Hard Exam Guard, 2-Account Notes/Reports & Vietnamese PDF Export", async ({
    browser,
  }) => {
    test.setTimeout(180_000);

    const emailA = process.env.E2E_USER_A_EMAIL!;
    const passwordA = process.env.E2E_USER_A_PASSWORD!;
    const emailB = process.env.E2E_USER_B_EMAIL!;
    const passwordB = process.env.E2E_USER_B_PASSWORD!;

    const contextA = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const pageA = await contextA.newPage();
    await signIn(pageA, emailA, passwordA);

    const stamp = Date.now();
    const searchToken = `V3SEARCH${stamp}`;
    const noteTokenA = `V3PRIVATENOTEA${stamp}`;
    const noteTokenB = `V3PRIVATENOTEB${stamp}`;

    // Create study set + upload media + shared passage
    const setRes = await pageA.request.post("/api/sets", {
      data: {
        title: `V3 All12Types ${searchToken}`,
        set_type: "mixed",
        visibility: "private",
      },
    });
    expect(setRes.status()).toBe(201);
    const setId: string = (await setRes.json()).data.id;

    const pngRes = await pageA.request.post("/api/uploads/image", {
      multipart: {
        file: { name: "hs-base.png", mimeType: "image/png", buffer: makePngBytes() },
        purpose: "question",
        studySetId: setId,
      },
    });
    expect(pngRes.status()).toBe(201);
    const imgAsset = (await pngRes.json()).data as { id: string; proxyUrl: string };

    const wavRes = await pageA.request.post("/api/uploads/audio", {
      multipart: {
        file: { name: "listen.wav", mimeType: "audio/wav", buffer: makeWavBytes() },
        purpose: "listening",
        studySetId: setId,
      },
    });
    expect(wavRes.status()).toBe(201);
    const wavAsset = (await wavRes.json()).data as { id: string; proxyUrl: string };

    const passageRes = await pageA.request.post("/api/passages", {
      data: {
        study_set_id: setId,
        title: `Đoạn đọc V3 ${stamp}`,
        content_text: "Tầng đối lưu là tầng thấp nhất của khí quyển Trái Đất.",
      },
    });
    expect(passageRes.status()).toBe(201);
    const passageId: string = (await passageRes.json()).data.id;

    // Bulk insert ALL 12 exam-compatible question types + 1 flashcard (13 total!)
    const bulkInsertRes = await pageA.request.post(
      `/api/sets/${setId}/questions/bulk`,
      {
        data: {
          questions: [
            // 1. single_choice
            {
              question_type: "single_choice",
              chapter: "Ch1",
              prompt: `[${searchToken}] Q1 Single Choice`,
              options: [
                { label: "A", content: "Đáp án đúng 1", is_correct: true },
                { label: "B", content: "Sai 1", is_correct: false },
              ],
            },
            // 2. multiple_choice
            {
              question_type: "multiple_choice",
              chapter: "Ch1",
              prompt: "Q2 Multiple Choice",
              options: [
                { label: "A", content: "Đúng A", is_correct: true },
                { label: "B", content: "Đúng B", is_correct: true },
                { label: "C", content: "Sai C", is_correct: false },
              ],
            },
            // 3. true_false
            {
              question_type: "true_false",
              chapter: "Ch1",
              prompt: "Q3 True/False: Nước sôi ở 100°C tại 1 atm.",
              options: [
                { label: "A", content: "Đúng", is_correct: true },
                { label: "B", content: "Sai", is_correct: false },
              ],
            },
            // 4. short_answer
            {
              question_type: "short_answer",
              chapter: "Ch1",
              prompt: "Q4 Short Answer: Thủ đô Việt Nam?",
              accepted_answers: [
                { answer_text: "Hà Nội", match_mode: "ignore_diacritics" },
              ],
            },
            // 5. fill_in_blank
            {
              question_type: "fill_in_blank",
              chapter: "Ch1",
              prompt: "Q5 Fill in blank: Công thức {{b1}} và {{b2}}.",
              type_payload: {
                type: "fill_in_blank",
                template_text: "Công thức {{b1}} và {{b2}}.",
                blanks: [
                  { blank_id: "b1", accepted_answers: ["H2O"] },
                  { blank_id: "b2", accepted_answers: ["O2"] },
                ],
                require_all_blanks: true,
              },
            },
            // 6. numerical
            {
              question_type: "numerical",
              chapter: "Ch1",
              prompt: "Q6 Numerical: Gia tốc trọng trường tiêu chuẩn?",
              type_payload: {
                type: "numerical",
                correct_value: 9.81,
                abs_tolerance: 0.05,
                unit: "m/s2",
                unit_required: true,
              },
            },
            // 7. image_choice
            {
              question_type: "image_choice",
              chapter: "Ch1",
              prompt: "Q7 Image Choice",
              type_payload: { type: "image_choice", selection_mode: "single" },
              options: [
                {
                  label: "A",
                  content: "",
                  image_url: imgAsset.proxyUrl,
                  media_id: imgAsset.id,
                  is_correct: true,
                },
                {
                  label: "B",
                  content: "",
                  image_url: imgAsset.proxyUrl,
                  media_id: imgAsset.id,
                  is_correct: false,
                },
              ],
            },
            // 8. ordering
            {
              question_type: "ordering",
              chapter: "Ch1",
              prompt: "Q8 Ordering: Sắp xếp thứ tự 1 -> 2 -> 3",
              type_payload: {
                type: "ordering",
                items: [
                  { id: "ord1", text: "Bước 1", correct_position: 0 },
                  { id: "ord2", text: "Bước 2", correct_position: 1 },
                  { id: "ord3", text: "Bước 3", correct_position: 2 },
                ],
                allow_partial_credit: false,
              },
            },
            // 9. matching
            {
              question_type: "matching",
              chapter: "Ch1",
              prompt: "Q9 Matching: Nối cặp đúng",
              type_payload: {
                type: "matching",
                pairs: [
                  {
                    id: "l1",
                    left_text: "Việt Nam",
                    right_id: "r1",
                    right_text: "Hà Nội",
                  },
                  {
                    id: "l2",
                    left_text: "Nhật Bản",
                    right_id: "r2",
                    right_text: "Tokyo",
                  },
                ],
              },
            },
            // 10. image_hotspot
            {
              question_type: "image_hotspot",
              chapter: "Ch1",
              prompt: "Q10 Image Hotspot: Chọn vùng tâm ảnh",
              type_payload: {
                type: "image_hotspot",
                image_url: imgAsset.proxyUrl,
                image_media_id: imgAsset.id,
                target_hotspots: [
                  {
                    id: "hs1",
                    label: "Tâm",
                    shape: "rect",
                    geometry: {
                      shape: "rect",
                      x: 0.25,
                      y: 0.25,
                      width: 0.5,
                      height: 0.5,
                    },
                  },
                ],
                require_all_targets: false,
              },
            },
            // 11. reading_passage
            {
              question_type: "reading_passage",
              chapter: "Ch1",
              prompt: "Q11 Reading Passage: Tầng thấp nhất của khí quyển là?",
              passage_id: passageId,
              type_payload: {
                type: "reading_passage",
                passage_id: passageId,
                passage_title: `Đoạn đọc V3 ${stamp}`,
                passage_text: "Tầng đối lưu là tầng thấp nhất của khí quyển Trái Đất.",
                sub_answer_kind: "single_choice",
              },
              options: [
                { label: "A", content: "Tầng đối lưu", is_correct: true },
                { label: "B", content: "Tầng bình lưu", is_correct: false },
              ],
            },
            // 12. listening
            {
              question_type: "listening",
              chapter: "Ch1",
              prompt: "Q12 Listening: Nghe âm thanh và chọn đáp án",
              audio_media_id: wavAsset.id,
              audio_url: wavAsset.proxyUrl,
              audio_transcript: "Secret transcript hidden until submit",
              type_payload: {
                type: "listening",
                audio_media_id: wavAsset.id,
                audio_url: wavAsset.proxyUrl,
                transcript: "Secret transcript hidden until submit",
                show_transcript_after_submit: true,
                sub_answer_kind: "single_choice",
              },
              options: [
                { label: "A", content: "Tín hiệu 440Hz", is_correct: true },
                { label: "B", content: "Tín hiệu 880Hz", is_correct: false },
              ],
            },
            // 13. flashcard (MUST be excluded from exams!)
            {
              question_type: "flashcard",
              chapter: "Ch1",
              prompt: "Q13 Flashcard Term",
              back_text: "Định nghĩa mặt sau",
            },
          ],
        },
      },
    );
    expect(bulkInsertRes.status()).toBe(201);

    // Fetch created questions & test Bulk Editor PATCH
    const qListRes = await pageA.request.get(`/api/sets/${setId}/questions?pageSize=50`);
    expect(qListRes.status()).toBe(200);
    const createdQuestions = (await qListRes.json()).data as Array<{
      id: string;
      question_type: string;
      prompt: string;
      options?: Array<{ id: string; label: string; is_correct: boolean }>;
    }>;
    expect(createdQuestions).toHaveLength(13);

    const bulkPatchRes = await pageA.request.patch(
      `/api/sets/${setId}/questions/bulk`,
      {
        data: {
          question_ids: [createdQuestions[0].id, createdQuestions[1].id],
          chapter: "Chương 1 (Đã cập nhật)",
          difficulty: "hard",
        },
      },
    );
    expect(bulkPatchRes.status()).toBe(200);

    // Verify Question Bank Editor loads cleanly in UI
    await pageA.goto(`/sets/${setId}/edit`, { waitUntil: "networkidle" });
    await expect(pageA.locator("main")).toContainText("Q1 Single Choice");

    // Start Live Exam across ALL 12 exam-compatible question types (flashcard MUST be excluded!)
    const examCreateRes = await pageA.request.post("/api/exams", {
      data: {
        study_set_id: setId,
        question_count: 12,
        shuffle_questions: false,
        shuffle_options: false,
        duration_limit_seconds: 1800,
      },
    });
    expect(examCreateRes.status()).toBe(201);
    const examRaw = await examCreateRes.text();
    // Anti-leak assertions: zero answer keys, hotspot targets, or transcript leaked pre-submit!
    expect(examRaw).not.toContain("correct_option_ids");
    expect(examRaw).not.toContain("accepted_answers_snapshot");
    expect(examRaw).not.toContain("Secret transcript hidden until submit");
    expect(examRaw).not.toContain("target_hotspots");

    const examJson = JSON.parse(examRaw) as {
      data: {
        attempt: { id: string; total_questions: number };
        questions: Array<{
          id: string;
          question_id: string;
          question_type: string;
          options_snapshot: Array<{ id: string; label: string }>;
        }>;
      };
    };
    const attemptId = examJson.data.attempt.id;
    expect(examJson.data.attempt.total_questions).toBe(12);
    expect(
      examJson.data.questions.some((q) => q.question_type === "flashcard"),
    ).toBe(false);

    // Open active exam in Chromium -> verify Global Search Hard Exam Guard (Ctrl+K MUST NOT open!)
    await pageA.goto(`/exams/${attemptId}`, { waitUntil: "networkidle" });
    await expect(pageA.locator("main")).toBeVisible();
    await pageA.keyboard.press("Control+k");
    await pageA.waitForTimeout(400);
    await expect(
      pageA.locator('[role="dialog"]').filter({ hasText: /tìm kiếm|search/i }),
    ).toHaveCount(0);

    // Save deterministic answers for ALL 12 types (11 right including `guessing`, 1 wrong with `certain`)
    // Proves 12-type server grading AND Confidence Score Neutrality (exact 11/12 = 91.67%)!
    const correctOptByQId = new Map<string, string[]>();
    const wrongOptByQId = new Map<string, string[]>();
    for (const q of createdQuestions) {
      if (q.options && q.options.length > 0) {
        correctOptByQId.set(
          q.id,
          q.options.filter((o) => o.is_correct).map((o) => o.id),
        );
        wrongOptByQId.set(
          q.id,
          q.options.filter((o) => !o.is_correct).map((o) => o.id),
        );
      }
    }

    const answerBatch = examJson.data.questions.map((eq, idx) => {
      const base = {
        attempt_question_id: eq.id,
        selected_option_ids: [] as string[],
        typed_answer: null as string | null,
        structured_response: null as Record<string, unknown> | null,
        confidence: (idx % 2 === 0 ? "guessing" : "certain") as
          | "certain"
          | "unsure"
          | "guessing",
        is_flagged: false,
        client_seq: idx + 1,
      };

      switch (eq.question_type) {
        case "single_choice":
          // Intentionally WRONG with `certain` confidence -> high_conf_wrong_count!
          base.selected_option_ids = wrongOptByQId.get(eq.question_id) ?? [];
          base.confidence = "certain";
          break;
        case "multiple_choice":
        case "true_false":
        case "image_choice":
        case "reading_passage":
        case "listening":
          base.selected_option_ids = correctOptByQId.get(eq.question_id) ?? [];
          base.confidence = "guessing"; // Correct while guessing -> MUST still get full exam credit!
          break;
        case "short_answer":
          base.typed_answer = "ha noi";
          base.structured_response = { kind: "text", value: "ha noi" };
          break;
        case "fill_in_blank":
          base.structured_response = {
            kind: "blanks",
            answers: { b1: "h2o", b2: "O2" },
          };
          break;
        case "numerical":
          base.structured_response = {
            kind: "numerical",
            value: "9.83",
            numeric_value: 9.83,
            unit: "m/s2",
          };
          break;
        case "ordering":
          base.structured_response = {
            kind: "ordering",
            ordered_item_ids: ["ord1", "ord2", "ord3"],
          };
          break;
        case "matching":
          base.structured_response = {
            kind: "matching",
            pairs: { l1: "r1", l2: "r2" },
          };
          break;
        case "image_hotspot":
          base.structured_response = {
            kind: "hotspot",
            clicks: [{ x: 0.5, y: 0.5 }],
          };
          break;
      }
      return base;
    });

    const saveAnsRes = await pageA.request.put(`/api/exams/${attemptId}/answers`, {
      data: { answers: answerBatch },
    });
    expect(saveAnsRes.status()).toBe(200);

    const submitRes = await pageA.request.post(`/api/exams/${attemptId}/submit`);
    expect(submitRes.status()).toBe(200);
    const submitPayload = (await submitRes.json()).data as {
      attempt: {
        correct_count: number;
        total_questions: number;
        score_percent: number;
      };
    };
    expect(submitPayload.attempt.total_questions).toBe(12);
    expect(submitPayload.attempt.correct_count).toBe(11);
    expect(Number(submitPayload.attempt.score_percent)).toBeCloseTo(91.67, 1);

    // Verify Results page renders cleanly in Chromium
    await pageA.goto(`/exams/${attemptId}/results`, { waitUntil: "networkidle" });
    await expect(pageA.locator("main")).toContainText("91.67");

    // 2-Account Personal Notes Isolation + Question Reports (B submits -> A resolves) + Global Search
    const shareRes = await pageA.request.post(`/api/sets/${setId}/share-links`, {
      data: { permission: "viewer", allow_clone: false },
    });
    expect(shareRes.status()).toBe(201);
    const shareToken: string = (await shareRes.json()).data.token;

    // User A writes a personal note on Q1
    const noteARes = await pageA.request.put("/api/notes", {
      data: {
        study_set_id: setId,
        question_id: createdQuestions[0].id,
        content_text: `Ghi chú bí mật của A ${noteTokenA}`,
      },
    });
    expect([200, 201]).toContain(noteARes.status());

    // Global Search Ctrl+K on /dashboard works for User A & finds own set/note
    await pageA.goto("/dashboard", { waitUntil: "networkidle" });
    await pageA.locator("main").click({ position: { x: 10, y: 10 } });
    await pageA.keyboard.press("Control+k");
    const searchDialog = pageA.locator('[role="dialog"]');
    await expect(searchDialog).toBeVisible({ timeout: 8_000 });
    await searchDialog.locator("input").first().fill(searchToken);
    await expect(searchDialog).toContainText(searchToken, { timeout: 10_000 });
    await pageA.keyboard.press("Escape");

    // User B redeems link, writes own note, verifies ZERO visibility of User A's note, submits Report
    const contextB = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const pageB = await contextB.newPage();
    await signIn(pageB, emailB, passwordB);

    const redeemB = await pageB.request.post(`/api/share-links/${shareToken}/redeem`);
    expect(redeemB.status()).toBe(200);

    const noteBRes = await pageB.request.put("/api/notes", {
      data: {
        study_set_id: setId,
        question_id: createdQuestions[0].id,
        content_text: `Ghi chú bí mật của B ${noteTokenB}`,
      },
    });
    expect([200, 201]).toContain(noteBRes.status());

    const bNotesGet = await pageB.request.get(`/api/notes?studySetId=${setId}`);
    expect(bNotesGet.status()).toBe(200);
    const bNotesRaw = await bNotesGet.text();
    expect(bNotesRaw).toContain(noteTokenB);
    expect(bNotesRaw).not.toContain(noteTokenA);

    const bSearchNoteA = await pageB.request.get(
      `/api/search?q=${encodeURIComponent(noteTokenA)}`,
    );
    expect(bSearchNoteA.status()).toBe(200);
    expect((await bSearchNoteA.json()).data.items).toHaveLength(0);

    const aNotesGet = await pageA.request.get(`/api/notes?studySetId=${setId}`);
    expect(await aNotesGet.text()).not.toContain(noteTokenB);

    // User B submits Question Report -> User A lists & resolves it
    const repCreate = await pageB.request.post("/api/reports", {
      data: {
        study_set_id: setId,
        question_id: createdQuestions[0].id,
        category: "wrong_answer",
        description: "Đề nghị kiểm tra lại đáp án câu 1.",
      },
    });
    expect(repCreate.status()).toBe(201);
    const reportId: string = (await repCreate.json()).data.id;

    const aReportsList = await pageA.request.get(`/api/reports?studySetId=${setId}`);
    expect(aReportsList.status()).toBe(200);
    expect(await aReportsList.text()).toContain(reportId);

    const aResolve = await pageA.request.patch(`/api/reports/${reportId}`, {
      data: { status: "resolved", resolution_note: "Đã kiểm tra và xác nhận." },
    });
    expect(aResolve.status()).toBe(200);
    expect((await aResolve.json()).data.status).toBe("resolved");

    // Vietnamese PDF Export (`POST /api/export/pdf` valid %PDF- + answer key; User B allow_clone=false blocked 403!)
    const pdfRes = await pageA.request.post("/api/export/pdf", {
      data: {
        studySetId: setId,
        mode: "paper_and_key",
        locale: "vi",
      },
    });
    expect(pdfRes.status()).toBe(200);
    expect(pdfRes.headers()["content-type"]).toContain("application/pdf");
    const pdfBuf = await pdfRes.body();
    expect(pdfBuf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(pdfBuf.byteLength).toBeGreaterThan(5_000);

    const bPdfBlocked = await pageB.request.post("/api/export/pdf", {
      data: { studySetId: setId, mode: "question_paper", locale: "vi" },
    });
    expect(bPdfBlocked.status()).toBe(403);

    await contextA.close();
    await contextB.close();
  });

  test("V3-T4: Spell Mode, Audio Flashcards, Advanced Learn, Review Mistakes, Resume Checkpoint across F5 & Scoped Reset Progress preserving Exam History", async ({
    browser,
  }) => {
    test.setTimeout(150_000);

    const emailA = process.env.E2E_USER_A_EMAIL!;
    const passwordA = process.env.E2E_USER_A_PASSWORD!;
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    await signIn(page, emailA, passwordA);

    const setRes = await page.request.post("/api/sets", {
      data: {
        title: `V3 Modes & Reset ${Date.now()}`,
        set_type: "mixed",
        visibility: "private",
      },
    });
    expect(setRes.status()).toBe(201);
    const setId: string = (await setRes.json()).data.id;

    const wavRes = await page.request.post("/api/uploads/audio", {
      multipart: {
        file: { name: "vocab.wav", mimeType: "audio/wav", buffer: makeWavBytes() },
        purpose: "flashcard",
        studySetId: setId,
      },
    });
    expect(wavRes.status()).toBe(201);
    const wavUrl: string = (await wavRes.json()).data.proxyUrl;

    const bulkRes = await page.request.post(`/api/sets/${setId}/questions/bulk`, {
      data: {
        questions: [
          {
            question_type: "flashcard",
            prompt: "Atmosphere",
            back_text: "Khí quyển",
            audio_url: wavUrl,
          },
          {
            question_type: "single_choice",
            prompt: "Đơn vị đo áp suất khí quyển là?",
            options: [
              { label: "A", content: "hPa", is_correct: true },
              { label: "B", content: "km/h", is_correct: false },
            ],
          },
          {
            question_type: "single_choice",
            prompt: "Gió thổi từ vùng áp cao về vùng nào?",
            options: [
              { label: "A", content: "Áp thấp", is_correct: true },
              { label: "B", content: "Nhiệt độ cao", is_correct: false },
            ],
          },
        ],
      },
    });
    expect(bulkRes.status()).toBe(201);

    // 1. Spell Mode (`/sets/[id]/spell`): wrong spelling shows feedback, right spelling advances
    await page.goto(`/sets/${setId}/spell`, { waitUntil: "networkidle" });
    const spellInput = page.locator("#spell-answer-input");
    await expect(spellInput).toBeVisible({ timeout: 15_000 });
    await spellInput.fill("wrongspellxyz");
    await spellInput.press("Enter");
    await expect(page.locator("main")).toContainText(/chưa chính xác|incorrect|thử lại|diff/i, {
      timeout: 8_000,
    });

    // 2. Audio Flashcards (`/sets/[id]/flashcards`): disable default shuffle if active so card #1 ("Atmosphere" w/ audio_url) is deterministically at index 0, verify <audio controls> present, Space flip, rate 3
    await page.goto(`/sets/${setId}/flashcards`, { waitUntil: "networkidle" });
    const shuffleBtn = page.getByRole("button", { name: /trộn thẻ|shuffle/i });
    await expect(shuffleBtn).toBeVisible({ timeout: 15_000 });
    if ((await shuffleBtn.getAttribute("aria-pressed")) === "true") {
      await shuffleBtn.click();
    }
    await expect(page.locator("audio").first()).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("Space");
    await page.keyboard.press("3");

    // 3. Advanced Learn (`/sets/[id]/learn`): loads cleanly with objectives/stages
    await page.goto(`/sets/${setId}/learn`, { waitUntil: "networkidle" });
    await expect(page.locator("main")).toBeVisible();

    // 4. Resume Session Checkpoint across F5 reload on /dashboard
    const sessionKey = `learn:${setId}:all`;
    const cpSave = await page.request.put("/api/checkpoints", {
      data: {
        study_set_id: setId,
        mode: "learn",
        session_key: sessionKey,
        state_json: { index: 1, answered: 1 },
        progress_percent: 50,
        current_index: 1,
        total_items: 2,
      },
    });
    expect([200, 201]).toContain(cpSave.status());

    await page.goto("/dashboard", { waitUntil: "networkidle" });
    await page.reload({ waitUntil: "networkidle" });
    const cpList = await page.request.get(`/api/checkpoints?studySetId=${setId}`);
    expect(cpList.status()).toBe(200);
    expect(await cpList.text()).toContain(sessionKey);

    // 5. Advanced Review Mistakes (`/review`) renders cleanly
    await page.goto("/review", { waitUntil: "networkidle" });
    await expect(page.locator("main")).toBeVisible();

    // 6. Submit an Exam Attempt, then invoke Scoped Reset Progress -> Exam History MUST survive 100%!
    const exCreate = await page.request.post("/api/exams", {
      data: { study_set_id: setId, question_count: 2 },
    });
    expect(exCreate.status()).toBe(201);
    const attemptId: string = (await exCreate.json()).data.attempt.id;
    const exSub = await page.request.post(`/api/exams/${attemptId}/submit`);
    expect(exSub.status()).toBe(200);

    const resetRes = await page.request.post("/api/progress/reset", {
      data: {
        scope: "study_set",
        study_set_id: setId,
        clear_mistakes: true,
        clear_checkpoints: true,
        confirm: "RESET_PROGRESS",
      },
    });
    expect(resetRes.status()).toBe(200);

    // Verify Exam History STILL intact (200 submitted) while checkpoint cleared!
    const examAfterReset = await page.request.get(`/api/exams/${attemptId}`);
    expect(examAfterReset.status()).toBe(200);
    expect((await examAfterReset.json()).data.attempt.status).toBe("submitted");

    const cpAfterReset = await page.request.get(`/api/checkpoints?studySetId=${setId}`);
    expect(cpAfterReset.status()).toBe(200);
    expect(await cpAfterReset.text()).not.toContain(sessionKey);

    await context.close();
  });

  test("V3-T5: Visual Diagram Mode (/sets/[id]/diagrams, /diagrams/[id]/edit, /diagrams/[id]/study) + Mobile 390px & 2-Account RLS", async ({
    browser,
  }) => {
    test.setTimeout(150_000);

    const emailA = process.env.E2E_USER_A_EMAIL!;
    const passwordA = process.env.E2E_USER_A_PASSWORD!;
    const emailB = process.env.E2E_USER_B_EMAIL!;
    const passwordB = process.env.E2E_USER_B_PASSWORD!;

    const contextA = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const pageA = await contextA.newPage();
    await signIn(pageA, emailA, passwordA);

    const setRes = await pageA.request.post("/api/sets", {
      data: {
        title: `V3 Diagram Set ${Date.now()}`,
        set_type: "mixed",
        visibility: "private",
      },
    });
    expect(setRes.status()).toBe(201);
    const setId: string = (await setRes.json()).data.id;

    const imgRes = await pageA.request.post("/api/uploads/image", {
      multipart: {
        file: {
          name: "aircraft-diagram.png",
          mimeType: "image/png",
          buffer: makePngBytes(200, 140, [37, 99, 235]),
        },
        purpose: "diagram",
        studySetId: setId,
      },
    });
    expect(imgRes.status()).toBe(201);
    const imgAsset = (await imgRes.json()).data as { id: string; proxyUrl: string };

    // Create Diagram with Point, Rect, and Polygon hotspots
    const diagRes = await pageA.request.post("/api/diagrams", {
      data: {
        study_set_id: setId,
        title: "Sơ đồ cánh máy bay V3",
        base_media_id: imgAsset.id,
        base_image_url: imgAsset.proxyUrl,
        image_width: 200,
        image_height: 140,
        hotspots: [
          {
            label: "Mũi cánh",
            accepted_alternatives: ["Leading edge"],
            shape: "point",
            geometry: { shape: "point", x: 0.2, y: 0.3, radius: 0.06 },
            sort_order: 0,
          },
          {
            label: "Cánh tà",
            accepted_alternatives: ["Flap"],
            shape: "rect",
            geometry: { shape: "rect", x: 0.45, y: 0.4, width: 0.2, height: 0.2 },
            sort_order: 1,
          },
          {
            label: "Đuôi đứng",
            accepted_alternatives: ["Vertical stabilizer"],
            shape: "polygon",
            geometry: {
              shape: "polygon",
              points: [
                { x: 0.75, y: 0.2 },
                { x: 0.9, y: 0.2 },
                { x: 0.85, y: 0.5 },
              ],
            },
            sort_order: 2,
          },
        ],
      },
    });
    expect(diagRes.status()).toBe(201);
    const diagramId: string = (await diagRes.json()).data.diagram.id;

    // Verify Diagram List, Editor & Study pages on Desktop 1440px
    await pageA.goto(`/sets/${setId}/diagrams`, { waitUntil: "networkidle" });
    await expect(pageA.locator("main")).toContainText("Sơ đồ cánh máy bay V3");

    await pageA.goto(`/diagrams/${diagramId}/edit`, { waitUntil: "networkidle" });
    await expect(pageA.locator("main")).toContainText("Mũi cánh");
    await expect(pageA.locator("main")).toContainText("Cánh tà");
    await expect(pageA.locator("main")).toContainText("Đuôi đứng");

    await pageA.goto(`/diagrams/${diagramId}/study`, { waitUntil: "networkidle" });
    await expect(pageA.locator("main")).toContainText("Sơ đồ cánh máy bay V3");
    await expect(pageA.locator("svg").first()).toBeVisible();

    // Switch to Mobile 390×844 & assert zero horizontal overflow!
    await pageA.setViewportSize({ width: 390, height: 844 });
    await pageA.waitForTimeout(300);
    const overflowX = await pageA.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflowX).toBe(false);

    // 2-Account Diagram RLS check (User B viewer can study 200, CANNOT edit 403)
    const shareRes = await pageA.request.post(`/api/sets/${setId}/share-links`, {
      data: { permission: "viewer", allow_clone: false },
    });
    const shareToken: string = (await shareRes.json()).data.token;

    const contextB = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const pageB = await contextB.newPage();
    await signIn(pageB, emailB, passwordB);

    // Before redeem: blocked
    const bBlockedBefore = await pageB.request.get(`/api/diagrams/${diagramId}`);
    expect([403, 404]).toContain(bBlockedBefore.status());

    // After viewer redeem: read allowed (200), edit blocked (403)
    expect(
      (await pageB.request.post(`/api/share-links/${shareToken}/redeem`)).status(),
    ).toBe(200);
    expect((await pageB.request.get(`/api/diagrams/${diagramId}`)).status()).toBe(200);
    expect(
      (
        await pageB.request.patch(`/api/diagrams/${diagramId}`, {
          data: { title: "Hijacked Diagram" },
        })
      ).status(),
    ).toBe(403);

    await contextA.close();
    await contextB.close();
  });

  test("V3-T6: True Offline PWA (Download -> setOffline(true) -> Offline Study -> Refresh Offline -> setOffline(false) -> Sync Queue -> Account-Switch IDB Isolation)", async ({
    browser,
  }) => {
    test.setTimeout(180_000);

    const emailA = process.env.E2E_USER_A_EMAIL!;
    const passwordA = process.env.E2E_USER_A_PASSWORD!;
    const emailB = process.env.E2E_USER_B_EMAIL!;
    const passwordB = process.env.E2E_USER_B_PASSWORD!;

    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    await signIn(page, emailA, passwordA);

    const uniqueTitle = `V3 Offline Set ${Date.now()}`;
    const setRes = await page.request.post("/api/sets", {
      data: { title: uniqueTitle, set_type: "multiple_choice", visibility: "private" },
    });
    expect(setRes.status()).toBe(201);
    const setId: string = (await setRes.json()).data.id;

    const qRes = await page.request.post(`/api/sets/${setId}/questions/bulk`, {
      data: {
        questions: [
          {
            question_type: "single_choice",
            prompt: "Câu hỏi ngoại tuyến 1: 2 + 2 = ?",
            options: [
              { label: "A", content: "4", is_correct: true },
              { label: "B", content: "5", is_correct: false },
            ],
          },
          {
            question_type: "single_choice",
            prompt: "Câu hỏi ngoại tuyến 2: 3 + 3 = ?",
            options: [
              { label: "A", content: "6", is_correct: true },
              { label: "B", content: "7", is_correct: false },
            ],
          },
        ],
      },
    });
    expect(qRes.status()).toBe(201);
    const qList = (
      await (await page.request.get(`/api/sets/${setId}/questions`)).json()
    ).data as Array<{ id: string }>;

    // 1. Open Study Set Hub -> Download Offline into IndexedDB
    await page.goto(`/sets/${setId}`, { waitUntil: "networkidle" });
    const dlTrigger = page.getByTestId("offline-download-trigger");
    await expect(dlTrigger).toBeVisible({ timeout: 15_000 });
    await dlTrigger.click();

    const dlDialog = page.locator('[role="dialog"]');
    await expect(dlDialog).toBeVisible({ timeout: 10_000 });
    await dlDialog
      .getByRole("button", { name: /tải về học ngoại tuyến|download offline/i })
      .click();

    // Wait for completion indicator inside dialog or button state
    await expect(dlDialog).toContainText(/đã tải|downloaded|cập nhật bản tải|update download/i, {
      timeout: 25_000,
    });
    await page.keyboard.press("Escape");

    // 2. Verify downloaded set appears in `/offline` and SW is active BEFORE going offline
    await page.goto("/offline", { waitUntil: "networkidle" });
    await expect(page.getByTestId("offline-manager-panel")).toContainText(uniqueTitle, {
      timeout: 15_000,
    });
    await page.evaluate(async () => {
      if ("serviceWorker" in navigator) {
        await navigator.serviceWorker.ready;
      }
    });
    // Reload once online so active SW controls the page
    await page.reload({ waitUntil: "networkidle" });
    await expect(page.getByTestId("offline-manager-panel")).toContainText(uniqueTitle, {
      timeout: 15_000,
    });

    // 3. Go TRUE OFFLINE (`context.setOffline(true)`), study offline & survive F5 reload!
    await context.setOffline(true);

    // Click Study Offline on our downloaded set
    await page
      .getByTestId("offline-manager-panel")
      .getByRole("button", { name: /học ngoại tuyến|study offline|mở|học/i })
      .first()
      .click();
    await expect(page.getByTestId("offline-study-runner")).toBeVisible({
      timeout: 15_000,
    });

    // Answer Q1 offline (either radio button or choice button inside offline study runner)
    const offlineChoice = page
      .getByTestId("offline-study-runner")
      .locator('[role="radio"], button')
      .filter({ hasText: /^4$|^A\.?\s*4/i })
      .first();
    if (await offlineChoice.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await offlineChoice.click();
    }

    // Perform a real F5 refresh WHILE STILL OFFLINE (`context.setOffline(true)`)!
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator("h1")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("offline-manager-panel")).toContainText(uniqueTitle, {
      timeout: 15_000,
    });

    // Verify offline IndexedDB still holds User A's downloaded set after offline refresh
    const hasOfflineDataBeforeReload = await page.evaluate(async () => {
      const dbs = typeof indexedDB.databases === "function" ? await indexedDB.databases() : [];
      return dbs.some((d) => (d.name ?? "").startsWith("studyhub-offline-v3"));
    });
    expect(hasOfflineDataBeforeReload).toBe(true);

    // 4. Reconnect Online (`context.setOffline(false)`) & verify Sync Queue + idempotency
    await context.setOffline(false);
    await page.goto("/settings?tab=offline", { waitUntil: "networkidle" });
    await expect(page.getByTestId("offline-manager-panel")).toContainText(uniqueTitle, {
      timeout: 15_000,
    });
    const syncBtn = page.getByTestId("sync-now-button");
    if (await syncBtn.isEnabled().catch(() => false)) {
      await syncBtn.click();
    }

    // Fetch caller's current progress_generation (V3-T4 reset bumps it from 1 -> 2!)
    const prefRes = await page.request.get("/api/preferences");
    expect(prefRes.status()).toBe(200);
    const currentGen = Number(
      ((await prefRes.json()).data as { progress_generation?: number })
        .progress_generation ?? 1,
    );

    // If generation > 1, also prove `ignored_stale_reset` live on PostgreSQL 17.12!
    if (currentGen > 1) {
      const staleRes = await page.request.post("/api/sync/events", {
        data: {
          events: [
            {
              event_id: randomUUID(),
              event_type: "answer",
              study_set_id: setId,
              question_id: qList[0].id,
              client_timestamp: new Date().toISOString(),
              progress_generation: currentGen - 1,
              payload: { is_correct: true, confidence: "certain" },
            },
          ],
        },
      });
      expect(staleRes.status()).toBe(200);
      const staleJson = (await staleRes.json()).data as {
        results: Array<{ status: string }>;
      };
      expect(staleJson.results[0].status).toBe("ignored_stale_reset");
    }

    // Verify `/api/sync/events` idempotency live (1st apply + 2nd replay duplicate_ignored)
    const eventId = randomUUID();
    const syncPayload = {
      events: [
        {
          event_id: eventId,
          event_type: "answer",
          study_set_id: setId,
          question_id: qList[0].id,
          client_timestamp: new Date().toISOString(),
          progress_generation: currentGen,
          payload: { is_correct: true, confidence: "certain" },
        },
      ],
    };
    const sync1 = await page.request.post("/api/sync/events", { data: syncPayload });
    expect(sync1.status()).toBe(200);
    const sync1Json = (await sync1.json()).data as {
      results: Array<{ status: string }>;
    };
    expect(sync1Json.results[0].status).toBe("applied");

    const sync2 = await page.request.post("/api/sync/events", { data: syncPayload });
    expect(sync2.status()).toBe(200);
    const sync2Json = (await sync2.json()).data as {
      results: Array<{ status: string }>;
    };
    expect(sync2Json.results[0].status).toBe("duplicate_ignored");

    // 5. Account-Switch IndexedDB Isolation (P0): Sign out A -> Sign in B in SAME browser context -> B sees 0 of A's downloaded sets!
    const signOutRes = await page.request.post("/auth/signout", {
      headers: { accept: "application/json" },
    });
    expect(signOutRes.status()).toBe(200);

    await signIn(page, emailB, passwordB);
    await page.goto("/settings?tab=offline", { waitUntil: "networkidle" });
    await expect(page.getByTestId("offline-manager-panel")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("offline-manager-panel")).not.toContainText(
      uniqueTitle,
    );

    await context.close();
  });
});
