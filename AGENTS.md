# StudyHub V3.0 (Complete Learning Edition) — Engineering & Swarm Agent Guidelines (`AGENTS.md`)

> **Authoritative Engineering Contract** for every developer and Swarm agent working in `d:\Code Web\StudyHub`.
> Before writing code, **READ** `docs/SKILLS.md`, `docs/ARCHITECTURE.md`, `docs/DATABASE.md`, and `docs/SECURITY.md`.

---

## 1. Non-Negotiable Product & Engineering Mandates

1. **ZERO AI IN RUNTIME:**
   - NEVER install or call OpenAI, Gemini, Anthropic, LangChain, Vercel AI SDK, HuggingFace, Ollama, vector databases, paid TTS/STT, OCR APIs, or any LLM/AI endpoint.
   - ZERO chatbots, ZERO AI tutors, ZERO AI-generated explanations/questions, ZERO "Smart AI" branding, ZERO `<Sparkles />` icons.
   - **100% Deterministic Logic** for file parsing (including `.docx` multimedia & `.pdf` text-layer extraction via `pdfjs-dist` with honest scanned-PDF detection), answer detection, 12-type exam grading, shuffling, spaced repetition (SM-2 + confidence calibration), visual diagram geometry, PDF export (`pdf-lib`), and offline sync.
2. **ZERO PAYMENTS / MONETIZATION / ARTIFICIAL LIMITS:**
   - NEVER install Stripe, Paddle, LemonSqueezy, or billing SDKs.
   - ZERO paywalls, credits, VIP tiers, ads, or artificial caps on study sets, imports, diagrams, offline downloads, PDF exports, or exam attempts.
3. **PRODUCTION-GRADE REAL APP ONLY:**
   - ZERO mock datasets, ZERO hardcoded fake user profiles, ZERO fake API delays (`setTimeout` pretending to save), ZERO dead/placeholder buttons.
   - Every button, form, filter, mode, offline sync action, and export must perform real database/IndexedDB/deterministic work or show a genuine, helpful empty state.
4. **LANGUAGE & CONTENT INTEGRITY:**
   - Default UI language: **Vietnamese (`vi`)** with instant **English (`en`)** toggle persisted to `user_preferences.language` (and local storage for pre-auth pages).
   - **NEVER auto-translate user study content** (questions, options, flashcards, diagrams, passages, notes, explanations, chapters).
5. **ACADEMIC CALM DESIGN SYSTEM:**
   - Light Mode & Dark Mode (`next-themes` + CSS tokens in `src/app/globals.css`, WCAG 2.2 AA).
   - Palette: Primary **Indigo**, Accent **Blue**, Success **Green**, Error **Red**, Warning **Amber**, Neutral **Slate**.
   - Crisp academic SaaS aesthetic (Linear / Notion / Quizlet / EduQuiz / Apple HIG). NO neon glow, NO gradient abuse, NO glassmorphism abuse, NO emoji icons in UI controls (use `lucide-react` exclusively).

---

## 2. Mandatory Skills Reference

Every agent MUST read [`docs/SKILLS.md`](docs/SKILLS.md) before starting implementation and adhere to its actionable checklists:
- **Modern Web Guidance (Google Chrome Baseline):** Semantic HTML5, Baseline CSS/JS APIs, `sanitize-untrusted-html`, `ime-safe-enter-submit` (Vietnamese Telex/VNI), `lazy-load-video-and-audio`, standard Pointer Events + `touch-action: none` for 2D pan/zoom, accessible focus management, Core Web Vitals hygiene.
- **Superpowers Discipline:** Plan before coding, TDD for parsers/grading/SM-2/confidence/diagram geometry/offline sync/security, systematic root-cause debugging, strict verification (`typecheck`, `lint`, `test`, `build`) before claiming `[done]`.
- **Next.js App Router & React Best Practices:** Server Components by default, Client Components only at interactive leaves, leaf imports (never pull `@tiptap/*` or `@supabase/supabase-js` into read-only/public bundles via barrels), `serverExternalPackages: ["pdfjs-dist"]`, zero waterfall queries, clean Zod validation at boundaries.
- **Motion (`motion/react`):** Animate `transform` and `opacity` ONLY; 120–200ms micro-interactions, 150–250ms dialogs, 250–400ms flashcard flip; always respect `prefers-reduced-motion` + `user_preferences.reduced_motion` via `<MotionConfig>`.
- **Supabase & PostgreSQL Best Practices:** Strict RLS on all **36 public tables** (Migrations `0001`–`0016`), wrap `auth.uid()` in `(SELECT auth.uid())`, index all foreign keys (`unindexed_foreign_keys = 0`), `SET search_path = ''` + explicit `REVOKE ALL ... FROM PUBLIC, anon` on `SECURITY DEFINER` RPCs, never expose `SUPABASE_SECRET_KEY` / `SUPABASE_SERVICE_ROLE_KEY` to client code, preserve existing real user data during live tests.

---

## 3. Coding Conventions & Architecture Boundaries

- **TypeScript:** `strict: true`, NO `any`, NO `@ts-ignore` / `@ts-expect-error` without documented justification, explicit return types on exported library functions.
- **Imports:** Always use `@/*` path alias (`src/*`). Use direct leaf imports for heavy UI subsystems (`@/components/richtext/RichContentRenderer`, `@/components/pwa/PwaProvider`, `@/components/media/ImageLightbox`) so lazy-loaded editors/SDKs never bloat initial routes.
- **Validation:** Every Route Handler and Server Action MUST validate request inputs with `zod` schemas from `src/lib/validation/*`.
- **Error Handling:** Return uniform JSON envelopes (`{ data, meta? }` or `{ error: { code, message, details? } }`). Never leak raw Postgres stack traces or internal SQL details to the client.
- **Pure Core Logic:** Keep `src/lib/import/*`, `src/lib/learning/*`, `src/lib/export/*`, `src/lib/diagram/*`, `src/lib/offline/*`, `src/lib/richtext/*`, `src/lib/media/*`, and `src/lib/security/*` cleanly unit-testable in Vitest.
- **Server-Only Guard:** `src/lib/supabase/admin.ts` MUST contain `import 'server-only';` and NEVER be imported by Client Components.
- **Option Grading Rule:** ALWAYS grade choice questions (`single_choice`, `multiple_choice`, `true_false`, `image_choice`) by **stable option UUID**, and structured types (`ordering`, `matching`, `fill_in_blank`, `numerical`, `image_hotspot`, `reading_passage`, `listening`) with 100% client/SQL parity.
- **Confidence Exam Score Neutrality (P0):** Confidence tags (`certain` / `unsure` / `guessing`) calibrate SM-2 & mistake review ONLY — they MUST NEVER alter exam `score_percent`, `correct_count`, `is_correct`, or `passed`.
- **Exam Immutability & Hard Exam Guard:** `exam_attempt_questions` snapshots are immutable (`prevent_exam_snapshot_update()`), `content_media_relations` (`ON DELETE RESTRICT`) preserves historical exam media, and `Ctrl+K` Global Search MUST stay strictly disabled during active exams.
- **Account-Partitioned Offline Isolation (P0):** IndexedDB MUST stay partitioned per `userId` (`studyhub-offline-v3:${userId}`), purge active pointers on logout, and never allow `public/sw.js` to cache `/api/*`, `/auth/*`, `/share/*`, or authenticated HTML.

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

1. **RLS Enabled Everywhere:** All **36 tables** in `public` (20 V1.0 + 6 V2.0 + 10 V3.0) have RLS enabled and verified policies (see `docs/DATABASE.md` §5 & §8).
2. **Defense-in-Depth Server Checks:** Every Route Handler checks `supabase.auth.getUser()` (never `getSession()`) AND verifies ownership or `study_set_members` role before mutations. Always chain `.select("id").maybeSingle()` before side effects like `supabase.storage.remove()`.
3. **Exam Anti-Leak & Integrity (All 12 Exam Types):**
   - Pre-submit exam payloads (`POST /api/exams`, `GET /api/exams/[attemptId]` while `in_progress`) MUST NEVER contain `is_correct`, `correct_option_ids`, `accepted_answers_snapshot`, `explanation_snapshot`, `explanation_rich_snapshot`, `type_payload_snapshot` grading keys (`target_hotspots`, `correct_position`, matching `pairs`, hidden listening `transcript`, numerical keys).
   - `expires_at` is computed from PostgreSQL/server time; `POST /api/exams/[attemptId]/submit` is strictly server-scored and idempotent; `POST /api/export/pdf` blocks non-`question_paper` modes on both `in_progress` and `discarded` attempts (`403`).
4. **Anti-XSS, Rich Text & KaTeX:** Render all user text via React escaping and canonical TipTap JSON AST v1 sanitized via `sanitizeRichTextDoc()` on BOTH `/api/notes` and `/api/sync/events`. Restrict `dangerouslySetInnerHTML` strictly to `renderSafeKatexHtml()` with `trust: false` and explicit `<script|javascript:` guards. Disallow `javascript:` / `data:text/html` URLs and reject `image/svg+xml` uploads.
5. **Upload, Audio & Archive Bomb Protection (`src/lib/security/upload.ts` & `src/lib/media/validation.ts`):**
   - Validate extension + MIME + magic bytes (`PK\x03\x04` for `.docx`/`.xlsx`, `%PDF-` for `.pdf`, raster magic bytes for images, MP3/WAV/M4A/AAC/WebM/OGG magic bytes for audio).
   - Size caps: **15 MB** for documents/spreadsheets/PDFs, **5 MB** for raster images, **10 MB** (and `120s` recording) for audio.
   - ZIP/OOXML bomb limits: max **500 entries** (2,000 w/ verified `word/media/*`), max **50 MB uncompressed**, max **100:1 compression ratio**, max **50,000 parsed questions**.
   - Disable XXE in `fast-xml-parser`, disable JS eval in `pdfjs-dist` (`isEvalSupported: false`, `disableAutoFetch: true`, `useSystemFonts: false`), reject macros (`.docm`/`.xlsm`).
6. **PWA & Rate Limiting:** `public/sw.js` MUST serve `Cache-Control: no-cache, no-store, must-revalidate`, never cache `/api/*`/`/auth/*`/`/share/*`/authenticated HTML, and gate `skipWaiting()` on explicit `APPLY_UPDATE`. Apply deterministic sliding-window rate limits across auth, import, media, export, sync, search, share-link redeem, and friend endpoints.

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
