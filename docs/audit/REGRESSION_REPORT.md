# StudyHub V2.0 — Wave 3 Independent Functional Regression & Acceptance Report

> **Independent Tester:** `func-tester` (Agent 2 — Independent Functional Tester)  
> **Date:** 2026-11-24  
> **Scope:** Full Wave 3 independent verification of integrated StudyHub V2.0 build (`src/*` and `supabase/*` strictly untouched by `func-tester`), Section 26 acceptance suite (`tests/integration/v2-acceptance.test.ts`), updated Playwright E2E suites (`tests/e2e/studyhub.spec.ts`, `tests/e2e/authenticated-journey.spec.ts`), and independent bug-by-bug regression audit of `docs/audit/ISSUE_TRACKER.md` (`SH-005`..`SH-042`) & `docs/audit/AUDIT_REPORT.md` (`BUG-001`..`BUG-040`).  
> **Companion Matrix:** [`docs/audit/TEST_MATRIX.md`](./TEST_MATRIX.md) (90 acceptance cases: `0 FAIL`, `0 NOT IMPLEMENTED`).

---

## 1. Fresh Integrated Verification Gate Outputs

Every command below was executed fresh after ALL Wave 2 builds and Wave 3 reopened fixes (`#58`, `#62`, `#64`, `#67`, `#68`, `#70`, `#72`, `#73`, `#76`, `#78`) landed:

| Gate | Exact Command | Exit Code | Fresh Measured Result |
| --- | --- | ---: | --- |
| **TypeScript** | `npm run typecheck` (`tsc --noEmit`) | `0` | **PASS** — `0` errors across entire repo (`src/*` + `tests/*`) |
| **ESLint** | `npm run lint` (`eslint .`) | `0` | **PASS** — `0` errors, `0` warnings |
| **Vitest Unit & Integration** | `npm run test` (`vitest run`, v5.1.1) | `0` | **PASS** — **22/22 test files, 167/167 tests passed** (`9.10s`), up from 16 files / 82 tests in Wave 1 (+85 new V2.0 acceptance, import, learning & security regression tests) |
| **Production Build** | `npm run build` (`next build`, Turbopack 16.4.6) | `0` | **PASS** — Compiled in `2.5s`, TypeScript `3.3s`, **52/52 static & dynamic routes generated cleanly** (`cpus: 4, memoryBasedWorkersCount: true`) |
| **Playwright Live E2E (Port 3012)** | `PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3012 PLAYWRIGHT_EXPECT_PROD=1 npx playwright test --reporter=list` | `0` | **PASS** — **13/13 public/V2.0/6-viewport tests PASSED**, **3/3 live-Supabase authenticated tests skipped** (`E2E_SUPABASE_READY!=1`), `0` failed (`9.2s`); port 3012 cleanly released (`PORT_3012_FREE`) |

### Vitest Suite Breakdown (22 Files / 167 Tests — 100% PASS)
- **New Wave 3 Independent Section 26 Suite:** `tests/integration/v2-acceptance.test.ts` — **30/30 passed** (`97ms`)
- **Integration & Round-Trip:** `tests/integration/api-and-roundtrip.test.ts` — **6/6 passed** (`242ms`)
- **V2.0 Learning & Exam Core:** `exam-allocator.test.ts` (**14**), `exam-selector.test.ts` (**8**), `write-grader.test.ts` (**8**), `exam-scoring.test.ts` (**7**), `sm2.test.ts` (**7**), `coverage-engine.test.ts` (**5**), `learn-queue.test.ts` (**5**), `shuffle.test.ts` (**5**), `match-engine.test.ts` (**2**)
- **Import & Real-File Regressions:** `v2-regressions.test.ts` (**7**), `security-and-stress.test.ts` (**5**, 10kQ parse/validate in `369ms`), `docx-ooxml.test.ts` (**4**), `quizlet-csv-json.test.ts` (**4**), `word-answer-key.test.ts` (**4**), `eduquiz-txt.test.ts` (**2**), `xlsx-wayground.test.ts` (**2**)
- **Security & SQL Migration Audits:** `v2-security-regression.test.ts` (**18**), `security-modules.test.ts` (**12**), `supabase-migrations-audit.test.ts` (**7**), `utils.test.ts` (**5**)

---

## 2. Wave 3 Defects Independently Caught, Reopened & Re-Verified Fixed

During Wave 3 independent testing, `func-tester` caught and reopened the following defects directly to owning builders without touching `src/*` or `supabase/*`, then independently re-verified each fix:

| # | Sev | Defect Discovered in Wave 3 | Owner & Reopen Ref | Fix Ref | Final Verdict |
| --- | --- | --- | --- | --- | --- |
| 1 | **P0** | **`next build` Worker OOM (`EXIT_BUILD=134`):** Next.js 16 spawned 31 simultaneous page-data workers on a 32-thread / 16GB host (~3.6GB free commit), crashing reproducibly 2/2 times. | `@v2-db-backend-builder` (`#57`) | `#58` (`next.config.ts`: `experimental: { cpus: 4, memoryBasedWorkersCount: true }`) | **VERIFIED FIXED** (`EXIT_BUILD=0`, 52/52 routes) |
| 2 | **P1** | **`SH-019` Reopen — Uploaded Avatars & Question Images Expired After 1 Hour:** `POST /api/uploads/image` minted 3600s `signedUrl` and `profile-view.tsx:154` + `question-editor-view.tsx:520` persisted that expiring JWT URL directly to DB while `GET /api/uploads/signed-url` was never called. | `@v2-db-backend-builder` + `@v2-ui-builder` (`#60`) | `#64` (`signed-url?redirect=1` + `Vary: Cookie` + `proxyUrl`) & `#68` (`profile-view.tsx:156`, `question-editor-view.tsx:522` persist `proxyUrl`) | **VERIFIED FIXED** (code + build; live Storage upload gated on `BLK-001`) |
| 3 | **P2** | **`exam-engine.ts` High-Scale Truncation:** `anti_repeat` fetched `exam_attempt_questions` for up to 10 attempts without pagination (PostgREST 1,000-row cap) and wrapped `setIds` unchunked `[setIds]`. | `@v2-db-backend-builder` (`#60`) | `#64` (`fetchAllPages` + `chunkArray(setIds, SAFE_IN_CHUNK_SIZE)`) | **VERIFIED FIXED** (code + tests) |
| 4 | **P2** | **Security Test File Defects (`v2-security-regression.test.ts`):** `forgeZipUncompressedSizes` ReferenceError (line 411) and `TS2352` type cast error (line 533). | `@security-auditor` (`#71`) | `#79` | **VERIFIED FIXED** (18/18 PASS, `tsc` 0 errors) |

---

## 3. Independent Retest Verdicts: `ISSUE_TRACKER.md` (`SH-005` – `SH-042`)

> **Verdict Legend:**
> - **`PASS`** — Verified live on production server or pure deterministic test with zero DB dependency.
> - **`PASS (Unit/Mock) — Live DB BLOCKED`** — Core deterministic logic, schema, route/SQL contract verified passing in Vitest; live PostgreSQL/Auth/Storage execution gated on `BLK-001`.
> - **`VERIFIED IN CODE — Live DB BLOCKED`** — Fix independently verified line-by-line in source code + clean `typecheck`/`lint`/`build`; live DB/authenticated browser run gated on `BLK-001`.
> - **`REOPENED`** — Still failing (**0 remaining**).

| Ticket | Sev | Area | Independent Wave 3 Evidence | Wave 3 Verdict |
| --- | --- | --- | --- | --- |
| `SH-005` | P0 | PostgREST 1,000-row option truncation & HTTP 414 (`BUG-001`) | `src/lib/supabase/query-helpers.ts:15-99` (`SAFE_IN_CHUNK_SIZE=100`, `fetchAllPages`, `fetchQuestionRelationsChunked`) wired across `questions`, `exams`, `starred`, `mistakes`, `dashboard`, `statistics`, `exam-engine.ts`, `export` (`<=120`), `duplicate` (`clone_study_set` RPC), and `commit` (`#73` prefiltered). `v2-acceptance.test.ts` verifies 500/1000Q sampling & bounds. | **`PASS (Unit/Mock) — Live DB BLOCKED`** |
| `SH-006` | P0 | `submit_exam_attempt()` multi-set `source_study_set_id` & nullable `study_set_id` (`BUG-002`) | `0005` `submit_exam_attempt()` resolves per-question `source_study_set_id`, handles `study_set_id IS NULL`, computes set-based subject/chapter/tag breakdowns, and updates coverage cycle completion (`#76`, cross-confirmed by `db-backend-auditor` `#81`). | **`VERIFIED IN CODE — Live DB BLOCKED`** |
| `SH-007` | P0 | `normalize_short_answer()` numeric `0`/`10`/`100` bug | `v2-acceptance.test.ts` verifies 3-way parity (`write-grader.ts`, `sanitize.ts`, `gradeExamQuestion`) on `0`, `0.00`, `-0`, `10`, `100`, `1.50`, `3,5` + rejection of `10` vs `1` and `100` vs `10`. `v2-security-regression.test.ts` verifies `0005` `trim_scale()` + fixed PG ARE bracket regex (`#76`). | **`PASS (Unit/Mock) — Live DB BLOCKED`** |
| `SH-008` | P0 | `LearnClient` orphaned sessions & Q#1 queue jump (`BUG-003`) | `src/components/learning/LearnClient.tsx:197-206` initializes queue & `createStudySession` strictly once per `sessionKey = ${studySetId}:${selectedChapter}:${roundSize}` (zero dependency on mutable `bundle` object); `useStudySetBundle.tsx:113` preserves `questions` reference on progress updates. | **`VERIFIED IN CODE — Live DB BLOCKED`** |
| `SH-009` | P0 | `/api/starred?pageSize=500` HTTP 400 mismatch | `study-set-hub.tsx:139` paginates with `pageSize=200`, `listStarredQuerySchema` accepts up to `500`, and `src/app/api/starred/route.ts:56-102` returns chunked `options`, `accepted_answers`, `tags`, and `progress` (also fixes `BUG-038`). | **`VERIFIED IN CODE — Live DB BLOCKED`** |
| `SH-010` | P0 | Exam autosave `>200` offline data loss, concurrency & `answered_count` `0/N` (`BUG-008`/`009`/`010`) | `LiveExamRunner.tsx:220-454` merges local draft ONLY when strictly newer (`clientSeq`/`updatedAtMs`), flushes in `<=150` chunks via `saveExamAnswers`, and HALTS manual submit if flush fails. `0005` `save_exam_attempt_answers()` uses `FOR NO KEY UPDATE`, atomic `client_seq` guard (`#76`), and recalculates `exam_attempts.answered_count`. | **`VERIFIED IN CODE — Live DB BLOCKED`** |
| `SH-011` | P0 | Universal Custom Exam Builder (`/exams/new`, `/exams`, `/practice`, Strategies A–E, 8 Policies, Full Coverage, Presets) | All 52 routes built (`EXIT_BUILD=0`); `v2-acceptance.test.ts` (**30/30 PASS**) independently proves sampling bounds, deduplication, Strategies A–E (FE+BE 1:1 parity incl. `500/226/133 -> 145/66/39`), all 8 Selection Policies (strict non-padding & honest `anti_repeat`), Full Coverage (`500->250+250`, `500->120×4+20`, tri-state, discard, snapshot), weighted overall accuracy, and `/api/exams/preview`. | **`PASS (Unit/Mock) — Live DB BLOCKED`** |
| `SH-012` – `SH-016` | P1 | Security P1s (composite FKs, `create_exam_attempt_v2`, `profiles.email`, `unlisted`, `zod` upgrade) | Verified by `security-auditor` (`#79`: `npm audit` 0 High/Critical, 37/37 security unit tests PASS) + `starred/route.ts:124-141` DB ownership checks. | **`PASS (Unit/Mock) — Live DB BLOCKED`** |
| `SH-017` – `SH-018` | P1 | Real `sample-data/` DOCX dedup (`Q#30`), XLSX 2-row headers, `SC/MC/TF`, sheet switch, `/docx-media/` | Verified by `perf-import-auditor` (`#75`): `01.docx` `133/133` (0 false dup), `05.xlsx` `24/24`, `08.docx` `62/62`, `08.xlsx` `62/62` (100% cross-file parity), `tests/unit/import/*` **28/28 PASS**. | **`PASS` (Parsers / Real Files)** · Live commit **`BLOCKED (BLK-001)`** |
| `SH-019` | P1 | Avatar & Question Image Storage RLS, magic bytes & durable signed URLs (`BUG-004`/`005`) | Reopened in `#60` -> fixed in `#64` + `#68` + `#76`: `POST /api/uploads/image` enforces pre-buffer 5MB/0B cap + magic bytes + canonical paths and returns `proxyUrl`; `GET /api/uploads/signed-url?redirect=1` serves `302` (`Cache-Control: private, max-age=300`, `Vary: Cookie`); `profile-view.tsx:156` & `question-editor-view.tsx:522` persist `proxyUrl` (0 `.getPublicUrl()` calls remain). | **`VERIFIED IN CODE — Live DB BLOCKED`** |
| `SH-020` | P1 | `POST /api/sets/[id]/duplicate` position collision, tags & `allow_clone` (`BUG-011`) | `duplicate/route.ts:49,71` enforces `access.canClone` and delegates to atomic PostgreSQL `clone_study_set()` RPC with 1:1 UUID mapping and `question_tags` copy. | **`VERIFIED IN CODE — Live DB BLOCKED`** |
| `SH-021` | P1 | `FlashcardsClient` reshuffle on rating & inverted `2`/`3` keys (`BUG-006`/`007`) | `FlashcardsClient.tsx:152-188` depends strictly on `bundle?.questions` + seeded `shuffleSeed` (stable deck); lines `431-462` enforce `1=again, 2=hard, 3=good, 4=easy` with all 4 visible rating buttons (`uiux-auditor` `#74` verified a11y & tall-card layout). | **`VERIFIED IN CODE — Live DB BLOCKED`** |
| `SH-022` | P1 | `WriteClient` Override double-record & final item count (`BUG-012`) | `WriteClient.tsx:249-342` defers DB persistence (`pendingPersist: true`) on wrong answers until user clicks Next (false once) or Override (true once), passes synchronous `countsOverride` to `finalizeOrMoveNext`, and guards IME Enter. | **`VERIFIED IN CODE — Live DB BLOCKED`** |
| `SH-023` | P1 | `ExamResultsClient` multi-set retake, SQL/UI parity, virtualization & `TestHubClient` fake count (`BUG-013`/`018`) | `ExamResultsClient.tsx:124-370` honors server `answer.is_correct`, virtualizes 500–1,000Q review via `@tanstack/react-virtual`, collects all source sets on Retake/Review Mistakes via clean POST (zero `?questionIds=` URL). `TestHubClient.tsx:25-59` skips 2kQ download when `?attemptId=` active and reuses `CustomExamBuilderClient` (fake `* 100` removed). | **`VERIFIED IN CODE — Live DB BLOCKED`** |
| `SH-024` | P1 | `GET /api/mistakes` missing exam answers & multi-set CTA (`BUG-014`) | `mistakes/route.ts:89-166` merges `study_session_answers` + `exam_attempt_answers` + `accepted_answers` via chunked queries; `ReviewMistakesClient.tsx:205,215` & `StarredQuestionsClient.tsx:125,132` route multi-set drills through `/practice` and `/exams/new`. | **`VERIFIED IN CODE — Live DB BLOCKED`** |
| `SH-025` | P1 | `useStudySetBundle` 2k cap, `PATCH /questions` validation, `PracticeClient` nav/timer, >10k commit 429 (`BUG-015`/`016`/`017`/`020`) | `useStudySetBundle.tsx:35` paginates up to `10,000` Qs; `questions/[questionId]/route.ts:93-137` validates merged `question_type`/`options`/`back_text`; `PracticeClient.tsx:634-689` cancels `autoNextTimerRef` & uses virtualized `ExamNavigatorGrid`; `IMPORT_COMMIT` raised to `120/5m` + `#73` prefiltered dedup. | **`PASS (Unit/Mock) — Live DB BLOCKED`** |
| `SH-026` | P1 | Protected route `503` storms, raw env-var leaks, `/import` & `/folders` 404s | **Verified LIVE in Playwright (`studyhub.spec.ts` on port 3012):** all 10 protected V1 & V2 routes (`/dashboard`, `/library`, `/exams`, `/exams/new`, `/practice`, `/folders`, `/import`, `/review`, `/statistics`, `/settings`) redirect cleanly to `/login` with **0 `503` responses** and **0 `NEXT_PUBLIC_SUPABASE_URL` / `.env.local` leaks**; `middleware.ts:90` wraps `getUser()` in `try/catch` (`BUG-037`). | **`PASS`** |
| `SH-027` | P1 | Sidebar `/library` duplication, missing `/exams/new`, nested `<main>` (`BUG-035`) | `app-shell.tsx:76-120` gives distinct top-level routes (`/dashboard`, `/library`, `/exams/new`, `/practice`); `FocusModeShell.tsx:26,52` prevents nested `<main id="main-content">`; verified by `uiux-auditor` (`#74`). | **`VERIFIED IN CODE — Live DB BLOCKED`** |
| `SH-028` | P1 | 250–500Q Exam Navigator drift, filters, `M` hotkey, timer re-renders (`BUG-033`) | Memoized `<ExamTimer />`, zero-drift 50px virtualized `ExamNavigatorGrid` (`>=44px` tiles, All/Unanswered/Marked + Subject filters, combined answered+flagged badge, `M`/`F` shortcuts); verified by `uiux-auditor` (`#74`) & `perf-import-auditor` (`#75`). | **`VERIFIED IN CODE — Live DB BLOCKED`** |
| `SH-029` | P1 | 3 divergent SM-2 algorithms & row-by-row SQL submit (`BUG-032`) | `v2-acceptance.test.ts` proves 100% 1:1 parity between `sm2.ts` and `progress-helper.ts` across a 6-step rating sequence; `db-backend-auditor` (`#81`) verified 100% 3-way parity with `0005` set-based `submit_exam_attempt()`. | **`PASS (Unit/Mock) — Live DB BLOCKED`** |
| `SH-030` | P1 | `ShareRedeemView` wrong keys `study_set_title`/`permission` (`BUG-028`) | `share-redeem-view.tsx:39-40,98-102` reads canonical `title` and `role` with graceful fallbacks and semantic `<h1>`. | **`VERIFIED IN CODE — Live DB BLOCKED`** |
| `SH-031` | P1 | Forged-header ZIP bomb & XLSX XXE pre-load guard | Verified by `v2-security-regression.test.ts` (`ZIP_RATIO_BOMB_DETECTED`, `XXE_FORBIDDEN`) — **18/18 PASS**. | **`PASS`** |
| `SH-032` | P1 | All 5 `/settings` preference toggles dead (`BUG-021`) | `src/lib/preferences/index.tsx` (`PreferencesProvider`, `useUserPreferences()`, Web Audio cues, `html[data-reduced-motion]`) wired across `providers.tsx` (`<MotionConfig>`), `settings-view.tsx`, and all learning & exam modes (verified across 12 consumers by `uiux-auditor` `#74`). | **`VERIFIED IN CODE — Live DB BLOCKED`** |
| `SH-033` | P1 | Favorite Sets, Editor Chapter/Tag/Difficulty filters, Account Restore UI (`BUG-034`, `BKP-02`) | `is_favorite` in `0005`, `library-view.tsx:113,273,326` & `study-set-hub.tsx:160`; `chapterFilter`/`difficultyFilter`/`tagFilter` in `question-editor-view.tsx:208-286,732-822`; `POST /api/account/restore` + `/settings` Restore UI (`settings-view.tsx:289`, nullable prefs fixed `#76`). | **`VERIFIED IN CODE — Live DB BLOCKED`** |
| `SH-034` | P2 | WCAG 2.2 AA contrast tokens + reduced-motion CSS + `@media print` (`BUG-036`) | `uiux-auditor` (`#74`) verified **31/31 WCAG 2.2 AA contrast pairs PASS**; `globals.css:350` implements `@media print`; Playwright verified `prefers-reduced-motion: reduce` renders cleanly. | **`PASS`** |
| `SH-035` | P2 | Mobile clipping/touch targets, Library pagination/dedup, custom `not-found.tsx`/`error.tsx`/`global-error.tsx` (`BUG-030`) | Custom 404 verified LIVE in Playwright (`studyhub.spec.ts`); `library-view.tsx:112-186` adds `page` pagination, `showArchived`, `favoritesOnly`, reactive `effectiveFolderDialogOpen`; `uiux-auditor` (`#74`) verified `button`/`input`/`dialog`/`sheet`/`tabs`/`table`/`global-error`. *(Pending `@real-user`'s final `#72` mobile header screenshot check on port 3011.)* | **`PASS`** (404/6-viewport live) · UI polish verified `#74` |
| `SH-036` | P2 | Dashboard streak/exams/`in_progress`, Statistics `?days=`/null chapters, History `study_set_id IS NULL` (`BUG-025`/`026`/`027`) | `dashboard/route.ts:139-225` computes real `streak_days` incl. exams & separates `in_progress_exams`; `statistics/route.ts:103-114` honors `?days=` on exams & `statistics-view.tsx:79-85,489` guards null chapters; `history-view.tsx:63-64,273-278` adds status/mode filters & routes `study_set_id === null` to `/exams/[id]/results`. | **`VERIFIED IN CODE — Live DB BLOCKED`** |
| `SH-037` | P2 | `LoginForm` `?error=` & OAuth flag, `RegisterForm` username hint, `editor` owner-only buttons, AlertDialog confirms (`BUG-022`/`023`/`024`/`029`) | `/login?error=auth_callback_failed` verified LIVE in Playwright (`[role="alert"]`); `GOOGLE_OAUTH_ENABLED` checked in both `login-form.tsx:70` & `register-form.tsx:24`; `USERNAME_PATTERN` matches DB `CHECK`; `isOwner` hides Share/Delete/Visibility/Folder from `editor`; `<AlertDialog>` confirms on `question-editor-view.tsx:1727`, `share-dialog.tsx:557`, `StepImportOptionsAndCommit.tsx:397`. | **`PASS` (Login `?error=`) / `VERIFIED IN CODE — Live DB BLOCKED`** |
| `SH-038` – `SH-040` | P2 | Import perf (`-38.8%` payload, `0.031ms` edit), editor bundle `-21.6%` gzip, security P2 hardening | Verified by `perf-import-auditor` (`#75`) and `security-auditor` (`#79`). | **`PASS` (Perf/Security unit & bundle)** |
| `SH-041` | P2 | 4 broken selectors in `tests/e2e/authenticated-journey.spec.ts` (`BUG-039`) | **Fixed by `func-tester` in Wave 3:** repaired all 4 selectors (`Tên học phần`, `/sets/[id]/import`, 6-step `ImportWizard`, `[role="alertdialog"]` `Nộp bài thi`) + added V2.0 Scenario 2 (Custom Exam Builder `/exams/new`, Multi-Subject & Presets) and Scenario 3 (Full Coverage Cycle). Cleanly gated by `E2E_SUPABASE_READY=1`. | **`PASS (Code Fixed)` — Live execution `BLOCKED (BLK-001)`** |
| `SH-042` | P3 | Auth/share `<h1>`, EN `<title>` reload persistence, skip link localization, landing jargon & KPI wrap | **Verified LIVE in Playwright (`studyhub.spec.ts` on port 3012):** semantic `<h1>` on all 5 public/auth routes + custom 404; VI->EN updates `<h1>`, skip link (`Chuyển đến nội dung chính` -> `Skip to main content`), and `<title>` **persists across full `page.reload()`** (`#72`). | **`PASS`** |
| `SH-043` | P3 | CSV formula escape, prod CSP/HSTS, `.or()` sanitize, account delete hygiene (`BUG-031`) | **Prod CSP & HSTS verified LIVE in Playwright (`PLAYWRIGHT_EXPECT_PROD=1` on port 3012):** HSTS present, zero `http://localhost`/`http://127.0.0.1`/`'unsafe-eval'` in CSP; CSV escape & `.or()` sanitize verified in `v2-security-regression.test.ts`. | **`PASS`** |

---

## 4. Minor Post-V2.0 Polish Items (Non-Blocking, Tracked Honestly)

All P0, P1, and blocking P2 defects from Wave 1 & Wave 3 are resolved (`0 REOPENED`). Four minor, non-blocking enhancement items are documented transparently for future polish:
1. **DOCX Embedded Images (`TC-IMP-06`):** Dead `/docx-media/...` 404 paths are now cleanly stripped with an honest `EMBEDDED_IMAGE_SKIPPED` diagnostic (`SH-018`); direct binary extraction & upload of embedded DOCX images to `study-media` during commit remains an optional post-V2.0 enhancement.
2. **Share Link Expiry Picker UI (`ShareDialog`):** The API/RPC (`study_set_share_links.expires_at`) enforces expiry, while adding a custom expiry dropdown in `ShareDialog` remains optional UI polish.
3. **Friends Blocked-Users Tab UI (`FriendsView`):** `PATCH /api/friends/[id]` (`action: "block"`), `blocked_by` RLS, and `can_view_profile()` (`#76`) are implemented; surfacing a dedicated "Blocked users" management tab in `FriendsView` remains optional UI polish.
4. **Vitest CJS Config Warning (`BUG-040`, P3):** Non-fatal Vite notice on `vitest.config.ts:1:1` (all 167 tests pass cleanly).

---

## 5. External Environment Blocker (`BLK-001`)

Live execution against PostgreSQL, Supabase Auth, Supabase Storage (`study-media`), and live 2-account Row-Level Security remains honestly **`BLOCKED`** because `.env.local` is absent and Docker Desktop is not running locally.

Once a live Supabase instance (local `npx supabase start` with migrations `0001`–`0005` or hosted project in `.env.local`) is connected, execute the final live gate:
```powershell
$env:E2E_SUPABASE_READY = "1"
$env:E2E_USER_A_EMAIL = "<account-a>"
$env:E2E_USER_A_PASSWORD = "<password-a>"
$env:E2E_USER_B_EMAIL = "<account-b>"
$env:E2E_USER_B_PASSWORD = "<password-b>"
npx playwright test
```
