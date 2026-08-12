import { expect, test } from "@playwright/test";
import { ROUTES } from "./helpers";

/**
 * The controls screen, and the one property of it that is not obvious.
 *
 * Config 1 and Config 2 are mirror images, which means six physical keys carry
 * opposite meanings between them. That is arithmetic, not a bug — a `keydown`
 * event reports a key, not a finger — so the product has to *say* so rather than
 * let two people discover it mid-match. These tests hold it to that.
 */

test("both control schemes are documented on the controls screen", async ({ page }) => {
  await page.goto(ROUTES.controls);

  // Every action in Config 1, by the key a player would actually press.
  for (const key of ["A", "D", "Q", "E", "W"]) {
    await expect(page.getByText(key, { exact: true }).first()).toBeVisible();
  }
  await expect(page.getByLabel("Keyboard diagram").first()).toBeVisible();
});

test("the screen explains why the two schemes cannot be used together", async ({ page }) => {
  await page.goto(ROUTES.controls);
  const body = await page.locator("body").innerText();

  // Not asserting exact copy — asserting that the collision is disclosed at all.
  // A build that quietly dropped this explanation would ship a game where two
  // players on one keyboard fight each other's inputs with no way to find out why.
  expect(body.toLowerCase()).toMatch(/mirror|same key|conflict|cannot be used together|share/);
});

test("a third preset exists for two players on one keyboard", async ({ page }) => {
  await page.goto(ROUTES.controls);
  const body = await page.locator("body").innerText();
  expect(body).toMatch(/config 3|local p2|two players|second player/i);
});
