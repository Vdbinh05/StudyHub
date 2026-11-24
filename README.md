# StudyHub V3.0 — Complete Learning Edition

**Personal Study, Multimedia Flashcard, Visual Diagram, Offline PWA & Universal Mock Exam Preparation Web Application** combining the clean active-recall modes of **Quizlet** with the multi-format question-bank importing, 12-type structured exam engine, Vietnamese print-ready PDF exports, and full-coverage testing workflows of **EduQuiz**.

> **Live Production HTTPS:** [`https://studyhub-three-mauve.vercel.app`](https://studyhub-three-mauve.vercel.app) (Vercel Hobby + Supabase Cloud Free, `$0/month`)  
> **100% Deterministic · Zero AI · Zero Payments · Privacy-First · Live-Verified on Supabase Cloud PostgreSQL 17.12 (`37/37` RLS Tables) · Offline-Capable PWA · Built for 10,000+ Questions & 1,000-Question Multi-Subject Exams**

---

## Product Principles

- **Zero AI in Runtime:** No LLMs, no OpenAI/Gemini/Anthropic SDKs, no chatbots, no vector databases, no paid TTS/STT, no OCR APIs, and no probabilistic guessing. File parsing (including multimedia `.docx` & selectable-text `.pdf` with honest scanned-PDF detection), answer-key detection, 12-type exam grading, multi-subject allocation (Strategies A–E), selection policies (1–8), Full Coverage cycles, SM-2 + confidence calibration, visual diagram geometry, Vietnamese PDF export (`pdf-lib`), and offline sync are **100% deterministic**.
- **Zero Payments or Artificial Limits:** No Stripe/billing SDKs, no paywalls, no ads, no paid trials, no Pro upgrades, and no artificial caps on study sets, imports, media assets, diagrams, offline downloads, PDF exports, exam presets, or exam attempts.
- **Bilingual Academic Calm UI (WCAG 2.2 AA):** Vietnamese (`vi`) default with instant English (`en`) switch (persisting localized `<title>` and skip links across reloads), Light & Dark modes (31/31 AA contrast pairs), wired preferences (`PreferencesProvider` + `<MotionConfig>`), IME-safe keyboard shortcuts (`?`), `Ctrl+K` Global Search (strictly blocked during active exams), and responsive navigation (`0px` overflow & `0px` navbar overlap across `360px`–`1920px`). User study content is never auto-translated.
- **Defense-in-Depth Security (Live-Verified on Production HTTPS):** Strict Row-Level Security (RLS) on all **37 PostgreSQL tables** across Migrations `0001`–`0017`, Supabase Cloud Security Advisor **`0` errors** (`unindexed_foreign_keys = 0`), distributed PostgreSQL rate limiting (`public.api_rate_limits`), server-verified sessions via `src/proxy.ts`, zero pre-submit answer leakage across all 12 exam types (`42501` column revocation), private `study-media` & `study-temp` Storage buckets (zero SVG/HTML, `ON DELETE RESTRICT` protecting exam snapshots, `>3.5 MB` direct signed `PUT` bypass with `finally` cleanup), TipTap JSON AST v1 sanitization + KaTeX `trust: false`, account-partitioned IndexedDB (`0`-leak A→B switch), strict `/sw.js` exclusion of `/api/*`/`/auth/*`/`/share/*`/`redirected`/`private` responses, and production HSTS/CSP/`Permissions-Policy` headers.

---

## Core Features

### 1. Multimedia, Rich Text, KaTeX Math & All 13 Question Types (`12` Exam-Compatible + Flashcard)
- **Private Media & Audio (`/api/uploads/image`, `/api/uploads/audio`, `/api/media`):** Raster image uploads (`<= 5 MB`, magic-byte verified, SVG rejected), browser-compatible audio uploads & in-browser recording (`<= 10 MB` / `120s` cap), SHA-256 owner deduplication, `ImageLightbox` (zoom, 2D pointer drag pan, pinch, fullscreen, `+/-`/`0`/`Esc`), `AudioPlayer`, and `content_media_relations` (`ON DELETE RESTRICT`) preserving historical exam media even after share revocation.
- **TipTap Rich Text & Safe KaTeX Math:** Canonical JSON AST v1 supporting academic formatting, lists, code, tables, and inline/block `$...$`/`$$...$$` LaTeX rendered deterministically via KaTeX (`trust: false`). TipTap (`145 KB` gzip) is strictly lazy-loaded (`next/dynamic`) so initial exam/study routes stay lean.
- **All 13 Structured Question Types:** `single_choice`, `multiple_choice`, `true_false`, `short_answer`, `fill_in_blank` (multi-blank), `numerical` (exact, abs/rel tolerance, `0`/`10`/`100`/`-0.5`, unit check), `image_choice` (image-only & image+caption options), `ordering`, `matching`, `image_hotspot` (normalized `[0,1]` point/rect/polygon), `reading_passage` (`shared_passages`), `listening` (private audio + post-submit transcript reveal), and `flashcard` (rich/audio flashcards excluded from exams).
- **Personal Notes, Question Error Reports & Bulk Editor:** Strictly private per-user notes (`user_question_notes`, 0-leak RLS across PostgREST & Global Search), 9-category Question Reports (`question_reports`, viewer submit -> owner/editor resolve inbox), and virtualized bulk editing (`/sets/[id]/edit`).

### 2. Eight Study Modes, Visual Diagrams, Confidence Calibration & Scoped Reset
- **8-Mode Study Set Hub (`/sets/[id]`):** Compatibility-gated launchers for **Flashcards** (Audio + TTS + 3D flip), **Advanced Learn** (5 study objectives + adaptive stages + mastery guards), **Practice** (instant feedback + KaTeX + Lightbox + Confidence + Notes + Report), **Write** (IME-safe deterministic grading), **Spell Mode (`/sets/[id]/spell`)** (character-level diff, progressive hints, TTS & uploaded audio), **Match**, **Visual Diagram Mode (`/sets/[id]/diagrams`, `/diagrams/[id]/edit`, `/diagrams/[id]/study`)** (Point/Rect/Polygon hotspots + 6 interactive study sub-modes on Desktop & Mobile `390px`), and **Timed Mock Exam**.
- **Confidence Calibration (`Chắc chắn / Phân vân / Đoán mò`):** Optional metacognitive tagging updating 4-quadrant calibration counters (`high_conf_wrong_count`, `guess_correct_count`, `low_confidence_count`) and targeted `/review` drills — **strictly confidence-neutral on exam scores (P0 invariant)**.
- **Continue Learning Checkpoints & Scoped Reset (`learning_session_checkpoints`, `reset_learning_progress()`):** Resume sessions across reloads from `/dashboard`, or reset progress by `question`, `chapter`, `mode`, `study_set`, `subject`, or `all` (bumping `progress_generation` to prevent offline resurrection) while **100% preserving `exam_attempts` history**.

### 3. Universal Multi-Subject Custom Exam Engine (`/exams/new`, `/exams`, `/practice`)
- **Multi-Subject & Folder Picker with Deduplication:** Combine any mix of Study Sets and recursive Folders without double-counting nested sets (`POST /api/exams/eligible`, `POST /api/exams/preview`).
- **Arbitrary Question Counts (`1..1,000+`), 5 Allocation Strategies (A–E) & 8 Selection Policies:** `global_random`, `equal`, `proportional` (Hamilton largest-remainder), `custom`, `weighted`; `random`, `unseen_first`, `mistakes_first`, `weak_topics_first`, `due_for_review`, strict non-padding `starred_only`/`incorrect_only`, and honest `anti_repeat`.
- **Full Coverage / No-Repeat Cycles (`coverage_cycles`) & Saved Presets (`/api/exam-presets`):** Split 100–10,000+ question banks into non-overlapping sequential exams (`500 -> 250 + 250`) with safe discard & 1-click cycle restart.
- **High-Scale Live Exam Runner (`/exams/[attemptId]` & `/results`):** Server wall-clock `expires_at` (or unlimited time), chunked `<=150` autosave (`client_seq`), `F5` reload persistence, virtualized navigator & results, and Per-Subject / Per-Chapter / Per-Tag breakdowns.

### 4. Deterministic Multi-Format Import & Print-Ready Vietnamese PDF Export
- **11 Deterministic Import Formats:**
  - **V3.0 New:** **Multimedia DOCX (`docx_multimedia`)** extracting embedded `<w:drawing>` PNG/JPG/WebP/GIF images (including Word tables & image-only options) with **SHA-256 Storage deduplication**, and **Selectable-Text PDF (`pdf_text`, `pdfjs-dist`)** deterministically extracting Vietnamese MCQs + repeating header/footer stripping + honest scanned-PDF detection (zero AI/OCR).
  - **V1.0–V2.1 Core (100% Parity Preserved):** DOCX OOXML formatting, Institutional 2-row merged-header & Wayground/Generic `.xlsx` (`exceljs`), EduQuiz TXT, Word Answer-Key (inline & end-of-doc), Quizlet TSV, CSV (`papaparse`), generic TXT, and lossless JSON.
- **Deterministic Vietnamese PDF Export (`POST /api/export/pdf`, `pdf-lib` + embedded `NotoSans`):** All **5 modes** (`question_paper`, `paper_and_key`, `paper_with_explanations`, `incorrect_review`, `flashcard_sheets`) with full Vietnamese diacritics, embedded raster images, RFC 5987 `filename*=UTF-8''`, `allow_clone = false` (`403`) & pre-submit `in_progress`/`discarded` (`403`) guards, plus JSON/CSV/XLSX export & full account JSON backup/restore.

### 5. Installable Offline PWA, Account-Partitioned Sync & Global Search (`Ctrl+K`)
- **Offline Study & Sync (`/offline`, `/settings?tab=offline`, `public/sw.js`, `POST /api/sync/events`):** Installable PWA (`manifest.webmanifest` + PNG icons), strict per-`userId` IndexedDB (`studyhub-offline-v3:${userId}` with `0`-leak Account A→B switch), real offline `F5` reload survival, and atomic idempotent sync (`applied`, `duplicate_ignored`, `ignored_stale_reset`, `rejected_revoked`, `rejected_deleted`, lossless note `conflict`).
- **Global Library Search & Shortcuts (`Ctrl+K` / `?`):** Searches all 8 entity types (`folder`, `study_set`, `question`, `option`, `tag`, `chapter`, `note`, `diagram`) via `global_library_search()` with strict private-note RLS, **Hard Exam Guard** suppressing `Ctrl+K` during active exams, and Vietnamese Telex/VNI IME-safe shortcuts.

---

## Tech Stack

| Layer | Technologies |
| --- | --- |
| **Framework & Language** | Next.js `16.4.6` (App Router, Turbopack, `src/proxy.ts`), React `19.3.1`, TypeScript `5.9` (`strict: true`) |
| **Styling, Rich Text & Motion** | Tailwind CSS v4, Radix UI + shadcn/ui, Lucide React, `motion/react`, `next-themes`, `sonner`, TipTap (`@tiptap/*`, lazy-split), KaTeX (`trust: false`) |
| **State, Scale & Offline PWA** | TanStack Query v5, TanStack Virtual v3, React Hook Form + Zod v4 (`^4.6.7`), Recharts v3 (lazy-split), `idb` (account-partitioned IndexedDB), `public/sw.js` |
| **Backend & Database** | Supabase (`@supabase/supabase-js`, `@supabase/ssr`), PostgreSQL 15–17 (**37 RLS tables**, Migrations `0001`–`0017`, **71 API routes**, private `study-media` & `study-temp` Storage, distributed PG rate limiting) |
| **Deterministic Server Parsers & PDF** | `jszip`, `fast-xml-parser`, `mammoth`, `exceljs`, `papaparse`, `pdfjs-dist` (`serverExternalPackages`, `outputFileTracingIncludes`, `isEvalSupported: false`), `pdf-lib` + `@pdf-lib/fontkit` (`ReadableStream` streaming, **0 B** client leakage) |
| **Testing & Quality** | Vitest `5.1` (**52 files / 388 tests** incl. live PG 17.12 & live HTTPS Vercel production suites), React Testing Library, `fake-indexeddb`, Playwright `1.58` (**22/22 live HTTPS E2E**), ESLint `9` flat config |

---

## Prerequisites & Local Development Setup

- **Node.js** `20.11+` (verified on `v24.15.0`) and **npm** `10+`
- **Live Supabase Backend:** a **hosted Supabase Cloud project** OR **Docker Desktop** (for local `npx supabase start`)

### 1. Install Dependencies
```bash
git clone <your-repo-url>
cd StudyHub
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env.local` and fill in your Supabase credentials (never commit `.env.local` — it is strictly gitignored):
```bash
cp .env.example .env.local
```

| Variable | Required | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL (`https://<ref>.supabase.co` or `http://127.0.0.1:54321`) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes *(primary)* | Modern Supabase publishable key (`sb_publishable_...`), protected by RLS on all 36 tables. Legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` supported as fallback. |
| `NEXT_PUBLIC_APP_URL` | Yes | `http://localhost:3000` locally, or production URL |
| `SUPABASE_SECRET_KEY` | Optional *(server-only)* | Modern Supabase secret key (`sb_secret_...`) isolated inside `src/lib/supabase/admin.ts` (`import "server-only"`) for permanent account deletion & admin test teardown. Legacy `SUPABASE_SERVICE_ROLE_KEY` supported as fallback. **Never** prefix with `NEXT_PUBLIC_`. |
| `NEXT_PUBLIC_ENABLE_GOOGLE_OAUTH` | Optional (`false`) | Set `true` after enabling Google provider in Supabase Auth |

> If Supabase env vars are not configured yet, public routes still build and run cleanly, protected routes redirect (`307 -> /login?setup=1`) with friendly maintenance copy, and database APIs fail closed with `503 SUPABASE_NOT_CONFIGURED` (never fake auth or mock data).

### 3. Apply Supabase Database Migrations (`0001`–`0017`)

Migrations live in `supabase/migrations/` and MUST be applied strictly in order (`0001`–`0012` are frozen V1.0–V2.1 baseline migrations; `0013`–`0017` deliver V3.0 Complete Learning Edition + Vercel Hobby production hardening):
- **`0001`–`0004` (V1.0 Baseline):** 20 core tables, RLS, triggers/RPCs, private `study-media` bucket.
- **`0005`–`0012` (V2.0–V2.1):** +6 tables (`exam_presets`, `exam_preset_sources`, `exam_attempt_sources`, `coverage_cycles`, `coverage_cycle_questions`, `coverage_cycle_attempts`), multi-subject & Full Coverage RPCs, Cloud Advisor hardening (`pg_trgm -> extensions`, `anon` lockdown), and PG 17.12 fixes.
- **`0013_v3_media_richtext_questions_schema.sql`:** Upgrades `study-media` to `10 MB` (4 raster + 9 audio MIMEs, zero SVG/HTML); adds `media_assets`, `content_media_relations` (`ON DELETE RESTRICT` + 6 polymorphic cleanup triggers), `shared_passages`, `diagram_sets`, `diagram_hotspots`; widens core tables; enforces column-level `42501` revocation & updated `prevent_exam_snapshot_update()`; extends `study_media_select` for historical exam media.
- **`0014_v3_learning_notes_reports_sync_tables.sql`:** Adds `user_question_notes`, `question_reports`, `learning_session_checkpoints`, `learning_confidence_events`, `learning_sync_events` with strict `(SELECT auth.uid())` RLS & FK indexes.
- **`0015_v3_rpcs_grading_search_reset_sync.sql`:** Adds `point_in_hotspot`, `sanitize_pre_submit_type_payload`, `grade_v3_exam_answer`, upgraded 12-type exam & clone RPCs, `reset_learning_progress()`, `global_library_search()`, and PgBouncer-safe `sync_offline_learning_events()`.
- **`0016_v3_live_fixes.sql`:** PG 17.12 live fixes (`btrim` drop for legacy `questions_prompt_check`, SM-2 `-0.54`/`-0.59` ease restoration, confidence/hint mastery caps, JSONB `passage_id`/`diagram_id` clone remap, and stale `checkpoint_upsert` sync guard).
- **`0017_v3_production_vercel_hardening.sql`:** Private `study-temp` bucket (`20 MB`, 3 `{auth.uid()}` RLS policies for `>3.5 MB` Vercel Hobby direct-upload bypass) and `public.api_rate_limits` (table #37, deny-all RLS) + `service_role`-only atomic `check_and_increment_rate_limit()` RPC.

**Option A — Hosted Supabase Cloud:**
```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```
*(Or execute `0001` through `0016` sequentially in the Supabase SQL Editor.)*

**Option B — Local Supabase CLI (requires Docker Desktop running):**
```bash
npx supabase start
npx supabase db reset
npx supabase db advisors
```

Configure Supabase **Authentication -> URL Configuration** with Site URL `${NEXT_PUBLIC_APP_URL}` and Redirect URLs:
- `${NEXT_PUBLIC_APP_URL}/auth/callback`
- `${NEXT_PUBLIC_APP_URL}/auth/confirm`
- `${NEXT_PUBLIC_APP_URL}/reset-password`

### 4. Start Dev Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000).

---

## Verification Commands & Current V3.0 Production Release Status

> **Live Production Release Verdict (`final-auditor`):** **`PRODUCTION READY WITH DOCUMENTED MINOR LIMITATIONS`** at [`https://studyhub-three-mauve.vercel.app`](https://studyhub-three-mauve.vercel.app) (**22/22** §22 Release Gates PASS; **30/30** Live Production Functional/Bypass/Scale/Phase-7 Auth Cases PASS; **22/22** Live Production Security Tests PASS; **52/52** Vitest files / **388/388** tests verified LIVE against production HTTPS; **0** open P0/P1/P2 defects; real user data 100% preserved). See [`docs/audit/v3-production/FINAL_ACCEPTANCE.md`](docs/audit/v3-production/FINAL_ACCEPTANCE.md).

| Command | Purpose | Fresh Verified Result (`2026-11-25`) |
| --- | --- | --- |
| `npm run typecheck` | TypeScript strict check (`tsc --noEmit`) | **PASS** (`0` errors) |
| `npm run lint` | ESLint 9 flat config (`eslint .`) | **PASS** (`0` errors, `0` warnings) |
| `LIVE_API_BASE_URL=https://studyhub-three-mauve.vercel.app npm run test` | Full Vitest suite (unit, diagram, offline, PDF export, Vercel transport/hardening + **live PG 17.12 & live HTTPS Vercel suites**) | **PASS (LIVE):** **52/52 files, 388/388 tests verified LIVE** against `https://studyhub-three-mauve.vercel.app` (`live-db-rpcs` **8/8**, `live-v3-db-rpcs` **8/8**, `live-rls-security` **11/11**, `live-v3-rls-security` **11/11**, `vercel-production-hardening` **12/12**, `vercel-transport` **12/12**) |
| `npm run build` / Vercel Production Build | Next.js 16.4.6 Turbopack production build (Node `24.x`) | **PASS** (`dpl_CUxPSwsnAfqQCVcLf8shZZwbrQDQ`, `28s`, `0` secret leaks & `0 B` server-parser leaks across `28` deployed CDN chunks) |
| `npm audit --omit=dev` | Production dependency vulnerability audit | **0 Critical, 0 High** (only pre-existing 2 Moderate `exceljs -> uuid@8.3.2` `SH-044`; **0 new advisories**; do NOT run `--force`) |
| `PLAYWRIGHT_BASE_URL=https://studyhub-three-mauve.vercel.app npx playwright test --workers=1` | Full Live HTTPS Playwright E2E + `>4.5 MiB` bypass + 500Q/250Q scale + Phase 7 Auth | **PASS (LIVE):** **30/30 production cases PASS** (`22/22` Playwright E2E, `3/3` `>4.5 MiB` `study-temp` bypasses, `4/4` 500Q/250Q/Full Coverage/PDF scale, Phase 7 `/auth/confirm`, `0` skipped, `0` failed) |

### Running Full Live Playwright E2E Tests
With `.env.local` pointing to a migrated (`0001`–`0016`) Supabase instance (tests create & delete strictly tracked disposable `*@studyhub-test.local` accounts without touching real user data):
```powershell
npm run build
$env:E2E_SUPABASE_READY = "1"
$env:PLAYWRIGHT_EXPECT_PROD = "1"
npx playwright test --workers=1
```

---

## Vercel Deployment & Backup / Restore

1. Push to GitHub/GitLab/Bitbucket and import into **Vercel** (`Next.js` preset, Node.js `20.x` or `22.x`).
2. Configure `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_APP_URL`, and `SUPABASE_SECRET_KEY` (server-only) in Vercel Environment Variables.
3. Run `npx supabase db push` (applying `0001`–`0016`) against production Supabase and register Auth **Site URL** + **Redirect URLs**.
4. Verify `GET /api/health` returns `200 OK` (`supabaseConfigured: true`) and inspect CSP/HSTS/`Permissions-Policy` + `/sw.js` `no-store` headers.
5. **Backups:** Run `pg_dump` / `pg_restore` for database backups, export study sets via JSON/CSV/XLSX/PDF, or run full personal JSON export (`GET /api/account/data`) and restore (`POST /api/account/restore`) directly in `/settings`. See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

---

## Documentation & Independent Audit Index

### V3.0 Production Release & Vercel Hobby Audit Suite (`docs/audit/v3-production/`)
- [docs/audit/v3-production/FINAL_ACCEPTANCE.md](docs/audit/v3-production/FINAL_ACCEPTANCE.md) — **Binding Production Release Verdict (`PRODUCTION READY WITH DOCUMENTED MINOR LIMITATIONS`) & 22/22 §22 Release Gates**
- [docs/audit/v3-production/ISSUE_TRACKER.md](docs/audit/v3-production/ISSUE_TRACKER.md) — All `10/10` production hardening, Phase 7 auth, & UX defects closed + non-blocking V3.1 backlog
- [docs/audit/v3-production/SECURITY_AUDIT.md](docs/audit/v3-production/SECURITY_AUDIT.md) — Live HTTPS Vercel security audit (`22/22` live RLS/HTTP, `study-temp` `403`, live PG rate-limit `429`, `28` CDN chunks & `106` log lines clean)
- [docs/audit/v3-production/TEST_MATRIX.md](docs/audit/v3-production/TEST_MATRIX.md) — **30/30 PASS** Live Production Matrix (`22/22` E2E + `3/3` `>4.5 MiB` bypass + `4/4` 500Q/250Q scale + Phase 7 Auth)
- [docs/audit/v3-production/REGRESSION_REPORT.md](docs/audit/v3-production/REGRESSION_REPORT.md) — Live production latency, triage & regression certification
- [docs/audit/v3-production/USER_EXPERIENCE_REPORT.md](docs/audit/v3-production/USER_EXPERIENCE_REPORT.md) — Live production real-student UX walkthrough (`0` open P0/P1/P2) + `18` curated HTTPS screenshots (`docs/audit/v3-production/screenshots/`)

### Production Operations Guides
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — Vercel Hobby & Supabase Cloud deployment, env var names, `0001`–`0017` migrations, Auth URLs, `study-temp` bypass & streaming exports
- [docs/PRODUCTION_RUNBOOK.md](docs/PRODUCTION_RUNBOOK.md) — Instant Vercel/Git rollback (zero DB reset) & incident recovery playbooks
- [docs/FREE_TIER_LIMITATIONS.md](docs/FREE_TIER_LIMITATIONS.md) — Transparent `$0/month` Vercel Hobby + Supabase Free operating envelope & mitigations

### V3.0 Complete Learning Edition Audit Suite (`docs/audit/v3/`)
- [docs/audit/v3/FINAL_ACCEPTANCE.md](docs/audit/v3/FINAL_ACCEPTANCE.md) — **Binding V3.0 Release Verdict (`READY WITH DOCUMENTED MINOR LIMITATIONS`) & 55/55 §41 Acceptance Criteria**
- [docs/audit/v3/ISSUE_TRACKER.md](docs/audit/v3/ISSUE_TRACKER.md) — Full lifecycle of all **20/20** Wave 5 defects (`5 P0`, `8 P1`, `7 P2`, `0` open) + non-blocking P3 backlog
- [docs/audit/v3/BASELINE.md](docs/audit/v3/BASELINE.md) — Pre-V3.0 `v2.1-verified` baseline & Supabase Free-Tier guardrails
- [docs/audit/v3/DB_BACKEND_AUDIT.md](docs/audit/v3/DB_BACKEND_AUDIT.md) — Live PG 17.12 Migrations `0013`–`0016` & 16/16 RPC audit
- [docs/audit/v3/SECURITY_AUDIT.md](docs/audit/v3/SECURITY_AUDIT.md) — 3-Account Live RLS, Storage, 12-Type Anti-Leak, XSS/KaTeX, PDF & PWA security audit (`22/22` live + `39/39` unit)
- [docs/audit/v3/PERFORMANCE_REPORT.md](docs/audit/v3/PERFORMANCE_REPORT.md) — Real aviation 4-file corpus, 50Q multimedia DOCX dedup, VN PDF import/export (5 modes), 10kQ scale, 100-event sync & `.next` bundle audit
- [docs/audit/v3/TEST_MATRIX.md](docs/audit/v3/TEST_MATRIX.md) — §35 **93/93 PASS** & §41 **55/55 PASS** Acceptance Test Matrix
- [docs/audit/v3/REGRESSION_REPORT.md](docs/audit/v3/REGRESSION_REPORT.md) — Complete **22/22** live Playwright E2E & V2.1 regression report
- [docs/audit/v3/USER_EXPERIENCE_REPORT.md](docs/audit/v3/USER_EXPERIENCE_REPORT.md) — Live Real-Student 8-Scenario UX Audit + 22 curated screenshots (`docs/audit/v3/screenshots/`)

### V2.0 / V2.1 Historical Audit Archive (`docs/audit/`)
- [docs/audit/FINAL_ACCEPTANCE.md](docs/audit/FINAL_ACCEPTANCE.md) · [docs/audit/ISSUE_TRACKER.md](docs/audit/ISSUE_TRACKER.md) · [docs/audit/TEST_MATRIX.md](docs/audit/TEST_MATRIX.md) · [docs/audit/UIUX_AUDIT.md](docs/audit/UIUX_AUDIT.md)

### Core Engineering Specifications
- [AGENTS.md](AGENTS.md) — Engineering contract & security mandates
- [docs/PRD.md](docs/PRD.md) — Product requirements & personas
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — Full-stack architecture, V3.0 routes, PWA & scale strategy
- [docs/DATABASE.md](docs/DATABASE.md) — Schema & RLS matrix across all 36 tables (`0001`–`0016`)
- [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) — Academic Calm Light/Dark tokens, WCAG 2.2 AA, Motion & V3.0 UI patterns
- [docs/IMPORT_FORMATS.md](docs/IMPORT_FORMATS.md) — Deterministic 11-format import & 5-mode Vietnamese PDF export spec
- [docs/SECURITY.md](docs/SECURITY.md) — Threat model, 12-type exam anti-leak, media/PDF/XSS guards & PWA isolation
- [docs/TESTING.md](docs/TESTING.md) — 50-file Vitest + 22-test Playwright live verification suite
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — Local dev, Vercel/Supabase deployment, and backup/restore runbook
- [docs/SKILLS.md](docs/SKILLS.md) — Audited engineering skills & V2.0/V2.1/V3.0 actual usage evidence
- [docs/PROGRESS.md](docs/PROGRESS.md) — V1.0, V2.0, V2.1 & V3.0 milestone & verification tracker
