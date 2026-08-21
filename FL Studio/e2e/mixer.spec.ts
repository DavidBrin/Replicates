import { expect, test, type Locator, type Page } from "@playwright/test";

import { APP_URL } from "./helpers";

/**
 * SPEC §7 e2e #6 — the Mixer.
 *
 * Faders are pointer-drag controls with no native input behind them, so the
 * drag is driven with `page.mouse` and read back off the slider's ARIA value —
 * which is the same number the store holds, and the only one a screen reader
 * would get.
 */

function fader(page: Page, label: string): Locator {
  return page.getByRole("slider", { name: label });
}

async function dragFaderBy(page: Page, handle: Locator, deltaY: number): Promise<void> {
  const box = await handle.boundingBox();
  expect(box).not.toBeNull();
  const centerX = box!.x + box!.width / 2;
  const centerY = box!.y + box!.height / 2;
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  // Several moves, so the gesture also exercises the coalescing path a real
  // drag takes rather than a single jump.
  await page.mouse.move(centerX, centerY + deltaY / 2);
  await page.mouse.move(centerX, centerY + deltaY);
  await page.mouse.up();
}

async function valueOf(control: Locator): Promise<number> {
  return Number(await control.getAttribute("aria-valuenow"));
}

test("drag the Master and an insert fader, then undo each", async ({ page }) => {
  await page.goto(APP_URL);

  // F9 toggles the Mixer window; press it twice to prove the binding works and
  // still leave the window open.
  await expect(page.getByTestId("mixer")).toBeVisible();
  await page.keyboard.press("F9");
  await expect(page.getByTestId("mixer")).toBeHidden();
  await page.keyboard.press("F9");
  await expect(page.getByTestId("mixer")).toBeVisible();

  const master = fader(page, "Master volume");
  const insert = fader(page, "Insert 1 volume");
  expect(await valueOf(master)).toBeCloseTo(0.8, 5);
  expect(await valueOf(insert)).toBeCloseTo(0.8, 5);

  // Down the screen = quieter (the fader is inverted like a physical one).
  await dragFaderBy(page, master, 40);
  const loweredMaster = await valueOf(master);
  expect(loweredMaster).toBeLessThan(0.8);
  await expect(master).toHaveAttribute("data-off-default", "true");

  await dragFaderBy(page, insert, -30);
  const raisedInsert = await valueOf(insert);
  expect(raisedInsert).toBeGreaterThan(0.8);

  // One drag is one Ctrl+Z (SPEC §2.1) — the insert comes back first.
  await page.keyboard.press("Control+z");
  await expect.poll(() => valueOf(insert)).toBeCloseTo(0.8, 5);
  expect(await valueOf(master)).toBeCloseTo(loweredMaster, 5);

  await page.keyboard.press("Control+z");
  await expect.poll(() => valueOf(master)).toBeCloseTo(0.8, 5);
  await expect(master).toHaveAttribute("data-off-default", "false");

  await page.keyboard.press("Control+Shift+z");
  await expect.poll(() => valueOf(master)).toBeCloseTo(loweredMaster, 5);
});

test("mute an insert strip and select it", async ({ page }) => {
  await page.goto(APP_URL);

  const mute = page.getByTestId("mixer-strip-mute-mix-1");
  await expect(mute).toHaveAttribute("data-muted", "false");

  await mute.click();
  await expect(mute).toHaveAttribute("data-muted", "true");

  await page.keyboard.press("Control+z");
  await expect(mute).toHaveAttribute("data-muted", "false");

  // Strip selection is ephemeral UI state in the composed store.
  await page.getByTestId("mixer-strip-name-mix-1").click();
  await expect(page.getByTestId("mixer-strip-mix-1")).toHaveAttribute("data-selected", "true");
  await expect(page.getByTestId("mixer-strip-master")).toHaveAttribute("data-selected", "false");
});

test("a fader move is not undone by reloading — it was saved", async ({ page }) => {
  await page.goto(APP_URL);

  const insert = fader(page, "Insert 2 volume");
  await dragFaderBy(page, insert, 35);
  const lowered = await valueOf(insert);
  expect(lowered).toBeLessThan(0.8);

  await page.waitForTimeout(1_500); // past the 750 ms autosave debounce
  await page.reload();

  await expect.poll(() => valueOf(fader(page, "Insert 2 volume"))).toBeCloseTo(lowered, 5);
});
