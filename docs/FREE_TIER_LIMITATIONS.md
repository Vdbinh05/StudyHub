# StudyHub V3.0 — Free-Tier Limitations & Operating Envelope

> **Zero-Paid-Service Architecture:** StudyHub V3.0 is engineered to run end-to-end at **$0/month** on **Vercel Hobby** + **Supabase Cloud Free** with **zero** Pro upgrades, **zero** paid trials, **zero** custom domains, **zero** Redis/Upstash add-ons, **zero** AI/LLM/OCR/TTS APIs, and **zero** billing/paywall SDKs.

This document honestly documents every platform ceiling on the free tiers, how StudyHub mitigates it deterministically, and the realistic operating envelope for personal study and small friend/study groups.

---

## 1. Vercel Hobby Plan Limits & StudyHub Mitigations

| Vercel Hobby Constraint | Platform Limit | StudyHub V3.0 Mitigation | Residual Limit / User Guidance |
| --- | --- | --- | --- |
| **Inbound Function Request Body** | **4.5 MB** hard Edge limit (`413 FUNCTION_PAYLOAD_TOO_LARGE`) | All upload clients (`src/lib/media/direct-upload.ts`) transparently switch to 2-step signed `PUT` into private `study-temp` whenever payload `> 3.5 MB`. `POST /api/import/commit` chunks every format to `<= 2.5 MB` and `<= 500` questions via `buildVercelSafeCommitChunks()`. | Supports up to **15 MB** DOCX/XLSX/PDF imports, **12 MB** JSON account backups, **10 MB** audio, and **5 MB** raster images seamlessly on Hobby. |
| **Outbound Buffered Function Response** | **4.5 MB** buffered (`20 MB` max streamed on Node.js) | `src/lib/security/stream-response.ts` streams `POST /api/export/pdf`, `GET /api/sets/[id]/export`, `GET /api/account/data`, and `> 2 MB` `POST /api/import/parse` responses via 64 KB `ReadableStream` chunks (no `Content-Length`). DOCX preview media `> 1.5 MB` is offloaded to `study-temp`; PDF embedded image budget is capped at `14 MB`. | Very large PDFs or exports remain comfortably below Vercel's 20 MB streaming ceiling. |
| **Serverless Function Duration** | Up to **60s** configurable (`maxDuration = 60`; Fluid Compute enabled on Hobby) | All 15+ heavy routes (`import/parse`, `import/commit`, `export/pdf`, `sets/[id]/export`, `account/data`, `account/restore`, `uploads/*`, `exams`, `exams/[id]/submit`, `duplicate`, etc.) explicitly export `runtime = "nodejs"` and `maxDuration = 60`. | Extremely dense 500-page PDFs or massive 50,000-row imports should be split into smaller files/page ranges if processing approaches 60s. |
| **Image Optimization Quota** | **1,000** source images / month on Hobby | `next.config.ts` sets `images: { unoptimized: true }`; zero `next/image` calls exist in `src/`. Media is served directly from Supabase Storage via authenticated 302 signed URLs. | **0** Vercel Image Optimization quota consumed. |
| **Function Bundle Size & Cold Starts** | **250 MB** unzipped function size | Explicit `outputFileTracingIncludes` pins `NotoSans-*.ttf` (~1.66 MB) only on `/api/export/pdf` and `pdfjs-dist` (`*.mjs`, `standard_fonts`, `cmaps` ~8 MB, excluding `.mjs.map` sourcemaps) only on `/api/import/parse`. Leaf imports eliminate barrel bloat (`export/pdf` has `0` `pdfjs-dist` references). | Fast cold starts and tiny serverless bundles well under 250 MB. |
| **Fast Data Transfer (Bandwidth)** | **100 GB / month** | Static assets (`/_next/static/*`, `/icons/*`) are cached client-side by `public/sw.js`; media binaries stream directly from Supabase Storage via 302 redirect (bypassing Vercel bandwidth); offline study sets cache media locally in IndexedDB. | Ample for personal use and small study groups. |
| **Deployments & Build Minutes** | **100** deployments/day, Hobby build quota (2 vCPU / 8 GB build container) | `next.config.ts` drops local `cpus: 4` override when `process.env.VERCEL` is set (`memoryBasedWorkersCount: true`); clean builds complete in ~1 minute. | Avoid redundant CLI deploys when pushing to `main` (GitHub auto-deploy handles Production). |
| **Deployment Protection** | `vercel_authentication` protects Preview & immutable deployment URLs | Canonical Production URL (`https://studyhub-three-mauve.vercel.app`) is publicly reachable (`200 OK`), while Preview/immutable URLs stay gated (`302`) and `gitForkProtection: true` hides env vars from external PRs. | Expected secure Hobby behavior. |
| **Commercial Use Restriction** | Hobby is strictly for personal / non-commercial projects | StudyHub has zero monetization, ads, paywalls, or billing SDKs. | Upgrade to a commercial plan only if ever operating commercially. |

---

## 2. Supabase Cloud Free Plan Limits & StudyHub Mitigations

| Supabase Free Constraint | Platform Limit | StudyHub V3.0 Mitigation | Residual Limit / User Guidance |
| --- | --- | --- | --- |
| **PostgreSQL Database Size** | **500 MB** | Normalized schema (`37` tables); zero binary/base64 media stored in Postgres (stored in `study-media` instead); `public.api_rate_limits` opportunistically prunes expired rows (~5% of requests). | Comfortably holds **100,000+ text questions**, options, SM-2 progress, and exam snapshots. |
| **Storage Capacity** | **1 GB** total (`50 MB` max single file) | Per-file caps (`5 MB` images, `10 MB` audio, `15 MB` temp import, `12 MB` backup); SHA-256 deduplication for DOCX imported images; guaranteed `finally` deletion of `study-temp` files; client-side image optimization (`optimizeImageForUpload`) in editors. | Roughly 1,500–4,000 optimized images/diagrams or ~200–500 short audio clips across the project. Periodically remove unused study sets if approaching 1 GB. |
| **Storage & Database Egress** | **2 GB – 5 GB / month** (Free tier uncached/cached egress) | `/api/uploads/signed-url` sets `Cache-Control: private, max-age=300` on 302 redirects; **Offline PWA Download Manager** stores downloaded questions, diagrams, and image/audio blobs locally in IndexedDB (`studyhub-offline-v3:${userId}`), eliminating repeated media downloads during study sessions. | Encourage downloading media-heavy sets for offline study when revising repeatedly. |
| **Auth Built-in Email Rate Limits** | Very low (**~2–4 emails/hour** on Supabase's default built-in SMTP, intended for development/personal testing) | Sign-in with password requires no email; email is only triggered on sign-up confirmation, password recovery, or email change. | **Free Mitigation for Larger Groups:** Configure a free-tier Custom SMTP provider (e.g., Resend free tier, Brevo free tier, or Gmail App Password SMTP) directly in **Supabase Dashboard -> Project Settings -> Auth -> SMTP Settings** — zero code changes required. |
| **7-Day Inactivity Pausing** | Free projects with **7 consecutive days of zero activity** are automatically paused | Normal study traffic keeps the project awake. If paused after a long break, click **Restore project** in Supabase Dashboard (~1–2 minutes, zero data loss). | Do **not** deploy fake cron-ping loops that violate Supabase Free ToS; simply restore from the dashboard if returning after >7 days idle. |
| **No Automated Daily Backups / PITR** | Free tier does not include Supabase PITR | StudyHub provides one-click personal JSON Backup & Restore in `/settings` (`/api/account/data` & `/api/account/restore`) plus lossless per-set JSON/CSV/XLSX export. Administrators can run `pg_dump` periodically (see [`docs/DEPLOYMENT.md`](./DEPLOYMENT.md)). | Export a JSON backup before major edits or exams. |
| **Monthly Active Users (MAU)** | **50,000 MAU** | Far exceeds personal & classroom usage. | Effectively unconstrained for intended scope. |

---

## 3. Recommended Operating Envelope

At **$0/month** with zero paid upgrades, StudyHub V3.0 reliably supports:
- **Personal Learners & Small Study Groups / Classes:** 1 to ~50 active students sharing study sets, flashcards, diagrams, and mock exams.
- **Question Banks:** Single sets up to **10,000+ questions** (paginated, zero PostgREST 1,000-row truncation) and multi-subject timed exams up to **1,000 questions** (verified live at 500Q banks, 250Q randomized timed exams with F5 survival, and 500Q full-coverage cycles).
- **Multimedia & Files:** Selectable-text PDFs (up to 15 MB / 500 pages; **scanned image-only PDFs are honestly detected and rejected because StudyHub runs zero AI OCR**), multimedia `.docx` & `.xlsx` up to 15 MB, raster images up to 5 MB (SVG/HTML strictly blocked), and audio clips/recordings up to 10 MB / 120s.
- **Offline PWA:** Full offline study (flashcards, learn, practice, diagrams, notes) over HTTPS with deterministic idempotent reconnect sync.

---

## 4. Known Non-Blocking Upstream Dependency Note

- **`npm audit --omit=dev`** reports `0` Critical, `0` High, and `2` pre-existing Moderate transitive advisories (`uuid <11.1.1`, `GHSA-w5hq-g745-h8pq`) inside `exceljs`.
- StudyHub never calls `uuid.v3/v5/v6` with user-controlled buffers (it uses Node's built-in `crypto.randomUUID()` exclusively) and runs strict pre-load ZIP/OOXML/XXE security validation (`src/lib/import/zip-guard.ts`) before `ExcelJS.xlsx.load()`. Accepted as low residual risk until upstream `exceljs` upgrades `uuid`.
