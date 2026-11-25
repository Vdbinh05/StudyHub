import { NextResponse, type NextRequest } from "next/server";
import { requireAuth } from "@/lib/security/authz";
import {
  apiSuccess,
  AppError,
  handleApiError,
  parseJsonBody,
} from "@/lib/security/errors";
import { sanitizePostgrestSearch } from "@/lib/security/sanitize";
import { fetchInChunks, SAFE_IN_CHUNK_SIZE } from "@/lib/supabase/query-helpers";
import {
  isMissingRpcError,
  rpcListAccessibleStudySets,
} from "@/lib/supabase/rpc";
import {
  createStudySetSchema,
  listSetsQuerySchema,
} from "@/lib/validation/sets";
import type { MemberRole, StudySet } from "@/types/domain";

const STUDY_SET_LIST_COLUMNS =
  "id, owner_id, folder_id, title, description, subject, set_type, visibility, source_language, question_count, default_exam_duration_minutes, default_pass_threshold, is_archived, is_favorite, content_version, last_studied_at, created_at, updated_at";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const rawParams = Object.fromEntries(request.nextUrl.searchParams.entries());
    const query = listSetsQuerySchema.parse(rawParams);

    const from = (query.page - 1) * query.pageSize;
    const to = from + query.pageSize - 1;

    // DB-06 & V32-037 (Migration 0019): Single-RTT RLS-aware SQL RPC eliminates waterfall,
    // removes 100-shared-set truncation, and supports server-side favoritesOnly across all scopes
    const { data: rpcList, error: rpcErr } = await rpcListAccessibleStudySets(
      supabase,
      {
        p_scope: query.scope,
        p_search: query.search ?? null,
        p_folder_id: query.folderId ?? null,
        p_set_type: query.type ?? null,
        p_visibility: query.visibility ?? null,
        p_include_archived: Boolean(query.includeArchived),
        p_favorites_only: Boolean(query.favoritesOnly),
        p_sort: query.sort,
        p_page: query.page,
        p_page_size: query.pageSize,
      },
    );

    if (!rpcErr && rpcList) {
      const items = Array.isArray(rpcList.items) ? rpcList.items : [];
      const total = Number(rpcList.total ?? items.length);
      return apiSuccess(items, {
        total,
        page: query.page,
        pageSize: query.pageSize,
        hasMore: from + items.length < total,
      });
    }
    if (rpcErr && !isMissingRpcError(rpcErr)) {
      throw rpcErr;
    }

    if (query.scope === "shared") {
      const { data: memberships, error: memError } = await supabase
        .from("study_set_members")
        .select("study_set_id, role, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });

      if (memError) throw memError;

      const roleMap = new Map<string, MemberRole>();
      const setIds: string[] = [];
      for (const m of memberships ?? []) {
        roleMap.set(m.study_set_id, m.role);
        setIds.push(m.study_set_id);
      }

      if (setIds.length === 0) {
        return apiSuccess([], {
          total: 0,
          page: query.page,
          pageSize: query.pageSize,
          hasMore: false,
        });
      }

      let sharedQuery = supabase
        .from("study_sets")
        .select(STUDY_SET_LIST_COLUMNS, { count: "exact" })
        .in("id", setIds.slice(0, SAFE_IN_CHUNK_SIZE))
        .neq("owner_id", user.id);

      if (!query.includeArchived) {
        sharedQuery = sharedQuery.eq("is_archived", false);
      }
      if (query.type) {
        sharedQuery = sharedQuery.eq("set_type", query.type);
      }
      if (query.search) {
        const escaped = sanitizePostgrestSearch(query.search);
        if (escaped) {
          sharedQuery = sharedQuery.or(
            `title.ilike.%${escaped}%,subject.ilike.%${escaped}%,description.ilike.%${escaped}%`,
          );
        }
      }

      sharedQuery = sharedQuery
        .order("updated_at", { ascending: false })
        .range(from, to);

      const { data: sets, count, error } = await sharedQuery;
      if (error) throw error;

      const ownerIds = Array.from(
        new Set((sets ?? []).map((s) => s.owner_id)),
      );
      const owners =
        ownerIds.length > 0
          ? await fetchInChunks(
              ownerIds,
              async (chunk) =>
                supabase
                  .from("profiles")
                  .select("id, display_name, username, avatar_url")
                  .in("id", chunk),
              SAFE_IN_CHUNK_SIZE,
            )
          : [];

      const ownerMap = new Map(owners.map((o) => [o.id, o]));
      const items = (sets ?? []).map((s) => ({
        ...s,
        member_role: roleMap.get(s.id) ?? "viewer",
        owner: ownerMap.get(s.owner_id) ?? null,
      }));

      const total = count ?? items.length;
      return apiSuccess(items, {
        total,
        page: query.page,
        pageSize: query.pageSize,
        hasMore: from + items.length < total,
      });
    }

    let dbQuery = supabase
      .from("study_sets")
      .select(STUDY_SET_LIST_COLUMNS, { count: "exact" });

    if (query.scope === "owned") {
      dbQuery = dbQuery.eq("owner_id", user.id);
    } else {
      const { data: memberships, error: memError } = await supabase
        .from("study_set_members")
        .select("study_set_id")
        .eq("user_id", user.id);
      if (memError) throw memError;

      const memberSetIds = (memberships ?? [])
        .map((m) => m.study_set_id)
        .slice(0, SAFE_IN_CHUNK_SIZE);
      if (memberSetIds.length > 0) {
        dbQuery = dbQuery.or(
          `owner_id.eq.${user.id},id.in.(${memberSetIds.join(",")})`,
        );
      } else {
        dbQuery = dbQuery.eq("owner_id", user.id);
      }
    }

    if (!query.includeArchived) {
      dbQuery = dbQuery.eq("is_archived", false);
    }

    if (query.favoritesOnly) {
      dbQuery = dbQuery.eq("is_favorite", true);
    }

    if (query.folderId === "unfiled") {
      dbQuery = dbQuery.is("folder_id", null);
    } else if (query.folderId) {
      dbQuery = dbQuery.eq("folder_id", query.folderId);
    }

    if (query.type) {
      dbQuery = dbQuery.eq("set_type", query.type);
    }

    if (query.visibility) {
      dbQuery = dbQuery.eq("visibility", query.visibility);
    }

    if (query.search) {
      const escaped = sanitizePostgrestSearch(query.search);
      if (escaped) {
        dbQuery = dbQuery.or(
          `title.ilike.%${escaped}%,subject.ilike.%${escaped}%,description.ilike.%${escaped}%`,
        );
      }
    }

    switch (query.sort) {
      case "created_desc":
        dbQuery = dbQuery.order("created_at", { ascending: false });
        break;
      case "title_asc":
        dbQuery = dbQuery.order("title", { ascending: true });
        break;
      case "last_studied_desc":
        dbQuery = dbQuery.order("last_studied_at", {
          ascending: false,
          nullsFirst: false,
        });
        break;
      case "question_count_desc":
        dbQuery = dbQuery.order("question_count", { ascending: false });
        break;
      default:
        dbQuery = dbQuery
          .order("is_favorite", { ascending: false })
          .order("updated_at", { ascending: false });
        break;
    }

    const { data, count, error } = await dbQuery.range(from, to);
    if (error) throw error;

    const items = (data ?? []) as StudySet[];
    const total = count ?? items.length;

    return apiSuccess(items, {
      total,
      page: query.page,
      pageSize: query.pageSize,
      hasMore: from + items.length < total,
    });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const { supabase, user } = await requireAuth();
    const body = await parseJsonBody(request);
    const input = createStudySetSchema.parse(body);

    if (input.folder_id) {
      const { data: folder, error: folderError } = await supabase
        .from("folders")
        .select("id")
        .eq("id", input.folder_id)
        .eq("owner_id", user.id)
        .maybeSingle();

      if (folderError) throw folderError;
      if (!folder) {
        throw new AppError("NOT_FOUND", "Target folder not found.", 404);
      }
    }

    const { data, error } = await supabase
      .from("study_sets")
      .insert({
        owner_id: user.id,
        folder_id: input.folder_id ?? null,
        title: input.title,
        description: input.description ?? null,
        subject: input.subject ?? null,
        set_type: input.set_type,
        visibility: input.visibility,
        source_language: input.source_language,
        default_exam_duration_minutes: input.default_exam_duration_minutes,
        default_pass_threshold: input.default_pass_threshold,
      })
      .select("*")
      .single();

    if (error) throw error;

    return apiSuccess(data, undefined, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
