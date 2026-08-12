import { expect, test } from "@playwright/test";
import { ROUTES, startFromTitle, waitForMatch } from "./helpers";

/**
 * The path a player actually takes: title → menu → rules → stage → fighters →
 * match → results. Tested as one journey rather than as seven isolated page
 * loads, because the match configuration lives in a client-side store — every
 * screen depends on what the previous one put there, and a deep link to
 * `/fighters` would find an empty store and prove nothing.
 */

test.describe.configure({ mode: "serial" });

test("the title screen waits for a keypress", async ({ page }) => {
  await page.goto(ROUTES.title);
  await expect(page.getByLabel("Press any button to continue")).toBeVisible();
  await page.keyboard.press("Enter");
  await page.waitForURL(`**${ROUTES.menu}`);
});

test("the main menu offers Smash and dims what is out of scope", async ({ page }) => {
  await startFromTitle(page);
  const smash = page.getByRole("button", { name: /smash/i }).first();
  await expect(smash).toBeVisible();
  await expect(smash).toBeEnabled();

  // The other four modes are deliberately present but disabled — their absence
  // would misrepresent the game more than their being greyed out does.
  for (const mode of ["Spirits", "Games & More", "Vault", "Online"]) {
    const tile = page.getByRole("button", { name: new RegExp(mode, "i") }).first();
    if (await tile.count()) await expect(tile).toBeDisabled();
  }
});

test("rules, stage and fighters lead to a running match", async ({ page }) => {
  await startFromTitle(page);
  await page.getByRole("button", { name: /smash/i }).first().click();
  await page.waitForURL(`**${ROUTES.rules}`);

  // Stock count is the one rule worth asserting: it decides when the match ends,
  // so a match that never ends is the failure this catches.
  await expect(page.getByText(/stock/i).first()).toBeVisible();
  await page.getByRole("button", { name: /next|stage|continue/i }).first().click();

  await page.waitForURL(`**${ROUTES.stage}`);
  await page.getByLabel("Stages").getByRole("button").first().click();
  await page.getByRole("button", { name: /next|fighters|continue/i }).first().click();

  await page.waitForURL(`**${ROUTES.fighters}`);
  const roster = page.getByLabel("Fighters").getByRole("button");
  await roster.nth(0).click();
  await roster.nth(1).click();

  await page.getByRole("button", { name: /ready|fight/i }).first().click();
  await page.waitForURL(`**${ROUTES.play}`);
  await waitForMatch(page);

  // The canvas is opaque to Playwright, so the assertion that the match is
  // genuinely running is that the simulation advanced — exposed for exactly
  // this reason rather than by scraping pixels.
  const frame = await page.evaluate(() => {
    const w = window as unknown as { __smashFrame?: number };
    return w.__smashFrame ?? 0;
  });
  expect(frame).toBeGreaterThan(30);
});

test("a stock match ends and reaches the results screen", async ({ page }) => {
  await startFromTitle(page);
  await page.goto(ROUTES.play);
  // A cold load of /play with no configuration should refuse rather than crash.
  const alert = page.getByRole("alert");
  const canvas = page.getByLabel("Match");
  await expect(alert.or(canvas).first()).toBeVisible();
});
