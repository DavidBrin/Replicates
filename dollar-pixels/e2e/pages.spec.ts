import { expect, test } from "@playwright/test";
import { COPY, dragBlocks, signIn, waitForGrid } from "./helpers";

/**
 * The two page kinds, and the thing that separates them: who gets paid.
 */

function uniqueSlug(prefix: string): string {
  // The store is seeded per server process and these tests run in parallel, so
  // a fixed slug would collide with itself on a retry. The worker index is not
  // enough — the same worker reruns on retry.
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

test.describe("making an unlisted page", () => {
  test("costs ten dollars, stays out of the directory, and grants free blocks", async ({
    page,
  }) => {
    const slug = uniqueSlug("ana");

    await page.goto("/new");
    await signIn(page, "Ana Ruiz");

    await page.getByRole("radio", { name: /unlisted page/i }).check();
    await page.getByLabel(/title/i).fill("Ana's corner shop");
    await page.getByLabel(/address/i).fill(slug);

    // Flat, whatever size is picked — an unlisted page buys a canvas, not a
    // revenue stream (DECISIONS D4).
    await expect(page.getByText("$10").first()).toBeVisible();
    await expect(page.getByText(/69/).first()).toBeVisible();

    await page.getByRole("button", { name: /create for/i }).click();
    await page.waitForURL(/\/checkout\/mock\//);
    await page.getByRole("button", { name: /^pay/i }).click();
    await page.waitForURL(/\/checkout\/return/);

    await page.goto(`/p/${slug}`);
    await waitForGrid(page, slug);
    await expect(page.getByText(COPY.unlisted).first()).toBeVisible();

    // Absent from the directory, but the link still works — unlisted, not
    // access-controlled.
    await page.goto("/pages");
    await expect(page.getByText("Ana's corner shop")).toHaveCount(0);
  });

  test("its creator can claim blocks without paying", async ({ page }) => {
    const slug = uniqueSlug("free");

    await page.goto("/new");
    await signIn(page, "Dara Nwosu");
    await page.getByRole("radio", { name: /unlisted page/i }).check();
    await page.getByLabel(/title/i).fill("Dara's page");
    await page.getByLabel(/address/i).fill(slug);
    await page.getByRole("button", { name: /create for/i }).click();
    await page.waitForURL(/\/checkout\/mock\//);
    await page.getByRole("button", { name: /^pay/i }).click();
    await page.waitForURL(/\/checkout\/return/);

    await page.goto(`/p/${slug}`);
    await waitForGrid(page, slug);

    await dragBlocks(page, { bx: 2, by: 2 }, { bx: 4, by: 4 }, 120);
    await page.getByLabel(/caption/i).fill("On the house");

    const free = page.getByRole("button", { name: /use a free block/i });
    await expect(free).toBeVisible();
    await free.click();

    await expect(page.getByText("On the house").first()).toBeVisible();
    // 9 of 69 spent.
    await expect(page.getByText(/60/).first()).toBeVisible();
  });
});

test.describe("making a premium page", () => {
  test("is priced at half the face value and pays its creator", async ({ page }) => {
    const slug = uniqueSlug("prem");

    await page.goto("/new");
    await signIn(page, "Esi Boateng");
    await page.getByRole("radio", { name: /premium page/i }).check();
    await page.getByLabel(/title/i).fill("Esi's wall");
    await page.getByLabel(/address/i).fill(slug);

    // 120 x 120 = 14,400 blocks at 50 cents.
    await page.getByRole("radio", { name: /small/i }).check();
    await expect(page.getByText("$7,200").first()).toBeVisible();

    await page.getByRole("button", { name: /create for/i }).click();
    await page.waitForURL(/\/checkout\/mock\//);
    await page.getByRole("button", { name: /^pay/i }).click();
    await page.waitForURL(/\/checkout\/return/);

    // Premium pages are listed.
    await page.goto("/pages");
    await expect(page.getByText("Esi's wall").first()).toBeVisible();
  });

  test("credits the creator when somebody else buys a block", async ({ browser }) => {
    const slug = uniqueSlug("earn");

    const creatorContext = await browser.newContext();
    const creator = await creatorContext.newPage();
    await creator.goto("/new");
    await signIn(creator, "Fen Marlowe");
    await creator.getByRole("radio", { name: /premium page/i }).check();
    await creator.getByLabel(/title/i).fill("Fen's wall");
    await creator.getByLabel(/address/i).fill(slug);
    await creator.getByRole("radio", { name: /small/i }).check();
    await creator.getByRole("button", { name: /create for/i }).click();
    await creator.waitForURL(/\/checkout\/mock\//);
    await creator.getByRole("button", { name: /^pay/i }).click();
    await creator.waitForURL(/\/checkout\/return/);

    const buyerContext = await browser.newContext();
    const buyer = await buyerContext.newPage();
    await buyer.goto(`/p/${slug}`);
    await waitForGrid(buyer, slug);
    await signIn(buyer, "Gil Ferreira");
    await dragBlocks(buyer, { bx: 10, by: 10 }, { bx: 14, by: 14 }, 120);
    await buyer.getByLabel(/caption/i).fill("Gil was here");
    await buyer.getByRole("button", { name: /buy for/i }).click();
    await buyer.waitForURL(/\/checkout\/mock\//);
    await buyer.getByRole("button", { name: /^pay/i }).click();
    await buyer.waitForURL(/\/checkout\/return/);

    // 25 blocks at a dollar, all of it to the creator at the default zero fee.
    await creator.goto("/dashboard");
    await expect(creator.getByText("$25.00").first()).toBeVisible();

    await creatorContext.close();
    await buyerContext.close();
  });
});

test.describe("the directory", () => {
  test("lists the wall", async ({ page }) => {
    await page.goto("/pages");
    await expect(page.getByText("The Wall").first()).toBeVisible();
  });
});
