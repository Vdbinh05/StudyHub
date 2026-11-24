# StudyHub V3.1 (Mobile-First & Tokyo Co-Located Edition) — Deployment Guide

> **Production Stack (100% Free-Tier, Zero AI, Zero Payments):**
> - **Hosting:** Vercel Hobby — Project `studyhub` (`prj_ddcCZOt10qpV0RbMGltVLyNN29fN`, Team `binhs-projects-438b34e8`, Region **`hnd1` Tokyo** pinned via `vercel.json` to co-locate with Supabase Cloud `ap-northeast-1`)
> - **Canonical Production HTTPS URL:** `https://studyhub-three-mauve.vercel.app`
> - **Repository:** `https://github.com/Vdbinh05/StudyHub` (Production branch: `main`, Git Fork Protection enabled)
> - **Framework & Runtime:** Next.js `16.4.6` (App Router + Turbopack + `src/proxy.ts`) on **Node.js `24.x`**
> - **Database, Auth & Storage:** Supabase Cloud Free (`ap-northeast-1` Tokyo, PostgreSQL `17.12`, **37/37** public tables with strict RLS across Migrations `0001`–`0018`, private `study-media` and `study-temp` Storage buckets)

---

## 1. Prerequisites

- **Node.js:** `24.x` (`package.json` pins `"engines": { "node": "24.x" }`) and **npm** `10+`
- **Git:** `2.40+`
- **Vercel CLI** (`vercel`) authenticated against team `binhs-projects-438b34e8`
- **Supabase Project** (Hosted Supabase Cloud Free tier, or local Supabase CLI with Docker for offline development)

---

## 2. Environment Variables (Names Only — Never Commit Secrets)

Copy [`.env.example`](../.env.example) to `.env.local` for local development. In Vercel Project Settings (`studyhub`), configure the following variables — **never** commit `.env*` files to Git (protected by `.gitignore`) and **never** pass secret values on shell command lines (use stdin piping or the encrypted Vercel Dashboard):

| Variable Name | Type | Vercel Target(s) | Required | Purpose |
| --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Config (Public) | `Production`, `Preview` | Yes | Supabase project API URL (`https://<project-ref>.supabase.co`) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Config (Public) | `Production`, `Preview` | Yes | Modern Supabase publishable client key protected by strict PostgreSQL RLS (`NEXT_PUBLIC_SUPABASE_ANON_KEY` also supported as legacy fallback) |
| `SUPABASE_SECRET_KEY` | **Secret (`--sensitive`, Server-Only)** | `Production`, `Preview` | Yes | Server-only key imported exclusively in `src/lib/supabase/admin.ts` (`import "server-only"`) for permanent account deletion, Storage purge, and distributed PG rate limiting (`SUPABASE_SERVICE_ROLE_KEY` also supported as legacy fallback). **NEVER prefix with `NEXT_PUBLIC_`.** |
| `NEXT_PUBLIC_APP_URL` | Config (Public) | **`Production` ONLY** | Yes | Set to `https://studyhub-three-mauve.vercel.app` in Production. Leave **unset on Preview** so `getAppUrl()` in `src/lib/supabase/env.ts` resolves dynamically from `VERCEL_PROJECT_PRODUCTION_URL` / `VERCEL_URL`. |
| `NEXT_PUBLIC_ENABLE_GOOGLE_OAUTH` | Config (Public) | Optional (`false` default) | No | Enable Google OAuth button after configuring Google provider in Supabase Auth |

> **Security Notes:**
> - **Git Fork Protection (`gitForkProtection: true`):** Untrusted external Pull Requests on the public repository never receive Preview environment variables.
> - **Zero AI / Zero Billing Keys:** StudyHub uses 100% deterministic logic; no OpenAI, Gemini, Anthropic, Stripe, or Redis environment variables exist.
> - **Graceful Unconfigured Mode:** Without Supabase env vars, public routes render cleanly and database API routes return `503 SUPABASE_NOT_CONFIGURED` rather than mock data.

### Uploading Secrets Safely via CLI (Stdin Piping)

When updating sensitive variables via CLI, pipe values from stdin (never `--value <secret>` in shell history):

```bash
# Example: update a secret from a local file or in-memory script without echoing to stdout/argv
vercel env add SUPABASE_SECRET_KEY production,preview --sensitive --force --yes --scope binhs-projects-438b34e8
vercel env ls --scope binhs-projects-438b34e8
```

---

## 3. Supabase Database Migrations (`0001`–`0018`)

All 18 SQL migrations in `supabase/migrations/` are strictly additive and immutable once applied to production (**never** rewrite `0001`–`0018` or run `db reset` against live Supabase Cloud):

| Range | Migration Files | Scope |
| --- | --- | --- |
| **V1.0 Core** | `0001_initial_schema.sql` – `0004_storage_and_buckets.sql` | Core 20 tables, strict RLS (`(SELECT auth.uid())`), exam immutability & scoring RPCs, private `study-media` bucket |
| **V2.0–V2.1 Exams & Cloud Hardening** | `0005_v2_custom_exams_and_coverage.sql` – `0012_v2_1_fix_coverage_delete_cascade.sql` | 6 V2 tables (multi-subject exams, presets, full coverage cycles), anon RPC lockdown, RLS recursion & clone fixes |
| **V3.0 Complete Learning Edition** | `0013_v3_media_richtext_questions_schema.sql` – `0016_v3_live_fixes.sql` | 10 V3 tables (`media_assets`, `content_media_relations` with `ON DELETE RESTRICT`, `shared_passages`, `diagram_sets`, `diagram_hotspots`, `user_question_notes`, `question_reports`, `learning_session_checkpoints`, `learning_confidence_events`, `learning_sync_events`), 12-type grading, global search, scoped reset, offline sync RPCs |
| **V3.0 Production Vercel Hardening** | `0017_v3_production_vercel_hardening.sql` | Private `study-temp` bucket (`20 MB` cap, 3 `{auth.uid()}` RLS policies for direct > 3.5 MB uploads), `public.api_rate_limits` (RLS deny-all) + `service_role`-only atomic `check_and_increment_rate_limit()` RPC with opportunistic pruning |
| **V3.1 Performance RPCs & Indexes** | `0018_v3_1_performance_rpcs_and_indexes.sql` | 3 single-RTT `SECURITY DEFINER` RPCs (`get_dashboard_summary`, `get_study_set_summary`, `record_study_session_answer` with full SM-2/confidence/hint parity) + 5 targeted composite indexes |

Total live schema state: **37/37** public tables with `ENABLE ROW LEVEL SECURITY` and **2** private Storage buckets (`study-media`, `study-temp`).

### Applying Additive Migrations to Hosted Supabase

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

---

## 4. Supabase Auth URL Configuration (Required for Production HTTPS)

In **Supabase Dashboard -> Authentication -> URL Configuration**, configure:

- **Site URL:**
  ```text
  https://studyhub-three-mauve.vercel.app
  ```
- **Redirect URLs (exact allowlist):**
  ```text
  https://studyhub-three-mauve.vercel.app/auth/callback
  https://studyhub-three-mauve.vercel.app/auth/confirm
  http://localhost:3000/auth/callback
  http://localhost:3000/auth/confirm
  ```

All auth callback routes (`src/app/auth/callback/route.ts`, `src/app/auth/confirm/route.ts`, `src/app/auth/signout/route.ts`) enforce `Cache-Control: no-store`, strict `isSafeRelativeRedirect()` open-redirect validation, and distributed rate limiting.

---

## 5. Vercel Hobby Production Architecture

StudyHub V3.0 is specifically engineered to stay cleanly within Vercel Hobby limits without paid add-ons:

### 5.1 Direct-to-Storage Upload Architecture (`study-temp` Bypass for Vercel's 4.5 MB Inbound Cap)
Vercel Hobby enforces a hard **4.5 MB** inbound request body cap at the Edge. StudyHub transparently handles files up to **15 MB** (DOCX/XLSX/PDF imports), **12 MB** (JSON account backups), **10 MB** (audio), and **5 MB** (raster images):
- **Client transport (`src/lib/media/direct-upload.ts`, zero `@supabase/supabase-js` import):**
  - Files **`<= 3.5 MB`** (`VERCEL_SAFE_DIRECT_PAYLOAD_BYTES = 3_500_000`): sent single-hop to existing API routes (`/api/uploads/image`, `/api/uploads/audio`, `/api/import/parse`, `/api/account/restore`).
  - Files **`> 3.5 MB`**: call `POST /api/storage/upload-url` to authorize access, validate extension/size, and mint a one-time signed upload URL under `study-temp/{userId}/{purpose}/{uuid}.{ext}` -> browser executes direct `PUT` to Supabase Storage -> finalize endpoint consumes bytes via `consumeTempUploadBytes()`, validates magic bytes / ZIP-bomb guards, saves to `study-media` or Postgres, and **deletes the `study-temp` object in `finally`** on both success and failure.
- **DOCX Multimedia & Chunked Commits:**
  - `POST /api/import/parse` automatically offloads extracted DOCX raster media exceeding `1.5 MB` into `study-temp/{userId}/import-media/{sha256}.{ext}` so neither parse responses nor commit chunks exceed 4.5 MB.
  - `src/lib/import/commit-chunker.ts` (`buildVercelSafeCommitChunks()`) caps every `POST /api/import/commit` chunk to **`<= 2.5 MB`** and **`<= 500` questions** across all formats.

### 5.2 Chunked `ReadableStream` Streaming Exports (Bypassing Vercel's 4.5 MB Buffered Response Cap)
`src/lib/security/stream-response.ts` (`streamBinaryResponse`, `streamJsonResponse`) streams downloads in 64 KB chunks without `Content-Length`, exempting them from Vercel's 4.5 MB buffered response ceiling (supporting up to 20 MB streamed responses):
- `POST /api/export/pdf` (Vietnamese NotoSans PDF exam papers & answer keys; embedded image budget capped at `14 MB`)
- `GET /api/sets/[id]/export` (JSON, CSV, TXT, XLSX exports up to 10,000+ questions)
- `GET /api/account/data` (Full personal JSON data export)
- `POST /api/import/parse` (Streams JSON automatically when preview payload exceeds `2 MB`)

### 5.3 Linux Serverless Tracing, Runtime & Cold-Start Hygiene (`next.config.ts`)
- **`outputFileTracingIncludes`** explicitly pins runtime filesystem assets for Vercel Linux (`/var/task`):
  - `"/api/export/pdf"`: `["./src/assets/fonts/NotoSans-*.ttf"]` (~1.66 MB)
  - `"/api/import/parse"`: `["./node_modules/pdfjs-dist/legacy/build/*.mjs", "./node_modules/pdfjs-dist/standard_fonts/**/*", "./node_modules/pdfjs-dist/cmaps/**/*"]` (excludes ~8.5 MB of `.mjs.map` sourcemaps)
- **`serverExternalPackages: ["pdfjs-dist"]`** paired with leaf imports (`@/lib/import/text-utils`, `@/lib/import/zip-guard`, `@/lib/import/validator`, `@/lib/import/templates`) keeps `/api/export/pdf` and non-parse routes completely free of `pdfjs-dist` bloat.
- **`runtime = "nodejs"` and `maxDuration = 60`** exported on all heavy import, export, media upload, exam, coverage, duplicate, restore, and sync routes.
- **`images: { unoptimized: true }`** guarantees zero Vercel Hobby Image Optimization quota usage (images serve via authenticated 302 signed URLs direct from Supabase Storage with `Cache-Control: private, max-age=1800` + `Vary: Cookie`).
- **Tokyo Region Co-Location (`vercel.json`):** Root `vercel.json` pins `"regions": ["hnd1"]` on Vercel Hobby so Serverless Functions execute in Tokyo alongside Supabase Cloud `ap-northeast-1` (eliminating cross-Pacific RTTs and cutting live API latencies by `-72%` to `-88%`; verified via `X-Vercel-Id: hkg1::hnd1::...`).
- **Security Headers & PWA:** Production HSTS (`max-age=63072000; includeSubDomains`), strict CSP (zero `'unsafe-eval'` or `localhost`), `X-Frame-Options: DENY`, `Permissions-Policy: camera=(), microphone=(self), geolocation=()`, and `/sw.js` served with `Cache-Control: no-cache, no-store, must-revalidate` and `Service-Worker-Allowed: /`.

---

## 6. GitHub -> Vercel Continuous Deployment Flow

The Vercel project `studyhub` is linked directly to `https://github.com/Vdbinh05/StudyHub`:

1. **Push to `main`:** Automatically triggers a **Production** build on Vercel (`hnd1` Tokyo, Node `24.x`) and aliases `https://studyhub-three-mauve.vercel.app` upon `READY`.
2. **Pull Requests / Feature Branches:** Automatically build isolated **Preview** deployments guarded by Vercel Deployment Protection (`vercel_authentication`) and `gitForkProtection: true`.
3. **Manual Verification Before Pushing to `main`:**
   ```bash
   npm run typecheck   # tsc --noEmit (0 errors)
   npm run lint        # eslint . (0 errors, 0 warnings)
   npm run test        # Vitest unit, security, migration & integration suite
   npm run build       # Next.js 16.4.6 production build
   ```
4. **Post-Deploy Smoke Check:**
   - `GET https://studyhub-three-mauve.vercel.app/api/health` -> `200 OK` (`{"data":{"status":"ok","supabaseConfigured":true}}`)
   - `GET https://studyhub-three-mauve.vercel.app/sw.js` -> `200 OK` (`Cache-Control: no-cache, no-store, must-revalidate`)
   - `GET https://studyhub-three-mauve.vercel.app/manifest.webmanifest` -> `200 OK`
   - `GET https://studyhub-three-mauve.vercel.app/offline` -> `200 OK`

---

## 7. Backup & Restore

- **User-Level Personal Backup:** Export full personal JSON data anytime from `/settings` (`GET /api/account/data`) and restore safely via `/settings` (`POST /api/account/restore` — automatically routes backups `> 3.5 MB` through `study-temp`).
- **Study Set Export/Import:** Export individual study sets via `GET /api/sets/[id]/export?format=json|csv|txt|xlsx` or printable Vietnamese A4 PDF via `POST /api/export/pdf`.
- **PostgreSQL Full Backup (`pg_dump` / `pg_restore`):**
  ```bash
  pg_dump "$DATABASE_URL" --format=custom --schema=public --no-owner --no-privileges \
    --file="studyhub_backup_$(date +%Y%m%d_%H%M%S).dump"
  ```
  See [`docs/PRODUCTION_RUNBOOK.md`](./PRODUCTION_RUNBOOK.md) for rollback and recovery procedures and [`docs/FREE_TIER_LIMITATIONS.md`](./FREE_TIER_LIMITATIONS.md) for Hobby/Free operating limits.
