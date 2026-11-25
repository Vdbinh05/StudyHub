# StudyHub V3.2 — Wave 1 Independent Real User Baseline Report

> **Auditor:** Agent 7 — Independent Real User (`real-user`)  
> **Target Environment:** Live Production — `https://studyhub-three-mauve.vercel.app`  
> **Audit Date:** 2026-11-25 (UTC+7)  
> **Method & Blindness Guarantee:** Strictly blind black-box student evaluation through real Playwright Chromium browser UI interactions (`1440×900` desktop & `390×844` touch mobile, plus real CDP Mobile 4G + 4x CPU throttling and persistent-profile PWA offline testing). **Zero** inspection or modification of `src/*`, `supabase/*`, or `tests/*`. **Zero** direct API substitutions for student workflows. **Zero** `.env.local` values printed and **zero** real question text from `sample-data/` quoted.

---

## 1. Executive Verdict — Brutally Honest Student Assessment

**Overall Student Experience Score (Pre-Fix V3.2 Baseline): 6.5 / 10 — Capable Core, Noticeable Friction & Trust Leaks**

StudyHub already has impressive functional depth: real-time option grading and card flips feel genuinely fast once a study mode loads (`9–78 ms` per desktop interaction, zero progressive slowdown across `135` continuous interactions), Dark Mode & the new StudyHub mascot branding look crisp, and the mobile 4-tab bottom navigation (`Trang chủ / Thư viện / Thi thử / Cá nhân`) fits comfortably with `0px` horizontal overflow.

**However, as an everyday student actually trying to study and prepare for a 250-question aviation exam, StudyHub repeatedly interrupts focus and undermines trust in saved progress:**

1. **Progress-loss & broken-resume trust gaps (`RU-01`, `RU-02`, `RU-06`, `RU-19`):**
   - Answering **30 questions** in Practice, clicking `Quay lại`, and re-entering Practice **wiped the session UI straight back to `0 / 278` (`Câu 1 / 278`)** with no Resume prompt (`RU-01`, **P0**).
   - Refreshing (`F5`) mid-way through a 250-question exam at `Câu 200 / 250` preserved all `21` answers and `4` flags, **but threw me all the way back to `Câu 1 / 250`** (`RU-02`, **P1**).
   - In both Learn Mode and Spell Mode, exiting after studying 5+ cards showed a Resume banner claiming **`Đã lưu tại câu 1/15 (0%)`** while the top header stayed stuck at **`0 / 15`** (`RU-06`, **P1**).
2. **Perceived wait times, skeleton storms & false error flashes (`RU-03`, `RU-04`, `RU-09`):**
   - On throttled Mobile 4G (`390×844`, `4x` CPU), Dashboard took **`7.29s`** and opening Practice on a 278-question bank took **`5.62s`** staring at spinners (`RU-04`, **P1**).
   - Even on fast desktop Wi-Fi, entering Flashcards/Learn/Spell on a tiny **15-card** set took **`2.60–2.87s`**, `/review` took **`2.63s`**, generating a 250Q exam took **`3.25s`**, and opening Exam Builder from a 278Q set flashed **`Quy mô đề: 0 câu`** and a scary untranslated red English error **`Select at least one study set or folder.`** (`RU-03`, **P1**).
   - Navigating Dashboard → Library flickered an empty/zero state (`zeroQFlicker: true`) on both desktop (`380ms`) and Mobile 4G (`2,187ms`) (`RU-09`, **P1**).
3. **Real functional & UX rough edges in English, Offline, Multimedia & Editor (`RU-05`, `RU-07`, `RU-08`, `RU-10`, `RU-11`, `RU-12`):**
   - English Spell Mode (`Nghe & Gõ`) defaulted to a **Vietnamese TTS voice (`Microsoft An - Vietnamese`)** for English vocabulary because UI language was `vi` (`RU-05`, **P1**).
   - Offline PWA worked for studying and syncing queued answers, **but permanently displayed `"Nội dung này chưa được tải ngoại tuyến"` right above the active offline study session** and initially claimed `"Trực tuyến / Đã kết nối mạng trở lại"` + `"Đăng nhập để xem..."` when reopening a downloaded set URL offline (`RU-07`, **P1**).
   - DOCX-imported question images rendered **duplicated side-by-side** in Exam Runner and Exam Results (`RU-08`, **P1**).
   - The **Question Editor modal** packed **`38` interactive controls** (`1,300px` scroll height, no sticky Save footer, **two** stacked Save buttons, blank unloaded image thumbnail on open, and leaked developer jargon `"13 dạng câu hỏi V3... KaTeX... bảo toàn mã định danh đáp án cũ"`) (`RU-10`, **P2**).
   - **Learn Mode** placed a prominent 5-tab SM-2 stage bar (`Làm quen | Ghi nhớ | Thành thạo | Ôn tập | Luyện thi`) above the question that highlighted `Thành thạo` at `0/15` while the card itself said `Bước 2 · Nhận diện` (`RU-11`, **P2**).
   - **Mobile Focus Headers** crushed study set titles to a single clipped letter (`A`, `M..`, `Thi th...`) (`RU-12`, **P2**).

### Findings Tally (`21` Confirmed Real-User Pain Points)

| Severity | Count | IDs |
| --- | :---: | --- |
| **P0 (Critical Trust / Progress Loss)** | **1** | `RU-01` |
| **P1 (High Friction / Broken Expectation / Severe Latency)** | **8** | `RU-02`, `RU-03`, `RU-04`, `RU-05`, `RU-06`, `RU-07`, `RU-08`, `RU-09` |
| **P2 (Noticeable UX Clutter / Extra Clicks / Mobile Polish)** | **11** | `RU-10`, `RU-11`, `RU-12`, `RU-13`, `RU-14`, `RU-15`, `RU-16`, `RU-17`, `RU-18`, `RU-19`, `RU-20` |
| **P3 (Minor Visual Polish)** | **1** | `RU-21` |
| **Total** | **21** | `RU-01` – `RU-21` |

---

## 2. Branding, Theme (Light & Dark), Favicon & Mobile Bottom Nav Audit

| Check Area | Verdict | Live Evidence & Notes |
| --- | :---: | --- |
| **Latest StudyHub Logo** | **PASS** | New mascot book-character logo (`/brand/logo-icon.png` `256×256`, `/brand/logo-full.png` `604×449`, `/brand/logo-full-dark.png` `604×449`) renders crisply across Landing, Login, Desktop Sidebar, Mobile Header, and Offline Hub (`00-landing-desktop-light.png`, `G2-landing-desktop-dark.png`). |
| **Favicons & App Icons** | **PASS** | All 5 manifest/link icons return HTTP `200`: `/favicon.ico`, `/favicon.png`, `/icons/icon-192.png`, `/icons/icon-512.png`, `/icons/apple-touch-icon.png`. |
| **Light & Dark Themes** | **PASS** | Theme menu (`Sáng` / `Tối` / `Theo hệ thống`) switches smoothly to deep navy/slate Dark Mode (`rgb(11, 18, 36)` bg, `rgb(241, 246, 255)` text) with proper dark logo swap and clean contrast across Desktop & Mobile (`G1-dashboard-desktop-dark.png`, `G2-landing-desktop-dark.png`, `G3-dashboard-mobile-dark.png`). |
| **4-Tab Mobile Bottom Nav** | **PASS** | `390×844` renders 4 bottom tabs in Vietnamese (`Trang chủ`, `Thư viện`, `Thi thử`, `Cá nhân`) and English (`Home`, `Library`, `Exam`, `Me`), each **`96×64 px`** (exceeds 44px guideline), `0px` horizontal overflow across every mobile screen. Tapping `Cá nhân` opens a clean `Cá nhân & Tiện ích` sheet (`G4-mobile-me-sheet-dark.png`). |
| **Language Consistency (`vi` default)** | **PARTIAL** | Default UI is Vietnamese (`vi`) and instant `VI`/`EN` toggle works. **Leaks caught:** Exam Builder loading error renders untranslated English (`Select at least one study set or folder.`) on `vi` UI (`RU-03`), Offline Hub language button displays inverted `EN` while UI is Vietnamese (`RU-19`), and landing vs editor disagree on `12` vs `13` question types (`RU-10`). |

---

## 3. Scenario-by-Scenario Execution Log & Metrics

### Summary Scorecard

| Scenario | Status | Actual Wall Duration | Console / Page / HTTP ≥400 Errors | Key Bottleneck / Pain Point |
| --- | :---: | :---: | :---: | --- |
| **A — Daily Learning** | **PARTIAL FAIL** *(Resume wiped)* | `17.52 s` | `0 / 0 / 0` | Practice exit & resume wiped `30/278` back to `0/278` (`RU-01`); `2.12s` Flashcards open; `2.63s` `/review`; Dashboard→Library `zeroQFlicker` (`RU-09`). |
| **B — Aviation Exam (250Q)** | **PASS WITH FRICTION** | `22.63 s` *(exam)* + `~6.0 s` *(3x append imports)* | `0 / 0 / 0` | F5 reload reset `Q200` → `Q1` (`RU-02`); Exam Builder red English error + `0 câu` flash (`RU-03`); `3.25s` 250Q generate / `2.94s` submit; double file-picker on `/import` (`RU-13`). |
| **C — Mobile Weak Network (`390×844`, 4G)** | **PASS WITH LATENCY** | `36.95 s` | `0 / 0 / 0` | `7.29s` Dashboard & `5.62s` 278Q Practice open (`RU-04`); crushed `A` / `M..` header titles (`RU-12`); offline disconnect/reconnect persisted 100%. |
| **D — Offline PWA** | **PASS WITH UX BUGS** | `31.56 s` | `1* / 0 / 0` *(`ERR_INTERNET_DISCONNECTED` RSC prefetch while offline)* | Download (`1.97s`), offline study (`3` queued), & sync worked; **contradictory `"Nội dung này chưa được tải ngoại tuyến"` banner stayed visible while studying** & initial reopen lied `"Trực tuyến"` (`RU-07`). |
| **E — English Learning** | **PASS WITH UX BUGS** | `26.51 s` + `13.0 s` verify | `0 / 0 / 0` | Spell TTS defaulted to Vietnamese voice for English words (`RU-05`); Learn/Spell resume banner lied `1/15 (0%)` (`RU-06`); Learn 5-tab SM-2 bar mismatch (`RU-11`). |
| **F — Multimedia Bank & PDF** | **PASS WITH VISUAL BUGS** | `25.17 s` *(editor→PDF)* + `~6 s` *(DOCX import)* | `0 / 0 / 0` | DOCX image duplicated side-by-side in Exams (`RU-08`); 38-control Question Editor modal (`1,300px`, 2 Save buttons, blank thumbnail) (`RU-10`); valid `847 KB` PDF exported in `4.38s`. |
| **G — Long Session Feel (`135` interactions)** | **PASS** | `24.85 s` | `0 / 0 / 0` | **Zero progressive slowdown** (`Q1 med 76ms` → `Q4 med 61ms`, flat `9.54 MB` heap, `0` spikes `≥200ms`). |

---

### Scenario A — Daily Learning (`Open -> Login -> Library -> Set -> Flashcards -> Practice 30Q -> Exit -> Resume -> Review Mistakes`)

- **Completion Status:** **PARTIAL FAIL** (Practice exit & resume failed to restore session progress; all other steps succeeded).
- **Actual Wall Duration:** `17,524 ms` (`17.52 s`, cold fresh Chromium context, Desktop `1440×900`).
- **Measured Timings & Transitions:**
  - Landing (`/`) cold load: `1,276 ms` | Click `Đăng nhập` → `/login`: `82 ms`.
  - Login Submit → Dashboard `<h1>` ready: **`1,988 ms`** (`9` skeleton blocks across `10/16` frames; on initial discovery pass right after `networkidle`, header account pill briefly showed `U Tài khoản` placeholder).
  - Dashboard → Library: `380 ms` (**`zeroQFlicker: true`**, `6` skeletons).
  - Library → 278Q Study Set: **`1,621 ms`** (`23` skeleton/pulse blocks across `7/13` frames).
  - Set Overview → Flashcards: **`2,116 ms`** (`7` spinner/skeleton blocks across `14/17` frames).
  - Flashcards interaction (`n=10`): Flip `Space` median `130 ms` (incl. 120ms wait = instantaneous); Next card median **`41 ms`** (`p95: 49 ms`).
  - Switch Flashcards → Practice: **Required `2` clicks** (`hasDirectPracticeLink: false`, must exit back to Set Overview first), total `1,017 ms` (`620 ms` Practice render).
  - Practice (`30` questions answered): Answer tap median **`9 ms`** (`max: 12 ms`); Next question median **`42 ms`** (`p95: 52 ms`, `max: 54 ms`). Reached `30 / 278`.
  - Exit Practice → Resume Practice: Exit `32 ms`; Re-open Practice **`1,771 ms`** (`10/14` spinner frames) → **LANDED ON `0 / 278` (`Chưa làm: 278`, `hasResumePrompt: false`)!**
  - Open Review Mistakes (`/review`): **`2,634 ms`** (`21` mistakes accurately recorded under `Chưa khắc phục (21)`).
- **Unexpected Waiting / Failed or Confusing Controls:**
  - **CRITICAL (`RU-01`):** Answering 30 questions, waiting 1s, exiting, and immediately returning to Practice lost 100% of session progress (`30/278` → `0/278`).
  - No direct mode switcher inside Flashcards (`RU-17`), and full-color SM-2 rating buttons (`Lại / Khó / Tốt / Dễ`) sit brightly active before the card is even flipped.
  - Right-side Practice grid clips `#31–35` at the box edge with no visible scroll hint; desktop wrong-answer state lacks green background highlight on the correct choice (`RU-21`).
- **Errors:** `0` console errors, `0` page errors, `0` HTTP `≥400`.
- **Screenshots:** `A1-dashboard-with-set.png`, `A2-library-desktop.png`, `A3-flashcards-front.png`, `A3b-flashcards-back.png`, `A4-practice-start.png`, `A4b-practice-answered.png`, `A5-practice-resumed.png`, `A6-review-mistakes.png`.

---

### Scenario B — Aviation Exam (`Import Real Bank -> 250Q Exam -> Rapid Nav -> Change Answers -> Mark -> Jump Q200 -> F5 Reload -> Continue -> Submit -> Verify Score -> Review`)

- **Completion Status:** **PASS WITH FRICTION** (All functional data persisted accurately; reload lost active question index and Exam Builder had hydration/layout friction).
- **Authorized Real Bank Imported via Live Import UI (filenames only, no question text quoted):**
  - `sample-data/METEOROLOGY-01. THE ATMOSTPHERE (133).docx` (`parse: 1,058 ms`, `133` valid)
  - `sample-data/METEOROLOGY-08. CLIMATOLOGY (62).docx` (`parse: 861 ms`, `commit: 1,172 ms`, `61` added / `1` duplicate skipped)
  - `sample-data/METEOROLOGY-05. PRECIPITATION (24).xlsx` (`parse: 859 ms`, `commit: 1,042 ms`, `24` added)
  - Synthetic 60Q supplement `.txt` (`parse: 858 ms`, `commit: 1,101 ms`) → **Total `278` questions** in one live study set.
- **Actual Wall Duration (Exam Flow):** `22,625 ms` (`22.63 s`).
- **Measured Timings & Verification:**
  - Set Overview → Exam Builder (`/sets/[id]/test`): `531 ms` route + `595 ms` async hydration (initial pass caught **`Quy mô đề: 0 câu`** + red untranslated English **`Select at least one study set or folder.`** before hydration finished — `B1-exam-builder.png`).
  - Generate & launch **250-question** exam: **`3,249 ms`** (`26/26` spinner frames). `Ctrl+K` global search **properly blocked** during active exam (`ctrlKBlockedDuringExam: true`).
  - Rapid Q1→Q20 (`20` answers, `5` changed answers on Q1–Q5, `3` flags on Q2/Q5/Q10): Answer median **`75 ms`** (`max: 85 ms`), Change answer median **`78 ms`**, Next nav median **`42 ms`** (`max: 51 ms`), Flag median **`88 ms`**.
  - Jump to `Q200` via `Tới câu # (1-250)` input: **`56 ms`**! Answered Q200 (option index `2`) and flagged Q200 (`Đã làm: 21`, `Đánh dấu: 4`, `Đã lưu`, timer `44:54`).
  - **F5 Reload mid-exam:** **`2,679 ms`** (`17/17` spinner frames). All `21` answers, changed Q1 answer, Q200 option index `2`, all `4` flags, and live server timer (`44:51`) **persisted accurately** — **BUT active question reset from `Câu 200 / 250` back to `Câu 1 / 250` (`RU-02`)!**
  - Continued Q201–Q205 (`median: 168 ms`/step) → Submit confirmation dialog (`Đã làm 26 | Chưa làm 224 | Đánh dấu 4`) → Submit grading & results render: **`2,937 ms`** total (`2,381 ms` post-confirm).
  - Verified score math: `9` correct + `17` wrong + `224` unanswered = `250` (`3.60%`, exact).
- **Unexpected Waiting / Confusing Controls:**
  - Double file-picker on `/import` (`RU-13`) and duplicated `(A) A. ...` prefix in Import Preview (`RU-14`).
  - Exam Builder Step 1 box takes ~400px vertical height even for 1 set, pushing Step 2 (`Chọn số câu hỏi`) completely below the fold on `1440×900` (`RU-16`).
  - Exam Results button says **`Tạo đề từ 241 câu sai`** (counting 224 unanswered questions as "câu sai") while cards right below say `Chưa đúng: 17` and `Chưa làm: 224`; clicking it triggered the loading spinner on the **wrong sibling button** (`Làm lại chính xác đề này`) (`B7-exam-review-incorrect.png`), and the score heading broke awkwardly as `3.60% (9` / `/ 250 câu đúng)` (`RU-16`).
- **Errors:** `0` console errors, `0` page errors, `0` HTTP `≥400`.
- **Screenshots:** `04-import-page-desktop.png`, `06-import-wizard-empty.png`, `07-import-wizard-preview-met1.png`, `07b-import-complete-met8.png`, `08-set-overview-279q-desktop.png`, `B1-exam-builder.png`, `B1b-exam-builder-250q.png`, `B1c-exam-builder-step2.png`, `B2-exam-runner-250q-q1.png`, `B3-exam-q200-before-reload.png`, `B4-exam-after-f5-reload.png`, `B5-exam-submit-confirm-dialog.png`, `B6-exam-results-250q.png`, `B7-exam-review-incorrect.png`.

---

### Scenario C — Mobile Weak Network (`390×844`, Mobile 4G `1.6 Mbps / 750 Kbps`, `150ms RTT`, `4× CPU`)

- **Completion Status:** **PASS WITH LATENCY & HEADER CRUSH** (End-to-end mobile study, multimedia loading, answer changing, offline disconnect, and reconnect persistence all succeeded).
- **Actual Wall Duration:** `36,952 ms` (`36.95 s`).
- **Measured Timings (Mobile 4G + 4x CPU):**
  - Open Dashboard: **`7,285 ms`** (`9` skeletons across `26/45` frames).
  - Tap `Thư viện` bottom nav → Library: **`2,187 ms`** (**`zeroQFlicker: true`**, `16/16` spinner frames).
  - Open large 278Q set: **`2,150 ms`** (`23` skeletons across `11/16` frames).
  - Start Practice on 278Q set: **`5,620 ms`** (`43/43` spinner frames — **over 5.6 seconds of blank wait!**). Answer taps once loaded: median `249 ms` (`max: 268 ms`, acceptable under 4x CPU).
  - Start Practice on 6Q Multimedia set: **`3,047 ms`** (`20/20` spinner frames). Both question image (`320×180`) and option image (`240×140`) rendered cleanly (`broken: 0`).
  - Mobile Multimedia Exam: Change answer A → B (`329 ms`), toggle **100% Offline**, answer Q2 & change answer to C (`idx: 2`), **Reconnect** → Reload: **`q1PersistedExpected1: true`**, **`q2OfflinePersistedExpected2: true`**!
- **Mobile Touch Ergonomics & Visual Findings:**
  - Horizontal overflow: **`false` (`390 === 390`)** on every tested mobile view.
  - Bottom navigation: 4 tabs (`Trang chủ / Thư viện / Thi thử / Cá nhân`), `96×64 px` each — comfortable thumb targets.
  - Sub-44px targets: Practice `0`, 278Q Set `2` (logo/breadcrumb), Dashboard `9` (`36×40px` icon button, `40px` links), Library `9` (`36×40px` quick-play icons, `40px` buttons) (`RU-20`).
  - **Crushed Focus Header (`RU-12`):** Mobile Practice header compresses the study set title to **`A`** (`C2`) or **`M..`** (`C3`), and Mobile Exam compresses it to **`Thi th...`** (`C4`).
  - **Triple Offline Stacking (`RU-12`):** When offline during a Mobile Exam (`C4`), 3 stacked offline indicators (top yellow bar truncated with `...`, yellow header icon pill, and amber in-page warning box) consume ~180px of vertical screen space.
- **Errors:** `0` console errors, `0` page errors, `0` HTTP `≥400`.
- **Screenshots:** `C0-mobile-dashboard-4g.png`, `C1-mobile-278q-set.png`, `C2-mobile-practice-278q.png`, `C3-mobile-multimedia-practice.png`, `C4-mobile-offline-during-exam.png`, `C5-mobile-reconnected-verified.png`.

---

### Scenario D — Offline PWA (`Download -> Disconnect -> Close & Reopen -> Study Offline -> Refresh -> Reconnect -> Sync`)

- **Completion Status:** **PASS WITH UX BUGS** (Persistent Chromium profile with active Service Worker `studyhub-v3-shell-v2` and user-partitioned IndexedDB `studyhub-offline-v3:<userId>`).
- **Actual Wall Duration:** `31,560 ms` (`31.56 s`).
- **Measured Timings & Offline Behavior:**
  - Service Worker active & controlling (`hasController: true`).
  - Download 278Q set (`Tải về học ngoại tuyến` → confirmation modal → `Tải về học ngoại tuyến`): **`1,967 ms`**, stored **`703 KB`** cleanly in `studyhub-offline-v3:<userId>`.
  - Disconnect (`setOffline(true)`), **close tab, reopen brand-new tab**:
    - Opening `/sets/[id]` offline served `/offline` in `1,517 ms`, **but initially displayed green `Trực tuyến`, `"Đã kết nối mạng trở lại"`, and `"Đăng nhập để xem và quản lý các học phần ngoại tuyến"`** (`D2a`, `RU-07`) until refreshed!
    - Opening `/offline` listed `Aviation Meteorology 250+ Bank (V32) · Sẵn sàng`.
  - **Study Offline:** Tapped `Học ngoại tuyến`, studied 3 flashcards offline (`3 / 278`), queuing **`3 mục chờ đồng bộ`** in IndexedDB (`D3`, `D3b`).
    - **Contradictory Warning (`RU-07`):** While actively studying card `3 / 278` offline, the giant warning box **`Nội dung này chưa được tải ngoại tuyến — Vui lòng kết nối lại mạng hoặc mở một trong các học phần bạn đã tải sẵn bên dưới`** remained pinned right above the study card!
  - **Offline Refresh (`F5`):** Page reloaded cleanly offline in `1,516 ms` (`D4`) and preserved **`3 sự kiện chờ đồng bộ`** — **but exited the active Flashcard session back to the `/offline` hub (`RU-19`)**.
  - **Reconnect & Synchronize:** Reconnected → visited `/settings?tab=offline` → clicked `Đồng bộ ngay` → queue drained cleanly to **`0 sự kiện chờ đồng bộ · Đồng bộ lần cuối: 20:49 25-11`** (`D5`), and Dashboard reflected the synced flashcard checkpoint (`3/278 (1%)`) (`G1`).
- **Errors:** `1` expected `net::ERR_INTERNET_DISCONNECTED` console/network error from a background `/dashboard?_rsc` prefetch while offline; `0` page errors; `0` HTTP `≥400`.
- **Screenshots:** `D1-offline-downloaded-278q.png`, `D1b-offline-settings.png`, `D2a-offline-reopen-set-url.png`, `D2b-offline-reopen-offline-route.png`, `D3-offline-studying.png`, `D3b-offline-after-5-answers.png`, `D4-offline-after-refresh.png`, `D5-offline-synced.png`.

---

### Scenario E — English Learning (`Audio Flashcards -> Spell Mode -> Speed -> Wrong/Correct -> Learn SM-2 -> Exit & Resume`)

- **Completion Status:** **PASS WITH SIGNIFICANT UX BUGS** (Synthetic 15-term English aviation vocabulary TSV set imported cleanly).
- **Actual Wall Duration:** `26,506 ms` + `13,000 ms` verification pass.
- **Measured Timings & Behavior:**
  - Open Audio Flashcards (15 cards): **`2,599 ms`** (`17/17` spinner frames — slow even for 15 cards!). Speaker TTS button (`Đọc nội dung thẻ`) worked; flip median `169 ms`.
  - Open Spell Mode (`Nghe & Gõ`): **`2,874 ms`** (`20/20` spinner frames).
    - **CRITICAL ENGLISH-LEARNING BUG (`RU-05`):** Default `Ngôn ngữ đọc: Tự động theo giao diện` selected **`Microsoft An - Vietnamese (Vietnam)`** to pronounce English words (`altitude`, `turbulence`, etc.) because the UI language was `vi`!
    - Playback speed dropdown worked (`0.6×`, `0.75×`, `0.9×`, `1×`, `1.25×`, `1.5×`; switched to `0.75×`, plus one-click `Nghe chậm (0.7×)`).
    - Wrong answer (`wrongspellingxyz`) produced an excellent character-level color diff (`Chưa chính xác (khớp 13%)`, `Đáp án chuẩn: altitude`, `0` `[object Object]` leaks).
    - Correct answer (`altitude`) verified `Đúng (có dùng gợi ý)!`, **but top header showed duplicated `0 / 15` | `0/15` pills (`RU-18`) and Resume banner showed `Đã lưu tại câu 1/15 (0%)` (`RU-06`)**.
  - Open Learn Mode (`Học sâu`): **`2,662 ms`** (`19/19` spinner frames).
    - **SM-2 Stage Clutter & Contradiction (`RU-11`):** Prominent 5-tab bar (`Làm quen | Ghi nhớ | Thành thạo | Ôn tập | Luyện thi`) sat above the card with **`Thành thạo` highlighted active in blue** despite `Thành thạo: 0/15` and the card badge saying **`Bước 2 · Nhận diện`**, plus leaked internal label `"Chế độ Học thích ứng V3"`.
    - Studied 5 questions (`median 463 ms` incl. 450ms wait; `0` `[object Object]` on MCQ recognition cards), advancing to word #6 (`precipitation`).
  - **Exit & Resume Learn Mode (`1,388 ms`):** Resume card appeared — **but falsely claimed `Đã lưu tại câu 1/15 (0%)`** (`E4`, `RU-06`). Clicking `Tiếp tục học` DID restore word #6 (`precipitation`, `Bước 1 · Làm quen`), proving internal checkpoint saved while the visible counter & banner lied!
- **Errors:** `0` console errors, `0` page errors, `0` HTTP `≥400`.
- **Screenshots:** `E1-audio-flashcards.png`, `E1b-more-modes-expanded.png`, `E2-spell-mode.png`, `E2b-spell-wrong-answer.png`, `E2c-spell-correct-answer.png`, `E3-learn-mode-sm2.png`, `E3b-learn-answered.png`, `E4-learn-resumed.png`.

---

### Scenario F — Multimedia Question Bank (`DOCX w/ Images -> Question Editor Density -> Option Image -> Save -> Preview -> Practice -> Exam -> Export PDF`)

- **Completion Status:** **PASS WITH VISUAL & EDITOR UX DEFECTS** (Synthetic 6-question `.docx` with 2 embedded PNG diagrams + standalone PNG option image).
- **Actual Wall Duration:** `25,173 ms` *(editor through PDF)* + `~6 s` *(create set + DOCX import)*.
- **Measured Timings & Behavior:**
  - Import DOCX w/ images: Parsed cleanly as `Word có hình ảnh (.docx)`, extracted `6` questions + embedded diagrams (`F1-multimedia-import-preview.png`).
  - Question Editor list (`/sets/[id]/edit`): **Zero Edit button/icon and zero image badge** on rows — only checkbox & red Delete trash icon (`F2a`, `RU-15`).
  - **Question Editor Modal Control Density (`F2b`, `F2c`, `RU-10`):**
    - Open modal: `625 ms`. Dimensions: `768×810 px`, scrollHeight **`1,300 px`** (`1.6×` dialog height, requires scrolling to reach `Lưu` — no sticky footer).
    - Interactive control count: **`38` controls** (`18` inputs/textareas/selects + `20` buttons) inside one modal.
    - Attached question image showed an **empty blank white box** (`complete: false, naturalWidth: 0`) 500ms after opening (`F2b`).
    - Subtitle leaked engineering jargon (`"Hỗ trợ đầy đủ 13 dạng câu hỏi V3, định dạng phong phú + LaTeX (KaTeX) và bảo toàn mã định danh đáp án cũ."`), also conflicting with landing page's `12 dạng câu hỏi`.
    - Two Save buttons stacked right above each other (`Lưu ghi chú` + `Lưu`).
  - Upload `option-diagram.png` to Option A: Succeeded (`2,525 ms`), thumbnail rendered (`240×140`, `F3`), Save succeeded (`1,430 ms`).
  - Set Overview Preview (`3,322 ms`): `3/3` images loaded cleanly (`0` broken, `F4`).
  - Practice (`1,623 ms`): `2/2` images loaded cleanly with zoom lightbox (`F5`).
  - Create & Run Exam (`2,238 ms`): **VISUAL BUG (`RU-08`) — Q1 rendered TWO identical indigo question images side-by-side** (`examMedia.totalImages: 3` on a 2-image question, also visibly duplicated in Exam Results behind `F6-export-pdf-dialog.png`!).
  - **Export PDF** (`Đề thi kèm đáp án & giải thích chi tiết` + `Nhúng hình ảnh đính kèm vào PDF`): Downloaded in **`4,383 ms`**, **`847,424 bytes`**, verified valid **`%PDF-`** header (`Thi thử — Multimedia Flight Instruments (V32)-paper_with_explanations.pdf`).
- **Errors:** `0` console errors, `0` page errors, `0` HTTP `≥400`.
- **Screenshots:** `F1-multimedia-import-preview.png`, `F2a-editor-list.png`, `F2b-question-editor-density.png`, `F2c-question-editor-options-area.png`, `F3-editor-option-image-added.png`, `F4-multimedia-set-preview.png`, `F5-multimedia-practice.png`, `F6-export-pdf-dialog.png`.

---

### Scenario G — Long Session Feel (`135 Continuous UI Interactions on 278Q Set`)

- **Completion Status:** **PASS** (Excellent sustained responsiveness; zero memory/DOM degradation or sluggishness over time).
- **Actual Wall Duration:** `24,851 ms` (`24.85 s` for 135 continuous interactions + Dark Mode & Mobile Sheet audit).
- **Interaction Mix (`135` total):** `40` Practice answers, `35` Practice next, `5` Practice prev, `5` Jump-to-question (`Q50/120/180/220/260`), `5` Note dialog opens + `5` closes, `20` Flashcard flips, `16` Flashcard next, `4` Flashcard prev.
- **Quartile Responsiveness Trend (Progressive Sluggishness Check):**

| Quartile | Interactions | Min | Median | p95 | Max | Avg |
| --- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Q1 (Start)** | `#1–33` | `55 ms` | **`76 ms`** | `169 ms` | `169 ms` | `78 ms` |
| **Q2** | `#34–66` | `48 ms` | **`76 ms`** | `162 ms` | `168 ms` | `78 ms` |
| **Q3** | `#67–99` | `30 ms` | **`66 ms`** | `108 ms` | `169 ms` | `71 ms` |
| **Q4 (End)** | `#100–135` | `29 ms` | **`61 ms`** | `78 ms` | `80 ms` | `53 ms` |

- **DOM & Heap Stability:** Start `332` DOM nodes / `9.54 MB` heap → After 95 Practice ops `406` nodes / `9.54 MB` → After 40 Flashcard ops `215` nodes / `9.54 MB`. **Zero spikes `≥ 200 ms`** (`slowSpikesOver200ms: []`).
- **Per-Interaction Medians:** Practice answer `66 ms`, Practice next `72 ms`, Practice prev `81 ms`, Jump-to-Q `59 ms`, Dialog open `169 ms`, Dialog close `109 ms`, Flashcard flip `31 ms`, Flashcard next `78 ms`.
- **Errors:** `0` console errors, `0` page errors, `0` HTTP `≥400`.
- **Screenshots:** `G1-dashboard-desktop-dark.png`, `G2-landing-desktop-dark.png`, `G3-dashboard-mobile-dark.png`, `G4-mobile-me-sheet-dark.png`.

---

## 4. Master Real-User Pain Point Register (`RU-01` – `RU-21`)

| ID | Sev | Scenario(s) | Pain Point & Honest Student Impact | Evidence | Recommended UX Direction |
| --- | :---: | :---: | --- | --- | --- |
| **`RU-01`** | **P0** | A | **Practice Mode loses session progress on Exit & Resume (`30/278` → `0/278`).** Exiting Practice after 30 questions and returning drops the student back to `Câu 1 / 278` (`Đã làm: 0`, `Chưa làm: 278`) with zero Resume banner. | `A4b-practice-answered.png` → `A5-practice-resumed.png` | Persist Practice checkpoint & answered map immediately on every answer + `pagehide`, and auto-resume or display an accurate Resume banner on re-entry. |
| **`RU-02`** | **P1** | B | **250Q Exam F5 Reload resets active question from `Câu 200 / 250` back to `Câu 1 / 250`.** Answers (`21`), flags (`4`), and timer survive, but students lose their place in a 250-question exam after a page refresh. | `B3-exam-q200-before-reload.png` → `B4-exam-after-f5-reload.png` (`2,679 ms`) | Persist `currentQuestionIndex` in local exam draft / URL hash (`#q=200`) and restore it on reload. |
| **`RU-03`** | **P1** | B | **Exam Builder flashes `Quy mô đề: 0 câu` + untranslated red English error (`Select at least one study set or folder.`) while hydrating**, and overwrites early question-count input back to `50`. | `B1-exam-builder.png`, `B1b-exam-builder-250q.png` | Suppress validation banners until study sets finish loading, localize all validation copy to `vi`, and never clobber user-edited count. |
| **`RU-04`** | **P1** | C | **Slow Mobile 4G (`390×844`, `4x` CPU) loads: `7.29s` Dashboard, `5.62s` 278Q Practice (`43/43` spinner frames), `3.05s` 6Q Multimedia Practice.** Breaks mobile study momentum. | Scenario C timings (`C0`–`C3`) | Eliminate redundant mode-entry waterfalls, hydrate first question immediately from summary/prefetch, and reduce initial mobile JS/hydration cost. |
| **`RU-05`** | **P1** | E | **English Spell Mode defaults TTS voice to Vietnamese (`Microsoft An - Vietnamese`) when UI is `vi`**, mangling English vocabulary pronunciation. | `E2-spell-mode.png` | Detect card/set text language (e.g., ASCII English vs Vietnamese diacritics) instead of binding TTS language strictly to UI locale `vi`. |
| **`RU-06`** | **P1** | E, C | **Learn & Spell Mode Resume Checkpoint banner lies (`Đã lưu tại câu 1/15 (0%)`) and top counter stays stuck at `0 / 15`** even after completing 5+ questions (and persists onto Dashboard `Tiếp tục học dở`). | `E4-learn-resumed.png`, `E2c-spell-correct-answer.png`, `C0-mobile-dashboard-4g.png` | Save & display the true visited/completed card index & percentage in both mode headers and checkpoint banners. |
| **`RU-07`** | **P1** | D | **Offline PWA shows contradictory `"Nội dung này chưa được tải ngoại tuyến"` warning permanently above active offline study (`D3`/`D3b`)**, and reopening `/sets/[id]` offline initially shows green `"Trực tuyến / Đã kết nối mạng trở lại"` + `"Đăng nhập để xem..."` (`D2a`). | `D2a-offline-reopen-set-url.png`, `D3-offline-studying.png`, `D3b-offline-after-5-answers.png` | Hide the "not downloaded" hero card whenever an offline study session is active, and initialize `/offline` online/auth state accurately from `navigator.onLine` + cached user metadata before first paint. |
| **`RU-08`** | **P1** | F | **DOCX-imported question image renders DUPLICATED side-by-side in Exam Runner & Exam Results** (`3` images rendered on a 2-image Q1; visible double indigo diagram). | `F6-export-pdf-dialog.png`, Scenario F `examMedia` | Deduplicate `image_url` against `attachments` / `image_urls` when rendering exam question snapshots. |
| **`RU-09`** | **P1** | A, C, E, B | **Empty/zero-set flicker on Dashboard→Library (`zeroQFlicker: true`), Dashboard post-login skeleton stall (`1,988 ms` + placeholder `U Tài khoản`), and `2.1–3.3s` desktop loads** (`2.12s` Flashcards, `2.60–2.87s` 15-card English modes, `2.63s` `/review`, `3.25s` 250Q exam start, `2.94s` submit). | `02-dashboard-desktop-light.png`, `02b-dashboard-desktop-dark.png`, Scenarios A/B/C/E | Stream/hydrate initial SSR data cleanly, avoid rendering empty states before first fetch settles, and eliminate redundant post-navigation refetches. |
| **`RU-10`** | **P2** | F | **Question Editor modal control overload (`38` controls, `1,300px` height, no sticky Save footer, two stacked Save buttons `Lưu ghi chú` + `Lưu`, blank unloaded image box on open, internal engineering jargon subtitle `"13 dạng câu hỏi V3... KaTeX... bảo toàn mã định danh đáp án cũ"`).** | `F2b-question-editor-density.png`, `F2c-question-editor-options-area.png` | Add sticky modal footer (`Hủy` / `Lưu`), collapse secondary metadata (Tags, Hint, Personal Notes) into an accordion, show image skeleton while signing URL, and replace developer jargon with plain student copy (align `12` vs `13` types). |
| **`RU-11`** | **P2** | E | **Learn Mode SM-2 5-tab header clutter & stage contradiction:** `Làm quen \| Ghi nhớ \| Thành thạo \| Ôn tập \| Luyện thi` dominates the top, highlights `Thành thạo` active at `0/15` while the card displays `Bước 2 · Nhận diện`, and shows internal `"V3"` label. | `E3-learn-mode-sm2.png` | De-emphasize SM-2 stage chrome into a compact progress pill or collapsible details popover, align active stage state with real mastery, and drop `"V3"` branding. |
| **`RU-12`** | **P2** | C | **Crushed Mobile Focus Header titles (`A`, `M..`, `Thi th...`) & triple stacked offline indicators** on `390×844` mobile. | `C2-mobile-practice-278q.png`, `C3-mobile-multimedia-practice.png`, `C4-mobile-offline-during-exam.png` | Hide or move the long set title into a clean sub-row or concise counter-first mobile bar, and consolidate mobile offline status to a single compact banner. |
| **`RU-13`** | **P2** | B | **Double file-picker friction on `/import` + omitted `.pdf` support on `/import` entry screen:** Choosing a file under `"Suggest title from file"` drops the file on navigation to `/sets/[id]/import`, forcing re-upload; `/import` `accept` omits `.pdf` while Landing/Wizard advertise `.pdf`. | `04-import-page-desktop.png`, `06-import-wizard-empty.png` | Pass the selected `File` directly into the wizard (or combine into 1 step) and add `.pdf` to `/import` copy & `accept`. |
| **`RU-14`** | **P2** | B, F | **Import Preview shows duplicated option letter prefixes (`(A) A. ...`, `(✓) B. ...`)** before commit on both real and synthetic DOCX files. | `07-import-wizard-preview-met1.png`, `F1-multimedia-import-preview.png` | Strip leading `A.`/`B.`/`C.`/`D.` prefixes before rendering preview chips (matching Set Overview/Practice). |
| **`RU-15`** | **P2** | F | **Question Editor list rows (`/sets/[id]/edit`) lack any Edit affordance or attached-image indicator** — only checkbox and red Delete trash icon appear. | `F2a-editor-list.png` | Add an explicit Edit pencil icon/button and a small image/audio badge on rows with media. |
| **`RU-16`** | **P2** | B | **Exam Builder pushes Step 2 below fold on `1440×900` (`B1b`); Exam Results labels 224 unanswered Qs as `"241 câu sai"`, wraps `3.60% (9` awkwardly, and spins the wrong button (`Làm lại chính xác đề này`) on click.** | `B1b-exam-builder-250q.png`, `B6-exam-results-250q.png`, `B7-exam-review-incorrect.png` | Compact Step 1 when a set is pre-selected from `/sets/[id]`, say `"241 câu sai & chưa làm"`, keep score fraction `whitespace-nowrap`, and scope button loading states independently. |
| **`RU-17`** | **P2** | A, E | **No direct mode switcher inside Flashcards/Practice (`2` clicks via Set Overview) + Flashcards shows full-color SM-2 rating buttons before card is flipped.** | `A3-flashcards-front.png`, `E1-audio-flashcards.png` | Add a compact mode switcher dropdown in Focus Header and mute/reveal rating buttons cleanly on card flip. |
| **`RU-18`** | **P2** | E | **Spell Mode duplicates progress badge (`0 / 15` \| `0/15`) side-by-side in header** and leaves the primary `0 / 15` badge unchanged after a correct submission. | `E2-spell-mode.png`, `E2c-spell-correct-answer.png` | Remove duplicate badge and increment progress counter immediately on confirmed answers. |
| **`RU-19`** | **P2** | D | **Offline `F5` refresh kicks user out of active offline study back to `/offline` hub**, download requires an extra confirmation modal click, and `/offline` language button shows inverted `EN` when UI is Vietnamese. | `D1-offline-downloaded-278q.png`, `D4-offline-after-refresh.png` | Persist active offline set/mode/card in URL hash or sessionStorage across offline reloads, and standardize language toggle label (`VI` when in Vietnamese). |
| **`RU-20`** | **P2** | C, G | **Mobile touch targets dip below `44px` (`36×40px` / `40px` height)** on Dashboard (`9` controls) and Library (`9` controls), and Mobile Global Search sits 2 taps inside `Cá nhân` sheet rather than top bar. | Scenario C ergonomics, `C0-mobile-dashboard-4g.png`, `G4-mobile-me-sheet-dark.png` | Bump mobile icon buttons & card CTAs to `min-h-11 min-w-11` (`44px`) and consider a compact search icon in the mobile top header. |
| **`RU-21`** | **P3** | A, B | **Minor polish:** Practice right-side grid clips `#31–35` with no visible scroll hint (`A4b`); desktop Practice wrong-answer view lacks green row highlight on the correct option (`A4b`, unlike Mobile/Multimedia `C2`/`F5`); bottom-right toast clips slightly during transition (`02`, `07b`). | `A4b-practice-answered.png`, `02-dashboard-desktop-light.png`, `07b-import-complete-met8.png` | Add subtle fade/scrollbar indicator on question grid, apply consistent green highlight to correct answers in desktop Practice, and add bottom inset to toast viewport. |

---

## 5. Hygiene, Cleanup & Independence Attestation

- **Zero Source Code Access / Edits:** Confirmed — `src/*`, `supabase/*`, and `tests/*` source files were **never read or modified** during Wave 1.
- **Zero Secrets / Question Text Leaks:** Confirmed — zero `.env.local` values printed and zero real question/option content from `sample-data/` quoted.
- **Disposable Account & Resource Cleanup Verified (`2026-11-25`):**
  - Account created & deleted: `v32-user-962612@studyhub.test` (`deletedV32UserAccounts: 1`, `sets: 3`, `mediaRows: 3`, `storageObjectsRemoved: 3`).
  - Remaining `v32-user-*` accounts: **`0`** | Remaining storage objects under test prefix: **`0`**.
  - **Pre-existing real user data 100% untouched:** `realAuthUsers: 2` (baseline `2`), `realStudySets: 3` (baseline `3`), `realQuestions: 599` (baseline `599`), `realExamAttempts: 2` (baseline `2`).
- **Artifacts & Screenshots Stored:**
  - Report: `docs/audit/v3.2-stability/WAVE1_REAL_USER_BASELINE.md`
  - Full screenshot set (`62` PNGs): `docs/audit/v3.2-stability/screenshots/real-user-before/`
  - Key full-window highlights copied to conversation brain directory for coordinator review (`v32-realuser-question-editor-density.png`, `v32-realuser-learn-mode-sm2.png`, `v32-realuser-mobile-multimedia-practice.png`).
