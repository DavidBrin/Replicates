/**
 * Specials that charge, driven through the real `step()` with the real roster
 * (Plan 5, Task 2; the D32 rule: assert on what a player sees).
 *
 * Two kinds, as in SSBU:
 * - **hold**: the charge grows while B is held and the move fires on release —
 *   Hero's Bow, Shield Breaker, Hammer Flip, Skull Bash;
 * - **store**: the charge loops until B is pressed again; shield or jump puts
 *   it away for later, and a full charge stores itself — Charge Shot, Giant
 *   Punch (and F.L.U.D.D. in Task 7).
 *
 * Before this, every chargeable special read the *attack* button, so the bow
 * never charged and Charge Shot always fired at 5%.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { ONE, fx, toFloat } from "@/engine/fixed";
import { chargeFraction } from "@/engine/projectile";
import { createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { chargedHitbox } from "@/engine/specialCharge";
import { Btn } from "@/engine/types";
import type { FighterState, GameState, InputFrame, MatchRules, ProjectileState } from "@/engine/types";
import { STAGES } from "@/stages";
import { FIGHTERS, donkeyKong, kirby, link, marth, pikachu } from "./index";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true };

beforeAll(() => {
  registerFighters(FIGHTERS);
  registerStages(STAGES);
});

/** `defId` standing at centre stage, Mario far away on the right, both actionable. */
function standing(defId: string): GameState {
  const s = createInitialState("finalDestination", [{ defId }, { defId: "mario" }], RULES, 99);
  s.fighters.forEach((f, i) =>
    Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(i === 0 ? -30 : 60), y: 0, facing: 1, intangible: 0 }),
  );
  return s;
}

/** Step with the given per-frame inputs for port 0; port 1 idles. */
function play(
  s: GameState,
  inputs: readonly InputFrame[],
): { state: GameState; trace: FighterState[]; spawned: number[]; shots: ProjectileState[] } {
  let state = s;
  let prev: InputFrame = 0;
  const trace: FighterState[] = [];
  const spawned: number[] = [];
  const shots: ProjectileState[] = [];
  for (const input of inputs) {
    const before = state.nextProjectileId;
    state = step(state, [input, 0], { prevInputs: [prev, 0] }).state;
    prev = input;
    trace.push(state.fighters[0]);
    if (state.nextProjectileId > before) {
      spawned.push(trace.length);
      shots.push(state.projectiles[state.projectiles.length - 1]);
    }
  }
  return { state, trace, spawned, shots };
}

const press = (b: InputFrame, then: InputFrame, frames: number): InputFrame[] => [b, ...Array<InputFrame>(frames - 1).fill(then)];

describe("Charge Shot stores its charge (store mode)", () => {
  it("charges in a loop after pressing B once, and a full charge stores itself", () => {
    const { state, trace } = play(standing("samus"), press(Btn.Special, 0, 200));
    expect(Math.max(...trace.map((f) => f.charge))).toBe(112);
    expect(state.fighters[0].combat.storedCharge).toBe(112);
    expect(state.fighters[0].action).toBe("stand");
    expect(state.projectiles).toHaveLength(0);
  });

  it("puts a partial charge away on shield, and keeps it", () => {
    const inputs = [...press(Btn.Special, 0, 43), Btn.Shield];
    const { state } = play(standing("samus"), inputs);
    expect(state.fighters[0].combat.storedCharge).toBe(30);
    expect(state.fighters[0].action).toBe("shieldStart");
  });

  it("puts it away on a jump too", () => {
    const { state } = play(standing("samus"), [...press(Btn.Special, 0, 33), Btn.Jump]);
    expect(state.fighters[0].combat.storedCharge).toBe(20);
    expect(state.fighters[0].action).toBe("jumpSquat");
  });

  it("fires a stored full charge three frames after B, at full strength", () => {
    const charged = play(standing("samus"), press(Btn.Special, 0, 200)).state;
    const { state, spawned, shots } = play(charged, press(Btn.Special, 0, 10));
    expect(spawned).toEqual([3]);
    expect(shots[0].charge).toBe(ONE);
    expect(state.fighters[0].combat.storedCharge).toBe(0);
  });

  it("fires on a second B press, with the charge built so far", () => {
    const { shots } = play(standing("samus"), [...press(Btn.Special, 0, 69), Btn.Special, 0, 0, 0, 0]);
    expect(shots).toHaveLength(1);
    expect(shots[0].charge).toBe(Math.trunc((56 * ONE) / 112));
  });

  it("is not charged by holding attack", () => {
    const { trace } = play(standing("samus"), press(Btn.Special, Btn.Attack, 40));
    expect(trace.some((f) => f.charge > 0)).toBe(true);
    const held = play(standing("samus"), press(Btn.Attack, Btn.Attack, 40)).trace;
    expect(held.every((f) => f.move !== "neutralB")).toBe(true);
  });
});

describe("Giant Punch stores its charge too", () => {
  it("swings its arms until B, then punches at the charged damage", () => {
    const s = standing("donkeyKong");
    s.fighters[1].x = fx(-18);
    s.fighters[1].facing = 1;
    s.fighters[0].x = fx(-30);
    const { state } = play(s, [...press(Btn.Special, 0, 117), Btn.Special, ...Array<InputFrame>(40).fill(0)]);
    // 110 charge frames: 10% + 18 = 28%; ×1.05 fresh, ×1.2 one-on-one.
    expect(toFloat(state.fighters[1].damage)).toBeCloseTo(28 * 1.05 * 1.2, 2);
  });
});

describe("hold-mode specials charge on B, not on attack", () => {
  it("Hero's Bow looses a stronger, faster arrow the longer B is held", () => {
    const quick = play(standing("link"), [Btn.Special, 0, ...Array<InputFrame>(30).fill(0)]).shots[0];
    const full = play(standing("link"), [...press(Btn.Special, Btn.Special, 90), ...Array<InputFrame>(20).fill(0)]).shots[0];
    expect(quick.charge).toBe(0);
    expect(full.charge).toBe(ONE);
    expect(Math.abs(full.vx)).toBeGreaterThan(Math.abs(quick.vx) * 3);
  });

  it("Shield Breaker waits while B is held, then lands at its full-charge damage", () => {
    const s = standing("marth");
    s.fighters[1].x = fx(-20);
    const { state, trace } = play(s, [...press(Btn.Special, Btn.Special, 75), ...Array<InputFrame>(20).fill(0)]);
    expect(Math.max(...trace.map((f) => f.charge))).toBe(60);
    expect(toFloat(state.fighters[1].damage)).toBeCloseTo(24 * 1.05 * 1.2, 2);
  });
});

describe("the roster", () => {
  it("charges no special on the attack button: `chargeable` is for smashes only", () => {
    for (const def of FIGHTERS) {
      for (const slot of ["neutralB", "sideB", "upB", "downB"] as const) {
        expect(def.moves[slot]?.chargeable, `${def.id} ${slot}`).toBeUndefined();
      }
    }
  });
});

describe("a charge a frame short of full (SmashWiki's partial-charge formulas)", () => {
  /** The move's box `id` after `c` charge frames, as the sim builds it. */
  function box(move: NonNullable<typeof marth.moves.neutralB>, id: number, c: number) {
    const sc = move.specialCharge!;
    const hb = move.hitboxes.find((h) => h.id === id)!;
    return chargedHitbox(hb, sc.full?.[id], chargeFraction(c, sc.frames), sc.partial);
  }

  it("Shield Breaker: 1 + 1.2·c/60 — 19.62% tip, 17.44% body at 59; 24% / 22% at 60", () => {
    const sb = marth.moves.neutralB!;
    expect(toFloat(box(sb, 0, 59).damage)).toBeCloseTo(19.62, 1);
    expect(toFloat(box(sb, 1, 59).damage)).toBeCloseTo(17.44, 1);
    expect(box(sb, 0, 60).damage).toBe(fx(24));
    expect(box(sb, 1, 60).damage).toBe(fx(22));
  });

  it("Hammer Flip: 0.085% a frame — 29.115% at 119; 35% at 361° at 120", () => {
    const hf = kirby.moves.sideB!;
    expect(toFloat(box(hf, 0, 119).damage)).toBeCloseTo(29.115, 2);
    expect(box(hf, 0, 119).angle).toBe(hf.hitboxes[0].angle);
    expect(box(hf, 0, 120).damage).toBe(fx(35));
    expect(box(hf, 0, 120).angle).toBe(fx(361));
  });

  it("Giant Punch: 10 + 18·c/110 rounded down — 27% at 109, 28% at 110", () => {
    const gp = donkeyKong.moves.neutralB!;
    expect(box(gp, 0, 109).damage).toBe(fx(27));
    expect(box(gp, 0, 110).damage).toBe(fx(28));
  });

  it("Skull Bash: 6.2 + 15.2·c/80, unrounded", () => {
    const sk = pikachu.moves.sideB!;
    expect(toFloat(box(sk, 0, 79).damage)).toBeCloseTo(6.2 + (15.2 * 79) / 80, 2);
  });

  it("the bow: 4 + 8·c/60 rounded down — 11% at 59", () => {
    const arrow = link.moves.neutralB!.projectiles![0];
    const at = (c: number) => chargedHitbox(arrow.hitbox, arrow.charged!.hitbox, chargeFraction(c, 60), arrow.charged!.partial);
    expect(at(59).damage).toBe(fx(11));
    expect(at(60).damage).toBe(fx(12));
    expect(at(7).damage).toBe(fx(4));
  });
});
