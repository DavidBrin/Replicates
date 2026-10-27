import { expect, test, type Browser, type Page } from "@playwright/test";

import { ROUTES, readFighters } from "../e2e/helpers";

/**
 * Two browsers, one room, one match — the whole online path end to end.
 *
 * Locally this runs against `wrangler dev`; with SMASH_URL it runs against the
 * deployed Worker, and SMASH_FORCE_RELAY=1 forces both peers through
 * Cloudflare TURN, which is how the deploy proves the relay works rather than
 * merely exists.
 */
const FORCE_RELAY = process.env.SMASH_FORCE_RELAY === "1";
const LOBBY = FORCE_RELAY ? "/online?ice=relay" : "/online";

/**
 * How long the play page's link monitor gives a silent peer before the match
 * is lost (`SILENCE_LOST_MS`, re-declared here for the reason `ROUTES` is),
 * plus a second for its 250 ms check and the hand-off to the results screen.
 */
const LINK_LOST_LIMIT_MS = 10_000 + 1_000;

interface NetHandle {
  stats(): { peers: number; desyncs: number } | null;
}

async function player(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

async function frame(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __smashDebug?: { frame: number } }).__smashDebug?.frame ?? -1);
}

async function netStats(page: Page) {
  return page.evaluate(() => (window as unknown as { __smashNet?: NetHandle }).__smashNet?.stats() ?? null);
}

async function createRoom(host: Page): Promise<string> {
  await host.goto(LOBBY);
  await host.getByRole("button", { name: /create room/i }).click();
  const box = host.getByTestId("room-code");
  await expect(box).toHaveText(/^[A-Z]{4}$/, { timeout: 15_000 });
  return (await box.textContent())!.trim();
}

async function joinRoom(page: Page, code: string): Promise<void> {
  await page.goto(LOBBY);
  // Typed the way people type a code they were read: in lowercase.
  await page.getByLabel("Room code").fill(code.toLowerCase());
  await page.getByRole("button", { name: /join room/i }).click();
}

/** From the lobby to a running match, the way two people get there: the host picks the stage and starts. */
async function startOnlineMatch(host: Page, guest: Page): Promise<void> {
  const code = await createRoom(host);
  await joinRoom(guest, code);
  await host.waitForURL(`**${ROUTES.stage}`, { timeout: 30_000 });
  await guest.waitForURL(`**${ROUTES.fighters}`, { timeout: 30_000 });

  // exact: "Small Battlefield" also matches a substring query.
  await host.getByLabel("Stages").getByRole("button", { name: "Battlefield", exact: true }).click();
  await host.getByRole("button", { name: /choose fighters/i }).click();
  await host.waitForURL(`**${ROUTES.fighters}`);
  await expect(guest.getByText(/stage: battlefield/i)).toBeVisible();

  await host.getByLabel("Fighters").getByRole("button").nth(0).click();
  await guest.getByLabel("Fighters").getByRole("button").nth(5).click();
  await expect(guest.getByRole("button", { name: /waiting for host/i })).toBeDisabled();
  await host.getByRole("button", { name: /ready to fight/i }).click();

  await host.waitForURL(`**${ROUTES.play}`);
  await guest.waitForURL(`**${ROUTES.play}`);
}

// Forced through TURN with no TURN to go through, both peers would sit in
// "negotiating" until a URL wait timed out, saying nothing of why. A forced
// relay is a claim that the relay works, so its absence fails rather than skips.
test.beforeEach(async ({ request }) => {
  if (!FORCE_RELAY) return;
  const ice = (await (await request.get("/api/ice")).json()) as { turn?: unknown };
  expect(
    ice.turn,
    "SMASH_FORCE_RELAY=1 needs a TURN relay, and /api/ice offered none: the Worker needs TURN_KEY_ID and TURN_KEY_API_TOKEN (secrets when deployed, .dev.vars under wrangler dev)",
  ).toBe(true);
});

test("two browsers play a match through a room, and one leaving ends it for the other", async ({ browser }) => {
  const host = await player(browser);
  const guest = await player(browser);

  await startOnlineMatch(host, guest);
  await expect.poll(() => frame(host), { timeout: 30_000 }).toBeGreaterThan(180);
  await expect.poll(() => frame(guest), { timeout: 30_000 }).toBeGreaterThan(180);

  for (const page of [host, guest]) {
    const stats = await netStats(page);
    expect(stats?.peers).toBe(1);
    expect(stats?.desyncs).toBe(0);
  }
  await expect(host.getByText(/^PING \d+ ms · DELAY \d+f · ROLLBACKS \d+$/)).toBeVisible();

  // The guest's key moves the guest's fighter on the host's screen.
  const before = (await readFighters(host))[1].x;
  await guest.bringToFront();
  await guest.keyboard.down("ArrowRight");
  await expect.poll(async () => (await readFighters(host))[1].x, { timeout: 10_000 }).toBeGreaterThan(before + 5);
  await guest.keyboard.up("ArrowRight");

  // The guest closes the tab: the host is told within the link monitor's
  // limit, and nobody is crowned.
  await guest.context().close();
  await host.waitForURL(`**${ROUTES.results}`, { timeout: LINK_LOST_LIMIT_MS });
  await expect(host.getByText("Connection Lost")).toBeVisible();
});

test("two browsers play a match to its result, and both see the same one", async ({ browser }) => {
  const host = await player(browser);
  const guest = await player(browser);

  await startOnlineMatch(host, guest);

  // The host walks off the left edge once per stock, away from the guest, who
  // spawns on the right. The match ends on its confirmed outcome, so both
  // screens reach the same result.
  await host.bringToFront();
  await host.keyboard.down("ArrowLeft");
  await Promise.all([host, guest].map((page) => page.waitForURL(`**${ROUTES.results}`, { timeout: 90_000 })));
  await host.keyboard.up("ArrowLeft");

  for (const page of [host, guest]) {
    await expect(page.getByText("Game Set")).toBeVisible();
    await expect(page.getByRole("listitem").filter({ hasText: "1st" })).toContainText("P2");
  }
});

test("a third browser is turned away from a full room", async ({ browser }) => {
  const host = await player(browser);
  const guest = await player(browser);
  const third = await player(browser);

  const code = await createRoom(host);
  await joinRoom(guest, code);
  await guest.waitForURL(`**${ROUTES.fighters}`, { timeout: 30_000 });

  await joinRoom(third, code);
  // filter: Next's route announcer is also role=alert.
  await expect(third.getByRole("alert").filter({ hasText: "already has two players" })).toHaveText(
    `Room ${code} already has two players.`,
  );
  await expect(host).toHaveURL(new RegExp(`${ROUTES.stage}$`));
});
