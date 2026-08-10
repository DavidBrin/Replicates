import { expect, test } from "@playwright/test";

import { CALL, seedSilentRing } from "./helpers";

test.describe("the call is the entry surface", () => {
  test("a cold boot lands on a ringing call, not a menu", async ({ page }) => {
    await seedSilentRing(page, { caller: { name: "Sam", label: "mobile" } });
    await page.goto("/");

    // The product claim under test: no splash, no menu, no tap required.
    await expect(page.getByTestId(CALL.screen)).toBeVisible();
    await expect(page.getByTestId(CALL.callerName)).toHaveText("Sam");
    await expect(page.getByTestId(CALL.answer)).toBeVisible();
    await expect(page.getByTestId(CALL.decline)).toBeVisible();
    // No timer before the call is answered.
    await expect(page.getByTestId(CALL.timer)).toHaveCount(0);
  });

  test("answering starts a timer that actually counts", async ({ page }) => {
    await seedSilentRing(page);
    await page.goto("/");
    await page.getByTestId(CALL.answer).click();

    const timer = page.getByTestId(CALL.timer);
    await expect(timer).toBeVisible();
    // iOS format: minutes with no leading zero, two-digit seconds.
    await expect(timer).toHaveText(/^\d:\d{2}$/);
    await expect(timer).toHaveText("0:02", { timeout: 6000 });
  });

  test("the end-call button is the way into options", async ({ page }) => {
    await seedSilentRing(page);
    await page.goto("/");
    await page.getByTestId(CALL.answer).click();
    await expect(page.getByTestId(CALL.timer)).toBeVisible();

    await page.getByTestId(CALL.hangUp).click();
    await expect(page.getByTestId("home-screen")).toBeVisible({ timeout: 5000 });
    await expect(page).toHaveURL(/\/home$/);
  });

  test("declining also reaches options", async ({ page }) => {
    await seedSilentRing(page);
    await page.goto("/");
    await page.getByTestId(CALL.decline).click();
    await expect(page.getByTestId("home-screen")).toBeVisible({ timeout: 5000 });
  });

  test("mute and speaker toggle during a call", async ({ page }) => {
    await seedSilentRing(page);
    await page.goto("/");
    await page.getByTestId(CALL.answer).click();

    const mute = page.getByTestId(CALL.mute);
    await expect(mute).toBeVisible();
    await expect(mute).toHaveAttribute("aria-pressed", "false");
    await mute.click();
    await expect(mute).toHaveAttribute("aria-pressed", "true");

    const speaker = page.getByTestId(CALL.speaker);
    await speaker.click();
    await expect(speaker).toHaveAttribute("aria-pressed", "true");
  });
});

test.describe("delayed calls", () => {
  test("cancelling the countdown really cancels it", async ({ page }) => {
    // Regression test. Cancel used to call `router.refresh()`, which re-renders
    // the server component but deliberately preserves client state — so the
    // countdown kept running behind the refresh and the call rang anyway, which
    // is the one thing a button labelled Cancel must not do.
    await seedSilentRing(page, { ringDelaySeconds: 5 });
    await page.goto("/");

    await expect(page.getByTestId("ring-countdown")).toBeVisible();
    await page.getByTestId("ring-countdown-cancel").click();

    await expect(page.getByTestId("home-screen")).toBeVisible();
    await expect(page).toHaveURL(/\/home$/);

    // Well past the 5s delay: nothing may ring.
    await page.waitForTimeout(7000);
    await expect(page.getByTestId("home-screen")).toBeVisible();
    await expect(page.getByTestId(CALL.answer)).toHaveCount(0);
  });
});

test.describe("scripted voice", () => {
  test("the caller's lines appear as subtitles so the call reads as real without sound", async ({
    page,
  }) => {
    // Subtitles are the fallback path that matters: iOS speech synthesis is
    // unreliable enough that the call must still be convincing when nothing is
    // audible.
    await seedSilentRing(page, { voiceTier: "scripted", showSubtitles: true });
    await page.goto("/");
    await page.getByTestId(CALL.answer).click();

    await expect(page.getByTestId(CALL.subtitle)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId(CALL.subtitle)).not.toBeEmpty();
  });
});
