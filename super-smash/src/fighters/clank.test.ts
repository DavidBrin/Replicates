/**
 * What a clank does (Plan 5, Task 13c fix round 1, rulings R-T13c-a and R-T13c-b),
 * driven through `step()` with the real roster. SmashWiki "Priority"
 * (https://www.ssbwiki.com/Priority, revision 2049993):
 * - "a rebounding character will suffer freeze frames equal to the hitlag of the
 *   stronger attack (by %) ... During these freeze frames, all hitboxes are
 *   disabled. This takes into account all hitlag modifiers, with one exception:
 *   the electric modifier is applied based on whether the character's hitbox has
 *   the electric effect";
 * - "In Ultimate, the length of the rebound animation for both characters is
 *   based on the damage dealt by the stronger hitbox ... the same formula as
 *   Smash 4 [`R=Floor((d+4)*15/8)`], although the maximum rebound is 58 frames";
 * - "When a normal aerial attack hitbox overlaps that of a normal ground attack or
 *   another normal aerial, the attacks do not clank"; "airborne attacks cannot be
 *   cancelled out, including airborne special moves".
 */

import { beforeAll, describe, expect, it } from "vitest";
import { ONE, fx, mul } from "@/engine/fixed";
import { hashState } from "@/engine/hash";
import { STALE_FRESH_BONUS, computeHitlag, framesAfterHit } from "@/engine/knockback";
import { cloneState, createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import type { SimContext } from "@/engine/simulate";
import { Btn } from "@/engine/types";
import type { GameState, InputFrame, MatchRules, StepEvents } from "@/engine/types";
import { bakedContext } from "@/game/bake";
import { readBakeFromDisk } from "@/game/bakeNode";
import { STAGES } from "@/stages";
import { FIGHTERS } from "./index";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: false };
const BY_ID = new Map(FIGHTERS.map((f) => [f.id, f]));

beforeAll(() => {
  registerFighters(FIGHTERS);
  registerStages(STAGES);
});

/** The rebound's published length for a stronger hitbox of `damage` (Q12): whole percent, at most 58. */
const rebound = (damage: number): number => Math.min(Math.trunc(((Math.trunc(damage / ONE) + 4) * 15) / 8), 58);

/** A fresh move's damage as a clank weighs it: ×1.05 (`STALE_FRESH_BONUS`), no 1v1 bonus. */
const fresh = (percent: number): number => mul(fx(percent), STALE_FRESH_BONUS);

/** The freeze a side takes: the stronger box's hitlag, electric by its own box. */
const freezeOf = (stronger: number, moveMultiplier: number | undefined, ownElectric: boolean): number =>
  framesAfterHit(computeHitlag(stronger, { moveMultiplier, electric: ownElectric }));

/** `a` (port 0) at `xa` facing right and `b` (port 1) at `xb` facing left, standing on Final Destination. */
function facing(a: string, b: string, xa: number, xb: number, ctx?: SimContext): GameState {
  const s = createInitialState("finalDestination", [{ defId: a }, { defId: b }], RULES, 0xc1a, ctx);
  s.fighters.forEach((f, i) =>
    Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(i === 0 ? xa : xb), y: s.fighters[i].y, vx: 0, vy: 0, facing: i === 0 ? 1 : -1, intangible: 0, invincible: 0 }),
  );
  return s;
}

function run(s0: GameState, frames: number, script: (i: number) => InputFrame[], ctx?: SimContext): { states: GameState[]; events: StepEvents[] } {
  const states: GameState[] = [];
  const events: StepEvents[] = [];
  let s = s0;
  let prev = script(0).map(() => 0);
  for (let i = 0; i < frames; i++) {
    const now = script(i);
    const out = step(s, now, { prevInputs: prev, ...(ctx !== undefined ? { ctx } : {}) });
    s = out.state;
    prev = now;
    states.push(s);
    events.push(out.events);
  }
  return { states, events };
}

/**
 * Port 0 presses `a` on step `at`, port 1 presses `b` on step `k`, for k from 0 to
 * 30: the first run that clanks, with the step it clanks on.
 */
function firstClank(setup: () => GameState, a: InputFrame, at: number, b: InputFrame, frames = 90, ctx?: SimContext) {
  for (let k = 0; k <= 30; k++) {
    const script = (i: number): InputFrame[] => [i === at ? a : 0, i === k ? b : 0];
    const { states, events } = run(setup(), frames, script, ctx);
    const clank = events.findIndex((e) => e.clanks.length > 0);
    if (clank >= 0) return { k, clank, states, events, script };
  }
  throw new Error("no timing clanked");
}

/** The steps from `from` on that `f(port)` spends in `action`, and the first step it is out of it. */
function stretch(states: readonly GameState[], from: number, port: number, action: string): { frames: number; out: number } {
  let i = from;
  while (i < states.length && states[i].fighters[port].action === action) i++;
  return { frames: i - from, out: i };
}

describe("a clank freezes both sides, then the loser rebounds (R-T13c-a)", () => {
  it("within 9%: Donkey Kong's jab (4%) and Mario's (2.2%) freeze both for the stronger's hitlag, then both rebound floor((4+4)·15/8) = 15 frames, actionable together", () => {
    // Mario's jab is `game_attack11` (2.2%, hitlag ×1.8); Donkey Kong's here his legacy jab (4%, ×1).
    const { clank, states } = firstClank(() => facing("mario", "donkeyKong", 0, 15), Btn.Attack, 3, Btn.Attack);
    const at = states[clank];
    const lag = freezeOf(fresh(4), undefined, false);
    expect(at.fighters.map((f) => [f.action, f.hitlag])).toEqual([
      ["rebound", lag],
      ["rebound", lag],
    ]);
    // The clank's frame, the freeze's `lag` after it, then the rebound's 15 (the
    // last of them the frame it hands back: a status entered on contact, `endStatus`),
    // both alike.
    const mario = stretch(states, clank, 0, "rebound");
    const dk = stretch(states, clank, 1, "rebound");
    expect(mario).toEqual(dk);
    expect(mario.frames).toBe(lag + rebound(fresh(4)));
    expect(rebound(fresh(4))).toBe(15);
    expect(states[mario.out].fighters.map((f) => f.action)).toEqual(["stand", "stand"]);
  });

  it("more than 9%: Marth's forward smash tip (18%) beats Mario's jab: both freeze 17, Marth swings on, Mario rebounds floor((18+4)·15/8) = 41", () => {
    const { clank, states, events } = firstClank(() => facing("mario", "marth", 0, 22), Btn.Attack, 12, Btn.Left | Btn.Attack);
    const at = states[clank];
    const lag = freezeOf(fresh(18), undefined, false);
    expect(lag).toBe(17);
    expect([at.fighters[0].action, at.fighters[0].hitlag]).toEqual(["rebound", lag]);
    expect([at.fighters[1].action, at.fighters[1].move, at.fighters[1].hitlag]).toEqual(["attack", "fsmash", lag]);
    // Marth's boxes are off while he is frozen: nothing he swings hits until it is over.
    const marthHits = events.flatMap((e, i) => e.hits.filter((h) => h.attacker === 1).map(() => i));
    expect(marthHits.every((i) => i > clank + lag)).toBe(true);
    expect(stretch(states, clank, 0, "rebound").frames).toBe(lag + rebound(fresh(18)));
    expect(rebound(fresh(18))).toBe(41);
  });

  it("freezes both by the stronger box's own hitlag multiplier: Link's jab (3%, ×1.6) against Mario's (2.2%, ×1.8)", () => {
    // Both `game_attack11`, run from their scripts: Link's 3% at hitlag ×1.6, Mario's
    // 2.2% at ×1.8. Within 9%, both rebound; "This takes into account all hitlag
    // modifiers": the stronger's ×1.6 freezes both (11), not ×1 (7) nor Mario's ×1.8 (13).
    const { clank, states } = firstClank(() => facing("link", "mario", 0, 14), Btn.Attack, 3, Btn.Attack);
    const at = states[clank];
    const lag = freezeOf(fresh(3), fx(1.6), false);
    expect(lag).toBe(11);
    expect(at.fighters.map((f) => [f.action, f.hitlag])).toEqual([
      ["rebound", lag],
      ["rebound", lag],
    ]);
    expect(at.fighters.map((f) => f.combat.rebound)).toEqual([rebound(fresh(3)), rebound(fresh(3))]);
  });

  it("caps the rebound at 58 frames", () => {
    // d 27 and over: floor((27+4)·15/8) = 58.
    expect([rebound(fx(26)), rebound(fx(27)), rebound(fx(40))]).toEqual([56, 58, 58]);
  });

  it("a side that cannot rebound (THRU) freezes, then swings on: Donkey Kong's forward smash against Mario's", () => {
    // DK's 22% (THRU) and Mario's 14.7% close box, within 9%: Mario rebounds, DK freezes and goes on.
    const { clank, states } = firstClank(() => facing("mario", "donkeyKong", 0, 20), Btn.Right | Btn.Attack, 12, Btn.Left | Btn.Attack);
    const at = states[clank];
    const lag = freezeOf(fresh(22), undefined, false);
    expect([at.fighters[0].action, at.fighters[0].hitlag]).toEqual(["rebound", lag]);
    expect([at.fighters[1].action, at.fighters[1].move, at.fighters[1].hitlag]).toEqual(["attack", "fsmash", lag]);
  });

  it("freezes each side electric by its own box, on the baked form: Pikachu's electric forward tilt (9%) against Mario's (7%)", () => {
    // `game_attacks3`: 9%, `collision_attr_elec`, run from its limb script in the game.
    const GAME = bakedContext({ fighter: (id) => BY_ID.get(id)!, stage: (id) => STAGES.find((st) => st.id === id)! }, readBakeFromDisk());
    expect(GAME.fighter("pikachu").scripts?.ftilt).toBeDefined();
    const tilt = (dir: Btn) => dir | Btn.Attack | Btn.Soft;
    const { clank, states } = firstClank(() => facing("mario", "pikachu", 0, 14, GAME), tilt(Btn.Right), 6, tilt(Btn.Left), 90, GAME);
    const at = states[clank];
    // Within 9% (9.45 against 7.35): both rebound. The electric ×1.5 is Pikachu's alone.
    expect(at.fighters.map((f) => f.action)).toEqual(["rebound", "rebound"]);
    expect(at.fighters[0].hitlag).toBe(freezeOf(fresh(9), undefined, false));
    expect(at.fighters[1].hitlag).toBe(freezeOf(fresh(9), undefined, true));
    expect(at.fighters[1].hitlag).toBeGreaterThan(at.fighters[0].hitlag);
  });

  it("rolls back across the freeze and the rebound, hash for hash", () => {
    const { clank, k, script } = firstClank(() => facing("mario", "marth", 0, 22), Btn.Attack, 12, Btn.Left | Btn.Attack);
    void k;
    const s0 = facing("mario", "marth", 0, 22);
    const { states } = run(s0, 90, script);
    for (const at of [clank - 1, clank, clank + 5, clank + 17, clank + 30, clank + 58]) {
      let s = cloneState(states[at]);
      let prev = script(at);
      for (let i = at + 1; i < 90; i++) {
        const now = script(i);
        s = step(s, now, { prevInputs: prev }).state;
        prev = now;
        expect(hashState(s), `snapshot ${at}, step ${i}`).toBe(hashState(states[i]));
      }
    }
  });

  it("clears the rebound's length on leaving it, and hashes and clones it", () => {
    const { clank, states } = firstClank(() => facing("mario", "marth", 0, 22), Btn.Attack, 12, Btn.Left | Btn.Attack);
    const mario = states[clank].fighters[0];
    expect(mario.combat.rebound).toBe(rebound(fresh(18)));
    const out = stretch(states, clank, 0, "rebound").out;
    expect(states[out].fighters[0].combat.rebound).toBe(0);
    const q = cloneState(states[clank]);
    q.fighters[0].combat.rebound += 1;
    expect(hashState(q)).not.toBe(hashState(states[clank]));
    expect(cloneState(q).fighters[0].combat.rebound).toBe(q.fighters[0].combat.rebound);
  });
});

describe("aerials don't clank with ground attacks or with each other (R-T13c-b)", () => {
  /**
   * Port 1 (Fox) held in the air at (xf, yf), port 0 (Mario) at 0, standing, or held
   * in the air at `ym`: each presses its key on step 0 and `j` (0 to 18). The clanks,
   * and whether, at some timing, Mario's move hit Fox while Fox's air was out.
   */
  function meet(xf: number, yf: number, ym: number | null, mario: InputFrame, fox: InputFrame) {
    let clanks = 0;
    let throughAir = false;
    for (let j = 0; j <= 18; j++) {
      let s = facing("mario", "fox", 0, xf);
      const hold = (st: GameState) => {
        Object.assign(st.fighters[1], { grounded: false, platform: -1, x: fx(xf), y: fx(yf), vx: 0, vy: 0 });
        if (ym !== null) Object.assign(st.fighters[0], { grounded: false, platform: -1, x: 0, y: fx(ym), vx: 0, vy: 0 });
      };
      Object.assign(s.fighters[1], { action: "fall" });
      if (ym !== null) Object.assign(s.fighters[0], { action: "fall" });
      let prev: InputFrame[] = [0, 0];
      for (let i = 0; i < 30; i++) {
        hold(s);
        const airOut = s.fighters[1].action === "attack" && s.fighters[1].move === "nair";
        const now: InputFrame[] = [i === j ? mario : 0, i === 0 ? fox : 0];
        const out = step(s, now, { prevInputs: prev });
        s = out.state;
        prev = now;
        clanks += out.events.clanks.length;
        if (airOut && out.events.hits.some((h) => h.attacker === 0 && h.victim === 1)) throughAir = true;
      }
    }
    return { clanks, throughAir };
  }

  it("Fox's neutral air, held in the air, never clanks with Mario's down smash on the ground, which goes through it into Fox", () => {
    // Fox 2 above the floor, 12 in front of Mario: his air's box meets the down smash's
    // (38 clanks over these timings with the rule off). "both will persist ... and will
    // damage their foes": the smash hits him with his air still out.
    const { clanks, throughAir } = meet(12, 2, null, Btn.Down | Btn.Attack, Btn.Attack);
    expect(clanks).toBe(0);
    expect(throughAir).toBe(true);
  });

  it("two neutral airs, both held in the air, never clank with each other", () => {
    const { clanks } = meet(8, 10, 10, Btn.Attack, Btn.Attack);
    expect(clanks).toBe(0);
  });

  it("but the same ground attacks clank on the ground (the control)", () => {
    const { clank } = firstClank(() => facing("mario", "marth", 0, 22), Btn.Attack, 12, Btn.Left | Btn.Attack);
    expect(clank).toBeGreaterThan(0);
  });
});
