import type { Page } from "@playwright/test";

/**
 * Routes and interactions, re-declared rather than imported from `src/`.
 *
 * Copied from the sibling project `fake-phone`, and for its reason: an e2e
 * suite that imports the app's own constants cannot tell you the app still
 * works, only that it is self-consistent. Rename a route in `src/` and these
 * tests should go red — which they only do if the string lives here too.
 */
export const ROUTES = {
  title: "/",
  menu: "/menu",
  rules: "/rules",
  stage: "/stage",
  fighters: "/fighters",
  play: "/play",
  results: "/results",
  controls: "/controls",
} as const;

/** The keys Config 1 uses, so a test can drive a match the way a player would. */
export const P1 = {
  left: "ArrowLeft",
  right: "ArrowRight",
  up: "ArrowUp",
  down: "ArrowDown",
  special: "KeyA",
  attack: "KeyD",
  grab: "KeyQ",
  shield: "KeyE",
  jump: "KeyW",
} as const;

/**
 * The title screen swallows the first keypress to advance, so every test that
 * wants a later screen goes through here rather than deep-linking — the store
 * that carries the match configuration is client-side, and a cold load of
 * `/fighters` would find it empty.
 */
export async function startFromTitle(page: Page): Promise<void> {
  await page.goto(ROUTES.title);
  await page.getByLabel("Press any button to continue").waitFor();
  await page.keyboard.press("Enter");
  await page.waitForURL(`**${ROUTES.menu}`);
}

/** Hold a key for `frames` at 60Hz, which is how a real input is expressed. */
export async function holdFor(page: Page, code: string, frames: number): Promise<void> {
  await page.keyboard.down(code);
  await page.waitForTimeout((frames / 60) * 1000);
  await page.keyboard.up(code);
}

/**
 * One fighter as the simulation holds it, in floats.
 *
 * Read through `window.__smashDebug` rather than off the canvas: pixels can
 * only tell you something was painted, and the question these tests ask is
 * whether the *simulation* moved.
 */
export interface DebugFighter {
  port: number;
  x: number;
  y: number;
  action: string;
  actionFrame: number;
  damage: number;
  stocks: number;
  facing: number;
}

interface DebugHandle {
  frame: number;
  fighters(): DebugFighter[];
}

export async function readFighters(page: Page): Promise<DebugFighter[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __smashDebug?: DebugHandle };
    return w.__smashDebug?.fighters() ?? [];
  });
}

/**
 * Walk the real menu path into a running match: one human on port 0 and a CPU
 * on port 1, which is the default configuration and the one a player meets
 * first. Deliberately not a deep link — the match configuration lives in a
 * client-side store, so `/play` loaded cold has nothing to run.
 */
export async function startMatch(page: Page): Promise<void> {
  await startFromTitle(page);
  await page.getByRole("button", { name: /smash/i }).first().click();
  await page.waitForURL(`**${ROUTES.rules}`);
  await page.getByRole("button", { name: /next|stage|continue/i }).first().click();

  await page.waitForURL(`**${ROUTES.stage}`);
  await page.getByLabel("Stages").getByRole("button").first().click();
  await page.getByRole("button", { name: /next|fighters|continue/i }).first().click();

  await page.waitForURL(`**${ROUTES.fighters}`);
  const roster = page.getByLabel("Fighters").getByRole("button");
  await roster.nth(0).click();
  await roster.nth(1).click();

  await page.getByRole("button", { name: /ready|fight/i }).first().click();
  await page.waitForURL(`**${ROUTES.play}`);
  await waitForMatch(page);
}

/** Wait until the match canvas has actually started painting. */
export async function waitForMatch(page: Page): Promise<void> {
  await page.getByLabel("Match").waitFor();
  // One second of real time is sixty simulation frames — comfortably past the
  // entry animation, so a screenshot taken after this shows fighters on stage
  // rather than mid-spawn.
  await page.waitForTimeout(1200);
}
