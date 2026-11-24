# StudyHub V1.0 — Skills, Environment & Engineering Standards

> **Owner:** `skills-research`  
> **Scope:** Authoritative inventory of installed agent plugins/skills, local environment capabilities (Docker / Supabase / Node), and actionable engineering checklists distilled directly from official primary `SKILL.md` and reference documentation for all StudyHub V1.0 agents.

---

## 1. Safety & Audit Attestation

- **Read-Only Local Inspection:** All checks under `C:\Users\Admin\.gemini\` and `C:\Users\Admin\.agents\` were strictly read-only. Zero user global configuration files were modified or overwritten.
- **No Untrusted Script Execution:** No remote installer scripts (`curl | sh`, unverified CLI scripts, or auto-installing `npx` commands) were executed during this research phase.
- **Primary-Source Verification:** Every skill marked **Installed & Activated**, **Installed (User-Level)**, or **Reference Guidelines Loaded** below had its actual official `SKILL.md` (and key bundled reference files) read directly — either from the local plugin installation path or via read-only HTTPS GET of official GitHub raw markdown files (`raw.githubusercontent.com`).

---

## 2. Local Environment & Capability Check

Verified directly on the host machine (`Windows`, workspace `d:\Code Web\StudyHub`):

| Capability | Check Performed | Observed Result | Engineering Impact & Guidance |
|---|---|---|---|
| **Node.js & npm** | `node -v`, `npm -v` | `Node v24.15.0`, `npm 11.12.1` | Fully ready for Next.js App Router, React 19, TypeScript strict, Vitest, and Playwright. |
| **Docker Engine** | `docker --version`, `docker info` | CLI installed (`Docker 29.7.2`, build `a7dcaa6`), **daemon NOT running** (`failed to connect to npipe:////./pipe/dockerDesktopLinuxEngine`). | Local `supabase start` cannot launch Postgres/Auth containers until the user starts Docker Desktop. All SQL migrations, RLS policies, seeds, and database tests must still be authored cleanly and deterministically so they run immediately once Docker Desktop is started or linked to a hosted Supabase project. |
| **Supabase CLI** | `where.exe supabase`, `npx --no-install supabase --version` | **Not installed** globally or locally cached. Registry resolves `supabase@3.3.0` via `npx`, not executed during read-only audit. | Backend/DB engineers should author version-controlled SQL under `supabase/migrations/` and `supabase/seed.sql` (following Supabase CLI conventions) and document local/cloud bootstrap steps in `docs/SETUP_AND_RUN.md`. |
| **Supabase Env Vars** | OS env scan (`SUPABASE*`, `POSTGRES*`, `DATABASE*`, `DOCKER*`) + workspace `.env*` scan | **None configured.** No `.env` or `.env.local` exists in `d:\Code Web\StudyHub` (only `.env.example`). | Never hardcode keys or fall back to fake/mock auth. Handle missing env vars with explicit, clear configuration errors / setup diagnostics, and never expose `SUPABASE_SERVICE_ROLE_KEY` in `NEXT_PUBLIC_*` variables. |
| **Installed Antigravity Plugins** | Read `C:\Users\Admin\.gemini\config\plugins\` & `config.json` | **3 official plugins installed & active:**<br>1. `modern-web-guidance-plugin` (`v1.0.1`)<br>2. `supabase` (`v0.1.17-agy.a224d9f1`, includes `supabase_mcp` config)<br>3. `superpowers` (`v7.0.2`) | Agents have direct local access to all bundled `SKILL.md` and `references/*.md` files for Modern Web Guidance, Supabase/Postgres, and Superpowers. Note: `list_plugin_accounts` reports no signed-in OAuth account yet for MCP servers; `supabase_mcp` requires user OAuth sign-in before live remote DB calls. |
| **User-Level Open Agent Skills** | Checked `C:\Users\Admin\.agents\skills\` | `find-skills` (`SKILL.md` present) | Available for discovering vetted skills via `skills.sh`. |
| **Built-in Antigravity Skills & MCP** | Checked `C:\Users\Admin\.gemini\antigravity\builtin\skills\` & `mcp\` | 15 built-in platform skills + `chrome_devtools` MCP tool definitions | Browser inspection / Lighthouse / performance tracing available when verifying the live running UI. |

---

## 3. Master Skill & Standards Inventory

| Skill / Plugin | Source Repository | Installation Status | Responsible Agent(s) | Scope of Application | Concrete Technical Decisions Improved |
|---|---|---|---|---|---|
| **Modern Web Guidance** (`modern-web-guidance`) | `GoogleChrome/modern-web-guidance` | **Installed & Activated** (`antigravity-plugins-official/plugin/modern-web-guidance-plugin` v1.0.1; local `SKILL.md` read) | `foundation-setup`, `frontend-ui`, `study-exam-engine`, `qa-security-verifier` | All HTML, CSS, DOM, forms, modals/dialogs, dark mode, accessibility, CWV (LCP/INP/CLS), and client-side JS features | Mandates Baseline Widely Available web APIs (with explicit fallbacks for non-Baseline features), semantic native primitives (`<dialog>`, `popover`, container queries, `useId()` for anchor/IDs), SSR guards for `window`/`HTMLElement`, and prevents deprecated/legacy browser patterns. |
| **Superpowers** (`brainstorming`, `writing-plans`, `test-driven-development`, `systematic-debugging`, `requesting-code-review`, `verification-before-completion`, +9 more) | `obra/superpowers` | **Installed & Activated** (`antigravity-plugins-partners/plugin/superpowers` v7.0.2; 6 core `SKILL.md` files read locally) | **All agents** (`coordinator`, `architect-docs`, `foundation-setup`, `db-backend`, `import-engine`, `study-exam-engine`, `frontend-ui`, `qa-security-verifier`) | Design planning, RED-GREEN-REFACTOR TDD, 4-phase root-cause debugging, independent code review, and evidence-backed completion gates | Eliminates "looks right / should work" claims; enforces failing-test-first TDD for parsers, SM-2/grading engines, and bug fixes; enforces 4-phase root-cause tracing (no guess-and-patch thrashing); requires fresh full test/lint/typecheck/build output before any `[done]` claim. |
| **Supabase Core** (`supabase`) | `supabase-community/supabase-plugin` / `supabase/agent-skills` | **Installed & Activated** (`antigravity-plugins-partners/plugin/supabase` v0.1.17; local `SKILL.md` read) | `db-backend`, `foundation-setup`, `qa-security-verifier` | `@supabase/ssr` Next.js App Router auth, cookies/sessions, RLS policies, Storage buckets, SQL views, `SECURITY DEFINER` safety, migrations | Prevents critical Supabase security traps: bans `user_metadata` in authz, deprecates `auth.role()` in favor of `TO authenticated`/`TO anon`, enforces `USING` + `WITH CHECK` on `UPDATE`, requires `security_invoker = true` on views, enforces Storage `INSERT`+`SELECT`+`UPDATE` for upserts, and blocks `service_role` leakage. |
| **Supabase Postgres Best Practices** (`supabase-postgres-best-practices`) | `supabase/agent-skills` (bundled in `supabase` plugin) | **Installed & Activated** (`v1.1.1`; local `SKILL.md` + 8 critical rule files read) | `db-backend`, `study-exam-engine`, `qa-security-verifier` | Schema design (20 tables), B-tree/composite/FK indexes, RLS query speed, connection pooling, batching, cursor pagination | Prevents 10–1000× query degradation: wraps `auth.uid()` in `(select auth.uid())` inside RLS policies, indexes every foreign key & RLS filter column, orders composite indexes equality-first/range-last, uses keyset/cursor pagination over `OFFSET`, eliminates N+1 queries, and mandates PgBouncer transaction pooling. |
| **Find Skills** (`find-skills`) | `vercel-labs/skills` | **Installed (User-Level)** (`C:\Users\Admin\.agents\skills\find-skills\SKILL.md`; read locally) | `skills-research`, `coordinator` | Skill discovery & quality vetting (`skills.sh` leaderboard, install count, source reputation) | Establishes vetting criteria (official sources, high install counts, GitHub star verification) before adopting external agent skills. |
| **Vercel React Best Practices** (`vercel-react-best-practices`) | `vercel-labs/agent-skills` | **Reference Guidelines Loaded** (official `SKILL.md` read from GitHub; `Vercel` plugin `antigravity-plugins-partners/plugin/vercel-plugin` is **Marketplace Available**) | `foundation-setup`, `frontend-ui`, `study-exam-engine` | Next.js App Router RSC/Client boundaries, async data fetching, bundle size, rendering performance | Eliminates async waterfalls (`Promise.all`, Suspense streaming, start promises early in Route Handlers), eliminates barrel-import bloat (`bundle-barrel-imports`), dynamically imports heavy client modules (charts, DOCX/XLSX parsers), authenticates Server Actions like API routes, and uses `React.cache()` per-request deduplication. |
| **Vercel Web Interface Guidelines** (`web-design-guidelines`) | `vercel-labs/agent-skills` & `vercel-labs/web-interface-guidelines` | **Reference Guidelines Loaded** (official `SKILL.md` + pinned `command.md` read from GitHub) | `frontend-ui`, `qa-security-verifier` | UI accessibility, focus states, forms, typography, virtualization, dark mode, URL state sync | Enforces WCAG keyboard/focus hygiene (`:focus-visible`, never `outline-none` without replacement), proper form semantics (never block paste, inline errors, `autocomplete`), `tabular-nums` for exam timers & scores, `min-w-0` + `truncate`/`line-clamp` for Vietnamese/long strings, list virtualization (>50 items via TanStack Virtual), `color-scheme: dark`, and URL-synced filters/tabs. |
| **Frontend Design** (`frontend-design`) | `anthropics/skills` | **Reference Guidelines Loaded** (official `skills/frontend-design/SKILL.md` read from GitHub) | `architect-docs`, `foundation-setup`, `frontend-ui` | Aesthetic direction, typography, restraint, microcopy, eliminating generic "AI slop" | Anchors StudyHub in calm academic SaaS craft (Linear/Notion/Quizlet/EduQuiz/Apple HIG): bans generic purple-gradient card soup, ALL-CAPS eyebrow clutter, decorative numbered badges on non-sequential content, and vague error messages; enforces active-voice consistent CTAs and <=80ch reading measure for questions/explanations. |
| **UI/UX Pro Max** (`ui-ux-pro-max`) | `nextlevelbuilder/ui-ux-pro-max-skill` | **Reference Guidelines Loaded** (official `.claude/skills/ui-ux-pro-max/SKILL.md` read from GitHub) | `foundation-setup`, `frontend-ui`, `qa-security-verifier` | Priority 1→10 UI/UX audit matrix (accessibility, touch targets, CLS, semantic tokens, icons, charts, responsive layout) | Enforces 4.5:1 WCAG AA contrast, 44×44px minimum touch targets with 8px+ spacing, Lucide SVG icons only (zero emoji UI icons), CLS < 0.1, semantic CSS tokens (no raw hex in components), accessible Recharts tooltips/legends that never rely on color alone, and mobile-first responsive grids without horizontal overflow. |
| **Motion AI-Kit** (`motion`) | `motiondivision/ai-kit` | **Reference Guidelines Loaded** (official `SKILL.md` + `best-practices/{index,css-or-motion,react,base-ui}.md` read from GitHub) | `foundation-setup`, `frontend-ui`, `study-exam-engine` | `motion/react` animations, flashcard flips, tab indicators (`layoutId`), modal/sheet exits (`AnimatePresence`), Radix integration, reduced motion | Enforces `motion/react` (never `framer-motion`), root `<MotionConfig reducedMotion="user">`, GPU-composited `transform`/`opacity` only, short restrained durations (150–300ms, no bouncy overshoot in serious exam UI), `useId()`-scoped `layoutId`, proper Radix `asChild` + `forceMount` exit choreography, and keyboard alternatives for any drag/reorder UI. |
| **GSAP Skills** (`gsap-react`, `gsap-performance`) | `greensock/gsap-skills` | **Reference Guidelines Loaded** (official `gsap-react/SKILL.md` & `gsap-performance/SKILL.md` read from GitHub; **Not Installed in Runtime**) | `frontend-ui` (policy gate) | Guardrail only if complex multi-step timelines are ever introduced | Confirms StudyHub V1.0 does **not** need GSAP in its runtime bundle (`motion/react` + CSS transitions cover all V1.0 interactions cleanly). If GSAP is ever added later, mandates `useGSAP()` with `scope` ref (or `gsap.context().revert()`), transform/opacity-only tweens, and zero layout thrashing. |
| **Remotion Skills** (`remotion-best-practices`) | `remotion-dev/skills` | **Not Installed (Verified Not Needed in Core Runtime Bundle)** (official `SKILL.md` read from GitHub) | `coordinator`, `foundation-setup` | Out-of-scope verification | Verified Remotion is for programmatic React video composition/Studio rendering. Excluded from StudyHub V1.0 dependencies to keep runtime lean and 100% focused on study & exam preparation. |
| **Playwright E2E & Web Security** (OWASP / Next.js CSP / RLS Isolation) | Playwright official docs + OWASP + Next.js Security + Supabase Security Checklist | **Reference Guidelines Loaded** (`@playwright/test` installed as project devDependency) | `qa-security-verifier`, `foundation-setup`, `db-backend` | Production-build E2E tests, OWASP hardening headers, CSP, multi-context tenant RLS isolation, Server Action/Route Handler auth checks | Enforces testing against production builds (`next build && next start`), asserting `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and CSP headers, verifying multi-user RLS isolation with separate `browser.newContext()` sessions, and verifying unauthenticated mutations return `401`/`403`. |

---

## 4. Actionable Engineering Checklists (Mandatory for All Agents)

All downstream agents (`foundation-setup`, `db-backend`, `import-engine`, `study-exam-engine`, `frontend-ui`, `qa-security-verifier`) **must** follow the checklists applicable to their ownership domain.

### A. Modern Web Guidance & Baseline Rules (`GoogleChrome/modern-web-guidance` — Installed)

1. **Search Before Inventing Client-Side Patterns:** For non-trivial HTML/CSS/DOM features (dialogs, popovers, responsive tables, dark mode, forms, validation, dates/timezones, HTML sanitization, Core Web Vitals), consult `modern-web-guidance` first (`npx.cmd -y modern-web-guidance@latest search "<2-5 word query>"` → `retrieve "<id>"`) rather than relying on legacy patterns.
2. **Baseline Browser Support Policy:**
   - **Baseline Widely Available** features are safe to use directly without fallbacks.
   - Any feature **not** Baseline Widely Available must include the guide's recommended fallback or progressive enhancement.
3. **Framework & SSR Safety (Next.js App Router + React 19):**
   - Always guard `window`, `document`, and `HTMLElement` checks so SSR/RSC renders never throw.
   - Generate per-instance element IDs and CSS `anchor-name` values using React `useId()` (never hardcoded duplicate IDs).
   - Keep `:root` tokens and `@starting-style` rules top-level/unscoped in CSS.
   - Call imperative DOM APIs (e.g., `dialog.showModal()`) via React refs without fighting VDOM reconciliation.
4. **Core Web Vitals Discipline:** Reserve explicit `width`/`height` or `aspect-ratio` on images/media (`CLS < 0.1`), avoid layout reads (`getBoundingClientRect`, `offsetHeight`) during render, and use CSS Flex/Grid over JS layout measurements.

---

### B. Superpowers Discipline: TDD, Debugging, Review & Verification (`obra/superpowers` — Installed)

1. **Test-Driven Development (Iron Law):**
   - *No production code without a failing test first* — mandatory for all deterministic core engines (`import-engine` DOCX/XLSX/CSV/TXT parsers & answer detection, `study-exam-engine` SM-2 spaced repetition, exam snapshot & grading, answer normalization, validation schemas) and every bug fix.
   - Follow **RED → Verify RED (watch it fail for the right reason) → GREEN (minimal code) → Verify GREEN (run full suite, not just one file) → REFACTOR**.
   - Test real behavior with clear single-behavior names; never test mocks instead of real logic.
2. **Systematic Debugging (Iron Law — 4 Phases):**
   - *No fixes without root-cause investigation first.* Never guess-and-patch.
   - **Phase 1 (Root Cause):** Read full stack traces/errors, reproduce consistently, inspect git diff/recent changes, instrument component boundaries, trace bad values backward to their origin.
   - **Phase 2 (Pattern Analysis):** Compare failing code against working equivalents and complete references.
   - **Phase 3 (Single Hypothesis):** State one specific hypothesis, test one minimal variable at a time.
   - **Phase 4 (Fix & Verify):** Write a failing reproduction test first, apply one focused root-cause fix, run full verification. If **>= 3 fixes fail**, stop and escalate an architectural review instead of attempting Fix #4.
3. **Verification Before Completion (Iron Law):**
   - *No completion claims without fresh verification evidence in the same turn.*
   - Never say "should pass", "looks fixed", or "probably works".
   - Before posting `[done]`, run the full verification commands (`npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`, plus `npm run test:e2e` where applicable), read the complete output, confirm exit code `0` and `0` failures, and report exact counts.
   - Any failing test observed in the suite — even outside your direct scope — must be explicitly reported by name, never omitted.
4. **Code Review Discipline:**
   - Fix **Critical** issues immediately and **Important** issues before merging/finishing; verify diff independently rather than trusting status-only summaries.

---

### C. Next.js App Router, React Performance & Web Interface Guidelines (`vercel-labs/agent-skills`)

1. **Eliminate Async Waterfalls (CRITICAL):**
   - Run independent server/client queries concurrently with `Promise.all()`.
   - Check cheap synchronous conditions (e.g., auth presence, Zod schema validation) before awaiting remote calls.
   - In Route Handlers and Server Components, start promises early and `await` late; stream slow secondary panels with React `<Suspense>`.
2. **Bundle Size & Clean Imports (CRITICAL):**
   - Avoid barrel re-export imports that pull unused icons/modules into client chunks; import cleanly.
   - Use `next/dynamic` for heavy client-only modules (e.g., Recharts analytics views, rich export/import previews when not on initial paint).
   - Keep `jszip`, `fast-xml-parser`, `mammoth`, `exceljs`, and `papaparse` strictly scoped to the import/export flow (server routes or lazily loaded import client chunks) — never bloat the main landing/study bundle.
3. **Server-Side Security & Performance (HIGH):**
   - Authenticate **every** Next.js Server Action and Route Handler identically to public HTTP endpoints (check authenticated user via Supabase server client + Zod validate all inputs).
   - Never store request-scoped mutable state at module level in RSC/SSR.
   - Minimize serialized props passed from Server Components to Client Components (never pass sensitive or unused columns).
   - Deduplicate per-request server reads with `React.cache()`.
4. **Web Interface Hygiene (`web-design-guidelines`):**
   - **Accessibility:** Semantic `<button>` for actions and `<Link>`/`<a>` for navigation (never `<div onClick>`). Every icon-only button requires `aria-label`; decorative Lucide icons require `aria-hidden="true"`. Include skip-to-main-content link, hierarchical headings `<h1>`–`<h6>`, and `aria-live="polite"` for toasts/validation updates.
   - **Focus States:** Visible `focus-visible:ring-*` on all interactive controls; never use `outline-none` without a clear replacement; ensure sticky headers/exam footers never obscure the focused element (`scroll-margin-top` / padding).
   - **Forms:** Clickable `<label htmlFor>`, proper `type`/`inputMode`/`autoComplete`, **never block paste** (`onPaste` + `preventDefault`), `spellCheck={false}` on emails/codes/share tokens, inline field errors next to inputs, focus first invalid field on submit, and confirm before discarding unsaved edits or destructive deletes.
   - **Typography & Content Handling:** `font-variant-numeric: tabular-nums` on timers, question counters (`12 / 50`), accuracy percentages, and exam scores; `text-wrap: balance` on headings; `min-w-0` on flex children with `truncate` or `line-clamp-*` so long Vietnamese questions/titles never break layouts; proper ellipsis (`…`) on loading states.
   - **Performance & Lists:** Virtualize question banks and large study sets (>50 items) using `@tanstack/react-virtual`.
   - **State & Theming:** Sync library search, filters, tabs, and pagination to URL query params so pages are deep-linkable and reload-safe; set `color-scheme: dark` on `<html>` in dark mode so native scrollbars and form controls match seamlessly.

---

### D. UI/UX Academic SaaS Design & Anti-Slop Checklist (`frontend-design` + `ui-ux-pro-max`)

1. **Calm Academic SaaS Identity (StudyHub V1.0):**
   - Palette tokens strictly via semantic CSS variables (Primary Indigo, Accent Blue, Success Green, Error Red, Warning Amber, Neutral Slate) supporting crisp **Light Mode** and **Dark Mode** (`>= 4.5:1` text contrast in both modes). Never hardcode raw hex values in components.
   - Typography: `Inter` via `next/font/google` with `vietnamese` subset; base body `16px`, line-height `1.5`, readable question/explanation measure (`<= 80ch`).
   - Icons: Clean Lucide SVG icons only — **zero emoji as UI icons**.
2. **Avoid Generic AI Clichés:**
   - No decorative neon glows, rainbow/purple gradient washes, heavy glassmorphism abuse, or identical uniform card grids where hierarchy is needed.
   - No ALL-CAPS tracked-out eyebrow labels above every heading; no decorative `01 / 02 / 03` badges unless the content is genuinely a sequential workflow (such as the Import Wizard steps).
3. **Interaction, Touch & Charts:**
   - Minimum `44×44px` interactive hit targets with `>= 8px` spacing between adjacent controls; never rely on hover-only interactions for critical actions (mobile & keyboard parity required).
   - Destructive actions (delete study set, delete folder, revoke share link, end exam early) require explicit confirmation dialogs.
   - Recharts progress/score visualizations must include accessible legends, tooltips, and never rely on color alone to convey pass/fail or mastery state (pair color with icon/label).
4. **Clear, Consistent Copy (`vi` default + `en` toggle):**
   - Active-voice, concrete button labels ("Lưu thay đổi" / "Save changes", not generic "Submit"), consistent terminology across buttons and confirmation toasts.
   - Actionable empty states and specific error messages explaining what happened and how to fix it — never auto-translate user-authored study content.

---

### E. Motion (`motion/react`), GSAP Policy & Reduced-Motion Accessibility (`motiondivision/ai-kit` + `greensock/gsap-skills`)

1. **Strict Import Convention:**
   - Always import from `motion/react` in `"use client"` components (or `motion/react-client` in Server Components if needed). **Never** install or import `framer-motion`.
   - Do **not** import paid `motion-plus` APIs (`Carousel`, `AnimateNumber`, etc.) or install GSAP/Remotion into the core runtime bundle.
2. **Global Reduced Motion Safeguard:**
   - Wrap the application root in `<MotionConfig reducedMotion="user">` (in `src/app/providers.tsx`) AND keep a CSS `@media (prefers-reduced-motion: reduce)` safeguard in `globals.css`.
   - When `reducedMotion="user"` is active, transform/layout motion is suppressed while opacity/color feedback remains clear.
3. **GPU-Composited, Restrained Academic Motion:**
   - Animate **only** compositor-friendly properties (`transform`: `x`, `y`, `scale`, `rotate`, and `opacity`; use `layout` for size/position transitions rather than animating `width`/`height`/`top`/`left`).
   - Keep UI transitions crisp and distraction-free: `150–300ms` for controls/cards, `<= 500ms` for larger panels/flashcard flips; avoid bouncy overshoot springs during focused study or timed exams.
   - Never use `transition: all` in CSS — always list explicit properties.
4. **Correct `AnimatePresence`, `layoutId` & Radix Usage:**
   - Keep `<AnimatePresence>` mounted and place the conditional render inside it with a stable unique `key` on each direct child. Use `mode="wait"` for in-place content swaps (e.g., question/card transitions).
   - Scope shared-element `layoutId` values (e.g., active tab indicator) with `useId()` whenever a component can mount more than once on a page.
   - For Radix UI primitives (Dialog, Sheet, Popover) animated with Motion, hoist `open`/`onOpenChange`, place the `forceMount` Radix primitive inside `AnimatePresence`, and attach `motion.*` via `asChild`.
   - Never call `motionValue.get()` inside React render; read only in effects/callbacks or `useTransform`.
   - Any drag/reorder interaction (e.g., reordering questions or options) **must** also provide accessible button/keyboard up-down alternatives.

---

### F. Supabase Auth, RLS Security & PostgreSQL Indexing (`supabase` + `supabase-postgres-best-practices` — Installed)

1. **Row-Level Security (CRITICAL — Every Exposed Table):**
   - Enable RLS (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`) on **all 20 tables** in `public` (and grant explicit schema/table privileges appropriate for `authenticated`/`anon`).
   - **Never** rely on application-level `WHERE user_id = ...` filtering alone.
   - **Never** use deprecated `auth.role()` in policies — always specify `TO authenticated` or `TO anon` directly on `CREATE POLICY`.
   - **Never** leave `TO authenticated` without a row-ownership/membership/visibility predicate in `USING` (prevents BOLA/IDOR).
   - **UPDATE policies MUST specify both `USING` and `WITH CHECK`** (prevents users from reassigning `owner_id`/`user_id` to another account), and remember Postgres RLS requires a matching `SELECT` policy for `UPDATE` to match rows.
2. **RLS Performance & Helper Functions (CRITICAL / HIGH):**
   - Always wrap `auth.uid()` in a scalar subselect inside policies: **`(select auth.uid()) = user_id`** instead of bare `auth.uid() = user_id` (caches per statement instead of invoking per row — 5–100× faster).
   - For multi-table membership/sharing checks (e.g., `study_set_members`, `study_set_share_links`, `friendships`), avoid recursive RLS loops by placing `SECURITY DEFINER` helper functions in a **non-exposed `private` schema** with `SET search_path = ''`, explicit `(select auth.uid())` checks inside the function body, and `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated` where direct RPC exposure is not intended (or narrowly scoped grants only to `authenticated` when required). Never add `SECURITY DEFINER` to blindly bypass a permission error.
   - Any SQL `VIEW` in Postgres 15+ **must** declare `WITH (security_invoker = true)` so it respects the caller's RLS policies.
3. **Auth, Session & Storage Traps (CRITICAL):**
   - **Never** trust `user_metadata` (`raw_user_meta_data`) in RLS or authorization logic — it is user-editable. Use verified database tables/roles or `app_metadata`.
   - **Never** expose `SUPABASE_SERVICE_ROLE_KEY` in client bundles or `NEXT_PUBLIC_*` variables. Use `@supabase/ssr` server/browser clients properly (`getUser()` on server to validate JWT against Auth server rather than blindly trusting unverified `getSession()` cookies).
   - For Supabase Storage buckets (avatars, question images, import source files if stored), upsert operations require **`INSERT` + `SELECT` + `UPDATE`** storage policies — missing `SELECT` or `UPDATE` causes silent upsert failures.
4. **PostgreSQL Schema, Indexing & Query Performance (CRITICAL / HIGH):**
   - **Index every foreign key column** (Postgres does not auto-index FKs; prevents full-table scans on JOINs and `ON DELETE CASCADE` locks).
   - **Index every column referenced in RLS `USING` clauses and common `WHERE`/`ORDER BY` filters** (`owner_id`, `user_id`, `study_set_id`, `question_id`, `folder_id`, `attempt_id`, `next_review_at`).
   - **Composite indexes:** Place equality columns first and range/sort columns last (e.g., `(user_id, next_review_at)` for spaced-repetition due queues, `(study_set_id, position)` for ordered questions).
   - **Eliminate N+1 queries:** Batch fetch options/tags/progress via JOINs or `= ANY($1::uuid[])` / Supabase nested selects rather than per-question loops.
   - **Pagination:** Prefer cursor/keyset pagination (`WHERE (created_at, id) < (...)`) over deep `OFFSET` scans for large lists/history tables.
   - **Connection Pooling:** In serverless Next.js deployments, connect via Supabase's PgBouncer Transaction pooler (or PostgREST via `@supabase/ssr`).
   - **Immutable Exam Snapshots:** `exam_attempt_questions` and `exam_attempt_answers` must store immutable snapshots of question content/options/correctness at attempt creation so later edits to a study set never corrupt historical exam scores.
   - **Migration Hygiene:** Before finalizing schema migrations, validate against `supabase db advisors` (or MCP `get_advisors` once connected) and verify clean idempotency.

---

### G. Playwright E2E & Web Security Verification Checklist

1. **Test Against Production Builds:** Run Playwright E2E suites against `npm run build && npm run start` (not `next dev`) so production bundling, security headers, and error handling are verified realistically.
2. **HTTP Security Headers & CSP:** Verify `next.config.ts` / middleware sets and Playwright asserts hardening headers:
   - `X-Content-Type-Options: nosniff`
   - `X-Frame-Options: DENY` (or `SAMEORIGIN`)
   - `Referrer-Policy: strict-origin-when-cross-origin`
   - `Permissions-Policy` restricting unused browser APIs
   - `Content-Security-Policy` configured cleanly without breaking Next.js/Supabase/Tailwind.
3. **XSS & Import Sanitization:** Never render raw imported DOCX/XLSX/CSV/TXT strings with `dangerouslySetInnerHTML`. Treat all imported study content as untrusted plain text (or strictly sanitized safe subset if formatted) and test payloads containing `<script>`, event handlers, and malformed OOXML/ZIP entries (including ZIP bomb / file size & entry count guards).
4. **Multi-Tenant RLS & Auth Boundary E2E Tests:**
   - Use isolated Playwright browser contexts (`browser.newContext()`) for User A and User B to prove User B cannot read/update/delete User A's `private` study sets, folders, exam attempts, or notes via UI or direct API requests (`401`/`403`/`404`).
   - Verify unauthenticated POST/PATCH/DELETE calls to Route Handlers and Server Actions are rejected (`401`).
   - Verify private/unlisted/shared/public visibility transitions and revoked share links immediately block unauthorized access.
5. **Non-Negotiable Mandate Audit:**
   - **Zero AI in Runtime:** Confirm zero LLM/AI SDKs, endpoints, or chatbot UI exist anywhere in `package.json` or `src/`.
   - **Zero Monetization/Limits:** Confirm zero payment SDKs, paywalls, credits, VIP gates, ads, or artificial attempt/import caps exist anywhere in the codebase.

---

## 5. StudyHub V2.0 — Actual Skill Usage & Verification Evidence (Section 3)

> **Audited & Appended By:** `final-auditor` (Agent 9, Wave 4, 2026-11-24)  
> **Safety & Host Environment Re-Check:** Zero untrusted scripts executed; zero global user configs modified. Host environment verified fresh: Node `v24.15.0`, npm `11.12.1`, Docker Desktop daemon stopped (`DOCKER_EXIT=-1`), `.env.local` absent (`ENV_LOCAL_EXISTS=False`), `supabase` CLI not installed (`WHERE_SUPABASE_EXIT=1`), `list_plugin_accounts`: no signed-in OAuth accounts.

The table below records **concrete, verifiable V2.0 artifacts, code fixes, and reopened defects** driven directly by each active skill during StudyHub V2.0 Waves 1–4:

| Skill / Standard Applied | Responsible V2.0 Agent(s) | Concrete Artifacts, Audits & Code Fixes Driven Directly by the Skill | Measurable V2.0 Outcome |
|---|---|---|---|
| **Modern Web Guidance** (`GoogleChrome/modern-web-guidance`, Installed v1.0.1) | `uiux-auditor`, `v2-ui-builder`, `v2-exam-learning-builder`, `v2-import-builder`, `real-user` | Applied 19 specific Baseline/WAI rules documented in `docs/audit/UIUX_AUDIT.md` §5 (`accessibility`, `color`, `dark-mode`, `motion`, `typography`, `responsive-design`, `form-factor-adaptation`, `forms`, `html`, `navbar`, `tabs`, `dialog`, `responsive-table`, `defer-rendering-heavy-content`, `ime-safe-enter-submit`, `accessible-error-announcement`, `content-first-noise-reduction`, `single-line-overflow`): eliminated nested `<main id="main-content">`, added `<search>` landmarks, `min-h-dvh`, `viewport.colorScheme: "light dark"`, `scroll-padding-top`/`bottom`, Forced-Colors border underlines on `tabs.tsx`, `overscroll-contain` + `>=44px` close buttons on `dialog.tsx`/`sheet.tsx`, `tabIndex={0}` on `table.tsx`, step-transition focus (`tabIndex={-1}`) on `ImportWizard`, Vietnamese Telex/VNI IME guard (`isComposing \|\| keyCode === 229`) on `WriteClient`, and `text-base sm:text-sm` preventing iOS input zoom. | **31/31** WCAG 2.2 AA contrast pairs PASS (up from 9 FAIL); **60/60** Wave 1 UI/UX findings addressed + **9/9** Wave 3 UI reopens verified fixed (`#74`); `sub44Controls: []` on `390×844` live mobile test (`#82`). |
| **Superpowers** (`obra/superpowers` v7.0.2: `verification-before-completion`, `systematic-debugging`, `test-driven-development`) | **All 9 V2.0 Agents** (especially `func-tester`, `db-backend-auditor`, `security-auditor`, `perf-import-auditor`, `real-user`, `final-auditor`) | Enforced fresh evidence-before-claims on every handoff (`verification-before-completion`), failing-test-first TDD on real-file import regressions (`tests/unit/import/v2-regressions.test.ts`), V2.0 math/policy/coverage engines (`tests/unit/learning/*`, `tests/integration/v2-acceptance.test.ts`), and security regression checks (`tests/unit/security/v2-security-regression.test.ts`), plus 4-phase root-cause debugging on the `next build` 31-worker OOM (`#57` -> `#58`), Postgres ARE bracket regex crash (`W3-DB-1`), and `FOR SHARE` lock-upgrade deadlock (`W3-DB-3`). | **31/31** Wave 3 reopened defects caught, root-caused, fixed, and re-verified (`0` remaining); Vitest grew from `82` -> **`167/167`** passing tests across `22/22` files; honest `BLOCKED` verdict on `BLK-001` with zero rubber-stamping. |
| **Supabase Core** (`supabase` plugin v0.1.17) | `db-backend-auditor`, `security-auditor`, `v2-db-backend-builder` | Enforced strict `TO authenticated`/`TO anon` (zero deprecated `auth.role()`), `USING` + `WITH CHECK` on `UPDATE` policies (`study_sessions`, `exam_presets`, `friendships`), `SECURITY DEFINER` with `SET search_path = ''`, column-level `REVOKE`/`GRANT` on `profiles.email` and `exam_attempt_questions` anti-leak columns, `public.current_jwt_role()` PostgREST 10+/PG 15 role resolver (`#63` -> `#76`), private `study-media` Storage RLS with strict UUID regex + server-side `/api/uploads/image` + `/api/uploads/signed-url?redirect=1` (`Vary: Cookie`), and cookie preservation on `src/proxy.ts` redirects. | **26/26** tables with RLS enabled; **0** `getSession()` calls; **0** `.getPublicUrl()` calls; **0** client `service_role` leaks; **37/37** security unit & SQL migration tests PASS (`#79`). |
| **Supabase Postgres Best Practices** (`supabase-postgres-best-practices` v1.1.1) | `db-backend-auditor`, `v2-db-backend-builder`, `perf-import-auditor` | Enforced `(SELECT auth.uid())` initPlan caching across **76/76** policy references in `0005`, leading-column partial FK indexes (**35** unique new indexes in `0005`, `82` total across `0001`–`0005`, `0` duplicates after `#77`->`#78`), statement-level `FOR EACH STATEMENT` question count triggers (replacing 10k row-level updates), set-based `submit_exam_attempt()` & `create_exam_attempt_v2()`, deadlock-safe lock ordering (`coverage_cycles` -> `exam_attempts`, `FOR NO KEY UPDATE` instead of `FOR SHARE`), composite FKs `(study_set_id, question_id)` & `(attempt_id, attempt_question_id)`, `trim_scale()` numeric short-answer fix, `pg_trgm` GIN indexes, and chunked `SAFE_IN_CHUNK_SIZE=100` / `fetchAllPages` eliminating PostgREST `max_rows=1000` & HTTP `414` failures. | **27/28** Wave 1 DB/backend defects + **10/10** Wave 3 SQL/backend reopens verified fixed (`#81`); **0** `FOR SHARE` lock-upgrade hazards; `get_coverage_cycle_subject_progress(uuid[])` eliminated N+1 fetches. |
| **Vercel React Best Practices** (`vercel-react-best-practices`) | `perf-import-auditor`, `v2-ui-builder`, `v2-exam-learning-builder`, `v2-import-builder` | Eliminated static `@supabase` bundle bloat on `/sets/[id]/edit` and `/profile`, kept `recharts` (`129.6 KB` gzip) cleanly lazy-split via `next/dynamic`, kept all 5 server import/export parsers (`0 B`) out of client chunks, isolated `<ExamTimer />` into a memoized 1s leaf, gated `TestHubClient` `useStudySetBundle` on `!activeAttemptId`, added O(1) per-keystroke Step-5 edit validation (`useDeferredValue` + 300ms debounced dup recheck), and eliminated 3× redundant Wizard re-parses + `38.8%` dead `rawSource` payload bloat. | `/sets/[id]/edit` **`-21.6%` gzip** (`235.4 -> 184.6 KB`), `/profile` **`-25.1%` gzip** (`208.4 -> 156.0 KB`), Step-5 edit **`105.53 -> 0.031 ms`** (~3,400× faster), 10k DOCX pipeline **`-28.2%`** (`860.9 ms`), 10k exam gen **`1.25–4.01 ms`** (`#75`). |
| **Frontend Design & UI/UX Pro Max** (`frontend-design`, `ui-ux-pro-max`, `web-design-guidelines`) | `uiux-auditor`, `real-user`, `v2-ui-builder`, `v2-exam-learning-builder` | Enforced Academic Calm SaaS craft: banned `<Sparkles />` (`0` remaining), stripped all developer jargon (`UUID`, `RLS`, `NEXT_PUBLIC_SUPABASE_URL`, `.env.local`) from student-facing copy, replaced 4 duplicate `/library` sidebar aliases with 12 distinct routes + `/exams/new` in mobile center thumb slot, added `<AlertDialog>` confirms with `autoFocus` on Cancel for all destructive actions, virtualized 500–1,000Q navigator & results with color-independent icons, and shipped all 6 App Router boundaries + 35/35 page `metadata`. | **0** `<Sparkles />` icons; **0** raw Tailwind color bypasses in `components/import/*`; **0** dev jargon strings on live public/auth/share pages; branded Light/Dark custom 404 verified live (`#74`, `#82`). |
| **Motion AI-Kit** (`motiondivision/ai-kit` -> `motion/react`) | `uiux-auditor`, `v2-ui-builder`, `v2-exam-learning-builder` | Wired `user_preferences.reduced_motion` via `PreferencesProvider` directly into `<MotionConfig reducedMotion={preferences.reduced_motion ? "always" : "user"}>` (`src/app/providers.tsx`), removed wildcard `* { animation-duration: 0.01ms !important }` from `globals.css`, added `<FadeIn aboveFold>` so above-the-fold `<h1>` never starts at `opacity: 0` (LCP protection), kept compositor-only `transform`/`opacity` on `.skip-to-content`, and verified zero `framer-motion`/`motion-plus` imports. | **12/12** consumer files wired to `useUserPreferences()` (`#74`); live `prefers-reduced-motion: reduce` verified clean in Playwright (`13/13` PASS). |
| **Playwright E2E & Web Security** (`@playwright/test`, OWASP) | `func-tester`, `real-user`, `security-auditor`, `final-auditor` | Tested exclusively against fresh production builds (`next build && next start` on isolated ports `3011`/`3012`/`3013` with clean teardown); asserted prod-only HSTS and zero `localhost`/`127.0.0.1`/`unsafe-eval` in CSP (`PLAYWRIGHT_EXPECT_PROD=1`); verified 6 viewports (`360`–`1920px`), visual bounding-box clipping (`UX-11` caught via screenshot inspection!), EN `<title>` reload persistence (`UX-08b`), and repaired + expanded `tests/e2e/authenticated-journey.spec.ts` (`SH-041` + V2.0 Multi-Subject/Presets/Full Coverage scenarios). | **13/13** live production Playwright tests PASS (verified fresh by `final-auditor` on `:3013`, `9.8s`); **3/3** live-Supabase scenarios cleanly gated by `E2E_SUPABASE_READY=1`; `0` High/Critical `npm audit` CVEs. |
| **GSAP & Remotion Policy Gate** (`gsap-skills`, `remotion-best-practices`) | `final-auditor` | Verified compliance with V1.0 policy gate: `gsap` and `remotion` remain **uninstalled** (`0` hits in `package.json` and `src/*`), keeping the client bundle lean and strictly focused on study & exam preparation. | **`PKG_BANNED_HITS=0`** verified fresh in Wave 4. |
