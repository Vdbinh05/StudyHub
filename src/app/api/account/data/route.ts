import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/security/authz";
import {
  apiSuccess,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { deleteAccountDataSchema } from "@/lib/validation/profile";

/**
 * Exports all personal StudyHub data belonging to the authenticated user as JSON.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();

    const [
      { data: profile },
      { data: preferences },
      { data: folders },
      { data: studySets },
      { data: progress },
      { data: starred },
      { data: sessions },
      { data: exams },
      { data: tags },
    ] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
      supabase.from("user_preferences").select("*").eq("user_id", user.id).maybeSingle(),
      supabase.from("folders").select("*").eq("owner_id", user.id),
      supabase.from("study_sets").select("*").eq("owner_id", user.id),
      supabase.from("user_question_progress").select("*").eq("user_id", user.id),
      supabase.from("starred_questions").select("*").eq("user_id", user.id),
      supabase.from("study_sessions").select("*").eq("user_id", user.id),
      supabase.from("exam_attempts").select("*").eq("user_id", user.id),
      supabase.from("tags").select("*").eq("owner_id", user.id),
    ]);

    const ownedSetIds = (studySets ?? []).map((s) => s.id);
    const [{ data: questions }, { data: options }, { data: accepted }] =
      ownedSetIds.length > 0
        ? await Promise.all([
            supabase.from("questions").select("*").in("study_set_id", ownedSetIds),
            supabase.from("question_options").select("*").in("study_set_id", ownedSetIds),
            supabase
              .from("question_accepted_answers")
              .select("*")
              .in("study_set_id", ownedSetIds),
          ])
        : [{ data: [] }, { data: [] }, { data: [] }];

    const exportPayload = {
      exported_at: new Date().toISOString(),
      schema_version: "studyhub-v1",
      profile,
      preferences,
      folders: folders ?? [],
      study_sets: studySets ?? [],
      questions: questions ?? [],
      question_options: options ?? [],
      question_accepted_answers: accepted ?? [],
      tags: tags ?? [],
      progress: progress ?? [],
      starred_questions: starred ?? [],
      study_sessions: sessions ?? [],
      exam_attempts: exams ?? [],
    };

    return new NextResponse(JSON.stringify(exportPayload, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="studyhub-export-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}

/**
 * Deletes the authenticated user's study data (or full auth account if `scope === "account"`
 * and server admin client is configured).
 */
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const body = await parseJsonBody(request);
    const input = deleteAccountDataSchema.parse(body);

    // Clear user-owned resources cleanly (foreign keys cascade child rows)
    await Promise.all([
      supabase.from("exam_attempts").delete().eq("user_id", user.id),
      supabase.from("study_sessions").delete().eq("user_id", user.id),
      supabase.from("user_question_progress").delete().eq("user_id", user.id),
      supabase.from("starred_questions").delete().eq("user_id", user.id),
      supabase.from("import_jobs").delete().eq("user_id", user.id),
      supabase.from("study_sets").delete().eq("owner_id", user.id),
      supabase.from("folders").delete().eq("owner_id", user.id),
      supabase.from("tags").delete().eq("owner_id", user.id),
    ]);

    let accountDeleted = false;
    if (input.scope === "account") {
      const admin = tryCreateAdminClient();
      if (admin) {
        const { error: delAuthErr } = await admin.auth.admin.deleteUser(user.id);
        if (delAuthErr) throw delAuthErr;
        accountDeleted = true;
      }
      await supabase.auth.signOut();
    }

    return apiSuccess({
      cleared: true,
      scope: input.scope,
      account_deleted: accountDeleted,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
