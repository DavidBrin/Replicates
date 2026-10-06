import { expect, test, type Page } from "@playwright/test";

import {
  CLICK,
  SEL,
  actingSeat,
  claimIdentity,
  dismissOverlays,
  humanSeats,
  ownedBy,
  playHumanTurn,
  readState,
  startSolo,
  uniqueName,
  watchErrors,
} from "./helpers";

/**
 * **T10.3 — the Pass & Play hand-off, with fog respected** (SPEC §11, §5.4).
 *
 * Three things are checked, and the third is the one that matters: a hot-seat
 * game on one device is only honest if the outgoing player cannot read the
 * incoming player's board. So the overlay must appear between human turns, the
 * board must be **concealed** rather than merely covered, and the two seats'
 * views must genuinely differ.
 *
 * **The board is `classic-world` with six seats, not `mini` with two**, and
 * both halves of that are forced:
 *
 *  - The four engine fixtures are deliberately absent from the map picker
 *    (D39) and the offline route reads a store only the picker fills, so a
 *    fixture board cannot be reached by walking the menu (D82).
 *  - **Fog is only observable when seats are small.** A tile is hidden when
 *    the viewer neither occupies it nor borders it, so the seat count is what
 *    decides whether fog exists on screen at all. Two seats on Classic hold
 *    fourteen territories each — scattered by the deal, they and their
 *    neighbours cover all forty-two, and every fog assertion would pass over
 *    an empty set. That is not a bug; it is what R73 says. Six seats hold
 *    seven each and roughly a third of the board is dark. Six also makes the
 *    hand-off the common case rather than an edge one.
 *
 * `__riskDebug.state()` is the **authoritative** state here, not a view —
 * offline the session runner is the authority and the handle hands back
 * `confirmedState` (§4.15, F42). Fog therefore cannot be read from it, and
 * should not be: what this spec has to check is what the *screen* shows, so
 * the fog assertions read the board's own `data-owner`, which
 * `src/render/board.ts` paints as `unknown` for a tile the viewer may not see.
 */

const PASS_AND_PLAY = {
  map: "classic-world",
  mode: "pass-and-play",
  seats: 6,
  modifiers: ["fog-of-war"],
} as const;

/** The territories the board is currently painting as hidden (`SEAT_UNKNOWN`). */
async function hiddenTerritories(page: Page): Promise<number[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-territory][data-owner="unknown"]')]
      .map((node) => Number(node.getAttribute("data-territory")))
      .sort((a, b) => a - b),
  );
}

/** Which seat's fog and HUD the screen is showing, straight off `GameScreen`. */
async function viewerSeat(page: Page): Promise<number> {
  return Number(await page.locator(SEL.gameScreen).getAttribute("data-viewer-seat"));
}

/**
 * Assert the hand-off is doing its job, then press CONTINUE.
 *
 * The overlay "never dismisses itself and never touches game state" (§7.2), so
 * the press is the only thing that lifts it — which is exactly the property
 * that makes it safe: there is no timeout after which the next player's board
 * appears while the previous one is still looking at the screen.
 */
async function handOverDevice(page: Page): Promise<number> {
  const overlay = page.locator(SEL.handOff);
  await overlay.waitFor({ timeout: 90_000 });
  const outgoing = await viewerSeat(page);

  await expect(overlay).toHaveAttribute("role", "dialog");
  await expect(overlay).toHaveAttribute("aria-modal", "true");

  const state = await readState(page);
  const incoming = actingSeat(state);
  await expect(overlay.locator(SEL.handOffName)).toHaveText(state.seats[incoming]!.name);

  // Concealed, not merely covered: `BoardCanvas` stops painting entirely and
  // the stage is `visibility: hidden`, so there is nothing behind the overlay
  // to screenshot, inspect in the DOM or read a troop count off.
  const stage = page.locator(SEL.boardStage);
  await expect(stage).toHaveAttribute("data-hidden", "true");
  expect(
    await stage.evaluate((node) => getComputedStyle(node).visibility),
    "the stage is hidden, not just overlaid",
  ).toBe("hidden");
  expect(
    await page.locator(SEL.actionBar).count(),
    "the HUD goes with it — no prompt, no phase label, no primary pill",
  ).toBe(0);
  expect(await page.locator(SEL.roster).count(), "and no roster to read troop counts off").toBe(0);

  // **The incoming seat's board does not exist yet.** The viewer is still the
  // outgoing player's seat for as long as the overlay is up, so the only
  // ownership in the DOM behind it is the view that player was already
  // allowed to see — never the fog the next player is about to be shown.
  // That invariant, not the opacity of the overlay, is what makes the
  // hand-off safe (§5.4).
  //
  // Stated as "the viewer has not moved" rather than "the viewer is not the
  // incoming seat", because at the **first** hand-off they can legitimately
  // be the same number: the viewer starts at seat 0 and the seed may well
  // have put seat 0 first.
  expect(
    await viewerSeat(page),
    "the viewer has not advanced while the overlay is up",
  ).toBe(outgoing);

  await overlay.locator(SEL.handOffContinue).click(CLICK);
  await overlay.waitFor({ state: "hidden", timeout: 15_000 });
  await expect(stage).toHaveAttribute("data-hidden", "false");
  await expect
    .poll(() => viewerSeat(page), {
      timeout: 15_000,
      message: "the viewer never became the incoming seat",
    })
    .toBe(incoming);
  await dismissOverlays(page);
  return incoming;
}

/** Wait until the board has actually been repainted for the current viewer. */
async function paintedBoard(page: Page): Promise<number[]> {
  await expect
    .poll(
      () =>
        page.evaluate(
          () => document.querySelectorAll('[data-territory]:not([data-owner="none"])').length,
        ),
      { timeout: 20_000, message: "the board never repainted after the hand-off" },
    )
    .toBeGreaterThan(0);
  return hiddenTerritories(page);
}

test("T10.3 — the hand-off conceals the board between two human seats, and fog follows the viewer", async ({
  page,
}) => {
  // A whole game through the HUD, one tap at a time, with a camera pan for
  // every territory the board does not already have on screen. The default
  // 30 s is nowhere near it, and `test.slow()`'s 90 s only sometimes is.
  test.setTimeout(300_000);
  const errors = watchErrors(page);

  await claimIdentity(page, uniqueName("Hotseat"));
  await startSolo(page, PASS_AND_PLAY);

  const opening = await readState(page);
  expect(opening.seats, "six seats").toHaveLength(6);
  expect(humanSeats(opening), "Pass & Play fills every seat with a human").toEqual([0, 1, 2, 3, 4, 5]);
  expect(opening.rules.fogOfWar, "Fog of War is on").toBe(true);
  expect(opening.territories).toHaveLength(42);
  expect(ownedBy(opening, -2), "six seats means no neutral holding (R5)").toEqual([]);

  // The very first turn is already a hand-off unless the seed happened to put
  // seat 0 first: the viewer starts at 0 and the acting seat comes out of the
  // shuffled turn order — the case nothing in this suite may assume away.
  const first = await handOverDevice(page);
  expect(first, "the first hand-off is to the seat the seed put first").toBe(actingSeat(opening));

  // ---- the outgoing seat's view -----------------------------------------
  const hiddenFromFirst = await paintedBoard(page);
  expect(
    hiddenFromFirst.length,
    "a seat holding seven of forty-two cannot see the whole board (R73)",
  ).toBeGreaterThan(0);
  for (const own of ownedBy(opening, first)) {
    expect(hiddenFromFirst, `seat ${first} can always see its own ${own}`).not.toContain(own);
  }
  // A hidden tile shows `?` rather than a count (R73, F52).
  const hiddenCounts = await page.evaluate(
    (ids) => ids.map((id) => document.querySelector(`[data-token="${id}"] .troops`)?.textContent ?? null),
    hiddenFromFirst.slice(0, 4),
  );
  for (const text of hiddenCounts) expect(text, "a hidden troop count reads ?").toBe("?");

  // ---- play that seat's turn, so the device has to change hands ----------
  await playHumanTurn(page, 2);

  // ---- the hand-off between two human turns, and the next seat's fog ----
  const second = await handOverDevice(page);
  expect(second, "the device went to a different seat").not.toBe(first);

  const hiddenFromSecond = await paintedBoard(page);
  expect(hiddenFromSecond.length, "the incoming seat has fog of its own").toBeGreaterThan(0);
  expect(
    hiddenFromSecond,
    "the two seats do not see the same board — which is the whole point of the hand-off",
  ).not.toEqual(hiddenFromFirst);

  const afterHandOff = await readState(page);
  for (const own of ownedBy(afterHandOff, second)) {
    expect(hiddenFromSecond, `seat ${second} can always see its own ${own}`).not.toContain(own);
  }

  // The outgoing seat's holdings are hidden from the incoming one except where
  // the incoming seat already borders them — R73 exactly, and the assertion
  // that would fail if `viewFor` were skipped on a hand-off.
  const firstHoldings = ownedBy(afterHandOff, first);
  const shownOfFirst = firstHoldings.filter((t) => !hiddenFromSecond.includes(t));
  expect(
    shownOfFirst.length,
    `seat ${second} must not be shown all ${firstHoldings.length} of seat ${first}'s territories`,
  ).toBeLessThan(firstHoldings.length);

  expect(errors, "no page errors and no desync").toEqual([]);
});
