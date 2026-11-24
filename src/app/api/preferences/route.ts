import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/security/authz";
import {
  apiSuccess,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import type { Json } from "@/types/database";
import { updatePreferencesSchema } from "@/lib/validation/profile";

function mergeModePreferences(
  existing: unknown,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const base =
    existing && typeof existing === "object" && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  for (const [section, value] of Object.entries(incoming)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const prevSection =
        base[section] &&
        typeof base[section] === "object" &&
        !Array.isArray(base[section])
          ? (base[section] as Record<string, unknown>)
          : {};
      base[section] = { ...prevSection, ...(value as Record<string, unknown>) };
    }
  }
  return base;
}

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

    const { mode_preferences, ...rest } = input;
    let mergedModePreferences: Json | undefined;

    if (mode_preferences !== undefined) {
      const { data: existing } = await supabase
        .from("user_preferences")
        .select("mode_preferences")
        .eq("user_id", user.id)
        .maybeSingle();

      mergedModePreferences = mergeModePreferences(
        existing?.mode_preferences,
        mode_preferences as Record<string, unknown>,
      ) as Json;
    }

    const { data, error } = await supabase
      .from("user_preferences")
      .upsert(
        {
          user_id: user.id,
          ...rest,
          ...(mergedModePreferences !== undefined
            ? { mode_preferences: mergedModePreferences }
            : {}),
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
