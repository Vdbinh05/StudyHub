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

StudyHub V2.0/V2.1 (`0005`–`0012`) and V3.0 (`0013`–`0017`) extend the defense-in-depth baseline across **37 RLS-enabled tables** and **71 API Route Handlers**:

1. **Modern Key & Secret Isolation (`src/lib/supabase/env.ts`, `admin.ts`):** Supports modern `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_...`) and server-only `SUPABASE_SECRET_KEY` (`sb_secret_...`) with legacy fallback; `.next/static/` and deployed CDN chunks verified `0` real secret leaks and `0 B` server parser/PDF libs leaked.
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
   - *(Operational note `V3-SEC-P3-01`: Next.js 16 default `10 MB` `proxyClientMaxBodySize` rejects direct multipart `>10 MB` fail-closed; client uploads `> 3.5 MB` use the signed `study-temp` direct-upload flow documented in §8 below, where `POST /api/storage/upload-url` returns exact `413` before bytes leave the browser.)*
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

---

## 8. Production Vercel Hobby Security Hardening (`0017` — Live-Verified on `https://studyhub-three-mauve.vercel.app`)

1. **`study-temp` Private Direct-Upload Isolation & Guaranteed Cleanup (`0017`, `src/lib/supabase/temp-storage.ts`, `POST /api/storage/upload-url`):**
   - Files `> 3.5 MB` (imports up to 15 MB, backups up to 12 MB, audio up to 10 MB, raster images up to 5 MB) upload via one-time signed URLs directly from the browser into the private `study-temp` bucket under `{userId}/{purpose}/{uuid}.{ext}` (never bypassing server validation).
   - **Pre-Sign Validation (`POST /api/storage/upload-url`):** Enforces authentication (`401`), distributed rate limit (`RATE_LIMITS.STORAGE_SIGN`: `40 / 15m`), purpose-specific size ceilings (`413`), SVG/HTML/`FORBIDDEN_EXTENSIONS` rejection (`415`), and upfront `requireStudySetAccess(..., "edit")` (`403`/`404`).
   - **Cross-Account Defense-in-Depth:** Both Storage RLS (`study_temp_{select,insert,delete}_own` matching `(storage.foldername(name))[1] = (SELECT auth.uid())::text`) AND server-side `isOwnedTempStoragePath()` block cross-account reads, downloads, signed URLs, deletes, and finalize attempts (`403`, verified live between User A and User B).
   - **Guaranteed `finally` Cleanup:** `consumeTempUploadBytes()` and `cleanupTempObjects()` wrap finalize routes (`POST /api/uploads/image`, `POST /api/uploads/audio`, `POST /api/account/restore`, `POST /api/import/parse`, `POST /api/import/commit`) in `try { ... } finally { await cleanup(); }` — verified live to remove temp blobs both on success (`201`/`200`) and on post-upload magic-byte rejection (`415`).
2. **Distributed PostgreSQL Rate Limiter Across Serverless Isolates (`0017`, `src/lib/security/rate-limit.ts`):**
   - Replaces per-isolate memory-only counters with atomic PostgreSQL enforcement via `enforceDistributedRateLimit()` -> `service_role`-only RPC `public.check_and_increment_rate_limit()` across all rate-limited API and auth routes (zero synchronous `enforceRateLimit(` calls remain under `src/app/`).
   - `public.api_rate_limits` has `ENABLE ROW LEVEL SECURITY` + zero client policies + `REVOKE ALL FROM PUBLIC, anon, authenticated`; both table and RPC return PostgreSQL `42501` to `anon` and `authenticated` clients.
   - `getClientIdentifier()` prioritizes Vercel's trusted edge header `x-vercel-forwarded-for` before `x-real-ip` and `x-forwarded-for` (hashed via SHA-256) to resist spoofed IP bypasses.
   - Lazy-loads `@/lib/supabase/admin` only when server credentials are present, preserving `import "server-only"` isolation and falling back cleanly to the deterministic in-memory limiter in local/unit-test environments without secrets.
   - Live burst-verified on Vercel (`POST /api/account/restore` `5 / 15m` -> `[201, 201, 201, 201, 201, 429]` with `Retry-After` & `X-RateLimit-*` headers and persisted PG `hit_count`).
3. **Auth Route Cache Isolation & Open-Redirect Hardening (`src/app/auth/*`, `src/components/auth/login-form.tsx`):**
   - `/auth/callback`, `/auth/confirm`, and `/auth/signout` set `Cache-Control: no-store` on every redirect, JSON, and `429` response (preventing CDN/proxy caching of auth transitions), enforce distributed `RATE_LIMITS.AUTH_ACTION` on `callback`/`confirm`, and reject non-POST `GET /auth/signout` (`405`).
   - Both server `isSafeRelativeRedirect()` and client `sanitizeNextPath()` reject `//evil.com`, `https://evil.com`, `/\evil.com`, `://`, and ASCII control characters (`[\x00-\x1F\x7F]`), redirecting strictly to relative same-origin paths.
4. **Service Worker Redirect & Private-Response Cache Guards (`public/sw.js`):**
   - `isCacheableStaticResponse()` explicitly rejects `response.redirected` responses and any response carrying `Cache-Control: private` (in addition to `no-store` / non-`200` / non-static paths), ensuring auth redirects or user-scoped data can never poison the static shell cache.
5. **Secrets Hygiene, Deployment Isolation & Production CSP/HSTS (`.gitignore`, `next.config.ts`, Vercel Hobby):**
   - `.gitignore` strictly excludes `.env*` (except `.env.example`) and `.vercel`; `SUPABASE_SECRET_KEY` is stored as a Vercel `--sensitive` encrypted env var (`gitForkProtection: true` blocks untrusted external fork PRs from accessing Preview secrets).
   - `next.config.ts` emits production-only `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`, strips `localhost` / `127.0.0.1` from production `Content-Security-Policy`, keeps `X-Powered-By` disabled (`poweredByHeader: false`), and sets `X-Content-Type-Options: nosniff` on all streamed `ReadableStream` exports (`stream-response.ts`).
   - Live production scan (`https://studyhub-three-mauve.vercel.app`) verified `0` secret/parser leaks across `28` deployed `/_next/static/chunks/*.js` files and `0` leaked secrets / `0` unhandled `5xx` across `106` runtime `vercel logs` lines.
6. **Honest Accounting of Inherited Advisories & Free-Tier Operational Limits:**
   - **Dependency Audit (`npm audit --omit=dev`):** **`0` critical, `0` high** vulnerabilities. Two inherited **moderate** advisories remain strictly inside `exceljs`'s transitive dependency chain (`uuid <11.1.1`, affecting only unused `v3`/`v5`/`v6` buffer-offset paths not invoked by StudyHub's deterministic spreadsheet parser/exporter). We intentionally avoid `npm audit fix --force` (which would downgrade/break `exceljs`), and mitigate spreadsheet attack surfaces via strict 15 MB caps, `PK\x03\x04` magic bytes, macro rejection (`.xlsm`), and ZIP/OOXML bomb guards.
   - **Supabase Free-Tier Auth Email Rate Limits:** Supabase's built-in Free-Tier SMTP enforces strict hourly transactional email caps (signup confirmation / password reset). For reliable production email delivery above personal/small-group volume, configure a free custom SMTP provider in the Supabase Dashboard (see `docs/FREE_TIER_LIMITATIONS.md`).

See [`docs/audit/v3/SECURITY_AUDIT.md`](audit/v3/SECURITY_AUDIT.md) (Wave 5B) and [`docs/audit/v3-production/SECURITY_AUDIT.md`](audit/v3-production/SECURITY_AUDIT.md) (live HTTPS Vercel production audit — `22/22` live security tests PASS, `0` open P0/P1/P2).
