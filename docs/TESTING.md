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

- [ ] `npm run typecheck` exits `0`.
- [ ] `npm run lint` exits `0`.
- [ ] `npm run test` (all Vitest suites including 600 & 10,000 stress + security tests) exits `0`.
- [ ] `npm run build` exits `0`.
- [ ] Zero AI packages (`openai`, `@google/genai`, `anthropic`, `ai`, `langchain`) and zero payment packages (`stripe`, `paddle`) in `package.json`.
- [ ] Zero occurrences of `SUPABASE_SERVICE_ROLE_KEY` outside server-only files (`src/lib/supabase/admin.ts`).
- [ ] Zero occurrences of `dangerouslySetInnerHTML` on user/imported content.
- [ ] All 20 Supabase tables have `ENABLE ROW LEVEL SECURITY` and verified policies.
- [ ] Skip-to-content link, keyboard shortcuts, `prefers-reduced-motion`, Light/Dark contrast >= 4.5:1 verified.
