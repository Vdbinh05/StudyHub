# StudyHub V2.0 — Independent Security Audit Report

> **Auditor:** Agent 7 (`security-auditor`) — 100% Independent from StudyHub V1.0 Builders  
> **Scope:** Full-stack adversarial code, PostgreSQL RLS/RPC, Storage, Auth, Upload/Parser, Client Bundle, Git History, and Dependency Audit (`d:\Code Web\StudyHub`, baseline commit `f09a8ed`)  
> **Audit Policy:** Wave 1 read-only audit — ZERO production files modified. Every finding is backed by direct file/line inspection or fresh command execution (`verification-before-completion`).

---

## 1. Executive Summary

StudyHub V1.0 establishes a strong security foundation in several core areas:
- **Zero-AI & Zero-Payment Mandates:** Verified **100% compliant** (`0` AI SDKs/endpoints, `0` payment SDKs/paywalls, `0` mock users/fake auth).
- **Secrets & Client Bundle Isolation:** Verified **CLEAN** — zero secrets committed in Git (`f09a8ed`), `.env.local` and `/sample-data/` properly gitignored, `SUPABASE_SERVICE_ROLE_KEY` isolated to `src/lib/supabase/env.ts` and `src/lib/supabase/admin.ts` (`import "server-only"` + `typeof window !== "undefined"` guard), and **zero matches** for `service_role` or admin helpers in `.next/static/`.
- **Anti-XSS Baseline:** Verified **0 occurrences** of `dangerouslySetInnerHTML`, `innerHTML`, `eval()`, or `new Function()` across all `src/**/*.ts(x)`.
- **Exam Pre-Submit Anti-Leak (HTTP API & Column Revocation):** Verified **PASS** at the API & column-grant layer — `POST /api/exams`, `GET /api/exams/[attemptId]`, `get_exam_attempt_detail()`, and column-level `REVOKE ALL` / `GRANT SELECT (...)` on `exam_attempt_questions` strictly omit `correct_option_ids`, `accepted_answers_snapshot`, `explanation_snapshot`, and option `is_correct` while `status = 'in_progress'`.

However, independent adversarial inspection uncovered **real, high-impact authorization, RLS, database-integrity, upload, and dependency vulnerabilities** that V1.0's structural regex tests (`tests/unit/security/supabase-migrations-audit.test.ts`) could not detect because structural tests checked policy *presence* rather than policy *semantics*:

| Severity | Count | Summary of Findings |
| --- | ---: | --- |
| **P0 — Critical** | **2** | `SEC-001` Editor-to-Owner study set hijack via `study_sets_update_editable` RLS; `SEC-002` Forced friendship + private email/avatar takeover via `friendships_update_participant` RLS |
| **P1 — High** | **6** | `SEC-003` Cross-tenant question/option/tag injection via denormalized `study_set_id` mismatch (SQL + `PATCH /api/sets/[id]/questions/bulk`); `SEC-004` Direct-RPC exam attempt forgery (`create_exam_attempt`); `SEC-005` Private email exposure to pending requesters & set viewers; `SEC-006` Friendship block bypass (`PATCH`/`DELETE /api/friends/[id]`); `SEC-007` Global enumeration of `'unlisted'` study sets via PostgREST; `SEC-008` `zod@3.25.76` High-severity memory exhaustion DoS (`GHSA-mrhx-c7xc-m3w5`) |
| **P2 — Medium** | **8** | `SEC-009` Authorization oracle via public `SECURITY DEFINER` helpers; `SEC-010` ZIP/XLSX decompression-bomb OOM & uninspected `ExcelJS` XML load; `SEC-011` Client-direct image uploads bypassing dead `upload.ts` magic-byte checks + broken private-bucket `getPublicUrl()`; `SEC-012` Unenforced `allow_clone = false` share restriction; `SEC-013` Mutable `profiles.email` lookup spoofing & unvalidated `avatar_url` at DB/signup layer; `SEC-014` Missing rate limits on `POST /api/sets/[id]/members` (enumeration bypass) and `GET /api/sets/[id]/export` (DoS); `SEC-015` Weak `login-form.tsx` `next` redirect check (`/\`) & proxy redirect cookie drop; `SEC-016` Exam answer `attempt_question_id` scoping & `submit_exam_attempt` edge cases |
| **P3 — Low** | **6** | `SEC-017` `uuid@8.3.2` moderate advisory via `exceljs@4.4.0` (`GHSA-w5hq-g745-h8pq`); `SEC-018` PostgREST `.or()` filter syntax fragility; `SEC-019` CSV formula injection (CWE-1236); `SEC-020` Incomplete account deletion cleanup & `secure_password_change = false`; `SEC-021` Per-instance in-memory rate limit & missing pre-parse JSON byte caps; `SEC-022` Production CSP includes `localhost`/`127.0.0.1` + missing HSTS |
| **P4 — Info / Hygiene** | **1** | `SEC-023` Defense-in-depth cleanups (`import_jobs` filter, `study_sessions` cross-set check, RLS folder ownership `WITH CHECK`, `/exams` middleware prefix for V2.0) |

> **Verdict:** **DO NOT SHIP TO LIVE MULTI-USER PRODUCTION** until all **P0 (`SEC-001`–`SEC-002`)** and **P1 (`SEC-003`–`SEC-008`)** vulnerabilities are remediated and verified with live 2-account negative RLS/API tests.

---

## 2. Dependency Vulnerability Audit (`npm audit`)

Fresh commands executed on `2026-11-24`:
- `npm audit --omit=dev` -> **Exit code `1`**: **3 vulnerabilities (2 moderate, 1 high)**
- `npm audit` (full, including devDependencies) -> **Exit code `1`**: **3 vulnerabilities (2 moderate, 1 high)** (identical to production dependencies; 0 dev-only advisories)

| Package | Installed Version | Direct / Transitive | Advisory ID | CWE | CVSS 3.1 | npm Severity | Details & Real Impact |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `zod` | `3.25.76` | Direct (runtime) | [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) | CWE-770 | `7.5` (`AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H`) | **High** | Memory exhaustion when validating oversized constrained collections (`<4.6.6`, patched in `4.6.7`). Directly exposed via all JSON API routes using Zod schemas (`SEC-008`). |
| `uuid` | `8.3.2` | Transitive via `exceljs@4.4.0` (runtime) | [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq) | CWE-787, CWE-1285 | `7.5` (`AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:H/A:N`) | **Moderate** | Missing buffer bounds check in `v3`/`v5`/`v6` when `buf` is provided (`<11.1.1`). `exceljs` uses `uuid.v4()` internally without caller-supplied `buf`, so runtime exploitability is low, but `exceljs` is unmaintained on `uuid@8` (`SEC-017`). |
| `exceljs` | `4.4.0` | Direct (runtime) | Transitive via `uuid` | — | — | **Moderate** | `npm audit fix --force` proposes downgrading to `exceljs@3.4.0` (**DO NOT RUN `--force`** — breaks XLSX export/import compatibility). |

Other security-critical runtime packages verified via `npm ls`:
- `next@16.4.6`, `react@19.3.1`, `@supabase/ssr@0.9.0`, `@supabase/supabase-js@2.119.2`, `fast-xml-parser@5.12.1`, `jszip@3.10.2`, `mammoth@1.13.0` — **0 known advisories** in current `npm audit` database.

---

## 3. Detailed Security Findings (`P0`–`P4`)

### P0 — Critical Findings

#### `SEC-001` (P0): Study Set Ownership Hijack & Privilege Escalation via `study_sets_update_editable` RLS Policy
- **Files & Lines:**
  - `supabase/migrations/0002_rls_policies.sql:237-241`
  - `src/lib/security/authz.ts:134`
- **Evidence:**
  ```sql
  CREATE POLICY "study_sets_update_editable"
    ON public.study_sets FOR UPDATE
    TO authenticated
    USING (public.can_edit_study_set(id, (SELECT auth.uid())))
    WITH CHECK (public.can_edit_study_set(id, (SELECT auth.uid())));
  ```
- **Vulnerability Analysis:**
  - `PATCH /api/sets/[id]` (`src/app/api/sets/[id]/route.ts:121-132`) correctly prevents editors from changing `visibility`, `folder_id`, or `is_archived`, and omits `owner_id` from `updateStudySetSchema`.
  - However, Supabase exposes `public.study_sets` directly over PostgREST using the user's JWT and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
  - Under `study_sets_update_editable`, an invited collaborator with `role = 'editor'` satisfies `USING` on the original row. If the editor updates `owner_id = <editor_user_id>`, `visibility = 'public'`, or `is_archived = true`, the `WITH CHECK` expression evaluates `can_edit_study_set(id, <editor_user_id>)` on the **new** row — where `s.owner_id = <editor_user_id>` is now `TRUE`!
  - Separately, in `src/lib/security/authz.ts:134`, `const isOwner = memberRole === "owner";` grants owner-level API authority to any `study_set_members` row with `role = 'owner'`, diverging from SQL `is_study_set_owner()` which checks `study_sets.owner_id` exclusively.
- **Conceptual Reproduction Flow:**
  1. User A owns private Study Set S and invites User B as `editor`.
  2. User B sends an authenticated Supabase PostgREST `PATCH` against `public.study_sets` (`id = S`) setting `owner_id = User B's UUID`.
  3. Both `USING` and `WITH CHECK` succeed; User B is now `study_sets.owner_id`, gaining full control to delete the set, make it public, create share links, and lock out User A.
- **Concrete Remediation Spec (Migration `0005` + API):**
  1. Add a `BEFORE UPDATE` trigger `trg_guard_study_sets_update` on `public.study_sets`:
     - Unconditionally reject `NEW.owner_id IS DISTINCT FROM OLD.owner_id` when `current_user = 'authenticated'` (ownership transfer, if ever supported, must use a dedicated owner-verified RPC).
     - Reject changes to `visibility`, `folder_id`, `is_archived` unless `OLD.owner_id = (SELECT auth.uid())`.
     - Reject direct client manipulation of `question_count` when `current_user = 'authenticated'` (maintained by trigger/RPC).
     - If `NEW.folder_id IS NOT NULL`, assert `EXISTS (SELECT 1 FROM public.folders f WHERE f.id = NEW.folder_id AND f.owner_id = OLD.owner_id)`.
  2. In `src/lib/security/authz.ts:134`, set `const isOwner = false;` on the non-owner branch (line 107 already handles `studySet.owner_id === userId`).

---

#### `SEC-002` (P0): Forced Friendship & Cross-User Private Profile/Email/Avatar Takeover via `friendships_update_participant` RLS
- **Files & Lines:**
  - `supabase/migrations/0002_rls_policies.sql:658-668`
  - `supabase/migrations/0002_rls_policies.sql:81-116, 155-158` (`can_view_profile`, `profiles_select_visible`)
  - `supabase/migrations/0004_storage_and_buckets.sql:30-34` (`study_media_select` avatar rule)
- **Evidence:**
  ```sql
  CREATE POLICY "friendships_update_participant"
    ON public.friendships FOR UPDATE
    TO authenticated
    USING (
      addressee_id = (SELECT auth.uid())
      OR requester_id = (SELECT auth.uid())
    )
    WITH CHECK (
      (addressee_id = (SELECT auth.uid()) AND status IN ('accepted', 'declined', 'blocked'))
      OR (requester_id = (SELECT auth.uid()) AND status = 'blocked')
    );
  ```
- **Vulnerability Analysis:**
  - `friendships_update_participant` does NOT prevent a participant from changing `requester_id` or `addressee_id` during an `UPDATE`.
  - If User B holds ANY row where `addressee_id = B` (for example, created via a second account A -> B), User B can issue a PostgREST `UPDATE` on that row setting `requester_id = <Target_Victim_UUID>` and `status = 'accepted'`.
  - `USING` passes (`OLD.addressee_id = B`), `WITH CHECK` passes (`NEW.addressee_id = B AND NEW.status = 'accepted'`), and `friendships_no_self` passes (`victim <> B`).
  - Once `status = 'accepted'` exists between Victim and User B, `can_view_profile(Victim, B)` immediately returns `TRUE`, allowing User B to `SELECT * FROM public.profiles WHERE id = Victim` (exposing Victim's private `email`, `avatar_url`, `bio`) and download Victim's private avatar from `study-media/avatars/{victim_id}/*`.
- **Conceptual Reproduction Flow:**
  1. Attacker creates one incoming friendship row `(requester_id = helper, addressee_id = attacker, status = 'pending')`.
  2. Attacker executes a direct PostgREST `PATCH` on `public.friendships` updating `requester_id = <victim_uuid>, status = 'accepted'`.
  3. Attacker queries `public.profiles` for `<victim_uuid>` and receives the victim's email and profile metadata without victim consent.
- **Concrete Remediation Spec (Migration `0005`):**
  1. Add a `BEFORE UPDATE` trigger `trg_guard_friendships_update` on `public.friendships`:
     - Raise `42501` if `NEW.requester_id IS DISTINCT FROM OLD.requester_id` or `NEW.addressee_id IS DISTINCT FROM OLD.addressee_id`.
     - Enforce state machine: `accepted`/`declined` transitions ONLY allowed when `OLD.status = 'pending'` and `OLD.addressee_id = (SELECT auth.uid())`.
     - Require `blocked_by` column (see `SEC-006`) so blocked rows cannot be reopened by the blocked party.
  2. Remove `email` from cross-user readable profile access (see `SEC-005`).

---

### P1 — High Findings

#### `SEC-003` (P1): Cross-Tenant Question/Option/Tag Injection & Private Question Oracle via Denormalized `study_set_id` Mismatch
- **Files & Lines:**
  - `supabase/migrations/0001_initial_schema.sql:131-156, 174-212, 236-248`
  - `supabase/migrations/0002_rls_policies.sql:347-390, 424-435, 450-456, 477-483`
  - `src/app/api/sets/[id]/questions/bulk/route.ts:169-203`
  - `src/app/api/progress/route.ts:55-77`
  - `src/app/api/starred/route.ts:106-152`
- **Evidence:**
  - `question_options`, `question_accepted_answers`, `question_tags`, `user_question_progress`, and `starred_questions` each have independent single-column FKs `question_id REFERENCES questions(id)` and `study_set_id REFERENCES study_sets(id)`, with **no composite FK** guaranteeing `questions.study_set_id = child.study_set_id`.
  - Their RLS policies authorize writes using `can_edit_study_set(study_set_id, (SELECT auth.uid()))` (or `can_read_study_set(study_set_id, ...)`).
  - Worse, `PATCH /api/sets/[id]/questions/bulk` (lines 192–200) directly inserts caller-supplied `input.question_ids` into `question_tags` with `study_set_id: setId` without verifying that those `question_ids` actually belong to `setId`!
  - Similarly, `POST /api/progress` (line 61) and `POST /api/starred` (lines 112–126) check `requireStudySetAccess(input.study_set_id, "read")` without checking that `input.question_id` belongs to `input.study_set_id`.
- **Impact:**
  1. **Cross-tenant data corruption (Direct PostgREST & API):** Any user owning Set X can insert options (with `is_correct = true`), accepted answers, or tags attached to a Victim's `question_id` (e.g., from a shared read-only or public study set) by specifying `study_set_id = X`. When the victim's set is fetched (`GET /api/sets/[victimSet]/questions` queries `.in("question_id", questionIds)` without filtering `study_set_id` — `src/app/api/sets/[id]/questions/route.ts:133-146`), the attacker's injected options/answers/tags are returned and graded as part of the victim's question!
  2. **Private Question UUID Existence Oracle:** Calling `POST /api/starred` or `POST /api/progress` with `{ study_set_id: ownSetId, question_id: candidateUuid }` returns `200`/`201` if `candidateUuid` exists in ANY private study set vs `400 INVALID_REFERENCE` if it does not.
- **Concrete Remediation Spec:**
  1. **SQL (Migration `0005`):**
     - `ALTER TABLE public.questions ADD CONSTRAINT questions_id_study_set_id_unique UNIQUE (id, study_set_id);`
     - Add composite FKs `FOREIGN KEY (question_id, study_set_id) REFERENCES public.questions(id, study_set_id) ON DELETE CASCADE` on `question_options`, `question_accepted_answers`, `question_tags`, `user_question_progress`, `starred_questions`, and `study_session_answers`.
  2. **API Routes:**
     - In `PATCH /api/sets/[id]/questions/bulk`, verify `SELECT id FROM questions WHERE study_set_id = setId AND id = ANY(input.question_ids)` and only tag verified IDs (reject mismatch with `400`/`404`).
     - In `POST /api/progress` and `POST /api/starred`, always resolve `questions.study_set_id` from the database via `.eq("id", input.question_id)` (never trust client-supplied `study_set_id` alone) and verify `requireStudySetAccess` on the true `question.study_set_id`.

---

#### `SEC-004` (P1): Direct-RPC Forged Exam Attempt Creation via `public.create_exam_attempt()`
- **Files & Lines:**
  - `supabase/migrations/0003_functions_and_triggers.sql:536-678`
  - `src/app/api/exams/route.ts:311-318`
- **Evidence:**
  - `public.create_exam_attempt(p_study_set_id, p_title_snapshot, p_config, p_duration_limit_seconds, p_pass_threshold, p_questions jsonb)` is `SECURITY DEFINER` and granted `EXECUTE` to `authenticated` (line 678).
  - Lines 610–643 insert `prompt_snapshot`, `options_snapshot`, `correct_option_ids`, `accepted_answers_snapshot`, and `question_id` straight from caller-supplied `p_questions jsonb` without reading `public.questions` or verifying `question_id` belongs to `p_study_set_id`.
- **Impact:**
  - Any authenticated user can call `/rest/v1/rpc/create_exam_attempt` directly via PostgREST with fabricated questions and self-chosen `correct_option_ids` (even referencing real `question_id`s from sets they cannot read!), bypassing server-side sampling, filter integrity, and answer authenticity. Calling `submit_exam_attempt()` then records a forged 100% passed exam and mutates `user_question_progress` for arbitrary `question_id`s.
  - Note per StudyHub's threat model: StudyHub is a personal study app (not proctored DRM), so the goal is reliable self-testing and server-authoritative exam records; allowing direct PostgREST injection of forged snapshots breaks the exam integrity guarantee in `docs/SECURITY.md` §3.
- **Concrete Remediation Spec (V2.0 Migration `0005`):**
  - **Recommended:** Upgrade exam creation (`create_exam_attempt_v2`) so PostgreSQL reads `questions`, `question_options`, and `question_accepted_answers` directly from the database given authorized `study_set_id`s / `question_ids` (building `options_snapshot`, `correct_option_ids`, `accepted_answers_snapshot`, and `explanation_snapshot` exclusively inside SQL), OR `REVOKE EXECUTE ON FUNCTION public.create_exam_attempt(...) FROM authenticated;` and call it solely from `POST /api/exams` via server-only `createAdminClient()` after server-side `requireAuth()` and source authorization.

---

#### `SEC-005` (P1): Private Email PII Exposure to Pending Friend Requesters & Study Set Collaborators
- **Files & Lines:**
  - `supabase/migrations/0002_rls_policies.sql:81-116` (`can_view_profile`)
  - `supabase/migrations/0002_rls_policies.sql:155-158` (`profiles_select_visible`)
  - `src/app/api/sets/[id]/members/route.ts:43` (`GET /api/sets/[id]/members`)
- **Evidence:**
  - `can_view_profile()` line 94 grants profile visibility whenever a friendship has `status IN ('pending', 'accepted')`, or whenever two users share a study set.
  - `profiles_select_visible` exposes **all columns** of `public.profiles`, including `email`, to any caller passing `can_view_profile()`.
  - `GET /api/sets/[id]/members` (accessible to any `viewer` via `requireStudySetAccess(..., "read")`) explicitly queries `.select("id, display_name, username, avatar_url, email")` and returns `owner.email` in the JSON payload.
- **Impact:**
  - Any authenticated user who knows a target's username (or guesses it via `GET /api/users/search`) can send an **unaccepted** `pending` friend request and immediately read the target's private `email` via PostgREST `SELECT email FROM profiles WHERE id = <target>`.
  - Any viewer of a shared or public study set calling `GET /api/sets/[id]/members` receives the owner's private `email`.
- **Concrete Remediation Spec:**
  1. Remove `email` from `src/app/api/sets/[id]/members/route.ts:43` (select only `id, display_name, username, avatar_url`).
  2. Enforce column-level privacy in PostgreSQL (Migration `0005`):
     - `REVOKE SELECT ON public.profiles FROM authenticated;` and `GRANT SELECT (id, display_name, username, avatar_url, bio, created_at, updated_at) ON public.profiles TO authenticated;` (returning `email` only from `supabase.auth.getUser()` or a self-only RPC `get_my_profile()`), OR restrict `profiles_select_own` to `id = (SELECT auth.uid())` and expose peer profiles via a safe `public_profiles` view / RPC excluding `email`.
  3. Restrict `can_view_profile()` so outbound `pending` requesters cannot view target profiles beyond minimal search metadata until accepted (or exclude `email` permanently from all peer visibility).

---

#### `SEC-006` (P1): Friendship Block Bypass (Blocked User Can Unblock Self or Force-Accept)
- **Files & Lines:**
  - `supabase/migrations/0001_initial_schema.sql:315-323` (`friendships` lacks `blocked_by`)
  - `supabase/migrations/0002_rls_policies.sql:658-676` (`friendships_update_participant`, `friendships_delete_participant`)
  - `src/app/api/friends/route.ts:61` (`GET /api/friends`)
  - `src/app/api/friends/[id]/route.ts:46-66, 85-91` (`PATCH`, `DELETE`)
- **Evidence:**
  - `PATCH /api/friends/[id]` checks `if ((action === "accept" || action === "decline") && !isAddressee)` but **never checks `existing.status === "pending"`**.
  - `DELETE /api/friends/[id]` and `friendships_delete_participant` allow EITHER `requester_id` or `addressee_id` to delete a row regardless of `status = 'blocked'`.
  - `GET /api/friends` returns `blocked: enriched.filter((f) => f.status === "blocked")` to **both** the blocker and the blocked user, disclosing the exact `friendship.id`.
- **Impact:**
  - When User A blocks User B, User B can retrieve the friendship `id` from `GET /api/friends` and call `DELETE /api/friends/[id]` to delete the block and resume sending requests — or if User B was `addressee_id`, call `PATCH /api/friends/[id]` with `{"action": "accept"}` to flip `'blocked'` directly to `'accepted'`!
- **Concrete Remediation Spec:**
  1. Add `blocked_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL` to `public.friendships` (Migration `0005`).
  2. Update `friendships_delete_participant`: `USING ((requester_id = (SELECT auth.uid()) OR addressee_id = (SELECT auth.uid())) AND (status <> 'blocked' OR blocked_by = (SELECT auth.uid())))`.
  3. Update `PATCH /api/friends/[id]` and DB `BEFORE UPDATE` trigger: require `existing.status === "pending"` for `accept`/`decline`; set `blocked_by = user.id` when blocking; reject any update to a `'blocked'` row unless `existing.blocked_by === user.id`.
  4. In `GET /api/friends`, only include blocked rows where `f.blocked_by === user.id` (hide blocks initiated by others from the blocked user's list).

---

#### `SEC-007` (P1): Global Enumeration of `'unlisted'` Study Sets via Direct PostgREST Query
- **Files & Lines:**
  - `supabase/migrations/0002_rls_policies.sql:39` (`can_read_study_set`)
  - `supabase/migrations/0002_rls_policies.sql:227-230` (`study_sets_select_public_anon`)
  - `supabase/migrations/0002_rls_policies.sql:308-316, 337-345, 366-374` (`questions`, `question_options`, `question_accepted_answers`)
- **Evidence:**
  ```sql
  CREATE POLICY "study_sets_select_public_anon"
    ON public.study_sets FOR SELECT
    TO anon
    USING (visibility IN ('public', 'unlisted'));
  ```
- **Impact:**
  - Unauthenticated (`anon`) and authenticated users can call `GET /rest/v1/study_sets?visibility=eq.unlisted` and list **every** `'unlisted'` study set across all users, along with all questions and answer keys. Users who set a study set to `'unlisted'` ("Anyone with the link") expect it to be unenumerable, not globally scrapable.
- **Concrete Remediation Spec:**
  - Restrict `study_sets_select_public_anon` and table-wide `can_read_study_set` to `visibility = 'public'` ONLY.
  - Access to `'unlisted'` sets should require a valid share link token (`study_set_share_links`) or a rate-limited exact-ID RPC (`get_unlisted_study_set(p_set_id uuid)`) that never allows table scans.

---

#### `SEC-008` (P1): High-Severity Runtime Dependency Vulnerability — `zod@3.25.76` Memory Exhaustion (`GHSA-mrhx-c7xc-m3w5`)
- **Files & Lines:** `package.json:42`, `package-lock.json`
- **Evidence:** `npm audit --omit=dev` flags `zod <4.6.6` (**High**, CVSS `7.5`, CWE-770): *"Zod can exhaust memory while validating oversized constrained collections."*
- **Impact:** Remote denial-of-service via memory exhaustion when crafted JSON payloads hit Zod-validated API routes (`/api/import/commit`, `/api/import/parse`, `/api/sets/[id]/questions/bulk`, `/api/exams`).
- **Concrete Remediation Spec:**
  1. Upgrade `zod` to `^4.6.7` (verify compatibility with `@hookform/resolvers@^5.9.2` and update any Zod v3 idioms such as `z.ZodIssueCode.custom` in `src/lib/validation/questions.ts:50`).
  2. Enforce strict HTTP payload byte caps before calling `request.json()` inside `parseJsonBody()` (`src/lib/security/errors.ts:186`) and `/api/import/parse`.

---

### P2 — Medium Findings

#### `SEC-009` (P2): Authorization Oracle & Social-Graph Leak via Public `SECURITY DEFINER` Helper RPCs
- **Files & Lines:** `supabase/migrations/0002_rls_policies.sql:12-126`
- **Evidence:** `is_study_set_owner(uuid, uuid)`, `can_read_study_set(uuid, uuid)`, `can_edit_study_set(uuid, uuid)`, and `can_view_profile(uuid, uuid)` are created in the PostgREST-exposed `public` schema, accept arbitrary caller-supplied user UUID parameters, and are granted `EXECUTE` to `authenticated` (and `anon` for `can_read_study_set`).
- **Impact:** Any authenticated caller (or `anon` for `can_read_study_set`) can invoke `/rest/v1/rpc/can_view_profile` or `/rest/v1/rpc/is_study_set_owner` with arbitrary UUID pairs to probe whether two users are friends, share a private set, or own a specific study set UUID.
- **Concrete Remediation Spec (Migration `0005`):**
  - Move internal RLS helper functions into a non-exposed `private` schema (not listed in `supabase/config.toml` `schemas`) OR create 1-argument wrappers (`can_read_study_set(p_set_id uuid)`) that hardcode `(SELECT auth.uid())` internally and `REVOKE EXECUTE` on the 2-argument forms from `PUBLIC`, `anon`, and `authenticated`.

---

#### `SEC-010` (P2): ZIP/XLSX Archive Bomb OOM Bypass & Uninspected `ExcelJS` XML Loading
- **Files & Lines:**
  - `src/lib/import/zip-guard.ts:493-507` (`readSafeZipTextEntry`)
  - `src/lib/import/xlsx-parser.ts:78-86` (`parseXlsxBuffer`)
  - `src/lib/import/docx-ooxml-parser.ts:1062-1072`
  - `src/lib/security/upload.ts:295-307`
- **Evidence:**
  1. `readSafeZipTextEntry` calls `const bytes = await entry.async("uint8array")` before subtracting `bytes.byteLength` from `budget.remainingBytes`. If a crafted ZIP spoofs its Central Directory `uncompressedSize` to a small value, `inspectZipCentralDirectory()` passes and `entry.async("uint8array")` allocates the full decompressed stream in memory before the 50 MB cap is checked.
  2. `parseXlsxBuffer()` calls `inspectAndLoadZip(bytes, "xlsx")` (which only reads `[Content_Types].xml`), then passes the raw `arrayBuffer` straight to `workbook.xlsx.load(arrayBuffer)` without streaming decompression budget checks or `assertNoXxeDeclarations()` checks on `xl/workbook.xml`, `xl/sharedStrings.xml`, and `xl/worksheets/*.xml`.
- **Impact:** Small (<15 MB) crafted `.docx` or `.xlsx` uploads with forged ZIP headers can trigger Node.js OOM crashes; `.xlsx` XML parts bypass the explicit `DOCTYPE`/`ENTITY` XXE guard before reaching `ExcelJS`'s XML parser.
- **Concrete Remediation Spec:**
  1. Implement `readSafeZipStream(entry, budget, maxRatio)` using `entry.nodeStream()` (or `internalStream("uint8array")`) that counts chunks incrementally and calls `stream.destroy()` immediately if cumulative decompressed bytes exceed `50 MB` or compression ratio exceeds `100:1`.
  2. In `parseXlsxBuffer()`, iterate all `xl/**/*.xml` entries through `readSafeZipStream()` and run `assertNoXxeDeclarations()` on every XML part BEFORE passing `arrayBuffer` to `workbook.xlsx.load()`.
  3. Consolidate `src/lib/security/upload.ts` and `src/lib/import/zip-guard.ts` so there is a single tested, runtime-active archive guard.

---

#### `SEC-011` (P2): Direct Browser Storage Uploads Bypass Magic-Byte Validation (`upload.ts` Dead Code) & Storage RLS / Private Bucket Mismatches
- **Files & Lines:**
  - `src/lib/security/upload.ts:437-490` (dead code — 0 imports in `src/`)
  - `src/components/editor/question-editor-view.tsx:424-475`
  - `src/components/layout/profile-view.tsx:116-163`
  - `supabase/migrations/0004_storage_and_buckets.sql:32-118`
- **Evidence:**
  1. Static scan confirmed `@/lib/security/upload` is imported in `0` production files (only in `tests/unit/security/security-modules.test.ts`).
  2. Both `question-editor-view.tsx` and `profile-view.tsx` upload directly from the browser via `supabase.storage.from("study-media").upload(...)`, relying only on browser `file.type` (spoofable) and Supabase bucket `allowed_mime_types` (header-based, not magic-byte verified).
  3. `profile-view.tsx:150` uploads avatars to `${user.id}/avatar-${Date.now()}.${safeExt}` instead of `avatars/${user.id}/${uuid}.${safeExt}` (rejected by `study_media_insert` RLS!), and both components call `.getPublicUrl(path)` on a **private** bucket (`public = false` in `0004`).
  4. `0004_storage_and_buckets.sql` validates UUID folder names with loose regex `^[0-9a-f-]{36}$` (allows invalid UUIDs like 36 hyphens that crash `::uuid` with `22P02`) and does not verify `(storage.foldername(name))[1]` equals `study_sets.owner_id` on `INSERT`/`UPDATE`/`DELETE`.
- **Concrete Remediation Spec:**
  1. Add a server-side `POST /api/media/upload` route guarded by `requireAuth()`, `RATE_LIMITS.UPLOAD`, `requireStudySetAccess(..., "edit")` (for question media), and `validateImageUpload()` (magic bytes + SVG block + 5 MB cap).
  2. Store media paths canonically (`avatars/{userId}/{uuid}.{ext}` or `{ownerId}/{setId}/{uuid}.{ext}`) and serve them via short-lived signed URLs (`createSignedUrl`) or an authenticated `/api/media/[...path]` proxy route instead of `getPublicUrl()`.
  3. In Migration `0005`, update Storage RLS policies to use strict UUID regex `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$` (`~*`) and require `EXISTS (SELECT 1 FROM public.study_sets s WHERE s.id = (folder[2])::uuid AND s.owner_id = (folder[1])::uuid)`.

---

#### `SEC-012` (P2): Share Link `allow_clone = false` Restriction Is Never Enforced
- **Files & Lines:**
  - `supabase/migrations/0001_initial_schema.sql:98`
  - `supabase/migrations/0003_functions_and_triggers.sql:865-877`
  - `src/app/api/sets/[id]/duplicate/route.ts:36-41`
  - `src/app/api/sets/[id]/export/route.ts:55-60`
- **Evidence:** `ShareDialog` exposes an "Allow copy / clone" (`allow_clone`) toggle persisted to `study_set_share_links.allow_clone`. However, `redeem_share_link()` never records `allow_clone` on `study_set_members`, and both `POST /api/sets/[id]/duplicate` and `GET /api/sets/[id]/export` only require `"read"` access.
- **Impact:** Recipients of a share link created with `allow_clone = false` can still duplicate the study set into their own account or export all questions in JSON/XLSX/CSV/TXT.
- **Concrete Remediation Spec:** Add `can_clone boolean NOT NULL DEFAULT true` to `public.study_set_members`, set it from `v_link.allow_clone` inside `redeem_share_link()`, and enforce `access.isOwner || access.canClone` in `POST /api/sets/[id]/duplicate` and `GET /api/sets/[id]/export` (for non-public sets).

---

#### `SEC-013` (P2): Mutable `profiles.email` Lookup Spoofing & Unvalidated `avatar_url` at DB / Signup Trigger Layer
- **Files & Lines:**
  - `supabase/migrations/0001_initial_schema.sql:11-20`
  - `supabase/migrations/0002_rls_policies.sql:165-169`
  - `supabase/migrations/0003_functions_and_triggers.sql:55-109, 165-208`
- **Evidence:**
  1. `profiles.email` has no `UNIQUE` constraint and `profiles_update_own` allows direct PostgREST `UPDATE public.profiles SET email = 'target@example.com'`. Because `find_profile_by_username_or_email()` matches `lower(p.email) = v_clean` with `LIMIT 1` and no `ORDER BY`, an attacker can spoof another user's email to hijack friend/member invitations addressed to that email!
  2. `handle_new_user()` copies user-supplied `raw_user_meta_data->>'avatar_url'` verbatim without checking `https://` and without capping `display_name` length. Neither `profiles.avatar_url` nor `questions.*_image_url` / `question_options.image_url` have DB-level URL scheme `CHECK` constraints.
- **Concrete Remediation Spec:**
  1. Add a `BEFORE UPDATE` trigger on `public.profiles` forbidding authenticated callers from changing `email` (sync email changes only from an `auth.users` `AFTER UPDATE` trigger).
  2. Add URL scheme `CHECK` constraints (`url IS NULL OR url ~* '^(https://|/|avatars/[0-9a-f-]{36}/|[0-9a-f-]{36}/[0-9a-f-]{36}/)'`) on `profiles.avatar_url`, `questions.prompt_image_url`, `questions.back_image_url`, and `question_options.image_url`.
  3. Sanitize `avatar_url` (accept only `https://`) and truncate `display_name` to 100 chars inside `handle_new_user()`.

---

#### `SEC-014` (P2): Missing Rate Limiting on Account Enumeration (`POST /api/sets/[id]/members`) & Heavy Export (`GET /api/sets/[id]/export`)
- **Files & Lines:**
  - `src/app/api/sets/[id]/members/route.ts:63-85`
  - `src/app/api/sets/[id]/export/route.ts:35-184`
  - `src/app/api/sets/[id]/share-links/route.ts:48-98`
- **Evidence:**
  - `GET /api/users/search` and `POST /api/friends` enforce `RATE_LIMITS.FRIEND_REQUEST` (`20/15m`), but `POST /api/sets/[id]/members` calls `find_profile_by_username_or_email(input.identifier)` with **zero rate limiting**, returning `404` vs `201` (complete bypass of user-search rate limits).
  - `GET /api/sets/[id]/export` performs multi-page DB queries and in-memory `ExcelJS` workbook generation on up to 10,000+ questions with **zero rate limiting** (CPU/memory DoS vector).
  - `POST /api/sets/[id]/share-links` has no rate limit and no cap on active links per set.
- **Concrete Remediation Spec:**
  - Enforce `RATE_LIMITS.FRIEND_REQUEST` on `POST /api/sets/[id]/members`.
  - Add `RATE_LIMITS.EXPORT` (`15/15m`) on `GET /api/sets/[id]/export` and `RATE_LIMITS.SHARE_CREATE` (`20/15m`) + max 25 active links per set on `POST /api/sets/[id]/share-links`.

---

#### `SEC-015` (P2): Weak Client-Side `next` Redirect Sanitizer (`/\` Bypass) & Middleware Redirect Cookie Loss
- **Files & Lines:**
  - `src/components/auth/login-form.tsx:23-29`
  - `src/lib/supabase/middleware.ts:70-85`
- **Evidence:**
  - `login-form.tsx` defines a local `sanitizeNextPath`: `if (raw.startsWith("/") && !raw.startsWith("//")) return raw;`. Unlike `isSafeRelativeRedirect()` in `src/lib/security/authz.ts:168-186`, it fails to block `/\evil.com` (normalized to `//evil.com` by WHATWG URL parsers) and control characters. `middleware.ts:74` uses the same weaker check.
  - When `updateSession()` redirects (`middleware.ts:77, 84`), it returns a brand-new `NextResponse.redirect(...)` without copying cookies that `@supabase/ssr` wrote to `supabaseResponse.cookies` (e.g., clearing invalid refresh cookies).
- **Concrete Remediation Spec:**
  - Import and use a client-safe `isSafeRelativeRedirect()` in both `login-form.tsx` and `middleware.ts`.
  - Copy `supabaseResponse.cookies.getAll()` onto redirect responses in `middleware.ts` (following official `@supabase/ssr` guidance).

---

#### `SEC-016` (P2): Exam Answer Save Missing `attempt_question_id` Scoping & `submit_exam_attempt()` Edge Cases
- **Files & Lines:**
  - `src/app/api/exams/[attemptId]/answers/route.ts:61-78`
  - `supabase/migrations/0003_functions_and_triggers.sql:309, 405, 503-507`
- **Evidence:**
  1. `PUT /api/exams/[attemptId]/answers` upserts rows using caller-supplied `item.attempt_question_id` without verifying those IDs belong to `attemptId` (no composite FK on `exam_attempt_answers` either) or verifying `selected_option_ids` exist in `options_snapshot`, and lacks monotonic sequence checking against out-of-order debounced autosave races.
  2. `submit_exam_attempt()` line 309 checks `IF v_caller IS NOT NULL AND v_attempt.user_id <> v_caller`, skipping the ownership check whenever `auth.uid()` is `NULL` without asserting `current_role = 'service_role'`.
  3. Line 504 updates `study_sets.last_studied_at` even when the exam taker is a non-owner viewer/public user.
  4. Line 405–432 upserts `user_question_progress` with `study_set_id = v_attempt.study_set_id` even for questions sourced from `additional_study_set_ids` (cross-set progress misattribution — and breaks completely in V2.0 when `study_set_id` is nullable for multi-subject exams).
- **Concrete Remediation Spec:**
  1. Add `UNIQUE (id, attempt_id)` on `exam_attempt_questions` and composite FK `(attempt_question_id, attempt_id) REFERENCES exam_attempt_questions(id, attempt_id)`. Validate `attempt_question_id` membership in `PUT /api/exams/[attemptId]/answers` and add monotonic `client_seq` guard.
  2. In `submit_exam_attempt()`: reject `v_caller IS NULL` unless `current_setting('request.jwt.claim.role', true) = 'service_role'`; update `study_sets.last_studied_at` only `WHERE id = v_attempt.study_set_id AND owner_id = v_attempt.user_id`; use `v_q.source_study_set_id` (V2.0) when upserting `user_question_progress`.

---

### P3 — Low / Defense-in-Depth Findings

#### `SEC-017` (P3): Moderate Transitive Dependency Vulnerability (`uuid@8.3.2` via `exceljs@4.4.0`)
- **Location:** `package.json:24` (`exceljs@4.4.0` -> `uuid@8.3.2`), [GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq).
- **Assessment:** `exceljs` invokes `uuid.v4()` internally (not vulnerable `v3`/`v5`/`v6` with caller `buf`). Practical risk is low, but `exceljs` is unmaintained. Do **NOT** run `npm audit fix --force` (downgrades to `3.4.0`). Plan a clean V2.x evaluation of a maintained XLSX writer/reader or npm `overrides` with full regression verification.

#### `SEC-018` (P3): PostgREST `.or()` Filter Syntax Fragility on Search Inputs
- **Location:** `src/app/api/sets/route.ts:62-66, 145-149`, `src/app/api/sets/[id]/questions/route.ts:99-103`.
- **Evidence:** `.replace(/[%_,]/g, "")` strips `,` (preventing injection of extra clauses), but leaves `(`, `)`, `"`, `\`, and `.` unstripped, causing PostgREST filter syntax errors (`400`/`500`) on queries containing `)` or `.`.
- **Remediation:** Sanitize search strings with `.replace(/[%_,()."\\]/g, " ").trim()` or move multi-column search to a parameterized PostgreSQL RPC.

#### `SEC-019` (P3): CSV Formula Injection (CWE-1236) on Study Set Export
- **Location:** `src/lib/export/index.ts:134-148`.
- **Evidence:** `exportToCsv()` passes raw user/shared strings directly to `Papa.unparse(rows)`. Cells beginning with `=`, `+`, `-`, `@`, `\t`, or `\r` can be interpreted as formulas when opened in Excel/LibreOffice Calc (risky when exporting study sets shared by other users).
- **Remediation:** Neutralize leading formula triggers (`^[=+@\t\r]` and `^-(?![0-9])`, preserving negative numbers like `-1`) by prefixing a single quote `'` in `exportToCsv()`.

#### `SEC-020` (P3): Incomplete Account Deletion Cleanup, Ignored Delete Errors & Password Change Without Re-Auth
- **Location:** `src/app/api/account/data/route.ts:93-113`, `supabase/config.toml:46`, `src/components/layout/settings-view.tsx:186`.
- **Evidence:**
  1. `DELETE /api/account/data` runs 8 parallel `.delete()` calls without checking their `error` returns, leaves `friendships` and `study_set_members` intact for `scope === "study_data"`, and never removes user files from Supabase Storage bucket `study-media` on `scope === "account"`.
  2. `supabase/config.toml:46` sets `secure_password_change = false` and `SettingsView` calls `supabase.auth.updateUser({ password })` without verifying the user's current password.
- **Remediation:** Check all delete errors strictly; purge Storage objects under `avatars/{user.id}/` and `{user.id}/` via admin storage API on account deletion; require current password re-verification before password change and enable `secure_password_change = true` in production Supabase Auth settings.

#### `SEC-021` (P3): In-Memory Rate Limiter Scope, `x-forwarded-for` Trust & Missing Pre-Parse JSON Size Caps
- **Location:** `src/lib/security/rate-limit.ts:30-31, 98-103`, `src/app/api/import/parse/route.ts:109, 172`, `src/lib/security/errors.ts:186`.
- **Evidence:**
  1. `rate-limit.ts` stores counters in a per-process `Map`, which is not shared across serverless instances and resets on cold starts; `getClientIdentifier` trusts the first hop of `x-forwarded-for` (spoofable unless behind a trusted edge proxy that overwrites it).
  2. `parseJsonBody()` and `POST /api/import/parse` call `await request.json()` without checking `Content-Length` or bounding byte length first (`JsonParseBodySchema.rawText` also lacks `.max()`).
- **Remediation:** Add a strict byte-size guard in `parseJsonBody(request, maxBytes)` (e.g., 1 MB default, 12 MB for `/api/import/parse` & `/api/import/commit`) before `JSON.parse`; document Upstash Redis / Postgres-backed distributed rate limiting for multi-instance production deployments.

#### `SEC-022` (P3): Production CSP Includes Localhost `connect-src`, Missing HSTS & `http://` Image URL Drift
- **Location:** `next.config.ts:5-27`, `src/lib/learning/api-client.ts:108`.
- **Evidence:**
  1. `next.config.ts:11` includes `http://127.0.0.1:* http://localhost:*` in `connect-src` unconditionally (even when `isDev === false`).
  2. `Strict-Transport-Security` header is absent in `next.config.ts`.
  3. `isSafeDisplayImageUrl()` in `src/lib/learning/api-client.ts:108` permits plain `http://` for any host (while `sanitize.ts` restricts `http://` to `localhost`/`127.0.0.1`).
- **Remediation:** Gate localhost `connect-src` behind `isDev`; add `Strict-Transport-Security: max-age=63072000; includeSubDomains` when `!isDev`; align `isSafeDisplayImageUrl()` with `isSafeHttpOrStorageUrl()` (HTTPS or safe relative `/`).

---

### P4 — Informational / Hygiene Notes

#### `SEC-023` (P4): Defense-in-Depth Hardening Checklist
1. `src/app/api/import/commit/route.ts:493-510`: Add `.eq("user_id", user.id).eq("study_set_id", body.studySetId)` when updating `import_jobs` (do not rely solely on RLS).
2. `src/app/api/sessions/[sessionId]/answers/route.ts:42-55`: Verify `question.study_set_id === session.study_set_id` (for single-set V1.0 sessions) and prefer server-computed `is_correct` for objective choice questions.
3. `supabase/migrations/0002_rls_policies.sql:203-217, 232-235`: Enforce in RLS `WITH CHECK` that `folders.parent_id` and `study_sets.folder_id` belong to `(SELECT auth.uid())` (currently checked in Next.js API routes only, not at PostgREST RLS layer).
4. `src/lib/supabase/middleware.ts:6-19`: Add `/exams` to `PROTECTED_PREFIXES` before launching V2.0 `/exams/new`.

---

## 4. Complete API Route Authorization & Security Audit Matrix (All 39 Route Files / 66 Handlers)

| Route File | Methods | `requireAuth()` (`getUser()`) | Ownership / Role Check | Rate Limit | Findings / Status |
| --- | --- | --- | --- | --- | --- |
| `src/app/api/health/route.ts` | `GET` | Public (by design) | N/A | None | **PASS** (status + config boolean only) |
| `src/app/api/import/templates/[format]/route.ts` | `GET` | Public (by design) | Strict 6-format allowlist | None | **PASS** (`attachment`, `nosniff`) |
| `src/app/api/share-links/[token]/redeem/route.ts` | `GET`, `POST` | `GET`: Optional; `POST`: Yes | Token regex + `preview`/`redeem` RPC | `20/15m` | **PASS** (`410` on revoked/expired) |
| `src/app/api/account/data/route.ts` | `GET`, `DELETE` | Yes | `user.id` / `owner_id` + `"DELETE_MY_DATA"` | None | **P3** (`SEC-020`: unchecked delete errors, orphan Storage files) |
| `src/app/api/dashboard/route.ts` | `GET` | Yes | Scoped to `user.id` / `owner_id` | None | **PASS** |
| `src/app/api/profile/route.ts` | `GET`, `PATCH` | Yes | `id = user.id`; Zod omits `email` | None | **P2** at DB layer (`SEC-013`) |
| `src/app/api/preferences/route.ts` | `GET`, `PATCH` | Yes | `user_id = user.id` | None | **PASS** |
| `src/app/api/statistics/route.ts` | `GET` | Yes | `user_id = user.id` / `owner_id` | None | **PASS** |
| `src/app/api/users/search/route.ts` | `GET` | Yes | Exact-match RPC (`>=3` chars, no email) | `20/15m` | **PASS** (bypassed by `POST /members`, see `SEC-014`) |
| `src/app/api/folders/route.ts` | `GET`, `POST` | Yes | `owner_id = user.id` + parent check | None | **P4** (add RLS parent check `SEC-023`) |
| `src/app/api/folders/[id]/route.ts` | `GET`, `PATCH`, `DELETE` | Yes | `owner_id = user.id` + parent check | None | **PASS** |
| `src/app/api/sets/route.ts` | `GET`, `POST` | Yes | `owner_id` / membership + folder check | None | **P3** (`SEC-018` `.or()` search syntax) |
| `src/app/api/sets/[id]/route.ts` | `GET`, `PATCH`, `DELETE` | Yes | `read` / `edit` (+owner-only fields) / `owner` | None | **P0** at RLS layer (`SEC-001` ownership hijack) |
| `src/app/api/sets/[id]/duplicate/route.ts` | `POST` | Yes | `read` + target folder owner check | `15/15m` | **P2** (`SEC-012` ignores `allow_clone = false`) |
| `src/app/api/sets/[id]/export/route.ts` | `GET` | Yes | `read` | **Missing** | **P2/P3** (`SEC-012`, `SEC-014`, `SEC-019`) |
| `src/app/api/sets/[id]/members/route.ts` | `GET`, `POST` | Yes | `GET`: `read`; `POST`: `owner` | **Missing** | **P1/P2** (`SEC-005` leaks `email`; `SEC-014` unthrottled lookup) |
| `src/app/api/sets/[id]/members/[userId]/route.ts` | `PATCH`, `DELETE` | Yes | `PATCH`: `owner`; `DELETE`: `owner` or self | None | **PASS** |
| `src/app/api/sets/[id]/questions/route.ts` | `GET`, `POST` | Yes | `GET`: `read`; `POST`: `edit` | None | **P3** (`SEC-018` `.or()` search syntax) |
| `src/app/api/sets/[id]/questions/bulk/route.ts` | `POST`, `PATCH`, `DELETE` | Yes | `edit` | None | **P1** (`SEC-003` `PATCH` tags arbitrary `question_ids` across sets!) |
| `src/app/api/sets/[id]/questions/[questionId]/route.ts` | `GET`, `PATCH`, `DELETE` | Yes | `read` / `edit`, verifies `study_set_id = setId` | None | **PASS** (API layer; child tables affected by `SEC-003` at DB layer) |
| `src/app/api/sets/[id]/share-links/route.ts` | `GET`, `POST` | Yes | `owner`, 192-bit `randomBytes(24)` token | **Missing** | **P2** (`SEC-014` add rate limit & active-link cap) |
| `src/app/api/sets/[id]/share-links/[linkId]/route.ts` | `PATCH`, `DELETE` | Yes | `owner`, soft-revoke only (`revoke === true`) | None | **PASS** |
| `src/app/api/friends/route.ts` | `GET`, `POST` | Yes | Participant scoped | `POST`: `20/15m` | **P1** (`SEC-006` leaks `blocked` rows to blocked target) |
| `src/app/api/friends/[id]/route.ts` | `PATCH`, `DELETE` | Yes | Participant + addressee check | None | **P0/P1** (`SEC-002`, `SEC-006` block bypass & forced friendship) |
| `src/app/api/exams/route.ts` | `GET`, `POST` | Yes | `user_id` / `read` on primary + all `additional_study_set_ids` | `POST`: `30/15m` | **P1** at RPC layer (`SEC-004` direct `create_exam_attempt` forgery); pre-submit anti-leak **PASS** |
| `src/app/api/exams/[attemptId]/route.ts` | `GET`, `DELETE` | Yes | `user_id = user.id` via RPC / query | None | **PASS** (verified zero pre-submit leak; auto-finalizes expired) |
| `src/app/api/exams/[attemptId]/answers/route.ts` | `PUT` | Yes | `user_id`, `in_progress`, `expires_at`, `is_correct: null` | None | **P2** (`SEC-016` missing `attempt_question_id` membership check) |
| `src/app/api/exams/[attemptId]/submit/route.ts` | `POST` | Yes | `user_id` + `FOR UPDATE` idempotent RPC | None | **P2** (`SEC-016` `submit_exam_attempt` edge cases) |
| `src/app/api/sessions/route.ts` | `GET`, `POST` | Yes | `user_id` / `read` on `study_set_id` | None | **PASS** |
| `src/app/api/sessions/[sessionId]/route.ts` | `GET`, `PATCH` | Yes | `user_id = user.id` | None | **PASS** |
| `src/app/api/sessions/[sessionId]/answers/route.ts` | `POST` | Yes | Session owner + question RLS | None | **P4** (`SEC-023` verify `question.study_set_id === session.study_set_id`) |
| `src/app/api/progress/route.ts` | `GET`, `POST` | Yes | `user_id` / `read` on `input.study_set_id` | None | **P1** (`SEC-003` unverified `question_id` belongs to `study_set_id`) |
| `src/app/api/progress/due/route.ts` | `GET` | Yes | `user_id = user.id` | None | **PASS** |
| `src/app/api/mistakes/route.ts` | `GET` | Yes | `user_id = user.id` | None | **PASS** |
| `src/app/api/mistakes/[questionId]/resolve/route.ts` | `POST` | Yes | `user_id = user.id` | None | **PASS** |
| `src/app/api/starred/route.ts` | `GET`, `POST` | Yes | `user_id` / `read` on `study_set_id` | None | **P1** (`SEC-003` when `study_set_id` supplied, `question_id` unverified) |
| `src/app/api/starred/[questionId]/route.ts` | `DELETE` | Yes | `user_id = user.id` | None | **PASS** |
| `src/app/api/import/parse/route.ts` | `POST` | Yes | `edit` if `studySetId` given | `15/5m` | **P2** (`SEC-010` ZIP/XLSX stream/XXE; `SEC-021` rawText size cap) |
| `src/app/api/import/commit/route.ts` | `POST` | Yes | `edit` + URL re-validation | `20/5m` | **P4** (`SEC-023` scope `import_jobs` update to `user_id` + `studySetId`) |

**Auth Route Handlers Audited:**
- `src/app/auth/callback/route.ts`: Uses `RATE_LIMITS.AUTH_ACTION`, `isSafeRelativeRedirect()` (blocks `//`, `/\`, `://`, control chars), `exchangeCodeForSession(code)` — **PASS**.
- `src/app/auth/confirm/route.ts`: Uses `RATE_LIMITS.AUTH_ACTION`, strict `ALLOWED_OTP_TYPES` allowlist, `isSafeRelativeRedirect()`, forces `/reset-password` for `recovery` — **PASS**.
- `src/app/auth/signout/route.ts`: `POST`-only (prevents GET CSRF logout; mitigated by `SameSite=Lax` cookies), `303 See Other` redirect to `/login` — **PASS**.
- `src/proxy.ts` & `src/lib/supabase/middleware.ts`: Uses `getUser()` (never `getSession()`), fails open honestly only when Supabase env vars are unconfigured (while APIs fail closed with `503`), **P2** cookie copy & `/\` sanitizer (`SEC-015`).

---

## 5. SQL Migrations & `SECURITY DEFINER` Function Audit (`0001`–`0004`)

| Function (`0002` / `0003`) | `SECURITY DEFINER` | `SET search_path = ''` | Checks `auth.uid()`? | `GRANT` Scope | Audit Verdict |
| --- | :---: | :---: | :---: | --- | --- |
| `public.is_study_set_owner(uuid, uuid)` | Yes | Yes | **No** (takes arbitrary `p_user_id`) | `authenticated` | **FAIL (`SEC-009`)** — expose only in `private` schema or bind to `auth.uid()` |
| `public.can_read_study_set(uuid, uuid)` | Yes | Yes | **No** (takes arbitrary `p_user_id`) | `anon`, `authenticated` | **FAIL (`SEC-007`, `SEC-009`)** — exposes `'unlisted'` + arbitrary user oracle |
| `public.can_edit_study_set(uuid, uuid)` | Yes | Yes | **No** (takes arbitrary `p_user_id`) | `authenticated` | **FAIL (`SEC-009`)** — arbitrary user oracle |
| `public.can_view_profile(uuid, uuid)` | Yes | Yes | **No** (takes arbitrary `p_viewer_id`) | `authenticated` | **FAIL (`SEC-005`, `SEC-009`)** — social-graph oracle + pending-request email exposure |
| `public.handle_new_user()` | Yes | Yes | Trigger (`auth.users`) | Trigger only | **WARN (`SEC-013`)** — copies unvalidated `avatar_url` and unbounded `display_name` |
| `public.sync_study_set_question_count()` | Yes | Yes | Trigger (`questions`) | Trigger only | **PASS** (note: `UPDATE` of `study_set_id` not handled, low functional risk) |
| `public.find_profile_by_username_or_email(text)` | Yes | Yes | Yes (`v_caller IS NULL` rejected) | `authenticated` | **WARN (`SEC-013`)** — relies on `profiles.email` which is mutable/non-unique |
| `public.submit_exam_attempt(uuid)` | Yes | Yes | Partial (`v_caller IS NOT NULL` check) | `authenticated` | **WARN (`SEC-016`)** — assert `service_role` if `v_caller IS NULL`; scope `last_studied_at` & `source_study_set_id` |
| `public.create_exam_attempt(...)` | Yes | Yes | Yes (`can_read_study_set`) | `authenticated` | **FAIL (`SEC-004`)** — accepts caller-supplied `p_questions` with answer keys |
| `public.get_exam_attempt_detail(uuid)` | Yes | Yes | Yes (`user_id = v_caller`) | `authenticated` | **PASS** — strictly strips answers/explanations when `in_progress` |
| `public.preview_share_link(text)` | Yes | Yes | N/A (public preview by token >=16) | `anon`, `authenticated` | **PASS** — checks `revoked_at IS NULL` & `expires_at > now()`, returns safe metadata only |
| `public.redeem_share_link(text)` | Yes | Yes | Yes (`v_caller IS NULL` rejected) | `authenticated` | **WARN (`SEC-012`)** — locks row `FOR UPDATE`, checks revoked/expired, but does not persist `allow_clone` |

---

## 6. V2.0 Security Requirements Contract (For Wave 2 Implementation)

Every new StudyHub V2.0 table, RPC, and API route in Migration `0005_v2_custom_exams_and_coverage.sql` MUST enforce these non-negotiable security controls:

### 6.1 Multi-Subject Custom Exams (`/exams/new`, `POST /api/exams/eligible`, `POST /api/exams/preview`, Upgraded `POST /api/exams`)
1. **Strict Source Authorization (Zero Cross-User Leaks):**
   - For every requested `folder_id`: verify `folders.owner_id = user.id` (folders are strictly private — return `404` on mismatch). Expand folders ONLY to sets passing `can_read_study_set(set_id, user.id)` and deduplicate `study_set_id`s before counting or sampling.
   - For every explicit `study_set_id` (owned or shared): verify `requireStudySetAccess(supabase, setId, user.id, "read")` (and reject inaccessible IDs with `404` to avoid existence leaks).
2. **Zero Answer Disclosure on Eligibility & Preview:**
   - `POST /api/exams/eligible` and `POST /api/exams/preview` MUST return aggregate counts, per-subject counts, chapter/tag names, allocation preview, and validation warnings ONLY — NEVER question prompts, options, `is_correct`, `correct_option_ids`, or explanations.
3. **Server-Authoritative Snapshot Generation (Closes `SEC-004`):**
   - `create_exam_attempt_v2` MUST generate `exam_attempt_questions` snapshots (including new columns `source_study_set_id`, `source_subject_title`, `tags_snapshot`) inside PostgreSQL (or via `service_role`-only RPC invoked exclusively by `POST /api/exams`), NEVER accepting client-supplied `correct_option_ids` or `accepted_answers_snapshot`.
   - Preserve column-level anti-leak on `exam_attempt_questions`: explicitly `GRANT SELECT (..., source_study_set_id, source_subject_title, tags_snapshot) ON public.exam_attempt_questions TO authenticated;` while keeping `correct_option_ids`, `accepted_answers_snapshot`, and `explanation_snapshot` **REVOKED**.
   - Cap arbitrary `question_count` at a safe upper bound (e.g., `1 <= question_count <= 1000`, or `<= 2000` with chunked snapshot insert) to prevent single-request timeout/memory DoS while supporting long aviation/exam sessions (250 / 500 / 1,000 Q).
4. **Exam Attempt Sources (`exam_attempt_sources`):**
   - Enable RLS with `SELECT` scoped to `EXISTS (SELECT 1 FROM public.exam_attempts ea WHERE ea.id = attempt_id AND ea.user_id = (SELECT auth.uid()))`; writes restricted to server RPC only.
5. **Middleware Protection:**
   - Add `/exams` to `PROTECTED_PREFIXES` in `src/lib/supabase/middleware.ts`.

### 6.2 Saved Exam Presets (`exam_presets`, `exam_preset_sources`)
1. **Private by Default & Strict RLS:**
   - Both tables MUST enable RLS using `(SELECT auth.uid())`: `user_id = (SELECT auth.uid())` for `SELECT`/`INSERT`/`UPDATE`/`DELETE` (and `exam_preset_sources` scoped via owning preset's `user_id`).
2. **Config-Only (No Fixed Answer/Question Leak):**
   - Presets store source references (`folder_id` / `study_set_id`), counts, allocation strategy (`A`–`E`), selection policy, timer/pass settings — never fixed question snapshots or answer keys.
3. **Revocation-Safe Launch Time Re-Authorization (CRITICAL):**
   - If User A shares Set X with User B, User B saves a preset referencing Set X, and User A later **revokes** User B's access to Set X, launching that preset MUST re-run `can_read_study_set` for every source at launch time and reject/exclude revoked sources cleanly (never bypass revocation via saved preset IDs!).

### 6.3 Full-Bank Coverage Cycles (`coverage_cycles`, `coverage_cycle_questions`, `coverage_cycle_attempts`)
1. **Strict User Isolation:**
   - Enable RLS on all 3 tables with `user_id = (SELECT auth.uid())` (via owning cycle's `user_id` for child tables). Direct client `UPDATE` on `coverage_cycle_questions.status` should be blocked or restricted to server RPCs so coverage progress stays consistent with actual submitted exams.
2. **Revocation-Safe Next-Exam Generation:**
   - `POST /api/coverage-cycles/[id]/next-exam` MUST re-verify `can_read_study_set` for every source set in the cycle before snapshotting unseen questions into a new exam attempt.
3. **Concurrency Safety & Abandoned Attempt Integrity:**
   - Lock the `coverage_cycles` row with `FOR UPDATE` inside `next-exam`, `discard-active`, and `submit_exam_attempt` so concurrent requests cannot double-assign identical unseen questions or corrupt counters.
   - `POST /api/coverage-cycles/[id]/discard-active` MUST reset `assigned -> unseen` and cancel/delete the in-progress attempt WITHOUT unlocking answer keys (`status` must NOT become `'submitted'`/`'expired'` with answer disclosure on a discarded exam!).
   - Submitting an exam marks only *answered* (or completed-exam) questions per V2.0 policy as `completed`, never silently completing abandoned exams.

---

## 7. Verification Status: Verified vs. Blocked by Live Environment

### 7.1 Fresh Verification Evidence Executed During This Audit
| Check | Command | Result | Exact Output Summary |
| --- | --- | --- | --- |
| Production Dependency Audit | `npm audit --omit=dev` | **FAIL (Exit 1)** | 3 advisories: `zod@3.25.76` (**High**, GHSA-mrhx-c7xc-m3w5), `uuid@8.3.2` via `exceljs@4.4.0` (**Moderate**, GHSA-w5hq-g745-h8pq) |
| Full Dependency Audit | `npm audit` | **FAIL (Exit 1)** | Same 3 advisories (0 dev-only advisories) |
| Security Unit & SQL Structural Suite | `npx vitest run tests/unit/security --reporter=verbose` | **PASS (Exit 0)** | 2 files, **19/19 tests passed** in `2.08s` (note: structural tests do not execute SQL against Postgres) |
| Static XSS / Injection / Mandate Scan | PowerShell `Select-String` across `src/**/*.ts(x)` | **PASS** | `0` `dangerouslySetInnerHTML`, `0` `innerHTML`, `0` `eval`/`new Function`, `0` AI/payment SDKs, `0` `getSession()` calls |
| Client Bundle Isolation Check | Scan `.next/static/**/*.{js,mjs,css}` | **PASS** | `CLEAN`: `0` matches for `SUPABASE_SERVICE_ROLE_KEY`, `service_role`, `createAdminClient`, `tryCreateAdminClient` |
| Git History & Secrets Check | `git log`, `git ls-files`, `.gitignore` | **PASS** | Single baseline commit `f09a8ed`; zero `.env.local`, zero JWT/API keys, `/sample-data/` gitignored and untracked |
| Docker / Supabase Live Environment | `docker info`, `npx --no-install supabase --version`, env check | **BLOCKED** | Docker Desktop daemon stopped (`open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified`); `supabase` CLI not installed locally; `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` all unset |

### 7.2 Runtime Negative Tests Currently BLOCKED Pending Live Supabase / Docker Daemon
The following runtime negative security tests **cannot be claimed as verified** until a live PostgreSQL/Supabase instance (local Docker `npx supabase start` or hosted Supabase project in `.env.local`) is available and executed:

1. **BLOCKED — Live 2-Account PostgreSQL RLS Isolation Matrix:**
   - Account B attempting direct PostgREST `SELECT`/`UPDATE`/`DELETE` on Account A's private `folders`, `study_sets`, `questions`, `exam_attempts`, `study_sessions`, `user_question_progress`, `starred_questions`, `import_jobs`, `exam_presets`, `coverage_cycles`.
   - Account B (`role = 'viewer'`) attempting direct PostgREST mutations on `questions`, `question_options`, `study_sets`, `study_set_members`, `study_set_share_links`.
   - Account B (`role = 'editor'`) attempting `SEC-001` ownership hijack (`UPDATE study_sets SET owner_id = B`) and `visibility` change — **MUST FAIL with `42501` after Wave 2 fix**.
   - Account B attempting `SEC-002` forced friendship (`UPDATE friendships SET requester_id = victim, status = 'accepted'`) — **MUST FAIL with `42501` after Wave 2 fix**.
   - Account B attempting `SEC-003` cross-set `question_options`/`question_tags` injection — **MUST FAIL with FK violation `23503` after Wave 2 fix**.
   - Account B attempting `SEC-005` email read on Account A via pending request or shared set — **MUST return no email after Wave 2 fix**.
   - Account B attempting `SEC-006` block bypass via `PATCH`/`DELETE /api/friends/[id]` — **MUST FAIL with `403`/`404` after Wave 2 fix**.
   - Anonymous `anon` attempting `SEC-007` `SELECT * FROM study_sets WHERE visibility = 'unlisted'` — **MUST return 0 rows after Wave 2 fix**.
2. **BLOCKED — Live Exam Integrity Runtime Tests:**
   - Direct PostgREST `SELECT correct_option_ids, accepted_answers_snapshot, explanation_snapshot FROM exam_attempt_questions` as `authenticated` (verify Postgres rejects with `42501` permission denied).
   - Direct PostgREST `POST /rest/v1/rpc/create_exam_attempt` with forged answers (`SEC-004` — verify blocked/rejected after Wave 2 fix).
   - Concurrent double-POST to `POST /api/exams/[attemptId]/submit` verifying `FOR UPDATE` row lock prevents double-incrementing `user_question_progress.correct_count` / `wrong_count`.
   - Late `PUT /api/exams/[attemptId]/answers` after `expires_at` verifying both API `409 EXAM_EXPIRED` and PostgreSQL RLS `now() <= ea.expires_at` rejection.
   - Editing source `questions` after exam start verifying `exam_attempt_questions` immutability trigger (`trg_prevent_exam_snapshot_update`) and unchanged historical attempt scores.
3. **BLOCKED — Live Storage Bucket RLS & Media Upload Negative Tests:**
   - Uploading `.svg` or SVG bytes disguised as `image/png` via `POST /api/media/upload` (`SEC-011`) — verify `415` rejection.
   - Account B attempting to download Account A's private study-set media or overwrite files under Account A's `{owner_id}` prefix — verify Storage RLS denies access.
4. **BLOCKED — Live Auth Cookie Flags & Session Lifecycle Tests:**
   - Verify `Set-Cookie` attributes (`HttpOnly`, `SameSite=Lax`, `Secure` on HTTPS) on `/auth/callback`, `/auth/confirm`, `/auth/signout`, and session refresh via `src/proxy.ts`.
   - Verify revoked share link (`DELETE /api/sets/[id]/share-links/[linkId]`) immediately rejects new redemptions (`410`) and removed member (`DELETE /api/sets/[id]/members/[userId]`) immediately loses access to the set and cannot launch a saved V2.0 preset or coverage cycle against it.

---

## 8. Prioritized Remediation Roadmap for Wave 2 Builders

| Priority | Finding IDs | Owning Role (Wave 2) | Concrete Deliverable |
| --- | --- | --- | --- |
| **Immediate (P0)** | `SEC-001`, `SEC-002` | `backend-supabase` | Migration `0005`: `trg_guard_study_sets_update`, `trg_guard_friendships_update`; fix `authz.ts:134` |
| **Immediate (P1)** | `SEC-003`, `SEC-004`, `SEC-005`, `SEC-006`, `SEC-007` | `backend-supabase` | Migration `0005`: composite FKs `(question_id, study_set_id)` & `(attempt_question_id, attempt_id)`, server-side `create_exam_attempt_v2` (no client answers), remove `email` from cross-user profile reads & `GET /members`, add `friendships.blocked_by` + block-bypass guards, restrict `'unlisted'` from table scans; fix `PATCH /questions/bulk`, `POST /progress`, `POST /starred` |
| **Immediate (P1)** | `SEC-008` | `foundation` | Upgrade `zod` to `>=4.6.7`, verify `typecheck`/`test`/`build`, add JSON body byte cap in `parseJsonBody()` |
| **Wave 2 (P2)** | `SEC-009`, `SEC-012`, `SEC-013`, `SEC-014`, `SEC-015`, `SEC-016` | `backend-supabase` + `frontend-ui` | Move RLS helpers to `private` schema (or bind `auth.uid()`), enforce `allow_clone` via `study_set_members.can_clone`, lock `profiles.email` & add URL `CHECK`s, rate-limit `POST /members` & `GET /export` & `POST /share-links`, fix `login-form.tsx` `sanitizeNextPath` & `middleware.ts` redirect cookies + `/exams`, harden `PUT /answers` & `submit_exam_attempt` |
| **Wave 2 (P2)** | `SEC-010`, `SEC-011` | `import-engine` + `backend-supabase` + `frontend-ui` | Streaming decompression cap + XLSX XML XXE scan before `ExcelJS`; add server-side `POST /api/media/upload` with magic-byte validation + signed URLs + tightened Storage RLS |
| **Wave 2/3 (P3/P4)** | `SEC-017`–`SEC-023` | `foundation` + `backend-supabase` + `import-engine` | Escape `.or()` search punctuation, CSV formula neutralization, complete account deletion + Storage purge + `secure_password_change`, gate localhost CSP to dev + add HSTS, track `exceljs`/`uuid` replacement |


---

## 9. Wave 3 Independent Security Re-Audit & Regression Verification

> **Audit Phase:** Wave 3 Independent Security Re-Audit (Read-Only on Production `src/*` & `supabase/*`; Independent Regression Suite Authored in `tests/unit/security/v2-security-regression.test.ts`)
> **Auditor:** Agent 7 — `security-auditor`
> **Scope:** All 23 Wave 1 findings (`SEC-001`–`SEC-023`), `supabase/migrations/0005_v2_custom_exams_and_coverage.sql`, `next.config.ts`, `supabase/config.toml`, `src/lib/security/*`, `src/lib/import/zip-guard.ts`, `src/lib/import/xlsx-parser.ts`, `src/lib/import/docx-ooxml-parser.ts`, `src/lib/export/index.ts`, all 53 API routes (including all 14 new V2.0 endpoints), and 6 new V2.0 tables.

### 9.1 Executive Wave 3 Verdict

- **Migrations `0001`–`0004` Immutability:** **VERIFIED** (`git diff --stat -- supabase/migrations/0001..0004` returned empty; all hardening landed cleanly and idempotently in `0005_v2_custom_exams_and_coverage.sql`).
- **Wave 1 Findings (`SEC-001`–`SEC-023`):**
  - **2/2 P0 (`SEC-001`, `SEC-002`):** **VERIFIED FIXED** (code, SQL triggers/policies & unit regression tests; live PG runtime execution remains `BLOCKED`).
  - **6/6 P1 (`SEC-003`–`SEC-008`):** **VERIFIED FIXED** (including `SEC-008` `zod` High CVE resolved to **0 High/Critical** advisories in `npm audit`).
  - **8/8 P2 (`SEC-009`–`SEC-016`):** **VERIFIED FIXED** after reopening `SEC-009`, `SEC-013`, `SEC-016` + 2 V2.0 hardening gaps in Wave 3 board post `#63` and independently re-verifying `@v2-db-backend-builder`'s fixes in `#76`.
  - **6/6 P3 (`SEC-017`–`SEC-022`):** **5/6 VERIFIED FIXED** (`SEC-017`, `SEC-018`, `SEC-020`, `SEC-021`, `SEC-022`); `SEC-019` (`exceljs -> uuid@8.3.2` Moderate advisory GHSA-w5hq-g745-h8pq) honestly **DOCUMENTED / ACCEPTED RISK** (no non-breaking upstream `exceljs` fix; `npm audit fix --force` intentionally NOT run; `uuid@8.3.2` is never used for security tokens).
  - **1/1 P4 (`SEC-023`):** **VERIFIED FIXED** (`trg_guard_study_set_owner_fields` blocks direct `question_count` tampering; `POST /api/sessions/[sessionId]/answers` verifies `question.study_set_id` belongs to the session's allowed sets).
- **V2.0 New Attack Surface (`exam_presets`, `coverage_cycles`, multi-subject exams, `uploads/*`, `account/restore`, `practice/questions`):** **VERIFIED** after Wave 3 reopen `#63` -> fix `#76`.
- **Live PostgreSQL / Supabase Runtime Negative Tests:** Remain **BLOCKED** because Docker Desktop daemon is stopped (`open //./pipe/dockerDesktopLinuxEngine: The system cannot find the file specified`), `supabase` CLI is not installed locally, and `.env.local` has no live Supabase credentials.

### 9.2 Fresh Dependency Audit (`npm audit --omit=dev` & `npm audit`)

| Command | Exit Code | Critical | High | Moderate | Low | Packages Flagged | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `npm audit --omit=dev` | `1` | **0** | **0** | **2** | 0 | `uuid` (`<11.1.1`, GHSA-w5hq-g745-h8pq) via `exceljs` (`>=3.5.0`) | **`SEC-008` VERIFIED FIXED** (0 High/Critical); `SEC-019` documented honestly |
| `npm audit` (full) | `1` | **0** | **0** | **2** | 0 | Same 2 moderate advisories (`exceljs`, `uuid`); 0 dev-only advisories | **CLEAN** of all High/Critical CVEs |

> **Note on `exceljs -> uuid@8.3.2`:** `GHSA-w5hq-g745-h8pq` affects `uuid <11.1.1` (`Math.random()` fallback only in non-crypto environments). StudyHub uses `node:crypto` (`randomUUID`, `randomBytes`, `randomInt`) exclusively for all share tokens, session IDs, upload names, and exam shuffling — never `exceljs`'s transitive `uuid@8.3.2`. `npm audit fix --force` was deliberately NOT executed because it would downgrade `exceljs` to a broken legacy major version.

### 9.3 Wave 3 Retest Matrix (`SEC-001`–`SEC-023`)

| ID | Sev | Wave 3 Verdict (Code/Unit) | Live DB Runtime | Exact Wave 3 Evidence |
| --- | --- | --- | --- | --- |
| `SEC-001` | P0 | **VERIFIED** | `BLOCKED` | `0005:515-560` (`trg_guard_study_set_owner_fields` blocks `owner_id`, `question_count`, and non-owner `visibility`/`folder_id`/`is_archived`/`is_favorite`); `src/lib/security/authz.ts:138` (`isOwner: false` for non-owners); `src/app/api/sets/[id]/route.ts:124-136`. |
| `SEC-002` | P0 | **VERIFIED** | `BLOCKED` | `0005:713-781` (`trg_guard_friendships_update` locks `requester_id`/`addressee_id`, enforces `pending -> accepted\|declined` by addressee only, enforces `blocked_by` attribution). |
| `SEC-003` | P1 | **VERIFIED** | `BLOCKED` | `0005:19-125` (composite FKs `(study_set_id, question_id)` on all 6 child tables + `(attempt_id, attempt_question_id)` on `exam_attempt_answers`); `sets/[id]/questions/bulk/route.ts:210-228`, `progress/route.ts:63-80`, `starred/route.ts:124-141`. |
| `SEC-004` | P1 | **REOPENED (#63) -> VERIFIED (#76)** | `BLOCKED` | `0005:1553-1554` (`REVOKE ALL ON FUNCTION public.create_exam_attempt(...) FROM PUBLIC, anon, authenticated;`); `create_exam_attempt_v2` (`0005:1821-2085`) resolves prompts/options/answers strictly inside Postgres, enforces `count(DISTINCT q.id)` (`0005:1895`), and authorizes every `p_sources` `study_set_id`/`folder_id` (`0005:1971-1990`). |
| `SEC-005` | P1 | **VERIFIED** | `BLOCKED` | `0005:295-334` (`REVOKE SELECT ON public.profiles FROM anon, authenticated`, column-level `GRANT SELECT` omitting `email`, self-only `get_my_profile()`); static scan confirmed **0** routes select `profiles.*` or `profiles.email`; `sets/[id]/members/route.ts:49` omits `email`; `can_view_profile()` (`0005:249-266`) hides blocker from blocked user while exposing only non-email fields to pending/accepted/blocker participants. |
| `SEC-006` | P1 | **VERIFIED** | `BLOCKED` | `0005:672-781` (`friendships.blocked_by`, `trg_guard_friendships_update`, `friendships_update_participant`, `friendships_delete_participant`); `friends/[id]/route.ts` enforces `blocked_by === user.id`. |
| `SEC-007` | P1 | **VERIFIED** | `BLOCKED` | `0005:189` (`can_read_study_set`), `0005:287-290` (`study_sets_select_public_anon`), `authz.ts:133` — strictly `visibility = 'public'` only (zero `'unlisted'` blanket read). |
| `SEC-008` | P1 | **VERIFIED** | N/A | `zod` upgraded (`npm audit --omit=dev` -> **0 High/Critical**); `src/lib/security/errors.ts` `parseJsonBody()` enforces streaming byte cap (`413 PAYLOAD_TOO_LARGE`). |
| `SEC-009` | P2 | **REOPENED (#63) -> VERIFIED (#76)** | `BLOCKED` | Wave 2 initially read only legacy `request.jwt.claim.role` (fails open on PostgREST 10+/PG 15). Fixed in `#76` via `public.current_jwt_role()` (`0005:132-150`) checking `request.jwt.claim.role` -> `request.jwt.claims::jsonb->>'role'` -> `session_user`/`current_user` (`'anon'`, `'authenticated'`, `'authenticator'`), wired into all 4 RLS helpers (`0005:161,180,214,243`). |
| `SEC-010` | P2 | **VERIFIED** | N/A | `src/lib/import/zip-guard.ts:494-507,539-682` streams entries via `nodeStream`/`internalStream` enforcing 50 MB cumulative budget + 100:1 actual ratio cap mid-stream (verified with real forged Central Directory header test -> `ZIP_RATIO_BOMB_DETECTED`), and scans all `.xlsx` `.xml`/`.rels` parts for `<!DOCTYPE`/`<!ENTITY` BEFORE `ExcelJS.xlsx.load()` (verified -> `XXE_FORBIDDEN`). `docx-ooxml-parser.ts:1050-1109` passes `compressedSizes` to all streaming reads. |
| `SEC-011` | P2 | **REOPENED (#63) -> VERIFIED (#76)** | `BLOCKED` | Private `study-media` bucket + Storage RLS (`0005:855-985`, `can_access_study_media_path`, `is_strict_uuid`); server-side `POST /api/uploads/image` (`validateImageUpload()` magic bytes, SVG ban, pre-buffer `fileEntry.size > MAX_IMAGE_FILE_BYTES` 413 check at `:41-50` added in `#76`) + `GET /api/uploads/signed-url` (`requireAuth()`, `isValidStudyMediaPath()`, `Cache-Control: private, max-age=300`, `Vary: Cookie` on `?redirect=1`); UI (`question-editor-view.tsx`, `profile-view.tsx`) uses `/api/uploads/image` + durable `proxyUrl` (0 direct Storage uploads or `getPublicUrl`). |
| `SEC-012` | P2 | **VERIFIED** | `BLOCKED` | `study_set_members.allow_clone` (`0005:786`), persisted in `redeem_share_link` (`0005:3532+`), enforced in `clone_study_set` (`0005:3650+`), `authz.ts` (`canClone`), `sets/[id]/duplicate/route.ts:49-55`, and `sets/[id]/export/route.ts:73-79`. |
| `SEC-013` | P2 | **REOPENED (#63) -> VERIFIED (#76)** | `BLOCKED` | `trg_guard_profiles_update` blocks direct `email` edits + `sync_profile_email_from_auth` syncs from `auth.users` (`0005:345-410`); `handle_new_user` sanitizes `avatar_url` & caps `display_name`; all 4 URL `CHECK` constraints (`0005:464,477,490,503`) tightened from `^/` to `^/[^/\\]` in `#76` (blocking `//evil.com` and `/\evil.com` while allowing `/api/uploads/signed-url?...`). |
| `SEC-014` | P2 | **VERIFIED** | N/A | Rate limits wired on `GET /api/sets/[id]/export` (`RATE_LIMITS.EXPORT`), `POST /api/sets/[id]/members` (`FRIEND_REQUEST`), `POST /api/sets/[id]/share-links` (`SHARE_CREATE` + max 25 active cap), `POST /api/uploads/image` (`UPLOAD`), `POST /api/account/restore` (`ACCOUNT_RESTORE`), `POST /api/import/commit` (`IMPORT_COMMIT` + `NEW_IMPORT_JOB_RATE_LIMIT`). |
| `SEC-015` | P2 | **VERIFIED** | `BLOCKED` | `src/lib/supabase/middleware.ts` protects `/exams`, `/practice`, `/import`, uses `isSafeRelativeRedirect()` and copies refreshed cookies on redirects (`copyCookies`); `src/components/auth/login-form.tsx:23-35` blocks `//`, `/\`, and `\`. |
| `SEC-016` | P2 | **REOPENED (#63) -> VERIFIED (#76)** | `BLOCKED` | `submit_exam_attempt` (`0005:2492,2517`) uses `public.current_jwt_role()` for `service_role` compatibility on PG 15 + enforces `FOR UPDATE` locking and rejects `discarded` attempts; `GET /api/exams/[attemptId]` (`route.ts:201-232`) now runs `stripPreSubmitQuestions()` for BOTH `in_progress` AND `discarded` attempts (reopened `#63`, fixed `#76`); `save_exam_attempt_answers` enforces `FOR NO KEY UPDATE` and monotonic `client_seq`. |
| `SEC-017` | P3 | **VERIFIED** | N/A | `src/lib/export/index.ts:96-102` `sanitizeCsvCell()` prefixes `'` on leading `=`, `+`, `-`, `@`, `\t`, `\r` while preserving pure negative numeric literals (`-1`, `-273.15`). |
| `SEC-018` | P3 | **VERIFIED** | N/A | `src/lib/security/sanitize.ts:80-87` `sanitizePostgrestSearch()` strips `[%_,()."\\*]` and control chars across all `.or()` routes (`sets`, `questions`, `exam-presets`). |
| `SEC-019` | P3 | **DOCUMENTED** | N/A | `exceljs -> uuid@8.3.2` (2 moderate advisories, 0 High/Critical); tracked honestly as upstream limitation, zero security-token exposure. |
| `SEC-020` | P3 | **VERIFIED** | `BLOCKED` | `DELETE /api/account/data` checks every delete error, clears all user tables + purges `study-media` Storage (`avatars/<uid>`, `<uid>/*`); `supabase/config.toml` sets `secure_password_change = true`. |
| `SEC-021` | P3 | **VERIFIED** | N/A | `parseJsonBody()` enforces streaming byte cap (`1 MB` default, `11 MB` import parse, `12 MB` import commit & account restore) returning `413 PAYLOAD_TOO_LARGE`; rate-limit memory store documents single-instance boundary. |
| `SEC-022` | P3 | **VERIFIED** | N/A | `next.config.ts` gates `localhost`/`127.0.0.1`/`ws:`/`unsafe-eval` strictly to `isDev`, and emits `Strict-Transport-Security: max-age=63072000; includeSubDomains` in production. |
| `SEC-023` | P4 | **VERIFIED** | `BLOCKED` | `trg_guard_study_set_owner_fields` prevents direct `question_count` edits; `POST /api/sessions/[sessionId]/answers` (`route.ts:53-64`) verifies `question.study_set_id` belongs to session's allowed sets. |

### 9.4 Wave 3 Reopened & Re-Verified Security Defects (`#63` -> `#76`)

| # | Sev | Defect Reopened in Wave 3 (`#63`) | Verified Fix (`#76`) |
| --- | --- | --- | --- |
| 1 | **P1** | `0005:140,159,193,222,2356` read only legacy `request.jwt.claim.role` (NULL on PostgREST 10+/PG 15 -> `SEC-009` oracle bypass & `SEC-016` `service_role` breakage). | Added `public.current_jwt_role()` (`0005:132-150`) resolving `request.jwt.claim.role` -> `request.jwt.claims::jsonb->>'role'` -> `session_user`/`current_user` fallback (`'anon'`, `'authenticated'`, `'authenticator'`); wired into all 4 RLS helpers + `submit_exam_attempt()`. |
| 2 | **P2** | `0005:436,449,462,475` URL `CHECK` regex `^(https://\|/\|...)` allowed protocol-relative `//evil.com` and `/\evil.com`. | Tightened all 4 constraints (`0005:464,477,490,503`) to `^(https://\|/[^/\\]\|...)` matching `sanitize.ts`. |
| 3 | **P2** | `create_exam_attempt_v2` used `count(*)` (allowing duplicate `question_id` stuffing in direct RPC calls) and inserted `p_sources` into `exam_attempt_sources` without verifying `can_read_study_set` / `folders.owner_id`. | Switched to `count(DISTINCT q.id)` (`0005:1895`) and added full `p_sources` set/folder authorization guard (`0005:1971-1990`) raising `42501`. |
| 4 | **P2** | `study_sessions_insert_own` skipped `source_study_set_ids` checks when `study_set_id IS NOT NULL`, and `study_sessions_update_own` lacked `source_study_set_ids` / `study_set_id` readability checks. | Hardened both `study_sessions_insert_own` and `study_sessions_update_own` (`0005:1505-1546`) to enforce `can_read_study_set()` on `study_set_id` AND every element of `source_study_set_ids`. |
| 5 | **P2** | `POST /api/uploads/image` buffered `fileEntry.arrayBuffer()` before checking `fileEntry.size > MAX_IMAGE_FILE_BYTES`; `GET /api/exams/[attemptId]` only ran `stripPreSubmitQuestions()` for `status === "in_progress"` (omitting `"discarded"`). | Added pre-buffer `size === 0` (400) & `size > MAX_IMAGE_FILE_BYTES` (413) checks (`uploads/image/route.ts:41-50`), routed `"discarded"` through `stripPreSubmitQuestions()` (`exams/[attemptId]/route.ts:201-232`), and added `Vary: Cookie` + `Cache-Control: private, max-age=300` on `signed-url?redirect=1`. |

### 9.5 V2.0 New Attack Surface Audit (Tables, RPCs & 14 New API Routes)

- **6 New V2.0 Tables (`exam_presets`, `exam_preset_sources`, `exam_attempt_sources`, `coverage_cycles`, `coverage_cycle_questions`, `coverage_cycle_attempts`):**
  - All 6 have `ENABLE ROW LEVEL SECURITY`, `(SELECT auth.uid())` initPlan caching (76/76 wrapped in `0005`, 0 bare `auth.uid()`, 0 deprecated `auth.role()`), and strict `user_id = (SELECT auth.uid())` isolation.
  - All `SECURITY DEFINER` RPCs in `0005` (`resolve_deduped_study_sets`, `get_exam_eligible_pool`, `create_exam_attempt_v2`, `save_exam_attempt_answers`, `submit_exam_attempt`, `get_exam_attempt_detail`, `create_coverage_cycle`, `issue_coverage_cycle_next_exam`, `discard_coverage_cycle_active_exam`, `restart_coverage_cycle`, `get_coverage_cycle_subject_progress`, `redeem_share_link`, `clone_study_set`, `get_practice_question_pool`) enforce `SET search_path = ''`, explicit `(SELECT auth.uid())` caller checks, and `REVOKE ALL ... FROM PUBLIC`.
- **14 New V2.0 API Routes:**
  - `POST /api/exams/eligible`, `POST /api/exams/preview`: `requireAuth()`, Zod validation (`examEligibleRequestSchema`, `examPreviewRequestSchema`), `rpcGetExamEligiblePool` enforces `can_read_study_set` + `folders.owner_id`, zero question body/answer leaks.
  - `GET/POST /api/exam-presets`, `GET/PATCH/DELETE /api/exam-presets/[id]`, `POST /api/exam-presets/[id]/duplicate`: `requireAuth()`, `user_id = user.id` ownership, `verifyPresetSourcesAccess` on create/update, revocation-safe re-check on launch via `resolve_deduped_study_sets` / `create_exam_attempt_v2`.
  - `GET/POST /api/coverage-cycles`, `GET/DELETE /api/coverage-cycles/[id]`, `POST /api/coverage-cycles/[id]/{next-exam,discard-active,restart}`: `requireAuth()`, rate-limited `EXAM_START`, `FOR UPDATE` locking, fail-closed `can_read_study_set` check inside `issue_coverage_cycle_next_exam -> create_exam_attempt_v2`, zero answer key reveal on `discard-active` (`status = 'discarded'`).
  - `POST /api/practice/questions`: `requireAuth()`, `get_practice_question_pool` enforces `can_read_study_set` and folder ownership.
  - `POST /api/uploads/image`, `GET /api/uploads/signed-url`: `requireAuth()`, `RATE_LIMITS.UPLOAD`, pre-buffer 5 MB cap, magic-byte raster-only validation (SVG blocked), `isValidStudyMediaPath`, Storage RLS enforcement, `Vary: Cookie`.
  - `POST /api/account/restore`: `requireAuth()`, `RATE_LIMITS.ACCOUNT_RESTORE`, 12 MB streaming cap, `restoreAccountBackupSchema` (`nullableSafeUrlSchema` on all image fields), always generates fresh UUIDs and forces `owner_id = user.id` (zero cross-user overwrite).
- **Short-Answer Numeric Parity (`normalize_short_answer`):** `0005` uses `IF v_num = 0 THEN RETURN '0'` + `trim_scale(v_num)::text` (preserving `0`, `10`, `100`, `1.5`), matching `normalizeAnswerText()` in TypeScript (`-0` -> `"0"`, `10` -> `"10"`, `100` -> `"100"`, `1,50` -> `"1.5"`).

### 9.6 Fresh Wave 3 Automated Verification Outputs

| Check | Command | Exit Code | Result Summary |
| --- | --- | --- | --- |
| Security Unit & V2 Regression Suite | `npx vitest run tests/unit/security` | **0** | **3/3 files, 37/37 tests PASS** (`supabase-migrations-audit.test.ts` 7, `security-modules.test.ts` 12, `v2-security-regression.test.ts` 18) |
| ESLint on New Regression Suite | `npx eslint tests/unit/security/v2-security-regression.test.ts` | **0** | 0 errors, 0 warnings |
| Production Dependency Audit | `npm audit --omit=dev` | `1` | **0 Critical, 0 High**, 2 Moderate (`exceljs -> uuid@8.3.2`) |
| Full Dependency Audit | `npm audit` | `1` | **0 Critical, 0 High**, 2 Moderate (`exceljs -> uuid@8.3.2`) |
| Migrations `0001`–`0004` Integrity | `git diff --stat -- supabase/migrations/0001..0004` | **0** | Empty diff (strictly untouched) |
| Client Bundle Secret Isolation | Scan `.next/static/**/*.{js,mjs,css}` | **0** | `BUNDLE_SECRET_HITS=0` (`SUPABASE_SERVICE_ROLE_KEY`, `service_role`, `admin` absent) |
| Static XSS / Profiles Email / Storage Scan | `Select-String` across `src/**/*.{ts,tsx}` | **0** | `0` `dangerouslySetInnerHTML`, `0` `getSession()`, `0` client `supabase/admin`, `0` `.from("profiles").select("*")`, `0` `getPublicUrl` |
| Live PostgreSQL / Supabase RLS Negative Suite | Docker / Supabase CLI / `.env.local` check | **BLOCKED** | Docker Desktop stopped; `supabase` CLI absent; `.env.local` unconfigured — §7.2 runtime tests MUST be executed once a live Supabase instance is connected before public launch |


---

## 10. V2.1 Live Supabase Cloud (PostgreSQL 17.12) Runtime Security & 2-Account Negative RLS Verification (`BLK-001` RESOLVED)

> **Audit Phase:** V2.1 Live Supabase Cloud Runtime Security Verification (`StudyHub`, project ref `cuoaifyupfmkstqhcjwy`, PostgreSQL 17.12, Migrations `0001`–`0011` applied)
> **Auditor:** Agent 7 — `security-auditor`
> **Live Test Suite:** `tests/integration/live-rls-security.test.ts` (cleanly skips when `.env.local` is absent so offline `npm run test` stays green; runs live against Supabase Cloud + dedicated `http://127.0.0.1:3015` production server when configured)
> **Secret Hygiene:** Zero `.env.local` keys, secrets, or JWTs printed, logged, or committed; migrations `0001`–`0004` untouched.

### 10.1 Executive V2.1 Live Runtime Verdict

**`BLK-001` IS FULLY UNBLOCKED AND ALL §7.2 LIVE RUNTIME SECURITY GATES PASSED 100% ON LIVE SUPABASE CLOUD PG 17.12!**

- **Live 2-Account Negative PostgREST, Storage RLS, RPC Lockdown & Live HTTP API Suite (`tests/integration/live-rls-security.test.ts` on `http://127.0.0.1:3015`):** **11 / 11 PASSED (`26.17s`, `EXIT=0`)**.
- **Security Unit & SQL Structural Suite (`tests/unit/security`):** **3 / 3 files, 38 / 38 PASSED (`4.16s`, `EXIT=0`)**.
- **ESLint & TypeScript Gate:** `npx eslint tests/integration/live-rls-security.test.ts tests/unit/security/v2-security-regression.test.ts` (**0 errors, 0 warnings**), `npx tsc --noEmit` (**0 errors**).
- **Live Teardown & Port Hygiene:** `REMAINING_SEC_USERS=0`, `AVATARS_FOLDERS_COUNT=0`, `PORT_3015_FREE=True`.

### 10.2 Real Live PostgreSQL 17.12 P0 Bugs Caught & Fixed During V2.1 Live Security Execution

Executing adversarial 2-account live tests against real PostgreSQL 17.12 uncovered **4 critical runtime defects** that static SQL analysis could not catch (all fixed via Migrations `0007`–`0011` and re-verified live):

| Live Bug | Migration Applied | Root Cause Found Live on PG 17.12 | Live Re-Verification Result |
| --- | --- | --- | --- |
| **`42P17` `folders` Self-Recursion** (caught by `security-auditor`, `#96`) | `0007_v2_1_fix_folders_rls_recursion.sql` | `folders_insert_own` / `folders_update_own` ran `SELECT 1 FROM public.folders` inside a policy ON `public.folders`, crashing every `INSERT`/`UPDATE` even with `parent_id = NULL`. | **PASS LIVE:** `public.is_folder_owner()` (`SECURITY DEFINER`, `SET search_path = ''`, `current_jwt_role()`, `REVOKE FROM PUBLIC, anon`) allows root + nested folders for User A, rejects cross-user `parent_id` for User B, returns `false` on cross-user oracle probe, and denies `anon` (`42501`). |
| **`42501` `study_sets` `INSERT ... RETURNING *`** (caught by `db-backend-auditor`, `#97`, reproduced by `security-auditor`) | `0008_v2_1_fix_study_sets_insert_returning_rls.sql` | `study_sets_select_readable` delegated to `STABLE` `can_read_study_set()` which read pre-statement snapshot during `INSERT ... RETURNING *`. | **PASS LIVE:** Direct `owner_id = (SELECT auth.uid())` short-circuit passes `POST /api/sets` while keeping `'unlisted'` 0-row protected from `anon` and User B. |
| **`42P17` `tags` ↔ `question_tags` Mutual Recursion** (caught by `v2-db-backend-builder` `#100` & `perf-import-auditor` `#101`) | `0009_v2_1_fix_tags_rls_recursion.sql` | 2-hop cycle between `question_tags_insert_editable` and `tags_select_readable_via_sets`. | **PASS LIVE:** User A creates & links tags cleanly; User B reads 0 rows of User A's private tags, gets `false` on `can_read_tag(tagA, userA)` oracle, and `anon` gets `42501`. |
| **`P0001` `trg_prevent_exam_snapshot_update` Breaking ALL Deletes After Any Exam** (caught by `perf-import-auditor` `#107` & `security-auditor` `#108`) | `0011_v2_1_allow_fk_set_null_on_exam_snapshot.sql` | `prevent_exam_snapshot_update()` unconditionally blocked PostgreSQL FK `ON DELETE SET NULL` updates on `exam_attempt_questions.{question_id, source_study_set_id}`, crashing `DELETE` of any tested question, set, or user account (`500 Database error deleting user`). | **PASS LIVE:** Pre-`0011` accounts deleted immediately (`PRE_0011_ACCOUNTS_DELETED=2`); `afterAll` `deleteUser` succeeded cleanly (`REMAINING_SEC_USERS=0`); even `admin`/`service_role` attempting `UPDATE exam_attempt_questions SET prompt_snapshot = 'Tampered'` is STILL rejected! |

*(Plus `0006_v2_1_supabase_cloud_hardening.sql` revoked Supabase Cloud default `anon` EXECUTE grants on all 27 trigger/internal/auth-only `SECURITY DEFINER` functions and moved `pg_trgm` to `extensions`; `0010` fixed `clone_study_set` PG 17 `42803`.)*

### 10.3 Complete Live 2-Account Runtime Verification Matrix (`tests/integration/live-rls-security.test.ts`)

| # | Live Security Scenario | Findings Verified LIVE | Runtime Verdict | Exact Live PG 17.12 / HTTP Evidence |
| --- | --- | --- | --- | --- |
| 1 | Editor-to-Owner Hijack & Field Tampering | `SEC-001` (`SH-001`), `SEC-023` | **PASS (LIVE)** | Editor B `UPDATE study_sets` changing `owner_id`, `visibility`, `is_archived`, `is_favorite`, `question_count` all rejected; owner `question_count` edit rejected; legitimate editor `description` edit succeeds (`789ms`). |
| 2 | Friendships State Machine & Block Bypass | `SEC-002` (`SH-002`), `SEC-006` | **PASS (LIVE)** | Requester A self-accept & participant-swap rejected; Addressee B accept succeeds; A blocks B (`blocked_by = A`); blocked User B `UPDATE`/`hijack`/`DELETE` all fail (`0` rows); blocker A cleans up cleanly (`1,341ms`). |
| 3 | Cross-Tenant Composite FK Injection | `SEC-003` (`SH-012`) | **PASS (LIVE)** | User B inserting `(setB, questionAPrivate)` into `question_options`, `question_accepted_answers`, `starred_questions`, `user_question_progress` all fail with PostgreSQL **`23503`** (`411ms`). |
| 4 | Revoked V1 Exam RPC, Column Anti-Leak, Score Tampering, Server Grading & `0011` Immutability | `SEC-004` (`SH-013`), `SEC-016`, `0011` | **PASS (LIVE)** | V1 `create_exam_attempt()` denied; duplicate `question_id` & unauthorized `p_sources` denied; pre-submit `create_exam_attempt_v2` & `get_exam_attempt_detail` emit 0 answer keys; direct PostgREST `SELECT correct_option_ids, accepted_answers_snapshot, explanation_snapshot` denied with **`42501`**; direct `UPDATE exam_attempts SET score_percent=100` blocked (`0` rows); User B `get_exam_attempt_detail` returns `null`, `save`/`submit` fail; numeric `"0"` graded `2/2 = 100%`; double-submit idempotent (no double SM-2 increment); `admin` snapshot text tamper rejected (`1,879ms`). |
| 5 | `profiles.email` Column Revocation, `get_my_profile()` & URL `CHECK`s | `SEC-005` (`SH-014`), `SEC-013` | **PASS (LIVE)** | Collaborator B `SELECT email` and `SELECT *` on `profiles` denied with **`42501`**; safe non-email projection succeeds; `get_my_profile()` returns caller's own email only; direct `email` edit & `javascript:`/`//`/`/\` `avatar_url` rejected (`868ms`). |
| 6 | `'unlisted'` Enumeration, `SEC-009` PG 17 Oracle Guard, `0007` Folders & `0009` Tags | `SEC-007` (`SH-015`), `SEC-009`, `0007`, `0009` | **PASS (LIVE)** | `anon` & User B get `0` rows on User A's `'unlisted'` set; User B calling `can_read_study_set`, `is_study_set_owner`, `can_edit_study_set`, `can_view_profile`, `is_folder_owner`, `can_read_tag` with User A's UUID ALL return **`false`** live on PG 17.12 (`public.current_jwt_role()` verified!); nested folder & tag linking work; `anon` denied (`42501`) on `is_folder_owner` & `can_read_tag` (`1,849ms`). |
| 7 | Private `study-media` Storage RLS & SVG Rejection | `SEC-011` (`SH-019`) | **PASS (LIVE)** | User A uploads valid PNG to own avatar & private set; bucket rejects `image/svg+xml`; User B & `anon` denied download, signed URL, and cross-user upload into User A's prefixes (`2,278ms`). |
| 8 | `allow_clone = false`, Share Link Revocation & Post-Revocation Preset Safety | `SEC-012` (`SH-020`) | **PASS (LIVE)** | Redeeming `allow_clone=false` link blocks `clone_study_set()` with **`42501`**; revoking link returns `error_code: "REVOKED"`; after removing membership, User B's saved preset `get_exam_eligible_pool` returns `total_eligible: 0` (`1,071ms`). |
| 9 | Full Cross-Account Isolation (11 Tables) & Multi-Subject `study_sessions` RLS | V2.0 RLS | **PASS (LIVE)** | User B queries 0 rows of User A's `folders`, `user_question_progress`, `starred_questions`, `study_sessions`, `exam_attempts`, `exam_attempt_sources`, `exam_presets`, `exam_preset_sources`, `coverage_cycles`, `coverage_cycle_questions`, `coverage_cycle_attempts`; attaching User A's private set in `study_sessions.source_study_set_ids` denied with **`42501`**; `get_coverage_cycle_subject_progress` returns `0` rows (`563ms`). |
| 10 | Migration `0006` `anon` RPC Lockdown (16 RPCs) | `0006` Security Advisor | **PASS (LIVE)** | All 16 revoked `SECURITY DEFINER` RPCs called by `anon` fail strictly with PostgreSQL **`42501`** (`190ms`). |
| 11 | Live HTTP API Security on Production Server (`http://127.0.0.1:3015`) | `SEC-005`, `SEC-011`, `SEC-012`, `SEC-015`, `SEC-016`, `SEC-022` | **PASS (LIVE)** | Unauthenticated APIs return `401`; `/dashboard` returns `307 -> /login` (no `setup=1`); `/auth/callback` & `/auth/confirm` reject `//` & `/\` open redirects; `/` emits prod CSP (no `localhost`/`127.0.0.1`/`unsafe-eval`), HSTS `max-age=63072000`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`; `POST /api/uploads/image` accepts real PNG (`201` + `proxyUrl`), rejects SVG & spoofed SVG-as-PNG (`415`), rejects >5 MB (`413`), rejects cross-user set upload (`403`); `GET /api/uploads/signed-url?redirect=1` returns `302` + `Cache-Control: private, max-age=300` + `Vary: Cookie` for User A, `404` for User B, `400` for path traversal; `GET /api/sets/[id]/members` emits zero `email`; `allow_clone=false` returns `403` on `/duplicate` & `/export` and `410` after revoke; `POST /api/exams` emits zero pre-submit answer keys & `404` for User B; `/api/account/data` -> `/api/account/restore` round-trips cleanly; `POST /auth/signout` returns `200` (`10,140ms`). |

### 10.4 Remaining Accepted / Non-Blocking Security Notes
- **`SEC-019` (Moderate Upstream Transitive Advisory):** `exceljs@4.4.0 -> uuid@8.3.2` (`GHSA-w5hq-g745-h8pq`) remains documented with **0 Critical / 0 High** advisories (`npm audit --omit=dev`). StudyHub exclusively uses `node:crypto` for all cryptographic tokens and IDs.
- **No Unresolved P0, P1, or P2 Security Findings Remain** across static code, SQL migrations `0001`–`0011`, client bundles, OR live PostgreSQL 17.12 / Supabase Cloud / HTTP API runtime verification.
