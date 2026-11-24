# StudyHub V1.0 — Design System & Accessibility Specification

> **Aesthetic Direction:** Calm Academic SaaS — inspired by Linear, Notion, Quizlet, EduQuiz, and Apple Human Interface Guidelines.
> **Anti-Patterns (STRICTLY FORBIDDEN):** Neon glows, loud multi-stop background gradients, glassmorphism blur abuse over text, decorative AI sparkles, emoji characters used as UI icons (always use `lucide-react`).

---

## 1. Color System & CSS Variables (Light & Dark Mode)

Defined in `src/app/globals.css` and switched via `next-themes` (`class="dark"` on `<html>`). Every text/surface pairing MUST meet **WCAG 2.2 AA** contrast ratios (`>= 4.5:1` for body text, `>= 3:1` for large text and UI boundaries).

### 1.1 Semantic Palette Tokens

| Token | Role | Light Mode (Hex / Slate-Indigo) | Dark Mode (Hex / Slate-Indigo) |
| --- | --- | --- | --- |
| `--background` | Page canvas | `#F8FAFC` (Slate 50) | `#0B1120` (Deep Slate 950) |
| `--surface` / `--card` | Elevated card / panel | `#FFFFFF` | `#111827` (Slate 900) |
| `--surface-subtle` / `--muted` | Secondary container / hover | `#F1F5F9` (Slate 100) | `#1E293B` (Slate 800) |
| `--foreground` | Primary ink | `#0F172A` (Slate 900) | `#F8FAFC` (Slate 50) |
| `--muted-foreground` | Secondary metadata ink | `#475569` (Slate 600) | `#94A3B8` (Slate 400) |
| `--border` | Hairline divider (1px) | `#E2E8F0` (Slate 200) | `#1F2937` / `#334155` |
| `--primary` | Brand Indigo CTA / Active | `#4F46E5` (Indigo 600) | `#6366F1` (Indigo 500) |
| `--primary-hover` | Primary hover state | `#4338CA` (Indigo 700) | `#818CF8` (Indigo 400) |
| `--primary-foreground` | Text on primary | `#FFFFFF` | `#FFFFFF` |
| `--accent` | Interactive Blue highlight | `#2563EB` (Blue 600) | `#3B82F6` (Blue 500) |
| `--accent-soft` | Selected option tint | `#EFF6FF` (Blue 50) | `rgba(59, 130, 246, 0.16)` |
| `--success` | Correct answer / Mastered | `#15803D` (Green 700) | `#22C55E` (Green 500) |
| `--success-soft` | Correct banner fill | `#F0FDF4` (Green 50) | `rgba(34, 197, 94, 0.14)` |
| `--destructive` / `--error` | Wrong answer / Danger | `#DC2626` (Red 600) | `#EF4444` (Red 500) |
| `--error-soft` | Wrong banner fill | `#FEF2F2` (Red 50) | `rgba(239, 68, 68, 0.14)` |
| `--warning` | Flagged / Import warning | `#B45309` (Amber 700) | `#F59E0B` (Amber 500) |
| `--warning-soft` | Warning banner fill | `#FFFBEB` (Amber 50) | `rgba(245, 158, 11, 0.14)` |
| `--ring` | Focus-visible outline | `#4F46E5` | `#818CF8` |

> **Color-Blind Safety:** Never convey Correct / Wrong / Flagged state by color alone. Always pair with an explicit `lucide-react` icon (`CheckCircle2`, `XCircle`, `Flag`, `AlertTriangle`) and text label.

---

## 2. Typography (Vietnamese-First Legibility)

Vietnamese diacritics (e.g., `ệ`, `ữ`, `ắ`, `ở`) require crisp rendering and generous line-height to avoid clipping.

- **Primary Font:** `Inter` loaded via `next/font/google` with `subsets: ['latin', 'vietnamese']`, `display: 'swap'`, variable `--font-inter`.
- **Fallback Stack:** `var(--font-inter), 'Geist', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`.
- **Monospace (timers, code snippets, numeric scores):** `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace` with `font-variant-numeric: tabular-nums` so countdown timers and progress counters NEVER jitter horizontally!

### Type Scale
| Role | Size | Line Height | Weight | Usage |
| --- | --- | --- | --- | --- |
| Page Title (`h1`) | `1.5rem` (24px) – `1.875rem` (30px) | `1.3` | `700` | Dashboard, Library, Set Title |
| Section Heading (`h2`) | `1.125rem` (18px) – `1.25rem` (20px) | `1.35` | `600` | Cards, Chapters, Settings groups |
| Question Stem | `1.0625rem` (17px) – `1.25rem` (20px) | `1.6` | `500` | High-readability exam/practice stem |
| Body / Option Text | `0.9375rem` (15px) – `1rem` (16px) | `1.55` | `400` | Answer choices, explanations |
| UI Label / Button | `0.875rem` (14px) | `1.4` | `500` | Controls, sidebar items, badges |
| Metadata / Caption | `0.75rem` (12px) | `1.4` | `500` | Timestamps, counts, shortcut hints |

---

## 3. Spacing, Layout & Responsive Navigation

- **Spacing Scale:** 4px base grid (`4, 8, 12, 16, 20, 24, 32, 48, 64`).
- **Border Radius:** Cards `12px` (`rounded-xl`), inputs/buttons `8px` (`rounded-lg`), badges/pills `9999px` (`rounded-full`).
- **Shadows:** Subtle structural borders (`1px solid var(--border)`) are preferred over heavy drop shadows; modals/popovers use soft elevation (`shadow-md` / `shadow-lg`).
- **Reading Measure:** Question stems and flashcards are constrained to `max-w-3xl` (`768px`) centered to prevent eye fatigue on wide monitors.

### 3.1 Desktop Navigation (`>= 1024px`)
- **Fixed Left Sidebar (`248px`, collapsible to `68px` icon rail):**
  - Brand mark (`StudyHub`) + New Set CTA
  - Primary Group: Dashboard, Library, Review (with due badge), Starred
  - Activity Group: History, Statistics
  - Social Group: Shared with Me, Friends
  - Footer Group: Profile, Settings, Language Toggle (`VI` / `EN`), Theme Toggle
- **Top Context Bar (`56px`):** Breadcrumbs, global quick search, contextual primary action.

### 3.2 Mobile One-Hand Navigation (`< 1024px`, tested at 360px & 390px)
- **Bottom Navigation Bar (`64px` + `env(safe-area-inset-bottom)`):** 5 thumb-reachable destinations:
  1. Dashboard (`Home`)
  2. Library (`Library`)
  3. Review (`RotateCcw` + due dot)
  4. History/Stats (`BarChart3`)
  5. More (`Menu` -> opens bottom/left Sheet containing Starred, Shared, Friends, Profile, Settings, Language, Theme).
- **Minimum Touch Target:** Every interactive button, option card, star icon, and nav item MUST be at least `44x44px` on touch viewports.

### 3.3 Learning & Exam Focus-Mode Layout
Used on `/flashcards`, `/learn`, `/practice`, `/write`, `/match`, `/test`, and active `/review`:
- **Hides main sidebar and bottom nav** to eliminate distractions.
- **Minimal Sticky Header (`56px`):** Exit button (`X` with confirm if unsaved exam), set title + progress bar (`12 / 50`), mode settings gear, timer (in Exam/Match, `tabular-nums`), and Navigator Sheet toggle (mobile).
- **Split Desktop Layout (Practice & Exam):**
  - Left/Center (`flex-1`, `max-w-3xl`): Active question card, option buttons (tall, full-width clickable rows), flag & star controls, Prev/Next/Submit action bar.
  - Right Panel (`280px`, collapsible / drawer on mobile): Virtualized Question Navigator Grid showing color+icon status (Current, Answered, Flagged, Unanswered) and Submit Exam button.

---

## 4. Component Specifications

| Component | Rules & States |
| --- | --- |
| **Buttons** | Variants: `default` (Indigo), `secondary` (Slate subtle), `outline`, `ghost`, `destructive`. Always show crisp `focus-visible` ring (`2px solid var(--ring)` with `2px` offset) and `disabled` loading spinner state when submitting. |
| **Answer Option Card** | Full-row button (`role="radio"` for single choice, `role="checkbox"` for multiple choice). Left letter badge (`A`, `B`, `C`, `D` computed from rendered position, NEVER bound to stale original label). States: Idle, Hover, Selected (Indigo/Blue border + soft fill), Correct (Green + check icon), Wrong (Red + X icon). |
| **Flashcard Surface** | Clean elevated card (`min-h-[300px]` mobile, `min-h-[380px]` desktop), front/back indicator pill, keyboard shortcut footer (`Space: Lật thẻ · 1-4: Đánh giá`), subtle flip animation. |
| **Exam Timer** | Uses `tabular-nums`. Neutral Slate normally; turns Warning Amber at `< 5:00` remaining; turns Destructive Red with `aria-live="polite"` warning toast at `< 1:00` remaining (no frantic blinking). |
| **Empty States** | Every list (Library, Folders, Starred, Review, Shared, Friends, History) renders a clean Lucide icon, clear explanation, and a real primary CTA button (never blank whitespace). |
| **Toast Notifications (`sonner`)** | Concise, non-blocking, positioned bottom-right on desktop / top-center on mobile so it never blocks thumb controls. |

---

## 5. Motion & Animation Rules (`motion/react`)

1. **GPU-Composited Properties ONLY:** Animate ONLY `transform` (`x`, `y`, `scale`, `rotateY`) and `opacity`. NEVER animate `width`, `height`, `top`, `left`, `margin`, or `box-shadow` continuously.
2. **Strict Duration Budgets:**
   - **Micro-interactions** (button press, option select, star pop, tab indicator): **`120ms – 200ms`**, easing `[0.2, 0, 0, 1]`.
   - **Dialogs, Sheets, Popovers, Toast enter/exit:** **`150ms – 250ms`**.
   - **Flashcard 3D Flip:** **`250ms – 400ms`** (`rotateY: 0 -> 180`, `backfaceVisibility: hidden`, crisp spring or cubic-bezier).
3. **Reduced Motion Compliance:**
   - Wrap app root in `<MotionConfig reducedMotion="user">` (and honor `user_preferences.reduced_motion`).
   - Add global CSS `@media (prefers-reduced-motion: reduce)` rule disabling non-essential transitions and replacing 3D flashcard flips with an instant `120ms` opacity crossfade.
4. **No Layout Shift:** Reserve explicit heights for skeletons and progress bars so CLS stays `< 0.05`.

---

## 6. WCAG 2.2 AA Accessibility Checklist

- **Skip Link:** First focusable element in `src/app/layout.tsx` jumps directly to `<main id="main-content">`.
- **Keyboard Operability:** Every feature is 100% usable without a mouse:
  - Flashcards: `Space`/`Enter` flip, `1`–`4` rate, `ArrowLeft`/`ArrowRight` step, `S` star.
  - Practice/Learn/Exam: `1`–`6` or `A`–`F` select option, `Enter` check/next, `ArrowLeft`/`ArrowRight` navigate, `F` flag (disabled automatically when focus is inside `<input>` or `<textarea>`!).
- **Dialog Focus Management:** All modals/sheets use Radix UI primitives (`Dialog`, `AlertDialog`, `Sheet`) providing automatic focus trap, `Esc` dismissal, and focus restoration.
- **Screen Reader Landmarks & Live Regions:** Proper `<header>`, `<nav>`, `<main>`, `<aside>`, `aria-label` on icon-only buttons, `aria-live="polite"` for grading feedback and exam timer warnings.
- **Form Errors:** Every input binds `aria-invalid` and `aria-describedby` to inline Zod validation messages.
