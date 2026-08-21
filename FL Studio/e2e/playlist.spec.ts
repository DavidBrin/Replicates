import { expect, test } from "@playwright/test";

import { APP_URL, clipCount, playbackMode, playheadTicks, stepCell } from "./helpers";

/**
 * SPEC §7 e2e #3 — arrange two clips and play the song.
 *
 * Clips are *references* to a pattern (SPEC §1.1's "must be visibly true"), so
 * this also checks that editing the pattern behind two placed clips updates
 * both miniatures — the property a flat labelled rectangle would silently
 * fake.
 */

const PX_PER_BAR = 80; // the playlist's default zoom

test("paint two clips, switch to song mode, and play", async ({ page }) => {
  await page.goto(APP_URL);

  // Give the pattern something to draw in the miniatures.
  await stepCell(page, "ch-kick", 0).click();

  const lane = page.getByTestId("lane-trk-1");
  const box = await lane.boundingBox();
  expect(box).not.toBeNull();

  // Bar 0 and bar 2 — clips are one bar wide, so bar 1 would still be empty
  // between them, which makes the two placements unambiguous.
  await lane.click({ position: { x: 4, y: 20 } });
  await expect.poll(() => clipCount(page)).toBe(1);

  await lane.click({ position: { x: PX_PER_BAR * 2 + 4, y: 20 } });
  await expect.poll(() => clipCount(page)).toBe(2);

  // Both clips render the same pattern's notes (reference semantics).
  await expect(page.locator('[data-testid^="clip-"] rect')).toHaveCount(2);

  await stepCell(page, "ch-kick", 4).click();
  await expect(page.locator('[data-testid^="clip-"] rect')).toHaveCount(4);

  // `L` is the pattern/song flip (SPEC §1.1).
  await page.keyboard.press("l");
  await expect.poll(() => playbackMode(page)).toBe("song");
  await expect(page.getByLabel("Toggle pattern / song mode")).toHaveText("SONG");

  await page.getByLabel("Play").click();
  await expect(page.getByLabel("Stop")).toBeVisible();
  await expect
    .poll(() => playheadTicks(page), { timeout: 10_000, message: "song playhead never moved" })
    .toBeGreaterThan(0);
  await expect(page.getByTestId("playlist-playhead-line")).toBeVisible();

  await page.getByLabel("Stop").click();
  await expect(page.getByLabel("Play")).toBeVisible();
});

test("right-click erases a painted clip", async ({ page }) => {
  await page.goto(APP_URL);

  const lane = page.getByTestId("lane-trk-1");
  await lane.click({ position: { x: 4, y: 20 } });
  await expect.poll(() => clipCount(page)).toBe(1);

  await page.getByTestId(/^clip-/).first().click({ button: "right" });
  await expect.poll(() => clipCount(page)).toBe(0);
});
