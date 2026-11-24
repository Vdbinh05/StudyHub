# StudyHub V3.0 — Independent Baseline Audit & Constraints Report (`BASELINE.md`)

> **Auditor:** Agent 6 (`db-backend-auditor`) — strictly read-only inspection of the committed V2.1 baseline
> **Baseline Git Checkpoint:** Commit `0698734` (`release(v2.1): live Supabase Cloud verification, migrations 0006-0012, modern keys & UX-12`), Tag `v2.1-verified`
> **Live Cloud Reference:** Supabase Cloud `StudyHub` (`cuoaifyupfmkstqhcjwy`), PostgreSQL `17.12` (zero secrets read or printed; zero destructive DB operations run)
> **Purpose:** Establish verified pre-V3.0 build/test/security baselines and document every V2.1 schema, storage, validation, trigger, RLS, dependency, and Supabase Free-Tier constraint that V3.0 (`0013`–`0015`, multimedia/diagrams/rich-text/12 question types/PWA offline sync) must address safely without breaking V1.0–V2.1 data or workflows.

---

## 1. Verified V2.1 Git Checkpoint & Codebase Inventory

### 1.1 Git Commit & Tag State

```text
0698734 release(v2.1): live Supabase Cloud verification, migrations 0006-0012, modern keys & UX-12   [tag: v2.1-verified]
9667819 feat: StudyHub V2.0 — custom multi-subject exams, Full Coverage, real-file import, security & WCAG AA fixes
f09a8ed chore: StudyHub V1.0 baseline checkpoint before V2.0 audit
```

- Working tree status at baseline inspection: clean (`git status --short` empty).
- Immutable migrations (`0001`–`0012`, **MUST NOT be modified in V3.0**):

| Migration File | Size (Bytes) | Scope |
| --- | ---: | --- |
| `0001_initial_schema.sql` | 23,513 | 20 V1.0 tables & core indexes |
| `0002_rls_policies.sql` | 24,065 | V1.0 RLS helpers & policies across 20 tables |
| `0003_functions_and_triggers.sql` | 28,707 | V1.0 triggers, exam RPCs, share-link RPCs |
| `0004_storage_and_buckets.sql` | 3,929 | Private `study-media` bucket (5 MB, raster-only) & Storage RLS |
| `0005_v2_custom_exams_and_coverage.sql` | 137,152 | 6 V2.0 tables (`exam_presets`, `exam_preset_sources`, `exam_attempt_sources`, `coverage_cycles`, `coverage_cycle_questions`, `coverage_cycle_attempts`), V2.0 RPCs, security/scale hardening |
| `0006_v2_1_supabase_cloud_hardening.sql` | 8,630 | Move `pg_trgm` to `extensions`, revoke default Cloud `anon` EXECUTE grants on 27 functions, 6 composite FK indexes |
| `0007_v2_1_fix_folders_rls_recursion.sql` | 1,937 | `public.is_folder_owner()` fixing `42P17` self-recursion on `folders` |
| `0008_v2_1_fix_study_sets_insert_returning_rls.sql` | 1,525 | Short-circuit `owner_id = (SELECT auth.uid())` in `study_sets_select_readable` fixing `42501` on `INSERT ... RETURNING *` |
| `0009_v2_1_fix_tags_rls_recursion.sql` | 1,818 | `public.can_read_tag()` breaking `question_tags` ↔ `tags` `42P17` cycle |
| `0010_v2_1_fix_clone_study_set_window.sql` | 6,186 | Ranked subquery in `clone_study_set()` fixing PG 17 `42803` window-in-aggregate |
| `0011_v2_1_allow_fk_set_null_on_exam_snapshot.sql` | 3,216 | Permit FK `ON DELETE SET NULL` on `exam_attempt_questions.{question_id,source_study_set_id}` while keeping 14 snapshot columns immutable |
| `0012_v2_1_fix_coverage_delete_cascade.sql` | 2,902 | Guard `release_coverage_cycle_on_attempt_delete()` during cascading account deletion (`23503`) |
| **Total (12 migrations)** | **243,580** | **26 public tables**, **88 unique indexes** |

### 1.2 Surface Area & Dependency Snapshot

- **Public PostgreSQL Tables:** `26` (20 V1.0 + 6 V2.0; 26/26 RLS enabled)
- **Unique Indexes (`0001`–`0012`):** `88` (0 duplicates; 0 unindexed FKs)
- **Next.js API Route Handlers (`src/app/api/**/route.ts`):** `53`
- **Next.js App Router Pages (`src/app/**/page.tsx`):** `35`
- **Runtime Dependencies (`package.json`):** `26` (Next.js `16.4.6`, React `19.3.1`, `@supabase/supabase-js ^2.100.0`, `@supabase/ssr ^0.9.0`, `@tanstack/react-query ^5.90.0`, `@tanstack/react-virtual ^3.13.0`, `motion ^12.34.0`, `zod ^4.6.7`, `exceljs ^4.4.0`, `fast-xml-parser ^5.0.0`, `jszip ^3.10.1`, `mammoth ^1.9.0`, `papaparse ^5.5.3`, `recharts ^3.7.0`, `lucide-react ^0.577.0`, etc.)
- **Dev Dependencies (`package.json`):** `18` (`vitest ^5.1.1`, `@playwright/test ^1.58.0`, `typescript ^5.9.0`, `eslint ^9.39.0`, etc.)
- **Non-Negotiable Compliance:** **0 AI SDKs/endpoints**, **0 payment/billing SDKs**, **0 mock/fake auth fallbacks**.

---

## 2. Fresh Pre-V3.0 Verification Gate Measurements

Executed directly against commit `0698734` (`v2.1-verified`) before any V3.0 edits:

| Gate Command | Exit Code | Measured Result |
| --- | ---: | --- |
| `npm run typecheck` (`tsc --noEmit`) | `0` | **PASS** — `0` TypeScript errors |
| `npm run lint` (`eslint .`) | `0` | **PASS** — `0` errors, `0` warnings |
| `npx vitest run tests/unit` | `0` | **PASS** — **20/20 test files, 132/132 unit tests** in `9.47s` (includes 10,000-Q deterministic import stress benchmark in `320ms` & 18 V2 security regression tests + 8 migration audit tests) |
| `npm audit --omit=dev` | `1` | **0 Critical, 0 High, 2 Moderate** — single transitive chain: `exceljs@4.4.0 -> uuid <11.1.1` (`GHSA-w5hq-g745-h8pq`, `SH-044`) |

### 2.1 Existing Dependency Advisory (`SH-044`)

- **Advisory:** `GHSA-w5hq-g745-h8pq` (Moderate) — `uuid <11.1.1`: missing buffer bounds check in `v3`/`v5`/`v6` when `buf` is provided.
- **Chain:** `exceljs >=3.5.0` -> `node_modules/uuid`.
- **Remediation Constraint:** `npm audit fix --force` proposes a breaking downgrade to `exceljs@3.4.0` (must **NOT** be run). StudyHub generates all UUIDs and security tokens exclusively via `node:crypto` (`randomUUID()`, `randomBytes()`), never calling `uuid` v3/v5/v6 buffer APIs.
- **V3.0 Rule:** All newly installed V3.0 packages (`katex`, `idb`, `pdf-lib`, `@pdf-lib/fontkit`, `pdfjs-dist`, `@tiptap/*`, `fake-indexeddb`) MUST keep `npm audit --omit=dev` at **0 Critical, 0 High** (zero net new High/Critical advisories).

---

## 3. V2.1 Schema, Storage, Trigger & Validation Constraints Impacting V3.0

Every concrete constraint below was verified line-by-line in `supabase/migrations/0001`–`0012`, `supabase/config.toml`, `src/lib/security/upload.ts`, and `src/lib/validation/*`:

| ID | Table / Layer | Exact V2.1 Constraint & Location | Impact on V3.0 | Required Additive V3.0 Change (`0013`–`0015` + App) |
| --- | --- | --- | --- | --- |
| `C-01` | `public.questions` | `question_type CHECK (question_type IN ('single_choice', 'multiple_choice', 'true_false', 'flashcard', 'short_answer'))` (`0001:111-113`); `prompt text NOT NULL CHECK (char_length(trim(prompt)) >= 1)` (`0001:116`); `validation/questions.ts:29` `prompt: z.string().trim().min(1)` | **Blocks 8 new V3.0 question types** (`fill_in_blank`, `numerical`, `image_choice`, `ordering`, `matching`, `image_hotspot`, `reading_passage`, `listening`) AND **hard-blocks image-only / audio-only questions** with empty `prompt`. Also lacks `prompt_rich`, `explanation_rich`, `payload` JSONB, `passage_id`, `diagram_id`, and multi-attachment support. | Widen `question_type` CHECK to all 13 types; replace `prompt` non-empty CHECK so `prompt` may be `''` when `prompt_image_url IS NOT NULL OR prompt_rich IS NOT NULL OR payload <> '{}'::jsonb OR diagram_id IS NOT NULL` (or media relation exists); add additive `prompt_rich`, `explanation_rich`, `payload`, `passage_id`, `diagram_id`, `content_version` columns; relax Zod `prompt` check conditionally when media/diagram/audio is attached. |
| `C-02` | `public.question_options` | DB: `content text NOT NULL` has **no** `char_length >= 1` CHECK (`0001:137`) — DB already accepts `''`. **App blocker:** `validation/questions.ts:14` enforces `content: z.string().trim().min(1)` and `import/commit/route.ts:85` caps `options.max(8)` (`validation/questions.ts:37` caps `.max(10)`). | **Zod blocks image-only answer options** (`image_choice` or image-only options in MC). No `content_rich` JSONB or `media_asset_id` FK. | Add additive `content_rich jsonb` and `media_asset_id uuid REFERENCES public.media_assets(id) ON DELETE SET NULL`, plus DB `CHECK (char_length(trim(content)) >= 1 OR image_url IS NOT NULL OR media_asset_id IS NOT NULL)`. Update Zod `questionOptionInputSchema` to allow empty `content` when `image_url` or `media_asset_id` is supplied. |
| `C-03` | `storage.buckets` (`study-media`) & `src/lib/security/upload.ts` | `0004:9-20`: `public = false`, `file_size_limit = 5242880` (5 MB), `allowed_mime_types = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']`. `supabase/config.toml:30`: `file_size_limit = "5MiB"`. `upload.ts:13-20`: `ALLOWED_IMPORT_EXTENSIONS` omits `.pdf`; zero audio magic-byte validation. `0005:858-961`: `can_access_study_media_path()` checks ONLY live `can_read_study_set(set_id, uid)`. | **Blocks all V3.0 audio uploads** (MP3/WAV/M4A/AAC/WebM/OGG >5 MB up to 10 MB), **blocks `.pdf` import validation**, lacks media deduplication/orphan tracking, and **breaks historical exam review media** if a shared user loses access to the source study set or the source set is deleted! | Upgrade `study-media` bucket in `0013` to `file_size_limit = 10485760` (10 MB) and allow raster images + browser-compatible audio MIMEs (strictly keeping `public = false` and **zero SVG/HTML**). Add `media_assets` (with owner `sha256_hash` dedup) and `content_media_relations` (`ON DELETE RESTRICT` on `media_id` for exam snapshots!). Extend `can_access_study_media_path()` to also permit `SELECT` when the caller owns an `exam_attempts` row referencing that media asset. Add `.pdf` + audio magic-byte validators and sync `supabase/config.toml` (`10MiB`). |
| `C-04` | `public.study_sessions` | `mode CHECK (mode IN ('flashcards', 'learn', 'practice', 'write', 'match', 'review'))` (`0001:221`); `validation/common.ts:61-68`. | **Blocks V3.0 Spell, Diagram, and Custom Practice session persistence.** Also has no mid-session resumable checkpoint state. | Widen `study_sessions.mode` CHECK in `0013` (and `studyModeSchema`) to add `'spell'`, `'diagram'`, `'custom_practice'`. Add `learning_session_checkpoints` table in `0014` (`user_id = (SELECT auth.uid())`). |
| `C-05` | `public.exam_attempt_questions`, `exam_attempt_answers` & `prevent_exam_snapshot_update()` | `exam_attempt_questions.question_type CHECK` allows only 4 types (`0001:284`). Column-level `REVOKE`/`GRANT` hides `correct_option_ids`, `accepted_answers_snapshot`, `explanation_snapshot` (`0002`, `0005:1201-1205`). `prevent_exam_snapshot_update()` (`0011:21-58`) explicitly compares all **14 existing snapshot columns** while permitting FK `ON DELETE SET NULL` ONLY on `question_id` and `source_study_set_id`. `exam_attempt_answers` has only `selected_option_ids` & `typed_answer`. | **Blocks V3.0 exam question types, rich/media/passage/diagram snapshots, structured responses, and confidence capture.** If `0013` adds new snapshot columns without updating `prevent_exam_snapshot_update()`, those new columns would NOT be frozen by the trigger (or new nullable source FKs would break on parent delete!). Any new non-secret snapshot column MUST get explicit `GRANT SELECT (...) TO authenticated`; any new answer-key/target column MUST stay revoked! | Widen `exam_attempt_questions.question_type` CHECK; add additive snapshot columns with strict column-level `GRANT` separation (public prompt/media/passage/diagram/options vs revoked grading keys/targets/rich explanations); `CREATE OR REPLACE` `prevent_exam_snapshot_update()` to freeze every V3 snapshot column while keeping `ON DELETE SET NULL` intact; add `structured_response jsonb` + `confidence text` to `exam_attempt_answers` (confidence MUST NEVER influence exam score!). |
| `C-06` | `public.import_jobs` | `source_format CHECK` allows only 9 formats (`0001:335-347`); `app/api/import/commit/route.ts:113-125` mirrors the 9-value enum. | **Blocks auditing of V3.0 PDF text-layer imports (`pdf_text`) and multimedia DOCX imports (`docx_multimedia`).** | Widen `import_jobs.source_format` CHECK in `0013` (and Zod/TS `ImportFormat`) to include `'pdf_text'` and `'docx_multimedia'`. |
| `C-07` | `public.user_question_progress`, `study_session_answers`, `user_preferences`, `study_sets` | `user_question_progress` lacks confidence/mistake-lifecycle metrics and a monotonic `progress_generation` counter. `study_session_answers` lacks `structured_response` & `confidence`. `user_preferences` lacks `confidence_enabled`, `mode_preferences`, `progress_generation`. `study_sets` lacks `content_version` for offline update detection. | **Cannot track V3.0 confidence analytics, scoped progress resets without offline resurrection, or incremental offline download updates.** | Add additive columns in `0013` + `user_question_notes`, `question_reports`, `learning_session_checkpoints`, `learning_confidence_events`, `learning_sync_events` in `0014` + `reset_learning_progress()`, `global_library_search()`, `sync_offline_learning_events()` RPCs in `0015`. |
| `C-08` | URL `CHECK` Constraints (`0005:432-477`) | `questions_prompt_image_url_safe_chk`, `questions_back_image_url_safe_chk`, `question_options_image_url_safe_chk` allow `^(https://\|/[^/\\]\|{uuid}/{uuid}/)`. | Safe for `/api/uploads/signed-url?path=...&redirect=1` proxy URLs and `{owner}/{set}/...` storage paths, **but** would reject a new storage path prefix like `media/{owner}/...` if stored raw directly in legacy URL columns. | Continue storing durable `/api/uploads/signed-url?path=...&redirect=1` proxy URLs (or `{owner_id}/{study_set_id}/...` paths) in legacy URL columns, and reference V3 media cleanly via `media_assets(id)` + `storage_path`. |

---

## 4. V2.1 Live PostgreSQL 17.12 Lessons Learned (Mandatory Rules for Migrations `0013`–`0015`)

Four live P0 issues were uncovered and fixed during V2.1 cloud verification (`0006`–`0012`). V3.0 migrations `0013`–`0015` **MUST** obey all 6 rules from day one:

1. **Zero Self- or Mutual-Recursive RLS Policies (`0007`, `0009`):** Never write `EXISTS (SELECT 1 FROM public.<same_table> ...)` or a 2-table cycle (`A policy -> B -> A`) directly inside RLS policies — PostgreSQL 17 raises `42P17` immediately even on `NULL` FK inserts. Wrap cross-table lookups in `SECURITY DEFINER` helpers with `SET search_path = ''` and `public.current_jwt_role()` anti-oracle checks.
2. **Never Rely Solely on `STABLE` Self-Table Helpers Inside `SELECT` Policies Used by `INSERT ... RETURNING *` (`0008`):** Always include direct tuple short-circuits (e.g., `owner_id = (SELECT auth.uid())` or `user_id = (SELECT auth.uid())`) in `SELECT` policies so PostgREST `.insert(...).select("*")` evaluates in-memory without querying the pre-statement MVCC snapshot (`42501`).
3. **Explicit `REVOKE ALL ... FROM PUBLIC, anon` on Every New Function (`0006`):** Supabase Cloud grants default `EXECUTE` to `anon` and `authenticated` in schema `public`; `REVOKE ALL FROM PUBLIC` alone is insufficient. Every new V3.0 `SECURITY DEFINER` function MUST explicitly execute `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon; GRANT EXECUTE ON FUNCTION ... TO authenticated;` (and revoke from `authenticated` too for trigger/internal functions).
4. **Supabase-MCP-Safe Additive DDL:** Never put destructive `DROP POLICY`, `DROP TRIGGER`, or unguarded `DELETE` without `WHERE` in `0013`–`0015`. Use `CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`, `ALTER POLICY` (or `DO $$ IF NOT EXISTS ... CREATE POLICY ... $$`), `CREATE INDEX IF NOT EXISTS`, and `DO $$ ... END $$` for constraint upgrades.
5. **Cascading Account Delete Safety (`0011`, `0012`):** Any `BEFORE DELETE` trigger that updates sibling tables MUST guard `IF EXISTS (SELECT 1 FROM public.profiles WHERE id = OLD.user_id)`, and `prevent_exam_snapshot_update()` MUST allow FK `ON DELETE SET NULL` transitions on nullable reference columns.
6. **PG 17 SQL Strictness (`0005` `W3-DB-1`, `0010`):** Never nest window functions (`row_number() OVER (...)`) inside aggregate calls (`42803`) — compute window ranks in a subquery/CTE first. Never use `\]` inside PostgreSQL ARE `[...]` bracket expressions — place `]` first inside `[...]`.

---

## 5. Supabase Free-Tier Practical Resource Budgets & V3.0 Guardrails

| Resource | Supabase Free-Tier Budget | V3.0 Risk Vector | Mandatory V3.0 Engineering Guardrail |
| --- | --- | --- | --- |
| **PostgreSQL Database** | `500 MB` storage | Storing base64 images/audio in JSONB, bloated TipTap HTML, unbounded `learning_sync_events` / `learning_confidence_events` logs, or duplicating full rich-text + media payloads unnecessarily. | **Never** store base64 data URIs in DB; store compact canonical TipTap JSON AST v1 (`<= 32 KB` per field validated in Zod); reference media by `media_assets.id` UUID; index all FKs (`unindexed_foreign_keys = 0`) without redundant duplicate indexes. |
| **Supabase Storage (`study-media`)** | `1 GB` total (50 MB max single file platform cap) | Uncompressed mobile photos (8–12 MB each), uncompressed WAV voice recordings, duplicate re-uploads across clones/imports, and orphaned objects after edits/deletes. | Enforce bucket `file_size_limit = 10485760` (10 MB) + API caps (**5 MB images**, **10 MB / 120s audio**); deduplicate per owner via `media_assets(owner_id, sha256_hash)`; provide client canvas resize/compress (with crisp diagram preservation); track references via `content_media_relations` (`ON DELETE RESTRICT` for exam snapshots; clean up unreferenced orphans). |
| **Bandwidth / Egress** | `5 GB` cached / `2–5 GB` uncached per month | Re-fetching signed URLs & large images/audio on every flashcard flip, exam navigation, or offline re-download. | Keep `Cache-Control: private, max-age=300` + `Vary: Cookie` on `/api/uploads/signed-url?redirect=1`; lazy-load `<audio>` and high-res diagrams; cache downloaded study-set media locally in account-partitioned IndexedDB `media_blobs` and skip re-downloads when `content_version` / `sha256_hash` is unchanged. |
| **PostgREST API Limits** | `max_rows = 1000` (`config.toml:9` & Cloud default); ~8–16 KB URI length limit | Multi-set offline downloads, global library search, or `media_assets` / `diagram_hotspots` fetches truncating silently above 1,000 rows or failing with HTTP `414`. | Use `POST` SQL RPCs (`global_library_search`, `sync_offline_learning_events`, `get_practice_question_pool`) and `fetchAllPages` + `chunkArray(..., 100)` across all V3.0 endpoints and offline download chunks. |
| **Compute & Connections** | Micro instance (`500 MB` RAM, shared CPU, ~60 direct / ~200 pooled conns) | Heavy unindexed `ILIKE` / JSONB full scans in global search, per-row trigger storms on bulk imports, or concurrent offline sync retries causing deadlocks. | Use `pg_trgm` GIN indexes (`extensions` schema) + bounded pagination (`LIMIT <= 50`) in `global_library_search`; keep statement-level triggers (`FOR EACH STATEMENT`); use `ON CONFLICT (event_id) DO NOTHING` idempotency + deterministic lock order in `sync_offline_learning_events`. |
| **Browser IndexedDB & PWA Quota** | Origin quota (typically 50 MB–1 GB+, stricter on iOS Safari / Private mode) | Large media/audio downloads hitting `QuotaExceededError` or leaking Account A's downloaded sets to Account B on shared devices. | Partition IndexedDB strictly by `userId` (`studyhub-offline-v3:${userId}`), call `navigator.storage.estimate()` before downloads, handle `QuotaExceededError` & private-mode failures gracefully, clear user data on logout/explicit clear, and never auto-reload SW during an active exam. |

---

## 6. Baseline Sign-Off Summary

- **Pre-V3.0 Code & Test Baseline (`0698734` / `v2.1-verified`):** **CLEAN & VERIFIED** (`typecheck` 0 errors, `lint` 0 errors/warnings, `tests/unit` 20/20 files / 132/132 tests PASS, `npm audit --omit=dev` 0 Critical / 0 High / 2 Moderate `exceljs -> uuid`).
- **Migrations `0001`–`0012`:** Verified intact and frozen as V3.0 baseline.
- **V3.0 Readiness:** All 8 V2.1 schema/storage/validation constraints (`C-01`–`C-08`), 6 PG 17.12 live lessons learned, and 6 Free-Tier resource guardrails are documented above for immediate Wave 2/3 implementation and Wave 4/5 independent verification.
