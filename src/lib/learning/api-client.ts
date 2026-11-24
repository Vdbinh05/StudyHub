import type {
  AllocationStrategy,
  ConfidenceLevel,
  CoverageCycle,
  DifficultyLevel,
  ExamAttempt,
  ExamAttemptAnswer,
  ExamAttemptSource,
  ExamChapterBreakdown,
  ExamEligiblePool,
  ExamFilterConfig,
  ExamPreset,
  ExamPreviewResult,
  ExamQuestionType,
  ExamSnapshotQuestion,
  ExamSourceInput,
  ExamStatus,
  ExamSubjectBreakdown,
  ExamTagBreakdown,
  Folder,
  LearningSessionCheckpoint,
  MasteryLevel,
  MistakeStatus,
  PracticePoolResponse,
  ProgressResetRequest,
  ProgressResetResult,
  Question,
  QuestionReport,
  QuestionReportCategory,
  QuestionType,
  RichTextDoc,
  SelectionPolicy,
  SelfRating,
  SessionStatus,
  StructuredAnswerResponse,
  StudyMode,
  StudySession,
  StudySet,
  UserQuestionNote,
  UserQuestionProgress,
  V3StudyMode,
} from "@/types/domain";

export interface ApiEnvelope<T> {
  data: T;
  meta?: {
    total?: number;
    page?: number;
    pageSize?: number;
    hasMore?: boolean;
  };
}

export interface ApiErrorEnvelope {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export class LearningApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: string, message: string, status: number, details?: unknown) {
    super(message);
    this.name = "LearningApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

async function requestJson<T>(
  url: string,
  init?: RequestInit,
): Promise<ApiEnvelope<T>> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Non-JSON response
  }

  if (!response.ok) {
    const errObj = (payload as Partial<ApiErrorEnvelope> | null)?.error;
    throw new LearningApiError(
      errObj?.code ?? `HTTP_${response.status}`,
      errObj?.message ?? response.statusText ?? "Request failed",
      response.status,
      errObj?.details,
    );
  }

  if (payload && typeof payload === "object" && "data" in payload) {
    return payload as ApiEnvelope<T>;
  }

  return { data: payload as T };
}

/**
 * Determine whether an event target is an editable field where global keyboard shortcuts must be ignored.
 */
export function isEditableEventTarget(target: EventTarget | null): boolean {
  if (!target || typeof HTMLElement === "undefined") return false;
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
    return true;
  }
  if (target.isContentEditable) {
    return true;
  }
  return Boolean(target.closest('[contenteditable="true"]'));
}

/**
 * Determine whether keyboard focus is currently on an interactive control (button, link, etc.)
 * so global `Enter`/`Space` listeners do not hijack native activation (LM-06).
 */
export function isInteractiveControlTarget(target: EventTarget | null): boolean {
  if (isEditableEventTarget(target)) return true;
  if (!target || typeof HTMLElement === "undefined") return false;
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "BUTTON" || tag === "A" || tag === "SUMMARY") {
    return true;
  }
  const role = target.getAttribute("role");
  if (
    role === "button" ||
    role === "link" ||
    role === "menuitem" ||
    role === "option" ||
    role === "tab" ||
    role === "switch" ||
    role === "checkbox" ||
    role === "radio"
  ) {
    return true;
  }
  return Boolean(target.closest("button, a, [role='button'], [role='menuitem']"));
}

/**
 * Validate safe image URLs before rendering `<img src>` (blocks javascript:, data:text/html, vbscript:).
 */
export function isSafeDisplayImageUrl(
  url: string | null | undefined,
): url is string {
  if (!url) return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith("/")) return !trimmed.startsWith("//");
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

// ============================================================================
// Folders, Study Sets & Questions (Chunk-Safe Paginated Loaders — SH-005 / SH-025)
// ============================================================================

export interface StudySetDetailResponse {
  set: StudySet;
  chapters?: string[];
  role?: "owner" | "editor" | "viewer";
}

export async function fetchStudySet(setId: string): Promise<StudySet> {
  const res = await requestJson<StudySet | StudySetDetailResponse>(
    `/api/sets/${encodeURIComponent(setId)}`,
  );
  const data = res.data;
  if (data && typeof data === "object" && "set" in data && data.set) {
    return data.set;
  }
  return data as StudySet;
}

export async function fetchAccessibleSets(maxPages = 20): Promise<StudySet[]> {
  const pageSize = 100;
  const all: StudySet[] = [];
  let page = 1;

  while (page <= maxPages) {
    const res = await requestJson<StudySet[] | { sets: StudySet[] }>(
      `/api/sets?page=${page}&pageSize=${pageSize}`,
    );
    const items = Array.isArray(res.data)
      ? res.data
      : res.data && typeof res.data === "object" && "sets" in res.data
        ? res.data.sets
        : [];
    all.push(...items);
    const total = res.meta?.total;
    if (
      items.length < pageSize ||
      (typeof total === "number" && all.length >= total)
    ) {
      break;
    }
    page += 1;
  }

  return all;
}

export async function fetchAccessibleFolders(): Promise<Folder[]> {
  const res = await requestJson<Folder[] | { folders: Folder[] }>("/api/folders");
  if (Array.isArray(res.data)) return res.data;
  if (res.data && typeof res.data === "object" && "folders" in res.data) {
    return res.data.folders;
  }
  return [];
}

/**
 * Fetch questions for a study set in safe `pageSize=100` chunks (<=400 options/call,
 * strictly immune to PostgREST's 1,000-row cap — fixes SH-005 & SH-025).
 * Fetches page 1 first, then batches remaining pages in parallel (concurrency 4)
 * once `meta.total` is known (`P1-3`).
 */
export async function fetchStudySetQuestions(
  setId: string,
  maxQuestions: number = 10_000,
): Promise<Question[]> {
  const pageSize = 100;
  const concurrency = 4;
  const encodedSetId = encodeURIComponent(setId);

  const fetchPage = async (
    page: number,
  ): Promise<{ items: Question[]; total?: number }> => {
    const res = await requestJson<Question[] | { questions: Question[] }>(
      `/api/sets/${encodedSetId}/questions?page=${page}&pageSize=${pageSize}`,
    );
    const items = Array.isArray(res.data)
      ? res.data
      : res.data && "questions" in res.data
        ? res.data.questions
        : [];
    return {
      items,
      total: typeof res.meta?.total === "number" ? res.meta.total : undefined,
    };
  };

  const first = await fetchPage(1);
  const all: Question[] = [...first.items];
  const targetCount =
    typeof first.total === "number"
      ? Math.min(first.total, maxQuestions)
      : maxQuestions;

  if (first.items.length < pageSize || all.length >= targetCount) {
    return all.slice(0, maxQuestions);
  }

  if (typeof first.total === "number") {
    const totalPages = Math.ceil(targetCount / pageSize);
    for (let start = 2; start <= totalPages; start += concurrency) {
      const batchPages: number[] = [];
      for (let p = start; p < start + concurrency && p <= totalPages; p += 1) {
        batchPages.push(p);
      }
      const results = await Promise.all(batchPages.map((p) => fetchPage(p)));
      for (const r of results) {
        all.push(...r.items);
      }
    }
    return all.slice(0, maxQuestions);
  }

  // Fallback when meta.total is omitted
  let page = 2;
  const maxPages = Math.ceil(Math.max(1, maxQuestions) / pageSize) + 1;
  while (all.length < maxQuestions && page <= maxPages) {
    const next = await fetchPage(page);
    all.push(...next.items);
    if (next.items.length < pageSize) break;
    page += 1;
  }

  return all.slice(0, maxQuestions);
}

// ============================================================================
// Progress & Starred (Paginated — fixes SH-025 caps)
// ============================================================================

export async function fetchSetProgress(
  studySetId: string,
  maxItems: number = 10_000,
): Promise<UserQuestionProgress[]> {
  const pageSize = 500;
  const concurrency = 4;
  const encodedSetId = encodeURIComponent(studySetId);

  const fetchPage = async (
    page: number,
  ): Promise<{ items: UserQuestionProgress[]; total?: number }> => {
    const res = await requestJson<
      UserQuestionProgress[] | { progress: UserQuestionProgress[] }
    >(
      `/api/progress?studySetId=${encodedSetId}&page=${page}&pageSize=${pageSize}`,
    );
    const items = Array.isArray(res.data)
      ? res.data
      : res.data && "progress" in res.data
        ? res.data.progress
        : [];
    return {
      items,
      total: typeof res.meta?.total === "number" ? res.meta.total : undefined,
    };
  };

  const first = await fetchPage(1);
  const all: UserQuestionProgress[] = [...first.items];
  const targetCount =
    typeof first.total === "number"
      ? Math.min(first.total, maxItems)
      : maxItems;

  if (first.items.length < pageSize || all.length >= targetCount) {
    return all.slice(0, maxItems);
  }

  if (typeof first.total === "number") {
    const totalPages = Math.ceil(targetCount / pageSize);
    for (let start = 2; start <= totalPages; start += concurrency) {
      const batchPages: number[] = [];
      for (let p = start; p < start + concurrency && p <= totalPages; p += 1) {
        batchPages.push(p);
      }
      const results = await Promise.all(batchPages.map((p) => fetchPage(p)));
      for (const r of results) {
        all.push(...r.items);
      }
    }
    return all.slice(0, maxItems);
  }

  let page = 2;
  const maxPages = Math.ceil(maxItems / pageSize) + 1;
  while (all.length < maxItems && page <= maxPages) {
    const next = await fetchPage(page);
    all.push(...next.items);
    if (next.items.length < pageSize) break;
    page += 1;
  }

  return all.slice(0, maxItems);
}

export interface UpsertProgressPayload {
  study_set_id: string;
  question_id: string;
  is_correct: boolean;
  self_rating?: SelfRating | null;
  confidence?: ConfidenceLevel | null;
  hint_used?: boolean;
  mastery_level?: MasteryLevel;
  ease_factor?: number;
  interval_days?: number;
  repetitions?: number;
  next_review_at?: string | null;
  mistake_status?: MistakeStatus;
}

export async function upsertQuestionProgress(
  payload: UpsertProgressPayload,
): Promise<UserQuestionProgress> {
  const res = await requestJson<UserQuestionProgress>("/api/progress", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return res.data;
}

export interface DueQuestionItem {
  progress: UserQuestionProgress;
  question: Question;
  study_set_title?: string;
}

export async function fetchDueQuestions(
  studySetId?: string,
  limit: number = 200,
): Promise<DueQuestionItem[]> {
  const params = new URLSearchParams({ limit: String(Math.min(200, limit)) });
  if (studySetId) params.set("studySetId", studySetId);
  const res = await requestJson<DueQuestionItem[] | { items: DueQuestionItem[] }>(
    `/api/progress/due?${params.toString()}`,
  );
  if (Array.isArray(res.data)) return res.data;
  if (res.data && "items" in res.data) return res.data.items;
  return [];
}

export interface StarredQuestionItem {
  question_id: string;
  study_set_id: string;
  created_at: string;
  study_set_title?: string;
  question?: Question;
  progress?: UserQuestionProgress | null;
}

export async function fetchStarredQuestions(
  studySetId?: string,
  maxItems: number = 2000,
): Promise<StarredQuestionItem[]> {
  const pageSize = 200;
  const all: StarredQuestionItem[] = [];
  let page = 1;
  const maxPages = Math.ceil(maxItems / pageSize) + 1;

  while (all.length < maxItems && page <= maxPages) {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
    });
    if (studySetId) params.set("studySetId", studySetId);
    const res = await requestJson<unknown>(`/api/starred?${params.toString()}`);
    const rawList: unknown[] = Array.isArray(res.data)
      ? res.data
      : res.data && typeof res.data === "object" && "items" in res.data
        ? ((res.data as { items?: unknown[] }).items ?? [])
        : [];

    const mapped = rawList
      .map((entry): StarredQuestionItem | null => {
        if (!entry || typeof entry !== "object") return null;
        const obj = entry as Record<string, unknown>;
        if ("question" in obj && obj.question && typeof obj.question === "object") {
          const q = obj.question as Question;
          const studySetObj = obj.study_set as
            | { id?: string; title?: string }
            | null
            | undefined;
          return {
            question_id: (obj.question_id as string | undefined) ?? q.id,
            study_set_id:
              (obj.study_set_id as string | undefined) ??
              studySetObj?.id ??
              q.study_set_id,
            created_at:
              (obj.created_at as string | undefined) ??
              (obj.starred_at as string | undefined) ??
              q.created_at,
            study_set_title:
              (obj.study_set_title as string | undefined) ?? studySetObj?.title,
            question: q,
            progress:
              (obj.progress as UserQuestionProgress | null | undefined) ?? null,
          };
        }
        if ("question_id" in obj) {
          return obj as unknown as StarredQuestionItem;
        }
        return null;
      })
      .filter((item): item is StarredQuestionItem => item !== null);

    all.push(...mapped);
    const total = res.meta?.total;
    if (
      rawList.length < pageSize ||
      (typeof total === "number" && all.length >= total)
    ) {
      break;
    }
    page += 1;
  }

  return all.slice(0, maxItems);
}

export async function toggleStarQuestion(
  questionId: string,
  studySetId?: string,
): Promise<{ starred: boolean }> {
  const res = await requestJson<{ starred: boolean }>("/api/starred", {
    method: "POST",
    body: JSON.stringify({ question_id: questionId, study_set_id: studySetId }),
  });
  return res.data;
}

export async function unstarQuestion(questionId: string): Promise<void> {
  await requestJson<unknown>(`/api/starred/${encodeURIComponent(questionId)}`, {
    method: "DELETE",
  });
}

// ============================================================================
// Mistakes Review
// ============================================================================

export interface MistakeItem {
  question_id: string;
  study_set_id: string;
  study_set_title?: string;
  subject?: string | null;
  chapter?: string | null;
  wrong_count: number;
  correct_count: number;
  consecutive_correct: number;
  consecutive_wrong?: number;
  mastery_level: MasteryLevel;
  last_wrong_at?: string | null;
  last_reviewed_at?: string | null;
  next_review_at?: string | null;
  last_selected_option_ids?: string[];
  last_typed_answer?: string | null;
  last_confidence?: ConfidenceLevel | null;
  low_confidence_count?: number;
  high_conf_wrong_count?: number;
  guess_correct_count?: number;
  mistake_status?: MistakeStatus;
  recent_exam_attempt_id?: string | null;
  needs_review: boolean;
  is_starred?: boolean;
  question: Question;
}

export interface ListMistakesParams {
  studySetId?: string;
  subject?: string;
  chapter?: string;
  tagId?: string;
  questionType?: QuestionType;
  minWrongCount?: number;
  minConsecutiveWrong?: number;
  includeResolved?: boolean;
  mistakeStatus?: MistakeStatus;
  confidence?: ConfidenceLevel;
  highConfWrongOnly?: boolean;
  guessCorrectOnly?: boolean;
  lowConfidenceOnly?: boolean;
  dueOnly?: boolean;
  starredOnly?: boolean;
  masteryLevel?: MasteryLevel;
  examAttemptId?: string;
  days?: number;
  page?: number;
  pageSize?: number;
}

export async function fetchMistakes(
  params: ListMistakesParams = {},
): Promise<{ items: MistakeItem[]; total: number }> {
  const qs = new URLSearchParams();
  if (params.studySetId) qs.set("studySetId", params.studySetId);
  if (params.subject) qs.set("subject", params.subject);
  if (params.chapter) qs.set("chapter", params.chapter);
  if (params.tagId) qs.set("tagId", params.tagId);
  if (params.questionType) qs.set("questionType", params.questionType);
  if (params.minWrongCount)
    qs.set("minWrongCount", String(params.minWrongCount));
  if (params.minConsecutiveWrong)
    qs.set("minConsecutiveWrong", String(params.minConsecutiveWrong));
  qs.set("includeResolved", params.includeResolved ? "true" : "false");
  if (params.mistakeStatus) qs.set("mistakeStatus", params.mistakeStatus);
  if (params.confidence) qs.set("confidence", params.confidence);
  if (params.highConfWrongOnly) qs.set("highConfWrongOnly", "true");
  if (params.guessCorrectOnly) qs.set("guessCorrectOnly", "true");
  if (params.lowConfidenceOnly) qs.set("lowConfidenceOnly", "true");
  if (params.dueOnly) qs.set("dueOnly", "true");
  if (params.starredOnly) qs.set("starredOnly", "true");
  if (params.masteryLevel) qs.set("masteryLevel", params.masteryLevel);
  if (params.examAttemptId) qs.set("examAttemptId", params.examAttemptId);
  if (params.days) qs.set("days", String(params.days));
  qs.set("page", String(params.page ?? 1));
  qs.set("pageSize", String(Math.min(200, params.pageSize ?? 100)));

  const res = await requestJson<unknown>(`/api/mistakes?${qs.toString()}`);
  const rawList: unknown[] = Array.isArray(res.data)
    ? res.data
    : res.data && typeof res.data === "object" && "items" in res.data
      ? ((res.data as { items?: unknown[] }).items ?? [])
      : [];

  const items: MistakeItem[] = rawList
    .map((entry): MistakeItem | null => {
      if (!entry || typeof entry !== "object") return null;
      const obj = entry as Record<string, unknown>;
      if ("progress" in obj && obj.progress && "question" in obj && obj.question) {
        const prog = obj.progress as UserQuestionProgress;
        const q = obj.question as Question;
        const studySetObj = obj.study_set as
          | { id?: string; title?: string; subject?: string | null }
          | null
          | undefined;
        const lastWrong = obj.last_wrong_answer as
          | {
              selected_option_ids?: string[];
              typed_answer?: string | null;
              answered_at?: string;
              attempt_id?: string | null;
            }
          | null
          | undefined;
        const resolved = Boolean(obj.resolved);
        return {
          question_id: prog.question_id,
          study_set_id: prog.study_set_id,
          study_set_title: studySetObj?.title,
          subject: studySetObj?.subject ?? null,
          chapter: q.chapter,
          wrong_count: prog.wrong_count,
          correct_count: prog.correct_count,
          consecutive_correct: prog.consecutive_correct,
          consecutive_wrong: prog.consecutive_wrong ?? 0,
          mastery_level: prog.mastery_level,
          last_wrong_at:
            prog.last_wrong_at ?? lastWrong?.answered_at ?? prog.last_reviewed_at,
          last_reviewed_at: prog.last_reviewed_at,
          next_review_at: prog.next_review_at,
          last_selected_option_ids: lastWrong?.selected_option_ids ?? [],
          last_typed_answer: lastWrong?.typed_answer ?? null,
          last_confidence: prog.last_confidence ?? null,
          low_confidence_count: prog.low_confidence_count ?? 0,
          high_conf_wrong_count: prog.high_conf_wrong_count ?? 0,
          guess_correct_count: prog.guess_correct_count ?? 0,
          mistake_status:
            prog.mistake_status ?? (resolved ? "resolved" : "active"),
          recent_exam_attempt_id: lastWrong?.attempt_id ?? null,
          needs_review: !resolved,
          is_starred: Boolean(obj.is_starred),
          question: q,
        };
      }
      if ("question_id" in obj && "question" in obj) {
        return obj as unknown as MistakeItem;
      }
      return null;
    })
    .filter((item): item is MistakeItem => item !== null);

  return { items, total: res.meta?.total ?? items.length };
}

export async function resolveMistake(questionId: string): Promise<void> {
  await requestJson<unknown>(
    `/api/mistakes/${encodeURIComponent(questionId)}/resolve`,
    { method: "POST" },
  );
}

// ============================================================================
// Study Sessions & V2.0 Custom Subset Practice
// ============================================================================

export async function createStudySession(payload: {
  study_set_id: string | null;
  source_study_set_ids?: string[];
  mode: StudyMode;
  config?: Record<string, unknown>;
  total_items?: number;
}): Promise<StudySession> {
  const res = await requestJson<StudySession>("/api/sessions", {
    method: "POST",
    body: JSON.stringify({
      study_set_id: payload.study_set_id,
      source_study_set_ids: payload.source_study_set_ids,
      mode: payload.mode,
      config: payload.config ?? {},
      total_items: payload.total_items ?? 0,
    }),
  });
  return res.data;
}

export async function recordStudySessionAnswer(
  sessionId: string,
  payload: {
    question_id: string;
    selected_option_ids?: string[];
    typed_answer?: string | null;
    structured_response?: StructuredAnswerResponse | null;
    confidence?: ConfidenceLevel | null;
    hint_used?: boolean;
    is_correct?: boolean;
    self_rating?: SelfRating | null;
    response_time_ms?: number | null;
    update_progress?: boolean;
  },
): Promise<{
  is_correct: boolean;
  progress?: UserQuestionProgress;
}> {
  const res = await requestJson<{
    is_correct: boolean;
    progress?: UserQuestionProgress;
  }>(`/api/sessions/${encodeURIComponent(sessionId)}/answers`, {
    method: "POST",
    body: JSON.stringify({
      question_id: payload.question_id,
      selected_option_ids: payload.selected_option_ids ?? [],
      typed_answer: payload.typed_answer ?? null,
      structured_response: payload.structured_response ?? null,
      confidence: payload.confidence ?? null,
      hint_used: payload.hint_used ?? false,
      is_correct: payload.is_correct,
      self_rating: payload.self_rating ?? null,
      response_time_ms: payload.response_time_ms ?? null,
      update_progress: payload.update_progress ?? true,
    }),
  });
  return res.data;
}

export async function updateStudySession(
  sessionId: string,
  payload: {
    status?: SessionStatus;
    total_items?: number;
    completed_items?: number;
    correct_items?: number;
    duration_seconds?: number;
  },
): Promise<StudySession> {
  const res = await requestJson<StudySession>(
    `/api/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
  );
  return res.data;
}

export interface PracticePoolRequest {
  sources: ExamSourceInput[];
  mode: StudyMode;
  count?: number | null;
  selection_policy?: SelectionPolicy;
  shuffle_questions?: boolean;
  filters?: ExamFilterConfig;
  create_session?: boolean;
}

export async function fetchPracticeQuestionPool(
  payload: PracticePoolRequest,
): Promise<PracticePoolResponse> {
  const res = await requestJson<PracticePoolResponse>("/api/practice/questions", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return res.data;
}

// ============================================================================
// Examination Engine (V1.0 + V2.0 Universal Custom Exams)
// ============================================================================

export interface ExamEligibleRequest {
  folder_ids?: string[];
  study_set_ids?: string[];
  sources?: ExamSourceInput[];
  include_subfolders?: boolean;
  selection_policy?: SelectionPolicy;
  filters?: ExamFilterConfig;
}

export async function fetchExamEligiblePool(
  payload: ExamEligibleRequest,
): Promise<ExamEligiblePool> {
  const res = await requestJson<ExamEligiblePool>("/api/exams/eligible", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return res.data;
}

export interface ExamPreviewRequest {
  sources: ExamSourceInput[];
  requested_question_count: number;
  allocation_strategy: AllocationStrategy;
  selection_policy: SelectionPolicy;
  full_coverage_mode?: boolean;
  questions_per_exam?: number;
  duration_limit_seconds?: number | null;
  pass_threshold?: number;
  filters?: ExamFilterConfig;
}

export async function previewExamConfig(
  payload: ExamPreviewRequest,
): Promise<ExamPreviewResult> {
  const res = await requestJson<ExamPreviewResult>("/api/exams/preview", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return res.data;
}

export interface CreateExamPayload {
  // V1.0 backwards-compatible fields
  study_set_id?: string | null;
  additional_study_set_ids?: string[];
  // V2.0 universal multi-subject fields
  sources?: ExamSourceInput[];
  preset_id?: string | null;
  title?: string;
  question_count: number;
  allocation_strategy?: AllocationStrategy;
  selection_policy?: SelectionPolicy;
  duration_limit_seconds?: number | null;
  shuffle_questions?: boolean;
  shuffle_options?: boolean;
  show_subject_names?: boolean;
  show_chapter_names?: boolean;
  allow_navigation?: boolean;
  allow_mark_for_review?: boolean;
  auto_submit_on_expire?: boolean;
  show_review_after_submit?: boolean;
  pass_threshold?: number;
  chapters?: string[];
  tag_ids?: string[];
  difficulties?: DifficultyLevel[];
  question_types?: ExamQuestionType[];
  filters?: ExamFilterConfig;
  only_starred?: boolean;
  only_unmastered?: boolean;
  only_mistakes?: boolean;
  question_ids?: string[];
}

export interface ExamAttemptPayload {
  attempt: ExamAttempt;
  sources?: ExamAttemptSource[];
  questions: ExamSnapshotQuestion[];
  answers: ExamAttemptAnswer[];
  subject_breakdown?: ExamSubjectBreakdown[];
  chapter_breakdown?: ExamChapterBreakdown[];
  tag_breakdown?: ExamTagBreakdown[];
  coverage_cycle?: CoverageCycle | null;
  server_now?: string;
  remaining_seconds?: number | null;
}

export async function listExams(params: {
  studySetId?: string;
  status?: ExamStatus;
  page?: number;
  pageSize?: number;
} = {}): Promise<ExamAttempt[]> {
  const qs = new URLSearchParams();
  if (params.studySetId) qs.set("studySetId", params.studySetId);
  if (params.status) qs.set("status", params.status);
  qs.set("page", String(params.page ?? 1));
  qs.set("pageSize", String(params.pageSize ?? 25));

  const res = await requestJson<ExamAttempt[] | { attempts: ExamAttempt[] }>(
    `/api/exams?${qs.toString()}`,
  );
  if (Array.isArray(res.data)) return res.data;
  if (res.data && "attempts" in res.data) return res.data.attempts;
  return [];
}

export async function createExamAttempt(
  payload: CreateExamPayload,
): Promise<ExamAttemptPayload> {
  const res = await requestJson<ExamAttemptPayload>("/api/exams", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return res.data;
}

export async function fetchExamAttempt(
  attemptId: string,
): Promise<ExamAttemptPayload> {
  const res = await requestJson<ExamAttemptPayload>(
    `/api/exams/${encodeURIComponent(attemptId)}`,
  );
  return res.data;
}

export interface ExamAnswerSaveItem {
  attempt_question_id: string;
  selected_option_ids: string[];
  typed_answer?: string | null;
  structured_response?: StructuredAnswerResponse | null;
  confidence?: ConfidenceLevel | null;
  hint_used?: boolean;
  is_flagged: boolean;
  client_seq?: number;
}

export interface SaveExamAnswersResult {
  saved?: ExamAttemptAnswer[];
  stale_ignored_ids?: string[];
  answered_count?: number;
  server_now?: string;
  remaining_seconds?: number | null;
}

const EXAM_AUTOSAVE_CHUNK_SIZE = 150;

/**
 * Chunked (`<=150` items/request) exam answer autosave with monotonic `client_seq`.
 * Prevents HTTP 400 data loss when resyncing >200 offline answers on 250–1,000Q exams (SH-010).
 */
export async function saveExamAnswers(
  attemptId: string,
  items: ExamAnswerSaveItem[],
): Promise<SaveExamAnswersResult> {
  if (items.length === 0) return {};

  let lastResult: SaveExamAnswersResult = {};
  for (let i = 0; i < items.length; i += EXAM_AUTOSAVE_CHUNK_SIZE) {
    const chunk = items.slice(i, i + EXAM_AUTOSAVE_CHUNK_SIZE);
    const body = chunk.length === 1 ? chunk[0] : { answers: chunk };
    const res = await requestJson<SaveExamAnswersResult>(
      `/api/exams/${encodeURIComponent(attemptId)}/answers`,
      {
        method: "PUT",
        body: JSON.stringify(body),
      },
    );
    lastResult = res.data ?? {};
  }
  return lastResult;
}

export async function submitExamAttempt(
  attemptId: string,
): Promise<ExamAttemptPayload> {
  const res = await requestJson<ExamAttemptPayload>(
    `/api/exams/${encodeURIComponent(attemptId)}/submit`,
    {
      method: "POST",
    },
  );
  return res.data;
}

// ============================================================================
// V2.0 Exam Presets (Private, Config-Only)
// ============================================================================

export interface CreateExamPresetPayload {
  name: string;
  description?: string | null;
  is_favorite?: boolean;
  sources: ExamSourceInput[];
  requested_question_count: number | null;
  allocation_strategy: AllocationStrategy;
  selection_policy: SelectionPolicy;
  full_coverage_mode?: boolean;
  duration_limit_seconds?: number | null;
  pass_threshold?: number;
  shuffle_questions?: boolean;
  shuffle_options?: boolean;
  show_subject_names?: boolean;
  show_chapter_names?: boolean;
  allow_navigation?: boolean;
  allow_mark_for_review?: boolean;
  auto_submit_on_expire?: boolean;
  show_review_after_submit?: boolean;
  filters?: ExamFilterConfig;
}

export async function listExamPresets(params?: {
  favoritesOnly?: boolean;
  search?: string;
}): Promise<ExamPreset[]> {
  const qs = new URLSearchParams({ page: "1", pageSize: "50" });
  if (params?.favoritesOnly) qs.set("favoritesOnly", "true");
  if (params?.search?.trim()) qs.set("search", params.search.trim());
  const res = await requestJson<ExamPreset[] | { presets: ExamPreset[] }>(
    `/api/exam-presets?${qs.toString()}`,
  );
  if (Array.isArray(res.data)) return res.data;
  if (res.data && "presets" in res.data) return res.data.presets;
  return [];
}

export async function fetchExamPreset(id: string): Promise<ExamPreset> {
  const res = await requestJson<ExamPreset>(
    `/api/exam-presets/${encodeURIComponent(id)}`,
  );
  return res.data;
}

export async function createExamPreset(
  payload: CreateExamPresetPayload,
): Promise<ExamPreset> {
  const res = await requestJson<ExamPreset>("/api/exam-presets", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return res.data;
}

export async function updateExamPreset(
  id: string,
  payload: Partial<CreateExamPresetPayload>,
): Promise<ExamPreset> {
  const res = await requestJson<ExamPreset>(
    `/api/exam-presets/${encodeURIComponent(id)}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
  );
  return res.data;
}

export async function deleteExamPreset(id: string): Promise<void> {
  await requestJson<unknown>(`/api/exam-presets/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function duplicateExamPreset(
  id: string,
  name?: string,
): Promise<ExamPreset> {
  const res = await requestJson<ExamPreset>(
    `/api/exam-presets/${encodeURIComponent(id)}/duplicate`,
    {
      method: "POST",
      body: JSON.stringify(name ? { name } : {}),
    },
  );
  return res.data;
}

// ============================================================================
// V2.0 Full Coverage Cycles
// ============================================================================

export interface CreateCoverageCyclePayload {
  title: string;
  sources: ExamSourceInput[];
  filters?: ExamFilterConfig;
  allocation_strategy: AllocationStrategy;
  questions_per_exam: number;
  duration_limit_seconds?: number | null;
  pass_threshold?: number;
  shuffle_options?: boolean;
  show_subject_names?: boolean;
  show_chapter_names?: boolean;
  allow_navigation?: boolean;
  allow_mark_for_review?: boolean;
  auto_submit_on_expire?: boolean;
  show_review_after_submit?: boolean;
  preset_id?: string | null;
  start_first_exam?: boolean;
}

export async function listCoverageCycles(
  status?: "active" | "completed" | "archived",
): Promise<CoverageCycle[]> {
  const qs = new URLSearchParams();
  if (status) qs.set("status", status);
  const query = qs.toString();
  const res = await requestJson<CoverageCycle[] | { cycles: CoverageCycle[] }>(
    `/api/coverage-cycles${query ? `?${query}` : ""}`,
  );
  if (Array.isArray(res.data)) return res.data;
  if (res.data && "cycles" in res.data) return res.data.cycles;
  return [];
}

export async function createCoverageCycleApi(
  payload: CreateCoverageCyclePayload,
): Promise<{
  cycle: CoverageCycle;
  first_exam?: ExamAttemptPayload | null;
}> {
  const res = await requestJson<
    | { cycle: CoverageCycle; first_exam?: ExamAttemptPayload | null }
    | CoverageCycle
  >("/api/coverage-cycles", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (res.data && "cycle" in res.data) {
    return res.data;
  }
  return { cycle: res.data as CoverageCycle, first_exam: null };
}

export async function fetchCoverageCycle(id: string): Promise<CoverageCycle> {
  const res = await requestJson<CoverageCycle>(
    `/api/coverage-cycles/${encodeURIComponent(id)}`,
  );
  return res.data;
}

export async function deleteCoverageCycle(id: string): Promise<void> {
  await requestJson<unknown>(`/api/coverage-cycles/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function issueCoverageNextExam(
  cycleId: string,
): Promise<ExamAttemptPayload> {
  const res = await requestJson<ExamAttemptPayload>(
    `/api/coverage-cycles/${encodeURIComponent(cycleId)}/next-exam`,
    { method: "POST" },
  );
  return res.data;
}

export async function discardCoverageActiveExam(
  cycleId: string,
): Promise<CoverageCycle> {
  const res = await requestJson<
    | {
        discarded?: boolean;
        discarded_attempt_id?: string | null;
        released_questions?: number;
        cycle: CoverageCycle;
      }
    | CoverageCycle
  >(`/api/coverage-cycles/${encodeURIComponent(cycleId)}/discard-active`, {
    method: "POST",
  });
  if (res.data && "cycle" in res.data && res.data.cycle) {
    return res.data.cycle;
  }
  return res.data as CoverageCycle;
}

export async function restartCoverageCycleApi(
  cycleId: string,
  options?: { refresh_pool?: boolean; force_discard_active?: boolean },
): Promise<CoverageCycle> {
  const res = await requestJson<CoverageCycle>(
    `/api/coverage-cycles/${encodeURIComponent(cycleId)}/restart`,
    {
      method: "POST",
      body: JSON.stringify(options ?? {}),
    },
  );
  return res.data;
}

// ============================================================================
// V3.0 Learning Session Checkpoints (Resume Learning)
// ============================================================================

export async function listCheckpoints(params?: {
  studySetId?: string;
  mode?: V3StudyMode;
  sessionKey?: string;
}): Promise<LearningSessionCheckpoint[]> {
  const qs = new URLSearchParams();
  if (params?.studySetId) qs.set("studySetId", params.studySetId);
  if (params?.mode) qs.set("mode", params.mode);
  if (params?.sessionKey) qs.set("sessionKey", params.sessionKey);
  const query = qs.toString();
  const res = await requestJson<
    LearningSessionCheckpoint[] | { checkpoints: LearningSessionCheckpoint[] }
  >(`/api/checkpoints${query ? `?${query}` : ""}`);
  if (Array.isArray(res.data)) return res.data;
  if (res.data && "checkpoints" in res.data) return res.data.checkpoints;
  return [];
}

export interface UpsertCheckpointPayload {
  study_set_id?: string | null;
  mode: V3StudyMode;
  session_key: string;
  state_json: Record<string, unknown>;
  progress_percent: number;
  current_index: number;
  total_items: number;
  device_id?: string | null;
}

export async function upsertCheckpoint(
  payload: UpsertCheckpointPayload,
): Promise<LearningSessionCheckpoint> {
  const res = await requestJson<LearningSessionCheckpoint>("/api/checkpoints", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  return res.data;
}

export async function deleteCheckpoint(params: {
  id?: string;
  sessionKey?: string;
}): Promise<void> {
  const qs = new URLSearchParams();
  if (params.id) qs.set("id", params.id);
  if (params.sessionKey) qs.set("sessionKey", params.sessionKey);
  await requestJson<unknown>(`/api/checkpoints?${qs.toString()}`, {
    method: "DELETE",
  });
}

// ============================================================================
// V3.0 Scoped Reset Learning Progress
// ============================================================================

export async function resetLearningProgress(
  payload: ProgressResetRequest,
): Promise<ProgressResetResult> {
  const res = await requestJson<ProgressResetResult>("/api/progress/reset", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return res.data;
}

// ============================================================================
// V3.0 Personal Question Notes & Question Reports
// ============================================================================

export async function listQuestionNotes(params?: {
  studySetId?: string;
  questionId?: string;
}): Promise<UserQuestionNote[]> {
  const qs = new URLSearchParams();
  if (params?.studySetId) qs.set("studySetId", params.studySetId);
  if (params?.questionId) qs.set("questionId", params.questionId);
  const query = qs.toString();
  const res = await requestJson<
    UserQuestionNote[] | { notes: UserQuestionNote[] }
  >(`/api/notes${query ? `?${query}` : ""}`);
  if (Array.isArray(res.data)) return res.data;
  if (res.data && "notes" in res.data) return res.data.notes;
  return [];
}

export async function upsertQuestionNote(payload: {
  study_set_id: string;
  question_id: string;
  content_text: string;
  content_rich?: RichTextDoc | null;
  base_version?: number | null;
}): Promise<UserQuestionNote> {
  const res = await requestJson<UserQuestionNote>("/api/notes", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
  return res.data;
}

export async function deleteQuestionNote(questionId: string): Promise<void> {
  await requestJson<unknown>(
    `/api/notes?questionId=${encodeURIComponent(questionId)}`,
    { method: "DELETE" },
  );
}

export async function submitQuestionReport(payload: {
  study_set_id: string;
  question_id: string;
  category: QuestionReportCategory;
  description: string;
}): Promise<QuestionReport> {
  const res = await requestJson<QuestionReport>("/api/reports", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return res.data;
}
