# StudyHub V3.0 (Complete Learning Edition) — Wave 5B Independent Functional & Regression Verification Report

> **Independent Functional Tester:** `func-tester` (Agent 2)  
> **Date:** 2026-11-24  
> **Scope:** Independent live Wave 5 & Wave 5B end-to-end Playwright verification of the V3.0 Complete Learning Edition (`next start -p 3022` → live Supabase Cloud `StudyHub` / `cuoaifyupfmkstqhcjwy`, PostgreSQL 17.12, migrations `0001`–`0016`) plus 100% V2.1 regression coverage and cross-verification against sibling live audit reports (`DB_BACKEND_AUDIT.md`, `SECURITY_AUDIT.md`, `PERFORMANCE_REPORT.md`).  
> **Companion Matrix:** [`docs/audit/v3/TEST_MATRIX.md`](./TEST_MATRIX.md) (**93 / 93 cases PASS**, **55 / 55 §41 Acceptance Criteria PASS**, `0 PENDING`, `0 FAIL`, `0 BLOCKED`).  
> **Strict Independence & Data Safety:** Zero edits to `src/*` or `supabase/*` by `func-tester`. Live Supabase Cloud contains pre-existing real user data; ONLY prefixed disposable accounts (`v3-e2e-a/b-<ts>@studyhub-test.local`) tracked by exact UUID were created and deleted (`TRACKED_USERS_REMAINING=0`, pre-existing real user data 100% untouched). Zero secrets/JWTs printed or committed; zero raw `sample-data/` text copied.

---

## 1. Fresh Wave 5B Integrated Verification Gate Outputs

Every command below was executed fresh after all 19 Wave 5 defects (`V3-SEC-01..05`, `V3-PERF-01..03`, `V3-DB-01..05`, `V3-FUNC-01`, `V3-UX-01..06`) were fixed and the clean Wave 5B production build (`#185`) landed:

| Verification Gate | Exact Command / Scope | Exit Code | Fresh Verified Result |
| --- | --- | ---: | --- |
| **Complete Live Playwright E2E Suite (Port `3022`)** | `PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3022 PLAYWRIGHT_EXPECT_PROD=1 E2E_SUPABASE_READY=1 npx playwright test --workers=1 --reporter=list` | `0` | **PASS — `22 / 22` PASSED (`0` skipped, `0` failed, `4.1m`)**: `13/13` `studyhub.spec.ts` + `3/3` `authenticated-journey.spec.ts` (V2.1) + `6/6` `v3-complete-learning.spec.ts` (V3.0); `SERVER_HEALTH=ok supabaseConfigured=true`; **`PORT_3022_FREE`**; **`CLEANUP_USERS_DELETED=2/2`**; **`TRACKED_USERS_REMAINING=0`** |
| **TypeScript (`tsc`)** | `npm run typecheck` (`tsc --noEmit`) | `0` | **PASS** — `0` errors globally across `src/*` and `tests/*` |
| **ESLint (E2E Suites)** | `npx eslint tests/e2e/studyhub.spec.ts tests/e2e/authenticated-journey.spec.ts tests/e2e/v3-complete-learning.spec.ts` | `0` | **PASS** — `0` errors, `0` warnings (full-repo `npm run lint` also exit `0` in `#185`) |
| **Vitest Unit & Integration (Global + Live Suites)** | Unit/Offline (`#185`: `46/46` = `325/325`) + Live PG DB/RPC (`#181`: `2/2` = `16/16`) + Live RLS/HTTP Security (`#188`: `2/2` = `22/22`) | `0` | **PASS — `50 / 50` test files, `363 / 363` tests PASS (`0` failures)** |
| **Wave 5B Production Build & Bundle Hygiene** | Clean `.next` build (`#185`, verified `#187` & `#188`) | `0` | **PASS** — `104` App Router routes, `64/64` static pages, `0` secret/server-parser leaks in `.next/static/`, Landing `/` `-33.5%` gzip, `/exams/[attemptId]` `-41.5%` gzip |
| **Migration Immutability (`0001`–`0012`)** | `git diff v2.1-verified -- supabase/migrations/0001*..0012*` | `0` | **PASS** — `0` diffs (`0001`–`0012` strictly untouched; `0013`–`0016` live on PG 17.12, `36/36` tables RLS-enabled) |

---

## 2. Complete 22-Test Live Playwright E2E Breakdown (`task-906`, Port `3022`)

### 2.1 V2.1 Full Regression Suite — **16 / 16 PASS (`0` Regressions!)**
1. **`tests/e2e/studyhub.spec.ts` (`13 / 13 PASS`):**
   - Production CSP (`'unsafe-eval'` absent, `media-src`/`worker-src`/`manifest-src` active) & HSTS headers (`17ms`)
   - `/api/health` (`supabaseConfigured: true`) & deterministic EduQuiz template endpoint (`16ms`)
   - Public & auth pages semantic `<h1>` + zero uncaught errors (`3.8s`)
   - Custom localized 404 (`NotFoundView`, `790ms`)
   - Light/Dark (`menuitemradio`), VI/EN `<title>` reload persistence & skip-link localization (`1.8s`)
   - Protected V1 & V2 route redirects to `/login` with zero `503`s & zero env-var leaks (`6.2s`)
   - `prefers-reduced-motion: reduce` clean rendering (`852ms`)
   - All **6 responsive viewports** (`360×800`, `390×844`, `768×1024`, `1024×768`, `1440×900`, `1920×1080`) with zero horizontal overflow (`2.6–2.7s` each)
2. **`tests/e2e/authenticated-journey.spec.ts` (`3 / 3 PASS, 0 skipped`):**
   - **Scenario 1 (`51.1s`):** Real Login → Folder CRUD (`/library?create=folder`) → Private set + 50Q 6-step `ImportWizard` + 50Q×4opts read-back → ALL 5 Learning Modes (`Flashcards`, `Practice`, `Learn` feedback stability, `Write`, `Match`) → Timed Exam (zero pre-submit key leak + `PUT /answers` `200` + `F5` reload persistence + AlertDialog submit) → `/starred`, `/review`, `/history`, `/statistics`, `/profile` → `/settings` `#pref-shuffle-q` live DB reload persistence → 2-Account Private RLS block, `/share/[token]` redeem (`title` + `Chỉ xem`), `allow_clone: false` (`403`), `viewer` edit block (`403`), independent exam attempt isolation, revocation (`404/410`), and `/auth/signout` → `/login`.
   - **Scenario 2 (`31.1s`):** 2 sets (`20Q MonA` + `10Q MonB`) → `/exams/new` multi-subject `Equal` & `Proportional` strategy switching → Save & verify **Exam Preset** in `Saved Presets` tab → Live timed exam + `F5` reload → Submit → **Mixed-Subject Results** rendering both subjects.
   - **Scenario 3 (`20.9s`):** Live `10Q` set → `/exams/new` Full Coverage (`5/exam`) → Exam #1 (`5` unique IDs) completed → Exam #2 (`next-exam`) verified **ZERO overlap (`[]`)** & **`10` unique union** → Exam #2 completed → cycle reached `status === "completed"` & `completed_count === 10` (and clean `0012` account delete cascade!).

### 2.2 New V3.0 Complete Learning Edition Live Suite (`tests/e2e/v3-complete-learning.spec.ts` — **6 / 6 PASS!**)
1. **`V3-T1` (`6.4s` — PASS):**
   - `/manifest.webmanifest` `200` (`standalone`, `/dashboard`) + every PNG icon `200` with valid `\x89PNG` magic header.
   - `/sw.js` `200` with `Cache-Control: no-cache, no-store, must-revalidate`, `APPLY_UPDATE` gated `skipWaiting`, and strict `/api/` & `/auth/` exclusion.
   - `/offline` renders cleanly with semantic `<h1>`.
   - Press `?` on `/dashboard` → `ShortcutHelpModal` dialog opens & closes cleanly on `Esc`.
   - `/settings` Learning Modes tab toggle → `PATCH /api/preferences` `200` → full `page.reload()` confirms live DB persistence.
2. **`V3-T2` (`9.7s` — PASS, re-verifies `V3-FUNC-01`, `V3-UX-04`, `V3-PERF-01` LIVE!):**
   - Private raster PNG upload (`201`, `proxyUrl`), SVG rejected (`415`); PCM WAV upload (`201`, `proxyUrl`), spoofed HTML-as-MP3 rejected (`415`).
   - Created `image_choice` question with TipTap `RichTextDoc` AST containing `$E = mc^2$`, prompt image, and image-only options (`content: ""`) → opened `/sets/[id]/practice` → asserted live **`.katex` rendered cleanly**, opened **`ImageLightbox`**, clicked Zoom In (`+`), Reset (`0`), and closed via `Esc`.
   - Parsed real OOXML multimedia `.docx` (`word/media/image1.png`) via `/api/import/parse` → asserted `format === "docx_multimedia"`, `extractedMedia.length >= 1`, and `promptMedia.length >= 1`.
   - Parsed real Vietnamese Unicode text-layer `.pdf` (`NotoSans-Regular.ttf`, `Câu 1..3`) via live `next start` `/api/import/parse` → asserted `format === "pdf_text"` and `3/3` Vietnamese questions extracted cleanly (`V3-PERF-01` LIVE VERIFIED!).
   - Parsed real image-only scanned `.pdf` → asserted honest scanned-PDF detection (zero silent garbage, zero HTTP `500`).
3. **`V3-T3` (`24.9s` — PASS, re-verifies ALL 12 Types, `V3-UX-05`, `V3-SEC-01`, Confidence Neutrality & Hard Exam Guard LIVE!):**
   - Created `shared_passages` row + bulk-inserted **ALL 12 exam-compatible question types + 1 `flashcard` (`13` total)**: `single_choice`, `multiple_choice`, `true_false`, `short_answer`, `fill_in_blank`, `numerical` (`9.81 ± 0.05 m/s2`), `image_choice`, `ordering`, `matching`, `image_hotspot` (rect), `reading_passage`, `listening`, and `flashcard`.
   - Verified Bulk Editor (`PATCH /api/sets/[id]/questions/bulk` `200`) & `/sets/[id]/edit` UI render.
   - Created 12-question live exam (`flashcard` strictly excluded!), verified **zero pre-submit leak** (`correct_option_ids`, `accepted_answers_snapshot`, `target_hotspots`, and Listening transcript all absent!).
   - Opened active `/exams/[attemptId]` in Chromium → verified **Global Search Hard Exam Guard** (`Ctrl+K` produces `0` search dialogs!) & crash-free rendering of `matching` (`V3-UX-05`).
   - Saved deterministic answers for all 12 types with **Confidence tags** (`guessing` on correct items, `certain` on the 1 intentionally wrong item) → submitted → asserted **exact `11/12 = 91.67%` (proving P0 Exam Score Neutrality LIVE!)** and verified `/exams/[attemptId]/results` displays `91.67`.
   - Pressed `Ctrl+K` on `/dashboard` → verified live `GlobalSearchDialog` returns matching study set.
   - **2-Account Personal Notes Isolation & Question Reports:** Shared set as `viewer` (`allow_clone: false`); User A & User B each wrote private notes on Q1 → confirmed `GET /api/notes` and `GET /api/search` have **0 cross-user note leaks bidirectionally**; User B submitted a `wrong_answer` report → User A listed & resolved it (`status: "resolved"`).
   - **Vietnamese PDF Export (`V3-SEC-01`):** User A `POST /api/export/pdf` (`mode: "paper_and_key"`, `locale: "vi"`) returned HTTP `200`, `application/pdf`, valid `%PDF-` header (`>5 KB`); User B (`allow_clone: false`) received **`403`**!
4. **`V3-T4` (`28.3s` — PASS):**
   - **Spell Mode (`/sets/[id]/spell`):** Entered wrong spelling `"wrongspellxyz"` → verified deterministic character diff / retry feedback rendered cleanly.
   - **Audio Flashcards (`/sets/[id]/flashcards`):** Verified uploaded WAV `<audio>` rendered visibly, `Space` flipped card, key `3` rated Good.
   - **Advanced Learn (`/sets/[id]/learn`) & Advanced Review Mistakes (`/review`):** Verified clean rendering with zero errors.
   - **Resume Session Checkpoint Across F5 Reload:** Saved checkpoint via `PUT /api/checkpoints` → navigated `/dashboard` → full `page.reload()` → verified persisted checkpoint returned by `GET /api/checkpoints`.
   - **Scoped Reset Progress Preserving Exam History:** Submitted an exam attempt → ran `POST /api/progress/reset` (`scope: "study_set"`, `confirm: "RESET_PROGRESS"`) → verified checkpoint cleared AND **prior exam attempt remained `200` `submitted` 100% intact!**
5. **`V3-T5` (`23.3s` — PASS):**
   - Uploaded diagram PNG (`purpose: "diagram"`) → created Diagram with **Point + Rect + Polygon** hotspots → verified `/sets/[id]/diagrams`, `/diagrams/[id]/edit` (all 3 labels visible), and `/diagrams/[id]/study` (`<svg>` overlay visible).
   - Switched live viewport to **Mobile `390×844`** → verified **`overflowX === false`**.
   - Verified 2-Account Diagram RLS: non-member B blocked (`403/404`); after `viewer` redeem, B reads `200` and is blocked `403` on `PATCH /api/diagrams/[id]`.
6. **`V3-T6` (`19.4s` — PASS, True Offline PWA + Sync + Account Isolation!):**
   - Opened Study Set Hub `/sets/[id]` → clicked `[data-testid="offline-download-trigger"]` → downloaded set into IndexedDB.
   - Opened `/offline` online (confirmed downloaded set visible + active Service Worker ready + reloaded online so SW controlled page).
   - **Switched Chromium context TRUE OFFLINE (`context.setOffline(true)`):** started `[data-testid="offline-study-runner"]`, answered Q1 offline, executed a **genuine `F5` `page.reload()` WHILE STILL OFFLINE**, and confirmed `<h1>`, `[data-testid="offline-manager-panel"]`, and `studyhub-offline-v3*` IndexedDB survived intact!
   - **Reconnected Online (`context.setOffline(false)`):** clicked `[data-testid="sync-now-button"]`, verified live `POST /api/sync/events` returned **`ignored_stale_reset`** for stale generation `currentGen - 1`, **`applied`** for live generation, and **`duplicate_ignored`** on identical `event_id` replay!
   - **Account-Switch IndexedDB Isolation (P0):** Signed out User A → signed in User B in the **SAME** browser context → verified User B saw **`0` downloaded sets from User A** in `/settings?tab=offline`!

---

## 3. Wave 5 Functional Defect Caught & Re-Verified Fixed

During Wave 5 Pass 1 (`task-833`), `func-tester` independently caught a real P1 functional regression in Practice Mode and reported it directly (`#170`) without touching `src/*`:

| ID | Sev | Defect Caught in Wave 5 Pass 1 | Owning Builder & Fix Ref | Wave 5B Live Re-Verification |
| --- | --- | --- | --- | --- |
| **`V3-FUNC-01`** | **P1** | `PracticeClient.tsx:1141-1214` & `CustomPracticeClient.tsx:2026-2090` rendered raw `{question.prompt}`, plain `<img>`, and plain `{option.content}` — dropping TipTap Rich Text & KaTeX (`$E = mc^2$` showed as literal text), omitting `ImageLightbox` zoom on prompt images, and rendering **completely blank radio buttons** on `image_choice` image-only options! | `@v2-exam-learning-builder` (`#183` — wired `<SafeRichText>` w/ leaf `RichContentRenderer`, `<ZoomableImage>` opening real `ImageLightbox`, `<AudioPlayer>`, and `image_choice` 2-col image grid + lightbox trigger) | **VERIFIED FIXED LIVE** in `V3-T2` (`task-906`: `.katex` rendered visibly, `ImageLightbox` `+`/`0`/`Esc` worked cleanly, `image_choice` options rendered cleanly!). |

Additionally, our Wave 5B 22-test suite independently cross-verified live fixes from sibling auditors:
- **`V3-PERF-01` [P0]** (live `next start` PDF import `pdfjs-dist` worker): **VERIFIED FIXED LIVE** in `V3-T2` (`3/3` Vietnamese PDF questions extracted).
- **`V3-SEC-01` [P1]** (Vietnamese PDF export `Content-Disposition` RFC 5987 + `attemptId` RPC): **VERIFIED FIXED LIVE** in `V3-T3` (`200 application/pdf %PDF-`, User B `403`).
- **`V3-DB-01` [P0]** (`0016` dropping legacy `questions_prompt_check` / `question_options_content_check`): **VERIFIED FIXED LIVE** in `V3-T2` & `V3-T3` (empty `content: ""` image-only options persisted cleanly!).
- **`V3-UX-04` [P2]** (TipTap `RichTextDoc` inline `$...$` KaTeX rendering): **VERIFIED FIXED LIVE** in `V3-T2`!
- **`V3-UX-05` [P0]** (`matching` pre-submit exam runner crash): **VERIFIED FIXED LIVE** in `V3-T3`!

---

## 4. Honest Non-Blocking Notes & Final Functional Verdict

- **Non-Blocking Operational / P3 Notes (tracked transparently, 0 P0/P1/P2 remaining):**
  1. `V3-SEC-P3-01` (`#188`): Next.js 16 default `10 MB` `proxyClientMaxBodySize` rejects `>10 MB` audio fail-closed as HTTP `400` (0 bytes stored) rather than `413`; optional `experimental.proxyClientMaxBodySize: "16mb"` recommended post-V3.0.
  2. `SH-044` (inherited from V2.1): 2 moderate upstream advisories inside `exceljs@4.4.0 -> uuid@8.3.2` (`0` Critical / `0` High).
  3. Non-fatal Vitest notice on `vitest.config.ts:1:1` CJS loader (all 363 tests pass cleanly).
  4. `real-user` Pass 2 AFTER-screenshot pass runs independently on port `3021` to confirm all 8 student scenarios visually.

- **Final Independent Functional Verdict (`func-tester`):** **`PASS — READY FOR FINAL AUDIT`** — **22 / 22** live Playwright E2E tests PASS (`0` skipped, `0` failed, `0` V2.1 regressions), **93 / 93** V3.0 Test Matrix cases PASS, **55 / 55** §41 Acceptance Criteria PASS, `EXIT_TSC=0`, `EXIT_ESLINT=0`, `PORT_3022_FREE`, `CLEANUP_USERS_DELETED=2/2`, `TRACKED_USERS_REMAINING=0` (real user data 100% preserved).
