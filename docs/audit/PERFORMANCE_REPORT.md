# StudyHub V2.0 — Real-World Import Accuracy & Performance Audit Report

> **Author:** Agent 8 (`perf-import-auditor`) — Performance & Import Specialist  
> **Scope:** Wave 1 read-only real-world import audit (all 4 `sample-data/` aviation meteorology documents), separated-stage import pipeline benchmarking (`50`–`10,000` questions), large-bank & long-exam runtime/DB/UI profiling (`250` / `500` / `1,000`-question exams; `10,000`-question banks), and `.next` production bundle analysis.  
> **Environment Measured:** Node `v24.15.0`, npm `11.12.1`, Windows host, Next.js `16.4.6` production build (`.next/`), Vitest/Vite SSR loader executing actual `src/lib/import/*` and `src/lib/learning/*` modules.  
> **Privacy & Honesty Attestation:** All 4 documents in `sample-data/` are real user aviation materials. Zero question banks or copyrighted technical text are copied into this report—only exact measured counts, OOXML/sheet structural schemas, and redacted structural placeholders. Every timing and byte metric below was directly measured; live PostgreSQL insertion latency is explicitly marked **BLOCKED** (Docker daemon not running; no live Supabase credentials configured).

---

## Executive Summary

Testing StudyHub's **actual** parsers against real user files and profiling the codebase for 10,000-question banks and 250–1,000-question exams revealed **critical production blockers** that synthetic unit tests did not catch:

| Dimension | Headline Result | Severity |
|---|---|---|
| **Real DOCX Import (2 files)** | **133/133** (`METEOROLOGY-01`) and **62/62** (`METEOROLOGY-08`) parsed with **100% answer accuracy** via `auto` and `docx_bold` rules (`27.6 ms` and `13.2 ms`), **BUT** prompt-only duplicate detection falsely flags Q#30 in `METEOROLOGY-01` (distinct options & different correct answer from Q#20), causing **silent data loss** (`132/133` saved) under default `duplicatePolicy: "skip"`. | **P1** |
| **Real XLSX Import (2 files)** | **Catastrophic 0% pass rate:** **`0/24` valid** (`METEOROLOGY-05`) and **`0/62` valid** (`METEOROLOGY-08`) in **both** `auto` mode and Step-3 manual column mapping! Root causes: (1) 2-row merged institutional Vietnamese headers (`F1:G1`, `I1:J1`..`O1:P1` with `"Nội dung"` / `"Giải thích"` subheaders) create duplicate column names that overwrite earlier indices in `headerIndex`, pointing all fields to empty `"Giải thích"` columns; (2) 1-letter substring matching (`"a"`, `"c"`, `"d"`, `"e"`) in `suggestColumnMapping()` mis-maps Vietnamese headers to random columns; (3) Radix `<SelectItem key={col} value={col}>` collides on duplicate header strings. | **P0** |
| **10,000-Question Import Speed** | Pure JS/TS pipeline is fast: **1.20 s** total for 10,000 DOCX (`936 ms` parse, `94.5 ms` validate, `164.5 ms` batch prep), **0.36 s** for 10,000 TXT, **0.88 s** for 10,000 XLSX. **However**, `ImportWizard` triggers **3× redundant full-file uploads/parses**, includes **37.8% unused `rawSource`+`formatting` payload bloat**, runs **`105.5 ms` synchronous revalidation on every keystroke** in Step 5, and hits a **10,000-execution row-level DB trigger storm** on `study_sets.question_count` + **PostgREST 1,000-row truncation** on duplicate checks. | **P0 / P1** |
| **250 / 500 / 1,000-Q Exams & 10k Banks** | In-memory exam generation from a 10,000-Q pool takes only **`1.74–3.72 ms`**, **BUT** production execution **breaks on real Supabase/PostgREST**: (1) `createExamSchema` (Zod) + `create_exam_attempt()` (SQL) + `TestHubClient` hard-cap exams at **500 questions** (blocking 1,000-Q exams); (2) `POST /api/exams`, `GET /api/sets/[id]/questions`, `GET /api/sets/[id]/export`, and `POST /api/sets/[id]/duplicate` hit **PostgREST `max_rows = 1000` silent truncation** (silently dropping questions >1,000 and truncating options past question #250!) and **18.5 KB–37.0 KB `.in()` URL-length overflows (`HTTP 414`)**; (3) `LiveExamRunner` re-renders the entire runner + navigator **every 500 ms** and fails offline sync past 200 dirty answers; (4) `ExamResultsClient` mounts up to **1,000 unvirtualized cards (~25,000+ DOM nodes)**; (5) `TestHubClient` downloads up to **2,000 questions unnecessarily** even when resuming a live exam (`?attemptId=...`). | **P0 / P1** |
| **Client JS Bundle (`.next`)** | **Zero server parser leaks** (`jszip`, `fast-xml-parser`, `exceljs`, `mammoth`, `papaparse` = `0 B` in client chunks), and `recharts` (`451.2 KB raw / 126.8 KB gzip`) is cleanly code-split via `next/dynamic`. **Opportunity:** `question-editor-view.tsx` statically imports `@/lib/supabase/client` (`254.1 KB raw / 66.3 KB gzip`), making `/sets/[id]/edit` the heaviest route (`775.1 KB raw / 235.4 KB gzip`). | **P2** |

---

## 1. Real Document Import Audit (All 4 `sample-data/` Files)

### 1.1 Ground-Truth Independent Structural Analysis

Before running StudyHub's parsers, all 4 files were independently inspected at the raw OOXML (`word/document.xml`, `word/styles.xml`, `word/numbering.xml`) and ExcelJS worksheet (`ws.model.merges`, rows, cells, fonts, fills) levels:

| File | Size | Raw Structure | Ground-Truth Questions | Answer Convention | Option Structure | Chapters / Tables / Media | Special Unicode & Source Duplicates |
|---|---:|---|---:|---|---|---|---|
| `METEOROLOGY-01. THE ATMOSTPHERE (133).docx` | `34,631 B` (`33.8 KB`) | `11` ZIP entries; `word/document.xml` `447,131 B`; `799` `<w:p>` (`665` non-empty); `0` tables; no `numbering.xml` | **133** (`1.`–`133.`, zero gaps) | Exactly **1** fully-bold option (`<w:b/><w:bCs/>` on both `pPr/rPr` and `r/rPr`) per question (`133/133`). Zero highlight, color, underline, asterisk, or answer key lines. | `133/133` have 4 options prefixed `a)`–`d)` | `0` in-body chapter headings (chapter in filename only); `0` tables; `0` media | `U+00B0` (`°`) ×92, `U+0421` (Cyrillic `С` typo in source Q#67 opts B/C/D) ×3, `U+2026` (`…`) ×1. **1 shared-stem pair:** Q#20 & Q#30 share identical 42-char stem, **different options & different correct answer**. |
| `METEOROLOGY-08. CLIMATOLOGY (62).docx` | `23,702 B` (`23.1 KB`) | `11` ZIP entries; `word/document.xml` `210,565 B`; `373` `<w:p>` (`310` non-empty); `0` tables; no `numbering.xml` | **62** (`1.`–`62.`, zero gaps) | Exactly **1** fully-bold option (`<w:b/><w:bCs/>`) per question (`62/62`). Zero highlight, color, underline, asterisk, or answer key lines. | `62/62` have 4 options prefixed `a)`–`d)` | `0` in-body chapter headings; `0` tables; `0` media | `U+00B0` (`°`) ×17, `U+FEFF` (zero-width BOM at end of run) ×2. **1 duplicate-stem pair:** Q#26 & Q#31 share identical 53-char stem + same correct text in re-ordered options. |
| `METEOROLOGY-05. PRECIPITATION (24).xlsx` | `15,295 B` (`14.9 KB`) | 1 sheet (`Sheet1`), `16` cols, `rowCount=101` (`26` non-empty: Rows 1–2 merged headers + Rows 3–26 data; 75 blank styled rows) | **24** (Rows 3–26; Col 3 = `"SC"` on 24/24) | Column `H` (`C8`, header `"Đáp án"`): 1-based numeric index `1`–`4` (`1`:4, `2`:10, `3`:7, `4`:3). | 4 options in odd cols `C9`, `C11`, `C13`, `C15` (paired with empty `"Giải thích"` cols `C10/12/14/16`). `96/96` cells carry literal `a)`–`d)` prefix; `24/24` prompts carry `1.`–`24.` prefix. | `11` merged header cells (`A1:A2`..`E1:E2`, `H1:H2`, `F1:G1`, `I1:J1`, `K1:L1`, `M1:N1`, `O1:P1`). No chapter column populated. | Zero non-ASCII special chars in data rows. **1 shared-stem pair** (after stripping number): Row 14 & Row 20 share identical stem, **different options & different correct answer**. |
| `METEOROLOGY-08. CLIMATOLOGY (62).xlsx` | `20,665 B` (`20.2 KB`) | 1 sheet (`Sheet1`), `16` cols, `rowCount=101` (`64` non-empty: Rows 1–2 merged headers + Rows 3–64 data; 37 blank styled rows) | **62** (Rows 3–64; Col 3 = `"SC"` on 62/62) | Column `H` (`C8`, header `"Đáp án"`): 1-based numeric index `1`–`4` (`1`:20, `2`:15, `3`:11, `4`:16). **Cross-check vs `08.docx`: `62/62` (100%) ground-truth answers match.** | Same 16-column 2-row merged institutional schema (`C6` prompt, `C9/11/13/15` options with `a)`–`d)` prefix, `248/248`). | Same `11` merged header cells as `METEOROLOGY-05.xlsx`. | `U+00B0` (`°`) ×26, `U+FEFF` ×2 (interior `\uFEFF` before trailing `.` in Q#3 option D). **2 shared-stem pairs** (after stripping number): Q#1 vs Q#30 (different options/answer) and Q#26 vs Q#31 (different formatting/order). |

#### Redacted Structural Patterns Observed

**DOCX OOXML Pattern (`METEOROLOGY-01` & `METEOROLOGY-08`):**
```xml
<!-- Question stem paragraph (plain) -->
<w:p><w:r><w:t>1. &lt;question stem text&gt;</w:t></w:r></w:p>
<!-- Incorrect option paragraph (plain) -->
<w:p><w:r><w:t>a) &lt;option A text&gt;</w:t></w:r></w:p>
<!-- Correct option paragraph (bold on both pPr/rPr and r/rPr) -->
<w:p>
  <w:pPr><w:rPr><w:b/><w:bCs/></w:rPr></w:pPr>
  <w:r><w:rPr><w:b/><w:bCs/></w:rPr><w:t>b) &lt;option B text&gt;</w:t></w:r>
</w:p>
<!-- Blank separator paragraph between questions -->
<w:p/>
```

**XLSX 2-Row Merged Institutional Header Schema (`METEOROLOGY-05` & `METEOROLOGY-08`):**
```text
Merges: A1:A2, B1:B2, C1:C2, D1:D2, E1:E2, F1:G1, H1:H2, I1:J1, K1:L1, M1:N1, O1:P1

Col:   A(1)          B(2)     C(3)          D(4)    E(5)         F(6)              G(7)              H(8)    I(9)                  J(10)                 K(11)                 L(12)                 M(13)                 N(14)                 O(15)                 P(16)
Row 1: Mã câu hỏi… | Tên Kho | Dạng câu hỏi | Mã Kho | Loại KT… | Nội dung câu hỏi (merged F1:G1)   | Đáp án | Phương án lựa chọn 1 (merged I1:J1)       | Phương án lựa chọn 2 (merged K1:L1)       | Phương án lựa chọn 3 (merged M1:N1)       | Phương án lựa chọn 4 (merged O1:P1)
Row 2: (merged)    | (mrg)   | (merged)     | (mrg)  | (merged) | Nội dung        | Giải thích      | (mrg)  | Nội dung            | Giải thích          | Nội dung            | Giải thích          | Nội dung            | Giải thích          | Nội dung            | Giải thích
Row 3: ""          | ""      | "SC"         | ""     | ""       | "1. <stem>"     | ""              | "3"    | "a) <opt 1>"        | ""                  | "b) <opt 2>"        | ""                  | "c) <opt 3>"        | ""                  | "d) <opt 4>"        | ""
```

---

### 1.2 Actual `parseImportInput()` Test Results Matrix

#### A. DOCX Files Across All 8 Answer Rules

| File | Answer Rule (`options.answerRule.mode`) | Format Detected | Actual GT | Parsed Total | Valid | Errors | Warnings | Missing Ans | Conflicts | Duplicates | Exact GT Answer Match | Opt Count / Order Preserved | Parse Time (ms) |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|
| `METEOROLOGY-01 (133).docx` | `auto` | `docx_ooxml` | 133 | **133** | **133** | 0 | 1 | 0 | 0 | 1 *(false positive!)* | **133/133 (100%)** | 133/133 (4 opts, A–D) | `76.0` *(cold)* / `27.6` *(warm)* |
| `METEOROLOGY-01 (133).docx` | `docx_bold` | `docx_ooxml` | 133 | **133** | **133** | 0 | 1 | 0 | 0 | 1 *(false positive!)* | **133/133 (100%)** | 133/133 (4 opts, A–D) | `62.7` |
| `METEOROLOGY-01 (133).docx` | `docx_highlight` | `docx_ooxml` | 133 | 133 | 0 | 133 | 1 | 133 | 0 | 1 | `0/133` *(expected: no highlights)* | 133/133 | `42.9` |
| `METEOROLOGY-01 (133).docx` | `docx_font_color` | `docx_ooxml` | 133 | 133 | 0 | 133 | 1 | 133 | 0 | 1 | `0/133` *(expected: black text only)* | 133/133 | `40.2` |
| `METEOROLOGY-01 (133).docx` | `docx_underline` | `docx_ooxml` | 133 | 133 | 0 | 133 | 1 | 133 | 0 | 1 | `0/133` *(expected: no underline)* | 133/133 | `35.0` |
| `METEOROLOGY-01 (133).docx` | `inline_answer_key` | `docx_ooxml` | 133 | 133 | 0 | 133 | 1 | 133 | 0 | 1 | `0/133` *(expected: no key lines)* | 133/133 | `36.8` |
| `METEOROLOGY-01 (133).docx` | `end_answer_key` | `docx_ooxml` | 133 | 133 | 0 | 133 | 1 | 133 | 0 | 1 | `0/133` *(expected: no end key)* | 133/133 | `35.3` |
| `METEOROLOGY-01 (133).docx` | `asterisk_prefix` | `docx_ooxml` | 133 | 133 | 0 | 133 | 1 | 133 | 0 | 1 | `0/133` *(expected: no asterisks)* | 133/133 | `33.7` |
| `METEOROLOGY-08 (62).docx` | `auto` | `docx_ooxml` | 62 | **62** | **62** | 0 | 1 | 0 | 0 | 1 *(re-ordered dup)* | **62/62 (100%)** | 62/62 (4 opts, A–D) | `22.8` *(cold)* / `13.2` *(warm)* |
| `METEOROLOGY-08 (62).docx` | `docx_bold` | `docx_ooxml` | 62 | **62** | **62** | 0 | 1 | 0 | 0 | 1 | **62/62 (100%)** | 62/62 (4 opts, A–D) | `18.3` |
| `METEOROLOGY-08 (62).docx` | `docx_highlight` / `color` / `underline` / `inline_key` / `end_key` / `asterisk` | `docx_ooxml` | 62 | 62 | 0 | 62 | 1 | 62 | 0 | 1 | `0/62` *(honest deterministic fail)* | 62/62 | `16.5–18.7` |

**DOCX Qualitative Checks:**
- **Determinism:** Non-matching rules honestly emit `NO_CORRECT_ANSWER` on 100% of items (zero silent guessing).
- **Content Integrity:** Question number prefixes (`1. `..`133. `) and option prefixes (`a) `..`d) `) are cleanly stripped from `prompt` and `option.content`, while technical aviation notation (`FL 300`, `hPa`, `°C`, `QNH`, `QFE`, `ITCZ`, `CBS`, `CAT`, `GAMET`, plus source `U+0421` in Q#67) is preserved verbatim.
- **Chapters:** `detectedChapters: []` (expected; neither DOCX contains in-body `Chapter`/`Chương` lines—chapter identity exists only in the filename).

#### B. XLSX Files Across Auto, Manual Header Mapping, and No-Header Workaround

| File | Mode Tested | Format Detected | Actual GT | Parsed Total | Valid | Errors | Warnings | Missing Ans | Exact GT Match | Issue Breakdown |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| `METEOROLOGY-05 (24).xlsx` | **Default `auto`** (as uploaded in Wizard) | `xlsx_generic` | 24 | **25** *(Row 2 leaked!)* | **0** | **25** | 1 | 21 | **0/24 (0%)** | `EMPTY_PROMPT`: 24, `TOO_FEW_OPTIONS`: 24, `NO_CORRECT_ANSWER`: 21, `INVALID_CORRECT_ANSWER`: 21, `DUPLICATE_OPTIONS`: 1 |
| `METEOROLOGY-05 (24).xlsx` | **Manual Step-3 Mapping** (Row-1 headers) | `xlsx_generic` | 24 | **25** | **0** | **25** | 1 | 1 | **0/24 (0%)** | `EMPTY_PROMPT`: 24, `DUPLICATE_OPTIONS`: 3, `NO_CORRECT_ANSWER`: 1, `INVALID_CORRECT_ANSWER`: 1 *(all 24 data rows collapse to empty `short_answer`!)* |
| `METEOROLOGY-05 (24).xlsx` | **`hasHeaderRow: false` + `Column 6/9/11/13/15/8`** | `xlsx_generic` | 24 | **26** *(Rows 1 & 2 leaked!)* | **24** | 2 | 1 | 2 | 24/24 on data rows *(but 2 broken header rows + literal `1.` & `a)` prefixes kept!)* | `INVALID_CORRECT_ANSWER`: 2, `NO_CORRECT_ANSWER`: 2, `DUPLICATE_OPTIONS`: 3 |
| `METEOROLOGY-08 (62).xlsx` | **Default `auto`** (as uploaded in Wizard) | `xlsx_generic` | 62 | **63** *(Row 2 leaked!)* | **0** | **63** | 1 | 43 | **0/62 (0%)** | `EMPTY_PROMPT`: 62, `TOO_FEW_OPTIONS`: 62, `NO_CORRECT_ANSWER`: 43, `INVALID_CORRECT_ANSWER`: 43, `DUPLICATE_OPTIONS`: 1 |
| `METEOROLOGY-08 (62).xlsx` | **Manual Step-3 Mapping** (Row-1 headers) | `xlsx_generic` | 62 | **63** | **0** | **63** | 1 | 1 | **0/62 (0%)** | `EMPTY_PROMPT`: 62, `DUPLICATE_OPTIONS`: 3, `NO_CORRECT_ANSWER`: 1, `INVALID_CORRECT_ANSWER`: 1 *(all 62 data rows collapse to empty `short_answer`!)* |
| `METEOROLOGY-08 (62).xlsx` | **`hasHeaderRow: false` + `Column 6/9/11/13/15/8`** | `xlsx_generic` | 62 | **64** *(Rows 1 & 2 leaked!)* | **62** | 2 | 1 | 2 | 62/62 on data rows *(2 broken header rows + literal `1.` & `a)` prefixes + interior `U+FEFF` in Q#3 opt D!)* | `INVALID_CORRECT_ANSWER`: 2, `NO_CORRECT_ANSWER`: 2, `DUPLICATE_OPTIONS`: 3 |

---

### 1.3 Real Parser & Import Wizard Bugs Found (with Deterministic Fixes)

#### `[IMP-01]` **P0 — Multi-Row Merged Headers & Duplicate Column Overwrites Break All Real XLSX Imports (`0/24`, `0/62`)**
- **Files & Lines:** `src/lib/import/xlsx-parser.ts:118-166`, `src/lib/import/tabular-mapper.ts:333-346`, `src/components/import/StepFormatAndRules.tsx:345-350`.
- **Structural Root Cause:**
  1. In both real `.xlsx` files, Row 1 merges two columns per question/option (`F1:G1` = `"Nội dung câu hỏi"`, `I1:J1`..`O1:P1` = `"Phương án lựa chọn 1..4"`), and Row 2 holds subheaders (`"Nội dung"` vs `"Giải thích"`).
  2. ExcelJS repeats the master cell's text across merged sibling cells, producing duplicate header strings in `rawMatrix[0]`, while `xlsx-parser.ts:154-156` unconditionally assumes a **1-row header** and pushes Row 2 into `dataRows` as Question #1.
  3. `tabular-mapper.ts:334-337` indexes headers via `headerIndex.set(h, i)`, so the **second** duplicate column (`"Giải thích"`, always empty!) overwrites the **first** column (`"Nội dung"`, where actual text lives). Even manual column mapping in Step 3 fails with **`0/24` and `0/62` valid**, and `StepFormatAndRules.tsx:346` emits 5 duplicate React `<SelectItem key={col} value={col}>` keys!
- **Deterministic Fix:**
  1. Inspect `worksheet.model.merges` in `parseXlsxBuffer()`. Whenever Row 1 contains horizontal merges spanning ≥2 columns AND Row 2 contains distinct non-empty subheaders under those merged ranges (and vertical merges `A1:A2` on single columns), automatically synthesize **unique composite 2-row headers**: e.g. `"Nội dung câu hỏi — Nội dung"`, `"Nội dung câu hỏi — Giải thích"`, `"Phương án lựa chọn 1 — Nội dung"`, `"Phương án lựa chọn 1 — Giải thích"`, and start `dataRows` at Row 3 (exposing a configurable `headerRowCount: 1 | 2` toggle in Step 2).
  2. Always deduplicate any remaining identical header labels deterministically (`"Header"`, `"Header (2)"`) AND key `StepFormatAndRules` `<SelectItem>` by column index or guaranteed-unique header label.

#### `[IMP-02]` **P0 — Single-Letter Substring Matching in `suggestColumnMapping()` Mis-Maps Vietnamese Headers**
- **File & Lines:** `src/lib/import/tabular-mapper.ts:21-130`.
- **Structural Root Cause:** `findHeader()` runs a fallback `.includes(candidate)` pass with 1-character candidates (`"a"`, `"b"`, `"c"`, `"d"`, `"e"`, `"f"`) and broad `"câu hỏi"` substring matching without excluding ID/type columns. On the real 16-column headers, this produced:
  - `prompt` → `"Mã câu hỏi\n(Theo quy định)"` (matched `"câu hỏi"` before `"Nội dung câu hỏi"` — **empty column!**)
  - `optionA` → `"Phương án lựa chọn 1"` (accidentally matched ASCII `"a"` inside `"lựa"`!)
  - `optionC` → `"Mã câu hỏi\n(Theo quy định)"` (matched ASCII `"c"` inside `"câu"`!)
  - `optionD` → `"Dạng câu hỏi"` (matched ASCII `"d"` inside `"Dạng"`, containing `"SC"`, which caused 20 rows with `Đáp án = "1"` to falsely mark `"SC"` as the correct answer!)
  - `optionE` → `"Mã câu hỏi\n(Theo quy định)"` (matched ASCII `"e"` inside `"Theo"`!)
- **Deterministic Fix:**
  1. **NEVER** run `.includes()` on 1-character candidates (`"a"`–`"f"`): single letters may match **exact equality only** (`h.trim().toLowerCase() === candidate`).
  2. Add explicit Vietnamese institutional template candidates with priority ordering:
     - `prompt`: exact/composite `"nội dung câu hỏi — nội dung"`, `"nội dung câu hỏi"`, `"question text"`, `"câu hỏi"` (explicitly excluding headers containing `"mã "` / `"code"` / `"id"` / `"dạng"` / `"loại"` / `"giải thích"`).
     - `optionA..F`: `"phương án lựa chọn 1 — nội dung"`, `"phương án lựa chọn 1"`, `"phương án 1"`, `"lựa chọn 1"` (and 2..6), explicitly excluding `"giải thích"` subcolumns.
     - `questionType`: add `"dạng câu hỏi"`, `"dang cau hoi"`.
     - `explanation`: match `"nội dung câu hỏi — giải thích"` cleanly.
  3. Track already-assigned column indices so one column can never be auto-mapped to multiple fields (`prompt`, `optionC`, `optionE` simultaneously).

#### `[IMP-03]` **P1 — Prompt-Only Duplicate Detection Causes Silent Data Loss of Valid Distinct Questions**
- **Files & Lines:** `src/lib/import/validator.ts:186-200`, `src/app/api/import/commit/route.ts:282-302`, `src/components/import/ImportWizard.tsx:109`.
- **Observed Repro on Real Files:**
  - `METEOROLOGY-01. THE ATMOSTPHERE (133).docx`: Question #20 and Question #30 have the exact same 42-character stem, **but 4 completely different options and different correct answers** (`optionsIdentical: false`, `correctSame: false`).
  - `METEOROLOGY-05. PRECIPITATION (24).xlsx`: Row 14 and Row 20 share the exact same stem (after number stripping), **different options & different correct answer**.
  - `METEOROLOGY-08. CLIMATOLOGY (62).xlsx`: Row 3 and Row 32 share the exact same stem (after number stripping), **different options & different correct answer**.
  - Because `validateImportBatch()` and `/api/import/commit` compare ONLY `normalizeForComparison(q.prompt)`, AND `ImportWizard` defaults to `duplicatePolicy = "skip"`, committing `METEOROLOGY-01` **silently drops Q#30 (132 saved instead of 133)!**
- **Deterministic Fix:** Compute duplicate fingerprint for choice questions using **prompt + sorted normalized option texts** (`${normPrompt}||${sortedNormOptions.join("|")}`) for `EXACT_DUPLICATE` (safe to skip under `duplicatePolicy: "skip"`). If only `normPrompt` matches while options differ, emit a non-blocking informational warning (`SAME_PROMPT_DIFFERENT_OPTIONS`) and **NEVER** auto-skip it on commit!

#### `[IMP-04]` **P1 — `parseQuestionTypeValue()` Ignores Institutional Codes `"SC"` / `"MC"` / `"TF"`**
- **File & Lines:** `src/lib/import/tabular-mapper.ts:173-210`.
- **Root Cause:** Both real `.xlsx` files store `"SC"` (Single Choice) in `Dạng câu hỏi` on 100% of rows (`24/24` and `62/62`). `parseQuestionTypeValue("SC")` returns `null`.
- **Deterministic Fix:** Map `"sc"` / `"single"` / `"một đáp án"` → `"single_choice"`, `"mc"` / `"nhiều đáp án"` → `"multiple_choice"`, `"tf"` / `"đúng sai"` → `"true_false"`.

#### `[IMP-05]` **P1 — Stale `columnMapping` Persists Across `hasHeaderRow` Toggle in `ImportWizard`**
- **File & Lines:** `src/components/import/ImportWizard.tsx:144-148, 195-197, 498`.
- **Root Cause:** Toggling `hasHeaderRow` in Step 2 changes `detectedColumns` (e.g., Row-1 Vietnamese headers ↔ `Column 1..16`), but `ImportWizard` never clears `columnMapping`, and line 195 (`if (data.suggestedMapping && !columnMapping.prompt)`) refuses to update `columnMapping` when `prompt` is still set from the prior parse.
- **Deterministic Fix:** Clear `columnMapping` whenever `hasHeaderRow`, `selectedSheet`, or `formatOverride` changes, and immediately trigger re-parse when `hasHeaderRow` toggles so Step 2 updates `detectedColumns` and `sampleRows` live.

#### `[IMP-06]` **P1 — DOCX Spec Violation (`pPr > w:rPr` Inherited Into Runs) + Unimplemented `<w:br/>` Splitting + Broken `/docx-media/` URLs**
- **Files & Lines:** `src/lib/import/docx-ooxml-parser.ts:552-560`, `1086`, `1148-1155`; `src/lib/import/index.ts:123-130`.
- **Root Causes:**
  1. **ECMA-376 §17.3.1.29 Violation (`docx-ooxml-parser.ts:552-560`):** `<w:pPr><w:rPr>` formats only the paragraph mark (`¶`), NOT child `<w:r>` runs. Merging `pPrRunOverride` into `paragraphBaseFmt` causes false-positive bold/color answers whenever a Word paragraph retains stale `<w:pPr><w:rPr><w:b/>` after runs were unbolded.
  2. **Unimplemented `<w:br/>` Splitting (`docx-ooxml-parser.ts:1149-1155`):** Comment states `// Handle paragraphs that contain internal line breaks (<w:br/>)`, yet `processParagraph` never splits runs on `\n`. Any Word file using Shift+Enter (`<w:br/>`) between a question and `A./B./C./D.` merges the entire question and all 4 options into a single prompt with `0` options.
  3. **Broken Embedded Media URLs (`docx-ooxml-parser.ts:1086` + `index.ts:123`):** Extracted DOCX images are assigned `previewPath = "/docx-media/" + safeFileName`, then `bytes` are discarded in `index.ts:123`, and no `/docx-media/*` route or Storage upload exists—persisting broken 404 image links into `questions.prompt_image_url`.
- **Deterministic Fixes:** (1) Remove `pPrRunOverride` from `paragraphBaseFmt` (keep style inheritance from `docDefaults` + `pStyle` + `rStyle` + direct `w:r/w:rPr` only); (2) Split `DocxParagraph` on `\n` across `para.runs` into virtual sub-paragraphs preserving exact per-run formatting before state-machine dispatch; (3) Upload validated DOCX images to Supabase Storage `study-media/` during commit (or return base64 data-URL thumbnails strictly for in-memory Step-4 preview and upload on commit).

#### `[IMP-07]` **P2 — XLSX Option Label Doubling (`[A] a) ...`) & Interior `U+FEFF` Characters**
- **Files & Lines:** `src/lib/import/tabular-mapper.ts:411-420`, `src/lib/import/text-utils.ts:6-22`.
- **Observed Repro on Real Files:**
  - `100%` of option cells in both real XLSX files (`96/96` in `METEOROLOGY-05`, `248/248` in `METEOROLOGY-08`) start with `a) ` / `b) ` / `c) ` / `d) `, and `100%` of prompts (`24/24`, `62/62`) start with `1. `..`62. `. StudyHub renders `[A]`, `[B]`, `[C]`, `[D]` badges alongside `opt.content`, displaying redundant `[A] a) ...` in exams/practice (and making option shuffling confusing when shuffled option 1 reads `[A] c) ...`!).
  - `METEOROLOGY-08.xlsx` Row 5 C15 (Q#3 opt D) contains an interior zero-width BOM `U+FEFF` (`"<redacted option text>\uFEFF."`) that survives `stripUtf8Bom()` (which only checks index `0`) and `.trim()`.
- **Deterministic Fix:** Strip invisible zero-width BOM (`\uFEFF`) globally in `normalizeText()`, and offer a deterministic option (enabled by default in Step 2 for tabular imports) to strip leading `^[A-Ha-h][.)]\s+` from option cells when ≥80% of option cells in the sheet carry matching letter prefixes, plus leading `^\d+[.)]\s+` from prompt cells—without ever modifying technical content.

---

## 2. Import Performance Benchmark (Separated Stages)

### 2.1 Methodology
- Executed StudyHub's actual functions (`parseDocxBuffer`, `parseEduQuizText`, `parseXlsxBuffer`, `validateImportBatch`, `chunkArray`, and exact `/api/import/commit` row-shaping + `JSON.stringify` payload serialization) in Node `v24.15.0` via Vite SSR loader (zero jsdom overhead, realistic server Route Handler timing).
- Warmed up V8 JIT prior to recording; reported **median** of 3 runs (`≤1,000` Qs) / 2 runs (`5,000–10,000` Qs).
- **Size `133` in the DOCX table is the REAL `sample-data/METEOROLOGY-01. THE ATMOSTPHERE (133).docx` file.** All other sizes use structurally equivalent generated DOCX/TXT/XLSX files written to and read from disk (`scratch/bench-tmp/`, deleted immediately after run).
- **Live DB Insertion Note (Honest Status):** Live PostgreSQL / Supabase insertion latency is **BLOCKED** in this Wave 1 environment (Docker Desktop daemon stopped; no `.env.local` Supabase instance). Instead, exact batch counts, row counts, HTTP/PostgREST JSON payload sizes, and PostgREST insert call counts are measured directly from the actual commit data structures.

### 2.2 Separated-Stage Benchmark — DOCX (`parseDocxBuffer` + `validateImportBatch` + Commit Batch Prep)

| Questions | Source | File Size (KB) | Stage 1: File Read (ms) | Stage 2: Parse (ms) | Stage 3: Validate & Dupes (ms) | Stage 4: Chunk Batch Prep (ms) | **Total CPU+IO (ms)** | Step-5 Single-Keystroke Reval (ms) | 500-Q Chunks | Max Chunk Client JSON (KB) | Total Client JSON (MB) | Est. DB Insert Payload (MB) | DB Rows (`questions` + `options`) | PostgREST Insert Calls | Live DB Insert |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| **50** | Synth DOCX | 2.7 | 0.73 | 2.91 | 0.31 | 0.39 | **4.34** | 0.26 | 1 | 93.8 | 0.09 | 0.08 | 50 + 200 | 2 | BLOCKED *(no live DB)* |
| **133** | **REAL `01.docx`** | **33.8** | **0.26** | **27.71** | **0.87** | **1.89** | **30.72** | **0.75** | **1** | **209.9** | **0.20** | **0.20** | **133 + 532** | **2** | BLOCKED *(no live DB)* |
| **226** | Synth DOCX | 6.5 | 0.89 | 8.33 | 1.07 | 1.97 | **12.26** | 0.85 | 1 | 424.9 | 0.41 | 0.38 | 226 + 904 | 2 | BLOCKED *(no live DB)* |
| **500** | Synth DOCX | 12.3 | 0.88 | 19.22 | 2.53 | 9.01 | **31.63** | 7.03 | 1 | 941.4 | 0.92 | 0.83 | 500 + 2,000 | 3 | BLOCKED *(no live DB)* |
| **600** | Synth DOCX | 14.4 | 3.10 | 65.27 | 6.72 | 21.92 | **97.02** | 9.71 | 2 | 941.4 | 1.10 | 1.00 | 600 + 2,400 | 5 | BLOCKED *(no live DB)* |
| **1,000** | Synth DOCX | 22.9 | 1.49 | 96.65 | 9.30 | 19.25 | **126.70** | 8.33 | 2 | 943.0 | 1.84 | 1.66 | 1,000 + 4,000 | 6 | BLOCKED *(no live DB)* |
| **5,000** | Synth DOCX | 107.4 | 3.06 | 459.20 | 45.24 | 87.25 | **594.76** | **39.77** | 10 | 950.6 | 9.27 | 8.35 | 5,000 + 20,000 | 30 | BLOCKED *(no live DB)* |
| **10,000** | Synth DOCX | 213.0 | 3.31 | 936.16 | 94.52 | 164.47 | **1,198.46** | **105.53** | 20 | 950.9 | **18.55** | **16.71** | 10,000 + 40,000 | 60 | BLOCKED *(no live DB)* |

*(Note: Real `METEOROLOGY-01 (133).docx` takes `27.71 ms` to parse vs `8.33 ms` for synthetic 226-Q DOCX because Microsoft Word emits verbose `<w:rsidR>`, `<w:rFonts>`, `<w:sz>`, `<w:lang>` attributes making `word/document.xml` `447 KB` for 133 questions—~`3.36 KB`/question vs ~`0.55 KB`/question in minimal OOXML. A real Word-authored 10,000-question `.docx` will therefore have a ~`33 MB` `word/document.xml`, approaching the `50 MB` uncompressed ZIP guard and taking ~`2.1–2.8 s` to parse!)*

### 2.3 Separated-Stage Benchmark — EduQuiz TXT & XLSX (`ExcelJS`) Across All Sizes

| Questions | TXT File (KB) | TXT Read (ms) | TXT Parse (ms) | TXT Validate (ms) | TXT Batch Prep (ms) | **TXT Total (ms)** | XLSX File (KB) | XLSX Read (ms) | XLSX Parse (ms) | XLSX Validate (ms) | XLSX Batch Prep (ms) | **XLSX Total (ms)** | XLSX DB Payload (MB) |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **50** | 17.2 | 1.30 | 1.43 | 0.70 | 0.54 | **3.97** | 9.2 | 1.46 | 9.91 | 0.49 | 0.54 | **12.39** | 0.10 |
| **133** | 46.1 | 0.91 | 0.82 | 1.01 | 3.05 | **5.79** | 13.4 | 1.48 | 12.53 | 1.63 | 1.92 | **17.56** | 0.26 |
| **226** | 78.7 | 0.59 | 0.96 | 0.93 | 1.73 | **4.21** | 18.3 | 1.86 | 13.72 | 3.23 | 3.32 | **22.13** | 0.44 |
| **500** | 174.9 | 2.72 | 5.70 | 4.29 | 7.26 | **19.97** | 32.0 | 1.53 | 34.33 | 4.53 | 7.48 | **47.86** | 0.97 |
| **600** | 210.0 | 3.25 | 3.76 | 4.50 | 7.77 | **19.27** | 36.9 | 1.62 | 37.05 | 5.22 | 9.21 | **53.10** | 1.16 |
| **1,000** | 350.4 | 2.26 | 5.40 | 9.69 | 15.16 | **32.50** | 56.6 | 1.61 | 56.45 | 9.34 | 16.79 | **84.20** | 1.94 |
| **5,000** | 1,777.9 | 9.51 | 38.24 | 56.07 | 84.42 | **188.24** | 254.7 | 3.35 | 290.70 | 53.87 | 83.60 | **431.53** | 9.73 |
| **10,000** | 3,562.3 | 16.06 | 88.41 | 105.59 | 151.81 | **361.87** | 501.2 | 1.40 | 608.24 | 92.06 | 178.73 | **880.43** | 19.48 |

### 2.4 All 4 Real `sample-data/` Files — Separated Stages & Unused Payload Bloat

| Real File | Size (KB) | File Read (ms) | Parse (ms) | Validate (ms) | Batch Prep (ms) | **Total (ms)** | Current JSON Payload (KB) | Without Unused `rawSource` & `formatting` (KB) | **Payload Bloat** |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `METEOROLOGY-01. THE ATMOSTPHERE (133).docx` | 33.8 | 0.24 | 27.60 | 0.84 | 0.79 | **29.47** | 209.6 | 130.4 | **37.8%** |
| `METEOROLOGY-05. PRECIPITATION (24).xlsx` | 14.9 | 0.22 | 5.27 | 0.09 | 0.09 | **5.66** | 25.2 | 25.2 | 0.0% |
| `METEOROLOGY-08. CLIMATOLOGY (62).docx` | 23.1 | 0.27 | 13.16 | 0.37 | 0.37 | **14.16** | 97.8 | 60.9 | **37.7%** |
| `METEOROLOGY-08. CLIMATOLOGY (62).xlsx` | 20.2 | 0.25 | 6.18 | 0.14 | 0.21 | **6.78** | 59.9 | 59.9 | 0.0% |

**Key Import Pipeline Bottlenecks Exposed by Measurements:**
1. **`37.8%` Dead JSON Bloat (`P2`):** `docx-ooxml-parser.ts:967`, `eduquiz-parser.ts:274`, and `quizlet-parser.ts:100` attach `rawSource` (full duplicated question + options text), which is **never read by any UI or API route** (verified via full `src/` grep). On 10,000 DOCX questions, `rawSource` + `formatting` adds **~7.0 MB** to `/api/import/parse` responses and `/api/import/commit` chunk uploads!
2. **Triple Redundant Full-File Upload & Re-Parse (`P2`):** `ImportWizard.tsx:478, 512, 527` unconditionally calls `runServerParse()` on Step 1→2, Step 2→3, AND Step 3→4—even when no format/rule/mapping options changed—transmitting **~55.6 MB** of parsed JSON for a 10,000-Q DOCX across 3 clicks!
3. **`105.53 ms` Synchronous Main-Thread Freeze Per Keystroke (`P1`):** In Step 5 (`ImportWizard.tsx:236-247` + `VirtualizedPreviewList.tsx:600-605`), every single character typed inside an inline edit box clones all `10,000` questions and synchronously runs full `validateImportBatch(nextList)` (`105.53 ms`, **6.3× over the 16.6 ms 60fps frame budget**).
4. **10,000 Row-Level Trigger Executions + `O(N²)` Duplicate Fetches on Commit (`P0` / `P1`):**
   - `trg_sync_study_set_question_count` (`supabase/migrations/0003_functions_and_triggers.sql:119-143`) is `FOR EACH ROW`: importing 10,000 questions fires **10,000 separate `UPDATE public.study_sets SET question_count = question_count + 1`** statements on the **same single row**, creating 10,000 dead tuples and row-lock churn!
   - `POST /api/import/commit` (`src/app/api/import/commit/route.ts:277-280`) fetches ALL existing `questions(id, prompt)` from DB on **every single chunk** (20 times for 10,000 Qs) without pagination—both wasting `O(chunks × N)` I/O AND silently truncating at **PostgREST's `max_rows = 1000`**, breaking duplicate detection past 1,000 rows!
   - `POST /api/import/commit` (`line 156`) runs `.contains("source_metadata", { import_idempotency_key })` on every chunk without a GIN index on `questions.source_metadata` (`0001_initial_schema.sql`), forcing a full scan of the set's questions per chunk.

---

## 3. Large Bank (`10,000` Qs) & Long Exam (`250` / `500` / `1,000` Qs) Performance Audit

### 3.1 Exam Generation, Scoring & Local Draft Latency Benchmark (`10,000`-Question Pool)

Measured in Node `v24.15.0` (median of 5 runs) reproducing `POST /api/exams`, `scoreExamAttempt()`, and `LiveExamRunner.writeLocalDraft()`:

| Exam Size (from 10k Pool) | Current Full-Pool `cryptoShuffle(10k)` (ms) | Optimized `O(K)` Partial Sample (ms) | Snapshot Build + Option Shuffle (ms) | Pre-Submit Sanitize (ms) | **Total In-Memory Gen (ms)** | `scoreExamAttempt` (ms) | `writeLocalDraft` `JSON.stringify` per Click (ms / KB) | RPC `p_questions` Payload (KB) | Pre-Submit Client Payload (KB) | **`.in("question_id", ids)` PostgREST URL Query Size (Bytes)** |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **250** | 0.82 | 0.04 *(20× faster)* | 0.84 | 0.08 | **1.74** | 0.32 | 0.09 ms / 33.4 KB | 301.5 | 261.5 | **`9,266 B`** *(>8 KB proxy limit!)* |
| **500** | 0.69 | 0.05 *(14× faster)* | 1.87 | 0.12 | **2.68** | 0.39 | 0.19 ms / 66.8 KB | 603.1 | 523.0 | **`18,516 B`** *(HTTP 414 crash!)* |
| **1,000** | 0.72 | 0.08 *(9× faster)* | 2.84 | 0.16 | **3.72** | 0.87 | 0.50 ms / 133.7 KB | 1,206.3 | 1,046.2 | **`37,016 B`** *(HTTP 414 crash!)* |

**Critical Takeaway:** Pure JS exam sampling and scoring take `< 4 ms` even for 1,000 questions from a 10,000-question pool! The **real showstoppers** are **PostgREST query limits, SQL RPC loops/caps, and React DOM/render architecture**, detailed below.

---

### 3.2 Database, PostgREST & API Scalability Audit (`N+1`, Silent Truncation, Hard Caps)

| ID | Sev | Endpoint / SQL Artifact | Exact Location | Bottleneck / Failure Mode on 250–1,000-Q Exams or 10,000-Q Banks | Deterministic Fix |
|---|---|---|---|---|---|
| **`DB-01`** | **P0** | `POST /api/exams` + `createExamSchema` + `create_exam_attempt` | `src/app/api/exams/route.ts:137-227`, `src/lib/validation/exams.ts:13,25`, `supabase/migrations/0003_functions_and_triggers.sql:573` | **Triple showstopper:** (1) Hard-capped at **500 questions** in Zod (`max(500)`), SQL (`v_total > 500`), and `TestHubClient:227,387`—blocking 600/1,000-Q exams; (2) Candidate fetch (`line 153`) has no pagination → **silently truncated at PostgREST 1,000 rows** (questions 1,001–10,000 are NEVER sampled!); (3) `.in("question_id", selectedIds)` sends **`9.3 KB` / `18.5 KB` / `37.0 KB` URLs** (`HTTP 414`) AND **silently truncates `question_options` at 1,000 rows** (questions #251–#1,000 in 500/1,000-Q exams get **ZERO options**!). | Move candidate selection + sampling + snapshot creation into a single parameterized PostgreSQL RPC (receiving filter params + `question_count` up to `2000`), or chunk `.in()` fetches in batches of `<= 150` UUIDs (~5.5 KB URL, <=600 options/call) after paginated/keyset candidate ID fetch. |
| **`DB-02`** | **P0** | `GET /api/sets/[id]/questions` | `src/app/api/sets/[id]/questions/route.ts:37-156` | `StudySetHub` (`line 96`), `QuestionEditorView` (`line 224`), and `fetchStudySetQuestions` (`api-client.ts:153`) all request **`pageSize=500`**. Passing 500 UUIDs into 5 parallel `.in("question_id", questionIds)` calls sends **`18.5 KB` URLs** AND **silently truncates `question_options` (2,000 rows) at 1,000 rows**, leaving questions #251–#500 with **empty options**! Also uses `OFFSET` pagination (`.range(from, to)`) and unindexed `ilike.%...%` across 3 text columns. | Cap `pageSize <= 100` (<=400 options, ~3.7 KB URL) or use Supabase nested select (`questions(*, question_options(*), question_accepted_answers(*))`) with keyset cursor pagination `(position, id) > (...)` and `pg_trgm` GIN index for search. |
| **`DB-03`** | **P0** | `GET /api/sets/[id]/export` & `POST /api/sets/[id]/duplicate` | `src/app/api/sets/[id]/export/route.ts:64-94`, `src/app/api/sets/[id]/duplicate/route.ts:82-102` | Export fetches `PAGE_SIZE = 1000` questions then passes **all 1,000 UUIDs (`37 KB` URL!)** into `.in("question_id", qIds)`, crashing URL limits and truncating 4,000 options to 1,000. Duplicate fetches all `questions` + `question_options` with **zero pagination**, silently corrupting cloned sets >250 questions! | Export: page `150` questions at a time (or chunk `.in()` to `<= 150` UUIDs). Duplicate: implement atomic server-side SQL RPC `duplicate_study_set(p_source_id, p_title, p_folder_id)` (1 DB round-trip, zero PostgREST row caps!). |
| **`DB-04`** | **P1** | `POST /api/import/commit` & `POST /api/import/parse` | `src/app/api/import/commit/route.ts:156, 277`, `src/app/api/import/parse/route.ts:188`, `0003_functions_and_triggers.sql:119-143`, `0001_initial_schema.sql` | (1) `trg_sync_study_set_question_count` runs `FOR EACH ROW` → **10,000 `UPDATE study_sets` writes** during 10k import; (2) `commit` re-fetches `existingRows` on every chunk (20×) and both `parse` & `commit` get silently capped at 1,000 rows by PostgREST; (3) `source_metadata @>` idempotency check lacks a GIN index. | Replace row trigger with `FOR EACH STATEMENT` transition-table trigger (`REFERENCING NEW TABLE`); store `import_idempotency_key` in a dedicated indexed column or partial GIN index; perform server-side duplicate checks via SQL RPC with `md5(normalized_prompt || options_fingerprint)`. |
| **`DB-05`** | **P1** | `submit_exam_attempt()` & `create_exam_attempt()` SQL RPCs | `supabase/migrations/0003_functions_and_triggers.sql:345-482, 610-643` | Row-by-row PL/pgSQL `FOR` loops: on a 1,000-Q exam, `submit_exam_attempt()` executes **up to 6,000 individual SQL queries/updates** inside a `FOR UPDATE` transaction, and `create_exam_attempt()` executes **1,000 individual `INSERT`s**. Bonus integrity bug at `line 432`: multi-set exam progress writes primary `v_attempt.study_set_id` for questions belonging to `additional_study_set_ids`! | Refactor both RPCs to set-based SQL (`INSERT INTO ... SELECT ... FROM jsonb_array_elements(...) WITH ORDINALITY` and set-based `UPDATE exam_attempt_answers` + `INSERT INTO user_question_progress ... ON CONFLICT DO UPDATE`), joining `questions.study_set_id` for accurate multi-set attribution. |
| **`DB-06`** | **P1** | `GET /api/sets/[id]`, `GET /api/dashboard`, `GET /api/statistics`, `GET /api/mistakes` | `sets/[id]/route.ts:33-42`, `dashboard/route.ts:41-62`, `statistics/route.ts:74-93, 251-270`, `mistakes/route.ts:33-87` | All 4 routes fetch unpaginated full tables into Node JS (hitting PostgREST 1,000-row truncation on 10,000-Q sets so chapters/mastery/accuracy miscount). `statistics:269` passes up to 500 UUIDs (`18.5 KB` URL) into `.in("id", weakQuestionIds)`; `mistakes:52-86` passes ALL wrong question IDs into 4 `.in()` queries before JS slicing! | Replace JS-side counting with lightweight SQL aggregation RPCs (`get_study_set_summary`, `get_dashboard_kpis`, `get_user_statistics`) and push filtering + pagination into Postgres for `/api/mistakes`. |
| **`DB-07`** | **P1** | `PATCH / DELETE /api/sets/[id]/questions/bulk` & `PUT /api/exams/[attemptId]/answers` | `questions/bulk/route.ts:165,210,241`, `validation/exams.ts:38`, `LiveExamRunner.tsx:244` | `bulk` allows up to 1,000 UUIDs then passes all 1,000 directly into `.in("id", ...)` (`37 KB` URL crash). `saveExamAnswersSchema` caps `answers` at `max(200)`, while `LiveExamRunner.flushDirtyQueue()` sends ALL accumulated offline answers in one `PUT` (fails with `HTTP 400` if user answered >200 questions offline on a 250/500/1,000-Q exam!). | Chunk `.in()` operations in `bulk/route.ts` to `150` UUIDs; chunk `flushDirtyQueue()` in `LiveExamRunner.tsx` to batches of `100` items. |
| **`DB-08`** | **P2** | `PATCH /api/sets/[id]/questions/[questionId]` & `POST /api/exams` | `questions/[questionId]/route.ts:137-170`, `exams/route.ts:126-130` | **N+1 / Sequential Loops:** `PATCH question` loops sequentially `for (idx...) await supabase.from("question_options").update/insert(...)` (4–6 sequential DB round-trips per edit). `POST /api/exams` checks `additional_study_set_ids` access sequentially in a `for` loop instead of `Promise.all()`. | Batch new option inserts + run existing option updates via `Promise.all` (or single `upsert`); check `additional_study_set_ids` concurrently via `Promise.all()`. |

---

### 3.3 React Rendering, DOM Virtualization & Network Refetch Audit

| Component | File & Lines | Finding | Impact at 250 / 500 / 1,000-Q Exams or 10k Banks | Priority & Fix |
|---|---|---|---|---|
| **`LiveExamRunner`** | `src/components/exam/LiveExamRunner.tsx:132, 265, 364-396, 503-521, 859-865` | (1) `setInterval(tick, 500)` updates `remainingMs` state inside `LiveExamRunner`, **re-rendering the entire exam runner + `ExamNavigatorGrid` twice every second** for the entire exam duration; `answeredCount`/`flaggedCount` (`.filter()`) re-run twice/sec; `ExamNavigatorGrid` is NOT `React.memo`-wrapped and receives inline arrow callbacks (`onRequestSubmit={() => ...}`).<br>(2) `writeLocalDraft` synchronously calls `localStorage.setItem(JSON.stringify(nextFullMap))` (`33–134 KB`) on **every click/keystroke**.<br>(3) `staleTime: 0` refetches full `1 MB` attempt payload on remount. *(Good: Next/Prev question navigation calls local `setCurrentIndex` only—**zero** API refetches on question navigation!)* | 10,800+ unnecessary full-tree re-renders during a 90-min exam; main-thread jank on mobile/low-end laptops. | **P1:** Extract isolated `<ExamCountdownTimer />` leaf (tick every 1s only when displayed second changes); wrap `ExamNavigatorGrid` in `React.memo` with `useCallback`; debounce `writeLocalDraft` (e.g. `300 ms`) and set `staleTime: 60_000`. |
| **`ExamNavigatorGrid`** | `src/components/exam/ExamNavigatorGrid.tsx:38-53` | Uses `@tanstack/react-virtual` cleanly when `items.length > 80` (**good!**), mounting only ~14 visible rows (~70 tiles) even on 1,000-Q exams. However, it is not memoized and re-runs two full `.filter()` scans (`lines 38–39`) on every parent 500ms timer tick! | Redundant O(N) array scans twice per second. | **P2:** Wrap in `React.memo`; pass precomputed `answeredCount` / `flaggedCount` props from `LiveExamRunner`. |
| **`ExamResultsClient`** | `src/components/exam/ExamResultsClient.tsx:458-600, 140-170, 298` | **ZERO virtualization** on `filteredQuestions.map(...)`! Renders all 250 / 500 / 1,000 `<Card>` blocks + 4 options each simultaneously into the DOM (**~6,500 to ~26,000+ DOM nodes**). Also `handleRetakeSameExam` fails >500 Qs, and `wrongSourceQuestionIds.slice(0, 100)` silently drops wrong questions past 100 and stuffs ~3.7 KB into URL query params. | Severe layout/paint freeze (`1–3+ s`) on 500/1,000-Q exam results page. | **P1:** Virtualize question review list with `@tanstack/react-virtual` (or window-virtualizer) identical to `StudySetHub`; replace `?questionIds=` URL list with server-side session/filter (`?fromAttemptId=...&onlyWrong=1`). |
| **`TestHubClient`** | `src/components/exam/TestHubClient.tsx:72-78, 149-157, 227-230, 387` | Calls `useStudySetBundle(setId)` **unconditionally even when `activeAttemptId` is active!** Entering or refreshing `/sets/[id]/test?attemptId=...` triggers **4–7 wasted background API calls downloading up to 2,000 full questions + options** while `LiveExamRunner` is running! Also hard-caps custom exam count at `500` and misdisplays `"All (2000)"` on 10,000-Q sets because `fetchStudySetQuestions` stops at 2,000. | Multi-MB wasted network download & API load on every live exam launch/reload! | **P1:** Pass `{ enabled: !activeAttemptId }` to `useStudySetBundle` AND switch exam setup metadata to lightweight `GET /api/sets/[id]` summary (chapters, counts) instead of downloading 2,000 full questions! Raise custom cap to match `studySet.question_count` (up to `2,000`). |
| **`StudySetHub` & `QuestionEditorView`** | `src/components/library/study-set-hub.tsx:92, 96, 116, 420`; `src/components/editor/question-editor-view.tsx:220, 224, 612` | Both cleanly use `@tanstack/react-virtual` (**good!**), **BUT** (1) `search` input is **NOT debounced**, firing a full `/api/sets/[id]/questions?pageSize=500&search=...` request on **every keystroke**; (2) both request `pageSize=500`, triggering `DB-02`'s PostgREST 1,000-option truncation! (3) `StudySetHub:116` hardcodes `/api/starred?pageSize=500`, hiding star state beyond 500 starred items. | API request storm while typing + broken options past question #250 per page. | **P1:** Debounce `search` (`300 ms`), reduce `pageSize` to `100` (with infinite-scroll or page controls), and rely on `q.is_starred` already returned by `GET /api/sets/[id]/questions` instead of a redundant `/api/starred?pageSize=500` call! |
| **`VirtualizedPreviewList` & `ImportWizard`** | `src/components/import/VirtualizedPreviewList.tsx:64-95, 600`; `src/components/import/ImportWizard.tsx:236-247, 478-527` | Uses `@tanstack/react-virtual` cleanly for 10,000 rows (**good!**), **BUT** (1) every inline edit keystroke runs `validateImportBatch` over all 10,000 items (**`105.53 ms` measured**); (2) search input is undebounced and re-concatenates all 10,000 strings per keystroke; (3) Step 1→2→3→4 re-uploads & re-parses the full file 3 times. | Noticeable typing lag (`>100 ms` INP) & `55.6 MB` redundant traffic on 10k imports. | **P1:** Validate only the edited question (`validateParsedQuestion`) + O(1) incremental summary delta on keystroke (or debounce batch duplicate check `250 ms`); wrap `searchQuery` with `React.useDeferredValue`; skip redundant `runServerParse()` if options did not change since last parse! |
| **`PracticeClient`, `ReviewMistakesClient`, `StarredQuestionsClient`** | `PracticeClient.tsx:629-660, 1004`; `ReviewMistakesClient.tsx:480`; `StarredQuestionsClient.tsx:276` | `PracticeClient.renderNavigatorGrid()` mounts **all `items.length` (up to 2,000) `<button>` nodes unvirtualized** and re-renders all 2,000 on every click; `PracticeClient` completion wrong-list, `ReviewMistakesClient`, and `StarredQuestionsClient` also lack virtualization and pagination UI. | Sluggish UI on large practice sessions (`>200` questions) and large mistake/starred banks. | **P2:** Reuse virtualized `ExamNavigatorGrid` pattern in `PracticeClient`; virtualize or paginate mistake/starred review lists. |

---

### 3.4 Production JS Bundle Size Analysis (`.next/static/chunks`)

Measured directly from the existing Next.js `16.4.6` production build in `.next/`:

- **Total Static JS across all routes:** `63` chunks = **`2,829.2 KB` raw** / **`864.8 KB` gzip**
- **Total Static CSS:** `1` stylesheet (`0gdlg5eok0_vl.css`) = **`65.9 KB` raw** / **`12.4 KB` gzip**
- **Server-Only Import/Export Library Leakage Check:** **`0 bytes` leaked!** (`exceljs`, `jszip`, `fast-xml-parser`, `mammoth`, `papaparse` are 100% absent from `.next/static/chunks/*.js`).
- **Dynamic Chart Splitting Check:** Verified `dashboard-view.tsx:49-55` and `statistics-view.tsx:52-66` cleanly lazy-load `activity-charts.tsx` (`recharts` chunk `05s16foyd5yoh.js`, `451.2 KB raw / 126.8 KB gzip`) via `next/dynamic(..., { ssr: false })`.

#### Top 10 Largest Production Static Chunks

| Chunk File | Type | Raw (KB) | Gzip (KB) | Primary Contents |
|---|---|---:|---:|---|
| `05s16foyd5yoh.js` | JS (lazy) | **451.2** | **126.8** | `recharts` (dynamically imported only on `/dashboard` & `/statistics`) |
| `203vmyvolsmkg.js` | JS | **254.1** | **66.3** | `@supabase/supabase-js` + `@supabase/ssr` browser client |
| `39_j1bdzreq0m.js` | JS | 223.9 | 69.9 | React DOM + Next.js App Router runtime |
| `1uu5gp8gpfy_x.js` | JS | 161.7 | 44.3 | Next.js App Router & client hydration runtime |
| `0i8l4yfo0ioyj.js` | JS | 123.1 | 40.9 | `motion/react` animation engine |
| `0cz1d0mv5g_q7.js` | JS | 110.0 | 38.6 | Next.js browser polyfills |
| `0gdlg5eok0_vl.css` | CSS | 65.9 | 12.4 | Tailwind CSS v4 design tokens & utility bundle |
| `3pjpgf8nruio8.js` | JS | 64.8 | 17.8 | `ImportWizard` + `VirtualizedPreviewList` |
| `1exrgp2aj6lim.js` | JS | 56.2 | 17.4 | App shell / shared library view modules |
| `0g530e6s_oc1i.js` | JS | 55.1 | 16.9 | Learning / study mode shared UI components |

#### Key Route Initial Client JS Footprint (from `page_client-reference-manifest.js`)

| Route | Chunks | Initial JS Raw (KB) | Initial JS Gzip (KB) | Notable Libraries Included | Optimization Opportunity |
|---|---:|---:|---:|---|---|
| `/(app)/sets/[id]/edit` | 16 | **775.1** | **235.4** | React/Next, React Query, Radix, Lucide, Motion, **`@supabase`** | **P2:** Dynamically import `@/lib/supabase/client` only inside `handleImageUpload` (`question-editor-view.tsx:60,439`) → saves **`254.1 KB raw / 66.3 KB gzip` (-33%)**! |
| `/(app)/settings` | 15 | 720.4 | 220.8 | Same + `@supabase` | Expected (auth password/account operations); can lazy-load on mutation submit. |
| `/(app)/profile` | 14 | 680.5 | 208.4 | Same + `@supabase` | Dynamic-import Supabase client only on avatar upload. |
| `/(auth)/login` & `/register` | 13 | 634.7–637.8 | 193.2–193.9 | Same + `@supabase` | Healthy; auth pages require Supabase Auth SDK. |
| `/(app)/sets/[id]/import` | 16 | 562.1 | 181.2 | React/Next, React Query, Radix, Lucide, Motion, Virtual | Clean! Zero parser libs bundled client-side. |
| `/(app)/sets/[id]` | 16 | 516.4 | 169.7 | React/Next, React Query, Radix, Lucide, Motion, Virtual | Healthy; ~170 KB gzip. |
| `/(app)/sets/[id]/practice` | 14 | 489.9 | 161.5 | React/Next, React Query, Radix, Lucide, Motion | Healthy; ~162 KB gzip. |
| `/(app)/dashboard` | 14 | 441.1 *(+451.2 lazy)* | 145.2 *(+126.8 lazy)* | Initial excludes `recharts` (`next/dynamic`) | Good initial load; lazy chart chunk adds 126.8 KB gzip on mount. |
| `/(app)/statistics` | 14 | 440.0 *(+451.2 lazy)* | 145.4 *(+126.8 lazy)* | Initial excludes `recharts` (`next/dynamic`) | Same as `/dashboard`. |
| `/(app)/sets/[id]/test` | 14 | **391.3** | **126.6** | React/Next, React Query, Radix, Lucide, Virtual | Very lean (`126.6 KB` gzip, no `motion/react` or `@supabase`!). |
| `/` (Landing) | 11 | **390.9** | **128.9** | React/Next, React Query, Radix, Lucide, Motion | Note: `@tanstack/react-query` is loaded via root `providers.tsx`; otherwise lean. |
| `/(app)/sets/[id]/results/[attemptId]` | 12 | **329.6** | **108.1** | React/Next, React Query, Radix, Lucide | Leanest authenticated route (`108.1 KB` gzip). |

---

## 4. Prioritized Remediation Roadmap (`P0`–`P3`)

| Priority | ID | Area | Concrete Fix Summary | Verification Target |
|---|---|---|---|---|
| **P0** | `IMP-01`, `IMP-02` | XLSX Import Engine (`xlsx-parser.ts`, `tabular-mapper.ts`, `StepFormatAndRules.tsx`) | Implement 2-row merged header detection + composite unique column labels, remove 1-letter `.includes()` substring matching, add Vietnamese institutional header synonyms (`Nội dung câu hỏi`, `Phương án lựa chọn 1..4`, `Dạng câu hỏi`), and fix duplicate `<SelectItem>` keys. | **`24/24` valid** on `METEOROLOGY-05.xlsx` and **`62/62` valid** on `METEOROLOGY-08.xlsx` in `auto` mode with `100%` answer accuracy! |
| **P0** | `DB-01`, `DB-02`, `DB-03` | PostgREST 1,000-Row Truncation & URL-Length Overflows (`exams/route.ts`, `questions/route.ts`, `export/route.ts`, `duplicate/route.ts`, `0003_*.sql`) | Raise exam cap from `500` → `2,000` (Zod + SQL + UI); replace unpaginated candidate/option fetches and large `.in(500..1000 UUIDs)` calls with chunked `<=150` UUID batches or SQL RPCs; add keyset pagination & `pageSize <= 100`. | 1,000-Q exam sampled uniformly across all 10,000 rows; 0 missing options; 10k set export & duplicate succeed 100%. |
| **P1** | `IMP-03`, `IMP-04`, `IMP-05`, `IMP-06` | Import Data Integrity (`validator.ts`, `commit/route.ts`, `tabular-mapper.ts`, `docx-ooxml-parser.ts`, `ImportWizard.tsx`) | Fingerprint duplicates by `(prompt + sorted options)` so distinct same-stem questions (like Q#30 in `METEOROLOGY-01.docx`) are NEVER silently skipped; recognize `"SC"`/`"MC"`/`"TF"`; reset `columnMapping` on `hasHeaderRow` toggle; fix DOCX `pPr/rPr` inheritance, `<w:br/>` splitting, and embedded media upload pipeline. | **`133/133` saved** on `METEOROLOGY-01.docx` under default `skip` policy; zero false-positive bold answers or broken `/docx-media/` 404s. |
| **P1** | `DB-04`, `DB-05`, `DB-06`, `DB-07` | DB Scaling & Offline Sync (`0003_*.sql`, `0001_*.sql`, `import/commit`, `LiveExamRunner`, `statistics`, `mistakes`, `bulk`) | Convert `trg_sync_study_set_question_count` to statement-level trigger; refactor `submit_exam_attempt` & `create_exam_attempt` to set-based SQL (fixing multi-set `study_set_id` attribution); add GIN indexes (`source_metadata`, `pg_trgm`); chunk `LiveExamRunner` offline sync batches to `<= 100`; use SQL aggregation RPCs for dashboard/stats/set summary. | 500× fewer `study_sets` updates on 10k import; 3 SQL statements instead of 6,000 on 1,000-Q submit; 1,000-Q offline exam syncs cleanly. |
| **P1** | UI-Perf (`LiveExamRunner`, `ExamResultsClient`, `TestHubClient`, `StudySetHub`, `QuestionEditorView`, `ImportWizard`) | React Rendering, Virtualization & Refetches | Isolate `<ExamCountdownTimer />` leaf + `React.memo(ExamNavigatorGrid)` + debounce `writeLocalDraft`; virtualize `ExamResultsClient` review cards; gate `useStudySetBundle` on `!activeAttemptId` in `TestHubClient`; debounce search (`300 ms`) in `StudySetHub`/`QuestionEditorView`; incremental single-item validation on Step-5 edit (`105.5 ms` → `< 2 ms`). | Zero 500ms full-runner re-renders; `<16 ms` INP during 10k inline editing; zero wasted 2,000-Q fetches on exam resume. |
| **P2** | `IMP-07`, `DB-08`, Bundle, `PracticeClient` | Polish & Efficiency | Strip global `\uFEFF` and optional redundant `a)`–`d)`/`1.` prefixes in tabular imports; omit unused `rawSource` from HTTP payloads (**-37.8% bytes**); skip redundant Step 2/3 re-parses; lazy-import `@/lib/supabase/client` in `question-editor-view.tsx` (**-254 KB raw / -66 KB gzip**); virtualize `PracticeClient` navigator & mistake/starred views; batch `PATCH question` option updates. | -37.8% import payload size; -33% `/sets/[id]/edit` JS bundle; smooth 2,000-Q Practice navigator. |
| **P3** | UX Enhancement | Filename Chapter Hint | Pre-suggest optional `defaultChapter` in Step 5 from uploaded filename (e.g., `"METEOROLOGY-01. THE ATMOSTPHERE"`) when `detectedChapters` is empty—strictly editable, never auto-mutating content. | Faster organization of single-chapter aviation DOCX/XLSX banks. |

---

## 5. Wave 3 Independent Retest — BEFORE vs AFTER Verification (V2.0)

> **Retest Date:** 2026-11-24  
> **Scope:** Independent re-execution of `src/lib/import/*` directly against all 4 real `sample-data/` files; separated-stage import benchmarks (`50`–`10,000` Qs across DOCX / TXT / XLSX); V2.0 multi-subject exam allocation (Strategies A–E), 7 selection policies, and Full Coverage Cycle benchmarks (`250` / `500` / `1,000` Qs from a `10,000`-Q 5-subject bank); fresh V2.0 `.next` production bundle analysis (`BUILD_ID: Ve6ltrp80YswJJLRQWLHe`, `52/52` routes); and static DB/API/UI re-audit.  
> **Environment:** Node `v24.15.0`, Next.js `16.4.6` production build, Vitest `5.1.1` (`tests/unit/import`: **7/7 files, 28/28 tests passed**). Live PostgreSQL DB insertion remains **BLOCKED** (Docker daemon stopped; no live `.env.local` Supabase instance).

### 5.1 Real `sample-data/` Document Import — BEFORE vs AFTER (All 4 Files: 100% PASS)

| Real File (`sample-data/`) | Actual GT | Wave 1 BEFORE (`auto`) | Wave 3 AFTER (`auto`) | Exact GT Answer Match | False Duplicates | Genuine Duplicates | `U+FEFF` / Prefix Leakage | Parse Latency (ms) | Wire Payload BEFORE → AFTER | Verdict |
|---|---:|---|---|---|---|---|---:|---:|---|---|
| `METEOROLOGY-01. THE ATMOSTPHERE (133).docx` | **133** | 133 valid *(1 **false-positive** dup on Q#30 → 132 saved on `skip`!)* | **133/133 valid**, 0 errors, 0 warnings | **133/133 (100%)** *(0/133 on 6 non-matching rules)* | **0** *(Q#30 preserved!)* | 0 | `0` / `0` | `45.33` (`parseDocxBuffer`: `36.73`) | `209.6 KB` → **`130.2 KB` (-37.8%)** | **VERIFIED PASS** |
| `METEOROLOGY-05. PRECIPITATION (24).xlsx` | **24** | **0/24 valid (0%)** *(25 rows, Row 2 leaked, all prompts/options empty)* | **24/24 valid (100%)**, 0 errors, 0 warnings (`headerRowCount: 2`, `16/16` unique composite headers) | **24/24 (100%)** | **0** | 0 | `0` / `0` *(100% `1.` & `a)`–`d)` stripped cleanly)* | `40.65` *(incl. ExcelJS load)* | `25.2 KB` → **`19.7 KB` (-21.8%)** | **VERIFIED PASS** |
| `METEOROLOGY-08. CLIMATOLOGY (62).docx` | **62** | 62 valid (1 dup) | **62/62 valid (100%)**, 0 errors, 1 warning | **62/62 (100%)** | **0** | **1** *(Q#31 == Q#26: identical prompt, option set & correct text; re-ordered)* | `0` / `0` | `17.74` | `97.8 KB` → **`60.9 KB` (-37.7%)** | **VERIFIED PASS** |
| `METEOROLOGY-08. CLIMATOLOGY (62).xlsx` | **62** | **0/62 valid (0%)** *(63 rows, Row 2 leaked, all prompts/options empty)* | **62/62 valid (100%)**, 0 errors, 2 warnings (`headerRowCount: 2`, `16/16` unique headers) | **62/62 (100%)** | **0** | **2** *(Q#30 == Q#1 & Q#31 == Q#26 — BOTH independently verified genuine: `samePrompt=true`, `sameOptionSet=true`, `sameCorrectText=true`, option display order shuffled)* | `0` / `0` *(interior `U+FEFF` stripped!)* | `36.60` | `59.9 KB` → **`55.2 KB` (-7.8%)** | **VERIFIED PASS** |

**Additional Independent Verification Checks Passed:**
- **Cross-File Parsed Parity (`METEOROLOGY-08.docx` vs `METEOROLOGY-08.xlsx`):** **`62/62` (100%, 0 mismatches)** on parsed correct option content after independent full-pipeline runs on both formats!
- **DOCX OOXML Regression Probes (`IMP-06`):**
  - Stale `<w:pPr><w:rPr><w:b/></w:rPr></w:pPr>` on a non-bold option A no longer triggers false-positive bold detection (`correct: ["B"]` only).
  - Inline Shift+Enter `<w:br/>` inside a single `<w:p>` cleanly splits into virtual sub-paragraphs with per-run formatting preserved (`4` options, `correct: ["C"]`).
  - Zero `/docx-media/` broken paths remain (extracted raster images are validated and uploaded safely via Storage or represented cleanly without dangling 404 paths).

---

### 5.2 Separated-Stage Import Benchmarks (`50`–`10,000` Qs) — BEFORE vs AFTER

#### A. DOCX Separated-Stage Pipeline (`parseDocxBuffer` + `validateImportBatch` + `compactPreviewForTransport` + Commit Batch Prep)

| Questions | Source | File (KB) | Read (ms) | Parse (ms) | Validate & Dupes (ms) | Batch Prep (ms) | **Total AFTER (ms)** | Total BEFORE (ms) | **Step-5 Single-Edit Reval (BEFORE → AFTER)** | 500-Q Chunks | Max Chunk Client JSON (KB) | Total Client JSON (BEFORE → AFTER) | Est. DB Payload (MB) | Live DB Insert |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|---|---:|---|
| **50** | Synth DOCX | 2.7 | 1.04 | 4.97 | 0.73 | 0.84 | **7.57** | 4.34 | `0.26` → **`0.050 ms`** | 1 | 57.6 | `0.09` → **`0.06 MB`** | 0.08 | BLOCKED *(no live DB)* |
| **133** | **REAL `01.docx`** | **33.8** | **0.40** | **36.73** | **1.64** | **1.99** | **40.76** | 30.72 | `0.75` → **`0.020 ms`** | **1** | **130.6** | `0.20` → **`0.13 MB` (-37.8%)** | **0.20** | BLOCKED *(no live DB)* |
| **226** | Synth DOCX | 6.5 | 1.34 | 13.08 | 3.23 | 2.88 | **20.53** | 12.26 | `0.85` → **`0.018 ms`** | 1 | 260.3 | `0.41` → **`0.25 MB`** | 0.38 | BLOCKED *(no live DB)* |
| **500** | Synth DOCX | 12.3 | 1.19 | 24.95 | 5.85 | 6.36 | **38.35** | 31.63 | `7.03` → **`0.027 ms`** | 1 | 576.3 | `0.92` → **`0.56 MB`** | 0.83 | BLOCKED *(no live DB)* |
| **600** | Synth DOCX | 14.4 | 1.21 | 29.76 | 7.41 | 5.82 | **44.20** | 97.02 | `9.71` → **`0.057 ms`** | 2 | 576.3 | `1.10` → **`0.68 MB`** | 1.00 | BLOCKED *(no live DB)* |
| **1,000** | Synth DOCX | 22.9 | 1.43 | 63.09 | 13.74 | 11.65 | **89.90** | 126.70 | `8.33` → **`0.038 ms`** | 2 | 577.3 | `1.84` → **`1.13 MB`** | 1.66 | BLOCKED *(no live DB)* |
| **5,000** | Synth DOCX | 107.4 | 1.27 | 266.53 | 97.06 | 69.10 | **433.96** | 594.76 | `39.77` → **`0.044 ms`** | 10 | 581.9 | `9.27` → **`5.67 MB`** | 8.35 | BLOCKED *(no live DB)* |
| **10,000** | Synth DOCX | 213.0 | 2.01 | 608.23 | 129.44 | 121.23 | **860.92** *(-28.2%)* | 1,198.46 | **`105.53` → `0.031 ms` (~3,400× faster!)** | 20 | 582.2 | **`18.55` → `11.36 MB` (-38.8%)** | 16.71 | BLOCKED *(no live DB)* |

*(Note: Background debounced full-batch duplicate revalidation in `ImportWizard` runs `300 ms` after typing pauses — `112.48 ms` at 10,000 rows — while synchronous per-keystroke inline edit validation is strictly O(1) at **`0.031 ms`**, eliminating the `105.53 ms` INP freeze. Parse caching via `lastParsedKeyRef` also eliminates 2 of 3 redundant full-file re-parses during Steps 1→4, cutting 10k wizard transfer from `~55.6 MB` to `~11.4 MB` (`-79.5%`) when options are unchanged.)*

#### B. EduQuiz TXT & XLSX (`ExcelJS`) Separated-Stage Pipeline — Wave 3 AFTER

| Questions | TXT Read (ms) | TXT Parse (ms) | TXT Val (ms) | TXT Prep (ms) | **TXT Total AFTER (ms)** *(BEFORE)* | XLSX Read (ms) | XLSX Parse (ms) | XLSX Val (ms) | XLSX Prep (ms) | **XLSX Total AFTER (ms)** *(BEFORE)* |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| **50** | 1.16 | 1.09 | 0.84 | 1.02 | **4.11** *(3.97)* | 1.21 | 18.56 | 0.75 | 0.53 | **21.04** *(12.39)* |
| **133** | 1.80 | 1.00 | 1.81 | 1.57 | **6.18** *(5.79)* | 1.37 | 10.00 | 1.48 | 1.53 | **14.38** *(17.56)* |
| **226** | 1.31 | 1.61 | 2.81 | 2.11 | **7.85** *(4.21)* | 1.11 | 17.27 | 2.57 | 2.29 | **23.25** *(22.13)* |
| **500** | 1.81 | 2.31 | 5.40 | 5.57 | **15.09** *(19.97)* | 1.11 | 25.45 | 7.99 | 7.80 | **42.36** *(47.86)* |
| **600** | 2.11 | 2.95 | 10.72 | 6.91 | **22.70** *(19.27)* | 1.21 | 36.95 | 6.36 | 7.93 | **52.45** *(53.10)* |
| **1,000** | 1.90 | 4.32 | 12.99 | 17.07 | **36.27** *(32.50)* | 1.10 | 53.07 | 8.73 | 13.00 | **75.89** *(84.20)* |
| **5,000** | 6.69 | 25.03 | 83.90 | 56.78 | **172.40** *(188.24)* | 1.39 | 234.14 | 61.36 | 54.71 | **351.61** *(431.53)* |
| **10,000** | 9.95 | 55.84 | 103.90 | 85.72 | **255.41** *(361.87, -29.4%)* | 1.13 | 388.87 | 102.94 | 83.21 | **576.15** *(880.43, -34.6%)* |

---

### 5.3 V2.0 Multi-Subject Exam Generation, Selection Policies & Full Coverage Benchmarks (`10,000`-Q 5-Subject Pool)

Benchmarked directly against `src/lib/learning/{exam-allocator,exam-selector,coverage-engine,exam-scoring,shuffle}.ts` using a `10,000`-question 5-subject aviation bank (`3,000` / `2,500` / `2,000` / `1,500` / `1,000`, median & p95 of 7 measured runs after 2 JIT warmup runs):

#### A. Allocation Strategies A–E (`250` / `500` / `1,000` Questions from `10,000`-Q Pool)

| Exam Size | Strategy | Unique Selected | `computeExamAllocation` (ms) | `selectQuestionsByPolicy` (ms) | Shuffle + Option Snapshots (ms) | **Total Med (ms)** | **Total p95 (ms)** |
|---:|---|---:|---:|---:|---:|---:|---:|
| **250** | A — `global_random` | 250/250 | 0.053 | 1.815 | 0.319 | **2.428** | 7.600 |
| **250** | B — `equal` | 250/250 | 0.038 | 0.992 | 0.243 | **1.293** | 2.305 |
| **250** | C — `proportional` | 250/250 | 0.033 | 1.177 | 0.386 | **1.765** | 6.388 |
| **250** | D — `custom` (exact counts) | 250/250 | 0.024 | 1.090 | 0.351 | **1.465** | 2.140 |
| **250** | E — `weighted` (percentages) | 250/250 | 0.023 | 0.979 | 0.249 | **1.251** | 2.408 |
| **500** | A — `global_random` | 500/500 | 0.014 | 1.297 | 0.428 | **1.749** | 4.190 |
| **500** | B — `equal` | 500/500 | 0.021 | 1.012 | 0.462 | **1.503** | 3.634 |
| **500** | C — `proportional` | 500/500 | 0.016 | 0.946 | 0.384 | **1.357** | 1.890 |
| **500** | D — `custom` (exact counts) | 500/500 | 0.009 | 0.884 | 0.487 | **1.427** | 4.065 |
| **500** | E — `weighted` (percentages) | 500/500 | 0.021 | 0.896 | 0.463 | **1.467** | 1.823 |
| **1,000** | A — `global_random` | 1,000/1,000 | 0.016 | 1.098 | 0.967 | **2.039** | 3.246 |
| **1,000** | B — `equal` | 1,000/1,000 | 0.044 | 1.128 | 1.101 | **2.296** | 2.735 |
| **1,000** | C — `proportional` | 1,000/1,000 | 0.050 | 1.722 | 1.528 | **4.007** | 4.591 |
| **1,000** | D — `custom` (exact counts) | 1,000/1,000 | 0.012 | 0.931 | 0.960 | **1.925** | 2.335 |
| **1,000** | E — `weighted` (percentages) | 1,000/1,000 | 0.044 | 1.123 | 1.108 | **2.399** | 3.178 |

#### B. All 7 Deterministic Selection Policies (`500Q` from `10,000`-Q Pool)

| Selection Policy | Selected | Median (ms) | p95 (ms) |
|---|---:|---:|---:|
| `random` | 500 | **1.238** | 1.286 |
| `starred_only` | 500 | **1.289** | 2.104 |
| `anti_repeat` *(1,000 recent IDs)* | 500 | **1.823** | 4.622 |
| `unseen_first` | 500 | **2.595** | 3.579 |
| `mistakes_first` | 500 | **5.486** | 9.307 |
| `due_for_review` | 500 | **5.598** | 7.216 |
| `weak_topics_first` *(chapter + tag aggregation)* | 500 | **21.805** | 27.296 |

#### C. Full Coverage Cycle (`10,000`-Q Pool → 100% Coverage, ZERO Overlaps) & Client Scoring / Drafts

| Full Coverage Batch Size | Exams Issued | Unique Questions Covered | Overlaps | Final Status | `createCoverageCycle` (ms) | `issueNextCoverageExam` Med (ms) | `completeCoverageExam` Med (ms) | **Entire 10k Cycle Total (ms)** |
|---:|---:|---:|---:|---|---:|---:|---:|---:|
| **250 / exam** | 40 | **10,000 / 10,000** | **0** | `completed` | 2.09 | 1.31 | 0.17 | **76.38** |
| **500 / exam** | 20 | **10,000 / 10,000** | **0** | `completed` | 2.15 | 1.56 | 0.28 | **48.42** |
| **1,000 / exam** | 10 | **10,000 / 10,000** | **0** | `completed` | 1.59 | 0.97 | 0.31 | **16.11** |

- **`scoreExamAttempt` + Local Draft Serialization (`250` / `500` / `1,000Q`):**
  - `250Q`: `scoreExamAttempt` `0.332 ms`, `JSON.stringify(draft)` `0.185 ms` (`44.1 KB`, debounced `300 ms`)
  - `500Q`: `scoreExamAttempt` `0.493 ms`, `JSON.stringify(draft)` `0.319 ms` (`88.2 KB`, debounced `300 ms`)
  - `1,000Q`: `scoreExamAttempt` `1.457 ms`, `JSON.stringify(draft)` `0.868 ms` (`176.6 KB`, debounced `300 ms`)

---

### 5.4 Fresh V2.0 `.next` Production Bundle Analysis — BEFORE vs AFTER

Measured directly from `.next/static/chunks` and `.next/server/app/**/page_client-reference-manifest.js` (`BUILD_ID: Ve6ltrp80YswJJLRQWLHe`, built `2026-11-24T10:12:50Z`, 52/52 routes):

- **Total Static JS (all routes incl. new V2.0 `/exams/*`, `/practice`, `/import`):** `83` chunks = `3,485.3 KB raw / 1,058.5 KB gzip` *(Wave 1 V1.0: `63` chunks = `2,829.2 KB raw / 864.8 KB gzip`)*.
- **Total Static CSS:** `1` stylesheet = `74.9 KB raw / 13.8 KB gzip` *(Wave 1: `65.9 KB / 12.4 KB`)*.
- **Server-Only Parser/Export Library Leakage:** **`0 bytes` leaked!** (`exceljs`, `jszip`, `fast-xml-parser`, `mammoth`, `papaparse` remain 100% server-only).
- **`recharts` Code-Splitting:** **`464.7 KB raw / 129.6 KB gzip`** remains cleanly lazy-loaded (`next/dynamic`) and absent from initial route bundles of `/dashboard` and `/statistics`.

| Route | Wave 1 BEFORE Raw / Gzip (KB) | Wave 3 AFTER Raw / Gzip (KB) | Delta (Gzip) | Notes |
|---|---:|---:|---:|---|
| **`/(app)/sets/[id]/edit`** | `775.1` / `235.4` | **`569.1` / `184.6`** | **`-50.8 KB (-21.6%)`** | **VERIFIED:** Static `@supabase` (`254.1 KB raw / 66.3 KB gzip`) completely removed! |
| **`/(app)/profile`** | `680.5` / `208.4` | **`469.6` / `156.0`** | **`-52.4 KB (-25.1%)`** | **VERIFIED:** Static `@supabase` completely removed! |
| `/(app)/exams/new` *(New V2.0)* | N/A | **`463.3` / `147.2`** | — | Lean! Zero `motion/react` or `@supabase`. |
| `/(app)/exams/[attemptId]` *(New V2.0)* | N/A | **`457.5` / `147.5`** | — | Lean live exam runner (`<148 KB` gzip). |
| `/(app)/exams/[attemptId]/results` *(New V2.0)* | N/A | **`447.1` / `144.9`** | — | Virtualized 500–1,000Q review + multi-subject breakdown. |
| `/(app)/exams` *(New V2.0)* | N/A | **`399.0` / `129.1`** | — | Presets + Full Coverage + History hub. |
| `/(app)/sets/[id]/test` | `391.3` / `126.6` | `569.2` / `178.9` | `+52.3 KB` | Now embeds full V2.0 `CustomExamBuilderClient` (multi-subject Strategies A–E + Presets + Coverage). |
| `/(app)/sets/[id]/results/[attemptId]` | `329.6` / `108.1` | `447.1` / `144.9` | `+36.8 KB` | Added `@tanstack/react-virtual` + subject/chapter/tag breakdowns. |
| `/(app)/sets/[id]/import` | `562.1` / `181.2` | `614.8` / `197.7` | `+16.5 KB` | Still **0 B** server parser libraries! |
| `/(app)/dashboard` | `441.1` / `145.2` | `486.8` / `159.4` | `+14.2 KB` | `recharts` (`129.6 KB` gzip) remains lazy-split. |
| `/(app)/statistics` | `440.0` / `145.4` | `484.3` / `159.7` | `+14.3 KB` | `recharts` (`129.6 KB` gzip) remains lazy-split. |
| `/(app)/settings` | `720.4` / `220.8` | `768.0` / `236.1` | `+15.3 KB` | Auth password/account route retains `@supabase` (expected). |

---

### 5.5 Wave 3 Finding-by-Finding Closure Matrix

| ID | Area | Wave 3 Status | Verified Evidence |
|---|---|---|---|
| **`IMP-01`**, **`IMP-02`**, **`IMP-04`**, **`IMP-07`** | XLSX 2-row merged headers, Vietnamese mapping, `"SC"`/`"MC"`/`"TF"`, prefix/BOM cleanup | **VERIFIED FIXED** | `METEOROLOGY-05.xlsx`: `0/24` → **`24/24 (100%)`**; `METEOROLOGY-08.xlsx`: `0/62` → **`62/62 (100%)`**; `62/62` cross-file parity vs `08.docx`; `0` `U+FEFF` & `0` prefix leaks. |
| **`IMP-03`** | Full `(prompt + sorted options + answers)` duplicate fingerprint | **VERIFIED FIXED** | `METEOROLOGY-01.docx`: Q#30 preserved (`0` false duplicates, `133/133` saved); `08.xlsx` 2 flagged duplicates verified 100% genuine. |
| **`IMP-05`**, **`IMP-06`** | Wizard stale mapping + DOCX `pPr/rPr`, `<w:br/>`, media | **VERIFIED FIXED** | `ImportWizard.tsx` resets mapping on toggle + caches unchanged parses (`lastParsedKeyRef`); DOCX regression probes pass (`tests/unit/import`: 28/28). |
| **Wave 3 `#69` (P1)** | `O(N²)` option/answer queries on 10k chunked commit (`_existing-fingerprints.ts`) | **VERIFIED FIXED** | Reopened to `@v2-import-builder` & verified fixed: `QUESTION_PAGE_SIZE = 1000` + `candidateNormalizedPrompts` prefilter in both `commit/route.ts` and `parse/route.ts` cuts ~1,600 option/answer queries → `0` on distinct 10k imports (`tests/unit/import/v2-regressions.test.ts` verified). |
| **`DB-01`**, **`DB-02`**, **`DB-03`**, **`DB-07`**, **`DB-08`** | PostgREST 1,000-row cap, HTTP 414 `.in()` chunking, 1,000-Q exams, atomic clone, `Promise.all` options | **VERIFIED FIXED** *(with 1 minor P2 note)* | `SAFE_IN_CHUNK_SIZE = 100` (`fetchInChunks` / `fetchQuestionRelationsChunked` / `fetchAllPages`), `clone_study_set()` SQL RPC, `saveExamAnswers()` chunked `<= 150`, `PATCH question` uses `Promise.all`. *(Minor P2 note: `src/app/api/sets/route.ts:54,124` slices shared-set memberships at `100`; in-flight `#65` tracks `exam-engine.ts:585-607` `study_set_id` pagination & `get_coverage_cycle_subject_progress` RPC.)* |
| **`DB-04`**, **`DB-05`** | Statement-level count trigger, hot indexes, set-based `create_exam_attempt_v2` & `submit_exam_attempt` | **VERIFIED LIVE (V2.1)** | `0005` (`FOR EACH STATEMENT`, 5 GIN/partial indexes, set-based CTEs + temp-table grading) + `0006`–`0010` verified LIVE on Supabase Cloud PostgreSQL 17.12 (see §6 below!). |
| **`DB-06`** | Unpaginated full-table reads in `/sets/[id]`, `/dashboard`, `/statistics`, `/mistakes` | **VERIFIED FIXED** | All 4 routes migrated to `fetchAllPages` + `fetchInChunks` (`SAFE_IN_CHUNK_SIZE = 100`), eliminating silent 1,000-row truncation. |
| **UI-Perf** | `ExamTimer`, `ExamNavigatorGrid`, `ExamResultsClient`, `TestHubClient`, `StudySetHub`, `QuestionEditorView`, `ImportWizard`, `PracticeClient` | **VERIFIED FIXED** | Isolated `React.memo(ExamTimer)` (`1,000 ms`), `React.memo` + virtualized `ExamNavigatorGrid` (reused in `PracticeClient`), virtualized `ExamResultsClient`, `enabled: !activeAttemptId` in `TestHubClient`, `250 ms` debounced search + virtualizer in `StudySetHub`/`QuestionEditorView`, `0.031 ms` O(1) Step-5 edit + `useDeferredValue`, `-50.8 KB` / `-52.4 KB` gzip savings on `/sets/[id]/edit` & `/profile`. |

---

## 6. V2.1 Live Supabase Cloud End-to-End Verification & Real DB Benchmarks (`BLK-001` UNBLOCKED)

> **Execution Date:** 2026-11-24  
> **Live Target:** Supabase Cloud project `StudyHub` (PostgreSQL `17.12`, migrations `0001`–`0011` applied live), Next.js `16.4.6` production server (`next start -p 3014 -H 127.0.0.1`), authenticated via real `@supabase/ssr` session cookies for disposable test account `v21-perf-<ts>@studyhub-test.local`.  
> **Security & Teardown Attestation:** Zero secrets/keys printed or stored; zero aviation question text copied into docs; disposable test user + all 6 created study sets deleted and verified (`REMAINING_SETS: 0`, `DEL_USER: error: null`, `PORT_3014_FREE=True`).  
> **Note on Network Latency:** Timings below are **real end-to-end HTTP round-trip times** from the local Next.js server to live Supabase Cloud over the internet (including TLS + auth verification + PostgREST + PostgreSQL 17.12 disk commit + triggers + RLS), NOT mocked or local loopback DB numbers.

### 6.1 Live End-to-End Real Aviation Document Imports (All 4 `sample-data/` Files → Live PostgreSQL 17.12)

Every file was uploaded as multipart `FormData` to `POST /api/import/parse`, committed to live Supabase Cloud via `POST /api/import/commit`, verified for trigger-maintained `study_sets.question_count` via `GET /api/sets/[id]`, and read back in full via `GET /api/sets/[id]/questions?page=1&pageSize=500`:

| Real File (`sample-data/`) | File Size | Policy Used | Parsed / Valid (Dups) | Committed to Live DB | Trigger `question_count` | Live Read-Back Verified (`4 opts` / `1 correct` / `100% match`) | `U+FEFF` / Prefix Leaks | Disk Read (ms) | `POST /api/import/parse` HTTP (ms / KB) | `POST /api/import/commit` Live DB (ms) | `GET /questions` Read-Back (ms) | **Total End-to-End (ms)** |
|---|---:|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|
| `METEOROLOGY-01. THE ATMOSTPHERE (133).docx` | `33.8 KB` | `skip` | `133/133` (`0`) | **`133/133`** (`0` skipped) | **`133`** | **`133/133`** *(Q#20 & Q#30 BOTH preserved with distinct options & answers!)* | `0` / `0` | `0.81` | `898.0` *(`130.6 KB`, cold)* | **`1,797.5`** | `967.7` | **`3,664.1`** |
| `METEOROLOGY-05. PRECIPITATION (24).xlsx` | `14.9 KB` | `skip` | `24/24` (`0`) | **`24/24`** (`0` skipped) | **`24`** | **`24/24`** | `0` / `0` | `2.18` | `561.1` *(`22.1 KB`)* | **`1,465.0`** | `757.0` | **`2,785.2`** |
| `METEOROLOGY-08. CLIMATOLOGY (62).docx` | `23.1 KB` | `keep_both` | `62/62` (`1` genuine) | **`62/62`** (`0` skipped) | **`62`** | **`62/62`** | `0` / `0` | `2.08` | `461.4` *(`61.4 KB`)* | **`1,395.1`** | `695.4` | **`2,554.1`** |
| `METEOROLOGY-08. CLIMATOLOGY (62).xlsx` | `20.2 KB` | `keep_both` | `62/62` (`2` genuine) | **`62/62`** (`0` skipped) | **`62`** | **`62/62`** | `0` / `0` | `2.38` | `515.1` *(`58.4 KB`)* | **`1,539.3`** | `721.2` | **`2,778.0`** |

- **Cross-File Live DB Parity (`METEOROLOGY-08.docx` vs `METEOROLOGY-08.xlsx`):** **`62/62` (100%)** match on correct option position/label (`A`–`D`) while preserving both source documents verbatim without mutating minor editorial punctuation/spacing differences between the original Word and Excel files.

---

### 6.2 Live 500-Question Bank Persistence, Read-Back, 250-Q Exam Lifecycle, Export & Clone (`SH-005` Live Proof)

Executed against live Supabase Cloud (`500` synthetic MC questions × `4` options = **`2,000` option rows** + `500` `question_tags` + `4` unique tags across `10` chapters):

| Live Operation (HTTP Route → Live Supabase Cloud PG 17.12) | Measured Latency (ms) | Response / Payload | Exact Live Verification Proof | Verdict |
|---|---:|---:|---|---|
| **500-Q Commit** (`POST /api/import/commit`: 500 Qs + 2,000 opts + 500 tags) | **`3,649.3`** | `500` Qs / `2,000` opts | `importedCount: 500`, `totalSetQuestions: 500`, statement-level trigger `study_sets.question_count === 500` | **VERIFIED LIVE** |
| **500-Q Single-Page Read-Back** (`GET /api/sets/[id]/questions?page=1&pageSize=500`) | **`2,079.9`** | `1,091.9 KB` | **`500/500` questions** AND **`500/500` retain ALL 4 options (`2,000/2,000` options)** — **0** PostgREST 1,000-row truncation, **0** HTTP 414! | **VERIFIED LIVE** |
| **500-Q Paginated Read-Back** (`5 × pageSize=100`) | **`4,463.0`** *(`~893 ms`/page)* | `500` unique Qs | `500/500` unique IDs & `2,000/2,000` options across pages 1–5 | **VERIFIED LIVE** |
| **250-Q Live Exam Generation** (`POST /api/exams`, `global_random`, shuffle Qs+Opts, `3600s`) | **`1,749.4`** | `291.0 KB` | **`250/250` questions**, `250/250` × 4 options (`1,000/1,000`), **`0` leaked answer keys/explanations pre-submit!** | **VERIFIED LIVE** |
| **250-Q Chunked Autosave — Chunk 1** (`PUT /api/exams/[id]/answers`, 150 items, `seq 1..150`) | **`382.4`** | `150` answers | Live server `answered_count === 150` | **VERIFIED LIVE** |
| **250-Q Chunked Autosave — Chunk 2** (`PUT /api/exams/[id]/answers`, 100 items, `seq 151..250`) | **`441.3`** | `100` answers | Live server `answered_count === 250` (**total 250-answer sync: `823.6 ms`**) | **VERIFIED LIVE** |
| **250-Q Live Server-Scored Submit** (`POST /api/exams/[id]/submit`) | **`723.7`** | Set-based PG grading + SM-2 | `status: "submitted"`, `answered: 250`, `correct: 200`, `wrong: 50`, `unanswered: 0`, `score_percent: 80.00%`, `passed: true`, `1` subject / `10` chapter breakdowns | **VERIFIED LIVE** |
| **500-Q Live Export — JSON** (`GET /api/sets/[id]/export?format=json`) | **`2,118.4`** | `556.1 KB` | **`500/500` questions** & **`2,000/2,000` options** exported intact | **VERIFIED LIVE** |
| **500-Q Live Export — CSV** (`GET /api/sets/[id]/export?format=csv`) | **`2,191.9`** | `159.5 KB` | **`501` lines** (`1` header + `500` questions) exported cleanly | **VERIFIED LIVE** |
| **500-Q Atomic Clone RPC** (`POST /api/sets/[id]/duplicate` → `clone_study_set()`) | **`815.5`** | 1 SQL RPC call | `copied_questions: 500`, cloned set read-back **`500/500` questions & `2,000/2,000` options**! | **VERIFIED LIVE** |

---

### 6.3 Live PG 17.12 Bugs Caught During V2.1 End-to-End Benchmarks

Running real HTTP + database mutations against live Supabase Cloud PG 17.12 exposed **3 real P0 database bugs** that mock/offline tests could not catch:

1. **`42501` on `POST /api/sets` (`INSERT ... RETURNING *`):** Caught on first live run (`study_sets_select_readable` called `STABLE` `can_read_study_set()` against pre-statement snapshot). **Fixed live in `0008` and re-verified PASS.**
2. **`42P17` Mutual RLS Recursion `question_tags` ↔ `tags`:** Caught during live 500-Q tagged commit (`POST /api/import/commit` → HTTP 500; `question_tags_insert_editable` queried `tags`, whose `tags_select_readable_via_sets` re-entered `question_tags`). **Fixed live in `0009` (`public.can_read_tag`) and re-verified PASS.**
3. **`P0001` `trg_prevent_exam_snapshot_update` Blocking FK `ON DELETE SET NULL` Cascades (`#107` / `#108`):** Caught during post-exam teardown (`DELETE FROM study_sets` failed with `exam_attempt_questions rows are immutable and cannot be updated.` because `question_id` and `source_study_set_id` have `ON DELETE SET NULL` FKs). **Fixed live in `0011` (`0011_v2_1_allow_fk_set_null_on_exam_snapshot`) and re-verified PASS live on PG 17.12:** authenticated owner `DELETE FROM study_sets` after exam succeeds (`error: null`), historical `exam_attempt_questions` snapshot remains preserved with `question_id=null` & `source_study_set_id=null`, direct `UPDATE prompt_snapshot` is STILL rejected with `P0001`, and `admin.auth.admin.deleteUser()` cascades cleanly (`remainingAttempts: 0`, `REMAINING_SETS: 0`).


