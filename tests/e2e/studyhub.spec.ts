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

test.describe("StudyHub Public Routes, Security Headers, Theme & i18n", () => {
  test("HTTP security headers are present on landing page", async ({ request }) => {
    const res = await request.get("/");
    expect(res.status()).toBe(200);

    const headers = res.headers();
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toContain("camera=()");
    expect(headers["content-security-policy"]).toBeTruthy();
    expect(headers["content-security-policy"]).toContain("object-src 'none'");
    expect(headers["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(headers["x-powered-by"]).toBeUndefined();
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

  test("public & auth pages render cleanly with zero uncaught errors", async ({ page }) => {
    const pageErrors: string[] = [];
    const severeConsoleErrors: string[] = [];

    page.on("pageerror", (err) => pageErrors.push(err.message));
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        const txt = msg.text();
        // Ignore expected 503 network logs if any unconfigured backend check runs
        if (!txt.includes("503")) {
          severeConsoleErrors.push(txt);
        }
      }
    });

    for (const route of ["/", "/login", "/register", "/forgot-password", "/reset-password"]) {
      const response = await page.goto(route, { waitUntil: "networkidle" });
      expect(response?.status(), `Route ${route} failed`).toBe(200);
      await expect(page.locator("main")).toBeVisible();
    }

    expect(pageErrors, `Uncaught page errors: ${pageErrors.join("; ")}`).toEqual([]);
    expect(
      severeConsoleErrors,
      `Severe console errors: ${severeConsoleErrors.join("; ")}`,
    ).toEqual([]);
  });

  test("Light/Dark theme toggle and VI/EN language toggle work cleanly on landing page", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/", { waitUntil: "networkidle" });

    // Default Vietnamese UI
    await expect(page.locator("h1")).toContainText("Tự học");

    // Capture Desktop 1440px Light screenshot if requested
    if (SCREENSHOT_DIR) {
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "landing-desktop-1440-light.png"),
        fullPage: false,
      });
    }

    // Switch language VI -> EN
    const langBtn = page.getByRole("button", {
      name: /Chuyển ngôn ngữ giao diện sang tiếng Anh/i,
    });
    await langBtn.click();
    await expect(page.locator("h1")).toContainText("Study flashcards");

    // Toggle back EN -> VI
    await page
      .getByRole("button", { name: /Switch interface language to Vietnamese/i })
      .click();
    await expect(page.locator("h1")).toContainText("Tự học");

    // Switch Theme -> Dark
    const themeBtn = page.getByRole("button", { name: /Đổi giao diện sáng tối/i });
    await themeBtn.click();
    await page.getByRole("menuitem", { name: /Tối|Dark/i }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);

    // Capture Desktop 1440px Dark screenshot if requested
    if (SCREENSHOT_DIR) {
      await page.waitForTimeout(200);
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "landing-desktop-1440-dark.png"),
        fullPage: false,
      });
    }

    // Switch Theme -> Light
    await themeBtn.click();
    await page.getByRole("menuitem", { name: /Sáng|Light/i }).click();
    await expect(page.locator("html")).not.toHaveClass(/dark/);

    // Capture Login page 1440px Light screenshot if requested
    if (SCREENSHOT_DIR) {
      await page.goto("/login", { waitUntil: "networkidle" });
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, "login-desktop-1440-light.png"),
        fullPage: false,
      });
    }
  });

  test("protected routes enforce auth or show honest unconfigured notice (never fake login)", async ({
    page,
  }) => {
    const healthRes = await page.request.get("/api/health");
    const health = await healthRes.json();
    const supabaseConfigured: boolean = Boolean(health?.data?.supabaseConfigured);

    for (const route of ["/dashboard", "/library", "/review", "/statistics", "/settings"]) {
      await page.goto(route, { waitUntil: "networkidle" });

      if (supabaseConfigured) {
        expect(page.url()).toContain("/login");
      } else {
        // Honest unconfigured Supabase banner must be shown; never a fake authenticated profile
        await expect(page.locator('[role="status"]').first()).toContainText(/Supabase/i);
      }
    }
  });
});

test.describe("Responsive Layout & Accessibility Audit (6 Viewports)", () => {
  for (const vp of VIEWPORTS) {
    test(`viewport ${vp.name} (${vp.width}x${vp.height}) has zero horizontal overflow and accessible focus`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });

      for (const route of ["/", "/login"]) {
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

      // Capture mobile 390px Light screenshot if requested
      if (SCREENSHOT_DIR && vp.name === "mobile-390") {
        // Blur skip link before screenshot so viewport looks natural
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
        await page.screenshot({
          path: path.join(SCREENSHOT_DIR, "landing-mobile-390-light.png"),
          fullPage: false,
        });
      }
    });
  }
});
