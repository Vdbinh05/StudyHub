# StudyHub V3.2 Addendum (`V32-053`) — Independent Functional & Cross-Mode Verification Report

- **Tester:** Agent 6 — Independent Functional Tester (`func-tester-2`)
- **Branch:** `release/v3.2-stability`
- **Target Build & Runtime:** Local compiled production server on `http://127.0.0.1:3061` (`npx next start -p 3061 -H 127.0.0.1`, reusing freshly built `.next`) connected to live Supabase Cloud with Migration `0020_v3_2_post_import_multimedia_editor.sql`
- **Isolation & Hygiene:** Strictly disposable accounts prefixed `v32-add-func-*`; zero edits to `src/*`, `supabase/*`, or `tests/*`; zero `.env.local` or `sample-data/` exposure
- **Phase 3A Initial Verdict (`#101`):** `REOPENED` — 2 real P1 backend omissions caught live (`V32-054` & `V32-055`)
- **Phase 3B Final Verdict (after `#103`, `#104`, `#106` fixes & live independent retest):** **`PASS`** — **8 / 8 Scenarios PASS**, **15 / 15 Cross-Mode Surfaces PASS**, **`GET /api/progress/due` PASS**, **`#100` P3 Filtered Row-Number Polish PASS**, and **22 / 22 Playwright E2E PASS** (`0` failed, `0` skipped, `0` blocked, `0` console/page errors).

---

## 1. Executive Summary

| Verification Suite | Phase 3A Result | Phase 3B Retest Result | Skipped / Blocked | Final Verdict |
| --- | :---: | :---: | :---: | :---: |
| **Mandatory Functional Scenarios (A, B, C, D, E, F, G, J)** | 7 / 8 (`D` reopened -> `V32-054`) | **8 / 8 PASS** (A, B, C, D, E, F, G, J) | 0 | **PASS** |
| **15-Mode Cross-Rendering Matrix** | 13 / 15 (Modes 9 & 10 reopened -> `V32-055`) | **15 / 15 PASS** (+ `GET /api/progress/due` PASS) | 0 | **PASS** |
| **P3 Polish (`#100` Filtered Bank Row Numbers)** | — | **PASS** (`/sets/[id]/edit` preserves `#1, #3` & `#2`) | 0 | **PASS** |
| **Full Existing Playwright E2E Suite (`--workers=1`)** | **22 / 22 PASS** (`4.4m`) | **22 / 22 PASS** (verified against live `:3061`) | 0 | **PASS** |

---

## 2. Phase 3A Defects Detected & Independently Verified Fixed in Phase 3B

### `V32-054` (`P1`, **CLOSED — VERIFIED PASS in Phase 3B**): Import Preview Explanation Image Persistence (Scenario D)
- **Original Phase 3A Failure:** `src/app/api/import/commit/route.ts:305–333` omitted `explanationMedia` when mapping `activeIncoming` through `validateParsedQuestion(...)`, causing explanation images attached in `InlineQuestionEditor` to silently commit as `0`. Companion gaps existed in `route.ts:448–462` (replay temp cleanup) and `src/lib/import/commit-chunker.ts:43–51` (`estimateQuestionPayloadBytes`).
- **Fixes Applied (`#103`, `#104`, `#106`):** Mapped & forwarded `explanationMedia` into `validateParsedQuestion(...)` and replay cleanup in `src/app/api/import/commit/route.ts`, added `explanationMedia` byte accounting to `src/lib/import/commit-chunker.ts`, plus Vitest regression tests (`532/533` passing).
- **Phase 3B Independent Live Retest (`http://127.0.0.1:3061`):**
  1. Uploaded synthetic 2Q `.docx` in `/sets/[id]/import` -> opened `InlineQuestionEditor` on Q1 BEFORE commit -> edited prompt text and attached 3 distinct PNGs (`p3b-preview-prompt.png`, `p3b-preview-opta.png`, `p3b-preview-expl.png`).
  2. Committed import (`POST /api/import/commit` -> `200 OK`) and reloaded `/sets/[id]`.
  3. **Verified API (`GET /api/sets/[id]/questions/[q1Id]`) & DOM:**
     - Edited prompt text persisted (`PASS`)
     - `prompt` `media_attachments`: **`1`** (`PASS`)
     - Option A `media_attachments`: **`1`** (`PASS`)
     - `explanation` `media_attachments`: **`1`** (`explanationMediaId: 9fdcbe66-...`, **`PASS`** — previously `0`!)
     - `/sets/[id]` Q1 card rendered all **`3/3`** images cleanly (`naturalWidth > 0`, `0` broken images).

### `V32-055` (`P1`, **CLOSED — VERIFIED PASS in Phase 3B**): Multi-Image `question.media_attachments` Hydration in `/starred`, `/review`, & `/api/progress/due`
- **Original Phase 3A Failure:** `GET /api/starred` (`src/app/api/starred/route.ts:98–104`), `GET /api/mistakes` (`src/app/api/mistakes/route.ts:523–528` + live RPC path), and `GET /api/progress/due` (`src/app/api/progress/due/route.ts:60–65`) omitted `media_attachments` on returned `question` objects, dropping prompt image #2+ and ALL explanation images in Modes 9 & 10.
- **Fixes Applied (`#104`, `#106`):** Attached `media_attachments: relations.questionMediaByQ.get(q.id) ?? []` across `starred`, `progress/due`, and `mistakes` fallback, and hydrated BOTH question & option media on the live `rpcGetUserMistakesPage` RPC branch in `GET /api/mistakes` via `hydrateQuestionAndOptionMedia`.
- **Phase 3B Independent Live Retest (`http://127.0.0.1:3061`, Q1 with `2` prompt imgs + `2` correct Option A imgs + `1` Option B img + `1` explanation img):**
  - **Mode 9 (`GET /api/starred` & `/starred` UI):** **PASS** — API returned `promptAtts: 2`, `optionAAtts: 2`, `explAtts: 1`. `/starred` DOM loaded **`5/5`** images (`2` prompt + `2` correct Option A + `1` explanation, `naturalWidth > 0`, `prompt2Rendered: true`, `explanationImageRendered: true`) + contextual Edit opened cleanly (`0` console/page errors).
  - **Mode 10 (`GET /api/mistakes` live RPC & `/review` UI):** **PASS** — API returned `promptAtts: 2`, `optionAAtts: 2`, `explAtts: 1`. `/review` DOM loaded **`5/5`** images (`prompt2Rendered: true`, `explanationImageRendered: true`, `0` broken images) + contextual Edit opened cleanly (`0` console/page errors).
  - **Due SM-2 API (`GET /api/progress/due`):** **PASS** — Verified live with Q1 due (`next_review_at` in past on disposable user): API returned hydrated `duePrompt: 2`, `dueExpl: 1`, `dueOptA: 2`.

### `#100` P3 Polish (**VERIFIED PASS in Phase 3B**): Filtered Bank Row Numbers on `/sets/[id]/edit`
- Seeded 3 questions: `#1` (has images), `#2` (text-only), `#3` (has image).
- On `/sets/[id]/edit`:
  - Clicking **`Có ảnh`** (`mediaFilter=has_images`) rendered true original bank pills **`#1`** and **`#3`** (not relative `#1, #2`).
  - Clicking **`Chưa có ảnh`** (`mediaFilter=no_images`) rendered true original bank pill **`#2`** (not `#1`).

---

## 3. Scenario-by-Scenario Functional Results (8 / 8 PASS on `:3061`)

| Scenario | Status | Detailed Verification Evidence |
| --- | :---: | --- |
| **Scenario A — Edit Imported `.docx` Question** | **PASS** | Imported synthetic 4Q text-only `.docx` via `/sets/[id]/import` -> Step 3 displayed prominent `"Xem và chỉnh sửa câu hỏi"` link (`href="/sets/[id]/edit"`). Opened Q1 via 1-tap `hub-edit-question-<id>`, edited prompt text, uploaded `2` distinct PNGs (`prompt-a1.png`, `prompt-a2.png`), saved (`PATCH 200`), and performed full page reload. Original `question.id` preserved, edited text persisted, and both `prompt` `media_attachments` (`2/2`) persisted in DB and rendered (`naturalWidth > 0`). |
| **Scenario B — Per-Option A/B/C/D Images + Multi-Image Option + Shuffle + Scoring** | **PASS** | On imported `single_choice` Q2 (without changing `question_type`), attached `2` distinct PNGs to Option A and `1` each to B, C, D (`5` unique `media_id`s). Saved (`PATCH 200`) and reloaded: `question_type` remained `"single_choice"`, all `4` original `option.id` UUIDs preserved, exact bindings verified (`A:2, B:1, C:1, D:1`). Created shuffled exam (`shuffle_questions: true, shuffle_options: true`): `options_snapshot[i].media` retained multi-image arrays (`A:2, B:1`); submitting correct option UUIDs scored **`100%`**. Practice Mode rendered all `5` option images (`naturalWidth > 0`) and graded accurately. |
| **Scenario C — Real Browser `ClipboardEvent("paste")` Routing** | **PASS** | Expanded Explanation accordion on Q3, dispatched genuine browser `ClipboardEvent("paste")` with 3 distinct PNG `File` objects onto (1) `#uq-prompt`, (2) Option B text input (`Nội dung phương án B`), and (3) `#uq-explanation`. Each triggered `POST /api/uploads/image` (`201`) into its scoped zone. After Save + Reload, DB verified `prompt: 1`, Option B `option: 1`, `explanation: 1`, Options A/C/D `0`, `3` distinct `media_id`s — **`0` cross-zone leaks**. |
| **Scenario D — Edit During Import Preview (`InlineQuestionEditor`)** | **PASS** *(Phase 3B)* | Uploaded synthetic 2Q `.docx` -> opened `InlineQuestionEditor` on Q1 before commit -> edited prompt text + attached Prompt, Option A, and Explanation PNGs -> committed -> reloaded `/sets/[id]`. DB & UI confirmed prompt text updated, `prompt: 1`, `optionA: 1`, AND **`explanation: 1`** (`content_media_relations role='explanation'`) with `3/3` hub images loaded (`naturalWidth > 0`). |
| **Scenario E — Image-Only Answer Options on `single_choice`** | **PASS** | Attached 4 distinct PNGs to Q4 options A–D and cleared ALL 4 option texts to `""`. UI displayed `4` `"Đáp án chỉ dùng hình ảnh"` badges; Save returned `200 OK` preserving `question_type === "single_choice"` with all 4 options having `content === ""` and `1` image each. Created shuffled exam: `options_snapshot` preserved all 4 image-only options, rendered cleanly in `LiveExamRunner`, and submitting Option D UUID graded `is_correct: true`. |
| **Scenario F — Failure, Cleanup & Concurrency Recovery** | **PASS** | **F1 (SVG spoof):** Spoofed `.png` containing `<svg><script>...</script></svg>` rejected client-side (`"SVG content detected and rejected for security reasons."`). **F2 (Upload 500 + Retry):** Intercepted 1st `POST /api/uploads/image` (`500`) -> error + `"Thử lại tải lên"` -> Retry succeeded (`201`). **F3 (Save 500 + Retry):** Intercepted 1st `PATCH` (`500`) -> draft preserved -> `"Thử lưu lại"` succeeded (`200`). **F4 (Cancel Temp Cleanup):** Uploaded temp image -> Cancel -> confirmed `"Bỏ thay đổi"` -> fired `DELETE /api/uploads/image/[mediaId]` (`200`). **F5 (Double-Click Save):** Synchronous double-click fired strictly **`1` `PATCH`**. **F6 (Dirty Guard & Rapid Nav):** Editing prompt + clicking `"Câu tiếp"` triggered AlertDialog `"Bỏ các thay đổi chưa lưu?"`; staying kept draft; clean rapid Next/Prev switched `#1 -> #2 -> #3 -> #2`. |
| **Scenario G — Historical Exam Integrity & Zero Active-Exam Edit** | **PASS** | Completed Exam 1 on multi-image Q1 (`prompt: 2, optA: 2, optB/C/D: 1, expl: 1`, Option A correct -> Q1 `is_correct: true`, `score_percent: 25%`). Opened contextual `"Chỉnh sửa câu hỏi gốc"` on `/exams/[id]/results` -> verified `role="note"` non-mutation disclaimer -> replaced prompt & Option A images, edited text, flipped correct answer A→B -> Save (`200`). Reloaded historical Exam 1 Results: score (`25%`), `correct_count`, Q1 `is_correct: true`, original prompt text, and original prompt/option/explanation images **100% UNCHANGED** and loaded (`naturalWidth > 0`). New Exam 2 picked up updated prompt, replaced images, and new correct answer B (`is_correct: true`); active `LiveExamRunner` had **`0`** edit buttons, **`0`** explanation text/images, and omitted `review_media_snapshot`. |
| **Scenario J — Mobile (`360px`, `390px`, `430px`)** | **PASS** | Verified `360×800`, `390×844`, and `430×932` on `/sets/[id]` and `UnifiedQuestionEditorModal`: **`0px`** hub overflow, **`0px`** modal overflow, **`0px`** right clipping, 1-tap Edit button **`44×44px`**, prompt & Option A upload controls visible & unclipped, sticky Save footer unobstructed (`bottom <= viewportHeight`, `height >= 44px`), and `ImageLightbox` preview opened (`naturalWidth > 0`) & closed via `Escape`. |

---

## 4. 15-Mode Cross-Rendering Matrix (15 / 15 PASS)

| # | Mode / Surface | Status | Live Evidence (`http://127.0.0.1:3061`) |
| :-: | --- | :---: | --- |
| 1 | **Question Bank (`/sets/[id]` & `/sets/[id]/edit`)** | **PASS** | Multi-image prompt + option + explanation thumbnails loaded; `#1` search isolated Q1; all 5 media filter pills verified (`all: 4, has_images: 3, no_images: 1, missing_media: 0, needs_media_review: 0`); `/sets/[id]/edit?questionId=<id>` auto-opened modal on Q1; filtered bank row numbers preserve original `#position+1` (`#1, #3` & `#2`). |
| 2 | **Flashcards (`/sets/[id]/flashcards`)** | **PASS** | Front rendered multi-image prompt (`>= 2` loaded `<img>`); Space flip revealed back/option & explanation images (`>= 3` loaded `<img>`). |
| 3 | **Learn (`/sets/[id]/learn`)** | **PASS** | `0` explanation image pre-check; prompt & reveal/check media loaded cleanly (`naturalWidth > 0`). |
| 4 | **Practice (`/sets/[id]/practice`)** | **PASS** | Q1 pre-check loaded prompt + option images with `0` explanation image leak; post-check rendered explanation image (`q1ExplImg.url`); contextual `"Chỉnh sửa câu hỏi"` on Q2 saved & updated live **preserving session position `#2`** with zero restart. |
| 5 | **Custom Practice (`/practice`)** | **PASS** | Selected multimedia set and started custom practice; prompt & option images hydrated via Migration `0020` `get_practice_question_pool` and loaded cleanly. |
| 6 | **Write (`/sets/[id]/write`)** | **PASS** | Prompt images loaded (`naturalWidth > 0`). |
| 7 | **Match (`/sets/[id]/match`)** | **PASS** | Image thumbnails rendered cleanly on match board tiles (`naturalWidth > 0`). |
| 8 | **Spell (`/sets/[id]/spell`)** | **PASS** | Prompt images loaded (`naturalWidth > 0`). |
| 9 | **Starred (`/starred`)** | **PASS** *(Phase 3B)* | `GET /api/starred` hydrated `prompt: 2, optionA: 2, explanation: 1`; `/starred` rendered all `5/5` images (`prompt2Rendered: true`, `explanationImageRendered: true`, `0` broken images) + contextual Edit modal opened cleanly. |
| 10 | **Review Mistakes (`/review`)** | **PASS** *(Phase 3B)* | `GET /api/mistakes` (live RPC path) hydrated `prompt: 2, optionA: 2, explanation: 1`; `/review` rendered all `5/5` images (`prompt2Rendered: true`, `explanationImageRendered: true`, `0` broken images) + contextual Edit modal opened cleanly. *(Also verified `GET /api/progress/due`: `duePrompt: 2, dueExpl: 1, dueOptA: 2`.)* |
| 11 | **Active Exam Runner (`/exams/[id]`)** | **PASS** | Rendered multi-image prompt + option images (`>= 5` loaded `<img>`); strictly **`0`** edit buttons; **`0`** explanation text/image leaks (`review_media_snapshot` stripped). |
| 12 | **Exam Results (`/exams/[id]/results`)** | **PASS** | Post-submit rendered prompt gallery, option gallery, AND explanation gallery (`>= 5` loaded `<img>`), plus contextual `"Chỉnh sửa câu hỏi gốc"` with historical-integrity notice. |
| 13 | **PDF Export (`POST /api/export/pdf`)** | **PASS** | Verified via `pdf-lib` XObject inspection on submitted Exam 1: `question_paper` -> `200 OK`, `%PDF-`, `2` pages, **`10` `/Image` XObjects** (`844,584 B`, omits explanation images); `paper_with_explanations` -> `200 OK`, `%PDF-`, `2` pages, **`13` `/Image` XObjects** (`845,978 B`, cleanly includes all `+3` explanation images). |
| 14 | **Backup / Restore (`studyhub-v3`)** | **PASS** | `GET /api/account/data` streamed `schema_version: "studyhub-v3"` with `6` `content_media_relations` spanning `["explanation", "option", "prompt"]`. Same-owner `POST /api/account/restore` restored all `6/6` relations onto newly minted entity IDs (`prompt: 2`, `option: 3`, `explanation: 1`). Cross-account restore enforced `.eq("owner_id", user.id)` tenant isolation. |
| 15 | **Offline Learning (`/offline`)** | **PASS** | 1-click download on `/sets/[id]` reached `"Đã tải đầy đủ"` -> navigated to `/offline` -> `context.setOffline(true)` -> Offline Practice (`role="tab"`): `5/5` prompt + option images loaded offline with `0` `offline-explanation-section` pre-check -> Check Answer rendered `offline-explanation-section` + `6th` explanation image offline -> reconnected cleanly. |

---

## 5. Full Existing Playwright E2E Suite (`22 / 22 PASS`)

Command executed against live compiled `:3061`:
```powershell
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3061 PLAYWRIGHT_SKIP_WEBSERVER=1 PLAYWRIGHT_EXPECT_PROD=1 E2E_SUPABASE_READY=1 npx playwright test --workers=1 --reporter=list,json
```
- **Total:** `22` | **Passed:** **`22`** (`authenticated-journey.spec.ts`: `3/3`; `studyhub.spec.ts`: `13/13`; `v3-complete-learning.spec.ts`: `6/6` incl. `V3-T1`..`V3-T6`) | **Failed:** `0` | **Skipped / Blocked:** `0` | **Duration:** `4.4m`.

---

## 6. Teardown & Data Hygiene Verification

- Local server on port `:3061` stopped cleanly (`Get-NetTCPConnection -LocalPort 3061 -State Listen` count = `0`).
- 100% of `v32-add-func-*` disposable accounts, study sets, exam attempts, media rows, and Storage objects purged (`errors: []`, `ourDisposableUsers: []`).
- Real owner database counts confirmed untouched (`authUsersTotal: 2`, `profiles: 2`, `studySets: 4`, `questions: 599`, `examAttempts: 2`).
- Zero edits to `src/*`, `supabase/*`, or `tests/*` by `func-tester-2`.
