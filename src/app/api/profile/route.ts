import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/security/authz";
import {
  apiSuccess,
  AppError,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import { updateProfileSchema } from "@/lib/validation/profile";

export async function GET(): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();

    const [{ data: profile, error: profErr }, { data: preferences, error: prefErr }] =
      await Promise.all([
        supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
        supabase
          .from("user_preferences")
          .select("*")
          .eq("user_id", user.id)
          .maybeSingle(),
      ]);

    if (profErr) throw profErr;
    if (prefErr) throw prefErr;

    if (!profile) {
      throw new AppError("NOT_FOUND", "Profile not found.", 404);
    }

    return apiSuccess({
      profile,
      preferences: preferences ?? null,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const body = await parseJsonBody(request);
    const input = updateProfileSchema.parse(body);

    const { data, error } = await supabase
      .from("profiles")
      .update(input)
      .eq("id", user.id)
      .select("*")
      .single();

    if (error) {
      if (error.code === "23505") {
        throw new AppError(
          "CONFLICT",
          "This username is already taken. Please choose another.",
          409,
        );
      }
      throw error;
    }

    return apiSuccess(data);
  } catch (err) {
    return handleApiError(err);
  }
}
