// @vitest-environment node
/**
 * A level-9 CPU against a player who stands still (Plan 5 final wave, ruling R-FW1c;
 * the final review's I1).
 *
 * The final review found a level-9 CPU next to a standing opponent turning every
 * frame and never attacking: a full press toward a target just behind it started a
 * dash that carried it past, so next frame the target was behind it again (31 of the
 * 64 matchups danced for 30 s or more against an idle human). Nothing the CPU sweeps
 * measured caught it, because two CPUs rarely stand still. This is the probe that
 * would have: every ordered pair of the eight fighters (64, mirrors included), round
 * the six stages, the Smash Ball off, the CPU on port 0 and nobody pressing anything
 * on port 1, stepped on the game's baked context.
 *
 * Each must land a hit within 10 s of game time (600 frames), and never turn in
 * place beside the player standing there: no stretch of `TURN_WINDOW` frames with more
 * than `MAX_TURNS` turns while it stands (a dash dance turns every frame). And no loop
 * may start after the first hit either (fix round 1, ruling R-FW1m): over `FRAMES`
 * frames, never `MAX_STRETCH` frames (20 s) with the player there to be hit (alive, out
 * of the respawn platform and the entry, neither intangible nor invincible) and no hit
 * landed. Step and check only, 64 matches of at most 3,600 frames: a few seconds alone,
 * longer beside the rest of the suite, hence its own timeout. It runs in `pnpm test`
 * like any other.
 */

import { describe, expect, it } from "vitest";

import { cpuWorldFromDef, decideCpu, type CpuWorld } from "@/ai/cpu";
import { isStunned, stageViewFromDef } from "@/ai/behaviours";
import { fx } from "@/engine/fixed";
import { createInitialState, step } from "@/engine/simulate";
import { Btn } from "@/engine/types";
import type { FighterState, GameState, InputFrame, MatchRules } from "@/engine/types";
import { FIGHTERS } from "@/fighters";
import { STAGES } from "@/stages";
import { bakedContext } from "./bake";
import { readBakeFromDisk } from "./bakeNode";

const BY_ID = new Map(FIGHTERS.map((f) => [f.id, f]));
const STAGE_BY_ID = new Map(STAGES.map((s) => [s.id, s]));
const CTX = bakedContext({ fighter: (id) => BY_ID.get(id)!, stage: (id) => STAGE_BY_ID.get(id)! }, readBakeFromDisk());
const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true };

/** The ruling's bound: a hit within 10 s of game time. */
const FIRST_HIT_BY = 600;
/** How long each match runs: long enough for a loop to begin after the first hit and run past `MAX_STRETCH`. */
const FRAMES = 3_600;
/** Ruling R-FW1m: the most frames the player may stand there to be hit without one landing. */
const MAX_STRETCH = 1_200;
/** The same with the Smash Ball on (part 3): its chase and a Final Smash's scene take their time. */
const BALL_MAX_STRETCH = 1_800;
/** Where nobody can be hit: dead, entering, or on the respawn platform. */
const ABSENT: ReadonlySet<string> = new Set(["dead", "entering", "respawnPlatform"]);
/** UNVERIFIED (test judgement): a stretch this long with more turns than `MAX_TURNS` in it is turning in place. */
const TURN_WINDOW = 30;
const MAX_TURNS = 10;

interface Played {
  /** The frame the first hit landed on, or -1. */
  readonly firstHit: number;
  /** The most turns port 0 made in any `TURN_WINDOW` frames. */
  readonly turns: number;
  /** The longest run of frames port 1 could be hit and was not. */
  readonly stretch: number;
}

/**
 * Step `state` for up to `frames` frames, the ports in `cpus` played by level-9 CPUs and
 * the rest by nobody. With `standing`, port 0's turns count only while port 1 stands on the
 * ground (I1's situation: a CPU next to a player who stands still); without, every turn.
 */
function play(start: GameState, cpus: readonly number[], frames: number, standing = false): Played {
  let state = start;
  const view = stageViewFromDef(CTX.stage(state.stageId));
  const defs = state.fighters.map((f) => CTX.fighter(f.defId));
  const worlds: CpuWorld[] = defs.map((def) => cpuWorldFromDef(def, view, defs, (id) => CTX.fighter(id), CTX.bake));
  let seed = state.rngSeed ^ 0x1f2e3d4c;
  let prev: readonly InputFrame[] = state.fighters.map(() => 0);
  let firstHit = -1;
  const turnedAt: number[] = [];
  let turns = 0;
  let run = 0;
  let stretch = 0;
  for (let frame = 1; frame <= frames && state.outcome === null; frame++) {
    const inputs = state.fighters.map((_, port) => {
      if (!cpus.includes(port)) return 0;
      const d = decideCpu(state, port, 9, seed, worlds[port]);
      seed = d.seed;
      return d.input;
    });
    const out = step(state, inputs, { prevInputs: prev, ctx: CTX });
    const still = !standing || (out.state.fighters[1].action === "stand" && out.state.fighters[1].grounded);
    if (still && out.state.fighters[0].facing !== state.fighters[0].facing) turnedAt.push(frame);
    while (turnedAt.length > 0 && turnedAt[0] <= frame - TURN_WINDOW) turnedAt.shift();
    turns = Math.max(turns, turnedAt.length);
    if (firstHit < 0 && out.events.hits.length > 0) firstHit = frame;
    const p1 = out.state.fighters[1];
    const hittable = p1.stocks > 0 && !ABSENT.has(p1.action) && p1.intangible === 0 && p1.invincible === 0;
    run = hittable && !out.events.hits.some((h) => h.victim === 1) ? run + 1 : 0;
    stretch = Math.max(stretch, run);
    state = out.state;
    prev = inputs;
  }
  return { firstHit, turns, stretch };
}

/** The first step on which port 0, a level-9 CPU over an idle port 1, has left the platform it stood on, within `frames`, or -1. */
function dropsWithin(start: GameState, frames: number): number {
  let state = start;
  const view = stageViewFromDef(CTX.stage(state.stageId));
  const defs = state.fighters.map((f) => CTX.fighter(f.defId));
  const world: CpuWorld = cpuWorldFromDef(defs[0], view, defs, (id) => CTX.fighter(id), CTX.bake);
  const platform = start.fighters[0].platform;
  let prev: readonly InputFrame[] = [0, 0];
  let seed = 7;
  for (let frame = 1; frame <= frames; frame++) {
    const d = decideCpu(state, 0, 9, seed, world);
    seed = d.seed;
    state = step(state, [d.input, 0], { prevInputs: prev, ctx: CTX }).state;
    prev = [d.input, 0];
    if (state.fighters[0].platform !== platform) return frame;
  }
  return -1;
}

/**
 * Port 0, a level-9 CPU, from `start` against an idle port 1 for up to `frames` frames: the
 * step it first hits on (-1 for none), and the frames it spent off the main floor (the
 * stage's platform 0) after it first stood there.
 */
function onTheFloor(start: GameState, frames: number): { readonly firstHit: number; readonly off: number } {
  let state = start;
  const view = stageViewFromDef(CTX.stage(state.stageId));
  const defs = state.fighters.map((f) => CTX.fighter(f.defId));
  const world: CpuWorld = cpuWorldFromDef(defs[0], view, defs, (id) => CTX.fighter(id), CTX.bake);
  let prev: readonly InputFrame[] = [0, 0];
  let seed = 7;
  let stood = false;
  let off = 0;
  for (let frame = 1; frame <= frames; frame++) {
    const d = decideCpu(state, 0, 9, seed, world);
    seed = d.seed;
    const out = step(state, [d.input, 0], { prevInputs: prev, ctx: CTX });
    state = out.state;
    prev = [d.input, 0];
    const f = state.fighters[0];
    const floor = f.grounded && f.platform === 0;
    stood ||= floor;
    if (stood && !floor) off++;
    if (out.events.hits.some((h) => h.attacker === 0)) return { firstHit: frame, off };
  }
  return { firstHit: -1, off };
}

/**
 * Port 0, a level-9 CPU, from `start` against an idle port 1 for up to `frames` frames: the
 * step it first hits on (-1 for none), and how many swings it started before that, each of
 * which, had it landed, would have been that hit (a swing that ends without a hit).
 */
function swingsUntilHit(start: GameState, frames: number): { readonly firstHit: number; readonly whiffs: number } {
  let state = start;
  const view = stageViewFromDef(CTX.stage(state.stageId));
  const defs = state.fighters.map((f) => CTX.fighter(f.defId));
  const world: CpuWorld = cpuWorldFromDef(defs[0], view, defs, (id) => CTX.fighter(id), CTX.bake);
  let prev: readonly InputFrame[] = [0, 0];
  let seed = 7;
  let whiffs = 0;
  for (let frame = 1; frame <= frames; frame++) {
    const d = decideCpu(state, 0, 9, seed, world);
    seed = d.seed;
    const before = state.fighters[0];
    const out = step(state, [d.input, 0], { prevInputs: prev, ctx: CTX });
    state = out.state;
    prev = [d.input, 0];
    if (out.events.hits.some((h) => h.attacker === 0)) return { firstHit: frame, whiffs };
    const f = state.fighters[0];
    // A swing ended: its attack left for anything but a new one (a jab's next hit counts as the same swing).
    if (before.action === "attack" && f.action !== "attack") whiffs++;
  }
  return { firstHit: -1, whiffs };
}

/** Port 0, a level-9 CPU, from `start` against an idle port 1: the step it loses a stock on within `frames`, or -1. */
function cpuDeathWithin(start: GameState, frames: number): number {
  let state = start;
  const view = stageViewFromDef(CTX.stage(state.stageId));
  const defs = state.fighters.map((f) => CTX.fighter(f.defId));
  const world: CpuWorld = cpuWorldFromDef(defs[0], view, defs, (id) => CTX.fighter(id), CTX.bake);
  let prev: readonly InputFrame[] = [0, 0];
  let seed = 7;
  for (let frame = 1; frame <= frames; frame++) {
    const d = decideCpu(state, 0, 9, seed, world);
    seed = d.seed;
    const out = step(state, [d.input, 0], { prevInputs: prev, ctx: CTX });
    state = out.state;
    prev = [d.input, 0];
    if (out.events.kos.some((ko) => ko.port === 0)) return frame;
  }
  return -1;
}

/** The CPU 40 in on `side` of Town & City, the idle `b` on that side's outer platform `out` from the middle, from frame `phase`. */
function outerPlatformScene(a: string, b: string, side: number, out: number, phase: number): GameState {
  const stage = CTX.stage("townAndCity");
  const index = stage.platforms.findIndex((p) => p.soft && Math.sign(p.x) === side && Math.abs(p.x) > fx(60));
  const s = createInitialState("townAndCity", [{ defId: a }, { defId: b }], RULES, 5, CTX);
  placed(s.fighters[0], { x: fx(40 * side), y: 0, platform: 0, action: "stand", actionFrame: 30, facing: side });
  placed(s.fighters[1], { x: fx(out * side), y: stage.platforms[index].y, platform: index, action: "stand", actionFrame: 30, facing: -side });
  s.frame = phase;
  return s;
}

/** `id` on `stage` as the scene has it: grounded, out of the entry's intangibility. */
function placed(f: FighterState, over: Partial<FighterState>): void {
  Object.assign(f, { actionFrame: 0, intangible: 0, invincible: 0, grounded: true, ...over });
}

describe("a level-9 CPU against a player who stands still (ruling R-FW1c; the final review's I1)", () => {
  it("lands a hit within 10 s in every one of the 64 matchups, the Smash Ball off, and never turns in place", () => {
    const ids = FIGHTERS.map((f) => f.id);
    const late: string[] = [];
    const dancing: string[] = [];
    const stuck: string[] = [];
    let n = 0;
    for (const a of ids)
      for (const b of ids) {
        const stageId = STAGES[n % STAGES.length].id;
        const { firstHit, turns, stretch } = play(createInitialState(stageId, [{ defId: a }, { defId: b }], RULES, 1000 + n, CTX), [0], FRAMES, true);
        if (firstHit < 0 || firstHit > FIRST_HIT_BY) late.push(`${a}-${b}@${stageId}: ${firstHit}`);
        if (turns > MAX_TURNS) dancing.push(`${a}-${b}@${stageId}: ${turns} turns in ${TURN_WINDOW} frames`);
        if (stretch > MAX_STRETCH) stuck.push(`${a}-${b}@${stageId}: ${stretch} frames there to be hit, no hit`);
        n++;
      }
    expect(n).toBe(64);
    expect(late, "no hit within 10 s").toEqual([]);
    expect(dancing, "turning in place").toEqual([]);
    expect(stuck, "20 s there to be hit with no hit (ruling R-FW1m)").toEqual([]);
  }, 60_000);

  // Plan 5 final wave, part 3 (part 2 fix round 1's concern 2): the same rotation with the
  // Smash Ball on. Part 2's first Volt Tackle positioning (`d016156`) went to its spot for a
  // free target too, and stood off an idle player for up to 5,469 frames; `e6ab7cd` goes only
  // for a busy one. UNVERIFIED (test judgement): the bound, 30 s, wider than `MAX_STRETCH`
  // for the ball's chase and a Final Smash's scene.
  it("never stands off 30 s from a player there to be hit, the Smash Ball on, in the 64 matchups", () => {
    const ids = FIGHTERS.map((f) => f.id);
    const ball: MatchRules = { ...RULES, smashBall: true };
    const stuck: string[] = [];
    let n = 0;
    for (const a of ids)
      for (const b of ids) {
        const stageId = STAGES[n % STAGES.length].id;
        const { stretch } = play(createInitialState(stageId, [{ defId: a }, { defId: b }], ball, 1000 + n, CTX), [0], FRAMES, true);
        if (stretch > BALL_MAX_STRETCH) stuck.push(`${a}-${b}@${stageId}: ${stretch} frames there to be hit, no hit`);
        n++;
      }
    expect(n).toBe(64);
    expect(stuck, "30 s there to be hit with no hit, the ball on").toEqual([]);
  }, 180_000);

  it("turns to an idle Fox at point blank and hits it, from a dash or a standstill (I1's Pikachu trace, reduced)", () => {
    // The review's trace: Pikachu at 28.1 and 30.0 in turn, every frame, around an idle
    // Fox at 28.7, for 5,386 frames. Here Pikachu at 28.1 facing away, Fox 0.6 behind it.
    for (const action of ["dashStart", "stand"] as const) {
      const s = createInitialState("finalDestination", [{ defId: "pikachu" }, { defId: "fox" }], RULES, 5, CTX);
      placed(s.fighters[0], { x: fx(28.1), action, facing: -1, framesSinceDirPress: 30 });
      placed(s.fighters[1], { x: fx(28.7), action: "stand", facing: -1 });
      const { firstHit, turns } = play(s, [0], 300);
      expect([firstHit > 0 && firstHit <= 60, turns <= MAX_TURNS], `from ${action}: first hit ${firstHit}, ${turns} turns`).toEqual([true, true]);
    }
  });

  it("drops through a soft platform onto a player standing below it, from a standstill and from every frame of a crouch (ruling R-FW1k)", () => {
    // The idle table's platform loop: `platformMove` pulsed Down 4 frames in 10, and a
    // crouch's start and end are 5 and 5, so every fresh Down landed in the crouch's end,
    // which does not drop through, and the CPU crouched above its target for minutes.
    // One scene per kind of platform the nine matchups stood on: Battlefield's and Small
    // Battlefield's side platforms, Pokémon Stadium 2's, Town & City's centre one.
    const starts: { action: FighterState["action"]; actionFrame: number }[] = [
      { action: "stand", actionFrame: 30 },
      ...[0, 1, 2, 3, 4].map((f) => ({ action: "crouchStart" as const, actionFrame: f })),
      { action: "crouch", actionFrame: 10 },
      ...[0, 1, 2, 3, 4].map((f) => ({ action: "crouchEnd" as const, actionFrame: f })),
    ];
    const failed: string[] = [];
    for (const [a, b, stageId] of [["fox", "link", "battlefield"], ["kirby", "mario", "smallBattlefield"], ["link", "marth", "pokemonStadium2"], ["marth", "link", "townAndCity"]] as const) {
      const stage = CTX.stage(stageId);
      const index = stage.platforms.findIndex((p) => p.soft);
      const plat = stage.platforms[index];
      for (const start of starts)
        for (let phase = 0; phase < 10; phase++) {
          const s = createInitialState(stageId, [{ defId: a }, { defId: b }], RULES, 5, CTX);
          placed(s.fighters[0], { x: plat.x, y: plat.y, platform: index, facing: 1, framesSinceDirPress: 30, ...start });
          placed(s.fighters[1], { x: plat.x + fx(4), y: stage.platforms[0].y, platform: 0, action: "stand" });
          s.frame = phase;
          const at = dropsWithin(s, 15);
          if (at < 0) failed.push(`${a} on ${stageId} from ${start.action}@${start.actionFrame}, phase ${phase}`);
        }
    }
    expect(failed).toEqual([]);
  });

  it("goes for a player standing on Town & City's platform past the ledge rather than guard the ledge at nothing (ruling R-FW1l)", () => {
    // The idle table's fox-pikachu@townAndCity: Pikachu idle on the right platform, past
    // the main stage's right ledge in x; Fox guarded the ledge for 3,061 frames.
    const stage = CTX.stage("townAndCity");
    const index = stage.platforms.findIndex((p) => p.soft && p.x > stage.platforms[0].x + stage.platforms[0].halfWidth - fx(30));
    const s = createInitialState("townAndCity", [{ defId: "fox" }, { defId: "pikachu" }], RULES, 5, CTX);
    placed(s.fighters[0], { x: fx(40), y: 0, platform: 0, action: "stand", facing: 1 });
    placed(s.fighters[1], { x: fx(93.77), y: stage.platforms[index].y, platform: index, action: "stand", facing: -1 });
    const { firstHit } = play(s, [0], 600);
    expect(firstHit, "Fox's first hit on Pikachu").toBeGreaterThan(0);
  });

  it("gets up past a player standing at the ledge and hits him, never off the stage: marth-mario@townAndCity (ruling R-FW1n; the re-review's seed 3256, reduced)", () => {
    // Mario idle at 83.10 by the right ledge (83.22). Marth's get-up put him at 75.22
    // facing in with Mario behind; the jab buffered in it came out facing away, and the
    // dash back stopped 3.4 short and slid him past Mario and off, on to the ledge again:
    // 5,766 frames round.
    for (const phase of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      const s = createInitialState("townAndCity", [{ defId: "marth" }, { defId: "mario" }], RULES, 5, CTX);
      placed(s.fighters[0], { x: fx(83.22), y: 0, grounded: false, action: "ledgeHang", ledge: { platform: 0, side: 1 }, facing: -1, platform: -1 });
      placed(s.fighters[1], { x: fx(83.1), y: 0, platform: 0, action: "stand", actionFrame: 30, facing: -1 });
      s.frame = phase;
      const { firstHit, off } = onTheFloor(s, 300);
      expect([firstHit > 0 && firstHit <= 120, off], `from the ledge, phase ${phase}: first hit ${firstHit}`).toEqual([true, 0]);
    }
  });

  it("stops at point blank by a player at the ledge without running or sliding off: Marth out of his jab, facing away from Mario (ruling R-FW1n)", () => {
    // The same scene after the get-up: Marth jabbing at 75.22 facing in, Mario behind him at
    // 83.10, the turn's press held through the jab, so the dash comes out as it ends. Its
    // stop 3.4 short of Mario slid on past him (the let-go: `slidesOff`), and the stale
    // direction held through a dash at point blank ran on (`pressToward`): off, either way.
    for (const jab of [5, 12, 20])
      for (const phase of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
        const s = createInitialState("townAndCity", [{ defId: "marth" }, { defId: "mario" }], RULES, 5, CTX);
        placed(s.fighters[0], { x: fx(75.22), y: 0, platform: 0, action: "attack", move: "jab1", actionFrame: jab, facing: -1, framesSinceDirPress: 30 });
        placed(s.fighters[1], { x: fx(83.1), y: 0, platform: 0, action: "stand", actionFrame: 30, facing: -1 });
        s.frame = phase;
        const { firstHit, off } = onTheFloor(s, 300);
        expect([firstHit > 0 && firstHit <= 120, off], `jab frame ${jab}, phase ${phase}: first hit ${firstHit}`).toEqual([true, 0]);
      }
  });

  it("hits a player hanging on the ledge right under it (fix round 1: marth-pikachu off the committed stages)", () => {
    // Level with it in x, the step back pressed nothing (away from a target at dx 0), so
    // Marth stood over Pikachu at Final Destination's ledge for minutes, its swings passing over.
    for (const [a, b] of [["marth", "pikachu"], ["marth", "kirby"], ["mario", "pikachu"]] as const) {
      const s = createInitialState("finalDestination", [{ defId: a }, { defId: b }], RULES, 5, CTX);
      const ledge = stageViewFromDef(CTX.stage("finalDestination")).leftLedge;
      placed(s.fighters[0], { x: ledge, y: 0, platform: 0, action: "stand", actionFrame: 30, facing: -1, framesSinceDirPress: 30 });
      placed(s.fighters[1], { x: ledge, y: 0, grounded: false, action: "ledgeHang", actionFrame: 200, ledge: { platform: 0, side: -1 }, facing: 1, platform: -1 });
      const { firstHit, off } = onTheFloor(s, 300);
      expect([firstHit > 0 && firstHit <= 120, off], `${a} over ${b}: first hit ${firstHit}`).toEqual([true, 0]);
    }
  });

  it("climbs to a player standing on a soft platform above and hits him (ruling R-FW1k, widened: the re-review's mario-samus on Battlefield and Small Battlefield)", () => {
    // The full hop tops out under the platform (Mario's at 17.6 under Battlefield's top at
    // 24.1, short of it), and the aerials thrown there met nothing: no hit in 120 s. Every
    // fighter, from under the platform and 30 either side of it, on each platform over the stage.
    const late: string[] = [];
    for (const stageId of ["battlefield", "smallBattlefield"]) {
      const stage = CTX.stage(stageId);
      stage.platforms.forEach((p, index) => {
        if (!p.soft) return;
        for (const a of FIGHTERS.map((f) => f.id))
          for (const off of [-30, 0, 30]) {
            const s = createInitialState(stageId, [{ defId: a }, { defId: "samus" }], RULES, 5, CTX);
            placed(s.fighters[0], { x: p.x + fx(off), y: stage.platforms[0].y, platform: 0, action: "stand", actionFrame: 30, facing: off > 0 ? -1 : 1 });
            placed(s.fighters[1], { x: p.x, y: p.y, platform: index, action: "stand", actionFrame: 30, facing: -1 });
            const { firstHit } = onTheFloor(s, 600);
            if (firstHit < 0 || firstHit > 300) late.push(`${a} on ${stageId}'s platform ${index}, ${off}: ${firstHit}`);
          }
      });
    }
    expect(late).toEqual([]);
  }, 60_000);

  it("reaches a player standing on Town & City's outer platform past the ledge and hits him (ruling R-FW1p: the six-rotation table's three)", () => {
    // Over the outer platforms, past the main ledge in x, `recover` took the air for off
    // the stage and pulled the CPU back from the platform it was jumping to, for minutes.
    for (const [a, b, side] of [["pikachu", "mario", -1], ["pikachu", "fox", 1], ["samus", "samus", -1], ["pikachu", "mario", 1], ["samus", "samus", 1]] as const) {
      const stage = CTX.stage("townAndCity");
      const index = stage.platforms.findIndex((p) => p.soft && Math.sign(p.x) === side && Math.abs(p.x) > fx(60));
      const s = createInitialState("townAndCity", [{ defId: a }, { defId: b }], RULES, 5, CTX);
      placed(s.fighters[0], { x: fx(40 * side), y: 0, platform: 0, action: "stand", actionFrame: 30, facing: side });
      placed(s.fighters[1], { x: fx(94 * side), y: stage.platforms[index].y, platform: index, action: "stand", actionFrame: 30, facing: -side });
      const { firstHit } = onTheFloor(s, 600);
      expect(firstHit > 0 && firstHit <= 300, `${a} at ${b} on the ${side > 0 ? "right" : "left"} platform: first hit ${firstHit}`).toBe(true);
    }
  });

  it("keeps its stock chasing a player on Town & City's left outer platform: marth-mario and pikachu-kirby (ruling R-FW1v; re-review 3's trace and the 512 table's, reduced)", () => {
    // The player 94 out on the left outer platform, the CPU 40 in, phase 5. Marth's Dolphin
    // Slash aimed over a floor that only the stick held in reaches, held neutral, angled out
    // past the platform's end, and Marth died on 221. Pikachu, against Kirby, held Quick
    // Attack neutral over that floor the same way, fell helpless past the platform's end
    // and died on 497 (at ef17ceb, before the fix: the 512 table's one Pikachu death). The
    // floor read now gives the stick its fall was run with (`floorStick`), and `recover`
    // holds it.
    expect(cpuDeathWithin(outerPlatformScene("marth", "mario", -1, 94, 5), 600)).toBe(-1);
    expect(cpuDeathWithin(outerPlatformScene("pikachu", "kirby", -1, 94, 5), 600)).toBe(-1);
  });

  it("loses no stock in 512 reduced Town & City scenes against a player on an outer platform (ruling R-FW1v)", () => {
    // Every pair, the idle player on each outer platform 94 and 98 out, the CPU 40 in on
    // that side, phases 0 and 5, 600 frames. Fix round 2's floor read (the stick held in
    // credited and not held) lost 17 of them.
    const ids = FIGHTERS.map((f) => f.id);
    const deaths: string[] = [];
    let n = 0;
    for (const a of ids)
      for (const b of ids)
        for (const side of [-1, 1])
          for (const out of [94, 98])
            for (const phase of [0, 5]) {
              const death = cpuDeathWithin(outerPlatformScene(a, b, side, out, phase), 600);
              if (death > 0) deaths.push(`${a}-${b}, side ${side}, ${out} out, phase ${phase}: ${death}`);
              n++;
            }
    expect(n).toBe(512);
    expect(deaths).toEqual([]);
  }, 120_000);

  it("never throws a swing that will not land at point blank with the ledge behind: marth-kirby@smallBattlefield (ruling R-FW1q; seed 3260, reduced)", () => {
    // Marth 3.25 inside the right ledge facing left, Kirby 0.92 in front: none of his ground
    // swings lands and there is no room to step back, so the fall-through's forward tilt
    // whiffed over Kirby for 4,733 frames. Every swing it starts must hit, and it must hit.
    const ledge = stageViewFromDef(CTX.stage("smallBattlefield")).rightLedge;
    for (const phase of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      const s = createInitialState("smallBattlefield", [{ defId: "marth" }, { defId: "kirby" }], RULES, 5, CTX);
      placed(s.fighters[0], { x: ledge - fx(3.25), y: 0, platform: 0, action: "stand", actionFrame: 30, facing: -1, framesSinceDirPress: 30 });
      placed(s.fighters[1], { x: ledge - fx(4.17), y: 0, platform: 0, action: "stand", actionFrame: 30, facing: -1 });
      s.frame = phase;
      const { firstHit, whiffs } = swingsUntilHit(s, 300);
      expect([firstHit > 0 && firstHit <= 120, whiffs], `phase ${phase}: first hit ${firstHit}`).toEqual([true, 0]);
    }
  });

  it("breaks the lock of two level-9 CPUs dashing at point blank: Pikachu and Marth on Small Battlefield (I1's trace, reduced)", () => {
    // Seed 1008's lock, Pikachu on port 0 and Marth on port 1, both at level 9: from
    // frame 1419, both in a dash at 45.05 and 43.86 facing left, they turned in step,
    // every frame, to the end of the match (9,441 frames).
    const s = createInitialState("smallBattlefield", [{ defId: "pikachu" }, { defId: "marth" }], RULES, 5, CTX);
    placed(s.fighters[0], { x: fx(45.05), action: "dashStart", facing: -1, framesSinceDirPress: 30 });
    placed(s.fighters[1], { x: fx(43.86), action: "dashStart", facing: -1, framesSinceDirPress: 30 });
    const { firstHit, turns } = play(s, [0, 1], 300);
    expect([firstHit > 0 && firstHit <= 60, turns <= MAX_TURNS], `first hit ${firstHit}, ${turns} turns`).toEqual([true, true]);
  });
});

/**
 * Step `start` for `frames` frames, level-9 CPUs on `cpus` and nobody on the rest (Plan 6, Task 26):
 * the last state, and each port's self-destructs (a KO with no hit taken since the fighter last
 * stood on a floor, or since the start). `watch` sees every state.
 */
function playOut(start: GameState, cpus: readonly number[], frames: number, watch: (s: GameState) => void = () => {}): { state: GameState; selfDestructs: number[] } {
  let state = start;
  const view = stageViewFromDef(CTX.stage(state.stageId));
  const defs = state.fighters.map((f) => CTX.fighter(f.defId));
  const worlds: CpuWorld[] = defs.map((def) => cpuWorldFromDef(def, view, defs, (id) => CTX.fighter(id), CTX.bake));
  let seed = state.rngSeed ^ 0x1f2e3d4c;
  let prev: readonly InputFrame[] = state.fighters.map(() => 0);
  const lastHit = state.fighters.map(() => -1_000);
  // The start counts as standing: a fighter that never lands and is lost went off on its own.
  const lastStood = state.fighters.map(() => 0);
  const selfDestructs = state.fighters.map(() => 0);
  for (let frame = 1; frame <= frames && state.outcome === null; frame++) {
    const inputs = state.fighters.map((_, port) => {
      if (!cpus.includes(port)) return 0;
      const d = decideCpu(state, port, 9, seed, worlds[port]);
      seed = d.seed;
      return d.input;
    });
    const out = step(state, inputs, { prevInputs: prev, ctx: CTX });
    for (const h of out.events.hits) lastHit[h.victim] = frame;
    // Standing on its own: not in a hit's hitlag or hitstun, nor held (as Task 23's sweep counts).
    for (const f of out.state.fighters) if (f.grounded && !isStunned(f) && f.grabbedBy < 0) lastStood[f.port] = frame;
    for (const ko of out.events.kos) if (lastStood[ko.port] > lastHit[ko.port]) selfDestructs[ko.port] += 1;
    state = out.state;
    prev = inputs;
    watch(state);
  }
  return { state, selfDestructs };
}

describe("a CPU stays on its stage at the ledge (Plan 6, Task 26)", () => {
  it("the Smash Ball chase does not drift Donkey Kong past Pokémon Stadium 2's ledge to a lost stock", () => {
    // In the air 40 inside the left ledge, 5 up, drifting out at 1.5 with his midair jump left;
    // the ball 10 inside that ledge, 30 up. The chase drifted and jumped after it, past the
    // ledge, from where his recovery fell short (KO on frame 135 at 46e0706 with Tasks 23-25).
    const view = stageViewFromDef(CTX.stage("pokemonStadium2"));
    const s = createInitialState("pokemonStadium2", [{ defId: "donkeyKong" }, { defId: "samus" }], { ...RULES, smashBall: true }, 5, CTX);
    placed(s.fighters[0], { action: "fall", actionFrame: 10, grounded: false, platform: -1, x: view.leftLedge + fx(40), y: fx(5), facing: -1, vx: fx(-1.5), jumpsUsed: 1 });
    placed(s.fighters[1], { action: "stand", platform: 0, x: view.rightLedge - fx(10), y: 0, facing: -1 });
    s.smashBall = { active: true, x: view.leftLedge + fx(10), y: fx(30), vx: 0, vy: 0, health: fx(40), driftTimer: 600 };
    expect(playOut(s, [0], 400).selfDestructs[0]).toBe(0);
  });

  it("a level-9 CPU running out between Mario and Smashville's ledge never ends on it or past it, 36 of 36", () => {
    // Pikachu 40 to 5 inside the right end of the main floor, running out at 1.6, Mario 45 inside:
    // turning back to him 3.5 to 6.5 from the end, the turn's slide hung Pikachu on the ledge
    // (4 of 36 at 46e0706 with Tasks 23-25). The floor's end is the main platform's right end
    // (Smashville's ledges are -69.05 and 70.25, so it is not centred on 0).
    const sv = CTX.stage("smashville");
    const main = sv.platforms.find((p) => !p.soft)!;
    const ledge = main.x + main.halfWidth;
    const past: number[] = [];
    for (let run = 0; run < 36; run++) {
      const s = createInitialState("smashville", [{ defId: "pikachu" }, { defId: "mario" }], RULES, 1000 + run, CTX);
      placed(s.fighters[0], { action: "run", actionFrame: 10, platform: 0, x: ledge - fx(40) + fx(run), facing: 1, vx: fx(1.6) });
      placed(s.fighters[1], { action: "stand", platform: 0, x: ledge - fx(45), facing: -1 });
      let off = false;
      playOut(s, [0], 120, (st) => {
        const f = st.fighters[0];
        off ||= f.ledge !== null || f.x > ledge;
      });
      if (off) past.push(run);
    }
    expect(past).toEqual([]);
  });

  it("leaves a run at a target off the stage as it was, the edgeguard's chase and any other behaviour's (rulings R-P6-17, R-P6-24)", () => {
    // Mario running out 6 inside Final Destination's right ledge, Fox off the stage beyond it:
    // the edgeguard's chase (`out | Attack`, its skill above 0.6) runs him off on purpose, and on
    // a seed whose edgeguard roll fails, another behaviour's press is left as it was too. The
    // run-off guard turns none into a shield.
    const view = stageViewFromDef(CTX.stage("finalDestination"));
    const seen: { behaviour: string; input: number }[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      const s = createInitialState("finalDestination", [{ defId: "mario" }, { defId: "fox" }], RULES, 5, CTX);
      placed(s.fighters[0], { action: "run", actionFrame: 10, platform: 0, x: view.rightLedge - fx(6), facing: 1, vx: fx(1.6) });
      placed(s.fighters[1], { action: "fall", actionFrame: 10, grounded: false, platform: -1, x: view.rightLedge + fx(15), y: fx(-5), facing: -1 });
      const world = cpuWorldFromDef(CTX.fighter("mario"), view, [CTX.fighter("mario"), CTX.fighter("fox")], (id) => CTX.fighter(id), CTX.bake);
      const d = decideCpu(s, 0, 9, seed, world);
      seen.push({ behaviour: d.behaviour, input: d.input });
    }
    const guarding = seen.filter((d) => d.behaviour === "edgeguard");
    expect(guarding.some((d) => (d.input & Btn.Right) !== 0)).toBe(true);
    expect(seen.length - guarding.length, "seeds another behaviour took").toBeGreaterThan(0);
    expect(seen.filter((d) => d.input === Btn.Shield)).toEqual([]);
  });
});
