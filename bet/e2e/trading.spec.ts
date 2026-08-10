import { test, expect } from "@playwright/test";
import { signIn, openUserMenu } from "./helpers";

/**
 * The single most important spec in the suite (per the task brief): open a
 * seeded OPEN market, place a real buy through the order ticket, and prove
 * all four "done when" criteria from docs/plan.md Task 14 in one flow.
 *
 * Targets the seeded "Will Marcus actually run the 10k on Saturday?" market
 * (`sl-10k` in `seed-data/private-markets.ts`) — the one deliberately
 * seeded `lmsr` (price-moving) market with fees on, that `dev` is already a
 * participant of (Sunday League), with a 3-day close window and a 200
 * credit max stake. It's referenced by its stable seed *question text*
 * (never a raw market id, which is regenerated per server start) — the
 * same fixture every prior task's own live verification (Task 7, 9, 10
 * reports) used for exactly this reason.
 */

function parseCredits(text: string): number {
  return Number(text.replace(/[,\s]/g, ""));
}

test("buying a share moves the price, drops the balance, posts a Room message, and shows the new position", async ({
  page,
}) => {
  await signIn(page, "dev");
  await page.goto("/app/g/sunday-league");

  await page.getByText("Will Marcus actually run the 10k on Saturday?", { exact: true }).click();
  await expect(page).toHaveURL(/\/app\/g\/sunday-league\/m\/.+/);

  // --- capture "before" state -------------------------------------------------
  const leadingProbability = page.getByTestId("market-leading-probability");
  await expect(leadingProbability).toBeVisible();
  const beforeProbabilityText = (await leadingProbability.textContent())!.trim();

  await openUserMenu(page);
  const beforeBalanceText = (await page.getByTestId("topbar-balance").textContent())!.trim();
  const beforeBalance = parseCredits(beforeBalanceText);
  await page.keyboard.press("Escape");

  const roomMessages = page.locator('[data-testid="room-panel"] span.truncate');
  const beforeRoomTexts = await roomMessages.allTextContents();

  const positionRowsBefore = page.getByTestId("position-row");
  const beforePositions = await positionRowsBefore.evaluateAll((els) =>
    els.map((el) => [el.getAttribute("data-outcome-label"), el.getAttribute("data-shares")]),
  );
  const beforeSharesByOutcome = new Map(beforePositions.map(([label, shares]) => [label, Number(shares)]));

  // --- place the trade ---------------------------------------------------------
  const submit = page.getByTestId("order-submit");
  // The 150ms-debounced quote must resolve before the button's real
  // "Buy <outcome>" label (and enabled state) replaces its interim
  // disabled-reason text ("Getting a quote…" / "Enter an amount").
  await expect(submit).toBeEnabled({ timeout: 10_000 });
  await expect(submit).toHaveText(/^(Buy|Sell) /, { timeout: 10_000 });
  await submit.click();

  await expect(page.getByText("Trade placed")).toBeVisible({ timeout: 10_000 });

  // --- 1. probability changed ---------------------------------------------------
  await expect(async () => {
    const afterText = (await leadingProbability.textContent())!.trim();
    expect(afterText).not.toBe(beforeProbabilityText);
  }).toPass({ timeout: 10_000 });

  // --- 2. top-bar balance decreased ----------------------------------------------
  await expect(async () => {
    await openUserMenu(page);
    const afterBalanceText = (await page.getByTestId("topbar-balance").textContent())!.trim();
    await page.keyboard.press("Escape");
    expect(parseCredits(afterBalanceText)).toBeLessThan(beforeBalance);
  }).toPass({ timeout: 10_000 });

  // --- 3. a system trade message appeared in the Room -----------------------------
  await expect(async () => {
    const afterTexts = await roomMessages.allTextContents();
    const newTradeMessage = afterTexts.find(
      (t) => /\b(bought|sold)\b/i.test(t) && !beforeRoomTexts.includes(t),
    );
    expect(newTradeMessage).toBeTruthy();
  }).toPass({ timeout: 10_000 });

  // --- 4. the position tab shows the new shares ------------------------------------
  // "Your position" is the default active tab already — no click needed.
  await expect(page.getByRole("tab", { name: "Your position" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(async () => {
    const rows = page.getByTestId("position-row");
    const afterPositions = await rows.evaluateAll((els) =>
      els.map((el) => [el.getAttribute("data-outcome-label"), el.getAttribute("data-shares")]),
    );
    // Either a brand-new outcome row appeared (dev didn't hold this side
    // before), or an existing row's share count grew — either way proves
    // the trade landed in "Your position," not just in the balance/price.
    const grew = afterPositions.some(([label, shares]) => {
      const before = beforeSharesByOutcome.get(label);
      return before === undefined || Number(shares) > before;
    });
    expect(grew).toBeTruthy();
  }).toPass({ timeout: 10_000 });
});
