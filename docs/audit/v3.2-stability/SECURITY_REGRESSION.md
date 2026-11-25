# StudyHub V3.2 — Independent Security & Database Regression Audit (`SECURITY_REGRESSION.md`)

- **Auditor:** Agent 9 (`security-auditor` — independent, read-only against production code)
- **Target Branch / Commit:** `release/v3.2-stability` @ `7dfabfd` + Wave 6 fixes (`#47`, `#48`, `#49`, `#53`, `#54`)
- **Test Harness:** Local production build (`npx next start -p 3042` in Wave 5; `npx next start -p 3052` in Wave 6, isolated from sibling ports and cleanly torn down post-audit) connected to live Supabase Cloud project (`0001`–`0019` partial live deployment)
- **Audit Date:** 2026-11-25 (Wave 5 initial + Wave 6 final retest)
- **Scope:** Independent verification of all 14 Wave 1–6 Security, Cache Isolation, and PostgreSQL Optimization items (`V32-001`, `V32-002`, `V32-008`, `V32-009`, `V32-011`, `V32-012`, `V32-013`, `V32-043`, `V32-044`, `V32-045`, `V32-046`, `V32-047`, `V32-051`, `V32-052`) + live multi-account isolation & automated regression suites.

---

## 1. Executive Summary & Overall Verdict

**Wave 6 Final Security & DB Verdict:** **`PASS (0 REOPENED APPLICATION DEFECTS — 4 MIGRATION 0019 DROP/DELETE SQL BLOCKS PENDING MANUAL OWNER SQL EDITOR APPLY)`**

### Headline Results (Wave 6 Final)
- **Automated Security & Offline DB Unit Suites (`tests/unit/security` + `tests/unit/offline/db.test.ts`):** **PASS — 8/8 files, 110/110 tests passed** (`tests/unit/security`: `7/7 files, 101/101`; `tests/unit/offline/db.test.ts`: `9/9`).
- **Live DB & RLS Integration Suites (against local prod + live Supabase Cloud):** **PASS — 38/38 passed (100% GREEN)**:
  - `live-db-rpcs.test.ts`: **8/8 PASS**
  - `live-rls-security.test.ts`: **11/11 PASS**
  - `live-v3-db-rpcs.test.ts`: **8/8 PASS**
  - `live-v3-rls-security.test.ts` (`LIVE_API_BASE_URL=http://127.0.0.1:3052`): **11/11 PASS** *(Wave 5 stale V3.0 `"rejected_revoked"` expectation at `L1311` fixed in Wave 6 `#47`/`#53` to assert hardened opaque `"rejected_inaccessible"`!)*
- **Wave 5 Reopened Defect (`V32-013`, P2) — RESOLVED & VERIFIED LIVE IN WAVE 6:**
  - Verified live in Chromium on **BOTH** `http://127.0.0.1:3052` (`523 ms`) AND `http://localhost:3052` (`550 ms`): client `fetch("/auth/signout")` sends `Accept: application/json`, receives `200` JSON (`{"data":{"ok":true,"signedOut":true}}`) with `Cache-Control: private, no-store` & `Vary: Cookie` (**0** CSP errors, **0** `303` redirects), purges **100%** of user-scoped `localStorage` keys **including `studyhub-offline-known-users`**, and redirects both Tab 1 & Tab 2 cleanly to `/login`.
  - Verified live with an uncooperative external `indexedDB.open` handle in Tab 2 (`blocking()` + `1500ms` bounded `deleteDB` timeout): Tab 1 still completes logout, purges all keys, and redirects cleanly in **`2,064 ms`** (zero hang).
  - Verified raw non-JSON `POST /auth/signout` (`Accept: text/html`) on both origins returns `303` with relative `Location: /login`, `Cache-Control: private, no-store`, and `Vary: Cookie`.
- **Production Dependency Security (`npm audit --omit=dev`):** **PASS** — `0 critical`, `0 high`, `2 moderate` (`exceljs` -> transitive `uuid <11.1.1`, accepted ESM/CJS constraint; `mammoth` completely removed; `421` prod dependencies).
- **Static Security Baseline:** **0** `getSession()` calls, **0** `SUPABASE_SECRET_KEY`/`SERVICE_ROLE_KEY` references in client code, **0** raw `error.message` leaks in `src/app/api/`, **5** `dangerouslySetInnerHTML` sites all strictly fed by `renderSafeKatexHtml()` (`trust: false`), **11/11** newly deployed live `0019` RPCs return PostgreSQL **`42501`** for `anon`.
- **Migration `0019` Live Supabase Cloud Status (4 Manual SQL Editor Blocks Pending):**
  - All non-destructive sections of `0019_v3_2_stability_security_and_perf.sql` (Sections 3–6, `record_study_session_answer`, `record_progress_answer`, `bump_study_set_content_version`, `allocate_question_position`, `patch_user_preferences`, Sections 8–13, and all `CREATE INDEX` statements) are **applied LIVE on Supabase Cloud** and verified.
  - Because Supabase MCP gates `DROP`/`DELETE` DDL statements, **4 specific SQL blocks** (Section 1 `SEC-05`, Section 2 `DB-08` `DROP INDEX`, Section 7 `toggle_starred_question` + `save_diagram_patch`, Section 7 `sync_offline_learning_events`) remain queued for manual owner execution in the Supabase Dashboard SQL Editor (detailed in Section 4 below).

---

## 2. Per-Issue Regression Verification Matrix (All 14 Tracked IDs)

| Issue ID | Wave 1 IDs | Severity | Wave 5 Status | Live / Automated Verification Summary |
| --- | --- | --- | --- | --- |
| **`V32-001`** | `SEC-01` | **P0** | **`PASS`** | Verified in real Chromium on focus route `/sets/[id]/practice` after cookie-clear session-expiry switch (User A -> User B): server-verified `initialUserId` from `src/app/(app)/layout.tsx` passed to `AuthenticatedProviders`; `pointerMatchesUserB: true`, `pointerLeakedUserA: false`, `hasUserACheckpoint: false`, `hasLegacyDraft: false`, `syncCallsWithUserA: 0`. Wave 6 (`#49`) also added `studyhub-offline-known-users` to `USER_SCOPED_LOCAL_EXACT_KEYS` (`v32-client-cache-isolation.test.ts` 10/10 PASS). |
| **`V32-002`** | `FUNC-01`, `SEC-08` | **P0** | **`PASS`** | Verified live on `:3042` + Supabase Cloud: `PUT /api/exams/[id]/answers` (`ordering` structured answer + `confidence: "guessing"` + `hint_used: true`) -> reload `GET /api/exams/[id]` preserves `structured_response.ordered_item_ids`, `confidence: "guessing"`, and `hint_used: true` while strictly omitting `is_correct` and grading keys. `POST /submit` scored `correct_count: 1, score_percent: 20` (100% confidence score-neutral). |
| **`V32-008`** | `SEC-04`, `CACHE-01` | **P1** | **`PASS`** | Verified live HTTP headers across `/api/profile`, `/api/dashboard`, `/api/sets`, `/api/account/data`, `/api/exams` (`POST`, `GET` in_progress, `POST /submit`, `GET` submitted with answer keys), `/api/statistics`, `/api/mistakes`, and `/api/uploads/signed-url` (JSON mode, `expiresIn: 300`): ALL return `Cache-Control: private, no-store` and `Vary` containing `Cookie`. `/api/uploads/signed-url?redirect=1` returns `302` with `Cache-Control: private, max-age=60, must-revalidate` + `Vary: Cookie`. `/sw.js` returns `Cache-Control: no-cache, no-store, must-revalidate`. |
| **`V32-009`** | `SEC-05`, `SEC-06` | **P1** | **`PARTIAL (SEC-06 PASS / SEC-05 PENDING SQL APPLY)`** | **`SEC-06` PASS (Live):** `POST /api/sets/[setA]/duplicate` copies media to `{userB}/{clonedSetId}/...`; after Owner A revokes User B's share, User B still reads cloned media (`200`) and gets `404` on Owner A's original. **`SEC-05` PARTIAL:** Live `DELETE /api/account/data` (`scope: "account"`) returns `200` with `preserved_shared_media_count: 1`, **preserves** User B's exam-pinned blob in Storage (`pinnedBlobPreservedInStorage: true`) and **purges** unpinned blobs (`unpinnedBlobPurgedFromStorage: true`). However, User B's follow-up `GET /api/uploads/signed-url` returned `404` live because **`0019` Block (a)** (`L30–L165`: `media_assets.owner_id DROP NOT NULL` + scoped `cleanup_profile_media_relations()`) has not yet been applied in SQL Editor, so the legacy `0013` trigger still deletes User B's `content_media_relations` row during `deleteUser`. |
| **`V32-011`** | `DB-01`, `DB-02`, `DB-03` | **P1** | **`PARTIAL (DB-03 PASS / DB-01 & DB-02 PENDING SQL APPLY)`** | **`DB-03` PASS (Live):** `record_study_session_answer` (`0019 L2099–L2487`) deployed live with atomic `attempt_number` + `UNIQUE (session_id, attempt_number)`; `live-db-rpcs` (8/8) & `live-v3-db-rpcs` (8/8) PASS; anon returns `42501`. **`DB-01` & `DB-02` CODE+FALLBACK VERIFIED / PENDING SQL APPLY:** Route-level in-batch `event_id` dedup (`duplicate_ignored`) in `/api/sync/events` and `23505` idempotency fallback in `/api/starred` work live on `PGRST202`; SQL atomic pre-claim (`sync_offline_learning_events`, Block (d)) and `toggle_starred_question` (Block (c)) activate immediately upon SQL Editor apply. |
| **`V32-012`** | `DB-04`, `DB-06`, `DB-07`, `DB-11` | **P1** | **`PASS`** | All 4 items deployed LIVE in `0019` and verified live on `:3042`: **`DB-04`** `global_library_search` returns `0` matches for `import_idempotency_key` token (real prompt returns `1`); **`DB-06`** `list_accessible_study_sets` live (`anon: 42501`); **`DB-07`** `get_user_statistics_summary` & `get_user_mistakes_page` live (`/api/statistics` `200`, `/api/mistakes` `200`, `anon: 42501`); **`DB-11`** `GET /api/sets/[id]/questions?fields=summary` strips `prompt_rich`, `explanation`, `explanation_rich` (`get_study_set_questions_page` live). |
| **`V32-013`** | `SEC-02`, `SEC-03`, `CACHE-02` | **P2** *(Resolved Wave 6)* | **`PASS`** | **Wave 5 REOPENED -> Wave 6 PASS (Verified Live on `:3052`):** Both `http://127.0.0.1:3052` (`523 ms`) and `http://localhost:3052` (`550 ms`) two-tab sign-outs now send `Accept: application/json`, receive `200` JSON (`{"data":{"ok":true,"signedOut":true}}`) with `Cache-Control: private, no-store` + `Vary: Cookie` (**0** CSP errors, **0** `303`), purge 100% of user `localStorage` keys incl. `studyhub-offline-known-users` (`knownUsersPurged: true`), and redirect both tabs to `/login`. Non-JSON `POST /auth/signout` returns `303` with relative `Location: /login` + `Cache-Control: private, no-store` + `Vary: Cookie`. Uncooperative external IDB handle finishes cleanly in `2,064 ms` (`blocking()` + `1500ms` bounded timeout). |
| **`V32-043`** | `SEC-10`, `SEC-11` | **P1/P2** | **`PASS (ROUTE) / PENDING SQL BLOCK (d)`** | **`SEC-11` PASS (Live):** `image_hotspot` `type_payload_snapshot.image_media_id` is pinned in `content_media_relations` on exam creation (`live` DB check `true` + `exam-engine.ts`). **`SEC-10` PASS (Live Route):** `POST /api/sync/events` returns identical opaque `{ status: "rejected_inaccessible", message: "Study content is no longer accessible." }` for both private `setA` and random nonexistent UUID (plus `duplicate_ignored` for duplicate `event_id`). Wave 6 (`#47`/`#53`) updated `tests/integration/live-v3-rls-security.test.ts:1311` -> **`11/11` PASS** against `:3052`! SQL RPC CHECK constraint update awaits `0019` Block (d). |
| **`V32-044`** | `SEC-13`, `SEC-14` | **P2** | **`PASS`** | **`SEC-13` PASS (Live):** Rate limits wired on all 5 high-cost routes (`ACCOUNT_DATA`, `BULK_QUESTIONS`, `EXAM_SUBMIT`, `CYCLE_RESTART`, `SET_CLONE`). Live burst against `GET /api/account/data` (`limit: 5 / 10min`) returned `200, 200, 200, 200, 200, 429` with `Retry-After: 598`. **`SEC-14` PASS (Live + Static):** `git grep "error\.message" src/app/api/` returned **0** matches; live `POST /api/sessions/[fake]/answers` returns static `"Study session or question not found."` (`404`); `v32-backend-security.test.ts` 29/29 PASS. |
| **`V32-045`** | `DB-08` | **P2** | **`VERIFIED (CODE) — PENDING SQL APPLY`** | All 12 redundant single-column B-tree `DROP INDEX IF EXISTS` statements + `idx_questions_source_metadata_idem` cleanly authored in `0019` (`L169–L183`) and verified by `supabase-migrations-audit.test.ts` (12/12 PASS); awaiting manual owner execution in SQL Editor (`0019` Block (b)). |
| **`V32-046`** | `DB-09`, `DB-12` | **P2** | **`PASS`** | Both deployed LIVE on Supabase Cloud and verified: `DB-09` targeted indexes + sargable 14d filter in `get_dashboard_summary` / `get_study_set_summary` live (`0` `unindexed_foreign_keys`, `0` `auth_rls_initplan`); `DB-12` `exam_attempt_answers.is_answered` generated column + updated `save_exam_attempt_answers` live and verified `is_answered: true` on live answered rows. |
| **`V32-047`** | `DB-10` | **P2** | **`PARTIAL (CODE+FALLBACK PASS / PENDING SQL APPLY)`** | `bump_study_set_content_version` (`0019 L2829–L2860`) deployed LIVE (`anon: 42501`). `save_diagram_patch` (`L2970–L3143`) audited and verified in SQL; live API route falls back cleanly on `PGRST202` with batched `upsert` + live `bump_study_set_content_version` until Block (c) runs in SQL Editor. |
| **`V32-051`** | `SEC-15` *(+ `V32-022`)* | **P2** | **`PASS`** | Deterministic `md5(q.id || ':' || itemId)` fallback for `ordering`/`matching` verified in both live `0019` `sanitize_pre_submit_type_payload_seeded` / `create_exam_attempt_v2` SQL and `src/lib/supabase/exam-engine.ts:1010-1075, 1229`. Companion live check on `V32-022` (`FUNC-10c`) also passed (`num_req_unit_stripped: true`, `num_opt_unit_preserved: true`). |
| **`V32-052`** | `SEC-16` | **P2** | **`PASS`** | `mammoth` completely removed from `package.json` & lockfile (`421` production dependencies). `npm audit --omit=dev --json` reports `0 critical`, `0 high`, `2 moderate` (`exceljs` -> transitive `uuid <11.1.1`, GHSA-w5hq-g745-h8pq; `uuid@11` is pure ESM incompatible with `exceljs`'s CommonJS `require("uuid")`, and StudyHub never uses `exceljs`'s `uuid` for security/auth tokens). |

---

## 3. Wave 5 Reopened Findings — All Resolved & Verified in Wave 6

### 3.1 RESOLVED (Wave 6 Verified) — `V32-013` (P2): Client Sign-Out `Accept: application/json`, Relative `Location: /login`, `studyhub-offline-known-users` Purge, and Bounded Multi-Tab IDB Teardown

- **Wave 5 Defect (Historical):** `app-shell.tsx:312-315` and `settings-view.tsx:508-511` omitted `headers: { Accept: "application/json" }`, causing `POST /auth/signout` (`src/app/auth/signout/route.ts`) to emit `303 -> new URL("/login", request.url)`. On `http://127.0.0.1:3042` -> `http://localhost:3042/login`, CSP `connect-src 'self'` blocked `fetch()`, throwing `TypeError` AFTER server `signOut()` and skipping client storage purge & multi-tab redirect.
- **Wave 6 Fixes Applied (`#47`, `#48`, `#49`):**
  1. [`src/components/layout/app-shell.tsx`](file:///d:/Code%20Web/StudyHub/src/components/layout/app-shell.tsx#L312-L316) & [`src/components/layout/settings-view.tsx`](file:///d:/Code%20Web/StudyHub/src/components/layout/settings-view.tsx#L508-L512): added `headers: { Accept: "application/json" }` to `fetch("/auth/signout", ...)`.
  2. [`src/app/auth/signout/route.ts`](file:///d:/Code%20Web/StudyHub/src/app/auth/signout/route.ts#L5-L41): returns `200` JSON `{"data":{"ok":true,"signedOut":true}}` with `Cache-Control: private, no-store` & `Vary: Cookie` for JSON callers, and `303` with relative `Location: /login` + `Cache-Control: private, no-store` + `Vary: Cookie` for non-JSON callers.
  3. [`src/lib/auth/client-session-cleanup.ts`](file:///d:/Code%20Web/StudyHub/src/lib/auth/client-session-cleanup.ts#L16-L23): added `"studyhub-offline-known-users"` to `USER_SCOPED_LOCAL_EXACT_KEYS`.
  4. [`src/lib/offline/db.ts`](file:///d:/Code%20Web/StudyHub/src/lib/offline/db.ts): added `blocking()` `onversionchange` auto-close handler in `openOfflineDb()` and bounded `1500ms` timeout on `deleteDB()` / `closeOfflineDb()`.
- **Wave 6 Live Verification Evidence (`:3052`, Playwright Chromium + Raw HTTP):**
  - **Non-JSON `POST /auth/signout` (`Accept: text/html`, `redirect: "manual"`):**
    - `http://localhost:3052`: `status: 303`, `Location: "/login"`, `Cache-Control: private, no-store`, `Vary: ..., Cookie`.
    - `http://127.0.0.1:3052`: `status: 303`, `Location: "/login"`, `Cache-Control: private, no-store`, `Vary: ..., Cookie`.
  - **JSON `POST /auth/signout` (`Accept: application/json`):**
    - `http://127.0.0.1:3052`: `status: 200`, `Cache-Control: private, no-store`, `Vary: ..., Cookie, Accept-Encoding`, body `{"data":{"ok":true,"signedOut":true}}`.
  - **Chromium 2-Tab Dashboard Sign-Out (`http://127.0.0.1:3052`):** `tab1Redirected: true`, `tab2Redirected: true` in **`523 ms`** (`Accept: application/json` -> `200`, `Cache-Control: private, no-store`, `Vary: ..., Cookie`, `0` console/CSP errors, `knownUsersPurged: true`, `activeUserPointerPurged: true`, `anyUserScopedLeft: false`, `tab1KeysAfter: ["studyhub-auth-event", "studyhub-locale", "theme"]`).
  - **Chromium 2-Tab Dashboard Sign-Out (`http://localhost:3052`):** `tab1Redirected: true`, `tab2Redirected: true` in **`550 ms`** (identical clean `200` + header + storage purge verification; `0` console/CSP errors).
  - **Chromium Uncooperative External IDB Handle (`http://127.0.0.1:3052`, Tab 2 on `/` holding raw `indexedDB.open` ignoring `versionchange`):** `tab1Redirected: true` in **`2,064 ms`** (`~1500ms` bounded timeout + logout/redirect — **0 deadlock**, `knownUsersPurged: true`, `anyUserScopedLeft: false`).

### 3.2 RESOLVED (Wave 6 Verified) — Stale V3.0 Integration Test Expectation (`tests/integration/live-v3-rls-security.test.ts:1311`)
- Updated in Wave 6 (`#47`, `#53`) to strictly assert `"rejected_inaccessible"` when `LIVE_API_BASE_URL` is configured. Re-executed against `http://127.0.0.1:3052` -> **`11/11` PASSED (`100% GREEN`)**.

---

## 4. Migration `0019` Live Supabase Cloud Deployment Matrix (Owner Action Required)

All non-destructive DDL and RPCs in [`supabase/migrations/0019_v3_2_stability_security_and_perf.sql`](file:///d:/Code%20Web/StudyHub/supabase/migrations/0019_v3_2_stability_security_and_perf.sql) are **applied LIVE** on Supabase Cloud (verified `0` Security Advisor errors, `0` `unindexed_foreign_keys`, `0` `auth_rls_initplan`, and `42501` for `anon` on all 11 newly exposed RPCs).

Because Supabase MCP blocks `DROP`/`DELETE` statements without interactive destructive-DDL approval, the following **4 exact SQL blocks** must be run once by the project owner in **Supabase Dashboard -> SQL Editor** to complete `0019` 100% live:

| Block | Migration `0019` Lines | Issues Completed | Live Behavior Before Apply | Live Behavior After Apply |
| --- | --- | --- | --- | --- |
| **Block (a)** | `L30–L165` (`SEC-05`) | **`V32-009`** | `DELETE /api/account/data` already preserves Storage blobs (`preserved_shared_media_count: 1`), but legacy `0013` trigger still cascades `DELETE` onto User B's `content_media_relations` row (`signed-url` -> `404`). | `media_assets.owner_id` becomes nullable (`ON DELETE SET NULL`), `cleanup_profile_media_relations()` preserves cross-tenant exam-pinned `content_media_relations` rows -> User B `signed-url` returns `200`! |
| **Block (b)** | `L166–L185` (`DB-08`) | **`V32-045`** | 12 redundant single-column B-tree indexes + `idx_questions_source_metadata_idem` remain present (extra write overhead). | All 13 redundant/unused indexes cleanly dropped. |
| **Block (c)** | `L2488–L2547` (`toggle_starred_question`) & `L2970–L3143` (`save_diagram_patch`) | **`V32-011` (`DB-02`), `V32-047` (`DB-10`)** | API routes gracefully fall back on `PGRST202` using `23505` idempotency and batched `upsert` + live `bump_study_set_content_version`. | Both atomic single-RTT `SECURITY DEFINER` RPCs activate automatically with zero app restart. |
| **Block (d)** | `L1560–L2098` (`sync_offline_learning_events` + CHECK constraint update) | **`V32-011` (`DB-01`), `V32-043` (`SEC-10`)** | Live `/api/sync/events` route already enforces opaque `rejected_inaccessible` and in-batch `event_id` dedup; concurrent cross-request SQL pre-claim uses fallback path. | Atomic SQL `INSERT ... ON CONFLICT DO NOTHING` pre-claim + DB CHECK constraint for `rejected_inaccessible` activate automatically. |

---

## 5. Verification Evidence Log

### 5.1 Automated Test Suites Executed (Wave 5 `7dfabfd` + Wave 6 Retest)

| Command | Result | Details |
| --- | --- | --- |
| `npx vitest run tests/unit/security tests/unit/offline/db.test.ts` *(Wave 6)* | **PASS (110/110)** | 8/8 files: `supabase-migrations-audit` (12), `vercel-production-hardening` (12), `v32-backend-security` (30), `v31-backend-performance` (7), `security-modules` (12), `v32-client-cache-isolation` (10), `v2-security-regression` (18), `tests/unit/offline/db.test.ts` (9). |
| `LIVE_API_BASE_URL=http://127.0.0.1:3042 npx vitest run tests/integration/live-db-rpcs.test.ts` | **PASS (8/8)** | All live DB RPC tests green against local prod + Supabase Cloud. |
| `LIVE_API_BASE_URL=http://127.0.0.1:3042 npx vitest run tests/integration/live-rls-security.test.ts` | **PASS (11/11)** | All V1/V2 cross-tenant RLS, exam anti-leak, share-link, and storage checks green. |
| `LIVE_API_BASE_URL=http://127.0.0.1:3042 npx vitest run tests/integration/live-v3-db-rpcs.test.ts` | **PASS (8/8)** | All V3 RPCs (12-type grading, search, coverage, sync, media) green. |
| `LIVE_API_BASE_URL=http://127.0.0.1:3052 npx vitest run tests/integration/live-v3-rls-security.test.ts` *(Wave 6)* | **PASS (11/11)** | **100% GREEN** after Wave 6 test expectation update (`rejected_inaccessible` verified live against `:3052`!). |
| `npm audit --omit=dev --json` | **PASS (`0 crit / 0 high`)** | `2 moderate` (`exceljs` -> transitive `uuid <11.1.1`), `421` total prod deps (`mammoth` removed). |

### 5.2 Live API, DB & Real-Chromium Checks Executed
- **2-Account Live API/DB Verification (`wave5_sec_verify.mjs` against `:3042` + live Supabase Cloud):**
  - `Cache-Control: private, no-store` + `Vary: Cookie` confirmed on all private/exam/JSON-signed-url endpoints; `signed-url?redirect=1` (`302`, `private, max-age=60, must-revalidate`, `Vary: Cookie`, `expiresIn: 300`); `/sw.js` (`no-cache, no-store, must-revalidate`).
  - Pre-submit exam reload fidelity (`V32-002`) + confidence score neutrality + `FUNC-10c` numerical unit stripping (`V32-022`) + `SEC-15` deterministic fallback (`V32-051`) + `SEC-11` `image_hotspot` pinning (`V32-043`): ALL **PASS**.
  - `SEC-06` copy-on-clone media isolation (`V32-009`): **PASS** (`cloned: 200`, `revoked original: 404`).
  - `SEC-05` account deletion storage preservation (`V32-009`): Storage blob preserved (`pinnedBlobPreservedInStorage: true`, `unpinnedBlobPurgedFromStorage: true`, `preserved_shared_media_count: 1`), `signed-url` awaits `0019` Block (a) SQL apply (`404` under legacy `0013` trigger).
  - `DB-04` (`import_idempotency_key` returns `0` matches), `DB-11` (`?fields=summary` strips heavy fields), `DB-07` (`/api/statistics` & `/api/mistakes` `200`), `DB-12` (`is_answered: true`), `SEC-14` (static `404` on `/api/sessions/[fake]/answers`), `SEC-13` (`GET /api/account/data` burst `5x200` -> 6th `429` `Retry-After: 598`): ALL **PASS**.
  - All 11 newly live `0019` RPCs invoked via `anon` client -> **11/11 returned PostgreSQL `42501` (`permission denied`)**.
- **Real-Chromium Multi-Account & Multi-Tab Isolation (`wave5_browser_isolation.mjs`, `wave5_logout_repro.mjs`, `wave6_sec_retest.mjs`):**
  - Focus-route session-expiry account switch (`V32-001`): **PASS** (`pointerMatchesUserB: true`, `pointerLeakedUserA: false`, `hasUserACheckpoint: false`, `hasLegacyDraft: false`, `syncCallsWithUserA: 0`).
  - Wave 6 sign-out on BOTH `http://127.0.0.1:3052` (`523 ms`) and `http://localhost:3052` (`550 ms`): **PASS** (`Accept: application/json` -> `200 JSON` with `Cache-Control: private, no-store` + `Vary: Cookie`, 0 CSP errors, both tabs redirected to `/login`, `knownUsersPurged: true`, 0 user-scoped keys left).
  - Wave 6 uncooperative external IDB handle on `http://127.0.0.1:3052`: **PASS** (`tab1Redirected: true` in `2,064 ms`, `0` hang, `knownUsersPurged: true`).
  - Wave 6 non-JSON `POST /auth/signout` (`Accept: text/html`) on both origins: **PASS** (`303`, relative `Location: /login`, `Cache-Control: private, no-store`, `Vary: ..., Cookie`).

### 5.3 Teardown, Data Integrity & Cleanup Attestation (Wave 5 & Wave 6)
- **Local Production Servers (`:3042` Wave 5 & `:3052` Wave 6):** Both killed cleanly; verified `Get-NetTCPConnection -LocalPort 3052` count = **`0`** (and `3042` = **`0`**).
- **Disposable Test Resources (`v32-w6-sec-*` / `v32-w5-sec-*` / `v32-sec-*`):**
  - `remainingW6SecUsers`: **`0`**
  - `remainingW5SecUsers`: **`0`**
  - `remainingW1SecUsers`: **`0`**
  - `bucketSecPrefixes`: **`study-media: 0`, `study-temp: 0`**
- **Pre-existing Real Owner Data:** Completely untouched — verified exact owner baseline preserved (`nonDisposableOwnerUsers: 2`, `studySets: 3`, `questions: 599`, `examAttempts: 2`; never queried/modified real user accounts or `sample-data/` content; never printed `.env.local` values).
- **Auditor Read-Only Guarantee:** `security-auditor` made **0** modifications to `src/*`, `supabase/*`, `public/*`, `package.json`, `next.config.ts`, or `docs/audit/v3.2-stability/ISSUE_TRACKER.md`. Exclusive deliverable updated: [`docs/audit/v3.2-stability/SECURITY_REGRESSION.md`](file:///d:/Code%20Web/StudyHub/docs/audit/v3.2-stability/SECURITY_REGRESSION.md).

---

## 6. `V32-053` Addendum (Post-Import Multimedia Editor & Migration `0020`) — Scenario H Security, Pre-Submit Explanation-Media Anti-Leak & Live RLS Verification

- **Auditor:** Agent 9 (`security-auditor` — strictly independent, read-only against production code)
- **Target:** Local production build (`npx next start -p 3062`, cleanly torn down post-audit) connected to live Supabase Cloud with [`supabase/migrations/0020_v3_2_post_import_multimedia_editor.sql`](file:///d:/Code%20Web/StudyHub/supabase/migrations/0020_v3_2_post_import_multimedia_editor.sql) applied LIVE (`#91`, `0` Security Advisor errors, `0` `unindexed_foreign_keys`, `0` `auth_rls_initplan`).
- **Pre-Apply Migration `0020` Review (`#85` -> `#86` -> `#88`):** Caught and verified closure of 3 security/robustness blockers before live apply: (1) closed pre-submit `explanation`/`hint`/`back` media side-channel across `exam_attempt_questions.review_media_snapshot` column `REVOKE`, `can_read_exam_snapshot_media()`, `is_exam_attempt_question_reviewable()`, and `content_media_relations_select_readable`; (2) scoped `question_reports` filter in `get_study_set_questions_page_v2` to `(qr.reporter_id = v_caller OR public.can_edit_study_set(p_set_id, v_caller))`; (3) replaced unsafe `::boolean` cast on `source_metadata->>'ambiguous_media'` and switched all 18 signed-URL path encodings to `public.url_encode_query_param(...)`.

### 6.1 Scenario H Verdict: **`PASS (7/7 Live Multi-Account Checks + 153/153 Security Unit & Live RLS Tests GREEN)`**

| Scenario H Check | Status | Concrete Live Evidence (`:3062` + Live Supabase Cloud) |
| --- | --- | --- |
| **1. 4-Role API RBAC** (`Owner A`, `Editor B`, `Viewer C`, `Outsider D`) | **`PASS`** | Owner A (`upload: 201`, `create: 201`) & Editor B (`upload: 201`, `patch: 200`) authorized; Viewer C blocked (`upload: 403`, `patch: 403`, `create: 403`); Outsider D blocked (`upload: 404`, `patch: 404`). |
| **2. Cross-Tenant Private `media_id` Hijack Guard** | **`PASS`** | Editor B attempting to attach Owner A's private-set `media_id` to Shared Set S question (`403`) or option (`403`), and Owner A attempting to attach Outsider D's private-set `media_id` (`403`), are ALL rejected by `verifyEditableMediaOwnership()`. |
| **3. Pre-Submit Explanation-Media Anti-Leak (ALL 4 Vectors)** | **`PASS`** | Tested live on `in_progress` exam with `prompt`, `option` (x2), `explanation`, and `hint` images (plus share revocation of Viewer C pre-submit to isolate snapshot access):<br>• **Vector 1 (API `POST /api/exams` & `GET /api/exams/[id]`):** `review_media_snapshot` omitted (`false`/`false`), `media_snapshot` contains ONLY `["prompt"]` (`0` unsafe roles), `options_snapshot[0].media` preserves all `2` option images; post-submit `POST /submit` & `GET` both return `review_media_snapshot` (`2` items: `explanation` + `hint`).<br>• **Vector 2 (Direct PostgREST `exam_attempt_questions`):** `select("id, review_media_snapshot")` returns PostgreSQL **`42501`** (`0` rows); `select("id, media_snapshot")` returns ONLY `["prompt"]`.<br>• **Vector 3 (Direct PostgREST `content_media_relations`):** `entity_type = 'exam_attempt_question'` returns ONLY `["prompt", "option", "option"]` while `in_progress` (`preSubmitLeakedReview: false`), and reveals `["explanation", "hint", "prompt", "option", "option"]` immediately post-submit.<br>• **Vector 4 (`GET /api/uploads/signed-url`):** Revoked examinee pre-submit receives **`200`** on `prompt` & both `option` images, **`404`** on `explanation` & `hint` images; immediately after submit receives **`200`** on BOTH `explanation` & `hint` images! |
| **4. `DELETE /api/uploads/image/[mediaId]` Auth & `409` Reference Guard** | **`PASS`** | Owner A deletes unreferenced upload (`200`, DB row deleted, Storage blob gone); Owner A blocked (`409 CONFLICT`) from deleting active prompt image (`409`), historical-exam-only option image (`409`), and historical-exam-only explanation image (`409`); non-owners blocked from deleting Owner A's unreferenced upload (`Editor B: 403`, `Viewer C: 404`, `Outsider D: 404`, DB row intact). |
| **5. Historical Exam Multi-Image Options & Explanation Preservation (`ON DELETE RESTRICT`)** | **`PASS`** | After Owner A `PATCH`es Q1 replacing prompt image & clearing option images (preserving original `option.id`: `true`), revoked examinee Viewer C's submitted exam STILL has all `2` original `options_snapshot[0].media` items + `2` `review_media_snapshot` items, and `GET /api/uploads/signed-url` returns **`200`** for ALL 4 original images (`prompt`, `opt1`, `opt2`, `expl`). |
| **6. `mediaFilter=missing_media` Cross-Viewer `question_reports` Privacy** | **`PASS`** | After Viewer C submits a `missing_media` report on clean Q2 (`201`): Owner A (`true`), Editor B (`true`), and Reporter Viewer C (`true`) see Q2 under `?mediaFilter=missing_media`; unrelated reader Viewer E sees **`false`** in BOTH `fields=summary` and `fields=full` (**0** cross-viewer report existence leak). |
| **7. Real-Chromium RBAC UI Verification** | **`PASS`** | Viewer C sees **`0`** edit buttons (`hub-edit-question-*`, `Chỉnh sửa`, `Chỉnh sửa câu hỏi`, `Chỉnh sửa câu hỏi gốc`, `/edit` links) across `/sets/[id]`, `/sets/[id]/practice`, `/review`, and `/exams/[attemptId]/results`, and `/sets/[id]/edit` is blocked (`blocked: true`). Owner A sees `2` edit buttons on `/sets/[id]` and strictly **`0`** edit controls inside active `/exams/[attemptId]` Live Exam Runner. |

### 6.2 `V32-053` Automated Security Unit & Live RLS Suites (Against `:3062` + Live `0020` Cloud)

| Suite | Result | Details |
| --- | --- | --- |
| `tests/unit/security` (8 files incl. new `v32-addendum-backend.test.ts`) | **PASS (115/115)** | `supabase-migrations-audit` (12), `vercel-production-hardening` (12), `v32-addendum-backend` (14), `v32-backend-security` (30), `v31-backend-performance` (7), `security-modules` (12), `v32-client-cache-isolation` (10), `v2-security-regression` (18). |
| `LIVE_API_BASE_URL=http://127.0.0.1:3062` `tests/integration/live-db-rpcs.test.ts` | **PASS (8/8)** | All V1/V2 triggers, constraints, coverage cycles, and `get_practice_question_pool` (`0020`) green. |
| `LIVE_API_BASE_URL=http://127.0.0.1:3062` `tests/integration/live-rls-security.test.ts` | **PASS (11/11)** | All V1/V2 cross-tenant RLS, storage, and HTTP API security checks green (`12.15s` on HTTP suite). |
| `LIVE_API_BASE_URL=http://127.0.0.1:3062` `tests/integration/live-v3-db-rpcs.test.ts` | **PASS (8/8)** | All V3 12-type grading, confidence neutrality, search, sync, and `ON DELETE RESTRICT` checks green. |
| `LIVE_API_BASE_URL=http://127.0.0.1:3062` `tests/integration/live-v3-rls-security.test.ts` | **PASS (11/11)** | All V3 RLS, private notes, reports, sync `rejected_inaccessible`, storage, 12-type pre-submit anti-leak (`1.79s`), and PDF export checks green. |
| **Combined Security Total** | **PASS (153/153)** | **12/12 test files, 153/153 tests PASSED (100% GREEN)** *(Note: when all 4 live integration suites + 5 Playwright sessions ran simultaneously against single-node `:3062`, transient connection contention caused 1 timeout + 1 transient `500`; standalone sequential reruns of both `live-rls-security` and `live-v3-rls-security` passed `11/11` cleanly.)* |

### 6.3 `V32-053` Teardown & Cleanup Attestation
- **Port `:3062`:** Killed cleanly; verified `Get-NetTCPConnection -LocalPort 3062` count = **`0`**.
- **Disposable Accounts & Media (`v32-add-sec-*` + prior `v32-w6-sec-*`/`v32-w5-sec-*`/`v32-sec-*`):** `remainingSecUsers: 0`, `remainingSecSets: 0`, `bucketSecPrefixes: { "study-media": 0, "study-temp": 0 }`.
- **Real Owner Integrity:** Preserved 100% untouched (`ownerUsers: 2`, `ownerSets: 4`, `ownerQuestions: 599`, `ownerExamAttempts: 2`).
- **Auditor Read-Only Guarantee:** `security-auditor` made **0** modifications to `src/*`, `supabase/*`, `public/*`, `package.json`, `next.config.ts`, or `tests/*`.
