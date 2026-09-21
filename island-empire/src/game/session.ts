import { createStore, type StoreApi } from "zustand/vanilla";

import type {
  Action,
  ApplyResult,
  BuyItem,
  EngineEvent,
  GameState,
  MapDefinition,
  Province,
  TileCoord,
  TutorialStep,
  TutorialTriggerId,
} from "@/engine/types";
import type { ProgressPort } from "@/ports/localProgress";
import type { Settings, SettingsPort } from "@/ports/settings";
import { DEFAULT_SETTINGS } from "@/ports/settings";
import { DURATION, type AnimState, createAnimState, enqueue, pruneAnims } from "@/render/animations";
import { type Camera, createCamera, ensureVisible } from "@/render/camera";
import { GOLD, UI } from "@/render/palette";
import type { ShieldBadge } from "@/render/renderer";

import { itemCost, knightLevelOf, parseKey, provinceOfTile, provincesOf, tileAt, tileIncome } from "./economy";
import type { EngineApi } from "./engineApi";
import type { SessionConfig } from "./sessionConfig";

/**
 * The client session runner (SPEC §4, §5): holds `GameState` in a ref,
 * mirrors the UI-observable slices into a zustand store, dispatches every
 * action through `engine.apply`, feeds `events` to the animation queue,
 * replays AI turns, fires tutorial triggers, autosaves, and records wins.
 * Nothing here is a rule — every legality question goes to the engine.
 */

export const AI_STEP_MS = 300;
/** An AI turn never takes longer than this to replay, however many actions it has. */
export const AI_TURN_BUDGET_MS = 4000;
export const AI_STEP_MIN_MS = 40;

/**
 * Per-action replay delay for one AI turn: 300 ms while the turn is short
 * enough to follow action by action, compressed towards 40 ms as the action
 * list grows so a rich late-game AI (60+ actions) still finishes in ~4 s.
 */
export function aiStepMs(actionCount: number): number {
  return Math.max(AI_STEP_MIN_MS, Math.min(AI_STEP_MS, Math.floor(AI_TURN_BUDGET_MS / Math.max(1, actionCount))));
}

export interface SessionUiState {
  /** Bumps on every `GameState` change so React re-reads `session.state`. */
  version: number;
  selected: TileCoord | null;
  /** Lit tiles: the move zone of the selected unit, or the placement zone. */
  litZone: TileCoord[];
  shields: ShieldBadge[];
  shopItem: BuyItem | null;
  banner: string | null;
  tutorialStep: TutorialStep | null;
  actingPlayer: number;
  aiPlaying: boolean;
  handOff: { player: number } | null;
  gameOver: { winner: number; humanWon: boolean } | null;
  modal: "settings" | "help" | null;
  toast: string | null;
  selectedAt: number;
  /** Board hidden behind the hot-seat hand-off overlay. */
  hidden: boolean;
  settings: Settings;
}

export interface SessionOptions {
  map: MapDefinition;
  config: SessionConfig;
  engine: EngineApi;
  settings?: SettingsPort | null;
  progress?: ProgressPort | null;
  now?: () => number;
  /** Timer injection for tests; must return a cancel function. */
  schedule?: (fn: () => void, ms: number) => () => void;
  skipAnimations?: boolean;
  viewport?: { w: number; h: number };
  /** A previously autosaved session to resume. */
  resume?: SavedSession | null;
  save?: (saved: SavedSession | null) => void;
}

export interface SavedSession {
  state: GameState;
  aiSeed: number;
  fired: TutorialTriggerId[];
  savedAt: number;
}

export interface Session {
  readonly state: GameState;
  readonly map: MapDefinition;
  readonly config: SessionConfig;
  readonly store: StoreApi<SessionUiState>;
  readonly anims: AnimState;
  camera: Camera;
  start(): void;
  tapTile(at: TileCoord): void;
  select(at: TileCoord | null): void;
  deselect(): void;
  chooseShopItem(item: BuyItem | null): void;
  /** Tap a shop card: enter placement mode, or merge-buy onto the selected unit. */
  tapCard(item: BuyItem): void;
  dispatch(action: Action): ApplyResult;
  undo(): void;
  endTurn(): void;
  setCamera(cam: Camera): void;
  dismissTutorial(): void;
  continueHandOff(): void;
  setModal(modal: SessionUiState["modal"]): void;
  updateSettings(patch: Partial<Settings>): void;
  destroy(): void;
  applyForTest(action: Action): void;
  skipAnimations(): void;
  isHumanTurn(): boolean;
  /** The seat whose HUD is shown: the acting human, or the first human. */
  viewerSeat(): number;
  /** The province whose gold/income the HUD shows (SPEC §7). */
  displayProvince(): Province | null;
  /** Renderer dirty flag: true once after any visible change. */
  takeDirty(): boolean;
  markDirty(): void;
  /** Runs the animation queue's housekeeping; returns whether anything is in flight. */
  tick(now: number): boolean;
}

function sameTile(a: TileCoord | null, b: TileCoord | null): boolean {
  return !!a && !!b && a.x === b.x && a.y === b.y;
}

function inZone(zone: TileCoord[], at: TileCoord): boolean {
  return zone.some((z) => z.x === at.x && z.y === at.y);
}

const defaultSchedule = (fn: () => void, ms: number): (() => void) => {
  const id = setTimeout(fn, ms);
  return () => clearTimeout(id);
};

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function createSession(options: SessionOptions): Session {
  const { map, config, engine } = options;
  const now = options.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  const schedule = options.schedule ?? defaultSchedule;
  const settingsPort = options.settings ?? null;
  const progressPort = options.progress ?? null;
  const save = options.save ?? (() => {});

  let skip = options.skipAnimations ?? false;
  const anims = createAnimState(skip);
  let state: GameState =
    options.resume?.state ??
    engine.createInitialState(map, config.seed, {
      seats: config.seats.map((s) => ({ kind: s.kind, aiDifficulty: s.aiDifficulty })),
      difficulty: config.difficulty,
    });
  let aiSeed = options.resume?.aiSeed ?? config.seed ^ 0x5eed;
  const fired = new Set<TutorialTriggerId>(options.resume?.fired ?? []);
  const tutorialQueue: TutorialStep[] = [];
  const timers = new Set<() => void>();
  let dirty = true;
  let destroyed = false;
  let recorded = false;
  const humanSeats = state.players.filter((p) => p.kind === "human").map((p) => p.index);
  const hotSeat = humanSeats.length >= 2;

  const viewport = options.viewport ?? { w: 800, h: 600 };
  let camera = createCamera(state.width, state.height, viewport.w, viewport.h);

  const store = createStore<SessionUiState>(() => ({
    version: 0,
    selected: null,
    litZone: [],
    shields: [],
    shopItem: null,
    banner: null,
    tutorialStep: null,
    actingPlayer: state.activePlayerIndex,
    aiPlaying: false,
    handOff: null,
    gameOver: null,
    modal: null,
    toast: null,
    selectedAt: 0,
    hidden: false,
    settings: settingsPort?.read() ?? DEFAULT_SETTINGS,
  }));

  const set = (patch: Partial<SessionUiState>) => {
    store.setState(patch);
    dirty = true;
  };

  const later = (fn: () => void, ms: number) => {
    // `cancel` is assigned after `schedule` returns; a synchronous test
    // scheduler runs `fn` before that, so the delete is guarded.
    let cancel: (() => void) | null = null;
    let fired = false;
    const c = schedule(
      () => {
        fired = true;
        if (cancel) timers.delete(cancel);
        if (!destroyed) fn();
      },
      skip ? 0 : ms,
    );
    cancel = c;
    if (!fired) timers.add(c);
    return c;
  };

  function persist(): void {
    if (state.outcome) {
      save(null);
      return;
    }
    save({ state, aiSeed, fired: [...fired], savedAt: Date.now() });
  }

  /* ------------------------------------------------------------ tutorial -- */

  function fire(id: TutorialTriggerId): void {
    const repeatable = id === "notEnoughGold";
    if (!repeatable && fired.has(id)) return;
    const step = map.tutorial.find((s) => s.triggerId === id);
    if (!repeatable) fired.add(id);
    if (!step) return;
    if (store.getState().tutorialStep) tutorialQueue.push(step);
    else set({ tutorialStep: step });
  }

  function dismissTutorial(): void {
    const next = tutorialQueue.shift() ?? null;
    set({ tutorialStep: next });
  }

  /* --------------------------------------------------------------- seats -- */

  function isHumanSeat(idx: number): boolean {
    return state.players[idx]?.kind === "human";
  }

  function isHumanTurn(): boolean {
    return isHumanSeat(state.activePlayerIndex) && !store.getState().aiPlaying;
  }

  function viewerSeat(): number {
    const active = state.activePlayerIndex;
    if (isHumanSeat(active)) return active;
    return humanSeats[0] ?? 0;
  }

  /* ----------------------------------------------------------- selection -- */

  function refreshSelection(): void {
    const ui = store.getState();
    const me = state.activePlayerIndex;
    if (ui.shopItem) {
      const zone = isHumanTurn() ? engine.legalBuildZone(state, ui.shopItem) : [];
      set({ litZone: zone, shields: shieldsFor(zone, me) });
      return;
    }
    if (!ui.selected) {
      if (ui.litZone.length || ui.shields.length) set({ litZone: [], shields: [] });
      return;
    }
    const t = tileAt(state, ui.selected);
    if (!t) {
      set({ selected: null, litZone: [], shields: [] });
      return;
    }
    if (t.unit && t.owner === me && t.unit.readyToMove && isHumanTurn()) {
      const zone = engine.legalMoveZone(state, ui.selected);
      set({ litZone: zone, shields: shieldsFor(zone, me) });
    } else {
      set({ litZone: [], shields: [] });
    }
  }

  function shieldsFor(zone: TileCoord[], me: number): ShieldBadge[] {
    const out: ShieldBadge[] = [];
    for (const z of zone) {
      const t = tileAt(state, z);
      if (!t || t.owner === me) continue;
      const defence = engine.defenceNumber(state, z);
      if (defence === 0) continue; // an undefended tile carries no badge (research §3)
      out.push({
        at: z,
        defence,
        colour: t.owner === null ? null : (state.players[t.owner]?.colour ?? null),
      });
    }
    return out;
  }

  function select(at: TileCoord | null): void {
    set({ selected: at, shopItem: null, selectedAt: now() });
    refreshSelection();
    if (at) {
      const t = tileAt(state, at);
      if (t?.unit && t.owner === state.activePlayerIndex && isHumanSeat(t.owner)) fire("unitSelected:first");
    }
  }

  function deselect(): void {
    if (store.getState().selected || store.getState().shopItem) select(null);
  }

  function chooseShopItem(item: BuyItem | null): void {
    set({ shopItem: item, selected: item ? null : store.getState().selected });
    refreshSelection();
  }

  function displayProvince(): Province | null {
    const ui = store.getState();
    const me = viewerSeat();
    if (ui.selected) {
      const p = provinceOfTile(state, ui.selected);
      if (p && p.owner === me) return p;
    }
    return provincesOf(state, me)[0] ?? null;
  }

  function tapCard(item: BuyItem): void {
    if (!isHumanTurn() || store.getState().gameOver) return;
    const ui = store.getState();
    const selectedTile = ui.selected ? tileAt(state, ui.selected) : null;
    const mergeTarget =
      selectedTile?.unit && selectedTile.owner === state.activePlayerIndex && knightLevelOf(item) !== null
        ? ui.selected
        : null;
    const province = mergeTarget ? provinceOfTile(state, mergeTarget) : displayProvince();
    const cost = itemCost(state, item, province);
    if (!province || province.gold < cost) {
      fire("notEnoughGold");
      set({ toast: "NOT ENOUGH GOLD" });
      later(() => set({ toast: null }), 900);
      return;
    }
    if (mergeTarget) {
      const level = knightLevelOf(item);
      if (level !== null && selectedTile?.unit && selectedTile.unit.level + level > 4) return;
      const r = dispatch({ type: "BUY", item, at: mergeTarget });
      if (!r.error) select(mergeTarget);
      return;
    }
    chooseShopItem(ui.shopItem === item ? null : item);
  }

  /* -------------------------------------------------------------- events -- */

  function colourOf(player: number | null) {
    return player === null ? null : (state.players[player]?.colour ?? null);
  }

  function handleEvents(events: EngineEvent[], action: Action | null, human: boolean): void {
    const t0 = now();
    let coinDelay = 0;
    for (const e of events) {
      switch (e.type) {
        case "moved": {
          const dst = tileAt(state, e.to);
          const level = dst?.unit?.level ?? 1;
          const colour = colourOf(e.player);
          if (colour) enqueue(anims, { type: "slide", from: e.from, to: e.to, level, colour, start: t0, duration: DURATION.slide });
          if (human && !events.some((x) => x.type === "captured" || x.type === "merged" || x.type === "fieldCleared")) {
            fire("unitMoved:first");
          }
          break;
        }
        case "captured": {
          const colour = colourOf(e.to);
          if (colour) enqueue(anims, { type: "flash", at: e.at, colour, start: t0 + DURATION.slide, duration: DURATION.flash });
          if (human) fire("captured:first");
          break;
        }
        case "cityDestroyed": {
          const colour = colourOf(e.owner);
          if (colour) enqueue(anims, { type: "crumble", at: e.at, colour, start: t0 + DURATION.slide, duration: DURATION.crumble });
          if (human && e.owner !== state.activePlayerIndex) fire("enemyCityCaptured");
          break;
        }
        case "income": {
          const province = state.provinces[e.provinceId];
          if (province) {
            let i = 0;
            for (const k of province.tileKeys) {
              const c = parseKey(k);
              const t = tileAt(state, c);
              if (!t || tileIncome(t) === 0 || (c.x === province.city.x && c.y === province.city.y)) continue;
              if (i++ >= 8) break;
              enqueue(anims, { type: "coin", from: c, to: province.city, start: t0 + coinDelay + i * DURATION.coinStagger, duration: DURATION.coin });
            }
          }
          enqueue(anims, { type: "float", at: e.city, text: `+${e.amount}`, colour: GOLD.face, start: t0 + coinDelay + DURATION.coin, duration: DURATION.float });
          coinDelay += 120;
          break;
        }
        case "upkeepPaid":
          enqueue(anims, { type: "float", at: { x: e.city.x, y: e.city.y }, text: `-${e.amount}`, colour: UI.unaffordableRed, start: t0 + coinDelay + DURATION.coin + 250, duration: DURATION.float });
          break;
        case "chestCollected":
          enqueue(anims, { type: "float", at: e.at, text: `+${e.amount}`, colour: GOLD.face, start: t0 + DURATION.slide, duration: DURATION.float });
          break;
        case "bankrupt": {
          const province = state.provinces[e.provinceId];
          const colour = colourOf(province?.owner ?? null);
          for (const k of province?.tileKeys ?? []) {
            const c = parseKey(k);
            if (tileAt(state, c)?.terrain === "grave") {
              enqueue(anims, { type: "fade", at: c, kind: "bankrupt", colour, level: 1, start: t0, duration: DURATION.bankrupt });
            }
          }
          break;
        }
        case "starved":
          enqueue(anims, { type: "fade", at: e.at, kind: "unit", colour: colourOf(state.activePlayerIndex), level: 1, start: t0, duration: DURATION.bankrupt });
          break;
        case "graveAged":
          if (e.nowField) enqueue(anims, { type: "fade", at: e.at, kind: "grave", colour: null, level: null, start: t0, duration: DURATION.graveFade });
          break;
        case "merged":
          if (human) fire("merged:first");
          break;
        case "fieldCleared":
          if (human) fire("fieldCleared:first");
          break;
        case "bought":
          if (human) {
            if (knightLevelOf(e.item) !== null) fire("bought:first");
            if (e.item === "woodwall") fire("bought:woodwall");
            if (e.item === "farm") fire("bought:farm");
          }
          break;
        default:
          break;
      }
    }
    void action;
  }

  /* ------------------------------------------------------------ dispatch -- */

  function dispatch(action: Action, internal = false): ApplyResult {
    if (destroyed) return { state, events: [], error: "session destroyed" };
    const ui = store.getState();
    if (!internal && (ui.aiPlaying || ui.handOff || ui.gameOver)) {
      return { state, events: [], error: "not your turn" };
    }
    const human = isHumanSeat(state.activePlayerIndex) && !internal;
    const result = engine.apply(state, action);
    if (result.error) {
      if (!internal) {
        set({ toast: result.error.toUpperCase() });
        later(() => set({ toast: null }), 900);
      }
      return result;
    }
    const before = state;
    state = result.state;
    set({ version: ui.version + 1 });
    handleEvents(result.events, action, human);
    persist();
    if (action.type === "END_TURN" && !state.outcome) {
      set({ selected: null, litZone: [], shields: [], shopItem: null });
      afterTurnEnd();
    } else if (action.type === "UNDO") {
      refreshSelection();
    } else {
      keepSelectionAfter(action, before);
    }
    if (state.outcome && !store.getState().gameOver) finish(state.outcome.winner);
    return result;
  }

  /** After a reposition the unit stays selected at its new tile (SPEC §3.4). */
  function keepSelectionAfter(action: Action, before: GameState): void {
    const ui = store.getState();
    if (action.type === "MOVE" && ui.selected && sameTile(ui.selected, action.unitAt)) {
      const dst = tileAt(state, action.to);
      const wasOwn = tileAt(before, action.to)?.owner === before.activePlayerIndex;
      if (dst?.unit?.readyToMove && wasOwn) {
        set({ selected: action.to, selectedAt: now() });
      } else {
        set({ selected: null });
      }
    }
    if (action.type === "BUY" && ui.shopItem) set({ shopItem: null });
    refreshSelection();
  }

  /* ----------------------------------------------------------- turn flow -- */

  function afterTurnEnd(): void {
    const idx = state.activePlayerIndex;
    if (state.outcome) return;
    if (!isHumanSeat(idx)) {
      runAiTurn(idx);
      return;
    }
    if (hotSeat) {
      set({ handOff: { player: idx }, hidden: true, actingPlayer: idx });
      return;
    }
    beginHumanTurn(idx);
  }

  function beginHumanTurn(idx: number): void {
    set({ actingPlayer: idx, aiPlaying: false, hidden: false, handOff: null });
    const turn = state.turnNumber + 1;
    const trigger = `turnStart:${turn}` as TutorialTriggerId;
    if (state.turnNumber > 0 && !skip) {
      set({ banner: "Next day..." });
      later(() => {
        set({ banner: null });
        fire(trigger);
      }, DURATION.banner);
    } else {
      fire(trigger);
    }
    refreshSelection();
  }

  function runAiTurn(idx: number): void {
    set({ aiPlaying: true, actingPlayer: idx, selected: null, litZone: [], shields: [], shopItem: null });
    let actions: Action[];
    try {
      const r = engine.aiTakeTurn(state, idx, aiSeed);
      actions = r.actions;
      aiSeed = r.nextSeed;
    } catch {
      actions = [{ type: "END_TURN" }];
    }
    if (actions[actions.length - 1]?.type !== "END_TURN") actions = [...actions, { type: "END_TURN" }];
    const stepMs = aiStepMs(actions.length);
    let i = 0;
    const step = () => {
      if (destroyed || state.outcome) {
        set({ aiPlaying: false });
        if (state.outcome && !store.getState().gameOver) finish(state.outcome.winner);
        return;
      }
      const action = actions[i++];
      if (!action) return;
      if (state.activePlayerIndex !== idx) return;
      const at = action.type === "MOVE" ? action.to : action.type === "BUY" ? action.at : null;
      if (at) setCamera(ensureVisible(camera, at, 1));
      const r = engine.apply(state, action);
      if (r.error) {
        if (action.type === "END_TURN") return;
        // an AI action the engine rejects is skipped; the turn still ends
        if (!actions.slice(i).some((a) => a.type === "END_TURN")) actions.push({ type: "END_TURN" });
        later(step, stepMs);
        return;
      }
      state = r.state;
      set({ version: store.getState().version + 1 });
      handleEvents(r.events, action, false);
      persist();
      if (action.type === "END_TURN") {
        set({ aiPlaying: false });
        if (state.outcome) finish(state.outcome.winner);
        else afterTurnEnd();
        return;
      }
      if (state.outcome) {
        set({ aiPlaying: false });
        finish(state.outcome.winner);
        return;
      }
      later(step, stepMs);
    };
    later(step, stepMs);
  }

  function finish(winner: number): void {
    const humanWon = isHumanSeat(winner);
    fire(humanWon ? "victory" : "defeat");
    set({ gameOver: { winner, humanWon }, aiPlaying: false, selected: null, litZone: [], shields: [], shopItem: null });
    save(null);
    if (humanWon && !recorded && progressPort) {
      recorded = true;
      const src = config.source;
      if (src.kind === "campaign") progressPort.recordLevelWin(src.levelId, config.difficulty, state.turnNumber + 1);
      else if (src.kind === "challenge") progressPort.recordChallengeWin(src.weekKey, src.mapId, config.difficulty);
    }
  }

  function start(): void {
    if (map.tutorial[0]?.triggerId === "levelIntro" && !fired.has("levelIntro")) fire("levelIntro");
    if (state.outcome) {
      finish(state.outcome.winner);
      return;
    }
    const idx = state.activePlayerIndex;
    if (!isHumanSeat(idx)) runAiTurn(idx);
    else if (hotSeat && !options.resume) set({ handOff: { player: idx }, hidden: true, actingPlayer: idx });
    else beginHumanTurn(idx);
  }

  /* ---------------------------------------------------------- tap logic -- */

  function tapTile(at: TileCoord): void {
    const ui = store.getState();
    if (ui.gameOver || ui.handOff || ui.aiPlaying || !isHumanTurn()) return;
    const me = state.activePlayerIndex;
    const t = tileAt(state, at);
    if (!t) {
      deselect();
      return;
    }
    if (ui.shopItem) {
      if (inZone(ui.litZone, at)) dispatch({ type: "BUY", item: ui.shopItem, at });
      else chooseShopItem(null);
      return;
    }
    if (ui.selected) {
      if (sameTile(ui.selected, at)) {
        select(null);
        return;
      }
      const sel = tileAt(state, ui.selected);
      if (sel?.unit && sel.owner === me) {
        if (inZone(ui.litZone, at)) {
          dispatch({ type: "MOVE", unitAt: ui.selected, to: at });
          return;
        }
        if (t.owner !== me && t.terrain !== "water" && sel.unit.readyToMove && isCapturableTerrain(t.terrain)) {
          const blockedByWall = t.building === "woodwall" || t.building === "stoneTower";
          if (engine.defenceNumber(state, at) >= sel.unit.level) fire(blockedByWall ? "attackBlocked:wall" : "attackBlocked:defence");
        }
      }
    }
    if (t.unit && t.owner === me) {
      select(at);
      return;
    }
    if (ui.settings.oneClickMove && t.owner !== me && isCapturableTerrain(t.terrain)) {
      if (oneClickAttack(at)) return;
    }
    if (t.building || t.unit) {
      select(at);
      return;
    }
    select(null);
  }

  function isCapturableTerrain(terrain: string): boolean {
    return terrain !== "water" && terrain !== "mountain" && !terrain.startsWith("forest");
  }

  /** SPEC §3.6 / D12: the weakest adjacent ready unit that still wins. */
  function oneClickAttack(at: TileCoord): boolean {
    const me = state.activePlayerIndex;
    const defence = engine.defenceNumber(state, at);
    const candidates: Array<{ from: TileCoord; level: number }> = [];
    for (const [dx, dy] of [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ] as const) {
      const from = { x: at.x + dx, y: at.y + dy };
      const n = tileAt(state, from);
      if (n?.unit?.readyToMove && n.owner === me && n.unit.level > defence) {
        if (inZone(engine.legalMoveZone(state, from), at)) candidates.push({ from, level: n.unit.level });
      }
    }
    candidates.sort((a, b) => a.level - b.level);
    const pick = candidates[0];
    if (!pick) return false;
    const r = dispatch({ type: "MOVE", unitAt: pick.from, to: at });
    return !r.error;
  }

  /* ------------------------------------------------------------- camera -- */

  function setCamera(cam: Camera): void {
    camera = cam;
    dirty = true;
  }

  /* ------------------------------------------------------------ settings -- */

  const unsubscribeSettings = settingsPort?.subscribe((s) => set({ settings: s })) ?? null;

  function updateSettings(patch: Partial<Settings>): void {
    const next = { ...store.getState().settings, ...patch };
    if (settingsPort) settingsPort.write(next);
    else set({ settings: next });
  }

  const session: Session = {
    get state() {
      return state;
    },
    map,
    config,
    store,
    anims,
    get camera() {
      return camera;
    },
    set camera(cam: Camera) {
      setCamera(cam);
    },
    start,
    tapTile,
    select,
    deselect,
    chooseShopItem,
    tapCard,
    dispatch: (a) => dispatch(a, false),
    undo() {
      if (state.history.length === 0) return;
      dispatch({ type: "UNDO" });
    },
    endTurn() {
      if (!isHumanTurn()) return;
      dispatch({ type: "END_TURN" });
    },
    setCamera,
    dismissTutorial,
    continueHandOff() {
      const h = store.getState().handOff;
      if (!h) return;
      beginHumanTurn(h.player);
    },
    setModal(modal) {
      set({ modal });
    },
    updateSettings,
    destroy() {
      destroyed = true;
      for (const cancel of timers) cancel();
      timers.clear();
      unsubscribeSettings?.();
    },
    applyForTest(action) {
      const r = engine.apply(state, action);
      if (r.error) throw new Error(r.error);
      state = r.state;
      set({ version: store.getState().version + 1, selected: null, litZone: [], shields: [], shopItem: null });
      persist();
      if (action.type === "END_TURN" && !state.outcome) afterTurnEnd();
      if (state.outcome && !store.getState().gameOver) finish(state.outcome.winner);
    },
    skipAnimations() {
      skip = true;
      anims.skip = true;
      anims.items = [];
      set({ banner: null });
    },
    isHumanTurn,
    viewerSeat,
    displayProvince,
    takeDirty() {
      const d = dirty;
      dirty = false;
      return d;
    },
    markDirty() {
      dirty = true;
    },
    tick(t) {
      const active = pruneAnims(anims, t);
      return active;
    },
  };
  return session;
}
