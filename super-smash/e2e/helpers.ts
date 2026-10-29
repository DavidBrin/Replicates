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
 * The title screen, once it is listening. Its prompt is in the server HTML,
 * but the key listener only exists after hydration, and a press before then
 * is lost; the button says `data-ready="true"` exactly while it listens.
 */
export async function titleReady(page: Page): Promise<void> {
  await page.locator('[aria-label="Press any button to continue"][data-ready="true"]').waitFor();
}

/**
 * The title screen swallows the first keypress to advance, so every test that
 * wants a later screen goes through here rather than deep-linking — the store
 * that carries the match configuration is client-side, and a cold load of
 * `/fighters` would find it empty.
 */
export async function startFromTitle(page: Page): Promise<void> {
  await page.goto(ROUTES.title);
  await titleReady(page);
  await page.keyboard.press("Enter");
  await page.waitForURL(`**${ROUTES.menu}`);
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
  move: string | null;
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

/** The simulation frame the match is on (0 before one is running). */
export async function simFrame(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __smashDebug?: DebugHandle }).__smashDebug?.frame ?? 0);
}

/**
 * Stop the match's own clock, so the simulation runs only when a test steps it
 * (`stepFrames`). Keys are still pressed the way a player presses them, through
 * the page's real listeners; what the test takes over is *when* a frame runs,
 * which a wall-clock wait cannot promise. A loaded machine stretches
 * `waitForTimeout(150)` into fewer simulated frames than 150ms holds, and a
 * key let go late lands on a different frame each run, so a CPU that answers
 * what it sees fights a different fight each run. (`scripts/fightsheet.mjs`
 * hand-cranks a match the same way, D46.)
 *
 * Idempotent. `startMatch(page, { stepped: true })` calls it; a test only
 * calls it for a match it started some other way, before any `stepFrames`: a
 * clock left running would add its own frames to every step.
 */
export async function pauseMatch(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { __smashDebug: { pause(): void } }).__smashDebug.pause());
}

/** Run exactly `frames` simulation frames, with whatever keys are held, and no others. Needs `pauseMatch`. */
export async function stepFrames(page: Page, frames: number): Promise<void> {
  await page.evaluate((n) => (window as unknown as { __smashDebug: { step(n: number): void } }).__smashDebug.step(n), frames);
}

/**
 * Run the paused match up to simulation frame `target`, with no key held.
 *
 * A match's state at a given frame depends only on the inputs before it, and a
 * test that has pressed nothing has given none, so the match stands in the same
 * state whichever frame `pauseMatch` happened to stop on. A test that wants the
 * same fight every run starts its inputs from here. A match already past
 * `target` is left where it is.
 */
export async function stepToFrame(page: Page, target: number): Promise<void> {
  const frame = await simFrame(page);
  if (frame < target) await stepFrames(page, target - frame);
}

/**
 * Hold a key for exactly `frames` simulation frames: pressed before the first,
 * released after the last. Needs `pauseMatch`. The key goes down and up through
 * the page's real key listeners, and a press arrives as both a held key and a
 * fresh press on its first frame, as it does for a player.
 */
export async function holdForFrames(page: Page, code: string, frames: number): Promise<void> {
  await page.keyboard.down(code);
  await stepFrames(page, frames);
  await page.keyboard.up(code);
}

/**
 * How a test gets its match.
 *
 * By default the match runs on its own clock, and the test reads it whenever it
 * likes: right for a test that only needs *a* match on screen. A test whose
 * inputs have to land on particular frames asks for `stepped` instead: the
 * clock stops as the match mounts, the fighters walk on (`READY_FRAME`), and
 * the match stays still until the test cranks it (`stepFrames`).
 */
export interface MatchOptions {
  readonly stepped?: boolean;
}

/**
 * The frame a stepped match stands on when `startMatch` hands it over: past the
 * entry (`ENTRY_FRAMES`, 12) and where a match on its own clock was about to be
 * read, a second after the page came up. The same frame every run.
 */
export const READY_FRAME = 72;

/**
 * Walk the real menu path into a running match: one human on port 0 and a CPU
 * on port 1, which is the default configuration and the one a player meets
 * first. Deliberately not a deep link — the match configuration lives in a
 * client-side store, so `/play` loaded cold has nothing to run.
 */
export async function startMatch(page: Page, options: MatchOptions = {}): Promise<void> {
  await startFromTitle(page);
  await startMatchFromMenu(page, options);
}

/**
 * The menu-to-match half on its own.
 *
 * Split out for the tests that have to *do* something on the way — change a
 * binding, say — and cannot afford a fresh `page.goto`, since the match
 * configuration lives in a client-side store that a reload would wipe.
 */
export async function startMatchFromMenu(page: Page, options: MatchOptions = {}): Promise<void> {
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
  if (options.stepped) {
    // As soon as the match exists, so the frames it ran before the clock
    // stopped are few (the match only moves on its own clock until this
    // returns). The rest it does with no key held, so wherever it stopped, it
    // stands in the same state once `READY_FRAME` is reached.
    await page.waitForFunction(() => Boolean((window as unknown as { __smashDebug?: unknown }).__smashDebug));
    await pauseMatch(page);
    await stepToFrame(page, READY_FRAME);
  } else {
    await waitForMatch(page);
  }
}

/** Wait until the match canvas has actually started painting. */
export async function waitForMatch(page: Page): Promise<void> {
  await page.getByLabel("Match").waitFor();
  // One second of real time is sixty simulation frames — comfortably past the
  // entry animation, so a screenshot taken after this shows fighters on stage
  // rather than mid-spawn.
  await page.waitForTimeout(1200);
}
