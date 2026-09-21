import { expect, test, type Page } from "@playwright/test";

/**
 * S5's e2e spec (SPEC §11 `e2e/random.spec.ts`, §7 `/random` and `/hotseat`).
 *
 * Re-declares the debug handle and routes locally rather than importing
 * from `src/**`, per `super-smash/e2e/helpers.ts`'s documented reasoning:
 * an e2e spec should fail if the *real* app breaks the contract, not merely
 * because a shared import moved. `window.__islandDebug` is S2's contract
 * (SPEC §11): `state()` returns the live `GameState`, exposed only outside
 * production.
 *
 * This spec is written against the SPEC contract; the engine's random-map
 * generator (S1's `src/engine/generator/`) and the in-game screen (S2's
 * `/play/session`) are built concurrently by other slices, so this spec is
 * not run from this session — the parent runs the full Playwright suite
 * once every slice has landed.
 */

interface DebugPlayerState {
  index: number;
  kind: "human" | "ai";
  eliminated: boolean;
}

interface DebugGameState {
  activePlayerIndex: number;
  turnNumber: number;
  outcome: { winner: number } | null;
  players: DebugPlayerState[];
}

interface IslandDebug {
  state(): DebugGameState;
  applyForTest(action: unknown): void;
}

/**
 * Read the debug handle through a cast rather than a `declare global`
 * augmentation: `e2e/helpers.ts` owns the canonical `Window.__islandDebug`
 * type, and two augmentations with different shapes fail `tsc`.
 */

/**
 * Drives the setup screen's seat-count stepper to exactly `count`, whatever
 * the page's default is (random: 4, hot-seat: 2) — SPEC §7 "2–8 seats".
 */
async function setSeatCount(page: Page, count: number) {
  let current = Number(await page.getByTestId("seat-count").textContent());
  while (current > count) {
    await page.getByTestId("seat-count-decrease").click();
    current -= 1;
  }
  while (current < count) {
    await page.getByTestId("seat-count-increase").click();
    current += 1;
  }
  await expect(page.getByTestId("seat-count")).toHaveText(String(count));
}

async function waitForDebugHandle(page: Page) {
  await expect
    .poll(() => page.evaluate(() => Boolean((window as unknown as { __islandDebug?: unknown }).__islandDebug)), { timeout: 15_000 })
    .toBe(true);
}

test.describe("random map setup and play", () => {
  test("seed 42 vs one Normal AI runs 20 turns with no thrown error or stuck state", async ({
    page,
  }) => {
    // Twenty rounds against a Normal AI take ~3 s each once its provinces
    // grow, so the default 30 s budget is not enough for the flow itself.
    test.setTimeout(180_000);
    const pageErrors: Error[] = [];
    page.on("pageerror", (error) => pageErrors.push(error));

    await page.goto("/random");

    // Seat 0 human vs. one AI seat (default AI difficulty is Normal).
    await setSeatCount(page, 2);
    await expect(page.getByTestId("seat-1-kind")).toHaveText("Human");
    await expect(page.getByTestId("seat-2-kind")).toHaveText("AI");
    await expect(page.getByTestId("seat-2-difficulty")).toHaveValue("normal");

    await page.getByTestId("seed-input").fill("42");

    await page.getByTestId("play").click();
    await page.waitForURL("**/play/session");

    await waitForDebugHandle(page);

    let state = await page.evaluate(() => (window as unknown as { __islandDebug: IslandDebug }).__islandDebug.state());
    expect(state).toBeTruthy();

    for (let turn = 1; turn <= 20; turn++) {
      if (state.outcome) break;

      await page.getByTestId("next-day-button").click();

      // Wait for the AI seat(s) to finish and the human turn to come back —
      // or for the game to end. A passive human can lose to a Normal AI
      // inside 20 turns; that is the rules working, not a stuck state.
      await expect
        .poll(
          async () => {
            const snapshot = await page.evaluate(() => {
              const d = (window as unknown as { __islandDebug: IslandDebug & { ui(): { aiPlaying: boolean } } }).__islandDebug;
              const s = d.state();
              return { s, aiPlaying: d.ui().aiPlaying };
            });
            state = snapshot.s;
            return state.outcome !== null || (!snapshot.aiPlaying && state.players[state.activePlayerIndex]?.kind === "human");
          },
          { message: `human turn back (or game over) after Next Day #${turn}`, timeout: 20_000 },
        )
        .toBe(true);

      expect(pageErrors, `no thrown error through Next Day #${turn}`).toHaveLength(0);
    }

    expect(pageErrors).toHaveLength(0);
  });
});

test.describe("hot-seat hand-off", () => {
  test("two humans shows the hand-off screen at the first turn boundary", async ({ page }) => {
    await page.goto("/hotseat");

    await setSeatCount(page, 2);
    await expect(page.getByTestId("seat-1-kind")).toHaveText("Human");
    await expect(page.getByTestId("seat-2-kind")).toHaveText("Human");

    await page.getByTestId("seed-input").fill("42");

    await page.getByTestId("play").click();
    await page.waitForURL("**/play/session");

    await waitForDebugHandle(page);

    // Hot-seat hides the board behind the hand-off overlay from the very
    // first turn, so the first player must take the device before playing.
    await expect(page.getByTestId("handoff-overlay")).toBeVisible();
    await page.getByTestId("handoff-continue").click();
    await expect(page.getByTestId("handoff-overlay")).toHaveCount(0);

    await page.getByTestId("next-day-button").click();

    await expect(page.getByTestId("handoff-overlay")).toBeVisible();
    await expect(page.getByTestId("handoff-continue")).toBeVisible();

    await page.getByTestId("handoff-continue").click();
    await expect(page.getByTestId("handoff-overlay")).toBeHidden();
  });
});
