import { test, expect } from "@playwright/test";
import { signIn } from "./helpers";

test.describe("auth", () => {
  test("a signed-out request to /app redirects to /signin", async ({ page }) => {
    const response = await page.goto("/app");
    // `proxy.ts` redirects server-side, so the final response is /signin's.
    expect(response?.ok()).toBeTruthy();
    await expect(page).toHaveURL(/\/signin(\?|$)/);
    await expect(page.getByRole("heading", { name: "wanna bet?" })).toBeVisible();
  });

  test("signing in as @dev lands on a group dashboard showing seeded markets", async ({ page }) => {
    await signIn(page, "dev");

    // /app redirects to the user's first group's dashboard.
    await expect(page).toHaveURL(/\/app\/g\/[^/]+$/);

    // The group header (name + "New bet") and at least one market card are
    // real, seeded content — not an empty-state.
    await expect(page.getByRole("link", { name: "New bet" })).toBeVisible();
    const marketLinks = page.locator('a[href*="/app/g/"][href*="/m/"]');
    await expect(marketLinks.first()).toBeVisible();
    expect(await marketLinks.count()).toBeGreaterThan(0);

    // At least one of the dashboard's sectioned headings rendered with a
    // non-zero count, proving real seeded data, not just an empty shell.
    await expect(page.getByRole("heading", { name: /^(Open|Closing soon|Awaiting resolution|Settled)/ }).first()).toBeVisible();
  });

  test("an unknown route under /app also requires sign-in", async ({ page }) => {
    await page.goto("/app/g/this-group-does-not-exist");
    await expect(page).toHaveURL(/\/signin(\?|$)/);
  });
});
