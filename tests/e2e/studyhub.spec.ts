import path from "node:path";
import { expect, test } from "@playwright/test";

const SCREENSHOT_DIR = process.env.QA_SCREENSHOT_DIR ?? "";

const VIEWPORTS = [
  { name: "small-mobile-360", width: 360, height: 800 },
  { name: "mobile-390", width: 390, height: 844 },
  { name: "tablet-portrait-768", width: 768, height: 1024 },
  { name: "laptop-1024", width: 1024, height: 768 },
  { name: "desktop-1440", width: 1440, height: 900 },
  { name: "desktop-1920", width: 1920, height: 1080 },
] as const;

test.describe("StudyHub V2.0 Public Routes, Security Headers, Theme & i18n", () => {
  test("HTTP security headers & production CSP hygiene are enforced on landing page", async ({
    request,
  }) => {
    const res = await request.get("/");
    expect(res.status()).toBe(200);

    const headers = res.headers();
    const csp = headers["content-security-policy"] ?? "";
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toContain("camera=()");
    expect(csp).toBeTruthy();
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(headers["x-powered-by"]).toBeUndefined();

    // Production builds (`next start`) must emit HSTS and must NOT allow localhost/unsafe-eval in CSP (SH-043)
    if (process.env.PLAYWRIGHT_EXPECT_PROD === "1") {
      expect(headers["strict-transport-security"]).toContain("max-age=");
      expect(csp).not.toContain("http://127.0.0.1");
      expect(csp).not.toContain("http://localhost");
      expect(csp).not.toContain("'unsafe-eval'");
    }
  });

  test("API health and EduQuiz import template endpoints work deterministically", async ({
    request,
  }) => {
    const healthRes = await request.get("/api/health");
    expect(healthRes.status()).toBe(200);
    const healthJson = await healthRes.json();
    expect(healthJson.data.status).toBe("ok");
    expect(typeof healthJson.data.supabaseConfigured).toBe("boolean");

    const tplRes = await request.get("/api/import/templates/eduquiz_txt");
    expect(tplRes.status()).toBe(200);
    expect(tplRes.headers()["x-content-type-options"]).toBe("nosniff");
    expect(tplRes.headers()["content-disposition"]).toContain("attachment");
    const tplText = await tplRes.text();
    expect(tplText.length).toBeGreaterThan(30);
    expect(tplText).toContain("*B.");

    const badTplRes = await request.get("/api/import/templates/invalid_ext");
    expect(badTplRes.status()).toBe(400);
  });

  test("public & auth pages render cleanly with semantic <h1> and zero uncaught errors", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    const severeConsoleErrors: string[] = [];

    page.on("pageerror", (err) => pageErrors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        const txt = msg.text();
        if (!txt.includes("503")) {
          severeConsoleErrors.push(txt);
        }
      }
    });

    for (const route of [
      "/",
      "/login",
      "/register",
      "/forgot-password",
      "/reset-password",
    ]) {
      const response = await page.goto(route, { waitUntil: "networkidle" });
      expect(response?.status(), `Route ${route} failed`).toBe(200);
      await expect(page.locator("main")).toBeVisible();
      await expect(
        page.locator("h1").first(),
        `Missing <h1> on ${route}`,
      ).toBeVisible();
    }

    // Login callback error query parameter must surface a friendly error alert (SH-037 / BUG-022)
    await page.goto("/login?error=auth_callback_failed", {
      waitUntil: "networkidle",
    });
    await expect(page.locator('[role="alert"]').first()).toBeVisible();

    expect(pageErrors, `Uncaught page errors: ${pageErrors.join("; ")}`).toEqual([]);
    expect(
      severeConsoleErrors,
      `Severe console errors: ${severeConsoleErrors.join("; ")}`,
    ).toEqual([]);
  });

  test("custom 404 page renders localized StudyHub NotFoundView instead of raw Next.js 404", async ({
    page,
  }) => {
    const res = await page.goto("/nonexistent-v2-route-check", {
      waitUntil: "networkidle",
    });
    expect(res?.status()).toBe(404);
    await expect(page.locator("main")).toBeVisible();
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.getByText("404")).toBeVisible();
    await expect(page.getByRole("link", { name: /trang chủ|home/i })).toBeVisible();
  });

  test("Light/Dark theme toggle, VI/EN language toggle, <title>, and skip link localization work cleanly", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/", { waitUntil: "networkidle" });

    // Default Vietnamese UI
    await expect(page.locator("h1")).toContainText("Tự học");
    const skipLink = page.locator('a.skip-to-content[href="#main-content"]');
    await expect(skipLink).toContainText(/chuyển đến nội dung chính/i);

    if (SCREENSHOT_DIR) {
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "landing-desktop-1440-light.png"),
        fullPage: false,
      });
    }

    // Switch language VI -> EN and verify skip link & reload <title> persistence (#72)
    const langBtn = page.getByRole("button", {
      name: /Chuyển ngôn ngữ giao diện sang tiếng Anh/i,
    });
    await langBtn.click();
    await expect(page.locator("h1")).toContainText("Study flashcards");
    await expect(skipLink).toContainText(/skip to/i);
    await expect(page).toHaveTitle(/Personal Self-Study/i);
    await page.reload({ waitUntil: "networkidle" });
    await expect(page).toHaveTitle(/Personal Self-Study/i);

    // Toggle back EN -> VI
    await page
      .getByRole("button", { name: /Switch interface language to Vietnamese/i })
      .click();
    await expect(page.locator("h1")).toContainText("Tự học");

    // Switch Theme -> Dark (uses WCAG role="menuitemradio")
    const themeBtn = page.getByRole("button", { name: /Đổi giao diện sáng tối/i });
    await themeBtn.click();
    await page.getByRole("menuitemradio", { name: /Tối|Dark/i }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);

    if (SCREENSHOT_DIR) {
      await page.waitForTimeout(200);
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "landing-desktop-1440-dark.png"),
        fullPage: false,
      });
    }

    // Switch Theme -> Light
    await themeBtn.click();
    await page.getByRole("menuitemradio", { name: /Sáng|Light/i }).click();
    await expect(page.locator("html")).not.toHaveClass(/dark/);
  });

  test("protected V1 & V2 routes redirect cleanly to /login without 503 storms or raw env-var leaks (SH-026)", async ({
    page,
  }) => {
    const failed503Urls: string[] = [];
    page.on("response", (res) => {
      if (res.status() === 503) {
        failed503Urls.push(res.url());
      }
    });

    const protectedRoutes = [
      "/dashboard",
      "/library",
      "/exams",
      "/exams/new",
      "/practice",
      "/folders",
      "/import",
      "/review",
      "/statistics",
      "/settings",
    ];

    for (const route of protectedRoutes) {
      await page.goto(route, { waitUntil: "networkidle" });
      expect(page.url(), `Protected route ${route} must redirect to /login`).toContain(
        "/login",
      );
      const bodyText = await page.locator("body").innerText();
      expect(bodyText).not.toContain("NEXT_PUBLIC_SUPABASE_URL");
      expect(bodyText).not.toContain(".env.local");
    }

    expect(
      failed503Urls,
      `Unexpected 503 storm during protected redirects: ${failed503Urls.join(", ")}`,
    ).toEqual([]);
  });

  test("prefers-reduced-motion renders cleanly without hiding or breaking interactive content", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/", { waitUntil: "networkidle" });
    await expect(page.locator("h1")).toBeVisible();
    await expect(
      page.getByRole("link", { name: /đăng ký|sign up|tạo tài khoản/i }).first(),
    ).toBeVisible();
  });
});

test.describe("Responsive Layout & Accessibility Audit (6 Viewports)", () => {
  for (const vp of VIEWPORTS) {
    test(`viewport ${vp.name} (${vp.width}x${vp.height}) has zero horizontal overflow and accessible focus`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });

      for (const route of ["/", "/login", "/register"]) {
        await page.goto(route, { waitUntil: "networkidle" });

        const metrics = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          innerWidth: window.innerWidth,
        }));

        expect(
          metrics.scrollWidth,
          `Horizontal overflow on ${route} at ${vp.name}: scrollWidth=${metrics.scrollWidth} > innerWidth=${metrics.innerWidth}`,
        ).toBeLessThanOrEqual(metrics.innerWidth);
      }

      // Verify skip-to-content link & keyboard focus on landing page
      await page.goto("/", { waitUntil: "networkidle" });
      const skipLink = page.locator('a.skip-to-content[href="#main-content"]');
      await expect(skipLink).toHaveCount(1);
      await page.keyboard.press("Tab");
      await expect(skipLink).toBeFocused();

      if (SCREENSHOT_DIR && vp.name === "mobile-390") {
        await page.evaluate(() =>
          (document.activeElement as HTMLElement | null)?.blur(),
        );
        await page.screenshot({
          path: path.join(SCREENSHOT_DIR, "landing-mobile-390-light.png"),
          fullPage: false,
        });
      }
    });
  }
});
