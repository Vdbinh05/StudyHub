# StudyHub V3.2 — Wave 6 Import, Media, Editor & PDF Export Report (`IMPORT_MEDIA_REPORT.md`)

> **Auditor:** Agent 6 — Independent Functional Tester (`func-tester-2`, zero edits to `src/*` or `supabase/*`)  
> **Target:** Compiled local production server (`http://127.0.0.1:3051`) connected to live Supabase Cloud + Storage (`study-media` / temp staging)

---

## 1. Executive Summary

| Issue ID | Area | Wave 6 Verdict | Notes |
| :--- | :--- | :---: | :--- |
| **`V32-018`** (`PERF-05`, `DB-10`, `SEC-12`) | Multi-chunk shared `tempStoragePath`, media upload dedup & parallel commit | **PASS** | Chunk 1 (`isFinalChunk: false`) preserves staged media -> Chunk 2 (`isFinalChunk: true`) succeeds with images on all rows; SHA-256 upload dedup returns identical `media_assets.id`. |
| **`V32-019`** (`FUNC-06`) | Question Editor Fill-in-Blank spaces & `blank_id` focus | **PASS** | Keyboard typing `"Ha Noi"` retains `"Ha Noi"`; typing `"blank_1"` into `Mã ô trống 1` retains exact value & input focus (`blankIdFocusKept: true`). |
| **`V32-024`** (`FUNC-12`, `FUNC-13`) | ImportWizard immediate SPA cache refresh & idempotent chunk replay | **PASS** | Immediate SPA return to `/sets/[id]` shows `3 câu hỏi` (`showsZeroStale: false`); idempotent chunk replay recovers original `importJobId`. |
| **`V32-030`** (`FUNC-21` PDF half) | PDF Export WebP/JPEG, V3 structured answers & pre-submit `question_paper` | **PASS (Wave 6B)** | Post-submit V3 + PNG/WebP PDFs (`841 KB`) & pre-submit `403` anti-leak PASS; Wave 6B fix resolved `in_progress` `question_paper` V3 crash -> now **`200 OK` (`841,078 B`, `%PDF-`, `0` secret leak)** across `fill_in_blank`, `matching`, `image_hotspot`, `numerical`, `ordering` (see Section 5). |
| **`V32-033`** (`FUNC-23`, `RU-10`, `RU-15`) | Question Editor modal UX, sticky Save footer & row controls | **PASS** | Sticky `"Lưu câu hỏi"` inside viewport (`y: 802, h: 38 <= 900`), zero dev jargon (`noDevJargon: true`), explicit Edit buttons on rows (`editRowBtnCount: 2`). |
| **`V32-036`** (`FUNC-25` media half) | Signed-URL `onError` 1-shot `&_r=` retry | **PASS** | Simulated `500` on `/api/uploads/signed-url` triggered 1-shot `&_r=` retry (`sawCacheBustRetry: true`). |
| **`V32-038`** (`FUNC-27`, `RU-13`, `RU-14`) | `/import` `.pdf` support, single-pick handoff & `>1.5 MB` DOCX thumbnails | **PASS** | `accept=".docx,.xlsx,.pdf,.csv,.tsv,.txt,.json"`; picking Vietnamese PDF on `/import` auto-parsed on `/sets/[id]/import` without 2nd pick; `>1.5 MB` DOCX returned signed `previewUrl` (`largeHasSignedPreview: true`). |
| **`V32-040`** (`FUNC-29(4)`) | Safari WebKit `canvas.toBlob` MIME/ext alignment | **PASS** | Verified in `src/lib/media/validation.ts:710-782` (re-encodes opaque/WebP to JPEG, transparent to PNG; resolves MIME/ext from actual `blob.type`/magic bytes). |

---

## 2. Real File Format & Negative Security Matrix (`/api/import/parse` & `/api/uploads/image`)

| File / Payload Tested | Format / Category | HTTP Status | Observed Result | Verdict |
| :--- | :--- | :---: | :--- | :---: |
| Synthetic Multimedia `.docx` (embedded PNG + bold `*B.`) | Valid DOCX | `200` | Parsed **`2`** questions with embedded media; preview prefix stripping active | **PASS** |
| Large Multimedia `.docx` (`>1.5 MB` noisy 760×760 PNG) | Valid Large DOCX | `200` | Parsed **`2`** questions; staged to temp storage & returned signed **`previewUrl`** (`largeHasSignedPreview: true`) | **PASS** |
| Synthetic `.xlsx` (`exceljs` 2-row sheet) | Valid XLSX | `200` | Parsed **`2`** questions with chapters & explanations | **PASS** |
| `tests/fixtures/questions_utf8_bom.csv` | Valid CSV (UTF-8 BOM) | `200` | Parsed **`2`** questions cleanly | **PASS** |
| `tests/fixtures/quizlet_export.tsv` | Valid Quizlet TSV | `200` | Parsed **`4`** flashcards cleanly | **PASS** |
| Valid StudyHub `.json` array | Valid JSON | `200` | Parsed **`1`** question cleanly | **PASS** |
| Vietnamese Text-Layer `.pdf` (`pdf-lib` + `NotoSans-Regular.ttf`) | Valid Text PDF | `200` | Parsed **`2`** Vietnamese questions cleanly (`"Thủ đô của Việt Nam..."`) | **PASS** |
| Scanned Image-Only `.pdf` (embedded PNG, 0 text layer) | Scanned PDF | `200` | Honest deterministic detection: **`isScannedPdf: true`** (`SCANNED_PDF_DETECTED`, zero fake OCR/AI) | **PASS** |
| Spoofed `.docx` (plain text renamed `.docx`) | Security / Magic Bytes | **`400`** | Rejected cleanly (`INVALID_MAGIC_BYTES`) | **PASS** |
| Macro-enabled `.docm` | Security / Macro Block | **`400`** | Rejected cleanly | **PASS** |
| Empty `.txt` (`0` bytes) | Invalid / Empty | **`400`** | Rejected cleanly | **PASS** |
| Corrupt `.pdf` (`%PDF-1.4\ncorrupt garbage`) | Corrupt PDF | **`400`** | Rejected cleanly (zero unhandled crash) | **PASS** |
| `bad.svg` (`image/svg+xml`) via `/api/uploads/image` | XSS / SVG Block | **`415`** | Rejected cleanly (`Unsupported Media Type`) | **PASS** |
| Duplicate PNG upload in same set | SHA-256 Dedup (`DB-13`) | `201` | 2nd upload reused exact same `media_assets.id` (`sha256UploadDedup: true`) | **PASS** |

---

## 3. Multi-Chunk Commit & Idempotency Replay Evidence (`V32-018` / `V32-024`)

Using the `>1.5 MB` staged DOCX (`2` questions sharing one `tempStoragePath`):
1. **Chunk 1 (`isFirstChunk: true, isFinalChunk: false`):** `200 OK` -> `{ importJobId: "c8b8b517-...", importedCount: 1, totalSetQuestions: 1, idempotentReplay: false }`.
2. **Chunk 1 Idempotent Replay (same `idempotencyKey`):** `200 OK` -> `{ importJobId: "c8b8b517-...", importedCount: 0, skippedCount: 1, idempotentReplay: true }` — **recovered original `importJobId` cleanly (`FUNC-13`)!**
3. **Chunk 2 (`isFirstChunk: false, isFinalChunk: true`, reusing same `tempStoragePath`):** `200 OK` -> `{ importJobId: "c8b8b517-...", importedCount: 1, totalSetQuestions: 2 }`.
4. **DB Verification (`GET /api/sets/[id]/questions`):** `2/2` questions persisted with valid `prompt_image_url` (`bothChunksHaveImage: true`, proving Chunk 1 did NOT prematurely delete shared `tempStoragePath`!).

---

## 4. Question Editor & SPA Cache Verification (`V32-019`, `V32-024`, `V32-033`, `V32-038`)

- **SPA Cache Invalidation (`V32-024` / `FUNC-12`):** Created empty set -> loaded `/sets/[id]` (`hadZeroBefore: true`) -> SPA link to `/sets/[id]/import` -> pasted & committed 3 questions -> immediate SPA return to `/sets/[id]` -> displayed **`3 câu hỏi`** (`showsZeroStale: false`, `showsThreeQuestions: true`).
- **Single-Pick `/import` Handoff (`V32-038` / `RU-13`):** Selected Vietnamese PDF on `/import`, clicked Create -> landed on `/sets/[id]/import` and auto-parsed 2 Vietnamese questions without re-picking (`autoParsedWithoutSecondPick: true`).
- **Fill-in-Blank Editor (`V32-019` / `FUNC-06`):** Selected `Điền khuyết`, typed `"Ha Noi"` into accepted answers (`actualAcceptedVal: "Ha Noi"`) and `"blank_1"` into `Mã ô trống 1` (`blankIdActualVal: "blank_1"`, `blankIdFocusKept: true`).
- **Bulk Editor `content_version` Bump (`V32-037` / `FUNC-26(4)`):** `v0: 3` -> Bulk `PATCH` -> `v1: 4` -> Bulk `DELETE` -> `v2: 5`.

---

## 5. PDF Export Verification & Wave 6B Resolution of `V32-030` (`FUNC-21` / `FUNC-21b`)

- **Wave 6 Initial Defect Found & Reopened (`FUNC-21b`):** Calling `POST /api/export/pdf` with `{ attemptId, mode: "question_paper", locale: "vi" }` while `attempt.status === "in_progress"` returned `500 INTERNAL_ERROR` when the exam included `fill_in_blank`, `matching`, or `image_hotspot` because `pdf-exporter.ts:935` called `computeAnswerSummary()` on pre-submit stripped payloads.
- **Wave 6B Independent Retest — VERIFIED PASS:**
  - `POST /api/export/pdf` (`attemptId` `in_progress` containing `fill_in_blank`, `matching` + distractor, `image_hotspot`, `numerical` `unit_required: true`, and `ordering`, `mode: "question_paper"`, `locale: "vi"`) -> **`200 OK`**, **`841,078 B`**, valid `%PDF-` header, **`zeroSecretLeak: true`** (0 occurrences of secret blank answer, hotspot label, or required unit).
  - `POST /api/export/pdf` (`attemptId` `in_progress`, `mode: "paper_and_key"` and `mode: "paper_with_explanations"`) -> **`403 FORBIDDEN`** (strict pre-submit anti-leak guard preserved).
  - `POST /api/export/pdf` (post-submit exam with PNG + legacy WebP + `numerical` + `fill_in_blank` structured answers): `paper_with_explanations` -> **`200 OK` (`841,023 B`, `%PDF-`)**; `incorrect_review` -> **`200 OK` (`840,578 B`, `%PDF-`)**.
