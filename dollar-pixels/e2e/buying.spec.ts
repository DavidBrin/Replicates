import { expect, test } from "@playwright/test";
import { COPY, WALL, dragBlocks, findFreeRect, signIn, waitForGrid } from "./helpers";

/**
 * The buy path, driven the way a person drives it.
 *
 * This is the suite that matters most, because the fake-money checkout and the
 * Stripe webhook settle through the same code (DECISIONS D10) — so proving the
 * play-money purchase works end to end proves the settlement logic Stripe will
 * drive, not a parallel shortcut around it.
 */

test.describe("buying blocks with play money", () => {
  test("drag, caption, pay, and the blocks are yours", async ({ page }) => {
    await page.goto(WALL);
    await waitForGrid(page, "the-wall");
    await signIn(page, "Ana Ruiz");

    const rect = await findFreeRect(page, "the-wall", 4, 4);
    await dragBlocks(
      page,
      { bx: rect.bx, by: rect.by },
      { bx: rect.bx + 3, by: rect.by + 3 },
    );

    const summary = page.getByTestId("selection-summary");
    await expect(summary).toContainText("16 blocks");
    await expect(summary).toContainText("144 pixels");
    await expect(summary).toContainText("$16");

    await page.getByLabel(/caption/i).fill("Ana's corner");
    await page.getByRole("button", { name: /buy for/i }).click();

    await page.waitForURL(/\/checkout\/mock\//);
    await expect(page.getByText(COPY.playMoney).first()).toBeVisible();

    // The amount is on the button itself, which is also the thing that has to
    // be right — it is what the buyer reads before committing.
    const pay = page.getByRole("button", { name: /^pay \$16\.00$/i });
    await expect(pay).toBeVisible();
    await pay.click();

    await page.waitForURL(/\/checkout\/return/);
    await expect(page.getByText(/paid|complete|done/i).first()).toBeVisible();

    await page.goto(WALL);
    await waitForGrid(page, "the-wall");
    await expect(page.getByText("Ana's corner").first()).toBeVisible();
  });

  test("a declined payment leaves the blocks free", async ({ page }) => {
    await page.goto(WALL);
    await waitForGrid(page, "the-wall");
    await signIn(page, "Ben Oyelaran");

    const rect = await findFreeRect(page, "the-wall", 2, 2);
    await dragBlocks(
      page,
      { bx: rect.bx, by: rect.by },
      { bx: rect.bx + 1, by: rect.by + 1 },
    );
    await page.getByLabel(/caption/i).fill("Ben tries");
    await page.getByRole("button", { name: /buy for/i }).click();

    await page.waitForURL(/\/checkout\/mock\//);
    await page.getByRole("button", { name: /simulate a decline/i }).click();

    await page.goto(WALL);
    await waitForGrid(page, "the-wall");
    await expect(page.getByText("Ben tries")).toHaveCount(0);
  });

  test("the price is nine pixels to the dollar at every size", async ({ page }) => {
    await page.goto(WALL);
    await waitForGrid(page, "the-wall");
    await signIn(page, "Cass Iyer");

    const one = await findFreeRect(page, "the-wall", 1, 1);
    await dragBlocks(page, { bx: one.bx, by: one.by }, { bx: one.bx, by: one.by });
    const summary = page.getByTestId("selection-summary");
    await expect(summary).toContainText("1 block");
    await expect(summary).toContainText("9 pixels");
    await expect(summary).toContainText("$1");

    const ten = await findFreeRect(page, "the-wall", 10, 10);
    await dragBlocks(
      page,
      { bx: ten.bx, by: ten.by },
      { bx: ten.bx + 9, by: ten.by + 9 },
    );
    await expect(summary).toContainText("100 blocks");
    await expect(summary).toContainText("900 pixels");
    await expect(summary).toContainText("$100");
  });

  test("signed out, you are asked to sign in rather than shown nothing", async ({
    page,
  }) => {
    await page.goto(WALL);
    await waitForGrid(page, "the-wall");

    const rect = await findFreeRect(page, "the-wall", 2, 2);
    await dragBlocks(
      page,
      { bx: rect.bx, by: rect.by },
      { bx: rect.bx + 1, by: rect.by + 1 },
    );
    await expect(page.getByText(COPY.signIn).first()).toBeVisible();
  });
});

test.describe("the play-money warning", () => {
  test("is on every screen while the provider is not live", async ({ page }) => {
    for (const path of ["/", WALL, "/pages", "/new"]) {
      await page.goto(path);
      await expect(page.getByText(COPY.playMoney).first()).toBeVisible();
    }
  });
});
