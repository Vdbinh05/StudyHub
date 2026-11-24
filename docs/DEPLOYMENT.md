# StudyHub V1.0 — Local Development, Deployment & Backup/Restore Guide

> **Target Platform:** Vercel (Next.js 16 App Router + `src/proxy.ts` session refresh) + Supabase (PostgreSQL 15+ with strict RLS on all 20 tables, Supabase Auth, and `study-media` Storage bucket).

---

## 1. Prerequisites

- **Node.js:** `v20.11+` (verified on `v24.15.0`) and **npm** `10+` (`11.12.1`)
- **Git:** `2.40+`
- **Database & Auth Backend (choose one):**
  - **Hosted Supabase Cloud** project at [supabase.com](https://supabase.com) (recommended when Docker is unavailable), OR
  - **Local Supabase CLI** (`npx supabase start`) with **Docker Desktop** running.

---

## 2. Environment Variables (`.env.local`)

Copy `.env.example` to `.env.local` and populate your Supabase project values (never commit `.env.local` to Git):

| Variable | Visibility | Required | Purpose |
| --- | --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Client & Server | Yes | Supabase API URL (`https://<ref>.supabase.co` or `http://127.0.0.1:54321`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client & Server | Yes | Public `anon` key protected by strict PostgreSQL RLS across all 20 tables |
| `NEXT_PUBLIC_APP_URL` | Client & Server | Yes | Canonical app URL (`http://localhost:3000` locally; `https://<domain>` in production) for OAuth callbacks & share links |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server-Only** | Optional (admin/server RPC ops) | **NEVER** prefix with `NEXT_PUBLIC_`. Imported exclusively inside `src/lib/supabase/admin.ts` (`import 'server-only'`) |
| `NEXT_PUBLIC_ENABLE_GOOGLE_OAUTH` | Client & Server | Optional (`false` by default) | Set to `true` after enabling Google OAuth in Supabase Dashboard |

> **Graceful Unconfigured Guard:** If `NEXT_PUBLIC_SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_ANON_KEY` is omitted, StudyHub builds cleanly, renders public pages, displays an honest setup banner on auth pages, and returns `503 SUPABASE_NOT_CONFIGURED` on database API routes — never fake auth or mock data.
> **Zero AI / Zero Payments:** No OpenAI, Gemini, Anthropic, or Stripe keys exist or are required.

---

## 3. Supabase Database Migrations (`0001`–`0004`)

Apply the 4 canonical SQL migration files in exact numeric order:

1. `supabase/migrations/0001_initial_schema.sql` — All 20 UUID tables, foreign keys, cascades, unique/check constraints, and composite/partial indexes.
2. `supabase/migrations/0002_rls_policies.sql` — `ENABLE ROW LEVEL SECURITY` on all 20 tables, `(SELECT auth.uid())` policies, column-level `REVOKE` on pre-submit exam answer fields, and authorization helper functions.
3. `supabase/migrations/0003_functions_and_triggers.sql` — `handle_new_user()` (creates `profiles` + `user_preferences`), `set_updated_at()` triggers, `question_count` sync trigger, immutable `exam_attempt_questions` trigger, atomic & idempotent `submit_exam_attempt()` RPC, and share-link/user lookup RPCs.
4. `supabase/migrations/0004_storage_and_buckets.sql` — Private `study-media` bucket (5 MB cap, raster images only — no SVG) with `storage.objects` RLS policies.

### Option A: Hosted Supabase Project
```bash
npm install
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```
*(Alternatively, paste `0001_initial_schema.sql` through `0004_storage_and_buckets.sql` sequentially into the Supabase Dashboard **SQL Editor**.)*

### Option B: Local Supabase CLI (Docker Desktop Running)
```bash
npm install
npx supabase start
npx supabase db reset
```
Copy the printed `API URL`, `anon key`, and `service_role key` into `.env.local`.

### Auth Redirect Configuration
In Supabase Dashboard -> **Authentication -> URL Configuration**:
- **Site URL:** `http://localhost:3000` (local) or `https://<your-domain>` (production)
- **Redirect URLs:**
  - `${NEXT_PUBLIC_APP_URL}/auth/callback`
  - `${NEXT_PUBLIC_APP_URL}/auth/confirm`
  - `${NEXT_PUBLIC_APP_URL}/reset-password`

---

## 4. Next.js 16 Session Proxy (`src/proxy.ts`) & Security Headers

- Auth session refresh and protected route guards run in **`src/proxy.ts`** (Next.js 16 convention, zero middleware deprecation warnings).
- Security headers configured in `next.config.ts`:
  - `Content-Security-Policy` (strict production directives; `'unsafe-eval'` restricted to non-production dev HMR only)
  - `X-Frame-Options: DENY`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: camera=(), microphone=(), geolocation=()`

---

## 5. Verification Commands

```bash
npm run typecheck   # tsc --noEmit (0 errors)
npm run lint        # eslint . (0 errors, 0 warnings)
npm run test        # Vitest unit, security, migration & integration suite (82 tests)
npm run build       # Next.js 16 production build (69 App Router routes + Proxy)
npm run test:e2e    # Playwright E2E, responsive (6 viewports) & security header tests
```

To execute the full live 2-account Supabase E2E journey (`tests/e2e/authenticated-journey.spec.ts`) against a running Supabase instance:
```bash
# PowerShell
$env:E2E_SUPABASE_READY="1"; npm run test:e2e

# Bash
E2E_SUPABASE_READY=1 npm run test:e2e
```

---

## 6. Production Deployment (Vercel + Supabase)

1. Push the repository to GitHub/GitLab/Bitbucket.
2. Import into **Vercel** (Framework: `Next.js`, Node.js `20.x` or `22.x`).
3. Configure Vercel **Environment Variables**:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_APP_URL` (`https://<your-production-domain>`)
   - `SUPABASE_SERVICE_ROLE_KEY` (encrypted, Server-only)
4. Push all 4 SQL migrations to production Supabase (`npx supabase db push`).
5. Update Supabase Auth **Site URL** & **Redirect URLs** for your production domain.
6. Smoke-check `GET /api/health` (`200 OK`), verify response CSP/security headers, and run sign-up, import, and mock exam end-to-end.

---

## 7. Backup & Restore Runbook

### 7.1 Full PostgreSQL Backup & Restore (`pg_dump` / `pg_restore`)
Retrieve your direct database connection string (`DATABASE_URL`, port `5432`) from Supabase Dashboard -> **Project Settings -> Database**:

```bash
# Create compressed custom-format backup of the public schema & data
pg_dump "$DATABASE_URL" \
  --format=custom \
  --schema=public \
  --no-owner \
  --no-privileges \
  --file="studyhub_backup_$(date +%Y%m%d_%H%M%S).dump"

# Restore into a freshly migrated target database
pg_restore \
  --dbname="$TARGET_DATABASE_URL" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  studyhub_backup_YYYYMMDD_HHMMSS.dump
```
*(In production Supabase Pro, also enable Point-in-Time Recovery (PITR) and automated daily backups.)*

### 7.2 User-Level Lossless Study Set Backup (StudyHub JSON Export)
- Any user can export individual study sets via **`GET /api/sets/[id]/export?format=json`** (or CSV / XLSX) directly from `/sets/[id]`, or export their full account data snapshot via `/settings` (`GET /api/account/data`).
- Re-importing a StudyHub JSON export via `/sets/[id]/import` performs a 100% lossless round-trip of prompts, options, `is_correct` flags, accepted answers, chapters, explanations, hints, difficulty, and tags.
