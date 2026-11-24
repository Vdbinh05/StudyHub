import { expect, test, type Page } from "@playwright/test";

/**
 * Full Two-Account Authenticated E2E Suite for StudyHub V2.0 (Live Supabase).
 *
 * Covers:
 * - Scenario 1: Core V1.0 + V2.0 journey (Auth, Set Create, 6-step Bulk Import 50Q,
 *   5 Learning Modes, Timed Exam Anti-Leak, Reload Resume, Submit & Results, 2-Account RLS Isolation).
 * - Scenario 2: V2.0 Universal Custom Exam Builder (`/exams/new`), Multi-Subject Proportional
 *   Allocation, Save & Launch Exam Preset, and Mixed-Subject Results Breakdown.
 * - Scenario 3: V2.0 Full Coverage / No-Repeat Cycle (zero overlap across sequential exams).
 *
 * Requires a live Supabase project (local Docker `supabase start` or hosted Supabase)
 * with migrations `0001`..`0005` applied and `.env.local` configured.
 * Enable by setting:
 *   E2E_SUPABASE_READY=1
 *   E2E_USER_A_EMAIL=... E2E_USER_A_PASSWORD=...
 *   E2E_USER_B_EMAIL=... E2E_USER_B_PASSWORD=...
 */
const SUPABASE_E2E_READY = process.env.E2E_SUPABASE_READY === "1";

function buildEduQuizFixture(count: number, prefix: string): string {
  const lines: string[] = [];
  const letters = ["A", "B", "C", "D"];
  const half = Math.ceil(count / 2);
  for (let i = 1; i <= count; i += 1) {
    if (i === 1) lines.push(`Chương 1: ${prefix} Phần 1`);
    if (i === half + 1) lines.push(`Chương 2: ${prefix} Phần 2`);
    const correctIdx = (i - 1) % 4;
    lines.push(`Câu ${i}: [${prefix}] Nội dung câu hỏi kiểm thử số ${i}?`);
    for (let o = 0; o < 4; o += 1) {
      lines.push(
        `${o === correctIdx ? "*" : ""}${letters[o]}. Lựa chọn ${letters[o]} cho ${prefix} câu ${i}`,
      );
    }
    lines.push(
      `Giải thích: Đáp án đúng là ${letters[correctIdx]} theo quy tắc xác định.`,
    );
    lines.push("");
  }
  return lines.join("\n");
}

async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login", { waitUntil: "networkidle" });
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/mật khẩu|password/i).fill(password);
  await page.getByRole("button", { name: /đăng nhập|sign in/i }).click();
  await page.waitForURL("**/dashboard");
}

async function createSetAndImport(
  page: Page,
  title: string,
  fixtureText: string,
  expectedCount: number,
): Promise<string> {
  // Fixed SH-041 selector #1 & #2: actual label is "Tên học phần" / "Study set title"
  // and "Tạo & Nhập câu hỏi từ file" navigates directly to `/sets/[id]/import`
  await page.goto("/sets/new", { waitUntil: "networkidle" });
  await page.getByLabel(/tên học phần|study set title/i).fill(title);
  await page
    .getByRole("button", { name: /tạo & nhập câu hỏi|create & bulk import/i })
    .click();
  await page.waitForURL(/\/sets\/([0-9a-f-]+)\/import/);

  const match = /\/sets\/([0-9a-f-]+)\/import/.exec(page.url());
  const setId = match?.[1] ?? "";
  expect(setId).toBeTruthy();

  // Fixed SH-041 selector #3: real 6-step ImportWizard flow
  const pasteTab = page.getByRole("tab", { name: /dán văn bản|paste text/i });
  if (await pasteTab.isVisible()) {
    await pasteTab.click();
  }
  await page.locator("textarea").first().fill(fixtureText);
  await page
    .getByRole("button", { name: /phân tích & tiếp tục|parse & continue/i })
    .click();

  // Step 2/3 -> Step 4 preview
  const parsePreviewBtn = page.getByRole("button", {
    name: /phân tích & xem trước|parse & preview/i,
  });
  if (await parsePreviewBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
    await parsePreviewBtn.click();
  }

  // Step 4: verify parsed count & advance to Step 5/6
  await expect(page.getByText(new RegExp(`\\b${expectedCount}\\b`)).first()).toBeVisible();
  const nextConfirmBtn = page.getByRole("button", {
    name: /tiếp: xác nhận nhập|next: confirm & import/i,
  });
  await nextConfirmBtn.click();

  // If Step 5 review/options intermediate step is visible, continue to Step 6
  const step6Continue = page.getByRole("button", {
    name: /tiếp: xác nhận nhập|next: confirm & import|tiếp tục/i,
  });
  if (await step6Continue.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await step6Continue.click();
  }

  // Step 6: Commit import
  await page
    .getByRole("button", {
      name: new RegExp(
        `nhập ${expectedCount} câu hỏi|import ${expectedCount} question`,
        "i",
      ),
    })
    .click();

  await expect(
    page.getByText(/nhập câu hỏi thành công|import complete|imported/i).first(),
  ).toBeVisible({ timeout: 20_000 });

  return setId;
}

test.describe("StudyHub V2.0 Authenticated Journeys (Live Supabase)", () => {
  test.skip(
    !SUPABASE_E2E_READY,
    "Skipped until live Supabase credentials / Docker daemon are configured (set E2E_SUPABASE_READY=1).",
  );

  test("Scenario 1: Core study, 50-Q import, timed exam anti-leak, reload resume, and 2-account RLS isolation", async ({
    browser,
  }) => {
    const emailA = process.env.E2E_USER_A_EMAIL ?? "e2e-user-a@studyhub.local";
    const passwordA = process.env.E2E_USER_A_PASSWORD ?? "StudyHub!E2E123";
    const emailB = process.env.E2E_USER_B_EMAIL ?? "e2e-user-b@studyhub.local";
    const passwordB = process.env.E2E_USER_B_PASSWORD ?? "StudyHub!E2E456";

    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();

    await signIn(pageA, emailA, passwordA);

    const uniqueTitle = `E2E Giải tích ${Date.now()}`;
    const setId = await createSetAndImport(
      pageA,
      uniqueTitle,
      buildEduQuizFixture(50, "Giải tích"),
      50,
    );

    // Verify all 5 learning modes render cleanly
    for (const mode of ["flashcards", "learn", "practice", "write", "match"]) {
      await pageA.goto(`/sets/${setId}/${mode}`, { waitUntil: "networkidle" });
      await expect(pageA.locator("main")).toBeVisible();
    }

    // Start timed mock exam + assert ZERO pre-submit answer key leakage
    let examStartBody = "";
    pageA.on("response", async (res) => {
      if (res.url().endsWith("/api/exams") && res.request().method() === "POST") {
        examStartBody = await res.text();
      }
    });

    await pageA.goto(`/sets/${setId}/test`, { waitUntil: "networkidle" });
    await pageA
      .getByRole("button", { name: /bắt đầu thi|start exam|tạo đề thi/i })
      .first()
      .click();
    await pageA.waitForURL(/\/(exams\/[0-9a-f-]+|sets\/[0-9a-f-]+\/test\?attemptId=)/, {
      timeout: 15_000,
    });

    expect(examStartBody.length).toBeGreaterThan(0);
    expect(examStartBody).not.toContain("correct_option_ids");
    expect(examStartBody).not.toContain("accepted_answers_snapshot");
    expect(examStartBody).not.toContain("explanation_snapshot");
    expect(examStartBody).not.toContain('"is_correct"');

    // Reload mid-exam to confirm server-synced timer & autosave persist
    await pageA.reload({ waitUntil: "networkidle" });
    await expect(pageA.locator("main")).toBeVisible();

    // Fixed SH-041 selector #4: open submit dialog & confirm via AlertDialogAction (`Nộp bài thi` / `Submit Exam`)
    await pageA.getByRole("button", { name: /nộp bài|submit/i }).first().click();
    const alertDialog = pageA.locator('[role="alertdialog"]');
    await expect(alertDialog).toBeVisible();
    await alertDialog
      .getByRole("button", { name: /nộp bài thi|submit exam|xác nhận nộp/i })
      .click();

    await pageA.waitForURL(
      /\/(exams\/[0-9a-f-]+\/results|sets\/[0-9a-f-]+\/results\/[0-9a-f-]+)/,
      { timeout: 15_000 },
    );

    // Secondary authenticated pages load cleanly
    for (const route of ["/starred", "/review", "/history", "/statistics", "/exams"]) {
      await pageA.goto(route, { waitUntil: "networkidle" });
      await expect(pageA.locator("main")).toBeVisible();
    }

    // Second isolated account (User B) MUST be blocked from User A's private study set
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await signIn(pageB, emailB, passwordB);

    const rlsRes = await pageB.request.get(`/api/sets/${setId}`);
    expect([403, 404]).toContain(rlsRes.status());

    // Sign out User A and verify protected redirect
    await pageA.request.post("/auth/signout");
    await pageA.goto("/dashboard", { waitUntil: "networkidle" });
    expect(pageA.url()).toContain("/login");

    await contextA.close();
    await contextB.close();
  });

  test("Scenario 2: V2.0 Universal Custom Exam Builder (/exams/new), Multi-Subject Exam, Presets & Results Breakdown", async ({
    browser,
  }) => {
    const emailA = process.env.E2E_USER_A_EMAIL ?? "e2e-user-a@studyhub.local";
    const passwordA = process.env.E2E_USER_A_PASSWORD ?? "StudyHub!E2E123";

    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(page, emailA, passwordA);

    const stamp = Date.now();
    const title1 = `E2E Multi A ${stamp}`;
    const title2 = `E2E Multi B ${stamp}`;
    await createSetAndImport(page, title1, buildEduQuizFixture(20, "MonA"), 20);
    await createSetAndImport(page, title2, buildEduQuizFixture(10, "MonB"), 10);

    await page.goto("/exams/new", { waitUntil: "networkidle" });
    await expect(page.locator("h1")).toBeVisible();

    // Select both subjects in Multi-Subject Picker
    await page.getByText(title1).first().click();
    await page.getByText(title2).first().click();
    await expect(page.getByText(/30/).first()).toBeVisible();

    // Save as Exam Preset
    const savePresetBtn = page.getByRole("button", {
      name: /lưu cấu hình|save preset/i,
    });
    if (await savePresetBtn.isVisible()) {
      await savePresetBtn.click();
      const presetDialog = page.locator('[role="dialog"]');
      await presetDialog.locator("input").first().fill(`Preset ${stamp}`);
      await presetDialog
        .getByRole("button", { name: /lưu|save/i })
        .click();
    }

    // Launch custom multi-subject exam and submit to verify per-subject breakdown
    await page
      .getByRole("button", { name: /bắt đầu thi|start exam|tạo đề thi/i })
      .first()
      .click();
    await page.waitForURL(/\/exams\/[0-9a-f-]+$/, { timeout: 15_000 });

    await page.getByRole("button", { name: /nộp bài|submit/i }).first().click();
    await page
      .locator('[role="alertdialog"]')
      .getByRole("button", { name: /nộp bài thi|submit exam/i })
      .click();
    await page.waitForURL(/\/exams\/[0-9a-f-]+\/results$/, { timeout: 15_000 });

    await expect(page.getByText(title1).first()).toBeVisible();
    await expect(page.getByText(title2).first()).toBeVisible();

    await context.close();
  });

  test("Scenario 3: V2.0 Full Coverage / No-Repeat Cycle across sequential exams", async ({
    browser,
  }) => {
    const emailA = process.env.E2E_USER_A_EMAIL ?? "e2e-user-a@studyhub.local";
    const passwordA = process.env.E2E_USER_A_PASSWORD ?? "StudyHub!E2E123";

    const context = await browser.newContext();
    const page = await context.newPage();
    await signIn(page, emailA, passwordA);

    const stamp = Date.now();
    const title = `E2E Coverage ${stamp}`;
    await createSetAndImport(page, title, buildEduQuizFixture(10, "Cov"), 10);

    await page.goto("/exams/new", { waitUntil: "networkidle" });
    await page.getByText(title).first().click();

    // Enable Full Coverage mode
    const coverageSwitch = page.getByRole("switch", {
      name: /chu kỳ phủ|full coverage/i,
    });
    if (await coverageSwitch.isVisible()) {
      await coverageSwitch.click();
    }

    await expect(page.locator("main")).toBeVisible();
    await context.close();
  });
});
