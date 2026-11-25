# StudyHub V3.2 — Consolidated Root Cause Analysis (`ROOT_CAUSE_ANALYSIS.md`)

> **Orchestrator:** Agent 0 (`coordinator`)  
> **Synthesized From:** `BASELINE.md` (`perf-auditor`), `WAVE1_FUNC_BUGS.md` (`func-tester`), `WAVE1_SECURITY_DB_AUDIT.md` (`security-auditor`), `WAVE1_REAL_USER_BASELINE.md` (`real-user`)  
> **Baseline Commit:** `39952bd` (`v3.2-checkpoint`)

---

## 1. Systemic Root-Cause Clusters (Why Issues Happened)

Rather than patching symptoms individually, Wave 1 exposed **7 clear architectural root-cause clusters** that account for over 90% of all stability, latency, security, and UX issues:

### Cluster 1 — Client Cache Fragmentation & Unverified Identity Bootstrapping (`V32-001`, `V32-008`, `V32-013`, `V32-024`, `V32-027`)
- **What broke:** StudyHub accumulated **9 overlapping persistence/cache layers** (HTTP `Cache-Control`, React Query, IndexedDB, 4 `localStorage` namespaces, and JS module singletons) without a single server-verified identity anchor or centralized query-key/logout contract.
- **Root causes:**
  1. `AuthenticatedBootstrap` avoided an `/api/profile` round-trip on focus routes by trusting `localStorage["studyhub-offline-active-user"]`, allowing stale `userA.id` to drive `PwaProvider`'s IndexedDB and `sync_queue` under User B's cookies (`V32-001`).
  2. `apiSuccess()` / `apiError()` omitted `Cache-Control: private, no-store` & `Vary: Cookie`, causing Vercel to serve 65/71 private JSON endpoints with `public, max-age=0, must-revalidate` (`V32-008`).
  3. Mutations in `ImportWizard`, `question-editor-view`, `LiveExamRunner`, and `PwaProvider.syncNow()` lacked centralized query-key invalidation, causing immediate stale `0 câu hỏi` lockouts and stale dashboard banners (`V32-013`, `V32-024`).
  4. Multiple study modes keyed local checkpoints by `bundle.studySet.owner_id` instead of the authenticated viewer's `userId`, and never honored `?fresh=1` (`V32-027`).
- **Architectural fix:** Pass server-verified `initialUserId` from `src/app/(app)/layout.tsx` -> `AuthenticatedProviders` -> `PwaProvider`; add centralized `src/lib/query-keys.ts` + `purgeAllUserClientState()` + `BroadcastChannel("studyhub-auth")`; default `Cache-Control: private, no-store` + `Vary: Cookie` in `errors.ts`.

### Cluster 2 — Study Mode Multi-Wave Waterfalls & Monolithic DOM Mounts (`V32-014`, `V32-015`, `V32-016`, `V32-017`, `V32-042`)
- **What broke:** Mobile 4G Warm Practice LCP stayed at `3.06s` (5.62s in blind real-user 278Q test), Flashcards at `2.78s`, `/login` regressed `+202 KiB` (`2,914ms` LCP) after the branding commit `39952bd`, `/sets/[id]` peaked at `21.1 MB` heap / `3,835` DOM nodes / `433ms` TBT, and `/exams/new` peaked at `774ms` Mobile 4G Cold TBT.
- **Root causes:**
  1. **Brand Logo Double-Download + RSC Prefetch (`V32-014`):** `BrandLogo` mounts both light and dark `<img>` elements with `fetchPriority="high"`, and `AuthShell` `<Link href="/">` triggers prefetching `/` RSC high-priority logos on `/login` (**5 brand PNGs = 187.2 KB**, `max-age=0`).
  2. **Study Mode Triple-Fetch + Blocking 250Q Waterfall (`V32-015`):** `useStudySetBundle` fires redundant `/api/progress` and `/api/starred` (both already joined inside `/api/sets/[id]/questions`), blocks Q1 until ALL paginated question pages finish downloading, and `PracticeClient` adds an extra `setTimeout(0)` phase flip.
  3. **Unvirtualized 50-Card Set Hub + 4-RTT Summary API (`V32-012`, `V32-016`):** `study-set-hub.tsx` synchronously mounts 50 full `<RichContentRenderer>` cards (`3,835` DOM nodes), while `GET /api/sets/[id]/questions?fields=summary` runs 4 sequential Supabase RTTs (`475ms`) and still ships heavy TipTap `*_rich` JSONB blobs.
  4. **Monolithic Exam Builder + Missing Cache Seed (`V32-017`):** `CustomExamBuilderClient` mounts `1,220` DOM nodes on Step 1 and calls `router.push` without `queryClient.setQueryData(["exam-attempt", id], created)`, forcing a redundant `406.4 KB` `GET /api/exams/[id]` right after `POST /api/exams`.
- **Architectural fix:** Single active-theme brand image + `prefetch={false}` + `/brand/*` long-lived cache headers; progressive rolling Page-1 Q1 start in `useStudySetBundle` (zero redundant `/progress` & `/starred`); 20-card / virtualized Set Hub + single-query lightweight summary API; lazy-split Exam Builder steps + React Query cache seeding on exam launch.

### Cluster 3 — Exam Autosave, Reload Durability & V3 Snapshot Projections (`V32-002`, `V32-004`, `V32-005`, `V32-022`, `V32-027`, `V32-028`)
- **What broke:** Students could silently lose answers on fast reload (<300ms), lose V3 structured answers when toggling Flag after resume, watch merged offline drafts sit unflushed under a false green `"Đã lưu"` badge, lose their place (`Q200 -> Q1`) on F5 reload, and see duplicated DOCX images side-by-side.
- **Root causes:**
  1. `GET /api/exams/[attemptId]` stripped `structured_response`, `confidence`, and `hint_used` in its manual pre-submit mapper (`V32-002`).
  2. `LiveExamRunner` debounced `localStorage` writes by `300ms + requestIdleCallback(1000)` with no `pagehide`/`visibilitychange` `keepalive` flush (`V32-004`), ran its offline auto-flush `useEffect` only before `examQuery.data` arrived (`V32-005`), and didn't persist `currentQuestionIndex` (`V32-027`).
  3. Exam question rendering rendered both `question.image_url` and `attachments` without deduplicating matching paths/IDs (`V32-022`), while `V3ExamQuestionBody` had dead narrowing for `listening+fill_in_blank` and no Confirm action for `ordering`.
- **Architectural fix:** Return `structured_response`, `confidence`, `hint_used` pre-submit (still strictly excluding all grading keys!); synchronous user-partitioned `localStorage` draft writes (with TTL/cap + `currentQuestionIndex`); `pagehide`/`visibilitychange` `keepalive` flush; reactive post-hydration dirty-queue flush; image deduplication & full 12-type exam controls.

### Cluster 4 — Learning Mode V1/V3 Parity, Progress Trust & UX Friction (`V32-003`, `V32-007`, `V32-020`, `V32-021`, `V32-023`, `V32-025`, `V32-031`, `V32-032`, `V32-041`)
- **What broke:** Practice wiped `30/278` back to `0/278` on exit/resume; Learn & `/review` printed `[object Object]`; Learn/Spell resume banners lied `1/15 (0%)`; English Spell spoke with Vietnamese TTS; all 6 `/settings?tab=modes` panels did nothing; Practice/Learn broke V3 structured types; `?` opened 2 stacked modals; Learn 5-tab SM-2 chrome dominated Screen 1.
- **Root causes:** Incomplete V3 migrations across learning UI components (`getExpectedWriteAnswers()` object vs string mismatch; missing Practice checkpoint wiring; `PracticeClient` V1 binary branch; `mode_preferences` never consumed; TTS bound to UI `locale` instead of card text; duplicate `?` listener without `defaultPrevented`).
- **Architectural fix:** Unified Practice checkpoint persistence & auto-resume; shared V3 structured interactive renderer & human-readable answer formatter across Practice/Learn/Review/Starred; text-based TTS language auto-detection; single modal- & IME-safe shortcut dispatcher; wire `mode_preferences` across all 6 modes; tuck Learn SM-2 stage picker into compact `>=44px` popover.

### Cluster 5 — Database Concurrency, Index Efficiency & Cross-Tenant Media Integrity (`V32-006`, `V32-009`, `V32-010`, `V32-011`, `V32-012`, `V32-043`–`V32-047`, `V32-051`)
- **What broke:** Concurrent offline sync retries double-applied SM-2/confidence counts; 6 mutation APIs had non-atomic RMW races; account deletion wiped other users' exam snapshot media; cloned sets broke on revocation; Full Coverage wedged on mid-cycle question deletion; 12 duplicate indexes bloated writes; Backup/Restore corrupted all V3 question types.
- **Root causes:** Missing row-locking/pre-claim in `0016`/`0018` RPCs; unconditional prefix delete in `/api/account/data`; direct foreign `media_id` reuse in `clone_study_set`; ignoring `question_id IS NULL` in coverage remaining counts; legacy V2 backup/restore whitelist.
- **Architectural fix:** Additive, backward-compatible **Migration `0019_v3_2_stability_security_and_perf.sql`** (preserving 37/37 RLS tables, `(SELECT auth.uid())`, `SET search_path = ''`, explicit `REVOKE ... FROM PUBLIC, anon`), atomic RPCs, safe reference-checked Storage cleanup, copy-on-clone media isolation, Full Coverage auto-completion on deleted remainder, and `studyhub-v3` Backup/Restore.

### Cluster 6 — Offline PWA State Accuracy & Mobile Ergonomics (`V32-029`, `V32-034`, `V32-035`, `V32-042`)
- **What broke:** Offline Hub showed `"Nội dung này chưa được tải ngoại tuyến"` while actively studying offline and falsely flashed green `"Trực tuyến"` on offline reopen; `F5` exited offline study; `OfflineStudyRunner` missed option images & V3 types; Mobile Focus Header crushed titles to `"A"` / `"M.."` with 3 stacked offline bars; sub-44px mobile controls across routes.
- **Root causes:** `/offline` initialized `isOnline = true` unconditionally before checking `navigator.onLine`, kept the fallback hero mounted when `activeSetId` was set, lacked sessionStorage restore, and lacked V3 rendering parity; `FocusModeShell` placed long titles inside a single crowded mobile flex row.
- **Architectural fix:** Synchronous `navigator.onLine` + cached-user initialization on `/offline`, conditional hero hiding during active offline study, `sessionStorage` resume across offline reload, full V3/option-image/multi-diagram parity in `OfflineStudyRunner`, clean mobile Focus Header layout + single offline indicator, and `>=44px` mobile touch targets.

### Cluster 7 — Import/Media Sequential I/O & Question Editor Overload (`V32-018`, `V32-019`, `V32-024`, `V32-030`, `V32-033`, `V32-036`, `V32-038`, `V32-040`, `V32-048`)
- **What broke:** 133Q multimedia DOCX import took `11.88s`; Fill-in-Blank editor ate spaces (`"Ha Noi"` -> `"HaNoi"`); Question Editor packed 38 controls into `1,300px` with 2 Save buttons, blank image box & dev jargon; PDF export dropped auto-compressed WebP uploads & V3 structured answers; `/import` forced double file-picker & hid `.pdf`; multi-chunk DOCX commit deleted Chunk 2's shared temp media.
- **Root causes:** Serial `for`-loop Storage uploads (`4` RTTs/image); `.trim()` inside controlled `onChange`; uncollapsed secondary editor fields; client auto-compression converting PNG/JPEG to WebP despite `pdf-lib` only embedding PNG/JPEG (and Safari WebP mismatch); missing `isFinalChunk` guard.
- **Architectural fix:** Bounded concurrent Storage upload/download pool (`concurrency = 6`) + batched `media_assets` & parallel child inserts; raw draft state + stable keys in `V3QuestionTypeFields`; sticky-footer progressive-disclosure Question Editor with clean student copy & row Edit/media badges; JPEG/PNG PDF- & Safari-compatible compression + V3 structured answers in PDF export; single-pick `/import` with `.pdf` + client File handoff.

---

## 2. Wave 3 Builder Ownership & Zero-Collision Contract

| Builder | Exclusive Code Ownership | Must NOT Touch |
| --- | --- | --- |
| **`be-db-builder`** | `supabase/migrations/0019_*.sql`, `src/lib/security/*`, `src/lib/supabase/*`, `src/app/api/**` (EXCEPT `import/*`, `export/*`, `uploads/image/*`, `uploads/audio/*`, `media/*`), `tests/unit/security/v32-backend-security.test.ts` & `supabase-migrations-audit.test.ts` | `supabase/migrations/0001..0018`, `src/components/*`, `src/app/api/(import\|export\|uploads/image\|uploads/audio\|media)/*`, `package.json`, `next.config.ts` |
| **`fe-perf-builder`** | `next.config.ts`, `package.json`, `package-lock.json`, `src/app/providers.tsx`, `src/app/(app)/layout.tsx`, `src/app/(app)/authenticated-providers.tsx`, `src/lib/query-keys.ts`, `src/lib/auth/client-session-cleanup.ts`, `src/lib/preferences/index.tsx`, `src/lib/ui/shortcuts.ts`, `src/lib/i18n/*`, `src/components/auth/*`, `src/components/layout/*`, `src/components/analytics/dashboard-view.tsx`, `src/components/library/{library-view,folder-detail-view,study-set-hub,create-set-form}.tsx`, `src/components/ui/*`, `tests/unit/security/v32-client-cache-isolation.test.ts`, `tests/unit/ui/shortcuts.test.ts` | `supabase/*`, `src/app/api/*`, `src/components/(learning\|exam\|pwa\|import\|editor\|media)/*`, `src/components/library/import-hub-view.tsx` |
| **`learn-exam-builder`** | `src/components/learning/*`, `src/components/exam/*`, `src/components/diagram/DiagramStudyPlayer.tsx`, `src/lib/learning/*`, `src/lib/audio/tts.ts`, `src/app/(app)/sets/[id]/(flashcards\|learn\|practice\|write\|spell\|match\|test\|results)/**`, `src/app/(app)/exams/**`, `src/app/(app)/review/**`, `src/app/(app)/practice/**`, `tests/unit/learning/*` | `supabase/*`, `src/app/api/*`, `src/components/(layout\|pwa\|import\|editor\|media\|ui)/*`, `src/lib/i18n/*` |
| **`mobile-pwa-builder`** | `public/sw.js`, `src/lib/offline/*`, `src/components/pwa/*`, `src/app/offline/*`, `tests/unit/offline/*` | `supabase/*`, `src/app/api/*`, `src/components/(layout\|learning\|exam\|import\|editor\|media\|ui)/*`, `src/lib/i18n/*` |
| **`import-media-builder`** | `src/app/api/import/*`, `src/app/api/export/*`, `src/app/api/uploads/image/*`, `src/app/api/uploads/audio/*`, `src/app/api/media/*`, `src/lib/import/*`, `src/lib/export/*`, `src/lib/media/*`, `src/components/import/*`, `src/components/editor/*`, `src/components/media/*`, `src/components/library/import-hub-view.tsx`, `tests/unit/(import\|export\|media)/*` | `supabase/*`, `src/components/(layout\|learning\|exam\|pwa\|ui)/*`, `src/lib/i18n/*`, `src/app/api/uploads/signed-url/*` |
