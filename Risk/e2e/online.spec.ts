import { expect, test, type Page } from "@playwright/test";

import {
  API,
  ROUTES,
  CLICK,
  SEL,
  actingSeat,
  dismissOverlays,
  draftOnce,
  api,
  apiJson,
  onlineDebug,
  postAction,
  pressPrimary,
  readSeq,
  readState,
  setPollInterval,
  sync,
  uniqueName,
  visit,
  watchErrors,
  type GameSyncBody,
  type LogRow,
} from "./helpers";

/**
 * **T10.4 — two players online, end to end** (SPEC §11, §5.5, §5.6).
 *
 * Two Playwright **contexts**, not two pages: separate cookie jars are what
 * make two genuinely different `risk_sid`s, and a shared jar would quietly
 * test one player twice.
 *
 * The whole protocol is driven through `window.__riskDebug.pollNow()` rather
 * than by sleeping through the 2–4 s adaptive schedule — and more than that,
 * both clients have their poll interval **pinned off** with `setInterval`
 * first. That is load-bearing twice over:
 *
 *  - The lazy tick runs *inside whichever poll arrives next* (D13), so with
 *    `RISK_TURN_SECONDS=3` a background poll would auto-skip a seat halfway
 *    through the turn this spec is trying to play through the HUD. The append
 *    path deliberately does **not** tick, so an un-polling client can take as
 *    long as it likes to act.
 *  - A seat is handed to a bot after two missed turns but reclaimed on its
 *    own next poll (D62), so "stop polling" and "start polling again" are
 *    exactly the two gestures the takeover test needs.
 */

/** A chat line's text, re-declared from §7.3's published roster. */
const CHAT_LINES: Readonly<Record<number, string>> = {
  1: "Hello!",
  22: "Nice move.",
};

/** Pin a client's poll interval effectively off, so only `pollNow()` polls. */
async function pinPolling(page: Page): Promise<void> {
  await setPollInterval(page, 3_600_000);
}


/**
 * Open the in-game chat drawer and send one preset line (§7.3).
 *
 * The overlays are cleared first, and that is not defensive tidying: the
 * `Received Troops` popup sits on `--z-modal` and comes after the drawer in
 * DOM order, so while it is up the drawer is covered and a click on a chat
 * line can never land.
 */
async function openChat(page: Page): Promise<void> {
  await dismissOverlays(page);
  const drawer = page.locator(SEL.chatDrawer);
  if (await drawer.isVisible().catch(() => false)) return;

  // A plain click, at every viewport. The action bar's read-only column —
  // prompt, phase label, timer and pip row — takes no pointer events, and at
  // phone width the bottom-left stack lifts itself clear of the bar's band
  // altogether (§8.9), so nothing sits over the Chat button.
  await page.locator(SEL.emoteButton).click(CLICK);
  await drawer.waitFor({ timeout: 15_000 });
}

async function sayLine(page: Page, lineId: number): Promise<void> {
  await openChat(page);
  const line = page.locator(SEL.chatDrawer).locator(SEL.dialogLine(lineId));
  await line.scrollIntoViewIfNeeded({ timeout: 10_000 });
  await line.click(CLICK);
}

/**
 * Every chat line currently in the drawer's log, as text.
 *
 * `chat-line-<id>` is keyed by the **row id**, not the preset's line id, so a
 * spec cannot address a line it sent by number — it has to read the rendered
 * text. That is the right way round: what matters is that the other player can
 * read the words, and the words come from §7.3's published roster.
 */
async function chatTexts(page: Page): Promise<string[]> {
  return page
    .locator(`${SEL.chatDrawer} ${SEL.chatLog} [data-testid^="chat-line-"]`)
    .evaluateAll((nodes) => nodes.map((n) => (n.textContent ?? "").trim()));
}

test("T10.4 — lobby, a turn each, chat both ways, a timeout to a bot and a reclaim", async ({ browser }) => {
  // The takeover needs real elapsed time: two missed turns at a 3-second
  // deadline each, for both seats, plus the reclaim. Nothing here can be
  // hurried by polling faster, so the budget is generous on purpose.
  test.setTimeout(300_000);

  const nameA = uniqueName("Alpha");
  const nameB = uniqueName("Bravo");

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const errorsA = watchErrors(pageA);
  const errorsB = watchErrors(pageB);

  try {
    /* ---- identity, and the duplicate-name 409 --------------------------- */

    await visit(pageA, ROUTES.lobby);
    const sheetA = pageA.locator(SEL.identitySheet);
    await sheetA.waitFor({ timeout: 30_000 });
    await sheetA.locator(SEL.identityName).fill(nameA);
    await sheetA.locator(SEL.identityColour("red")).click(CLICK);
    await sheetA.locator(SEL.identityContinue).click(CLICK);
    await pageA.locator(SEL.lobbyBrowser).waitFor({ timeout: 30_000 });

    // B tries A's live name, in a different case, and is refused with the
    // three suggestions shown inline — we never silently rename (§6.1).
    await visit(pageB, ROUTES.lobby);
    const sheetB = pageB.locator(SEL.identitySheet);
    await sheetB.waitFor({ timeout: 30_000 });
    await sheetB.locator(SEL.identityName).fill(nameA.toLowerCase());
    await sheetB.locator(SEL.identityContinue).click(CLICK);
    await expect(pageB.locator(SEL.identityError)).toHaveText("That name is taken.");
    const suggestions = pageB.locator(`${SEL.identitySuggestions} [data-testid="identity-suggestion"]`);
    await expect(suggestions, "a 409 offers exactly three alternatives").toHaveCount(3);

    // The same refusal, at the wire: `409` and nothing written.
    const clash = await api<{ suggestions: string[] }>(pageB.request, API.session, {
      method: "POST",
      body: { displayName: nameA.toUpperCase() },
    });
    expect(clash.status, "a live name is 409, not a silent rename").toBe(409);
    expect(clash.body?.suggestions).toHaveLength(3);

    await sheetB.locator(SEL.identityName).fill(nameB);
    await sheetB.locator(SEL.identityColour("blue")).click(CLICK);
    await sheetB.locator(SEL.identityContinue).click(CLICK);
    await pageB.locator(SEL.lobbyBrowser).waitFor({ timeout: 30_000 });

    const whoA = await apiJson<{ you: { playerId: string; displayName: string } }>(
      pageA.request,
      API.lobbyBrowse(),
    );
    const whoB = await apiJson<{ you: { playerId: string; displayName: string } }>(
      pageB.request,
      API.lobbyBrowse(),
    );
    expect(whoA.you.displayName).toBe(nameA);
    expect(whoB.you.displayName).toBe(nameB);
    expect(whoA.you.playerId, "two cookie jars are two players").not.toBe(whoB.you.playerId);

    /* ---- create, join by code, ready, start ----------------------------- */

    await pageA.locator(SEL.lobbyCreate).click(CLICK);
    await pageA.locator(SEL.lobbyRoom).waitFor({ timeout: 30_000 });
    const code = (await pageA.locator(SEL.lobbyCode).innerText()).trim();
    expect(code, "four unambiguous capitals, for reading aloud").toMatch(/^[A-HJ-NP-Z]{4}$/);

    await pageB.locator(SEL.lobbyCodeInput).fill(code);
    await pageB.locator(SEL.lobbyJoinCode).click(CLICK);
    await pageB.locator(SEL.lobbyRoom).waitFor({ timeout: 30_000 });
    await expect(pageB.locator(SEL.lobbyCode)).toHaveText(code);

    // BATTLE is host-only and enabled at two occupied seats with every human
    // ready. **No ready-check timer** — it waits as long as it takes (§7).
    await expect(pageA.locator(SEL.lobbyStart), "not startable with nobody ready").toBeDisabled();
    await pageA.locator(SEL.lobbyReady).click(CLICK);
    await pageB.locator(SEL.lobbyReady).click(CLICK);
    await expect(
      pageA.locator(`${SEL.lobbySeats} ${SEL.seatReady}`),
      "the host sees both ready ticks",
    ).toHaveCount(2, { timeout: 30_000 });

    // A guest cannot start, whatever the screen offers.
    const guestStart = await api(pageB.request, API.start(code), { method: "POST" });
    expect(guestStart.status, "only the host may start").toBe(403);

    await expect(pageA.locator(SEL.lobbyStart)).toBeEnabled({ timeout: 30_000 });
    await pageA.locator(SEL.lobbyStart).click(CLICK);

    // The host navigates on the response; the guest follows from its own poll.
    await pageA.locator(SEL.gameScreen).waitFor({ timeout: 60_000 });
    await pageB.locator(SEL.gameScreen).waitFor({ timeout: 60_000 });
    const gameId = new URL(pageA.url()).pathname.split("/").pop()!;
    expect(gameId).toBeTruthy();

    /* ---- the refresh-mid-game reconnect -------------------------------- */

    // Both windows reload. A cold client sends `?since=0` and the authority
    // answers with a full snapshot (§5.5), so the board has to come back by
    // itself — this is the `?since=` reconnect T10.4 asks for, and it is also
    // how a player who closed the tab gets back into a live game.
    await Promise.all([
      pageA.reload({ waitUntil: "domcontentloaded" }),
      pageB.reload({ waitUntil: "domcontentloaded" }),
    ]);
    await pageA.locator(SEL.gameScreen).waitFor({ timeout: 60_000 });
    await pageB.locator(SEL.gameScreen).waitFor({ timeout: 60_000 });

    /* ---- both windows agree, and nothing is polling but us ------------- */

    await onlineDebug(pageA);
    await onlineDebug(pageB);
    await pinPolling(pageA);
    await pinPolling(pageB);
    await sync(pageA, pageB);

    const seatA = Number(await pageA.locator(SEL.gameScreen).getAttribute("data-viewer-seat"));
    const seatB = Number(await pageB.locator(SEL.gameScreen).getAttribute("data-viewer-seat"));
    expect(seatA, "each window plays its own seat").not.toBe(seatB);

    const openA = await readState(pageA);
    const openB = await readState(pageB);
    expect(await readSeq(pageA)).toBe(await readSeq(pageB));
    expect(openA.territories, "both windows folded the same board").toEqual(openB.territories);
    expect(openA.fogged, "with fog off the clients hold authoritative state (F36)").toBe(false);
    expect(openB.fogged).toBe(false);
    expect(openA.rules.turnSeconds, "the lobby chose 90 s, and the state records that").toBe(90);

    // **`RISK_TURN_SECONDS` does not rewrite the rules.** It overrides the
    // *deadline* the authority stamps (`turnSecondsFor`), so the state keeps
    // the lobby's 90 s while the clock on the wire is three seconds away —
    // which is the only place a test can see the override at all.
    const cold = await apiJson<GameSyncBody>(pageA.request, API.gameSync(gameId, 0));
    expect(cold.turnDeadline, "the authority stamps a deadline (F42)").not.toBeNull();
    expect(
      Date.parse(cold.turnDeadline!) - Date.now(),
      "and RISK_TURN_SECONDS=3 is what sets it",
    ).toBeLessThanOrEqual(4_000);

    // The timer bar only exists online, and only because that deadline came
    // down from the authority (D69).
    await expect(pageA.locator(SEL.turnTimer)).toBeVisible();

    /* ---- a turn each, through the HUD ---------------------------------- */
    //
    // **Both turns are played on the board and the action bar** — a draft
    // tapped out on a territory and resolved through the count slider, then
    // the primary pill through `End Draft Phase`, `End Attack Phase` and
    // `End Turn`. Only the three *refusals* go through the HTTP route,
    // because a refusal has no gesture: there is no control anywhere in the
    // HUD that offers the wrong seat a move or lets a client roll its own
    // dice, which is the point of asserting them.
    //
    // **Nothing in a turn polls.** The lazy tick runs inside whichever poll
    // arrives next (D13) and the append path deliberately does not tick, so
    // a client that stays quiet can take as long as it likes to act — and
    // with `RISK_TURN_SECONDS=3` a single stray poll halfway through a
    // hand-played turn would auto-skip the seat out from under it. The
    // interval is re-pinned after every `bringToFront`, because raising a tab
    // is what the background cadence keys off.
    //
    // The refusals go through each context's **own** `request`, which shares
    // that context's cookie jar — so they are that seat's requests, carrying
    // that seat's `risk_sid`, exactly as its browser would send them.

    const pageOf = (seat: number): Page => (seat === seatA ? pageA : pageB);
    const first = actingSeat(openA);
    const second = openA.turnOrder.find((s) => s !== first)!;

    for (const [index, seat] of [first, second].entries()) {
      const actor = pageOf(seat);
      const other = seat === first ? second : first;
      const before = await readState(actor);
      expect(actingSeat(before), `seat ${seat} is up`).toBe(seat);

      // The other seat may not move while this one is up.
      const wrongSeat = await postAction(pageOf(other).request, gameId, `t${index}-intruder`, {
        type: "END_PHASE",
        seat: other,
      });
      expect(wrongSeat.status, "the other seat gets 409 notYourTurn").toBe(409);

      // Dice are the authority's: an ATTACK sent as an *action* rather than an
      // intent is refused outright (F11).
      const cheat = await postAction(actor.request, gameId, `t${index}-cheat`, {
        type: "ATTACK",
        seat,
        from: 0,
        to: 1,
        mode: "blitz",
        attackerLosses: 0,
        defenderLosses: 99,
      });
      expect(cheat.status, "a client-rolled ATTACK is 422 illegalAction").toBe(422);

      // Raise this window and re-pin both loops: a tab that is not frontmost
      // drops to the 15 s hidden cadence (D11), and that poll would tick.
      await actor.bringToFront();
      await pinPolling(pageA);
      await pinPolling(pageB);
      await dismissOverlays(actor);

      // The draft, on the board: a tap on an owned territory opens the count
      // slider at the whole undrafted pool, and `a` + Confirm places it.
      if (before.troopsToPlace > 0) {
        await draftOnce(actor);
        await expect(actor.locator(SEL.primary), "the pill unlocks once the pool is empty")
          .toBeEnabled({ timeout: 15_000 });
      }

      // draft → attack → fortify → end, one press of the primary pill each.
      // `End Turn` raises the amber confirmation, which `pressPrimary` takes.
      for (const phase of ["draft", "attack", "fortify"] as const) {
        if ((await actor.locator(SEL.gameScreen).getAttribute("data-phase")) !== phase) break;
        await pressPrimary(actor);
      }

      await sync(pageA, pageB);
      await expect
        .poll(async () => actingSeat(await readState(actor)), {
          timeout: 30_000,
          message: `seat ${seat} never finished its turn through the HUD`,
        })
        .not.toBe(seat);
    }

    const afterTurns = await readState(pageA);
    expect(afterTurns.turn, "two turns were played").toBeGreaterThanOrEqual(2);
    expect(await readSeq(pageA), "and both windows are still level").toBe(await readSeq(pageB));
    expect((await readState(pageB)).territories).toEqual(afterTurns.territories);

    /* ---- the idempotent retry (D15) ------------------------------------ */
    //
    // A retry with the same `clientActionId` is indistinguishable from a slow
    // success: one row, and the same `seq` back. There is no gesture for this
    // — the HUD cannot be made to send the same action twice on purpose — so
    // it is asserted at the wire, on the seat that is up now, after both
    // hand-played turns are already banked.
    const upNext = actingSeat(afterTurns);
    const retried = pageOf(upNext);
    if (afterTurns.troopsToPlace > 0) {
      const body = {
        type: "DRAFT",
        seat: upNext,
        territory: afterTurns.territories.findIndex((t) => t.owner === upNext),
        count: afterTurns.troopsToPlace,
      };
      const once = await postAction(retried.request, gameId, "retry-probe", body);
      expect(once.status, `DRAFT for seat ${upNext}`).toBe(200);
      const twice = await postAction(retried.request, gameId, "retry-probe", body);
      expect(twice.status, "a duplicate clientActionId is 200, not 409").toBe(200);
      expect(twice.body!.actions[0]!.seq).toBe(once.body!.actions[0]!.seq);
      await sync(pageA, pageB);
    }

    /* ---- chat, both ways ----------------------------------------------- */

    await sayLine(pageA, 1);
    await openChat(pageB);
    await expect
      .poll(
        async () => {
          await sync(pageB);
          return (await chatTexts(pageB)).join(" | ");
        },
        { timeout: 40_000, message: "A's line never reached B" },
      )
      .toContain(CHAT_LINES[1]!);

    await sayLine(pageB, 22);
    await openChat(pageA);
    await expect
      .poll(
        async () => {
          await sync(pageA);
          return (await chatTexts(pageA)).join(" | ");
        },
        { timeout: 40_000, message: "B's line never reached A" },
      )
      .toContain(CHAT_LINES[22]!);

    // Both lines are preset ids on the wire. There is no column for free text
    // and no path that would write one (D41).
    const freeText = await api(pageA.request, API.chat, {
      method: "POST",
      body: { scope: "game", scopeId: gameId, body: "free text" },
    });
    expect(freeText.status, "there is no free-text path anywhere").toBe(400);

    /* ---- the timeout: one client stops polling, the other drives ------- */

    // Whoever is acting now goes quiet. Its own client makes no requests at
    // all, so `last_seen_at` stops moving but stays well inside AWAY_SECONDS
    // — which is what makes this the *timeout* path and not the away path.
    const quietSeat = actingSeat(await readState(pageA));
    const quiet = pageOf(quietSeat);
    const driver = quiet === pageA ? pageB : pageA;

    await pinPolling(quiet);
    await pinPolling(driver);

    // **The ticks are driven by hand, not by the background loop.** The loop
    // drops to `HIDDEN_MS` (15 s) when its tab is not frontmost and stops
    // entirely after five minutes hidden (D11), and with two windows open one
    // of them is always hidden — so leaning on it here would make the test's
    // runtime depend on which tab the browser happened to raise.
    //
    // Each pass is "let the 3-second deadline expire, then poll once". Two
    // missed turns is the takeover threshold (D62) and a missed turn costs a
    // full deadline for *both* seats, so this needs the quiet seat to come up
    // three times. It is the one part of the suite that waits on real elapsed
    // time: no amount of polling can make a deadline pass sooner.
    //
    // The row this looks for is **the quiet seat's**. The driver is polling
    // but not playing either, so it will be handed over too; whose takeover
    // arrives first depends on the turn order, and the reclaim at the end is
    // the quiet seat's to make.
    //
    // The poll is sent through the driver's **request context** rather than
    // through its page: it is the same `GET /api/games/:id` the browser sends,
    // on the same cookie, but it cannot be throttled or deferred by the tab
    // being in the background — which is what made this step's runtime
    // unpredictable when it went through `pollNow()`.
    let takeover: LogRow | undefined;
    for (let pass = 0; pass < 20 && takeover === undefined; pass += 1) {
      await driver.waitForTimeout(3_300);
      await api(driver.request, API.gameSync(gameId, 0));
      const log = await apiJson<{ actions: LogRow[] }>(driver.request, API.rawLog(gameId, 0));
      takeover = log.actions.find(
        (row) => row.action.type === "SEAT_TO_BOT" && row.action.seat === quietSeat,
      );
    }
    expect(takeover, `the turn timer never handed seat ${quietSeat} to a bot`).toBeDefined();
    expect(takeover!.actor, "the server wrote it, not a client").toBe("server");
    expect(takeover!.action.reason, "they are still reachable — just not playing (§5.6)").toBe(
      "timeout",
    );
    expect(
      takeover!.action.persona,
      "a bot-held seat carries the persona that will play it",
    ).toBeTruthy();

    const botSeat = quietSeat;

    // The driver's roster shows it: a robot chip where an avatar was.
    await sync(driver);
    await expect
      .poll(() => driver.locator(`${SEL.rosterRow(botSeat)} ${SEL.botChip}`).count(), {
        timeout: 30_000,
        message: "the roster never showed the robot chip",
      })
      .toBeGreaterThan(0);

    const seenByDriver = await readState(driver);
    expect(seenByDriver.seats[botSeat]!.kind, "and the simulation agrees").toBe("bot");

    /* ---- the reclaim: the player polls again --------------------------- */

    const beforeReclaim = (await apiJson<{ actions: LogRow[] }>(driver.request, API.rawLog(gameId, 0)))
      .actions.length;

    // **One poll from the seat's own client is the whole gesture** (D62), and
    // the flip is a `SEAT_TO_HUMAN` row in the log like everything else (D14)
    // — not a side channel, not a flag flipped in place.
    //
    // Scoped to the quiet seat, for the same reason the takeover search was:
    // the driver has been polling throughout, so if *its* seat was handed
    // over too then its very next poll reclaimed it, and an unscoped search
    // would find that row instead of this one.
    let reclaimedRow: LogRow | undefined;
    for (let pass = 0; pass < 10 && reclaimedRow === undefined; pass += 1) {
      await api(quiet.request, API.gameSync(gameId, 0));
      const log = await apiJson<{ actions: LogRow[] }>(quiet.request, API.rawLog(gameId, 0));
      reclaimedRow = log.actions.find(
        (row) => row.action.type === "SEAT_TO_HUMAN" && row.action.seat === botSeat,
      );
      if (!reclaimedRow) await quiet.waitForTimeout(500);
    }
    expect(reclaimedRow, `seat ${botSeat} never flipped back to its human`).toBeDefined();

    // And the client sees it the same way: one `pollNow()` and its own session
    // has folded the row.
    await sync(quiet);
    await expect
      .poll(async () => (await readState(quiet)).seats[botSeat]?.kind, {
        timeout: 30_000,
        message: "the reclaiming client never folded the flip back to human",
      })
      .toBe("human");

    const back = reclaimedRow!;
    expect(back.actor, "the server wrote the flip back, too").toBe("server");
    expect(back.seq, "after the takeover, not before").toBeGreaterThan(takeover!.seq);
    const reclaimed = await apiJson<{ actions: LogRow[] }>(quiet.request, API.rawLog(gameId, 0));
    expect(reclaimed.actions.length).toBeGreaterThanOrEqual(beforeReclaim);

    // Everything in this test is a row in one log, which is the design (D14).
    const body = await apiJson<GameSyncBody>(quiet.request, API.gameSync(gameId, 0));
    expect(body.you.seat, "the reclaimed seat is the caller's again").toBe(botSeat);
    expect(JSON.stringify(body), "`games.seed` is never serialised (D5)").not.toContain("seed");

    expect(errorsA, "no page errors or desync in window A").toEqual([]);
    expect(errorsB, "no page errors or desync in window B").toEqual([]);
  } finally {
    await contextA.close();
    await contextB.close();
  }
});
