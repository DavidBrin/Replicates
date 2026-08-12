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

/** Wait until the match canvas has actually started painting. */
export async function waitForMatch(page: Page): Promise<void> {
  await page.getByLabel("Match").waitFor();
  // One second of real time is sixty simulation frames — comfortably past the
  // entry animation, so a screenshot taken after this shows fighters on stage
  // rather than mid-spawn.
  await page.waitForTimeout(1200);
}
