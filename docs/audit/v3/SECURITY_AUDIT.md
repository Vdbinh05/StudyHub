# StudyHub V3.0 — Independent Live Security Audit Report (Wave 5)

- **Auditor:** `security-auditor` (Agent 7 — Independent Security Auditor, zero production `src/*` or `supabase/*` edits)
- **Date:** 2026-11-24
- **Target Environment:**
  - **Database & Storage:** Live Supabase Cloud (`cuoaifyupfmkstqhcjwy`, PostgreSQL 17.12, Migrations `0001`–`0016` live, **36/36** public tables RLS-enabled)
  - **Runtime Server:** Clean Wave 5B Next.js 16.4.6 production build (`npx next start -p 3025 -H 127.0.0.1`, dedicated port `3025`, cleanly stopped after verification with `PORT_3025_FREE=True`)
- **Final Verdict:** **PASS** — **0 P0, 0 P1, 0 P2 open** (all **5** real security bugs caught in Wave 5A — `2 P1` + `3 P2` — were fixed by owning builders, rebuilt into Wave 5B, and verified live on PG 17.12 + HTTP `:3025`; **1 P3** operational body-limit note documented transparently below).

---

## 1. Executive Summary & Verification Matrix

| Verification Suite / Gate | Target | Result | Duration / Scope |
| --- | --- | --- | --- |
| Live V3.0 3-Account Security Suite (`tests/integration/live-v3-rls-security.test.ts`) | Live PG 17.12 + Wave 5B `http://127.0.0.1:3025` | **PASS — 11 / 11** (`exit 0`) | `34.77s` (3 static/deterministic + 8 full live HTTP/PostgREST/RPC/Storage tests) |
| Live V2.1 2-Account Security Regression (`tests/integration/live-rls-security.test.ts`) | Live PG 17.12 + Wave 5B `http://127.0.0.1:3025` | **PASS — 11 / 11** (`exit 0`) | `27.91s` (zero V2.1 security regressions) |
| Unit Security Regression Suite (`tests/unit/security`) | Deterministic Vitest | **PASS — 39 / 39** (`3/3` files, `exit 0`) | `3.43s` (migrations `0001`–`0015`, upload/ZIP/XXE, sanitize, authz, rate-limit, CSV formula, CSP/HSTS) |
| Independent `.next/static/` Bundle Leak Scan | Wave 5B `.next/static/` (`119` files) | **PASS — 0 leaks** | `0` `sb_secret_`, `0` `SUPABASE_SECRET_KEY`/`SERVICE_ROLE_KEY`, `0` `createAdminClient`, `0` `pdfjs-dist`/`pdf-lib`/`exceljs` |
| Static `src/` & `package.json` Security Scan | `341` TypeScript/TSX files + `package.json` | **PASS — 0 violations** | `0` `getSession()`, `0` `getPublicUrl()`, `0` AI/LLM SDKs, `0` payment SDKs; `dangerouslySetInnerHTML` restricted solely to `renderSafeKatexHtml` (`trust: false`) |
| `npm audit --omit=dev` & full `npm audit` | Production + dev lockfile | **PASS (0 Critical / 0 High)** | Only 2 pre-existing moderate transitive advisories (`uuid <11.1.1` GHSA-w5hq-g745-h8pq inside `exceljs`); **0 new advisories** from V3.0 dependencies (`pdfjs-dist`, `pdf-lib`, `katex`, `@tiptap/*`, `idb`) |
| TypeScript & ESLint Gate (new test file + repo) | `npx eslint tests/integration/live-v3-rls-security.test.ts` + `npx tsc --noEmit` | **PASS — exit 0** | `0` TS errors globally, `0` ESLint errors/warnings |
| Live Data Preservation & Clean Teardown | Live Supabase Cloud (real user data preserved) | **PASS** | Tracked disposable accounts (`v3-sec-a/b/c-*`, `v21-sec-a/b-*`) & tracked Storage objects deleted cleanly (`trackedUsersRemaining === 0`, `PORT_3025_FREE=True`, real user data untouched) |

---

## 2. Wave 5 Security Findings — Caught, Reopened & Live-Verified

All 5 security/integrity defects below were independently discovered during Wave 5A audit (board `#163`), remediated by the owning builders (`#164`, `#165`), rebuilt into Wave 5B (`#185`), and **verified live end-to-end** against PostgreSQL 17.12 + `http://127.0.0.1:3025`:

| ID | Severity | Owner | Location | Defect Summary | Remediation & Live Wave 5B Proof | Status |
| --- | --- | --- | --- | --- | --- | --- |
| **`V3-SEC-01`** | **P1** | `v2-import-builder` | [route.ts](file:///d:/Code%20Web/StudyHub/src/app/api/export/pdf/route.ts#L159-L259), [route.ts](file:///d:/Code%20Web/StudyHub/src/app/api/export/pdf/route.ts#L448-L458) | (a) Exam PDF export directly queried column-revoked `exam_attempt_questions` columns (`type_payload_snapshot`, `correct_option_ids`, `accepted_answers_snapshot`, `explanation_snapshot`, `explanation_rich_snapshot`), crashing EVERY exam PDF export with PG `42501`. (b) Answer-key guard blocked `in_progress` but missed `discarded` attempts. (c) Unencoded Vietnamese filenames in `Content-Disposition` caused Node `ByteString` `TypeError` crash. | Replaced direct `SELECT` with `SECURITY DEFINER` `rpcGetExamAttemptDetail()`, blocked BOTH `in_progress` and `discarded` attempts on non-`question_paper` modes (`403`) + `stripPreSubmitQuestions`, and added RFC 5987 `buildPdfContentDisposition()` (`filename="..."; filename*=UTF-8''...`). **Live Verified:** Test 7 (`in_progress` `paper_and_key`/`paper_with_explanations`/`incorrect_review` -> `403`; `discarded` `paper_and_key` -> `403`; Vietnamese title `question_paper` & submitted `paper_and_key` -> `200`, valid `%PDF-`, `filename*=UTF-8''`). | **CLOSED (Live Verified)** |
| **`V3-SEC-02`** | **P1** | `v2-db-backend-builder` | [route.ts](file:///d:/Code%20Web/StudyHub/src/app/api/media/[id]/route.ts#L119-L162), [route.ts](file:///d:/Code%20Web/StudyHub/src/app/api/reports/[id]/route.ts#L85-L120) | `DELETE /api/media/[id]` authorized `"edit"` collaborators while RLS `media_assets_delete_owner` restricted DB `DELETE` to owner/set-owner, AND omitted `.select("id").maybeSingle()`. A non-owner editor silently deleted 0 DB rows (`error: null`, bypassing `23503` `ON DELETE RESTRICT`!) and execution fell through to `supabase.storage.remove()`, permanently destroying Storage blobs referenced by historical exam snapshots. Same silent 0-row `.delete()` pattern existed in `DELETE /api/reports/[id]`. | Restricted `DELETE /api/media/[id]` to uploader (`existing.owner_id === user.id`) or study-set `"owner"`, chained `.delete().eq("id", mediaId).select("id").maybeSingle()`, returned `409` on `23503`, and aborted `403` when `!deletedRow` BEFORE `supabase.storage.remove()`. Matched reporter/owner + `.select("id").maybeSingle()` on `DELETE /api/reports/[id]`. **Live Verified:** Tests 2 & 5 (Owner delete on exam-referenced media -> `409`; Editor B delete -> `403` with Storage blob intact; Editor B report delete -> `403`/`404` with report intact). | **CLOSED (Live Verified)** |
| **`V3-SEC-03`** | **P2** | `v2-db-backend-builder` | [route.ts](file:///d:/Code%20Web/StudyHub/src/app/api/media/route.ts#L101-L147) | `POST /api/media` checked edit permission on `media_id` only, without verifying caller edit permission on target `(entity_type, entity_id)`, allowing cross-tenant `content_media_relations` injection onto another user's private `question`, `question_option`, `diagram_set`, `shared_passage`, or `profile` UUID. | Added strict target entity authorization (`profile` requires `entity_id === user.id`; study-set entities look up `study_set_id` and enforce `requireStudySetAccess(..., "edit")`). **Live Verified:** Test 4 (User B attempting to attach B's media onto User A's private question UUID -> rejected `404`/`403`). | **CLOSED (Live Verified)** |
| **`V3-SEC-04`** | **P2** | `v2-db-backend-builder` | [route.ts](file:///d:/Code%20Web/StudyHub/src/app/api/sync/events/route.ts#L31-L52) | `POST /api/sync/events` accepted open `payload: Record<string, unknown>` and passed `note_upsert` `payload.content_rich` straight to `sync_offline_learning_events`, bypassing `sanitizeRichTextDoc()` allowlists, URL checks, and depth/node caps enforced by `PUT /api/notes`. | Sanitized `note_upsert` payloads with `sanitizeRichTextDoc()` and `sanitizeText(..., 10_000)` before calling `rpcSyncOfflineLearningEvents()`. **Live Verified:** Test 3 (synced `note_upsert` containing `<script>` node and `javascript:alert(1)` link persists cleanly with 0 `javascript:` or `script` nodes in `user_question_notes.content_rich`). | **CLOSED (Live Verified)** |
| **`V3-SEC-05`** | **P2** | `v2-import-builder` | [pdf-parser.ts](file:///d:/Code%20Web/StudyHub/src/lib/import/pdf-parser.ts#L285-L295) | `parsePdfBuffer()` omitted `isEvalSupported: false` from `pdfjs.getDocument(...)` despite documenting eval disabled. | Explicitly configured `isEvalSupported: false`, `disableAutoFetch: true`, `useSystemFonts: false`, `disableFontFace: true`. **Verified:** Static & runtime PDF safety test (non-PDF, corrupted PDF, >15 MB PDF, `/OpenAction /JS` PDF all handled safely with zero JS execution). | **CLOSED (Verified)** |

### Low-Severity Operational Hardening Note (Non-Blocking)

| ID | Severity | Location | Finding & Recommendation |
| --- | --- | --- | --- |
| **`V3-SEC-P3-01`** | **P3 (Informational / DX)** | [next.config.ts](file:///d:/Code%20Web/StudyHub/next.config.ts#L44-L47), [proxy.ts](file:///d:/Code%20Web/StudyHub/src/proxy.ts#L11-L21) | Next.js 16's default `experimental.proxyClientMaxBodySize` is **10 MB** when `src/proxy.ts` matches `/api/*`. Oversized >10 MB audio uploads to `POST /api/uploads/audio` are **safely rejected fail-closed** (0 bytes stored), returning `400 BAD_REQUEST` (truncated stream before `formData()`) rather than exact `413 PAYLOAD_TOO_LARGE` (while `validateAudioUpload()` returns exact `413` and >5 MB images return exact `413`). In a future release, configuring `experimental.proxyClientMaxBodySize: "16mb"` in `next.config.ts` will ensure exact `413` on >10 MB audio and preserve full 10–15 MB `.docx`/`.pdf` multipart import capacity through the proxy. |

---

## 3. Detailed Live V3.0 Security Verification Evidence (`live-v3-rls-security.test.ts`)

Executed live against Supabase Cloud PG 17.12 + Wave 5B `http://127.0.0.1:3025` using 3 strictly isolated disposable accounts (`v3-sec-a/b/c-<ts>@studyhub-test.local`):

1. **Private Notes Isolation (`user_question_notes`, `/api/notes`, `global_library_search`):**
   - Owner A creates private note with unique secret token on a set shared with Collaborator B.
   - Collaborator B and unrelated User C receive **0 rows** via direct PostgREST `SELECT`, **0 items** via `GET /api/notes`, and `total: 0` / `counts_by_type.note === undefined` / `items: []` via BOTH `GET /api/search` and direct `global_library_search()` RPC (zero leak in counts or snippets).
   - Forged `INSERT` with `user_id: userAId` by User B is blocked by RLS.
   - Bidirectional isolation verified: Collaborator B creates own private note -> Owner A gets **0 rows** of B's note via PostgREST, `GET /api/notes`, and `global_library_search`, and `UPDATE` targeting B's note affects **0 rows**.
2. **Question Reports RLS & Role Enforcement (`question_reports`, `/api/reports`, `/api/reports/[id]`):**
   - Viewer B submits report (`201`, status `open`).
   - Unrelated User C receives **0 rows** via direct PostgREST and `403`/`404` on `GET /api/reports?studySetId=...`, `POST /api/reports` (on A's private set), and `PATCH /api/reports/[id]`.
   - Viewer B cannot self-resolve own report via direct PostgREST `UPDATE` (0 rows affected) or HTTP `PATCH /api/reports/[id]` (`403`).
   - Owner A lists and resolves B's report (`200`, `status: "resolved"`, `resolved_by === userAId`).
   - Non-owner Editor B cannot delete Owner A's report (`403`/`404`, row preserved).
3. **Checkpoints, Confidence & Offline Sync RLS (`learning_session_checkpoints`, `learning_confidence_events`, `learning_sync_events`, `/api/sync/events`):**
   - User B & User C read **0 rows** and receive RLS errors on forged `INSERT` across all 3 tables.
   - Same-user `event_id` replay returns `duplicate_ignored`; cross-user replay (User B submitting User A's `event_id`) returns **`invalid`** without disclosing User A or event existence.
   - After Owner A revokes Collaborator B's membership on a shared set, User B's queued offline event returns **`rejected_revoked`**.
   - Offline `note_upsert` rich-text payload containing `<script>` and `javascript:alert(1)` is sanitized server-side before storage (`V3-SEC-04`).
4. **Media, Audio Upload Validation & Private `study-media` Storage Security:**
   - Valid PNG (`POST /api/uploads/image` -> `201`), valid PCM WAV & ID3/MP3 (`POST /api/uploads/audio` -> `201`) succeed for authorized owners.
   - Malicious uploads strictly rejected: SVG (`415`), HTML disguised as `.png` (`415`), HTML disguised as `.mp3` (`415`), SVG disguised as `.wav` (`415`), >5 MB image (`413`), >10 MB audio rejected fail-closed (`400` via Next.js 16 proxy + `413` in `validateAudioUpload()`).
   - Unshared media returns `404`/`403` for User B & User C, `401` for `anon` on `/api/uploads/signed-url`, `0` rows on `media_assets`, and direct Storage `createSignedUrl()` fails for User B & `anon`.
   - Cross-tenant `POST /api/media` attachment to another user's private question UUID rejected (`V3-SEC-03`).
5. **Historical Exam Snapshot Media Preservation & `ON DELETE RESTRICT`:**
   - Collaborator B takes & submits an exam containing Owner A's question image linked via `content_media_relations`.
   - Owner A calling `DELETE /api/media/[id]` while referenced by the exam snapshot receives **`409 Conflict`** (`23503`).
   - Non-owner Editor B calling `DELETE /api/media/[id]` receives **`403 Forbidden`** and the Storage blob remains intact (`V3-SEC-02`).
   - After Owner A revokes User B's share on the study set, User B loses set access (`403`/`404`), **yet retains authorized read access to the historical exam snapshot media** via `/api/uploads/signed-url` (`200`), while unrelated User C remains denied (`403`/`404`).
6. **12-Type Pre-Submit Exam Anti-Leak (API + Direct PostgREST `42501`):**
   - Exam created across `fill_in_blank`, `numerical`, `ordering`, `matching`, `image_hotspot`, and `listening` (with `show_transcript_after_submit: true`).
   - Both `POST /api/exams` and `GET /api/exams/[attemptId]` while `in_progress` contain **ZERO** answer-key fields (`is_correct`, `correct_option_ids`, `accepted_answers`, `explanation_snapshot`, `explanation_rich_snapshot`, `correct_value`, `abs_tolerance`, `rel_tolerance`, `correct_position`, `target_hotspots`/`geometry`, matching `pairs`, hidden listening `transcript`, or sentinel answer values). Matching pre-submit payloads expose only unlinked `left_items` + `right_items`.
   - Direct PostgREST queries selecting `type_payload_snapshot`, `explanation_rich_snapshot`, `correct_option_ids`, `accepted_answers_snapshot`, or `explanation_snapshot` from `exam_attempt_questions` all fail with PostgreSQL **`42501`**.
   - Post-submit (`POST /api/exams/[attemptId]/submit`) reveals full grading, explanation, and listening transcript cleanly.
7. **Rich Text XSS, KaTeX `trust: false`, PDF Parser & Export Auth:**
   - `sanitizeRichTextDoc()` strips `<script>`, `<iframe>`, `rawHtml`, `javascript:`, `data:text/html`, `data:image/svg+xml`, `vbscript:`, arbitrary event handlers (`onclick`/`onerror`), and enforces depth (`<=12`) & node (`<=1500`) caps.
   - `renderSafeKatexHtml()` enforces `trust: false`, blocking `\href{javascript:...}`, `\url`, `\htmlClass`, `\htmlStyle`, `\htmlData`, and `<script>` tags while rendering valid LaTeX math cleanly.
   - `parsePdfBuffer()` disables eval (`isEvalSupported: false`, `disableAutoFetch: true`, `useSystemFonts: false`), rejects non-PDF / corrupted / >15 MB payloads, and never executes embedded PDF `/OpenAction /JS`.
   - `POST /api/export/pdf` enforces `allow_clone = false` (`403`), blocks unrelated users (`403`/`404`), blocks cross-user exam export (`404`), blocks answer-key/explanation/review export on BOTH `in_progress` and `discarded` exams (`403`), and succeeds (`200`, valid `%PDF-`, `Cache-Control: private, no-store`, RFC 5987 `filename*=UTF-8''`) for Vietnamese titles.
8. **V3.0 Security Headers, Service Worker & Auth Guards:**
   - Live HTTP headers verified on `http://127.0.0.1:3025`:
     - `Content-Security-Policy`: includes `media-src 'self' blob: https://*.supabase.co`, `worker-src 'self' blob:`, `manifest-src 'self'`, `object-src 'none'`, `frame-ancestors 'none'`, and drops `'unsafe-eval'` / `localhost` in production.
     - `Permissions-Policy`: `camera=(), microphone=(self), geolocation=()`.
     - `Strict-Transport-Security`: enabled in production (`max-age=63072000; includeSubDomains`), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`.
   - `/sw.js`: `200`, `Cache-Control: no-cache, no-store, must-revalidate`, `Service-Worker-Allowed: /`; code audit of [sw.js](file:///d:/Code%20Web/StudyHub/public/sw.js#L30-L229) confirms it **never caches** `/api/*`, `/auth/*`, `/share/*`, cross-origin Supabase traffic, `no-store` responses, or authenticated HTML, and never auto-`skipWaiting()`.
   - Unauthenticated `/diagrams/[id]/edit` redirects (`307`) to `/login`; all 9 V3 API endpoints (`/api/notes`, `/api/reports`, `/api/checkpoints`, `/api/media`, `/api/search`, `/api/sync/events`, `/api/export/pdf`, `/api/progress/reset`, `/api/uploads/audio`) return **`401`**.

---

## 4. SQL Migrations (`0013`–`0016`) & Static Hygiene Audit

- **Migrations `0001`–`0012`:** Confirmed untouched vs `v2.1-verified` (`0` diffs).
- **Migrations `0013`–`0016`:**
  - All 10 new V3 tables (`media_assets`, `content_media_relations`, `shared_passages`, `diagram_sets`, `diagram_hotspots`, `user_question_notes`, `question_reports`, `learning_session_checkpoints`, `learning_confidence_events`, `learning_sync_events`) have RLS enabled (**36/36** tables total).
  - Zero `DROP POLICY`, zero `DROP TRIGGER`, zero `CREATE TEMP TABLE`, zero deprecated `auth.role()`, 100% `(SELECT auth.uid())` initPlan wrapping, and 100% `SET search_path = ''` + `REVOKE ALL ... FROM PUBLIC, anon` across every `SECURITY DEFINER` function.
  - `study-media` bucket remains `public = false` with `audio/*` + raster MIME allowlist only (zero `image/svg+xml` or `text/html`).
- **Static `src/` & `.next/static/` Audit:**
  - `341` source files scanned: `0` `auth.getSession()`, `0` `getPublicUrl()`, `0` AI/LLM SDK imports, `0` payment SDK imports.
  - Only 2 runtime `dangerouslySetInnerHTML` components exist (`RichContentRenderer.tsx`, `RichTextEditor.tsx`), both strictly fed by `renderSafeKatexHtml()` (`trust: false`, explicit `<script|javascript:` guard). `GlobalSearchDialog.tsx` renders highlighted matches via pure React elements (`<mark>`) and enforces relative-only navigation + Hard Exam Guard (`if (examActive) return null`).
  - `119` Wave 5B `.next/static/` chunks scanned: **0** secret key leaks and **0** server-only parser libraries (`pdfjs-dist`, `pdf-lib`, `exceljs`, `createAdminClient`).
- **Live Data Preservation & Teardown:**
  - Only tracked disposable accounts (`v3-sec-a/b/c-*@studyhub-test.local` and `v21-sec-a/b-*@studyhub-test.local`) and their tracked Storage objects were created and deleted; `afterAll` explicitly verified `getUserById(uid)` returned not-found for every tracked test account. Real user accounts and study data in Supabase Cloud were never queried, modified, or deleted.
  - Local port `3025` verified free (`PORT_3025_FREE=True`).
