/**
 * The seam's own tests.
 *
 * `matchRunner` is the only module between the pure simulation and the browser,
 * and it is the module that shipped without a test file — which is exactly why
 * both integration bugs found in play testing lived here rather than in the
 * engine, the renderer or the input layer, all of which are covered thoroughly.
 * Every module it drives is a collaborator it must call *every frame*, and
 * forgetting one is silent: the simulation still advances, the canvas still
 * paints, and the failure only shows up as "the game feels broken".
 *
 * So these tests assert the drive, not the arithmetic. The arithmetic already
 * has tests of its own.
 */

import { beforeAll, describe, expect, it } from "vitest";
import {
  createMatchRunner,
  type MatchAudio,
  type MatchRunner,
  type PlayerSlot,
} from "./matchRunner";
import { bootstrapEngine, getFighterOrThrow, getStageOrThrow } from "./bootstrap";
import { meleeReachFromDef } from "@/ai/behaviours";
import type { MatchRules } from "@/engine/types";

const RULES: MatchRules = {
  mode: "stock",
  stocks: 3,
  timeLimit: 60 * 60 * 7,
  smashBall: false,
  oneOnOne: true,
};

/**
 * Two fighters, no CPU and no keyboard, so every input is zero on every frame.
 * A match that nobody is playing is the strictest possible bed for "does the
 * cosmetic state settle": anything still on screen after the fighters have
 * landed and stopped moving is something that is not being cleaned up.
 */
function idleRunner(audio?: MatchAudio): MatchRunner {
  const players: PlayerSlot[] = [
    { selection: { defId: "mario" }, cpuLevel: null, label: "P1" },
    { selection: { defId: "donkeyKong" }, cpuLevel: null, label: "P2" },
  ];
  return createMatchRunner({
    stage: getStageOrThrow("battlefield"),
    players,
    rules: RULES,
    seed: 0x5eed1e55,
    getFighter: getFighterOrThrow,
    audio,
  });
}

/** Counts the calls the loop is contractually required to make. */
function spyAudio(): MatchAudio & { events: number; shieldCalls: number } {
  return {
    events: 0,
    shieldCalls: 0,
    handleEvents() {
      this.events++;
    },
    setShieldHeld() {
      this.shieldCalls++;
    },
  };
}

beforeAll(() => {
  bootstrapEngine();
});

describe("the runner drives its cosmetic state", () => {
  it("ages the vfx once per simulation frame", () => {
    const runner = idleRunner();
    expect(runner.vfx.frame).toBe(0);

    runner.advance(30);

    // Not "greater than zero" — exactly in step. A vfx clock that advances at a
    // different rate than the simulation would make every particle lifetime,
    // all of which are authored in frames, wrong by that ratio.
    expect(runner.vfx.frame).toBe(30);
    expect(runner.frame).toBe(30);
  });

  it("clears the full-screen KO flash instead of leaving it on the screen", () => {
    const runner = idleRunner();

    // The state a blast-zone KO puts the screen into: `ingestEvents` sets this
    // to 12 and nothing else ever writes it, so if the runner does not age it,
    // a player who loses a stock plays the rest of the match through a white
    // wash. That is precisely the bug this asserts against.
    runner.vfx.koFlash = 12;
    runner.vfx.koFlashMax = 12;

    runner.advance(12);

    expect(runner.vfx.koFlash).toBe(0);
  });

  it("lets hit particles expire rather than accumulating them", () => {
    const runner = idleRunner();

    // Fighters spawn above the stage, so they fall and land within the first
    // second, and a landing spawns dust. Using the match's own particles rather
    // than hand-pushed ones keeps this honest: it proves the real path from
    // `step` → `ingestEvents` → `updateVfx` completes.
    //
    // Sampled every frame rather than read once at the end, because the peak is
    // the *point*: dust lives 16 frames, so a single reading taken after it has
    // already expired cannot tell "cleaned up correctly" from "never spawned",
    // and would pass just as happily against a runner that draws nothing.
    let peak = 0;
    for (let i = 0; i < 90; i++) {
      runner.advance(1);
      peak = Math.max(peak, runner.vfx.particles.length);
    }
    expect(peak).toBeGreaterThan(0);

    // The longest particle authored anywhere in `vfx.ts` is 30 frames (smoke),
    // so twice that with two idle fighters must leave the screen clean.
    runner.advance(60);
    expect(runner.vfx.particles.length).toBe(0);
  });

  it("drives the audio engine every frame", () => {
    // The whole `src/audio` module was unreachable at one point: fully written,
    // fully unit-tested, and imported by nothing, so the game was silent. A
    // module that is correct in isolation and never called is indistinguishable
    // from a module that does not exist, and only the seam can tell them apart.
    const audio = spyAudio();
    const runner = idleRunner(audio);

    runner.advance(20);

    expect(audio.events).toBe(20);
    // Level-triggered, so it is per fighter per frame rather than on an edge.
    expect(audio.shieldCalls).toBe(20 * 2);
  });

  it("runs a match with no audio at all", () => {
    // Sound is optional — a headless test and a browser that refuses to build
    // an AudioContext both land here, and neither should take the match down.
    const runner = idleRunner();
    expect(() => runner.advance(10)).not.toThrow();
  });

  it("clears the per-fighter hit flash", () => {
    const runner = idleRunner();
    runner.vfx.hitFlash[0] = 4;
    runner.vfx.parryFlash[1] = 10;

    runner.advance(10);

    expect(runner.vfx.hitFlash[0]).toBe(0);
    expect(runner.vfx.parryFlash[1]).toBe(0);
  });
});

describe("a CPU's swing range matches its arms", () => {
  // Every fighter, because the threshold was wrong *per fighter*: it came from
  // one roster-wide constant, so whether a CPU could reach depended entirely on
  // whose arms it happened to have.
  const ROSTER = [
    "mario",
    "donkeyKong",
    "link",
    "samus",
    "kirby",
    "fox",
    "marth",
    "pikachu",
  ] as const;

  for (const defId of ROSTER) {
    it(`${defId} never swings from further than it can reach`, () => {
      const def = getFighterOrThrow(defId);
      const reach = meleeReachFromDef(def);

      // The distance the CPU commits to attacking from has to be one both of
      // its default pokes actually cover — it does not get to choose which
      // comes out. A reach longer than either is the whiff deadlock: the CPU
      // stops approaching, starts swinging, connects with nothing, and because
      // the state is then identical next frame, decides the same thing forever.
      for (const slot of ["jab1", "ftilt"] as const) {
        const move = def.moves[slot];
        if (!move || move.hitboxes.length === 0) continue;
        const furthest = Math.max(...move.hitboxes.map((h) => h.x + h.radius));
        expect(reach).toBeLessThanOrEqual(furthest);
      }

      // And a positive one, or the CPU would walk into the opponent and never
      // throw a punch at all — the same deadlock from the other side.
      expect(reach).toBeGreaterThan(0);
    });
  }

});
