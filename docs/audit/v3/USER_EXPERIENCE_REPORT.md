# StudyHub V3.0 — Independent Real-Student User Experience Audit Report

> **Role:** Independent Real User / Aviation & University Student (`real-user`)  
> **Scope:** Live black-box Chromium browser audit of **StudyHub V3.0 Complete Learning Edition** across all **8 Realistic Student Scenarios (A–H)** on Desktop (`1440×900`), Mobile (`390×844` & `360×800`), Light & Dark Mode, Vietnamese (`vi`) & English (`en`), Keyboard Navigation, and Live Offline PWA mode.  
> **Runtime Tested:** Fresh production Next.js `16.4.6` (`npx next start -p 3021`) connected to live Supabase Cloud (`StudyHub`, PostgreSQL 17.12, migrations `0001`–`0016`).  
> **Independence & Safety Guarantee:** Zero `src/*` or `supabase/*` code was inspected or modified during this audit. All tests used disposable `v3-student-*@studyhub-test.local` accounts tracked by UUID and deleted cleanly in `finally` (`trackedTestResourcesRemaining === 0`); pre-existing live user data was strictly untouched, zero secrets were logged, and zero `sample-data/` aviation question text is reproduced below.

---

## 1. Executive Summary & Overall Verdict

**Final Wave 5B Verdict: PASS — READY FOR STUDENTS (8 / 8 Scenarios PASS LIVE, 0 Open P0 / P1 / P2 Defects)**

Testing StudyHub V3.0 strictly like a real aviation and university student in Chromium uncovered **2 P0 showstoppers, 4 P1 live functional/UX blockers, and 2 P2 visual/editor regressions** during **Pass 1** (pre-Wave 5B rebuild). Every single one of those defects was reported immediately with visual screenshots and reproduction steps, patched by the engineering team, rebuilt in Wave 5B, and **independently re-verified live on port `3021` in Pass 2**:

- **Zero AI / Zero Paywall Integrity:** Confirmed across every screen, modal, tooltip, settings tab, and empty state — zero LLM/AI branding, zero billing walls, zero artificial question/exam limits, and zero mock data.
- **Academic Calm Polish:** Crisp Indigo + Slate palette in both Light Mode and Dark Mode (`next-themes`), clean `lucide-react` iconography (zero UI emojis), fast page transitions, and **0px horizontal overflow** across all tested desktop (`1440×900`) and mobile (`390×844`, `360×800`) viewports including newly fixed `/sets/[id]`, `/diagrams/[id]/study`, `/sets/[id]/spell`, `/review`, `/settings`, and `/offline`.
- **Real Daily Student Ergonomics:** StudyHub V3.0 now feels genuinely competitive with Quizlet + EduQuiz for serious exam prep — combining real multimedia Word/Excel/PDF import, 13 structured question types + KaTeX math, interactive 6-mode visual diagrams, Spell Mode with character-level diff, Confidence-calibrated mistake review, private notes, error reporting, print-ready Vietnamese A4 PDFs, `Ctrl+K` Global Search (strictly blocked during active timed exams), and real Offline PWA studying that survives full mobile browser reloads.

---

## 2. Scenario-by-Scenario Audit Matrix (Scenarios A–H)

| Scenario | Student Journey Tested Live (`http://localhost:3021`) | Pass 1 Verdict | Pass 2 (Wave 5B) Verdict | Key Live Evidence & Screenshots |
| --- | --- | --- | --- | --- |
| **A. Aviation Multimedia Exam** | Import `.docx` with embedded PNG + real `sample-data/` aviation `.xlsx` (24q), inspect embedded image on Step 4 Preview & `/sets/[id]`, upload option image in editor, run timed shuffled exam + `F5` reload timer/answer persistence, submit, export Vietnamese-title PDF (Set Paper + Answer Key & Exam Results PDF). | **FAIL** (`V3-UX-01` P0 header collapse, `V3-UX-03` missing bank image, `V3-SEC-01(c)` Vietnamese PDF `500`) | **PASS (LIVE)** | Step 4 preview & `/sets/[id]` render `160×100` embedded image (`h1Width: 1144px`, `overflowPx: 0`); `F5` reload preserved `14:58 -> 14:55` timer & answered state; Set Vietnamese PDF (`842,233 B`, `%PDF-`) & Exam Results Vietnamese PDF (`841,711 B`, `%PDF-`) both downloaded cleanly (`v3_scA_import_preview_multimedia.png`, `v3_final_scA_set_detail_fixed.png`, `v3_final_scA_results_multimedia.png`). |
| **B. English Vocabulary + Spell + Resume** | Import Quizlet-style TSV vocabulary (`term\tdefinition`), study Audio Flashcards (TTS + SM-2 buttons), misspell `turblence` in Spell Mode (`/sets/[id]/spell`) and inspect character-by-character diff + hints, progress in 5-stage Learn Mode (`/sets/[id]/learn` Bước 1 -> Bước 2 MCQ), exit to `/dashboard` and Resume. | **PARTIAL** (`V3-UX-02` P1 `POST /api/sessions/[id]/answers` HTTP `400` on Learn TSV MCQ) | **PASS (LIVE)** | Audio Flashcards TTS & SM-2 ratings work; Spell Mode displays `Chưa chính xác (khớp 90%)` with highlighted `turb[u]lence` diff + progressive hints; Learn Mode Bước 2 MCQ distractors now return **HTTP `201`** (0 `400`s); `/dashboard` shows `"Tiếp tục học dở"` and resumes cleanly (`v3_scB_audio_flashcards.png`, `v3_scB_spell_mode_diff.png`, `v3_scB_dashboard_resume.png`). |
| **C. Aircraft Diagram Learning** | Open `/sets/[id]/diagrams`, upload `600×360` schematic aircraft PNG, place **Point**, **Rectangle**, and **Polygon** hotspots, save, open `/diagrams/[id]/study`, switch study modes (`Khám phá`, `Ẩn nhãn`, `Chỉ vị trí`, `Gọi tên`, `Trắc nghiệm`, `Ôn vị trí sai`), test Zoom, and test Mobile `390×844`. | **PASS** | **PASS (LIVE)** | `POST /api/uploads/image` (`201`) & `POST /api/diagrams` (`201`); Point (1), Rectangle (2), and Polygon (3) hotspots saved and rendered accurately across all 6 study modes on desktop and mobile `390×844` with `0px` horizontal overflow (`v3_scC_diagram_editor.png`, `v3_scC_diagram_study_desktop.png`, `v3_scC_diagram_study_mobile.png`). |
| **D. IT & Math Question Bank** | Open `/sets/[id]/edit`, inspect all 13 V3 question types, author MCQ with Rich Text + KaTeX (`$x = \frac{a+b}{2}$`, `$$E = mc^2$$`), Numerical (`1013.25 ± 0.5`), Fill-in-the-Blank (`{{b1}}`), Ordering, and Matching; preview KaTeX; run mixed timed exam across all 5 types and verify live server scoring. | **FAIL** (`V3-UX-04` P2 raw `$...$` in TipTap Preview; `V3-UX-05` P0 live exam crash on `matching`) | **PASS (LIVE)** | All 13 V3 question types selectable; Rich Text preview renders all 4 KaTeX expressions cleanly (`0` `.katex-error`, `0` raw `$`); live 5-question mixed exam stepped across all 5 questions (including Matching dropdowns) with **zero crash**, submitted & server-scored cleanly (`v3_final_scD_richtext_katex_fixed.png`, `v3_final_scD_mixed_exam_matching_fixed.png`, `v3_final_scD_mixed_exam_results.png`). |
| **E. Confidence, Mistakes, Notes & Scoped Reset** | Enable Confidence Level in `/settings`, answer Q1 correctly with `Đoán mò` (`guessing`) + save Private Note in Practice Mode, answer Q2 wrongly with `Chắc chắn` (`certain`), inspect `/review` (Advanced Mistakes + `Sai tự tin cao`), perform Scoped Reset Progress, verify `/history` Exam History survives intact. | **FAIL** (`V3-UX-06` P1 Confidence/Notes/Report absent in Practice + `V3-FUNC-01` raw KaTeX) | **PASS (LIVE)** | `/settings` saves `confidence_enabled` (`200`); Practice Mode renders KaTeX (`4` `.katex` nodes), shows `Mức độ tự tin trước khi kiểm tra` (`Chắc chắn / Phân vân / Đoán mò`), saves Private Note (`Đã lưu ghi chú cá nhân.`), and shows `Báo lỗi câu hỏi`; `/review` surfaces `Chưa khắc phục: 2` and **`Sai tự tin cao: 1`**; Scoped Reset resets mastery while **preserving Exam History 100%** (`v3_final_scE_practice_confidence_before_answer.png`, `v3_final_scE_practice_v3_fixed.png`, `v3_final_scE_advanced_review_populated.png`, `v3_scE_scoped_reset.png`). |
| **F. PWA & Offline Mobile (`390×844`)** | Verify `/manifest.webmanifest` (`200`) & `/sw.js` (`200`, active controller), download aviation multimedia set on Mobile `390×844` via confirmation dialog, verify Settings Offline Manager storage meter, go offline (`context.setOffline(true)`), launch Offline Study Runner (with cached image + confidence selector!), perform **real `F5` reload while offline**, reconnect & trigger `Đồng bộ ngay`. | **PASS** (after confirming download modal) | **PASS (LIVE)** | `manifest.webmanifest` (`200`, `standalone`, 3 icons), `/sw.js` (`200`, controller active), button transitions to `"Đã sẵn sàng ngoại tuyến"`, Settings shows `StudyHub: 8.4 KB (1 học phần, 1 tệp)`, Offline Study Runner displays all 7 offline modes + cached weather image + Confidence controls while offline, **`F5` reload offline survived with cached set intact**, reconnect `Đồng bộ ngay` succeeded with `0` HTTP `5xx` (`v3_final_scF_settings_offline_downloaded.png`, `v3_final_scF_offline_study_active.png`). |
| **G. Two Friends Collaboration & Isolation** | Account A shares set via Share Link -> Account B (isolated browser context) redeems link, saves Private Note, submits Question Error Report -> verify Account A cannot see B's Private Note on set view or via `Ctrl+K` Global Search -> Account A reviews & resolves B's report -> Account A revokes Share Link & removes B from Members -> verify B loses access cleanly. | **PARTIAL** (Practice missing notes/report in Pass 1 due to `V3-UX-06`) | **PASS (LIVE)** | Account B saved Private Note & Error Report directly from Practice Mode; Account A saw `0` matches in set view & `Ctrl+K` (`SECRET_B_NOTE` 100% isolated); Account A saw & resolved report inside `Hộp thư báo lỗi câu hỏi`; after revoking link (with confirmation dialog) & removing member, Account B reloaded to `"Không tìm thấy học phần"` with zero leaked data (`v3_final_scG_error_report_resolve.png`). |
| **H. Multi-Subject Exam, `Ctrl+K` Hard Guard, `?`, Mobile & Dark/EN** | Multi-subject 6-question exam across 2 subjects + Full Coverage tab, `Ctrl+K` Global Search on Dashboard (8 entity tabs + highlight), **`Ctrl+K` Hard Exam Guard** during active timed exam, `?` Keyboard Shortcuts modal, Dark Mode + English (`en`) switch, and `390×844` / `360×800` overflow sweep. | **PASS** (excluding `/sets/[id]` desktop header bug) | **PASS (LIVE)** | Multi-subject exam generated exact `6` questions across 2 subjects; `Ctrl+K` found sets & questions with yellow highlights; **`Ctrl+K` strictly blocked inside active exam**; `?` opened contextual shortcut guide noting Vietnamese IME safety; Dark Mode + English verified (`isDark: true, lang: "en"`); **`0px` overflow across all 16 mobile `390px`/`360px` route checks** (`v3_scH_ctrlk_global_search.png`, `v3_scH_shortcuts_modal.png`, `v3_final_scH_dashboard_dark_en.png`). |

---

## 3. Defects Caught in Pass 1 & Verified Fixed in Wave 5B Pass 2

Every live defect below was discovered strictly via real browser interaction during Pass 1 and independently re-verified fixed after the Wave 5B rebuild (`#185`):

| ID | Severity | Symptom Observed as a Student (Pass 1) | Wave 5B Pass 2 Live Re-Verification |
| --- | --- | --- | --- |
| **`V3-UX-01`** | **P0** | Opening any owned `/sets/[id]` on Desktop `1440×900` collapsed the left title/breadcrumb column to **`0px` wide (`1,375px` tall — one vertical character per line!)** and clipped all 10 action buttons offscreen because the `1,304px` action bar had `shrink-0`. | **VERIFIED FIXED:** `<h1>` now renders at `1,144px × 37px` with `0px` overflow across `1440px`, `390px`, and `360px`; action buttons wrap cleanly into 2 tidy rows beneath the title (`v3_final_scA_set_detail_fixed.png`). |
| **`V3-UX-05`** | **P0** | Starting a live timed exam (`/exams/[attemptId]`) containing a `matching` (`Ghép cặp`) question created via the Question Editor **hard-crashed immediately to the React error boundary** (`"Rất tiếc, trang gặp sự cố"`) with `TypeError: Cannot read properties of undefined (reading 'map')`. | **VERIFIED FIXED:** Live 5-question mixed exam (MCQ + Numerical + Fill-in-the-Blank + Ordering + Matching) rendered all 5 questions cleanly (`questionsVisited: 5`, `crashedOnAnyQuestion: false`), showed Matching dropdowns cleanly, and submitted/graded on Results (`v3_final_scD_mixed_exam_matching_fixed.png`, `v3_final_scD_mixed_exam_results.png`). |
| **`V3-UX-02`** | **P1** | Answering an auto-generated multiple-choice distractor in **Learn Mode** (`/sets/[id]/learn`) on a Quizlet-style TSV vocabulary set failed with **HTTP `400 VALIDATION_ERROR`** (`selected_option_ids.0: Invalid UUID format`). | **VERIFIED FIXED:** Advancing Learn Mode to Bước 2 (`Ghi nhớ`, 4 synthesized distractors) and clicking an option now returns **HTTP `201`** with `0` `400` errors. |
| **`V3-UX-06`** | **P1** | After enabling `"Bật ghi nhận mức độ tự tin"` in `/settings`, Practice Mode (`/sets/[id]/practice`) showed **no Confidence selector**, **no `"Thêm ghi chú"` Private Note button**, and **no `"Báo lỗi câu hỏi"` button** (despite `/sets/[id]` advertising `"Chấm ngay, giải thích & ghi chú"`). | **VERIFIED FIXED:** Practice Mode now displays `Mức độ tự tin trước khi kiểm tra` (`Chắc chắn / Phân vân / Đoán mò`), `Thêm ghi chú` (inline private note editor + save toast), and `Báo lỗi câu hỏi` (error report modal), and high-confidence wrong answers surface as **`Sai tự tin cao: 1`** on `/review` (`v3_final_scE_practice_confidence_before_answer.png`, `v3_final_scE_practice_v3_fixed.png`, `v3_final_scE_advanced_review_populated.png`). |
| **`V3-FUNC-01`** | **P1** | Practice Mode rendered raw unparsed LaTeX (`$x = 5$`, `$x = \frac{a+b}{2}$`) instead of KaTeX (also caught by `@func-tester` alongside `image_choice`/Lightbox). | **VERIFIED FIXED:** Practice Mode renders all 4 KaTeX math expressions cleanly (`katexNodes: 4`, `hasRawLatex: false`, `v3_final_scE_practice_v3_fixed.png`). |
| **`V3-SEC-01(a)+(c)`** | **P1** | Exporting PDF with a Vietnamese study set title (`Khí tượng Hàng không V3 Multimedia`) returned **HTTP `500 INTERNAL_ERROR`** (while changing title to ASCII succeeded with `842 KB` `%PDF-`). | **VERIFIED FIXED:** Both Set PDF Export (`Khí tượng Hàng không V3 Multimedia-paper_and_key.pdf`, `842,233 B`) and Exam Results PDF Export (`Thi nhanh 3 câu-paper_with_explanations.pdf`, `841,711 B`) download cleanly with valid `%PDF-` headers. |
| **`V3-UX-03`** | **P2** | Embedded DOCX question images (`prompt_image_url`) saved cleanly and appeared on Exam Results, but were **invisible (`0` `<img>` tags)** when browsing the Question Bank list on `/sets/[id]`. | **VERIFIED FIXED:** Embedded `160×100` weather chart image now renders cleanly inside `/sets/[id]` Question Bank `#1` with a `"Phóng to"` zoom trigger (`v3_final_scA_set_detail_fixed.png`). |
| **`V3-UX-04`** | **P2** | Typing `$x = \frac{a+b}{2}$` or `$$E = mc^2$$` directly inside the TipTap Rich Text editor showed literal raw `$...$` in Preview (while Option A's `$x = 5$` rendered via KaTeX). | **VERIFIED FIXED:** Rich Text Editor Preview now renders both inline `$x = \frac{a+b}{2}$` and display `$$E = mc^2$$` via KaTeX (`4` `.katex` nodes, `0` `.katex-error`, `v3_final_scD_richtext_katex_fixed.png`). |

---

## 4. Non-Blocking Student UX Polish Notes (P3 — Post-V3.0 Backlog)

None of the items below block V3.0 release, but polishing them in V3.1 would elevate StudyHub's day-to-day polish even further:

1. **Duplicate Option Letter Prefix in DOCX Import Preview (`P3`):** On `/sets/[id]/import` Step 4 (`v3_scA_import_preview_multimedia.png`), when a `.docx` file already contains `A. Warm front...`, the preview renders both the circular badge `A` and `A. Warm front...` (whereas the correct bold option shows `✓` + `B. Cumulonimbus...`). Stripping leading `A.`–`D.` in the preview label makes cards slightly cleaner.
2. **Smart Language Hint for English Vocabulary in Spell Mode (`P3`):** When the UI is in Vietnamese (`Tự động theo giao diện`), Spell Mode (`v3_scB_spell_mode_diff.png`) defaults TTS voice to `Microsoft An - Vietnamese` even when the flashcard word is English (`turbulence`). Offering a 1-click `EN` language pill next to `Nghe phát âm` (or defaulting English-only strings to `en-US`) would save aviation/English students a dropdown click.
3. **Practice Setup Screen Confidence Toggle Indicator (`P3`):** While enabling Confidence in `/settings` automatically activates `Chắc chắn / Phân vân / Đoán mò` inside the live Practice session (verified in `v3_final_scE_practice_confidence_before_answer.png`), the setup card's per-session confidence switch visual state can appear unchecked before pressing `Bắt đầu luyện tập`. Syncing its initial visual checked state with `preferences.confidence_enabled` avoids minor confusion.
4. **Top Navbar Theme/Language One-Tap Ergonomics (`P3`):** In the top header, clicking `VI` or the sun/moon icon works smoothly for quick toggling/selection; adding clear tooltip text (`Chuyển ngôn ngữ / Theme`) helps first-time students discover them immediately.

---

## 5. Responsive, Mobile (`390px` / `360px`), Theme, Locale & Accessibility Audit

- **Horizontal Overflow Matrix (`scrollWidth <= innerWidth`):** **16 / 16 PASS (`0px` overflow on every check):**
  - `390×844` Mobile: `/dashboard`, `/exams/new`, `/review`, `/settings` (incl. `Ngoại tuyến & Ứng dụng` tab), `/offline`, `/sets/[id]` (post-`V3-UX-01` fix), `/sets/[id]/diagrams`, `/diagrams/[id]/study`, `/sets/[id]/spell` — **all `overflowPx: 0`**.
  - `360×800` Small Mobile: `/dashboard`, `/exams/new`, `/review`, `/settings`, `/offline`, `/sets/[id]`, `/sets/[id]/diagrams`, `/sets/[id]/spell` — **all `overflowPx: 0`**.
- **Light & Dark Mode + Vietnamese & English (`vi` <-> `en`):**
  - Verified both Light Mode (Vietnamese default) and Dark Mode + English (`document.documentElement.classList.contains('dark') === true`, `lang === "en"`, `Welcome back, V3 Student DARK_EN`) with crisp contrast and zero untranslated broken keys (`v3_final_scH_dashboard_dark_en.png`).
  - User study content (English aviation terms, Vietnamese descriptions, KaTeX math) was never auto-translated when switching UI language.
- **Keyboard Navigation & Exam Integrity:**
  - `Ctrl+K` opens Global Library Search with arrow/Enter/Esc navigation across all 8 entity types (`v3_scH_ctrlk_global_search.png`).
  - **`Ctrl+K` Hard Exam Guard** verified live: pressing `Ctrl+K` during an active timed exam (`/exams/[attemptId]`) opens **0 search dialogs**.
  - `?` opens the contextual Keyboard Shortcuts Help modal documenting all 8 contexts and explicitly noting Vietnamese IME safety (`v3_scH_shortcuts_modal.png`).
  - Destructive/security actions (revoking share link, removing shared member, resetting progress) display clear confirmation dialogs (`[role="alertdialog"]`).

---

## 6. Live Environment Hygiene & Teardown Confirmation

- **Server Lifecycle:** Dedicated Wave 5 / Wave 5B local server (`npx next start -p 3021`) stopped cleanly; verified **`PORT_3021_FREE=True`** via `Get-NetTCPConnection -LocalPort 3021 -State Listen`.
- **Disposable Account Teardown:** Every test script provisioned uniquely timestamped `v3-student-*@studyhub-test.local` accounts, tracked their exact created UUIDs, and deleted ONLY those tracked accounts in `finally` blocks — every run verified **`trackedTestResourcesRemaining === 0`** (`getUserById` confirmed gone). Pre-existing live Supabase Cloud user data was strictly untouched.
- **Code & Secret Discipline:** Zero files modified outside `docs/audit/v3/USER_EXPERIENCE_REPORT.md` and `docs/audit/v3/screenshots/*`; zero `.env.local` values printed anywhere.

---

## 7. Curated Screenshot Index (`docs/audit/v3/screenshots/`)

| Scenario | File (`docs/audit/v3/screenshots/`) | What It Proves |
| --- | --- | --- |
| **A** | `v3_scA_import_preview_multimedia.png` | Step 4 Preview extracting embedded `.docx` PNG (`160×100`) & bold answer detection |
| **A** | `v3_final_scA_set_detail_fixed.png` | **AFTER (`V3-UX-01` & `V3-UX-03`):** Crisp desktop `/sets/[id]` header + Question Bank image w/ zoom badge |
| **A** | `v3_final_scA_results_multimedia.png` | Timed multimedia exam Results page with Vietnamese PDF export button |
| **B** | `v3_scB_audio_flashcards.png` | Audio Flashcards with TTS reader, microphone attach, and SM-2 rating keys (`1`–`4`) |
| **B** | `v3_scB_spell_mode_diff.png` | Spell Mode (`Nghe & Gõ`) showing `turb[u]lence` (`90%`) character diff, hints & TTS controls |
| **B** | `v3_scB_dashboard_resume.png` | `/dashboard` `"Tiếp tục học dở"` Resume Session card |
| **C** | `v3_scC_diagram_editor.png` | Saved Aircraft Diagram card (`3 nhãn`) with toast confirmation |
| **C** | `v3_scC_diagram_study_desktop.png` | Desktop Diagram Study with Point (1), Rectangle (2), Polygon (3) & all 6 study modes |
| **C** | `v3_scC_diagram_study_mobile.png` | Mobile `390×844` Diagram Study with `0px` overflow & touch-friendly zoom controls |
| **D** | `v3_final_scD_richtext_katex_fixed.png` | **AFTER (`V3-UX-04`):** TipTap Rich Text Preview rendering inline & block KaTeX (`0` errors) |
| **D** | `v3_final_scD_mixed_exam_matching_fixed.png` | **AFTER (`V3-UX-05`):** Live 5-question mixed exam rendering `matching` dropdowns crash-free |
| **D** | `v3_final_scD_mixed_exam_results.png` | Live mixed V3 exam server-scored Results page |
| **E** | `v3_final_scE_practice_confidence_before_answer.png` | **AFTER (`V3-UX-06`):** Practice Mode showing `Chắc chắn / Phân vân / Đoán mò` + Note & Report actions |
| **E** | `v3_final_scE_practice_v3_fixed.png` | **AFTER (`V3-FUNC-01` & `V3-UX-06`):** Practice Mode KaTeX rendering + inline Private Note saved toast |
| **E** | `v3_final_scE_advanced_review_populated.png` | `/review` Advanced Mistakes showing `Chưa khắc phục: 2` & **`Sai tự tin cao: 1`** badge |
| **E** | `v3_scE_scoped_reset.png` | `/settings` `Đặt lại tiến độ` clearly explaining Exam History preservation |
| **F** | `v3_final_scF_settings_offline_downloaded.png` | Mobile `390×844` Settings Offline Manager (`StudyHub: 8.4 KB · 1 học phần, 1 tệp`) |
| **F** | `v3_final_scF_offline_study_active.png` | Mobile `390×844` live Offline Study Runner (`setOffline(true)`) with cached image, 7 modes & Confidence UI |
| **G** | `v3_final_scG_error_report_resolve.png` | Account A `Hộp thư báo lỗi câu hỏi` reviewing & resolving Account B's question error report |
| **H** | `v3_scH_ctrlk_global_search.png` | `Ctrl+K` Global Library Search across 8 entity types with yellow match highlights |
| **H** | `v3_scH_shortcuts_modal.png` | `?` Contextual Keyboard Shortcuts modal noting IME safety & Hard Exam Guard |
| **H** | `v3_final_scH_dashboard_dark_en.png` | Verified Dark Mode + English (`en`) Dashboard (`Welcome back, V3 Student DARK_EN`) |
