/**
 * Recovery fidelity (Plan 5, Task 13b): each up special angles, turns, travels
 * and lasts as its "(SSBU)/Up special" page publishes, and lands into its own
 * landing lag. Every number is the page's (URL beside it) or marked UNVERIFIED.
 *
 * - Mario: https://www.ssbwiki.com/Mario_(SSBU)/Up_special
 * - Donkey Kong: https://www.ssbwiki.com/Donkey_Kong_(SSBU)/Up_special
 * - Link: https://www.ssbwiki.com/Link_(SSBU)/Up_special
 * - Samus: https://www.ssbwiki.com/Samus_(SSBU)/Up_special
 * - Kirby: https://www.ssbwiki.com/Kirby_(SSBU)/Up_special
 * - Fox: https://www.ssbwiki.com/Fox_(SSBU)/Up_special
 * - Pikachu: https://www.ssbwiki.com/Pikachu_(SSBU)/Up_special
 * - Marth: https://www.ssbwiki.com/Marth_(SSBU)/Up_special
 */

import { beforeAll, describe, expect, it } from "vitest";

import { fx, toFloat } from "@/engine/fixed";
import { hashState } from "@/engine/hash";
import { fighterParams } from "@/engine/params";
import { cloneState, createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { Btn } from "@/engine/types";
import type { FighterState, GameState, InputFrame, MatchRules, StageDef } from "@/engine/types";
import { STAGES } from "@/stages";
import { battlefield } from "@/stages/battlefield";
import { finalDestination } from "@/stages/finalDestination";
import { FIGHTERS } from "./index";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true };
const BY_ID = new Map(FIGHTERS.map((f) => [f.id, f]));

/** Nowhere to land and nothing to grab: the move's own path and nothing else. */
const VOID: StageDef = {
  ...finalDestination,
  id: "void13b",
  platforms: [{ x: 0, y: fx(-4000), halfWidth: fx(10), soft: false, ledges: false }],
  blastZone: { left: fx(-4000), right: fx(4000), top: fx(4000), bottom: fx(-8000) },
  spawns: [{ x: 0, y: 0 }, { x: fx(2000), y: 0 }],
};

beforeAll(() => {
  registerFighters(FIGHTERS);
  registerStages([...STAGES, VOID]);
});

/**
 * `id` as port 0 at rest, in the air (or on the floor of `stage`), Mario far off:
 * out in the void, or standing 60 behind on a real stage (past its blast lines he
 * would be KO'd, and freeze the match).
 */
function scene(id: string, over: Partial<FighterState> = {}, stage = "void13b"): GameState {
  const s = createInitialState(stage, [{ defId: id }, { defId: "mario" }], RULES, 5);
  const grounded = over.grounded === true;
  Object.assign(s.fighters[0], {
    action: grounded ? "stand" : "fall",
    actionFrame: 0,
    grounded,
    platform: grounded ? 0 : -1,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    facing: 1,
    intangible: 0,
    invincible: 0,
    jumpsUsed: grounded ? 0 : 2,
    ...over,
  });
  const far = stage === "void13b" ? fx(2000) : fx(-60);
  Object.assign(s.fighters[1], { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: far, y: 0, facing: 1, intangible: 0, invincible: 0 });
  return s;
}

/** Up special on frame 1, with `stick(i)` held on frame i (0-based); every frame's state. */
function upB(start: GameState, frames: number, stick: (i: number) => InputFrame = () => 0, press: InputFrame = Btn.Up | Btn.Special): GameState[] {
  const out: GameState[] = [];
  let state = start;
  let prev: readonly InputFrame[] = [0, 0];
  for (let i = 0; i < frames; i++) {
    const now = [stick(i) | (i === 0 ? press : 0), 0];
    state = step(state, now, { prevInputs: prev }).state;
    prev = now;
    out.push(state);
  }
  return out;
}

const me = (states: readonly GameState[]): FighterState[] => states.map((s) => s.fighters[0]);
/** The 0-based index of the first frame the fighter is no longer in the special, or -1. */
const endsAt = (fs: readonly FighterState[]): number => fs.findIndex((f) => f.action !== "special");
/** Degrees from straight up toward +x, of a velocity. */
const heading = (f: FighterState): number => (Math.atan2(toFloat(f.vx), toFloat(f.vy)) * 180) / Math.PI;
const units = (q: number): number => toFloat(q);

describe("each up special lasts as published", () => {
  // The move's frames are 1..T and it hands off on frame T + 1 (the page's
  // "Animation length" T): special fall, in the air.
  const AIR: readonly [string, number, string][] = [
    ["mario", 37, "Animation length 37"],
    ["donkeyKong", 70, "aerial Animation length 70"],
    ["samus", 47, "aerial Animation length 47"],
    ["fox", 86, "Animation length 86"],
    ["pikachu", 69, "Animation length 69"],
    ["marth", 39, "Animation length 39"],
    ["link", 91, "aerial Animation length 91"],
  ];
  for (const [id, total, quote] of AIR) {
    it(`${id}'s, begun in the air, ends helpless after ${total} frames (${quote})`, () => {
      const fs = me(upB(scene(id), total + 5));
      expect(endsAt(fs), id).toBe(total);
      expect(fs[total].action).toBe("specialFall");
    });
  }

  it("Samus's, begun on the ground, ends after 38 frames (grounded Animation length 38)", () => {
    const fs = me(upB(scene("samus", { grounded: true }, "finalDestination"), 60));
    expect(endsAt(fs)).toBe(38);
  });

  it("Donkey Kong's, begun on the ground, stays on it and ends after 104 (grounded Interruptible 105)", () => {
    const fs = me(upB(scene("donkeyKong", { grounded: true }, "finalDestination"), 120));
    expect(endsAt(fs)).toBe(104);
    expect(fs.slice(0, 104).every((f) => f.grounded)).toBe(true);
    expect(fs[104].action).toBe("stand");
  });

  it("Link's, begun on the ground, stays on it and is not helpless (SmashWiki Helpless: only 'if in the air')", () => {
    const fs = me(upB(scene("link", { grounded: true }, "finalDestination"), 90));
    expect(fs.slice(0, 76).every((f) => f.grounded && f.y === fs[0].y)).toBe(true);
    expect(endsAt(fs)).toBe(76);
    expect(fs[76].action).toBe("stand");
  });

  it("Kirby's Final Cutter falls on until it lands (SmashWiki Helpless: 'the move does not end until Kirby lands on the ground')", () => {
    const fs = me(upB(scene("kirby"), 200));
    expect(endsAt(fs)).toBe(-1);
    // Its fall is the descent's, on every frame of the hold.
    expect(fs.slice(60).every((f) => f.vy === fs[60].vy && f.vy < 0)).toBe(true);
  });
});

describe("the up specials' angles", () => {
  // "Stick sensitivity to angle 0.5", "Maximum angle deviation 12°" (Mario) and
  // 20° (Marth): full deflection turns the rise by the maximum toward the stick.
  for (const [id, max, frame] of [
    ["mario", 12, 5],
    ["marth", 20, 6],
  ] as const) {
    it(`${id}'s rise turns ${max}° toward the stick held (Maximum angle deviation ${max}°)`, () => {
      const straight = heading(me(upB(scene(id), frame))[frame - 1]);
      const forward = heading(me(upB(scene(id), frame, () => Btn.Right))[frame - 1]);
      expect(forward - straight).toBeCloseTo(max, 0);
      // Held back, it turns away: Marth has no published reverse, so he keeps
      // facing right and angles back by the maximum.
      if (id === "marth") {
        const back = me(upB(scene(id), frame, () => Btn.Left))[frame - 1];
        expect(back.facing).toBe(1);
        expect(heading(back) - straight).toBeCloseTo(-max, 0);
      }
    });
  }

  it("Mario's rise is 1.1x on the ground and 1.08x in the air (Grounded / Aerial height multiplier)", () => {
    const air = me(upB(scene("mario"), 6))[4];
    const ground = me(upB(scene("mario", { grounded: true }, "finalDestination"), 6))[4];
    expect(units(ground.vy) / units(air.vy)).toBeCloseTo(1.1 / 1.08, 3);
  });

  it("Fox's dash flies the way the stick points on frame 30, in eight directions (Fox (SSBU): 'up to 8 angles'; Frame to decide dash angle 30)", () => {
    const dirs: readonly [InputFrame, number, number][] = [
      [Btn.Up, 0, 1],
      [Btn.Up | Btn.Right, 1, 1],
      [Btn.Right, 1, 0],
      [Btn.Down | Btn.Right, 1, -1],
      [Btn.Down, 0, -1],
      [Btn.Down | Btn.Left, -1, -1],
      [Btn.Left, -1, 0],
      [Btn.Up | Btn.Left, -1, 1],
    ];
    for (const [stick, dx, dy] of dirs) {
      // The stick held from frame 30 only: what it says then is the dash.
      const f = me(upB(scene("fox"), 44, (i) => (i >= 29 ? stick : 0)))[43];
      const diag = dx !== 0 && dy !== 0;
      const each = diag ? 3.8 * Math.SQRT1_2 : 3.8;
      expect(units(f.vx), `stick ${stick}`).toBeCloseTo(dx * each, 2);
      expect(units(f.vy), `stick ${stick}`).toBeCloseTo(dy * each, 2);
    }
    // Neutral: skyward (UNVERIFIED: the move list's "Rockets skyward").
    const up = me(upB(scene("fox"), 44))[43];
    expect(units(up.vx)).toBe(0);
    expect(units(up.vy)).toBeCloseTo(3.8, 2);
    // A stick moved after frame 30 changes nothing.
    const late = me(upB(scene("fox"), 44, (i) => (i >= 30 ? Btn.Right : 0)))[43];
    expect(units(late.vx)).toBe(0);
  });

  it("Fox's dash keeps 3.8 for 6 frames, then loses 0.1 a frame (Initial speed 3.8; Period before applying dash friction 6 frames; Dash friction 0.1)", () => {
    const fs = me(upB(scene("fox"), 72));
    expect(fs.slice(42, 48).map((f) => units(f.vy))).toEqual([3.8, 3.8, 3.8, 3.8, 3.8, 3.8].map((v) => expect.closeTo(v, 3)));
    expect(units(fs[48].vy)).toBeCloseTo(3.7, 3);
    expect(units(fs[71].vy)).toBeCloseTo(1.4, 2);
  });

  it("Fox hangs nearly still while he charges (Fox (SSBU): 'it stops him in place'; startup gravity 0.015 after 12 frames)", () => {
    const fs = me(upB(scene("fox", { vx: fx(1), vy: fx(-1.5) }), 42));
    // No gravity on frames 1-12, then 0.015 a frame: about 6.4 down by frame 42.
    expect(fs[11].y).toBe(fs[0].y);
    expect(units(fs[41].y - fs[11].y)).toBeGreaterThan(-8);
    expect(units(fs[41].y - fs[11].y)).toBeLessThan(-5);
    // Horizontal speed x0.8 on entry (Horizontal speed multiplier on startup 0.8),
    // then bleeding 0.02 a frame whatever the stick (Friction on startup 0.02).
    expect(units(fs[0].vx)).toBeCloseTo(0.8, 3);
    expect(units(fs[1].vx)).toBeCloseTo(0.78, 3);
  });

  it("Fox's stick does not drift him while he charges: it bleeds at 0.02 whatever is held (Friction on startup 0.02)", () => {
    const fs = me(upB(scene("fox", { vx: fx(1) }), 20, () => Btn.Right));
    for (let i = 1; i < 12; i++) expect(units(fs[i].vx - fs[i - 1].vx), `frame ${i + 1}`).toBeCloseTo(-0.02, 3);
  });

  it("clears the aim when the move ends, however it ends (new state is cleared)", () => {
    const fs = me(upB(scene("fox"), 90, (i) => (i >= 29 ? Btn.Up | Btn.Right : 0)));
    expect([fs[40].combat.aimX, fs[40].combat.aimY]).toEqual([fx(1), fx(1)]);
    expect(fs[86].action).toBe("specialFall");
    expect([fs[86].combat.aimX, fs[86].combat.aimY]).toEqual([0, 0]);
  });

  it("Pikachu's two legs each go the way the stick points, 55 then 49.5 units (Dash travel speed 11, Dash duration 5 frames, Travel speed multiplier for second dash 0.9)", () => {
    // Leg 1 up-right (read on its first frame, 15), leg 2 left (read on 20,
    // Earliest continuable 20).
    const fs = me(upB(scene("pikachu"), 34, (i) => (i < 19 ? Btn.Up | Btn.Right : Btn.Left)));
    const leg1 = [units(fs[18].x - fs[13].x), units(fs[18].y - fs[13].y)];
    expect(Math.hypot(leg1[0], leg1[1])).toBeCloseTo(55, 0);
    expect(leg1[0]).toBeCloseTo(leg1[1], 1);
    const leg2 = [units(fs[32].x - fs[27].x), units(fs[32].y - fs[27].y)];
    expect(leg2[0]).toBeCloseTo(-49.5, 0);
    expect(leg2[1]).toBeCloseTo(0, 0);
    // It holds still in between, frames 21-27 (Quick Attack: "it briefly holds still").
    expect(fs[26].x).toBe(fs[20].x);
    expect(fs[26].y).toBe(fs[20].y);
  });

  it("Pikachu's second leg does not come out the same way as the first (Minimum angle difference for second dash 35°)", () => {
    const fs = me(upB(scene("pikachu"), 34, () => Btn.Right));
    const leg2 = units(fs[32].x - fs[27].x);
    expect(leg2).toBeLessThan(5);
  });

  it("Pikachu's first leg goes up with the stick at rest (Quick Attack: 'or upwards if it is not tilted')", () => {
    const fs = me(upB(scene("pikachu"), 20));
    expect(units(fs[18].y - fs[13].y)).toBeCloseTo(55, 0);
    expect(fs[18].x).toBe(fs[13].x);
  });
});

describe("the up specials' control and reversal", () => {
  it("Mario turns round when the stick is held back on frame 3, and not on frame 4 (Optional reverse 3)", () => {
    const on3 = me(upB(scene("mario"), 6, (i) => (i === 2 ? Btn.Left : 0)));
    expect(on3[1].facing).toBe(1);
    expect(on3[2].facing).toBe(-1);
    const on4 = me(upB(scene("mario"), 6, (i) => (i === 3 ? Btn.Left : 0)));
    expect(on4[5].facing).toBe(1);
  });

  for (const id of ["samus", "kirby"] as const) {
    it(`${id} turns round with the stick held back as the move starts (Stick sensitivity to reverse 0.25; UNVERIFIED window: frames 1-4)`, () => {
      expect(me(upB(scene(id), 3, () => Btn.Left))[2].facing).toBe(-1);
      expect(me(upB(scene(id), 8, (i) => (i === 5 ? Btn.Left : 0)))[7].facing).toBe(1);
    });
  }

  for (const id of ["donkeyKong", "link", "marth"] as const) {
    it(`${id} has no published reverse: the stick held back does not turn it`, () => {
      expect(me(upB(scene(id), 8, () => Btn.Left))[7].facing).toBe(1);
    });
  }

  it("Donkey Kong drifts at 0.05 a frame up to 1.7 in the air (Air acceleration 0.05, Maximum air speed 1.7)", () => {
    // Frame 1 is the launch's; the drift runs from frame 2.
    const fs = me(upB(scene("donkeyKong"), 60, () => Btn.Right));
    expect(units(fs[10].vx)).toBeCloseTo(0.5, 3);
    expect(units(fs[59].vx)).toBeCloseTo(1.7, 3);
  });

  it("Donkey Kong leaves at 0.9 and falls back under a gravity of 0.07 (Initial vertical speed in midair 0.9; Gravity multiplier 0.07, read as the gravity itself: UNVERIFIED)", () => {
    const fs = me(upB(scene("donkeyKong"), 40));
    expect(units(fs[0].vy)).toBeCloseTo(0.9, 3);
    expect(units(fs[1].vy)).toBeCloseTo(0.83, 3);
    // "very little vertical height": about 5.8 at the top, and coming down by frame 40.
    const top = Math.max(...fs.map((f) => units(f.y)));
    expect(top).toBeGreaterThan(5);
    expect(top).toBeLessThan(7);
    expect(units(fs[39].vy)).toBeLessThan(0);
  });

  it("Donkey Kong steers on the ground at 0.034 a frame up to 1.1 (Ground acceleration 0.034, Maximum ground speed 1.1)", () => {
    const fs = me(upB(scene("donkeyKong", { grounded: true }, "finalDestination"), 50, () => Btn.Right));
    expect(units(fs[9].vx)).toBeCloseTo(0.34, 2);
    expect(units(fs[49].vx)).toBeCloseTo(1.1, 3);
  });

  it("Samus leaves at (0.35, 2.8) and drifts at 0.017 a frame up to 0.57 (Initial grounded speed, Air acceleration 0.017, Air speed 0.57)", () => {
    const g = units(fighterParams(BY_ID.get("samus")!).air_accel_y);
    const fs = me(upB(scene("samus", { grounded: true }, "finalDestination"), 40, (i) => (i === 0 ? 0 : Btn.Right)));
    expect(units(fs[0].vy)).toBeCloseTo(2.8, 3);
    expect(units(fs[1].vy)).toBeCloseTo(2.8 - g, 3);
    expect(units(fs[0].vx)).toBeCloseTo(0.35, 3);
    expect(units(fs[1].vx)).toBeCloseTo(0.367, 3);
    expect(units(fs[30].vx)).toBeCloseTo(0.57, 3);
    // The rise is the launch's under her own gravity: about 2.8^2 / 2g + 2.8, 53.7.
    const top = Math.max(...fs.map((f) => units(f.y)));
    expect(top).toBeGreaterThan(52);
    expect(top).toBeLessThan(55);
  });

  it("Link's aerial Spin Attack leaves at 2.4 under 0.55 of his gravity and drifts at half his air speed rising (Initial vertical speed 2.4, Gravity multiplier 0.55, Air speed multiplier 0.5 (rising))", () => {
    const p = fighterParams(BY_ID.get("link")!);
    const g = units(p.air_accel_y) * 0.55;
    const fs = me(upB(scene("link"), 47, () => Btn.Right));
    expect(units(fs[0].vy)).toBeCloseTo(2.4, 3);
    expect(units(fs[1].vy)).toBeCloseTo(2.4 - g, 3);
    expect(units(fs[30].vx)).toBeCloseTo(units(p.air_speed_x_stable) * 0.5, 3);
    // About 2.4^2 / 2g + 2.4, 55.8: its rise ends on frame 46, as "The ending attributes apply on frame 48" has it.
    const top = Math.max(...fs.map((f) => units(f.y)));
    expect(top).toBeGreaterThan(54);
    expect(top).toBeLessThan(57);
  });

  it("Link's ending drifts at 0.8 of his air speed from frame 48 (Air speed on ending 0.8; 'The ending attributes apply on frame 48')", () => {
    const p = fighterParams(BY_ID.get("link")!);
    const fs = me(upB(scene("link"), 90, () => Btn.Right));
    expect(units(fs[89].vx)).toBeCloseTo(units(p.air_speed_x_stable) * 0.8, 3);
  });

  it("Link's helpless fall accelerates by 0.025 more his base (Additional air acceleration 0.025 (helpless))", () => {
    const p = fighterParams(BY_ID.get("link")!);
    const fs = me(upB(scene("link"), 95, (i) => (i < 91 ? 0 : Btn.Right)));
    expect(fs[91].action).toBe("specialFall");
    expect(units(fs[92].vx - fs[91].vx)).toBeCloseTo(0.025 + units(p.air_accel_x_mul), 3);
  });

  it("Pikachu's ending drifts at 0.6 of his air speed (Horizontal speed multiplier on ending 0.6)", () => {
    const p = fighterParams(BY_ID.get("pikachu")!);
    // Both legs up (the second refused), the stick right from the ending's first frame, 34.
    const fs = me(upB(scene("pikachu"), 69, (i) => (i >= 33 ? Btn.Right : 0)));
    expect(units(fs[68].vx)).toBeCloseTo(units(p.air_speed_x_stable) * 0.6, 2);
  });

  it("Kirby's rise starts straight up (Horizontal speed at the start of the jump 0) and is 0.8x in the air (Aerial height multiplier 0.8)", () => {
    const air = me(upB(scene("kirby", { vx: fx(0.6) }), 8));
    expect(air[5].vx).toBe(0);
    const ground = me(upB(scene("kirby", { grounded: true }, "finalDestination"), 8))[5];
    expect(units(air[5].vy) / units(ground.vy)).toBeCloseTo(0.8, 3);
  });
});

describe("landing during an up special takes the move's own landing lag", () => {
  /** `id` falling onto Final Destination's floor from just above, up-B on the first frame. */
  const landing = (id: string, frames: number, height = 6): FighterState[] =>
    me(upB(scene(id, { y: fx(height), vy: fx(-3), fastFalling: true }, "finalDestination"), frames));

  for (const [id, lag] of [
    ["mario", 30],
    ["kirby", 30],
    ["pikachu", 24],
    ["marth", 24],
    ["fox", 20],
  ] as const) {
    it(`${id} lands into its special landing for ${lag} frames`, () => {
      // Kirby from the floor (his rise comes back down onto it); Pikachu dashes into it.
      const fs =
        id === "kirby"
          ? me(upB(scene(id, { grounded: true }, "finalDestination"), 120))
          : id === "pikachu"
            ? me(upB(scene(id, { y: fx(6) }, "finalDestination"), 60, (i) => (i === 0 ? 0 : Btn.Down)))
            : landing(id, 60);
      const at = fs.findIndex((f) => f.action === "specialLanding");
      expect(at, id).toBeGreaterThan(-1);
      expect(fs[at].charge).toBe(lag);
      expect(fs[at].combat.helplessMove).toBe("upB");
    });
  }

  it("Donkey Kong's aerial spin lands into frame 63 of the grounded one ('transitions to frame 63 of the grounded version')", () => {
    const fs = me(upB(scene("donkeyKong", { y: fx(2) }, "finalDestination"), 120));
    const at = fs.findIndex((f) => f.grounded);
    expect(fs[at].action).toBe("special");
    expect(fs[at].actionFrame).toBe(62);
    // ...and ends when the grounded one does, at 104.
    expect(fs[at + 104 - 63].action).toBe("special");
    expect(fs[at + 105 - 63].action).toBe("stand");
  });
});

describe("Link's Spin Attack charge (SmashWiki: Charges between 3-4, Maximum charge time 60 frames, 1 + 0.6 x charge / 60)", () => {
  it("holds on frame 3 while B is held, and goes on the frame it is let go", () => {
    const fs = me(upB(scene("link", { grounded: true }, "finalDestination"), 30, (i) => (i < 20 ? Btn.Special : 0)));
    expect(fs[19].actionFrame).toBe(2);
    expect(fs[19].charge).toBe(17);
    expect(fs[21].actionFrame).toBe(4);
  });

  it("goes on its own at a full charge (SmashWiki Charge: 'Automatically activates at full charge')", () => {
    const fs = me(upB(scene("link", { grounded: true }, "finalDestination"), 80, () => Btn.Special));
    const held = fs.filter((f) => f.actionFrame === 2).length;
    expect(held).toBeGreaterThanOrEqual(60);
    expect(held).toBeLessThanOrEqual(62);
    expect(fs[79].actionFrame).toBeGreaterThan(10);
  });

  it("hits 1 + 0.6 x charge / 60 harder: 1.3x at 30 frames ('the damage multiplier is equal to 1 + 0.6 * (charge frames / 60)')", () => {
    const damageAfter = (heldUntil: number): number => {
      const s = scene("link", { grounded: true }, "finalDestination");
      Object.assign(s.fighters[1], { x: fx(8), facing: -1 });
      const fs = upB(s, heldUntil + 12, (i) => (i < heldUntil ? Btn.Special : 0));
      return units(fs[fs.length - 1].fighters[1].damage);
    };
    const fresh = damageAfter(1);
    expect(fresh).toBeGreaterThan(0);
    // Held on frames 1-33: the charge counts from frame 4, 30 frames.
    expect(damageAfter(33) / fresh).toBeCloseTo(1.3, 2);
  });

  it("is not charged in the air (SmashWiki Charge: 'Aerial version cannot be charged')", () => {
    const fs = me(upB(scene("link"), 10, () => Btn.Special));
    expect(fs[9].actionFrame).toBe(9);
    expect(fs[9].move).toBe("upBAir");
  });
});

describe("dropping through a soft platform", () => {
  // SmashWiki "Helpless" (https://www.ssbwiki.com/Helpless): "holding down to drop
  // through them"; falling through soft platforms "Starting in Melee, this can be
  // done at any time (not just when a character is helpless)".
  const above = (action: FighterState["action"], down: boolean): FighterState[] => {
    const s = scene("mario", { action, x: 0, y: fx(52), vy: fx(-1) }, "battlefield");
    if (action === "specialFall") s.fighters[0].combat.helplessMove = "upB";
    const out: GameState[] = [];
    let state = s;
    let prev: readonly InputFrame[] = [0, 0];
    for (let i = 0; i < 30; i++) {
      const now = [down ? Btn.Down : 0, 0];
      state = step(state, now, { prevInputs: prev }).state;
      prev = now;
      out.push(state);
    }
    return me(out);
  };
  const top = battlefield.platforms.find((p) => p.soft && p.x === 0)!.y;

  for (const action of ["fall", "specialFall"] as const) {
    it(`a fighter in ${action} holding down passes through; one not holding it lands`, () => {
      expect(above(action, false).some((f) => f.grounded && f.y === top)).toBe(true);
      expect(above(action, true).some((f) => f.grounded && f.y === top)).toBe(false);
    });
  }

  it("a fighter still reeling in hitstun does not: it meets the platform, Down held or not (UNVERIFIED: a reel reads no stick here)", () => {
    const s = scene("mario", { action: "tumble", x: 0, y: fx(52), vy: fx(-1), hitstun: 40 }, "battlefield");
    let state = s;
    let prev: readonly InputFrame[] = [0, 0];
    let lowest = Number.POSITIVE_INFINITY;
    for (let i = 0; i < 20; i++) {
      const now = [Btn.Down, 0];
      state = step(state, now, { prevInputs: prev }).state;
      prev = now;
      lowest = Math.min(lowest, state.fighters[0].y);
    }
    expect(lowest).toBeGreaterThanOrEqual(top);
  });
});

describe("rollback through an up special", () => {
  // The aim each one holds at the cut, as the stick read on its aiming frame
  // (Q12 deflection): Fox on 30 (up-right), Pikachu's second leg on 20 (down-left),
  // Mario's rise on 4 (down-left).
  for (const [id, cut, aim] of [
    ["fox", 35, [fx(1), fx(1)]],
    ["pikachu", 24, [fx(-1), fx(-1)]],
    ["mario", 8, [fx(-1), fx(-1)]],
  ] as const) {
    it(`${id}: a snapshot taken after its aim was decided replays to the same hash`, () => {
      const stick = (i: number): InputFrame => (i % 7 < 3 ? Btn.Up | Btn.Right : Btn.Down | Btn.Left);
      const frames = upB(scene(id), cut, stick);
      const snap = cloneState(frames[cut - 1]);
      // On from the snapshot, twice: once on the original, once on the copy.
      const on = (from: GameState): GameState => {
        let state = from;
        let prev: readonly InputFrame[] = [stick(cut - 1), 0];
        for (let i = cut; i < cut + 40; i++) {
          const now = [stick(i), 0];
          state = step(state, now, { prevInputs: prev }).state;
          prev = now;
        }
        return state;
      };
      const held = frames[cut - 1].fighters[0].combat;
      expect([held.aimX, held.aimY]).toEqual(aim);
      expect(hashState(on(snap))).toBe(hashState(on(frames[cut - 1])));
    });
  }
});
