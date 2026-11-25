import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { config as proxyConfig } from "@/proxy";
import {
  hasSupabaseAuthCookie,
  updateSession,
} from "@/lib/supabase/middleware";
import { fetchInChunks } from "@/lib/supabase/query-helpers";
import { isMissingRpcError } from "@/lib/supabase/rpc";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("StudyHub V3.1 Backend & Region Performance Hardening", () => {
  it("pins Vercel Functions to single Hobby region Tokyo (hnd1) co-located with Supabase ap-northeast-1", () => {
    const raw = readFileSync(path.resolve(process.cwd(), "vercel.json"), "utf8");
    const parsed = JSON.parse(raw) as { regions?: string[] };
    expect(parsed.regions).toEqual(["hnd1"]);
  });

  it("excludes /api/* and /auth/* from src/proxy.ts matcher while keeping page routes matched", () => {
    const pattern = proxyConfig.matcher[0];
    expect(pattern).toBeTruthy();
    const re = new RegExp(`^${pattern}$`);

    // Excluded from proxy (Route Handlers authenticate directly; next.config.ts enforces headers)
    expect(re.test("/api/health")).toBe(false);
    expect(re.test("/api/dashboard")).toBe(false);
    expect(re.test("/api/sets/123/questions")).toBe(false);
    expect(re.test("/api/uploads/signed-url")).toBe(false);
    expect(re.test("/auth/callback")).toBe(false);
    expect(re.test("/auth/confirm")).toBe(false);
    expect(re.test("/auth/signout")).toBe(false);
    expect(re.test("/sw.js")).toBe(false);
    expect(re.test("/manifest.webmanifest")).toBe(false);

    // Still matched by proxy for SSR route protection & session refresh
    expect(re.test("/")).toBe(true);
    expect(re.test("/login")).toBe(true);
    expect(re.test("/dashboard")).toBe(true);
    expect(re.test("/library")).toBe(true);
    expect(re.test("/sets/abc-123")).toBe(true);
    expect(re.test("/exams/new")).toBe(true);
    expect(re.test("/exams/attempt-1")).toBe(true);
  });

  it("detects Supabase SSR auth cookies accurately while ignoring code-verifier & unrelated cookies", () => {
    const makeReq = (cookieHeader: string) =>
      new NextRequest("https://studyhub-three-mauve.vercel.app/dashboard", {
        headers: cookieHeader ? { cookie: cookieHeader } : {},
      });

    expect(hasSupabaseAuthCookie(makeReq(""))).toBe(false);
    expect(hasSupabaseAuthCookie(makeReq("theme=dark; locale=vi"))).toBe(false);
    expect(
      hasSupabaseAuthCookie(makeReq("sb-cuoaifyupfmkstqhcjwy-auth-token-code-verifier=abc")),
    ).toBe(false);
    expect(
      hasSupabaseAuthCookie(makeReq("sb-cuoaifyupfmkstqhcjwy-auth-token=base64-payload")),
    ).toBe(true);
    expect(
      hasSupabaseAuthCookie(makeReq("sb-cuoaifyupfmkstqhcjwy-auth-token.0=chunk0")),
    ).toBe(true);
    expect(hasSupabaseAuthCookie(makeReq("sb-access-token=tok"))).toBe(true);
  });

  it("updateSession fast-paths unauthenticated requests without any network RTT", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://invalid.local.example";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test_dummy";

    // Protected route with no sb-* cookie -> immediate redirect to /login?next=...
    const protectedReq = new NextRequest(
      "https://studyhub-three-mauve.vercel.app/dashboard?tab=recent",
    );
    const protectedRes = await updateSession(protectedReq);
    expect(protectedRes.status).toBe(307);
    expect(protectedRes.headers.get("location")).toBe(
      "https://studyhub-three-mauve.vercel.app/login?next=%2Fdashboard%3Ftab%3Drecent",
    );

    // Public route with no sb-* cookie -> immediate NextResponse.next() pass-through
    const landingReq = new NextRequest("https://studyhub-three-mauve.vercel.app/");
    const landingRes = await updateSession(landingReq);
    expect(landingRes.status).toBe(200);

    // /offline never blocks even if an auth cookie exists
    const offlineReq = new NextRequest(
      "https://studyhub-three-mauve.vercel.app/offline",
      {
        headers: { cookie: "sb-proj-auth-token=fake-token" },
      },
    );
    const offlineRes = await updateSession(offlineReq);
    expect(offlineRes.status).toBe(200);
  });

  it("fetchInChunks runs with bounded concurrency (<=4) and preserves deterministic chunk order", async () => {
    const ids = Array.from({ length: 10 }, (_, idx) => `id-${idx}`);
    let inFlight = 0;
    let maxInFlight = 0;

    const results = await fetchInChunks(
      [...ids, "id-0", "id-1"], // includes duplicates that must be deduped
      async (chunk) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        // Deliberately invert completion delay so later chunks resolve faster
        const chunkIndex = Number(chunk[0].split("-")[1]);
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(1, 25 - chunkIndex * 2)),
        );
        inFlight -= 1;
        return { data: chunk.map((id) => ({ id })), error: null };
      },
      1, // 10 chunks
      4, // max 4 concurrent
    );

    expect(maxInFlight).toBeGreaterThan(1);
    expect(maxInFlight).toBeLessThanOrEqual(4);
    expect(results.map((r) => r.id)).toEqual(ids);
  });

  it("isMissingRpcError detects only missing-function codes and never swallows permission/validation errors", () => {
    expect(isMissingRpcError({ code: "42883", message: "function does not exist" })).toBe(true);
    expect(isMissingRpcError({ code: "PGRST202", message: "Could not find the function" })).toBe(true);
    expect(isMissingRpcError({ code: "42501", message: "Forbidden" })).toBe(false);
    expect(isMissingRpcError({ code: "P0002", message: "Not found" })).toBe(false);
    expect(isMissingRpcError({ code: "22023", message: "Invalid ref" })).toBe(false);
    expect(isMissingRpcError(null)).toBe(false);
  });

  it("verifies signed-url short private cache header (V32-008) and compact questions summary mode", () => {
    const signedUrlSrc = readFileSync(
      path.resolve(process.cwd(), "src/app/api/uploads/signed-url/route.ts"),
      "utf8",
    );
    expect(signedUrlSrc).toContain('"private, max-age=60, must-revalidate"');
    expect(signedUrlSrc).toContain('"Vary", "Cookie"');

    const questionsSrc = readFileSync(
      path.resolve(process.cwd(), "src/app/api/sets/[id]/questions/route.ts"),
      "utf8",
    );
    expect(questionsSrc).toContain("QUESTION_SUMMARY_COLUMNS");
    expect(questionsSrc).toContain('"summary"');
  });
});
