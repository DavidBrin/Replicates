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

import { FINAL_SMASH_READY } from "@/engine/final";
import { fx, toFloat } from "@/engine/fixed";
import { moveFrameOf } from "@/engine/hitbox";
import { createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { Btn } from "@/engine/types";
import type { FighterDef, GameState, InputFrame, MatchRules, MoveSlot, StepEvents } from "@/engine/types";
import { STAGES } from "@/stages";
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
    // began, and he is still airborne when his end could end.
    const s = ready("donkeyKong", 18);
    Object.assign(s.fighters[0], { action: "fall", grounded: false, platform: -1, y: fx(150) });
    Object.assign(s.fighters[1], { action: "fall", grounded: false, platform: -1, y: fx(150) });
    const { states } = run(s, 400);
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
const FD_FLOOR = STAGES.find((st) => st.id === "finalDestination")!.platforms[0];
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
