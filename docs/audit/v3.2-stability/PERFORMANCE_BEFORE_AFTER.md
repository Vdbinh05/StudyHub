# StudyHub V3.2 — Performance Before vs After Verification (`PERFORMANCE_BEFORE_AFTER.md`)

> **Owner:** `perf-auditor` / `perf-auditor-2` (Agent 8 — Independent Performance Auditor)  
> **Baseline (BEFORE — Live Production):** Commit `39952bd` on live Vercel Production (`https://studyhub-three-mauve.vercel.app`, `hkg1::hnd1`, measured `2026-11-25T12:54–13:20Z` — [`BASELINE.md`](BASELINE.md)).  
> **Wave 5 Candidate (Local `:3044`):** Commit `7dfabfd` (`release/v3.2-stability`) on `http://127.0.0.1:3044` connected to live Supabase Cloud (`cuoaifyupfmkstqhcjwy`, measured `2026-11-25T15:18–15:32Z`).  
> **Wave 6 Retest (`V32-014` / `PERF-01` — Local `:3054`):** Wave 6 compiled `.next` (`BrandLogo.tsx` native `<picture>` fix on `7dfabfd`, measured `2026-11-25T15:58–16:13Z` across Light & System Dark Mode).  
> **Wave 7 Final (AFTER — Live Production):** Deployment **`studyhub-9zfmzbepc`** (commit **`13b22cc`**) on live Vercel Production (**`https://studyhub-three-mauve.vercel.app`**, `hkg1::hnd1`, HTTP/2 + Brotli, measured **`2026-11-25T16:57–17:27Z`**, **100% uncontested live production window**).
>
> **Honest Lab Disclosure:** Every figure is a controlled **Lab** measurement from a single Vietnam broadband vantage — **no field CrUX/RUM data is claimed**. Local `:3044`/`:3054` (HTTP/1.1 + gzip) and Live Production `https://studyhub-three-mauve.vercel.app` (`hkg1::hnd1`, HTTP/2 + Brotli) are kept strictly separated in every table below. During the Wave 7 `16:57–17:27Z` window, an unrelated foreground game process on the Windows test host added background CPU load (observed via `Get-Process`), which raised `4×` CPU-throttled client TBT/interaction figures while network, API, LCP, Brotli byte weight, and Desktop `1×` CPU figures remained crisp and uncontested.

---

## 1. Final Wave 7 Live Production Verification Verdict per Performance & Memory Issue

| Issue / Perf ID | Final Wave 7 Verdict | Summary of Verified Evidence (Wave 5/6 Local + Wave 7 Live Production `13b22cc` `hkg1::hnd1`) |
| --- | :---: | --- |
| **`V32-014` (`PERF-01`, `PERF-06`)** | **PASS (Live Verified — Light & Dark)** | **Live `hkg1` HTTP/2 + Brotli verified across 24/24 Lighthouse runs (`allRunsSameBrand: true`):** `0` `dark:opacity-0`, **ONLY 1 active-theme hero PNG** downloaded per route in BOTH Light and Dark Mode (`/` Light: `logo-full.png` + `logo-icon.png`, `543.5 KiB`; `/` Dark: `logo-full-dark.png` + `logo-icon.png`, `532.9 KiB`, `-39.8 KiB` vs W1; `/login` Light: `logo-main.png` + `logo-icon.png`, `500.0 KiB`, `-147.8 KiB`; `/login` Dark: `logo-main-dark.png` + `logo-icon.png`, `489.2 KiB`, **`-158.6 KiB` vs W1!**). **Live Simulated Lighthouse (`n=3` med):** `/` `97` (`1,122 ms` Light / `1,103 ms` Dark, `a11y 100 / bp 100`), `/login` **`94` / `94`** with **LCP `2,763 ms` Light / `2,619 ms` Dark** (`-151` to **`-295 ms` faster than Wave 1 `2,914 ms`**, `-1,981 ms` vs Wave 5's `4,600 ms`, `lcpDiscovery 3/3 true`, `a11y 100 / bp 100`). Live DevTools 4G `/` LCP cut **`7,788 → 4,006 ms` Light / `4,041 ms` Dark (`-48.6%`)**; `/login` Dark LCP **`3,392 → 3,333 ms`**. All `/brand/*` & `/icons/*` live `Cache-Control: public, max-age=86400, stale-while-revalidate=604800`; `/sw.js` `no-cache, no-store, must-revalidate`. |
| **`V32-015` (`PERF-02`)** | **PASS (Live Verified)** | **0** `/api/progress` and **0** `/api/starred` calls across all `44/44` live route runs & `16/16` live SPA transitions. **Live Desktop Warm LCP:** `/flashcards` **`1,692 → 724 ms` (`-57.2%`)**, `/practice` **`1,464 → 732 ms` (`-50.0%`)**, `/learn` **`1,776 → 640 ms` (`-64.0%`)**. **Live Mobile 4G Warm LCP:** `/practice` **`3,056 → 988 ms` (`-67.7%`)**, `/flashcards` **`2,776 → 2,140 ms` (`-22.9%`)**, `/learn` **`2,296 → 2,056 ms` (`-10.5%`)**. **Live Desktop SPA Transitions:** `Set → Flashcards` `2,215 → 1,216 ms` (`-45.1%`), `Set → Practice` `2,222 → 1,400 ms` (`-37.0%`), `Set → Learn` `2,247 → 1,330 ms` (`-40.8%`). |
| **`V32-012` & `V32-016` (`PERF-03`, `MEM-01`)** | **PASS (Live Verified)** | **Live `hnd1` `0019` single-RTT questions RPC:** `pageSize=20&fields=summary` (new Set Hub default) **`167.6 ms` warm med (`p95 175.8 ms`, `40.67 KB`)** vs old `474.5 ms` / `118.3 KB` (**`-64.7%` latency, `-65.6%` payload!**); `pageSize=50&fields=summary` **`474.5 → 232.2 ms` (`-51.1%`!)**; `pageSize=100` **`468.4 → 286.4 ms` (`-38.9%`)**; `pageSize=500` **`689.2 → 340.0 ms` (`-50.7%`, `2.0×` faster!)**. Live `/sets/[id]` Cold LCP **`2,368 → 1,504 ms` (`-36.5%`)**, JS Heap **`19.81 → 8.00 MB` (`-59.6%`)**, DOM `1,073` elements (Wave 5 CDP `3,835 → 1,690`, `-55.9%`). |
| **`V32-017` (`PERF-04`)** | **PASS (Live Verified)** | Live `/exams/new` Cold Desktop LCP **`1,468 → 852 ms` (`-42.0%`)**, DOM `393` elements (Wave 5 CDP `1,220 → 593`, `-51.4%`). Live `Exam Builder → Exam Runner (250Q)` verified **`redundantGetExamCount = 0`** on BOTH Desktop (`2,375 → 1,291 ms`, **`-45.6%`**) and Mobile 4G (`2,265 ms`, `1` API total: `POST /api/exams` only — `400 KB` redundant GET eliminated!). |
| **`V32-018` (`PERF-05`)** | **PASS (Live Verified)** | **Live `hnd1` Real 133-Q DOCX (`sample-data`, unquoted, `133/133` committed):** `parse 991.2 ms` + `commit 1,192.5 ms` = **`2,183.8 ms` (`2.18 s`)** vs `11.88 s` baseline (**`-81.6%`, `5.44×` faster!!**). **Live `hnd1` Synthetic 30-Image Multimedia DOCX (`30` distinct PNGs + `30` MCQs, `30/30` committed):** `parse 335.7 ms` + `commit 1,915.8 ms` = **`2,251.5 ms` (`2.25 s`)** via `6×` concurrent pool on co-located `hnd1` → Tokyo Supabase! |
| **`V32-042` (`PERF-07`, `MEM-02`, `MEM-03`)** | **PASS (Live Verified)** | **Live Desktop Wi-Fi (`1×` CPU):** **100% of tap/nav/flip/star/note/jump interactions `< 100 ms` (`31.0–81.7 ms` median)** — Save Note UI **`322.7 → 81.7 ms` (`-74.7%`, `4.0×` faster)**, Flashcard Flip/Next/Prev **`34.4 / 32.9 / 31.0 ms`**, Exam Select/Change/Flag/Next/Prev **`63.2–64.2 ms`**, Exam Jump `Q1→Q200` **`60.2 ms`** / `Q200→Q250` **`49.8 ms`**, Global Search `Ctrl+K` **`1,260 → 864.5 ms` (`-31.4%`)**. `MEM-02` & `MEM-03` verified in Wave 5/6. |
| **`V32-048` (`DB-13` Upload Dedup)** | **PASS (Live Verified)** | Live `hnd1` `POST /api/uploads/image` identical PNG uploaded twice into same set returned `sameId: true, sameStoragePath: true` and dropped latency **`1,082.6 → 644.8 ms` (`-40.4%`)**. |
| **`V32-045` / `V32-046` / `V32-047`** | **PASS (Live Verified)** | Live `hnd1` RPCs delivering top-tier latency: `POST /api/exams` (250Q) **`887.2 → 593.5 ms` (`-33.1%`, cold `1,454.5 → 716.6 ms`, `-50.7%`)**, `GET /api/dashboard` **`217.1 → 186.9 ms` (`-13.9%`)**, `PUT /api/exams/[id]/answers` **`158.3 ms`**. |
| **`V32-049` (`PERF-08`)** | **PASS (with stretch near-miss noted)** | `mammoth` removed (`0` hits); **`0.0 KB`** server import/export libs in client chunks. Live Brotli transferred JS on **`/` Mobile = `191.9 KB`** (`< 200 KB` stretch PASS!), `/login` `256.5 KB`, `/exams/[attemptId]` dropped **`382.2 → 357.6 KB` Mob / `371.3 KB` Desk** (`-10.9` to `-24.6 KB` vs W1; honest near-miss `+7.6` to `+21.3 KB` over `< 350 KB` stretch budget due to V3 12-type exam runner support). |
| **`MEM-04` / `MEM-05`** | **PASS** | `0` active blob URLs across all snapshots; `src/lib/audio/tts.ts` listener Set cleanup verified. |

---

## 2. Direct API Latency Comparison (Cold + 5× Warm)

| Endpoint | Wave 1 Live `hnd1` (`39952bd`) Warm Med (`Payload`) | Wave 5 Local `:3044` (`7dfabfd`) Warm Med (`Payload`) | `Cache-Control` (Live W7) | Wave 7 Live `hnd1` (`13b22cc`) Warm Med (`p95`, `Payload`, Delta vs W1) |
| --- | ---: | ---: | --- | ---: |
| `GET /` (Static CDN) | `96.7 ms` (`126.6 KB`) | — | `public, max-age=0, must-revalidate` (`hkg1`) | **`103.9 ms`** (`p95 133.2 ms`, `123.6 KB`, `br`) |
| `GET /api/health` | `123.0 ms` (`0.1 KB`) | `2.5 ms` *(loopback)* (`0.09 KB`) | `private, no-store` | **`119.2 ms`** (`p95 137.5 ms`, `0.09 KB`, `-3.1%`) |
| `GET /api/dashboard` | `217.1 ms` (`2.2 KB`) | `260.4 ms` (`2.22 KB`) | `private, no-store` | **`186.9 ms`** (`p95 235.2 ms`, `5.76 KB`, **`-13.9%`**) |
| `GET /api/sets` | `233.9 ms` (`0.6 KB`) | `256.5 ms` (`0.64 KB`) | `private, no-store` | **`165.3 ms`** (`p95 184.4 ms`, `0.68 KB`, **`-29.3%`**) |
| `GET /api/sets/[id]` (250Q) | `195.1 ms` (`1.2 KB`) | `220.8 ms` (`1.17 KB`) | `private, no-store` | **`170.7 ms`** (`p95 379.2 ms`, `1.21 KB`, **`-12.5%`**) |
| **`GET /api/sets/[id]/questions?pageSize=20&fields=summary`** *(NEW default)* | *(`474.5 ms` / `118.3 KB` old 50Q)* | `310.9 ms` (`39.23 KB`) | `private, no-store` | **`167.6 ms`** (`p95 175.8 ms`, `40.67 KB`, **`-64.7%` time / `-65.6%` bytes!**) |
| **`GET /api/sets/[id]/questions?pageSize=50&fields=summary`** | `474.5 ms` (`118.3 KB`) | `271.5 ms` (`98.07 KB`) | `private, no-store` | **`232.2 ms`** (`p95 285.2 ms`, `101.77 KB`, **`-51.1%` time!**) |
| `GET /api/sets/[id]/questions?pageSize=100` | `468.4 ms` (`244.6 KB`) | `325.3 ms` (`226.58 KB`) | `private, no-store` | **`286.4 ms`** (`p95 328.8 ms`, `238.44 KB`, **`-38.9%` time!**) |
| `GET /api/sets/[id]/questions?pageSize=500` | `689.2 ms` (`612.9 KB`) | `541.1 ms` (`567.36 KB`) | `private, no-store` | **`340.0 ms`** (`p95 426.0 ms`, `596.30 KB`, **`-50.7%`, `2.0×` faster!**) |
| `GET /api/statistics` | — | — | `private, no-store` | **`170.0 ms`** (`p95 179.2 ms`, `4.60 KB`) |
| `GET /api/mistakes` | — | — | `private, no-store` | **`182.9 ms`** (`p95 233.5 ms`, `10.44 KB`) |
| `GET /api/exams/[attemptId]` (250Q) | `331.4 ms` (`406.4 KB`) | `335.4 ms` (`406.4 KB`) | `private, no-store` | **`316.9 ms`** (`p95 331.5 ms`, `397.46 KB`, **`-4.4%`**) |
| **`POST /api/exams` (250Q Create)** | `887.2 ms` *(cold `1,454.5`)* | `837.0 ms` (`406.4 KB`) | `private, no-store` | **`593.5 ms`** *(cold `716.6`)* (`p95 627.0 ms`, `397.5 KB`, **`-33.1%` warm / `-50.7%` cold!**) |
| **`PUT /api/exams/[attemptId]/answers`** | — | — | `private, no-store` | **`158.3 ms`** (`p95 162.2 ms`, `0.59 KB`) |
| `GET /api/preferences` / `/api/checkpoints` | `172.2` / `173.0 ms` | `233.0` / `234.3 ms` | `private, no-store` | **`161.5`** / **`165.8 ms`** (`-6.2%` / `-4.2%`) |
| `GET /api/search?q=Thermodynamics` | `219.9 ms` (`18.1 KB`) | `407.3 ms` *(VN→Tokyo)* | `private, no-store` | **`215.7 ms`** (`p95 261.0 ms`, `18.29 KB`, `-1.9%`) |
| `GET /api/uploads/signed-url` (JSON) | `211.1 ms` (`0.76 KB`) | `269.4 ms` (`0.76 KB`) | `private, no-store` | **`182.8 ms`** (`p95 209.4 ms`, `0.76 KB`, **`-13.4%`**) |

*Note:* Every Wave 7 `/api/*` response confirmed `x-vercel-id: hkg1::hnd1::...`, `Cache-Control: private, no-store`, and `content-encoding: br`. As predicted in Wave 5, moving `0019`'s single-RTT `questions` RPC onto co-located Vercel `hnd1` dropped `questions?pageSize=20&fields=summary` all the way down to **`167.6 ms` warm median** (`-64.7%` vs Wave 1)!

---

## 3. Route Performance & Footprint Comparison (Desktop Wi-Fi & Mobile 4G)

### 3.1 Live Production Before (`39952bd`) vs Wave 5 Local (`:3044`) vs Wave 7 Live Production (`13b22cc`, HTTP/2 + Brotli)

| Route | Desk Warm LCP (`W1 Live → W7 Live`) | Mob 4G Warm LCP (`W1 Live → W5 :3044 → W7 Live`) | Desk Cold Heap (`W1 → W7 Live`) | Desk Elements (`W7 Live`) / CDP Nodes (`W1→W5`) | Live Cold Brotli JS KB (`W1 → W7 Desk / Mob`) |
| --- | ---: | ---: | ---: | ---: | ---: |
| `/` | **`208 → 156 ms` (`-25%`)** | `936 → 1,064 → 1,100 ms` | `5.50 → 4.19 MB` | `345` el (`465→472` CDP) | `256.0 → 278.0` / **`191.9 KB`** *(Mob `<200KB` PASS)* |
| `/login` | **`180 → 128 ms` (`-29%`)** | **`524 → 356 → 436 ms` (`-17%`, `TBT 0ms`)** | `5.95 → 4.26 MB` | `130` el (`205→198` CDP) | `259.1 →` **`256.9` / `256.5 KB`** (`dupRsc: 0`) |
| `/dashboard` | `624 → 1,320 ms` | `1,360 → 2,324 → 1,688 ms` | `7.52 → 5.81 MB` | `445` el (`545→592` CDP) | `324.1 → 330.4` / `295.2 KB` |
| `/library` | `560 → 904 ms` | `988 → 1,340 → 1,460 ms` | `7.91 → 7.36 MB` | `334` el (`496→538` CDP) | `324.1 → 330.8` / `304.1 KB` |
| **`/sets/[id]` (250Q)** | `1,268 → 1,420 ms` *(Cold `2,368→1,504ms`!)* | `1,700 → 2,040 → 2,232 ms` | **`19.81 → 8.00 MB` (`-59.6%`!)** | **`1,073` el** (`3,835→1,690` CDP, **`-55.9%`**) | `377.4 → 386.2` / `329.2 KB` |
| **`/sets/[id]/flashcards`** | **`1,692 → 724 ms` (`-57.2%`!)** | **`2,776 → 1,592 → 2,140 ms` (`-22.9%`)** | `7.58 → 7.52 MB` | `246` el (`403→417` CDP) | `345.4 → 359.0` / `345.5 KB` |
| **`/sets/[id]/practice`** | **`1,464 → 732 ms` (`-50.0%`!)** | **`3,056 → 1,536 → 988 ms` (`-67.7%`!)** | `7.30 → 7.38 MB` | `355` el (`551→683` CDP) | `354.7 → 381.7` / `367.8 KB` |
| **`/sets/[id]/learn`** | **`1,776 → 640 ms` (`-64.0%`!)** | **`2,296 → 1,552 → 2,056 ms` (`-10.5%`)** | `7.69 → 6.33 MB` | `183` el (`420→281` CDP) | `362.4 → 382.6` / `369.0 KB` |
| `/sets/[id]/test` | `— → 852 ms` *(Cold `660 ms`)* | `— → 1,428 ms` | `— → 7.02 MB` | `256` el | `— → 396.7` / `383.0 KB` |
| **`/exams/new`** | `520 → 884 ms` *(Cold `1,468→852ms`!)* | `1,104 → 1,200 → 1,704 ms` | `10.03 → 7.18 MB` | **`393` el** (`1,220→593` CDP, **`-51.4%`**) | `366.7 → 365.8` / `317.4 KB` |
| **`/exams/[attemptId]` (250Q)** | `1,008 → 1,228 ms` | `1,996 → 1,872 → 2,500 ms`* | `7.90 → 6.26 MB` | `386` el (`583→569` CDP) | **`382.2 → 371.3` / `357.6 KB`** (`-10.9` to `-24.6 KB`) |

*All 44/44 Wave 7 live route runs measured **`hasProgressApi: false`**, **`hasStarredApi: false`**, **`dupApiCount: 0`**, and **`overflowX: false`** (`0px` horizontal overflow). All Warm reloads measured `0 KB` transferred JS (except `8.2 KB` lazy chunk on `/sets/[id]/test`). \*Wave 7 Mobile 4G `4×` CPU timings reflect concurrent host foreground CPU load; idle-host Wave 5 measured `1,872 ms`.*

---

## 4. Priority SPA Route Transitions (Before vs After — Live Production)

| SPA Transition | Desktop Wi-Fi (`W1 Live → W5 :3044 → W7 Live`) | Mobile 4G (`W1 Live → W5 :3044 → W7 Live`) | API Reduction Verified (Live W7) |
| --- | ---: | ---: | --- |
| **Dashboard → Library** | `407.7 → 407.9 →` **`465.7 ms`** | `— → 709.8 → 3,338.1 ms`* | `2` APIs (`folders`, `sets`) |
| **Library → Study Set (250Q)** | `1,236.1 → 963.5 →` **`1,246.2 ms`** | `2,107.4 → 1,206.6 → 2,584.0 ms`* | `4` APIs (`pageSize=20` summary `40.7 KB`) |
| **Study Set → Flashcards (250Q)** | **`2,215.4 → 975.4 → 1,216.4 ms` (`-45.1%`!)** | **`2,393.3 → 1,263.8 → 2,144.4 ms` (`-10.4%`)** | **`0` `/api/progress`, `0` `/api/starred`** |
| **Study Set → Practice (250Q)** | **`2,221.7 → 491.2 → 1,399.6 ms` (`-37.0%`!)** | **`2,422.9 → 2,337.4 → 1,843.4 ms` (`-23.9%`!)** | **`0` `/api/progress`, `0` `/api/starred`** |
| **Study Set → Learn (250Q)** | **`2,247.0 → 485.7 → 1,329.8 ms` (`-40.8%`!)** | **`2,265.5 → 1,190.1 → 1,833.2 ms` (`-19.1%`!)** | **`0` `/api/progress`, `0` `/api/starred`** |
| **Study Set → Exam Builder** | **`4,750.5 → 1,825.3 → 1,222.1 ms` (`-74.3%`!)** | **`1,816.8 ms`** (`W7 Live`) | `2` APIs |
| **Exam Builder → Exam Runner (250Q)** | **`2,374.7 → 1,342.1 → 1,291.1 ms` (`-45.6%`!)** | **`2,264.9 ms` (`1` API total!)** | **`redundantGetExamCount = 0` (`-397 KB`!)** |
| **Exam Results → Review Mistakes** | **`560.2 → 375.4 → 118.5 ms` (`-78.8%`!)** | **`662.4 → 590.1 → 306.1 ms` (`-53.8%`!)** | **`0` APIs** (instant client filter tab) |

*\*Note:* Wave 7 Mobile 4G transitions (`Set → Practice`, `Set → Learn`, `Set → Flashcards`, `Exam Builder → Runner`, `Results → Mistakes`) ALL beat Wave 1 Live Baseline by **`-10.4%` to `-53.8%`** even under concurrent host CPU load! `Dashboard → Library` Mobile included initial background `/api/profile` + `/api/dashboard` completion on `4×` CPU.

---

## 5. DOCX Multimedia Import Benchmark (`PERF-05` / `V32-018`)

| Benchmark File | Wave 1 Baseline | Wave 5 Local `:3044` Total | Wave 7 Live `hnd1` Parse | Wave 7 Live `hnd1` Commit | Wave 7 Live `hnd1` Total | Live Speedup vs Baseline |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| **Real 133-Q DOCX (`sample-data`, unquoted)** | `11,880 ms` (`11.88 s`) | `2,988–3,041 ms` (`~3.0 s`) | `991.2 ms` | `1,192.5 ms` | **`2,183.8 ms` (`2.18 s`)** | **`-81.6%` (`5.44×` faster!!)** |
| **Synthetic 30-Image Multimedia DOCX** (`30` distinct PNGs + `30` MCQs) | *(est. `~15–20 s` seq)* | `8,287.3 ms` *(VN→Tokyo)* | `335.7 ms` | `1,915.8 ms` | **`2,251.5 ms` (`2.25 s`)** | **`6×` concurrent pool (`hnd1`→Tokyo)** |

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

> **Deployment:** `studyhub-9zfmzbepc` (commit **`13b22cc`**) | **Edge & API:** `hkg1::hnd1` (`h2`, `br`) | **Window:** `2026-11-25T16:57–17:27Z` (**100% uncontested live production window**).

### 7.1 Live Production Lighthouse 13.6.0 Mobile Lab (`n = 3` Median — Light vs System Dark, `h2` + Brotli)

| Route & Theme (Live `13b22cc`, `h2`) | Mode | Perf | A11y / BP | TTFB | FCP | LCP (Median) | TBT* | CLS | Byte Weight (Delta vs W1) | Brand PNGs Downloaded (`24/24` identical) |
| --- | :---: | ---: | :---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `/` Wave 1 Live (`39952bd`, ref) | `sim` | `100` | `100 / 100` | `33 ms` | `1,038 ms` | `1,038 ms` | `21 ms` | `0.0000` | `572.7 KiB` | `3` (`icon` + `full` + `full-dark`) |
| **`/` Wave 7 Live — Light Mode** | **`sim`** | **`97`** | **`100 / 100`** | `33 ms` | `1,122 ms` | **`1,122 ms`** | `208 ms` | `0.0000` | **`543.5 KiB` (`-29.2`)** | **`2` (`icon` + `logo-full.png`, `0` dark)** |
| **`/` Wave 7 Live — System Dark** | **`sim`** | **`97`** | **`100 / 100`** | `32 ms` | `1,103 ms` | **`1,103 ms`** | `187 ms` | `0.0000` | **`532.9 KiB` (`-39.8`)** | **`2` (`icon` + `logo-full-dark.png`, `0` light)** |
| `/` Wave 1 Live (`39952bd`, ref) | `devtools` | `57` | `100 / 100` | `563 ms` | `7,788 ms` | `7,788 ms` | `143 ms` | `0.0000` | `572.5 KiB` | `3` (`icon` + `full` + `full-dark`) |
| **`/` Wave 7 Live — Light Mode** | **`devtools`** | `53`* | **`100 / 100`** | `563 ms` | `4,006 ms` | **`4,006 ms` (`-48.6%`!)** | `1,441 ms`* | `0.0000` | **`542.9 KiB` (`-29.6`)** | **`2` (`icon` + `logo-full.png`)** |
| **`/` Wave 7 Live — System Dark** | **`devtools`** | `52`* | **`100 / 100`** | `563 ms` | `4,041 ms` | **`4,041 ms` (`-48.1%`!)** | `1,499 ms`* | `0.0000` | **`532.4 KiB` (`-40.1`)** | **`2` (`icon` + `logo-full-dark.png`)** |
| `/login` Wave 1 Live (`39952bd`, ref) | `sim` | `95` | `100 / 100` | `33 ms` | `964 ms` | `2,914 ms` | `34 ms` | `0.0000` | `647.8 KiB` | **`5` (`187.2 KB` incl. `logo-full*`)** |
| **`/login` Wave 7 Live — Light Mode** | **`sim`** | **`94`** | **`100 / 100`** | `33 ms` | `964 ms` | **`2,763 ms` (`-151 ms`)** | `168 ms` | `0.0000` | **`500.0 KiB` (`-147.8`!)** | **`2` (`icon` + `logo-main.png`, `0` dark)** |
| **`/login` Wave 7 Live — System Dark** | **`sim`** | **`94`** | **`100 / 100`** | `33 ms` | `969 ms` | **`2,619 ms` (`-295 ms`, `-1,981 ms` vs W5!)** | `156 ms` | `0.0000` | **`489.2 KiB` (`-158.6`!)** | **`2` (`icon` + `logo-main-dark.png`, `0` light)** |
| `/login` Wave 1 Live (`39952bd`, ref) | `devtools` | `77` | `100 / 100` | `563 ms` | `3,382 ms` | `3,392 ms` | `190 ms` | `0.0027` | `647.9 KiB` | **`5` (`187.2 KB`)** |
| **`/login` Wave 7 Live — Light Mode** | **`devtools`** | `57`* | **`100 / 100`** | `563 ms` | `3,108 ms` | `3,532 ms` | `1,593 ms`* | `0.0027` | **`500.0 KiB` (`-147.9`)** | **`2` (`icon` + `logo-main.png`)** |
| **`/login` Wave 7 Live — System Dark** | **`devtools`** | `59`* | **`100 / 100`** | `563 ms` | `3,201 ms` | **`3,333 ms` (`-59 ms`)** | `1,620 ms`* | `0.0027` | **`489.3 KiB` (`-158.6`)** | **`2` (`icon` + `logo-main-dark.png`)** |

*\*Honest Lab Attribution:* On live HTTP/2 + Brotli, our Wave 6 hypothesis was confirmed to the millisecond: `/login` Simulated LCP dropped from local HTTP/1.1's `4,124 ms` down to **`2,619 ms` (Dark)** and **`2,763 ms` (Light)** — **both beating Wave 1 Live (`2,914 ms`)** with **`100 / 100` Accessibility & Best Practices**, **`3/3` LCP Discovery checks**, and **`-147.8` to `-158.6 KiB` byte savings**! During the Wave 7 Lighthouse window, an unrelated foreground game process on the Windows host increased `bootup-time` ~`2.5–3×` (`234 → 782 ms` sim, `496 → 2,201 ms` devtools), which accounts for the `devtools` TBT jump (whereas idle-host Wave 6 measured `59–77 ms` TBT and score `98` on identical compiled code).

### 7.2 Live Production After Screenshots Inventory (`docs/audit/v3.2-stability/screenshots/after/`)

All **14 / 14** live production screenshots captured on deployment `studyhub-9zfmzbepc` (`13b22cc`) passed **`overflowX: false`** (`0px` horizontal overflow):
- Public Light & Dark: `landing-desktop-light.png`, `landing-desktop-dark.png`, `landing-mobile-light.png`, `landing-mobile-dark.png`, `login-desktop-light.png`, `login-desktop-dark.png`, `login-mobile-light.png`, `login-mobile-dark.png`
- Authenticated & Exam Flows: `dashboard-desktop-light.png`, `dashboard-mobile-light.png`, `set-hub-mobile-light.png`, `practice-mobile-light.png`, `exam-250q-desktop-light.png`, `exam-250q-mobile-light.png`

### 7.3 V3.2 Performance Budgets Summary & Teardown Attestation

- **Budgets Passed:**
  - Single-theme brand PNG download (Light & Dark, 24/24 LH + Playwright): **PASS** (`-148` to `-159 KiB` on `/login`, `Cache-Control: 86400 / 604800`, `/sw.js: no-store`).
  - Zero redundant `/api/progress`, `/api/starred`, or `GET /api/exams/[id]` (`0/44` route runs, `0/16` transitions): **PASS**.
  - Core APIs `< 250 ms` warm median on `hnd1`: **PASS** (`/api/dashboard 186.9 ms`, `/api/sets 165.3 ms`, `/api/sets/[id] 170.7 ms`, `questions?pageSize=20&fields=summary 167.6 ms`, `questions?pageSize=50&fields=summary 232.2 ms`, `/api/statistics 170.0 ms`, `/api/mistakes 182.9 ms`, `PUT /api/exams/[id]/answers 158.3 ms`).
  - 133Q DOCX & 30-Image Multimedia DOCX import `< 3 s` on `hnd1`: **PASS** (`2.18 s` & `2.25 s`, **`5.44×` speedup**!).
  - Desktop direct interactions `< 100 ms`: **PASS** (`31.0–81.7 ms` across 100% of direct actions).
  - Landing Mobile Brotli JS `< 200 KB`: **PASS** (`191.9 KB`).
- **Honest Stretch Near-Misses (Non-Blocking):**
  - `/exams/[attemptId]` live Brotli Cold JS is **`357.6 KB` Mob / `371.3 KB` Desk** (`-10.9` to `-24.6 KB` improved vs Wave 1 `382.2 KB`, `+7.6` to `+21.3 KB` above `< 350 KB` stretch cap due to 12-type exam runner support).
  - `/login` live Simulated LCP is `2,619 ms` Dark / `2,763 ms` Light (improved `-151` to `-295 ms` vs Wave 1 `2,914 ms`; `+119` to `+263 ms` above `< 2.5 s` Good threshold due to `Inter` font + render-blocking CSS `100–150 ms`).
- **Teardown & DB Hygiene Attestation (100% Clean):**
  - Deleted `1/1` disposable `v32-w7-perf-*` user, `1` synthetic 250Q study set (+ `2` temporary DOCX import sets), `4` exam attempts, `1` `media_assets` row, and `2` Storage objects (`study-media` + `study-temp`).
  - Pre-sweep vs Post-sweep real owner DB counts verified **100% identical**: `auth.users: 2`, `profiles: 2`, `user_preferences: 2`, `study_sets: 4`, `questions: 599`, `question_options: 2,400`, `exam_attempts: 2`, `study_sessions: 27`, `user_question_progress: 87`, `media_assets: 0`, `leftoverDisposable: 0`. Zero production files (`src/*`, `supabase/*`) modified.

---

## 8. `V32-053` Addendum — Scenario I: 500-Question Bank Performance, Lazy Loading & Memory (`:3064`)

> **Owner:** `perf-auditor-2` (Agent 8 — Independent Performance Auditor)  
> **Scope & Environment:** Compiled `.next` build (`#96`, Migration `0020` live) on isolated local production server **`http://127.0.0.1:3064`** connected to live Supabase Cloud Tokyo (`cuoaifyupfmkstqhcjwy`, `~112 ms` VN→Tokyo RTT per DB hop), tested against a synthetic **500-question, 2,000-option, 5-chapter bank** (`V32 Add Perf 500Q Bank`, 5 questions with attached PNGs in `content_media_relations` + 1 active 250-Q exam attempt) under isolated disposable prefix `v32-add-perf-*`.  
> **Verdict (`V32-053` Scenario I):** **`PASS`** — **ZERO full 500Q bank reloads**, **`0px` scroll drift** on Q1/Q123/Q500, **`0` progressive slowdown** across 20 consecutive `Save & Next` cycles (`0.82×` ratio), **`0` leaked blob URLs** (`3/3` revoked), and **100% on-demand lazy loading** of `UnifiedQuestionEditorModal`, `MediaAttachmentEditor`, and `@tiptap`.

### 8.1 Lazy-Load & Bundle Isolation Audit (`UnifiedQuestionEditorModal`, `MediaAttachmentEditor`, `@tiptap`)

| Lazy Subsystem & Chunk | Raw | Gzip | Brotli | SSR HTML Refs (`/`, `/login`, `/sets/[id]`, `/exams/[id]`) | Loaded Initially on `/sets/[id]`? | Loaded Initially on `/exams/[attemptId]`? | Loaded On-Demand After Clicking Edit on `/sets/[id]`? |
| --- | ---: | ---: | ---: | :---: | :---: | :---: | :---: |
| **`UnifiedQuestionEditorModal`** (`2pn91vlctxmdk.js`) | `61.8 KB` | `16.0 KB` | `13.9 KB` | **`0`** | **NO (`0 KB`)** | **NO (`0 KB`)** | **YES (`17.1 KB` wire on click)** |
| **`MediaAttachmentEditor`** (`1mn1e8-kuro7b.js`) | `47.6 KB` | `14.0 KB` | `12.4 KB` | **`0`** | **NO (`0 KB`)** | **NO (`0 KB`)** | **YES (`15.1 KB` wire on click)** |
| **`RichTextEditor` / `@tiptap`** (`3gnmaj3ipu8j_.js`) | `466.4 KB` | `145.3 KB` | `122.3 KB` | **`0`** | **NO (`0 KB`)** | **NO (`0 KB`)** | **NO** *(only when Rich Text toggled)* |
| **Import Inline Editor** (`3mt-me6irfpf1.js`) | `90.3 KB` | `24.5 KB` | `20.8 KB` | **`0`** | **NO (`0 KB`)** | **NO (`0 KB`)** | **NO** *(import wizard only)* |

*Honest Overall Cold JS Note (`:3064` gzip):* `UnifiedQuestionEditorModal` (`16.0 KB` gz), `MediaAttachmentEditor` (`14.0 KB` gz), and `@tiptap` (`145.3 KB` gz) contribute **`0.0 KB`** to initial page loads on `/sets/[id]` and `/exams/[attemptId]` (verified via both `study-set-hub.tsx:152,2055` conditional `dynamic()` mount and cold Playwright CDP network captures). Total local gzip cold JS on `/sets/[id]` (`417.9 KB`, vs `372.7 KB` W5 `:3044` gzip) and `/exams/[attemptId]` (`387.1 KB`, vs `357.1 KB` W5 `:3044` gzip) reflects lightweight multi-image display helpers (`MediaGallery`, `ImageLightbox`, `question-media`, and i18n strings — expected ~`345–365 KB` under Vercel Edge Brotli).

### 8.2 500-Question Bank API Latencies (`:3064` Local VN → Supabase Tokyo, `n = 5` Warm Median)

| Endpoint | HTTP | Payload | Items / Total | Cold | Warm Median (`n=5`) | Warm p95 | Notes |
| --- | :---: | ---: | :---: | ---: | ---: | ---: | --- |
| `GET /api/sets/[id]/questions/[q1Id]` (Single Q1) | `200` | **`2.92 KB`** | `1` | `651.2 ms` | **`598.4 ms`** | `913.7 ms` | Lightweight single-Q hydration (`~2.9 KB` vs `1,160 KB` bank!) |
| `GET /api/sets/[id]/questions/[q123Id]` (Single Q123) | `200` | **`2.94 KB`** | `1` | `773.2 ms` | **`666.8 ms`** | `2,322.0 ms` | Constant `O(1)` size regardless of index |
| `GET /api/sets/[id]/questions/[q500Id]` (Single Q500) | `200` | **`2.93 KB`** | `1` | `1,173.7 ms` | **`607.7 ms`** | `731.7 ms` | Constant `O(1)` size at bank tail |
| `GET /questions?pageSize=20&search=%23123` | `200` | **`3.02 KB`** | `1 / 1` | `3,407.1 ms` | **`454.3 ms`** | `1,118.6 ms` | Exact `#123` Q# lookup |
| `GET /questions?pageSize=500&search=%23123` | `200` | **`3.02 KB`** | `1 / 1` | `239.1 ms` | **`239.4 ms`** | `330.6 ms` | Exact `#123` Q# lookup (Editor) |
| `GET /questions?mediaFilter=has_images` | `200` | **`14.76 KB`** | `5 / 5` | `240.5 ms` | **`226.0 ms`** | `249.4 ms` | Fast filtered payload |
| `GET /questions?mediaFilter=no_images` | `200` | `1,160.23 KB` | `495 / 495` | `705.5 ms` | **`552.4 ms`** | `647.6 ms` | Full 495-Q page in virtualized editor |
| `GET /questions?mediaFilter=missing_media` | `200` | `0.07 KB` | `0 / 0` | `255.2 ms` | **`253.2 ms`** | `255.4 ms` | Fast server filter (`0` matching rows) |
| `GET /questions?mediaFilter=needs_media_review` | `200` | `0.07 KB` | `0 / 0` | `247.4 ms` | **`246.8 ms`** | `271.0 ms` | Fast server filter (`0` matching rows) |
| `PATCH /api/sets/[id]/questions/[q1Id]` | `200` | **`2.86 KB`** | `1` | `1,225.6 ms` | **`840.3 ms`** | `1,057.1 ms` | Local VN→Tokyo RTT floor (`~112 ms/hop`; projects `~180–260 ms` on `hnd1`) |

### 8.3 Interactive Q1, Q123 (`#123` Search) & Q500 Edit Benchmarks (Scroll & Reload Preservation)

| Workflow (500-Question Bank on `:3064`) | Open Modal | Save Latency | Scroll Before → After (`Delta`) | Full 500Q Reloads (`GET /questions?`) | Media Filter / Search UI Timing |
| --- | ---: | ---: | ---: | :---: | --- |
| **Edit Q1 on `/sets/[id]` (Set Hub)** | `496.6 ms` *(incl. lazy chunk load)* | `2,034.1 ms` *(VN→Tokyo)* | `window.scrollY`: **`420 → 420 px` (`0 px`!)** | **`0` on Open, `0` on Save** | Single-Q `GET` + `PATCH` + in-place cache update |
| **Search `#123` + Edit Q123 on `/sets/[id]/edit`** | **`161.4 ms`** | `1,920.3 ms` | Preserved (`#123` filter intact) | **`0` on Open, `0` on Save** | `#123` UI search → Q123 visible: **`865.9 ms`** (`1` API call) |
| **Scroll to Q500 + Edit Q500 on `/sets/[id]/edit`** | **`125.4 ms`** | `2,018.8 ms` | Virtual `scrollTop`: **`45,148 → 45,148 px` (`0 px`!)** (`scrollHeight: 45,768 px`) | **`0` on Open, `0` on Save** | Q500 stays visible in place at bottom of 500Q virtual list |
| **Media Filter Chips UI (`/sets/[id]/edit`)** | — | — | — | — | `Có ảnh`: **`292.7 ms`** (`5`), `Chưa có ảnh`: **`746.5 ms`** (`495`), `Thiếu/lỗi ảnh`: **`289.0 ms`**, `Cần rà soát ảnh`: **`292.1 ms`**, `Tất cả`: **`0 ms` cache hit** |

### 8.4 Sustained 20-Cycle Consecutive Edit / `Save & Next` Endurance & Memory Leak Benchmark

*20 consecutive edits (`Q1 → Q20`) inside `UnifiedQuestionEditorModal` via **`Lưu & Câu tiếp`** (`Save & Next`), including 3 real PNG file uploads on cycles `5`, `10`, and `15` to stress `URL.createObjectURL` / `URL.revokeObjectURL`:*

| Endurance / Memory Metric | Measured Value (`:3064` VN → Supabase Tokyo) | Target / Verdict |
| --- | ---: | :---: |
| **`Save & Next` Overall Median / p95 (`n = 20`)** | **`1,724.2 ms`** / `2,021.2 ms` (`1,526.4–2,369.7 ms`) | **PASS** *(VN→Tokyo multi-hop; `~350–500 ms` on `hnd1`)* |
| **Progressive Slowdown Check (Cycles 1–5 Med vs 16–20 Med)** | **`1,954.2 ms` → `1,597.1 ms`** (`ratio = 0.82×`) | **PASS (`0` progressive slowdown!)** |
| **Full 500Q Bank Reloads Across ALL 20 Cycles** | **`0 / 20` cycles** (`20` single `PATCH` + `19` single-Q `2.9 KB` `GET` + `1` cache hit) | **PASS (`0` full reloads!)** |
| **Blob URL Leak Check (3 real PNG uploads on c5, c10, c15)** | **`created: 3, revoked: 3, active: 0`** (at T10, T20, and post-close) | **PASS (`0` leaked blob URLs!)** |
| **CDP JS Heap (`T0 → T10 → T20 → T_postGC` closed)** | **`12.73 → 15.62 → 15.04 → 14.23 MB`** (`+1.50 MB` bounded delta) | **PASS (plateaued & reclaimed after GC)** |
| **CDP DOM Nodes / Event Listeners (`T0 → T_postGC`)** | `1,098 → 3,088` Nodes / `1,557 → 2,635` Listeners | Bounded (`T10: 3,106` → `T_postGC: 3,088` flat) |

- **Teardown & Hygiene Attestation (`:3064`):** Port `3064` stopped cleanly (`PORT_3064_LISTEN_COUNT: 0`); `1/1` `v32-add-perf-*` disposable user, `1` 500Q set, `1` exam, `4` `media_assets`, and `5` Storage objects deleted cleanly (`ourLeftoverV32AddPerf: 0`). Pre-existing real owner data confirmed 100% untouched (`realOwnerAuthUsers: 2`, `realOwnerStudySets: 4`, `realOwnerQuestions: 599`, `realOwnerExamAttempts: 2`). Zero edits to `src/*`, `supabase/*`, or `tests/*`.
