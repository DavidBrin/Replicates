import type { Locator, Page } from "@playwright/test";

/**
 * Shared plumbing for the e2e suite (SPEC §7's beat-making loop).
 *
 * The app is opened with `?e2e=1`, which is the only condition under which
 * `AppShell` installs `window.__flStudioE2E` — a read-only handle over the
 * store and the engine's playhead. It exists because two of the surfaces this
 * suite has to assert on (the piano roll's canvas, the transport's tick) have
 * no DOM to read: a canvas is one opaque element, and the playhead moves on a
 * rAF loop rather than through React. Everything a DOM assertion *can* cover
 * is still covered by a DOM assertion.
 */

export const APP_URL = "/?e2e=1";

// The hook's own type is declared on `Window` by
// `src/components/shell/wiring.ts`; re-declaring it here would be a
// conflicting global augmentation, so the reads below just use it.

export async function hasHook(page: Page): Promise<boolean> {
  return page.evaluate(() => "__flStudioE2E" in window);
}

export async function noteCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__flStudioE2E?.noteCount() ?? -1);
}

export async function clipCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__flStudioE2E?.clipCount() ?? -1);
}

export async function playheadTicks(page: Page): Promise<number> {
  return page.evaluate(() => window.__flStudioE2E?.playheadTicks() ?? -1);
}

/**
 * Peak sample magnitude off a mixer track's analyser tap, 0..1; `-1` before
 * the engine boots. The one read in this suite that goes past the store and
 * asks whether a step actually made a *sound*.
 */
export async function meterLevel(page: Page, trackId?: string): Promise<number> {
  return page.evaluate(
    (id) => window.__flStudioE2E?.meterLevel(id) ?? -1,
    trackId,
  );
}

/** Highest meter reading over `samples` animation frames — a peak, not a dip. */
export async function peakMeterOver(
  page: Page,
  samples = 24,
  trackId?: string,
): Promise<number> {
  return page.evaluate(
    async ({ samples: count, id }) => {
      let peak = -1;
      for (let i = 0; i < count; i += 1) {
        peak = Math.max(peak, window.__flStudioE2E?.meterLevel(id) ?? -1);
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      return peak;
    },
    { samples, id: trackId },
  );
}

export async function audioStarted(page: Page): Promise<boolean> {
  return page.evaluate(() => window.__flStudioE2E?.audioStarted() ?? false);
}

export async function playbackMode(page: Page): Promise<string> {
  return page.evaluate(() => window.__flStudioE2E?.getProject().playbackMode ?? "");
}

/** One 16th-step button of one channel row in the rack. */
export function stepCell(page: Page, channelId: string, step: number): Locator {
  return page
    .getByTestId(`channel-row-${channelId}`)
    .getByTestId(`step-${step}`);
}

/* ---------------------------------------------------- piano-roll geometry -- */

/**
 * Canvas coordinates, mirrored from `src/components/piano-roll/geometry.ts`.
 *
 * Duplicated on purpose: importing the app's module into the Playwright
 * process would let a geometry change move the *test's* idea of where a note
 * goes in lockstep with the app's, which is precisely the drift this suite is
 * supposed to notice. If these ever disagree with the surface, the failure is
 * the point.
 */
export const KEYBOARD_WIDTH = 104;
export const RULER_HEIGHT = 22;
export const ROW_HEIGHT = 21;
/** 21 px per 24-tick step at zoom 1. */
export const PX_PER_STEP = 21;

/**
 * A point inside the roll's grid, `stepsFromLeft` 16ths from tick 0 on the row
 * the grid opens on (C6). Staying in the top row keeps the point valid however
 * short the window is — the grid starts right under the ruler.
 */
export function gridPoint(stepsFromLeft: number): { x: number; y: number } {
  return {
    x: KEYBOARD_WIDTH + stepsFromLeft * PX_PER_STEP + PX_PER_STEP / 2,
    y: RULER_HEIGHT + ROW_HEIGHT / 2,
  };
}

/** Click inside a canvas at a canvas-relative point. */
export async function clickCanvasAt(
  canvas: Locator,
  point: { x: number; y: number },
): Promise<void> {
  await canvas.click({ position: point, force: true });
}
