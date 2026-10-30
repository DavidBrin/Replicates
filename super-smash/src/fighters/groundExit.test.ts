/**
 * No ground status survives leaving the ground (Plan 5, Task 12 fix round 2,
 * ruling R-T12d): every status's edge rule is one row of `GROUND_EXIT`, and each
 * grounded one is driven off the end of Battlefield's right soft platform here,
 * through the real `step()`. The sources are on the table (`engine/groundExit.ts`).
 */

import { beforeAll, describe, expect, it } from "vitest";

import { fx, toFloat } from "@/engine/fixed";
import { GROUND_EXIT } from "@/engine/groundExit";
import type { GroundExit } from "@/engine/groundExit";
import { ROLL_FORWARD } from "@/engine/groundDodge";
import { emptyKinetic } from "@/engine/kinetic";
import { createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { onLeftGround } from "@/engine/states";
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
const K = "keep";
/** The table as reviewed: the pin below compares it, and the slides below expect it. */
const PINNED: Readonly<Record<ActionState, GroundExit>> = {
  stand: F, walk: F, dashStart: F, run: F, runBrake: F, turnaround: F,
  crouchStart: F, crouch: F, crouchEnd: F, crawl: F,
  jumpSquat: K, jump: K, fall: K, land: L, landingLag: L, specialFall: K, specialLanding: L,
  attack: K, special: K, grab: C, grabHold: C, pummel: C, throw: C,
  shieldStart: C, shield: C, shieldRelease: C, shieldStun: C, shieldBroken: L, spotDodge: F, roll: F, airDodge: K,
  hitstun: K, tumble: K, tumbleFall: K, grabbed: K, thrown: K, downed: T, getUp: F,
  tech: F, techRoll: F, techWall: K, techCeiling: K,
  ledgeHang: K, ledgeGetUp: K, ledgeAttack: K, ledgeRoll: K, ledgeJump: K, ledgeTrumped: K,
  cargoCarry: K, cargoHeld: K, inhaleHold: K, swallowed: K, spatStar: K, footstooled: L,
  respawnPlatform: K, dead: K, entering: K,
};

describe("the edge rule of every status (ruling R-T12d)", () => {
  it("names one for every action, each row pinned (a change is a reviewed diff)", () => {
    expect(GROUND_EXIT).toEqual(PINNED);
    expect(Object.keys(GROUND_EXIT).sort()).toEqual(Object.keys(STATUS_KIND_OF_ACTION).sort());
  });

  // The mechanism, row by row: `onLeftGround` turns a fall row into its fall and
  // leaves every other status as it is (a landing's lag, a move, a reel...).
  it("is what `onLeftGround` does with each status", () => {
    for (const action of Object.keys(PINNED) as ActionState[]) {
      const f = { action, actionFrame: 3, charge: 0, move: null, jumpsUsed: 0, grounded: false, combat: { helplessMove: null }, kinetic: emptyKinetic() } as unknown as FighterState;
      onLeftGround(f);
      const exit = PINNED[action];
      const want = exit === "fall" || exit === "tumbleFall" ? exit : action;
      expect(f.action, action).toBe(want);
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
  { action: "hitstun", hitstun: 15 },
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
    it(`${row.action}: ${exit}`, () => {
      const states = slide(row);
      const me = states.map((s) => s.fighters[0]);
      // Never standing (or crouching, or crawling) in the air.
      me.forEach((f, i) => {
        if (!f.grounded) expect(["stand", "walk", "crouchStart", "crouch", "crouchEnd", "crawl"], `${row.action}, frame ${i}`).not.toContain(f.action);
      });
      if (exit === "cliffStop") {
        // It stops at the edge, on its feet, for as long as it is in a cliff-stop
        // status (a shield's raise hands straight to the shield).
        const stays = me.findIndex((f) => PINNED[f.action] !== "cliffStop");
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
