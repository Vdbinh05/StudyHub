import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/security/authz";
import { apiSuccess, handleApiError } from "@/lib/security/errors";
import {
  fetchAllPages,
  fetchInChunks,
  SAFE_IN_CHUNK_SIZE,
} from "@/lib/supabase/query-helpers";
import {
  isMissingRpcError,
  rpcGetUserStatisticsSummary,
} from "@/lib/supabase/rpc";

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

    // DB-07 (Migration 0019): Single-RTT SQL aggregation replaces 6+ paginated full-table scans in Node
    const { data: rpcStats, error: rpcErr } = await rpcGetUserStatisticsSummary(
      supabase,
      days,
    );
    if (!rpcErr && rpcStats) {
      return apiSuccess(rpcStats);
    }
    if (rpcErr && !isMissingRpcError(rpcErr)) {
      throw rpcErr;
    }

    const sinceDate = new Date(Date.now() - days * 86_400_000);
    const sinceIso = sinceDate.toISOString();

    // SH-005 & SH-036 + V3: Paginate all analytics sources including confidence calibration!
    const [progressRows, sessionRows, answerRows, examRows, setRows, confidenceRows] =
      await Promise.all([
        fetchAllPages(async (from, to) =>
          supabase
            .from("user_question_progress")
            .select(
              "study_set_id, question_id, mastery_level, correct_count, wrong_count, next_review_at",
            )
            .eq("user_id", user.id)
            .range(from, to),
        ),
        fetchAllPages(async (from, to) =>
          supabase
            .from("study_sessions")
            .select(
              "id, study_set_id, mode, status, completed_items, correct_items, duration_seconds, started_at, completed_at",
            )
            .eq("user_id", user.id)
            .gte("started_at", sinceIso)
            .order("started_at", { ascending: true })
            .range(from, to),
        ),
        fetchAllPages(async (from, to) =>
          supabase
            .from("study_session_answers")
            .select("is_correct, answered_at, study_set_id")
            .eq("user_id", user.id)
            .gte("answered_at", sinceIso)
            .order("answered_at", { ascending: true })
            .range(from, to),
        ),
        fetchAllPages(async (from, to) =>
          supabase
            .from("exam_attempts")
            .select(
              "id, study_set_id, study_set_title_snapshot, status, total_questions, answered_count, correct_count, wrong_count, unanswered_count, score_percent, passed, time_spent_seconds, submitted_at, created_at",
            )
            .eq("user_id", user.id)
            .in("status", ["submitted", "expired"])
            .gte("submitted_at", sinceIso)
            .order("submitted_at", { ascending: true })
            .range(from, to),
        ),
        fetchAllPages(async (from, to) =>
          supabase
            .from("study_sets")
            .select("id, title, subject, question_count")
            .eq("owner_id", user.id)
            .eq("is_archived", false)
            .range(from, to),
        ),
        fetchAllPages(async (from, to) =>
          supabase
            .from("learning_confidence_events")
            .select("confidence, is_correct, hint_used")
            .eq("user_id", user.id)
            .gte("created_at", sinceIso)
            .range(from, to),
        ),
      ]);

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

    const ownedSetIds = new Set(setRows.map((s) => s.id));
    let ownedTrackedCount = 0;

    const setStatsMap = new Map<
      string,
      { correct: number; wrong: number; mastered: number; totalTracked: number }
    >();

    for (const p of progressRows) {
      masteryDistribution[p.mastery_level] += 1;
      totalCorrect += p.correct_count;
      totalWrong += p.wrong_count;
      if (ownedSetIds.has(p.study_set_id)) {
        ownedTrackedCount += 1;
      }
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

    const totalOwnedQuestions = setRows.reduce(
      (sum, s) => sum + s.question_count,
      0,
    );
    const untracked = Math.max(0, totalOwnedQuestions - ownedTrackedCount);
    masteryDistribution.new += untracked;

    // Daily activity series over requested range (includes BOTH sessions & exams!)
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

    for (const s of sessionRows) {
      const key = toDateKey(s.started_at);
      if (s.completed_items > 0) activeDates.add(key);
      totalStudySeconds += s.duration_seconds;
      const bucket = dailyMap.get(key);
      if (bucket) {
        bucket.sessions += 1;
        bucket.study_seconds += s.duration_seconds;
      }
    }

    for (const a of answerRows) {
      const key = toDateKey(a.answered_at);
      activeDates.add(key);
      const bucket = dailyMap.get(key);
      if (bucket) {
        bucket.answers += 1;
        if (a.is_correct) bucket.correct += 1;
      }
    }

    for (const e of examRows) {
      const ts = e.submitted_at ?? e.created_at;
      const key = toDateKey(ts);
      activeDates.add(key);
      totalStudySeconds += e.time_spent_seconds;
      const bucket = dailyMap.get(key);
      if (bucket) {
        bucket.exams += 1;
        bucket.answers += e.answered_count;
        bucket.correct += e.correct_count;
        bucket.study_seconds += e.time_spent_seconds;
      }
    }

    const streaks = computeStreaks(activeDates);

    // Fetch titles for any shared sets present in progress
    const setTitleMap = new Map(setRows.map((s) => [s.id, s]));
    const missingSetIds = Array.from(setStatsMap.keys()).filter(
      (id) => !setTitleMap.has(id),
    );
    if (missingSetIds.length > 0) {
      const extraSets = await fetchInChunks(
        missingSetIds,
        async (chunk) =>
          supabase
            .from("study_sets")
            .select("id, title, subject, question_count")
            .in("id", chunk),
        SAFE_IN_CHUNK_SIZE,
      );
      for (const s of extraSets) {
        setTitleMap.set(s.id, s);
      }
    }

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

    // SH-036: Compute true chapter accuracy across ALL tracked questions (not just wrong_count > 0!)
    // and keep null chapter as `null` instead of generating broken `?chapter=General` links!
    const allTrackedQuestionIds = progressRows
      .filter((p) => p.correct_count + p.wrong_count > 0)
      .map((p) => p.question_id);

    const weakChapters: Array<{
      study_set_id: string;
      study_set_title: string;
      chapter: string | null;
      wrong_count: number;
      correct_count: number;
      accuracy_percent: number;
    }> = [];

    if (allTrackedQuestionIds.length > 0) {
      const trackedQuestions = await fetchInChunks(
        allTrackedQuestionIds,
        async (chunk) =>
          supabase
            .from("questions")
            .select("id, study_set_id, chapter")
            .in("id", chunk),
        SAFE_IN_CHUNK_SIZE,
      );

      const qMetaMap = new Map(trackedQuestions.map((q) => [q.id, q]));
      const chapterAgg = new Map<
        string,
        {
          study_set_id: string;
          chapter: string | null;
          wrong_count: number;
          correct_count: number;
        }
      >();

      for (const p of progressRows) {
        if (p.correct_count + p.wrong_count === 0) continue;
        const qm = qMetaMap.get(p.question_id);
        if (!qm) continue;
        const chapter = qm.chapter?.trim() || null;
        const key = `${qm.study_set_id}::${chapter ?? "__none__"}`;
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
        if (agg.wrong_count === 0) continue;
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

    const confAgg = {
      certain: { total: 0, correct: 0 },
      unsure: { total: 0, correct: 0 },
      guessing: { total: 0, correct: 0 },
      high_conf_wrong: 0,
      guess_correct: 0,
    };
    for (const ev of confidenceRows) {
      const bucket = confAgg[ev.confidence as keyof Pick<typeof confAgg, "certain" | "unsure" | "guessing">];
      if (!bucket) continue;
      bucket.total += 1;
      if (ev.is_correct) bucket.correct += 1;
      if (ev.confidence === "certain" && !ev.is_correct) {
        confAgg.high_conf_wrong += 1;
      }
      if (ev.confidence === "guessing" && ev.is_correct) {
        confAgg.guess_correct += 1;
      }
    }

    const pct = (c: number, t: number): number =>
      t > 0 ? Math.round((c / t) * 10000) / 100 : 0;

    return apiSuccess({
      summary: {
        total_questions: totalOwnedQuestions,
        mastered_count: masteryDistribution.mastered,
        due_for_review: dueCount,
        overall_accuracy_percent: overallAccuracy,
        total_study_seconds: totalStudySeconds,
        total_sessions: sessionRows.length,
        total_exams: examRows.length,
        ...streaks,
      },
      mastery_distribution: masteryDistribution,
      confidence_calibration: {
        certain: {
          ...confAgg.certain,
          accuracy_percent: pct(confAgg.certain.correct, confAgg.certain.total),
        },
        unsure: {
          ...confAgg.unsure,
          accuracy_percent: pct(confAgg.unsure.correct, confAgg.unsure.total),
        },
        guessing: {
          ...confAgg.guessing,
          accuracy_percent: pct(confAgg.guessing.correct, confAgg.guessing.total),
        },
        high_conf_wrong: confAgg.high_conf_wrong,
        guess_correct: confAgg.guess_correct,
        total_events: confidenceRows.length,
      },
      daily_activity: Array.from(dailyMap.values()).map((d) => ({
        ...d,
        accuracy_percent:
          d.answers > 0 ? Math.round((d.correct / d.answers) * 10000) / 100 : 0,
      })),
      exam_score_trend: examRows.map((e) => ({
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
