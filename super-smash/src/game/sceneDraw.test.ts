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
 * and `sceneShiftAt`, with the drawn tops the match runner hands them). The sim
 * keeps both where they are: the golden's trace is untouched.
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
  /** The user's drawn shift. */
  shift: number;
  /** Mario from the user's sim position: ahead of it along its facing, and above it. */
  ahead: number;
  above: number;
  /** The drawn body overlaps Mario, at any of the drawn instants. */
  into: boolean;
}

/** Every frame of the user's Final Smash parts, from the press. */
function run(user: string, gap: number): Frame[] {
  let s = ready(user, gap);
  const defs: FighterDef[] = [CTX.fighter(user), CTX.fighter("mario")];
  const bones = bake.hurtboxes(user)!.map((h) => h.bone);
  let prev: InputFrame[] = [0, 0];
  const out: Frame[] = [];
  for (let i = 0; i < 600; i++) {
    const now: InputFrame[] = [i === 0 ? Btn.Special : 0, 0];
    const before = s;
    s = step(s, now, { prevInputs: prev, ctx: CTX }).state;
    prev = now;
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
    const rs = { current: s, previous: before, fighters: defs, tops: s.fighters.map((f) => drawnTop(defs[f.port], f, s.frame, bake)) };
    const shift = sceneShiftAt(rs, 1);
    let into = false;
    if (held !== null) {
      for (const alpha of [0, 0.5, 1]) {
        const at = sceneShiftAt(rs, alpha);
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

describe("no Final Smash user drawn inside the fighter it trapped, at its real trap distances (ruling R-T17i)", () => {
  // [user, activation gap, where it traps Mario] (the re-review's N2 table: Fox
  // where Mario stands, Kirby from 3 (it misses at 2), Pikachu 6.9 to 15 after
  // its dash, Marth −4 to 20, his dash carrying him level with or past Mario at
  // the closest; Donkey Kong where Mario stands).
  it.each([
    ["donkeyKong", 2, 2],
    ["donkeyKong", 8, 8],
    ["donkeyKong", 12, 12],
    ["fox", 2, 2],
    ["fox", 3, 3],
    ["fox", 4, 4],
    ["kirby", 3, 3],
    ["kirby", 4, 4],
    ["kirby", 5, 5],
    ["pikachu", 2, 6.9],
    ["pikachu", 4, 8.9],
    ["pikachu", 8, 8.6],
    ["pikachu", 10, 11],
    ["pikachu", 30, 12],
    ["pikachu", 54, 13.5],
    ["pikachu", 42, 15],
    ["marth", 2, -4],
    ["marth", 6, 0],
    ["marth", 10, 4],
    ["marth", 14, 8],
    ["marth", 18, 12],
    ["marth", 26, 20],
  ] as const)("%s from %i away, trapping at %f: the trap, the scene, the launch's freeze and its flight", (user, gap, trap) => {
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

describe("the camera on a Final Smash's end hit (ruling R-T17j)", () => {
  /** The camera the match runner drives, every frame from the press: the moves, and how tall each fighter is drawn. */
  function filmed(user: string, gap: number) {
    let s = ready(user, gap);
    const defs: FighterDef[] = [CTX.fighter(user), CTX.fighter("mario")];
    const stage = STAGES.find((st) => st.id === "finalDestination")!;
    const cam = createCamera(stage);
    let prev: InputFrame[] = [0, 0];
    const out: { at: number; move: string | null; trapped: boolean; frozen: boolean; top: number; seen: number; feet: number; bottom: number; zoom: number; punch: boolean }[] = [];
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
        punch: cam.koZoom.active,
      });
    }
    return out;
  }

  it.each([2, 8, 12])("keeps Donkey Kong's uppercut fist and his tag in the frame through the launch's freeze, Mario caught %i ahead (the re-review's N4)", (gap) => {
    const frames = filmed("donkeyKong", gap);
    const freeze = frames.filter((f) => f.frozen);
    expect(freeze.length).toBe(15);
    expect(freeze.every((f) => f.punch)).toBe(true);
    const cropped = freeze.filter((f) => f.top > f.seen || f.feet < f.bottom).map((f) => `${f.at}: top ${f.top.toFixed(1)} seen ${f.seen.toFixed(1)}`);
    expect(cropped).toEqual([]);
  });

  it.each([2, 18, 26])("gives Critical Hit a close-up through Marth's hit freeze, Mario %i away: the KO punch-in's 1.7 times the zoom it had, Marth whole", (gap) => {
    const frames = filmed("marth", gap);
    const freeze = frames.filter((f) => f.frozen);
    expect(freeze.length).toBe(30);
    const before = frames[frames.indexOf(freeze[0]) - 1].zoom;
    expect(Math.max(...freeze.map((f) => f.zoom))).toBeGreaterThanOrEqual(before * 1.7);
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
