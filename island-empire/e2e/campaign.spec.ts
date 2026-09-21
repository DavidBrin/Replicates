import { expect, test } from "@playwright/test";

import {
  SEL,
  applyForTest,
  dismissTutorial,
  moveZone,
  myUnits,
  playGreedyTurn,
  readState,
  readUi,
  startLevel,
  tapTile,
  tileAt,
  waitForHumanTurn,
} from "./helpers";

/**
 * Tutorial level 01 through the real UI on both projects (SPEC §11): the
 * board renders, taps select and move, UNDO restores, and the level is
 * won. Every assertion reads truth through `window.__islandDebug`, never
 * pixels; `applyForTest` drives the many repetitive turns where the UI
 * would only be slow.
 */

test.describe("campaign level 01", () => {
  test("renders the in-game screen with the HUD in the acting player's colour", async ({ page }) => {
    await startLevel(page);
    await expect(page.locator(SEL.hud)).toBeVisible();
    await expect(page.locator(SEL.hud)).toHaveAttribute("data-colour", "blue");
    await expect(page.locator(SEL.levelLabel)).toHaveText(/Level: 1/);
    for (const item of ["knight1", "woodwall", "stoneTower", "farm"]) {
      await expect(page.locator(SEL.card(item))).toBeVisible();
    }
    // level 01 opens with 1 gold: every card is unaffordable
    await expect(page.locator(SEL.card("knight1"))).toHaveAttribute("data-state", "unaffordable");
    await expect(page.locator(SEL.gold)).toContainText("1");
    await expect(page.locator(SEL.undo)).toBeDisabled();
    const s = await readState(page);
    expect(s.width).toBe(8);
    expect(s.activePlayerIndex).toBe(0);
    expect(s.turnNumber).toBe(0);
  });

  test("tapping the knight selects it, shows the merge cards, info card and back button; tapping a lit tile moves it", async ({ page }) => {
    await startLevel(page);
    const s = await readState(page);
    const knight = myUnits(s, 0)[0]!;
    await tapTile(page, knight);
    await expect.poll(async () => (await readUi(page)).selected).toEqual({ x: knight.x, y: knight.y });
    await expect(page.locator(SEL.back)).toBeVisible();
    await expect(page.locator(SEL.infoCard)).toContainText(/KNIGHT LEVEL 1/i);
    await expect(page.locator('[data-testid="shop-cards"]')).toHaveAttribute("data-mode", "merge");
    await dismissTutorial(page);

    const zone = await moveZone(page, knight);
    const neutral = zone.find((c) => tileAt(s, c)?.owner === null && !tileAt(s, c)?.unit);
    expect(neutral).toBeDefined();
    await tapTile(page, neutral!);
    await expect.poll(async () => tileAt(await readState(page), neutral!)?.owner).toBe(0);
    await expect.poll(async () => (await readState(page)).history.length).toBe(1);
    await expect(page.locator(SEL.undo)).toBeEnabled();
  });

  test("UNDO restores the previous state and greys out again", async ({ page }) => {
    await startLevel(page);
    const before = await readState(page);
    const knight = myUnits(before, 0)[0]!;
    const zone = await moveZone(page, knight);
    const neutral = zone.find((c) => tileAt(before, c)?.owner === null)!;
    await applyForTest(page, { type: "MOVE", unitAt: knight, to: neutral });
    expect(tileAt(await readState(page), neutral)?.owner).toBe(0);
    await expect(page.locator(SEL.undo)).toBeEnabled();
    await page.locator(SEL.undo).click();
    const after = await readState(page);
    expect(tileAt(after, neutral)?.owner).toBeNull();
    expect(tileAt(after, knight)?.unit).not.toBeNull();
    expect(after.history).toEqual([]);
    expect(after.tiles).toEqual(before.tiles);
    await expect(page.locator(SEL.undo)).toBeDisabled();
  });

  test("NEXT DAY hands the turn to the AI and the day counter advances", async ({ page }) => {
    await startLevel(page);
    await page.locator(SEL.nextDay).click();
    await waitForHumanTurn(page);
    const s = await readState(page);
    expect(s.turnNumber).toBe(1);
    expect(s.activePlayerIndex).toBe(0);
    await expect(page.locator(SEL.hud)).toHaveAttribute("data-colour", "blue");
  });

  test("HELP! opens the strength chart and the gear opens settings", async ({ page }) => {
    await startLevel(page);
    await page.locator(SEL.help).click();
    await expect(page.locator(SEL.helpModal)).toBeVisible();
    await page.locator(SEL.helpOk).click();
    await expect(page.locator(SEL.helpModal)).toHaveCount(0);
    await page.locator(SEL.settings).click();
    await expect(page.locator(SEL.settingsModal)).toBeVisible();
    await expect(page.locator('[data-testid="toggle-one-click"]')).toHaveAttribute("aria-checked", "false");
    await page.locator(SEL.settingsClose).click();
    await expect(page.locator(SEL.settingsModal)).toHaveCount(0);
  });

  test("plays level 01 to victory on Easy and shows the victory modal", async ({ page }) => {
    test.setTimeout(180_000);
    await startLevel(page, "01", "easy");
    for (let day = 0; day < 60; day++) {
      const s = await readState(page);
      if (s.outcome) break;
      await playGreedyTurn(page);
      const mid = await readState(page);
      if (mid.outcome) break;
      await applyForTest(page, { type: "END_TURN" });
      await waitForHumanTurn(page);
      await dismissTutorial(page);
    }
    const final = await readState(page);
    expect(final.outcome).toEqual({ winner: 0 });
    await expect(page.locator(SEL.endModal)).toBeVisible();
    await expect(page.locator(SEL.endModal)).toHaveAttribute("data-outcome", "victory");
    await expect(page.locator('[data-testid="end-stars"]')).toBeVisible();
    // the win is recorded per device
    const progress = await page.evaluate(() => window.localStorage.getItem("island-empire:progress:v1"));
    expect(progress).toContain('"01"');
    expect(progress).toContain("easy");
  });
});
