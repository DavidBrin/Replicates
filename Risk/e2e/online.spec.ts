import { expect, test, type Page } from "@playwright/test";

import {
  API,
  ROUTES,
  SEL,
  actingSeat,
  api,
  apiJson,
  onlineDebug,
  playHumanTurn,
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

/** Let a client poll fast, so its polls drive the server's lazy tick. */
async function drivePolling(page: Page, ms = 700): Promise<void> {
  await setPollInterval(page, ms);
}

/** Open the in-game chat drawer and send one preset line (§7.3). */
async function sayLine(page: Page, lineId: number): Promise<void> {
  const drawer = page.locator(SEL.chatDrawer);
  if (!(await drawer.isVisible().catch(() => false))) {
    await page.locator(SEL.emoteButton).click();
    await drawer.waitFor({ timeout: 10_000 });
  }
  await drawer.locator(SEL.dialogLine(lineId)).click();
}

/** Every chat line currently in a drawer's log, as text. */
async function chatTexts(page: Page): Promise<string[]> {
  return page
    .locator(`${SEL.chatDrawer} ${SEL.chatLog} li`)
    .evaluateAll((nodes) => nodes.map((n) => (n.textContent ?? "").trim()));
}

test("T10.4 — lobby, a turn each, chat both ways, a timeout to a bot and a reclaim", async ({ browser }) => {
  test.slow();

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
    await sheetA.locator(SEL.identityColour("red")).click();
    await sheetA.locator(SEL.identityContinue).click();
    await pageA.locator(SEL.lobbyBrowser).waitFor({ timeout: 30_000 });

    // B tries A's live name, in a different case, and is refused with the
    // three suggestions shown inline — we never silently rename (§6.1).
    await visit(pageB, ROUTES.lobby);
    const sheetB = pageB.locator(SEL.identitySheet);
    await sheetB.waitFor({ timeout: 30_000 });
    await sheetB.locator(SEL.identityName).fill(nameA.toLowerCase());
    await sheetB.locator(SEL.identityContinue).click();
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
    await sheetB.locator(SEL.identityColour("blue")).click();
    await sheetB.locator(SEL.identityContinue).click();
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

    await pageA.locator(SEL.lobbyCreate).click();
    await pageA.locator(SEL.lobbyRoom).waitFor({ timeout: 30_000 });
    const code = (await pageA.locator(SEL.lobbyCode).innerText()).trim();
    expect(code, "four unambiguous capitals, for reading aloud").toMatch(/^[A-HJ-NP-Z]{4}$/);

    await pageB.locator(SEL.lobbyCodeInput).fill(code);
    await pageB.locator(SEL.lobbyJoinCode).click();
    await pageB.locator(SEL.lobbyRoom).waitFor({ timeout: 30_000 });
    await expect(pageB.locator(SEL.lobbyCode)).toHaveText(code);

    // BATTLE is host-only and enabled at two occupied seats with every human
    // ready. **No ready-check timer** — it waits as long as it takes (§7).
    await expect(pageA.locator(SEL.lobbyStart), "not startable with nobody ready").toBeDisabled();
    await pageA.locator(SEL.lobbyReady).click();
    await pageB.locator(SEL.lobbyReady).click();
    await expect(
      pageA.locator(`${SEL.lobbySeats} ${SEL.seatReady}`),
      "the host sees both ready ticks",
    ).toHaveCount(2, { timeout: 30_000 });

    // A guest cannot start, whatever the screen offers.
    const guestStart = await api(pageB.request, API.start(code), { method: "POST" });
    expect(guestStart.status, "only the host may start").toBe(403);

    await expect(pageA.locator(SEL.lobbyStart)).toBeEnabled({ timeout: 30_000 });
    await pageA.locator(SEL.lobbyStart).click();

    // The host navigates on the response; the guest follows from its own poll.
    await pageA.locator(SEL.gameScreen).waitFor({ timeout: 60_000 });
    await pageB.locator(SEL.gameScreen).waitFor({ timeout: 60_000 });
    const gameId = new URL(pageA.url()).pathname.split("/").pop()!;
    expect(gameId).toBeTruthy();

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
    const remaining = Date.parse(cold.turnDeadline!) - Date.now();
    expect(remaining, "and RISK_TURN_SECONDS=3 is what sets it").toBeLessThanOrEqual(4_000);

    // The timer bar only exists online, and only because that deadline came
    // down from the authority (D69).
    await expect(pageA.locator(SEL.turnTimer)).toBeVisible();

    /* ---- a turn each, through the real HUD ----------------------------- */

    const pageOf = (seat: number): Page => (seat === seatA ? pageA : pageB);
    const first = actingSeat(openA);
    const second = openA.turnOrder.find((s) => s !== first)!;

    await playHumanTurn(pageOf(first), 0);
    await sync(pageA, pageB);
    await expect
      .poll(async () => actingSeat(await readState(pageOf(second))), {
        timeout: 30_000,
        message: "the turn never reached the second seat",
      })
      .toBe(second);

    await playHumanTurn(pageOf(second), 0);
    await sync(pageA, pageB);

    const afterTurns = await readState(pageA);
    expect(afterTurns.turn, "two turns were played").toBeGreaterThanOrEqual(2);
    expect(await readSeq(pageA), "and both windows are still level").toBe(await readSeq(pageB));
    expect((await readState(pageB)).territories).toEqual(afterTurns.territories);

    /* ---- chat, both ways ----------------------------------------------- */

    await sayLine(pageA, 1);
    await sync(pageA, pageB);
    await pageB.locator(SEL.emoteButton).click();
    await pageB.locator(SEL.chatDrawer).waitFor();
    await expect
      .poll(async () => (await chatTexts(pageB)).join(" | "), {
        timeout: 30_000,
        message: "A's line never reached B",
      })
      .toContain(CHAT_LINES[1]!);

    await sayLine(pageB, 22);
    await sync(pageA, pageB);
    await pageA.locator(SEL.emoteButton).click();
    await pageA.locator(SEL.chatDrawer).waitFor();
    await expect
      .poll(async () => (await chatTexts(pageA)).join(" | "), {
        timeout: 30_000,
        message: "B's line never reached A",
      })
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
    await drivePolling(driver);

    // Two missed turns is the threshold (D62), and each one costs a full
    // 3-second deadline for both seats, so this is the one place the spec has
    // to wait for real time rather than for a poll.
    await expect
      .poll(
        async () => {
          const log = await apiJson<{ actions: LogRow[] }>(driver.request, API.rawLog(gameId, 0));
          return log.actions.filter((row) => row.action.type === "SEAT_TO_BOT");
        },
        { timeout: 90_000, message: "the turn timer never handed the seat to a bot" },
      )
      .not.toEqual([]);

    await pinPolling(driver);
    const takeovers = await apiJson<{ actions: LogRow[] }>(driver.request, API.rawLog(gameId, 0));
    const takeover = takeovers.actions.find((row) => row.action.type === "SEAT_TO_BOT")!;
    expect(takeover.actor, "the server wrote it, not a client").toBe("server");
    expect(takeover.action.reason, "they are still reachable — just not playing (§5.6)").toBe("timeout");
    expect(takeover.action.persona, "a bot-held seat carries the persona that plays it").toBeTruthy();

    const botSeat = takeover.action.seat as number;

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

    // One poll from the seat's own client is the whole gesture (D62): the flip
    // is a `SEAT_TO_HUMAN` row in the log like everything else (D14).
    await sync(quiet);
    await expect
      .poll(
        async () => {
          await sync(quiet);
          const log = await apiJson<{ actions: LogRow[] }>(quiet.request, API.rawLog(gameId, 0));
          return log.actions.some((row) => row.action.type === "SEAT_TO_HUMAN");
        },
        { timeout: 60_000, message: "the seat never flipped back to its human" },
      )
      .toBe(true);

    const reclaimed = await apiJson<{ actions: LogRow[] }>(quiet.request, API.rawLog(gameId, 0));
    const back = reclaimed.actions.find((row) => row.action.type === "SEAT_TO_HUMAN")!;
    expect(back.action.seat, "the same seat came back").toBe(botSeat);
    expect(back.seq, "after the takeover, not before").toBeGreaterThan(takeover.seq);
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
