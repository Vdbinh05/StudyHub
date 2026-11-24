# StudyHub V2.0 — UI/UX & Interaction Audit + Design Specification

> **Author:** Agent 4 (`uiux-auditor` — UI/UX Designer & Interaction Auditor)  
> **Audit Scope:** All pages (`src/app/**`) and UI component suites (`src/components/{layout,auth,library,editor,import,learning,exam,analytics,social,motion,ui}/*`), plus `src/app/globals.css`, `src/app/layout.tsx`, `src/app/providers.tsx`, and `src/lib/i18n/index.tsx`.  
> **Standards Applied:** Google Chrome Modern Web Guidance (Baseline HTML/CSS/JS), WCAG 2.2 AA, StudyHub Academic Calm Design System (`docs/DESIGN_SYSTEM.md`), `motion/react` guidelines (`docs/SKILLS.md`), and `AGENTS.md` (100% deterministic — ZERO AI in runtime, ZERO paywalls/limits).

---

## 1. Executive Summary & Audit Scorecard

StudyHub V1.0 establishes a clean visual foundation (Slate/Indigo palette, zero AI slop in core learning modes, real Supabase-backed views, keyboard shortcuts in study modes). However, a full file-by-file UI/UX and WCAG 2.2 AA audit uncovered **60 concrete defects** (**24 P1 Critical**, **28 P2 Major**, **8 P3 Polish**) that directly impact accessibility compliance, mobile usability, trust in user settings, and scalability to 250–500 question multi-subject exams.

### Top 10 Systemic Findings

1. **Navigation IA Redundancy & Missing `/exams/new`:** 4 of 12 desktop sidebar items lazily route to `/library` (`library`, `question-bank`, `flashcards`, `mock-exams`), and neither desktop nor mobile navigation provides a direct route to a standalone Universal Custom Exam Builder (`/exams/new`).
2. **WCAG 2.2 AA Contrast Failures in Core Tokens (`globals.css`):** 8 color pairings fail AA — including Dark Mode `--primary` (`4.47:1`), `--primary-hover` (`2.98:1`), `--destructive` (`3.76:1`), `--accent-solid` (`3.68:1`), Light `--success` (`3.30:1`), Light `--warning` (`3.19:1`), and `--input` borders in both themes (`1.48:1` Light, `1.71:1` Dark vs `>= 3.0:1` WCAG 1.4.11).
3. **Landmark & Focus Shell Corruption:** Every focus route nests `<FocusModeShell>`'s `<main id="main-content">` inside `AppShell`'s `<main id="main-content">` (duplicate ID + nested `<main>`). Worse, `/sets/[id]/results/[attemptId]` is omitted from `FOCUS_ROUTE_PATTERN`, rendering **two** stacked sticky headers and full sidebar + focus shell simultaneously.
4. **Flashcard Screen-Reader Erasure & Overflow Clipping:** `FlashcardsClient` wraps the entire card content inside `<button aria-label="Flip to reveal back">`, causing screen readers to ignore all question/answer text, while `absolute inset-0` faces clip long academic questions inside a fixed `min-h-[300px]` box.
5. **250–500Q Exam Runner Scaling & Mobile Deficits:** `ExamNavigatorGrid` has a 2px/row virtualization height mismatch (`44px` estimated vs `46px` rendered -> `200px` drift at 500Q), zero filters (Unanswered/Marked/Subject), no auto-scroll to active item, `40px` tiles (`<44px`), and missing `M` shortcut; `LiveExamRunner` hides the autosave indicator on mobile (`hidden sm:inline-flex`), lacks a Retry button on sync error, lacks an exit-confirmation flush, and does not keep Prev/Next sticky on mobile. `ExamResultsClient` renders all 500 review cards unvirtualized and dumps up to 100 UUIDs into a `~3,700`-char query string.
6. **5 Unwired User Preferences ("Ghost Settings"):** `settings-view.tsx` writes `reduced_motion`, `sound_effects`, `default_shuffle_questions`, `default_shuffle_options`, and `show_instant_feedback` to `user_preferences`, yet **zero** provider, learning, or exam files in `src/` ever read them.
7. **Systemic Touch Target & iOS Zoom Defects:** Core UI primitives (`button.tsx`, `input.tsx`, `textarea.tsx`, `select.tsx`, `dialog.tsx`, `sheet.tsx`) lock fixed heights (`h-8`/`h-9`/`size-7` = 28–36px `< 44px` on touch) and `text-sm` (`14px` triggers iOS Safari auto-zoom on input focus).
8. **Missing App Router Boundaries & Page Titles:** Zero `loading.tsx`, `error.tsx`, `global-error.tsx`, or `not-found.tsx` files exist in `src/app/`, and 14 of 28 routes lack page-specific `metadata` titles (WCAG 2.4.2).
9. **Unconfirmed Destructive Deletes & Broken Multi-Subject Flows:** Deleting questions (`question-editor-view`), revoking share links/members (`share-dialog`), unfriending (`friends-view`), and `"Replace Entire Set"` (`StepImportOptionsAndCommit`) execute immediately with no confirmation dialog. Multi-subject mistakes/starred CTAs silently launch only the first set (`mistakes[0].study_set_id`), and multi-subject history rows (`study_set_id === null`) render dead links.
10. **Anti-Pattern Regressions:** `globals.css` applies `* { animation-duration: 0.01ms !important }` under `prefers-reduced-motion`; `StepFormatAndRules.tsx` uses the forbidden `<Sparkles />` icon; `ImportWizard` duplicates `VirtualizedPreviewList` across Steps 4 and 5; 5 public auth/share routes have zero `<h1>` elements.

---

### WCAG 2.2 AA Contrast Verification Matrix (`src/app/globals.css`)

All contrast ratios below were mathematically computed against WCAG 2.2 relative luminance formulas (`4.5:1` minimum for normal text, `3.0:1` minimum for UI component boundaries per WCAG 1.4.11).

| Token Pair | File:Line | Current Values | Ratio | WCAG 2.2 AA Status | Recommended AA-Passing Fix | Fixed Ratio |
| --- | --- | --- | --- | --- | --- | --- |
| Light `--success` / `--success-foreground` | `src/app/globals.css:41-42` | `#16a34a` / `#ffffff` | **3.30:1** | **FAIL** (1.4.3 < 4.5:1) | `--success: #15803d` (matches `DESIGN_SYSTEM.md`) | **5.02:1** |
| Light `--warning` / `--warning-foreground` | `src/app/globals.css:51-52` | `#d97706` / `#ffffff` | **3.19:1** | **FAIL** (1.4.3 < 4.5:1) | `--warning: #b45309` (matches `DESIGN_SYSTEM.md`) | **5.02:1** |
| Light `--input` on `--card` | `src/app/globals.css:16,58` | `#cbd5e1` on `#ffffff` | **1.48:1** | **FAIL** (1.4.11 < 3.0:1) | `--input: #64748b` (focus ring remains `#4f46e5`) | **4.76:1** |
| Dark `--primary` / `--primary-foreground` | `src/app/globals.css:92-93` | `#6366f1` / `#ffffff` | **4.47:1** | **FAIL** (1.4.3 < 4.5:1) | `--primary: #4f46e5` with `#ffffff` ink | **6.29:1** |
| Dark `--primary-hover` / `--primary-foreground` | `src/app/globals.css:93-94` | `#818cf8` / `#ffffff` | **2.98:1** | **FAIL** (1.4.3 < 4.5:1) | `--primary-hover: #4338ca` with `#ffffff` ink | **7.90:1** |
| Dark `--sidebar-primary` / `--sidebar-primary-foreground` | `src/app/globals.css:141-142` | `#6366f1` / `#ffffff` | **4.47:1** | **FAIL** (1.4.3 < 4.5:1) | `--sidebar-primary: #4f46e5` | **6.29:1** |
| Dark `--accent-solid` / `--accent-solid-foreground` | `src/app/globals.css:107-108` | `#3b82f6` / `#ffffff` | **3.68:1** | **FAIL** (1.4.3 < 4.5:1) | `--accent-solid: #2563eb` | **5.17:1** |
| Dark `--destructive` / `--destructive-foreground` | `src/app/globals.css:116-117` | `#ef4444` / `#ffffff` | **3.76:1** | **FAIL** (1.4.3 < 4.5:1) | `--destructive: #dc2626` | **4.83:1** |
| Dark `--input` on `--card` | `src/app/globals.css:86,128` | `#334155` on `#111827` | **1.71:1** | **FAIL** (1.4.11 < 3.0:1) | `--input: #64748b` | **3.73:1** |

---

## 2. Screen-by-Screen & Component UI/UX Audit Matrix

### 2.1 Global Styles, Tokens, Layout, Providers & App Router Boundaries

| ID | Sev | File:Line | Issue | Concrete Fix |
| --- | --- | --- | --- | --- |
| **G-01** | **P1** | `src/app/globals.css:41-58, 92-142` | 9 semantic color/border tokens fail WCAG 2.2 AA (see table above). | Replace token hex values with the AA-verified values in Section 1. |
| **G-02** | **P1** | `src/app/globals.css:237-250` | `@media (prefers-reduced-motion: reduce)` forces `animation-duration: 0.01ms !important; transition-duration: 0.01ms !important` on `*`. Violates `motion` guide (causes jarring instant snaps and kills non-motion color/opacity hover feedback). | Remove global `*` override. Disable/dampen only spatial animations (`transform`, keyframe motion) via scoped classes and `<MotionConfig reducedMotion>`. Keep subtle `color`/`background-color`/`border-color` transitions enabled. |
| **G-03** | **P1** | `src/app/providers.tsx:39`, `src/components/layout/settings-view.tsx:121,358-412` | `user_preferences.reduced_motion`, `sound_effects`, `default_shuffle_questions`, `default_shuffle_options`, and `show_instant_feedback` are persisted to DB but read **nowhere** in `src/`. `<MotionConfig reducedMotion="user">` ignores the user's explicit in-app `reduced_motion` toggle. | Expose a `UserPreferencesProvider` (fed by `/api/profile` or SSR layout) that sets `<MotionConfig reducedMotion={prefs.reduced_motion ? "always" : "user"}>` and supplies real default values to Practice, Flashcards, Learn, Write, and Exam Builder. Remove `sound_effects` toggle or wire a deterministic Web Audio cue (off by default). |
| **G-04** | **P1** | `src/app/` (missing files) | Zero `loading.tsx`, `error.tsx`, `global-error.tsx`, or `not-found.tsx` files exist. Unhandled runtime errors show bare Next.js crash pages; unknown routes (e.g., `/exams/new` today) show unstyled default 404. | Add `src/app/not-found.tsx`, `src/app/error.tsx`, `src/app/global-error.tsx`, `src/app/(app)/loading.tsx`, and `src/app/(app)/error.tsx` styled with `EmptyState` + bilingual copy and safe recovery actions. |
| **G-05** | **P1** | `src/app/**/page.tsx` (14 of 28 routes) | Half of all routes omit page-specific `metadata` (`<title>`), showing the generic root title across Dashboard, Library, Folders, Set Detail, Exam, Review, etc. (WCAG 2.4.2). | Export static `metadata` or `generateMetadata()` on every route (`"Thi thử — StudyHub"`, `"{Set Title} — StudyHub"`, etc.). |
| **G-06** | **P2** | `src/app/layout.tsx:21-28`, `src/app/globals.css:209-216` | Missing `viewport: { colorScheme: "light dark", viewportFit: "cover" }` and `<meta name="color-scheme" content="light dark">`. `html` hardcodes `color-scheme: light`, causing dark-mode white flash and unstyled native scrollbars before JS hydration. | Export Next.js `viewport` with `colorScheme: "light dark"` and `viewportFit: "cover"`. Change `globals.css` base to `:root { color-scheme: light dark; }`, `:root.light { color-scheme: light; }`, `:root.dark { color-scheme: dark; }`. |
| **G-07** | **P2** | `src/app/globals.css:209-269` | Missing `scroll-padding-top` (sticky 56px header) and `scroll-padding-bottom` (sticky mobile bottom nav + `env(safe-area-inset-bottom)`), causing focused inputs/buttons to slide underneath fixed bars (WCAG 2.4.11 Focus Not Obscured). | Add `scroll-padding-top: 4.5rem;` and on `<lg`: `scroll-padding-bottom: calc(4.75rem + env(safe-area-inset-bottom));` on `html` / scroll container. |
| **G-08** | **P2** | `src/app/providers.tsx:42` | `<Toaster position="bottom-right" />` overlaps mobile bottom navigation bar and sticky exam Prev/Next controls. | Use responsive toast placement (`top-center` on `<md` viewports, `bottom-right` on desktop) per `DESIGN_SYSTEM.md`. |
| **G-09** | **P3** | `src/app/layout.tsx:66`, `src/app/globals.css:253-269` | Skip link hardcodes Vietnamese outside `<I18nProvider>` and animates `top` (layout property) instead of `transform`. | Render skip link inside `I18nProvider` so it updates for English users; hide/reveal using `translate-y-[-150%] focus:translate-y-0` (compositor-only). |
| **G-10** | **P3** | `src/components/motion/index.tsx:55-82` | `<FadeIn>` / `<StaggerItem>` wrap above-the-fold page heroes (`landing-page.tsx:162`, `auth-shell.tsx:35`, `dashboard-view.tsx`) with `initial={{ opacity: 0, y: 8 }}`, delaying LCP until React hydration. | Do not hide above-the-fold `<h1>` hero or primary content at `opacity: 0` on initial SSR render; reserve `<FadeIn>` for post-interaction state transitions or below-the-fold sections. |

---

### 2.2 Navigation Shell, Landing, Profile & Settings

| ID | Sev | File:Line | Issue | Concrete Fix |
| --- | --- | --- | --- | --- |
| **N-01** | **P1** | `src/components/layout/app-shell.tsx:73-120, 418-443` | **4 of 12 sidebar items lazily route to `/library`** (`library`, `question-bank` -> `/library?type=multiple_choice`, `flashcards` -> `/library?type=flashcards`, `mock-exams` -> `/library?action=test`), creating fake nav depth and zero direct path to a multi-subject Exam Builder. Mobile 5-tab bar (`Dashboard, Library, Review, Stats, More`) omits Mock Exams completely. | Replace redundant links with real distinct V2.0 routes (see Section 4.1): promote **`/exams/new` ("Thi thử / Mock Exams")** to a primary desktop nav item and center/primary 3rd slot in the 5-tab mobile bottom nav. |
| **N-02** | **P1** | `src/components/layout/app-shell.tsx:186-187, 359`, `src/components/learning/FocusModeShell.tsx:106` | `AppShell` renders `<main id="main-content">` even when `isFocusRoute === true`, nesting `<FocusModeShell>`'s `<main id="main-content">` inside it (WCAG 1.3.1 duplicate landmark + duplicate DOM `id`). Additionally, `FOCUS_ROUTE_PATTERN` omits `results`, so `/sets/[id]/results/[attemptId]` renders full sidebar + topbar + bottom nav **plus** `FocusModeShell`'s sticky bar. | When `isFocusRoute` is true (including `/exams/[attemptId]` and `/results`), render `{children}` directly without wrapping in a second `<main>`. Add `results` and `/exams/[^/]+` to `FOCUS_ROUTE_PATTERN` (or give Results a clean non-duplicated `AppShell` page layout). |
| **N-03** | **P1** | `src/components/layout/app-shell.tsx:383-415` | When desktop sidebar is collapsed (`collapsed === true`), `<Link>` renders `<Icon aria-hidden="true" />` and hides `<span>{label}</span>` without setting `aria-label={label}` (only `title={label}`), yielding empty/unreliable accessible names (WCAG 4.1.2). | Always render `<span className={collapsed ? "sr-only" : "truncate"}>{label}</span>` (or `aria-label={label}` when collapsed) plus an accessible tooltip on hover AND `:focus-visible`. |
| **N-04** | **P2** | `src/components/layout/app-shell.tsx:397, 728` | Active nav link indicator relies on background/text color tint only without a 3:1 non-color indicator (`navbar` guide & Forced Colors Mode). | Add a 3px `border-l-[3px] border-primary` (desktop sidebar) and top `border-t-2 border-primary` + bolder text/filled icon indicator (mobile bottom bar) that survives Forced Colors Mode. |
| **N-05** | **P2** | `src/components/layout/app-shell.tsx:555, 716` | Topbar search uses `<form role="search">` instead of HTML5 `<search>` (`html` guide). Mobile nav sets `aria-label="Mobile navigation"` on `<nav>`, which screen readers announce redundantly as `"Mobile navigation navigation"`. | Wrap topbar search form in `<search>`; change `<nav aria-label={t("nav.mobileNav")}>` to `"Chính"` / `"Primary"` (omitting the word `"navigation"`). |
| **N-06** | **P2** | `src/components/layout/app-shell.tsx:516-540, 718` | App shell uses `min-h-screen` instead of `min-h-dvh`; mobile bottom bar does not add `pb-[env(safe-area-inset-bottom)]` for iOS home indicator; mobile `<main>` bottom clearance (`pb-20`) is tight against safe-area devices. | Switch to `min-h-dvh`, apply `pb-[max(0.5rem,env(safe-area-inset-bottom))]` on mobile bottom bar, and set `pb-[calc(5.5rem+env(safe-area-inset-bottom))]` on mobile `<main>`. |
| **N-07** | **P2** | `src/components/layout/settings-view.tsx:351, 478, 488` | Daily goal number input snaps to `|| 1` when user backspaces to clear it; password eye toggles are `24×24px` (`<44px` touch); `"Save changes"` / `"Change password"` disable submit buttons (`disabled={!dirty || ...}`) preventing users from seeing validation feedback on click. | Hold string draft state for numeric inputs and validate on blur/submit; increase eye-toggle touch target to `min-h-11 min-w-11` (`44×44px`) on coarse pointers; keep submit buttons enabled (disable only during `isPending`) and show inline validation/status. |
| **N-08** | **P2** | `src/components/layout/profile-view.tsx:351`, `theme-toggle.tsx:66-88` | `profile-view.tsx` disables Save button when form seems unchanged/invalid; `theme-toggle.tsx` dropdown items do not expose `aria-checked` or a visible active checkmark icon (relying on tint alone). | Keep Save clickable with inline feedback; render `<Check />` icon + `role="menuitemradio"` / `aria-checked={theme === option.value}` in `ThemeToggle`. |
| **N-09** | **P3** | `src/components/layout/landing-page.tsx:162, 236-340` | Hero `<h1>` is wrapped in `<FadeIn>` (`opacity: 0` on initial SSR paint -> LCP penalty). Footer/feature sections are clean and calm, though adding a concise preview of V2.0 Multi-Subject Exam Builder will keep landing copy aligned with V2.0. | Render hero text visibly on SSR (`opacity: 1`), keep subtle interaction motion on CTAs/cards only. |

---

### 2.3 Authentication & Public Share Redemption

| ID | Sev | File:Line | Issue | Concrete Fix |
| --- | --- | --- | --- | --- |
| **A-01** | **P1** | `src/components/auth/login-form.tsx:147`, `register-form.tsx:190`, `forgot-password-form.tsx:96`, `reset-password-form.tsx:101`, `src/components/social/share-redeem-view.tsx:118,155,181` | **Zero `<h1>` elements** on all 5 public auth and share pages because `CardTitle` renders a `<div>` (`card.tsx:30-38`). Violates WCAG 1.3.1 / `accessibility` guide. | Add an `as?: "h1" \| "h2" \| "h3" \| "div"` prop to `CardTitle` (or render `<h1 className="...">` explicitly) on every auth/share page. |
| **A-02** | **P1** | `src/components/auth/register-form.tsx:58,73` vs `248-249,281-282` | **Validation contradicts UI copy:** Helper text and error copy promise letters, numbers, `.`, `_`, and `-`, yet regex `/^[a-z0-9_]{3,30}$/i` rejects `.` and `-`, trapping users who follow instructions. | Align regex and backend schema (`src/lib/validation/auth.ts`) with copy (either allow `[a-z0-9._-]` or update copy strictly to letters, numbers, and underscores `_`). |
| **A-03** | **P2** | `src/components/auth/login-form.tsx:238`, `register-form.tsx:365`, `reset-password-form.tsx:162` | Password visibility toggle buttons have `p-1` around a `16px` icon (`24×24px`), below `44×44px` touch target minimum on mobile (`form-factor-adaptation`). | Size toggle button to `h-10 w-10 max-sm:h-11 max-sm:w-11` (`>=44px` on touch) positioned at `right-1`, with `pr-12` on the input. |
| **A-04** | **P2** | `src/components/auth/forgot-password-form.tsx:66-76`, `reset-password-form.tsx:66-78`, `login-form.tsx:90-120` | Forgot-password & reset-password forms do not move focus to the first invalid input on failed submit; `aria-invalid` is omitted when valid instead of explicitly `aria-invalid={hasError ? "true" : "false"}` (`accessible-error-announcement` guide). | Focus the first errored field on submit; set `aria-invalid={Boolean(error)}` explicitly and associate error `<p role="alert">` via `aria-describedby`. |
| **A-05** | **P3** | `src/components/auth/login-form.tsx:218`, `register-form.tsx:346` | Ensure `form` has explicit `method="post"` fallback semantics, `autoComplete="username"` / `"current-password"` / `"new-password"`, and `inputMode="email"` + `spellCheck={false}` + `autoCapitalize="none"` on email/username inputs (`autofill-sign-in-form`). | Audit and add `spellCheck={false}` and `autoCapitalize="none"` on email & username fields across auth forms. |

---

### 2.4 Library, Folders, Study Set Hub & Question Editor

| ID | Sev | File:Line | Issue | Concrete Fix |
| --- | --- | --- | --- | --- |
| **L-01** | **P1** | `src/components/editor/question-editor-view.tsx:751-759` | Clicking the Trash icon on any question **immediately and permanently deletes it** with zero confirmation dialog and zero undo toast. One misclick destroys curated academic questions. | Require a confirmation `<Dialog>` (with focus on **Cancel** per `dialog` guide) or soft-delete with a 6-second Undo toast before committing deletion. |
| **L-02** | **P2** | `src/components/library/library-view.tsx:115, 130-150` | `useState(urlCreate === "folder")` fails to open the New Folder dialog when navigating from `/library` to `/library?create=folder` (component stays mounted). Hardcoded `limit=100` silently drops sets beyond 100 with no pagination. `sortBy` and `showArchived` are not synced to URL params. | Sync folder modal state via `useEffect` on `searchParams` (and clear param on close); add cursor/page pagination or Load More when `total > items.length`; sync `sort`/`archived` to URL. |
| **L-03** | **P2** | `src/components/library/study-set-hub.tsx:382` | Disabled study-mode `<Link>` elements set `aria-disabled="true"` and `pointer-events-none`, which **still allows keyboard Tab + Enter activation** into an empty mode. | Render a `<button type="button" disabled>` (or non-interactive `<div>` with explanation tooltip/text) instead of `<Link>` when `questionCount === 0`. |
| **L-04** | **P2** | `src/components/library/study-set-hub.tsx:585`, `src/components/editor/question-editor-view.tsx:736` | Raw English enum keys (`multiple_choice`, `multi_select`, `true_false`, `easy`, `medium`, `hard`) are rendered verbatim in Vietnamese UI. | Route all question type & difficulty badges through `i18n` helper `t("questionType." + q.question_type)` and `t("difficulty." + q.difficulty)`. |
| **L-05** | **P2** | `src/components/library/create-set-form.tsx:264,278`, `question-editor-view.tsx:915,926` | Numeric inputs (`default_exam_minutes`, `pass_score_percent`, `sort_order`, `points`) immediately snap to fallback values when cleared, making typing a new number frustrating. | Store draft string while editing; parse/clamp cleanly on blur and submit. |
| **L-06** | **P2** | `src/components/editor/question-editor-view.tsx:660-780` | Question list renders all questions in the DOM without virtualization or pagination. Editing a 500–2,000Q imported set causes heavy layout jank and scroll sluggishness. | Virtualize the question bank list via `@tanstack/react-virtual` (or paginate 50/page + instant search/chapter/type filter bar + batch select for bulk chapter/tag/delete). |
| **L-07** | **P3** | `src/components/library/folder-detail-view.tsx:165-190` | Folder page shows contained sets but offers no 1-click **"Thi thử cả thư mục (Mock Exam this Folder)"** button — a key academic workflow in V2.0. | Add primary action `<Link href={"/exams/new?folderId=" + folder.id}>Thi thử thư mục này</Link>` in `PageHeader`. |

---

### 2.5 Bulk Import Wizard

| ID | Sev | File:Line | Issue | Concrete Fix |
| --- | --- | --- | --- | --- |
| **I-01** | **P1** | `src/components/import/StepFormatAndRules.tsx:4, 475` | Imports and renders the **`<Sparkles />` icon**, explicitly banned by `docs/DESIGN_SYSTEM.md` ("NO Sparkles AI icon"). | Replace `<Sparkles />` with `<SlidersHorizontal />` or `<ScanText />` from `lucide-react`. |
| **I-02** | **P1** | `src/components/import/ImportWizard.tsx:405-437, 533-654` | **Redundant 2-step preview & broken stepper a11y:** Steps 4 (`Preview`) and 5 (`Review & Fix`) render the exact same `VirtualizedPreviewList` twice (read-only then editable), adding wasted friction. The step indicator lacks `aria-current="step"`, hides step labels on `<sm` leaving unlabeled number buttons (`"1"`, `"2"`), and does not move focus to the new step heading on step transitions (`forms` guide). | Merge Steps 4 & 5 into a single **"Preview & Inline Fix"** step (6 steps -> **5 crisp steps**: Source -> Rules -> Parse -> Preview & Inline Fix -> Import Options & Commit). Add `aria-current="step"`, `sr-only` labels on mobile, and focus the new step `<h2>` (`tabIndex={-1}`) on transition. |
| **I-03** | **P1** | `src/components/import/StepImportOptionsAndCommit.tsx:95-115, 334-345` | Selecting **"Replace Entire Set"** deletes the entire existing question bank on Commit without an explicit confirmation dialog. | When `importMode === "replace"`, require a dedicated confirmation modal displaying exact current question count to be permanently deleted, with autofocus on **Cancel**. |
| **I-04** | **P2** | `src/components/import/VirtualizedPreviewList.tsx:212, 327` | Filter buttons use `role="tablist"` without Left/Right Arrow keyboard navigation (`tabs` guide). Raw enum values (`q.question_type`, `q.detection_method`) leak untranslated. | Use a native button toolbar (`role="toolbar"` + `aria-pressed`) for status filters (`All`, `Valid`, `Warnings`, `Errors`, `Duplicates`) or implement roving tabindex. Localize all type/detection badges. |
| **I-05** | **P2** | `src/components/import/StepImportOptionsAndCommit.tsx:79,120`, `StepSourceInput.tsx`, `VirtualizedPreviewList.tsx` | Multiple import components hardcode raw Tailwind palette classes (`bg-emerald-50`, `text-amber-700`, `border-blue-200`) instead of semantic CSS tokens (`--success-subtle`, `--warning-subtle`, `--accent`), breaking Dark Mode token consistency. Mode cards lack `role="radio"`/`aria-pressed`; labels use ALL-CAPS tracked micro-text. | Replace raw color utilities with semantic tokens (`bg-success-subtle text-success-subtle-foreground`, etc.). Use proper `radiogroup`/`radio` semantics for mode selection and sentence-case labels. |
| **I-06** | **P3** | `src/components/import/ImportWizard.tsx:375` | Adds its own `px-4 py-6` container padding inside `AppShell`'s already-padded `<main>`, creating double horizontal gutters on mobile (`32px` lost per side). | Remove duplicate outer padding when mounted inside `AppShell`. |

---

### 2.6 Learning Modes (Flashcards, Practice, Learn, Write, Match, Review, Starred)

| ID | Sev | File:Line | Issue | Concrete Fix |
| --- | --- | --- | --- | --- |
| **LM-01** | **P1** | `src/components/learning/FlashcardsClient.tsx:834-843, 883-958` | **Screen reader erasure + content clipping:** `<button aria-label="Flip to reveal back">` wraps the entire flashcard content, overriding the accessible text of the question/answer so screen readers cannot read the card! Meanwhile `absolute inset-0` faces inside fixed `min-h-[300px]` clip tall multi-line explanations/code blocks. | Decouple the card text region from the flip button (or use a non-overriding layout where card content sits in a readable region with an explicit "Lật thẻ / Flip (Space)" button + click-to-flip handler that respects text selection), and use CSS Grid single-cell stacking (`grid-area: 1 / 1`) so height grows naturally with the tallest face without clipping. |
| **LM-02** | **P1** | `src/components/learning/PracticeClient.tsx:629-669` | Practice question navigator renders **all tiles unvirtualized** (DOM lag on 500–1000Q sets) AND distinguishes Correct / Wrong / Unanswered tiles by **color alone** (no checkmark/X/dot icon, violating WCAG 1.4.1). | Virtualize navigator when `questions.length > 100` (reuse upgraded `ExamNavigatorGrid` primitive) and add crisp micro-icons (`Check`, `X`, `Flag`) or `sr-only` status labels + distinct border patterns on tiles. |
| **LM-03** | **P1** | `src/components/learning/ReviewMistakesClient.tsx:190-193, 224-245`, `StarredQuestionsClient.tsx:112-115, 134-149` | When user selects **"All study sets"** and clicks Practice or Test, the CTA silently launches **only `items[0].study_set_id`**, silently dropping all mistakes/starred items from every other subject! | Wire multi-subject Practice to V2.0 `/api/practice/questions` (custom subset across all selected sets) and Test CTA to `/exams/new?policy=mistakes_only` (or `starred_only`) pre-populated with all affected study sets. |
| **LM-04** | **P2** | `src/components/learning/FlashcardsClient.tsx:402-414` | Keyboard rating binds `1=Again, 2=Good, 3=Hard, 4=Easy` — inverting standard SM-2 ascending difficulty order (`1=Again, 2=Hard, 3=Good, 4=Easy`). Also omits `Enter` flip and touch swipe gestures (Left=Again, Right=Good) with visible hint. | Align keyboard order with visual buttons (`1=Again, 2=Hard, 3=Good, 4=Easy`), support `Space`/`Enter` flip when card is focused, and add optional horizontal pointer swipe (disabled under reduced motion, always paired with tap buttons). |
| **LM-05** | **P2** | `src/components/learning/WriteClient.tsx:625, 642` | `<Textarea>` is set `disabled={checked}` after submitting an answer, which destroys focus and makes the `Enter`-to-advance handler on the textarea unreachable dead code. Also check `e.isComposing || e.keyCode === 229` for Vietnamese Telex/VNI IME safety (`ime-safe-enter-submit` guide). | Keep `<Textarea readOnly={checked}>` (or move focus cleanly to the "Câu tiếp theo / Next" button on submit) and guard `Enter` submit with `if (e.nativeEvent.isComposing || e.keyCode === 229) return;`. |
| **LM-06** | **P2** | `src/components/learning/PracticeClient.tsx:543`, `LearnClient.tsx:415` | Global `keydown` listener captures `Enter` and `Space` even when keyboard focus is currently on an interactive `<button>` (e.g., Star, Back, Reset), hijacking native button activation. | Skip global `Enter`/`Space` handling whenever `document.activeElement` is a `<button>`, `<a>`, `<input>`, `<textarea>`, `<select>`, or `[role="button"]`. |
| **LM-07** | **P2** | `src/components/learning/MatchClient.tsx:190, 449` | `ArrowUp`/`ArrowDown` keyboard math assumes a fixed column count that mismatches responsive CSS grid columns (`grid-cols-2 sm:grid-cols-3 lg:grid-cols-4`), causing erratic vertical focus jumps. `line-clamp-4` truncates long terms with no way to read full text on touch (`single-line-overflow` guide). | Derive grid columns dynamically via container width / computed `gridTemplateColumns` and add a tap/long-press or info popover to inspect truncated long definitions. |
| **LM-08** | **P2** | `src/components/learning/PracticeClient.tsx:832` | Custom question count input snaps immediately to fallback on clear; Practice lacks multi-subject, chapter, mistake, and unseen subset selectors. | Replace with the V2.0 **Custom Subset Practice Launcher** (Section 4.8) supporting arbitrary counts (`20/50/100/250/custom`), multi-subject, chapter, mistake, and unseen filters. |
| **LM-09** | **P3** | `src/components/learning/ReviewMistakesClient.tsx:150`, `StarredQuestionsClient.tsx:96, 308` | Double outer `px-4 py-6` padding inside `AppShell`; raw `mastery_level` enum rendered untranslated in `StarredQuestionsClient:308`. | Remove redundant container padding; localize `mastery_level` via `t("mastery." + level)`. |

---

### 2.7 Exam Setup, Live Exam Runner, Navigator & Exam Results

| ID | Sev | File:Line | Issue | Concrete Fix |
| --- | --- | --- | --- | --- |
| **E-01** | **P1** | `src/components/exam/TestHubClient.tsx:226-227, 487-506` | **"All" question count uses fake formula `bundle.questions.length + extraSetIds.length * 100`** instead of querying real deduplicated counts. Lacks Folder picker, 5 Allocation Strategies, 8 Selection Policies, Full Coverage Cycle, Exam Presets, and live seconds/question pacing. | Supersede with the **V2.0 Universal Custom Exam Builder (`/exams/new`)** powered by `POST /api/exams/eligible` & `POST /api/exams/preview` (Section 4.2–4.6), and let `/sets/[id]/test` either render the shared builder pre-seeded with `setId` or deep-link seamlessly. |
| **E-02** | **P1** | `src/components/exam/ExamNavigatorGrid.tsx:49, 101, 126, 161` | **250–500Q Navigator defects:** (a) `estimateSize: () => 44` vs actual `h-10` (40px) + `pb-1.5` (6px) = `46px` causes `2px/row` drift (`~200px` bottom clipping at 500Q); (b) zero filters (Unanswered / Marked / Answered / Subject); (c) no `scrollToIndex` auto-scroll when active question changes via keyboard/Next; (d) tiles are `40px` (`<44px` touch target); (e) 3-col legend uses `text-[11px]` and truncates Vietnamese labels in 280px rail; (f) `div[aria-label]` lacks `role="navigation"`. | Fix exact row height (`48px` = `44px` tile + `4px` gap on touch; `44px` = `40px` + `4px` on fine pointer), pass `measureElement`, auto-scroll active row into view, add instant filter pills (`Tất cả / Chưa làm / Đánh dấu / Môn học`), wrap legend cleanly in flex-wrap `12px`, and use `<nav aria-label="...">`. |
| **E-03** | **P1** | `src/components/exam/LiveExamRunner.tsx:463, 476, 552, 568, 820` | **Live Exam Runner interaction gaps:** (a) missing `M`/`m` keyboard shortcut to Mark/Flag (only `F` works); (b) `keydown` listener does not guard `navSheetOpen`, letting `A/B/C/D`/`←/→` mutate answers behind the open mobile navigator drawer; (c) `<FocusModeShell>` omits `onBeforeBack`, so clicking Back discards un-flushed debounced answers without confirmation; (d) autosave indicator is `hidden sm:inline-flex` (invisible on mobile!) and `syncState === "error"` offers no **Retry** button; (e) Prev/Next action bar is scrolled off-screen on mobile; (f) no toggle to show/hide subject name in mixed exams. | Bind both `M` and `F` to Mark; disable shortcuts whenever `navSheetOpen` or `submitModalOpen` or `exitModalOpen` is true; add exit confirmation dialog that flushes pending autosave queue (`client_seq`); surface compact autosave pill (`Đang lưu / Đã lưu / Lỗi + Thử lại`) on **all viewports**; add sticky mobile bottom exam bar (`Trước · Đánh dấu · Bảng câu · Tiếp/Nộp`); respect `show_subject_names` / `show_chapter_names` badges. |
| **E-04** | **P1** | `src/components/exam/ExamResultsClient.tsx:298, 426, 459` | **500Q Results crash/UX risks:** (a) renders ALL up to 500 full review cards in the DOM at once (severe INP/memory jank); (b) `"Luyện lại câu sai"` packs up to 100 UUIDs into `?questionIds=...` (`~3,700` chars -> URL truncation & drops mistakes beyond 100); (c) lacks **Subject-by-Subject** and **Tag** accuracy breakdowns needed for multi-subject V2.0 exams; (d) filter `<TabsList>` wraps onto 2 rows on mobile (violates `tabs` guide). | Virtualize the review list with `@tanstack/react-virtual` (or apply `content-visibility: auto; contain-intrinsic-size: auto none auto 280px` + 50-item incremental window); launch mistake drill via `POST /api/practice/questions` or `/exams/new?sourceAttemptId=...&policy=mistakes_only` (zero huge URLs); add Subject & Tag accuracy tables; make filter `<TabsList>` single-row horizontal scroll. |
| **E-05** | **P2** | `src/components/exam/TestHubClient.tsx:390,436,600` | Number inputs (`questionCount`, `durationMinutes`, `passScore`) snap to defaults on backspace; no live average pacing (`~43 giây/câu`). | Use string draft inputs + clamp on blur, and display live pacing calculation next to Duration. |

---

### 2.8 Analytics, History & Social

| ID | Sev | File:Line | Issue | Concrete Fix |
| --- | --- | --- | --- | --- |
| **AN-01** | **P1** | `src/components/analytics/history-view.tsx:206-210, 268`, `dashboard-view.tsx:499-501` | Multi-subject exam attempts (`study_set_id === null`) render dead `"—"` cells in History and loop back to `/history` from Dashboard instead of opening the attempt or its results! | Route all exam attempts cleanly via `/exams/[attemptId]` (when `in_progress` -> Resume) and `/exams/[attemptId]/results` (when `submitted`/`timed_out` -> View Results), showing subject chips (`3 môn học` / `"Giải tích + 2 môn"`). |
| **AN-02** | **P1** | `src/components/social/share-dialog.tsx:382, 488`, `friends-view.tsx:382` | Revoking share links, removing collaborators, and unfriending execute **immediately on 1 click** with zero confirmation dialog. Furthermore, repeated row buttons share identical `aria-label` values (violates WCAG 2.4.4 / `accessibility` guide). | Add confirmation modal (autofocus on Cancel) before revoke/remove/unfriend; disambiguate every row button's accessible name (e.g., `aria-label={"Thu hồi liên kết " + link.code}`, `aria-label={"Hủy kết bạn với " + friend.display_name}`). |
| **AN-03** | **P2** | `src/components/analytics/activity-charts.tsx:46, 169` | Sets `aria-label` on plain `<div>` containers (invalid ARIA on generic container); 2-series `AreaChart` (Questions vs Accuracy) omits a visible `<Legend />`; no accessible tabular view/summary for screen-reader users. | Wrap charts in `<figure>` with `<figcaption>`, add visible Recharts `<Legend />`, and include an `sr-only` summary table (or toggleable "Xem dạng bảng" button). |
| **AN-04** | **P2** | `src/components/analytics/history-view.tsx:195-290`, `statistics-view.tsx:420-530` | Data tables omit `<caption>`, lack `tabindex="0" role="region" aria-label="..."` on horizontal scroll wrappers (`responsive-table` guide), and `statistics-view.tsx:454,511` accuracy badges differentiate mastery tiers by color alone without icon/text tier cue. | Add `<caption>` (visible or `sr-only`), make scroll wrapper keyboard-scrollable (`tabIndex={0}`), switch to stacked card reflow under `@container (max-width: 40rem)`, and pair accuracy % badges with explicit icons/tier text. |
| **AN-05** | **P3** | `src/components/analytics/dashboard-view.tsx:310-380`, `shared-sets-view.tsx` | Dashboard has no **Quick Mock Exam / Active Coverage Cycle** widget, forcing learners to hunt through Library before starting a daily test. | Add a compact **Active Coverage Cycle & Quick Test** card on Dashboard linking directly to `/exams/new` and the next coverage exam (Section 4.5). |

---

### 2.9 Design System UI Primitives (`src/components/ui/*`)

| ID | Sev | File:Line | Issue | Concrete Fix |
| --- | --- | --- | --- | --- |
| **UI-01** | **P1** | `src/components/ui/button.tsx:18-29`, `input.tsx:11`, `textarea.tsx:11`, `select.tsx:34` | Fixed heights (`h-9` = 36px, `sm: h-8` = 32px, `icon-sm: size-8`) fall below the `44×44px` coarse touch target minimum (`form-factor-adaptation` & `typography` guides). `input.tsx` and `textarea.tsx` use `text-sm` (`14px`) on mobile, triggering iOS Safari viewport zoom (`< 16px`, `forms` guide). | Replace fixed `h-*` with `min-h-10` (40px) desktop / `min-h-11` (44px) on `@media (pointer: coarse)` (or `max-sm:min-h-11`), and set `text-base sm:text-sm` (`>= 16px` on touch/mobile) on `Input`, `Textarea`, and `SelectTrigger`. |
| **UI-02** | **P2** | `src/components/ui/dialog.tsx:66-72`, `sheet.tsx:66-72` | Close (`X`) button is `size-7` (`28×28px`, fails touch minimum) with hardcoded English `<span className="sr-only">Close</span>`, and modal surfaces lack `overscroll-behavior: contain` (`dialog` guide). | Enlarge close button to `min-h-11 min-w-11 sm:min-h-9 sm:min-w-9`, localize sr-only label via `useI18n()` (or prop), and add `overscroll-contain` to dialog/sheet content. |
| **UI-03** | **P2** | `src/components/ui/tabs.tsx:36-62` | `TabsTrigger` marks the active tab solely via `bg-card shadow-xs` (completely stripped in Windows High Contrast / Forced Colors Mode, violating `tabs` guide). `TabsContent` sets `outline-none` without a `:focus-visible` ring. | Add an active bottom indicator via `after:border-b-2 after:border-primary` (border survives Forced Colors Mode) and add `focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2` on `TabsContent`. |
| **UI-04** | **P2** | `src/components/ui/card.tsx:30-38`, `table.tsx:9` | `CardTitle` hardcodes `<div>` (leading to zero-`<h1>` pages). `Table` scroll wrapper lacks `tabIndex={0}` for keyboard horizontal scrolling. | Support polymorphic `as` prop on `CardTitle`; add `tabIndex={0}` + `focus-visible:ring-2` on `Table` container wrapper. |

---

## 3. Critical Interaction Flow Deep-Dives

### 3.1 Desktop Collapsible Sidebar & Topbar + Mobile 1-Hand Bottom Navigation
- **Current Defect:** Desktop sidebar lists 12 items, but 4 (`Thư viện`, `Ngân hàng câu hỏi`, `Flashcards`, `Đề thi thử`) all point to `/library` with query hints. Clicking `Đề thi thử` dumps the user back into their Library instead of an Exam Builder. On mobile, the 5-tab bar (`Tổng quan`, `Thư viện`, `Ôn tập`, `Thống kê`, `Thêm`) buries Mock Exams completely, violating 1-hand reachability for the app's primary assessment mode.
- **V2.0 Fix:** Eliminate fake query-alias duplicates, promote **`/exams/new` ("Thi thử")** as a first-class destination in both desktop sidebar (primary group) and mobile 5-tab bottom nav (center thumb slot), fix collapsed icon accessible names (`sr-only` labels + focusable tooltips), and enforce 3:1 non-color active indicators.

### 3.2 Flashcards Flow
- **Current Defects:** Wrapping the card text in `<button aria-label="...">` makes the card unreadable to screen readers; `absolute inset-0` clips long academic content; `2=Good / 3=Hard` breaks SM-2 expectation; `prefers-reduced-motion` still tries to rely on CSS wildcard override instead of clean cross-fade.
- **V2.0 Fix:**
  - Use a CSS Grid overlay (`grid-cols-1 grid-rows-1`) where front and back occupy `[grid-area:1/1]` so the card automatically adopts the height of its taller face (`min-h-[280px]`, no overflow clipping).
  - Keep card prose inside an accessible `<article aria-live="polite">` (NOT inside the flip `<button>`'s `aria-label` override); place a full-width subtle click surface or dedicated footer action (`Lật thẻ · Space`) with full text selection support.
  - Flip animation: 280ms `rotateY(180deg)` with `perspective: 1200px` and `backface-visibility: hidden` normally; instant `opacity` 150ms cross-fade when `prefers-reduced-motion` or `user_preferences.reduced_motion` is active.
  - Mobile ergonomics: 4 rating buttons (`Lại`, `Khó`, `Tốt`, `Dễ`) arranged in a 2×2 thumb-reachable grid (`min-h-12`) at the bottom, plus optional drag-to-rate with clear directional hint pill.

### 3.3 Practice, Learn, Write & Match Modes
- **Mode Distinction Audit:**
  - **Flashcards:** Active recall + SM-2 interval scheduling.
  - **Practice (Luyện trắc nghiệm):** Instant-feedback MCQ/True-False/Multi-select with explanations, navigator, and **V2.0 Custom Subset Launcher** (20/50/100/250Q, multi-subject, chapters, mistakes, unseen).
  - **Learn (Học sâu):** Mastery-loop progression (questions repeat until answered correctly twice consecutively).
  - **Write (Tự luận / Điền đáp án):** Exact/normalized recall with Vietnamese IME-safe Enter handling (`isComposing || keyCode === 229`) and `"Tôi trả lời đúng (Override)"` option for nuanced phrasing.
  - **Match (Ghép cặp):** Timed term-definition grid with responsive arrow-key navigation and full-text reveal popover for truncated cells.
- **Color-Independent Feedback:** Every mode MUST pair semantic color with an icon (`CheckCircle2`, `XCircle`, `AlertCircle`, `Flag`) and text badge (`Đúng` / `Sai` / `Đã đánh dấu`), never color tint alone.

### 3.4 250–500 Question Exam Runner Ergonomics
- **Current State:** Fails cleanly at 250–500Q due to `ExamNavigatorGrid` row-height drift, missing navigator filters, missing auto-scroll, hidden mobile autosave status, missing `M` shortcut, unguarded modal keyboard leaks, and non-sticky mobile navigation controls.
- **V2.0 Target:** Sub-16ms question switching at 500Q, zero scroll drift, instant subject/unanswered/marked filtering inside navigator, persistent sticky mobile controls (`<12%` viewport height), server-anchored countdown timer, monotonic `client_seq` autosave queue with visible Saving/Saved/Offline/Error+Retry states on both desktop and mobile, and clean virtualized 500Q review after submission.

### 3.5 Question Bank & Bulk Import Wizard
- **Current Friction:** Import takes 6 steps where Steps 4 and 5 show the identical preview list; Question Editor renders 500+ rows unvirtualized and deletes questions with 1 unconfirmed click; `<Sparkles />` icon violates brand policy.
- **V2.0 Fix:** Streamline Import to **5 steps** (inline editing right inside Preview with batch error jump `"Câu lỗi tiếp theo"`), enforce confirmation modal for `"Replace Entire Set"` and single/batch question deletion, virtualize large question banks (`>100` rows), and replace raw Tailwind colors + `<Sparkles />` with semantic tokens and calm Lucide icons.

### 3.6 Empty, Loading & Error States Strategy
- **Loading:** Add route-level `loading.tsx` skeletons matching real layout geometry (avoiding layout shift / CLS) with `aria-busy="true"`. Keep above-the-fold page headers SSR-visible.
- **Empty:** Every empty state (`EmptyState`) must state *why* it's empty and give 1 primary + 1 secondary real action (e.g., Empty Library -> `Tạo học phần mới` + `Nhập từ Word/Excel`; Empty Exam History -> `Tạo đề thi thử đầu tiên (/exams/new)`).
- **Error:** Add `error.tsx` & `global-error.tsx` with calm non-technical Vietnamese/English message, **Thử lại / Retry** button (`reset()`), and safe fallback link to `/dashboard`. Never display raw Postgres/JSON stack traces.

---

## 4. StudyHub V2.0 Complete UI/UX Specification

> **Design Philosophy:** Calm academic focus (Linear / Notion / Quizlet / EduQuiz / Apple HIG). Clean 1px hairline dividers (`--border`), crisp typography (`Inter`, `tabular-nums` for all counters/timers/scores), generous whitespace, zero neon, zero heavy gradients, zero fake controls, **zero AI branding**.

---

### 4.1 V2.0 Navigation Architecture (Desktop + Mobile)

#### Desktop Collapsible Sidebar (248px expanded / 68px collapsed)
Replaces the 4 duplicate `/library` links with **9 genuinely distinct, high-utility routes** in 3 calm groups:

| Group | Label (VI / EN) | Route | Icon (`lucide-react`) | Purpose |
| --- | --- | --- | --- | --- |
| **Học tập / Study** | Tổng quan / Dashboard | `/dashboard` | `LayoutDashboard` | Today's goal, active coverage cycle, quick test, recent activity |
| | Thư viện / Library | `/library` | `FolderOpen` | Folders, Study Sets, Question Banks & Bulk Import entry |
| | **Thi thử / Mock Exams** | **`/exams/new`** | **`FileCheck2`** | **Universal Custom Exam Builder, Quick Test, Presets & Coverage Cycles** |
| | Ôn tập & Câu sai / Review | `/review` | `RotateCcw` | Due SM-2 flashcards + Mistake Bank (multi-subject drill) |
| | Đánh dấu sao / Starred | `/starred` | `Star` | Cross-subject starred questions with instant Practice/Exam launch |
| **Tiến độ / Progress** | Lịch sử thi / History | `/history` | `History` | Single- & multi-subject attempt log (Resume in-progress / View results) |
| | Thống kê / Statistics | `/statistics` | `BarChart3` | Accuracy trends, subject mastery heatmap, chapter weakness |
| **Cộng đồng / Social** | Được chia sẻ / Shared | `/shared` | `Share2` | Shared sets + link redemption |
| | Bạn bè / Friends | `/friends` | `Users` | Friends & collaborator directory |
| **Footer** | Hồ sơ / Profile · Cài đặt / Settings | `/profile`, `/settings` | `User`, `Settings` | Account, language, theme, learning defaults |

- **Topbar Primary Action:** Contextual **`+ Tạo đề thi` (`/exams/new`)** + **`+ Học phần` (`/sets/new`)** quick action buttons on desktop, beside `<search>` global search input.
- **Collapsed State Accessibility:** Every icon link renders `<span className="sr-only">{label}</span>` plus a focus-and-hover tooltip (`delay 200ms`).

#### Mobile 1-Hand Bottom Navigation (`<lg`, 5 Tabs, Sticky with Safe Area)
All 5 tabs are `min-h-[52px]` (`>=44px` hit area), single-line `11px`/`12px` labels, active `border-t-2 border-primary` + bolder weight, `pb-[env(safe-area-inset-bottom)]`:

| Slot 1 | Slot 2 | Slot 3 (Primary Center) | Slot 4 | Slot 5 |
| --- | --- | --- | --- | --- |
| **Tổng quan** (`/dashboard`) | **Thư viện** (`/library`) | **Thi thử** (`/exams/new`) | **Ôn tập** (`/review`) | **Thêm** (Sheet: Starred, History, Stats, Shared, Friends, Profile, Settings) |

---

### 4.2 Universal Custom Exam Builder (`/exams/new`)

**URL & Deep-Link Support:**
- `/exams/new` (default blank or last-used preset)
- `/exams/new?setId=<uuid>` (pre-selects one study set — replaces fragmented single-set setup)
- `/exams/new?folderId=<uuid>` (pre-selects all sets in folder)
- `/exams/new?presetId=<uuid>` (hydrates saved preset)
- `/exams/new?tab=presets` | `?tab=coverage` (direct jump to Presets Manager or Full Coverage Cycles)
- `/exams/new?sourceAttemptId=<uuid>&policy=mistakes_only` (safe mistake re-exam from Exam Results without huge `?questionIds=` URLs)

#### Page Architecture (Calm 2-Column Workspace on `>=lg`, Single-Column + Sticky Footer on `<lg`)
- **Top Sub-Navigation Tabs (single-row scrollable):**
  1. `Tạo đề mới / Custom Builder` (default)
  2. `Mẫu đề đã lưu / Exam Presets` (count badge)
  3. `Phủ hết ngân hàng / Full Coverage` (active cycle badge if running)
- **Left Column (`flex-1`, max-w-3xl) — Progressive 4-Block Configuration (no card-inside-card clutter; clean bordered sections separated by 24px spacing):**
  - **Block 0:** **Quick Test Fast-Path Strip** (Section 4.3)
  - **Block 1:** **Nguồn câu hỏi / Question Sources** — Multi-Subject Picker (Folders + Study Sets) + Optional Chapter / Tag / Difficulty / Type accordion filter (Section 4.4)
  - **Block 2:** **Quy mô, Phân bổ & Chính sách chọn câu / Size, Allocation & Selection Policy** — Question count, Duration & Pacing, 5 Allocation Strategies (A–E), 8 Selection Policies (Section 4.4)
  - **Block 3:** **Tùy chọn phòng thi / Exam Room Settings** — Shuffle questions, Shuffle options, Show subject badges, Show chapter badges, Allow free navigation vs Strict linear, Pass score %, Auto-submit on timeout
- **Right Column (`w-[340px] sticky top-[76px]`, Desktop) — Live Blueprint & Readiness Panel:**
  - **Live Deduplicated Pool Counter** (`POST /api/exams/eligible`, debounced 250ms, shows spinner only on delta, never blanks existing numbers):
    - `"Ngân hàng khả dụng: 642 câu (đã khử 18 câu trùng)"`
  - **Live Allocation Preview Table** (`POST /api/exams/preview`):
    - Compact per-subject row: `Subject name` · `Target quota` · `Available` · mini horizontal proportion bar.
    - Explicit calm amber warning banner if `requested > eligible` (e.g., `"Bạn chọn 250 câu nhưng chỉ có 214 câu phù hợp. Đề sẽ tự động lấy tối đa 214 câu."` — zero silent surprises, never blocks unless `eligible === 0`).
  - **Pacing Summary:** `100 câu · 90 phút · ~54 giây/câu` (`tabular-nums`).
  - **Primary CTA:** **`Bắt đầu thi ngay / Start Exam`** (`min-h-11 w-full`, disabled only if `eligible === 0` or `isSubmitting` — clicking with invalid custom sum scrolls/focuses the exact inline error).
  - **Secondary Actions:** **`Lưu làm mẫu đề / Save as Preset`** (opens compact modal for preset name + favorite toggle) and **`Tạo chu kỳ phủ 100% / Start Coverage Cycle`** (when policy = Full Coverage or toggle active).
- **Mobile Sticky Bottom Bar (`<lg`, height `<= 72px`, `<12%` viewport):**
  - Left: `100 câu · 90p · Pool 642` (tapping expands Blueprint Drawer).
  - Right: Primary **`Bắt đầu thi`** button (`min-h-11`).

---

### 4.3 Quick Test Fast-Path (1-Click / 2-Tap Instant Exam)

Positioned cleanly at the top of `/exams/new` (and mirrored as a compact horizontal row on `/dashboard`) so students who just want to start testing in 3 seconds don't have to touch 15 controls:

- **Scope Pill Selector** (inline above strip): `Tất cả học phần` (default) | `Học phần gần đây` | `Chọn nhanh môn...`
- **6 Deterministic Quick-Start Presets** (single horizontal scrollable row on mobile, 3×2 or 6-pill grid on desktop, crisp `1px` border, zero gaudy gradients):
  1. **Nhanh 20 câu** · `15 phút` · Ngẫu nhiên (`45s/câu`)
  2. **Chuẩn 50 câu** · `45 phút` · Cân bằng môn (`54s/câu`)
  3. **Thi thử 100 câu** · `90 phút` · Tỷ lệ theo môn (`54s/câu`)
  4. **Tổng ôn 250 câu** · `180 phút` · Phủ câu chưa làm (`43s/câu`)
  5. **Ôn câu hay sai** · `Tối đa 40 câu` · Không giới hạn giờ · `mistakes_only`
  6. **Câu chưa từng làm** · `50 câu` · `45 phút` · `unanswered_only`
- **Interaction:** Clicking a preset immediately populates the Builder AND offers a 1-click **"Thi ngay"** trigger (or clicking the pill's play icon launches directly after a 1-step readiness check if eligible > 0; if eligible == 0, focuses an inline calm explanation with CTA to broaden scope).

---

### 4.4 Multi-Subject Picker, 5 Allocation Strategies & 8 Selection Policies UI

#### A. Multi-Subject Picker (Folders + Study Sets with Live Deduplication)
- **Search & Filter Input:** Instant filter by folder or set title (`<search>` landmark).
- **Two Clean Sections inside a bounded scrollable container (`max-h-[340px]`, keyboard scrollable):**
  1. **Thư mục / Folders** (checkboxes with expandable chevron to inspect member sets, showing e.g. `Kinh tế vi mô (4 học phần · 420 câu)`).
  2. **Học phần lẻ / Individual Study Sets** (checkboxes with question count badge and last accuracy pill).
- **Deduplication Clarity:** If a user checks Folder A AND also checks Set 2 inside Folder A (or two sets sharing deduplicated stems/IDs), Set 2 displays a subtle neutral badge **`Đã bao gồm qua thư mục`** (checkbox shown indeterminate/included, never double-counted), and the summary shows exact unique count (`420 câu duy nhất`).
- **Selected Subject Chips Bar:** Horizontally wrapped removable chips (`<button aria-label="Bỏ chọn Giải tích 1">`) + quick actions `Chọn tất cả` / `Bỏ chọn hết`.
- **Collapsible Fine Filters (`<details>` / Disclosure):** Filter by Chapters (grouped by selected subject), Tags, Question Type (`Trắc nghiệm 1 đáp án`, `Nhiều đáp án`, `Đúng/Sai`, `Điền đáp án`), and Difficulty (`Dễ`, `Trung bình`, `Khó`). Shows active filter count badge when collapsed.

#### B. Question Count & Duration Controls
- **Question Count (`target_question_count`):**
  - Quick chips: `10`, `20`, `30`, `50`, `100`, `150`, `250`, `500`, `Tất cả (max eligible)`.
  - Numeric input (`type="text" inputMode="numeric"`, string draft state so backspace works naturally, accepts any positive integer `1..2000`, clamped to eligible pool on launch with clear notice).
- **Duration (`duration_minutes`):**
  - Toggle: `Giới hạn thời gian` vs `Không giới hạn` (`null`).
  - Quick chips: `15p`, `30p`, `45p`, `60p`, `90p`, `120p`, `180p` + custom numeric input.
  - **Live Pacing Indicator:** `~54 giây / câu` (or `Không giới hạn thời gian`), updated live with `tabular-nums`.

#### C. 5 Multi-Subject Allocation Strategies UI (Visible whenever `>= 2` Study Sets selected; clean segmented radio cards with `role="radiogroup"`)

| Key | Strategy Label (VI / EN) | Concise Helper Subtitle | Dynamic Sub-UI When Selected |
| --- | --- | --- | --- |
| **A** | **Chia đều / Equal** | Mỗi môn số câu gần bằng nhau (phần dư bù cho môn còn ngân hàng). | Read-only live quota preview badges per subject (e.g., `34 / 33 / 33`). |
| **B** | **Theo tỷ lệ / Proportional** | Môn nhiều câu hỏi hơn sẽ chiếm tỷ trọng cao hơn. | Shows `%` weight + exact preview count per subject. |
| **C** | **Tự nhập từng môn / Custom Quotas** | Tự quyết định chính xác số câu cho từng học phần. | **Inline Quota Table:** Each selected subject gets a `−` / numeric input / `+` stepper + `Max: {eligible}` label + `"Điền tự động"` quick-fill button. Live sum bar at bottom: `Đã phân bổ: 95 / 100 câu` (Green check when `== target`, Amber warning `"Còn thiếu 5 câu"` or Red error `"Vượt quá 10 câu"` with 1-click **"Tự động khớp tổng"** button). |
| **D** | **Ưu tiên môn yếu / Weakest-First** | Dồn nhiều câu hơn cho các môn có độ chính xác thấp nhất. | Shows each subject's current accuracy `%` + computed higher weight badge. |
| **E** | **Ưu tiên môn chưa làm / Unseen-First** | Dồn nhiều câu hơn cho các môn còn nhiều câu chưa làm. | Shows each subject's unseen count (`120 chưa làm`) + computed quota. |

#### D. 8 Question Selection Policies UI (Clean 2-Column Radio Grid, Single Selection)

| Policy Key | Label (VI / EN) | One-Line Explanation |
| --- | --- | --- |
| `random` | Ngẫu nhiên / Random | Lấy ngẫu nhiên đồng đều từ ngân hàng khả dụng. |
| `unseen_first` | Ưu tiên câu chưa làm / Unseen First | Lấy hết câu chưa từng làm trước, rồi bù thêm câu khác nếu chưa đủ. |
| `unanswered_only` | Chỉ câu chưa làm / Unanswered Only | Chỉ lấy những câu bạn chưa từng trả lời (không lặp câu cũ). |
| `mistakes_first` | Ưu tiên câu hay sai / Mistakes First | Đưa câu từng làm sai lên trước, sau đó bù thêm câu khác. |
| `mistakes_only` | Chỉ câu đã làm sai / Mistakes Only | Chỉ tạo đề từ các câu sai (tuyệt vời để sửa lỗ hổng). |
| `weakest_mastery` | Ưu tiên mức độ yếu / Weakest Mastery | Sắp theo điểm thành thạo thấp nhất (SM-2 / độ chính xác thấp). |
| `starred_only` | Chỉ câu gắn sao / Starred Only | Chỉ lấy những câu bạn đã đánh dấu sao. |
| `full_coverage_next` | Phủ 100% không trùng / Full Coverage Cycle | Chia toàn bộ ngân hàng thành nhiều đề liên tiếp không lặp câu nào. |

- When **`full_coverage_next`** is selected, a compact inline panel appears:
  - Shows `"Tổng ngân hàng: 480 câu → Chia thành 5 đề (4 đề × 100 câu + 1 đề × 80 câu)"` and lets the user name the cycle (e.g., `"Ôn thi cuối kỳ Giải tích + Đại số"`).

---

### 4.5 Full Coverage Cycle Dashboard (`/exams/new?tab=coverage` + `/dashboard` Widget)

Designed so learners tackling 500–2,000+ questions across 1 or multiple subjects can conquer 100% of their bank across sequential non-overlapping exams without losing track.

#### Cycle Card / Detail Layout
1. **Header:** Cycle title, source subject chips, status pill (`Đang thực hiện / Active` · `Hoàn thành 100% / Completed`).
2. **Tri-State Segmented Progress Bar (`tabular-nums`, color + pattern/legend — never color alone):**
   - **Đã hoàn thành (Completed — submitted exams):** Solid Indigo (`--primary`) + Check icon — e.g., `200 / 500 câu (40%)`
   - **Đang thi dở (In-Progress — assigned in active attempt):** Hatched/soft Amber (`--warning-subtle` with border) + Clock icon — e.g., `100 câu (Đề #3)`
   - **Chưa thi (Remaining pool):** Neutral Slate (`--muted`) — e.g., `200 câu (còn ~2 đề)`
3. **Explicit Active / Abandoned Attempt Banner (CRITICAL Integrity UX):**
   - Whenever a cycle has an `in_progress` attempt (`coverage_cycle_attempts` not yet submitted):
     - Renders a prominent calm Amber alert banner: **"Đề #3 (100 câu) đang tạm dừng — đã trả lời 34/100 câu."**
     - Action 1 (Primary): **`Tiếp tục làm Đề #3`** -> `/exams/[attemptId]`
     - Action 2 (Destructive-outline, opens confirmation modal): **`Hủy đề này & trả 100 câu về ngân hàng`** — clearly explains that abandoning returns unassigned/unsubmitted questions to the remaining pool and NEVER fakes completion.
     - While an active attempt exists, **"Tạo đề tiếp theo"** is locked with clear helper copy explaining why (preventing accidental pool leakage).
4. **Per-Subject Coverage Breakdown:** Compact table/bars showing each subject's `Completed / Total` inside the cycle.
5. **Attempt History List within Cycle:** `Đề #1 (84% · 100 câu · Xem kết quả)`, `Đề #2 (78% · 100 câu · Xem kết quả)`, etc.
6. **Footer Actions:**
   - Primary: **`Tạo đề tiếp theo — Đề #4 (100 câu)`** (or final remainder `"Đề #5 (80 câu cuối)"`).
   - When 100% completed: Celebration calm summary (`500/500 câu · Điểm TB 82%`) + **`Bắt đầu chu kỳ mới (Xáo trộn lại)`** + **`Thi lại các câu sai trong chu kỳ`**.
   - Secondary: **`Đặt lại chu kỳ`** (opens confirmation dialog, autofocus Cancel).

---

### 4.6 Exam Presets Manager (`/exams/new?tab=presets`)

- **Core Contract Notice (subtle helper text):** *"Mẫu đề chỉ lưu cấu hình (môn học, tỷ lệ phân bổ, số câu, thời gian, chính sách chọn). Mỗi lần bấm Thi ngay sẽ tự động tạo bộ câu hỏi mới theo cấu hình đó."*
- **Layout:** Clean responsive grid (`1 col` mobile, `2 cols` desktop) — each preset card keeps max 4 visual data points (no card bloat):
  1. **Header Row:** Favorite star toggle (`aria-pressed`, `44×44px` touch hit area) + Preset Name + Strategy/Policy pill.
  2. **Source Summary:** Up to 3 subject chips + `"+2 môn khác"` overflow pill (tooltip/focus reveals all).
  3. **Specs Line (`tabular-nums`):** `100 câu · 90 phút · Chia đều · Ưu tiên câu chưa làm` + last run timestamp.
  4. **Action Row:**
     - Primary: **`Thi ngay`** (starts fresh exam directly via `POST /api/exams` using preset config).
     - Secondary: **`Mở trong trình tạo`** (hydrates `/exams/new?presetId=...` so user can tweak before starting).
     - Overflow Menu (`MoreHorizontal`, accessible label per preset): `Chỉnh sửa tên`, `Nhân bản`, `Xóa mẫu đề` (confirmation modal with autofocus Cancel).
- **Empty State:** Calm explanation + CTA **`Tạo đề & lưu mẫu đầu tiên`**.

---

### 4.7 Upgraded 250–500Q Exam Runner (`/exams/[attemptId]`) & Mixed-Subject Results (`/exams/[attemptId]/results`)

#### A. Exam Runner Shell (Zero Duplicate Landmarks, `<12%` Sticky Chrome)
- **Single `<main id="main-content">`**, no `AppShell` sidebar/topbar/bottom-nav.
- **Sticky Compact Top Bar (`h-14`, `56px` — 6.6% of 844px mobile viewport):**
  - **Left:** Safe Exit button (`← Thoát`) -> triggers **Exit Confirmation Modal** (`"Bài thi vẫn đang tính giờ. Câu trả lời của bạn đã được lưu. Bạn muốn thoát ra danh sách hay tiếp tục?"`, flushes pending autosave queue before navigating away).
  - **Center:** Progress (`Câu 142 / 250`, `tabular-nums`) + thin 2px top progress bar.
  - **Right:**
    1. **Visible Autosave Status Pill (ALL viewports — icon + short label on desktop, icon + tooltip/tap-popover on mobile):**
       - `saving`: `<Loader2 className="animate-spin" /> Đang lưu…`
       - `saved`: `<Check /> Đã lưu`
       - `offline`: `<WifiOff /> Ngoại tuyến (lưu tạm)` (Amber)
       - `error`: `<AlertTriangle /> Lỗi lưu` + interactive **`Thử lại`** button (Red)
    2. **Server-Anchored Countdown Timer (`tabular-nums`):** Neutral Slate normally -> Amber subtle `< 5m` -> Red subtle `< 1m` + polite `aria-live="polite"` announcement at `5m`, `1m`, and `10s` (never announce every second!).
    3. **Keyboard Help (`?`)** button (desktop) + Primary **`Nộp bài / Submit`** button (`min-h-10`).

#### B. Question Stage (Calm Reading Column, `max-w-3xl mx-auto`)
- **Context Row:** Question number (`Câu 142`), optional **Subject chip** (only when `show_subject_names` is enabled in mixed exams), optional **Chapter chip** (`show_chapter_names`), question type badge (`Chọn 1 đáp án` / `Chọn nhiều đáp án`), and **`Đánh dấu (M)`** toggle button (`aria-pressed={isMarked}`, `min-h-11` on touch).
- **Question Prompt:** Crisp `1.0625rem` (`17px`)–`1.125rem` (`18px`), `leading-relaxed` (`1.65`), `max-w-[68ch]` optimal measure; zoomable image lightbox if `image_url` exists.
- **Options Stack (`A`, `B`, `C`, `D`…):**
  - Full-row interactive buttons/checkboxes (`min-h-[52px]`, `12px` vertical spacing) with distinct letter badge (`A`–`F`), generous padding, clear selected state (`border-2 border-primary bg-primary/8` + solid Indigo badge + `Check` icon for non-color signal).
  - Supports **Right-click / Strikethrough (Eliminate)** option (`Alt+1..4` or subtle strike button) as a calm test-taking aid — optional P3 enhancement.
- **Desktop Footer Controls:** `← Câu trước` | `Đánh dấu (M)` | `Câu tiếp theo →` (or `Xem lại & Nộp bài` on final question).
- **Mobile Sticky Bottom Bar (`<lg`, `h-14` + safe-area):**
  - 4 balanced thumb targets (`min-h-11`): `← Trước` | `Đánh dấu` (amber active) | `Bảng câu (89/250)` (opens Navigator Sheet) | `Tiếp →` (or `Nộp bài`).

#### C. Upgraded Virtualized 250–500Q Exam Navigator (`ExamNavigatorGrid` V2)
- **Container:** `<nav aria-label={t("exam.navigator")}>` inside right desktop rail (`w-[312px]`, collapsible) or mobile `<Sheet side="bottom" className="h-[82dvh] overscroll-contain">`.
- **Sticky Filter Bar Inside Navigator:**
  - 3 single-row status pills with live counts (`tabular-nums`): `Tất cả (250)` · `Chưa làm (108)` · `Đánh dấu (14)`.
  - **Subject Filter `<Select>`** (shown automatically on multi-subject exams): `Tất cả môn học` | `Giải tích (85)` | `Đại số (85)` | `Xác suất (80)`.
  - Quick Jump Input: `"Tới câu #..."` (`inputMode="numeric"`, `Enter` jumps directly to question number).
- **Zero-Drift Virtualized Grid (`@tanstack/react-virtual`):**
  - 5 columns (`grid-cols-5 gap-1.5`), **exact measured row height** (`50px` on coarse touch = `44px` button + `6px` gap; `44px` on desktop = `38px` button + `6px` gap), `overscan: 6`.
  - **Auto-Scroll Effect:** Whenever `currentIndex` changes (keyboard/Prev/Next), call `virtualizer.scrollToIndex(activeRow, { align: "auto" })` so the active tile is always visible in the rail.
  - **Color-Independent Tile States:**
    - Current: `ring-2 ring-primary ring-offset-2 font-semibold`
    - Answered: Solid soft Indigo (`bg-primary/15 border-primary/50`) + tiny bottom-right filled dot
    - Marked / Flagged: Amber border + top-right `<Flag />` micro-icon (`10px`) — visible even when answered!
    - Unanswered: Clean neutral `--card` surface with `1px --input` border
    - Every tile includes full screen-reader label: `"Câu 142, đã trả lời, đã đánh dấu, môn Giải tích"`.

#### D. Complete Keyboard Controls Map (Strictly Guarded Against Modals, Drawers & Inputs)
- **Guard Rule:** Ignore ALL single-key shortcuts when focus is inside `<input>`, `<textarea>`, `<select>`, `[contenteditable]`, OR while `navSheetOpen`, `submitDialogOpen`, `exitDialogOpen`, or `shortcutsDialogOpen` is open.
- **Bindings:**
  - `A`–`F` or `1`–`6`: Select/toggle option 1..6 (mapped to rendered option's stable UUID — never index-graded!).
  - `←` / `→` (and `J` / `K`): Previous / Next question (within active navigator filter or global sequence).
  - `M` or `F`: Toggle Mark / Flag on current question.
  - `G`: Focus "Tới câu #" quick-jump input.
  - `?`: Toggle Keyboard Shortcuts help dialog.
  - `Ctrl/Cmd + Enter`: Open Submit Confirmation Dialog (shows explicit summary: `Đã làm 236/250 · Chưa làm 14 · Đánh dấu 8` with 1-click **"Xem câu chưa làm"** button inside modal before final confirm).

#### E. Mixed-Subject Exam Results (`/exams/[attemptId]/results`)
1. **Top Summary Strip:** Score (`82.4%`, `206 / 250`), Pass/Fail badge (icon + text, never color alone), Time spent (`1g 24p / 1g 30p`), Average pace (`20s/câu`), and Clean Action Buttons:
   - **`Luyện lại 44 câu sai`** (creates practice session via `POST /api/practice/questions` or links `/exams/new?sourceAttemptId=[id]&policy=mistakes_only` — **zero 3,700-char `?questionIds=` URLs**).
   - **`Thi lại cùng cấu hình`** (launches fresh re-sampled exam via `/exams/new?cloneAttemptId=[id]`).
   - If part of a Coverage Cycle: **`Tiếp tục Chu kỳ phủ (Đề #4)`**.
2. **Multi-Subject & Topic Breakdown Section (Visible for 2+ subjects or tagged/chaptered exams):**
   - **Subject Accuracy Table** (accessible `<caption>`, `tabIndex={0}` scroll wrapper, `@container` mobile card reflow): Columns = `Môn học` · `Đúng / Tổng` · `Tỷ lệ %` (progress bar + tier badge with icon) · `Hành động` (`Luyện môn này`).
   - **Chapter & Tag Accuracy Tabs** (single-row `<TabsList>`): Quickly surfaces weakest chapters/tags sorted lowest accuracy first.
3. **Virtualized 500Q Question-by-Question Review:**
   - Single-row scrollable filter bar (`Tất cả 250` · `Sai 44` · `Đúng 206` · `Bỏ qua 0` · `Đã đánh dấu 8`) + **Subject `<Select>` filter** + keyword search.
   - Uses `@tanstack/react-virtual` (with `measureElement` dynamic sizing) OR paged 50-item windows paired with `content-visibility: auto; contain-intrinsic-size: auto none auto 280px` so reviewing 500 questions stays instant and jank-free.
   - Each review item clearly shows: Subject chip, user choice vs correct option (both with `Check` / `X` icons + text tags `"Bạn chọn"` / `"Đáp án đúng"`), deterministic explanation (if authored), and 1-click Star button (`aria-pressed`).

---

### 4.8 Custom Subset Practice Launcher (Outside Exam Mode)

Currently, `PracticeClient` only supports launching a single full set (or crude count input). V2.0 adds a lightweight **Practice Setup Drawer / Modal** accessible from `/sets/[id]/practice`, `/library`, `/review`, and `/starred`:
- **Source:** Current Study Set OR Multi-Subject picker (folders + sets).
- **Subset Size:** `20`, `50`, `100`, `250`, `Tất cả`, or custom number.
- **Filters:** Chapters, Tags, Difficulty, Focus slice (`Tất cả`, `Chỉ câu sai`, `Chỉ câu chưa làm`, `Chỉ câu gắn sao`, `Mức độ yếu nhất`).
- **Session Options:** Reads user's saved `user_preferences` (`default_shuffle_questions`, `default_shuffle_options`, `show_instant_feedback`) as real initial defaults!
- Backed by `POST /api/practice/questions` so even 250-question multi-subject practice sessions never overflow URL length limits.

---

## 5. Modern Web Guidance & `motion/react` Compliance Specification

### `motion/react` Implementation Rules for Wave 2/3
1. **GPU-Composited Properties Only:** Animate `transform` and `opacity` exclusively. Never animate `top`, `height`, `width`, `margin`, or `padding` (fix `.skip-to-content` in `globals.css`).
2. **Duration Discipline:**
   - Micro-interactions (button press, checkbox/option select, badge pop): `120–180ms`, `ease-out`.
   - Dialogs, sheets, popovers: `160–220ms`.
   - Flashcard 3D flip: `260–320ms` (reverts to `150ms` opacity cross-fade under reduced motion).
   - Exam question transitions: `0ms` instant swap (or `<=100ms` subtle opacity) so 250–500Q keyboard navigation feels razor-fast.
3. **True Reduced-Motion Compliance:**
   - Wire `user_preferences.reduced_motion` to `<MotionConfig reducedMotion={prefs.reduced_motion ? "always" : "user"}>`.
   - Delete `* { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important }` from `globals.css`.
4. **Zero LCP Sabotage:** Never mount above-the-fold `<h1>` headings or primary page content at `initial={{ opacity: 0 }}`.

### Modern Web Guidance
- **`accessibility`**: I applied the landmark, heading, naming, and disambiguation rules — `"Use one <main> landmark per page"`, `"Use one <h1> element per page"`, `"Don't put aria-label/aria-labelledby on elements that shouldn't be named: Examples include plain <div>, <span>"`, and `"Disambiguate controls that look visually identical but which perform different actions by their accessible name"` — to catch the nested `<main id="main-content">` in `AppShell`/`FocusModeShell`, zero-`<h1>` auth/share pages, `aria-label` on chart/navigator `<div>`s, and duplicate row action labels.
- **`color`**: I audited all theme tokens and status indicators against `"Maintain a minimum contrast ratio of 3:1 for user interface component boundaries and states (WCAG 1.4.11 Non-text Contrast)"` and `"Don't use color alone to indicate the presence of a user interface component or its state"`, uncovering 9 AA token failures (`--input` at `1.48:1`/`1.71:1`, Dark `--primary` at `4.47:1`, Light `--success` at `3.30:1`) and color-only navigator/accuracy badges.
- **`dark-mode`**: I verified FOUC prevention using `"place a <meta> tag in your <head> to ensure the browser knows which themes you support before it even starts rendering"` and `"Apply the color-scheme property to the html element or the :root pseudo-class"`, flagging `layout.tsx`'s missing `colorScheme: "light dark"` and `globals.css`'s hardcoded `html { color-scheme: light }`.
- **`motion`**: I flagged `globals.css`'s wildcard reduced-motion override against `"DO NOT globally apply animation-duration: 0.01ms; as it can cause certain animations to become more jarring."` and specified `"Keep non-motion transitions (such as color or background-color changes on links and buttons) enabled; only dampen or disable spatial movement, scaling, rotation, or persistent animations."`
- **`typography`**: I audited button/input/badge sizing against `"DON'T use px for font-size. Prefer rem"` and `"DON'T set a fixed height or block-size on elements that contain text, such as buttons, badges, tabs and cards."`
- **`responsive-design`**: I specified dynamic viewport units for app shell and mobile drawers per `"Use dynamic viewport units (dvh, dvw) instead of vh/vw to prevent layout breakage when mobile browser UI elements (like address bars) appear or disappear."`
- **`form-factor-adaptation`**: I audited touch targets and sticky bars against `"Make every control at least 24×24 CSS pixels (WCAG 2.5.8), and at least 44×44 on touch screens"` and `"Set scroll-padding-bottom (or scroll-padding-top for a top bar) on the scroll container to at least the bar's height, including its safe-area padding"`.
- **`forms`**: I audited auth, editor, settings, and multi-step import forms against `"set font: inherit and font-size: max(1rem, 1em) on form controls to scale with larger containers while staying at least 1rem(16px) to prevent iOS zoom"`, `"DON'T disable submit buttons to block validation; let users submit and highlight errors."`, and `"DO move focus to the new step's heading (tabindex='-1') or first input when transitioning between steps dynamically"`.
- **`html`**: I recommended native `<search>` in `app-shell.tsx` and the V2.0 Multi-Subject Picker per `"DO use <search> to enclose search and filtering mechanisms (eliminates the need for role='search')."`
- **`navbar`**: I audited desktop sidebar and mobile bottom nav active indicators against `"Do not indicate the current page with color alone (WCAG 1.4.1). Ensure the color of the visual indicator has a contrast of at least 3:1 with the background color."`
- **`tabs`**: I audited `tabs.tsx`, `ExamResultsClient`, and `VirtualizedPreviewList` against `"Keep tabs on a single row. DO NOT wrap them onto multiple rows"` and `"Draw the underline with a border on a pseudo-element. DO NOT use box-shadow or a background: forced colors mode removes both, leaving no indicator."`
- **`dialog`**: I audited `dialog.tsx`, `sheet.tsx`, and destructive actions against `"dialog:modal { overscroll-behavior: contain; }"` and `"put autofocus on the safe action (such as Cancel or Keep) in a destructive confirmation."`
- **`responsive-table`**: I audited History, Statistics, and V2.0 Subject Accuracy tables against `"Add a tabindex='0' attribute to the container, to ensure that people using only a keyboard can consistently scroll the table."` and `"Use @container queries instead of @media queries."`
- **`defer-rendering-heavy-content`** & **`interactions-in-complex-layouts`**: I specified virtualization + containment for 500Q Exam Results and large Question Banks per `"You MUST pair content-visibility: auto with contain-intrinsic-size. Failure to do so forces the browser to collapse the element to a 0px height when off-screen, causing severe layout shifting"` and `"By applying content-visibility: auto to self-contained layout regions... The page reflow is isolated, preventing a global layout recalculation."`
- **`ime-safe-enter-submit`**: I addressed Vietnamese Telex/VNI IME safety in `WriteClient` per `"Pairing event.isComposing with event.keyCode === 229 reliably catches Safari's out-of-order confirming Enter keydown."`
- **`accessible-error-announcement`**: I audited auth/builder form error states per `"Set aria-invalid='false' until :user-invalid matches, rather than leaving the attribute unset."`
- **`content-first-noise-reduction`**: I constrained sticky Exam Runner and Exam Builder mobile bars per `"Keep every fixed or sticky bar under 12% of the viewport height. Use a single row, and don't stack several sticky bars"`.
- **`single-line-overflow`**: I audited truncated cards/tiles in `MatchClient`, `ExamNavigatorGrid`, and Preset subject chips per `"Reveal on :hover and :focus-visible of the interactive element, never on hover alone... Hover and focus reveal nothing on touch. Give the full text another route"`.


---

## 6. Wave 3 Independent Re-Audit & Verification Report

> **Auditor:** Agent 4 (`uiux-auditor`)  
> **Verification Method:** Independent static code audit of every modified & newly created V2.0 UI component, automated WCAG 2.2 AA relative-luminance computation on live `src/app/globals.css`, App Router boundary & `metadata` scan across all 35 routes, `useUserPreferences()` consumption trace, `<Sparkles />` & raw Tailwind color checks, plus targeted reopen-and-reverify cycle (`#59` -> `#62`, `#67`, `#68`).

### 6.1 Executive Wave 3 Verdict

| Metric | Wave 1 Baseline | Wave 3 Initial Check | Wave 3 Post-Fix Final |
| --- | --- | --- | --- |
| **WCAG 2.2 AA Contrast Pairs (`globals.css`)** | 9 FAIL / 31 | **31 / 31 PASS** | **31 / 31 PASS** |
| **Wave 1 P1 Critical Defects (`24` total)** | 24 Open | 23 Fixed, 1 Reopened (`UI-01`) | **24 / 24 VERIFIED FIXED** |
| **Wave 1 P2 Major Defects (`28` total)** | 28 Open | 23 Fixed, 5 Reopened (`G-05`, `UI-02`, `UI-03`, `UI-04b`, `I-02` focus) | **27 / 28 VERIFIED FIXED**, 1 Partially Verified (P3 polish: `LM-07` truncated-card popover) |
| **Wave 1 P3 Polish Defects (`8` total)** | 8 Open | 8 Addressed | **8 / 8 VERIFIED** (minor polish backlog noted honestly) |
| **New V2.0 Code-Audit Defects Caught in Wave 3** | — | **3 Found & Reopened (`#59`):** 2 P1 (`V2-01` mobile bar buried behind `AppShell` `z-40`, `V2-02` duplicate `<h1>` on `/sets/[id]/test`), 1 P2 (`V2-03` `ExamResultsClient` ARIA) | **3 / 3 VERIFIED FIXED** (`#62`) |
| **Banned `<Sparkles />` Icons (`src/**`)** | 1 (`StepFormatAndRules.tsx`) | **0** | **0** |
| **`useUserPreferences()` Live Consumers** | 0 (`settings-view.tsx` write-only) | **12 files** (Providers, AppShell, Settings, Builder, ExamHub, Practice, CustomPractice, Flashcards, Learn, Write, Match) | **12 files — VERIFIED** |
| **App Router Boundaries (`src/app/`)** | 0 files | 5 files (missing `global-error.tsx`) | **6 / 6 VERIFIED** (`error`, `loading`, `not-found`, `global-error`, `(app)/error`, `(app)/loading`) |
| **Page SSR `metadata` Coverage** | 14 / 28 missing | 9 / 35 missing | **34 / 35 explicit + `/` root default — 100% VERIFIED** |

> **Cross-Agent Live Browser Note:** Independent live-browser testing by `@real-user` (`#66`) identified 1 mobile viewport visual clipping regression on the public landing page header at `360px`/`390px` (`UX-11`, `Sign up / Đăng ký` clipped 11px on the right edge) and 1 P3 reload title sync edge case (`UX-08b`), reopened directly to `@v2-ui-builder` for `@real-user` visual retest on the final production rebuild.

---

### 6.2 Live Computed WCAG 2.2 AA Contrast Verification (`src/app/globals.css`)

Re-computed directly from live `:root` and `.dark` tokens in `src/app/globals.css`:

| Theme | Token Pair | Live Values | Computed Ratio | Requirement | Verdict |
| --- | --- | --- | --- | --- | --- |
| Light | `--foreground` / `--background` | `#0f172a` / `#f8fafc` | **17.06:1** | `>= 4.5:1` | **PASS** |
| Light | `--muted-foreground` / `--card` | `#475569` / `#ffffff` | **7.58:1** | `>= 4.5:1` | **PASS** |
| Light | `--primary` / `--primary-foreground` | `#4f46e5` / `#ffffff` | **6.29:1** | `>= 4.5:1` | **PASS** |
| Light | `--primary-hover` / `--primary-foreground` | `#4338ca` / `#ffffff` | **7.90:1** | `>= 4.5:1` | **PASS** |
| Light | `--accent-solid` / `--accent-solid-foreground` | `#2563eb` / `#ffffff` | **5.17:1** | `>= 4.5:1` | **PASS** |
| Light | `--success` / `--success-foreground` | `#15803d` / `#ffffff` | **5.02:1** | `>= 4.5:1` | **PASS** (was `3.30:1`) |
| Light | `--warning` / `--warning-foreground` | `#b45309` / `#ffffff` | **5.02:1** | `>= 4.5:1` | **PASS** (was `3.19:1`) |
| Light | `--destructive` / `--destructive-foreground` | `#dc2626` / `#ffffff` | **4.83:1** | `>= 4.5:1` | **PASS** |
| Light | `--input` on `--card` (WCAG 1.4.11) | `#64748b` / `#ffffff` | **4.76:1** | `>= 3.0:1` | **PASS** (was `1.48:1`) |
| Dark | `--foreground` / `--background` | `#f8fafc` / `#0b1120` | **18.00:1** | `>= 4.5:1` | **PASS** |
| Dark | `--muted-foreground` / `--card` | `#94a3b8` / `#111827` | **6.92:1** | `>= 4.5:1` | **PASS** |
| Dark | `--primary` / `--primary-foreground` | `#4f46e5` / `#ffffff` | **6.29:1** | `>= 4.5:1` | **PASS** (was `4.47:1`) |
| Dark | `--primary-hover` / `--primary-foreground` | `#4338ca` / `#ffffff` | **7.90:1** | `>= 4.5:1` | **PASS** (was `2.98:1`) |
| Dark | `--sidebar-primary` / `--sidebar-primary-foreground` | `#4f46e5` / `#ffffff` | **6.29:1** | `>= 4.5:1` | **PASS** (was `4.47:1`) |
| Dark | `--accent-solid` / `--accent-solid-foreground` | `#2563eb` / `#ffffff` | **5.17:1** | `>= 4.5:1` | **PASS** (was `3.68:1`) |
| Dark | `--success` / `--success-foreground` | `#22c55e` / `#052e16` | **6.54:1** | `>= 4.5:1` | **PASS** |
| Dark | `--warning` / `--warning-foreground` | `#f59e0b` / `#451a03` | **6.97:1** | `>= 4.5:1` | **PASS** |
| Dark | `--destructive` / `--destructive-foreground` | `#dc2626` / `#ffffff` | **4.83:1** | `>= 4.5:1` | **PASS** (was `3.76:1`) |
| Dark | `--input` on `--card` (WCAG 1.4.11) | `#64748b` / `#111827` | **3.73:1** | `>= 3.0:1` | **PASS** (was `1.71:1`) |

---

### 6.3 Complete Wave 3 Verification Matrix (All 60 Wave 1 Findings + 3 New V2.0 Findings)

| ID | Sev | Wave 3 Verdict | Concrete Verification Evidence |
| --- | --- | --- | --- |
| **G-01** | P1 | **VERIFIED** | 31/31 token pairs pass WCAG 2.2 AA in `src/app/globals.css:13-157`. |
| **G-02** | P1 | **VERIFIED** | Global `* { animation-duration: 0.01ms !important }` removed (`globals.css:283-320`); targeted `@media (prefers-reduced-motion: reduce)` + `html[data-reduced-motion="true"]` preserve non-motion hover/focus transitions. |
| **G-03** | P1 | **VERIFIED** | `src/lib/preferences/index.tsx` (`PreferencesProvider`, `useUserPreferences`, deterministic Web Audio `playFeedbackSound`), `<MotionConfig reducedMotion={preferences.reduced_motion ? "always" : "user"}>` (`providers.tsx:209`), consumed by all 12 learning/exam/layout files. |
| **G-04** | P1 | **VERIFIED** *(Reopened -> Fixed #68)* | All 6 App Router boundary files verified: `src/app/{loading,error,not-found,global-error}.tsx` + `src/app/(app)/{loading,error}.tsx`. |
| **G-05** | P1 | **VERIFIED** *(Reopened -> Fixed #62)* | All 34 non-root pages export explicit `metadata` (including the 9 learning/exam pages added in `#62`), plus root default title on `/` and `DocumentTitleSync` in `providers.tsx`. |
| **G-06** | P2 | **VERIFIED** | `viewport: { colorScheme: "light dark", viewportFit: "cover" }` in `layout.tsx:21-30`; `:root { color-scheme: light dark; }`, `:root.light`, `:root.dark` in `globals.css:13-91`. |
| **G-07** | P2 | **VERIFIED** | `scroll-padding-top: 4.5rem` & responsive `scroll-padding-bottom: calc(5.25rem + env(safe-area-inset-bottom, 0px))` in `globals.css:220-230`. |
| **G-08** | P2 | **VERIFIED** | `ResponsiveToaster` renders `position="top-center"` on `<768px` and `"bottom-right"` on desktop (`providers.tsx:184-203`). |
| **G-09** | P3 | **VERIFIED** | `SkipToContentLink` rendered inside `I18nProvider` (`providers.tsx:175-182`); animated via compositor-only `transform: translateY(...)` (`globals.css:323-340`). |
| **G-10** | P3 | **VERIFIED** | `<FadeIn aboveFold>` renders immediately visible on SSR (`motion/index.tsx:23-38`, applied on `landing-page.tsx:172,260` & `auth-shell.tsx:33`). |
| **N-01** | P1 | **VERIFIED** | 12 distinct routes in `app-shell.tsx:76-199` (zero `/library` aliases); `/exams/new` ("Thi thử tùy chỉnh") & `/exams` & `/practice` directly reachable; Mobile 5-tab bottom bar places `Thi thử` (`/exams/new`) in center slot 3 (`app-shell.tsx:392-424`). |
| **N-02** | P1 | **VERIFIED** | `FOCUS_ROUTE_PATTERN` (`app-shell.tsx:202-203`) includes `results` and `/exams/(?!new)[^/]+`; when `isFocusRoute`, `AppShell` renders `{children}` without a second `<main>` (`app-shell.tsx:328-334`); `FocusModeShell` supports `asMain` (`FocusModeShell.tsx:26,52,117`). |
| **N-03** | P1 | **VERIFIED** | Collapsed desktop sidebar links render `aria-label={label}`, `<span className="sr-only">{label}</span>`, and focus/hover `<Tooltip>` (`app-shell.tsx:360-387`). |
| **N-04** | P2 | **VERIFIED** | Non-color active indicators added: `border-l-[3px] border-primary` on sidebar (`app-shell.tsx:362-374`) and `border-t-2 border-primary` on mobile bottom bar (`app-shell.tsx:784-786`). |
| **N-05** | P2 | **VERIFIED** | Topbar & mobile sheet search wrapped in semantic `<search>` (`app-shell.tsx:603,821`); mobile `<nav aria-label="Thanh dưới" / "Bottom bar">` avoids redundant `"navigation"` wording (`app-shell.tsx:771`). |
| **N-06** | P2 | **VERIFIED** | `min-h-dvh` throughout (`layout.tsx:39`, `app-shell.tsx:491`), safe-area padding on mobile bottom bar & `<main pb-[calc(6.5rem+env(safe-area-inset-bottom,0px))]>` (`app-shell.tsx:763,773`). |
| **N-07** | P2 | **VERIFIED** | `settings-view.tsx` uses string `dailyGoalDraft` (clamped on blur/submit), `>=44px` touch targets, and submit buttons disabled only while `prefsSaving`/`updatingPassword`. |
| **N-08** | P2 | **VERIFIED** | `profile-view.tsx:403` disables Save only during `isPending`; `theme-toggle.tsx` exposes `DropdownMenuRadioItem` / active `<Check />`. |
| **N-09** | P3 | **VERIFIED** | `landing-page.tsx` uses `<FadeIn aboveFold>`, removes dev jargon (`UUID`/`RLS`/`ảo hóa`), and updates copy cleanly for V2.0. |
| **A-01** | P1 | **VERIFIED** | All 5 public auth/share pages (`login-form`, `register-form`, `forgot-password-form`, `reset-password-form`, `share-redeem-view`) render semantic `<h1>`. |
| **A-02** | P1 | **VERIFIED** | `register-form.tsx:27,250-251,284-285` helper/error copy strictly matches `USERNAME_PATTERN = /^[a-z0-9_]{3,30}$/i`. |
| **A-03** | P2 | **VERIFIED** | Password visibility eye toggles enlarged to `>=44px` mobile touch targets and properly disabled when field/form is disabled. |
| **A-04** | P2 | **VERIFIED** | `forgot-password-form`, `reset-password-form`, `login-form`, `register-form` focus first invalid field on submit and set explicit `aria-invalid={... ? "true" : "false"}`. |
| **A-05** | P3 | **VERIFIED** | `spellCheck={false}` and `autoCapitalize="none"` applied on auth email/username inputs. |
| **L-01** | P1 | **VERIFIED** | `question-editor-view.tsx:1725-1814` protects single question delete, bulk delete, and set delete with `<AlertDialog>` + `<AlertDialogCancel autoFocus>`. |
| **L-02** | P2 | **VERIFIED** | `library-view.tsx` syncs `?create=folder` via `useEffect`, adds real page pagination (`page`/`totalPages`/`hasMore`), and syncs filters cleanly. |
| **L-03** | P2 | **VERIFIED** | `study-set-hub.tsx` removes keyboard-activatable `aria-disabled` `<Link>` elements. |
| **L-04** | P2 | **VERIFIED** | `study-set-hub.tsx:714,717` and `question-editor-view.tsx:1007,1010` localize all question types & difficulties via `t("questionType.*")` and `t("difficulty.*")`. |
| **L-05** | P2 | **VERIFIED** | `create-set-form.tsx` and `question-editor-view.tsx` use numeric string drafts (`inputMode="numeric"`) without snapping on backspace. |
| **L-06** | P2 | **VERIFIED** | `question-editor-view.tsx` paginates/virtualizes large question lists with search & difficulty filters. |
| **L-07** | P3 | **VERIFIED** | `folder-detail-view.tsx` adds direct `/exams/new?folderId=...` CTA. |
| **I-01** | P1 | **VERIFIED** | `<Sparkles />` eliminated across entire codebase (replaced with `<ScanSearch />` in `StepFormatAndRules.tsx`). |
| **I-02** | P1 | **VERIFIED** *(Reopened -> Fixed #67)* | Stepper adds `aria-current="step"`, mobile `sr-only md:not-sr-only` labels, parse caching (0 redundant re-parses), and `handleStepHeadingMount` step-transition focus to `<h2 tabIndex={-1}>` (`ImportWizard.tsx:185-218`). *(Optional 6->5 visual step merge retained as P3 backlog.)* |
| **I-03** | P1 | **VERIFIED** | `StepImportOptionsAndCommit.tsx:389-432` guards destructive `replace` mode with `<AlertDialog>` + `<AlertDialogCancel autoFocus>`. |
| **I-04** | P2 | **VERIFIED** | `VirtualizedPreviewList.tsx:213` uses semantic `role="toolbar"` instead of incomplete `role="tablist"`, with localized labels. |
| **I-05** | P2 | **VERIFIED** | `0` raw Tailwind palette bypass classes remain across all 5 `src/components/import/*` files; mode pickers use `role="radiogroup"` / `role="radio"`. |
| **I-06** | P3 | **VERIFIED** | Removed duplicate `px-4 py-6` outer wrapper in `ImportWizard.tsx`. |
| **LM-01** | P1 | **VERIFIED** | `FlashcardsClient.tsx:895-1050` replaces card-erasing button wrapper with readable `<article aria-live="polite">` + explicit flip button + CSS Grid single-cell stacking (`col-start-1 row-start-1`) eliminating tall-card clipping and supporting clean reduced-motion cross-fade. |
| **LM-02** | P1 | **VERIFIED** | `PracticeClient.tsx` reuses virtualized `ExamNavigatorGrid` with color-independent icons (`CheckCircle2`, `XCircle`, `Check`, `Flag`). |
| **LM-03** | P1 | **VERIFIED** | `ReviewMistakesClient.tsx:205,215` and `StarredQuestionsClient.tsx:125,132` launch true multi-subject `/practice` and `/exams/new` sessions preserving all selected study sets. |
| **LM-04** | P2 | **VERIFIED** | `FlashcardsClient.tsx:447-459` aligns SM-2 shortcuts to `1=Again, 2=Hard, 3=Good, 4=Easy`. |
| **LM-05** | P2 | **VERIFIED** | `WriteClient.tsx` guards Enter with `event.isComposing || event.keyCode === 229` and keeps post-check flow focus-accessible (no dead `disabled={checked}` handler). |
| **LM-06** | P2 | **VERIFIED** | `PracticeClient.tsx` and `LearnClient.tsx` guard `Space`/`Enter` shortcuts via `isInteractiveControlTarget()`. |
| **LM-07** | P2 | **PARTIALLY VERIFIED** *(P3 polish backlog)* | `MatchClient.tsx` fixes dynamic responsive arrow-key column math; full-text reveal popover for `line-clamp-4` truncated long cells remains an optional P3 polish enhancement. |
| **LM-08** | P2 | **VERIFIED** | New `/practice` (`CustomPracticeClient.tsx`) delivers multi-subject/folder custom subset practice (`20/50/100/250/All`/custom), 6 selection policies, fine filters, and hydrated `useUserPreferences()`. |
| **LM-09** | P3 | **VERIFIED** | Duplicate `px-4 py-6` removed from `ReviewMistakesClient` & `StarredQuestionsClient`; `mastery_level` formatted via `formatMastery()`. |
| **E-01** | P1 | **VERIFIED** | `TestHubClient.tsx` drops fake `extraSetIds * 100` formula and embeds V2.0 `CustomExamBuilderClient` powered by `POST /api/exams/eligible` & `POST /api/exams/preview` (Folders + Sets dedup, Strategies A–E, 8 Policies, Full Coverage, Presets, pacing estimator). |
| **E-02** | P1 | **VERIFIED** | `ExamNavigatorGrid.tsx`: exact `ROW_HEIGHT_PX = 50` (`h-11` 44px + 6px gap -> zero drift at 500–1,000Q), auto-scroll `scrollToIndex`, All/Unanswered/Marked + Subject filter + Quick Jump `#`, flex-wrap 12px legend, semantic `<nav>`, color-independent icons (`Check`, `Flag`, `CheckCircle2`, `XCircle`). |
| **E-03** | P1 | **VERIFIED** | `LiveExamRunner.tsx`: `M`/`F` mark shortcuts, strict guard on `confirmSubmitOpen || exitModalOpen || navSheetOpen || shortcutsOpen`, safe-exit `<AlertDialog>` flushing pending `client_seq` queue, mobile+desktop autosave status pill with **Retry** button on error, sticky mobile bottom bar (`Prev · Flag · Grid · Next/Submit`), memoized `<ExamTimer />`, `show_subject_names`/`show_chapter_names` chips. *(P3 note: `F` maps to Flag before `A–F` on 6-option questions; digit `6` selects Option F.)* |
| **E-04** | P1 | **VERIFIED** | `ExamResultsClient.tsx`: `@tanstack/react-virtual` + `measureElement` virtualized 500–1,000Q review list, clean POST/attemptId mistake retest (zero `?questionIds=` URLs), Per-Subject / Per-Chapter / Per-Tag breakdown tables, single-row horizontally scrollable filter `<TabsList>`. |
| **E-05** | P2 | **VERIFIED** | String draft inputs + live `~XXs/câu` pacing badge in `CustomExamBuilderClient.tsx`. |
| **AN-01** | P1 | **VERIFIED** | `history-view.tsx:274-277` and `dashboard-view.tsx` route all single- & multi-subject attempts cleanly to `/exams/[id]` and `/exams/[id]/results`. |
| **AN-02** | P1 | **VERIFIED** | `share-dialog.tsx:393-616` and `friends-view.tsx:316-606` require `<AlertDialog>` confirmation (`autoFocus` on Cancel) and disambiguate every row action `aria-label` with item/peer names. |
| **AN-03** | P2 | **VERIFIED** | `activity-charts.tsx:50-245` wraps charts in `<figure>`/`<figcaption>`, includes `<Legend />`, and renders `sr-only` data tables. |
| **AN-04** | P2 | **VERIFIED** | `history-view.tsx` and `statistics-view.tsx` add `<TableCaption className="sr-only">`, `tabIndex={0}` scroll regions, and icon+text accuracy badges. |
| **AN-05** | P3 | **VERIFIED** | `dashboard-view.tsx` links directly to `/exams/new` and active multi-subject exam flows. |
| **UI-01** | P1 | **VERIFIED** *(Reopened -> Fixed #68)* | `button.tsx` switched to `min-h-11 sm:min-h-9` (no rigid `h-9`/`h-8`); `input.tsx` & `textarea.tsx` switched to `min-h-11 sm:min-h-9 text-base sm:text-sm` + `globals.css` coarse-pointer safety rules. |
| **UI-02** | P2 | **VERIFIED** *(Reopened -> Fixed #68)* | `dialog.tsx` & `sheet.tsx` close buttons enlarged to `min-h-11 min-w-11 sm:min-h-9 sm:min-w-9` with localized `sr-only` labels via `useOptionalI18n()` and `overscroll-contain`. |
| **UI-03** | P2 | **VERIFIED** *(Reopened -> Fixed #68)* | `tabs.tsx` adds border-based `after:border-b-2 data-[state=active]:after:border-primary` Forced Colors indicator + `:focus-visible` ring on `TabsContent`. |
| **UI-04** | P2 | **VERIFIED** *(Reopened -> Fixed #68)* | `table.tsx:8` adds `tabIndex={0}` + `:focus-visible` outline; all public pages render semantic `<h1>` directly (verified under `A-01`). |
| **V2-01** | P1 | **VERIFIED** *(Caught & Fixed Wave 3 #59->#62)* | `CustomExamBuilderClient.tsx:2755` mobile sticky bar was `fixed inset-x-0 bottom-0 z-30` (buried under `AppShell`'s `z-40` bottom nav on `/exams/new`). Fixed with `embedded?: boolean`: offsets cleanly above `AppShell` nav (`bottom-[calc(4rem+max(0.25rem,env(safe-area-inset-bottom,0px)))]` + `pb-36 lg:pb-8`) on `/exams/new`, and keeps `bottom-0` inside `FocusModeShell`. |
| **V2-02** | P1 | **VERIFIED** *(Caught & Fixed Wave 3 #59->#62)* | Duplicate `<h1>` on `/sets/[id]/test` (`FocusModeShell` + `CustomExamBuilderClient`). Fixed: `CustomExamBuilderClient` renders `<h2>` when `embedded` is true. |
| **V2-03** | P2 | **VERIFIED** *(Caught & Fixed Wave 3 #59->#62)* | `ExamResultsClient.tsx`: wrapped Subject/Chapter/Tag breakdown in connected `<TabsContent>` panels, added `aria-label` to Tag accuracy `<Progress>`, and added `role="region"` to virtualized review scroll `<div>`. |
