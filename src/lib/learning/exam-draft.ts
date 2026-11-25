import type { ConfidenceLevel, StructuredAnswerResponse } from "@/types/domain";

export const EXAM_DRAFT_PREFIX_V3 = "studyhub-exam-draft-v3:";
const LEGACY_EXAM_DRAFT_PREFIX_V2 = "studyhub-exam-draft-v2-";
export const EXAM_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
export const EXAM_DRAFT_MAX_ENTRIES = 20;

export interface ExamDraftEntry {
  selectedOptionIds: string[];
  typedAnswer: string;
  structuredResponse: StructuredAnswerResponse | null;
  confidence: ConfidenceLevel | null;
  hintUsed: boolean;
  isFlagged: boolean;
  clientSeq: number;
}

export interface ExamDraftPayloadV3 {
  version: 3;
  userId: string;
  attemptId: string;
  updatedAt: number;
  currentQuestionIndex: number;
  entries: Record<string, ExamDraftEntry>;
}

export function buildExamDraftKey(userId: string, attemptId: string): string {
  const safeUser = userId.trim() || "anon";
  return `${EXAM_DRAFT_PREFIX_V3}${safeUser}:${attemptId}`;
}

/**
 * Evict stale (>7 days) and excess (>20 newest) exam drafts from `localStorage`
 * to prevent unbounded quota growth (MEM-02) and remove legacy unpartitioned v2 drafts.
 */
export function pruneStaleExamDrafts(
  nowMs: number = Date.now(),
  maxAgeMs: number = EXAM_DRAFT_TTL_MS,
  maxEntries: number = EXAM_DRAFT_MAX_ENTRIES,
): number {
  if (typeof window === "undefined") return 0;

  let removed = 0;
  try {
    const v3Drafts: Array<{ key: string; updatedAt: number }> = [];
    const keysToRemove: string[] = [];

    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key) continue;

      if (key.startsWith(LEGACY_EXAM_DRAFT_PREFIX_V2)) {
        // Legacy v2 drafts were unpartitioned across accounts — prune them immediately
        keysToRemove.push(key);
        continue;
      }

      if (!key.startsWith(EXAM_DRAFT_PREFIX_V3)) continue;

      const raw = window.localStorage.getItem(key);
      if (!raw) {
        keysToRemove.push(key);
        continue;
      }

      try {
        const parsed = JSON.parse(raw) as Partial<ExamDraftPayloadV3>;
        const updatedAt =
          typeof parsed.updatedAt === "number" && Number.isFinite(parsed.updatedAt)
            ? parsed.updatedAt
            : 0;
        if (
          parsed.version !== 3 ||
          !parsed.attemptId ||
          !parsed.userId ||
          updatedAt <= 0 ||
          nowMs - updatedAt > maxAgeMs
        ) {
          keysToRemove.push(key);
        } else {
          v3Drafts.push({ key, updatedAt });
        }
      } catch {
        keysToRemove.push(key);
      }
    }

    if (v3Drafts.length > maxEntries) {
      v3Drafts.sort((a, b) => b.updatedAt - a.updatedAt);
      for (const overflow of v3Drafts.slice(maxEntries)) {
        keysToRemove.push(overflow.key);
      }
    }

    for (const key of keysToRemove) {
      window.localStorage.removeItem(key);
      removed += 1;
    }
  } catch {
    // Ignore storage access errors in private browsing
  }

  return removed;
}

/**
 * Synchronously persist an active exam draft (answers, flags, and `currentQuestionIndex`)
 * partitioned by authenticated `userId` and `attemptId`.
 */
export function saveExamDraft(
  userId: string,
  attemptId: string,
  entries: Record<string, ExamDraftEntry>,
  currentQuestionIndex: number,
  nowMs: number = Date.now(),
): void {
  if (typeof window === "undefined") return;
  const safeUser = userId.trim();
  if (!safeUser || !attemptId) return;

  const payload: ExamDraftPayloadV3 = {
    version: 3,
    userId: safeUser,
    attemptId,
    updatedAt: nowMs,
    currentQuestionIndex: Math.max(0, Math.floor(currentQuestionIndex)),
    entries,
  };

  try {
    const key = buildExamDraftKey(safeUser, attemptId);
    window.localStorage.setItem(key, JSON.stringify(payload));
    pruneStaleExamDrafts(nowMs);
  } catch {
    // Attempt aggressive prune once on quota exceeded, then retry once
    try {
      pruneStaleExamDrafts(nowMs, EXAM_DRAFT_TTL_MS, Math.max(1, EXAM_DRAFT_MAX_ENTRIES - 5));
      const key = buildExamDraftKey(safeUser, attemptId);
      window.localStorage.setItem(key, JSON.stringify(payload));
    } catch {
      // Ignore unrecoverable storage quota errors
    }
  }
}

/**
 * Read a user-partitioned exam draft for `(userId, attemptId)`.
 * Strictly verifies `parsed.userId === userId && parsed.attemptId === attemptId`
 * and drops expired drafts (>7 days).
 */
export function loadExamDraft(
  userId: string,
  attemptId: string,
  nowMs: number = Date.now(),
): ExamDraftPayloadV3 | null {
  if (typeof window === "undefined") return null;
  const safeUser = userId.trim();
  if (!safeUser || !attemptId) return null;

  try {
    const key = buildExamDraftKey(safeUser, attemptId);
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ExamDraftPayloadV3>;
    if (
      parsed.version !== 3 ||
      parsed.userId !== safeUser ||
      parsed.attemptId !== attemptId ||
      typeof parsed.updatedAt !== "number"
    ) {
      window.localStorage.removeItem(key);
      return null;
    }
    if (nowMs - parsed.updatedAt > EXAM_DRAFT_TTL_MS) {
      window.localStorage.removeItem(key);
      return null;
    }
    const entries =
      parsed.entries && typeof parsed.entries === "object"
        ? parsed.entries
        : {};
    const currentQuestionIndex =
      typeof parsed.currentQuestionIndex === "number" &&
      Number.isFinite(parsed.currentQuestionIndex) &&
      parsed.currentQuestionIndex >= 0
        ? Math.floor(parsed.currentQuestionIndex)
        : 0;
    return {
      version: 3,
      userId: parsed.userId,
      attemptId: parsed.attemptId,
      updatedAt: parsed.updatedAt,
      currentQuestionIndex,
      entries,
    };
  } catch {
    return null;
  }
}

export function clearExamDraft(userId: string, attemptId: string): void {
  if (typeof window === "undefined") return;
  try {
    if (userId.trim()) {
      window.localStorage.removeItem(buildExamDraftKey(userId, attemptId));
    }
    window.localStorage.removeItem(`${LEGACY_EXAM_DRAFT_PREFIX_V2}${attemptId}`);
  } catch {
    // Ignore
  }
}
