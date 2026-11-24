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

---

## 7. StudyHub V2.0–V3.0 Security Hardening Extensions (Live-Verified on PG 17.12)

StudyHub V2.0/V2.1 (`0005`–`0012`) and V3.0 (`0013`–`0016`) extend the defense-in-depth baseline across **36 RLS-enabled tables** and **70 API Route Handlers**:

1. **Modern Key & Secret Isolation (`src/lib/supabase/env.ts`, `admin.ts`):** Supports modern `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_...`) and server-only `SUPABASE_SECRET_KEY` (`sb_secret_...`) with legacy fallback; `.next/static/` verified `exactRealSecretHits = 0` and `0 B` server parser/PDF libs leaked.
2. **12-Type Pre-Submit Exam Anti-Leak & Column Revocation (`0013`, `0015`, `0016`):**
   - Direct `authenticated` PostgREST `SELECT` on `type_payload_snapshot`, `explanation_rich_snapshot`, `correct_option_ids`, `accepted_answers_snapshot`, and `explanation_snapshot` fails with PostgreSQL **`42501`**.
   - `sanitize_pre_submit_type_payload()` strips `fill_in_blank` accepted answers, `numerical` target/tolerance/unit keys, `ordering` `correct_position`, `matching` `pairs` (exposing unlinked `left_items` + `right_items`), `image_hotspot` `target_hotspots`/`geometry`, and `listening` `transcript` until `status IN ('submitted', 'expired')`.
   - `POST /api/export/pdf` reads attempt details strictly through `SECURITY DEFINER` `rpcGetExamAttemptDetail()`, blocks non-`question_paper` modes on BOTH `in_progress` and `discarded` attempts (`403`), enforces `allow_clone = false` (`403`), sets `Cache-Control: private, no-store`, and uses RFC 5987 `Content-Disposition` (`filename*=UTF-8''...`).
3. **Rich Text XSS & KaTeX Safety (`src/lib/richtext/sanitize.ts`, `katex.ts`):**
   - All TipTap JSON AST v1 payloads pass strict node/mark/URL/depth (`<=12`)/node-count (`<=1500`) sanitization on BOTH `PUT /api/notes` AND `POST /api/sync/events` (`note_upsert` `V3-SEC-04`), stripping `<script>`, `<iframe>`, `javascript:`, `data:text/html`, and `data:image/svg+xml`.
   - `dangerouslySetInnerHTML` is permitted **solely** for `renderSafeKatexHtml()` (`trust: false`, `throwOnError: false`, explicit `<script|javascript:` guard).
4. **Private Multimedia, Audio Uploads & Historical Exam Preservation (`0013`, `study-media`):**
   - `study-media` stays strictly `public = false` (`10 MB` cap, 4 raster + 9 browser-compatible audio MIMEs, zero SVG/HTML). `POST /api/uploads/image` (`<= 5 MB`) and `POST /api/uploads/audio` (`<= 10 MB`) enforce magic-byte verification (`415` on spoofed SVG/HTML) and SHA-256 owner deduplication.
   - `content_media_relations` (`ON DELETE RESTRICT`) blocks deleting exam-referenced `media_assets` (`409` / `23503`); `DELETE /api/media/[id]` restricts deletion to uploader/set-owner and checks `.select("id").maybeSingle()` BEFORE `supabase.storage.remove()` (`V3-SEC-02`); `POST /api/media` verifies caller edit authorization on target `(entity_type, entity_id)` (`V3-SEC-03`).
   - `ALTER POLICY "study_media_select"` grants historical exam owners read access to snapshot-referenced media even after source study-set share revocation, while unrelated users remain denied (`403`/`404`).
   - *(Operational note `V3-SEC-P3-01`: Next.js 16 default `10 MB` `proxyClientMaxBodySize` rejects `>10 MB` audio fail-closed as `400` with 0 bytes stored; `validateAudioUpload()` returns exact `413`.)*
5. **PDF Parser Sandboxing (`src/lib/import/pdf-parser.ts`):** `pdfjs.getDocument(...)` enforces `isEvalSupported: false`, `disableAutoFetch: true`, `useSystemFonts: false`, and `disableFontFace: true` (`V3-SEC-05`); rejects non-PDF, corrupted, encrypted, and `>15 MB` payloads with zero JS execution.
6. **Private Notes, Reports, Global Search & Offline Sync RLS (`0014`–`0016`):**
   - `user_question_notes`, `learning_session_checkpoints`, `learning_confidence_events`, and `learning_sync_events` enforce strict `user_id = (SELECT auth.uid())` isolation across PostgREST, REST APIs, and `global_library_search()` (`0` bidirectional note leakage).
   - `question_reports` permits viewer submit (`open`), prevents viewer self-resolution (`403`), allows owner/editor review & resolve, and restricts `DELETE` to reporter/set-owner.
   - `sync_offline_learning_events()` enforces per-user `event_id` idempotency (`duplicate_ignored`), cross-user `invalid` (zero oracle), stale `progress_generation` (`ignored_stale_reset` on both answers & checkpoints), and `rejected_revoked`/`rejected_deleted`.
7. **PWA Service Worker, Account-Partitioned IndexedDB & Headers (`public/sw.js`, `next.config.ts`):**
   - `public/sw.js` serves `Cache-Control: no-cache, no-store, must-revalidate`, never caches `/api/*`, `/auth/*`, `/share/*`, cross-origin Supabase traffic, `no-store` responses, or authenticated HTML, and gates `skipWaiting()` on `APPLY_UPDATE`.
   - IndexedDB is strictly partitioned by `userId` (`studyhub-offline-v3:${userId}`), with `0`-leak Account A → B switch verified live in Chromium.
   - Production headers enforce `Content-Security-Policy` (`media-src 'self' blob: https://*.supabase.co`, `worker-src 'self' blob:`, `manifest-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, no `'unsafe-eval'`), `Permissions-Policy: camera=(), microphone=(self), geolocation=()`, `Strict-Transport-Security`, `X-Frame-Options: DENY`, and `X-Content-Type-Options: nosniff`.
   - Global Search Hard Exam Guard suppresses `Ctrl+K`/`Cmd+K` during active exams.

See [`docs/audit/v3/SECURITY_AUDIT.md`](audit/v3/SECURITY_AUDIT.md) for the full 3-account live Wave 5B security audit (`22/22` live + `39/39` unit PASS, `0` open P0/P1/P2).
