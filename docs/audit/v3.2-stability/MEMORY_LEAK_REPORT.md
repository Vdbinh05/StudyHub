# StudyHub V3.2 — Sustained-Use Memory, Listener & Leak Report (`MEMORY_LEAK_REPORT.md`)

> **Owner:** `perf-auditor` (Agent 8 — Independent Performance Auditor)  
> **Scope:** Wave 1 Baseline sustained-use memory profiling against a fresh local production build (`npm run build && npx next start -p 3032`, cleanly torn down) + static leak-vector audit across all `350` TypeScript/TSX files in `src/`.  
> **Wave 5 Section:** Reserved at the bottom of this report for apples-to-apples post-fix re-verification after V3.2 Waves 2–4 optimizations land.

---

## 1. Wave 1 Baseline Executive Verdict

| Metric / Leak Signal | Measured Baseline (`39952bd`, `:3032`) | Verdict | Assessment |
| --- | --- | :---: | --- |
| **Workload Simulated** | **`240` question transitions** (`100` Practice + `120` 250Q Exam + `20` Flashcards) + **`20` dialog open/close cycles** + **`16` SPA mode switches** in one continuous tab | **Complete** | Real production build + live Supabase session; zero page errors |
| **Progressive Interaction Slowdown** | Practice Q1–20 vs Q81–100: **`99.6 → 99.7 ms` (`1.00×`)**<br>Exam 250Q Step 1–20 vs 81–100: **`83.5 → 83.5 ms` (`1.00×`)**<br>Exam 20 rapid jumps (`Q1↔Q250`): **`32.1 ms` med** (`19.5 ms` last 5) | **PASS** | **Zero progressive slowdown** over 240 sustained transitions |
| **Retained JS Heap Growth (Post-GC)** | `T0` Dashboard `6.45 MB` → `T7` Loop 1 `9.41 MB` (`+2.96 MB`) → `T8` Loop 2 **`9.48 MB` (`+0.07 MB` delta!)** | **BOUNDED PLATEAU** | Initial `+2.96 MB` is React Query (`gcTime: 5m`) + loaded route chunks; Loop 2 plateau (`+0.07 MB`, `0` nodes, `0` listeners) proves **no unbounded SPA memory leak** |
| **Peak Post-GC Heap & DOM Spike** | Peak heap: **`10.94 MB`** (`T3_practice_Q100`)<br>Peak DOM: **`3,779` CDP nodes (`2,529` live, `1,250` detached gap)** on `/sets/[id]` (`T1`) | **WARN (`MEM-01`)** | `/sets/[id]` 50 unvirtualized cards create a massive `7.6×` DOM explosion (`494 → 3,779` nodes) and `+524` listeners on entry |
| **Active Timers (`setInterval`)** | `T0`: `1` → Exam: `1` → `T7`/`T8` Dashboard: **`0`** | **PASS** | `ExamTimer` and `MatchClient` intervals tear down cleanly |
| **Window / Document Listeners** | `window` net delta: `24 → 20`; `document` net delta: `148 → 124`; `JSEventListeners` Loop 1 vs Loop 2: **`602 → 602` (`+0`)** | **PASS (Runtime)** | Static audit flagged 1 minor SW registration listener pattern (`MEM-03`) |
| **Blob / Object URLs (`URL.createObjectURL`)** | `activeBlobUrls`: **`0`** across all snapshots | **PASS (Runtime)** | Static audit flagged minor `setTimeout` revoke safety & offline bundle discipline (`MEM-04`) |
| **`localStorage` Accumulation** | `1.22 KB` → **`28.92 KB`** during 250Q Exam (`studyhub-exam-draft-v2-*`), **persists indefinitely** if exam abandoned without submit | **WARN (`MEM-02`)** | No TTL/cap pruning on abandoned `studyhub-exam-draft-v2-*` or `studyhub-v3-checkpoint:*` keys; also overlaps with logout cleanup (`SEC-02`) |

---

## 2. Wave 1 Sustained-Use Profiling Protocol

- **Build & Runtime:** `npm run build` (Next.js `16.4.6` Turbopack, commit `39952bd`) served via `npx next start -p 3032 -H 127.0.0.1`, cleanly terminated via process-tree teardown (`PORT_3032_CLEAN_CLOSED` verified).
- **Browser & CDP Instrumentation:** Playwright `1.65.1` / Chromium `159.0.8154.6` (`1440×900`, single continuous tab). Before every snapshot, V8 Garbage Collection was forced twice (`HeapProfiler.collectGarbage` × 2 with 150 ms yields) to separate true **retained post-GC heap** from transient allocation noise. An init script wrapped `URL.createObjectURL`/`revokeObjectURL`, `setInterval`/`clearInterval`, `setTimeout`/`clearTimeout`, and `window`/`document` `addEventListener`/`removeEventListener`.
- **Test Data Hygiene:** Isolated `v32-perf-mem-*` disposable user + synthetic 250-question Study Set + 250-question live Exam Attempt, 100% deleted after run (`perfPrefixLeftovers: 0`).
- **Raw Data:** [`baseline-measurements-raw.json`](baseline-measurements-raw.json) (`memoryLeakBaseline` section).

---

## 3. Complete Post-GC Snapshot Trajectory (`T0` → `T8`)

| Snapshot | Route | Pre-GC Heap | **Post-GC Heap** | CDP Nodes | Live DOM | Detached Gap | `JSEventListeners` | `setInterval` | `setTimeout` | Blobs | `localStorage` |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `T0_dashboard_start` | `/dashboard` | `8.06 MB` | **`6.45 MB`** | `494` | `398` | `96` | `443` | `1` | `6` | `0` | `1.22 KB` |
| `T1_sethub_loaded` | `/sets/[id]` | `12.48 MB` | **`8.80 MB`** | **`3,779`** ⚠️ | **`2,529`** ⚠️ | **`1,250`** ⚠️ | **`967`** ⚠️ | `1` | `14` | `0` | `1.22 KB` |
| `T2_practice_Q1` | `/sets/[id]/practice` | `11.05 MB` | `8.57 MB` | `507` | `372` | `135` | `665` | `1` | `11` | `0` | `1.22 KB` |
| `T3_practice_Q25` | `/sets/[id]/practice` | `13.22 MB` | `10.19 MB` | `703` | `462` | `241` | `685` | `1` | `11` | `0` | `1.22 KB` |
| `T3_practice_Q50` | `/sets/[id]/practice` | `14.81 MB` | `10.19 MB` | `755` | `601` | `154` | `685` | `1` | `11` | `0` | `1.22 KB` |
| `T3_practice_Q75` | `/sets/[id]/practice` | `18.68 MB` | `10.52 MB` | `825` | `661` | `164` | `695` | `1` | `11` | `0` | `1.22 KB` |
| `T3_practice_Q100` | `/sets/[id]/practice` | `18.39 MB` | **`10.94 MB`** | `889` | `705` | `184` | `695` | `1` | `11` | `0` | `1.22 KB` |
| `T4_exam250Q_Q1` | `/exams/[id]` | `16.76 MB` | `5.91 MB` | `528` | `374` | `154` | `455` | `1` | `2` | `0` | `1.22 KB` |
| `T5_exam250Q_Q40` | `/exams/[id]` | `12.09 MB` | `7.30 MB` | `643` | `476` | `167` | `465` | `1` | `3` | `0` | `12.32 KB` |
| `T5_exam250Q_Q80` | `/exams/[id]` | `15.46 MB` | `7.63 MB` | `747` | `560` | `187` | `485` | `1` | `2` | `0` | `23.38 KB` |
| `T5_exam250Q_Q100` | `/exams/[id]` | `13.13 MB` | `7.70 MB` | `767` | `572` | `195` | `485` | `1` | `3` | `0` | `28.92 KB` |
| `T6_exam250Q_after_120_steps` | `/exams/[id]` | `11.57 MB` | `7.72 MB` | `690` | `506` | `184` | **`455`** | `1` | `2` | `0` | `28.92 KB` |
| `T7_after_mode_loop_1` | `/dashboard` | `9.99 MB` | **`9.41 MB`** | `551` | `438` | `113` | `602` | `0` | `12` | `0` | `28.92 KB` |
| `T8_after_mode_loop_2` | `/dashboard` | `14.65 MB` | **`9.48 MB`** | **`551`** | **`438`** | **`113`** | **`602`** | **`0`** | **`12`** | **`0`** | `28.92 KB` |

### Key Analytical Observations
1. **Loop 1 vs Loop 2 Stability (`T7` vs `T8`):** Running a complete second 8-route SPA loop (`Set Hub → Flashcards [10 flips/cards] → Set Hub → Learn → Set Hub → Practice → Set Hub → Library → Dashboard`) produced **`+0.07 MB` retained heap**, **`0` extra CDP nodes**, **`0` extra detached nodes**, **`0` extra event listeners**, and **`0` extra timers**. The `+2.96 MB` delta from `T0 → T7` (`6.45 → 9.41 MB`) is **expected bounded cache retention** (React Query `gcTime: 5 min` holding the 250-question `study-set-bundle` + Next.js App Router client chunks + Dashboard's newly populated "Continue Learning" card adding 40 live DOM nodes and 159 delegated/button listeners).
2. **Practice `Q1 → Q100` Heap & Live DOM Growth (`T2 → T3_Q100`):** Post-GC heap grew `+2.37 MB` (`8.57 → 10.94 MB`) and `liveElements` grew `+333` (`372 → 705`) because (a) `T2` was snapped pre-answer while `T3` snapshots had the active feedback card + explanation + `QuestionNotesAndReportBar` mounted, (b) `PracticeClient` `answers` state accumulates 100 entries, and (c) the visible desktop `ExamNavigatorGrid` window progressively rendered `<CheckCircle2>`/`<XCircle>` SVG child nodes on all visible answered tiles. Importantly, leaving Practice released both DOM nodes and listeners cleanly!
3. **250Q Exam Virtualization Verified (`T4 → T6`):** `LiveExamRunner` grew only `+1.81 MB` across 100 answers + 10 shortcuts dialogs + 20 rapid jumps (`5.91 → 7.72 MB`). When jumping from Q100 (answered tile window) to Q250/Q1, `JSEventListeners` returned to the **exact starting count (`455 → 455`)** — zero listener leakage!
4. **Console 404 Observation:** Two benign `404` console resource errors occurred during the local session (zero uncaught `pageerror`s).

---

## 4. Progressive Interaction Latency (Slowdown Detection)

| Sustained Workload | First 20 Steps (Median) | Mid 20 Steps (Median) | Last 20 Steps (Median) | Slowdown Ratio | Verdict |
| --- | ---: | ---: | ---: | ---: | :---: |
| **Practice 100Q** (select answer + feedback + next, incl. 10 dialog cycles) | `99.6 ms` (avg `124.4 ms`) | `91.8 ms` | **`99.7 ms`** (avg `123.4 ms`) | **`1.00×`** | **PASS** |
| **Live 250Q Exam** (100 sequential answer/change + next, incl. 10 dialogs) | `83.5 ms` | `83.8 ms` | **`83.5 ms`** | **`1.00×`** | **PASS** |
| **Live 250Q Exam — 20 Rapid Jumps (`Q1↔Q200↔Q250`)** | `32.6 ms` (first 5) | `32.1 ms` (all 20) | **`19.5 ms`** (last 5) | **`0.60×`** | **PASS** |

---

## 5. Static Leak-Vector Audit & Tracked Findings (`MEM-01` .. `MEM-05`)

Scanned all `350` TypeScript/TSX files in `src/` for `setInterval`, `addEventListener`/`removeEventListener` balance, `URL.createObjectURL`/`revokeObjectURL`, `MutationObserver`/`ResizeObserver`/`IntersectionObserver`, `speechSynthesis`, and persistent storage growth:

| ID | Severity | Area / File | Finding & Concrete Risk | Recommended V3.2 Remediation |
| --- | :---: | --- | --- | --- |
| **`MEM-01`** | **P1** | `src/components/library/study-set-hub.tsx` | Rendering `50` unvirtualized rich question cards on `/sets/[id]` spikes DOM **`7.6×`** (`494 → 3,779` CDP nodes, `1,250` detached-gap, `967` listeners, and **`19.8–21.1 MB` heap** on live prod). On low-RAM mobile devices, repeated navigation to large sets causes avoidable GC pauses and `433–556 ms` TBT. | Virtualize the Set Hub question bank list with `@tanstack/react-virtual` (already bundled on other routes) or reduce default preview page size (`20–25`) + `content-visibility: auto`. |
| **`MEM-02`** | **P2** | `src/components/exam/LiveExamRunner.tsx:93,503` & `src/lib/learning/checkpoints.ts` | Each in-progress 250-Q exam writes `~28–70 KB` to `localStorage` under `studyhub-exam-draft-v2-${attemptId}`. If a student starts and abandons multiple 250-Q exams (or switches accounts without explicit logout — see `SEC-02`), stale drafts accumulate indefinitely toward the ~5 MB `localStorage` quota and never expire! | Add a bounded TTL/LRU eviction pass (e.g., purge `studyhub-exam-draft-v2-*` older than 7 days or cap at 5 newest attempts) and purge all user-scoped draft/checkpoint keys on sign-out / account switch. |
| **`MEM-03`** | **P2** | `src/components/pwa/PwaProvider.tsx:375-386` | `registration.addEventListener("updatefound", ...)` and `installing.addEventListener("statechange", ...)` are registered inside the Service Worker effect without storing cleanup references; if `PwaProvider` remounts or updates fire repeatedly over a multi-day PWA session, old closures calling `setWaitingWorker` remain attached to the persistent `ServiceWorkerRegistration` singleton. | Store named handlers and remove `updatefound` / `statechange` listeners in the `useEffect` cleanup (guarding with `if (!cancelled)` inside both callbacks). |
| **`MEM-04`** | **P3** | `src/components/editor/PdfExportDialog.tsx`, `src/components/exam/ExamResultsClient.tsx`, `src/components/layout/settings-view.tsx`, `src/lib/offline/offline-session.ts` | Download handlers schedule `URL.revokeObjectURL` via fire-and-forget `setTimeout` without clearing on unmount (low risk since the timeout still fires once and revokes). In `offline-session.ts`, `loadOfflineStudyBundle()` caches created blob URLs in `createdUrls` and relies strictly on callers invoking `bundle.revokeAllMediaUrls()` on unmount — verified clean in current callers, but fragile if a new offline consumer forgets cleanup. | Keep `revokeAllMediaUrls()` enforced in `OfflineStudyRunner` cleanup effect and add a unit/regression assertion verifying `activeBlobUrls === 0` after unmount & download flows. |
| **`MEM-05`** | **P3** | `src/lib/audio/tts.ts:228-245` | In browsers without `speechSynthesis.addEventListener` (legacy fallback branch lines 235–244), `subscribeVoices` chains `previous = synth.onvoiceschanged` closures; out-of-order unsubscribes could restore a stale closure chain. Modern Chromium/WebKit/Firefox take the `addEventListener`/`removeEventListener` branch (`lines 228–233`), which cleans up properly. | Maintain a single internal `Set<() => void>` listener registry on the module/controller rather than chaining `onvoiceschanged` closures. |

---

## 6. Wave 5 Post-Fix Re-Verification (Pending Waves 2–4)

*To be appended in Wave 5 by `perf-auditor` after V3.2 fixes land, running the identical 240-transition + 20-dialog + 16-mode-switch local production build harness to compare Before vs After heap, DOM nodes (especially `T1_sethub_loaded`), `localStorage` pruning, and listener counts.*
