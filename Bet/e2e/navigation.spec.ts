import { test, expect } from "@playwright/test";
import { signIn } from "./helpers";

test.describe("navigation", () => {
  test("group tabs switch groups", async ({ page }) => {
    await signIn(page, "dev"); // dev is a member of all 3 seeded groups
    await expect(page).toHaveURL(/\/app\/g\/[^/]+$/);

    const groupNav = page.locator('nav[aria-label="Groups"]');
    await groupNav.getByRole("link", { name: /The Roommates/ }).click();
    await expect(page).toHaveURL(/\/app\/g\/the-roommates$/);
    await expect(page.getByRole("heading", { name: "The Roommates", level: 1 })).toBeVisible();

    await groupNav.getByRole("link", { name: /Fantasy 2026/ }).click();
    await expect(page).toHaveURL(/\/app\/g\/fantasy-2026$/);
    await expect(page.getByRole("heading", { name: "Fantasy 2026", level: 1 })).toBeVisible();

    await groupNav.getByRole("link", { name: /Sunday League/ }).click();
    await expect(page).toHaveURL(/\/app\/g\/sunday-league$/);
    await expect(page.getByRole("heading", { name: "Sunday League", level: 1 })).toBeVisible();
  });

  test("the market page's back link returns to its group dashboard", async ({ page }) => {
    await signIn(page, "dev");
    await page.goto("/app/g/sunday-league");

    const marketLink = page.locator('a[href*="/app/g/sunday-league/m/"]').first();
    await expect(marketLink).toBeVisible();
    await marketLink.click();
    await expect(page).toHaveURL(/\/app\/g\/sunday-league\/m\/.+/);

    // Scoped to <main> — the top bar's own "Sunday League" group tab has
    // the identical accessible name and would otherwise be ambiguous.
    const backLink = page.locator("main").getByRole("link", { name: "Sunday League" });
    await expect(backLink).toBeVisible();
    await backLink.click();

    await expect(page).toHaveURL(/\/app\/g\/sunday-league$/);
    await expect(page.getByRole("heading", { name: "Sunday League", level: 1 })).toBeVisible();
  });
});
