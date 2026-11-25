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

    // V3-SEC-04 + DB-01: Sanitize offline rich-text notes AND deduplicate duplicate event_ids within the batch
    const seenEventIds = new Set<string>();
    const uniqueEvents: typeof body.events = [];
    const batchOrder: Array<{ eventId: string; isInBatchDuplicate: boolean }> = [];

    for (const ev of body.events) {
      if (seenEventIds.has(ev.event_id)) {
        batchOrder.push({ eventId: ev.event_id, isInBatchDuplicate: true });
        continue;
      }
      seenEventIds.add(ev.event_id);
      batchOrder.push({ eventId: ev.event_id, isInBatchDuplicate: false });

      if (ev.event_type !== "note_upsert") {
        uniqueEvents.push(ev);
        continue;
      }
      const nextPayload: Record<string, unknown> = { ...ev.payload };
      if (typeof nextPayload.content_text === "string") {
        nextPayload.content_text = sanitizeText(nextPayload.content_text, 10_000);
      }
      if ("content_rich" in nextPayload && nextPayload.content_rich !== null) {
        nextPayload.content_rich = sanitizeRichTextDoc(nextPayload.content_rich);
      }
      uniqueEvents.push({
        ...ev,
        payload: nextPayload,
      });
    }

    const { data, error } = await rpcSyncOfflineLearningEvents(
      supabase,
      uniqueEvents,
    );
    if (error) throw error;
    if (!data) {
      throw new AppError("INTERNAL_ERROR", "Failed to process offline sync batch.", 500);
    }

    // SEC-10: Collapse rejected_revoked / rejected_deleted into opaque rejected_inaccessible
    // so live responses never act as a cross-tenant existence oracle
    const OPAQUE_INACCESSIBLE_MESSAGE = "Study content is no longer accessible.";
    const rpcResultById = new Map<string, Record<string, unknown>>();
    for (const rawItem of data.results ?? []) {
      const item = rawItem as unknown as Record<string, unknown>;
      const status = typeof item.status === "string" ? item.status : "invalid";
      const normalized =
        status === "rejected_revoked" ||
        status === "rejected_deleted" ||
        status === "rejected_inaccessible"
          ? {
              ...item,
              status: "rejected_inaccessible",
              message: OPAQUE_INACCESSIBLE_MESSAGE,
            }
          : item;
      if (typeof item.event_id === "string") {
        rpcResultById.set(item.event_id, normalized);
      }
    }

    const normalizedResults = batchOrder.map(({ eventId, isInBatchDuplicate }) => {
      if (isInBatchDuplicate) {
        return {
          event_id: eventId,
          status: "duplicate_ignored",
          message: "Duplicate event_id within batch ignored.",
        };
      }
      return (
        rpcResultById.get(eventId) ?? {
          event_id: eventId,
          status: "invalid",
          message: "Event could not be processed.",
        }
      );
    });

    return apiSuccess({
      ...data,
      results: normalizedResults,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
