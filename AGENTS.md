# StudyHub V1.0 — Engineering & Swarm Agent Guidelines (`AGENTS.md`)

> **Authoritative Engineering Contract** for every developer and Swarm agent working in `d:\Code Web\StudyHub`.
> Before writing code, **READ** `docs/SKILLS.md`, `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, and `docs/SECURITY.md`.

---

## 1. Non-Negotiable Product & Engineering Mandates

1. **ZERO AI IN RUNTIME:**
   - NEVER install or call OpenAI, Gemini, Anthropic, LangChain, Vercel AI SDK, HuggingFace, Ollama, vector databases, or any LLM/AI endpoint.
   - ZERO chatbots, ZERO AI tutors, ZERO AI-generated explanations/questions, ZERO "Smart AI" branding.
   - **100% Deterministic Logic** for file parsing, answer detection, grading, shuffling, spaced repetition (SM-2), and analytics.
2. **ZERO PAYMENTS / MONETIZATION / ARTIFICIAL LIMITS:**
   - NEVER install Stripe, Paddle, LemonSqueezy, or billing SDKs.
   - ZERO paywalls, credits, VIP tiers, ads, or artificial caps on study sets, imports, or exam attempts.
3. **PRODUCTION-GRADE REAL APP ONLY:**
   - ZERO mock datasets, ZERO hardcoded fake user profiles, ZERO fake API delays (`setTimeout` pretending to save), ZERO dead/placeholder buttons.
   - Every button, form, filter, mode, and export must perform real database/deterministic work or show a genuine, helpful empty state.
4. **LANGUAGE & CONTENT INTEGRITY:**
   - Default UI language: **Vietnamese (`vi`)** with instant **English (`en`)** toggle persisted to `user_preferences.language` (and local storage for pre-auth pages).
   - **NEVER auto-translate user study content** (questions, options, flashcards, explanations, chapters).
5. **ACADEMIC CALM DESIGN SYSTEM:**
   - Light Mode & Dark Mode (`next-themes` + CSS tokens in `src/app/globals.css`).
   - Palette: Primary **Indigo**, Accent **Blue**, Success **Green**, Error **Red**, Warning **Amber**, Neutral **Slate**.
   - Crisp academic SaaS aesthetic (Linear / Notion / Quizlet / EduQuiz / Apple HIG). NO neon glow, NO gradient abuse, NO glassmorphism abuse, NO emoji icons in UI controls (use `lucide-react` exclusively).

---

## 2. Mandatory Skills Reference

Every agent MUST read [`docs/SKILLS.md`](docs/SKILLS.md) before starting implementation and adhere to its actionable checklists:
- **Modern Web Guidance (Google Chrome Baseline):** Semantic HTML5, Baseline CSS/JS APIs, avoid deprecated APIs, accessible focus management, Core Web Vitals hygiene.
- **Superpowers Discipline:** Plan before coding, TDD for parsers/grading/SM-2/security, systematic root-cause debugging, strict verification (`typecheck`, `lint`, `test`, `build`) before claiming `[done]`.
- **Next.js App Router & React Best Practices:** Server Components by default, Client Components only at interactive leaves, zero waterfall queries, clean Zod validation at boundaries.
- **Motion (`motion/react`):** Animate `transform` and `opacity` ONLY; 120–200ms micro-interactions, 150–250ms dialogs, 250–400ms flashcard flip; always respect `prefers-reduced-motion` via `<MotionConfig reducedMotion="user">`.
- **Supabase & PostgreSQL Best Practices:** Strict RLS on all 20 tables, wrap `auth.uid()` in `(SELECT auth.uid())`, index all foreign keys and hot filters, never expose `SUPABASE_SERVICE_ROLE_KEY` to client code.

---

## 3. Coding Conventions & Architecture Boundaries

- **TypeScript:** `strict: true`, NO `any`, NO `@ts-ignore` / `@ts-expect-error` without documented justification, explicit return types on exported library functions.
- **Imports:** Always use `@/*` path alias (`src/*`). Import shared types exclusively from `@/types/domain`, `@/types/database`, and `@/types/import`.
- **Validation:** Every Route Handler and Server Action MUST validate request inputs with `zod` schemas from `src/lib/validation/*`.
- **Error Handling:** Return uniform JSON envelopes (`{ data, meta? }` or `{ error: { code, message, details? } }`). Never leak raw Postgres stack traces or internal SQL details to the client.
- **Pure Core Logic:** Keep `src/lib/import/*`, `src/lib/learning/*`, `src/lib/export/*`, and `src/lib/security/*` free of React/Next.js UI coupling so they can be unit-tested cleanly in Vitest.
- **Server-Only Guard:** `src/lib/supabase/admin.ts` MUST contain `import 'server-only';` and NEVER be imported by Client Components.
- **Option Grading Rule:** ALWAYS grade choice questions by **stable option UUID** (`question_options.id` / `options_snapshot[].id`), NEVER by display index or letter (`A`/`B`/`C`/`D`), so option shuffling can never corrupt grading.
- **Exam Immutability Rule:** `exam_attempt_questions` stores full question/option snapshots. Editing a `questions` row MUST NEVER change past exam attempts.

---

## 4. Strict File Ownership Map (Swarm Workers)

To prevent merge conflicts and clobbered edits, workers MUST respect strict path ownership. Do NOT edit files owned by another worker without explicit coordinator handoff.

| Worker / Role | Exclusive Path Ownership | Must NOT Touch |
| --- | --- | --- |
| `skills-research` | `docs/SKILLS.md` | All other files |
| `architect-docs` | `AGENTS.md`, `docs/*` (except `docs/SKILLS.md`) | `package.json`, `src/*`, `supabase/*`, `README.md` |
| `foundation` | Root configs (`.gitignore`, `.env.example`, `package.json`, `tsconfig.json`, `next.config.ts`, `eslint.config.mjs`, `vitest.config.ts`, `playwright.config.ts`, `components.json`), `src/app/layout.tsx`, `src/app/globals.css`, `src/app/providers.tsx`, `src/components/ui/*`, `src/lib/utils.ts`, `src/lib/i18n/*`, `src/types/*` | `docs/*`, `AGENTS.md`, `supabase/*` |
| `backend-supabase` | `supabase/*`, `src/lib/supabase/*`, `src/lib/validation/*`, `src/lib/security/*`, `src/middleware.ts`, `src/app/auth/*`, `src/app/api/*` (except `/api/import/*` if delegated to `import-engine`) | `src/components/*`, `docs/*` |
| `import-engine` | `src/lib/import/*`, `src/lib/export/*`, `src/app/api/import/*`, `src/app/api/sets/[id]/export/*`, `src/components/import/*`, `tests/fixtures/*`, `tests/unit/import/*` | `supabase/*`, `src/components/ui/*` |
| `learning-exam` | `src/lib/learning/*`, `src/components/learning/*`, `src/components/exam/*`, `src/app/(app)/sets/[id]/(flashcards\|learn\|practice\|write\|match\|test\|results)/*`, `src/app/(app)/review/*`, `tests/unit/learning/*` | `supabase/*`, `src/lib/import/*` |
| `frontend-ui` | `src/app/page.tsx`, `src/app/(auth)/*`, `src/app/(app)/layout.tsx`, `src/app/(app)/(dashboard\|library\|folders\|sets/new\|sets/[id]/page.tsx\|sets/[id]/edit\|starred\|history\|statistics\|shared\|friends\|profile\|settings)/*`, `src/app/share/*`, `src/components/(layout\|auth\|library\|editor\|analytics\|social)/*` | `supabase/*`, `src/lib/import/*`, `src/lib/learning/*` |
| `qa-security` | `tests/e2e/*`, `tests/integration/*`, `tests/unit/security/*`, verification reports, `README.md` (final pass if assigned) | Production feature code (report bugs to owning worker to fix) |

---

## 5. Security Checklist (Mandatory on Every PR / Task)

1. **RLS Enabled Everywhere:** All 20 tables in `public` have RLS enabled and verified policies (see `docs/DATABASE.md` §5).
2. **Defense-in-Depth Server Checks:** Every Route Handler checks `supabase.auth.getUser()` (never trust `getSession()` alone on the server) AND verifies ownership or `study_set_members` role before mutations.
3. **Exam Anti-Leak & Integrity:**
   - Pre-submit exam payloads (`POST /api/exams`, `GET /api/exams/[attemptId]` while `in_progress`) MUST NEVER contain `is_correct`, `correct_option_ids`, `accepted_answers_snapshot`, or `explanation_snapshot`.
   - `expires_at` is computed from PostgreSQL/server time.
   - `POST /api/exams/[attemptId]/submit` is strictly server-scored and idempotent.
4. **Anti-XSS:** Render all user text via React text escaping. Never use `dangerouslySetInnerHTML` on unescaped user/imported content. Disallow `javascript:` / `data:text/html` URLs and reject `image/svg+xml` uploads.
5. **Upload & Archive Bomb Protection (`src/lib/security/upload.ts`):**
   - Validate extension + MIME + magic bytes (`PK\x03\x04` for `.docx`/`.xlsx`, UTF-8 validity for text).
   - File size cap: **15 MB** for documents/spreadsheets, **5 MB** for images.
   - ZIP/OOXML bomb limits: max **500 entries**, max **50 MB uncompressed total**, max **100:1 compression ratio**, max **50,000 parsed questions**.
   - Never fetch external XML entities (XXE disabled in `fast-xml-parser`), never execute macros (`.docm`/`.xlsm` rejected).
6. **Rate Limiting:** Apply deterministic sliding-window rate limits to auth helpers, `/api/import/parse`, `/api/share-links/[token]/redeem`, and friend requests.

---

## 6. Shared Contracts & Verification (Definition of Done)

A task is **NOT DONE** until ALL of the following pass with exit code `0`:
1. `npm run typecheck` (`tsc --noEmit`) — 0 TypeScript errors.
2. `npm run lint` — 0 ESLint errors, 0 React Hooks violations.
3. `npm run test` (Vitest) — all unit & integration tests pass, including new tests for added logic.
4. `npm run build` — clean Next.js production build.
5. For UI changes: verified across Light & Dark mode, Vietnamese & English, keyboard navigation, and mobile (360px/390px) + desktop (1440px) viewports.
6. For security-sensitive features (auth, RLS, exams, imports, share links): verified against `docs/SECURITY.md` checklist.
7. Update `docs/PROGRESS.md` (via coordinator or owning doc task) and report concrete command outputs in your board post.
