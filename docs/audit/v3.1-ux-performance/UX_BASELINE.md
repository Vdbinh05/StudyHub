# StudyHub V3.1 — Wave 0 Quantitative UX Baseline (`UX_BASELINE.md`)

> **Role:** Independent Real User / UX Researcher (`real-user`)  
> **Target Measured Live:** **`https://studyhub-three-mauve.vercel.app`** (`v3.0-checkpoint` / commit `a3c3330`, Vercel `iad1` ↔ Supabase Cloud `ap-northeast-1`)  
> **Measured At:** `2026-11-24T18:02Z` (Desktop `1440×900`, Mobile `390×844`, Small Mobile `360×800`, Playwright headless Chromium, standard broadband Wi-Fi — **unthrottled**; mobile 4G/CPU throttling metrics are separately profiled in `PERFORMANCE_BASELINE.md`).  
> **Method & Strict Independence:** Zero `src/*` or `supabase/*` inspection or edits. Every task was executed end-to-end in the live browser as a first-time student using disposable `v31-ux-*@studyhub-test.local` accounts. Real user data (`2` accounts, `1` set, `50` questions) was strictly untouched, zero secrets were logged, and zero `sample-data/` aviation question text is reproduced in this report or its screenshots.

---

## 1. Executive Baseline Summary

| Baseline Dimension | Live Production Measurement (`v3.0-checkpoint`) | Student Perception Verdict |
| --- | --- | --- |
| **HTTP 5xx / Page Crashes** | `0` HTTP 5xx, `0` uncaught JS page errors across all 16 tasks | Functionally stable, but **feels painfully slow & cluttered** |
| **Worst Screen Control Overload** | `/exams/new`: **`78` controls (Desktop) / `79` controls (Mobile)** across **`5.13` mobile screenfuls** | Severe enterprise-form overload |
| **Worst Mobile Horizontal Overflow** | `/sets/[id]/import`: **`+91px` horizontal overflow** on `390×844` (steps 5 & 6 clipped offscreen) | Broken mobile stepper ergonomics |
| **Import Word (133q) / Excel (24q)** | **6 wizard steps / 6 clicks**, **`17.96s`** (Word) / **`15.50s`** (Excel) after set creation | Too many mandatory clicks + slow commit |
| **250-Question Exam Generation** | **`9,946 ms`** (~10s wait from clicking Start -> Q1 visible); Q1->Q2 **`60 ms`**, Q2->Q50 **`57 ms`** | Runner itself is snappy; builder & generation feel sluggish |
| **Core Navigation Latency (Unthrottled Wi-Fi)** | Login -> Dashboard **`4,158 ms`**; Library -> Set **`4,647 ms`**; Set -> Flashcards **`5,038 ms`**; Review **`4,342 ms`** | Already 4–5s on Wi-Fi before 4G mobile throttling! |
| **First-Impression Data Flicker** | `/library` flashes **`Của tôi (0)`** + 6 gray boxes; `/sets/[id]` flashes **`Ngân hàng câu hỏi (0)`** under `133 câu hỏi` | Makes app feel slow or broken during hydration |
| **Desktop Sidebar Density** | **`15–17` interactive items** in sidebar (with `Thi thử tùy chỉnh` duplicated twice!) | Overengineered SaaS cockpit instead of clean study app |

---

## 2. All 16 Tasks — Live Quantitative Baseline Table

All click counts exclude OS file-picker internals and measure exact clicks/taps a real student performs inside StudyHub. Wall-clock timings were measured live against `https://studyhub-three-mauve.vercel.app` over unthrottled Wi-Fi (so mobile 4G students experience even higher waits).

| # | Task (§6) | Exact Clicks / Taps | Measured Time (Live HTTPS Wi-Fi) | Friction / Wrong Turns / Forced Gates Observed | Severity |
| --- | --- | --- | --- | --- | --- |
| **1** | **Register** (`/register`) | `6` (CTA + 4 fields + submit) | Landing `2,739 ms`; Submit `3,587 ms` | Optional `Tên người dùng` with regex rules adds cognitive load; Supabase `email_address_invalid` returned verbatim in **untranslated English** inside Vietnamese UI. | **P2** |
| **2** | **Log in** (`/login` -> `/dashboard`) | `3` (email, pass, submit) | **`4,158 ms`** to interactive Dashboard (`6,920 ms` total) | Empty skeleton cards linger for seconds after `"Đăng nhập thành công."` toast; Dashboard opens to 4 duplicate Exam CTAs and KPI boxes instead of user's sets. | **P0** |
| **3** | **Find an existing study set** (`Dashboard -> Library -> Set`) | `2` (`Thư viện` -> Set card) | Dash->Lib nav `69 ms` (but flashes `Của tôi (0)` skeleton!), Lib->Set **`4,647 ms`** (`4,858 ms` total) | On mobile `390px`, `/library` header crushes `Thư viện học phần` into a 12-line skinny vertical column (`before_06_library_mobile_390.png`); `/sets/[id]` flashes `Ngân hàng câu hỏi (0)` while loading 133 questions. | **P0** |
| **4** | **Start Flashcards** (from `/sets/[id]`) | `1` click (after scrolling past 10 buttons on mobile) | **`5,038 ms`** to interactive card; Space flip **`275 ms`** | **5+ seconds** waiting to see Flashcard #1 even on desktop Wi-Fi; Flashcards card looks identical to 7 other monochrome mode cards on `/sets/[id]`. | **P1** |
| **5** | **Start Learn** (from `/sets/[id]`) | `1` click | **`2,411 ms`** to load; first step action **`1,245 ms`** | Exposes 5 internal SM-2 stage buttons (`Làm quen`, `Ghi nhớ`, `Thành thạo`, `Ôn tập`, `Luyện thi`) across the top, making new students unsure if they must click stages manually. | **P2** |
| **6** | **Start Multiple Choice Practice** (from `/sets/[id]`) | **`2`** (Mode card + mandatory `Bắt đầu luyện tập`) | Setup screen **`2,419 ms`**; Q1 render `56 ms`; tap->feedback **`283 ms`** | **Forced 14-control intermediate setup screen** (`Thiết lập phiên luyện tập`, `before_11_practice_setup_mobile_390.png`) blocks immediate practice on every visit. | **P1** |
| **7** | **Import a Word document** (`133` aviation `.docx` Qs) | **`6` wizard clicks** (+ set creation `3` clicks = `9` total) | Set create `6,320 ms` + Wizard **`17,955 ms`** (`nav 3,111` + `parse 4,494` + `preview 475` + `commit 8,902 ms`) | **6 separate wizard screens** required even for a 100% clean `0`-error file; jargon (`"Phân tích xác định 100%"`); **`+91px` mobile horizontal overflow** on stepper! | **P0** |
| **8** | **Import an Excel document** (`24` aviation `.xlsx` Qs) | **`6` wizard clicks** (+ set creation `3` clicks = `9` total) | Set create `3,978 ms` + Wizard **`15,500 ms`** (`nav 3,270` + `parse 3,476` + `preview 447` + `commit 7,352 ms`) | Identical 6-step mandatory gauntlet even when Excel columns auto-map with `0` errors; `7.35s` commit for just 24 questions. | **P0** |
| **9** | **Create a 250-question exam** (`/exams/new`) | `4` (after finding sets & scrolling) | Builder load **`2,876 ms`**; **250Q generate & load `9,946 ms`**; Q1->Q2 `60 ms`; Q2->Q50 `57 ms` | **`78–79` interactive controls**, **`5.13` mobile screenfuls**, clipped 3rd tab (`Phủ...`), contradictory disabled `Khả dụng: 0` sticky bar under `"Phạm vi: Toàn bộ 4 học phần của bạn"`, and **10-second** generation wait! | **P0** |
| **10** | **Create a multi-subject exam** (`/exams/new`, 4 sets / 278 unique Qs) | `4–7` (depending on allocation tweaks) | Included in Task 9 (`2,876 ms` load + `9,946 ms` gen) | Exposes **5 allocation strategy cards + 8 selection policy cards + 11 question pills + 5 timer pills** simultaneously on screen without progressive disclosure. | **P0** |
| **11** | **Find incorrect questions** (`/review`) | `1` (Sidebar `Câu đã sai` / Mobile `On sai`) | **`4,342 ms`** to load | **`37` interactive controls**, **`3.31` mobile screenfuls**; 5 stacked CTA buttons + 4 KPI cards + `"15 bộ lọc chuyên sâu"` push ALL actual wrong questions below the fold on mobile! | **P1** |
| **12** | **Resume an interrupted learning session** (`/dashboard`) | `1` (`Tiếp tục học` button) | Dashboard **`4,401 ms`**; Resume nav **`448 ms`** | Resume banner IS helpful (`y = 313px` desktop), **but** Dashboard ALSO displays a second similarly named `"Tiếp tục học"` card below it showing an **unstudied (`Chưa học`)** set! | **P1** |
| **13** | **Create an image-based question** (`/sets/[id]/edit`) | **`10`** (Edit -> Add -> Prompt -> Upload -> 4 opts -> Save) | Upload & save **`6,179 ms`** (`11,201 ms` total) | Modal opens with 13-type dropdown, raw `https://... hoặc /api/uploads/signed-url?path=...` text input, chapter/difficulty/tags/explanation, and `Rich Text & LaTeX` toggle all visible at once. | **P2** |
| **14** | **Share a study set** (`/sets/[id]`) | `3` (`Chia sẻ` -> `Tạo liên kết chia sẻ mới` -> `Sao chép`) | **`1,896 ms`** (`HTTP 201`) | `Chia sẻ` is buried in Row 2–3 of a **10-button action wall** on `/sets/[id]`; requires navigating a 3-tab modal (`Riêng tư / Liên kết chia sẻ / Thành viên`) just to copy a link. | **P2** |
| **15** | **Download an offline study set** (Mobile `390×844` `/sets/[id]`) | `2` (`Tải về học ngoại tuyến` -> dialog confirm) | **`4,532 ms`** (`Đã sẵn sàng ngoại tuyến` shown) | Confirmation dialog adds an extra tap for small sets (~1–20 KB); after downloading, there is no quick link telling the student where `/offline` lives for later offline studying. | **P2** |
| **16** | **Use the app on Mobile (`390×844` & `360×800`)** | Full mobile sweep across 10 routes | `3.2–5.1` screenfuls per core page | `/library` header crushed into 12-line skinny text (`before_06`); `/sets/[id]` 10-button wall with 3 unlabeled mystery icons (`☆`, `⚑`, destructive `↺`); `/sets/[id]/import` **`+91px` overflow**; bottom nav missing accents (`On sai`, `Tông quan`); `Thêm` drawer dumps 13 more items incl. desktop `Phím tắt`; Exam runner hides `Nộp bài` inside `0/250` drawer. | **P0** |

---

## 3. Quantitative Screen Complexity & Density Matrix (BEFORE V3.1)

These measurements prove objectively why the app feels like an **enterprise admin tool** instead of a clean personal study app:

| Screen (`BEFORE`) | Viewport | Scroll Height (`px`) | Screenfuls (`scrollH / innerH`) | Controls in `<main>` | Above-Fold Controls | Sidebar / Header Items | Horizontal Overflow |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/` (Landing) | `1440×900` | `2,652` | `2.95×` | `6` | `3` | `0` / `8` | `0px` |
| `/` (Landing) | `390×844` | `5,032` | **`5.96×`** | `6` | `3` | `0` / `4` | `0px` |
| `/register` | `360×800` | `800` | `1.00×` | `7` | `7` | `0` / `3` | `0px` |
| `/dashboard` | `1440×900` | `1,630` | `1.81×` | `22` | `15` | **`15`** / `6` | `0px` |
| `/dashboard` | `390×844` | `3,141` | **`3.72×`** | `22` | `6` | `0` / `5` | `0px` |
| `/library` | `1440×900` | `900`* | `1.00×`* | `8`* | `8`* | **`15`** / `6` | `0px` |
| `/library` | `390×844` | `1,578` | `1.87×` | `28` | `13` | `0` / `5` | `0px` |
| `/sets/[id]` | `1440×900` | `1,056`* | `1.17×`* | `23`* | **`22`** | **`15`** / `6` | `0px` |
| `/sets/[id]` | `390×844` | `2,721` | **`3.22×`** | **`34`** | **`16`** | `0` / `5` | `0px` |
| `/exams/new` | `1440×900` | `2,394` | `2.66×` | **`78`** | **`26`** | **`17`** / `6` | `0px` |
| `/exams/new` | `390×844` | `4,332` | **`5.13×`** | **`79`** | `12` | `2` / `5` | `0px` |
| `/sets/[id]/practice` (Setup) | `390×844` | `844` | `1.00×` | **`14`** (gate!) | `14` | `0` / `1` | `0px` |
| `/exams/[attemptId]` (Runner) | `390×844` | `844` | `1.00×` | `10` | `10` | `0` / `1` | `0px` |
| `/sets/[id]/import` | `390×844` | `1,383` | `1.64×` | `18` | `12` | `0` / `5` | **`+91px` (FAIL)** |
| `/review` | `1440×900` | `1,651` | `1.83×` | **`37`** | **`29`** | **`15`** / `6` | `0px` |
| `/review` | `390×844` | `2,793` | **`3.31×`** | **`37`** | `7` | `0` / `5` | `0px` |

*\*Captured while client-side `/api/sets` or `/api/sets/[id]/questions` was still rendering empty skeleton placeholders (`Của tôi (0)` / `Ngân hàng câu hỏi (0)`), proving slow client hydration even after `networkidle`.*

---

## 4. Wave 5 Target Comparison Benchmarks (Before -> After Goals)

To make Wave 5 Before/After verification unambiguous, Wave 2–4 UX & Performance work should target:
- **Desktop Sidebar:** `15` items (with duplicate `Thi thử tùy chỉnh`) -> **`<= 6` clean core items** (zero duplicates!).
- **`/sets/[id]` Action Bar:** `10` buttons (3 mystery icons on mobile) -> **1 primary `Bắt đầu học` / `Học ngay` CTA + `2–3` secondary actions + `...` overflow menu**.
- **`/exams/new` Controls:** `78–79` visible controls (`5.13` mobile screenfuls) -> **`<= 15` visible controls in Simple Mode** (`<= 2.0` mobile screenfuls) with `"Tùy chỉnh nâng cao"` collapsed!
- **Word/Excel Import Happy Path:** `6` clicks / `6` screens -> **`2` clicks (`Upload` -> `Xem trước & Nhập`)** when auto-detection finds `0` errors + **`0px` mobile overflow** on stepper!
- **Practice Mode Entry:** `2` clicks (mandatory 14-control setup wall) -> **`1` click directly into Question 1** (with optional filter gear icon)!
- **`/review` Above-the-Fold:** `37` controls & `0` visible questions on mobile -> **1 primary `"Ôn câu sai ngay"` CTA + actual wrong questions visible on Screen 1** (filters collapsed behind `"Bộ lọc"` toggle)!
- **Mobile `/library` Header:** 12-line skinny crushed column -> full-width stacked header (`0` vertical text crushing!).

---

## 5. BEFORE Screenshot Index (`docs/audit/v3.1-ux-performance/screenshots/before/`)

| # | Filename | Viewport | Key Baseline Friction Shown |
| --- | --- | --- | --- |
| 01 | `before_01_landing_desktop.png` | `1440×900` | Clean landing, outdated V2 `6` modes / `DOCX · XLSX · TXT` copy |
| 02 | `before_02_landing_mobile_390.png` | `390×844` | Clean above fold, `5.96` screenfuls total height |
| 03 | `before_03_dashboard_desktop.png` | `1440×900` | 15 sidebar items, **4 duplicate Exam CTAs**, 2 confusing "Continue" blocks, sets pushed below fold |
| 04 | `before_04_dashboard_mobile_390.png` | `390×844` | `3.72` screenfuls; `On sai` / `Tông quan` bottom-nav diacritic issues |
| 05 | `before_05_library_desktop.png` | `1440×900` | Slow hydration flashing **`Của tôi (0)`** + 6 gray skeleton boxes |
| 06 | `before_06_library_mobile_390.png` | `390×844` | **Severe mobile header crush** (`Thư viện học phần` squeezed into 12 skinny vertical lines!) |
| 07 | `before_07_set_detail_desktop.png` | `1440×900` | **10-button action wall**, flat 8-mode gray grid, **`Ngân hàng câu hỏi (0)`** skeleton flash |
| 08 | `before_08_set_detail_mobile_390.png` | `390×844` | 3-row action wall with **3 unlabeled mystery icons (`☆`, `⚑`, destructive `↺`)** pushing study modes offscreen |
| 09 | `before_09_exam_builder_desktop.png` | `1440×900` | **78 controls**, Quick Test vs Custom Builder ambiguity, `0 câu` preview box |
| 10 | `before_10_exam_builder_mobile_390.png` | `390×844` | **79 controls / `5.13` screenfuls**, clipped 3rd tab (`Phủ...`), disabled `Khả dụng: 0` sticky bar |
| 11 | `before_11_practice_setup_mobile_390.png` | `390×844` | Mandatory **14-control setup gate** blocking Q1 every time Practice is tapped |
| 12 | `before_12_exam_runner_mobile_390.png` | `390×844` | Clean mobile exam focus (synthetic question), but missing visible `Nộp bài` submit CTA |
| 13 | `before_13_mobile_more_drawer_390.png` | `390×844` | Bloated `Thêm` drawer with 13 items (incl. desktop `Phím tắt` on mobile & duplicate VI/Theme) |
| 14 | `before_14_import_wizard_mobile_390.png` | `390×844` | **`+91px` horizontal overflow** clipping steps 5–6 + `"Phân tích xác định 100%"` engineering jargon |
| 15 | `before_15_review_mistakes_mobile_390.png` | `390×844` | 5 stacked CTA buttons + 4 KPI cards + `"15 bộ lọc chuyên sâu"` hiding actual wrong questions |
| 16 | `before_16_register_mobile_360.png` | `360×800` | Clean layout, optional username regex friction & untranslated English error message |

---

## 6. Teardown & Data Safety Confirmation

- Disposable accounts provisioned & deleted: `v31-ux-main-*` (4 sets / 281 questions + 1 uploaded image cleaned) + `v3-prod-user-exshot-*` (synthetic mobile exam screenshot recapture, 1 image cleaned). Registration test `v31-ux-reg-*` was rejected before auth row creation (`email_address_invalid`).
- Verified **`trackedUsersRemaining === 0`**, **`trackedStorageRemaining === 0`** (`study-media: 0`, `study-temp: 0`), **`trackedRemaining === 0`**. Pre-existing real user accounts and sets remain 100% untouched.
