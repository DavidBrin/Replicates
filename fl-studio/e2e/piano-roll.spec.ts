import { expect, test } from "@playwright/test";

import { APP_URL, clickCanvasAt, gridPoint, noteCount } from "./helpers";

/**
 * SPEC §7 e2e #2 — the Piano Roll, opened the way a user opens it.
 *
 * The canvas has no DOM to assert against, so the count comes from the store
 * (through the `?e2e=1` hook) while everything around it — which window is
 * showing, which channel the roll targets — is asserted in the DOM.
 */

test("open a melodic channel, draw two notes, undo one", async ({ page }) => {
  await page.goto(APP_URL);

  // SPEC §1.1: clicking the channel name opens the Piano Roll for it. The tab
  // flip is the shell's, the channel is the roll's — one click drives both.
  await page.getByTestId("channel-name-ch-bass").click();
  await expect(page.getByText("Piano roll - Untitled")).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Target channel" })).toHaveValue("ch-bass");

  const canvas = page.getByTestId("piano-roll-canvas");
  await expect(canvas).toBeVisible();

  await clickCanvasAt(canvas, gridPoint(0));
  await expect.poll(() => noteCount(page)).toBe(1);

  await clickCanvasAt(canvas, gridPoint(2));
  await expect.poll(() => noteCount(page)).toBe(2);

  // One gesture is one Ctrl+Z (SPEC §2.1): the second draw goes, the first stays.
  await page.keyboard.press("Control+z");
  await expect.poll(() => noteCount(page)).toBe(1);

  await page.keyboard.press("Control+z");
  await expect.poll(() => noteCount(page)).toBe(0);

  await page.keyboard.press("Control+Shift+z");
  await expect.poll(() => noteCount(page)).toBe(1);
});

test("a right-click on a drawn note deletes it", async ({ page }) => {
  await page.goto(APP_URL);
  await page.getByTestId("channel-name-ch-bass").click();

  const canvas = page.getByTestId("piano-roll-canvas");
  await clickCanvasAt(canvas, gridPoint(0));
  await expect.poll(() => noteCount(page)).toBe(1);

  await canvas.click({ position: gridPoint(0), button: "right", force: true });
  await expect.poll(() => noteCount(page)).toBe(0);
});
