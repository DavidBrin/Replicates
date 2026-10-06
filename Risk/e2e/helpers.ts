import {
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";

/**
 * Routes, API paths, test ids and the `window.__riskDebug` accessors — all
 * **re-declared here rather than imported from `src/`**.
 *
 * An e2e suite that imports the app's own constants can only prove the app is
 * self-consistent (the reason the sibling `super-smash/e2e/helpers.ts` gives
 * for the same rule). Rename a route, an API path or a `data-testid` in
 * `src/` and these tests should go red — which they only do if the string
 * lives here too. The one deliberate exception is `e2e/replay.spec.ts`, which
 * imports `@/engine` because reproducing the fold *is* the thing it proves;
 * even there the route and the test ids come from this file.
 *
 * `e2e/**` is S6's and S6's alone (SPEC §11 T10, F28). A missing test id or a
 * missing debug hook is a bug in S4 or S5, never something to add from here.
 */

/**
 * Every `click` in this suite carries this timeout, and it is not belt-and-braces.
 *
 * `playwright.config.ts` sets no `actionTimeout` — it is S0's file, not S6's —
 * so a Playwright action's default budget is **unbounded**: a click on an
 * element that is visible and enabled but cannot receive events retries until
 * the whole test times out, and the failure then points at the test's last
 * line rather than at the button. That cost half an hour once: a `Received
 * Troops` popup sits on `--z-modal` and comes after the chat drawer in DOM
 * order, so it covers the drawer, and clicking a chat line hung for five
 * minutes with nothing in the report to say why.
 */
export const CLICK = { timeout: 20_000 } as const;

/* ----------------------------------------------------------- routes ---- */

export const ROUTES = {
  home: "/",
  gameType: "/new",
  mapPicker: "/new/map",
  rules: "/new/rules",
  solo: "/play/solo",
  passAndPlay: "/play/pass-and-play",
  lobby: "/lobby",
  lobbyRoom: (code: string) => `/lobby/${code}`,
  onlineGame: (gameId: string) => `/play/online/${gameId}`,
} as const;

export const API = {
  session: "/api/session",
  /** POLL 1 — the lobby browser's body, and the only place `you.playerId` is served. */
  lobbyBrowse: (since = 0, chatSince = 0) => `/api/lobby?since=${since}&chatSince=${chatSince}`,
  lobbies: "/api/lobbies",
  /** POLL 2 — one lobby room. */
  lobbyRoom: (code: string, since = 0, chatSince = 0) =>
    `/api/lobbies/${code}?since=${since}&chatSince=${chatSince}`,
  join: (code: string) => `/api/lobbies/${code}/join`,
  ready: (code: string) => `/api/lobbies/${code}/ready`,
  start: (code: string) => `/api/lobbies/${code}/start`,
  /** POLL 3 — the game sync body. */
  gameSync: (gameId: string, since = 0, chatSince = 0) =>
    `/api/games/${gameId}?since=${since}&chatSince=${chatSince}`,
  gameActions: (gameId: string) => `/api/games/${gameId}/actions`,
  /** The debug-gated raw log (SPEC §6, F37) — the determinism proof's only door. */
  rawLog: (gameId: string, from = 0) => `/api/games/${gameId}/actions?from=${from}`,
  chat: "/api/chat",
  health: "/api/health",
} as const;

/* -------------------------------------------------------- test ids ---- */

export const SEL = {
  // setup flow
  homeScreen: '[data-testid="home-screen"]',
  homeName: '[data-testid="home-name"]',
  homeBattle: '[data-testid="home-battle"]',
  homeSettings: '[data-testid="home-settings"]',
  identitySheet: '[data-testid="identity-sheet"]',
  identityName: '[data-testid="identity-name"]',
  identityContinue: '[data-testid="identity-continue"]',
  identityError: '[data-testid="identity-error"]',
  identitySuggestions: '[data-testid="identity-suggestions"]',
  identityColour: (colour: string) => `[data-testid="identity-colour-${colour}"]`,
  gameTypeScreen: '[data-testid="new-game-screen"]',
  gameType: (mode: string) => `[data-testid="game-type-${mode}"]`,
  formatToggle: (value: string) => `[data-testid="format-toggle-${value}"]`,
  newBattle: '[data-testid="new-battle"]',
  mapPickerScreen: '[data-testid="map-picker-screen"]',
  mapTile: (slug: string) => `[data-testid="map-tile-${slug}"]`,
  mapNext: '[data-testid="map-next"]',
  rulesScreen: '[data-testid="rules-screen"]',
  rulesBattle: '[data-testid="rules-battle"]',
  rulesModifiers: '[data-testid="rules-modifiers"]',
  rulesReadout: '[data-testid="rules-readout"]',
  modifiersPanel: '[data-testid="modifiers-panel"]',
  modifiersClose: '[data-testid="modifiers-close"]',
  modifier: (key: string) => `[data-testid="modifier-${key}"]`,
  seatCount: '[data-testid="seat-count"]',
  seatAdd: '[data-testid="seat-add"]',
  seatRow: (index: number) => `[data-testid="seat-row-${index}"]`,
  seatTier: (index: number) => `[data-testid="seat-tier-${index}"]`,
  seatRemove: (index: number) => `[data-testid="seat-remove-${index}"]`,
  rulesChoice: (name: string, value: string | number) => `[data-testid="rules-${name}-${value}"]`,
  domination: '[data-testid="rules-domination"]',
  dominationValue: '[data-testid="rules-domination-value"]',

  // the game screen
  gameScreen: '[data-testid="game-screen"]',
  boardStage: '[data-testid="board-stage"]',
  boardWrapper: '[data-testid="board-wrapper"]',
  territory: (id: number) => `[data-territory="${id}"]`,
  token: (id: number) => `[data-token="${id}"]`,
  actionBar: '[data-testid="action-bar"]',
  actionPrompt: '[data-testid="action-prompt"]',
  phaseLabel: '[data-testid="phase-label"]',
  phasePip: (phase: string) => `[data-testid="phase-pip-${phase}"]`,
  primary: '[data-testid="primary-action"]',
  diceButton: '[data-testid="dice-button"]',
  turnTimer: '[data-testid="turn-timer"]',
  roster: '[data-testid="roster"]',
  rosterRow: (seat: number) => `[data-testid="roster-row-${seat}"]`,
  rosterTroops: (seat: number) => `[data-testid="roster-troops-${seat}"]`,
  rosterTerritories: (seat: number) => `[data-testid="roster-territories-${seat}"]`,
  botChip: '[data-testid="avatar-bot-chip"]',
  statsButton: '[data-testid="stats-button"]',
  cardsChip: '[data-testid="cards-chip"]',
  emoteButton: '[data-testid="emote-button"]',
  bottomLeftStack: '[data-testid="bottom-left-stack"]',
  utilityButtons: '[data-testid="utility-buttons"]',
  titlePill: '[data-testid="title-pill"]',
  overlayToolbar: '[data-testid="overlay-toolbar"]',
  overlay: (mode: string) => `[data-testid="overlay-${mode}"]`,
  syncStatus: '[data-testid="sync-status"]',
  playLoading: '[data-testid="play-loading"]',
  playError: '[data-testid="play-error"]',

  // dialogs
  countSlider: '[data-testid="count-slider"]',
  countSliderTitle: '[data-testid="count-slider-title"]',
  countConfirm: '[data-testid="count-confirm"]',
  countCancel: '[data-testid="count-cancel"]',
  countMoveAll: '[data-testid="count-move-all"]',
  blitzView: '[data-testid="blitz-view"]',
  blitzBattle: '[data-testid="blitz-battle"]',
  blitzCancel: '[data-testid="blitz-cancel"]',
  blitzWinChance: '[data-testid="blitz-win-chance"]',
  blitzCommitted: '[data-testid="blitz-committed"]',
  attackLimit: '[data-testid="attack-limit"]',
  cardTradePanel: '[data-testid="card-trade-panel"]',
  cardFan: '[data-testid="card-fan"]',
  cardTradeClose: '[data-testid="card-trade-close"]',
  tradeInNow: '[data-testid="trade-in-now"]',
  endTurnConfirm: '[data-testid="end-turn-confirm"]',
  endTurnYes: '[data-testid="end-turn-yes"]',
  endTurnNo: '[data-testid="end-turn-no"]',
  getReady: '[data-testid="get-ready"]',
  receivedTroops: '[data-testid="received-troops"]',
  victory: '[data-testid="victory-overlay"]',
  victoryName: '[data-testid="victory-name"]',
  victoryTiebreak: '[data-testid="victory-tiebreak"]',
  handOff: '[data-testid="handoff-overlay"]',
  handOffName: '[data-testid="handoff-name"]',
  handOffContinue: '[data-testid="handoff-continue"]',
  settingsDialog: '[data-testid="settings-dialog"]',

  // in-game chat drawer (SPEC §7.3)
  chatDrawer: '[data-testid="chat-drawer"]',
  chatLog: '[data-testid="chat-log"]',
  chatLine: (lineId: number) => `[data-testid="chat-line-${lineId}"]`,
  dialogRoster: '[data-testid="dialog-roster"]',
  dialogLine: (lineId: number) => `[data-testid="dialog-line-${lineId}"]`,
  emojiGrid: '[data-testid="emoji-grid"]',
  emoji: (id: string) => `[data-testid="emoji-${id}"]`,

  // online screens
  lobbyBrowser: '[data-testid="lobby-browser"]',
  lobbyCreate: '[data-testid="lobby-create"]',
  lobbyCodeInput: '[data-testid="lobby-code-input"]',
  lobbyJoinCode: '[data-testid="lobby-join-code"]',
  lobbyRow: '[data-testid="lobby-row"]',
  lobbyJoin: '[data-testid="lobby-join"]',
  onlinePlayers: '[data-testid="online-players"]',
  onlinePlayer: '[data-testid="online-player"]',
  lobbyRoom: '[data-testid="lobby-room"]',
  lobbyCode: '[data-testid="lobby-code"]',
  lobbySeat: (seat: number) => `[data-testid="lobby-seat-${seat}"]`,
  lobbySeats: '[data-testid="lobby-seats"]',
  lobbyReady: '[data-testid="lobby-ready"]',
  lobbyStart: '[data-testid="lobby-start"]',
  lobbyMapPicker: '[data-testid="lobby-map-picker"]',
  seatReady: '[data-testid="seat-ready"]',
  lobbyGone: '[data-testid="lobby-gone"]',
  onlineGameStatus: '[data-testid="online-game-status"]',
  onlineSeq: '[data-testid="online-seq"]',
  chatColumn: '[data-testid="chat-column"]',
  chatEmoji: (id: string) => `[data-testid="chat-emoji-${id}"]`,
} as const;

/* ------------------------------------------------- the debug handle ---- */

/**
 * `GameState` as the specs read it — a **narrow structural restatement**, not
 * an import. Only the fields the suite actually asserts on are listed, which
 * is the point: a spec that typed itself from `@/engine/types` would compile
 * against whatever the engine says today.
 *
 * `owner` is a seat index, or `-1` (unowned / blizzard), `-2` (the 2-player
 * neutral holding) or `-3` (hidden under fog). `troops` is `-1` when hidden.
 */
export interface DebugTerritory {
  readonly owner: number;
  readonly troops: number;
  readonly blizzard: boolean;
}

export interface DebugSeat {
  readonly seat: number;
  readonly kind: "human" | "bot";
  readonly name: string;
  readonly colour: string;
  readonly standing: string;
  readonly cardCount: number;
  readonly capital: number | null;
  readonly missedTurns: number;
}

export interface DebugState {
  readonly mapSlug: string;
  readonly rules: {
    readonly fogOfWar: boolean;
    readonly winCondition: string;
    readonly dominationThreshold: number;
    readonly capitals: boolean;
    readonly maxRounds: number | null;
    readonly turnSeconds: number | null;
    readonly neutralHolding: boolean;
  };
  readonly seats: readonly DebugSeat[];
  readonly turnOrder: readonly number[];
  readonly territories: readonly DebugTerritory[];
  readonly currentIndex: number;
  readonly phase: "claim" | "draft" | "attack" | "fortify" | "over";
  readonly round: number;
  readonly turn: number;
  readonly troopsToPlace: number;
  readonly conqueredThisTurn: boolean;
  readonly fortifyUsed: boolean;
  readonly pendingMoveIn: { readonly from: number; readonly to: number; readonly min: number; readonly max: number } | null;
  readonly outcome: { readonly winner: number; readonly reason: string; readonly tiebreak: boolean; readonly round: number } | null;
  readonly fogged: boolean;
}

/** The handle S4 and S5 register between them (SPEC §11's `RiskDebug`). */
interface RiskDebugHandle {
  seq(): number;
  state(): DebugState;
  pollNow(): Promise<void>;
  setInterval(ms: number): void;
}

/**
 * Not a `declare global` augmentation. Two augmentations of
 * `Window.__riskDebug` in one TypeScript program must agree, and
 * `src/game/debugBridge.ts` already owns the only one (F27) — so the cast
 * lives here, in one place, instead.
 */
type DebugWindow = { __riskDebug?: Partial<RiskDebugHandle> };

/** Which of the four hooks are installed right now. */
export async function debugKeys(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const handle = (window as unknown as DebugWindow).__riskDebug;
    if (!handle) return [];
    return (["seq", "state", "pollNow", "setInterval"] as const).filter(
      (key) => typeof handle[key] === "function",
    );
  });
}

/**
 * Wait for the debug handle, then return accessors bound to this page.
 *
 * **The keys are registered from an effect, not at module scope**, so they are
 * absent for a tick or two after navigation — and online they only appear once
 * the first snapshot has built a session. Every accessor goes through here so
 * no spec has to remember that.
 *
 * `require` defaults to the **offline** pair. Two slices contribute to one
 * handle and `registerDebug` merges rather than replaces (F27): S4 registers
 * `state` and `seq` from the session, so an offline game has exactly those
 * two, and `pollNow` / `setInterval` appear only on `/play/online/[gameId]`,
 * where S5 registers them. Asking for all four offline would wait forever.
 */
export async function debug(
  page: Page,
  options: { timeout?: number; require?: readonly string[] } = {},
) {
  const required = options.require ?? ["state", "seq"];
  await expect
    .poll(() => debugKeys(page), {
      timeout: options.timeout ?? 30_000,
      message: `window.__riskDebug never installed ${required.join("/")}`,
    })
    .toEqual(expect.arrayContaining([...required]));

  return {
    /** The CONFIRMED state, cloned (§4.15). Simulation truth, never pixels. */
    state: (): Promise<DebugState> =>
      page.evaluate(() => (window as unknown as DebugWindow).__riskDebug!.state!()),
    /** The authoritative sequence number this client has folded to. */
    seq: (): Promise<number> =>
      page.evaluate(() => (window as unknown as DebugWindow).__riskDebug!.seq!()),
    /** Resolves once the response has been applied. */
    pollNow: (): Promise<void> =>
      page.evaluate(() => (window as unknown as DebugWindow).__riskDebug!.pollNow!()),
    setInterval: (ms: number): Promise<void> =>
      page.evaluate((n) => (window as unknown as DebugWindow).__riskDebug!.setInterval!(n), ms),
  };
}

/** The online handle: all four hooks, which only `/play/online/[gameId]` has. */
export async function onlineDebug(page: Page, timeout = 60_000) {
  return debug(page, { timeout, require: ["state", "seq", "pollNow", "setInterval"] });
}

/** The handle without the wait — for the assertions that are *about* the wait. */
export async function readState(page: Page): Promise<DebugState> {
  return page.evaluate(() => (window as unknown as DebugWindow).__riskDebug!.state!());
}

export async function readSeq(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as DebugWindow).__riskDebug!.seq!());
}

/**
 * Every page polls **at once**, and the promise resolves when every response
 * has been applied (SPEC §11's own sketch of this helper).
 *
 * Driving the loop is the whole reason the hook exists: a suite that slept
 * through a 2–4 s adaptive interval instead would be both slower and flaky.
 */
export async function sync(...pages: Page[]): Promise<void> {
  await Promise.all(
    pages.map((page) =>
      page.evaluate(() => (window as unknown as DebugWindow).__riskDebug!.pollNow!()),
    ),
  );
}

/**
 * Change this client's poll cadence (S5's half of the handle).
 *
 * A very large value is how a spec takes the loop out of the picture: the
 * lazy tick runs inside whichever poll arrives next (D13), so a client that
 * is not polling cannot have its own seat auto-skipped out from under it.
 */
export async function setPollInterval(page: Page, ms: number): Promise<void> {
  await page.evaluate(
    (n) => (window as unknown as DebugWindow).__riskDebug?.setInterval?.(n),
    ms,
  );
}

/** Poll until this client has folded to exactly `seq`. */
export async function expectSeq(page: Page, seq: number, timeout = 20_000): Promise<void> {
  await expect.poll(() => readSeq(page), { timeout }).toBe(seq);
}

/** Poll until this client has folded to `seq` or beyond. */
export async function expectSeqAtLeast(page: Page, seq: number, timeout = 20_000): Promise<void> {
  await expect.poll(() => readSeq(page), { timeout }).toBeGreaterThanOrEqual(seq);
}

/* ------------------------------------------------------- navigation ---- */

/**
 * `domcontentloaded`, never `networkidle`.
 *
 * Every screen in this app polls — the lobby every 5 s, a game every 2–4 s —
 * so the network is never idle and `waitUntil: "networkidle"` waits until the
 * navigation times out. Found the hard way by S5's two-window smoke test.
 */
export async function visit(page: Page, path: string): Promise<void> {
  await page.goto(path, { waitUntil: "domcontentloaded" });
}

/* --------------------------------------------------------- identity ---- */

/**
 * Claim `name` through the home screen's identity sheet.
 *
 * The sheet opens by itself on first arrival (no cached identity) and is
 * re-openable from the ⚙ affordance, so this works on a cold context and on a
 * warm one.
 */
export async function claimIdentity(page: Page, name: string, colour?: string): Promise<void> {
  await visit(page, ROUTES.home);
  await page.locator(SEL.homeScreen).waitFor();

  // **"Is the sheet already open?" is not answerable on the first frame.**
  // Home reads the cached identity in an effect, never during render, so that
  // the server markup and the first client paint agree — which means the
  // sheet is raised a tick or two *after* `home-screen` exists. Asking
  // immediately gets `0` on a cold context too, and the ⚙ click that follows
  // then races the sheet appearing over it and hangs on an intercepted
  // pointer. So: give it a moment to raise itself, and only reach for ⚙ if it
  // does not — which is the warm case, where an identity is already cached.
  const sheet = page.locator(SEL.identitySheet);
  try {
    await sheet.waitFor({ timeout: 10_000 });
  } catch {
    await page.locator(SEL.homeSettings).click(CLICK);
    await sheet.waitFor({ timeout: 15_000 });
  }

  await sheet.locator(SEL.identityName).fill(name);
  if (colour) await sheet.locator(SEL.identityColour(colour)).click(CLICK);
  await sheet.locator(SEL.identityContinue).click(CLICK);

  await expect(page.locator(SEL.homeName)).toHaveText(name);
}

/**
 * Claim `name` for an online context through `/lobby`'s own sheet.
 *
 * `/lobby` renders the claim sheet when POLL 1 answers `401`, which is the
 * path a player who goes straight to Online actually takes. Returns the
 * `playerId` the server minted, read from POLL 1 — the only body that carries
 * it.
 */
export async function claimOnline(page: Page, name: string, colour?: string): Promise<string> {
  await visit(page, ROUTES.lobby);
  const sheet = page.locator(SEL.identitySheet);
  await sheet.waitFor({ timeout: 30_000 });
  await sheet.locator(SEL.identityName).fill(name);
  if (colour) await sheet.locator(SEL.identityColour(colour)).click(CLICK);
  await sheet.locator(SEL.identityContinue).click(CLICK);
  await page.locator(SEL.lobbyBrowser).waitFor({ timeout: 30_000 });

  const body = await apiJson<{ you: { playerId: string; displayName: string } }>(
    page.request,
    API.lobbyBrowse(),
  );
  expect(body.you.displayName).toBe(name);
  return body.you.playerId;
}

/* ------------------------------------------------- the setup flow ------ */

export interface StartSoloOptions {
  /** A player-facing map slug. The four engine fixtures never appear in the picker (D39). */
  readonly map: string;
  /** Total seats, 2–6. Solo fills seat 0 with the human and the rest with bots. */
  readonly seats?: number;
  /** Modifier toggles to click, by their `modifier-<key>` test id. */
  readonly modifiers?: readonly string[];
  /** `rules-<name>-<value>` choices to click inside the Modifiers panel. */
  readonly rules?: readonly (readonly [string, string | number])[];
  /** `% Domination` slider value, 50–90 in steps of 5. Implies Percentage Domination. */
  readonly dominationPercent?: number;
  readonly mode?: "solo" | "pass-and-play";
}

/**
 * Walk the **real menu** into a running game: identity → `/new` → `/new/map`
 * → `/new/rules` → BATTLE.
 *
 * Deliberately not a deep link. `/play/solo` reads a client-side zustand
 * store that BATTLE fills in and refuses a cold load by bouncing to `/new`
 * (`PlayPage`'s `configured` guard), so a `page.goto("/play/solo")` would only
 * ever test the bounce.
 */
export async function startSolo(page: Page, options: StartSoloOptions): Promise<void> {
  const mode = options.mode ?? "solo";

  await page.locator(SEL.homeScreen).waitFor();
  await page.locator(SEL.homeBattle).click(CLICK);

  // /new — the game type
  await page.locator(SEL.gameTypeScreen).waitFor();
  await page.locator(SEL.gameType(mode)).click(CLICK);
  await page.locator(SEL.newBattle).click(CLICK);

  // /new/map — the board
  await page.locator(SEL.mapPickerScreen).waitFor();
  const tile = page.locator(SEL.mapTile(options.map));
  await tile.waitFor();
  await tile.click(CLICK);
  await expect(tile).toHaveAttribute("data-selected", "true");
  await page.locator(SEL.mapNext).click(CLICK);

  // /new/rules — modifiers, seats and the rest of `Rules`
  await page.locator(SEL.rulesScreen).waitFor();
  for (const key of options.modifiers ?? []) {
    await page.locator(SEL.modifier(key)).click(CLICK);
  }

  const wantsPanel =
    options.seats !== undefined || (options.rules?.length ?? 0) > 0 || options.dominationPercent !== undefined;
  if (wantsPanel) {
    await page.locator(SEL.rulesModifiers).click(CLICK);
    const panel = page.locator(SEL.modifiersPanel);
    await panel.waitFor();

    if (options.seats !== undefined) await setSeatCount(page, options.seats);
    for (const [name, value] of options.rules ?? []) {
      await panel.locator(SEL.rulesChoice(name, value)).click(CLICK);
    }
    if (options.dominationPercent !== undefined) {
      await panel.locator(SEL.domination).fill(String(options.dominationPercent));
      await expect(panel.locator(SEL.dominationValue)).toHaveText(`${options.dominationPercent}%`);
    }
    await panel.locator(SEL.modifiersClose).click(CLICK);
  }

  await page.locator(SEL.rulesBattle).click(CLICK);

  // the board
  await page.locator(SEL.gameScreen).waitFor({ timeout: 60_000 });
  await debug(page);
  await dismissOverlays(page);
}

/**
 * Drive the seat count to `want` (2–6).
 *
 * The panel only grows one seat at a time (`Add seat`) and only ever drops the
 * **last** row, so this is two loops rather than a single setter: the store
 * truncates, and any other seat is emptied by retyping it.
 */
export async function setSeatCount(page: Page, want: number): Promise<void> {
  const panel = page.locator(SEL.modifiersPanel);
  for (let guard = 0; guard < 8; guard += 1) {
    const current = Number(await panel.locator(SEL.seatCount).innerText());
    if (current === want) return;
    if (current < want) {
      await panel.locator(SEL.seatAdd).click(CLICK);
    } else {
      await panel.locator(SEL.seatRemove(current - 1)).click(CLICK);
    }
  }
  expect(Number(await panel.locator(SEL.seatCount).innerText())).toBe(want);
}

/**
 * Clear whatever self-dismissing popup is on screen: `Get Ready` on the
 * viewer's first turn, and `Received Troops` at the top of every draft.
 *
 * Both leave on their own after a couple of seconds (`GET_READY_HOLD_MS`,
 * `AWARD_HOLD_MS`), so this taps them away rather than waiting them out —
 * the board underneath is what every assertion is about.
 */
export async function dismissOverlays(page: Page): Promise<boolean> {
  let cleared = false;
  for (const selector of [SEL.getReady, SEL.receivedTroops]) {
    const overlay = page.locator(selector);
    if ((await overlay.count()) === 0) continue;
    if (!(await overlay.first().isVisible().catch(() => false))) continue;
    cleared = true;
    // Both are `Stage`s with `onBackdropClick`, so a tap in the corner lifts
    // them; if the corner is not the backdrop they go on their own, so the
    // wait is the fallback rather than the plan.
    await overlay.first().click({ position: { x: 4, y: 4 }, timeout: 5_000 }).catch(() => undefined);
    await overlay
      .first()
      .waitFor({ state: "hidden", timeout: 8_000 })
      .catch(() => undefined);
  }
  return cleared;
}

/* ------------------------------------------------- board interaction --- */

/**
 * A client point that lies **inside** territory `id` and that the browser's
 * own hit test resolves back to it — or `null` if there is no such point with
 * the camera where it currently is.
 *
 * Three naive answers, all wrong:
 *
 *  - **Playwright's own click on `[data-territory="i"]`** aims at the
 *    bounding-box centre, which for a concave landmass is in the sea: the
 *    centre of Chile's box is in the Pacific.
 *  - **The token anchor** is a `polylabel` pole of inaccessibility and so is
 *    always inside the polygon, but it is frequently off-screen — a portrait
 *    board in a landscape viewport shows about 40% of itself, because minimum
 *    zoom is the *cover* scale.
 *  - **Any point in the fill** can still be covered. The `.routes` and
 *    `.continent-rings` layers are painted *after* `.territories` and neither
 *    sets `pointer-events: none`, so a sea-route node genuinely intercepts a
 *    tap; and on a 412 px phone the action bar's `pointer-events-auto` inner
 *    column (prompt, phase label, pips, primary pill) covers much of the
 *    lower third.
 *
 * So: ask the path itself which points are in its fill (`isPointInFill`, in
 * its own user space), map them to the page through the path's
 * `getScreenCTM()`, and keep the first one `document.elementFromPoint`
 * resolves back to this territory. `elementFromPoint` is both the arbiter
 * here and the app's own hit test (`src/game/input.ts`), and it already
 * honours `pointer-events`, so there is no list of HUD rectangles to keep in
 * step with the layout — if the browser says the tap lands on the territory,
 * the session will agree.
 */
export async function findTerritoryPoint(
  page: Page,
  id: number,
): Promise<{ x: number; y: number } | null> {
  return page.evaluate((territory) => {
    const path = document.querySelector(`path[data-territory="${territory}"]`);
    if (!(path instanceof SVGGeometryElement)) return null;
    const ctm = path.getScreenCTM();
    if (!ctm) return null;

    const hits = (x: number, y: number): boolean => {
      if (x < 2 || y < 2 || x > window.innerWidth - 2 || y > window.innerHeight - 2) return false;
      const element = document.elementFromPoint(x, y);
      const owner = element?.closest?.("[data-territory]") ?? null;
      return owner !== null && owner.getAttribute("data-territory") === String(territory);
    };

    const toClient = (x: number, y: number) => {
      const p = new DOMPoint(x, y).matrixTransform(ctm);
      return { x: p.x, y: p.y };
    };

    const bbox = path.getBBox();
    const cx = bbox.x + bbox.width / 2;
    const cy = bbox.y + bbox.height / 2;

    const candidates: { x: number; y: number }[] = [];
    const token = document.querySelector(`[data-token="${territory}"]`);
    if (token) {
      const r = token.getBoundingClientRect();
      candidates.push({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
    }
    // A 15×15 lattice over the path's own bbox, keeping only what is in the
    // fill, nearest the bbox centre first.
    const inside: { x: number; y: number }[] = [];
    for (let i = 1; i < 15; i += 1) {
      for (let j = 1; j < 15; j += 1) {
        const x = bbox.x + (bbox.width * i) / 15;
        const y = bbox.y + (bbox.height * j) / 15;
        if (path.isPointInFill(new DOMPoint(x, y))) inside.push({ x, y });
      }
    }
    inside.sort((a, b) => (a.x - cx) ** 2 + (a.y - cy) ** 2 - ((b.x - cx) ** 2 + (b.y - cy) ** 2));
    for (const p of inside) candidates.push(toClient(p.x, p.y));

    for (const c of candidates) if (hits(c.x, c.y)) return { x: c.x, y: c.y };
    return null;
  }, id);
}

/**
 * Where to drop a panned-to territory.
 *
 * Several places, tried in turn: the HUD is fixed and the board is not, so a
 * territory that lands under the action bar at one offset is clear of it at
 * the next. 0.3 of the height first, because that is clear of both the title
 * pill and the bar at every viewport the suite runs.
 */
const PAN_TARGETS: readonly (readonly [number, number])[] = [
  [0.5, 0.3],
  [0.38, 0.42],
  [0.62, 0.24],
  [0.5, 0.5],
  [0.3, 0.2],
  [0.7, 0.4],
];

/** The territory's bbox centre, in page coordinates. */
async function territoryCentre(page: Page, id: number): Promise<{ x: number; y: number }> {
  const centre = await page.evaluate((territory) => {
    const path = document.querySelector(`path[data-territory="${territory}"]`);
    if (!(path instanceof SVGGeometryElement)) return null;
    const ctm = path.getScreenCTM();
    if (!ctm) return null;
    const bbox = path.getBBox();
    const p = new DOMPoint(bbox.x + bbox.width / 2, bbox.y + bbox.height / 2).matrixTransform(ctm);
    return { x: p.x, y: p.y };
  }, id);
  if (!centre) throw new Error(`territory ${id} is not on the board`);
  return centre;
}

/** One pan, aiming the territory's centre at a fraction of the stage. */
async function panToward(
  page: Page,
  id: number,
  box: { x: number; y: number; width: number; height: number },
  fx: number,
  fy: number,
): Promise<void> {
  const target = { x: Math.round(box.x + box.width * fx), y: Math.round(box.y + box.height * fy) };
  const from = await territoryCentre(page, id);
  const dx = target.x - from.x;
  const dy = target.y - from.y;
  if (Math.abs(dx) <= 2 && Math.abs(dy) <= 2) return;

  await page.mouse.move(target.x, target.y);
  await page.mouse.down();
  await page.mouse.move(target.x + dx * 0.4, target.y + dy * 0.4, { steps: 4 });
  await page.mouse.move(target.x + dx, target.y + dy, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(70);
}

/**
 * Move the camera until territory `id` is somewhere tappable, using only the
 * gestures §9 gives a player: a drag past `DRAG_SLOP` to pan, and the wheel
 * to zoom.
 *
 * **Panning alone is not enough, and the reason is the camera contract.**
 * Minimum zoom is the *cover* scale, so a portrait board in a landscape
 * viewport (South America is 1100×1500 in a 1280×720 window) covers the width
 * exactly — which means the horizontal pan range is **zero**, and a territory
 * on the board's right edge sits permanently under the roster capsules at
 * x 87–100%. Zooming in makes the board wider than the viewport, which is
 * what unlocks horizontal panning; it also makes the polygon bigger, which
 * makes the hit test easier. So each zoom step gets a full sweep of pan
 * targets before the next one.
 */
export async function revealTerritory(page: Page, id: number): Promise<{ x: number; y: number }> {
  const direct = await findTerritoryPoint(page, id);
  if (direct) return direct;

  // **Before blaming the camera, check what is on top of it.** `Received
  // Troops` is raised at the start of every draft and `Get Ready` on the
  // viewer's first turn; both are full-screen `Stage`s, so while one is up
  // `elementFromPoint` answers with the overlay and *no* territory is
  // reachable. Dismissing overlays once up front is not enough — the award
  // popup appears when the award lands, which can be after the wait for the
  // turn has already returned.
  if (await dismissOverlays(page)) {
    const uncovered = await findTerritoryPoint(page, id);
    if (uncovered) return uncovered;
  }

  const box = await page.locator(SEL.boardStage).boundingBox();
  if (!box) throw new Error("the board stage has no bounding box");

  for (let zoomStep = 0; zoomStep < 4; zoomStep += 1) {
    if (zoomStep > 0) {
      const over = await territoryCentre(page, id);
      await page.mouse.move(
        Math.min(Math.max(over.x, box.x + 4), box.x + box.width - 4),
        Math.min(Math.max(over.y, box.y + 4), box.y + box.height - 4),
      );
      // Negative deltaY is a zoom in, one notch per `WHEEL_STEP` (§9).
      await page.mouse.wheel(0, -240);
      await page.waitForTimeout(70);
      const zoomed = await findTerritoryPoint(page, id);
      if (zoomed) return zoomed;
    }

    for (const [fx, fy] of PAN_TARGETS) {
      await panToward(page, id, box, fx, fy);
      const point = await findTerritoryPoint(page, id);
      if (point) return point;
    }
  }

  throw new Error(`no tappable point for territory ${id} after panning and zooming`);
}

/**
 * Reset the camera to the board-fits-the-viewport default — `0`, per §9.
 *
 * Worth doing between turns: `revealTerritory` zooms in to reach an edge
 * territory and leaves it there, and a zoomed-in board means more panning for
 * the next tap.
 */
export async function resetCamera(page: Page): Promise<void> {
  await page.locator(SEL.boardStage).click({ position: { x: 2, y: 2 }, timeout: 5_000 }).catch(() => undefined);
  await page.keyboard.press("0");
  await page.waitForTimeout(60);
}

/** True when territory `id` can be tapped without panning first. */
export async function canTapTerritory(page: Page, id: number): Promise<boolean> {
  return (await findTerritoryPoint(page, id)) !== null;
}

/**
 * Tap a territory the way a player does: a real pointer event on the stage.
 *
 * `bringToFront` is not decoration. This suite drives **two pages at once**
 * in the online spec, and a page that is not the foreground tab is throttled
 * by the browser — `requestAnimationFrame` stops, so the dirty-flag render
 * loop never repaints and the camera the hit test was computed against drifts
 * from the one the session reads. Raising the page first is what makes a tap
 * on window B behave like a tap on window A.
 */
export async function tapTerritory(page: Page, id: number): Promise<void> {
  await page.bringToFront();
  const point = await revealTerritory(page, id);
  await page.mouse.click(point.x, point.y);
}

/**
 * The same tap as a pair of synthetic `PointerEvent`s on the element under
 * the point.
 *
 * A fallback, used only when a real `mouse.click` demonstrably did nothing.
 * `src/game/input.ts` listens for `pointerdown` / `pointerup` on `#stage` and
 * hit-tests with `document.elementFromPoint`, so this exercises exactly the
 * same code path — it just does not depend on the browser's own input
 * pipeline delivering to this particular page.
 */
export async function syntheticTap(page: Page, point: { x: number; y: number }): Promise<void> {
  await page.evaluate(({ x, y }) => {
    const target = document.elementFromPoint(x, y) ?? document.getElementById("stage");
    if (!target) return;
    const init: PointerEventInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: 1,
      isPrimary: true,
      pointerType: "mouse",
      clientX: x,
      clientY: y,
      button: 0,
    };
    target.dispatchEvent(new PointerEvent("pointerdown", { ...init, buttons: 1 }));
    target.dispatchEvent(new PointerEvent("pointerup", { ...init, buttons: 0 }));
  }, point);
}

/* ------------------------------------------------ driving one turn ----- */

/**
 * The territories the board is currently lighting as legal targets.
 *
 * Read off `data-state="target"`, which `src/render/board.ts` writes from the
 * session's `litZone` — so this is the renderer's own answer to "where may I
 * attack from here", not a second adjacency table the suite would have to
 * keep in step with the maps.
 */
export async function litTargets(page: Page): Promise<number[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-territory][data-state="target"]')]
      .map((node) => Number(node.getAttribute("data-territory")))
      .filter((n) => Number.isInteger(n)),
  );
}

/** Tap `id` and wait for the board to finish lighting its zone. */
export async function selectTerritory(page: Page, id: number): Promise<number[]> {
  await tapTerritory(page, id);
  await expect
    .poll(
      () =>
        page.evaluate(
          (territory) =>
            document
              .querySelector(`[data-territory="${territory}"]`)
              ?.getAttribute("data-state") ?? null,
          id,
        ),
      { timeout: 10_000, message: `territory ${id} never became selected` },
    )
    .toBe("selected");
  return litTargets(page);
}

/** Confirm the open count dialog at its maximum. `a` is the §9 "all" key. */
export async function confirmCountMax(page: Page): Promise<void> {
  const slider = page.locator(SEL.countSlider);
  await slider.waitFor({ timeout: 10_000 });
  await page.keyboard.press("a");
  await slider.locator(SEL.countConfirm).click(CLICK);
  await slider.waitFor({ state: "hidden", timeout: 10_000 });
}

/**
 * Place every undrafted troop on one territory, through the real slider.
 *
 * One tap, because the slider's maximum is the whole undrafted pool: a single
 * stack is both fewer interactions and a better opening than spreading, which
 * matters when the point is to finish a game.
 */
export async function draftOnce(page: Page): Promise<void> {
  const state = await readState(page);
  const seat = actingSeat(state);
  const mine = ownedBy(state, seat);
  expect(mine.length, "the drafting seat owns nothing").toBeGreaterThan(0);

  const slider = page.locator(SEL.countSlider);
  const tried: string[] = [];
  await watchStageTaps(page);
  for (const territory of await orderByReachability(page, mine)) {
    let point: { x: number; y: number };
    let direct = false;
    try {
      await page.bringToFront();
      direct = (await findTerritoryPoint(page, territory)) !== null;
      point = await revealTerritory(page, territory);
      await page.mouse.click(point.x, point.y);
      if ((await page.locator(SEL.countSlider).count()) === 0) {
        await page.mouse.click(point.x, point.y);
      }
    } catch {
      tried.push(`${territory}:unreachable`);
      continue; // unreachable with the camera where it is; try the next one
    }
    // Wait for the dialog rather than counting immediately: the tap goes
    // through zustand into React, so the slider is one render away, not zero.
    try {
      await slider.waitFor({ timeout: 2_000 });
    } catch {
      await syntheticTap(page, point);
      try {
        await slider.waitFor({ timeout: 2_000 });
        tried.push(`${territory}:synthetic-worked`);
        await confirmCountMax(page);
        return;
      } catch {
        /* fall through to the diagnostic below */
      }
      const painted = await page
        .locator(SEL.territory(territory))
        .getAttribute("data-state")
        .catch(() => "?");
      const owner = await page
        .locator(SEL.territory(territory))
        .getAttribute("data-owner")
        .catch(() => "?");
      const under = await page.evaluate(
        ({ x, y }) => {
          const el = document.elementFromPoint(x, y);
          return el ? (el.getAttribute("data-territory") ?? el.getAttribute("data-testid") ?? el.tagName) : "null";
        },
        point,
      );
      tried.push(
        `${territory}:no-slider(state=${painted},owner=${owner}/${state.territories[territory]?.owner},` +
          `pt=${Math.round(point.x)},${Math.round(point.y)},under=${under},direct=${direct})`,
      );
      continue;
    }
    await confirmCountMax(page);
    return;
  }
  throw new Error(
    `no owned territory accepted a draft tap — ${await describeBoard(page)} ` +
      `toPlace=${state.troopsToPlace} taps=[${(await readStageTaps(page)).slice(0, 8).join(" ")}] ` +
      `tried=[${tried.slice(0, 4).join(" ")}]`,
  );
}

/**
 * Record every pointer event that reaches the board, from now on.
 *
 * Diagnostic only, and worth keeping: "the tap did nothing" has two very
 * different causes — the event never arrived (the board's listener is gone,
 * or something is sitting on top of it) or it arrived and the session refused
 * it — and no amount of staring at `data-state` tells those apart.
 */
export async function watchStageTaps(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __riskTaps?: string[]; __riskTapsOn?: boolean };
    w.__riskTaps = [];
    if (w.__riskTapsOn) return;
    w.__riskTapsOn = true;
    for (const type of ["pointerdown", "pointerup"]) {
      document.addEventListener(
        type,
        (event) => {
          const target = event.target as Element | null;
          const onStage = Boolean(target?.closest?.("#stage"));
          w.__riskTaps!.push(type + (onStage ? "@stage" : "@" + (target?.tagName ?? "?")));
        },
        true,
      );
    }
  });
}

/** What {@link watchStageTaps} has seen since it was armed. */
export async function readStageTaps(page: Page): Promise<string[]> {
  return page.evaluate(
    () => (window as unknown as { __riskTaps?: string[] }).__riskTaps ?? ["not-watching"],
  );
}

/**
 * What is on top of the board right now, for a failure message.
 *
 * Every "the tap did nothing" bug in this suite has had the same shape: a
 * full-screen `Stage` overlay (`Get Ready`, `Received Troops`) still up, so
 * `elementFromPoint` answers with the overlay and no territory is reachable.
 * Printing the element under the middle of the screen turns a ten-minute hunt
 * into a one-line answer.
 */
export async function describeBoard(page: Page): Promise<string> {
  return page.evaluate(() => {
    const at = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    const label = at
      ? (at.getAttribute("data-territory") ?? at.getAttribute("data-testid") ?? at.tagName)
      : "nothing";
    const dialogs = [...document.querySelectorAll('[role="dialog"]')]
      .map((n) => n.getAttribute("data-testid") ?? n.getAttribute("aria-label") ?? "dialog")
      .join(",");
    const screen = document.querySelector('[data-testid="game-screen"]');
    const primary = document.querySelector('[data-testid="primary-action"]');
    return (
      `centre=${label} dialogs=[${dialogs}] ` +
      `phase=${screen?.getAttribute("data-phase")} ` +
      `acting=${screen?.getAttribute("data-acting-seat")} ` +
      `viewer=${screen?.getAttribute("data-viewer-seat")} ` +
      `primary="${primary?.textContent?.trim() ?? "-"}" ` +
      `stageHidden=${document.querySelector('[data-testid="board-stage"]')?.getAttribute("data-hidden")} ` +
      `painted=${document.querySelectorAll('[data-territory]:not([data-owner="none"])').length} ` +
      `paths=${document.querySelectorAll("[data-territory]").length} ` +
      `stages=${document.querySelectorAll("#stage").length} ` +
      `screens=${document.querySelectorAll('[data-testid="game-screen"]').length}`
    );
  });
}

/**
 * Reachable-without-panning first, so a turn costs as few drags as possible,
 * and the biggest stack first within each group — concentration compounds.
 */
async function orderByReachability(page: Page, ids: readonly number[]): Promise<number[]> {
  const state = await readState(page);
  const scored: { id: number; near: boolean; troops: number }[] = [];
  for (const id of ids) {
    scored.push({ id, near: await canTapTerritory(page, id), troops: state.territories[id]?.troops ?? 0 });
  }
  return [...scored]
    .sort((a, b) => Number(b.near) - Number(a.near) || b.troops - a.troops)
    .map((s) => s.id);
}

/**
 * Resolve a pending post-conquest move with `Move All`.
 *
 * The move-in dialog is not raised by the tap that caused it: the session
 * sets `countRequest` from `refreshSelection` but leaves `modal` alone, and
 * the primary pill becomes `Move Troops` — so the player's next press is what
 * opens it. This follows that path rather than reaching for `confirmCount`.
 */
export async function resolveMoveIn(page: Page): Promise<void> {
  const state = await readState(page);
  if (!state.pendingMoveIn) return;
  await page.locator(SEL.primary).click(CLICK);
  const slider = page.locator(SEL.countSlider);
  await slider.waitFor({ timeout: 10_000 });
  await slider.locator(SEL.countMoveAll).click(CLICK);
  await slider.locator(SEL.countConfirm).click(CLICK);
  await waitForState(page, (s) => s.pendingMoveIn === null, {
    message: "the move-in never resolved",
  });
}

export interface BlitzResult {
  readonly fought: boolean;
  readonly captured: boolean;
}

/**
 * One Blitz from `from` into a lit neighbour: select, tap the target, then
 * `BATTLE`.
 *
 * Returns `fought: false` when the board lit nothing — which is the ordinary
 * answer for an interior territory and not a failure.
 */
export async function blitzFrom(page: Page, from: number): Promise<BlitzResult> {
  const before = await readState(page);
  // A territory wedged into a corner under the HUD is one the caller should
  // try later from somewhere else, not a failed test — `playHumanTurn` has
  // other stacks to attack from.
  if (!(await canTapTerritory(page, from))) {
    try {
      await revealTerritory(page, from);
    } catch {
      return { fought: false, captured: false };
    }
  }
  const targets = await selectTerritory(page, from);
  if (targets.length === 0) return { fought: false, captured: false };

  // The weakest neighbour first, so a short game actually ends. Under fog the
  // count reads -1 for a hidden tile, which sorts first — also fine, since
  // fog is exactly when a player has to guess too. Reachability decides
  // between equals: a lit tile wedged under the HUD is a later problem.
  const ordered = [...targets].sort(
    (a, b) => (before.territories[a]?.troops ?? 0) - (before.territories[b]?.troops ?? 0),
  );

  let target: number | null = null;
  for (const candidate of ordered) {
    try {
      await revealTerritory(page, candidate);
      target = candidate;
      break;
    } catch {
      // keep looking; panning for one target does not unselect `from`,
      // because a drag past DRAG_SLOP is never a tap (§9).
    }
  }
  if (target === null) return { fought: false, captured: false };

  await tapTerritory(page, target);
  const blitz = page.locator(SEL.blitzView);
  await blitz.waitFor({ timeout: 10_000 });
  await blitz.locator(SEL.blitzBattle).click(CLICK);
  await blitz.waitFor({ state: "hidden", timeout: 15_000 });

  // The dice have resolved when the simulation moved: either the target
  // changed hands (a move-in is pending) or somebody lost troops.
  const after = await waitForState(
    page,
    (s) =>
      s.outcome !== null ||
      s.pendingMoveIn !== null ||
      s.territories[target]?.owner !== before.territories[target]?.owner ||
      s.territories[target]?.troops !== before.territories[target]?.troops ||
      s.territories[from]?.troops !== before.territories[from]?.troops,
    { message: `the blitz ${from}→${target} changed nothing` },
  );

  const captured = after.pendingMoveIn !== null;
  if (captured) await resolveMoveIn(page);
  return { fought: true, captured };
}

/** Press the primary pill, answering the end-turn confirmation if it appears. */
export async function pressPrimary(page: Page): Promise<void> {
  const primary = page.locator(SEL.primary);
  await expect(primary).toBeEnabled({ timeout: 15_000 });
  await primary.click(CLICK);
  const confirm = page.locator(SEL.endTurnConfirm);
  if ((await confirm.count()) > 0) {
    await confirm.locator(SEL.endTurnYes).click(CLICK);
    await confirm.waitFor({ state: "hidden", timeout: 10_000 });
  }
}

/**
 * A tradeable trio out of a hand's suits, by R21 — **restated here, not
 * imported.** Three of a kind, one of each, or anything with a Wild in it.
 *
 * The card fan carries `data-suit` on every card, so the suite can pick a
 * legal set the way a player reading the fan does. The alternative was to
 * select any three and let the reducer refuse them, which would have hung on
 * a forced trade for ever.
 */
export function findTradeSet(suits: readonly string[]): [number, number, number] | null {
  for (let i = 0; i < suits.length; i += 1) {
    for (let j = i + 1; j < suits.length; j += 1) {
      for (let k = j + 1; k < suits.length; k += 1) {
        const trio = [suits[i]!, suits[j]!, suits[k]!];
        if (trio.some((s) => s === "wild")) return [i, j, k];
        const distinct = new Set(trio).size;
        if (distinct === 1 || distinct === 3) return [i, j, k];
      }
    }
  }
  return null;
}

/**
 * Tap one card in the fan.
 *
 * A plain click, at every viewport the suite runs. The card-trade panel lays
 * itself out in SPEC §7.2's measured 1600×900 stage, uniformly scaled to fit
 * — which on a 412 px phone is a 412×232 letterbox with every card of the
 * hand inside it.
 */
async function pickCard(card: Locator): Promise<void> {
  await card.click(CLICK);
  await expect(card).toHaveAttribute("data-selected", "true", { timeout: 5_000 });
}

/**
 * Clear a forced trade-down, which blocks every other action (R26, R27).
 *
 * Loops, because trading one set can still leave five cards and another set
 * — the forced-trade check runs again and the pill says `Trade In Now` a
 * second time.
 */
export async function tradeIfForced(page: Page): Promise<boolean> {
  let traded = false;
  for (let guard = 0; guard < 4; guard += 1) {
    const label = await page.locator(SEL.primary).innerText().catch(() => "");
    if (!/Trade In Now/i.test(label)) return traded;

    await page.locator(SEL.primary).click(CLICK);
    const panel = page.locator(SEL.cardTradePanel);
    await panel.waitFor({ timeout: 10_000 });

    // D110 — the panel opens with the best set already picked, so the pill is live at once.
    // The manual pick is kept as the fallback for a panel that, for any reason, opened empty.
    const cards = panel.locator("[data-suit]");
    const preselected = await panel.locator('[data-suit][data-selected="true"]').count();
    if (preselected !== 3) {
      // `[data-suit]` matches only the cards themselves — `card-<id>-selected`
      // is a sibling marker and `card-bonus-territory` is a caption.
      const suits = await cards.evaluateAll((nodes) =>
        nodes.map((n) => n.getAttribute("data-suit") ?? ""),
      );
      const trio = findTradeSet(suits);
      expect(trio, `a forced trade with no tradeable set: ${suits.join(",")}`).not.toBeNull();
      for (const index of trio!) await pickCard(cards.nth(index));
    }

    const pill = panel.locator(SEL.tradeInNow);
    await expect(pill).toBeEnabled({ timeout: 10_000 });
    await pill.click(CLICK);
    await panel.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => undefined);
    traded = true;
  }
  return traded;
}

/** One blitz from the best available stack. False when nothing could fight. */
async function attackOnce(page: Page, state: DebugState): Promise<boolean> {
  const seat = actingSeat(state);
  const sources = ownedBy(state, seat)
    .filter((t) => (state.territories[t]?.troops ?? 0) >= 2)
    .sort((a, b) => (state.territories[b]?.troops ?? 0) - (state.territories[a]?.troops ?? 0));

  for (const from of sources.slice(0, 5)) {
    const result = await blitzFrom(page, from);
    if (result.fought) return true;
  }
  return false;
}

/**
 * One whole human turn, played the way a player plays it: draft, blitz, move
 * in, end the turn.
 *
 * Written as a loop over the **current phase** rather than as a straight line
 * through draft → attack → fortify, because the phase can go backwards: a
 * forced trade-down during Attack puts the bonus troops into `troopsToPlace`
 * and reverts the phase to `draft` until they are placed (R27), and a
 * straight-line driver would already have walked past the draft arm. The loop
 * also makes the post-conquest move-in just another state to react to rather
 * than a special case after every battle.
 *
 * Deliberately greedy and deliberately not clever: the point of T10.2 is that
 * the **HUD** can carry a game to its end, not that the suite plays well.
 */
export async function playHumanTurn(page: Page, maxAttacks = 8): Promise<DebugState> {
  let state = await waitForHumanTurn(page);
  if (state.outcome) return state;

  // Put the camera back to the board-fits-the-viewport default before each
  // turn. `revealTerritory` zooms in to reach an edge territory and leaves it
  // there, and a board left at 4× means every tap next turn starts with a
  // pan — which is most of this driver's wall-clock time.
  await resetCamera(page);

  const startTurn = state.turn;
  const mySeat = await viewerSeatOf(page);
  let attacks = 0;

  for (let guard = 0; guard < 160; guard += 1) {
    state = await readState(page);
    if (state.outcome) return state;
    // The turn has moved on — either we ended it, or the timer did.
    if (state.turn !== startTurn) return state;
    const seat = actingSeat(state);
    // Not a human, or not *this* screen's human: either way, not ours to play.
    if (state.seats[seat]?.kind !== "human" || seat !== mySeat) return state;

    if (state.pendingMoveIn) {
      await resolveMoveIn(page);
      continue;
    }
    if (await tradeIfForced(page)) continue;

    if (state.phase === "draft") {
      if (state.troopsToPlace > 0) await draftOnce(page);
      else await pressPrimary(page); // End Draft Phase
      continue;
    }

    if (state.phase === "attack") {
      if (attacks < maxAttacks && (await attackOnce(page, state))) {
        attacks += 1;
        continue;
      }
      await pressPrimary(page); // End Attack Phase
      continue;
    }

    if (state.phase === "fortify") {
      await pressPrimary(page); // End Turn, via the amber confirmation
      continue;
    }

    return state; // `claim` or `over` — not this driver's business
  }

  return readState(page);
}

/* --------------------------------------------------- state helpers ----- */

export function actingSeat(state: DebugState): number {
  return state.turnOrder[state.currentIndex] ?? state.turnOrder[0] ?? 0;
}

/** The single human seat offline. Nothing may assume it is seat 0: `turnOrder` comes from the seed. */
export function humanSeats(state: DebugState): number[] {
  return state.seats.filter((s) => s.kind === "human").map((s) => s.seat);
}

export function ownedBy(state: DebugState, seat: number): number[] {
  const out: number[] = [];
  state.territories.forEach((t, i) => {
    if (t.owner === seat) out.push(i);
  });
  return out;
}

export function troopsOf(state: DebugState, seat: number): number {
  return state.territories.reduce((n, t) => (t.owner === seat ? n + t.troops : n), 0);
}

/** The seat whose fog and HUD this screen is showing, off `GameScreen`. */
export async function viewerSeatOf(page: Page): Promise<number> {
  return Number(await page.locator(SEL.gameScreen).getAttribute("data-viewer-seat"));
}

/**
 * Wait until **this screen's own seat** is acting and will accept a tap.
 *
 * "A human seat is acting" is not enough, and the difference is not academic:
 * online *both* seats are human, so a window whose opponent is mid-turn would
 * pass that test and then tap a board the session refuses (`canAct()` requires
 * `actingSeat() === mySeat()`), which surfaces as the draft slider simply
 * never opening. The viewer seat is the right question in all three modes —
 * offline it is the single human, in Pass & Play it is whoever last pressed
 * CONTINUE, and online it is `you.seat`.
 *
 * Reads `state()` rather than the HUD: the primary pill says `Opponent's Turn`
 * for a bot *and* for the brief window where a bot's last action has applied
 * but the UI slice has not caught up, and only the state can tell those apart.
 */
export async function waitForHumanTurn(page: Page, timeout = 120_000): Promise<DebugState> {
  const deadline = Date.now() + timeout;
  for (;;) {
    const state = await readState(page);
    if (state.outcome !== null) return state;
    const acting = actingSeat(state);
    if (state.seats[acting]?.kind === "human" && acting === (await viewerSeatOf(page))) {
      // The hand-off overlay conceals the board and blocks every tap, and it
      // lives in the DOM rather than in the state.
      const blocked =
        (await page.locator(SEL.handOff).count()) > 0 ||
        (await page.locator(SEL.boardStage).getAttribute("data-hidden")) === "true";
      if (!blocked) {
        await dismissOverlays(page);
        return state;
      }
    }
    if (Date.now() > deadline) {
      throw new Error(
        `this screen's seat never got the turn within ${timeout} ms ` +
          `(phase=${state.phase} round=${state.round} acting=${acting})`,
      );
    }
    await page.waitForTimeout(120);
  }
}

/** Wait until `state()` satisfies `predicate`, reading simulation truth only. */
export async function waitForState(
  page: Page,
  predicate: (state: DebugState) => boolean,
  options: { timeout?: number; message?: string } = {},
): Promise<DebugState> {
  const timeout = options.timeout ?? 60_000;
  const deadline = Date.now() + timeout;
  for (;;) {
    const state = await readState(page);
    if (predicate(state)) return state;
    if (Date.now() > deadline) {
      throw new Error(
        options.message ??
          `state never matched within ${timeout} ms (phase=${state.phase} round=${state.round})`,
      );
    }
    await page.waitForTimeout(100);
  }
}

/* --------------------------------------------------------- the API ----- */

export interface ApiResult<T> {
  readonly status: number;
  readonly body: T | null;
  readonly headers: Record<string, string>;
}

/**
 * One request through a context's own cookie jar.
 *
 * `page.request` and `context.request` share the browser context's cookies,
 * which is what makes two Playwright contexts two genuinely different
 * `risk_sid`s — and what lets a spec drive the protocol directly while the
 * same session is on screen.
 */
export async function api<T = unknown>(
  request: APIRequestContext,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<ApiResult<T>> {
  const response = await request.fetch(path, {
    method: init.method ?? "GET",
    ...(init.body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, data: JSON.stringify(init.body) }),
  });
  const text = await response.text();
  let body: T | null = null;
  if (text) {
    try {
      body = JSON.parse(text) as T;
    } catch {
      body = null;
    }
  }
  return { status: response.status(), body, headers: response.headers() };
}

/**
 * Append one action to an online game from a context's own cookie jar.
 *
 * This is the same request the browser makes — `pollingSync.submit` posts
 * exactly this body — so it drives the authority the way a client does. Used
 * where a spec needs a turn to *happen* rather than to be *performed through
 * the HUD*; T10.2 and T10.3 are the HUD tests.
 */
export async function postAction(
  request: APIRequestContext,
  gameId: string,
  clientActionId: string,
  action: Record<string, unknown>,
): Promise<ApiResult<{ seq: number; actions: LogRow[] }>> {
  return api(request, API.gameActions(gameId), {
    method: "POST",
    body: { clientActionId, kind: "action", action },
  });
}

/** The same, for an attack: the authority rolls the dice, never the client (F11). */
export async function postIntent(
  request: APIRequestContext,
  gameId: string,
  clientActionId: string,
  intent: Record<string, unknown>,
): Promise<ApiResult<{ seq: number; actions: LogRow[] }>> {
  return api(request, API.gameActions(gameId), {
    method: "POST",
    body: { clientActionId, kind: "intent", intent },
  });
}

/** `api`, but a non-2xx is the test's failure rather than something to branch on. */
export async function apiJson<T>(
  request: APIRequestContext,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const result = await api<T>(request, path, init);
  expect(result.status, `${init.method ?? "GET"} ${path} → ${result.status}`).toBeLessThan(300);
  if (result.body === null) throw new Error(`${path} returned no body`);
  return result.body;
}

/* ----------------------------------------------- two online contexts --- */

/** One `LoggedAction` row, as the raw log and POLL 3 both serialise it. */
export interface LogRow {
  readonly seq: number;
  readonly seat: number;
  readonly action: { readonly type: string } & Record<string, unknown>;
  readonly actor: "human" | "bot" | "server";
  readonly clientActionId: string | null;
  readonly stateHash: string;
}

export interface GameSyncBody {
  readonly seq: number;
  readonly snapshotSeq?: number;
  readonly snapshot?: Record<string, unknown> & { readonly fogged: boolean };
  readonly actions: readonly LogRow[];
  readonly chat: readonly { readonly id: number; readonly lineId: number | null; readonly emoji: string | null; readonly displayName: string }[];
  readonly presence: readonly { readonly seat: number; readonly online: boolean; readonly missedTurns: number }[];
  readonly turnDeadline: string | null;
  readonly you: { readonly seat: number | null };
  readonly status: string;
  readonly version?: number;
}

/**
 * Fresh names per run.
 *
 * A name is held for two minutes after its player leaves, and a player seated
 * in a live game is never reaped at all — which is the rule working, not a
 * bug. Re-running the suite against one data directory therefore needs new
 * names, and `:memory:` only helps while the server is also fresh.
 */
export function uniqueName(prefix: string): string {
  const tag = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix} ${tag}`;
}

export interface OnlinePlayer {
  readonly context: BrowserContext;
  readonly page: Page;
  readonly name: string;
  readonly playerId: string;
}

/** A browser context with its own cookie jar, its own name, and `/lobby` open. */
export async function newOnlinePlayer(
  browser: Browser,
  name: string,
  colour?: string,
): Promise<OnlinePlayer> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const playerId = await claimOnline(page, name, colour);
  return { context, page, name, playerId };
}

/* ------------------------------------------------- console hygiene ----- */

/**
 * Collect page errors and `console.error` for a spec to assert on at the end.
 *
 * `[risk] desync at seq N` is logged through `console.error` by the session
 * runner, so a spec that watches this array is also watching for a client
 * fold that disagreed with the authority's hash — which is the one failure a
 * polling design must never ship.
 */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${String(error)}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    // Chrome logs **every** non-2xx response as a console error, and this
    // suite provokes them on purpose: a `409` for a taken name, a `403` for a
    // guest pressing BATTLE, a `422` for a client-rolled attack, a `400` for
    // a free-text chat attempt, a `401` on the first poll before a session
    // exists. Those are assertions passing, not faults — so the filter is on
    // the *transport* noise only, and anything the app itself logged still
    // counts.
    if (/Failed to load resource/i.test(text)) return;
    errors.push(text);
  });
  return errors;
}
