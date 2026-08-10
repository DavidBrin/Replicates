import { test, expect } from "@playwright/test";

/**
 * Questions belonging to seeded PRIVATE markets (`seed-data/private-markets.ts`)
 * — distinctive enough substrings that they could never legitimately match
 * an Explore (public, generated) market's question. Explore must never
 * surface any of them (D6 / SPEC §3.6: Explore is a wholly separate,
 * generated dataset).
 */
const PRIVATE_MARKET_SUBSTRINGS = [
  "Marcus actually run the 10k",
  "dishes before Thursday",
  "Fantasy 2026 championship",
  "WiFi get fixed by Friday",
];

test.describe("explore", () => {
  test("renders a grid of cards and a category tab filters it", async ({ page }) => {
    await page.goto("/explore");

    // Scoped to the main grid (`data-testid="explore-grid"`) — the
    // right-rail "Trending" list also links to `/explore/[id]` (same href
    // prefix), so an unscoped `a[href^="/explore/"]` would double-count.
    const grid = page.getByTestId("explore-grid");
    const cards = grid.locator('a[href^="/explore/"]');
    const initialCount = await cards.count();
    expect(initialCount).toBeGreaterThan(0);

    await page.locator('nav[aria-label="Categories"]').getByRole("link", { name: "Sports" }).click();
    await expect(page).toHaveURL(/[?&]category=sports/);

    const filteredGrid = page.getByTestId("explore-grid");
    const filteredCards = filteredGrid.locator('a[href^="/explore/"]');
    await expect(filteredCards.first()).toBeVisible();

    // Every card in the filtered grid carries the "Sports" category badge —
    // proves the tab actually filtered the underlying data, not just
    // relabeled the same set. Each card's `<a>` is a "stretched link"
    // (`ExploreMarketCard.tsx`'s doc comment) that sits as an empty
    // SIBLING of the card's content, not a wrapper around it — so the
    // badge text lives on the card's root `<div>`, one level up, not on
    // the anchor itself.
    const cardContainers = filteredGrid.locator("> div");
    const cardCount = await cardContainers.count();
    expect(cardCount).toBe(await filteredCards.count());
    const sportsBadges = cardContainers.filter({ hasText: "Sports" });
    expect(await sportsBadges.count()).toBe(cardCount);
  });

  test("a card opens its read-only detail page with a chart", async ({ page }) => {
    await page.goto("/explore");
    const firstCard = page.getByTestId("explore-grid").locator('a[href^="/explore/"]').first();
    const question = await firstCard.getAttribute("aria-label");
    expect(question).toBeTruthy();
    await firstCard.click();

    await expect(page).toHaveURL(/\/explore\/.+/);
    await expect(page.getByRole("heading", { name: question!, level: 1 })).toBeVisible();
    await expect(page.getByRole("img", { name: "Probability history" })).toBeVisible();
  });

  test("never shows a seeded private market question", async ({ page }) => {
    await page.goto("/explore");
    const bodyText = await page.locator("body").innerText();
    for (const substring of PRIVATE_MARKET_SUBSTRINGS) {
      expect(bodyText).not.toContain(substring);
    }

    // Belt-and-suspenders: searching for a private market by a distinctive
    // keyword returns nothing, proving it's absent from the underlying
    // Explore dataset, not just scrolled out of view.
    await page.goto("/explore?q=" + encodeURIComponent("dishes"));
    await expect(page.getByText("No markets here yet")).toBeVisible();
    expect(await page.locator('[data-testid="explore-grid"] a[href^="/explore/"]').count()).toBe(0);
  });
});
