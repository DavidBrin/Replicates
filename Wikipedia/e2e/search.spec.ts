import { test, expect } from "@playwright/test";

/**
 * `SearchBox` (`src/components/chrome/SearchBox.tsx`) does client-side
 * prefix/substring matching via `searchTitles()` with a Codex-style
 * suggestion dropdown: typeahead, arrow-key + Enter navigation, and
 * click-to-navigate.
 */
test.describe("search", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  // Scoped to `header`: `StickyHeader` renders a second, hidden `SearchBox`
  // (`src/components/chrome/StickyHeader.tsx`) that would otherwise make
  // every `input[type="search"]` / listbox locator ambiguous.

  test("typing a matching prefix shows a suggestion", async ({ page }) => {
    const input = page.locator('header input[type="search"]');
    await input.fill("lin");

    const listbox = page.locator("header").getByRole("listbox");
    await expect(listbox).toBeVisible();
    await expect(listbox.getByRole("option", { name: /Linear \(replica\)/ })).toBeVisible();
  });

  test("keyboard down + Enter navigates to the highlighted suggestion", async ({ page }) => {
    const input = page.locator('header input[type="search"]');
    await input.fill("lin");
    await expect(page.locator("header").getByRole("listbox")).toBeVisible();

    await input.press("ArrowDown");
    await input.press("Enter");

    await expect(page.locator("h1#firstHeading")).toHaveText("Linear (replica)");
  });

  test("typing garbage shows no suggestions", async ({ page }) => {
    const input = page.locator('header input[type="search"]');
    await input.fill("zzqxnonexistent");

    await expect(page.locator("header").getByRole("listbox")).toHaveCount(0);
  });

  test("clicking a suggestion navigates to its article", async ({ page }) => {
    const input = page.locator('header input[type="search"]');
    await input.fill("you");

    const option = page.locator("header").getByRole("option", { name: /YouTube \(replica\)/ });
    await expect(option).toBeVisible();
    await option.click();

    await expect(page.locator("h1#firstHeading")).toHaveText("YouTube (replica)");
  });
});
