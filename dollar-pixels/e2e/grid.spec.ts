import { expect, test } from "@playwright/test";
import { WALL, dragBlocks, waitForGrid } from "./helpers";

/**
 * The grid itself: that it renders at all, that a block is nine pixels on the
 * screen as well as in the domain, and that the accessible path is real rather
 * than decorative (DECISIONS D16).
 */

test.describe("the canvas", () => {
  test("renders the wall with its counts", async ({ page }) => {
    await page.goto(WALL);
    await waitForGrid(page, "the-wall");

    const base = page.getByTestId("grid-base");
    await expect(base).toBeVisible();

    // 400 x 400 blocks (DECISIONS D1), stated in the text alternative so a
    // screen reader gets the same headline number the stat box shows.
    await expect(base).toHaveAttribute("aria-label", /160,000|sold/i);
  });

  test("renders at 1:1 on a desktop viewport, so a block is three real pixels", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop-chrome", "desktop only");

    await page.goto(WALL);
    await waitForGrid(page, "the-wall");

    const box = await page.getByTestId("grid-base").boundingBox();
    expect(box).not.toBeNull();
    // The whole reason the grid is 1200 and not larger: below 1.0 scale a
    // 3-pixel block stops landing on device-pixel boundaries.
    expect(box!.width).toBe(1200);
  });

  test("scales down to fit a phone without breaking hit-testing", async ({
    page,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome", "mobile only");

    await page.goto(WALL);
    await waitForGrid(page, "the-wall");

    const box = await page.getByTestId("grid-base").boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThan(1200);
    expect(box!.width).toBeGreaterThan(0);

    // The model still speaks in whole blocks even though the display does not.
    await dragBlocks(page, { bx: 100, by: 100 }, { bx: 103, by: 103 });
    await expect(page.getByTestId("selection-summary")).toContainText("16 blocks");
  });

  test("zooms in integer steps only", async ({ page }) => {
    await page.goto(WALL);
    await waitForGrid(page, "the-wall");

    const before = await page.getByTestId("grid-base").boundingBox();
    await page.getByRole("button", { name: /zoom in/i }).click();
    const after = await page.getByTestId("grid-base").boundingBox();

    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    // Exactly double, never 1.5x — a fractional factor is what splits a block
    // across a pixel boundary (DECISIONS D7).
    expect(after!.width / before!.width).toBeCloseTo(2, 1);
  });
});

test.describe("without a pointer", () => {
  test("the claims list carries the same information as the canvas", async ({ page }) => {
    await page.goto(WALL);
    await waitForGrid(page, "the-wall");

    // A canvas is a black box to a screen reader; the list is the reason the
    // grid is reachable at all.
    const list = page.getByRole("table").or(page.getByRole("list")).first();
    await expect(list).toBeVisible();
    await expect(page.getByText("Harbour Lights Coffee").first()).toBeVisible();
  });

  test("the grid takes keyboard focus and describes how to drive it", async ({
    page,
  }) => {
    await page.goto(WALL);
    await waitForGrid(page, "the-wall");

    await page.getByRole("group", { name: /grid/i }).focus();
    await expect(page.getByText(/arrow keys/i).first()).toBeVisible();
  });
});
