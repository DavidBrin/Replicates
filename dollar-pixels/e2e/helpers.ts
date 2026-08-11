import type { Page, Response } from "@playwright/test";

/**
 * Shared e2e plumbing.
 *
 * The constants below are re-declared rather than imported from `src/`. That is
 * deliberate, and copied from the sibling project `fake-phone`: a test that
 * imports the string it asserts on cannot fail when that string is renamed, so
 * it stops being a test of anything. Pinning them here means a rename in app
 * code turns red, which is the entire point.
 */

export const WALL = "/p/the-wall";

/** The seeded flagship grid is 400 x 400 blocks (DECISIONS D1). */
export const WALL_BLOCKS = 400;

export const COPY = {
  tagline: "$1 buys nine pixels",
  playMoney: /play money/i,
  signIn: /sign in/i,
  unlisted: /unlisted/i,
} as const;

/**
 * Sign in through the real UI rather than by posting to the session endpoint.
 *
 * Slower, and worth it: a suite that authenticates through a side door stops
 * noticing when the front door breaks.
 */
export async function signIn(page: Page, displayName: string): Promise<void> {
  const field = page.getByLabel(/display name/i);
  await field.waitFor({ state: "visible" });
  await field.fill(displayName);
  await page.getByRole("button", { name: /^sign in$/i }).click();
  await page.getByRole("button", { name: /sign out/i }).waitFor();
}

/** Wait for a page's grid snapshot to arrive, so the canvas has something in it. */
export async function waitForGrid(page: Page, slug: string): Promise<Response> {
  return page.waitForResponse(
    (res) => res.url().includes(`/api/pages/${slug}/grid`) && res.ok(),
  );
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Rect {
  bx: number;
  by: number;
  bw: number;
  bh: number;
}

/**
 * Find a rectangle of `w` x `h` blocks that nothing owns or holds.
 *
 * The wall is seeded with a few hundred claims at pseudo-random positions, so
 * hardcoded coordinates are a coin flip: a test that picks (380, 380) passes
 * until the seed happens to put a claim there, and then fails for a reason
 * that has nothing to do with what it is testing. Asking the API where the
 * gaps are makes the test deterministic without making it fictional.
 */
export async function findFreeRect(
  page: Page,
  slug: string,
  w: number,
  h: number,
): Promise<Rect> {
  const snapshot = await page.evaluate(async (s) => {
    const res = await fetch(`/api/pages/${s}/grid`);
    return (await res.json()) as {
      data: {
        wBlocks: number;
        hBlocks: number;
        claims: { rect: Rect }[];
        holds: { rect: Rect }[];
      };
    };
  }, slug);

  const { wBlocks, hBlocks, claims, holds } = snapshot.data;
  const taken = [...claims, ...holds].map((c) => c.rect);

  const overlaps = (a: Rect, b: Rect) =>
    a.bx < b.bx + b.bw && b.bx < a.bx + a.bw && a.by < b.by + b.bh && b.by < a.by + a.bh;

  // Scan from the bottom-right, which the seed leaves emptier, and step by the
  // rectangle size so successive calls in one test do not hand back the same
  // square twice.
  for (let by = hBlocks - h; by >= 0; by -= h) {
    for (let bx = wBlocks - w; bx >= 0; bx -= w) {
      const candidate = { bx, by, bw: w, bh: h };
      if (!taken.some((t) => overlaps(candidate, t))) return candidate;
    }
  }
  throw new Error(`no free ${w}x${h} block region on /p/${slug}`);
}

/**
 * Drag a rectangle of blocks on the grid canvas.
 *
 * Works in *block* coordinates and converts through the canvas's own rendered
 * box, so it stays correct under the responsive downscale (DECISIONS D7) rather
 * than assuming 1:1.
 */
export async function dragBlocks(
  page: Page,
  from: { bx: number; by: number },
  to: { bx: number; by: number },
  gridBlocks = WALL_BLOCKS,
): Promise<void> {
  const canvas = page.getByTestId("grid-overlay");
  await canvas.waitFor({ state: "visible" });

  // `page.mouse` works in viewport coordinates, and a 1200px grid is taller
  // than any viewport we test at — so a block near the bottom of the wall sits
  // below the fold and the drag lands on nothing at all. Scroll the target
  // into view first, then re-read the box, because `boundingBox()` is
  // viewport-relative and changes when the page scrolls.
  const before = await canvas.boundingBox();
  if (!before) throw new Error("grid canvas has no box — is it rendered?");

  // Fraction down the grid we need centred, computed here; the conversion to a
  // document scroll position happens in the browser, where `window` exists.
  const midFraction = (from.by + to.by) / 2 / gridBlocks;
  await page.evaluate(
    ({ boxTop, boxHeight, fraction }) => {
      const documentTop = boxTop + window.scrollY;
      const target = documentTop + boxHeight * fraction - window.innerHeight / 2;
      window.scrollTo({ top: Math.max(0, target), behavior: "instant" });
    },
    { boxTop: before.y, boxHeight: before.height, fraction: midFraction },
  );

  const box = await canvas.boundingBox();
  if (!box) throw new Error("grid canvas vanished mid-drag");

  const at = (b: { bx: number; by: number }) => ({
    // Aim at the centre of the block, not its corner: a corner can round
    // either way under a fractional scale.
    x: box.x + ((b.bx + 0.5) / gridBlocks) * box.width,
    y: box.y + ((b.by + 0.5) / gridBlocks) * box.height,
  });

  const start = at(from);
  const end = at(to);

  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.mouse.up();
}

/** Buy the current selection with fake money, all the way through settlement. */
export async function payWithFakeMoney(page: Page): Promise<void> {
  await page.waitForURL(/\/checkout\/mock\//);
  await page.getByRole("button", { name: /^pay/i }).click();
  await page.waitForURL(/\/checkout\/return/);
  await page.getByText(/paid|done|complete/i).first().waitFor();
}
