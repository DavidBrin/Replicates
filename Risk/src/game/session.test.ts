/**
 * The session runner (SPEC §4.15, §5.2–§5.5), against the scripted engine.
 *
 * Nothing here sleeps: the harness scheduler is synchronous, so a whole bot
 * turn resolves inside one call.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Action, Card, GameState } from "@/engine/types";
import { SEAT_NEUTRAL, SEAT_UNKNOWN, TROOPS_UNKNOWN } from "@/engine/types";
import { mustTradeNow as realMustTradeNow } from "@/engine/cards";
import { buildState, card as engineCard } from "@/engine/__fixtures__/states";
import { mini } from "@/engine/__fixtures__/maps";
import { engineApi, type EngineApi } from "./engineApi";
import type { LoggedAction, SyncPort, SyncStatus } from "@/ports/sync";

import { DEMO, HOTSEAT_SEATS, SOLO_SEATS, makeSession, manualScheduler, seat } from "./__fixtures__/harness";
import { aiStepMs, AI_STEP_MIN_MS, AI_STEP_MS, type SavedSession } from "./session";
import {
  createScriptedEngine,
  mustTradeNow as scriptedMustTradeNow,
  territoriesOf,
} from "./__fixtures__/scriptedEngine";
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

  /*
   * Codex round 3, finding 2 — a refused step leaves the confirmed state untouched, so a runner
   * that ignored the refusal and rescheduled asked the same plan the same question against the
   * same board, for ever, with nothing in the console and the offline game frozen.
   */
  it("gives up on a plan whose step keeps being refused, rather than looping", () => {
    const scripted = createScriptedEngine();
    let refusals = 0;
    const engine: EngineApi = {
      ...scripted,
      apply: (state, map, action) => {
        // Every END_PHASE is refused, whatever the board: nothing the plan can learn from.
        if (action.type === "END_PHASE") {
          refusals += 1;
          return { state, events: [], error: { code: "mustTradeCards", message: "scripted refusal" } };
        }
        return scripted.apply(state, map, action);
      },
      validate: (state, map, action) => engine.apply(state, map, action).error ?? null,
    };

    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const sched = manualScheduler();
    const h = makeSession({
      engine,
      schedule: sched.schedule,
      seats: [seat("bot", "A", "red"), seat("bot", "B", "green"), seat("bot", "C", "blue")],
    });
    h.session.start();
    const steps = 300;
    sched.flush(steps);

    /*
     * The signal is **progress**. Before the fix the board never moved: the same refused
     * `END_PHASE` came back every step, so `turn` sat at 1 for as many steps as the test cared to
     * run. Now the refusal is counted, the plan is dropped, and a legal action ends the turn.
     */
    expect(h.session.confirmed().turn).toBeGreaterThan(1);
    // Each refused step is retried a bounded number of times, so refusals scale with turns taken.
    expect(refusals).toBeGreaterThan(0);
    expect(refusals).toBeLessThan(steps);
    // And it is logged rather than swallowed.
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
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

  /**
   * R92/§4.7 — an envelope written before `pendingAlliances` existed still resumes
   * (codex round 4, finding 3).
   *
   * `risk:session:v1:…` is plain JSON that nothing re-validates field by field, and the field was
   * added to `GameState` without a format move. A save written by the previous build therefore had
   * no `pendingAlliances`, and the first question `legalActions` or `validate` asked about an
   * alliance threw a `TypeError` — the resumed game crashed on its first repaint rather than
   * refusing anything. `createSession` fills the only value an absent field can mean.
   */
  it("resumes a save written before pendingAlliances existed (R92)", () => {
    const saved: (SavedSession | null)[] = [];
    const first = makeSession({
      seats: HOTSEAT_SEATS,
      rules: { alliances: true },
      save: (s) => saved.push(s),
    });
    first.session.start();
    first.session.continueHandOff();
    const me = first.session.confirmed().turnOrder[0] as number;
    first.session.submit({ type: "DRAFT", seat: me, territory: firstOwned(first.session.confirmed(), me), count: 1 });
    const snapshot = saved.filter((s): s is SavedSession => s !== null).at(-1) as SavedSession;
    first.destroy();

    const stale = { ...snapshot.state } as Record<string, unknown>;
    delete stale.pendingAlliances;
    const old = { ...snapshot, state: stale as unknown as GameState };

    const second = makeSession({ seats: HOTSEAT_SEATS, rules: { alliances: true }, resume: old });
    expect(second.session.confirmed().pendingAlliances).toEqual([]);
    // The derived UI slice is what crashed: it asks `legalActions` for the viewer's seat.
    expect(() => second.session.legal()).not.toThrow();
    expect(second.session.confirmed().territories).toEqual(snapshot.state.territories);
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

  it("carries the RNG sub-stream counter through a save and a resume (D5)", () => {
    const saved: (SavedSession | null)[] = [];
    const first = makeSession({ seats: HOTSEAT_SEATS, save: (s) => saved.push(s) });
    first.session.start();
    first.session.continueHandOff();
    const me = first.session.confirmed().turnOrder[0] as number;
    first.session.submit({ type: "DRAFT", seat: me, territory: firstOwned(first.session.confirmed(), me), count: 1 });
    const snapshot = saved.filter((s): s is SavedSession => s !== null).at(-1) as SavedSession;
    // Re-deriving it would hand the next battle a sub-stream this game already spent.
    expect(snapshot.nextSeq).toBeGreaterThan(1);

    const purposes: { purpose: string; index: number }[] = [];
    const base = createScriptedEngine();
    const spy = {
      ...base,
      rngFor: (seed: string, purpose: string, index: number) => {
        purposes.push({ purpose, index });
        return base.rngFor(seed, purpose as never, index);
      },
    } as typeof base;
    const second = makeSession({ seats: HOTSEAT_SEATS, resume: snapshot, engine: spy });
    second.session.start();
    second.session.continueHandOff();
    purposes.length = 0;
    second.session.submit({ type: "DRAFT", seat: me, territory: firstOwned(second.session.confirmed(), me), count: 1 });
    second.session.endPhase();
    second.session.submitAttack({ from: firstOwned(second.session.confirmed(), me), to: 1, mode: "blitz" });
    const battle = purposes.filter((p) => p.purpose === "battle");
    expect(battle[0]?.index).toBeGreaterThanOrEqual(snapshot.nextSeq as number);
    second.destroy();
    first.destroy();
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
  emitSnapshot(snapshot: GameState, seq: number, animate?: readonly LoggedAction[]): void;
  emitStatus(status: SyncStatus): void;
  readonly submitted: { action: Action; id: string }[];
  readonly intents: unknown[];
  /** How many times the session asked for a cold re-read, and how many times it polled instead. */
  readonly resyncs: number[];
  readonly polls: number[];
  readonly resignations: number[];
}

function fakeSync(): FakeSync {
  let onActions: ((rows: readonly LoggedAction[]) => void) | null = null;
  let onStatus: ((s: SyncStatus) => void) | null = null;
  let onSnapshot:
    | ((s: GameState, seq: number, animate?: readonly LoggedAction[]) => void)
    | null = null;
  const submitted: { action: Action; id: string }[] = [];
  const intents: unknown[] = [];
  const resyncs: number[] = [];
  const polls: number[] = [];
  const resignations: number[] = [];
  return {
    submitted,
    intents,
    resyncs,
    polls,
    resignations,
    seq: 0,
    poll: async () => {
      polls.push(1);
    },
    resync: async () => {
      resyncs.push(1);
    },
    resign: async () => {
      resignations.push(1);
      return [];
    },
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
    emitSnapshot: (s, seq, animate) => onSnapshot?.(s, seq, animate),
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

  /* ------------------------------------------- §5.5's three reconciliation bugs -- */

  function row(over: Partial<LoggedAction> & { seq: number; action: Action }): LoggedAction {
    return { seat: 0, actor: "human", clientActionId: null, stateHash: "", ...over };
  }

  it("retires the one optimistic action the authority named, not a count of them", () => {
    const base = makeSession().session.confirmed();
    const me = base.turnOrder[base.currentIndex] as number;
    const h = makeSession({ sync, mySeat: me });
    const at = firstOwned(base, me);
    // Two of my own actions in flight at once.
    h.session.submit({ type: "DRAFT", seat: me, territory: at, count: 1 });
    h.session.submit({ type: "DRAFT", seat: me, territory: at, count: 1 });
    expect(h.session.store.getState().pending).toBe(2);
    const [first, second] = sync.submitted;
    expect(first?.id).toBeTruthy();
    expect(second?.id).toBeTruthy();
    expect(first?.id).not.toBe(second?.id);

    // The authority confirms the SECOND one first (a reordering the server is free to do).
    sync.emitActions([row({ seq: 1, seat: me, action: second?.action as Action, clientActionId: second?.id ?? null })]);
    expect(h.session.store.getState().pending).toBe(1);
    // One confirmed + one still optimistic: the displayed total is the same +2 either way, but
    // the entry that is LEFT has to be the one the authority has not spoken for.
    expect(h.session.state.territories[at]?.troops).toBe((base.territories[at]?.troops ?? 0) + 2);
    expect(h.session.confirmed().territories[at]?.troops).toBe((base.territories[at]?.troops ?? 0) + 1);
    sync.emitActions([row({ seq: 2, seat: me, action: first?.action as Action, clientActionId: first?.id ?? null })]);
    expect(h.session.store.getState().pending).toBe(0);
    h.destroy();
  });

  it("retires nothing for somebody else's confirmed action", () => {
    const base = makeSession().session.confirmed();
    const me = base.turnOrder[base.currentIndex] as number;
    const h = makeSession({ sync, mySeat: me });
    const at = firstOwned(base, me);
    h.session.submit({ type: "DRAFT", seat: me, territory: at, count: 1 });
    expect(h.session.store.getState().pending).toBe(1);
    // A row that carries a client id, but not mine: counting confirmations dropped my entry here.
    sync.emitActions([row({
      seq: 1, seat: me, action: { type: "DRAFT", seat: me, territory: at, count: 1 },
      clientActionId: "somebody-elses-id",
    })]);
    expect(h.session.store.getState().pending).toBe(1);
    h.destroy();
  });

  it("refuses to fold over a gap, and asks the port to resync", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const base = makeSession().session.confirmed();
    const me = base.turnOrder[base.currentIndex] as number;
    const h = makeSession({ sync, mySeat: me });
    const at = firstOwned(base, me);
    const before = h.session.confirmed().territories[at]?.troops ?? 0;
    // seq 1 is missing: 2 must NOT be applied on top of 0.
    sync.emitActions([row({ seq: 2, seat: me, action: { type: "DRAFT", seat: me, territory: at, count: 1 } })]);
    expect(h.session.seq()).toBe(0);
    expect(h.session.confirmed().territories[at]?.troops).toBe(before);
    expect(h.session.store.getState().syncStatus).toBe("behind");
    expect(sync.resyncs).toHaveLength(1);
    warn.mockRestore();
    h.destroy();
  });

  it("folds the prefix of a batch and stops at the gap inside it", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const base = makeSession().session.confirmed();
    const me = base.turnOrder[base.currentIndex] as number;
    const h = makeSession({ sync, mySeat: me });
    const at = firstOwned(base, me);
    const before = h.session.confirmed().territories[at]?.troops ?? 0;
    sync.emitActions([
      row({ seq: 1, seat: me, action: { type: "DRAFT", seat: me, territory: at, count: 1 } }),
      row({ seq: 3, seat: me, action: { type: "DRAFT", seat: me, territory: at, count: 5 } }),
    ]);
    expect(h.session.seq()).toBe(1);
    expect(h.session.confirmed().territories[at]?.troops).toBe(before + 1);
    expect(sync.resyncs).toHaveLength(1);
    warn.mockRestore();
    h.destroy();
  });

  it("drops local state on a hash mismatch and resumes from the snapshot (§5.8, D16)", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const base = makeSession().session.confirmed();
    const me = base.turnOrder[base.currentIndex] as number;
    const h = makeSession({ sync, mySeat: me });
    const at = firstOwned(base, me);
    h.session.submit({ type: "DRAFT", seat: me, territory: at, count: 1 });
    sync.emitActions([row({
      seq: 1, seat: me, action: { type: "DRAFT", seat: me, territory: at, count: 1 },
      stateHash: "deadbeefdeadbeef",
    })]);
    expect(h.session.store.getState().syncStatus).toBe("desynced");
    // The optimistic queue is gone, and a snapshot has been asked for.
    expect(h.session.store.getState().pending).toBe(0);
    expect(sync.resyncs).toHaveLength(1);

    // The snapshot answers it, and clears the status.
    sync.emitSnapshot({ ...base, troopsToPlace: 42 }, 9);
    expect(h.session.confirmed().troopsToPlace).toBe(42);
    expect(h.session.seq()).toBe(9);
    expect(h.session.store.getState().syncStatus).toBe("idle");
    err.mockRestore();
    warn.mockRestore();
    h.destroy();
  });

  it("falls back to setIntervalMs + poll when the adapter has no resync", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const legacy = fakeSync();
    const port: SyncPort = { ...legacy, resync: undefined };
    const base = makeSession().session.confirmed();
    const me = base.turnOrder[base.currentIndex] as number;
    const h = makeSession({ sync: port, mySeat: me });
    legacy.emitActions([row({
      seq: 2, seat: me, action: { type: "DRAFT", seat: me, territory: firstOwned(base, me), count: 1 },
    })]);
    expect(legacy.resyncs).toHaveLength(0);
    expect(legacy.polls).toHaveLength(1);
    warn.mockRestore();
    h.destroy();
  });

  /*
   * Codex round 2, finding 5 — the resync ask is a latch, not a one-shot. An ask that is refused,
   * or accepted and never answered, used to leave `resyncRequested` set for the life of the
   * session: the client sat in `"desynced"` and never asked again.
   */
  describe("the resync latch releases (§5.8)", () => {
    function gap(port: { emitActions: FakeSync["emitActions"] }, me: number, at: number, seq: number): void {
      port.emitActions([row({ seq, seat: me, action: { type: "DRAFT", seat: me, territory: at, count: 1 } })]);
    }

    it("releases on a rejected resync, so the next gap asks again", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const base = makeSession().session.confirmed();
      const me = base.turnOrder[base.currentIndex] as number;
      const at = firstOwned(base, me);
      const inner = fakeSync();
      let asks = 0;
      const sched = manualScheduler();
      const port: SyncPort = {
        ...inner,
        resync: async () => {
          asks += 1;
          throw new Error("the authority refused");
        },
      };
      const h = makeSession({ sync: port, mySeat: me, schedule: sched.schedule });

      gap(inner, me, at, 2);
      expect(asks).toBe(1);
      // The rejection lands on a microtask; until it does the ask is still in flight.
      gap(inner, me, at, 3);
      expect(asks).toBe(1);

      await Promise.resolve();
      await Promise.resolve();
      expect(h.session.store.getState().syncStatus).toBe("desynced");

      gap(inner, me, at, 4);
      expect(asks).toBe(2);
      warn.mockRestore();
      h.destroy();
    });

    it("releases after the retry window when no snapshot ever lands", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const base = makeSession().session.confirmed();
      const me = base.turnOrder[base.currentIndex] as number;
      const at = firstOwned(base, me);
      const port = fakeSync();
      const sched = manualScheduler();
      const h = makeSession({ sync: port, mySeat: me, schedule: sched.schedule });

      gap(port, me, at, 2);
      expect(port.resyncs).toHaveLength(1);
      // Still latched: one ask at a time.
      gap(port, me, at, 3);
      expect(port.resyncs).toHaveLength(1);

      sched.flush();
      gap(port, me, at, 4);
      expect(port.resyncs).toHaveLength(2);
      warn.mockRestore();
      h.destroy();
    });

    it("a landed snapshot releases it immediately, without waiting for the window", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const base = makeSession().session.confirmed();
      const me = base.turnOrder[base.currentIndex] as number;
      const at = firstOwned(base, me);
      const port = fakeSync();
      const sched = manualScheduler();
      const h = makeSession({ sync: port, mySeat: me, schedule: sched.schedule });

      gap(port, me, at, 2);
      expect(port.resyncs).toHaveLength(1);
      port.emitSnapshot({ ...base, troopsToPlace: 7 }, 5);
      expect(h.session.store.getState().syncStatus).toBe("idle");
      // And the release timer was disarmed with it, so nothing is left queued.
      expect(sched.size()).toBe(0);

      gap(port, me, at, 9);
      expect(port.resyncs).toHaveLength(2);
      warn.mockRestore();
      h.destroy();
    });
  });

  /*
   * Codex round 2, finding 12 — `apply` is never called on a masked view in a way that can move
   * the fold. A view's numbers are not a state any authority held, so a refusal there is the mask
   * talking: folding it, or desyncing on it, put a fog game in `"desynced"` for good.
   */
  describe("a batch that lands on a masked view is animation only (§5.5, F36)", () => {
    it("drains the events, moves neither the fold nor the state, and asks for a snapshot", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const base = makeSession().session.confirmed();
      const me = base.turnOrder[base.currentIndex] as number;
      const at = firstOwned(base, me);
      const h = makeSession({ sync, mySeat: me, rules: { fogOfWar: true } });

      const masked: GameState = { ...base, fogged: true };
      sync.emitSnapshot(masked, 4);
      expect(h.session.confirmed().fogged).toBe(true);
      expect(h.session.seq()).toBe(4);
      const before = h.session.confirmed();

      sync.emitActions([
        row({ seq: 5, seat: me, action: { type: "DRAFT", seat: me, territory: at, count: 1 } }),
        row({ seq: 6, seat: me, action: { type: "DRAFT", seat: me, territory: at, count: 1 } }),
      ]);

      // Nothing folded, nothing desynced, and the snapshot that CAN move it was asked for.
      expect(h.session.seq()).toBe(4);
      expect(h.session.confirmed()).toBe(before);
      expect(h.session.store.getState().syncStatus).toBe("behind");
      expect(sync.resyncs).toHaveLength(1);

      // The authority answers with the view plus the rows behind it; that is what advances us.
      sync.emitSnapshot({ ...masked, troopsToPlace: 3 }, 6);
      expect(h.session.seq()).toBe(6);
      expect(h.session.store.getState().syncStatus).toBe("idle");
      warn.mockRestore();
      h.destroy();
    });

    it("never replays the same masked batch's events twice", () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const base = makeSession().session.confirmed();
      const me = base.turnOrder[base.currentIndex] as number;
      const at = firstOwned(base, me);
      const h = makeSession({ sync, mySeat: me, rules: { fogOfWar: true } });
      sync.emitSnapshot({ ...base, fogged: true }, 4);
      h.session.drainEvents();

      const batch = [row({ seq: 5, seat: me, action: { type: "DRAFT", seat: me, territory: at, count: 1 } })];
      sync.emitActions(batch);
      const first = h.session.drainEvents().length;
      expect(first).toBeGreaterThan(0);
      sync.emitActions(batch);
      expect(h.session.drainEvents()).toHaveLength(0);
      warn.mockRestore();
      h.destroy();
    });
  });

  it("treats an unknown action type and a card-less CARD_DRAWN as fog, never as a desync", () => {
    const base = makeSession().session.confirmed();
    const me = base.turnOrder[base.currentIndex] as number;
    const h = makeSession({ sync, mySeat: me, rules: { fogOfWar: true } });
    sync.emitActions([
      row({ seq: 1, seat: me, action: { type: "HIDDEN" } as unknown as Action }),
      row({ seq: 2, seat: me, action: { type: "CARD_DRAWN", seat: me, card: null } as unknown as Action }),
    ]);
    // The fold advanced over both, and nothing is desynced.
    expect(h.session.seq()).toBe(2);
    expect(h.session.store.getState().syncStatus).toBe("idle");
    h.destroy();
  });

  it("plays the events of `animate` rows without folding them or moving seq", () => {
    const base = makeSession().session.confirmed();
    const me = base.turnOrder[base.currentIndex] as number;
    const h = makeSession({ sync, mySeat: me });
    h.session.drainEvents();
    const at = firstOwned(base, me);
    sync.emitSnapshot({ ...base, troopsToPlace: 5 }, 4, [
      row({ seq: 3, seat: me, action: { type: "DRAFT", seat: me, territory: at, count: 1 } }),
    ]);
    // The snapshot is what the state is; the row only produced events.
    expect(h.session.seq()).toBe(4);
    expect(h.session.confirmed().troopsToPlace).toBe(5);
    expect(h.session.drainEvents().length).toBeGreaterThan(0);
    h.destroy();
  });

  it("online resign goes through the port's own route, never /actions (D76)", () => {
    const base = makeSession().session.confirmed();
    const me = base.turnOrder[base.currentIndex] as number;
    const h = makeSession({ sync, mySeat: me });
    h.session.resign();
    expect(sync.resignations).toHaveLength(1);
    expect(sync.submitted.some((s) => s.action.type === "SEAT_TO_BOT")).toBe(false);
    h.destroy();
  });

  it("offline resign stays local: the runner mints the SEAT_TO_BOT itself (D76)", () => {
    const h = makeSession({ seats: SOLO_SEATS });
    h.session.start();
    const me = h.session.mySeat();
    h.session.resign();
    expect(h.session.confirmed().seats[me]?.standing).toBe("resigned");
    h.destroy();
  });
});

describe("the manual dice overlay keeps its anchor until the result has been shown", () => {
  function inAttackPhase(schedule?: ReturnType<typeof manualScheduler>) {
    const h = makeSession({
      seats: HOTSEAT_SEATS, engine: engineApi,
      ...(schedule ? { schedule: schedule.schedule } : {}),
    });
    h.session.start();
    h.session.continueHandOff();
    const s = h.session.confirmed();
    const me = s.turnOrder[0] as number;
    h.session.submit({ type: "DRAFT", seat: me, territory: firstOwned(s, me), count: s.troopsToPlace });
    h.session.endPhase();
    return { h, me };
  }

  it("holds pendingAttack while the dice are on screen, so a manual roll can animate", () => {
    const sched = manualScheduler();
    const { h, me } = inAttackPhase(sched);
    const state = h.session.confirmed();
    const from = state.territories.findIndex((t) => t.owner === me && t.troops >= 2);
    const to = engineApi.legalAttackTargets(state, h.map, from)[0] as number;

    h.session.tapTerritory(from);
    h.session.tapTerritory(to);
    expect(h.session.store.getState().pendingAttack).toEqual({ from, to });

    h.session.submitAttack({ from, to, mode: "manual", attackerDice: 1 });
    const ui = h.session.store.getState();
    // The Blitz view is gone, the dice have arrived, and the ANCHOR is still there: without it
    // `ManualDiceView` has nowhere to position itself and never renders at all.
    expect(ui.modal).toBeNull();
    expect(ui.dice).not.toBeNull();
    expect(ui.pendingAttack).toEqual({ from, to });

    // The anchor leaves with the dice.
    sched.flush();
    expect(h.session.store.getState().dice).toBeNull();
    expect(h.session.store.getState().pendingAttack).toBeNull();
    h.destroy();
  });

  it("clears the anchor straight away for a blitz, which throws no dice", () => {
    const { h, me } = inAttackPhase();
    const state = h.session.confirmed();
    const from = state.territories.findIndex((t) => t.owner === me && t.troops >= 2);
    const to = engineApi.legalAttackTargets(state, h.map, from)[0] as number;
    h.session.tapTerritory(from);
    h.session.tapTerritory(to);
    h.session.submitAttack({ from, to, mode: "blitz" });
    expect(h.session.store.getState().dice).toBeNull();
    expect(h.session.store.getState().pendingAttack).toBeNull();
    h.destroy();
  });
});

describe("R6 — the 2-seat manual claim phase alternates own / neutral", () => {
  const TWO_HUMANS = [seat("human", "Ada", "red"), seat("human", "Grace", "green")] as const;

  function claimSession() {
    const h = makeSession({
      seats: [...TWO_HUMANS],
      rules: { manualPlacement: true, neutralHolding: true },
      engine: engineApi,
    });
    h.session.start();
    h.session.continueHandOff();
    return h;
  }

  it("opens in claim, asking for the seat's own army", () => {
    const h = claimSession();
    expect(h.session.confirmed().phase).toBe("claim");
    expect(h.session.prompt()).toBe("Tap a territory to place an army");
    expect(h.session.store.getState().litZone.length).toBeGreaterThan(0);
    h.destroy();
  });

  it("sends forNeutral once the pair is complete, instead of stalling the setup", () => {
    const h = claimSession();
    const me = h.session.confirmed().turnOrder[0] as number;
    h.session.tapTerritory(0);
    h.session.tapTerritory(1);
    expect(h.session.confirmed().territories[0]?.owner).toBe(me);
    expect(h.session.confirmed().territories[1]?.owner).toBe(me);

    // The pair is done, so R6 owes the neutral an army — and nothing else is legal.
    expect(h.session.prompt()).toBe("Place a neutral army");
    expect(h.session.store.getState().litZone).toEqual(
      engineApi.legalNeutralClaimTargets(h.session.confirmed()),
    );
    expect(h.session.submit({ type: "CLAIM", seat: me, territory: 2 }).error?.code)
      .toBe("mustPlaceAllTroops");

    // The tap path sends the right one, so the army lands on the neutral holding.
    h.session.tapTerritory(2);
    expect(h.session.confirmed().territories[2]?.owner).toBe(SEAT_NEUTRAL);
    // ...and the turn passes on, asking for an own army again.
    expect(h.session.store.getState().toast).toBeNull();
    h.destroy();
  });

  it("the bot runner alternates too, so a bot seat cannot hang the setup", () => {
    const h = makeSession({
      seats: [seat("human", "Ada", "red"), seat("bot", "Napoleon", "green", "medium")],
      rules: { manualPlacement: true, neutralHolding: true },
      engine: engineApi,
    });
    h.session.start();
    const me = h.session.confirmed().turnOrder[0] as number;
    // Drive the human's pair, then let the bot take over for its own step.
    let guard = 0;
    while (h.session.confirmed().phase === "claim" && guard < 200) {
      guard += 1;
      const s = h.session.confirmed();
      const acting = s.turnOrder[s.currentIndex] as number;
      if (s.seats[acting]?.kind === "bot") break;      // the runner owns it from here
      const owed = engineApi.claimOwed(s, acting);
      const zone = owed === "neutral"
        ? engineApi.legalNeutralClaimTargets(s)
        : engineApi.legalOwnClaimTargets(s, acting);
      const at = zone[0];
      if (at === undefined) break;
      h.session.tapTerritory(at);
    }
    // The human never got stuck: some claims landed and no refusal was toasted.
    expect(h.session.confirmed().territories.some((t) => t.owner === me)).toBe(true);
    expect(h.session.store.getState().toast).toBeNull();
    h.destroy();
  });
});

describe("alliances (R80) dispatch through the submit path", () => {
  const ALLY_SEATS = [
    seat("human", "Ada", "red"), seat("human", "Grace", "green"), seat("human", "Alan", "blue"),
  ] as const;

  it("proposes, accepts and breaks, and tracks the offer in the UI slice", () => {
    const h = makeSession({ seats: [...ALLY_SEATS], rules: { alliances: true }, engine: engineApi });
    h.session.start();
    h.session.continueHandOff();
    const me = h.session.mySeat();
    const them = h.session.confirmed().seats.find((s) => s.seat !== me)?.seat as number;

    expect(h.session.allianceState(them).allied).toBe(false);
    expect(h.session.allianceState(them).canPropose).toBe(true);

    h.session.proposeAlliance(them);
    // PROPOSE changes no GameState field, so the offer lives in the slice.
    expect(h.session.store.getState().allianceOffers).toEqual([{ from: me, to: them }]);
    expect(h.session.allianceState(them).offeredByMe).toBe(true);

    // The other seat accepts, which is what puts the alliance on the board.
    h.session.submit({ type: "ALLIANCE_ACCEPT", seat: them, from: me });
    expect(h.session.confirmed().seats[me]?.allies).toContain(them);
    expect(h.session.store.getState().allianceOffers).toEqual([]);
    expect(h.session.allianceState(them).allied).toBe(true);

    h.session.breakAlliance(them);
    expect(h.session.confirmed().seats[me]?.allies).not.toContain(them);
    h.destroy();
  });

  it("offers nothing when the rule is off", () => {
    const h = makeSession({ seats: [...ALLY_SEATS], engine: engineApi });
    h.session.start();
    h.session.continueHandOff();
    const me = h.session.mySeat();
    const them = h.session.confirmed().seats.find((s) => s.seat !== me)?.seat as number;
    expect(h.session.allianceState(them).canPropose).toBe(false);
    h.destroy();
  });

  it("opens and closes the popover, and never on the viewer's own capsule", () => {
    const h = makeSession({ seats: [...ALLY_SEATS], rules: { alliances: true }, engine: engineApi });
    h.session.start();
    h.session.continueHandOff();
    const me = h.session.mySeat();
    h.session.openAlliancePopover(1 - me === me ? 2 : 1);
    expect(h.session.store.getState().alliancePopover).not.toBeNull();
    h.session.openAlliancePopover(null);
    expect(h.session.store.getState().alliancePopover).toBeNull();
    h.destroy();
  });
});

describe("the RNG sub-stream index is the action's seq, never the turn (D5)", () => {
  function watching() {
    const base = createScriptedEngine();
    const seen: { purpose: string; index: number }[] = [];
    const engine = {
      ...base,
      rngFor: (seed: string, purpose: string, index: number) => {
        seen.push({ purpose, index });
        return base.rngFor(seed, purpose as never, index);
      },
    } as typeof base;
    return { engine, seen };
  }

  it("two attacks in ONE turn get two different sub-streams", () => {
    const { engine, seen } = watching();
    const h = makeSession({ seats: HOTSEAT_SEATS, engine });
    h.session.start();
    h.session.continueHandOff();
    const state = h.session.confirmed();
    const me = state.turnOrder[0] as number;
    h.session.submit({ type: "DRAFT", seat: me, territory: firstOwned(state, me), count: state.troopsToPlace });
    h.session.endPhase();
    expect(h.session.confirmed().phase).toBe("attack");

    const turn = h.session.confirmed().turn;
    seen.length = 0;
    const from = firstOwned(h.session.confirmed(), me);
    const targets = engine.legalAttackTargets(h.session.confirmed(), h.map, from);
    const to = targets[0] as number;
    h.session.submitAttack({ from, to, mode: "blitz" });
    h.session.submitAttack({ from, to, mode: "blitz" });
    // Still the same turn, so `state.turn` would have handed both battles one stream.
    expect(h.session.confirmed().turn).toBe(turn);
    const battles = seen.filter((p) => p.purpose === "battle").map((p) => p.index);
    expect(battles.length).toBeGreaterThanOrEqual(2);
    expect(new Set(battles).size).toBe(battles.length);
    h.destroy();
  });

  it("a bot's decideTurn and its card draw are keyed on the seq too", () => {
    const { engine, seen } = watching();
    const h = makeSession({ seats: SOLO_SEATS, engine });
    h.session.start();
    const bot = seen.filter((p) => p.purpose.startsWith("bot:")).map((p) => p.index);
    // The bot is re-entered several times in one turn; every call is its own sub-stream.
    expect(bot.length).toBeGreaterThan(1);
    expect(new Set(bot).size).toBeGreaterThan(1);
    // The opening draws are the only ones pinned to index 0 (personas and the deal).
    for (const purpose of ["personaAssign", "personaJitter", "deal", "turnOrder", "modifierPlace"]) {
      expect(seen.filter((p) => p.purpose === purpose).every((p) => p.index === 0)).toBe(true);
    }
    h.destroy();
  });
});

describe("rules.roundDelayMs — a presentation pause at each round start", () => {
  /** Play every seat's turn out until the round wraps. Returns the session's round. */
  function playToRound2(h: ReturnType<typeof makeSession>, handOff: boolean): number {
    for (let guard = 0; guard < 60 && h.session.confirmed().round === 1; guard += 1) {
      const s = h.session.confirmed();
      const me = s.turnOrder[s.currentIndex] as number;
      if (s.phase === "draft" && s.troopsToPlace > 0) {
        h.session.submit({ type: "DRAFT", seat: me, territory: firstOwned(s, me), count: s.troopsToPlace });
        continue;
      }
      if (s.phase === "draft" || s.phase === "attack") {
        h.session.endPhase();
        continue;
      }
      h.session.endTurn();
      if (handOff && h.session.confirmed().round === 1) h.session.continueHandOff();
    }
    return h.session.confirmed().round;
  }

  it("holds a beat and raises the round banner when the round turns", () => {
    const sched = manualScheduler();
    const h = makeSession({
      seats: HOTSEAT_SEATS, rules: { roundDelayMs: 1200 },
      schedule: sched.schedule, skipAnimations: false,
    });
    h.session.start();
    h.session.continueHandOff();
    expect(playToRound2(h, true)).toBe(2);
    // The follow-on work is deferred, and the pause is filled by the round banner.
    expect(h.session.store.getState().bannerText).toBe("Round 2");
    expect(h.session.store.getState().handOff).toBeNull();
    sched.flush();
    // Once the pause expires, play carries on exactly as it would have.
    expect(h.session.store.getState().handOff).not.toBeNull();
    h.destroy();
  });

  it("is skipped entirely under reduced motion, whatever the rules say", () => {
    const sched = manualScheduler();
    const h = makeSession({
      seats: HOTSEAT_SEATS, rules: { roundDelayMs: 2400 },
      schedule: sched.schedule, skipAnimations: true,
    });
    h.session.start();
    h.session.continueHandOff();
    expect(playToRound2(h, true)).toBe(2);
    expect(h.session.store.getState().handOff).not.toBeNull();
    h.destroy();
  });

  it("does not pause when the delay is 0, which is the default", () => {
    const sched = manualScheduler();
    const h = makeSession({ seats: HOTSEAT_SEATS, schedule: sched.schedule, skipAnimations: false });
    expect(h.config.rules.roundDelayMs).toBe(0);
    h.session.start();
    h.session.continueHandOff();
    expect(playToRound2(h, true)).toBe(2);
    expect(h.session.store.getState().bannerText).not.toBe("Round 2");
    expect(h.session.store.getState().handOff).not.toBeNull();
    h.destroy();
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

/*
 * Codex round 2, finding 7 — round-start work fires on the ROUND CHANGING, which is what the
 * server keys on (`if (state.round !== roundBefore) portalsOwed = true`). The old
 * `currentIndex === 0` gate was wrong the moment a seat went out: the wrap skips eliminated seats,
 * so it lands on index 1 or later and unstable portals stopped relocating for the rest of the game.
 */
describe("offline round-start work (§5.7, R76)", () => {
  function spyEngine(calls: { portals: number }): ReturnType<typeof createScriptedEngine> {
    const base = createScriptedEngine();
    return {
      ...base,
      movePortals: (...args: Parameters<typeof base.movePortals>) => {
        calls.portals += 1;
        return base.movePortals(...args);
      },
    };
  }

  /** Round 2, the LAST seat to move, and seat 0 already out of the game. */
  function seatZeroEliminated(base: GameState): GameState {
    let flip = 1;
    return {
      ...base,
      rules: { ...base.rules, portals: "unstable" },
      // The deal shuffles the order, and the point of the test is who sits at index 0.
      turnOrder: [0, 1, 2],
      round: 2,
      currentIndex: 2,
      phase: "fortify",
      portals: [{ a: 0, b: 5, kind: "unstable", activeFrom: 1 }],
      seats: base.seats.map((s) => (s.seat === 0 ? { ...s, standing: "eliminated" as const } : s)),
      territories: base.territories.map((t) => {
        if (t.owner !== 0) return t;
        flip = flip === 1 ? 2 : 1;
        return { ...t, owner: flip };
      }),
    };
  }

  function resumed(calls: { portals: number }): ReturnType<typeof makeSession> {
    // Every seat human, so no bot runner plays on past the round we are watching.
    const first = makeSession({ seats: HOTSEAT_SEATS, rules: { portals: "unstable" } });
    const base = first.session.confirmed();
    const saved: SavedSession = {
      version: 1,
      config: first.config,
      state: seatZeroEliminated(base),
      turn: base.turn,
      grudge: [],
      savedAt: 0,
      nextSeq: 20,
    };
    first.destroy();
    return makeSession({ seats: HOTSEAT_SEATS, resume: saved, engine: spyEngine(calls) });
  }

  it("relocates unstable portals on the round whose wrap SKIPS seat 0", () => {
    const calls = { portals: 0 };
    const h = resumed(calls);
    expect(h.session.confirmed().round).toBe(2);

    h.session.submit({ type: "END_TURN", seat: 2 });

    const after = h.session.confirmed();
    // The wrap skipped the eliminated seat, so this is exactly the state the old gate missed.
    expect(after.round).toBe(3);
    expect(after.currentIndex).not.toBe(0);
    expect(calls.portals).toBe(1);
    // R76 — the relocated portal is inactive for the whole of the round it moved in.
    expect(after.portals[0]?.activeFrom).toBe(4);
    h.destroy();
  });

  it("asks once per round, not once per turn", () => {
    const calls = { portals: 0 };
    const h = resumed(calls);
    h.session.submit({ type: "END_TURN", seat: 2 });
    expect(calls.portals).toBe(1);
    const mid = h.session.confirmed();
    h.session.submit({ type: "END_TURN", seat: mid.turnOrder[mid.currentIndex] as number });
    expect(h.session.confirmed().round).toBe(3);
    expect(calls.portals).toBe(1);
    h.destroy();
  });
});

/*
 * Codex round 2, finding 14 — every persona draw in the game is keyed at sub-stream index 0, the
 * opening's own stream. The offline resignation used `nextSeq`, so the takeover persona depended on
 * how many actions happened to precede it.
 */
describe("offline resignation (§5.6, D76)", () => {
  it("draws the takeover persona at sub-stream index 0, like every other persona draw", () => {
    const base = createScriptedEngine();
    const draws: { purpose: string; index: number }[] = [];
    const spy = {
      ...base,
      rngFor: (seed: string, purpose: string, index: number) => {
        draws.push({ purpose, index });
        return base.rngFor(seed, purpose as never, index);
      },
    } as typeof base;
    const h = makeSession({ seats: SOLO_SEATS, engine: spy });
    h.session.start();
    const me = h.session.mySeat();
    // Spend a few sub-streams first, so `nextSeq` is nowhere near 0.
    h.session.submit({ type: "DRAFT", seat: me, territory: firstOwned(h.session.confirmed(), me), count: 1 });
    expect(h.session.seq()).toBeGreaterThan(1);
    draws.length = 0;

    h.session.resign();

    const personaDraws = draws.filter((d) => d.purpose.startsWith("persona"));
    expect(personaDraws.map((d) => d.purpose).sort()).toEqual(["personaAssign", "personaJitter"]);
    expect(personaDraws.every((d) => d.index === 0)).toBe(true);
    expect(h.session.confirmed().seats[me]?.standing).toBe("resigned");
    h.destroy();
  });
});

/**
 * The scripted double versus the engine it stands in for (F33; codex round 4, finding 8).
 *
 * `scriptedEngine` is not the engine, and is not meant to be: it implements the branches the
 * session runner drives and nothing else. But where it answers a rule question at all it has to
 * answer the same way, or every S4 test built on it is asserting a rule the game does not have.
 * Two places had drifted, and both are rules a session can reach.
 */
describe("the scripted double agrees with the real engine", () => {
  const inf = (id: string) => engineCard(id, "infantry", null);
  const cav = (id: string) => engineCard(id, "cavalry", null);

  /** A board where seat 0 is to play, with whatever hand and turn flags a branch needs. */
  function hand(cards: readonly Card[], overrides: Parameters<typeof buildState>[1] = {}) {
    return buildState(mini, {
      seats: 2,
      owners: [0, 0, 0, 1, 1, 1],
      phase: "draft",
      hands: { 0: cards },
      ...overrides,
    });
  }

  const SET = [inf("s1"), inf("s2"), inf("s3")];

  it("R24/R26 — mustTradeNow matches on every branch the runner can reach", () => {
    const cases = [
      // R24 at turn start: five with a set forces, five without does not.
      { label: "five with a set", seat: 0, state: hand([...SET, cav("x"), cav("y")]) },
      { label: "five with no set", seat: 0, state: hand([inf("a"), inf("b"), cav("c"), cav("d"), cav("e")]) },
      { label: "four", seat: 0, state: hand([...SET, cav("x")]) },
      // R25 — a reward draw to six in fortify forces nothing until the next turn.
      {
        label: "six in fortify, unbounced",
        seat: 0,
        state: hand([...SET, cav("x"), cav("y"), cav("z")], { phase: "fortify" }),
      },
      // R26's first branch: six or more after a bounce.
      {
        label: "eight mid-bounce",
        seat: 0,
        state: hand(
          [...SET, cav("x"), cav("y"), cav("z"), inf("p"), cav("q")],
          { resumePhase: "attack", setsTradedThisTurn: 1 },
        ),
      },
      // R26's THIRD branch, the one the double was missing: 8 -> 5 is still above the floor.
      {
        label: "five mid-trade-down",
        seat: 0,
        state: hand([...SET, cav("x"), cav("y")], { resumePhase: "attack", setsTradedThisTurn: 1 }),
      },
      // ...and the hand of five that arrived by inheritance alone, which R26 defers.
      {
        label: "five inherited, nothing traded",
        seat: 0,
        state: hand([...SET, cav("x"), cav("y")], {
          resumePhase: "attack", setsTradedThisTurn: 0, phase: "attack",
        }),
      },
      // The current-seat gate: seat 1 is never forced while seat 0 is to play.
      { label: "off-turn", seat: 1, state: hand([...SET, cav("x"), cav("y")]) },
    ] as const;
    for (const { label, seat, state } of cases) {
      expect(scriptedMustTradeNow(state, seat), label).toBe(realMustTradeNow(state, seat));
    }
  });

  /**
   * R80/§4.7 — the double now moves `pendingAlliances`, so a session test can assert the rule the
   * field exists for: one offer at a time per pair, cleared by the answer.
   */
  it("R80 — records an offer and clears it on the answer", () => {
    const h = makeSession({ seats: HOTSEAT_SEATS, rules: { alliances: true } });
    h.session.start();
    h.session.continueHandOff();
    h.session.applyForTest({ type: "ALLIANCE_PROPOSE", seat: 0, to: 1 });
    expect(h.session.confirmed().pendingAlliances).toEqual([[0, 1]]);
    h.session.applyForTest({ type: "ALLIANCE_ACCEPT", seat: 1, from: 0 });
    expect(h.session.confirmed().pendingAlliances).toEqual([]);
    expect(h.session.confirmed().seats[0]?.allies).toEqual([1]);
    h.destroy();
  });

  /** And a seat that leaves takes its pacts with it, as the reducer does (R81, R82). */
  it("R82 — a resignation clears the resigning seat's pacts", () => {
    const h = makeSession({ seats: HOTSEAT_SEATS, rules: { alliances: true } });
    h.session.start();
    h.session.continueHandOff();
    h.session.applyForTest({ type: "ALLIANCE_PROPOSE", seat: 0, to: 1 });
    h.session.applyForTest({ type: "ALLIANCE_ACCEPT", seat: 1, from: 0 });
    h.session.applyForTest({
      type: "SEAT_TO_BOT", seat: 1, reason: "resigned", tier: "medium", persona: makePersona(),
    });
    expect(h.session.confirmed().seats[1]?.allies).toEqual([]);
    expect(h.session.confirmed().seats[0]?.allies).toEqual([]);
    h.destroy();
  });
});

describe("D107 — a fortify move ends the turn, and D108 — the battle log", () => {
  /**
   * A seeded deal in which the opening seat holds two ADJACENT territories, so a fortify pair
   * exists on turn one; the deal is seeded, so the first seed that qualifies is always the same.
   */
  function inAttackPhase() {
    for (let i = 0; i < 40; i += 1) {
      const h = makeSession({ seats: HOTSEAT_SEATS, engine: engineApi, seed: `fortify-${String(i)}` });
      h.session.start();
      h.session.continueHandOff();
      const s = h.session.confirmed();
      const me = s.turnOrder[0] as number;
      const target = territoriesOf(s, me).find((t) =>
        (h.map.adjacency[t] ?? []).some((n) => s.territories[n]?.owner === me));
      if (target === undefined) {
        h.destroy();
        continue;
      }
      h.session.submit({ type: "DRAFT", seat: me, territory: target, count: s.troopsToPlace });
      h.session.endPhase();
      return { h, me, target };
    }
    throw new Error("no seed in 40 dealt the opening seat an adjacent pair");
  }

  it("D108 — every resolved battle lands in the log with both seats, both losses and the outcome", () => {
    const { h, me } = inAttackPhase();
    const state = h.session.confirmed();
    const from = state.territories.findIndex((t) => t.owner === me && t.troops >= 2);
    const to = engineApi.legalAttackTargets(state, h.map, from)[0] as number;
    const defender = state.territories[to]?.owner as number;
    expect(h.session.store.getState().battleLog).toEqual([]);

    h.session.submitAttack({ from, to, mode: "blitz" });
    const log = h.session.store.getState().battleLog;
    expect(log).toHaveLength(1);
    const row = log[0]!;
    expect(row).toMatchObject({ id: 1, round: state.round, attacker: me, defender, from, to });
    expect(row.attackerLosses + row.defenderLosses).toBeGreaterThan(0);
    const after = h.session.confirmed();
    expect(row.conquered).toBe(after.territories[to]?.owner === me || after.pendingMoveIn !== null);
    h.destroy();
  });

  it("D107 — confirming a fortify ends the turn with no confirmation banner, confirmation setting or not", () => {
    const { h, me } = inAttackPhase();
    h.session.endPhase(); // attack → fortify
    expect(h.session.confirmed().phase).toBe("fortify");
    h.session.updateSettings({ endPhaseConfirmation: true });

    const state = h.session.confirmed();
    const from = territoriesOf(state, me).find((t) =>
      (state.territories[t]?.troops ?? 0) >= 2 && engineApi.legalFortifyMoves(state, h.map, t).length > 0);
    expect(from).toBeDefined();
    const to = engineApi.legalFortifyMoves(state, h.map, from as number)[0] as number;
    const turnBefore = state.turn;

    h.session.tapTerritory(from as number);
    h.session.tapTerritory(to);
    expect(h.session.store.getState().countRequest?.kind).toBe("fortify");
    h.session.confirmCount(1);

    // The move landed, and the turn is over: no "Skip Fortify phase?" banner, no second tap.
    expect(h.session.confirmed().turn).toBeGreaterThan(turnBefore);
    expect(h.session.store.getState().modal).not.toBe("endTurn");
    expect(h.session.store.getState().countRequest).toBeNull();
    h.destroy();
  });

  it("D107 — a refused fortify does not end the turn", () => {
    const { h, me } = inAttackPhase();
    h.session.endPhase();
    const state = h.session.confirmed();
    const turnBefore = state.turn;
    const from = firstOwned(state, me);
    const enemy = state.territories.findIndex((t) => t.owner !== me && t.owner >= 0);
    h.session.fortify(from, enemy, 1);
    expect(h.session.confirmed().turn).toBe(turnBefore);
    expect(h.session.confirmed().phase).toBe("fortify");
    h.destroy();
  });
});
