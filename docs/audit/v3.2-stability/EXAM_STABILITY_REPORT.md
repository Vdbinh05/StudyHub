# StudyHub V3.2 — Wave 6 Exam Stability, Scoring & Full Coverage Report (`EXAM_STABILITY_REPORT.md`)

> **Auditor:** Agent 6 — Independent Functional Tester (`func-tester-2`, zero edits to `src/*` or `supabase/*`)  
> **Target:** Compiled local production server (`http://127.0.0.1:3051`) connected to live Supabase Cloud (PostgreSQL 17.12)

---

## 1. Executive Verdict

All **core exam data-loss P0s (`V32-002`, `V32-004`, `V32-005`)**, **all 12 exam question types (`V32-022`)**, **shortcut & hard exam guard (`V32-023`)**, **F5 reload question-index resume (`V32-027`)**, **rapid-click / double-submit stress (`V32-028`)**, **Exam Results & Clone (`V32-039`)**, and **500Q Full Coverage + Mid-Cycle Deletion (`V32-010`)** **PASSED** live verification!

> **Wave 6B Resolution (`V32-030` / `FUNC-21b` — VERIFIED PASS):** The initial Wave 6 `500` crash on `POST /api/export/pdf` (`mode: "question_paper"`) for `in_progress` V3 exams containing `fill_in_blank`, `matching`, or `image_hotspot` was fixed in Wave 6B and independently retested on `:3051` -> now returns **`200 OK` (`841,078 B`, `%PDF-`, `zeroSecretLeak: true`)** while preserving **`403`** on `paper_and_key` / `paper_with_explanations`!

---

## 2. Core Exam Data Integrity & Recovery Verification

| Issue ID | Test Scenario | Live Measured Evidence | Verdict |
| :--- | :--- | :--- | :---: |
| **`V32-002`** (`FUNC-01`, P0) | Pre-submit resume of `structured_response`, `confidence`, `hint_used` + Flag toggle must NOT wipe DB answer to `NULL` | Saved `{ kind: "numerical", value: "9.8", numeric_value: 9.8, unit: "m/s2" }`, `confidence: "certain"`, `hint_used: true` (`PUT 200`). `GET /api/exams/[id]` returned all 3 fields with `0` leaked answer keys (`preSubmitHasNoLeaks: true`). After `localStorage.clear()` + reload, UI restored `"9.8"`. Toggling Flag fired `PUT` (`client_seq: 3`, `is_flagged: true`) while preserving `numeric_value: 9.8` & `confidence: "certain"`. Post-submit graded **`is_correct: true`**. | **PASS** |
| **`V32-004`** (`FUNC-03`, P0) | Fast reload (`<150ms`) immediately after clicking Q1 option | Clicked `"Hanoi"` and reloaded immediately with `0ms` sleep. Synchronous `studyhub-exam-draft-v3:<userId>:<attemptId>` captured selection; post-reload UI showed `aria-checked="true"` and server DB persisted `selected_option_ids: ["1e78eb5e-..."]`. | **PASS** |
| **`V32-005`** (`FUNC-04`, P0) | Merged offline `localStorage` draft auto-flush + honest sync badge | Went offline (`setOffline(true)`), answered Q1 -> header badge switched to `"Ngoại tuyến"` (NOT green `"Đã lưu"`). Reconnected + reloaded with zero clicks -> `autoFlushPuts: 2`, DB `savedCountAfterAutoFlush: 1`, badge transitioned to `"Đã lưu"`. | **PASS** |
| **`V32-022`** (`FUNC-10`, `RU-08`, P1) | All 12 exam types + DOCX image dedup + `listening+fill_in_blank` + `ordering` Confirm + `numerical` unit badge | Q1 (`prompt_image_url` + matching `media_attachments`) rendered strictly **`1`** `<img>` (`q1ImgCount: 1`). `listening+fill_in_blank` rendered `1` `<audio>`, `1` blank input, **`0`** `<textarea>`. `ordering` rendered explicit `"Xác nhận thứ tự"` button (`ordConfirmVisible: true`). `numerical` (`unit_required: false`, `unit: "hPa"`) showed `hPa` badge (`numOptShowsHpa: true`); `unit_required: true` masked placeholder (`"Nhập đơn vị đo (bắt buộc)"`, no `"m/s2"` leak). | **PASS** |
| **`V32-023`** (`FUNC-11`, P1) | Single `?` shortcut dialog + modal/IME guard + `Ctrl+K` Hard Exam Guard | Pressing `?` in active exam opened strictly **`1`** `[role="dialog"]` (down from 2 overlapping modals); `ArrowRight` while dialog open did NOT mutate question (`modalBlockedArrow: true`); `1` `Escape` closed to `0`; `Ctrl+K` strictly blocked (`dialogsOnCtrlK: 0`). | **PASS** |
| **`V32-027`** (`RU-02`, P1) | `F5` reload restores active question index (not Q1) | Jumped to Q5 (`Câu 5 / 6`), pressed `F5` reload -> restored directly to **`Câu 5 / 6`** (`restoredQ5: true`). | **PASS** |
| **`V32-036`** (`FUNC-25`, P2) | `image_hotspot` tight pin wrapper alignment | Short wide banner (`320×100px`) rendered inside tight wrapper `322×102px` (`heightDelta: 2px` border only — zero `min-h-48` pin offset). | **PASS** |
| **`V32-039`** (`FUNC-28`, `RU-16`, P2) | Exam Results accurate labels & `?cloneAttemptId=` config preservation | Results displays `"câu sai & chưa làm"` (`hasIncorrectAndUnansweredLabel: true`); `/exams/new?cloneAttemptId=<id>` preserved `13` question count & settings (`clonePreserved13: true`). | **PASS** |

---

## 3. Full Coverage & Multi-Subject Allocation Matrix (`V32-010` / `FUNC-07`)

| Test Scenario | Setup | Measured Result | Overlap / Loss | Verdict |
| :--- | :--- | :--- | :---: | :---: |
| **Mid-Cycle Delete Unassigned Questions (`FUNC-07`)** | 4Q set, `questions_per_exam: 2`. Complete Exam 1 (`2/4`), then **delete** the 2 remaining unassigned source questions. | `GET /api/coverage-cycles` automatically transitioned cycle to **`status: "completed"`**, **`remainingCount: 0`** (eliminated the permanent `active` + `remaining_count: 2` / `409` wedge). | `0` wedged cycles | **PASS** |
| **500Q Full Coverage (`250 + 250`)** | 500Q set, `questions_per_exam: 250` | Exam counts: **`[250, 250]`**, `uniqueSeen: 500`, `overlapCount: 0`, `finalStatus: "completed"`, `remainingCount: 0`. | **`0` overlaps** | **PASS** |
| **500Q Full Coverage (`120 × 4 + 20`)** | 500Q set, `questions_per_exam: 120` | Exam counts: **`[120, 120, 120, 120, 20]`**, `uniqueSeen: 500`, `overlapCount: 0`, `finalStatus: "completed"`, `remainingCount: 0`. | **`0` overlaps** | **PASS** |
| **Multi-Subject Equal (`90Q`)** | 3 sets with unequal pools `[20, 50, 130]` | Actual distribution: **`[20, 35, 35]`** (capped Set A at 20, cleanly redistributed 10 overflow evenly across Sets B & C). | Exact sum `90` | **PASS** |
| **Multi-Subject Proportional (`100Q`)** | 3 sets `[20, 50, 130]` (`10% / 25% / 65%`) | Actual distribution: **`[10, 25, 65]`**. | Exact sum `100` | **PASS** |
| **Multi-Subject Custom (`60Q`)** | 3 sets with `custom_count: [10, 20, 30]` | Actual distribution: **`[10, 20, 30]`**. | Exact sum `60` | **PASS** |

---

## 4. Rapid-Click & Double-Submit Stress Tests (`V32-028` / `FUNC-18`)

| Stress Test | Action | Measured Result | Verdict |
| :--- | :--- | :--- | :---: |
| **10× Rapid A/B Option Alternating** | 5 cycles of `Option Alpha -> Option Beta` clicks in live exam | Coalesced into strictly **`1`** debounced `PUT /api/exams/[id]/answers`; DB persisted exact final **`Option Beta`** (`rapidFinalMatched: true`). | **PASS** |
| **Double-Click Launch Exam** | `dblclick()` on `"Bắt đầu thi"` in `/exams/new?setId=...` | Strictly **`1`** `POST /api/exams` request sent (`launchExamPosts: 1`, zero duplicate attempts). | **PASS** |
| **Double-Click Create Study Set** | `dblclick()` on submit in `/sets/new` | Strictly **`1`** `POST /api/sets` request sent (`createSetPosts: 1`). | **PASS** |
| **HTTP `503` Exam Submit Retry** | 1st `POST /api/exams/[id]/submit` returns `503`, 2nd succeeds | Attempt remains open with all answers preserved; 2nd submit transitions cleanly to `/results`. | **PASS** |
| **Existing Playwright E2E Exam Suites** | `authenticated-journey.spec.ts` (Scenarios 1–3) + `v3-complete-learning.spec.ts` (`V3-T3` 12-type scoring + Confidence Neutrality) | **4/4 E2E exam specs PASSED** (`Scenario 1`, `Scenario 2`, `Scenario 3`, `V3-T3`). | **PASS** |

---

## 5. Practice & Learn Mode Stability (`V32-003`, `V32-007`, `V32-020`, `V32-021`, `V32-032`)

- **`V32-003` (`FUNC-02`, P0) — PASS:** Zero `[object Object]` in Learn Mode Write feedback, `/review` mistake cards, and `/starred`; displays `"H2O"` and `"9.8 m/s2"` cleanly.
- **`V32-007` (`RU-01`, P0) — PASS:** Practice Mode answers 3Q (`3 / 14`) -> Exit to `/sets/[id]` -> Resume restores **`3 / 14`**; visiting `/sets/[id]/practice?fresh=1` restarts cleanly to **`0 / 14`**. Local checkpoint key uses authenticated user ID (`studyhub-v3-checkpoint:<userId>:practice:...`).
- **`V32-020` (`FUNC-08`, P1) — PASS:** Practice renders `reading_passage` text (`sawPassageText: true`), `listening` audio (`sawListeningAudio: true`), `ordering` controls (`sawOrderingButtons: true`), `fill_in_blank` multi-blank inputs (`sawTwoBlankInputs: true`), `numerical` input (`sawNumericalInput: true`), `image_hotspot` (`sawHotspotImg: true`), and `/practice?mode=mistakes&count=20` honors `count=20` + strict mistakes mode.
- **`V32-021` (`FUNC-09`, P1) & `V32-032` (`FUNC-22`, P2) — PASS:** Multi-select `image_choice` in Learn does not auto-submit on 1st click (`multiSelectDidNotAutoSubmit: true`); 5 prominent 32px stage tabs removed (`visibleStageBtns: 0`), replaced by compact Goal popover (`hasGoalPopoverBtn: true`), zero `"V3"` label.

---

## 6. Wave 6B Retest of `in_progress` Exam `question_paper` PDF (`V32-030` / `FUNC-21b` — PASS)

- **Wave 6 Repro -> Wave 6B Verified Fix:** Exporting an `in_progress` exam containing `fill_in_blank`, `matching` (+ distractor), `image_hotspot`, `numerical` (`unit_required: true`), and `ordering` via `POST /api/export/pdf` (`mode: "question_paper"`) now returns **`200 OK`** (`841,078 B`, valid `%PDF-`, `zeroSecretLeak: true`), while `mode: "paper_and_key"` and `mode: "paper_with_explanations"` continue returning **`403 FORBIDDEN`**.
