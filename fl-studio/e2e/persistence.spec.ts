import { expect, test } from "@playwright/test";

import { APP_URL, clipCount, noteCount, stepCell } from "./helpers";

/**
 * SPEC §7 e2e #5 — "save → reload page → project persists".
 *
 * Nothing here presses Save: the point is that the debounced autosave
 * (SPEC §2.2) has already written by the time a user would close the tab.
 * The explicit Save button gets its own case below.
 */

const AUTOSAVE_SETTLE_MS = 1_500; // the 750 ms debounce, doubled for slack

test("an edit survives a page reload", async ({ page }) => {
  await page.goto(APP_URL);

  await stepCell(page, "ch-kick", 0).click();
  await stepCell(page, "ch-kick", 8).click();
  await page.getByTestId("lane-trk-1").click({ position: { x: 4, y: 20 } });
  expect(await noteCount(page)).toBe(2);

  await page.waitForTimeout(AUTOSAVE_SETTLE_MS);
  await page.reload();

  await expect(stepCell(page, "ch-kick", 0)).toHaveAttribute("data-on", "true");
  await expect(stepCell(page, "ch-kick", 8)).toHaveAttribute("data-on", "true");
  await expect(stepCell(page, "ch-kick", 4)).toHaveAttribute("data-on", "false");
  await expect.poll(() => noteCount(page)).toBe(2);
  await expect.poll(() => clipCount(page)).toBe(1);
});

test("the Save button writes immediately, before the debounce would", async ({ page }) => {
  await page.goto(APP_URL);

  await stepCell(page, "ch-kick", 2).click();
  await page.getByText("Save").click();
  await page.reload();

  await expect(stepCell(page, "ch-kick", 2)).toHaveAttribute("data-on", "true");
});

test("a fresh profile with no save gets the default project", async ({ page }) => {
  await page.goto(APP_URL);

  await expect(stepCell(page, "ch-kick", 0)).toHaveAttribute("data-on", "false");
  expect(await noteCount(page)).toBe(0);
  await expect(page.getByTestId("bpm-lcd")).toHaveText(/140/);
});
