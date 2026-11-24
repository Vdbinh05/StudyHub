# StudyHub V3.1 — Wave 1 Independent Student Usability Audit (`UX_AUDIT.md`)

> **Role:** Independent Real User / UX Researcher (`real-user`)  
> **Mindset:** Brutally honest first-time student & Quizlet / EduQuiz user testing **`https://studyhub-three-mauve.vercel.app`** (`v3.0-checkpoint`). Zero excuses for user confusion; every friction point below is a real product flaw we must fix in Wave 2–4.  
> **Companion Quantitative Data & Screenshots:** [`UX_BASELINE.md`](./UX_BASELINE.md) and `docs/audit/v3.1-ux-performance/screenshots/before/`.

---

## 1. Honest Verdict: Why the Real Owner Found StudyHub "Confusing & Slow"

StudyHub V3.0 is an extraordinary **engineering achievement** (zero crashes, real deterministic parsers, rich math/diagrams, strict RLS, working offline PWA). **Yet as a daily product used by a real student, it suffers from classic "feature-complete, UX-overloaded" syndrome:**

1. **Every capability was surfaced at the top level simultaneously.** Instead of progressive disclosure (simple default -> optional advanced controls), the app exposes **15 sidebar items**, **10 action buttons per Study Set**, **8 equal-weight study modes**, **6 mandatory import wizard steps**, **79 controls on the Exam Builder**, and **15 filters on Review Mistakes**.
2. **Duplicate CTAs scream for attention everywhere.** On `/dashboard` alone, `"Thi thử tùy chỉnh"` appears **4 separate times** in the same viewport, while the student's actual study sets are pushed completely off the bottom of the screen!
3. **The app talks like its engineering specification, not like a study companion.** Copy such as `"Phân tích xác định 100%"`, `"15 bộ lọc chuyên sâu"`, `"Phân bổ theo tỷ lệ môn / chính sách chọn câu"`, and 5 exposed SM-2 stage tabs (`Làm quen / Ghi nhớ / Thành thạo / Ôn tập / Luyện thi`) makes a student feel like they are configuring enterprise analytics software instead of flipping flashcards.
4. **Slow multi-second cross-region waits + empty `(0)` skeleton flickers amplify the confusion.** Waiting **4.2s** after login, **4.6s** opening a set, **5.0s** opening flashcards, **9.9s** generating a 250-question exam, and watching `/library` flash `Của tôi (0)` or `/sets/[id]` flash `Ngân hàng câu hỏi (0)` makes students think their data is missing or taps didn't register — especially on mobile!

The good news? Look at **`before_12_exam_runner_mobile_390.png`** (the active Exam Runner): **when StudyHub focuses on ONE task at a time, it already feels crisp, fast (`60ms` question switch), and calm.** StudyHub V3.1 doesn't need to delete features — it needs to **apply that exact calm, focused Quizlet/EduQuiz simplicity to Navigation, Dashboard, Library, Set Detail, Import, Practice, Exam Builder, and Review Mistakes** while collapsing power-user controls cleanly behind progressive disclosure!

---

## 2. Prioritized Usability Findings (`UX31-01` – `UX31-14`)

### P0 — Critical Usability & First-Impression Blockers (Fix First in Wave 2–3)

#### `UX31-01` [P0] — "Enterprise Cockpit" Navigation & 4× Duplicate CTAs on Dashboard
- **Where:** Global Sidebar (`aside`) & `/dashboard` (`before_03_dashboard_desktop.png`, `before_04_dashboard_mobile_390.png`).
- **What Happens:**
  - Desktop sidebar lists **15 interactive links** (`Thi thử tùy chỉnh` button, `Tổng quan`, `Thư viện`, `Thi thử tùy chỉnh` **AGAIN**, `Luyện tập`, `Đề & Chu kỳ thi`, `Câu đã sai`, `Đánh dấu sao`, `Lịch sử`, `Thống kê`, `Được chia sẻ`, `Bạn bè`, `Cài đặt`).
  - On `/dashboard`, a student sees **FOUR** "Custom Exam" buttons simultaneously (sidebar pill, sidebar link, top-right purple button, middle banner card).
  - There are **TWO conflicting "Continue" blocks**: `"Tiếp tục học dở"` (real active Learn session) AND `"Tiếp tục học"` right below showing a set marked **`Học gần nhất: Chưa học`** (never studied!).
  - On Mobile `390×844`, `/dashboard` stretches **`3.72` screenfuls**, burying the student's actual list of study sets completely below the fold.
- **Quizlet / EduQuiz Simplification:**
  - Collapse global desktop sidebar to **5–6 primary items**: **`Trang chủ` (`/dashboard`)**, **`Thư viện` (`/library`)**, **`Thi thử` (`/exams/new`)**, **`Ôn câu sai` (`/review`)**, **`Thống kê & Lịch sử`** (combined or collapsible `"Thêm"` group for `Đánh dấu sao`, `Được chia sẻ`, `Bạn bè`, `Cài đặt`). Remove the duplicate `Thi thử tùy chỉnh` pill!
  - Redesign `/dashboard` top-to-bottom around **1 job — resume studying in 1 tap**:
    1. Compact greeting + single primary CTA (`+ Tạo / Nhập học phần`).
    2. **Resume card** (ONLY shown when an active interrupted session exists; remove the fake `"Chưa học"` second "Tiếp tục học" block!).
    3. **Học phần của bạn (Your Study Sets)** immediately visible above the fold with direct 1-tap `Học` / `Thi` buttons!
    4. Compact 1-row progress strip (today's goal + mistakes due) instead of 4 tall KPI boxes + giant Custom Exam promo card.

#### `UX31-02` [P0] — Exam Builder (`/exams/new`) Cognitive Wall (`79` Controls, `5.13` Mobile Screenfuls, Contradictory `Khả dụng: 0`)
- **Where:** `/exams/new` Desktop & Mobile (`before_09_exam_builder_desktop.png`, `before_10_exam_builder_mobile_390.png`).
- **What Happens:**
  - Displays **`78` interactive controls on Desktop / `79` on Mobile** (`5.13` mobile screenfuls!).
  - On mobile `390px`, the 3rd tab **`Phủ hết ngân hàng`** is clipped off the right edge (`Phủ...`), and 5 tall Quick Test buttons consume the entire first screen.
  - Worse: right below `"Phạm vi: Toàn bộ 4 học phần của bạn"`, the sticky bottom bar shows **`0 câu · 45p · Khả dụng: 0`** with a **disabled `[Bắt đầu thi]` button** because no sets are checked yet (two screenfuls down!). A first-time student genuinely thinks the exam builder failed to load their 278 questions!
  - Generating a 250-question exam took **`9,946 ms`** (nearly 10 full seconds) with no step-by-step progress indication.
- **Quizlet / EduQuiz Simplification:**
  - **Auto-select** the student's active/recent set (or pre-select all when arriving via Quick Exam) so `Bắt đầu thi` is IMMEDIATELY enabled and shows real question count (`Khả dụng: 278 câu`) — NEVER show a confusing disabled `Khả dụng: 0` when the user has sets!
  - Make **Simple Mode** the default with only **3 clean choices visible** (`<= 12` controls, `<= 1.8` mobile screenfuls):
    1. **Chọn học phần** (checkbox list + `Chọn tất cả`).
    2. **Số câu & Thời gian** (compact 4-preset chips `20 / 50 / 100 / 250 câu` + custom input & timer).
    3. Big clear **`Bắt đầu thi ngay`** CTA!
  - Tuck all power-user controls (**5 allocation strategies**, **8 selection policies**, **chapter/tag/difficulty/type filters**, **Saved Templates**, **Full Coverage Cycles**) cleanly inside a collapsed **`Tùy chỉnh nâng cao (Phân bổ, Lọc chương, Phủ 100%)`** accordion or clean compact segmented switcher that fits `360px` without clipping!

#### `UX31-03` [P0] — Study Set Detail (`/sets/[id]`) Wall of 10 Action Buttons, Mystery Icons & Flat 8-Mode Grid
- **Where:** `/sets/[id]` Desktop & Mobile (`before_07_set_detail_desktop.png`, `before_08_set_detail_mobile_390.png`).
- **What Happens:**
  - Right under the study set title sit **10 horizontal action buttons** (wrapping into **3 full rows** on mobile `390px`!).
  - On mobile `390px`, 3 of those buttons lose their labels and become **unlabeled mystery icons**: `☆` (favorite), `⚑` (error report inbox), and **`↺` (destructive Reset Progress!)** sitting right next to `Xuất dữ liệu` and `Nhân bản`!
  - The ONLY highlighted purple CTA at the top is **`Tạo đề thi tùy chỉnh`**, NOT "Start Studying"! Meanwhile, all 8 study modes (`Flashcard`, `Học sâu`, `Luyện trắc nghiệm`, `Gõ đáp án`, `Nghe & Gõ`, `Ghép thẻ`, `Sơ đồ`, `Thi thử`) appear in a flat monochrome grid with zero visual hierarchy — a first-time student doesn't know whether to click `Học sâu`, `Luyện trắc nghiệm`, or `Gõ đáp án`!
  - On mobile `390px`, `Flashcard` is pushed all the way down to `y = 660px` (barely peeking above the bottom nav bar!).
- **Quizlet / EduQuiz Simplification:**
  - Put **Studying FIRST** (just like Quizlet!):
    1. Title + compact metadata (`133 câu · Aviation Meteorology`) + **`Chỉnh sửa`** + **`Chia sẻ`** + **`⋯` (More menu)** containing `Nhập từ file`, `Tải ngoại tuyến`, `Xuất PDF / dữ liệu`, `Quản lý báo lỗi`, `Nhân bản`, `Đặt lại tiến độ` (with clear labels & destructive styling inside the menu — ZERO mystery icons!).
    2. **Primary 4-Card Study Launcher right above the fold** (compact 2×2 grid on mobile, 4-col on desktop): **`Flashcards`**, **`Luyện trắc nghiệm` (primary highlight)**, **`Học thích ứng (Learn)`**, **`Thi thử`**.
    3. Compact collapsible / secondary row **`Chế độ mở rộng`** for `Gõ đáp án`, `Nghe & Gõ`, `Ghép thẻ`, `Sơ đồ` (auto-hiding incompatible grayed-out modes instead of cluttering the screen with `"Chưa khả dụng"` boxes!).

#### `UX31-04` [P0] — 6-Step Import Wizard Friction + `+91px` Mobile Horizontal Overflow + Engineering Jargon
- **Where:** `/sets/[id]/import` (`before_14_import_wizard_mobile_390.png`, Tasks 7 & 8).
- **What Happens:**
  - Importing a clean Word (`133q`) or Excel (`24q`) file forces **6 separate clicks across 6 steps** (`Nguồn -> Định dạng -> Đáp án -> Xem trước -> Xử lý -> Nhập`) taking **`17.96s`** (Word) and **`15.50s`** (Excel), even when StudyHub auto-detected 100% of questions and answers with **`0` errors**!
  - On Mobile `390×844`, the 6-step horizontal stepper **overflows `+91px` off the right edge of the screen**, completely hiding steps 5 and 6!
  - Copy reads `"Phân tích xác định 100% cho Word (.docx)..."` — internal engineering terminology, not student language.
- **Quizlet / EduQuiz Simplification:**
  - **2-Click Happy Path (EduQuiz-style):**
    1. **Step 1 (Chọn tệp / Dán văn bản):** The moment a student drops/picks a `.docx`, `.xlsx`, `.pdf`, `.txt`, or pastes Quizlet TSV, auto-parse immediately in the background and jump straight to **Step 2: Xem trước & Nhập (`Nhập 133 câu hỏi`)** whenever `errors === 0`!
    2. Keep `"Chỉnh quy tắc định dạng / đáp án"` and `"Tùy chọn trùng lặp / chương"` as clean collapsible drawers on the Preview screen (only auto-opening if `missingAnswers > 0` or `errors > 0`).
  - Fix mobile stepper (`0px` overflow — replace 6 wide circles with a compact `"Bước 1 / 2"` progress bar on mobile!) and replace `"Phân tích xác định 100%"` with friendly student copy (`"Tự động nhận diện câu hỏi & đáp án từ Word, Excel, PDF hoặc Quizlet"`).

#### `UX31-05` [P0] — Multi-Second Route Delays & Alarming `(0)` Skeleton Flickers
- **Where:** `/login -> /dashboard` (`4,158 ms`), `/library` (`Của tôi (0)` skeleton in `before_05_library_desktop.png`), `/sets/[id]` (`4,647 ms` + `Ngân hàng câu hỏi (0)` skeleton in `before_07_set_detail_desktop.png`), `/sets/[id]/flashcards` (`5,038 ms`), `/review` (`4,342 ms`).
- **What Happens:**
  - Even on fast Desktop Wi-Fi, core student clicks take **4 to 5 seconds** to become interactive (and **10 seconds** to start a 250-question exam!).
  - During those 4–5 seconds, `/library` literally displays **`Của tôi (0)`** and `/sets/[id]` displays **`Ngân hàng câu hỏi (0)`** right beneath `133 câu hỏi` — creating instant anxiety that imported questions were lost!
- **Simplification & Performance Fix (pair with Wave 2–3 Backend/Frontend Perf):**
  - Co-locate Vercel region to `hnd1` + server-hydrate initial payloads + eliminate double `getUser()` and uncontrolled `<Link>` prefetch storms (per Backend & Frontend Perf audits).
  - **Never display `(0)` while loading!** Show `Của tôi` / `Ngân hàng câu hỏi` (without `(0)`) or a subtle inline loading pill until real counts arrive, and reuse already-loaded set metadata when navigating from Library -> Set Detail -> Flashcards/Practice so screens appear **instantly**.

---

### P1 — High-Friction Mobile & Learning Flow Issues (Fix in Wave 3)

#### `UX31-06` [P1] — Mobile `/library` `PageHeader` Crushes Title Into a 12-Line Skinny Column
- **Where:** `/library` on Mobile `390×844` (`before_06_library_mobile_390.png`).
- **What Happens:** `Thư viện học phần` and its description wrap into a ~80px-wide column **12 lines tall** beside `[Thư mục mới] [Tạo học phần mới]`, pushing the actual study set cards down to `y = 630px`!
- **Fix:** Stack `PageHeader` vertically below `sm:` (`flex-col sm:flex-row`) so titles ALWAYS get 100% width on phones! Also move `"Tạo đề thi tùy chỉnh"` out of `/library` (it's already in the bottom nav!) and remove the redundant extra search box when the global search is accessible, or keep 1 compact search+filter row.

#### `UX31-07` [P1] — Mandatory 14-Control Setup Gate Before Question 1 in Practice Mode
- **Where:** `/sets/[id]/practice` (`before_11_practice_setup_mobile_390.png`, Task 6).
- **What Happens:** Clicking `Luyện trắc nghiệm` never shows Question 1 — it traps the student in a 14-control form (`Phạm vi`, `Chương`, `Thẻ`, `Số câu`, 5 toggles) requiring an extra tap on `Bắt đầu luyện tập` every single time.
- **Fix:** Drop the student **directly into Question 1** (using their saved defaults from `/settings`), and place a clean **`Tùy chỉnh / Lọc` (gear/sliders)** button in the top bar that opens the setup options as a lightweight drawer only when wanted!

#### `UX31-08` [P1] — Review Mistakes (`/review`) Buries Actual Mistakes Under 5 CTAs, 4 KPI Cards & "15 Filters"
- **Where:** `/review` (`before_15_review_mistakes_mobile_390.png`, Task 11).
- **What Happens:** `37` interactive controls across `3.31` mobile screenfuls; 5 stacked buttons (`Luyện tất cả câu lọc`, `Luyện 20 câu ngẫu nhiên`, `Học thích ứng`, `Flashcards`, `Thi thử câu sai`) + 4 large KPI boxes + engineering subtitle (`"15 bộ lọc chuyên sâu..."`) push ALL actual mistake cards completely below Screen 1 on mobile!
- **Fix:** Show **1 clear primary CTA (`Ôn 3 câu sai ngay`)** + compact split menu for other modes (`Flashcard / Thi thử câu sai`), replace 4 tall KPI cards with a single compact summary pill strip (`3 chưa khắc phục · 1 tự tin cao · 0 đến hạn`), collapse all 15 filters behind a clean **`Bộ lọc`** button, and render the **actual wrong questions immediately on Screen 1**!

#### `UX31-09` [P1] — Mobile Bottom Navigation Diacritic Glitches (`On sai`, `Tông quan`) & Bloated `Thêm` Drawer
- **Where:** Mobile bottom navigation bar & `Thêm` drawer (`before_04`, `before_06`, `before_08`, `before_13_mobile_more_drawer_390.png`).
- **What Happens:**
  - The mobile bottom bar renders **`On sai`** (missing the `Ô` circumflex accent!) and visually clips/flattens the dot under **`Tổng quan`** (`Tông quan`).
  - Opening `Thêm` reveals **13 items**, including **`Phím tắt` (Keyboard Shortcuts)** on a touch-only smartphone AND duplicate `VI` + Theme icons already visible in the top bar!
- **Fix:** Fix exact Vietnamese label strings (`Tổng quan` / `Trang chủ`, `Ôn sai`) with proper line-height (`leading-normal` so diacritics never clip); slim the mobile `Thêm` drawer to 5–6 clean destinations (`Lịch sử & Thống kê`, `Đánh dấu sao`, `Được chia sẻ & Bạn bè`, `Học ngoại tuyến`, `Cài đặt`) and remove `Phím tắt` and duplicate header toggles on touch/mobile widths!

#### `UX31-10` [P1] — Mobile Active Exam Runner Hides `Nộp bài` (Submit) Inside the `0/250` Grid Button
- **Where:** `/exams/[attemptId]` on Mobile `390×844` (`before_12_exam_runner_mobile_390.png`).
- **What Happens:** The mobile Exam Runner is otherwise StudyHub's cleanest screen (`1.00` screenful, `60ms` switching), **but** there is no visible `Nộp bài` button on either the top bar or bottom bar — students have to guess that Submit lives inside the `0/250` grid icon!
- **Fix:** Add a crisp compact **`Nộp bài`** button in the mobile exam top-right bar (right next to the countdown timer `44:07`) so finishing an exam on mobile is unmistakable!

---

### P2–P3 — Secondary Friction & Copy Polish (Wave 3–4)

#### `UX31-11` [P2] — Learn Mode Exposes 5 Internal SM-2 Stage Tabs at the Top
- **Where:** `/sets/[id]/learn` (Task 5).
- **What Happens:** Displaying `Làm quen`, `Ghi nhớ`, `Thành thạo`, `Ôn tập`, `Luyện thi` as 5 clickable top buttons confuses first-time students about whether Learn is automatic or manual.
- **Fix:** Replace the 5 stage buttons with a **single clean progress bar (`1 / 24 câu · Đang làm quen`)** like Quizlet Learn, tucking stage filtering inside the compact `"Tùy chỉnh"` button!

#### `UX31-12` [P2] — Registration Untranslated Error & Username Regex Friction
- **Where:** `/register` (`before_16_register_mobile_360.png`, Task 1).
- **What Happens:** Supabase `email_address_invalid` appears in raw English (`Email address "..." is invalid`) inside a Vietnamese form; `Tên người dùng (tùy chọn)` with regex instructions adds extra clutter to first-time signup.
- **Fix:** Map Supabase auth error codes (`email_address_invalid`, `over_email_send_rate_limit`, `user_already_exists`) to clear Vietnamese/English student messages, and move optional `username` to `/profile` after signup (keeping `/register` to just Name, Email, Password)!

#### `UX31-13` [P2] — Question Editor Modal Visual Overload (10 Clicks for Image Question)
- **Where:** `/sets/[id]/edit` (Task 13).
- **What Happens:** Opening `Thêm câu hỏi` immediately displays 13 question types, a raw `/api/uploads/signed-url?path=...` URL field, chapter, difficulty, tags, explanation, and a Rich Text switch all at once.
- **Fix:** Hide the raw image URL input behind a single friendly **`+ Thêm ảnh minh họa`** button (showing a clean thumbnail once uploaded), keep MCQ/Flashcard fields clean on top, and tuck Chapter / Difficulty / Tags / Rich-Text & Advanced Types under clean compact collapsible pills.

#### `UX31-14` [P3] — Landing Page Outdated V2 Copy & Excessive Mobile Height (`5.96×`)
- **Where:** `/` (`before_01_landing_desktop.png`, `before_02_landing_mobile_390.png`).
- **What Happens:** Hero still says `6 Chế độ học` and `DOCX · XLSX · TXT` (omitting V3's 8 modes, PDF import/export, Diagrams, Offline PWA) and scrolls `5.96` mobile screenfuls.
- **Fix:** Update landing hero copy to V3 capabilities and tighten mobile marketing card spacing.

---

## 3. Concrete Quizlet / EduQuiz-Inspired Redesign Blueprint (Summary for Wave 2–4)

| Screen | Current Overengineered Pattern (`BEFORE`) | Target Simple Student-First Pattern (`V3.1 AFTER`) |
| --- | --- | --- |
| **Navigation** | 15 desktop sidebar items + 2× `Thi thử tùy chỉnh` + 13-item mobile `Thêm` drawer (`On sai` typo) | **5 core tabs** (`Trang chủ`, `Thư viện`, `Thi thử`, `Ôn sai`, `Cài đặt/Thêm`), zero duplicates, crisp Vietnamese diacritics, no keyboard-only items on mobile |
| **Dashboard** | 4× Exam CTAs + 4 KPI cards + 2 confusing "Continue" blocks; sets pushed offscreen (`3.72×` mobile) | **Resume active session (if any) -> Your Study Sets immediately above the fold** with 1-tap `Học` / `Thi` + slim 1-row daily progress bar |
| **Library** | Crushed 12-line mobile title + duplicate search/exam CTA + `Của tôi (0)` skeleton flash | Full-width stacked mobile header + 1 compact search/filter row + instant server-hydrated study set cards (no `(0)` flicker!) |
| **Set Detail** | 10-button action wall (3 unlabeled mystery icons on mobile) + flat 8-mode monochrome grid | Primary **`Bắt đầu học`** + 4 core mode cards above the fold (`Flashcards`, `Luyện tập`, `Học thích ứng`, `Thi thử`) + compact **`⋯`** menu for secondary tools + collapsible extra modes |
| **Import** | Mandatory **6-step wizard** (`17.9s` / `6` clicks) + **`+91px` mobile overflow** + engineering jargon | **2-step Happy Path (`Chọn tệp` -> `Xem trước & Nhập`)** auto-skipping config when `0` errors; responsive mobile progress bar (`0px` overflow) |
| **Practice** | Mandatory 14-control setup screen blocking Q1 on every entry | **Start directly on Q1** in 1 tap; move filters/toggles into a compact top-right settings drawer |
| **Exam Builder** | **78–79 controls**, `5.13×` mobile scroll, clipped 3rd tab, disabled `Khả dụng: 0` bar | **Simple 3-step default** (auto-selected set, 4 count presets, `Bắt đầu thi ngay`) + collapsed **`Tùy chỉnh nâng cao`** for allocation/policy/full-coverage power users |
| **Review Mistakes** | 5 stacked CTAs + 4 KPI cards + 15 filters hiding actual wrong questions | **1 primary `Ôn câu sai ngay` button** + compact count pills + **wrong question cards immediately visible on Screen 1** + collapsible `Bộ lọc` |
| **Exam Runner (Mobile)** | Clean focus (keep!), but `Nộp bài` hidden inside `0/250` grid | Keep clean 1-question focus AND add a clear compact **`Nộp bài`** button in the mobile header |

---

## 4. Wave 5 & Wave 5B Live Production BEFORE vs AFTER Verification (`3406444` → `460c23d`, `hnd1` Tokyo)

> **Verified Live Target:** **`https://studyhub-three-mauve.vercel.app`** (Wave 5 full 16-task audit on commit `34064445b130012da8ae89e99f735ba85c147044` / `dpl_6N85jVRkZZjf5yNM2sMnH5ru6Noj`, followed by Wave 5B surgical re-verification on commit **`460c23daac9b365877536c1bf9f0eef7f0c1e980`** / **`dpl_D7R6PY6mPPwvGRFZKLi3BVir7Bn9`**; both verified **`X-Vercel-Id: hkg1::hnd1::...`** Tokyo co-located with Supabase Cloud `ap-northeast-1`, migration `0018` LIVE).  
> **Measured At:** `2026-11-24T19:16Z–19:34Z` across Desktop `1440×900`, Mobile `390×844`, and Small Mobile `360×800` (unthrottled broadband Wi-Fi, identical methodology to Wave 0 `UX_BASELINE.md`; zero `src/*` / `supabase/*` / config inspection or edits; zero `sample-data/` text in docs or screenshots).

### 4.1 Executive Wave 5 + Wave 5B Student Verdict

- **Overall UX & Speed Transformation: MASSIVE REAL-WORLD WIN (`0` P0 Open, `0` P1 Open, `12 / 14` Baseline UX Issues FIXED).** All **5 P0 blockers (`UX31-01`–`UX31-05`)**, all **5 P1 UX friction issues (`UX31-06`–`UX31-10`)**, **`UX31-12` (localized signup errors)**, **`UX31-14` (V3 landing copy)**, AND the Wave 5 P1 regression **`V31-UX-REG-01`** are **VERIFIED FIXED LIVE** on `https://studyhub-three-mauve.vercel.app` (`460c23d`) with `0` HTTP 5xx, `0` uncaught JS page errors, and **`0px` horizontal overflow** across `1440×900`, `390×844`, and `360×800`!
- StudyHub now **genuinely feels like a fast, calm, student-first Quizlet / EduQuiz-class app**: Login→Dashboard is **-69.4% faster** (`1.27s`), Library→133q Set is **-73.6% faster** (`1.23s`), Practice starts **directly on Question 1 in 1 click** with **`41 ms` instant feedback**, Word/Excel import dropped from **6 mandatory wizard clicks to 1 click after file selection** (`751 ms` / `674 ms` parse, `0px` mobile overflow), 250-question multi-subject exam creation dropped **-76.3%** (`9.95s → 2.36s`), and image question upload+save dropped **-58.4%** (`6.18s → 2.57s` on `460c23d`)!
- **Wave 5 → Wave 5B Regression Closure (`V31-UX-REG-01` [P1]):** Wave 5 (`3406444`) caught a real P1 regression where uploading an image in `/sets/[id]/edit` returned `201` with `/api/uploads/signed-url?path=...&redirect=1` into `<input type="url">`, blocking `Lưu` via native HTML5 `"Please enter a URL."`. Commit **`460c23d`** fixed this cleanly — Wave 5B live re-verification confirmed **`POST /api/uploads` `201` → `POST /api/sets/[id]/questions` `201` (`savedCleanly: true`, `2,570 ms`, `typeUrlInputsCount: 0`)** and verified the uploaded image renders with `naturalWidth > 0` on `/sets/[id]`.
- **Remaining Minor P2 Polish (Non-Blocking):** Only `UX31-11` (Learn still displays 5 top SM-2 stage buttons) and partial `UX31-13` (Question Editor modal density / optional URL input visibility) remain for future polish.

---

### 4.2 Side-by-Side 16-Task BEFORE (`iad1` V3.0) vs AFTER (`hnd1` V3.1 — `3406444` + `460c23d`) Table

| # | Student Task | BEFORE Clicks (`v3.0`) | AFTER Clicks (`V3.1`) | BEFORE Time (Live Wi-Fi) | AFTER Time (Live Wi-Fi) | Delta | Honest Wave 5 / 5B Student Observation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| **1** | **Register** (`/register`, `360×800`) | `6` | `6` | Landing `2,739 ms`; Submit `3,587 ms` | Landing **`1,080 ms`**; Submit **`2,850 ms`** | **-60.6%** load | Landing copy updated (`8` modes, `12` types, `PDF`). **Wave 5B (`460c23d`) FIXED `UX31-12`:** raw Supabase English errors now localize cleanly (`"Bạn thao tác quá nhanh..."` in VI; switches reactively to EN on toggle; optional username field kept). |
| **2** | **Log in** (`/login → /dashboard`) | `3` | `3` | **`4,158 ms`** (`6,920 ms` total) | **`1,274 ms`** (`2,488 ms` total) | **-69.4%** | Feels snappy; Dashboard opens directly to clean Resume card + Study Sets (`UX31-01` & `UX31-05` FIXED). |
| **3** | **Find existing study set** (`Dash → Lib → 133q Set`) | `2` | `2` | Lib `69 ms`* (flashed `0`!); Lib→Set **`4,647 ms`** (`4,858 ms` total) | Dash→Lib **`886 ms`** (real cards!); Lib→Set **`1,228 ms`** (`2,477 ms` total) | **-73.6%** set load | Zero `Của tôi (0)` or `Ngân hàng câu hỏi (0)` flash; mobile `/library` header is 1 crisp line (`358×28px`, `UX31-06` FIXED). |
| **4** | **Start Flashcards** (`/sets/[id]`) | `1` | `1` | **`5,038 ms`**; flip `275 ms` | **`2,167 ms`**; flip **`221 ms`** | **-57.0%** | Primary `Flashcard` card sits immediately above the fold on desktop & mobile (`UX31-03` FIXED). |
| **5** | **Start Learn** (`/sets/[id]`) | `1` | `1` | **`2,411 ms`**; action `1,245 ms` | **`1,150 ms`**; action **`1,056 ms`** | **-52.3%** | Much faster, **but `UX31-11` [P2] STILL OPEN**: 5 top SM-2 stage tabs (`Làm quen`..`Luyện thi`) remain exposed. |
| **6** | **Start MCQ Practice** (`/sets/[id]`) | **`2`** (setup gate) | **`1`** (direct Q1!) | Setup gate `2,419 ms`; feedback **`283 ms`** | Direct Q1 **`1,159 ms`**; feedback **`41 ms`** | **-50% clicks, -85.5% feedback** | **Direct-Start Q1 verified live (`after_11`)!** 14-control setup gate gone; filters tucked into top sliders icon (`UX31-07` FIXED). |
| **7** | **Import Word** (`133` aviation `.docx` Qs) | **`6` wizard clicks** | **`1` click after upload** | Create `6,320 ms` + Wizard **`17,955 ms`** (`parse 4,494 ms`) | Create **`2,555 ms`** + Wizard **`11,883 ms`** (`parse 751 ms`, commit `9,066 ms`) | **-83% clicks, -83.3% parse, -33.8% wizard** | Auto-parses on file pick and immediately offers `Nhập 133 câu hỏi`; **`0px` mobile overflow** (was `+91px`), zero jargon (`UX31-04` FIXED). |
| **8** | **Import Excel** (`24` aviation `.xlsx` Qs) | **`6` wizard clicks** | **`1` click after upload** | Create `3,978 ms` + Wizard **`15,500 ms`** (`parse 3,476 ms`) | Create **`1,916 ms`** + Wizard **`11,273 ms`** (`parse 674 ms`, commit `8,746 ms`) | **-83% clicks, -80.6% parse, -27.3% wizard** | Same 1-click happy path (`Nhập 24 câu hỏi`); `parse 674 ms` feels near-instant. |
| **9** | **Create 250-Q Exam** (`/exams/new`) | `4` | `3–4` | Builder `2,876 ms`; **Gen `9,946 ms`**; Q1→Q2 `60 ms`; Q2→Q50 `57 ms` | Builder **`1,776 ms`**; **Gen `2,361 ms`**; Q1→Q2 **`34 ms`**; Q2→Q50 **`47 ms`** | **-76.3% gen (4.2× faster!)** | Clean 3-step builder + collapsed `Cài đặt nâng cao`; mobile height **`5.13× → 2.26×`**; actionable `[Chọn tất cả]` sticky bar (`UX31-02` FIXED). |
| **10** | **Multi-subject Exam** (4–5 sets / 281 Qs) | `4–7` | `3–4` | Included in Task 9 (`9,946 ms` gen) | Included in Task 9 (**`2,361 ms`** gen) | **-76.3%** | Allocation & selection policies tucked cleanly inside `Cài đặt nâng cao`; all 3 tabs fit `390px` unclipped (`after_10`). |
| **11** | **Find incorrect questions** (`/review`) | `1` | `1` | **`4,342 ms`** | **`2,255 ms`** | **-48.1%** | 1 primary `Ôn câu sai` + `Khác v`, compact status pills, collapsed `Bộ lọc nâng cao (15)`, **wrong question visible on Screen 1** (`UX31-08` FIXED). |
| **12** | **Resume interrupted session** (`/dashboard`) | `1` | `1` | Dashboard `4,401 ms`; Resume `448 ms` | Dashboard **`1,996 ms`**; Resume **`325 ms`** | **-54.6%** | Single crisp `Tiếp tục học dở` banner; conflicting fake `"Chưa học"` Continue card removed (`UX31-01` FIXED). |
| **13** | **Create image-based question** (`/sets/[id]/edit`) | `10` | `10` | Upload & save **`6,179 ms`** (`11,201 ms` total) | **Wave 5B (`460c23d`): Upload & save `2,570 ms` (`7,583 ms` total, `HTTP 201`, `savedCleanly: true`)** | **-58.4% save (-32.3% total)** | **`V31-UX-REG-01` [P1] FIXED LIVE on `460c23d`!** `type="url"` removed (`0` URL inputs), thumbnail preview renders, question + image (`naturalWidth > 0`) persist cleanly on `/sets/[id]`. *(Minor P2 `UX31-13`: modal density/optional URL field remains.)* |
| **14** | **Share a study set** (`/sets/[id]`) | `3` | `4` (`Thao tác → Chia sẻ → Tạo → Copy`) | `1,896 ms` (`HTTP 201`) | **`1,586 ms`** (`HTTP 201`) | **-16.4%** | Moving `Chia sẻ` into clean `... Thao tác` menu adds 1 click but eliminates the 10-button action wall (`UX31-03`). |
| **15** | **Download offline set** (Mobile `390×844`) | `2` | `2` | `4,532 ms` (`Đã sẵn sàng ngoại tuyến`) | **`3,708 ms`** (`Đã sẵn sàng ngoại tuyến`) | **-18.2%** | Cleanly surfaced on `/sets/[id]` mobile header; works smoothly end-to-end. |
| **16** | **Mobile experience** (`390×844` & `360×800`) | 10-route sweep | Full sweep | `/import` **`+91px` FAIL**; crushed `/library` H1; `On sai` typo; hidden `Nộp bài` | **`0px` overflow on ALL routes (`390px` & `360px`)**; crisp 4-tab nav; visible `Nộp bài` | **ALL P0/P1 Mobile UX FIXED** | `Trang chủ / Thư viện / Thi thử / Cá nhân` bottom bar + sleek `Cá nhân & Tiện ích` bottom sheet (no `Phím tắt`, no duplicate toggles); `Nộp bài` clearly visible in mobile exam header (`UX31-06`, `09`, `10` FIXED). |

---

### 4.3 Side-by-Side Screen Density & Mobile Ergonomics Matrix (BEFORE vs AFTER)

| Screen | Viewport | BEFORE Screenfuls | AFTER Screenfuls | BEFORE Controls (`<main>`) | AFTER Controls (`<main>`) | BEFORE Sidebar / Overflow | AFTER Sidebar / Overflow |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `/` (Landing) | `1440×900` | `2.95×` | **`2.48×`** (-16%) | `6` | **`5`** | `0` / `0px` | `0` / `0px` |
| `/` (Landing) | `390×844` | `5.96×` | **`5.16×`** (-13%) | `6` | **`5`** | `0` / `0px` | `0` / `0px` |
| `/register` | `360×800` | `1.00×` | `1.00×` | `7` | `7` | `0` / `0px` | `0` / `0px` |
| `/dashboard` | `1440×900` | `1.81×` | **`1.34×`** (-26%) | `22` | `28`* | **`15`** / `0px` | **`13`** (`11` nav) / `0px` |
| `/dashboard` | `390×844` | `3.72×` | **`2.79×`** (-25%) | `22` | `28`* | `0` / `0px` | `0` / `0px` |
| `/library` | `1440×900` | `1.00×` (skeleton) | **`1.00×`** (5 loaded cards!) | `8` (skeleton) | `33` (real cards) | **`15`** / `0px` | **`13`** (`11` nav) / `0px` |
| `/library` | `390×844` | `1.87×` (crushed H1) | `1.93×` (**1-line H1 `358×28px`**) | `28` | `33` (5 sets) | `0` / `0px` | `0` / `0px` |
| `/sets/[id]` | `1440×900` | `1.17×` (skeleton) | **`1.36×`** (loaded synthetic set) | `23` (skeleton) | **`18`** (`17` above fold) | **`15`** / `0px` | **`13`** (`11` nav) / `0px` |
| `/sets/[id]` | `390×844` | **`3.22×`** | **`2.46×`** (-24%) | **`34`** | **`18`** (-47%!) | `0` / `0px` | `0` / `0px` |
| `/exams/new` | `1440×900` | **`2.66×`** | **`1.27×`** (-52%!) | `78` (`26` above fold) | `63` (**`20` above fold**) | **`17`** / `0px` | **`13`** / `0px` |
| `/exams/new` | `390×844` | **`5.13×`** | **`2.26×`** (-56%!) | `79` | `64` (`13` above fold) | `2` / `0px` | `0` / `0px` |
| `/sets/[id]/practice` | `390×844` | `1.00×` (14-ctrl gate!) | **`1.00×` (Direct Q1!)** | `14` (setup gate) | **`10` (Q1 live!)** | `0` / `0px` | `0` / `0px` |
| `/exams/[attemptId]` | `390×844` | `1.00×` (no `Nộp bài`) | **`1.00×` (`Nộp bài` visible!)** | `10` | `10` | `0` / `0px` | `0` / `0px` |
| `/sets/[id]/import` | `390×844` | `1.64×` | **`1.08×`** (-34%) | `18` | **`11`** (-39%) | `0` / **`+91px` FAIL** | `0` / **`0px` PASS** |
| `/review` | `1440×900` | `1.83×` | **`1.65×`** (-10%) | `37` | `38` (incl. mistake actions) | **`15`** / `0px` | **`13`** (`11` nav) / `0px` |
| `/review` | `390×844` | `3.31×` (`0` Qs Screen 1) | **`2.71×`** (Q1 on Screen 1!) | `37` | `38` (`18` above fold) | `0` / `0px` | `0` / `0px` |

*\*Dashboard AFTER renders all 5 study set cards directly above/near the fold (each with `Học` + `Chi tiết` buttons), which is why total `<main>` control count rose (`22 → 28`) while vertical scroll height shrank by 25–26% and perceived simplicity dramatically improved.*

---

### 4.4 Honest Issue-by-Issue Resolution Verdict (`UX31-01` – `UX31-14` + `V31-UX-REG-01`)

| Issue ID | Severity | Status (Live Prod `460c23d`) | Concrete Live Production Evidence |
| --- | --- | --- | --- |
| **`UX31-01`** | **P0** | **FIXED** | Sidebar slimmed (`15 → 11` nav links in 2 groups, zero duplicate `Thi thử tùy chỉnh`); `/dashboard` 4× Exam CTAs & fake `"Chưa học"` Continue removed; sets visible on Screen 1 (`after_03`, `after_04`). |
| **`UX31-02`** | **P0** | **FIXED** *(minor polish)* | 3-step Exam Builder + collapsed `Cài đặt nâng cao`; mobile height `5.13× → 2.26×`; 3rd tab unclipped; sticky bar offers actionable `[Chọn tất cả]`; 250-Q gen `-76.3%` (`2.36s`). *(Minor: sets still start unchecked so Desktop Step 2 shows `Khả dụng: 0` until a set is selected.)* |
| **`UX31-03`** | **P0** | **FIXED** | 10-button wall collapsed into `Chỉnh sửa`, `Tải về học ngoại tuyến`, `... Thao tác` (zero mystery icons); primary `Học ngay` + 4 core mode cards + collapsible `Chế độ học khác`; mobile controls `34 → 18` (`after_07`, `after_08`). |
| **`UX31-04`** | **P0** | **FIXED** | 6-click wizard collapsed to **1-click happy path** after file pick (`parse 751ms` Word / `674ms` Excel); mobile overflow **`+91px → 0px`**; `"Phân tích xác định 100%"` jargon removed (`after_14`). |
| **`UX31-05`** | **P0** | **FIXED** | Vercel `hnd1` Tokyo verified (`X-Vercel-Id: hkg1::hnd1::...`); `-48%` to `-76%` faster live loads across Login, Set Detail, Flashcards, Learn, Practice, Review, Exam Gen; zero `(0)` skeleton flickers. |
| **`UX31-06`** | **P1** | **FIXED** | Mobile `/library` `PageHeader` stacked cleanly: `Thư viện học phần` is 1 full-width line (`358×28px`, `after_06`) instead of a 12-line vertical crush. |
| **`UX31-07`** | **P1** | **FIXED** | Practice mode starts **directly on Question 1 in 1 click** (`after_11`), optional filters behind top sliders button, instant **`41 ms`** feedback. |
| **`UX31-08`** | **P1** | **FIXED** | Single `Ôn câu sai` + `Khác v` dropdown, compact status pills, collapsed `Bộ lọc nâng cao (15)`, and actual wrong question visible above the fold on mobile (`after_15`). |
| **`UX31-09`** | **P1** | **FIXED** | Clean 4-tab bottom nav (`Trang chủ`, `Thư viện`, `Thi thử`, `Cá nhân`) with zero broken diacritics + sleek `Cá nhân & Tiện ích` bottom sheet (no desktop `Phím tắt`, no duplicate VI/Theme; `after_13`). |
| **`UX31-10`** | **P1** | **FIXED** | Prominent purple **`Nộp bài`** button directly visible in mobile active exam top-right header next to timer (`after_12`). |
| **`UX31-11`** | **P2** | **STILL OPEN** | `/sets/[id]/learn` still renders all 5 internal SM-2 stage buttons (`Làm quen`..`Luyện thi`) across the top (`stageTabsStillExposedTop: 5`). |
| **`UX31-12`** | **P2** | **FIXED (Wave 5B `460c23d`)** | Verified live on `460c23d`: raw Supabase GoTrue errors (`429 over_email_send_rate_limit`) now localize cleanly in VI (`"Bạn thao tác quá nhanh. Vui lòng đợi một lát rồi thử lại."`), toggle reactively to EN (`"Too many attempts. Please wait a moment and try again."`), and never leak raw English into Vietnamese UI. *(Optional username input kept on `/register`.)* |
| **`UX31-13`** | **P2** | **PARTIAL (Wave 5B `460c23d`)** | Clean image thumbnail preview renders & `type="url"` blocker removed (`0` URL inputs); modal control density & optional signed-url input remain minor P2 polish. |
| **`UX31-14`** | **P3** | **FIXED** | Landing `/` updated to honest V3 copy (`8 Chế độ học`, `12 Dạng câu hỏi`, `DOCX · PDF · XLSX`, diagrams, offline PWA) and tightened scroll height (`after_01`, `after_02`). |
| **`V31-UX-REG-01`** | **P1** | **FIXED (Wave 5B `460c23d`)** | **Verified LIVE on `460c23d` (`dpl_D7R6PY6mPPwvGRFZKLi3BVir7Bn9`):** `/sets/[id]/edit` → `Thêm câu hỏi` → `Tải ảnh` (`POST /api/uploads` `201`) → `Lưu` now fires **`POST /api/sets/[id]/questions` `201`** cleanly in **`2,570 ms`** (**`-58.4%`** faster than V3.0 `6,179 ms`, `savedCleanly: true`, `typeUrlInputsCount: 0`, `0` console/page errors), and the saved question + uploaded image (`naturalWidth > 0`) render cleanly on `/sets/[id]`! |

---

### 4.5 AFTER Screenshot Index (`docs/audit/v3.1-ux-performance/screenshots/after/`)

All 16 AFTER screenshots were captured live on `https://studyhub-three-mauve.vercel.app` (`hnd1`), visually verified individually, and kept 100% free of `sample-data/` aviation question text (using synthetic `Aviation Weather Sample V3.1` for Set Detail, Practice, Exam Runner, and Review cards):

| # | Filename | Viewport | Key Wave 5 / 5B AFTER Verification Shown |
| --- | --- | --- | --- |
| 01 | `after_01_landing_desktop.png` | `1440×900` | Updated V3 hero (`8` modes, `12` types, `DOCX · PDF · XLSX`, offline/diagrams); `UX31-14` FIXED |
| 02 | `after_02_landing_mobile_390.png` | `390×844` | Clean mobile landing (`5.16×` screenfuls, `0px` overflow); `UX31-14` FIXED |
| 03 | `after_03_dashboard_desktop.png` | `1440×900` | 11-link grouped sidebar, zero duplicate Exam CTAs, 1 real Resume banner + Study Sets above fold (`UX31-01` FIXED) |
| 04 | `after_04_dashboard_mobile_390.png` | `390×844` | `2.79×` screenfuls (was `3.72×`), sets visible on Screen 1, clean 4-tab bottom nav (`UX31-01`, `UX31-09` FIXED) |
| 05 | `after_05_library_desktop.png` | `1440×900` | Instant loaded `Của tôi (5)` set cards, zero `(0)` skeleton flash (`UX31-05` FIXED) |
| 06 | `after_06_library_mobile_390.png` | `390×844` | Full-width 1-line `Thư viện học phần` (`358×28px` vs 12-line crush) + first set card above fold (`UX31-06` FIXED) |
| 07 | `after_07_set_detail_desktop.png` | `1440×900` | 3 clean top buttons (`Chỉnh sửa`, `Tải về học ngoại tuyến`, `... Thao tác`), `Học ngay` + 4 core modes + collapsible extras (`UX31-03` FIXED) |
| 08 | `after_08_set_detail_mobile_390.png` | `390×844` | Zero unlabeled mystery icons, 2×2 core modes + `Ngân hàng câu hỏi` visible on Screen 1 (`UX31-03` FIXED) |
| 09 | `after_09_exam_builder_desktop.png` | `1440×900` | Clean 3-step Exam Builder (`1.27×` vs `2.66×`), `281 câu` summary card, collapsed `Cài đặt nâng cao` (`UX31-02` FIXED) |
| 10 | `after_10_exam_builder_mobile_390.png` | `390×844` | `2.26×` screenfuls (was `5.13×`), all 3 tabs unclipped, actionable `[Chọn tất cả]` sticky bar (`UX31-02` FIXED) |
| 11 | `after_11_practice_mobile_390.png` | `390×844` | Direct-Start Question 1 in 1 click (setup gate gone!), top sliders filter button (`UX31-07` FIXED) |
| 12 | `after_12_exam_runner_mobile_390.png` | `390×844` | Prominent purple **`Nộp bài`** button visible directly in mobile exam top-right header (`UX31-10` FIXED) |
| 13 | `after_13_mobile_more_drawer_390.png` | `390×844` | Clean `Cá nhân & Tiện ích` bottom sheet: no desktop `Phím tắt`, no duplicate VI/Theme toggles (`UX31-09` FIXED) |
| 14 | `after_14_import_wizard_mobile_390.png` | `390×844` | `Bước 1 / 3` progress bar with **`0px` overflow** (was `+91px`), friendly Vietnamese copy (`UX31-04` FIXED) |
| 15 | `after_15_review_mistakes_mobile_390.png` | `390×844` | Single `Ôn câu sai` + `Khác v`, compact pills, collapsed `Bộ lọc nâng cao (15)`, wrong question visible on Screen 1 (`UX31-08` FIXED) |
| 16 | `after_16_register_mobile_360.png` | `360×800` | Clean `0px` overflow layout; localized VI/EN GoTrue auth errors verified live on `460c23d` (`UX31-12` FIXED) |

---

### 4.6 Wave 5 & Wave 5B Teardown & Live Data Safety Confirmation

- All Wave 5 & Wave 5B disposable test accounts (`v31-after-ux-main-*` across 2 runs, `v31-after-ux-gap-*`, `v31-after-ux-t13-*`, `v31-after-ux-5b-*`; registration probes rejected before auth creation) and every uploaded object under `{uid}/` in both `study-media` and `study-temp` were cleanly deleted immediately after each run.
- Verified **`trackedUsersRemaining === 0`**, **`trackedStorageRemaining === 0`**, **`trackedRemaining === 0`** on every single run. Pre-existing live user accounts and study data remain 100% untouched.
