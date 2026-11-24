import type {
  ExamAttempt,
  ExamAttemptAnswer,
  ExamSnapshotQuestion,
  MasteryLevel,
  Question,
  SelfRating,
  SessionStatus,
  StudyMode,
  StudySession,
  StudySet,
  UserQuestionProgress,
} from "@/types/domain";

export interface ApiEnvelope<T> {
  data: T;
  meta?: {
    total?: number;
    page?: number;
    pageSize?: number;
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
 * Validate safe image URLs before rendering `<img src>` (blocks javascript:, data:text/html, vbscript:).
 */
export function isSafeDisplayImageUrl(url: string | null | undefined): url is string {
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
// Study Sets & Questions
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

export async function fetchAccessibleSets(): Promise<StudySet[]> {
  const res = await requestJson<StudySet[] | { sets: StudySet[] }>(
    "/api/sets?page=1&pageSize=100",
  );
  if (Array.isArray(res.data)) return res.data;
  if (res.data && typeof res.data === "object" && "sets" in res.data) {
    return res.data.sets;
  }
  return [];
}

/**
 * Fetch all questions for a study set using paginated chunks (max 500/page) up to `maxQuestions`.
 */
export async function fetchStudySetQuestions(
  setId: string,
  maxQuestions: number = 2000,
): Promise<Question[]> {
  const pageSize = 500;
  const all: Question[] = [];
  let page = 1;

  while (all.length < maxQuestions) {
    const res = await requestJson<Question[] | { questions: Question[] }>(
      `/api/sets/${encodeURIComponent(setId)}/questions?page=${page}&pageSize=${pageSize}`,
    );
    const items = Array.isArray(res.data)
      ? res.data
      : res.data && "questions" in res.data
        ? res.data.questions
        : [];
    all.push(...items);
    const total = res.meta?.total;
    if (items.length < pageSize || (typeof total === "number" && all.length >= total)) {
      break;
    }
    page += 1;
  }

  return all.slice(0, maxQuestions);
}

// ============================================================================
// Progress & Starred
// ============================================================================

export async function fetchSetProgress(
  studySetId: string,
): Promise<UserQuestionProgress[]> {
  const res = await requestJson<
    UserQuestionProgress[] | { progress: UserQuestionProgress[] }
  >(`/api/progress?studySetId=${encodeURIComponent(studySetId)}&page=1&pageSize=500`);
  if (Array.isArray(res.data)) return res.data;
  if (res.data && "progress" in res.data) return res.data.progress;
  return [];
}

export interface UpsertProgressPayload {
  study_set_id: string;
  question_id: string;
  is_correct: boolean;
  self_rating?: SelfRating | null;
  mastery_level?: MasteryLevel;
  ease_factor?: number;
  interval_days?: number;
  repetitions?: number;
  next_review_at?: string | null;
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
  limit: number = 100,
): Promise<DueQuestionItem[]> {
  const params = new URLSearchParams({ limit: String(limit) });
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
): Promise<StarredQuestionItem[]> {
  const params = new URLSearchParams({ page: "1", pageSize: "200" });
  if (studySetId) params.set("studySetId", studySetId);
  const res = await requestJson<unknown>(`/api/starred?${params.toString()}`);
  const rawList: unknown[] = Array.isArray(res.data)
    ? res.data
    : res.data && typeof res.data === "object" && "items" in res.data
      ? ((res.data as { items?: unknown[] }).items ?? [])
      : [];

  return rawList
    .map((entry): StarredQuestionItem | null => {
      if (!entry || typeof entry !== "object") return null;
      const obj = entry as Record<string, unknown>;
      // Shape from GET /api/starred: { starred_at, study_set, question }
      if ("question" in obj && obj.question && typeof obj.question === "object") {
        const q = obj.question as Question;
        const studySetObj = obj.study_set as { id?: string; title?: string } | null | undefined;
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
          progress: (obj.progress as UserQuestionProgress | null | undefined) ?? null,
        };
      }
      if ("question_id" in obj) {
        return obj as unknown as StarredQuestionItem;
      }
      return null;
    })
    .filter((item): item is StarredQuestionItem => item !== null);
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
  chapter?: string | null;
  wrong_count: number;
  correct_count: number;
  consecutive_correct: number;
  mastery_level: MasteryLevel;
  last_wrong_at?: string | null;
  last_reviewed_at?: string | null;
  last_selected_option_ids?: string[];
  last_typed_answer?: string | null;
  needs_review: boolean;
  is_starred?: boolean;
  question: Question;
}

export interface ListMistakesParams {
  studySetId?: string;
  chapter?: string;
  minWrongCount?: number;
  includeResolved?: boolean;
  days?: number;
  page?: number;
  pageSize?: number;
}

export async function fetchMistakes(
  params: ListMistakesParams = {},
): Promise<{ items: MistakeItem[]; total: number }> {
  const qs = new URLSearchParams();
  if (params.studySetId) qs.set("studySetId", params.studySetId);
  if (params.chapter) qs.set("chapter", params.chapter);
  if (params.minWrongCount) qs.set("minWrongCount", String(params.minWrongCount));
  qs.set("includeResolved", params.includeResolved ? "true" : "false");
  if (params.days) qs.set("days", String(params.days));
  qs.set("page", String(params.page ?? 1));
  qs.set("pageSize", String(params.pageSize ?? 100));

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
      // Shape from GET /api/mistakes: { progress, resolved, is_starred, last_wrong_answer, study_set, question }
      if ("progress" in obj && obj.progress && "question" in obj && obj.question) {
        const prog = obj.progress as UserQuestionProgress;
        const q = obj.question as Question;
        const studySetObj = obj.study_set as { id?: string; title?: string } | null | undefined;
        const lastWrong = obj.last_wrong_answer as
          | {
              selected_option_ids?: string[];
              typed_answer?: string | null;
              answered_at?: string;
            }
          | null
          | undefined;
        const resolved = Boolean(obj.resolved);
        return {
          question_id: prog.question_id,
          study_set_id: prog.study_set_id,
          study_set_title: studySetObj?.title,
          chapter: q.chapter,
          wrong_count: prog.wrong_count,
          correct_count: prog.correct_count,
          consecutive_correct: prog.consecutive_correct,
          mastery_level: prog.mastery_level,
          last_wrong_at: lastWrong?.answered_at ?? prog.last_reviewed_at,
          last_reviewed_at: prog.last_reviewed_at,
          last_selected_option_ids: lastWrong?.selected_option_ids ?? [],
          last_typed_answer: lastWrong?.typed_answer ?? null,
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
// Study Sessions
// ============================================================================

export async function createStudySession(payload: {
  study_set_id: string;
  mode: StudyMode;
  config?: Record<string, unknown>;
  total_items?: number;
}): Promise<StudySession> {
  const res = await requestJson<StudySession>("/api/sessions", {
    method: "POST",
    body: JSON.stringify({
      study_set_id: payload.study_set_id,
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

// ============================================================================
// Examination Engine
// ============================================================================

export interface CreateExamPayload {
  study_set_id: string;
  additional_study_set_ids?: string[];
  title?: string;
  question_count: number;
  duration_limit_seconds?: number | null;
  shuffle_questions?: boolean;
  shuffle_options?: boolean;
  pass_threshold?: number;
  chapters?: string[];
  tag_ids?: string[];
  difficulties?: ("easy" | "medium" | "hard")[];
  question_types?: ("single_choice" | "multiple_choice" | "true_false" | "short_answer")[];
  only_starred?: boolean;
  only_unmastered?: boolean;
  only_mistakes?: boolean;
  question_ids?: string[];
}

export interface ExamAttemptPayload {
  attempt: ExamAttempt;
  questions: ExamSnapshotQuestion[];
  answers: ExamAttemptAnswer[];
  server_now?: string;
  remaining_seconds?: number | null;
}

export async function listExams(params: {
  studySetId?: string;
  status?: "in_progress" | "submitted" | "expired";
  page?: number;
  pageSize?: number;
}): Promise<ExamAttempt[]> {
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
  is_flagged: boolean;
}

export async function saveExamAnswers(
  attemptId: string,
  items: ExamAnswerSaveItem[],
): Promise<void> {
  if (items.length === 0) return;
  const body = items.length === 1 ? items[0] : { answers: items };
  await requestJson<unknown>(
    `/api/exams/${encodeURIComponent(attemptId)}/answers`,
    {
      method: "PUT",
      body: JSON.stringify(body),
    },
  );
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
