/**
 * Every fighter's Final Smash, through the real `step()` (Plan 5, Tasks 15–16).
 * The cinematic ones trap with their first hit, land each published hit exactly
 * once and deal their published total; every one of them is spent by use and
 * leaves nobody trapped.
 *
 * Each fighter file quotes its numbers and their sources: the `game_final*`
 * scripts (rubendal Data Viewer 13.0.1) and SmashWiki's Final Smash pages and
 * movesets. The totals and hit counts below are theirs.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { gameFrameOfMotion } from "@/engine/acmd/interpreter";
import { SMASH_BALL_SPAWN_INTERVAL } from "@/engine/constants";
import { FINAL_SMASH_READY } from "@/engine/final";
import { fx, mul, toFloat } from "@/engine/fixed";
import { hashState } from "@/engine/hash";
import { moveFrameOf } from "@/engine/hitbox";
import { kineticClear } from "@/engine/kinetic";
import { STALE_FRESH_BONUS } from "@/engine/knockback";
import { insideSolidBody } from "@/engine/physics";
import { findProjectileDef } from "@/engine/projectile";
import { cloneState, createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { Btn } from "@/engine/types";
import type { ChargedHitbox, FighterDef, FighterState, GameState, Hitbox, InputFrame, MatchRules, MoveSlot, StepEvents } from "@/engine/types";
import { STAGES } from "@/stages";
import { REFERENCE_SCRIPTS } from "./acmd/index";
import { barrage, finalBox } from "./finalKit";
import { FIGHTERS, getFighter } from "./index";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: false };

beforeAll(() => {
  registerFighters(FIGHTERS);
  registerStages(STAGES);
});

/** `user` with the Smash Ball's power, Mario `gap` in front of them, and Fox well behind. */
function ready(user: string, gap: number): GameState {
  const s = createInitialState("finalDestination", [{ defId: user }, { defId: "mario" }, { defId: "fox" }], RULES, 6);
  const xs = [fx(-30), fx(-30 + gap), fx(-75)];
  s.fighters.forEach((f, i) => Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: xs[i], y: 0, facing: i === 0 ? 1 : -1, intangible: 0 }));
  s.fighters[0].finalSmashReady = FINAL_SMASH_READY;
  return s;
}

function run(s0: GameState, frames: number): { states: GameState[]; events: StepEvents[] } {
  let s = s0;
  let prev: InputFrame[] = [0, 0, 0];
  const states: GameState[] = [];
  const events: StepEvents[] = [];
  for (let i = 0; i < frames; i++) {
    const now: InputFrame[] = [i === 0 ? Btn.Special : 0, 0, 0];
    const out = step(s, now, { prevInputs: prev });
    s = out.state;
    prev = now;
    states.push(s);
    events.push(out.events);
  }
  return { states, events };
}

const FRESH = 1.05;

function def(id: string): FighterDef {
  const d = getFighter(id);
  if (d === undefined) throw new Error(`no fighter ${id}`);
  return d;
}

/**
 * Published totals and hit counts (each fighter file quotes them); every hit is
 * a fresh move's. The hits count the trap's own, a 0% one included (Marth's).
 * - Jungle Rush: SmashWiki "Jungle Rush": "a barrage of 31 more rapid punches",
 *   "33 total hits"; "Donkey Kong (SSBU)": "61.9% (maximum)".
 * - Critical Hit: "Marth (SSBU)": "60%"; its dash's catch deals nothing.
 * - Ultra Sword (ruling R-T15e): "Kirby (SSBU)": "3% (stun), 5% (hit 1), 2.5% (hits
 *   2-9), 16% (hit 10)"; "Ultra Sword": "After slicing the opponent nine times, the
 *   sword grows bigger, and Kirby finishes with a powerful tenth blow". The scripts'
 *   3 + 5 + 8 × 2.6 + 16 = 44.8, eleven hits.
 * - Team Star Fox: "Fox (SSBU)": "3% (trapping hit), 30% (lasers), 10% (end)".
 * - Volt Tackle (ruling R-T15h): "Pikachu (SSBU)": "1% (initial hit), 1.5% (loop), 20%
 *   (launch)": the 1% traps (Mario is out of the startup's 0.3% sparks here; UNVERIFIED:
 *   the loop's eight hits, see pikachu.ts).
 */
const CINEMATIC: readonly { id: string; gap: number; total: number; hits: number }[] = [
  { id: "donkeyKong", gap: 18, total: 12 + 18 * 1.2 + 13 * 1.1 + 14, hits: 33 },
  { id: "marth", gap: 60, total: 60, hits: 2 },
  { id: "kirby", gap: 16, total: 3 + 5 + 8 * 2.6 + 16, hits: 11 },
  { id: "fox", gap: 22, total: 3 + 30 + 10, hits: 3 },
  { id: "pikachu", gap: 30, total: 1 + 8 * 1.5 + 20, hits: 10 },
];

/** The slot `f` is in on each frame, `null` when it is in no move. */
const slots = (states: readonly GameState[], port: number): (MoveSlot | null)[] => states.map((s) => (s.fighters[port].action === "special" ? s.fighters[port].move : null));

describe("cinematic Final Smashes", () => {
  for (const { id, gap, total, hits } of CINEMATIC) {
    it(`${id}: traps Mario, stands Fox still through the scene, and lands ${hits} hits for ${total.toFixed(1)}%`, () => {
      const { states, events } = run(ready(id, gap), 520);
      expect(events[0].finalSmashes).toEqual([0]);
      expect(states.some((s) => s.fighters[1].action === "finalTrapped")).toBe(true);
      const scene = states.filter((s) => s.cinematic === 0);
      if (id !== "marth") expect(scene.length).toBeGreaterThan(10);
      for (const s of scene) expect(s.fighters[2].x).toBe(scene[0].fighters[2].x);
      const end = states[states.length - 1];
      // Read before any KO resets it: the most Mario ever had.
      const most = Math.max(...states.map((s) => s.fighters[1].damage));
      expect(toFloat(most)).toBeCloseTo(total * FRESH, 1);
      // Each published hit lands once: a scene box is one frame long (`finalKit.ts`).
      expect(events.flatMap((e) => e.hits).filter((h) => h.attacker === 0 && h.victim === 1)).toHaveLength(hits);
      expect(end.fighters[2].damage).toBe(0);
      expect(end.fighters.every((f) => f.action !== "finalTrapped")).toBe(true);
      expect(end.fighters[0].finalSmashReady).toBe(0);
    });

    it(`${id}: plays its scene and its last blow standing where the trap landed`, () => {
      const { states } = run(ready(id, gap), 520);
      const user = slots(states, 0);
      const scene = states.filter((_, i) => user[i] === "finalAttack" || user[i] === "finalEnd");
      expect(scene.length).toBeGreaterThan(0);
      // A dash that carried the user there (Marth's, Pikachu's) stops dead.
      for (const s of scene) expect(s.fighters[0].x).toBe(scene[0].fighters[0].x);
    });

    it(`${id}: stands everybody else still through its last blow too, until it launches`, () => {
      const { states } = run(ready(id, gap), 520);
      const user = slots(states, 0);
      const ending = user.indexOf("finalEnd");
      expect(ending).toBeGreaterThan(0);
      expect(states[ending - 1].fighters[1].action).toBe("finalTrapped");
      // The end's blow launches Mario out of the trap, and that ends the scene. Only
      // the frames strictly inside the end are pinned: which frame either edge of a
      // scene stills or frees the bystander on is Task 14 fix round 1's (the
      // freeze-edge alignment).
      const launched = states.findIndex((s, i) => i >= ending && s.fighters[1].action !== "finalTrapped");
      expect(launched).toBeGreaterThanOrEqual(ending);
      for (const s of states.slice(ending, launched)) expect(s.cinematic).toBe(0);
      for (const s of states.slice(ending + 1, launched + 1)) expect(s.fighters[2].actionFrame).toBe(states[ending].fighters[2].actionFrame);
      expect(states[launched + 1].cinematic).toBe(-1);
    });
  }

  // Each part's length and its hits' freezes, from the scripts' frames and `Hitlag`
  // multipliers. A freeze of n frames lengthens the part by n − 1 (`framesAfterHit`),
  // n = floor((d × 0.65 + 6) × hitlag), ×1.5 electric (`computeHitlag`), capped at 30,
  // with d the fresh damage (×1.05):
  // - the trap: Jungle Rush's 12% ×5 is 70, capped: 30 (29 after); the reticle's 3%
  //   ×0.4 is 3 (2 after); Ultra Sword's ×0 and Critical Hit's ×0 none; Volt Tackle's
  //   1% initial hit ×0.2 electric 2 (1 after);
  // - the scene: Jungle Rush's 132 frames and 31 punches ×0.4 of 2 frames (1 after
  //   each), 163; Ultra Sword's 110 and 8 slashes ×0.5 of 3 (2 after), 126; Team Star
  //   Fox's 240 and the lasers ×0, 240; Volt Tackle's 70 and 8 dashes ×0.2 electric of
  //   2 (1 after), 78; Critical Hit has none;
  // - the end's launch, on its frame 7, 2, 63, 1 and 10.
  it.each([
    ["donkeyKong", 18, 29, 163, 7],
    ["marth", 60, 0, 0, 2],
    ["kirby", 16, 0, 126, 63],
    ["fox", 22, 2, 240, 1],
    ["pikachu", 30, 1, 78, 10],
  ] as const)("%s, Mario %i ahead: the trap freezes him %i frames after its own, the scene lasts %i, and the end launches on its frame %i", (id, gap, trapFreeze, scene, launch) => {
    const { states } = run(ready(id, gap), 520);
    const trapped = states.findIndex((s) => s.fighters[1].action === "finalTrapped");
    expect(states[trapped].fighters[1].hitlag).toBe(trapFreeze);
    const user = slots(states, 0);
    expect(user.filter((u) => u === "finalAttack")).toHaveLength(scene);
    const ending = user.indexOf("finalEnd");
    const launched = states.findIndex((s, i) => i >= ending && s.fighters[1].action !== "finalTrapped");
    expect(launched - ending + 1).toBe(launch);
  });

  // The scene starts on the start's `nextAt` frame when the trap landed before it:
  // Donkey Kong's FIGHTER_DONKEY_STATUS_FINAL_FLAG_TO_ATTACK on 37, the lock-on's
  // clear on 32, and Ultra Sword's after its 5% swing, whose boxes its script clears on
  // 61 (ruling R-T15e; each quoted in its fighter file).
  it.each([
    ["donkeyKong", 18, 37],
    ["kirby", 16, 61],
    ["fox", 22, 32],
  ] as const)("%s, Mario %i ahead, goes on to its scene on the start's frame %i", (id, gap, nextAt) => {
    const { states } = run(ready(id, gap), 200);
    const user = slots(states, 0);
    const first = user.indexOf("finalAttack");
    expect(first).toBeGreaterThan(0);
    expect(def(id).moves.finalSmash?.final?.nextAt).toBe(nextAt);
    // The start's last frame is the one before `nextAt`.
    const last = states[first - 1].fighters[0];
    expect(last.move).toBe("finalSmash");
    expect(moveFrameOf(last.actionFrame)).toBe(nextAt - 1);
  });

  // Each hit on Mario lands on its script's frame, in its part (the scene boxes on
  // the first frame of their windows, `finalKit.ts`). The traps of the two dashes are
  // left out: where a dash meets him is its UNVERIFIED speed's.
  const DK_BARRAGE = [...Array.from({ length: 18 }, (_, i) => 6 + 4 * i), ...Array.from({ length: 13 }, (_, i) => 79 + 4 * i)];
  const SCENE_HITS: Readonly<Record<string, Partial<Record<MoveSlot, readonly number[]>>>> = {
    donkeyKong: { finalSmash: [29], finalAttack: DK_BARRAGE, finalEnd: [7] },
    marth: { finalEnd: [2] },
    kirby: { finalSmash: [17, 54], finalAttack: [21, 35, 48, 59, 71, 83, 97, 109], finalEnd: [63] },
    fox: { finalSmash: [28], finalAttack: [240], finalEnd: [1] },
    pikachu: { finalAttack: Array.from({ length: 8 }, (_, i) => 6 + 8 * i), finalEnd: [10] },
  };
  it.each(CINEMATIC.map((c) => [c.id, c.gap] as const))("%s, Mario %i ahead: lands each hit on its script's frame", (id, gap) => {
    const { states, events } = run(ready(id, gap), 520);
    const landed: Partial<Record<MoveSlot, number[]>> = {};
    events.forEach((e, i) => {
      const user = states[i].fighters[0];
      for (const h of e.hits) {
        if (h.attacker !== 0 || h.victim !== 1 || user.move === null) continue;
        (landed[user.move] ??= []).push(moveFrameOf(user.actionFrame));
      }
    });
    for (const [slot, frames] of Object.entries(SCENE_HITS[id])) expect(landed[slot as MoveSlot], `${id} ${slot}`).toEqual(frames);
  });
});

/**
 * Each finishing blow's published numbers (each fighter file quotes them), and the
 * `set_force_reaction` its script sets (Fox's ATTACK_ABS sets none): Jungle Rush's
 * uppercut, `game_finalend`; Critical Hit's strike, `game_finalend`; Ultra Sword's
 * last slash, `game_finalattack` 173; Team Star Fox's end, `game_finalend`; Volt
 * Tackle's blast, `game_final2`.
 */
const END_BOXES: Readonly<Record<string, { damage: number; angle: number; kbg: number; bkb: number; fkb: number; forceReaction: boolean }>> = {
  donkeyKong: { damage: 14, angle: 70, kbg: 96, bkb: 90, fkb: 0, forceReaction: true },
  marth: { damage: 60, angle: 361, kbg: 120, bkb: 120, fkb: 0, forceReaction: true },
  kirby: { damage: 16, angle: 45, kbg: 95, bkb: 75, fkb: 0, forceReaction: true },
  fox: { damage: 10, angle: 55, kbg: 144, bkb: 70, fkb: 0, forceReaction: false },
  pikachu: { damage: 20, angle: 70, kbg: 82, bkb: 70, fkb: 0, forceReaction: true },
};

describe("each finishing blow", () => {
  it.each(CINEMATIC.map((c) => c.id))("%s's carries its script's damage, angle, knockback and force reaction", (id) => {
    const [hb] = def(id).moves.finalEnd!.hitboxes;
    expect({
      damage: toFloat(hb.damage),
      angle: toFloat(hb.angle),
      kbg: toFloat(hb.knockbackGrowth),
      bkb: toFloat(hb.baseKnockback),
      fkb: toFloat(hb.fixedKnockback ?? 0),
      forceReaction: hb.forceReaction === true,
    }).toEqual(END_BOXES[id]);
  });
});

/**
 * Each part's published length, its motion's CancelFrame − 1 in game frames through
 * its FT_MOTION_RATE (`gameFrameOfMotion`; each fighter file quotes them):
 * - Jungle Rush's final_start 97, and final_end 70, game frame 62 at its 0.8 from 30
 *   (ruling R-T15i);
 * - Critical Hit's dash to 70 (UNVERIFIED) and final_dash_end 85, 48 game frames at
 *   its 0.6 and 0.5; final_end 60;
 * - Ultra Sword's final_start 87; final_attack's 219, less its 110-frame scene;
 * - Team Star Fox's final_lock_on 85; final_end 66, game frame 57 at its 0.85;
 * - Volt Tackle's dash to 83 (UNVERIFIED) and final_dash_end 78, 55 game frames at its
 *   0.7; final2 80.
 * In the air (`MoveDef.aerialTotalFrames`): Jungle Rush's final_air_end 47, Critical
 * Hit's final_air_end 50, Team Star Fox's final_air_end 47, Volt Tackle's final_air2 37.
 */
const LENGTHS: Readonly<Record<string, { start: number; end: number; airEnd?: number }>> = {
  donkeyKong: { start: 96, end: 61, airEnd: 46 },
  marth: { start: 118, end: 59, airEnd: 49 },
  kirby: { start: 86, end: 108 },
  fox: { start: 84, end: 56, airEnd: 46 },
  pikachu: { start: 138, end: 79, airEnd: 36 },
};

describe("each part's length", () => {
  it.each(CINEMATIC.map((c) => c.id))("%s's parts are their published lengths, on the ground and in the air", (id) => {
    const { moves } = def(id);
    expect(moves.finalSmash!.totalFrames).toBe(LENGTHS[id].start);
    expect(moves.finalEnd!.totalFrames).toBe(LENGTHS[id].end);
    expect(moves.finalEnd!.aerialTotalFrames).toBe(LENGTHS[id].airEnd);
  });

  it("plays Jungle Rush's end, begun and ended in the air, to its final_air_end's frame 46", () => {
    // High over Final Destination, Mario in front: the scene holds Donkey Kong where it
    // began, and he is still airborne when his end could end. His start holds him there
    // too (fix round 2, ruling R-T16j), so Mario is held in front of him until trapped.
    const s = ready("donkeyKong", 18);
    Object.assign(s.fighters[0], { action: "fall", grounded: false, platform: -1, y: fx(150) });
    Object.assign(s.fighters[1], { action: "fall", grounded: false, platform: -1, y: fx(150) });
    const { states } = runHeld(s, 400, inFront);
    const user = slots(states, 0);
    const last = user.lastIndexOf("finalEnd");
    expect(last).toBeGreaterThan(0);
    expect(states[last].fighters[0].grounded).toBe(false);
    expect(moveFrameOf(states[last].fighters[0].actionFrame)).toBe(46);
    expect(user[last + 1]).toBeNull();
  });

  for (const { id, gap } of CINEMATIC) {
    it(`${id}: plays its end to its frame ${LENGTHS[id].end}, and is done`, () => {
      const { states } = run(ready(id, gap), 520);
      const user = slots(states, 0);
      const last = user.lastIndexOf("finalEnd");
      expect(last).toBeGreaterThan(0);
      expect(moveFrameOf(states[last].fighters[0].actionFrame)).toBe(LENGTHS[id].end);
      expect(user[last + 1]).toBeNull();
    });
  }
});

/** Final Destination's main platform's right edge, where a cliff stop puts its fighter. */
const FD_STAGE = STAGES.find((st) => st.id === "finalDestination")!;
const FD_FLOOR = FD_STAGE.platforms[0];
const EDGE = FD_FLOOR.x + FD_FLOOR.halfWidth;

/** `id`'s Final Smash on Final Destination with Mario and Fox far behind it: a whiff. */
function whiff(id: string, frames: number, special: (i: number) => boolean = () => false): { states: GameState[]; events: StepEvents[] } {
  const s = ready(id, 0);
  Object.assign(s.fighters[1], { x: fx(-70) });
  Object.assign(s.fighters[2], { x: fx(-80) });
  let st = s;
  let prev: InputFrame[] = [0, 0, 0];
  const states: GameState[] = [];
  const events: StepEvents[] = [];
  for (let i = 0; i < frames; i++) {
    const now: InputFrame[] = [i === 0 || special(i) ? Btn.Special : 0, 0, 0];
    const out = step(st, now, { prevInputs: prev });
    st = out.state;
    prev = now;
    states.push(st);
    events.push(out.events);
  }
  return { states, events };
}

describe("a cinematic Final Smash that traps nobody", () => {
  for (const { id } of CINEMATIC) {
    it(`${id}: plays its start and no scene, and takes no ledge`, () => {
      const { states } = whiff(id, 260);
      const user = slots(states, 0);
      expect(states.every((st) => st.cinematic === -1)).toBe(true);
      expect(states.some((st) => st.fighters.some((f) => f.action === "finalTrapped"))).toBe(false);
      expect(user.includes("finalAttack") || user.includes("finalEnd")).toBe(false);
      expect(states[0].fighters[0].finalSmashReady).toBe(0);
      expect(states.some((st) => st.fighters[0].action === "ledgeHang")).toBe(false);
    });
  }

  it.each(["donkeyKong", "kirby", "fox"])("%s: plays its whole start in place", (id) => {
    const { states } = whiff(id, 200);
    const user = slots(states, 0);
    expect(user.filter((u) => u === "finalSmash")).toHaveLength(LENGTHS[id].start);
    for (const st of states) expect(st.fighters[0].x).toBe(fx(-30));
  });

  // SmashWiki "Critical Hit" (https://www.ssbwiki.com/Critical_Hit): "On the ground, the
  // initial dash will follow the platform's contours, and the move will end without the
  // user swinging if they reach the edge" (ruling R-T15f).
  it("marth: stops at the edge, ends the dash there, and plays out its end on the stage", () => {
    const { states } = whiff("marth", 260);
    const user = slots(states, 0);
    expect(states.every((st) => st.fighters[0].action !== "dead")).toBe(true);
    const last = user.lastIndexOf("finalSmash");
    expect(states[last].fighters[0]).toMatchObject({ x: EDGE, grounded: true });
    expect(moveFrameOf(states[last].fighters[0].actionFrame)).toBe(LENGTHS.marth.start);
    // The dash ended at the edge: what is left is final_dash_end's 48 frames.
    const atEdge = states.findIndex((st) => st.fighters[0].x === EDGE);
    expect(last - atEdge + 1).toBeLessThanOrEqual(48);
    expect(user.filter((u) => u === "finalSmash").length).toBeLessThan(LENGTHS.marth.start);
  });

  // SmashWiki "Volt Tackle" (https://www.ssbwiki.com/Volt_Tackle): "the tackle ignores
  // edges, meaning it is fairly easy to self-destruct off the side blast line if the
  // player misses" (ruling R-T15g).
  it("pikachu: stands through its startup, then tackles off the stage and ends in the air or KO'd", () => {
    const { states } = whiff("pikachu", 260);
    for (const st of states.slice(0, 46)) expect(st.fighters[0].x).toBe(fx(-30));
    expect(states.some((st) => st.fighters[0].x > EDGE + fx(10))).toBe(true);
    const end = states[states.length - 1].fighters[0];
    expect(end.action === "dead" || end.action === "respawnPlatform" || !end.grounded || end.stocks < 3).toBe(true);
  });
});

describe("Critical Hit's dash (ruling R-T15f)", () => {
  // SmashWiki "Marth (SSBU)" (https://www.ssbwiki.com/Marth_(SSBU)): "Pressing the
  // special button again will cause him to stop mid-dash."
  it("stops mid-dash where the special button is pressed again, and plays out its end there", () => {
    const { states } = whiff("marth", 200, (i) => i === 34);
    const user = slots(states, 0);
    const stopX = states[34].fighters[0].x;
    expect(stopX).toBeGreaterThan(fx(-30));
    expect(stopX).toBeLessThan(EDGE);
    for (const [i, st] of states.entries()) if (i >= 34 && user[i] === "finalSmash") expect(st.fighters[0].x).toBe(stopX);
    expect(moveFrameOf(states[user.lastIndexOf("finalSmash")].fighters[0].actionFrame)).toBe(LENGTHS.marth.start);
  });

  // The edge rule is the dash's: a Marth running into his Final Smash slides off the
  // edge in its startup (a special keeps its own movement, `GROUND_EXIT`), and his dash
  // then goes on in the air.
  it("leaves the edge rule to the dash: a running start slides off, and the dash goes on in the air", () => {
    const s = createInitialState("finalDestination", [{ defId: "marth" }, { defId: "mario" }], RULES, 6);
    s.fighters.forEach((f, i) => Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(i === 0 ? 40 : -70), y: 0, facing: i === 0 ? 1 : -1, intangible: 0 }));
    s.fighters[0].finalSmashReady = FINAL_SMASH_READY;
    let st = s;
    let prev: InputFrame[] = [0, 0];
    const states: GameState[] = [];
    for (let i = 0; i < 60; i++) {
      // Run right for 20 steps, then the Final Smash.
      const now: InputFrame[] = [i < 20 ? Btn.Right : i === 20 ? Btn.Special : 0, 0];
      st = step(st, now, { prevInputs: prev }).state;
      prev = now;
      states.push(st);
    }
    expect(states[20].fighters[0].move).toBe("finalSmash");
    expect(states.some((x) => x.fighters[0].move === "finalSmash" && !x.fighters[0].grounded && x.fighters[0].x > EDGE + fx(20))).toBe(true);
  });

  // The same page: "In the air, the user will travel at high speed directly forward."
  it("goes straight on past the edge in the air", () => {
    const s = ready("marth", 0);
    Object.assign(s.fighters[0], { action: "fall", grounded: false, platform: -1, x: fx(40), y: fx(60) });
    Object.assign(s.fighters[1], { x: fx(-70) });
    Object.assign(s.fighters[2], { x: fx(-80) });
    const { states } = run(s, 120);
    expect(states.some((st) => slots([st], 0)[0] === "finalSmash" && st.fighters[0].x > EDGE + fx(20))).toBe(true);
  });
});

describe("Volt Tackle's startup (ruling R-T15h)", () => {
  // SmashWiki "Pikachu (SSBU)": "0.3% (6 hits during startup), 1% (initial hit)", and
  // "Surrounds itself with electricity before dashing forwards": the startup's 0.3%
  // sparks are ordinary hits, and the 1% the dash opens with traps.
  it("hits a fighter beside it six times in place, then traps it with the 1% on frame 47", () => {
    // Mario 4 ahead, inside both sparks' capsules; each spark's own small push (FKB 20,
    // away from Pikachu) leaves him in them through the sixth.
    const { states, events } = run(ready("pikachu", 4), 120);
    const sparks: number[] = [];
    events.forEach((e, i) => {
      const pika = states[i].fighters[0];
      for (const h of e.hits) if (h.attacker === 0 && h.victim === 1 && pika.move === "finalSmash") sparks.push(moveFrameOf(pika.actionFrame));
    });
    expect(sparks).toEqual([10, 16, 22, 28, 34, 40, 47]);
    const trapped = states.findIndex((st) => st.fighters[1].action === "finalTrapped");
    expect(moveFrameOf(states[trapped].fighters[0].actionFrame)).toBe(47);
    for (const st of states.slice(0, trapped)) expect(st.fighters[0].x).toBe(fx(-30));
    // Each spark is a hit, not a trap: Mario reels from them, out of the trap until 47.
    expect(states.slice(0, trapped).some((st) => st.fighters[1].hitstun > 0)).toBe(true);
  });
});

describe("a start's boxes", () => {
  // Every start box of the five is ATTACK_SETOFF_KIND_OFF in its script (rubendal
  // Data Viewer 13.0.1: `game_finalstart`, `game_finaldash`, `game_finallockon`,
  // `game_final`; each fighter file quotes it), so a trap box clanks with nothing:
  // `Hitbox.transcendent`. The scene's and the end's never clank (Task 14).
  it.each(CINEMATIC.map((c) => c.id))("%s's trap boxes are transcendent, as their script's", (id) => {
    const boxes = def(id).moves.finalSmash!.hitboxes;
    expect(boxes.length).toBeGreaterThan(0);
    for (const hb of boxes) expect(hb.transcendent, `${id} finalSmash hitbox ${hb.id}`).toBe(true);
  });
});

describe("the scene's hits land once each", () => {
  // A scene box reaches its trapped wherever they are and keeps no hit record, so
  // a box live n frames would land n times (Task 14): every one is a single frame. So
  // is a start's box that hits rather than traps (`Hitbox.trap` false, ruling R-T15j),
  // which keeps no hit record either.
  it.each(CINEMATIC.map((c) => c.id))("%s's scene, last blow and start hits are one-frame boxes", (id) => {
    const fighter = def(id);
    for (const slot of ["finalAttack", "finalEnd"] as const) {
      const move = fighter.moves[slot];
      if (move === undefined) continue;
      expect(move.hitboxes.length, `${id} ${slot}`).toBeGreaterThan(0);
      for (const hb of move.hitboxes) expect(hb.endFrame, `${id} ${slot} hitbox ${hb.id}`).toBe(hb.startFrame);
    }
    for (const hb of fighter.moves.finalSmash!.hitboxes) if (hb.trap === false) expect(hb.endFrame, `${id} finalSmash hitbox ${hb.id}`).toBe(hb.startFrame);
  });

  it("gives Ultra Sword's 5% swing and Volt Tackle's sparks no trap, and every other start box one", () => {
    const hits = (id: string) => def(id).moves.finalSmash!.hitboxes.filter((hb) => hb.trap === false).map((hb) => [hb.startFrame, hb.damage]);
    expect(hits("kirby")).toEqual([[54, fx(5)]]);
    expect(hits("pikachu")).toEqual([10, 16, 22, 28, 34, 40].flatMap((f) => [[f, fx(0.3)], [f, fx(0.3)]]));
    for (const id of ["donkeyKong", "marth", "fox"]) expect(hits(id), id).toEqual([]);
  });
});

describe("Jungle Rush's detection punch is a capsule (Plan 5, ruling P5-R19)", () => {
  // `game_finalstart`: radius 13 from 8 to 28 ahead, 10 up. Mario 36 ahead is past
  // the near end's reach and inside the far end's.
  it("traps Mario where only its far end reaches", () => {
    const { states } = run(ready("donkeyKong", 36), 120);
    expect(states.some((s) => s.fighters[1].action === "finalTrapped")).toBe(true);
  });
});

// SmashWiki "Unblockable attack" (https://www.ssbwiki.com/Unblockable_attack): an
// unblockable attack "cannot be defended against with a shield or a counterattack", and
// "in Ultimate, all Final Smashes are unblockable" (Task 14; the Task 5 carry cites it
// rather than leaving it UNVERIFIED).
describe("Jungle Rush against Marth's Counter: a Final Smash is not countered", () => {
  it("traps the countering Marth, and the scene plays", () => {
    const s = createInitialState("finalDestination", [{ defId: "donkeyKong" }, { defId: "marth" }], RULES, 6);
    s.fighters.forEach((f, i) => Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(i === 0 ? -30 : -12), y: 0, facing: i === 0 ? 1 : -1, intangible: 0 }));
    s.fighters[0].finalSmashReady = FINAL_SMASH_READY;
    // The detection punch is out on frames 29-34; Marth's window is 6-27 of his counter.
    let st = s;
    let prev: InputFrame[] = [0, 0];
    const states: GameState[] = [];
    const counters: number[] = [];
    for (let i = 0; i < 200; i++) {
      const now: InputFrame[] = [i === 0 ? Btn.Special : 0, i === 14 ? Btn.Down | Btn.Special : 0];
      const out = step(st, now, { prevInputs: prev });
      st = out.state;
      prev = now;
      states.push(st);
      counters.push(out.events.counters.length);
    }
    expect(states.some((x) => x.fighters[1].move === "downB")).toBe(true);
    expect(counters.every((n) => n === 0)).toBe(true);
    expect(states.some((x) => x.fighters[1].action === "finalTrapped")).toBe(true);
    expect(states.some((x) => x.cinematic === 0)).toBe(true);
  });
});

describe("Final Smashes that are not cinematics", () => {
  it("Mario Finale: the flames hit again and again, hotter as they go, and trap nobody", () => {
    const { states, events } = run(ready("mario", 45), 240);
    // Seven frames between hits: the flame's rehit.
    const onMario = events.flatMap((e) => e.hits).filter((h) => h.victim === 1);
    // SmashWiki "Mario (SSBU)/Final Smash": the flames, out on frame 5, first
    // hit on frame 65 ("Early hits 65-104"); event i is game frame i + 1.
    const first = events.findIndex((e) => e.hits.some((h) => h.victim === 1));
    expect(first + 1).toBe(65);
    expect(onMario.length).toBeGreaterThan(5);
    const damages = new Set(onMario.map((h) => Math.round(toFloat(h.damage) * 100)));
    // 2.5% early, then the hotter stages; a projectile is never staled (or freshened).
    expect(damages.has(250)).toBe(true);
    expect(damages.has(300)).toBe(true);
    expect(damages.has(350)).toBe(true);
    expect(states.every((s) => s.cinematic === -1 && s.fighters[1].action !== "finalTrapped")).toBe(true);
  });

  it("Zero Laser: the beam hits every 10 frames along its length", () => {
    // Mario 90 ahead, the plan's. The beam's 20° carries him along it, past Final
    // Destination's edge (80). Before fix round 1 he dropped out of it there, and this
    // test had him at 50 (the review's M8): the cause was the unmodelled `samus_laser2`,
    // whose fringe beams (325° above, 45° below) hold a fighter in the beam ("Fighters
    // are drawn to the center"). With them (ruling R-T16e) he stays in it, past the edge,
    // for 11 beam hits in 300 steps. The beam's own hits: the fringe beams strike on
    // records of their own.
    const beam = def("samus").moves.finalSmash!.hitboxes.find((hb) => toFloat(hb.damage) === 1.5)!.id;
    const { events } = run(ready("samus", 90), 300);
    const onMario = events.flatMap((e, i) => e.hits.filter((h) => h.victim === 1 && h.hitboxId === beam).map(() => i));
    expect(onMario.length).toBeGreaterThan(8);
    const gaps = onMario.slice(1).map((f, i) => f - onMario[i]);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(10);
  });

  it("Ancient Bow and Arrow: the first fighter in line takes 35%, the one behind nothing", () => {
    const s = ready("link", 50);
    // Fox stands further along the same line, behind Mario.
    s.fighters[2].x = fx(60);
    const { events } = run(s, 140);
    const hits = events.flatMap((e) => e.hits);
    const onMario = hits.filter((h) => h.victim === 1);
    expect(onMario).toHaveLength(1);
    expect(toFloat(onMario[0].damage)).toBeCloseTo(35, 1);
    expect(hits.filter((h) => h.victim === 2)).toHaveLength(0);
  });
});

describe("the Smash Ball's power", () => {
  it("is not lost to time: a Final Smash ready stays ready until used", () => {
    const s = ready("mario", 40);
    let st = s;
    let prev: InputFrame[] = [0, 0, 0];
    for (let i = 0; i < 1200; i++) {
      st = step(st, [0, 0, 0], { prevInputs: prev }).state;
      prev = [0, 0, 0];
    }
    expect(st.fighters[0].finalSmashReady).toBe(FINAL_SMASH_READY);
  });
});

/**
 * `run`, with `place` shaping a copy of each state before the step that follows it
 * (a fighter held where a test wants it), and `keys` each step's buttons.
 */
function runHeld(
  s0: GameState,
  frames: number,
  place: (s: GameState) => void,
  keys: (i: number) => InputFrame[] = (i) => [i === 0 ? Btn.Special : 0, 0, 0],
): { states: GameState[]; events: StepEvents[] } {
  let s = s0;
  let prev: InputFrame[] = keys(0).map(() => 0);
  const states: GameState[] = [];
  const events: StepEvents[] = [];
  for (let i = 0; i < frames; i++) {
    s = cloneState(s);
    place(s);
    const now = keys(i);
    const out = step(s, now, { prevInputs: prev });
    s = out.state;
    prev = now;
    states.push(s);
    events.push(out.events);
  }
  return { states, events };
}

/** Hold `f` still at (x, y) in the air, whatever its launch would do. */
function hold(f: FighterState, x: number, y: number): void {
  Object.assign(f, { x, y, grounded: false, platform: -1, ledge: null });
  kineticClear(f);
}

/** Port 1 held 18 in front of port 0, at its height, until a Final Smash traps it. */
function inFront(s: GameState): void {
  const victim = s.fighters[1];
  if (victim.action !== "finalTrapped" && s.fighters[0].move === "finalSmash") hold(victim, s.fighters[0].x + fx(18), s.fighters[0].y);
}

/** The frames (event index + 1) and damages of every hit on port 1. */
const hitsOnPort1 = (events: readonly StepEvents[]) =>
  events.flatMap((e, i) => e.hits.filter((h) => h.victim === 1).map((h) => ({ frame: i + 1, damage: toFloat(h.damage), angle: Math.round(toFloat(h.angle)) })));

/**
 * The beams' rehits (Plan 5, Task 16). SmashWiki "Hitbox" (https://www.ssbwiki.com/Hitbox):
 * a rehit rate, "If not 0, allows the hitbox to strike again after the specified amount
 * of frames", counted from each strike (`hitbox.ts`, `markHit`).
 */
describe("the beams strike a fighter held in them again at their rehit", () => {
  // SmashWiki "Mario (SSBU)/Final Smash" (https://www.ssbwiki.com/Mario_(SSBU)/Final_Smash):
  // "Fireballs generated 5", "Early hits 65-104 (rehit rate: 7)", "Mid hits 105-154",
  // "Late hits 155-224"; 2.5%, 3.0% and 3.5%. Held in the flames from their first hit, a
  // fighter is struck on 65, 72, … 219: six early, seven mid and ten late hits, 71%, the
  // published total (SmashWiki "Mario Finale", https://www.ssbwiki.com/Mario_Finale: "now
  // dealing about 75%"). A projectile's hit is neither staled nor freshened.
  it("Mario Finale: every 7 frames from 65, 23 hits for 71%", () => {
    const { events } = runHeld(ready("mario", 45), 240, (s) => {
      const flame = s.projectiles.find((p) => p.defId === "hugeFlame");
      if (flame !== undefined) hold(s.fighters[1], flame.x, flame.y);
    });
    const hits = hitsOnPort1(events);
    expect(hits.map((h) => h.frame)).toEqual(Array.from({ length: 23 }, (_, k) => 65 + 7 * k));
    expect(hits.map((h) => h.damage)).toEqual([...Array<number>(6).fill(2.5), ...Array<number>(7).fill(3), ...Array<number>(10).fill(3.5)]);
    expect(hits.reduce((n, h) => n + h.damage, 0)).toBe(71);
  });

  // The same page's hitbox table: the mid and late flames have an air box (`g=f`: 23°,
  // BKB 20, KBG 90; late 23°, BKB 10, KBG 120) and a ground box (`a=f`: 50°, BKB 15, KBG
  // 100; late 50°, BKB 5, KBG 130); the early one hits both at 50°.
  it("Mario Finale: its mid and late flames launch a grounded fighter at 50° and an airborne one at 23°", () => {
    const angles = (grounded: boolean): number[] => {
      const { events } = runHeld(ready("mario", 45), 240, (s) => {
        const flame = s.projectiles.find((p) => p.defId === "hugeFlame");
        if (flame === undefined) return;
        hold(s.fighters[1], flame.x, grounded ? 0 : flame.y);
        if (grounded) Object.assign(s.fighters[1], { grounded: true, platform: 0 });
      });
      return hitsOnPort1(events).map((h) => h.angle);
    };
    expect(angles(false)).toEqual([...Array<number>(6).fill(50), ...Array<number>(17).fill(23)]);
    expect(angles(true)).toEqual(Array<number>(23).fill(50));
  });

  // rubendal Data Viewer 13.0.1 (https://rubendal.github.io/ssbu/data/patch/13.0.1/character/Samus/data.json),
  // `samus_laser` `Shoot`: the beam, 1.5% `Rehit=10`, for 128 frames from 12; then, its
  // record cleared (`clear_all` on 140), its end, 5.5%. After `final_start`'s 69 frames
  // (fix round 1, ruling R-T16c) the laser's frame f is the move's 69 + f. Held in the
  // beam, a fighter is struck on the move's 81, 91, … 201, thirteen times, each a fresh
  // move's (×1.05), and by the end on 209, the laser's 140 (ruling R-T16d).
  it("Zero Laser: every 10 of its frames from the laser's 12, 13 hits, then its end on the laser's 140", () => {
    const { states, events } = runHeld(ready("samus", 90), 400, (s) => hold(s.fighters[1], s.fighters[0].x + fx(90), 0));
    const main = (id: number) =>
      events.flatMap((e, i) => e.hits.filter((h) => h.victim === 1 && h.hitboxId === id).map((h) => [moveFrameOf(states[i].fighters[0].actionFrame), toFloat(h.damage)]));
    const [beam, end] = [9, 10];
    expect(main(beam).map(([f]) => f)).toEqual(Array.from({ length: 13 }, (_, k) => 81 + 10 * k));
    for (const [, d] of main(beam)) expect(d).toBeCloseTo(1.5 * FRESH, 2);
    expect(main(end)).toEqual([[209, toFloat(mul(fx(5.5), STALE_FRESH_BONUS))]]);
  });
});

/**
 * A rehit lives in the hit record the state hashes and clones (`hitbox.ts`,
 * `recordMark`): re-simulated from any snapshot, the beams and the arrow replay hash
 * for hash, across their re-arms (Plan 5, Task 16).
 */
describe("the three roll back across their rehits", () => {
  it.each([
    ["mario", 45, 240, [4, 64, 65, 70, 71, 72, 110, 160]],
    ["samus", 50, 200, [0, 11, 12, 20, 21, 22, 60, 150]],
    ["link", 50, 140, [0, 59, 60, 65, 66]],
  ] as const)("%s's, Mario %i ahead, from every snapshot", (user, gap, frames, at) => {
    const { states } = run(ready(user, gap), frames);
    for (const k of at) {
      let s = cloneState(states[k]);
      // The keys of step k, as `run` pressed them: the special on step 0 alone.
      let prev: InputFrame[] = [k === 0 ? Btn.Special : 0, 0, 0];
      for (let i = k + 1; i < frames; i++) {
        s = step(s, [0, 0, 0], { prevInputs: prev }).state;
        prev = [0, 0, 0];
        expect(hashState(s), `snapshot ${k}, step ${i}`).toBe(hashState(states[i]));
      }
    }
  });
});

/**
 * Each part's published length (Plan 5, Task 16). Mario's: SmashWiki "Mario
 * (SSBU)/Final Smash", "Interruptible (grounded) 157", "Interruptible (aerial) 147".
 * Link's: rubendal Data Viewer 13.0.1 (…/character/Link/data.json), `final`'s
 * CancelFrame 111 under `game_final`'s FT_MOTION_RATE(FSM=0.85) from frame 70, and
 * `final_air`'s 100 (`game_finalair` sets no rate). Samus's: the laser's 148 frames
 * (`samus_laser` `Shoot`: 12, 128 and 8) and `final_end`'s CancelFrame 47 (UNVERIFIED:
 * that the end starts as the laser ends; her `final_start` and `final` motions publish
 * no CancelFrame).
 */
describe("the three's lengths", () => {
  it.each([
    ["mario", 156, 146],
    ["link", gameFrameOfMotion(REFERENCE_SCRIPTS.link.scripts.game_final, 111) - 1, 99],
    // Fix round 1 (ruling R-T16c): `final_start`'s 69 frames lead it. In the air the same
    // (M7): `final_air_end`'s CancelFrame 64 under FT_MOTION_RATE(FSM=0.5) from 30 is
    // game frame 30 + 34 × 0.5 = 47, `final_end`'s 47, so no air length of its own.
    ["samus", 263, undefined],
  ] as const)("%s's Final Smash lasts %i frames, and %s in the air", (id, total, air) => {
    expect(def(id).moves.finalSmash!.totalFrames).toBe(total);
    expect(def(id).moves.finalSmash!.aerialTotalFrames).toBe(air);
  });

  it("puts Link's on game frame 105, the motion's 111", () => {
    expect(def("link").moves.finalSmash!.totalFrames).toBe(104);
  });
});

/**
 * The three's boxes, as their scripts publish them (rubendal Data Viewer 13.0.1;
 * each fighter file quotes them): first and last frame, damage, angle, KBG, BKB, FKB,
 * radius, hitlag, clang (`ATTACK_SETOFF_KIND_OFF`: transcendent), effect and
 * `set_force_reaction`.
 * - Mario Finale, `mario_hugeflame` `Regular`: 60-219 of the flames' age, 2.5%, 50°,
 *   KBG 40, BKB 25, radius 16, hitlag ×0, fire; the mid and late stages' numbers
 *   are the stage test's (`projectile.test.ts`) and the angles test's above.
 * - Zero Laser, `game_final` and `samus_laser` `Shoot`: the muzzle's 1% and 2%, the
 *   beam's 1.5% and its end's 5.5%, electric, with `set_force_reaction`.
 * - The Ancient Arrow, `link_ancientbowarrow` `Stick` on its `Fly` box (radius 5, 4
 *   ahead): 35%, 60°, KBG 46, BKB 102, hitlag ×0.3, with `set_force_reaction`.
 */
describe("the three's boxes carry their scripts' numbers", () => {
  const row = (hb: Hitbox) => [
    hb.startFrame,
    hb.endFrame,
    toFloat(hb.damage),
    toFloat(hb.angle),
    toFloat(hb.knockbackGrowth),
    toFloat(hb.baseKnockback),
    toFloat(hb.fixedKnockback ?? 0),
    toFloat(hb.radius),
    // Q12, as authored: fx(0.3) is not 0.3 in float.
    hb.hitlagMultiplier ?? fx(1),
    hb.transcendent === true,
    hb.effect ?? "normal",
    hb.forceReaction === true,
  ];

  it("Mario Finale's flames", () => {
    const [flame] = def("mario").moves.finalSmash!.projectiles!;
    expect([flame.id, flame.spawnFrame, flame.lifetime, flame.rehit, flame.destroyOnHit]).toEqual(["hugeFlame", 5, 220, 7, false]);
    expect(row(flame.hitbox)).toEqual([60, 219, 2.5, 50, 40, 25, 0, 16, fx(0), true, "fire", false]);
    const stage = (h: ChargedHitbox | undefined) => (h === undefined ? undefined : [h.damage, h.angle, h.knockbackGrowth, h.baseKnockback].map((v) => toFloat(v ?? 0)));
    expect(flame.stages!.map((st) => [st.from, stage(st.hitbox), stage(st.ground)])).toEqual([
      [100, [3, 23, 90, 20], [3, 50, 100, 15]],
      [150, [3.5, 23, 120, 10], [3.5, 50, 130, 5]],
    ]);
  });

  // Fix round 1 (rulings R-T16c to R-T16e): `game_finalstart`'s charge (1%, `Rehit=10`,
  // electric) and its two pulls (0%, FKB 30, flinchless: 18° from 15 behind, radius 20,
  // and 366° 17 ahead, radius 30, loaded at 367, P5-R18's stand-in), each pull a frame
  // at a time on 48, 58 and 68, its `Rehit=10`; then the laser from the move's 70, its
  // muzzle `Rehit=8`, its end none; `samus_laser2`'s two fringe beams (0.5%, `Rehit=8`,
  // 325° above and 45° below, FKB 20 and 24, radius 6) from the laser's 17 and their
  // blasts (2.5%, 45°, KBG 183, BKB 95, radius 12.5, electric, `set_force_reaction`) on
  // its 140, each fringe on a record of its own (`Hitbox.part` 1 and 2).
  it("Zero Laser's start, muzzle, beam, end, fringe beams and blasts", () => {
    const zero = def("samus").moves.finalSmash!;
    const pulls = (f: number) => [
      [f, f, 0, 18, 100, 0, 30, 20, fx(0), true, "normal", false],
      [f, f, 0, 367, 100, 0, 30, 30, fx(0), true, "normal", false],
    ];
    expect([...zero.hitboxes].sort((a, b) => a.id - b.id).map(row)).toEqual([
      [48, 68, 1, 18, 100, 0, 12, 10, fx(0), true, "electric", false],
      ...[48, 58, 68].map((f) => pulls(f)[0]),
      ...[48, 58, 68].map((f) => pulls(f)[1]),
      [70, 76, 1, 20, 100, 0, 22, 13, fx(0), true, "normal", false],
      [77, 80, 2, 20, 100, 0, 22, 15, fx(0), true, "normal", false],
      [81, 208, 1.5, 20, 100, 0, 16, 5, fx(1), true, "normal", false],
      [209, 216, 5.5, 361, 183, 45, 0, 11, fx(1), true, "electric", true],
      [86, 208, 0.5, 325, 100, 0, 20, 6, fx(1), true, "normal", false],
      [86, 208, 0.5, 45, 100, 0, 24, 6, fx(1), true, "normal", false],
      [209, 216, 2.5, 45, 183, 95, 0, 12.5, fx(1), true, "electric", true],
      [209, 216, 2.5, 45, 183, 95, 0, 12.5, fx(1), true, "electric", true],
    ]);
    const byId = (id: number) => zero.hitboxes.find((hb) => hb.id === id)!;
    // Where they are, their records, their rehits and the windboxes.
    expect(Array.from({ length: 15 }, (_, id) => [toFloat(byId(id).x), toFloat(byId(id).y), byId(id).part ?? 0, byId(id).rehit, byId(id).windbox === true])).toEqual([
      [17, 13, 0, undefined, false],
      [-15, 13, 0, undefined, true],
      [-15, 13, 0, undefined, true],
      [-15, 13, 0, undefined, true],
      [17, 13, 0, undefined, true],
      [17, 13, 0, undefined, true],
      [17, 13, 0, undefined, true],
      [20, 15, 0, 8, false],
      [20, 15, 0, 8, false],
      [12, 9, 0, undefined, false],
      [12, 9, 0, 0, false],
      [12, 23, 1, 8, false],
      [12, -5, 2, 8, false],
      [12, 23, 1, 0, false],
      [12, -5, 2, 0, false],
    ]);
    for (const id of [9, 10, 11, 12, 13, 14]) expect(toFloat(byId(id).x2!), `box ${id}`).toBe(162);
    expect([zero.rehit, zero.clearAt]).toEqual([10, [69, 77, 81, 209]]);
  });

  it("the Ancient Arrow", () => {
    const [arrow] = def("link").moves.finalSmash!.projectiles!;
    expect([arrow.id, arrow.spawnFrame, arrow.destroyOnHit, toFloat(arrow.hitbox.x)]).toEqual(["ancientArrow", 60, true, 4]);
    // Hitlag ×0, its script's `DisableHitlag=true` (fix round 1, ruling R-T16h; SmashWiki's
    // ff 0.3 the UNVERIFIED alternative), and fighters only (ruling R-T16g).
    expect(row(arrow.hitbox)).toEqual([0, 59, 35, 60, 46, 102, 0, 5, fx(0), true, "normal", true]);
    expect(arrow.hitbox.fightersOnly).toBe(true);
  });

  // Hitlag ×0 (Ultimate: "a hitlag multiplier of 0× now functions like this parameter,
  // overriding all other hitlag mechanics and setting hitlag to 0 frames", SmashWiki
  // "Hitlag", https://www.ssbwiki.com/Hitlag): the flames freeze nobody.
  it("Mario Finale's flames freeze nobody", () => {
    const { states, events } = run(ready("mario", 45), 120);
    const first = events.findIndex((e) => e.hits.some((h) => h.victim === 1));
    expect(first).toBeGreaterThan(0);
    expect(states[first].fighters[1].hitlag).toBe(0);
  });
});

/** `user` with the Smash Ball's power, `other` `gap` in front of them, both on Final Destination's floor. */
function duel(user: string, other: string, gap: number): GameState {
  const s = createInitialState("finalDestination", [{ defId: user }, { defId: other }], RULES, 6);
  s.fighters.forEach((f, i) => Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(i === 0 ? -30 : -30 + gap), y: 0, facing: i === 0 ? 1 : -1, intangible: 0 }));
  s.fighters[0].finalSmashReady = FINAL_SMASH_READY;
  return s;
}

/**
 * SmashWiki "Unblockable attack" (https://www.ssbwiki.com/Unblockable_attack): an
 * unblockable attack "cannot be defended against with a shield or a counterattack", and
 * "in Ultimate, all Final Smashes are unblockable". Task 14's rule, for the boxes of a
 * Final Smash that traps nobody and for its projectiles (Task 16).
 */
describe("a Final Smash's beams and projectiles are unblockable and not countered", () => {
  const SHIELD = (i: number): InputFrame[] => [i === 0 ? Btn.Special : 0, Btn.Shield, 0];

  it.each([
    ["the Ancient Arrow", "link", 50, 140],
    ["Mario Finale's flames", "mario", 45, 240],
    ["Zero Laser", "samus", 90, 160],
  ] as const)("%s go through a raised shield", (_name, user, gap, frames) => {
    const { states, events } = runHeld(ready(user, gap), frames, () => {}, SHIELD);
    const first = events.findIndex((e) => e.hits.some((h) => h.victim === 1));
    expect(first).toBeGreaterThan(10);
    // Shielding until the step it lands.
    expect(states[first - 1].fighters[1].action).toBe("shield");
    expect(events.flatMap((e) => e.shieldHits)).toEqual([]);
  });

  it.each([
    ["the Ancient Arrow", "link", 50, 45, 140],
    // Fix round 1: the beam is out from the move's 81, after `final_start` (R-T16c).
    ["Zero Laser's beam", "samus", 90, 74, 160],
  ] as const)("Marth's Counter does not catch %s", (_name, user, gap, press, frames) => {
    const { states, events } = runHeld(duel(user, "marth", gap), frames, () => {}, (i) => [i === 0 ? Btn.Special : 0, i === press ? Btn.Down | Btn.Special : 0]);
    expect(states.some((s) => s.fighters[1].move === "downB")).toBe(true);
    expect(events.flatMap((e) => e.counters)).toEqual([]);
    expect(hitsOnPort1(events).length).toBeGreaterThan(0);
  });

  // The articles' scripts say `Reflectable=false` (rubendal Data Viewer 13.0.1:
  // `mario_hugeflame` `Regular`, `link_ancientbowarrow` `Fly`): no reflector sends one back.
  it("Fox's Reflector does not send the Ancient Arrow back: it hits him", () => {
    expect(def("link").moves.finalSmash!.projectiles!.map((p) => p.reflectable)).toEqual([undefined]);
    expect(def("mario").moves.finalSmash!.projectiles!.map((p) => p.reflectable)).toEqual([undefined]);
    const { events } = runHeld(duel("link", "fox", 50), 140, () => {}, (i) => [i === 0 ? Btn.Special : 0, i === 55 ? Btn.Down | Btn.Special : 0]);
    expect(events.flatMap((e) => e.reflects)).toEqual([]);
    expect(hitsOnPort1(events).map((h) => h.damage)).toEqual([35]);
  });
});

/**
 * SmashWiki "Wall" (https://www.ssbwiki.com/Wall): "All walls will stop projectile
 * attacks". UNVERIFIED for both: no source gives Mario Finale's flames meeting a wall;
 * SmashWiki "Ancient Bow and Arrow" (https://www.ssbwiki.com/Ancient_Bow_and_Arrow) has
 * the arrow explode there ("If it strikes a wall or floor, it will also explode, but the
 * explosion deals less damage (35% → 20%)"), a blast not modelled: it is gone there. Both
 * fly flat, so neither ever rises into an underside.
 */
describe("a Final Smash's projectile ends against a wall", () => {
  const FD_LEFT = FD_FLOOR.x - FD_FLOOR.halfWidth;

  it.each([
    ["mario", "hugeFlame", 120],
    ["link", "ancientArrow", 120],
  ] as const)("%s's %s, fired at Final Destination's side from 20 out, is gone at it, never inside it", (user, id, frames) => {
    const s = ready(user, 0);
    const at = { x: FD_LEFT - fx(20), y: fx(-20) };
    Object.assign(s.fighters[0], { action: "fall", grounded: false, platform: -1, x: at.x, y: at.y });
    Object.assign(s.fighters[1], { x: fx(-70) });
    const { states } = runHeld(s, frames, (st) => hold(st.fighters[0], at.x, at.y));
    const life = states.map((st) => st.projectiles.find((p) => p.defId === id));
    const born = life.findIndex((p) => p !== undefined);
    expect(born).toBeGreaterThan(0);
    const gone = life.findIndex((p, i) => i > born && p === undefined);
    expect(gone).toBeGreaterThan(born);
    expect(life[gone - 1]!.age).toBeLessThan(findProjectileDef(def(user), id)!.lifetime - 1);
    for (const p of life) if (p !== undefined) expect(insideSolidBody(FD_STAGE, 0, p.x, p.y)).toBe(false);
  });
});

/**
 * One Final Smash at a time, its projectiles included (fix round 1, ruling R-T16a):
 * SmashWiki "Final Smash" (https://www.ssbwiki.com/Final_Smash), "only one Smash Ball or
 * Final Smash can be present onscreen at any given time", and "When a Final Smash is
 * active, all other players on standby temporarily exit standby mode and regain it upon
 * conclusion". Mario's move ends on 156; his flames, born on 5, live to 224.
 */
describe("a Final Smash is out while one of its projectiles is (ruling R-T16a)", () => {
  const flames = (s: GameState) => s.projectiles.find((p) => p.defId === "hugeFlame");

  it("keeps the standby of a fighter Mario Finale's flames strike after Mario's move, and drops no ball", () => {
    const s = ready("mario", 45);
    s.fighters[1].finalSmashReady = FINAL_SMASH_READY;
    const { states, events } = runHeld(s, 240, (st) => {
      const flame = flames(st);
      if (flame !== undefined) hold(st.fighters[1], flame.x, flame.y);
    });
    expect(hitsOnPort1(events).filter((h) => h.frame > 157).length).toBeGreaterThan(5);
    expect(states.every((st) => st.fighters[1].finalSmashReady === FINAL_SMASH_READY)).toBe(true);
    expect(states.every((st) => !st.smashBall.active)).toBe(true);
  });

  it("refuses a second Final Smash while the flames are out, and starts it once they are gone", () => {
    const s = ready("mario", 45);
    // Fox, far behind Mario, has the power too.
    s.fighters[2].finalSmashReady = FINAL_SMASH_READY;
    const { states } = runHeld(s, 260, () => {}, (i) => [i === 0 ? Btn.Special : 0, 0, i === 169 || i === 239 ? Btn.Special : 0]);
    expect(slots([states[169]], 0)[0]).toBeNull();
    expect(flames(states[169])).toBeDefined();
    expect([states[169].fighters[2].move, states[169].fighters[2].finalSmashReady]).toEqual(["neutralB", FINAL_SMASH_READY]);
    expect(flames(states[239])).toBeUndefined();
    expect(states[239].fighters[2].move).toBe("finalSmash");
  });

  // A spawn falls due every `SMASH_BALL_SPAWN_INTERVAL` frames; the clock is set so one
  // falls on the step given.
  const spawnRun = (user: string, gap: number, dueStep: number) => {
    const s = ready(user, gap);
    Object.assign(s.rules, { smashBall: true });
    s.frame = SMASH_BALL_SPAWN_INTERVAL - (dueStep + 1);
    return run(s, dueStep + 5).states;
  };

  it.each([
    ["inside Mario's move", 100],
    ["in the flames after it", 180],
  ] as const)("spawns no Smash Ball %s; after both, one appears", (_when, due) => {
    expect(spawnRun("mario", 45, due).every((st) => !st.smashBall.active)).toBe(true);
    expect(spawnRun("mario", 45, 260)[260].smashBall.active).toBe(true);
  });

  it("does the same for the Ancient Arrow while it flies on past Link's move", () => {
    // Link fires left from Final Destination's right side; Mario and Fox stand behind him.
    const setup = () => {
      const s = ready("link", 0);
      Object.assign(s.fighters[0], { x: fx(75), facing: -1 });
      Object.assign(s.fighters[1], { x: fx(78), finalSmashReady: FINAL_SMASH_READY });
      Object.assign(s.fighters[2], { x: fx(79) });
      return s;
    };
    const arrowOut = (st: GameState) => st.projectiles.some((p) => p.defId === "ancientArrow");
    const first = run(setup(), 130).states;
    const tail = first.findIndex((st, i) => i > 60 && slots([st], 0)[0] === null && arrowOut(st));
    expect(tail).toBeGreaterThan(100);
    const { states } = runHeld(setup(), 140, () => {}, (i) => [i === 0 ? Btn.Special : 0, i === tail ? Btn.Special : 0, 0]);
    expect([states[tail].fighters[1].move, states[tail].fighters[1].finalSmashReady]).toEqual(["neutralB", FINAL_SMASH_READY]);
  });

  // Fix round 2 (the re-review's N2): the arrow's tail keeps the other two as well.
  const arrowSetup = () => {
    const s = ready("link", 0);
    Object.assign(s.fighters[0], { x: fx(75), facing: -1 });
    Object.assign(s.fighters[1], { x: fx(78) });
    Object.assign(s.fighters[2], { x: fx(79) });
    return s;
  };
  const arrowOf = (st: GameState) => st.projectiles.find((p) => p.defId === "ancientArrow");

  it("keeps the standby of a fighter the Ancient Arrow strikes after Link's move, and drops no ball", () => {
    const s = arrowSetup();
    s.fighters[2].finalSmashReady = FINAL_SMASH_READY;
    // Fox, in standby, is put in the arrow's path once Link's move is over. The arrow is
    // near the left blast line by then, and its 35% sends him through it: the KO's own
    // rule then takes the power (UNVERIFIED, `step`), so the pin runs up to it.
    const { states, events } = runHeld(s, 130, (st) => {
      const arrow = arrowOf(st);
      if (arrow !== undefined && st.fighters[0].move === null) hold(st.fighters[2], arrow.x, arrow.y);
    });
    const struck = events.findIndex((e) => e.hits.some((h) => h.victim === 2 && h.attacker === 0));
    expect(struck).toBeGreaterThan(0);
    expect(slots([states[struck - 1]], 0)[0]).toBeNull();
    expect(states[struck].fighters[2].hitstun).toBeGreaterThan(0);
    const ko = states.findIndex((st) => st.fighters[2].action === "dead");
    expect(ko).toBeGreaterThan(struck + 2);
    expect(states.slice(0, ko).every((st) => st.fighters[2].finalSmashReady === FINAL_SMASH_READY)).toBe(true);
    expect(states.every((st) => !st.smashBall.active)).toBe(true);
  });

  it("spawns no Smash Ball while the Ancient Arrow flies on past Link's move; once it is gone, one appears", () => {
    const plain = run(arrowSetup(), 130).states;
    const tail = plain.findIndex((st, i) => i > 60 && slots([st], 0)[0] === null && arrowOf(st) !== undefined);
    const gone = plain.findIndex((st, i) => i > tail && arrowOf(st) === undefined);
    expect(tail).toBeGreaterThan(100);
    expect(gone).toBeGreaterThan(tail);
    const spawnRun = (due: number) => {
      const s = arrowSetup();
      Object.assign(s.rules, { smashBall: true });
      s.frame = SMASH_BALL_SPAWN_INTERVAL - (due + 1);
      return run(s, due + 3).states;
    };
    for (let due = tail; due < gone; due++) expect(spawnRun(due).every((st) => !st.smashBall.active), `due on ${due}`).toBe(true);
    expect(spawnRun(gone + 1)[gone + 1].smashBall.active).toBe(true);
  });
});

/**
 * An aerial Final Smash (fix round 1, ruling R-T16b). SmashWiki "Final Smash": "When most
 * Final Smashes are performed in the air, upon ending the move, the character gains a
 * slight boost in height and regains their spent midair jumps, which can aid in
 * recovery"; SmashWiki "Mario (SSBU)/Final Smash": "so it can also be used as a desperate
 * recovery tool when aimed away from the stage". One that traps nobody holds its user
 * where it is for the move (UNVERIFIED: held still, no gravity and no drift), and so,
 * since fix round 2 (ruling R-T16j), does a cinematic one's start, whiffed, a dash's
 * excepted; every one that ends in the air gives back the spent midair jumps. The boost
 * is carried: no size is published.
 */
describe("a Final Smash in the air (ruling R-T16b)", () => {
  const FD_LEFT = FD_FLOOR.x - FD_FLOOR.halfWidth;

  it.each(["mario", "samus", "link"])("%s: used offstage 40 up, aimed away, holds there, survives it and ends with a midair jump back", (id) => {
    const s = ready(id, 0);
    Object.assign(s.fighters[0], { action: "fall", grounded: false, platform: -1, x: FD_LEFT - fx(40), y: fx(40), facing: -1, jumpsUsed: 2 });
    Object.assign(s.fighters[1], { x: fx(60) });
    Object.assign(s.fighters[2], { x: fx(70) });
    const { states } = run(s, 300);
    const user = slots(states, 0);
    const last = user.lastIndexOf("finalSmash");
    expect(last).toBeGreaterThan(90);
    for (const st of states.slice(0, last + 1)) expect([st.fighters[0].x, st.fighters[0].y, st.fighters[0].stocks]).toEqual([FD_LEFT - fx(40), fx(40), 3]);
    expect([states[last + 1].fighters[0].action, states[last + 1].fighters[0].jumpsUsed]).toEqual(["fall", 1]);
  });

  it("gives Donkey Kong's midair jump back when Jungle Rush ends in the air too", () => {
    const s = ready("donkeyKong", 18);
    Object.assign(s.fighters[0], { action: "fall", grounded: false, platform: -1, y: fx(150), jumpsUsed: 2 });
    Object.assign(s.fighters[1], { action: "fall", grounded: false, platform: -1, y: fx(150) });
    const { states } = runHeld(s, 400, inFront);
    const user = slots(states, 0);
    const last = user.lastIndexOf("finalEnd");
    expect(last).toBeGreaterThan(0);
    expect(states[last].fighters[0].jumpsUsed).toBe(2);
    expect([states[last + 1].fighters[0].grounded, states[last + 1].fighters[0].jumpsUsed]).toEqual([false, 1]);
  });

  // Fix round 2 (ruling R-T16j): a cinematic Final Smash whiffed in the air holds its user
  // too, as "most Final Smashes" do. Nobody is near, so the start traps nobody and plays
  // to its end, where the user is (UNVERIFIED: held still, as R-T16b's).
  it.each(["donkeyKong", "kirby", "fox"])("%s: a cinematic one whiffed offstage 40 up holds there, survives it and ends with a midair jump back", (id) => {
    const s = ready(id, 0);
    Object.assign(s.fighters[0], { action: "fall", grounded: false, platform: -1, x: FD_LEFT - fx(40), y: fx(40), facing: -1, jumpsUsed: 2 });
    Object.assign(s.fighters[1], { x: fx(60) });
    Object.assign(s.fighters[2], { x: fx(70) });
    const { states } = run(s, 200);
    const user = slots(states, 0);
    const last = user.lastIndexOf("finalSmash");
    expect(last).toBeGreaterThan(60);
    expect(user.slice(0, last + 1).every((m) => m === "finalSmash")).toBe(true);
    for (const st of states.slice(0, last + 1)) expect([st.fighters[0].x, st.fighters[0].y, st.fighters[0].stocks]).toEqual([FD_LEFT - fx(40), fx(40), 3]);
    expect([states[last + 1].fighters[0].action, states[last + 1].fighters[0].jumpsUsed]).toEqual(["fall", 1]);
  });

  // The published dashes keep their momentum (ruling R-T16j): SmashWiki "Critical Hit",
  // "In the air, the user will travel at high speed directly forward"; "Volt Tackle",
  // "ignores edges". Whiffed in the air, each dashes on, unheld.
  it.each([
    ["marth", 100],
    ["pikachu", 100],
  ] as const)("%s: whiffed in the air, dashes on, unheld", (id, distance) => {
    const s = ready(id, 0);
    Object.assign(s.fighters[0], { action: "fall", grounded: false, platform: -1, x: FD_LEFT - fx(40), y: fx(40), facing: -1, jumpsUsed: 2 });
    Object.assign(s.fighters[1], { x: fx(60) });
    Object.assign(s.fighters[2], { x: fx(70) });
    const { states } = run(s, 150);
    const inStart = states.filter((st) => st.fighters[0].move === "finalSmash");
    expect(inStart.length).toBeGreaterThan(20);
    const farthest = Math.min(...inStart.map((st) => st.fighters[0].x));
    expect(farthest).toBeLessThan(FD_LEFT - fx(40) - fx(distance));
  });
});

/**
 * Zero Laser's start, its scripted clears and its fringe beams (fix round 1, rulings
 * R-T16c to R-T16e), from rubendal Data Viewer 13.0.1 (…/character/Samus/data.json):
 * `game_finalstart`, `game_final`, `samus_laser` `Shoot` and `samus_laser2` `Upper` and
 * `Lower`. SmashWiki "Zero Laser" (https://www.ssbwiki.com/Zero_Laser): "Before the laser
 * fires, it'll pull in nearby fighters a little bit", and "Fighters are drawn to the
 * center". The laser's frame f is the move's 69 + f.
 */
describe("Zero Laser's start, clears and fringe beams (rulings R-T16c to R-T16e)", () => {
  /** Hits on port 1 by the box that landed: the move frame Samus was on, and the damage. */
  const byBox = (states: readonly GameState[], events: readonly StepEvents[]) => {
    const out = new Map<number, [number, number][]>();
    events.forEach((e, i) => {
      for (const h of e.hits) {
        if (h.victim !== 1) continue;
        const list = out.get(h.hitboxId) ?? [];
        list.push([moveFrameOf(states[i].fighters[0].actionFrame), toFloat(h.damage)]);
        out.set(h.hitboxId, list);
      }
    });
    return out;
  };
  const framesOf = (hits: Map<number, [number, number][]>, id: number) => (hits.get(id) ?? []).map(([f]) => f);

  it("charges for 69 frames first: its 1% strikes a fighter held point-blank on 48, 58 and 68, and the laser fires on 70", () => {
    const { states, events } = runHeld(ready("samus", 20), 400, (s) => hold(s.fighters[1], s.fighters[0].x + fx(20), 0));
    const hits = byBox(states, events);
    expect(framesOf(hits, 0)).toEqual([48, 58, 68]);
    expect((hits.get(0) ?? []).every(([, d]) => Math.abs(d - 1 * FRESH) < 0.01)).toBe(true);
    // Point-blank, the laser's own record (`clear_all` on its 8, 12 and 140) strikes 16
    // times: the muzzle on 70 (1%) and 77 (2%), the beam thirteen times, the end on 209.
    const laser = [7, 8, 9, 10].flatMap((id) => framesOf(hits, id)).sort((a, b) => a - b);
    expect(laser).toEqual([70, 77, ...Array.from({ length: 13 }, (_, k) => 81 + 10 * k), 209]);
  });

  it("pulls a fighter behind Samus forward, and one in front, in the air, back toward her line", () => {
    // Behind: the 18° pull, 15 behind and 20 across; in front: the 367° pull (366° in the
    // script), 17 ahead and 30 across, toward its centre.
    const behind = ready("samus", -10);
    const { states: b, events: be } = run(behind, 50);
    expect(be[47].pushes).toContainEqual({ attacker: 0, victim: 1 });
    expect(b[49].fighters[1].x).toBeGreaterThan(b[46].fighters[1].x);
    const front = ready("samus", 35);
    Object.assign(front.fighters[1], { action: "fall", grounded: false, platform: -1, y: fx(13) });
    const { states: f, events: fe } = runHeld(front, 48, (st) => {
      if (moveFrameOf(st.fighters[0].actionFrame) < 47) hold(st.fighters[1], fx(5), fx(13));
    });
    expect(fe[47].pushes).toContainEqual({ attacker: 0, victim: 1 });
    expect(f[47].fighters[1].vx).toBeLessThan(0);
  });

  it("adds samus_laser2's fringe beams, each on its own record: 0.5% every 8 from the laser's 17, and its blast beside the end on 140", () => {
    const { states, events } = runHeld(ready("samus", 90), 400, (s) => hold(s.fighters[1], s.fighters[0].x + fx(90), 0));
    const hits = byBox(states, events);
    // The lower beam (14 below the main, 45°) reaches a standing Mario's feet; the upper
    // (325°, 14 above) passes over his head.
    expect(framesOf(hits, 12)).toEqual(Array.from({ length: 16 }, (_, k) => 86 + 8 * k));
    expect(framesOf(hits, 11)).toEqual([]);
    // On the laser's 140 the end and both blasts land together: 5.5 + 2.5 + 2.5 = 10.5,
    // SmashWiki "Samus (SSBU)"'s "10.5% (main blast)", each a fresh move's.
    const on209 = [...hits.values()].flat().filter(([f]) => f === 209).map(([, d]) => d);
    expect(on209.reduce((a, d) => a + d, 0)).toBeCloseTo(10.5 * FRESH, 1);
    expect(on209).toHaveLength(3);
  });
});

/**
 * Rollback across a misprediction between two rehits (fix round 1, M4): from a snapshot
 * taken between two strikes, a wrong branch (the fighter in them presses shield and
 * jump) is simulated and thrown away, and the right inputs re-simulated from the
 * snapshot give the original states, hash for hash; the snapshot is untouched.
 */
describe("the beams roll back across a misprediction between rehits", () => {
  it.each([
    ["mario", 45, 240, [68, 75, 110]],
    ["samus", 50, 260, [85, 95, 150]],
  ] as const)("%s's, Mario %i ahead", (user, gap, frames, at) => {
    const { states } = run(ready(user, gap), frames);
    for (const k of at) {
      const snapshot = states[k];
      const before = hashState(snapshot);
      let wrong = cloneState(snapshot);
      let prev: InputFrame[] = [0, 0, 0];
      for (let i = k + 1; i < k + 12; i++) {
        const keys: InputFrame[] = [0, i % 2 === 0 ? Btn.Shield : Btn.Jump, 0];
        wrong = step(wrong, keys, { prevInputs: prev }).state;
        prev = keys;
      }
      expect(hashState(wrong), `snapshot ${k}: the wrong branch diverges`).not.toBe(hashState(states[k + 11]));
      expect(hashState(snapshot)).toBe(before);
      let s = cloneState(snapshot);
      prev = [0, 0, 0];
      for (let i = k + 1; i < frames; i++) {
        s = step(s, [0, 0, 0], { prevInputs: prev }).state;
        expect(hashState(s), `snapshot ${k}, step ${i}`).toBe(hashState(states[i]));
      }
    }
  });
});

/**
 * The Ancient Arrow hits fighters and nothing else (fix round 1, ruling R-T16g): its
 * script's `Hitbits=COLLISION_CATEGORY_MASK_FIGHTER` (rubendal `link_ancientbowarrow`;
 * SmashWiki "Link (SSBU)/Final Smash": "hitbits=Fighter only"). Mario Finale's flames
 * have the default, and hit a Smash Ball. And the arrow freezes nobody (ruling R-T16h):
 * its `DisableHitlag=true`.
 */
describe("the Ancient Arrow and a Smash Ball (rulings R-T16g, R-T16h)", () => {
  /** `user`'s Final Smash (or none) with a still Smash Ball at (x, y); the ball's health after `frames`. */
  const ballAfter = (user: string, gap: number, press: boolean, x: number, y: number, frames: number) => {
    const s = ready(user, gap);
    Object.assign(s.rules, { smashBall: true });
    Object.assign(s.smashBall, { active: true, x: fx(x), y: fx(y), vx: 0, vy: 0, health: fx(40), driftTimer: 100_000 });
    let st = s;
    let prev: InputFrame[] = [0, 0, 0];
    for (let i = 0; i < frames; i++) {
      const keys: InputFrame[] = [press && i === 0 ? Btn.Special : 0, 0, 0];
      st = step(st, keys, { prevInputs: prev }).state;
      prev = keys;
    }
    return st.smashBall.health;
  };

  it("lets the arrow fly through a Smash Ball in its path, which the flames strike", () => {
    // Link at −30 shoots right on 60 from −20, 7 up; Mario well out of the way behind.
    expect(ballAfter("link", -40, true, 10, 7, 100)).toBe(ballAfter("link", -40, false, 10, 7, 100));
    expect(ballAfter("mario", -40, true, 0, 8, 120)).toBeLessThan(ballAfter("mario", -40, false, 0, 8, 120));
  });

  it("freezes nobody: the arrow's victim takes no hitlag", () => {
    const { states, events } = run(ready("link", 50), 140);
    const hit = events.findIndex((e) => e.hits.some((h) => h.victim === 1));
    expect(hit).toBeGreaterThan(0);
    expect(states[hit].fighters[1].hitlag).toBe(0);
  });
});

describe("finalKit", () => {
  it("writes a script's fkb as fixed knockback, beside its bkb", () => {
    const set = finalBox(0, 6, 6, { damage: 1.2, angle: 135, kbg: 100, fkb: 40 });
    expect(set).toMatchObject({ damage: fx(1.2), angle: fx(135), knockbackGrowth: fx(100), fixedKnockback: fx(40), baseKnockback: 0 });
    const scaling = finalBox(0, 7, 7, { damage: 14, angle: 70, kbg: 96, bkb: 90 });
    expect(scaling).toMatchObject({ baseKnockback: fx(90), knockbackGrowth: fx(96) });
    expect("fixedKnockback" in scaling).toBe(false);
    expect("setKnockback" in set || "setKnockback" in scaling).toBe(false);
  });

  it("carries a far end, the hitlag, the clang, the launch's side and the effect where given", () => {
    const box = finalBox(2, 29, 34, { damage: 12, angle: 361, kbg: 0, radius: 13, x: 8, y: 10, x2: 28, y2: 10, hitlag: 5, transcendent: true, lr: "position", effect: "electric" });
    expect(box).toMatchObject({ id: 2, startFrame: 29, endFrame: 34, x: fx(8), y: fx(10), x2: fx(28), y2: fx(10), radius: fx(13), hitlagMultiplier: fx(5), transcendent: true, lr: "position", effect: "electric" });
    const bare = finalBox(0, 1, 1, { damage: 1, angle: 0, kbg: 0 });
    // The stand-ins: x 10, y 8, radius 10 (UNVERIFIED, `finalKit.ts`).
    expect(bare).toMatchObject({ x: fx(10), y: fx(8), radius: fx(10) });
    for (const k of ["x2", "y2", "hitlagMultiplier", "transcendent", "lr", "effect"]) expect(k in bare, k).toBe(false);
  });

  it("carries a start's ordinary hit (`trap: false`) and a force reaction where given", () => {
    expect(finalBox(1, 54, 54, { damage: 5, angle: 361, kbg: 0, bkb: 70, trap: false, forceReaction: true })).toMatchObject({ trap: false, forceReaction: true });
    const bare = finalBox(0, 1, 1, { damage: 1, angle: 0, kbg: 0 });
    for (const k of ["trap", "forceReaction"]) expect(k in bare, k).toBe(false);
  });

  it("spaces a barrage's one-frame hits evenly, with ids from the first", () => {
    const hits = barrage(18, 79, 13, 4, { damage: 1.1, angle: 135, kbg: 100, fkb: 40 });
    expect(hits).toHaveLength(13);
    expect(hits.map((h) => h.id)).toEqual(Array.from({ length: 13 }, (_, i) => 18 + i));
    expect(hits.map((h) => h.startFrame)).toEqual(Array.from({ length: 13 }, (_, i) => 79 + 4 * i));
    for (const h of hits) expect(h.endFrame).toBe(h.startFrame);
  });
});
