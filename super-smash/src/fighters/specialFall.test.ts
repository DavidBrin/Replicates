/**
 * Special fall (Plan 5, Task 4b): a recovery move leaves its fighter helpless
 * until it lands, grabs a ledge or is hit.
 *
 * SmashWiki "Helpless" (https://www.ssbwiki.com/Helpless): "a state in which
 * characters are unable to take any action, with the exception of grabbing a
 * ledge, maneuvering left/right, fastfalling, or climbing a ladder, until they
 * land on the ground or pass a blast line"; "it also ends if characters flinch,
 * allowing them to attack or re-use their triple jump". SmashWiki "Lag"
 * (https://www.ssbwiki.com/Lag), "Special landing": "Characters that land while
 * in their helpless state undergo a specific amount of landing lag, dependent on
 * the move that initiated it."
 */

import { beforeAll, describe, expect, it } from "vitest";

import { fx, mul } from "@/engine/fixed";
import { hashState } from "@/engine/hash";
import { fighterParams } from "@/engine/params";
import { cloneState, createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { onLeftGround } from "@/engine/states";
import { STATUS_KIND_OF_ACTION, changeStatus } from "@/engine/status/kind";
import { Btn } from "@/engine/types";
import type { ActionState, FighterDef, FighterState, GameState, InputFrame, MatchRules, MoveDef } from "@/engine/types";
import { STAGES } from "@/stages";
import { FIGHTERS } from "./index";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true };
const BY_ID = new Map(FIGHTERS.map((f) => [f.id, f]));

/**
 * Each up special's published special fall, from its "(SSBU)/Up special" page:
 * "Landing lag" (the landing's "Interruptible" frame less one) and
 * "Helplessness air speed multiplier". UNVERIFIED where a page publishes no
 * multiplier: the fighter's own air speed (× 1).
 */
const PUBLISHED: Readonly<Record<string, { readonly landingLag: number; readonly airSpeed: number; readonly url: string }>> = {
  // "Helplessness air speed multiplier 0.6", "Landing lag 30 frames".
  mario: { landingLag: 30, airSpeed: fx(0.6), url: "https://www.ssbwiki.com/Mario_(SSBU)/Up_special" },
  // "Helplessness landing lag 38 frames"; no multiplier published (UNVERIFIED × 1).
  donkeyKong: { landingLag: 38, airSpeed: fx(1), url: "https://www.ssbwiki.com/Donkey_Kong_(SSBU)/Up_special" },
  // "Air speed multiplier ... 0.909 (helpless)", "Landing lag 30 frames".
  link: { landingLag: 30, airSpeed: fx(0.909), url: "https://www.ssbwiki.com/Link_(SSBU)/Up_special" },
  // "Landing lag 24 frames", "Helplessness air speed multiplier 0.66".
  samus: { landingLag: 24, airSpeed: fx(0.66), url: "https://www.ssbwiki.com/Samus_(SSBU)/Up_special" },
  // "Landing (cutter)": "Interruptible 31"; UltimateFrameData's landing lag 30
  // (https://ultimateframedata.com/kirby). No multiplier published (UNVERIFIED × 1).
  kirby: { landingLag: 30, airSpeed: fx(1), url: "https://www.ssbwiki.com/Kirby_(SSBU)/Up_special" },
  // "Helplessness air speed multiplier 0.85", "Landing lag 20 frames".
  fox: { landingLag: 20, airSpeed: fx(0.85), url: "https://www.ssbwiki.com/Fox_(SSBU)/Up_special" },
  // "Helplessness air speed multiplier 0.4", "Landing lag 24 frames".
  pikachu: { landingLag: 24, airSpeed: fx(0.4), url: "https://www.ssbwiki.com/Pikachu_(SSBU)/Up_special" },
  // "Helplessness air speed multiplier 0.4", "Landing lag 24 frames".
  marth: { landingLag: 24, airSpeed: fx(0.4), url: "https://www.ssbwiki.com/Marth_(SSBU)/Up_special" },
};

/**
 * A stand-in attacker for the hit test: Fox with a jab whose one box is large
 * and live on frames 2-4, so a hit lands whatever the helpless fighter's height.
 * Not a published move.
 */
const PUNCH: MoveDef = {
  slot: "jab1",
  name: "Stand-in punch",
  totalFrames: 20,
  hitboxes: [
    {
      id: 0,
      startFrame: 2,
      endFrame: 4,
      x: fx(0),
      y: fx(10),
      radius: fx(30),
      damage: fx(10),
      angle: fx(80),
      baseKnockback: fx(60),
      knockbackGrowth: fx(80),
    },
  ],
};
const FOX = BY_ID.get("fox")!;
const PUNCHER: FighterDef = {
  ...FOX,
  id: "puncher",
  // Fox's own jab script would replace the stand-in's legacy move.
  scripts: Object.fromEntries(Object.entries(FOX.scripts ?? {}).filter(([slot]) => slot !== "jab1")),
  moves: { ...FOX.moves, jab1: PUNCH },
};

beforeAll(() => {
  registerFighters([...FIGHTERS, PUNCHER]);
  registerStages(STAGES);
});

/** `id` as port 0 with `over` applied, Mario standing far off at x 60 as port 1. */
function scene(id: string, over: Partial<FighterState>, other = "mario", otherOver: Partial<FighterState> = {}): GameState {
  const s = createInitialState("finalDestination", [{ defId: id }, { defId: other }], RULES, 5);
  Object.assign(s.fighters[0], { action: "fall", actionFrame: 0, grounded: false, platform: -1, facing: 1, intangible: 0, invincible: 0, jumpsUsed: 1, ...over });
  Object.assign(s.fighters[1], { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(60), y: 0, facing: -1, intangible: 0, invincible: 0, ...otherOver });
  return s;
}

/** `id` helpless after its up special: the state the move's end leaves it in. */
function helpless(id: string, over: Partial<FighterState> = {}): GameState {
  const s = scene(id, { action: "specialFall", x: fx(-200), y: fx(100), ...over });
  s.fighters[0].combat.helplessMove = "upB";
  return s;
}

/** Step `frames` frames with port 0 pressing `input(i)`; every frame's state. */
function run(start: GameState, frames: number, input: (i: number) => InputFrame = () => 0, other: (i: number) => InputFrame = () => 0): GameState[] {
  const out: GameState[] = [];
  let state = start;
  let prev: readonly InputFrame[] = [0, 0];
  for (let i = 0; i < frames; i++) {
    const now = [input(i), other(i)];
    state = step(state, now, { prevInputs: prev }).state;
    prev = now;
    out.push(state);
  }
  return out;
}

describe("every up special's published special fall", () => {
  for (const def of FIGHTERS) {
    it(`${def.id}'s is ${PUBLISHED[def.id].url}'s`, () => {
      const p = PUBLISHED[def.id];
      expect(def.moves.upB?.helpless).toEqual({ landingLag: p.landingLag, airSpeed: p.airSpeed });
    });
  }

  it("is on no side special of this roster", () => {
    // SmashWiki "Helpless" lists none of the eight for Ultimate; of Fox Illusion
    // it says "Does not cause helplessness in SSB4 or Ultimate", and SmashWiki
    // "Fox (SSBU)" (https://www.ssbwiki.com/Fox_(SSBU)): Fox Illusion "doesn't
    // leave him helpless".
    for (const def of FIGHTERS) expect(def.moves.sideB?.helpless, def.id).toBeUndefined();
  });
});

describe("an up special used in the air", () => {
  for (const def of FIGHTERS) {
    it(`leaves ${def.id} helpless when it ends, and a second one before landing does nothing`, () => {
      const start = scene(def.id, { x: fx(-200), y: 0 });
      const frames = run(start, 140, (i) => (i === 0 ? Btn.Up | Btn.Special : 0));
      const end = frames.findIndex((s) => s.fighters[0].action !== "special");
      expect(end, "the up special never ended").toBeGreaterThan(0);
      const f = frames[end].fighters[0];
      expect([f.action, f.grounded, f.combat.helplessMove]).toEqual(["specialFall", false, "upB"]);
      // Up and B again, then every other button, a frame apart: nothing comes out.
      const presses = [Btn.Up | Btn.Special, 0, Btn.Special, 0, Btn.Jump, 0, Btn.Attack, 0, Btn.Shield, 0, Btn.Grab, 0];
      const after = run(frames[end], presses.length, (i) => presses[i]);
      for (const s of after) {
        expect(s.fighters[0].action).toBe("specialFall");
        expect(s.fighters[0].move).toBeNull();
      }
      expect(after.at(-1)!.fighters[0]).toMatchObject({ jumpsUsed: f.jumpsUsed, airDodged: false });
    });
  }
});

describe("a side special used in the air", () => {
  it("leaves Fox free to act when Fox Illusion ends, and Mario when the Cape ends", () => {
    for (const id of ["fox", "mario"]) {
      // On its last frame, high off the stage, so it ends in the air.
      const move = BY_ID.get(id)!.moves.sideB!;
      const last = (move.airTotalFrames ?? move.totalFrames) - 1;
      const start = scene(id, { action: "special", move: "sideB", actionFrame: last, x: fx(-200), y: fx(60) });
      const [ended] = run(start, 1);
      expect(ended.fighters[0].action, id).toBe("fall");
      expect(ended.fighters[0].combat.helplessMove, id).toBeNull();
      const [jumped] = run(ended, 1, () => Btn.Jump);
      expect(jumped.fighters[0].action, id).toBe("jump");
    }
  });
});

describe("while helpless", () => {
  for (const def of FIGHTERS) {
    it(`${def.id} drifts no faster than its air speed times the published multiplier`, () => {
      const top = mul(fighterParams(def).air_speed_x_stable, PUBLISHED[def.id].airSpeed);
      const frames = run(helpless(def.id), 60, () => Btn.Right);
      expect(frames.at(-1)!.fighters[0].action).toBe("specialFall");
      expect(frames.at(-1)!.fighters[0].vx).toBe(top);
      expect(Math.max(...frames.map((s) => s.fighters[0].vx))).toBe(top);
    });
  }

  it("fast falls, as SmashWiki \"Helpless\" allows", () => {
    const def = BY_ID.get("mario")!;
    const frames = run(helpless("mario", { vy: -fx(0.5) }), 2, (i) => (i === 1 ? Btn.Down : 0));
    expect(frames[1].fighters[0]).toMatchObject({ action: "specialFall", fastFalling: true, vy: -fighterParams(def).dive_speed_y });
  });

  it("grabs a ledge as any falling fighter does, and is free to act from it", () => {
    // Final Destination's left ledge is at x -80, its surface at y 0.
    const start = helpless("mario", { x: fx(-81.5), y: fx(-1), vy: -fx(0.5) });
    const [grabbed] = run(start, 1);
    expect(grabbed.fighters[0]).toMatchObject({ action: "ledgeHang" });
    expect(grabbed.fighters[0].combat.helplessMove).toBeNull();
    // Let go after the minimum hang, then up special again.
    const after = run(grabbed, 8, (i) => (i === 5 ? Btn.Down : i === 7 ? Btn.Up | Btn.Special : 0));
    expect(after[5].fighters[0].action).toBe("fall");
    expect(after[7].fighters[0]).toMatchObject({ action: "special", move: "upB" });
  });

  it("is ended by a hit: the fighter reels, then is free to act", () => {
    const start = scene("mario", { action: "specialFall", x: 0, y: fx(20), vy: 0 }, "puncher", { x: 0, facing: 1 });
    start.fighters[0].combat.helplessMove = "upB";
    const frames = run(start, 200, () => 0, (i) => (i === 0 ? Btn.Attack : 0));
    const hit = frames.findIndex((s) => s.fighters[0].action === "hitstun" || s.fighters[0].action === "tumble");
    expect(hit).toBeGreaterThan(0);
    expect(frames[hit].fighters[0].combat.helplessMove).toBeNull();
    const free = frames.findIndex((s, i) => i > hit && (s.fighters[0].action === "fall" || s.fighters[0].action === "tumbleFall"));
    expect(free, "the reel never ended in the air").toBeGreaterThan(hit);
    const [after] = run(frames[free], 1, () => Btn.Up | Btn.Special);
    expect(after.fighters[0]).toMatchObject({ action: "special", move: "upB" });
  });

  it("is ended by a KO", () => {
    const [ko] = run(helpless("mario", { y: fx(-139), vy: -fx(2) }), 1);
    expect(ko.fighters[0].action).toBe("dead");
    expect(ko.fighters[0].combat.helplessMove).toBeNull();
  });

  it("forgets its move however either helpless status is left: a landing's end, a ledge, a hit, a grab, a KO", () => {
    // Each exit is a status change, and both statuses' `end` clears it; the
    // way on into the special landing (`landFromSpecialFall`) carries it over.
    for (const from of ["specialFall", "specialLanding"] as const) {
      for (const to of Object.keys(STATUS_KIND_OF_ACTION) as ActionState[]) {
        const f = helpless("mario", { action: from }).fighters[0];
        changeStatus(f, to);
        expect(f.combat.helplessMove, `${from} to ${to}`).toBeNull();
      }
    }
  });

  it("comes back if the fighter leaves the ground during the special landing", () => {
    // UNVERIFIED for any move: SmashWiki "Helpless" says only of the moves whose
    // helplessness shows on landing that a fighter pushed off "before exiting
    // landing lag" will "retain their helpless state".
    const f = helpless("mario", { action: "specialLanding", charge: 30 }).fighters[0];
    onLeftGround(f);
    expect([f.action, f.combat.helplessMove]).toEqual(["specialFall", "upB"]);
  });

  it("re-simulates identically across a rollback", () => {
    // Drift both ways, and a fast fall on frame 20, after the snapshot on 14.
    const input = (i: number): InputFrame => (i === 20 ? Btn.Down : i % 9 < 5 ? Btn.Right : Btn.Left);
    const live = run(helpless("fox", { vy: fx(0.5) }), 40, input);
    const snapshot = cloneState(live[14]);
    expect(snapshot.fighters[0].action).toBe("specialFall");
    let replay = snapshot;
    let prev: readonly InputFrame[] = [input(14), 0];
    for (let i = 15; i < 40; i++) {
      const now = [input(i), 0];
      replay = step(replay, now, { prevInputs: prev }).state;
      prev = now;
    }
    expect(live[39].fighters[0]).toMatchObject({ action: "specialFall", fastFalling: true });
    expect(hashState(replay)).toBe(hashState(live[39]));
    expect(hashState(cloneState(live[20]))).toBe(hashState(live[20]));
  });
});

describe("landing from special fall", () => {
  for (const def of FIGHTERS) {
    const lag = PUBLISHED[def.id].landingLag;
    it(`costs ${def.id} its up special's published ${lag} frames, then it is free to act`, () => {
      const frames = run(helpless(def.id, { x: 0, y: fx(3), vy: -fx(1) }), lag + 20);
      const landed = frames.findIndex((s) => s.fighters[0].action !== "specialFall");
      expect(frames[landed].fighters[0]).toMatchObject({ action: "specialLanding", grounded: true, charge: lag });
      expect(frames[landed].fighters[0].combat.helplessMove, "carried into the landing").toBe("upB");
      const inLag = frames.filter((s) => s.fighters[0].action === "specialLanding").length;
      expect(inLag).toBe(lag);
      // The landing frame comes before the lag's frame 1, so the lag's last
      // frame hands off, and the fighter acts on frame lag + 1: the page's
      // "Interruptible".
      expect(frames[landed + lag].fighters[0].action).toBe("stand");
      expect(frames[landed + lag].fighters[0].combat.helplessMove).toBeNull();
      const [jumped] = run(frames[landed + lag], 1, () => Btn.Jump);
      expect(jumped.fighters[0].action).toBe("jumpSquat");
      const [early] = run(frames[landed + lag - 2], 1, () => Btn.Jump);
      expect(early.fighters[0].action).toBe("specialLanding");
    });
  }
});
