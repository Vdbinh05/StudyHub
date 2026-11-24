# StudyHub V1.0 — Product Requirements Document (PRD)

> **Product:** StudyHub V1.0 — Personal Study, Flashcard & Exam Preparation Web Application
> **Target Audience:** University students, high-school students, self-learners, and study groups / friends.
> **Core Inspiration:** The effortless flashcard & study-mode mastery of **Quizlet** combined with the serious Vietnamese exam-prep workflow and multi-format question importing of **EduQuiz**.
> **Core Pillars:** 100% Deterministic Engine · Zero AI · Zero Paywalls · Privacy-First Sharing · 10,000+ Question Scale.

---

## 1. Product Vision & Goals

Students routinely receive large question banks from lecturers, classmates, and exam archives in messy `.docx`, `.txt`, `.xlsx`, `.csv`, or Quizlet formats. Existing tools either lock basic exam attempts behind paywalls, hallucinate answers with AI, choke on files with 600–10,000 questions, or mishandle Vietnamese diacritics and Word formatting answer keys (bold, red font, yellow highlight, `*B.`).

**StudyHub V1.0** solves this by providing:
1. **Deterministic Multi-Format Import Engine:** Reliably parses EduQuiz TXT, Word Answer-Key, OOXML DOCX formatting, Wayground/generic XLSX, Quizlet TSV, CSV, and JSON with a transparent 6-step wizard, conflict resolution, and inline fixes.
2. **6 Proven Study & Exam Modes:** Flashcards, Learn (adaptive mastery queue), Practice (instant feedback), Write (deterministic text grading), Match (timed pair board), and Mock Exam (timed, server-scored, immutable snapshot).
3. **Deterministic Spaced Repetition (SM-2):** Automatic due review queue (`/review`) and weak/starred question drills (`/starred`).
4. **Frictionless Collaboration:** Private by default, with friend lists, role-based set sharing (`viewer` / `editor`), revocable share links, and one-click cloning.
5. **Bilingual Calm Academic UI:** Vietnamese default (`vi`) with instant English (`en`) switch, Light & Dark modes, keyboard-first desktop workflows, and one-hand mobile ergonomics.

---

## 2. Target Personas

| Persona | Profile | Core Needs | Primary Workflows |
| --- | --- | --- | --- |
| **Minh (University Exam Prep)** | 3rd-year student preparing for a 1,200-question final exam from a `.docx` bank with bold/red answers. | Fast, accurate import with zero answer-key errors; timed mock exams by chapter; reviewing wrong answers. | Import DOCX -> Verify conflicts -> Practice by Chapter -> Timed Mock Exam -> Review Mistakes. |
| **Linh (Language & Vocab Learner)** | Self-learner studying English/Japanese vocabulary and definitions. | Clean Flashcards with keyboard flip, Write mode tolerant of casing/whitespace, daily SM-2 spaced repetition. | Import Quizlet TSV -> Flashcards (`Space` / `1-4`) -> Write Mode -> Daily `/review` queue. |
| **Huy & Study Group** | 4 classmates splitting chapters of a course question bank. | Organize sets in folders, share editable set with friends, export backup to JSON/XLSX, clone sets for personal exam prep. | Create Folder -> Share set (`editor`) -> Add Friends -> Export XLSX -> Clone & Test. |

---

## 3. Complete Route & Page Inventory (28 Routes)

### 3.1 Public & Authentication Routes
| Route | Access | Purpose & Key Capabilities |
| --- | --- | --- |
| `/` | Public | Academic product landing page explaining core features (6 study modes, deterministic import, exam integrity, free forever), language toggle (`vi`/`en`), theme toggle, CTAs to `/register` and `/login` (or `/dashboard` if authenticated). |
| `/login` | Public (redirects to `/dashboard` if logged in) | Email + password login via Supabase Auth, optional Google OAuth button (enabled if configured), link to `/forgot-password` and `/register`. |
| `/register` | Public | Email + password + display name registration, validation with Zod, clear email verification guidance. |
| `/forgot-password` | Public | Request Supabase password reset email with rate-limit feedback. |
| `/reset-password` | Public (recovery session) | Set new strong password after clicking recovery link. |
| `/share/[token]` | Public / Auth | Preview a shared study set via revocable token; redeem membership or clone to library (prompts login if unauthenticated). |

### 3.2 Authenticated Workspace Routes (`(app)`)
| Route | Purpose & Key Capabilities |
| --- | --- |
| `/dashboard` | Personalized overview: daily study goal ring, streak counter, due SM-2 review count CTA, recently studied sets, recent exam scores, quick actions (New Set, Import File, Quick Review). |
| `/library` | Unified library of user's Folders and Study Sets with search, filter by type (`multiple_choice`, `flashcards`, `mixed`), visibility, archived toggle, sort (recent, title, question count), and create folder/set dialogs. |
| `/folders/[id]` | Folder detail view showing breadcrumb path, nested subfolders, study sets inside folder, rename/recolor/delete folder actions, and move-set controls. |
| `/sets/new` | Create a new study set (title, description, subject, folder, set type, visibility, default exam duration/pass threshold) with immediate option to add manually or jump to `/sets/[id]/import`. |
| `/sets/[id]` | Study Set Hub: metadata header, mastery progress bar, chapter breakdown, 6 study mode launcher cards (Flashcards, Learn, Practice, Write, Match, Mock Exam), searchable/virtualized question preview list, star toggles, Share/Clone/Export/Edit/Import actions. |
| `/sets/[id]/edit` | Full virtualized Study Set & Question Bank Editor (supports 10,000+ questions): edit set metadata, add/edit/reorder/delete questions, edit options (add/remove/mark correct), accepted text answers, chapters, difficulty, tags, bulk actions (assign chapter, add tag, delete selected), inline search & filter. |
| `/sets/[id]/import` | 6-Step Deterministic Import Wizard: (1) Select Source/Upload or Paste, (2) Auto-detect & Format Config, (3) Answer Detection Rules / Column Mapping, (4) Virtualized Preview, Diagnostics & Inline Conflict Fix, (5) Target Options (append/replace, default chapter/tags), (6) Chunked Commit with Progress & Summary. |
| `/sets/[id]/flashcards` | Focus-mode Flashcard deck: 3D flip (`motion/react` 250–400ms), term/definition swap, shuffle, chapter/starred filter, keyboard shortcuts (`Space` flip, `1-4` Again/Hard/Good/Easy rating, `S` star, `Left/Right` navigate), SM-2 progress update. |
| `/sets/[id]/learn` | Focus-mode Adaptive Mastery Queue (deterministic): batches of 7–10 questions; missed items are re-queued inside the round until answered correctly twice consecutively; tracks `new -> learning -> familiar -> mastered`; instant explanation reveal. |
| `/sets/[id]/practice` | Focus-mode EduQuiz-style Practice: chapter/tag/starred/unmastered filters, sequential or shuffled order, instant answer check, clear green/red option highlight, explanation panel, star button, question jump sidebar/drawer. |
| `/sets/[id]/write` | Focus-mode Typed Recall: prompts question/term, learner types answer, deterministic comparison (`exact`, `case_insensitive`, `ignore_diacritics`, `numeric`), "Override: I was right" explicit option if typo, shows accepted answers & explanation. |
| `/sets/[id]/match` | Focus-mode Timed Matching Game: grid of 6–8 pairs (12–16 tiles) of prompts & correct answers/definitions; click/keyboard pair matching; live millisecond timer; wrong match gentle shake + red border; personal best time recorded in `study_sessions`. |
| `/sets/[id]/test` | Mock Exam Configuration & Runner: configure question count, chapter scope, duration timer, shuffle questions, shuffle options, pass threshold. Runner features focus layout, server-synced countdown timer, question navigator grid (answered/unanswered/flagged), autosave on every selection, submit confirmation modal, and auto-submit on expiry. |
| `/sets/[id]/results/[attemptId]` | Immutable Exam Result Breakdown: score percentage, pass/fail badge, time spent, chapter-by-chapter accuracy table, filterable question review (All / Wrong / Unanswered / Flagged / Correct) with user's selection vs. authoritative correct answer and explanation, "Practice Wrong Questions" and "Retake Exam" CTAs. |
| `/review` | Global SM-2 Spaced Repetition Queue across all accessible sets: shows due today count, overdue items, weak/frequently missed items, and launches a focused review session updating SM-2 intervals. |
| `/starred` | Consolidated view of all user-starred questions across sets with set/chapter filtering, unstar action, and "Study Starred" launcher. |
| `/history` | Chronological log of all past `exam_attempts` and `study_sessions` with mode/set filter, score badges, duration, and direct links to `/sets/[id]/results/[attemptId]`. |
| `/statistics` | Deterministic Analytics Dashboard (Recharts): daily study activity chart (30/90 days), current & longest streak, mastery level donut/bar breakdown, exam score trend over time, and weakest chapters/topics table with direct "Practice Weak Area" links. |
| `/shared` | Study sets shared with the user by friends or redeemed via share links, showing owner name, role (`viewer`/`editor`), and quick study/clone buttons. |
| `/friends` | Friend Management: accepted friends list, incoming/outgoing friend requests (accept/decline/cancel), add friend by exact `username` or `email`, block/unfriend actions. |
| `/profile` | User profile editor: display name, unique `username`, bio, avatar upload (validated raster image to Supabase Storage), account email display. |
| `/settings` | User preferences & account controls: UI language (`vi`/`en`), theme (`light`/`dark`/`system`), daily study goal, default shuffle & instant feedback preferences, reduced motion toggle, password change, export personal data summary, sign out. |

---

## 4. Core Functional Requirements

### 4.1 Deterministic Learning & Spaced Repetition (SM-2)
- Every answered question in Flashcards, Learn, Practice, Write, Review, and Exam updates `user_question_progress` deterministically using the **SM-2 algorithm** (see `src/lib/learning/sm2.ts`):
  - Quality rating `q` mapped cleanly: `again = 1`, `hard = 3`, `good = 4`, `easy = 5` (for binary right/wrong modes: wrong = `1`, correct = `4`).
  - If `q < 3`: `repetitions = 0`, `interval_days = 1`, `consecutive_correct = 0`.
  - If `q >= 3`:
    - `repetitions == 0` -> `interval_days = 1`
    - `repetitions == 1` -> `interval_days = 6`
    - `repetitions >= 2` -> `interval_days = round(interval_days * ease_factor)`
    - `repetitions += 1`, `consecutive_correct += 1`
  - `ease_factor = max(1.30, min(4.00, ease_factor + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))))`
  - `next_review_at = now() + interval_days`
- **Mastery Level Derivation (Deterministic):**
  - `new`: `correct_count == 0 && wrong_count == 0`
  - `mastered`: `consecutive_correct >= 3 && interval_days >= 14`
  - `familiar`: `consecutive_correct >= 2 || interval_days >= 6`
  - `learning`: all other reviewed states.

### 4.2 Deterministic Multi-Format Import & Export
- **Import:** Supports EduQuiz TXT, Word Answer-Key, DOCX OOXML formatting, Wayground & generic XLSX, Quizlet TSV/delimiters, CSV, JSON, and generic TXT (full specification in `docs/IMPORT_FORMATS.md`).
- **Export:** Every readable study set can be exported deterministically to:
  - **JSON** (lossless StudyHub canonical format including chapters, options, accepted answers, explanations, tags)
  - **CSV** (UTF-8 with BOM for seamless Excel compatibility on Windows)
  - **XLSX** (`exceljs`, clean multi-column sheet)
  - **Printable Study Sheet** (`@media print` clean layout)

### 4.3 Sharing & Privacy
- All newly created study sets default to `visibility = 'private'`.
- Owners can share directly with friends (`viewer` or `editor` role in `study_set_members`), create revocable/expiring share links (`study_set_share_links`), or toggle `unlisted` / `public`.
- Any user with read access (and `allow_clone = true`) can clone a set into their own private library with one click.

---

## 5. Strict Non-Goals (Out of Scope for V1.0)

- **NO AI features:** No LLM generation, no semantic embeddings, no AI explanations, no AI OCR, no AI chat tutors.
- **NO Billing or Monetization:** No subscription plans, checkout flows, ads, or usage quotas.
- **NO Public Social Feed / Comments / Leaderboards:** Social scope is strictly private study sharing with known friends (`friendships` + `study_set_members` + `study_set_share_links`).
- **NO Live Multiplayer WebSocket Rooms:** Focus is personal study, async sharing, and serious exam simulation.
- **NO Native Mobile App:** Delivered as a responsive, touch-friendly, mobile-first-ergonomic Web App (360px to 1920px).
