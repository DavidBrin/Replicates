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
/** How long the Received Troops popup holds before it leaves on its own (§8's motion list). */
export const AWARD_HOLD_MS = 2200;
/** How long Get Ready holds. It is shown once, on the viewer's first turn (§7.2). */
export const GET_READY_HOLD_MS = 2600;
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
  /**
   * Alliance proposals in the air, newest last (R80).
   *
   * `ALLIANCE_PROPOSE` is the one action that changes no `GameState` field — the reducer only
   * emits `allianceChanged { state: "proposed" }` — so the offer has to live in the UI slice.
   * That is also the right place for it: an offer is a conversation, not a rule, and it dies with
   * the tab rather than surviving in a replay.
   */
  allianceOffers: readonly { from: Seat; to: Seat }[];
  /** The roster capsule whose alliance popover is open, or `null` (§7.1). */
  alliancePopover: Seat | null;
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
  /**
   * The runner's monotonic action counter — the sub-stream index every resolver call is keyed on.
   *
   * Offline the runner is the authority, so it mints the seq a server would: `nextSeq` is the seq
   * of the action about to be produced. It has to be persisted, because resuming a save and
   * re-deriving it from `state.turn` would hand the next battle a sub-stream the pre-save game had
   * already spent. Optional so an envelope written before this existed still loads (it falls back
   * to the folded count).
   */
  readonly nextSeq?: number;
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
  /**
   * Online only: replace the confirmed state with the authority's masked snapshot.
   *
   * `animate` is optional and additive: rows whose **events** should play (the fog path sends a
   * masked view plus the actions behind it) without being folded or moving `seq`.
   */
  ingestSnapshot(snapshot: GameState, snapshotSeq: number, animate?: readonly LoggedAction[]): void;
  /** The authoritative sequence number this client has folded to. */
  seq(): number;
  // ---- alliances (R80). All three go through the normal submit path, so they work online too. ----
  /** Offer `with` an alliance. */
  proposeAlliance(withSeat: Seat): void;
  /** Accept the offer `from` has made me. */
  acceptAlliance(from: Seat): void;
  /** Break an alliance with `withSeat`. */
  breakAlliance(withSeat: Seat): void;
  /** Open (or close, with `null`) the alliance popover on a roster capsule. */
  openAlliancePopover(seat: Seat | null): void;
  /** What my seat may do about `seat` right now, for the popover's buttons. */
  allianceState(seat: Seat): {
    readonly allied: boolean;
    readonly offeredToMe: boolean;
    readonly offeredByMe: boolean;
    readonly canPropose: boolean;
  };
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
  claim: "Tap a territory to place an army",
  /** R6 — the 2-seat variant's companion placement. The lit zone is the neutral's own tiles. */
  claimNeutral: "Place a neutral army",
};

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

  const skip = options.skipAnimations ?? prefersReducedMotion();
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
  /**
   * My optimistic actions, each tagged with the `clientActionId` it was SENT with (§5.5).
   *
   * The id is what the authority echoes back, so it is the only thing that can retire the right
   * entry. Counting confirmations instead retires the oldest N, which drops somebody else's row
   * from the front of the queue the moment two of my actions are in flight at once.
   */
  let pendingActions: { readonly id: string; readonly action: Action }[] = [];
  let displayedState: GameState = confirmedState;
  let folded = online ? 0 : 1;
  /**
   * The seq of the action this runner is about to produce — the RNG sub-stream index (D5, R88).
   *
   * Every resolver call is keyed on it: `rngFor(seed, "battle", nextSeq)`,
   * `rngFor(seed, "cardDeck", nextSeq)`, `rngFor(seed, "portalMove", nextSeq)` and
   * `rngFor(seed, `bot:${seat}`, nextSeq)`. `state.turn` is the wrong index and always was: it
   * changes once per turn, so **two attacks in the same turn drew the same dice** and a bot
   * re-entered twice in one turn blundered identically. The server keys on the action's seq, so
   * this is also the one index the two authorities agree on.
   */
  let nextSeq = options.resume?.nextSeq ?? folded + 1;

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
    allianceOffers: [],
    alliancePopover: null,
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
    for (const entry of pendingActions) {
      const r = engine.apply(next, map, entry.action);
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
      nextSeq,
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
        case "troopsAwarded": {
          // The award is a POPUP, not a modal: it holds for a beat and then
          // leaves. Nothing dismisses it otherwise, and while it is up its
          // scrim swallows every tap on the board underneath.
          const award = { seat: e.seat, base: e.base, bonus: e.bonus, capitals: e.capitals, total: e.total };
          set({ award });
          later(() => {
            if (store.getState().award === award) set({ award: null });
          }, AWARD_HOLD_MS);
          break;
        }
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
          // The anchor's work is done — unless dice are still on screen, in which case the
          // overlay that is using it clears it when it leaves.
          if (store.getState().dice === null) set({ pendingAttack: null });
          break;
        case "diceRolled":
          // Re-anchor from the event, so the overlay is positioned by the authority's own
          // from/to whether the roll was resolved here or arrived through `ingest`.
          set({
            dice: { attacker: e.attackerDice, defender: e.defenderDice },
            pendingAttack: { from: e.from, to: e.to },
          });
          later(() => {
            if (store.getState().dice === null) return;
            set({ dice: null, pendingAttack: null });
          }, 1600);
          break;
        case "allianceChanged": {
          const offers = store.getState().allianceOffers
            .filter((o) => !((o.from === e.a && o.to === e.b) || (o.from === e.b && o.to === e.a)));
          // A proposal stands until it is accepted or broken; accepting or breaking retires it.
          set({
            allianceOffers: e.state === "proposed" ? [...offers, { from: e.a, to: e.b }] : offers,
          });
          break;
        }
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
    nextSeq += 1;
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

  /**
   * Non-attack actions are applied optimistically and sent (§5.5).
   *
   * The id is minted **before** the action joins the pending queue, because the id is the handle
   * the authority's echo comes back on: an entry queued without one cannot be retired by the row
   * that confirms it, and `ingest` was reduced to retiring a *count* of entries instead.
   */
  function submitOnline(action: Action): ApplyResult {
    const probe = engine.apply(displayedState, map, action);
    if (probe.error) {
      set({ toast: probe.error.message });
      later(() => set({ toast: null }), 1400);
      return probe;
    }
    const id = clientActionId();
    pendingActions = [...pendingActions, { id, action }];
    refold();
    void sync?.submit(action, id).catch(() => {
      retirePending(id);
      refold();
      set({ syncStatus: "behind" });
    });
    return probe;
  }

  /** One resync ask per desync, until a snapshot answers it. */
  let resyncRequested = false;

  /** Drop the one optimistic entry the authority has now spoken for. */
  function retirePending(id: string | null): boolean {
    if (id === null) return false;
    const before = pendingActions.length;
    pendingActions = pendingActions.filter((entry) => entry.id !== id);
    return pendingActions.length !== before;
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
      afterRound(afterTurnEnd);
      return;
    }
    refreshSelection();
  }

  /** The round the runner has already paused for. */
  let pausedRound = confirmedState.round;

  /**
   * `rules.roundDelayMs` — a beat at the top of each new round, and nothing more (§4.7).
   *
   * Purely presentational: it is a pause between two actions, never an input to one, so it cannot
   * change an outcome and it is skipped entirely under `skipAnimations` / reduced motion. The
   * control on `/new/rules` has always written the field; this is what reads it. The banner the
   * `turnStarted` event raises is what fills the pause.
   */
  function afterRound(then: () => void): void {
    const round = confirmedState.round;
    if (round === pausedRound) {
      then();
      return;
    }
    pausedRound = round;
    const ms = skip ? 0 : Math.max(0, Math.min(10_000, Math.floor(confirmedState.rules.roundDelayMs || 0)));
    if (ms <= 0) {
      then();
      return;
    }
    set({ bannerText: `Round ${String(round)}` });
    later(then, ms);
  }

  /** Unstable portals relocate at the start of every third round (R76, §5.7). */
  function roundStartWork(): void {
    if (confirmedState.currentIndex !== 0 || confirmedState.rules.portals !== "unstable") return;
    const moved = engine.movePortals(confirmedState, map, engine.rngFor(config.seed, "portalMove", nextSeq));
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

  /** Get Ready is shown once per seat, on its first turn — not every turn. */
  const greeted = new Set<Seat>();

  function beginHumanTurn(seat: Seat): void {
    set({
      actingSeat: seat, viewerSeat: online ? store.getState().viewerSeat : seat,
      botPlaying: false, hidden: false, handOff: null, selected: null, litZone: [],
      actionMode: "idle", attackDice: "blitz", attackLimit: null,
    });
    if (!greeted.has(seat) && !options.resume) {
      greeted.add(seat);
      set({ modal: "getReady" });
      // A popup, not a modal: it leaves on its own, like the award. Anything
      // still up when the player wants to tap the board is a bug, not a beat.
      later(() => {
        if (store.getState().modal === "getReady") set({ modal: null });
      }, GET_READY_HOLD_MS);
    }
    refreshSelection();
  }

  let driver: BotDriver | null = null;

  function runBotTurn(seat: Seat): void {
    set({ botPlaying: true, actingSeat: seat, selected: null, litZone: [], actionMode: "idle" });
    driver = createBotDriver({
      engine, bots, odds, map, seat, grudge,
      rng: () => engine.rngFor(config.seed, `bot:${seat}`, nextSeq),
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
        afterRound(afterTurnEnd);
      }
      return;
    }
    const pace = aiStepMs(driver.size());
    if (step.kind === "intent") {
      const action = engine.rollAttack(
        confirmedState, map, step.intent,
        engine.rngFor(config.seed, "battle", nextSeq),
        odds, confirmedState.rules.diceMode,
      );
      applyLocal(action, true);
    } else if (step.action.type === "END_TURN") {
      if (confirmedState.conqueredThisTurn) awardCard(seat);
      const r = applyLocal(step.action, true);
      set({ botPlaying: false });
      if (!r.error) {
        roundStartWork();
        afterRound(afterTurnEnd);
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
      confirmedState, map, seat, engine.rngFor(config.seed, "cardDeck", nextSeq),
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
    if (state.phase === "claim") {
      // The claim phase lights its zone without a selection: there is nothing to select FROM, only
      // somewhere to put the one army this step owes — the seat's, or R6's neutral.
      const owed = engine.claimOwed(state, seat);
      set({
        litZone: owed === "neutral"
          ? engine.legalNeutralClaimTargets(state)
          : owed === "own" ? engine.legalOwnClaimTargets(state, seat) : [],
      });
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
      // R6 — ask the engine whose army this step owes. In the 2-seat variant each pair of the
      // seat's own armies is followed by one neutral army, and `validate` refuses the seat's own
      // claim until that one is placed, so a tap that always sends its own claim stalls setup
      // outright. Never guess the alternation from the UI's side.
      const owed = engine.claimOwed(state, seat);
      if (owed === "none") return;
      submit(owed === "neutral"
        ? { type: "CLAIM", seat, territory: at, forNeutral: true }
        : { type: "CLAIM", seat, territory: at });
      refreshSelection();
    }
  }

  /* ------------------------------------------------------------ online -- */

  /** The action kinds this build knows. Anything else is the authority's fog placeholder. */
  const KNOWN_ACTIONS: ReadonlySet<string> = new Set<Action["type"]>([
    "GAME_STARTED", "CLAIM", "TRADE_CARDS", "DRAFT", "AUTO_DEPLOY", "ATTACK", "MOVE_IN",
    "FORTIFY", "END_PHASE", "END_TURN", "CARD_DRAWN", "SEAT_TO_BOT", "SEAT_TO_HUMAN",
    "PORTALS_MOVED", "ALLIANCE_PROPOSE", "ALLIANCE_ACCEPT", "ALLIANCE_BREAK",
  ]);

  /**
   * A row the fold must advance over without applying (§5.5).
   *
   * Under fog the authority replaces an action it must not reveal with a placeholder of an unknown
   * `type`, and a `CARD_DRAWN` whose `card` it must not name arrives as `card: null`. Both are
   * **legitimate gaps in knowledge, not disagreements**: treating them as a desync would put every
   * fog game permanently in `"desynced"` from the first hidden action onwards.
   */
  function isMaskedRow(action: Action): boolean {
    if (!KNOWN_ACTIONS.has(action.type)) return true;
    return action.type === "CARD_DRAWN" && (action as { card?: unknown }).card == null;
  }

  /** The session asks the port for a cold re-read, however the adapter spells it (§5.8). */
  function requestResync(reason: string): void {
    if (resyncRequested) return;
    resyncRequested = true;
    if (typeof console !== "undefined") console.warn("[risk] resync:", reason);
    const port = sync;
    if (!port) return;
    const asked = port.resync?.();
    if (asked !== undefined) {
      void Promise.resolve(asked).catch(() => set({ syncStatus: "desynced" }));
      return;
    }
    // An adapter from before `resync` existed: nudge the cadence and poll. This cannot reset the
    // cursor, so it is a degradation rather than a fix — see the doc comment on `SyncPort.resync`.
    port.setIntervalMs?.(1000);
    void Promise.resolve(port.poll?.()).catch(() => set({ syncStatus: "desynced" }));
  }

  function ingest(actions: readonly LoggedAction[]): void {
    let changed = false;
    let retired = false;
    let gapAt: number | null = null;
    for (const row of [...actions].sort((a, b) => a.seq - b.seq)) {
      if (row.seq <= folded) {
        // Already folded, but it may still be the echo that retires my optimistic copy.
        if (retirePending(row.clientActionId)) retired = true;
        continue;
      }
      /*
       * §5.5 — the fold is contiguous or it is nothing. Applying seq N+2 on top of N silently
       * builds a state no authority ever had and then blames the next hash for it, so a gap stops
       * the fold here and asks for a cold re-read instead.
       */
      if (row.seq !== folded + 1) {
        gapAt = row.seq;
        break;
      }
      if (retirePending(row.clientActionId)) retired = true;
      if (row.action.type === "GAME_STARTED") {
        confirmedState = engine.createInitialState(map, row.action);
      } else if (isMaskedRow(row.action)) {
        // Nothing to apply; the fold advances so the next row stays contiguous.
      } else {
        const r = engine.apply(confirmedState, map, row.action);
        if (r.error) {
          desync(`seq ${String(row.seq)} refused: ${r.error.code}`);
          break;
        }
        confirmedState = r.state;
        handleEvents(r.events);
      }
      folded = row.seq;
      nextSeq = folded + 1;
      changed = true;
      if (!confirmedState.rules.fogOfWar && row.stateHash) {
        let hash: string | null = null;
        try {
          hash = engine.hashState(confirmedState);
        } catch {
          hash = null;
        }
        if (hash !== null && hash !== row.stateHash) {
          desync(`hash mismatch at seq ${String(row.seq)}`);
          break;
        }
      }
    }
    if (changed || retired) refold();
    if (changed && store.getState().syncStatus !== "desynced") set({ syncStatus: "idle" });
    if (gapAt !== null) {
      set({ syncStatus: "behind" });
      requestResync(`gap: have ${String(folded)}, next row is ${String(gapAt)}`);
    }
  }

  /**
   * §5.8/D16 — a disagreement is not something to carry on from.
   *
   * The local fold is wrong and every later row will be applied on top of the wrong state, so the
   * client stops trusting it: the optimistic queue goes, the status says so, and the port is asked
   * for a snapshot at cursor 0. `ingestSnapshot` is what clears the status again.
   */
  function desync(reason: string): void {
    pendingActions = [];
    set({ syncStatus: "desynced" });
    if (typeof console !== "undefined") console.error("[risk] desync —", reason);
    requestResync(reason);
  }

  /**
   * Replace the confirmed state with the authority's masked snapshot (§5.5, F36).
   *
   * `animate` carries rows the authority sent **for their events only** — a fog game gets a masked
   * view plus the actions behind it, and folding those would double-apply what the snapshot already
   * contains. So they are replayed against the pre-snapshot state purely to drain their events, and
   * neither `folded` nor the confirmed state moves for them.
   */
  function ingestSnapshot(
    snapshot: GameState, snapshotSeq: number, animate?: readonly LoggedAction[],
  ): void {
    if (animate && animate.length > 0) {
      let scratch = confirmedState;
      for (const row of [...animate].sort((a, b) => a.seq - b.seq)) {
        if (row.action.type === "GAME_STARTED" || isMaskedRow(row.action)) continue;
        const r = engine.apply(scratch, map, row.action);
        if (r.error) continue;
        scratch = r.state;
        handleEvents(r.events);
      }
    }
    confirmedState = snapshot;
    folded = snapshotSeq;
    nextSeq = snapshotSeq + 1;
    pendingActions = [];
    resyncRequested = false;
    refold();
    set({ syncStatus: "idle" });
  }

  const unsubActions = sync?.onActions((rows) => ingest(rows)) ?? null;
  const unsubStatus = sync?.onStatus((status) => set({ syncStatus: status })) ?? null;
  const unsubSnapshot = sync?.onSnapshot(
    (snapshot, seq, animate) => ingestSnapshot(snapshot, seq, animate),
  ) ?? null;

  /* -------------------------------------------------------- the actions -- */

  function submitAttack(intent: AttackIntent): void {
    if (!canAct()) return;
    /*
     * The Blitz view closes, but `pendingAttack` **stays**: it is the anchor the dice overlay is
     * positioned on, and the `diceRolled` event that fills that overlay arrives after this call —
     * offline from `applyLocal`, online from the next `ingest`. Clearing it here meant a manual
     * roll's dice had nowhere to land and never animated at all. `battleResolved` clears it once
     * the result has been shown.
     */
    set({ modal: null });
    if (online) {
      const id = clientActionId();
      void sync?.submitIntent(intent, id).then((rows) => ingest(rows)).catch(() => set({ syncStatus: "behind" }));
      return;
    }
    const action = engine.rollAttack(
      displayedState, map, intent,
      engine.rngFor(config.seed, "battle", nextSeq),
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

  /**
   * Resign (D76).
   *
   * Offline the runner is the authority, so it mints the `SEAT_TO_BOT` itself — persona and all.
   * **Online it may not**: `/actions` refuses a client-submitted `SEAT_TO_BOT`, because re-seating
   * a bot and re-timing the turn are the authority's business, so the resignation goes through the
   * port's own `resign()` and comes back as an authoritative row like any other.
   */
  function resign(): void {
    const seat = mySeat();
    set({ modal: null });
    if (online) {
      const port = sync;
      if (!port?.resign) {
        // An adapter without the route: say so rather than posting an action that will bounce.
        set({ toast: "Resigning is not available in this game" });
        later(() => set({ toast: null }), 1400);
        return;
      }
      void Promise.resolve(port.resign())
        .then((rows) => {
          if (rows) ingest(rows);
        })
        .catch(() => set({ syncStatus: "behind" }));
      return;
    }
    const persona = confirmedState.seats[seat]?.persona
      ?? bots.drawPersonas([confirmedState.rules.aiDifficulty],
        engine.rngFor(config.seed, "personaAssign", nextSeq),
        engine.rngFor(config.seed, "personaJitter", nextSeq))[0]
      ?? null;
    if (!persona) return;
    submit({ type: "SEAT_TO_BOT", seat, reason: "resigned", tier: confirmedState.rules.aiDifficulty, persona });
    if (actingSeat() === seat) afterTurnEnd();
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
    set({ viewerSeat: seat, actingSeat: seat });
    beginHumanTurn(seat);
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
      /*
       * R48 — `stopUntil` is "stop with this many troops left" and is at least 1, so 0 is not a
       * limiter at all: it is the slider's left stop, which means "no limiter". Normalising it to
       * `null` here keeps the illegal `stopUntil: 0` out of every intent, whichever control set it.
       */
      set({ attackLimit: stopUntil !== null && stopUntil > 0 ? Math.floor(stopUntil) : null });
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
      set({ handOff: null, hidden: false, viewerSeat: h.seat });
      beginHumanTurn(h.seat);
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
      nextSeq += 1;
      handleEvents(r.events);
      refold();
      persist();
      if (action.type === "END_TURN" && !confirmedState.outcome) afterRound(afterTurnEnd);
    },
    drainEvents() {
      const out = [...eventBuffer];
      eventBuffer.length = 0;
      return out;
    },
    prompt() {
      const state = displayedState;
      if (state.phase === "claim") {
        const owed = engine.claimOwed(state, actingSeat());
        if (owed === "neutral") return PROMPTS.claimNeutral as string;
        return owed === "own" ? (PROMPTS.claim as string) : "";
      }
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

    /* ---------------------------------------------------------- alliances (R80) -- */

    proposeAlliance(withSeat) {
      const me = mySeat();
      if (withSeat === me) return;
      submit({ type: "ALLIANCE_PROPOSE", seat: me, to: withSeat });
      // Offline there is no second device to answer, so the offer is recorded locally too; the
      // reducer's `allianceChanged` event does it online as well. One site, idempotent either way.
      set({ alliancePopover: null });
    },
    acceptAlliance(from) {
      const me = mySeat();
      if (from === me) return;
      submit({ type: "ALLIANCE_ACCEPT", seat: me, from });
      set({ alliancePopover: null });
    },
    breakAlliance(withSeat) {
      const me = mySeat();
      if (withSeat === me) return;
      submit({ type: "ALLIANCE_BREAK", seat: me, with: withSeat });
      set({ alliancePopover: null });
    },
    openAlliancePopover(seat) {
      set({ alliancePopover: seat });
    },
    allianceState(seat) {
      const me = mySeat();
      const offers = store.getState().allianceOffers;
      const allied = (displayedState.seats[me]?.allies ?? []).includes(seat);
      const offeredToMe = offers.some((o) => o.from === seat && o.to === me);
      const offeredByMe = offers.some((o) => o.from === me && o.to === seat);
      const kinds = engine.legalActions(displayedState, map, me);
      return {
        allied,
        offeredToMe,
        offeredByMe,
        canPropose: !allied && !offeredByMe && kinds.includes("ALLIANCE_PROPOSE"),
      };
    },
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
