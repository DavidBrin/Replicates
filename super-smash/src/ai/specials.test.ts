/**
 * The CPU's Plan 5 offence (Task 19): Final Smash, Smash Ball, reflect,
 * counter, stored charges, a mouthful or a carry, a grab's throw and a mash,
 * sideways recovery, and the Review Focus: a CPU that goes and gets the Smash
 * Ball, and uses it.
 *
 * The plan's tests, re-staged where a ruling changed their premise: a reflect
 * and a counter are one roll a threat, on the one frame it is timed for, and a
 * charge or a smash-input special one roll an opening (rulings R-T18e, R-T18g),
 * so each is staged on its decision frame; the carry throws once it has carried
 * its cargo far enough; the CPU's own definition is `fighterDef` (Task 18's
 * field), and its reach stays the placed tables' (ruling P5-R22).
 */

import { beforeAll, describe, expect, it } from "vitest";

import { DEFAULT_AIR_DODGE } from "@/engine/airDodge";
import { SMASH_CHARGE_MAX } from "@/engine/constants";
import { FINAL_SMASH_READY } from "@/engine/final";
import { fx } from "@/engine/fixed";
import { actionFrameOf } from "@/engine/hitbox";
import { findProjectileDef, spawnProjectile } from "@/engine/projectile";
import { createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { smashHoldFrame } from "@/engine/acmd/run";
import { Btn, held, type FighterDef, type GameState, type InputFrame, type MoveSlot, type ProjectileState } from "@/engine/types";
import { FIGHTERS, donkeyKong, fox, kirby, link, mario, marth, pikachu, samus } from "@/fighters";
import { STAGES } from "@/stages";
import { makeFighter, makeState } from "@/render/testFixtures";
import { fighterParams } from "@/engine/params";
import {
  DECISION_ROLLS,
  DEFAULT_STAGE_VIEW,
  MELEE_RANGE,
  ROLL_SPECIAL,
  THREAT_RANGE,
  free,
  isHelpless,
  isOffstage,
  observe,
  stageViewFromDef,
  towardX,
  type BehaviourContext,
  type StageView,
} from "./behaviours";
import { sideRecoveryFromDef, upBInReach, recoveryFromDef } from "./recovery";
import { COUNTER_AIM, shield, swingHitFrame } from "./defence";
import { BEHAVIOURS, cpuDef, cpuInput, cpuWorldFromDef, decideCpu, tuningForLevel } from "./cpu";
import {
  CARGO_CARRY_FRAMES,
  REFLECT_AIM,
  counter,
  dashTravel,
  finalSmashSpotFor,
  firingBands,
  recoversFrom,
  SPOT_EDGE_ROOM,
  SPOT_TURN_ROOM,
  whiffEnd,
  finalSmash,
  framesToMeet,
  holding,
  mash,
  mashPeriod,
  reflect,
  SIDE_RECOVER_ABOVE,
  SIDE_RECOVER_BELOW,
  sideRecover,
  smashBall,
  smashSpecial,
  storeCharge,
} from "./specials";

beforeAll(() => {
  registerFighters(FIGHTERS);
  registerStages(STAGES);
});

const defOf = (id: string): FighterDef => FIGHTERS.find((f) => f.id === id)!;
const FD = stageViewFromDef(STAGES.find((x) => x.id === "finalDestination")!);

function context(state: GameState, def: FighterDef, level = 9, rolls: number[] = new Array(DECISION_ROLLS).fill(0), stage: StageView = DEFAULT_STAGE_VIEW): BehaviourContext {
  const tuning = tuningForLevel(level);
  const defs = state.fighters.map((f, i) => (i === 0 ? def : defOf(f.defId)));
  return {
    state,
    view: observe(state, 0, tuning.reactionFrames),
    stage,
    tuning,
    jumps: def.attributes.jumps,
    meleeReach: MELEE_RANGE,
    airBrake: 0,
    airDodge: DEFAULT_AIR_DODGE,
    recovery: recoveryFromDef(def),
    fighterDef: def,
    matchDefs: defs,
    rolls,
  };
}

const rollsWith = (slot: number, value: number): number[] => {
  const rolls = new Array<number>(DECISION_ROLLS).fill(0);
  rolls[slot] = value;
  return rolls;
};

describe("the Final Smash", () => {
  const ready = (gap: number, over: Partial<Parameters<typeof makeFighter>[0]> = {}) =>
    makeState({ fighters: [makeFighter({ port: 0, finalSmashReady: FINAL_SMASH_READY, facing: 1, ...over }), makeFighter({ port: 1, x: fx(gap) })] });

  // The plan's test, with the trapping one's target committed (landing): Task 19's
  // sweep had a free target walk out of a trap's windup about half the time.
  const landing = (gap: number) =>
    makeState({ fighters: [makeFighter({ port: 0, finalSmashReady: FINAL_SMASH_READY, facing: 1 }), makeFighter({ port: 1, x: fx(gap), action: "landingLag", actionFrame: 20 })] });

  /** Pikachu at `x` on Final Destination facing right, a held target point-blank in front. */
  const fd = (x: number) => makeState({ fighters: [makeFighter({ port: 0, x: fx(x), finalSmashReady: FINAL_SMASH_READY, facing: 1, defId: "pikachu" }), makeFighter({ port: 1, x: fx(x + 20), action: "landingLag", actionFrame: 20 })] });
  /**
   * Whether `def`'s CPU (level 9) presses its Final Smash from `st` (on Final Destination by
   * default), on one of four frames (its press pulses). A travelling one's CPU may move to
   * a spot to fire it from instead (ruling R-FW2n: `finalSmashSpot`), so a press is what
   * these ask about, not the behaviour's score.
   */
  const fire = (st: GameState, def: FighterDef, stage: StageView = FD) => [0, 1, 2, 3].some((f) => held(finalSmash(context({ ...st, frame: f }, def, 9, undefined, stage)).input, Btn.Special));

  /** Pikachu with Volt Tackle's dash at `speed` a frame (its momentum's own windows), as a re-tune could make it. */
  const tackle = (speed: number): FighterDef => ({
    ...pikachu,
    moves: { ...pikachu.moves, finalSmash: { ...pikachu.moves.finalSmash!, momentum: pikachu.moves.finalSmash!.momentum!.map((m) => ({ ...m, x: fx(speed) })) } },
  });

  it("is used at once when it needs no aim, and only in reach when it traps", () => {
    expect(finalSmash(context(ready(150), mario)).score).toBeGreaterThan(0);
    expect(finalSmash(context(landing(150), kirby)).score).toBe(0);
    const near = [0, 1, 2, 3].map((f) => finalSmash(context({ ...landing(12), frame: f }, kirby)).input);
    expect(near.some((i) => held(i, Btn.Special))).toBe(true);
  });

  it("does not throw a trapping one at a target free to walk out of its windup", () => {
    expect(finalSmash(context(ready(12), kirby)).score).toBe(0);
    expect(finalSmash(context(ready(30), donkeyKong)).score).toBe(0);
    expect(finalSmash(context(landing(30), donkeyKong)).score).toBeGreaterThan(0);
  });

  it("fires one that needs no aim along the stage: not at a target well above, and not from off the stage", () => {
    expect(finalSmash(context(ready(100, { x: 0 }), samus)).score).toBeGreaterThan(0);
    const above = makeState({ fighters: [makeFighter({ port: 0, finalSmashReady: FINAL_SMASH_READY }), makeFighter({ port: 1, x: fx(60), y: fx(40), grounded: false, action: "fall" })] });
    expect(finalSmash(context(above, samus)).score).toBe(0);
    const offstage = makeState({ fighters: [makeFighter({ port: 0, finalSmashReady: FINAL_SMASH_READY, x: fx(100), y: 0, grounded: false, action: "fall" }), makeFighter({ port: 1, x: fx(20) })] });
    expect(finalSmash(context(offstage, mario)).score).toBe(0);
  });

  it("fires one along the stage at a target on a floor or committed, not at one free in the air", () => {
    const air = (action: "jump" | "attack") =>
      makeState({ fighters: [makeFighter({ port: 0, finalSmashReady: FINAL_SMASH_READY, facing: 1 }), makeFighter({ port: 1, x: fx(60), y: fx(10), grounded: false, action, actionFrame: 20 })] });
    expect(finalSmash(context(air("jump"), samus)).score).toBe(0);
    expect(finalSmash(context(air("attack"), samus)).score).toBeGreaterThan(0);
  });

  it("does not start Volt Tackle on the run: its speed slides Pikachu past a point-blank target in the windup", () => {
    const run = landing(20);
    run.fighters[0] = makeFighter({ port: 0, finalSmashReady: FINAL_SMASH_READY, facing: 1, action: "run", actionFrame: 10, vx: fx(1.8) });
    expect(finalSmash(context(run, pikachu)).score).toBe(0);
    // Nor standing while a dash's speed still slides it (the sweep's last Volt Tackle self-destruct).
    run.fighters[0] = makeFighter({ port: 0, finalSmashReady: FINAL_SMASH_READY, facing: 1, action: "stand", actionFrame: 3, vx: fx(1.8) });
    expect(finalSmash(context(run, pikachu)).score).toBe(0);
  });

  it("turns to face the target first, and then fires", () => {
    const away = ready(60, { facing: -1 });
    const r = finalSmash(context(away, samus));
    expect(r.input).toBe(Btn.Right);
    expect(held(r.input, Btn.Special)).toBe(false);
  });

  it("turns at point blank as `attack` does: a dash let go for a frame, a standstill's part-way push (ruling R-FW1a)", () => {
    // The final review's I1: the CPU holds any Final Smash power through a dash dance, so
    // the loop stopped the Smash Ball for everybody. A target 0.6 behind.
    const near = (action: "dashStart" | "stand") => ready(0.6, { facing: -1, action, framesSinceDirPress: 30 });
    expect(finalSmash(context(near("dashStart"), mario)).input).toBe(0);
    expect(finalSmash(context(near("stand"), mario)).input).toBe(Btn.Right | Btn.Soft);
  });

  it("does not fire a trapping one from off the stage, as it fires none that needs no aim (ruling R-FW1d; the final review's M1)", () => {
    // Kirby just off Final Destination's right ledge, in the air facing in, a committed
    // target on the stage inside Ultra Sword's reach: it whiffed offstage under stress.
    const off = makeState({
      fighters: [
        makeFighter({ port: 0, x: FD.rightLedge + fx(4), y: fx(4), grounded: false, action: "fall", finalSmashReady: FINAL_SMASH_READY, facing: -1, defId: "kirby" }),
        makeFighter({ port: 1, x: FD.rightLedge - fx(8), action: "landingLag", actionFrame: 20 }),
      ],
    });
    expect(isOffstage(off.fighters[0], FD)).toBe(true);
    expect(finalSmash(context(off, kirby, 9, undefined, FD)).score).toBe(0);
    // Over the stage, the same target in the same reach: used.
    off.fighters[0] = makeFighter({ port: 0, x: FD.rightLedge - fx(16), y: fx(4), grounded: false, action: "fall", finalSmashReady: FINAL_SMASH_READY, facing: 1, defId: "kirby" });
    const fire = [0, 1, 2, 3].map((f) => finalSmash(context({ ...off, frame: f }, kirby, 9, undefined, FD)).input);
    expect(fire.some((i) => held(i, Btn.Special))).toBe(true);
  });

  it("never whiffs Volt Tackle toward an open blast line: point-blank on a committed target only", () => {
    // A whiff carries on past its dash and slides: 154.0 in the CPU's reading of it since
    // the end's own slide speed (fix round 1, the re-review's M3; 155.6 from part 2 of the
    // final wave's ruling R-FW2i; it was 240.9). Fix round 3 (ruling R-FW1t):
    // it is fired only where that whiff stays on the floor ahead, so not from the middle
    // of a stage at all (`tackle`, below, is a shorter one).
    const B = DEFAULT_STAGE_VIEW;
    expect(fire(ready(40, { x: 0 }), pikachu, B)).toBe(false);
    expect(fire(ready(20, { x: 0 }), pikachu, B)).toBe(false);
    expect(fire(landing(20), pikachu, B)).toBe(false);
    expect(fire(landing(20), tackle(1.5), B)).toBe(true);
    expect(fire(landing(40), tackle(1.5), B)).toBe(false);
  });

  it("never starts Volt Tackle at a free target however much stage is ahead: point-blank on a held one only (ruling R-T19h)", () => {
    // The Task 19 review's M2: Pokémon Stadium 2 is 187.6 wide, more than the dash's
    // own travel (`dashTravel`), and a whiff carries on past its dash windows and slides;
    // 15 inside its left ledge, at a free standing target 108 ahead.
    const ps2 = stageViewFromDef(STAGES.find((x) => x.id === "pokemonStadium2")!);
    const at = ps2.leftLedge + fx(15);
    const s = makeState({ fighters: [makeFighter({ port: 0, x: at, finalSmashReady: FINAL_SMASH_READY, facing: 1, defId: "pikachu" }), makeFighter({ port: 1, x: at + fx(108) })] });
    expect(ps2.rightLedge - at).toBeGreaterThan(dashTravel(pikachu.moves.finalSmash!));
    expect(fire(s, pikachu, ps2)).toBe(false);
    // Point-blank on a target that cannot act soon, from a standstill, it still is: its
    // whiff (154.0 since the re-review's M3) keeps on the floor ahead, 172.6 (fix round 3,
    // ruling R-FW1t). The whiff of Task 15's tuning (240.9) did not, nor does 2.5 times
    // that speed's.
    s.fighters[1] = makeFighter({ port: 1, x: at + fx(20), action: "landingLag", actionFrame: 20 });
    expect(fire(s, pikachu, ps2)).toBe(true);
    expect(fire(s, tackle(4.5), ps2)).toBe(false);
    expect(fire(s, tackle(1.5), ps2)).toBe(true);
  });

  it("does not fire a Final Smash whose whiff ends past a blast line: seed 97040's scene (rulings R-FW1t, R-FW2n)", () => {
    // fox-pikachu@townAndCity, seed 97040: a level-7 Pikachu at -45.3 facing left, Fox in
    // hitstun at -32.2 behind him, launched past at 1.4 a frame. Its view, 10 frames
    // behind, puts Fox in front, held and point blank, and Volt Tackle went left, off the
    // ledge. Its own whiff is run where it is (`whiffEnd`): it ends past the left blast line.
    const tc = stageViewFromDef(STAGES.find((x) => x.id === "townAndCity")!);
    const scene = makeState({
      fighters: [
        makeFighter({ port: 0, x: fx(-45.3), finalSmashReady: FINAL_SMASH_READY, facing: -1, defId: "pikachu", actionFrame: 1 }),
        makeFighter({ port: 1, x: fx(-32.2), vx: fx(1.4), action: "hitstun", actionFrame: 12, hitstun: 20, defId: "fox" }),
      ],
    });
    expect(whiffEnd(pikachu, scene.fighters[0], tc, 0, 0)).toBeNull();
    const seen = finalSmash(context(scene, pikachu, 7, undefined, tc));
    expect(held(seen.input, Btn.Special)).toBe(false);
    // The pins, one a Final Smash that travels. From the middle of Final Destination at a
    // held target, a shorter tackle's whiff ends on the floor and it fires; the real one's
    // carries Pikachu past the far blast line, and it does not.
    expect(fire(fd(0), tackle(1.5))).toBe(true);
    expect(fire(fd(0), pikachu)).toBe(false);
    // Critical Hit's dash stops at the edge on the ground (`dashEnd.edge`): safe to whiff
    // facing the near ledge.
    const marthAt = makeState({ fighters: [makeFighter({ port: 0, x: FD.rightLedge - fx(30), finalSmashReady: FINAL_SMASH_READY, facing: 1, defId: "marth" }), makeFighter({ port: 1, x: FD.rightLedge - fx(18), action: "landingLag", actionFrame: 20 })] });
    expect([0, 1, 2, 3].some((f) => held(finalSmash(context({ ...marthAt, frame: f }, marth, 9, undefined, FD)).input, Btn.Special))).toBe(true);
  });

  // Plan 5 final wave 2, fix round 1, ruling R-FW2n: a travelling Final Smash is judged by
  // where its whiff ends (`whiffEnd`, the engine's own rules for one fighter on the stage's
  // floors), not by its path: on a floor, or where the CPU's own recovery model gets it
  // back from (`recoversFrom`: its fall onto a floor, its up special, or its midair jump
  // then its up special). Part 1's R-FW1t, the whole travel on the floor, left a strip of
  // 4 to 32 units a stage, none on Smashville, and Volt Tackle unused in play.
  it("fires a Volt Tackle whose whiff ends off the stage where its recovery gets it back, and the engine brings Pikachu back (ruling R-FW2n)", () => {
    // At -66 on Final Destination, facing right: the tackle and its slide carry Pikachu off
    // the right ledge, and the move ends 40 past it and 50 below.
    const at = fd(-66);
    const end = whiffEnd(pikachu, at.fighters[0], FD, 0, 0)!;
    expect(end.fighter.grounded).toBe(false);
    expect(end.fighter.x).toBeGreaterThan(FD.rightLedge);
    expect(end.fighter.y).toBeLessThan(FD.groundY);
    expect(isHelpless(end.fighter)).toBe(false);
    expect(recoversFrom(pikachu, end.fighter, FD, recoveryFromDef(pikachu), pikachu.attributes.jumps, end.steps, end.steps)).toBe(true);
    expect(fire(at, pikachu)).toBe(true);
    // The engine: the same whiff, nobody in its way, then the level-9 CPU on its own.
    const s = createInitialState("finalDestination", [{ defId: "pikachu" }, { defId: "mario" }], { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true }, 5);
    Object.assign(s.fighters[0], { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(-66), y: 0, facing: 1, intangible: 0, invincible: 0, finalSmashReady: FINAL_SMASH_READY });
    Object.assign(s.fighters[1], { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: 0, y: 0, invincible: 0, intangible: 100_000 });
    const world = cpuWorldFromDef(pikachu, FD, [pikachu, mario], (id) => FIGHTERS.find((f) => f.id === id)!);
    let st = s;
    let prev: InputFrame[] = [0, 0];
    let seed = 11;
    let ended: GameState | null = null;
    let lost = false;
    for (let i = 0; i < 500 && !lost; i++) {
      const inMove = st.fighters[0].action === "special" && st.fighters[0].move === "finalSmash";
      let input: InputFrame = i === 0 ? Btn.Special : 0;
      if (i > 0 && !inMove) {
        const d = decideCpu(st, 0, 9, seed, world);
        seed = d.seed;
        input = d.input;
      }
      const out = step(st, [input, 0], { prevInputs: prev });
      if (ended === null && inMove && out.state.fighters[0].move !== "finalSmash") ended = out.state;
      st = out.state;
      prev = [input, 0];
      lost = out.events.kos.some((k) => k.port === 0);
    }
    expect(ended).not.toBeNull();
    expect([ended!.fighters[0].grounded, ended!.fighters[0].x > FD.rightLedge]).toEqual([false, true]);
    expect(lost).toBe(false);
    expect([st.fighters[0].grounded, st.fighters[0].platform, st.fighters[0].stocks]).toEqual([true, 0, 3]);
  });

  it("does not fire one whose whiff ends where the model has no way back, nor one that would end helpless (ruling R-FW2n)", () => {
    // 51 inside the left ledge: the whiff ends too far out and too low for the up
    // special, from where it is or from the top of the midair jump. The engine agrees: a
    // whiff from there is a stock lost (the scan in the report: of 486 places on the six
    // stages, none where the model says yes and the engine loses the stock).
    const far = fd(-51);
    const end = whiffEnd(pikachu, far.fighters[0], FD, 0, 0)!;
    expect([end.fighter.grounded, end.fighter.x > FD.rightLedge]).toEqual([false, true]);
    expect(recoversFrom(pikachu, end.fighter, FD, recoveryFromDef(pikachu), pikachu.attributes.jumps, end.steps, end.steps)).toBe(false);
    expect(fire(far, pikachu)).toBe(false);
    // Where it would come back, but the move left it helpless (a stand-in that does): no.
    const fs = pikachu.moves.finalSmash!;
    const helpless: FighterDef = { ...pikachu, moves: { ...pikachu.moves, finalSmash: { ...fs, helpless: { landingLag: 10, airSpeed: fx(1) } } } };
    const h = whiffEnd(helpless, fd(-66).fighters[0], FD, 0, 0)!;
    expect(h.fighter.action).toBe("specialFall");
    expect(fire(fd(-66), helpless)).toBe(false);
    expect(fire(fd(-66), pikachu)).toBe(true);
  });

  // Ruling R-FW2n's second half: judged by where the whiff ends, the CPU's Volt Tackles were
  // still 0 on Battlefield and Small Battlefield over the sweep (its Smash Ball appears on
  // those and Town and City only), so a CPU holding one goes to a spot it would fire from,
  // with its target ahead (`finalSmashSpotFor`, from its stage's firing bands,
  // `firingBands`), and the pin below runs on every stage.
  it("knows where on each stage Volt Tackle can be fired from: bands at the back of the stage, Smashville's 5 units wide (ruling R-FW2n)", () => {
    const band = (id: string) => firingBands(pikachu, stageViewFromDef(STAGES.find((x) => x.id === id)!));
    const units = (b: ReturnType<typeof band>) => [b.right, b.left].map((rs) => rs.map(([a, c]) => [a / 4096, c / 4096]));
    expect(units(band("finalDestination"))).toEqual([[[-80, -54]], [[54, 79]]]);
    expect(units(band("smashville"))).toEqual([[[-69, -64]], [[65, 70]]]);
    // A target at -45 on Final Destination: from 0 the nearest spot is past it, at -54,
    // facing it; a target in the stage's middle has none.
    expect(finalSmashSpotFor(pikachu, FD, 0, fx(-45))).toEqual({ x: fx(-54), dir: 1, from: fx(-75), to: fx(-54) });
    expect(finalSmashSpotFor(pikachu, FD, 0, 0)).toBeNull();
    // Never at the very ledge (fix round 2, re-review 2's N3): a target 4 inside the left
    // ledge has its whole window past the ledge's room, so no spot; and on every stage, for a
    // target anywhere, the spot is `SPOT_EDGE_ROOM` inside both ledges.
    expect(finalSmashSpotFor(pikachu, FD, 0, FD.leftLedge + fx(4))).toBeNull();
    for (const st of STAGES) {
      const v = stageViewFromDef(st);
      for (let t = v.leftLedge; t <= v.rightLedge; t += fx(1)) {
        const spot = finalSmashSpotFor(pikachu, v, 0, t);
        if (spot === null) continue;
        expect(spot.from, st.id).toBeGreaterThanOrEqual(v.leftLedge + SPOT_EDGE_ROOM);
        expect(spot.to, st.id).toBeLessThanOrEqual(v.rightLedge - SPOT_EDGE_ROOM);
      }
    }
    // Memoised: the same object for the same fighter and stage view.
    expect(firingBands(pikachu, FD)).toBe(firingBands(pikachu, FD));
  });

  it("goes to its spot for a busy target, turns to face it there and waits, still; a target free to act it leaves to the other behaviours (ruling R-FW2n)", () => {
    const at = (facing: number, action: GameState["fighters"][number]["action"]) =>
      makeState({ fighters: [makeFighter({ port: 0, x: fx(-60), finalSmashReady: FINAL_SMASH_READY, facing, defId: "pikachu", actionFrame: 30 }), makeFighter({ port: 1, x: fx(-45), action, actionFrame: 20 })] });
    // A target in a move of its own: busy, not held. Facing away, it turns (a soft press).
    expect(finalSmash(context(at(-1, "attack"), pikachu, 9, undefined, FD))).toMatchObject({ score: 450, input: Btn.Right | Btn.Soft });
    // Facing it, it stands still.
    expect(finalSmash(context(at(1, "attack"), pikachu, 9, undefined, FD))).toMatchObject({ score: 450, input: 0 });
    // A target standing free: no wait, the fight goes on, and from away from the spot it
    // is not gone to either: going to it then stood the CPU off an idle player for up to
    // 5,469 frames (the idle-human probe, ball on).
    expect(finalSmash(context(at(1, "stand"), pikachu, 9, undefined, FD)).score).toBe(0);
    const away = at(1, "stand");
    away.fighters[0].x = fx(-20);
    expect(finalSmashSpotFor(pikachu, FD, fx(-20), fx(-45))).not.toBeNull();
    expect(finalSmash(context(away, pikachu, 9, undefined, FD)).score).toBe(0);
    away.fighters[1] = { ...away.fighters[1], action: "attack" };
    expect(finalSmash(context(away, pikachu, 9, undefined, FD))).toMatchObject({ score: 450, input: Btn.Left });
    // Facing away within the turn's room of the stretch's target-side end (-54), it steps
    // out of it before it turns.
    const near = at(-1, "attack");
    near.fighters[0].x = fx(-54) - SPOT_TURN_ROOM / 2;
    expect(finalSmash(context(near, pikachu, 9, undefined, FD))).toMatchObject({ score: 450, input: Btn.Left | Btn.Soft });
    // Running to it, it lets go where its slide stops in the stretch (about 15 units on), not before.
    const running = (x: number) => {
      const st = at(-1, "attack");
      Object.assign(st.fighters[0], { x: fx(x), action: "run", vx: -pikachu.attributes.runSpeed });
      return finalSmash(context(st, pikachu, 9, undefined, FD));
    };
    expect(running(-36)).toMatchObject({ score: 450, input: Btn.Left });
    expect(running(-44)).toMatchObject({ score: 450, input: 0 });
    // Running at the ledge when the target turns busy, a let-go would slide it off: it
    // shields, which stops at the edge (fix round 2, re-review 2's N3: `leavesFloor`).
    expect(running(-72)).toMatchObject({ score: 450, input: Btn.Shield });
  });

  it("takes no helpless end for one it comes back from, even over the stage (ruling R-FW2n)", () => {
    // Helpless 5 inside the right ledge, 20 up: its fall lands on the stage, but a helpless
    // end is no way back for a Final Smash's whiff.
    const helpless = makeFighter({ defId: "pikachu", x: FD.rightLedge - fx(5), y: fx(20), grounded: false, platform: -1, action: "specialFall", jumpsUsed: 1 });
    helpless.combat.helplessMove = "upB";
    expect(recoversFrom(pikachu, { ...helpless, action: "fall" }, FD, recoveryFromDef(pikachu), pikachu.attributes.jumps, 0, 0)).toBe(true);
    expect(recoversFrom(pikachu, helpless, FD, recoveryFromDef(pikachu), pikachu.attributes.jumps, 0, 0)).toBe(false);
  });

  // Part 2's fix round 2 (re-review 2's N3): driven by the Final Smash behaviour alone, with
  // nothing else to stop it, the positioning walked Pikachu off his floor in 535 of 2,680
  // runs (a stretch at the very ledge, and the slide or the turn past it). Against a target
  // holding its shield 4 to 7 inside either ledge, from all over the floor, facing either
  // way: Pikachu never leaves the main floor (doing nothing, he never would).
  it.each(STAGES.map((x) => x.id))("on %s, driven by the Final Smash behaviour alone, never leaves the floor going to its spot (ruling R-FW2n, re-review 2's N3)", (id) => {
    const def = STAGES.find((x) => x.id === id)!;
    const view = stageViewFromDef(def);
    const left: string[] = [];
    let runs = 0;
    let moved = 0;
    for (const side of [-1, 1]) {
      for (const inside of [4, 5, 6, 7]) {
        const targetX = side < 0 ? view.leftLedge + fx(inside) : view.rightLedge - fx(inside);
        for (let x = view.leftLedge + fx(2); x <= view.rightLedge - fx(2); x += fx(9)) {
          for (const facing of [-1, 1]) {
            runs++;
            const s = createInitialState(id, [{ defId: "pikachu" }, { defId: "mario" }], { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true }, 5);
            Object.assign(s.fighters[0], { action: "stand", actionFrame: 30, grounded: true, platform: 0, x, y: view.groundY, facing, intangible: 0, invincible: 0, finalSmashReady: FINAL_SMASH_READY });
            Object.assign(s.fighters[1], { action: "shield", actionFrame: 30, grounded: true, platform: 0, x: targetX, y: view.groundY, facing: -side, intangible: 0, invincible: 0 });
            let st = s;
            let prev: InputFrame[] = [0, 0];
            for (let i = 0; i < 150; i++) {
              const input = finalSmash(context(st, pikachu, 9, undefined, view)).input;
              const now: InputFrame[] = [input, Btn.Shield];
              st = step(st, now, { prevInputs: prev }).state;
              prev = now;
              const f = st.fighters[0];
              if (!f.grounded || f.ledge !== null) {
                left.push(`${side < 0 ? "L" : "R"}${inside} from ${(x / 4096).toFixed(0)} facing ${facing}: ${f.action} at ${(f.x / 4096).toFixed(1)} on ${i}`);
                break;
              }
            }
            if (st.fighters[0].x !== x) moved++;
          }
        }
      }
    }
    expect(runs).toBeGreaterThan(100);
    expect(moved).toBeGreaterThan(0);
    expect(left).toEqual([]);
  });

  it.each(STAGES.map((x) => x.id))("goes past a dizzy Mario to its spot on %s, turns, and fires Volt Tackle from there, trapping him (ruling R-FW2n)", (id) => {
    const view = stageViewFromDef(STAGES.find((x) => x.id === id)!);
    // Mario 12 in front of the inner end of the stage's left band, dizzy for 400 frames;
    // Pikachu in the middle, facing away from him.
    const inner = firingBands(pikachu, view).right.at(-1)![1];
    const marioX = inner + fx(12);
    const spot = finalSmashSpotFor(pikachu, view, 0, marioX);
    expect(spot).toMatchObject({ x: inner, dir: 1, to: inner });
    const s = createInitialState(id, [{ defId: "pikachu" }, { defId: "mario" }], { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true }, 5);
    Object.assign(s.fighters[0], { action: "stand", actionFrame: 30, grounded: true, platform: 0, x: 0, y: view.groundY, facing: -1, intangible: 0, invincible: 0, finalSmashReady: FINAL_SMASH_READY });
    Object.assign(s.fighters[1], { action: "shieldBroken", actionFrame: 0, grounded: true, platform: 0, x: marioX, y: view.groundY, facing: 1, hitstun: 400, shieldHealth: 0, intangible: 0, invincible: 0 });
    const world = cpuWorldFromDef(pikachu, view, [pikachu, mario], (f) => FIGHTERS.find((d) => d.id === f)!);
    let st = s;
    let prev: InputFrame[] = [0, 0];
    let seed = 3;
    let fired: GameState | null = null;
    let before: GameState = s;
    for (let i = 0; i < 300 && fired === null; i++) {
      const d = decideCpu(st, 0, 9, seed, world);
      seed = d.seed;
      const out = step(st, [d.input, 0], { prevInputs: prev });
      if (out.events.finalSmashes.includes(0)) fired = out.state;
      before = st;
      st = out.state;
      prev = [d.input, 0];
    }
    expect(fired).not.toBeNull();
    const at = before.fighters[0];
    expect(at.facing).toBe(1);
    expect(at.x).toBeGreaterThanOrEqual(spot!.from);
    expect(at.x).toBeLessThanOrEqual(inner);
    expect(fired!.fighters[1].action).toBe("shieldBroken");
    let trapped = false;
    for (let i = 0; i < 80 && !trapped; i++) {
      st = step(st, [0, 0], { prevInputs: prev }).state;
      prev = [0, 0];
      trapped = st.fighters[1].action === "finalTrapped";
    }
    expect(trapped).toBe(true);
  });

  it("does not start a dash from a run whose slide would carry it off the floor it stands on, a side platform's end included (Task 19 fix round 1's sweep)", () => {
    // Marth dashing right on Battlefield's right platform (38.2 ± 19.4, 27.2 up), 15.1
    // from its end: its windup slid it off, and Critical Hit flew on through the air.
    const plat = DEFAULT_STAGE_VIEW.platforms[1];
    const end = (plat.x + plat.halfWidth) / 4096;
    const on = (x: number, y: number, vx: number) =>
      makeState({
        fighters: [
          makeFighter({ port: 0, x: fx(x), y: fx(y), vx: fx(vx), action: vx === 0 ? "stand" : "dashStart", actionFrame: 2, finalSmashReady: FINAL_SMASH_READY, facing: 1, defId: "marth" }),
          makeFighter({ port: 1, x: fx(x + 12), y: fx(y) }),
        ],
      });
    const y = plat.y / 4096;
    expect(finalSmash(context(on(end - 15.1, y, 2.3), marth)).score).toBe(0);
    // From a standstill there it fits; on the main stage from a run, too.
    expect(finalSmash(context(on(end - 15.1, y, 0), marth)).score).toBeGreaterThan(0);
    expect(finalSmash(context(on(0, 0, 2.3), marth)).score).toBeGreaterThan(0);
  });

  it("uses Critical Hit on the ground whatever its travel, since its grounded dash stops at the edge, but not in the air or from the edge", () => {
    expect(finalSmash(context(ready(40, { x: 0 }), marth)).score).toBeGreaterThan(0);
    const air = makeState({ fighters: [makeFighter({ port: 0, x: 0, y: fx(10), grounded: false, action: "fall", finalSmashReady: FINAL_SMASH_READY, facing: 1 }), makeFighter({ port: 1, x: fx(40), y: fx(10), grounded: false, action: "fall" })] });
    expect(finalSmash(context(air, marth)).score).toBe(0);
    // At the edge facing out it would slide off in its windup and dash from the air.
    const edge = makeState({ fighters: [makeFighter({ port: 0, x: fx(76), finalSmashReady: FINAL_SMASH_READY, facing: 1 }), makeFighter({ port: 1, x: fx(84), y: 0, grounded: false, action: "fall" })] });
    expect(finalSmash(context(edge, marth)).score).toBe(0);
  });

  it("waits while another Final Smash is out", () => {
    const s = landing(12);
    expect(finalSmash(context(s, kirby)).score).toBeGreaterThan(0);
    // The opponent in a Final Smash of its own, seen (committed, so otherwise a target).
    s.fighters[1] = makeFighter({ port: 1, x: fx(12), action: "special", move: "finalSmash", actionFrame: 20 });
    expect(finalSmash(context(s, kirby)).score).toBe(0);
    // Or a projectile one launched still out (Mario Finale's flames).
    const flames = landing(12);
    flames.fighters[1] = makeFighter({ port: 1, x: fx(12), action: "landingLag", actionFrame: 20 });
    flames.projectiles = [{ ...spawnProjectile(findProjectileDef(mario, "hugeFlame")!, flames.fighters[1], 1), x: fx(60) }];
    expect(finalSmash(context(flames, kirby)).score).toBe(0);
  });
});

describe("the Smash Ball", () => {
  it("is chased, and hit when in reach", () => {
    const s = makeState({ fighters: [makeFighter({ port: 0, x: 0, facing: 1 }), makeFighter({ port: 1, x: fx(80) })] });
    s.smashBall = { active: true, x: fx(40), y: fx(4), vx: 0, vy: 0, health: fx(40), driftTimer: 10 };
    expect(held(smashBall(context(s, mario)).input, Btn.Right)).toBe(true);
    s.smashBall.x = fx(8);
    const swings = [0, 1, 2, 3].map((f) => smashBall(context({ ...s, frame: f }, mario)).input);
    expect(swings.some((i) => held(i, Btn.Attack))).toBe(true);
  });

  it("is left alone while somebody holds its power, off the stage, or out of a jump's reach", () => {
    const s = makeState({ fighters: [makeFighter({ port: 0 }), makeFighter({ port: 1, x: fx(80), finalSmashReady: FINAL_SMASH_READY })] });
    s.smashBall = { active: true, x: fx(40), y: fx(4), vx: 0, vy: 0, health: fx(40), driftTimer: 10 };
    expect(smashBall(context(s, mario)).score).toBe(0);
    s.fighters[1].finalSmashReady = 0;
    s.smashBall.x = fx(100);
    expect(smashBall(context(s, mario)).score).toBe(0);
    // Above its two jumps and a swing (Mario's 36.3 + 36.3 + 13): where it spawns, 80 up, it is in reach.
    s.smashBall.x = fx(10);
    s.smashBall.y = fx(90);
    expect(smashBall(context(s, mario)).score).toBe(0);
    s.smashBall.y = fx(80);
    expect(smashBall(context(s, mario)).score).toBeGreaterThan(0);
  });

  it("aims where the ball's drift will take it", () => {
    const at = (x: number, vx: number) => {
      const s = makeState({ fighters: [makeFighter({ port: 0, x: 0, facing: 1 }), makeFighter({ port: 1, x: fx(-80) })] });
      s.smashBall = { active: true, x: fx(x), y: fx(6), vx: fx(vx), vy: 0, health: fx(40), driftTimer: 10 };
      return [0, 1, 2, 3].some((f) => held(smashBall(context({ ...s, frame: f }, mario)).input, Btn.Attack));
    };
    // 24 away and still: out of a 20 reach. Drifting in at 1.4, it is 15.6 away when a swing is out.
    expect(at(24, 0)).toBe(false);
    expect(at(24, -1.4)).toBe(true);
  });

  it("does not follow it out past the ledge", () => {
    const s = makeState({ fighters: [makeFighter({ port: 0, x: fx(78), y: fx(20), grounded: false, action: "fall" }), makeFighter({ port: 1, x: fx(-60) })] });
    s.smashBall = { active: true, x: fx(79.9), y: fx(60), vx: 0, vy: 0, health: fx(40), driftTimer: 10 };
    expect(held(smashBall(context(s, mario)).input, Btn.Right)).toBe(false);
  });

  it("jumps for it when it floats above", () => {
    const s = makeState({ fighters: [makeFighter({ port: 0, x: 0 }), makeFighter({ port: 1, x: fx(80) })] });
    s.smashBall = { active: true, x: fx(2), y: fx(30), vx: 0, vy: 0, health: fx(40), driftTimer: 10 };
    const inputs = Array.from({ length: 12 }, (_, f) => smashBall(context({ ...s, frame: f }, mario)).input);
    expect(inputs.some((i) => held(i, Btn.Jump))).toBe(true);
  });
});

/* ---------------------------------------------------- reflect and counter -- */

/** A projectile of `owner`'s at `x`, flying at `vx`, as `spawnProjectile` makes it, aged `age`. */
function shot(def: FighterDef, id: string, s: GameState, x: number, vx: number, age = 6): ProjectileState {
  const p = spawnProjectile(findProjectileDef(def, id)!, s.fighters[1], 1);
  return { ...p, x, y: fx(6.5), vx, vy: 0, age };
}

describe("reflect and counter", () => {
  it("Fox raises the Reflector on the frame that has it up as a fireball arrives, and not the frame before", () => {
    const s = makeState({ fighters: [makeFighter({ port: 0, x: 0, facing: 1, defId: "fox" }), makeFighter({ port: 1, x: fx(80), defId: "mario" })] });
    const ball = findProjectileDef(mario, "fireball")!;
    const r = fox.moves.downB!.reflector!;
    const aim = r.active[0] + REFLECT_AIM;
    // Placed so that it meets the bubble exactly `aim` steps from now.
    const gap = r.radius + ball.hitbox.radius + fx(2) * (aim - 1) + fx(1);
    s.projectiles = [shot(mario, "fireball", s, gap, -fx(2))];
    expect(framesToMeet(s.projectiles[0], ball, 0, fx(6.5), r.radius)).toBe(aim);
    const now = reflect(context(s, fox));
    expect(now.decided).toBe(true);
    expect(held(now.input, Btn.Down) && held(now.input, Btn.Special)).toBe(true);
    s.projectiles = [{ ...s.projectiles[0], x: s.projectiles[0].x + fx(2) }];
    expect(reflect(context(s, fox)).score).toBe(0);
  });

  it("decides once a projectile: over its whole flight, one frame", () => {
    const s = makeState({ fighters: [makeFighter({ port: 0, x: 0, facing: 1, defId: "fox" }), makeFighter({ port: 1, x: fx(80), defId: "mario" })] });
    let decided = 0;
    for (let k = 0; k < 40; k++) {
      s.projectiles = [shot(mario, "fireball", s, fx(70) - fx(2) * k, -fx(2))];
      if (reflect(context(s, fox)).score > 0) decided++;
    }
    expect(decided).toBe(1);
  });

  it("raises it for a projectile that appears already closer than its aim, as soon as it is seen, if the reflector can still be up for it", () => {
    const s = makeState({ fighters: [makeFighter({ port: 0, x: 0, facing: 1, defId: "fox" }), makeFighter({ port: 1, x: fx(80), defId: "mario" })] });
    const ball = findProjectileDef(mario, "fireball")!;
    const r = fox.moves.downB!.reflector!;
    // It meets the bubble in active[0] + 1 steps: past the aim, inside the reflector's frames.
    const gap = r.radius + ball.hitbox.radius + fx(2) * r.active[0] + fx(1);
    // A projectile is first in the state at age 0 (ruling R-T19f): that is its first sight.
    s.projectiles = [shot(mario, "fireball", s, gap, -fx(2), 0)];
    expect(reflect(context(s, fox)).score).toBeGreaterThan(0);
    for (const age of [1, 6]) {
      s.projectiles = [shot(mario, "fireball", s, gap, -fx(2), age)];
      expect(reflect(context(s, fox)).score, `age ${age}`).toBe(0);
    }
  });

  it("decides once over a fireball's whole flight from where it appears, wherever that is (ruling R-T19f)", () => {
    // From age 0, 2 a frame: one decision where the Reflector can still be up for it
    // when it is first seen (it meets the bubble on the reflector's frames or later),
    // none where it is already too close.
    const ball = findProjectileDef(mario, "fireball")!;
    const r = fox.moves.downB!.reflector!;
    let late = 0;
    for (let start = 14; start <= 70; start += 0.5) {
      const s = makeState({ fighters: [makeFighter({ port: 0, x: 0, facing: 1, defId: "fox" }), makeFighter({ port: 1, x: fx(80), defId: "mario" })] });
      const first = framesToMeet(shot(mario, "fireball", s, fx(start), -fx(2), 0), ball, 0, fx(6.5), r.radius)!;
      const decided: number[] = [];
      for (let age = 0; age < 40; age++) {
        s.projectiles = [shot(mario, "fireball", s, fx(start) - fx(2) * age, -fx(2), age)];
        const res = reflect(context(s, fox));
        if (res.score > 0 && res.decided === true) decided.push(age);
      }
      expect(decided.length, `from ${start} (meets in ${first})`).toBe(first >= r.active[0] ? 1 : 0);
      if (first >= r.active[0] && first < r.active[0] + REFLECT_AIM) {
        late++;
        expect(decided, `from ${start}: first sight`).toEqual([0]);
      }
    }
    expect(late).toBeGreaterThan(0);
  });

  it("keeps a looping reflector up while a projectile still comes at it, and lets it go after", () => {
    const up = makeState({ fighters: [makeFighter({ port: 0, x: 0, facing: 1, defId: "fox", action: "special", move: "downB", actionFrame: 10 }), makeFighter({ port: 1, x: fx(80), defId: "mario" })] });
    up.projectiles = [shot(mario, "fireball", up, fx(30), -fx(2))];
    expect(reflect(context(up, fox)).input).toBe(Btn.Down | Btn.Special);
    up.projectiles = [];
    expect(reflect(context(up, fox)).score).toBe(0);
  });

  it("does not reflect from off the stage, where the reflector spends its fall", () => {
    const s = makeState({ fighters: [makeFighter({ port: 0, x: fx(100), y: 0, grounded: false, action: "fall", facing: -1, defId: "fox" }), makeFighter({ port: 1, x: fx(0), defId: "mario" })] });
    let any = 0;
    for (let k = 0; k < 40; k++) {
      s.projectiles = [shot(mario, "fireball", s, fx(30) + fx(2) * k, fx(2))];
      any += reflect(context(s, fox)).score;
    }
    expect(any).toBe(0);
  });

  it("does not raise it when its roll fails, and a level-1 Fox never does", () => {
    const s = makeState({ fighters: [makeFighter({ port: 0, x: 0, facing: 1, defId: "fox" }), makeFighter({ port: 1, x: fx(80), defId: "mario" })] });
    let any = 0;
    for (let k = 0; k < 40; k++) {
      s.projectiles = [shot(mario, "fireball", s, fx(70) - fx(2) * k, -fx(2))];
      any += reflect(context(s, fox, 9, rollsWith(ROLL_SPECIAL, 0.99))).score + reflect(context(s, fox, 1)).score;
    }
    expect(any).toBe(0);
  });

  it("Mario capes it, toward it", () => {
    const s = makeState({ fighters: [makeFighter({ port: 0, x: 0, facing: -1 }), makeFighter({ port: 1, x: fx(80), defId: "fox" })] });
    const r = mario.moves.sideB!.reflector!;
    let input = -1;
    for (let k = 0; k < 30 && input < 0; k++) {
      s.projectiles = [shot(fox, "blaster", s, fx(80) - fx(2.2) * k, -fx(2.2))];
      const res = reflect(context(s, mario));
      if (res.score > 0) input = res.input;
    }
    expect(r.active[0]).toBeGreaterThan(0);
    expect(held(input, Btn.Right) && held(input, Btn.Special)).toBe(true);
  });

  it("Marth counters a swing timed off its move data, once a swing, and a level-1 Marth does not", () => {
    const L9 = tuningForLevel(9);
    const first = actionFrameOf(Math.min(...mario.moves.fsmash!.hitboxes.map((h) => h.startFrame)));
    const c = marth.moves.downB!.counter!;
    const swingAt = (actionFrame: number) =>
      makeState({ fighters: [makeFighter({ port: 0, facing: 1, defId: "marth" }), makeFighter({ port: 1, x: fx(14), action: "attack", move: "fsmash", actionFrame, facing: -1 })] });
    const decidedOn: number[] = [];
    for (let a = L9.reactionFrames; a < first; a++) if (counter(context(swingAt(a), marth)).score > 0) decidedOn.push(a);
    expect(decidedOn).toEqual([first - (c.active[0] + COUNTER_AIM)]);
    const r = counter(context(swingAt(decidedOn[0]), marth));
    expect(held(r.input, Btn.Down) && held(r.input, Btn.Special) && r.decided === true).toBe(true);
    const rolls = new Array(DECISION_ROLLS).fill(0.5);
    for (let a = 0; a < first; a++) expect(counter(context(swingAt(a), marth, 1, rolls)).score).toBe(0);
  });

  it("decides once over a whole swing: Mario's forward air, seen early, on the frame that puts its hit on the aim (ruling R-T19f)", () => {
    const hit = swingHitFrame(mario, { move: "fair", actionFrame: 0, combat: makeFighter().combat })!;
    const c = marth.moves.downB!.counter!;
    const swingAt = (actionFrame: number) =>
      makeState({ fighters: [makeFighter({ port: 0, facing: 1, defId: "marth" }), makeFighter({ port: 1, x: fx(14), y: fx(6), grounded: false, action: "attack", move: "fair", actionFrame, facing: -1 })] });
    const decidedOn: number[] = [];
    for (let a = 0; a <= hit; a++) if (counter(context(swingAt(a), marth)).score > 0) decidedOn.push(a);
    expect(decidedOn).toEqual([hit - (c.active[0] + COUNTER_AIM)]);
  });

  const SWINGS = ["jab1", "jab2", "jab3", "rapidJab", "ftilt", "utilt", "dtilt", "dashAttack", "nair", "fair", "bair", "uair", "dair"];

  it("decides once a swing, for every swing of every fighter seen at levels 5, 7 and 9: a swing first seen late on its first frame, one seen too late on none (ruling R-T19f)", () => {
    // The Task 19 review's sweep of 183 moves × 3 levels found 50 decided twice.
    const c = marth.moves.downB!.counter!;
    const aim = c.active[0] + COUNTER_AIM;
    let late = 0;
    let cases = 0;
    for (const level of [5, 7, 9]) {
      const t = tuningForLevel(level);
      for (const def of FIGHTERS) {
        for (const [slot, move] of Object.entries(def.moves)) {
          // A swing at a free opponent: an attack's or a special's (not a throw, a grab or a
          // ledge's), and not a smash, whose timing waits on its charge (`swingHitFrame`).
          const action = SWINGS.includes(slot) ? "attack" : /^(neutral|side|up|down)B/.test(slot) ? "special" : null;
          if (move === undefined || action === null || move.chargeable === true) continue;
          const hit = swingHitFrame(def, { move: slot as MoveSlot, actionFrame: 0, combat: makeFighter().combat });
          if (hit === null) continue;
          cases++;
          const swingAt = (actionFrame: number) =>
            makeState({ fighters: [makeFighter({ port: 0, facing: 1, defId: "marth" }), makeFighter({ port: 1, defId: def.id, x: fx(14), action, move: slot as MoveSlot, actionFrame, facing: -1 })] });
          const decidedOn: number[] = [];
          for (let a = 0; a <= hit + 2; a++) if (counter(context(swingAt(a), marth, level)).score > 0) decidedOn.push(a);
          // First seen at its reaction time into the swing: the hit is then this far off.
          const firstLands = hit - t.reactionFrames;
          const want = firstLands >= aim ? [hit - aim] : firstLands >= c.active[0] ? [t.reactionFrames] : [];
          if (want.length === 1 && want[0] === t.reactionFrames && firstLands < aim) late++;
          expect(decidedOn, `level ${level} ${def.id} ${slot} (hit ${hit})`).toEqual(want);
        }
      }
    }
    expect(cases).toBeGreaterThan(100);
    expect(late).toBeGreaterThan(0);
  });

  describe("the counter before the shield (ruling R-T19l)", () => {
    // Link's forward tilt 14 away, at a standing level-9 Marth: seen early, its hit
    // further off than the counter's aim.
    const c = marth.moves.downB!.counter!;
    const aim = c.active[0] + COUNTER_AIM;
    const hit = swingHitFrame(link, { move: "ftilt", actionFrame: 0, combat: makeFighter().combat })!;
    const r = tuningForLevel(9).reactionFrames;
    const at = (actionFrame: number, self: Partial<Parameters<typeof makeFighter>[0]> = {}, swing: Partial<Parameters<typeof makeFighter>[0]> = {}) =>
      makeState({
        frame: 100 + actionFrame,
        fighters: [
          makeFighter({ port: 0, facing: 1, defId: "marth", actionFrame: 30, ...self }),
          makeFighter({ port: 1, defId: "link", x: fx(14), action: "attack", move: "ftilt", actionFrame, facing: -1, ...swing }),
        ],
      });
    const decides = (b: typeof counter, s: GameState) => b(context(s, marth)).score > 0;

    it("decides counter-then-shield on the aim frame only, for a swing seen early", () => {
      expect(hit - r).toBeGreaterThan(aim);
      const counterOn: number[] = [];
      const shieldOn: number[] = [];
      for (let a = r; a <= hit; a++) {
        if (decides(counter, at(a))) counterOn.push(a);
        if (decides(shield, at(a))) shieldOn.push(a);
      }
      expect([counterOn, shieldOn]).toEqual([[hit - aim], [hit - aim]]);
      // On that frame the counter takes it; with the counter's roll failed, the shield.
      const s = at(hit - aim);
      expect(counter(context(s, marth)).decided).toBe(true);
      expect(counter(context(s, marth, 9, rollsWith(ROLL_SPECIAL, 0.99))).score).toBe(0);
      expect(shield(context(s, marth, 9, rollsWith(ROLL_SPECIAL, 0.99))).input).toBe(Btn.Shield);
      expect(decideCpu(s, 0, 9, 1, cpuWorldFromDef(marth, DEFAULT_STAGE_VIEW, [marth, link])).behaviour).toMatch(/counter|shield/);
    });

    it("a swing the counter declines on its frame (facing away) still gets the shield's decision on that frame", () => {
      const away = (a: number) => at(a, { facing: -1 });
      const shieldOn: number[] = [];
      for (let a = r; a <= hit; a++) if (decides(shield, away(a))) shieldOn.push(a);
      expect(shieldOn).toEqual([hit - aim]);
      expect(counter(context(away(hit - aim), marth)).score).toBe(0);
    });

    it("decides neither twice over a hitlag freeze at the aim frame: on the freeze's last frame", () => {
      const frozen = [3, 2, 1, 0].map((hitlag) => at(hit - aim, {}, { hitlag }));
      expect(frozen.map((s) => decides(counter, s))).toEqual([false, false, false, true]);
      expect(frozen.map((s) => decides(shield, s))).toEqual([false, false, false, true]);
    });

    it("a dash attack first in range after its counter frame has passed: the shield decides at range entry, once over the swing (ruling R-T19l amended)", () => {
      // Link's dash attack (hit on 19) closing at 1.5 a frame from 43 away: seen early,
      // its counter frame (hit − aim) comes while it is still out of range.
      const dash = (a: number) => at(a, {}, { move: "dashAttack", x: fx(43 - 1.5 * a), vx: fx(-1.5) });
      const dashHit = swingHitFrame(link, { move: "dashAttack", actionFrame: 0, combat: makeFighter().combat })!;
      const entry = [...Array(dashHit + 1).keys()].find((a) => a >= r && observe(dash(a), 0, r).distance <= THREAT_RANGE)!;
      expect(entry).toBeGreaterThan(dashHit - aim);
      const shieldOn: number[] = [];
      const counterOn: number[] = [];
      for (let a = r; a <= dashHit + 2; a++) {
        if (decides(shield, dash(a))) shieldOn.push(a);
        if (decides(counter, dash(a))) counterOn.push(a);
      }
      expect([shieldOn, counterOn]).toEqual([[entry], []]);
    });

    it("a smash first seen with its charge still to come: the shield decides at first sight and not again once it is let go", () => {
      // Donkey Kong's forward smash, its hit far enough past its hold for the counter's aim
      // to come after the release: before the hold its hit frame is unknown (it may charge).
      const dk = FIGHTERS.find((f) => f.id === "donkeyKong")!;
      const hold = smashHoldFrame(dk, { move: "fsmash" });
      const smash = (actionFrame: number) =>
        makeState({
          frame: 100 + actionFrame,
          fighters: [
            makeFighter({ port: 0, facing: 1, defId: "marth", actionFrame: 30 }),
            makeFighter({ port: 1, defId: "donkeyKong", x: fx(14), action: "attack", move: "fsmash", actionFrame, facing: -1, combat: { ...makeFighter().combat, smashLetGo: actionFrame >= hold } }),
          ],
        });
      const lands = swingHitFrame(dk, smash(hold).fighters[1])!;
      expect(r).toBeLessThan(hold);
      expect(lands - aim).toBeGreaterThanOrEqual(hold);
      const shieldOn: number[] = [];
      for (let a = r; a <= lands; a++) if (decides(shield, smash(a))) shieldOn.push(a);
      expect(shieldOn).toEqual([r]);
    });

    it("a swing whose aim frame comes while it waits out a landing's lag decides on the lag's last frame", () => {
      // Free at first sight (deferred), then a 6-frame landing lag from the frame before the aim.
      const LAG = 6;
      const start = hit - aim - 1;
      expect(start).toBeGreaterThan(r);
      const state = (a: number) =>
        a < start ? at(a) : a < start + LAG ? at(a, { action: "landingLag", actionFrame: a - start, charge: LAG }) : at(a, { action: "stand", actionFrame: a - start - LAG });
      const shieldOn: number[] = [];
      const counterOn: number[] = [];
      for (let a = r; a <= hit; a++) {
        if (decides(shield, state(a))) shieldOn.push(a);
        if (decides(counter, state(a))) counterOn.push(a);
      }
      expect([shieldOn, counterOn]).toEqual([[start + LAG - 1], []]);
    });
  });

  it("a level-9 Marth CPU counters a real swing, and the engine's counter catches it", () => {
    // Marth's own dash attack, 14 away, from the frame a level 9 sees it: its hit is
    // then inside the counter's live frames and short of its aim, so the counter decides
    // at first sight (ruling R-T19f), before the shield's first-sight decision.
    const world = cpuWorldFromDef(marth, FD, [marth, marth]);
    let decided = 0;
    let caught = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const rules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true } as const;
      let s = createInitialState("finalDestination", [{ defId: "marth" }, { defId: "marth" }], rules, 21);
      Object.assign(s.fighters[0], { action: "stand", actionFrame: 30, grounded: true, platform: 0, x: 0, y: 0, intangible: 0, facing: 1 });
      Object.assign(s.fighters[1], { action: "attack", move: "dashAttack", actionFrame: tuningForLevel(9).reactionFrames, grounded: true, platform: 0, x: fx(14), y: 0, intangible: 0, facing: -1 });
      let cs = seed;
      let prev: InputFrame[] = [0, 0];
      let mine = false;
      for (let i = 0; i < 60; i++) {
        const d = decideCpu(s, 0, 9, cs, world);
        cs = d.seed;
        if (d.behaviour === "counter") mine = true;
        const out = step(s, [d.input, 0], { prevInputs: prev });
        prev = [d.input, 0];
        s = out.state;
        if (out.events.counters.some((c) => c.port === 0)) {
          caught++;
          break;
        }
        if (out.events.hits.some((h) => h.victim === 0)) break;
      }
      if (mine) decided++;
    }
    expect(decided).toBeGreaterThan(10);
    expect(caught).toBe(decided);
  });

  it("does not counter or reflect from a run whose slide would carry it off the ledge (the Task 19 review's M6)", () => {
    // Marth running at the right ledge, 3.6 from it (the sweep's marth-pikachu, seed
    // 9055), a forward air timed for the counter just past it.
    const p = fighterParams(marth);
    const c = marth.moves.downB!.counter!;
    const hit = swingHitFrame(mario, { move: "fair", actionFrame: 0, combat: makeFighter().combat })!;
    const at = (x: number, action: "run" | "stand", vx: number) =>
      makeState({
        fighters: [
          makeFighter({ port: 0, x: fx(x), facing: 1, defId: "marth", action, actionFrame: 10, vx }),
          makeFighter({ port: 1, x: fx(x + 14), y: fx(6), grounded: false, action: "attack", move: "fair", actionFrame: hit - (c.active[0] + COUNTER_AIM), facing: -1 }),
        ],
      });
    const ledge = DEFAULT_STAGE_VIEW.rightLedge / 4096;
    expect(counter(context(at(ledge - 3.6, "run", p.run_speed_max), marth)).score).toBe(0);
    expect(counter(context(at(ledge - 3.6, "stand", 0), marth)).score).toBeGreaterThan(0);
    expect(counter(context(at(0, "run", p.run_speed_max), marth)).score).toBeGreaterThan(0);
    // Fox's Reflector likewise, a fireball timed for it.
    const r = fox.moves.downB!.reflector!;
    const ball = findProjectileDef(mario, "fireball")!;
    const gap = r.radius + ball.hitbox.radius + fx(2) * (r.active[0] + REFLECT_AIM - 1) + fx(1);
    const fp = fighterParams(fox);
    const run = (x: number, vx: number) => {
      const s = makeState({ fighters: [makeFighter({ port: 0, x: fx(x), facing: 1, defId: "fox", action: vx === 0 ? "stand" : "run", actionFrame: 10, vx }), makeFighter({ port: 1, x: fx(x - 60), defId: "mario" })] });
      s.projectiles = [shot(mario, "fireball", s, fx(x) + gap, -fx(2))];
      return s;
    };
    expect(reflect(context(run(ledge - 3.6, fp.run_speed_max), fox)).score).toBe(0);
    expect(reflect(context(run(ledge - 3.6, 0), fox)).score).toBeGreaterThan(0);
  });

  it("does not counter a grab or a Final Smash", () => {
    const grab = makeState({ fighters: [makeFighter({ port: 0, facing: 1, defId: "marth" }), makeFighter({ port: 1, x: fx(10), action: "grab", move: "grab", actionFrame: 6, facing: -1 })] });
    expect(counter(context(grab, marth)).score).toBe(0);
    for (let a = 4; a < 40; a++) {
      const fs = makeState({ fighters: [makeFighter({ port: 0, facing: 1, defId: "marth" }), makeFighter({ port: 1, defId: "donkeyKong", x: fx(14), action: "special", move: "finalSmash", actionFrame: a, facing: -1 })] });
      expect(counter(context(fs, marth)).score).toBe(0);
    }
  });
});

/* ---------------------------------------------------------------- charges -- */

describe("stored charges", () => {
  it("Samus charges from afar at an opening, and not on any other frame", () => {
    const far = makeState({ fighters: [makeFighter({ port: 0, facing: 1, defId: "samus", actionFrame: 0 }), makeFighter({ port: 1, x: fx(90) })] });
    const r = storeCharge(context(far, samus));
    expect(r.score).toBeGreaterThan(0);
    expect(held(r.input, Btn.Special)).toBe(true);
    // Not an opening: its own stand under way, the opponent's stand seen long since.
    const later = makeState({ fighters: [makeFighter({ port: 0, facing: 1, defId: "samus", actionFrame: 8 }), makeFighter({ port: 1, x: fx(90), actionFrame: 40 })] });
    expect(storeCharge(context(later, samus)).score).toBe(0);
    expect(storeCharge(context(far, samus, 9, rollsWith(ROLL_SPECIAL, 0.99))).score).toBe(0);
  });

  it("fires a full charge when lined up", () => {
    const lined = makeState({ fighters: [makeFighter({ port: 0, facing: 1, defId: "samus" }), makeFighter({ port: 1, x: fx(50) })] });
    lined.fighters[0].combat.storedCharge = samus.moves.neutralB!.specialCharge!.frames;
    expect(held(storeCharge(context(lined, samus)).input, Btn.Special)).toBe(true);
    // Above it, the shot flies under: nothing.
    lined.fighters[1].y = fx(40);
    expect(storeCharge(context(lined, samus)).score).toBe(0);
  });

  it("keeps a full charge that only pushes for an opponent off the stage: F.L.U.D.D.'s water, at one standing on it, is kept (Plan 5 final wave)", () => {
    // R-FW1c's probe: a level-9 Mario charged F.L.U.D.D. at an idle player, sprayed water
    // that lands no damage (its boxes are all windboxes), charged again, and never hit
    // anybody for the whole 120 seconds.
    const fludd = mario.moves.downB!;
    expect(fludd.specialCharge?.mode).toBe("store");
    expect([...fludd.hitboxes, ...(fludd.projectiles ?? []).map((p) => p.hitbox)].every((hb) => hb.windbox === true || hb.damage === 0)).toBe(true);
    const lined = (x: number, y = 0) => {
      const s = makeState({ fighters: [makeFighter({ port: 0, facing: 1, defId: "mario" }), makeFighter({ port: 1, x: fx(x), y: fx(y), grounded: y === 0, action: y === 0 ? "stand" : "fall" })] });
      s.fighters[0].combat.storedCharge = fludd.specialCharge!.frames;
      return s;
    };
    expect(storeCharge(context(lined(50), mario, 9, undefined, FD)).score).toBe(0);
    // Off the stage, where a push is a gimp, it is let go.
    expect(held(storeCharge(context(lined(FD.rightLedge / 4096 + 10, 4), mario, 9, undefined, FD)).input, Btn.Special)).toBe(true);
    // A charge that hurts is let go at one on the stage, as before (Samus, above).
  });

  it("lets the charge build while the opponent is far, and puts it away with its shield when they come close", () => {
    const charging = (gap: number) =>
      makeState({ fighters: [makeFighter({ port: 0, facing: 1, defId: "samus", action: "special", move: "neutralB", actionFrame: 12, charge: 30 }), makeFighter({ port: 1, x: fx(gap) })] });
    expect(storeCharge(context(charging(90), samus)).input).toBe(0);
    expect(storeCharge(context(charging(90), samus)).score).toBeGreaterThan(0);
    expect(storeCharge(context(charging(20), samus)).input).toBe(Btn.Shield);
  });

  it("holds a smash from its own hold frame while the opponent cannot act soon, and lets go when they can", () => {
    const hold = smashHoldFrame(mario, { move: "fsmash" });
    const smash = (targetAction: "downed" | "stand", charge = 10) =>
      makeState({ fighters: [makeFighter({ port: 0, action: "attack", move: "fsmash", actionFrame: hold, charge }), makeFighter({ port: 1, x: fx(14), action: targetAction, actionFrame: 30 })] });
    expect(storeCharge(context(smash("downed"), mario)).input).toBe(Btn.Attack);
    expect(storeCharge(context(smash("stand"), mario)).score).toBe(0);
    expect(storeCharge(context(smash("downed", SMASH_CHARGE_MAX), mario)).score).toBe(0);
  });

  it("charges the Hero's Bow from afar, lined up, and lets the arrow go when the opponent closes", () => {
    const far = makeState({ fighters: [makeFighter({ port: 0, facing: 1, defId: "link", actionFrame: 0 }), makeFighter({ port: 1, x: fx(90) })] });
    expect(held(storeCharge(context(far, link)).input, Btn.Special)).toBe(true);
    const drawing = (gap: number) => makeState({ fighters: [makeFighter({ port: 0, facing: 1, defId: "link", action: "special", move: "neutralB", actionFrame: 14, charge: 20 }), makeFighter({ port: 1, x: fx(gap) })] });
    expect(held(storeCharge(context(drawing(90), link)).input, Btn.Special)).toBe(true);
    expect(storeCharge(context(drawing(20), link)).input).toBe(0);
  });

  it("a level-9 Samus charges in a real match, stores it, and fires a full Charge Shot", () => {
    const rules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true } as const;
    let s = createInitialState("finalDestination", [{ defId: "samus" }, { defId: "mario" }], rules, 5);
    s.fighters.forEach((f, i) => Object.assign(f, { action: "stand", grounded: true, platform: 0, x: fx(i === 0 ? -70 : 70), y: 0, intangible: 0, facing: i === 0 ? 1 : -1 }));
    const world = cpuWorldFromDef(samus, FD, [samus, mario]);
    let seed = 3;
    let prev: InputFrame[] = [0, 0];
    let stored = false;
    let fired = false;
    for (let i = 0; i < 900 && !fired; i++) {
      const c = cpuInput(s, 0, 9, seed, world);
      seed = c.seed;
      const now = [c.input, 0];
      const before = s.fighters[0];
      s = step(s, now, { prevInputs: prev }).state;
      prev = now;
      if (s.fighters[0].combat.storedCharge >= samus.moves.neutralB!.specialCharge!.frames) stored = true;
      if (stored && s.fighters[0].action === "special" && s.fighters[0].move === "neutralB" && before.action !== "special") fired = true;
    }
    expect([stored, fired]).toEqual([true, true]);
  });
});

describe("a smash-input special", () => {
  it("Samus flicks a Super Missile from a standstill at an opponent lined up beyond close range, and it comes out as one", () => {
    const rules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true } as const;
    const s = createInitialState("finalDestination", [{ defId: "samus" }, { defId: "mario" }], rules, 5);
    s.fighters.forEach((f, i) => Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(i === 0 ? -30 : 30), y: 0, intangible: 0, facing: 1 }));
    const r = smashSpecial(context(s, samus));
    expect(r.input).toBe(Btn.Right | Btn.Special);
    const out = step(s, [r.input, 0], { prevInputs: [0, 0] }).state;
    expect([out.fighters[0].action, out.fighters[0].move]).toEqual(["special", "sideBSmash"]);
  });

  it("does not throw a second Boomerang while one is out", () => {
    const s = makeState({ fighters: [makeFighter({ port: 0, defId: "link", actionFrame: 0 }), makeFighter({ port: 1, x: fx(60) })] });
    expect(smashSpecial(context(s, link)).score).toBeGreaterThan(0);
    s.projectiles = [{ ...spawnProjectile(findProjectileDef(link, "boomerang")!, s.fighters[0], 1), x: fx(20) }];
    expect(smashSpecial(context(s, link)).score).toBe(0);
  });
});

/* ------------------------------------------------- carries, mouthfuls, grabs -- */

describe("carries, mouthfuls and grabs", () => {
  it("Donkey Kong carries his cargo toward the nearer edge, and throws it there", () => {
    const dk = (x: number, actionFrame: number) => makeState({ fighters: [makeFighter({ port: 0, action: "cargoCarry", x: fx(x), actionFrame, defId: "donkeyKong" }), makeFighter({ port: 1, action: "cargoHeld" })] });
    const walking = [0, 1, 2, 3].map((f) => holding(context({ ...dk(30, 4), frame: f }, donkeyKong)).input);
    expect(walking.every((i) => held(i, Btn.Right) && !held(i, Btn.Attack))).toBe(true);
    const there = [0, 1, 2, 3].map((f) => holding(context({ ...dk(70, 4), frame: f }, donkeyKong)).input);
    expect(there.some((i) => held(i, Btn.Attack) && held(i, Btn.Right))).toBe(true);
    const late = [0, 1, 2, 3].map((f) => holding(context({ ...dk(0, CARGO_CARRY_FRAMES), frame: f }, donkeyKong)).input);
    expect(late.some((i) => held(i, Btn.Attack))).toBe(true);
  });

  it("Kirby inhales an opponent in front within its own reach, at an opening", () => {
    const reach = (gap: number, actionFrame = 0) => makeState({ fighters: [makeFighter({ port: 0, defId: "kirby", facing: 1, actionFrame }), makeFighter({ port: 1, x: fx(gap) })] });
    expect(holding(context(reach(8), kirby)).input).toBe(Btn.Special);
    expect(holding(context(reach(60), kirby)).score).toBe(0);
    expect(holding(context(reach(8, 9), { ...kirby }, 9)).score).toBe(0);
    expect(holding(context(reach(8), kirby, 9, rollsWith(ROLL_SPECIAL, 0.99))).score).toBe(0);
    // With a Copy Ability his neutral special is the copied one: no Inhale.
    const s = reach(8);
    s.fighters[0].combat.copy = "mario";
    const world = cpuWorldFromDef(kirby, DEFAULT_STAGE_VIEW, [kirby, mario]);
    expect(decideCpu(s, 0, 9, 1, world).scores.holding ?? 0).toBe(0);
  });

  it("Kirby inhales from a standstill, not from a dash or a run, whose speed slides the Inhale past (Plan 5 final wave, fix round 1)", () => {
    // kirby-marth@pokemonStadium2 off the committed stages: from his dash's first frame
    // 6 from an idle Marth, the Inhale slid past him and missed, every 64 frames.
    const from = (action: "stand" | "walk" | "dashStart" | "run" | "runBrake", speed: number) => makeState({ fighters: [makeFighter({ port: 0, defId: "kirby", facing: 1, action, actionFrame: 0, vx: fx(speed) }), makeFighter({ port: 1, x: fx(8) })] });
    expect(holding(context(from("stand", 0), kirby)).input).toBe(Btn.Special);
    expect(holding(context(from("walk", 0.9), kirby)).input, "a walk does not slide it").toBe(Btn.Special);
    expect(holding(context(from("dashStart", 1.8), kirby)).score).toBe(0);
    expect(holding(context(from("run", 1.8), kirby)).score).toBe(0);
    // Fix round 2 (ruling R-FW1r): the slide, not the state. The run's brake keeps the
    // run's speed, and the Inhale from it slid past (re-review 2: 18 of 145 scenes).
    expect(holding(context(from("runBrake", 1.5), kirby)).score, "the run's brake").toBe(0);
  });

  it("Kirby does not inhale an invincible target (ruling R-FW1r: a respawn's invincibility)", () => {
    const s = makeState({ fighters: [makeFighter({ port: 0, defId: "kirby", facing: 1, actionFrame: 0 }), makeFighter({ port: 1, x: fx(8), invincible: 60, actionFrame: 30 })] });
    expect(holding(context(s, kirby)).score).toBe(0);
  });

  it("Kirby does not inhale a fighter hanging on the ledge, whom the Inhale cannot catch (fix round 2: the engine's inhaleMayCatch)", () => {
    // kirby-fox@finalDestination, the committed rotation: Kirby at the ledge inhaled at a
    // Fox hanging on it every time he stood again, for 2,701 frames.
    const hanging = makeState({ fighters: [makeFighter({ port: 0, defId: "kirby", facing: 1, actionFrame: 0 }), makeFighter({ port: 1, x: fx(8), grounded: false, action: "ledgeHang", actionFrame: 30, ledge: { platform: 0, side: 1 } })] });
    expect(holding(context(hanging, kirby)).score).toBe(0);
  });

  it("Kirby spits his mouthful toward the nearer edge, and swallows it facing in", () => {
    const k = (facing: number) => makeState({ fighters: [makeFighter({ port: 0, action: "inhaleHold", x: fx(40), facing }), makeFighter({ port: 1, action: "swallowed" })] });
    const press = (facing: number) => [0, 1].map((f) => holding(context({ ...k(facing), frame: f }, kirby)).input).reduce((a, b) => a | b, 0);
    expect(press(1) & (Btn.Attack | Btn.Special)).toBe(Btn.Attack);
    expect(press(-1) & (Btn.Attack | Btn.Special)).toBe(Btn.Special);
  });

  it("does not inhale a target it cannot catch: intangible, or held already", () => {
    // Seen intangible: its action noticed (ruling R-T19k: the CPU sees what goes with
    // the action it has seen, `observe`).
    const s = makeState({ fighters: [makeFighter({ port: 0, defId: "kirby", facing: 1, actionFrame: 0 }), makeFighter({ port: 1, x: fx(8), intangible: 10, actionFrame: 30 })] });
    expect(holding(context(s, kirby)).score).toBe(0);
    s.fighters[1] = makeFighter({ port: 1, x: fx(8), grabbedBy: 2 });
    expect(holding(context(s, kirby)).score).toBe(0);
  });

  it("Kirby swallows or spits", () => {
    const k = makeState({ fighters: [makeFighter({ port: 0, action: "inhaleHold" }), makeFighter({ port: 1, action: "swallowed" })] });
    const kIn = [0, 1, 2, 3, 4, 5, 6, 7].map((f) => holding(context({ ...k, frame: f }, kirby)).input);
    expect(kIn.some((i) => held(i, Btn.Special) || held(i, Btn.Attack))).toBe(true);
  });

  it("decides a grab once each time the hold comes back: pummel, or throw toward the nearer edge", () => {
    const grab = (x: number, facing: number, actionFrame = 0) =>
      makeState({ fighters: [makeFighter({ port: 0, action: "grabHold", x: fx(x), facing, actionFrame }), makeFighter({ port: 1, action: "grabbed", x: fx(x + 8 * facing) })] });
    expect(holding(context(grab(40, 1), mario)).input).toBe(Btn.Attack);
    const forward = holding(context(grab(40, 1), mario, 9, rollsWith(ROLL_SPECIAL, 0.9)));
    expect([forward.input, forward.decided]).toEqual([Btn.Right, true]);
    expect(holding(context(grab(40, -1), mario, 9, rollsWith(ROLL_SPECIAL, 0.9))).input).toBe(Btn.Right);
    // Later in the hold, and through a pummel, it presses nothing at all.
    expect(holding(context(grab(40, 1, 3), mario)).input).toBe(0);
  });

  it("a level-9 Mario that grabs throws, rather than holding on until the grab runs out", () => {
    const rules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true } as const;
    let s = createInitialState("finalDestination", [{ defId: "mario" }, { defId: "fox" }], rules, 9);
    s.fighters.forEach((f, i) => Object.assign(f, { action: "stand", grounded: true, platform: 0, x: fx(i === 0 ? 0 : 8), y: 0, intangible: 0, facing: i === 0 ? 1 : -1 }));
    const world = cpuWorldFromDef(mario, FD, [mario, fox]);
    let prev: InputFrame[] = [0, 0];
    s = step(s, [Btn.Grab, 0], { prevInputs: prev }).state;
    prev = [Btn.Grab, 0];
    let seed = 11;
    let thrown = false;
    for (let i = 0; i < 200 && !thrown; i++) {
      const c = cpuInput(s, 0, 9, seed, world);
      seed = c.seed;
      const now = [c.input, 0];
      s = step(s, now, { prevInputs: prev }).state;
      prev = now;
      if (s.fighters[0].action === "throw") thrown = true;
    }
    expect(thrown).toBe(true);
  });

  it("a level-9 Donkey Kong that grabs facing the nearer edge carries the fighter there and throws them from his shoulders", () => {
    const rules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true } as const;
    let s = createInitialState("finalDestination", [{ defId: "donkeyKong" }, { defId: "mario" }], rules, 9);
    s.fighters.forEach((f, i) => Object.assign(f, { action: "stand", grounded: true, platform: 0, x: fx(i === 0 ? 30 : 40), y: 0, intangible: 0, facing: i === 0 ? 1 : -1 }));
    const world = cpuWorldFromDef(donkeyKong, FD, [donkeyKong, mario]);
    let prev: InputFrame[] = [Btn.Grab, 0];
    s = step(s, [Btn.Grab, 0], { prevInputs: [0, 0] }).state;
    let seed = 2;
    const seen = new Set<string>();
    for (let i = 0; i < 300 && !seen.has("cargoThrow"); i++) {
      const c = cpuInput(s, 0, 9, seed, world);
      seed = c.seed;
      const now = [c.input, 0];
      s = step(s, now, { prevInputs: prev }).state;
      prev = now;
      seen.add(s.fighters[0].action);
      if (s.fighters[0].action === "throw" && s.fighters[0].move?.startsWith("cargo") === true) seen.add("cargoThrow");
    }
    expect(["cargoCarry", "cargoThrow"].filter((a) => !seen.has(a))).toEqual([]);
  });

  it("mashes out of a grab every few frames by its level, a shield press and a fresh direction", () => {
    const held_ = makeState({ fighters: [makeFighter({ port: 0, action: "grabbed", grabbedBy: 1 }), makeFighter({ port: 1, action: "grabHold", grabbing: 0, x: fx(8) })] });
    const period = mashPeriod(tuningForLevel(9).sdiSkill);
    const ins = Array.from({ length: period * 4 }, (_, f) => mash(context({ ...held_, frame: f }, mario)).input);
    expect(ins.filter((i) => held(i, Btn.Shield)).length).toBe(4);
    const sides = ins.filter((i) => i !== 0).map((i) => (held(i, Btn.Left) ? "L" : "R"));
    expect(new Set(sides)).toEqual(new Set(["L", "R"]));
    expect(mashPeriod(tuningForLevel(1).sdiSkill)).toBeGreaterThan(period);
    // Not a Final Smash's trap.
    const trapped = makeState({ fighters: [makeFighter({ port: 0, action: "finalTrapped" }), makeFighter({ port: 1 })] });
    expect(mash(context(trapped, mario)).score).toBe(0);
    // A broken shield's stun on the ground is mashed too (`MASHED`); in the air it is not.
    const broken = makeState({ fighters: [makeFighter({ port: 0, action: "shieldBroken" }), makeFighter({ port: 1, x: fx(30) })] });
    expect(mash(context(broken, mario)).score).toBeGreaterThan(0);
    broken.fighters[0] = makeFighter({ port: 0, action: "shieldBroken", grounded: false });
    expect(mash(context(broken, mario)).score).toBe(0);
  });

  it("a level-9 CPU held in a grab gets out sooner than one that does nothing", () => {
    const heldFor = (level: number | null) => {
      const rules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true } as const;
      let s = createInitialState("finalDestination", [{ defId: "mario" }, { defId: "fox" }], rules, 9);
      s.fighters.forEach((f, i) => Object.assign(f, { action: "stand", grounded: true, platform: 0, x: fx(i === 0 ? 8 : 0), y: 0, intangible: 0, facing: i === 0 ? -1 : 1, damage: fx(60) }));
      const world = cpuWorldFromDef(mario, FD, [mario, fox]);
      let prev: InputFrame[] = [0, Btn.Grab];
      s = step(s, [0, Btn.Grab], { prevInputs: [0, 0] }).state;
      // Fox's catch lands a few frames on; Fox then holds on, pressing nothing.
      for (let i = 0; i < 20 && s.fighters[0].action !== "grabbed"; i++) {
        s = step(s, [0, 0], { prevInputs: prev }).state;
        prev = [0, 0];
      }
      expect(s.fighters[0].action).toBe("grabbed");
      let seed = 1;
      let frames = 0;
      while (frames < 400 && s.fighters[0].action !== "stand" && s.fighters[0].action !== "fall") {
        let input = 0;
        if (level !== null) {
          const c = cpuInput(s, 0, level, seed, world);
          seed = c.seed;
          input = c.input;
        }
        const now = [input, 0];
        s = step(s, now, { prevInputs: prev }).state;
        prev = now;
        frames++;
      }
      return frames;
    };
    expect(heldFor(9)).toBeLessThan(heldFor(null));
  });
});

/* ---------------------------------------------------------- side recovery -- */

describe("side recovery", () => {
  it("Fox recovers sideways with Fox Illusion when level with the stage and out of jumps", () => {
    // The plan's y −4 is too low here: Fox falls 27 in its 17 frames of startup
    // before the dash (`fox.ts`), which then passes under the ledge. From 25 above the
    // stage's top, its own path comes past the ledge within a grab of it (the model's
    // grab range leaves the body's half-width out, so it must pass within 3.2).
    const s = makeState({ fighters: [makeFighter({ port: 0, grounded: false, action: "fall", x: fx(137), y: fx(25), jumpsUsed: 2, defId: "fox", facing: -1 }), makeFighter({ port: 1 })] });
    const r = sideRecover(context(s, fox));
    expect(held(r.input, Btn.Left) && held(r.input, Btn.Special)).toBe(true);
  });

  it("not where its path would not get it back, and not with a jump left", () => {
    const tooFar = makeState({ fighters: [makeFighter({ port: 0, grounded: false, action: "fall", x: fx(220), y: fx(20), jumpsUsed: 2, defId: "fox", facing: -1 }), makeFighter({ port: 1 })] });
    expect(sideRecover(context(tooFar, fox)).score).toBe(0);
    const tooLow = makeState({ fighters: [makeFighter({ port: 0, grounded: false, action: "fall", x: fx(140), y: fx(-4), jumpsUsed: 2, defId: "fox", facing: -1 }), makeFighter({ port: 1 })] });
    expect(sideRecover(context(tooLow, fox)).score).toBe(0);
    const jumpLeft = makeState({ fighters: [makeFighter({ port: 0, grounded: false, action: "fall", x: fx(140), y: fx(20), jumpsUsed: 1, defId: "fox", facing: -1 }), makeFighter({ port: 1 })] });
    expect(sideRecover(context(jumpLeft, fox)).score).toBe(0);
  });

  it("rolls once an offstage episode: on the first frame its path gets it back, and a failed roll leaves the episode to the up special (ruling R-T19i)", () => {
    // Fox out of jumps, falling at Battlefield's right side from high above, drifting
    // home as `recover` holds it; the side special evaluated with its roll passed and
    // failed on every frame of the fall, the fall run on by the engine.
    // The last scene spends its midair jump on the first frame, inside the window: it
    // decides in the rise, and the fall after the top is the same window (`sideBefore`).
    for (const [x0, y0, jump] of [[150, 70, false], [140, 90, false], [160, 60, false], [130, -5, true]] as const) {
      let s = createInitialState("battlefield", [{ defId: "fox" }, { defId: "mario" }], { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true } as const, 5);
      Object.assign(s.fighters[0], { action: "fall", actionFrame: 0, grounded: false, platform: -1, x: fx(x0), y: fx(y0), jumpsUsed: jump ? 1 : 2, facing: -1, intangible: 0, invincible: 0 });
      Object.assign(s.fighters[1], { x: 0, intangible: 0, invincible: 0 });
      const bf = stageViewFromDef(STAGES.find((x) => x.id === "battlefield")!);
      let prev: InputFrame[] = [0, 0];
      const decided: number[] = [];
      let rose = false;
      let decidedIn = "";
      for (let k = 0; k < 120 && (s.fighters[0].action === "fall" || s.fighters[0].action === "jump"); k++) {
        if (s.fighters[0].action === "jump") rose = true;
        // Level 7 (recoverySkill 0.88): level 9's 1.0 never fails.
        const pass = sideRecover(context(s, fox, 7, rollsWith(ROLL_SPECIAL, 0), bf));
        const fail = sideRecover(context(s, fox, 7, rollsWith(ROLL_SPECIAL, 0.95), bf));
        expect(fail.score, `${x0},${y0} frame ${k}: a failed roll presses nothing`).toBe(0);
        if (pass.score > 0) {
          expect(pass.decided, `${x0},${y0} frame ${k}`).toBe(true);
          decided.push(k);
          decidedIn = s.fighters[0].action;
        }
        const drift = towardX(s.fighters[0].x, bf.rightLedge) | (jump && k === 0 ? Btn.Jump : 0);
        s = step(s, [drift, 0], { prevInputs: prev }).state;
        prev = [drift, 0];
      }
      expect(decided.length, `${x0},${y0}: ${decided.join(",")}`).toBe(1);
      expect(rose, `${x0},${y0}: the jump's rise`).toBe(jump);
      // Decided in the rise, and not again over its top.
      if (jump) expect(decidedIn).toBe("jump");
    }
  });

  it("decides a window opened in a jump's rise exactly once (the Task 19 re-review's New Breakage 5)", () => {
    // Fox and Donkey Kong spend their midair jump off Battlefield's right side, drifting
    // home: the window opens in the rise. The rebuilt frame before (`sideBefore`) has to
    // say "out of it" on its first frame and "in it" on every later one.
    const bf = stageViewFromDef(STAGES.find((x) => x.id === "battlefield")!);
    for (const [id, x0, y0] of [["fox", 110, 0], ["fox", 115, 5], ["donkeyKong", 125, -15], ["donkeyKong", 135, -20]] as const) {
      const def = defOf(id);
      const sideDef = sideRecoveryFromDef(def)!;
      let s = createInitialState("battlefield", [{ defId: id }, { defId: "mario" }], { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true } as const, 5);
      Object.assign(s.fighters[0], { action: "fall", actionFrame: 0, grounded: false, platform: -1, x: fx(x0), y: fx(y0), jumpsUsed: def.attributes.jumps - 1, facing: -1, intangible: 0, invincible: 0 });
      Object.assign(s.fighters[1], { x: 0, intangible: 0, invincible: 0 });
      let prev: InputFrame[] = [0, 0];
      const windows: number[] = [];
      let open: number | null = null;
      let rose = false;
      for (let k = 0; k < 160 && (s.fighters[0].action === "fall" || s.fighters[0].action === "jump"); k++) {
        const me = s.fighters[0];
        const ledge = bf.rightLedge;
        const eligible =
          free(me) && isOffstage(me, bf) && me.jumpsUsed >= def.attributes.jumps && me.y >= bf.groundY - SIDE_RECOVER_BELOW && me.y <= bf.groundY + SIDE_RECOVER_ABOVE &&
          upBInReach(me, ledge, bf, sideDef, towardX(me.x, ledge), s.frame);
        if (eligible) {
          if (open === null) {
            open = 0;
            rose ||= me.action === "jump" && me.vy > 0;
          }
          if (sideRecover(context(s, def, 7, rollsWith(ROLL_SPECIAL, 0), bf)).score > 0) open++;
        } else if (open !== null) {
          windows.push(open);
          open = null;
        }
        const input = towardX(me.x, bf.rightLedge) | (k === 0 ? Btn.Jump : 0);
        s = step(s, [input, 0], { prevInputs: prev }).state;
        prev = [input, 0];
      }
      if (open !== null) windows.push(open);
      expect(rose, `${id} ${x0},${y0}: a window opened in the rise`).toBe(true);
      expect(windows, `${id} ${x0},${y0}`).toEqual(windows.map(() => 1));
      expect(windows.length).toBeGreaterThan(0);
    }
  });

  it("a level-1 Fox side-recovers at its recoverySkill: the roll is the level's", () => {
    const s = makeState({ fighters: [makeFighter({ port: 0, grounded: false, action: "fall", actionFrame: 0, x: fx(137), y: fx(25), jumpsUsed: 2, defId: "fox", facing: -1 }), makeFighter({ port: 1 })] });
    const L1 = tuningForLevel(1);
    expect(sideRecover(context(s, fox, 1, rollsWith(ROLL_SPECIAL, L1.recoverySkill - 0.01))).score).toBeGreaterThan(0);
    expect(sideRecover(context(s, fox, 1, rollsWith(ROLL_SPECIAL, L1.recoverySkill + 0.01))).score).toBe(0);
  });

  it("not a side special that carries nothing (Samus's Missile)", () => {
    const s = makeState({ fighters: [makeFighter({ port: 0, grounded: false, action: "fall", x: fx(100), y: fx(-4), jumpsUsed: 2, defId: "samus", facing: -1 }), makeFighter({ port: 1 })] });
    expect(sideRecover(context(s, samus)).score).toBe(0);
  });
});

/* ------------------------------------------------------------- the moveset -- */

describe("a Kirby CPU with a Copy Ability (Plan 5 review)", () => {
  it("fights with the copied neutral special, as the simulation runs it", () => {
    const self = makeFighter({ port: 0, defId: "kirby" });
    const world = { fighterDef: kirby, fighter: (id: string) => FIGHTERS.find((f) => f.id === id) };
    expect(cpuDef(self, world)).toBe(kirby);
    self.combat.copy = "samus";
    const copied = cpuDef(self, world)!;
    expect(copied.moves.neutralB?.name).toBe(samus.moves.neutralB?.name);
    // Charge Shot is a store-mode charge: the copied Kirby now charges it from afar.
    expect(copied.moves.neutralB?.specialCharge?.mode).toBe("store");
    // Without a lookup, the match's own definitions are the copy's source.
    expect(cpuDef(self, { fighterDef: kirby, matchDefs: [kirby, samus] })!.moves.neutralB?.name).toBe(samus.moves.neutralB?.name);
    expect(cpuDef(self, { fighterDef: kirby })).toBe(kirby);
  });

  it("charges a copied Charge Shot from afar", () => {
    const s = makeState({ fighters: [makeFighter({ port: 0, defId: "kirby", facing: 1, actionFrame: 0 }), makeFighter({ port: 1, x: fx(90), defId: "samus" })] });
    s.fighters[0].combat.copy = "samus";
    const world = cpuWorldFromDef(kirby, DEFAULT_STAGE_VIEW, [kirby, samus]);
    const d = decideCpu(s, 0, 9, 1, world);
    expect(d.scores.storeCharge ?? 0).toBeGreaterThan(0);
  });
});

describe("a state free to act (`free`)", () => {
  it("is one the engine reads a press in at once, out of hitstun and hitlag", () => {
    expect(free(makeFighter({ action: "stand" }))).toBe(true);
    expect(free(makeFighter({ action: "fall", grounded: false }))).toBe(true);
    expect(free(makeFighter({ action: "fall", grounded: false, hitlag: 3 }))).toBe(false);
    expect(free(makeFighter({ action: "turnaround" }))).toBe(false);
    expect(free(makeFighter({ action: "attack", move: "jab1" }))).toBe(false);
    // A tumble's fall reads a press as a fall does (`airMain`), and a crawl as a crouch does.
    expect(free(makeFighter({ action: "tumbleFall", grounded: false }))).toBe(true);
    expect(free(makeFighter({ action: "crawl" }))).toBe(true);
    expect(free(makeFighter({ action: "landingLag" }))).toBe(false);
  });
});

describe("the behaviour set (Plan 5, Task 19)", () => {
  it("lists every special behaviour, each once", () => {
    const names = BEHAVIOURS.map((b) => b.name);
    for (const n of ["mash", "sideRecover", "holding", "finalSmash", "reflect", "counter", "storeCharge", "smashSpecial", "smashBall"]) expect(names.filter((x) => x === n)).toEqual([n]);
  });
});

/* ------------------------------------------------------------ Review Focus -- */

describe("Review Focus: a CPU and the Smash Ball", () => {
  it("goes and breaks the Smash Ball, then uses its Final Smash", () => {
    const rules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: true, oneOnOne: true } as const;
    let s = createInitialState("finalDestination", [{ defId: "mario" }, { defId: "fox" }], rules, 31);
    s.fighters.forEach((f, i) => Object.assign(f, { action: "stand", grounded: true, platform: 0, x: fx(i === 0 ? -30 : 70), y: 0, intangible: 0 }));
    s.smashBall = { active: true, x: fx(0), y: fx(10), vx: 0, vy: 0, health: fx(40), driftTimer: 0 };
    const world = cpuWorldFromDef(mario, FD, [mario, fox]);
    let seed = 99;
    let prev: InputFrame[] = [0, 0];
    let broke = -1;
    let used = -1;
    for (let i = 0; i < 1500 && used < 0; i++) {
      const c = cpuInput(s, 0, 9, seed, world);
      seed = c.seed;
      const now = [c.input, 0];
      const out = step(s, now, { prevInputs: prev });
      s = out.state;
      prev = now;
      if (out.events.smashBallBroken === 0 && broke < 0) broke = i;
      if (out.events.finalSmashes.includes(0)) used = i;
    }
    expect(broke).toBeGreaterThanOrEqual(0);
    expect(used).toBeGreaterThan(broke);
  });
});
