# StudyHub V3.2 — Performance Before vs After Verification (`PERFORMANCE_BEFORE_AFTER.md`)

> **Owner:** `perf-auditor` / `perf-auditor-2` (Agent 8 — Independent Performance Auditor)  
> **Baseline (BEFORE):** Commit `39952bd` on live Vercel Production (`https://studyhub-three-mauve.vercel.app`, `hkg1::hnd1`, measured `2026-11-25T12:54–13:20Z` — [`BASELINE.md`](BASELINE.md)).  
> **Wave 5 Candidate (AFTER — Local `:3044`):** Commit `7dfabfd` (`release/v3.2-stability`) running compiled Next.js production server on `http://127.0.0.1:3044` connected to live Supabase Cloud (`cuoaifyupfmkstqhcjwy`, measured `2026-11-25T15:18–15:32Z`).  
> **Wave 6 Retest (`V32-014` / `PERF-01` — Local `:3054`):** Wave 6 compiled `.next` (`BrandLogo.tsx` native `<picture><source media="(prefers-color-scheme: dark)" ... /></picture>` fix on top of `7dfabfd`, measured `2026-11-25T15:58–16:13Z` across **both Light Mode & System Dark Mode**).  
> **Wave 7 Production Column:** Reserved for the uncontested apples-to-apples live **`https://studyhub-three-mauve.vercel.app` (`hkg1::hnd1`)** verification right after production promotion — **local `:3044`/`:3054` and live Vercel `hnd1` are kept strictly separated below!**
>
> **Honest Lab Disclosure:** Local `:3044`/`:3054` uses `127.0.0.1` HTTP/1.1 (`gzip`, `~2–5 ms` loopback TTFB vs `~32 ms` Vercel `hkg1` HTTP/2+Brotli Edge & `~123 ms` Vercel `hnd1` API RTT), while DB/Auth queries still traverse live Vietnam ↔ Supabase Tokyo (`~112 ms` RTT). No field CrUX/RUM data is claimed.

---

## 1. Wave 5 & Wave 6 Independent Verification Verdict per Performance & Memory Issue

| Issue / Perf ID | Wave 5 / 6 Verdict | Summary of Verified Evidence on `7dfabfd` (`:3044`) + Wave 6 Retest (`:3054`) |
| --- | :---: | --- |
| **`V32-014` (`PERF-01`, `PERF-06`)** | **PASS (Wave 6 Verified — Light & Dark)** | **Wave 5 Dark Mode regression RESOLVED in Wave 6 (`:3054`):** Native `<picture><source media="(prefers-color-scheme: dark)" srcSet={darkSrc} /><img src={lightSrc} ... /></picture>` in `BrandLogo.tsx` eliminates all `dark:opacity-0` (`0` in SSR HTML & DOM on `/` & `/login`) and downloads **ONLY 1 active-theme hero PNG per route in BOTH Light Mode AND System Dark Mode** (`/` Light: `logo-full.png` + `logo-icon.png` = `64.4 KB`, `0` dark PNG; `/` Dark: `logo-full-dark.png` + `logo-icon.png` = `53.6 KB`, `0` light PNG; `/login` Light: `logo-main.png` + `logo-icon.png` = `60.6 KB`, `0` dark PNG, `0` `logo-full*`, `0` `_rsc`; `/login` Dark: `logo-main-dark.png` + `logo-icon.png` = `49.6 KB`, `0` light PNG, `0` `logo-full*`, `0` `_rsc`). **Lighthouse 13.6.0 (`n=3` median):** `lcpDiscovery` 3/3 `true` (`priorityHinted`, `requestDiscoverable`, `eagerlyLoaded`) in both themes; Real DevTools Mobile 4G `/login` **`98`** (`2,052 ms` Light / **`1,907 ms` Dark**, `-43.8%` & `+21` pts vs Wave 1 `77` / `3,392 ms`), `/` **`95`** Light (`1,982 ms`) / **`94`** Dark (`2,218 ms`, `+37–38` pts vs Wave 1 `57` / `7,788 ms`); Simulated Mobile `/` **`100`** (`1,215 ms` Light / `1,210 ms` Dark), `/login` full Light/Dark parity **`87` / `87`** (`4,119 ms` Light / `4,124 ms` Dark, `obsLcp 88 / 68 ms`; byte weight `-47.6 KiB` vs Wave 5 & `-144.9 KiB` vs Wave 1). All `/brand/*` & `/icons/*` serve `Cache-Control: public, max-age=86400, stale-while-revalidate=604800`; `/sw.js` serves `no-cache, no-store, must-revalidate`. |
| **`V32-015` (`PERF-02`)** | **PASS** | **0** `/api/progress` and **0** `/api/starred` calls across all `40/40` route profiles & transitions. Progressive Page-1 (`50Q`) renders Q1 immediately while background pages stream. Mobile 4G Warm LCP: `/practice` **`3,056 → 1,536 ms` (`-49.7%`)**, `/flashcards` **`2,776 → 1,592 ms` (`-42.7%`)**, `/learn` **`2,296 → 1,552 ms` (`-32.4%`)**. Desktop SPA `Set → Practice` **`2,222 → 491 ms` (`4.5×` faster)**, `Set → Learn` **`2,247 → 486 ms` (`4.6×` faster)**! |
| **`V32-012` & `V32-016` (`PERF-03`, `MEM-01`)** | **PASS** | `0019` single-RTT questions RPC: `questions?pageSize=50&fields=summary` **`474.5 → 271.5 ms` (`-42.8%`)**, payload **`118.3 → 98.1 KB`** (`pageSize=20` default Set Hub = **`39.2 KB`, `-66.8%`**). `/sets/[id]` DOM cut **`3,835 → 1,690` (`-55.9%`)** (`T1` memory snap: `3,779 → 1,588` CDP `-58.0%`), JS Heap cut **`19.8–21.1 MB → 10.5–11.1 MB` (`-47.5%`)**, Mobile 4G `Library → Set (250Q)` **`2,107 → 1,207 ms` (`-42.7%`)**. |
| **`V32-017` (`PERF-04`)** | **PASS** | `/exams/new` DOM cut **`1,220 → 593` (`-51.4%`)** Desk / `857` Mob 4G; Mobile 4G Cold LCP **`4,416 → 1,228 ms` (`-72.2%`)**, TBT `774 → 629 ms` (`-18.7%`). `Exam Builder → Exam Runner (250Q)` verified **`0` redundant `GET /api/exams/[id]`** (`406.4 KB` eliminated via cache seed): Desk **`2,375 → 1,342 ms` (`-43.5%`)**, Mob 4G **`2,287 ms`**. |
| **`V32-018` (`PERF-05`)** | **PASS** | Real 133Q DOCX (`sample-data`): **`2.99–3.04 s`** total (`parse 590–695 ms` + `commit 2,293–2,451 ms`) vs **`11.88 s`** baseline (**`-74.4%`, `3.9×` faster!**). Synthetic **30-distinct-image** multimedia DOCX: `parse 644 ms` + `commit 7,643 ms` (`8.29 s` total from local VN host → Supabase Tokyo; concurrent pool active). |
| **`V32-042` (`PERF-07`, `MEM-02`, `MEM-03`)** | **PASS** | `ExamNavigatorGrid` decoupled from answer taps (`20` rapid jumps **`32.1 → 17.9 ms`, `-44.2%`**); optimistic Save Note **`322.7 → 72.2 ms` (`-77.6%`)** Desk / `208.7 ms` Mob 4G; Mobile Star `113.0 → 99.7 ms`; `MEM-02` live-verified (`0` legacy v2, `0` expired >7d, `20` cap enforced); `MEM-03` SW listener teardown verified in `PwaProvider.tsx:419-495`. |
| **`V32-048` (`DB-13` Upload Dedup)** | **PASS** | Identical PNG uploaded twice into same set returned `sameId: true, sameStoragePath: true` and dropped latency **`992.1 → 584.8 ms` (`-41.1%`)**. |
| **`V32-045` / `V32-046` / `V32-047`** | **PARTIAL (SQL Apply)** | Live RPCs active (`POST /api/exams` 250Q `~837 ms`, `GET /api/dashboard` `260 ms`); `0019` `DROP INDEX` (`V32-045`) & `save_diagram_patch` SQL blocks await manual Supabase SQL Editor apply (matching `security-auditor` `#39`). |
| **`V32-049` (`PERF-08`)** | **PASS (Confirm Brotli in W7)** | `mammoth` **removed** (`0` hits in `package.json`); **`0.0 KB`** server import/export libs in client chunks; `/exams/[attemptId]` transferred JS dropped **`382.2 → 357.1 KB` (`-25.1 KB`)** under local `:3044` gzip (projects **`~315–325 KB` `< 350 KB`** under Vercel Edge Brotli in Wave 7!). |
| **`MEM-04` / `MEM-05`** | **PASS** | `0` active blob URLs across all snapshots; `src/lib/audio/tts.ts:198-286` verified `legacyVoiceListeners` Set cleanup. |

---

## 2. Direct API Latency Comparison (Cold + 5× Warm)

| Endpoint | Wave 1 Live `hnd1` (`39952bd`) Warm Med (`Payload`) | Wave 5 Local `:3044` (`7dfabfd`) Warm Med (`Payload`) | `Cache-Control` (W5) | Wave 7 Live `hnd1` Final |
| --- | ---: | ---: | --- | :---: |
| `GET /api/health` | `123.0 ms` (`0.1 KB`) | `2.5 ms` *(loopback)* (`0.09 KB`) | `private, no-store` | *Pending Wave 7* |
| `GET /api/dashboard` | `217.1 ms` (`2.2 KB`) | `260.4 ms` (`2.22 KB`) | `private, no-store` | *Pending Wave 7* |
| `GET /api/sets` | `233.9 ms` (`0.6 KB`) | `256.5 ms` (`0.64 KB`) | `private, no-store` | *Pending Wave 7* |
| `GET /api/sets/[id]` (250Q) | `195.1 ms` (`1.2 KB`) | `220.8 ms` (`1.17 KB`) | `private, no-store` | *Pending Wave 7* |
| **`GET /api/sets/[id]/questions?pageSize=20&fields=summary`** *(NEW default)* | *(`474.5 ms` / `118.3 KB` old 50Q)* | **`310.9 ms` (`39.23 KB`, `-66.8%` bytes!)** | `private, no-store` | *Pending Wave 7* |
| **`GET /api/sets/[id]/questions?pageSize=50&fields=summary`** | `474.5 ms` (`118.3 KB`) | **`271.5 ms` (`98.07 KB`, `-42.8%` time!)** | `private, no-store` | *Pending Wave 7* |
| `GET /api/sets/[id]/questions?pageSize=100` | `468.4 ms` (`244.6 KB`) | **`325.3 ms` (`226.58 KB`, `-30.6%` time!)** | `private, no-store` | *Pending Wave 7* |
| `GET /api/sets/[id]/questions?pageSize=500` | `689.2 ms` (`612.9 KB`) | **`541.1 ms` (`567.36 KB`, `-21.5%` time!)** | `private, no-store` | *Pending Wave 7* |
| `GET /api/exams/[attemptId]` (250Q) | `331.4 ms` (`406.4 KB`) | `335.4 ms` (`406.4 KB`) | `private, no-store` | *Pending Wave 7* |
| `POST /api/exams` (250Q Create) | `887.2 ms` (`406.4 KB`) | `837.0 ms` (`406.4 KB`) | `private, no-store` | *Pending Wave 7* |
| `GET /api/preferences` / `/api/checkpoints` | `172.2` / `173.0 ms` | `233.0` / `234.3 ms` | `private, no-store` | *Pending Wave 7* |
| `GET /api/search?q=Thermodynamics` | `219.9 ms` (`18.1 KB`) | `407.3 ms` *(VN→Tokyo 2-hop)* (`17.27 KB`) | `private, no-store` | *Pending Wave 7* |
| `GET /api/uploads/signed-url` (JSON) | `211.1 ms` (`0.76 KB`) | `269.4 ms` (`0.76 KB`) | `private, no-store` | *Pending Wave 7* |

*Note:* Local `:3044` runs in Vietnam and pays `~112 ms` RTT to Supabase Tokyo for `requireAuth()` + `~112 ms` RTT for the DB RPC (`~225 ms` floor), whereas Vercel `hnd1` co-located pays only `~3–6 ms` function-to-Supabase RTT. Despite this `~100 ms` local RTT handicap, `0019` single-RTT `questions` RPC STILL beat live `hnd1` V3.2 Baseline by **`-42.8%`** (`474.5 → 271.5 ms`) — Wave 7 on `hnd1` should drop `questions?fields=summary` under **`~170–200 ms`**!

---

## 3. Route Performance & Footprint Comparison (Desktop Wi-Fi & Mobile 4G)

### 3.1 Mobile 4G Warm LCP, Cold TBT, DOM Nodes & JS Footprint (`390×844`, `4×` CPU)

| Route | Mob 4G Warm LCP (`W1 Live → W5 :3044`) | Mob 4G Cold TBT (`W1 → W5`) | Desk DOM Nodes (`W1 → W5`) | Desk JS Heap (`W1 → W5`) | Cold JS Tr KB (`W1 Br → W5 Gz`) | Wave 7 Live `hnd1` Final |
| --- | ---: | ---: | ---: | ---: | ---: | :---: |
| `/` | `936 → 1,064 ms` | `524 → 645 ms` | `465 → 472` | `5.50 → 5.38 MB` | `256.0 → 269.7 KB` *(186.3 Mob)* | *Pending Wave 7* |
| `/login` | `524 → 356 ms` (**`-32%`**) | `163 → 165 ms` | `205 → 198` | `5.95 → 5.46 MB` | `259.1 → 248.8 KB` (**`-4%`**) | *Pending Wave 7* |
| `/dashboard` | `1,360 → 2,324 ms` | `224 → 432 ms` | `545 → 592` | `7.52 → 7.59 MB` | `324.1 → 318.9 KB` | *Pending Wave 7* |
| `/library` | `988 → 1,340 ms` | `402 → 466 ms` | `496 → 538` | `7.91 → 8.73 MB` | `324.1 → 318.9 KB` | *Pending Wave 7* |
| **`/sets/[id]` (250Q)** | `1,700 → 2,040 ms` | `486 → 555 ms` | **`3,835 → 1,690` (`-55.9%`!)** | **`19.81 → 10.46 MB` (`-47.2%`!)** | `377.4 → 372.7 KB` | *Pending Wave 7* |
| **`/sets/[id]/flashcards`** | **`2,776 → 1,592 ms` (`-42.7%`!)** | `249 → 360 ms` | `403 → 417` | `7.58 → 8.39 MB` | `345.4 → 346.2 KB` | *Pending Wave 7* |
| **`/sets/[id]/practice`** | **`3,056 → 1,536 ms` (`-49.7%`!)** | **`324 → 209 ms` (`-35.5%`!)** | `551 → 683` | `7.30 → 8.43 MB` | `354.7 → 367.2 KB` | *Pending Wave 7* |
| **`/sets/[id]/learn`** | **`2,296 → 1,552 ms` (`-32.4%`!)** | **`263 → 218 ms` (`-17.1%`!)** | `420 → 281` | `7.69 → 7.74 MB` | `362.4 → 368.1 KB` | *Pending Wave 7* |
| **`/exams/new`** | `1,104 → 1,200 ms` *(Cold LCP `4,416→1,228ms`!)* | **`774 → 629 ms` (`-18.7%`!)** | **`1,220 → 593` (`-51.4%`!)** | `10.03 → 10.00 MB` | `366.7 → 352.6 KB` | *Pending Wave 7* |
| **`/exams/[attemptId]` (250Q)** | **`1,996 → 1,872 ms` (`-6.2%`)** | **`270 → 192 ms` (`-28.9%`!)** | `583 → 569` | `7.90 → 7.32 MB` | **`382.2 → 357.1 KB` (`-25.1 KB`)** | *Pending Wave 7* |

*All 40/40 Wave 5 route runs measured **`hasProgressApi: false`**, **`hasStarredApi: false`**, **`dupApiCount: 0`**, and **`overflowX: false`** (`0px` horizontal overflow).*

---

## 4. Priority SPA Route Transitions (Before vs After)

| SPA Transition | Desktop Wi-Fi (`W1 Live → W5 :3044`) | Mobile 4G (`W1 Live → W5 :3044`) | API Reduction Verified | Wave 7 Live `hnd1` Final |
| --- | ---: | ---: | --- | :---: |
| **Dashboard → Library** | `407.7 → 407.9 ms` | `709.8 ms` (`W5`) | `2` APIs | *Pending Wave 7* |
| **Library → Study Set (250Q)** | **`1,236.1 → 963.5 ms` (`-22.1%`)** | **`2,107.4 → 1,206.6 ms` (`-42.7%`!)** | `4` APIs (`pageSize=20` summary `39 KB`) | *Pending Wave 7* |
| **Study Set → Flashcards (250Q)** | **`2,215.4 → 975.4 ms` (`-56.0%`!)** | **`2,393.3 → 1,263.8 ms` (`-47.2%`!)** | **`0` `/api/progress`, `0` `/api/starred`** | *Pending Wave 7* |
| **Study Set → Practice (250Q)** | **`2,221.7 → 491.2 ms` (`-77.9%`, `4.5×`!)** | `2,422.9 → 2,337.4 ms` *(cold bundle)* | **`0` `/api/progress`, `0` `/api/starred`** | *Pending Wave 7* |
| **Study Set → Learn (250Q)** | **`2,247.0 → 485.7 ms` (`-78.4%`, `4.6×`!)** | **`2,265.5 → 1,190.1 ms` (`-47.5%`!)** | **`0` `/api/progress`, `0` `/api/starred`** | *Pending Wave 7* |
| **Study Set → Exam Builder** | **`4,750.5 → 1,825.3 ms` (`-61.6%`)** | `—` | `2` APIs | *Pending Wave 7* |
| **Exam Builder → Exam Runner (250Q)** | **`2,374.7 → 1,342.1 ms` (`-43.5%`!)** | **`2,287.1 ms` (`0` redundant GET!)** | **`redundantGetExamCount = 0` (`-406 KB`!)** | *Pending Wave 7* |
| **Exam Results → Review Mistakes** | **`560.2 → 375.4 ms` (`-33.0%`)** | **`662.4 → 590.1 ms` (`-10.9%`)** | `0` APIs | *Pending Wave 7* |

---

## 5. DOCX Multimedia Import Benchmark (`PERF-05` / `V32-018`)

| Benchmark File | Baseline | Wave 5 Parse | Wave 5 Commit | Wave 5 Total | Speedup | Wave 7 Live `hnd1` |
| --- | ---: | ---: | ---: | ---: | ---: | :---: |
| **Real 133-Q DOCX (`sample-data`)** | `11,880 ms` (`11.88 s`) | `590–695 ms` | `2,293–2,451 ms` | **`2,988–3,041 ms` (`~3.0 s`)** | **`-74.4%` (`3.9×` faster!)** | *Pending Wave 7* |
| **Synthetic 30-Image Multimedia DOCX** (`30` distinct PNGs + `30` MCQs) | *(est. `~15–20s` seq)* | `644.2 ms` | `7,643.1 ms` | **`8,287.3 ms` (`8.29 s`)** | Bounded concurrent pool (`6×`) | *Pending Wave 7* |

---

## 6. Lighthouse 13.6.0 Mobile Lab & Playwright Brand Audit — Wave 6 `V32-014` (`PERF-01`) Light + Dark PASS

### 6.1 Playwright Brand PNG Network, SSR & Cache-Control Verification (Wave 6 `:3054`)

*Fresh empty-cache Playwright `BrowserContext` (`390×844`) per route & color scheme (`colorScheme: "light"` vs `"dark"`):*

| Route & Color Scheme | Active-Theme Hero PNGs | Total `/brand/*.png` Downloaded (Exact Files & Bytes) | Opposite-Theme PNGs | `dark:opacity-0` (SSR / DOM) | `_rsc` Prefetches | Console / Page Errors |
| --- | :---: | --- | :---: | :---: | :---: | :---: |
| **`/` — Light Mode** | **`1`** | `2` (`logo-full.png` `51.6 KB` + `logo-icon.png` `12.7 KB` = `64.4 KB`) | **`0`** | `0` / `0` | `4` | `0` / `0` |
| **`/` — System Dark Mode** | **`1`** | `2` (`logo-full-dark.png` `40.9 KB` + `logo-icon.png` `12.7 KB` = `53.6 KB`) | **`0`** | `0` / `0` | `4` | `0` / `0` |
| **`/login` — Light Mode** | **`1`** | `2` (`logo-main.png` `47.9 KB` + `logo-icon.png` `12.7 KB` = `60.6 KB`) | **`0`** (`0` `logo-full*`) | `0` / `0` | **`0`** | `0` / `0` |
| **`/login` — System Dark Mode** | **`1`** | `2` (`logo-main-dark.png` `36.9 KB` + `logo-icon.png` `12.7 KB` = `49.6 KB`) | **`0`** (`0` `logo-full*`) | `0` / `0` | **`0`** | `0` / `0` |

- **Manual Override Check:** Verified explicit `localStorage.theme` overrides opposite to OS color scheme switch `picture img.currentSrc` cleanly (`logo-main.png` on Dark OS + `theme="light"`; `logo-main-dark.png` on Light OS + `theme="dark"`).
- **HTTP `Cache-Control` Verification (`200 OK` on `:3054`):**
  - `/brand/*` (`logo-main.png`, `logo-main-dark.png`, `logo-full.png`, `logo-full-dark.png`, `logo-icon.png`, `logo-wordmark.svg`): **`public, max-age=86400, stale-while-revalidate=604800`**
  - `/icons/*` (`icon-192.png`, `icon-512.png`, `apple-touch-icon.png`, `icon-maskable-512.png`): **`public, max-age=86400, stale-while-revalidate=604800`**
  - `/sw.js`: **`no-cache, no-store, must-revalidate`**

### 6.2 Lighthouse 13.6.0 Mobile Lab (`n = 3` Median — Light Mode vs System Dark Mode)

*Measured via Lighthouse `13.6.0` with explicit CDP `prefers-color-scheme` emulation (`light` vs `dark`) across **both** Simulated Mobile (`simulate`) and real DevTools-Throttled Mobile 4G (`devtools`, `n = 3` runs per cell; `allRunsSameBrand = true` across all `24/24` runs):*

| Route, Environment & Theme | Mode | Score | FCP | LCP (Median) | TBT | CLS | Byte Weight | Brand PNGs Downloaded | Verdict / Finding |
| --- | :---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| `/` Wave 1 Live (`39952bd`) | `sim` | `100` | `1,038 ms` | `1,038 ms` | `21 ms` | `0.0000` | `572.7 KiB` | `3` (`icon`+`full`+`full-dark`) | Dual light+dark PNGs |
| `/` Wave 1 Live (`39952bd`) | `devtools` | `57` ⚠️ | `7,788 ms` | `7,788 ms` | `143 ms` | `0.0000` | `572.5 KiB` | `3` (`icon`+`full`+`full-dark`) | Heavy 4G contention |
| `/` Wave 5 `:3044` (`7dfabfd`, OS Dark) | `sim` | `100` | `1,210 ms` | `1,210 ms` | — | `0.0000` | `604.1 KiB` *(gz)* | `3` (`icon`+`full`+`full-dark`) | Dark mode still double-downloaded |
| **`/` Wave 6 `:3054` — Light Mode** | **`sim`** | **`100`** | `1,215 ms` | **`1,215 ms`** | `39 ms` | `0.0000` | `563.4 KiB` *(gz)* | **`2` (`icon` + `logo-full.png`)** | **PASS — 1 active PNG (`obsLcp 115 ms`)** |
| **`/` Wave 6 `:3054` — System Dark** | **`sim`** | **`100`** | `1,210 ms` | **`1,210 ms`** | `38 ms` | `0.0000` | **`552.8 KiB`** *(gz)* | **`2` (`icon` + `logo-full-dark.png`)** | **PASS — `-51.3 KiB` vs W5 (`obsLcp 101 ms`)** |
| **`/` Wave 6 `:3054` — Light Mode** | **`devtools`** | **`95`** | `1,982 ms` | **`1,982 ms`** | `177 ms` | `0.0000` | `563.4 KiB` *(gz)* | **`2` (`icon` + `logo-full.png`)** | **PASS (`+38` pts, `-74.6%` LCP vs W1)** |
| **`/` Wave 6 `:3054` — System Dark** | **`devtools`** | **`94`** | `2,218 ms` | **`2,218 ms`** | `192 ms` | `0.0000` | `552.8 KiB` *(gz)* | **`2` (`icon` + `logo-full-dark.png`)** | **PASS (`+37` pts, `-71.5%` LCP vs W1)** |
| `/login` Wave 1 Live (`39952bd`) | `sim` | `95` | `964 ms` | `2,914 ms` | `34 ms` | `0.0000` | `647.8 KiB` | **`5` (`187.2 KB` incl. `logo-full*`)** | Worst byte bloat |
| `/login` Wave 1 Live (`39952bd`) | `devtools` | `77` ⚠️ | `3,382 ms` | `3,392 ms` | `190 ms` | `0.0027` | `647.9 KiB` | **`5` (`187.2 KB` incl. `logo-full*`)** | Real 4G logo contention |
| `/login` Wave 5 `:3044` (`7dfabfd`, OS Dark) | `sim` | `84` ⚠️ | — | `4,600 ms` ⚠️ | — | — | `550.5 KiB` *(gz)* | `3` (`icon`+`main`+`main-dark`) | **REOPENED:** Post-hydration Dark swap |
| **`/login` Wave 6 `:3054` — Light Mode** | **`sim`** | **`87`*** | `1,056 ms` | **`4,119 ms`*** | `33 ms` | `0.0027` | `513.6 KiB` *(gz)* | **`2` (`icon` + `logo-main.png`)** | **PASS — `obsLcp 88 ms`, 3/3 LCP Discovery** |
| **`/login` Wave 6 `:3054` — System Dark** | **`sim`** | **`87`*** | `1,057 ms` | **`4,124 ms`*** | `44 ms` | `0.0027` | **`502.9 KiB`** *(gz)* | **`2` (`icon` + `logo-main-dark.png`)** | **PASS — Full Light/Dark parity (`obsLcp 68 ms`, `-47.6 KiB` vs W5, `-144.9 KiB` vs W1)** |
| **`/login` Wave 6 `:3054` — Light Mode** | **`devtools`** | **`98`** | `1,785 ms` | **`2,052 ms`** | `77 ms` | `0.0027` | `513.6 KiB` *(gz)* | **`2` (`icon` + `logo-main.png`)** | **PASS (`+21` pts, `-39.5%` LCP vs W1 `3,392 ms`)** |
| **`/login` Wave 6 `:3054` — System Dark** | **`devtools`** | **`98`** | `1,772 ms` | **`1,907 ms`** | `59 ms` | `0.0027` | **`502.9 KiB`** *(gz)* | **`2` (`icon` + `logo-main-dark.png`)** | **PASS (`+21` pts, `-43.8%` LCP vs W1; `145 ms` FASTER than Light, render delay `10.8–19.1 ms`!)** |

*\*Honest Lab Note on Local `:3054` Simulated `/login` (`4,119 / 4,124 ms`, score `87`) vs Real DevTools (`2,052 / 1,907 ms`, score `98`):*
1. **Dark-Mode Regression 100% Eliminated:** Light Mode and System Dark Mode now achieve identical Simulated scores (`87` vs `87`, `4,119` vs `4,124 ms`), faster observed Dark LCP (`68 ms` vs `88 ms`), `3/3` Lighthouse `lcp-discovery-insight` checks (`priorityHinted: true`, `requestDiscoverable: true`, `eagerlyLoaded: true`), and real DevTools Mobile 4G score **`98`** in BOTH themes (`1,907 ms` Dark vs `2,052 ms` Light — Dark Mode is `145 ms` faster because `logo-main-dark.png` is `11 KB` smaller, with `elementRenderDelay` just `10.8–19.1 ms`).
2. **Why Local `:3054` Simulated Lantern reads `~4.12 s` while Real DevTools reads `1.91–2.05 s` and Wave 1 Live Vercel read `2.91 s`:** `next start` on `127.0.0.1` serves **HTTP/1.1** (max 6 TCP sockets) + **gzip** (`503–514 KiB`) instead of Vercel Edge **HTTP/2 multiplexing + Brotli**. Lantern's simulated Slow-4G graph serializes 29 HTTP/1.1 requests (`21.4 KiB` CSS + `147 KiB` fonts + 18 JS chunks + hero PNG) to `~4.12 s` (tracking `TTI = 4.21 s`) identically for Light and Dark. Wave 7 live Vercel Production (`hkg1` HTTP/2 + Brotli) will confirm apples-to-apples Simulated `/login` LCP & score (`projected ~1.8–2.4 s`, score `95–99`) in both Light and Dark Mode.

---

## 7. Wave 7 Final Uncontested Live Production Sweep (`https://studyhub-three-mauve.vercel.app`)

*Reserved for Wave 7 after Wave 6 fixes (including reopened `PERF-01` dark-mode `BrandLogo`) merge and promote to Vercel Production (`hkg1::hnd1`). Will populate all `Pending Wave 7` cells with uncontested `hnd1` API, Brotli JS transfer, simulated Lighthouse (both Light & Dark), route matrix, and SPA transition proofs.*
