# StudyHub V2.0 — Independent Real User & Student UX Audit Report

- **Auditor Role:** Agent 3 — Independent Real User / Aviation & University Student
- **Test Method:** Live browser walkthrough ONLY (headless Chromium via Playwright against production build `npx next start -p 3011`), strictly zero source-code (`src/*`) or V1.0 report inspection prior to testing.
- **Test Date:** 2026-11-24
- **Viewports Tested:** Desktop (`1440×900`), Mobile iPhone 14 (`390×844`), Compact Android (`360×800`)
- **Modes Tested:** Light Mode & Dark Mode, Vietnamese (`vi`, default) & English (`en`), Keyboard-only Tab navigation, Touch ergonomics
- **Server Cleanup:** Production server on port `3011` cleanly stopped and verified (`PORT_3011_FREE`).

---

## 1. Executive Summary (Student Perspective)

If I were an aviation or university student opening StudyHub tonight to import my 4 Meteorology question banks (`DOCX`/`XLSX`) and grind 50-question timed mock exams across chapters before next week's checkride:

1. **First impression is visually calm and promising:** The landing page (`/`) loads fast (`~799ms`), has zero horizontal overflow even on a `360px` Android phone, uses a clean academic Indigo/Slate palette (no clutter, no neon, no emoji icons), and **Dark Mode** looks genuinely comfortable for late-night studying.
2. **Immediate wall on Click #1 ("Tạo tài khoản miễn phí"):** Clicking Sign Up takes me to `/register` where **every input and button is disabled** underneath an amber developer error telling me to set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local`. A normal student has no idea what Supabase or `.env.local` is — it feels broken, not gracefully offline, and there is zero interactive sample deck or guest preview to try out the app.
3. **Unauthenticated app shell & V2.0 feature reality check:** Because the app does not redirect unconfigured/signed-out users away from protected routes, I was able to walk through the full authenticated shell (`/dashboard`, `/library`, `/sets/new`, `/review`, `/starred`, `/history`, `/statistics`, `/friends`, `/shared`, `/profile`, `/settings`) AND test V2.0 custom exam paths directly:
   - **BLOCKED by external environment (no live Supabase DB):** Registering/logging in, saving sets, importing files to DB, running live sessions, saving progress, adding friends, redeeming share links (every `/api/*` call returns `503 SUPABASE_NOT_CONFIGURED`).
   - **GENUINELY MISSING OR BROKEN in the app itself (even with a live DB):**
     - `/exams/new` and `/exams` return **raw English Next.js `404`** (`This page could not be found.`).
     - Sidebar `Thi thử` merely routes to `/library?action=test` (pick **one** single study set) — **no multi-subject exam builder**, **no arbitrary cross-set question count or allocation strategies**, **no Full Coverage non-repeating exam cycles**, and **no saved exam presets**.
     - Quick-create `+ Tạo mới -> Nhập từ file` routes to `/library?action=import`, which **silently ignores** `?action=import` and shows the plain library screen with no file picker or import prompt; `/import` and `/folders` return raw English `404`.
     - Creating a study set from a file forces a 2-step metadata form (`/sets/new`) *before* you can drop your `.docx`/`.xlsx`/`.txt` file — slower than Quizlet & EduQuiz.
     - Mobile bottom nav (`390×844`) **overlaps/clips** content buttons near the bottom, truncates 3 Vietnamese menu labels in the `Thêm` sheet, hides `Thi thử` out of the bottom tabs, and has several small touch targets (`24×24px` password toggle, `32–36px` header buttons & auth inputs).

---

## 2. Real User Scenarios Audit Table (Scenarios 1–8)

Honest separation between **Environment Blockers** (no live Supabase credentials / Docker DB configured in `.env.local`) and **App-Level Missing / Broken UX**.

| # | Real Student Scenario | Status | Environment Blocker (No Live Supabase) | App-Level Missing / Broken UX Found |
| :-: | :--- | :--- | :--- | :--- |
| **1** | **Onboarding & Auth** (`/` -> `/register` -> `/login` -> `/forgot-password` -> `/dashboard`) | **BLOCKED + UX DEFECTS** | Cannot submit real registration, login, Google OAuth, or password reset (`503` / disabled auth forms). | Raw developer env-var banner (`NEXT_PUBLIC_SUPABASE_URL`, `.env.local`) shown to students; password eye icon (`24×24px`) stays active while input is disabled; no `<h1>` on auth pages; `/dashboard` renders unauthenticated shell instead of redirecting to `/login`; mobile header on `/` hides `Đăng nhập`; landing uses engineering jargon (`UUID`, `RLS`, `danh sách ảo hóa`). |
| **2** | **Bulk Import Real Question Banks** (`.docx`, `.xlsx`, `.csv`, `.txt`, Quizlet TSV) | **BLOCKED + UX FRICTION** | Cannot create a set or persist parsed questions (`/api/sets` returns `503`; `/sets/[id]/import` shows unconfigured DB error). | `+ Tạo mới -> Nhập từ file` links to `/library?action=import`, which **ignores** `action=import` and shows no import dropzone or guidance; `/import` is a raw `404`; `/sets/new` requires filling a 7-field form *before* uploading a file (no drop-file-first flow with auto-title from filename). |
| **3** | **Library, Folders, Search & Editing** (`/library`, `/folders`, `/sets/new`, `/sets/[id]/edit`) | **BLOCKED + UX DEFECTS** | `/api/folders` and `/api/sets` return `503` (retried 2× each). | `/folders` returns raw English `404` (only `/library?create=folder` opens a modal); `/library` shows **3 primary Indigo Create buttons** AND **2 identical search boxes** simultaneously; `/sets/new` shows raw English `503` toast inside Vietnamese UI (though typed title *is* preserved). |
| **4** | **Daily Active Study Modes** (`Flashcards`, `Learn SM-2`, `Practice`, `Write`, `Match`) | **BLOCKED (Runtime) + MINOR UX** | All 5 study mode routes (`/sets/[id]/flashcards\|learn\|practice\|write\|match`) fail with 8× `503` API calls. | Focus header on `/sets/[id]/*` lacks quick Theme/Language toggles; error card exposes raw English `.env.local` message; sidebar `Flashcards` & `Ngân hàng câu hỏi` merely filter `/library?type=...` rather than offering quick-resume of recent decks. |
| **5** | **Custom Multi-Subject & Arbitrary-Length Timed Mock Exam** (`/exams/new`, allocation strategies, presets) | **NOT IMPLEMENTED / BROKEN** | DB exam persistence also blocked (`503`). | **App-level missing feature:** `/exams/new` and `/exams` return **raw English `404`**. Sidebar `Thi thử` goes to `/library?action=test` (single-set picker only). Zero UI for picking multiple sets/subjects, setting arbitrary question counts across sets, choosing allocation strategies (A–E) or selection policies, or saving/reusing Exam Presets. |
| **6** | **Full Coverage Non-Repeating Exam Cycle** (Split 133–600+ Q bank into sequential non-overlapping exams) | **NOT IMPLEMENTED** | DB persistence also blocked (`503`). | **App-level missing feature:** Zero UI entry point, dashboard card, sidebar item, or wizard step for Full Coverage cycles (e.g., `50Q × N` until 100% coverage without repeats, cycle progress tracker, next-exam launcher, or cycle restart). |
| **7** | **Mistake Bank, SM-2 Queue, Starred, History & Statistics** (`/review`, `/starred`, `/history`, `/statistics`) | **BLOCKED (Runtime) + MINOR UX** | `/api/mistakes`, `/api/progress/due`, `/api/starred`, `/api/exams`, `/api/sessions`, `/api/statistics` all return `503` (retried 2× each = 2–6 console errors/page). | Clean visual layouts on `/review`, `/starred`, `/history`, `/statistics` (notably `/review` & `/starred` show cleaner Vietnamese card errors than `/history` & `/statistics`, which leak English `.env.local`). No direct "Tạo đề thi từ câu sai / câu gắn sao" (build custom exam from mistakes/starred) CTA yet. |
| **8** | **Friends, Sharing, Settings, Mobile & Accessibility** (`/friends`, `/shared`, `/share/[token]`, `/profile`, `/settings`) | **BLOCKED (Runtime) + UX DEFECTS** | `/api/friends`, `/api/profile`, `/api/preferences`, `/api/share-links/[token]/redeem` return `503`. | Clicking `"Mở học phần được chia sẻ"` on `/share/[token]` leaks raw English `.env.local` error; `/profile` highlights `Cài đặt` in sidebar; mobile `390×844` bottom nav clips bottom content button (`Thử lại`); `Thêm` sheet truncates 3 Vietnamese labels; `<title>` and skip-link stay Vietnamese in `EN` mode. |

---

## 3. Direct Route & Navigation Audit Matrix

All routes tested directly in headless Chromium on Desktop (`1440×900`) without an authenticated session:

| Requested Route | HTTP Status | Redirected? | Load Time | H1 / Main State Observed | Console / API Errors |
| :--- | :---: | :---: | :---: | :--- | :--- |
| `/` | `200` | No | `799ms` | Landing page (`Tự học, ôn flashcard...`) | `0` |
| `/register` | `200` | No | fast | Register card — **all inputs & submit disabled**, amber Supabase dev banner, **no `<h1>`** | `0` |
| `/login` | `200` | No | fast | Login card — **all inputs & submit disabled**, amber Supabase dev banner, **no `<h1>`** | `0` |
| `/forgot-password` | `200` | No | fast | Reset card — **email & submit disabled**, amber Supabase dev banner, **no `<h1>`** | `0` |
| `/dashboard` | `200` | **No** | `871ms` | Full app shell + **duplicate** Supabase dev errors + useless `Thử lại` | `2× 503` (`/api/dashboard`) |
| `/library` | `200` | **No** | `710ms` | Full app shell (`Thư viện học phần`), 3 Create buttons, 2 search bars | `4× 503` (`/api/folders`, `/api/sets`) |
| `/library?type=multiple_choice` | `200` | No | fast | `Ngân hàng câu hỏi` (filtered library) | `4× 503` |
| `/library?type=flashcards` | `200` | No | fast | `Flashcards` (filtered library) | `4× 503` |
| `/library?action=test` | `200` | No | fast | `Chọn học phần thi thử` (single-set picker banner; 4 Create buttons visible!) | `4× 503` |
| `/library?action=import` | `200` | No | fast | **Silently ignores `action=import`** -> plain `Thư viện học phần` | `4× 503` |
| `/sets/new` | `200` | **No** | `681ms` | `Tạo học phần mới` 7-field form; submit keeps input, pops English `503` toast | `3× 503` (`/api/folders`, `/api/sets`) |
| `/sets/[id]` | `200` | **No** | `1124ms` | App shell; slow empty/error resolution | `503`s |
| `/sets/[id]/import` | `200` | **No** | fast | `Chưa cấu hình kết nối Supabase` + English `.env.local` + `Quay lại Tổng quan` | `0` (server-rendered guard) |
| `/sets/[id]/edit` | `200` | **No** | fast | `Không thể mở trình chỉnh sửa` + English `.env.local` | `6× 503` |
| `/sets/[id]/flashcards\|learn\|practice\|write\|match` | `200` | **No** | `739ms` | Focus header + `Không thể tải dữ liệu học phần` + English `.env.local` | `8× 503` each |
| `/sets/[id]/test` | `200` | **No** | `728ms` | `Thiết lập bài thi` + `Không thể tải dữ liệu học phần` + English `.env.local` | **`12× 503`** |
| `/review` | `200` | **No** | `762ms` | `Ôn tập & Câu hỏi đã sai` (stat cards + filters + clean Vietnamese error) | `6× 503` |
| `/starred` | `200` | **No** | `686ms` | `Câu hỏi đánh dấu sao` (search + filters + clean Vietnamese error) | `4× 503` |
| `/history` | `200` | **No** | `687ms` | `Lịch sử học tập & Thi thử` + English `.env.local` error | `4× 503` |
| `/statistics` | `200` | **No** | `663ms` | `Thống kê học tập` (7/30/90d tabs) + English `.env.local` error | `2× 503` |
| `/friends` | `200` | **No** | `693ms` | `Bạn bè & Chia sẻ` + English `.env.local` error | `3× 503` |
| `/shared` | `200` | **No** | `663ms` | `Được chia sẻ với tôi` + English `.env.local` error | `2× 503` |
| `/profile` | `200` | **No** | `666ms` | `Không thể tải hồ sơ cá nhân` + English `.env.local`; **wrong sidebar highlight (`Cài đặt`)** | `2× 503` |
| `/settings` | `200` | **No** | `697ms` | `Cài đặt` (`Tùy chọn học tập` & `Tài khoản` tabs render cleanly, `Hồ sơ` button) | `1× 503` (`/api/preferences`) |
| `/share/invalid-demo-token` | `200` | No | `588ms` | `Liên kết chia sẻ học phần`; clicking button shows English `503` `.env.local` error | `1× 503` on click |
| **`/exams/new`** | **`404`** | No | `576ms` | **Raw default Next.js English `404 This page could not be found.`** | `1× 404` |
| **`/exams`** | **`404`** | No | `535ms` | **Raw default Next.js English `404 This page could not be found.`** | `1× 404` |
| **`/folders`** | **`404`** | No | `562ms` | **Raw default Next.js English `404 This page could not be found.`** | `1× 404` |
| **`/import`** | **`404`** | No | fast | **Raw default Next.js English `404 This page could not be found.`** | `1× 404` |

---

## 4. Concrete UX Bugs & Friction Log (P0–P4)

### [P0] UX-01 — Custom Exam Builder (`/exams/new`), Multi-Subject Exams & Full Coverage Are Completely Missing
- **URL / Viewport:** `/exams/new`, `/exams`, `/library?action=test` (`1440×900` & `390×844`)
- **Steps to Reproduce:**
  1. Navigate directly to `http://localhost:3011/exams/new` (or `/exams`).
  2. Alternatively, open `/dashboard` and click `Thi thử` in the left sidebar.
- **Expected (Student / V2.0):** A dedicated Universal Custom Exam Builder letting me select 1 or multiple subjects/chapters (e.g., Meteorology 01 + 05 + 08), choose any question count (50 / 100 / 250 / 500), pick allocation & question selection policies, enable Full Coverage non-repeating cycles, or launch a saved preset.
- **Actual:** `/exams/new` and `/exams` return a blank white English **`404 | This page could not be found.`** page. Sidebar `Thi thử` redirects to `/library?action=test`, which only supports selecting one single study set.
- **Screenshots:**
  - `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\09_exams_new_desktop.png`
  - `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\app_library_test_mode_desktop.png`

---

### [P1] UX-02 — Non-Technical Students Are Shown Raw Developer Environment Variables & Locked Out Forms
- **URL / Viewport:** `/register`, `/login`, `/forgot-password`, `/dashboard`, `/library`, `/sets/new`, `/share/invalid-demo-token` (`1440×900` & `390×844`)
- **Steps to Reproduce:**
  1. Open `/` and click `Tạo tài khoản miễn phí`.
  2. Try to type your name/email or submit on `/register`.
  3. Open `/dashboard` or submit a set name on `/sets/new`.
- **Expected:** Plain-language Vietnamese/English service-status message for students (e.g., *"Hệ thống máy chủ học tập đang tạm bảo trì. Vui lòng thử lại sau."*), hiding `.env.local` and `NEXT_PUBLIC_SUPABASE_*` behind a collapsed technical details toggle or server logs only; ideally an interactive local preview or clear status card without repeating the banner twice.
- **Actual:**
  - All inputs & submit buttons on `/register`, `/login`, and `/forgot-password` are hard-disabled behind an amber developer box referencing `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `.env.local`.
  - On `/dashboard`, the exact same developer message appears **twice** (top banner in Vietnamese + center card in English) with a `"Thử lại"` button that triggers another `503`.
  - On `/sets/new` and `/share/[token]`, submitting pops raw English `Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL...` even when the UI is in Vietnamese.
- **Screenshots:**
  - `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\04_register_desktop_vi_light.png`
  - `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\10_dashboard_direct_desktop.png`
  - `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\app_sets_new_error_desktop.png`
  - `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\app_sets_new_desktop.png`

---

### [P1] UX-03 — Protected App Routes Do Not Redirect Unauthenticated Visitors & Quick-Create `Nhập từ file` Is a Dead-End
- **URL / Viewport:** `/dashboard`, `/library`, `/library?action=import`, `/sets/new`, `/profile`, `/settings` (`1440×900` & `390×844`)
- **Steps to Reproduce:**
  1. In a fresh incognito browser with no session, navigate directly to `/dashboard` or `/library`.
  2. Click top-right `+ Tạo mới` -> `Nhập từ file`.
- **Expected:**
  - Unauthenticated access to private app routes redirects cleanly to `/login?next=/dashboard` (or shows a clear sign-in gate rather than a fake `"U Tài khoản"` logged-in chrome with a `"Đăng xuất"` button).
  - Clicking `+ Tạo mới -> Nhập từ file` opens a file dropzone / import wizard directly (or clearly guides the student to pick/create a target set and upload).
- **Actual:**
  - Every private route renders the full authenticated sidebar + `"U Tài khoản"` avatar + `"Đăng xuất"` action while firing 2–12 `503` errors per page.
  - Clicking `+ Tạo mới -> Nhập từ file` navigates to `/library?action=import`, which renders the plain `Thư viện học phần` heading with **zero** import callout, **zero** file dropzone, and **zero** hint of what to do next!
  - Meanwhile, `/sets/new` requires completing a 7-field metadata form before accessing file upload — high friction compared to EduQuiz/Quizlet.
- **Screenshots:**
  - `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\app_mobile_drawer_390.png`
  - `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\app_sets_new_desktop.png`

---

### [P2] UX-04 — Mobile Bottom Nav Clips Page Content (`Thử lại` Button Cut Off) & Truncates Labels in `Thêm` Sheet
- **URL / Viewport:** `/library` on Mobile `390×844`
- **Steps to Reproduce:**
  1. Open `http://localhost:3011/library` at `390×844`.
  2. Look at the bottom of the error card right above the sticky bottom navigation bar.
  3. Tap `Thêm` in the bottom-right corner of the bottom nav bar.
- **Expected:** Comfortable bottom padding (`pb-24` + safe-area inset) so buttons never collide with the bottom tab bar; readable Vietnamese labels without ellipsis truncation; localized close-button `aria-label`; direct `Thi thử` tab accessible in 1 thumb tap.
- **Actual:**
  - The `"Thử lại"` button is visibly **overlapped/clipped** by the fixed bottom navigation bar.
  - Inside the `Thêm` sheet, 3 Vietnamese labels are cut off: `Ngân hàng câu...`, `Câu hỏi đánh d...`, `Được chia sẻ v...`.
  - The modal's `X` button has an untranslated English `aria-label` (`Close`) while in Vietnamese mode.
  - Primary exam prep (`Thi thử`) is hidden inside `Thêm` instead of being a first-class bottom tab.
- **Screenshots:**
  - `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\app_library_mobile_390.png`
  - `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\app_mobile_more_sheet_390.png`

---

### [P2] UX-05 — Missing Custom `404` Page Across App (Unstyled English Next.js Fallback)
- **URL / Viewport:** `/exams/new`, `/exams`, `/folders`, `/import`, `/this-page-does-not-exist` (`1440×900` & `390×844`)
- **Steps to Reproduce:** Open any non-existent URL such as `/folders` or `/exams/new`.
- **Expected:** Branded StudyHub 404 screen honoring current language (`vi`/`en`) and theme (`Light`/`Dark`) with 1-click navigation back to `/dashboard`, `/library`, or `/`.
- **Actual:** Stark white screen displaying default English Next.js `404 | This page could not be found.` with no header, no navigation link, and no Dark Mode styling.
- **Screenshot:** `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\09_exams_new_desktop.png`

---

### [P2] UX-06 — Visual Clutter in Library: 3–4 Redundant Create Buttons & 2 Identical Search Inputs
- **URL / Viewport:** `/library` & `/library?action=test` (`1440×900`)
- **Steps to Reproduce:** Open `/library` (Light or Dark mode), then click `Thi thử` (`/library?action=test`).
- **Expected:** One clear primary action per visual hierarchy and one unmistakable search input per page.
- **Actual:**
  - `/library` displays **3 bright Indigo Create buttons** simultaneously (`+ Tạo học phần mới` in sidebar, `+ Tạo mới` in top bar, `+ Tạo học phần mới` in page header) PLUS **2 identical search inputs** stacked one above the other with the exact same placeholder `"Tìm theo tên học phần, môn học..."`.
  - `/library?action=test` adds a **4th** `Tạo học phần mới` button inside the blue info banner.
- **Screenshots:**
  - `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\app_library_desktop_dark.png`
  - `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\app_library_test_mode_desktop.png`

---

### [P2] UX-07 — Mobile Touch Targets Below 44px & Hidden `Đăng nhập` in Mobile Landing Header
- **URL / Viewport:** `/`, `/register`, `/login`, `/library` (`390×844` & `360×800`)
- **Steps to Reproduce:** Inspect interactive element dimensions on `390×844` and `360×800`.
- **Expected:** Touch controls comfortably `>= 44×44px` on mobile; returning students can tap `Đăng nhập` directly from the mobile header without hunting; disabled forms also disable their child password-visibility toggle.
- **Actual:**
  - Password visibility eye button on `/register` & `/login`: **`24×24px`** — AND remains enabled (`disabled: false`) even while the password input itself is disabled!
  - All auth inputs (`text`, `email`, `password`): **`36px`** tall on mobile.
  - Mobile header buttons on `/` & app shell: Theme button **`36×36px`**, `+` quick-create **`36×36px`**, `Đăng ký` **`32px`** tall.
  - `Quên mật khẩu?` link on `/login` mobile: **`16px`** tall directly above the password field (easy mis-tap).
  - Landing page mobile header hides `Đăng nhập` completely (only shows `VI`, Theme icon, and `Đăng ký`).
- **Screenshots:**
  - `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\12_landing_mobile_390_vi_light.png`
  - `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\14_register_mobile_390_dark.png`

---

### [P3] UX-08 — Accessibility & i18n Polish Gaps (Missing `<h1>`, Untranslated `<title>` & Skip Link, Wrong Active Nav on `/profile`)
- **URL / Viewport:** `/`, `/register`, `/login`, `/forgot-password`, `/share/[token]`, `/profile` (`1440×900`)
- **Steps to Reproduce:**
  1. Toggle language from `VI` to `EN` on `/` and navigate to `/register` and `/login`.
  2. Inspect heading tags (`h1`–`h3`), `<title>`, and the skip link text.
  3. Navigate to `/profile` and look at the highlighted sidebar item.
- **Expected:** Every page has exactly one semantic `<h1>`; `<title>` and skip-to-content link update to English when `EN` is selected; `/profile` highlights a Profile item (or no unrelated tab).
- **Actual:**
  - `/register`, `/login`, `/forgot-password`, `/share/[token]` have **zero `<h1>`–`<h3>` elements** (`CardTitle` renders as non-heading text).
  - In `EN` mode (`html[lang="en"]`), document `<title>` stays Vietnamese (`StudyHub — Nền tảng tự học & luyện thi cá nhân`, `Đăng ký | StudyHub`, `Đăng nhập | StudyHub`) and the skip link stays Vietnamese (`Chuyển đến nội dung chính`).
  - `/profile` highlights **`Cài đặt`** in the left sidebar.
- **Screenshots:**
  - `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\02_landing_desktop_en_light.png`
  - `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\app_profile_desktop.png`

---

### [P3] UX-09 — Engineering Jargon on Landing Page & Awkward Mobile KPI Line-Wrapping
- **URL / Viewport:** `/` (`1440×900`, `390×844`, `360×800`)
- **Steps to Reproduce:** Read hero & feature cards on `/` in VI & EN; inspect KPI stats row at `390×844` and `360×800`.
- **Expected:** Clear student-focused benefit language (no database/frontend acronyms) and tidy responsive KPI wrapping.
- **Actual:**
  - Public copy contains developer jargon: `"100% Thuật toán xác định"`, `"Trộn câu hỏi & đáp án theo UUID"`, `"danh sách ảo hóa"`, `"bảo mật RLS"` / `"PostgreSQL RLS"`, plus mixed English/Vietnamese mode names in Vietnamese Step 02 (`"Flashcards, Learn, Practice, Write và Match"`).
  - On `390px` and `360px` mobile screens, the 3rd KPI (`Định dạng nhập/xuất` / `Import formats`) wraps across 2–3 jagged lines with trailing middots (`DOCX ·` / `XLSX ·` / `TXT`).
- **Screenshots:**
  - `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\01_landing_desktop_vi_light.png`
  - `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\15_landing_mobile_360.png`

---

### [P3] UX-10 — Redundant Client Retry Storm on Deterministic `503` Errors
- **URL / Viewport:** All app shell routes (`/dashboard`, `/library`, `/review`, `/sets/[id]/*`)
- **Steps to Reproduce:** Open DevTools Network/Console and navigate to `/sets/00000000-0000-0000-0000-000000000000/test` or `/library`.
- **Expected:** Stop immediately on deterministic `503 SUPABASE_NOT_CONFIGURED` (or `401`/`403`/`404`) instead of retrying and flooding console/network logs.
- **Actual:** Every query retries, producing `4` failing requests on `/library`, `6` on `/review`, `8` on each learning mode, and **`12` failing `503` requests** on `/sets/[id]/test`.

---

## 5. What Already Works Well (Keep & Build On!)

1. **Calm, Distraction-Free Academic Visual Identity:** Clean Indigo/Slate hierarchy, zero neon glow, zero emoji icons in controls, zero visual bloat — genuinely feels like a serious study workspace (Linear/Notion meets Quizlet).
2. **Dark Mode & Language Toggle Reliability:**
   - Theme dropdown (`Sáng` / `Tối` / `Theo hệ thống`) switches cleanly on Desktop and Mobile (`rgb(11, 17, 32)` dark surface with crisp contrast) and persists across reloads.
   - `VI <-> EN` toggle translates visible body content immediately and persists cleanly across reloads.
3. **Zero Horizontal Overflow Across All Tested Viewports:** `1440×900`, `390×844`, and `360×800` all maintained exact `scrollWidth === innerWidth`.
4. **Strong Keyboard Focus Foundations:** Clear Indigo focus rings on interactive elements, working skip-to-content link appearing at `(16, 16)` on first `Tab`, logical Tab order, no focus traps.
5. **Input Preservation on Form Errors:** Submitting `/sets/new` when the API fails keeps the student's typed study set title intact instead of wiping the form.

---

## 6. Actionable Student Recommendations (To Match & Beat Quizlet + EduQuiz)

1. **Make "Tạo đề thi" (`/exams/new`) a First-Class 1-Click Action Everywhere:**
   - Replace the single-set workaround on sidebar `Thi thử` with a real **Custom Exam Builder (`/exams/new`)** + **Quick Test** (1-click 20Q/50Q/100Q) + **Multi-Subject Picker** (check Meteorology 01, 05, 08 together) + **Full Coverage Cycle** ("Split 219 questions into 5 exams of ~45Q with zero repeats") + **Saved Exam Presets**.
   - Put `Thi thử` directly in the Mobile bottom navigation bar (e.g., `Tổng quan | Thư viện | Thi thử | Ôn tập | Thêm`) — students open exam apps on phones specifically to drill tests on the bus or before class!
2. **Adopt a Drop-File-First Instant Import Flow (EduQuiz Speed):**
   - Make `+ Tạo mới -> Nhập từ file` open an instant **Drag & Drop / Paste Import Modal or `/import` page** where dropping `METEOROLOGY-01. THE ATMOSTPHERE (133).docx` auto-fills the set name, runs parsing immediately, shows flagged missing/conflict questions first, and saves set + questions in 1 flow (cutting 4+ clicks down to 2).
3. **Eliminate Unauthenticated Chrome & Developer Jargon:**
   - Redirect unauthenticated visitors on `/dashboard` etc. cleanly to `/login?next=...` once auth is active, and replace `NEXT_PUBLIC_SUPABASE_URL` / `.env.local` in end-user cards/toasts with friendly Vietnamese/English status copy (with technical hint tucked away for dev mode only).
   - Rewrite landing page copy from a student's perspective: replace `Thuật toán xác định`, `trộn theo UUID`, `danh sách ảo hóa`, `PostgreSQL RLS` with student outcomes (*"Chấm điểm đúng 100% theo đáp án gốc"*, *"Đảo câu & đảo đáp án A/B/C/D không bao giờ lệch đáp án"*, *"Mở mượt bộ đề 10.000 câu không giật lag"*, *"Dữ liệu riêng tư chỉ bạn thấy"*).
   - Add a **0-signup interactive demo card** on `/` (1 live sample flashcard + 1 live MCQ question) so students can feel StudyHub's speed in 3 seconds before registering.
4. **De-duplicate Library Controls & Fix Mobile Polish:**
   - Keep **one** global search bar (or hide topbar search on `/library`) and **one** primary Indigo Create button per screen (make secondary create buttons outline/ghost).
   - Add `pb-24` bottom clearance on mobile app pages so nothing is ever hidden under the bottom nav bar; shorten mobile `Thêm` grid labels (`Ngân hàng đề`, `Câu gắn sao`, `Được chia sẻ`) so zero text truncates; bump mobile auth inputs & icon buttons to `>= 44px` hit areas.
   - Add a branded, bilingual, Light/Dark-aware `not-found.tsx` page and dynamic localized document titles + skip link text.

---

## 7. Evidence Screenshots Index

All full-window screenshots captured directly from the live app on `http://localhost:3011`:

- Desktop Landing (VI Light): `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\01_landing_desktop_vi_light.png`
- Desktop Landing (EN Light): `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\02_landing_desktop_en_light.png`
- Desktop Landing (VI Dark): `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\landing_desktop_vi_dark.png`
- Mobile Landing 390px (VI Light): `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\12_landing_mobile_390_vi_light.png`
- Mobile Landing 390px (VI Dark): `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\landing_mobile_390_vi_dark.png`
- Mobile Landing 360px (EN Light, KPI wrap): `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\15_landing_mobile_360.png`
- Register Page (Desktop VI Light, disabled form + dev banner): `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\04_register_desktop_vi_light.png`
- Register Page (Desktop VI Dark): `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\register_desktop_vi_dark.png`
- Login Page (Desktop VI Light): `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\06_login_desktop_vi_light.png`
- Forgot Password (Desktop VI Light): `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\08_forgot_password_desktop.png`
- `/exams/new` Raw English 404: `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\09_exams_new_desktop.png`
- `/dashboard` Unauthenticated Shell & Double Dev Banner: `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\10_dashboard_direct_desktop.png`
- `/library` Desktop Dark (3 Create CTAs + 2 Search Bars): `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\app_library_desktop_dark.png`
- `/library?action=test` Single-Set Test Picker (4 Create CTAs): `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\app_library_test_mode_desktop.png`
- `/sets/new` Submit Error Toast (English dev text in VI UI): `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\app_sets_new_error_desktop.png`
- `/library` Mobile 390px (Bottom Nav Clipping `Thử lại`): `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\app_library_mobile_390.png`
- Mobile `Thêm` Sheet 390px (Truncated Labels): `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\app_mobile_more_sheet_390.png`
- `/review` Desktop Light: `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\app_review_desktop.png`
- `/settings` Desktop Light: `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\app_settings_desktop.png`
- `/profile` Desktop Light (Wrong `Cài đặt` Sidebar Active State): `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\app_profile_desktop.png`
- `/share/invalid-demo-token` Desktop Light: `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\11_share_invalid_desktop.png`


---

## 8. Wave 3 Independent Live Browser Retest (BEFORE vs AFTER Verdicts)

- **Retest Method:** Fresh live Chromium Playwright audits against the rebuilt V2.0 `.next` production server on dedicated port `3011` (`npx next start -p 3011`), across Desktop (`1440×900`), Mobile iPhone 14 (`390×844`), Compact Android (`360×800`), Light & Dark Mode, Vietnamese & English, Keyboard Tab traversal, and `prefers-reduced-motion: reduce`.
- **Two-Pass Verification:**
  - **Pass 1 (Post-Wave 2 build, #61):** Verified major fixes (`UX-01` routes, `UX-02`, `UX-03`, `UX-05`, `UX-08`, `UX-09`, `UX-10`) AND caught **1 P1 live-browser visual regression (`UX-11`: mobile landing header right-edge clipping of `Đăng ký` / `Sign up` at `390px`/`360px`)** + **1 P3 edge case (`UX-08b`: landing `<title>` reverting to Vietnamese on reload in EN mode)**, both reopened immediately to `@v2-ui-builder` (#66).
  - **Pass 2 (Final rebuilt V2.0 build, #80):** Independently re-verified BOTH `#72` fixes (`UX-11` & `UX-08b`) in live headless Chromium with bounding-box assertions and fresh visual screenshot inspection.
- **Server Cleanup:** Port `3011` stopped cleanly and verified free (`PORT_3011_FREE`) after both passes.

### 8.1 BEFORE vs AFTER Verdict Table (All 10 Wave 1 Issues + 2 Wave 3 Reopens)

| Issue ID | Severity | Wave 1 (BEFORE) | Wave 3 (AFTER — Live Browser Verified) | Verdict |
| :--- | :---: | :--- | :--- | :--- |
| **UX-01** | P0 | `/exams/new`, `/exams`, `/folders`, `/import` returned raw English Next.js `404`; landing lacked custom exam CTA. | All 5 V2.0 routes (`/exams/new`, `/exams`, `/practice`, `/folders`, `/import`) are real protected routes (`307 -> /login?setup=1&next=...`, `0` 404s); Hero & Footer expose 1-click **`Thi thử tùy chỉnh` (`Custom Exam`) -> `/exams/new`**. *(Live authenticated rendering of `/exams/new` remains blocked pending live Supabase DB.)* | **VERIFIED (Routing & Entry) / BLOCKED (Authenticated Runtime)** |
| **UX-02** | P1 | Auth pages, `/dashboard`, `/sets/new`, and `/share/[token]` exposed raw `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `.env.local` to students. | **0 jargon leaks** across `/` (VI & EN), `/register`, `/login`, `/login?setup=1`, `/forgot-password`, and `/share/[token]`. Students see calm localized maintenance copy (`Hệ thống dữ liệu đang tạm bảo trì` / `Study server temporarily unavailable`) with admin details tucked inside collapsed `<details>`. Clicking share redeem returns clean Vietnamese (`Kết nối đến máy chủ dữ liệu học tập hiện chưa sẵn sàng...`). | **VERIFIED FIXED** |
| **UX-03** | P1 | Protected routes (`/dashboard`, `/library`, `/sets/new`, `/review`, `/settings`, etc.) rendered full authenticated chrome (`U Tài khoản`, `Đăng xuất`) with no redirect. | All 18 protected routes cleanly redirect via **`HTTP 307 -> /login?setup=1&next=<encoded-path>`** with `0` unauthenticated app-shell leakage and `0` console/page errors. | **VERIFIED FIXED** |
| **UX-04** | P2 | Mobile `390×844` bottom nav clipped `Thử lại`, truncated 3 Vietnamese labels in `Thêm` sheet, omitted `Thi thử` center slot, used English `Close` sr-only. | Cannot enter authenticated `AppShell` live in-browser now that `UX-03` auth gate cleanly redirects to `/login?setup=1`. *(Code-level fixes for `AppShell` 5-tab bottom bar with `Thi thử` center slot, bottom safe-area clearance, localized `Đóng`/`Close`, and `>=44px` Sheet close button were independently verified by `@uiux-auditor` in `#74`.)* | **BLOCKED (Live Auth Required; Code Verified `#74`)** |
| **UX-05** | P2 | Unknown URLs rendered unstyled white English Next.js `404`. | `/nonexistent-route-v2-check` & `/nonexistent-route-final` return `HTTP 404` with branded StudyHub header (`VI`/`EN`, Light/Dark), semantic `<h1>` (`Không tìm thấy trang này` / `Page not found`), Dark Mode (`rgb(11, 17, 32)`), and 3 recovery CTAs (`Về Tổng quan`, `Mở Thư viện`, `Về trang chủ`). *(Minor P4 note: 404 `<title>` remains Vietnamese in EN mode while `<h1>` & body translate cleanly.)* | **VERIFIED FIXED** |
| **UX-06** | P2 | `/library` showed 3–4 Create buttons and 2 identical search boxes. | Live authenticated `/library` gated cleanly behind `/login?setup=1` pending live Supabase credentials. | **BLOCKED (Live Auth Required; Code Verified `#74`)** |
| **UX-07** | P2 | Mobile auth inputs (`36px`), password eye (`24×24px`, stayed enabled while input disabled), `Quên mật khẩu?` (`16px`), and header buttons (`32–36px`) fell below 44px. | On mobile `390×844` & `360×800`: **all auth inputs are `44px` tall** (`sub44Controls: []`), password eye toggle is **`disabled: true`** when input is disabled and **`44×44px`** on mobile (`36×36px` desktop), `Quên mật khẩu?` is **`44px`** tall, and mobile header `VI` (`55×44`), Theme (`44×44`), and `Đăng ký`/`Sign up` (`71×44` / `67×44`) all meet `>=44px` height! | **VERIFIED FIXED** |
| **UX-08** | P3 | Auth & share pages lacked `<h1>`; `<title>` and skip link stayed Vietnamese in EN mode. | `/register`, `/login`, `/forgot-password`, `/share/[token]`, and `/404` ALL now have **exact `h1Count: 1`**. Toggling `VI -> EN` updates `<title>` (`StudyHub — Personal Self-Study & Exam Platform`, `Sign up | StudyHub`, `Sign in | StudyHub`) and skip link (`Skip to main content`). | **VERIFIED FIXED** |
| **UX-08b** *(Wave 3 Reopen)* | P3 | Pass 1 caught `/` `<title>` reverting to Vietnamese after full reload (`F5`) in EN mode. | Pass 2 confirmed `titleAfterReload === "StudyHub — Personal Self-Study & Exam Platform"`, `regTitleEnReload === "Sign up | StudyHub"`, `loginTitleEnReload === "Sign in | StudyHub"`, `skipAfterReload === "Skip to main content"` across full reloads! | **VERIFIED FIXED (Pass 2)** |
| **UX-09** | P3 | Landing page contained dev jargon (`Thuật toán xác định`, `UUID`, `RLS`, `danh sách ảo hóa`) and ragged 2–3 line `DOCX · / XLSX · / TXT` KPI wrap on mobile. | **0 jargon matches** in VI & EN (`Chấm điểm đúng 100% theo đáp án gốc`, `Đảo câu hỏi và đảo đáp án A/B/C/D không bao giờ lệch đáp án`, `Thi thử nhiều môn & Phủ 100%`). Mobile KPI row (`390px` & `360px`) lays out cleanly with **`DOCX · XLSX · TXT` on one crisp line**. | **VERIFIED FIXED** |
| **UX-10** | P3 | App routes triggered `2–12` redundant `503` retries on every load when Supabase unconfigured. | **0 `503` requests** and **0 console errors** across all 18 redirected routes and all auth/landing pages! | **VERIFIED FIXED** |
| **UX-11** *(Wave 3 Reopen)* | **P1** | Pass 1 caught mobile landing header clipping `Đăng ký` / `Sign up` off the right edge (`x=330, w=71 -> 401px` on `390px`; half cut off on `360px`). | Pass 2 verified **`anyClippedRight: false`** across `390×844` VI (`maxRightEdge: 378 <= 390`), `360×800` VI (`maxRightEdge: 348 <= 360`), and `360×800` EN (`maxRightEdge: 348 <= 360`), `overflowX: false`, with Hero `Đăng nhập` / `Sign in` prominently above the fold (`heroSignInAboveFold: true`). | **VERIFIED FIXED (Pass 2)** |

### 8.2 Scenarios 1–8 Final Wave 3 Real-Student Status

| # | Real Student Scenario | Wave 1 Status | Wave 3 Status (Honest Live Browser Verdict) | Remaining Blocker |
| :-: | :--- | :--- | :--- | :--- |
| **1** | Onboarding & Auth (`/`, `/register`, `/login`, `/forgot-password`) | BLOCKED + UX DEFECTS | **PUBLIC UX VERIFIED FIXED / AUTH SUBMIT BLOCKED** (0 jargon, `<h1>` everywhere, `>=44px` mobile targets, 0 header clipping on 360/390px, EN `<title>` reload persistence, reduced motion verified; real signup/signin blocked by missing `.env.local` Supabase) | External: Live Supabase / Docker |
| **2** | Bulk Import Real Question Banks (`/import`, `/sets/[id]/import`) | BLOCKED + UX FRICTION | **ROUTE VERIFIED (`307` guarded, no 404) / LIVE UPLOAD BLOCKED** *(Offline parser verified 100% across all 4 `sample-data/` aviation files by `@perf-import-auditor` in `#75`)* | External: Live Supabase / Docker |
| **3** | Library, Folders, Search & Editing (`/library`, `/folders`, `/sets/new`) | BLOCKED + UX DEFECTS | **ROUTES VERIFIED (`307` guarded, `/folders` no longer 404) / LIVE CRUD BLOCKED** | External: Live Supabase / Docker |
| **4** | Daily Active Study Modes (`Flashcards`, `Learn`, `Practice`, `Write`, `Match`) | BLOCKED + MINOR UX | **ROUTES VERIFIED (`/practice` & `/sets/[id]/*` guarded, 0 `503` storm) / LIVE SESSION BLOCKED** | External: Live Supabase / Docker |
| **5** | Custom Multi-Subject & Arbitrary-Length Exam (`/exams/new`, `/exams`, presets) | NOT IMPLEMENTED (404) | **IMPLEMENTED & ROUTED (`307` guarded, Hero CTA live) / LIVE EXECUTION BLOCKED** *(No longer 404; full multi-subject builder & presets awaiting live Supabase session for browser E2E)* | External: Live Supabase / Docker |
| **6** | Full Coverage Non-Repeating Exam Cycle | NOT IMPLEMENTED | **IMPLEMENTED (Featured on landing & routed via `/exams/new`) / LIVE CYCLE BLOCKED** | External: Live Supabase / Docker |
| **7** | Mistakes, SM-2 Queue, Starred, History & Statistics (`/review`, `/starred`, `/history`, `/statistics`) | BLOCKED + MINOR UX | **ROUTES VERIFIED (`307` guarded, 0 `503` storm) / LIVE DATA BLOCKED** | External: Live Supabase / Docker |
| **8** | Friends, Sharing, Settings, Mobile & A11y (`/friends`, `/shared`, `/share/[token]`, `/profile`, `/settings`) | BLOCKED + UX DEFECTS | **PUBLIC SHARE, MOBILE 360/390, A11Y, LIGHT/DARK, VI/EN & REDUCED MOTION VERIFIED FIXED / AUTH SOCIAL BLOCKED** | External: Live Supabase / Docker |

### 8.3 Wave 3 AFTER Screenshots Index

- Desktop Landing VI Light (student copy + Custom Exam CTA): `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\after_01_landing_desktop_vi_light.png`
- Desktop Landing EN Light (clean English copy, localized `<title>`): `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\after_02_landing_desktop_en_light.png`
- Desktop Landing VI Dark: `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\after_03_landing_desktop_vi_dark.png`
- Mobile 390px Landing VI Light (FINAL — zero header clipping + single-line KPI): `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\final_landing_mobile_390_vi.png`
- Mobile 360px Landing EN Light (FINAL — zero header clipping + single-line KPI): `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\final_landing_mobile_360_en.png`
- Register Page Desktop VI Light (student-friendly maintenance notice + `<h1>` + disabled eye toggle): `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\after_06_register_desktop_vi_light.png`
- Register Page Mobile 390px Dark (`44px` inputs & eye button): `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\after_13_register_mobile_390_dark.png`
- `/exams/new` Clean `307 -> /login?setup=1&next=%2Fexams%2Fnew` Redirect: `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\after_08_exams_new_desktop.png`
- Branded Custom 404 Page (Desktop VI Light): `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\after_10_custom_404_desktop_vi_light.png`
- Branded Custom 404 Page (Desktop VI Dark): `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\after_11_custom_404_desktop_dark.png`
- `/share/invalid-demo-token` Friendly Vietnamese Service Error (zero dev jargon): `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\after_12_share_token_desktop.png`


---

## 9. V2.1 Live Supabase Cloud Authenticated Real-Student Verification (`BLK-001` RESOLVED)

- **Environment:** Fresh V2.1 production build (`npx next start -p 3011`, `http://localhost:3011`) connected to live Supabase Cloud (`StudyHub`, PG 17.12, migrations `0001`–`0011` applied).
- **Independence & Privacy:** Zero `src/*` inspection; zero `.env.local` secrets printed/logged; zero raw `sample-data/` question banks copied into documentation.
- **Disposable Test Accounts & Teardown:** Isolated Student A (`v21-student-a-*@studyhub-test.local`) & Student B (`v21-student-b-*@studyhub-test.local`) provisioned via Admin API (`email_confirm: true`) and **100% cleanly deleted with all owned data in `finally`** on every run (`deletedCount: 2, ok: true`).
- **Server Cleanup:** Dedicated port `3011` cleanly stopped and verified free (`PORT_3011_FREE`).

### 9.1 Live Authenticated Verdicts — All 8 Real User Scenarios (Section 25)

| # | Real Student Scenario | Wave 3 (Pre-Cloud) | V2.1 LIVE Authenticated Verdict | Exact Live Evidence Observed |
| :-: | :--- | :--- | :--- | :--- |
| **1** | **Onboarding, Login & Authenticated Dashboard** (`/login` -> `/dashboard`, Light & Dark) | AUTH BLOCKED | **VERIFIED WORKING LIVE** | Real login redirected to `/dashboard` in `2,308ms` (`Xin chào, Minh Aviation`, toast `Đăng nhập thành công.`), daily goal bar (`0/20 -> 2/20`), streak badge (`1 ngày liên tiếp`), `157` total questions across `2` sets, crisp Light & Dark (`rgb(11, 17, 32)`) themes, `0` horizontal overflow. |
| **2** | **Bulk Import Real Aviation Banks through Live 6-Step Import Wizard UI** | UPLOAD BLOCKED | **VERIFIED WORKING LIVE (100% ACCURACY)** | Uploaded real `METEOROLOGY-01. THE ATMOSTPHERE (133).docx` through Steps 1→6: Step 4 Preview detected **`133/133` valid, `0` missing, `0` errors, `0` conflicts, `0` duplicates** -> committed **`Nhập 133 câu hỏi`** in **`2,891ms`**. Uploaded real `METEOROLOGY-05. PRECIPITATION (24).xlsx`: Step 2 auto-detected **`2 hàng (Tiêu đề gộp)`** + exact columns -> Step 4 Preview **`24/24` valid, `0` errors, `0` duplicates** -> committed in **`2,153ms`**. `0` console/page/HTTP errors. |
| **3** | **Library, Folder Creation, Search & Study Set Hub** (`/library`, `/sets/new`, `/sets/[id]`) | CRUD BLOCKED | **VERIFIED WORKING LIVE (`UX-06` FIXED!)** | Created folder `ATPL Meteorology` live via modal (`Thư mục (1)`); `/library` now shows **1 single search bar** (duplicate topbar search eliminated!) and **1 clean primary `+ Tạo học phần mới` button** alongside `Tạo đề thi tùy chỉnh`; both imported sets appear with exact `133 câu hỏi` & `24 câu hỏi` counts; `0` console/page/HTTP errors. |
| **4** | **Daily Active Study Modes** (`Flashcards`, `Practice`, `Learn`, `Write`, `Match`) | SESSION BLOCKED | **VERIFIED WORKING LIVE** | On live `METEOROLOGY-05 (24Q)`: `Flashcards` rendered cleanly (`1 / 24`, Space flip, Star toggle, SM-2 rating keys `1–4`, `overflowX: false`); `Practice` answered 3 live MC questions with instant feedback; `Learn`, `Write`, and `Match` all loaded cleanly with **`0` console/page/HTTP errors**. |
| **5** | **Universal Custom Exam Builder (`/exams/new`), Multi-Subject Timed Exam, F5 Reload Persistence, Submit, Mixed-Subject Results & Presets** | EXECUTION BLOCKED | **VERIFIED WORKING LIVE (`UX-01` FULLY RESOLVED!)** | Selected BOTH aviation sets (`157 câu duy nhất`, `2 môn`), live proportional preview (`42/133 + 8/24 = 50 câu`, `~54s/câu`), saved reusable preset **`ATPL Met Mixed 20`** (confirmed visible on `/exams` Hub `Trung tâm Đề thi & Chu kỳ Phủ`), launched live timed multi-subject exam (`20Q` & `50Q`), answered with keyboard (`A`/`B`/`ArrowRight`) + marked (`M`), confirmed autosave **`Đã lưu`**, **pressed `F5` reload -> timer persisted (`44:57 -> 44:52`) AND `2/20` answers + mark persisted**, submitted cleanly -> **Mixed-Subject Results** rendered exact per-subject breakdown (`METEOROLOGY-01: 0/42`, `METEOROLOGY-05: 0/8`), per-chapter breakdown (`Theo chương (2)`), review filters (`Tất cả`, `Câu sai`, `Chưa làm`, `Đánh dấu`), and retake CTAs (`Tạo đề từ 50 câu sai`, `Luyện môn yếu nhất`) with **`0` console/page/HTTP errors**! |
| **6** | **Full Coverage Non-Repeating Exam Cycle** (`Phủ hết ngân hàng` & `/exams` Hub) | CYCLE BLOCKED | **VERIFIED LIVE (UI & Hub Ready)** | `Phủ hết ngân hàng` tab on `/exams/new` and `Chu kỳ Phủ 100% Ngân hàng` section on `/exams` Hub (`Trung tâm Đề thi & Chu kỳ Phủ`) rendered cleanly with `Bắt đầu chu kỳ phủ 100%` launcher & status filters (`Tất cả`, `Đang thực hiện`, `Hoàn thành 100%`) and active exam resume banner (`Đề thi đang làm dở (1) — Đã trả lời: 2/20`). *(End-to-end 500Q zero-overlap DB cycle also live-verified 100% by `db-backend-auditor` #106.)* |
| **7** | **Mistake Bank, Starred, History & Statistics** (`/review`, `/starred`, `/history`, `/statistics`) | DATA BLOCKED | **VERIFIED WORKING LIVE** | `/review` immediately populated **`Cần ôn lại ngay: 2`** from submitted exam with 1-click `Luyện tập câu sai` & `Thi thử câu sai`; `/history` listed **`Đề thi tổng hợp (2 môn · 50 câu)`** (`Đề tổng hợp nhiều môn`) + `Phiên học gần đây (4)` with working `Chi tiết` link; `/statistics` showed live **`Chuỗi ngày học: 1 ngày`**, **`Tổng thời gian học: 11 giây`**, and live Recharts chart; **`0` console/page/HTTP errors**. |
| **8** | **Profile, Settings, Share Dialog & Mobile `390×844` Authenticated AppShell + Exam Runner** | AUTH MOBILE BLOCKED | **VERIFIED WORKING LIVE (`UX-04` FULLY RESOLVED!)** | `/profile` (`Hồ sơ` — `Minh Aviation`) & `/settings` (`Cài đặt`) rendered cleanly; Share Dialog opened with `Riêng tư`, `Liên kết chia sẻ`, `Thành viên (0)`, `Chỉ xem`, `Tạo liên kết chia sẻ mới` *(2-account live share-link redeem/revoke/isolation independently verified in `#113` `security-auditor` 11/11 PASS)*. On **Mobile `390×844`**: authenticated Dashboard & Dark Library have **`0` horizontal overflow**, crisp 5-tab bottom bar (`76×64px` each) with **`Thi thử` (`/exams/new`) right in the center slot**, `Thêm` sheet has **10/10 non-truncated items (`truncated: false`)**, `/exams/new` sticky launch bar sits cleanly ABOVE bottom nav (`y=722..766` vs bottom nav `y=775..844`), and **Live Mobile 390px Exam Runner** rendered smoothly (`scrollWidth: 390`, sticky timer/saved cloud, clean A/B/C/D touch cards, bottom `< Trước | Đánh... | 0/50 | Tiếp >` bar)! |

### 9.2 Previously Blocked Wave 1 Issues Now Live-Verified Fixed

- **`UX-01` (Custom Exam Builder `/exams/new` & Multi-Subject Exams):** **FULLY VERIFIED LIVE** — complete multi-subject builder, Quick Test presets, live proportional allocation, saved presets, live timed runner with F5 persistence, and mixed-subject results.
- **`UX-04` (Mobile 390px Bottom Nav Clipping & Truncated `Thêm` Sheet):** **FULLY VERIFIED LIVE** — 5-tab bottom nav (`Tổng quan | Thư viện | Thi thử | Ôn sai | Thêm`), zero content clipping, `10/10` non-truncated `Thêm` sheet items, sticky `/exams/new` bar sits cleanly above bottom nav (`bottom: 766px < navTop: 775px`).
- **`UX-06` (Library Duplicate Search Bars & Redundant Create Buttons):** **FULLY VERIFIED LIVE** — single search bar on `/library` (`searchInputs: 1`), clean single primary `+ Tạo học phần mới` button.

### 9.3 Minor Non-Blocking Student Polish Observations Caught Live (0 P0 / 0 P1 / 0 P2 Remaining)

1. **[P2 — UX-12 Mobile `/exams/new` Sticky Bar Auto-Clamp] — VERIFIED FIXED LIVE (`#119` / `#121`):** Selecting ONLY `METEOROLOGY-05 (24 câu)` on Mobile `390×844` `/exams/new` now automatically clamps the untouched default `50` count to **`24 câu · 45p` (`Khả dụng: 24`)** with **`Bắt đầu thi` immediately enabled (`disabled: false`, `h=44px`, `top=722..766`, `overflowX: false`)** (`v21_final_mobile_390_ux12_clamped.png`). Direct `admin.auth.admin.deleteUser()` cascade after live exam creation also passed cleanly (`directDeleteUserOk: true, error: null`).
2. **[P3 — Mobile `390px` / `360px` Exam Runner `"Đánh dấu"` Truncation] — VERIFIED FIXED LIVE (`#119` / `#121`):** All 4 sticky bottom exam buttons (`Trước`, `Đánh dấu`, `0/24`, `Tiếp`) render completely with **`truncated: false`**, **`h=44px`**, and **`overflowX: false`** on BOTH `390×844` AND `360×800` (`v21_final_mobile_390_exam_runner_flag.png`).
3. **[P3 — Remaining Minor Cosmetic Notes (Non-Blocking)]:**
   - Immediately upon `/login -> /dashboard` redirect, DevTools logs 2 transient `404` fetches on `/dashboard?_rsc=...` (invisible to the user; `/dashboard` renders completely in `2.3s` with full live data).
   - Desktop left sidebar displays `"Thi thử tùy chỉnh"` twice (top quick-action outline button + nav item below `Thư viện`).
   - DOCX Import Step 4 Preview shows double letter prefixes (`[A] A. ...`) when raw DOCX option strings already include `A.` (whereas the Live Exam Runner displays clean single `[A] ...`).

### 9.4 V2.1 Live Authenticated Full-Window Screenshots Index

- Authenticated Dashboard Desktop (Light): `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\v21_01_dashboard_desktop_light.png`
- Authenticated Dashboard Desktop (Dark): `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\v21_01b_dashboard_desktop_dark.png`
- Live Import Wizard Step 4 Preview (`METEOROLOGY-01 (133).docx` — 133/133 valid): `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\v21_02_import_wizard_preview_docx.png`
- Live Authenticated Library Desktop (1 search bar, folder + 2 sets): `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\v21_02c_library_desktop.png`
- Live Flashcards Desktop (`METEOROLOGY-05`, 24 cards): `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\v21_03_flashcards_desktop.png`
- Live Universal Custom Exam Builder `/exams/new` Desktop (2 subjects, 157Q pool): `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\v21_04_custom_exam_builder_desktop.png`
- Live Timed Multi-Subject Exam Runner Desktop (`2/20`, `Đã lưu`, `44:57`, navigator): `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\v21_05_live_exam_runner_desktop.png`
- Live Mixed-Subject Exam Results Desktop (`Theo môn học (2)`, `Theo chương (2)`): `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\v21_06_mixed_exam_results_desktop.png`
- Live Full Coverage Tab (`Phủ hết ngân hàng`) Desktop: `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\v21_06b_full_coverage_desktop.png`
- Mobile `390×844` Authenticated Dashboard + 5-Tab Bottom Nav (`Thi thử` center): `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\v21_07_mobile_390_dashboard_bottom_nav.png`
- Mobile `390×844` Authenticated `Thêm` Sheet (10/10 non-truncated): `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\v21_07b_mobile_390_more_sheet.png`
- Mobile `390×844` Authenticated Library Dark Mode: `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\v21_07c_mobile_390_library_dark.png`
- Mobile `390×844` Custom Exam Builder Sticky Bar (`UX-12` pool < 50 note): `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\v21_08a_mobile_390_exam_builder.png`
- Mobile `390×844` Live Timed Exam Runner: `C:\Users\Admin\.gemini\antigravity\brain\88bf7ea2-8ae6-4444-a081-bf4782b88c22\v21_08_mobile_390_exam_runner.png`
