# StudyHub V3.2 — Wave 6 Functional & E2E Test Matrix (`TEST_MATRIX.md`)

> **Auditor:** Agent 6 — Independent Functional Tester (`func-tester-2`, zero edits to `src/*`, `supabase/*`, or `tests/*`)  
> **Target:** `http://127.0.0.1:3051` (reusing compiled Wave 6 `.next` build on `release/v3.2-stability`) + live Supabase Cloud  
> **Test Run Date:** 2026-11-25

---

## 1. Full Existing Playwright E2E Suite Results (`npx playwright test --workers=1`)

Executed against `http://127.0.0.1:3051` (`PLAYWRIGHT_SKIP_WEBSERVER=1`, `PLAYWRIGHT_EXPECT_PROD=1`, `E2E_SUPABASE_READY=1`) with fresh disposable accounts (`v32-w6-func-e2e6ba-*` & `v32-w6-func-e2e6bb-*`):

| Metric | Wave 6 (Initial) | Wave 6B (Final) |
| :--- | :---: | :---: |
| **Total Tests** | 22 | **22** |
| **Passed** | 20 | **22 (100%)** |
| **Failed** | 2 (`V3-T1`, `V3-T6`) | **0** |
| **Skipped** | 0 | **0** |
| **Blocked** | 0 | **0** |

| # | Spec File | Test Name | Wave 6B Duration | Final Status | Notes |
| :-: | :--- | :--- | :---: | :---: | :--- |
| 1 | `authenticated-journey.spec.ts` | Scenario 1: Core study, Folder/Set CRUD, 50-Q import, 5 modes, timed exam anti-leak + F5 reload, Settings, Sharing & 2-account RLS isolation | 44.4s | **PASS** | — |
| 2 | `authenticated-journey.spec.ts` | Scenario 2: Universal Custom Exam Builder (`/exams/new`), Multi-Subject Strategies, Presets, F5 Reload & Mixed-Subject Results | 19.7s | **PASS** | — |
| 3 | `authenticated-journey.spec.ts` | Scenario 3: Full Coverage / No-Repeat Cycle (`10Q -> 5 + 5`, ZERO overlap, 100% completion) | 15.9s | **PASS** | — |
| 4 | `studyhub.spec.ts` | HTTP security headers & production CSP hygiene on landing page (`PLAYWRIGHT_EXPECT_PROD=1`) | 28ms | **PASS** | — |
| 5 | `studyhub.spec.ts` | API health & EduQuiz import template endpoints | 36ms | **PASS** | — |
| 6 | `studyhub.spec.ts` | Public & auth pages render cleanly with semantic `<h1>` and zero uncaught errors | 4.0s | **PASS** | — |
| 7 | `studyhub.spec.ts` | Custom 404 page renders localized StudyHub `NotFoundView` | 898ms | **PASS** | — |
| 8 | `studyhub.spec.ts` | Light/Dark theme toggle, VI/EN language toggle, `<title>`, and skip link localization | 2.0s | **PASS** | — |
| 9 | `studyhub.spec.ts` | Protected V1 & V2 routes redirect cleanly to `/login` without 503 storms | 5.8s | **PASS** | — |
| 10 | `studyhub.spec.ts` | `prefers-reduced-motion` renders cleanly without hiding interactive content | 1.0s | **PASS** | — |
| 11 | `studyhub.spec.ts` | Viewport `small-mobile-360` (`360×800`) zero overflow & accessible focus | 2.7s | **PASS** | — |
| 12 | `studyhub.spec.ts` | Viewport `mobile-390` (`390×844`) zero overflow & accessible focus | 2.7s | **PASS** | — |
| 13 | `studyhub.spec.ts` | Viewport `tablet-portrait-768` (`768×1024`) zero overflow & accessible focus | 2.8s | **PASS** | — |
| 14 | `studyhub.spec.ts` | Viewport `laptop-1024` (`1024×768`) zero overflow & accessible focus | 2.8s | **PASS** | — |
| 15 | `studyhub.spec.ts` | Viewport `desktop-1440` (`1440×900`) zero overflow & accessible focus | 2.8s | **PASS** | — |
| 16 | `studyhub.spec.ts` | Viewport `desktop-1920` (`1920×1080`) zero overflow & accessible focus | 2.7s | **PASS** | — |
| 17 | `v3-complete-learning.spec.ts` | **V3-T1:** PWA manifest/icons, SW no-store, `/offline`, `?` Shortcut Help Modal & Settings Mode Preferences persistence | 6.1s | **PASS** | Fixed in Wave 6B (`V32-026` / `FUNC-15` synchronous optimistic tab state in `settings-view.tsx`). |
| 18 | `v3-complete-learning.spec.ts` | **V3-T2:** Multimedia PNG/WAV uploads, Rich Text + KaTeX, Image-only Options, Image Lightbox, DOCX V3 media preview & PDF text vs scanned detection | 11.0s | **PASS** | — |
| 19 | `v3-complete-learning.spec.ts` | **V3-T3:** All 12 Question Types live exam scoring + Confidence Neutrality, Bulk Edit, `Ctrl+K` Search & Hard Exam Guard, 2-Account Notes/Reports & Vietnamese PDF Export | 23.6s | **PASS** | — |
| 20 | `v3-complete-learning.spec.ts` | **V3-T4:** Spell Mode, Audio Flashcards, Advanced Learn, Review Mistakes, Resume Checkpoint across F5 & Scoped Reset Progress preserving Exam History | 16.6s | **PASS** | — |
| 21 | `v3-complete-learning.spec.ts` | **V3-T5:** Visual Diagram Mode (`/sets/[id]/diagrams`, `/diagrams/[id]/edit`, `/diagrams/[id]/study`) + Mobile 390px & 2-Account RLS | 14.1s | **PASS** | — |
| 22 | `v3-complete-learning.spec.ts` | **V3-T6:** True Offline PWA (`Download -> setOffline(true) -> Offline Study -> Refresh Offline -> setOffline(false) -> Sync Queue -> Account-Switch IDB Isolation`) | 13.3s | **PASS** | Selector aligned to V3.2 1-click auto-download in Wave 6B; full offline & account-switch IDB isolation passed end-to-end. |

---

## 2. Independent Issue-by-Issue Retest Matrix (28 Functional Issue IDs)

| Issue ID | Source IDs | Severity | Verification Method | Wave 6 Status | Evidence Summary |
| :--- | :--- | :---: | :--- | :---: | :--- |
| **`V32-002`** | `FUNC-01`, `SEC-07` | P0 | Live API + Chromium Exam Runner | **PASS** | Pre-submit `GET` restores `structured_response`, `confidence`, `hint_used` (0 key leaks); Flag toggle preserves `9.8 m/s2` (`client_seq: 3`); post-submit `is_correct: true`. |
| **`V32-003`** | `FUNC-02` | P0 | Live Chromium Learn, `/review`, `/starred` | **PASS** | Zero `[object Object]`; displays `"H2O"` and `"9.8 m/s2"` cleanly across Learn, `/review`, and `/starred`. |
| **`V32-004`** | `FUNC-03` | P0 | Live Chromium Immediate Reload (`0ms` delay) | **PASS** | Immediate fast reload preserves Q1 selection in synchronous `studyhub-exam-draft-v3`, UI (`aria-checked="true"`), and server DB. |
| **`V32-005`** | `FUNC-04` | P0 | Live Chromium Offline -> Online -> Reload | **PASS** | Shows `"Ngoại tuyến"` while offline; reconnect + reload auto-flushes immediately (`autoFlushPuts: 2`, DB `savedCount: 1`, badge -> `"Đã lưu"`). |
| **`V32-006`** | `FUNC-05` | P0 | Live Backup & Restore + `>15 MB` test | **PASS** | `studyhub-v3` + honest `backup_scope`; restores V3 `type_payload`, `prompt_rich`, `audio_url`, remapped passages/diagrams/hotspots & notes; `>15 MB` -> `413`. |
| **`V32-007`** | `RU-01` | P0 | Live Chromium Practice Exit/Resume & `?fresh=1` | **PASS** | Exit at `3 / 14` -> Resume restores `3 / 14`; `?fresh=1` restarts cleanly at `0 / 14`. |
| **`V32-010`** | `FUNC-07` | P1 | Live Mid-Cycle Delete + 500Q + Multi-Subject | **PASS** | Mid-cycle delete auto-completes (`status: "completed"`, `remaining: 0`); `500Q -> 250+250` & `120×4+20` (`0` overlap); Equal `[20,35,35]`, Prop `[10,25,65]`, Custom `[10,20,30]`. |
| **`V32-011`** | `DB-01`, `DB-02` | P1 | Live Concurrent Star, Sync Dedup, Note 409 | **PASS** | Concurrent Star `[201,200]`; `sync/events` in-batch & replay `duplicate_ignored`; `PUT /api/notes` stale `base_version` -> `409 CONFLICT` w/ `server_note`. |
| **`V32-012`** | `DB-04`..`07`, `11` | P1 | Live API (`favoritesOnly`, `mistakes`, `questions`) | **PASS** | Server-side `favoritesOnly=true`, `mistakes` exam attempt filter, and `questions` endpoint verified live. |
| **`V32-013`** | `SEC-02/03`, `FUNC-29(3)` | P1 | Live UI Sign-Out on `127.0.0.1:3051` | **PASS** | `Accept: application/json` -> `200` (`private, no-store`), `0` leftover user `localStorage` keys incl. `known-users`; non-JSON -> `303 Location: /login`. |
| **`V32-018`** | `PERF-05`, `DB-10`, `SEC-12` | P1 | Live Multi-Chunk Staged DOCX + Dedup | **PASS** | Chunk 1 (`isFinalChunk: false`) preserves shared `tempStoragePath` -> Chunk 2 (`isFinalChunk: true`) succeeds with images on both rows; SHA-256 upload dedup PASS. |
| **`V32-019`** | `FUNC-06` | P1 | Live Chromium Question Editor Fill-in-Blank | **PASS** | Typing `"Ha Noi"` retains space (`"Ha Noi"`); typing `"blank_1"` into `Mã ô trống 1` keeps value & input focus. |
| **`V32-020`** | `FUNC-08` | P1 | Live Chromium Practice & `/practice?count=20` | **PASS** | Renders `reading_passage`, `listening` audio, `ordering`, `fill_in_blank` (2 inputs), `numerical`, `image_hotspot`; `/practice?mode=mistakes&count=20` honors `20`. |
| **`V32-021`** | `FUNC-09` | P1 | Live Chromium Learn Mode | **PASS** | Multi-select `image_choice` does not auto-submit on 1st click; matching/hotspot/numerical fixes verified. |
| **`V32-022`** | `FUNC-10`, `RU-08` | P1 | Live Chromium Exam Runner (All 12 Types) | **PASS** | Q1 DOCX image dedup (`1` `<img>`); `listening+fill_in_blank` blank input (`0` textarea); `ordering` Confirm button; `numerical` optional `hPa` badge & masked required placeholder. |
| **`V32-023`** | `FUNC-11` | P1 | Live Chromium Active Exam Shortcuts | **PASS** | `?` opens strictly `1` modal; `1` `Escape` closes it; `ArrowRight` blocked behind modal; `Ctrl+K` blocked (`0` dialogs). |
| **`V32-024`** | `FUNC-12`, `FUNC-13` | P1 | Live SPA Import -> Set + Replay `importJobId` | **PASS** | Immediate SPA return to `/sets/[id]` shows `3 câu hỏi` (`0` stale `0 câu hỏi`); idempotent replay recovers original `importJobId`. |
| **`V32-025`** | `FUNC-14` | P1 | Live Spell (`reducedMotion`) + Wiring Audit | **PASS** | All 6 study modes read `preferences.mode_preferences`; Spell shows confidence controls & enables audio under `prefers-reduced-motion: reduce`. |
| **`V32-026`** | `FUNC-15`, `FUNC-16` | P1 | Live Chromium Settings Tabs + 2-Account RBAC | **PASS (Wave 6B)** | `FUNC-16` Viewer RBAC **PASS** (`0` Add/Delete buttons). Wave 6B `FUNC-15` retest **PASS**: immediate 0ms Tab 2 click mounts `#mp-fc-audio`, persists `mode_preferences.flashcards.auto_play_audio: true` across reload (Tab 1 untouched), `/settings?tab=offline` deep link & Back/Forward sync cleanly, and `V3-T1` **PASS**. |
| **`V32-027`** | `FUNC-17`, `RU-02`, `RU-06` | P1 | Live Checkpoints + `?fresh=1` + Exam F5 | **PASS** | Checkpoints keyed by authenticated `userId`; `?fresh=1` resets cleanly; Exam F5 restores `Câu 5 / 6`. |
| **`V32-028`** | `FUNC-18` | P1 | Live Rapid-Click / Double-Submit Stress | **PASS** | 10× A/B alternating -> `1` `PUT` w/ exact final choice; Create Set (`1` POST); Launch Exam (`1` POST); rapid Prefs A+B both saved. |
| **`V32-029`** | `FUNC-19`, `RU-07`, `RU-19` | P1 | Live Chromium True Offline PWA (`setOffline`) | **PASS** | Download + `0` false `"Trực tuyến"` + `0` contradictory warning + `image_choice` images (`3`) + 2-diagram selector + offline `F5` survival + clean sync + `V3-T6` **PASS** (`13.3s`). |
| **`V32-030`** | `FUNC-20`, `FUNC-21` | P1 | Live `/review` Filters + PDF Export Matrix | **PASS (Wave 6B)** | `FUNC-20` `/review` filters **PASS**; post-submit V3+PNG/WebP PDFs (`841 KB`) & pre-submit `403` **PASS**; Wave 6B `FUNC-21b` retest **PASS**: `in_progress` `question_paper` PDF w/ `fill_in_blank`+`matching`+`image_hotspot`+`numerical`+`ordering` returns **`200 OK` (`841,078 B`, `%PDF-`, `zeroSecretLeak: true`)**. |
| **`V32-032`** | `FUNC-22`, `RU-11` | P2 | Live Chromium Learn Mode UI | **PASS** | `0` prominent 32px stage tabs, compact Goal popover visible, zero `"V3"` label. |
| **`V32-033`** | `FUNC-23`, `RU-10`, `RU-15` | P2 | Live Chromium Question Editor Modal & List | **PASS** | Sticky `"Lưu câu hỏi"` inside viewport, zero dev jargon, explicit row Edit buttons (`>=44px` mobile). |
| **`V32-034`** | `FUNC-24`, `RU-20` | P2 | Live 7-Width Mobile Sweep (`119` checks) | **PASS** | `0px` overflow across all 17 routes × 7 widths (`320..768px`), `0` buttons/tabs/switches/checkboxes `<40px` at `360px`/`390px`. |
| **`V32-035`** | `RU-12`, `RU-12b` | P2 | Live `320/360/390px` Mobile Practice Header | **PASS (Wave 6B)** | `0px` clip across `320/360/390px`, `44px` Finish height, single-line counter; Wave 6B `120Q` (`0/120`) verified `360×800` `"Xong"` (`300..352`, `0px` clip) & `390×844` `"Hoàn thành"` (`294..382`, `0px` clip). |
| **`V32-036`** | `FUNC-25` | P2 | Live Hotspot Box + Signed-URL `500` Retry | **PASS** | Hotspot wrapper `322×102` on `320×100` `<img>` (`heightDelta: 2px`); signed-URL `500` triggered 1-shot `&_r=` retry. |
| **`V32-037`** | `FUNC-26` | P2 | Live HTTP 500 Folder/Reports + Bulk CV + Favs | **PASS** | Folder & Reports show Error + Retry (not false empty/not-found); `favoritesOnly=true` server-filtered; bulk PATCH/DELETE bumps `content_version` (`3->4->5`). |
| **`V32-038`** | `FUNC-27`, `RU-13`, `RU-14` | P2 | Live `/import` Single-Pick PDF + Large DOCX | **PASS** | `/import` accepts `.pdf` & auto-parses single-picked PDF on `/sets/[id]/import`; `>1.5 MB` DOCX returns signed `previewUrl` thumbnails. |
| **`V32-039`** | `FUNC-28`, `RU-16` | P2 | Live Exam Results & `?cloneAttemptId=` | **PASS** | Shows `"câu sai & chưa làm"`, preserves cloned exam count & config cleanly. |
| **`V32-040`** | `FUNC-29(1,2,4)` | P2 | Live EN `<title>`, VI Login Error, Safari Code | **PASS** | EN `<title>` localized (`Study Set | StudyHub`, `Folder | StudyHub`); VI Login localizes `"Email not confirmed"`; `optimizeImageForUpload` Safari-safe JPEG/PNG. |
| **`V32-050`** | `FUNC-30`, `FUNC-31`, `RU-21` | P3 | Live `/starred` + Code Verification | **PASS** | `/starred` renders V3 `9.8 m/s2` cleanly; Settings sound uses `{ force: true }`; `OfflineManagerPanel` ref locks active. |

---

## 3. Question-Type Coverage Summary (All 12 Exam Types + Flashcard)

| Question Type | Practice (`/practice`) | Learn (`/learn`) | Live Exam (`/exams/[id]`) | Offline PWA (`/offline`) | Post-Submit PDF | In-Progress `question_paper` PDF |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| `single_choice` | PASS | PASS | PASS | PASS | PASS | PASS (`200`) |
| `multiple_choice` | PASS | PASS | PASS | PASS | PASS | PASS (`200`) |
| `true_false` | PASS | PASS | PASS | PASS | PASS | PASS (`200`) |
| `short_answer` | PASS | PASS | PASS | PASS | PASS | PASS (`200`) |
| `flashcard` | PASS | PASS | N/A (excluded) | PASS | PASS | N/A |
| `image_choice` | PASS | PASS | PASS | PASS | PASS | PASS (`200`) |
| `ordering` | PASS | PASS | PASS | PASS | PASS | PASS (`200`) |
| `matching` | PASS | PASS | PASS | PASS | PASS | **PASS (`200`, Wave 6B)** |
| `fill_in_blank` | PASS | PASS | PASS | PASS | PASS | **PASS (`200`, Wave 6B)** |
| `numerical` | PASS | PASS | PASS | PASS | PASS | PASS (`200`) |
| `image_hotspot` | PASS | PASS | PASS | PASS | PASS | **PASS (`200`, Wave 6B)** |
| `reading_passage` | PASS | PASS | PASS | PASS | PASS | PASS (`200`) |
| `listening` (+ `fill_in_blank`) | PASS | PASS | PASS | PASS | PASS | PASS (`200`) |
