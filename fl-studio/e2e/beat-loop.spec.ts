import { expect, test } from "@playwright/test";

import { APP_URL, noteCount, playheadTicks, stepCell } from "./helpers";

/**
 * SPEC §7 e2e #1 — "toggle sixteen steps, press space, and it's a beat".
 *
 * Toggle four kick steps, start the transport, watch the playhead move, stop
 * it and watch it come home. This is the loop the whole project passes or
 * fails on (SPEC §1's cut rule), so it is the first spec that runs.
 */

test("program four kick steps, play, and stop", async ({ page }) => {
  await page.goto(APP_URL);

  for (const step of [0, 4, 8, 12]) {
    await stepCell(page, "ch-kick", step).click();
  }

  // Steps ARE notes (SPEC §2), so the rack's on-state and the project agree.
  for (const step of [0, 4, 8, 12]) {
    await expect(stepCell(page, "ch-kick", step)).toHaveAttribute("data-on", "true");
  }
  expect(await noteCount(page)).toBe(4);

  // A real gesture is what boots audio (SPEC §3.1) — this click is it.
  await page.getByLabel("Play").click();
  await expect(page.getByLabel("Stop")).toBeVisible();

  // The playhead is read off the transport on a rAF loop, so poll it rather
  // than sampling once.
  await expect
    .poll(() => playheadTicks(page), { timeout: 10_000, message: "playhead never advanced" })
    .toBeGreaterThan(0);

  // The step highlight follows the transport (SPEC §7 #1).
  await expect(
    page.getByTestId("channel-row-ch-kick").locator('[data-playhead="true"]'),
  ).toHaveCount(1);

  await page.getByLabel("Stop").click();
  await expect(page.getByLabel("Play")).toBeVisible();
  await expect.poll(() => playheadTicks(page)).toBe(0);

  // Stopping does not un-program the beat.
  expect(await noteCount(page)).toBe(4);
});

test("Space plays and stops from any window", async ({ page }) => {
  await page.goto(APP_URL);
  await stepCell(page, "ch-kick", 0).click();

  await page.keyboard.press("Space");
  await expect(page.getByLabel("Stop")).toBeVisible();

  await page.keyboard.press("Space");
  await expect(page.getByLabel("Play")).toBeVisible();
});
