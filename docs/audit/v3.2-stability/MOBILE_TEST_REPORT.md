# StudyHub V3.2 — Wave 6 Mobile & Responsive Verification Report (`MOBILE_TEST_REPORT.md`)

> **Auditor:** Agent 6 — Independent Functional Tester (`func-tester-2`, zero edits to `src/*` or `supabase/*`)  
> **Target:** Compiled local production server (`http://127.0.0.1:3051`, reusing fresh Wave 6 `.next` build on branch `release/v3.2-stability`) connected to live Supabase Cloud  
> **Test Scope:** **17 routes** (4 public + 13 authenticated) × **7 mobile/tablet widths** (`320, 360, 375, 390, 412, 430, 768px`) = **119 live Chromium viewport checks**, plus `1440×900` desktop parity & Wave 6 `V32-035` (`RU-12`) Mobile Practice top bar geometry verification.

---

## 1. Browser Engine Disclosure (Honest Scope)

- **Chromium (Live Executed):** `@playwright/test` Chromium (`chromium-1248`/`1255`, `hasTouch: true`, `isMobile: true` for authenticated sweep) executed live across all 7 widths (`320, 360, 375, 390, 412, 430, 768px`) + desktop (`1440×900`).
- **WebKit / Safari (Honest Disclosure):** WebKit is **not installed** in `%LOCALAPPDATA%\ms-playwright` (verified directory listing contains `chromium-*`, `chromium_headless_shell-*`, `ffmpeg`, `winldd` only; per independent QA rules, no browser runtimes were installed). Safari/WebKit compatibility was audited statically on the Wave 6 codebase:
  - `src/lib/media/validation.ts:710-782` (`optimizeImageForUpload`): Fixed `V32-040` (`FUNC-29(4)`) — outputs universally Safari- & PDF-compatible `image/jpeg` (opaque photos) / `image/png` (transparent/diagrams) and resolves MIME + file extension from actual `blob.type` & magic bytes rather than hardcoding `.webp`.
  - Verified `webkitAudioContext` fallback (`src/lib/preferences/index.tsx:331-333`), `dvh` / `env(safe-area-inset-bottom)` safe-area handling, and Pointer Events + `touch-action: none` on 2D diagram/lightbox controls.

---

## 2. Executive Verdict

| Issue ID | Scope | Wave 6 Verdict | Key Measurement |
| :--- | :--- | :---: | :--- |
| **`V32-034`** (`FUNC-24`, `RU-20`) | 7-width overflow & mobile touch targets | **PASS** | **`0px`** overflow across **119/119** checks; **`0`** hydration errors; **`0`** `pageerror`; **`0`** buttons/tabs/switches/checkboxes `<40px` at `360px` & `390px` |
| **`V32-035`** (`RU-12`) | Mobile Focus Header & Practice top bar (`320/360/390px`) | **PASS** | `0px` right-edge clipping on `0/4` at `320/360/390px`, `finishHeight: 44px`, strictly single-line counter (`h: 15px`), truncated `h1` sub-row readable *(see P3 3-digit counter note below)* |

---

## 3. Seven-Width Horizontal Overflow Matrix (`scrollWidth - innerWidth`, px)

All **17 routes × 7 widths (`119 / 119`)** measured **`0px`** horizontal overflow with **`0`** React hydration warnings and **`0`** uncaught `pageerror` exceptions:

| Route | `320px` | `360px` | `375px` | `390px` | `412px` | `430px` | `768px` | Status |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `/` (Landing) | `0px` | `0px` | `0px` | `0px` | `0px` | `0px` | `0px` | **PASS** |
| `/login` | `0px` | `0px` | `0px` | `0px` | `0px` | `0px` | `0px` | **PASS** |
| `/register` | `0px` | `0px` | `0px` | `0px` | `0px` | `0px` | `0px` | **PASS** |
| `/forgot-password` | `0px` | `0px` | `0px` | `0px` | `0px` | `0px` | `0px` | **PASS** |
| `/dashboard` | `0px` | `0px` | `0px` | `0px` | `0px` | `0px` | `0px` | **PASS** |
| `/library` | `0px` | `0px` | `0px` | `0px` | `0px` | `0px` | `0px` | **PASS** |
| `/sets/[id]` | `0px` | `0px` | `0px` | `0px` | `0px` | `0px` | `0px` | **PASS** |
| `/sets/[id]/edit` | `0px` | `0px` | `0px` | `0px` | `0px` | `0px` | `0px` | **PASS** |
| `/sets/[id]/practice` | `0px` | `0px` | `0px` | `0px` | `0px` | `0px` | `0px` | **PASS** |
| `/sets/[id]/learn` | `0px` | `0px` | `0px` | `0px` | `0px` | `0px` | `0px` | **PASS** |
| `/sets/[id]/flashcards` | `0px` | `0px` | `0px` | `0px` | `0px` | `0px` | `0px` | **PASS** |
| `/exams/new` | `0px` | `0px` | `0px` | `0px` | `0px` | `0px` | `0px` | **PASS** |
| `/exams/[attemptId]` | `0px` | `0px` | `0px` | `0px` | `0px` | `0px` | `0px` | **PASS** |
| `/exams/[attemptId]/results` | `0px` | `0px` | `0px` | `0px` | `0px` | `0px` | `0px` | **PASS** |
| `/review` | `0px` | `0px` | `0px` | `0px` | `0px` | `0px` | `0px` | **PASS** |
| `/settings` | `0px` | `0px` | `0px` | `0px` | `0px` | `0px` | `0px` | **PASS** |
| `/offline` | `0px` | `0px` | `0px` | `0px` | `0px` | `0px` | `0px` | **PASS** |

*Plus existing Playwright E2E `studyhub.spec.ts` verified all 6 public responsive viewports (`360, 390, 768, 1024, 1440, 1920px`) -> `6/6 PASS`.*

---

## 4. Mobile Touch Target Before vs After Audit (`360×844` & `390×844`)

Every visible interactive control (`button`, `a[href]`, `[role="tab"]`, `[role="checkbox"]`, `[role="switch"]`) was measured live via `getBoundingClientRect()` at both `360px` and `390px`:

| Authenticated Route | Wave 1 Controls `<40px` (`360px`) | Wave 6 Interactive Controls `<40px` (excl. inline text/breadcrumb `<a>`) | Wave 6 Total Elements `<44px` (incl. `sr-only`/skip link & text `<a>`) | Remaining Non-Blocking Notes (`360px` / `390px`) |
| :--- | :---: | :---: | :---: | :--- |
| `/dashboard` | 9 | **0** buttons/controls | 3 (`<a>` only) | Skip link (`41px`, hidden until focus) + 2 card title text links (`h: 20, 37px`) |
| `/library` | 13 | **0** buttons/controls | 3 (`<a>` only) | Skip link + `"Quản lý thư mục"` text link (`16px`) + folder title link (`36px`) |
| `/sets/[id]` | — | **0** | 1 (skip link only) | All visible buttons & links `>=44px` |
| `/sets/[id]/edit` | **20** | **0** buttons/checkboxes | 3 (`<a>` only) | Skip link + 2 breadcrumb text links (`16px`, `32px`); row Edit/Delete/Checkboxes all `>=44px` |
| `/sets/[id]/practice` | 3 | **0** | 1 (skip link only) | All header & answer buttons `>=44px` |
| `/sets/[id]/learn` | 5 | **0** | 1 (skip link only) | Compact Goal popover & answer controls all `>=44px` |
| `/sets/[id]/flashcards` | — | **0** (`<40px`) | 2 | Skip link + `"Gắn âm thanh / sửa thẻ"` icon link (`40×40px`, non-blocking P3) |
| `/exams/new` | **31** | **0** (`<40px`) | 2 | Skip link + `"Trung tâm Đề thi"` nav link (`139×40px`); all source checkboxes & buttons `>=44px` |
| `/exams/[attemptId]` | — | **0** | 1 (skip link only) | All exam controls `>=44px` |
| `/exams/[attemptId]/results` | 8 | **0** | 1 (skip link only) | All 7 breakdown & filter `TabsTrigger`s now `>=44px` |
| `/review` | 10 | **0** (`<40px`) | 5 | Skip link + 4 quick-action CTA links (`210×40px`, non-blocking P3); all Switches & Tabs `>=44px` |
| `/settings` | **18** | **0** | 1 (skip link only) | All 5 `TabsTrigger`s & all `Switch` controls now `>=44px` |
| `/offline` | 0 | **0** | 1 (skip link only) | All visible controls `>=44px` |

---

## 5. Wave 6 Mobile Practice Top Bar Verification (`V32-035` / `RU-12`)

Measured live on `/sets/[id]/practice` with a long Vietnamese set title (`"W6 Mobile Offline & Network Test Study Set With A Fairly Long Vietnamese Title"`):

| Viewport | `headerRight` | Finish CTA Right Edge | Clipped? | Finish Height | Progress Counter | Single-Line Counter (`h<=36px`)? | Title `<h1>` Width |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **`320×844`** | `320px` | `312px` (`8px` margin) | **No (`false`)** | **`44px`** | `0/4` | **Yes (`15px`)** | `244px` (readable) |
| **`360×844`** | `360px` | `352px` (`8px` margin) | **No (`false`)** | **`44px`** | `0/4` | **Yes (`15px`)** | `284px` (readable) |
| **`390×844`** | `390px` | `382px` (`8px` margin) | **No (`false`)** | **`44px`** | `0/4` | **Yes (`15px`)** | `314px` (readable) |

### Wave 6B `RU-12b` 3-Digit Counter Retest (`120Q` Set, `min-[380px]` Breakpoint)

Independently verified on a 120-question study set (`0/120` 3-digit counter) after Wave 6B polish (`PracticeClient.tsx`):

| Viewport | Visible Finish Label | Finish Box (`left..right`, `w×h`) | Clipped? | Counter | Single-Line? | Doc Overflow | Status |
| :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **`360×800`** | **`Xong`** | `300..352` (`52×44px`, `8px` margin) | **`0px` (No)** | `0/120` | **Yes (`15px`)** | **`0px`** | **PASS** |
| **`390×844`** | **`Hoàn thành`** | `294..382` (`88×44px`, `8px` margin) | **`0px` (No)** | `0/120` | **Yes (`15px`)** | **`0px`** | **PASS** |
