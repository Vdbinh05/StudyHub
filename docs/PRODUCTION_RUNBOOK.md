# StudyHub V3.0 — Production Runbook, Rollback & Incident Recovery

> **Scope:** Operational procedures for StudyHub V3.0 deployed on **Vercel Hobby** (`https://studyhub-three-mauve.vercel.app`, Project `studyhub` / `binhs-projects-438b34e8`) and **Supabase Cloud Free** (PostgreSQL `17.12`, Migrations `0001`–`0017`).
> **Golden Rule:** **LIVE USER DATA IS SACRED.** Never run `supabase db reset`, never drop/truncate live tables, never force-push `main`, and never print secrets in logs or chat.

---

## 1. Quick Health & Diagnostics Checklist

Run these read-only checks first whenever an issue is reported:

```bash
# 1. Production health endpoint (expects HTTP 200 + supabaseConfigured: true)
curl -i https://studyhub-three-mauve.vercel.app/api/health

# 2. Recent Vercel deployments & status
vercel ls studyhub --scope binhs-projects-438b34e8

# 3. Inspect active deployment metadata & build logs
vercel inspect <deployment-url> --logs --scope binhs-projects-438b34e8

# 4. Stream recent production runtime logs (check for 5xx / exceptions)
vercel logs https://studyhub-three-mauve.vercel.app --limit 100 --no-follow --scope binhs-projects-438b34e8

# 5. Confirm env var names & scopes exist (NEVER prints values)
vercel env ls --scope binhs-projects-438b34e8
```

---

## 2. Rollback Procedures (Zero Database Reset)

Because all Supabase migrations (`0001`–`0017`) are strictly **additive and backward-compatible**, rolling back the Next.js application on Vercel requires **zero database rollback** and preserves 100% of user data.

### 2.1 Fast Rollback via Vercel (Seconds — Recommended First Response)

1. Identify the last known-good `READY` Production deployment from `vercel ls studyhub --scope binhs-projects-438b34e8` (or **Vercel Dashboard -> `studyhub` -> Deployments**).
2. Promote/rollback immediately without rebuilding:
   ```bash
   # Option A: Roll back to the previous production deployment
   vercel rollback --yes --scope binhs-projects-438b34e8

   # Option B: Promote a specific verified deployment URL/ID to production
   vercel promote <verified-deployment-url-or-id> --yes --scope binhs-projects-438b34e8
   ```
3. Verify recovery immediately:
   ```bash
   curl -i https://studyhub-three-mauve.vercel.app/api/health
   ```

### 2.2 Source-Level Git Tag Rollback (Safe, History-Preserving)

Verified release tags: `v3.0-verified` (V3.0 Production) and `v2.1-verified` (V2.1 Cloud Hardening).
**NEVER force-push `main` (`git push --force`).** Always revert forward so GitHub audit history remains intact:

```bash
# Preferred: revert a specific bad commit on main cleanly
git checkout main
git pull origin main
git revert <bad-commit-sha>
git push origin main   # Automatically triggers Vercel Production build & alias

# Alternative: create a clean rollback PR from a verified release tag
git checkout -b hotfix/rollback-to-v3.0-verified v3.0-verified
git push -u origin hotfix/rollback-to-v3.0-verified
# Open PR -> verify Vercel Preview -> merge to main
```

> **Database Safety Reminder:** Never manually `DROP TABLE`, `DROP POLICY`, or rewrite `0001`–`0017` during an app rollback. Forward-compatible additive migrations allow older app builds to keep running safely while a fix is prepared.

---

## 3. Incident Diagnostics & Recovery Playbooks

### 3.1 Supabase Connectivity or `503 SUPABASE_NOT_CONFIGURED`

- **Symptoms:** `/api/health` returns `"supabaseConfigured": false`, auth pages display the setup notice, or API routes return `503`.
- **Checks:**
  1. Run `vercel env ls --scope binhs-projects-438b34e8` and confirm `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SECRET_KEY` are assigned to `Production`.
  2. Check **Supabase Dashboard -> Project Overview**: on Supabase Free, projects with 7 consecutive days of zero traffic automatically pause. Click **Restore project** (takes ~1–2 minutes; zero data loss).
  3. If env vars were rotated, update them via `vercel env add ... --force` (using stdin for `SUPABASE_SECRET_KEY`) and trigger a fresh Production redeploy (`vercel redeploy` or push) so `NEXT_PUBLIC_*` values are re-inlined at build time.

### 3.2 Auth Redirect, Email Confirmation, or OAuth Callback Failures

- **Symptoms:** Clicking an email confirmation or password-reset link lands on `localhost`, fails with `/login?error=auth_callback_failed` or `/login?error=confirmation_failed`, or loops on `/login`.
- **Checks:**
  1. In **Supabase Dashboard -> Authentication -> URL Configuration**, confirm:
     - **Site URL:** `https://studyhub-three-mauve.vercel.app`
     - **Redirect URLs:** includes both `https://studyhub-three-mauve.vercel.app/auth/callback` and `https://studyhub-three-mauve.vercel.app/auth/confirm`.
  2. Confirm `NEXT_PUBLIC_APP_URL` is set to `https://studyhub-three-mauve.vercel.app` on Vercel `Production` (without trailing slash).
  3. Confirm `/auth/callback` and `/auth/confirm` return `Cache-Control: no-store` (prevents edge caching of one-time `?code=` / `?token_hash=` URLs).
  4. Check Supabase Auth rate-limit logs: built-in Free SMTP is capped to a few emails/hour (see [`docs/FREE_TIER_LIMITATIONS.md`](./FREE_TIER_LIMITATIONS.md)).

### 3.3 Large File (`> 4.5 MB`) Upload Failures

- **Symptoms:** Uploads of `3.5–15 MB` DOCX/XLSX/PDF imports, `3.5–5 MB` images, `3.5–10 MB` audio, or `3.5–12 MB` JSON backups fail with `413`, `403`, or `500`.
- **Checks:**
  1. Verify client payload crossed `VERCEL_SAFE_DIRECT_PAYLOAD_BYTES` (`3_500_000` bytes) and hit `POST /api/storage/upload-url` first (HTTP `201`) -> direct `PUT` to Supabase Storage (`200`) -> finalize JSON POST (`{ storagePath }`).
  2. Verify Supabase Storage bucket **`study-temp`** exists (`public = false`, `file_size_limit = 20971520`) and its 3 `storage.objects` policies (`study_temp_select_own`, `study_temp_insert_own`, `study_temp_delete_own`) from Migration `0017` are intact.
  3. If a `415` is returned, verify the file is genuinely an allowed format (SVG, HTML, `.docm`/`.xlsm`, and mismatched magic bytes are intentionally blocked).
  4. If a transient `500` occurs during upstream Supabase Storage transfer, retry once — `consumeTempUploadBytes()` automatically deletes the staged temp object in `finally` so retries start cleanly.

### 3.4 Orphaned `study-temp` Objects Inspection & Safe Cleanup

Every route consuming `study-temp` deletes its staged object inside `finally`, but a browser tab closed mid-upload (after direct `PUT` and before calling the finalize API) can leave a temporary file under `study-temp/{userId}/...`.
- **Safe Cleanup:** Inspect **Supabase Dashboard -> Storage -> `study-temp`** and delete ONLY objects older than **24 hours** inside `study-temp`.
- **NEVER delete objects from `study-media`** manually — `study-media` holds durable user study images, audio, diagrams, and exam snapshot references protected by `content_media_relations` (`ON DELETE RESTRICT`).

### 3.5 Distributed Rate Limiter (`429 RATE_LIMITED` / `public.api_rate_limits`)

- **Behavior:** Rate limits are enforced across all Vercel serverless instances via `public.check_and_increment_rate_limit()` (`service_role`-only) backed by `public.api_rate_limits` (RLS deny-all for `anon` and `authenticated`).
- **Diagnostics:**
  - Verify `Retry-After`, `X-RateLimit-Limit`, and `X-RateLimit-Remaining` headers on `429` responses.
  - Check `SUPABASE_SECRET_KEY` is configured on Vercel; without it, `src/lib/security/rate-limit.ts` degrades safely to per-instance in-memory rate limiting.
  - Expired rows (`expires_at < now() - interval '5 minutes'`) are automatically pruned opportunistically (~5% of calls). If needed, an administrator can safely prune expired rows only (`DELETE FROM public.api_rate_limits WHERE expires_at < now();`) via Supabase SQL Editor.

### 3.6 PDF Import (`pdfjs-dist`) or Vietnamese PDF Export (`NotoSans-*.ttf`) Errors

- **Symptoms:** `POST /api/export/pdf` throws `ENOENT` for `NotoSans-Regular.ttf`, or `POST /api/import/parse` fails to load `pdf.worker.mjs` on Linux.
- **Checks:**
  1. Confirm `next.config.ts` retains `serverExternalPackages: ["pdfjs-dist"]` and `outputFileTracingIncludes` for `/api/export/pdf` (`NotoSans-*.ttf`) and `/api/import/parse` (`pdfjs-dist/legacy/build/*.mjs`, `standard_fonts/**/*`, `cmaps/**/*`).
  2. Run a local `npm run build` and verify `.next/server/app/api/export/pdf/route.js.nft.json` includes `NotoSans-Regular.ttf` & `NotoSans-Bold.ttf` (with zero `pdfjs-dist`) and `.next/server/app/api/import/parse/route.js.nft.json` includes `pdf.mjs` & `pdf.worker.mjs`.
  3. Confirm both routes still export `export const runtime = "nodejs"; export const maxDuration = 60;`.
  4. Remember: scanned / image-only PDFs with no selectable text layer intentionally return `isScannedPdf: true` with guidance (zero AI OCR).

### 3.7 PWA Service Worker (`/sw.js`) & Offline IndexedDB Recovery

- **Safe Update During Active Exams:** `public/sw.js` never auto-calls `skipWaiting()`. Updates wait until the user clicks **Update now** outside `/sets/[id]/test` and `/exams/[attemptId]`.
- **Stale Shell Recovery (Client Side):**
  1. Verify `GET https://studyhub-three-mauve.vercel.app/sw.js` returns `Cache-Control: no-cache, no-store, must-revalidate`.
  2. If a user's browser holds a broken cache, open **Settings -> Offline & Storage** to clear local downloaded sets (or DevTools -> Application -> Service Workers -> Unregister & Clear site data).
  3. Never bump `STATIC_CACHE` in `public/sw.js` without verifying `/offline` precaches as HTTP `200` and `isCacheableStaticResponse()` continues blocking `response.redirected`, `no-store`, and `private`.
- **Account Switch Isolation:** Signing out automatically calls `clearOfflineDataForLogout()`, clearing the active user pointer and account-partitioned IndexedDB (`studyhub-offline-v3:${userId}`).

---

## 4. Data Recovery

1. **Individual User Recovery:** Users can restore previously downloaded JSON backups in `/settings` (`POST /api/account/restore`), which creates fresh UUID copies without overwriting existing sets.
2. **Database-Level Recovery:** Restore from your latest `pg_dump` custom archive into a staging database first to verify row integrity before migrating recovered records:
   ```bash
   pg_restore --dbname="$TARGET_DATABASE_URL" --clean --if-exists --no-owner --no-privileges \
     studyhub_backup_YYYYMMDD_HHMMSS.dump
   ```
