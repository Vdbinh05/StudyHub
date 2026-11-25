import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/security/authz";
import { apiSuccess, AppError, handleApiError } from "@/lib/security/errors";
import { isValidStudyMediaPath } from "@/lib/security/sanitize";

const SIGNED_URL_TTL_SECONDS = 300;

/**
 * Mints a short-lived signed URL for an authorized private `study-media` Storage object path (SH-019).
 * Access is enforced by the caller's authenticated Supabase session + `storage.objects` RLS.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase } = await requireAuth();
    const rawPath = request.nextUrl.searchParams.get("path")?.trim() ?? "";

    if (!isValidStudyMediaPath(rawPath)) {
      throw new AppError(
        "VALIDATION_ERROR",
        "Invalid or disallowed storage media path.",
        400,
      );
    }

    const { data, error } = await supabase.storage
      .from("study-media")
      .createSignedUrl(rawPath, SIGNED_URL_TTL_SECONDS);

    if (error || !data?.signedUrl) {
      throw new AppError(
        "NOT_FOUND",
        "Media file not found or you do not have access to view it.",
        404,
      );
    }

    if (request.nextUrl.searchParams.get("redirect") === "1") {
      const redirectResponse = NextResponse.redirect(data.signedUrl, 302);
      // V32-008 / SEC-09: Short private browser cache (60s) + 5-min signed URL TTL for rapid share revocation
      redirectResponse.headers.set(
        "Cache-Control",
        "private, max-age=60, must-revalidate",
      );
      redirectResponse.headers.set("Vary", "Cookie");
      return redirectResponse;
    }

    return apiSuccess(
      {
        path: rawPath,
        signedUrl: data.signedUrl,
        expiresIn: SIGNED_URL_TTL_SECONDS,
      },
      undefined,
      {
        headers: {
          "Cache-Control": "private, no-store",
          Vary: "Cookie",
        },
      },
    );
  } catch (err) {
    return handleApiError(err);
  }
}
