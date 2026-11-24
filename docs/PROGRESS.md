# StudyHub V1.0 — Implementation Progress Tracker

> Status legend: `[ ]` Pending · `[/]` In Progress · `[x]` Verified Done.
> Last verified against fresh CI gate & QA audit (`docs/VERIFICATION_REPORT.md`).

---

## Wave 1 — Specifications, Skills & Foundation

| Deliverable | Owner | Status | Verified Notes |
| --- | --- | --- | --- |
| `docs/SKILLS.md` (Skills & Environment Audit) | `skills-research` | `[x]` | Audited installed plugins (`modern-web-guidance`, `superpowers`, `supabase`), Docker/Supabase status, 7 checklists |
| `AGENTS.md` + Core Spec Suite (`PRD`, `ARCHITECTURE`, `DATABASE`, `DESIGN_SYSTEM`, `IMPORT_FORMATS`, `SECURITY`, `TESTING`, `DEPLOYMENT`, `IMPLEMENTATION_PLAN`, `SWARM_TASKS`, `PROGRESS`) | `architect-docs` | `[x]` | All 12 docs written and aligned 1:1 with `src/types/*` and `supabase/migrations/0001`–`0004` |
| Project Scaffold, UI Primitives, i18n & Shared Types | `foundation` | `[x]` | Git init, deps installed (zero AI/payments), 24 shadcn primitives, VI/EN i18n, `src/types/*`, strict CSP in `next.config.ts`, `vitest.config.ts` |

---

## Wave 2 — Backend, Deterministic Engines & Frontend Workspace

| Deliverable | Owner | Status | Verified Notes |
| --- | --- | --- | --- |
| Supabase SQL Migrations (`0001`–`0004`: 20 Tables + RLS + Triggers/RPCs + Storage) | `backend-supabase` | `[x]` | Audited by 7 structural SQL migration/RLS/RPC tests in `tests/unit/security/supabase-migrations-audit.test.ts` |
| `src/proxy.ts`, `/auth/*`, Security Guards (`upload`, `rate-limit`, `sanitize`, `authz`) & Core `/api/*` Handlers | `backend-supabase` | `[x]` | 12 unit security tests + API integration tests passing; pre-submit exam anti-leak & idempotent `submit_exam_attempt()` enforced |
| Deterministic Import/Export Engine + 6-Step Virtualized Wizard + Stress Fixtures | `import-engine` | `[x]` | All 9 `ImportFormat` profiles, conflict detection, JSON/CSV/XLSX export; 600-Q & 10,000-Q stress benchmarks passing in 314 ms |
| Deterministic SM-2 / Grading / Shuffle + 6 Focus Modes (`/flashcards`, `/learn`, `/practice`, `/write`, `/match`, `/test`, `/results/[attemptId]`, `/review`) | `learning-exam` | `[x]` | UUID-based shuffle-safe grading, SM-2 intervals, immutable exam snapshots, keyboard navigation & `motion/react` |
| Landing, Auth, AppShell (Desktop + Mobile 1-Hand), Dashboard, Library, Folders, 10k Virtualized Editor, Starred, History, Statistics, Shared, Friends, Profile, Settings | `frontend-ui` | `[x]` | All 69 App Router routes compile & prerender cleanly; Light/Dark & VI/EN verified |

---

## Wave 3 & 4 — QA/Security Audit, Final Docs & Release Readiness

| Deliverable | Owner | Status | Verified Metrics |
| --- | --- | --- | --- |
| Static Gate (`typecheck`, `lint`, `build`) | `qa-security` | `[x]` | `tsc --noEmit`: 0 errors · `eslint .`: 0 errors, 0 warnings · `next build`: 39 static pages, 69 App Router routes + Proxy |
| Automated Test Suite (`npm run test`) | `qa-security` | `[x]` | **16/16 files, 82/82 Vitest tests passing** (unit, security, SQL migration/RLS audit, API & round-trip integration, 600-Q & 10k-Q stress) |
| Playwright E2E, Responsive & Security Header Audit (`npm run test:e2e`) | `qa-security` | `[x]` | **11/11 passed**, 1 skipped (`authenticated-journey.spec.ts` guarded by `E2E_SUPABASE_READY=1` pending live Supabase credentials / Docker daemon). 0px horizontal overflow across `360`, `390`, `768`, `1024`, `1440`, `1920`. |
| Independent Verification Report (`docs/VERIFICATION_REPORT.md`) | `qa-security` | `[x]` | Zero AI SDKs, zero payment SDKs, zero `dangerouslySetInnerHTML`, zero client `service_role` leaks, zero mock users |
| Final `README.md`, `docs/DEPLOYMENT.md` (`0001`–`0004`, `src/proxy.ts`, backup/restore), `docs/SWARM_TASKS.md`, `docs/PROGRESS.md` | `architect-docs` | `[x]` | Deployment-ready documentation synchronized with final verified build |

---

## StudyHub V2.0 — Independent Audit, Universal Exam Engine & Hardening (2026-11-24)

> **V2.0 Final Audit Verdict:** **Code & Offline Verification Gate: `PASS` (`0` unresolved P0/P1/P2 code defects)** · **Live Runtime Release Gate: `BLOCKED` on `BLK-001`** (Docker Desktop daemon stopped & `.env.local` absent; see [`docs/audit/FINAL_ACCEPTANCE.md`](audit/FINAL_ACCEPTANCE.md)).

### V2.0 Wave 1 — Independent Zero-Trust Audits

| Deliverable | Independent Auditor | Status | Verified Notes |
| --- | --- | --- | --- |
| Functional Baseline (`docs/audit/AUDIT_REPORT.md`) & Section 26 Test Matrix (`docs/audit/TEST_MATRIX.md`, 90 cases) | `func-tester` | `[x]` | Audited 79 capabilities, logged 40 functional bugs (`BUG-001`–`BUG-040`), established 90-case acceptance matrix |
| Live Real-User Browser UX Audit (`docs/audit/USER_EXPERIENCE_REPORT.md`) | `real-user` | `[x]` | Audited live production build on port `3011` (`1440`/`390`/`360px`, Light/Dark, VI/EN), captured 21 BEFORE screenshots, logged 10 UX defects (`UX-01`–`UX-10`) |
| UI/UX, WCAG 2.2 AA & V2.0 Design Spec (`docs/audit/UIUX_AUDIT.md`) | `uiux-auditor` | `[x]` | Audited all pages/primitives, computed WCAG contrast ratios (9 failures caught), specified V2.0 Exam Builder, Presets & Coverage UX |
| DB, RLS, RPC & Backend Contract (`docs/audit/DB_BACKEND_AUDIT.md`) | `db-backend-auditor` | `[x]` | Audited migrations `0001`–`0004` + 38 API routes, logged 28 DB/API defects, authored `0005` SQL & REST contract |
| Independent Security & Dependency Audit (`docs/audit/SECURITY_AUDIT.md`) | `security-auditor` | `[x]` | Logged 23 findings (`SEC-001`–`SEC-023`, incl. 2 P0 RLS escalations & `zod` High CVE) |
| Real-File Aviation Import & Performance Audit (`docs/audit/PERFORMANCE_REPORT.md`) | `perf-import-auditor` | `[x]` | Tested all 4 real `sample-data/` DOCX/XLSX files (caught 0% XLSX import failure & Q#30 false dup), benchmarked 50–10,000Q & `.next` bundles |
| Master Issue Tracker (`docs/audit/ISSUE_TRACKER.md`) | `coordinator` | `[x]` | Consolidated 56 Wave 1 issues into 44 tickets (`SH-001`–`SH-044`: 11 P0, 22 P1, 8 P2, 3 P3) + `BLK-001` |

### V2.0 Wave 2 — Engineering Implementation & Hardening

| Deliverable | Builder | Status | Verified Notes |
| --- | --- | --- | --- |
| Migration `0005_v2_custom_exams_and_coverage.sql` & Hardened Backend (53 API routes, 26 RLS tables, 35 new indexes) | `v2-db-backend-builder` | `[x]` | Migrations `0001`–`0004` untouched (`0` diff); added `exam_presets`, `exam_preset_sources`, `exam_attempt_sources`, `coverage_cycles`, `coverage_cycle_questions`, `coverage_cycle_attempts`, server-resolved `create_exam_attempt_v2()`, `save_exam_attempt_answers()` (`client_seq`), `clone_study_set()`, `get_practice_question_pool()`, `POST /api/uploads/image` + durable `signed-url?redirect=1`, `POST /api/account/restore`, `zod@^4.6.7` upgrade |
| Real-File Import/Export Engine & Wizard Perf Fixes | `v2-import-builder` | `[x]` | 2-row merged XLSX headers (`05.xlsx` `24/24`, `08.xlsx` `62/62` with 100% parity vs `08.docx`), composite duplicate fingerprint (`01.docx` `133/133` Q#30 preserved), O(1) Step-5 edit (`0.031 ms`), `-38.8%` wire payload, forged ZIP/XLSX XXE stream guards, OWASP CSV formula escaping |
| V2.0 Universal Exam Engine (`/exams/new`, `/exams`, `/practice`) & Learning Fixes | `v2-exam-learning-builder` | `[x]` | Multi-subject & folder dedup builder, 5 Allocation Strategies (A–E), 8 Selection Policies, Full Coverage Cycles, Exam Presets, Custom Multi-Subject Practice, virtualized 250–1,000Q Navigator & Results, memoized `<ExamTimer />`, `Learn`/`Flashcards`/`Write`/`Practice` bug fixes, 3-way SM-2 parity |
| WCAG 2.2 AA Tokens, `PreferencesProvider`, Navigation & Core Pages (`/folders`, `/import`, Boundaries) | `v2-ui-builder` | `[x]` | 31/31 WCAG AA contrast pairs, all 5 `/settings` toggles live across 12 consumers + `<MotionConfig>`, 12 distinct sidebar routes + mobile 5-tab bar (`Thi thử` center), 6 App Router boundaries (`error`, `loading`, `not-found`, `global-error`, `(app)/error`, `(app)/loading`), 35/35 page `metadata`, zero dev jargon, `-21.6%` `/edit` & `-25.1%` `/profile` bundle gzip |

### V2.0 Wave 3 & Wave 4 — Independent Re-Verification & Final Audit

| Deliverable | Independent Verifier | Status | Fresh Wave 4 Verified Metrics |
| --- | --- | --- | --- |
| Wave 3 Independent Retest & Reopen Cycle (`31/31` caught -> fixed -> re-verified) | `func-tester`, `real-user`, `uiux-auditor`, `db-backend-auditor`, `security-auditor`, `perf-import-auditor` | `[x]` | Caught & resolved 4 P0 (build OOM + 3 Postgres SQL crashes/deadlocks), 12 P1, 14 P2, 1 P3; updated all audit reports + `REGRESSION_REPORT.md` & `TEST_MATRIX.md` (`0 FAIL`, `0 NOT IMPLEMENTED`) |
| Fresh Static, Unit & Production Build Gate | `final-auditor` | `[x]` | `tsc --noEmit`: `0` errors · `eslint .`: `0` errors/warnings · `vitest run`: **22/22 files, 167/167 tests PASS** (`9.75s`) · `next build`: **52/52 static pages, 92 routes** (`EXIT=0`) · `npm audit --omit=dev`: **0 Critical, 0 High** (2 moderate `exceljs->uuid` documented) |
| Fresh Production Playwright E2E Gate (Port `3013`) | `final-auditor` | `[x]` | **13/13** public/V2.0/prod-CSP-HSTS/404/EN-reload-title/protected-redirects/reduced-motion/6-viewport (`360`–`1920px`) tests PASS (`9.8s`) · **3/3** live-Supabase authenticated tests (`SH-041` fixed + V2.0 Scenarios 2 & 3) cleanly skipped pending `BLK-001` |
| Final Acceptance Report & Doc Sync (`FINAL_ACCEPTANCE.md`, `ISSUE_TRACKER.md`, `SKILLS.md`, `PROGRESS.md`, `README.md`) | `final-auditor` | `[x]` | 32-item acceptance table (`7 VERIFIED`, `23 VERIFIED [Code/Unit — Live DB Blocked]`, `2 BLOCKED [BLK-001]`), 0 edits to `src/*`, `supabase/*`, `tests/*` |
| Live Supabase DB Execution (`BLK-001`: `supabase db reset`/`push`, `db advisors`, live 2-account RLS & E2E) | *Pending User Env* | `[x]` | **RESOLVED IN V2.1 (2026-11-24)** — Connected live Supabase Cloud (`cuoaifyupfmkstqhcjwy`, PG 17.12, Migrations `0001`–`0012`); see V2.1 section below. |

---

## StudyHub V2.1 — Live Supabase Cloud Verification & Final Release Sign-Off (2026-11-24)

> **V2.1 Final Binding Release Verdict (`final-auditor`):** **`READY WITH DOCUMENTED MINOR LIMITATIONS`** (`BLK-001` **RESOLVED / CLOSED**; **32/32** Acceptance Criteria VERIFIED; **90/90** Section 26 Test Matrix PASS; **0** open/reopened P0/P1/P2 defects; see [`docs/audit/FINAL_ACCEPTANCE.md`](audit/FINAL_ACCEPTANCE.md)).

| Deliverable | Owner / Independent Verifier | Status | Fresh Verified Live Evidence |
| --- | --- | --- | --- |
| Modern Supabase Cloud API Keys (`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_SECRET_KEY` + legacy fallback) | `v2-db-backend-builder`, `v2-ui-builder` | `[x]` | Updated `src/lib/supabase/env.ts`, `api-client.ts`, `service-setup-notice.tsx`, `.env.example`; `EXACT_REAL_SECRET_IN_STATIC=0` |
| Cloud Advisor Hardening (`0006`) + 6 Live PG 17.12 P0 Fixes (`0007`–`0012`) | `coordinator`, `v2-db-backend-builder` | `[x]` | `0001`–`0004` strictly untouched; `0006` (`pg_trgm->extensions`, 6 composite FK indexes, 27 `anon` grants revoked), `0007` (`folders` RLS recursion), `0008` (`study_sets` `INSERT RETURNING` `42501`), `0009` (`tags`↔`question_tags` mutual recursion), `0010` (`clone_study_set` `42803`), `0011` (`exam_attempt_questions` FK `ON DELETE SET NULL`), `0012` (`coverage_cycles` account delete cascade `23503`) |
| Live PG 17.12 RPC & Trigger Suite (`tests/integration/live-db-rpcs.test.ts`) | `db-backend-auditor` (`#106`) + `final-auditor` | `[x]` | **8/8 PASS LIVE** (`16.4s`): `handle_new_user`, 500-row trigger, `normalize_short_answer`, folder dedup/cycle guard, multi-subject exam + `client_seq` + SM-2 + `P0003`, 500Q Full Coverage Cycle (`0` overlap), `clone_study_set`, `get_practice_question_pool` (500Q/2,000 opts) |
| Live 2-Account Negative RLS, Storage & HTTP Security Suite (`tests/integration/live-rls-security.test.ts`) | `security-auditor` (`#113`) + `final-auditor` | `[x]` | **11/11 PASS LIVE** (`28.4s` on `:3013`): editor hijack, block bypass, composite FKs `23503`, revoked V1 RPC & `42501` column anti-leak, `profiles.email` `42501`, `'unlisted'` + 6 RLS helper oracles, private `study-media` Storage + SVG `415`, `allow_clone=false` `403`/`42501`, 11-table isolation, `0006` 16 `anon` RPCs `42501`, full HTTP security suite |
| Live Real Aviation File Imports (`sample-data/`) & 500Q/250Q Cloud Benchmarks | `perf-import-auditor` (`#110`, `#112`) | `[x]` | All 4 real files persisted & read back 100% live (`133/133`, `24/24`, `62/62`, `62/62` with 100% parity); 500Q commit (`3.65s`), single-page 500Q read-back (`2,000/2,000` opts, `0` 414), 250Q live exam (`1.75s` start, `824ms` autosave, `724ms` submit), 500Q export & clone (`815ms`), `0011` delete cascade verified |
| Live Authenticated Real-Student Browser Walkthrough + Mobile `UX-12` & Flag Polish | `real-user` (`#115`, `#122`), `v2-exam-learning-builder` (`#119`) | `[x]` | **8/8 Student Scenarios PASS LIVE** (Desktop `1440px` + Mobile `390px`/`360px`, Light & Dark, 14 authenticated screenshots); `UX-12` auto-clamp & mobile `"Đánh dấu"` zero truncation verified live (`0` P0/P1/P2 remaining) |
| Full Live 16-Test Playwright E2E Suite & 90/90 Section 26 Matrix | `func-tester` (`#123`) | `[x]` | **16/16 Playwright PASS LIVE** (`0` skipped, `0` failed, `1.7m`, `CLEANUP_USERS_DELETED=2/2`); **90/90** `TEST_MATRIX.md` PASS (`71 LIVE` + `19 Deterministic Unit`) |
| Wave 5 Independent Final Audit, Fresh Live Gate & Clean Teardown Check | `final-auditor` | `[x]` | Fresh `tsc` (`0`), `eslint` (`0`), `next build` (`52/52` static, `92` routes), `vitest` (**24/24 files, 187/187 PASS LIVE**), Playwright `:3013` (**13/13 PASS**, `supabaseConfigured: true`, `PORT_3013_FREE=True`), `npm audit --omit=dev` (`0` Critical/High), Cloud DB teardown **`0` auth users / `0` rows / `0` storage items** |

---

## StudyHub V3.0 (Complete Learning Edition) — Full Multimedia, 12 Question Types, Diagrams, Confidence, PWA Offline & Vietnamese PDF (2026-11-24)

> **V3.0 Final Binding Release Verdict (`final-auditor`):** **`READY WITH DOCUMENTED MINOR LIMITATIONS`** (**55/55** §41 Final Acceptance Criteria VERIFIED; **93/93** §35 Test Matrix PASS; **20/20** Wave 5 defects caught, fixed & independently re-verified closed; **0** open P0/P1/P2 defects; live-verified on Supabase Cloud PostgreSQL `17.12.0.002` with real user data 100% preserved; see [`docs/audit/v3/FINAL_ACCEPTANCE.md`](audit/v3/FINAL_ACCEPTANCE.md)).

### V3.0 Waves 0–4 — Architecture, Additive Migrations (`0013`–`0016`) & Implementation

| Deliverable | Owner | Status | Verified Notes |
| --- | --- | --- | --- |
| Baseline Audit & Free-Tier Constraints (`docs/audit/v3/BASELINE.md`) | `db-backend-auditor` | `[x]` | Audited committed V2.1 tag `v2.1-verified` (`0698734`), documented 8 V2.1 schema/storage constraints (`C-01`–`C-08`) & 6 Free-Tier guardrails |
| Additive V3.0 Migrations (`0013`–`0016`: +10 Tables = **36 RLS Tables**, 10 MB Audio+Image `study-media`, 12-Type Grading, Reset, Global Search, Offline Sync) | `v2-db-backend-builder`, `coordinator` | `[x]` | `0001`–`0012` strictly untouched (`MIG_DIFF_LINES=0`); `0013`–`0016` applied live on Supabase Cloud PG 17.12 (`36/36` RLS, `0` Advisor errors, `0` `unindexed_foreign_keys`); 70 API routes total |
| Multimedia DOCX, Selectable-Text Vietnamese PDF Import (`pdfjs-dist`), Vietnamese PDF Export (`pdf-lib` + `NotoSans`), TipTap Rich Text & Safe KaTeX | `v2-import-builder` | `[x]` | `docx_multimedia` w/ SHA-256 Storage dedup (`55 -> 15` objects), `pdf_text` (prod `serverExternalPackages` + worker preload `V3-PERF-01`) + honest scanned-PDF detection, all 5 Vietnamese PDF export modes w/ RFC 5987 headers (`V3-SEC-01`), `RichTextDoc` AST v1 + KaTeX `trust: false` (`V3-UX-04`) |
| All 12 Exam Question Types (+ Flashcard), Advanced Learn, Spell Mode, Audio Flashcards, Visual Diagram Mode (6 Sub-Modes), Confidence Calibration, Checkpoints & Scoped Reset | `v2-exam-learning-builder` | `[x]` | Full client/SQL grading parity across all 12 types, P0 Confidence Exam Score Neutrality, `V3-UX-05` `matching` runner, `V3-FUNC-01`/`V3-UX-06` Practice parity, `V3-UX-02` Learn TSV fix, normalized `[0,1]` Point/Rect/Polygon diagram engine |
| PWA Installability, Service Worker (`public/sw.js`), Account-Partitioned IndexedDB (`studyhub-offline-v3:${userId}`), Offline Study & Deterministic Sync | `v3-pwa-offline-builder` | `[x]` | Strict `/api/*`/`/auth/*`/`/share/*` SW exclusion, safe `APPLY_UPDATE`, real offline `F5` reload survival, `event_id` idempotency, `ignored_stale_reset`/`rejected_revoked`/`rejected_deleted`/lossless note `conflict`, same-browser Account A->B `0`-leak isolation, lazy `PwaProvider` (`V3-PERF-03`) |
| 8-Mode Study Hub, Global Search (`Ctrl+K` + Hard Exam Guard), IME-Safe Shortcuts (`?`), Personal Notes, Error Reports, Bulk Editor & Settings Tabs | `v2-ui-builder` | `[x]` | Wrap-safe `PageHeader` (`V3-UX-01`), Question Bank media preview (`V3-UX-03`), leaf imports (`V3-PERF-02`), 8-entity `GlobalSearchDialog` (suppressed in active exams), Dark/Light + VI/EN |

### V3.0 Waves 5, 5B & 6 — Independent Live Audits & Final Release Gate

| Deliverable | Independent Auditor | Status | Fresh Verified Live Evidence |
| --- | --- | --- | --- |
| Live PG 17.12 V3.0 & V2.1 DB/RPC Audit (`docs/audit/v3/DB_BACKEND_AUDIT.md`) | `db-backend-auditor` (`#181`) + `final-auditor` | `[x]` | Caught `V3-DB-01..05` -> fixed in `0016` -> **`16/16`** live PG 17.12 RPC tests PASS (`8/8` V2.1 + `8/8` V3.0) |
| Independent 3-Account Live Security Audit (`docs/audit/v3/SECURITY_AUDIT.md`) | `security-auditor` (`#188`) + `final-auditor` | `[x]` | Caught `V3-SEC-01..05` -> fixed & rebuilt -> **`22/22`** live RLS/HTTP (`11/11` V2.1 + `11/11` V3.0) + **`39/39`** unit security PASS (`0` open P0/P1/P2; 1 non-blocking P3 `V3-SEC-P3-01`) |
| Live Scale, Real Aviation Corpus, Multimedia Import, PDF & Bundle Audit (`docs/audit/v3/PERFORMANCE_REPORT.md`) | `perf-import-auditor` (`#187`) | `[x]` | Caught `V3-PERF-01/02/03` -> fixed & rebuilt -> 4/4 real aviation files `100%` parity, 50Q multimedia DOCX dedup (`55->15`), 5-page VN PDF `20/20` + scanned PDF, all 5 VN PDF export modes (`50Q`/`250Q`), 10kQ DOCX `639ms`, 100-event sync `454.5ms`, Landing `/` `-33.5%` & `/exams/[attemptId]` `-41.5%` gzip, `0 B` server libs leaked |
| Full Live 22-Test Playwright E2E, Test Matrix & Regression (`docs/audit/v3/TEST_MATRIX.md`, `REGRESSION_REPORT.md`) | `func-tester` (`#189`) | `[x]` | Caught `V3-FUNC-01` -> fixed & rebuilt -> **`22/22` live Playwright E2E PASS** (`13 + 3 V2.1 + 6 V3.0`, `0` skipped, `0` failed, `4.1m`), **`93/93`** §35 cases & **`55/55`** §41 criteria PASS |
| Live Real-Student 8-Scenario UX Audit (`docs/audit/v3/USER_EXPERIENCE_REPORT.md` + 22 Screenshots) | `real-user` (`#191`) | `[x]` | Caught `V3-UX-01..06` -> fixed & rebuilt -> **`8/8`** Scenarios (A–H) PASS LIVE, `0px` overflow across 16 mobile `390px`/`360px` checks, **22/22** valid AFTER PNG screenshots |
| Wave 6 Independent Final Audit, Fresh Live Gate & V3.0 Doc Sync (`FINAL_ACCEPTANCE.md`, `ISSUE_TRACKER.md`, 10 project docs) | `final-auditor` | `[x]` | Fresh `tsc` (`0`), `eslint` (`0`), clean `next build` (`64/64` static, `114` routes + Proxy, `exactRealSecretHits=0`, `0` server parser leaks), `LIVE_API_BASE_URL=http://127.0.0.1:3023 npm run test` (**50/50 files, 363/363 tests PASS LIVE** in `37.43s`), Playwright smoke `:3023` (**13/13 PASS** in `10.1s`, `PORT_3023_FREE=True`), `npm audit --omit=dev` (`0` Critical/High), Cloud DB spotless (`disposableTestUsersCount=0`, `orphanStoragePrefixesCount=0`, real user data `100%` untouched) |
