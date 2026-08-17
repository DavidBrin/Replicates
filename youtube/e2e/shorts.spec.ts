import { FIXTURE, expect, gotoAndSettle, test } from "./support/fixtures";

/**
 * Shorts, at a phone's aspect ratio.
 *
 * This file's name matches `/shorts|mobile/`, so `playwright.config.ts` runs
 * it on the Pixel 7 project. That is not decoration: the vertical player, the
 * swipe pager and the right-hand action rail only exist at this ratio, and a
 * desktop viewport renders a different component tree.
 */

test.describe("the Shorts feed", () => {
  test("opens on the requested short", async ({ page }) => {
    await gotoAndSettle(page, `/shorts/${FIXTURE.videos.solder.id}`);
    await expect(page.getByText(FIXTURE.videos.solder.title)).toBeVisible();
  });

  test("carries the action rail beside the video", async ({ page }) => {
    await gotoAndSettle(page, `/shorts/${FIXTURE.videos.solder.id}`);

    // The rail is the surface that only exists here. Its like control carries
    // the count, which is what distinguishes it from the watch page's.
    await expect(page.getByRole("button", { name: /like/i }).first()).toBeVisible();
  });

  test("advances to the next short with the keyboard", async ({ page }) => {
    await gotoAndSettle(page, `/shorts/${FIXTURE.videos.solder.id}`);

    await page.keyboard.press("ArrowDown");

    // The other seeded short. Which one is "next" is the recommender's answer,
    // so the assertion is that the feed moved rather than which way.
    await expect(page.getByText(FIXTURE.videos.solder.title)).toHaveCount(0);
  });

  test("starts muted, and says so", async ({ page }) => {
    // Autoplay with sound is refused by policy on every browser, so the feed
    // has to start muted and offer the unmute rather than fail silently.
    await gotoAndSettle(page, `/shorts/${FIXTURE.videos.solder.id}`);
    await expect(
      page.getByRole("button", { name: /unmute|tap to unmute/i }),
    ).toBeVisible();
  });

  test("renders without a page error", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));

    await gotoAndSettle(page, `/shorts/${FIXTURE.videos.frost.id}`);

    expect(errors).toEqual([]);
  });
});
