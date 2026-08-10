import { expect, test } from "@playwright/test";

import { CALL, seedSilentRing } from "./helpers";

/**
 * One suite, both skins, driven entirely through the shared test ids. That is
 * the payoff of the skin contract: behaviour is asserted once, and a skin can
 * only differ in appearance.
 */
for (const skin of ["ios", "android"] as const) {
  test.describe(`${skin} skin`, () => {
    test("rings, answers, times and ends", async ({ page }) => {
      await seedSilentRing(page, { skin, caller: { name: "Alex", label: "mobile" } });
      await page.goto("/");

      await expect(page.getByTestId(CALL.callerName)).toHaveText("Alex");
      await page.getByTestId(CALL.answer).click();
      await expect(page.getByTestId(CALL.timer)).toBeVisible();

      await page.getByTestId(CALL.hangUp).click();
      await expect(page.getByTestId("home-screen")).toBeVisible({ timeout: 5000 });
    });

    test("shows the monogram when no photo is set", async ({ page }) => {
      await seedSilentRing(page, { skin, caller: { name: "Priya Raman", label: "mobile" } });
      await page.goto("/");
      await expect(page.getByText("PR", { exact: true })).toBeVisible();
    });
  });
}

test("the two skins render visibly different call screens", async ({ page }) => {
  // Guards against the failure mode where a second skin is a recolour of the
  // first. Compares the answer control's computed border-radius: iOS is a
  // circle, Android's decline/end-call are stadium pills over a different
  // surface treatment, so the rendered geometry must not be identical.
  const geometry: Record<string, string> = {};

  for (const skin of ["ios", "android"] as const) {
    await seedSilentRing(page, { skin });
    await page.goto("/");
    await page.getByTestId(CALL.answer).click();
    const box = await page.getByTestId(CALL.hangUp).evaluate((node) => {
      const style = getComputedStyle(node as HTMLElement);
      const rect = (node as HTMLElement).getBoundingClientRect();
      return `${style.borderRadius}|${Math.round(rect.width)}x${Math.round(rect.height)}`;
    });
    geometry[skin] = box;
  }

  expect(geometry.ios).not.toBe(geometry.android);
});
