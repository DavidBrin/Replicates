import { test, expect } from "@playwright/test";

/**
 * The Contents TOC (`src/components/chrome/Toc.tsx`) is a plain in-page
 * anchor list; clicking an entry should move the URL hash and scroll the
 * matching `h2[id]` into view. The sticky header
 * (`src/components/chrome/StickyHeader.tsx`) only fades in once
 * `window.scrollY > 180`, which a TOC jump on a long article satisfies.
 */
test.describe("table of contents", () => {
  test("clicking a TOC entry scrolls the section into view and sets the hash", async ({ page }) => {
    await page.goto("/wiki/Linear_(replica)");

    const toc = page.getByRole("navigation", { name: "Contents" });
    await toc.getByRole("link", { name: "Architecture" }).click();

    await expect(page).toHaveURL(/#Architecture$/);
    const heading = page.locator("#Architecture");
    await expect(heading).toBeInViewport();
  });

  test("sticky header appears once scrolled down", async ({ page }) => {
    await page.goto("/wiki/Linear_(replica)");

    const stickyHeader = page.locator("#vector-sticky-header");
    await expect(stickyHeader).toHaveAttribute("aria-hidden", "true");

    await page.evaluate(() => window.scrollTo(0, 400));
    await expect(stickyHeader).toHaveAttribute("aria-hidden", "false");
  });
});
