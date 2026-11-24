# StudyHub V2.0 — Independent Functional Audit Report

> **Auditor:** `func-tester` (Agent 2 — Independent Functional Tester)  
> **Workspace:** `d:\Code Web\StudyHub`  
> **Audit Date:** 2026-11-24  
> **Audit Methodology:** Zero-trust static code inspection of every route, UI component, API handler, Zod validator, pure engine module, SQL migration/RPC, and test file, paired with fresh local verification runs (`typecheck`, `lint`, `vitest`). All V1.0 claims in `docs/PROGRESS.md` and `docs/VERIFICATION_REPORT.md` were treated as **unverified** until independently checked.

---

## 1. Executive Summary & Fresh Baseline Execution

### 1.1 Fresh Local Command Outputs (Wave 1)

| Check | Command | Exit Code | Fresh Result & Notes |
| --- | --- | --- | --- |
| TypeScript | `npm run typecheck` (`tsc --noEmit`) | `0` | **PASS** — 0 TypeScript errors |
| ESLint | `npm run lint` (`eslint .`) | `0` | **PASS** — 0 errors, 0 warnings |
| Unit & Mock Integration Tests | `npm run test` (`vitest run`, v5.1.1) | `0` | **PASS** — **16/16 test files, 82/82 tests passed** (`9.10s`). Non-fatal Vite CJS deprecation notice at `vitest.config.ts:1:1` (`BUG-040`). |
| Production Build | `npm run build` | *Skipped* | **INTENTIONALLY SKIPPED IN WAVE 1** per coordinator brief `#30` (`real-user` running `next start` against `.next`). |
| Live Supabase / Playwright Auth E2E | `npx playwright test` | *Blocked* | **BLOCKED** — `.env.local` does not exist and Docker Desktop daemon is stopped. Zero live PostgreSQL, Auth, Storage, or RLS runtime tests could execute. |

#### Exact Vitest File Breakdown (16 Files / 82 Tests)
- `tests/integration/api-and-roundtrip.test.ts` — 6 tests passed (`177ms`) *(mocked `requireAuth`/`rpcGetExamAttemptDetail` + 503 fail-closed + 2-question in-memory round-trip only)*
- `tests/unit/security/security-modules.test.ts` — 12 tests passed (`143ms`)
- `tests/unit/security/supabase-migrations-audit.test.ts` — 7 tests passed (`16ms`) *(static SQL regex audit, not live Postgres execution)*
- `tests/unit/learning/write-grader.test.ts` — 7 tests passed (`12ms`)
- `tests/unit/learning/sm2.test.ts` — 7 tests passed (`10ms`)
- `tests/unit/learning/learn-queue.test.ts` — 5 tests passed (`10ms`)
- `tests/unit/learning/shuffle.test.ts` — 5 tests passed (`9ms`)
- `tests/unit/learning/exam-scoring.test.ts` — 5 tests passed (`11ms`)
- `tests/unit/learning/match-engine.test.ts` — 2 tests passed (`8ms`)
- `tests/unit/utils.test.ts` — 5 tests passed (`17ms`)
- `tests/unit/import/security-and-stress.test.ts` — 5 tests passed (`381ms`)
- `tests/unit/import/docx-ooxml.test.ts` — 4 tests passed (`56ms`)
- `tests/unit/import/quizlet-csv-json.test.ts` — 4 tests passed (`107ms`)
- `tests/unit/import/word-answer-key.test.ts` — 4 tests passed (`18ms`)
- `tests/unit/import/eduquiz-txt.test.ts` — 2 tests passed (`15ms`)
- `tests/unit/import/xlsx-wayground.test.ts` — 2 tests passed (`80ms`)

### 1.2 High-Level Verdict

While V1.0 built a clean TypeScript codebase with strong pure-logic foundations (`src/lib/import/*`, `src/lib/learning/*`, `src/lib/security/*`), **the application is NOT production-ready and has major regressions, silent data truncation at >250 questions, dead settings controls, broken storage URLs, and 0% of the V2.0 Universal Exam Engine implemented**:

1. **Systemic PostgREST 1,000-Row Option Truncation (`BUG-001`, P0):** Because `question_options` queries fetch options for 500–1,000 questions in a single unpaginated `.in("question_id", ...)` ordered by `position ASC`, PostgREST's default 1,000-row cap **silently drops Options C & D (or B/C/D on export) from EVERY question** once a study set or exam exceeds **250 questions** — corrupting Question Bank, all 5 Learning Modes, Exam Generation (creating exams with empty `correct_option_ids`), Duplicate Set, and Export.
2. **Broken Multi-Set Exam Progress & Learn Mode Session Loop (`BUG-002`, `BUG-003`, P0):** `submit_exam_attempt()` stamps the primary `study_set_id` onto `user_question_progress` for questions belonging to other sets (and skips progress entirely if `study_set_id IS NULL`), while `LearnClient.tsx` creates a new orphaned `study_sessions` DB row and mutates/jumps the active queue on every single answered question.
3. **Broken Media Storage & Dead Settings (`BUG-004`, `BUG-005`, `BUG-015`, `BUG-021`):** Avatar uploads violate Storage RLS (`avatars/{uid}/...`) and both avatars and question images call `.getPublicUrl()` on the private `study-media` bucket; DOCX embedded images persist broken `/docx-media/...` paths without uploading; **all 5 study/accessibility toggles in `/settings` are completely unwired dead controls**.
4. **External Runtime Verification Blocker:** Because neither `.env.local` nor a running local Supabase/Docker stack exists, **every DB-backed feature lacks live runtime verification** and `tests/e2e/authenticated-journey.spec.ts` (which also contains 4 broken UI selectors — `BUG-039`) has never executed against a real database.
5. **V2.0 Universal Exam Engine Gaps:** `/exams/new`, Quick Test, multi-subject + folder deduplication, 5 allocation strategies (A–E), 8 selection policies, Full Coverage cycles, Exam Presets, mixed-subject/tag breakdowns, and multi-subject practice are **100% `NOT IMPLEMENTED`**.

### 1.3 Feature Classification Summary Counts (79 Audited Capabilities)

| Official Classification | Count | Share | Meaning in This Audit |
| --- | ---: | ---: | --- |
| `VERIFIED WORKING` | **4** | 5.1% | Pure deterministic logic verified directly against code + passing Vitest suites (zero live DB dependency). |
| `PARTIALLY WORKING` | **24** | 30.4% | Core path implemented, but has confirmed functional defects, missing sub-features, or scale caps. |
| `IMPLEMENTED BUT UNVERIFIED` | **9** | 11.4% | Implementation appears structurally sound in code, but cannot be marked verified because live Supabase/Auth/UI runtime is `BLOCKED`. |
| `IMPLEMENTED BUT BROKEN` | **28** | 35.4% | Confirmed P0/P1/P2 defects in actual source code cause data loss, corruption, 4xx/5xx failures, or dead controls. |
| `NOT IMPLEMENTED` | **13** | 16.5% | Required V2.0 or V1.0-documented capability does not exist in the codebase. |
| `BLOCKED` | **1** | 1.3% | Live Supabase DB, Auth, Storage, and RLS runtime verification (also blocks live E2E sign-off across all DB-backed features). |
| **Total Audited Features** | **79** | **100%** | Covers every domain in V2.0 Section 7 + V2.0 Exam Engine gaps. |

### 1.4 Discovered Bug Counts by Severity

| Severity | Count | Bug IDs |
| --- | ---: | --- |
| **P0 (Critical — Data Loss / Core Corruption)** | **3** | `BUG-001`, `BUG-002`, `BUG-003` |
| **P1 (Major — Broken Core Flows / High Impact)** | **17** | `BUG-004` – `BUG-020` |
| **P2 (Moderate — Dead Controls / Broken Wiring / UX Gaps)** | **19** | `BUG-021` – `BUG-039` |
| **P3 (Minor — Tooling / Warning)** | **1** | `BUG-040` |
| **P4 (Cosmetic)** | **0** | *(UI/aesthetic polish audited separately by `uiux-auditor`)* |
| **Total Confirmed Bugs** | **40** | Ready for entry into `docs/audit/ISSUE_TRACKER.md` |

---

## 2. Complete Feature Audit Matrix (V2.0 Section 7)

> **Strict Classification Rule:** No DB-backed feature is marked `VERIFIED WORKING` because live Supabase execution is `BLOCKED`. Features with confirmed code defects are marked `IMPLEMENTED BUT BROKEN` or `PARTIALLY WORKING` even when live runtime is also blocked.

### 2.1 Authentication & Account Security (9 Features)

| ID | Feature | Classification | Evidence & Linked Bugs |
| --- | --- | --- | --- |
| `AUTH-01` | User Registration (email, password, display name, username) | `IMPLEMENTED BUT BROKEN` | `src/components/auth/register-form.tsx:58,73,248-282` tells users `.` and `-` are valid in usernames, contradicting both its own regex and `profiles` DB `CHECK` constraint (`0001_initial_schema.sql:15`) (`BUG-024`). Live signup `BLOCKED`. |
| `AUTH-02` | Email / Password Login | `IMPLEMENTED BUT BROKEN` | `src/components/auth/login-form.tsx:53` ignores `?error=` redirected by `/auth/callback` and `/auth/confirm`, leaving failed OAuth/confirmation redirects with zero feedback (`BUG-022`). Live sign-in `BLOCKED`. |
| `AUTH-03` | Logout (`POST /auth/signout` + UI actions) | `IMPLEMENTED BUT UNVERIFIED` | `src/app/auth/signout/route.ts` and `AppShell`/`SettingsView` sign-out flows look structurally valid; live session revocation `BLOCKED`. |
| `AUTH-04` | Session Refresh & Cookie Middleware (`src/proxy.ts`) | `PARTIALLY WORKING` | `src/lib/supabase/middleware.ts:64-66` calls `supabase.auth.getUser()` without `try/catch` (`BUG-037`). Live cookie refresh `BLOCKED`. |
| `AUTH-05` | Password Reset (`/forgot-password`, `/auth/confirm`, `/reset-password`) | `IMPLEMENTED BUT UNVERIFIED` | Routes & forms exist; expired link error redirect into `/login?error=` is swallowed (`BUG-022`). Live recovery email `BLOCKED`. |
| `AUTH-06` | Google OAuth & Feature Flag Gating | `IMPLEMENTED BUT BROKEN` | `login-form.tsx:279-297` & `register-form.tsx:406-424` ignore `NEXT_PUBLIC_ENABLE_GOOGLE_OAUTH` documented in `README.md:79` & `.env.example:31` (`BUG-023`). Callback errors dropped (`BUG-022`). Live OAuth `BLOCKED`. |
| `AUTH-07` | Protected Routes & Safe Redirect (`next` param) | `PARTIALLY WORKING` | `sanitizeRedirectPath` unit-tested (passes in `security-modules.test.ts`); `src/proxy.ts` enforces auth redirect when Supabase env is configured. Live redirect loop `BLOCKED`. |
| `AUTH-08` | Auth Error Handling & Fail-Closed 503 | `PARTIALLY WORKING` | Fail-closed `503` verified across 6 API handlers in `api-and-roundtrip.test.ts`. Auth callback error query params dropped (`BUG-022`). |
| `AUTH-09` | Account Settings & Delete Account / Wipe Data | `IMPLEMENTED BUT BROKEN` | `src/app/api/account/data/route.ts:93-120` ignores DB errors on all 8 `.delete()` calls, leaves `friendships` & `study_set_members` intact, and misleads user when `SUPABASE_SERVICE_ROLE_KEY` is unset (`BUG-031`). |

### 2.2 Library & Folders (10 Features)

| ID | Feature | Classification | Evidence & Linked Bugs |
| --- | --- | --- | --- |
| `LIB-01` | Folders CRUD & Nested Hierarchy | `PARTIALLY WORKING` | `library-view.tsx:115` has stale `folderDialogOpen` state on `?create=folder`; `library-view.tsx:396-400` prints total folder count while rendering root-only folders (`BUG-030`). Live CRUD `BLOCKED`. |
| `LIB-02` | Study Sets CRUD (`/sets/new`, `/sets/[id]`, `/api/sets`) | `PARTIALLY WORKING` | `src/app/api/sets/[id]/route.ts:33-41` fetches unpaginated `questions` & `user_question_progress`, truncating chapter list and mastery counters at 1,000 rows (`BUG-016`). Live CRUD `BLOCKED`. |
| `LIB-03` | Move Study Set Between Folders | `IMPLEMENTED BUT UNVERIFIED` | `PATCH /api/sets/[id]` accepts `folder_id` and `QuestionEditorView` / `LibraryView` expose folder selection; live move `BLOCKED`. |
| `LIB-04` | Library Search (title / description / subject) | `IMPLEMENTED BUT UNVERIFIED` | `GET /api/sets?q=...` applies sanitized `ilike` filter (`escapeLikePattern` unit-tested); live DB query `BLOCKED`. |
| `LIB-05` | Library Sort | `PARTIALLY WORKING` | Missing sort by `question_count` in `LibraryView` and `GET /api/sets` (`BUG-030`). |
| `LIB-06` | Library Filters (type, folder, visibility, archive) | `PARTIALLY WORKING` | `LibraryView` lacks visibility filter (`private`/`shared`/`public`) and archive filter (`BUG-030`). |
| `LIB-07` | Duplicate / Clone Study Set (`POST /api/sets/[id]/duplicate`) | `IMPLEMENTED BUT BROKEN` | Unpaginated queries truncate >250Q options & >1,000Q questions (`BUG-001`); `newIdByPos` collides on duplicate `position` orphaning options, drops all `question_tags`, and ignores `allow_clone` (`BUG-011`). |
| `LIB-08` | Favorite / Pin Study Sets | `NOT IMPLEMENTED` | No `is_favorite` column in `study_sets`, no toggle API, no UI control. |
| `LIB-09` | Library & Folder Empty States | `IMPLEMENTED BUT UNVERIFIED` | Genuine contextual empty states implemented in `library-view.tsx` and `folder-detail-view.tsx`; live visual check pending. |
| `LIB-10` | Library Pagination & Large Libraries (>100 sets) | `IMPLEMENTED BUT BROKEN` | `library-view.tsx` hardcodes `pageSize=100` with no pagination or "Load more" controls; sets beyond #100 are inaccessible (`BUG-030`). |

### 2.3 Question Bank & Editor (10 Features)

| ID | Feature | Classification | Evidence & Linked Bugs |
| --- | --- | --- | --- |
| `QB-01` | Question CRUD (`/api/sets/[id]/questions`, `[questionId]`) | `IMPLEMENTED BUT BROKEN` | `GET /questions?pageSize=500` hits PostgREST 1,000-row cap on `question_options` and drops Options C & D (`BUG-001`); `PATCH` skips `createQuestionSchema.superRefine` allowing 0 correct options and omits `tags` (`BUG-017`); single UI delete lacks confirmation dialog (`BUG-017`). |
| `QB-02` | Bulk Edit & Bulk Delete (`/questions/bulk`) | `PARTIALLY WORKING` | `POST /bulk` silently ignores `tags` (`BUG-017`); `QuestionEditorView` lacks bulk tag/difficulty controls even though `PATCH /bulk` supports them (`BUG-034`). |
| `QB-03` | Single-Choice & True/False Answer Editing | `PARTIALLY WORKING` | Switching `multiple_choice` -> `single_choice` in `QuestionEditorView` leaves multiple options marked `is_correct=true` (`BUG-034`); `PATCH` fails to reject invalid state (`BUG-017`). |
| `QB-04` | Multi-Answer & Short-Answer Editing | `PARTIALLY WORKING` | No remove button for added `accepted_answers` rows and no validation ensuring at least one non-empty accepted answer for `short_answer` in UI (`BUG-034`). |
| `QB-05` | Flashcard Front/Back Editing | `IMPLEMENTED BUT UNVERIFIED` | `back_text` editor wired; `back_image_url` has no upload UI (`BUG-034`). Live save `BLOCKED`. |
| `QB-06` | Chapter, Tag & Difficulty Filtering in Editor | `NOT IMPLEMENTED` | `QuestionEditorView` provides only text search + `question_type` dropdown; zero chapter, tag, or difficulty filters (`BUG-034`). |
| `QB-07` | Question Numbering & Reordering | `PARTIALLY WORKING` | Position badge rendered, but zero reorder controls (drag/move up/down) in `QuestionEditorView` (`BUG-034`) and no DB uniqueness on `(study_set_id, position)`. |
| `QB-08` | Stable Option UUIDs (Shuffle-Safe Grading) | `VERIFIED WORKING` | Schema uses UUID PKs (`question_options.id`); `exam-scoring.test.ts` (5 tests) & `shuffle.test.ts` (5 tests) pass. *(Upstream >250Q option truncation tracked in `BUG-001`.)* |
| `QB-09` | Question / Option / Flashcard Images (`study-media`) | `IMPLEMENTED BUT BROKEN` | `question-editor-view.tsx:468-474` uses `.getPublicUrl()` on private bucket `study-media` -> 400/404 broken images (`BUG-005`); DOCX import stores dead `/docx-media/...` paths (`BUG-015`); no option/back image upload (`BUG-034`). |
| `QB-10` | Source Metadata (`source_metadata`) | `PARTIALLY WORKING` | Saved during `/api/import/commit`, never surfaced in `QuestionEditorView` or `StudySetHub` (`BUG-034`). |

### 2.4 Learning Modes & Spaced Repetition (8 Features)

| ID | Feature | Classification | Evidence & Linked Bugs |
| --- | --- | --- | --- |
| `LRN-01` | Flashcards Mode (`/sets/[id]/flashcards`) | `IMPLEMENTED BUT BROKEN` | `FlashcardsClient.tsx:136-160` reshuffles the entire deck on EVERY card rating when Shuffle is ON (`BUG-006`); keyboard shortcuts `2`/`3` are inverted (`2=good`, `3=hard`) and `Hard`/`Easy` buttons are missing (`BUG-007`); inherits >250Q option drop & 2,000Q bundle cap (`BUG-001`, `BUG-016`). |
| `LRN-02` | Multiple Choice Practice Mode (`/sets/[id]/practice`) | `PARTIALLY WORKING` | Navigator grid unvirtualized (`PracticeClient.tsx:629-668`) and clicking a tile during `autoNext` fails to cancel `autoNextTimerRef` (`BUG-020`); inherits >250Q option drop (`BUG-001`) and session answer integrity bug (`BUG-019`). |
| `LRN-03` | Adaptive Learn Mode (`/sets/[id]/learn`) | `IMPLEMENTED BUT BROKEN` | `LearnClient.tsx:144-160, 215-234` spawns a brand-new orphaned `study_sessions` DB row AND mutates/jumps the active queue on every single answer because `useEffect` & `defaultQueueState` depend on `bundle` (`BUG-003`). *(Pure `learn-queue.ts` passes 5 unit tests.)* |
| `LRN-04` | Write / Typed Recall Mode (`/sets/[id]/write`) | `IMPLEMENTED BUT BROKEN` | "Override: I was right" double-records wrong+right answers (permanently corrupting `wrong_count` & SM-2 streak), and `handleSelfAssess` sends stale `correctItems` on the last question (`BUG-012`). *(Pure `write-grader.ts` passes 7 unit tests.)* |
| `LRN-05` | Timed Match Mode (`/sets/[id]/match`) | `PARTIALLY WORKING` | Pure pair-disambiguation engine passes 2 unit tests (`match-engine.test.ts`); inherits `useStudySetBundle` >250Q option drop & 2,000Q cap (`BUG-001`, `BUG-016`); live session save `BLOCKED`. |
| `LRN-06` | Review Mistakes (`/review`, `GET /api/mistakes`) | `IMPLEMENTED BUT BROKEN` | `GET /api/mistakes` never queries `exam_attempt_answers` (exam mistakes show "No recorded selection"), omits `accepted_answers`, truncates >250 mistakes' options, and "All sets" Practice/Test CTAs launch only `mistakes[0].study_set_id` (`BUG-014`). |
| `LRN-07` | Starred Questions (`/starred`, `GET /api/starred`) | `IMPLEMENTED BUT BROKEN` | `GET /api/starred` omits `question_accepted_answers` and `progress` expected by `StarredQuestionsClient.tsx:287,306` (`BUG-038`); "All sets" Practice/Test CTAs launch only the first set & options truncate >250 rows (`BUG-014`). |
| `LRN-08` | Spaced Repetition (SM-2) & Due Queue (`/api/progress`) | `IMPLEMENTED BUT BROKEN` | Three divergent SM-2 formulas across `sm2.ts`, `progress-helper.ts`, and SQL `submit_exam_attempt` (`BUG-032`); `POST /api/progress` does not verify `question_id` belongs to `study_set_id` (`BUG-019`); `submit_exam_attempt` writes wrong `study_set_id` for multi-set exams (`BUG-002`). |

### 2.5 Examination Engine — V1.0 Core Mechanics (13 Features)

| ID | Feature | Classification | Evidence & Linked Bugs |
| --- | --- | --- | --- |
| `EXM-01` | Exam Config Hub (`/sets/[id]/test`, `TestHubClient`) | `PARTIALLY WORKING` | "All" question count computes fake `bundle.questions.length + extraSetIds.length * 100` (`BUG-018`); hard max 500 questions. |
| `EXM-02` | Exam Generation & Snapshot (`POST /api/exams`) | `IMPLEMENTED BUT BROKEN` | Unpaginated `questions` query makes questions past row 1,000 unsamplable; `question_options` query for >250Q exams silently drops Options C & D and leaves `correct_option_ids = []` (`BUG-001`). |
| `EXM-03` | Deterministic Random Sampling & Option Shuffling | `VERIFIED WORKING` | Pure `fisherYatesShuffle`, `seededShuffle`, and `sampleWithoutReplacement` verified by 5/5 passing tests in `shuffle.test.ts`. |
| `EXM-04` | Countdown Timer & Server Wall-Clock `expires_at` | `IMPLEMENTED BUT UNVERIFIED` | Server computes `expires_at` and SQL `submit_exam_attempt()` enforces expiry; live timer/expiry verification `BLOCKED`. |
| `EXM-05` | Exam Navigator Grid & Flagging (`ExamNavigatorGrid`) | `PARTIALLY WORKING` | Flagged styling hides Answered state (`ExamNavigatorGrid.tsx:62-93`); lacks Unanswered/Flagged/Subject filters; keyboard shortcut binds `F` instead of `M` (`BUG-033`). *(Virtualized >100 items.)* |
| `EXM-06` | Exam Autosave & Offline Sync (`PUT /exams/[id]/answers`) | `IMPLEMENTED BUT BROKEN` | >200 unsynced offline answers fail Zod `.max(200)` and are silently swallowed by `.catch(() => {})` on submit (`BUG-008`); stale `localStorage` draft overwrites newer server state & `PUT` lacks monotonic concurrency guard (`BUG-009`). |
| `EXM-07` | Resume In-Progress Exam | `IMPLEMENTED BUT BROKEN` | `answered_count` is never incremented during `PUT /answers`, so resume banners always display `0 / N` (`BUG-010`); stale local draft overwrites newer server answers across devices (`BUG-009`). |
| `EXM-08` | Pre-Submit Anti-Leak Payload Stripping | `IMPLEMENTED BUT UNVERIFIED` | `POST /api/exams`, `GET /api/exams/[attemptId]`, and SQL `get_exam_attempt_detail()` strip `is_correct`/`correct_option_ids`/`accepted_answers`/`explanation` while `in_progress` (mocked test passes in `api-and-roundtrip.test.ts`); live PostgreSQL execution `BLOCKED`. |
| `EXM-09` | Server-Side Scoring & Idempotent Submit (`submit_exam_attempt`) | `IMPLEMENTED BUT BROKEN` | `submit_exam_attempt()` stamps primary `study_set_id` for multi-set questions and skips progress when `study_set_id IS NULL` (`BUG-002`); JS client re-grading diverges from SQL `normalize_short_answer()` (`BUG-013`). *(Pure `exam-scoring.ts` passes 5 unit tests.)* |
| `EXM-10` | Exam Results & Breakdown (`/sets/[id]/results/[attemptId]`) | `PARTIALLY WORKING` | Client-side re-grading can disagree with server score (`BUG-013`); unvirtualized 250–500 review cards (`BUG-013`); unreachable if `study_set_id IS NULL` (`BUG-027`). |
| `EXM-11` | Post-Exam Review & Question Filtering | `PARTIALLY WORKING` | All/Wrong/Unanswered/Flagged filters exist, but unvirtualized list + JS re-grade discrepancy (`BUG-013`). |
| `EXM-12` | Exam History (`/history`, `HistoryView`) | `PARTIALLY WORKING` | Cannot open results when `study_set_id IS NULL`, capped at 100 attempts with no pagination, missing mode/status filters (`BUG-027`); in-progress attempts show `0/N` (`BUG-010`). |
| `EXM-13` | Exam Retake & Review Mistakes CTAs | `IMPLEMENTED BUT BROKEN` | `ExamResultsClient.tsx:153-162, 295-304` omits `additional_study_set_ids`, silently dropping all questions from combined sets (`BUG-013`). |

### 2.6 Examination Engine — V2.0 Required Capabilities (10 Features)

| ID | V2.0 Feature | Classification | Evidence & Gap Summary |
| --- | --- | --- | --- |
| `EXM-V2-01` | Universal Custom Exam Builder (`/exams/new`) + Sidebar/Mobile Link | `NOT IMPLEMENTED` | No `src/app/(app)/exams/new/page.tsx` route; sidebar lacks direct Exam Builder link (`BUG-035`). |
| `EXM-V2-02` | Quick Test Fast-Path Mode | `NOT IMPLEMENTED` | No Quick Test mode or instant 1-click launch. |
| `EXM-V2-03` | Multi-Subject & Folder Picker + Deduplication + `/api/exams/eligible` & `/preview` | `NOT IMPLEMENTED` | Neither endpoint nor folder-expansion deduplication exists. |
| `EXM-V2-04` | Arbitrary Question Count (1..1000+, no 500 cap or 250Q corruption) | `IMPLEMENTED BUT BROKEN` | `createExamSchema` caps `question_count` at `.max(500)` (`src/lib/validation/exams.ts:15`); >250Q silently truncates options (`BUG-001`). |
| `EXM-V2-05` | 5 Multi-Subject Allocation Strategies (A: Proportional, B: Equal, C: Manual, D: Percentage, E: Pure Random) | `NOT IMPLEMENTED` | `POST /api/exams` performs pure combined random sampling only; no allocation strategy engine or UI. |
| `EXM-V2-06` | 8 Selection Policies (Uniform, Unseen, Mistakes, Weakest, Due SM-2, Starred, Least Recent, Full Coverage) | `NOT IMPLEMENTED` | Only 3 boolean toggles (`prioritize_unseen`, `only_mistakes`, `only_starred`) exist in `createExamSchema`. |
| `EXM-V2-07` | Full Coverage / No-Repeat Cycles (`coverage_cycles`, `_questions`, `_attempts`) | `NOT IMPLEMENTED` | Zero database tables, APIs, logic, or UI for coverage cycles. |
| `EXM-V2-08` | Exam Presets (`exam_presets`, `_sources`, CRUD, Favorite, Duplicate, Relaunch) | `NOT IMPLEMENTED` | Zero database tables, APIs, or UI for exam presets. |
| `EXM-V2-09` | Mixed-Subject & Tag Result Breakdowns + Display Controls (`show_subject_names`, `show_chapter_names`, `allow_navigation`) | `NOT IMPLEMENTED` | `exam_attempt_questions` lacks `source_study_set_id`, `source_subject_title`, and `tags_snapshot`; UI has no per-subject/per-tag breakdowns or display controls. |
| `EXM-V2-10` | Multi-Subject / Custom-Subset Practice Mode (`/api/practice/questions`) | `NOT IMPLEMENTED` | Practice mode is strictly single-set via `useStudySetBundle`. |

### 2.7 Dashboard, Statistics, Social, Profile, Settings, UX, Import/Export & Infrastructure (19 Features)

| ID | Feature | Classification | Evidence & Linked Bugs |
| --- | --- | --- | --- |
| `DSH-01` | Dashboard (`/dashboard`, `GET /api/dashboard`) | `IMPLEMENTED BUT BROKEN` | Streak badge always `0`/hidden; daily goal & 14d chart ignore exam answers; `recent_exams` renders `in_progress` attempts as `0% FAILED` linking to `/results/`; 50-set cap & 1,000-row progress truncation (`BUG-025`). |
| `STA-01` | Statistics (`/statistics`, `GET /api/statistics`) | `IMPLEMENTED BUT BROKEN` | `exam_score_trend` & `total_exams` ignore `?days=`; streaks mix windowed/all-time; daily activity excludes exam answers; 1,000-row truncation; null-chapter `"General"` generates broken `/practice?chapter=General` link (`BUG-026`). |
| `SOC-01` | Friends (`/friends`, `/api/friends`, `/api/users/search`) | `PARTIALLY WORKING` | Missing Block/Unblock UI and missing avatars on pending requests (`BUG-030`). Live social flows `BLOCKED`. |
| `SOC-02` | Direct Member Sharing (`/api/sets/[id]/members`, `/shared`) | `PARTIALLY WORKING` | Collaborator `editor` sees owner-only controls (Share, Delete Set, Visibility, Folder) that fail with `403 FORBIDDEN` (`BUG-029`). Live RLS `BLOCKED`. |
| `SOC-03` | Share Links & Redemption (`/share/[token]`, `ShareDialog`) | `IMPLEMENTED BUT BROKEN` | `ShareRedeemView` reads wrong response keys (`study_set_title`/`permission` instead of `title`/`role`) and never previews link before redeeming (`BUG-028`); `ShareDialog` lacks link expiry UI (`BUG-030`); `allow_clone` ignored by duplicate API (`BUG-011`). |
| `PRF-01` | Profile & Avatar Upload (`/profile`, `/api/profile`) | `IMPLEMENTED BUT BROKEN` | `profile-view.tsx:150-163` uploads to `{uid}/avatar-...` violating Storage RLS `avatars/{uid}/...` AND calls `.getPublicUrl()` on private bucket `study-media` (`BUG-004`). |
| `SET-01` | Settings — Study & Accessibility Preferences (`/settings`) | `IMPLEMENTED BUT BROKEN` | **ALL 5 toggles** (`default_shuffle_questions`, `default_shuffle_options`, `show_instant_feedback`, `sound_effects`, `reduced_motion`) are dead controls with ZERO runtime effect (`BUG-021`). |
| `UX-01` | Language Switching (VI default + EN toggle) | `PARTIALLY WORKING` | `I18nProvider` & VI/EN dictionaries implemented and synced to `localStorage` + `/api/preferences`. Full runtime UI sweep & mixed-string audit pending live session / `uiux-auditor`. |
| `UX-02` | Theme Switching (Light / Dark / System) | `IMPLEMENTED BUT UNVERIFIED` | CSS tokens (`globals.css`), `next-themes`, and `ThemeToggle` implemented; live contrast/token sweep across all pages pending live visual run. |
| `UX-03` | Responsive Layout & Navigation (`AppShell`, `LandingPage`) | `PARTIALLY WORKING` | Sidebar duplicates `/library` across 4 of top 5 nav items and lacks `/exams/new` (`BUG-035`). Full 6-viewport live test pending. |
| `UX-04` | Printable Study Sheet (`@media print`) | `NOT IMPLEMENTED` | Claimed in `docs/PRD.md:98` & `docs/ARCHITECTURE.md:165`; zero `@media print` rules anywhere in `src/` (`BUG-036`). |
| `IMP-01` | Multi-Format Deterministic Import Parsers (9 Formats) | `VERIFIED WORKING` | Pure parsers for `docx_ooxml`, `xlsx_wayground`, `xlsx_generic`, `eduquiz_txt`, `word_answer_key`, `quizlet_tsv`, `csv`, `json`, `txt_generic` verified by 17 passing Vitest tests. *(Real `sample-data/` live E2E import tracked in `TEST_MATRIX.md`.)* |
| `IMP-02` | Import Wizard UI (`ImportWizard.tsx`) | `IMPLEMENTED BUT BROKEN` | Sheet switch preserves stale `columnMapping` from previous sheet (`ImportWizard.tsx:145-148, 495`, `BUG-015`). Documented Web Worker pre-parsing is `NOT IMPLEMENTED`. |
| `IMP-03` | Import Commit Pipeline (`/api/import/commit`) | `IMPLEMENTED BUT BROKEN` | Hits `429` rate limit at chunk #21 (>10,000 Qs), duplicate check truncates at 1,000 existing rows, and embedded DOCX images persist broken `/docx-media/...` paths without uploading to `study-media` (`BUG-015`). |
| `IMP-04` | Upload, ZIP Bomb, XXE, Macro & SVG Security Guards | `VERIFIED WORKING` | Verified by 17 passing unit tests (`security-modules.test.ts` 12/12 + `security-and-stress.test.ts` 5/5). |
| `EXP-01` | Study Set Export (JSON, CSV, TSV, TXT, XLSX) | `IMPLEMENTED BUT BROKEN` | `export/route.ts:64, 81-85` fetches `question_options` for 1,000 questions per batch -> PostgREST 1,000-row cap drops Options B, C, D on sets >250Q (`BUG-001`). *(2-question in-memory round-trip test passes.)* |
| `BKP-01` | Full Account JSON Export (`GET /api/account/data`) | `PARTIALLY WORKING` | Truncates tables at 1,000 rows and omits 7 tables (`folders`, `tags`, `question_options`, `question_accepted_answers`, `exam_attempt_questions`, `exam_attempt_answers`, `starred_questions`) (`BUG-031`). |
| `BKP-02` | Full Account Backup Restore UI | `NOT IMPLEMENTED` | Only single-set JSON import exists; no full-account restore API or UI. |
| `DB-01` | Live Supabase Database, Auth, Storage & RLS Verification | `BLOCKED` | `.env.local` absent; Docker Desktop stopped; 0 live Postgres/Auth/Storage executions possible in Wave 1. *(Static SQL audit passes 7/7 in `supabase-migrations-audit.test.ts`.)* |

---

## 3. V1.0 Documentation & Verification Report Discrepancies

Every discrepancy below was directly verified by comparing `README.md`, `docs/*.md`, and actual source code:

| # | Document & Claim | Actual Codebase Reality |
| --- | --- | --- |
| 1 | `docs/VERIFICATION_REPORT.md` & `docs/PROGRESS.md` imply all authenticated journeys, 6 study modes, exams, and RLS passed verification. | `tests/e2e/authenticated-journey.spec.ts` was **SKIPPED** (zero live DB executions) and contains **4 broken selectors** (`BUG-039`). `tests/integration/api-and-roundtrip.test.ts` only mocks 2 RPC paths, checks 503 fail-closed on 6 routes, and runs a 2-question in-memory export/import round-trip. |
| 2 | `docs/ARCHITECTURE.md` lists API routes `/api/sets/[id]/clone`, `/api/exams/[attemptId]/answer`, `/api/sessions/[id]/answer`, `/api/sessions/[id]/complete`, `/api/progress/star`, `/api/review/queue`. | Actual routes are `/api/sets/[id]/duplicate`, `/api/exams/[attemptId]/answers`, `/api/sessions/[sessionId]/answers`, `PATCH /api/sessions/[sessionId]`, `/api/starred`, `/api/starred/[questionId]`, `/api/progress/due`, `/api/mistakes`, `/api/mistakes/[questionId]/resolve`. Undocumented endpoints also exist: `/api/dashboard`, `/api/preferences`, `/api/users/search`, `/api/account/data`, `/api/import/templates/[format]`. |
| 3 | `docs/ARCHITECTURE.md` references `src/middleware.ts` and 5 migrations (`00001`–`00005`). | Actual codebase uses Next.js 16 `src/proxy.ts` and 4 migrations (`0001`–`0004`). |
| 4 | `docs/ARCHITECTURE.md:13, 285` claims client-side **Web Worker** pre-parsing for large imports. | Zero Web Workers exist anywhere in `src/`; all parsing runs via `POST /api/import/parse`. |
| 5 | `docs/IMPORT_FORMATS.md:86-87` claims embedded DOCX images (`word/media/*`) are uploaded to `study-media` and linked. | `docx-ooxml-parser.ts:1086` sets `/docx-media/<file>`, `src/lib/import/index.ts:123` strips binary `bytes`, and `commit/route.ts:385` writes the broken `/docx-media/...` path directly to PostgreSQL without uploading (`BUG-015`). |
| 6 | `docs/IMPORT_FORMATS.md` describes Step 4 = inline fix & Step 5 = options/commit. | Actual `ImportWizard.tsx` Step 4 is read-only preview and Step 5 combines inline fixes + import options/commit. |
| 7 | `docs/PRD.md:98` & `docs/ARCHITECTURE.md:165` claim Printable Study Sheet (`@media print`). | Zero `@media print` CSS rules exist in `src/` (`BUG-036`). |
| 8 | `README.md:79` & `.env.example:31` document `NEXT_PUBLIC_ENABLE_GOOGLE_OAUTH` to toggle Google Sign-In. | Zero references to `NEXT_PUBLIC_ENABLE_GOOGLE_OAUTH` exist in `src/`; button always renders when Supabase is configured (`BUG-023`). |
| 9 | `docs/PRD.md:55` specifies SM-2 flashcard shortcuts `1=Again, 2=Hard, 3=Good, 4=Easy`. | `FlashcardsClient.tsx:402-414` binds `2=Good` and `3=Hard` (inverted) and renders only `Again`/`Good` buttons (`BUG-007`). |
| 10 | `docs/PRD.md:64` promises exam history filtering by mode/status and `docs/TESTING.md` lists `api-sets-crud.test.ts`, `api-exam-lifecycle.test.ts`, `rls-isolation.test.ts`, `responsive-viewports.spec.ts`, `accessibility-smoke.spec.ts`. | None of those 5 test files exist; History has no mode/status filter (`BUG-027`). |
| 11 | `src/components/layout/settings-view.tsx` presents 5 study/accessibility preference toggles persisted to `user_preferences`. | None of the 5 columns are ever read outside `settings-view.tsx` (`BUG-021`). |
| 12 | `src/components/layout/landing-page.tsx:205` advertises `10,000+` question bank scale. | Current code silently drops Options C & D past **250 questions** (`BUG-001`), caps study bundles at **2,000 questions** (`BUG-016`), and rate-limits `/api/import/commit` at **10,000 questions** (`BUG-015`). |

---

## 4. Exhaustive Discovered Bug Register (`P0`–`P3`)

> Formatted for direct ingestion into `docs/audit/ISSUE_TRACKER.md`. Every bug cites exact verified file paths and line numbers.

### P0 — Critical (Data Loss, Silent Corruption, Core Engine Failure)

#### `BUG-001` [P0] PostgREST 1,000-row cap silently truncates Options C & D (or B/C/D) on any study set or exam > 250 questions
- **Files & Lines:**
  - `src/app/api/sets/[id]/questions/route.ts:133-137`
  - `src/app/api/exams/route.ts:137-156, 218-222`
  - `src/app/api/sets/[id]/export/route.ts:64, 81-85`
  - `src/app/api/sets/[id]/duplicate/route.ts:87-101`
  - Consumers: `src/lib/learning/api-client.ts:153`, `src/components/library/study-set-hub.tsx:96`, `src/components/editor/question-editor-view.tsx:224`
- **Steps to Reproduce:**
  1. Create or import a study set with 300–1,000 4-option multiple-choice questions (e.g., combining the 4 `sample-data/` sets = 281 questions).
  2. Open Question Bank (`pageSize=500`), start Practice/Learn/Flashcards, generate a 300-question exam, export the set, or duplicate the set.
- **Expected:** All 4 options (A, B, C, D) and all questions (>1,000) are loaded, snapshotted, exported, and duplicated losslessly.
- **Actual:** PostgREST caps unpaginated queries at 1,000 rows by default. Querying `question_options.in("question_id", 500_ids).order("position", { ascending: true })` (2,000 rows) returns only the first 1,000 rows (`position=0` and `position=1`), **silently dropping Options C & D from EVERY question**. In `export/route.ts` (`PAGE_SIZE = 1000`), 4,000 options truncate to 1,000, **dropping Options B, C, and D from every question**. In `exams/route.ts`, questions beyond row 1,000 can never be sampled, and >250Q exams snapshot missing C/D options with `correct_option_ids = []` whenever C or D was the right answer!
- **Root Cause:** Unchunked `.in("question_id", largeBatch)` option/accepted-answer queries ordered by `position ASC` and unpaginated `questions` fetches assuming PostgREST returns unbounded rows.

#### `BUG-002` [P0] `submit_exam_attempt()` stamps wrong `study_set_id` into `user_question_progress` for multi-set exams and skips progress when `study_set_id IS NULL`
- **Files & Lines:** `supabase/migrations/0003_functions_and_triggers.sql:405, 432`; `supabase/migrations/0001_initial_schema.sql:256`; `src/app/api/exams/route.ts:137-156`
- **Steps to Reproduce:**
  1. Start a multi-set exam combining Set A (primary `study_set_id`) and Set B (`additional_study_set_ids`), or a V2.0 multi-subject exam where `exam_attempts.study_set_id IS NULL`.
  2. Answer questions from Set B and submit the exam.
- **Expected:** Each question's `user_question_progress` row records that question's actual `questions.study_set_id` (Set B), even when `exam_attempts.study_set_id IS NULL`.
- **Actual:** Line 405 guards the entire progress upsert with `IF v_attempt.study_set_id IS NOT NULL`, silently skipping progress updates on standalone/multi-subject exams. When `v_attempt.study_set_id` is non-null, line 432 writes `v_attempt.study_set_id` (Set A) into `user_question_progress.study_set_id` for Set B's questions — corrupting per-set mastery percentages, mistakes filters, and analytics.
- **Root Cause:** `submit_exam_attempt` uses `v_attempt.study_set_id` instead of looking up `questions.study_set_id` (or storing `source_study_set_id` on `exam_attempt_questions`).

#### `BUG-003` [P0] `LearnClient` creates an orphaned `study_sessions` DB row and mutates/jumps the active queue on every single answered question
- **Files & Lines:** `src/components/learning/LearnClient.tsx:144-160, 215-234`; `src/components/learning/useStudySetBundle.tsx:101-109`
- **Steps to Reproduce:**
  1. Open `/sets/[id]/learn` and answer Question #1.
  2. Observe the current question card while feedback is still open, and inspect `study_sessions` in the DB after answering 10 questions.
- **Expected:** One `study_sessions` row per Learn session; Question #1 stays visible during feedback until the user clicks Continue.
- **Actual:** Answering calls `updateLocalProgress()` -> produces a new `bundle` object reference. `useEffect(..., [bundle, ...])` (`LearnClient.tsx:215-234`) re-runs on every answer -> resets `sessionIdRef.current = null`, resets `startedAtRef.current`, and fires `POST /api/sessions` on every single answer (10 answers = 10 orphaned `in_progress` sessions, broken duration). Worse, on Question #1 (before `overrideQueue` is initialized), `defaultQueueState` (`lines 144-159`) recomputes from the updated `bundle`, re-sorting the queue and jumping the UI to a different question mid-feedback.
- **Root Cause:** Session bootstrap effect and initial queue `useMemo` depend directly on mutable `bundle` instead of initializing once per `studySetId`/config signature.

---

### P1 — Major (Broken Core Workflows, Data Integrity & Scale Failures)

#### `BUG-004` [P1] Avatar upload always fails Storage RLS AND generates broken public URL on private `study-media` bucket
- **Files & Lines:** `src/components/layout/profile-view.tsx:150-163`; `supabase/migrations/0004_storage_and_buckets.sql:13, 56-57`
- **Steps to Reproduce:** Open `/profile` and upload a PNG/JPEG avatar image.
- **Expected:** Upload succeeds to `avatars/{user.id}/avatar-...` and renders via an authorized signed URL (or public avatar bucket).
- **Actual:** `profile-view.tsx:152` uploads to `${user.id}/avatar-${Date.now()}.${safeExt}` (missing leading `avatars/` folder), violating `study_media_insert` RLS (`folder[1]='avatars' AND folder[2]=auth.uid()`). Even if upload succeeded, line 160 calls `.getPublicUrl(path)` on `study-media`, which has `public = false` (`0004_storage_and_buckets.sql:13`), returning an inaccessible URL.
- **Root Cause:** Client upload path does not match Migration 0004 RLS prefix and assumes a public bucket.

#### `BUG-005` [P1] Question image upload uses `.getPublicUrl()` on private `study-media` bucket
- **Files & Lines:** `src/components/editor/question-editor-view.tsx:468-474`; `supabase/migrations/0004_storage_and_buckets.sql:13`
- **Steps to Reproduce:** Open `/sets/[id]/edit`, upload an image on a question, save, and view the question in Editor/Practice/Exam.
- **Expected:** Uploaded image loads reliably for authorized set viewers via signed URL or authenticated proxy route.
- **Actual:** Upload succeeds to `${user.id}/${setId}/${uuid}.${ext}`, then line 471 stores `.getPublicUrl(path).data.publicUrl` into `prompt_image_url`. Because `study-media` is private (`public = false`), `<img src={...}>` fails with 400/404.
- **Root Cause:** Missing signed-URL minting or authenticated media proxy for private bucket objects.

#### `BUG-006` [P1] `FlashcardsClient` reshuffles the entire deck on every card rating when Shuffle is ON
- **Files & Lines:** `src/components/learning/FlashcardsClient.tsx:136-160`; `src/components/learning/useStudySetBundle.tsx:101-109`
- **Steps to Reproduce:** Open `/sets/[id]/flashcards`, toggle Shuffle ON, flip Card 1, and rate "Good" or "Again".
- **Expected:** Deck order remains stable for the current pass; user advances smoothly to Card 2 without repeating/skipping cards.
- **Actual:** Rating calls `updateLocalProgress()` -> returns new `bundle` -> `cards` `useMemo` re-runs unseeded `fisherYatesShuffle(projected)` -> entire deck scrambles on every rating.
- **Root Cause:** `cards` memo depends on mutable `bundle` and invokes non-deterministic `fisherYatesShuffle` instead of storing a stable shuffled card-ID order in state/seed.

#### `BUG-007` [P1] `FlashcardsClient` keyboard shortcuts `2` and `3` are inverted and `Hard`/`Easy` buttons are missing
- **Files & Lines:** `src/components/learning/FlashcardsClient.tsx:402-414, 518-529`; `docs/PRD.md:55`
- **Steps to Reproduce:** Flip a flashcard and press `2` (expecting Hard) or `3` (expecting Good), or look for Hard/Easy buttons on screen.
- **Expected:** `1=Again, 2=Hard, 3=Good, 4=Easy` with matching visible rating controls.
- **Actual:** Key `2` invokes `"good"` and key `3` invokes `"hard"` (inverted). UI only renders 2 buttons (`Again` and `Good`); `Hard` and `Easy` have no buttons.
- **Root Cause:** Hardcoded key mapping mismatch and incomplete rating control bar.

#### `BUG-008` [P1] Offline exam with > 200 unsynced answers silently loses ALL answers on submit
- **Files & Lines:** `src/components/exam/LiveExamRunner.tsx:241-259, 320-326`; `src/lib/validation/exams.ts:38`
- **Steps to Reproduce:** Start a 250–500 question exam, disconnect network (or let autosave fail), answer 205 questions, reconnect, and click Submit.
- **Expected:** Dirty answers flush in chunks of <= 200 (or server accepts full attempt batch); submission halts with error if flush fails.
- **Actual:** `saveExamAnswersSchema` rejects arrays > 200 (`max(200)` -> HTTP 400). `executeSubmit` sends all 205 dirty items in one `PUT` and suppresses the failure with `.catch(() => {})` before calling `POST /submit`, grading all 205 answers as unanswered (`0%`).
- **Root Cause:** Unchunked flush batch exceeding schema limit combined with swallowed error handling before submit.

#### `BUG-009` [P1] `LiveExamRunner` stale `localStorage` draft overwrites newer server answers, and `PUT /answers` has no concurrency ordering guard
- **Files & Lines:** `src/components/exam/LiveExamRunner.tsx:207-218`; `src/app/api/exams/[attemptId]/answers/route.ts:61-78`
- **Steps to Reproduce:** Answer Q1=A on Device 1 (saved to `localStorage`), answer Q1=B on Device 2 (saved to server), then reload Device 1. Or click A then B rapidly on high-latency network.
- **Expected:** Newer server state wins over older local draft (timestamp/sequence check); overlapping `PUT`s never let an older request overwrite a newer selection.
- **Actual:** `LiveExamRunner.tsx:207-218` unconditionally overlays `localStorage` onto server answers on mount; `PUT /answers` performs an unguarded upsert with no `client_seq` or `updated_at` check.
- **Root Cause:** Missing per-answer monotonic sequence/timestamp conflict resolution on both client hydration and server upsert.

#### `BUG-010` [P1] Resume Exam banners and History always show `Answered: 0 / N` for in-progress exams
- **Files & Lines:** `src/app/api/exams/[attemptId]/answers/route.ts:71-78`; `src/components/exam/TestHubClient.tsx:304-306`; `src/components/analytics/history-view.tsx:223`
- **Steps to Reproduce:** Start an exam, answer 15 of 40 questions, wait for autosave, then return to `/sets/[id]/test` or `/history`.
- **Expected:** Resume banner and History display `15 / 40 answered`.
- **Actual:** Displays `0 / 40` until the exam is submitted.
- **Root Cause:** `PUT /api/exams/[attemptId]/answers` upserts `exam_attempt_answers` but never updates `exam_attempts.answered_count` (only `submit_exam_attempt` updates it at the end).

#### `BUG-011` [P1] `POST /api/sets/[id]/duplicate` collides on duplicate `position` (orphaning options), drops all tags, and ignores `allow_clone`
- **Files & Lines:** `src/app/api/sets/[id]/duplicate/route.ts:148-174`; `supabase/migrations/0001_initial_schema.sql:114`
- **Steps to Reproduce:** Duplicate a study set containing tags or two questions sharing the same `position`, or duplicate a shared set accessed via a link with `allow_clone = false`.
- **Expected:** Every question's options/accepted answers/tags map by deterministic 1:1 question ID/index; `allow_clone = false` is enforced.
- **Actual:** `newIdByPos.set(iq.position, iq.id)` overwrites entries when `position` repeats (since `questions.position` is not unique), attaching options to the wrong question or dropping them. `question_tags` are never copied. Share link `allow_clone` is never checked.
- **Root Cause:** Using non-unique `position` as a join key instead of client-generated UUIDs (`crypto.randomUUID()`), missing tag copy step, and missing `allow_clone` policy check.

#### `BUG-012` [P1] `WriteClient` "Override: I was right" double-records wrong+right (corrupting SM-2) and drops last-question count in `handleSelfAssess`
- **Files & Lines:** `src/components/learning/WriteClient.tsx:259, 301-311, 774-786`
- **Steps to Reproduce:** In `/sets/[id]/write`, type a close synonym marked wrong -> click "Override: I was right". Or finish a flashcard self-assessment on the final item.
- **Expected:** Override updates/replaces the attempt as correct without wiping SM-2 streak; final item count is accurately recorded on session completion.
- **Actual:** Initial submission immediately persists `is_correct: false` (incrementing `wrong_count` & resetting `consecutive_correct = 0`), then Override inserts a SECOND answer row with `true`. In `handleSelfAssess`, `handleAdvance()` runs synchronously before React commits `setCorrectIds`, sending stale `correct_items` to `PATCH /api/sessions/[id]` on the last question.
- **Root Cause:** Immediate eager persistence before override opportunity, and reading stale React state inside synchronous completion callback.

#### `BUG-013` [P1] `ExamResultsClient` drops `additional_study_set_ids` on Retake/Review Mistakes, re-grades `short_answer` differently from SQL, and omits virtualization
- **Files & Lines:** `src/components/exam/ExamResultsClient.tsx:92-100, 153-162, 295-304, 459-600`
- **Steps to Reproduce:** Complete a multi-set exam or a 300-question exam with `short_answer` questions, inspect results, and click "Retake Same Exam" or "Review Mistakes".
- **Expected:** Retake/Review preserves all source sets; displayed per-question correctness matches authoritative server `answer.is_correct`; 300–500 review cards render smoothly via virtualization.
- **Actual:** Retake/Review passes only primary `study_set_id` (dropping all `additional_study_set_ids` questions). Lines 92–100 recompute correctness client-side with JS `gradeWriteAnswer({ strict: false })`, which diverges from SQL `normalize_short_answer()` and disagrees with server `score_percent`. Lines 459–600 mount all 300–500 cards directly in the DOM without virtualization.
- **Root Cause:** Ignoring `attempt.config.additional_study_set_ids`, duplicating grading on the client instead of reading server `answer.is_correct`, and missing virtual list.

#### `BUG-014` [P1] `GET /api/mistakes` ignores exam mistakes' recorded answers, omits `accepted_answers`, truncates > 250 mistakes, and `/review` + `/starred` "All sets" CTAs launch only the first set
- **Files & Lines:** `src/app/api/mistakes/route.ts:52-87`; `src/components/learning/ReviewMistakesClient.tsx:190-245`; `src/components/learning/StarredQuestionsClient.tsx:112-149`
- **Steps to Reproduce:** Miss questions in an Exam (not a study session) and open `/review`; or filter by "All study sets" across 2+ sets in `/review` or `/starred` and click Practice/Test.
- **Expected:** Last wrong exam selection displays properly; `accepted_answers` show for `short_answer`; >250 items paginate cleanly; "All sets" launches across all included sets.
- **Actual:** `mistakes/route.ts` queries only `study_session_answers` (never `exam_attempt_answers`), omits `question_accepted_answers`, leaves `user_question_progress` and `question_options.in(...)` unpaginated (1,000-row cap), and both clients hardcode `items[0].study_set_id` for Practice/Test links.
- **Root Cause:** Single-table answer lookup, unchunked option fetches, and single-set URL routing in Review/Starred views.

#### `BUG-015` [P1] Import pipeline fails on sheet switch, rate-limits > 10,000Q commits, truncates dedup at 1,000 rows, and stores dead `/docx-media/...` image paths
- **Files & Lines:**
  - `src/components/import/ImportWizard.tsx:145-148, 495`
  - `src/app/api/import/commit/route.ts:139-144, 277-280, 385, 408`
  - `src/lib/import/docx-ooxml-parser.ts:1086`
  - `src/lib/import/index.ts:123-129`
- **Steps to Reproduce:** (a) Upload multi-sheet `.xlsx`, switch sheet in Step 3; (b) commit 12,000 questions in 500-row chunks; (c) import into a set with 1,500 existing questions using `duplicatePolicy="skip"`; (d) import a `.docx` containing embedded images.
- **Expected:** (a) Sheet switch resets column mapping; (b) 10,001–50,000Q imports succeed without 429; (c) dedup checks all existing prompts; (d) DOCX images upload to `study-media` and save valid storage paths.
- **Actual:** (a) `overrideOpts?.columnMapping ?? (columnMapping.prompt ? columnMapping : undefined)` ignores explicit `undefined`, sending previous sheet's columns! (b) `RATE_LIMITS.IMPORT_COMMIT` = 20 req / 5 min -> chunk #21 always fails with HTTP 429! (c) Existing prompt query has no pagination -> stops at 1,000 rows! (d) `index.ts:123` drops image `bytes`, and `commit/route.ts:385` persists dead `/docx-media/<file>` URLs (404).
- **Root Cause:** Nullish coalescing bug on explicit `undefined`, rate-limit budget misaligned with 500-row chunking for 50k cap, unpaginated dedup query, and unimplemented DOCX media upload pipeline.

#### `BUG-016` [P1] `GET /api/sets/[id]` truncates chapters/mastery at 1,000 rows and `useStudySetBundle` caps sets at 2,000 questions / 500 progress / 200 starred
- **Files & Lines:** `src/app/api/sets/[id]/route.ts:33-41`; `src/lib/learning/api-client.ts:151, 186, 246`
- **Steps to Reproduce:** Open a 3,000-question study set in `StudySetHub` or any Learning Mode.
- **Expected:** All chapters, accurate mastery distribution, and paginated/complete access to questions, progress, and starred items.
- **Actual:** `GET /api/sets/[id]` truncates `questions` and `user_question_progress` at 1,000 rows. `useStudySetBundle` hard-stops at 2,000 questions (`maxPages=4`), 500 progress rows, and 200 starred items.
- **Root Cause:** Unpaginated server queries and fixed client loop limits.

#### `BUG-017` [P1] `PATCH /questions/[questionId]` skips `superRefine` validation & omits `tags`, `POST /bulk` ignores `tags`, and single UI delete has no confirmation
- **Files & Lines:** `src/lib/validation/questions.ts:74`; `src/app/api/sets/[id]/questions/[questionId]/route.ts`; `src/app/api/sets/[id]/questions/bulk/route.ts:45-128`; `src/components/editor/question-editor-view.tsx:755-757`
- **Steps to Reproduce:** Send `PATCH /api/sets/[id]/questions/[qid]` with 0 correct options; call `POST /bulk` with `tags: ["ch1"]`; click trash icon on a question row in editor.
- **Expected:** `PATCH` enforces >=2 options and >=1 correct option for choice questions and returns `tags`; `POST /bulk` persists `tags`; UI prompts confirmation before destructive delete.
- **Actual:** `updateQuestionSchema` is `.partial()` on the base object (omitting `superRefine`), allowing corrupted choice questions; `GET`/`PATCH` single question omit `tags`; `POST /bulk` silently ignores `tags`; clicking delete immediately destroys the question with zero confirmation.
- **Root Cause:** Missing `.superRefine()` on update schema, omitted tag handling in bulk/single routes, and direct `handleDelete` invocation on icon click.

#### `BUG-018` [P1] `TestHubClient` "All" question count uses fake placeholder formula `length + extraSetIds.length * 100`
- **Files & Lines:** `src/components/exam/TestHubClient.tsx:227, 363`
- **Steps to Reproduce:** On `/sets/[id]/test`, attach 1 additional study set that contains 24 questions and click the "All" question count pill.
- **Expected:** Displays exact eligible question count across selected sets (e.g., `133 + 24 = 157`).
- **Actual:** Computes `133 + 1 * 100 = 233` (completely fabricated estimate).
- **Root Cause:** Hardcoded `* 100` placeholder instead of querying actual question counts or `POST /api/exams/eligible`.

#### `BUG-019` [P1] `POST /api/sessions/[sessionId]/answers` and `POST /api/progress` fail to verify question belongs to `study_set_id`, and session counters increment non-atomically
- **Files & Lines:** `src/app/api/sessions/[sessionId]/answers/route.ts:42-51, 133-140`; `src/app/api/progress/route.ts:61-78`
- **Steps to Reproduce:** Submit a valid `question_id` from Set B against a session or progress payload claiming `study_set_id = Set A`, or submit 2 concurrent answers to the same session.
- **Expected:** Server rejects mismatched `(question_id, study_set_id)` with `400/404`; `completed_items`/`correct_items` increment atomically.
- **Actual:** Cross-set `question_id` is written under the wrong `study_set_id`; read-modify-write counter update (`session.completed_items + 1`) races under concurrent requests.
- **Root Cause:** Missing `.eq("study_set_id", ...)` verification and non-atomic JS counter update instead of SQL increment/RPC.

#### `BUG-020` [P1] `PracticeClient` navigator grid is unvirtualized and clicking a tile during `autoNext` fails to cancel pending auto-advance timer
- **Files & Lines:** `src/components/learning/PracticeClient.tsx:629-668`
- **Steps to Reproduce:** Open Practice on a 500–2,000Q set with Auto-next enabled; answer Q1 and immediately click Q10 in the navigator before the timer fires.
- **Expected:** Navigator grid virtualizes large sets; manual jump clears `autoNextTimerRef` so user stays on Q10.
- **Actual:** All question tiles mount eagerly in DOM; 1–2s later `autoNextTimerRef` fires and yanks the user away from Q10 to Q11 (or Q2).
- **Root Cause:** Missing `clearTimeout(autoNextTimerRef.current)` in navigator click handler and missing virtualization.

---

### P2 — Moderate (Dead Controls, Broken Wiring, Incomplete UI/API Contracts)

#### `BUG-021` [P2] All 5 study & accessibility preference toggles in `/settings` are dead controls with ZERO runtime effect
- **Files & Lines:** `src/components/layout/settings-view.tsx` (`default_shuffle_questions`, `default_shuffle_options`, `show_instant_feedback`, `sound_effects`, `reduced_motion`); `src/app/providers.tsx:39`
- **Steps to Reproduce:** Toggle any of the 5 switches in `/settings`, save, and open Flashcards, Practice, Learn, Write, Match, or Exam.
- **Expected:** Toggles govern default shuffle, instant feedback, audio cues, and `<MotionConfig reducedMotion="always">`.
- **Actual:** Confirmed via recursive search across all of `src/`: none of the 5 fields are read anywhere outside `settings-view.tsx`. `providers.tsx:39` hardcodes `reducedMotion="user"` and no audio engine exists.
- **Root Cause:** Settings UI/DB schema were built without wiring preferences into a shared context or learning/exam initializers.

#### `BUG-022` [P2] `LoginForm` ignores `?error=` query parameters redirected by `/auth/callback` and `/auth/confirm`
- **Files & Lines:** `src/components/auth/login-form.tsx:53`; `src/app/auth/callback/route.ts:18, 28`; `src/app/auth/confirm/route.ts:29, 46`
- **Steps to Reproduce:** Navigate to `/login?error=auth_callback_failed` (as redirected on failed OAuth or expired confirmation token).
- **Expected:** Localized error alert explains why authentication/confirmation failed.
- **Actual:** Plain login form renders with zero error message.
- **Root Cause:** `LoginForm` reads only `searchParams.get("next")` and never reads `searchParams.get("error")`.

#### `BUG-023` [P2] `LoginForm` and `RegisterForm` ignore `NEXT_PUBLIC_ENABLE_GOOGLE_OAUTH` feature flag
- **Files & Lines:** `src/components/auth/login-form.tsx:279-297`; `src/components/auth/register-form.tsx:406-424`; `.env.example:31`; `README.md:79`
- **Steps to Reproduce:** Set `NEXT_PUBLIC_ENABLE_GOOGLE_OAUTH=false` with valid Supabase env vars and open `/login` or `/register`.
- **Expected:** Google Sign-In button is hidden when flag is `false` / unset.
- **Actual:** Google button always renders (0 references to `NEXT_PUBLIC_ENABLE_GOOGLE_OAUTH` in `src/`), causing failed OAuth attempts if Google provider isn't enabled in Supabase.
- **Root Cause:** Documented environment variable was never checked in auth UI components.

#### `BUG-024` [P2] `RegisterForm` username helper text and error message contradict its own regex and PostgreSQL `CHECK` constraint
- **Files & Lines:** `src/components/auth/register-form.tsx:58, 73, 248-249, 281-282`; `supabase/migrations/0001_initial_schema.sql:15`
- **Steps to Reproduce:** Open `/register` and enter username `john.doe` or `john-doe` following the UI hint.
- **Expected:** Hint matches allowed characters (`a-z`, `0-9`, `_`, 3–30 chars).
- **Actual:** Hint and error message tell users letters, numbers, underscores, **dots (`.`) and hyphens (`-`)** are allowed, while both client regex `/^[a-z0-9_]{3,30}$/i` and DB `CHECK (username ~ '^[a-z0-9_]{3,30}$')` reject them.
- **Root Cause:** Copy mismatch between form validation regex/DB constraint and helper text.

#### `BUG-025` [P2] Dashboard streak always `0`, daily goal/14d chart ignore exams, `recent_exams` displays `in_progress` attempts as `0% FAILED`, and queries truncate at 50 sets / 1,000 rows
- **Files & Lines:** `src/app/api/dashboard/route.ts:110-141`; `src/components/analytics/dashboard-view.tsx:110, 498-534`
- **Steps to Reproduce:** Complete an exam (without study sessions) or leave an exam `in_progress`, then open `/dashboard`.
- **Expected:** Streak shows real active streak; daily goal & 14-day chart include exam answers; in-progress exams show a Resume CTA linking to `/test/[attemptId]`.
- **Actual:** `GET /api/dashboard` never computes `streak_days` (badge always hidden); `today_answers` and `activity_14d` count only `study_session_answers`; `recent_exams` includes `in_progress` rows which UI renders as `0% FAILED` linking to `/results/[attemptId]`; `study_sets` caps at 50 and `user_question_progress` truncates at 1,000.
- **Root Cause:** Omitted streak calculation, omitted `exam_attempt_answers` aggregation, missing `status` filter/branch on `recent_exams`, and unpaginated queries.

#### `BUG-026` [P2] Statistics ignores `?days=` on exam trend, mixes windowed/all-time streaks, excludes exam answers from daily activity, truncates at 1,000 rows, and breaks null-chapter deep links
- **Files & Lines:** `src/app/api/statistics/route.ts:74-108, 189-225, 285`
- **Steps to Reproduce:** Open `/statistics`, switch between 7d / 30d / 90d, and click a weak chapter labeled `"General"` (from questions with `chapter = null`).
- **Expected:** All charts respect `?days=`; daily activity includes exams; null chapters link to uncategorized/all practice.
- **Actual:** `exam_score_trend` and `total_exams` ignore `?days=`; streaks combine windowed sessions with all-time exams; `daily_activity.answers` excludes exams; `.limit(10000)` on `study_session_answers` & unpaginated progress still cap at 1,000 in PostgREST; `"General"` generates `/practice?chapter=General` which matches 0 questions.
- **Root Cause:** Missing `.gte("submitted_at", sinceIso)` filter, unpaginated queries, and synthetic `"General"` string passed raw as a chapter query parameter.

#### `BUG-027` [P2] `HistoryView` cannot open exam results when `study_set_id IS NULL`, lacks pagination past 100, and lacks mode/status filters
- **Files & Lines:** `src/components/analytics/history-view.tsx:55, 63, 206-210`; `supabase/migrations/0001_initial_schema.sql:256`
- **Steps to Reproduce:** Delete a study set after taking an exam (setting `exam_attempts.study_set_id = NULL`) or create a V2.0 multi-subject exam, then open `/history`.
- **Expected:** Immutable exam result remains accessible via a set-independent route (e.g. `/exams/[attemptId]/results`); history paginates past 100 and filters by mode/status.
- **Actual:** Link requires `attempt.study_set_id` and breaks/disables when `NULL`. Fixed `limit=100` with no pagination and no mode/status filter controls.
- **Root Cause:** Exam result routing coupled to `/sets/[id]/results/[attemptId]` and missing pagination/filter UI.

#### `BUG-028` [P2] `ShareRedeemView` reads wrong RPC response keys (`study_set_title`/`permission`) and never previews link before redeeming
- **Files & Lines:** `src/components/social/share-redeem-view.tsx:87-90, 126-138`; `src/lib/supabase/rpc.ts:32-38`; `supabase/migrations/0003_functions_and_triggers.sql:884-889`
- **Steps to Reproduce:** Open `/share/[valid-token]` as an authenticated user.
- **Expected:** Previews set title, question count, owner, and permission via `GET /api/share-links/[token]/redeem`, then redeems displaying exact `title` and `role`.
- **Actual:** Skips preview; after `POST`, reads `redeemed.study_set_title` & `redeemed.permission` instead of `redeemed.title` & `redeemed.role`, always falling back to generic `"Shared Study Set"` and omitting the role badge.
- **Root Cause:** Property-name mismatch between SQL RPC return JSON (`title`, `role`) and frontend TypeScript interface/usage.

#### `BUG-029` [P2] Collaborator `editor` sees owner-only controls that fail with `403 FORBIDDEN`
- **Files & Lines:** `src/components/library/study-set-hub.tsx:314`; `src/components/editor/question-editor-view.tsx:832-940`
- **Steps to Reproduce:** Join another user's study set with `role = 'editor'` and open `/sets/[id]` and `/sets/[id]/edit`.
- **Expected:** Owner-only controls (Share dialog, Delete Set, Change Visibility, Move Folder) are hidden or clearly disabled for non-owners.
- **Actual:** Buttons render normally for `editor` and trigger `403 FORBIDDEN` errors on click.
- **Root Cause:** UI checks `canEdit` (which includes `editor`) instead of checking `role === "owner"`.

#### `BUG-030` [P2] Library, ShareDialog & FriendsView UI/Pagination Gaps
- **Files & Lines:** `src/components/library/library-view.tsx:115, 396-400`; `src/components/social/share-dialog.tsx:281-391`; `src/components/social/friends-view.tsx:342-490`
- **Steps to Reproduce:** (a) Navigate to `/library?create=folder` after `/library`; (b) create 1 root folder + 1 subfolder in Library; (c) open `ShareDialog` to set a link expiry; (d) open `/friends` to block a user or view pending request avatars.
- **Expected:** (a) Dialog opens reliably; (b) folder count matches displayed root folders or shows tree; (c) expiry dropdown/picker exists; (d) Block/Unblock controls and request avatars render; Library supports >100 pagination, visibility filter, and sort by `question_count`.
- **Actual:** `folderDialogOpen` uses initial-only `useState(createParam === "folder")`; folder header prints `folders.length` (all) while rendering only `parent_id === null`; `ShareDialog` hardcodes `expires_at: null` with no picker; `FriendsView` has no Block/Unblock action and omits avatars on pending cards; Library lacks pagination >100, visibility filter, and sort by question count.
- **Root Cause:** Incomplete UI controls and non-reactive URL query state.

#### `BUG-031` [P2] `DELETE /api/account/data` ignores errors & leaves orphan records; `GET /api/account/data` truncates at 1,000 rows and omits 7 tables
- **Files & Lines:** `src/app/api/account/data/route.ts:41-120`; `src/components/layout/settings-view.tsx:244`
- **Steps to Reproduce:** Call `GET /api/account/data` on a user with >1,000 questions/answers, or click Delete Account in `/settings` without `SUPABASE_SERVICE_ROLE_KEY`.
- **Expected:** Export includes complete lossless JSON across all user tables with pagination; delete checks every error, cleans `friendships`/`study_set_members`, and accurately reports data-wipe vs full auth-user deletion.
- **Actual:** `GET` omits `folders`, `tags`, `question_options`, `question_accepted_answers`, `exam_attempt_questions`, `exam_attempt_answers`, `starred_questions` and truncates at 1,000 rows. `DELETE` never inspects `{ error }` from 8 `.delete()` calls, skips `friendships` and `study_set_members`, and UI still shows "Account deleted" even when `auth.users` row wasn't removed.
- **Root Cause:** Incomplete table list, unpaginated queries, unchecked Supabase results, and optimistic UI messaging.

#### `BUG-032` [P2] Three divergent SM-2 implementations across client, Node helper, and PostgreSQL trigger/RPC
- **Files & Lines:** `src/lib/learning/sm2.ts:83, 138`; `src/lib/supabase/progress-helper.ts:94-103`; `supabase/migrations/0003_functions_and_triggers.sql:442-461`
- **Steps to Reproduce:** Compare mastery transitions and next review intervals produced by `sm2.ts` (unit-tested), `progress-helper.ts` (session/progress APIs), and `submit_exam_attempt` (SQL).
- **Expected:** One canonical SM-2 algorithm and mastery threshold everywhere.
- **Actual:** `sm2.ts` promotes to `mastered` at `consecutive_correct >= 3 && interval >= 14` with 3,650-day cap and no hard/easy multiplier; `progress-helper.ts` requires `consecutive_correct >= 4`, 365-day cap, and applies `1.2x`/`1.3x` multipliers; SQL `submit_exam_attempt` uses `consecutive_correct >= 4` and linear `+0.05`/`-0.20` ease adjustments instead of the SM-2 formula.
- **Root Cause:** Three separate hand-rolled implementations evolved independently without a shared contract.

#### `BUG-033` [P2] `ExamNavigatorGrid` hides Answered indicator when Flagged, lacks filters, and `LiveExamRunner` binds `F` instead of `M`
- **Files & Lines:** `src/components/exam/ExamNavigatorGrid.tsx:62-93`; `src/components/exam/LiveExamRunner.tsx:476`
- **Steps to Reproduce:** In a live exam, answer Q5 and also flag Q5; try filtering navigator by Unanswered/Flagged; press `M` to mark/flag.
- **Expected:** Tile clearly shows BOTH answered status and flag badge; navigator supports Unanswered/Flagged/Subject filters; `M` (or both `M`/`F`) flags the question.
- **Actual:** Flagged branch overrides answered styling so user cannot tell whether a flagged question has an answer; no navigator filters exist; only `F` toggles flag.
- **Root Cause:** Exclusive `if/else` class selection in navigator tile and omitted filter bar.

#### `BUG-034` [P2] `QuestionEditorView` missing chapter/tag/difficulty filters, bulk tags/difficulty UI, reordering, dirty-state guard, accepted-answer removal, and `short_answer`/type-switch validation
- **Files & Lines:** `src/components/editor/question-editor-view.tsx` (throughout; e.g., filters, bulk bar, option type switcher, accepted answers list, delete button)
- **Steps to Reproduce:** Open `/sets/[id]/edit` on a mixed multi-chapter set.
- **Expected:** Filter by chapter/tag/difficulty; bulk update tags/difficulty; reorder questions; warn on unsaved edits; remove extra accepted answers; enforce single correct option when switching `multiple_choice` -> `single_choice`; validate `short_answer` has >=1 accepted answer; view `source_metadata`; upload option/back images.
- **Actual:** All listed capabilities are missing or broken in `QuestionEditorView`.
- **Root Cause:** Editor shipped with minimal CRUD form without full Question Bank management workflows.

#### `BUG-035` [P2] `AppShell` sidebar duplicates `/library` across 4 of top 5 nav items and lacks `/exams/new` entry
- **Files & Lines:** `src/components/layout/app-shell.tsx:84-120`
- **Steps to Reproduce:** Open any authenticated page and inspect the primary sidebar links.
- **Expected:** Distinct navigation destinations (including direct `/exams/new` Exam Builder entry and distinct Folders vs Sets routes or views).
- **Actual:** 4 separate nav items point to `/library` (or `/library?...`), creating redundant active states and offering zero top-level entry to create a custom exam.
- **Root Cause:** Placeholder nav mapping carried over from V1.0 scaffolding.

#### `BUG-036` [P2] Printable Study Sheet (`@media print`) claimed in PRD & Architecture is not implemented
- **Files & Lines:** `docs/PRD.md:98`; `docs/ARCHITECTURE.md:165`; `src/app/globals.css`
- **Steps to Reproduce:** Trigger browser Print (`Ctrl+P`) on `/sets/[id]` or search `src/` for `@media print`.
- **Expected:** Clean print layout hiding navigation/chrome and formatting questions/answers for paper study.
- **Actual:** Zero `@media print` CSS rules exist anywhere in `src/`.
- **Root Cause:** Documented feature never implemented.

#### `BUG-037` [P2] `src/lib/supabase/middleware.ts` calls `supabase.auth.getUser()` without `try/catch`
- **Files & Lines:** `src/lib/supabase/middleware.ts:64-66`
- **Steps to Reproduce:** Configure Supabase URL pointing to an unreachable/slow endpoint and hit any route handled by `src/proxy.ts`.
- **Expected:** Graceful error handling (fail-closed redirect/503 without unhandled middleware exception).
- **Actual:** Unhandled rejection crashes the middleware request with a raw 500 error.
- **Root Cause:** Missing `try/catch` around network `getUser()` call in proxy middleware.

#### `BUG-038` [P2] `GET /api/starred` omits `question_accepted_answers` and `progress`, breaking display in `StarredQuestionsClient`
- **Files & Lines:** `src/app/api/starred/route.ts:56-63`; `src/components/learning/StarredQuestionsClient.tsx:287, 306`
- **Steps to Reproduce:** Star a `short_answer` question or a practiced question and open `/starred`.
- **Expected:** Starred item shows mastery badge and accepted answers.
- **Actual:** `GET /api/starred` returns neither `accepted_answers` nor `progress`, leaving mastery always `"new"` and accepted answers empty.
- **Root Cause:** Omitted joins/fetches in `GET /api/starred`.

#### `BUG-039` [P2] `tests/e2e/authenticated-journey.spec.ts` has 4 broken UI selectors/assertions
- **Files & Lines:** `tests/e2e/authenticated-journey.spec.ts` vs `src/components/library/create-set-form.tsx`, `src/components/import/ImportWizard.tsx`, `src/components/exam/LiveExamRunner.tsx`
- **Steps to Reproduce:** Run `authenticated-journey.spec.ts` against a live Supabase-backed server.
- **Expected:** E2E script matches actual UI labels, redirects, and step flows.
- **Actual:** (1) `getByLabel(/tiêu đề|title/i)` does not match actual label `"Tên học phần"`; (2) `waitForURL(/\/sets\/[0-9a-f-]+$/)` fails because set creation redirects to `/sets/[id]/edit`; (3) Import wizard is 6 steps, not 2 buttons; (4) `confirmSubmit` selector does not match `t("exam.submitExam")`.
- **Root Cause:** E2E spec was authored against assumed copy/flows without ever executing against a live server.

---

### P3 — Minor (Tooling / Non-Blocking)

#### `BUG-040` [P3] Vite CJS Node API deprecation warning during `npm run test`
- **Files & Lines:** `vitest.config.ts:1:1`
- **Steps to Reproduce:** Run `npm run test`.
- **Expected:** Clean stdout/stderr without deprecation warnings.
- **Actual:** Emits Vite CJS deprecation warning (non-blocking; all 82 tests pass).
- **Root Cause:** CJS config module resolution in Vitest/Vite setup.

---

## 5. External Blockers & Honest Verification Boundary

1. **Supabase / PostgreSQL Runtime Blocker (`BLOCKED`):**
   - `.env.local` is absent (`Test-Path` returned `False`), and Docker Desktop is not running locally.
   - Consequently, **zero live tests** ran against PostgreSQL, Supabase Auth, Supabase Storage (`study-media`), Row-Level Security policies (all 20 tables), or SQL RPCs (`submit_exam_attempt`, `get_exam_attempt_detail`, `redeem_share_link`, `preview_share_link`).
   - All 7 checks in `tests/unit/security/supabase-migrations-audit.test.ts` are **static text/regex checks** on `.sql` files, NOT live database RLS isolation proofs.
2. **Real Document Sample Files Available for Wave 2–5 Live Verification:**
   - Four real aviation test files are present in `sample-data/` (`METEOROLOGY-01. THE ATMOSTPHERE (133).docx`, `METEOROLOGY-05. PRECIPITATION (24).xlsx`, `METEOROLOGY-08. CLIMATOLOGY (62).docx`, `METEOROLOGY-08. CLIMATOLOGY (62).xlsx`).
   - Live end-to-end import + multi-subject exam testing against these 4 files is explicitly specified in [`docs/audit/TEST_MATRIX.md`](./TEST_MATRIX.md) (`TC-IMP-01` through `TC-IMP-06`, `TC-ALC-*`, `TC-COV-*`) without copying proprietary question text.
3. **Recommended Wave 2 Remediation Order (Functional Priority):**
   1. Fix **P0s first**: `BUG-001` (chunk all option/accepted-answer fetches to <=150 question IDs & paginate all `questions`/`progress` fetches), `BUG-002` (per-question `source_study_set_id` in `exam_attempt_questions` & `submit_exam_attempt`), `BUG-003` (`LearnClient` session & queue stability).
   2. Fix **Storage & Learning P1s**: `BUG-004`/`005` (signed URLs + `avatars/{uid}/` RLS path), `BUG-006`/`007` (Flashcards), `BUG-008`/`009`/`010`/`013` (Exam autosave chunking, concurrency guard, `answered_count`, multi-set retake, server-authoritative result grading + virtualization), `BUG-011`/`012`/`014`/`015`/`016`/`017`/`018`/`019`/`020`.
   3. Implement **V2.0 Universal Custom Exam Engine** (`EXM-V2-01` through `EXM-V2-10`) using paginated/chunked SQL & pure deterministic allocation/selection/coverage engines, then verify every test case in [`docs/audit/TEST_MATRIX.md`](./TEST_MATRIX.md) against a real running Supabase database.
