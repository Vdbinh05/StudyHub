# StudyHub V3.2 — Wave 1 Independent Functional, Exploratory & Stability Bug Report (`WAVE1_FUNC_BUGS.md`)

> **Auditor:** Agent 6 (`func-tester`, strictly independent — 0 production/test files modified)
> **Codebase HEAD:** `39952bd` (Next.js 16.4.6 Turbopack, React 19, TypeScript strict, Supabase Postgres + Storage, Playwright Chromium)
> **Environments Verified:**
> 1. **Deep Static & Code-Flow Audit** across routes, components, APIs, SQL migrations (`0001`–`0016`), and offline/PWA engines.
> 2. **Local Production Build (`npm run build && npx next start -p 3031`)** — full 7-viewport mobile sweep, 2-account RBAC test, 12 V3 question types, race/stress tests, 500Q Full Coverage, Backup & Restore, Import edge cases, HTTP 429/offline recovery (server torn down cleanly afterward).
> 3. **Live Production (`https://studyhub-three-mauve.vercel.app`)** — targeted verification executed **after** `perf-auditor` posted `[live-sweep-done]` (#7) and `@coordinator` cleared live access (#9).
>
> **Browser Engine Disclosure (Honest Scope):**
> - **Chromium** (`chromium-1248`/`1255` via `@playwright/test`) executed live across desktop (`1440×900`, `1280×850`) and all 7 mobile/tablet widths (`320, 360, 375, 390, 412, 430, 768px`).
> - **WebKit** is **not installed** in `%LOCALAPPDATA%\ms-playwright` (per Wave 1 rules, no runtime dependencies or browsers were installed). Safari/WebKit compatibility was audited statically (see `FUNC-29(d)` on `canvas.toBlob("image/webp")` fallback, plus verified `env(safe-area-inset-bottom)`, `webkitAudioContext`, `dvh`, and `requestIdleCallback` guards).
>
> **Test Data & Hygiene Attestation:**
> - **0 secrets printed/logged**, **0 `sample-data/` aviation texts read/quoted**, **0 pre-existing real user records touched**.
> - Strictly tracked disposable accounts prefixed `v32-func-` were created, tested, and **100% deleted** along with all uploaded storage prefixes. Post-cleanup verification confirmed `leftoverV32FuncUsers: 0`.

---

## 1. Executive Summary & Bug Tally

| Severity | Count | Temp IDs | Summary |
| :--- | :---: | :--- | :--- |
| **P0 — Critical / Data Loss** | **5** | `FUNC-01` – `FUNC-05` | In-progress exam resume strips V3 `structured_response` & `confidence` (Flag toggle wipes DB to `NULL`); literal `"[object Object]"` shown as correct answer in Learn & Review Mistakes; fast-reload (<300ms) drops exam answers; reloaded offline exam draft never auto-flushes; Backup & Restore strips all V3 payloads/tables. |
| **P1 — Major Functional / Race / Isolation** | **16** | `FUNC-06` – `FUNC-21` | Question Editor Fill-in-Blank eats spaces; Full Coverage permanent `409` wedge on mid-cycle delete; Practice/Learn/Exam V3 question type gaps; `?` opens 2 overlapping exam dialogs; ImportWizard stale `0 câu hỏi` SPA cache; Import parse/commit retry races; Settings 6 mode-preference sections unused; Settings tab URL desync; Viewer allowed in `/edit`; cross-account local checkpoint key + broken `?fresh=1` restart; Exam/Preferences async races; OfflineStudyRunner gaps; ReviewMistakes stale query keys; PDF export drops WebP/GIF & structured answers. |
| **P2 — UX / Mobile Ergonomics / Error States** | **8** | `FUNC-22` – `FUNC-29` | V3.1 carryovers (`UX31-11` 5 prominent Learn stage tabs, `UX31-13` Editor modal density); sub-44px touch targets across mobile routes; Hotspot pin offset & missing signed-URL `onError` recovery; Error-vs-Empty conflation (`FolderDetailView`, `ReportsInboxPanel`, `LibraryView` favorites pagination, bulk `content_version`); Import Hub `.pdf` missing & >1.5MB DOCX preview thumbnails lost; Clone Exam drops settings; EN `<title>` on `/sets/[id]`, unlocalized Login errors, Logout ordering, Safari WebP canvas fallback. |
| **P3 — Minor Polish** | **2** | `FUNC-30` – `FUNC-31` | First-toggle sound preview stale closure; Starred list omits V3 structured correct answers; minor double-click/crop-fetch polish in offline/media editors. |
| **TOTAL** | **31** | `FUNC-01` – `FUNC-31` | **11 bugs verified live on `https://studyhub-three-mauve.vercel.app`**, **17 verified via Playwright on local prod build**, **all 31 verified with exact file/line root causes**. |

---

## 2. Verified Passing Baseline Checks (No False Positives)

To keep fixes sharply targeted, the following areas were tested and **passed cleanly**:
- **0px horizontal overflow** across all 8 tested widths (`320, 360, 375, 390, 412, 430, 768, 1440px`) on both public (`/`, `/login`, `/register`, `/forgot-password`, `/offline`, `/404`) and authenticated (`/dashboard`, `/library`, `/sets/[id]`, `/sets/[id]/edit`, `/sets/[id]/learn`, `/sets/[id]/practice`, `/exams/new`, `/exams/[id]/results`, `/review`, `/settings`, `/offline`) routes.
- **0 React hydration mismatches** and **0 uncaught `pageerror` exceptions** across the entire Playwright sweep.
- **Latest StudyHub Brand Logo** renders cleanly in both Light (`/brand/logo-full.png`, `604×449`, `naturalWidth > 0`) and Dark (`/brand/logo-full-dark.png`, `604×449`, `naturalWidth > 0`) modes with `/brand/logo-icon.png` (`256×256`), 0 broken images.
- **Service Worker (`public/sw.js`) & Manifest**: Served `200 OK` with `Cache-Control: no-cache, no-store, must-revalidate` and registered/activated cleanly over HTTPS on `https://studyhub-three-mauve.vercel.app/`.
- **Global Search Hard Exam Guard (`Ctrl+K`)**: Opens `1` dialog on `/dashboard`, strictly blocked (`0` dialogs) on active `/exams/[attemptId]`.
- **Import Negative Security & Format Checks**: Corrupted `.docx` rejected with `400 INVALID_MAGIC_BYTES`; empty `.txt` rejected with `400 BAD_REQUEST`; blank/scanned PDF honestly detected (`200`, `isScannedPdf: true`, `SCANNED_PDF_DETECTED`); Quizlet TSV parsed (`2` flashcards).
- **HTTP 429 Graceful Recovery (`/library`)**: Displays localized rate-limit error state with working Retry button (no crash/blank screen).
- **i18n Key Parity (`src/lib/i18n/vi.ts` vs `en.ts`)**: 539/539 keys matched with 0 missing keys and 0 placeholder mismatches.
- **Rapid 10× A/B Answer Alternating in Live Exam**: Coalesced to 1 debounced `PUT` and persisted final option B accurately on server (`matched: true`).
- **Double-Click Launch Exam (`/exams/new`)**: Sent 1 `POST /api/exams` request (no duplicate attempt).
- **Full Coverage Unanswered Return Policy**: Verified `0016_v3_live_fixes.sql:511-536` intentionally marks only answered questions (`has_answer = true`) as `completed` and returns unanswered questions to `unassigned` so students never skip unanswered items.

---

## 3. P0 Bugs — Critical Data Loss & Broken Core Flows

### `FUNC-01` (P0) — In-Progress Exam Resume Strips `structured_response` & `confidence`, and Toggling Flag Permanently Wipes Saved V3 Answers to `NULL`
- **Route / File / Component:** `/exams/[attemptId]` · `src/app/api/exams/[attemptId]/route.ts:219-228` (also fallback breakdown helpers in `src/app/api/exams/[attemptId]/route.ts:69-72` and `src/app/api/exams/[attemptId]/submit/route.ts:42-45`)
- **Reproduction Steps:**
  1. Create a mock exam containing any V3 structured question (`numerical`, `ordering`, `matching`, `fill_in_blank`, or `image_hotspot`).
  2. Answer the question (e.g., `9.8 m/s2`), optionally pick a Confidence level (`Chắc chắn`), and wait >500ms for `PUT /api/exams/[attemptId]/answers` (`200 OK`).
  3. Clear `localStorage` (simulating switching devices, resuming via History/TestHub, or opening in a fresh tab) and reload `/exams/[attemptId]`.
  4. Observe `GET /api/exams/[attemptId]` response and the question UI.
  5. Click **Đánh dấu (Flag)** on that question, wait 500ms, and submit the exam.
- **Expected Behavior:** `GET /api/exams/[attemptId]` returns `structured_response` and `confidence` for the student's own in-progress answers; the UI restores the saved answer; toggling Flag preserves the saved answer.
- **Actual Behavior:** `GET /api/exams/[attemptId]` omits `structured_response` and `confidence` completely. The UI initializes `structuredResponse: null` and `confidence: null`. Clicking Flag then fires `PUT /api/exams/[attemptId]/answers` with `structured_response: null` and a higher `client_seq`, **permanently overwriting the saved DB answer with `NULL`** and grading a previously correct answer as **Incorrect/Unanswered**.
- **Evidence (Verified Live on Production `https://studyhub-three-mauve.vercel.app` & Local `:3031`):**
  - Live prod JSON trace (`wave1-live-prod-results.json`): `putStatus: 200`, `inProgressHasStructuredResponse: false`, `inProgressHasConfidence: false`, `wipedToNullByFlagOnLive: true`, `submittedIsCorrectOnLive: false`.
  - Local prod JSON trace (`wave1-focused-repro.json`): `GET /api/exams/[id]` returned ONLY `{ id, attempt_id, attempt_question_id, selected_option_ids, typed_answer, is_flagged, client_seq, updated_at }`; after Flag + Submit: `submittedStructuredResponse: null`, `submittedIsCorrect: false`.
- **Suspected Root Cause:** `src/app/api/exams/[attemptId]/route.ts:219-228` manually maps `detail.answers` while `status === "in_progress"` to strip `is_correct`, but accidentally omitted `structured_response`, `confidence`, and `hint_used` from the mapped object. Additionally, `buildFallbackBreakdowns` (`route.ts:69-72`) and `buildFallbackChapterBreakdown` (`submit/route.ts:42-45`) only check `selected_option_ids` and `typed_answer`, ignoring `structured_response`.

---

### `FUNC-02` (P0) — Literal `"[object Object]"` Displayed as Correct Answer in Learn Mode & Review Mistakes (Plus Blank `"—"` for V3 Structured Mistakes)
- **Route / File / Component:** `/sets/[id]/learn` (`src/components/learning/LearnClient.tsx:825-830`) and `/review` (`src/components/learning/ReviewMistakesClient.tsx:646-651`)
- **Reproduction Steps:**
  1. Create a study set containing a `short_answer` or `flashcard` question with accepted answers (e.g., `H2O`, `Water`) and a `numerical` question (`9.8 m/s2`).
  2. Open `/sets/[id]/learn`, advance past Step 1 Familiarity to Step 2 Write, type a wrong answer (`wrong-formula`), and press Enter.
  3. Navigate to `/review` and inspect both mistake cards.
- **Expected Behavior:** Both Learn Mode feedback and `/review` display human-readable answer strings (`"H2O / Water"` and `"9.8 m/s2"`).
- **Actual Behavior:**
  - **Learn Mode** renders: `Đáp án đúng: [object Object] / [object Object]`.
  - **Review Mistakes (`/review`)** renders: `Đáp án đúng: [object Object] / [object Object]` for the short-answer card, and `Đáp án đúng: —` for the `numerical` (and all other V3 structured) cards!
- **Evidence (Verified Live on Production `https://studyhub-three-mauve.vercel.app` & Local `:3031`):**
  - Screenshots:
    - [`docs/audit/v3.2-stability/screenshots/func-tester/live-p0-learn-object-object.png`](./screenshots/func-tester/live-p0-learn-object-object.png)
    - [`docs/audit/v3.2-stability/screenshots/func-tester/live-p0-review-object-object.png`](./screenshots/func-tester/live-p0-review-object-object.png)
  - DOM text snippet: `Đáp án đúng: [object Object] / [object Object]`.
- **Suspected Root Cause:** `getExpectedWriteAnswers()` (`src/lib/learning/write-grader.ts:3-7`) returns `AcceptedWriteAnswer[]` (array of `{ answer_text, match_mode }` objects), NOT `string[]`. While `StarredQuestionsClient.tsx:346-348` correctly calls `.map((a) => a.answer_text).join(" / ")`, both `LearnClient.tsx:830` (`expected.join(" / ")`) and `ReviewMistakesClient.tsx:649` (`expectedWrite.join(" / ")`) join the raw objects directly. `ReviewMistakesClient.tsx:646-650` also has no formatter for `type_payload` (`numerical`, `fill_in_blank`, `ordering`, `matching`, `image_hotspot`).

---

### `FUNC-03` (P0) — Unflushed Exam Answers Silently Lost on Fast Reload (<300ms), Tab Close, or Browser Back
- **Route / File / Component:** `/exams/[attemptId]` · `src/components/exam/LiveExamRunner.tsx:480-560`
- **Reproduction Steps:**
  1. Open an active exam at `/exams/[attemptId]`.
  2. Click an answer option on Question 1 (`"Hanoi"`).
  3. Immediately reload the page (`F5` / `page.reload()`) or close/navigate back within 300ms.
- **Expected Behavior:** The answer is persisted synchronously to `localStorage` on click and/or flushed via `pagehide`/`visibilitychange` with `keepalive: true` so reloading immediately never drops the student's selection.
- **Actual Behavior:** Neither `localStorage` nor the server receives the answer. After reload, Q1 is completely unanswered (`serverAnswerAfterFastReload: null`, `uiAriaPressedAfterFastReload: null`).
- **Evidence (Verified Live on Local Prod Build `:3031`):**
  - `wave1-focused-repro.json`: `p0_fastReloadDropsAnswer: { serverAnswerAfterFastReload: null, uiAriaPressedAfterFastReload: null }`.
- **Suspected Root Cause:** `scheduleAutosave` (`LiveExamRunner.tsx:480-548`) delays `writeLocalDraft` by a `300ms` `setTimeout` followed by `requestIdleCallback({ timeout: 1000 })` (up to `1.3s`!) and delays the server `PUT` by `400ms`. The component registers **no `beforeunload`/`pagehide`/`visibilitychange` flush**, and the unmount cleanup (`lines 549-558`) simply cancels both timers without flushing.

---

### `FUNC-04` (P0) — Merged Offline / `localStorage` Exam Draft Answers Never Auto-Flush on Reload While Badge Falsely Shows `"Đã lưu"`
- **Route / File / Component:** `/exams/[attemptId]` · `src/components/exam/LiveExamRunner.tsx:345-413, 474-478`
- **Reproduction Steps:**
  1. Answer a question in an active exam while offline (or have a dirty `studyhub-exam-draft:<attemptId>` entry in `localStorage` with `clientSeq` newer than server).
  2. Come back online and reload `/exams/[attemptId]`.
  3. Wait 2+ seconds without clicking any new option and inspect network traffic + the top-bar sync status badge.
- **Expected Behavior:** Upon merging unsynced `localStorage` draft answers into `dirtyQueueRef`, `LiveExamRunner` immediately shows `"Chưa đồng bộ / Đang lưu"` and flushes `PUT /api/exams/[attemptId]/answers`.
- **Actual Behavior:** **ZERO** `PUT /api/exams/[attemptId]/answers` requests fire, and the top-bar sync indicator displays green **`"Đã lưu"` (Saved)** while the merged answers exist only in memory/localStorage and are NOT on the server!
- **Evidence (Verified Live on Local Prod Build `:3031`):**
  - `wave1-local-audit-results.json`: `p0_localDraftNeverAutoFlushes: { putFiredAfterDraftReload: false, syncStatusText: ["Đã lưu"] }`.
- **Suspected Root Cause:** The auto-flush `useEffect` at `LiveExamRunner.tsx:474-478` (`if (dirtyQueueRef.current.size > 0 && isOnline) flushDirtyQueue()`) has dependency array `[flushDirtyQueue, isOnline]`. It executes once on initial mount while `examQuery.isLoading` is `true` and `dirtyQueueRef.current.size === 0`. When `examQuery.data` resolves later and `lines 398-401` populate `dirtyQueueRef` from `localStorage`, the effect **never re-runs** and `syncStore` stays `"saved"`.

---

### `FUNC-05` (P0) — Account Backup & Restore Strips All V3 Question Payloads, Rich Text, Audio, Diagrams, Notes & Progress
- **Route / File / Component:** `/settings?tab=account` · `src/app/api/account/data/route.ts:189-210`, `src/app/api/account/restore/route.ts:24, 267-313`, `src/components/layout/settings-view.tsx:349`
- **Reproduction Steps:**
  1. Create a study set with V3 questions (`numerical`, `ordering`, `matching`, `fill_in_blank`, `image_hotspot`, `reading_passage`, `listening`, `image_choice`), diagrams, shared passages, rich-text/KaTeX prompts, personal notes, and progress.
  2. Export account backup via `GET /api/account/data` ("Tải bản sao lưu JSON").
  3. Restore via `POST /api/account/restore` and inspect the restored study set's questions.
- **Expected Behavior:** Backup includes all user study data (or explicitly discloses exclusions) and Restore faithfully reconstructs all 12 V3 question types, rich text, audio metadata, passages, diagrams, and notes without silent corruption.
- **Actual Behavior:**
  - Export emits legacy `schema_version: "studyhub-v2"` and completely omits 13+ V3/V2 tables.
  - Restore returns `201 Created` (claiming success) while silently stripping `type_payload`, `prompt_rich`, `back_rich`, `explanation_rich`, `audio_url`, `audio_transcript`, `passage_id`, `diagram_id` on `questions`, and `content_rich`/`image_alt` on `question_options` — turning every V3 structured question (`numerical`, `ordering`, `matching`, `fill_in_blank`, `image_hotspot`, `reading_passage`, `listening`) into a corrupted record with `type_payload: null`!
  - Additionally, client validation in `settings-view.tsx:349` permits backups up to `15 MB`, while `restore/route.ts:24` rejects payloads over `12 MB` (`413`).
- **Evidence (Verified Live on Production `https://studyhub-three-mauve.vercel.app` & Local `:3031`):**
  - Live prod trace (`wave1-live-prod-results.json`): `schemaVersion: "studyhub-v2"`, `restoreStatus: 201`, `restoredNumericalTypePayload: null`.
  - Local prod trace (`wave1-focused-repro.json`): `restoredNumericalTypePayload: null`, `restoredOrderingTypePayload: null`.

#### Backup & Restore Honest Coverage Audit Matrix

| Entity / Table | Exported (`GET /api/account/data`)? | Restored (`POST /api/account/restore`)? | Data Integrity Status |
| :--- | :---: | :---: | :--- |
| `profiles` | Yes | No | Export-only |
| `user_preferences` | Yes | Yes | Restored |
| `folders` | Yes | Yes | Restored |
| `study_sets` | Yes | Yes | Restored (new UUIDs) |
| `questions` (V1 fields: `prompt`, `back_text`, `explanation`, `chapter`) | Yes | Yes | Restored |
| **`questions` (V3 fields: `type_payload`, `prompt_rich`, `back_rich`, `explanation_rich`, `audio_url`, `audio_transcript`, `passage_id`, `diagram_id`)** | Partial (`SELECT *`) | **STRIPPED (`null`)** | **CORRUPTED ON RESTORE (P0)** |
| `question_options` (V1 fields) / V3 `content_rich`, `image_alt` | Yes | V1 Yes / **V3 STRIPPED** | **Partial loss** |
| `question_accepted_answers`, `tags`, `question_tags` | Yes | Yes | Restored |
| `user_question_progress`, `starred_questions`, `study_sessions`, `study_session_answers` | Yes | **No** | Exported, never restored |
| `exam_attempts`, `exam_attempt_answers`, `exam_presets`, `exam_preset_sources`, `coverage_cycles` | Yes (partial — no `exam_attempt_questions`/`sources`, no `coverage_cycle_questions`/`attempts`) | **No** | Partial export, never restored |
| **`diagram_sets`, `diagram_hotspots`, `shared_passages`, `user_question_notes`, `media_assets`, `content_media_relations`, `learning_session_checkpoints`, `learning_confidence_events`, `question_reports`** | **MISSING** | **MISSING** | **100% OMITTED** |

---

## 4. P1 Bugs — Major Functional, Race-Condition, Isolation & Learning Mode Defects

### `FUNC-06` (P1) — Question Editor Fill-in-the-Blank Eats Spaces on Every Keystroke & `blank_id` Remounts Input
- **Route / File / Component:** `/sets/[id]/edit` · `src/components/editor/V3QuestionTypeFields.tsx:654, 672-674`
- **Reproduction Steps:**
  1. Open `/sets/[id]/edit`, click **Thêm câu hỏi**, select question type **Điền vào chỗ trống (Fill in the blank)**.
  2. Click into the accepted answers input (`"Đáp án đúng (ngăn cách dấu phẩy)"`) and type `"Ha Noi"` via keyboard.
  3. Also try editing the `blank_id` input (`b1`) to `"blank_1"`.
- **Expected Behavior:** The accepted answers field retains `"Ha Noi"`, and editing `blank_id` keeps input focus.
- **Actual Behavior:** Typing `"Ha Noi"` immediately strips every trailing space on keystroke, producing `"HaNoi"` — making it **impossible to type any multi-word Vietnamese or English phrase** (e.g., `"Hà Nội"`, `"New York"`) without pasting! Additionally, `key={blank.blank_id}` (`line 654`) remounts the row on every character typed into `blank_id`, kicking keyboard focus out after 1 keystroke.
- **Evidence (Verified Live on Production `https://studyhub-three-mauve.vercel.app` & Local `:3031`):**
  - Live prod: `live_p1_editorFillInBlankValue: "HaNoi"` after `keyboard.type("Ha Noi")`.
  - Local prod: `p1_editorFillInBlankEatsSpace: { typed: "Ha Noi", actualInputValue: "HaNoi", spaceWasEaten: true }`.
- **Suspected Root Cause:** Controlled `<Input value={blank.accepted_answers.join(", ")} onChange={(e) => e.target.value.split(",").map((s) => s.trim())} />` trims trailing whitespace on every single keystroke instead of keeping a raw draft string and parsing on blur/save.

---

### `FUNC-07` (P1) — Full Coverage Cycle Permanently Wedged (`409 CYCLE_ALREADY_COMPLETED`) When Remaining Unassigned Questions Are Deleted Mid-Cycle
- **Route / File / Component:** `/exams/new` (`CoverageCyclesSection`) · `src/lib/supabase/coverage-helper.ts:152-170`, `src/app/api/coverage-cycles/route.ts:92-95`
- **Reproduction Steps:**
  1. Create a 4-question study set and start a Full Coverage cycle with `questions_per_exam: 2` (`start_first_exam: true`).
  2. Answer both questions in Exam 1 and submit (`completed_count: 2`, `remaining_count: 2`, `status: "active"`).
  3. Delete the remaining 2 unassigned source questions from the study set.
  4. Inspect `GET /api/coverage-cycles` and click **Tạo đề tiếp theo** (`POST /api/coverage-cycles/[id]/next-exam`).
- **Expected Behavior:** Either the cycle auto-completes (since 0 live unassigned questions remain) or `remaining_count` reflects `0` and marks `status = 'completed'`.
- **Actual Behavior:** `GET /api/coverage-cycles` forever displays `status: "active"` with `remaining_count: 2`, while `POST /api/coverage-cycles/[id]/next-exam` returns **`409 CYCLE_ALREADY_COMPLETED`** without updating `coverage_cycles.status` — permanently wedging the cycle in an uncompletable active state.
- **Evidence (Verified Live on Production `https://studyhub-three-mauve.vercel.app`):**
  - `live_p1_coverageMidCycleDeleteWedge`: `afterExam1CompletedCount: 2`, `afterExam1RemainingCount: 2`, then after deleting the 2 unassigned questions: `cycleStatusStillActive: "active"`, `remainingCountStillShown: 2`, `nextExamStatus: 409`, `nextExamError: { code: "CYCLE_ALREADY_COMPLETED" }`.
- **Suspected Root Cause:** `ON DELETE SET NULL` sets `coverage_cycle_questions.question_id = NULL` while leaving `state = 'unassigned'` and `coverage_cycles.total_questions` unchanged. `GET /api/coverage-cycles` computes `remainingCount = total_questions - completed_count - assigned_count` ignoring `question_id IS NULL`, while `issueNextExamForCycle` filters `.not("question_id", "is", null)` and throws `409` without transitioning `coverage_cycles.status` to `'completed'`.

---

### `FUNC-08` (P1) — Practice & Custom Practice Break 5 V3 Question Types, Hide Reading Passages, & Ignore `/review` `?count=20` Link
- **Route / File / Component:** `/sets/[id]/practice` (`src/components/learning/PracticeClient.tsx:1304-1577`), `/practice` (`src/components/learning/CustomPracticeClient.tsx:160-165, 771-782`)
- **Reproduction Steps:**
  1. Open `/sets/[id]/practice` on a mixed set containing `reading_passage`, `ordering`, `matching`, `fill_in_blank`, `numerical`, `image_hotspot`, and `listening` questions.
  2. Step through all questions.
  3. On `/practice`, open the question-type filter or navigate via `/practice?mode=mistakes&count=20` from `/review`.
- **Expected Behavior:** Reading passage text renders above its sub-question; structured V3 types render interactive controls; Custom Practice allows filtering all V3 types and honors `?count=20`.
- **Actual Behavior:**
  - `reading_passage` never displays `passage_text` (`sawReadingPassageText: false`).
  - `ordering`, `matching`, `fill_in_blank`, `numerical`, and `image_hotspot` all fall back to a single plain text `<Input>` with zero interactive controls (`orderMoveBtnCount: 0`, `inputCount: 1`), making them unplayable/unpassable.
  - `listening` ignores `type_payload.audio_url`.
  - `CustomPracticeClient` only exposes 4 V1 types in its filter and ignores the `?count=20` query param linked from `ReviewMistakesClient.tsx:753`.
- **Evidence (Verified Live on Local Prod Build `:3031`):**
  - `wave1-focused-repro.json`: `p1_practiceBrokenV3Types: { sawReadingPassageText: false, practiceSteps: [..., { step: 4, promptHint: "Sort 1, 2, 3:", inputCount: 1, orderMoveBtnCount: 0 }, { step: 5, promptHint: "What speed does the passage mention?", containsPassageText: false }] }`.
- **Suspected Root Cause:** `PracticeClient.tsx` still uses a V1 binary branch (`options.length > 0` vs plain text `<Input>`) rather than delegating structured types to shared V3 question renderers.

---

### `FUNC-09` (P1) — Learn Mode Breaks Multi-Select V3 Choice Types, Leaks Unshuffled Matching Order, Breaks Multi-Target Hotspots, & Leaks Numerical Unit
- **Route / File / Component:** `/sets/[id]/learn` · `src/components/learning/LearnClient.tsx:996, 1699, 1745, 1787, 1915, 2001`
- **Reproduction Steps:**
  1. Open `/sets/[id]/learn` on a set containing: (a) multi-select `image_choice`/`reading_passage`/`listening`; (b) `matching`; (c) `image_hotspot` with `require_all_targets: true` (2+ targets); (d) `numerical` with `unit_required: true`.
  2. Attempt each activity.
- **Expected Behavior:** Multi-select V3 choice questions let the learner select multiple options before submitting; `matching` right-side items are deterministically shuffled; multi-target hotspots accept multiple pins + keyboard crosshair; `numerical` unit placeholder doesn't reveal the exact answer unit.
- **Actual Behavior:**
  - `LearnClient.tsx:1699, 1745` checks only `question_type === "multiple_choice"`, so clicking the 1st option on multi-select `image_choice`/`reading_passage`/`listening` immediately auto-submits as wrong.
  - `LearnClient.tsx:1915` renders `matching` `rightChoices` in the exact unshuffled `pairs` array order (1-to-1 position giveaway).
  - `LearnClient.tsx:2001` overwrites the single pin on every click, ignoring `require_all_targets` (impossible to pass 2-target hotspot) and lacks keyboard fallback.
  - `LearnClient.tsx:1787` reveals the expected unit verbatim in placeholder (`Đơn vị (vd: m/s2)`).
- **Evidence:** Direct code-flow inspection of `LearnClient.tsx` lines `996`, `1699`, `1745`, `1787`, `1915`, `2001`.
- **Suspected Root Cause:** Missing V3 multi-select detection helper, missing shuffle on `pairs` right column, single-point state in hotspot handler, and unmasked unit placeholder.

---

### `FUNC-10` (P1) — Exam Runner V3 Type Bugs: `listening` + `fill_in_blank` Dead Code, Unconfirmable Initial `ordering`, & Stripped Optional `numerical` Unit Badge
- **Route / File / Component:** `/exams/[attemptId]` · `src/components/exam/V3ExamQuestionBody.tsx:71-72, 158-177, 462, 469-472`, `src/lib/supabase/exam-engine.ts:1037-1042`
- **Reproduction Steps:**
  1. Start an exam containing: (a) `listening` with `sub_answer_kind: "fill_in_blank"`; (b) `ordering`; (c) `numerical` with `unit_required: false, unit: "hPa"`.
  2. Navigate to each question in `LiveExamRunner`.
- **Expected Behavior:** (a) Listening + fill-in-blank renders per-blank inputs; (b) Ordering allows confirming the current order when already correct; (c) Numerical with `unit_required: false` shows the expected unit badge (`hPa`) so students know what unit scale to answer in.
- **Actual Behavior:**
  - (a) Renders a plain `short_answer` `<textarea>` (`textareaCount: 1, blankInputCount: 0`) because `V3ExamQuestionBody.tsx:469-472` requires `(question_type === "fill_in_blank" || (payload?.type === "listening" && ...)) && payload?.type === "fill_in_blank"` — mathematically impossible for `listening`.
  - (b) Ordering starts with `structuredResponse: null` and **0 Confirm buttons** (`orderingHasConfirmButton: 0`); if the initial order is already correct, the question is graded **Unanswered** unless the student moves an item away and back!
  - (c) `sanitizePreSubmitTypePayload` (`exam-engine.ts:1037-1042`) strips `payload.unit` even when `unit_required: false`, so `<Badge>{payload.unit}</Badge>` (`V3ExamQuestionBody.tsx:462`) can never render.
- **Evidence (Verified Live on Local Prod Build `:3031`):**
  - `wave1-local-audit-results.json`: `listeningFibCheck: { listenPos: 8, textareaCount: 1, blankInputCount: 0 }`.
  - `wave1-focused-repro.json`: `orderingHasConfirmButton: 0`.
- **Suspected Root Cause:** Contradictory type narrowing in `V3ExamQuestionBody.tsx:469-472`, missing explicit "Confirm order" action in ordering widget, and overly broad `unit` stripping in `exam-engine.ts:1038` when `unit_required === false`.

---

### `FUNC-11` (P1) — Pressing `?` in Active Exam Opens Two Overlapping Shortcut Dialogs Simultaneously, & Keydown Listeners Fire Behind Open Modals / Ignore IME & `shortcutsEnabled`
- **Route / File / Component:** `/exams/[attemptId]` (`src/components/exam/LiveExamRunner.tsx:828-902`), `src/components/layout/ShortcutProvider.tsx:164`, `FlashcardsClient.tsx`, `LearnClient.tsx`, `PracticeClient.tsx`
- **Reproduction Steps:**
  1. Open `/exams/[attemptId]` and press `?`.
  2. Observe the number of mounted `[role="dialog"]` modals.
  3. Open any dialog (`ImageLightbox`, `ResetProgressDialog`, `ShortcutHelpModal`) in Exam/Flashcards/Learn/Practice and press `1`–`4` or `ArrowRight`.
- **Expected Behavior:** Pressing `?` opens a single keyboard shortcut modal; learning/exam keydown listeners stop when `shortcutsEnabled === false`, during Vietnamese IME composition (`isImeComposingEvent`), or when any modal/dialog/Select is open.
- **Actual Behavior:** Pressing `?` during an active exam opens **2 overlapping modals** simultaneously (`"Phím tắt bàn phím"` from `ShortcutProvider` stacked directly over `"Phím tắt"` from `LiveExamRunner`), requiring 2 Escape presses to dismiss. Furthermore, `LiveExamRunner`, `FlashcardsClient`, `LearnClient`, and `PracticeClient` attach raw `window.addEventListener("keydown")` handlers that ignore `event.defaultPrevented`, `shortcutsEnabled`, IME composition, and open Radix dialogs — mutating answers/cards behind open modals.
- **Evidence (Verified Live on Production `https://studyhub-three-mauve.vercel.app` & Local `:3031`):**
  - Live prod: `liveQuestionMarkDialogs: 2`.
  - Local prod: `openDialogCountOnQuestionMark: 2`, `dialogTitles: ["Phím tắt", "Phím tắt bàn phím", ...]`, screenshot [`docs/audit/v3.2-stability/screenshots/func-tester/exam-double-shortcut-dialog.png`](./screenshots/func-tester/exam-double-shortcut-dialog.png).
- **Suspected Root Cause:** Duplicate `?` shortcut handling in both `ShortcutProvider` and `LiveExamRunner` without checking `event.defaultPrevented`, and missing shared modal/IME/preference guard across mode keydown listeners.

---

### `FUNC-12` (P1) — `ImportWizard` & Question Editor Miss React Query Cache Invalidations -> Stale `0 câu hỏi` Locks All Learning Modes After Import
- **Route / File / Component:** `/sets/[id]/import` (`src/components/import/ImportWizard.tsx`), `/sets/[id]/edit` (`src/components/editor/question-editor-view.tsx:446-613`)
- **Reproduction Steps:**
  1. Open a newly created empty study set (`/sets/[id]`) — displays `0 câu hỏi` and caches `["study-set", id]` / `["set-questions", id]` (`staleTime: 30_000`).
  2. Click **Nhập từ file** (client-side SPA navigation to `/sets/[id]/import`).
  3. Paste 1+ valid questions, click **Phân tích**, then click **Nhập 1 câu hỏi** (`200 OK`).
  4. Immediately click the link back to `/sets/[id]` (within 30 seconds).
- **Expected Behavior:** The study set page immediately shows `1 câu hỏi` with all learning modes unlocked.
- **Actual Behavior:** `/sets/[id]` displays **`0 câu hỏi`** and `"Thêm câu hỏi hoặc nhập tệp Word/PDF/Excel để mở khóa các chế độ học"`, locking out Flashcards/Practice/Learn/Exam until `staleTime` expires or hard refresh! Similarly, edits/deletions in `question-editor-view.tsx` never invalidate `["study-set-bundle", setId]`, causing learning modes to serve stale/deleted questions for up to 30–60s.
- **Evidence (Verified Live on Local Prod Build `:3031`):**
  - `wave1-focused-repro.json`: `p1_importStaleCacheSpaNavigation: { showsZeroQuestionsImmediatelyAfterImport: true, snippet: "...v32-func Fast Cache Check\n0 câu hỏi...Thêm câu hỏi hoặc nhập tệp Word/PDF/Excel để mở khóa các chế độ học." }`.
- **Suspected Root Cause:** `ImportWizard.tsx` never imports `useQueryClient` or invalidates `["study-set", studySetId]`, `["set-questions", studySetId]`, `["study-set-bundle", studySetId]`, `["study-sets"]`, or `["dashboard"]` on commit completion; `question-editor-view.tsx` omits `["study-set-bundle", setId]`.

---

### `FUNC-13` (P1) — `ImportWizard` & `/api/import/commit` Parse/Double-Click Races & Multi-Chunk Retry/Sub-Batch Integrity Hazards
- **Route / File / Component:** `src/components/import/ImportWizard.tsx:281-507, 697-805`, `src/app/api/import/commit/route.ts:249-297, 415-421, 650`
- **Reproduction Steps:**
  1. **Parse race:** Select slow File A (e.g., large DOCX), then immediately select fast File B before File A finishes parsing.
  2. **Double-click commit:** Rapidly double-click the Import CTA or Retry button in `StepCommit`.
  3. **Multi-chunk retry:** Import >500 questions across 2 chunks; simulate a transient 503 on chunk 2, then click Retry.
  4. **Replace partial failure:** Import in `mode: "replace"` and trigger an error after chunk 1 deletes existing rows.
- **Expected Behavior:** Older parse requests are aborted/ignored; double-clicking Commit sends 1 batch; retrying chunk 2 resumes cleanly with the active `importJobId`; `replace` mode doesn't leave an empty set on mid-chunk failure.
- **Actual Behavior:**
  - `runServerParse` has no `AbortController` or monotonic request sequence check — slower File A response overwrites File B's preview.
  - `executeCommit` has no synchronous ref guard — rapid double-click spawns concurrent commit loops.
  - On chunk 2 retry, chunk 0 hits idempotency replay (`commit/route.ts:283-296`) which returns `importJobId: null`; chunk 1 then sends `isFirstChunk: false, importJobId: undefined`, skipping `import_jobs` creation/finalization (`line 387`) and leaving the original `import_jobs` row stuck in `status = 'importing'` forever while reporting `totalImported: 0` for chunk 0.
  - If a chunk with >500 questions fails on sub-batch 2 (`chunkArray(questionsToInsert, 500)`, `line 650`), retrying hits `existingIdemRows.length > 0` (`line 283`) and replays `importedCount: 0` — **silently dropping questions 501+**!
- **Evidence:** Exact code-flow audit of `ImportWizard.tsx:281-507, 697-805` and `src/app/api/import/commit/route.ts:249-297, 386-421, 650`.
- **Suspected Root Cause:** Missing `AbortController`/sequence counter in `runServerParse`, missing ref lock in `executeCommit`, `idempotentReplay` omitting stored `importJobId`, and per-chunk idempotency key shared across multiple non-transactional 500-row sub-batches.

---

### `FUNC-14` (P1) — All 6 Mode Preference Panels in `/settings?tab=modes` Are Disconnected / Ignored by Learning Modes (+ Spell Mode Ignores `confidence_enabled` & Blocks Audio Under Reduced Motion)
- **Route / File / Component:** `/settings?tab=modes` · `src/components/layout/settings-view.tsx`, `src/components/learning/{Flashcards,Practice,Learn,Write,SpellMode}Client.tsx`, `src/components/diagram/DiagramStudyPlayer.tsx`
- **Reproduction Steps:**
  1. Open `/settings?tab=modes`, toggle any setting across the 6 mode panels (Flashcards, Multiple Choice, Learn, Write, Spell, Diagram), and save.
  2. Open the corresponding learning mode and verify behavior.
  3. Enable `confidence_enabled` in Settings, enable OS `prefers-reduced-motion`, and open `/sets/[id]/spell`.
- **Expected Behavior:** Saved `mode_preferences` control study mode defaults; Spell mode respects `preferences.confidence_enabled` and plays audio regardless of motion reduction preference.
- **Actual Behavior:**
  - Repo-wide grep across `src/` confirms **ZERO** learning mode components ever read `preferences.mode_preferences` — all 6 preference sections in `/settings?tab=modes` are dead UI controls!
  - `SpellModeClient.tsx:140` hardcodes `useState(false)` instead of reading `preferences.confidence_enabled`.
  - `SpellModeClient.tsx:421` blocks audio auto-play when `prefersReducedMotion` is enabled (conflating visual animation reduction with audio playback in an audio-first Spell mode!).
- **Evidence:** PowerShell recursive `Select-String` scan for `mode_preferences` across `src/**/*.ts(x)` returned hits ONLY in `settings-view.tsx`, `src/lib/preferences/index.tsx`, `src/lib/validation/*`, and `src/types/*` — 0 reads in any `src/components/learning/*` or `src/components/diagram/*` file.
- **Suspected Root Cause:** Settings UI & DB persistence were built for `mode_preferences`, but consumers in the 6 study mode components were never wired up.

---

### `FUNC-15` (P1) — Settings Tab URL Sync Permanently Breaks After First Tab Click
- **Route / File / Component:** `/settings` · `src/components/layout/settings-view.tsx:143-145, 484-495`
- **Reproduction Steps:**
  1. Navigate to `/settings`.
  2. Click the second tab (**Chế độ học & Phím tắt**).
  3. Click the top-bar Online/Offline pill linking to `/settings?tab=offline` (or use browser Back/Forward).
- **Expected Behavior:** The active tab switches to **Ngoại tuyến & Ứng dụng** matching `?tab=offline`.
- **Actual Behavior:** URL updates to `/settings?tab=offline`, but the UI remains permanently stuck on **Chế độ học & Phím tắt**.
- **Evidence (Verified Live on Production `https://studyhub-three-mauve.vercel.app` & Local `:3031`):**
  - Live prod: `live_p1_settingsTabDesync: { url: ".../settings?tab=offline", tabBefore: "Chế độ học & Phím tắt", tabAfter: "Chế độ học & Phím tắt", stayedStuck: true }`.
- **Suspected Root Cause:** `const activeTab = selectedTab ?? urlTab;` (`settings-view.tsx:143-145`). Once `selectedTab` becomes non-null after the first click, `urlTab` (`searchParams.get("tab")`) is permanently shadowed, and clicking tabs does not update the URL query parameter either.

---

### `FUNC-16` (P1) — `viewer`-Role Collaborators Allowed Into Full Question Editor UI & Broken Global Search Deep Links
- **Route / File / Component:** `/sets/[id]/edit` (`src/components/editor/question-editor-view.tsx:615, 858`), `src/components/layout/GlobalSearchDialog.tsx:169-175`
- **Reproduction Steps:**
  1. Share a study set with Account B using role `viewer`.
  2. As Account B, open `Ctrl+K` Global Search and click any matching question/option/note, OR navigate directly to `/sets/[id]/edit`.
- **Expected Behavior:** Global Search deep-links to a read-safe view or focuses the matched question; `/sets/[id]/edit` guards against `viewer` role by rendering a read-only notice or redirecting to `/sets/[id]`.
- **Actual Behavior:** Global Search routes every Question/Option/Note hit to `/sets/[id]/edit` (dropping the question ID context completely). Account B (`viewer`) lands inside the full Question Editor seeing **Thêm câu hỏi** and all **Delete** buttons (all 13 visible), which fail with `403 Forbidden` when clicked!
- **Evidence (Verified Live via 2-Account Test on Local Prod Build `:3031`):**
  - `wave1-local-audit-results.json`: `p1_viewerAllowedInEditor: { addQuestionButtonVisibleToViewer: true, deleteButtonsVisibleToViewer: 13 }`.
- **Suspected Root Cause:** `question-editor-view.tsx` does not check `access.role`/`canEdit` before rendering mutation controls, and `GlobalSearchDialog.tsx:169-175` hardcodes `/sets/${r.study_set_id}/edit` without `#questionId` or role check.

---

### `FUNC-17` (P1) — Cross-Account Local Checkpoint Key Leak (`owner_id`) & Broken `?fresh=1` Checkpoint Restart Contract
- **Route / File / Component:** `src/components/learning/FlashcardsClient.tsx:368, 400`, `LearnClient.tsx:370, 530, 2166`, `SpellModeClient.tsx:271, 458`, `src/components/analytics/dashboard-view.tsx:167, 398-402`, `src/components/library/study-set-hub.tsx:197`
- **Reproduction Steps:**
  1. **Cross-account leak:** User A owns a shared set and studies Flashcards/Learn/Spell on a shared browser (writes `studyhub-v3-checkpoint:<owner_id>:...`). User B signs in on the same browser and opens User A's shared set -> User B reads/overwrites User A's `localStorage` checkpoint because the key uses `bundle.studySet.owner_id` instead of User B's authenticated `userId`!
  2. **Broken `?fresh=1` contract:** Both `/dashboard` (`dashboard-view.tsx:167, 398-402`) and `/sets/[id]` (`study-set-hub.tsx:197`) emit `?fresh=1` on "Bắt đầu lại" (Restart) and delete ONLY the server checkpoint (`DELETE /api/checkpoints`), never calling `clearLocalCheckpoint(...)`. Repo-wide grep confirms **ZERO** learning modes read `?fresh=1`, so any mode with a local checkpoint newer than null resurrects the old local checkpoint (e.g., on Learn/Spell or when navigating before remote clear).
- **Evidence:** Exact code inspection (`bundle.studySet.owner_id` passed as `userId` to `loadLocalCheckpoint`/`saveLocalCheckpoint`/`ResetProgressDialog`) and repo-wide grep confirming `fresh=1` is written only in `dashboard-view.tsx:167` and `study-set-hub.tsx:197` and read nowhere.
- **Suspected Root Cause:** Misuse of `bundle.studySet.owner_id` instead of current authenticated user ID (`pwa.activeUserId` / `profile.id`), and unimplemented `?fresh=1` query param handling + missing `clearLocalCheckpoint` on Restart/Discard.

---

### `FUNC-18` (P1) — Exam Runner, Timer, Preferences & Mutation Double-Click Race Conditions
- **Route / File / Component:**
  - `src/components/exam/LiveExamRunner.tsx:346, 464` & `TestHubClient.tsx:58`
  - `src/components/exam/ExamTimer.tsx:98`
  - `src/lib/preferences/index.tsx:405-409, 475-558`
  - `src/components/exam/ExamResultsClient.tsx:462, 506, 558`, `CoverageCyclesSection.tsx:78-174`, `CustomPracticeClient.tsx:556`, `FlashcardsClient.tsx:464`, `create-set-form.tsx:108`
- **Reproduction Steps & Root Causes:**
  1. **`LiveExamRunner` prop reuse:** `TestHubClient.tsx:58` renders `<LiveExamRunner attemptId={activeAttemptId} />` without `key={activeAttemptId}`, and `initializedAnswersRef` (`LiveExamRunner.tsx:346`) never resets when `attemptId` changes — switching between attempts reuses stale answers from Attempt 1.
  2. **Out-of-order autosave error overwrite:** In `LiveExamRunner.tsx:464`, if an earlier `PUT` fails after a newer `PUT` succeeded and emptied `dirtyQueueRef`, the stale `.catch()` overwrites `syncStore` to `"error"`.
  3. **Timer sleep/expiry auto-submit lockup:** In `ExamTimer.tsx:98`, `expiredTriggeredRef.current = true` is set permanently before calling `onExpire()`; if auto-submit fails on wake from sleep due to transient offline/503, the timer never retries.
  4. **`PreferencesProvider` stale closure & login sync gap:** `updatePreferences` (`src/lib/preferences/index.tsx:405-409, 475-558`) captures stale `preferences` without a monotonic request guard (rapid toggle A then B allows stale response A to overwrite B), never updates `["current-profile"].preferences` cache, and never syncs `initialPreferences` (`language`/`theme`) into `I18nProvider`/`next-themes` on fresh browser login.
  5. **Missing synchronous ref guards on mutations:** Rapid double-clicking Retake/Continue (`ExamResultsClient`), Next Exam/Restart (`CoverageCyclesSection`), Start Practice (`CustomPracticeClient`), Rate Card (`FlashcardsClient`), or Create Set (`create-set-form.tsx:108`) before React commits disabled state can fire duplicate POST requests / double SM-2 updates.
- **Evidence:** Line-verified across each listed file during static + stress audit.

---

### `FUNC-19` (P1) — `OfflineStudyRunner` Breaks Image-Only Options, V3 Structured Types, Multi-Diagram Sets, Diagram Coordinates, & Has Rapid-Click Races
- **Route / File / Component:** `/offline` · `src/components/pwa/OfflineStudyRunner.tsx:159, 218-224, 272-304, 357-382, 906-942`
- **Reproduction Steps:**
  1. Download a set containing `image_choice` (image-only options), `ordering`/`matching`/`fill_in_blank`/`image_hotspot`, `numerical` (`unit_required: true`), and 2 diagrams.
  2. Disconnect network, open `/offline`, and study the downloaded set.
- **Expected Behavior:** Option images render; V3 structured types & multi-select work; users can pick between all downloaded diagrams with accurate hit coordinates; rapid clicks don't duplicate offline sync events.
- **Actual Behavior:**
  - `OfflineStudyRunner.tsx:938-940` never renders `opt.image_url` — `image_choice` options appear completely blank (`"A."`, `"B."`, `"C."`).
  - `line 907` only checks `question_type === "multiple_choice"`, breaking multi-select V3 choice types; `ordering`/`matching`/`fill_in_blank`/`image_hotspot` are unsupported offline.
  - `line 287` auto-injects `unit: currentQuestion.type_payload.unit` for `numerical`, bypassing `unit_required`.
  - `line 159` hardcodes `bundle?.diagrams[0]` with no diagram selector (diagrams 2..N unreachable), `line 361` normalizes clicks against the container `div` instead of the `<img>`, and `handleDiagramClick` never records offline progress.
  - `switchMode` (`line 218`) has no async race guard and fails to restore `correctCount`; `handleCheckAnswer` (`line 272`) has no synchronous double-click guard (can enqueue duplicate `sync_queue` events).
- **Evidence:** Direct code-flow inspection of `OfflineStudyRunner.tsx` lines `159, 218-224, 272-304, 357-382, 906-942`.

---

### `FUNC-20` (P1) — `ReviewMistakesClient` Omits 3 Active Filters From React Query Key & Leaks Non-Exam Mistakes Under Exam Attempt Filter
- **Route / File / Component:** `/review` · `src/components/learning/ReviewMistakesClient.tsx:134-148, 269-275`
- **Reproduction Steps:**
  1. Open `/review`, expand Advanced Filters, and change Subject, Tag, or Minimum Consecutive Wrong count.
  2. Filter by a specific Exam Attempt (`selectedExamAttemptId !== "all"`) when the user also has practice/write mistakes (`recent_exam_attempt_id: null`).
- **Expected Behavior:** Changing Subject/Tag/Min-Consecutive-Wrong refetches immediately; filtering by an exam attempt shows ONLY mistakes from that exam attempt.
- **Actual Behavior:** `selectedSubject`, `selectedTagId`, and `minConsecutiveWrong` are passed to `fetchMistakes()` but omitted from `queryKey` (`lines 134-148`), so React Query returns stale cached data when those filters change. Additionally, `lines 269-275` do not exclude rows where `recent_exam_attempt_id === null` when an exam attempt filter is selected.
- **Evidence:** Direct inspection of `ReviewMistakesClient.tsx:134-148, 269-275`.

---

### `FUNC-21` (P1) — PDF Export Silently Drops All WebP & GIF Images (Including Auto-Compressed StudyHub Uploads!) and Omits V3 Structured Exam Answers
- **Route / File / Component:** `POST /api/export/pdf` · `src/app/api/export/pdf/route.ts:141-147, 268`, `src/lib/media/validation.ts:726-731`
- **Reproduction Steps:**
  1. Upload a >1.5 MB PNG image via `MediaAttachmentEditor` (automatically re-encoded to `image/webp` by `optimizeImageForUpload` at `validation.ts:729-730`) or upload a WebP/GIF image to a question.
  2. Export the study set or an exam attempt containing V3 structured answers (`numerical`, `ordering`, `matching`, `fill_in_blank`, `image_hotspot`) to PDF (`paper_with_explanations` or `incorrect_review`).
- **Expected Behavior:** Embedded images appear in the PDF (or transcode/warn honestly), and the student's submitted structured answers appear in exam PDF review modes.
- **Actual Behavior:** `export/pdf/route.ts:143` silently drops every non-PNG/JPEG image (`check.mime !== "image/png" && check.mime !== "image/jpeg"` -> returns `null` with no placeholder/warning), and `line 268` sets `userResponseText: selectedLabels || userAnswer?.typed_answer || null`, completely ignoring `userAnswer?.structured_response`.
- **Evidence:** Verified in `src/app/api/export/pdf/route.ts:141-147, 268` and `src/lib/media/validation.ts:726-731`.

---

## 5. P2 Bugs — UX, Mobile Ergonomics, Error States & Carried-Over V3.1 Polish

### `FUNC-22` (P2 — V3.1 `UX31-11` Carryover) — Learn Mode 5 SM-2 Stage Tabs Remain Too Prominent, Sub-44px (`32px`), & Discard Session Progress Without Confirmation
- **Route / File / Component:** `/sets/[id]/learn` · `src/components/learning/LearnClient.tsx:1286-1300`
- **Reproduction Steps:** Open `/sets/[id]/learn` on desktop or `360px` mobile; observe the top 5 buttons (`Làm quen | Ghi nhớ | Thành thạo | Ôn tập | Luyện thi`), answer several questions, then tap another stage button.
- **Expected Behavior:** Stage/goal selection is tucked cleanly into the Goal & Filter popover/sheet (not a 5-tab bar dominating Screen 1), meets `>=44px` touch target height, and warns before discarding active round progress.
- **Actual Behavior:** All 5 stage buttons sit prominently above the card at `32px` height (`h-8`, below 44px WCAG/HIG target), and clicking any button immediately resets active round progress without confirmation.
- **Evidence (Verified Live on Production & Local):** `learnTopButtons` measured `{ text: "Làm quen".."Luyện thi", h: 32 }`; screenshot [`docs/audit/v3.2-stability/screenshots/func-tester/live-p0-learn-object-object.png`](./screenshots/func-tester/live-p0-learn-object-object.png).

---

### `FUNC-23` (P2 — V3.1 `UX31-13` Carryover) — Question Editor Modal Control Density & Developer Jargon
- **Route / File / Component:** `/sets/[id]/edit` · `src/components/editor/question-editor-view.tsx`
- **Reproduction Steps:** Open `/sets/[id]/edit` and click **Thêm câu hỏi**.
- **Expected Behavior:** Progressive disclosure keeps core prompt + answer fields cleanly above the fold with a sticky Save footer and plain student-friendly copy.
- **Actual Behavior:** The default single-choice dialog mounts **`19` form controls** and **`16` buttons** inside a `984px` tall scroll container (viewport `808px`), pushing Explanation, Hint, Tags, and the primary Save button below the fold, and exposes technical jargon in the subtitle: `"Hỗ trợ đầy đủ 13 dạng câu hỏi V3, định dạng phong phú + LaTeX (KaTeX) và bảo toàn mã định danh đáp án cũ."`
- **Evidence (Verified Live on Local Prod Build `:3031`):** `modalDensity: { inputs: 19, buttons: 16, scrollHeight: 984, clientHeight: 808 }`; screenshot [`docs/audit/v3.2-stability/screenshots/func-tester/editor-modal-density.png`](./screenshots/func-tester/editor-modal-density.png).

---

### `FUNC-24` (P2) — Sub-44px Mobile Touch Targets Across Key Authenticated Routes (`320px–430px`)
- **Route / File / Component:** Multiple authenticated routes (measured live at `320, 360, 375, 390, 412, 430px`)
- **Evidence (Live Playwright DOM Measurements at `360×844`):**

| Route | Horizontal Overflow (`320–768px`) | Visible Controls `<40px` at `360px` | Notable Undersized Controls (`w×h`) |
| :--- | :---: | :---: | :--- |
| `/` (Landing) | `0px` | 5 | Brand link (`116×38`), inline footer links (`h: 16`) |
| `/dashboard` | `0px` | 9 | New Set icon link (`36×40`), Brand link (`116×32`), Study/Open card buttons (`h: 32`) |
| `/library` | `0px` | 13 | Card Star & More `icon-sm` buttons (`32×32`), compact action buttons (`h: 32–36`) |
| `/sets/[id]/edit` | `0px` | **20** | Row checkboxes (`16×16`), Edit/Delete icon buttons, inline controls |
| `/sets/[id]/learn` | `0px` | 1–5 | Stage tabs (`h: 32`) |
| `/sets/[id]/practice` | `0px` | 3 | `Tùy chỉnh` (`36×36`), `Câu hỏi` (`88×36`), `Hoàn thành` (`92×36`) |
| `/exams/new` | `0px` | **31** | Source checkboxes (`16×16`), `Chọn tất cả` (`82×36`), `Bỏ chọn` (`63×36`) |
| `/exams/[id]/results` | `0px` | 8 | All 7 breakdown & filter `TabsTrigger`s (`h: 36`) |
| `/review` | `0px` | 10 | 5 `Switch` controls (`36×20`), filter `TabsTrigger`s (`h: 36`) |
| `/settings` | `0px` | **18** | All 5 settings `TabsTrigger`s (`h: 36`), `Switch` controls (`36×20`) |
| `/offline` | `0px` | **0** | All interactive controls `>=40px` (cleanest mobile ergonomics) |

- **Suspected Root Cause:** Shared `TabsTrigger` (`h-9` = 36px), `Checkbox` (`size-4` = 16px without `44×44` hit wrapper), `Switch` (`36×20`), `Button size="icon-sm"` (`32×32`), and `h-8` action buttons across mobile views.

---

### `FUNC-25` (P2) — Image Hotspot Pin Visual Offset on Short/Letterboxed Images & Missing Signed-URL `onError` Recovery
- **Route / File / Component:** `src/components/exam/V3ExamQuestionBody.tsx:691-733`, `src/components/learning/LearnClient.tsx:1988-2019`, `src/components/media/MediaGallery.tsx:169`, `src/components/media/ImageLightbox.tsx:503`
- **Reproduction Steps:** Render an `image_hotspot` question whose image is shorter than `min-h-48` (`192px`) or narrower than its container, and click on the image; also view any private `study-media` image after its 1-hour signed redirect expires.
- **Expected Behavior:** Hotspot pins align pixel-accurately with clicked image coordinates, and expired/failed media displays a retryable fallback state instead of a broken-image icon.
- **Actual Behavior:** Click coordinates normalize against `img.getBoundingClientRect()` while pins are `position: absolute` relative to the larger parent `div` (`min-h-48`), visibly offsetting pins away from the click point. Meanwhile, `MediaGallery`, `ImageLightbox`, and `ZoomableImage` attach no `onError` retry/fallback handler.
- **Suspected Root Cause:** Wrapper `div` uses `min-h-48` + flex centering instead of a tight `inline-block relative` wrapper directly matching the `<img>` box; no `onError` handler on `<img>` tags.

---

### `FUNC-26` (P2) — Error-vs-Empty/Not-Found Conflation, Client-Only Library Favorites Filter, & Missing Bulk `content_version` Bump
- **Route / File / Component:**
  - `src/components/library/folder-detail-view.tsx:143`
  - `src/components/editor/ReportsInboxPanel.tsx:119-133`
  - `src/components/library/library-view.tsx:170-189, 327-338`
  - `src/app/api/sets/[id]/questions/bulk/route.ts:224-367`
- **Actual Behavior:**
  1. `FolderDetailView` checks `if (!folder)` before checking `foldersQuery.error`/`setsQuery.error`, falsely showing **"Không tìm thấy thư mục"** on 500/offline errors instead of an Error state with Retry.
  2. `ReportsInboxPanel` never handles `reportsQuery.error`, showing **"Không có báo cáo nào"** on 403/500/offline failure.
  3. `LibraryView` filters `favoritesOnly` client-side on the current page (`PAGE_SIZE = 48`) instead of sending `favoritesOnly=true` to `/api/sets`, so favorites on page 2+ disappear behind an empty state and pagination totals remain unfiltered.
  4. `PATCH` and `DELETE` in `/api/sets/[id]/questions/bulk` forget to bump `study_sets.content_version` (unlike `POST`), so offline devices checking for updates miss bulk edits/deletes.

---

### `FUNC-27` (P2) — Import Hub Missing `.pdf` Support & >1.5 MB DOCX Preview Thumbnails Stripped
- **Route / File / Component:** `/import` (`src/components/library/import-hub-view.tsx:96, 125, 171`), `src/app/api/import/parse/route.ts:365-385`, `src/components/import/VirtualizedPreviewList.tsx:730-743, 1108`
- **Actual Behavior:**
  1. `/import` file picker `accept=".docx,.xlsx,.csv,.tsv,.txt,.json"` omits `.pdf`, throws away the selected file when creating & redirecting to `/sets/[id]/import` (forcing double file pick), and omits React Query invalidation for `["study-sets"]`/`["dashboard"]`.
  2. For DOCX files with >1.5 MB total embedded images, `POST /api/import/parse` strips `dataUrl` in favor of `tempStoragePath`, causing `MediaPreviewChip` (`VirtualizedPreviewList.tsx:730-743`) to render blank gray icon boxes instead of thumbnails — making "Kiểm tra ảnh nổi" (review floating image placement) impossible. Also `"Move to Q#..."` hard-caps at `200` questions (`line 1108`).

---

### `FUNC-28` (P2) — Exam Results `Clone Attempt` Drops Configuration & `PracticeClient` Async Session / Auto-Next Races
- **Route / File / Component:** `src/components/exam/CustomExamBuilderClient.tsx:389-426`, `src/components/learning/PracticeClient.tsx:306-322, 518, 794`
- **Actual Behavior:**
  1. Launching `/exams/new?cloneAttemptId=<id>` from Exam Results drops `question_count`, `filters`, `shuffle_options`, and `allow_navigation`.
  2. In `PracticeClient`, starting/restarting sessions has no cancellation/nonce guard on `createStudySession` (slow previous response can overwrite `sessionIdRef`), and clicking **Tùy chỉnh** does not cancel a pending `autoNextTimerRef`.

---

### `FUNC-29` (P2) — Locale `<title>` Drift, Unlocalized Login Errors, Premature Logout Offline Wipe, & Safari WebKit WebP Fallback Mismatch
- **Route / File / Component:**
  - `src/app/providers.tsx:85-144`
  - `src/components/auth/login-form.tsx:140-149`
  - `src/components/layout/app-shell.tsx:303-305`
  - `src/lib/media/validation.ts:734-752`
- **Actual Behavior:**
  1. **EN `<title>` drift (Verified Live):** `resolveLocalizedTitle` returns `null` for `/sets/[id]` and `/folders/[id]`, leaving `document.title === "Chi tiết học phần | StudyHub"` while `html.lang === "en"` (`p2_setDetailTitleInEn`).
  2. **Unlocalized login errors:** `login-form.tsx` only translates `"Invalid login credentials"`; `"Email not confirmed"`, `"Too many requests"`, and `"Failed to fetch"` leak raw English in VI mode (unlike `register-form.tsx`).
  3. **Logout order bug:** `app-shell.tsx:303-305` calls `clearOfflineDataForLogout()` **before** `fetch("/auth/signout")`, never checks `response.ok`, and never clears `studyhub-user-preferences` or `studyhub-v3-checkpoint:*`.
  4. **Safari/WebKit `canvas.toBlob("image/webp")` hazard:** When Safari ignores `"image/webp"` and returns a PNG blob (`blob.type === "image/png"`), `validation.ts:747-752` still names the file `.webp` with `type: "image/webp"`.

---

## 6. P3 Bugs — Minor Polish

### `FUNC-30` (P3) — Settings First-Toggle Sound Preview Stale Closure & Starred Questions Missing V3 Correct-Answer Display
- **Route / File / Component:** `src/components/layout/settings-view.tsx:716`, `src/components/learning/StarredQuestionsClient.tsx:341-349`
- **Actual Behavior:** Toggling Sound Effects from `false -> true` calls `playSound("correct")` reading the stale `preferences.sound_enabled === false` closure, so no preview chime plays on first enable. On `/starred`, V3 structured questions and image-only options display no correct-answer summary block.

### `FUNC-31` (P3) — Minor Offline Panel Double-Click & Crop-Editor Signed-URL Fetch Polish
- **Route / File / Component:** `src/components/pwa/OfflineManagerPanel.tsx:213-255`, `src/components/media/MediaAttachmentEditor.tsx:432`
- **Actual Behavior:** `OfflineManagerPanel` relies on React state rather than a ref lock for `handleSyncNow`/`handleRemoveSet`; `MediaAttachmentEditor.openCropDialog` fetches `item.url` without cache-bust retry if the signed URL expired while the editor tab stayed open >1 hour.

---

## 7. Prioritized Fix Recommendations for Wave 2

1. **Immediate P0 Blockers:**
   - Include `structured_response`, `confidence`, and `hint_used` in `GET /api/exams/[attemptId]` in-progress mapping (`FUNC-01`) + update fallback breakdown helpers.
   - Map `expected.map((a) => a.answer_text).join(" / ")` in `LearnClient.tsx:830` & `ReviewMistakesClient.tsx:649`, and format V3 `type_payload` correct answers in `/review` (`FUNC-02`).
   - Write exam drafts synchronously to `localStorage` on every answer mutation, flush pending `PUT` on `pagehide`/`visibilitychange` (`keepalive: true`), and trigger `flushDirtyQueue()` whenever `dirtyQueueRef` is populated after `examQuery.data` resolves (`FUNC-03`, `FUNC-04`).
   - Upgrade Backup & Restore to `studyhub-v3` preserving all V3 question/option columns, passages, diagrams, and notes (or surface an explicit versioned scope disclosure & align 15 MB/12 MB limits) (`FUNC-05`).
2. **High-Value Stability & UX Wins (P1/P2):**
   - Fix Fill-in-the-Blank controlled input trimming & stable row key (`FUNC-06`), Full Coverage `question_id IS NULL` auto-completion (`FUNC-07`), single `?` shortcut dialog + shared modal/IME/preference keyboard guard (`FUNC-11`), `ImportWizard` & Editor React Query invalidations (`FUNC-12`), Settings tab URL sync (`FUNC-15`), `viewer` guard on `/edit` (`FUNC-16`), and authentic `userId` checkpoint keying + `?fresh=1` handling (`FUNC-17`).
   - Bring Practice, Learn, Exam, Offline, and PDF Export to full 12-type parity (`FUNC-08`, `FUNC-09`, `FUNC-10`, `FUNC-19`, `FUNC-21`), wire up `mode_preferences` (`FUNC-14`), and resolve V3.1 UX carryovers + mobile `>=44px` touch targets (`FUNC-22`, `FUNC-23`, `FUNC-24`).
