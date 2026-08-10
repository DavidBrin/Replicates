import { test, expect } from "@playwright/test";
import { signIn } from "./helpers";

async function fillStep1(page: import("@playwright/test").Page, question: string, criteria: string) {
  await expect(page.getByRole("heading", { name: "Create a bet" })).toBeVisible();
  await page.getByLabel("Question").fill(question);
  await page.getByLabel("Resolution criteria").fill(criteria);
  // "In a week" always lands strictly in the future regardless of when the
  // suite runs — avoids hand-typing a datetime-local value.
  await page.getByRole("button", { name: "In a week" }).click();
}

test.describe("create-bet wizard", () => {
  test("completes all five steps and the new bet appears on the dashboard and opens", async ({
    page,
  }) => {
    await signIn(page, "dev");
    await page.goto("/app/new");

    const question = `E2E wizard bet ${Date.now()}`;
    const criteria = "Resolves Yes if this E2E run completes successfully end to end, No otherwise.";

    // Step 1
    await fillStep1(page, question, criteria);
    await page.getByRole("button", { name: "Next" }).click();

    // Step 2 — binary Yes/No is valid by default, no input needed.
    await expect(page.getByRole("switch", { name: /isn't yes\/no/ })).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();

    // Step 3 — pricing defaults (Market-priced) are valid, skippable.
    await expect(page.getByRole("radiogroup", { name: "Pricing" })).toBeVisible();
    await page.getByRole("button", { name: "Next" }).click();

    // Step 4 — zero invitees is valid.
    await page.getByRole("button", { name: "Next" }).click();

    // Step 5 — review, then create.
    await expect(page.getByText(question, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Create bet" }).click();

    // Lands on the new market's own page.
    await page.waitForURL(/\/app\/g\/[^/]+\/m\/.+/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: question, level: 1 })).toBeVisible();

    // Appears on the group dashboard...
    const dashboardUrl = page.url().replace(/\/m\/.+$/, "");
    await page.goto(dashboardUrl);
    const card = page.getByText(question, { exact: true });
    await expect(card).toBeVisible();

    // ...and opens.
    await card.click();
    await expect(page.getByRole("heading", { name: question, level: 1 })).toBeVisible();
  });

  test("draft persists across a reload after filling steps 1-2", async ({ page }) => {
    await signIn(page, "dev");
    await page.goto("/app/new");

    const question = `E2E draft persistence ${Date.now()}`;
    const criteria = "Resolves Yes if the draft survives a hard reload, No otherwise, obviously.";
    await fillStep1(page, question, criteria);
    const closesAtValue = await page.getByLabel("Closes").inputValue();
    await page.getByRole("button", { name: "Next" }).click();

    // Step 2 — actually change something so persistence is meaningfully
    // exercised, not just "the default survived."
    await page.getByRole("switch", { name: /isn't yes\/no/ }).click();
    const outcomeLabel = "Definitely maybe";
    await page.getByLabel("Outcome 1").fill(outcomeLabel);
    await page.getByLabel("Outcome 2").fill("The other one");

    await page.reload();

    // The wizard remounts client-only (hydration-safe gate) and restores
    // the draft from localStorage — back on step 1 (step itself isn't
    // persisted), fields intact.
    await expect(page.getByRole("heading", { name: "Create a bet" })).toBeVisible();
    await expect(page.getByLabel("Question")).toHaveValue(question);
    await expect(page.getByLabel("Resolution criteria")).toHaveValue(criteria);
    await expect(page.getByLabel("Closes")).toHaveValue(closesAtValue);

    // Step 2's custom-outcomes toggle and labels also survived.
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.getByRole("switch", { name: /isn't yes\/no/ })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(page.getByLabel("Outcome 1")).toHaveValue(outcomeLabel);
  });
});
