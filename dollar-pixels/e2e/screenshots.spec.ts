import { test } from "@playwright/test";
import { WALL, dragBlocks, signIn, waitForGrid } from "./helpers";

/**
 * Documentation tooling, not part of the suite.
 *
 * Gated on CAPTURE so a normal run never writes files. Driven by Playwright so
 * the images in the README are of the thing actually running, and can be
 * regenerated when it changes:
 *
 *   CAPTURE=1 npx playwright test screenshots --project=desktop-chrome
 */
const CAPTURE = process.env.CAPTURE === "1";
const DIR = "docs/screenshots";

test.skip(!CAPTURE, "set CAPTURE=1 to write screenshots");

test.describe.configure({ mode: "serial" });

test("landing", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${DIR}/landing.png`, fullPage: true });
});

test("the wall", async ({ page }) => {
  await page.goto(WALL);
  await waitForGrid(page, "the-wall");
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${DIR}/the-wall.png` });
});

test("selecting blocks", async ({ page }) => {
  await page.goto(WALL);
  await waitForGrid(page, "the-wall");
  await signIn(page, "Ana Ruiz");
  await dragBlocks(page, { bx: 300, by: 300 }, { bx: 319, by: 311 });
  await page.getByLabel(/caption/i).fill("Harbour Lights Coffee");
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${DIR}/selecting.png` });
});

test("zoomed in", async ({ page }) => {
  await page.goto(WALL);
  await waitForGrid(page, "the-wall");
  await page.getByRole("button", { name: /zoom in/i }).click();
  await page.getByRole("button", { name: /zoom in/i }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${DIR}/zoomed.png` });
});

test("fake-money checkout", async ({ page }) => {
  await page.goto(WALL);
  await waitForGrid(page, "the-wall");
  await signIn(page, "Ana Ruiz");
  await dragBlocks(page, { bx: 330, by: 330 }, { bx: 337, by: 335 });
  await page.getByLabel(/caption/i).fill("Ninepin Bowling");
  await page.getByRole("button", { name: /buy for/i }).click();
  await page.waitForURL(/\/checkout\/mock\//);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${DIR}/checkout.png`, fullPage: true });
});

test("making a page", async ({ page }) => {
  await page.goto("/new");
  await signIn(page, "Esi Boateng");
  await page.getByRole("radio", { name: /premium page/i }).check();
  await page.getByLabel(/title/i).fill("Esi's wall");
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${DIR}/new-page.png`, fullPage: true });
});

test("the directory", async ({ page }) => {
  await page.goto("/pages");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${DIR}/directory.png`, fullPage: true });
});
