import { test, type Page } from "@playwright/test";
import { ROUTES, readFighters, startFromTitle, waitForMatch } from "./helpers";

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

/**
 * Never a picture of a Nintendo model (Plan 4, Task 23). The repo is public, a
 * render of the real SSBU models is a derivative of ripped assets, and a
 * takedown over one would take the whole repo down. So every capture runs with
 * the models taken away — every request under `/models/` answered 404, the way
 * a host without them answers — and the fighters draw as the project's own
 * capsule stand-ins. Everything else in a frame (the stage, the HUD, the sky)
 * is our own art.
 */
const isModelRequest = (url: URL): boolean => url.pathname.startsWith("/models/");

test.beforeEach(async ({ page }) => {
  await page.route(isModelRequest, (route) =>
    route.fulfill({ status: 404, contentType: "text/html", body: "<!doctype html><title>404</title>" }),
  );
});

/** What the 3D layer says it drew each fighter with (`window.__smashRender.info().fighters`), re-declared like the routes. */
type FighterKind = "glb" | "standIn" | "loading";

/**
 * Refuse to write a match screenshot unless the page reports a stand-in for
 * every fighter. A model that reached the page anyway — a route that stopped
 * matching, a fighter still loading — stops the capture rather than shipping.
 */
async function refuseUnlessStandIns(page: Page): Promise<void> {
  const kinds = await page.evaluate(
    () =>
      (window as unknown as { __smashRender?: { info(): { fighters: FighterKind[] } } }).__smashRender?.info().fighters ?? null,
  );
  if (kinds === null || kinds.length === 0 || kinds.some((k) => k !== "standIn")) {
    throw new Error(`refusing to capture a match: every fighter must be a stand-in, and the page reports ${JSON.stringify(kinds)}`);
  }
}

/**
 * Wait for a frame worth photographing.
 *
 * "Six seconds in" is a coin flip: one fighter is often mid-launch and out of
 * frame, which makes the README's hero image a picture of an empty stage. So
 * the shot waits for a moment when both are alive and close enough to be in
 * shot together, and gives up rather than hanging if the match never obliges.
 */
async function waitForBothOnStage(page: Page, timeoutMs = 8000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const fighters = await readFighters(page);
    const framed =
      fighters.length > 1 &&
      fighters.every((f) => f.action !== "dead" && Math.abs(f.y) < 45) &&
      Math.abs(fighters[0].x - fighters[1].x) < 34;
    if (framed) return;
    await page.waitForTimeout(120);
  }
}

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
  await waitForBothOnStage(page);
  await refuseUnlessStandIns(page);
  await page.screenshot({ path: shot("match") });

  await page.waitForTimeout(6000);
  await waitForBothOnStage(page);
  await refuseUnlessStandIns(page);
  await page.screenshot({ path: shot("match-2") });
});

test("controls", async ({ page }) => {
  await page.goto(ROUTES.controls);
  await page.waitForTimeout(600);
  await page.screenshot({ path: shot("controls") });
});
