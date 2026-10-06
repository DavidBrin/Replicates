/**
 * The session runner (SPEC §4.15, §5.1–§5.4).
 *
 * `GameState` lives in this closure and **never enters React state or the
 * zustand store** — only derived UI slices do, and the board repaints from
 * the live state through a dirty flag, bypassing React's render cycle.
 *
 * Offline the runner is the authority: it owns the RNG (`rngFor(seed, …)`),
 * resolves attacks with `rollAttack`, draws cards, moves portals at round
 * start and runs the bots. Online it is a client: non-attack actions are
 * applied optimistically and sent, attacks go as *intents* so the authority
 * rolls the dice, and `onActions` / `onSnapshot` reconcile.
 */
import { createStore, type StoreApi } from "zustand/vanilla";

import type {
  Action, ActionKind, ApplyResult, AttackIntent, Event, GameConfig, GameState, MapDef,
  OddsTables, Outcome, Phase, Seat, TerritoryId,
} from "@/engine/types";
import type { LocalProgressPort } from "@/ports/localProgress";
import type { Settings, SettingsPort } from "@/ports/settings";
import type { ChatLine, LoggedAction, SyncPort, SyncStatus } from "@/ports/sync";
import { BOT_REACTIONS, dialogText } from "@/content/dialog";

import { createBotDriver, type BotDriver } from "./botRunner";
import { cloneState, registerDebug, unregisterDebug } from "./debugBridge";
import type { EngineApi } from "./engineApi";
import { playBots, type BotsApi } from "./pending";
import { DEFAULT_SETTINGS } from "@/adapters/localStorage/settings";

export const AI_STEP_MS = 300;
export const AI_TURN_BUDGET_MS = 4000;
export const AI_STEP_MIN_MS = 40;
export function aiStepMs(actionCount: number): number {
  return Math.max(AI_STEP_MIN_MS, Math.min(AI_STEP_MS, Math.floor(AI_TURN_BUDGET_MS / Math.max(1, actionCount))));
}

/** A balloon popped to the left of a roster capsule (§7.3). S4's addition to the UI slice. */
export interface Balloon {
  readonly id: number;
  readonly seat: Seat;
  readonly text: string;
  readonly until: number;
}

export interface SessionUiState {
  version: number;                      // bumps on every GameState change
  selected: TerritoryId | null;
  litZone: readonly TerritoryId[];      // legal targets for the current intent
  actionMode: "idle" | "draft" | "attackFrom" | "attackTo" | "moveIn" | "fortifyFrom" | "fortifyTo";
  phase: Phase;
  actingSeat: Seat;
  viewerSeat: Seat;                     // the seat whose fog and HUD are shown
  botPlaying: boolean;
  bannerText: string | null;
  overlayMode: "none" | "troops" | "continents" | "players";
  attackLimit: number | null;           // stopUntil, or null for fight-to-the-death
  /** The ◀ ▶ steppers' current position: Blitz, or a manual dice count (R46). Resets to "blitz"
   *  at the start of every turn. The Blitz view reads it; it is not part of GameState. (F42) */
  attackDice: "blitz" | 1 | 2 | 3;
  blitzWinChance: number | null;
  dice: { attacker: readonly number[]; defender: readonly number[] } | null;
  handOff: { seat: Seat } | null;
  hidden: boolean;                      // board concealed behind the hand-off overlay
  modal: "cards" | "dice" | "count" | "settings" | "help" | "endTurn" | "getReady" | null;
  toast: string | null;
  chatOpen: boolean;
  gameOver: Outcome | null;
  syncStatus: SyncStatus;               // from src/ports/sync.ts (F31)
  /** How many of my optimistic actions are still unconfirmed (§5.5's `pendingActions.length`). */
  pending: number;
  /** The authority's `turn_deadline`, ISO 8601, straight off POLL 3. `null` offline. */
  turnDeadline: string | null;
  settings: Settings;
  // ---- S4 additions, all UI-only ----
  /** The attack the Blitz view is showing, once a source and a target are picked. */
  pendingAttack: { from: TerritoryId; to: TerritoryId } | null;
  /** The count dialog's subject: a draft target, a move-in, or a fortify pair. */
  countRequest:
    | { kind: "draft"; territory: TerritoryId; min: number; max: number }
    | { kind: "moveIn"; from: TerritoryId; to: TerritoryId; min: number; max: number }
    | { kind: "fortify"; from: TerritoryId; to: TerritoryId; min: number; max: number }
    | null;
  /** Speech balloons currently on screen (§7.3). */
  balloons: readonly Balloon[];
  /** The offline chat log; online, S5 passes its own down to `GameScreen`. */
  chat: readonly ChatLine[];
  /** The Received Troops popup's payload, or null. */
  award: { seat: Seat; base: number; bonus: number; capitals: number; total: number } | null;
  /** The seat eliminated most recently, for the roster flip and the seizure banner. */
  lastElimination: { seat: Seat; by: Seat } | null;
}

export interface SessionOptions {
  map: MapDef;
  config: GameConfig;
  engine: EngineApi;                    // the narrow wrapper tests inject a scripted engine through
  odds: OddsTables;
  sync?: SyncPort | null;               // null offline
  settings?: SettingsPort | null;
  progress?: LocalProgressPort | null;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => () => void;   // swappable for a synchronous test scheduler
  skipAnimations?: boolean;
  viewport?: { w: number; h: number };
  resume?: SavedSession | null;
  save?: (saved: SavedSession | null) => void;
  /** S4 addition: inject a bots implementation; defaults to the probed barrel. */
  bots?: BotsApi;
  /** S4 addition: the seat this device plays online. Offline it is derived. */
  mySeat?: Seat;
}

export interface SavedSession {
  readonly version: 1;
  readonly config: GameConfig;          // carries the seed (D5)
  readonly state: GameState;
  readonly turn: number;
  readonly grudge: readonly number[];
  readonly savedAt: number;
}

export interface Session {
  /** The **displayed** state: `confirmed()` plus my unconfirmed optimistic actions (F42). */
  readonly state: GameState;
  /** The **authoritative** state: the fold of the log, nothing optimistic (F42). */
  confirmed(): GameState;
  readonly view: GameState;             // viewFor(state, map, viewerSeat)
  readonly map: MapDef;
  readonly store: StoreApi<SessionUiState>;
  start(): void;
  tapTerritory(at: TerritoryId): void;
  setMode(mode: SessionUiState["actionMode"]): void;
  setAttackLimit(stopUntil: number | null): void;
  submitAttack(intent: AttackIntent): void;
  submit(action: Action): ApplyResult;  // the offline path: resolve, then apply
  tradeCards(set: readonly [string, string, string], bonusTerritory: TerritoryId | null): void;
  moveIn(count: number): void;
  fortify(from: TerritoryId, to: TerritoryId, count: number): void;
  endPhase(): void;
  endTurn(): void;
  resign(): void;
  continueHandOff(): void;
  setOverlay(mode: SessionUiState["overlayMode"]): void;
  setModal(modal: SessionUiState["modal"]): void;
  updateSettings(patch: Partial<Settings>): void;
  say(lineId: number): void;            // preset dialog; writes chat, never an action
  takeDirty(): boolean;
  markDirty(): void;
  tick(now: number): boolean;
  destroy(): void;
  applyForTest(action: Action): void;
  // ---- S4 additions ----
  readonly config: GameConfig;
  /** The seat this device plays: the single human offline, `mySeat` online. */
  mySeat(): Seat;
  /** Drain the engine events emitted since the last call, for the animation layer. */
  drainEvents(): readonly Event[];
  /** The draft/attack/fortify prompt for the current phase (§7.4). */
  prompt(): string;
  /** `legalActions` for the acting seat, cached per state version. */
  legal(): readonly ActionKind[];
  /** Open the count dialog for a draft, a move-in or a fortify. */
  requestCount(request: SessionUiState["countRequest"]): void;
  /** Confirm the open count dialog with `count`. */
  confirmCount(count: number): void;
  cancelCount(): void;
  /** Pick the dice stepper position (Blitz, or 1–3 dice). */
  setAttackDice(dice: "blitz" | 1 | 2 | 3): void;
  /** Dismiss the Received Troops popup. */
  dismissAward(): void;
  /** Emoji and preset lines share one writer. */
  sayEmoji(emoji: string): void;
  /** Online only: fold an authoritative batch. Exposed so S5 can push poll results in. */
  ingest(actions: readonly LoggedAction[]): void;
  /** Online only: replace the confirmed state with the authority's masked snapshot. */
  ingestSnapshot(snapshot: GameState, snapshotSeq: number): void;
  /** The authoritative sequence number this client has folded to. */
  seq(): number;
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

const PROMPTS: Readonly<Record<string, string>> = {
  draft: "Tap any of your territories to begin deploying troops",
  draftIncomplete: "You must draft all of your available troops during your draft phase",
  attack: "Select an adjacent territory to attack",
  fortify: "Select a territory to move your troops from",
};

// eslint-disable-next-line max-lines-per-function
export function createSession(options: SessionOptions): Session {
  const { map, config, engine, odds } = options;
  const now = options.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  const schedule = options.schedule ?? defaultSchedule;
  const settingsPort = options.settings ?? null;
  const progressPort = options.progress ?? null;
  const sync = options.sync ?? null;
  const save = options.save ?? (() => {});
  const bots = options.bots ?? playBots();
  const online = sync !== null;

  let skip = options.skipAnimations ?? prefersReducedMotion();
  let destroyed = false;
  let dirty = true;
  let recorded = false;
  const timers = new Set<() => void>();
  const eventBuffer: Event[] = [];
  let balloonId = 0;
  let chatId = 0;

  /* ------------------------------------------------------------- state -- */

  const grudge = new Float32Array(config.seats.length);
  if (options.resume?.grudge) options.resume.grudge.forEach((v, i) => { grudge[i] = v; });

  let confirmedState: GameState = options.resume?.state ?? openingState();
  let pendingActions: Action[] = [];
  let displayedState: GameState = confirmedState;
  let folded = online ? 0 : 1;

  function openingState(): GameState {
    const personas = bots.drawPersonas(
      config.seats.map((s) => s.tier),
      engine.rngFor(config.seed, "personaAssign", 0),
      engine.rngFor(config.seed, "personaJitter", 0),
    );
    const started = engine.dealTerritories(map, config, personas, {
      deal: engine.rngFor(config.seed, "deal", 0),
      turnOrder: engine.rngFor(config.seed, "turnOrder", 0),
      modifierPlace: engine.rngFor(config.seed, "modifierPlace", 0),
    });
    return engine.createInitialState(map, started);
  }

  const humanSeats = confirmedState.seats.filter((s) => s.kind === "human").map((s) => s.seat);
  const passAndPlay = !online && humanSeats.length >= 2;
  const myOfflineSeat = humanSeats[0] ?? 0;

  function mySeat(): Seat {
    if (online) return options.mySeat ?? myOfflineSeat;
    if (passAndPlay) return store.getState().viewerSeat;
    return myOfflineSeat;
  }

  /* ------------------------------------------------------------- store -- */

  const store = createStore<SessionUiState>(() => ({
    version: 0,
    selected: null,
    litZone: [],
    actionMode: "idle",
    phase: confirmedState.phase,
    actingSeat: confirmedState.turnOrder[confirmedState.currentIndex] ?? 0,
    viewerSeat: options.mySeat ?? myOfflineSeat,
    botPlaying: false,
    bannerText: null,
    overlayMode: "none",
    attackLimit: null,
    attackDice: "blitz",
    blitzWinChance: null,
    dice: null,
    handOff: null,
    hidden: false,
    modal: null,
    toast: null,
    chatOpen: false,
    gameOver: confirmedState.outcome,
    syncStatus: online ? "idle" : "offline",
    pending: 0,
    turnDeadline: null,
    settings: settingsPort?.read() ?? DEFAULT_SETTINGS,
    pendingAttack: null,
    countRequest: null,
    balloons: [],
    chat: [],
    award: null,
    lastElimination: null,
  }));

  const set = (patch: Partial<SessionUiState>): void => {
    store.setState(patch);
    dirty = true;
  };

  const later = (fn: () => void, ms: number): (() => void) => {
    let cancel: (() => void) | null = null;
    let fired = false;
    const c = schedule(() => {
      fired = true;
      if (cancel) timers.delete(cancel);
      if (!destroyed) fn();
    }, skip ? 0 : ms);
    cancel = c;
    if (!fired) timers.add(c);
    return c;
  };

  /* -------------------------------------------------------- derivation -- */

  function recompute(): void {
    const acting = displayedState.turnOrder[displayedState.currentIndex] ?? 0;
    set({
      version: store.getState().version + 1,
      phase: displayedState.phase,
      actingSeat: acting,
      gameOver: displayedState.outcome,
      pending: pendingActions.length,
    });
  }

  function refold(): void {
    let next = confirmedState;
    for (const action of pendingActions) {
      const r = engine.apply(next, map, action);
      if (r.error) continue;
      next = r.state;
    }
    displayedState = next;
    recompute();
  }

  /* ---------------------------------------------------------- autosave -- */

  function persist(): void {
    if (online) return;
    if (confirmedState.outcome) {
      save(null);
      return;
    }
    save({
      version: 1,
      config,
      state: confirmedState,
      turn: confirmedState.turn,
      grudge: [...grudge],
      savedAt: Date.now(),
    });
  }

  /* ------------------------------------------------------------ events -- */

  function handleEvents(events: readonly Event[]): void {
    for (const e of events) {
      eventBuffer.push(e);
      switch (e.type) {
        case "turnStarted":
          set({
            bannerText: `${confirmedState.seats[e.seat]?.name ?? `Seat ${e.seat}`} — round ${e.round}`,
            attackDice: "blitz",
            attackLimit: null,
          });
          later(() => set({ bannerText: null }), 1500);
          break;
        case "troopsAwarded":
          set({
            award: { seat: e.seat, base: e.base, bonus: e.bonus, capitals: e.capitals, total: e.total },
          });
          break;
        case "playerEliminated":
          set({ lastElimination: { seat: e.seat, by: e.by } });
          botReact(e.seat, "eliminated");
          break;
        case "territoryCaptured":
          if (e.from >= 0) botReact(e.from, "lostTerritory");
          botReact(e.to, "conquered");
          break;
        case "battleResolved":
          if (!e.conquered && e.attackerLosses >= 2) {
            const seat = displayedState.turnOrder[displayedState.currentIndex];
            if (seat !== undefined) botReact(seat, "badRoll");
          }
          break;
        case "diceRolled":
          set({ dice: { attacker: e.attackerDice, defender: e.defenderDice } });
          later(() => set({ dice: null }), 1600);
          break;
        case "gameOver":
          finish(e.outcome);
          break;
        default:
          break;
      }
    }
  }

  /** A bot may fire a reaction line as cosmetic flavour (D42, **[ours]**). */
  function botReact(seat: Seat, kind: keyof typeof BOT_REACTIONS): void {
    if (skip) return;
    const s = confirmedState.seats[seat];
    if (!s || s.kind !== "bot" || s.standing === "eliminated") return;
    const pool = BOT_REACTIONS[kind];
    const line = pool[(confirmedState.turn + seat) % pool.length];
    if (line === undefined) return;
    pushChat(seat, line, null);
  }

  function pushChat(seat: Seat, lineId: number | null, emoji: string | null): void {
    const name = confirmedState.seats[seat]?.name ?? `Seat ${seat}`;
    chatId += 1;
    const line: ChatLine = {
      id: chatId,
      scope: "game",
      displayName: name,
      lineId,
      emoji,
      createdAt: new Date().toISOString(),
    };
    balloonId += 1;
    const balloon: Balloon = {
      id: balloonId,
      seat,
      text: lineId !== null ? dialogText(lineId) : (emoji ?? ""),
      until: now() + 4000,
    };
    set({
      chat: [...store.getState().chat, line].slice(-120),
      balloons: [...store.getState().balloons, balloon],
    });
  }

  function finish(outcome: Outcome): void {
    if (store.getState().gameOver) return;
    set({ gameOver: outcome, botPlaying: false, selected: null, litZone: [], actionMode: "idle", modal: null });
    save(null);
    if (!recorded && progressPort) {
      recorded = true;
      progressPort.recordResult(config.mapSlug, humanSeats.includes(outcome.winner));
    }
  }

  /* ---------------------------------------------------------- dispatch -- */

  function applyLocal(action: Action, internal: boolean): ApplyResult {
    const result = engine.apply(confirmedState, map, action);
    if (result.error) {
      if (!internal) {
        set({ toast: result.error.message });
        later(() => set({ toast: null }), 1400);
      }
      return result;
    }
    confirmedState = result.state;
    folded += 1;
    handleEvents(result.events);
    refold();
    persist();
    return result;
  }

  function submit(action: Action): ApplyResult {
    if (destroyed) return { state: displayedState, events: [], error: { code: "illegalAction", message: "destroyed" } };
    if (online) return submitOnline(action);
    const result = applyLocal(action, false);
    if (!result.error) afterAction(action);
    return result;
  }

  /** Non-attack actions are applied optimistically and sent (§5.5). */
  function submitOnline(action: Action): ApplyResult {
    const probe = engine.apply(displayedState, map, action);
    if (probe.error) {
      set({ toast: probe.error.message });
      later(() => set({ toast: null }), 1400);
      return probe;
    }
    pendingActions = [...pendingActions, action];
    refold();
    const id = clientActionId();
    void sync?.submit(action, id).catch(() => {
      pendingActions = pendingActions.filter((a) => a !== action);
      refold();
      set({ syncStatus: "behind" });
    });
    return probe;
  }

  function clientActionId(): string {
    try {
      if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
    } catch {
      /* fall through */
    }
    return `cid-${Math.random().toString(36).slice(2)}`;
  }

  /** Post-action bookkeeping the offline authority owns. */
  function afterAction(action: Action): void {
    if (confirmedState.outcome) return;
    if (action.type === "END_TURN") {
      roundStartWork();
      afterTurnEnd();
      return;
    }
    refreshSelection();
  }

  /** Unstable portals relocate at the start of every third round (R76, §5.7). */
  function roundStartWork(): void {
    if (confirmedState.currentIndex !== 0 || confirmedState.rules.portals !== "unstable") return;
    const moved = engine.movePortals(confirmedState, map, engine.rngFor(config.seed, "portalMove", confirmedState.turn));
    if (moved) applyLocal(moved, true);
  }

  /* --------------------------------------------------------- turn flow -- */

  function isBotSeat(seat: Seat): boolean {
    return confirmedState.seats[seat]?.kind === "bot";
  }

  function actingSeat(): Seat {
    return confirmedState.turnOrder[confirmedState.currentIndex] ?? 0;
  }

  function afterTurnEnd(): void {
    if (confirmedState.outcome) return;
    const seat = actingSeat();
    if (isBotSeat(seat)) {
      runBotTurn(seat);
      return;
    }
    if (passAndPlay && humanSeats.length >= 2) {
      set({ handOff: { seat }, hidden: true, actingSeat: seat, botPlaying: false, modal: null });
      return;
    }
    beginHumanTurn(seat);
  }

  function beginHumanTurn(seat: Seat): void {
    set({
      actingSeat: seat, viewerSeat: online ? store.getState().viewerSeat : seat,
      botPlaying: false, hidden: false, handOff: null, selected: null, litZone: [],
      actionMode: "idle", attackDice: "blitz", attackLimit: null,
    });
    refreshSelection();
  }

  let driver: BotDriver | null = null;

  function runBotTurn(seat: Seat): void {
    set({ botPlaying: true, actingSeat: seat, selected: null, litZone: [], actionMode: "idle" });
    driver = createBotDriver({
      engine, bots, odds, map, seat, grudge,
      rng: () => engine.rngFor(config.seed, `bot:${seat}`, confirmedState.turn),
    });
    stepBot(seat);
  }

  function stepBot(seat: Seat): void {
    if (destroyed || !driver) return;
    if (confirmedState.outcome) {
      set({ botPlaying: false });
      return;
    }
    if (actingSeat() !== seat) {
      set({ botPlaying: false });
      afterTurnEnd();
      return;
    }
    const step = driver.next(confirmedState);
    if (!step) {
      // The plan ran dry without ending the turn; end it so play cannot stall.
      const r = applyLocal({ type: "END_TURN", seat }, true);
      set({ botPlaying: false });
      if (!r.error) {
        roundStartWork();
        afterTurnEnd();
      }
      return;
    }
    const pace = aiStepMs(driver.size());
    if (step.kind === "intent") {
      const action = engine.rollAttack(
        confirmedState, map, step.intent,
        engine.rngFor(config.seed, "battle", confirmedState.turn),
        odds, confirmedState.rules.diceMode,
      );
      applyLocal(action, true);
    } else if (step.action.type === "END_TURN") {
      if (confirmedState.conqueredThisTurn) awardCard(seat);
      const r = applyLocal(step.action, true);
      set({ botPlaying: false });
      if (!r.error) {
        roundStartWork();
        afterTurnEnd();
      }
      return;
    } else {
      applyLocal(step.action, true);
    }
    later(() => stepBot(seat), pace);
  }

  /** The end-of-turn card award: exactly one card, resolved by the runner (R20). */
  function awardCard(seat: Seat): void {
    const drawn = engine.drawCard(
      confirmedState, map, seat, engine.rngFor(config.seed, "cardDeck", confirmedState.turn),
    );
    applyLocal(drawn, true);
  }

  /* --------------------------------------------------------- selection -- */

  function refreshSelection(): void {
    const ui = store.getState();
    const state = displayedState;
    const seat = actingSeat();
    if (state.pendingMoveIn) {
      const { from, to, min, max } = state.pendingMoveIn;
      set({ actionMode: "moveIn", litZone: [to], selected: from, countRequest: { kind: "moveIn", from, to, min, max } });
      return;
    }
    if (ui.selected === null) {
      if (ui.litZone.length) set({ litZone: [] });
      return;
    }
    if (state.phase === "draft") {
      set({ litZone: engine.legalDraftTargets(state, seat) });
      return;
    }
    if (state.phase === "attack") {
      set({ litZone: engine.legalAttackTargets(state, map, ui.selected) });
      return;
    }
    if (state.phase === "fortify") {
      set({ litZone: engine.legalFortifyMoves(state, map, ui.selected) });
      return;
    }
    set({ litZone: [] });
  }

  function canAct(): boolean {
    const ui = store.getState();
    if (ui.gameOver || ui.handOff || ui.botPlaying || ui.hidden) return false;
    if (online) return actingSeat() === mySeat();
    return !isBotSeat(actingSeat());
  }

  function tapTerritory(at: TerritoryId): void {
    if (!canAct()) return;
    const state = displayedState;
    const seat = actingSeat();
    const tile = state.territories[at];
    if (!tile || tile.blizzard) return;
    const ui = store.getState();

    if (state.pendingMoveIn) return; // the move-in dialog owns the board

    if (state.phase === "draft") {
      if (tile.owner !== seat || state.troopsToPlace <= 0) return;
      set({ selected: at, actionMode: "draft", countRequest: { kind: "draft", territory: at, min: 1, max: state.troopsToPlace }, modal: "count" });
      refreshSelection();
      return;
    }

    if (state.phase === "attack") {
      if (ui.selected !== null && ui.litZone.includes(at)) {
        const from = ui.selected;
        const a = Math.max(0, (state.territories[from]?.troops ?? 1) - 1);
        const d = state.territories[at]?.troops ?? 0;
        const aug = engine.diceAugmentFor(state, map, from, at);
        set({
          actionMode: "attackTo", pendingAttack: { from, to: at }, modal: "dice",
          blitzWinChance: odds.winChance(a, d, aug),
        });
        return;
      }
      if (tile.owner !== seat || tile.troops < 2) {
        set({ selected: null, litZone: [], actionMode: "idle" });
        return;
      }
      set({ selected: at, actionMode: "attackFrom" });
      refreshSelection();
      return;
    }

    if (state.phase === "fortify") {
      if (ui.selected !== null && ui.litZone.includes(at)) {
        const from = ui.selected;
        const max = Math.max(1, (state.territories[from]?.troops ?? 1) - 1);
        set({ actionMode: "fortifyTo", countRequest: { kind: "fortify", from, to: at, min: 1, max }, modal: "count" });
        return;
      }
      if (tile.owner !== seat || tile.troops < 2 || state.fortifyUsed) {
        set({ selected: null, litZone: [], actionMode: "idle" });
        return;
      }
      set({ selected: at, actionMode: "fortifyFrom" });
      refreshSelection();
      return;
    }

    if (state.phase === "claim") {
      submit({ type: "CLAIM", seat, territory: at });
    }
  }

  /* ------------------------------------------------------------ online -- */

  function ingest(actions: readonly LoggedAction[]): void {
    let changed = false;
    for (const row of [...actions].sort((a, b) => a.seq - b.seq)) {
      if (row.seq <= folded) continue;
      if (row.clientActionId) {
        pendingActions = pendingActions.filter(() => true);
      }
      if (row.action.type === "GAME_STARTED") {
        confirmedState = engine.createInitialState(map, row.action);
      } else {
        const r = engine.apply(confirmedState, map, row.action);
        if (r.error) {
          set({ syncStatus: "desynced" });
          continue;
        }
        confirmedState = r.state;
        handleEvents(r.events);
      }
      folded = row.seq;
      changed = true;
      if (!confirmedState.rules.fogOfWar && row.stateHash) {
        let hash: string | null = null;
        try {
          hash = engine.hashState(confirmedState);
        } catch {
          hash = null;
        }
        if (hash !== null && hash !== row.stateHash) {
          set({ syncStatus: "desynced" });
          if (typeof console !== "undefined") console.error("[risk] desync at seq", row.seq);
        }
      }
    }
    // Anything the authority has now confirmed is no longer optimistic.
    const confirmedCount = Math.min(pendingActions.length, actions.filter((a) => a.clientActionId).length);
    if (confirmedCount > 0) pendingActions = pendingActions.slice(confirmedCount);
    if (changed || confirmedCount > 0) {
      refold();
      if (store.getState().syncStatus !== "desynced") set({ syncStatus: "idle" });
    }
  }

  function ingestSnapshot(snapshot: GameState, snapshotSeq: number): void {
    confirmedState = snapshot;
    folded = snapshotSeq;
    pendingActions = [];
    refold();
    set({ syncStatus: "idle" });
  }

  const unsubActions = sync?.onActions((rows) => ingest(rows)) ?? null;
  const unsubStatus = sync?.onStatus((status) => set({ syncStatus: status })) ?? null;
  const unsubSnapshot = sync?.onSnapshot((snapshot, seq) => ingestSnapshot(snapshot, seq)) ?? null;

  /* -------------------------------------------------------- the actions -- */

  function submitAttack(intent: AttackIntent): void {
    if (!canAct()) return;
    set({ modal: null, pendingAttack: null });
    if (online) {
      const id = clientActionId();
      void sync?.submitIntent(intent, id).then((rows) => ingest(rows)).catch(() => set({ syncStatus: "behind" }));
      return;
    }
    const action = engine.rollAttack(
      displayedState, map, intent,
      engine.rngFor(config.seed, "battle", displayedState.turn),
      odds, displayedState.rules.diceMode,
    );
    const result = submit(action);
    if (!result.error) {
      set({ selected: null, litZone: [], actionMode: "idle" });
      refreshSelection();
    }
  }

  function tradeCards(setOfThree: readonly [string, string, string], bonusTerritory: TerritoryId | null): void {
    submit({ type: "TRADE_CARDS", seat: actingSeat(), cards: setOfThree, bonusTerritory });
    set({ modal: null });
  }

  function moveIn(count: number): void {
    const pending = displayedState.pendingMoveIn;
    if (!pending) return;
    const result = submit({ type: "MOVE_IN", seat: actingSeat(), count });
    if (!result.error) {
      set({ countRequest: null, modal: null, selected: null, litZone: [], actionMode: "idle" });
      refreshSelection();
    }
  }

  function fortify(from: TerritoryId, to: TerritoryId, count: number): void {
    const result = submit({ type: "FORTIFY", seat: actingSeat(), from, to, count });
    if (!result.error) set({ countRequest: null, modal: null, selected: null, litZone: [], actionMode: "idle" });
  }

  function endPhase(): void {
    if (!canAct()) return;
    const result = submit({ type: "END_PHASE", seat: actingSeat() });
    if (!result.error) set({ selected: null, litZone: [], actionMode: "idle", modal: null });
  }

  function endTurn(): void {
    if (!canAct()) return;
    const seat = actingSeat();
    if (!online && displayedState.conqueredThisTurn) awardCard(seat);
    const result = submit({ type: "END_TURN", seat });
    if (!result.error) set({ selected: null, litZone: [], actionMode: "idle", modal: null });
  }

  function resign(): void {
    const seat = mySeat();
    const persona = confirmedState.seats[seat]?.persona
      ?? bots.drawPersonas([confirmedState.rules.aiDifficulty],
        engine.rngFor(config.seed, "personaAssign", confirmedState.turn),
        engine.rngFor(config.seed, "personaJitter", confirmedState.turn))[0]
      ?? null;
    if (!persona) return;
    submit({ type: "SEAT_TO_BOT", seat, reason: "resigned", tier: confirmedState.rules.aiDifficulty, persona });
    set({ modal: null });
    if (!online && actingSeat() === seat) afterTurnEnd();
  }

  /* -------------------------------------------------------------- misc -- */

  const unsubscribeSettings = settingsPort?.subscribe((s) => set({ settings: s })) ?? null;

  function updateSettings(patch: Partial<Settings>): void {
    const next = { ...store.getState().settings, ...patch };
    if (settingsPort) settingsPort.write(patch);
    else set({ settings: next });
  }

  function say(lineId: number): void {
    pushChat(mySeat(), lineId, null);
  }

  function start(): void {
    registerDebug({
      state: () => cloneState(confirmedState),
      seq: () => folded,
    });
    if (confirmedState.outcome) {
      finish(confirmedState.outcome);
      return;
    }
    const seat = actingSeat();
    if (online) {
      beginHumanTurn(seat);
      return;
    }
    if (isBotSeat(seat)) {
      runBotTurn(seat);
      return;
    }
    if (passAndPlay && !options.resume) {
      set({ handOff: { seat }, hidden: true, actingSeat: seat });
      return;
    }
    set({ modal: "getReady", viewerSeat: seat, actingSeat: seat });
    beginHumanTurn(seat);
    set({ modal: "getReady" });
  }

  const session: Session = {
    get state() {
      return displayedState;
    },
    confirmed: () => confirmedState,
    get view() {
      return engine.viewFor(displayedState, map, store.getState().viewerSeat);
    },
    map,
    store,
    config,
    mySeat,
    start,
    tapTerritory,
    setMode(mode) {
      set({ actionMode: mode });
      refreshSelection();
    },
    setAttackLimit(stopUntil) {
      set({ attackLimit: stopUntil });
    },
    submitAttack,
    submit,
    tradeCards,
    moveIn,
    fortify,
    endPhase,
    endTurn,
    resign,
    continueHandOff() {
      const h = store.getState().handOff;
      if (!h) return;
      set({ handOff: null, hidden: false, viewerSeat: h.seat, modal: "getReady" });
      beginHumanTurn(h.seat);
      set({ modal: "getReady" });
    },
    setOverlay(mode) {
      set({ overlayMode: mode });
    },
    setModal(modal) {
      set({ modal });
    },
    updateSettings,
    say,
    sayEmoji(emoji) {
      pushChat(mySeat(), null, emoji);
    },
    takeDirty() {
      const d = dirty;
      dirty = false;
      return d;
    },
    markDirty() {
      dirty = true;
    },
    tick(t) {
      const ui = store.getState();
      const live = ui.balloons.filter((b) => b.until > t);
      if (live.length !== ui.balloons.length) set({ balloons: live });
      return ui.botPlaying || live.length > 0 || ui.bannerText !== null || ui.dice !== null;
    },
    destroy() {
      destroyed = true;
      for (const cancel of timers) cancel();
      timers.clear();
      unsubscribeSettings?.();
      unsubActions?.();
      unsubStatus?.();
      unsubSnapshot?.();
      sync?.close();
      unregisterDebug(["state", "seq"]);
    },
    applyForTest(action) {
      const r = engine.apply(confirmedState, map, action);
      if (r.error) throw new Error(`${r.error.code}: ${r.error.message}`);
      confirmedState = r.state;
      folded += 1;
      handleEvents(r.events);
      refold();
      persist();
      if (action.type === "END_TURN" && !confirmedState.outcome) afterTurnEnd();
    },
    drainEvents() {
      const out = [...eventBuffer];
      eventBuffer.length = 0;
      return out;
    },
    prompt() {
      const state = displayedState;
      if (state.phase === "draft") {
        return state.troopsToPlace > 0 ? (PROMPTS.draft as string) : (PROMPTS.draftIncomplete as string);
      }
      if (state.phase === "attack") return PROMPTS.attack as string;
      if (state.phase === "fortify") return PROMPTS.fortify as string;
      return "";
    },
    legal() {
      return engine.legalActions(displayedState, map, actingSeat());
    },
    requestCount(request) {
      set({ countRequest: request, modal: request ? "count" : null });
    },
    confirmCount(count) {
      const request = store.getState().countRequest;
      if (!request) return;
      if (request.kind === "draft") {
        const result = submit({ type: "DRAFT", seat: actingSeat(), territory: request.territory, count });
        if (!result.error) set({ countRequest: null, modal: null, selected: null });
        refreshSelection();
        return;
      }
      if (request.kind === "moveIn") {
        moveIn(count);
        return;
      }
      fortify(request.from, request.to, count);
    },
    cancelCount() {
      set({ countRequest: null, modal: null, selected: null, litZone: [], actionMode: "idle" });
    },
    setAttackDice(dice) {
      set({ attackDice: dice });
    },
    dismissAward() {
      set({ award: null });
    },
    ingest,
    ingestSnapshot,
    seq: () => folded,
  };

  // Autosave on tab hide, as well as after every END_TURN (§4.15).
  if (typeof document !== "undefined" && !online) {
    const onHide = () => {
      if (document.visibilityState === "hidden") persist();
    };
    document.addEventListener("visibilitychange", onHide);
    timers.add(() => document.removeEventListener("visibilitychange", onHide));
  }

  return session;
}
