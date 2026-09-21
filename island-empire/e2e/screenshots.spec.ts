import { expect, test } from "@playwright/test";

import { ROUTES, SEL, dismissTutorial, myUnits, readState, startLevel, tapTile } from "./helpers";

/**
 * The README images, captured from the running game.
 *
 * Not part of the suite — gated behind `CAPTURE=1` so an ordinary
 * `pnpm run test:e2e` never writes a file. Written in Playwright so the
 * images in the README are provably of the thing that actually runs, and
 * regenerating them after a visual change is one command:
 *
 *   CAPTURE=1 npx playwright test screenshots --project=desktop-chrome
 *   CAPTURE=1 npx playwright test screenshots --project=mobile-chrome
 */

const CAPTURE = process.env.CAPTURE === "1";

test.describe.configure({ mode: "serial" });

test.skip(!CAPTURE, "Screenshot capture only runs with CAPTURE=1");

const shot = (name: string, project: string) =>
  `docs/screenshots/${name}${project === "mobile-chrome" ? "-mobile" : ""}.png`;

test("title", async ({ page }, info) => {
  await page.goto(ROUTES.title);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: shot("title", info.project.name) });
});

test("campaign overworld", async ({ page }, info) => {
  await page.goto(ROUTES.campaign);
  await page.locator('[data-testid="overworld"]').waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: shot("overworld", info.project.name) });
});

test("level intro", async ({ page }, info) => {
  await page.goto("/campaign/07/intro");
  await page.locator('[data-testid="start-level"]').waitFor();
  await page.screenshot({ path: shot("level-intro", info.project.name) });
});

test("in-game with a unit selected", async ({ page }, info) => {
  // Level 07 (Mountain Pass) shows walls, a stone tower, forests and
  // mountains together; a selected knight lights its move zone and shields.
  await startLevel(page, "07", "normal");
  await dismissTutorial(page);
  const s = await readState(page);
  const knight = myUnits(s, 0)[0];
  expect(knight).toBeDefined();
  await tapTile(page, { x: knight!.x, y: knight!.y });
  await expect(page.locator(SEL.infoCard)).toBeVisible();
  await dismissTutorial(page);
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot("match", info.project.name) });
});

test("strength chart", async ({ page }, info) => {
  await startLevel(page, "03", "easy");
  await page.locator(SEL.help).click();
  await expect(page.locator(SEL.helpModal)).toBeVisible();
  await page.screenshot({ path: shot("strength-chart", info.project.name) });
});

test("map editor", async ({ page }, info) => {
  await page.goto("/editor");
  await page.locator('[data-testid="editor"]').waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot("editor", info.project.name) });
});

test("weekly challenges", async ({ page }, info) => {
  await page.goto("/challenges");
  await page.locator('[data-testid="medal-dots"]').first().waitFor({ timeout: 15_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: shot("challenges", info.project.name) });
});

test("random map setup", async ({ page }, info) => {
  await page.goto("/random");
  await page.locator('[data-testid="play"]').waitFor();
  await page.waitForTimeout(800);
  await page.screenshot({ path: shot("random-setup", info.project.name) });
});
