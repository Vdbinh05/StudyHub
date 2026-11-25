# StudyHub V3.2 — Wave 1 Independent Security, Cache & Database Optimization Audit

> **Auditor:** Agent 9 (`security-auditor`) — Independent Security & Database Optimization Auditor  
> **Scope:** Full static audit (Cache Architecture & Privacy Isolation, 71 API Routes + 3 Auth Routes, PostgreSQL Migrations `0001`–`0018`, Security Baseline & Secret Hygiene) + Live Read-Only Supabase Cloud & 2-Account Isolation Verification against `https://studyhub-three-mauve.vercel.app`  
> **Mode:** Strictly Read-Only Wave 1 Audit (0 production files modified; 0 real user accounts/data/media touched; 100% disposable `v32-sec-` accounts verified and purged).

---

## 1. Executive Summary & Severity Tally

StudyHub V3.1 has a strong foundational security posture: **37/37 public tables have RLS enabled**, **131/131 active RLS policies** wrap `auth.uid()` in `(SELECT auth.uid())` with explicit `TO` roles and zero `USING (true)`, **0** server routes call `getSession()`, **0** client files reference `SUPABASE_SECRET_KEY` / `SUPABASE_SERVICE_ROLE_KEY`, **0** AI or payment SDKs exist in `package.json`, `Ctrl+K` Global Search is hard-blocked on live exam routes, `pdfjs-dist` and ZIP/OOXML guards are hardened, and pre-submit exam column-level `REVOKE`s prevent direct PostgREST answer-key reads.

However, the V3.2 deep audit uncovered **30 confirmed defects and bottlenecks** across cache isolation, cross-tenant data integrity, exam reload fidelity, database concurrency, and query/index efficiency:

| Category | P0 (Critical) | P1 (High) | P2 (Medium) | P3 (Low) | Total |
| --- | :---: | :---: | :---: | :---: | :---: |
| **Security, Cache Isolation & Data Integrity (`SEC-xx`)** | 1 | 7 | 6 | 2 | **16** |
| **Database, Concurrency & API Performance (`DB-xx`)** | 0 | 7 | 6 | 1 | **14** |
| **Total** | **1** | **14** | **12** | **3** | **30** |

### Top Priority Findings Requiring Immediate V3.2 Remediation
1. **`SEC-01` (P0):** Cross-account `activeUserId` / IndexedDB / `sync_queue` hijack when User B signs into a focus route (or before `/api/profile` settles) after User A's session expires without clicking UI Sign Out.
2. **`SEC-02` & `SEC-03` (P1):** Incomplete logout/account-switch purges (unpartitioned `localStorage` exam drafts, preferences, module singletons, orphaned checkpoints, uncanceled in-flight React Query fetches, and multi-tab React Query retention).
3. **`SEC-04` (P1):** Missing `Cache-Control: private, no-store` on **65 of 71** authenticated API routes — including post-submit `GET /api/exams/[attemptId]` (which returns full answer keys) and JSON `GET /api/uploads/signed-url`.
4. **`SEC-05` & `SEC-06` (P1):** `DELETE /api/account/data` (`scope: "account"`) unconditionally wipes Storage files & `content_media_relations` referenced by **other users' historical exam snapshots and cloned sets**, while `clone_study_set` cross-tenant media references break on share revocation.
5. **`SEC-07` (P1):** `GET /api/exams/[attemptId]` strips `structured_response`, `confidence`, and `hint_used` pre-submit — silently discarding in-progress answers for all V3 structured exam types on page reload or device switch.
6. **`DB-01` & `DB-02` (P1):** Concurrency race conditions (duplicate SM-2/counter application in `sync_offline_learning_events`, lost updates in `record_study_session_answer` and 6 core mutation API routes).
7. **`DB-03`–`DB-07` (P1):** High-impact query bottlenecks — triple-fetch study-mode waterfall (`useStudySetBundle`), unindexed `source_metadata::text ILIKE` + internal metadata leak in `global_library_search()`, broken `idx_questions_source_metadata_idem` index match in `/api/import/commit`, silent 100-set truncation in `GET /api/sets`, and heavy Node-side full-table scans + PostgREST truncation risk in `GET /api/statistics` and `GET /api/mistakes`.

---

## 2. Cache Architecture & Privacy Isolation Matrix

StudyHub currently maintains **9 distinct client/edge/server caching and persistence layers** with overlapping ownership and uneven invalidation/logout boundaries:

| # | Layer / Store | Scope / Partitioning | TTL / Stale Policy | Cleared on Logout? | Account-Switch Safe? | Primary Defects |
| --- | --- | --- | --- | :---: | :---: | --- |
| 1 | **HTTP `Cache-Control` (API Routes)** (`src/lib/security/errors.ts:65`) | Per-response | Unset on **65/71** API routes; `private, max-age=1800` on `signed-url?redirect=1` | N/A | **No** (no `private, no-store` default) | `SEC-04`, `SEC-09` |
| 2 | **Next.js App Router / Edge Cache** (`next.config.ts`, `src/proxy.ts`) | Dynamic SSR on auth cookies | `sw.js`: `no-cache, no-store, must-revalidate`; `/_next/static`: immutable | N/A | Yes (cookies force dynamic) | Verified clean |
| 3 | **Service Worker Cache** (`public/sw.js`) | Origin-wide `studyhub-shell-v3` | Network-only for `/api/*`, `/auth/*`, `/share/*`, HTML navigations; cache-first for `/_next/static/*` | `CLEAR_USER_CACHES` keeps static shell only | Yes (never caches private HTML/API/media) | Verified clean |
| 4 | **React Query Client Cache** (`src/app/(app)/authenticated-providers.tsx:32-61`) | Single in-memory `QueryClient` per browser tab | `staleTime: 30s` (`60s` profile/live-exam), `gcTime: 5m`, `refetchOnWindowFocus: false` | Partial (`clear()` without `cancelQueries()`; wrong order in `settings-view.tsx`) | **No** (not cleared on multi-tab switch or silent `userId` change) | `SEC-02`, `SEC-03`, `SEC-08` |
| 5 | **IndexedDB Offline Store** (`src/lib/offline/db.ts`) | Partitioned DB `studyhub-offline-v3:${userId}` | Persistent until user deletes / logs out | Yes on UI Sign Out (`clearOfflineDataForLogout`) | **Broken** when `AuthenticatedBootstrap` reuses stale `storedUserId` | `SEC-01` |
| 6 | **`localStorage` Active User Pointer** (`studyhub-offline-active-user`) | Unpartitioned origin key | Persistent until UI Sign Out | Yes on UI Sign Out, **NOT** on `/login` or session expiry | **No** (trusted blindly on focus routes & pre-hydration) | `SEC-01` |
| 7 | **`localStorage` Learning Checkpoints** (`studyhub-v3-checkpoint:${userId}:*`) | Partitioned by `userId` | Persistent; mirrors PG `learning_session_checkpoints` + IDB `local_checkpoints` (3x duplicate!) | **NO** (`clearAllLocalCheckpointsForUser` never called on logout) | Partial (leaks if `SEC-01` hijacks `userId`; remains on disk after logout) | `SEC-01`, `SEC-02`, `SEC-08` |
| 8 | **`localStorage` Exam Drafts** (`studyhub-exam-draft-v2-${attemptId}`) | **Unpartitioned** (`attemptId` only) | Persistent until manual submit | **NO** (never purged on logout) | **No** (persists User A's unfinished answers on shared devices) | `SEC-02` |
| 9 | **`localStorage` + Module Singletons** (`studyhub-user-preferences`, `studyhub-shortcuts-enabled`, `studyhub-sidebar-collapsed`, `cachedRawPrefs`/`cachedParsedPrefs`) | **Unpartitioned** origin keys & JS globals | Persistent across sessions | **NO** | **No** (User A's language/theme/mode prefs bleed into User B) | `SEC-02` |

### Duplicate Caching Systems Identified
1. **Learning Checkpoints (3x):** Stored simultaneously in PostgreSQL (`learning_session_checkpoints`), IndexedDB (`local_checkpoints` store), and `localStorage` (`studyhub-v3-checkpoint:${userId}:*`) with no single source of truth or unified logout purge.
2. **User Preferences (3x):** Stored in PostgreSQL (`user_preferences`), React Query (`["current-profile"]` + `["user-preferences"]`), and `localStorage["studyhub-user-preferences"]` + module globals `cachedRawPrefs`/`cachedParsedPrefs` (`src/lib/preferences/index.tsx:233-234`).
3. **Study Set & Question Data (5x):** Cached across four separate React Query key families (`["study-set", id]`, `["set-questions", id]`, `["editor-questions", id]`, `["study-set-bundle", id, max]`) plus IndexedDB (`offline_sets` / `offline_questions`). Mutations routinely invalidate only 1–2 keys, leaving the rest stale (`SEC-08`).

---

## 3. Security, Cache Isolation & Data Integrity Findings (`SEC-01`–`SEC-16`)

### `SEC-01` [P0] Cross-Account `activeUserId`, IndexedDB & `sync_queue` Hijack on Focus Routes and Pre-Hydration Navigation
- **Evidence:**
  - `src/app/(app)/authenticated-providers.tsx:24-25, 98-151`
  - `src/components/pwa/PwaProvider.tsx:410-436, 563-583`
  - `src/components/auth/login-form.tsx:135-153`
- **Root Cause:**
  1. `AuthenticatedBootstrap` initializes `storedUserId` from `localStorage["studyhub-offline-active-user"]` (`L98-100`) and `hasCachedPrefs` from `localStorage["studyhub-user-preferences"]` (`L101-103`).
  2. On any focus route matching `FOCUS_ROUTE_PATTERN` (`/sets/[id]/(flashcards|learn|practice|write|spell|match|test|results)` or `/exams/[id]`), line `107-108` computes:
     `shouldFetchProfile = supabaseConfigured && (!isFocusRoute || !storedUserId || !hasCachedPrefs)` -> **`false`**.
  3. `LoginForm` (`L135-153`) never clears `studyhub-offline-active-user` or `studyhub-user-preferences` before/after signing in.
  4. When User A's session expires (or cookies are cleared without clicking UI Sign Out) and User B signs in via `/login?next=/sets/<id>/practice`, `GET /api/profile` is skipped completely and `resolvedUserId` (`L140-144`) remains **`userA.id`**.
  5. `AuthenticatedBootstrap` passes `userId={userA.id}` to `<PwaProvider>`. Because `explicitUserId !== undefined`, `PwaProvider.tsx:410-436` short-circuits and **skips `supabase.auth.getUser()` and `onAuthStateChange`**.
  6. `PwaProvider.tsx:563-578` then opens **User A's IndexedDB** (`studyhub-offline-v3:${userA.id}`), reads User A's offline sets/notes/checkpoints, and automatically calls `syncNow(false)` — submitting **User A's pending `sync_queue` events to `POST /api/sync/events` authenticated with User B's session cookies**.
  7. Even on non-focus routes (`/dashboard`), while `profileQuery` is in-flight (`isLoading`), `resolvedUserId` falls back to `storedUserId` (`userA.id`). During SPA navigation from `/login` -> `/dashboard` (`document.readyState === "complete"`), `PwaProvider`'s idle timer can flush `userA.id`'s queue under User B's cookies if `/api/profile` is slow (>2.5s).
- **Reproduction Steps:**
  1. Sign in as User A on browser Tab 1, queue 1 offline study event (or save a local checkpoint) so `studyhub-offline-active-user = userA.id` and `studyhub-user-preferences` exist in `localStorage`.
  2. Clear `sb-*` auth cookies (simulating expired session or external logout) without clicking Sign Out.
  3. Navigate to `/login?next=/sets/<sharedSetId>/practice` and sign in as User B.
  4. Observe zero `GET /api/profile` call; `<PwaProvider>` activates with `activeUserId = userA.id`, opens `studyhub-offline-v3:${userA.id}`, and dispatches User A's `sync_queue` under User B's cookies.
- **Remediation:**
  1. **Pass server-verified `initialUserId` from `src/app/(app)/layout.tsx` (Server Component)** using `supabase.auth.getUser()` directly into `<AuthenticatedProviders initialUserId={user.id}>` — eliminating untrusted `localStorage` identity bootstrapping completely while still avoiding an extra client `/api/profile` round-trip on focus routes!
  2. Never fall back to `storedUserId` before server verification completes (`resolvedUserId = initialUserId ?? profileQuery.data?.profile?.id ?? null`).
  3. On `LoginForm` submit/success, call `clearClientSessionState()` to purge any stale `studyhub-offline-active-user` and unpartitioned caches before redirecting.
  4. When `prevUserId && nextUserId && prevUserId !== nextUserId`, immediately `await queryClient.cancelQueries()`, `queryClient.clear()`, and `await switchOfflineUser(prevUserId, nextUserId)` BEFORE scheduling `syncNow()`.

---

### `SEC-02` [P1] Incomplete Logout & Account-Switch Purge (Unpartitioned `localStorage`, Module Singletons, Exam Drafts & In-Flight Query Race)
- **Evidence:**
  - `src/components/layout/app-shell.tsx:300-308`
  - `src/components/layout/settings-view.tsx:461-472`
  - `src/lib/learning/checkpoints.ts:241`
  - `src/components/exam/LiveExamRunner.tsx:93, 218-253`
  - `src/lib/preferences/index.tsx:20, 233-298`
  - `src/components/layout/ShortcutProvider.tsx:40`
- **Root Cause:**
  1. `clearAllLocalCheckpointsForUser()` (`checkpoints.ts:241`) is **never called on logout** (only inside `ResetProgressDialog.tsx:161`), leaving `studyhub-v3-checkpoint:${userId}:*` behind in `localStorage`.
  2. `LiveExamRunner.tsx:93,223` persists unfinished exam answers under an unpartitioned key `studyhub-exam-draft-v2-${attemptId}` that is **never removed on logout**.
  3. `studyhub-user-preferences`, `studyhub-shortcuts-enabled`, `studyhub-sidebar-collapsed`, and JS module singletons `cachedRawPrefs`/`cachedParsedPrefs` (`preferences/index.tsx:233-234`) are neither user-partitioned nor reset on logout — leaking User A's preferences into User B's session.
  4. `handleSignOut` (`app-shell.tsx:303-306`) calls `queryClient.clear()` **without** `await queryClient.cancelQueries()`, allowing in-flight React Query fetches to resolve after `clear()` and repopulate cache.
  5. `settings-view.tsx:464-467` (account deletion sign-out) calls `queryClient.clear()` **before** `await clearOfflineDataForLogout()` and `await fetch("/auth/signout")`.
- **Reproduction Steps:**
  1. Sign in as User A, change language/theme/mode preferences, start an exam (creating `studyhub-exam-draft-v2-*`), and visit a study mode (creating `studyhub-v3-checkpoint:${userA}:*`).
  2. Click Sign Out. Inspect `window.localStorage` in DevTools.
  3. Observe `studyhub-exam-draft-v2-*`, `studyhub-v3-checkpoint:${userA}:*`, `studyhub-user-preferences`, and `studyhub-shortcuts-enabled` all remain intact.
- **Remediation:**
  1. Create a single centralized `purgeAllUserClientState(queryClient, userId)` utility invoked by `app-shell.tsx`, `settings-view.tsx`, `login-form.tsx`, and account-switch effects:
     - `await queryClient.cancelQueries()` -> `queryClient.clear()`
     - `await fetch("/auth/signout", { method: "POST", credentials: "same-origin" })` (revoke server cookies first so no background fetch can re-authenticate)
     - `await clearOfflineDataForLogout(userId)`
     - `clearAllLocalCheckpointsForUser(userId)` + remove all `studyhub-exam-draft-v2-*` keys
     - Clear `studyhub-user-preferences`, `studyhub-shortcuts-enabled`, `studyhub-sidebar-collapsed` and reset `cachedRawPrefs`/`cachedParsedPrefs` via exported `resetLocalPreferencesCache()`
     - Broadcast `LOGOUT` / `ACCOUNT_SWITCH` via `BroadcastChannel("studyhub-auth")` + `localStorage` event.
  2. Partition exam draft keys by `userId` (`studyhub-exam-draft-v3:${userId}:${attemptId}`).

---

### `SEC-03` [P1] Multi-Tab Account Switch Retains Previous User's React Query Cache
- **Evidence:**
  - `src/app/(app)/authenticated-providers.tsx:54, 92-175`
  - `src/components/pwa/PwaProvider.tsx:410-436`
- **Root Cause:** Because `AuthenticatedBootstrap` passes `explicitUserId` to `PwaProvider`, Supabase's `onAuthStateChange` listener is completely bypassed on all `(app)` routes. Neither `AuthenticatedBootstrap` nor `PwaProvider` listens to `BroadcastChannel` or `window.addEventListener("storage")` for `studyhub-offline-active-user` changes. Combined with `refetchOnWindowFocus: false` (`L54`), Tab 1 stays mounted with User A's cached React Query data (`["dashboard"]`, `["study-sets"]`, `["current-profile"]`, `["exam-attempt-live"]`) after Tab 2 signs out User A and logs in User B.
- **Reproduction Steps:**
  1. Open `/dashboard` as User A in Tab 1 and Tab 2.
  2. In Tab 2, click Sign Out and log in as User B.
  3. Switch back to Tab 1 and navigate client-side (within 30s–60s stale window) or inspect rendered dashboard/profile. Tab 1 continues displaying User A's cached profile/sets.
- **Remediation:** Add a `BroadcastChannel("studyhub-auth")` + `storage` event listener on `ACTIVE_USER_POINTER_KEY` inside `AuthenticatedProviders` that cancels queries, clears `QueryClient`, resets module preference caches, and triggers `window.location.replace("/login")` (on logout) or full reload (on account change).

---

### `SEC-04` [P1] Authenticated API Responses Served With `Cache-Control: public, max-age=0, must-revalidate` (Missing `private, no-store` & `Vary: Cookie` on 65/71 Routes)
- **Evidence:**
  - `src/lib/security/errors.ts:65-72` (`apiSuccess()` sets zero `Cache-Control` header)
  - `src/app/api/exams/[attemptId]/route.ts:236` (post-submit response includes `correct_option_ids`, `accepted_answers_snapshot`, `explanation_snapshot`, `type_payload_snapshot`)
  - `src/app/api/uploads/signed-url/route.ts:36-46` (JSON mode sets zero `Cache-Control` header while returning 1-hour Supabase Storage signed URL)
  - Static sweep across all 71 routes in `src/app/api/**/route.ts`: only 6 routes set any `Cache-Control` header (`account/data`, `export/pdf`, `import/parse` [only >2MB streamed], `import/templates/[format]`, `sets/[id]/export`, `uploads/signed-url` [redirect mode only]).
  - **Live Vercel Production Confirmation (`https://studyhub-three-mauve.vercel.app`):** Because `apiSuccess()` omits `Cache-Control`, Vercel Edge injects **`Cache-Control: public, max-age=0, must-revalidate`** with **NO `Vary: Cookie`** on authenticated responses:
    - `GET /api/profile` -> `200`, `Cache-Control: public, max-age=0, must-revalidate`
    - `GET /api/dashboard` -> `200`, `Cache-Control: public, max-age=0, must-revalidate`
    - `GET /api/sets` -> `200`, `Cache-Control: public, max-age=0, must-revalidate`
    - `GET /api/uploads/signed-url?path=...` (JSON mode) -> `200`, `Cache-Control: public, max-age=0, must-revalidate`, `Vary: (none)`
    - `GET /api/exams/[attemptId]` (post-submit with `correct_option_ids` & explanations) -> `200`, `Cache-Control: public, max-age=0, must-revalidate`
- **Root Cause:** `apiSuccess()` and `apiError()` in `src/lib/security/errors.ts` return `NextResponse.json(...)` without a default `Cache-Control: private, no-store` header, causing Vercel's default `public, max-age=0, must-revalidate` fallback to apply to private user data, profile emails, signed URLs, and exam answer keys. Under RFC 9111, `public, max-age=0, must-revalidate` permits shared forward proxies and browser disk caches to store response bodies on disk (only requiring revalidation before reuse).
- **Reproduction Steps:** Send authenticated `GET /api/profile`, `GET /api/dashboard`, `GET /api/exams/[submittedId]`, or `GET /api/uploads/signed-url?path=...` (without `redirect=1`) against `https://studyhub-three-mauve.vercel.app` and inspect `Cache-Control` and `Vary` response headers.
- **Remediation:** Set `"Cache-Control": "private, no-store"` and `"Vary": "Cookie"` by default inside `apiSuccess()` and `apiError()` in `src/lib/security/errors.ts` (allowing explicit opt-out ONLY for public static template downloads like `/api/import/templates/[format]`).

---

### `SEC-05` [P1] Account Deletion (`DELETE /api/account/data`, `scope: "account"`) Destroys Other Users' Historical Exam Media & Cloned Set Media
- **Evidence:**
  - `src/app/api/account/data/route.ts:299-319`
  - `supabase/migrations/0013_v3_media_richtext_questions_schema.sql:96, 990-1004` (`cleanup_profile_media_relations`)
- **Root Cause:**
  1. When User A shares a study set containing images/audio with User B, User B's historical exam snapshots pin User A's `media_assets` via `content_media_relations (entity_type = 'exam_attempt_question', media_id REFERENCES media_assets ON DELETE RESTRICT)`.
  2. When User A executes `DELETE /api/account/data` with `scope: "account"`:
     - Line `299`: `await supabase.from("media_assets").delete().eq("owner_id", user.id)` silently fails (error ignored) for pinned assets due to `ON DELETE RESTRICT`.
     - Line `309`: `await purgeUserStorageFolder(bucket, user.id)` runs with the **`service_role` admin client** and **unconditionally deletes EVERY file under `study-media/{userA.id}/*`**, immediately destroying the Storage blobs backing User B's historical exam snapshots and User B's cloned study sets!
     - Line `316`: `admin.auth.admin.deleteUser(user.id)` cascades to `profiles` DELETE -> trigger `cleanup_profile_media_relations()` (`0013:990-1004`) deletes ALL `content_media_relations` rows referencing `ma.owner_id = OLD.id`, wiping User B's exam snapshot media relations too!
- **Reproduction Steps:**
  1. User A uploads an image to Set A and shares Set A with User B.
  2. User B takes and submits an exam on Set A (pinning User A's media in `content_media_relations`).
  3. User A calls `DELETE /api/account/data` with `{ confirm: "DELETE_MY_DATA", scope: "account" }`.
  4. User B opens their historical exam result — the image returns `404` permanently and its `content_media_relations` row is gone.
- **Remediation:**
  1. Before purging Storage in `DELETE /api/account/data`, query `media_assets` owned by `user.id` that have **zero** remaining `content_media_relations` owned by other users; remove ONLY unreferenced object paths instead of wiping the entire `{user.id}/` prefix.
  2. In `media_assets`, change `owner_id` to nullable (`ON DELETE SET NULL` or transfer ownership to a system sentinel / tombstone owner) for assets still referenced by other users' `exam_attempt_question` or cloned sets, and narrow `cleanup_profile_media_relations()` so it NEVER deletes relations belonging to another user's `exam_attempt_question` or study set.

---

### `SEC-06` [P1] `clone_study_set` Cross-Tenant Media Coupling Breaks Cloned Sets on Revocation & Blocks Owner Media Deletion
- **Evidence:**
  - `supabase/migrations/0016_v3_live_fixes.sql:846-872` (`clone_study_set` copies `media_id` and `storage_path` references directly from source owner)
  - `supabase/migrations/0013_v3_media_richtext_questions_schema.sql:757-773` (`study_media_select` policy on `storage.objects`)
  - `supabase/migrations/0005_v2_custom_exams_and_coverage.sql:870-896` (`can_access_study_media_path`)
- **Root Cause:**
  1. `clone_study_set()` inserts `content_media_relations` rows for User B's cloned set pointing directly to User A's `media_assets.id` and `storage_path` (`{userA}/{setA}/...`).
  2. `storage.objects` SELECT policy (`0013:757-773`) authorizes `study-media` paths ONLY via `can_access_study_media_path(folder1, folder2, false)` (which checks `can_read_study_set(setA, auth.uid())`) or `can_read_exam_snapshot_media`. It does **NOT** check whether the caller owns a cloned set referencing that `media_id`!
  3. Consequently, the moment Owner A revokes User B's share access to Set A or deletes Set A, **User B gets `404` on images/audio inside User B's own cloned study set**.
  4. Conversely, User B's `content_media_relations` (`ON DELETE RESTRICT`) prevents Owner A from ever deleting their own `media_assets` via `DELETE /api/media/[id]`.
- **Reproduction Steps:**
  1. Owner A shares Set A (containing uploaded image) with `allow_clone = true` to User B.
  2. User B clones Set A -> Set B.
  3. Owner A removes User B from Set A members (or changes Set A back to `private`).
  4. User B opens Set B -> image fails to load via `/api/uploads/signed-url` (`404`).
- **Remediation:** Either copy referenced Storage blobs into `{userB}/{setB}/` and create User B-owned `media_assets` rows during `POST /api/sets/[id]/duplicate` (cleanest full tenant isolation — also eliminates cross-tenant `ON DELETE RESTRICT` coupling), OR add a `can_read_linked_media_path(storage_path, user_id)` check in `storage.objects` SELECT policy + decouple deletion. Copying blobs on clone is strongly recommended for true tenant isolation.

---

### `SEC-07` [P1] `GET /api/exams/[attemptId]` Strips `structured_response`, `confidence`, and `hint_used` Pre-Submit (Data Loss on Exam Reload)
- **Evidence:**
  - `src/app/api/exams/[attemptId]/route.ts:219-228` (hardcoded field projection drops `structured_response`, `confidence`, `hint_used`)
  - `src/components/exam/LiveExamRunner.tsx:376-377` (expects `a.structured_response` and `a.confidence` on initial load)
  - `src/app/api/exams/[attemptId]/route.ts:69-72` & `src/app/api/exams/[attemptId]/submit/route.ts:42-45` (`buildFallbackBreakdowns` / `buildFallbackChapterBreakdown` ignore `structured_response`)
- **Root Cause:** Although `get_exam_attempt_detail()` (`0015:1466-1469`) returns full `exam_attempt_answers` rows (including `structured_response`, `confidence`, and `hint_used`), `GET /api/exams/[attemptId]` lines `219-228` manually re-map `detail.answers` to ONLY V1 fields (`id`, `attempt_id`, `attempt_question_id`, `selected_option_ids`, `typed_answer`, `is_flagged`, `client_seq`, `updated_at`). None of `structured_response`, `confidence`, or `hint_used` leak answer keys (they are the student's own submitted input). When a student reloads the exam tab (without local draft) or resumes on another device, all saved `ordering`, `matching`, `fill_in_blank`, `numerical`, and `image_hotspot` responses and confidence tags appear blank in the UI — and subsequent autosave or edits can overwrite them.
- **Reproduction Steps:**
  1. Start an exam containing an `ordering` or `fill_in_blank` question; save an answer with `confidence: "guessing"` via `PUT /api/exams/[attemptId]/answers`.
  2. Call `GET /api/exams/[attemptId]` while `status = "in_progress"` (confirmed live in Section 5).
  3. Observe `structured_response`, `confidence`, and `hint_used` are missing from every item in `data.answers`.
- **Remediation:** Include `structured_response: a.structured_response ?? null`, `confidence: a.confidence ?? null`, and `hint_used: a.hint_used ?? false` in the `in_progress` answer projection at `src/app/api/exams/[attemptId]/route.ts:219-228` (keep `is_correct` omitted!), and include `Boolean(ans.structured_response)` in `buildFallbackBreakdowns` / `buildFallbackChapterBreakdown`.

---

### `SEC-08` [P1] Stale React Query Cache After Edits, Imports, Exam Submission & Offline Sync
- **Evidence:**
  - `src/components/editor/question-editor-view.tsx:265-305` (mutations invalidate `["editor-questions", setId]` & `["study-set", setId]`, never `["study-set-bundle", setId]`; bulk mutations miss `["set-questions", setId]`, `["study-sets"]`, `["dashboard"]`).
  - `src/components/import/ImportWizard.tsx` (does not import `useQueryClient` at all — zero invalidations after `POST /api/import/commit`).
  - `src/components/exam/LiveExamRunner.tsx` (does not import `useQueryClient` at all — after `POST /api/exams/[attemptId]/submit`, `["exam-attempt-live", attemptId]` with `60s` `staleTime`, `["dashboard"]`, `["history-exams"]`, `["coverage-cycles"]`, `["review-mistakes-v3"]`, and in-progress banners remain stale).
  - `src/components/pwa/PwaProvider.tsx:546-560` (`syncNow()` never invalidates React Query keys after flushing offline answers/stars/notes).
- **Root Cause:** Decentralized query keys (`study-set`, `set-questions`, `editor-questions`, `study-set-bundle`) combined with `staleTime: 30_000`–`60_000` and missing `invalidateQueries` calls in import, exam submission, editor, and offline sync flows.
- **Reproduction Steps:**
  1. Open `/sets/[id]` -> `/sets/[id]/practice` (populates `["study-set-bundle", setId]`), then edit or import questions in `/sets/[id]/edit` or `/import` and navigate back to Practice within 30s -> old question text/count renders.
  2. Submit a live exam and return to `/dashboard` within 30s -> dashboard still shows stale in-progress exam & old stats.
- **Remediation:** Create centralized `src/lib/query-keys.ts` + helper `invalidateStudySetCaches(qc, setId)` / `invalidateLearningCaches(qc, setId)` / `invalidateExamCaches(qc, attemptId)` and invoke them cleanly on editor mutations, `ImportWizard` commit success, `LiveExamRunner` submit success, and `PwaProvider.syncNow()` when `applied > 0`.

---

### `SEC-09` [P2] `GET /api/uploads/signed-url?redirect=1` Retains 30-Minute Browser Cache & 60-Minute Signed URL After Share Revocation
- **Evidence:** `src/app/api/uploads/signed-url/route.ts:6, 40-41` (`SIGNED_URL_TTL_SECONDS = 3600`, `Cache-Control: private, max-age=1800`, `Vary: Cookie`).
- **Root Cause:** If Owner A revokes User B's share access while User B stays signed in (same session cookie), User B's browser continues following the cached `302` redirect for up to **30 minutes**, and the issued Supabase Storage signed URL stays directly accessible for **60 minutes**. Meanwhile, JSON mode (`!redirect`) emits no `Cache-Control` header at all.
- **Reproduction Steps:** Fetch `/api/uploads/signed-url?path=<path>&redirect=1` as User B (`302` with `Cache-Control: private, max-age=1800`). Revoke User B's membership. Re-request in browser within 30 minutes -> browser serves cached 302 and loads the still-valid 60-minute signed URL.
- **Remediation:** Shorten `SIGNED_URL_TTL_SECONDS` to `300` (5 min) and redirect `Cache-Control` to `private, max-age=60, must-revalidate` (or `private, no-cache` with ETag) so revoked media expires quickly without hurting single-session UX; set `Cache-Control: private, no-store` on JSON mode responses.

---

### `SEC-10` [P2] `sync_offline_learning_events` Private UUID Existence Oracle
- **Evidence:** `supabase/migrations/0016_v3_live_fixes.sql:1209-1222`.
- **Root Cause:** Because `sync_offline_learning_events()` is `SECURITY DEFINER`, lines `1209-1222` check `EXISTS (SELECT 1 FROM public.study_sets WHERE id = v_set_id)` before checking `can_read_study_set(v_set_id, v_caller)`. It returns `'rejected_deleted'` if the UUID does not exist, versus `'rejected_revoked'` if the UUID exists and belongs to another user's private set/question (confirmed live in Section 5).
- **Reproduction Steps:** As User B, call `POST /api/sync/events` with one event targeting User A's private `(study_set_id, question_id)` and one event targeting random UUIDs. Observe `rejected_revoked` vs `rejected_deleted`.
- **Remediation:** Collapse both unauthorized and nonexistent checks into a single opaque status (`rejected_inaccessible`) when `!can_read_study_set(...)` (or only return `rejected_deleted` if the caller previously had a recorded sync/progress row for that ID).

---

### `SEC-11` [P2] `create_exam_attempt_v2` Incomplete Snapshot Media Pinning
- **Evidence:** `supabase/migrations/0015_v3_rpcs_grading_search_reset_sync.sql:1065-1128`.
- **Root Cause:** `create_exam_attempt_v2()` pins `content_media_relations` for question attachments, `audio_media_id_snapshot`, `question_options.media_id`, `diagram_snapshot.base_media_id`, and `passage_snapshot.audio_media_id`, but omits media UUIDs embedded inside `type_payload_snapshot`: `image_hotspot` (`type_payload_snapshot->>'image_media_id'`), `listening` (`type_payload_snapshot->>'audio_media_id'`), and `ordering` (`items[].media_id`). Those assets can be deleted by the set owner, breaking historical exam review for those V3 question types.
- **Remediation:** Extend the `INSERT INTO public.content_media_relations` `UNION` block in `create_exam_attempt_v2()` (Migration `0019`) to also pin `type_payload_snapshot->>'image_media_id'`, `type_payload_snapshot->>'audio_media_id'`, and `jsonb_array_elements(type_payload_snapshot->'items')->>'media_id'` (validated via `is_strict_uuid` + `EXISTS` in `media_assets`).

---

### `SEC-12` [P2] Multi-Chunk Staged DOCX Import Media Data Loss & Unreaped `study-temp` Blobs
- **Evidence:** `src/app/api/import/commit/route.ts:551, 861-863`; `src/app/api/import/parse/route.ts:337-356`.
- **Root Cause:**
  1. When `/api/import/parse` stages extracted DOCX images >1.5 MB into `study-temp/{userId}/import-media/img-{sha256}.{ext}`, duplicate images across questions share one deterministic `tempStoragePath`.
  2. During multi-chunk commit (`ImportWizard` sends chunks of 500 questions), `POST /api/import/commit` unconditionally calls `cleanupTempObjects(supabase, tempMediaPathsToClean)` inside `finally` (`L861-863`) at the end of **Chunk 1**. When Chunk 2 references the same `tempStoragePath`, `consumeTempUploadBytes` gets `404`, which `commit/route.ts:558-561` silently swallows — resulting in **missing images** on later chunks.
  3. Conversely, if a user abandons Step 2 of Import Wizard without committing, staged objects in `study-temp/{userId}/import-media/` remain indefinitely (no TTL reaper).
- **Remediation:** Accept an explicit `isFinalChunk: boolean` flag (or only clean `tempStoragePath` on the final chunk / via a scheduled Supabase Storage lifecycle rule / hourly cleanup of `study-temp` objects older than 2 hours).

---

### `SEC-13` [P2] Missing Distributed Rate Limits on Expensive Full-Account Export & Bulk Mutation Routes
- **Evidence:** `src/app/api/account/data/route.ts:28, 224` (`GET` & `DELETE` have no `enforceDistributedRateLimit`); also unthrottled: `POST /api/sets/[id]/questions/bulk`, `POST /api/exams/[attemptId]/submit`, `POST /api/coverage-cycles/[id]/restart`.
- **Root Cause:** `GET /api/account/data` runs `fetchAllPages` across **19 tables** in parallel (up to 50k rows/table) with zero rate limiting, allowing a single authenticated session to saturate Supabase DB connections and Vercel memory by spamming exports.
- **Remediation:** Apply `enforceDistributedRateLimit` with a dedicated `ACCOUNT_EXPORT` bucket (e.g., 5 req / 10 min) on `GET/DELETE /api/account/data`, and reasonable burst limits on `/api/sets/[id]/questions/bulk` and `/api/exams/[attemptId]/submit`.

---

### `SEC-14` [P2] Raw RPC Error Message Forwarding in `POST /api/sessions/[sessionId]/answers`
- **Evidence:** `src/app/api/sessions/[sessionId]/answers/route.ts:56-65`.
- **Root Cause:** For PostgreSQL error codes `P0002` and `22023`, the route forwards `rpcErr.message` directly into `new AppError(..., rpcErr.message, ...)` instead of mapping to static safe client copy. While current custom `RAISE EXCEPTION` strings in `record_study_session_answer` are controlled, any future Postgres `22023` (`invalid_parameter_value`) message would leak raw DB internals.
- **Remediation:** Map `P0002` and `22023` to static allowlisted user-facing messages (matching the pattern in `src/lib/security/errors.ts`).

---

### `SEC-15` [P3] Pre-Submit `ordering` & `matching` Item Sort Order Uses Raw `id`
- **Evidence:** `supabase/migrations/0015_v3_rpcs_grading_search_reset_sync.sql:173, 194`.
- **Root Cause:** `sanitize_pre_submit_type_payload()` sorts `ordering.items` by `ORDER BY (it.val->>'id') ASC` and `matching.right_items` by `ORDER BY (r.item->>'right_id') ASC`. While StudyHub's UI editor generates `crypto.randomUUID()` IDs, the Zod schema (`src/lib/validation/v3.ts:118`) accepts arbitrary strings (e.g., API/JSON imports with `"item-1"`, `"item-2"`, `"item-3"`), whose lexicographical sort leaks the exact correct sequence pre-submit.
- **Remediation:** Pass `q.id` (or `p_attempt_id`) into `sanitize_pre_submit_type_payload` and sort by `md5(q.id::text || ':' || (it.val->>'id'))` so pre-submit order is deterministic per attempt yet cryptographically uncorrelated with sequential IDs.

---

### `SEC-16` [P3] Transitive Production `npm audit` Moderate Advisory (`exceljs` -> `uuid <11.1.1`)
- **Evidence:** `npm audit --omit=dev --json` reports `0 critical`, `0 high`, `2 moderate` (`exceljs@^4.4.0` depends on transitive `uuid <11.1.1`, GHSA-w5hq-g745-h8pq: missing buffer bounds check in `v3`/`v5`/`v6` when `buf` is provided).
- **Risk Assessment:** Low practical exploitability in StudyHub (`exceljs` only uses `uuid.v4()` internally, never `v3`/`v5`/`v6` with user-supplied `buf`).
- **Remediation:** Track upstream `exceljs` release or add a `package.json` `overrides` entry for `uuid` once verified compatible with `exceljs`'s CommonJS import.

---

## 4. Database, Concurrency & Backend API Optimization Findings (`DB-01`–`DB-14`)

### `DB-01` [P1] Concurrency Race Conditions in `sync_offline_learning_events` (Double-Apply) and `record_study_session_answer` (Lost Updates)
- **Evidence:**
  - `supabase/migrations/0016_v3_live_fixes.sql:1189-1207, 1257-1384, 1528` (`sync_offline_learning_events`)
  - `supabase/migrations/0018_v3_1_performance_rpcs_and_indexes.sql:519-522, 635-654` (`record_study_session_answer`)
- **Root Cause:**
  1. **`sync_offline_learning_events`:** Checks `SELECT status FROM learning_sync_events WHERE user_id = v_caller AND event_id = v_event_id` (`L1189-1197`) **before** mutating `user_question_progress` / `learning_confidence_events`, then inserts into `learning_sync_events ... ON CONFLICT DO NOTHING` at the **end** (`L1528`). Two concurrent retries with the same `event_id` (e.g., flaky mobile network or foreground + timer sync) **both** pass the initial `SELECT` under `READ COMMITTED`, **both** apply SM-2 increments (`correct_count`/`wrong_count` double-counted, duplicate `learning_confidence_events` row inserted), and the second silently ignores its `ON CONFLICT DO NOTHING`! Furthermore, `user_question_progress` is read without `FOR UPDATE`.
  2. **`record_study_session_answer`:** Reads `study_sessions` (`L519`) and `user_question_progress` (`L542`) **without `FOR UPDATE`**, then computes new `completed_items`/`correct_items` and SM-2 state in PL/pgSQL and writes back. Rapid double-clicks or parallel requests on the same session lose updates on both tables.
- **Reproduction Steps:** Fire two concurrent `POST /api/sync/events` requests containing identical `event_id` for an `answer` event -> observe `correct_count` increments by 2 and 2 `learning_confidence_events` rows are written while both calls return `status: "applied"`.
- **Remediation (Migration `0019`):**
  1. In `sync_offline_learning_events`, **claim the `event_id` FIRST** via `INSERT INTO public.learning_sync_events (user_id, event_id, event_type, status, ...) VALUES (..., 'processing') ON CONFLICT (user_id, event_id) DO NOTHING RETURNING event_id` — if no row returned, immediately return `duplicate` (zero double-apply!). Update `status` to `'applied'` / `'rejected_*'` at the end of the iteration, and lock `user_question_progress` with `SELECT ... FOR UPDATE`.
  2. In `record_study_session_answer`, lock `study_sessions` (`FOR UPDATE`) and `user_question_progress` (`FOR UPDATE`), or update `study_sessions` atomically (`SET completed_items = completed_items + 1, correct_items = correct_items + CASE WHEN p_is_correct THEN 1 ELSE 0 END`).

---

### `DB-02` [P1] Non-Atomic Read-Modify-Write Race Conditions Across 6 Core API Routes
- **Evidence:**
  - `src/lib/supabase/progress-helper.ts:166-302` (`POST /api/progress`: JS read -> compute SM-2 -> upsert)
  - `src/app/api/preferences/route.ts:70-96` (`PATCH /api/preferences`: JS read -> deep-merge `mode_preferences` -> upsert)
  - `src/app/api/sets/[id]/questions/route.ts:299-309, 387-397` (`POST /api/sets/[id]/questions`: non-atomic `max(position)+1`, non-atomic `content_version + 1`, 8 sequential DB RTTs without transaction)
  - `src/app/api/starred/route.ts:146-171` (`POST /api/starred`: check-then-insert/delete toggle -> `23505` on rapid double-click + redundant `requireStudySetAccess` = 4 sequential RTTs)
  - `src/app/api/notes/route.ts:86-158` (`PUT /api/notes`: concurrent first-time create triggers `23505` generic 409 without `server_note` + redundant `requireStudySetAccess`)
  - `src/app/api/diagrams/[id]/route.ts:80-82, 183-193` (`PATCH /api/diagrams/[id]`: non-atomic `content_version + 1` on both `diagram_sets` and `study_sets`)
- **Root Cause:** Multi-step PostgREST read-modify-write sequences from serverless Node handlers without row locking or atomic SQL updates.
- **Remediation:**
  1. Replace `content_version` RMW everywhere with an atomic `BEFORE UPDATE` / helper SQL `content_version = content_version + 1` (or trigger on `questions` / `diagram_sets`).
  2. Route `POST /api/progress` through an atomic PostgreSQL RPC (shared SM-2 helper with `record_study_session_answer` using `FOR UPDATE`).
  3. Make `POST /api/starred` an atomic single-RTT RPC (`toggle_starred_question(p_question_id)`).
  4. In `PATCH /api/preferences`, use PostgreSQL JSONB merge (`mode_preferences || p_patch`) or RPC.
  5. In `PUT /api/notes`, handle `23505` cleanly by fetching and returning the conflicting `server_note` with `409 NOTE_CONFLICT`, and drop the redundant `requireStudySetAccess` after RLS-protected `questions` SELECT.

---

### `DB-03` [P1] Redundant Triple-Fetch Network Waterfall on Every Study Mode (`useStudySetBundle`)
- **Evidence:**
  - `src/components/learning/useStudySetBundle.tsx:59-66`
  - `src/app/api/sets/[id]/questions/route.ts:235-272`
  - `src/app/api/starred/route.ts:44-89`
- **Root Cause:** `GET /api/sets/[id]/questions` **already joins and returns `is_starred` and `progress` on every question object** (`questions/route.ts:235-272`). Yet `useStudySetBundle.tsx:59-66` ignores those fields and fires **two additional paginated API calls** in parallel on every study mode load (`Flashcards`, `Learn`, `Practice`, `Write`, `Spell`, `Match`):
  1. `GET /api/progress?studySetId=...` (re-downloads all `user_question_progress` rows)
  2. `GET /api/starred?studySetId=...` (re-downloads starred IDs AND re-fetches full `questions` + `question_options` + `question_accepted_answers` + `question_tags` + `user_question_progress` a SECOND time!)
- **Impact:** On a 500–2,000 question aviation set with many starred questions, this doubles/triples API payload size, DB CPU, and time-to-interactive on every single study mode entry.
- **Remediation:** Derive `progressMap` and `starredIds` directly from the `questions` array returned by `GET /api/sets/[id]/questions` inside `useStudySetBundle.tsx`, eliminating both redundant API calls completely!

---

### `DB-04` [P1] `global_library_search()` Unindexed Full JSONB Scan, Internal Metadata Leak & Broken Chapter URLs
- **Evidence:** `supabase/migrations/0015_v3_rpcs_grading_search_reset_sync.sql:2490-2694` (specifically `L2561` and `L2611`).
- **Root Cause:**
  1. **Line `2561`:** `OR COALESCE(q.source_metadata::text, '') ILIKE v_like` casts the entire `source_metadata` JSONB column to `text` and runs an unindexed `ILIKE` across every readable question — completely defeating `idx_questions_prompt_trgm` (`GIN`) and forcing a sequential/heap scan of the entire `questions` table!
  2. **Metadata leak:** Because `source_metadata` stores internal import fields (`import_idempotency_key`, `import_job_id`, `import_format`, `source_file`), students searching common substrings like `"import"` or `"docx"` match internal metadata and get false hits.
  3. **Materialized 8-way `UNION ALL`:** Computes exact `counts_agg` across all 8 entity types without per-branch caps before applying `LIMIT p_limit`.
  4. **Line `2611`:** Chapter deep-link builds `'/sets/' || q.study_set_id::text || '/practice?chapter=' || replace(q.chapter, ' ', '%20')`, failing to percent-encode `&`, `#`, `?`, `+`, and `%` in chapter titles.
- **Remediation (Migration `0019`):**
  1. Remove `COALESCE(q.source_metadata::text, '') ILIKE v_like` (search only student-facing fields: `prompt`, `explanation`, `back_text`, `chapter`, `audio_transcript`), and add trigram GIN index on `question_options(content)` & `user_question_notes(plain_text)` if search volume warrants.
  2. Cap each branch of the `UNION ALL` (e.g., `LIMIT 200` per type) so large banks never materialize tens of thousands of rows just for count badges.
  3. Properly URL-encode chapter names (or return raw `chapter` field and encode via `encodeURIComponent()` on the client).

---

### `DB-05` [P1] `idx_questions_source_metadata_idem` Completely Unusable Due to Operator & Partial-Predicate Mismatch
- **Evidence:**
  - `supabase/migrations/0005_v2_custom_exams_and_coverage.sql:1002-1003`:
    `CREATE INDEX idx_questions_source_metadata_idem ON public.questions (study_set_id, (source_metadata->>'import_idempotency_key')) WHERE source_metadata ? 'import_idempotency_key';`
  - `src/app/api/import/commit/route.ts:276-281`:
    `.eq("study_set_id", body.studySetId).contains("source_metadata", { import_idempotency_key: body.idempotencyKey })`
- **Root Cause:** Double mismatch prevents PostgreSQL from **ever** using `idx_questions_source_metadata_idem`:
  1. `.contains(...)` emits `source_metadata @> '{"import_idempotency_key":"..."}'::jsonb`, which cannot use a B-tree text expression index `(source_metadata->>'import_idempotency_key')`.
  2. Even if switched to `.eq("source_metadata->>import_idempotency_key", key)`, PostgreSQL's planner cannot prove the partial index predicate `WHERE source_metadata ? 'import_idempotency_key'` from `source_metadata->>'import_idempotency_key' = $1` (it CAN prove `WHERE (source_metadata->>'import_idempotency_key') IS NOT NULL` because `=` is strict!).
- **Impact:** Every chunk of a multi-chunk import (e.g., 10 chunks of 500 questions) scans all existing questions in `study_set_id` row-by-row (`O(N^2)` work across chunks).
- **Remediation:** Replace `idx_questions_source_metadata_idem` in Migration `0019` with `WHERE (source_metadata->>'import_idempotency_key') IS NOT NULL` AND change `import/commit/route.ts:280` to `.eq("source_metadata->>import_idempotency_key", body.idempotencyKey)` (or move chunk idempotency to a dedicated indexed `import_jobs` / `questions.import_idempotency_key` column).

---

### `DB-06` [P1] `GET /api/sets` Sequential Waterfall & Silent 100-Set Truncation for Shared Sets
- **Evidence:** `src/app/api/sets/route.ts:57, 121-136`.
- **Root Cause:**
  1. On default `scope=all` (and `scope=shared`), the route first executes `SELECT study_set_id FROM study_set_members WHERE user_id = $1`, then truncates with `.slice(0, SAFE_IN_CHUNK_SIZE)` (**100 sets max!**) before querying `study_sets`. Any user with >100 shared sets silently loses access to sets #101+ in the library UI and search!
  2. Even for users with 0 shared sets, every `/library` load pays an extra sequential DB round-trip (`study_set_members` -> `study_sets`).
- **Remediation:** Replace the 2-step Node query with a single RLS-aware query (or lightweight SQL RPC `list_accessible_study_sets(...)` using `EXISTS (SELECT 1 FROM study_set_members ...)` — zero `.in()` limit, zero silent truncation, and 1 fewer sequential DB RTT).

---

### `DB-07` [P1] Heavy Full-Table Node Scans & PostgREST Truncation Risk in `GET /api/statistics` and `GET /api/mistakes`
- **Evidence:**
  - `src/app/api/statistics/route.ts:72-360` (downloads up to 50k rows/table across 6 tables + chunked `questions` into serverless memory to compute simple SQL `COUNT`/`AVG`/`GROUP BY` aggregates).
  - `src/app/api/mistakes/route.ts:38-413` (downloads all `user_question_progress` rows into Node, runs up to 5 sequential filter steps, AND at `L362-370` runs `exam_attempt_questions.select("id, attempt_id, question_id").in("question_id", chunk)` **without inner pagination** — silently truncating at PostgREST's 1,000-row cap when 100 paged mistake questions appear across >10 historical exam attempts!).
- **Remediation:**
  1. Create a `get_user_statistics_summary(p_days integer)` PostgreSQL RPC (Migration `0019`) that aggregates mastery breakdown, 30-day daily activity, exam trend, weak chapters, and confidence calibration in SQL (reducing 6+ paginated downloads + Node loops to **1 single RPC RTT**).
  2. Create a `get_user_mistakes_page(...)` PostgreSQL RPC (or add inner pagination + lateral `ORDER BY answered_at DESC LIMIT 1` join) so filtering, sorting, counting, and latest-wrong-answer lookup execute in SQL with zero PostgREST 1,000-row truncation.

---

### `DB-08` [P2] 12 Completely Redundant / Duplicate B-Tree Indexes Increasing Write Amplification & WAL
- **Evidence:** Static analysis of all 133 indexes + table `UNIQUE`/`PRIMARY KEY` constraints across `supabase/migrations/0001..0018`:

| # | Redundant Index | Columns | Covered By (Existing Wider/Identical Index) | Migration:Line |
| --- | --- | --- | --- | --- |
| 1 | `idx_exam_attempt_questions_attempt_id` | `(attempt_id, position)` | `exam_attempt_questions_unique_pos` `UNIQUE (attempt_id, position)` (**exact clone!**) | `0001:422` |
| 2 | `idx_exam_attempt_answers_attempt_id` | `(attempt_id)` | `exam_attempt_answers_unique` `UNIQUE (attempt_id, attempt_question_id)` | `0001:424` |
| 3 | `idx_study_set_members_study_set_id` | `(study_set_id)` | `study_set_members_unique` `UNIQUE (study_set_id, user_id)` | `0001:383` |
| 4 | `idx_tags_owner_id` | `(owner_id)` | `tags_owner_slug_unique` `UNIQUE (owner_id, slug)` | `0001:398` |
| 5 | `idx_content_media_rel_media` | `(media_id)` | `uq_content_media_rel_unique` `UNIQUE (media_id, entity_type, entity_id, role)` | `0013:121` |
| 6 | `idx_question_options_study_set_id` | `(study_set_id)` | `idx_question_options_set_question (study_set_id, question_id)` | `0001:393` |
| 7 | `idx_question_accepted_answers_study_set_id` | `(study_set_id)` | `idx_question_accepted_answers_set_question (study_set_id, question_id)` | `0001:395` |
| 8 | `idx_question_tags_study_set_id` | `(study_set_id)` | `idx_question_tags_set_question (study_set_id, question_id)` | `0001:400` |
| 9 | `idx_user_question_progress_study_set_id` | `(study_set_id)` | `idx_user_question_progress_set_question (study_set_id, question_id)` | `0001:406` |
| 10 | `idx_starred_questions_study_set_id` | `(study_set_id)` | `idx_starred_questions_set_question (study_set_id, question_id)` | `0001:408` |
| 11 | `idx_study_session_answers_study_set_id` | `(study_set_id)` | `idx_study_session_answers_set_question (study_set_id, question_id)` | `0001:417` |
| 12 | `idx_study_session_answers_session_id` | `(session_id)` | `idx_study_session_answers_session_correct (session_id, user_id, is_correct)` | `0001:414` |

- **Impact:** Every bulk import (`question_options`, `question_accepted_answers`, `question_tags`), exam creation (`exam_attempt_questions`), exam autosave (`exam_attempt_answers`), and study answer (`user_question_progress`, `study_session_answers`) writes redundant B-tree entries and WAL pages with zero query benefit. Dropping all 12 preserves `unindexed_foreign_keys = 0` because each covering index shares the exact same leading FK column(s).
- **Remediation:** Drop these 12 redundant indexes in Migration `0019` (`DROP INDEX IF EXISTS ...`).

---

### `DB-09` [P2] `get_dashboard_summary()` & `get_study_set_summary()` Non-Sargable Predicate, Missing Index & Mistake Count Drift
- **Evidence:** `supabase/migrations/0018_v3_1_performance_rpcs_and_indexes.sql:105, 177, 209-214, 403`; `src/app/api/sets/[id]/route.ts:102`.
- **Root Cause:**
  1. **Non-Sargable 14-day exam filter (`0018:177`):** `WHERE ea.user_id = v_caller AND ea.status IN ('submitted', 'expired') AND COALESCE(ea.submitted_at, ea.created_at) >= v_14d_cutoff`. Wrapping `ea.submitted_at` in `COALESCE(...)` prevents PostgreSQL from using the `submitted_at DESC` range key on `idx_exam_attempts_user_submitted` (`0018:22`).
  2. **Missing partial index for `continue_learning` (`0018:209-214`):** `WHERE owner_id = v_caller AND is_archived = false AND last_studied_at IS NOT NULL ORDER BY last_studied_at DESC LIMIT 6` has no index on `last_studied_at`, forcing a sort over all owned study sets.
  3. **Mistake count drift (`0018:105`, `0018:403`, `sets/[id]/route.ts:102`):** Counts `wrong_count > 0 AND mastery_level <> 'mastered'` without filtering `COALESCE(mistake_status, 'active') <> 'resolved'`, so resolved mistakes remain counted on the Dashboard & Study Set Hub while disappearing from `/review/mistakes` (`/api/mistakes`).
- **Remediation (Migration `0019`):**
  1. Rewrite `0018:177` as `(ea.submitted_at >= v_14d_cutoff OR (ea.submitted_at IS NULL AND ea.created_at >= v_14d_cutoff))` (or guarantee `submitted_at` is always populated for `submitted`/`expired` and filter `ea.submitted_at >= v_14d_cutoff`).
  2. Add `CREATE INDEX IF NOT EXISTS idx_study_sets_owner_last_studied ON public.study_sets (owner_id, last_studied_at DESC) WHERE is_archived = false AND last_studied_at IS NOT NULL;`.
  3. Align mistake counters with `wrong_count > 0 AND mastery_level <> 'mastered' AND COALESCE(mistake_status, 'active') <> 'resolved'`.

---

### `DB-10` [P2] Sequential Storage & DB Waterfalls in Hot Exam, Export, Import & Diagram Routes
- **Evidence:**
  - `src/app/api/exams/route.ts:287-309`: When `shuffle_options=true` (default), executes extra chunked `question_options` queries (3 queries for a 250Q exam) purely to fetch UUIDs and shuffle them in Node, before calling `create_exam_attempt_v2` which re-reads `question_options`.
  - `src/app/api/exams/[attemptId]/submit/route.ts:70-86`: Executes redundant `SELECT id FROM exam_attempts` before `rpcSubmitExamAttempt` (which already enforces `WHERE id = p_attempt_id AND user_id = v_caller FOR UPDATE`).
  - `src/app/api/export/pdf/route.ts:219-232, 367-425`: Strictly sequential per-image Storage downloads (`await fetchEmbeddedImage(...)` inside `for` loops) + sequential `options`/`accepted_answers` chunk fetches + redundant `study_sets` SELECT after `requireStudySetAccess`.
  - `src/app/api/import/parse/route.ts:339-355`: Strictly sequential `await stageTempImportMedia(...)` inside a `for` loop (50 images = 50 serial Storage uploads!).
  - `src/app/api/import/commit/route.ts:660-715`: Strictly sequential per-image permanent Storage uploads.
  - `src/app/api/diagrams/[id]/route.ts:128-161`: Strictly sequential per-hotspot `UPDATE` / `INSERT` N+1 loop.
- **Remediation:**
  1. Add `p_shuffle_options boolean` to `create_exam_attempt_v2()` and shuffle options directly in SQL (`ORDER BY gen_random_uuid()`) when `opt_order` is empty — removing the extra `question_options` fetch waterfall on every exam start!
  2. Drop the redundant ownership pre-check in `POST /api/exams/[attemptId]/submit` (handle `NULL` RPC return as `404`).
  3. Bound-parallelize Storage downloads/uploads with concurrency `6`–`8` in `/api/export/pdf`, `/api/import/parse`, and `/api/import/commit`.
  4. Batch hotspot upserts in `PATCH /api/diagrams/[id]`.

---

### `DB-11` [P2] `GET /api/sets/[id]/questions?fields=summary` Still Selects Heavy TipTap Rich-Text JSONB Blobs
- **Evidence:** `src/app/api/sets/[id]/questions/route.ts:30-31` (`QUESTION_SUMMARY_COLUMNS` includes `prompt_rich`, `back_rich`, `explanation`, `explanation_rich`, `hint`).
- **Root Cause:** List/preview views that request `?fields=summary` (e.g., Study Set Hub preview list) still transfer full TipTap ProseMirror AST JSONB documents and multi-paragraph explanations across the wire.
- **Remediation:** Restrict `QUESTION_SUMMARY_COLUMNS` to lightweight plain-text list metadata (`id, study_set_id, question_type, position, chapter, prompt, prompt_image_url, back_text, audio_media_id, passage_id, diagram_id, difficulty, created_at, updated_at`) and omit `content_rich` on summary options.

---

### `DB-12` [P2] `save_exam_attempt_answers` Full Per-Attempt Join Scan on Every Autosave
- **Evidence:** `supabase/migrations/0015_v3_rpcs_grading_search_reset_sync.sql:1350-1354`.
- **Root Cause:** On every debounced autosave (even a 1-answer change), `save_exam_attempt_answers` joins ALL `exam_attempt_answers` with ALL `exam_attempt_questions` for `p_attempt_id` to recompute `answered_count`. For a 250-question exam with frequent autosaves, this does ~250 row joins per save.
- **Remediation:** Store a lightweight boolean `is_answered` column on `exam_attempt_answers` (computed once per upserted row via `public.has_exam_answer(...)`) so `answered_count` reduces to a single index-only `COUNT(*) FILTER (WHERE is_answered)` on `exam_attempt_answers` without joining `exam_attempt_questions`.

---

### `DB-13` [P2] Upload Endpoints Index `(owner_id, sha256_hash)` But Never Deduplicate Storage Blobs
- **Evidence:** `supabase/migrations/0013_v3_media_richtext_questions_schema.sql:72` (`idx_media_assets_owner_sha256`); `src/app/api/uploads/image/route.ts` & `src/app/api/uploads/audio/route.ts`.
- **Root Cause:** Both routes hash uploaded bytes with SHA-256 and store `sha256_hash`, and `0013` maintains a dedicated partial index `(owner_id, sha256_hash)`, yet neither endpoint checks for an existing `(owner_id, study_set_id, sha256_hash)` row before uploading a duplicate object to Storage.
- **Remediation:** Query `media_assets` by `(owner_id, sha256_hash, study_set_id)` before uploading; when a matching active asset exists for the same set (and isn't orphaned), reuse it instead of uploading a duplicate blob.

---

### `DB-14` [P3] Unvalidated `NOT VALID` V3 CHECK Constraints & Orphaned Storage Blobs on Study Set Deletion
- **Evidence:** `supabase/migrations/0013_v3_media_richtext_questions_schema.sql:351, 364, 405`; `src/app/api/sets/[id]/route.ts:197-203`.
- **Root Cause:**
  1. Three V3 CHECK constraints on `questions` and `question_options` were added `NOT VALID` in `0013` and never validated with `ALTER TABLE ... VALIDATE CONSTRAINT ...`, preventing the PostgreSQL planner from leveraging them for constraint exclusion.
  2. `DELETE /api/sets/[id]` cascades DB rows (`media_assets.study_set_id` becomes `NULL`) without marking unreferenced `media_assets` as `is_orphaned = true` or removing unpinned Storage objects.
- **Remediation:** Run `VALIDATE CONSTRAINT` in Migration `0019`, and add a safe orphan-marking/reaping routine for unreferenced `media_assets` (strictly skipping any asset referenced by `content_media_relations`!).

---

## 5. Live Production Verification & Security Baseline Matrix

> **Executed:** Immediately after `perf-auditor` posted `[live-sweep-done]` (`#7`), targeting `https://studyhub-three-mauve.vercel.app` and Supabase Cloud (`cuoaifyupfmkstqhcjwy`) using 2 strictly tracked disposable accounts (`v32-sec-a-*`, `v32-sec-b-*`). **Zero** real user accounts, sets, or media were touched, and **100% cleanup** was verified post-run (`usersDeleted: 2`, `mediaDeleted: 1`, `tempDeleted: 0`, `remainingUsers: 0`, `remainingSets: 0`).

### 5.1 Live HTTP Security & Cache Header Verification
| Endpoint | Status | Live `Cache-Control` | Live `Vary` | `x-vercel-cache` | Assessment |
| --- | :---: | --- | --- | :---: | --- |
| `GET /` & `GET /login` | `200` | `public, max-age=0, must-revalidate` | `rsc, next-router-*` | `HIT` | PASS (public static shells; full CSP/HSTS/XFO/nosniff) |
| `GET /sw.js` | `200` | `no-cache, no-store, must-revalidate` | — | `HIT` | **PASS** (never cached stale) |
| `GET /dashboard` (unauth) | `307` | `public, max-age=0, must-revalidate` | — | — | PASS (redirects unauth to `/login`) |
| `GET /dashboard` (authA) | `200` | `public, max-age=0, must-revalidate` | `rsc, next-router-*` | `HIT` | Note: static shell (zero user HTML), will become dynamic once `SEC-01` passes `initialUserId` from server layout |
| `GET /api/profile` (authA) | `200` | **`public, max-age=0, must-revalidate`** | *(none)* | `MISS` | **FAIL (`SEC-04`)** — must be `private, no-store` + `Vary: Cookie` |
| `GET /api/dashboard` (authA) | `200` | **`public, max-age=0, must-revalidate`** | *(none)* | `MISS` | **FAIL (`SEC-04`)** — must be `private, no-store` + `Vary: Cookie` |
| `GET /api/sets` (authA) | `200` | **`public, max-age=0, must-revalidate`** | *(none)* | `MISS` | **FAIL (`SEC-04`)** — must be `private, no-store` + `Vary: Cookie` |
| `GET /api/exams/[id]` (in-progress & post-submit) | `200` | **`public, max-age=0, must-revalidate`** | *(none)* | `MISS` | **FAIL (`SEC-04`)** — post-submit includes `correct_option_ids` & explanations! |
| `GET /api/uploads/signed-url` (JSON mode) | `200` | **`public, max-age=0, must-revalidate`** | *(none)* | `MISS` | **FAIL (`SEC-04`)** — returns 60-min signed URL without `private, no-store` |
| `GET /api/uploads/signed-url?redirect=1` | `302` | `private, max-age=1800` | `Cookie` | `MISS` | **WARN (`SEC-09`)** — 30-min browser cache / 60-min URL TTL post-revocation |

All tested routes emitted hardened security headers: `Strict-Transport-Security: max-age=63072000; includeSubDomains`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(self), geolocation=()`, and strict `Content-Security-Policy`.

### 5.2 Live 2-Account Isolation, Anti-Leak & Defect Reproduction Matrix
| Live Test Case | Observed Live Result | Status |
| --- | --- | :---: |
| Account B -> `GET / PATCH / DELETE /api/sets/[setA]` & `/questions` | `404 NOT_FOUND` on all 4 endpoints | **PASS** |
| Account B -> `GET /api/notes?studySetId=[setA]` | `200 []` (0 rows leaked) | **PASS** |
| Account B -> `GET /api/exams/[attemptA]` & `POST /submit` | `404 NOT_FOUND` | **PASS** |
| Account B -> `PUT /api/exams/[attemptA]/answers` (valid payload) | `403 FORBIDDEN` | **PASS** |
| Account B -> `GET /api/uploads/signed-url` (Account A's private image) | `404 NOT_FOUND` | **PASS** |
| Account B -> `POST /api/import/parse` (Account A's `study-temp` path) | `403 FORBIDDEN` | **PASS** |
| Account B -> `POST /api/export/pdf` (Account A's exam attempt) | `404 NOT_FOUND` | **PASS** |
| Account A -> `POST /api/export/pdf` (`mode: "paper_and_key"` while `in_progress`) | `403 FORBIDDEN` | **PASS** |
| Pre-submit answer-key leak check (`POST /api/exams` & `GET /api/exams/[id]`) | `is_correct`: false, `correct_option_ids`: false, `accepted_answers_snapshot`: false, `explanation`: false, `correct_position`: false | **PASS** |
| **Live Repro `SEC-07`:** `PUT /answers` (`ordering` + `confidence: "guessing"`, `hint_used: true`) -> reload `GET /api/exams/[id]` | `PUT` returned `200 answered_count: 1`, but `GET` returned `has_structured_response: false, has_confidence: false, has_hint_used: false`! Post-submit scored `score_percent: 50, correct_count: 1` (confirming data was persisted & confidence remained 100% score-neutral, ONLY stripped by `GET` mapper!) | **CONFIRMED (`SEC-07`)** |
| **Live Repro `SEC-10`:** Account B `POST /api/sync/events` probing private `setA` vs nonexistent UUID | Returned `200 ["rejected_revoked", "rejected_deleted"]` | **CONFIRMED (`SEC-10`)** |

### 5.3 Live Direct PostgREST RLS, Column-`REVOKE` & RPC Privilege Matrix
| Direct Supabase Cloud Check | Observed Live Result | Status |
| --- | --- | :---: |
| Auth A direct `SELECT` on 5 revoked `exam_attempt_questions` columns (`correct_option_ids`, `accepted_answers_snapshot`, `explanation_snapshot`, `explanation_rich_snapshot`, `type_payload_snapshot`) | `42501: permission denied for table exam_attempt_questions` on all 5 | **PASS** |
| Auth B direct `SELECT profiles.email` | `42501: permission denied for table profiles` | **PASS** |
| Auth A & `anon` direct `SELECT api_rate_limits` | `42501: permission denied for table api_rate_limits` | **PASS** |
| Auth B direct private reads (`study_sets`, `user_question_notes`, `exam_attempts`) | `0` rows across all 3 tables | **PASS** |
| Auth B `rpc("can_read_study_set", { p_set_id: setA, p_user_id: userA })` | `false` (`current_jwt_role()` anti-oracle guard enforced) | **PASS** |
| `anon` RPC calls (`is_study_set_owner`, `get_dashboard_summary`, `submit_exam_attempt`, `sync_offline_learning_events`) | `42501` on all 4 | **PASS** |
| Migration `0018` RPCs (`get_dashboard_summary`, `get_study_set_summary`) | Both present and returning `ok` for Auth A | **PASS** |
| `anon` 37-table PostgREST RLS sweep + private `setA` `questions`/`question_options` | `0` private rows across all 37 tables (`questions`/`question_options` return only rows belonging to `visibility = 'public'` sets; Account A's private set returned `0` rows) | **PASS (37/37)** |

### 5.4 Static Security Baseline Attestation (Verified)
| Security Control | Status | Evidence |
| --- | :---: | --- |
| **RLS Enabled on All 37 Public Tables** | **PASS (37/37)** | Static SQL audit (`0001`–`0018`): `Total tables: 37, Missing RLS: 0` |
| **`(SELECT auth.uid())` Wrapping & Explicit Roles** | **PASS (131/131)** | Zero bare `auth.uid()`, zero `auth.role()`, zero `USING (true)`, zero `UPDATE` missing `WITH CHECK` |
| **`SECURITY DEFINER` `SET search_path = ''` & `REVOKE`** | **PASS (44/44)** | All 44 `SECURITY DEFINER` functions set `search_path = ''`; only 2 intentional public RPCs (`can_read_study_set`, `preview_share_link`) executable by `anon`; all RLS helpers include `current_jwt_role()` anti-oracle guard |
| **Zero `getSession()` on Server** | **PASS (0)** | Full `src/` scan confirms `supabase.auth.getUser()` exclusively |
| **Zero Secret Key Exposure in Client Bundles** | **PASS (0)** | `SUPABASE_SECRET_KEY`/`SUPABASE_SERVICE_ROLE_KEY` restricted strictly to `src/lib/supabase/admin.ts` (`import "server-only"`), `src/lib/supabase/env.ts`, `src/lib/security/rate-limit.ts` |
| **Zero AI / Zero Payment SDKs** | **PASS (0)** | `package.json` & `src/` scan confirm 0 AI/LLM/payment packages or `<Sparkles />` usage |
| **RichText & KaTeX Anti-XSS** | **PASS** | `nullableRichTextDocSchema` enforces `sanitizeRichTextDoc()` via Zod transform on all rich-text inputs; `dangerouslySetInnerHTML` restricted solely to `renderSafeKatexHtml()` (`trust: false` + `<script|javascript:` guard) |
| **Upload, ZIP/OOXML & PDF Hardening** | **PASS** | Magic bytes, 15 MB/5 MB/10 MB caps, Central Directory + streaming decompression 50 MB / 100:1 / 500-entry (2,000 w/ media) guards, `processEntities: false` + XXE check, `pdfjs-dist` (`isEvalSupported: false`, `disableAutoFetch: true`, `useSystemFonts: false`), SVG/macro rejection |
| **Hard Exam Guard (`Ctrl+K` Disabled)** | **PASS** | `isActiveExamRoute()` blocks `/sets/[id]/test` & `/exams/[attemptId]` (excluding `/exams/new`) across `ShortcutProvider` & `AppShell` |
| **Exam Anti-Leak Column `REVOKE` & Immutability** | **PASS** | `correct_option_ids`, `accepted_answers_snapshot`, `explanation_snapshot`, `explanation_rich_snapshot`, `type_payload_snapshot` column-revoked; `prevent_exam_snapshot_update()` freezes all snapshot columns |
| **Service Worker (`public/sw.js`) Privacy Hygiene** | **PASS** | Served with `Cache-Control: no-cache, no-store, must-revalidate`; never caches `/api/*`, `/auth/*`, `/share/*`, or authenticated HTML; `skipWaiting()` gated on `APPLY_UPDATE` |

---

## 6. Prioritized V3.2 Remediation Roadmap

### Track A — Cache Architecture & Privacy Isolation (P0/P1 — Zero DB Migration Needed)
1. **Server-verified `initialUserId` prop** from `src/app/(app)/layout.tsx` -> `AuthenticatedProviders` -> `PwaProvider` (`SEC-01`).
2. **Centralized `purgeAllUserClientState()`** + `BroadcastChannel("studyhub-auth")` multi-tab sync + user-partitioned exam drafts (`SEC-02`, `SEC-03`).
3. **Default `Cache-Control: private, no-store` + `Vary: Cookie`** in `apiSuccess()`/`apiError()`, plus shortened signed-URL TTL (`300s`) and redirect cache (`60s`) (`SEC-04`, `SEC-09`).
4. **Centralized React Query key registry & mutation invalidation helpers** across editor, import, exam submit, and offline sync (`SEC-08`), plus removing duplicate `/api/progress` + `/api/starred` calls from `useStudySetBundle` (`DB-03`).
5. **Restore `structured_response`, `confidence`, `hint_used`** in `GET /api/exams/[attemptId]` pre-submit response (`SEC-07`).

### Track B — PostgreSQL Migration `0019_v3_2_stability_security_and_perf.sql`
1. **Concurrency fixes:** Pre-claim `learning_sync_events` (`ON CONFLICT DO NOTHING RETURNING`) + `FOR UPDATE` in `sync_offline_learning_events`; `FOR UPDATE` / atomic increment in `record_study_session_answer`; atomic `toggle_starred_question` and `record_progress_answer` RPCs (`DB-01`, `DB-02`).
2. **Security & integrity fixes:** Preserve cross-tenant exam-pinned media in `cleanup_profile_media_relations()` (`SEC-05`); collapse `rejected_revoked`/`rejected_deleted` oracle in `sync_offline_learning_events` (`SEC-10`); pin `type_payload_snapshot` & `ordering` media in `create_exam_attempt_v2` (`SEC-11`); hash-order `ordering`/`matching` items in `sanitize_pre_submit_type_payload` (`SEC-15`).
3. **Query & index optimization:** Drop 12 redundant B-tree indexes (`DB-08`); fix `idx_questions_source_metadata_idem` partial predicate (`DB-05`); add `idx_study_sets_owner_last_studied` + fix non-Sargable `COALESCE(submitted_at, created_at)` and mistake count drift in `get_dashboard_summary`/`get_study_set_summary` (`DB-09`); remove `source_metadata::text ILIKE` & add per-branch caps in `global_library_search()` (`DB-04`); add SQL `p_shuffle_options` to `create_exam_attempt_v2` (`DB-10`); add `get_user_statistics_summary()` & `get_user_mistakes_page()` RPCs (`DB-07`); add `is_answered` flag on `exam_attempt_answers` (`DB-12`); `VALIDATE CONSTRAINT` on `0013` CHECK constraints (`DB-14`).

### Track C — API Route Hardening & Concurrency Cleanup
1. Safe Storage deletion in `DELETE /api/account/data` (`SEC-05`) and Storage blob cloning in `POST /api/sets/[id]/duplicate` (`SEC-06`).
2. Multi-chunk staged import media lifecycle (`SEC-12`), bounded-concurrency Storage I/O in `import/parse`, `import/commit`, and `export/pdf` (`DB-10`), `source_metadata->>import_idempotency_key` query fix (`DB-05`), and SHA-256 deduplication in upload routes (`DB-13`).
3. Rate limiting on `/api/account/data`, `/api/sets/[id]/questions/bulk`, `/api/exams/[attemptId]/submit` (`SEC-13`), static error mapping in `/api/sessions/[sessionId]/answers` (`SEC-14`), leaner `QUESTION_SUMMARY_COLUMNS` (`DB-11`), and removing the 100-set truncation in `GET /api/sets` (`DB-06`).
