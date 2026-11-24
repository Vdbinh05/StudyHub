# StudyHub V2.0

**Personal Study, Flashcard & Universal Mock Exam Preparation Web Application** combining the clean active-recall modes of **Quizlet** with the multi-format question-bank importing, multi-subject custom exam builder, and full-coverage testing workflows of **EduQuiz**.

> **100% Deterministic · Zero AI · Zero Payments · Privacy-First · Built for 10,000+ Questions & 1,000-Question Multi-Subject Exams**

---

## Product Principles

- **Zero AI in Runtime:** No LLMs, no OpenAI/Gemini/Anthropic SDKs, no chatbots, no vector databases, and no probabilistic guessing. File parsing, answer-key detection, multi-subject allocation (Strategies A–E), selection policies (1–8), Full Coverage cycles, option grading, shuffling, spaced repetition (SM-2), and analytics are 100% deterministic.
- **Zero Payments or Artificial Limits:** No Stripe/billing SDKs, no paywalls, no ads, and no artificial caps on study sets, file imports, exam presets, coverage cycles, or mock exam attempts.
- **Bilingual Calm Academic UI (WCAG 2.2 AA):** Vietnamese (`vi`) default with instant English (`en`) switch (persisting localized `<title>` and skip links across reloads), Light & Dark modes (31/31 AA contrast pairs verified), wired user preferences (`PreferencesProvider` + `<MotionConfig>`), keyboard-first desktop focus modes, and mobile one-hand 5-tab navigation. User study content is never auto-translated.
- **Defense-in-Depth Security:** Strict Row-Level Security (RLS) on all **26 PostgreSQL tables** across Migrations `0001`–`0005`, server-verified sessions via `src/proxy.ts`, server-resolved exam snapshots (`create_exam_attempt_v2`), zero pre-submit exam answer leakage (`in_progress` & `discarded`), private `study-media` Storage with magic-byte upload proxy & durable signed URLs, streaming ZIP-bomb & XLSX XXE guards, and production HSTS/CSP headers.

---

## Core Features

### 1. Universal Custom Exam Engine (`/exams/new` & `/exams`) — *New in V2.0*
- **Multi-Subject & Folder Picker with Strict Deduplication:** Combine any mix of Study Sets and recursive Folders without double-counting nested sets (`POST /api/exams/eligible`, `POST /api/exams/preview`).
- **Arbitrary Question Counts (`1..1,000+`):** Supports odd counts, long 250/500/1,000-question mock exams, and strict validation (never silently clamps out-of-bounds requests).
- **5 Deterministic Multi-Subject Allocation Strategies (A–E):** Global Random (`global_random`), Equal with shortage redistribution (`equal`), Proportional Hamilton largest-remainder (`proportional`), Custom exact counts per subject (`custom`), and Weighted percentages (`weighted`).
- **8 Deterministic Selection Policies:** `random`, `unseen_first`, `mistakes_first`, `weak_topics_first`, `due_for_review` (SM-2), strict non-padding `starred_only`, strict non-padding `incorrect_only`, and honest-disclosure `anti_repeat`.
- **Full Coverage / No-Repeat Cycles (`coverage_cycles`):** Split any 100–10,000+ question bank into sequential non-overlapping exams (`500 -> 250 + 250`, `500 -> 120×4 + 20`) with explicit tri-state tracking (`assigned` vs `answered` vs `completed`), safe discard returning unanswered questions to the pool without fake completion, and 1-click cycle restart.
- **Private Config-Only Exam Presets (`/api/exam-presets`):** Save, favorite, edit, duplicate, and 1-click relaunch reusable exam blueprints (never freezes question IDs; re-verifies source access at launch).
- **250–1,000Q Live Exam Runner & Mixed-Subject Results (`/exams/[attemptId]` & `/results`):** Server wall-clock `expires_at` (or unlimited time), memoized `<ExamTimer />`, chunked `<=150` offline autosave with monotonic `client_seq` and live `answered_count`, zero-drift 50px virtualized navigator with status/subject filters & `M`/`F` hotkeys, virtualized 1,000Q review, true weighted overall accuracy, and Per-Subject / Per-Chapter / Per-Tag breakdowns.

### 2. Multi-Subject Practice & Five Active-Recall Modes + SM-2
- **Multi-Subject Custom Practice (`/practice`, `POST /api/practice/questions`):** Untimed instant-feedback drilling across multiple sets/folders with policy & chapter/tag/difficulty filters and per-question SM-2 attribution.
- **Flashcards (`/sets/[id]/flashcards`):** Accessible CSS Grid 3D flip (`motion/react` + reduced-motion crossfade), stable seeded shuffle, full 4-level SM-2 buttons & hotkeys (`1=Again, 2=Hard, 3=Good, 4=Easy`).
- **Learn (`/sets/[id]/learn`):** Single-session deterministic adaptive mastery rounds re-queuing missed questions.
- **Practice (`/sets/[id]/practice`):** EduQuiz-style practice with virtualized navigator, instant feedback, and explanations.
- **Write (`/sets/[id]/write`):** Typed recall with unified 3-way deterministic normalization (`exact`, `case_insensitive`, `ignore_diacritics`, `numeric` incl. `0`/`10`/`100`), Vietnamese Telex/VNI IME-safe Enter handling, and single-commit self-assessment override.
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
| **Backend & Database** | Supabase (`@supabase/supabase-js`, `@supabase/ssr`), PostgreSQL 15+ (**26 tables**, strict RLS, RPCs, private Storage, 53 API routes) |
| **Deterministic Parsers** | `jszip`, `fast-xml-parser`, `mammoth`, `exceljs`, `papaparse` (100% server-only, 0 B client leakage) |
| **Testing & Quality** | Vitest `5.1` (167 tests), React Testing Library, Playwright `1.58` (13 public + 3 live-DB E2E), ESLint `9` flat config |

---

## Prerequisites & Local Development Setup

- **Node.js** `20.11+` (verified on `v24.15.0`) and **npm** `10+`
- **Live Supabase Backend:** either **Docker Desktop** (for local `npx supabase start`) OR a **hosted Supabase project**

### 1. Install Dependencies
```bash
git clone <your-repo-url>
cd StudyHub
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env.local` and fill in your credentials (never commit `.env.local`):
```bash
cp .env.example .env.local
```

| Variable | Required | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL (`https://<ref>.supabase.co` or `http://127.0.0.1:54321`) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Public `anon` key (protected by RLS on all 26 tables) |
| `NEXT_PUBLIC_APP_URL` | Yes | `http://localhost:3000` locally, or production URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional (server-only) | Never expose to client; isolated inside `src/lib/supabase/admin.ts` (`import "server-only"`) |
| `NEXT_PUBLIC_ENABLE_GOOGLE_OAUTH` | Optional (`false`) | Set `true` after enabling Google provider in Supabase Auth |

> If Supabase env vars are not configured yet, public routes still build and run cleanly, protected routes redirect cleanly (`307 -> /login?setup=1`) with student-friendly maintenance copy (zero `503` retry storms), and database APIs fail closed with `503 SUPABASE_NOT_CONFIGURED` (never fake auth or mock data).

### 3. Apply Supabase Database Migrations (`0001`–`0005`)

Migrations live in `supabase/migrations/` and must be applied strictly in order (`0001`–`0004` are immutable baseline migrations; `0005` adds V2.0 tables, indexes, RPCs, and security hardening):
1. `0001_initial_schema.sql` — 20 baseline UUID tables, constraints, and indexes
2. `0002_rls_policies.sql` — Baseline RLS on all 20 tables + pre-submit exam column protections
3. `0003_functions_and_triggers.sql` — Auth onboarding triggers, immutable exam snapshot guard, baseline RPCs
4. `0004_storage_and_buckets.sql` — Private `study-media` raster image bucket + baseline Storage RLS
5. `0005_v2_custom_exams_and_coverage.sql` — **6 new V2.0 tables** (`exam_presets`, `exam_preset_sources`, `exam_attempt_sources`, `coverage_cycles`, `coverage_cycle_questions`, `coverage_cycle_attempts`), **35 new indexes** (incl. `pg_trgm` & partial FK indexes), owner/friendship/folder-cycle/coverage triggers, column-level `profiles.email` revocation, statement-level `question_count` triggers, `create_exam_attempt_v2()`, `save_exam_attempt_answers()`, unified set-based `submit_exam_attempt()`, `clone_study_set()`, `get_exam_eligible_pool()`, `get_practice_question_pool()`, and Full Coverage cycle RPCs

**Option A — Local Supabase CLI (requires Docker Desktop running):**
```bash
npx supabase start
npx supabase db reset
npx supabase db advisors
```

**Option B — Hosted Supabase Cloud:**
```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```
*(Or execute `0001` through `0005` sequentially in the Supabase SQL Editor.)*

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

## Verification Commands & Current V2.0 Release Status

> **Current V2.0 Status:** **Code & Offline Gate: `PASS`** · **Live Runtime Release Gate: `BLOCKED` (`BLK-001`)** pending live Supabase / Docker connection. See [`docs/audit/FINAL_ACCEPTANCE.md`](docs/audit/FINAL_ACCEPTANCE.md) for the complete 32-item acceptance table and 3-step unblock runbook.

| Command | Purpose | Fresh Verified Result (`final-auditor`, 2026-11-24) |
| --- | --- | --- |
| `npm run typecheck` | TypeScript strict check (`tsc --noEmit`) | **PASS** (0 errors) |
| `npm run lint` | ESLint 9 flat config (`eslint .`) | **PASS** (0 errors, 0 warnings) |
| `npm run test` | Vitest unit, import, learning, security & Section 26 acceptance suite | **PASS** (**22/22 files, 167/167 tests** in `9.75s`) |
| `npm run build` | Next.js 16 Turbopack production build (`next build`) | **PASS** (**52/52 static pages**, 92 App Router routes + Proxy, `0` client secret/parser leaks) |
| `npm audit --omit=dev` | Production dependency vulnerability audit | **0 Critical, 0 High** (2 Moderate transitive `exceljs -> uuid@8.3.2` documented; do NOT run `--force`) |
| `npm run test:e2e` | Playwright production E2E, CSP/HSTS, i18n, 404 & 6-viewport audit | **PASS (Public):** **13/13 passed**, **3 skipped** (`authenticated-journey.spec.ts` gated by `E2E_SUPABASE_READY=1`) |

### Running Live 2-Account Supabase E2E Tests (Clears `BLK-001`)
Once `.env.local` points to a migrated (`0001`–`0005`) Supabase instance (Docker or Cloud) with two test accounts:
```powershell
npm run build
$env:E2E_SUPABASE_READY = "1"
$env:E2E_USER_A_EMAIL = "student-a@example.com"
$env:E2E_USER_A_PASSWORD = "StrongPassword123!"
$env:E2E_USER_B_EMAIL = "student-b@example.com"
$env:E2E_USER_B_PASSWORD = "StrongPassword123!"
$env:PLAYWRIGHT_EXPECT_PROD = "1"
npm run test:e2e
```

---

## Vercel Deployment

1. Push this repository to GitHub/GitLab/Bitbucket and import it into **Vercel** (`Next.js` preset, Node.js `20.x` or `22.x`).
2. Add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_APP_URL`, and `SUPABASE_SERVICE_ROLE_KEY` (server-only) in Vercel Environment Variables.
3. Run `npx supabase db push` (applying `0001`–`0005`) against your production Supabase project and register your production domain under Supabase Auth **Site URL** and **Redirect URLs**.
4. Verify `GET /api/health` returns `200 OK` and inspect response headers (`Content-Security-Policy`, `Strict-Transport-Security`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`).

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for the complete deployment checklist.

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
- Restore a full personal JSON backup directly from `/settings` (`POST /api/account/restore`) or re-import individual study sets via `/import` / `/sets/[id]/import`.

---

## Documentation & Audit Index

### V2.0 Independent Audit & Acceptance Suite (`docs/audit/`)
- [docs/audit/FINAL_ACCEPTANCE.md](docs/audit/FINAL_ACCEPTANCE.md) — **Binding V2.0 Release Verdict, 32-Item Acceptance Criteria & Unblock Runbook**
- [docs/audit/ISSUE_TRACKER.md](docs/audit/ISSUE_TRACKER.md) — Master Wave 1 (56 issues / 44 tickets) + Wave 3 (31 reopens) + `BLK-001` audit trail
- [docs/audit/TEST_MATRIX.md](docs/audit/TEST_MATRIX.md) — Section 26 90-case Acceptance Test Matrix
- [docs/audit/REGRESSION_REPORT.md](docs/audit/REGRESSION_REPORT.md) — Wave 3 functional regression report
- [docs/audit/USER_EXPERIENCE_REPORT.md](docs/audit/USER_EXPERIENCE_REPORT.md) — Real-user live browser audit & BEFORE/AFTER screenshots
- [docs/audit/UIUX_AUDIT.md](docs/audit/UIUX_AUDIT.md) — UI/UX, WCAG 2.2 AA contrast (31/31) & V2.0 design specification
- [docs/audit/DB_BACKEND_AUDIT.md](docs/audit/DB_BACKEND_AUDIT.md) — DB, RLS, RPC & Migration `0005` specification and re-audit
- [docs/audit/SECURITY_AUDIT.md](docs/audit/SECURITY_AUDIT.md) — Independent adversarial security & dependency audit
- [docs/audit/PERFORMANCE_REPORT.md](docs/audit/PERFORMANCE_REPORT.md) — Real-file aviation import, 10k-Q benchmarks & bundle analysis

### Core Engineering Specifications
- [AGENTS.md](AGENTS.md) — Engineering contract & security rules
- [docs/PRD.md](docs/PRD.md) — Product requirements & personas
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — Full-stack architecture & scale strategy
- [docs/DATABASE.md](docs/DATABASE.md) — Baseline 20-table schema & RLS matrix (extended by Migration `0005`)
- [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) — Light/Dark tokens, typography, Motion budgets, WCAG 2.2 AA
- [docs/IMPORT_FORMATS.md](docs/IMPORT_FORMATS.md) — Deterministic parser rules & import wizard
- [docs/SECURITY.md](docs/SECURITY.md) — Threat model, exam anti-leak, upload guards, and rate limits
- [docs/TESTING.md](docs/TESTING.md) — Test matrix, stress benchmarks, and responsive checklist
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — Local dev, Vercel/Supabase deployment, and backup/restore runbook
- [docs/SKILLS.md](docs/SKILLS.md) — Audited engineering skills, checklists & V2.0 actual usage evidence
- [docs/PROGRESS.md](docs/PROGRESS.md) — V1.0 & V2.0 milestone & verification tracker
