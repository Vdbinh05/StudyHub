# StudyHub V3.0 — Live Database & Backend Audit Report (`DB_BACKEND_AUDIT.md`)

- **Auditor Role:** `db-backend-auditor` (Independent Database & Backend Auditor — read-only on `src/*` and `supabase/*`)
- **Target Environment:** Live Supabase Cloud PostgreSQL **17.12** (`StudyHub` / `cuoaifyupfmkstqhcjwy`), V3.0 migrations `0013`–`0016` applied live (zero database resets; pre-existing real user data preserved 100%)
- **Baseline Anchor:** Tag `v2.1-verified` (`0698734`), baseline report [`docs/audit/v3/BASELINE.md`](./BASELINE.md)
- **Live Verification Verdict:** **PASS (`16/16` live PostgreSQL 17.12 integration tests passing — `8/8` V2.1 regression + `8/8` V3.0 suite, `0` P0/P1/P2 open DB defects)**

---

## 1. Migration Immutability & Schema Inventory

Verified directly on disk and against Git tag `v2.1-verified`:

- **Legacy Migrations `0001`–`0012` Immutability:** `git diff v2.1-verified -- supabase/migrations/0001*..0012*` -> **`DIFF_LINES=0`** (100% untouched).
- **Additive V3.0 Migrations (`0013`–`0016`):**

| Migration File | Size (Bytes) | Live Cloud Status | Key Scope |
| --- | ---: | --- | --- |
| `0001`–`0012` (V1.0–V2.1) | 243,580 | Applied (frozen, `DIFF_LINES=0`) | 26 base tables, RLS, V2 custom exams & coverage cycles, PG 17.12 hardening |
| `0013_v3_media_richtext_questions_schema.sql` | 43,264 | Applied LIVE | `study-media` bucket (10 MB, 4 raster + 9 audio MIMEs, zero SVG/HTML); 5 tables (`media_assets`, `content_media_relations` `ON DELETE RESTRICT` + 6 polymorphic cleanup triggers, `shared_passages`, `diagram_sets`, `diagram_hotspots`); V3 columns/CHECKs; column-level `GRANT`/`REVOKE` anti-leak; updated `prevent_exam_snapshot_update()`; `ALTER POLICY "study_media_select"` for historical exam media |
| `0014_v3_learning_notes_reports_sync_tables.sql` | 17,333 | Applied LIVE | 5 tables (`user_question_notes`, `question_reports`, `learning_session_checkpoints`, `learning_confidence_events`, `learning_sync_events`), FK indexes, strict `(SELECT auth.uid())` RLS |
| `0015_v3_rpcs_grading_search_reset_sync.sql` | 113,518 | Applied LIVE | `point_in_hotspot`, `sanitize_pre_submit_type_payload`, `has_exam_answer`, `grade_v3_exam_answer`, upgraded `create_exam_attempt_v2` / `save_exam_attempt_answers` / `get_exam_attempt_detail` / `submit_exam_attempt` / `clone_study_set`, new `reset_learning_progress`, `global_library_search`, `sync_offline_learning_events` (PgBouncer-safe zero-temp-table CTEs) |
| `0016_v3_live_fixes.sql` | 59,865 | Applied LIVE (`0016a` + `0016b`) | Fixes all 5 live PG 17.12 audit findings (`V3-DB-01`..`V3-DB-05`) |

- **Public Tables & RLS:** **36/36** tables in `public` have `rls_enabled = true`.
- **Zero Forbidden Practices:** 0 `DROP POLICY`, 0 `DROP TRIGGER`, 0 `CREATE TEMP TABLE`, 100% `(SELECT auth.uid())`, 100% `SET search_path = ''`, explicit `REVOKE ALL FROM PUBLIC, anon` on all new `SECURITY DEFINER` RPCs, 0 AI/LLM logic, 0 payment/billing columns.

---

## 2. Live PostgreSQL 17.12 Defects Discovered & Verified Fixed (`V3-DB-01`..`V3-DB-05`)

Every defect below was discovered during Wave 5 live PG 17.12 auditing (`#167`), patched by `@v2-db-backend-builder` in `0016_v3_live_fixes.sql` + `src/lib/supabase/progress-helper.ts` (`#173`), applied live on Supabase Cloud (`#174`), and independently re-verified green via live Vitest suites.

| ID | Severity | Symptom & Exact Live Evidence (Before Fix) | Root Cause | Fix & Live Re-Verification (After `0016`) |
| --- | --- | --- | --- | --- |
| **`V3-DB-01`** | **P0** | `INSERT INTO questions` with image-only (`prompt = ''`, `prompt_image_url` set) or audio-only (`prompt = ''`, `audio_media_id` set) failed LIVE on PG 17.12 with SQLSTATE **`23514`**: `new row for relation "questions" violates check constraint "questions_prompt_check"`. | `0013:329` queried `pg_get_constraintdef(oid) ILIKE '%char_length(trim(prompt))%'`, but PostgreSQL 17.12 deparses `trim(prompt)` as **`btrim(prompt)`**. The drop loop matched 0 rows and left V1.0 `questions_prompt_check` active! | `0016` explicitly dropped `questions_prompt_check` & `question_options_content_check` and matched both `btrim(...)` and `trim(...)`. **Verified LIVE (`live-v3-db-rpcs.test.ts` Tests 1 & 2):** image-only & audio-only prompts + image-only options insert cleanly, while blank prompt/option with zero media still fails `23514`. |
| **`V3-DB-02`** | **P0** | Live V2.1 regression test `live-db-rpcs.test.ts:973` (Test 5) **FAILED**: `AssertionError: expected 2.18 to be 1.96` (`SH-029` SM-2 ease-factor drift). | `0015:1797` (`submit_exam_attempt`) and `0015:2909` (`sync_offline_learning_events`) changed the SM-2 wrong-answer ease penalty from `-0.54` (`quality = 1`: `2.50 -> 1.96`) to `-0.32` (`2.50 -> 2.18`). | `0016` restored `-0.54` for standard wrong answers (and `-0.59` for `certain` misconceptions matching `confidence.ts:268`). **Verified LIVE:** `live-db-rpcs.test.ts` Test 5 restored to `1.96` (**8/8 PASS**). |
| **`V3-DB-03`** | **P1** | `correct + guessing`, `correct + unsure`, and `correct + hint_used` bypassed mastery/interval caps in `0015` (`submit_exam_attempt`, `sync_offline_learning_events`) and `src/lib/supabase/progress-helper.ts`, allowing lucky guesses to advance `mastery_level = 'mastered'` and increment `independent_recall_count`. | SQL SM-2 CTEs and `upsertQuestionProgress()` ran base SM-2 without applying `src/lib/learning/confidence.ts:195-241` caps. | `0016` + `progress-helper.ts` enforce `guessing` (`interval_days = 1`, `reps <= 1`, `streak <= 2`, `< mastered`, no independent recall), `unsure` (`interval_days <= 4`, `< mastered`), `hint_used` (`interval_days <= 6`, `< mastered`) while keeping exam score 100% confidence-neutral. **Verified LIVE (`live-v3-db-rpcs.test.ts` Test 3):** `familiar` (`streak=2, interval=6`) + `correct/guessing` stays `!= 'mastered'` with `interval_days = 1`. |
| **`V3-DB-04`** | **P2** | `clone_study_set()` (`0015:2162`) remapped `questions.passage_id` & `questions.diagram_id` FK columns, but left source UUIDs inside `type_payload->>'passage_id'` / `type_payload->>'diagram_id'` and omitted `question_option` rows in `content_media_relations`. | Missing JSONB `jsonb_set` remap & option UUID map (`v_omap`) in `0015`. | `0016` remaps JSONB `passage_id`/`diagram_id` keys to cloned UUIDs and clones `question_option` media relations via `v_omap`. **Verified LIVE (`live-v3-db-rpcs.test.ts` Test 4):** cloned `type_payload.passage_id` and `type_payload.diagram_id` match cloned parent UUIDs. |
| **`V3-DB-05`** | **P2** | `reset_learning_progress()` did not clear `learning_confidence_events` on `subject`/`chapter`/`question` scopes; `sync_offline_learning_events()` did not guard `'checkpoint_upsert'` against stale `progress_generation`. | Scope filter omission in `0015:2362-2419` and event-type filter omission in `0015:2857`. | Fixed in live `0015d` & `0016b`. **Verified LIVE (`live-v3-db-rpcs.test.ts` Tests 5 & 7):** stale `checkpoint_upsert` with `progress_generation < current` returns `ignored_stale_reset`. |

---

## 3. Live PostgreSQL 17.12 Test Suite Execution Evidence

Executed directly against live Supabase Cloud (`StudyHub` / `cuoaifyupfmkstqhcjwy`, PG 17.12) after `0016` was applied:

```text
Command:
  npx eslint tests/integration/live-v3-db-rpcs.test.ts
  npx vitest run tests/integration/live-db-rpcs.test.ts tests/integration/live-v3-db-rpcs.test.ts

Result:
  ESLint: exit 0 (0 errors, 0 warnings)
  TypeScript (`tests/integration/live-v3-db-rpcs.test.ts` & `live-db-rpcs.test.ts`): 0 errors
  Vitest: Test Files  2 passed (2)
          Tests      16 passed (16)
          Duration   25.71s (exit 0)
```

### 3.1 V2.1 Full Live Regression (`tests/integration/live-db-rpcs.test.ts` — 8/8 PASS, `21.14s`)

| # | Live PG 17.12 Test Case | Duration | Verdict |
| --- | --- | ---: | --- |
| 1 | `handle_new_user()` trigger creates `profiles` + `user_preferences` and `get_my_profile()` returns caller email | 446ms | **PASS** |
| 2 | Statement-level `trg_sync_study_set_question_count_ins/_del` stays exact across 500-row batch insert & delete | 1,545ms | **PASS** |
| 3 | `normalize_short_answer()` LIVE preserves `0`/`10`/`100`/`1.5`, Vietnamese diacritics & bracket regex (`SH-007`, `W3-DB-1`) | 5,272ms | **PASS** |
| 4 | `resolve_deduped_study_sets` & `get_exam_eligible_pool` deduplicate folder+set overlap & preserve chapter/tag facets (`W3-DB-7`) | 1,524ms | **PASS** |
| 5 | Full Multi-Subject Exam Lifecycle LIVE (zero leak, live `answered_count`, `client_seq`, concurrent saves, short-answer `0`/`10`/`100`/`1.5`/VI, SM-2 `ease_factor = 1.96` restored, idempotency, unlimited time, `P0003` expiry) | 2,099ms | **PASS** |
| 6 | Full 500Q Coverage Cycle LIVE (250/exam -> discard -> Exam 1 -> Exam 2 zero overlap -> 500/500 completed -> restart cycle 2 `pool_order >= 0` -> delete trigger) | 6,715ms | **PASS** |
| 7 | `clone_study_set()` LIVE copies questions, options (1:1 UUID mapping even with duplicate position), accepted answers & tags (`SH-020`) | 310ms | **PASS** |
| 8 | `get_practice_question_pool()` LIVE returns 500 multi-subject questions with all 2,000 options intact (zero PostgREST 1,000-row truncation) | 498ms | **PASS** |

### 3.2 V3.0 Live Database & RPC Suite ([`tests/integration/live-v3-db-rpcs.test.ts`](file:///d:/Code%20Web/StudyHub/tests/integration/live-v3-db-rpcs.test.ts) — 8/8 PASS, `25.24s`)

| # | Live PG 17.12 V3.0 Test Case | Verified Behaviors | Duration | Verdict |
| --- | --- | --- | ---: | --- |
| 1 | **All 10 V3 tables, widened CHECKs, image-only prompt & image-only options** | `media_assets` (PNG <=5 MB & MP3 7.5 MB <=10 MB PASS; `image/svg+xml` & 6 MB image rejected with `23514`), `content_media_relations`, `shared_passages`, `diagram_sets`, `diagram_hotspots` (`point`/`rect`/`polygon`), image-only `questions.prompt = ''` & image-only `question_options.content = ''` PASS (blank without media rejected `23514`), `study_sessions.mode` (`spell`/`diagram`/`custom_practice`), `import_jobs.source_format` (`pdf_text`/`docx_multimedia`), `user_question_notes` private RLS (`userB` gets `[]`), `question_reports` viewer submit / viewer update blocked / owner resolve, `learning_session_checkpoints`, `learning_confidence_events`, direct `learning_sync_events` insert denied (`42501`). | 3,466ms | **PASS** |
| 2 | **All 12 exam-compatible V3 question types (19-question exam): anti-leak, column `42501`, immutability & live server grading** | `single_choice`, `multiple_choice`, `true_false`, `short_answer` (Vietnamese), `fill_in_blank` (multi-blank case-insensitive + case-sensitive), `numerical` (`0`, `10`, `100`, `-0.5 +/- 0.05`, accepted unit `"knots"`, wrong unit `"km/h"` rejected!), `image_choice` (shuffled image-only options graded by UUID), `ordering` (stable IDs), `matching` (duplicate right label + distractor), `image_hotspot` (`point` hit, `rect` hit, `polygon` miss), `reading_passage`, `listening` (audio-only prompt + pre-submit `transcript: null` + post-submit reveal `SECRET_TRANSCRIPT_999`). Direct PostgREST `SELECT type_payload_snapshot` & `SELECT explanation_rich_snapshot` fail **`42501`**; `prevent_exam_snapshot_update()` blocks V3 snapshot `UPDATE`; exact score `17/19 = 89.47%`; idempotent second submit records 0 duplicate `learning_confidence_events`. | 4,106ms | **PASS** |
| 3 | **P0 Confidence Exam Score Neutrality + Confidence SM-2 Mastery Guard** | Identical 4Q exams (2 right, 2 wrong) with `confidence = null` vs `guessing`/`unsure`/`certain` produce bit-for-bit identical `score_percent = 50`, `correct_count = 2`, `wrong_count = 2`, `passed = false`, while recording `guess_correct_count`, `high_conf_wrong_count`, and `learning_confidence_events`. Familiar item (`streak=2, interval=6`) answered correctly with `guessing` stays `!= 'mastered'` with `interval_days = 1`. | 1,454ms | **PASS** |
| 4 | **`clone_study_set()` V3 complete clone** | Copies all 19 V3 questions, clones `shared_passages`, `diagram_sets`, all 3 `diagram_hotspots`, preserves `prompt_rich`/`explanation_rich`, remaps BOTH FK columns (`passage_id`, `diagram_id`) AND JSONB `type_payload` IDs (`V3-DB-04`), and creates independent `content_media_relations` rows. | 443ms | **PASS** |
| 5 | **`reset_learning_progress()` across all 6 scopes** | Verifies `question`, `chapter`, `mode` (`spell` clears only `spell` checkpoint while preserving `learn` checkpoint), `study_set` (`clear_starred`), `subject`, and `all`; strictly bumps `user_preferences.progress_generation` on every call; strictly preserves `exam_attempts`, `questions`, `diagram_sets`, and `user_question_notes`. | 1,890ms | **PASS** |
| 6 | **`global_library_search()` across all 8 entity types** | Verifies hits across `folder`, `study_set`, `question`, `option`, `tag`, `chapter`, `note`, `diagram` (`total = 8`, `1` per type), disjoint bounded pagination (`limit=3, offset=0/3`), literal LIKE metacharacter escaping (`%%%` -> `0` hits), and strict cross-user private note isolation (`userB` gets `total = 0` on `userA`'s private note on a shared set). | 1,633ms | **PASS** |
| 7 | **`sync_offline_learning_events()` complete protocol** | Verifies `applied` (`answer`+`confidence`, `star`, `checkpoint_upsert`, `note_upsert`), same-user replay -> `duplicate_ignored` (no double increment), cross-user `event_id` replay -> `invalid` (zero oracle), stale `progress_generation` -> `ignored_stale_reset` for BOTH `answer` and `checkpoint_upsert` (`V3-DB-05`), lossless note `conflict` returning `server_version = 2` + `server_data` without poisoning retry with `base_version = 2` -> `applied (v3)`, `rejected_revoked` after share removal, and `rejected_deleted` on deleted question & non-existent set. | 1,957ms | **PASS** |
| 8 | **`content_media_relations` `ON DELETE RESTRICT` + polymorphic delete triggers** | Deleting source `questions` row cleans `'question'` relation while `'exam_attempt_question'` relation remains and blocks `DELETE FROM media_assets` with SQLSTATE **`23503`**; deleting `exam_attempts` fires `trg_cleanup_media_rel_exam_q` so `DELETE FROM media_assets` then succeeds; live `admin.auth.admin.deleteUser(userCId)` while `exam2` still references `media2` succeeds cleanly via `trg_cleanup_media_rel_profile` with `0` FK errors and `0` orphaned rows. | 2,574ms | **PASS** |

---

## 4. Residual Non-Blocking Architectural Observations

None of these are release blockers; documented honestly for V3.x roadmap clarity:

1. **Cross-Owner Media Clone Lifetime (`clone_study_set()`):** When User B clones a shared study set owned by User A (`allow_clone = true`) that contains private media assets under `<UserA>/<setA>/...`, cloned questions/diagrams reference User A's `media_assets.id` without duplicating Storage bytes across buckets/prefixes. If User A subsequently revokes User B's share on `setA`, User B's private Storage read on `setA` paths ends (expected for zero-copy Storage design; full cross-owner Storage object copy would be an optional future enhancement).
2. **Pre-Submit Ordering Sort Key (`sanitize_pre_submit_type_payload`):** `ordering` items are sorted `ORDER BY (it.val->>'id') ASC` pre-submit so `correct_position` never leaks. This is unpredictable as long as item IDs are random UUIDs (as generated by the editor/validator); sequential custom IDs (`"item-1"`, `"item-2"`) should continue to be avoided in favor of UUIDs.
3. **`NOT VALID` CHECK Constraints (`0013:351, 364, 405`):** Widened V3 constraints (`questions_prompt_or_media_v3_chk`, `questions_audio_url_safe_chk`, `question_options_content_or_image_v3_chk`) were intentionally added `NOT VALID` to avoid full table scans on live migration; PostgreSQL still strictly enforces them on every new `INSERT`/`UPDATE` (proven live in Test 1).

---

## 5. Live Data Preservation & Teardown Proof

- **Test Account Isolation:** Every disposable user created during Wave 5 was strictly prefixed (`v21-db-<ts>@studyhub-test.local` and `v3-db-{a,b,c}-<ts>@studyhub-test.local`).
- **Tracked-Only Cleanup:** Both `live-db-rpcs.test.ts` and `live-v3-db-rpcs.test.ts` recorded exact created user UUIDs in `trackedUserIds`, deleted ONLY rows belonging to those UUIDs, deleted ONLY those tracked auth users via `admin.auth.admin.deleteUser(uid)`, and asserted `trackedRemaining === 0` across `profiles`, `study_sets`, `media_assets`, `exam_attempts`, `user_question_notes`, `question_reports`, `learning_session_checkpoints`, `learning_confidence_events`, and `learning_sync_events`.
- **Pre-Existing Real User Data:** 100% untouched (zero blanket deletes, zero DB resets, zero secrets printed).
