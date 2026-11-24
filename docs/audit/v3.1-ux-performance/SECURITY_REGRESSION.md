# StudyHub V3.1 — Independent Production Security Regression Audit (`hnd1` Tokyo)

- **Auditor:** `security-auditor` (Independent Security Auditor — zero edits to `src/*`, `supabase/*`, `public/*`, `next.config.ts`, `package.json`, `vercel.json`)
- **Date:** 2026-11-25
- **Target Production Deployment:**
  - **Canonical HTTPS URL:** `https://studyhub-three-mauve.vercel.app`
  - **Deployment / Commit / Region:** `dpl_6N85jVRkZZjf5yNM2sMnH5ru6Noj` (commit `3406444`, Vercel Hobby, **`hnd1` Tokyo** confirmed via `X-Vercel-Id: hkg1::hnd1::...`, Node.js `24.x`, Next.js `16.4.6`)
  - **Live Database & Storage:** Supabase Cloud PostgreSQL 17.12, Migrations `0001`–`0018` live (**37/37** public tables RLS-enabled, private `study-media` & `study-temp` buckets)
- **Final Verdict:** **PASS — ZERO security regressions introduced by V3.1 (`0` P0, `0` P1, `0` P2 open).** All 38 live DB/RLS/HTTP Vitest tests and all V3.1-specific production security probes (`0018` RPCs, `proxy.ts` matcher & `hasSupabaseAuthCookie` fast-path, `/api/uploads/signed-url` `private, max-age=1800`, `hnd1` headers, deployed CDN JS chunks, offline IDB partitioning) passed **100%** with ~70–80% faster live HTTP execution in `hnd1` Tokyo.

---

## 1. Executive Summary Matrix

| V3.1 Security Regression Gate | Target | Result | Fresh Evidence / Latency |
| --- | --- | --- | --- |
| Live DB & V2.1/V3.0 RLS Suites (`4` suites: `live-db-rpcs`, `live-v3-db-rpcs`, `live-rls-security`, `live-v3-rls-security`) | `https://studyhub-three-mauve.vercel.app` + live PG 17.12 | **PASS — 38 / 38** (`4/4` files, `exit 0`) | **`37.80s`** total (vs `106.01s` for just the 2 RLS suites in `iad1` V3.0!) |
| Migration `0018` RPC Security & Parity (`get_dashboard_summary`, `get_study_set_summary`, `record_study_session_answer`) | Live PG 17.12 + `https://studyhub-three-mauve.vercel.app` | **PASS — 100%** | `anon` -> `42501` (3/3), cross-user private set -> `NULL`/`404`, `owner` omits `email`, cross-session -> `P0002`/`404`, `SH-012` cross-set -> `22023`/`400`, SM-2/confidence/hint mastery guards intact |
| `proxy.ts` Matcher & `hasSupabaseAuthCookie` Fast-Path | `https://studyhub-three-mauve.vercel.app` (`hnd1`) | **PASS — 100%** | Unauth `/dashboard`, `/library`, `/sets/[id]`, `/diagrams/[id]/edit` -> `307 /login?next=...`; forged `sb-*-auth-token` & `sb-access-token` cookies rejected (`307` on pages, `401` on `/api/dashboard`); unauth `/api/*` -> `401` |
| Global Security Headers on Pages & Excluded `/api/*` Routes | `https://studyhub-three-mauve.vercel.app` (`hnd1`) | **PASS — 100%** | `HSTS` (`max-age=63072000`), strict prod `CSP` (`0` `unsafe-eval`, `0` `127.0.0.1`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Permissions-Policy: camera=(), microphone=(self), geolocation=()` verified on `/`, `/login`, `/api/health` (`200`), and `/api/dashboard` (`401`) |
| `/api/uploads/signed-url` V3.1 Caching & Cross-User Isolation | `https://studyhub-three-mauve.vercel.app` + `study-media` | **PASS — 100%** | Owner `redirect=1` -> `302` (`Cache-Control: private, max-age=1800`, `Vary: Cookie`, signed `token=`); User B -> `404`; `anon` -> `401` |
| Deployed V3.1 CDN JS Bundle Scan & Offline IDB Isolation | `https://studyhub-three-mauve.vercel.app` CDN | **PASS — 0 leaks** | `6` live routes + **`23` deployed `/_next/static/chunks/*.js`** chunks (down from `28` in V3.0): **`0` secret / token / JWT / admin / server-parser leaks**; `studyhub-offline-v3:${userId}` + logout purge intact |
| Live Data Preservation & Clean Teardown | Live Supabase Cloud (real user data untouched) | **PASS — 0 leftovers** | Disposable `v31-after-sec-a/b-*` accounts (`trackedUsersRemaining: 0`), `study-media` blob (`1`), `api_rate_limits` key (`1`), and all 4 Vitest fixture accounts cleaned cleanly |

---

## 2. Live 4-Suite DB & RLS Security Regression (`38 / 38 PASS` in `37.80s`)

Command executed directly against V3.1 Production (`hnd1` Tokyo):

```bash
LIVE_API_BASE_URL=https://studyhub-three-mauve.vercel.app npx vitest run \
  tests/integration/live-db-rpcs.test.ts \
  tests/integration/live-v3-db-rpcs.test.ts \
  tests/integration/live-rls-security.test.ts \
  tests/integration/live-v3-rls-security.test.ts \
  --reporter=verbose
```

- **Result:** `Test Files 4 passed (4)`, `Tests 38 passed (38)`, `Duration 37.80s`, exit code `0`.
  - `tests/integration/live-db-rpcs.test.ts`: **8 / 8 PASS** (triggers, `normalize_short_answer`, multi-subject exam lifecycle, 500Q Full Coverage zero overlap, `clone_study_set`, `get_practice_question_pool` 500Q/2,000 options).
  - `tests/integration/live-v3-db-rpcs.test.ts`: **8 / 8 PASS** (all 10 V3 tables, 12-type grading + `42501` column revoke, confidence neutrality, scoped `reset_learning_progress`, `global_library_search`, `sync_offline_learning_events`, `content_media_relations` `ON DELETE RESTRICT` + polymorphic delete triggers).
  - `tests/integration/live-rls-security.test.ts`: **11 / 11 PASS** (`SH-001`..`SH-020`, `0006` anon lockdown, live HTTP API security).
  - `tests/integration/live-v3-rls-security.test.ts`: **11 / 11 PASS** (XSS/KaTeX/PDF safety, bidirectional private notes isolation, question reports RLS, checkpoints/confidence/sync RLS + replay/revocation, media/audio upload caps & cross-tenant guard, historical exam media survival + `409`/`403`, 12-type pre-submit anti-leak + `42501`, Vietnamese PDF export auth, V3 headers & auth guards).

### Observed `hnd1` Tokyo vs `iad1` Virginia Live Security Suite Speedup

| Live HTTP Security Test (`https://studyhub-three-mauve.vercel.app`) | V3.0 (`iad1`) | V3.1 (`hnd1`) | Reduction |
| --- | --- | --- | --- |
| `live-rls-security` — Live HTTP API Security | `44,354 ms` | **`13,116 ms`** | **`-70.4%`** |
| `live-v3-rls-security` — Private Notes Isolation (HTTP + Search) | `8,776 ms` | **`2,462 ms`** | **`-71.9%`** |
| `live-v3-rls-security` — Question Reports RLS (HTTP + PostgREST) | `12,750 ms` | **`2,500 ms`** | **`-80.4%`** |
| `live-v3-rls-security` — Media & Audio Upload + Storage Isolation | `17,416 ms` | **`4,920 ms`** | **`-71.8%`** |
| `live-v3-rls-security` — 12-Type Pre-Submit Exam Anti-Leak | `7,537 ms` | **`1,795 ms`** | **`-76.2%`** |
| `live-v3-rls-security` — Streamed Vietnamese PDF Export Auth | `21,892 ms` | **`5,778 ms`** | **`-73.6%`** |

---

## 3. V3.1-Specific Security Surface Verification (Live on `hnd1`)

Executed live against `https://studyhub-three-mauve.vercel.app` using 2 isolated disposable accounts (`v31-after-sec-a/b-<ts>@studyhub-test.local`):

### 3.1 Migration `0018` Performance RPCs & Static SQL Audit
- **Static audit of `supabase/migrations/0018_v3_1_performance_rpcs_and_indexes.sql`:**
  - Zero `DROP POLICY`, zero `DROP TRIGGER`, zero `CREATE TEMP TABLE`, zero `auth.role()`, 100% `(SELECT auth.uid())`, 100% `SET search_path = ''`, and explicit `REVOKE ALL ... FROM PUBLIC, anon; GRANT EXECUTE ... TO authenticated;` on all 3 new `SECURITY DEFINER` RPCs (`get_dashboard_summary`, `get_study_set_summary`, `record_study_session_answer`).
- **Live negative authorization & privacy checks:**
  - `anon` executing `get_dashboard_summary()`, `get_study_set_summary(setAId)`, and `record_study_session_answer(...)` -> **ALL 3 rejected with PG `42501`**.
  - User B calling `get_study_set_summary(setAPrivateId)` -> returns **`NULL`** (zero existence leak); `GET /api/sets/<setAPrivateId>` as User B -> **`404`**.
  - User B calling `get_study_set_summary(setASharedId)` and `GET /api/sets/<setASharedId>` -> `owner` projection contains ONLY `{ id, display_name, username, avatar_url }` and **strictly omits `email`** (User A's email absent from serialized response).
  - User B calling `get_dashboard_summary()` -> **0 leakage** of User A's private study sets, KPIs, or email.
  - User B attempting to inject an answer into User A's `study_sessions` row via direct RPC AND `POST /api/sessions/<sessionAId>/answers` -> rejected (**`P0002`** / **`404`**).
  - User A attempting `SH-012` cross-set answer injection (answering a question from `setASharedId` inside a session scoped to `setAPrivateId`) -> rejected (**`22023`** / **`400 INVALID_REFERENCE`**).
  - User B attempting to answer User A's private question inside User B's own session -> rejected (**`P0002`**).
- **Live SM-2 & V3 Confidence/Hint Mastery Parity via `POST /api/sessions/[sessionId]/answers`:**
  - Wrong answer with `confidence: "certain"` -> `is_correct: false`, `ease_factor: 1.91` (`2.50 - 0.54 - 0.05`), `interval_days: 1`, `high_conf_wrong_count: 1`, `mastery_level: "learning"`.
  - Correct answer with `confidence: "guessing"` (pre-seeded `familiar`, `streak: 2, interval: 6`) -> `is_correct: true`, `interval_days: 1`, `mastery_level: "familiar"` (**blocked from `mastered`**), `guess_correct_count: 1`, `independent_recall_count: 0`.
  - Correct answer with `hint_used: true` (pre-seeded `familiar`, `streak: 2, interval: 6`) -> `is_correct: true`, `interval_days: 6`, `mastery_level: "familiar"` (**blocked from `mastered`**), `hint_used_count: 1`, `independent_recall_count: 0`.

### 3.2 `proxy.ts` Matcher Exclusion & `hasSupabaseAuthCookie` Fast-Path
- **Unauthenticated protected page redirects (0 ms fast-path, zero Auth RTT):**
  - `GET /dashboard` -> `307 /login?next=%2Fdashboard`
  - `GET /library` -> `307 /login?next=%2Flibrary`
  - `GET /sets/<uuid>` -> `307 /login?next=%2Fsets%2F<uuid>`
  - `GET /diagrams/<uuid>/edit` -> `307 /login?next=%2Fdiagrams%2F<uuid>%2Fedit`
- **Forged auth cookie bypass resistance (verifies `hasSupabaseAuthCookie` NEVER trusts cookie payload):**
  - `Cookie: sb-cuoaifyupfmkstqhcjwy-auth-token=<forged-jwt>` on `GET /dashboard` & `GET /library` -> rejected by server-side `supabase.auth.getUser()` -> **`307 /login?next=...`**.
  - `Cookie: sb-access-token=forged-token-value` on `GET /sets/<uuid>` -> rejected -> **`307 /login?next=...`**.
  - `Cookie: sb-cuoaifyupfmkstqhcjwy-auth-token=<forged-jwt>` on `GET /api/dashboard` -> **`401 UNAUTHORIZED`**.
- **Unauthenticated API routes (excluded from `proxy.ts` matcher, guarded directly by `requireAuth()`):**
  - `GET /api/dashboard`, `GET /api/sets`, `GET /api/notes` -> ALL return **`401 UNAUTHORIZED`**.
- **Global security headers unaffected by `proxy.ts` exclusion:**
  - Verified identical `Strict-Transport-Security: max-age=63072000; includeSubDomains`, strict production `Content-Security-Policy` (`0` `unsafe-eval`, `0` `127.0.0.1`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and `Permissions-Policy: camera=(), microphone=(self), geolocation=()` on `/`, `/login`, `/api/health` (`200`), AND `/api/dashboard` (`401`).
  - Confirmed `X-Vercel-Id: hkg1::hnd1::vpzgf-1795547283423-b7acc7552bf7` (`hnd1` Tokyo execution).

### 3.3 `/api/uploads/signed-url` V3.1 Caching & Cross-User Denial
- Owner A uploaded a real PNG (`POST /api/uploads/image` -> `201`) to private `setAPrivateId`:
  - Owner A `GET /api/uploads/signed-url?path=<path>&redirect=1` -> **`302`** with signed `token=`, **`Cache-Control: private, max-age=1800`**, and **`Vary: Cookie`** (strictly private browser cache; never CDN-shared across users).
  - User B `GET /api/uploads/signed-url?path=<path>&redirect=1` -> **`404`**.
  - Unauthenticated `GET /api/uploads/signed-url?path=<path>&redirect=1` -> **`401`**.

### 3.4 Deployed V3.1 CDN Bundle Scan & Offline Account Isolation
- Fetched live production HTML/JSON/SW for `/`, `/login`, `/offline`, `/manifest.webmanifest`, `/sw.js`, `/api/health` plus all **`23` deployed `/_next/static/chunks/*.js`** files referenced by production routes (down from `28` chunks in V3.0).
- Scanned against live `.env.local` secret values (in-memory only) and secret/server-lib regexes (`sb_secret_*`, `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `createAdminClient`, `pdfjs-dist`, `pdf-lib`, `exceljs`, JWTs `eyJhbGciOi...`):
  - **Leaks found:** **`0`**.
- Confirmed `src/lib/offline/db.ts` retains strict account-partitioned IndexedDB naming (`studyhub-offline-v3:${userId}`) and logout active-pointer purge in `src/components/pwa/PwaProvider.tsx`.

---

## 4. Live Data Preservation & Clean Teardown

- Pre-existing real user accounts, study sets, exam history, and Storage objects in Supabase Cloud were strictly untouched.
- Tracked disposable resources from V3.1 security probes (`v31-after-sec-a/b-*`, `1` `study-media` object, `1` `api_rate_limits` bucket key) and all 4 live Vitest suites were deleted cleanly in `finally`/`afterAll` -> **`trackedUsersRemaining === 0`**.
