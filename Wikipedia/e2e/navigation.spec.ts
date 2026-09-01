import { test, expect } from "@playwright/test";
import { KNOWN_TITLES, PROJECT_LINKS } from "./support";

/**
 * SPEC.md §5: the sidebar's "Main page" and "Random article" are the two
 * functional main-menu links; the Replicas and Interactive demos wikitables
 * on the home article are the other route into every project article.
 */
test.describe("navigation", () => {
  for (const { linkText, title } of PROJECT_LINKS) {
    test(`homepage table link "${linkText}" opens its article`, async ({ page }) => {
      await page.goto("/");
      await page
        .locator("table.wikitable")
        .getByRole("link", { name: linkText, exact: true })
        .click();
      await expect(page.locator("h1#firstHeading")).toHaveText(title);
    });
  }

  test("sidebar David's Internet link points at the search engine", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Main menu" }).click();
    await expect(
      page.getByRole("navigation", { name: "Main menu" }).getByRole("link", { name: "David's Internet" }),
    ).toHaveAttribute("href", "https://david-internet.vercel.app");
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
