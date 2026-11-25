# StudyHub V3.2 — Wave 5 Independent Real User Re-Evaluation Report

> **Auditor:** Agent 7 — Independent Real User (`real-user`)  
> **Tested Target:** Local Compiled Production Server (`http://127.0.0.1:3043`, `npx next start -p 3043`) connected to Live Supabase Cloud  
> **Branch / Commit:** `release/v3.2-stability` @ `7dfabfd`  
> **Date:** 2026-11-25 (UTC+7)  
> **Method & Independence:** Strictly student-perspective Playwright browser UI execution across all 7 Scenarios (`A`–`G`) on Desktop (`1440×900`), Touch Mobile (`390×844` with CDP Mobile 4G `1.6 Mbps / 750 Kbps`, `150ms RTT`, `4× CPU`), and Persistent-Profile Offline PWA. Zero direct API substitutions for student workflows, zero production edits, zero `.env.local` values printed, and zero real `sample-data/` question text quoted.

---

## 1. Executive Verdict — Before vs After Student Experience

| Dimension | Wave 1 Baseline (`39952bd`, Live Prod) | Wave 5 (`7dfabfd`, `:3043`) | Wave 6 Final (`:3053`) |
| --- | :---: | :---: | :---: |
| **Overall Student Experience Score** | **6.5 / 10** | **8.9 / 10** | **9.2 / 10** |
| **Wave 1 Pain Points Resolved (`RU-01`–`RU-21`)** | `0 / 21` (`1 P0, 8 P1, 11 P2, 1 P3`) | `20 / 21 PASS`, `1 REOPENED` (`RU-12`) | **`21 / 21 PASS`** *(see P3 `<=360px` edge-border note)* |
| **Scenarios Passing Cleanly** | `2 / 7` clean | `6 / 7` clean | **`7 / 7` clean at `390×844` & `1440×900`** |
| **App Console / Page / HTTP ≥400 Errors** | `1` offline RSC error / `0` / `0` | **`0` / `0`* / `0`** | **`0` / `0` / `0`** |

> **Final Wave 6 Release Verdict: `APPROVED FOR RELEASE` (`9.2 / 10`, `21 / 21` Wave 1 pain points resolved, `0 P0`, `0 P1`, `0 P2` open).**  
> Every **P0**, **P1**, and **P2** student pain point from Wave 1 is verified fixed — including the Wave 5 `RU-12` (`V32-035`) `390×844` Mobile Practice header clipping regression! On `390×844`, `Hoàn thành` sits cleanly inside the viewport (`right: 382 <= 390`, `88×44px`), `31/280` stays strictly single-line (`whitespace-nowrap`, `1` line), the title + `Luyện tập` sub-row is crisp, all top-bar touch targets are `>=44×44px` (`sub44HeaderCount: 0`), and horizontal overflow is `0px`.
>
> *Optional non-blocking P3 edge-polish note (`RU-12b`):* On ultra-narrow `360×800` and `320×568` viewports with a wide 3-digit counter (`31/280`), all text (`Hoàn thành` / `Xong`) remains readable and `0px` document overflow holds, but the Finish button's right border clips slightly (`right: 365 > 360` by `5px` at `360px` because `"Xong"` switches to `"Hoàn thành"` at `360px` instead of `375/380px`; and `right: 329 > 320` by `9px` at `320px`). Non-blocking for release, trivially fixable via `min-[380px]:inline` if desired.

*\*Note: In Scenario A, our own test script's `waitForFunction` callback referenced an unpassed loop variable (`q is not defined`), not StudyHub runtime code; 0 StudyHub console/page/HTTP errors occurred across Scenarios A–G.*

---

## 2. Before vs After Key Metrics Comparison

> **Environment Honesty Note:** Wave 1 Baseline was measured against live Vercel `hnd1` (`https://studyhub-three-mauve.vercel.app`); Wave 5 was measured against the locally hosted compiled production build (`http://127.0.0.1:3043`) hitting live Supabase Cloud. Final apples-to-apples live Vercel latency sign-off runs in Wave 7 after promotion.

| Real-User Metric | Wave 1 Before (Live Prod) | Wave 5 After (`7dfabfd`, `:3043`) | Result |
| --- | :---: | :---: | :---: |
| **Practice 30Q → Exit → Resume (`RU-01`, P0)** | **Wiped to `0 / 278` (`Câu 1`)** | **Restored `30 / 278` (`Câu 31`, 30 grid marks)** | **FIXED** |
| **250Q Exam F5 Reload at Q200 (`RU-02`, P1)** | Reset to `Câu 1 / 250` | **Restored `Câu 200 / 250` + opt C + 21 ans + 4 flags** | **FIXED** |
| **Exam Builder Hydration (`RU-03`, P1)** | Flashed `0 câu` + red English error | **`0` flickers, `0` English error, Step 2 above fold** | **FIXED** |
| **Mobile 4G (`390×844`, `4× CPU`) Dashboard (`RU-04`)** | `7,285 ms` | **`4,906 ms`** (`-33%`) | Improved |
| **Mobile 4G Library (`RU-04`/`RU-09`)** | `2,187 ms` (`zeroQFlicker: true`) | **`1,292 ms`** (`libEmptyFlashOnLibrary: false`) | **FIXED** |
| **Mobile 4G Open 278Q Set (`RU-04`)** | `2,150 ms` | **`846 ms`** (`-61%`) | Improved |
| **Mobile 4G Start 278Q Practice (`RU-04`)** | **`5,620 ms`** (`43/43` spinners) | **`1,456 ms`** (`-74%`, `3.86×` faster) | **FIXED** |
| **Mobile 4G 6Q Multimedia Practice (`RU-04`)** | `3,047 ms` | **`2,423 ms`** (`0` broken images) | Improved |
| **Desktop Set Overview 278Q (`RU-09`)** | `1,621 ms` | **`1,082 ms`** (`-33%`) | Improved |
| **Desktop Flashcards 15Q / Spell 15Q / Learn 15Q** | `2,599 / 2,874 / 2,662 ms` | **`1,826 / 2,203 / 2,313 ms`** (Learn Resume `991 ms`) | Improved |
| **Desktop Import Single-Pick (`RU-13`)** | Required 2 file picks; no `.pdf` | **1 pick carried straight to Step 2; `.pdf` supported** | **FIXED** |
| **English Spell TTS Voice on `vi` UI (`RU-05`)** | `Microsoft An - Vietnamese` | **`Microsoft David - English (US)` (`Tự động theo nội dung thẻ`)** | **FIXED** |
| **Learn Resume Banner after 5Q (`RU-06`)** | Lied `câu 1/15 (0%)` | **Truthful `Đã lưu tại câu 6/15 (13%)`** | **FIXED** |
| **Offline PWA Active Study Warning (`RU-07`)** | Pinned `"chưa được tải ngoại tuyến"` | **Hidden (`hasNotDownloadedWarning: false`)** | **FIXED** |
| **Offline PWA `F5` Reload (`RU-19`)** | Kicked back to `/offline` hub | **Stayed at card `4 / 278` w/ restore bar (`1,550 ms`)** | **FIXED** |
| **DOCX Image Count on Exam Q1 (`RU-08`)** | `3` (indigo duplicated side-by-side) | **`2` (1 indigo + 1 amber option; 0 duplicates)** | **FIXED** |
| **Export PDF w/ Images (6Q Exam)** | `4,383 ms` (`847 KB`, valid `%PDF-`) | **`2,431 ms`** (`847 KB`, valid `%PDF-`, `-45%`) | Improved |
| **Long Session `135` Interactions (`Scen G`)** | `24.85s` (`Q1 76ms → Q4 61ms`, `0` spikes) | **`18.82s`** (`Q1 76ms → Q4 61ms`, `0` spikes, `0` errors) | **PASS** |
| **Mobile Touch Targets `<44px` (`RU-20`)** | Dash `9`, Lib `9`, Set `2`, Prac `0` | **Dash `1`*, Lib `2`*, Set `0`, Prac `0`** *(only inline card title links)* | **FIXED** |

---

## 3. Mandatory Re-Verification Matrix (`RU-01` – `RU-21`)

| ID | Sev | Status | Verification Evidence (`7dfabfd`, `:3043`) |
| --- | :---: | :---: | --- |
| **`RU-01`** | **P0** | **PASS** | Scenario A: Answered `30/278` in Practice, exited via `Quay lại`, reopened Practice → immediately restored **`Câu 31 / 278`**, **`Đã làm: 30`**, **`Chưa làm: 248`**, all 30 green/red question grid markers, and `Đã lưu tại câu 31/278 (11%)` (`A5-practice-resumed-after-30q.png`). |
| **`RU-02`** | **P1** | **PASS** | Scenario B: Jumped to `Q200` (`52 ms`), answered option C (`idx: 2`), flagged `Q200`, pressed `F5` (`2,801 ms`) → restored directly on **`Câu 200 / 250`** with option C selected, `Đã làm: 21`, `Đánh dấu: 4`, live timer `44:53`, grid auto-scrolled to `200` (`B4-exam-after-f5-q200-restored.png`). Scenario C mobile exam reload also restored `Câu 2 / 6` directly. |
| **`RU-03`** | **P1** | **PASS** | Scenario B: Opening `/sets/[id]/test` from 278Q set showed **`zeroQFlicker: false`**, **`falseEnglishErrorFlicker: false`**, and zero overwritten question counts (`B1-exam-builder-above-fold.png`). |
| **`RU-04`** | **P1** | **PASS** | Scenario C (Mobile 4G + `4×` CPU): 278Q Practice open cut from `5,620 ms` → **`1,456 ms` (`-74%`)**, 278Q Set `2,150 ms` → **`846 ms`**, Library `2,187 ms` → **`1,292 ms`**, Dashboard `7,285 ms` → **`4,906 ms`**. |
| **`RU-05`** | **P1** | **PASS** | Scenario E: Spell Mode (`Nghe & Gõ`) now defaults `Ngôn ngữ đọc` to **`Tự động theo nội dung thẻ`**, auto-selecting **`Microsoft David - English (United States)`** instead of Vietnamese voice (`E2-spell-mode-after.png`). |
| **`RU-06`** | **P1** | **PASS** | Scenario E & C: Learn header progressed `1 / 15` → `5 / 15`; Learn Resume banner reported **`Đã lưu tại câu 6/15 (13%)`** (`E4-learn-resumed-after.png`); Spell Resume reported **`Đã lưu tại câu 3/15 (10%)`**; Mobile Dashboard showed `6/15 (13%)` (`C0-mobile-dashboard-4g-after.png`). |
| **`RU-07`** | **P1** | **PASS** | Scenario D: Reopening `/sets/[id]` while 100% offline showed **`sawFalseOnlineFlash: false`**, **`sawSignInPromptOffline: false`**, `sawOfflineStatus: true`, and listed the downloaded 278Q set immediately (`D2-offline-reopen-set-after.png`). While actively studying offline, `"Nội dung này chưa được tải ngoại tuyến"` stayed **100% hidden** (`D3-offline-studying-after.png`). |
| **`RU-08`** | **P1** | **PASS** | Scenario F: Exam Runner rendered exactly **`2`** images on indigo Q1 (1 indigo diagram + 1 amber option diagram, `F5b-exam-runner-dedup-image.png`), and Exam Results rendered **`3`** total images across all 6 questions (`F6-exam-results-dedup-after.png`) — zero duplicates. |
| **`RU-09`** | **P1** | **PASS** | Scenarios A, B, C, E: Dashboard→Library empty flicker gone (`libEmptyFlashOnLibrary: false`), header `U Tài khoản` placeholder gone (`placeholderAccountFlicker: false`), desktop Set/Flashcards/Spell/Learn loads trimmed `14–33%`. *(Re-confirm live `hnd1` API latency in Wave 7.)* |
| **`RU-10`** | **P2** | **PASS** | Scenario F: Question Editor modal has a **sticky `Hủy \| Lưu câu hỏi` footer** (`saveVisibleWithoutScroll: true`), collapsed secondary fields (`hasTwoSaveBtnsVisible: false`, visible controls reduced `38 → 33`), visible image loading skeleton box while signing URL, and plain student copy (`"Hỗ trợ 12 dạng câu hỏi & thẻ ghi nhớ..."`, `hasDevJargon: false`) (`F2b-question-editor-after.png`). |
| **`RU-11`** | **P2** | **PASS** | Scenario E: Learn Mode 5 SM-2 stage tabs removed from Screen 1 (`visibleStageTabsOnScreen1: []`), tucked into a calm **`[◎ Mục tiêu: Luyện thi ▾]`** dropdown, zero `"V3"` label, zero `Thành thạo` active mismatch (`E3-learn-mode-after.png`). |
| **`RU-12`** | **P2** | **PASS (Wave 6)** | **Wave 6 retest (`:3053`) verified:** On `390×844` (both 6Q multimedia `0/6` and 280Q wide `31/280`), `Hoàn thành` has **0px right-edge clipping** (`left: 294`, `right: 382 <= 390`, `88×44px`), `31/280` stays strictly **single-line** (`lineCount: 1`, `whitespace-nowrap`), set title + `Luyện tập` sub-row is crisp (`w: 223px`), all top-row controls are `>=44×44px` (`sub44HeaderCount: 0`), `overlaps: []`, and `overflowX: false` (`W6-mobile-practice-390x844-280q.png`, `W6-mobile-practice-390x844-multimedia.png`). Mobile Offline Exam single-pill indicator also passed (`C4`). *(Minor P3 note `RU-12b`: on `360×800` with wide `31/280`, `Hoàn thành` text is legible but its right border clips `5px` (`right: 365 > 360`); on `320×568`, `Xong` right border clips `9px` (`right: 329 > 320`) — easily resolved by bumping the `"Xong" → "Hoàn thành"` breakpoint from `360px` to `380px`.)* |
| **`RU-13`** | **P2** | **PASS** | Scenarios B & F: `/import` includes `.pdf` in `accept` & description, and choosing a file on `/import` carries it directly into Step 2 preview without re-picking (`singlePickCarriedOver: true`). |
| **`RU-14`** | **P2** | **PASS** | Scenario B: Import Preview option letter prefixes cleanly stripped (`dupPrefixOptionButtonsCount: 0`). |
| **`RU-15`** | **P2** | **PASS** | Scenario F: `/sets/[id]/edit` list rows now include explicit pencil Edit buttons (`6/6` rows) and crisp blue `[🖼 Ảnh]` badges on multimedia rows (`F2a-editor-list-after.png`). |
| **`RU-16`** | **P2** | **PASS** | Scenarios B & F: Exam Builder compacts pre-selected Step 1 so `Bước 2` & `250` preset sit above the fold (`btn250Bottom: 666 <= 900`, `B1`); Exam Results shows accurate `"Tạo đề từ 245 câu sai & chưa làm"` (and `"Tạo đề từ 5 câu chưa làm"` when 0 wrong!), unbroken `(5 / 250 câu đúng)` on line 2, and independent button spinner (`retryHasSpinner: true, exactHasSpinner: false`) (`B6`, `F6`). |
| **`RU-17`** | **P2** | **PASS** | Scenario A: Direct Focus Header mode switcher (`[Thẻ ghi nhớ ▾]`, `[Luyện tập ▾]`, `[Học sâu ▾]`, `[Nghe & Gõ ▾]`) switches modes directly (`clicksToPractice: 1`), and Flashcards front side displays primary blue `Lật thẻ để xem đáp án [Space]` above muted (`opacity: 0.6`) quick-rating buttons (`A3-flashcards-front-pre-flip.png`). |
| **`RU-18`** | **P2** | **PASS** | Scenario E: Spell Mode header displays single progress pill (`0 / 15` → `2 / 15` after answers; `hasDuplicateProgressPill: false`) (`E2-spell-mode-after.png`, `E2c-spell-after-correct.png`). |
| **`RU-19`** | **P2** | **PASS** | Scenario D: 1-click auto-start offline download (`oneClickAutoStarted: true`, `1,989 ms`), consistent `VI` language button on `/offline`, AND offline `F5` reload preserved active Flashcards runner right at card **`4 / 278`** with `"Đã khôi phục tiến độ học ngoại tuyến tại câu 4/278"` banner (`D4-offline-after-f5-after.png`). |
| **`RU-20`** | **P2** | **PASS** | Scenarios C & G: Mobile top header now includes a direct Search icon (`🔍`, 1 tap!) (`C0`, `G3`); mobile CTA & icon touch targets meet `>=44px` (`0` sub-44px on Set Overview & Practice; only inline text title links on Dashboard `1` & Library `2`); 4-tab bottom nav (`96×64px`) & `0px` horizontal overflow intact. |
| **`RU-21`** | **P3** | **PASS** | Scenarios A & B: Desktop Practice wrong-answer view applies `border-2 border-success bg-success-subtle ring-1 ring-success/30` to the correct option (`A4b`), right-hand grid shows subtle bottom fade, and toasts sit cleanly above viewport edge (`B6`, `F6`). |

---

## 4. Scenario-by-Scenario Wave 5 Highlights

- **Scenario A — Daily Learning (`17.30s`):** Fresh login (`1,777 ms`, `0` placeholder account flicker) → Library (`975 ms`) → 278Q Set (`1,082 ms`) → Flashcards (`1,845 ms`, flip med `74 ms`, next med `45 ms`, muted pre-flip rating bar + `[Thẻ ghi nhớ ▾]` direct mode switcher) → Direct switch to Practice (`1,547 ms`, `1` dropdown action) → 30Q answered (ans med `43 ms`, next med `43 ms`) → Exit → Resume (`1,217 ms`) **restored `Câu 31 / 278` & `Đã làm: 30`** → Review Mistakes (`2,578 ms`, `Chưa khắc phục (39)`).
- **Scenario B — Aviation Exam 250Q (`68.65s` incl. 4 live UI imports + full 250Q exam):** Single-pick carried `METEOROLOGY-01 (133).docx` straight to Step 2 (`2,567 ms`, `0` duplicate prefixes); appended `METEOROLOGY-08 (62).docx`, `METEOROLOGY-05 (24).xlsx`, and 60Q supplement → 278Q set. Exam Builder hydrated cleanly (`1,096 ms`, Step 2 above fold) → Generated 250Q exam (`3,918 ms`, `Ctrl+K` blocked) → Rapid Q1–Q20 (`ans med 33 ms`, `change med 34 ms`, `nav med 35 ms`, `flag med 34 ms`) → Jump Q200 (`52 ms`) → **F5 Reload (`2,801 ms`) restored `Câu 200 / 250` + option C + 21 answers + 4 flags + timer `44:53`** → Submit (`3,434 ms`) → Verified exact score (`5 / 250 = 2.00%`, `21` wrong, `224` unanswered) & accurate `"Tạo đề từ 245 câu sai & chưa làm"` with independent spinner.
- **Scenario C — Mobile 4G Throttled (`390×844`, `1.6Mbps/750Kbps`, `150ms RTT`, `4× CPU`, `24.36s`):** Dashboard `4,906 ms`, Library `1,292 ms` (`0` empty flash), 278Q Set `846 ms`, **278Q Practice `1,456 ms` (down from `5,620 ms`!)**, Multimedia Practice `2,423 ms` (`2/2` images loaded), Offline Exam disconnect/change answer/reconnect/reload **persisted 100% and restored directly on `Câu 2 / 6`**. **Caught `RU-12` regression:** `Hoàn thành` clipped at right edge & `0 / 6` pill wrapped on `390px` Mobile Practice top row.
- **Scenario D — Offline PWA (`27.93s`, persistent profile):** 1-click auto-download 278Q set (`1,989 ms`) → Disconnect + close & reopen `/sets/[id]` (`1,634 ms`, `0` false online flash, `0` sign-in prompt, consistent `VI` button) → Studied 3 cards offline (`4 / 278`, zero `"chưa được tải ngoại tuyến"` warning) → Offline `F5` reload (`1,550 ms`) **resumed card `4 / 278` inside Offline Flashcards** → Reconnect & Sync drained to `0 sự kiện chờ đồng bộ` (`0` console/page/network errors).
- **Scenario E — English Learning (`25.33s`):** Audio Flashcards (`1,826 ms`), Spell Mode (`2,203 ms`, **English TTS `Microsoft David - English (US)` auto-selected**, single `0 / 15` → `2 / 15` header pill, speed `0.75×`, wrong diff + correct verification, truthful `3/15 (10%)` resume), Learn Mode (`2,313 ms`, calm `[◎ Mục tiêu: Luyện thi ▾]` header, zero 5-tab bar, zero `"V3"`, truthful `6/15 (13%)` resume).
- **Scenario F — Multimedia Bank & PDF (`31.44s`):** Single-pick DOCX with images (`2,008 ms`) → Editor list showed `6` Edit icons & `[🖼 Ảnh]` badges → Question Editor modal showed sticky footer, student copy, collapsed notes, image skeleton → Added option A image & saved (`2,895 ms`) → Preview (`3/3`), Practice (`2/2`), Exam Runner (`2/2` on Q1, zero duplicates), Exam Results (`3/3` total, zero duplicates) → Export PDF (`2,431 ms`, `847,468 bytes`, valid `%PDF-`).
- **Scenario G — Long Session Feel (`18.82s`):** `135` continuous interactions on 278Q set, **0 progressive slowdown** (`Q1 med 76ms` → `Q2 63ms` → `Q3 76ms` → `Q4 61ms`), flat `12.78 MB` heap, `0` spikes `≥200ms`, `0` errors; Dark Mode & Light Mode logos, favicons, and 4-tab mobile bottom nav verified crisp (`G1`, `G2`, `G3`).

---

## 5. Wave 6 Independent Retest (`V32-035` / `RU-12` Mobile Practice Header)

- **Target:** Local compiled production build on `http://127.0.0.1:3053` (`npx next start -p 3053`, no concurrent rebuild).
- **Test Data:** Disposable `v32-w6-user-975979@studyhub.test` with 6Q synthetic multimedia DOCX (`0/6`) and 280Q synthetic set answered to question 31 (`31/280`) — zero `sample-data/` text quoted.

| Viewport & Set | Doc Overflow | Counter Pill | Finish Button Geometry | Title Sub-Row | Header `<44px` | Overlaps | Verdict |
| --- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **`390×844` (6Q Multimedia)** | `0 px` | `0/6` (`1` line, `nowrap`) | `Hoàn thành` `294..382 <= 390` (`88×44`) | `Multimedia Flight Instruments (W6)` + `Luyện tập` | **`0`** | `0` | **PASS** |
| **`390×844` (280Q `31/280`)** | `0 px` | `31/280` (`1` line, `nowrap`) | `Hoàn thành` `294..382 <= 390` (`88×44`) | `Aviation Meteorology 280Q Bank (W6)` + `Luyện tập` | **`0`** | `0` | **PASS** |
| **`360×800` (280Q `31/280`)** | `0 px` | `31/280` (`1` line, `nowrap`) | `Hoàn thành` `277..365` (**`+5px` right-border clip**) | Readable (`w: 223px`) + `Luyện tập` | **`0`** | `0` | **P3 edge clip (`5px`)** |
| **`320×568` (280Q `31/280`)** | `0 px` | `31/280` (`1` line, `nowrap`) | `Xong` `277..329` (**`+9px` right-border clip**) | Readable (`w: 223px`) + `Luyện tập` | **`0`** | `0` | **P3 edge clip (`9px`)** |

- **Wave 6 Screenshots:** `W6-mobile-practice-390x844-multimedia.png`, `W6-mobile-practice-390x844-280q.png`, `W6-mobile-practice-360x800-280q.png`, `W6-mobile-practice-320x568-280q.png` (saved in `docs/audit/v3.2-stability/screenshots/real-user-after/`).
- **Wave 6 Teardown & Cleanup:** `:3053` stopped (`Port 3053 LISTEN count: 0`), `v32-w6-user-975979@studyhub.test` deleted (`setsDeleted: 2`, `mediaRowsDeleted: 2`, `storageRemoved: 2`, `leftoverW6Users: 0`), real owner counts confirmed exact (`users: 2`, `sets: 3`, `questions: 599`, `exams: 2`).

---

## 6. Hygiene, Server Teardown & Cleanup Attestation

- **Local Server Teardown:** `:3043` stopped cleanly (`Port 3043 LISTEN count: 0`).
- **Zero Code Modifications:** Confirmed — zero edits to `src/*`, `supabase/*`, `tests/*`, or `ISSUE_TRACKER.md`.
- **Disposable Account & Storage Cleanup Verified (`2026-11-25`):**
  - Deleted `v32-w5-user-701225@studyhub.test` (`deletedW5UserAccounts: 1`, `sets: 3`, `mediaRows: 3`, `totalStorageObjectsRemoved: 3`).
  - Leftover `v32-w5-user-*` accounts: **`0`** | Leftover storage objects: **`0`**.
  - **Pre-existing real user data 100% untouched:** `realAuthUsers: 2`, `realStudySets: 3`, `realQuestions: 599`, `realExamAttempts: 2` (`realDataUntouched: true`).
- **After Screenshots:** `32` PNGs saved in `docs/audit/v3.2-stability/screenshots/real-user-after/`, plus 3 key full-window highlights copied to the conversation brain directory.
