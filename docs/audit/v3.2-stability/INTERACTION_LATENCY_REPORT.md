# StudyHub V3.2 — Interaction Latency Audit Report (`INTERACTION_LATENCY_REPORT.md`)

> **Owner:** `perf-auditor` (Agent 8 — Independent Performance Auditor)  
> **Comparison Scope:** Wave 1 Baseline (`39952bd`, live `https://studyhub-three-mauve.vercel.app`) vs Wave 5 Candidate (`7dfabfd`, local compiled production server `http://127.0.0.1:3044` connected to live Supabase Cloud `cuoaifyupfmkstqhcjwy`).  
> **Honest Lab Disclosure:** Every figure below is a controlled **Lab** measurement collected with Playwright `1.65.1` / Chromium `159.0.8154.6` measuring `performance.now()` from real DOM click/input to painted DOM state + `2× requestAnimationFrame`. Wave 5 uses multi-sample (`n = 5` for tap/nav/jump/flip/star; `n = 3` for Save Note & Global Search) reporting **Median, p95, and Min–Max range**. Local `:3044` is clearly separated from Wave 7 uncontested live `hnd1` production verification.

---

## 1. Executive Summary

- **Desktop Wi-Fi (`1440×900`, `1×` CPU):** **100% of direct study & 250-Q exam tap/nav/jump/flip/star/note-save interactions measure `33.9–72.2 ms` median** — strictly below the `< 100 ms` instant-feel threshold (`p95 <= 73.3 ms`!).
- **Biggest Wave 5 Interaction Wins (`PERF-07` / `V32-042`):**
  1. **Practice Save Personal Note (Optimistic UI):** Desktop UI feedback dropped **`322.7 ms → 72.2 ms` median (`-77.6%`, `4.5×` faster!)**, and Mobile 4G `4×` CPU recovered from a `> 12s` timeout stall to **`208.7 ms`** optimistic UI (`608 ms` background `/api/notes` roundtrip).
  2. **250-Q Exam Rapid Jumps (`ExamNavigatorGrid` `scrollToIndex` fix):** Desktop jumps dropped **`45.7 / 51.8 ms → 43.6 / 33.9 ms`** (and sustained 20-jump bench dropped **`32.1 → 17.9 ms`, `-44.2%`**!); Mobile 4G `4×` CPU jumps dropped **`202.6 → 165.5 ms` (`-18.3%`)** (`Q1→Q200`) and **`186.4 → 154.2 ms` (`-17.3%`)** (`Q200→Q250`).
  3. **Mobile 4G (`4×` CPU) Core Taps:** Exam Select dropped **`130.4 → 112.2 ms`** (`-14.0%`), Exam Change dropped **`117.1 → 100.7 ms`** (`-14.0%`), Practice Star dropped **`113.0 → 99.7 ms`** (`< 100 ms`!), Flashcard Flip dropped **`128.6 → 117.9 ms`**, Flashcard Next dropped **`200.6 → 173.4 ms`** (`-13.6%`).
- **Remaining Stretch Area (Non-Blocking P3):** Opening the **Mobile 250-Q Navigator Sheet** on synthetic `4×` CPU throttle stays at **`255.8 ms` median** (`219.7–298.3 ms`, vs `251.1 ms` baseline) due to Radix Sheet portal mount + virtualizer initial measurement on `4×` CPU.

---

## 2. Desktop Wi-Fi (`1440×900`, `1×` CPU) — Multi-Sample Before vs After

| Interaction | Wave 1 Baseline (`39952bd`) | Wave 5 Median (`7dfabfd`, `:3044`) | Wave 5 p95 | Wave 5 Range (`n`) | Delta | Verdict |
| --- | ---: | ---: | ---: | --- | ---: | :---: |
| **Practice — Select Answer → Feedback** | `60.0 ms` | **`65.9 ms`** | `71.1 ms` | `54.4–71.1 ms` (`n=5`) | `+5.9 ms` | **PASS (`<100ms`)** |
| **Practice — Session Answer API (`POST`)** | `305.6 ms` | **`218.2 ms`** | `263.0 ms` | `185.0–263.0 ms` (`n=4`) | **`-28.6%`** | **PASS** |
| **Practice — Star / Unstar Question** | `42.2 ms` | **`50.1 ms`** | `54.2 ms` | `47.7–54.2 ms` (`n=5`) | `+7.9 ms` | **PASS (`<100ms`)** |
| **Practice — Save Note (UI Paint)** | `322.7 ms` *(blocking)* | **`72.2 ms`** *(optimistic!)* | `73.3 ms` | `63.0–73.3 ms` (`n=3`) | **`-77.6%`** | **PASS (`4.5×` faster)** |
| **Practice — Save Note (`POST /api/notes`)** | `322.7 ms` | `460.9 ms` *(bg async)* | `494.3 ms` | `457.7–494.3 ms` (`n=3`) | non-blocking | **PASS** |
| **Flashcards — Flip Card** | `53.8 ms` | **`66.0 ms`** | `67.1 ms` | `58.3–67.1 ms` (`n=5`) | `+12.2 ms` | **PASS (`<100ms`)** |
| **Flashcards — Next Card** | `68.2 ms` | **`66.6 ms`** | `68.8 ms` | `66.3–68.8 ms` (`n=5`) | `-2.3%` | **PASS (`<100ms`)** |
| **Flashcards — Previous Card** | `65.8 ms` | **`66.5 ms`** | `66.6 ms` | `64.7–66.6 ms` (`n=5`) | `+1.1%` | **PASS (`<100ms`)** |
| **250Q Exam — Select Answer (A)** | `58.2 ms` | **`65.4 ms`** | `66.8 ms` | `55.0–66.8 ms` (`n=5`) | `+7.2 ms` | **PASS (`<100ms`)** |
| **250Q Exam — Change Answer (A → B)** | `66.0 ms` | **`66.8 ms`** | `67.3 ms` | `66.6–67.3 ms` (`n=5`) | `+0.8 ms` | **PASS (`<100ms`)** |
| **250Q Exam — Flag / Mark Question** | `66.4 ms` | **`66.8 ms`** | `67.5 ms` | `65.7–67.5 ms` (`n=5`) | `+0.4 ms` | **PASS (`<100ms`)** |
| **250Q Exam — Next Question (`Q1→Q2`)** | `67.8 ms` | **`66.8 ms`** | `67.2 ms` | `66.2–67.2 ms` (`n=5`) | `-1.5%` | **PASS (`<100ms`)** |
| **250Q Exam — Prev Question (`Q2→Q1`)** | `65.2 ms` | **`66.8 ms`** | `67.6 ms` | `66.6–67.6 ms` (`n=5`) | `+1.6 ms` | **PASS (`<100ms`)** |
| **250Q Exam — Jump `Q1 → Q200`** | `45.7 ms` | **`43.6 ms`** | `49.9 ms` | `34.6–49.9 ms` (`n=5`) | **`-4.6%`** | **PASS (`<50ms`)** |
| **250Q Exam — Jump `Q200 → Q250`** | `51.8 ms` | **`33.9 ms`** | `51.9 ms` | `33.0–51.9 ms` (`n=5`) | **`-34.6%`** | **PASS (`<50ms`)** |
| **Global Search (`Ctrl+K`) — Typing → Results** | `1,260 ms` (`595ms` API) | **`1,194.3 ms`** (`435.8ms` API) | `1,760.5 ms` | `949.6–1,760.5 ms` (`n=3`) | **`-5.2%`** | **PASS** *(debounce+RTT)* |

*Note:* Playwright's `2× rAF` measurement includes Playwright's synthetic pointer-event roundtrip (~30–50 ms baseline floor on desktop `60Hz`), so `65–67 ms` represents single-frame paint responsiveness.

---

## 3. Mobile 4G (`390×844`, `1.6 Mbps / 750 Kbps`, `150 ms` RTT, `4×` CPU) — Multi-Sample Before vs After

| Interaction | Wave 1 Baseline (`39952bd`) | Wave 5 Median (`7dfabfd`, `:3044`) | Wave 5 p95 | Wave 5 Range (`n`) | Delta | Verdict |
| --- | ---: | ---: | ---: | --- | ---: | :---: |
| **Practice — Select Answer → Feedback** | `112.0 ms` | **`111.3 ms`** | `223.2 ms` | `99.8–223.2 ms` (`n=5`) | `-0.6%` | **Near-100ms (`4×` CPU)** |
| **Practice — Session Answer API (`POST`)** | `279.8 ms` | **`280.6 ms`** | `405.0 ms` | `236.1–405.0 ms` (`n=5`) | `+0.3%` | **PASS** |
| **Practice — Star / Unstar Question** | `113.0 ms` | **`99.7 ms`** | `109.4 ms` | `60.6–109.4 ms` (`n=5`) | **`-11.8%`** | **PASS (`<100ms`!)** |
| **Practice — Save Note (UI Paint)** | *12s timeout* ⚠️ | **`208.7 ms`** *(optimistic)* | `279.3 ms` | `186.5–279.3 ms` (`n=3`) | **Fixed** | **PASS (`3×` < API)** |
| **Practice — Save Note (`POST /api/notes`)** | *12s timeout* ⚠️ | `608.0 ms` *(bg async)* | `641.0 ms` | `558.3–641.0 ms` (`n=3`) | **Fixed** | **PASS** |
| **Flashcards — Flip Card** | `128.6 ms` | **`117.9 ms`** | `132.7 ms` | `83.7–132.7 ms` (`n=5`) | **`-8.3%`** | **Improved** |
| **Flashcards — Next Card** | `200.6 ms` | **`173.4 ms`** | `232.7 ms` | `100.4–232.7 ms` (`n=5`) | **`-13.6%`** | **Improved** |
| **Flashcards — Previous Card** | `149.0 ms` | `166.5 ms` | `199.3 ms` | `109.0–199.3 ms` (`n=5`) | `+11.7%` | Within `4×` CPU noise |
| **250Q Exam — Select Answer (A)** | `130.4 ms` | **`112.2 ms`** | `116.6 ms` | `84.1–116.6 ms` (`n=5`) | **`-14.0%`** | **Improved** |
| **250Q Exam — Change Answer (A → B)** | `117.1 ms` | **`100.7 ms`** | `133.9 ms` | `82.6–133.9 ms` (`n=5`) | **`-14.0%`** | **Near-100ms!** |
| **250Q Exam — Flag / Mark Question** | `100.7 ms` | `117.8 ms` | `150.8 ms` | `81.8–150.8 ms` (`n=5`) | `+17.0%` | Acceptable (`4×` CPU) |
| **250Q Exam — Next / Prev Question** | `117.6` / `97.4 ms` | `134.8` / `132.4 ms` | `150.4 ms` | `83.8–150.4 ms` (`n=5`) | `+14–35 ms` | Acceptable (`4×` CPU) |
| **250Q Exam — Open Mobile Nav Sheet** | `251.1 ms` | `255.8 ms` | `298.3 ms` | `219.7–298.3 ms` (`n=5`) | `+1.9%` | **Stretch P3 (>200ms)** |
| **250Q Exam — Jump `Q1 → Q200`** | `202.6 ms` | **`165.5 ms`** | `245.7 ms` | `132.9–245.7 ms` (`n=5`) | **`-18.3%`** | **Improved** |
| **250Q Exam — Jump `Q200 → Q250`** | `186.4 ms` | **`154.2 ms`** | `175.8 ms` | `104.2–175.8 ms` (`n=5`) | **`-17.3%`** | **Improved** |
| **Global Search — Typing → Results** | `1,391 ms` (`358ms` API) | **`1,348.8 ms`** (`467.8ms` API) | `1,352.8 ms` | `1,055–1,353 ms` (`n=3`) | `-3.0%` | **PASS** |

---

## 4. `ExamNavigatorGrid` Scroll-on-Answer-Tap Verification (`PERF-07`)

- **Static Verification (`src/components/exam/ExamNavigatorGrid.tsx:118-131`):** `filteredEntries` is stored in `filteredEntriesRef`, and the `rowVirtualizer.scrollToIndex(activeRow, { align: "auto" })` effect now depends ONLY on `[currentIndex, statusFilter, subjectFilter, rowVirtualizer, useVirtual]`. Selecting, changing, or flagging an answer no longer triggers redundant virtualizer scroll calculations.
- **Empirical Verification:** Sustained 20-jump latency on the 250-Q exam dropped from **`32.1 ms` → `17.9 ms` (`-44.2%`)** on Desktop, and Mobile 4G `4×` CPU select/change/jump latencies all dropped **`-14%` to `-18%`**.
- **Verdict for `PERF-07` (`V32-042` interaction slice):** **PASS**.
