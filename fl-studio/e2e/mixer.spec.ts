import { expect, test, type Locator, type Page } from "@playwright/test";

import {
  APP_URL,
  audioStarted,
  meterLevel,
  noteCount,
  peakMeterOver,
  stepCell,
} from "./helpers";

/**
 * Generous, and deliberately so — a limiter, a 0.8 master fader and a
 * measurement window that can straddle a decay tail all pull the number
 * around. What must not happen is the two bands overlapping: a signal peak
 * lands near 0.7 in practice, and a muted bus ramps to a true zero.
 */
const SIGNAL_FLOOR = 0.05;
const SILENCE_CEILING = 0.005;

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

/* ------------------------------------------------------ the audio path --- */

/**
 * Everything above asserts ARIA values and store state — which is to say it
 * would still pass against a mixer wired to nothing at all. This test closes
 * that gap: it reads the master strip's `AnalyserNode` tap through the
 * `?e2e=1` hook and asserts that programming steps and pressing Play produces
 * *signal*, and that muting the strip those steps route through takes it away.
 *
 * It runs headless under `--disable-audio-output` (see `playwright.config.ts`).
 * That switch was verified — by instrumenting this exact read — to still clock
 * the graph: Chromium's fake output stream pulls samples in software and the
 * analyser sees a peak around 0.74 on a kick pattern. It is the real device
 * that stalls across sequential pages, not the graph.
 *
 * Every channel in the default project routes to Master (SPEC §2.2's default),
 * so "the channel's mixer track" IS the master strip here.
 */
test("a programmed beat reaches the master meter, and muting silences it", async ({ page }) => {
  await page.goto(APP_URL);

  // Eight kicks — dense enough that a sampling window cannot land entirely in
  // the gaps between hits.
  for (const step of [0, 2, 4, 6, 8, 10, 12, 14]) {
    await stepCell(page, "ch-kick", step).click();
  }
  expect(await noteCount(page)).toBe(8);

  // Before the first gesture there is no engine at all (SPEC §3.1), and the
  // hook says so with -1 rather than pretending to be silence.
  expect(await meterLevel(page)).toBe(-1);

  await page.getByLabel("Play").click();
  await expect(page.getByLabel("Stop")).toBeVisible();
  await expect
    .poll(() => audioStarted(page), { timeout: 20_000, message: "engine never booted" })
    .toBe(true);

  await expect
    .poll(() => peakMeterOver(page, 60), {
      timeout: 30_000,
      message: "master meter never left silence",
    })
    .toBeGreaterThan(SIGNAL_FLOOR);

  // Mute the strip the kick routes through. The tap is post-limiter, so this
  // is the signal that actually leaves the bus.
  const masterMute = page.getByTestId("mixer-strip-mute-master");
  await masterMute.click();
  await expect(masterMute).toHaveAttribute("data-muted", "true");

  await expect
    .poll(() => peakMeterOver(page, 60), {
      timeout: 30_000,
      message: "master meter never decayed after mute",
    })
    .toBeLessThan(SILENCE_CEILING);

  // …and it comes back, so the assertion above is about the mute and not
  // about the transport having quietly died mid-test.
  await masterMute.click();
  await expect(masterMute).toHaveAttribute("data-muted", "false");
  await expect
    .poll(() => peakMeterOver(page, 60), {
      timeout: 30_000,
      message: "master meter never recovered after unmute",
    })
    .toBeGreaterThan(SIGNAL_FLOOR);

  await page.getByLabel("Stop").click();
});
