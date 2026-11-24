# StudyHub V3.0 (Complete Learning Edition) — Performance, Scale, Multimedia Import, PDF & Bundle Audit Report

> **Author:** Agent 8 (`perf-import-auditor`) — Performance & Import Specialist  
> **Audit Wave:** Wave 5 / Wave 5B Independent Live Verification (`2026-11-24`)  
> **Live Target:** Next.js `16.4.6` Turbopack production build (`BUILD_ID: BbSz4eEIY5feq0VR-ct9F`, `next start -p 3024 -H 127.0.0.1`) connected to live Supabase Cloud project `StudyHub` (PostgreSQL `17.12`, migrations `0001`–`0016` applied live).  
> **Offline Benchmark Environment:** Node `v24.15.0`, Windows host, Vite SSR loader executing actual `src/lib/import/*` modules.  
> **Privacy, Security & Live Data Preservation Attestation:**
> - **Zero `.env.local` secrets/keys/JWTs** printed, logged, or committed.
> - **Zero `sample-data/` aviation question text** copied into this report or fixtures (exact measured metrics and structural counts only).
> - **Real pre-existing Supabase Cloud user data 100% untouched:** all live benchmarks ran strictly under prefixed disposable test accounts (`v3-perf-<ts>@studyhub-test.local` and `v3-perf-pdf-<ts>@studyhub-test.local`) with exact UUID tracking and verified teardown (`trackedUserDeleted: true`, `trackedSetsRemaining: 0`, `trackedMediaRemaining: 0`, `storageObjectsDeleted: 15`, `PORT_3024_FREE=True`).

---

## Executive Summary

StudyHub V3.0 was audited end-to-end across all 4 real aviation documents, synthetic 50-question multimedia DOCX (with SHA-256 Storage deduplication), selectable-text and scanned PDF imports, all 5 Vietnamese PDF export modes (`50Q` multimedia & `250Q` text), separated-stage `50`–`10,000`-question parser scale benchmarks, live `500Q` persistence + `250Q` exam lifecycle + `10`/`50`/`100`-event offline sync batches, and the `.next` production bundle.

During Wave 5 Pass 1, this audit caught **1 P0 live production crash (`V3-PERF-01`)** and **2 P1 client bundle regressions (`V3-PERF-02`, `V3-PERF-03`)**. All 3 were fixed by the owning builders and **independently re-verified PASS in Wave 5B**:

| Defect ID | Severity | Finding (Wave 5 Pass 1) | Root Cause & Fix | Wave 5B Live / Build Verdict |
|---|---|---|---|---|
| **`V3-PERF-01`** | **P0** | `POST /api/import/parse` crashed on **100% of valid `.pdf` files** in production `next start` with HTTP `400 INVALID_PDF` (despite passing in Vitest). | Turbopack bundled `pdfjs-dist/legacy/build/pdf.mjs` without sibling `./pdf.worker.mjs`. Fixed via `serverExternalPackages: ["pdfjs-dist"]` in `next.config.ts` (`#173`) + `globalThis.pdfjsWorker` preload in `src/lib/import/pdf-parser.ts` (`#172`). | **VERIFIED FIXED LIVE** on `:3024`: 5-page Vietnamese PDF parsed **`20/20`** in `695.5 ms` & committed `20/20`; scanned 2-page PDF honestly detected (`isScannedPdf: true`, `628.6 ms`). |
| **`V3-PERF-02`** | **P1** | **`466.3 KB raw / 145.0 KB gzip`** TipTap WYSIWYG editor leaked into live Exam Runner (`/exams/[attemptId]` ballooned to `1,839.6 KB`), `/sets/[id]/test` (`1,943.1 KB`), and `/sets/[id]` (`1,850.7 KB`). | Barrel import `from "@/components/richtext"` pulled `RichTextEditor` (`@tiptap/*`). Fixed via leaf imports in `SafeRichText.tsx` & `study-set-hub.tsx` + removing eager `RichTextEditor` re-export from `src/components/richtext/index.ts` (`#168`, `#172`, `#183`). | **VERIFIED FIXED** in `.next`: `/exams/[attemptId]` dropped **`-802.8 KB raw (-234.8 KB gzip, -41.6%)`**; `/sets/[id]/test` **`-793.3 KB (-38.9%)`**; `/sets/[id]` **`-737.7 KB (-37.5%)`**. |
| **`V3-PERF-03`** | **P1** | **`+390 KB raw`** (`@supabase/supabase-js` `254.4 KB` + Offline PWA UI `135.9 KB`) leaked into Landing `/` (`921.0 KB` vs `498.4 KB` V2.1), `/_not-found`, `/dashboard`, `/exams/new`, `/sets/[id]/edit`, and `/profile`. | Root `providers.tsx` imported `@/components/pwa` barrel and `PwaProvider.tsx` statically imported `@/lib/supabase/client`. Fixed via leaf imports (`#168`) + lazy dynamic imports & public-route skip in `PwaProvider.tsx` (`#171`). | **VERIFIED FIXED** in `.next`: Landing `/` dropped `921.0` → **`567.3 KB raw` (`-353.7 KB / -95.0 KB gzip, -33.5%`)**; `/_not-found` **`-44.0%`**; `/exams/new` **`-32.4%`**; `/dashboard` **`-31.4%`**. |

**Headline Status:** **0 open P0/P1 performance or import defects.** All V2.1 real aviation benchmarks, V3.0 multimedia DOCX/PDF pipelines, 50–10k scale targets, live 500Q/250Q Cloud operations, offline sync batches, and `.next` server-library isolation checks (`0 B` leaked) **PASS**.

---

## 1. V2.1 Real Aviation Regression — All 4 `sample-data/` Files (Live PG 17.12 on `:3024`)

All 4 real user aviation meteorology files were uploaded via multipart `FormData` to `POST /api/import/parse`, committed to live PostgreSQL 17.12 via `POST /api/import/commit`, and read back in full via `GET /api/sets/[id]/questions?page=1&pageSize=500`.

| Real File (`sample-data/`) | Expected GT | Parsed Valid | Committed → Live DB | Read-Back Verified (`4 opts` / `1 correct` / `100% match`) | File Read (ms) | `POST /parse` HTTP (ms) | `POST /commit` Live DB (ms) | `GET /questions` Read-Back (ms) | **V3.0 Total (ms)** | V2.1 Baseline (ms) | Verdict |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---|
| `METEOROLOGY-01. THE ATMOSTPHERE (133).docx` | **133** | `133` | **`133`** (`skip`) | **`133/133`** (`all4=133`, `singleCorr=133`, `parsedMatch=133`) | `2.60` | `828.9` *(cold)* | `2,321.8` | `1,411.4` | **`4,564.7`** | `3,664.1` | **PASS** *(cold + concurrent Cloud load)* |
| `METEOROLOGY-05. PRECIPITATION (24).xlsx` | **24** | `24` | **`24`** (`skip`) | **`24/24`** (`all4=24`, `singleCorr=24`, `parsedMatch=24`) | `1.81` | `480.3` | `1,529.7` | `597.0` | **`2,608.9`** | `2,785.2` | **PASS** *(`-6.3%` faster)* |
| `METEOROLOGY-08. CLIMATOLOGY (62).docx` | **62** | `62` | **`62`** (`keep_both`) | **`62/62`** (`all4=62`, `singleCorr=62`, `parsedMatch=62`) | `2.98` | `443.8` | `1,526.7` | `675.9` | **`2,649.4`** | `2,554.1` | **PASS** *(parity)* |
| `METEOROLOGY-08. CLIMATOLOGY (62).xlsx` | **62** | `62` | **`62`** (`keep_both`) | **`62/62`** (`all4=62`, `singleCorr=62`, `parsedMatch=62`) | `1.31` | `431.1` | `1,374.9` | `693.3` | **`2,500.6`** | `2,778.0` | **PASS** *(`-10.0%` faster)* |

- **100% Accuracy Preserved:** Zero dropped questions, zero option loss, zero misparsed answers across all 281 real aviation questions (`133 + 24 + 62 + 62`). Warm file totals (`2.50–2.65 s`) match or beat V2.1 (`2.55–2.79 s`).

---

## 2. V3.0 Multimedia DOCX Import, PDF Text-Layer / Scanned Import & Vietnamese PDF Export (Live on `:3024`)

### 2.1 Synthetic 50-Question Multimedia DOCX (Images + Image-Only Options + Word Table + SHA-256 Deduplication)

Generated a realistic `165.6 KB` `.docx` containing **50 image-rich Vietnamese questions** with **55 embedded `<w:drawing>` references** backed by **15 unique raster PNGs** (`125,034 B` / `122.1 KB` total: `10` prompt figures reused 5× each, `4` image-only options on Q#1 highlighted yellow/bold to trigger `image_choice`, and `1` diagram embedded inside a Word `<w:tbl>` layout table on Q#50):

| Stage / Verification Metric | Measured Live Result | Notes |
|---|---|---|
| **Stage 1 — File Read (Disk)** | **`1.25 ms`** (`165.6 KB` `.docx`) | Local disk read |
| **Stage 2 — `POST /api/import/parse`** | **`427.6 ms`** (`822.9 KB` preview w/ base64 previews) | Detected `docx_multimedia`, **`50/50` valid**, `0` raw `/docx-media/` leaks |
| **Stage 3 — `POST /api/import/commit` (Media Upload + DB Insert)** | **`10,102.0 ms`** | Uploaded **exactly `15` unique PNGs** to private `study-media` + inserted `50` Qs, `200` opts, `15` `media_assets`, `54` `content_media_relations` |
| **Stage 4 — `GET /api/sets/[id]/questions` Read-Back** | **`677.6 ms`** (`140.0 KB` JSON) | **`50/50`** questions carry durable `/api/uploads/signed-url?...` proxy URLs |
| **Total End-to-End (50Q Multimedia DOCX)** | **`11,208.4 ms`** | Includes 15 live HTTPS Storage uploads to Supabase Cloud |
| **SHA-256 Deduplication Proof** | **`15` stored / `55` embedded refs (`-72.7%` uploads!)** | `uniqueMediaAssetsStored === 15`, `contentMediaRelationsCount === 54` |
| **Structural Fidelity Proofs** | `Q#1`: `question_type = "image_choice"`, **`4/4` image-only options** with URLs; `Q#50`: **Word table image preserved** (`q50TableHasImageUrl: true`); live proxy URL returns HTTP **`302`** (`286.7 ms`) | Zero broken media links |

*(Note: Stage 3 currently uploads each unique image sequentially inside `commit/route.ts:593-596` (~`673 ms`/image over internet TLS). Adding bounded concurrency (`p-limit = 4`) is logged as a clean non-blocking P2 optimization in §5 that would drop 15-image commit from `10.1 s` to ~`2.8 s`.)*

### 2.2 Selectable-Text & Scanned PDF Import (Live `V3-PERF-01` Verification on `:3024`)

| PDF Test Case | Input Size | Format / Pages | Detection & Integrity | File Read (ms) | `POST /parse` HTTP (ms) | `POST /commit` DB (ms) | Read-Back (ms) | **Total E2E (ms)** |
|---|---:|---|---|---:|---:|---:|---:|---:|
| **5-Page Vietnamese Selectable-Text PDF (`20` MCQs + repeating header/footer + `"BẢNG ĐÁP ÁN"` key)** | `409.6 KB` | `pdf_text`, `5` pages (`isScannedPdf: false`) | **`20/20` valid**, **`20/20` committed & read back**, `allHave4Options: 20`, `exactSingleCorrect: 20`, **`repeatingHeaderLeaked: 0`** | `1.17` | **`695.5`** | `1,350.0` | `575.3` | **`2,622.0`** |
| **2-Page Image-Only Scanned PDF (Zero Text Layer)** | `~1.8 KB` | `pdf_text`, `2` pages (**`isScannedPdf: true`**) | HTTP `200`, `questions: []`, **`hasScannedWarning: true`** (honest deterministic notice; zero AI/OCR guessing!) | — | **`628.6`** | N/A | N/A | **`628.6`** |

### 2.3 Live Vietnamese PDF Export — All 5 Modes (`50Q` Multimedia & `250Q` Text + RFC 5987 Headers on `:3024`)

| Export Mode (`POST /api/export/pdf`, `locale: "vi"`) | Scope | HTTP Status | `%PDF-` Magic Valid | RFC 5987 `filename*=UTF-8''` + ASCII Fallback | Latency (ms) | Output PDF Size (KB) | Notes |
|---|---|---:|---|---|---:|---:|---|
| **`question_paper`** (`includeImages: true`) | **50Q Multimedia** *(15 unique Storage PNGs)* | `200` | Yes | Yes | **`12,004.4`** *(cold)* | `1,279.9` | Cold NotoSans font subset + 15 Storage PNG downloads |
| **`paper_and_key`** (`includeImages: true`) | **50Q Multimedia** *(15 unique Storage PNGs)* | `200` | Yes | Yes | **`3,119.2`** *(warm)* | `1,281.9` | **3.8× faster** warm font cache; separate answer key appended |
| **`question_paper`** (`includeImages: false`) | **250Q Vietnamese Bank** | `200` | Yes | Yes | **`6,821.2`** | `880.3` | Clean pagination + NotoSans Vietnamese diacritics |
| **`paper_and_key`** (`includeImages: false`) | **250Q Vietnamese Bank** | `200` | Yes | Yes | **`6,561.9`** | `888.0` | Separate answer key grid appended (`+7.7 KB`) |
| **`paper_with_explanations`** | Mixed Vietnamese Set | `200` | Yes | Yes *(`De-on-tap-kem-giai-thich-...`)* | **`1,142.8`** | `821.2` | Includes explanations; zero `ByteString` header errors |
| **`incorrect_review`** *(submitted `attemptId`)* | Submitted Exam Snapshot | `200` | Yes | Yes *(`On-lai-cau-sai-...`)* | **`705.0`** | `820.9` | Proves `V3-SEC-01` `rpcGetExamAttemptDetail` works live! |
| **`flashcard_sheets`** | Flashcards Set | `200` | Yes | Yes *(`The-ghi-nho-in-an-...`)* | **`979.6`** | `821.0` | Printable Vietnamese flashcard layout |

---

## 3. Scale Benchmarks (`50` → `10,000` Questions)

### 3.1 Separated-Stage Offline Deterministic Parser & Validator (`50`–`10,000` Qs — V3.0)

Executed against `src/lib/import/{docx-ooxml-parser,eduquiz-parser,xlsx-parser,validator,index}.ts` (median of 3 runs `≤1,000` / 2 runs `5,000–10,000`; size `133` DOCX uses the **real** `METEOROLOGY-01 (133).docx` file):

| Questions | DOCX Source | DOCX Read (ms) | DOCX Parse (ms) | DOCX Val (ms) | DOCX Prep (ms) | **DOCX Total (ms)** | Step-5 O(1) Edit (ms) | Client JSON (MB / Chunks) | **TXT Total (ms)** *(Read/Parse/Val/Prep)* | **XLSX Total (ms)** *(Read/Parse/Val/Prep)* |
|---:|---|---:|---:|---:|---:|---:|---:|---|---:|---:|
| **50** | Synth | 1.07 | 5.27 | 1.04 | 0.40 | **7.78** | `0.022` | `0.05 MB` (1) | **1.78** *(0.52/0.45/0.66/0.16)* | **9.61** *(1.17/8.03/0.29/0.13)* |
| **133** | **REAL `01.docx`** | **1.15** | **33.84** | **1.80** | **1.01** | **37.80** | **`0.019`** | **`0.13 MB` (1)** | **3.54** *(1.06/0.89/1.22/0.37)* | **10.65** *(1.26/8.25/0.76/0.38)* |
| **226** | Synth | 0.84 | 9.22 | 1.94 | 0.98 | **12.98** | `0.011` | `0.22 MB` (1) | **4.18** *(0.88/0.91/1.74/0.64)* | **13.66** *(0.98/10.90/1.22/0.56)* |
| **500** | Synth | 0.96 | 20.31 | 4.97 | 2.49 | **28.73** | `0.019` | `0.50 MB` (1) | **7.74** *(0.99/1.78/3.38/1.58)* | **22.08** *(0.99/17.54/2.28/1.27)* |
| **1,000** | Synth | 1.05 | 44.38 | 9.80 | 5.41 | **60.64** | `0.033` | `1.00 MB` (2) | **16.06** *(1.65/3.52/7.41/3.48)* | **45.36** *(1.41/35.75/5.19/3.02)* |
| **5,000** | Synth | 1.15 | 221.23 | 56.73 | 26.51 | **305.63** | `0.091` | `5.01 MB` (10) | **89.95** *(2.55/21.69/48.16/17.55)* | **250.63** *(1.64/197.53/37.98/13.48)* |
| **10,000** | Synth | 1.27 | 474.92 | 112.70 | 50.06 | **`638.95`** | **`0.029`** | **`10.02 MB` (20)** | **`179.49`** *(4.69/55.47/86.32/33.01)* | **`534.81`** *(1.64/435.00/63.88/34.30)* |

- **Zero Regression Across 10,000 Questions:** Even with V3 multimedia OOXML support added, 10,000-question parsing completes in **`0.64 s` (DOCX)**, **`0.18 s` (TXT)**, and **`0.53 s` (XLSX)** — well under V2.1 (`0.86 s` / `0.26 s` / `0.58 s`) — while Step-5 inline edit validation stays strictly O(1) at **`0.029 ms`** (`<0.2%` of a 16.6 ms 60fps frame).

### 3.2 Live 500-Question Bank & 250-Question Exam Lifecycle (Supabase Cloud PG 17.12 — V3.0 vs V2.1)

| Live Operation (`http://127.0.0.1:3024` → Supabase Cloud) | V2.1 Baseline (ms) | **V3.0 Live Measured (ms)** | Payload / Rows Verified | Verdict |
|---|---:|---:|---|---|
| **500-Q Commit** (`POST /api/import/commit`: 500 Qs + 2,000 opts + 500 tags) | `3,649.3` | **`4,131.5`** | `500/500` imported, statement-level trigger exact | **PASS** *(+13% under 4 concurrent Wave 5 auditors)* |
| **500-Q Single-Page Read-Back** (`GET /questions?pageSize=500`) | `2,079.9` | **`2,333.7`** | `1,316.5 KB`, **`500/500` Qs × `4` opts (`2,000/2,000`)**, 0 truncation | **PASS** |
| **500-Q Paginated Offline Download** (`5 × pageSize=100`) | `4,463.0` | **`4,599.4`** | **`1,316.8 KB` (`1.29 MB`)** total JSON (`~2.63 KB`/Q) | **PASS** |
| **250-Q Live Exam Generation** (`POST /api/exams`, shuffle Qs+Opts) | `1,749.4` | **`1,842.1`** | `401.8 KB`, **`250/250` Qs**, **`0` pre-submit key leaks** | **PASS** |
| **250-Q Chunked Autosave** (`PUT /answers`: 150 + 100 chunks) | `823.6` | **`1,148.6`** *(467.2 + 681.4)* | Live `answered_count: 150 → 250` | **PASS** |
| **250-Q Server-Scored Submit** (`POST /submit`, 12-type RPC + SM-2) | `723.7` | **`844.4`** | `status: "submitted"`, exact `200/250 = 80.00%` | **PASS** |

---

## 4. Frontend Bundle, Offline Footprint, Sync Latency & Supabase Free-Tier Headroom

### 4.1 Production `.next` Client Bundle Audit — BEFORE vs AFTER Wave 5B (`V3-PERF-02` & `V3-PERF-03`)

Measured directly from `.next/static/chunks` and `.next/server/app/**/page_client-reference-manifest.js` (`BUILD_ID: BbSz4eEIY5feq0VR-ct9F`, `114` JS chunks, `2` CSS files = `119.5 KB raw / 20.4 KB gzip`, `public/sw.js` = `6.7 KB`):

- **Server-Only Library Leakage Check:** **`0 bytes` leaked (`leakedServerLibs: []`)** — `pdf-lib`, `@pdf-lib/fontkit`, `pdfjs-dist`, `exceljs`, `jszip`, `fast-xml-parser`, `mammoth`, and `papaparse` are 100% absent from `.next/static/chunks/`.
- **Lazy-Split Heavy Feature Chunks Verified:**
  - `1et6b5zh5j9gb.js` (**`466.3 KB raw / 145.0 KB gzip`**, TipTap / ProseMirror editor) — strictly lazy-loaded (`next/dynamic`) ONLY when opening RichTextEditor in Question Editor / Note Panel; **0 bytes** on Landing, Auth, Exam Runner, Study Hub, Dashboard!
  - `1xm1am4ct1ry0.js` (**`463.1 KB raw / 129.3 KB gzip`**, `recharts`) — strictly lazy-loaded ONLY on `/dashboard` & `/statistics`.
  - `0bafbvo1daef1.js` (**`254.9 KB raw / 66.6 KB gzip`**, `@supabase/supabase-js`) — loaded ONLY on Auth routes & `/settings` (dynamic-imported in `PwaProvider` after `V3-PERF-03`).
  - `2vc7w84cgq-5s.js` (**`67.6 KB raw / 19.7 KB gzip`**, `DiagramEditor`) — isolated to `/diagrams/*` routes only.
  - `347vb01_sohph.js` (**`267.3 KB raw / 77.9 KB gzip`**, `katex`) — loaded ONLY on routes rendering rich math/questions (`RichContentRenderer`), completely absent from `/`, `/login`, `/register`, `/dashboard`, `/exams/new`, `/offline`.

| Route | Wave 5 Pass 1 Raw / Gzip (KB) | **Wave 5B AFTER Raw / Gzip (KB)** | Wave 5B Reduction (Gzip) | V2.1 Baseline Gzip (KB) | Notes |
|---|---:|---:|---:|---:|---|
| **`/` (Landing)** | `921.0` / `283.6` | **`567.3` / `188.6`** | **`-95.0 KB (-33.5%)`** | `165.6` | Zero TipTap, zero KaTeX, zero `@supabase`, zero DiagramEditor |
| **`/_not-found`** | `737.3` / `224.2` | **`374.1` / `125.6`** | **`-98.6 KB (-44.0%)`** | `96.2` | Lean error shell |
| **`/(app)/exams/[attemptId]`** | `1,839.6` / `565.1` | **`1,036.9` / `330.4`** | **`-234.7 KB (-41.5%)`** | `147.5` | TipTap & `@supabase` removed; includes KaTeX (`77.9 KB` gzip) for 12-type math rendering |
| **`/(app)/sets/[id]/test`** | `1,943.1` / `593.6` | **`1,149.9` / `362.5`** | **`-231.1 KB (-38.9%)`** | `178.9` | TipTap & `@supabase` removed |
| **`/(app)/sets/[id]`** | `1,850.7` / `564.0` | **`1,113.0` / `352.3`** | **`-211.7 KB (-37.5%)`** | `185.1` | TipTap & `@supabase` removed; includes KaTeX + ZoomableImage + OfflineDownload |
| **`/(app)/sets/[id]/edit`** | `1,407.9` / `424.6` | **`1,071.9` / `335.2`** | **`-89.4 KB (-21.1%)`** | `184.6` | TipTap lazy-loaded (`next/dynamic`); `@supabase` removed |
| **`/(app)/dashboard`** | `966.6` / `296.4` | **`617.9` / `203.3`** | **`-93.1 KB (-31.4%)`** | `159.4` | `recharts` & `@supabase` excluded from initial load |
| **`/(app)/exams/new`** | `925.1` / `278.2` | **`587.4` / `188.1`** | **`-90.1 KB (-32.4%)`** | `147.2` | Lean multi-subject builder |
| **`/(app)/profile`** | `~945` / `~290` | **`593.9` / `197.5`** | **`~-93 KB`** | `156.0` | `@supabase` excluded |
| **`/(auth)/login`** | `910.8` / `282.3` | **`812.9` / `254.2`** | **`-28.1 KB (-10.0%)`** | `220.8` | Includes `@supabase` auth SDK (`66.6 KB` gzip, required for sign-in) |
| **`/(app)/sets/[id]/spell`** *(V3)* | — | **`710.6` / `234.7`** | — | N/A | Clean Web Speech TTS + Audio player |
| **`/(app)/diagrams/[id]/edit` & `/study`** *(V3)* | — | **`685.1` / `225.4`** | — | N/A | Diagram canvas & normalized hotspot editor isolated here |
| **`/offline`** *(V3)* | `741.2` / `226.0` | **`489.6` / `162.2`** | **`-63.8 KB (-28.2%)`** | N/A | Lean offline hub + `sw.js` (`6.7 KB`) |

### 4.2 Offline Download Footprint & Live Sync Batch Latency (`POST /api/sync/events`)

- **Measured Offline Download Payload Footprint:**
  - **500-Q Text Bank:** **`1,316.8 KB` (`1.29 MB`)** across `5 × 100`-question pages (`4,599.4 ms` live download; **`~2.63 KB/question`**).
  - **50-Q Multimedia Bank (with 15 unique deduplicated PNGs):** `140.0 KB` JSON + `122.1 KB` deduplicated PNGs = **`262.1 KB` total** (at typical ~`80 KB` real aviation diagrams, 50 unique diagrams ≈ `4.1 MB` in IndexedDB — well under browser multi-hundred-MB `navigator.storage.estimate()` quotas).
- **Measured Live Offline Sync Batch Latency (`POST /api/sync/events` → `sync_offline_learning_events` RPC on PG 17.12):**

| Sync Batch Test | Events | Request Payload (KB) | Live HTTP Latency (ms) | Effective ms / Event | Server Outcome Verified |
|---|---:|---:|---:|---:|---|
| **Small Batch** (`answer` + `confidence`) | `10` | `3.3` | **`435.9`** | `43.59` | **`10/10 applied`** |
| **Medium Batch** (`answer` + `confidence`) | `50` | `16.6` | **`405.8`** | `8.12` | **`50/50 applied`** |
| **Large Batch** (`answer` + `confidence`) | `100` | `33.2` | **`454.5`** | **`4.55`** | **`100/100 applied`** *(flat ~430 ms RTT — single atomic RPC!)* |
| **Idempotent Replay** (re-sending 10 UUIDs) | `10` | `3.3` | **`318.1`** | `31.81` | **`10/10 duplicate_ignored`** *(zero double-counting!)* |

### 4.3 Supabase Free-Tier Headroom Analysis

Based on direct V3.0 measured row/payload sizes against Supabase Free Tier limits (**500 MB PostgreSQL DB**, **1 GB Storage**, **5 GB/month Cached/Uncached Egress**):

| Free-Tier Resource | Measured StudyHub V3.0 Unit Cost | Free-Tier Capacity Headroom | Assessment |
|---|---|---|---|
| **PostgreSQL Database (`500 MB`)** | `500Q` bank (`500` Qs + `2,000` opts + `500` tags + indexes) ≈ `~1.8–2.2 MB` on disk (`~3.6–4.4 KB`/Q incl. GIN `pg_trgm` & B-tree indexes); `250Q` exam snapshot ≈ `~0.5 MB`. | **~80,000–100,000 questions** + **~200 full 250-Q exam histories** before approaching 80% (`400 MB`). | **Ample** for personal & small study-group usage. |
| **Supabase Storage (`1 GB`, `study-media`)** | SHA-256 deduplication confirmed (`55` refs → `15` objects, **`-72.7%`**). At `~80 KB` average optimized PNG/JPG diagram or `~150 KB` compressed 15s voice note: `1 GB` holds **`~12,500` unique images** or **`~6,600` audio clips**. | Strong headroom; `ON DELETE RESTRICT` + orphaned-asset tracking prevents leaks. | **Healthy** (5 MB image / 15 MB audio hard caps protect against abuse). |
| **Monthly Egress (`5 GB / mo`)** | `500Q` full download = `1.29 MB`; `250Q` live exam start = `0.40 MB`; `100`-event offline sync = `0.03 MB`; `50Q` multimedia PDF export = `1.28 MB`. | Supports **`~3,800` full 500-Q set downloads** or **`~12,500` 250-Q exam starts** per month; offline caching in IndexedDB + `Cache-Control: private, max-age=300` on signed-URL redirects further reduces repeat egress. | **Healthy** for personal/team study. |

---

## 5. Non-Blocking P2/P3 Optimization Backlog (Post-V3.0 Polish)

None of the items below block V3.0 release — all targets pass cleanly — but they represent high-ROI future polish:

1. **[P2] Bounded Parallelism (`concurrency = 4`) for Multimedia DOCX Storage Uploads & PDF Image Downloads:**
   - `src/app/api/import/commit/route.ts:593-596, 645-648` uploads unique extracted DOCX images sequentially (`10.1 s` for 15 PNGs over HTTPS), and `src/app/api/export/pdf/route.ts:87-129` downloads unique Storage images sequentially (`12.0 s` cold / `3.1 s` warm for 50Q multimedia PDF). Parallelizing unique-hash fetches with a concurrency pool of `4` will cut multimedia import & PDF export latencies by **~3×** without overloading PostgREST/Storage.
2. **[P2] Conditional Lazy-Load of `katex` (`267.3 KB raw / 77.9 KB gzip`) & Scoped `katex.min.css`:**
   - `src/app/layout.tsx:3` imports `katex/dist/katex.min.css` globally (`~26.8 KB` raw CSS on `/` & `/login`), and `RichContentRenderer.tsx` statically imports `katex` (`77.9 KB` gzip) even on purely plain-text MC exams. Loading `katex` dynamically only when a `math` AST node or `$...$` delimiter is detected would shave another **`77.9 KB` gzip** off `/exams/[attemptId]`, `/sets/[id]`, and `/sets/[id]/test`.
3. **[P3] Shared-Set Pagination Beyond 100 Memberships (`src/app/api/sets/route.ts:54,124`):**
   - Carried over from V2.0: `setIds.slice(0, SAFE_IN_CHUNK_SIZE)` caps users who are members of >100 shared sets; migrating to `fetchInChunks` removes this ceiling cleanly.
