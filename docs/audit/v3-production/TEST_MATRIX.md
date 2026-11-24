# StudyHub V3.0 — Live Production Functional & Regression Test Matrix (Phase 10)

> **Auditor:** Agent 4 — Independent Functional & Regression E2E Auditor (`func-tester`)
> **Target Environment:** **`https://studyhub-three-mauve.vercel.app`** (Vercel Hobby, Node.js `24.x`, region `iad1`, commit `2537345` → `646a565` / `dpl_CUxPSwsnAfqQCVcLf8shZZwbrQDQ`)
> **Backend:** Supabase Cloud (`cuoaifyupfmkstqhcjwy`, PostgreSQL `17.12`, Migrations `0001`–`0017`, `37/37` RLS tables, private `study-media` & `study-temp` buckets)
> **Audit Date:** 2026-11-24 / 2026-11-25
> **Localhost Substitution:** **NONE** — 100% of test executions ran directly against the live HTTPS production deployment `https://studyhub-three-mauve.vercel.app`.

---

## 1. Executive Summary

| Verification Suite | Scope | Passed | Pending | Failed | Result |
| --- | --- | ---: | ---: | ---: | --- |
| **Suite A:** Complete Playwright E2E Suite (`PLAYWRIGHT_EXPECT_PROD=1`) | V1/V2/V3 Auth, Library, 12 Question Types, All Modes, Diagrams, Sharing/RLS, 6 Viewports, HTTPS PWA Offline/Sync/IDB Isolation (`22` live browser tests) | **22 / 22** | 0 | 0 | **PASS** |
| **Suite B:** Live Vercel Hobby `> 4.5 MiB` Direct-to-Storage Upload Bypass (`study-temp`) | `5.05 MiB` WAV Audio, `4.76 MiB` PNG Image, `4.77 MiB` Multimedia DOCX (parse offload `import-media/` + commit to `study-media` + `0` temp leftovers) | **3 / 3** | 0 | 0 | **PASS** |
| **Suite C:** Live Production Scale (`500Q` Bank, `250Q` Timed Exam + F5, Full Coverage `500 -> 250+250`, Vietnamese PDF Export) | Chunked inserts (`0` 1,000-row truncation), proportional split (`150/100`), `0` key leaks, F5 refresh survival, `0` overlap / `500` union, streamed `%PDF-` + RFC 5987 | **4 / 4** | 0 | 0 | **PASS** |
| **Suite D:** Supabase Auth Dashboard URL Configuration & Live `/auth/confirm` Verification (Phase 7) | Default `Site URL`, all `4` allowlisted `Redirect URLs`, untrusted redirect fallback, live `GET /auth/confirm` (`recovery` + `magiclink`) `307` + `Cache-Control: no-store` + `sb-*` session cookie | **1 / 1** | **0** | 0 | **PASS** |
| **Combined Live Production Functional Matrix** | **30 / 30 Production Acceptance Cases Verified Live** | **30 / 30** | **0** | **0** | **PASS (100% VERIFIED)** |

---

## 2. Suite A — Complete 22-Test Playwright Suite on `https://studyhub-three-mauve.vercel.app`

Executed sequentially (`--workers=1`) with `PLAYWRIGHT_BASE_URL=https://studyhub-three-mauve.vercel.app`, `PLAYWRIGHT_EXPECT_PROD=1`, `E2E_SUPABASE_READY=1` against 2 freshly provisioned disposable accounts (`v3-prod-e2e-a/b-<ts>@studyhub-test.local`), with verified post-run teardown (`TRACKED_REMAINING users=0 study_media=0 study_temp=0`).

> **Determinism Note:** Pass 1 (`task-949`, `7.9m`) scored **`21 / 22 PASS`**; `V3-T4` caught a test-only shuffle determinism assumption where `FlashcardsClient` faithfully honored `default_shuffle_questions = true` (`button "Trộn thẻ" [pressed]`) and shuffled the single audio card out of index 0 (`2/3` probability). After updating `tests/e2e/v3-complete-learning.spec.ts` (lines `1280–1288`) to toggle shuffle off when active (zero production code edits), Pass 2 (`task-1009`, `3.5m`) scored **`6 / 6 PASS`** on `v3-complete-learning.spec.ts` (`EXIT_PLAYWRIGHT=0`, `0` skipped, `0` failed).

| ID | Spec & Test Name | Key Live Production Assertions Verified | Pass 1 | Pass 2 | Status |
| --- | --- | --- | --- | --- | --- |
| `PROD-E2E-01` | `authenticated-journey.spec.ts` — Scenario 1: Core study, Folder/Set CRUD, 50-Q import, 5 modes, timed exam anti-leak + F5 reload, Settings, Sharing & 2-account RLS | Folder/Set CRUD, 50-Q import wizard commit, Flashcards/Practice/Learn/Write/Match, timed exam zero pre-submit key leak + F5 reload, Settings persistence, share-link redeem (`Chỉ xem`), 2-account RLS isolation | `PASS (2.0m)` | — | **VERIFIED** |
| `PROD-E2E-02` | `authenticated-journey.spec.ts` — Scenario 2: Universal Custom Exam Builder (`/exams/new`), Multi-Subject Strategies, Presets, F5 Reload & Mixed-Subject Results | `/exams/new` multi-subject builder, allocation strategies, config-only presets CRUD, timed runner F5 survival, mixed-subject breakdown results | `PASS (1.2m)` | — | **VERIFIED** |
| `PROD-E2E-03` | `authenticated-journey.spec.ts` — Scenario 3: Full Coverage / No-Repeat Cycle (`10Q -> 5 + 5`) | 10Q cycle split into 5 + 5 exams, `0` overlap, `100%` completion, clean cascading user teardown (`0012`) | `PASS (40.9s)` | — | **VERIFIED** |
| `PROD-E2E-04` | `studyhub.spec.ts` — HTTP security headers & production CSP hygiene (`PLAYWRIGHT_EXPECT_PROD=1`) | HSTS, strict production CSP (`0` `unsafe-eval`, `0` `127.0.0.1`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Permissions-Policy` | `PASS (212ms)` | — | **VERIFIED** |
| `PROD-E2E-05` | `studyhub.spec.ts` — `/api/health` & EduQuiz template endpoints | `GET /api/health` `200` (`supabaseConfigured=true`), deterministic import templates `200` | `PASS (1.1s)` | — | **VERIFIED** |
| `PROD-E2E-06` | `studyhub.spec.ts` — Public & auth pages render cleanly with semantic `<h1>` and zero uncaught errors | `/`, `/login`, `/register`, `/forgot-password` clean DOM & `0` console/page errors | `PASS (7.4s)` | — | **VERIFIED** |
| `PROD-E2E-07` | `studyhub.spec.ts` — Custom 404 renders localized StudyHub `NotFoundView` | Localized 404 UI instead of raw Next.js fallback | `PASS (1.6s)` | — | **VERIFIED** |
| `PROD-E2E-08` | `studyhub.spec.ts` — Light/Dark theme toggle, VI/EN language toggle, `<title>` & skip link | Live theme class toggle, VI/EN UI switch, localized `<title>` & skip-to-content link | `PASS (2.6s)` | — | **VERIFIED** |
| `PROD-E2E-09` | `studyhub.spec.ts` — Protected V1 & V2 routes redirect cleanly to `/login` (`SH-026`) | Zero 503 storms, zero raw env-var leaks, deterministic `/login?next=...` redirect | `PASS (10.1s)` | — | **VERIFIED** |
| `PROD-E2E-10` | `studyhub.spec.ts` — `prefers-reduced-motion` renders cleanly without breaking interactive UI | Reduced-motion `<MotionConfig>` keeps all interactive controls accessible | `PASS (1.3s)` | — | **VERIFIED** |
| `PROD-E2E-11` | `studyhub.spec.ts` — Responsive & A11y: `small-mobile-360` (`360×800`) | `0px` horizontal overflow, accessible keyboard focus | `PASS (4.0s)` | — | **VERIFIED** |
| `PROD-E2E-12` | `studyhub.spec.ts` — Responsive & A11y: `mobile-390` (`390×844`) | `0px` horizontal overflow, accessible keyboard focus | `PASS (3.9s)` | — | **VERIFIED** |
| `PROD-E2E-13` | `studyhub.spec.ts` — Responsive & A11y: `tablet-portrait-768` (`768×1024`) | `0px` horizontal overflow, accessible keyboard focus *(see sibling `PROD-UX-01` P2 note in Regression Report)* | `PASS (4.0s)` | — | **VERIFIED** |
| `PROD-E2E-14` | `studyhub.spec.ts` — Responsive & A11y: `laptop-1024` (`1024×768`) | `0px` horizontal overflow, accessible keyboard focus | `PASS (3.9s)` | — | **VERIFIED** |
| `PROD-E2E-15` | `studyhub.spec.ts` — Responsive & A11y: `desktop-1440` (`1440×900`) | `0px` horizontal overflow, accessible keyboard focus | `PASS (4.0s)` | — | **VERIFIED** |
| `PROD-E2E-16` | `studyhub.spec.ts` — Responsive & A11y: `desktop-1920` (`1920×1080`) | `0px` horizontal overflow, accessible keyboard focus | `PASS (4.0s)` | — | **VERIFIED** |
| `PROD-E2E-17` | `v3-complete-learning.spec.ts` — `V3-T1`: PWA manifest/icons, SW `no-store`, `/offline`, `?` Shortcut Help Modal & Settings Mode Preferences persistence | `/manifest.webmanifest` `200`, `/sw.js` `no-cache, no-store, must-revalidate`, `/offline` `200`, `?` modal, Settings mode switch persistence across reload | `PASS (10.0s)` | `PASS (12.5s)` | **VERIFIED** |
| `PROD-E2E-18` | `v3-complete-learning.spec.ts` — `V3-T2`: Multimedia PNG/WAV uploads, Rich Text + KaTeX, Image-only Options, Lightbox, DOCX V3 media preview & PDF text vs scanned detection | Private `study-media` PNG/WAV proxy URLs, KaTeX rendering, `image_choice` in Practice/Set UI, fullscreen Lightbox, `docx_multimedia` extraction, live Vercel serverless `pdfjs-dist` text-layer vs scanned-PDF detection | `PASS (26.7s)` | `PASS (32.7s)` | **VERIFIED** |
| `PROD-E2E-19` | `v3-complete-learning.spec.ts` — `V3-T3`: All 12 Question Types live exam scoring + Confidence Neutrality, Bulk Edit, `Ctrl+K` Search & Hard Exam Guard, 2-Account Notes/Reports & Vietnamese PDF Export | All 12 question types server-graded (`100%` SQL parity), confidence tags strictly score-neutral, `Ctrl+K` blocked during active exam, 2-account private note isolation & error report resolution, `paper_and_key` PDF (`200`, `%PDF-`) & collaborator `allow_clone=false` PDF blocked (`403`) | `PASS (1.0m)` | `PASS (1.1m)` | **VERIFIED** |
| `PROD-E2E-20` | `v3-complete-learning.spec.ts` — `V3-T4`: Spell Mode, Audio Flashcards, Advanced Learn, Review Mistakes, Resume Checkpoint across F5 & Scoped Reset Progress preserving Exam History | Spell diff feedback, Audio Flashcards (`<audio>` visible after disabling `default_shuffle_questions`, `Space` flip, rating `3`), Learn, `/dashboard` checkpoint persistence across F5, `/review`, Scoped Reset clears checkpoints while preserving submitted Exam History (`200`) | `FAIL (test shuffle bug)` | `PASS (41.7s)` | **VERIFIED** |
| `PROD-E2E-21` | `v3-complete-learning.spec.ts` — `V3-T5`: Visual Diagram Mode (`/sets/[id]/diagrams`, `/diagrams/[id]/edit`, `/diagrams/[id]/study`) + Mobile `390px` & 2-Account RLS | Diagram creation/editor/study on desktop & `390px` mobile, pointer interactions, strict 2-account RLS isolation | `PASS (28.7s)` | `PASS (29.2s)` | **VERIFIED** |
| `PROD-E2E-22` | `v3-complete-learning.spec.ts` — `V3-T6`: True Offline PWA over Live HTTPS (`Download -> setOffline(true) -> Offline Study -> Refresh Offline -> setOffline(false) -> Sync Queue -> Account-Switch IDB Isolation`) | Active HTTPS SW controller, offline download into `studyhub-offline-v3:${userId}`, true `setOffline(true)` study & offline F5 reload, reconnect sync (`ignored_stale_reset`, `applied`, `duplicate_ignored`), same-browser account-switch IDB isolation (`0` leakage) | `PASS (30.5s)` | `PASS (30.2s)` | **VERIFIED** |

---

## 3. Suite B — Live Vercel Hobby `> 4.5 MiB` Direct-to-Storage Upload Bypass (`study-temp`)

Executed directly against `https://studyhub-three-mauve.vercel.app` via real authenticated Chromium session (`run-prod-scale-and-bypass.mjs`, `task-1064`, exit `0`). Proves Vercel Hobby's `4.5 MB` serverless request body cap does **not** break StudyHub multimedia or import flows, AND that every temporary file in `study-temp` is automatically cleaned up after consumption.

| ID | Bypass Flow | Payload Size (`> 4.5 MiB`) | Verified Live HTTP Pipeline | `study-temp` Leftover | Latency | Status |
| --- | --- | --- | --- | --- | ---: | --- |
| `PROD-BYPASS-01` | Large PCM WAV Audio (`listening`) | **`5,292,044 B` (`5.05 MiB`)** | `POST /api/storage/upload-url` (`201`, `bucket: "study-temp"`) → direct `PUT` to signed URL (`200`) → `POST /api/uploads/audio` JSON `{ storagePath }` (`201`) → `GET /api/uploads/signed-url` (`302` → `200`, exact `5,292,044 B` + `RIFF` match) | **`0`** (`{uid}/audio/`) | `12,922 ms` | **VERIFIED** |
| `PROD-BYPASS-02` | Large Valid PNG Image (`question`, `1280×1300`) | **`4,994,123 B` (`4.76 MiB`)** | `POST /api/storage/upload-url` (`201`) → direct `PUT` (`200`) → `POST /api/uploads/image` JSON `{ storagePath }` (`201`) → `GET /api/uploads/signed-url` (`302` → `200`, exact `4,994,123 B` + `89 50 4E 47` match) | **`0`** (`{uid}/image/`) | `14,992 ms` | **VERIFIED** |
| `PROD-BYPASS-03` | Large Multimedia `.docx` (embedding `4.76 MiB` PNG) | **`4,996,831 B` (`4.77 MiB`)** | `POST /api/storage/upload-url` (`201`) → direct `PUT` (`200`) → `POST /api/import/parse` JSON `{ storagePath }` (`200`, `format: "docx_multimedia"`, auto-offloaded `>1.5 MB` PNG to `study-temp/{uid}/import-media/` so response JSON stays tiny, raw `.docx` removed from `{uid}/import/`) → `POST /api/import/commit` (`200`, `importedCount: 1`, durable `prompt_image_url` in `study-media`, staged PNG removed from `{uid}/import-media/`) | **`0`** (entire `{uid}/` prefix) | `22,577 ms` | **VERIFIED** |

---

## 4. Suite C — Live Production Scale (`500Q` Bank, `250Q` Timed Exam + F5, Full Coverage & Vietnamese PDF)

Executed directly against `https://studyhub-three-mauve.vercel.app` (`task-1064`, exit `0`).

| ID | Live Production Scale Test | Verified Concrete Metrics & Assertions | Latency | Status |
| --- | --- | --- | ---: | --- |
| `PROD-SCALE-01` | **500-Question Bank Seed & Full Read-Back** | Set A (`300Q` / `1,200 options`) + Set B (`200Q` / `800 options`) inserted in 5×100 chunks via `POST /api/sets/[id]/questions/bulk` and verified via `GET /api/sets/[id]/questions?page=1&pageSize=500` → **`500Q / 2,000 options` intact (`0` PostgREST 1,000-row truncation)** | `22,688 ms` | **VERIFIED** |
| `PROD-SCALE-02` | **250-Question Multi-Subject Randomized Timed Exam + Zero Key Leaks + F5 Survival + Historical Results** | `POST /api/exams` proportional split **`150` (Môn A) + `100` (Môn B)**, shuffled questions & options, `duration_limit_seconds: 3600` → **`0` pre-submit answer key leaks** across 250 questions & 1,000 options → chunked autosave `150 + 100` (`answered_count: 250`) → Chromium `/exams/[id]` **`F5` reload survived** (`aria-checked="true"` + `250` persisted) → `POST /submit` server score **`200 / 250 = 80.00%` (`passed: true`, `subject_breakdown: 2`)** → `/exams/[id]/results` rendered `"80.00%"`, `"200 / 250"`, and both Vietnamese subject names with `0` uncaught page errors | `18,908 ms` | **VERIFIED** |
| `PROD-SCALE-03` | **Full Coverage Cycle (`500Q -> 250 + 250`, Zero Overlap, 100% Union)** | `POST /api/coverage-cycles` (`total_questions: 500`, `questions_per_exam: 250`, `start_first_exam: true`) → Exam #1 (`250` unique Qs) answered & submitted → `POST /next-exam` → Exam #2 (`250` unique Qs) → **`overlap = 0`, `union = 500`** → answered & submitted → `GET /api/coverage-cycles/[id]` confirmed **`status: "completed"`, `completed_count: 500 / 500`** *(also confirmed unanswered Qs safely return to `unassigned` pool per `0015` SQL design)* | `24,666 ms` | **VERIFIED** |
| `PROD-SCALE-04` | **Streamed Vietnamese PDF Export + Separate Answer Key** | `POST /api/export/pdf`: (1) `paper_and_key` (`locale: "vi"`) on `300Q` Set A → `200`, `application/pdf`, RFC 5987 `filename*=UTF-8''`, **`923,718 B`**, valid `%PDF-` header; (2) `incorrect_review` (`locale: "vi"`) on `50` wrong answers from submitted `250Q` exam → `200`, **`860,259 B`**, valid `%PDF-` header | `25,076 ms` | **VERIFIED** |

---

## 5. Suite D — Phase 7 Live Auth Redirect Verification & Sibling Production Audit Cross-References

| ID | Check | Status | Notes |
| --- | --- | --- | --- |
| `PROD-AUTH-02` | Supabase Dashboard Auth `Site URL`, `4` `Redirect URLs` & live `/auth/confirm` flow (zero-email `generateLink` + live HTTPS `GET /auth/confirm`) | **VERIFIED** | Independently verified live against `https://studyhub-three-mauve.vercel.app` (exit `0`, `PROD_AUTH_02_PHASE7_ALL_PASS=true`): `DEFAULT_SITE_URL = https://studyhub-three-mauve.vercel.app`; all `4` allowlisted URLs (`https://studyhub-three-mauve.vercel.app/auth/{callback,confirm}`, `http://localhost:3000/auth/{callback,confirm}`) exact match; untrusted `https://evil.example/steal` rejected (fallback to `https://studyhub-three-mauve.vercel.app`); live `GET /auth/confirm` verified `307` + `Cache-Control: no-store` + `sb-*` session cookie for BOTH `type=recovery` → `/reset-password` and `type=magiclink&next=/dashboard` → `/dashboard`. Disposable `v3-prod-auth7-*` user deleted immediately (`TRACKED_REMAINING users=0`). |
| `REF-SEC-11` | Phase 11 Production Security Audit (`security-auditor`) | **PASS (`22/22` live security tests, `0` P0/P1/P2)** | See `docs/audit/v3-production/SECURITY_AUDIT.md`. |
| `REF-UX-10` | Phase 10 Production Real-User UX Audit (`real-user`) | **PASS (`18` live screenshots, `0` P0/P1/P2 open)** | See `docs/audit/v3-production/USER_EXPERIENCE_REPORT.md`; `PROD-UX-01` (tablet `768px` header flex overlap) was fixed surgically by `@v2-ui-builder` in commit `646a565` (`src/components/layout/app-shell.tsx`), auto-deployed to Vercel (`dpl_CUxPSwsnAfqQCVcLf8shZZwbrQDQ`), and re-verified **`0px` overlap / `0px` overflow** across all 5 viewports (`360px`–`1440px`) by `@real-user`. |
