import type { LearningSessionCheckpoint, V3StudyMode } from "@/types/domain";

const LOCAL_CHECKPOINT_PREFIX = "studyhub-v3-checkpoint";
const LOCAL_CHECKPOINT_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const LOCAL_CHECKPOINT_MAX_PER_USER = 30;

export interface LocalCheckpointEnvelope {
  version: 1;
  userId: string;
  studySetId: string | null;
  mode: V3StudyMode;
  sessionKey: string;
  currentIndex: number;
  totalItems: number;
  progressPercent: number;
  stateJson: Record<string, unknown>;
  /** Set of idempotent event keys already persisted so F5 refresh never double-records progress. */
  committedEventKeys: string[];
  updatedAt: string;
}

/**
 * Deterministic session key identifying a resumable learning checkpoint.
 */
export function makeCheckpointSessionKey(
  mode: V3StudyMode,
  studySetId: string | null,
  variant: string = "default",
): string {
  const cleanVariant = variant.trim().replace(/[^a-zA-Z0-9_-]/g, "_") || "default";
  return `${mode}:${studySetId ?? "multi"}:${cleanVariant}`;
}

/**
 * Deterministic idempotency key preventing duplicate learning events on refresh/resume.
 */
export function buildLearningEventKey(
  sessionKey: string,
  questionId: string,
  attemptNumber: number,
): string {
  return `${sessionKey}:${questionId}:${Math.max(1, Math.floor(attemptNumber))}`;
}

export interface CheckpointReconciliationResult {
  validIds: string[];
  removedIds: string[];
  hasDrift: boolean;
  safeIndex: number;
}

/**
 * Reconcile a persisted checkpoint's question IDs against the current live study set.
 * Cleanly drops deleted questions and clamps `currentIndex` without crashing.
 */
export function reconcileCheckpointQuestions(
  savedQuestionIds: readonly string[],
  liveQuestionIds: ReadonlySet<string>,
  savedCurrentIndex: number,
): CheckpointReconciliationResult {
  const validIds: string[] = [];
  const removedIds: string[] = [];
  let removedBeforeIndex = 0;

  savedQuestionIds.forEach((id, idx) => {
    if (liveQuestionIds.has(id)) {
      validIds.push(id);
    } else {
      removedIds.push(id);
      if (idx < savedCurrentIndex) {
        removedBeforeIndex += 1;
      }
    }
  });

  const adjustedIndex = Math.max(0, savedCurrentIndex - removedBeforeIndex);
  const safeIndex =
    validIds.length === 0
      ? 0
      : Math.min(adjustedIndex, validIds.length - 1);

  return {
    validIds,
    removedIds,
    hasDrift: removedIds.length > 0,
    safeIndex,
  };
}

/**
 * Determine whether a local checkpoint or remote server checkpoint is newer.
 */
export function pickNewestCheckpoint(
  remote: LearningSessionCheckpoint | null | undefined,
  local: LocalCheckpointEnvelope | null | undefined,
): {
  source: "remote" | "local" | "none";
  currentIndex: number;
  totalItems: number;
  progressPercent: number;
  stateJson: Record<string, unknown>;
  updatedAt: string | null;
  checkpointId: string | null;
} {
  if (!remote && !local) {
    return {
      source: "none",
      currentIndex: 0,
      totalItems: 0,
      progressPercent: 0,
      stateJson: {},
      updatedAt: null,
      checkpointId: null,
    };
  }
  if (remote && !local) {
    return {
      source: "remote",
      currentIndex: remote.current_index,
      totalItems: remote.total_items,
      progressPercent: remote.progress_percent,
      stateJson: remote.state_json ?? {},
      updatedAt: remote.updated_at,
      checkpointId: remote.id,
    };
  }
  if (!remote && local) {
    return {
      source: "local",
      currentIndex: local.currentIndex,
      totalItems: local.totalItems,
      progressPercent: local.progressPercent,
      stateJson: local.stateJson ?? {},
      updatedAt: local.updatedAt,
      checkpointId: null,
    };
  }

  const remoteMs = Date.parse(remote!.updated_at);
  const localMs = Date.parse(local!.updatedAt);
  if (!Number.isNaN(localMs) && (Number.isNaN(remoteMs) || localMs > remoteMs)) {
    return {
      source: "local",
      currentIndex: local!.currentIndex,
      totalItems: local!.totalItems,
      progressPercent: local!.progressPercent,
      stateJson: local!.stateJson ?? {},
      updatedAt: local!.updatedAt,
      checkpointId: remote!.id,
    };
  }

  return {
    source: "remote",
    currentIndex: remote!.current_index,
    totalItems: remote!.total_items,
    progressPercent: remote!.progress_percent,
    stateJson: remote!.state_json ?? {},
    updatedAt: remote!.updated_at,
    checkpointId: remote!.id,
  };
}

function buildLocalStorageKey(userId: string, sessionKey: string): string {
  // Strictly partitioned by `userId` to prevent cross-account data bleed on shared browsers
  const safeUser = userId.trim() || "anon";
  return `${LOCAL_CHECKPOINT_PREFIX}:${safeUser}:${sessionKey}`;
}

export function pruneLocalCheckpointsForUser(
  userId: string,
  nowMs: number = Date.now(),
  maxAgeMs: number = LOCAL_CHECKPOINT_TTL_MS,
  maxEntries: number = LOCAL_CHECKPOINT_MAX_PER_USER,
): number {
  if (typeof window === "undefined") return 0;
  const prefix = `${LOCAL_CHECKPOINT_PREFIX}:${userId.trim() || "anon"}:`;
  let removed = 0;
  try {
    const valid: Array<{ key: string; updatedMs: number }> = [];
    const keysToDelete: string[] = [];

    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (!k || !k.startsWith(prefix)) continue;
      const raw = window.localStorage.getItem(k);
      if (!raw) {
        keysToDelete.push(k);
        continue;
      }
      try {
        const parsed = JSON.parse(raw) as Partial<LocalCheckpointEnvelope>;
        const updatedMs = parsed.updatedAt ? Date.parse(parsed.updatedAt) : Number.NaN;
        if (
          parsed.version !== 1 ||
          Number.isNaN(updatedMs) ||
          nowMs - updatedMs > maxAgeMs
        ) {
          keysToDelete.push(k);
        } else {
          valid.push({ key: k, updatedMs });
        }
      } catch {
        keysToDelete.push(k);
      }
    }

    if (valid.length > maxEntries) {
      valid.sort((a, b) => b.updatedMs - a.updatedMs);
      for (const overflow of valid.slice(maxEntries)) {
        keysToDelete.push(overflow.key);
      }
    }

    for (const k of keysToDelete) {
      window.localStorage.removeItem(k);
      removed += 1;
    }
  } catch {
    // Ignore storage access errors
  }
  return removed;
}

export function saveLocalCheckpoint(envelope: LocalCheckpointEnvelope): void {
  if (typeof window === "undefined") return;
  try {
    const key = buildLocalStorageKey(envelope.userId, envelope.sessionKey);
    const trimmedEvents = envelope.committedEventKeys.slice(-500);
    window.localStorage.setItem(
      key,
      JSON.stringify({ ...envelope, committedEventKeys: trimmedEvents }),
    );
    pruneLocalCheckpointsForUser(envelope.userId);
  } catch {
    // Ignore storage quota / private-browsing errors
  }
}

export function loadLocalCheckpoint(
  userId: string,
  sessionKey: string,
): LocalCheckpointEnvelope | null {
  if (typeof window === "undefined") return null;
  try {
    const key = buildLocalStorageKey(userId, sessionKey);
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LocalCheckpointEnvelope>;
    if (
      parsed.version !== 1 ||
      parsed.userId !== userId ||
      parsed.sessionKey !== sessionKey
    ) {
      return null;
    }
    return {
      version: 1,
      userId: parsed.userId,
      studySetId: parsed.studySetId ?? null,
      mode: parsed.mode as V3StudyMode,
      sessionKey: parsed.sessionKey,
      currentIndex:
        typeof parsed.currentIndex === "number" ? parsed.currentIndex : 0,
      totalItems: typeof parsed.totalItems === "number" ? parsed.totalItems : 0,
      progressPercent:
        typeof parsed.progressPercent === "number" ? parsed.progressPercent : 0,
      stateJson:
        parsed.stateJson && typeof parsed.stateJson === "object"
          ? parsed.stateJson
          : {},
      committedEventKeys: Array.isArray(parsed.committedEventKeys)
        ? parsed.committedEventKeys.filter(
            (k): k is string => typeof k === "string",
          )
        : [],
      updatedAt:
        typeof parsed.updatedAt === "string"
          ? parsed.updatedAt
          : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function clearLocalCheckpoint(userId: string, sessionKey: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(buildLocalStorageKey(userId, sessionKey));
  } catch {
    // Ignore
  }
}

/**
 * Clear ALL local checkpoints belonging to a given user (e.g., on scoped Reset Progress / logout).
 */
export function clearAllLocalCheckpointsForUser(
  userId: string,
  filterStudySetId?: string | null,
): number {
  if (typeof window === "undefined") return 0;
  const prefix = `${LOCAL_CHECKPOINT_PREFIX}:${userId.trim() || "anon"}:`;
  let removed = 0;
  try {
    const keysToDelete: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k || !k.startsWith(prefix)) continue;
      if (filterStudySetId) {
        const raw = window.localStorage.getItem(k);
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as Partial<LocalCheckpointEnvelope>;
            if (parsed.studySetId !== filterStudySetId) continue;
          } catch {
            // Corrupt entry — safe to clear
          }
        }
      }
      keysToDelete.push(k);
    }
    for (const k of keysToDelete) {
      window.localStorage.removeItem(k);
      removed += 1;
    }
  } catch {
    // Ignore
  }
  return removed;
}
