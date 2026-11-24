# StudyHub V1.0 — Deterministic Multi-Format Import & Export Specification

> **Core Principle:** **100% Deterministic Parsing.** Zero AI, zero probabilistic guessing, zero silent data corruption. Every detected answer carries an explicit `AnswerDetectionSource` audit trail, and every ambiguity or conflict is surfaced transparently in Step 4 of the Import Wizard for user resolution.

---

## 1. Supported Import Formats & File Limits

| Format Key (`ImportFormat`) | Extensions / Input | Parser Library | Primary Use Case |
| --- | --- | --- | --- |
| `eduquiz_txt` | `.txt`, Raw Paste | Pure TS state-machine | Vietnamese EduQuiz format (`*B.` asterisk marks correct choice -> `detectedBy: ['asterisk_prefix']`) |
| `word_answer_key` | `.txt`, `.docx`, Raw Paste | Pure TS + OOXML text extractor | Inline `ANSWER: A` / `Đáp án: D` (`inline_answer_key`) or End-of-Document Answer Key (`end_answer_key`) with multi-chapter numbering resets |
| `docx_ooxml` | `.docx` | `jszip` + `fast-xml-parser` (+ `mammoth` fallback) | Word files with **Bold** (`docx_bold`), **Highlight** (`docx_highlight`), **Font Color** (`docx_font_color`), **Underline** (`docx_underline`), `*` (`asterisk_prefix`), or answer lines, including tables and embedded images |
| `xlsx_wayground` | `.xlsx` | `exceljs` | Wayground / Quizizz / Kahoot spreadsheet templates (`column_mapping`) |
| `xlsx_generic` | `.xlsx` | `exceljs` | Arbitrary Excel sheets using interactive `ColumnMapping` |
| `quizlet_tsv` | `.txt`, `.tsv`, Raw Paste | Pure TS delimiter splitter | Quizlet export (custom `termDelimiter` & `cardDelimiter`, default Tab + Newline) |
| `csv` | `.csv` | `papaparse` | Generic UTF-8 / UTF-8-BOM CSV with `ColumnMapping` |
| `json` | `.json` | Native `JSON.parse` + Zod | Lossless StudyHub export/re-import & canonical JSON arrays (`json_explicit`) |
| `txt_generic` | `.txt`, Raw Paste | Pure TS line parser | Numbered questions (`Câu 1:`, `1.`, `Q1.`) with configurable `AnswerRule` |

### Security & Resource Limits (Enforced BEFORE Parsing)
- **Max Document/Spreadsheet Upload Size:** `15 MB` (`15 * 1024 * 1024` bytes).
- **Max Pasted Raw Text Size:** `10 MB`.
- **Archive Bomb Protection (`.docx` / `.xlsx` ZIP containers via `jszip`):**
  - Magic bytes MUST start with `50 4B 03 04` (`PK\x03\x04`).
  - Reject macro-enabled formats (`.docm`, `.xlsm`, `vbaProject.bin`).
  - Max ZIP entries: **`500`** (or `2,000` if verified image-only media inside `word/media/*`, hard cap `2,000`).
  - Max total uncompressed size across all entries: **`50 MB`**.
  - Max compression ratio per entry: **`100:1`**.
  - Disable XML entity expansion (XXE) and external DTD fetching in `fast-xml-parser` (`processEntities: false`).
- **Max Parsed Questions per Job:** **`50,000`** (with smooth tested support for 600 and 10,000+ questions).
- **Encoding Handling:** Automatically strip UTF-8 BOM (`\uFEFF`), normalize line endings (`\r\n` and `\r` -> `\n`), preserve all Vietnamese Unicode (NFC normalization via `str.normalize('NFC')`).

---

## 2. Detailed Deterministic Parser Rules

### 2.1 EduQuiz TXT (`eduquiz_txt`)
- **Chapter Markers (Optional):** Lines matching `/^(?:Chương|Chuong|Phần|Phan|Bài|Bai|Part|Chapter|Unit|Module)\s+[\dIVXLCDM]+(?:[:.\-\s].*)?$/i` or `'Single line starting with #'` set the active `chapter` context for all subsequent questions until the next chapter header.
- **Question Boundary:**
  - Explicit prefix: `/^(?:Câu|Cau|Question|Q)\s*(\d+)\s*[:.)\-]\s*(.+)$/i` OR `/^(\d+)\s*[.)]\s+(.+)$/` (when not inside an option block) OR blank-line separated blocks when option lines follow.
  - Supports **multiline question stems** (continuation lines before option `A.` are joined with `\n`).
- **Option Lines:**
  - Regex: `/^(\*?)\s*([A-Ha-h])\s*[.)\]:\-]\s*(.+)$/` (also handles `*(A)`, `* A.`, `[*]` prefix).
  - Leading `*` sets `isCorrect = true` and records `detectionSources.push('asterisk_prefix')`.
  - Supports **multiline options** (indented or continuation lines before next option letter or next question/explanation).
- **Multiple Correct Answers:** If `> 1` option has `*`, `questionType` automatically becomes `'multiple_choice'`; if exactly `1`, `'single_choice'`.
- **Explanation / Hint Lines:**
  - `/^(?:Giải thích|Giai thich|Hướng dẫn|Explanation|Note|Ghi chú)\s*[:\-]\s*(.+)$/i`
  - `/^(?:Gợi ý|Hint)\s*[:\-]\s*(.+)$/i`

### 2.2 Word Answer-Key Format (`word_answer_key`)
Handles both **Inline Answer Keys** and **End-of-Document Answer Keys** (including multi-chapter question numbering resets like Chapter 1: 1..50, Chapter 2: 1..50!).

1. **Inline Answer Key:**
   - Regex after options: `/^(?:ANSWER|ANS|ĐÁP\s*ÁN|DAP\s*AN|ĐA|KEY)\s*[:.\-=]?\s*([A-H](?:\s*[,;&+\/\s]\s*[A-H])*)\s*$/i`
   - Supports single (`ANSWER: B`, `Đáp án: D`) and multi-select (`Đáp án: A, C` or `ANSWER: A & D`).
   - Records `detectionSources.push('inline_answer_key')`.
2. **End-of-Document Answer Key Block:**
   - Triggered by a section heading like `ĐÁP ÁN`, `BẢNG ĐÁP ÁN`, `ANSWER KEY`, `KEY` (or a trailing grid/list of `1.A 2.C 3-B 4:D` or `Câu 1: A` or a Word table of `(Question #, Letter)` pairs).
   - **Multi-Chapter Reset Handling (CRITICAL):**
     - Each parsed question stores `(chapterIndex, localQuestionNumber, globalIndex)`.
     - If the answer key section also includes chapter headers (`Chương 1`, `Chương 2`), keys map by `(chapterIndex, localQuestionNumber)`.
     - If the answer key repeats `1.` after reaching a lower number than the previous key (e.g., `1..50` followed by `1..50`), the parser deterministically increments `keyChapterIndex` and maps `(keyChapterIndex, localQuestionNumber)`!
     - If mapping is ambiguous (e.g., duplicate key or unmapped question number), flag a clear `warning` or `error` issue (`AMBIGUOUS_ANSWER_KEY_MAPPING`) in Step 4 — NEVER guess silently.
   - Records `detectionSources.push('end_answer_key')`.

### 2.3 DOCX OOXML Formatting-Based Parser (`docx_ooxml`)
Inspects raw OpenXML inside the `.docx` archive (`word/document.xml`, `word/styles.xml`, `word/numbering.xml`, `word/_rels/document.xml.rels`, `word/media/*`) using `jszip` + `fast-xml-parser`.

1. **Paragraph & Table Extraction:**
   - Walks `w:body` in exact document order: processes both `<w:p>` paragraphs and `<w:tbl>` tables (tables with 2+ columns can hold question/options or end-of-doc answer grids).
   - Resolves Word auto-numbering (`<w:numPr>` + `word/numbering.xml`) so Word-numbered lists (`1.`, `A.`, `B.`, `C.`, `D.`) are reconstructed accurately even when the letter/number is not literal text!
2. **Run-Level Formatting Inspection (`<w:rPr>` + inherited paragraph style from `word/styles.xml`):**
   For every option paragraph/cell, computes formatting coverage over the option text runs (and specifically the option label `A.`/`B.` vs. option body):
   - **Bold:** `<w:b/>` (excluding `<w:b w:val="0"/>` or `"false"`). Note: Ignore bold if *all* options in a question are bold (baseline subtraction!), preventing false positives when an entire document uses bold font.
   - **Highlight / Shading:** `<w:highlight w:val="yellow|green|cyan|..."/>` (excluding `"none"`) OR `<w:shd w:fill="..."/>` (excluding `"auto"`, `"FFFFFF"`, `"000000"`).
   - **Font Color:** `<w:color w:val="HEX"/>` where hex is non-default (not `"auto"`, not `"000000"`, not matching the majority option color in that question — e.g., red `FF0000`/`C00000`, blue `0070C0`, green `00B050`).
   - **Underline:** `<w:u w:val="single|double|thick|..."/>` (excluding `"none"`).
   - **Text Markers:** Leading `*` (`asterisk_prefix`) or inline/end answer lines (`inline_answer_key` / `end_answer_key`).
3. **Configurable Detection Priority & Conflict Detection:**
   - User can choose `AnswerRule` in Step 3: `auto` (default priority: `inline_answer_key` > `end_answer_key` > `asterisk_prefix` > `docx_highlight` > `docx_font_color` > `docx_bold` > `docx_underline`) OR restrict to specific signals (e.g., "Only Red Color", "Only Highlight", "Only Bold").
   - **Conflict Detection:** If two enabled signals disagree on the same question (e.g., Option A is Bold while Option C is Red, or Inline Key says B while Highlight is on D), DO NOT silently pick without telling the user:
     - Mark the question with `ImportValidationIssue { severity: 'warning', code: 'ANSWER_SIGNAL_CONFLICT', message: '...' }`.
     - Highlight the question in Step 4's "Needs Review / Conflicts" filter tab so the user resolves it in one click.
4. **Embedded Images (`word/media/*`):**
   - Extract safe raster images (`png`, `jpg`, `jpeg`, `webp`, `gif`; skip/warn on `wmf`/`emf`/`svg`) referenced via `<a:blip r:embed="rIdX"/>` and associate with the owning question prompt or option. On commit, upload validated images to Supabase Storage `study-media/{owner_id}/{set_id}/{uuid}.{ext}`.

### 2.4 Wayground & Generic Excel (`xlsx_wayground`, `xlsx_generic`)
Parsed deterministically via `exceljs`:
- **Auto-Detection for Wayground / Quizizz Template:**
  Detects known header sets (case-insensitive, trimmed):
  - `Question Text`, `Question Type`, `Option 1`..`Option 5`, `Correct Answer` (1-based index like `2` or `1,3`, or letter `B`, or matching option text), `Time in seconds`, `Image Link`, `Answer explanation` / `Explanation`.
- **Generic XLSX & Column Mapping:**
  - Step 2 displays detected sheet names and first 5 rows.
  - Step 3 provides explicit Column Mapping dropdowns for: `Question / Term`, `Option A..F` (or `Back / Definition`), `Correct Answer`, `Question Type`, `Chapter`, `Explanation`, `Hint`, `Difficulty`, `Tags`.
  - Resolves `Correct Answer` deterministically by: (a) 1-based numeric index (`1`->A, `2`->B), (b) option letter (`A`–`F`), or (c) exact trimmed text match against option columns; flags `INVALID_CORRECT_ANSWER` if none match.

### 2.5 Quizlet TSV / Delimiter Flashcards (`quizlet_tsv`)
- Supports pasted text or `.txt`/`.tsv` files exported from Quizlet.
- Configurable **Term–Definition Delimiter** (default: Tab `\t`, options: Comma `,`, Semicolon `;`, Pipe `|`, Custom string) and **Card Delimiter** (default: Newline `\n`, options: Double Newline `\n\n`, Semicolon `;`, Custom string).
- Produces `questionType: 'flashcard'` with `prompt` = front/term, `backText` = back/definition, and optional auto-generated `acceptedAnswers: [backText]` for Write mode.

### 2.6 CSV (`csv`) & JSON (`json`)
- **CSV (`papaparse`):** Strips UTF-8 BOM, auto-detects comma/semicolon/tab delimiter, respects quoted multiline fields, supports header-row toggle and Column Mapping identical to `xlsx_generic`.
- **JSON (`json`):** Validates against StudyHub canonical export schema (or flat array of question objects) with strict Zod validation. Supports lossless round-trip of chapters, options, `isCorrect`, accepted answers, explanations, hints, difficulty, and tags.

---

## 3. The 6-Step Import Wizard UX Contract (`/sets/[id]/import`)

| Step | Name | Deterministic Behavior |
| --- | --- | --- |
| **1** | **Source Input** | Choose Upload File (drag-and-drop `.docx`, `.xlsx`, `.csv`, `.tsv`, `.txt`, `.json`) OR Paste Raw Text. Validates size/extension client-side before sending. |
| **2** | **Format Detection & Scope** | Shows auto-detected `ImportFormat` with manual override selector; sheet selector for `.xlsx`; delimiter selectors for Quizlet/CSV; header-row toggle. |
| **3** | **Answer Rules & Column Mapping** | For DOCX/TXT: toggle active detection signals (`*`, Answer Key, Bold, Highlight, Color, Underline) and priority order. For XLSX/CSV: map columns visually with live sample preview. |
| **4** | **Preview, Validation & Inline Fix** | Virtualized list (`@tanstack/react-virtual`) supporting 10,000+ parsed items. Top summary bar: **Total**, **Valid**, **Warnings/Conflicts**, **Errors**. Quick filter tabs (`All`, `Errors`, `Warnings`, `Valid`). Inline quick editor to fix a missing/conflicting correct answer, edit stem/options, or exclude a row without leaving the wizard. |
| **5** | **Import Options** | Choose target mode: **Append to Set** or **Replace Existing Questions** (with confirmation), assign optional default Chapter & Tags, toggle "Skip invalid rows" vs. "Block until 0 errors". |
| **6** | **Commit & Summary** | Sends validated payload to `/api/import/commit` in chunks of 500 questions. Displays deterministic progress bar, final `import_jobs` audit summary (imported / skipped / warnings), and direct buttons to **View Set**, **Start Practice**, or **Start Mock Exam**. |

---

## 4. Validation & Accuracy Rules

Every parsed item runs through `validateParsedQuestion()` before Step 4 & before `/api/import/commit`, emitting `ImportValidationIssueCode` codes matching `src/types/import.ts`:
- `EMPTY_PROMPT` (`error`): Prompt is blank after trimming.
- `TOO_FEW_OPTIONS` (`error`): Choice question (`single_choice`, `multiple_choice`, `true_false`) has `< 2` non-empty options.
- `NO_CORRECT_ANSWER` (`error`): Choice question has `0` options marked `isCorrect = true`.
- `DUPLICATE_OPTIONS` (`warning`): Two options in the same question have identical normalized text.
- `ANSWER_SIGNAL_CONFLICT` (`warning`): Two DOCX/text answer signals disagree on which option is correct (e.g., bold A vs red C).
- `AMBIGUOUS_ANSWER_KEY_MAPPING` (`warning`/`error`): End-of-doc answer key count or numbering does not match question numbering.
- `EMPTY_FLASHCARD_BACK` (`error`): Flashcard item has empty `backText`.
- `DUPLICATE_QUESTION_IN_BATCH` (`info`/`warning`): Exact normalized prompt duplicate detected within the same import batch.
- `INVALID_CORRECT_ANSWER` (`error`): Column-mapped answer value does not resolve to any valid option.
- `UNPARSED_BLOCK` / `INVALID_FORMAT` (`warning`/`error`): Unrecognized text block or malformed structure.

**Commit Integrity Rule:** Rows with `severity === 'error'` can NEVER be silently inserted as broken questions; the user must either fix them inline in Step 4 or explicitly choose "Skip invalid rows" in Step 5.
