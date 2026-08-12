import { expect, test } from "@playwright/test";
import { P1, readFighters, startFromTitle, startMatchFromMenu } from "./helpers";

/**
 * Does rebinding a key actually change which key plays the game?
 *
 * The controls screen had a full per-player rebinding UI — pick a preset per
 * port, click an action, press a key, watch the diagram redraw — and the match
 * ignored all of it. `schemeForMenuId` returned the factory preset and never
 * saw the store, so a player could rebind every key in the game, start a match,
 * and find the original keys still driving their fighter.
 *
 * It is the same shape as the dead-keyboard bug that shipped before it: a
 * layer that is correct in isolation, wired to nothing. The unit tests for the
 * store passed, the unit tests for the input layer passed, the controls screen
 * rendered exactly what it was asked to. The only test that could have caught
 * it is one that presses the *new* key and looks at the fighter, so that is
 * what this is.
 *
 * Everything here has to happen inside one page session. The match
 * configuration lives in a client-side store, so a `page.goto` between the
 * rebinding and the match would reset it and the test would pass against a
 * game that had quietly gone back to the defaults.
 */

/** A key that no preset claims, so it cannot pass by coincidence. */
const NEW_RIGHT = "KeyM";

test("a rebound key drives the fighter, and the old one stops", async ({ page }) => {
  await startFromTitle(page);

  await page.getByRole("link", { name: /controls/i }).click();
  await page.waitForURL("**/controls");

  // Rebind Config 1's "right".
  await page.getByRole("button", { name: /^Rebind Right/i }).click();
  await page.keyboard.press(NEW_RIGHT);
  await expect(page.getByRole("button", { name: /^Rebind Right, currently M$/i })).toBeVisible();

  await page.getByRole("button", { name: /back to the main menu/i }).click();
  await page.waitForURL("**/menu");
  await startMatchFromMenu(page);

  // Which action states the fighter passes through while a key is held.
  //
  // Sampled rather than measured as displacement, because displacement is not
  // this test's business: a fighter still decelerating out of the previous
  // hold, or shoved by the CPU, moves several units with no input at all, and
  // the first draft of this test failed on exactly that. Whether a *walk*
  // started has one cause.
  async function statesWhileHolding(code: string): Promise<Set<string>> {
    const seen = new Set<string>();
    await page.keyboard.down(code);
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(60);
      seen.add((await readFighters(page))[0].action);
    }
    await page.keyboard.up(code);
    return seen;
  }

  const moving = /^(walk|dashStart|run)$/;

  // The old key first, from a standstill at the start of the match, before the
  // CPU has crossed the stage to interfere.
  const onOldKey = await statesWhileHolding(P1.right);
  expect(
    [...onOldKey].filter((a) => moving.test(a)),
    `the unbound key still moved the fighter: ${[...onOldKey].join(", ")}`,
  ).toEqual([]);

  const startX = (await readFighters(page))[0].x;
  const onNewKey = await statesWhileHolding(NEW_RIGHT);

  // And the positive half, without which "nothing moves" would pass the test
  // above just as well as a correct rebinding does.
  expect(
    [...onNewKey].some((a) => moving.test(a)),
    `the rebound key did nothing: ${[...onNewKey].join(", ")}`,
  ).toBe(true);
  expect((await readFighters(page))[0].x).toBeGreaterThan(startX);
});
