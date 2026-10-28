import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { fx } from "../fixed";
import {
  ATTACK,
  atkPower,
  clear,
  clearAll,
  decimalRatio,
  frame,
  loop,
  momentum,
  motionRate,
  script,
  setFlag,
  spawnProjectile,
  superArmour,
  wait,
} from "./dsl";
import { runScript } from "./interpreter";
import type { AcmdCommand } from "./types";

const hit = (id: number, damage = 1) =>
  ATTACK({ id, bone: "top", damage, angle: 45, kbg: 100, bkb: 30, size: 2, x: 0, y: 5, z: 4 });

/** Game frames, from 1 to `upTo`, on which attack `id` is live. */
function liveFrames(commands: readonly AcmdCommand[], id: number, upTo = 40): number[] {
  const s = script("game_test", "test", commands);
  const out: number[] = [];
  for (let g = 1; g <= upTo; g++) if (runScript(s, g).attacks.some((a) => a.id === id)) out.push(g);
  return out;
}

describe("frame and wait at the default rate", () => {
  it("opens a hitbox on frame n and closes it n frames after a wait", () => {
    // Mario's jab: frame(2) ATTACK … wait(2) clear_all — active 2–3, as UFD quotes it.
    expect(liveFrames([frame(2), hit(0), wait(2), clearAll()], 0)).toEqual([2, 3]);
  });

  it("runs commands before any frame() on game frame 1", () => {
    expect(liveFrames([hit(0), wait(3), clearAll()], 0)).toEqual([1, 2, 3]);
  });

  it("clears one slot and leaves the others", () => {
    const cmds = [frame(3), hit(0), hit(1), frame(5), clear(0), frame(7), clearAll()];
    expect(liveFrames(cmds, 0)).toEqual([3, 4]);
    expect(liveFrames(cmds, 1)).toEqual([3, 4, 5, 6]);
  });

  it("unrolls a loop: Mario's down air drill hits on 5, 7, 9, 11 and 13", () => {
    // https://rubendal.github.io/ssbu/data/patch/13.0.1/character/Mario/data.json, game_AttackAirLw
    const cmds = [frame(5), loop(5, [hit(0), wait(1), clearAll(), wait(1)]), frame(23), hit(5), wait(1), clearAll()];
    expect(liveFrames(cmds, 0)).toEqual([5, 7, 9, 11, 13]);
    expect(liveFrames(cmds, 5)).toEqual([23]);
  });

  it("treats a frame() already passed as no wait at all", () => {
    expect(liveFrames([frame(6), hit(0), frame(4), clear(0), wait(1), clearAll()], 0)).toEqual([]);
  });
});

describe("FT_MOTION_RATE", () => {
  it("speeds the script up below 1", () => {
    // Two motion frames per game frame: motion 1, 3, 5 … so frame(5) is game frame 3.
    expect(liveFrames([motionRate(0.5), frame(5), hit(0), wait(4), clearAll()], 0)).toEqual([3, 4]);
  });

  it("slows it down above 1", () => {
    expect(liveFrames([motionRate(2), frame(3), hit(0), wait(1), clearAll()], 0)).toEqual([5, 6]);
  });

  it("reaches frame(11) on game frame 10 at FSM 0.9, exactly (Review Focus #3)", () => {
    // 1 + 9 × (10 / 9) = 11. Q12's 1.111084 per frame would reach 10.99976 and fire a frame late.
    expect(liveFrames([motionRate(0.9), frame(11), hit(0), wait(1), clearAll()], 0)[0]).toBe(10);
  });

  it("reaches frame(4) on game frame 2 at three motion frames per game frame", () => {
    expect(liveFrames([motionRate([1, 3]), frame(4), hit(0)], 0)[0]).toBe(2);
  });

  it("changes rate mid-script from the motion frame it is on", () => {
    // Rate 1 to frame 3 (game 3), then 0.5: motion 3, 5, 7 → frame(7) on game 5.
    expect(liveFrames([frame(3), motionRate(0.5), frame(7), hit(0)], 0)[0]).toBe(5);
  });

  it("reports the floored motion frame for the bone table", () => {
    const s = script("game_test", "test", [motionRate(2)]);
    expect([1, 2, 3, 4, 5].map((g) => runScript(s, g).motionFrame)).toEqual([1, 1, 2, 2, 3]);
  });

  it("spells decimals as exact fractions and refuses a rate that is not one", () => {
    expect(decimalRatio(0.91)).toEqual([91, 100]);
    expect(decimalRatio(1.25)).toEqual([5, 4]);
    expect(decimalRatio(2)).toEqual([2, 1]);
    expect(() => motionRate(Number.NaN)).toThrow(/positive rate/);
    expect(() => motionRate(0)).toThrow(/positive rate/);
  });
});

describe("one-shot and stateful commands", () => {
  const s = script("game_test", "test", [
    frame(4),
    spawnProjectile("fireball"),
    superArmour(true),
    setFlag("FIGHTER_STATUS_ATTACK_AIR_FLAG_ENABLE_LANDING"),
    hit(0, 8),
    frame(6),
    atkPower(0, 5),
    frame(9),
    superArmour(false),
    clearAll(),
  ]);

  it("fires a spawn on exactly one frame", () => {
    const frames = [1, 2, 3, 4, 5, 6, 7].filter((g) => runScript(s, g).fired.some((c) => c.op === "spawnProjectile"));
    expect(frames).toEqual([4]);
  });

  it("holds super armour between its on and off", () => {
    expect([3, 4, 8, 9].map((g) => runScript(s, g).superArmour)).toEqual([false, true, true, false]);
  });

  it("keeps a flag once set", () => {
    expect(runScript(s, 3).flags).toEqual([]);
    expect(runScript(s, 12).flags).toEqual(["FIGHTER_STATUS_ATTACK_AIR_FLAG_ENABLE_LANDING"]);
  });

  it("changes a live hitbox's damage with ATK_POWER and keeps the slot", () => {
    expect(runScript(s, 5).attacks[0].damage).toBe(fx(8));
    expect(runScript(s, 6).attacks[0].damage).toBe(fx(5));
  });
});

describe("momentum windows", () => {
  const s = script("game_test", "test", [frame(3), momentum(1, 2, 4, 0), frame(5), momentum(9, 9, 0, 1)]);

  it("is live from its frame through its hold", () => {
    expect([2, 3, 7, 8].map((g) => runScript(s, g).momentum?.until ?? null)).toEqual([null, 7, 7, null]);
  });

  it("lets the lower-order entry win where two overlap, as the legacy list did", () => {
    expect(runScript(s, 5).momentum?.x).toBe(fx(1));
  });
});

describe("purity", () => {
  it("returns the same state for the same frame and never mutates the script", () => {
    const cmds = [frame(2), hit(0), wait(2), clearAll(), frame(6), hit(1), motionRate(0.5), frame(12), clear(1)];
    const s = script("game_test", "test", cmds);
    const snapshot = JSON.stringify(s);
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 40 }), (g) => {
        const a = runScript(s, g);
        const b = runScript(s, g);
        return (
          JSON.stringify({ ...a, shieldSetoff: [...a.shieldSetoff] }) ===
          JSON.stringify({ ...b, shieldSetoff: [...b.shieldSetoff] })
        );
      }),
    );
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});
