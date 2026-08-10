import { expect, test } from "@playwright/test";

import { CALL, seedSilentRing, settingsReady } from "./helpers";

/**
 * Captures the reference screenshots in `docs/screenshots/`.
 *
 * Skipped unless `CAPTURE=1`, because it writes files rather than asserting
 * anything — it is documentation tooling that happens to be driven by the test
 * runner, not part of the suite. Run it with:
 *
 *   CAPTURE=1 npx playwright test screenshots --project=mobile-chrome
 */
const CAPTURE = process.env.CAPTURE === "1";
const DIR = "docs/screenshots";

test.describe("reference screenshots", () => {
  test.skip(!CAPTURE, "set CAPTURE=1 to write screenshots");

  for (const skin of ["ios", "android"] as const) {
    test(`${skin} incoming and in-call`, async ({ page }) => {
      await seedSilentRing(page, { skin, caller: { name: "Sarah Okonjo", label: "mobile" } });
      await page.goto("/");
      await expect(page.getByTestId(CALL.answer)).toBeVisible();
      await page.screenshot({ path: `${DIR}/${skin}-incoming.png` });

      await page.getByTestId(CALL.answer).click();
      await expect(page.getByTestId(CALL.timer)).toBeVisible();
      // Mute engaged, so the toggled-on control styling is visible — the detail
      // most replicas miss.
      await page.getByTestId(CALL.mute).click();
      await page.waitForTimeout(1200);
      await page.screenshot({ path: `${DIR}/${skin}-in-call.png` });
    });
  }

  test("home and settings", async ({ page }) => {
    await page.goto("/home");
    await settingsReady(page);
    // `settingsReady` resolves the moment the panel is allowed to accept input,
    // which is the *start* of its 200ms fade-in. Capturing there photographs a
    // half-faded panel.
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${DIR}/home.png` });
    await page.screenshot({ path: `${DIR}/home-full.png`, fullPage: true });
  });

  test("live mode", async ({ page }, testInfo) => {
    await seedSilentRing(page, { live: { username: "rowan", viewers: 1240, commentsPerMinute: 90 } });
    await page.goto("/live");
    await expect(page.getByTestId("camera-primer")).toBeVisible();
    await page.screenshot({ path: `${DIR}/live-primer.png` });

    test.skip(testInfo.project.name !== "mobile-chrome", "needs a fake camera device");
    await page.getByTestId("camera-start").click();
    await expect(page.getByTestId("live-badge")).toBeVisible();
    // Long enough for the comment stream and hearts to populate.
    await page.waitForTimeout(4000);
    await page.screenshot({ path: `${DIR}/live-streaming.png` });
  });

  test("ring countdown", async ({ page }) => {
    await seedSilentRing(page, { ringDelaySeconds: 30 });
    await page.goto("/");
    await expect(page.getByTestId("ring-countdown")).toBeVisible();
    await page.screenshot({ path: `${DIR}/ring-countdown.png` });
  });
});
