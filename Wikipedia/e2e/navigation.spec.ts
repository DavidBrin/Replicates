import { test, expect } from "@playwright/test";
import { KNOWN_TITLES, PROJECT_LINKS } from "./support";

/**
 * SPEC.md §5: the sidebar's "Main page" and "Random article" are the two
 * functional main-menu links; the Projects wikitable on the home article is
 * the other route into every project article.
 */
test.describe("navigation", () => {
  for (const { linkText, title } of PROJECT_LINKS) {
    test(`Projects table link "${linkText}" opens its article`, async ({ page }) => {
      await page.goto("/");
      await page
        .locator("table.wikitable")
        .getByRole("link", { name: linkText, exact: true })
        .click();
      await expect(page.locator("h1#firstHeading")).toHaveText(title);
    });
  }

  test("sidebar Main page link returns home", async ({ page }) => {
    await page.goto("/wiki/Linear_(replica)");
    await page.getByRole("button", { name: "Main menu" }).click();
    await page.getByRole("link", { name: "Main page" }).click();
    await expect(page.locator("h1#firstHeading")).toHaveText("David's Internet");
  });

  test("sidebar Random article lands on a registered article", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Main menu" }).click();
    await page.getByRole("button", { name: "Random article" }).click();
    await expect(page.locator("h1#firstHeading")).toHaveText(/.+/);
    const heading = await page.locator("h1#firstHeading").textContent();
    expect(KNOWN_TITLES).toContain(heading?.trim());
  });
});
