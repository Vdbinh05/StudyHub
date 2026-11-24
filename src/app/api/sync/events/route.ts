import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/security/authz";
import {
  apiSuccess,
  AppError,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import {
  enforceDistributedRateLimit,
  RATE_LIMITS,
} from "@/lib/security/rate-limit";
import { sanitizeRichTextDoc, sanitizeText } from "@/lib/security/sanitize";
import { rpcSyncOfflineLearningEvents } from "@/lib/supabase/rpc";
import { syncEventsBatchSchema } from "@/lib/validation/v3";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Idempotent Offline Learning Sync Endpoint (V3.0).
 * Deduplicates by `event_id`, ignores stale events predating `progress_generation` resets,
 * rejects events for revoked shares or deleted entities, sanitizes offline rich-text notes,
 * and returns non-destructive `conflict` results with `server_data` when note versions diverge.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const limited = await enforceDistributedRateLimit(
      request,
      RATE_LIMITS.SYNC_EVENTS,
      user.id,
    );
    if (limited) return limited;

    // Allow up to 2 MB batch payload for rich notes/checkpoints (max 200 events)
    const body = syncEventsBatchSchema.parse(
      await parseJsonBody(request, 2 * 1024 * 1024),
    );

    // V3-SEC-04: Sanitize rich-text AST & plain text on offline `note_upsert` payloads before RPC
    const sanitizedEvents = body.events.map((ev) => {
      if (ev.event_type !== "note_upsert") {
        return ev;
      }
      const nextPayload: Record<string, unknown> = { ...ev.payload };
      if (typeof nextPayload.content_text === "string") {
        nextPayload.content_text = sanitizeText(nextPayload.content_text, 10_000);
      }
      if ("content_rich" in nextPayload && nextPayload.content_rich !== null) {
        nextPayload.content_rich = sanitizeRichTextDoc(nextPayload.content_rich);
      }
      return {
        ...ev,
        payload: nextPayload,
      };
    });

    const { data, error } = await rpcSyncOfflineLearningEvents(
      supabase,
      sanitizedEvents,
    );
    if (error) throw error;
    if (!data) {
      throw new AppError("INTERNAL_ERROR", "Failed to process offline sync batch.", 500);
    }

    return apiSuccess(data);
  } catch (err) {
    return handleApiError(err);
  }
}
