import { expect, test, type Page, type TestInfo } from "@playwright/test";

import {
  API,
  ROUTES,
  CLICK,
  SEL,
  actingSeat,
  apiJson,
  blitzFrom,
  draftOnce,
  claimIdentity,
  dismissOverlays,
  findTerritoryPoint,
  humanSeats,
  onlineDebug,
  ownedBy,
  playHumanTurn,
  postAction,
  pressPrimary,
  readState,
  resolveMoveIn,
  revealTerritory,
  selectTerritory,
  startSolo,
  tradeIfForced,
  sync,
  uniqueName,
  visit,
  waitForHumanTurn,
  waitForState,
  type GameSyncBody,
} from "./helpers";

/**
 * **T10.5 — the README's images, captured from the running game.**
 *
 * Not part of the suite: gated behind `CAPTURE=1` so an ordinary
 * `pnpm run test:e2e` never writes a file. It is documentation tooling that
 * happens to be written in Playwright, and it is written in Playwright for
 * one reason — the images in the README are then provably of the thing that
 * actually runs, and regenerating them after a visual change is one command
 * rather than an afternoon.
 *
 *   CAPTURE=1 pnpm exec playwright test screenshots --project=desktop-chrome
 *   CAPTURE=1 pnpm exec playwright test screenshots --project=mobile-chrome
 *
 * **Every shot waits for state truth, never for a fixed delay** (SPEC §11
 * T10.5). The board paints from a dirty flag outside React and the dice,
 * awards and overlays all animate, so "wait 500 ms and hope" photographs
 * half-faded popups and empty boards. Each shot below waits for the
 * simulation to be in the state the picture is supposed to show — the dice
 * resolved and both troop counts updated, the card in hand, the outcome
 * decided — and only then presses the shutter.
 */

const CAPTURE = process.env.CAPTURE === "1";

test.describe.configure({ mode: "serial" });

test.skip(!CAPTURE, "Screenshot capture only runs with CAPTURE=1");

/** §7's geometry is measured at 1600×900, so that is what the desktop shots are. */
const DESKTOP = { width: 1600, height: 900 } as const;

/** The three the README shows as phone shots; the rest are desktop-only. */
const MOBILE_SHOTS = new Set(["home", "map-picker", "solo-draft"]);

function shot(name: string, info: TestInfo): string {
  const mobile = info.project.name === "mobile-chrome";
  return `docs/screenshots/${name}${mobile ? "-mobile" : ""}.png`;
}

/** Take one shot, unless this project does not publish that image. */
async function capture(page: Page, name: string, info: TestInfo): Promise<void> {
  if (info.project.name === "mobile-chrome" && !MOBILE_SHOTS.has(name)) return;
  await page.screenshot({ path: shot(name, info) });
}

/** True when this project has nothing to capture in a given group of shots. */
function skipUnlessWanted(names: readonly string[], info: TestInfo): boolean {
  if (info.project.name !== "mobile-chrome") return false;
  return !names.some((name) => MOBILE_SHOTS.has(name));
}

/** The desktop projects shoot at the measured 1600×900; the phone keeps its own. */
async function sizeFor(page: Page, info: TestInfo): Promise<void> {
  if (info.project.name !== "mobile-chrome") await page.setViewportSize({ ...DESKTOP });
}

/**
 * Walk the turn forward until the fortify phase (or the game ending).
 *
 * Reacts to the phase rather than pressing a fixed number of times, for the
 * same reason `playHumanTurn` does: the phase can go *backwards* when a
 * seizure forces a trade-down (R27), and a pending move-in blocks everything
 * until it is resolved (R62).
 */
async function advanceToFortify(page: Page): Promise<void> {
  for (let step = 0; step < 10; step += 1) {
    const state = await readState(page);
    if (state.outcome || state.phase === "fortify") return;
    if (state.pendingMoveIn) {
      await resolveMoveIn(page);
      continue;
    }
    if (await tradeIfForced(page)) continue;
    if (state.phase === "draft") {
      if (state.troopsToPlace > 0) await draftOnce(page);
      else await pressPrimary(page);
      continue;
    }
    if (state.phase === "attack") {
      await pressPrimary(page);
      continue;
    }
    return;
  }
}

/** One human against one Beginner bot on the smallest board a player can pick. */
const GAME = {
  map: "south-america",
  seats: 2,
  rules: [["ai-difficulty", "beginner"]] as const,
} as const;

test("the menus: home, game type, map picker, rules", async ({ page }, info) => {
  test.setTimeout(180_000);
  await sizeFor(page, info);

  await claimIdentity(page, uniqueName("Commander"), "red");
  // The sunburst behind the portrait is owner-coloured and the ghost map is a
  // static SVG, so the only thing to wait for is the claimed name landing.
  await expect(page.locator(SEL.homeName)).toHaveText(/\S/);
  await capture(page, "home", info);

  await page.locator(SEL.homeBattle).click(CLICK);
  await page.locator(SEL.gameTypeScreen).waitFor();
  await page.locator(SEL.gameType("solo")).click(CLICK);
  // A selected card grows a tick and a sparkle; shoot once it says it is on.
  await expect(page.locator(SEL.gameType("solo"))).toHaveAttribute("aria-checked", "true");
  await capture(page, "game-type", info);

  await page.locator(SEL.newBattle).click(CLICK);
  await page.locator(SEL.mapPickerScreen).waitFor();
  // Every tile loads its board through its own `import()`, so the grid is full
  // of skeletons until they resolve — wait for the taglines, which only exist
  // once a map file has been parsed.
  await expect
    .poll(
      () =>
        page
          .locator('[data-testid="map-tile-tagline"]')
          .evaluateAll((nodes) => nodes.filter((n) => /territories/.test(n.textContent ?? "")).length),
      { timeout: 60_000, message: "the map tiles never finished loading" },
    )
    .toBeGreaterThan(6);
  await page.locator(SEL.mapTile("classic-world")).click(CLICK);
  await capture(page, "map-picker", info);

  await page.locator(SEL.mapNext).click(CLICK);
  await page.locator(SEL.rulesScreen).waitFor();
  await page.locator(SEL.modifier("fog-of-war")).click(CLICK);
  await page.locator(SEL.modifier("capitals")).click(CLICK);
  await expect(page.locator(SEL.rulesReadout)).toContainText("Dice Rolls");
  await capture(page, "rules", info);
});

test("a solo game: the draft, a blitz, the cards and the fortify", async ({ page }, info) => {
  test.setTimeout(240_000);
  if (skipUnlessWanted(["solo-draft", "blitz", "cards", "fortify"], info)) test.skip();
  await sizeFor(page, info);

  await claimIdentity(page, uniqueName("Commander"), "red");
  await startSolo(page, GAME);
  const opening = await waitForHumanTurn(page);
  const me = humanSeats(opening)[0]!;

  /* ---- the draft, with the count slider open -------------------------- */
  //
  // The shot the README leads with: the board owner-coloured, the roster down
  // the right edge, and the `Deploy Troops` slider showing the notched ring.
  // Prefer a territory that is tappable **without moving the camera**: the
  // panning and zooming `revealTerritory` does to reach an awkward tile is
  // fine for a test and wrong for a photograph, because it leaves the board
  // cropped. Only fall back to it if nothing is reachable as the board sits.
  const mine = ownedBy(opening, me);
  let drafted = false;
  for (const pass of ["still", "move"] as const) {
    for (const territory of mine) {
      const point =
        pass === "still"
          ? await findTerritoryPoint(page, territory)
          : await revealTerritory(page, territory).catch(() => null);
      if (!point) continue;
      await page.mouse.click(point.x, point.y);
      if (await page.locator(SEL.countSlider).isVisible().catch(() => false)) {
        drafted = true;
        break;
      }
    }
    if (drafted) break;
  }
  expect(drafted, "the draft slider never opened").toBe(true);
  await expect(page.locator(SEL.countSliderTitle)).toHaveText("Deploy Troops");
  await capture(page, "solo-draft", info);

  // The phone pass publishes this one shot and stops: the blitz takeover, the
  // card fan and the fortify HUD are desktop images in the README, and the
  // card fan in particular does not fit a 412 px viewport at all.
  if (info.project.name === "mobile-chrome") return;

  await page.keyboard.press("a");
  await page.locator(SEL.countConfirm).click(CLICK);
  await waitForState(page, (s) => s.troopsToPlace === 0, { message: "the draft never completed" });
  await page.locator(SEL.primary).click(CLICK); // End Draft Phase
  await waitForState(page, (s) => s.phase === "attack", { message: "never reached attack" });

  /* ---- the Blitz takeover, with the win chance resolved ---------------- */
  //
  // `blitz-win-chance` is computed from the odds table for the exact pair, so
  // its presence is the signal that the popup is showing a real battle rather
  // than a half-mounted one.
  let opened = false;
  for (const from of ownedBy(await readState(page), me)) {
    const state = await readState(page);
    if ((state.territories[from]?.troops ?? 0) < 2) continue;
    let targets: number[] = [];
    try {
      targets = await selectTerritory(page, from);
    } catch {
      continue;
    }
    if (targets.length === 0) continue;
    try {
      const point = await revealTerritory(page, targets[0]!);
      await page.mouse.click(point.x, point.y);
    } catch {
      continue;
    }
    if (await page.locator(SEL.blitzView).isVisible().catch(() => false)) {
      opened = true;
      break;
    }
  }
  expect(opened, "the Blitz view never opened").toBe(true);
  await expect(page.locator(SEL.blitzWinChance)).toHaveText(/%/);
  await expect(page.locator(SEL.blitzCommitted)).toHaveText(/\S/);
  await capture(page, "blitz", info);

  // Fight it, and wait for the **dice to have resolved**: the battle is only
  // photographable once the troop counts on both sides have moved, which is
  // the state change `blitzFrom`'s own wait is built on.
  await page.locator(SEL.blitzBattle).click(CLICK);
  await page.locator(SEL.blitzView).waitFor({ state: "hidden", timeout: 20_000 });
  await waitForState(page, (s) => s.phase === "attack" || s.pendingMoveIn !== null, {
    message: "the battle never resolved",
  });

  /* ---- a card in hand, and the trade panel ----------------------------- */
  //
  // A card is only awarded for a turn in which something was conquered (R20),
  // so the capture has to earn one: keep blitzing until the board changes
  // hands, then end the turn and come back.
  let conquered = (await readState(page)).conqueredThisTurn;
  for (let attempt = 0; attempt < 10 && !conquered; attempt += 1) {
    const state = await readState(page);
    if (state.outcome) break;
    const sources = ownedBy(state, me)
      .filter((t) => (state.territories[t]?.troops ?? 0) >= 2)
      .sort((a, b) => (state.territories[b]?.troops ?? 0) - (state.territories[a]?.troops ?? 0));
    let fought = false;
    for (const from of sources.slice(0, 4)) {
      const result = await blitzFrom(page, from);
      if (result.fought) {
        fought = true;
        break;
      }
    }
    if (!fought) break;
    conquered = (await readState(page)).conqueredThisTurn;
  }

  /* ---- the fortify phase ---------------------------------------------- */
  //
  // Not a single press: a conquest leaves a move-in pending and a seizure can
  // bounce the phase back to `draft` for a forced trade (R27), so getting to
  // fortify means reacting to whatever the board is in rather than assuming
  // one step.
  await advanceToFortify(page);
  if ((await readState(page)).phase === "fortify") {
    await expect(page.locator(SEL.phaseLabel)).toHaveText("FORTIFY");
    await capture(page, "fortify", info);
  }

  // End the turn; the card is awarded on the way out (R20).
  const atEnd = await readState(page);
  if (atEnd.phase === "fortify") {
    await page.locator(SEL.primary).click(CLICK);
    const confirm = page.locator(SEL.endTurnConfirm);
    if ((await confirm.count()) > 0) await confirm.locator(SEL.endTurnYes).click(CLICK);
  }

  if (conquered) {
    await waitForState(page, (s) => (s.seats[me]?.cardCount ?? 0) > 0 || s.outcome !== null, {
      timeout: 90_000,
      message: "a conquering turn awarded no card",
    });
    await waitForHumanTurn(page);
    await dismissOverlays(page);
    await page.locator(SEL.cardsChip).click(CLICK);
    await page.locator(SEL.cardTradePanel).waitFor({ timeout: 15_000 });
    await expect(page.locator(SEL.cardTradePanel).locator("[data-suit]").first()).toBeVisible();
    await capture(page, "cards", info);
  }
});

test("the victory overlay", async ({ page }, info) => {
  test.setTimeout(300_000);
  if (skipUnlessWanted(["victory"], info)) test.skip();
  await sizeFor(page, info);

  await claimIdentity(page, uniqueName("Commander"), "red");
  await startSolo(page, { ...GAME, modifiers: ["percentage-domination"] });

  let state = await readState(page);
  for (let turn = 0; turn < 14 && !state.outcome; turn += 1) {
    state = await playHumanTurn(page, 16);
    if (state.outcome) break;
    state = await waitForHumanTurn(page);
  }
  expect(state.outcome, "nobody won, so there is no overlay to photograph").not.toBeNull();

  // The overlay fans ~24 stars out over 240°; `victory-stars` existing is the
  // signal that it has mounted rather than that the game merely ended.
  const victory = page.locator(SEL.victory);
  await victory.waitFor({ timeout: 20_000 });
  await expect(victory.locator(SEL.victoryName)).toHaveText(/\S/);
  await expect(victory.locator('[data-testid="victory-stars"]')).toBeVisible();
  await capture(page, "victory", info);
});

test("the online lobby and an online game", async ({ browser }, info) => {
  test.setTimeout(240_000);
  if (skipUnlessWanted(["lobby", "online-game"], info)) test.skip();

  const context = await browser.newContext(
    info.project.name === "mobile-chrome" ? {} : { viewport: { ...DESKTOP } },
  );
  const other = await browser.newContext();
  const page = await context.newPage();
  const guest = await other.newPage();

  try {
    /* ---- the lobby browser, with a game in the list ------------------- */
    const host = uniqueName("Commander");
    await visit(page, ROUTES.lobby);
    const sheet = page.locator(SEL.identitySheet);
    await sheet.waitFor({ timeout: 30_000 });
    await sheet.locator(SEL.identityName).fill(host);
    await sheet.locator(SEL.identityColour("red")).click(CLICK);
    await sheet.locator(SEL.identityContinue).click(CLICK);
    await page.locator(SEL.lobbyBrowser).waitFor({ timeout: 30_000 });

    // A second player, so the Players column is not a one-line list and the
    // open-games list has something in it.
    await visit(guest, ROUTES.lobby);
    const guestSheet = guest.locator(SEL.identitySheet);
    await guestSheet.waitFor({ timeout: 30_000 });
    await guestSheet.locator(SEL.identityName).fill(uniqueName("Marshal"));
    await guestSheet.locator(SEL.identityColour("blue")).click(CLICK);
    await guestSheet.locator(SEL.identityContinue).click(CLICK);
    await guest.locator(SEL.lobbyBrowser).waitFor({ timeout: 30_000 });

    const created = await apiJson<{ code: string }>(guest.request, API.lobbies, {
      method: "POST",
      body: {
        title: "Casual world domination",
        mapSlug: "classic-world",
        rules: {
          winCondition: "world",
          dominationThreshold: 0.7,
          cardBonus: "fixed",
          diceMode: "balancedBlitz",
          fogOfWar: false,
          capitals: false,
          capitalDraftBonus: false,
          blizzards: false,
          portals: "off",
          manualPlacement: false,
          maxRounds: null,
          roundDelayMs: 0,
          turnSeconds: 90,
          alliances: false,
          aiDifficulty: "medium",
        },
        maxSeats: 6,
      },
    });

    // POLL 1 runs at 5 s; wait for the row rather than for the clock. The
    // counts are "at least one", not exactly one: the suite shares a database
    // with every other spec in the run, and a name is held for two minutes
    // after its player leaves — so by the time the capture runs there are
    // usually other players and other open games in the lists, which is what
    // the shot wants anyway.
    await expect
      .poll(() => page.locator(SEL.lobbyRow).count(), {
        timeout: 40_000,
        message: "the open game never reached the lobby browser",
      })
      .toBeGreaterThanOrEqual(1);
    await expect
      .poll(() => page.locator(SEL.onlinePlayer).count(), {
        timeout: 40_000,
        message: "the players column stayed empty",
      })
      .toBeGreaterThanOrEqual(1);
    await capture(page, "lobby", info);

    /* ---- an online game, from the host's window ---------------------- */
    await apiJson(page.request, API.join(created.code), { method: "POST", body: {} });
    await apiJson(page.request, API.ready(created.code), { method: "POST", body: { ready: true } });
    await apiJson(guest.request, API.ready(created.code), { method: "POST", body: { ready: true } });
    const started = await apiJson<{ gameId: string }>(guest.request, API.start(created.code), {
      method: "POST",
    });

    await visit(page, ROUTES.onlineGame(started.gameId));
    await page.locator(SEL.gameScreen).waitFor({ timeout: 60_000 });
    await onlineDebug(page);
    await sync(page);
    await dismissOverlays(page);

    // Put a chat line on screen so the shot shows the drawer doing its job,
    // and some troops on the board so it is not an opening position.
    const state = await readState(page);
    const acting = actingSeat(state);
    const actor = acting === (state.seats.find((s) => s.name === host)?.seat ?? -1) ? page : guest;
    if (state.troopsToPlace > 0) {
      const territory = state.territories.findIndex((t) => t.owner === acting);
      await postAction(actor.request, started.gameId, "shot-draft", {
        type: "DRAFT",
        seat: acting,
        territory,
        count: state.troopsToPlace,
      });
    }
    await apiJson(guest.request, API.chat, {
      method: "POST",
      body: { scope: "game", scopeId: started.gameId, lineId: 2 },
    });
    await sync(page);

    // The turn-timer bar only draws once the authority's deadline has arrived,
    // so wait for the body to carry one before shooting.
    await expect
      .poll(
        async () =>
          (await apiJson<GameSyncBody>(page.request, API.gameSync(started.gameId, 0))).turnDeadline,
        { timeout: 30_000, message: "no turn deadline arrived" },
      )
      .not.toBeNull();
    await page.locator(SEL.emoteButton).click(CLICK);
    await page.locator(SEL.chatDrawer).waitFor({ timeout: 15_000 });
    await expect(page.locator(SEL.turnTimer)).toBeVisible();
    await capture(page, "online-game", info);
  } finally {
    await context.close();
    await other.close();
  }
});
