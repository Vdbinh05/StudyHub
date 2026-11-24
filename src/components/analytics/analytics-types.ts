import type {
  ExamAttempt,
  LearningSessionCheckpoint,
  MasteryLevel,
  StudySession,
  StudySet,
} from "@/types/domain";

export interface DailyActivityPoint {
  date: string;
  label: string;
  answered: number;
  correct: number;
  accuracy: number;
  durationSeconds: number;
}

export interface MasteryCounts {
  new: number;
  learning: number;
  familiar: number;
  mastered: number;
}

export interface TopicPerformance {
  studySetId: string;
  studySetTitle: string;
  chapter: string | null;
  subject?: string | null;
  totalAnswered: number;
  correctCount: number;
  wrongCount: number;
  accuracy: number;
}

export interface DashboardSummary {
  displayName?: string | null;
  totalSets: number;
  totalQuestions: number;
  masteredQuestions: number;
  dueForReview: number;
  studyAccuracy: number;
  streakDays: number;
  dailyGoal: number;
  todayAnswered: number;
  continueSet: StudySet | null;
  recentSets: StudySet[];
  recentExams: ExamAttempt[];
  recentSessions: StudySession[];
  activeCheckpoints: LearningSessionCheckpoint[];
  activitySeries: DailyActivityPoint[];
}

export interface StatisticsSummary {
  streakDays: number;
  longestStreakDays: number;
  totalAnswered: number;
  totalCorrect: number;
  overallAccuracy: number;
  totalStudySeconds: number;
  masteredQuestions: number;
  dueForReview: number;
  mastery: MasteryCounts;
  dailyActivity: DailyActivityPoint[];
  examTrend: Array<{
    attemptId: string;
    studySetId: string | null;
    title: string;
    date: string;
    scorePercent: number;
    passed: boolean;
  }>;
  performanceBySet: TopicPerformance[];
  weakTopics: TopicPerformance[];
}

export function normalizeMasteryCounts(raw: unknown): MasteryCounts {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    new: Number(obj.new ?? 0) || 0,
    learning: Number(obj.learning ?? 0) || 0,
    familiar: Number(obj.familiar ?? 0) || 0,
    mastered: Number(obj.mastered ?? 0) || 0,
  };
}

export function normalizeActivityPoints(raw: unknown): DailyActivityPoint[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const rec = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const date = String(rec.date ?? rec.day ?? "");
    const answered =
      Number(rec.answered ?? rec.answers ?? rec.questions_answered ?? rec.total ?? 0) || 0;
    const correct = Number(rec.correct ?? rec.correct_count ?? 0) || 0;
    const accuracy =
      rec.accuracy !== undefined || rec.accuracy_percent !== undefined
        ? Math.round(Number(rec.accuracy ?? rec.accuracy_percent) || 0)
        : answered > 0
          ? Math.round((correct / answered) * 100)
          : 0;
    const durationSeconds =
      Number(rec.durationSeconds ?? rec.duration_seconds ?? rec.study_seconds ?? 0) || 0;
    return {
      date,
      label: date ? date.slice(5) : "",
      answered,
      correct,
      accuracy,
      durationSeconds,
    };
  });
}

export function normalizeTopicList(raw: unknown): TopicPerformance[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const rec = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const correctCount = Number(rec.correctCount ?? rec.correct_count ?? 0) || 0;
    const wrongCount = Number(rec.wrongCount ?? rec.wrong_count ?? 0) || 0;
    const totalAnswered =
      Number(rec.totalAnswered ?? rec.total_answered ?? rec.attempts ?? correctCount + wrongCount) ||
      0;
    const accuracy =
      rec.accuracy !== undefined || rec.accuracy_percent !== undefined
        ? Math.round(Number(rec.accuracy ?? rec.accuracy_percent) || 0)
        : totalAnswered > 0
          ? Math.round((correctCount / totalAnswered) * 100)
          : 0;
    return {
      studySetId: String(rec.studySetId ?? rec.study_set_id ?? ""),
      studySetTitle: String(rec.studySetTitle ?? rec.study_set_title ?? rec.title ?? "—"),
      chapter: rec.chapter ? String(rec.chapter) : null,
      subject: rec.subject ? String(rec.subject) : null,
      totalAnswered,
      correctCount,
      wrongCount,
      accuracy,
    };
  });
}

export function getMasteryLabel(level: MasteryLevel, locale: "vi" | "en"): string {
  const map: Record<MasteryLevel, { vi: string; en: string }> = {
    new: { vi: "Mới", en: "New" },
    learning: { vi: "Đang học", en: "Learning" },
    familiar: { vi: "Quen thuộc", en: "Familiar" },
    mastered: { vi: "Thành thạo", en: "Mastered" },
  };
  return map[level][locale];
}
