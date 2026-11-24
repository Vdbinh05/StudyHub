import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const MIGRATIONS_DIR = path.resolve(process.cwd(), "supabase/migrations");

const sql0001 = readFileSync(
  path.join(MIGRATIONS_DIR, "0001_initial_schema.sql"),
  "utf8",
);
const sql0002 = readFileSync(
  path.join(MIGRATIONS_DIR, "0002_rls_policies.sql"),
  "utf8",
);
const sql0003 = readFileSync(
  path.join(MIGRATIONS_DIR, "0003_functions_and_triggers.sql"),
  "utf8",
);
const sql0004 = readFileSync(
  path.join(MIGRATIONS_DIR, "0004_storage_and_buckets.sql"),
  "utf8",
);
const sql0006 = readFileSync(
  path.join(MIGRATIONS_DIR, "0006_v2_1_supabase_cloud_hardening.sql"),
  "utf8",
);
const sql0007 = readFileSync(
  path.join(MIGRATIONS_DIR, "0007_v2_1_fix_folders_rls_recursion.sql"),
  "utf8",
);
const sql0008 = readFileSync(
  path.join(MIGRATIONS_DIR, "0008_v2_1_fix_study_sets_insert_returning_rls.sql"),
  "utf8",
);
const sql0009 = readFileSync(
  path.join(MIGRATIONS_DIR, "0009_v2_1_fix_tags_rls_recursion.sql"),
  "utf8",
);
const sql0010 = readFileSync(
  path.join(MIGRATIONS_DIR, "0010_v2_1_fix_clone_study_set_window.sql"),
  "utf8",
);
const sql0011 = readFileSync(
  path.join(MIGRATIONS_DIR, "0011_v2_1_allow_fk_set_null_on_exam_snapshot.sql"),
  "utf8",
);
const sql0012 = readFileSync(
  path.join(MIGRATIONS_DIR, "0012_v2_1_fix_coverage_delete_cascade.sql"),
  "utf8",
);
const sql0013 = readFileSync(
  path.join(MIGRATIONS_DIR, "0013_v3_media_richtext_questions_schema.sql"),
  "utf8",
);
const sql0014 = readFileSync(
  path.join(MIGRATIONS_DIR, "0014_v3_learning_notes_reports_sync_tables.sql"),
  "utf8",
);
const sql0015 = readFileSync(
  path.join(MIGRATIONS_DIR, "0015_v3_rpcs_grading_search_reset_sync.sql"),
  "utf8",
);
const sql0016 = readFileSync(
  path.join(MIGRATIONS_DIR, "0016_v3_live_fixes.sql"),
  "utf8",
);
const sql0017 = readFileSync(
  path.join(MIGRATIONS_DIR, "0017_v3_production_vercel_hardening.sql"),
  "utf8",
);
const allSql = [sql0001, sql0002, sql0003, sql0004].join("\n");

const ALL_20_TABLES = [
  "profiles",
  "user_preferences",
  "folders",
  "study_sets",
  "study_set_members",
  "study_set_share_links",
  "questions",
  "question_options",
  "question_accepted_answers",
  "tags",
  "question_tags",
  "user_question_progress",
  "starred_questions",
  "study_sessions",
  "study_session_answers",
  "exam_attempts",
  "exam_attempt_questions",
  "exam_attempt_answers",
  "friendships",
  "import_jobs",
] as const;

describe("Security: Supabase SQL Migrations Structural Audit", () => {
  it("defines all 20 canonical tables and enables Row-Level Security on every single one", () => {
    expect(ALL_20_TABLES).toHaveLength(20);

    for (const table of ALL_20_TABLES) {
      expect(
        sql0001,
        `Missing CREATE TABLE public.${table} in 0001_initial_schema.sql`,
      ).toMatch(new RegExp(`CREATE TABLE public\\.${table}\\b`, "i"));

      expect(
        sql0002,
        `Missing ENABLE ROW LEVEL SECURITY on public.${table} in 0002_rls_policies.sql`,
      ).toMatch(
        new RegExp(`ALTER TABLE public\\.${table}\\s+ENABLE ROW LEVEL SECURITY;`, "i"),
      );
    }
  });

  it("uses (SELECT auth.uid()) initPlan caching with ZERO bare auth.uid() and ZERO deprecated auth.role()", () => {
    // Strip SQL single-line comments before scanning executable SQL
    const executableSql = allSql
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");

    // Zero deprecated auth.role()
    expect(executableSql).not.toMatch(/\bauth\.role\s*\(\s*\)/i);

    // Every auth.uid() call must be wrapped inside (SELECT auth.uid())
    const wrappedMatches = executableSql.match(/\(\s*SELECT\s+auth\.uid\s*\(\s*\)\s*\)/gi) ?? [];
    const totalMatches = executableSql.match(/\bauth\.uid\s*\(\s*\)/gi) ?? [];

    expect(totalMatches.length).toBeGreaterThan(20);
    expect(wrappedMatches.length).toBe(totalMatches.length);
  });

  it("ensures every UPDATE RLS policy enforces BOTH USING and WITH CHECK", () => {
    const policyStatements = sql0002.split(/CREATE POLICY\s+/i).slice(1);
    const updatePolicies = policyStatements.filter((stmt) =>
      /\bFOR\s+UPDATE\b/i.test(stmt),
    );

    expect(updatePolicies.length).toBeGreaterThan(10);
    for (const stmt of updatePolicies) {
      const policyName = stmt.match(/^"([^"]+)"/)?.[1] ?? "unknown";
      expect(stmt, `UPDATE policy ${policyName} missing USING`).toMatch(/\bUSING\s*\(/i);
      expect(stmt, `UPDATE policy ${policyName} missing WITH CHECK`).toMatch(
        /\bWITH CHECK\s*\(/i,
      );
    }
  });

  it("enforces SET search_path = '' on every SECURITY DEFINER function", () => {
    const fnBlocks = allSql.split(/CREATE OR REPLACE FUNCTION\s+/i).slice(1);
    const secDefBlocks = fnBlocks.filter((block) =>
      /\bSECURITY DEFINER\b/i.test(block.split(/AS \$\$/i)[0] ?? ""),
    );

    expect(secDefBlocks.length).toBeGreaterThanOrEqual(8);
    for (const block of secDefBlocks) {
      const header = block.split(/AS \$\$/i)[0] ?? "";
      const fnName = header.match(/^([^\s(]+)/)?.[1] ?? "unknown";
      expect(header, `SECURITY DEFINER function ${fnName} missing SET search_path = ''`).toMatch(
        /SET\s+search_path\s*=\s*''/i,
      );
    }
  });

  it("enforces column-level REVOKE ALL and safe-column GRANT on exam_attempt_questions", () => {
    expect(sql0002).toMatch(
      /REVOKE ALL ON public\.exam_attempt_questions FROM anon,\s*authenticated;/i,
    );

    const grantMatch = sql0002.match(
      /GRANT SELECT\s*\(([\s\S]*?)\)\s*ON public\.exam_attempt_questions TO authenticated;/i,
    );
    expect(grantMatch).not.toBeNull();
    const grantedCols = grantMatch?.[1] ?? "";

    // Safe columns granted
    expect(grantedCols).toContain("prompt_snapshot");
    expect(grantedCols).toContain("options_snapshot");

    // Sensitive answer columns strictly excluded from direct PostgREST SELECT
    expect(grantedCols).not.toContain("correct_option_ids");
    expect(grantedCols).not.toContain("accepted_answers_snapshot");
    expect(grantedCols).not.toContain("explanation_snapshot");
  });

  it("enforces immutable exam snapshots and FOR UPDATE idempotency in submit_exam_attempt", () => {
    expect(sql0003).toMatch(
      /CREATE TRIGGER trg_prevent_exam_snapshot_update[\s\S]*?BEFORE UPDATE ON public\.exam_attempt_questions/i,
    );

    const submitFnMatch = sql0003.match(
      /CREATE OR REPLACE FUNCTION public\.submit_exam_attempt[\s\S]*?\$\$;/i,
    );
    expect(submitFnMatch).not.toBeNull();
    const submitBody = submitFnMatch?.[0] ?? "";

    expect(submitBody).toMatch(/FOR UPDATE;/i);
    expect(submitBody).toMatch(/v_attempt\.status IN \('submitted',\s*'expired'\)/i);
    expect(submitBody).toMatch(/v_attempt\.user_id <> v_caller/i);
  });

  it("configures study-media bucket as private, 5 MB max, raster-only (NO SVG) with full CRUD RLS policies", () => {
    expect(sql0004).toContain("'study-media'");
    expect(sql0004).toContain("5242880");
    expect(sql0004).toMatch(/ARRAY\['image\/png',\s*'image\/jpeg',\s*'image\/webp',\s*'image\/gif'\]/);
    expect(sql0004).not.toContain("image/svg+xml");

    expect(sql0004).toMatch(/CREATE POLICY "study_media_select"/);
    expect(sql0004).toMatch(/CREATE POLICY "study_media_insert"/);
    expect(sql0004).toMatch(/CREATE POLICY "study_media_update"/);
    expect(sql0004).toMatch(/CREATE POLICY "study_media_delete"/);
  });

  it("V2.1 migrations 0006–0012 eliminate folders/tags RLS recursion, study_sets INSERT RETURNING RLS block, clone window error, FK ON DELETE SET NULL snapshot block, coverage cascade delete 23503, and Cloud anon SECURITY DEFINER grants", () => {
    const v21Sql = [sql0006, sql0007, sql0008, sql0009, sql0010, sql0011, sql0012]
      .join("\n")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");

    // Zero bare auth.uid() and zero auth.role() across 0006-0009
    expect(v21Sql).not.toMatch(/\bauth\.role\s*\(\s*\)/i);
    const wrapped = v21Sql.match(/\(\s*SELECT\s+auth\.uid\s*\(\s*\)\s*\)/gi) ?? [];
    const total = v21Sql.match(/\bauth\.uid\s*\(\s*\)/gi) ?? [];
    expect(total.length).toBeGreaterThanOrEqual(8);
    expect(wrapped.length).toBe(total.length);

    // 0006 moves pg_trgm out of public & indexes all 6 composite FKs
    expect(sql0006).toMatch(/ALTER EXTENSION pg_trgm SET SCHEMA extensions/i);
    expect(sql0006).toMatch(/idx_question_options_set_question/i);
    expect(sql0006).toMatch(/idx_study_session_answers_set_question/i);

    // 0007 breaks self-recursive public.folders policies with SECURITY DEFINER is_folder_owner
    expect(sql0007).toMatch(/CREATE OR REPLACE FUNCTION public\.is_folder_owner/i);
    expect(sql0007).toMatch(/SET search_path = ''/i);
    expect(sql0007).toMatch(/REVOKE ALL ON FUNCTION public\.is_folder_owner\(uuid, uuid\) FROM PUBLIC, anon;/i);
    expect(sql0007).toMatch(/ALTER POLICY "folders_insert_own" ON public\.folders/i);
    expect(sql0007).toMatch(/ALTER POLICY "folders_update_own" ON public\.folders/i);
    const foldersPoliciesPart = sql0007.slice(sql0007.indexOf('ALTER POLICY "folders_insert_own"'));
    expect(foldersPoliciesPart).not.toMatch(/FROM\s+public\.folders\b/i);

    // 0008 short-circuits study_sets_select_readable on owner_id without re-opening 'unlisted'
    expect(sql0008).toMatch(/ALTER POLICY "study_sets_select_readable" ON public\.study_sets/i);
    expect(sql0008).toContain("owner_id = (SELECT auth.uid())");
    expect(sql0008).toContain("visibility = 'public'");
    expect(sql0008.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n")).not.toContain("'unlisted'");
    expect(sql0008).toMatch(/public\.is_folder_owner\(folder_id, \(SELECT auth\.uid\(\)\)\)/i);

    // 0009 breaks question_tags <-> tags mutual recursion via SECURITY DEFINER can_read_tag
    expect(sql0009).toMatch(/CREATE OR REPLACE FUNCTION public\.can_read_tag/i);
    expect(sql0009).toMatch(/REVOKE ALL ON FUNCTION public\.can_read_tag\(uuid, uuid\) FROM PUBLIC, anon;/i);
    expect(sql0009).toMatch(/ALTER POLICY "tags_select_readable_via_sets" ON public\.tags/i);
    const tagsPolicyPart = sql0009.slice(sql0009.indexOf('ALTER POLICY "tags_select_readable_via_sets"'));
    expect(tagsPolicyPart).not.toMatch(/FROM\s+public\.question_tags\b/i);

    // 0010 syncs clone_study_set without nested window-in-aggregate and revokes anon EXECUTE
    expect(sql0010).toMatch(/CREATE OR REPLACE FUNCTION public\.clone_study_set/i);
    expect(sql0010).toMatch(/SET search_path = ''/i);
    expect(sql0010).toMatch(/REVOKE ALL ON FUNCTION public\.clone_study_set\(uuid, text, uuid\) FROM PUBLIC, anon;/i);
    expect(sql0010).toMatch(/GRANT EXECUTE ON FUNCTION public\.clone_study_set\(uuid, text, uuid\) TO authenticated;/i);

    // 0011 allows FK ON DELETE SET NULL on question_id/source_study_set_id while keeping all 14 snapshot columns immutable
    expect(sql0011).toMatch(/CREATE OR REPLACE FUNCTION public\.prevent_exam_snapshot_update/i);
    expect(sql0011).toContain("NEW.prompt_snapshot IS NOT DISTINCT FROM OLD.prompt_snapshot");
    expect(sql0011).toContain("NEW.correct_option_ids IS NOT DISTINCT FROM OLD.correct_option_ids");
    expect(sql0011).toContain("NEW.options_snapshot IS NOT DISTINCT FROM OLD.options_snapshot");
    expect(sql0011).toContain("NEW.question_id IS NULL OR NEW.question_id = OLD.question_id");
    expect(sql0011).toContain("NEW.source_study_set_id IS NULL OR NEW.source_study_set_id = OLD.source_study_set_id");

    // 0012 guards release_coverage_cycle_on_attempt_delete against cascading account deletion 23503
    expect(sql0012).toMatch(/CREATE OR REPLACE FUNCTION public\.release_coverage_cycle_on_attempt_delete/i);
    expect(sql0012).toMatch(/SET search_path = ''/i);
    expect(sql0012).toContain("EXISTS (SELECT 1 FROM public.profiles WHERE id = OLD.user_id)");
    expect(sql0012).toMatch(/REVOKE ALL ON FUNCTION public\.release_coverage_cycle_on_attempt_delete\(\) FROM PUBLIC, anon, authenticated;/i);
  });

  it("V3.0 migrations 0013–0015 enable RLS on all 10 new tables, preserve zero DROP POLICY/DROP TRIGGER, enforce pre-submit anti-leak, and harden all SECURITY DEFINER RPCs", () => {
    const v3Raw = [sql0013, sql0014, sql0015].join("\n");
    const v3Exec = v3Raw
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");

    // Zero destructive policy/trigger drops or temp tables across 0013-0015
    expect(v3Exec).not.toMatch(/\bDROP\s+POLICY\b/i);
    expect(v3Exec).not.toMatch(/\bDROP\s+TRIGGER\b/i);
    expect(v3Exec).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(v3Exec).not.toMatch(/\bCREATE\s+TEMP\s+TABLE\b/i);

    // Zero deprecated auth.role() and 100% wrapped (SELECT auth.uid())
    expect(v3Exec).not.toMatch(/\bauth\.role\s*\(\s*\)/i);
    const wrapped = v3Exec.match(/\(\s*SELECT\s+auth\.uid\s*\(\s*\)\s*\)/gi) ?? [];
    const total = v3Exec.match(/\bauth\.uid\s*\(\s*\)/gi) ?? [];
    expect(total.length).toBeGreaterThanOrEqual(20);
    expect(wrapped.length).toBe(total.length);

    // All 10 new V3 tables defined & RLS-enabled
    const v3Tables = [
      "media_assets",
      "content_media_relations",
      "shared_passages",
      "diagram_sets",
      "diagram_hotspots",
      "user_question_notes",
      "question_reports",
      "learning_session_checkpoints",
      "learning_confidence_events",
      "learning_sync_events",
    ];
    for (const table of v3Tables) {
      expect(v3Exec, `Missing CREATE TABLE public.${table}`).toMatch(
        new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}\\b`, "i"),
      );
      expect(v3Exec, `Missing ENABLE ROW LEVEL SECURITY on public.${table}`).toMatch(
        new RegExp(`ALTER TABLE public\\.${table}\\s+ENABLE ROW LEVEL SECURITY;`, "i"),
      );
    }

    // Every SECURITY DEFINER function sets search_path = ''
    const fnBlocks = v3Exec.split(/CREATE OR REPLACE FUNCTION\s+/i).slice(1);
    const secDefBlocks = fnBlocks.filter((block) =>
      /\bSECURITY DEFINER\b/i.test(block.split(/AS \$\$/i)[0] ?? ""),
    );
    expect(secDefBlocks.length).toBeGreaterThanOrEqual(10);
    for (const block of secDefBlocks) {
      const header = block.split(/AS \$\$/i)[0] ?? "";
      const fnName = header.match(/^([^\s(]+)/)?.[1] ?? "unknown";
      expect(header, `V3 SECURITY DEFINER ${fnName} missing SET search_path = ''`).toMatch(
        /SET\s+search_path\s*=\s*''/i,
      );
    }

    // study-media upgraded to 10MB audio+raster with ZERO SVG/HTML
    expect(sql0013).toContain("10485760");
    expect(sql0013).toContain("'audio/mpeg'");
    expect(sql0013).not.toContain("image/svg+xml");
    expect(sql0013).not.toContain("text/html");

    // Pre-submit exam column GRANTs strictly exclude type_payload_snapshot & explanation_rich_snapshot
    const eaqGrants = sql0013.match(
      /GRANT SELECT\s*\(([\s\S]*?)\)\s*ON public\.exam_attempt_questions TO authenticated;/gi,
    ) ?? [];
    expect(eaqGrants.length).toBeGreaterThanOrEqual(1);
    for (const g of eaqGrants) {
      expect(g).not.toContain("type_payload_snapshot");
      expect(g).not.toContain("explanation_rich_snapshot");
      expect(g).not.toContain("correct_option_ids");
      expect(g).not.toContain("accepted_answers_snapshot");
    }

    // Key V3 deterministic RPCs present and revoked from PUBLIC/anon
    for (const fn of [
      "point_in_hotspot",
      "sanitize_pre_submit_type_payload",
      "has_exam_answer",
      "grade_v3_exam_answer",
      "reset_learning_progress",
      "global_library_search",
      "sync_offline_learning_events",
    ]) {
      expect(sql0015).toMatch(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}\\b`, "i"));
      expect(sql0015).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon;`, "i"));
    }
  });

  it("V3.0 migrations 0016–0017 remain 100% additive/MCP-safe, lock down study-temp (20 MB, own-prefix RLS, NO SVG/HTML), and isolate api_rate_limits to service_role", () => {
    const combinedExec = [sql0016, sql0017]
      .join("\n")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");

    // Zero destructive policy/trigger/table drops or temp tables across 0016-0017
    expect(combinedExec).not.toMatch(/\bDROP\s+POLICY\b/i);
    expect(combinedExec).not.toMatch(/\bDROP\s+TRIGGER\b/i);
    expect(combinedExec).not.toMatch(/\bDROP\s+TABLE\b/i);
    expect(combinedExec).not.toMatch(/\bCREATE\s+TEMP\s+TABLE\b/i);

    // Zero deprecated auth.role() and 100% wrapped (SELECT auth.uid())
    expect(combinedExec).not.toMatch(/\bauth\.role\s*\(\s*\)/i);
    const wrapped = combinedExec.match(/\(\s*SELECT\s+auth\.uid\s*\(\s*\)\s*\)/gi) ?? [];
    const total = combinedExec.match(/\bauth\.uid\s*\(\s*\)/gi) ?? [];
    expect(total.length).toBeGreaterThanOrEqual(7);
    expect(wrapped.length).toBe(total.length);

    // Every SECURITY DEFINER function in 0016-0017 sets search_path = ''
    const fnBlocks = combinedExec.split(/CREATE OR REPLACE FUNCTION\s+/i).slice(1);
    const secDefBlocks = fnBlocks.filter((block) =>
      /\bSECURITY DEFINER\b/i.test(block.split(/AS \$\$/i)[0] ?? ""),
    );
    expect(secDefBlocks.length).toBeGreaterThanOrEqual(5);
    for (const block of secDefBlocks) {
      const header = block.split(/AS \$\$/i)[0] ?? "";
      const fnName = header.match(/^([^\s(]+)/)?.[1] ?? "unknown";
      expect(header, `SECURITY DEFINER ${fnName} missing SET search_path = ''`).toMatch(
        /SET\s+search_path\s*=\s*''/i,
      );
    }

    // 0017: private study-temp bucket (20 MB, NO SVG/HTML) + 3 own-prefix RLS policies
    const exec0017 = sql0017
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    expect(exec0017).toContain("'study-temp'");
    expect(exec0017).toContain("20971520");
    expect(exec0017).not.toContain("image/svg+xml");
    expect(exec0017).not.toContain("text/html");
    expect(exec0017).toMatch(/CREATE POLICY "study_temp_select_own"/);
    expect(exec0017).toMatch(/CREATE POLICY "study_temp_insert_own"/);
    expect(exec0017).toMatch(/CREATE POLICY "study_temp_delete_own"/);

    // 0017: deny-all RLS on api_rate_limits + service_role-only check_and_increment_rate_limit
    expect(exec0017).toMatch(/CREATE TABLE IF NOT EXISTS public\.api_rate_limits\b/i);
    expect(exec0017).toMatch(/ALTER TABLE public\.api_rate_limits\s+ENABLE ROW LEVEL SECURITY;/i);
    expect(exec0017).toMatch(/REVOKE ALL ON public\.api_rate_limits FROM PUBLIC, anon, authenticated;/i);
    expect(exec0017).toMatch(/CREATE OR REPLACE FUNCTION public\.check_and_increment_rate_limit\b/i);
    expect(exec0017).toMatch(
      /REVOKE ALL ON FUNCTION public\.check_and_increment_rate_limit\(text, integer, integer\) FROM PUBLIC, anon, authenticated;/i,
    );
    expect(exec0017).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.check_and_increment_rate_limit\(text, integer, integer\) TO service_role;/i,
    );
  });
});
