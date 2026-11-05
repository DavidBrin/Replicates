import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { startMatch } from "../e2e/helpers";

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
 * 30 frames a second is the rate the relay carries a match at, and the least a
 * match can run at and still be played, so the bar is 30 a second held for 20
 * seconds: 600 frames on every page. A match on its own clock runs at 60.
 */
const WINDOW_MS = 20_000;
const MIN_FRAMES = 600;
const PAGES = 4;

/** Every context a test opened, closed after it so a failed test leaves no match running. */
const contexts: BrowserContext[] = [];

/** The match's own frame counter, or -1 while there is no match to read. */
async function frame(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __smashDebug?: { frame: number } }).__smashDebug?.frame ?? -1);
}

test.afterEach(async () => {
  await Promise.all(contexts.splice(0).map((context) => context.close()));
});

test("four pages each run a local match at 30 frames a second or better, all at once", async ({ browser }) => {
  const pages: Page[] = [];
  for (let i = 0; i < PAGES; i++) {
    const context = await browser.newContext();
    contexts.push(context);
    const page = await context.newPage();
    // Stand-ins: a public repo's run never draws a real model, and every page
    // costs the same whether or not this checkout has the models built.
    await page.route("**/models/**", (route) =>
      route.fulfill({ status: 404, contentType: "text/html", body: "<!doctype html><title>404</title>" }),
    );
    pages.push(page);
  }

  // One after another, each through the real menu path; the earlier pages run
  // their matches while the later ones start, so all four are live at the end.
  for (const page of pages) await startMatch(page);

  const starts = await Promise.all(pages.map(frame));
  const deadline = Date.now() + WINDOW_MS;
  // Against a deadline and not a sleep: the poll ends the first time it looks after it, never early.
  await expect.poll(() => Date.now() >= deadline, { timeout: WINDOW_MS + 10_000, intervals: [250] }).toBe(true);
  const ends = await Promise.all(pages.map(frame));

  const deltas = ends.map((end, i) => end - starts[i]);
  console.log(`four pages, frames advanced in ${WINDOW_MS / 1000} s: ${deltas.join(", ")} (bar ${MIN_FRAMES})`);
  for (const delta of deltas) expect(delta).toBeGreaterThanOrEqual(MIN_FRAMES);
});
