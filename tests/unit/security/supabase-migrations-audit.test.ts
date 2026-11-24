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
});
