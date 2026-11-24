// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

// Next.js Route Handlers execute in the Server runtime; stub the bundler guard in Vitest Node env.
vi.mock("server-only", () => ({}));

import { GET as getAccountData } from "@/app/api/account/data/route";
import { GET as getExams, POST as postExams } from "@/app/api/exams/route";
import { GET as getHealth } from "@/app/api/health/route";
import { POST as postImportParse } from "@/app/api/import/parse/route";
import { GET as getTemplate } from "@/app/api/import/templates/[format]/route";
import { GET as getSets, POST as postSets } from "@/app/api/sets/route";
import { exportStudySet } from "@/lib/export";
import { parseImportInput, SUPPORTED_TEMPLATE_FORMATS } from "@/lib/import";
import * as authz from "@/lib/security/authz";
import * as rpc from "@/lib/supabase/rpc";
import { GET as getExamAttempt } from "@/app/api/exams/[attemptId]/route";
import type { Question } from "@/types/domain";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("Integration: Public Health & Import Template Endpoints", () => {
  it("GET /api/health returns 200 JSON with supabaseConfigured status", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

    const res = await getHealth();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.status).toBe("ok");
    expect(body.data.supabaseConfigured).toBe(false);
    expect(Date.parse(body.data.timestamp)).not.toBeNaN();
  });

  it("GET /api/import/templates/[format] serves all supported templates and rejects invalid formats", async () => {
    for (const fmt of SUPPORTED_TEMPLATE_FORMATS) {
      const req = new Request(`http://localhost:3000/api/import/templates/${fmt}`);
      const res = await getTemplate(req, { params: Promise.resolve({ format: fmt }) });
      expect(res.status).toBe(200);
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("Content-Disposition")).toContain("attachment; filename=");
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect(bytes.byteLength).toBeGreaterThan(20);
    }

    const badReq = new Request("http://localhost:3000/api/import/templates/exe");
    const badRes = await getTemplate(badReq, {
      params: Promise.resolve({ format: "exe" }),
    });
    expect(badRes.status).toBe(400);
    expect(await badRes.json()).toMatchObject({
      error: { code: "BAD_REQUEST" },
    });
  });
});

describe("Integration: Auth & Unconfigured Supabase Fail-Closed Guard (Zero Fake Auth)", () => {
  it("returns 503 SUPABASE_NOT_CONFIGURED on all protected routes when Supabase env vars are missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");

    const responses = await Promise.all([
      getSets(new NextRequest("http://localhost:3000/api/sets")),
      postSets(
        new NextRequest("http://localhost:3000/api/sets", {
          method: "POST",
          body: JSON.stringify({ title: "Unauthorized Set" }),
        }),
      ),
      getExams(new NextRequest("http://localhost:3000/api/exams")),
      postExams(
        new NextRequest("http://localhost:3000/api/exams", {
          method: "POST",
          body: JSON.stringify({ study_set_id: "11111111-1111-4111-8111-111111111111" }),
        }),
      ),
      postImportParse(
        new Request("http://localhost:3000/api/import/parse", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ rawText: "Câu 1: Test\n*A. Ok" }),
        }),
      ),
      getAccountData(),
    ]);

    for (const res of responses) {
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body).toMatchObject({
        error: { code: "SUPABASE_NOT_CONFIGURED" },
      });
    }
  });
});

describe("Integration: Exam Pre-Submit Anti-Leak Guarantee", () => {
  const ATTEMPT_ID = "11111111-1111-4111-8111-111111111111";

  it("strips correct_option_ids, accepted_answers_snapshot, explanation_snapshot, and option is_correct while in_progress", async () => {
    vi.spyOn(authz, "requireAuth").mockResolvedValue({
      supabase: {} as never,
      user: { id: "22222222-2222-4222-8222-222222222222" } as never,
    });

    const futureIso = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    // Simulate even a worst-case RPC response containing sensitive answer fields
    vi.spyOn(rpc, "rpcGetExamAttemptDetail").mockResolvedValue({
      data: {
        attempt: {
          id: ATTEMPT_ID,
          user_id: "22222222-2222-4222-8222-222222222222",
          study_set_id: "33333333-3333-4333-8333-333333333333",
          study_set_title_snapshot: "Midterm",
          status: "in_progress",
          config: {
            question_count: 1,
            duration_limit_seconds: 1800,
            shuffle_questions: true,
            shuffle_options: true,
            pass_threshold: 70,
          },
          total_questions: 1,
          answered_count: 1,
          correct_count: 0,
          wrong_count: 0,
          unanswered_count: 0,
          score_percent: 0,
          pass_threshold: 70,
          passed: false,
          duration_limit_seconds: 1800,
          time_spent_seconds: 0,
          started_at: new Date().toISOString(),
          expires_at: futureIso,
          submitted_at: null,
          created_at: new Date().toISOString(),
        },
        questions: [
          {
            id: "44444444-4444-4444-8444-444444444444",
            attempt_id: ATTEMPT_ID,
            question_id: "55555555-5555-4555-8555-555555555555",
            position: 0,
            question_type: "single_choice",
            chapter_snapshot: "Chương 1",
            prompt_snapshot: "2 + 2 = ?",
            prompt_image_url_snapshot: null,
            explanation_snapshot: "SECRET EXPLANATION SHOULD NEVER LEAK",
            correct_option_ids: ["66666666-6666-4666-8666-666666666666"],
            accepted_answers_snapshot: [
              { answer_text: "4", normalized_answer: "4", match_mode: "exact" },
            ],
            options_snapshot: [
              {
                id: "66666666-6666-4666-8666-666666666666",
                label: "A",
                content: "4",
                image_url: null,
                position: 0,
                is_correct: true,
              } as never,
            ],
            created_at: new Date().toISOString(),
          },
        ],
        answers: [
          {
            id: "77777777-7777-4777-8777-777777777777",
            attempt_id: ATTEMPT_ID,
            attempt_question_id: "44444444-4444-4444-8444-444444444444",
            user_id: "22222222-2222-4222-8222-222222222222",
            selected_option_ids: ["66666666-6666-4666-8666-666666666666"],
            typed_answer: null,
            is_correct: true,
            is_flagged: false,
            updated_at: new Date().toISOString(),
          },
        ],
        server_now: new Date().toISOString(),
      },
      error: null,
    });

    const res = await getExamAttempt(
      new NextRequest(`http://localhost:3000/api/exams/${ATTEMPT_ID}`),
      { params: Promise.resolve({ attemptId: ATTEMPT_ID }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    const rawJson = JSON.stringify(body);

    // ZERO answer disclosure while exam is in_progress
    expect(rawJson).not.toContain("correct_option_ids");
    expect(rawJson).not.toContain("accepted_answers_snapshot");
    expect(rawJson).not.toContain("explanation_snapshot");
    expect(rawJson).not.toContain("SECRET EXPLANATION");
    expect(rawJson).not.toContain('"is_correct"');

    expect(body.data.questions[0].prompt_snapshot).toBe("2 + 2 = ?");
    expect(body.data.questions[0].options_snapshot[0]).toEqual({
      id: "66666666-6666-4666-8666-666666666666",
      label: "A",
      content: "4",
      image_url: null,
      position: 0,
    });
    expect(body.data.remaining_seconds).toBeGreaterThan(0);
  });

  it("unlocks explanations and chapter_breakdown once attempt status is submitted", async () => {
    vi.spyOn(authz, "requireAuth").mockResolvedValue({
      supabase: {} as never,
      user: { id: "22222222-2222-4222-8222-222222222222" } as never,
    });

    vi.spyOn(rpc, "rpcGetExamAttemptDetail").mockResolvedValue({
      data: {
        attempt: {
          id: ATTEMPT_ID,
          user_id: "22222222-2222-4222-8222-222222222222",
          study_set_id: "33333333-3333-4333-8333-333333333333",
          study_set_title_snapshot: "Midterm",
          status: "submitted",
          config: {
            question_count: 1,
            duration_limit_seconds: 1800,
            shuffle_questions: true,
            shuffle_options: true,
            pass_threshold: 70,
          },
          total_questions: 1,
          answered_count: 1,
          correct_count: 1,
          wrong_count: 0,
          unanswered_count: 0,
          score_percent: 100,
          pass_threshold: 70,
          passed: true,
          duration_limit_seconds: 1800,
          time_spent_seconds: 120,
          started_at: new Date().toISOString(),
          expires_at: new Date().toISOString(),
          submitted_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        },
        questions: [
          {
            id: "44444444-4444-4444-8444-444444444444",
            attempt_id: ATTEMPT_ID,
            question_id: "55555555-5555-4555-8555-555555555555",
            position: 0,
            question_type: "single_choice",
            chapter_snapshot: "Chương 1",
            prompt_snapshot: "2 + 2 = ?",
            prompt_image_url_snapshot: null,
            explanation_snapshot: "Vì 2 cộng 2 bằng 4.",
            correct_option_ids: ["66666666-6666-4666-8666-666666666666"],
            accepted_answers_snapshot: [],
            options_snapshot: [
              {
                id: "66666666-6666-4666-8666-666666666666",
                label: "A",
                content: "4",
                image_url: null,
                position: 0,
              },
            ],
            created_at: new Date().toISOString(),
          },
        ],
        answers: [
          {
            id: "77777777-7777-4777-8777-777777777777",
            attempt_id: ATTEMPT_ID,
            attempt_question_id: "44444444-4444-4444-8444-444444444444",
            user_id: "22222222-2222-4222-8222-222222222222",
            selected_option_ids: ["66666666-6666-4666-8666-666666666666"],
            typed_answer: null,
            is_correct: true,
            is_flagged: false,
            updated_at: new Date().toISOString(),
          },
        ],
        server_now: new Date().toISOString(),
      },
      error: null,
    });

    const res = await getExamAttempt(
      new NextRequest(`http://localhost:3000/api/exams/${ATTEMPT_ID}`),
      { params: Promise.resolve({ attemptId: ATTEMPT_ID }) },
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.questions[0].explanation_snapshot).toBe("Vì 2 cộng 2 bằng 4.");
    expect(body.data.questions[0].correct_option_ids).toEqual([
      "66666666-6666-4666-8666-666666666666",
    ]);
    expect(body.data.chapter_breakdown).toEqual([
      {
        chapter: "Chương 1",
        total: 1,
        correct: 1,
        wrong: 0,
        unanswered: 0,
        accuracy_percent: 100,
      },
    ]);
  });
});

describe("Integration: Deterministic Export -> Re-Import Round-Trip", () => {
  const sampleSet = {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Giải tích 1 — Đề cương ôn tập",
    description: "Bộ câu hỏi kiểm thử vòng tròn xuất-nhập.",
    subject: "Toán cao cấp",
    set_type: "mixed" as const,
  };

  const sampleQuestions: Question[] = [
    {
      id: "q-1",
      study_set_id: sampleSet.id,
      question_type: "single_choice",
      position: 0,
      chapter: "Chương 1: Giới hạn",
      prompt: "Giới hạn lim(x->0) sin(x)/x bằng bao nhiêu?",
      prompt_image_url: null,
      back_text: null,
      back_image_url: null,
      explanation: "Đây là giới hạn cơ bản trong giải tích.",
      hint: "Áp dụng quy tắc L'Hôpital",
      difficulty: "easy",
      source_metadata: {},
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      options: [
        { id: "o-1", question_id: "q-1", study_set_id: sampleSet.id, label: "A", content: "0", image_url: null, is_correct: false, position: 0, created_at: "2026-01-01T00:00:00Z" },
        { id: "o-2", question_id: "q-1", study_set_id: sampleSet.id, label: "B", content: "1", image_url: null, is_correct: true, position: 1, created_at: "2026-01-01T00:00:00Z" },
        { id: "o-3", question_id: "q-1", study_set_id: sampleSet.id, label: "C", content: "∞", image_url: null, is_correct: false, position: 2, created_at: "2026-01-01T00:00:00Z" },
        { id: "o-4", question_id: "q-1", study_set_id: sampleSet.id, label: "D", content: "-1", image_url: null, is_correct: false, position: 3, created_at: "2026-01-01T00:00:00Z" },
      ],
      tags: [{ id: "t-1", owner_id: "u-1", name: "Giới hạn", slug: "gioi-han", color: "indigo", created_at: "2026-01-01T00:00:00Z" }],
    },
    {
      id: "q-2",
      study_set_id: sampleSet.id,
      question_type: "multiple_choice",
      position: 1,
      chapter: "Chương 2: Đạo hàm",
      prompt: "Những hàm nào sau đây khả vi trên toàn bộ R?",
      prompt_image_url: null,
      back_text: null,
      back_image_url: null,
      explanation: "Đa thức và hàm mũ khả vi mọi nơi trên R.",
      hint: null,
      difficulty: "medium",
      source_metadata: {},
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      options: [
        { id: "o-5", question_id: "q-2", study_set_id: sampleSet.id, label: "A", content: "f(x) = x^2", image_url: null, is_correct: true, position: 0, created_at: "2026-01-01T00:00:00Z" },
        { id: "o-6", question_id: "q-2", study_set_id: sampleSet.id, label: "B", content: "f(x) = |x|", image_url: null, is_correct: false, position: 1, created_at: "2026-01-01T00:00:00Z" },
        { id: "o-7", question_id: "q-2", study_set_id: sampleSet.id, label: "C", content: "f(x) = e^x", image_url: null, is_correct: true, position: 2, created_at: "2026-01-01T00:00:00Z" },
        { id: "o-8", question_id: "q-2", study_set_id: sampleSet.id, label: "D", content: "f(x) = 1/x", image_url: null, is_correct: false, position: 3, created_at: "2026-01-01T00:00:00Z" },
      ],
      tags: [],
    },
  ];

  it("round-trips StudySet losslessly across JSON, CSV, EduQuiz TXT, and XLSX", async () => {
    // 1. JSON round-trip
    const jsonOut = await exportStudySet(sampleSet, sampleQuestions, { format: "json" });
    const jsonParsed = await parseImportInput({
      fileBytes: jsonOut.content,
      fileName: jsonOut.fileName,
    });
    expect(jsonParsed.questions).toHaveLength(2);
    expect(jsonParsed.questions[0].prompt).toBe(sampleQuestions[0].prompt);
    expect(jsonParsed.questions[0].chapter).toBe("Chương 1: Giới hạn");
    expect(jsonParsed.questions[0].explanation).toBe(sampleQuestions[0].explanation);
    expect(jsonParsed.questions[0].options.filter((o) => o.isCorrect).map((o) => o.label)).toEqual(["B"]);
    expect(jsonParsed.questions[1].options.filter((o) => o.isCorrect).map((o) => o.label)).toEqual(["A", "C"]);

    // 2. CSV (with UTF-8 BOM) round-trip
    const csvOut = await exportStudySet(sampleSet, sampleQuestions, { format: "csv" });
    expect(csvOut.content[0]).toBe(0xef); // UTF-8 BOM preserved for Excel
    const csvParsed = await parseImportInput({
      fileBytes: csvOut.content,
      fileName: csvOut.fileName,
    });
    expect(csvParsed.questions).toHaveLength(2);
    expect(csvParsed.questions[0].prompt).toBe(sampleQuestions[0].prompt);
    expect(csvParsed.questions[0].options.filter((o) => o.isCorrect).map((o) => o.label)).toEqual(["B"]);
    expect(csvParsed.questions[1].options.filter((o) => o.isCorrect).map((o) => o.label)).toEqual(["A", "C"]);

    // 3. EduQuiz TXT round-trip
    const txtOut = await exportStudySet(sampleSet, sampleQuestions, {
      format: "txt",
      txtStyle: "eduquiz",
    });
    const txtParsed = await parseImportInput({
      fileBytes: txtOut.content,
      fileName: txtOut.fileName,
    });
    expect(txtParsed.questions).toHaveLength(2);
    expect(txtParsed.questions[0].chapter).toBe("Chương 1: Giới hạn");
    expect(txtParsed.questions[1].chapter).toBe("Chương 2: Đạo hàm");
    expect(txtParsed.questions[0].options.filter((o) => o.isCorrect).map((o) => o.label)).toEqual(["B"]);
    expect(txtParsed.questions[1].options.filter((o) => o.isCorrect).map((o) => o.label)).toEqual(["A", "C"]);

    // 4. XLSX round-trip
    const xlsxOut = await exportStudySet(sampleSet, sampleQuestions, {
      format: "xlsx",
      xlsxStyle: "standard",
    });
    const xlsxParsed = await parseImportInput({
      fileBytes: xlsxOut.content,
      fileName: xlsxOut.fileName,
    });
    expect(xlsxParsed.questions).toHaveLength(2);
    expect(xlsxParsed.questions[0].prompt).toBe(sampleQuestions[0].prompt);
    expect(xlsxParsed.questions[0].options.filter((o) => o.isCorrect).map((o) => o.label)).toEqual(["B"]);
    expect(xlsxParsed.questions[1].options.filter((o) => o.isCorrect).map((o) => o.label)).toEqual(["A", "C"]);
  });
});
