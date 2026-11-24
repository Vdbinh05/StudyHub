# StudyHub V1.0 — Phased Implementation Plan

> Structured into 4 deterministic execution waves designed for parallel Swarm execution with zero file-ownership collisions.

---

## Wave 1: Research, Specifications & Platform Foundation (Parallel)
**Goal:** Establish authoritative specifications, skills audit, project scaffold, design tokens, accessible UI primitives, i18n, and shared TypeScript contracts.

- **Phase 1A (`skills-research`):** Audit installed local skills & Docker/Supabase environment; research official engineering guidelines; author `docs/SKILLS.md`.
- **Phase 1B (`architect-docs`):** Author `AGENTS.md` and the complete specification suite (`PRD.md`, `ARCHITECTURE.md`, `DATABASE.md`, `DESIGN_SYSTEM.md`, `IMPORT_FORMATS.md`, `SECURITY.md`, `TESTING.md`, `DEPLOYMENT.md`, `IMPLEMENTATION_PLAN.md`, `SWARM_TASKS.md`, `PROGRESS.md`).
- **Phase 1C (`foundation`):** Initialize Git, install dependencies (strictly zero AI/payment packages), configure TypeScript strict / Next.js / Tailwind / Vitest / Playwright, implement `globals.css` tokens, `src/components/ui/*`, `src/lib/i18n/*` (`vi` default + `en`), `src/app/layout.tsx` & `providers.tsx`, and shared `src/types/{domain,database,import}.ts`.
- **Wave 1 Gate:** `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build` all pass with exit code `0`.

---

## Wave 2: Backend Data Layer, Deterministic Engines & Core Workspace UI (Parallel)
**Goal:** Build the real PostgreSQL schema + RLS + RPCs, deterministic import/export parsers, deterministic learning/exam engines, and full authenticated app shell & management pages.

- **Phase 2A (`backend-supabase`):**
  - SQL migrations `00001`–`00005` (all 20 tables, indexes, triggers, RLS policies, `submit_exam_attempt()` RPC, share-link RPC, `study-media` storage bucket).
  - `src/lib/supabase/{client,server,admin,middleware}.ts`, `src/middleware.ts`, `/auth/callback`.
  - `src/lib/validation/*` (Zod schemas) & `src/lib/security/*` (upload magic-byte & zip-bomb guard, rate limiter, URL sanitizer).
  - Real Route Handlers for folders, sets, questions, bulk ops, clone, members, share-links, sessions, exams (pre-submit sanitized + idempotent submit), progress/star, review queue, statistics, friends, profile, health.
- **Phase 2B (`import-engine`):**
  - Deterministic parsers in `src/lib/import/*` (`eduquiz_txt`, `word_answer_key` with multi-chapter reset, `docx_ooxml`, `xlsx_wayground`, `xlsx_generic`, `quizlet_tsv`, `csv`, `json`, `txt_generic`) + validator + conflict detector.
  - Deterministic exporters (`json`, `csv` with UTF-8 BOM, `xlsx`).
  - `/api/import/parse`, `/api/import/commit` (chunked 500/batch), `/api/sets/[id]/export`.
  - 6-Step Import Wizard UI (`/sets/[id]/import` + `src/components/import/*` with `@tanstack/react-virtual`).
  - Unit tests & real fixtures including 600 & 10,000 stress tests.
- **Phase 2C (`learning-exam`):**
  - Pure deterministic engines in `src/lib/learning/*` (`sm2.ts`, `grading.ts`, `shuffle.ts`, `exam-snapshot.ts`).
  - Focus-mode UIs for all 6 modes: `/flashcards`, `/learn`, `/practice`, `/write`, `/match`, `/test`, `/results/[attemptId]`, and `/review`.
  - Keyboard shortcuts, `motion/react` animations respecting `prefers-reduced-motion`, virtualized exam navigator, server-synced timer.
  - Unit tests for SM-2, UUID option grading under shuffle, Vietnamese diacritic text matching, and pre-submit exam sanitization.
- **Phase 2D (`frontend-ui`):**
  - Public Landing (`/`), Auth pages (`/login`, `/register`, `/forgot-password`, `/reset-password`), Share Link page (`/share/[token]`).
  - AppShell (`Sidebar`, `MobileBottomNav`, `TopBar`, `vi`/`en` toggle, Light/Dark toggle).
  - Workspace pages: `/dashboard`, `/library`, `/folders/[id]`, `/sets/new`, `/sets/[id]`, `/sets/[id]/edit` (virtualized 10k editor), `/starred`, `/history`, `/statistics` (Recharts), `/shared`, `/friends`, `/profile`, `/settings`.

---

## Wave 3: Integration, Hardening & Full Verification
**Goal:** Wire any cross-module edges cleanly and execute full automated quality, security, responsive, and E2E audits.

- **Phase 3 (`qa-security`):**
  - Run static checks (`typecheck`, `lint`, `build`) and full Vitest unit + integration + stress suite.
  - Execute security audit: zero AI/payment packages, zero `SUPABASE_SERVICE_ROLE_KEY` leaks, zero pre-submit exam answer leaks, upload bomb & XSS rejection tests, RLS policy completeness audit across all 20 tables.
  - Execute Playwright E2E journey & 6-viewport responsive checks (`360`, `390`, `768`, `1024`, `1440`, `1920`) plus accessibility smoke audit.
  - File bug reports directly to owning workers; re-verify after fixes.

---

## Wave 4: Final Polish & Release Readiness
- Finalize `README.md` with accurate setup, architecture summary, screenshots/features, and test verification proof.
- Update `docs/PROGRESS.md` to 100% verified completion.
- Confirm clean `git status` and green `typecheck`, `lint`, `test`, and `build`.
