import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { cpuInput, type CpuWorld } from "@/ai/cpu";
import { meleeReachFromDef, stageViewFromDef } from "@/ai/behaviours";
import { mixBool, mixInt, mixString } from "@/engine/hash";
import { createInitialState, step } from "@/engine/simulate";
import type { SimContext } from "@/engine/simulate";
import type { GameState, InputFrame, MatchRules } from "@/engine/types";
import { FIGHTERS } from "@/fighters";
import { STAGES } from "@/stages";

/**
 * The strangler's safety net (Plan 2, Task 0).
 *
 * Four real matches — real roster, real stages, two real CPUs (levels 9 and 7)
 * — for 3,600 frames each. Every 100 frames the test folds the
 * *presentation-visible* fields (the ones the renderer, the CPU and the HUD
 * read) into a digest and compares it with the committed one.
 *
 * Deliberately not `hashState`: Plan 2 adds fields to `FighterState`, and
 * `hashState` must cover them (that is its job), so its value changes on every
 * such task even when nobody moves differently. This digest changes only when
 * *behaviour* changes. A refactor task must leave it untouched; a behaviour task
 * regenerates it on purpose and says so in its commit message:
 *
 *   UPDATE_GOLDEN=1 pnpm vitest run src/game/golden.test.ts
 */

const FIXTURE = join(process.cwd(), "src", "game", "__golden__", "engine-trace.json");
const FRAMES = 3600;
const EVERY = 100;
const LEVELS = [9, 7] as const;

const FIGHTER_BY_ID = new Map(FIGHTERS.map((f) => [f.id, f]));
const STAGE_BY_ID = new Map(STAGES.map((s) => [s.id, s]));
const CTX: SimContext = {
  fighter(id) {
    const d = FIGHTER_BY_ID.get(id);
    if (d === undefined) throw new Error(`unknown fighter ${id}`);
    return d;
  },
  stage(id) {
    const s = STAGE_BY_ID.get(id);
    if (s === undefined) throw new Error(`unknown stage ${id}`);
    return s;
  },
};

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true };

const MATCHES = [
  { name: "mario-fox-battlefield", stage: "battlefield", fighters: ["mario", "fox"], seed: 101 },
  { name: "donkeyKong-pikachu-finalDestination", stage: "finalDestination", fighters: ["donkeyKong", "pikachu"], seed: 202 },
  { name: "link-samus-smashville", stage: "smashville", fighters: ["link", "samus"], seed: 303 },
  { name: "kirby-marth-pokemonStadium2", stage: "pokemonStadium2", fighters: ["kirby", "marth"], seed: 404 },
] as const;

/** Everything a presentation layer reads, and nothing Plan 2 adds. */
function digest(s: GameState): number {
  let x = mixInt(0x811c9dc5, s.frame);
  x = mixInt(x, s.rngSeed);
  x = mixInt(x, s.freezeFrames);
  for (const f of s.fighters) {
    x = mixInt(x, f.x);
    x = mixInt(x, f.y);
    x = mixInt(x, f.vx);
    x = mixInt(x, f.vy);
    x = mixInt(x, f.facing);
    x = mixBool(x, f.grounded);
    x = mixString(x, f.action);
    x = mixInt(x, f.actionFrame);
    x = f.move === null ? mixInt(x, 0) : mixString(x, f.move);
    x = mixInt(x, f.charge);
    x = mixInt(x, f.damage);
    x = mixInt(x, f.stocks);
    x = mixInt(x, f.hitstun);
    x = mixInt(x, f.hitlag);
    x = mixInt(x, f.shieldHealth);
    x = mixInt(x, f.jumpsUsed);
    x = mixInt(x, f.intangible);
    x = mixInt(x, f.invincible);
  }
  x = mixInt(x, s.projectiles.length);
  for (const p of s.projectiles) {
    x = mixInt(x, p.x);
    x = mixInt(x, p.y);
  }
  return x >>> 0;
}

interface Played {
  readonly digests: number[];
  readonly hits: number;
  readonly shieldHits: number;
  readonly kos: number;
}

function play(match: (typeof MATCHES)[number]): Played {
  const stage = CTX.stage(match.stage);
  let state = createInitialState(
    match.stage,
    match.fighters.map((defId) => ({ defId })),
    RULES,
    match.seed,
    CTX,
  );
  const worlds: CpuWorld[] = match.fighters.map((id) => {
    const def = CTX.fighter(id);
    return { stage: stageViewFromDef(stage), jumps: def.attributes.jumps, meleeReach: meleeReachFromDef(def) };
  });
  let cpuSeed = match.seed ^ 0x1f2e3d4c;
  let prev: InputFrame[] = match.fighters.map(() => 0);
  const digests: number[] = [];
  let hits = 0;
  let shieldHits = 0;
  let kos = 0;
  for (let frame = 1; frame <= FRAMES; frame++) {
    const inputs = match.fighters.map((_, port) => {
      const r = cpuInput(state, port, LEVELS[port], cpuSeed, worlds[port]);
      cpuSeed = r.seed;
      return r.input;
    });
    const out = step(state, inputs, { prevInputs: prev, ctx: CTX });
    state = out.state;
    prev = inputs;
    hits += out.events.hits.length;
    shieldHits += out.events.shieldHits.length;
    kos += out.events.kos.length;
    if (frame % EVERY === 0) digests.push(digest(state));
  }
  return { digests, hits, shieldHits, kos };
}

describe("engine golden trace", () => {
  const played = new Map(MATCHES.map((m) => [m.name, play(m)]));

  if (process.env.UPDATE_GOLDEN === "1") {
    it("writes the golden trace", () => {
      const out: Record<string, number[]> = {};
      for (const m of MATCHES) out[m.name] = played.get(m.name)!.digests;
      if (!existsSync(dirname(FIXTURE))) mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, JSON.stringify(out, null, 2) + "\n");
      expect(existsSync(FIXTURE)).toBe(true);
    });
    return;
  }

  const expected = JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, number[]>;
  for (const m of MATCHES) {
    it(`replays ${m.name} exactly`, () => {
      const want = expected[m.name];
      const got = played.get(m.name)!.digests;
      expect(got.length).toBe(want.length);
      const firstDiff = got.findIndex((v, i) => v !== want[i]);
      expect(firstDiff, `first divergence by frame ${(firstDiff + 1) * EVERY}`).toBe(-1);
    });
  }

  it("exercises combat, not an idle screen", () => {
    // A trace of idle fighters would pass every refactor and prove nothing.
    // Measured when written: hits 16/14/12/20, shield hits 1/0/1/2, KOs 1/3/1/0.
    const all = MATCHES.map((m) => played.get(m.name)!);
    for (const p of all) expect(p.hits).toBeGreaterThan(5);
    expect(all.reduce((n, p) => n + p.shieldHits + p.kos, 0)).toBeGreaterThan(2);
  });
});
