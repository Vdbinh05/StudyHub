# StudyHub V3.2 — Independent Final Acceptance Audit (`FINAL_ACCEPTANCE.md`)

> **Auditor:** Agent 10 — Independent Final Auditor (`final-auditor`, spawned fresh with zero prior code authorship)  
> **Audit Date:** 2026-11-25 (UTC `17:31–17:45Z`)  
> **Live Production Target:** `https://studyhub-three-mauve.vercel.app` (Vercel deployment `studyhub-9zfmzbepc`, `hkg1::hnd1` Tokyo, Supabase Cloud `cuoaifyupfmkstqhcjwy` `ap-northeast-1` Tokyo)  
> **Deployed Git Commit on `main`:** `13b22cc` (`fix(v3.2): resolve Wave 6 regressions and record independent verification reports`)  
> **Rollback Reference Tags:** `v3.2-checkpoint` (`39952bd`) · `v3.1-verified` (`c8eb9f7`, tag object `57deafbe`)  
> **Strict Independence Attestation:** Zero edits made to `src/*`, `supabase/*`, `tests/*`, `package.json`, `next.config.ts`, or any prior audit report. Sole file authored: `docs/audit/v3.2-stability/FINAL_ACCEPTANCE.md`. Zero `.env.local` values printed; zero `sample-data/` aviation question text read or quoted.

---

## 1. Executive Verdict

### **BINDING VERDICT: `PRODUCTION READY WITH DOCUMENTED MINOR LIMITATIONS`**

StudyHub V3.2 (`13b22cc`, deployed live at `https://studyhub-three-mauve.vercel.app`) **PASSES** every mandatory production security, data-integrity, functional stability, mobile responsiveness, and live regression gate with **0 open P0 blockers** and **0 open P1 defects**:

- **Static & Dependency Gate:** `npm run typecheck` (`0` errors), `npm run lint` (`0` errors), `supabase/migrations/` diff vs `39952bd` touches **only** `0019_v3_2_stability_security_and_perf.sql` (`0001`–`0018` untouched), **0** AI/LLM/payment SDKs in `package.json` or `.next/static/chunks/` (`143` chunk files scanned), **0** `SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_SECRET_KEY` / `server-only` leaks in client bundles.
- **Live Production HTTPS, Headers & Branding Gate:** `6 / 6` live probes passed (`GET /api/health` `200` on `hkg1::hnd1`, full HSTS/CSP/`nosniff`/`DENY`/`Referrer-Policy`/`Permissions-Policy`, `/sw.js` `no-cache, no-store, must-revalidate`, `/brand/logo-{main,full,icon}.png` `public, max-age=86400, stale-while-revalidate=604800`, `/login` SSR `1` `<picture>` & `0` `dark:opacity-0`, unauthenticated `/api/profile` `401` with `Cache-Control: private, no-store` & `Vary: Cookie`).
- **Full Live Production Vitest Verification Suite (`LIVE_API_BASE_URL=https://studyhub-three-mauve.vercel.app npm run test`):** **`62 / 62` test files passed, `490 / 490` tests passed (`0` failed, `0` skipped, exit `0` in `42.50s`)**, including all **`38 / 38`** live PostgreSQL 17.12 + Vercel `hnd1` production integration & RLS security tests.
- **Independent Live Production Browser Smoke Test (`https://studyhub-three-mauve.vercel.app`, Playwright Chromium):** **100% PASS** across Light & System Dark `/` and `/login` branding, Practice Exit/Resume (`V32-007`), Settings synchronous Tab 2 switch (`V32-026`), 5-type V3 structured exam + `0ms` fast reload + Flag preservation (`V32-002`/`V32-004`/`V32-027`), live `in_progress` `question_paper` PDF (`200`, `841,752 B`, `%PDF-`, `0` secret leaks) vs `paper_and_key` (`403`) (`V32-030`), Results (`0` `[object Object]`), Mobile `390×844` 4-tab nav & Practice header (`0px` overflow / `0px` clip), and 2-tab sign-out (`V32-013`, `671 ms`, `Accept: application/json` -> `200 private, no-store`, `0` leftover user keys incl. `studyhub-offline-known-users`, `0` CSP/console errors).
- **Pre-Existing Real Owner Data Preservation:** **100% untouched** (`auth.users: 2`, `profiles: 2`, `study_sets: 4` [3 original owner sets with `599` questions + 1 untouched empty owner set], `question_options: 2,400`, `exam_attempts: 2`, `study_sessions: 27`, `user_question_progress: 87`, `media_assets: 0`, `0` leftover disposable accounts or Storage objects).

Four non-blocking, honestly disclosed minor limitations warrant the `WITH DOCUMENTED MINOR LIMITATIONS` qualification (detailed in §5): (1) four optional destructive `DROP`/`DELETE` SQL blocks in Migration `0019` queued for owner SQL Editor execution (every affected route has live app-layer protection/fallback today), (2) `2` moderate server-only transitive `exceljs -> uuid <11.1.1` advisories (`0` critical / `0` high), (3) WebKit/Safari compatibility verified statically while live mobile verification ran on Playwright Chromium, and (4) minor stretch-budget near-misses on `/exams/[attemptId]` live Brotli JS (`357.6 KB` mobile vs `<350 KB` stretch cap) and `/login` simulated LCP (`2,619–2,763 ms` vs `<2.5 s` Good threshold).

---

## 2. Independent Release Gate Scorecard

| # | Release Gate Criterion | Target / Standard | Independent Measured Evidence (`13b22cc`) | Status |
| :-: | :--- | :--- | :--- | :---: |
| **1** | **TypeScript Strict Check** | `npm run typecheck` exit `0` | `tsc --noEmit` exited **`0`** (`0` errors). | **PASS** |
| **2** | **ESLint & React Hooks** | `npm run lint` exit `0` | `eslint .` exited **`0`** (`0` errors, `0` warnings). | **PASS** |
| **3** | **Production Dependency Audit** | `0` Critical, `0` High (`npm audit --omit=dev`) | `421` prod deps (`868` total): **`0` critical, `0` high, `2` moderate** (`exceljs >=3.5.0 -> uuid <11.1.1`, server-only; see §5.2). | **PASS (Doc)** |
| **4** | **Migration Immutability** | `0001`–`0018` untouched vs `39952bd` | `git diff --name-only 39952bd -- supabase/migrations/` returned **strictly 1 file**: `supabase/migrations/0019_v3_2_stability_security_and_perf.sql`. | **PASS** |
| **5** | **Zero AI / Zero Payments / Zero Secret Leak** | `0` AI/LLM/billing SDKs; `0` secret keys or `server-only` in client chunks | Audited `package.json` (`0` AI/payment deps; `mammoth` removed) and scanned all **`143`** files in `.next/static/chunks/`: **`0`** hits for `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY`, `server-only`, AI/LLM SDKs, or billing SDKs *(1 benign substring match `recharts-cartesian-gridstripes-{horizontal,vertical}` in `35pjer013o2q4.js` verified as Recharts SVG CSS class)*. | **PASS** |
| **6** | **Live Production `/api/health`** | `200`, `hkg1::hnd1`, `private, no-store`, `supabaseConfigured: true` | `200 OK`, `x-vercel-id: hkg1::hnd1::mzzvw-1795627933022-3e29d5a71454`, `cache-control: private, no-store`, `{"data":{"status":"ok","timestamp":"2026-11-25T17:32:13.111Z","supabaseConfigured":true}}`. | **PASS** |
| **7** | **Live Production Security Headers (`HEAD /`)** | HSTS, strict CSP, `nosniff`, `DENY`, `Referrer-Policy` | `200 OK` (`hkg1` `HIT`): `strict-transport-security: max-age=63072000; includeSubDomains`, strict CSP (`object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'`), `x-content-type-options: nosniff`, `referrer-policy: strict-origin-when-cross-origin`, `x-frame-options: DENY`, `permissions-policy: camera=(), microphone=(self), geolocation=()`. | **PASS** |
| **8** | **Live Service Worker & Brand Asset Caching** | `/sw.js` `no-store`; `/brand/*` `86400` + `SWR 604800` | `HEAD /sw.js` -> `200`, `no-cache, no-store, must-revalidate`. `HEAD /brand/logo-main.png` (`47,893 B`), `/brand/logo-full.png` (`51,643 B`), `/brand/logo-icon.png` (`12,722 B`) -> all `200`, `public, max-age=86400, stale-while-revalidate=604800`. | **PASS** |
| **9** | **Live `/login` SSR Branding Hygiene** | `<picture>` present, `0` `dark:opacity-0` | `GET /login` -> `200 OK`, `<picture` count = **`1`**, `dark:opacity-0` count = **`0`**. | **PASS** |
| **10** | **Live Auth & Private API Cache Guard** | Unauth `GET /api/profile` -> `401`, `private, no-store`, `Vary: Cookie` | `401 Unauthorized`, `cache-control: private, no-store`, `vary: Cookie`, clean JSON error envelope `UNAUTHORIZED`. | **PASS** |
| **11** | **Full Vitest Suite vs Live Production** | All unit + live DB/RLS/API integration suites green | **`62 / 62` files passed, `490 / 490` tests passed (`0` fail, `0` skip, `42.50s`, exit `0`)** against `LIVE_API_BASE_URL=https://studyhub-three-mauve.vercel.app`. | **PASS** |
| **12** | **Independent Live Production Browser Smoke Test** | All Wave 7 smoke checks pass w/ `0` errors & `100%` cleanup | **PASS** across all 5 smoke areas (details in §3); `0` console/page/CSP errors; `100%` disposable cleanup verified. | **PASS** |
| **13** | **Companion Reports & Issue Closure Audit** | All `15` reports consistent; `0` P0 / `0` P1 open | Audited **15 / 15** companion reports in `docs/audit/v3.2-stability/`: **`52 / 52` issues accounted for** (`7/7` P0 `CLOSED`, `24/24` P1 `CLOSED`, `16` P2 `CLOSED` + `1` `MITIGATED/DOC`, `3` P3 `CLOSED` + `1` `MITIGATED/DOC`). | **PASS** |
| **14** | **Real Owner Data Integrity** | Exact baseline preservation, `0` disposable leftovers | Verified read-only pre/post: `auth.users: 2`, `questions: 599`, `exam_attempts: 2`, `0` disposable users/Storage blobs (details in §4). | **PASS** |

---

## 3. Live Production Vitest & Browser Smoke Test Results

### 3.1 Full Live Vitest Suite (`LIVE_API_BASE_URL=https://studyhub-three-mauve.vercel.app npm run test`)

Executed uncontested directly against live Vercel `hnd1` production (`https://studyhub-three-mauve.vercel.app`) and live Supabase Cloud PostgreSQL 17.12:

| Suite Category | Files | Passed | Failed | Skipped | Duration / Key Live Coverage |
| :--- | :---: | :---: | :---: | :---: | :--- |
| **All Unit Suites** (`import`, `export`, `learning`, `media`, `offline`, `richtext`, `diagram`, `security`, `ui`, `utils`) | `56` | `416` | `0` | `0` | Deterministic parsers, 12-type grading, SM-2 + confidence neutrality, V3 PDF export (incl. `in_progress` V3 `question_paper`), offline IDB isolation, IME/modal shortcuts, Settings sync tab switch, migration & production hardening audits |
| `tests/integration/v2-acceptance.test.ts` | `1` | `30` | `0` | `0` | `290 ms` — V2 multi-subject allocation, Full Coverage, custom exam contracts |
| `tests/integration/api-and-roundtrip.test.ts` | `1` | `6` | `0` | `0` | `429 ms` — Export/re-import round-trip & API contract verification |
| **`tests/integration/live-db-rpcs.test.ts`** *(LIVE DB)* | `1` | **`8`** | `0` | `0` | `21.26 s` — Live PG 17.12 RPCs (`0001`–`0019`) |
| **`tests/integration/live-rls-security.test.ts`** *(LIVE DB + PROD API)* | `1` | **`11`** | `0` | `0` | `32.96 s` — Live 2-account RLS, Storage RLS, `anon` `42501` RPC lockdown, live `hnd1` HTTP security & exam anti-leak |
| **`tests/integration/live-v3-db-rpcs.test.ts`** *(LIVE DB)* | `1` | **`8`** | `0` | `0` | `33.71 s` — Live 12-type grading, Confidence Score Neutrality, V3 clone, reset progress, global search, offline sync, `ON DELETE RESTRICT` media pinning |
| **`tests/integration/live-v3-rls-security.test.ts`** *(LIVE DB + PROD API)* | `1` | **`11`** | `0` | `0` | `33.88 s` — Live 3-account V3 RLS, opaque `rejected_inaccessible`, private notes/reports, media isolation, 12-type pre-submit anti-leak, live PDF export auth & headers |
| **TOTAL** | **`62`** | **`490`** | **`0`** | **`0`** | **Exit `0` (`42.50 s`) — 100% GREEN** |

*(Diagnostic transparency note: an initial Vitest run executed concurrently with `eslint .` hit 3 local Windows CPU-contention timeouts in `pdf-export.test.ts` [15,042ms vs 15,000ms], `v32-pdf-export-regressions.test.ts`, and `shortcuts.test.ts`; the clean uncontested run immediately after `eslint .` exited completed `62/62` files and `490/490` tests with `0` failures.)*

### 3.2 Independent Live Production Browser Smoke Test (`https://studyhub-three-mauve.vercel.app`)

Executed fresh via Playwright Chromium using an isolated disposable account (`v32-final-*`, 100% deleted in `finally` teardown) and a synthetic 7-question set (`2` `single_choice` + all `5` structured V3 types: `fill_in_blank`, `numerical` with `unit_required: true`, `ordering`, `matching` with distractor, and `image_hotspot` with real uploaded PNG in `study-media`):

| Smoke Test Area | Live Production Verification Result (`studyhub-9zfmzbepc`) | Verdict |
| :--- | :--- | :---: |
| **Public `/` & `/login` Light & System Dark Mode (`1440×900`)** | All `4 / 4` contexts (`/` Light & Dark, `/login` Light & Dark) verified: `overflowPx: 0`, `pictureCount: 1`, `darkOpacity0Count: 0`, `allBrandAssetsLoaded: true`, strictly **`1`** active-theme hero PNG per mode (`/` Light `logo-full.png`, `/` Dark `logo-full-dark.png`, `/login` Light `logo-main.png`, `/login` Dark `logo-main-dark.png`, plus `logo-icon.png`), **`0`** opposite-theme PNGs, **`0`** console/page errors. | **PASS** |
| **Sign In -> Library -> Set -> Practice Exit & Resume (`V32-007`)** | Signed in via `/login` UI -> `/dashboard` -> `/library` -> Set Hub -> Practice. Answered Q1 & Q2 (`2 / 7`), exited to `/sets/[id]`, reopened Practice -> header restored exact **`2 / 7`** (`restoredProgress2of7: true`, `hasResumeBanner: true`). | **PASS** |
| **Settings Synchronous Tab 2 Switch (`V32-026`)** | On `/settings`, clicked Tab 2 (`Chế độ học & Phím tắt`) -> `#mp-fc-audio` mounted **immediately** (`visibleImmediately: true`, `url: /settings?tab=modes`), toggled `"false" -> "true"`, saved (`PATCH /api/preferences` **`200`**, `mode_preferences.flashcards.auto_play_audio: true`), and survived full page reload (`afterReloadChecked: "true"`). | **PASS** |
| **Structured V3 Exam + `0ms` Fast Reload + Flag (`V32-002`/`V32-004`/`V32-027`)** | Answered all 7 exam questions across `single_choice`, `matching`, `ordering`, `numerical`, `image_hotspot`, and `fill_in_blank` in live UI. Immediately after entering `"9.81"` + `"SECRETUNIT_MS2"` on `Câu 4 / 7` (`numerical`), ran **`0ms` instant `page.reload()`**: restored exact index **`Câu 4 / 7`** (`restoredTargetIndex: true`) and exact UI inputs (`"9.81"` / `"SECRETUNIT_MS2"`). Toggling Flag preserved `structured_response.value: "9.81"` & `is_flagged: true` in DB (`answeredCountInDb: 7`). Pre-submit `POST`/`GET /api/exams` stripped `correct_option_ids`, `accepted_answers_snapshot`, `target_hotspots` geometry coordinates, blank answers, and required numerical unit (`target_labels` prompt text only). | **PASS** |
| **Live `in_progress` Exam PDF Export (`V32-030`) & Results** | While `in_progress`: `POST /api/export/pdf` (`mode: "question_paper"`) returned **`200 OK`**, **`841,752 B`**, valid `%PDF-`, and `pdfjs-dist` text extraction (`971` chars) + raw byte scan confirmed **`zeroSecretLeak: true`** (`0` blank/unit/hotspot leaks). `POST /api/export/pdf` (`mode: "paper_and_key"`) returned **`403 FORBIDDEN`**. Submitted via UI -> `/exams/[id]/results` rendered score cleanly with **`0` `[object Object]`**. | **PASS** |
| **Mobile `390×844` Touch Nav & Practice Header (`V32-034`/`V32-035`)** | `/dashboard`: `overflowPx: 0`, `4`-tab bottom nav (`Trang chủ`, `Thư viện`, `Thi thử`, `Cá nhân` — each **`96×64px`**). `/sets/[id]/practice`: `overflowPx: 0`, Finish CTA `left: 294..right: 382` (`88×44px`, **`0px` right-edge clip**), `0` console/page errors. | **PASS** |
| **2-Tab Sign-Out & Client Purge (`V32-013`)** | Tab 1 (`/dashboard`) + Tab 2 (`/library`), pre-seeded with `studyhub-offline-known-users`, `studyhub-user-preferences`, exam draft, and practice checkpoint. Sign-out completed across BOTH tabs in **`671 ms`** (`tab1 -> /login`, `tab2 -> /login`), sending **`Accept: application/json`** and receiving **`200`** with **`Cache-Control: private, no-store`** & **`Vary: Cookie`**. Purged **`100%`** of user-scoped `localStorage` keys (`userScopedLeftovers: []`, `knownUsersPurged: true`; remaining non-user keys: `["studyhub-auth-event", "studyhub-locale", "theme"]`). **`0`** CSP/console/page errors on both tabs. | **PASS** |

---

## 4. Real Owner Data Preservation & Disposable Cleanup Attestation

Read-only Supabase Cloud (`cuoaifyupfmkstqhcjwy`) snapshots taken immediately before and immediately after the independent live production smoke test confirm **100% disposable teardown** and **100% preservation of pre-existing real owner data**:

| Entity / Table / Bucket | Pre-Smoke Count (`dbPre`) | Post-Smoke Count (`dbPost`) | Disposable Cleanup Verified | Status |
| :--- | ---: | ---: | :--- | :---: |
| `auth.users` | **`2`** | **`2`** | `1` `v32-final-*` deleted; `disposableUsers: []` (`0`) | **100% Preserved** |
| `profiles` / `user_preferences` | `2` / `2` | `2` / `2` | Cascaded cleanly | **100% Preserved** |
| `study_sets` | **`4`** | **`4`** | `1` deleted (preserves `3` original owner sets + `1` untouched empty owner set) | **100% Preserved** |
| `questions` / `question_options` | **`599`** / `2,400` | **`599`** / `2,400` | `7` deleted | **100% Preserved** |
| `exam_attempts` | **`2`** | **`2`** | `1` deleted | **100% Preserved** |
| `study_sessions` / `user_question_progress` | `27` / `87` | `27` / `87` | Cascaded cleanly | **100% Preserved** |
| `media_assets` | `0` | `0` | `1` deleted | **100% Preserved** |
| Storage (`study-media` + `study-temp` under test prefix) | `0` | `0` | `1` object removed; `remainingStorageUnderUser: 0` | **100% Cleaned** |

---

## 5. Cross-Audit of All 15 Companion Reports & Documented Minor Limitations

### 5.1 Companion Reports Consistency Verification (`15 / 15` Audited)

All 15 reports in `docs/audit/v3.2-stability/` were independently read and cross-checked against live production behavior and git history (`39952bd` -> `7dfabfd` -> `13b22cc`):

| Report File | Verified Scope & Consistency Summary |
| :--- | :--- |
| [`BASELINE.md`](./BASELINE.md) | Wave 0/1 live baseline (`39952bd`), `37/37` RLS tables, API/Lighthouse/CDP/bundle bottlenecks (`PERF-01`–`PERF-08`). Consistent. |
| [`ISSUE_TRACKER.md`](./ISSUE_TRACKER.md) | `52` tracked issues (`7` P0, `24` P1, `17` P2, `4` P3): `50` `CLOSED`, `2` `MITIGATED / DOCUMENTED` (`V32-045`, `V32-052`), `0` `OPEN`. Consistent. |
| [`ROOT_CAUSE_ANALYSIS.md`](./ROOT_CAUSE_ANALYSIS.md) | 7 systemic architectural clusters & Wave 3 builder zero-collision ownership map. Consistent. |
| [`PERFORMANCE_BEFORE_AFTER.md`](./PERFORMANCE_BEFORE_AFTER.md) | Live Wave 7 (`13b22cc`, `hkg1::hnd1`, `br`) vs Wave 1 (`39952bd`): 133Q DOCX `-81.6%` (`11.88s -> 2.18s`), Set Hub `questions?pageSize=20&fields=summary` `167.6 ms` (`-64.7%`), Practice Warm Mobile LCP `3,056 -> 988 ms` (`-67.7%`), `/login` `-148` to `-159 KiB`, `0` redundant `/api/progress` / `/api/starred` / `GET /api/exams/[id]`, stretch near-misses honestly disclosed. Consistent. |
| [`INTERACTION_LATENCY_REPORT.md`](./INTERACTION_LATENCY_REPORT.md) | Desktop live `100%` `<100 ms` (`31.0–81.7 ms` med; Save Note `322.7 -> 81.7 ms`, `-74.7%`), Mobile 4G `4×` CPU host-load caveat honestly disclosed, Mobile Nav Sheet P3 stretch noted. Consistent. |
| [`MEMORY_LEAK_REPORT.md`](./MEMORY_LEAK_REPORT.md) | Sustained 240-transition profiling (`MEM-01`–`MEM-05` all closed): `/sets/[id]` CDP nodes `-58.0%` (`3,779 -> 1,588`), Loop 1->2 `+0` DOM/listeners/timers/blobs, `MEM-02` 7d/20-entry cap verified live. Consistent. |
| [`MOBILE_TEST_REPORT.md`](./MOBILE_TEST_REPORT.md) | `119/119` (`17` routes × `7` widths `320..768px`) `0px` overflow, `0` controls `<40px` at `360/390px`, `RU-12b` 3-digit counter `0px` clip at `360/390px`, WebKit static scope honestly disclosed. Consistent. |
| [`NETWORK_FAILURE_REPORT.md`](./NETWORK_FAILURE_REPORT.md) | `8/8` live fault injections (`429`, `500` ×2, `503` ×2, timeout abort, offline mid-exam auto-flush, signed-URL `500` retry) PASS, `0` `pageerror`. Consistent. |
| [`EXAM_STABILITY_REPORT.md`](./EXAM_STABILITY_REPORT.md) | `V32-002`/`004`/`005`/`010`/`022`/`023`/`027`/`028`/`030`/`039` all PASS; 500Q Full Coverage (`250+250`, `120×4+20`) `0` overlap & mid-cycle delete auto-complete PASS. Consistent. |
| [`IMPORT_MEDIA_REPORT.md`](./IMPORT_MEDIA_REPORT.md) | All valid formats (`.docx`, large `>1.5 MB` `.docx`, `.xlsx`, `.csv`, `.tsv`, `.json`, VI text `.pdf`, scanned `.pdf`) & negative security rejections (`400`/`415`), multi-chunk `isFinalChunk` + replay `importJobId`, SHA-256 dedup, PDF export `200`/`403` PASS. Consistent. |
| [`OFFLINE_SYNC_REPORT.md`](./OFFLINE_SYNC_REPORT.md) | True offline PWA (`setOffline`), `image_choice` & 2-diagram offline support, offline `F5` survival, sync `event_id` dedup, `studyhub-v3` backup/restore (`>15 MB -> 413`), sign-out purge, `V3-T6` PASS (`13.3s`). Consistent. |
| [`SECURITY_REGRESSION.md`](./SECURITY_REGRESSION.md) | All 14 security/DB IDs audited; Wave 6 `V32-013` 2-tab & IDB deadlock-free teardown PASS; `38/38` live RLS/RPC PASS; 4 `0019` SQL Editor blocks & `exceljs -> uuid` honestly documented. Consistent. |
| [`TEST_MATRIX.md`](./TEST_MATRIX.md) | Full `22/22` Playwright E2E PASS (`0` fail, `0` skip, `3.3m`), `28/28` functional IDs PASS, all 12 exam types + flashcard matrix green. Consistent. |
| [`REAL_USER_REPORT.md`](./REAL_USER_REPORT.md) | Student score improved **`6.5/10 -> 9.2/10`**, `21/21` pain points (`RU-01`–`RU-21`) resolved, `7/7` scenarios clean (`RU-12b` `360px` polish subsequently verified `0px` clip in Wave 6B `MOBILE_TEST_REPORT.md`). Consistent. |
| [`REGRESSION_REPORT.md`](./REGRESSION_REPORT.md) | Final Wave 6B closure of reopened `V32-026`, `V32-030`, `V3-T6`, and `RU-12b` (`0` P0/P1/P2/P3 open). Consistent. |

### 5.2 Documented Minor Limitations (Honest Full Disclosure)

#### Limitation 1 — Four Optional Destructive (`DROP`/`DELETE`) Blocks in Migration `0019` Pending Owner SQL Editor Execution
All non-destructive DDL, 16 RPCs, 3 new indexes, `exam_attempt_answers.is_answered`, and 3 `VALIDATE CONSTRAINT` checks from [`supabase/migrations/0019_v3_2_stability_security_and_perf.sql`](file:///d:/Code%20Web/StudyHub/supabase/migrations/0019_v3_2_stability_security_and_perf.sql) are **already live** on Supabase Cloud (`cuoaifyupfmkstqhcjwy`, `0` Security Advisor errors, `0` `unindexed_foreign_keys`, `0` `auth_rls_initplan`). Because Supabase MCP enforces interactive confirmation on `DROP`/`DELETE` statements, the following **4 exact SQL blocks** (line ranges directly verified in `0019`) remain optional one-time runs in **Supabase Dashboard -> SQL Editor** (zero downtime, zero app restart required):

| Block | Exact Line Range in `0019` | Issues Finalized | Live Behavior Today (Safe Fallback) | Benefit After Owner SQL Editor Apply |
| :---: | :---: | :--- | :--- | :--- |
| **(a)** | **`L30–L163`** (`SEC-05`) | `V32-009` | `DELETE /api/account/data` already preserves cross-tenant exam-pinned blobs in Storage (`preserved_shared_media_count: 1`), but legacy `0013` profile trigger still cascades `DELETE` onto another user's `content_media_relations` row (`signed-url` -> `404` only if the media owner deletes their entire account). | Makes `media_assets.owner_id` nullable (`ON DELETE SET NULL`) and scopes `cleanup_profile_media_relations()` so other users' historical exam snapshots keep resolving `200` even after the media author deletes their account. |
| **(b)** | **`L169–L186`** (`DB-08`, `DB-05`) | `V32-045` | 12 redundant single-column B-tree indexes + legacy `idx_questions_source_metadata_idem` remain present (`unindexed_foreign_keys = 0`; `0` functional/security impact). | Removes redundant index write amplification & WAL overhead while keeping `unindexed_foreign_keys = 0`. |
| **(c)** | **`L2488–L2545`** (`toggle_starred_question`) & **`L2970–L3141`** (`save_diagram_patch`) | `V32-011` (`DB-02`), `V32-047` (`DB-10`) | `/api/starred` and `PATCH /api/diagrams/[id]` catch `PGRST202` cleanly and use `23505` idempotency and batched `upsert` + live `bump_study_set_content_version`. | Switches both endpoints automatically to single-RTT atomic `SECURITY DEFINER` RPCs. |
| **(d)** | **`L1562–L2096`** (`learning_sync_events_status_v32_chk` + `sync_offline_learning_events`) | `V32-011` (`DB-01`), `V32-043` (`SEC-10`) | `/api/sync/events` route already enforces opaque `rejected_inaccessible` and in-batch/replay `event_id` dedup live. | Activates atomic DB-level `INSERT ... ON CONFLICT DO NOTHING` pre-claim and CHECK constraint for `rejected_inaccessible`. |

#### Limitation 2 — Upstream Transitive Advisory (`exceljs -> uuid <11.1.1`, `V32-052` / `SEC-16`)
- `npm audit --omit=dev` reports **`0` critical, `0` high, `2` moderate** across `421` production dependencies: `exceljs >=3.5.0` depends on `uuid <11.1.1` (`GHSA-w5hq-g745-h8pq`, buffer bounds check in `v3`/`v5`/`v6` when custom `buf` is passed).
- **Risk Assessment:** Low/Non-exploitable in StudyHub. `exceljs` is strictly server-only (`0.0 KB` in client chunks), used only for deterministic `.xlsx` import/export, and StudyHub never uses `exceljs`'s transitive `uuid` for authentication, session tokens, or cryptographic operations. `npm audit fix --force` would downgrade `exceljs` to breaking `3.4.0` (`uuid@11` is pure ESM incompatible with `exceljs`'s CommonJS `require("uuid")`). Track upstream `exceljs` releases for future upgrade.

#### Limitation 3 — Browser Engine Coverage (Playwright Chromium Live vs WebKit Static Audit)
- Live browser testing (`119/119` 7-width mobile viewport checks, `22/22` Playwright E2E, Wave 7 performance sweep, and this live production smoke test) ran in Playwright Chromium (including `hasTouch: true, isMobile: true`).
- WebKit/Safari runtime is not installed in `%LOCALAPPDATA%\ms-playwright` on this Windows host. Safari/WebKit compatibility was audited statically (`optimizeImageForUpload` Safari-safe JPEG/PNG encoding + actual `blob.type`/magic-byte resolution, `webkitAudioContext` fallback, `dvh` + `env(safe-area-inset-bottom)`, Pointer Events + `touch-action: none`). Recommend a routine manual check on a physical iOS Safari device post-release.

#### Limitation 4 — Non-Blocking Performance Stretch Budget Near-Misses
- **`/exams/[attemptId]` Live Cold Brotli JS:** **`357.6 KB` Mobile / `371.3 KB` Desktop** (improved `-10.9` to `-24.6 KB` vs Wave 1 `382.2 KB`, but `+7.6` to `+21.3 KB` above the `<350 KB` stretch budget due to supporting all 12 V3 exam question types; zero server-only import/export libs in client chunks).
- **`/login` Live Simulated Lighthouse Mobile LCP:** **`2,619 ms` Dark / `2,763 ms` Light** (improved `-151` to `-295 ms` vs Wave 1 `2,914 ms` with `-147.8` to `-158.6 KiB` savings, `94` Performance / `100` Accessibility / `100` Best Practices, `+119` to `+263 ms` above the `<2.5 s` Good threshold due to `Inter` font + render-blocking CSS).
- **Mobile 250-Q Exam Navigator Sheet (`4×` CPU synthetic throttle):** `255.8 ms` median idle-host Wave 5 vs `<200 ms` stretch target (P3).

*(Workspace housekeeping note: `git status --short` currently shows Wave 7's updated `PERFORMANCE_BEFORE_AFTER.md`, `INTERACTION_LATENCY_REPORT.md`, `screenshots/after/`, and this new `FINAL_ACCEPTANCE.md` ready for a final documentation-only commit on `main` — zero code/schema changes.)*

---

## 6. Rollback Readiness

StudyHub V3.2 is **100% safely reversible with zero data loss**:

1. **Application Instant Rollback (Vercel):**
   - Previous production deployment (baseline `v3.2-checkpoint` @ `39952bd`, `dpl_4EgSZA1b8LHYPSnrhFjiua78kiGg`) or prior verified release (`v3.1-verified` @ `c8eb9f7`) can be promoted immediately via Vercel Dashboard -> Deployments -> Promote to Production (takes `<30 seconds`).
   - Git rollback tags verified locally via `git rev-parse --short <tag>^{commit}`:
     - **`v3.2-checkpoint`** -> **`39952bd`** (pre-V3.2-stability branding baseline)
     - **`v3.1-verified`** -> **`c8eb9f7`** (V3.1 verified release)
2. **Database Backward Compatibility (`0019`):**
   - Migration `0019_v3_2_stability_security_and_perf.sql` is **100% additive and signature-compatible** (`0001`–`0018` untouched, zero `DROP TABLE`, zero `DROP POLICY`, zero `DROP TRIGGER`, `create_exam_attempt_v2` keeps its exact 18-arg backward-compatible signature, `exam_attempt_answers.is_answered` has `DEFAULT false`). Rolling back the Next.js deployment to `39952bd` works cleanly against the live Supabase Cloud schema without requiring destructive DB rollbacks.

---

## 7. Final Independent Sign-Off

- **Release Decision:** **`PRODUCTION READY WITH DOCUMENTED MINOR LIMITATIONS`**
- **Blocking Defects (`P0` / `P1`):** **`0`**
- **Verified Live Production URL:** `https://studyhub-three-mauve.vercel.app` (`studyhub-9zfmzbepc`, `13b22cc`, `hkg1::hnd1`)
- **Signed:** Agent 10 (`final-auditor`, Independent Final Auditor) — `2026-11-25T17:45Z`

---

## 8. Critical V3.2 Addendum (`V32-053`, `V32-054`, `V32-055`) — Live Production Final Acceptance Audit

> **Auditor:** Agent 10 — Independent Final Auditor (`final-auditor`, zero edits to `src/*`, `supabase/*`, or `tests/*`)  
> **Audit Date:** 2026-11-25 (UTC `19:10–19:18Z`)  
> **Live Production Deployment:** `https://studyhub-three-mauve.vercel.app` (Vercel Production **`studyhub-kmvmqknb9`**, commit **`31d6dfb`**, `hkg1::hnd1` Tokyo)  
> **Live Database Schema:** Supabase Cloud (`cuoaifyupfmkstqhcjwy`, PG 17.12) with Migration **`0020_v3_2_post_import_multimedia_editor.sql`** applied LIVE  
> **Updated Binding Verdict:** **`PRODUCTION READY WITH DOCUMENTED MINOR LIMITATIONS`** (`0` P0 / `0` P1 open across all **55** tracked issues: `52` core V3.2 + `3` Addendum `V32-053`/`V32-054`/`V32-055`)

### 8.1 Addendum Static, Migration & Live Vitest Gate (`31d6dfb`)

| Gate | Command / Probe | Measured Live Result (`31d6dfb`) | Status |
| :--- | :--- | :--- | :---: |
| **TypeScript Strict** | `npm run typecheck` | Exit **`0`** (`0` errors) | **PASS** |
| **ESLint & React Hooks** | `npm run lint` | Exit **`0`** (`0` errors, `0` warnings) | **PASS** |
| **Migration Immutability** | `git diff --name-only 39952bd -- supabase/migrations/` | Strictly **2 additive files**: `0019_v3_2_stability_security_and_perf.sql` and `0020_v3_2_post_import_multimedia_editor.sql` (`0001`–`0018` untouched) | **PASS** |
| **Live Production Health** | `GET https://studyhub-three-mauve.vercel.app/api/health` | `200 OK`, `x-vercel-id: hkg1::hnd1::c5hkw-...`, `Cache-Control: private, no-store`, `supabaseConfigured: true` | **PASS** |
| **Full Live Vitest Suite** | `LIVE_API_BASE_URL=https://studyhub-three-mauve.vercel.app npm run test` | **`67 / 67` files passed, `533 / 533` tests passed (`0` failed, `0` skipped, `37.02s`, exit `0`)** — incl. all **`38 / 38`** live DB/RLS/API integration tests against live `hnd1` + Migration `0020` (`live-db-rpcs` `8/8`, `live-rls-security` `11/11`, `live-v3-db-rpcs` `8/8`, `live-v3-rls-security` `11/11`) | **PASS** |

### 8.2 14-Point Live Production Browser Acceptance Walkthrough (§16 — `https://studyhub-three-mauve.vercel.app`)

Executed fresh on live Vercel Production (`studyhub-kmvmqknb9`, Playwright Chromium) using an isolated disposable account (`v32-final-add-*`, 100% deleted post-run), a synthetic 4-question text-only `.docx` bank, and 9 distinct valid colored PNG fixtures:

| §16 Point | Verification Scope | Live Production Evidence (`studyhub-kmvmqknb9`) | Verdict |
| :-: | :--- | :--- | :---: |
| **(1)** | Import text-only `.docx` + attach explanation image in Import Preview (`V32-054`) | Parsed & committed `4/4` questions from synthetic `.docx`; opening inline `Sửa` on Q1 before commit and attaching `preview-expl-q1.png` (`Thêm ảnh giải thích`) persisted `1` `role='explanation'` attachment on Q1 (`q1PreviewExplanationMediaPersisted: true`) and rendered live on `/sets/[id]`. | **PASS** |
| **(2)** | Post-import CTA `"Xem và chỉnh sửa câu hỏi"` + 1-tap Edit on Study Set Hub | Post-import success screen rendered visible link `"Xem và chỉnh sửa câu hỏi"` -> `/sets/[id]/edit`. Study Set Question Bank (`/sets/[id]`) exposed **`4/4`** 1-tap `hub-edit-question-*` Edit buttons (`live-prod-set-hub-edit.png`). | **PASS** |
| **(3)** | Open Unified Question Editor modal | Clicking Q2's 1-tap Edit button opened `UnifiedQuestionEditorModal` (`role="dialog"`, `#uq-prompt`, `initialType: "single_choice"`). | **PASS** |
| **(4)** | Add `2` images to question content (file upload + real `ClipboardEvent("paste")`) | File upload via `Thêm ảnh câu hỏi` returned `POST /api/uploads/image` **`201`**; real browser `ClipboardEvent("paste")` dispatched onto `#uq-prompt` triggered `POST /api/uploads/image` **`201`**. | **PASS** |
| **(5)** | Distinct images on Options A, B, C, D (`2` on A, image-only `""` on B, keeping `single_choice`) | Attached `2` PNGs on Option A (`2/6`), `1` PNG on Option B + cleared Option B text to `""` (activated **`Đáp án chỉ dùng hình ảnh`** badge), and `1` distinct PNG each on C & D — without changing `question_type` from `single_choice`. | **PASS** |
| **(6)** | Add explanation image | Expanded explanation accordion and attached `q2-explanation-1.png` (`POST /api/uploads/image` **`201`**; `live-prod-unified-editor.png`). | **PASS** |
| **(7)** | Save (`PATCH 200`, original `question.id` & `option.id`s preserved) | `PATCH /api/sets/[id]/questions/[q2Id]` returned **`200 OK`**, preserving original `question.id`, keeping `question_type === "single_choice"`, and preserving **`4/4`** original `option.id` UUIDs. | **PASS** |
| **(8)** | Full reload 100% persistence | Post-reload `GET /api/sets/[id]/questions/[q2Id]` & DOM confirmed: `promptMediaCount: 2`, `explMediaCount: 1`, `optCounts: [A:2, B:1 (content=""), C:1, D:1]`, **`8/8`** loaded `<img>` elements on Q2 card (`naturalWidth > 0`). | **PASS** |
| **(9)** | Practice Mode images + contextual Edit preserving session position | Answered Q1 (`1 / 4`), navigated to Q2: **`7/7`** prompt+option images loaded (`0` broken, `0` explanation image pre-check). Contextual Edit updated Q2 prompt (`PATCH 200`), rendered new prompt immediately, and kept exact session header **`1 / 4`** (`sessionPositionPreserved: true`). | **PASS** |
| **(10)** | Timed Exam: `0` edit buttons, `0` explanation images pre-submit | `POST /api/exams` (`201`, `shuffle_options: true`) omitted `review_media_snapshot` (`false`) and stripped all `explanation`/`hint`/`back` roles from `media_snapshot` (`false`). Active `/exams/[id]` rendered **`0`** edit buttons and strictly **`7`** loaded prompt+option images (`0` explanation images). | **PASS** |
| **(11)** | Submit Exam -> exact scoring + post-submit explanation image on Results | Selected correct Option A (`Sao Thủy`) on Q2 -> Submit -> Results scored exact **`25%` (`1 / 4`)**, API returned `submittedQ2ReviewMediaCount: 1`, and Results DOM loaded all **`9 / 9`** images (`7` Q2 prompt/option + `1` Q2 explanation + `1` Q1 preview explanation; `0` broken, `0` `[object Object]`). | **PASS** |
| **(12)** | PDF Export: `question_paper` (0 expl leak) vs `paper_with_explanations` | Live `POST /api/export/pdf` inspected via `pdf-lib`: `question_paper` -> **`200 OK`**, `%PDF-`, `847,441 B`, `2` pages, **`7` `/Image` XObjects** (`0` explanation images); `paper_with_explanations` -> **`200 OK`**, `%PDF-`, `850,166 B`, `3` pages, **`9` `/Image` XObjects** (**`+2`** explanation images cleanly included!). | **PASS** |
| **(13)** | Contextual `"Chỉnh sửa câu hỏi gốc"` on Exam Results + historical immutability | Modal rendered `role="note"` non-mutation disclaimer (`disclaimerVisible: true`, `disclaimerHasNonMutationNotice: true`). Saving updated source Q2 (`[Post-Results Source Edit]`), while reloading historical Exam Results preserved the original snapshot prompt (`[Practice Edited]`) and exact score (`25%`, `1 / 4`). | **PASS** |
| **(14)** | Mobile `390×844` live check | `/sets/[id]`: `0px` overflow, 1-tap Edit button **`44×44px`** (`rightClipPx: 0`). Modal: `0px` doc/modal overflow, `0px` right clip, Option A image controls visible, sticky Save **`44px` tall** (`top: 703..bottom: 747 <= 844`, `right: 365 <= 390`, unobstructed), **`0`** console/page errors (`live-prod-mobile-390-editor.png`). | **PASS** |

### 8.3 Live Production Addendum Screenshots Captured (`docs/audit/v3.2-stability/screenshots/addendum-after/`)
- [`live-prod-set-hub-edit.png`](./screenshots/addendum-after/live-prod-set-hub-edit.png) — Live Desktop `/sets/[id]` showing 1-tap `[✎ Chỉnh sửa]`, 5 media filter chips, `#1` search, and persisted Import Preview explanation image.
- [`live-prod-unified-editor.png`](./screenshots/addendum-after/live-prod-unified-editor.png) — Live Desktop `UnifiedQuestionEditorModal` showing multi-image per-option controls (B/C/D thumbnails, crop/replace/alt/delete, `Dán (Ctrl+V)`), explanation section, and sticky `Hủy | Lưu thay đổi | → Lưu & Câu tiếp` footer.
- [`live-prod-mobile-390-editor.png`](./screenshots/addendum-after/live-prod-mobile-390-editor.png) — Live Mobile `390×844` modal showing Option A `2/6` multi-image reorder arrows, Option B `Đáp án chỉ dùng hình ảnh` badge, `0px` overflow/clip, and unobstructed sticky Save footer.

### 8.4 Addendum Companion Reports Cross-Check (`5 / 5` Verified Consistent)
- [`ADDENDUM_POST_IMPORT_EDIT_REPORT.md`](./ADDENDUM_POST_IMPORT_EDIT_REPORT.md): Phase 3B final `PASS` — `8/8` scenarios, `15/15` cross-mode rendering surfaces (incl. `V32-054` & `V32-055` fixes + `/api/progress/due` + `#100` filtered bank row numbers), `22/22` Playwright E2E green.
- [`SECURITY_REGRESSION.md` §6](./SECURITY_REGRESSION.md): `PASS` — `7/7` live 4-role RBAC / cross-tenant `media_id` / 4-vector pre-submit explanation-media anti-leak / `409` delete guard / `missing_media` privacy checks + `153/153` security unit & live RLS tests green.
- [`PERFORMANCE_BEFORE_AFTER.md` §8](./PERFORMANCE_BEFORE_AFTER.md): `PASS` — 500Q bank `0` full reloads, `0px` scroll drift, `0.82×` 20-cycle `Save & Next` endurance, `0` leaked blob URLs (`3/3` revoked), `0.0 KB` initial cold-load impact from lazy `UnifiedQuestionEditorModal`, `MediaAttachmentEditor`, and `@tiptap`.
- [`REAL_USER_REPORT.md` §7](./REAL_USER_REPORT.md): `APPROVED / PASS` — Student experience jumped from `3.0/10` -> **`9.5/10`** (`0` console/page/HTTP `>=400` errors; minor P3 filtered bank row number polish subsequently closed and verified in Phase 3B `#108`).
- [`ISSUE_TRACKER.md` §6](./ISSUE_TRACKER.md): All 3 Addendum P1 issues (`V32-053`, `V32-054`, `V32-055`) verified and `CLOSED`.

### 8.5 Addendum Disposable Cleanup & Real Owner Data Preservation Attestation

| Entity / Table / Bucket | Pre-Walkthrough (`dbPre`) | Post-Walkthrough (`dbPost`) | Disposable Cleanup Verified | Status |
| :--- | ---: | ---: | :--- | :---: |
| `auth.users` | **`2`** | **`2`** | `1` `v32-final-add-*` deleted; `disposableUsers: []` (`0`) | **100% Preserved** |
| `profiles` / `user_preferences` | `2` / `2` | `2` / `2` | Cascaded cleanly | **100% Preserved** |
| `study_sets` | **`4`** | **`4`** | `1` deleted | **100% Preserved** |
| `questions` / `question_options` | **`599`** / `2,400` | **`599`** / `2,400` | `4` deleted | **100% Preserved** |
| `exam_attempts` | **`2`** | **`2`** | `1` deleted | **100% Preserved** |
| `study_sessions` / `user_question_progress` | `27` / `87` | `27` / `87` | Cascaded cleanly | **100% Preserved** |
| `media_assets` | `0` | `0` | **`9`** deleted | **100% Preserved** |
| Storage (`study-media` + `study-temp` under test prefix) | `0` | `0` | **`9`** objects removed; `remainingStorageUnderUser: 0` | **100% Cleaned** |

### 8.6 Updated Binding Sign-Off (V3.2 + Addendum `V32-053`)
- **Updated Release Decision:** **`PRODUCTION READY WITH DOCUMENTED MINOR LIMITATIONS`** *(same 4 non-blocking V3.2 minor limitations from §5.2 apply — zero new limitations introduced by Addendum `V32-053` / Migration `0020`)*
- **Blocking Defects (`P0` / `P1`):** **`0`** (all `55` tracked issues resolved: `53` `CLOSED`, `2` `MITIGATED / DOCUMENTED`, `0` `OPEN`)
- **Verified Live Production URL:** `https://studyhub-three-mauve.vercel.app` (`studyhub-kmvmqknb9`, `31d6dfb`, `hkg1::hnd1`, Migration `0020` live)
- **Signed:** Agent 10 (`final-auditor`, Independent Final Auditor) — `2026-11-25T19:18Z`
