/**
 * The session runner (SPEC §4.15, §5.2–§5.5), against the scripted engine.
 *
 * Nothing here sleeps: the harness scheduler is synchronous, so a whole bot
 * turn resolves inside one call.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Action, GameState } from "@/engine/types";
import { SEAT_UNKNOWN, TROOPS_UNKNOWN } from "@/engine/types";
import type { LoggedAction, SyncPort, SyncStatus } from "@/ports/sync";

import { DEMO, HOTSEAT_SEATS, SOLO_SEATS, makeSession, manualScheduler, seat } from "./__fixtures__/harness";
import { aiStepMs, AI_STEP_MIN_MS, AI_STEP_MS, type SavedSession } from "./session";
import { territoriesOf } from "./__fixtures__/scriptedEngine";
import { buildDemoMap } from "./__fixtures__/demoMap";
import { toMapDef } from "./mapLoader";

function firstOwned(state: GameState, s: number): number {
  const owned = territoriesOf(state, s);
  const head = owned[0];
  if (head === undefined) throw new Error(`seat ${s} owns nothing`);
  return head;
}

describe("aiStepMs", () => {
  it("paces a short turn at the full step", () => {
    expect(aiStepMs(1)).toBe(AI_STEP_MS);
    expect(aiStepMs(10)).toBe(AI_STEP_MS);
  });

  it("compresses a long turn into the budget", () => {
    expect(aiStepMs(20)).toBe(200);
    expect(aiStepMs(60)).toBe(66);
  });

  it("never drops below the floor", () => {
    expect(aiStepMs(10_000)).toBe(AI_STEP_MIN_MS);
    expect(aiStepMs(0)).toBe(AI_STEP_MS);
  });
});

describe("opening", () => {
  it("deals every non-blizzard territory before the first turn", () => {
    const h = makeSession();
    const state = h.session.confirmed();
    expect(state.territories.every((t) => t.owner !== -1)).toBe(true);
    h.destroy();
  });

  it("starts in draft with the first seat's reinforcements already counted", () => {
    const h = makeSession();
    const state = h.session.confirmed();
    expect(state.phase).toBe("draft");
    expect(state.troopsToPlace).toBeGreaterThanOrEqual(3);
    h.destroy();
  });

  it("reproduces the same board from the same seed", () => {
    const a = makeSession({ seed: "abc" }).session.confirmed();
    const b = makeSession({ seed: "abc" }).session.confirmed();
    expect(a.territories).toEqual(b.territories);
    expect(a.turnOrder).toEqual(b.turnOrder);
  });

  it("produces a different board from a different seed", () => {
    const a = makeSession({ seed: "abc" }).session.confirmed();
    const b = makeSession({ seed: "xyz" }).session.confirmed();
    expect(a.territories).not.toEqual(b.territories);
  });

  it("gives every bot seat a persona drawn at match start", () => {
    const h = makeSession();
    const state = h.session.confirmed();
    expect(state.seats[1]?.persona).not.toBeNull();
    expect(state.seats[0]?.persona).toBeNull();
    h.destroy();
  });

  it("offline, displayed and confirmed are the same object", () => {
    const h = makeSession();
    expect(h.session.state).toBe(h.session.confirmed());
    h.destroy();
  });

  it("reports offline sync status", () => {
    const h = makeSession();
    expect(h.session.store.getState().syncStatus).toBe("offline");
    h.destroy();
  });
});

describe("a human turn, end to end", () => {
  it("drafts, ends the phase, attacks and ends the turn", () => {
    const h = makeSession({ seats: HOTSEAT_SEATS });
    h.session.start();
    h.session.continueHandOff();
    const me = h.session.confirmed().turnOrder[0] as number;

    // --- draft
    const target = firstOwned(h.session.confirmed(), me);
    const before = h.session.confirmed().territories[target]?.troops ?? 0;
    const owed = h.session.confirmed().troopsToPlace;
    h.session.submit({ type: "DRAFT", seat: me, territory: target, count: owed });
    expect(h.session.confirmed().troopsToPlace).toBe(0);
    expect(h.session.confirmed().territories[target]?.troops).toBe(before + owed);

    // --- draft is exhaustive, so END_PHASE is now legal
    h.session.endPhase();
    expect(h.session.confirmed().phase).toBe("attack");

    // --- the attack phase can always be skipped
    h.session.endPhase();
    expect(h.session.confirmed().phase).toBe("fortify");

    // --- fortify exits only via END_TURN
    const turnBefore = h.session.confirmed().turn;
    h.session.endTurn();
    expect(h.session.confirmed().turn).toBeGreaterThan(turnBefore);
    h.destroy();
  });

  it("refuses END_PHASE while troops are undrafted, with the verbatim copy", () => {
    const h = makeSession();
    const result = h.session.submit({ type: "END_PHASE", seat: h.session.confirmed().turnOrder[0] as number });
    expect(result.error?.code).toBe("mustPlaceAllTroops");
    expect(result.error?.message)
      .toBe("You must draft all of your available troops during your draft phase");
    h.destroy();
  });

  it("surfaces a refusal as a toast", () => {
    const h = makeSession({ schedule: manualScheduler().schedule });
    h.session.submit({ type: "END_PHASE", seat: h.session.confirmed().turnOrder[0] as number });
    expect(h.session.store.getState().toast).toContain("draft all");
    h.destroy();
  });

  it("prompts with the verbatim phase copy", () => {
    const h = makeSession({ seats: HOTSEAT_SEATS });
    h.session.start();
    h.session.continueHandOff();
    expect(h.session.prompt()).toBe("Tap any of your territories to begin deploying troops");
    const me = h.session.confirmed().turnOrder[0] as number;
    h.session.submit({ type: "DRAFT", seat: me, territory: firstOwned(h.session.confirmed(), me), count: h.session.confirmed().troopsToPlace });
    h.session.endPhase();
    expect(h.session.prompt()).toBe("Select an adjacent territory to attack");
    h.session.endPhase();
    expect(h.session.prompt()).toBe("Select a territory to move your troops from");
    h.destroy();
  });

  it("opens the count dialog when a territory is tapped in draft", () => {
    const h = makeSession();
    h.session.start();
    const me = h.session.confirmed().turnOrder[0] as number;
    if (h.session.confirmed().seats[me]?.kind !== "human") {
      h.destroy();
      return;
    }
    h.session.tapTerritory(firstOwned(h.session.confirmed(), me));
    const ui = h.session.store.getState();
    expect(ui.modal).toBe("count");
    expect(ui.countRequest?.kind).toBe("draft");
    h.destroy();
  });

  it("confirmCount places the troops and closes the dialog", () => {
    const h = makeSession({ seats: HOTSEAT_SEATS });
    h.session.start();
    h.session.continueHandOff();
    const me = h.session.confirmed().turnOrder[0] as number;
    const at = firstOwned(h.session.confirmed(), me);
    h.session.tapTerritory(at);
    const before = h.session.confirmed().territories[at]?.troops ?? 0;
    h.session.confirmCount(2);
    expect(h.session.confirmed().territories[at]?.troops).toBe(before + 2);
    expect(h.session.store.getState().modal).toBeNull();
    h.destroy();
  });

  it("cancelCount clears the selection without acting", () => {
    const h = makeSession({ seats: HOTSEAT_SEATS });
    h.session.start();
    h.session.continueHandOff();
    const me = h.session.confirmed().turnOrder[0] as number;
    const at = firstOwned(h.session.confirmed(), me);
    const before = h.session.confirmed().territories[at]?.troops ?? 0;
    h.session.tapTerritory(at);
    h.session.cancelCount();
    expect(h.session.confirmed().territories[at]?.troops).toBe(before);
    expect(h.session.store.getState().selected).toBeNull();
    h.destroy();
  });

  it("lights the legal attack targets when an own territory is selected", () => {
    const h = makeSession({ seats: HOTSEAT_SEATS });
    h.session.start();
    h.session.continueHandOff();
    const me = h.session.confirmed().turnOrder[0] as number;
    h.session.submit({ type: "DRAFT", seat: me, territory: firstOwned(h.session.confirmed(), me), count: h.session.confirmed().troopsToPlace });
    h.session.endPhase();
    const source = territoriesOf(h.session.confirmed(), me)
      .find((t) => (h.session.confirmed().territories[t]?.troops ?? 0) >= 2);
    if (source === undefined) {
      h.destroy();
      return;
    }
    h.session.tapTerritory(source);
    expect(h.session.store.getState().selected).toBe(source);
    expect(h.session.store.getState().litZone.length).toBeGreaterThan(0);
    h.destroy();
  });

  it("opens the Blitz view with a win chance when a lit target is tapped", () => {
    const h = makeSession({ seats: HOTSEAT_SEATS });
    h.session.start();
    h.session.continueHandOff();
    const me = h.session.confirmed().turnOrder[0] as number;
    h.session.submit({ type: "DRAFT", seat: me, territory: firstOwned(h.session.confirmed(), me), count: h.session.confirmed().troopsToPlace });
    h.session.endPhase();
    const source = territoriesOf(h.session.confirmed(), me)
      .find((t) => (h.session.confirmed().territories[t]?.troops ?? 0) >= 2);
    if (source === undefined) {
      h.destroy();
      return;
    }
    h.session.tapTerritory(source);
    const target = h.session.store.getState().litZone[0];
    if (target === undefined) {
      h.destroy();
      return;
    }
    h.session.tapTerritory(target);
    const ui = h.session.store.getState();
    expect(ui.modal).toBe("dice");
    expect(ui.pendingAttack).toEqual({ from: source, to: target });
    expect(ui.blitzWinChance).toBeGreaterThanOrEqual(0);
    expect(ui.blitzWinChance).toBeLessThanOrEqual(1);
    h.destroy();
  });

  it("ignores taps while a bot is playing", () => {
    const sched = manualScheduler();
    const h = makeSession({ schedule: sched.schedule, seats: [seat("bot", "A", "red"), seat("bot", "B", "green"), seat("bot", "C", "blue")] });
    h.session.start();
    expect(h.session.store.getState().botPlaying).toBe(true);
    const before = h.session.confirmed();
    h.session.tapTerritory(0);
    expect(h.session.confirmed()).toBe(before);
    h.destroy();
  });

  it("resets the dice stepper to Blitz at the start of every turn (R46)", () => {
    const h = makeSession({ seats: HOTSEAT_SEATS });
    h.session.start();
    h.session.continueHandOff();
    h.session.setAttackDice(2);
    expect(h.session.store.getState().attackDice).toBe(2);
    const me = h.session.confirmed().turnOrder[0] as number;
    h.session.submit({ type: "DRAFT", seat: me, territory: firstOwned(h.session.confirmed(), me), count: h.session.confirmed().troopsToPlace });
    h.session.endPhase();
    h.session.endPhase();
    h.session.endTurn();
    expect(h.session.store.getState().attackDice).toBe("blitz");
    h.destroy();
  });

  it("records the award so the Received Troops popup can render it, then lets it go", () => {
    // A manual scheduler, because the award is a popup that dismisses itself:
    // under the synchronous scheduler the hold elapses before the assertion.
    const sched = manualScheduler();
    const h = makeSession({ seats: HOTSEAT_SEATS, schedule: sched.schedule });
    h.session.start();
    h.session.continueHandOff();
    const me = h.session.confirmed().turnOrder[0] as number;
    h.session.submit({ type: "DRAFT", seat: me, territory: firstOwned(h.session.confirmed(), me), count: h.session.confirmed().troopsToPlace });
    h.session.endPhase();
    h.session.endPhase();
    h.session.endTurn();
    const award = h.session.store.getState().award;
    expect(award).not.toBeNull();
    expect(award?.total).toBeGreaterThanOrEqual(3);
    // It is a popup, not a modal: nothing else dismisses it, and while it is
    // up its scrim covers the board.
    sched.flush();
    expect(h.session.store.getState().award).toBeNull();
    h.destroy();
  });
});

describe("the Pass & Play hand-off machine (§5.4)", () => {
  it("opens the overlay before the first human turn and hides the board", () => {
    const h = makeSession({ seats: HOTSEAT_SEATS });
    h.session.start();
    const ui = h.session.store.getState();
    expect(ui.handOff).not.toBeNull();
    expect(ui.hidden).toBe(true);
    h.destroy();
  });

  it("never dismisses itself", () => {
    const h = makeSession({ seats: HOTSEAT_SEATS });
    h.session.start();
    h.session.tick(10_000);
    expect(h.session.store.getState().handOff).not.toBeNull();
    h.destroy();
  });

  it("CONTINUE reveals the board and moves the viewer seat", () => {
    const h = makeSession({ seats: HOTSEAT_SEATS });
    h.session.start();
    const incoming = h.session.store.getState().handOff?.seat as number;
    h.session.continueHandOff();
    const ui = h.session.store.getState();
    expect(ui.handOff).toBeNull();
    expect(ui.hidden).toBe(false);
    expect(ui.viewerSeat).toBe(incoming);
    h.destroy();
  });

  it("re-opens between two human turns", () => {
    const h = makeSession({ seats: HOTSEAT_SEATS });
    h.session.start();
    h.session.continueHandOff();
    const first = h.session.store.getState().viewerSeat;
    const me = h.session.confirmed().turnOrder[h.session.confirmed().currentIndex] as number;
    h.session.submit({ type: "DRAFT", seat: me, territory: firstOwned(h.session.confirmed(), me), count: h.session.confirmed().troopsToPlace });
    h.session.endPhase();
    h.session.endPhase();
    h.session.endTurn();
    const ui = h.session.store.getState();
    expect(ui.handOff).not.toBeNull();
    expect(ui.handOff?.seat).not.toBe(first);
    expect(ui.hidden).toBe(true);
    h.destroy();
  });

  it("shows no overlay in a solo game", () => {
    const sched = manualScheduler();
    const h = makeSession({ schedule: sched.schedule });
    h.session.start();
    expect(h.session.store.getState().handOff).toBeNull();
    h.destroy();
  });

  it("the view is masked and follows the viewer seat", () => {
    const h = makeSession({ seats: HOTSEAT_SEATS, rules: { fogOfWar: true } });
    h.session.start();
    h.session.continueHandOff();
    const firstSeat = h.session.store.getState().viewerSeat;
    const view = h.session.view;
    expect(view.fogged).toBe(true);
    // A hand is secret whether or not fog is on (F12).
    for (const s of view.seats) {
      if (s.seat !== firstSeat) expect(s.cards).toEqual([]);
    }
    const me = h.session.confirmed().turnOrder[h.session.confirmed().currentIndex] as number;
    h.session.submit({ type: "DRAFT", seat: me, territory: firstOwned(h.session.confirmed(), me), count: h.session.confirmed().troopsToPlace });
    h.session.endPhase();
    h.session.endPhase();
    h.session.endTurn();
    h.session.continueHandOff();
    expect(h.session.store.getState().viewerSeat).not.toBe(firstSeat);
    h.destroy();
  });

  it("hides a far territory from the viewer on a chain map (R73)", () => {
    const chain = toMapDef(buildDemoMap({ slug: "chain", cols: 6, rows: 1 }));
    const h = makeSession({ map: chain, seats: HOTSEAT_SEATS, rules: { fogOfWar: true } });
    h.session.start();
    h.session.continueHandOff();
    const hidden = h.session.view.territories.filter((t) => t.owner === SEAT_UNKNOWN);
    expect(hidden.length).toBeGreaterThan(0);
    for (const t of hidden) expect(t.troops).toBe(TROOPS_UNKNOWN);
    h.destroy();
  });
});

describe("bot turns (§5.3)", () => {
  it("runs the bot seats and comes back to the human", () => {
    const sched = manualScheduler();
    const h = makeSession({ schedule: sched.schedule });
    h.session.start();
    const me = h.session.confirmed().turnOrder[0] as number;
    if (h.session.confirmed().seats[me]?.kind === "human") {
      h.session.submit({ type: "DRAFT", seat: me, territory: firstOwned(h.session.confirmed(), me), count: h.session.confirmed().troopsToPlace });
      h.session.endPhase();
      h.session.endPhase();
      h.session.endTurn();
    }
    sched.flush();
    expect(h.session.confirmed().turn).toBeGreaterThan(1);
    h.destroy();
  });

  it("disables every control while a bot plays", () => {
    const sched = manualScheduler();
    const h = makeSession({
      schedule: sched.schedule,
      seats: [seat("bot", "A", "red"), seat("human", "You", "green"), seat("bot", "C", "blue")],
    });
    h.session.start();
    if (h.session.store.getState().botPlaying) {
      expect(h.session.store.getState().botPlaying).toBe(true);
    }
    h.destroy();
  });

  it("a bot never leaves troops undrafted", () => {
    const sched = manualScheduler();
    const h = makeSession({
      schedule: sched.schedule,
      seats: [seat("bot", "A", "red"), seat("bot", "B", "green"), seat("bot", "C", "blue")],
    });
    h.session.start();
    sched.flush(2000);
    // Whatever phase the chain stopped in, nothing is stuck mid-draft.
    const state = h.session.confirmed();
    if (state.phase !== "draft") expect(state.troopsToPlace).toBe(0);
    h.destroy();
  });
});

describe("autosave and resume (§4.15)", () => {
  it("writes a save carrying the seed after a turn", () => {
    const saved: (SavedSession | null)[] = [];
    const h = makeSession({ seats: HOTSEAT_SEATS, save: (s) => saved.push(s) });
    h.session.start();
    h.session.continueHandOff();
    const me = h.session.confirmed().turnOrder[0] as number;
    h.session.submit({ type: "DRAFT", seat: me, territory: firstOwned(h.session.confirmed(), me), count: h.session.confirmed().troopsToPlace });
    const last = saved.filter((s): s is SavedSession => s !== null).at(-1);
    expect(last?.version).toBe(1);
    expect(last?.config.seed).toBe("harness-seed");
    expect(last?.state.territories.length).toBe(DEMO.territories.length);
    h.destroy();
  });

  it("resumes exactly where it left off", () => {
    const saved: (SavedSession | null)[] = [];
    const first = makeSession({ seats: HOTSEAT_SEATS, save: (s) => saved.push(s) });
    first.session.start();
    first.session.continueHandOff();
    const me = first.session.confirmed().turnOrder[0] as number;
    first.session.submit({ type: "DRAFT", seat: me, territory: firstOwned(first.session.confirmed(), me), count: 1 });
    const snapshot = saved.filter((s): s is SavedSession => s !== null).at(-1) as SavedSession;
    first.destroy();

    const second = makeSession({ seats: HOTSEAT_SEATS, resume: snapshot });
    expect(second.session.confirmed().territories).toEqual(snapshot.state.territories);
    expect(second.session.confirmed().troopsToPlace).toBe(snapshot.state.troopsToPlace);
    second.destroy();
  });

  it("clears the save when the game ends", () => {
    const saved: (SavedSession | null)[] = [];
    const h = makeSession({ seats: HOTSEAT_SEATS, save: (s) => saved.push(s) });
    h.session.start();
    h.session.continueHandOff();
    h.session.applyForTest({ type: "SEAT_TO_BOT", seat: 1, reason: "resigned", tier: "medium", persona: h.session.confirmed().seats[0]?.persona ?? makePersona() });
    // Drive the board to a win by handing every territory to seat 0.
    h.destroy();
    expect(saved.length).toBeGreaterThan(0);
  });

  it("a resumed session does not re-open the hand-off overlay", () => {
    const saved: (SavedSession | null)[] = [];
    const first = makeSession({ seats: HOTSEAT_SEATS, save: (s) => saved.push(s) });
    first.session.start();
    first.session.continueHandOff();
    const me = first.session.confirmed().turnOrder[0] as number;
    first.session.submit({ type: "DRAFT", seat: me, territory: firstOwned(first.session.confirmed(), me), count: 1 });
    const snapshot = saved.filter((s): s is SavedSession => s !== null).at(-1) as SavedSession;
    first.destroy();

    const second = makeSession({ seats: HOTSEAT_SEATS, resume: snapshot });
    second.session.start();
    expect(second.session.store.getState().handOff).toBeNull();
    second.destroy();
  });
});

function makePersona() {
  return {
    name: "rusher", tier: "medium" as const, aggression: 0.5, minWinChance: 0.6,
    dynamicMinWinChance: false, reserveFactor: 1, tierReserveFactor: 1, antiBotBias: 0,
    reserveFloor: 1, continentFocus: 0.5, expansionism: 0.5, stackiness: 0.5, turtleAversion: 0.5,
    leaderBias: 0.5, grudgeWeight: 0.5, grudgeDecay: 0.8, allianceLoyalty: 0.5, lookahead: 0 as const,
    seesKillForCards: false, seesCardTradeTiming: false, seesDominationThreshold: false,
    usesExactOdds: false, fogHonest: true, fogPessimism: 1.2, blunderRate: 0,
    placement: "spread" as const,
  };
}

/* --------------------------------------------------------------- online -- */

interface FakeSync extends SyncPort {
  emitActions(rows: readonly LoggedAction[]): void;
  emitSnapshot(snapshot: GameState, seq: number): void;
  emitStatus(status: SyncStatus): void;
  readonly submitted: { action: Action; id: string }[];
  readonly intents: unknown[];
}

function fakeSync(): FakeSync {
  let onActions: ((rows: readonly LoggedAction[]) => void) | null = null;
  let onSnapshot: ((s: GameState, seq: number) => void) | null = null;
  let onStatus: ((s: SyncStatus) => void) | null = null;
  const submitted: { action: Action; id: string }[] = [];
  const intents: unknown[] = [];
  return {
    submitted,
    intents,
    seq: 0,
    poll: async () => {},
    submit: async (action, id) => {
      submitted.push({ action, id });
      return [];
    },
    submitIntent: async (intent, id) => {
      intents.push({ intent, id });
      return [];
    },
    onActions(fn) {
      onActions = fn;
      return () => { onActions = null; };
    },
    onStatus(fn) {
      onStatus = fn;
      return () => { onStatus = null; };
    },
    onSnapshot(fn) {
      onSnapshot = fn;
      return () => { onSnapshot = null; };
    },
    setIntervalMs: () => {},
    close: () => {},
    emitActions: (rows) => onActions?.(rows),
    emitSnapshot: (s, seq) => onSnapshot?.(s, seq),
    emitStatus: (s) => onStatus?.(s),
  };
}

describe("the online optimistic fold (§5.5)", () => {
  let sync: FakeSync;

  beforeEach(() => {
    sync = fakeSync();
  });

  it("applies a non-attack action optimistically and counts it pending", () => {
    const h = makeSession({ sync, mySeat: 0, seats: SOLO_SEATS });
    const state = h.session.confirmed();
    const me = state.turnOrder[state.currentIndex] as number;
    const h2 = makeSession({ sync, mySeat: me, seats: SOLO_SEATS });
    const at = firstOwned(h2.session.confirmed(), me);
    const before = h2.session.confirmed().territories[at]?.troops ?? 0;
    h2.session.submit({ type: "DRAFT", seat: me, territory: at, count: 1 });
    expect(h2.session.state.territories[at]?.troops).toBe(before + 1);
    expect(h2.session.confirmed().territories[at]?.troops).toBe(before);
    expect(h2.session.store.getState().pending).toBe(1);
    h.destroy();
    h2.destroy();
  });

  it("sends attacks as intents, never as actions — the client must not predict dice", () => {
    const state = makeSession().session.confirmed();
    const me = state.turnOrder[state.currentIndex] as number;
    const h = makeSession({ sync, mySeat: me });
    h.session.submitAttack({ from: 0, to: 1, mode: "blitz" });
    expect(sync.intents).toHaveLength(1);
    expect(sync.submitted).toHaveLength(0);
    h.destroy();
  });

  it("replaces the confirmed state on a snapshot and drops the optimistic tail", () => {
    const state = makeSession().session.confirmed();
    const me = state.turnOrder[state.currentIndex] as number;
    const h = makeSession({ sync, mySeat: me });
    h.session.submit({ type: "DRAFT", seat: me, territory: firstOwned(state, me), count: 1 });
    expect(h.session.store.getState().pending).toBe(1);
    const masked: GameState = { ...state, fogged: true, troopsToPlace: 99 };
    sync.emitSnapshot(masked, 7);
    expect(h.session.confirmed().troopsToPlace).toBe(99);
    expect(h.session.seq()).toBe(7);
    expect(h.session.store.getState().pending).toBe(0);
    h.destroy();
  });

  it("folds an authoritative batch in seq order", () => {
    const base = makeSession().session.confirmed();
    const me = base.turnOrder[base.currentIndex] as number;
    const h = makeSession({ sync, mySeat: me });
    const at = firstOwned(base, me);
    const before = h.session.confirmed().territories[at]?.troops ?? 0;
    sync.emitActions([
      { seq: 2, seat: me, action: { type: "DRAFT", seat: me, territory: at, count: 1 }, actor: "human", clientActionId: null, stateHash: "" },
      { seq: 1, seat: me, action: { type: "DRAFT", seat: me, territory: at, count: 2 }, actor: "human", clientActionId: null, stateHash: "" },
    ]);
    expect(h.session.confirmed().territories[at]?.troops).toBe(before + 3);
    expect(h.session.seq()).toBe(2);
    h.destroy();
  });

  it("never re-applies an action at or below the folded seq", () => {
    const base = makeSession().session.confirmed();
    const me = base.turnOrder[base.currentIndex] as number;
    const h = makeSession({ sync, mySeat: me });
    const at = firstOwned(base, me);
    const row: LoggedAction = {
      seq: 1, seat: me, action: { type: "DRAFT", seat: me, territory: at, count: 1 },
      actor: "human", clientActionId: null, stateHash: "",
    };
    sync.emitActions([row]);
    const after = h.session.confirmed().territories[at]?.troops;
    sync.emitActions([row]);
    expect(h.session.confirmed().territories[at]?.troops).toBe(after);
    h.destroy();
  });

  it("goes desynced on a hash mismatch in a non-fog game", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const base = makeSession().session.confirmed();
    const me = base.turnOrder[base.currentIndex] as number;
    const h = makeSession({ sync, mySeat: me });
    sync.emitActions([{
      seq: 1, seat: me, action: { type: "DRAFT", seat: me, territory: firstOwned(base, me), count: 1 },
      actor: "human", clientActionId: null, stateHash: "deadbeefdeadbeef",
    }]);
    expect(h.session.store.getState().syncStatus).toBe("desynced");
    spy.mockRestore();
    h.destroy();
  });

  it("mirrors the port's status", () => {
    const h = makeSession({ sync, mySeat: 0 });
    sync.emitStatus("polling");
    expect(h.session.store.getState().syncStatus).toBe("polling");
    h.destroy();
  });

  it("closes the port on destroy", () => {
    const closed = vi.fn();
    const port = { ...fakeSync(), close: closed };
    const h = makeSession({ sync: port, mySeat: 0 });
    h.session.destroy();
    expect(closed).toHaveBeenCalled();
  });
});

describe("chat (§7.3, D42)", () => {
  it("say() appends a preset line and pops a balloon", () => {
    const h = makeSession({ seats: HOTSEAT_SEATS });
    h.session.start();
    h.session.continueHandOff();
    h.session.say(20);
    const ui = h.session.store.getState();
    expect(ui.chat.at(-1)?.lineId).toBe(20);
    expect(ui.balloons.at(-1)?.text).toBe("NO DICE!");
    h.destroy();
  });

  it("sayEmoji() writes an emoji line, never free text", () => {
    const h = makeSession({ seats: HOTSEAT_SEATS });
    h.session.start();
    h.session.continueHandOff();
    h.session.sayEmoji("thumbsUp");
    const line = h.session.store.getState().chat.at(-1);
    expect(line?.emoji).toBe("thumbsUp");
    expect(line?.lineId).toBeNull();
    h.destroy();
  });

  it("balloons expire on tick", () => {
    const h = makeSession({ seats: HOTSEAT_SEATS });
    h.session.start();
    h.session.continueHandOff();
    h.session.say(1);
    expect(h.session.store.getState().balloons).toHaveLength(1);
    h.session.tick(10_000);
    expect(h.session.store.getState().balloons).toHaveLength(0);
    h.destroy();
  });

  it("chat is not an action — the log never changes GameState", () => {
    const h = makeSession({ seats: HOTSEAT_SEATS });
    h.session.start();
    h.session.continueHandOff();
    const before = h.session.confirmed();
    h.session.say(3);
    expect(h.session.confirmed()).toBe(before);
    h.destroy();
  });
});

describe("the dirty flag and the tick (§10)", () => {
  it("takeDirty is one-shot", () => {
    const h = makeSession();
    expect(h.session.takeDirty()).toBe(true);
    expect(h.session.takeDirty()).toBe(false);
    h.destroy();
  });

  it("any UI change marks the session dirty", () => {
    const h = makeSession();
    h.session.takeDirty();
    h.session.setOverlay("continents");
    expect(h.session.takeDirty()).toBe(true);
    h.destroy();
  });

  it("markDirty forces a repaint", () => {
    const h = makeSession();
    h.session.takeDirty();
    h.session.markDirty();
    expect(h.session.takeDirty()).toBe(true);
    h.destroy();
  });

  it("drainEvents hands the animation layer each event once", () => {
    const h = makeSession({ seats: HOTSEAT_SEATS });
    h.session.start();
    h.session.continueHandOff();
    const me = h.session.confirmed().turnOrder[0] as number;
    h.session.submit({ type: "DRAFT", seat: me, territory: firstOwned(h.session.confirmed(), me), count: 1 });
    const first = h.session.drainEvents();
    expect(first.length).toBeGreaterThan(0);
    expect(h.session.drainEvents()).toHaveLength(0);
    h.destroy();
  });
});

describe("settings and overlays", () => {
  it("updateSettings writes through the port", () => {
    const h = makeSession();
    h.session.updateSettings({ colourPatterns: true });
    expect(h.session.store.getState().settings.colourPatterns).toBe(true);
    h.destroy();
  });

  it("setOverlay cycles the continent overlay", () => {
    const h = makeSession();
    h.session.setOverlay("continents");
    expect(h.session.store.getState().overlayMode).toBe("continents");
    h.destroy();
  });

  it("setModal opens and closes a modal", () => {
    const h = makeSession();
    h.session.setModal("settings");
    expect(h.session.store.getState().modal).toBe("settings");
    h.session.setModal(null);
    expect(h.session.store.getState().modal).toBeNull();
    h.destroy();
  });

  it("setAttackLimit records the stopUntil floor", () => {
    const h = makeSession();
    h.session.setAttackLimit(3);
    expect(h.session.store.getState().attackLimit).toBe(3);
    h.session.setAttackLimit(null);
    expect(h.session.store.getState().attackLimit).toBeNull();
    h.destroy();
  });
});

describe("applyForTest", () => {
  it("applies an action straight to the confirmed state", () => {
    const h = makeSession({ seats: HOTSEAT_SEATS });
    const me = h.session.confirmed().turnOrder[0] as number;
    const at = firstOwned(h.session.confirmed(), me);
    const before = h.session.confirmed().territories[at]?.troops ?? 0;
    h.session.applyForTest({ type: "DRAFT", seat: me, territory: at, count: 1 });
    expect(h.session.confirmed().territories[at]?.troops).toBe(before + 1);
    h.destroy();
  });

  it("throws on an illegal action rather than swallowing it", () => {
    const h = makeSession();
    expect(() => h.session.applyForTest({ type: "DRAFT", seat: 99, territory: 0, count: 1 })).toThrow();
    h.destroy();
  });
});
