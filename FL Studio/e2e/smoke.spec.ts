import { expect, test } from "@playwright/test";

test("home page loads and has the right title", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle("FL Studio");
  await expect(page.getByRole("heading", { name: "FL Studio" })).toBeVisible();
});
