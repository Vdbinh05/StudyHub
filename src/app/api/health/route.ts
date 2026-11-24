import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { apiSuccess } from "@/lib/security/errors";

export async function GET(): Promise<NextResponse> {
  return apiSuccess({
    status: "ok",
    timestamp: new Date().toISOString(),
    supabaseConfigured: isSupabaseConfigured(),
  });
}
