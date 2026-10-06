/**
 * The session runner contract — SPEC §4.15, verbatim. Hour-one stub: S4 owns
 * this file and replaces `createSession`; S5 composes against the types.
 */
import type { StoreApi } from "zustand/vanilla";

import type {
  Action, ApplyResult, AttackIntent, GameConfig, GameState, MapDef, OddsTables, Outcome, Phase, Seat,
  TerritoryId,
} from "@/engine/types";
import type { LocalProgressPort } from "@/ports/localProgress";
import type { Settings, SettingsPort } from "@/ports/settings";
import type { SyncPort, SyncStatus } from "@/ports/sync";

import type { EngineApi } from "./engineApi";

export const AI_STEP_MS = 300;
export const AI_TURN_BUDGET_MS = 4000;
export const AI_STEP_MIN_MS = 40;
export function aiStepMs(actionCount: number): number {
  return Math.max(AI_STEP_MIN_MS, Math.min(AI_STEP_MS, Math.floor(AI_TURN_BUDGET_MS / Math.max(1, actionCount))));
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
  /** How many of my optimistic actions are still unconfirmed (§5.5's `pendingActions.length`).
   *  Drives the "sending…" affordance and the disabled state while a submit is in flight. 0
   *  offline, always. (F42) */
  pending: number;
  /** The authority's `turn_deadline`, ISO 8601, straight off POLL 3 — the timer bar reads this and
   *  never computes a deadline of its own. `null` offline and whenever no timer is set. (F42) */
  turnDeadline: string | null;
  settings: Settings;
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
  /**
   * The **displayed** state: `confirmed()` with my still-unconfirmed optimistic actions folded on
   * top (§5.5's `displayedState`). This is what the board paints and what every selector in the HUD
   * reads, because it is what the player just did. Offline it is identical to `confirmed()`. (F42)
   */
  readonly state: GameState;
  /** The **authoritative** state: the fold of the log, nothing optimistic. The hash assertion, the
   *  autosave and `__riskDebug.state()` all read this one — never `state`. (F42) */
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
}

export const createSession: (options: SessionOptions) => Session = () => {
  throw new Error("S4 pending: createSession");
};
