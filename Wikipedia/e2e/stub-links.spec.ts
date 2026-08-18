import { test, expect } from "@playwright/test";

/**
 * SPEC.md §3: every unset "Website" row is a red-link stub
 * (`src/components/wiki/ExternalLink.tsx`, class `new external-link`,
 * `title="the project is not deployed yet"`) that routes to the shared
 * "page does not exist" screen (`src/app/wiki/[slug]/NoArticle.tsx`).
 */
test.describe("stub links", () => {
  test("a project's Website red-link carries the red-link styling class", async ({ page }) => {
    await page.goto("/wiki/Linear_(replica)");

    const infobox = page.locator("table.infobox");
    const websiteRow = infobox.locator("tr", { has: page.getByRole("rowheader", { name: "Website" }) });
    const stubLink = websiteRow.getByRole("link");

    await expect(stubLink).toHaveClass(/\bnew\b/);
    await expect(stubLink).toHaveClass(/external-link/);
    await expect(stubLink).toHaveAttribute("title", "the project is not deployed yet");
  });

  test("navigating a Website stub lands on the page-does-not-exist screen, which links home", async ({
    page,
  }) => {
    await page.goto("/wiki/Linear_(replica)");

    const infobox = page.locator("table.infobox");
    const websiteRow = infobox.locator("tr", { has: page.getByRole("rowheader", { name: "Website" }) });
    await websiteRow.getByRole("link").click();

    await expect(page).toHaveURL(/\/wiki\/Website_not_yet_deployed$/);
    await expect(page.locator("#noarticletext")).toBeVisible();
    await expect(page.locator("#noarticletext")).toContainText(
      "This page is not deployed yet or does not exist.",
    );

    await page.locator("#noarticletext").getByRole("link", { name: "Main page" }).click();
    await expect(page.locator("h1#firstHeading")).toHaveText("David's Internet");
  });
});
