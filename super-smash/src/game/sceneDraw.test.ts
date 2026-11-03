/**
 * No Final Smash user is drawn inside a fighter it trapped (Plan 5, Task 17 fix
 * round 2, ruling R-T17i).
 *
 * Sim-driven, at each cinematic Final Smash's real trap distances (the Task 17
 * re-review's N2): the user stands at −30 with its power, facing Mario idle in
 * front of it at an activation gap, on Final Destination one on one, through the
 * baked context, and presses Special. From the trap until the user's last Final
 * Smash part ends, on every frame Mario is trapped by it, frozen in the hitlag of
 * the launch its scene gave him, or flying off in that launch's hitstun, the
 * user's body (its `ECB_TOP_BONES` capsules), drawn where the renderer draws it,
 * must not overlap any of Mario's hurt capsules. Drawn means between the last two
 * steps, at the start of the interval, halfway and at its end (`interpolatePosition`
 * and `sceneShiftAt`, with the drawn tops the match runner hands them), the shift
 * eased as the runner eases it (`easeSceneShift`). The sim keeps both where they
 * are: the golden's trace is untouched.
 */
import { describe, expect, it } from "vitest";
import { ECB_TOP_BONES, fighterHurtboxes } from "@/engine/acmd/hurtboxes";
import { FINAL_SMASH_READY } from "@/engine/final";
import { fx, toFloat } from "@/engine/fixed";
import { capsulesOverlap } from "@/engine/hitbox";
import { createInitialState, step, type SimContext } from "@/engine/simulate";
import { Btn, type FighterDef, type GameState, type InputFrame, type MatchRules } from "@/engine/types";
import { FIGHTERS } from "@/fighters";
import { createCamera, updateCamera, visibleBounds } from "@/render/camera";
import { interpolatePosition, sceneShiftAt } from "@/render/renderer";
import { SCENE_RELEASE_FRAMES, createSceneShiftEase, easeSceneShift } from "@/render/sceneShiftEase";
import { drawnTop } from "@/render3d/anchors";
import { STAGES } from "@/stages";
import { bakedContext } from "./bake";
import { readBakeFromDisk } from "./bakeNode";

const bake = readBakeFromDisk();
const CTX: SimContext = bakedContext(
  { fighter: (id) => FIGHTERS.find((f) => f.id === id)!, stage: (id) => STAGES.find((s) => s.id === id)! },
  bake,
);
const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true };

function ready(user: string, gap: number): GameState {
  const s = createInitialState("finalDestination", [{ defId: user }, { defId: "mario" }], RULES, 6, CTX);
  s.fighters.forEach((f, i) =>
    Object.assign(f, {
      action: "stand",
      actionFrame: 0,
      grounded: true,
      platform: 0,
      x: fx(i === 0 ? -30 : -30 + gap),
      y: 0,
      facing: i === 0 ? 1 : -1,
      intangible: 0,
    }),
  );
  s.fighters[0].finalSmashReady = FINAL_SMASH_READY;
  return s;
}

type Held = "trapped" | "frozen" | "flying";

interface Frame {
  /** Frames from the press. */
  at: number;
  /** How the user holds Mario, if it does: trapped; frozen in its scene's launch's hitlag; flying in its hitstun. */
  held: Held | null;
  /** The user's drawn shift, eased, at the end of the step's interval. */
  shift: number;
  /** Mario from the user's sim position: ahead of it along its facing, and above it. */
  ahead: number;
  above: number;
  /** The drawn body overlaps Mario, at any of the drawn instants. */
  into: boolean;
}

/** Frames simulated past the end of the user's last Final Smash part, for its release to finish in. */
const AFTER = 30;

interface Scene {
  readonly defs: readonly FighterDef[];
  /** From the state before the press (0), one per step, to `AFTER` steps past the user's last Final Smash part. */
  readonly states: readonly GameState[];
  /** How tall each fighter is drawn on each step, from the bake: what the runner hands the drawing. */
  readonly tops: readonly (readonly (number | null)[])[];
  /** The step the user's last Final Smash part ends on: the first step it is in none. */
  readonly ended: number;
}

const SCENES = new Map<string, Scene>();

/** The user pressing Special at `gap` from Mario, stepped through its Final Smash and `AFTER` steps on. Simulated once per case. */
function simulate(user: string, gap: number): Scene {
  const key = `${user} ${gap}`;
  const known = SCENES.get(key);
  if (known !== undefined) return known;
  let s = ready(user, gap);
  const defs: FighterDef[] = [CTX.fighter(user), CTX.fighter("mario")];
  const states: GameState[] = [s];
  let prev: InputFrame[] = [0, 0];
  let started = false;
  let ended = -1;
  for (let i = 0; i < 900 && (ended < 0 || states.length <= ended + AFTER); i++) {
    const now: InputFrame[] = [i === 0 ? Btn.Special : 0, 0];
    s = step(s, now, { prevInputs: prev, ctx: CTX }).state;
    prev = now;
    states.push(s);
    const u = s.fighters[0];
    const final = u.move === null || u.action !== "special" ? undefined : defs[0].moves[u.move]?.final;
    if (final !== undefined) started = true;
    else if (started && ended < 0) ended = states.length - 1;
  }
  const scene = { defs, states, tops: states.map((st) => st.fighters.map((f) => drawnTop(defs[f.port], f, st.frame, bake))), ended };
  SCENES.set(key, scene);
  return scene;
}

/** Every frame of the user's Final Smash parts, from the press. */
function run(user: string, gap: number): Frame[] {
  const { defs, states, tops } = simulate(user, gap);
  const bones = bake.hurtboxes(user)!.map((h) => h.bone);
  const out: Frame[] = [];
  const ease = createSceneShiftEase();
  for (let n = 1; n < states.length; n++) {
    const i = n - 1;
    const before = states[n - 1];
    const s = states[n];
    const [u, v] = s.fighters;
    const final = u.move === null || u.action !== "special" ? undefined : defs[0].moves[u.move]?.final;
    if (final === undefined) {
      if (out.length > 0) break;
      continue;
    }
    const launched = final.phase !== "start" && v.action !== "finalTrapped" && v.combat.launchSource === u.port;
    let held: Held | null = null;
    if (v.action === "finalTrapped" && v.combat.trappedBy === u.port) held = "trapped";
    else if (launched && v.hitlag > 0) held = "frozen";
    else if (launched && v.hitstun > 0) held = "flying";
    const rs = { current: s, previous: before, fighters: defs, tops: tops[n] };
    const eased = [0, 0.5, 1].map((alpha) => easeSceneShift(ease, sceneShiftAt(rs, alpha), s.frame - 1 + alpha));
    const shift = eased[2];
    let into = false;
    if (held !== null) {
      for (const [k, alpha] of [0, 0.5, 1].entries()) {
        const at = eased[k];
        const [pu, pv] = [0, 1].map((k) => interpolatePosition(before.fighters[k], s.fighters[k], alpha));
        const body = fighterHurtboxes(defs[0], { ...u, x: fx(pu.x + at[0]), y: fx(pu.y) }, s.frame, bake)!.filter((_, k) => ECB_TOP_BONES.has(bones[k]));
        const mario = fighterHurtboxes(defs[1], { ...v, x: fx(pv.x + at[1]), y: fx(pv.y) }, s.frame, bake)!;
        into ||= body.some((a) => mario.some((b) => capsulesOverlap(a, b)));
      }
    }
    out.push({ at: i, held, shift: shift[0], ahead: toFloat((v.x - u.x) * u.facing), above: toFloat(v.y - u.y), into });
  }
  return out;
}

/**
 * [user, activation gap, where it traps Mario]: each cinematic Final Smash's real
 * trap distances (the re-review's N2 table: Fox where Mario stands, Kirby from 3
 * (it misses at 2), Pikachu 1.0 to 13.6 after its dash (8.2 to 15.6 at 3.2 a frame,
 * Plan 5 final wave 2, ruling R-FW2i; 6.9 to 15 at Task 15's 4.5; at 4.1 since part 2's
 * fix round 3, ruling R-FW2q; 7.3 to 13.6 before Plan 6, Task 11 slowed the fighter
 * beside it), Marth 4 behind to 20, his dash
 * carrying him level with or past Mario at the closest; Donkey Kong where Mario
 * stands). A user that traps only fighters behind it turns to face them on the trap's
 * step (Plan 5 final wave 2, ruling R-FW2h), so those are ahead of it when caught.
 */
const TRAPS = [
  ["donkeyKong", 2, 2],
  ["donkeyKong", 8, 8],
  ["donkeyKong", 12, 12],
  // Behind him (the re-review 2's N5): his trap box reaches back, and with no
  // body push it catches a fighter inside or just behind him, to 7 back. He turns to
  // face them as the trap lands (ruling R-FW2h).
  ["donkeyKong", -0.5, 0.5],
  ["donkeyKong", -2, 2],
  ["donkeyKong", -4, 4],
  ["donkeyKong", -7, 7],
  ["fox", 2, 2],
  ["fox", 3, 3],
  ["fox", 4, 4],
  ["kirby", 3, 3],
  ["kirby", 4, 4],
  ["kirby", 5, 5],
  // Plan 6, Task 11: the startup's `SLOW_OPPONENT(9, 45)` slows Mario, so its sparks barely
  // move him and the dash traps him near where he stood. From 2 the tackle carries Pikachu
  // past him within a step, and the drawn shift flips from back to on (carried: the
  // scene shift's side across a crossing, a presentation item).
  ["pikachu", 4, 1.02],
  ["pikachu", 8, 5.02],
  ["pikachu", 10, 7.02],
  ["pikachu", 30, 13.6],
  ["pikachu", 54, 13],
  ["pikachu", 42, 13.3],
  ["marth", 2, 4],
  ["marth", 6, 0],
  ["marth", 10, 4],
  ["marth", 14, 8],
  ["marth", 18, 12],
  ["marth", 26, 20],
] as const;

describe("no Final Smash user drawn inside the fighter it trapped, at its real trap distances (ruling R-T17i)", () => {
  it.each(TRAPS)("%s from %s away, trapping at %s: the trap, the scene, the launch's freeze and its flight", (user, gap, trap) => {
    const frames = run(user, gap);
    const caught = frames.find((f) => f.held === "trapped")!;
    expect(caught.ahead).toBeCloseTo(trap, 1);
    expect(frames.filter((f) => f.into).map((f) => `${f.at} ${f.held}`)).toEqual([]);
  });

  it("measures through the launch: its hitlag (Donkey Kong 15 frames, Kirby 8, Pikachu 20, Marth 30; none in Team Star Fox's) and its flight", () => {
    const count = (user: string, gap: number, held: Held) => run(user, gap).filter((f) => f.held === held).length;
    expect([count("donkeyKong", 8, "frozen"), count("kirby", 4, "frozen"), count("pikachu", 2, "frozen"), count("marth", 2, "frozen"), count("fox", 2, "frozen")]).toEqual([15, 8, 20, 30, 0]);
    for (const [user, gap] of [["donkeyKong", 8], ["kirby", 4], ["pikachu", 2], ["marth", 2], ["fox", 2]] as const) {
      expect(count(user, gap, "flying"), user).toBeGreaterThan(1);
    }
  });

  it("holds Donkey Kong backed off through the uppercut's freeze, and closes the gap only as Mario flies off (the re-review's N1)", () => {
    const frames = run("donkeyKong", 8);
    const freeze = frames.filter((f) => f.held === "frozen");
    expect(freeze.length).toBe(15);
    // Five units back, 13 from Mario (the uppercut's gap), the whole way, and on
    // the frame the launch fires: no snap into him on contact.
    const fires = frames[frames.indexOf(freeze.at(-1)!) + 1];
    expect(new Set([...freeze, fires].map((f) => f.shift))).toEqual(new Set([-5]));
    // The gap closes once Mario has flown clear of him: above the uppercut's
    // raised fist, 44 up, or past the gap ahead.
    const closes = frames.find((f) => f.at > fires.at && f.shift === 0)!;
    expect(closes.held).toBe("flying");
    expect(closes.above > 44 || closes.ahead >= 13).toBe(true);
  });
});

describe("letting go (rulings R-T17o and R-T17q; the re-review 2's N7 and 3's N9)", () => {
  /**
   * The shift the runner hands the drawing on each paint (`easeSceneShift` of
   * `sceneShiftAt`, at the paint's sim time, frame − 1 + α), painting `hz` times a
   * second from `phase` of a paint interval after the press, to `AFTER` frames past
   * the user's last Final Smash part.
   */
  function painted(user: string, gap: number, hz: number, phase: number) {
    const { defs, states, tops } = simulate(user, gap);
    const ease = createSceneShiftEase();
    const out: { time: number; target: number; drawn: number }[] = [];
    for (let k = 0; ; k++) {
      const t = 1 + (k + phase) * (60 / hz);
      const n = Math.floor(t);
      if (n >= states.length) break;
      const alpha = t - n;
      const target = sceneShiftAt({ current: states[n], previous: states[n - 1], fighters: defs, tops: tops[n] }, alpha);
      const time = states[n].frame - 1 + alpha;
      out.push({ time, target: target[0], drawn: easeSceneShift(ease, target, time)[0] });
    }
    return out;
  }

  /**
   * Every release in a run of paints: from the last paint that held (drawn where
   * the need is) to the first that draws the need again, with how far it came.
   */
  function releases(paints: ReturnType<typeof painted>) {
    const out: { from: number; to: number; size: number; steps: number[] }[] = [];
    for (let i = 1; i < paints.length; i++) {
      if (paints[i].drawn === paints[i].target || paints[i - 1].drawn !== paints[i - 1].target) continue;
      const end = paints.findIndex((p, k) => k > i && p.drawn === p.target);
      const along = paints.slice(i - 1, end < 0 ? undefined : end + 1);
      out.push({
        from: paints[i - 1].time,
        to: end < 0 ? Infinity : paints[end].time,
        size: Math.abs(paints[i - 1].drawn - along.at(-1)!.target),
        // How far it came on each paint, per frame of sim time.
        steps: along.slice(1).flatMap((p, k) => (p.time > along[k].time ? [Math.abs(p.drawn - along[k].drawn) / (p.time - along[k].time)] : [])),
      });
    }
    return out;
  }

  it.each(TRAPS)(
    "%s from %s away, trapping at %s: every release ends within 8 frames of its last hold, and not in under 6, at 60, 75, 120 and 144 Hz, never faster than twice an even share; from then on the user is drawn where the sim has it",
    (user, gap) => {
      const { states, ended } = simulate(user, gap);
      expect(ended, "the Final Smash ends").toBeGreaterThan(0);
      expect(states.length - 1 - ended, "frames past its end").toBe(AFTER);
      for (const hz of [60, 75, 120, 144]) {
        // A paint on the step, one barely into it (N9's floating residue), and one halfway.
        for (const phase of [0, 1e-9, 0.5]) {
          const at = `${hz} Hz, phase ${phase}`;
          const paints = painted(user, gap, hz, phase);
          for (const r of releases(paints)) {
            // Its 7 frames, and the paint it lands on: within 8 at 60 Hz.
            expect(r.to - r.from, `${at}: the release from ${r.from.toFixed(2)}`).toBeLessThanOrEqual(SCENE_RELEASE_FRAMES + 60 / hz + 1e-9);
            if (r.size >= 0.5) expect(r.to - r.from, `${at}: the release from ${r.from.toFixed(2)}`).toBeGreaterThanOrEqual(SCENE_RELEASE_FRAMES - 1);
            for (const v of r.steps) expect(v, `${at}: the release from ${r.from.toFixed(2)}`).toBeLessThanOrEqual((2 * r.size) / SCENE_RELEASE_FRAMES + 1e-9);
          }
          // Never drawn nearer than the need; and let go for good: from the scene's
          // last release on, drawn exactly where the sim has it, past the move's end.
          for (const p of paints) expect(Math.abs(p.drawn), `${at}: ${p.time.toFixed(2)}`).toBeGreaterThanOrEqual(Math.abs(p.target));
          const home = paints.findIndex((p, i) => paints.slice(i).every((q) => q.drawn === 0));
          expect(home, at).toBeGreaterThanOrEqual(0);
          expect(paints.slice(home).every((p) => p.target === 0)).toBe(true);
          expect(paints.at(-1)!.time - paints[home].time, at).toBeGreaterThanOrEqual(AFTER);
        }
      }
    },
  );
});

describe("the camera on a Final Smash's end hit (ruling R-T17j)", () => {
  /**
   * The camera the match runner drives, every frame from the press: the moves, and
   * how tall each fighter is drawn. Settled on the plain framing first, as a match's
   * camera is when somebody presses Special (the Task 17 re-review 2's N6).
   */
  function filmed(user: string, gap: number) {
    let s = ready(user, gap);
    const defs: FighterDef[] = [CTX.fighter(user), CTX.fighter("mario")];
    const stage = STAGES.find((st) => st.id === "finalDestination")!;
    const cam = createCamera(stage);
    const settle = s.fighters.map((f) => drawnTop(defs[f.port], f, s.frame, bake));
    for (let i = 0; i < 300; i++) updateCamera(cam, s, stage, null, defs, settle);
    const plain = cam.zoom;
    let prev: InputFrame[] = [0, 0];
    const out: { at: number; move: string | null; trapped: boolean; frozen: boolean; top: number; seen: number; feet: number; bottom: number; zoom: number; plain: number; punch: boolean; hit: boolean }[] = [];
    for (let i = 0; i < 400; i++) {
      const now: InputFrame[] = [i === 0 ? Btn.Special : 0, 0];
      const r = step(s, now, { prevInputs: prev, ctx: CTX });
      s = r.state;
      prev = now;
      const tops = s.fighters.map((f) => drawnTop(defs[f.port], f, s.frame, bake));
      updateCamera(cam, s, stage, r.events, defs, tops);
      const [u, v] = s.fighters;
      const v3 = visibleBounds(cam);
      out.push({
        at: i,
        move: u.action === "special" ? u.move : null,
        trapped: v.action === "finalTrapped",
        frozen: v.combat.launchSource === u.port && v.hitlag > 0,
        top: toFloat(u.y) + tops[0]!,
        seen: v3.top,
        feet: toFloat(u.y),
        bottom: v3.bottom,
        zoom: cam.zoom,
        plain,
        punch: cam.koZoom.active,
        hit: r.events.hits.some((h) => h.attacker === u.port && u.move === "finalEnd"),
      });
    }
    return out;
  }

  /**
   * How far a mesh stands proud of the top of its hurt capsule: the uppercut's
   * fingers over the hand's capsule (`dk-trap2-04-hit-234`, re-review 2's N8).
   * UNVERIFIED: read off the screenshots, not measured; the meshes are not in the repo.
   */
  const PROUD = 3;

  it.each([2, 8, 12])("keeps Donkey Kong's uppercut fist, fingertips and all, and his tag in the frame from the hit's first frame through the launch's freeze, Mario caught %i ahead (N4, N8)", (gap) => {
    const frames = filmed("donkeyKong", gap);
    const freeze = frames.filter((f) => f.frozen);
    expect(freeze.length).toBe(15);
    expect(freeze.every((f) => f.punch)).toBe(true);
    const hit = frames.filter((f) => f.hit);
    expect(hit.length).toBe(1);
    const cropped = [...hit, ...freeze].filter((f) => f.top + PROUD > f.seen || f.feet < f.bottom).map((f) => `${f.at}: top ${f.top.toFixed(1)} seen ${f.seen.toFixed(1)}`);
    expect(cropped).toEqual([]);
  });

  it.each([2, 18, 26])("gives Critical Hit a close-up through Marth's hit freeze, Mario %i away: from a settled camera, 1.7 times the plain zoom and 1.55 times the zoom before the hit, Marth whole (N6)", (gap) => {
    const frames = filmed("marth", gap);
    const freeze = frames.filter((f) => f.frozen);
    expect(freeze.length).toBe(30);
    const before = frames[frames.indexOf(freeze[0]) - 1].zoom;
    const peak = Math.max(...freeze.map((f) => f.zoom));
    // Settled: about 1.73 times the plain zoom, 1.59 times the zoom just before the hit.
    expect(peak).toBeGreaterThanOrEqual(freeze[0].plain * 1.7);
    expect(peak).toBeGreaterThanOrEqual(before * 1.55);
    expect(freeze.filter((f) => f.top > f.seen || f.feet < f.bottom).map((f) => f.at)).toEqual([]);
  });

  it.each([
    ["fox", 3],
    ["kirby", 4],
    ["pikachu", 2],
  ] as const)("keeps %s's close-up through the launch, Mario %i away: no zoom out on contact", (user, gap) => {
    const frames = filmed(user, gap);
    const hit = frames.findIndex((f) => f.move === "finalEnd" && !f.trapped);
    expect(hit).toBeGreaterThan(0);
    const scene = frames[hit - 1].zoom;
    for (const f of frames.slice(hit, hit + 20)) expect(f.zoom, `frame ${f.at}`).toBeGreaterThanOrEqual(scene * 0.97);
  });
});
