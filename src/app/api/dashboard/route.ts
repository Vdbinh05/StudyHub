import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/security/authz";
import { apiSuccess, handleApiError } from "@/lib/security/errors";
import { fetchAllPages } from "@/lib/supabase/query-helpers";
import { rpcGetMyProfile } from "@/lib/supabase/rpc";

function computeCurrentStreak(activeDates: Set<string>): number {
  if (activeDates.size === 0) return 0;

  const cursor = new Date();
  cursor.setUTCHours(0, 0, 0, 0);
  const todayKey = cursor.toISOString().slice(0, 10);
  if (!activeDates.has(todayKey)) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  let streak = 0;
  while (activeDates.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

export async function GET(): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const nowIso = new Date().toISOString();
    const fourteenDaysAgoIso = new Date(
      Date.now() - 14 * 86_400_000,
    ).toISOString();
    const oneYearAgoIso = new Date(Date.now() - 365 * 86_400_000).toISOString();
    const todayPrefix = nowIso.slice(0, 10);

    const [
      { data: profile },
      { data: preferences },
      allSets,
      progressRows,
      { data: recentExams, error: examErr },
      { data: recentSessions, error: sessErr },
      recentSessionAnswers,
      streakExams,
      streakSessions,
      { count: starredCount },
    ] = await Promise.all([
      rpcGetMyProfile(supabase),
      supabase
        .from("user_preferences")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle(),
      // SH-005 & SH-036: Paginate all owned non-archived sets & progress (no 50-set / 1k-row cap)
      fetchAllPages(async (from, to) =>
        supabase
          .from("study_sets")
          .select("*")
          .eq("owner_id", user.id)
          .eq("is_archived", false)
          .order("updated_at", { ascending: false })
          .range(from, to),
      ),
      fetchAllPages(async (from, to) =>
        supabase
          .from("user_question_progress")
          .select("study_set_id, mastery_level, correct_count, wrong_count, next_review_at")
          .eq("user_id", user.id)
          .range(from, to),
      ),
      supabase
        .from("exam_attempts")
        .select("*")
        .eq("user_id", user.id)
        .neq("status", "discarded")
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("study_sessions")
        .select("*")
        .eq("user_id", user.id)
        .order("started_at", { ascending: false })
        .limit(10),
      fetchAllPages(async (from, to) =>
        supabase
          .from("study_session_answers")
          .select("is_correct, answered_at")
          .eq("user_id", user.id)
          .gte("answered_at", fourteenDaysAgoIso)
          .range(from, to),
      ),
      fetchAllPages(async (from, to) =>
        supabase
          .from("exam_attempts")
          .select("answered_count, correct_count, submitted_at, created_at")
          .eq("user_id", user.id)
          .in("status", ["submitted", "expired"])
          .gte("created_at", oneYearAgoIso)
          .range(from, to),
      ),
      fetchAllPages(async (from, to) =>
        supabase
          .from("study_sessions")
          .select("started_at, completed_items")
          .eq("user_id", user.id)
          .gte("started_at", oneYearAgoIso)
          .range(from, to),
      ),
      supabase
        .from("starred_questions")
        .select("question_id", { count: "exact", head: true })
        .eq("user_id", user.id),
    ]);

    if (examErr) throw examErr;
    if (sessErr) throw sessErr;

    const totalQuestions = allSets.reduce((sum, s) => sum + s.question_count, 0);

    let masteredCount = 0;
    let dueCount = 0;
    let mistakeCount = 0;
    let totalCorrect = 0;
    let totalWrong = 0;

    for (const p of progressRows) {
      if (p.mastery_level === "mastered") masteredCount += 1;
      if (p.next_review_at && p.next_review_at <= nowIso) dueCount += 1;
      if (p.wrong_count > 0 && p.mastery_level !== "mastered") mistakeCount += 1;
      totalCorrect += p.correct_count;
      totalWrong += p.wrong_count;
    }

    const totalAnswered = totalCorrect + totalWrong;
    const accuracyPercent =
      totalAnswered > 0
        ? Math.round((totalCorrect / totalAnswered) * 10000) / 100
        : 0;

    // 14-day activity chart + today's goal progress + streak (BOTH sessions AND exams! SH-036)
    const dailyMap = new Map<
      string,
      { date: string; answers: number; correct: number }
    >();
    for (let i = 13; i >= 0; i -= 1) {
      const key = new Date(Date.now() - i * 86_400_000)
        .toISOString()
        .slice(0, 10);
      dailyMap.set(key, { date: key, answers: 0, correct: 0 });
    }

    const activeDates = new Set<string>();
    let todayAnswers = 0;

    for (const s of streakSessions) {
      if (s.completed_items > 0) {
        activeDates.add(s.started_at.slice(0, 10));
      }
    }

    for (const a of recentSessionAnswers) {
      const key = a.answered_at.slice(0, 10);
      activeDates.add(key);
      if (key === todayPrefix) todayAnswers += 1;
      const bucket = dailyMap.get(key);
      if (bucket) {
        bucket.answers += 1;
        if (a.is_correct) bucket.correct += 1;
      }
    }

    for (const e of streakExams) {
      const ts = e.submitted_at ?? e.created_at;
      const key = ts.slice(0, 10);
      activeDates.add(key);
      if (key === todayPrefix) todayAnswers += e.answered_count;
      const bucket = dailyMap.get(key);
      if (bucket) {
        bucket.answers += e.answered_count;
        bucket.correct += e.correct_count;
      }
    }

    const streakDays = computeCurrentStreak(activeDates);

    const continueLearning = allSets
      .filter((s) => s.last_studied_at !== null)
      .sort((a, b) =>
        (b.last_studied_at ?? "").localeCompare(a.last_studied_at ?? ""),
      )
      .slice(0, 4);

    // SH-036: Exclude `in_progress` attempts from `recent_exams` so they NEVER show as `0% FAILED`!
    const completedExams = (recentExams ?? [])
      .filter((e) => e.status === "submitted" || e.status === "expired")
      .slice(0, 5);

    const inProgressExams = (recentExams ?? [])
      .filter((e) => e.status === "in_progress")
      .slice(0, 5);

    return apiSuccess({
      profile: profile
        ? { ...profile, email: profile.email || user.email || "" }
        : null,
      preferences: preferences ?? null,
      kpis: {
        total_sets: allSets.length,
        total_questions: totalQuestions,
        mastered_count: masteredCount,
        due_for_review: dueCount,
        mistakes_count: mistakeCount,
        starred_count: starredCount ?? 0,
        accuracy_percent: accuracyPercent,
        today_answers: todayAnswers,
        daily_goal: preferences?.daily_goal ?? 20,
        streak_days: streakDays,
        current_streak_days: streakDays,
      },
      continue_learning: continueLearning,
      recent_sets: allSets.slice(0, 6),
      recent_exams: completedExams,
      in_progress_exams: inProgressExams,
      recent_sessions: (recentSessions ?? []).slice(0, 5),
      activity_14d: Array.from(dailyMap.values()),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
