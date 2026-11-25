# StudyHub V3.2 — Wave 6 & Wave 6B Independent Functional Regression Report (`REGRESSION_REPORT.md`)

> **Auditor:** Agent 6 — Independent Functional Tester (`func-tester-2`, strictly independent — **0 edits** to `src/*`, `supabase/*`, or `tests/*`)  
> **Branch / Target:** `release/v3.2-stability` compiled production server on `http://127.0.0.1:3051` (reusing compiled Wave 6B `.next` build) connected to live Supabase Cloud (PostgreSQL 17.12)  
> **Companion Reports:** [`MOBILE_TEST_REPORT.md`](./MOBILE_TEST_REPORT.md) · [`NETWORK_FAILURE_REPORT.md`](./NETWORK_FAILURE_REPORT.md) · [`EXAM_STABILITY_REPORT.md`](./EXAM_STABILITY_REPORT.md) · [`IMPORT_MEDIA_REPORT.md`](./IMPORT_MEDIA_REPORT.md) · [`OFFLINE_SYNC_REPORT.md`](./OFFLINE_SYNC_REPORT.md) · [`TEST_MATRIX.md`](./TEST_MATRIX.md)

---

## 1. Final Release Verdict: **PASS (100% GREEN — 0 P0 / 0 P1 / 0 P2 / 0 P3 Open)**

| Gate / Scope | Wave 6 (Initial) | Wave 6B (Final Verified) |
| :--- | :---: | :---: |
| **Functional P0 Issues (`V32-002`..`007`)** | `6 / 6 PASS` | **`6 / 6 PASS`** |
| **All Functional Issue IDs (`28` IDs)** | `26 / 28 PASS` (`2` P1 reopened) | **`28 / 28 PASS` (`0` open)** |
| **Full Existing Playwright E2E Suite** | `20 / 22 PASS` (`2` failed) | **`22 / 22 PASS` (`0` failed, `0` skipped, `0` blocked)** |
| **7-Width Mobile Matrix (`17` routes × `7` widths)** | `119 / 119` (`0px` overflow) | **`119 / 119` (`0px` overflow) + `RU-12b` `360/390px` 3-digit counter PASS** |
| **Network Failure & Resilience Suite (`8` fault cases)** | `8 / 8 PASS` | **`8 / 8 PASS`** |
| **Rapid-Click & Double-Submit Stress Suite** | `5 / 5 PASS` | **`5 / 5 PASS`** |

---

## 2. Wave 6 -> Wave 6B Closed Reopened Defect Audit Trail

Both P1 defects independently discovered and reopened in Wave 6 were fixed by their owning builders, built cleanly (`#71`), and **independently re-verified PASS** in Wave 6B:

### Closed #1 — `V32-026` (`FUNC-15`, P1): Settings Synchronous Tab Switch & URL Sync — **VERIFIED PASS**
- **Wave 6 Finding:** Deriving `activeTab` purely from async `router.replace('/settings?tab=...')` in `src/components/layout/settings-view.tsx:156,535-545` caused immediate interactions right after clicking Tab 2 (`Chế độ học & Phím tắt`) to mutate Tab 1 instead, breaking `V3-T1`.
- **Wave 6B Independent Retest Evidence (`retest-wave6b.mjs` & `V3-T1`):**
  - Immediate `0ms` click on Tab 2 -> first active switch is **`#mp-fc-audio`** (Tab 2, NOT Tab 1), `beforeChecked: "false"` -> toggled & saved (`PATCH /api/preferences` **`200 OK`** with `mode_preferences.flashcards.auto_play_audio: true`; Tab 1 `confidence_enabled` untouched).
  - Post-reload `afterChecked: "true"`, `dbAutoPlayAudio: true`.
  - Top-bar deep link `/settings?tab=offline` -> `offlineSelected: "true"`.
  - Browser `goBack()` -> `/settings?tab=modes` (`backModesSelected: "true"`); `goForward()` -> `/settings?tab=offline` (`fwdOfflineSelected: "true"`).
  - Existing E2E **`V3-T1`** -> **PASS (`6.1s`)**.

### Closed #2 — `V32-030` (`FUNC-21b`, P1): `in_progress` Exam `question_paper` PDF on V3 Structured Questions — **VERIFIED PASS**
- **Wave 6 Finding:** `POST /api/export/pdf` (`mode: "question_paper"`) returned `500 INTERNAL_ERROR` on `in_progress` exams containing `fill_in_blank`, `matching`, or `image_hotspot` because `pdf-exporter.ts:935` called `computeAnswerSummary()` on pre-submit stripped payloads.
- **Wave 6B Independent Retest Evidence (`retest-wave6b.mjs`):**
  - Started an `in_progress` exam containing `fill_in_blank`, `matching` (+ distractor), `image_hotspot`, `numerical` (`unit_required: true`), and `ordering`.
  - `POST /api/export/pdf` (`mode: "question_paper"`, `locale: "vi"`) -> **`200 OK`**, **`841,078 B`**, valid `%PDF-` header, **`zeroSecretLeak: true`** (0 occurrences of secret blank answer, hotspot label, or required unit).
  - `POST /api/export/pdf` (`mode: "paper_and_key"` and `mode: "paper_with_explanations"`, while `in_progress`) -> **`403 FORBIDDEN`** (strict pre-submit anti-leak intact).

### Closed #3 — `V3-T6` E2E Alignment & `RU-12b` (`360×800` 3-Digit Counter Polish) — **VERIFIED PASS**
- **`V3-T6`** (`tests/e2e/v3-complete-learning.spec.ts:1490`): **PASS (`13.3s`)** end-to-end (`Download -> setOffline(true) -> Offline Study -> Refresh Offline -> setOffline(false) -> Sync Queue -> Account-Switch IDB Isolation`).
- **`RU-12b`** (`PracticeClient.tsx` `min-[380px]` breakpoint on 120Q set `0/120`):
  - `360×800`: visible **`Xong`** (`300..352`, `52×44px`, **`0px` clip**, `overflow: 0`, single-line counter).
  - `390×844`: visible **`Hoàn thành`** (`294..382`, `88×44px`, **`0px` clip**, `overflow: 0`, single-line counter).

---

## 3. Full Existing Playwright E2E Final Tally (Wave 6B)

Command: `PLAYWRIGHT_BASE_URL=http://127.0.0.1:3051 PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_EXPECT_PROD=1 E2E_SUPABASE_READY=1 npx playwright test --workers=1`
- **Total:** `22` | **Passed:** **`22 (100%)`** | **Failed:** **`0`** | **Skipped:** **`0`** | **Blocked:** **`0`** (`3.3m`, exit `0`).
  - `tests/e2e/authenticated-journey.spec.ts`: **3 / 3 PASS**
  - `tests/e2e/studyhub.spec.ts`: **13 / 13 PASS**
  - `tests/e2e/v3-complete-learning.spec.ts`: **6 / 6 PASS** (`V3-T1` through `V3-T6`)

---

## 4. Environment Hygiene, Server Teardown & Real Owner Data Attestation

- **Local Server (`:3051`):** Torn down cleanly (`PORT_3051_LISTEN_COUNT: 0`).
- **Disposable Accounts (`v32-w6-func-*`):** **100% deleted** across both Wave 6 & Wave 6B passes along with all created study sets, exam attempts, `media_assets`, `content_media_relations`, and Storage prefixes (`study-media`, `import-temp`, `study-temp`); `ourDisposableUsers: []`, `otherDisposableUsers: []`.
- **Real Owner Database Preservation:** Verified pre-existing real owner counts remain **100% untouched** (`authUsers: 2`, `profiles: 2`, `questions: 599` across the original 3 real owner sets `50+499+50`, `examAttempts: 2`; plus the real owner's untouched empty set created at `16:22:04Z`).
- **Confidentiality & Independence:** **0** `.env.local` values printed/logged; **0** `sample-data/` text read or quoted; **0** edits made to `src/*`, `supabase/*`, or `tests/*`.
