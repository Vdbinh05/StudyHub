# StudyHub V1.0

**Personal Study, Flashcard & Exam Preparation Web Application** combining the clean active-recall modes of **Quizlet** with the multi-format question-bank importing and timed mock exam workflow of **EduQuiz**.

> **100% Deterministic · Zero AI · Zero Payments · Privacy-First · Built for 10,000+ Questions**

---

## Product Principles

- **Zero AI in Runtime:** No LLMs, no OpenAI/Gemini/Anthropic SDKs, no chatbots, no vector databases, and no probabilistic guessing. File parsing, answer-key detection, option grading, shuffling, spaced repetition (SM-2), and analytics are 100% deterministic.
- **Zero Payments or Artificial Limits:** No Stripe/billing SDKs, no paywalls, no ads, and no artificial caps on study sets, file imports, or mock exam attempts.
- **Bilingual Calm Academic UI:** Vietnamese (`vi`) default with instant English (`en`) switch, Light & Dark modes, keyboard-first desktop focus modes, and mobile one-hand navigation. User study content is never auto-translated.
- **Defense-in-Depth Security:** Strict Row-Level Security (RLS) on all 20 PostgreSQL tables, server-verified sessions via `src/proxy.ts`, zero pre-submit exam answer leakage, immutable exam snapshots, archive-bomb upload guards, and strict CSP/security headers.

---

## Core Features

### 1. Deterministic Multi-Format Import & Export (6-Step Wizard)
- **EduQuiz TXT:** `*B.` asterisk markers (single & multi-select), chapter headings (`Chương 1`, `Chapter 1`), multiline stems/options, and explanations.
- **Word Answer-Key (`.txt` / `.docx`):** Inline keys (`ANSWER: A`, `Đáp án: D`, multi-select `A, C`) and End-of-Document Answer Keys with deterministic **multi-chapter numbering reset** handling.
- **DOCX OOXML Formatting (`.docx`):** Inspects raw OpenXML (`jszip` + `fast-xml-parser`) for **Bold** (with baseline-bold subtraction), **Highlight / Shading**, **Font Color** (e.g., red/blue/green), **Underline**, tables, embedded raster images, and explicit conflict detection (`ANSWER_SIGNAL_CONFLICT`).
- **Wayground & Generic Excel (`.xlsx`):** Parsed via `exceljs` with auto-detection for Wayground/Quizizz templates plus visual interactive Column Mapping.
- **Quizlet TSV / Custom Delimiters, CSV (UTF-8 + BOM via `papaparse`), & Lossless JSON:** Round-trip export (`JSON`, `CSV`, `XLSX`) and re-import.
- **Scale & Safety:** Virtualized preview (`@tanstack/react-virtual`) & chunked commits (500 rows/batch) benchmarked on **600-question** and **10,000-question** files (314 ms parse benchmark), protected by magic-byte checks, 15 MB upload cap, 50 MB uncompressed / 500-entry / 100:1 ZIP-bomb limits, and zero-XXE parsing.

### 2. Six Study & Exam Modes + Spaced Repetition
- **Flashcards (`/sets/[id]/flashcards`):** 3D card flip (`motion/react`, `prefers-reduced-motion` compliant), keyboard shortcuts (`Space`, `1–4`, arrows, `S` star), SM-2 rating.
- **Learn (`/sets/[id]/learn`):** Deterministic adaptive mastery rounds re-queuing missed questions until mastered.
- **Practice (`/sets/[id]/practice`):** EduQuiz-style practice with chapter/tag/starred filters, instant feedback, and explanations.
- **Write (`/sets/[id]/write`):** Typed recall with deterministic text normalization (`exact`, `case_insensitive`, `ignore_diacritics`, `numeric`).
- **Match (`/sets/[id]/match`):** Timed interactive pair-matching board.
- **Mock Exam (`/sets/[id]/test` & `/sets/[id]/results/[attemptId]`):** Server-enforced `expires_at` timer, immutable `exam_attempt_questions` snapshots, autosave, virtualized navigator grid, zero pre-submit answer exposure, and atomic idempotent server scoring by **stable option UUID** (safe under option shuffling).
- **Spaced Repetition (`/review`), Starred (`/starred`), History (`/history`), & Analytics (`/statistics`):** Global SM-2 due queue, mistake drill, streak & mastery charts (Recharts).

### 3. Organization & Friend Sharing
- Hierarchical **Folders** (`/library`, `/folders/[id]`), **Virtualized 10k Question Editor** (`/sets/[id]/edit`), **Friendships** (`/friends`), collaborator roles (`owner`, `editor`, `viewer`), revocable/expiring **Share Links** (`/share/[token]`), and one-click **Duplicate / Clone**.

---

## Tech Stack

| Layer | Technologies |
| --- | --- |
| **Framework & Language** | Next.js `16.4.6` (App Router + `src/proxy.ts`), React `19.3.1`, TypeScript `5.9` (`strict: true`) |
| **Styling & Motion** | Tailwind CSS v4, Radix UI + shadcn/ui primitives (24 components), Lucide React, `motion/react`, `next-themes`, `sonner` |
| **State, Forms & Scale** | TanStack Query v5, TanStack Virtual v3, React Hook Form + Zod v3, Recharts v3 |
| **Backend & Database** | Supabase (`@supabase/supabase-js`, `@supabase/ssr`), PostgreSQL 15+ (20 tables, strict RLS, RPCs, Storage) |
| **Deterministic Parsers** | `jszip`, `fast-xml-parser`, `mammoth`, `exceljs`, `papaparse` |
| **Testing & Quality** | Vitest `5.1`, React Testing Library, Playwright `1.65`, ESLint `9` flat config |

---

## Prerequisites & Local Development Setup

- **Node.js** `20.11+` (tested on `v24.15.0`) and **npm** `10+`
- **Supabase Backend:** either a hosted Supabase project OR Docker Desktop for local `npx supabase start`

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
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Public `anon` key (protected by RLS on all 20 tables) |
| `NEXT_PUBLIC_APP_URL` | Yes | `http://localhost:3000` locally, or production URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional (server-only) | Never expose to client; used exclusively inside `src/lib/supabase/admin.ts` |
| `NEXT_PUBLIC_ENABLE_GOOGLE_OAUTH` | Optional (`false`) | Set `true` after enabling Google provider in Supabase Auth |

> If Supabase env vars are not configured yet, the app still builds and runs public routes cleanly, shows a transparent setup notice on auth screens, and returns `503 SUPABASE_NOT_CONFIGURED` on database APIs (never fake auth or mock data).

### 3. Apply Supabase Database Migrations (`0001`–`0004`)

Migrations live in `supabase/migrations/` and must be applied in order:
1. `0001_initial_schema.sql` — 20 UUID tables, constraints, and indexes
2. `0002_rls_policies.sql` — Strict RLS on all 20 tables + pre-submit exam column protections
3. `0003_functions_and_triggers.sql` — Auth onboarding triggers, `question_count` sync, immutable exam snapshot guard, atomic `submit_exam_attempt()` RPC
4. `0004_storage_and_buckets.sql` — Private `study-media` raster image bucket + Storage RLS

**Option A — Local Supabase CLI (requires Docker Desktop running):**
```bash
npx supabase start
npx supabase db reset
```

**Option B — Hosted Supabase Cloud:**
```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```
*(Or execute `0001_initial_schema.sql` through `0004_storage_and_buckets.sql` sequentially in the Supabase SQL Editor.)*

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

## Verification Commands & Current Quality Status

| Command | Purpose | Verified Result |
| --- | --- | --- |
| `npm run typecheck` | TypeScript strict check (`tsc --noEmit`) | **PASS** (0 errors) |
| `npm run lint` | ESLint 9 flat config (`eslint .`) | **PASS** (0 errors, 0 warnings) |
| `npm run test` | Vitest unit, security, migration & integration tests | **PASS** (16 files, **82/82 tests**, incl. 600-Q & 10,000-Q stress tests in 314 ms) |
| `npm run build` | Production build (`next build`) | **PASS** (69 App Router routes + Proxy, 39 static pages) |
| `npm run test:e2e` | Playwright E2E, 6-viewport responsive & security headers | **PASS** (**11/11 passed**, 1 live-DB test skipped until Supabase credentials are set) |

### Running Live 2-Account Supabase E2E Tests
Once `.env.local` points to a migrated Supabase instance (Docker or Cloud) with two test accounts:
```bash
# PowerShell
$env:E2E_SUPABASE_READY="1"
$env:E2E_USER_A_EMAIL="student-a@example.com"
$env:E2E_USER_A_PASSWORD="StrongPassword123!"
$env:E2E_USER_B_EMAIL="student-b@example.com"
$env:E2E_USER_B_PASSWORD="StrongPassword123!"
npm run test:e2e
```

---

## Vercel Deployment

1. Push this repository to GitHub/GitLab/Bitbucket and import it into **Vercel** (`Next.js` preset, Node.js `20.x` or `22.x`).
2. Add `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_APP_URL`, and `SUPABASE_SERVICE_ROLE_KEY` (server-only) in Vercel Environment Variables.
3. Run `npx supabase db push` against your production Supabase project and register your production domain under Supabase Auth **Site URL** and **Redirect URLs**.
4. Verify `GET /api/health` returns `200 OK` and inspect response headers (`Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`).

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

### Application-Level Lossless Backup (JSON Export)
- Export any study set losslessly via `/sets/[id]` -> **Export -> JSON** (`GET /api/sets/[id]/export?format=json`) or export full personal data from `/settings` (`GET /api/account/data`).
- Re-import StudyHub JSON files anytime via `/sets/[id]/import` with full preservation of questions, options, answers, explanations, chapters, hints, difficulty, and tags.

---

## Documentation Index

- [AGENTS.md](AGENTS.md) — Engineering contract & security rules
- [docs/PRD.md](docs/PRD.md) — Product requirements, personas, and all 28 routes
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — Full-stack architecture, API contracts, and 10k-scale strategy
- [docs/DATABASE.md](docs/DATABASE.md) — 20-table PostgreSQL schema, indexes, and RLS policy matrix
- [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md) — Light/Dark tokens, typography, Motion budgets, WCAG 2.2 AA
- [docs/IMPORT_FORMATS.md](docs/IMPORT_FORMATS.md) — Deterministic parser rules & 6-step import wizard
- [docs/SECURITY.md](docs/SECURITY.md) — Threat model, exam anti-leak, upload guards, and rate limits
- [docs/TESTING.md](docs/TESTING.md) — Test matrix, stress benchmarks, and responsive checklist
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — Local dev, Vercel/Supabase deployment, and backup/restore runbook
- [docs/VERIFICATION_REPORT.md](docs/VERIFICATION_REPORT.md) — Final QA, security, performance, and Playwright audit report
- [docs/SKILLS.md](docs/SKILLS.md) — Audited engineering skills and checklists
- [docs/PROGRESS.md](docs/PROGRESS.md) — Final milestone & verification tracker
