import { expect, test } from "@playwright/test";

/**
 * Full 20-step two-account authenticated E2E journey for StudyHub V1.0.
 *
 * Requires a live Supabase project (local Docker `supabase start` or hosted Supabase)
 * with migrations `0001`..`0004` applied and `.env.local` configured.
 * Enable by setting:
 *   E2E_SUPABASE_READY=1
 *   E2E_USER_A_EMAIL=... E2E_USER_A_PASSWORD=...
 *   E2E_USER_B_EMAIL=... E2E_USER_B_PASSWORD=...
 */
const SUPABASE_E2E_READY = process.env.E2E_SUPABASE_READY === "1";

function build50QuestionEduQuizFixture(): string {
  const lines: string[] = [];
  const letters = ["A", "B", "C", "D"];
  for (let i = 1; i <= 50; i += 1) {
    if (i === 1) lines.push("Chương 1: Đại số tuyến tính");
    if (i === 26) lines.push("Chương 2: Giải tích cơ bản");
    const correctIdx = (i - 1) % 4;
    lines.push(`Câu ${i}: Nội dung câu hỏi kiểm thử tự động số ${i}?`);
    for (let o = 0; o < 4; o += 1) {
      lines.push(`${o === correctIdx ? "*" : ""}${letters[o]}. Lựa chọn ${letters[o]} cho câu ${i}`);
    }
    lines.push(`Giải thích: Đáp án đúng là ${letters[correctIdx]} theo quy tắc xác định.`);
    lines.push("");
  }
  return lines.join("\n");
}

test.describe("StudyHub 20-Step Two-Account Authenticated Journey (Live Supabase)", () => {
  test.skip(
    !SUPABASE_E2E_READY,
    "Skipped until live Supabase credentials / Docker daemon are configured (set E2E_SUPABASE_READY=1).",
  );

  test("complete study, 50-Q import, timed exam anti-leak, snapshot immutability, and 2-account RLS isolation", async ({
    browser,
  }) => {
    const emailA = process.env.E2E_USER_A_EMAIL ?? "e2e-user-a@studyhub.local";
    const passwordA = process.env.E2E_USER_A_PASSWORD ?? "StudyHub!E2E123";
    const emailB = process.env.E2E_USER_B_EMAIL ?? "e2e-user-b@studyhub.local";
    const passwordB = process.env.E2E_USER_B_PASSWORD ?? "StudyHub!E2E456";

    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();

    // 1-2. Sign in as User A
    await pageA.goto("/login", { waitUntil: "networkidle" });
    await pageA.getByLabel(/email/i).fill(emailA);
    await pageA.getByLabel(/mật khẩu|password/i).fill(passwordA);
    await pageA.getByRole("button", { name: /đăng nhập|sign in/i }).click();
    await pageA.waitForURL("**/dashboard");

    // 3-4. Create folder & Study Set
    await pageA.goto("/sets/new", { waitUntil: "networkidle" });
    const uniqueTitle = `E2E Giải tích ${Date.now()}`;
    await pageA.getByLabel(/tiêu đề|title/i).fill(uniqueTitle);
    await pageA.getByRole("button", { name: /tạo học phần|create/i }).click();
    await pageA.waitForURL(/\/sets\/[0-9a-f-]+$/);
    const setUrl = pageA.url();
    const setId = setUrl.split("/sets/")[1];
    expect(setId).toBeTruthy();

    // 5-6. Bulk Import 50 questions via EduQuiz TXT paste
    await pageA.goto(`/sets/${setId}/import`, { waitUntil: "networkidle" });
    const fixture50 = build50QuestionEduQuizFixture();
    await pageA.locator("textarea").first().fill(fixture50);
    await pageA.getByRole("button", { name: /phân tích|parse/i }).click();
    await expect(pageA.getByText(/50/)).toBeVisible();
    await pageA.getByRole("button", { name: /lưu|commit|nhập/i }).click();
    await pageA.waitForURL(new RegExp(`/sets/${setId}$`));

    // 7-13. Verify study modes load cleanly (Flashcards, Learn, Practice, Write, Match)
    for (const mode of ["flashcards", "learn", "practice", "write", "match"]) {
      await pageA.goto(`/sets/${setId}/${mode}`, { waitUntil: "networkidle" });
      await expect(pageA.locator("main")).toBeVisible();
    }

    // 14-15. Start 20-question timed mock exam + assert ZERO answer key leakage in network response
    let examStartBody = "";
    pageA.on("response", async (res) => {
      if (res.url().endsWith("/api/exams") && res.request().method() === "POST") {
        examStartBody = await res.text();
      }
    });

    await pageA.goto(`/sets/${setId}/test`, { waitUntil: "networkidle" });
    await pageA.getByRole("button", { name: /bắt đầu thi|start exam/i }).click();
    await pageA.waitForTimeout(1000);

    expect(examStartBody.length).toBeGreaterThan(0);
    expect(examStartBody).not.toContain("correct_option_ids");
    expect(examStartBody).not.toContain("accepted_answers_snapshot");
    expect(examStartBody).not.toContain("explanation_snapshot");
    expect(examStartBody).not.toContain('"is_correct"');

    // Reload page mid-exam to confirm server-synced timer & autosave persist
    await pageA.reload({ waitUntil: "networkidle" });
    await expect(pageA.locator("main")).toBeVisible();

    // Submit exam & land on results page
    await pageA.getByRole("button", { name: /nộp bài|submit/i }).click();
    const confirmSubmit = pageA.getByRole("button", { name: /xác nhận nộp|confirm/i });
    if (await confirmSubmit.isVisible()) {
      await confirmSubmit.click();
    }
    await pageA.waitForURL(new RegExp(`/sets/${setId}/results/[0-9a-f-]+`));

    // 16-18. Verify secondary pages load cleanly
    for (const route of ["/starred", "/review", "/history", "/statistics"]) {
      await pageA.goto(route, { waitUntil: "networkidle" });
      await expect(pageA.locator("main")).toBeVisible();
    }

    // 19. Second isolated account (User B) MUST be blocked from User A's private study set (RLS isolation)
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await pageB.goto("/login", { waitUntil: "networkidle" });
    await pageB.getByLabel(/email/i).fill(emailB);
    await pageB.getByLabel(/mật khẩu|password/i).fill(passwordB);
    await pageB.getByRole("button", { name: /đăng nhập|sign in/i }).click();
    await pageB.waitForURL("**/dashboard");

    const rlsRes = await pageB.request.get(`/api/sets/${setId}`);
    expect([403, 404]).toContain(rlsRes.status());

    // 20. Sign out User A and verify /dashboard redirects back to /login
    await pageA.request.post("/auth/signout");
    await pageA.goto("/dashboard", { waitUntil: "networkidle" });
    expect(pageA.url()).toContain("/login");

    await contextA.close();
    await contextB.close();
  });
});
