# StudyHub V2.1

**Personal Study, Flashcard & Universal Mock Exam Preparation Web Application** combining the clean active-recall modes of **Quizlet** with the multi-format question-bank importing, multi-subject custom exam builder, and full-coverage testing workflows of **EduQuiz**.

> **100% Deterministic · Zero AI · Zero Payments · Privacy-First · Live-Verified on Supabase Cloud PostgreSQL 17.12 · Built for 10,000+ Questions & 1,000-Question Multi-Subject Exams**

---

## Product Principles

- **Zero AI in Runtime:** No LLMs, no OpenAI/Gemini/Anthropic SDKs, no chatbots, no vector databases, and no probabilistic guessing. File parsing, answer-key detection, multi-subject allocation (Strategies A–E), selection policies (1–8), Full Coverage cycles, option grading, shuffling, spaced repetition (SM-2), and analytics are 100% deterministic.
- **Zero Payments or Artificial Limits:** No Stripe/billing SDKs, no paywalls, no ads, and no artificial caps on study sets, file imports, exam presets, coverage cycles, or mock exam attempts.
- **Bilingual Calm Academic UI (WCAG 2.2 AA):** Vietnamese (`vi`) default with instant English (`en`) switch (persisting localized `<title>` and skip links across reloads), Light & Dark modes (31/31 AA contrast pairs verified), wired user preferences (`PreferencesProvider` + `<MotionConfig>`), keyboard-first desktop focus modes, and mobile one-hand 5-tab navigation. User study content is never auto-translated.
- **Defense-in-Depth Security (Live-Verified):** Strict Row-Level Security (RLS) on all **26 PostgreSQL tables** across Migrations `0001`–`0012`, Supabase Cloud Security Advisor `0` errors (`extension_in_public = 0`, `unindexed_foreign_keys = 0`), server-verified sessions via `src/proxy.ts`, server-resolved exam snapshots (`create_exam_attempt_v2`), zero pre-submit exam answer leakage (`42501` column revocation), private `study-media` Storage with magic-byte upload proxy & durable signed URLs, streaming ZIP-bomb & XLSX XXE guards, and production HSTS/CSP headers.

---

## Core Features

### 1. Universal Custom Exam Engine (`/exams/new` & `/exams`)
- **Multi-Subject & Folder Picker with Strict Deduplication:** Combine any mix of Study Sets and recursive Folders without double-counting nested sets (`POST /api/exams/eligible`, `POST /api/exams/preview`).
- **Arbitrary Question Counts (`1..1,000+`):** Supports odd counts, long 250/500/1,000-question mock exams, smart untouched-default auto-clamp when selecting smaller pools, and strict validation rejecting explicit out-of-bounds inputs.
- **5 Deterministic Multi-Subject Allocation Strategies (A–E):** Global Random (`global_random`), Equal with shortage redistribution (`equal`), Proportional Hamilton largest-remainder (`proportional`), Custom exact counts per subject (`custom`), and Weighted percentages (`weighted`).
- **8 Deterministic Selection Policies:** `random`, `unseen_first`, `mistakes_first`, `weak_topics_first`, `due_for_review` (SM-2), strict non-padding `starred_only`, strict non-padding `incorrect_only`, and honest-disclosure `anti_repeat`.
- **Full Coverage / No-Repeat Cycles (`coverage_cycles`):** Split any 100–10,000+ question bank into sequential non-overlapping exams (`500 -> 250 + 250`, `500 -> 120×4 + 20`) with explicit tri-state tracking (`assigned` vs `answered` vs `completed`), safe discard returning unanswered questions to the pool without fake completion, and 1-click cycle restart.
- **Private Config-Only Exam Presets (`/api/exam-presets`):** Save, favorite, edit, duplicate, and 1-click relaunch reusable exam blueprints (never freezes question IDs; re-verifies source access at launch).
- **250–1,000Q Live Exam Runner & Mixed-Subject Results (`/exams/[attemptId]` & `/results`):** Server wall-clock `expires_at` (or unlimited time), memoized `<ExamTimer />`, chunked `<=150` offline autosave with monotonic `client_seq` and live `answered_count`, F5 reload persistence, zero-drift 50px virtualized navigator with status/subject filters & `M`/`F` hotkeys, virtualized 1,000Q review, true weighted overall accuracy, and Per-Subject / Per-Chapter / Per-Tag breakdowns.

### 2. Multi-Subject Practice & Five Active-Recall Modes + SM-2
- **Multi-Subject Custom Practice (`/practice`, `POST /api/practice/questions`):** Untimed instant-feedback drilling across multiple sets/folders with policy & chapter/tag/difficulty filters and per-question SM-2 attribution.
- **Flashcards (`/sets/[id]/flashcards`):** Accessible CSS Grid 3D flip (`motion/react` + reduced-motion crossfade), stable seeded shuffle, full 4-level SM-2 buttons & hotkeys (`1=Again, 2=Hard, 3=Good, 4=Easy`).
- **Learn (`/sets/[id]/learn`):** Single-session deterministic adaptive mastery rounds re-queuing missed questions.
- **Practice (`/sets/[id]/practice`):** EduQuiz-style practice with virtualized navigator, instant feedback, and explanations.
- **Write (`/sets/[id]/write`):** Typed recall with unified 3-way deterministic normalization (`exact`, `case_insensitive`, `ignore_diacritics`, `numeric` incl. `0`/`10`/`100`/`1.5`), Vietnamese Telex/VNI IME-safe Enter handling, and single-commit self-assessment override.
- **Match (`/sets/[id]/match`):** Timed interactive pair-matching board with responsive keyboard grid navigation.
- **Spaced Repetition (`/review`), Starred (`/starred`), History (`/history`), & Analytics (`/statistics`):** Unified 3-way SM-2 due queue, mistake bank merging both study sessions and exam attempts, multi-subject exam history, real streak & Recharts analytics.

### 3. Deterministic Multi-Format Import & Lossless Export (`/import` & `/sets/[id]/import`)
- **9 Deterministic Formats:** DOCX OOXML (`jszip` + `fast-xml-parser` supporting Bold/Highlight/Color/Underline, `<w:br/>` splitting, and conflict detection), Institutional 2-row merged-header & Wayground/Generic Excel (`.xlsx` via `exceljs` with `SC`/`MC`/`TF` mapping and `U+FEFF`/prefix cleanup), EduQuiz TXT, Word Answer-Key (inline & end-of-document), Quizlet TSV, CSV (`papaparse`), and lossless JSON.
- **Data Integrity & Scale:** Composite duplicate fingerprinting `(prompt + sorted options + correct answers)` with O(1) commit prompt prefiltering, O(1) Step-5 inline edit validation (`0.031 ms`), chunked commits, streaming ZIP-bomb (50 MB / 100:1) & XLSX XXE guards, OWASP CSV formula escaping, and full account JSON backup & restore (`GET /api/account/data`, `POST /api/account/restore`).

### 4. Organization, Favorites & Friend Sharing
- Hierarchical **Folders** (`/folders`, `/folders/[id]`, cycle-guarded), **Favorite Study Sets**, **Virtualized 10k Question Editor** (`/sets/[id]/edit` with chapter/tag/difficulty filters & confirmation dialogs), **Friendships** (`/friends` with `blocked_by` enforcement), collaborator roles (`owner`, `editor`, `viewer`), revocable/expiring **Share Links** (`/share/[token]`), and atomic SQL **Duplicate / Clone** enforcing `allow_clone`.

---

## Tech Stack

| Layer | Technologies |
| --- | --- |
| **Framework & Language** | Next.js `16.4.6` (App Router, Turbopack, `src/proxy.ts`), React `19.3.1`, TypeScript `5.9` (`strict: true`) |
| **Styling & Motion** | Tailwind CSS v4, Radix UI + shadcn/ui primitives, Lucide React, `motion/react`, `next-themes`, `sonner` |
| **State, Forms & Scale** | TanStack Query v5, TanStack Virtual v3, React Hook Form + Zod v4 (`^4.6.7`), Recharts v3 (lazy-split) |
| **Backend & Database** | Supabase (`@supabase/supabase-js`, `@supabase/ssr`), PostgreSQL 15–17 (**26 tables**, Migrations `0001`–`0012`, strict RLS, RPCs, private Storage, 53 API routes) |
| **Deterministic Parsers** | `jszip`, `fast-xml-parser`, `mammoth`, `exceljs`, `papaparse` (100% server-only, 0 B client leakage) |
| **Testing & Quality** | Vitest `5.1` (**24 files / 187 tests** incl. live PG 17.12 RPC & 2-account RLS/HTTP suites), React Testing Library, Playwright `1.58` (**16/16 live E2E**), ESLint `9` flat config |

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
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Yes *(primary)* | Modern Supabase publishable key (`sb_publishable_...`), protected by RLS on all 26 tables. Legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` is also supported as a seamless fallback. |
| `NEXT_PUBLIC_APP_URL` | Yes | `http://localhost:3000` locally, or production URL |
| `SUPABASE_SECRET_KEY` | Optional *(server-only)* | Modern Supabase secret key (`sb_secret_...`) isolated inside `src/lib/supabase/admin.ts` (`import "server-only"`) for permanent account deletion & admin teardown. Legacy `SUPABASE_SERVICE_ROLE_KEY` is supported as fallback. **Never** prefix with `NEXT_PUBLIC_`. |
| `NEXT_PUBLIC_ENABLE_GOOGLE_OAUTH` | Optional (`false`) | Set `true` after enabling Google provider in Supabase Auth |

> If Supabase env vars are not configured yet, public routes still build and run cleanly, protected routes redirect cleanly (`307 -> /login?setup=1`) with student-friendly maintenance copy (zero `503` retry storms), and database APIs fail closed with `503 SUPABASE_NOT_CONFIGURED` (never fake auth or mock data).

### 3. Apply Supabase Database Migrations (`0001`–`0012`)

Migrations live in `supabase/migrations/` and must be applied strictly in order (`0001`–`0004` are immutable baseline migrations; `0005`–`0012` deliver V2.0/V2.1 schema, RPCs, Cloud Advisor hardening, and live PG 17.12 fixes):
1. `0001_initial_schema.sql` — 20 baseline UUID tables, constraints, and indexes
2. `0002_rls_policies.sql` — Baseline RLS on all 20 tables + pre-submit exam column protections
3. `0003_functions_and_triggers.sql` — Auth onboarding triggers, immutable exam snapshot guard, baseline RPCs
4. `0004_storage_and_buckets.sql` — Private `study-media` raster image bucket + baseline Storage RLS
5. `0005_v2_custom_exams_and_coverage.sql` — 6 V2.0 tables (`exam_presets`, `exam_preset_sources`, `exam_attempt_sources`, `coverage_cycles`, `coverage_cycle_questions`, `coverage_cycle_attempts`), 35 new indexes, owner/friendship/folder-cycle/coverage triggers, column-level `profiles.email` revocation, statement-level `question_count` triggers, `create_exam_attempt_v2()`, `save_exam_attempt_answers()`, unified set-based `submit_exam_attempt()`, `clone_study_set()`, `get_exam_eligible_pool()`, `get_practice_question_pool()`, and Full Coverage cycle RPCs
6. `0006_v2_1_supabase_cloud_hardening.sql` — Moves `pg_trgm` to `extensions`, adds 6 composite `(study_set_id, question_id)` covering FK indexes, and revokes Supabase Cloud default `anon` EXECUTE grants on 27 trigger/internal/auth-only `SECURITY DEFINER` functions
7. `0007_v2_1_fix_folders_rls_recursion.sql` — Eliminates `42P17` self-recursion on `folders` INSERT/UPDATE via `is_folder_owner()`
8. `0008_v2_1_fix_study_sets_insert_returning_rls.sql` — Eliminates `42501` MVCC snapshot block on `INSERT INTO study_sets ... RETURNING *`
9. `0009_v2_1_fix_tags_rls_recursion.sql` — Eliminates `42P17` mutual recursion between `question_tags` and `tags` via `can_read_tag()`
10. `0010_v2_1_fix_clone_study_set_window.sql` — Eliminates PG 17 `42803` window-in-aggregate inside `clone_study_set()`
11. `0011_v2_1_allow_fk_set_null_on_exam_snapshot.sql` — Allows PostgreSQL FK `ON DELETE SET NULL` on `exam_attempt_questions.{question_id, source_study_set_id}` while keeping all 14 snapshot columns immutable
12. `0012_v2_1_fix_coverage_delete_cascade.sql` — Guards `release_coverage_cycle_on_attempt_delete()` against `23503` during cascading account deletion

**Option A — Hosted Supabase Cloud:**
```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```
*(Or execute `0001` through `0012` sequentially in the Supabase SQL Editor.)*

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

## Verification Commands & Current V2.1 Release Status

> **V2.1 Final Release Verdict (`final-auditor`):** **`READY WITH DOCUMENTED MINOR LIMITATIONS`** (`BLK-001` **RESOLVED**; **32/32** Acceptance Criteria VERIFIED; **90/90** Section 26 Test Matrix PASS; **0** unresolved P0/P1/P2 defects; live-verified on Supabase Cloud PostgreSQL `17.12.0.002` with spotless `0`-user/`0`-row teardown). See [`docs/audit/FINAL_ACCEPTANCE.md`](docs/audit/FINAL_ACCEPTANCE.md).

| Command | Purpose | Fresh Verified Result (`2026-11-24`) |
| --- | --- | --- |
| `npm run typecheck` | TypeScript strict check (`tsc --noEmit`) | **PASS** (0 errors) |
| `npm run lint` | ESLint 9 flat config (`eslint .`) | **PASS** (0 errors, 0 warnings) |
| `npm run test` | Vitest unit, security, Section 26 acceptance + **live PG 17.12 RPC & 2-account RLS/HTTP suites** | **PASS** (**24/24 files, 187/187 tests** in `29.70s` incl. `live-db-rpcs` **8/8 LIVE** & `live-rls-security` **11/11 LIVE**) |
| `npm run build` | Next.js 16 Turbopack production build (`next build`) | **PASS** (**52/52 static pages**, 92 App Router routes + Proxy, `0` real secret or server-parser leaks in `.next/static`) |
| `npm audit --omit=dev` | Production dependency vulnerability audit | **0 Critical, 0 High** (2 Moderate transitive `exceljs -> uuid@8.3.2` documented; do NOT run `--force`) |
| `npx playwright test --workers=4` | Full Playwright production E2E (`studyhub.spec.ts` + live 2-account `authenticated-journey.spec.ts`) | **PASS (LIVE):** **16/16 passed** (`13/13` public/CSP-HSTS/404/6-viewport + `3/3` live-Supabase auth scenarios, `0` skipped, `0` failed) |

### Running Full Live 2-Account Playwright E2E Tests
With `.env.local` pointing to a migrated (`0001`–`0012`) Supabase instance and two test accounts (or ephemeral admin-created accounts):
```powershell
npm run build
# On 16GB multi-core hosts, pass --workers=4 to avoid spawning 13+ simultaneous Chromium instances:
$env:E2E_SUPABASE_READY = "1"
$env:E2E_USER_A_EMAIL = "student-a@example.com"
$env:E2E_USER_A_PASSWORD = "StrongPassword123!"
$env:E2E_USER_B_EMAIL = "student-b@example.com"
$env:E2E_USER_B_PASSWORD = "StrongPassword123!"
$env:PLAYWRIGHT_EXPECT_PROD = "1"
npx playwright test --workers=4
```

---

## Vercel Deployment

1. Push this repository to GitHub/GitLab/Bitbucket and import it into **Vercel** (`Next.js` preset, Node.js `20.x` or `22.x`).
2. Add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (or legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY`), `NEXT_PUBLIC_APP_URL`, and `SUPABASE_SECRET_KEY` (server-only; or legacy `SUPABASE_SERVICE_ROLE_KEY`) in Vercel Environment Variables.
3. Run `npx supabase db push` (applying `0001`–`0012`) against your production Supabase project and register your production domain under Supabase Auth **Site URL** and **Redirect URLs**.
4. Verify `GET /api/health` returns `200 OK` (`supabaseConfigured: true`) and inspect response headers (`Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`).

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the complete deployment checklist and multi-instance rate-limit scaling guidance.

---

## Backup & Restore

### PostgreSQL Database Backup (`pg_dump` / `pg_restore`)
```bash
# Export public schema & data
pg_dump "$DATABASE_URL" --format=custom --schema=public --no-owner --no-privileges \
  --file="studyhub_backup_$(date +%Y%m%d_%H%M%S).dump"

# Restore to a target PostgreSQL database
pg_restore --dbname="$TARGET_DATABASE_URL" --clean --if-exists --no-owner --no-privileges \
  studyhub_backup_YYYYMMDD_HHMMSS.dump
```

### Application-Level Lossless Backup & Restore (JSON Export + Restore UI)
- Export any study set via `/sets/[id]` -> **Export** (`GET /api/sets/[id]/export?format=json|csv|xlsx`) or export full personal data from `/settings` (`GET /api/account/data`).
- Restore a full personal JSON backup directly from `/settings` (`POST /api/account/restore`, live-verified round-trip) or re-import individual study sets via `/import` / `/sets/[id]/import`.

---

## Documentation & Audit Index

### V2.0 / V2.1 Independent Audit & Live Acceptance Suite (`docs/audit/`)
- [docs/audit/FINAL_ACCEPTANCE.md](docs/audit/FINAL_ACCEPTANCE.md) — **Binding V2.1 Release Verdict (`READY WITH DOCUMENTED MINOR LIMITATIONS`) & 32/32 Acceptance Criteria**
- [docs/audit/ISSUE_TRACKER.md](docs/audit/ISSUE_TRACKER.md) — Complete Wave 1 (56 issues / 44 tickets) + Wave 3 (31 reopens) + V2.1 Live (9 findings) + `BLK-001` (`RESOLVED`) audit trail
- [docs/audit/TEST_MATRIX.md](docs/audit/TEST_MATRIX.md) — Section 26 90/90 PASS Acceptance Test Matrix (`71 LIVE` + `19 Deterministic Unit`)
- [docs/audit/REGRESSION_REPORT.md](docs/audit/REGRESSION_REPORT.md) — Wave 3 & V2.1 Live functional regression report (`16/16` Playwright E2E)
- [docs/audit/USER_EXPERIENCE_REPORT.md](docs/audit/USER_EXPERIENCE_REPORT.md) — Live Real-Student UX audit (8/8 scenarios + Desktop/Mobile screenshots)
- [docs/audit/UIUX_AUDIT.md](docs/audit/UIUX_AUDIT.md) — UI/UX, WCAG 2.2 AA contrast (31/31) & V2.0 design specification
- [docs/audit/DB_BACKEND_AUDIT.md](docs/audit/DB_BACKEND_AUDIT.md) — DB, RLS, RPC & V2.1 Live PG 17.12 audit (`0001`–`0012`, `8/8` live RPCs)
- [docs/audit/SECURITY_AUDIT.md](docs/audit/SECURITY_AUDIT.md) — Independent adversarial security, dependency & live 2-account RLS/Storage/HTTP audit (`11/11` live)
- [docs/audit/PERFORMANCE_REPORT.md](docs/audit/PERFORMANCE_REPORT.md) — Real-file aviation import (4/4 live), 500Q/250Q live Cloud DB & 10k-Q benchmarks

### Core Engineering Specifications
- [AGENTS.md](AGENTS.md) — Engineering contract & security rules
- [docs/PRD.md](docs/PRD.md) — Product requirements & personas
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — Full-stack architecture & scale strategy
- [docs/DATABASE.md](docs/DATABASE.md) — Baseline 20-table schema & RLS matrix (extended by Migrations `0005`–`0012`)
- [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) — Light/Dark tokens, typography, Motion budgets, WCAG 2.2 AA
- [docs/IMPORT_FORMATS.md](docs/IMPORT_FORMATS.md) — Deterministic parser rules & import wizard
- [docs/SECURITY.md](docs/SECURITY.md) — Threat model, exam anti-leak, upload guards, and rate limits
- [docs/TESTING.md](docs/TESTING.md) — Test matrix, stress benchmarks, and responsive checklist
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — Local dev, Vercel/Supabase deployment, and backup/restore runbook
- [docs/SKILLS.md](docs/SKILLS.md) — Audited engineering skills, checklists & V2.0/V2.1 actual usage evidence
- [docs/PROGRESS.md](docs/PROGRESS.md) — V1.0, V2.0 & V2.1 milestone & verification tracker
