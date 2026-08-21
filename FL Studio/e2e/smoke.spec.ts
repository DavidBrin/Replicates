import { expect, test } from "@playwright/test";

import { APP_URL, hasHook, noteCount, stepCell } from "./helpers";

/**
 * The cheap checks: the app boots, the docked windows are there, nothing in
 * the console screams (SPEC §9's "no console errors"), and the e2e hook is
 * absent unless the URL asks for it.
 */

test("home page loads with the docked layout", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });

  await page.goto(APP_URL);

  await expect(page).toHaveTitle("FL Studio");
  await expect(page.getByText("Playlist")).toBeVisible();
  await expect(page.getByText("Channel rack")).toBeVisible();
  await expect(page.getByText("Mixer - return to new")).toBeVisible();
  await expect(page.getByRole("toolbar", { name: "Transport" })).toBeVisible();
  await expect(stepCell(page, "ch-kick", 0)).toBeVisible();

  expect(errors).toEqual([]);
});

test("the test hook exists only when the URL asks for it", async ({ page }) => {
  await page.goto("/");
  expect(await hasHook(page)).toBe(false);

  await page.goto(APP_URL);
  expect(await hasHook(page)).toBe(true);
  expect(await noteCount(page)).toBe(0);
});
