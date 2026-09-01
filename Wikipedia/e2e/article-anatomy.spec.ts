import { test, expect } from "@playwright/test";

/**
 * The base page (`/`) is the "David's Internet" article, rendered through
 * the same `ArticleShell` composition as every `/wiki/<slug>` route (see
 * `src/app/page.tsx`). This spec walks the anatomy SPEC.md §1/§5 promise:
 * titlebar, siteSub, toolbar tabs, infobox, TOC, References, categories and
 * footer.
 */
test.describe("article anatomy", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("titlebar renders the article title", async ({ page }) => {
    await expect(page.locator("h1#firstHeading")).toHaveText("David's Internet");
  });

  test("siteSub reads the Wikipedia tagline", async ({ page }) => {
    await expect(page.locator("#siteSub")).toHaveText("From Wikipedia, the free encyclopedia");
  });

  test("Article and Read tabs are selected; Talk, Edit and View history are absent", async ({ page }) => {
    const article = page.getByText("Article", { exact: true });
    const read = page.getByText("Read", { exact: true });
    await expect(article).toBeVisible();
    await expect(read).toBeVisible();
    await expect(article).not.toHaveAttribute("aria-disabled", "true");
    await expect(read).not.toHaveAttribute("aria-disabled", "true");

    await expect(page.getByText("Talk", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Edit", { exact: true })).toHaveCount(0);
    await expect(page.getByText("View history", { exact: true })).toHaveCount(0);
  });

  test("infobox is present with a Website row", async ({ page }) => {
    const infobox = page.locator("table.infobox");
    await expect(infobox).toBeVisible();
    await expect(infobox.locator("caption")).toHaveText("David's Internet");

    const websiteRow = infobox.locator("tr", { has: page.getByRole("rowheader", { name: "Website" }) });
    await expect(websiteRow).toBeVisible();
  });

  test("Contents TOC lists (Top) and jumps to article sections", async ({ page }) => {
    const toc = page.getByRole("navigation", { name: "Contents" });
    await expect(toc).toBeVisible();
    await expect(toc.getByRole("link", { name: "(Top)" })).toBeVisible();
    await expect(toc.getByRole("link", { name: "Background" })).toBeVisible();
    await expect(toc.getByRole("link", { name: "References" })).toBeVisible();
  });

  test("References section lists numbered items", async ({ page }) => {
    const references = page.locator("section", { has: page.locator("#References") });
    await expect(references.locator("h2 .mw-headline")).toHaveText("References");

    const items = references.locator("ol.references > li");
    await expect(items).toHaveCount(1);
    await expect(items.first()).toHaveAttribute("id", "cite_note-1");
  });

  test("categories bar lists the article's categories", async ({ page }) => {
    const catlinks = page.locator(".catlinks");
    await expect(catlinks).toBeVisible();
    await expect(catlinks).toContainText("Categories:");
    await expect(catlinks).toContainText("Portfolio indexes");
    await expect(catlinks).toContainText("Software replicas");
  });

  test("footer shows the last-edited line", async ({ page }) => {
    await expect(page.locator("footer")).toContainText("This page was last edited on 1 September 2026.");
  });
});
