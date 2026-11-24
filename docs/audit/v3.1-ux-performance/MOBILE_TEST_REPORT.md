# StudyHub V3.1 — Independent Mobile Usability, Throttled 4G & Full E2E Regression Report (Wave 5)

> **Auditor:** Agent 4 — Independent Mobile & Functional E2E Tester (`func-tester`)
> **Target Environment:** **`https://studyhub-three-mauve.vercel.app`** (Vercel Hobby, verified **`hnd1` Tokyo** via `X-Vercel-Id: hkg1::hnd1::...`, Node.js `24.x`, commit `3406444`, deployment `dpl_6N85jVRkZZjf5yNM2sMnH5ru6Noj`)
> **Backend:** Supabase Cloud (`cuoaifyupfmkstqhcjwy`, `ap-northeast-1` Tokyo, PG `17.12`, Migrations `0001`–`0018`, `37/37` RLS tables)
> **Audit Date:** 2026-11-25
> **Localhost Substitution:** **NONE** — 100% of Wave 5 verification executed directly against live HTTPS production `https://studyhub-three-mauve.vercel.app`.

> [!NOTE]
> **Testing Environment Honesty:** All mobile and tablet checks below were executed using **Playwright Chromium mobile/tablet device emulation** (`hasTouch: true`, `isMobile: true` on phone viewports) combined with **Chrome DevTools Protocol (CDP) Mobile 4G network throttling** (`4 Mbps` down / `1.5 Mbps` up / `100 ms` RTT) and **`4×` CPU slowdown** (`Emulation.setCPUThrottlingRate: 4`) against the real deployed HTTPS production site — not physical iOS Safari / Android Chrome hardware devices. Physical-device quirks (iOS Safari rubber-banding, safe-area hardware notches, virtual keyboard viewport resizing) are mitigated via CSS `dvh` and `env(safe-area-inset-bottom)` rules verified in DOM styles, and recommended for quick spot-checks on a physical phone.

---

## 1. Executive Verdict

**VERDICT: `PASS` — 0 P0 / 0 P1 / 0 P2 Mobile or Functional Regressions on V3.1 Live Tokyo Production.**

| Verification Pillar | Scope & Target | Measured Result | Verdict |
| --- | --- | --- | --- |
| **Complete Live Playwright E2E Suite** | All `22` E2E browser tests (`authenticated-journey` `3` + `studyhub` `13` + `v3-complete-learning` `6`) on `https://studyhub-three-mauve.vercel.app` (`PLAYWRIGHT_EXPECT_PROD=1`) | **`22 / 22 PASS`** in **`4.0m`** (down from **`7.9m`** in V3.0 `iad1` — **`-49.4%` faster**; `0` skipped, `0` failed) | **PASS** |
| **5-Width Responsive Matrix** | `360px`, `390px`, `412px`, `430px`, `768px` × `11` key public, shell & focus routes (`55` combinations) | **`55 / 55 PASS`** — `0px` horizontal overflow, `0px` header control overlap, `64px` 4-tab bottom bar (`Trang chủ / Thư viện / Thi thử / Cá nhân`), `104px`/`96px` `<main>` clearance, bottom bar hidden on focus routes | **PASS** |
| **Touch Target Accessibility** | Primary buttons, bottom nav tabs, practice/exam answer cards, mobile exam header `Nộp bài` | All 4 bottom tabs = **`64px` height** (`>= 44px`), exam `Nộp bài` = **`82×44px`** (`90×44px` at `768px`), all choice cards `>= 44px` | **PASS** |
| **Throttled Mobile 4G + `4×` CPU Interaction (`390×844`)** | Practice Direct-Start + `250Q` mobile exam answer taps, question navigation, Quick Jump `#200`, `F5` reload recovery, submit | Practice tap **`33.5 ms`** (`< 100 ms`); 250Q exam tap median **`17.2 ms`** (max `24.6 ms`, `< 100 ms`); next-Q nav median **`25.4 ms`**; Quick Jump `#200` **`190 ms`**; F5 reload survived (`6/250`, **`1,533 ms`**); results **`0px` overflow** | **PASS** |
| **Mobile HTTPS Offline PWA (`390×844`)** | Manifest, active SW controller, offline download, `setOffline(true)` study + offline F5 reload, reconnect sync idempotency | `/manifest.webmanifest` `200`, `/sw.js` `200` (`no-store`), SW active, offline F5 survived (`0px` overflow), sync **`applied` → `duplicate_ignored`** | **PASS** |
| **Uncaught Errors & Teardown** | Page errors, disposable test user/blob cleanup | **`0` uncaught page errors**, **`TRACKED_REMAINING users=0 study_media=0 study_temp=0`** (real user data untouched) | **PASS** |

---

## 2. Live Production Playwright E2E Regression (`V3.0 iad1` vs `V3.1 hnd1` Tokyo)

Executed sequentially (`--workers=1`) directly against `https://studyhub-three-mauve.vercel.app` (`X-Vercel-Id: hkg1::hnd1::dd55t-...`, `EXIT_PLAYWRIGHT=0`, `CLEANUP_USERS_DELETED=2/2`, `CLEANUP_STORAGE_REMOVED media=7 temp=0`, `TRACKED_REMAINING users=0 study_media=0 study_temp=0`).

| Suite / Test | V3.0 `iad1` Prod Duration | V3.1 `hnd1` Prod Duration | Speedup | Status |
| --- | ---: | ---: | ---: | --- |
| `authenticated-journey.spec.ts` — **Scenario 1** (Folder/Set CRUD, 3-step 50-Q import, 5 modes, timed exam anti-leak + F5, Settings, Share & 2-account RLS) | `120.0s` (`2.0m`) | **`66.0s` (`1.1m`)** | **`-45.0%`** | **PASS** |
| `authenticated-journey.spec.ts` — **Scenario 2** (3-step `/exams/new` Multi-Subject Builder, Strategies, Presets, F5 & Mixed-Subject Results) | `72.0s` (`1.2m`) | **`21.4s`** | **`-70.3%`** | **PASS** |
| `authenticated-journey.spec.ts` — **Scenario 3** (Full Coverage Cycle `10Q -> 5 + 5`, ZERO overlap, `100%` completion) | `40.9s` | **`15.3s`** | **`-62.6%`** | **PASS** |
| `studyhub.spec.ts` — **Tests 4–16** (`13` tests: CSP/HSTS headers, `/api/health`, public/auth pages, 404 `LandingThemeMenu`, Light/Dark & VI/EN `<title>` reload persistence, protected redirects, reduced-motion, `6` viewports `360px`–`1920px`) | `48.2s` | **`45.1s`** | `-6.4%` | **13 / 13 PASS** |
| `v3-complete-learning.spec.ts` — **`V3-T1`** (PWA manifest/SW, `/offline`, `?` shortcut modal, Settings Mode Preferences) | `12.5s` | **`7.4s`** | **`-40.8%`** | **PASS** |
| `v3-complete-learning.spec.ts` — **`V3-T2`** (PNG/WAV uploads, Rich Text + KaTeX, Image-only Options, Lightbox, DOCX V3 media, serverless PDF text vs scanned) | `32.7s` | **`9.2s`** | **`-71.9%`** | **PASS** |
| `v3-complete-learning.spec.ts` — **`V3-T3`** (All 12 Question Types live exam scoring + Confidence Neutrality, Bulk Edit, `Ctrl+K` Hard Exam Guard, 2-account Notes/Reports, Vietnamese PDF) | `66.0s` (`1.1m`) | **`23.2s`** | **`-64.8%`** | **PASS** |
| `v3-complete-learning.spec.ts` — **`V3-T4`** (Spell Mode, Audio Flashcards, Advanced Learn, Review Mistakes, Resume Checkpoint across F5, Scoped Reset preserving Exam History) | `41.7s` | **`16.8s`** | **`-59.7%`** | **PASS** |
| `v3-complete-learning.spec.ts` — **`V3-T5`** (Visual Diagram Mode desktop & mobile `390px` + 2-Account RLS) | `29.2s` | **`13.8s`** | **`-52.7%`** | **PASS** |
| `v3-complete-learning.spec.ts` — **`V3-T6`** (True Offline PWA: Download → `setOffline(true)` → Offline Study → Offline F5 → Reconnect Sync Queue → Same-Browser Account-Switch IDB Isolation) | `30.2s` | **`15.6s`** | **`-48.3%`** | **PASS** |
| **Total 22-Test Full-Stack Live Production Suite** | **`7.9m` (`474s`)** | **`4.0m` (`240s`)** | **`-49.4%` (`2.0×` faster)** | **22 / 22 PASS** |

---

## 3. Five-Width Mobile & Tablet Geometry, Touch Target & Bottom-Bar Matrix

Executed live against `https://studyhub-three-mauve.vercel.app` (`X-Vercel-Id: hkg1::hnd1::6srsl-...`, `task-1230`, exit `0`) across all **11 key routes**:
`/` (Landing), `/login`, `/dashboard`, `/library`, `/sets/[id]` (Study-First Hub), `/sets/[id]/import` (3-Step Import Wizard), `/sets/[id]/practice` (Direct-Start Practice), `/sets/[id]/flashcards` (CSS 3D Flashcards), `/exams/new` (3-Step Exam Builder), `/exams/[attemptId]` (`250Q` Timed Exam Runner), and `/review` (Clean Review Mistakes).

| Viewport | Emulation Profile | Routes Passed | Max Horizontal Overflow | Max Header Control Overlap | 4-Tab Bottom Nav Labels & Heights (`>= 44px`, `0` Clipped) | `<main>` Bottom Clearance | Focus Routes Bottom Nav Hidden | Mobile Exam Header `Nộp bài` Button |
| --- | --- | --- | ---: | ---: | --- | ---: | --- | --- |
| **`360×800`** | `small-mobile-360` (`isMobile`, `hasTouch`) | **11 / 11** | **`0px`** | **`0px`** | `Trang chủ (64px)`, `Thư viện (64px)`, `Thi thử (64px)`, `Cá nhân (64px)` | `104px` (`>= 64px`) | **YES** | Visible (`82×44px`) |
| **`390×844`** | `iphone-14-390` (`isMobile`, `hasTouch`) | **11 / 11** | **`0px`** | **`0px`** | `Trang chủ (64px)`, `Thư viện (64px)`, `Thi thử (64px)`, `Cá nhân (64px)` | `104px` (`>= 64px`) | **YES** | Visible (`82×44px`) |
| **`412×915`** | `pixel-412` (`isMobile`, `hasTouch`) | **11 / 11** | **`0px`** | **`0px`** | `Trang chủ (64px)`, `Thư viện (64px)`, `Thi thử (64px)`, `Cá nhân (64px)` | `104px` (`>= 64px`) | **YES** | Visible (`82×44px`) |
| **`430×932`** | `iphone-pro-max-430` (`isMobile`, `hasTouch`) | **11 / 11** | **`0px`** | **`0px`** | `Trang chủ (64px)`, `Thư viện (64px)`, `Thi thử (64px)`, `Cá nhân (64px)` | `104px` (`>= 64px`) | **YES** | Visible (`82×44px`) |
| **`768×1024`** | `tablet-768` (`hasTouch`) | **11 / 11** | **`0px`** | **`0px`** | `Trang chủ (64px)`, `Thư viện (64px)`, `Thi thử (64px)`, `Cá nhân (64px)` | `96px` (`>= 64px`) | **YES** | Visible (`90×44px`) |

**Key V3.1 Mobile Fixes Confirmed Live Across All 5 Widths:**
- **Import Wizard (`UX31-04`):** Previous `+91px` horizontal overflow at `360px`/`390px` is completely eliminated (`0px` overflow across all 5 widths with compact `Bước X / 3` mobile header).
- **4-Tab Mobile Bottom Navigation (`UX31-02`):** Crisp Vietnamese diacritics with zero label clipping at `360px`, full `64px` touch height, `104px` bottom clearance on shell routes, and strictly hidden on focus routes (`/exams/[id]`, `/sets/[id]/practice`, `/sets/[id]/flashcards`) so zero exam/study controls are ever obscured.
- **Exam Header Always-Visible `Nộp bài` (`UX31-10`):** Immediately accessible in the sticky mobile exam header (`82×44px` on `360–430px`, `90×44px` on `768px`) with `0px` overlap against the timer or exit button.

---

## 4. Throttled Mobile 4G + `4×` CPU Interaction & 250-Question Exam Stress Test (`390×844`)

Executed under CDP **`Network.emulateNetworkConditions`** (`4 Mbps` down / `1.5 Mbps` up / `100 ms` latency) + **`Emulation.setCPUThrottlingRate: 4`** on `390×844` (`hasTouch: true, isMobile: true`) against `https://studyhub-three-mauve.vercel.app` (`task-1230`).

| Check | Target / Budget | Measured Live Result (Mobile 4G + `4×` CPU) | Status |
| --- | --- | --- | --- |
| **Practice Direct-Start Load (`/sets/[id]/practice`)** | Auto-start Q1 immediately (zero mandatory 14-control setup gate) | **`2,727 ms`** directly to interactive Q1 `[role="radio"]` | **PASS** |
| **Practice Optimistic Answer Tap** | **`< 100 ms`** local DOM feedback (independent of 100ms+ 4G RTT) | **`33.5 ms`** (`3.0×` faster than 100ms target!) | **PASS** |
| **250Q Mobile Exam Load (`/exams/[attemptId]`)** | Fast interactive first question on 250-question bank | **`1,557 ms`** | **PASS** |
| **250Q Mobile Exam Optimistic Answer Taps (Q1–Q5)** | **`< 100 ms`** DOM `aria-checked="true"` response | **`[24.6, 17.2, 17.5, 15.5, 14.1] ms`** — **median `17.2 ms`**, **max `24.6 ms`** (`5.8×` faster than 100ms target!) | **PASS** |
| **250Q Mobile Exam Next-Question Navigation (4 transitions)** | Smooth sub-100ms client question switch | **`[25.4, 25.8, 20.6, 24.1] ms`** — **median `25.4 ms`** | **PASS** |
| **250Q Mobile Navigator Sheet Quick Jump (`#200`)** | Open sticky bottom `5/250` sheet → `inputmode="numeric"` jump to Q200 | **`190 ms`** (instant jump into virtualized 250Q bank + answer Q200 + live `PUT /answers` `200`) | **PASS** |
| **250Q Mobile Exam `F5` Reload Recovery (Throttled 4G)** | Full reload mid-exam preserves answered count (`6/250`), checked option & countdown timer | **`1,533 ms`** reload; **`6/250`**, Q1 `aria-checked="true"`, and timer all survived cleanly | **PASS** |
| **Mobile Header `Nộp bài` Submit → Results Page** | Always-visible header submit → confirm dialog → `/exams/[id]/results` | Submitted cleanly; `/exams/[id]/results` rendered with **`0px` horizontal overflow** | **PASS** |

---

## 5. Mobile HTTPS Offline PWA & Sync Idempotency (`390×844`)

Executed live on `https://studyhub-three-mauve.vercel.app` (`390×844`, `task-1230`):

- **Manifest & Service Worker Headers:** `GET /manifest.webmanifest` = **`200`**, `GET /sw.js` = **`200`** with `Cache-Control: no-cache, no-store, must-revalidate`.
- **Active HTTPS Service Worker Controller:** Deferred idle registration (`window.load` + `requestIdleCallback`) activated and claimed page cleanly (`navigator.serviceWorker.controller` = **`true`**).
- **Offline Download & Study + Offline `F5` Reload:** Downloaded `Mobile Study Set 10Q` via `data-testid="offline-download-trigger"`, switched to true offline mode (`context.setOffline(true)`), opened `offline-study-runner`, answered Q1 offline, and executed a real **`page.reload()` (`F5`) while offline** — `/offline` recovered cleanly with the downloaded set intact and **`0px` horizontal overflow**.
- **Reconnect Sync Idempotency (`POST /api/sync/events`):** After `context.setOffline(false)`, submitted an offline answer event (`event_id`) → first delivery returned **`applied`**, exact replay returned **`duplicate_ignored`** (`0` duplicate writes).

---

## 6. Clean Teardown & Live Data Safety Certification

- **Pre-existing Real User Data:** **100% Untouched** (zero DB resets, zero blanket deletes).
- **Disposable Accounts Provisioned & Deleted:**
  - `task-1191` (22-test E2E suite): `v31-after-mob-e2e-a/b-*@studyhub-test.local` → `CLEANUP_USERS_DELETED=2/2`, `CLEANUP_STORAGE_REMOVED media=7 temp=0`, **`TRACKED_REMAINING users=0 study_media=0 study_temp=0`**.
  - `task-1206`, `task-1222`, `task-1230` (5-width mobile + 4G 250Q + PWA): `v31-after-mob-*@studyhub-test.local` → `CLEANUP_USERS_DELETED=1/1` on every run, **`TRACKED_REMAINING users=0 study_media=0 study_temp=0`**.
- **Workspace Purity:** Zero edits by `func-tester` to `src/*`, `supabase/*`, `public/*`, `next.config.ts`, `package.json`, or `vercel.json`.
