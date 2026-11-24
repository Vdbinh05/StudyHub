# StudyHub V3.0 — Phase 11 Independent Production Security Audit Report

- **Auditor:** `security-auditor` (Agent 3 — Independent Security Auditor; zero production code or migration edits)
- **Date:** 2026-11-24
- **Production Deployment Under Test:**
  - **Canonical HTTPS URL:** `https://studyhub-three-mauve.vercel.app`
  - **Vercel Project / Plan / Runtime:** `studyhub` (`prj_ddcCZOt10qpV0RbMGltVLyNN29fN`, Vercel Hobby, `iad1`, Node.js `24.x`, Next.js `16.4.6` Turbopack, deployment `dpl_8YVn2m5v4EFLEFTp9nBXY8abiEKp`)
  - **Live Database & Storage:** Supabase Cloud PostgreSQL 17.12, Migrations `0001`–`0017` live (**37/37** public tables RLS-enabled, private `study-media` & `study-temp` buckets)
- **Final Production Verdict:** **PASS — 0 P0, 0 P1, 0 P2 open.** All live HTTPS, RLS, Storage, Exam Anti-Leak, Distributed Rate-Limit, Auth Redirect, Bundle Hygiene, and Runtime Log checks passed **100%** directly against `https://studyhub-three-mauve.vercel.app` with zero impact on pre-existing real user data.

---

## 1. Executive Verification Summary

| Phase 11 Production Security Gate | Target | Result | Evidence / Key Metrics |
| --- | --- | --- | --- |
| Live V2.1 + V3.0 RLS & HTTP API Suites (`live-rls-security.test.ts` + `live-v3-rls-security.test.ts`) | `https://studyhub-three-mauve.vercel.app` + live PG 17.12 | **PASS — 22 / 22** (`exit 0`) | `2/2` files (`106.01s`), 100% live HTTPS + PostgREST + Storage + RPC |
| Deployed Production JS/HTML/API Secret Leak Scan | `https://studyhub-three-mauve.vercel.app` CDN | **PASS — 0 leaks** | `6` live routes (`/`, `/login`, `/offline`, `/manifest.webmanifest`, `/sw.js`, `/api/health`) + **`28` live CDN JS chunks** fetched & scanned: `0` secret/token/JWT/admin/server-parser leaks |
| Production HTTPS Headers & Auth Redirect Security | `https://studyhub-three-mauve.vercel.app` | **PASS — 100%** | HSTS (`max-age=63072000; includeSubDomains`), strict prod CSP (`0` `unsafe-eval`, `0` `localhost`/`127.0.0.1`), `X-Frame-Options: DENY`, `Permissions-Policy`, `/sw.js` `no-store`, `/auth/callback` & `/auth/confirm` open-redirect blocked + `Cache-Control: no-store`, `/auth/signout` `GET` -> `405` / `POST` -> `303` + `no-store` |
| `study-temp` Bucket Isolation & `finally` Auto-Cleanup (`0017`) | `https://studyhub-three-mauve.vercel.app` + live Storage | **PASS — 100%** | Cross-account `download`/`createSignedUrl`/`remove` blocked, cross-account `/api/uploads/image` consume -> `403`, SVG/HTML/`.docm` -> `415`, oversized -> `413`, disguised HTML -> `415` + temp auto-deleted, valid PNG -> `201` + temp auto-deleted |
| `public.api_rate_limits` RLS Deny-All & Live Distributed Rate-Limit (`0017`) | `https://studyhub-three-mauve.vercel.app` + live PG 17.12 | **PASS — 100%** | `anon` & `authenticated` blocked (`42501`) on both table & `check_and_increment_rate_limit` RPC; live 6-call burst on `POST /api/account/restore` -> `[201, 201, 201, 201, 201, 429]` (`Retry-After: 894`, `X-RateLimit-Limit: 5`, `X-RateLimit-Remaining: 0`, persisted PG `hit_count: 6`) |
| Production Runtime Logs Audit (`vercel logs`) | `https://studyhub-three-mauve.vercel.app` | **PASS — 0 issues** | `106` log lines inspected covering live security runs: **`0` leaked secrets**, **`0` unhandled 5xx / exceptions** |
| Dependency Security Audit (`npm audit --omit=dev`) | Production dependency graph | **PASS (0 Critical / 0 High)** | `0` critical, `0` high, `2` pre-existing moderate transitive advisories (`uuid <11.1.1` GHSA-w5hq-g745-h8pq inside `exceljs`, unused `v3/v5/v6` buffer path; `0` new V3/Vercel advisories) |
| Live Data Preservation & Clean Teardown | Live Supabase Cloud (`study-media`, `study-temp`, Auth, `api_rate_limits`) | **PASS — 0 leftovers** | Tracked disposable accounts (`v3-prod-sec-a/b-*`, `v3-sec-a/b/c-*`, `v21-sec-a/b-*`), tracked Storage objects, and tracked rate-limit keys deleted (`trackedUsersRemaining === 0`, real user data untouched) |

---

## 2. Live Production Vitest Suites (`22 / 22 PASS`)

Command executed directly against production HTTPS:

```bash
LIVE_API_BASE_URL=https://studyhub-three-mauve.vercel.app npx vitest run tests/integration/live-rls-security.test.ts tests/integration/live-v3-rls-security.test.ts --reporter=verbose
```

- **Result:** `Test Files 2 passed (2)`, `Tests 22 passed (22)`, `Duration 106.01s`, exit code `0`.
- **V2.1 Live RLS + HTTP Security Regression (`tests/integration/live-rls-security.test.ts` — `11/11 PASS`):**
  - Verified live on `https://studyhub-three-mauve.vercel.app`: editor ownership hijack & `question_count` tamper blocks (`SH-001`), friendship state-machine & block locks (`SH-002`), cross-tenant composite FK injection rejection (`SH-012`), V1 `create_exam_attempt` revocation & server-only grading (`SH-013`), `profiles.email` column revocation (`SH-014`), `'unlisted'` non-enumeration & RLS helper oracle lockdown (`SH-015`/`SEC-009`), private `study-media` Storage RLS & SVG block (`SH-019`), `allow_clone = false` & revocation safety (`SH-020`), multi-subject session RLS, `0006` anon RPC lockdown, and full live HTTP API security checks.
- **V3.0 Live 3-Account Security Suite (`tests/integration/live-v3-rls-security.test.ts` — `11/11 PASS`):**
  - Verified live on `https://studyhub-three-mauve.vercel.app`:
    - Pure deterministic controls (`3/3`): `sanitizeRichTextDoc()` XSS/protocol/depth stripping, KaTeX `trust: false` blocking `\href`/`\htmlClass`/`\htmlStyle`/`<script>`, `parsePdfBuffer()` non-PDF/corrupt/>15 MB/`/OpenAction /JS` safety + `isEvalSupported: false`.
    - Live 3-account HTTP + PG 17.12 controls (`8/8`):
      1. Private Notes bidirectional isolation across PostgREST, `/api/notes`, and `global_library_search` (`0` leak in counts or snippets).
      2. Question Reports RLS & role locks (Viewer B submits, Owner A resolves, User C `0` rows / `403`/`404`, Viewer B blocked from self-resolving, Editor B blocked from deleting Owner A's report).
      3. Checkpoints, Confidence & Offline Sync RLS (`event_id` cross-user replay -> `invalid`, revoked share -> `rejected_revoked`, `note_upsert` rich-text sanitized server-side).
      4. Media & Audio upload validation (PNG/WAV/MP3 `201`; SVG & disguised HTML `415`; >5 MB image & >10 MB audio `413` on Vercel Edge; unshared media blocked for B/C/`anon`; cross-tenant `POST /api/media` relation attachment rejected).
      5. Historical Exam Snapshot media survival post-revocation + `ON DELETE RESTRICT` (`409`) + non-owner editor `DELETE /api/media/[id]` (`403`, blob intact).
      6. 12-Type Pre-Submit Exam Anti-Leak (`POST /api/exams` & `GET /api/exams/[id]` leak `0` answer keys/tolerances/geometry/hidden transcript; direct PostgREST `SELECT` on revoked snapshot columns fails with PG `42501`).
      7. Streamed Vietnamese PDF Export auth (`allow_clone = false` -> `403`; `in_progress` & `discarded` answer-key/explanation/review exports -> `403`; Vietnamese title `question_paper` & submitted `paper_and_key` -> `200`, `%PDF-`, `Cache-Control: private, no-store`, RFC 5987 `filename*=UTF-8''`).
      8. Production V3 security headers, `/sw.js` `no-store`, `/diagrams/[id]/edit` redirect guard, and unauthenticated `401` across all 9 V3 API endpoints.

---

## 3. Production-Specific Vercel Hardening Verification (Migration `0017` & Live HTTPS Probes)

Executed live against `https://studyhub-three-mauve.vercel.app` using 2 isolated disposable accounts (`v3-prod-sec-a/b-<ts>@studyhub-test.local`):

### 3.1 Deployed CDN Client Bundle & Response Secret Scan
- Fetched live HTML/JSON/JS for `/`, `/login`, `/offline`, `/manifest.webmanifest`, `/sw.js`, `/api/health`, plus all **`28` deployed `/_next/static/chunks/*.js`** files referenced by production pages.
- Scanned against live `.env.local` secret values (in-memory only, never logged) and regexes for `sb_secret_*`, `SUPABASE_SECRET_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `createAdminClient`, `pdfjs-dist`, `pdf-lib`, `exceljs`, and JWTs (`eyJhbGciOi...`):
  - **Leaks found:** **`0`**.

### 3.2 Production HTTPS Headers & Auth Redirect Hardening
- **`GET /` (`200 OK`):**
  - `Strict-Transport-Security`: `max-age=63072000; includeSubDomains`
  - `Content-Security-Policy`: strict production policy — **ZERO `'unsafe-eval'`**, **ZERO `127.0.0.1` / `localhost`**, includes `media-src`, `worker-src 'self' blob:`, `manifest-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`
  - `X-Frame-Options`: `DENY` | `X-Content-Type-Options`: `nosniff` | `Permissions-Policy`: `camera=(), microphone=(self), geolocation=()` | `X-Powered-By`: absent
- **`GET /sw.js` (`200 OK`):** `Cache-Control: no-cache, no-store, must-revalidate`, `Service-Worker-Allowed: /`.
- **Open-Redirect & Cache Protection on Auth Routes:**
  - `GET /auth/callback?next=//evil.com` -> `307` to `https://studyhub-three-mauve.vercel.app/login?error=auth_callback_failed` with `Cache-Control: no-store`
  - `GET /auth/callback?next=https://evil.com` -> `307` to `https://studyhub-three-mauve.vercel.app/login?error=auth_callback_failed` with `Cache-Control: no-store`
  - `GET /auth/callback?next=/\evil.com` -> `307` to `https://studyhub-three-mauve.vercel.app/login?error=auth_callback_failed` with `Cache-Control: no-store`
  - `GET /auth/confirm?next=//evil.com&type=signup&token_hash=invalid` -> `307` to `https://studyhub-three-mauve.vercel.app/login?error=confirmation_failed` with `Cache-Control: no-store`
  - `GET /auth/signout` -> `405 Method Not Allowed` (immune to GET logout CSRF)
  - `POST /auth/signout` -> `303` to `https://studyhub-three-mauve.vercel.app/login` with `Cache-Control: no-store`

### 3.3 `study-temp` Private Bucket Cross-Account Isolation & `finally` Cleanup
- **`POST /api/storage/upload-url` Input & Auth Validation:**
  - Unauthenticated -> **`401`**
  - Cross-user `studySetId` -> **`404`**
  - `xss.svg` (`image/svg+xml`), `xss.html` (`text/html`), `macro.docm` -> **`415`**
  - Oversized `image` (`5.5 MB`), `audio` (`11 MB`), `import` (`16 MB`) -> **`413`**
- **Cross-Account Storage Isolation (User A stages valid PNG in `study-temp/{userA}/image/{uuid}.png`):**
  - User B direct `storage.from("study-temp").download(pathA)` -> **Blocked**
  - User B & `anon` direct `storage.from("study-temp").createSignedUrl(pathA, 60)` -> **Blocked**
  - User B direct `storage.from("study-temp").remove([pathA])` -> **0 objects removed** (User A's file preserved)
  - User B calling `POST /api/uploads/image` with `{ storagePath: pathA, studySetId: setB }` -> **`403 Forbidden`**
- **Guaranteed `finally` Cleanup (both success & rejection):**
  - User A finalizes valid PNG (`POST /api/uploads/image` `{ storagePath: pathA }`) -> **`201 Created`**, and immediate admin check confirms `pathA` is **deleted from `study-temp`**.
  - User A stages disguised HTML as `.png` and calls `POST /api/uploads/image` -> **`415 Unsupported Media Type`**, and immediate admin check confirms the rejected temp object is **deleted from `study-temp`**.

### 3.4 `public.api_rate_limits` RLS Deny-All & Live Distributed Rate-Limiting
- **Client Lockdown (Zero Cross-User Bucket Exhaustion):**
  - `anon` `SELECT` on `public.api_rate_limits` -> PG **`42501`**
  - `authenticated` `SELECT` & `INSERT` on `public.api_rate_limits` -> PG **`42501`**
  - `anon` & `authenticated` `RPC public.check_and_increment_rate_limit(...)` -> PG **`42501`** (strictly `service_role`-only)
- **Live Vercel Serverless Distributed Enforcement:**
  - 6 consecutive requests to `POST https://studyhub-three-mauve.vercel.app/api/account/restore` (`ACCOUNT_RESTORE`: limit `5` / `15 min`):
    - Statuses: **`[201, 201, 201, 201, 201, 429]`**
    - 6th response headers: `Retry-After: 894`, `X-RateLimit-Limit: 5`, `X-RateLimit-Remaining: 0`
    - Admin verification confirmed `public.api_rate_limits` persisted `account_restore:user:<userAId>` (`hit_count: 6`), proving real PostgreSQL-backed rate limiting across Vercel serverless invocations.

---

## 4. Runtime Logs (`vercel logs`) & Dependency Audit (`npm audit --omit=dev`)

- **Vercel Production Runtime Logs (`npx vercel logs https://studyhub-three-mauve.vercel.app --limit 100 --no-follow`):**
  - `106` lines inspected covering the full Phase 11 live security probe & Vitest traffic.
  - **Secret / JWT / Key leaks in logs:** **`0`**.
  - **Unhandled 5xx errors / runtime exceptions:** **`0`**.
- **Production Dependency Audit (`npm audit --omit=dev`):**
  - **Critical:** `0` | **High:** `0` | **Moderate:** `2` | **Low:** `0`
  - **Inherited Moderate Advisory (Documented Honestly):**
    - `uuid <11.1.1` (`GHSA-w5hq-g745-h8pq` — missing buffer bounds check in `uuid.v3`/`v5`/`v6` when caller passes `buf`), pulled transitively by `exceljs >=3.5.0`.
    - **Exposure Assessment:** StudyHub uses Node's built-in `crypto.randomUUID()` exclusively and only invokes `exceljs` for `.xlsx` workbook parsing/generation (never exposing user-controlled `buf` parameters to `uuid.v3/v5/v6`). Fixing via `npm audit fix --force` would downgrade `exceljs` to breaking `3.4.0`; accepted as low residual risk until upstream `exceljs` updates its `uuid` dependency.
    - **New V3.0 / Production Dependencies:** **0 vulnerabilities** across `pdfjs-dist`, `pdf-lib`, `@fontkit/fontkit`, `katex`, `@tiptap/*`, `idb`, `@supabase/supabase-js`, `@supabase/ssr`, and `next@16.4.6`.

---

## 5. Live Data Preservation & Clean Teardown Verification

- **Strict Preservation Rule:** Real user accounts, study sets, exam history, and Storage objects in Supabase Cloud were never queried globally, modified, or deleted.
- **Tracked Disposable Cleanup Verified:**
  - `live-rls-security.test.ts`: 2 disposable `v21-sec-a/b-*` accounts & tracked `study-media` objects deleted cleanly (`afterAll` exit `0`).
  - `live-v3-rls-security.test.ts`: 3 disposable `v3-sec-a/b/c-*` accounts & tracked `study-media` objects deleted cleanly (`getUserById` verified not-found for all 3).
  - Phase 11 Vercel production probes: 2 disposable `v3-prod-sec-a/b-*` accounts (`trackedUsersRemaining: 0`), 1 `study-media` object, 2 `study-temp` paths, and 5 tracked `api_rate_limits` test bucket keys deleted cleanly in `finally`.
- **Working Tree Hygiene:** Zero production files (`src/*`, `supabase/*`, `public/*`, `next.config.ts`, `package.json`) were modified during Phase 11.
