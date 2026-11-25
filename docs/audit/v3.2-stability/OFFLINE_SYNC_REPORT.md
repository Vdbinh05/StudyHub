# StudyHub V3.2 — Wave 6 Offline PWA, Sync Queue & Account Isolation Report (`OFFLINE_SYNC_REPORT.md`)

> **Auditor:** Agent 6 — Independent Functional Tester (`func-tester-2`, zero edits to `src/*` or `supabase/*`)  
> **Target:** Compiled local production server (`http://127.0.0.1:3051`) + live Chromium Service Worker (`public/sw.js`) & IndexedDB + live Supabase Cloud

---

## 1. Executive Verdict

All **Offline PWA, Sync Queue Dedup, Backup/Restore, and Sign-Out Purge** verifications (`V32-006`, `V32-011`, `V32-013`, `V32-029`, `V32-050`) **PASSED**!

> **Wave 6B E2E Confirmation (`V3-T6` — PASS in `13.3s`):** After aligning the legacy V3.0 selector at `tests/e2e/v3-complete-learning.spec.ts:1548-1551` with Wave 3's 1-click auto-download (`OfflineDownloadButton.tsx:341-354`), `V3-T6` **PASSED** end-to-end (`Download -> setOffline(true) -> Offline Study -> Refresh Offline -> setOffline(false) -> Sync Queue -> Account-Switch IDB Isolation`), contributing to **`22 / 22 PASS`** across the entire Playwright E2E suite.

---

## 2. True Offline PWA Verification (`V32-029` / `FUNC-19`, `RU-07`, `RU-19`)

Tested live on a study set containing `image_choice` (2 image-only options), `single_choice`, `numerical`, `ordering`, and **2 visual diagrams** (`Diagram One Alpha`, `Diagram Two Beta`):

| Check | Live Observed Behavior | Verdict |
| :--- | :--- | :---: |
| **Offline Download (Media + Diagrams)** | Clicked `[data-testid="offline-download-trigger"]`, downloaded full bundle with media & both diagrams into account-partitioned IndexedDB (`autoDownloadWorked: true`). | **PASS** |
| **Service Worker Headers & Activation** | `GET /sw.js` served `200 OK`, `Cache-Control: no-cache, no-store, must-revalidate`, guarded `/api/`, `/auth/`, `/share/`, and `APPLY_UPDATE` (`V3-T1` SW checks PASS; `navigator.serviceWorker.ready` activated). | **PASS** |
| **Honest Offline Status Indicator (`RU-07`)** | After `context.setOffline(true)`, top bar NEVER flashed green `"Trực tuyến"` (`showsFalseOnline: false`). | **PASS** |
| **No Contradictory Offline Warning (`RU-07`)** | Entering offline study on downloaded set hid `"Nội dung này chưa được tải ngoại tuyến"` (`hasContradictoryBanner: false`). | **PASS** |
| **Image-Only Option Rendering (`FUNC-19`)** | Switching to Practice/Quiz mode offline rendered cached `<img>` elements for `image_choice` options (`imageChoiceImgCount: 3`, zero blank `"A."`/`"B."` boxes). | **PASS** |
| **Multi-Diagram Selector Offline (`FUNC-19`)** | Switching to Diagram mode offline rendered `[role="tablist"]` exposing BOTH `"Diagram One Alpha"` and `"Diagram Two Beta"` (`hasTwoDiagrams: true`). | **PASS** |
| **Offline `F5` Reload Persistence (`RU-07`)** | Reloading `/offline` while STILL `setOffline(true)` stayed inside active offline study for `"W6 Offline Stress Set"` without kicking the user out (`stayedInStudyAfterF5: true`). | **PASS** |
| **Rapid Double-Click Check & Reconnect Sync** | Double-clicked Check offline, then restored `setOffline(false)` -> sync drained cleanly with zero errors (`noSyncError: true`). | **PASS** |
| **`OfflineManagerPanel` Ref Locks (`V32-050`)** | Verified synchronous `syncingRef` / `removingRef` guards (`src/components/pwa/OfflineManagerPanel.tsx:244`) preventing duplicate sync/remove mutations. | **PASS** |

---

## 3. Sync Queue Deduplication & Concurrency (`V32-011` / `DB-01`, `DB-02`)

| Scenario | API Endpoint | Observed Response | Verdict |
| :--- | :--- | :--- | :---: |
| **In-Batch Duplicate `event_id`** | `POST /api/sync/events` (2 identical `event_id` items in 1 request) | `200 OK` -> `[{ status: "applied", event_id }, { status: "duplicate_ignored", message: "Duplicate event_id within batch ignored." }]` — strictly 1 apply. | **PASS** |
| **Replayed Batch `event_id`** | `POST /api/sync/events` (same `event_id` resent) | `200 OK` -> `[{ status: "duplicate_ignored", event_id }]` — zero double SM-2 apply. | **PASS** |
| **Concurrent Starred Insert** | Parallel `POST /api/starred` ×2 on same question | `[201, 200]` — zero `500` / unique-constraint errors. | **PASS** |
| **Personal Note Version Conflict** | `PUT /api/notes` with stale `base_version` | `409 CONFLICT` returning `details.server_note` for conflict resolution. | **PASS** |
| **Bulk Edit `content_version` Bump** | `PATCH` & `DELETE` `/api/sets/[id]/questions/bulk` | `study_sets.content_version` monotonically incremented (`3 -> 4 -> 5`) so offline clients detect updates accurately (`V32-037`). | **PASS** |

---

## 4. Account Backup & Restore (`V32-006` / `FUNC-05`)

| Verification Point | Measured Result | Verdict |
| :--- | :--- | :---: |
| **Schema Version & Honest Scope** | `GET /api/account/data` (`200`) emitted `schema_version: "studyhub-v3"` with explicit `backup_scope` (`restored_entities`, `export_only_entities`, `excluded_note`). | **PASS** |
| **Full V3 Restore Integrity** | `POST /api/account/restore` (`201`) restored `14/14` questions preserving `numerical.type_payload` (`9.8 m/s2`), `ordering.type_payload` (`3` items), `listening.audio_url` + `sub_answer_kind: "fill_in_blank"`, `prompt_rich` AST, remapped `shared_passages` (`passage_id`), remapped `diagram_sets` (`1`) + `diagram_hotspots` (`2`) with `restoredQDiagramId === restoredDiagId !== oldDiagramId`, and restored `user_question_notes`. | **PASS** |
| **Aligned `15 MB` Restore Cap** | Oversized `>15 MB` payload to `POST /api/account/restore` rejected cleanly with **`413`**. | **PASS** |

---

## 5. Sign-Out Client Purge & Isolation (`V32-013` / `SEC-02`, `SEC-03`, `FUNC-29(3)`)

Verified live on `http://127.0.0.1:3051` via AppShell `Menu tài khoản -> Đăng xuất`:
- **Request:** `POST /auth/signout` sent `Accept: application/json`.
- **Response:** **`200 OK`** with `Cache-Control: private, no-store` (zero `303` CSP redirect block).
- **LocalStorage Purge:** Pre-seeded `studyhub-offline-known-users`, `studyhub-user-preferences`, `studyhub-exam-draft-v3:<uid>:fake`, and `studyhub-v3-checkpoint:<uid>:practice:fake` -> **`remainingKeys: []`** (`100%` purged after server sign-out).
- **Non-JSON Fallback (`Accept: text/html`, `redirect: "manual"`):** Returned **`303`** with strictly relative **`Location: /login`**.
