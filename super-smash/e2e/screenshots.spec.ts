import { test } from "@playwright/test";
import { ROUTES, startFromTitle, waitForMatch } from "./helpers";

/**
 * The README images, captured from the running game.
 *
 * Not part of the suite — gated behind `CAPTURE=1` so an ordinary `npm run
 * test:e2e` never writes a file. This is documentation tooling that happens to
 * be written in Playwright, and it is written in Playwright for one reason: the
 * images in the README are then provably of the thing that actually runs, and
 * regenerating them after a visual change is one command rather than an
 * afternoon.
 *
 *   CAPTURE=1 npx playwright test screenshots --project=desktop-chrome
 */

const CAPTURE = process.env.CAPTURE === "1";

test.describe.configure({ mode: "serial" });

test.skip(!CAPTURE, "Screenshot capture only runs with CAPTURE=1");

const shot = (name: string) => `docs/screenshots/${name}.png`;

test("title", async ({ page }) => {
  await page.goto(ROUTES.title);
  await page.getByLabel("Press any button to continue").waitFor();
  // The prompt pulses; capturing mid-fade photographs a half-transparent word.
  await page.waitForTimeout(700);
  await page.screenshot({ path: shot("title") });
});

test("main menu", async ({ page }) => {
  await startFromTitle(page);
  await page.waitForTimeout(600);
  await page.screenshot({ path: shot("main-menu") });
});

test("rules", async ({ page }) => {
  await startFromTitle(page);
  await page.getByRole("button", { name: /smash/i }).first().click();
  await page.waitForURL(`**${ROUTES.rules}`);
  await page.waitForTimeout(500);
  await page.screenshot({ path: shot("rules") });
});

test("stage select", async ({ page }) => {
  await startFromTitle(page);
  await page.getByRole("button", { name: /smash/i }).first().click();
  await page.waitForURL(`**${ROUTES.rules}`);
  await page.getByRole("button", { name: /next|stage|continue/i }).first().click();
  await page.waitForURL(`**${ROUTES.stage}`);
  await page.getByLabel("Stages").getByRole("button").first().hover();
  await page.waitForTimeout(500);
  await page.screenshot({ path: shot("stage-select") });
});

test("character select", async ({ page }) => {
  await startFromTitle(page);
  await page.getByRole("button", { name: /smash/i }).first().click();
  await page.waitForURL(`**${ROUTES.rules}`);
  await page.getByRole("button", { name: /next|stage|continue/i }).first().click();
  await page.waitForURL(`**${ROUTES.stage}`);
  await page.getByLabel("Stages").getByRole("button").first().click();
  await page.getByRole("button", { name: /next|fighters|continue/i }).first().click();
  await page.waitForURL(`**${ROUTES.fighters}`);

  // With one port filled and a portrait hovered, the screen shows everything at
  // once: the grid, a locked panel, and the splash art for the hovered fighter.
  const roster = page.getByLabel("Fighters").getByRole("button");
  await roster.nth(0).click();
  await roster.nth(6).hover();
  await page.waitForTimeout(600);
  await page.screenshot({ path: shot("character-select") });
});

test("the match, and the HUD", async ({ page }) => {
  await startFromTitle(page);
  await page.getByRole("button", { name: /smash/i }).first().click();
  await page.getByRole("button", { name: /next|stage|continue/i }).first().click();
  await page.getByLabel("Stages").getByRole("button").first().click();
  await page.getByRole("button", { name: /next|fighters|continue/i }).first().click();
  const roster = page.getByLabel("Fighters").getByRole("button");
  await roster.nth(0).click();
  await roster.nth(1).click();
  await page.getByRole("button", { name: /ready|fight/i }).first().click();
  await waitForMatch(page);

  // Let two CPUs fight for a few seconds so the shot has damage on the meters
  // and fighters mid-action, rather than four idle poses on the spawn points.
  await page.waitForTimeout(6000);
  await page.screenshot({ path: shot("match") });

  await page.waitForTimeout(6000);
  await page.screenshot({ path: shot("match-2") });
});

test("controls", async ({ page }) => {
  await page.goto(ROUTES.controls);
  await page.waitForTimeout(600);
  await page.screenshot({ path: shot("controls") });
});
