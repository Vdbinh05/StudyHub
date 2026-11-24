# StudyHub V3.1 — Production Performance Baseline (BEFORE Overhaul)

> **Audit Scope:** Read-only live production performance profiling of **`https://studyhub-three-mauve.vercel.app`** (`v3.0-checkpoint`, commit `a3c3330`, Vercel project `binhs-projects-438b34e8/studyhub` / `prj_ddcCZOt10qpV0RbMGltVLyNN29fN`).  
> **Generated:** `2026-11-24T18:23:18Z` (`2026-11-25 01:23 +07:00`, client vantage: Vietnam broadband IP).  
> **Measurement Type Disclosure (Honest Lab Methodology):** **100% of metrics in this document are repeatable Lab measurements** collected via Playwright Chromium + Chrome DevTools Protocol (`Network.emulateNetworkConditions` + `Emulation.setCPUThrottlingRate`) and Lighthouse `13.6.0` simulated Mobile throttling against the live Vercel production deployment + live Supabase Cloud PostgreSQL 17.12 database. **No field CrUX / RUM data is claimed or interpolated.** Zero source code, database schema, or deployment configuration changes were made during Wave 0.

---

## 1. Executive Summary — Why StudyHub V3.0 Feels Slow on Mobile & Desktop

Empirical live profiling reveals a **compounding dual bottleneck** — roughly **55%–70% Backend/Cross-Region Network Architecture Tax** on authenticated data routes and **30%–45% Frontend JS Bundle, Hydration, Waterfall & Prefetch Storm Tax**:

| Critical Metric (Live Production V3.0 BEFORE) | Desktop Wi-Fi (Unthrottled) | Simulated Mobile 4G (1.6 Mbps, 150ms, 4× CPU) | Slow 4G (400 Kbps, 400ms, 4× CPU) | Root Cause Attribution |
| --- | ---: | ---: | ---: | --- |
| **Landing `/` Cold LCP / TBT / JS (tr / raw)** | `364 ms` / `0 ms` / `335.9 / 1,330.9 KB` | **`2,116 ms` / `374 ms`** / `335.9 / 1,330.9 KB` | **`7,244 ms` / `411 ms`** / `335.9 / 1,330.9 KB` | **Frontend:** Global `katex.min.css` render-blocking CSS (`+150ms`), eager root `MotionConfig` + `QueryClient` + `ShortcutProvider` modals + dual i18n bundle + `141.5 KB` fonts |
| **Login `/login` Cold LCP / TBT / JS (tr / raw)** | `400 ms` / `0 ms` / `402.4 / 1,337.0 KB` | **`4,008 ms` / `515 ms`** / `402.9 / 1,337.0 KB` | **`12,684 ms` / `314 ms`** / `402.9 / 1,337.0 KB` | **Frontend:** `68.3 KB` (`254.9 KB` raw, **94% unused**) auth/Supabase chunk + `43.2 KB` (`86% unused`) Motion chunk eagerly loaded on `/login` |
| **Dashboard `/dashboard` Cold LCP / Wall / Reqs** | `1,596 ms` / `4,221 ms` / **`103 reqs`** | **`5,176 ms` / `7,673 ms`** / `72 reqs` | **`13,900 ms` / `16,910 ms`** / `69 reqs` | **Both:** Client-only mount fires 3 cross-region `iad1` APIs (`936–1,687 ms` each) + **`103` total requests** (uncontrolled `<Link>` RSC prefetch storm) + `2,897 KB` raw JS |
| **Set Detail `/sets/[id]` (250Q) Cold LCP / Wall** | `2,040 ms` / **`6,816 ms`** / **`117 reqs`** | `2,984 ms` / `6,084 ms` (Warm **`8,048 ms`**) | **`16,432 ms` / `21,814 ms`** / `TBT 896 ms` | **Both:** `589.8 KB` tr (`2,585 KB` raw) JS + client waterfall (`GET /api/sets/[id]` blocks `questions?pageSize=500` which takes **`3,023–3,842 ms`** — spiking to **`16.3 s`** under Mobile 4G SPA transition!) |
| **Live 250-Q Exam `/exams/[attemptId]` Cold LCP / TBT** | `2,672 ms` / `0 ms` / `567.2 KB` tr JS | **`6,744 ms` / `628 ms`** / `559.8 KB` tr JS | **`17,912 ms` / `1,012 ms`** / `559.5 KB` tr JS | **Both:** `567 KB` tr (`1,836 KB` raw) JS + `GET /api/exams/[attemptId]` takes **`1,696–2,877 ms`** (`396.3 KB` raw JSON across `iad1 <-> Tokyo`) |
| **Flashcards `/sets/[id]/flashcards` (250Q) Cold LCP / Wall** | **`7,740 ms` / `10,585 ms`** | **`11,008 ms` / `14,311 ms`** (`TBT 668 ms`) | **`21,576 ms` / `24,917 ms`** (`TBT 641 ms`) | **Backend + Client Waterfall:** Serial pagination (`page=1` -> `page=2` -> `page=3`, `2.0–2.6 s` **each** across `iad1 <-> Tokyo`) + `POST /api/sessions` (`1.2–1.9 s`) = **9 API calls totaling ~10s even on Wi-Fi!** |
| **Practice `/sets/[id]/practice` (250Q) Cold LCP / Wall** | **`6,364 ms` / `7,711 ms`** | **`11,876 ms` / `13,389 ms`** (`TBT 529 ms`) | **`21,440 ms` / `22,731 ms`** (`TBT 571 ms`) | **Backend + Client Waterfall:** Same 3 serial `questions?pageSize=100` fetches + `GET /api/sets/[id]` refetch (doesn't reuse cache) + `565 KB` tr JS |
| **`POST /api/exams` (250-Q Exam Creation)** | **`6,731 ms`** (`6.73 s`) | **`6,731 ms+`** | **`6,731 ms+`** | **Backend (`iad1` ↔ Tokyo):** Double `getUser()` + full-bank progress/starred scans + 3 serial option chunks + RPC across transpacific hop |
| **In-Exam Navigation (`Q1 -> Q2` / `Q2 -> Q50`, 250Q)** | `65.6 ms` / `33.3 ms` (`0` API calls) | **`116.3 ms` / `391.3 ms`** (+`359 ms` drawer open) | N/A | **Frontend (4× Mobile CPU):** `Q1` option tap = **`130.4 ms`** on Mobile 4G (above `100 ms` target) due to hidden desktop `ExamNavigatorGrid` + un-memoized `LiveExamRunner` tree re-renders |

**Bottom Line:** Even with **warm browser cache (`0 KB` JS transferred)**, authenticated study flows still take **`4.5–10.6 seconds`** on Mobile 4G (`3.9–9.9 seconds` on Desktop Wi-Fi!) because **every single API request pays a ~900–3,500 ms transpacific tax (`Vietnam -> hkg1 -> iad1 US East -> ap-northeast-1 Tokyo -> iad1 -> hkg1 -> Vietnam`) multiplied by double `auth.getUser()` and serial pagination waterfalls.**

---

## 2. Empirical Region, Edge POP & Direct Network RTT Evidence

### 2.1 Verified Vercel Deployment Topology (`vercel project inspect studyhub`)
- **Project:** `binhs-projects-438b34e8/studyhub` (`prj_ddcCZOt10qpV0RbMGltVLyNN29fN`)
- **Runtime:** Next.js on Node.js `24.x`
- **Configured Serverless Function Region:** **`iad1` (Washington, D.C. — US East)** *(no `vercel.json` region override present in V3.0)*
- **Failover Regions:** `None`
- **Supabase Cloud Database & Auth Region:** **`ap-northeast-1` (Tokyo, Japan)**

### 2.2 Live Network Path Probe (Vietnam Broadband Vantage -> Vercel vs Direct Supabase)

| Probe Target | Edge / Execution Header (`x-vercel-id` / `cf-ray`) | Cache / Compression | Cold Run (ms) | Warm Runs (ms) | Warm Median (ms) | What It Proves |
| --- | --- | --- | ---: | --- | ---: | --- |
| `GET /` (Static HTML via Vercel CDN) | `hkg1::48phc-...` | `HIT` / `br` (`48.5 KB` raw) | `495.8` (cold TLS) | Browser warm TTFB: `92.4–117.0` | **`~95 ms`** | Static edge delivery from Hong Kong (`hkg1`) is fast (`<120 ms`). |
| Direct Supabase `/auth/v1/health` (Tokyo) | `cf-ray: ...-HKG` | Direct TLS | `506.8` (cold TLS) | `114.5`, `143.2`, `115.3` | **`115.3 ms`** | Direct Vietnam -> Supabase Tokyo RTT is **`~115 ms`** (via HKG edge). |
| `GET /api/health` (**ZERO DB queries**) | `hkg1::iad1::fwjnw-...` | `MISS` / `br` (`89 B`) | `355.3` (`554.2` in API suite) | `334.9`, `314.0` (suite: `415.9, 431.6, 418.9`) | **`324–419 ms`** | Pure **`hkg1 -> iad1` transpacific penalty = `+215–305 ms`** BEFORE executing a single line of SQL! |
| `GET /api/preferences` (1 tiny row, `0.4 KB`) | `hkg1::iad1::xjfv8-...` | `MISS` / `br` | `875.6` | `864.3`, `876.1`, `1,093.5` | **`876.1 ms`** | `~350 ms` (`VN <-> iad1`) + **`~525 ms`** for `3` serial `iad1 <-> Tokyo` RTTs (`proxy getUser` + `handler getUser` + `SELECT preferences`, ~`170–175 ms`/RTT)! |

### 2.3 Exact Frontend vs Backend/Network Latency Split

Decomposing Cold vs Warm Mobile 4G loads proves how much latency belongs to **Frontend** vs **Backend/Network**:

| Route (Mobile 4G, `390×844`, 1.6 Mbps, 150ms, 4× CPU) | Cold LCP | Warm LCP (`0 KB` JS transfer) | Pure Frontend Cold Delta (JS/Font/CSS Download + Cold Parse) | Remaining Warm Latency (Backend API + Client Hydration/Waterfall) | Dominant Bottleneck |
| --- | ---: | ---: | ---: | ---: | --- |
| `/` (Landing) | `2,116 ms` | `476 ms` | **`+1,640 ms` (77.5%)** | `476 ms` (22.5%) | **Frontend** (`336 KB` tr JS + `142 KB` fonts + blocking `katex.min.css`) |
| `/login` | `4,008 ms` | `472 ms` | **`+3,536 ms` (88.2%)** | `472 ms` (11.8%) | **Frontend** (`403 KB` tr JS incl. 94% unused `68 KB` chunk + 86% unused Motion) |
| `/dashboard` | `5,176 ms` | `2,232 ms` | `+2,944 ms` (56.9%) | **`2,232 ms` (43.1%)** | **Split 57% Frontend / 43% Backend** (`GET /api/dashboard` `1,426 ms` + empty client shell) |
| `/library` | `4,184 ms` | `872 ms` | **`+3,312 ms` (79.2%)** | `872 ms` (20.8%) *(wall `4,559 ms` waiting on `/api/sets`)* | **Frontend for FCP/LCP (`1,945 KB` raw JS), Backend for data settle (`4.56 s`)** |
| `/sets/[id]` (250Q) | `2,984 ms` | `2,792 ms` *(wall `8,048 ms`)* | `+192 ms` LCP (`+614 ms` TBT) | **`8,048 ms` full settle** (`questions?pageSize=500` `3,700 ms` AFTER `sets/[id]` `1,347 ms`) | **Backend + Client Waterfall (70%) + Heavy `582 KB` JS (`TBT 614 ms`) (30%)** |
| `/exams/[attemptId]` (250Q) | `6,744 ms` | `3,000 ms` *(wall `4,567 ms`)* | `+3,744 ms` (55.5%) | **`3,000 ms` (44.5%)** (`GET /api/exams/[id]` `1,971 ms` + `576 ms` doc TTFB) | **Split 55% Frontend (`560 KB` tr JS, `TBT 628 ms`) / 45% Backend (`iad1` 250Q API)** |
| `/sets/[id]/flashcards` (250Q) | **`11,008 ms`** | **`7,312 ms`** *(wall `10,556 ms`)* | `+3,696 ms` (33.6%) | **`7,312 ms` (66.4%)** (`3` serial `questions` pages + `POST /api/sessions`) | **Backend + Serial Pagination Waterfall (66%) + Heavy `546 KB` JS (`TBT 668 ms`) (34%)** |
| `/sets/[id]/practice` (250Q) | **`11,876 ms`** | **`7,708 ms`** *(wall `9,232 ms`)* | `+4,168 ms` (35.1%) | **`7,708 ms` (64.9%)** (`3` serial `questions` pages + `sets/[id]` refetch) | **Backend + Serial Pagination Waterfall (65%) + Heavy `557 KB` JS (`TBT 529 ms`) (35%)** |

---

## 3. Repeatable Profiling Methodology (Wave 0 ↔ Wave 5 Exact Re-Run Contract)

To guarantee an honest, apples-to-apples **Before vs After** comparison in Wave 5, all browser, CDP, API, and interactive benchmarks were collected using a single self-contained, parameterized script:

- **Reusable Profiler Script Path:**  
  `C:\Users\Admin\.gemini\antigravity\brain\bb9b62d7-7caa-408c-a9be-55e909fed0d7\scratch\v31-prod-perf-profiler.mjs`
- **Wave 0 Exact Invocation:**
  ```powershell
  node "C:\Users\Admin\.gemini\antigravity\brain\bb9b62d7-7caa-408c-a9be-55e909fed0d7\scratch\v31-prod-perf-profiler.mjs" --url "https://studyhub-three-mauve.vercel.app" --out "C:\Users\Admin\.gemini\antigravity\brain\bb9b62d7-7caa-408c-a9be-55e909fed0d7\scratch\v31-baseline-raw.json"
  ```
- **Wave 5 After-Overhaul Re-Run Command:**
  ```powershell
  node "C:\Users\Admin\.gemini\antigravity\brain\bb9b62d7-7caa-408c-a9be-55e909fed0d7\scratch\v31-prod-perf-profiler.mjs" --url "https://studyhub-three-mauve.vercel.app" --out "C:\Users\Admin\.gemini\antigravity\brain\bb9b62d7-7caa-408c-a9be-55e909fed0d7\scratch\v31-after-raw.json"
  ```
- **Lighthouse Mobile Lab Re-Run Command (Playwright Chromium):**
  ```powershell
  $env:CHROME_PATH = "C:\Users\Admin\AppData\Local\ms-playwright\chromium-1255\chrome-win64\chrome.exe"
  npx --yes lighthouse "https://studyhub-three-mauve.vercel.app/" --output=json --output-path=".\lh-landing-mobile.json" --chrome-flags="--headless=new --no-sandbox" --only-categories=performance,accessibility,best-practices
  npx --yes lighthouse "https://studyhub-three-mauve.vercel.app/login" --output=json --output-path=".\lh-login-mobile.json" --chrome-flags="--headless=new --no-sandbox" --only-categories=performance,accessibility,best-practices
  ```
- **Seeded Synthetic Fixture (Identical Across Runs, Isolated Disposable Account):**
  - 1 disposable account (`v31-perf-<timestamp>@studyhub-test.local`) created via Admin API and authenticated via real Supabase SSR cookies.
  - Primary study set: **250 synthetic MC questions** across 5 chapters (4 options each, Vietnamese text, zero `sample-data/` content).
  - Secondary study set: **50 synthetic MC questions** + 40 `user_question_progress` rows + 10 `starred_questions` rows.
  - 1 live `in_progress` **250-question exam attempt** generated via live `POST /api/exams`.
- **Exact CDP Emulation Profiles:**
  1. **Desktop Wi-Fi:** `1440×900`, DPR `1`, unthrottled network, `1×` CPU.
  2. **Simulated Mobile 4G:** `390×844`, DPR `2`, touch enabled, `1.6 Mbps` down (`209,715 B/s`) / `750 Kbps` up (`96,000 B/s`), `150 ms` RTT, `4×` CPU throttle.
  3. **Slow 4G:** `360×800`, DPR `2`, touch enabled, `400 Kbps` down/up (`51,200 B/s`), `400 ms` RTT, `4×` CPU throttle.
- **Cold vs Warm Definition:** Each route opens in a fresh isolated `BrowserContext` (empty HTTP cache, empty SW cache) for **Cold**, followed immediately by a second full navigation in the same context for **Warm** (`fromDiskCache` / `304`).

---

## 4. Lighthouse Mobile Lab Audit (`/` & `/login`)

*Executed with Lighthouse `13.6.0` (`formFactor: mobile`, `throttlingMethod: simulate`) on `2026-11-24T18:03Z` — **Lab simulation**, not field CrUX.*

| Metric (Lighthouse Mobile Lab) | `/` (Landing) | `/login` | Target Budget (V3.1) |
| --- | ---: | ---: | ---: |
| **Performance Score** | **90** | **80** | `>= 95` (`/` & `/login`) |
| **Accessibility Score** | **96** | **96** | `>= 98` |
| **Best Practices Score** | **100** | **100** | `100` |
| **TTFB (`server-response-time`)** | `32 ms` | `32 ms` | `< 100 ms` |
| **FCP** | `1,405 ms` | `972 ms` | `< 1,000 ms` |
| **LCP** | `1,405 ms` | **`3,672 ms`** | `< 1,800 ms` |
| **Speed Index** | `2,785 ms` | `1,192 ms` | `< 2,000 ms` |
| **TBT (Total Blocking Time)** | **`396 ms`** | **`399 ms`** | **`< 150 ms`** |
| **CLS** | `0.0000` | `0.0000` | `< 0.05` |
| **TTI** | `3,759 ms` | `3,672 ms` | `< 2,500 ms` |
| **Total Byte Weight (Transferred)** | `522 KiB` | `587 KiB` | `< 320 KiB` |
| **Unused JavaScript** | `51 KiB` (`150 ms` est.) | **`127 KiB` (`600 ms` est.)** | `< 30 KiB` |
| **JS Bootup / Mainthread Work** | `774 ms` / `1,655 ms` | `819 ms` / `1,425 ms` | `< 400 ms` / `< 900 ms` |

### Exact Lighthouse Diagnostic Culprits (Observed Live Chunks)
1. **Unused `68.3 KB` transferred (`254.9 KB` raw) JS chunk on `/login`** (`/_next/static/immutable/chunks/29e36pwlix64j.js` — **`94%` unused / `63.9 KB` wasted**): eager auth/Supabase client chunk pulled onto the static login form before user submits.
2. **Unused `43.2 KB` transferred (`123.5 KB` raw) JS chunk on `/` & `/login`** (`/_next/static/immutable/chunks/0l96oqu5-686h.js` — **`57%` unused on `/`, `86%` unused on `/login`**, `284 ms` bootup): `motion/react` loaded globally via `<MotionConfig>` in `src/app/providers.tsx`.
3. **Render-blocking second stylesheet (`1g2p4-jn34vrq.css`, `5.6 KB`, `150 ms` est. savings):** `import "katex/dist/katex.min.css"` at `src/app/layout.tsx:3` blocks first paint on **every** route including `/` and `/login`.
4. **Heavy core bootup chunk (`3nd1huny3feo9.js`, `74.0 KB` tr / `229.6 KB` raw, `440–553 ms` JS eval on simulated mobile CPU)** + **`131.2 KB` (`83.6 KB + 47.6 KB`) `.woff2` fonts** loaded upfront on every cold visit.

---

## 5. Complete Cold vs Warm Route Matrix (All 3 Profiles × All 9 Routes)

> **Column Legend:** `TTFB` = Navigation `responseStart - startTime`; `FCP` / `LCP` / `TBT` / `Max LT` (Long Task count / max duration ms) / `Wall` (wall-clock settle ms); `Reqs (Cache)` = total network requests (served from disk/SW cache); `JS Tr / Raw` = transferred (br/gzip) vs uncompressed decoded JS KB; `Total Tr` = total transferred bytes across all resource types (incl. CSS `~20.7 KB` tr / `119.6 KB` raw, Fonts `~141.5 KB` cold, and API responses).

### 5.1 Profile 1 — Desktop Wi-Fi (`1440×900`, Unthrottled, `1×` CPU) — Lab

#### Cold Cache
| Route | TTFB | FCP | LCP | CLS | TBT | Long Tasks (cnt/max) | Wall Settled | Reqs (Cache) | JS Tr / Raw (KB) | API Tr (KB) | Total Tr (KB) | APIs (Count / Slowest) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `/` | `142 ms` | `364 ms` | `364 ms` | `0.0000` | `0 ms` | `1 / 50 ms` | `3,127 ms` | `40 (5)` | `335.9 / 1,330.9` | `0.0` | `520.1` | `0` |
| `/login` | `105 ms` | `336 ms` | `400 ms` | `0.0019` | `0 ms` | `0 / 0 ms` | `2,035 ms` | `39 (4)` | `402.4 / 1,337.0` | `0.0` | `579.8` | `0` |
| `/dashboard` | `123 ms` | `512 ms` | `1,596 ms` | `0.0004` | `0 ms` | `0 / 0 ms` | `4,221 ms` | **`103 (29)`** | `432.9 / 2,897.4` | `2.4` | `657.0` | `3` (`1,066 ms`) |
| `/library` | `114 ms` | `532 ms` | `1,428 ms` | `0.0004` | `0 ms` | `0 / 0 ms` | `4,292 ms` | **`101 (26)`** | `446.5 / 2,416.7` | `1.7` | `667.9` | `4` (`957 ms`) |
| `/sets/[id]` (250Q) | `113 ms` | `676 ms` | `2,040 ms` | `0.0078` | `9 ms` | `1 / 59 ms` | **`6,816 ms`** | **`117 (23)`** | **`589.8 / 2,585.1`** | `47.2` | `867.2` | `7` (**`3,400 ms`**) |
| `/exams/new` | `104 ms` | `556 ms` | `556 ms` | `0.0012` | `0 ms` | `2 / 56 ms` | `3,450 ms` | `90 (24)` | `418.0 / 2,402.0` | `1.9` | `629.6` | `4` (`1,041 ms`) |
| `/exams/[attemptId]` (250Q) | `105 ms` | `688 ms` | **`2,672 ms`** | `0.0001` | `0 ms` | `0 / 0 ms` | `4,024 ms` | `47 (2)` | **`567.2 / 1,836.4`** | `44.3` | `783.9` | `2` (`1,794 ms`) |
| `/sets/[id]/flashcards` | `108 ms` | `568 ms` | **`7,740 ms`** | `0.0000` | `0 ms` | `0 / 0 ms` | **`10,585 ms`** | `54 (0)` | `553.9 / 1,727.2` | `49.7` | `776.8` | `9` (**`2,495 ms`** × serial) |
| `/sets/[id]/practice` | `106 ms` | `608 ms` | **`6,364 ms`** | `0.0001` | `0 ms` | `0 / 0 ms` | **`7,711 ms`** | `50 (0)` | `565.2 / 1,757.5` | `49.0` | `785.0` | `7` (**`2,012 ms`** × serial) |

#### Warm Cache (`0 KB` JS/CSS/Font network transfer — pure Backend + Hydration cost!)
| Route | TTFB | FCP | LCP | CLS | TBT | Wall Settled | Reqs (Cache) | Total Tr (KB) | Slowest API |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `/` | `117 ms` | `200 ms` | `200 ms` | `0.0000` | `0 ms` | `1,931 ms` | `40 (32)` | `0.6` | — |
| `/login` | `99 ms` | `128 ms` | `172 ms` | `0.0019` | `0 ms` | `1,794 ms` | `39 (33)` | `0.5` | — |
| `/dashboard` | `230 ms` | `336 ms` | `2,044 ms` | `0.0004` | `0 ms` | `4,512 ms` | `102 (63)` | `11.8` | `1,687 ms` (`/api/dashboard`) |
| `/library` | `193 ms` | `328 ms` | `1,440 ms` | `0.0004` | `0 ms` | `3,981 ms` | `100 (60)` | `12.6` | `1,142 ms` (`/api/folders`) |
| `/sets/[id]` (250Q) | **`663 ms`** | `924 ms` | **`2,656 ms`** | `0.0078` | `0 ms` | **`7,184 ms`** | `116 (63)` | `66.9` | **`3,143 ms`** (`questions?pageSize=500`) |
| `/exams/new` | `255 ms` | `416 ms` | `416 ms` | `0.0012` | `0 ms` | `3,264 ms` | `89 (59)` | `5.4` | `1,496 ms` (`/api/folders`) |
| `/exams/[attemptId]` (250Q) | **`644 ms`** | `676 ms` | **`2,532 ms`** | `0.0001` | `0 ms` | `3,931 ms` | `46 (41)` | `45.6` | `1,760 ms` (`/api/exams/[id]`) |
| `/sets/[id]/flashcards` | `460 ms` | `500 ms` | **`7,168 ms`** | `0.0000` | `0 ms` | **`9,944 ms`** | `53 (38)` | `54.8` | **`2,580 ms`** (`questions?page=2`, serial) |
| `/sets/[id]/practice` | `481 ms` | `528 ms` | **`7,276 ms`** | `0.0001` | `0 ms` | **`8,664 ms`** | `49 (39)` | `51.7` | **`2,657 ms`** (`questions?page=2`, serial) |

---

### 5.2 Profile 2 — Simulated Mobile 4G (`390×844`, `1.6 Mbps / 750 Kbps`, `150 ms` RTT, `4×` CPU) — Lab

#### Cold Cache
| Route | TTFB | FCP | LCP | CLS | TBT | Long Tasks (cnt/max) | Wall Settled | Reqs (Cache) | JS Tr / Raw (KB) | API Tr (KB) | Total Tr (KB) | APIs (Count / Slowest) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `/` | `225 ms` | `2,116 ms` | `2,116 ms` | `0.0000` | **`374 ms`** | `5 / 320 ms` | `4,700 ms` | `40 (5)` | `335.9 / 1,330.9` | `0.0` | `519.9` | `0` |
| `/login` | `221 ms` | `1,916 ms` | **`4,008 ms`** | `0.0019` | **`515 ms`** | `4 / 372 ms` | `5,045 ms` | `39 (4)` | `402.9 / 1,337.0` | `0.0` | `580.2` | `0` |
| `/dashboard` | `226 ms` | `3,924 ms` | **`5,176 ms`** | `0.0000` | **`361 ms`** | `8 / 296 ms` | **`7,673 ms`** | `72 (18)` | `426.1 / 2,495.6` | `3.1` | `623.8` | `3` (`1,367 ms`) |
| `/library` | `222 ms` | `4,184 ms` | **`4,184 ms`** | `0.0000` | `90 ms` | `6 / 492 ms` | `5,005 ms` | `60 (7)` | `439.2 / 1,563.5` | `1.5` | `623.3` | `4` (`951 ms`) |
| `/sets/[id]` (250Q) | `223 ms` | `2,984 ms` | `2,984 ms` | `0.0000` | **`614 ms`** | `6 / 376 ms` | **`6,084 ms`**\* | `63 (11)` | **`582.1 / 2,149.1`** | `2.0`\* | `770.0`\* | `3`\* (`1,195 ms`) |
| `/exams/new` | `221 ms` | `3,808 ms` | **`3,808 ms`** | `0.0007` | `39 ms` | `5 / 347 ms` | `6,389 ms` | `62 (12)` | `410.1 / 1,970.4` | `1.7` | `597.8` | `4` (`983 ms`) |
| `/exams/[attemptId]` (250Q) | `222 ms` | `2,492 ms` | **`6,744 ms`** | `0.0000` | **`628 ms`** | `5 / 278 ms` | **`8,242 ms`** | `47 (3)` | **`559.8 / 1,836.4`** | `44.9` | `776.9` | `2` (`1,939 ms`) |
| `/sets/[id]/flashcards` | `222 ms` | `2,428 ms` | **`11,008 ms`** | `0.0000` | **`668 ms`** | `6 / 288 ms` | **`14,311 ms`** | `54 (1)` | `546.1 / 1,727.2` | `49.7` | `768.8` | `9` (**`2,455 ms`** × serial) |
| `/sets/[id]/practice` | `233 ms` | `2,692 ms` | **`11,876 ms`** | `0.0000` | **`529 ms`** | `5 / 288 ms` | **`13,389 ms`** | `50 (1)` | `556.5 / 1,757.5` | `49.0` | `776.3` | `7` (**`2,587 ms`** × serial) |

*\*Note on `/sets/[id]` Mobile 4G Cold:* Because `study-set-hub.tsx` gates the 4 secondary queries (`questions`, `diagrams`, `checkpoints`, `starred`) behind `enabled: Boolean(setQuery.data)`, `networkidle` fired during the brief gap after `GET /api/sets/[id]` finished before the dependent wave began — on Warm (and Slow 4G Cold), all 7 API calls completed (`46.8 KB` API payload, **`8,048 ms` warm wall**, **`3,700 ms` slowest API**).

#### Warm Cache (`0 KB` JS/CSS/Font network transfer)
| Route | TTFB | FCP | LCP | CLS | TBT | Long Tasks (cnt/max) | Wall Settled | Reqs (Cache) | Duplicates | Slowest API |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `/` | `95 ms` | `476 ms` | `476 ms` | `0.0000` | `80 ms` | `2 / 286 ms` | `3,047 ms` | `40 (32)` | `0` | — |
| `/login` | `96 ms` | `244 ms` | `472 ms` | `0.0019` | `21 ms` | `2 / 69 ms` | `2,655 ms` | `39 (33)` | `0` | — |
| `/dashboard` | `206 ms` | `668 ms` | `2,232 ms` | `0.0000` | `127 ms` | `3 / 177 ms` | `4,562 ms` | `71 (51)` | `0` | `1,426 ms` (`/api/dashboard`) |
| `/library` | `190 ms` | `872 ms` | `872 ms` | `0.0000` | `0 ms` | `2 / 210 ms` | `4,559 ms` | `67 (46)` | `0` | `1,317 ms` (`/api/folders`) |
| `/sets/[id]` (250Q) | **`697 ms`** | `916 ms` | `2,792 ms` | `0.0000` | **`276 ms`** | `4 / 187 ms` | **`8,048 ms`** | `82 (50)` | **`4` (`×2` `_rsc`)** | **`3,700 ms`** (`questions?pageSize=500`) |
| `/exams/new` | `242 ms` | `1,108 ms` | `1,108 ms` | `0.0007` | `0 ms` | `2 / 341 ms` | `3,627 ms` | `61 (46)` | `0` | `956 ms` (`/api/folders`) |
| `/exams/[attemptId]` (250Q) | **`576 ms`** | `680 ms` | **`3,000 ms`** | `0.0000` | `112 ms` | `2 / 131 ms` | `4,567 ms` | `46 (41)` | `0` | `1,971 ms` (`/api/exams/[id]`) |
| `/sets/[id]/flashcards` | `426 ms` | `560 ms` | **`7,312 ms`** | `0.0000` | `149 ms` | `3 / 112 ms` | **`10,556 ms`** | `53 (38)` | `0` | **`2,370 ms`** (`questions?page=2`, serial) |
| `/sets/[id]/practice` | `436 ms` | `588 ms` | **`7,708 ms`** | `0.0000` | `85 ms` | `2 / 121 ms` | **`9,232 ms`** | `49 (39)` | `0` | **`2,451 ms`** (`questions?page=2`, serial) |

---

### 5.3 Profile 3 — Slow 4G (`360×800`, `400 Kbps / 400 Kbps`, `400 ms` RTT, `4×` CPU) — Lab

#### Cold Cache
| Route | TTFB | FCP | LCP | CLS | TBT | Long Tasks (cnt/max) | Wall Settled | Reqs (Cache) | JS Tr / Raw (KB) | Total Tr (KB) | Slowest API |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `/` | `481 ms` | `7,244 ms` | **`7,244 ms`** | `0.0247` | **`411 ms`** | `6 / 302 ms` | `14,554 ms` | `40 (5)` | `335.9 / 1,330.9` | `519.3` | — |
| `/login` | `473 ms` | `6,684 ms` | **`12,684 ms`** | `0.0083` | `314 ms` | `4 / 209 ms` | `15,810 ms` | `39 (4)` | `402.9 / 1,337.0` | `580.2` | — |
| `/dashboard` | `473 ms` | `12,232 ms` | **`13,900 ms`** | `0.0000` | `389 ms` | `8 / 405 ms` | `16,910 ms` | `69 (17)` | `426.6 / 2,455.2` | `621.3` | `1,372 ms` |
| `/library` | `473 ms` | `12,108 ms` | **`12,108 ms`** | `0.0000` | `54 ms` | `4 / 308 ms` | `16,580 ms` | `62 (13)` | `438.7 / 1,944.8` | `626.3` | `1,436 ms` |
| `/sets/[id]` (250Q) | `473 ms` | `8,436 ms` | **`16,432 ms`** | `0.0000` | **`896 ms`** | `7 / 362 ms` | **`21,814 ms`** | `77 (11)` | **`582.2 / 2,149.1`** | `824.3` | **`3,842 ms`** |
| `/exams/new` | `479 ms` | `11,840 ms` | **`11,840 ms`** | `0.0001` | `30 ms` | `5 / 358 ms` | `15,990 ms` | `62 (12)` | `411.1 / 1,970.4` | `597.7` | `1,589 ms` |
| `/exams/[attemptId]` (250Q) | `471 ms` | `8,092 ms` | **`17,912 ms`** | `0.0000` | **`1,012 ms`** | `5 / 598 ms` | **`19,410 ms`** | `47 (3)` | **`559.5 / 1,836.4`** | `776.7` | **`2,877 ms`** |
| `/sets/[id]/flashcards` | `472 ms` | `7,792 ms` | **`21,576 ms`** | `0.0000` | **`641 ms`** | `6 / 284 ms` | **`24,917 ms`** | `54 (1)` | `546.1 / 1,727.2` | `768.8` | **`2,665 ms`** × serial |
| `/sets/[id]/practice` | `472 ms` | `8,060 ms` | **`21,440 ms`** | `0.0000` | **`571 ms`** | `5 / 282 ms` | **`22,731 ms`** | `50 (1)` | `556.5 / 1,757.5` | `776.9` | **`2,439 ms`** × serial |

#### Warm Cache (`0 KB` JS/CSS/Font network transfer)
| Route | TTFB | FCP | LCP | CLS | TBT | Long Tasks (cnt/max) | Wall Settled | Reqs (Cache) | Slowest API |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `/` | `94 ms` | `612 ms` | `612 ms` | `0.0000` | `179 ms` | `3 / 430 ms` | `2,364 ms` | `40 (32)` | — |
| `/login` | `92 ms` | `204 ms` | `496 ms` | `0.0000` | `79 ms` | `2 / 104 ms` | `3,171 ms` | `39 (33)` | — |
| `/dashboard` | `189 ms` | `624 ms` | `2,068 ms` | `0.0000` | `157 ms` | `5 / 139 ms` | `4,786 ms` | `68 (50)` | `1,406 ms` |
| `/library` | `241 ms` | `852 ms` | `852 ms` | `0.0000` | `0 ms` | `2 / 156 ms` | `3,976 ms` | `61 (46)` | `1,016 ms` |
| `/sets/[id]` (250Q) | `481 ms` | `800 ms` | `2,464 ms` | `0.0000` | `246 ms` | `4 / 173 ms` | **`7,561 ms`** | `76 (50)` | **`3,495 ms`** |
| `/exams/new` | `207 ms` | `1,100 ms` | `1,100 ms` | `0.0001` | `7 ms` | `3 / 325 ms` | `4,314 ms` | `61 (46)` | `1,068 ms` |
| `/exams/[attemptId]` (250Q) | `420 ms` | `528 ms` | **`3,752 ms`** | `0.0000` | `91 ms` | `2 / 111 ms` | `5,326 ms` | `46 (41)` | **`2,842 ms`** |
| `/sets/[id]/flashcards` | `435 ms` | `560 ms` | **`7,772 ms`** | `0.0000` | `168 ms` | `3 / 123 ms` | **`11,358 ms`** | `53 (38)` | **`2,482 ms`** × serial |
| `/sets/[id]/practice` | `444 ms` | `648 ms` | **`8,152 ms`** | `0.0000` | `171 ms` | `2 / 192 ms` | **`9,706 ms`** | `49 (39)` | **`2,673 ms`** × serial |

> **Key Slow-4G Takeaway:** On a student's weak 4G / 3G mobile connection (`400 Kbps`), **a cold visit to Flashcards or Practice takes `21.4–21.6 seconds` to LCP (`22.7–24.9 seconds` to settle)**, and a 250-Q Exam takes **`17.9 seconds` to LCP with `1,012 ms` Total Blocking Time**!

---

## 6. Direct HTTPS API Latency Matrix (Cold vs Warm, Live Production)

*Measured directly via Node `fetch` with real authenticated Supabase SSR cookies (no browser/CPU/4G throttling — isolates pure Vercel `hkg1 -> iad1` + Supabase `ap-northeast-1` backend latency).*

| API Endpoint | HTTP | Raw Payload | Cold (ms) | Warm Median (ms) | 3 Warm Runs (ms) | `x-vercel-id` Hop | Root Cause of Latency |
| --- | ---: | ---: | ---: | ---: | --- | --- | --- |
| `GET /api/health` | `200` | `0.1 KB` | `554.2` | **`418.9`** | `415.9, 431.6, 418.9` | `hkg1::iad1` | Zero DB — pure Vietnam -> `iad1` US East RTT |
| `GET /api/checkpoints` | `200` | `0.0 KB` | `953.5` | **`859.0`** | `883.5, 856.7, 859.0` | `hkg1::iad1` | Double `getUser()` (`proxy` + handler) + 1 DB query × `iad1 <-> Tokyo` |
| `GET /api/preferences` | `200` | `0.4 KB` | `875.6` | **`876.1`** | `864.3, 876.1, 1093.5` | `hkg1::iad1` | Fired on **every** authenticated page mount (`PreferencesProvider`) |
| `GET /api/sets` | `200` | `1.2 KB` | `915.5` | **`896.8`** | `896.8, 874.0, 1075.1` | `hkg1::iad1` | Double `getUser()` + membership + sets lookup across `iad1 <-> Tokyo` |
| `GET /api/sets/[id]` (250Q) | `200` | `1.3 KB` | `1,592.2` | **`1,181.7`** | `1323.9, 1171.9, 1181.7` | `hkg1::iad1` | Downloads full 250-row question/progress scans into Node.js to count chapters & mastery |
| `GET /api/dashboard` | `200` | `4.3 KB` | `1,466.9` | **`1,344.8`** | `1331.4, 1433.5, 1344.8` | `hkg1::iad1` | Multi-query fan-out across `iad1 <-> Tokyo` + double `getUser()` |
| `GET /api/exams/[attemptId]` (250Q) | `200` | `396.3 KB` (`43.9 KB` br) | `1,882.4` | **`1,696.1`** | `1575.0, 1696.1, 1772.8` | `hkg1::iad1` | `250` exam snapshots + options + answers fetched across `iad1 <-> Tokyo` |
| `GET /api/sets/[id]/questions?pageSize=100` | `200` | `249.4 KB` (`17.0 KB` br) | `2,102.6` | **`1,899.1`** | `1899.1, 1867.8, 1953.6` | `hkg1::iad1` | Full `SELECT *` + chunked relation joins; called **3× serially** by Flashcards/Practice! |
| `GET /api/sets/[id]/questions?pageSize=500` | `200` | **`595.3 KB`** (`41.2 KB` br) | **`3,434.8`** | **`2,988.9`** | `2988.9, 2995.8, 2920.2` | `hkg1::iad1` | **`fetchInChunks()` runs sequential `for...await`** (`3` serial 100-ID chunks × `iad1 <-> Tokyo` + full rich JSONB)! |
| `POST /api/exams` (250Q live create) | `201` | `396.3 KB` | **`6,731.0`** | — | — | `hkg1::iad1` | Double `getUser()` + full progress/starred scans + 3 serial option chunks + snapshot RPC across `iad1 <-> Tokyo` |

### Network Request Volume & Duplicate Request Audit
1. **Uncontrolled `<Link>` RSC Prefetch Storm:** Desktop `/dashboard` fires **`103` total network requests**, `/library` fires **`101`**, and `/sets/[id]` fires **`117`** (compared to `60–72` on mobile where the 15-item desktop sidebar is hidden). Every prefetched RSC link hits `src/proxy.ts` and runs an unnecessary `supabase.auth.getUser()` call to Tokyo!
2. **Exact Duplicate Requests Captured Live:** On Mobile 4G Warm `/sets/[id]`, Next.js fired **4 duplicate RSC prefetch pairs** (`GET /sets/[id]/practice?_rsc=... ×2`, `/write ×2`, `/import ×2`, `/edit ×2`) because the page renders duplicate navigation links to the same sub-routes in both the top action bar and the mode cards.
3. **Redundant Cross-Transition API Refetches:**
   - Navigating `Set Detail -> Practice` immediately re-fetches **`GET /api/sets/[id]` (`1,187–2,199 ms`)** AND **`GET /api/starred` (`1,867–2,299 ms`)** AND **`250` questions in 3 serial `pageSize=100` calls** — even though `Set Detail` had ALREADY fetched the exact same set, starred list, and all 250 questions 1 second earlier!
   - Navigating `Dashboard -> Library` on Mobile 4G saw 5 API calls (`preferences`, `dashboard`, `profile`, `folders`, `sets`) because `Dashboard`'s slow cross-region boot APIs were still in flight when the user tapped Library!
   - Navigating `Practice -> Live 250Q Exam` re-fetched **`GET /api/preferences` (`1,367–1,515 ms`)** on full document load.

---

## 7. Interactive Transitions, Answer Tap Latency & 250-Q Exam Navigation

### 7.1 Live SPA Route Transition Latencies

| User Transition | Desktop Wi-Fi (`toVisible` / `toSettled`) | Desktop APIs Fired | Mobile 4G (`toVisible` / `toSettled`) | Mobile 4G APIs Fired | Bottleneck Analysis |
| --- | ---: | ---: | ---: | ---: | --- |
| **Dashboard → Library** | `1,410 ms` / `1,410 ms` | `2` (`folders` `1,090ms`, `sets` `882ms`) | **`2,786 ms`** / `2,786 ms` | `5` (`folders` `1,100ms`, `sets` `1,111ms`, +3 overlapping dashboard mount APIs) | Clean client transition, but gated by `~1.1s` `iad1` API latency |
| **Library → Set Detail (250Q)** | **`5,448 ms`** / `5,448 ms` | `5` (`sets/[id]` `1,445ms` **then** `questions?pageSize=500` `3,023ms`, `starred` `1,349ms`) | **`19,824 ms` (~19.8 s!)** / `19,824 ms` | `5` (`sets/[id]` `1,939ms` **then** `questions?pageSize=500` **`16,285 ms`**, `starred` `3,701ms`) | **SEVERE P0 WATERFALL:** `study-set-hub.tsx` waits for `sets/[id]` before requesting `500` full questions (`595 KB` raw), saturating Mobile 4G + `iad1` serial chunks! |
| **Set Detail → Practice (250Q)** | **`7,506 ms`** / `7,506 ms` | `6` (`sets/[id]` `1,187ms`, `questions p1` `2,413ms` → `p2` `2,127ms` → `p3` `2,203ms`, `progress`, `starred`) | **`10,388 ms` (~10.4 s!)** / `10,388 ms` | `6` (`sets/[id]` `2,199ms`, `p1` `3,739ms` → `p2` `2,953ms` → `p3` `2,411ms`, `progress`, `starred`) | **SEVERE P0 SERIAL PAGINATION:** `fetchStudySetQuestions` fetches `p1 -> p2 -> p3` strictly sequentially AND ignores React Query cache! |
| **Practice → Live 250-Q Exam** | `2,896 ms` / `2,994 ms` | `2` (`preferences` `1,367ms`, `exams/[id]` `1,878ms`) | **`3,609 ms`** / `3,860 ms` | `2` (`preferences` `1,515ms`, `exams/[id]` `2,172ms`) | Single 250-Q payload is well-structured, bottlenecked primarily by `iad1` RTT + `560 KB` JS |

### 7.2 Practice Mode Answer Tap-to-Visible Feedback & Background Persistence

| Metric (Practice Mode Q1 Tap) | Desktop Wi-Fi | Simulated Mobile 4G (4× CPU) | Root Cause & Behavioral Finding |
| --- | ---: | ---: | --- |
| **Tap → Visible Feedback Banner (`role="status"`)** | **`42.4 ms`** | **`204.9 ms`** | Client-side grading renders optimistically (zero wait for server!), **BUT** on `4×` Mobile CPU the re-render of `PracticeClient` + `motion/react` pushes tap feedback over `200 ms` (target `<100 ms`). |
| **`POST /api/sessions/[id]/answers` Completion** | *Did not fire (fallback to `/api/progress`)* | *Did not fire (fallback to `/api/progress`)* | **Real Production Race Bug Found:** `POST /api/sessions` takes `1,228–1,859 ms` across `iad1 <-> Tokyo`. When a student answers Q1 within `400 ms` of clicking Start, `sessionId` is still `null`, so `PracticeClient.tsx:443` skips `study_session_answers` and falls back to `POST /api/progress`! |

### 7.3 Live 250-Question Exam Navigation (`Q1 → Q2 → Q50`)

| Metric (250-Q Live Exam) | Desktop Wi-Fi (`1×` CPU) | Simulated Mobile 4G (`4×` CPU) | Target Budget (V3.1) | Finding |
| --- | ---: | ---: | ---: | --- |
| **Q1 Option Tap → Painted Selection** | **`46.3 ms`** | **`130.4 ms`** | **`< 80 ms`** | Mobile `4×` CPU exceeds `100 ms` instant-feel bar because `<aside className="hidden lg:block"><ExamNavigatorGrid /></aside>` still mounts & recomputes 250 `navigatorItems` + full `V3ExamQuestionBody` re-renders on every tap! |
| **`Q1 → Q2` Next Button Navigation** | **`65.6 ms`** (`0` API calls) | **`116.3 ms`** (`0` API calls) | **`< 80 ms`** (`0` APIs) | Zero blocking API calls (good!), but `4×` CPU re-render overhead doubles paint latency on phones. |
| **Mobile Navigator Sheet Open (`1/250` → Jump Input)** | N/A (always open rail) | **`359.4 ms`** | **`< 150 ms`** | Radix `Sheet` + mounting a **second** `ExamNavigatorGrid` instance (`useVirtualizer`) on `4×` Mobile CPU takes `359 ms`. |
| **`Q2 → Q50` Quick Jump (`50` + Enter)** | **`33.3 ms`** (`0` API calls) | **`391.3 ms`** (`1` async autosave API) | **`< 100 ms`** | Mobile jump closes `Sheet` + re-renders full runner concurrently with the debounced Q1 autosave response (`setSyncState` + `setServerClockOffsetMs` re-render storm). |

---

## 8. Prioritized V3.1 Performance Bottlenecks & Wave 5 Target Budgets

| Priority | Bottleneck | Measured V3.0 Baseline (BEFORE) | V3.1 Target Budget (Wave 5 AFTER) | Owning Workstream |
| --- | --- | --- | --- | --- |
| **P0-1** | **Cross-region Vercel `iad1` (US East) ↔ Supabase `ap-northeast-1` (Tokyo)** | `/api/health` `419 ms`, `/api/preferences` `876 ms`, `/api/dashboard` `1,345 ms`, `POST /api/exams` `6,731 ms` | Pin Vercel `regions: ["hnd1"]` (Tokyo) → `/api/health` `<180 ms`, simple APIs **`<250 ms`**, `/api/dashboard` **`<350 ms`**, `POST /api/exams` **`<1,500 ms`** | Backend (`vercel.json`) |
| **P0-2** | **Double `auth.getUser()` on every `/api/*` + serial `fetchInChunks` + 11-query Dashboard & 11-hop Session Answer** | `questions?pageSize=500` `2,989–3,842 ms`; `sets/[id]` `1,182–1,592 ms` | Exclude `/api/*` from `proxy.ts` double `getUser()`, concurrent `fetchInChunks(4)`, SQL RPCs (`0018`) → `sets/[id]` **`<300 ms`**, `questions?pageSize=50&fields=summary` **`<350 ms`** | Backend (`0018`, `proxy.ts`, APIs) |
| **P0-3** | **Client Waterfalls & Serial Pagination on Study Routes (`/sets/[id]`, `/flashcards`, `/practice`)** | `Library -> Set Detail` **`19.8 s`** (Mobile 4G); `Set -> Practice` **`10.4 s`**; Flashcards Cold LCP **`11.0 s`** (Mobile 4G) / **`21.6 s`** (Slow 4G) | Remove `enabled: Boolean(setQuery.data)` gate, default preview `pageSize=50&fields=summary`, parallel `fetchStudySetQuestions` (concurrency 4) + cache hydration → `Library -> Set` **`<1.8 s`**, `Set -> Practice` **`<2.0 s`**, Flashcards Mobile 4G LCP **`<2.8 s`** | Frontend + Learning/Exam |
| **P0-4** | **Bloated Root Shell & Public JS/CSS (`katex.min.css`, `motion/react`, `ShortcutProvider` modals, eager Supabase on `/login`)** | `/` `336 KB` tr JS (`TBT 374 ms`), `/login` `403 KB` tr JS (`LCP 4.0 s`, `TBT 515 ms`, LH Mobile **80**), `/exams/[id]` `560 KB` tr JS (`TBT 628 ms`, Slow 4G `TBT 1,012 ms`) | `/` **`< 200 KB`** tr JS (`LH Mobile >= 95`, `TBT < 150 ms`), `/login` **`< 200 KB`** tr JS (`LH Mobile >= 95`), `/exams/[id]` **`< 350 KB`** tr JS (`Mobile 4G TBT < 250 ms`) | Frontend Perf |
| **P1-1** | **Uncontrolled `<Link>` RSC Prefetch Storm & Duplicate Prefetches** | **`101–117` requests** on Desktop Dashboard/Library/Set Detail; `4` duplicate `_rsc` pairs on Mobile `/sets/[id]` | Set `prefetch={false}` on list/card/secondary links → **`<= 45` requests** on Dashboard/Library/Set Detail, **`0` duplicate requests** | Frontend UI + Perf |
| **P1-2** | **Mobile 4× CPU Per-Tap Re-render Overhead in `LiveExamRunner` & `PracticeClient`** | Mobile 4G Q1 tap `130.4 ms`, `Q1 -> Q2` `116.3 ms`, `Q2 -> Q50` `391.3 ms`, Practice tap `204.9 ms` | Conditional desktop/mobile `ExamNavigatorGrid` mount + `React.memo(V3ExamQuestionBody)` + drop `AnimatePresence mode="wait"` → Mobile 4G Q1 tap **`< 80 ms`**, `Q1 -> Q2` **`< 80 ms`**, Practice tap **`< 100 ms`** | Learning / Exam |

---

## 9. Post-Profile Hygiene & Real User Data Preservation Attestation

- **Live Profiler Exit Code:** `0` (`task-708`, all 3 profiles × 9 routes × Cold/Warm = `54/54` route captures, `10/10` direct API benchmarks, `2/2` interactive suites succeeded with `navError: null`).
- **Automated Scoped Teardown Output:**
  ```json
  {"trackedUserDeleted":true,"trackedSetsRemaining":0,"trackedMediaRemaining":0}
  ```
- **Real User Data Preservation:** Zero pre-existing real user accounts, study sets, questions, or media objects were queried, altered, or deleted.
- **Privacy & Secret Hygiene:** Zero `.env.local` keys, JWTs, auth cookies, or `sample-data/` aviation question content appear in this baseline report or profiling fixture.
