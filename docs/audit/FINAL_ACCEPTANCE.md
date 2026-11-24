# StudyHub V2.0 — Independent Final Acceptance & Release Gate Report

> **Independent Final Auditor:** Agent 9 (`final-auditor`)  
> **Audit Date:** 2026-11-24  
> **Workspace:** `d:\Code Web\StudyHub`  
> **Baseline Checkpoint Commit:** `f09a8ed` (`chore: StudyHub V1.0 baseline checkpoint before V2.0 audit`)  
> **Strict Independence Attestation:** `final-auditor` NEVER participated in StudyHub V1.0 or V2.0 feature implementation and made **zero edits** to `src/*`, `supabase/*`, or `tests/*`. Every command output, environment check, static compliance scan, and Playwright browser run below was executed fresh by `final-auditor` during Wave 4 (`verification-before-completion`).

---

## 1. Binding Final Release Status Verdict (Section 34.F)

### **FINAL RELEASE VERDICT: `BLOCKED`**

Per Section 34.F (*"Do not declare READY if authenticated workflows or critical database behavior remain untested."*), StudyHub V2.0 **cannot** be declared `READY` until live PostgreSQL / Supabase runtime verification (`BLK-001`) is executed. This verdict cleanly separates the two release gates:

| Release Gate | Status | Authoritative Justification |
| --- | :---: | --- |
| **Gate A — Code, Architecture, Security Static & Offline Verification** | **PASS** | **0** unresolved P0/P1/P2 code defects across all 44 Wave 1 tickets (56 baseline issues) and all 31 Wave 3 reopened defects (`31/31` fixed & independently re-verified). Fresh `typecheck` (0 errors), `lint` (0 errors/warnings), `vitest` (**22/22 files, 167/167 tests**), `next build` (**52/52 static pages, 92 routes**), `playwright` (**13/13** live public/security/6-viewport tests), `npm audit --omit=dev` (**0 Critical, 0 High**), real `sample-data/` import (**100%** across all 4 aviation files), and WCAG 2.2 AA contrast (**31/31** pairs) all PASS cleanly. |
| **Gate B — Live Supabase Database, Auth, RLS, Storage & 2-Account E2E** | **`BLOCKED` (`BLK-001`)** | Verified fresh in Wave 4: `.env.local` does not exist (`ENV_LOCAL_EXISTS=False`), `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` are unset, Docker Desktop daemon is stopped (`open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified`), `supabase` CLI is not installed (`WHERE_SUPABASE_EXIT=1`), and `list_plugin_accounts` confirms no signed-in `supabase_mcp` OAuth account. Live migration `0001`–`0005` execution, `supabase db advisors`, `EXPLAIN (ANALYZE, BUFFERS)`, 2-account PostgREST negative RLS/Storage tests, and the 3 authenticated Playwright E2E scenarios remain untested against a live PostgreSQL 15 instance. |

### Exact 3-Step Unblock Runbook to Reach `READY` Immediately

Once Docker Desktop is running OR a hosted Supabase project is created, execute these exact 3 steps to clear `BLK-001` and promote the release to `READY`:

1. **Provision & Migrate Live Supabase (`0001`–`0005`):**
   - *Local Docker:* Start Docker Desktop, run `npx supabase start && npx supabase db reset`, and copy the printed `API URL` / `anon key` / `service_role key` into `.env.local` (based on `.env.example`).
   - *Hosted Supabase:* Copy `.env.example` to `.env.local`, populate `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_APP_URL`, and `SUPABASE_SERVICE_ROLE_KEY`, then run `npx supabase login && npx supabase link --project-ref <ref> && npx supabase db push`.
2. **Verify Database Advisors & Live 2-Account RLS / Storage Boundaries:**
   - Run `npx supabase db advisors` (confirm 0 security/performance errors on migrations `0001`–`0005`) and execute the live PostgREST negative checks in [`docs/audit/SECURITY_AUDIT.md`](./SECURITY_AUDIT.md) §7.2 (cross-account isolation on all 26 tables, editor anti-hijack, blocked-user anti-unblock, `profiles.email` revocation, `exam_attempt_questions` column revocation, and private `study-media` Storage RLS).
3. **Run the Full Live 2-Account Authenticated Playwright E2E Suite Against Production Build:**
   ```powershell
   npm run build
   $env:E2E_SUPABASE_READY = "1"
   $env:E2E_USER_A_EMAIL = "<test-user-a@example.com>"
   $env:E2E_USER_A_PASSWORD = "<strong-password-a>"
   $env:E2E_USER_B_EMAIL = "<test-user-b@example.com>"
   $env:E2E_USER_B_PASSWORD = "<strong-password-b>"
   $env:PLAYWRIGHT_EXPECT_PROD = "1"
   npm run test:e2e
   ```
   Confirm all **16/16** Playwright tests pass (13 public + 3 authenticated live Supabase journeys covering core study/import/exam anti-leak/2-account RLS, V2.0 Multi-Subject Custom Exam Builder & Presets, and V2.0 Full Coverage Cycles).

---

## 2. Fresh Independent Verification Evidence (Executed by `final-auditor`)

Every gate below was executed fresh in Wave 4 directly against the final workspace state without trusting prior worker summaries:

| Verification Check | Exact Command / Inspection | Exit Code | Fresh Measured Result |
| --- | --- | ---: | --- |
| **TypeScript Strict Check** | `npm run typecheck` (`tsc --noEmit`) | `0` | **PASS** — `0` errors across all `src/*` and `tests/*` |
| **ESLint 9 Check** | `npm run lint` (`eslint .`) | `0` | **PASS** — `0` errors, `0` warnings |
| **Vitest Full Automated Suite** | `npm run test` (`vitest run`, v5.1.1) | `0` | **PASS** — **22/22 test files, 167/167 tests passed** in `9.75s` *(0 failures; non-fatal Vite CJS notice on `vitest.config.ts:1:1` documented as `BUG-040`)* |
| **Next.js Production Build** | `npm run build` (`next build`, Turbopack 16.4.6) | `0` | **PASS** — Compiled in `2.7s`, TypeScript in `3.8s`, **52/52 static pages generated** in `915ms` (`cpus: 4, memoryBasedWorkersCount: true`); **92 App Router routes** (53 API + 3 auth + 35 `page.tsx` + `/_not-found`) + `ƒ Proxy` |
| **Playwright Production E2E** | `PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_BASE_URL=http://127.0.0.1:3013 PLAYWRIGHT_EXPECT_PROD=1 npx playwright test --reporter=list` | `0` | **PASS (Public) / SKIPPED (Live DB)** — **13 passed, 3 skipped** (`authenticated-journey.spec.ts` gated by `E2E_SUPABASE_READY=1`), **0 failed** in `9.8s`; port `3013` cleanly released (`PORT_3013_FREE=True`) |
| **Dependency Security Audit (Prod)** | `npm audit --omit=dev` | `1` | **0 Critical, 0 High**, **2 Moderate** (`exceljs@4.4.0 -> uuid@8.3.2`, GHSA-w5hq-g745-h8pq; `zod@4.6.7` High CVE `GHSA-mrhx-c7xc-m3w5` resolved; `--force` intentionally not run) |
| **Dependency Security Audit (Full)** | `npm audit` | `1` | Identical: **0 Critical, 0 High**, **2 Moderate** (`0` dev-only advisories) |
| **Migration `0001`–`0004` Immutability** | `git diff f09a8ed -- supabase/migrations/0001..0004` | `0` | **PASS** — `UNMODIFIED_0_LINES`; sole new migration is `supabase/migrations/0005_v2_custom_exams_and_coverage.sql` (`26/26` tables have `ENABLE ROW LEVEL SECURITY`) |
| **Corpus Privacy (`sample-data/`)** | `git ls-files sample-data` + `git status --short` + `src/*` scan | `0` | **PASS** — `sample-data/` is `NOT_TRACKED` and `SAMPLE_DATA_SRC_REFS=0` |
| **Zero-AI, Zero-Payment & Security Static Scan** | Full scan of `package.json`, `250` `src/**/*.{ts,tsx}` files, and `89` `.next/static` chunks | `0` | **PASS** — `AI_SRC_HITS=0`, `PAY_SRC_HITS=0`, `PKG_BANNED_HITS=0`, `XSS_HITS=0`, `GET_SESSION_HITS=0`, `SPARKLES_HITS=0`, `GET_PUBLIC_URL_HITS=0`, `CLIENT_ADMIN_HITS=0`, `PROFILES_STAR_HITS=0`, `MOCK_AUTH_HITS=0`, `ADMIN_HAS_SERVER_ONLY=True`, `BUNDLE_SECRET_HITS=0`, `BUNDLE_SERVER_PARSER_HITS=0` |
| **Live Supabase Environment Check (`BLK-001`)** | `Test-Path .env.local`, env var scan, `docker info`, `where.exe supabase`, `list_plugin_accounts` | — | **CONFIRMED `BLOCKED`** — `ENV_LOCAL_EXISTS=False`, all Supabase env vars `False`, Docker daemon stopped (`DOCKER_EXIT=-1`), `where.exe supabase` Exit `1`, `No installed plugins declare account sign-ins.` |

---

## 3. Non-Negotiable Constraints Verification (Section 32)

| # | Non-Negotiable Mandate | Verdict | Independent Wave 4 Proof |
| :-: | --- | :---: | --- |
| 1 | **ZERO AI in Runtime** | **VERIFIED PASS** | Fresh regex scan across `package.json` and all `250` files in `src/` returned `0` AI/LLM SDKs, endpoints, prompts, vector DBs, or `"Smart AI"` branding; `0` `<Sparkles />` icons. All parsing, answer detection, allocation strategies (A–E), selection policies (1–8), Full Coverage cycles, grading, SM-2, and analytics are 100% deterministic. |
| 2 | **ZERO Payments, Monetization, or Artificial Limits** | **VERIFIED PASS** | Fresh scan of `package.json` and `src/` returned `0` Stripe/Paddle/LemonSqueezy/PayPal/billing/paywall/credit/VIP references. Arbitrary exam sizes up to 1,000+ questions and unlimited sets, imports, presets, and coverage cycles are supported without business gates. |
| 3 | **ZERO Fake Auth, Mock DB, or Hardcoded Demo Data** | **VERIFIED PASS** | `MOCK_AUTH_HITS=0`, `GET_SESSION_HITS=0`. Unconfigured Supabase returns honest fail-closed `503 SUPABASE_NOT_CONFIGURED` on DB API routes and clean `307 -> /login?setup=1` redirects on all protected routes with zero fake logged-in shell or mock datasets (verified live in Playwright). |
| 4 | **ZERO Self-Approval (Strict Role Separation)** | **VERIFIED PASS** | Wave 2 builders (`v2-db-backend-builder`, `v2-import-builder`, `v2-exam-learning-builder`, `v2-ui-builder`) never marked issues `VERIFIED`/`CLOSED`. All 6 independent Wave 3 auditors (`func-tester`, `real-user`, `uiux-auditor`, `db-backend-auditor`, `security-auditor`, `perf-import-auditor`) made zero edits to `src/*` or `supabase/*` and independently caught/reopened **31** genuine defects before sign-off. Wave 4 `final-auditor` had zero implementation role and made zero edits to `src/*`, `supabase/*`, or `tests/*`. |
| 5 | **ZERO Secret or Corpus Exposure** | **VERIFIED PASS** | `.env.local` and `sample-data/` are gitignored and untracked (`NOT_TRACKED`). Zero proprietary aviation question text exists in `src/*`, `tests/*`, or `docs/*`. `SUPABASE_SERVICE_ROLE_KEY` is referenced only in `src/lib/supabase/admin.ts` (guarded by `import "server-only"`) and `src/lib/supabase/env.ts`; `.next/static` has `BUNDLE_SECRET_HITS=0`. |

---

## 4. Complete 32-Item Acceptance Criteria Table (Section 33)

> **Honest Rating Legend:**
> - **`VERIFIED`** — 100% verified fresh via live execution, real-file verification, or deterministic static/automated checks with zero live-DB dependency.
> - **`VERIFIED (CODE & UNIT/MOCK — LIVE DB BLOCKED)`** — Implementation, SQL/RLS/RPC design, deterministic unit/integration tests, and production build verified with `0` code defects; live PostgreSQL/Auth/Storage execution remains gated on `BLK-001`.
> - **`BLOCKED`** — Cannot execute without a connected live Supabase / PostgreSQL 15 runtime (`BLK-001`).

| # | Acceptance Criterion (Section 33) | Final Honest Rating | Exact File, Test, Audit & Screenshot Evidence |
| :-: | --- | --- | --- |
| **1** | Zero AI SDKs, LLM calls, AI branding, or probabilistic logic anywhere in runtime | **`VERIFIED`** | Fresh Wave 4 scan (`package.json` + 250 `src/*` files): `AI_SRC_HITS=0`, `PKG_BANNED_HITS=0`, `SPARKLES_HITS=0`; `SECURITY_AUDIT.md` §1 & §9.6. |
| **2** | Zero payment SDKs, paywalls, ads, VIP tiers, or artificial business caps | **`VERIFIED`** | Fresh Wave 4 scan: `PAY_SRC_HITS=0`, `PKG_BANNED_HITS=0`; `createExamSchema` supports up to `1,000` Qs (configurable, no monetization cap). |
| **3** | Zero fake auth, mock DB, or placeholder controls; honest fail-closed unconfigured behavior | **`VERIFIED`** | `MOCK_AUTH_HITS=0`, `GET_SESSION_HITS=0`; fresh Playwright `studyhub.spec.ts` verified all 10 protected V1/V2 routes redirect cleanly to `/login` with `0` `503` storms & `0` `.env.local` leaks; `api-and-roundtrip.test.ts` 6/6 PASS; `USER_EXPERIENCE_REPORT.md` §8 (`after_06`, `after_08`, `after_12`). |
| **4** | Clean `typecheck`, `lint`, `test`, `build`, and public Playwright E2E gate | **`VERIFIED`** | Fresh Wave 4 runs: `tsc --noEmit` (0), `eslint .` (0), `vitest run` (**22/22 files, 167/167 tests**, `9.75s`), `next build` (**52/52 static pages, 92 routes**), Playwright on `:3013` (**13/13** public PASS, 3 auth skipped). |
| **5** | Real aviation `.docx` import accuracy (`METEOROLOGY-01` 133Q incl. Q#30 preservation & `METEOROLOGY-08` 62Q) | **`VERIFIED (CODE & UNIT/MOCK — LIVE DB BLOCKED)`** | `PERFORMANCE_REPORT.md` §5.1 (`#75`): `01.docx` **133/133 valid**, 0 false dups (Q#30 preserved!), `-37.8%` wire payload; `08.docx` **62/62 valid**, 1 genuine dup; `tests/unit/import/*` **28/28 PASS**; live DB commit gated on `BLK-001`. |
| **6** | Real institutional `.xlsx` import accuracy (`METEOROLOGY-05` 24Q & `METEOROLOGY-08` 62Q, 2-row merged headers, cross-file parity) | **`VERIFIED (CODE & UNIT/MOCK — LIVE DB BLOCKED)`** | `PERFORMANCE_REPORT.md` §5.1 (`#75`): `05.xlsx` `0/24` -> **24/24 (100%)**, `08.xlsx` `0/62` -> **62/62 (100%)** with **62/62 (100%) cross-file answer parity** vs `08.docx`, `headerRowCount: 2`, `16/16` unique headers, `0` `U+FEFF`/prefix leaks; live DB commit gated on `BLK-001`. |
| **7** | All 9 deterministic import formats, composite duplicate detection, O(1) commit prefilter & lossless export round-trip | **`VERIFIED (CODE & UNIT/MOCK — LIVE DB BLOCKED)`** | `tests/unit/import/*` **28/28 PASS** (incl. `v2-regressions.test.ts` 7/7), `api-and-roundtrip.test.ts` 6/6 PASS, `src/app/api/import/_existing-fingerprints.ts` (`#73`), `src/app/api/sets/[id]/export/route.ts` chunked `<=120`, `src/lib/export/index.ts` OWASP CSV escape; live DB commit/export gated on `BLK-001`. |
| **8** | Upload & archive security guards (magic bytes, forged ZIP bombs, XLSX XXE, macro/SVG rejection, 0 B client parser leakage) | **`VERIFIED`** | Fresh `vitest` (`tests/unit/security/*` 37/37 + `security-and-stress.test.ts` 5/5 = **42/42 PASS**), including forged-header `ZIP_RATIO_BOMB_DETECTED` & `XXE_FORBIDDEN`; fresh `.next/static` scan: `BUNDLE_SERVER_PARSER_HITS=0`. |
| **9** | 10,000-question scale: zero >250Q PostgREST 1,000-row option truncation, zero HTTP 414, fast import/edit & statement-level count trigger | **`VERIFIED (CODE & UNIT/MOCK — LIVE DB BLOCKED)`** | `src/lib/supabase/query-helpers.ts` (`SAFE_IN_CHUNK_SIZE=100`, `fetchAllPages`), `0005` `FOR EACH STATEMENT` count trigger & 5 GIN/partial indexes; `PERFORMANCE_REPORT.md` §5.2 (`10k DOCX 860.9 ms`, `10k TXT 255.4 ms`, `10k XLSX 576.2 ms`, Step-5 edit `105.5 -> 0.031 ms`, payload `-38.8%`); live Postgres timing gated on `BLK-001`. |
| **10** | Universal Custom Exam Builder (`/exams/new`, `/exams`), Quick Test fast-path & navigation entry points | **`VERIFIED (CODE & UNIT/MOCK — LIVE DB BLOCKED)`** | `src/app/(app)/exams/{page,new/page,[attemptId]/page,[attemptId]/results/page}.tsx` built cleanly; Playwright verified `/exams` & `/exams/new` `307 -> /login` (0 404s); Hero CTA verified in `after_01_landing_desktop_vi_light.png`; `CustomExamBuilderClient` + `ExamHubClient` + `POST /api/exams/{eligible,preview}` verified in `v2-acceptance.test.ts` 30/30; live interactive builder gated on `BLK-001`. |
| **11** | Multi-subject + recursive folder picker with strict deduplication (no double-counting parent folder + child set) | **`VERIFIED (CODE & UNIT/MOCK — LIVE DB BLOCKED)`** | `0005` `resolve_deduped_study_sets()` cycle-safe CTE + `get_exam_eligible_pool()` (`facet_q` pre-filter `#76`); `v2-acceptance.test.ts` (`TC-SAM-01`/`02`) PASS; live DB execution gated on `BLK-001`. |
| **12** | Arbitrary question counts (`1..1,000+`) with strict validation rejecting out-of-bounds/non-integer/empty pools (no silent clamping) | **`VERIFIED (CODE & UNIT/MOCK — LIVE DB BLOCKED)`** | `src/lib/validation/exams.ts` (`MAX_EXAM_QUESTIONS=1000`), `exam-allocator.ts`, `exam-engine.ts`; `v2-acceptance.test.ts` (`TC-SAM-03`/`05`/`09`) PASS; live DB execution gated on `BLK-001`. |
| **13** | All 5 multi-subject allocation strategies (A–E: `global_random`, `equal`, `proportional`, `custom`, `weighted`) with 1:1 FE/BE mathematical parity | **`VERIFIED (CODE & UNIT/MOCK — LIVE DB BLOCKED)`** | `exam-allocator.test.ts` (**14/14 PASS**) + `v2-acceptance.test.ts` (`TC-ALC-01`..`10` PASS, incl. Hamilton `500/226/133 -> 145/66/39`, Equal `[84,83,83]` + shortage `[48,24,48]`, Weighted `100%` + cap confirmation); `PERFORMANCE_REPORT.md` §5.3A (`1.25–4.01 ms` on 10k pool); live DB gated on `BLK-001`. |
| **14** | All 8 deterministic selection policies (`random`, `unseen_first`, `mistakes_first`, `weak_topics_first`, `due_for_review`, `starred_only`, `incorrect_only`, `anti_repeat`) with strict non-padding & honest fallback disclosure | **`VERIFIED (CODE & UNIT/MOCK — LIVE DB BLOCKED)`** | `exam-selector.test.ts` (**8/8 PASS**) + `v2-acceptance.test.ts` (`TC-POL-01`..`10` PASS — proves strict non-padding on `starred_only`/`incorrect_only` and `ANTI_REPEAT_FALLBACK` disclosure); `exam-engine.ts` `#64` pagination; live DB gated on `BLK-001`. |
| **15** | Full Coverage / No-Repeat Exam Cycles (`coverage_cycles` tri-state `assigned`/`answered`/`completed`, discard without completion, zero overlap, restart, concurrency lock) | **`VERIFIED (CODE & UNIT/MOCK — LIVE DB BLOCKED)`** | `coverage-engine.test.ts` (**5/5 PASS**) + `v2-acceptance.test.ts` (`TC-COV-01`..`08` PASS: `500->250+250`, `500->120×4+20`, 0 overlaps, discard revert, snapshot preservation); `0005` AB-BA lock order, non-negative `pool_order` shift, `BEFORE DELETE` release trigger (`DB_BACKEND_AUDIT.md` §7.3); 10k cycle bench `16.1–76.4 ms` (`#75`); live DB gated on `BLK-001`. |
| **16** | Saved Exam Presets (private RLS, config-only with no frozen `question_ids`, CRUD + favorite + duplicate + revocation-safe relaunch) | **`VERIFIED (CODE & UNIT/MOCK — LIVE DB BLOCKED)`** | `0005` `exam_presets`/`exam_preset_sources` RLS, `src/app/api/exam-presets/**`, `ExamPresetsSection.tsx`, `resolve_deduped_study_sets` / `create_exam_attempt_v2` launch-time re-authorization (`SECURITY_AUDIT.md` §9.5); live DB gated on `BLK-001`. |
| **17** | Live exam autosave reliability, chunked `>200` offline flush (no silent loss), monotonic `client_seq`, live `answered_count`, and server wall-clock / unlimited timer | **`VERIFIED (CODE & UNIT/MOCK — LIVE DB BLOCKED)`** | `LiveExamRunner.tsx` (`<=150` chunk flush, halts submit on flush error, newer-only local draft merge), `0005` `save_exam_attempt_answers()` (`FOR NO KEY UPDATE`, atomic `client_seq` guard, live `answered_count`, `409 EXAM_EXPIRED`); `v2-acceptance.test.ts` (`TC-EXM-02`); live DB gated on `BLK-001`. |
| **18** | Zero pre-submit exam answer leakage (`in_progress` & `discarded`), server-resolved snapshots (`create_exam_attempt_v2`), and immutable past attempts | **`VERIFIED (CODE & UNIT/MOCK — LIVE DB BLOCKED)`** | `0005` revokes `create_exam_attempt()` from `authenticated`, enforces DB-side `create_exam_attempt_v2()` + column revocation on `exam_attempt_questions`; `GET /api/exams/[attemptId]` runs `stripPreSubmitQuestions()` on `in_progress` & `discarded` (`#76`); `v2-acceptance.test.ts` & `v2-security-regression.test.ts` PASS; live Postgres test gated on `BLK-001`. |
| **19** | Server-authoritative grading: shuffle-safe option UUIDs, fixed numeric `0`/`10`/`100` normalizer, true weighted accuracy & Per-Subject/Chapter/Tag breakdowns + per-question `source_study_set_id` progress attribution | **`VERIFIED (CODE & UNIT/MOCK — LIVE DB BLOCKED)`** | `exam-scoring.test.ts` (7/7), `write-grader.test.ts` (8/8), `v2-acceptance.test.ts` (3-way numeric parity + weighted `81.82%` vs `45%` + UUID shuffle invariance), `0005` `normalize_short_answer()` (`trim_scale` + PG ARE fix `#76`) & set-based `submit_exam_attempt()` (`DB_BACKEND_AUDIT.md` §7.2–7.3); live SQL execution gated on `BLK-001`. |
| **20** | High-scale 250–1,000Q Exam Runner & Results ergonomics (zero-drift virtualized navigator, filters, `M`/`F` shortcuts, memoized `<ExamTimer>`, virtualized Results, clean POST mistake retest) | **`VERIFIED (CODE & UNIT/MOCK — LIVE DB BLOCKED)`** | `ExamTimer.tsx`, `ExamNavigatorGrid.tsx` (`ROW_HEIGHT_PX=50`, `>=44px` tiles, All/Unanswered/Marked/Subject filters, auto-scroll), `LiveExamRunner.tsx`, `ExamResultsClient.tsx` (`@tanstack/react-virtual`, `<TabsContent>`, clean POST retest — zero `?questionIds=` URL), `TestHubClient.tsx` (`enabled: !activeAttemptId`); verified by `uiux-auditor` `#74` & `perf-import-auditor` `#75`; live auth E2E gated on `BLK-001`. |
| **21** | Multi-subject & custom-subset Practice Mode (`/practice`, `POST /api/practice/questions`) | **`VERIFIED (CODE & UNIT/MOCK — LIVE DB BLOCKED)`** | `src/app/(app)/practice/page.tsx` built & `307` guarded live; `CustomPracticeClient.tsx`, `src/app/api/practice/questions/route.ts`, `0005` nullable `study_sessions.study_set_id` + `source_study_set_ids` RLS (`#76`) + `get_practice_question_pool` RPC; live runtime gated on `BLK-001`. |
| **22** | All 5 core learning modes (`Flashcards`, `Learn`, `Practice`, `Write`, `Match`) bug-free + unified 3-way SM-2 parity | **`VERIFIED (CODE & UNIT/MOCK — LIVE DB BLOCKED)`** | `LearnClient.tsx` single-session/stable queue (`SH-008`), `FlashcardsClient.tsx` seeded shuffle + `1/2/3/4` SM-2 + `<article>` a11y (`SH-021`), `WriteClient.tsx` deferred single-commit Override + IME guard (`SH-022`), `PracticeClient.tsx` virtualized nav + `autoNext` cancel (`SH-025`), 100% 3-way SM-2 parity (`v2-acceptance.test.ts` + `DB_BACKEND_AUDIT.md` §7.1); live runtime gated on `BLK-001`. |
| **23** | Mistakes Bank (`/review`), Starred (`/starred`), Library, Editor, Dashboard, History, Statistics, Clone & Account Restore integrity | **`VERIFIED (CODE & UNIT/MOCK — LIVE DB BLOCKED)`** | `REGRESSION_REPORT.md` §3 (`SH-009`, `SH-020`, `SH-024`, `SH-033`, `SH-035`, `SH-036`, `SH-037`) + `DB_BACKEND_AUDIT.md` §7.2: exam answers in `/api/mistakes`, `clone_study_set()` RPC enforcing `allow_clone`, Library pagination & favorites, Editor chapter/tag/difficulty filters & `<AlertDialog>`, Dashboard streak/exams, History nullable `study_set_id` routing, `POST /api/account/restore` UI; live DB gated on `BLK-001`. |
| **24** | All 5 `/settings` study & accessibility toggles wired end-to-end (`PreferencesProvider` & `<MotionConfig>`) | **`VERIFIED (CODE & UNIT/MOCK — LIVE DB BLOCKED)`** | `src/lib/preferences/index.tsx` (`useUserPreferences()`, `playFeedbackSound`, `html[data-reduced-motion]`) wired into `src/app/providers.tsx` (`<MotionConfig reducedMotion>`) and consumed across all 12 provider/layout/learning/exam files (`UIUX_AUDIT.md` §6.1, `#74`); live DB sync gated on `BLK-001`. |
| **25** | Bilingual UI (Vietnamese default + instant English toggle, localized `<title>` & skip link persisting across reload, zero auto-translation of user study content) | **`VERIFIED`** | Fresh Playwright `studyhub.spec.ts` (`#72` fix verified live on `:3013`): VI default -> EN switch -> `page.reload()` preserves English `<h1>`, `<title>`, and skip link -> toggle back to VI; `after_01`/`after_02` screenshots (`USER_EXPERIENCE_REPORT.md` §8); zero content translation code. |
| **26** | Academic Calm Design System, Light/Dark themes, WCAG 2.2 AA contrast, semantic headings, App Router boundaries & zero dev jargon | **`VERIFIED`** | `UIUX_AUDIT.md` §6.2 (`#74`): **31/31** live contrast pairs PASS (Light `--input` `4.76:1`, Dark `--primary` `6.29:1`, etc.), all 6 App Router boundaries (`error`, `loading`, `not-found`, `global-error`, `(app)/error`, `(app)/loading`), 35/35 page `metadata`; fresh Playwright `:3013` & `real-user` `#82` verified Light/Dark `menuitemradio`, `prefers-reduced-motion`, semantic `<h1>`, branded 404, 0 dev jargon (`after_03`, `after_10`, `after_11`). |
| **27** | Responsive layout (`360px`–`1920px`), zero horizontal overflow, zero mobile header clipping, `>=44px` touch targets & 1-hand mobile bottom nav | **`VERIFIED (CODE & UNIT/MOCK — LIVE DB BLOCKED)`** | **Public/Auth Verified LIVE:** Fresh Playwright `:3013` passed all **6/6 viewports** (`360`–`1920px`); `real-user` Pass 2 (`#82`, `final_landing_mobile_390_vi.png`, `final_landing_mobile_360_en.png`, `after_13_register_mobile_390_dark.png`) confirmed `anyClippedRight: false`, `overflowX: false`, `sub44Controls: []`. **Auth `AppShell` 5-tab bar** (`Thi thử` center slot, safe-area clearance, `V2-01` mobile sticky offset) verified in code (`UIUX_AUDIT.md` §6.3 `#74`); live authenticated browser pass gated on `BLK-001`. |
| **28** | Security hardening: all Wave 1 P0/P1/P2 vulnerabilities + Wave 3 reopens closed, prod CSP/HSTS, `0` High/Critical `npm audit` | **`VERIFIED (CODE & UNIT/MOCK — LIVE DB BLOCKED)`** | Fresh `npm audit --omit=dev` **0 Critical / 0 High** (2 moderate `exceljs->uuid` documented); fresh Playwright verified prod HSTS + clean CSP (no localhost/`unsafe-eval`); fresh `vitest` (`tests/unit/security/*` **37/37 PASS**); `SECURITY_AUDIT.md` §9 (`2/2 P0, 6/6 P1, 8/8 P2, 5/6 P3, 1/1 P4` + `5/5` Wave 3 reopens verified); live 2-account RLS tests gated on `BLK-001`. |
| **29** | Private media Storage RLS (`study-media`), server-side magic-byte validation & durable signed-URL proxy (zero expiring 1h URLs or `.getPublicUrl()`) | **`VERIFIED (CODE & UNIT/MOCK — LIVE DB BLOCKED)`** | Fresh static scan: `GET_PUBLIC_URL_HITS=0`; `POST /api/uploads/image` (pre-buffer 5MB/0B cap, `validateImageUpload` magic bytes, SVG ban, canonical `avatars/{uid}` & `{owner}/{set}` paths); `GET /api/uploads/signed-url?redirect=1` (`Cache-Control: private, max-age=300`, `Vary: Cookie`); `profile-view.tsx` & `question-editor-view.tsx` persist `proxyUrl` (`#64`, `#68`); live Storage RLS test gated on `BLK-001`. |
| **30** | Migration immutability (`0001`–`0004` untouched), idempotent `0005` schema/RLS/index hygiene & lean production client bundles | **`VERIFIED (CODE & UNIT/MOCK — LIVE DB BLOCKED)`** | Fresh `git diff f09a8ed -- supabase/migrations/0001..0004` = `UNMODIFIED_0_LINES`; `26/26` tables with RLS enabled; `76/76` `(SELECT auth.uid())`, `35/35` unique new indexes in `0005`, `0` `FOR SHARE` deadlocks (`DB_BACKEND_AUDIT.md` §7.1); `/sets/[id]/edit` `-21.6%` gzip, `/profile` `-25.1%` gzip, `/exams/new` `147.2 KB` gzip (`PERFORMANCE_REPORT.md` §5.4); live migration apply gated on `BLK-001`. |
| **31** | Live PostgreSQL 15 migration execution (`supabase db reset` / `db push`), `supabase db advisors` (0 warnings) & 10k-Q `EXPLAIN (ANALYZE, BUFFERS)` | **`BLOCKED`** | `BLK-001` verified fresh in Wave 4: Docker Desktop stopped (`DOCKER_EXIT=-1`), `.env.local` absent (`ENV_LOCAL_EXISTS=False`), `supabase` CLI absent (`WHERE_SUPABASE_EXIT=1`), `supabase_mcp` unsigned. |
| **32** | Live 2-account authenticated E2E journeys (core study/import/exam + V2.0 multi-subject/presets + Full Coverage) & live PostgREST cross-account RLS/Storage negative suite | **`BLOCKED`** | `BLK-001` verified fresh in Wave 4: `tests/e2e/authenticated-journey.spec.ts` (`SH-041` repaired + V2.0 Scenarios 2 & 3 added) cleanly skips `3/3` when `E2E_SUPABASE_READY!=1`; live execution awaits Supabase credentials / Docker Desktop. |

**32-Item Acceptance Summary:** **`7` `VERIFIED`** · **`23` `VERIFIED (CODE & UNIT/MOCK — LIVE DB BLOCKED)`** · **`2` `BLOCKED` (`BLK-001`)** · **`0` `FAILED`** · **`0` `NOT IMPLEMENTED`**.

---

## 5. Final Issue Tracker Accounting (Wave 1 Baseline + Wave 3 Reopens)

### 5.1 Wave 1 Master Issue Tracker (`SH-001`–`SH-044` = 44 Consolidated Tickets Covering 56 Baseline Issues)

| Severity | Wave 1 Baseline Issues | Consolidated Tickets | Fixed by Wave 2/3 | Independently Verified (`CLOSED` / `VERIFIED`) | Documented / Accepted Risk | Remaining Open / Reopened |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| **P0 (Critical / Blocker)** | 11 | 11 (`SH-001`–`SH-011`) | 11 | **11** *(2 `CLOSED`, 9 `VERIFIED — LIVE DB BLOCKED`)* | 0 | **0** |
| **P1 (Major / Security / Core)** | 22 | 22 (`SH-012`–`SH-033`) | 22 | **22** *(3 `CLOSED`, 19 `VERIFIED — LIVE DB BLOCKED`)* | 0 | **0** |
| **P2 (Functional / WCAG / Perf / Sec)** | 17 | 8 (`SH-034`–`SH-041`) | 8 | **8** *(2 `CLOSED`, 6 `VERIFIED — LIVE DB BLOCKED`)* | 0 | **0** |
| **P3 (Minor / Hygiene)** | 6 | 3 (`SH-042`–`SH-044`) | 2 | **2** *(2 `CLOSED`)* | **1** (`SH-044`: `exceljs -> uuid@8.3.2`) | **0** |
| **Total Wave 1 Code Issues** | **56** | **44** | **43** | **43** *(9 `CLOSED`, 34 `VERIFIED — LIVE DB BLOCKED`)* | **1** | **0** |
| **External Blockers (`BLK-001`)** | — | 1 | — | — | — | **1 (`BLOCKED`)** |

### 5.2 Wave 3 Independently Caught & Resolved Defects (Audit Trail Proof)

During Wave 3 independent verification, all 6 independent auditors caught and reopened **31** genuine defects across builds, SQL migrations, security boundaries, performance, accessibility, and live mobile viewports — proving the verification loop actively prevented regressions rather than rubber-stamping:

| Discovering Auditor | Reopen Refs | P0 | P1 | P2 | P3 | Total Caught | Fixed & Re-Verified | Remaining |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `func-tester` | `#57`, `#60`, `#71` | 1 | 1 | 2 | 0 | **4** | **4 / 4** (`#58`, `#64`, `#68`, `#79`) | **0** |
| `uiux-auditor` | `#59` | 0 | 3 | 6 | 0 | **9** | **9 / 9** (`#62`, `#67`, `#68`) | **0** |
| `security-auditor` | `#63` | 0 | 1 | 4 | 0 | **5** | **5 / 5** (`#76`) | **0** |
| `db-backend-auditor` | `#65`, `#77` | 3 | 5 | 2 | 0 | **10** | **10 / 10** (`#70`, `#76`, `#78`) | **0** |
| `real-user` | `#66` | 0 | 1 | 0 | 1 | **2** | **2 / 2** (`#72`) | **0** |
| `perf-import-auditor` | `#69` | 0 | 1 | 0 | 0 | **1** | **1 / 1** (`#73`) | **0** |
| **Total Wave 3 Reopened Defects** | — | **4** | **12** | **14** | **1** | **31** | **31 / 31 (100%)** | **0** |

### 5.3 Section 26 Acceptance Test Matrix (`docs/audit/TEST_MATRIX.md` — 90 Cases)

- **Wave 1 Baseline:** `37 FAIL` + `38 NOT IMPLEMENTED` (`75` failing/missing cases).
- **Wave 3/4 Final:** **`0 FAIL`**, **`0 NOT IMPLEMENTED`**, **`5 PASS`** (fully live/real-file), **`49 PASS (Unit/Mock — Live DB Blocked)`**, **`32 VERIFIED IN CODE (Live DB Blocked)`**, **`4 BLOCKED (BLK-001)`**.

### 5.4 Documented Non-Blocking Post-V2.0 Polish Backlog (Honest Disclosure)

None of the items below block release or affect core data integrity, security, or V2.0 acceptance criteria; all are documented transparently:
1. **`SH-044` / `SEC-019` (P3):** `exceljs@4.4.0` depends transitively on `uuid@8.3.2` (`GHSA-w5hq-g745-h8pq`, moderate). StudyHub uses `node:crypto` exclusively for all tokens/IDs/shuffling; `npm audit fix --force` was intentionally NOT run (would downgrade `exceljs` to broken `3.4.0`).
2. **`BUG-040` (P3):** Non-fatal Vite CJS deprecation notice on `vitest.config.ts:1:1` (all 167 tests pass).
3. **DOCX Direct Binary Media Upload (`TC-IMP-06`, P3):** Dead `/docx-media/...` 404 paths are now safely stripped with `EMBEDDED_IMAGE_SKIPPED`; direct upload of embedded DOCX images to `study-media` during commit remains an optional future enhancement.
4. **Optional UI Convenience Items (P3/P4):** Custom expiry date selector UI in `ShareDialog` (API/RPC already enforce `expires_at`), dedicated "Blocked Users" tab in `FriendsView` (block API & `blocked_by` RLS active), full-text reveal popover for `line-clamp-4` in `MatchClient` (`LM-07`), `sets/route.ts:54,124` 100-shared-set slice (`P2` scale note if one account has >100 shared sets), 404 `<title>` staying VI in EN mode while `<h1>`/body localize cleanly (`P4`), and `F` hotkey precedence over 6th option on 6-option questions (digit `6` selects Option F, `P3`).

---

## 6. Independent Audit Trail Index

- Functional Baseline & Bug Register: [`docs/audit/AUDIT_REPORT.md`](./AUDIT_REPORT.md) (`func-tester`)
- Section 26 Test Matrix (90 Cases): [`docs/audit/TEST_MATRIX.md`](./TEST_MATRIX.md) (`func-tester`)
- Wave 3 Functional Regression Report: [`docs/audit/REGRESSION_REPORT.md`](./REGRESSION_REPORT.md) (`func-tester`)
- Master Issue Tracker (Updated Wave 4): [`docs/audit/ISSUE_TRACKER.md`](./ISSUE_TRACKER.md) (`final-auditor`)
- Live Real-User UX Report & Screenshots: [`docs/audit/USER_EXPERIENCE_REPORT.md`](./USER_EXPERIENCE_REPORT.md) (`real-user`)
- UI/UX, WCAG 2.2 AA & Design Spec: [`docs/audit/UIUX_AUDIT.md`](./UIUX_AUDIT.md) (`uiux-auditor`)
- DB, RLS, RPC & Backend API Audit: [`docs/audit/DB_BACKEND_AUDIT.md`](./DB_BACKEND_AUDIT.md) (`db-backend-auditor`)
- Independent Security & Dependency Audit: [`docs/audit/SECURITY_AUDIT.md`](./SECURITY_AUDIT.md) (`security-auditor`)
- Real-File Import & Performance Audit: [`docs/audit/PERFORMANCE_REPORT.md`](./PERFORMANCE_REPORT.md) (`perf-import-auditor`)
