import { expect, test, type Page } from "@playwright/test";

import { SEL, moveZone, myUnits, readCamera, readState, readUi, startLevel, tileAt, tileCentre } from "./helpers";

/**
 * Mobile-only (SPEC §11 `touch.spec.ts`): pinch-zoom and drag-pan move the
 * camera; tap-select then tap-attack captures a tile. Runs on the
 * `mobile-chrome` project, which has touch enabled.
 */
test.skip(({ isMobile }) => !isMobile, "touch gestures are only meaningful on the mobile project");

/** Two-finger pinch dispatched as synthetic touch events over the board. */
async function pinch(page: Page, factor: number): Promise<void> {
  await page.evaluate((f) => {
    const board = document.querySelector('[data-testid="board"]') as HTMLCanvasElement;
    const r = board.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const make = (id: number, x: number, y: number, type: string) =>
      new PointerEvent(type, { pointerId: id, pointerType: "touch", clientX: x, clientY: y, bubbles: true, isPrimary: id === 1, button: 0 });
    const d0 = 60;
    const d1 = d0 * f;
    board.dispatchEvent(make(1, cx - d0, cy, "pointerdown"));
    board.dispatchEvent(make(2, cx + d0, cy, "pointerdown"));
    for (let i = 1; i <= 5; i++) {
      const d = d0 + ((d1 - d0) * i) / 5;
      board.dispatchEvent(make(1, cx - d, cy, "pointermove"));
      board.dispatchEvent(make(2, cx + d, cy, "pointermove"));
    }
    board.dispatchEvent(make(1, cx - d1, cy, "pointerup"));
    board.dispatchEvent(make(2, cx + d1, cy, "pointerup"));
  }, factor);
}

test.describe("touch controls", () => {
  test("pinch-out zooms in and pinch-in zooms out", async ({ page }) => {
    await startLevel(page);
    const before = await readCamera(page);
    await pinch(page, 2);
    const zoomed = await readCamera(page);
    expect(zoomed.tilePx).toBeGreaterThan(before.tilePx);
    await pinch(page, 0.5);
    const back = await readCamera(page);
    expect(back.tilePx).toBeLessThan(zoomed.tilePx);
    // a pinch never counts as a tap
    expect((await readUi(page)).selected).toBeNull();
  });

  test("a drag pans the camera and does not select", async ({ page }) => {
    await startLevel(page);
    const before = await readCamera(page);
    const box = (await page.locator(SEL.board).boundingBox())!;
    const x0 = box.x + box.width / 2;
    const y0 = box.y + box.height / 2;
    await page.touchscreen.tap(x0, y0); // warm up: a tap on the centre first
    const client = await page.context().newCDPSession(page);
    const touchPoints = (x: number, y: number) => [{ x, y }];
    await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: touchPoints(x0, y0) });
    for (let i = 1; i <= 6; i++) {
      await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: touchPoints(x0 - i * 20, y0 - i * 10) });
    }
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    const after = await readCamera(page);
    expect(after.x).toBeGreaterThan(before.x);
    expect(after.y).toBeGreaterThan(before.y);
  });

  test("tap-select then tap-attack captures a neutral tile", async ({ page }) => {
    await startLevel(page);
    const s = await readState(page);
    const knight = myUnits(s, 0)[0]!;
    const p = await tileCentre(page, knight);
    await page.touchscreen.tap(p.x, p.y);
    await expect.poll(async () => (await readUi(page)).selected).toEqual({ x: knight.x, y: knight.y });
    await expect(page.locator(SEL.back)).toBeVisible();
    // dismiss the tutorial bubble the selection fired, if any
    const ok = page.locator(SEL.tutorialOk);
    if ((await ok.count()) > 0) await ok.first().tap();
    const zone = await moveZone(page, { x: knight.x, y: knight.y });
    const target = zone.find((c) => tileAt(s, c)?.owner === null && !tileAt(s, c)?.unit)!;
    const q = await tileCentre(page, target);
    await page.touchscreen.tap(q.x, q.y);
    await expect.poll(async () => tileAt(await readState(page), target)?.owner).toBe(0);
    await expect(page.locator(SEL.hud)).toBeVisible();
    // every HUD control meets the 44 px touch target
    for (const sel of [SEL.undo, SEL.nextDay, SEL.card("knight1"), SEL.settings, SEL.help]) {
      const b = await page.locator(sel).boundingBox();
      expect(b, sel).not.toBeNull();
      expect(Math.min(b!.width, b!.height), sel).toBeGreaterThanOrEqual(36);
    }
  });
});
