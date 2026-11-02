/**
 * No ground status survives leaving the ground (Plan 5, Task 12 fix round 2,
 * ruling R-T12d): every status's edge rule is one row of `GROUND_EXIT`, and each
 * grounded one is driven off the end of Battlefield's right soft platform here,
 * through the real `step()`. Fix round 3 (rulings R-T12e to R-T12g): the rolls,
 * the spot dodge, a waveland and the grounded attacks stop at the edge. The
 * sources are on the table (`engine/groundExit.ts`).
 */

import { beforeAll, describe, expect, it } from "vitest";

import { fx, toFloat } from "@/engine/fixed";
import { GROUND_EXIT, stopsAtEdge } from "@/engine/groundExit";
import type { GroundExit } from "@/engine/groundExit";
import { TECH_ROLL_DISTANCE, TECH_ROLL_FRAMES } from "@/engine/constants";
import { ROLL_FORWARD, groundDodgeOf, rollOf } from "@/engine/groundDodge";
import { emptyKinetic } from "@/engine/kinetic";
import { hashState } from "@/engine/hash";
import { cloneState, createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { ROLL_DISTANCE, onLeftGround, startAction } from "@/engine/states";
import { STATUS_KIND_OF_ACTION } from "@/engine/status/kind";
import { Btn } from "@/engine/types";
import type { ActionState, FighterState, GameState, InputFrame, MatchRules, MoveSlot } from "@/engine/types";
import { STAGES } from "@/stages";
import { FIGHTERS } from "./index";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: false };

beforeAll(() => {
  registerFighters(FIGHTERS);
  registerStages(STAGES);
});

const F = "fall";
const T = "tumbleFall";
const L = "lag";
const C = "cliffStop";
const S = "stopUnlessPushed";
const K = "keep";
/** The table as reviewed: the pin below compares it, and the slides below expect it. */
const PINNED: Readonly<Record<ActionState, GroundExit>> = {
  stand: F, walk: F, dashStart: F, run: F, runBrake: F, turnaround: F,
  crouchStart: F, crouch: F, crouchEnd: F, crawl: F,
  jumpSquat: K, jump: K, fall: K, land: L, landingLag: L, specialFall: K, specialLanding: L,
  attack: S, special: K, grab: C, grabHold: C, pummel: C, throw: C,
  shieldStart: C, shield: C, shieldRelease: C, shieldStun: C, shieldBroken: L, spotDodge: C, roll: C, airDodge: K,
  hitstun: K, rebound: L, tumble: K, tumbleFall: K, grabbed: K, thrown: K, downed: T, getUp: F,
  tech: F, techRoll: C, techWall: K, techCeiling: K,
  ledgeHang: K, ledgeGetUp: K, ledgeAttack: K, ledgeRoll: K, ledgeJump: K, ledgeTrumped: K,
  cargoCarry: K, cargoHeld: K, inhaleHold: K, swallowed: K, spatStar: K, footstooled: L, finalTrapped: K,
  respawnPlatform: K, dead: K, entering: K,
};

describe("the edge rule of every status (ruling R-T12d)", () => {
  it("names one for every action, each row pinned (a change is a reviewed diff)", () => {
    expect(GROUND_EXIT).toEqual(PINNED);
    expect(Object.keys(GROUND_EXIT).sort()).toEqual(Object.keys(STATUS_KIND_OF_ACTION).sort());
  });

  // The mechanism, row by row: `onLeftGround` turns a fall row into its fall, and a
  // grounded attack that left the ground (only a push can take it off) into a fall,
  // the ledge cancel; it leaves every other status as it is (a landing's lag, a
  // special, a reel...), and an attack that rises off the ground by itself too.
  it("is what `onLeftGround` does with each status", () => {
    for (const action of Object.keys(PINNED) as ActionState[]) {
      for (const vy of [0, fx(1)]) {
        const f = { action, actionFrame: 3, charge: 0, move: null, jumpsUsed: 0, vy, grounded: false, combat: { helplessMove: null }, kinetic: emptyKinetic() } as unknown as FighterState;
        onLeftGround(f);
        const exit = PINNED[action];
        const want = exit === "fall" || exit === "tumbleFall" ? exit : exit === "stopUnlessPushed" && vy <= 0 ? "fall" : action;
        expect(f.action, `${action} at vy ${vy}`).toBe(want);
      }
    }
  });
});

/** Battlefield's right soft platform: its right end, 17.3165 right of 42.1055. */
const EDGE = 42.1055 + 17.3165;

interface Row {
  readonly action: ActionState;
  readonly defId?: string;
  /** Keys held from before the first frame (so nothing is a fresh press). */
  readonly keys?: InputFrame;
  readonly facing?: number;
  readonly move?: MoveSlot;
  readonly charge?: number;
  readonly hitstun?: number;
  /** A rebound's length (`CombatState.rebound`). */
  readonly rebound?: number;
  /** A captive in front of it, held (`grabbing`/`grabbedBy`). */
  readonly holding?: boolean;
}

/** Each grounded status, set up to still be itself on the frame it reaches the edge. */
const ROWS: readonly Row[] = [
  { action: "stand" },
  { action: "walk", keys: Btn.Right | Btn.Soft },
  { action: "dashStart", keys: Btn.Right },
  { action: "run", keys: Btn.Right },
  { action: "runBrake" },
  { action: "turnaround", keys: Btn.Left, facing: -1 },
  { action: "crouchStart", keys: Btn.Down },
  { action: "crouch", keys: Btn.Down },
  { action: "crouchEnd" },
  { action: "crawl", defId: "pikachu", keys: Btn.Down | Btn.Right },
  { action: "jumpSquat" },
  { action: "land", charge: 10 },
  { action: "landingLag", charge: 10 },
  { action: "specialLanding", charge: 10 },
  { action: "attack", move: "ftilt" },
  { action: "attack", move: "dashAttack" },
  { action: "attack", move: "fsmash" },
  { action: "special", move: "neutralB" },
  { action: "grab", move: "grab", facing: -1 },
  { action: "grabHold", facing: -1, holding: true },
  { action: "pummel", move: "pummel", facing: -1, holding: true },
  { action: "shieldStart", keys: Btn.Shield },
  { action: "shield", keys: Btn.Shield },
  { action: "shieldStun", keys: Btn.Shield, hitstun: 12 },
  { action: "shieldRelease" },
  { action: "shieldBroken", hitstun: 20 },
  { action: "spotDodge" },
  { action: "roll", charge: ROLL_FORWARD },
  { action: "roll", charge: 1 },
  { action: "hitstun", hitstun: 15 },
  { action: "rebound", rebound: 15 },
  { action: "downed" },
  { action: "getUp" },
  { action: "tech" },
  { action: "techRoll", charge: ROLL_FORWARD },
  { action: "footstooled" },
];

/** Mario (or `row.defId`) in `row.action` on the platform 0.12 short of its end, sliding off it at `speed`. */
function slide(row: Row, frames = 150, speed = 1.2): GameState[] {
  const plat = STAGES.find((st) => st.id === "battlefield")!.platforms[3];
  const ids = row.holding === true ? [row.defId ?? "mario", "kirby"] : [row.defId ?? "mario"];
  const s = createInitialState("battlefield", ids.map((defId) => ({ defId })), RULES, 2);
  const f = s.fighters[0];
  Object.assign(f, {
    action: row.action, actionFrame: 0, move: row.move ?? null, charge: row.charge ?? 0, hitstun: row.hitstun ?? 0,
    grounded: true, platform: 3, x: fx(EDGE - 0.12), y: plat.y, vx: fx(speed), facing: row.facing ?? 1, intangible: 0, invincible: 0,
  });
  f.combat.rebound = row.rebound ?? 0;
  if (row.holding === true) {
    const v = s.fighters[1];
    Object.assign(v, { action: "grabbed", actionFrame: 0, grounded: true, platform: 3, x: fx(EDGE - 4), y: plat.y, facing: 1, grabbedBy: 0, grabTimer: 90, intangible: 0, invincible: 0 });
    f.grabbing = 1;
  }
  const keys = row.keys ?? 0;
  const idle = s.fighters.slice(1).map((): InputFrame => 0);
  let st = s;
  const out: GameState[] = [];
  for (let i = 0; i < frames; i++) {
    st = step(st, [keys, ...idle], { prevInputs: [keys, ...idle] }).state;
    out.push(st);
  }
  return out;
}

describe("a grounded status slid off a soft platform (ruling R-T12d)", () => {
  for (const row of ROWS) {
    const exit = PINNED[row.action];
    const named = `${row.action}${row.move !== undefined ? ` (${row.move})` : row.action === "roll" ? ` (charge ${row.charge ?? 0})` : ""}`;
    it(`${named}: ${exit}`, () => {
      const states = slide(row);
      const me = states.map((s) => s.fighters[0]);
      // Never standing (or crouching, or crawling) in the air.
      me.forEach((f, i) => {
        if (!f.grounded) expect(["stand", "walk", "crouchStart", "crouch", "crouchEnd", "crawl"], `${row.action}, frame ${i}`).not.toContain(f.action);
      });
      if (exit === "cliffStop" || exit === "stopUnlessPushed") {
        // It stops at the edge, on its feet, for as long as it is in a cliff-stop
        // status (a shield's raise hands straight to the shield).
        const stays = me.findIndex((f) => PINNED[f.action] !== "cliffStop" && PINNED[f.action] !== "stopUnlessPushed");
        expect(stays === -1 ? me.length : stays, "frames stopped at the edge").toBeGreaterThan(1);
        for (const f of me.slice(0, stays === -1 ? me.length : stays)) {
          expect(f.grounded).toBe(true);
          expect(toFloat(f.x)).toBeLessThanOrEqual(EDGE + 1e-3);
        }
        return;
      }
      // Everything else is off on the first frame, as itself or its fall.
      expect(me[0].grounded, "left the ground on the first frame").toBe(false);
      if (exit === "fall" || exit === "tumbleFall") {
        expect(me[0].action).toBe(exit);
        return;
      }
      expect(me[0].action).toBe(row.action);
      if (exit === "lag") {
        // It plays its remaining frames out (in the air, and on as it lands), then falls
        // if still in the air, or stands if it has landed. At this speed it can also
        // drift past the main stage and catch its ledge first, as any falling body does.
        const next = me.findIndex((f) => f.action !== row.action);
        expect(next, "its frames end").toBeGreaterThan(0);
        expect(me[next].grounded ? ["stand"] : ["fall", "ledgeHang"], `${row.action} then`).toContain(me[next].action);
      }
    });
  }

  it("covers every grounded status: each fall, lag and cliff-stop row, and the grounded keeps", () => {
    const covered = new Set(ROWS.map((r) => r.action));
    const grounded = (Object.keys(PINNED) as ActionState[]).filter((a) => PINNED[a] !== "keep");
    // `throw` stops at the edge with the rest of the catch statuses; it needs a throw
    // in progress, which `throws.test.ts` drives, and is left to the table.
    expect(grounded.filter((a) => !covered.has(a))).toEqual(["throw"]);
  });
});

describe("a landing's lag, slid off (SmashWiki \"Ledge-canceling\")", () => {
  it("is not cancelled: it plays out its frames in the air, and landing again keeps it", () => {
    // Slow enough to land back on the main stage below, short of its edge.
    const states = slide({ action: "landingLag", charge: 40 }, 60, 0.5);
    const me = states.map((s) => s.fighters[0]);
    // Off on the first frame, still in the lag.
    expect(me[0].grounded).toBe(false);
    // It lands on the main stage below while the lag still runs, and it carries on.
    const landed = me.findIndex((f) => f.grounded);
    expect(landed).toBeGreaterThan(0);
    expect(landed).toBeLessThan(40);
    expect(me[landed].action).toBe("landingLag");
    // 40 frames of it in all (`actionFrame` 0 on the frame it was set, 1..39 on the
    // next 39), then it stands where it landed.
    expect(me[38].action).toBe("landingLag");
    expect(me[39].action).toBe("stand");
    expect(me[39].grounded).toBe(true);
  });
});

/** Battlefield's right soft platform's surface. */
const PLAT_Y = (): number => STAGES.find((st) => st.id === "battlefield")!.platforms[3].y;

describe("a roll and a tech roll at the edge (ruling R-T12e)", () => {
  // SmashWiki "Roll" (rev 2047810): "characters cannot roll off edges; should they roll
  // towards an edge, the character's movement will instantly halt at the edge while
  // the remainder of the animation continues". SmashWiki "Tech" (rev 2028146):
  // "Rolling against an edge will halt the roll's sideways movement."
  for (const action of ["roll", "techRoll"] as const) {
    it(`${action}: halts at the edge and plays the rest of its animation there`, () => {
      // Begun 3 short of the edge, rolling toward it at its own speed, as `startRoll`
      // and the rolling tech (`techOrBounce`) set it.
      const frames = action === "roll" ? rollOf(groundDodgeOf(FIGHTERS.find((d) => d.id === "mario")!.attributes), ROLL_FORWARD).frames : TECH_ROLL_FRAMES;
      const speed = Math.trunc((action === "roll" ? ROLL_DISTANCE : TECH_ROLL_DISTANCE) / frames);
      const s = createInitialState("battlefield", [{ defId: "mario" }], RULES, 2);
      Object.assign(s.fighters[0], { action, actionFrame: 0, charge: ROLL_FORWARD, grounded: true, platform: 3, x: fx(EDGE - 3), y: PLAT_Y(), vx: speed, facing: 1, intangible: 0, invincible: 0 });
      let st = s;
      const me: FighterState[] = [];
      for (let i = 0; i < 60; i++) {
        st = step(st, [0], { prevInputs: [0] }).state;
        me.push(st.fighters[0]);
      }
      const end = me.findIndex((f) => f.action !== action);
      expect(end, "the animation ends").toBeGreaterThan(5);
      // It reached the edge and stayed there, on the platform, rolling on.
      expect(me.slice(0, end).some((f) => toFloat(f.x) > EDGE - 0.01)).toBe(true);
      for (const f of me.slice(0, end)) {
        expect(f.grounded).toBe(true);
        expect(toFloat(f.x)).toBeLessThanOrEqual(EDGE + 1e-3);
      }
      // Its whole animation (`actionFrame` 0 on the frame it was set, then 1.. on the
      // next): the tech roll's 40 too, ending on step 39 (the Task 12 re-review 2).
      expect(end).toBe(frames - 1);
      expect(me[end].grounded).toBe(true);
    });
  }

  it("techRoll: plays the same 40 frames unobstructed, in the open", () => {
    const s = createInitialState("battlefield", [{ defId: "mario" }], RULES, 2);
    Object.assign(s.fighters[0], { action: "techRoll", actionFrame: 0, charge: ROLL_FORWARD, grounded: true, platform: 0, x: fx(-20), y: 0, vx: Math.trunc(TECH_ROLL_DISTANCE / TECH_ROLL_FRAMES), facing: 1, intangible: 0, invincible: 0 });
    let st = s;
    const me: FighterState[] = [];
    for (let i = 0; i < 60; i++) {
      st = step(st, [0], { prevInputs: [0] }).state;
      me.push(st.fighters[0]);
    }
    const end = me.findIndex((f) => f.action !== "techRoll");
    expect(end).toBe(TECH_ROLL_FRAMES - 1);
    // It travelled the whole way, never stopped.
    expect(me[end - 1].x).toBeGreaterThan(s.fighters[0].x + fx(10));
  });
});

describe("a waveland at the edge (ruling R-T12f)", () => {
  // SmashWiki "Wavedash" (rev 2063890): "wavedashes cannot slide off edges in Ultimate".
  /** Mario just over Battlefield's right platform, air-dodging into it: down and right, or neutral while drifting right. */
  function waveland(dodge: InputFrame = Btn.Shield | Btn.Down | Btn.Right, short = 6): FighterState[] {
    const s = createInitialState("battlefield", [{ defId: "mario" }], RULES, 2);
    Object.assign(s.fighters[0], { action: "fall", actionFrame: 4, grounded: false, platform: -1, x: fx(EDGE - short), y: PLAT_Y() + fx(1.5), vx: fx(0.8), vy: fx(-0.5), facing: 1, jumpsUsed: 1, intangible: 0, invincible: 0 });
    const keys = [dodge, ...Array<InputFrame>(39).fill(0)];
    let st = s;
    let prev: InputFrame = 0;
    const me: FighterState[] = [];
    for (const k of keys) {
      st = step(st, [k], { prevInputs: [prev] }).state;
      prev = k;
      me.push(st.fighters[0]);
    }
    return me;
  }

  it("stops at the platform's edge: the landing lag plays out there, on the platform", () => {
    const me = waveland();
    const landed = me.findIndex((f) => f.action === "landingLag");
    expect(landed, "it lands in the air dodge's landing lag").toBeGreaterThan(0);
    expect(me[landed].combat.landingCliffStop).toBe(true);
    const end = me.findIndex((f, i) => i > landed && f.action !== "landingLag");
    expect(end).toBeGreaterThan(landed);
    // The slide reaches the edge, and stops there.
    expect(me.slice(landed, end).some((f) => toFloat(f.x) > EDGE - 0.01)).toBe(true);
    for (const f of me.slice(landed, end)) {
      expect(f.grounded).toBe(true);
      expect(toFloat(f.x)).toBeLessThanOrEqual(EDGE + 1e-3);
    }
    expect(me[end].action).toBe("stand");
    expect(me[end].combat.landingCliffStop, "cleared as the lag ends").toBe(false);
  });

  it("a neutral air dodge's landing stops at the edge too", () => {
    // Drifting right at 0.8 into the platform, 3 short of its end, with no direction.
    const me = waveland(Btn.Shield, 3);
    const landed = me.findIndex((f) => f.action === "landingLag");
    expect(landed).toBeGreaterThan(0);
    expect(me[landed].combat.landingCliffStop).toBe(true);
    const end = me.findIndex((f, i) => i > landed && f.action !== "landingLag");
    expect(me.slice(landed, end === -1 ? me.length : end).some((f) => toFloat(f.x) > EDGE - 0.01), "it reaches the edge").toBe(true);
    for (const f of me.slice(landed, end === -1 ? me.length : end)) {
      expect(f.grounded).toBe(true);
      expect(toFloat(f.x)).toBeLessThanOrEqual(EDGE + 1e-3);
    }
  });

  it("is the air dodge's alone: an aerial's landing lag slid off plays out in the air (ruling R-T12d)", () => {
    const states = slide({ action: "landingLag", charge: 20 }, 30, 0.6);
    expect(states[0].fighters[0].grounded).toBe(false);
    expect(states[0].fighters[0].action).toBe("landingLag");
  });

  it("is the landing lag's mark alone: no other landing stops at the edge by it", () => {
    const landing = (action: ActionState) => ({ action, kinetic: emptyKinetic(), combat: { landingCliffStop: true } }) as unknown as FighterState;
    expect(stopsAtEdge(landing("landingLag"), 1)).toBe(true);
    for (const action of ["land", "specialLanding", "shieldBroken", "footstooled"] as const) expect(stopsAtEdge(landing(action), 1), action).toBe(false);
  });

  it("re-simulates identically across a rollback in the middle of one (the mark is state)", () => {
    const s0 = createInitialState("battlefield", [{ defId: "mario" }], RULES, 2);
    Object.assign(s0.fighters[0], { action: "fall", actionFrame: 4, grounded: false, platform: -1, x: fx(EDGE - 6), y: PLAT_Y() + fx(1.5), vx: fx(0.8), vy: fx(-0.5), facing: 1, jumpsUsed: 1, intangible: 0, invincible: 0 });
    const keys = [Btn.Shield | Btn.Down | Btn.Right, ...Array<InputFrame>(29).fill(0)];
    const live: GameState[] = [];
    let s = s0;
    keys.forEach((k, i) => {
      s = step(s, [k], { prevInputs: [i === 0 ? 0 : keys[i - 1]] }).state;
      live.push(s);
    });
    const marked = live.findIndex((st) => st.fighters[0].combat.landingCliffStop);
    expect(marked).toBeGreaterThan(0);
    for (const at of [marked, marked + 3, marked + 8]) {
      let replay = cloneState(live[at]);
      expect(hashState(replay)).toBe(hashState(live[at]));
      for (let i = at + 1; i < keys.length; i++) replay = step(replay, [keys[i]], { prevInputs: [keys[i - 1]] }).state;
      expect(hashState(replay), `rolled back to ${at}`).toBe(hashState(live[keys.length - 1]));
    }
  });

  it("forgets the mark however the lag is left: a hit, say", () => {
    const f = { action: "landingLag", actionFrame: 2, charge: 10, move: null, combat: { landingCliffStop: true } } as unknown as FighterState;
    startAction(f, "hitstun");
    expect(f.combat.landingCliffStop).toBe(false);
  });
});

describe("a grounded attack at the edge (ruling R-T12g)", () => {
  // Only a push toward the edge (on the DAMAGE energy) lets it off; one away from the
  // edge, or none, leaves the edge stop on.
  it("stops at the edge unless a push rides its DAMAGE energy toward that edge", () => {
    const attacking = (damageX: number) => ({ action: "attack", kinetic: { ...emptyKinetic(), damageX }, combat: { landingCliffStop: false } }) as unknown as FighterState;
    for (const outward of [1, -1]) {
      expect(stopsAtEdge(attacking(0), outward), `no push, edge ${outward}`).toBe(true);
      expect(stopsAtEdge(attacking(-outward * fx(0.3)), outward), `pushed away from edge ${outward}`).toBe(true);
      expect(stopsAtEdge(attacking(outward * fx(0.3)), outward), `pushed toward edge ${outward}`).toBe(false);
    }
  });

  // SmashWiki "Dash attack" (rev 2049916): Kirby's Melee dash attack "is the only one in
  // the series that can carry the user off platforms".
  for (const move of ["dashAttack", "fsmash"] as const) {
    it(`${move}: its own slide stops at the edge, and the move plays on there`, () => {
      const states = slide({ action: "attack", move }, 40, 1.6);
      const me = states.map((s) => s.fighters[0]);
      const end = me.findIndex((f) => f.action !== "attack");
      expect(end === -1 ? me.length : end).toBeGreaterThan(10);
      for (const f of me.slice(0, end === -1 ? me.length : end)) {
        expect(f.grounded).toBe(true);
        expect(toFloat(f.x)).toBeLessThanOrEqual(EDGE + 1e-3);
      }
    });
  }

  // SmashWiki "Ledge-canceling" (rev 1990115), "Windbox ledge cancel": "a windbox to push
  // the fighter off a ledge during their attack, with nearly all grounded attacks [...]
  // being cancelable in this way"; SmashWiki "Windbox" (rev 2056119): windboxes "can
  // push them off edges".
  it("pushed off the edge by F.L.U.D.D.'s water mid-attack, it is cancelled: it falls", () => {
    // Mario 24 to Fox's left on Battlefield's right platform, Fox 1.92 short of its end.
    const s = createInitialState("battlefield", [{ defId: "mario" }, { defId: "fox" }], { ...RULES, oneOnOne: true }, 5);
    Object.assign(s.fighters[0], { action: "stand", actionFrame: 0, grounded: true, platform: 3, x: fx(33.5), y: PLAT_Y(), facing: 1, intangible: 0 });
    Object.assign(s.fighters[1], { action: "stand", actionFrame: 0, grounded: true, platform: 3, x: fx(57.5), y: PLAT_Y(), facing: -1, intangible: 0 });
    let st = s;
    let prev: InputFrame[] = [0, 0];
    const fox: FighterState[] = [];
    for (let i = 0; i < 40; i++) {
      // Mario's bare F.L.U.D.D. press; Fox's down smash, pressed as the water reaches him.
      const now: InputFrame[] = [i === 0 || i === 15 ? Btn.Down | Btn.Special : 0, i === 24 ? Btn.Down | Btn.Attack : i > 24 && i < 28 ? Btn.Down : 0];
      st = step(st, now, { prevInputs: prev }).state;
      prev = now;
      fox.push(st.fighters[1]);
    }
    const pushed = fox.findIndex((f) => f.kinetic.damageX > 0);
    expect(pushed, "the water pushes him").toBeGreaterThan(0);
    expect(fox[pushed].action).toBe("attack");
    const off = fox.findIndex((f) => !f.grounded);
    expect(off).toBeGreaterThan(pushed);
    expect(fox[off - 1].action).toBe("attack");
    expect(fox[off].action).toBe("fall");
  });
});
