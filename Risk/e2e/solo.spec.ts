import { expect, test } from "@playwright/test";

import {
  ROUTES,
  SEL,
  actingSeat,
  claimIdentity,
  humanSeats,
  ownedBy,
  playHumanTurn,
  readState,
  startSolo,
  troopsOf,
  uniqueName,
  visit,
  waitForHumanTurn,
  watchErrors,
} from "./helpers";

/**
 * **T10.2 — a solo game against one bot, played to victory through the HUD**
 * (SPEC §11).
 *
 * Every assertion reads `window.__riskDebug.state()`, never the canvas:
 * pixels can only tell you something was painted, not whether the simulation
 * moved.
 *
 * Two deviations from §11's wording, both forced and both recorded as D104:
 *
 *  - **The board is `south-america` (20 territories), not `tiny4`.** The four
 *    engine fixtures are deliberately absent from the map picker (D39), and
 *    the offline play route reads a client-side store that only the picker
 *    fills — so there is no honest way to reach `tiny4` by walking the menu,
 *    and walking the menu is the thing this test exists to exercise.
 *    `south-america` is the smallest board a player can actually choose.
 *  - **The win condition is Percentage Domination at its default 70%**, which
 *    is a first-class win condition (R71): 14 of 20, against a seat holding
 *    the other 10 (no neutral by default, D106). World Domination on the same board is the same
 *    evaluation code path with a much longer runtime, and runtime is what a
 *    suite that also has to stay green on a 412 px phone cannot spend.
 */

/**
 * One human, one Beginner bot, Percentage Domination **and Max Rounds**, on
 * the smallest real board.
 *
 * Two deliberate pins, for two different reasons:
 *
 *  - **Beginner, not the default Medium**, and that is the test's own
 *    admission: the greedy script in `playHumanTurn` is not a good Risk
 *    player — it drafts onto its biggest stack and blitzes the weakest
 *    neighbour — and a Medium bot beats it on this board.
 *  - **Max Rounds on**, as a backstop. Percentage Domination at 70% is
 *    fourteen of twenty territories, and two mediocre players can trade the
 *    same border back and forth without either reaching it; a run that ends
 *    with "no outcome after fourteen turns" is a slow test, not a bug found.
 *    The 5-Rounds Rumble guarantees the game *ends* — on territories, then
 *    troops, then the lowest seat index (R78) — so the spec can assert a
 *    lawful outcome in bounded time, and it exercises the Max-Rounds ladder
 *    and its `tiebreak: true` flag into the bargain.
 */
const SOLO = {
  map: "south-america",
  seats: 2,
  modifiers: ["percentage-domination", "max-rounds"] as const,
  rules: [["ai-difficulty", "beginner"]] as const,
} as const;

/** The same board under the default World Domination, for the resume test. */
const WORLD = { map: "south-america", seats: 2 } as const;

test("T10.2 — a solo game against one bot is played to victory through the HUD", async ({ page }) => {
  // A whole game through the HUD, one tap at a time, with a camera pan for
  // every territory the board does not already have on screen. The default
  // 30 s is nowhere near it, and `test.slow()`'s 90 s only sometimes is.
  test.setTimeout(300_000);
  const errors = watchErrors(page);

  await claimIdentity(page, uniqueName("Solo"));
  await startSolo(page, SOLO);

  const opening = await readState(page);
  const me = humanSeats(opening)[0]!;

  // The opening, as R5 deals it with the neutral holding OFF (D106, the default): two seats
  // splitting the whole board evenly, and no neutral territory anywhere.
  expect(opening.seats, "two seats").toHaveLength(2);
  expect(opening.seats.map((s) => s.kind).sort()).toEqual(["bot", "human"]);
  expect([...opening.turnOrder].sort()).toEqual([0, 1]);
  expect(opening.territories).toHaveLength(20);
  expect(opening.rules.neutralHolding, "the neutral is opt-in (D106)").toBe(false);
  expect(ownedBy(opening, me).length, "the human's pile").toBe(10);
  expect(ownedBy(opening, -2).length, "no neutral holding by default").toBe(0);
  expect(opening.rules.winCondition).toBe("percentage");
  expect(opening.rules.dominationThreshold, "70% is the default (D60)").toBeCloseTo(0.7, 10);
  expect(opening.rules.maxRounds, "the 5-Rounds Rumble preset (D59)").toBe(5);
  expect(opening.fogged, "offline state is authoritative, never a view").toBe(false);

  // 70% of twenty playable territories is fourteen; the human starts on seven.
  const target = Math.ceil(opening.rules.dominationThreshold * opening.territories.length);
  expect(target).toBe(14);

  // ---- play, turn by turn, until somebody wins ---------------------------
  let final = opening;
  let turnsPlayed = 0;
  let bestHeld = ownedBy(opening, me).length;
  for (let turn = 0; turn < 14; turn += 1) {
    final = await playHumanTurn(page, 16);
    turnsPlayed += 1;
    bestHeld = Math.max(bestHeld, ownedBy(final, me).length);
    if (final.outcome) break;
    // The HUD must hand the turn back: a game that never returns to the human
    // is the bot runner wedged, which is a failure and not a slow turn.
    final = await waitForHumanTurn(page);
    bestHeld = Math.max(bestHeld, ownedBy(final, me).length);
    if (final.outcome) break;
  }

  // ---- the game ended, and it ended by the rules -------------------------
  //
  // **Which** seat wins is not asserted, and that is deliberate rather than
  // weak. The offline seed is minted per game (`newId()`; `RISK_FIXED_SEED` is
  // the server's, for online games), the dice are real, and the greedy driver
  // in `playHumanTurn` is a mediocre Risk player — so a Beginner bot takes a
  // board often enough that pinning the winner would make this spec a coin
  // flip dressed as an assertion. What T10.2 is actually for is that the HUD
  // alone can carry a game from the menu to a finished outcome, and that the
  // screen agrees with the simulation about how it finished. Both are checked
  // exactly; the human's own conquests are checked separately, below.
  expect(final.outcome, `no outcome after ${turnsPlayed} human turns`).not.toBeNull();
  const outcome = final.outcome!;
  expect([0, 1], "the neutral holding can never win (R7)").toContain(outcome.winner);
  expect(final.phase, "the reducer parks a finished game in `over`").toBe("over");
  expect(outcome.round).toBeGreaterThanOrEqual(1);

  // Two lawful endings are possible with these rules, and the two carry
  // different claims — so each is checked on its own terms rather than being
  // flattened into "the game ended".
  expect(["percentage", "maxRounds"]).toContain(outcome.reason);
  if (outcome.reason === "percentage") {
    expect(outcome.tiebreak, "a conquest is never a tiebreak").toBe(false);
    expect(
      ownedBy(final, outcome.winner).length,
      "a percentage win means the winner is over the threshold",
    ).toBeGreaterThanOrEqual(target);
  } else {
    expect(outcome.tiebreak, "every Max-Rounds outcome is a tiebreak (R78)").toBe(true);
    expect(outcome.round, "the round limit was reached").toBeGreaterThanOrEqual(5);
    // Most territories, then most troops, then the lowest seat index.
    const loser = outcome.winner === 0 ? 1 : 0;
    const held = ownedBy(final, outcome.winner).length;
    const theirs = ownedBy(final, loser).length;
    expect(
      held > theirs ||
        (held === theirs && troopsOf(final, outcome.winner) >= troopsOf(final, loser)),
      `the ladder picked seat ${outcome.winner} on ${held} v ${theirs} territories`,
    ).toBe(true);
  }

  // The HUD's own attacks took ground: the human ends or passes through more
  // territories than it was dealt. Without this the test above could pass on
  // a game the human merely watched.
  expect(bestHeld, "the human captured at least one territory through the HUD").toBeGreaterThan(7);

  // ---- and the screen says so -------------------------------------------
  const victory = page.locator(SEL.victory);
  await victory.waitFor({ timeout: 15_000 });
  await expect(victory.locator(SEL.victoryName)).toHaveText(final.seats[outcome.winner]!.name);
  // The tiebreak line ("Most territories at the end of round 5") appears for a
  // Max-Rounds win and for nothing else, so the screen and the outcome have to
  // agree about which kind of ending this was.
  expect(
    await victory.locator(SEL.victoryTiebreak).count(),
    `the tiebreak line belongs to a Max-Rounds win only (reason=${outcome.reason})`,
  ).toBe(outcome.tiebreak ? 1 : 0);

  expect(errors, "no page errors and no desync").toEqual([]);
});

test("T10.2b — walking back into the same configuration resumes the autosaved game", async ({ page }) => {
  // A whole game through the HUD, one tap at a time, with a camera pan for
  // every territory the board does not already have on screen. The default
  // 30 s is nowhere near it, and `test.slow()`'s 90 s only sometimes is.
  test.setTimeout(300_000);
  const errors = watchErrors(page);
  const name = uniqueName("Resume");

  await claimIdentity(page, name);
  await startSolo(page, WORLD);

  const opening = await readState(page);
  const me = humanSeats(opening)[0]!;
  expect(opening.rules.winCondition, "the default is World Domination").toBe("world");

  // One complete turn with **no attacks**, so the runner has written an
  // autosave and the game is certainly still running: the envelope is
  // persisted after every `END_TURN` and carries the seed, because a resumed
  // session has to keep drawing from the same sub-streams (D5).
  await playHumanTurn(page, 0);
  const saved = await waitForHumanTurn(page);
  expect(saved.outcome, "a turn with no attacks cannot have ended the game").toBeNull();
  expect(saved.turn, "the game has moved past the opening").toBeGreaterThan(0);

  const ownershipBefore = saved.territories.map((t) => t.owner);
  const seatsBefore = saved.seats.map((s) => `${s.kind}:${s.name}:${s.colour}`);

  // A reload wipes the setup store, so `/play/solo` bounces to `/new` — which
  // is the real behaviour, and the reason resuming means *re-choosing the same
  // configuration*. `sourceKey` hashes the map, the seats and the rules, so an
  // identical walk finds the same `risk:session:v1:<sourceKey>` entry.
  await page.reload({ waitUntil: "domcontentloaded" });
  await visit(page, ROUTES.solo);
  await page.locator(SEL.gameTypeScreen).waitFor({ timeout: 20_000 });

  await visit(page, ROUTES.home);
  await expect(page.locator(SEL.homeName), "the claimed name is cached locally").toHaveText(name);
  await startSolo(page, WORLD);

  const resumed = await readState(page);
  expect(resumed.turn, "a fresh deal would be back at turn 0").toBe(saved.turn);
  expect(resumed.round).toBe(saved.round);
  expect(resumed.territories.map((t) => t.owner)).toEqual(ownershipBefore);
  expect(resumed.seats.map((s) => `${s.kind}:${s.name}:${s.colour}`)).toEqual(seatsBefore);
  expect(actingSeat(resumed), "and it is still the human's turn").toBe(me);

  expect(errors, "no page errors and no desync").toEqual([]);
});
