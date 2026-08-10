import { expect, test } from "@playwright/test";

import { seedSettings } from "./helpers";

/**
 * Live mode needs a camera. Only the Chromium project is launched with a fake
 * media device, so the tests that actually stream are pinned there; the primer
 * and permission-denied paths run everywhere, because those are the states a
 * real user is most likely to hit.
 */
test.describe("live stream mode", () => {
  test("shows a primer before touching the camera", async ({ page }) => {
    // getUserMedia must be called from a user gesture, so the app cannot open
    // straight into a stream — and a blank black screen would read as broken.
    await page.goto("/live");
    await expect(page.getByTestId("camera-primer")).toBeVisible();
    await expect(page.getByTestId("camera-start")).toBeVisible();
  });

  test("streams with broadcast chrome once the camera starts", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome", "needs a fake camera device");

    await seedSettings(page, { live: { username: "rowan", viewers: 1240, commentsPerMinute: 60 } });
    await page.goto("/live");
    await page.getByTestId("camera-start").click();

    await expect(page.getByTestId("live-screen")).toBeVisible();
    await expect(page.getByTestId("live-badge")).toBeVisible();
    // 1240 must render abbreviated, per the platform convention.
    await expect(page.getByTestId("viewer-count")).toHaveText(/1\.2K/);

    // The video element must be inline and muted, or iOS takes it fullscreen
    // and the illusion dies.
    const video = page.locator("video").first();
    await expect(video).toHaveAttribute("playsinline", /.*/);
    await expect(video).toHaveJSProperty("muted", true);
    await expect
      .poll(async () => video.evaluate((el: HTMLVideoElement) => el.videoWidth), { timeout: 10_000 })
      .toBeGreaterThan(0);
  });

  test("comments appear over the stream", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome", "needs a fake camera device");

    await seedSettings(page, { live: { commentsPerMinute: 120 } });
    await page.goto("/live");
    await page.getByTestId("camera-start").click();

    const stream = page.getByTestId("comment-stream");
    await expect(stream).toBeVisible();
    await expect.poll(async () => (await stream.textContent())?.length ?? 0, { timeout: 15_000 })
      .toBeGreaterThan(0);
  });

  test("closing returns to options", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chrome", "needs a fake camera device");

    await page.goto("/live");
    await page.getByTestId("camera-start").click();
    await page.getByTestId("live-close").click();
    await expect(page).toHaveURL(/\/home$/);
  });

  test("explains itself when permission is denied", async ({ page, context }, testInfo) => {
    test.skip(testInfo.project.name === "mobile-safari", "WebKit has no permission override here");

    await context.clearPermissions();
    await page.addInitScript(() => {
      // Force a denial regardless of the launch flags, so this asserts the
      // app's own handling rather than the harness's.
      Object.defineProperty(navigator, "mediaDevices", {
        configurable: true,
        value: {
          getUserMedia: () => Promise.reject(new DOMException("Denied", "NotAllowedError")),
          enumerateDevices: () => Promise.resolve([]),
        },
      });
    });

    await page.goto("/live");
    await page.getByTestId("camera-start").click();
    // Whatever the copy, the user must be told something rather than left on a
    // black screen.
    await expect(page.getByTestId("camera-primer")).toContainText(/camera/i);
  });
});
