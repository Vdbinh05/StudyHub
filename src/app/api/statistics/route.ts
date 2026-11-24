import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/security/authz";
import { apiSuccess, handleApiError } from "@/lib/security/errors";

const statsQuerySchema = z.object({
  days: z.coerce.number().int().min(7).max(365).default(30),
});

function toDateKey(iso: string): string {
  return iso.slice(0, 10);
}

function computeStreaks(activeDates: Set<string>): {
  current_streak_days: number;
  longest_streak_days: number;
} {
  if (activeDates.size === 0) {
    return { current_streak_days: 0, longest_streak_days: 0 };
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  let currentStreak = 0;
  const cursor = new Date(today);
  const todayKey = cursor.toISOString().slice(0, 10);
  if (!activeDates.has(todayKey)) {
    // Allow streak to continue if user studied yesterday
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  while (activeDates.has(cursor.toISOString().slice(0, 10))) {
    currentStreak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  const sorted = Array.from(activeDates).sort();
  let longest = 1;
  let running = 1;
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = Date.parse(`${sorted[i - 1]}T00:00:00Z`);
    const curr = Date.parse(`${sorted[i]}T00:00:00Z`);
    if (curr - prev === 86_400_000) {
      running += 1;
      if (running > longest) longest = running;
    } else {
      running = 1;
    }
  }

  return {
    current_streak_days: currentStreak,
    longest_streak_days: Math.max(longest, currentStreak),
  };
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const { days } = statsQuerySchema.parse({
      days: request.nextUrl.searchParams.get("days") ?? 30,
    });

    const sinceDate = new Date(Date.now() - days * 86_400_000);
    const sinceIso = sinceDate.toISOString();

    const [
      { data: progressRows, error: progErr },
      { data: sessionRows, error: sessErr },
      { data: answerRows, error: ansErr },
      { data: examRows, error: examErr },
      { data: setRows, error: setErr },
    ] = await Promise.all([
      supabase
        .from("user_question_progress")
        .select(
          "study_set_id, question_id, mastery_level, correct_count, wrong_count, next_review_at",
        )
        .eq("user_id", user.id),
      supabase
        .from("study_sessions")
        .select("id, study_set_id, mode, status, completed_items, correct_items, duration_seconds, started_at, completed_at")
        .eq("user_id", user.id)
        .gte("started_at", sinceIso)
        .order("started_at", { ascending: true }),
      supabase
        .from("study_session_answers")
        .select("is_correct, answered_at, study_set_id")
        .eq("user_id", user.id)
        .gte("answered_at", sinceIso)
        .order("answered_at", { ascending: true })
        .limit(10000),
      supabase
        .from("exam_attempts")
        .select(
          "id, study_set_id, study_set_title_snapshot, status, total_questions, correct_count, wrong_count, unanswered_count, score_percent, passed, time_spent_seconds, submitted_at, created_at",
        )
        .eq("user_id", user.id)
        .in("status", ["submitted", "expired"])
        .order("submitted_at", { ascending: true })
        .limit(200),
      supabase
        .from("study_sets")
        .select("id, title, subject, question_count")
        .eq("owner_id", user.id)
        .eq("is_archived", false),
    ]);

    if (progErr) throw progErr;
    if (sessErr) throw sessErr;
    if (ansErr) throw ansErr;
    if (examErr) throw examErr;
    if (setErr) throw setErr;

    const nowIso = new Date().toISOString();
    const masteryDistribution = {
      new: 0,
      learning: 0,
      familiar: 0,
      mastered: 0,
    };

    let totalCorrect = 0;
    let totalWrong = 0;
    let dueCount = 0;

    const setStatsMap = new Map<
      string,
      { correct: number; wrong: number; mastered: number; totalTracked: number }
    >();

    for (const p of progressRows ?? []) {
      masteryDistribution[p.mastery_level] += 1;
      totalCorrect += p.correct_count;
      totalWrong += p.wrong_count;
      if (p.next_review_at && p.next_review_at <= nowIso) {
        dueCount += 1;
      }

      const entry = setStatsMap.get(p.study_set_id) ?? {
        correct: 0,
        wrong: 0,
        mastered: 0,
        totalTracked: 0,
      };
      entry.correct += p.correct_count;
      entry.wrong += p.wrong_count;
      entry.totalTracked += 1;
      if (p.mastery_level === "mastered") entry.mastered += 1;
      setStatsMap.set(p.study_set_id, entry);
    }

    const totalOwnedQuestions = (setRows ?? []).reduce(
      (sum, s) => sum + s.question_count,
      0,
    );
    const untracked = Math.max(
      0,
      totalOwnedQuestions - (progressRows ?? []).length,
    );
    masteryDistribution.new += untracked;

    // Daily activity series over requested range
    const dailyMap = new Map<
      string,
      {
        date: string;
        answers: number;
        correct: number;
        sessions: number;
        exams: number;
        study_seconds: number;
      }
    >();

    for (let i = days - 1; i >= 0; i -= 1) {
      const d = new Date(Date.now() - i * 86_400_000);
      const key = d.toISOString().slice(0, 10);
      dailyMap.set(key, {
        date: key,
        answers: 0,
        correct: 0,
        sessions: 0,
        exams: 0,
        study_seconds: 0,
      });
    }

    const activeDates = new Set<string>();
    let totalStudySeconds = 0;

    for (const s of sessionRows ?? []) {
      const key = toDateKey(s.started_at);
      activeDates.add(key);
      totalStudySeconds += s.duration_seconds;
      const bucket = dailyMap.get(key);
      if (bucket) {
        bucket.sessions += 1;
        bucket.study_seconds += s.duration_seconds;
      }
    }

    for (const a of answerRows ?? []) {
      const key = toDateKey(a.answered_at);
      activeDates.add(key);
      const bucket = dailyMap.get(key);
      if (bucket) {
        bucket.answers += 1;
        if (a.is_correct) bucket.correct += 1;
      }
    }

    for (const e of examRows ?? []) {
      const ts = e.submitted_at ?? e.created_at;
      const key = toDateKey(ts);
      activeDates.add(key);
      totalStudySeconds += e.time_spent_seconds;
      const bucket = dailyMap.get(key);
      if (bucket) {
        bucket.exams += 1;
        bucket.study_seconds += e.time_spent_seconds;
      }
    }

    const streaks = computeStreaks(activeDates);

    // Performance by study set & weak topics
    const setTitleMap = new Map((setRows ?? []).map((s) => [s.id, s]));
    const performanceBySet = Array.from(setStatsMap.entries())
      .map(([setId, stat]) => {
        const info = setTitleMap.get(setId);
        const attempts = stat.correct + stat.wrong;
        const accuracy =
          attempts > 0
            ? Math.round((stat.correct / attempts) * 10000) / 100
            : 0;
        return {
          study_set_id: setId,
          title: info?.title ?? "Shared Study Set",
          subject: info?.subject ?? null,
          total_questions: info?.question_count ?? stat.totalTracked,
          mastered_count: stat.mastered,
          correct_count: stat.correct,
          wrong_count: stat.wrong,
          accuracy_percent: accuracy,
        };
      })
      .sort((a, b) => a.accuracy_percent - b.accuracy_percent);

    // Weak chapters from questions with wrong_count > 0
    const weakQuestionIds = (progressRows ?? [])
      .filter((p) => p.wrong_count > 0)
      .map((p) => p.question_id)
      .slice(0, 500);

    const weakChapters: Array<{
      study_set_id: string;
      study_set_title: string;
      chapter: string;
      wrong_count: number;
      correct_count: number;
      accuracy_percent: number;
    }> = [];

    if (weakQuestionIds.length > 0) {
      const { data: weakQuestions } = await supabase
        .from("questions")
        .select("id, study_set_id, chapter")
        .in("id", weakQuestionIds);

      const qMetaMap = new Map((weakQuestions ?? []).map((q) => [q.id, q]));
      const chapterAgg = new Map<
        string,
        {
          study_set_id: string;
          chapter: string;
          wrong_count: number;
          correct_count: number;
        }
      >();

      for (const p of progressRows ?? []) {
        const qm = qMetaMap.get(p.question_id);
        if (!qm) continue;
        const chapter = qm.chapter?.trim() || "General";
        const key = `${qm.study_set_id}::${chapter}`;
        const agg = chapterAgg.get(key) ?? {
          study_set_id: qm.study_set_id,
          chapter,
          wrong_count: 0,
          correct_count: 0,
        };
        agg.wrong_count += p.wrong_count;
        agg.correct_count += p.correct_count;
        chapterAgg.set(key, agg);
      }

      for (const agg of chapterAgg.values()) {
        const total = agg.correct_count + agg.wrong_count;
        weakChapters.push({
          ...agg,
          study_set_title:
            setTitleMap.get(agg.study_set_id)?.title ?? "Study Set",
          accuracy_percent:
            total > 0
              ? Math.round((agg.correct_count / total) * 10000) / 100
              : 0,
        });
      }

      weakChapters.sort((a, b) => a.accuracy_percent - b.accuracy_percent);
    }

    const totalAttempts = totalCorrect + totalWrong;
    const overallAccuracy =
      totalAttempts > 0
        ? Math.round((totalCorrect / totalAttempts) * 10000) / 100
        : 0;

    return apiSuccess({
      summary: {
        total_questions: totalOwnedQuestions,
        mastered_count: masteryDistribution.mastered,
        due_for_review: dueCount,
        overall_accuracy_percent: overallAccuracy,
        total_study_seconds: totalStudySeconds,
        total_sessions: (sessionRows ?? []).length,
        total_exams: (examRows ?? []).length,
        ...streaks,
      },
      mastery_distribution: masteryDistribution,
      daily_activity: Array.from(dailyMap.values()).map((d) => ({
        ...d,
        accuracy_percent:
          d.answers > 0 ? Math.round((d.correct / d.answers) * 10000) / 100 : 0,
      })),
      exam_score_trend: (examRows ?? []).map((e) => ({
        id: e.id,
        study_set_id: e.study_set_id,
        title: e.study_set_title_snapshot,
        score_percent: Number(e.score_percent),
        passed: e.passed,
        total_questions: e.total_questions,
        correct_count: e.correct_count,
        submitted_at: e.submitted_at ?? e.created_at,
      })),
      performance_by_set: performanceBySet,
      weak_topics: weakChapters.slice(0, 12),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
