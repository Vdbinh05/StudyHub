# StudyHub V1.0 — Security Architecture & Threat Model

> **Security Posture:** Defense-in-Depth. Never rely on UI hiding alone. Every sensitive guarantee (data isolation, exam integrity, upload safety, sharing authorization) is enforced BOTH at the **PostgreSQL RLS / RPC layer** AND at the **Next.js Server Route Handler layer**.

---

## 1. Threat Model & Trust Boundaries

| Asset / Surface | Primary Threats | Enforced Controls |
| --- | --- | --- |
| **User Study Sets & Folders** | IDOR (accessing another user's private set by UUID), unauthorized editing by a `viewer` | PostgreSQL RLS (`can_read_study_set`, `can_edit_study_set`, `is_study_set_owner`) + server-side `supabase.auth.getUser()` verification. |
| **Active Mock Exams** | Cheating via DevTools/network inspection, client-side timer tampering, score forgery, double-submit inflation | Pre-submit answer stripping, column-level `REVOKE`, server-clock `expires_at`, server-only atomic & idempotent `submit_exam_attempt()` RPC. |
| **File Import Engine (`.docx`, `.xlsx`, `.csv`, `.json`)** | ZIP/decompression bombs, XXE XML injection, macro payloads (`.docm`/`.xlsm`), MIME spoofing, ReDoS, stored XSS in imported text | Magic-byte inspection, strict size/entry/uncompressed/ratio caps, XXE disabled, React text rendering only, linear-time regexes. |
| **User Avatars & Question Media** | Stored XSS via SVG, path traversal, unauthorized overwrite of another user's files | Raster-only MIME + magic-byte whitelist (`png`/`jpeg`/`webp`/`gif`), 5 MB cap, UUID filenames, Storage RLS scoped to `{owner_id}/{set_id}/`. |
| **Share Links & Friendships** | Token brute-force, revoked/expired link reuse, bulk scraping of user emails/usernames | >= 128-bit cryptographic tokens, server-side token validation, `revoked_at` & `expires_at` checks, exact-match friend lookup RPC, rate limiting. |
| **Authentication & Secrets** | Leaking `SUPABASE_SERVICE_ROLE_KEY`, session hijacking, open redirect on `/auth/callback` | `import 'server-only'` on `admin.ts`, HttpOnly/SameSite cookies via `@supabase/ssr`, strict relative-path allowlist on `next` redirect param. |

---

## 2. Database & Authorization Isolation

1. **RLS Everywhere:** Every one of the 20 tables in `public` has `ENABLE ROW LEVEL SECURITY`. Zero tables are exposed without explicit policies (see `docs/DATABASE.md` §5).
2. **Server-Side Identity Rule:** Always authenticate API Route Handlers and Server Components via `const { data: { user } } = await supabase.auth.getUser()`. NEVER rely solely on `getSession()` on the server because cookie session payloads can be stale or unverified.
3. **Zero IDOR Policy:**
   - Every `/api/sets/[id]/*`, `/api/folders/[id]`, `/api/exams/[attemptId]/*`, `/api/sessions/[id]/*`, and `/api/friends/[id]` endpoint validates UUID format with Zod AND checks ownership/membership against the authenticated `user.id`.
   - Unauthorized requests return `401 Unauthorized` (unauthenticated) or `403 Forbidden` / `404 Not Found` (avoiding existence leaks for private resources).
4. **Role Escalation Prevention:**
   - Only the `study_sets.owner_id` may add/remove `study_set_members`, modify `visibility`, create/revoke `study_set_share_links`, or delete the study set.
   - Collaborators with `role = 'editor'` can add/edit/delete questions and import into the set, but cannot delete the set or alter ownership/members.
   - Collaborators with `role = 'viewer'` are strictly read-only on questions (they can still study, take exams, star questions, and track their own `user_question_progress`).

---

## 3. Exam Integrity Controls (Non-Negotiable)

1. **Zero Answer Leakage Pre-Submit:**
   - During `POST /api/exams` and `GET /api/exams/[attemptId]` while `status === 'in_progress'`, the JSON response MUST ONLY contain:
     - `attempt` metadata (`id`, `status`, `total_questions`, `started_at`, `duration_limit_seconds`, `expires_at`, `server_now`, `remaining_seconds`)
     - `questions`: `{ id, attempt_id, position, question_type, chapter_snapshot, prompt_snapshot, prompt_image_url_snapshot, options_snapshot }` where every option in `options_snapshot` contains ONLY `{ id, label, content, image_url, position }` — **NEVER `is_correct`**.
     - `answers`: user's saved `{ attempt_question_id, selected_option_ids, typed_answer, is_flagged }`.
   - `correct_option_ids`, `accepted_answers_snapshot`, and `explanation_snapshot` are strictly omitted from pre-submit responses AND revoked from direct `authenticated` role PostgREST `SELECT` on `exam_attempt_questions`.
2. **Server-Enforced Timer (`expires_at`):**
   - `started_at` and `expires_at = started_at + duration_limit_seconds` are set using PostgreSQL `now()`, never client timestamps.
   - `PUT /api/exams/[attemptId]/answer` rejects saves with `409 Conflict` once `now() > expires_at`.
3. **Immutable Snapshots:**
   - `exam_attempt_questions` rows cannot be updated (blocked by trigger `trg_prevent_exam_snapshot_update`). Editing the source question bank later never alters historical attempts.
4. **Server-Only Atomic & Idempotent Scoring:**
   - Clients CANNOT write `score_percent`, `correct_count`, `wrong_count`, `unanswered_count`, `passed`, or `exam_attempt_answers.is_correct`.
   - `POST /api/exams/[attemptId]/submit` invokes `submit_exam_attempt(attempt_id)` with `FOR UPDATE` row locking: calling submit twice concurrently or sequentially produces the exact same graded result without double-counting `user_question_progress`.

---

## 4. Upload, Parsing & Media Security (`src/lib/security/upload.ts`)

### 4.1 Import File Validation Pipeline
Every uploaded file to `/api/import/parse` MUST pass all checks in order before any parser runs:
1. **Extension Allowlist:** `.docx`, `.xlsx`, `.csv`, `.tsv`, `.txt`, `.json` ONLY. Explicitly reject `.docm`, `.xlsm`, `.doc`, `.xls`, `.exe`, `.html`, `.svg`, `.zip`.
2. **Size Limit:** Reject payloads `> 15 MB` (`15 * 1024 * 1024` bytes) with `413 Payload Too Large`.
3. **Magic Byte Verification:**
   - `.docx` / `.xlsx`: first 4 bytes MUST equal `50 4B 03 04` (`PK\x03\x04`).
   - `.txt` / `.csv` / `.tsv` / `.json`: reject binary null bytes (`0x00`) and verify valid UTF-8 decoding.
4. **ZIP / OOXML Archive Bomb Guard (via `jszip` metadata inspection BEFORE decompressing):**
   - Reject encrypted archives or macro files (`vbaProject.bin`).
   - Reject if entry count exceeds `500` (hard ceiling `2,000` if excess entries are verified `word/media/*` images).
   - Inspect each entry's uncompressed size & stream-count decompressed bytes; abort immediately if cumulative uncompressed bytes exceed **`50 MB`** (`50 * 1024 * 1024`).
   - Abort if any entry's compression ratio (`uncompressed / max(compressed, 1)`) exceeds **`100:1`** (for entries > 64 KB).
   - Reject ZIP Slip paths (`..` or absolute paths inside archive).
5. **XML Safety (`fast-xml-parser`):**
   - `processEntities: false`, `allowBooleanAttributes: true`, no external entity loading, no network requests triggered during parsing.
6. **Filename Sanitization:** Strip directory separators, null bytes, and control characters before saving `import_jobs.file_name`.

### 4.2 Image Upload Validation
- Allowed MIME + Magic Bytes:
  - PNG: `89 50 4E 47 0D 0A 1A 0A`
  - JPEG: `FF D8 FF`
  - WebP: `52 49 46 46 ... 57 45 42 50`
  - GIF: `47 49 46 38`
- **STRICTLY REJECT `image/svg+xml`** (prevents embedded `<script>` XSS).
- Max size: `5 MB`. Stored under random UUID filename in Supabase Storage bucket `study-media`.

---

## 5. XSS, SQLi, CSRF & HTTP Security Headers

1. **Anti-XSS:**
   - All user/imported strings (prompts, options, explanations, folder names, bios) are rendered strictly via React JSX text nodes.
   - `dangerouslySetInnerHTML` is FORBIDDEN across all user content.
   - Any stored/rendered URL (`avatar_url`, `prompt_image_url`, `image_url`) MUST pass `isSafeHttpOrStorageUrl()` allowing only `https://`, relative `/` paths, or validated Supabase Storage URLs (explicitly rejecting `javascript:`, `data:`, `vbscript:`).
2. **Anti-SQLi:**
   - All queries use Supabase PostgREST parameterized query builders or parameterized PostgreSQL RPC arguments. Zero raw string SQL concatenation.
3. **Open Redirect Prevention:**
   - `/auth/callback` validates the `next` query parameter so it MUST start with `/` and MUST NOT start with `//` or contain a protocol scheme.
4. **Security Headers (`next.config.ts`):**
   - `X-Content-Type-Options: nosniff`
   - `X-Frame-Options: DENY`
   - `Referrer-Policy: strict-origin-when-cross-origin`
   - `Permissions-Policy: camera=(), microphone=(), geolocation=()`
   - Strict `Content-Security-Policy` (allowing self, Supabase URL, Google Fonts if needed, disallowing inline eval/object embeds).

---

## 6. Deterministic Rate Limiting (`src/lib/security/rate-limit.ts`)

Sliding-window in-memory / Edge-safe rate limiter keyed by `user.id` (or hashed IP for public routes), returning `429 Too Many Requests` with `Retry-After` header:

| Endpoint Category | Limit | Window |
| --- | --- | --- |
| `/api/import/parse` | 15 requests | 5 minutes |
| `/api/import/commit` | 20 requests | 5 minutes |
| `/api/share-links/[token]/redeem` | 20 requests | 15 minutes |
| `POST /api/friends` (friend requests) | 20 requests | 15 minutes |
| `POST /api/exams` (exam start) | 30 requests | 15 minutes |
| `POST /api/sets/[id]/clone` | 15 requests | 15 minutes |
