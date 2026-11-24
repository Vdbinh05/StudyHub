# StudyHub V1.0 — Testing, Quality Assurance & Verification Specification

> **Testing Stack:** Vitest + React Testing Library + jsdom (Unit & Integration) · Playwright (End-to-End & Responsive Viewports) · TypeScript (`tsc --noEmit`) + ESLint (Static Analysis).
> **Mandate:** Every deterministic engine (parsers, SM-2, grading, shuffling, upload security) MUST be backed by repeatable automated tests using real fixtures — zero mocked-away assertions.

---

## 1. Test Pyramid & Directory Layout

```text
tests/
├── unit/
│   ├── utils.test.ts                  # Foundation smoke & utility tests
│   ├── learning/
│   │   ├── sm2.test.ts                # SM-2 intervals, ease factor bounds, mastery transitions
│   │   ├── grading.test.ts            # UUID single/multi choice, shuffled grading, text match modes, Vietnamese diacritics
│   │   └── shuffle.test.ts            # Deterministic seeded shuffle distribution & option-UUID preservation
│   ├── import/
│   │   ├── eduquiz-txt.test.ts        # *B. single/multi correct, chapters, multiline, UTF-8 BOM
│   │   ├── word-answer-key.test.ts    # Inline ANSWER:/Đáp án:, End-of-doc key, multi-chapter reset!
│   │   ├── docx-ooxml.test.ts         # Bold, highlight, red/blue color, underline, tables, conflicts, baseline bold subtraction
│   │   ├── xlsx-wayground.test.ts     # Wayground template + generic column mapping
│   │   ├── quizlet-csv-json.test.ts   # Quizlet TSV, custom delimiters, CSV quotes/BOM, JSON round-trip
│   │   └── stress-scale.test.ts       # 600-question & 10,000-question performance + accuracy benchmarks
│   └── security/
│       ├── upload-guard.test.ts       # Magic bytes, 15MB cap, zip-bomb ratio/size/entry limits, macro rejection, ZIP slip
│       ├── sanitizer.test.ts          # Safe URL check, XSS payload escaping, open redirect guard
│       └── exam-sanitizer.test.ts     # Guarantees zero correct_option_ids / is_correct / explanation pre-submit
├── integration/
│   ├── api-sets-crud.test.ts          # Zod validation, ownership checks, bulk chunking
│   ├── api-exam-lifecycle.test.ts     # Snapshot immutability, pre-submit anti-leak, expiry reject, idempotent submit
│   └── rls-isolation.test.ts          # Verifies User B cannot read/write User A's private sets/attempts
├── fixtures/
│   ├── eduquiz_sample.txt
│   ├── word_inline_key.txt
│   ├── word_end_key_multichapter.txt
│   ├── formatted_answers.docx         # Generated deterministically via jszip test helper or committed binary fixture
│   ├── conflict_answers.docx
│   ├── wayground_sample.xlsx          # Generated via exceljs
│   ├── generic_mapping.xlsx
│   ├── quizlet_export.tsv
│   ├── questions_utf8_bom.csv
│   ├── studyhub_export.json
│   └── malicious/                     # Synthetic safe test payloads (fake magic bytes, synthetic zip-ratio metadata, SVG upload)
└── e2e/
    ├── studyhub-journey.spec.ts       # Full 20-step E2E user journey
    ├── responsive-viewports.spec.ts   # Layout & overflow checks across 6 viewports
    └── accessibility-smoke.spec.ts    # Keyboard navigation, skip link, aria-invalid, reduced motion
```

---

## 2. Import Fixture & Stress-Test Matrix

Every parser MUST pass 100% deterministic assertions against these test cases:

| # | Test Case | Expected Deterministic Outcome |
| --- | --- | --- |
| 1 | EduQuiz TXT (`*B.`, single + multi `*A. *C.`, chapters `Chương 1`/`Chương 2`, multiline stem) | 100% questions & options extracted, chapters assigned, `single_choice` vs `multiple_choice` accurate, `detectionSources = ['asterisk_prefix']`. |
| 2 | Word Inline Key (`ANSWER: A`, `Đáp án: D`, `Đáp án: B, C`) | Exact correct options flagged, `detectionSources = ['inline_answer_key']`, explanation captured separately. |
| 3 | Word End-of-Doc Key with Multi-Chapter Number Reset (Ch1: 1..10, Ch2: 1..10) | Chapter 2 Q1 maps to Chapter 2 Key 1 (NOT overwriting Chapter 1 Q1!), zero silent overwrites. |
| 4 | DOCX OOXML Bold / Yellow Highlight / Red Font / Underline | Exact styled option marked `isCorrect = true` with matching `AnswerDetectionSource`; documents where *all* options are bold do NOT false-positive. |
| 5 | DOCX OOXML Conflict (Option A bold + Option C red) | Flags `ANSWER_SIGNAL_CONFLICT` warning for Step 4 resolution rather than silently hiding conflict. |
| 6 | DOCX OOXML Table-based Questions & Embedded PNG Image | Extracts table rows accurately and attaches raster media reference cleanly. |
| 7 | Wayground XLSX + Generic XLSX with Custom Column Mapping | Parses 1-based numeric answers (`2`, `1,3`), letter answers (`B`), and text matches accurately. |
| 8 | Quizlet TSV (Tab/Newline & Custom `|` / `\n\n`) | Produces `flashcard` items with accurate `prompt`, `backText`, and accepted answers. |
| 9 | CSV with UTF-8 BOM, quoted commas, multiline cells, Vietnamese diacritics | Clean UTF-8 NFC text, zero mojibake, zero column shift. |
| 10 | JSON Export -> Re-Import Round-Trip | Deep-equal preservation of prompt, options, `isCorrect`, chapters, explanations, hints, difficulty, tags. |
| 11 | **600-Question Stress Test** | Parses in `< 500ms`, 0 dropped questions, 100% answer accuracy. |
| 12 | **10,000-Question Stress Test** | Parses in `< 5,000ms` (5s), peak memory bounded, 10,000/10,000 valid items, chunked into 20 x 500 batches cleanly. |
| 13 | **Malicious Upload Rejections** | Fake `.docx` magic bytes rejected; `.docm` rejected; ZIP ratio > 100:1 rejected; uncompressed > 50 MB rejected; `image/svg+xml` rejected. |

---

## 3. Playwright 20-Step End-to-End User Journey

`tests/e2e/studyhub-journey.spec.ts` covers the complete real production loop (with graceful skip/setup instructions if live Supabase env vars are absent in offline CI, and full execution when configured):

1. Visit `/` -> verify Vietnamese default UI, zero console errors, toggle `VI` <-> `EN` and Light <-> Dark mode.
2. Navigate to `/register` -> verify Zod validation on invalid inputs -> register or sign in via `/login`.
3. Land on `/dashboard` -> verify real authenticated shell, daily goal widget, quick actions.
4. Go to `/library` -> create a new Folder (`Giải tích 1`).
5. Create a new Study Set inside the folder via `/sets/new`.
6. Open `/sets/[id]/import` -> complete 6-step wizard with EduQuiz TXT fixture -> verify preview counts & commit.
7. Open `/sets/[id]/edit` -> edit a question prompt, add a new question manually, assign a chapter & tag -> save & reload to confirm DB persistence.
8. Open `/sets/[id]` -> verify chapter breakdown, question list, star a question.
9. Launch `/sets/[id]/flashcards` -> flip via `Space`, rate `Good` (`3`), verify progress advance.
10. Launch `/sets/[id]/learn` -> answer 1 wrong (confirm re-queue) and answer remaining right to finish round.
11. Launch `/sets/[id]/practice` -> verify instant green/red feedback + explanation reveal.
12. Launch `/sets/[id]/write` -> type answer with differing case/whitespace -> verify deterministic grading.
13. Launch `/sets/[id]/match` -> match all pairs -> verify completion time recorded.
14. Launch `/sets/[id]/test` -> start timed exam -> **assert network response contains ZERO `is_correct` or `correct_option_ids`** -> answer questions, flag 1 question, reload page to verify autosave persistence -> submit exam.
15. Land on `/sets/[id]/results/[attemptId]` -> verify score %, chapter accuracy breakdown, wrong filter, and explanations -> edit source question in `/sets/[id]/edit` and re-check `/sets/[id]/results/[attemptId]` to confirm **snapshot immutability**.
16. Visit `/starred` -> verify starred question appears and can be filtered.
17. Visit `/review` -> verify SM-2 queue renders due/reviewed stats.
18. Visit `/history` & `/statistics` -> verify exam attempt appears in history and charts render without errors.
19. Generate share link on `/sets/[id]` -> open `/share/[token]` -> verify clone/access controls; check `/friends` and `/shared`.
20. Export set as JSON & CSV -> visit `/profile` & `/settings` -> update preference -> sign out -> verify `/dashboard` redirects to `/login`.

---

## 4. Responsive Viewport Verification Matrix

Playwright (`tests/e2e/responsive-viewports.spec.ts`) verifies **zero horizontal overflow** (`document.documentElement.scrollWidth <= window.innerWidth`), visible navigation controls, and `>= 44px` mobile touch targets across all 6 required widths:

| Viewport | Width x Height | Target Device Class | Key Checks |
| --- | --- | --- | --- |
| **Small Mobile** | `360 x 800` | Compact Android | Bottom nav visible, zero clipped text, option cards wrap cleanly |
| **Standard Mobile** | `390 x 844` | iPhone 14/15 | One-hand bottom nav + Sheet menu, Focus mode drawer usable |
| **Tablet Portrait** | `768 x 1024` | iPad Mini / Air | Clean 2-column cards, readable modal/wizard widths |
| **Laptop / Tablet Landscape** | `1024 x 768` | Small Laptop | Left sidebar appears, Exam split view fits cleanly |
| **Desktop Standard** | `1440 x 900` | MacBook / Monitor | Optimal reading measure (`max-w-3xl`), full charts & tables |
| **Large Desktop** | `1920 x 1080` | Full HD Monitor | Centered layout, no stretched single-line questions |

---

## 5. Accessibility & Security Audit Gate (Pre-Release Checklist)

- [x] `npm run typecheck` exits `0`.
- [x] `npm run lint` exits `0`.
- [x] `npm run test` (all 50 Vitest files / **363 tests**, including 600 & 10,000 stress, PDF export, diagram geometry, offline sync, security, and live PG 17.12 DB + 2/3-account RLS/HTTP suites) exits `0`.
- [x] `npm run build` exits `0` (**64/64 static pages**, **114 App Router routes** + `ƒ Proxy`, `0` secret/server-parser leaks in `.next/static/`).
- [x] Zero AI packages (`openai`, `@google/genai`, `anthropic`, `ai`, `langchain`, paid TTS/STT/OCR) and zero payment packages (`stripe`, `paddle`) in `package.json`.
- [x] Zero occurrences of `SUPABASE_SECRET_KEY` / `SUPABASE_SERVICE_ROLE_KEY` outside server-only files (`src/lib/supabase/admin.ts`, `env.ts`).
- [x] `dangerouslySetInnerHTML` restricted solely to `renderSafeKatexHtml()` (`trust: false`) in `RichContentRenderer.tsx` / `RichTextEditor.tsx`; zero raw user HTML rendering.
- [x] All **36 Supabase tables** (Migrations `0001`–`0016`) have `ENABLE ROW LEVEL SECURITY`, `0` Security Advisor errors, and `0` `unindexed_foreign_keys`.
- [x] Skip-to-content link, IME-safe keyboard shortcuts (`?`), `Ctrl+K` Hard Exam Guard, `prefers-reduced-motion`, Light/Dark WCAG 2.2 AA contrast, and 6-viewport (`360`–`1920px`) + mobile `390px` diagram/offline zero overflow verified live.

---

## 6. StudyHub V3.0 (Complete Learning Edition) — Expanded Live Verification Suite

StudyHub V3.0 expands the test pyramid to **50 Vitest test files (363 tests)** and **3 Playwright E2E specs (22 live tests)**:

### 6.1 V3.0 Unit & Integration Suites (`npm run test`)
- **Media, Audio & Rich Text (`tests/unit/media/*`, `tests/unit/audio/*`, `tests/unit/richtext/*`):** Image/audio magic-byte & size guards, `AudioRecorderControl`, `SpeechSynthesis` TTS wrapper, `ImageLightbox` & `AudioPlayer` components, TipTap JSON AST v1 sanitization + safe KaTeX (`trust: false`).
- **Multimedia DOCX, Text-Based PDF Import & Vietnamese PDF Export (`tests/unit/import/docx-multimedia.test.ts`, `pdf-import.test.ts`, `tests/unit/export/pdf-export.test.ts`):** Embedded OOXML image extraction, multi-page Vietnamese selectable-text PDF & scanned-PDF detection, all 5 Vietnamese PDF export modes (`NotoSans` embedding, post-shuffle key accuracy, 250-question paper).
- **12-Type Grading, Confidence, Spell, Adaptive Learn & Checkpoints (`tests/unit/learning/*`, `tests/unit/questions/registry.test.ts`):** All 12 exam question types + flashcard exclusion, `matching` pre-submit payload normalization, P0 Confidence Exam Score Neutrality, Spell Mode diff & IME guards, Learn Mode TSV MCQ payload, Resume checkpoints.
- **Visual Diagram Mode (`tests/unit/diagram/*`):** Normalized `[0,1]` point/rect/polygon geometry engine (`25` tests), 6-mode study engine (`7` tests), `DiagramStudyPlayer` components (`4` tests), and SQL parity (`2` tests).
- **PWA, Account-Partitioned IndexedDB & Offline Sync (`tests/unit/offline/*`):** Manifest/icon/SW hygiene (`7` tests), per-`userId` IndexedDB isolation (`7` tests), Download Manager (`5` tests), Offline Session (`4` tests), Sync/Conflict protocol (`5` tests), PWA UI & lazy `PwaProvider` (`6` tests).
- **Keyboard Shortcuts & Global Search (`tests/unit/ui/shortcuts.test.ts`):** Context priority, Vietnamese IME suppression (`isComposing`, `keyCode === 229`, 50ms window), `Ctrl+K` Hard Exam Guard, and `GlobalSearchResponse` normalization (`10` tests).
- **Live Supabase Cloud PostgreSQL 17.12 Suites (run automatically when `.env.local` + `LIVE_API_BASE_URL` are present, strictly preserving pre-existing real user data via tracked disposable `*@studyhub-test.local` cleanup):**
  - `tests/integration/live-db-rpcs.test.ts` (**8/8 PASS LIVE** — V2.1 regression)
  - `tests/integration/live-v3-db-rpcs.test.ts` (**8/8 PASS LIVE** — V3.0 schema, 12-type grading, confidence neutrality, clone, 6-scope reset, 8-entity search, offline sync protocol, `ON DELETE RESTRICT` + delete triggers)
  - `tests/integration/live-rls-security.test.ts` (**11/11 PASS LIVE** — V2.1 2-account RLS/Storage/HTTP regression)
  - `tests/integration/live-v3-rls-security.test.ts` (**11/11 PASS LIVE** — V3.0 3-account Notes/Reports/Checkpoints/Sync/Media/Audio/12-Type Anti-Leak/PDF Auth/CSP/SW security)

### 6.2 V3.0 Live Playwright E2E Suite (`22 / 22` PASS)
- `tests/e2e/studyhub.spec.ts` (**13/13 PASS** — public routes, prod CSP/HSTS, `/api/health`, localized 404, Light/Dark, VI/EN `<title>` reload persistence, protected redirects, reduced motion, 6 viewports `360`–`1920px`).
- `tests/e2e/authenticated-journey.spec.ts` (**3/3 PASS** — full V1.0 + V2.0/V2.1 multi-subject & Full Coverage live regression).
- `tests/e2e/v3-complete-learning.spec.ts` (**6/6 PASS** — `V3-T1` PWA/Shortcuts/Settings, `V3-T2` Media/KaTeX/Lightbox/DOCX+PDF Import, `V3-T3` All 12 Types/Confidence Neutrality/Hard Exam Guard/Notes/Reports/PDF Export, `V3-T4` Spell/Audio Flashcards/Learn/Resume/Scoped Reset preserving Exam History, `V3-T5` Visual Diagrams Desktop+Mobile `390px`+2-Account RLS, `V3-T6` True Offline PWA `setOffline(true)` + Offline `F5` Reload + Sync + Same-Browser Account-Switch A→B `0`-Leak Isolation).

> **Data Safety Rule for Live Cloud Tests:** Never wipe or reset a shared Supabase Cloud project containing real user data. All live integration & E2E tests provision prefixed disposable accounts (`*@studyhub-test.local`), track exact created UUIDs, delete ONLY those tracked users/blobs in `afterAll`/`finally`, and assert `trackedRemaining === 0`. See [`docs/audit/v3/TEST_MATRIX.md`](audit/v3/TEST_MATRIX.md) (**93/93 PASS**, **55/55 §41 Acceptance Criteria VERIFIED**).
