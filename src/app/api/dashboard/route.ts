import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/security/authz";
import { apiSuccess, handleApiError } from "@/lib/security/errors";

export async function GET(): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const nowIso = new Date().toISOString();
    const fourteenDaysAgoIso = new Date(
      Date.now() - 14 * 86_400_000,
    ).toISOString();
    const todayPrefix = nowIso.slice(0, 10);

    const [
      { data: profile },
      { data: preferences },
      { data: sets, error: setsErr },
      { data: progressRows, error: progErr },
      { data: recentExams, error: examErr },
      { data: recentSessions, error: sessErr },
      { data: recentAnswers, error: ansErr },
      { count: starredCount },
    ] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, display_name, username, avatar_url, email")
        .eq("id", user.id)
        .maybeSingle(),
      supabase
        .from("user_preferences")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("study_sets")
        .select("*")
        .eq("owner_id", user.id)
        .eq("is_archived", false)
        .order("updated_at", { ascending: false })
        .limit(50),
      supabase
        .from("user_question_progress")
        .select("study_set_id, mastery_level, correct_count, wrong_count, next_review_at")
        .eq("user_id", user.id),
      supabase
        .from("exam_attempts")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("study_sessions")
        .select("*")
        .eq("user_id", user.id)
        .order("started_at", { ascending: false })
        .limit(10),
      supabase
        .from("study_session_answers")
        .select("is_correct, answered_at")
        .eq("user_id", user.id)
        .gte("answered_at", fourteenDaysAgoIso)
        .limit(5000),
      supabase
        .from("starred_questions")
        .select("question_id", { count: "exact", head: true })
        .eq("user_id", user.id),
    ]);

    if (setsErr) throw setsErr;
    if (progErr) throw progErr;
    if (examErr) throw examErr;
    if (sessErr) throw sessErr;
    if (ansErr) throw ansErr;

    const allSets = sets ?? [];
    const totalQuestions = allSets.reduce((sum, s) => sum + s.question_count, 0);

    let masteredCount = 0;
    let dueCount = 0;
    let mistakeCount = 0;
    let totalCorrect = 0;
    let totalWrong = 0;

    for (const p of progressRows ?? []) {
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

    // 14-day activity chart + today's goal progress
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

    let todayAnswers = 0;
    for (const a of recentAnswers ?? []) {
      const key = a.answered_at.slice(0, 10);
      if (key === todayPrefix) todayAnswers += 1;
      const bucket = dailyMap.get(key);
      if (bucket) {
        bucket.answers += 1;
        if (a.is_correct) bucket.correct += 1;
      }
    }

    const continueLearning = allSets
      .filter((s) => s.last_studied_at !== null)
      .sort((a, b) =>
        (b.last_studied_at ?? "").localeCompare(a.last_studied_at ?? ""),
      )
      .slice(0, 4);

    return apiSuccess({
      profile: profile ?? null,
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
      },
      continue_learning: continueLearning,
      recent_sets: allSets.slice(0, 6),
      recent_exams: (recentExams ?? []).slice(0, 5),
      in_progress_exams: (recentExams ?? []).filter(
        (e) => e.status === "in_progress",
      ),
      recent_sessions: (recentSessions ?? []).slice(0, 5),
      activity_14d: Array.from(dailyMap.values()),
    });
  } catch (err) {
    return handleApiError(err);
  }
}
