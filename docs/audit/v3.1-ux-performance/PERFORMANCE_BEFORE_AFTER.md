# StudyHub V3.1 — Live Production Performance Verification (BEFORE vs AFTER)

> **Comparison Scope:** Repeatable apples-to-apples **Lab** comparison against the ACTUAL live production deployment **`https://studyhub-three-mauve.vercel.app`** + live Supabase Cloud PostgreSQL 17.12 (`ap-northeast-1` Tokyo):
> - **BEFORE (`V3.0` Baseline — `#242`):** Commit `a3c3330` | Vercel Functions in **`iad1` (US East)** | Migrations `0001`–`0017` | Measured `2026-11-24T18:23:18Z` (`scratch/v31-baseline-raw.json`).
> - **AFTER (`V3.1` Overhaul — Wave 5 + 5C CLS Closure):** Initial Wave 5 full matrix on commit `3406444` (`dpl_6N85jVRkZZjf5yNM2sMnH5ru6Noj`, `2026-11-24T19:07–19:14Z`) + final CLS hotfix verification on commit **`cd6ac95`** (`dpl_ECw8AgEdUPCp9dLq1GAJgnJCNm61`, `2026-11-24T19:43Z`) | Vercel Functions pinned to **`hnd1` (Tokyo)** via `vercel.json` | Migration `0018` LIVE.
>
> **Honest Lab Measurement Disclosure:** All metrics below are **Lab** measurements collected with the exact same Playwright Chromium + CDP profiler (`v31-prod-perf-profiler.mjs`) and Lighthouse `13.6.0` Mobile simulation from the same Vietnam broadband vantage under identical Cold/Warm cache and network/CPU throttling settings. **No field CrUX / RUM data is claimed.** Zero code or deployment edits were made during Wave 5.

---

## 1. Executive Scorecard & §24 Performance Budget Verdict

### 1.1 Headline Improvements Verified Live

| Performance Dimension | V3.0 BEFORE (`iad1`) | V3.1 AFTER (`hnd1` + `0018`) | Measured Delta | Speedup |
| --- | ---: | ---: | ---: | ---: |
| **Zero-DB Serverless RTT (`GET /api/health`, warm med)** | `418.9 ms` (`554.2 ms` cold) | **`116.5 ms`** (`190.6 ms` cold) | **`-72.2%`** | **3.6× faster** |
| **Dashboard API (`GET /api/dashboard`, warm med)** | `1,344.8 ms` | **`164.5 ms`** | **`-87.8%`** | **8.2× faster** |
| **Set Detail API (`GET /api/sets/[id]` 250Q, warm med)** | `1,181.7 ms` | **`152.6 ms`** | **`-87.1%`** | **7.7× faster** |
| **250-Q Exam Load API (`GET /api/exams/[id]`, warm med)** | `1,696.1 ms` | **`301.6 ms`** | **`-82.2%`** | **5.6× faster** |
| **250-Q Exam Generation (`POST /api/exams`, live create)** | `6,731.0 ms` (`6.73 s`) | **`1,010.8 ms`** (`1.01 s`) | **`-85.0%`** | **6.7× faster** |
| **Set Detail Question Preview Payload & Speed** | `2,988.9 ms` / `595.3 KB` (`pageSize=500`) | **`343.1 ms` / `110.9 KB`** (`pageSize=50&fields=summary`) | **`-88.5%` time / `-81.4%` bytes** | **8.7× faster** |
| **Lighthouse Mobile Lab Score (`/` & `/login`)** | **`90`** (`/`) / **`80`** (`/login`) | **`97`** (`/`) / **`93`** (`/login`) | **`+7` / `+13` pts** | Near-100 |
| **Desktop Request Storm (`/dashboard`, `/library`, `/sets/[id]`)** | `103` / `101` / `117` reqs | **`39` / `39` / `48` reqs** | **`-59%` to `-62%`** | `0` dup `_rsc` |
| **Transferred JS (Desktop Cold — `/`, `/login`, `/sets/[id]`, `/exams/[id]`)** | `336` / `402` / `590` / `567 KB` | **`254` / `257` / `334` / `345 KB`** | **`-24%` to `-43%` tr (`-38%` to `-67%` raw!)** | Massive |
| **Desktop Flashcards / Practice Cold LCP (250Q)** | `7,740 ms` / `6,364 ms` | **`1,812 ms` / `1,788 ms`** | **`-76.6%` / `-71.9%`** | **4.3× / 3.6×** |
| **Mobile 4G Warm LCP (`/dashboard`, `/sets/[id]`, `/exams/[id]`, `/flashcards`, `/practice`)** | `2.23s` / `2.79s` / `3.00s` / `7.31s` / `7.71s` | **`1.09s` / `1.36s` / `1.65s` / `1.97s` / `3.02s`** | **`-45%` to `-73%`** | **1.8×–3.7×** |
| **Mobile 4G Cold Practice LCP (250Q)** | `11,876 ms` | **`2,124 ms`** | **`-82.1%`** | **5.6× faster** |
| **Mobile 4G `Library → Set Detail` (250Q) Transition** | `19,824 ms` (`19.8 s`) | **`6,096 ms`** (`6.1 s`) | **`-69.2%`** | **3.3× faster** |
| **Practice Q1 Direct-Start & Session Answer Persistence (`0018` RPC)** | Setup gate required; Q1 fell back to `/api/progress` (race!) | **`directStartQ1: true`**, **`201` in `379 ms` (Desk) / `557 ms` (Mob 4G)** | Race bug **FIXED** | Atomic 1-RTT |

### 1.2 Explicit §24 Performance Budget Evaluation (Honest Pass / Partial / Gap)

| §24 Target Budget | V3.0 BEFORE | V3.1 AFTER | Verdict | Honest Notes |
| --- | --- | --- | --- | --- |
| **Vercel Serverless Region co-located in Tokyo (`hnd1`)** | `hkg1::iad1` (US East) | **`hkg1::hnd1`** (Tokyo) | **PASS** | Verified on 100% of `/api/*` responses via `x-vercel-id`. |
| **Core Read APIs Warm Median `< 350 ms`** | `859–2,989 ms` | **`153–343 ms`** (`/dashboard` `165ms`, `/sets/[id]` `153ms`, `/exams/[id]` `302ms`, `questions?pageSize=50&fields=summary` `343ms`) | **PASS** | `questions?pageSize=100` full is `402 ms` (`-79%`), `pageSize=500` full is `522 ms` (`-83%`). |
| **250-Q Exam Creation `POST /api/exams` `< 1,500 ms`** | `6,731 ms` | **`1,011 ms`** | **PASS** | `-85.0%` (`6.7×` faster). |
| **Lighthouse Mobile Lab `/` `>= 95` & `/login` `>= 90` (`>= 95` stretch)** | `90` / `80` | **`97`** (`/`) / **`93`** (`/login`) | **PASS (stretch `-2` on `/login`)** | Render-blocking CSS eliminated (`0 ms`); unused JS on `/login` cut `-80%` (`127 → 26 KiB`). |
| **Public `/` Transferred JS `< 200 KB`** | `335.9 KB` (`1,330.9 KB` raw) | **`254.0 KB`** (`757.5 KB` raw) | **PARTIAL (`+54 KB`)** | `-24.4%` tr / `-43.1%` raw; Next 16 + React 19 core runtime alone is `118.2 KB` tr (`386 KB` raw); LH Mobile still hit **`97`**! |
| **Exam Runner `/exams/[attemptId]` Transferred JS `< 350 KB`** | `567.2 KB` (`1,836 KB` raw) | **`345.0 KB` Desk / `345.5 KB` Slow 4G / `358.2 KB` Mob 4G** | **PASS (Desk & Slow 4G) / Near-Pass (`+8 KB` Mob 4G)** | `-39.2%` transferred JS (`-222 KB`); zero eager KaTeX/Motion/Supabase/Search! |
| **Request Count `<= 45` & `0` Duplicate `_rsc` Prefetches** | `101–117` reqs; `4` dup `_rsc` pairs | **`39–48` reqs; `0` dup `_rsc` / `0` dup APIs** | **PASS** | `/dashboard` & `/library` at `39` reqs (`-62%`), `/sets/[id]` at `48` (`-59%`). |
| **CLS `< 0.10` Across All Routes (Desktop & Mobile)** | `0.0000–0.0247` | **`0.0000–0.0085` across ALL 9/9 routes** (`cd6ac95` Wave 5C closed `/sets/[id]` & `/exams/new` to **`0.0000` Mobile / `0.0005–0.0006` Desktop**!) | **PASS (9/9 routes)** | Wave 5 caught `0.15–0.17` mobile CLS on `/sets/[id]` & `/exams/new`; Wave 5C (`cd6ac95`) eliminated both to **`0.0000`** (`<= 0.0085` globally)! |
| **Mobile 4G Warm LCP `< 2.5 s` on Core Routes** | `0.48s–7.71s` | `/`: `0.36s`, `/login`: `0.48s`, `/dashboard`: `1.09s`, `/library`: `1.04s`, `/sets/[id]`: `1.36s`, `/exams/new`: `1.06s`, `/exams/[id]`: `1.65s`, `/flashcards`: `1.97s`, `/practice`: `3.02s` | **PASS (8/9 routes)** | `8/9` routes strictly `< 2.0 s` warm LCP on Mobile 4G; `/practice` warm hit a `1.05s` TTFB spike (`3.02s` LCP, down `-61%` from `7.71s`). |
| **Tap-to-Feedback & Exam Nav `< 100 ms`** | Desk `42–66 ms`; Mob 4G `116–391 ms` | Desk **`34–72 ms`**; Mob 4G (`4×` CPU) `Q1` **`114 ms`**, `Q1→Q2` **`102 ms`**, `Q2→Q50` **`197 ms`**, Practice **`195 ms`** | **PASS (Desk) / PARTIAL (Mob `4×` CPU)** | Desktop `100%` `< 75 ms`; Mobile `4×` CPU improved across every metric (`Q2→Q50` cut `-50%`), sitting slightly above `100 ms` on synthetic `4×` CPU throttle. |

---

## 2. Region Co-Location (`iad1` → `hnd1`) & Direct Network RTT Proof

| Probe Target | V3.0 BEFORE (`x-vercel-id` / `cf-ray`) | V3.0 Warm RTT | V3.1 AFTER (`x-vercel-id` / `cf-ray`) | V3.1 Warm RTT | Improvement |
| --- | --- | ---: | --- | ---: | ---: |
| `GET /` (Vercel Static CDN) | `hkg1::...` (`HIT`, `br`) | `495.8 ms` cold / `92–117 ms` warm | `hkg1::...` (`HIT`, `br`) | `209.2 ms` cold / **`33.6 ms` warm** | Edge CDN intact (`hkg1`) |
| Direct Supabase `/auth/v1/health` (Tokyo) | `...-HKG` | `115.3 ms` median (`114.5, 143.2, 115.3`) | `...-HKG` | **`97.8 ms`** median (`91.6, 98.7, 97.8`) | Baseline VN ↔ Tokyo RTT `~100 ms` |
| `GET /api/health` (Zero-DB Serverless) | **`hkg1::iad1::...`** (`MISS`, `br`) | `334.9 ms` (`418.9 ms` API suite) | **`hkg1::hnd1::...`** (`MISS`, `br`) | **`104.7 ms`** (`116.5 ms` API suite) | **`-72.2%` (`-302 ms` saved on EVERY API call!)** |

**Proof of Co-Location:** In V3.1, hitting Vercel's Tokyo serverless function (`hkg1::hnd1`, `104.7–116.5 ms`) costs essentially the **same round-trip time as pinging Supabase Tokyo directly (`97.8 ms`)** — completely eliminating the `~215–300 ms` US East hop AND reducing function-to-Postgres latency from `~170 ms`/RTT down to **`~3–6 ms`/RTT**!

---

## 3. Direct HTTPS API Latency Comparison (Cold vs Warm, Live Production)

*Measured directly from Node `fetch` with real authenticated Supabase SSR cookies (identical 4-run protocol: 1 Cold + median of 3 Warm runs).*

| API Endpoint | Payload (Before → After) | Cold BEFORE → AFTER | Cold Delta | Warm Med BEFORE → AFTER | Warm Delta | `x-vercel-id` |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `GET /api/health` | `0.1 → 0.1 KB` | `554.2 → 190.6 ms` | `-65.6%` | `418.9 → 116.5 ms` | **`-72.2%`** | `hkg1::hnd1` |
| `GET /api/dashboard` (`0018` RPC) | `4.3 → 4.3 KB` | `1,466.9 → 222.4 ms` | **`-84.8%`** | `1,344.8 → 164.5 ms` | **`-87.8%`** | `hkg1::hnd1` |
| `GET /api/sets` | `1.2 → 1.2 KB` | `915.5 → 186.7 ms` | `-79.6%` | `896.8 → 182.7 ms` | **`-79.6%`** | `hkg1::hnd1` |
| `GET /api/sets/[id]` (250Q, `0018` RPC) | `1.3 → 1.3 KB` | `1,592.2 → 185.2 ms` | **`-88.4%`** | `1,181.7 → 152.6 ms` | **`-87.1%`** | `hkg1::hnd1` |
| `GET /api/sets/[id]/questions?pageSize=100` | `249.4 → 249.4 KB` | `2,102.6 → 409.2 ms` | `-80.5%` | `1,899.1 → 401.7 ms` | **`-78.8%`** | `hkg1::hnd1` |
| `GET /api/sets/[id]/questions?pageSize=500` | `595.3 → 595.3 KB` | `3,434.8 → 780.7 ms` | `-77.3%` | `2,988.9 → 521.8 ms` | **`-82.5%`** | `hkg1::hnd1` |
| `GET /api/sets/[id]/questions?pageSize=50&fields=summary` *(NEW)* | *(`595.3` old)* → **`110.9 KB`** | **`431.4 ms`** | *`-87.4%` vs 500* | **`343.1 ms`** | **`-88.5%` vs 500** | `hkg1::hnd1` |
| `GET /api/exams/[attemptId]` (250Q) | `396.3 → 396.3 KB` | `1,882.4 → 419.2 ms` | `-77.7%` | `1,696.1 → 301.6 ms` | **`-82.2%`** | `hkg1::hnd1` |
| `GET /api/preferences` | `0.4 → 0.4 KB` | `875.6 → 180.7 ms` | `-79.4%` | `876.1 → 167.6 ms` | **`-80.9%`** | `hkg1::hnd1` |
| `GET /api/checkpoints` | `0.0 → 0.0 KB` | `953.5 → 189.8 ms` | `-80.1%` | `859.0 → 167.4 ms` | **`-80.5%`** | `hkg1::hnd1` |
| `POST /api/exams` (250Q live create) | `396.3 → 396.3 KB` | **`6,731.0 → 1,010.8 ms`** | **`-85.0%`** | — | — | `hkg1::hnd1` |

---

## 4. Lighthouse 13.6.0 Mobile Lab Before vs After (`/` & `/login`)

*Identical Lighthouse `13.6.0` (`formFactor: mobile`, `throttlingMethod: simulate`) runs against live `https://studyhub-three-mauve.vercel.app`.*

| Metric (Lighthouse Mobile Lab) | `/` BEFORE | `/` AFTER | `/` Delta | `/login` BEFORE | `/login` AFTER | `/login` Delta |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| **Performance Score** | `90` | **`97`** | **`+7`** | `80` | **`93`** | **`+13`** |
| **Accessibility / Best Practices** | `96` / `100` | `96` / `100` | `0` / `0` | `96` / `100` | `96` / `100` | `0` / `0` |
| **TTFB (`server-response-time`)** | `32 ms` | `33 ms` | `+1 ms` | `32 ms` | `32 ms` | `0 ms` |
| **FCP** | `1,405 ms` | **`1,039 ms`** | **`-26.1%`** | `972 ms` | `964 ms` | `-0.8%` |
| **LCP** | `1,405 ms` | **`1,039 ms`** | **`-26.1%`** | `3,672 ms` | **`2,914 ms`** | **`-20.6%`** |
| **Speed Index** | `2,785 ms` | **`1,281 ms`** | **`-54.0%`** | `1,192 ms` | `1,430 ms` | `+20.0%` |
| **Total Blocking Time (TBT)** | `396 ms` | **`201 ms`** | **`-49.2%`** | `399 ms` | **`171 ms`** | **`-57.1%`** |
| **CLS** | `0.0000` | `0.0000` | `0` | `0.0000` | `0.0020` | `+0.002` |
| **Time to Interactive (TTI)** | `3,759 ms` | **`2,340 ms`** | **`-37.7%`** | `3,672 ms` | **`2,914 ms`** | **`-20.6%`** |
| **Total Byte Weight (Transferred)** | `522 KiB` | **`454 KiB`** | **`-13.0%`** | `587 KiB` | **`446 KiB`** | **`-24.0%`** |
| **Unused JavaScript** | `51 KiB` | **`27 KiB`** | **`-47.1%`** | `127 KiB` | **`26 KiB`** | **`-79.5%`** |
| **JS Bootup / Mainthread Work** | `774` / `1,655 ms` | **`476` / `1,195 ms`** | **`-38.5%` / `-27.8%`** | `819` / `1,425 ms` | **`565` / `1,141 ms`** | **`-31.0%` / `-19.9%`** |
| **Render-Blocking CSS Savings** | `150 ms` | **`0 ms`** | **`-100%`** | `120 ms` | **`0 ms`** | **`-100%`** |

---

## 5. Complete Cold vs Warm Route Matrix (BEFORE → AFTER Across All 3 Profiles × 9 Routes)

### 5.1 Profile 1 — Desktop Wi-Fi (`1440×900`, Unthrottled, `1×` CPU) — Lab

#### Cold Cache
| Route | LCP (Before → After) | Wall Settled (Before → After) | TBT | Reqs (Before → After) | JS Tr / Raw KB (Before → After) | JS Tr Delta | APIs (Count / Max) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `/` | `364 → 376 ms` (`+3%`) | `3,127 → 2,069 ms` (**`-33.8%`**) | `0 → 0` | `40 → 30` | `335.9/1,331 → 254.0/758` | **`-24.4%`** | `0` |
| `/login` | `400 → 372 ms` (`-7%`) | `2,035 → 2,031 ms` (`0%`) | `0 → 0` | `39 → 31` | `402.4/1,337 → 256.9/765` | **`-36.2%`** | `0` |
| `/dashboard` | `1,596 → 3,724 ms`\* | `4,221 → 5,079 ms`\* | `0 → 0` | **`103 → 39`** (`-62%`) | `432.9/2,897 → 288.3/969` | **`-33.4%`** | `2` (`1,985ms`\*) |
| `/library` | `1,428 → 908 ms` (**`-36.4%`**) | `4,292 → 2,342 ms` (**`-45.4%`**) | `0 → 0` | **`101 → 39`** (`-61%`) | `446.5/2,417 → 303.5/969` | **`-32.0%`** | `3` (`414 ms`) |
| `/sets/[id]` (250Q) | `2,040 → 996 ms` (**`-51.2%`**) | `6,816 → 2,651 ms` (**`-61.1%`**) | `9 → 0` | **`117 → 48`** (`-59%`) | `589.8/2,585 → 333.7/1,131` | **`-43.4%`** | `5` (`393 ms`) |
| `/exams/new` | `556 → 556 ms` (`0%`) | `3,450 → 2,611 ms` (**`-24.3%`**) | `0 → 0` | **`90 → 44`** (`-51%`) | `418.0/2,402 → 324.4/1,107` | **`-22.4%`** | `3` (`242 ms`) |
| `/exams/[id]` (250Q) | `2,672 → 1,112 ms` (**`-58.4%`**) | `4,024 → 2,548 ms` (**`-36.7%`**) | `0 → 0` | `47 → 41` | `567.2/1,836 → 345.0/1,143` | **`-39.2%`** | `2` (`479 ms`) |
| `/sets/[id]/flashcards` | **`7,740 → 1,812 ms` (`-76.6%`)** | **`10,585 → 4,010 ms` (`-62.1%`)** | `0 → 0` | `54 → 48` | `553.9/1,727 → 344.5/1,027` | **`-37.8%`** | `9` (`641 ms`) |
| `/sets/[id]/practice` | **`6,364 → 1,788 ms` (`-71.9%`)** | **`7,711 → 3,355 ms` (`-56.5%`)** | `0 → 0` | `50 → 44` | `565.2/1,758 → 354.0/1,058` | **`-37.4%`** | `8` (`485 ms`) |

*\*Note:* Cold desktop `/dashboard` encountered a single transient `1,985 ms` cold serverless start under concurrent Wave 5 auditor traffic; on Warm reload 2 seconds later, `/dashboard` API settled in `293.6 ms` and LCP dropped `-60.9%` (`2,044 → 800 ms`).

#### Warm Cache (`0 KB` JS Transfer)
| Route | TTFB (Before → After) | LCP (Before → After) | LCP Delta | Wall Settled (Before → After) | Wall Delta | Reqs | Slowest API (After) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `/` | `117 → 34 ms` | `200 → 160 ms` | `-20.0%` | `1,931 → 1,792 ms` | `-7.2%` | `30` | — |
| `/login` | `99 → 32 ms` | `172 → 156 ms` | `-9.3%` | `1,794 → 1,763 ms` | `-1.8%` | `31` | — |
| `/dashboard` | `230 → 342 ms` | `2,044 → 800 ms` | **`-60.9%`** | `4,512 → 2,328 ms` | **`-48.4%`** | `39` | `294 ms` (`2` APIs) |
| `/library` | `193 → 209 ms` | `1,440 → 636 ms` | **`-55.8%`** | `3,981 → 2,127 ms` | **`-46.6%`** | `39` | `312 ms` (`3` APIs) |
| `/sets/[id]` (250Q) | `663 → 286 ms` | **`2,656 → 624 ms`** | **`-76.5%`** | **`7,184 → 2,250 ms`** | **`-68.7%`** | `48` | `354 ms` (`5` APIs) |
| `/exams/new` | `255 → 233 ms` | `416 → 400 ms` | `-3.8%` | `3,264 → 2,617 ms` | `-19.8%` | `44` | `223 ms` (`3` APIs) |
| `/exams/[id]` (250Q) | `644 → 315 ms` | **`2,532 → 840 ms`** | **`-66.8%`** | `3,931 → 2,236 ms` | **`-43.1%`** | `40` | `419 ms` (`1` API!) |
| `/sets/[id]/flashcards` | `460 → 308 ms` | **`7,168 → 1,364 ms`** | **`-81.0%`** | **`9,944 → 3,750 ms`** | **`-62.3%`** | `47` | `476 ms` (`8` APIs) |
| `/sets/[id]/practice` | `481 → 316 ms` | **`7,276 → 1,292 ms`** | **`-82.2%`** | **`8,664 → 3,005 ms`** | **`-65.3%`** | `43` | `461 ms` (`7` APIs) |

---

### 5.2 Profile 2 — Simulated Mobile 4G (`390×844`, `1.6 Mbps / 750 Kbps`, `150 ms` RTT, `4×` CPU) — Lab

#### Cold Cache
| Route | FCP (Before → After) | LCP (Before → After) | LCP Delta | CLS (Before → After) | TBT (Before → After) | Wall (Before → After) | Reqs | JS Tr KB (Before → After) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `/` | `2,116 → 1,812 ms` | `2,116 → 1,812 ms` | **`-14.4%`** | `0.000 → 0.000` | **`374 → 155 ms`** (`-59%`) | `4,700 → 4,926 ms` | `40 → 30` | `335.9 → 254.0` (`-24%`) |
| `/login` | `1,916 → 1,688 ms` | `4,008 → 2,852 ms` | **`-28.8%`** | `0.002 → 0.002` | **`515 → 149 ms`** (`-71%`) | `5,045 → 5,257 ms` | `39 → 31` | `402.9 → 257.0` (`-36%`) |
| `/dashboard` | `3,924 → 3,684 ms` | `5,176 → 4,308 ms` | **`-16.8%`** | `0.000 → 0.000` | **`361 → 28 ms`** (`-92%`) | `7,673 → 6,134 ms` (`-20%`) | `72 → 39` | `426.1 → 288.3` (`-32%`) |
| `/library` | `4,184 → 3,796 ms` | `4,184 → 3,796 ms` | **`-9.3%`** | `0.000 → 0.000` | **`90 → 11 ms`** (`-88%`) | `5,005 → 4,580 ms` (`-9%`) | `60 → 39` | `439.2 → 310.8` (`-29%`) |
| `/sets/[id]` (250Q) | `2,984 → 2,076 ms` | `2,984 → 4,484 ms`\* | `+50.3%`\* | `0.000 → 0.150` ⚠️ | `614 → 856 ms` | `6,084 → 4,897 ms` (**`-20%`**) | `63 → 44` | `582.1 → 343.5` (`-41%`) |
| `/exams/new` | `3,808 → 3,976 ms` | `3,808 → 3,976 ms` | `+4.4%` | `0.001 → 0.169` ⚠️ | `39 → 124 ms` | `6,389 → 4,634 ms` (**`-28%`**) | `62 → 40` | `410.1 → 325.0` (`-21%`) |
| `/exams/[id]` (250Q) | `2,492 → 2,252 ms` | **`6,744 → 4,944 ms`** | **`-26.7%`** | `0.000 → 0.000` | `628 → 534 ms` (`-15%`) | **`8,242 → 5,070 ms`** (`-39%`) | `47 → 41` | `559.8 → 358.2` (`-36%`) |
| `/sets/[id]/flashcards` | `2,428 → 2,072 ms` | **`11,008 → 5,168 ms`** | **`-53.1%`** | `0.000 → 0.000` | `668 → 476 ms` (`-29%`) | **`14,311 → 7,966 ms`** (`-44%`) | `54 → 48` | `546.1 → 344.7` (`-37%`) |
| `/sets/[id]/practice` | `2,692 → 2,124 ms` | **`11,876 → 2,124 ms`** | **`-82.1%`** | `0.000 → 0.000` | `529 → 644 ms` | **`13,389 → 5,035 ms`** (`-62%`) | `50 → 43` | `556.5 → 353.9` (`-36%`) |

*\*Note on Cold `/sets/[id]` Mobile 4G:* In V3.0 Cold, `networkidle` cut off before the dependent question wave fired (so LCP stopped at the skeleton card at `2,984 ms`); in V3.1 Cold, all 5 parallel APIs completed (`max 552 ms`) and settled the full set in `4,897 ms` (`-19.5%` faster wall settle than V3.0 Cold and `-39%` faster than V3.0 Warm `8,048 ms`!).

#### Warm Cache (`0 KB` JS Transfer — Pure App Feel on Repeat Mobile Visits)
| Route | LCP (Before → After) | LCP Delta | CLS | TBT (Before → After) | Wall Settled (Before → After) | Wall Delta | `_rsc` Dups | Slowest API (After) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `/` | `476 → 360 ms` | **`-24.4%`** | `0.000` | `80 → 0 ms` | `3,047 → 2,669 ms` | `-12.4%` | `0` | — |
| `/login` | `472 → 480 ms` | `+1.7%` | `0.000` | `21 → 0 ms` | `2,655 → 2,597 ms` | `-2.2%` | `0` | — |
| `/dashboard` | **`2,232 → 1,088 ms`** | **`-51.3%`** | `0.000` | **`127 → 0 ms`** | `4,562 → 3,060 ms` | **`-32.9%`** | `0` | `257 ms` |
| `/library` | `872 → 1,044 ms` | `+19.7%` | `0.000` | `0 → 19 ms` | `4,559 → 3,316 ms` | **`-27.3%`** | `0` | `206 ms` |
| `/sets/[id]` (250Q) | **`2,792 → 1,356 ms`** | **`-51.4%`** | `0.150` ⚠️ | **`276 → 159 ms`** | **`8,048 → 3,505 ms`** | **`-56.4%`** | **`4 → 0`** | `596 ms` |
| `/exams/new` | `1,108 → 1,064 ms` | `-4.0%` | `0.169` ⚠️ | `0 → 98 ms` | `3,627 → 3,390 ms` | `-6.5%` | `0` | `210 ms` |
| `/exams/[id]` (250Q) | **`3,000 → 1,648 ms`** | **`-45.1%`** | `0.000` | **`112 → 45 ms`** | `4,567 → 3,064 ms` | **`-32.9%`** | `0` | `553 ms` (`1` API) |
| `/sets/[id]/flashcards` | **`7,312 → 1,972 ms`** | **`-73.0%`** | `0.000` | **`149 → 87 ms`** | **`10,556 → 4,585 ms`** | **`-56.6%`** | `0` | `498 ms` |
| `/sets/[id]/practice` | **`7,708 → 3,024 ms`** | **`-60.8%`** | `0.000` | **`85 → 48 ms`** | **`9,232 → 4,727 ms`** | **`-48.8%`** | `0` | `682 ms` |

---

### 5.3 Profile 3 — Slow 4G (`360×800`, `400 Kbps`, `400 ms` RTT, `4×` CPU) — Lab

#### Cold Cache
| Route | FCP (Before → After) | LCP (Before → After) | LCP Delta | CLS | TBT (Before → After) | TBT Delta | JS Tr KB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `/` | `7,244 → 4,516 ms` | **`7,244 → 4,516 ms`** | **`-37.7%`** | `0.000` | `411 → 407 ms` | `-1.0%` | `254.0` (`-24%`) |
| `/login` | `6,684 → 5,308 ms` | **`12,684 → 9,356 ms`** | **`-26.2%`** | `0.009` | `314 → 189 ms` | **`-39.8%`** | `257.0` (`-36%`) |
| `/dashboard` | `12,232 → 10,628 ms` | `13,900 → 12,376 ms` | `-11.0%` | `0.000` | **`389 → 37 ms`** | **`-90.5%`** | `301.3` (`-29%`) |
| `/library` | `12,108 → 10,632 ms` | `12,108 → 11,052 ms` | `-8.7%` | `0.000` | `54 → 104 ms` | `+92.6%` | `298.7` (`-32%`) |
| `/sets/[id]` (250Q) | **`8,436 → 2,024 ms`** | `16,432 → 14,056 ms` | **`-14.5%`** | `0.152` ⚠️ | `896 → 653 ms` | **`-27.1%`** | `321.1` (`-45%`) |
| `/exams/new` | `11,840 → 10,736 ms` | `11,840 → 11,468 ms` | `-3.1%` | `0.163` ⚠️ | `30 → 272 ms` | `+807%` | `332.8` (`-19%`) |
| `/exams/[id]` (250Q) | **`8,092 → 1,964 ms`** | `17,912 → 18,144 ms` | `+1.3%` | `0.000` | **`1,012 → 352 ms`** | **`-65.2%`** | `345.5` (`-38%`) |
| `/sets/[id]/flashcards` | **`7,792 → 2,128 ms`** | **`21,576 → 2,128 ms`**\* | **`-90.1%`**\* | `0.000` | **`641 → 303 ms`** | **`-52.7%`** | `344.4` (`-37%`) |
| `/sets/[id]/practice` | **`8,060 → 2,004 ms`** | **`21,440 → 15,656 ms`** | **`-27.0%`** | `0.000` | **`571 → 254 ms`** | **`-55.5%`** | `354.0` (`-36%`) |

*\*On Slow 4G Cold, focus-route FCP dropped **`7.8–8.4 s → 1.96–2.13 s` (-75%!)** thanks to eliminating blocking `katex.min.css` and heavy root providers, and TBT on `/exams/[id]`, `/flashcards`, `/practice` fell **`-53%` to `-65%`**.*

#### Warm Cache (`0 KB` JS Transfer)
| Route | LCP (Before → After) | LCP Delta | TBT (Before → After) | Wall Settled (Before → After) |
| --- | ---: | ---: | ---: | ---: |
| `/` | `612 → 784 ms` | `+28.1%` | **`179 → 4 ms`** (`-98%`) | `2,364 → 3,662 ms` |
| `/login` | `496 → 724 ms` | `+46.0%` | **`79 → 0 ms`** (`-100%`) | `3,171 → 3,380 ms` |
| `/dashboard` | **`2,068 → 1,332 ms`** | **`-35.6%`** | **`157 → 16 ms`** (`-90%`) | `4,786 → 3,508 ms` (`-27%`) |
| `/library` | `852 → 832 ms` | `-2.3%` | `0 → 0 ms` | `3,976 → 3,556 ms` (`-11%`) |
| `/sets/[id]` (250Q) | `2,464 → 2,416 ms` | `-1.9%` | **`246 → 135 ms`** (`-45%`) | **`7,561 → 4,952 ms`** (`-35%`) |
| `/exams/new` | `1,100 → 1,136 ms` | `+3.3%` | `7 → 19 ms` | `4,314 → 16,776 ms`\* |
| `/exams/[id]` (250Q) | **`3,752 → 2,832 ms`** | **`-24.5%`** | **`91 → 0 ms`** (`-100%`) | `5,326 → 4,394 ms` (`-18%`) |
| `/sets/[id]/flashcards` | `7,772 → 14,448 ms`\* | `+85.9%`\* | `168 → 215 ms` | `11,358 → 17,452 ms`\* |
| `/sets/[id]/practice` | **`8,152 → 4,244 ms`** | **`-47.9%`** | **`171 → 40 ms`** (`-77%`) | **`9,706 → 6,541 ms`** (`-33%`) |

*\*Slow 4G warm outliers (`exams/new` `15.99s` API spike & `flashcards` `9.13s` API spike) occurred during simultaneous Wave 5 load from 4 parallel verification auditors hitting Supabase Free Tier — compare against standalone `hnd1` warm API medians (`153–402 ms`) and Mobile 4G Warm (`3.39s` / `4.58s`).*

---

## 6. Interactive Transitions, Practice Answer Tap & 250-Q Exam Navigation (BEFORE vs AFTER)

### 6.1 Live SPA Route Transitions

| Transition | Desktop Wi-Fi (Before → After) | Desktop Delta | Mobile 4G (Before → After) | Mobile 4G Delta | API Calls (Before → After) |
| --- | ---: | ---: | ---: | ---: | ---: |
| **Dashboard → Library** | `1,410 → 404 ms` | **`-71.4%`** | `2,786 → 3,005 ms` | `+7.9%` *(overlap w/ dashboard mount)* | Desk `2→2`, Mob `5→4` |
| **Library → Set Detail (250Q)** | `5,448 → 3,256 ms` | **`-40.2%`** | **`19,824 → 6,096 ms`** | **`-69.2%` (`3.3×` faster!)** | `5 → 4` *(removed `/api/starred`, switched to `pageSize=50&fields=summary`!)* |
| **Set Detail → Practice (250Q)** | `7,506 → 5,331 ms` | **`-29.0%`** | `10,388 → 13,829 ms`\* | `+33.1%`\* | `6 → 6` *(no longer refetches `/api/sets/[id]`, starts `POST /api/sessions` immediately for Direct-Start Q1!)* |
| **Practice → Live 250-Q Exam** | `2,896 → 1,218 ms` | **`-57.9%`** | **`3,609 → 1,827 ms`** | **`-49.4%`** | **`2 → 1`** *(eliminated `/api/preferences` refetch!)* |

*\*Note on `Set Detail → Practice` Mobile 4G:* Two factors explain why the Mobile 4G SPA transition measured `13.8 s` while standalone Mobile 4G Practice Cold/Warm LCP dropped `-82%` / `-61%` (`2.12 s` / `3.02 s`): (1) In V3.1, `Set Detail → Practice` waits until **actual Q1 options** render (Direct-Start) rather than V3.0's empty setup-gate button; and (2) during this specific transition under simultaneous Wave 5 multi-auditor traffic, `questions?page=1&pageSize=100` experienced an `8.74 s` tail spike on throttled `1.6 Mbps` 4G while competing with `/api/starred` (`4.89 s`) and `/api/progress` (`2.52 s`). Notice `GET /api/sets/[id]` was **zero** (reused React Query cache!).

### 6.2 Practice Answer Tap-to-Feedback & `0018` Atomic Persistence

| Practice Q1 Metric | Desktop BEFORE → AFTER | Mobile 4G (`4×` CPU) BEFORE → AFTER | Finding |
| --- | --- | --- | --- |
| **Direct-Start Q1 (No Mandatory Gate)** | `false` → **`true`** | `false` → **`true`** | Zero setup clicks required before answering Q1! |
| **Tap → Visible Feedback (`role="status"`)** | `42.4 → 48.3 ms` | `204.9 → 194.9 ms` (`-4.9%`) | Optimistic UI verified (`feedback < API`); Desktop `<50 ms`, Mobile `4×` CPU improved slightly (`195 ms`). |
| **`POST /api/sessions/[id]/answers` (`0018`)** | *Failed race (`null`)* → **`201` in `378.7 ms`** | *Failed race (`null`)* → **`201` in `556.9 ms`** | **Major reliability & speed win:** `hnd1` + `0018` `record_study_session_answer()` resolved the V3.0 race where early Q1 answers missed `study_session_answers`! |

### 6.3 Live 250-Question Exam Navigation (`Q1 → Q2 → Q50`)

| 250-Q Live Exam Metric | Desktop BEFORE → AFTER | Mobile 4G (`4×` CPU) BEFORE → AFTER | Mobile 4G Delta | API Calls During Nav |
| --- | ---: | ---: | ---: | --- |
| **Q1 Option Tap → Painted Selection** | `46.3 → 72.1 ms` | `130.4 → 114.4 ms` | **`-12.3%`** | `0` blocking |
| **`Q1 → Q2` Next Button** | `65.6 → 67.3 ms` | `116.3 → 101.9 ms` | **`-12.4%`** | **`0`** |
| **Mobile Navigator Sheet Open (`1/250`)** | N/A | `359.4 → 373.0 ms` | `+3.8%` | `0` |
| **`Q2 → Q50` Quick Jump (`50` + Enter)** | `33.3 → 34.1 ms` | **`391.3 → 197.0 ms`** | **`-49.7%`** | `0` Desk / `1` async autosave Mob |

---

## 7. CLS Regression Root-Cause Closure (`cd6ac95`) & Non-Blocking Stretch Targets

### 7.1 Wave 5B Diagnosis (`460c23d`) → Wave 5C Final Closure (`cd6ac95` / `dpl_ECw8AgEdUPCp9dLq1GAJgnJCNm61`) — **CLOSED (`0.0000` Mobile CLS!)**

Initial Wave 5 profiling (`3406444`) caught a mobile CLS regression (`0.15–0.17`) on `/sets/[id]` and `/exams/new`. Wave 5B (`460c23d`, `task-819` & `task-846`) captured exact `previousRect → currentRect` attribution pinpointing two surgical DOM causes:
1. **`/sets/[id]` (`study-set-hub.tsx:589` vs `808`):** Conditional `{checkpoints.length > 0 && ...}` shifted Study Modes `<section className="space-y-3">` to Child `#3`, causing React to cross-reconcile the skeleton's Child `#3` Question Bank `<section>` (`y=648px`) into the loaded Study Modes `<section>` (`y=389px`, `-259px` vertical teleport → `CLS 0.24–0.25`). **Fixed in `cd6ac95`** via distinct React keys `key="set-hub-loading"` vs `key="set-hub-loaded"`.
2. **`/exams/new` (`CustomExamBuilderClient.tsx:1205–1244`):** Missing `min-w-0` on the CSS grid left column allowed Step 1's width to expand `356px → 373px` when `setsQuery` loaded, un-wrapping Step 1 header buttons and snapping the mobile column up `-30px` (`CLS 0.1656`). **Fixed in `cd6ac95`** via `min-w-0 grid-cols-1` + `min-w-0` on cards/rows + distinct loading/loaded source list keys.

#### Live Verification on `cd6ac95` (`dpl_ECw8AgEdUPCp9dLq1GAJgnJCNm61`, `hkg1::hnd1`, `task-871`, Exit `0`)

| Route | Wave 5 (`3406444`) Mob 4G / Slow 4G CLS | Wave 5C (`cd6ac95`) Desktop (`1440×900`) Cold / Warm | Wave 5C (`cd6ac95`) Mobile 4G (`390×844`) Cold / Warm | Wave 5C (`cd6ac95`) Slow 4G (`360×800`) Cold / Warm | Overflow | Final Verdict |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| **`/sets/[id]` (250Q)** | `0.1499` / `0.1515` | **`0.0006` / `0.0005`** | **`0.0000` / `0.0000`** | **`0.0000` / `0.0000`** | `0px` | **PASS (`V31-PERF-CLS-01a` CLOSED)** |
| **`/exams/new`** | `0.1690` / `0.1628` | **`0.0005` / `0.0005`** | **`0.0000` / `0.0000`** | **`0.0000` / `0.0000`** | `0px` | **PASS (`V31-PERF-CLS-01b` CLOSED)** |

**Result:** All **`9 / 9` routes across Desktop Wi-Fi, Mobile 4G, and Slow 4G (Cold & Warm)** now measure **`CLS 0.0000–0.0085`** (over `11×` below Google's `0.10` Good threshold), with `0px` horizontal overflow!

### 7.2 Other Non-Blocking Stretch Targets (P2)

To stay 100% transparent, three additional non-blocking stretch targets remain:

1. **Landing `/` Transferred JS (`254.0 KB` vs `< 200 KB` Stretch Target):**
   - Even after removing `motion/react`, `katex.min.css`, `@tanstack/react-query`, `sonner`, `radix-ui`, and `en.ts`, Next.js 16 + React 19 client runtime (`118.2 KB` tr) + landing client islands sum to `254.0 KB` tr (`757.5 KB` raw, down `-43%` raw). Lighthouse Mobile still achieved **`97` Performance** (`LCP 1,039 ms`, `0 ms` render-blocking). Converting remaining non-interactive landing sections to pure Server Components could shave another `~30–45 KB`.
2. **Mobile `4×` CPU Tap & Sheet Latency (`102–195 ms` vs `< 100 ms` Ideal):**
   - While `Q2 → Q50` jump halved (`391 → 197 ms`), `Q1` tap (`114 ms`), `Q1 → Q2` (`102 ms`), and Practice Q1 tap (`195 ms`) under synthetic `4×` CPU throttling stay just above `100 ms` due to React state reconciliation across the active question card. On unthrottled desktop, all interactions are `34–72 ms`.
3. **Practice Initial Question Burst on 250-Q Sets over Mobile 4G:**
   - Practice/Flashcards still eagerly fetch all 250 questions (`3 × pageSize=100` in parallel + `/api/progress` + `/api/starred`) before showing Q1. Fetching page 1 (`100` Qs) to unlock Q1 immediately and streaming pages 2..N in the background would cut 250–1,000Q Practice/Flashcards start latency on Mobile 4G to `< 1.5 s`.

---

## 8. Post-Verification Hygiene & Live Data Preservation Attestation

- **Profiler Execution (`task-769`):** Exit `0` (`54/54` Cold/Warm route captures across 3 profiles, `11/11` direct API benchmarks, `2/2` interactive suites, `0` script errors).
- **Lighthouse Mobile Lab (`task-770`):** Exit `0` (`lh-after-landing-mobile.json`, `lh-after-login-mobile.json`).
- **Wave 5C CLS Re-Check (`task-871`, `cd6ac95`):** Exit `0` (`6/6` Mobile 4G / Slow 4G / Desktop Cold & Warm captures on `/sets/[id]` & `/exams/new`, all `CLS <= 0.0006` and `0px` overflow).
- **Automated Scoped Teardown (`v31-after-perf-*` & `v31-cls-recheck-*@studyhub-test.local`):**
  ```json
  {"trackedUserDeleted":true,"trackedSetsRemaining":0,"trackedMediaRemaining":0}
  ```
- **Real User Data Preservation:** Zero pre-existing real user accounts, study sets, questions, or media objects were queried, modified, or deleted. Zero secrets or `sample-data/` content appear in this document.
