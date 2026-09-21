import { describe, expect, it } from "vitest";
import { apply } from "./reducer";
import { END, at, fullRound, move, provinceOf, run, stateFrom, tile } from "./testing/fixtures";

const three = {
  terrain: ["~~~~~~~~~~", "~........~", "~........~", "~........~", "~~~~~~~~~~", "~~~~~~~~~~"],
  owners: ["..........", ".00.11.22.", ".00.11.22.", "..........", "..........", ".........."],
  objects: ["..........", ".C1.C1.C1.", "..........", "..........", "..........", ".........."],
};

describe("turn sequence (SPEC §3.8)", () => {
  it("only seat 0's units are ready at the start; END_TURN spends readiness and readies the next seat", () => {
    const s = stateFrom(three);
    expect(tile(s, 2, 1).unit?.readyToMove).toBe(true);
    expect(tile(s, 5, 1).unit?.readyToMove).toBe(false);
    expect(s.turnStart).not.toBeNull();
    const r = apply(s, END);
    expect(r.events[0]).toEqual({ type: "turnEnded", player: 0 });
    expect(r.events).toContainEqual({ type: "turnStarted", player: 1, turnNumber: 0 });
    expect(r.state.activePlayerIndex).toBe(1);
    expect(tile(r.state, 2, 1).unit?.readyToMove).toBe(false);
    expect(tile(r.state, 5, 1).unit?.readyToMove).toBe(true);
    expect(r.state.history).toEqual([]);
    expect(r.state.turnStart).toEqual({ ...r.state, history: undefined, turnStart: undefined });
  });

  it("increments turnNumber when the seat order wraps and skips eliminated seats", () => {
    let s = stateFrom(three);
    s = run(s, END, END);
    expect(s.activePlayerIndex).toBe(2);
    expect(s.turnNumber).toBe(0);
    s = run(s, END);
    expect(s.activePlayerIndex).toBe(0);
    expect(s.turnNumber).toBe(1);
    // Eliminate red (seat 1) by hand-crafting: blue L2 takes red's city.
    const cut = stateFrom({ ...three, objects: ["..........", ".C.2C..C..", "..........", "..........", "..........", ".........."], owners: ["..........", ".00011.2..", ".000...2..", "..........", "..........", ".........."] });
    const killed = run(cut, move(at(3, 1), at(4, 1)));
    expect(killed.players[1]?.eliminated).toBe(true);
    expect(killed.outcome).toBeNull();
    const afterEnd = run(killed, END);
    expect(afterEnd.activePlayerIndex).toBe(2);
  });

  it("skips income, bankruptcy, starvation and grave aging on day 1 (D36)", () => {
    const s = stateFrom({
      ...three,
      terrain: ["~~~~~~~~~~", "~........~", "~........~", "~........~", "~~~~~~~~~~", "~~~~~~~~~~"],
      owners: ["..........", ".00.11.22.", ".00.11.22.", ".0........", "..........", ".........."],
      objects: ["..........", ".C1.C1.C1.", ".4........", "..........", "..........", ".........."],
      startGold: 0,
    });
    const g = { ...s };
    void g;
    // Blue: income 5, upkeep 32 — bankrupt on any real turn start. Day 1: nothing happens for anyone.
    const round = run(s, END, END);
    expect(round.turnNumber).toBe(0);
    expect(tile(round, 1, 2).unit).toEqual({ level: 4, readyToMove: false });
    const day2 = run(round, END);
    expect(day2.turnNumber).toBe(1);
    expect(tile(day2, 1, 2).unit).toBeNull();
    expect(tile(day2, 1, 2).terrain).toBe("grave");
  });

  it("graves age at their owner's turn starts and become fields after two", () => {
    const s = stateFrom({
      ...three,
      terrain: ["~~~~~~~~~~", "~........~", "~g.......~", "~~~~~~~~~~", "~~~~~~~~~~", "~~~~~~~~~~"],
      owners: ["..........", ".00.11.22.", ".00.11.22.", "..........", "..........", ".........."],
      objects: ["..........", ".C1.C1.C1.", "..........", "..........", "..........", ".........."],
    });
    expect(tile(s, 1, 2)).toMatchObject({ terrain: "grave", graveAge: 0 });
    const one = fullRound(s); // blue's second turn start: age 1
    expect(tile(one, 1, 2)).toMatchObject({ terrain: "grave", graveAge: 1 });
    const two = fullRound(one);
    expect(tile(two, 1, 2)).toMatchObject({ terrain: "grassField", graveAge: 0 });
    const events = apply(run(one, END, END), END).events;
    expect(events).toContainEqual({ type: "graveAged", at: at(1, 2), nowField: true });
    // Red's turn starts never touch blue's grave.
    expect(tile(run(s, END), 1, 2).graveAge).toBe(0);
  });

  it("a bankruptcy grave does not age in the turn start that created it", () => {
    const s = stateFrom({
      ...three,
      owners: ["..........", ".00.11.22.", ".00.11.22.", "..........", "..........", ".........."],
      objects: ["..........", ".C4.C1.C1.", "..........", "..........", "..........", ".........."],
      startGold: 0,
    });
    const broke = fullRound(s);
    expect(tile(broke, 2, 1)).toMatchObject({ terrain: "grave", graveAge: 0 });
    const aged = fullRound(broke);
    expect(tile(aged, 2, 1)).toMatchObject({ terrain: "grave", graveAge: 1 });
    expect(tile(fullRound(aged), 2, 1).terrain).toBe("grassField");
  });

  it("income is banked before upkeep, in city order, with the snapshot taken after the pipeline", () => {
    const s = stateFrom({ ...three, startGold: 3 });
    const r = apply(run(s, END, END), END);
    expect(r.state.turnNumber).toBe(1);
    expect(provinceOf(r.state, 1, 1).gold).toBe(3 + 4 - 2);
    expect(r.state.turnStart?.provinces["p0-1-1"]?.gold).toBe(5);
    expect(r.state.turnStart?.tiles[1 * 10 + 2]?.unit?.readyToMove).toBe(true);
  });
});
