import { test, expect } from "@playwright/test";
import path from "node:path";

/**
 * Writes the fidelity-bar reference screenshots into `docs/screenshots/`
 * (SPEC.md's "dollar-pixels convention": gated on `CAPTURE` so a normal
 * `pnpm run test:e2e` never touches disk). Run explicitly with:
 *
 *   CAPTURE=1 pnpm exec playwright test screenshots
 */
const CAPTURE = !!process.env.CAPTURE;
const SCREENSHOT_DIR = path.join(__dirname, "..", "docs", "screenshots");

test.describe("reference screenshots", () => {
  test.skip(!CAPTURE, "set CAPTURE=1 to write docs/screenshots/*.png");

  test("home-1440.png", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("h1#firstHeading")).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "home-1440.png") });
  });

  test("article-linear-1440.png", async ({ page }) => {
    await page.goto("/wiki/Linear_(replica)");
    await expect(page.locator("h1#firstHeading")).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "article-linear-1440.png") });
  });

  test("article-youtube-scrolled-1440.png", async ({ page }) => {
    await page.goto("/wiki/YouTube_(replica)");
    const toc = page.getByRole("navigation", { name: "Contents" });
    await toc.getByRole("link", { name: "Architecture" }).click();
    await expect(page.locator("#vector-sticky-header")).toHaveAttribute("aria-hidden", "false");
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "article-youtube-scrolled-1440.png") });
  });

  test("search-suggestions-1440.png", async ({ page }) => {
    await page.goto("/");
    await page.locator('header input[type="search"]').fill("lin");
    await expect(page.locator("header").getByRole("listbox")).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "search-suggestions-1440.png") });
  });

  test("stub-page-1440.png", async ({ page }) => {
    await page.goto("/wiki/Website_not_yet_deployed");
    await expect(page.locator("#noarticletext")).toBeVisible();
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, "stub-page-1440.png") });
  });
});
