import { expect, type Page } from "@playwright/test";

/**
 * Routes and selectors, re-declared rather than imported from `src/` — an
 * e2e suite that imports the app's own constants can only prove the app is
 * self-consistent (see `super-smash/e2e/helpers.ts`). Rename a route or a
 * test id in `src/` and these tests should go red.
 */
export const ROUTES = {
  title: "/",
  campaign: "/campaign",
  /** `?fresh=1` skips the autosave; `?debug=1` exposes `__islandDebug` in the production build the suite runs. */
  playCampaign: (levelId: string, difficulty = "easy") => `/play/campaign/${levelId}?fresh=1&debug=1&difficulty=${difficulty}`,
  playSession: "/play/session",
} as const;

export const SEL = {
  board: '[data-testid="board"]',
  hud: '[data-testid="hud-bar"]',
  income: '[data-testid="hud-income"]',
  gold: '[data-testid="hud-gold"]',
  card: (item: string) => `[data-testid="card-${item}"]`,
  undo: '[data-testid="undo-button"]',
  nextDay: '[data-testid="next-day-button"]',
  back: '[data-testid="back-button"]',
  infoCard: '[data-testid="info-card"]',
  tutorialBubble: '[data-testid="tutorial-bubble"]',
  tutorialOk: '[data-testid="tutorial-ok"]',
  levelLabel: '[data-testid="level-label"]',
  help: '[data-testid="help-button"]',
  helpModal: '[data-testid="help-modal"]',
  helpOk: '[data-testid="help-ok"]',
  settings: '[data-testid="settings-button"]',
  settingsModal: '[data-testid="settings-modal"]',
  settingsClose: '[data-testid="settings-close"]',
  endModal: '[data-testid="end-modal"]',
  dayBanner: '[data-testid="day-banner"]',
  handOff: '[data-testid="handoff-overlay"]',
} as const;

/* ------------------------------------------------------ debug handle ---- */

export interface Coord {
  x: number;
  y: number;
}

export interface DebugTile {
  x: number;
  y: number;
  terrain: string;
  owner: number | null;
  building: string | null;
  unit: { level: number; readyToMove: boolean } | null;
}

export interface DebugState {
  width: number;
  height: number;
  tiles: DebugTile[];
  provinces: Record<string, { id: string; owner: number; tileKeys: string[]; city: Coord; gold: number }>;
  players: Array<{ index: number; kind: string; eliminated: boolean }>;
  activePlayerIndex: number;
  turnNumber: number;
  history: unknown[];
  outcome: { winner: number } | null;
}

export type DebugAction =
  | { type: "MOVE"; unitAt: Coord; to: Coord }
  | { type: "BUY"; item: string; at: Coord }
  | { type: "UNDO" }
  | { type: "END_TURN" };

interface DebugHandle {
  state(): DebugState;
  applyForTest(action: DebugAction): void;
  skipAnimations(): void;
  ui(): { selected: Coord | null; aiPlaying: boolean; gameOver: boolean; handOff: boolean; banner: string | null };
  camera(): { x: number; y: number; tilePx: number };
  moveZone(at: Coord): Coord[];
  buildZone(item: string): Coord[];
}

/**
 * Not a `declare global` augmentation: `e2e/random.spec.ts` (S5) declares its
 * own narrower `Window.__islandDebug`, and two augmentations must agree.
 * The cast lives in one place instead.
 */
type DebugWindow = { __islandDebug?: DebugHandle };

export async function readState(page: Page): Promise<DebugState> {
  return page.evaluate(() => {
    const d = (window as unknown as DebugWindow).__islandDebug;
    if (!d) throw new Error("__islandDebug is not installed");
    return d.state();
  });
}

export async function readUi(page: Page) {
  return page.evaluate(() => (window as unknown as DebugWindow).__islandDebug!.ui());
}

export async function readCamera(page: Page) {
  return page.evaluate(() => (window as unknown as DebugWindow).__islandDebug!.camera());
}

export async function skipAnimations(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as DebugWindow).__islandDebug!.skipAnimations());
}

export async function debugInstalled(page: Page): Promise<boolean> {
  return page.evaluate(() => !!(window as unknown as DebugWindow).__islandDebug);
}

/** Throws (rejects) when the engine rejects the action — the same as the runner. */
export async function applyForTest(page: Page, action: DebugAction): Promise<void> {
  await page.evaluate((a) => (window as unknown as DebugWindow).__islandDebug!.applyForTest(a), action);
}

export async function tryApply(page: Page, action: DebugAction): Promise<boolean> {
  return page.evaluate((a) => {
    try {
      (window as unknown as DebugWindow).__islandDebug!.applyForTest(a);
      return true;
    } catch {
      return false;
    }
  }, action);
}

export async function moveZone(page: Page, at: Coord): Promise<Coord[]> {
  return page.evaluate((c) => (window as unknown as DebugWindow).__islandDebug!.moveZone(c), at);
}

export async function buildZone(page: Page, item: string): Promise<Coord[]> {
  return page.evaluate((i) => (window as unknown as DebugWindow).__islandDebug!.buildZone(i), item);
}

/* ----------------------------------------------------------- flows ------ */

/** Open a campaign level fresh, with the debug handle installed and animations skipped. */
export async function startLevel(page: Page, levelId = "01", difficulty = "easy"): Promise<void> {
  await page.goto(ROUTES.playCampaign(levelId, difficulty));
  await page.locator(SEL.board).waitFor();
  await expect.poll(() => debugInstalled(page), { timeout: 15_000 }).toBe(true);
  await skipAnimations(page);
  await dismissTutorial(page);
}

/** Dismiss every tutorial bubble currently queued. */
export async function dismissTutorial(page: Page): Promise<void> {
  for (let i = 0; i < 5; i++) {
    const ok = page.locator(SEL.tutorialOk);
    if ((await ok.count()) === 0) return;
    await ok.first().click();
    await page.waitForTimeout(50);
  }
}

/** Poll the debug handle until the human seat is acting again (AI done, banner gone). */
export async function waitForHumanTurn(page: Page, timeout = 30_000): Promise<void> {
  await page.waitForFunction(
    () => {
      const d = (window as unknown as { __islandDebug?: DebugHandle }).__islandDebug;
      if (!d) return false;
      const s = d.state();
      const ui = d.ui();
      return s.outcome !== null || (s.players[s.activePlayerIndex]?.kind === "human" && !ui.aiPlaying && !ui.handOff);
    },
    undefined,
    { timeout },
  );
}

/** Screen position of a tile's centre relative to the page, from the live camera. */
export async function tileCentre(page: Page, at: Coord): Promise<{ x: number; y: number }> {
  const cam = await readCamera(page);
  const box = await page.locator(SEL.board).boundingBox();
  if (!box) throw new Error("board has no bounding box");
  return {
    x: box.x + (at.x + 0.5 - cam.x) * cam.tilePx,
    y: box.y + (at.y + 0.5 - cam.y) * cam.tilePx,
  };
}

export async function tapTile(page: Page, at: Coord): Promise<void> {
  const p = await tileCentre(page, at);
  await page.mouse.click(p.x, p.y);
}

export function tileAt(s: DebugState, at: Coord): DebugTile | undefined {
  return s.tiles[at.y * s.width + at.x];
}

export function myUnits(s: DebugState, owner: number): DebugTile[] {
  return s.tiles.filter((t) => t.owner === owner && t.unit !== null);
}

function manhattan(a: Coord, b: Coord): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function enemyCities(s: DebugState, me: number): Coord[] {
  return Object.values(s.provinces)
    .filter((p) => p.owner !== me)
    .map((p) => p.city);
}

const UPKEEP: Record<number, number> = { 1: 2, 2: 5, 3: 12, 4: 30 };

/**
 * One scripted human turn through `applyForTest`: every ready unit marches
 * on the nearest enemy city (taking it when it can), then the province
 * merge-buys a knight up to level 2 — enough to beat a city — and adds a
 * second knight only while income still covers upkeep. It is deliberately
 * conservative: the first version of this script merged to level 3, went
 * bankrupt twice and lost level 01 to the Easy AI. Returns whether anything
 * happened.
 */
export async function playGreedyTurn(page: Page, me = 0): Promise<boolean> {
  let acted = false;
  for (let guard = 0; guard < 20; guard++) {
    const s = await readState(page);
    if (s.outcome) return acted;
    const ready = myUnits(s, me).find((t) => t.unit?.readyToMove);
    if (!ready) break;
    const zone = await moveZone(page, { x: ready.x, y: ready.y });
    const cities = enemyCities(s, me);
    const nearestCity = (c: Coord) => Math.min(...cities.map((k) => manhattan(c, k)), 99);
    const foreign = zone.filter((c) => tileAt(s, c)?.owner !== me);
    const rank = (c: Coord) => {
      const t = tileAt(s, c);
      if (!t) return -99;
      if (t.building === "city") return 100;
      if (t.building === "chest") return 50;
      return 20 - nearestCity(c) + (t.owner !== null ? 3 : 0);
    };
    foreign.sort((a, b) => rank(b) - rank(a));
    let moved = false;
    for (const target of foreign) {
      if (await tryApply(page, { type: "MOVE", unitAt: { x: ready.x, y: ready.y }, to: target })) {
        moved = true;
        acted = true;
        break;
      }
    }
    if (!moved) break;
  }
  const s = await readState(page);
  if (s.outcome) return acted;
  const income = s.tiles.filter((t) => t.owner === me).length;
  const units = myUnits(s, me).sort((a, b) => (b.unit?.level ?? 0) - (a.unit?.level ?? 0));
  const upkeep = units.reduce((n, t) => n + (UPKEEP[t.unit?.level ?? 1] ?? 0), 0);
  const zone = await buildZone(page, "knight1");
  const strongest = units[0];
  if (
    strongest &&
    (strongest.unit?.level ?? 0) < 2 &&
    zone.some((c) => c.x === strongest.x && c.y === strongest.y) &&
    income - (upkeep - 2 + 5) >= 0 &&
    (await tryApply(page, { type: "BUY", item: "knight1", at: { x: strongest.x, y: strongest.y } }))
  ) {
    return true;
  }
  if (units.length < 2 && income - (upkeep + 2) >= 0) {
    const cities = enemyCities(s, me);
    const capturable = zone
      .filter((c) => tileAt(s, c)?.owner !== me)
      .sort((a, b) => Math.min(...cities.map((k) => manhattan(a, k))) - Math.min(...cities.map((k) => manhattan(b, k))));
    if (capturable[0] && (await tryApply(page, { type: "BUY", item: "knight1", at: capturable[0] }))) acted = true;
  }
  return acted;
}
