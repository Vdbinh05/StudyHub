# StudyHub V3.2 — Wave 0 & Wave 1 Production Performance & Stability Baseline (`BASELINE.md`)

> **Owner:** `perf-auditor` (Agent 8 — Independent Performance Auditor)  
> **Scope:** Uncontested live production baseline against **`https://studyhub-three-mauve.vercel.app`** + live Supabase Cloud PostgreSQL 17.12 (`cuoaifyupfmkstqhcjwy`), baseline local verification gates (`typecheck`, `lint`, `test`, `build`), Next.js client bundle/rerender profiling, and prioritized root-cause bottleneck register for V3.2 Waves 2–4.  
> **Zero Production Modifications:** Zero edits were made to `src/*`, `supabase/*`, `public/*`, `package.json`, `next.config.ts`, or `vercel.json`.  
> **Raw Sanitized Artifact:** [`baseline-measurements-raw.json`](baseline-measurements-raw.json) (zero secrets, zero PII, zero real user or `sample-data/` content).

---

## 1. Wave 0 Repository, Deployment, Branding & Safety Checkpoint

### 1.1 Git Baseline Checkpoint (Non-Destructive)
- **Branch:** `main` (tracking `origin/main`, working tree clean prior to audit docs)
- **Pinned Baseline HEAD SHA:** `39952bd9c4c24be7f97b03146d99262a2ea9d7e8` (`39952bd`, `2026-11-25 13:57:48 +0700`)
- **Existing Verified Tags:** `v2.1-verified`, `v3.0-checkpoint`, `v3.0-verified`, `v3.0.0`, `v3.1-verified`, `v3.1.0` (no new tags pushed during Wave 0)
- **Recent Branding & V3.1 Commits Confirmed in History:**
  - `c8eb9f7` (`v3.1.0`, `v3.1-verified`) — V3.1 mobile-first UX & performance audit closure
  - `ac0f549` — Cleaned transparent StudyHub logo assets (`public/brand/logo-*.png`, `logo-wordmark.svg`, `og-image.png`)
  - `c9bf1f8` — Updated PWA favicon, manifest icons, `public/sw.js` (`studyhub-v3-shell-v2`), and root metadata
  - `39952bd` — Updated `BrandLogo` and UI theme aligned with latest StudyHub brand identity

### 1.2 Live Production Vercel Deployment & Branding Asset Verification
- **Production URL:** `https://studyhub-three-mauve.vercel.app` (also aliased to `https://studyhub.bynh.id.vn`)
- **Active Deployment:** `dpl_4EgSZA1b8LHYPSnrhFjiua78kiGg` (`https://studyhub-l64vocbfx-binhs-projects-438b34e8.vercel.app`, status `● Ready`, created `2026-11-25 13:58:11 +0700` — matches commit `39952bd`)
- **Serverless Function Region:** Confirmed **`hnd1` (Tokyo)** on 100% of `/api/*` responses via `x-vercel-id: hkg1::hnd1::...`
- **Edge CDN PoP:** Confirmed **`hkg1` (Hong Kong)** serving static `/` with `x-vercel-cache: HIT`
- **Live HTTP Security Headers Verified on `/`:**
  - `Strict-Transport-Security: max-age=63072000; includeSubDomains`
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `Content-Security-Policy` present (`frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`)
- **Live Branding & PWA Asset Byte-Parity Check (`39952bd` / `c9bf1f8` / `ac0f549`):**

| Asset Path | HTTP Status | Content-Length (Exact Match) | Live `Cache-Control` Header | Observation |
| --- | :---: | ---: | --- | --- |
| `/brand/logo-main.png` | `200` | `47,893 B` | `public, max-age=0, must-revalidate` | Exact match to `ac0f549`; revalidated on every visit (see `PERF-01`/`PERF-06`) |
| `/brand/logo-main-dark.png` | `200` | `36,906 B` | `public, max-age=0, must-revalidate` | Exact match to `ac0f549`; downloaded eagerly even in light mode (`PERF-01`) |
| `/brand/logo-full.png` | `200` | `51,643 B` | `public, max-age=0, must-revalidate` | Exact match to `ac0f549` |
| `/brand/logo-icon.png` | `200` | `12,722 B` | `public, max-age=0, must-revalidate` | Exact match to `ac0f549` |
| `/favicon.ico` | `200` | `6,081 B` | `public, max-age=0, must-revalidate` | Exact match to `c9bf1f8` |
| `/manifest.webmanifest` | `200` | `987 B` | `public, max-age=0, must-revalidate` | Exact match to `c9bf1f8` |
| `/sw.js` | `200` | `7,162 B` | `no-cache, no-store, must-revalidate` | Strictly compliant with SW freshness contract |

### 1.3 Live Supabase Cloud Baseline & Pre-Existing Real User Data Preservation
- **Supabase Project Identity:** `cuoaifyupfmkstqhcjwy` (`cuoaifyupfmkstqhcjwy.supabase.co`, ap-northeast-1 Tokyo; Cloudflare edge `HKG`)
- **Migrations on Disk & Live:** `18` migrations (`0001_initial_schema.sql` through `0018_v3_1_performance_rpcs_and_indexes.sql`); `0018` RPCs verified live (`get_dashboard_summary` returns `42501 permission denied` for `anon`; authenticated `/api/dashboard` & `/api/sets/[id]` succeed in `195–217 ms`)
- **Public Tables & RLS Coverage:** **`37 / 37`** public tables exist live (`liveMissingTables: []`) and **`37 / 37`** have `ENABLE ROW LEVEL SECURITY` in migrations (`tablesWithoutRlsInMigrations: []`)
- **Storage Buckets:** `study-media` (private, `10 MB` cap), `study-temp` (private, `20 MB` cap)
- **Configured Env Var Names Only (Values Never Logged):**
  - Local `.env.local`: `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `VERCEL_OIDC_TOKEN`
  - Vercel Production: `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SECRET_KEY`
- **Pre-Existing Real User Data Preservation Baseline (Read-Only Snapshot & Post-Cleanup Parity):**

| Entity / Table | Pre-Sweep Baseline Count | Post-Sweep Cleanup Count | Status |
| --- | ---: | ---: | --- |
| `auth.users` / `profiles` / `user_preferences` | `2` / `2` / `2` | `2` / `2` / `2` | **100% Preserved** |
| `study_sets` | `3` | `3` | **100% Preserved** |
| `questions` / `question_options` | `599` / `2,400` | `599` / `2,400` | **100% Preserved** |
| `exam_attempts` (`questions` / `answers`) | `2` (`70` / `64`) | `2` (`70` / `64`) | **100% Preserved** |
| `study_sessions` / `study_session_answers` | `27` / `38` | `27` / `38` | **100% Preserved** |
| `user_question_progress` | `87` | `87` | **100% Preserved** |
| `v32-perf-*` disposable users / media | `0` / `0` | `0` / `0` | **100% Cleaned** |

---

## 2. Honest Lab Measurement Methodology & Environment Disclosure

- **Measurement Window:** `2026-11-25T12:54:52Z` – `2026-11-25T13:20:27Z` (**uncontested** live production window; all peer auditors held live traffic until `[live-sweep-done]` at `13:20:46Z`).
- **Host & Tools:** Windows host on Vietnam broadband vantage | Node `v24.15.0` | Playwright `1.65.1` driving Chromium **`159.0.8154.6`** | Lighthouse **`13.6.0`**.
- **Test Dataset:** Strictly isolated disposable `v32-perf-*` account seeded with a synthetic 250-question, 1,000-option, 5-chapter Study Set (`V32 Perf Bench 250Q`, zero aviation/real user text), 1 real uploaded PNG in `study-media`, 1 active 250-question Exam Attempt, and 1 submitted 5-question Exam Attempt for Results → Review Mistakes.
- **Cold vs Warm Separation:**
  - **Direct APIs:** `1` Cold call followed by **`N = 5` Warm calls** (reporting Cold, Warm Median, Warm p95, and Warm Min–Max range).
  - **Playwright + CDP Routes:** Cold uses a brand-new `BrowserContext` with `Network.setCacheDisabled(true)` & `serviceWorkers: "block"`; Warm primes HTTP cache in the same context and navigates with `Network.setCacheDisabled(false)` (resulting in `0 KB` transferred JS on Warm reloads).
  - **Lighthouse Mobile Lab:** `N = 3` runs per route under BOTH default **Simulated Mobile** (`throttlingMethod: simulate` — exact apples-to-apples comparison vs V3.1) AND **DevTools-Throttled Mobile** (`--preset=perf`, `throttlingMethod: devtools`, `562.5 ms` request latency, `1.47 Mbps` down, `4×` CPU) to expose real network-queue contention.
- **Honest Lab Disclosure:** Every metric in this document is a controlled **Lab** measurement from a single geographic broadband vantage. **No field CrUX / real-user monitoring (RUM) data is claimed.**

---

## 3. Direct HTTPS API Latency Baseline (Cold + 5× Warm, Live Production)

*Measured directly via Node `fetch` with real authenticated `@supabase/ssr` cookies against `https://studyhub-three-mauve.vercel.app` (`hkg1::hnd1`).*

| Endpoint | Status | Payload | Cold | Warm Median (`n=5`) | Warm p95 | Warm Range (Min–Max) | Region / Cache |
| --- | :---: | ---: | ---: | ---: | ---: | ---: | --- |
| `GET /` (Static CDN Baseline) | `200` | `126.6 KB` | `168.8 ms` | **`96.7 ms`** | `109.0 ms` | `89.1–109.0 ms` | `hkg1` (`HIT`) |
| Supabase `GET /auth/v1/health` (Tokyo) | `200` | `0.1 KB` | `196.6 ms` | **`112.6 ms`** | `123.0 ms` | `110.4–123.0 ms` | `HKG` → Tokyo |
| `GET /api/health` (Zero-DB Serverless) | `200` | `0.1 KB` | `261.3 ms` | **`123.0 ms`** | `127.8 ms` | `105.7–127.8 ms` | `hkg1::hnd1` |
| `GET /api/dashboard` (`0018` RPC) | `200` | `2.2 KB` | `229.4 ms` | **`217.1 ms`** | `219.9 ms` | `174.5–219.9 ms` | `hkg1::hnd1` |
| `GET /api/sets` | `200` | `0.6 KB` | `259.4 ms` | **`233.9 ms`** | `255.7 ms` | `229.0–255.7 ms` | `hkg1::hnd1` |
| `GET /api/sets/[id]` (250Q, `0018` RPC) | `200` | `1.2 KB` | `206.1 ms` | **`195.1 ms`** | `231.1 ms` | `179.9–231.1 ms` | `hkg1::hnd1` |
| `GET /api/sets/[id]/questions?pageSize=50&fields=summary` | `200` | `118.3 KB` | `733.0 ms` | **`474.5 ms`** | `638.1 ms` | `376.8–638.1 ms` | `hkg1::hnd1` |
| `GET /api/sets/[id]/questions?pageSize=100` | `200` | `244.6 KB` | `488.9 ms` | **`468.4 ms`** | `509.4 ms` | `432.5–509.4 ms` | `hkg1::hnd1` |
| `GET /api/sets/[id]/questions?pageSize=500` | `200` | `612.9 KB` | `743.2 ms` | **`689.2 ms`** | `910.6 ms` | `586.1–910.6 ms` | `hkg1::hnd1` |
| `GET /api/exams/[attemptId]` (250Q) | `200` | `406.4 KB` | `439.5 ms` | **`331.4 ms`** | `428.5 ms` | `276.5–428.5 ms` | `hkg1::hnd1` |
| `POST /api/exams` (250Q Create) | `201` | `406.4 KB` | `1,454.5 ms` | **`887.2 ms`** | `1,077.8 ms` | `810.8–1,077.8 ms` | `hkg1::hnd1` |
| `GET /api/preferences` | `200` | `0.4 KB` | `204.8 ms` | **`172.2 ms`** | `210.9 ms` | `161.8–210.9 ms` | `hkg1::hnd1` |
| `GET /api/checkpoints` | `200` | `0.0 KB` | `199.7 ms` | **`173.0 ms`** | `179.2 ms` | `163.2–179.2 ms` | `hkg1::hnd1` |
| `GET /api/search?q=Thermodynamics` | `200` | `18.1 KB` | `363.7 ms` | **`219.9 ms`** | `336.1 ms` | `204.8–336.1 ms` | `hkg1::hnd1` |
| `GET /api/uploads/signed-url` (JSON) | `200` | `0.76 KB` | `511.4 ms` | **`211.1 ms`** | `285.2 ms` | `190.2–285.2 ms` | `hkg1::hnd1` |
| `GET /api/uploads/signed-url?redirect=1` | `302` | `0 KB` | `183.5 ms` | — | — | `CC: private, max-age=1800; Vary: Cookie` | `hkg1::hnd1` |
| `POST /api/uploads/image` (1×1 PNG) | `201` | — | `2,618.9 ms` | — | — | Single cold upload + Storage write + `media_assets` | `hkg1::hnd1` |

**Key API Takeaways:**
- Co-location in `hnd1` remains rock-solid: `/api/health` warm median (`123.0 ms`) is within `10.4 ms` of direct Supabase Tokyo RTT (`112.6 ms`).
- Core single-RPC reads (`/api/dashboard` `217.1 ms`, `/api/sets/[id]` `195.1 ms`, `/api/preferences` `172.2 ms`, `/api/checkpoints` `173.0 ms`, `/api/search` `219.9 ms`, `/api/uploads/signed-url` `211.1 ms`) and 250-Q exam creation (`887.2 ms` warm median) are healthy.
- **Standout API Bottleneck:** `GET /api/sets/[id]/questions?pageSize=50&fields=summary` averages **`474.5 ms` warm median (`638.1 ms` p95, `733.0 ms` cold)** — actually *slower* than `pageSize=100` full (`468.4 ms`)! That proves latency is dominated by **4 sequential server-to-Supabase round-trips** (`requireAuth()` → `requireStudySetAccess()` → `questions` + `count: "exact"` → `question_options` + `starred_questions`) rather than row volume (`PERF-03`).

---

## 4. Lighthouse 13.6.0 Mobile Lab (`/` & `/login`)

*Each route was measured `N = 3` times under BOTH default Simulated Mobile (`simulate`, apples-to-apples with V3.1) and DevTools-Throttled Mobile (`--preset=perf`, `devtools`).*

| Metric (Median of `N = 3`) | `/` V3.1 Ref (`sim`) | `/` V3.2 Baseline (`sim`) | `/` V3.2 (`devtools`) | `/login` V3.1 Ref (`sim`) | `/login` V3.2 Baseline (`sim`) | `/login` V3.2 (`devtools`) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| **Performance Score** | `97` | **`100`** | **`57`** ⚠️ | `93` | **`95`** | **`77`** ⚠️ |
| **Accessibility / Best Practices** | `96` / `100` | **`100` / `100`** | `100` / `100` | `96` / `100` | **`100` / `100`** | `100` / `100` |
| **TTFB (`server-response-time`)** | `33 ms` | `33 ms` | `563 ms` | `32 ms` | `33 ms` | `563 ms` |
| **FCP** | `1,039 ms` | `1,038 ms` | `7,788 ms` | `964 ms` | `964 ms` | `3,382 ms` |
| **LCP** | `1,039 ms` | `1,038 ms` | `7,788 ms` | `2,914 ms` | **`2,914 ms`** ⚠️ | `3,392 ms` |
| **CLS** | `0.0000` | `0.0000` | `0.0000` | `0.0020` | `0.0000` | `0.0027` |
| **Total Blocking Time (TBT)** | `201 ms` | `21 ms` | `143 ms` | `171 ms` | `34 ms` | `190 ms` |
| **Speed Index / TTI** | `1,281` / `2,340 ms` | `1,038` / `2,797 ms` | `7,505` / `12,807 ms` | `1,430` / `2,914 ms` | `964` / `3,226 ms` | `4,250` / `9,086 ms` |
| **Total Byte Weight** | `454.0 KiB` | **`572.7 KiB` (`+118.7`)** ⚠️ | `572.5 KiB` | `446.0 KiB` | **`647.8 KiB` (`+201.8`)** ⚠️ | `647.9 KiB` |
| **Unused JavaScript** | `27 KiB` | `27.4 KiB` | `27.4 KiB` | `26 KiB` | `26.4 KiB` | `26.4 KiB` |
| **Render-Blocking Savings** | `0 ms` | `0 ms` | `0 ms` | `0 ms` | **`146 ms`** ⚠️ | `136 ms` |
| **JS Bootup / Mainthread Work** | `476` / `1,195 ms` | `234` / `853 ms` | `496` / `1,509 ms` | `565` / `1,141 ms` | `291` / `721 ms` | `716` / `1,532 ms` |

**Critical Discovery from Raw Lighthouse Waterfall (`PERF-01`):**
While simulated scores hit `100` (`/`) and `95` (`/login`), the branding update (`39952bd`) introduced **+118.7 KiB on `/`** and **+201.8 KiB on `/login`**! Inspecting `network-requests` in the raw trace proved WHY `/login` stays stuck at `2,914 ms` LCP and drops to `57`/`77` under real DevTools 4G throttling:
1. `BrandLogo` (`src/components/layout/brand-logo.tsx:64-118`) renders **both** `dark:hidden` and `hidden dark:block` `<img>` elements simultaneously with `fetchPriority="high"`, so browsers download **both** Light and Dark PNGs (`logo-main.png` `47.0 KB` + `logo-main-dark.png` `36.3 KB` on `/login`; `logo-full.png` `50.6 KB` + `logo-full-dark.png` `40.1 KB` on `/`).
2. On `/login`, `<Link href="/">` (`src/components/auth/auth-shell.tsx:22`) prefetches `/` RSC flight data whose `priority="high"` brand logos immediately trigger **two MORE High-priority downloads (`/brand/logo-full.png` `50.7 KB` + `/brand/logo-full-dark.png` `40.1 KB`) right on `/login`** — **5 brand PNGs totaling `187.2 KB`** competing against the `17 KiB` render-blocking stylesheet (`146 ms`) and `131 KiB` `Inter` fonts (`47.6` + `83.6 KiB`)!

---

## 5. Complete Playwright + CDP Route Matrix (3 Profiles × Cold & Warm × 10 Routes = 60 Runs)

### 5.1 Profile 1 — Desktop Wi-Fi (`1440×900`, Unthrottled, `1×` CPU)

#### Cold Cache
| Route | TTFB | FCP | LCP | CLS | TBT (`LT/max`) | Wall | Reqs (`dupRsc`) | JS Tr / Raw | APIs (`max`) | Heap | DOM |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `/` | `32.5` | `308` | `308` | `0.0000` | `0` (`0/0`) | `1,649` | `33` (`3`) | `256.0 / 764.1 KB` | `0` (`0`) | `5.50 MB` | `465` |
| `/login` | `33.0` | `308` | `308` | `0.0028` | `0` (`0/0`) | `1,674` | `36` (`3`) | `259.1 / 771.2 KB` | `0` (`0`) | `5.95 MB` | `205` |
| `/dashboard` | `33.3` | `784` | `1,132` | `0.0004` | `0` (`0/0`) | `2,568` | `40` (`3`) | `324.1 / 972.6 KB` | `2` (`305`) | `7.52 MB` | `545` |
| `/library` | `33.0` | `612` | `776` | `0.0004` | `0` (`0/0`) | `2,306` | `40` (`2`) | `324.1 / 972.6 KB` | `3` (`389`) | `7.91 MB` | `496` |
| `/sets/[id]` (250Q) | `35.5` | `1,516` | **`2,368`** | `0.0006` | `0` (`0/0`) | `3,579` | `49` (`3`) | `377.4 / 1,136.2 KB` | `5` (`943`) | **`19.81 MB`** ⚠️ | **`3,835`** ⚠️ |
| `/sets/[id]/flashcards` | `34.0` | `744` | `2,108` | `0.0000` | `0` (`0/0`) | `4,099` | `48` (`3`) | `345.4 / 1,030.5 KB` | `9` (`561`) | `7.58 MB` | `403` |
| `/sets/[id]/practice` | `33.7` | `544` | `1,772` | `0.0000` | `0` (`0/0`) | `2,959` | `44` (`1`) | `354.7 / 1,061.0 KB` | `8` (`439`) | `7.30 MB` | `551` |
| `/sets/[id]/learn` | `33.4` | `776` | `2,048` | `0.0000` | `0` (`0/0`) | `3,236` | `46` (`1`) | `362.4 / 1,085.0 KB` | `9` (`602`) | `7.69 MB` | `420` |
| `/exams/new` | `33.3` | `1,260` | `1,468` | `0.0004` | `0` (`0/0`) | `3,118` | `45` (`3`) | `366.7 / 1,111.6 KB` | `3` (`300`) | `10.03 MB` | **`1,220`** ⚠️ |
| `/exams/[attemptId]` (250Q) | `33.8` | `516` | `1,316` | `0.0001` | `0` (`0/0`) | `3,323` | `41` (`1`) | **`382.2 / 1,146.4 KB`** ⚠️ | `2` (`368`) | `7.90 MB` | `583` |

#### Warm Cache (`0 KB` JS Transfer)
| Route | TTFB | FCP | LCP | CLS | TBT | Wall | Reqs (`dupRsc`) | APIs (`max`) | Heap |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `/` | `31.6` | `208` | `208` | `0.0000` | `0` | `1,482` | `33` (`3`) | `0` (`0`) | `5.49 MB` |
| `/login` | `31.5` | `180` | `180` | `0.0028` | `0` | `1,414` | `36` (`3`) | `0` (`0`) | `5.96 MB` |
| `/dashboard` | `32.7` | `388` | `624` | `0.0004` | `0` | `2,085` | `40` (`3`) | `2` (`204`) | `7.47 MB` |
| `/library` | `32.3` | `360` | `560` | `0.0004` | `0` | `2,111` | `40` (`2`) | `3` (`244`) | `7.75 MB` |
| `/sets/[id]` (250Q) | `32.1` | `416` | `1,268` | `0.0008` | `0` | `2,231` | `49` (`3`) | `5` (`751`) | **`17.98 MB`** ⚠️ |
| `/sets/[id]/flashcards` | `79.9` | `544` | `1,692` | `0.0000` | `0` | `3,552` | `47` (`3`) | `8` (`580`) | `7.23 MB` |
| `/sets/[id]/practice` | `31.6` | `340` | `1,464` | `0.0000` | `0` | `2,685` | `43` (`1`) | `7` (`505`) | `7.58 MB` |
| `/sets/[id]/learn` | `31.2` | `444` | `1,776` | `0.0000` | `0` | `2,909` | `45` (`1`) | `8` (`578`) | `7.34 MB` |
| `/exams/new` | `31.8` | `520` | `520` | `0.0004` | `0` | `2,173` | `45` (`3`) | `3` (`327`) | `10.19 MB` |
| `/exams/[attemptId]` (250Q) | `31.9` | `512` | `1,008` | `0.0001` | `0` | `2,022` | `40` (`1`) | `1` (`303`) | `7.47 MB` |

---

### 5.2 Profile 2 — Simulated Mobile 4G (`390×844`, `1.6 Mbps / 750 Kbps`, `150 ms` RTT, `4×` CPU)

#### Cold Cache
| Route | TTFB | FCP | LCP | CLS | TBT (`LT/max`) | Wall | Reqs (`dupRsc`) | JS Tr / Raw | APIs (`max`) | Heap |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `/` | `150.4` | `1,972` | `1,972` | `0.0238` | `524` (`3/403`) | `4,969` | `33` (`3`) | `256.0 / 764.1 KB` | `0` (`0`) | `5.48 MB` |
| `/login` | `150.2` | `1,828` | `2,528` | `0.0026` | `163` (`1/213`) | `5,209` | `36` (`3`) | `259.1 / 771.2 KB` | `0` (`0`) | `5.98 MB` |
| `/dashboard` | `150.1` | `3,452` | `3,856` | `0.0000` | `224` (`3/216`) | `5,775` | `40` (`3`) | `324.1 / 972.6 KB` | `2` (`233`) | `7.42 MB` |
| `/library` | `150.4` | `3,688` | `3,688` | `0.0000` | `402` (`2/272`) | `5,566` | `40` (`2`) | `324.1 / 972.6 KB` | `3` (`460`) | `7.60 MB` |
| `/sets/[id]` (250Q) | `150.3` | `2,192` | `4,076` | `0.0000` | **`486` (`5/253`)** | `5,790` | `49` (`3`) | `377.4 / 1,136.2 KB` | `5` (`1,035`) | **`21.11 MB`** ⚠️ |
| `/sets/[id]/flashcards` | `150.1` | `2,112` | **`5,356`** | `0.0000` | `249` (`3/223`) | `7,297` | `48` (`3`) | `345.4 / 1,030.5 KB` | `9` (`799`) | `7.46 MB` |
| `/sets/[id]/practice` | `150.2` | `2,072` | **`5,296`** | `0.0000` | `324` (`3/239`) | `5,820` | `44` (`1`) | `354.7 / 1,061.0 KB` | `8` (`606`) | `7.56 MB` |
| `/sets/[id]/learn` | `150.1` | `2,224` | **`5,116`** | `0.0000` | `263` (`3/198`) | `6,240` | `46` (`1`) | `362.4 / 1,085.0 KB` | `9` (`693`) | `7.14 MB` |
| `/exams/new` | `150.2` | `4,416` | `4,416` | `0.0000` | **`774` (`4/421`)** ⚠️ | `5,456` | `42` (`3`) | `345.2 / 1,046.1 KB` | `3` (`565`) | `8.59 MB` |
| `/exams/[attemptId]` (250Q) | `150.1` | `2,344` | `4,584` | `0.0000` | `270` (`2/237`) | `5,895` | `41` (`1`) | `382.2 / 1,146.4 KB` | `2` (`429`) | `7.33 MB` |

#### Warm Cache (`0 KB` JS Transfer)
| Route | TTFB | FCP | LCP | CLS | TBT (`LT/max`) | Wall | Reqs (`dupRsc`) | APIs (`max`) | Heap |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `/` | `150.1` | `936` | `936` | `0.0000` | `387` (`2/244`) | `1,601` | `33` (`3`) | `0` (`0`) | `5.52 MB` |
| `/login` | `150.2` | `316` | `524` | `0.0025` | `110` (`1/160`) | `2,331` | `36` (`3`) | `0` (`0`) | `5.98 MB` |
| `/dashboard` | `150.2` | `952` | `1,360` | `0.0000` | `238` (`3/228`) | `2,179` | `40` (`3`) | `2` (`252`) | `7.37 MB` |
| `/library` | `150.1` | `988` | `988` | `0.0000` | `203` (`2/155`) | `2,804` | `40` (`2`) | `3` (`236`) | `8.06 MB` |
| `/sets/[id]` (250Q) | `150.3` | `888` | `1,700` | `0.0000` | **`433` (`6/212`)** ⚠️ | `3,254` | `49` (`3`) | `5` (`502`) | **`15.09 MB`** ⚠️ |
| `/sets/[id]/flashcards` | `150.1` | `372` | **`2,776`** ⚠️ | `0.0000` | **`491` (`3/225`)** ⚠️ | `3,296` | `45` (`1`) | `8` (`509`) | `7.23 MB` |
| `/sets/[id]/practice` | `150.2` | `476` | **`3,056`** ⚠️ | `0.0000` | `210` (`2/204`) | `3,745` | `42` (`1`) | `6` (`1,828`) | `7.17 MB` |
| `/sets/[id]/learn` | `150.0` | `396` | `2,296` | `0.0000` | `226` (`2/168`) | `2,992` | `45` (`1`) | `8` (`426`) | `7.35 MB` |
| `/exams/new` | `150.3` | `1,104` | `1,104` | `0.0000` | **`385` (`4/195`)** | `2,311` | `45` (`3`) | `3` (`308`) | `9.12 MB` |
| `/exams/[attemptId]` (250Q) | `150.2` | `480` | `1,996` | `0.0000` | `287` (`4/196`) | `2,732` | `40` (`1`) | `1` (`290`) | `6.97 MB` |

---

### 5.3 Profile 3 — Slow 4G (`360×800`, `400 Kbps / 400 Kbps`, `400 ms` RTT, `4×` CPU)

| Route | Cold FCP | Cold LCP | Cold TBT | Cold Wall | Warm FCP | Warm LCP | Warm CLS | Warm TBT | Warm Wall |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `/` | `5,300` | `5,300` | `402` | `13,850` | `1,048` | `1,048` | `0.0000` | `228` | `3,116` |
| `/login` | `6,276` | `9,504` | `124` | `15,473` | `608` | `932` | `0.0113` | `144` | `3,289` |
| `/dashboard` | `10,040` | `10,760` | `218` | `13,349` | `1,320` | `1,900` | `0.0000` | `301` | `2,460` |
| `/library` | `10,612` | `10,612` | `355` | `13,249` | `1,204` | `1,204` | `0.0000` | `212` | `2,346` |
| `/sets/[id]` (250Q) | `7,100` | `12,040` | **`556`** | `14,769` | `1,136` | `2,360` | `0.0000` | **`465`** | `3,163` |
| `/sets/[id]/flashcards` | `7,008` | `13,508` | `279` | `15,911` | `528` | **`3,544`** | `0.0000` | `325` | `4,067` |
| `/sets/[id]/practice` | `7,128` | `14,084` | `249` | `15,396` | `560` | **`3,044`** | `0.0000` | `132` | `4,378` |
| `/sets/[id]/learn` | `7,368` | `14,024` | `403` | `15,189` | `572` | **`3,056`** | `0.0000` | `175` | `3,706` |
| `/exams/new` | `11,100` | `11,100` | **`507`** | `14,354` | `1,540` | `1,540` | `0.0000` | **`477`** | `2,572` |
| `/exams/[attemptId]` (250Q) | `7,272` | `13,572` | `283` | `14,605` | `584` | `2,736` | `0.0000` | `219` | `3,302` |

*All 60/60 runs measured **`overflowX: false` (`0px` overflow)** and **`dupApiCount: 0`**; CLS stayed **`0.0000–0.0238`** across all 60/60 runs (far below the `0.10` Good threshold).*

---

## 6. Priority SPA Route Transitions (Desktop Wi-Fi & Mobile 4G)

| Priority SPA Transition | Desktop Wi-Fi | Mobile 4G (`4×` CPU) | APIs Fired During Transition (Exact Breakdown) |
| --- | ---: | ---: | --- |
| **Login → Dashboard** | `4,076.9 ms` | `3,088.3 ms` | Supabase `/auth/v1/token` → SSR redirect → `/api/profile` + `/api/dashboard` |
| **Dashboard → Library** | `407.7 ms` | *selector miss*\* | `2` APIs: `GET /api/folders` (`173 ms`), `GET /api/sets` (`272 ms`) |
| **Library → Study Set (250Q)** *(was `6.10s` in V3.1)* | **`1,236.1 ms`** | **`2,107.4 ms`** | `4` APIs: `GET /api/sets/[id]` (`198–212 ms`), `GET /api/checkpoints` (`177–371 ms`), `GET /api/sets/[id]/diagrams` (`290–474 ms`), `GET /api/sets/[id]/questions?pageSize=50&fields=summary` (`404–437 ms`) |
| **Study Set → Flashcards (250Q)** | `2,215.4 ms` | `2,393.3 ms` | **`7` APIs:** redundant `/api/progress` (`170–193 ms`) + redundant `/api/starred` (`185–249 ms`) + `questions` `p1` (`434–550 ms`) → waterfall `p2` & `p3` (`383–569 ms`) → `/api/checkpoints` (`188–199 ms`) + `POST /api/sessions` (`195–220 ms`) |
| **Study Set → Practice (250Q)** | `2,221.7 ms` | `2,422.9 ms` | **`6` APIs:** redundant `/api/starred` (`186–192 ms`) + redundant `/api/progress` (`212 ms`) + `questions` `p1` (`424–447 ms`) → waterfall `p2` & `p3` (`424–517 ms`) → `POST /api/sessions` (`204–266 ms`) |
| **Study Set → Learn (250Q)** | `2,247.0 ms` | `2,265.5 ms` | **`5–7` APIs:** identical `useStudySetBundle` waterfall (`p1` → `p2`+`p3` + redundant `/api/progress` + `/api/starred`) → `/api/checkpoints` + `POST /api/sessions` |
| **Study Set → Exam Builder (`/exams/new`)** | `4,750.5 ms`\*\* | *selector miss*\* | `2` APIs: `GET /api/folders` (`206 ms`), `GET /api/sets` (`3,335 ms` cold-container tail spike\*\*) |
| **Exam Builder → Exam Runner (250Q)** | `2,374.7 ms` | *blocked by above* | **`3` APIs:** `POST /api/exams/preview` (`183 ms`) → `POST /api/exams` (`888 ms`, returns 406 KB) → **redundant `GET /api/exams/[id]` (`245 ms`, re-downloads same 406 KB!)** |
| **Exam Results → Review Mistakes** | `560.2 ms` | `662.4 ms` | `0–1` APIs (`438 ms` Desk / `0` Mob filtered tab) |

*\*Honest methodology note:* On Mobile `390×844`, `locator('a[href="/library"]').first()` and `locator('a[href="/exams"]').first()` matched the hidden desktop sidebar links (`hidden md:flex`) before the visible mobile bottom-bar tabs; all 6 other Mobile 4G transitions plus all 9 Desktop Wi-Fi transitions measured cleanly.  
*\*\*`Study Set → Exam Builder` Desktop experienced a single `3,334.5 ms` serverless cold-start tail on `GET /api/sets` (standalone warm median is `233.9 ms`).*

---

## 7. Interaction Latencies (Desktop Wi-Fi vs Mobile 4G `4×` CPU)

*Measured via `performance.now()` from real Playwright click/input to painted DOM state + `2× requestAnimationFrame`.*

| User Interaction | Desktop Wi-Fi (`1×` CPU) | Mobile 4G (`4×` CPU) | V3.2 Target (`< 100 ms` Tap) | Notes |
| --- | ---: | ---: | --- | --- |
| **Practice — Select Answer → Feedback** | **`60.0 ms`** | `112.0 ms` | Desk PASS / Mob near | Optimistic UI; `POST /api/sessions/[id]/answers` `201` in `305.6 ms` Desk / `279.8 ms` Mob |
| **Practice — Star / Mark Question** | **`42.2 ms`** | `113.0 ms` | Desk PASS / Mob near | Optimistic toggle |
| **Practice — Save Personal Note** | `322.7 ms` (`200`) | *network stall*\* | Blocking on network | Blocks Save button until `POST /api/notes` completes (no optimistic UI) |
| **Flashcards — Flip Card** | **`53.8 ms`** | `128.6 ms` | Desk PASS / Mob `>100ms` | CSS transform flip |
| **Flashcards — Next / Prev Card** | `68.2` / `65.8 ms` | `200.6` / `149.0 ms` | Desk PASS / Mob `>100ms` | Mobile `4×` CPU `nextCard` reaches `200.6 ms` |
| **250Q Exam — Select Answer (A)** | **`58.2 ms`** | `130.4 ms` | Desk PASS / Mob `>100ms` | `0` blocking APIs (400ms debounced autosave) |
| **250Q Exam — Change Answer (A → B)** | **`66.0 ms`** | `117.1 ms` | Desk PASS / Mob `>100ms` | `0` blocking APIs |
| **250Q Exam — Flag / Mark Question** | **`66.4 ms`** | `100.7 ms` | Desk PASS / Mob border | `0` blocking APIs |
| **250Q Exam — Next / Prev (`Q1↔Q2`)** | `67.8` / `65.2 ms` | `117.6` / `97.4 ms` | Desk PASS / Mob border | `0` APIs |
| **250Q Exam — Open Mobile Nav Sheet** | N/A | **`251.1 ms`** ⚠️ | Mobile Sheet sluggish | Radix Sheet mount + virtualizer measure on `4×` CPU |
| **250Q Exam — Quick Jump `Q1 → Q200`** | **`45.7 ms`** | **`202.6 ms`** ⚠️ | Desk PASS / Mob `>100ms` | Input fill + Enter + sheet close + render |
| **250Q Exam — Quick Jump `Q200 → Q250`** | **`51.8 ms`** | **`186.4 ms`** ⚠️ | Desk PASS / Mob `>100ms` | Virtualized navigator scroll + render |
| **Global Search (`Ctrl+K`) — Typing → Results** | `431 ms` type / **`1,260 ms` total** | `544 ms` type / **`1,391 ms` total** | Debounce + Search RTT | `/api/search` RTT `595 ms` Desk / `358 ms` Mob + input debounce |

*\*Mobile 4G `saveNote` hit a 12s response wait timeout while throttled network was still flushing preceding Practice session/star requests.*

---

## 8. Local Baseline Verification Suite (`39952bd`)

| Gate Command | Exit Code | Exact Result |
| --- | :---: | --- |
| `npm run typecheck` (`tsc --noEmit`) | **`0`** | `0` TypeScript errors |
| `npm run lint` (`eslint .`) | **`0`** | `0` ESLint errors, `0` React Hooks violations |
| `npm run test` (`vitest run`, v5.1.1) | **`0`** | **`53 / 53` test files passed**, **`395` passed \| `1` skipped (`396` total)** in `35.91s` (including all 4 live Supabase PG 17.12 integration suites) |
| `npm run build` (`next build`, Turbopack 16.4.6) | **`0`** | Compiled in `3.0s`, TS `4.4s`, `65 / 65` static pages generated cleanly |

*Note:* Vitest printed a non-fatal Vite advisory: `jsdom` environment was instantiated 53 times (`46%` of total test runtime) and `vitest.config.ts` loads ESM in CJS mode.

---

## 9. Next.js Client Bundle, Client Boundary & React Rerender Hotspot Audit

### 9.1 Server-Only & Lazy-Split Heavy Package Isolation
Scanned all `.next/static/chunks/*.js` generated by `npm run build` and verified live runtime chunks:

| Package / Subsystem | Client Bundle Presence | Raw / Gzip / Brotli | Isolation Verdict |
| --- | --- | ---: | --- |
| `pdf-lib`, `pdfjs-dist`, `exceljs`, `jszip`, `papaparse`, `fast-xml-parser` | **0 client chunks** | **`0.0 KB`** | **PASS** — 100% server-only |
| `mammoth` | **0 imports in `src/`** | `0.0 KB` | **Unused dependency** in `package.json` |
| `@tiptap/*` (`ProseMirror`) | `3gnmaj3ipu8j_.js` (lazy) | `466.4 / 145.0 / 122.3 KB` | **PASS** — loaded only on `/sets/[id]/edit` |
| `recharts` | `35pjer013o2q4.js` (dynamic) | `463.6 / 129.5 / 106.0 KB` | **PASS** — loaded only via `next/dynamic` on `/statistics` |
| `katex` | `18smp4bpe1be3.js` (dynamic) | `260.2 / 75.6 / 62.5 KB` | **PASS** — `SafeMathFragment.tsx` dynamic `import("katex")` only when math syntax exists |
| `@supabase/supabase-js` | `0bafbvo1daef1.js` | `254.9 / 66.6 / 56.3 KB` | **PASS** — zero eager load on `/dashboard`, `/library`, `/sets/[id]`, `/practice`, `/exams/[id]` |
| `motion/react` | `05jo0z0y3tbji.js` | `124.9 / 41.6 / 36.6 KB` | **PASS** — scoped to `DiagramStudyPlayer`, `MatchClient`, `SpellModeClient`, `WriteClient` |
| `idb` + `src/lib/offline/*` | `3toytq0ry6x22.js`, `2i-wmxf4l-fqo.js` | `126.7 / 38.6 / 33.9 KB` | Deferred after `load` + `requestIdleCallback` in `PwaProvider` |
| Core React 19 + Next 16 Runtime | `06fa0o9g49w7i.js` + `1h2hdkqrc4kvb.js` | `385.8 / 117.7 KB` tr | Fixed platform floor across all routes |

### 9.2 Client Boundary & Route JS Footprint
- **App Router Pages:** `39 / 40` `page.tsx` files are Server Components (`1` intentional client page: `src/app/offline/page.tsx`). Across `src/`, `113` files are `"use client"` and `237` are server/shared modules.
- **Live Transferred JS vs V3.1 Budget:**
  - `/`: `256.0 KB` tr (`764.1 KB` raw) — `+56 KB` over stretch `< 200 KB` (platform React+Next floor is `117.7 KB` tr).
  - `/exams/[attemptId]` (250Q): **`382.2 KB` tr (`1,146.4 KB` raw)** — crept `+37.2 KB` above V3.1's `345.0 KB` (`< 350 KB` budget)!
  - `/sets/[id]`: **`377.4 KB` tr (`1,136.2 KB` raw)** — 2nd heaviest route in live runtime!

### 9.3 React Rerender & DOM Hotspots Identified
1. **`StudySetHub` (`src/components/library/study-set-hub.tsx`):** Renders `PAGE_SIZE = 50` unvirtualized question cards simultaneously (each mounting `<RichContentRenderer>` for prompt + 4 options + explanation + badges + actions) → **`3,835` DOM nodes**, **`19.81–21.11 MB` JS Heap** (2.7× higher than 250Q Live Exam!), and **`433–556 ms` Mobile/Slow 4G TBT**!
2. **`CustomExamBuilderClient` (`src/components/exam/CustomExamBuilderClient.tsx`):** `2,600+`-line monolithic client component mounting **`1,220` DOM nodes** even on Step 1 with a single study set → **`774 ms` Mobile 4G Cold TBT** (worst TBT in the entire app, max long task `421 ms`!).
3. **`ExamNavigatorGrid` (`src/components/exam/ExamNavigatorGrid.tsx:92-127`):** `LiveExamRunner` rebuilds the `items` array whenever `answerMap` updates, which invalidates `subjects`, `filteredEntries`, AND re-triggers `useEffect` → `rowVirtualizer.scrollToIndex(...)` on **every answer tap or flag click**, not just when `currentIndex` changes!
4. **`PracticeClient` (`src/components/learning/PracticeClient.tsx:290-359`):** Direct-Start renders `"config"` phase for 1 frame, then runs `setTimeout(..., 0)` inside `useEffect` to synchronously shuffle & map all 250 items and switch to `"active"` phase — adding an avoidable double-render right on LCP!

---

## 10. Prioritized Root-Cause Bottleneck Register (Actionable for Waves 2–4)

| ID | Severity | Symptom / Measured Baseline | Verified Root Cause (File & Line Evidence) | Recommended V3.2 Fix |
| --- | :---: | --- | --- | --- |
| **`PERF-01`** | **P1** | `/login` Sim LCP **`2,914 ms`** (`>2.5s`), `+201.8 KiB` byte weight (`446→648 KiB`), `/` DevTools 4G LH **`57`** (`+118.7 KiB`) | `src/components/layout/brand-logo.tsx:64-118` renders BOTH `dark:hidden` and `hidden dark:block` `<img>` with `fetchPriority="high"`, downloading both light+dark PNGs. Worse, `AuthShell.tsx:22` `<Link href="/">` prefetches `/` RSC payload whose `priority="high"` logos trigger 2 MORE High-priority PNGs (`logo-full.png` + `logo-full-dark.png`) on `/login` (**5 PNGs = `187.2 KB`**!), plus `public/brand/*.png` has `Cache-Control: max-age=0, must-revalidate`. | Convert brand logos to `<picture>` / optimized WebP/AVIF (or theme-resolved single `<img>` / CSS mask / lightweight SVG) so only ONE variant downloads; set `prefetch={false}` on `AuthShell` `<Link href="/">`; add long-lived `Cache-Control` headers for `/brand/*` in `next.config.ts`. |
| **`PERF-02`** | **P1** | `/sets/[id]/practice` Mobile 4G Warm LCP **`3,056 ms`**, `/flashcards` **`2,776 ms`**; SPA transitions **`2.2–2.4 s`** firing **6–7 APIs** | `useStudySetBundle.tsx:59-66` + `api-client.ts:238-287`: (1) fires **redundant** `GET /api/progress` and `GET /api/starred` even though `GET /api/sets/[id]/questions` already queries & returns `progress` and `is_starred` (`questions/route.ts:235-255`); (2) blocks Q1 render on a **2-wave waterfall** (`page=1` → then `page=2`+`page=3`, ~613 KB total) before `POST /api/sessions`; (3) `PracticeClient.tsx:338-359` double-renders `"config"` → `setTimeout(0)` → `"active"`. | Eliminate redundant `/api/progress` & `/api/starred` calls by reading `is_starred`/`progress` directly from questions payload (or single bootstrap RPC); render Q1 immediately from Page 1 (or cached Set Hub preview) while prefetching remaining pages in background; initialize Practice directly in `"active"` phase when `!wantsManualSetup`. |
| **`PERF-03`** | **P1** | `/sets/[id]` allocates **`19.8–21.1 MB` Heap** (`3,835` DOM nodes, **`433–556 ms`** Mobile/Slow 4G TBT); `questions?pageSize=50&fields=summary` is **`474.5 ms` warm med** (`638 ms` p95) | (1) `study-set-hub.tsx:139` renders 50 unvirtualized full question cards synchronously; (2) `src/app/api/sets/[id]/questions/route.ts:38-207` executes **4 sequential server-to-Supabase RTTs** (`getUser()` → `requireStudySetAccess()` → `questions` + `count: "exact"` → `options` + `starred`) instead of a single DB RPC or embedded select! | Virtualize or paginate question preview list (`20–25` initial cards + `content-visibility: auto` or `@tanstack/react-virtual`); collapse `GET /api/sets/[id]/questions` summary query into a single SQL RPC or PostgREST embedded select (`questions(..., question_options(...))`) to cut API latency from `475 ms` → `~180 ms`. |
| **`PERF-04`** | **P1** | `/exams/new` has worst Mobile 4G Cold TBT (**`774 ms`**, max LT `421 ms`, `1,220` DOM nodes); `Exam Builder → Exam Runner` takes **`2.37 s`** & re-downloads **`406.4 KB`** | (1) `CustomExamBuilderClient.tsx:909-939` & `859` call `router.push('/exams/' + id)` **without** seeding `queryClient.setQueryData(["exam-attempt", id], created)`, causing an immediate redundant `GET /api/exams/[id]` (`245–439 ms`, `406.4 KB`); (2) monolithic 2,600-line client component mounts all step sub-trees/controls eagerly. | Seed `queryClient.setQueryData(["exam-attempt", created.attempt.id], created)` before `router.push` (instant `0 ms` Exam Runner hydration!); split Step 2 / Step 3 / Presets / Coverage tabs into lazy sub-components. |
| **`PERF-05`** | **P1** | Historical multimedia DOCX Import (`11.88 s`) & single `POST /api/uploads/image` (`2,619 ms`) | `src/app/api/import/commit/route.ts:534-743` runs **4 sequential Storage/DB RTTs per image** (`consumeTempUploadBytes` → `storage.upload` → `media_assets.select` → `media_assets.insert`) inside a sequential `for` loop (`N` images × 4 RTTs = 7–10s!), followed by sequential chunked table inserts. | Deduplicate & process unique media attachments with a bounded concurrent pool (`concurrency = 6`) + single batched `media_assets` upsert (`onConflict`), and parallelize independent child inserts (`question_options`, `question_accepted_answers`, `question_tags`, `content_media_relations`) after `questions.insert`. |
| **`PERF-06`** | **P2** | `1–3` duplicate `_rsc` prefetch pairs per route; `/brand/*` assets revalidate on every load (`max-age=0`) | Next.js 16 default `<Link>` prefetching fires segment + full `_rsc` fetches across navigation links (`/` ↔ `/login`, `/dashboard` ↔ `/library`); static `/brand/*` files inherit default `max-age=0, must-revalidate`. | Audit high-fanout navigation `<Link prefetch={false}>` on auth/header links; configure `Cache-Control: public, max-age=31536000, immutable` (or `max-age=86400, stale-while-revalidate=604800`) for `/brand/*` & `/icons/*` in `next.config.ts`. |
| **`PERF-07`** | **P2** | Mobile `4×` CPU interaction latencies **`101–251 ms`** (`openMobileNavSheet: 251 ms`, `jumpQ1toQ200: 203 ms`, `Flashcards next: 201 ms`, `Save Note: 323 ms` blocking) | `ExamNavigatorGrid.tsx:119-127` runs `rowVirtualizer.scrollToIndex` on every `answerMap` update (via `filteredEntries` dep); Mobile Sheet mounts heavy virtualized grid synchronously inside sheet animation; `QuestionNotesAndReportBar.tsx:107-130` awaits network before showing saved state. | Decouple `scrollToIndex` from `filteredEntries` (trigger only on `currentIndex` / filter changes); defer navigator tile detail rendering until sheet open settles; add optimistic feedback on Save Note. |
| **`PERF-08`** | **P3** | `/exams/[attemptId]` live transferred JS **`382.2 KB`** (`+32.2 KB` above `< 350 KB` budget); unused `mammoth` in `package.json` | Focus routes share common UI/Radix/Zod/TanStack chunks (`1,146 KB` raw); `mammoth` has `0` imports in `src/`. | Remove unused `mammoth` dependency; audit focus-route imports to pull `/exams/[attemptId]` back under `350 KB` transferred JS. |

---

## 11. Live Production Baseline Screenshots Inventory

All 14 live production baseline screenshots were captured on commit `39952bd` (`https://studyhub-three-mauve.vercel.app`) under `docs/audit/v3.2-stability/screenshots/before/`. Every screenshot passed `overflowX: false` (`0px` horizontal overflow) and verified the latest transparent StudyHub logo & Academic Calm Light/Dark palette:

| Screenshot File | Viewport | Theme | Verified Highlights |
| --- | --- | --- | --- |
| `landing-desktop-light.png` | `1440×900` | Light | Latest transparent `logo-full.png` + crisp header `StudyHub` wordmark, zero overflow |
| `landing-desktop-dark.png` | `1440×900` | Dark | Clean dark `logo-full-dark.png` contrast on navy surface |
| `login-desktop-light.png` | `1440×900` | Light | Crisp `logo-main.png` centered above login card |
| `dashboard-desktop-light.png` / `dashboard-desktop-dark.png` | `1440×900` | Light / Dark | Focused dashboard KPIs + Continue Learning card |
| `set-hub-desktop-light.png` / `set-hub-mobile-light.png` | `1440×900` / `390×844` | Light | Study-first Set Hub (250Q) with 3 labeled controls & zero mobile CLS |
| `practice-desktop-light.png` | `1440×900` | Light | Direct-Start Practice Q1 active immediately |
| `exam-250q-desktop-light.png` / `exam-250q-mobile-light.png` | `1440×900` / `390×844` | Light | 250-Q Live Exam Runner with server timer, always-visible `Nộp bài`, crisp mobile bottom bar |
| `landing-mobile-light.png` / `landing-mobile-dark.png` | `390×844` | Light / Dark | Responsive hero & branding, `0px` horizontal overflow |
| `dashboard-mobile-light.png` / `dashboard-mobile-dark.png` | `390×844` | Light / Dark | 4-tab mobile bottom nav (`Trang chủ` / `Thư viện` / `Thi thử` / `Cá nhân`) |
