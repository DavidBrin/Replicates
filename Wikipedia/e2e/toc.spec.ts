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

    // The jump must clear the 50px sticky header (scroll-margin-top from
    // SCROLL_ANCHOR_OFFSET_PX) — a heading at y < 50 is underneath it.
    const top = await heading.evaluate((el) => el.getBoundingClientRect().top);
    expect(top).toBeGreaterThanOrEqual(50);
  });

  test("an instant jump back to the top clears the active section highlight", async ({ page }) => {
    await page.goto("/wiki/Linear_(replica)");

    const toc = page.getByRole("navigation", { name: "Contents" });
    const architecture = toc.getByRole("link", { name: "Architecture" });
    await architecture.click();
    await expect(architecture).toHaveClass(/font-bold/);

    // "(Top)" is an instant hash jump — the case where IntersectionObserver
    // saw no status change and kept a stale highlight (codex round 6).
    const topLink = toc.getByRole("link", { name: "(Top)" });
    await topLink.click();
    await expect(topLink).toHaveClass(/font-bold/);
    await expect(architecture).not.toHaveClass(/font-bold/);
  });

  test("sticky header appears once scrolled down", async ({ page }) => {
    await page.goto("/wiki/Linear_(replica)");

    const stickyHeader = page.locator("#vector-sticky-header");
    await expect(stickyHeader).toHaveAttribute("aria-hidden", "true");

    await page.evaluate(() => window.scrollTo(0, 400));
    await expect(stickyHeader).toHaveAttribute("aria-hidden", "false");
  });
});
