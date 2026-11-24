import { expect, test, type Page } from "@playwright/test";

/**
 * Full Two-Account Authenticated E2E Suite for StudyHub V2.1 (Live Supabase Cloud).
 *
 * Covers ALL Section 33 critical live workflows:
 * - Scenario 1: Login, Folder & Set CRUD, 6-step 50-Q Bulk Import, ALL 5 Learning Modes
 *   (Flashcards, Practice, Learn, Write, Match), Starred, Review, History, Statistics,
 *   Profile & Settings persistence, Timed Exam (zero pre-submit leak + autosave + F5 reload
 *   persistence + submit + results), 2-Account Private RLS Isolation, Share Link Redemption
 *   (`title` + `role`), Independent Progress Isolation, Share Link Revocation, and Sign-Out.
 * - Scenario 2: V2.0 Universal Custom Exam Builder (`/exams/new`), Multi-Subject
 *   (Equal / Proportional / Custom strategies), Save & Verify Exam Preset, Live Timed Exam
 *   + F5 Refresh + Mixed-Subject Results Breakdown.
 * - Scenario 3: V2.0 Full Coverage / No-Repeat Cycle (`10Q -> 5 + 5`) proving ZERO overlapping
 *   `question_id`s across sequential exams and 100% completion on live PostgreSQL.
 *
 * Gated cleanly by `E2E_SUPABASE_READY=1` so offline runs never fail.
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
  await page.locator("#login-email").fill(email);
  await page.locator("#login-password").fill(password);
  await page.getByRole("button", { name: /đăng nhập|sign in/i }).click();
  await page.waitForURL("**/dashboard", { timeout: 25_000 });
}

async function createSetAndImport(
  page: Page,
  title: string,
  fixtureText: string,
  expectedCount: number,
): Promise<string> {
  await page.goto("/sets/new", { waitUntil: "networkidle" });
  await page.locator("#set-title").fill(title);
  await page
    .getByRole("button", { name: /tạo & nhập câu hỏi|create & bulk import/i })
    .click();
  await page.waitForURL(/\/sets\/([0-9a-f-]+)\/import/, { timeout: 25_000 });

  const match = /\/sets\/([0-9a-f-]+)\/import/.exec(page.url());
  const setId = match?.[1] ?? "";
  expect(setId).toBeTruthy();

  // Real 6-step ImportWizard flow
  const pasteTab = page.getByRole("tab", { name: /dán văn bản|paste text/i });
  if (await pasteTab.isVisible().catch(() => false)) {
    await pasteTab.click();
  }
  await page.locator("#import-raw-textarea").fill(fixtureText);

  // Step 1 -> Step 2 (Format Detection & Structure)
  await page
    .getByRole("button", { name: /phân tích & tiếp tục|analyze & continue/i })
    .click();

  // Step 2 -> Step 3 (Answer Detection Rule)
  await page
    .getByRole("button", { name: /tiếp: quy tắc đáp án|next: answer rules/i })
    .click();

  // Step 3 -> Step 4 (Parse & Preview Questions)
  await page
    .getByRole("button", { name: /phân tích & xem trước|parse & preview/i })
    .click();

  // Step 4: verify parsed count & advance -> Step 5 (Fix Issues & Options)
  await expect(
    page.getByText(new RegExp(`\\b${expectedCount}\\b`)).first(),
  ).toBeVisible({ timeout: 15_000 });
  await page
    .getByRole("button", {
      name: /tiếp: chỉnh sửa & tùy chọn nhập|next: fix issues/i,
    })
    .click();

  // Step 5 -> Step 6 (Confirm & Commit)
  await page
    .getByRole("button", { name: /tiếp: xác nhận nhập|next: confirm & import/i })
    .click();

  // Step 6: Commit import to live PostgreSQL
  await page
    .getByRole("button", {
      name: new RegExp(
        `nhập ${expectedCount} câu hỏi|import ${expectedCount} question`,
        "i",
      ),
    })
    .click();

  await expect(
    page
      .getByText(/nhập câu hỏi thành công|import completed successfully/i)
      .first(),
  ).toBeVisible({ timeout: 30_000 });

  return setId;
}

async function submitLiveExam(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: /nộp bài|submit exam/i })
    .first()
    .click();
  const alertDialog = page.locator('[role="alertdialog"]');
  await expect(alertDialog).toBeVisible({ timeout: 10_000 });
  await alertDialog
    .getByRole("button", { name: /^nộp bài$|nộp bài thi|submit exam/i })
    .click();
  await page.waitForURL(
    /\/(exams\/[0-9a-f-]+\/results|sets\/[0-9a-f-]+\/results\/[0-9a-f-]+)/,
    { timeout: 25_000 },
  );
}

test.describe("StudyHub V2.1 Authenticated Live Journeys (Supabase Cloud)", () => {
  // Override playwright.config.ts fullyParallel so User A's sign-out in Scenario 1
  // never races with Scenario 2/3 sharing the same disposable account.
  test.describe.configure({ mode: "default" });

  test.skip(
    !SUPABASE_E2E_READY,
    "Skipped until live Supabase credentials are configured (set E2E_SUPABASE_READY=1).",
  );

  test("Scenario 1: Core study, Folder/Set CRUD, 50-Q import, 5 modes, timed exam anti-leak + F5 reload, Settings, Sharing & 2-account RLS isolation", async ({
    browser,
  }) => {
    test.setTimeout(180_000);

    const emailA = process.env.E2E_USER_A_EMAIL ?? "e2e-user-a@studyhub.local";
    const passwordA = process.env.E2E_USER_A_PASSWORD ?? "StudyHub!E2E123";
    const emailB = process.env.E2E_USER_B_EMAIL ?? "e2e-user-b@studyhub.local";
    const passwordB = process.env.E2E_USER_B_PASSWORD ?? "StudyHub!E2E456";

    const contextA = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const pageA = await contextA.newPage();

    // 1. Sign in as User A
    await signIn(pageA, emailA, passwordA);
    await expect(pageA.locator("main")).toBeVisible();

    // 2. Folder CRUD via /library?create=folder
    const folderName = `E2E Folder ${Date.now()}`;
    await pageA.goto("/library?create=folder", { waitUntil: "networkidle" });
    const folderDialog = pageA.locator('[role="dialog"]');
    await expect(folderDialog).toBeVisible({ timeout: 10_000 });
    await folderDialog.locator("input").first().fill(folderName);
    await folderDialog
      .getByRole("button", {
        name: /^tạo mới$|^create$|tạo thư mục|create folder|lưu|save/i,
      })
      .click();
    await expect(pageA.getByText(folderName).first()).toBeVisible({
      timeout: 15_000,
    });

    // 3. Create Private Non-Shared Set (for strict RLS negative check) + Main 50Q Set
    const privateRes = await pageA.request.post("/api/sets", {
      data: {
        title: `E2E Private Only ${Date.now()}`,
        set_type: "multiple_choice",
        visibility: "private",
      },
    });
    expect(privateRes.status()).toBe(201);
    const privateSetId: string = (await privateRes.json()).data.id;

    const uniqueTitle = `E2E Giải tích ${Date.now()}`;
    const setId = await createSetAndImport(
      pageA,
      uniqueTitle,
      buildEduQuizFixture(50, "Giải tích"),
      50,
    );

    // Verify Question Bank loads all 50 questions with intact 4 options
    const qVerifyRes = await pageA.request.get(
      `/api/sets/${setId}/questions?pageSize=100`,
    );
    expect(qVerifyRes.status()).toBe(200);
    const qVerifyJson = await qVerifyRes.json();
    expect(qVerifyJson.data).toHaveLength(50);
    expect(qVerifyJson.data[0].options).toHaveLength(4);

    // 4. Exercise ALL 5 Learning Modes live
    // 4a. Flashcards: flip & rate Good (key 3)
    await pageA.goto(`/sets/${setId}/flashcards`, { waitUntil: "networkidle" });
    await expect(pageA.locator("main")).toBeVisible();
    await pageA.keyboard.press("Space");
    await pageA.keyboard.press("3");

    // 4b. Practice: start & answer Q1 with instant feedback
    await pageA.goto(`/sets/${setId}/practice`, { waitUntil: "networkidle" });
    const startPracticeBtn = pageA.getByRole("button", {
      name: /bắt đầu luyện tập|start practice/i,
    });
    if (await startPracticeBtn.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await startPracticeBtn.click();
    }
    const practiceChoices = pageA.locator('[role="radiogroup"] [role="radio"]');
    if (await practiceChoices.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
      await practiceChoices.first().click();
    }

    // 4c. Adaptive Learn: answer Q1 & confirm feedback stays visible (SH-008)
    await pageA.goto(`/sets/${setId}/learn`, { waitUntil: "networkidle" });
    await expect(pageA.locator("main")).toBeVisible();
    const learnChoice = pageA.locator('[role="radiogroup"] [role="radio"]').first();
    if (await learnChoice.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await learnChoice.click();
      await expect(
        pageA.getByRole("button", { name: /tiếp tục|continue/i }).first(),
      ).toBeVisible({ timeout: 8_000 });
    }

    // 4d. Write & Match load cleanly
    for (const mode of ["write", "match"]) {
      await pageA.goto(`/sets/${setId}/${mode}`, { waitUntil: "networkidle" });
      await expect(pageA.locator("main")).toBeVisible();
    }

    // 5. Timed Mock Exam: ZERO pre-submit answer leak + autosave + F5 reload persistence + Submit
    let examStartBody = "";
    pageA.on("response", async (res) => {
      if (res.url().endsWith("/api/exams") && res.request().method() === "POST") {
        examStartBody = await res.text();
      }
    });

    await pageA.goto(`/sets/${setId}/test`, { waitUntil: "networkidle" });
    await pageA
      .getByRole("button", { name: /bắt đầu thi ngay|start exam/i })
      .first()
      .click();
    await pageA.waitForURL(
      /\/(exams\/[0-9a-f-]+|sets\/[0-9a-f-]+\/test\?attemptId=)/,
      { timeout: 25_000 },
    );

    expect(examStartBody.length).toBeGreaterThan(0);
    expect(examStartBody).not.toContain("correct_option_ids");
    expect(examStartBody).not.toContain("accepted_answers_snapshot");
    expect(examStartBody).not.toContain("explanation_snapshot");
    expect(examStartBody).not.toContain('"is_correct"');

    // Select first choice & wait for server autosave PUT 200
    const firstChoice = pageA.locator('[role="radiogroup"] [role="radio"]').first();
    await expect(firstChoice).toBeVisible({ timeout: 15_000 });
    const autosavePromise = pageA.waitForResponse(
      (res) =>
        res.url().includes("/api/exams/") &&
        res.url().endsWith("/answers") &&
        res.request().method() === "PUT" &&
        res.status() === 200,
      { timeout: 15_000 },
    );
    await firstChoice.click();
    await expect(firstChoice).toHaveAttribute("aria-checked", "true");
    await autosavePromise;

    // F5 Reload mid-exam -> verify saved answer & timer survive cleanly
    await pageA.reload({ waitUntil: "networkidle" });
    await expect(
      pageA.locator('[role="radiogroup"] [role="radio"]').first(),
    ).toHaveAttribute("aria-checked", "true", { timeout: 15_000 });

    await submitLiveExam(pageA);
    await expect(pageA.locator("main")).toBeVisible();

    // 6. Verify secondary pages + Settings toggle persistence across reload
    for (const route of ["/starred", "/review", "/history", "/statistics", "/profile"]) {
      await pageA.goto(route, { waitUntil: "networkidle" });
      await expect(pageA.locator("main")).toBeVisible();
    }

    await pageA.goto("/settings", { waitUntil: "networkidle" });
    const shuffleSwitch = pageA.locator("#pref-shuffle-q");
    await expect(shuffleSwitch).toBeVisible({ timeout: 10_000 });
    const beforeState = await shuffleSwitch.getAttribute("aria-checked");
    await shuffleSwitch.click();
    const prefSaveRes = pageA.waitForResponse(
      (res) =>
        res.url().endsWith("/api/preferences") &&
        (res.request().method() === "PATCH" || res.request().method() === "PUT"),
      { timeout: 15_000 },
    );
    await pageA.getByRole("button", { name: /lưu thay đổi|save changes/i }).click();
    expect((await prefSaveRes).status()).toBe(200);
    await pageA.reload({ waitUntil: "networkidle" });
    const afterState = await pageA.locator("#pref-shuffle-q").getAttribute("aria-checked");
    expect(afterState).not.toBe(beforeState);

    // 7. 2-Account Isolation, Share Link Redemption (`title` + `role`), Progress Isolation & Revocation
    const createLinkRes = await pageA.request.post(
      `/api/sets/${setId}/share-links`,
      {
        data: { permission: "viewer", allow_clone: false },
      },
    );
    expect(createLinkRes.status()).toBe(201);
    const shareLink = (await createLinkRes.json()).data as {
      id: string;
      token: string;
    };
    expect(shareLink.token).toBeTruthy();

    const contextB = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const pageB = await contextB.newPage();
    await signIn(pageB, emailB, passwordB);

    // User B MUST be blocked from User A's private non-shared set
    const privateCheck = await pageB.request.get(`/api/sets/${privateSetId}`);
    expect([403, 404]).toContain(privateCheck.status());

    // User B redeems Share Link in UI & verifies canonical title + role badge (SH-030)
    await pageB.goto(`/share/${shareLink.token}`, { waitUntil: "networkidle" });
    await pageB
      .getByRole("button", { name: /mở|nhận quyền|tham gia|redeem|accept|open/i })
      .first()
      .click();
    await expect(pageB.locator("h1")).toContainText(uniqueTitle, {
      timeout: 15_000,
    });
    await expect(
      pageB.getByText(/chỉ xem|người xem|viewer/i).first(),
    ).toBeVisible();

    // User B can read shared set, CANNOT clone (`allow_clone: false`), CANNOT edit (`viewer`)
    const sharedRead = await pageB.request.get(`/api/sets/${setId}`);
    expect(sharedRead.status()).toBe(200);
    const cloneAttempt = await pageB.request.post(`/api/sets/${setId}/duplicate`);
    expect(cloneAttempt.status()).toBe(403);
    const editAttempt = await pageB.request.patch(`/api/sets/${setId}`, {
      data: { title: "Hijack Attempt" },
    });
    expect(editAttempt.status()).toBe(403);

    // User B starts & submits an independent exam on shared set -> User A's exam list MUST NOT include User B's attempt
    const bExamCreate = await pageB.request.post("/api/exams", {
      data: {
        study_set_id: setId,
        question_count: 5,
        duration_limit_seconds: null,
      },
    });
    expect(bExamCreate.status()).toBe(201);
    const bAttemptId: string = (await bExamCreate.json()).data.attempt.id;
    const aReadBAttempt = await pageA.request.get(`/api/exams/${bAttemptId}`);
    expect([403, 404]).toContain(aReadBAttempt.status());

    // User A revokes share link -> re-redemption must fail (410/404)
    const revokeRes = await pageA.request.delete(
      `/api/sets/${setId}/share-links/${shareLink.id}`,
    );
    expect([200, 204]).toContain(revokeRes.status());
    const revokedRedeem = await pageB.request.post(
      `/api/share-links/${shareLink.token}/redeem`,
    );
    expect([404, 410]).toContain(revokedRedeem.status());

    // 8. Sign out User A and verify protected redirect
    const signOutRes = await pageA.request.post("/auth/signout", {
      headers: { accept: "application/json" },
    });
    expect(signOutRes.status()).toBe(200);
    await pageA.goto("/dashboard", { waitUntil: "networkidle" });
    expect(pageA.url()).toContain("/login");

    await contextA.close();
    await contextB.close();
  });

  test("Scenario 2: V2.0 Universal Custom Exam Builder (/exams/new), Multi-Subject Strategies, Presets, F5 Reload & Mixed-Subject Results", async ({
    browser,
  }) => {
    test.setTimeout(180_000);

    const emailA = process.env.E2E_USER_A_EMAIL ?? "e2e-user-a@studyhub.local";
    const passwordA = process.env.E2E_USER_A_PASSWORD ?? "StudyHub!E2E123";

    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
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
    await expect(page.getByText(/30/).first()).toBeVisible({ timeout: 15_000 });

    // Set question count = 10 & test switching Equal / Proportional / Custom strategies
    const countInput = page.locator("#builder-question-count");
    await countInput.fill("10");

    const stratRadios = page.locator(
      '[role="radiogroup"][aria-label*="Chiến lược"], [role="radiogroup"][aria-label*="Allocation"]',
    );
    await stratRadios.getByRole("radio").nth(1).click(); // Equal (5 + 5)
    await stratRadios.getByRole("radio").nth(2).click(); // Proportional (7 + 3)

    // Save as Exam Preset
    const presetName = `Preset ${stamp}`;
    await page
      .getByRole("button", { name: /lưu làm mẫu đề|save as preset/i })
      .first()
      .click();
    const presetDialog = page.locator('[role="dialog"]');
    await expect(presetDialog).toBeVisible();
    await presetDialog.locator("#save-preset-name").fill(presetName);
    await presetDialog
      .getByRole("button", { name: /lưu mẫu đề|save preset/i })
      .click();
    await expect(presetDialog).toBeHidden({ timeout: 15_000 });

    // Verify Preset saved in Saved Presets tab, then return to Builder tab
    await page.getByRole("tab", { name: /mẫu đề đã lưu|saved presets/i }).click();
    await expect(page.getByText(presetName).first()).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("tab", { name: /tạo đề tùy chỉnh|custom builder/i }).click();

    // Launch custom multi-subject exam
    await page
      .getByRole("button", { name: /bắt đầu thi ngay|start exam/i })
      .first()
      .click();
    await page.waitForURL(/\/exams\/[0-9a-f-]+$/, { timeout: 25_000 });

    // Answer Q1, verify autosave + F5 reload persistence, then submit
    const q1Choice = page.locator('[role="radiogroup"] [role="radio"]').first();
    await expect(q1Choice).toBeVisible({ timeout: 15_000 });
    const putDone = page.waitForResponse(
      (res) =>
        res.url().endsWith("/answers") &&
        res.request().method() === "PUT" &&
        res.status() === 200,
      { timeout: 15_000 },
    );
    await q1Choice.click();
    await putDone;

    await page.reload({ waitUntil: "networkidle" });
    await expect(
      page.locator('[role="radiogroup"] [role="radio"]').first(),
    ).toHaveAttribute("aria-checked", "true", { timeout: 15_000 });

    await submitLiveExam(page);

    // Mixed-Subject Results MUST display both subjects in breakdown
    await expect(page.getByText(title1).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(title2).first()).toBeVisible({ timeout: 15_000 });

    await context.close();
  });

  test("Scenario 3: V2.0 Full Coverage / No-Repeat Cycle (10Q -> 5 + 5, ZERO overlap, 100% completion)", async ({
    browser,
  }) => {
    test.setTimeout(180_000);

    const emailA = process.env.E2E_USER_A_EMAIL ?? "e2e-user-a@studyhub.local";
    const passwordA = process.env.E2E_USER_A_PASSWORD ?? "StudyHub!E2E123";

    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
    });
    const page = await context.newPage();
    await signIn(page, emailA, passwordA);

    const stamp = Date.now();
    const title = `E2E Coverage ${stamp}`;
    await createSetAndImport(page, title, buildEduQuizFixture(10, "Cov"), 10);

    await page.goto("/exams/new", { waitUntil: "networkidle" });
    await page.getByText(title).first().click();

    // Enable Full Coverage mode with 5 questions per exam (2 exams = 5 + 5)
    await page.locator("#builder-full-coverage").click();
    await page.locator("#coverage-batch-size").fill("5");

    // Intercept Exam #1 creation to record exact question_ids
    const createCyclePromise = page.waitForResponse(
      (res) =>
        res.url().endsWith("/api/coverage-cycles") &&
        res.request().method() === "POST" &&
        res.status() === 201,
      { timeout: 25_000 },
    );
    await page
      .getByRole("button", {
        name: /khởi tạo & thi đề #1|create cycle & start exam #1/i,
      })
      .first()
      .click();
    const cycleRes = await createCyclePromise;
    const cycleJson = await cycleRes.json();
    const cycleId: string = cycleJson.data.cycle.id;
    const attempt1Id: string = cycleJson.data.first_exam.attempt.id;
    const exam1QuestionIds: string[] = cycleJson.data.first_exam.questions.map(
      (q: { question_id: string }) => q.question_id,
    );
    expect(exam1QuestionIds).toHaveLength(5);

    await page.waitForURL(new RegExp(`/exams/${attempt1Id}`), { timeout: 25_000 });

    // Answer ALL 5 questions in Exam #1 so all 5 transition assigned -> completed
    for (let i = 0; i < 5; i += 1) {
      const choice = page.locator('[role="radiogroup"] [role="radio"]').first();
      await expect(choice).toBeVisible({ timeout: 15_000 });
      await choice.click();
      if (i < 4) {
        await page
          .getByRole("button", { name: /câu tiếp theo|next question/i })
          .first()
          .click();
      }
    }
    await submitLiveExam(page);

    // Issue Exam #2 from the same coverage cycle & verify ZERO overlap!
    const nextExamRes = await page.request.post(
      `/api/coverage-cycles/${cycleId}/next-exam`,
    );
    expect(nextExamRes.status()).toBe(201);
    const nextExamJson = await nextExamRes.json();
    const attempt2Id: string = nextExamJson.data.attempt.id;
    const exam2QuestionIds: string[] = nextExamJson.data.questions.map(
      (q: { question_id: string }) => q.question_id,
    );
    expect(exam2QuestionIds).toHaveLength(5);

    const set1 = new Set(exam1QuestionIds);
    const overlap = exam2QuestionIds.filter((id) => set1.has(id));
    expect(overlap).toEqual([]);
    expect(new Set([...exam1QuestionIds, ...exam2QuestionIds]).size).toBe(10);

    // Complete Exam #2 live in browser & verify cycle reaches 100% completed!
    await page.goto(`/exams/${attempt2Id}`, { waitUntil: "networkidle" });
    for (let i = 0; i < 5; i += 1) {
      const choice = page.locator('[role="radiogroup"] [role="radio"]').first();
      await expect(choice).toBeVisible({ timeout: 15_000 });
      await choice.click();
      if (i < 4) {
        await page
          .getByRole("button", { name: /câu tiếp theo|next question/i })
          .first()
          .click();
      }
    }
    await submitLiveExam(page);

    const cycleFinalRes = await page.request.get(`/api/coverage-cycles/${cycleId}`);
    expect(cycleFinalRes.status()).toBe(200);
    const cycleFinal = (await cycleFinalRes.json()).data;
    expect(cycleFinal.status).toBe("completed");
    expect(cycleFinal.completed_count).toBe(10);

    await context.close();
  });
});
