import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/security/authz";
import {
  apiSuccess,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import { updatePreferencesSchema } from "@/lib/validation/profile";

export async function GET(): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();

    const { data, error } = await supabase
      .from("user_preferences")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      const { data: created, error: createErr } = await supabase
        .from("user_preferences")
        .insert({ user_id: user.id })
        .select("*")
        .single();
      if (createErr) throw createErr;
      return apiSuccess(created);
    }

    return apiSuccess(data);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const body = await parseJsonBody(request);
    const input = updatePreferencesSchema.parse(body);

    const { data, error } = await supabase
      .from("user_preferences")
      .upsert(
        {
          user_id: user.id,
          ...input,
        },
        { onConflict: "user_id" },
      )
      .select("*")
      .single();

    if (error) throw error;

    return apiSuccess(data);
  } catch (err) {
    return handleApiError(err);
  }
}
