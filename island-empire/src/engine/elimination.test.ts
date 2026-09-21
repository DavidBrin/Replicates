import { describe, expect, it } from "vitest";
import { apply } from "./reducer";
import { END, UNDO, at, buy, move, run, stateFrom, tile } from "./testing/fixtures";

describe("elimination and win (SPEC §3.7, D36)", () => {
  const duel = {
    terrain: ["~~~~~~~~", "~......~", "~......~", "~......~", "~~~~~~~~", "~~~~~~~~"],
    owners: ["........", ".00011..", ".000....", "........", "........", "........"],
    objects: ["........", ".C.2C...", "........", "........", "........", "........"],
  };

  it("capturing the last enemy city eliminates the player and ends the game mid-turn", () => {
    const s = stateFrom(duel);
    const r = apply(s, move(at(3, 1), at(4, 1)));
    expect(r.error).toBeUndefined();
    expect(r.state.players[1]?.eliminated).toBe(true);
    expect(tile(r.state, 5, 1)).toMatchObject({ owner: 1, provinceId: null }); // the survivor is a lone tile
    expect(r.state.outcome).toEqual({ winner: 0 });
    const types = r.events.map((e) => e.type);
    expect(types.indexOf("eliminated")).toBeLessThan(types.indexOf("gameOver"));
    expect(r.events).toContainEqual({ type: "eliminated", player: 1 });
    expect(r.events).toContainEqual({ type: "gameOver", winner: 0 });
    // Red's remaining tiles are lone tiles / a city-less fragment — it owns no province.
    expect(Object.values(r.state.provinces).some((p) => p.owner === 1)).toBe(false);
  });

  it("rejects every action once the outcome is set", () => {
    const over = run(stateFrom(duel), move(at(3, 1), at(4, 1)));
    for (const action of [END, UNDO, move(at(4, 1), at(5, 1)), buy("knight1", at(2, 1))]) {
      const r = apply(over, action);
      expect(r.error).toBe("game over");
      expect(r.state).toBe(over);
      expect(r.events).toEqual([]);
    }
  });

  it("with three players the game continues after one elimination", () => {
    const s = stateFrom({
      terrain: ["~~~~~~~~~~", "~........~", "~........~", "~........~", "~~~~~~~~~~", "~~~~~~~~~~"],
      owners: ["..........", ".00011.2..", ".000...2..", "..........", "..........", ".........."],
      objects: ["..........", ".C.2C..C..", "..........", "..........", "..........", ".........."],
    });
    const r = run(s, move(at(3, 1), at(4, 1)));
    expect(r.players.map((p) => p.eliminated)).toEqual([false, true, false]);
    expect(r.outcome).toBeNull();
    const next = run(r, END);
    expect(next.activePlayerIndex).toBe(2);
  });

  it("capturing a big province's city only relocates its capital (SPEC §3.3 step 1) — no elimination", () => {
    const s = stateFrom({
      terrain: ["~~~~~~~~", "~......~", "~......~", "~......~", "~~~~~~~~", "~~~~~~~~"],
      owners: ["........", ".000111.", ".000111.", "........", "........", "........"],
      objects: ["........", ".C.2C...", "........", "........", "........", "........"],
    });
    const r = apply(s, move(at(3, 1), at(4, 1)));
    expect(r.events).toContainEqual({ type: "cityDestroyed", provinceId: "p1-4-1", owner: 1, at: at(4, 1) });
    expect(r.state.players[1]?.eliminated).toBe(false);
    const red = Object.values(r.state.provinces).filter((p) => p.owner === 1);
    expect(red).toHaveLength(1);
    expect(red[0]?.gold).toBe(0);
    expect(red[0]?.tileKeys).toHaveLength(5);
    expect(tile(r.state, red[0]?.city.x ?? 0, red[0]?.city.y ?? 0).building).toBe("city");
  });

  it("a player keeps playing while any province with a city remains", () => {
    const s = stateFrom({
      terrain: ["~~~~~~~~~~", "~........~", "~........~", "~........~", "~~~~~~~~~~", "~~~~~~~~~~"],
      owners: ["..........", ".000111...", ".000...11.", "..........", "..........", ".........."],
      objects: ["..........", ".C.2C.....", ".......C..", "..........", "..........", ".........."],
    });
    const r = run(s, move(at(3, 1), at(4, 1)));
    expect(r.players[1]?.eliminated).toBe(false);
    expect(r.outcome).toBeNull();
  });
});
