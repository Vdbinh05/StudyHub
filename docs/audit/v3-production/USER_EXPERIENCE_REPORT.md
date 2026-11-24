# StudyHub V3.0 — Phase 10 Independent Production Real-User Experience Report

> **Role:** Independent Real User / Aviation & University Student (`real-user`, Agent 5)  
> **Target Environment:** Live deployed HTTPS production app at **`https://studyhub-three-mauve.vercel.app`** (Vercel Hobby + Supabase Cloud `StudyHub` / `cuoaifyupfmkstqhcjwy`, PostgreSQL 17.12, migrations `0001`–`0017`).  
> **Testing Method:** Bounded, real-browser Chromium walkthroughs across **Desktop (`1440×900`)**, **Tablet (`768×1024`)**, **Mobile (`390×844`)**, and **Small Mobile (`360×800`)**, **Light & Dark Mode**, **Vietnamese (`vi`) & English (`en`)**, and live **HTTPS Offline PWA (`setOffline(true)` + real `F5` reload)**.  
> **Independence & Live Data Safety:** Strictly zero reads or edits to `src/*`, `supabase/*`, `public/*`, `next.config.ts`, or `package.json`. Zero secrets logged, zero `sample-data/` aviation question text reproduced. All tests used disposable `v3-prod-user-*@studyhub-test.local` accounts tracked by UUID; every tracked auth user and every Storage object under `{uid}/` in both `study-media` and `study-temp` was deleted and verified **`trackedRemaining === 0`**, leaving pre-existing real user data untouched.

---

## 1. Executive Summary & Production Verdict

**Production UX Verdict: `PASS — READY FOR REAL STUDENTS` (0 P0 / 0 P1 / 0 P2 Open Defects)**

Using StudyHub V3.0 directly at **`https://studyhub-three-mauve.vercel.app`** (initial `2537345` + re-verified after commit `646a565` / `dpl_CUxPSwsnAfqQCVcLf8shZZwbrQDQ`) feels fast, crisp, reliable, and genuinely student-first:
- **Zero Server Errors / Zero Client Crashes:** Across all 3 bounded production browser suites covering public landing, auth, 3 file import formats, multimedia upload/zoom/audio, all 8 study modes, multi-subject timed exams, Vietnamese PDF exports, collaboration/reports, and live HTTPS offline studying, Chromium recorded **`0` HTTP 5xx responses** and **`0` uncaught page errors**.
- **Zero AI / Zero Paywall Integrity:** Verified live across landing, library, study modes, exam builder, settings, and offline screens — zero AI/LLM branding, zero billing walls, zero artificial caps, zero mock datasets.
- **Real HTTPS PWA Offline Works End-to-End:** Service Worker registered and activated over real HTTPS (`Cache-Control: no-cache, no-store, must-revalidate`), mobile `390×844` downloaded an aviation multimedia set (including its embedded PNG), opened the Offline Study Runner while `context.setOffline(true)` displaying the cached weather chart image + Confidence controls, **survived a real `F5` browser reload offline**, and synced cleanly upon reconnect.
- **Honest Scope & Environment Disclosures:**
  1. **Email Confirmation Redirect (Pending Phase 7):** Per `#212`, Supabase Dashboard Auth `Site URL` / `Redirect URLs` configuration is awaiting user confirmation; therefore, live email-confirmation link redirect verification is **explicitly marked Pending Phase 7** and was not falsely claimed as verified here.
  2. **Browser Viewport Emulation vs Physical Hardware:** Tablet (`768×1024`) and Mobile (`390×844`, `360×800`) viewports were verified via Chromium Playwright emulation rather than physical iOS Safari / Android Chrome devices. Real-device touch ergonomics, Safari A2HS install prompts, and mobile OS virtual keyboards should receive a brief physical-device spot check post-launch.

---

## 2. Live Production Journey Verification Matrix (`https://studyhub-three-mauve.vercel.app`)

| Area / Student Flow | What Was Verified Live on `https://studyhub-three-mauve.vercel.app` | Result | Key Evidence & Screenshots |
| --- | --- | --- | --- |
| **Public Landing & Auth** | `/` on `1440×900`, `768×1024`, `390×844`, `360×800` (`0px` overflow, zero AI/paywall); unauthenticated `/dashboard` -> `/login?next=%2Fdashboard`; live `/login` -> `/dashboard` (`Đăng nhập thành công.`). *(Email confirmation redirect: Pending Phase 7.)* | **PASS** | `prod_01_landing_desktop.png`, `prod_02_landing_mobile_390.png`, `prod_03_dashboard_desktop.png` |
| **DOCX Multimedia, Real Excel & PDF Import** | Imported embedded-PNG `.docx` (`1` preview image, committed), real aviation `sample-data/METEOROLOGY-05. PRECIPITATION (24).xlsx` (`24/24` detected & committed), and selectable-text `.pdf` (`3/3` valid questions parsed & committed live on Vercel serverless). | **PASS** | `prod_05_set_detail_multimedia_audio.png`, `prod_06_pdf_import_preview.png` |
| **Multimedia: Lightbox & Audio Player** | Embedded DOCX image renders on `/sets/[id]`, clicking opens fullscreen **ImageLightbox** (`100%`, zoom `+/-`, `0` reset, `Esc` close); uploaded `.wav` audio on a Listening (`Nghe hiểu`) question renders native `<audio>` player & unlocks `Nghe & Gõ`. | **PASS** | `prod_04_set_detail_lightbox.png`, `prod_05_set_detail_multimedia_audio.png` |
| **All Study Modes + Resume** | Imported Quizlet TSV vocab -> **Flashcards** (flip + TTS + SM-2), **Learn** (with `/dashboard` `"Tiếp tục học dở"` Resume card), **Write** (instant check + flexible grading override), **Spell** (`turb[u]lence` `90%` character-by-character diff + hints + TTS), and **Match** (live timer + shuffled tile pairs). | **PASS** | `prod_07_write_mode.png`, `prod_08_spell_mode.png`, `prod_09_match_mode.png` |
| **Visual Diagram Mode** | Uploaded `aircraft_diagram.png`, placed **Point**, **Rectangle**, and **Polygon** hotspots, saved, opened `/diagrams/[id]/study` across Desktop `1440×900`, Tablet `768×1024`, and Mobile `390×844` (`0px` overflow, `0px` navbar overlap after `646a565`, all 6 modes + zoom bar). | **PASS** | `prod_10_diagram_study_tablet.png`, `prod_11_diagram_study_mobile.png` |
| **Multi-Subject Timed Exam + F5 + Hard Guard + Vietnamese PDF** | Created 2-subject 5Q exam on `/exams/new` -> answered Q1 (`44:58`) -> **`F5` reload preserved timer (`44:53`) & answered state (`Đã làm: 1`)** -> **`Ctrl+K` Hard Exam Guard blocked Global Search during active exam** -> submitted -> Results loaded -> exported **Set Vietnamese PDF (`842,220 B`, `%PDF-`)** & **Exam Results Vietnamese PDF (`842,254 B`, `%PDF-`)**. | **PASS** | `prod_12_exam_runner_desktop.png`, `prod_13_exam_results.png` |
| **Confidence + Practice + Notes + Review + Scoped Reset** | Enabled Confidence in `/settings` -> Practice showed `Chắc chắn / Phân vân / Đoán mò`, saved Private Note, wrong `Chắc chắn` answer surfaced on `/review` as **`Chưa khắc phục: 2` & `Sai tự tin cao: 1`** -> Scoped Reset (`RESET_PROGRESS`) preserved `/history` Exam History intact. | **PASS** | `prod_14_review_high_confidence.png` |
| **Two-Account Collaboration & Privacy Isolation** | Account A generated Share Link -> Account B redeemed -> Account B saved Private Note (`0` leaked hits in Account A's `Ctrl+K` Global Search!) & submitted Question Error Report -> Account A reviewed & resolved in `Hộp thư báo lỗi câu hỏi` -> Account A revoked link & removed member *(Note: Suite 3's quick `1000ms` post-click wait closed before remote HTTPS `DELETE` settled; live revocation enforcement is independently verified 22/22 PASS on `https://studyhub-three-mauve.vercel.app` by `security-auditor` `#213`)*. | **PASS** | `prod_15_error_report_inbox.png`, `prod_17_ctrlk_search.png` |
| **HTTPS PWA Offline & Sync (`390×844`)** | `/manifest.webmanifest` (`200`), `/sw.js` (`200`, `no-cache, no-store, must-revalidate`, active SW controller), downloaded aviation set (`"Đã sẵn sàng ngoại tuyến"`), went offline (`setOffline(true)`), opened Offline Study Runner with **cached embedded PNG image + Confidence UI**, **survived real `F5` reload offline**, reconnected & ran `Đồng bộ ngay` (`0` HTTP `5xx`). | **PASS** | `prod_16_offline_study_mobile.png` |
| **Global Search, Shortcuts, Dark Mode & English** | `Ctrl+K` Global Search opened cleanly on `/dashboard`, `?` opened contextual Keyboard Shortcuts modal, `/settings` switched cleanly to Dark Mode + English (`isDark: true, lang: "en"`, `Welcome back, Prod Student S2A`) without auto-translating Vietnamese set titles (`Luật Hàng không Prod V3`). | **PASS** | `prod_17_ctrlk_search.png`, `prod_18_dashboard_dark_en.png` |

---

## 3. Production UX Findings & Polish Recommendations

| ID | Severity | Viewport / URL | Observation & Concrete Student Impact | Recommendation |
| --- | --- | --- | --- | --- |
| **`PROD-UX-01`** | **P2 — FIXED & VERIFIED LIVE (`646a565`)** | Tablet `768×1024` (`md` breakpoint) — authenticated top navbar (`prod_10_diagram_study_tablet.png`) | On initial `2537345`, the `768px` search trigger (`right: 509px`) overlapped the Online badge and `+ Tạo mới` button (`left: 395px`) by `114px`. **Re-verified FIXED live on `646a565` (`dpl_CUxPSwsnAfqQCVcLf8shZZwbrQDQ`):** pairwise header control overlap is **`0px`** (`overlaps: []`) and `overflowPx === 0` across ALL 5 tested widths (`360×800`, `390×844`, `768×1024`, `1024×768`, `1440×900`). | **Closed (`646a565`)** — verified cleanly in updated `prod_10_diagram_study_tablet.png`. |
| **`PROD-UX-02`** | **P3 (Marketing Copy Freshness)** | Public Landing `/` (`prod_01_landing_desktop.png`, `prod_02_landing_mobile_390.png`) | Hero metric cards still display V2 numbers (`6 Chế độ học`, `DOCX · XLSX · TXT`), whereas deployed StudyHub V3.0 now ships **8 study modes** (adding Spell & Visual Diagram), **PDF import & Vietnamese A4 PDF export**, **KaTeX math**, and **Offline PWA**. | Update landing hero copy to highlight V3's 8 modes, PDF import/export, visual diagrams, and offline PWA support so first-time students immediately see the full V3 toolkit. |
| **`PROD-UX-03`** | **P3 (Minor Ergonomics)** | Spell Mode (`/sets/[id]/spell`, `prod_08_spell_mode.png`) | When UI language is Vietnamese, TTS defaults to `Microsoft An - Vietnamese` even on English vocabulary flashcards (`turbulence`) unless the student changes `Ngôn ngữ đọc`. | Add a 1-tap `EN` voice quick-toggle next to `Nghe phát âm` (or heuristic Latin-only English auto-select) for language learners. |

---

## 4. Responsive 4-Viewport Overflow Matrix (`scrollWidth <= innerWidth`)

Every single tested production route across all 4 emulated viewports achieved **`0px` horizontal overflow**:

| Route | Desktop `1440×900` | Tablet `768×1024` | Mobile `390×844` | Small Mobile `360×800` |
| --- | --- | --- | --- | --- |
| `/` (Landing) | `0px` (PASS) | `0px` (PASS) | `0px` (PASS) | `0px` (PASS) |
| `/dashboard` | `0px` (PASS) | `0px` (PASS) | `0px` (PASS) | `0px` (PASS) |
| `/sets/[id]` | `0px` (PASS) | `0px` (PASS) | `0px` (PASS) | `0px` (PASS) |
| `/exams/new` | `0px` (PASS) | `0px` (PASS) | `0px` (PASS) | `0px` (PASS) |
| `/review` | `0px` (PASS) | `0px` (PASS) | `0px` (PASS) | `0px` (PASS) |
| `/settings` | `0px` (PASS) | `0px` (PASS) | `0px` (PASS) | `0px` (PASS) |
| `/diagrams/[id]/study` | `0px` (PASS) | `0px` (PASS) | `0px` (PASS) | `0px` (PASS) |

*Pairwise top-navbar control overlap verified **`0px`** across `360×800`, `390×844`, `768×1024`, `1024×768`, and `1440×900` on `646a565` (`dpl_CUxPSwsnAfqQCVcLf8shZZwbrQDQ`).*

---

## 5. Disposable Account & Storage Teardown Verification

All 4 production runs tracked every created disposable student account (`v3-prod-user-*@studyhub-test.local`) and deleted both the auth user (cascading DB rows) and every blob strictly under `{uid}/` in both `study-media` and `study-temp`:

| Suite | Disposable Accounts Provisioned | `study-media` Blobs Cleaned | `study-temp` Blobs Remaining | `trackedRemaining` |
| --- | --- | --- | --- | --- |
| Suite 1 (initial + full) | `2` (`s1` × 2) | `4` | `0` (auto-cleaned by app) | **`0`** |
| Suite 2 | `2` (`s2a`, `s2b`) | `2` | `0` (auto-cleaned by app) | **`0`** |
| Suite 3 | `2` (`s3a`, `s3b`) | `1` | `0` (auto-cleaned by app) | **`0`** |
| Suite 4 (`PROD-UX-01` re-verify on `646a565`) | `1` (`ux01`) | `1` | `0` (auto-cleaned by app) | **`0`** |
| **Total** | **7 disposable accounts** | **8 blobs cleaned** | **0** | **`0` (100% spotless)** |

Pre-existing real user accounts, study sets, questions, and storage objects were never modified or queried globally.

---

## 6. Curated Production Screenshot Index (`docs/audit/v3-production/screenshots/`)

| # | Filename | Viewport / Mode | What It Proves Live on `https://studyhub-three-mauve.vercel.app` |
| --- | --- | --- | --- |
| 01 | `prod_01_landing_desktop.png` | `1440×900` Light VI | Clean production landing page, zero AI/paywall copy |
| 02 | `prod_02_landing_mobile_390.png` | `390×844` Light VI | Crisp mobile landing page (`0px` overflow) |
| 03 | `prod_03_dashboard_desktop.png` | `1440×900` Light VI | Authenticated production Dashboard + `Đăng nhập thành công.` toast |
| 04 | `prod_04_set_detail_lightbox.png` | `1440×900` Light VI | Fullscreen ImageLightbox zoom on imported DOCX aviation weather symbol |
| 05 | `prod_05_set_detail_multimedia_audio.png` | `1440×900` Light VI | Production `/sets/[id]` with 4 questions (embedded DOCX image + uploaded `.wav` audio) |
| 06 | `prod_06_pdf_import_preview.png` | `1440×900` Light VI | Live Vercel serverless PDF text-layer import (`3/3` valid, `0` errors) |
| 07 | `prod_07_write_mode.png` | `1440×900` Light VI | Write Mode (`Gõ đáp án`) instant check & flexible grading UI |
| 08 | `prod_08_spell_mode.png` | `1440×900` Light VI | Spell Mode (`Nghe & Gõ`) `turb[u]lence` (`90%`) character diff + TTS controls |
| 09 | `prod_09_match_mode.png` | `1440×900` Light VI | Match Mode (`Ghép thẻ`) live timer & shuffled term/definition tiles |
| 10 | `prod_10_diagram_study_tablet.png` | `768×1024` Light VI | **AFTER (`646a565`):** Tablet `768px` Diagram Study + spotless navbar (`0px` overlap, `0px` overflow) |
| 11 | `prod_11_diagram_study_mobile.png` | `390×844` Light VI | Mobile `390px` Diagram Study (`0px` overflow, 6 modes + zoom bar) |
| 12 | `prod_12_exam_runner_desktop.png` | `1440×900` Light VI | Live 2-subject timed exam runner (`44:58`, autosave, subject filter, confidence button) |
| 13 | `prod_13_exam_results.png` | `1440×900` Light VI | Multi-subject Exam Results breakdown by subject + `Xuất PDF` CTA |
| 14 | `prod_14_review_high_confidence.png` | `1440×900` Light VI | `/review` Advanced Mistakes showing `Chưa khắc phục: 2` & **`Sai tự tin cao: 1`** |
| 15 | `prod_15_error_report_inbox.png` | `1440×900` Light VI | Owner `Hộp thư báo lỗi câu hỏi` reviewing & resolving Account B's report |
| 16 | `prod_16_offline_study_mobile.png` | `390×844` Offline | Mobile live HTTPS Offline Study Runner (`setOffline(true)`) with cached PNG & Confidence UI |
| 17 | `prod_17_ctrlk_search.png` | `1440×900` Light VI | `Ctrl+K` Global Library Search dialog (8 entity tabs) on production Dashboard |
| 18 | `prod_18_dashboard_dark_en.png` | `1440×900` Dark EN | Verified Dark Mode + English (`en`) Dashboard preserving Vietnamese study set titles untouched |
