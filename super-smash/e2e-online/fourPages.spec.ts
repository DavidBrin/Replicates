import { loadavg } from "node:os";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { frame, startMatch, withoutModels } from "../e2e/helpers";

/**
 * The precondition for every four-player e2e (Plan 7, Phase B): can this machine
 * carry four match pages at once?
 *
 * A four-player online test opens four WebGL pages, each running its own match
 * frame loop, on one machine. If the pages cannot each hold a playable frame
 * rate together, that test would fail for the machine and not for the code, so
 * this spike proves the machine first. It is a local match per page, with no
 * room and no network: the cost it measures is the four renderers and four
 * frame loops, which is what a four-browser online test adds to a two-browser
 * one.
 *
 * The bar is 30 frames a second held for 20 seconds: 600 frames on every page.
 * A match on its own clock runs at 60, and a relayed one still does (the relay
 * carries 30 messages a second, with two frames' packets in each), so 30 is the
 * floor below which a match is no longer playable, not a rate the relay sets.
 * The counter is the simulation's own, which catches up at most five frames per
 * animation frame (`MAX_CATCHUP_FRAMES`): this proves the simulation keeps its
 * pace on all four pages, not that each paints 30 times a second.
 *
 * Whether a run counts depends on the machine's load (a run counts at a 1-minute
 * load of 6 or under), so the load goes on the line that logs the deltas.
 */
const WINDOW_MS = 20_000;
const MIN_FRAMES = 600;
const PAGES = 4;

/** Every context a test opened, closed after it so a failed test leaves no match running. */
const contexts: BrowserContext[] = [];

/** How each fighter on the page is drawn (`__smashRender`): "standIn", "glb" or "loading". Empty before a match draws. */
async function drawnFighters(page: Page): Promise<string[]> {
  return page.evaluate(
    () => (window as unknown as { __smashRender?: { info(): { fighters: string[] } } }).__smashRender?.info().fighters ?? [],
  );
}

test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.close()));
});

test("four pages each run a local match at 30 frames a second or better, all at once", async ({ browser }) => {
  const pages: Page[] = [];
  for (let i = 0; i < PAGES; i++) {
    const context = await browser.newContext();
    contexts.push(context);
    await withoutModels(context);
    pages.push(await context.newPage());
  }

  // One after another, each through the real menu path; the earlier pages run
  // their matches while the later ones start, so all four are live at the end.
  for (const page of pages) await startMatch(page);
  // Stand-ins on every page: the route is what keeps a real model out of a
  // retained trace, so a route that did nothing must fail here, naming the page.
  for (const [i, page] of pages.entries()) {
    await expect
      .poll(() => drawnFighters(page), { message: `page ${i + 1} draws stand-ins`, timeout: 10_000 })
      .toEqual(["standIn", "standIn"]);
  }

  const loadAtStart = loadavg()[0];
  const starts = await Promise.all(pages.map(frame));
  const deadline = Date.now() + WINDOW_MS;
  // Against a deadline and not a sleep: the poll ends the first time it looks after it, never early.
  await expect.poll(() => Date.now() >= deadline, { timeout: WINDOW_MS + 10_000, intervals: [250] }).toBe(true);
  const ends = await Promise.all(pages.map(frame));

  // A page whose match is gone reads -1 (it ended, or the page left /play). Said
  // by page, so it is not read as that page falling short of the frame bar.
  for (const [i, start] of starts.entries()) {
    expect(start, `page ${i + 1} had no match running when the window opened`).toBeGreaterThanOrEqual(0);
    expect(ends[i], `page ${i + 1}'s match was gone when the window closed (it ended, or the page left /play)`).toBeGreaterThanOrEqual(0);
  }

  const deltas = ends.map((end, i) => end - starts[i]);
  console.log(
    `four pages, frames advanced in ${WINDOW_MS / 1000} s: ${deltas.join(", ")} (bar ${MIN_FRAMES}), 1-minute load ${loadAtStart.toFixed(1)} to ${loadavg()[0].toFixed(1)}`,
  );
  for (const [i, delta] of deltas.entries()) expect(delta, `page ${i + 1}`).toBeGreaterThanOrEqual(MIN_FRAMES);
});
