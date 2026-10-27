# Plan 2 — David-Smash: engine architecture alignment (SSBU-shaped engine)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Starts after Plan 1 is merged.** Plan 1 (`docs/superpowers/plans/2026-10-24-plan-1-hosting-online-rename.md`) lands first. This plan is written against the post-Plan-1 engine and keeps everything Plan 1 Task 15 and Task 17 add: `Btn.Soft = 1 << 9` (`types.ts`), `Intent.soft` and the partial-stick walk/tilt in `interpretInput` (`states.ts` — this plan never edits `Intent` or `interpretInput`), `applyDI(angle, x, y, soft?)` and `SOFT_DI_SHIFT` (`knockback.ts`, `constants.ts`; the call in `releasePendingLaunch` is left as Plan 1 writes it), and `ENGINE_ROLLBACK_DEPS` (`src/game/rollbackDeps.ts`, which calls `step`, `cloneState` and `hashState` — all three keep their signatures here; Task 27 adds `ctx` to its `step` options). Task 27 also edits Plan 1's online files — `src/net/online/lobby.ts` (Task 12), `src/game/onlineConfig.ts` (Task 12), `src/lib/onlineStore.ts` (Task 14), `src/game/matchRunner.ts` (Task 17) and the `CONFIG` fixtures in their tests and in `CharacterSelect.online.test.tsx` (Task 20) — and quotes Plan 1's text for each. `src/fighters/params.test.ts` (Task 1) reads `research/rebuild-2026-10/ssbu_fighter_params.csv`, which Plan 1 Task 23 commits. Plan 1 also takes DECISIONS **D54**; this plan's entry is **D55**. Locations are cited by symbol, not line, wherever Plan 1 moves lines; a "pre-Plan-1 line" is given only as a hint.

**Goal:** Restructure `src/engine` into the shape of Super Smash Bros. Ultimate's own engine — `fighter_param.prc`-named params, a KineticModule of summed energies, a StatusModule of per-status `pre`/`main`/`exec`/`end` objects, and ACMD `game_` scripts with bone-attached hitboxes — without changing what `step()` is, then fix movement fidelity (launch decay, jump arcs, midair jumps, air friction, walk/run acceleration, light/heavy landing, a first ECB seam) with sourced tests, move the renderer's jump timing onto the same rule, and make online peers agree on the bone table.

**Architecture:** A strangler refactor behind a golden behaviour trace: each structural task (Tasks 1–16) must leave a 4-match CPU-vs-CPU fingerprint untouched, and each fidelity task (17–25) changes it on purpose with a published-number test. Tasks 26–27 carry the new engine outward (renderer and lab timing; one game `SimContext` and an online bone-table fingerprint) and Task 28 removes the scaffolding and records D55. `FighterState.vx/vy` survive as the sum of the KineticModule energies and `action` keeps its names (aliased to `FIGHTER_STATUS_KIND_*`), so the renderer, CPU, netcode and HUD read the engine exactly as before. Moves run as `game_` scripts through a pure interpreter; in this plan every script is the exact compilation of a legacy `MoveDef` on the root bone, while the published scripts for all eight fighters are imported as reference and reconciled, ready for Plan 4's bone bake.

**Tech Stack:** TypeScript 5 (strict), Next.js 16.3, vitest 4.1 + fast-check 4, Playwright 1.5x (unchanged here), pnpm; Node 26 for `scripts/import-acmd.mjs` (it imports a `.ts` file directly, relying on Node's built-in type stripping).

**Spec:** docs/superpowers/specs/2026-10-24-david-smash-design.md

**Conventions for every task** (as Plan 1)
- `pnpm …` commands run in `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates/super-smash`; file paths in steps are relative to it.
- `git …` commands run from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`, paths prefixed `super-smash/`, committing straight to `main`. Never `git add -A`; stage the exact paths listed. Never push without David's go.
- Every commit body ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The full gate is `pnpm typecheck && pnpm lint && pnpm test`.
- This plan was executed end to end in a scratch copy of the repo before it was written, with Plan 1 Task 15's engine edits and Plan 1 Tasks 12, 14 and 17's lobby, online-store and rollback files applied (Plan 1 Task 13's session and Task 4/10's signalling types were stood in for by type-only stubs): every test in it fails where it says and passes after its implementation, and the gate is green after every task. The only edits not executed exactly as written are three in Task 27 that are anchored to Plan 1 text this copy did not have: two in `CharacterSelect.online.test.tsx` (not run), and `matchRunner.ts`'s post-Plan-1 `tick` line and import anchor (the equivalent pre-Plan-1 lines were edited and run instead). Counts quoted below (scripts per fighter, allowlist entries, test counts) come from that run.

## Global Constraints

- Determinism: `src/engine/**` keeps Q12 fixed point, `Ratio` constants and the LUT trig; no `Math.random`, `Date`, `performance.now` or float trig in the engine; `src/engine/layering.test.ts` keeps passing with its forbidden list unchanged.
- Determinism: anything the sim reads from animation is baked at build time into integer tables (`BoneTable`, Task 13); the sim never evaluates float animation, and reads the table only through `SimContext.bones` (Task 15), never a module global.
- Rollback: `step(state, inputs, { prevInputs })`, `StepEvents`, `cloneState`, `hashState` keep their signatures; every new state field is cloned and hashed (reflective tests, Task 2).
- Tests: vitest unit/property tests stay green after every task; new behaviour is TDD; Playwright e2e is untouched by this plan and must stay green (`pnpm test:e2e`).
- Data: published numbers only — SmashWiki, Ultimate Frame Data, rubendal SSBU-Calculator / Data Viewer, Kurogane; every number a test pins cites its URL; anything unsourced is marked `UNVERIFIED:`.
- Code: HDR, smash-script, skyline-smash and ssbu-recomp are read for structure and names only; no code is copied from them.
- Repo: `DavidBrin/Replicates` is public and committed straight to `main`; no ripped assets are added. Committing the generated reference scripts (published data, about 284 KB) is the planner's call, based on David saying legal is not an issue; confirmed when David approves this plan.
- Layering: `engine/` imports nothing from `render/`, `net/`, `components/`, `app/`, `audio/`, `ai/`, `input/`, React or Next.
- Golden trace: a refactor task must leave `src/game/__golden__/engine-trace.json` untouched; only a task that says "regenerate" may change it, and its commit says why.

## Review Focus

Five failure modes a player would hit that no single feature test covers, and the test that now owns each:

1. **Rollback desync from a field `cloneState` or `hashState` misses** (the new `kinetic` energies, or a field added in Plans 3–5). Two peers drift apart silently. Tests: `src/engine/hash.test.ts` "notices a mutation of every leaf of FighterState, found by walking it" and `src/engine/simulate.test.ts` "copies every field of every fighter, and shares no object with the original" (Task 2) — both walk the object, so they cover fields nobody has written yet.
2. **A status changed during hitlag** (a hit lands on a rolling, shielding or attacking fighter while both are frozen). `changeStatus` runs `end`/`pre` at hit time; `main` must not run while frozen. Test: `simulate.test.ts` "a status change during hitlag (Review Focus #2)" (Task 6). The golden trace caught the one real instance — a roll `end` hook that zeroed `vx` mid-hitlag (Task 7 keeps the stop in `main`).
3. **`frame(n)` under `FT_MOTION_RATE`** firing a game frame late through Q12 rounding (FSM 0.9 reaches 10.99976 after nine frames). Test: `src/engine/acmd/interpreter.test.ts` "reaches frame(11) on game frame 10 at FSM 0.9, exactly" plus the 1/3 case (Task 12).
4. **Fast fall and jump on the same frame** (down + jump while falling). Must be a midair jump with `fastFalling` false and rising. Test: `src/fighters/movement.test.ts` "takes the jump, not a fast fall, when down and jump arrive on one frame" (Task 20).
5. **Ledge grab with the ECB seam** — walls now push the body clear, so a fighter who walks off an edge must still reach the ledge, and the reach is measured from the body's side. Tests: `src/engine/physics.test.ts` "reaches a ledge from the side of the body…" and "still takes the ledge a fighter walked off…" (Task 25), plus the existing `simulate.test.ts` "catches a fighter who walks off the edge on the ledge". (The seam is partial — see Task 25; Plan 4 completes it from bones.)

---

## File Structure

Created:
- `src/game/golden.test.ts`, `src/game/__golden__/engine-trace.json` — the behaviour fingerprint (Task 0).
- `src/engine/params.ts` (+ `.test.ts`) — `FighterParams` (prc names), `paramsFromAttributes`, `fighterParams` (Task 1).
- `src/fighters/params.ts` (+ `.test.ts`) — `FIGHTER_PARAMS` for the eight fighters, pinned to the research CSV (Task 1).
- `src/engine/kinetic.ts` (+ `.test.ts`) — KineticModule: energies, exec, set/jump/launch/reel/land/motion (Tasks 2–4, 17–19, 21–24).
- `src/engine/velocity-writes.test.ts` — no direct `vx`/`vy` writes outside `kinetic.ts` (Task 4).
- `src/engine/status/kind.ts` — `StatusKind`, alias tables, `FighterStatus`, registry, `changeStatus` (Task 5).
- `src/engine/status/index.ts` — registers every status (side-effect import from `simulate.ts`) (Task 5).
- `src/engine/status/{meta,damage,guard,attack,cliff,ground,air}.ts` — the 42 status objects (Tasks 6–11).
- `src/engine/status/status.test.ts`, `src/engine/status/groups.test.ts` — StatusModule tests (Tasks 5–11).
- `src/engine/acmd/types.ts`, `dsl.ts`, `interpreter.ts` (+ `interpreter.test.ts`) — `game_` scripts (Task 12).
- `src/engine/acmd/bones.ts`, `hitboxes.ts` (+ `bones.test.ts`) — `BoneTable` and script-hitbox resolution (Task 13).
- `src/engine/acmd/legacy.ts` (+ `legacy.test.ts`) — `MoveDef` → `game_` script compiler and parity proof (Task 14).
- `src/engine/acmd/run.ts` — `moveScriptFrame`, the sim's one way to read a move (Task 15).
- `scripts/import-acmd.mjs` — fetches and converts the published scripts (Task 16).
- `src/fighters/acmd/parse.ts` (+ `parse.test.ts`), `reference.ts`, `index.ts`, `generated/{mario,donkeyKong,link,samus,kirby,fox,pikachu,marth}.ts`, `reference.test.ts`, `reconcile.test.ts`, `reconcile.allow.json` — imported reference scripts, self-check and D17 ratchet (Task 16).
- `src/fighters/movement.test.ts` — movement through `step()` with the real roster (Tasks 19–24, 26).
- `src/render/poses/jumpTiming.test.ts` — the jump clip's length from the engine's jump rule (Task 26).
- `src/game/simContext.ts` (+ `.test.ts`) — `GAME_SIM_CONTEXT`, `engineFingerprint` (Task 27).

Modified:
- `src/engine/types.ts` — `FighterDef.params?`, `FighterDef.scripts?`, `FighterState.kinetic` (Tasks 1, 2, 14).
- `src/engine/states.ts` — `startAction`/`startMove` via `changeStatus`; helpers exported; the `advanceFighter` switch removed (pre-Plan-1 lines 575–1076); `applyMovement` (pre-Plan-1 1244–1311) driven by the KineticModule; `applyMoveMomentum`, `hasSuperArmour` read scripts; `airJump`, `onLanded` read params (Tasks 3–11, 15, 17–20, 24, 28). It shrinks from 1,428 to about 905 lines.
- `src/engine/simulate.ts` — `cloneState`/`createInitialState` carry `kinetic`; KO, clank, grab, shield-pushback and `releasePendingLaunch` writes go through the KineticModule; `gatherHitboxes` and `spawnDueProjectiles` read scripts; `SimContext.bones`; `findLedgeGrab` gets the ECB (Tasks 2, 4, 5, 15, 25).
- `src/engine/physics.ts` — collision writes via the KineticModule; `kineticLand` on landing; ECB walls/ceilings/landings/ledges; `decayLaunch` removed (Tasks 3, 4, 17, 25, 28).
- `src/engine/hash.ts` — `mixKinetic` (Task 2).
- `src/fighters/{mario,donkeyKong,link,samus,kirby,fox,pikachu,marth}.ts` — `params: FIGHTER_PARAMS.<id>`; Link's walk speed 1.247 (Task 1).
- Test fixtures building a `FighterState` — `kinetic: emptyKinetic()` (Task 2): `src/render/testFixtures.ts`, `src/ai/cpu.test.ts`, `src/ai/behaviours.test.ts`, `src/engine/{hash,projectile,states,physics}.test.ts`.
- `src/engine/{hash,simulate,states,physics}.test.ts` — reflective coverage, hitlag, script override, jump-velocity and ECB expectations (Tasks 2, 6, 15, 19, 25, 28).
- `src/render/poses/timing.ts` — the land clip's length reads `charge` (Task 24); `JumpTiming`/`jumpTimingFor` replace `JumpAttributes` (Task 26).
- `src/render/renderer.ts`, `src/app/anim/page.tsx` (+ `lab.test.ts`), comments in `src/render/poses/{rise,fall}.ts` and `rise.test.ts` — jump timing from params (Task 26).
- Plan 1's online files: `src/net/online/lobby.ts`, `src/game/onlineConfig.ts`, `src/lib/onlineStore.ts`, `src/game/rollbackDeps.ts`, `src/game/matchRunner.ts` and their tests, plus `src/components/menu/CharacterSelect.online.test.tsx` — the bone-table fingerprint and the game `SimContext` (Task 27).
- `DECISIONS.md` (D55), `README.md` (Architecture) (Task 28).

---
### Task 0: The golden trace: a behaviour fingerprint every refactor must keep

Every later task is either a refactor that must not change behaviour or a fix that must change it on purpose. Before touching the engine, freeze a behaviour fingerprint: four CPU-vs-CPU matches on the real roster, digested every 100 frames over exactly the fields the renderer, CPU and HUD read. `hashState` cannot do this job — Plan 2 adds state fields it must cover, so it changes even when nobody moves differently.

**Files:**
- Create: `super-smash/src/game/__golden__/engine-trace.json` (generated by a command in this task)
- Create: `super-smash/src/game/golden.test.ts`

**Interfaces:** Consumes: `cpuInput`, `CpuWorld` (`src/ai/cpu.ts`), `meleeReachFromDef`, `stageViewFromDef` (`src/ai/behaviours.ts`), `mixInt`/`mixBool`/`mixString` (`src/engine/hash.ts`), `createInitialState`, `step`, `SimContext` (`src/engine/simulate.ts`). Produces: `src/game/__golden__/engine-trace.json` (`Record<matchName, number[]>`, 36 digests per match) and the command every later task uses: `UPDATE_GOLDEN=1 pnpm vitest run src/game/golden.test.ts`.

- [ ] **Step 1: Write the test**

Create `src/game/golden.test.ts`:

```ts
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
```

- [ ] **Step 2: Record the trace, then replay it**

Run: `UPDATE_GOLDEN=1 pnpm vitest run src/game/golden.test.ts`
Expected: 1 test passes and `src/game/__golden__/engine-trace.json` exists (four keys, 36 numbers each).

Run: `pnpm vitest run src/game/golden.test.ts` twice.
Expected: 5 tests pass both times (four replays plus the activity check). Two identical runs are the determinism check; if the second fails, stop — something in `step()` reads outside `GameState`.

- [ ] **Step 3: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0. `pnpm lint` reports no errors and no warning in a file this task touched; any warnings it printed before this plan started (measure once, with Plan 1 merged, before Task 0) are unchanged.

- [ ] **Step 4: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/src/game/__golden__/engine-trace.json \
  super-smash/src/game/golden.test.ts
git commit -m "super-smash: a golden behaviour trace to keep the Plan 2 refactor honest" -m "Four CPU-vs-CPU matches (levels 9 and 7) for 3,600 frames, digested every 100 frames over the fields the presentation layers read. Refactor tasks must leave it unchanged; behaviour tasks regenerate it on purpose." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1: FighterParams with fighter_param.prc names

The engine reads `FighterAttributes`, a replica-shaped bag. Give every fighter its `fighter_param.prc` numbers under the game's own names (verified against ultimate-research/param-labels `ParamLabels.csv`), sourced from rubendal's SSBU-Calculator and pinned against the research CSV. Field names and types follow skyline-smash's `FighterParamTable` struct (the landing trio is `landing_frame_light`, `landing_frame`, `landing_heavy_frame`). **Dependency:** `src/fighters/params.test.ts` reads `research/rebuild-2026-10/ssbu_fighter_params.csv`, which Plan 1 Task 23 commits; check it is tracked (`git ls-files super-smash/research/rebuild-2026-10/ssbu_fighter_params.csv`) before starting. Readers migrate in later tasks; `fighterParams(def)` adapts test fixtures that only have attributes. The CSV proves one roster number wrong — Link's walk speed is 1.247, not 1.237 — so this task fixes it and regenerates the golden trace.

**Files:**
- Create: `super-smash/src/engine/params.test.ts`
- Create: `super-smash/src/engine/params.ts`
- Create: `super-smash/src/fighters/params.test.ts`
- Create: `super-smash/src/fighters/params.ts`
- Modify: `super-smash/src/engine/types.ts`
- Modify: `super-smash/src/fighters/donkeyKong.ts` — imports
- Modify: `super-smash/src/fighters/fox.ts` — imports
- Modify: `super-smash/src/fighters/kirby.ts` — imports
- Modify: `super-smash/src/fighters/link.ts` — imports
- Modify: `super-smash/src/fighters/mario.ts` — imports
- Modify: `super-smash/src/fighters/marth.ts` — imports
- Modify: `super-smash/src/fighters/pikachu.ts` — imports
- Modify: `super-smash/src/fighters/samus.ts` — imports
- Modify: `super-smash/src/game/__golden__/engine-trace.json` (regenerated by a command in this task)

**Interfaces:** Produces (`src/engine/params.ts`):
```ts
export interface FighterParams { walk_speed_max; walk_accel_mul; walk_accel_add; ground_brake; dash_speed; run_accel_mul; run_accel_add; run_speed_max; jump_squat_frame; jump_initial_y; jump_y; mini_jump_y; jump_aerial_y; jump_aerial_y_list?; jump_count_max; air_accel_x_mul; air_accel_x_add; air_speed_x_stable; air_brake_x; air_accel_y; air_speed_y_stable; dive_speed_y; damage_fly_top_air_accel_y; damage_fly_top_speed_y_stable; weight; landing_attack_air_frame_n/f/b/hi/lw; landing_frame_light; landing_frame; landing_heavy_frame; shield_radius; scale } // all readonly number (list: readonly number[])
export function paramsFromAttributes(a: FighterAttributes, def?: Pick<FighterDef, "moves">): FighterParams;
export function fighterParams(def: FighterDef): FighterParams;
```
`FighterDef.params?: FighterParams` (`types.ts`); `FIGHTER_PARAMS: Readonly<Record<RosterId, FighterParams>>`, `type RosterId` (`src/fighters/params.ts`).

- [ ] **Step 1: Write the failing test**

Create `src/engine/params.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { div, fx, mul } from "./fixed";
import { fighterParams, paramsFromAttributes } from "./params";
import type { FighterAttributes, FighterDef } from "./types";

const ATTRS: FighterAttributes = {
  weight: 98,
  walkSpeed: fx(1.1),
  initialDashSpeed: fx(1.76),
  runSpeed: fx(1.5),
  airSpeed: fx(1.15),
  airAccelBase: fx(0.01),
  airAccelAdditional: fx(0.05),
  gravity: fx(0.087),
  fallSpeed: fx(1.5),
  fastFallSpeed: fx(2.4),
  traction: fx(0.08),
  fullHopVelocity: fx(3.1),
  shortHopVelocity: fx(1.7),
  airJumpVelocity: fx(2.85),
  jumps: 2,
  canWallJump: true,
  width: fx(4),
  height: fx(12),
  jumpSquatFrames: 3,
};

function def(over: Partial<FighterDef> = {}): FighterDef {
  return {
    id: "t",
    name: "t",
    series: "t",
    number: 1,
    attributes: ATTRS,
    moves: { nair: { slot: "nair", name: "n", totalFrames: 30, hitboxes: [], landingLag: 7 } },
    palette: { primary: "#000000", secondary: "#000000", accent: "#000000", skin: "#000000", outline: "#000000", alts: [] },
    blurb: "t",
    ...over,
  };
}

describe("paramsFromAttributes — the legacy bridge", () => {
  const p = paramsFromAttributes(ATTRS, def());

  it("keeps the legacy walk and run acceleration totals (2× and 3× traction)", () => {
    expect(p.walk_accel_add + p.walk_accel_mul).toBe(2 * ATTRS.traction);
    expect(p.run_accel_add + p.run_accel_mul).toBe(3 * ATTRS.traction);
  });

  it("has no air friction and no full-hop initial phase, as the legacy engine had neither", () => {
    expect(p.air_brake_x).toBe(0);
    expect(p.jump_initial_y).toBe(0);
  });

  it("recovers jump heights from the legacy launch velocities by v^2 / 2g", () => {
    expect(p.jump_y).toBe(div(mul(ATTRS.fullHopVelocity, ATTRS.fullHopVelocity), 2 * ATTRS.gravity));
    expect(p.mini_jump_y).toBe(div(mul(ATTRS.shortHopVelocity, ATTRS.shortHopVelocity), 2 * ATTRS.gravity));
  });

  it("launches vertically at the roster's 1.8 fall speed, fx(1.8) exactly", () => {
    expect(p.damage_fly_top_speed_y_stable).toBe(fx(1.8));
  });

  it("reads aerial landing lag from the moveset", () => {
    expect(p.landing_attack_air_frame_n).toBe(7);
    expect(p.landing_attack_air_frame_f).toBe(0);
  });
});

describe("fighterParams", () => {
  it("prefers the definition's own params", () => {
    const own = paramsFromAttributes(ATTRS);
    const d = def({ params: { ...own, walk_speed_max: fx(9) } });
    expect(fighterParams(d).walk_speed_max).toBe(fx(9));
  });

  it("adapts and caches a definition without params", () => {
    const d = def();
    expect(fighterParams(d)).toBe(fighterParams(d));
    expect(fighterParams(d).walk_speed_max).toBe(ATTRS.walkSpeed);
  });
});
```

Create `src/fighters/params.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { fx } from "@/engine/fixed";
import type { FighterParams } from "@/engine/params";
import { FIGHTERS } from "./index";
import { FIGHTER_PARAMS, type RosterId } from "./params";

/**
 * Source: rubendal/SSBU-Calculator, `Params` block of
 * https://github.com/rubendal/SSBU-Calculator/blob/233590e94bc4bd8813f2d1a2af45c8c46648f351/Data/<fighter>/data.json,
 * as extracted to research/rebuild-2026-10/ssbu_fighter_params.csv (committed by Plan 1 Task 23).
 */
const CSV = readFileSync(
  join(process.cwd(), "research", "rebuild-2026-10", "ssbu_fighter_params.csv"),
  "utf8",
);

const CSV_ROW: Record<RosterId, string> = {
  mario: "mario",
  donkeyKong: "donkey",
  link: "link",
  samus: "samus",
  kirby: "kirby",
  fox: "fox",
  pikachu: "pikachu",
  marth: "marth",
};

/** prc name → CSV column, and whether the value is raw (frames, counts, weight) or Q12. */
const COLUMNS: readonly [keyof FighterParams, string, "raw" | "fx"][] = [
  ["weight", "Weight", "raw"],
  ["air_accel_y", "Gravity", "fx"],
  ["air_speed_y_stable", "FallSpeed", "fx"],
  ["dive_speed_y", "FastFallSpeed", "fx"],
  ["damage_fly_top_air_accel_y", "DamageFlyTopGravity", "fx"],
  ["walk_speed_max", "WalkSpeed", "fx"],
  ["dash_speed", "DashInitialSpeed", "fx"],
  ["run_speed_max", "RunSpeed", "fx"],
  ["run_accel_add", "RunBaseAcceleration", "fx"],
  ["run_accel_mul", "RunAddAcceleration", "fx"],
  ["ground_brake", "GroundFriction", "fx"],
  ["jump_squat_frame", "Jumpsquat", "raw"],
  ["jump_y", "JumpHeight", "fx"],
  ["mini_jump_y", "HopHeight", "fx"],
  ["jump_aerial_y", "AirJumpHeight", "fx"],
  ["jump_count_max", "JumpCount", "raw"],
  ["air_speed_x_stable", "AirSpeed", "fx"],
  ["air_accel_x_add", "AerialBaseAcceleration", "fx"],
  ["air_accel_x_mul", "AerialAddAcceleration", "fx"],
  ["air_brake_x", "AirFriction", "fx"],
  ["shield_radius", "ShieldSize", "fx"],
  ["landing_frame_light", "SoftLandingLag", "raw"],
  ["landing_frame", "HardLandingLag", "raw"],
  ["landing_attack_air_frame_n", "NairLandingLag", "raw"],
  ["landing_attack_air_frame_f", "FairLandingLag", "raw"],
  ["landing_attack_air_frame_b", "BairLandingLag", "raw"],
  ["landing_attack_air_frame_hi", "UairLandingLag", "raw"],
  ["landing_attack_air_frame_lw", "DairLandingLag", "raw"],
  ["scale", "CharacterSizeMultiplier", "fx"],
];

function csvRow(internal: string): Record<string, string> {
  const lines = CSV.trim().split("\n");
  const header = lines[0].split(",");
  const line = lines.find((l) => l.split(",")[0] === internal);
  if (line === undefined) throw new Error(`no CSV row for ${internal}`);
  const cells = line.split(",");
  return Object.fromEntries(header.map((h, i) => [h, cells[i]]));
}

const IDS = Object.keys(FIGHTER_PARAMS) as RosterId[];

describe("fighter_param values", () => {
  it.each(IDS)("%s matches every published CSV column", (id) => {
    const row = csvRow(CSV_ROW[id]);
    const p = FIGHTER_PARAMS[id];
    for (const [key, column, kind] of COLUMNS) {
      const want = kind === "raw" ? Number(row[column]) : fx(Number(row[column]));
      expect(p[key], `${id}.${key} vs CSV ${column}`).toBe(want);
    }
  });

  it("pins the calculator-only fields for Mario (Data/mario/data.json)", () => {
    // https://github.com/rubendal/SSBU-Calculator/blob/233590e94bc4bd8813f2d1a2af45c8c46648f351/Data/mario/data.json
    const m = FIGHTER_PARAMS.mario;
    expect(m.walk_accel_add).toBe(fx(0.105)); // WalkBaseAcceleration
    expect(m.walk_accel_mul).toBe(fx(0.105)); // WalkAddAcceleration
    expect(m.jump_initial_y).toBe(fx(19.9815)); // JumpInitialSpeed
    expect(m.landing_heavy_frame).toBe(4); // FallingFrameToUseHardLandingLag
    expect(m.damage_fly_top_speed_y_stable).toBe(fx(1.8)); // DamageFlyTopFallSpeed
  });

  it("gives Samus the one non-4 heavy-landing threshold on this roster", () => {
    // https://github.com/rubendal/SSBU-Calculator/blob/233590e94bc4bd8813f2d1a2af45c8c46648f351/Data/samus/data.json
    expect(FIGHTER_PARAMS.samus.landing_heavy_frame).toBe(7);
  });

  it.each(IDS)("%s rises 0.55 of its full hop in the initial phase", (id) => {
    // SmashWiki "Jump" (https://www.ssbwiki.com/Jump), Super Smash Bros. Ultimate:
    // "For most characters the initial height is 0.55× their full hop height".
    const p = FIGHTER_PARAMS[id];
    expect(Math.abs(p.jump_initial_y - Math.round(p.jump_y * 0.55))).toBeLessThanOrEqual(1);
  });

  it("gives Kirby the five published midair jump heights", () => {
    // https://www.ssbwiki.com/Jump — Super Smash Bros. Ultimate table, Kirby, Air Jump:
    // "21.06378125, 18.528125, 15.931125, 13.34569531, 10.82288281 for each air jump."
    // (https://www.ssbwiki.com/Double_jump lists 22 for Kirby: the AirJumpHeight parameter,
    // which `jump_aerial_y` keeps; the Jump table is the height each jump reaches.)
    expect(FIGHTER_PARAMS.kirby.jump_aerial_y_list).toEqual([
      fx(21.06378125),
      fx(18.528125),
      fx(15.931125),
      fx(13.34569531),
      fx(10.82288281),
    ]);
    expect(FIGHTER_PARAMS.kirby.jump_aerial_y).toBe(fx(22));
  });
});

describe("roster wiring", () => {
  it.each(FIGHTERS.map((f) => [f.id, f] as const))("%s carries its own params", (id, def) => {
    expect(def.params).toBe(FIGHTER_PARAMS[id as RosterId]);
  });

  it.each(FIGHTERS.map((f) => [f.id, f] as const))(
    "%s agrees with its legacy attributes wherever both exist",
    (_id, def) => {
      const a = def.attributes;
      const p = def.params!;
      expect(p.weight).toBe(a.weight);
      expect(p.walk_speed_max).toBe(a.walkSpeed);
      expect(p.dash_speed).toBe(a.initialDashSpeed);
      expect(p.run_speed_max).toBe(a.runSpeed);
      expect(p.air_speed_x_stable).toBe(a.airSpeed);
      expect(p.air_accel_x_add).toBe(a.airAccelBase);
      expect(p.air_accel_x_mul).toBe(a.airAccelAdditional);
      expect(p.air_accel_y).toBe(a.gravity);
      expect(p.air_speed_y_stable).toBe(a.fallSpeed);
      expect(p.dive_speed_y).toBe(a.fastFallSpeed);
      expect(p.ground_brake).toBe(a.traction);
      expect(p.jump_count_max).toBe(a.jumps);
      expect(p.jump_squat_frame).toBe(a.jumpSquatFrames);
      expect(p.landing_attack_air_frame_n).toBe(def.moves.nair?.landingLag);
      expect(p.landing_attack_air_frame_f).toBe(def.moves.fair?.landingLag);
      expect(p.landing_attack_air_frame_b).toBe(def.moves.bair?.landingLag);
      expect(p.landing_attack_air_frame_hi).toBe(def.moves.uair?.landingLag);
      expect(p.landing_attack_air_frame_lw).toBe(def.moves.dair?.landingLag);
    },
  );

  it("walks Link at the published 1.247, not the 1.237 the roster had", () => {
    // https://github.com/rubendal/SSBU-Calculator/blob/233590e94bc4bd8813f2d1a2af45c8c46648f351/Data/link/data.json WalkSpeed 1.247;
    // CSV row `link` agrees. 1.237 was a transcription error.
    const link = FIGHTERS.find((f) => f.id === "link")!;
    expect(link.attributes.walkSpeed).toBe(fx(1.247));
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/engine/params.test.ts src/fighters/params.test.ts`
Expected: FAIL — `Failed to resolve import "./params"` in both test files (the modules do not exist yet).

- [ ] **Step 3: Implement**

Create `src/engine/params.ts`:

```ts
/**
 * Fighter parameters, named as `fighter_param.prc` names them.
 *
 * Ultimate keeps every fighter's movement numbers in one table,
 * `fighter/common/param/fighter_param.prc`, one struct per fighter. The field
 * names below are that table's hash labels, read (names and types only) from
 * skyline-smash's `FighterParamTable` struct —
 * https://github.com/ultimate-research/skyline-smash/blob/0c2e7189c46fecb07a3370f487e0e22585dad21e/src/params/fighter_param.rs
 * — and checked against ultimate-research/param-labels `ParamLabels.csv`.
 * Keeping the game's names means a number here can be looked up anywhere the
 * community discusses it, and Plans 3–5 can add the next field by its real
 * name instead of inventing one.
 *
 * Values come from rubendal's SSBU-Calculator data (`Data/<fighter>/data.json`
 * on the gh-pages branch, commit 233590e94bc4bd8813f2d1a2af45c8c46648f351),
 * whose labels are the calculator's own ("WalkSpeed") and are mapped field by
 * field below. One field is the replica's own and says so: `jump_aerial_y_list`.
 *
 * Units: every speed, acceleration and height is Q12 fixed point in units per
 * frame (per frame² for accelerations); frame counts and the jump count are
 * plain integers; `weight` is the game's raw weight stat.
 */

import { ONE, div, mul } from "./fixed";
import type { FighterAttributes, FighterDef } from "./types";

export interface FighterParams {
  /** Calculator `WalkSpeed`. Top walking speed at full deflection. */
  readonly walk_speed_max: number;
  /** Calculator `WalkAddAcceleration`. Walk acceleration scaled by stick deflection. */
  readonly walk_accel_mul: number;
  /** Calculator `WalkBaseAcceleration`. Walk acceleration at any deflection. */
  readonly walk_accel_add: number;
  /** Calculator `GroundFriction` (traction). */
  readonly ground_brake: number;
  /** Calculator `DashInitialSpeed`. Speed on the first frame of an initial dash. */
  readonly dash_speed: number;
  /** Calculator `RunAddAcceleration`. Dash/run acceleration scaled by deflection. */
  readonly run_accel_mul: number;
  /** Calculator `RunBaseAcceleration`. Dash/run acceleration at any deflection. */
  readonly run_accel_add: number;
  /** Calculator `RunSpeed`. */
  readonly run_speed_max: number;
  /** Calculator `Jumpsquat`. Frames, universally 3 in Ultimate. */
  readonly jump_squat_frame: number;
  /**
   * Calculator `JumpInitialSpeed` — despite the calculator's label, a *height*:
   * how far a full hop rises in its first 4 airborne frames (SmashWiki "Jump",
   * "jump initial height"; 0.55 × `jump_y` for all eight fighters here).
   */
  readonly jump_initial_y: number;
  /** Calculator `JumpHeight`. Full-hop peak height. */
  readonly jump_y: number;
  /** Calculator `HopHeight`. Short-hop peak height. */
  readonly mini_jump_y: number;
  /** Calculator `AirJumpHeight`. Height gained by a midair jump. */
  readonly jump_aerial_y: number;
  /**
   * REPLICA FIELD (no published prc label): the height of each successive
   * midair jump for a multi-jumper. Index 0 is the first midair jump. Absent for
   * fighters whose every midair jump is `jump_aerial_y`.
   */
  readonly jump_aerial_y_list?: readonly number[];
  /** Calculator `JumpCount`. Grounded jump plus midair jumps. */
  readonly jump_count_max: number;
  /** Calculator `AerialAddAcceleration`. Air drift acceleration scaled by deflection. */
  readonly air_accel_x_mul: number;
  /** Calculator `AerialBaseAcceleration`. Air drift acceleration at any deflection. */
  readonly air_accel_x_add: number;
  /** Calculator `AirSpeed`. Top air drift speed. */
  readonly air_speed_x_stable: number;
  /** Calculator `AirFriction`. Horizontal air deceleration with the stick neutral. */
  readonly air_brake_x: number;
  /** Calculator `Gravity`. */
  readonly air_accel_y: number;
  /** Calculator `FallSpeed`. */
  readonly air_speed_y_stable: number;
  /** Calculator `FastFallSpeed`. */
  readonly dive_speed_y: number;
  /** Calculator `DamageFlyTopGravity`. Gravity during a vertical launch. */
  readonly damage_fly_top_air_accel_y: number;
  /** Calculator `DamageFlyTopFallSpeed`. Fall speed during a vertical launch. */
  readonly damage_fly_top_speed_y_stable: number;
  /** Calculator `Weight`. Raw, not Q12. */
  readonly weight: number;
  /** Calculator `NairLandingLag` … `DairLandingLag`. Frames. */
  readonly landing_attack_air_frame_n: number;
  readonly landing_attack_air_frame_f: number;
  readonly landing_attack_air_frame_b: number;
  readonly landing_attack_air_frame_hi: number;
  readonly landing_attack_air_frame_lw: number;
  /**
   * The struct's three landing fields, in its order: `landing_frame_light: f32`,
   * `landing_frame: f32`, `landing_heavy_frame: i32`. The calculator publishes
   * three landing values, `SoftLandingLag`, `HardLandingLag` and
   * `FallingFrameToUseHardLandingLag`; pairing them by order and type (the one
   * integer is the frame threshold) is this replica's reading — UNVERIFIED.
   */
  /** Calculator `SoftLandingLag`. Frames of a light landing. */
  readonly landing_frame_light: number;
  /** Calculator `HardLandingLag`. Frames of a heavy landing. */
  readonly landing_frame: number;
  /**
   * Calculator `FallingFrameToUseHardLandingLag`. Frames spent at full fall
   * speed before a landing counts as heavy (SmashWiki "Lag", Normal landing).
   */
  readonly landing_heavy_frame: number;
  /** Calculator `ShieldSize`. */
  readonly shield_radius: number;
  /** Calculator `CharacterSizeMultiplier`. */
  readonly scale: number;
}

/**
 * Parameters that reproduce a legacy `FighterAttributes` exactly.
 *
 * The bridge for the strangler: engine tests build fighters from
 * `FighterAttributes` alone, and until every reader has moved to
 * `FighterParams` the two must describe the same fighter. Every field without
 * an attributes counterpart is set to the value that makes the new code behave
 * like the old: walk acceleration totals 2 × traction and run acceleration
 * 3 × traction (the legacy `WALK_ACCEL_FACTOR` / `RUN_ACCEL_FACTOR`), no air
 * friction, no full-hop initial phase, a 4-frame landing either way, and jump
 * heights recovered from the legacy launch velocities by v² / 2g.
 */
export function paramsFromAttributes(a: FighterAttributes, def?: Pick<FighterDef, "moves">): FighterParams {
  const height = (v: number): number => (a.gravity > 0 ? div(mul(v, v), 2 * a.gravity) : 0);
  const lag = (slot: "nair" | "fair" | "bair" | "uair" | "dair"): number => def?.moves[slot]?.landingLag ?? 0;
  return {
    walk_speed_max: a.walkSpeed,
    walk_accel_mul: a.traction,
    walk_accel_add: a.traction,
    ground_brake: a.traction,
    dash_speed: a.initialDashSpeed,
    run_accel_mul: 2 * a.traction,
    run_accel_add: a.traction,
    run_speed_max: a.runSpeed,
    jump_squat_frame: a.jumpSquatFrames,
    jump_initial_y: 0,
    jump_y: height(a.fullHopVelocity),
    mini_jump_y: height(a.shortHopVelocity),
    jump_aerial_y: height(a.airJumpVelocity),
    jump_count_max: a.jumps,
    air_accel_x_mul: a.airAccelAdditional,
    air_accel_x_add: a.airAccelBase,
    air_speed_x_stable: a.airSpeed,
    air_brake_x: 0,
    air_accel_y: a.gravity,
    air_speed_y_stable: a.fallSpeed,
    dive_speed_y: a.fastFallSpeed,
    damage_fly_top_air_accel_y: a.gravity,
    damage_fly_top_speed_y_stable: 7373, // fx(1.8), every roster fighter's DamageFlyTopFallSpeed
    weight: a.weight,
    landing_attack_air_frame_n: lag("nair"),
    landing_attack_air_frame_f: lag("fair"),
    landing_attack_air_frame_b: lag("bair"),
    landing_attack_air_frame_hi: lag("uair"),
    landing_attack_air_frame_lw: lag("dair"),
    landing_frame_light: 4,
    landing_frame: 4,
    landing_heavy_frame: 1_000_000,
    shield_radius: 10 * ONE,
    scale: ONE,
  };
}

const adapted = new WeakMap<FighterDef, FighterParams>();

/**
 * The parameters the engine reads for a fighter: its own `params` when the
 * roster supplies them, otherwise the legacy adapter. Cached per definition,
 * which is immutable roster data.
 */
export function fighterParams(def: FighterDef): FighterParams {
  if (def.params !== undefined) return def.params;
  let p = adapted.get(def);
  if (p === undefined) {
    p = paramsFromAttributes(def.attributes, def);
    adapted.set(def, p);
  }
  return p;
}
```

In `src/engine/types.ts`, replace:

```ts
 * marked "frames" is a whole number of 60Hz simulation frames.
 */
```

with:

```ts
 * marked "frames" is a whole number of 60Hz simulation frames.
 */

import type { FighterParams } from "./params";
```

In `src/engine/types.ts`, replace:

```ts
  readonly attributes: FighterAttributes;
  readonly moves: Readonly<Partial<Record<MoveSlot, MoveDef>>>;
```

with:

```ts
  readonly attributes: FighterAttributes;
  /**
   * The fighter's `fighter_param.prc` numbers (see `params.ts`). Optional while
   * the engine migrates off `attributes`: a definition without it — every
   * engine test fixture — is read through `paramsFromAttributes`.
   */
  readonly params?: FighterParams;
  readonly moves: Readonly<Partial<Record<MoveSlot, MoveDef>>>;
```

Create `src/fighters/params.ts`:

```ts
/**
 * The eight fighters' `fighter_param.prc` numbers (Plan 2, Task 1).
 *
 * Every value is rubendal's SSBU-Calculator data —
 * https://github.com/rubendal/SSBU-Calculator/blob/233590e94bc4bd8813f2d1a2af45c8c46648f351/Data/<fighter>/data.json,
 * `Params` block — transcribed field for field (the mapping from the
 * calculator's labels to prc names is documented on `FighterParams`). The
 * columns the research CSV also carries
 * (`research/rebuild-2026-10/ssbu_fighter_params.csv`) are pinned against it by
 * `params.test.ts`, so a typo here fails a test rather than a match.
 *
 * Kept apart from the per-fighter files so the whole table reads as one, the way
 * the game keeps it.
 */

import { fx } from "@/engine/fixed";
import type { FighterParams } from "@/engine/params";

export type RosterId = "mario" | "donkeyKong" | "link" | "samus" | "kirby" | "fox" | "pikachu" | "marth";

export const FIGHTER_PARAMS: Readonly<Record<RosterId, FighterParams>> = {
  mario: {
    walk_speed_max: fx(1.155),
    walk_accel_mul: fx(0.105),
    walk_accel_add: fx(0.105),
    ground_brake: fx(0.102),
    dash_speed: fx(1.936),
    run_accel_mul: fx(0.10978),
    run_accel_add: fx(0.044),
    run_speed_max: fx(1.76),
    jump_squat_frame: 3,
    jump_initial_y: fx(19.9815),
    jump_y: fx(36.33),
    mini_jump_y: fx(17.54),
    jump_aerial_y: fx(36.33),
    jump_count_max: 2,
    air_accel_x_mul: fx(0.07),
    air_accel_x_add: fx(0.01),
    air_speed_x_stable: fx(1.208),
    air_brake_x: fx(0.015),
    air_accel_y: fx(0.087),
    air_speed_y_stable: fx(1.5),
    dive_speed_y: fx(2.4),
    damage_fly_top_air_accel_y: fx(0.074928),
    damage_fly_top_speed_y_stable: fx(1.8),
    weight: 98,
    landing_attack_air_frame_n: 6,
    landing_attack_air_frame_f: 17,
    landing_attack_air_frame_b: 6,
    landing_attack_air_frame_hi: 6,
    landing_attack_air_frame_lw: 15,
    landing_frame_light: 1,
    landing_frame: 3,
    landing_heavy_frame: 4,
    shield_radius: fx(9.7),
    scale: fx(1),
  },
  donkeyKong: {
    walk_speed_max: fx(1.365),
    walk_accel_mul: fx(0.105),
    walk_accel_add: fx(0.105),
    ground_brake: fx(0.123),
    dash_speed: fx(2.09),
    run_accel_mul: fx(0.07337),
    run_accel_add: fx(0.044),
    run_speed_max: fx(1.873),
    jump_squat_frame: 3,
    jump_initial_y: fx(18.7),
    jump_y: fx(34),
    mini_jump_y: fx(17.3),
    jump_aerial_y: fx(35.5),
    jump_count_max: 2,
    air_accel_x_mul: fx(0.05),
    air_accel_x_add: fx(0.01),
    air_speed_x_stable: fx(1.208),
    air_brake_x: fx(0.015),
    air_accel_y: fx(0.085),
    air_speed_y_stable: fx(1.63),
    dive_speed_y: fx(2.608),
    damage_fly_top_air_accel_y: fx(0.084672),
    damage_fly_top_speed_y_stable: fx(1.8),
    weight: 127,
    landing_attack_air_frame_n: 10,
    landing_attack_air_frame_f: 17,
    landing_attack_air_frame_b: 11,
    landing_attack_air_frame_hi: 15,
    landing_attack_air_frame_lw: 14,
    landing_frame_light: 1,
    landing_frame: 4,
    landing_heavy_frame: 4,
    shield_radius: fx(15.4),
    scale: fx(1),
  },
  link: {
    walk_speed_max: fx(1.247),
    walk_accel_mul: fx(0.21),
    walk_accel_add: fx(0.105),
    ground_brake: fx(0.113),
    dash_speed: fx(1.98),
    run_accel_mul: fx(0.13167),
    run_accel_add: fx(0.044),
    run_speed_max: fx(1.534),
    jump_squat_frame: 3,
    jump_initial_y: fx(15.29),
    jump_y: fx(27.8),
    mini_jump_y: fx(13.38),
    jump_aerial_y: fx(29),
    jump_count_max: 2,
    air_accel_x_mul: fx(0.04),
    air_accel_x_add: fx(0.01),
    air_speed_x_stable: fx(0.924),
    air_brake_x: fx(0.0038),
    air_accel_y: fx(0.096),
    air_speed_y_stable: fx(1.6),
    dive_speed_y: fx(3.04),
    damage_fly_top_air_accel_y: fx(0.076944),
    damage_fly_top_speed_y_stable: fx(1.8),
    weight: 104,
    landing_attack_air_frame_n: 6,
    landing_attack_air_frame_f: 11,
    landing_attack_air_frame_b: 6,
    landing_attack_air_frame_hi: 14,
    landing_attack_air_frame_lw: 19,
    landing_frame_light: 1,
    landing_frame: 4,
    landing_heavy_frame: 4,
    shield_radius: fx(10.9),
    scale: fx(1),
  },
  samus: {
    walk_speed_max: fx(1.115),
    walk_accel_mul: fx(0.315),
    walk_accel_add: fx(0.105),
    ground_brake: fx(0.082),
    dash_speed: fx(1.87),
    run_accel_mul: fx(0.132),
    run_accel_add: fx(0.044),
    run_speed_max: fx(1.654),
    jump_squat_frame: 3,
    jump_initial_y: fx(20.35),
    jump_y: fx(37),
    mini_jump_y: fx(18),
    jump_aerial_y: fx(37),
    jump_count_max: 2,
    air_accel_x_mul: fx(0.05),
    air_accel_x_add: fx(0.04),
    air_speed_x_stable: fx(1.103),
    air_brake_x: fx(0.0075),
    air_accel_y: fx(0.075),
    air_speed_y_stable: fx(1.33),
    dive_speed_y: fx(2.128),
    damage_fly_top_air_accel_y: fx(0.078288),
    damage_fly_top_speed_y_stable: fx(1.8),
    weight: 108,
    landing_attack_air_frame_n: 9,
    landing_attack_air_frame_f: 14,
    landing_attack_air_frame_b: 14,
    landing_attack_air_frame_hi: 18,
    landing_attack_air_frame_lw: 12,
    landing_frame_light: 1,
    landing_frame: 3,
    landing_heavy_frame: 7,
    shield_radius: fx(12.5),
    scale: fx(0.96),
  },
  kirby: {
    walk_speed_max: fx(0.977),
    walk_accel_mul: fx(0.168),
    walk_accel_add: fx(0.105),
    ground_brake: fx(0.116),
    dash_speed: fx(1.9),
    run_accel_mul: fx(0.10494),
    run_accel_add: fx(0.044),
    run_speed_max: fx(1.727),
    jump_squat_frame: 3,
    jump_initial_y: fx(13.9535),
    jump_y: fx(25.37),
    mini_jump_y: fx(12.24),
    jump_aerial_y: fx(22),
    // Each of the five midair jumps' height: SmashWiki "Jump" (https://www.ssbwiki.com/Jump),
    // Super Smash Bros. Ultimate table, Kirby row, Air Jump column: "21.06378125, 18.528125,
    // 15.931125, 13.34569531, 10.82288281 for each air jump." (`jump_aerial_y` keeps the
    // calculator's AirJumpHeight, 22; the list is what the engine reads for Kirby.)
    jump_aerial_y_list: [fx(21.06378125), fx(18.528125), fx(15.931125), fx(13.34569531), fx(10.82288281)],
    jump_count_max: 6,
    air_accel_x_mul: fx(0.065),
    air_accel_x_add: fx(0.03),
    air_speed_x_stable: fx(0.84),
    air_brake_x: fx(0.015),
    air_accel_y: fx(0.064),
    air_speed_y_stable: fx(1.23),
    dive_speed_y: fx(1.968),
    damage_fly_top_air_accel_y: fx(0.068544),
    damage_fly_top_speed_y_stable: fx(1.8),
    weight: 79,
    landing_attack_air_frame_n: 6,
    landing_attack_air_frame_f: 8,
    landing_attack_air_frame_b: 10,
    landing_attack_air_frame_hi: 7,
    landing_attack_air_frame_lw: 16,
    landing_frame_light: 1,
    landing_frame: 3,
    landing_heavy_frame: 4,
    shield_radius: fx(9.5),
    scale: fx(0.96),
  },
  fox: {
    walk_speed_max: fx(1.523),
    walk_accel_mul: fx(0.21),
    walk_accel_add: fx(0.105),
    ground_brake: fx(0.115),
    dash_speed: fx(2.09),
    run_accel_mul: fx(0.12221),
    run_accel_add: fx(0.044),
    run_speed_max: fx(2.402),
    jump_squat_frame: 3,
    jump_initial_y: fx(19.25),
    jump_y: fx(35),
    mini_jump_y: fx(16.4),
    jump_aerial_y: fx(37),
    jump_count_max: 2,
    air_accel_x_mul: fx(0.08),
    air_accel_x_add: fx(0.01),
    air_speed_x_stable: fx(1.11),
    air_brake_x: fx(0.015),
    air_accel_y: fx(0.23),
    air_speed_y_stable: fx(2.1),
    dive_speed_y: fx(3.36),
    damage_fly_top_air_accel_y: fx(0.067872),
    damage_fly_top_speed_y_stable: fx(1.8),
    weight: 77,
    landing_attack_air_frame_n: 7,
    landing_attack_air_frame_f: 18,
    landing_attack_air_frame_b: 9,
    landing_attack_air_frame_hi: 13,
    landing_attack_air_frame_lw: 17,
    landing_frame_light: 1,
    landing_frame: 3,
    landing_heavy_frame: 4,
    shield_radius: fx(9.2),
    scale: fx(1.08),
  },
  pikachu: {
    walk_speed_max: fx(1.302),
    walk_accel_mul: fx(0.158),
    walk_accel_add: fx(0.105),
    ground_brake: fx(0.132),
    dash_speed: fx(1.98),
    run_accel_mul: fx(0.132),
    run_accel_add: fx(0.044),
    run_speed_max: fx(2.039),
    jump_squat_frame: 3,
    jump_initial_y: fx(19.525),
    jump_y: fx(35.5),
    mini_jump_y: fx(17.12),
    jump_aerial_y: fx(35.5),
    jump_count_max: 2,
    air_accel_x_mul: fx(0.09),
    air_accel_x_add: fx(0.01),
    air_speed_x_stable: fx(0.957),
    air_brake_x: fx(0.0075),
    air_accel_y: fx(0.095),
    air_speed_y_stable: fx(1.55),
    dive_speed_y: fx(2.48),
    damage_fly_top_air_accel_y: fx(0.068544),
    damage_fly_top_speed_y_stable: fx(1.8),
    weight: 79,
    landing_attack_air_frame_n: 9,
    landing_attack_air_frame_f: 12,
    landing_attack_air_frame_b: 18,
    landing_attack_air_frame_hi: 14,
    landing_attack_air_frame_lw: 22,
    landing_frame_light: 1,
    landing_frame: 3,
    landing_heavy_frame: 4,
    shield_radius: fx(9.1),
    scale: fx(0.96),
  },
  marth: {
    walk_speed_max: fx(1.575),
    walk_accel_mul: fx(0.189),
    walk_accel_add: fx(0),
    ground_brake: fx(0.114),
    dash_speed: fx(2.255),
    run_accel_mul: fx(0.0902),
    run_accel_add: fx(0.044),
    run_speed_max: fx(1.964),
    jump_squat_frame: 3,
    jump_initial_y: fx(18.513),
    jump_y: fx(33.66),
    mini_jump_y: fx(16.26),
    jump_aerial_y: fx(33.66),
    jump_count_max: 2,
    air_accel_x_mul: fx(0.07),
    air_accel_x_add: fx(0.01),
    air_speed_x_stable: fx(1.071),
    air_brake_x: fx(0.00375),
    air_accel_y: fx(0.075),
    air_speed_y_stable: fx(1.58),
    dive_speed_y: fx(2.528),
    damage_fly_top_air_accel_y: fx(0.07224),
    damage_fly_top_speed_y_stable: fx(1.8),
    weight: 90,
    landing_attack_air_frame_n: 7,
    landing_attack_air_frame_f: 10,
    landing_attack_air_frame_b: 10,
    landing_attack_air_frame_hi: 8,
    landing_attack_air_frame_lw: 14,
    landing_frame_light: 1,
    landing_frame: 3,
    landing_heavy_frame: 4,
    shield_radius: fx(11.9),
    scale: fx(0.95),
  },
};
```

In `src/fighters/mario.ts`, replace:

```ts
import type { FighterDef } from "@/engine/types";
```

with:

```ts
import type { FighterDef } from "@/engine/types";
import { FIGHTER_PARAMS } from "./params";
```

In `src/fighters/mario.ts`, replace:

```ts

  moves: {
```

with:

```ts

  params: FIGHTER_PARAMS.mario,

  moves: {
```

In `src/fighters/donkeyKong.ts`, replace:

```ts
import type { FighterDef } from "@/engine/types";
```

with:

```ts
import type { FighterDef } from "@/engine/types";
import { FIGHTER_PARAMS } from "./params";
```

In `src/fighters/donkeyKong.ts`, replace:

```ts

  moves: {
```

with:

```ts

  params: FIGHTER_PARAMS.donkeyKong,

  moves: {
```

In `src/fighters/link.ts`, replace:

```ts
import type { FighterDef } from "@/engine/types";
```

with:

```ts
import type { FighterDef } from "@/engine/types";
import { FIGHTER_PARAMS } from "./params";
```

In `src/fighters/link.ts`, replace:

```ts

  moves: {
```

with:

```ts

  params: FIGHTER_PARAMS.link,

  moves: {
```

In `src/fighters/samus.ts`, replace:

```ts
import type { FighterDef } from "@/engine/types";
```

with:

```ts
import type { FighterDef } from "@/engine/types";
import { FIGHTER_PARAMS } from "./params";
```

In `src/fighters/samus.ts`, replace:

```ts

  moves: {
```

with:

```ts

  params: FIGHTER_PARAMS.samus,

  moves: {
```

In `src/fighters/kirby.ts`, replace:

```ts
import type { FighterDef } from "@/engine/types";
```

with:

```ts
import type { FighterDef } from "@/engine/types";
import { FIGHTER_PARAMS } from "./params";
```

In `src/fighters/kirby.ts`, replace:

```ts

  moves: {
```

with:

```ts

  params: FIGHTER_PARAMS.kirby,

  moves: {
```

In `src/fighters/fox.ts`, replace:

```ts
import type { FighterDef } from "@/engine/types";
```

with:

```ts
import type { FighterDef } from "@/engine/types";
import { FIGHTER_PARAMS } from "./params";
```

In `src/fighters/fox.ts`, replace:

```ts

  moves: {
```

with:

```ts

  params: FIGHTER_PARAMS.fox,

  moves: {
```

In `src/fighters/pikachu.ts`, replace:

```ts
import type { FighterDef } from "@/engine/types";
```

with:

```ts
import type { FighterDef } from "@/engine/types";
import { FIGHTER_PARAMS } from "./params";
```

In `src/fighters/pikachu.ts`, replace:

```ts

  moves: {
```

with:

```ts

  params: FIGHTER_PARAMS.pikachu,

  moves: {
```

In `src/fighters/marth.ts`, replace:

```ts
import type { FighterDef } from "@/engine/types";
```

with:

```ts
import type { FighterDef } from "@/engine/types";
import { FIGHTER_PARAMS } from "./params";
```

In `src/fighters/marth.ts`, replace:

```ts

  moves: {
```

with:

```ts

  params: FIGHTER_PARAMS.marth,

  moves: {
```

In `src/fighters/link.ts`, replace:

```ts
    walkSpeed: fx(1.237),
```

with:

```ts
    walkSpeed: fx(1.247),
```

- [ ] **Step 4: Run it again**

Run: `pnpm vitest run src/engine/params.test.ts src/fighters/params.test.ts`
Expected: PASS.

- [ ] **Step 5: Regenerate the golden trace, on purpose**

Run: `pnpm vitest run src/game/golden.test.ts`
Expected: FAIL — Link now walks at 1.247 (CSV + calculator), so the Link–Samus match diverges. This task changes behaviour by design.

Run: `UPDATE_GOLDEN=1 pnpm vitest run src/game/golden.test.ts && pnpm vitest run src/game/golden.test.ts`
Expected: the second run passes all 5 tests, including "exercises combat, not an idle screen".

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0. `pnpm lint` reports no errors and no warning in a file this task touched; any warnings it printed before this plan started (measure once, with Plan 1 merged, before Task 0) are unchanged.

- [ ] **Step 7: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/src/engine/params.test.ts \
  super-smash/src/engine/params.ts \
  super-smash/src/engine/types.ts \
  super-smash/src/fighters/donkeyKong.ts \
  super-smash/src/fighters/fox.ts \
  super-smash/src/fighters/kirby.ts \
  super-smash/src/fighters/link.ts \
  super-smash/src/fighters/mario.ts \
  super-smash/src/fighters/marth.ts \
  super-smash/src/fighters/params.test.ts \
  super-smash/src/fighters/params.ts \
  super-smash/src/fighters/pikachu.ts \
  super-smash/src/fighters/samus.ts \
  super-smash/src/game/__golden__/engine-trace.json
git commit -m "super-smash: FighterParams with fighter_param.prc names, sourced and pinned" -m "Every value is rubendal SSBU-Calculator (gh-pages 233590e9), pinned column by column against research/rebuild-2026-10/ssbu_fighter_params.csv. paramsFromAttributes keeps attribute-only test fixtures working. Link's walk speed was 1.237; the published value is 1.247. Golden trace regenerated for that." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: KineticState: the energies, in state, cloned and hashed

Add the KineticModule's state — five energies plus two counters later tasks need — to `FighterState`, clone it, and hash it. Nothing drives the energies yet. This is also where Review Focus #1 gets its tests: a reflective walk that mutates every leaf of a fighter and demands the hash notice, and one that demands `cloneState` copy every key and alias no object. Both catch fields added later, not only the ones listed today.

**Files:**
- Create: `super-smash/src/engine/kinetic.test.ts`
- Create: `super-smash/src/engine/kinetic.ts`
- Modify: `super-smash/src/ai/behaviours.test.ts` — `FighterState`
- Modify: `super-smash/src/ai/cpu.test.ts` — `FighterState`
- Modify: `super-smash/src/engine/hash.test.ts` — `"notices a change to every projectile field"`, imports
- Modify: `super-smash/src/engine/hash.ts` — imports
- Modify: `super-smash/src/engine/physics.test.ts` — imports
- Modify: `super-smash/src/engine/projectile.test.ts` — imports
- Modify: `super-smash/src/engine/simulate.test.ts` — `"copies the rules and the Smash Ball rather than aliasing them"`
- Modify: `super-smash/src/engine/simulate.ts` — imports
- Modify: `super-smash/src/engine/states.test.ts` — imports
- Modify: `super-smash/src/engine/types.ts` — imports
- Modify: `super-smash/src/render/testFixtures.ts` — imports

**Interfaces:** Produces (`src/engine/kinetic.ts`):
```ts
export const FIGHTER_KINETIC_ENERGY_ID_MOTION = 0, _GRAVITY = 1, _CONTROL = 2, _STOP = 3, _DAMAGE = 4;
export interface KineticState { controlX: number; stopX: number; gravityY: number; motionX: number; motionY: number; damageX: number; damageY: number; fallFrames: number; jumpInitial: number }
export function emptyKinetic(): KineticState;
export function cloneKinetic(k: KineticState): KineticState;
export function kineticSumX(f: Pick<FighterState, "kinetic">): number;
export function kineticSumY(f: Pick<FighterState, "kinetic">): number;
export function kineticSum(f: FighterState): void;          // vx = ΣX, vy = ΣY
export type HorizontalCarrier = "control" | "stop";
export function kineticAdopt(f: FighterState, carrier?: HorizontalCarrier): void;
export function kineticClear(f: FighterState): void;
```
`FighterState.kinetic: KineticState`; `mixKinetic(h, k)` in `hash.ts`.

- [ ] **Step 1: Write the failing test**

Create `src/engine/kinetic.test.ts`:

```ts
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { fx } from "./fixed";
import {
  emptyKinetic,
  kineticAdopt,
  kineticClear,
  kineticSum,
  kineticSumX,
  kineticSumY,
} from "./kinetic";
import type { KineticState } from "./kinetic";
import type { FighterState } from "./types";

/** Only the fields the KineticModule touches; the rest of a fighter is irrelevant here. */
function body(k: Partial<KineticState> = {}, over: Partial<FighterState> = {}): FighterState {
  return {
    vx: 0,
    vy: 0,
    launchSpeed: 0,
    kinetic: { ...emptyKinetic(), ...k },
    ...over,
  } as FighterState;
}

describe("energy sum", () => {
  it("adds CONTROL, STOP, MOTION and DAMAGE horizontally", () => {
    const f = body({ controlX: fx(1), stopX: fx(0.5), motionX: fx(2), damageX: -fx(0.25) });
    expect(kineticSumX(f)).toBe(fx(1) + fx(0.5) + fx(2) - fx(0.25));
  });

  it("adds GRAVITY, MOTION and DAMAGE vertically", () => {
    const f = body({ gravityY: -fx(1), motionY: fx(3), damageY: fx(0.5) });
    expect(kineticSumY(f)).toBe(-fx(1) + fx(3) + fx(0.5));
  });

  it("writes the sum back to vx/vy", () => {
    const f = body({ controlX: fx(1), gravityY: -fx(2) });
    kineticSum(f);
    expect([f.vx, f.vy]).toEqual([fx(1), -fx(2)]);
  });
});

describe("adopting a direct write", () => {
  it("is the identity when vx/vy already equal the sum", () => {
    const f = body({ controlX: fx(1), gravityY: fx(2) }, { vx: fx(1), vy: fx(2) });
    kineticAdopt(f);
    expect(f.kinetic).toEqual({ ...emptyKinetic(), controlX: fx(1), gravityY: fx(2) });
  });

  it("puts a horizontal write on the carrier it is told to", () => {
    const toControl = body({}, { vx: fx(3) });
    kineticAdopt(toControl, "control");
    expect(toControl.kinetic.controlX).toBe(fx(3));
    const toStop = body({}, { vx: fx(3) });
    kineticAdopt(toStop, "stop");
    expect(toStop.kinetic.stopX).toBe(fx(3));
  });

  it("always restores vx/vy == sum, whatever the energies held", () => {
    const q12 = fc.integer({ min: -fx(50), max: fx(50) });
    fc.assert(
      fc.property(q12, q12, q12, q12, q12, q12, q12, q12, q12, fc.boolean(), (cx, sx, gy, mx, my, dx, dy, vx, vy, stop) => {
        const f = body(
          { controlX: cx, stopX: sx, gravityY: gy, motionX: mx, motionY: my, damageX: dx, damageY: dy },
          { vx, vy },
        );
        kineticAdopt(f, stop ? "stop" : "control");
        return kineticSumX(f) === vx && kineticSumY(f) === vy && f.kinetic.motionX === mx && f.kinetic.damageY === dy;
      }),
    );
  });
});

describe("clearing", () => {
  it("zeroes every energy, the launch and the velocity", () => {
    const f = body(
      { controlX: 1, stopX: 2, gravityY: 3, motionX: 4, motionY: 5, damageX: 6, damageY: 7, fallFrames: 8, jumpInitial: 2 },
      { vx: 9, vy: 9, launchSpeed: 9 },
    );
    kineticClear(f);
    expect(f.kinetic).toEqual(emptyKinetic());
    expect([f.vx, f.vy, f.launchSpeed]).toEqual([0, 0, 0]);
  });
});
```

In `src/engine/hash.test.ts`, replace:

```ts
      ["projectiles", (s) => s.projectiles.push(projectile())],
    ];
```

with:

```ts
      ["fighter.kinetic.controlX", (s) => (s.fighters[0].kinetic.controlX += 1)],
      ["fighter.kinetic.stopX", (s) => (s.fighters[0].kinetic.stopX += 1)],
      ["fighter.kinetic.gravityY", (s) => (s.fighters[0].kinetic.gravityY += 1)],
      ["fighter.kinetic.motionX", (s) => (s.fighters[0].kinetic.motionX += 1)],
      ["fighter.kinetic.motionY", (s) => (s.fighters[0].kinetic.motionY += 1)],
      ["fighter.kinetic.damageX", (s) => (s.fighters[0].kinetic.damageX += 1)],
      ["fighter.kinetic.damageY", (s) => (s.fighters[0].kinetic.damageY += 1)],
      ["fighter.kinetic.fallFrames", (s) => (s.fighters[0].kinetic.fallFrames += 1)],
      ["fighter.kinetic.jumpInitial", (s) => (s.fighters[0].kinetic.jumpInitial += 1)],
      ["projectiles", (s) => s.projectiles.push(projectile())],
    ];
```

In `src/engine/hash.test.ts`, replace:

```ts
  it("notices a change to every projectile field", () => {
```

with:

```ts
  /**
   * Review Focus #1 (rollback desync from a field the hash cannot see). The
   * list above is written by hand, so a field added later and forgotten there
   * would pass it. This walks every leaf of a real fighter instead — including
   * ones that do not exist yet — and requires each one to move the hash. Every
   * nullable field is given a value first, so the leaves behind it are walked
   * too; a new nullable field left null here fails the walk by name.
   */
  it("notices a mutation of every leaf of FighterState, found by walking it", () => {
    const FULL: Partial<FighterState> = {
      move: "jab1",
      ledge: { platform: 0, side: 1 },
      bufferedAction: { kind: "jump", frame: 3 },
    };
    const leaves: string[][] = [];
    const walk = (v: unknown, path: string[]): void => {
      if (v === null) throw new Error(`fighter.${path.join(".")} is null: give it a value in FULL`);
      if (Array.isArray(v)) return; // arrays have explicit cases above
      if (typeof v === "object") {
        for (const k of Object.keys(v as object)) walk((v as Record<string, unknown>)[k], [...path, k]);
        return;
      }
      leaves.push(path);
    };
    walk(fighter(FULL), []);
    expect(leaves.length).toBeGreaterThan(40);
    for (const path of leaves) {
      const s = state({ fighters: [fighter({ ...FULL, port: 0 }), fighter({ port: 1, x: fx(20) })] });
      const before = hashState(s);
      let target = s.fighters[0] as unknown as Record<string, unknown>;
      for (const k of path.slice(0, -1)) target = target[k] as Record<string, unknown>;
      const key = path[path.length - 1];
      const v = target[key];
      target[key] = typeof v === "number" ? v + 1 : typeof v === "boolean" ? !v : `${String(v)}x`;
      expect(hashState(s), `hash ignored fighter.${path.join(".")}`).not.toBe(before);
    }
  });

  it("notices a change to every projectile field", () => {
```

In `src/engine/simulate.test.ts`, replace:

```ts
  it("copies the rules and the Smash Ball rather than aliasing them", () => {
```

with:

```ts
  /**
   * Review Focus #1 (rollback desync from a field `cloneState` forgets). A
   * forgotten field would be *missing* from the copy; a shallow-copied object
   * would be *shared* with it. Both are found by walking the original.
   */
  it("copies every field of every fighter, and shares no object with the original", () => {
    const s = newState();
    const f = s.fighters[0];
    f.ledge = { platform: 0, side: 1 };
    f.bufferedAction = { kind: "jump", frame: 3 };
    f.kinetic.damageX = 7;
    const c = cloneState(s);
    const check = (a: unknown, b: unknown, path: string): void => {
      if (a === null || typeof a !== "object") {
        expect(b, path).toBe(a);
        return;
      }
      expect(b, `${path} is aliased`).not.toBe(a);
      expect(Object.keys(b as object).sort(), `${path} keys`).toEqual(Object.keys(a as object).sort());
      for (const k of Object.keys(a as object)) {
        check((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`);
      }
    };
    check(s.fighters, c.fighters, "fighters");
  });

  it("copies the rules and the Smash Ball rather than aliasing them", () => {
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/engine/hash.test.ts src/engine/kinetic.test.ts src/engine/simulate.test.ts`
Expected: FAIL — `kinetic.test.ts`: `Failed to resolve import "./kinetic"`; `hash.test.ts` "notices a change to every simulation-relevant field" throws `TypeError: Cannot read properties of undefined (reading 'controlX')` and `simulate.test.ts` "copies every field of every fighter…" throws `TypeError: Cannot set properties of undefined (setting 'damageX')` — the fixtures have no `kinetic` yet. (2 failed, 57 passed in the two existing files.) The leaf-walk test already passes: it exists to catch fields added later.

- [ ] **Step 3: Implement**

**Fixture check (Plan 1 may have added literals).** Run `grep -rln "bufferedAction: null" src`. Before Plan 2 it lists exactly `src/render/testFixtures.ts`, `src/ai/cpu.test.ts`, `src/ai/behaviours.test.ts`, `src/engine/hash.test.ts`, `src/engine/projectile.test.ts`, `src/engine/states.test.ts`, `src/engine/physics.test.ts` (plus `src/engine/simulate.ts`, handled below). If Plan 1 added any other file to that list, give it the same two edits as the seven below: the `emptyKinetic` import and `kinetic: emptyKinetic(),` after `bufferedAction: null,`.

Create `src/engine/kinetic.ts`:

```ts
/**
 * KineticModule — a fighter's velocity as a sum of named energies.
 *
 * Ultimate does not keep one velocity per fighter. Its `KineticModule` keeps
 * several *energies*, each with its own rules, and moves the fighter by their
 * sum every frame (skyline-smash `FIGHTER_KINETIC_ENERGY_ID_*`). Which energies
 * run, and how, is chosen by the fighter's status through a *kinetic type*.
 * That separation is the mechanic: a launch (DAMAGE) decays at its own 0.051
 * per frame while gravity (GRAVITY) and the player's drift (CONTROL) act
 * beside it, instead of all three fighting over one `vx`.
 *
 * `FighterState.vx` / `vy` remain, as the **sum**, for every reader that only
 * wants to know how fast a fighter is going (renderer, CPU, blast-zone test).
 * Every energy mutator here ends by writing that sum back, so the two never
 * disagree. Code that still writes `vx`/`vy` directly is *adopted*: the
 * difference is folded into the carrier energy (see `kineticAdopt`) — that is
 * the strangler seam, and Task 4 closes it.
 */

import type { FighterState } from "./types";

/** skyline-smash `lua_const.rs`. The replica uses the five below. */
export const FIGHTER_KINETIC_ENERGY_ID_MOTION = 0;
export const FIGHTER_KINETIC_ENERGY_ID_GRAVITY = 1;
export const FIGHTER_KINETIC_ENERGY_ID_CONTROL = 2;
export const FIGHTER_KINETIC_ENERGY_ID_STOP = 3;
export const FIGHTER_KINETIC_ENERGY_ID_DAMAGE = 4;

export interface KineticState {
  /** CONTROL — stick-driven horizontal speed: walk, dash, run, air drift. Q12/frame. */
  controlX: number;
  /** STOP — horizontal speed with no driver, braking toward zero. Q12/frame. */
  stopX: number;
  /** GRAVITY — vertical speed from jumps and gravity, clamped at fall speed. Q12/frame. */
  gravityY: number;
  /** MOTION — a move's scripted velocity while it holds. Q12/frame. */
  motionX: number;
  motionY: number;
  /** DAMAGE — the launch vector. Its magnitude is `FighterState.launchSpeed`. Q12/frame. */
  damageX: number;
  damageY: number;
  /** Consecutive airborne frames at or past `air_speed_y_stable`; decides a heavy landing (Task 24). */
  fallFrames: number;
  /** Full-hop initial rise (Task 19): 0 none; 1–4 the rise frame about to play; 5 hand over to gravity. */
  jumpInitial: number;
}

export function emptyKinetic(): KineticState {
  return {
    controlX: 0,
    stopX: 0,
    gravityY: 0,
    motionX: 0,
    motionY: 0,
    damageX: 0,
    damageY: 0,
    fallFrames: 0,
    jumpInitial: 0,
  };
}

export function cloneKinetic(k: KineticState): KineticState {
  return {
    controlX: k.controlX,
    stopX: k.stopX,
    gravityY: k.gravityY,
    motionX: k.motionX,
    motionY: k.motionY,
    damageX: k.damageX,
    damageY: k.damageY,
    fallFrames: k.fallFrames,
    jumpInitial: k.jumpInitial,
  };
}

export function kineticSumX(f: Pick<FighterState, "kinetic">): number {
  const k = f.kinetic;
  return k.controlX + k.stopX + k.motionX + k.damageX;
}

export function kineticSumY(f: Pick<FighterState, "kinetic">): number {
  const k = f.kinetic;
  return k.gravityY + k.motionY + k.damageY;
}

/** Write the energies' sum back to `vx`/`vy`. Every mutator ends here. */
export function kineticSum(f: FighterState): void {
  f.vx = kineticSumX(f);
  f.vy = kineticSumY(f);
}

/** Which horizontal energy carries speed a status does not drive itself. */
export type HorizontalCarrier = "control" | "stop";

/**
 * Fold a direct write to `vx`/`vy` into the energies.
 *
 * The horizontal difference goes to `carrier`, the vertical one to GRAVITY. A
 * fighter whose `vx`/`vy` already equal the sum is untouched, so calling this
 * defensively costs nothing.
 */
export function kineticAdopt(f: FighterState, carrier: HorizontalCarrier = "control"): void {
  const dx = f.vx - kineticSumX(f);
  const dy = f.vy - kineticSumY(f);
  if (dx !== 0) {
    if (carrier === "control") f.kinetic.controlX += dx;
    else f.kinetic.stopX += dx;
  }
  if (dy !== 0) f.kinetic.gravityY += dy;
}

/** Every energy to zero, the launch included: a ledge, a respawn, a KO. */
export function kineticClear(f: FighterState): void {
  const k = f.kinetic;
  k.controlX = 0;
  k.stopX = 0;
  k.gravityY = 0;
  k.motionX = 0;
  k.motionY = 0;
  k.damageX = 0;
  k.damageY = 0;
  k.fallFrames = 0;
  k.jumpInitial = 0;
  f.launchSpeed = 0;
  kineticSum(f);
}
```

In `src/engine/types.ts`, replace:

```ts
import type { FighterParams } from "./params";
```

with:

```ts
import type { KineticState } from "./kinetic";
import type { FighterParams } from "./params";
```

In `src/engine/types.ts`, replace:

```ts
  /** Buffered action awaiting a legal frame, and when it was queued. */
  bufferedAction: BufferedAction | null;
}
```

with:

```ts
  /** Buffered action awaiting a legal frame, and when it was queued. */
  bufferedAction: BufferedAction | null;
  /**
   * KineticModule energies (see `kinetic.ts`). `vx`/`vy` above are their sum,
   * kept for readers that only want a velocity.
   */
  kinetic: KineticState;
}
```

In `src/engine/simulate.ts`, replace:

```ts
          : ({ kind: f.bufferedAction.kind, frame: f.bufferedAction.frame } as FighterState["bufferedAction"]),
    };
```

with:

```ts
          : ({ kind: f.bufferedAction.kind, frame: f.bufferedAction.frame } as FighterState["bufferedAction"]),
      kinetic: cloneKinetic(f.kinetic),
    };
```

In `src/engine/simulate.ts`, replace:

```ts
      bufferedAction: null,
    };
  });
```

with:

```ts
      bufferedAction: null,
      kinetic: emptyKinetic(),
    };
  });
```

In `src/engine/simulate.ts`, replace:

```ts
import { emptyEvents } from "./types";
```

with:

```ts
import { cloneKinetic, emptyKinetic } from "./kinetic";
import { emptyEvents } from "./types";
```

In `src/engine/hash.ts`, replace:

```ts
import type {
  GameState,
  FighterState,
```

with:

```ts
import type { KineticState } from "./kinetic";
import type {
  GameState,
  FighterState,
```

In `src/engine/hash.ts`, replace:

```ts
    x = mixString(x, f.bufferedAction.kind);
    x = mixInt(x, f.bufferedAction.frame);
  }
  return x;
}
```

with:

```ts
    x = mixString(x, f.bufferedAction.kind);
    x = mixInt(x, f.bufferedAction.frame);
  }
  return mixKinetic(x, f.kinetic);
}

/** The KineticModule energies, in declaration order. */
export function mixKinetic(h: number, k: KineticState): number {
  let x = mixInt(h, k.controlX);
  x = mixInt(x, k.stopX);
  x = mixInt(x, k.gravityY);
  x = mixInt(x, k.motionX);
  x = mixInt(x, k.motionY);
  x = mixInt(x, k.damageX);
  x = mixInt(x, k.damageY);
  x = mixInt(x, k.fallFrames);
  x = mixInt(x, k.jumpInitial);
  return x;
}
```

In `src/render/testFixtures.ts`, replace:

```ts
import { emptyEvents } from "@/engine/types";
```

with:

```ts
import { emptyEvents } from "@/engine/types";
import { emptyKinetic } from "@/engine/kinetic";
```

In `src/ai/cpu.test.ts`, replace:

```ts
import { Btn, held, type FighterState, type GameState } from "@/engine/types";
```

with:

```ts
import { Btn, held, type FighterState, type GameState } from "@/engine/types";
import { emptyKinetic } from "@/engine/kinetic";
```

In `src/ai/behaviours.test.ts`, replace:

```ts
import { Btn, held, type FighterState, type GameState, type StageDef } from "@/engine/types";
```

with:

```ts
import { Btn, held, type FighterState, type GameState, type StageDef } from "@/engine/types";
import { emptyKinetic } from "@/engine/kinetic";
```

In `src/engine/hash.test.ts`, replace:

```ts
import { fx } from "./fixed";
```

with:

```ts
import { fx } from "./fixed";
import { emptyKinetic } from "./kinetic";
```

In `src/engine/physics.test.ts`, replace:

```ts
import { BALLOON_FALL_SPEED, LEDGE_GRAB_BACK_PENALTY, LEDGE_GRAB_RANGE_X } from "./constants";
```

with:

```ts
import { BALLOON_FALL_SPEED, LEDGE_GRAB_BACK_PENALTY, LEDGE_GRAB_RANGE_X } from "./constants";
import { emptyKinetic } from "./kinetic";
```

In `src/engine/projectile.test.ts`, replace:

```ts
import { Btn } from "./types";
```

with:

```ts
import { emptyKinetic } from "./kinetic";
import { Btn } from "./types";
```

In `src/engine/states.test.ts`, replace:

```ts
import { Btn } from "./types";
```

with:

```ts
import { emptyKinetic } from "./kinetic";
import { Btn } from "./types";
```

In `src/render/testFixtures.ts`, replace:

```ts
    bufferedAction: null,
    ...over,
```

with:

```ts
    bufferedAction: null,
    kinetic: emptyKinetic(),
    ...over,
```

In `src/ai/cpu.test.ts`, replace:

```ts
    bufferedAction: null,
    ...over,
```

with:

```ts
    bufferedAction: null,
    kinetic: emptyKinetic(),
    ...over,
```

In `src/ai/behaviours.test.ts`, replace:

```ts
    bufferedAction: null,
    ...over,
```

with:

```ts
    bufferedAction: null,
    kinetic: emptyKinetic(),
    ...over,
```

In `src/engine/hash.test.ts`, replace:

```ts
    bufferedAction: null,
    ...over,
```

with:

```ts
    bufferedAction: null,
    kinetic: emptyKinetic(),
    ...over,
```

In `src/engine/projectile.test.ts`, replace:

```ts
    bufferedAction: null,
    ...over,
```

with:

```ts
    bufferedAction: null,
    kinetic: emptyKinetic(),
    ...over,
```

In `src/engine/states.test.ts`, replace:

```ts
    bufferedAction: null,
    ...over,
```

with:

```ts
    bufferedAction: null,
    kinetic: emptyKinetic(),
    ...over,
```

In `src/engine/physics.test.ts`, replace:

```ts
    bufferedAction: null,
    ...over,
```

with:

```ts
    bufferedAction: null,
    kinetic: emptyKinetic(),
    ...over,
```

- [ ] **Step 4: Run it again**

Run: `pnpm vitest run src/engine/hash.test.ts src/engine/kinetic.test.ts src/engine/simulate.test.ts`
Expected: PASS.

- [ ] **Step 5: The golden trace must not move**

Run: `pnpm vitest run src/game/golden.test.ts`
Expected: PASS, unchanged. This task is a refactor: a divergence here is a bug in this task, not a fixture to regenerate.

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0. `pnpm lint` reports no errors and no warning in a file this task touched; any warnings it printed before this plan started (measure once, with Plan 1 merged, before Task 0) are unchanged.

- [ ] **Step 7: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/src/ai/behaviours.test.ts \
  super-smash/src/ai/cpu.test.ts \
  super-smash/src/engine/hash.test.ts \
  super-smash/src/engine/hash.ts \
  super-smash/src/engine/kinetic.test.ts \
  super-smash/src/engine/kinetic.ts \
  super-smash/src/engine/physics.test.ts \
  super-smash/src/engine/projectile.test.ts \
  super-smash/src/engine/simulate.test.ts \
  super-smash/src/engine/simulate.ts \
  super-smash/src/engine/states.test.ts \
  super-smash/src/engine/types.ts \
  super-smash/src/render/testFixtures.ts
git commit -m "super-smash: KineticState — the energies in state, cloned and hashed" -m "CONTROL, STOP, GRAVITY, MOTION, DAMAGE plus the fall/jump counters later tasks use. Nothing drives them yet. Reflective tests now require hashState and cloneState to cover every leaf of FighterState, including fields added later (Review Focus #1)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: KineticModule exec: CONTROL, STOP and GRAVITY drive every non-reeling frame

Drive the energies. Every non-reeling frame now runs `kineticExec(f, type, input)`: CONTROL carries walk/dash/run/drift, STOP carries speed nobody drives, GRAVITY the vertical. The legacy `applyMovement` switch becomes a table of kinetic types (`KINETIC_TYPE_OF_ACTION`). Exactly one of CONTROL/STOP holds horizontal speed at a time (`kineticTransfer`), which is what makes the split *numerically identical* to the single `vx` it replaces — a 2,000-run property test compares it with the legacy functions, and the golden trace must not move. Hitstun and momentum still write `vx`/`vy`; `kineticAdopt` folds those writes in until Tasks 17–18.

**Files:**
- Modify: `super-smash/src/engine/kinetic.test.ts` — imports
- Modify: `super-smash/src/engine/kinetic.ts` — imports
- Modify: `super-smash/src/engine/physics.ts` — `WALK_ACCEL_FACTOR`, imports
- Modify: `super-smash/src/engine/states.ts` — `applyMovement`, imports

**Interfaces:** Produces (`kinetic.ts`):
```ts
export type KineticType = "FALL" | "GROUND_STOP" | "WALK" | "DASH" | "RUN" | "MOTION" | "AIR_ESCAPE" | "NONE";
export const KINETIC_TYPE_OF_ACTION: Readonly<Record<ActionState, KineticType>>; // deleted in Task 28
export function carrierOf(type: KineticType): HorizontalCarrier;
export function kineticTransfer(f: FighterState, type: KineticType): void;
export const WALK_ACCEL_FACTOR = 2, RUN_ACCEL_FACTOR = 3;               // moved back to physics.ts in Task 28
export interface KineticInput { readonly stickX: number; readonly params: FighterParams; readonly holdVertical: boolean }
export function gravityStep(vy: number, g: number, terminal: number): number;
export function airControlX(vx: number, stickX: number, p: FighterParams): number;
export function kineticExec(f: FighterState, type: KineticType, input: KineticInput): void;
```
Consumes `fighterParams` (Task 1). `applyMovement`'s signature is unchanged.

- [ ] **Step 1: Write the failing test**

In `src/engine/kinetic.test.ts`, replace:

```ts
import { fx } from "./fixed";
import {
  emptyKinetic,
  kineticAdopt,
  kineticClear,
  kineticSum,
  kineticSumX,
  kineticSumY,
} from "./kinetic";
import type { KineticState } from "./kinetic";
import type { FighterState } from "./types";
```

with:

```ts
import { fx } from "./fixed";
import {
  emptyKinetic,
  kineticAdopt,
  kineticClear,
  kineticExec,
  kineticSum,
  kineticSumX,
  kineticSumY,
} from "./kinetic";
import type { KineticState, KineticType } from "./kinetic";
import { paramsFromAttributes } from "./params";
import {
  airDrift,
  applyGravity,
  applyTraction,
  initialDashVelocity,
  runVelocity,
  walkVelocity,
} from "./physics";
import type { FighterAttributes, FighterState } from "./types";
```

In `src/engine/kinetic.test.ts`, replace:

```ts
    expect([f.vx, f.vy, f.launchSpeed]).toEqual([0, 0, 0]);
  });
});
```

with:

```ts
    expect([f.vx, f.vy, f.launchSpeed]).toEqual([0, 0, 0]);
  });
});

/* ------------------------------------------- legacy equivalence (Task 3) -- */

const ATTRS: FighterAttributes = {
  weight: 98,
  walkSpeed: fx(1.155),
  initialDashSpeed: fx(1.936),
  runSpeed: fx(1.76),
  airSpeed: fx(1.208),
  airAccelBase: fx(0.01),
  airAccelAdditional: fx(0.07),
  gravity: fx(0.087),
  fallSpeed: fx(1.5),
  fastFallSpeed: fx(2.4),
  traction: fx(0.102),
  fullHopVelocity: fx(2.514),
  shortHopVelocity: fx(1.747),
  airJumpVelocity: fx(2.514),
  jumps: 2,
  canWallJump: true,
  width: fx(2),
  height: fx(11),
  jumpSquatFrames: 3,
};
const PARAMS = paramsFromAttributes(ATTRS);

/** The pre-Plan-2 `applyMovement` switch and gravity block, on one vx/vy. */
function legacy(type: KineticType, f: FighterState, stickX: number, holdVertical: boolean): [number, number] {
  let vx = f.vx;
  let vy = f.vy;
  switch (type) {
    case "WALK":
      vx = walkVelocity(vx, stickX, ATTRS);
      break;
    case "DASH":
      vx = f.actionFrame <= 1 ? initialDashVelocity(f.facing, ATTRS) : runVelocity(vx, f.facing, ATTRS);
      break;
    case "RUN":
      vx = runVelocity(vx, f.facing, ATTRS);
      break;
    case "MOTION":
      break;
    case "NONE":
      return [0, 0];
    case "FALL":
    case "AIR_ESCAPE":
      vx = f.grounded ? applyTraction(vx, ATTRS) : airDrift(vx, stickX, ATTRS);
      break;
    case "GROUND_STOP":
      if (f.grounded) vx = applyTraction(vx, ATTRS);
      break;
  }
  if (!f.grounded) {
    if (!holdVertical) vy = applyGravity(vy, ATTRS, { fastFalling: f.fastFalling });
  } else if (vy < 0) {
    vy = 0;
  }
  return [vx, vy];
}

describe("kineticExec reproduces the legacy single-velocity movement", () => {
  const TYPES: KineticType[] = ["FALL", "GROUND_STOP", "WALK", "DASH", "RUN", "MOTION", "AIR_ESCAPE", "NONE"];
  it("for every kinetic type, carrier split, stick and situation", () => {
    const q12 = fc.integer({ min: -fx(6), max: fx(6) });
    fc.assert(
      fc.property(
        fc.constantFrom(...TYPES),
        q12,
        q12,
        q12,
        fc.boolean(),
        fc.boolean(),
        fc.constantFrom(-1, 0, 1),
        fc.constantFrom(-1, 1),
        fc.integer({ min: 0, max: 30 }),
        fc.boolean(),
        (type, a, b, gy, grounded, fastFalling, stickX, facing, actionFrame, holdVertical) => {
          // Speed may sit on either horizontal carrier when the frame starts.
          const f = body({ controlX: a, stopX: b, gravityY: gy }, { grounded, fastFalling, facing, actionFrame });
          kineticSum(f);
          const want = legacy(type, f, stickX, holdVertical);
          kineticExec(f, type, { stickX, params: PARAMS, holdVertical });
          return f.vx === want[0] && f.vy === want[1];
        },
      ),
      { numRuns: 2000 },
    );
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/engine/kinetic.test.ts`
Expected: FAIL — `kineticExec` is not exported yet, so the equivalence property throws.

- [ ] **Step 3: Implement**

In `src/engine/kinetic.ts`, replace:

```ts
import type { FighterState } from "./types";
```

with:

```ts
import { approach } from "./fixed";
import type { FighterParams } from "./params";
import type { ActionState, FighterState } from "./types";
```

In `src/engine/kinetic.ts`, replace:

```ts
  f.launchSpeed = 0;
  kineticSum(f);
}
```

with:

```ts
  f.launchSpeed = 0;
  kineticSum(f);
}

/* ---------------------------------------------------------- kinetic types -- */

/**
 * How a status drives the energies — the replica's `FIGHTER_KINETIC_TYPE_*`.
 *
 * Names follow skyline-smash where the game has a matching type (FALL 0x0,
 * GROUND_STOP 0x6, DASH 0x1D, MOTION 0x10, AIR_ESCAPE 0xD, NONE 0xFFFFFFFF).
 * WALK and RUN are replica names: the game drives both through the CONTROL
 * energy of its ground statuses rather than through a named type.
 */
export type KineticType =
  | "FALL"
  | "GROUND_STOP"
  | "WALK"
  | "DASH"
  | "RUN"
  | "MOTION"
  | "AIR_ESCAPE"
  | "NONE";

/**
 * Each action's kinetic type, transcribed from the legacy `applyMovement`
 * switch. The status objects (Tasks 6–11) declare the same values; this table
 * is the fallback until they all exist and is deleted in Task 28.
 */
export const KINETIC_TYPE_OF_ACTION: Readonly<Record<ActionState, KineticType>> = {
  stand: "GROUND_STOP",
  walk: "WALK",
  dashStart: "DASH",
  run: "RUN",
  runBrake: "GROUND_STOP",
  turnaround: "GROUND_STOP",
  crouchStart: "GROUND_STOP",
  crouch: "GROUND_STOP",
  crouchEnd: "GROUND_STOP",
  jumpSquat: "GROUND_STOP",
  jump: "FALL",
  fall: "FALL",
  land: "GROUND_STOP",
  landingLag: "GROUND_STOP",
  attack: "FALL",
  special: "FALL",
  grab: "FALL",
  grabHold: "FALL",
  pummel: "FALL",
  throw: "FALL",
  shieldStart: "GROUND_STOP",
  shield: "GROUND_STOP",
  shieldRelease: "GROUND_STOP",
  shieldStun: "GROUND_STOP",
  shieldBroken: "GROUND_STOP",
  spotDodge: "GROUND_STOP",
  roll: "MOTION",
  airDodge: "AIR_ESCAPE",
  hitstun: "GROUND_STOP",
  tumble: "GROUND_STOP",
  grabbed: "GROUND_STOP",
  thrown: "GROUND_STOP",
  downed: "GROUND_STOP",
  getUp: "GROUND_STOP",
  ledgeHang: "GROUND_STOP",
  ledgeGetUp: "GROUND_STOP",
  ledgeAttack: "GROUND_STOP",
  ledgeRoll: "GROUND_STOP",
  ledgeJump: "GROUND_STOP",
  respawnPlatform: "NONE",
  dead: "NONE",
  entering: "FALL",
};

/**
 * The horizontal energy a kinetic type drives. Exactly one of CONTROL and STOP
 * holds horizontal speed at a time; `kineticTransfer` moves it across when the
 * type changes, which is what keeps the split numerically identical to the
 * single `vx` it replaced.
 */
export function carrierOf(type: KineticType): HorizontalCarrier {
  return type === "WALK" || type === "DASH" || type === "RUN" || type === "FALL" || type === "AIR_ESCAPE"
    ? "control"
    : "stop";
}

export function kineticTransfer(f: FighterState, type: KineticType): void {
  const k = f.kinetic;
  if (carrierOf(type) === "control") {
    if (k.stopX !== 0) {
      k.controlX += k.stopX;
      k.stopX = 0;
    }
  } else if (k.controlX !== 0) {
    k.stopX += k.controlX;
    k.controlX = 0;
  }
}

/** Legacy ground acceleration: walking approaches at 2 × traction, running at 3 ×. */
export const WALK_ACCEL_FACTOR = 2;
export const RUN_ACCEL_FACTOR = 3;

export interface KineticInput {
  /** Horizontal stick, −1/0/1 from the keyboard. */
  readonly stickX: number;
  readonly params: FighterParams;
  /** Air dodge only: its intangible window is open, so gravity waits. */
  readonly holdVertical: boolean;
}

/** One frame of gravity toward `terminal`, which is a positive speed. */
export function gravityStep(vy: number, g: number, terminal: number): number {
  const next = vy - g;
  return next < -terminal ? -terminal : next;
}

/**
 * Air drift: base plus additional acceleration, capped at air speed — but only
 * in the direction being held, so drifting back against a fast launch is
 * allowed while drifting further out is not.
 */
export function airControlX(vx: number, stickX: number, p: FighterParams): number {
  if (stickX === 0) return vx;
  const accel = p.air_accel_x_add + p.air_accel_x_mul;
  if (stickX > 0 && vx >= p.air_speed_x_stable) return vx;
  if (stickX < 0 && vx <= -p.air_speed_x_stable) return vx;
  return approach(vx, stickX > 0 ? p.air_speed_x_stable : -p.air_speed_x_stable, accel);
}

/**
 * KineticModule exec for one frame of a non-reeling fighter: drive the
 * energies the kinetic type names, then write their sum to `vx`/`vy`.
 */
export function kineticExec(f: FighterState, type: KineticType, input: KineticInput): void {
  if (type === "NONE") {
    kineticClear(f);
    return;
  }
  const k = f.kinetic;
  const p = input.params;
  kineticTransfer(f, type);
  switch (type) {
    case "WALK":
      k.controlX = approach(k.controlX, input.stickX * p.walk_speed_max, p.ground_brake * WALK_ACCEL_FACTOR);
      break;
    case "DASH":
      k.controlX =
        f.actionFrame <= 1
          ? f.facing * p.dash_speed
          : approach(k.controlX, f.facing * p.run_speed_max, p.ground_brake * RUN_ACCEL_FACTOR);
      break;
    case "RUN":
      k.controlX = approach(k.controlX, f.facing * p.run_speed_max, p.ground_brake * RUN_ACCEL_FACTOR);
      break;
    case "FALL":
    case "AIR_ESCAPE":
      k.controlX = f.grounded ? approach(k.controlX, 0, p.ground_brake) : airControlX(k.controlX, input.stickX, p);
      break;
    case "GROUND_STOP":
      if (f.grounded) k.stopX = approach(k.stopX, 0, p.ground_brake);
      break;
    case "MOTION":
      break;
  }
  if (!f.grounded) {
    if (!input.holdVertical) {
      k.gravityY = gravityStep(k.gravityY, p.air_accel_y, f.fastFalling ? p.dive_speed_y : p.air_speed_y_stable);
    }
  } else {
    const sumY = kineticSumY(f);
    if (sumY < 0) k.gravityY -= sumY;
  }
  kineticSum(f);
}
```

In `src/engine/states.ts`, replace:

```ts
export function applyMovement(f: FighterState, intent: Intent, ctx: StateContext): void {
  const a = ctx.def.attributes;

  if (f.ledge !== null) {
    f.vx = 0;
    f.vy = 0;
    return;
  }

  // Scripted movement outranks everything below it — that is the point of a
  // move that carries its own — but only for as long as it is held.
  if (f.hitstun <= 0 && applyMoveMomentum(f, ctx)) return;

  if (f.hitstun > 0) {
    decayLaunch(f, LAUNCH_SPEED_DECAY);
    if (!f.grounded) f.vy = applyGravity(f.vy, a, hitstunGravityOptions(f));
    else f.vx = applyTraction(f.vx, a);
    return;
  }

  switch (f.action) {
    case "walk":
      f.vx = walkVelocity(f.vx, intent.x, a);
      break;
    case "dashStart":
      f.vx = f.actionFrame <= 1 ? initialDashVelocity(f.facing, a) : runVelocity(f.vx, f.facing, a);
      break;
    case "run":
      f.vx = runVelocity(f.vx, f.facing, a);
      break;
    case "roll":
      // Velocity was set on entry; a roll travels a fixed distance.
      break;
    case "respawnPlatform":
    case "dead":
      f.vx = 0;
      f.vy = 0;
      return;
    case "attack":
    case "special":
    case "grab":
    case "grabHold":
    case "pummel":
    case "throw":
    case "jump":
    case "fall":
    case "entering":
    case "airDodge":
      if (f.grounded) f.vx = applyTraction(f.vx, a);
      else f.vx = airDrift(f.vx, intent.x, a);
      break;
    default:
      if (f.grounded) f.vx = applyTraction(f.vx, a);
      break;
  }

  if (!f.grounded) {
    const w = dodgeWindow(f);
    if (f.action === "airDodge" && w !== null && f.actionFrame <= w[1]) {
      // An air dodge holds its own velocity outright; gravity resumes when the
      // intangible window closes, which is what makes a missed one a free punish.
      return;
    }
    f.vy = applyGravity(f.vy, a, { fastFalling: f.fastFalling });
  } else if (f.vy < 0) {
    f.vy = 0;
  }
}

```

with:

```ts
export function applyMovement(f: FighterState, intent: Intent, ctx: StateContext): void {
  const a = ctx.def.attributes;
  const type = KINETIC_TYPE_OF_ACTION[f.action];
  const carrier = carrierOf(type);
  // Fold any direct write to vx/vy since the last frame into the energies.
  kineticAdopt(f, carrier);

  if (f.ledge !== null) {
    kineticClear(f);
    return;
  }

  // Scripted movement outranks everything below it — that is the point of a
  // move that carries its own — but only for as long as it is held.
  if (f.hitstun <= 0 && applyMoveMomentum(f, ctx)) {
    kineticAdopt(f, carrier);
    return;
  }

  if (f.hitstun > 0) {
    decayLaunch(f, LAUNCH_SPEED_DECAY);
    if (!f.grounded) f.vy = applyGravity(f.vy, a, hitstunGravityOptions(f));
    else f.vx = applyTraction(f.vx, a);
    kineticAdopt(f, carrier);
    return;
  }

  const w = dodgeWindow(f);
  kineticExec(f, type, {
    stickX: intent.x,
    params: fighterParams(ctx.def),
    // An air dodge holds its own velocity outright; gravity resumes when the
    // intangible window closes, which is what makes a missed one a free punish.
    holdVertical: f.action === "airDodge" && w !== null && f.actionFrame <= w[1],
  });
}

```

In `src/engine/states.ts`, replace:

```ts
import { clearHitRecord, moveFrameOf } from "./hitbox";
```

with:

```ts
import { clearHitRecord, moveFrameOf } from "./hitbox";
import { KINETIC_TYPE_OF_ACTION, carrierOf, kineticAdopt, kineticClear, kineticExec } from "./kinetic";
import { fighterParams } from "./params";
```

In `src/engine/states.ts`, replace:

```ts
import {
  airDrift,
  applyGravity,
  applyTraction,
  decayLaunch,
  dropThroughPlatform,
  fastFallVelocity,
  hitstunGravityOptions,
  initialDashVelocity,
  platformCentreX,
  runVelocity,
  walkVelocity,
} from "./physics";
```

with:

```ts
import {
  applyGravity,
  applyTraction,
  decayLaunch,
  dropThroughPlatform,
  fastFallVelocity,
  hitstunGravityOptions,
  platformCentreX,
} from "./physics";
```

In `src/engine/physics.ts`, replace:

```ts
/** Ground acceleration is a multiple of traction — the stat Ultimate publishes. */
export const WALK_ACCEL_FACTOR = 2;
export const RUN_ACCEL_FACTOR = 3;
```

with:

```ts
/** Ground acceleration is a multiple of traction (legacy; now defined in `kinetic.ts`). */
export { RUN_ACCEL_FACTOR, WALK_ACCEL_FACTOR };
```

In `src/engine/physics.ts`, replace:

```ts
import { TURN } from "./knockback";
```

with:

```ts
import { RUN_ACCEL_FACTOR, WALK_ACCEL_FACTOR } from "./kinetic";
import { TURN } from "./knockback";
```

- [ ] **Step 4: Run it again**

Run: `pnpm vitest run src/engine/kinetic.test.ts`
Expected: PASS.

- [ ] **Step 5: The golden trace must not move**

Run: `pnpm vitest run src/game/golden.test.ts`
Expected: PASS, unchanged. This task is a refactor: a divergence here is a bug in this task, not a fixture to regenerate.

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0. `pnpm lint` reports no errors and no warning in a file this task touched; any warnings it printed before this plan started (measure once, with Plan 1 merged, before Task 0) are unchanged.

- [ ] **Step 7: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/src/engine/kinetic.test.ts \
  super-smash/src/engine/kinetic.ts \
  super-smash/src/engine/physics.ts \
  super-smash/src/engine/states.ts
git commit -m "super-smash: KineticModule exec — CONTROL, STOP and GRAVITY drive every non-reeling frame" -m "The applyMovement switch becomes a kinetic-type table. One horizontal carrier at a time keeps the split identical to the old single vx: a 2,000-case property test against the legacy helpers, and the golden trace, both unchanged." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Route every fighter velocity write through the KineticModule

Close the seam. Every direct write to a fighter's `vx`/`vy` in the engine goes through a KineticModule call (`kineticSetX/Y`, `kineticSet`, `kineticJump`, `kineticLaunch`, `kineticClear`). The four legacy writes Tasks 17–18 replace carry a `kinetic: legacy-write` marker naming the task. A source-scanning test forbids any new unmarked write. Behaviour is unchanged (these helpers equal the raw writes while DAMAGE and MOTION are still zero).

**Files:**
- Create: `super-smash/src/engine/velocity-writes.test.ts`
- Modify: `super-smash/src/engine/kinetic.ts`
- Modify: `super-smash/src/engine/physics.ts` — imports
- Modify: `super-smash/src/engine/simulate.ts` — imports
- Modify: `super-smash/src/engine/states.ts` — imports

**Interfaces:** Produces (`kinetic.ts`):
```ts
export function kineticSetX(f: FighterState, vx: number, carrier?: HorizontalCarrier): void;
export function kineticSetY(f: FighterState, vy: number): void;
export function kineticSet(f: FighterState, vx: number, vy: number, carrier?: HorizontalCarrier): void;
export function kineticJump(f: FighterState, vy: number): void;
export function kineticLaunch(f: FighterState, vx: number, vy: number, speed: number): void; // DAMAGE energy from Task 17
```

- [ ] **Step 1: Write the failing test**

Create `src/engine/velocity-writes.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every change to a fighter's velocity goes through the KineticModule.
 *
 * `vx`/`vy` are the *sum* of the energies (`kinetic.ts`). A direct write to
 * one makes the sum and the energies disagree; `kineticAdopt` papers over it by
 * folding the difference into a carrier, which is right for the legacy code it
 * was built for and wrong for anything that also holds a launch or a scripted
 * motion — the difference lands on the wrong energy and decays by the wrong
 * rule. So the engine may not write them, outside `kinetic.ts`, except on a
 * line that says it is legacy and names the task that removes it.
 *
 * Projectiles (`p.vx`) and the Smash Ball (`ball.vx`) are not fighters.
 */

const ENGINE = join(process.cwd(), "src", "engine");
const MARKER = "kinetic: legacy-write";
const WRITE = /\b(?!(?:p|ball)\.)[A-Za-z_]\w*\.v[xy]\s*(?:[-+*/]?=)(?!=)/;

/** Every non-test source under `dir`, recursively, as [path relative to `dir`, text]. */
function walk(dir: string, rel = ""): [string, string][] {
  const out: [string, string][] = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    const name = rel === "" ? entry : `${rel}/${entry}`;
    if (statSync(full).isDirectory()) out.push(...walk(full, name));
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push([name, readFileSync(full, "utf8")]);
  }
  return out;
}

function sources(): [string, string][] {
  return walk(ENGINE).filter(([name]) => name !== "kinetic.ts");
}

describe("fighter velocity writes", () => {
  it("happen only through kinetic.ts, or on a marked legacy line", () => {
    const violations: string[] = [];
    for (const [file, src] of sources()) {
      src.split("\n").forEach((line, i) => {
        const code = line.trim();
        if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) return;
        if (!WRITE.test(line)) return;
        if (line.includes(MARKER)) return;
        violations.push(`${file}:${i + 1} ${code}`);
      });
    }
    expect(violations).toEqual([]);
  });

  it("walks subdirectories, so engine/status/ and engine/acmd/ are guarded too", () => {
    const names = walk(join(process.cwd(), "src")).map(([name]) => name);
    expect(names).toContain("engine/simulate.ts");
    expect(names).toContain("engine/kinetic.ts");
  });

  it("catches the write it exists to catch", () => {
    expect(WRITE.test("    f.vx = 0;")).toBe(true);
    expect(WRITE.test("    victim.vy += 1;")).toBe(true);
    expect(WRITE.test("    p.vx = -p.vx;")).toBe(false);
    expect(WRITE.test("    if (f.vy === 0) return;")).toBe(false);
    expect(WRITE.test("    const v = f.vx;")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/engine/velocity-writes.test.ts`
Expected: FAIL — "happen only through kinetic.ts, or on a marked legacy line": `expected [ …(39) ] to deeply equal []` — 39 `file:line f.vx = …` writes across `simulate.ts`, `states.ts` and `physics.ts`. The walker and regex tests pass.

- [ ] **Step 3: Implement**

In `src/engine/kinetic.ts`, replace:

```ts
/* ---------------------------------------------------------- kinetic types -- */
```

with:

```ts
/* --------------------------------------------- setting a velocity outright -- */

/**
 * Set the horizontal speed outright: every horizontal energy to zero, then
 * `vx` on `carrier`. The KineticModule equivalent of `f.vx = vx`.
 */
export function kineticSetX(f: FighterState, vx: number, carrier: HorizontalCarrier = "control"): void {
  const k = f.kinetic;
  k.controlX = carrier === "control" ? vx : 0;
  k.stopX = carrier === "stop" ? vx : 0;
  k.motionX = 0;
  k.damageX = 0;
  kineticSum(f);
}

/** Set the vertical speed outright, on GRAVITY. The equivalent of `f.vy = vy`. */
export function kineticSetY(f: FighterState, vy: number): void {
  const k = f.kinetic;
  k.gravityY = vy;
  k.motionY = 0;
  k.damageY = 0;
  kineticSum(f);
}

/** Both at once. */
export function kineticSet(f: FighterState, vx: number, vy: number, carrier: HorizontalCarrier = "control"): void {
  kineticSetX(f, vx, carrier);
  kineticSetY(f, vy);
}

/**
 * A jump's vertical speed, which also ends any launch: the launch's horizontal
 * part stays with the fighter as ordinary drift (CONTROL), its vertical part is
 * replaced, and `launchSpeed` stops decaying anything.
 */
export function kineticJump(f: FighterState, vy: number): void {
  const k = f.kinetic;
  k.controlX += k.damageX;
  k.damageX = 0;
  f.launchSpeed = 0;
  kineticSetY(f, vy);
}

/**
 * A knockback launch. Until Task 17 gives it the DAMAGE energy this is the
 * legacy behaviour: the launch *replaces* the velocity and `launchSpeed`
 * carries its magnitude for the legacy decay.
 */
export function kineticLaunch(f: FighterState, vx: number, vy: number, speed: number): void {
  kineticSet(f, vx, vy);
  f.launchSpeed = speed;
}

/* ---------------------------------------------------------- kinetic types -- */
```

In `src/engine/simulate.ts`, replace:

```ts
    f.stocks -= 1;
    f.damage = 0;
    f.vx = 0;
    f.vy = 0;
    f.hitstun = 0;
    f.hitlag = 0;
    f.launchSpeed = 0;
```

with:

```ts
    f.stocks -= 1;
    f.damage = 0;
    kineticClear(f);
    f.hitstun = 0;
    f.hitlag = 0;
```

In `src/engine/simulate.ts`, replace:

```ts
  f.vx = -f.facing * fx(0.5);
  clearHitRecord(f);
```

with:

```ts
  kineticSetX(f, -f.facing * fx(0.5));
  clearHitRecord(f);
```

In `src/engine/simulate.ts`, replace:

```ts
  if (launch.speed > 0) {
    f.vx = Math.trunc((launch.vx * speed) / launch.speed);
    f.vy = Math.trunc((launch.vy * speed) / launch.speed);
  } else {
    f.vx = 0;
    f.vy = 0;
  }
  f.launchSpeed = speed;
```

with:

```ts
  if (launch.speed > 0) {
    kineticLaunch(
      f,
      Math.trunc((launch.vx * speed) / launch.speed),
      Math.trunc((launch.vy * speed) / launch.speed),
      speed,
    );
  } else {
    kineticLaunch(f, 0, 0, speed);
  }
```

In `src/engine/simulate.ts`, replace:

```ts
    victim.grabbedBy = attacker.port;
    victim.vx = 0;
    victim.vy = 0;
```

with:

```ts
    victim.grabbedBy = attacker.port;
    kineticSet(victim, 0, 0);
```

In `src/engine/simulate.ts`, replace:

```ts
    victim.vx = (victim.x < c.x ? -1 : 1) * mul(damage, SHIELD_PUSHBACK);
```

with:

```ts
    kineticSetX(victim, (victim.x < c.x ? -1 : 1) * mul(damage, SHIELD_PUSHBACK), "stop");
```

In `src/engine/simulate.ts`, replace:

```ts
import { cloneKinetic, emptyKinetic } from "./kinetic";
```

with:

```ts
import {
  cloneKinetic,
  emptyKinetic,
  kineticClear,
  kineticLaunch,
  kineticSet,
  kineticSetX,
} from "./kinetic";
```

In `src/engine/states.ts`, replace:

```ts
  f.jumpsUsed += 1;
  f.vy = a.airJumpVelocity;
  f.fastFalling = false;
  f.launchSpeed = 0;
```

with:

```ts
  f.jumpsUsed += 1;
  kineticJump(f, a.airJumpVelocity);
  f.fastFalling = false;
```

In `src/engine/states.ts`, replace:

```ts
    f.vx = intent.x * speed;
    f.vy = intent.y * speed;
  } else {
    f.vx = 0;
    f.vy = 0;
  }
  f.launchSpeed = 0;
```

with:

```ts
    kineticSet(f, intent.x * speed, intent.y * speed);
  } else {
    kineticSet(f, 0, 0);
  }
  f.launchSpeed = 0;
```

In `src/engine/states.ts`, replace:

```ts
        f.x = spawn.x;
        f.y = spawn.y;
        f.vx = 0;
        f.vy = 0;
```

with:

```ts
        f.x = spawn.x;
        f.y = spawn.y;
        kineticClear(f);
```

In `src/engine/states.ts`, replace:

```ts
        startAction(f, "roll");
        f.vx = intent.x * Math.trunc(ROLL_DISTANCE / ROLL_FRAMES);
```

with:

```ts
        startAction(f, "roll");
        kineticSetX(f, intent.x * Math.trunc(ROLL_DISTANCE / ROLL_FRAMES), "stop");
```

In `src/engine/states.ts`, replace:

```ts
      if (f.actionFrame >= ROLL_FRAMES) {
        f.vx = 0;
        startAction(f, "stand");
```

with:

```ts
      if (f.actionFrame >= ROLL_FRAMES) {
        kineticSetX(f, 0, "stop");
        startAction(f, "stand");
```

In `src/engine/states.ts`, replace:

```ts
      f.vy = short ? a.shortHopVelocity : a.fullHopVelocity;
```

with:

```ts
      kineticSetY(f, short ? a.shortHopVelocity : a.fullHopVelocity);
```

In `src/engine/states.ts`, replace:

```ts
        f.fastFalling = true;
        f.vy = fastFallVelocity(ctx.def.attributes);
```

with:

```ts
        f.fastFalling = true;
        kineticSetY(f, fastFallVelocity(ctx.def.attributes));
```

In `src/engine/states.ts`, replace:

```ts
  if (f.action === "ledgeJump") {
    f.vy = LEDGE_JUMP_VELOCITY;
```

with:

```ts
  if (f.action === "ledgeJump") {
    kineticSetY(f, LEDGE_JUMP_VELOCITY);
```

In `src/engine/states.ts`, replace:

```ts
  f.y = p.y;
  f.vx = 0;
  f.vy = 0;
  f.grounded = true;
  f.platform = ledge.platform;
```

with:

```ts
  f.y = p.y;
  kineticSet(f, 0, 0);
  f.grounded = true;
  f.platform = ledge.platform;
```

In `src/engine/states.ts`, replace:

```ts
  if (f.action === "tumble") {
    f.hitstun = 0;
    f.vx = 0;
```

with:

```ts
  if (f.action === "tumble") {
    f.hitstun = 0;
    kineticSetX(f, 0, "stop");
```

In `src/engine/states.ts`, replace:

```ts
  f.x = x;
  f.y = y;
  f.vx = 0;
  f.vy = 0;
  f.launchSpeed = 0;
  f.facing = -side;
```

with:

```ts
  f.x = x;
  f.y = y;
  kineticClear(f);
  f.facing = -side;
```

In `src/engine/states.ts`, replace:

```ts
    f.vx = m.x * (f.facing >= 0 ? 1 : -1);
    f.vy = m.y;
```

with:

```ts
    f.vx = m.x * (f.facing >= 0 ? 1 : -1); // kinetic: legacy-write (Task 18 moves this to MOTION)
    f.vy = m.y; // kinetic: legacy-write (Task 18 moves this to MOTION)
```

In `src/engine/states.ts`, replace:

```ts
    if (f.grounded && f.vy < 0) f.vy = 0;
```

with:

```ts
    if (f.grounded && f.vy < 0) f.vy = 0; // kinetic: legacy-write (Task 18 moves this to MOTION)
```

In `src/engine/states.ts`, replace:

```ts
    if (!f.grounded) f.vy = applyGravity(f.vy, a, hitstunGravityOptions(f));
    else f.vx = applyTraction(f.vx, a);
```

with:

```ts
    if (!f.grounded) f.vy = applyGravity(f.vy, a, hitstunGravityOptions(f)); // kinetic: legacy-write (Task 17 moves this to DAMAGE)
    else f.vx = applyTraction(f.vx, a); // kinetic: legacy-write (Task 17 moves this to DAMAGE)
```

In `src/engine/states.ts`, replace:

```ts
import { KINETIC_TYPE_OF_ACTION, carrierOf, kineticAdopt, kineticClear, kineticExec } from "./kinetic";
```

with:

```ts
import {
  KINETIC_TYPE_OF_ACTION,
  carrierOf,
  kineticAdopt,
  kineticClear,
  kineticExec,
  kineticJump,
  kineticSet,
  kineticSetX,
  kineticSetY,
} from "./kinetic";
```

In `src/engine/physics.ts`, replace:

```ts
  f.vx = Math.trunc((f.vx * next) / mag);
  f.vy = Math.trunc((f.vy * next) / mag);
```

with:

```ts
  f.vx = Math.trunc((f.vx * next) / mag); // kinetic: legacy-write (Task 17 moves this to DAMAGE)
  f.vy = Math.trunc((f.vy * next) / mag); // kinetic: legacy-write (Task 17 moves this to DAMAGE)
```

In `src/engine/physics.ts`, replace:

```ts
      if (p.motion) f.x += cx - platformCentreX(p, frame - 1);
      f.y = p.y;
      f.vy = 0;
      return out;
```

with:

```ts
      if (p.motion) f.x += cx - platformCentreX(p, frame - 1);
      f.y = p.y;
      kineticSetY(f, 0);
      return out;
```

In `src/engine/physics.ts`, replace:

```ts
      f.x = prevX <= cx ? cx - reach : cx + reach;
      f.vx = 0;
      out.blocked = true;
```

with:

```ts
      f.x = prevX <= cx ? cx - reach : cx + reach;
      kineticSetX(f, 0);
      out.blocked = true;
```

In `src/engine/physics.ts`, replace:

```ts
      f.y = bottom - attrs.height;
      f.vy = 0;
      out.blocked = true;
```

with:

```ts
      f.y = bottom - attrs.height;
      kineticSetY(f, 0);
      out.blocked = true;
```

In `src/engine/physics.ts`, replace:

```ts
    f.y = p.y;
    f.vy = 0;
    f.grounded = true;
    f.platform = i;
```

with:

```ts
    f.y = p.y;
    kineticSetY(f, 0);
    f.grounded = true;
    f.platform = i;
```

In `src/engine/physics.ts`, replace:

```ts
  f.y -= 1;
  f.grounded = false;
  f.platform = -1;
  f.vy = 0;
```

with:

```ts
  f.y -= 1;
  f.grounded = false;
  f.platform = -1;
  kineticSetY(f, 0);
```

In `src/engine/physics.ts`, replace:

```ts
import { RUN_ACCEL_FACTOR, WALK_ACCEL_FACTOR } from "./kinetic";
```

with:

```ts
import { RUN_ACCEL_FACTOR, WALK_ACCEL_FACTOR, kineticSetX, kineticSetY } from "./kinetic";
```

- [ ] **Step 4: Run it again**

Run: `pnpm vitest run src/engine/velocity-writes.test.ts`
Expected: PASS.

- [ ] **Step 5: The golden trace must not move**

Run: `pnpm vitest run src/game/golden.test.ts`
Expected: PASS, unchanged. This task is a refactor: a divergence here is a bug in this task, not a fixture to regenerate.

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0. `pnpm lint` reports no errors and no warning in a file this task touched; any warnings it printed before this plan started (measure once, with Plan 1 merged, before Task 0) are unchanged.

- [ ] **Step 7: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/src/engine/kinetic.ts \
  super-smash/src/engine/physics.ts \
  super-smash/src/engine/simulate.ts \
  super-smash/src/engine/states.ts \
  super-smash/src/engine/velocity-writes.test.ts
git commit -m "super-smash: every fighter velocity write goes through the KineticModule" -m "kineticSetX/Y, kineticSet, kineticJump, kineticLaunch and kineticClear replace raw vx/vy writes; the four that Tasks 17-18 replace are marked. velocity-writes.test.ts forbids new ones." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: StatusModule core: StatusKind, change_status, registry

StatusModule core: the 42 replica actions get SSBU-style `FIGHTER_STATUS_KIND_*` names in a one-to-one alias table (skyline-smash `lua_const.rs` names where the game has the status), a `FighterStatus` object type with `pre`/`main`/`exec`/`end`, a registry, and `changeStatus` (end → reset → pre). `startAction` and `startMove` route through it; `advanceFighter` dispatches to a registered status and falls back to the legacy switch. `status/index.ts` registers statuses as a side effect of `simulate.ts` importing it. The helpers status files need are exported from `states.ts`.

**Files:**
- Create: `super-smash/src/engine/status/index.ts`
- Create: `super-smash/src/engine/status/kind.ts`
- Create: `super-smash/src/engine/status/status.test.ts`
- Modify: `super-smash/src/engine/simulate.ts` — imports
- Modify: `super-smash/src/engine/states.ts` — `startAction`, `dodgeWindow`, `hasMove`, `beginAttack`, `beginSpecial`, `Presses`, `presses`, `airJump`, `startAirDodge`, `handleActionable`, `finishLedgeOption`, `advanceFighter`, imports

**Interfaces:** Produces (`src/engine/status/kind.ts`):
```ts
export type StatusKind = "FIGHTER_STATUS_KIND_WAIT" | … 42 names …;
export const STATUS_KIND_OF_ACTION: Readonly<Record<ActionState, StatusKind>>;
export const ACTION_OF_STATUS_KIND: Readonly<Record<StatusKind, ActionState>>;
export function statusKindOf(f: Pick<FighterState, "action">): StatusKind;
export interface FighterStatus {
  readonly kind: StatusKind; readonly action: ActionState; readonly kineticType: KineticType;
  readonly pre?: (f: FighterState) => void;
  readonly main: (f: FighterState, intent: Intent, ctx: StateContext) => void;
  readonly exec?: (f: FighterState, intent: Intent, ctx: StateContext) => void;
  readonly end?: (f: FighterState) => void;
}
export type StatusTable = { readonly [A in ActionState]?: FighterStatus };
export const STATUS_TABLE: StatusTable;
export function registerStatus(s: FighterStatus): void;
export function changeStatus(f: FighterState, action: ActionState, table?: StatusTable): void;
```
`src/engine/status/index.ts`: `export const ALL_STATUSES: readonly FighterStatus[]`. Newly exported from `states.ts`: `startMove`, `dodgeWindow`, `hasMove`, `beginAttack`, `beginSpecial`, `Presses`, `presses`, `airJump`, `startAirDodge`, `handleActionable`, `finishLedgeOption`.

- [ ] **Step 1: Write the failing test**

Create `src/engine/status/status.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { fx } from "../fixed";
import { emptyKinetic } from "../kinetic";
import { advanceFighter } from "../states";
import type { Intent, StateContext } from "../states";
import type { ActionState, FighterDef, FighterState } from "../types";
import {
  ACTION_OF_STATUS_KIND,
  STATUS_KIND_OF_ACTION,
  changeStatus,
  registerStatus,
  statusKindOf,
} from "./kind";
import type { FighterStatus, StatusTable } from "./kind";

function fighter(over: Partial<FighterState> = {}): FighterState {
  return {
    port: 0,
    defId: "t",
    costume: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    facing: 1,
    grounded: true,
    platform: 0,
    action: "stand",
    actionFrame: 0,
    move: null,
    charge: 0,
    damage: 0,
    stocks: 3,
    jumpsUsed: 0,
    airDodged: false,
    fastFalling: false,
    shortHop: false,
    shieldHealth: fx(50),
    hitstun: 0,
    hitlag: 0,
    launchSpeed: 0,
    pendingKnockback: 0,
    pendingAngle: 0,
    pendingFacing: 0,
    balloon: false,
    intangible: 0,
    invincible: 0,
    grabbedBy: -1,
    grabbing: -1,
    grabTimer: 0,
    ledge: null,
    ledgeRegrabs: 0,
    airTime: 0,
    finalSmashReady: 0,
    staleQueue: [],
    hitThisMove: [],
    framesSinceDirPress: 999,
    lastDirPressed: 0,
    bufferedAction: null,
    kinetic: emptyKinetic(),
    ...over,
  };
}

const CTX = { def: {} as FighterDef, stage: { platforms: [] }, frame: 1, fighters: [] } as unknown as StateContext;

describe("the status alias table", () => {
  it("names an SSBU-style kind for every replica action, one-to-one", () => {
    const actions = Object.keys(STATUS_KIND_OF_ACTION) as ActionState[];
    expect(actions).toHaveLength(42);
    const kinds = new Set(actions.map((a) => STATUS_KIND_OF_ACTION[a]));
    expect(kinds.size).toBe(actions.length);
    for (const a of actions) expect(ACTION_OF_STATUS_KIND[STATUS_KIND_OF_ACTION[a]]).toBe(a);
  });

  it("uses skyline-smash names where the game has the status", () => {
    // ultimate-research/skyline-smash src/lua_const.rs
    expect(statusKindOf({ action: "stand" })).toBe("FIGHTER_STATUS_KIND_WAIT");
    expect(statusKindOf({ action: "jumpSquat" })).toBe("FIGHTER_STATUS_KIND_JUMP_SQUAT");
    expect(statusKindOf({ action: "ledgeHang" })).toBe("FIGHTER_STATUS_KIND_CLIFF_WAIT");
    expect(statusKindOf({ action: "airDodge" })).toBe("FIGHTER_STATUS_KIND_ESCAPE_AIR");
  });
});

describe("changeStatus", () => {
  function spy(action: ActionState, log: string[]): FighterStatus {
    return {
      kind: STATUS_KIND_OF_ACTION[action],
      action,
      kineticType: "GROUND_STOP",
      pre: () => log.push(`pre:${action}`),
      main: () => log.push(`main:${action}`),
      end: () => log.push(`end:${action}`),
    };
  }

  it("runs the old status's end, then the new status's pre, once each", () => {
    const log: string[] = [];
    const table: StatusTable = { stand: spy("stand", log), walk: spy("walk", log) };
    const f = fighter({ action: "stand", actionFrame: 9 });
    changeStatus(f, "walk", table);
    expect(log).toEqual(["end:stand", "pre:walk"]);
    expect(f.action).toBe("walk");
    expect(f.actionFrame).toBe(0);
  });

  it("re-enters a status it is already in, as a dash-dance does", () => {
    const log: string[] = [];
    const f = fighter({ action: "walk" });
    changeStatus(f, "walk", { walk: spy("walk", log) });
    expect(log).toEqual(["end:walk", "pre:walk"]);
  });

  it("keeps the move for attack-like statuses and clears it for the rest", () => {
    const keep = fighter({ action: "attack", move: "jab1", charge: 3 });
    changeStatus(keep, "attack", {});
    expect([keep.move, keep.charge]).toEqual(["jab1", 3]);
    const drop = fighter({ action: "attack", move: "jab1", charge: 3 });
    changeStatus(drop, "stand", {});
    expect([drop.move, drop.charge]).toEqual([null, 0]);
  });
});

describe("advanceFighter dispatch", () => {
  it("runs a registered status's main instead of the legacy switch", () => {
    const seen: number[] = [];
    registerStatus({
      kind: "FIGHTER_STATUS_KIND_ENTRY",
      action: "entering",
      kineticType: "FALL",
      main: (f) => seen.push(f.actionFrame),
    });
    const f = fighter({ action: "entering", actionFrame: 0 });
    advanceFighter(f, {} as Intent, CTX);
    advanceFighter(f, {} as Intent, CTX);
    expect(seen).toEqual([1, 2]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/engine/status/status.test.ts`
Expected: FAIL — `status.test.ts` cannot resolve `./kind`.

- [ ] **Step 3: Implement**

Create `src/engine/status/kind.ts`:

```ts
/**
 * StatusModule — one object per fighter status, in Ultimate's shape.
 *
 * Ultimate runs a fighter as a state machine whose states are *statuses*
 * (`FIGHTER_STATUS_KIND_*`, skyline-smash `lua_const.rs`), each a set of
 * functions the engine calls at fixed moments: `pre` when it is entered,
 * `main` every frame, `exec` for per-frame physics, `end` when it is left
 * (HDR's `status/` tree is laid out the same way). The replica's statuses are
 * the `ActionState` names the renderer, CPU and HUD already read, so those
 * names stay what `FighterState.action` holds, and the table below maps each to
 * the SSBU kind it stands for.
 *
 * Three replica names aggregate several SSBU kinds and are marked so: `attack`
 * (every ground attack and aerial — SSBU splits ATTACK, ATTACK_S3 … ATTACK_AIR),
 * `special` (SSBU: SPECIAL_N/S/HI/LW, no aggregate kind exists — the name
 * here is SSBU-*like*), and `roll` (ESCAPE_F and ESCAPE_B).
 */

import type { Intent, StateContext } from "../states";
import type { KineticType } from "../kinetic";
import type { ActionState, FighterState } from "../types";

export type StatusKind =
  | "FIGHTER_STATUS_KIND_WAIT"
  | "FIGHTER_STATUS_KIND_WALK"
  | "FIGHTER_STATUS_KIND_DASH"
  | "FIGHTER_STATUS_KIND_RUN"
  | "FIGHTER_STATUS_KIND_RUN_BRAKE"
  | "FIGHTER_STATUS_KIND_TURN_RUN"
  | "FIGHTER_STATUS_KIND_SQUAT"
  | "FIGHTER_STATUS_KIND_SQUAT_WAIT"
  | "FIGHTER_STATUS_KIND_SQUAT_RV"
  | "FIGHTER_STATUS_KIND_JUMP_SQUAT"
  | "FIGHTER_STATUS_KIND_JUMP"
  | "FIGHTER_STATUS_KIND_FALL"
  | "FIGHTER_STATUS_KIND_LANDING"
  | "FIGHTER_STATUS_KIND_LANDING_ATTACK_AIR"
  | "FIGHTER_STATUS_KIND_ATTACK"
  | "FIGHTER_STATUS_KIND_SPECIAL"
  | "FIGHTER_STATUS_KIND_CATCH"
  | "FIGHTER_STATUS_KIND_CATCH_WAIT"
  | "FIGHTER_STATUS_KIND_CATCH_ATTACK"
  | "FIGHTER_STATUS_KIND_THROW"
  | "FIGHTER_STATUS_KIND_GUARD_ON"
  | "FIGHTER_STATUS_KIND_GUARD"
  | "FIGHTER_STATUS_KIND_GUARD_OFF"
  | "FIGHTER_STATUS_KIND_GUARD_DAMAGE"
  | "FIGHTER_STATUS_KIND_FURAFURA"
  | "FIGHTER_STATUS_KIND_ESCAPE"
  | "FIGHTER_STATUS_KIND_ESCAPE_F"
  | "FIGHTER_STATUS_KIND_ESCAPE_AIR"
  | "FIGHTER_STATUS_KIND_DAMAGE"
  | "FIGHTER_STATUS_KIND_DAMAGE_FLY"
  | "FIGHTER_STATUS_KIND_CAPTURE_WAIT"
  | "FIGHTER_STATUS_KIND_THROWN"
  | "FIGHTER_STATUS_KIND_DOWN_WAIT"
  | "FIGHTER_STATUS_KIND_DOWN_STAND"
  | "FIGHTER_STATUS_KIND_CLIFF_WAIT"
  | "FIGHTER_STATUS_KIND_CLIFF_CLIMB"
  | "FIGHTER_STATUS_KIND_CLIFF_ATTACK"
  | "FIGHTER_STATUS_KIND_CLIFF_ESCAPE"
  | "FIGHTER_STATUS_KIND_CLIFF_JUMP1"
  | "FIGHTER_STATUS_KIND_REBIRTH"
  | "FIGHTER_STATUS_KIND_DEAD"
  | "FIGHTER_STATUS_KIND_ENTRY";

/** The alias table: which SSBU status each replica action stands for. */
export const STATUS_KIND_OF_ACTION: Readonly<Record<ActionState, StatusKind>> = {
  stand: "FIGHTER_STATUS_KIND_WAIT",
  walk: "FIGHTER_STATUS_KIND_WALK",
  dashStart: "FIGHTER_STATUS_KIND_DASH",
  run: "FIGHTER_STATUS_KIND_RUN",
  runBrake: "FIGHTER_STATUS_KIND_RUN_BRAKE",
  turnaround: "FIGHTER_STATUS_KIND_TURN_RUN",
  crouchStart: "FIGHTER_STATUS_KIND_SQUAT",
  crouch: "FIGHTER_STATUS_KIND_SQUAT_WAIT",
  crouchEnd: "FIGHTER_STATUS_KIND_SQUAT_RV",
  jumpSquat: "FIGHTER_STATUS_KIND_JUMP_SQUAT",
  jump: "FIGHTER_STATUS_KIND_JUMP",
  fall: "FIGHTER_STATUS_KIND_FALL",
  land: "FIGHTER_STATUS_KIND_LANDING",
  landingLag: "FIGHTER_STATUS_KIND_LANDING_ATTACK_AIR",
  attack: "FIGHTER_STATUS_KIND_ATTACK",
  special: "FIGHTER_STATUS_KIND_SPECIAL",
  grab: "FIGHTER_STATUS_KIND_CATCH",
  grabHold: "FIGHTER_STATUS_KIND_CATCH_WAIT",
  pummel: "FIGHTER_STATUS_KIND_CATCH_ATTACK",
  throw: "FIGHTER_STATUS_KIND_THROW",
  shieldStart: "FIGHTER_STATUS_KIND_GUARD_ON",
  shield: "FIGHTER_STATUS_KIND_GUARD",
  shieldRelease: "FIGHTER_STATUS_KIND_GUARD_OFF",
  shieldStun: "FIGHTER_STATUS_KIND_GUARD_DAMAGE",
  shieldBroken: "FIGHTER_STATUS_KIND_FURAFURA",
  spotDodge: "FIGHTER_STATUS_KIND_ESCAPE",
  roll: "FIGHTER_STATUS_KIND_ESCAPE_F",
  airDodge: "FIGHTER_STATUS_KIND_ESCAPE_AIR",
  hitstun: "FIGHTER_STATUS_KIND_DAMAGE",
  tumble: "FIGHTER_STATUS_KIND_DAMAGE_FLY",
  grabbed: "FIGHTER_STATUS_KIND_CAPTURE_WAIT",
  thrown: "FIGHTER_STATUS_KIND_THROWN",
  downed: "FIGHTER_STATUS_KIND_DOWN_WAIT",
  getUp: "FIGHTER_STATUS_KIND_DOWN_STAND",
  ledgeHang: "FIGHTER_STATUS_KIND_CLIFF_WAIT",
  ledgeGetUp: "FIGHTER_STATUS_KIND_CLIFF_CLIMB",
  ledgeAttack: "FIGHTER_STATUS_KIND_CLIFF_ATTACK",
  ledgeRoll: "FIGHTER_STATUS_KIND_CLIFF_ESCAPE",
  ledgeJump: "FIGHTER_STATUS_KIND_CLIFF_JUMP1",
  respawnPlatform: "FIGHTER_STATUS_KIND_REBIRTH",
  dead: "FIGHTER_STATUS_KIND_DEAD",
  entering: "FIGHTER_STATUS_KIND_ENTRY",
};

/** The inverse alias table. One-to-one, which `status.test.ts` pins. */
export const ACTION_OF_STATUS_KIND: Readonly<Record<StatusKind, ActionState>> = Object.fromEntries(
  (Object.keys(STATUS_KIND_OF_ACTION) as ActionState[]).map((a) => [STATUS_KIND_OF_ACTION[a], a]),
) as Record<StatusKind, ActionState>;

export function statusKindOf(f: Pick<FighterState, "action">): StatusKind {
  return STATUS_KIND_OF_ACTION[f.action];
}

/**
 * One status. `main` is required; the rest are optional, as they are in the
 * game, where most statuses leave most hooks to the common implementation.
 *
 * `pre` and `end` take the fighter alone because a status change happens from
 * places that have no `StateContext` — a hit in `simulate.ts`, a KO — and they
 * must behave the same from all of them. Anything that needs fighter data is
 * done by whoever requested the change, as the game's `change_status` callers
 * do with `WorkModule` set-up.
 */
export interface FighterStatus {
  readonly kind: StatusKind;
  readonly action: ActionState;
  /** `KineticModule::change_kinetic` — how the energies are driven in this status. */
  readonly kineticType: KineticType;
  /** status_pre: once, on entry, after the previous status's `end`. */
  readonly pre?: (f: FighterState) => void;
  /** status_main: every frame the fighter is not frozen, after `actionFrame` advances. */
  readonly main: (f: FighterState, intent: Intent, ctx: StateContext) => void;
  /** status_exec: per-frame extras after the kinetic type has run. Unused in Plan 2. */
  readonly exec?: (f: FighterState, intent: Intent, ctx: StateContext) => void;
  /** status_end: once, on leaving, before the next status's `pre`. */
  readonly end?: (f: FighterState) => void;
}

export type StatusTable = { readonly [A in ActionState]?: FighterStatus };

const REGISTRY: { [A in ActionState]?: FighterStatus } = {};

/** Every registered status. Filled by `status/index.ts` at module load. */
export const STATUS_TABLE: StatusTable = REGISTRY;

export function registerStatus(s: FighterStatus): void {
  REGISTRY[s.action] = s;
}

/**
 * `StatusModule::change_status`: leave the current status, enter `action`.
 *
 * Runs the old status's `end`, resets the per-status counters, then runs the
 * new status's `pre`. Re-entering the status a fighter is already in (a
 * dash-dance, a jab follow-up) runs both, as the game does.
 */
export function changeStatus(f: FighterState, action: ActionState, table: StatusTable = STATUS_TABLE): void {
  table[f.action]?.end?.(f);
  f.action = action;
  f.actionFrame = 0;
  if (action !== "attack" && action !== "special" && action !== "throw" && action !== "pummel") {
    f.move = null;
    f.charge = 0;
  }
  table[action]?.pre?.(f);
}
```

Create `src/engine/status/index.ts`:

```ts
/**
 * Registers every status object with the StatusModule.
 *
 * Imported for its side effect by `simulate.ts` (and by tests that drive the
 * state machine directly). Each status group adds itself here as it migrates
 * out of the legacy switch in `states.ts`.
 */

import { registerStatus } from "./kind";
import type { FighterStatus } from "./kind";

export const ALL_STATUSES: readonly FighterStatus[] = [];

for (const s of ALL_STATUSES) registerStatus(s);
```

In `src/engine/states.ts`, replace:

```ts
export function startAction(f: FighterState, action: ActionState): void {
  f.action = action;
  f.actionFrame = 0;
  if (action !== "attack" && action !== "special" && action !== "throw" && action !== "pummel") {
    f.move = null;
    f.charge = 0;
  }
}

function startMove(f: FighterState, action: ActionState, slot: MoveSlot): void {
  f.action = action;
  f.actionFrame = 0;
  f.move = slot;
  f.charge = 0;
  clearHitRecord(f);
}
```

with:

```ts
/** Change status through the StatusModule (`status/kind.ts`): end, reset, pre. */
export function startAction(f: FighterState, action: ActionState): void {
  changeStatus(f, action);
}

/**
 * Enter a swinging status with `slot` as its move. Task 8 also resets the hit
 * record in those statuses' `pre`; it is reset here too so a status not yet
 * registered — a test that skips the registry — behaves the same.
 */
export function startMove(f: FighterState, action: ActionState, slot: MoveSlot): void {
  changeStatus(f, action);
  f.move = slot;
  f.charge = 0;
  clearHitRecord(f);
}
```

In `src/engine/states.ts`, replace:

```ts
function dodgeWindow(f: FighterState): readonly [number, number] | null {
```

with:

```ts
export function dodgeWindow(f: FighterState): readonly [number, number] | null {
```

In `src/engine/states.ts`, replace:

```ts
function hasMove(ctx: StateContext, slot: MoveSlot): boolean {
```

with:

```ts
export function hasMove(ctx: StateContext, slot: MoveSlot): boolean {
```

In `src/engine/states.ts`, replace:

```ts
function beginAttack(f: FighterState, ctx: StateContext, slot: MoveSlot): boolean {
```

with:

```ts
export function beginAttack(f: FighterState, ctx: StateContext, slot: MoveSlot): boolean {
```

In `src/engine/states.ts`, replace:

```ts
function beginSpecial(f: FighterState, ctx: StateContext, slot: MoveSlot): boolean {
```

with:

```ts
export function beginSpecial(f: FighterState, ctx: StateContext, slot: MoveSlot): boolean {
```

In `src/engine/states.ts`, replace:

```ts
interface Presses {
```

with:

```ts
export interface Presses {
```

In `src/engine/states.ts`, replace:

```ts
function presses(f: FighterState, intent: Intent, frame: number): Presses {
```

with:

```ts
export function presses(f: FighterState, intent: Intent, frame: number): Presses {
```

In `src/engine/states.ts`, replace:

```ts
function airJump(f: FighterState, ctx: StateContext): boolean {
```

with:

```ts
export function airJump(f: FighterState, ctx: StateContext): boolean {
```

In `src/engine/states.ts`, replace:

```ts
function startAirDodge(f: FighterState, intent: Intent): boolean {
```

with:

```ts
export function startAirDodge(f: FighterState, intent: Intent): boolean {
```

In `src/engine/states.ts`, replace:

```ts
function handleActionable(f: FighterState, intent: Intent, ctx: StateContext): boolean {
```

with:

```ts
export function handleActionable(f: FighterState, intent: Intent, ctx: StateContext): boolean {
```

In `src/engine/states.ts`, replace:

```ts
function finishLedgeOption(f: FighterState, ctx: StateContext): void {
```

with:

```ts
export function finishLedgeOption(f: FighterState, ctx: StateContext): void {
```

In `src/engine/states.ts`, replace:

```ts
export function advanceFighter(f: FighterState, intent: Intent, ctx: StateContext): void {
  f.actionFrame += 1;
  updateDodgeIntangibility(f);

  switch (f.action) {
```

with:

```ts
export function advanceFighter(f: FighterState, intent: Intent, ctx: StateContext): void {
  f.actionFrame += 1;
  updateDodgeIntangibility(f);

  const status = STATUS_TABLE[f.action];
  if (status !== undefined) {
    status.main(f, intent, ctx);
    return;
  }

  // Legacy switch: each status group leaves it as it moves to `status/`.
  switch (f.action) {
```

In `src/engine/states.ts`, replace:

```ts
  const type = KINETIC_TYPE_OF_ACTION[f.action];
```

with:

```ts
  const type = STATUS_TABLE[f.action]?.kineticType ?? KINETIC_TYPE_OF_ACTION[f.action];
```

In `src/engine/states.ts`, replace:

```ts
    holdVertical: f.action === "airDodge" && w !== null && f.actionFrame <= w[1],
  });
}
```

with:

```ts
    holdVertical: f.action === "airDodge" && w !== null && f.actionFrame <= w[1],
  });
  STATUS_TABLE[f.action]?.exec?.(f, intent, ctx);
}
```

In `src/engine/states.ts`, replace:

```ts
import { fighterParams } from "./params";
```

with:

```ts
import { fighterParams } from "./params";
import { STATUS_TABLE, changeStatus } from "./status/kind";
```

In `src/engine/simulate.ts`, replace:

```ts
import { emptyEvents } from "./types";
```

with:

```ts
import "./status";
import { emptyEvents } from "./types";
```

- [ ] **Step 4: Run it again**

Run: `pnpm vitest run src/engine/status/status.test.ts`
Expected: PASS.

- [ ] **Step 5: The golden trace must not move**

Run: `pnpm vitest run src/game/golden.test.ts`
Expected: PASS, unchanged. This task is a refactor: a divergence here is a bug in this task, not a fixture to regenerate.

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0. `pnpm lint` reports no errors and no warning in a file this task touched; any warnings it printed before this plan started (measure once, with Plan 1 merged, before Task 0) are unchanged.

- [ ] **Step 7: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/src/engine/simulate.ts \
  super-smash/src/engine/states.ts \
  super-smash/src/engine/status/index.ts \
  super-smash/src/engine/status/kind.ts \
  super-smash/src/engine/status/status.test.ts
git commit -m "super-smash: StatusModule core — FIGHTER_STATUS_KIND aliases, change_status, registry" -m "Every status change now runs end then pre through changeStatus. advanceFighter dispatches to registered status objects before the legacy switch. No status is registered yet." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Statuses, group 1: ENTRY, DEAD, REBIRTH, DAMAGE, DAMAGE_FLY, DOWN_WAIT, DOWN_STAND

Migrate the first seven statuses out of the switch, moving each `main` verbatim. REBIRTH's entry grant moves into its `pre`, where the game keeps status set-up. `groups.test.ts` pins which actions have migrated (each later group task extends `MIGRATED` first — that is its failing test) and that each declares the alias table's kind and the legacy kinetic type. Review Focus #2 gets its test: a status changed by a hit during hitlag is entered once and runs none of its `main` while frozen.

**Files:**
- Create: `super-smash/src/engine/status/damage.ts`
- Create: `super-smash/src/engine/status/groups.test.ts`
- Create: `super-smash/src/engine/status/meta.ts`
- Modify: `super-smash/src/engine/simulate.test.ts` — `"shields"`
- Modify: `super-smash/src/engine/states.test.ts` — imports
- Modify: `super-smash/src/engine/states.ts` — the legacy `advanceFighter` switch, imports
- Modify: `super-smash/src/engine/status/index.ts` — `ALL_STATUSES`

**Interfaces:** Produces `META_STATUSES` (`status/meta.ts`: `STATUS_ENTRY`, `STATUS_DEAD`, `STATUS_REBIRTH`) and `DAMAGE_STATUSES` (`status/damage.ts`: `STATUS_DAMAGE`, `STATUS_DAMAGE_FLY`, `STATUS_DOWN_WAIT`, `STATUS_DOWN_STAND`), all `FighterStatus`. Consumes `startAction`, `bufferPress`, `respawnInvincibilityFrames`, `DEAD_FRAMES`, `ENTRY_FRAMES`, `DOWNED_FRAMES`, `GETUP_FRAMES` (`states.ts`).

- [ ] **Step 1: Write the failing test**

Create `src/engine/status/groups.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { RESPAWN_INVINCIBILITY_MAX } from "../constants";
import { fx } from "../fixed";
import { KINETIC_TYPE_OF_ACTION, emptyKinetic } from "../kinetic";
import type { FighterState } from "../types";
import { ALL_STATUSES } from "./index";
import { STATUS_KIND_OF_ACTION, STATUS_TABLE, changeStatus } from "./kind";

function fighter(over: Partial<FighterState> = {}): FighterState {
  return {
    port: 0,
    defId: "t",
    costume: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    facing: 1,
    grounded: true,
    platform: 0,
    action: "stand",
    actionFrame: 0,
    move: null,
    charge: 0,
    damage: 0,
    stocks: 3,
    jumpsUsed: 0,
    airDodged: false,
    fastFalling: false,
    shortHop: false,
    shieldHealth: fx(50),
    hitstun: 0,
    hitlag: 0,
    launchSpeed: 0,
    pendingKnockback: 0,
    pendingAngle: 0,
    pendingFacing: 0,
    balloon: false,
    intangible: 0,
    invincible: 0,
    grabbedBy: -1,
    grabbing: -1,
    grabTimer: 0,
    ledge: null,
    ledgeRegrabs: 0,
    airTime: 0,
    finalSmashReady: 0,
    staleQueue: [],
    hitThisMove: [],
    framesSinceDirPress: 999,
    lastDirPressed: 0,
    bufferedAction: null,
    kinetic: emptyKinetic(),
    ...over,
  };
}

/** Every action migrated so far; each status-group task extends this list first. */
const MIGRATED = [
  // Task 6
  "entering",
  "dead",
  "respawnPlatform",
  "hitstun",
  "tumble",
  "downed",
  "getUp",
];

describe("migrated statuses", () => {
  it("are exactly the groups migrated so far", () => {
    expect(ALL_STATUSES.map((s) => s.action).sort()).toEqual([...MIGRATED].sort());
  });

  it("are registered under their own action", () => {
    for (const s of ALL_STATUSES) expect(STATUS_TABLE[s.action]).toBe(s);
  });

  it("carry the SSBU kind the alias table names, and the legacy kinetic type", () => {
    for (const s of ALL_STATUSES) {
      expect(s.kind, s.action).toBe(STATUS_KIND_OF_ACTION[s.action]);
      expect(s.kineticType, s.action).toBe(KINETIC_TYPE_OF_ACTION[s.action]);
    }
  });

  it("are each registered once", () => {
    const actions = ALL_STATUSES.map((s) => s.action);
    expect(new Set(actions).size).toBe(actions.length);
  });
});

describe("REBIRTH", () => {
  it("grants the full respawn invincibility on entry, in pre", () => {
    const f = fighter({ action: "dead", invincible: 0 });
    changeStatus(f, "respawnPlatform");
    expect(f.invincible).toBe(RESPAWN_INVINCIBILITY_MAX);
  });
});
```

In `src/engine/simulate.test.ts`, replace:

```ts
describe("shields", () => {
```

with:

```ts
describe("a status change during hitlag (Review Focus #2)", () => {
  it("enters the reeling status once and runs none of it while frozen", () => {
    let s = standing();
    let prev: readonly InputFrame[] = [0, 0];
    let atContact = -1;
    let frozen = 0;
    for (let i = 0; i < 14; i++) {
      const inputs = i === 0 ? [Btn.Attack, 0] : [0, 0];
      s = step(s, inputs, { prevInputs: prev, ctx: CTX }).state;
      prev = inputs;
      const v = s.fighters[1];
      if (v.hitlag > 0) {
        if (atContact < 0) atContact = v.hitstun;
        // Frozen: the status was changed by the hit, and its main has not run.
        expect(["hitstun", "tumble"]).toContain(v.action);
        expect(v.actionFrame).toBe(0);
        expect(v.hitstun).toBe(atContact);
        frozen += 1;
      }
    }
    expect(frozen).toBeGreaterThan(1);
  });
});

describe("shields", () => {
```

In `src/engine/states.test.ts`, replace:

```ts
import { emptyKinetic } from "./kinetic";
```

with:

```ts
import { emptyKinetic } from "./kinetic";
import "./status";
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/engine/simulate.test.ts src/engine/states.test.ts src/engine/status/groups.test.ts`
Expected: FAIL — `groups.test.ts`: `ALL_STATUSES` is empty, so "are exactly the groups migrated so far" and the REBIRTH `pre` test fail. The hitlag test already passes: it pins behaviour the migration must keep.

- [ ] **Step 3: Implement**

Create `src/engine/status/meta.ts`:

```ts
/**
 * Meta statuses: ENTRY, DEAD, REBIRTH (Plan 2, Task 6).
 *
 * `main` bodies are the legacy `advanceFighter` cases, moved verbatim.
 * REBIRTH's entry grant moved from DEAD's `main` into REBIRTH's `pre`, where
 * the game keeps status set-up.
 */

import { RESPAWN_INVINCIBILITY_MAX, RESPAWN_PLATFORM_FRAMES } from "../constants";
import { kineticClear } from "../kinetic";
import { DEAD_FRAMES, ENTRY_FRAMES, respawnInvincibilityFrames, startAction } from "../states";
import type { FighterStatus } from "./kind";

export const STATUS_ENTRY: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_ENTRY",
  action: "entering",
  kineticType: "FALL",
  main(f) {
    if (f.actionFrame >= ENTRY_FRAMES) startAction(f, f.grounded ? "stand" : "fall");
  },
};

export const STATUS_DEAD: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_DEAD",
  action: "dead",
  kineticType: "NONE",
  main(f, _intent, ctx) {
    // Out of stocks is a terminal state: no respawn, and the match-end check
    // in `step` reads it rather than a separate "eliminated" flag.
    if (f.stocks <= 0) return;
    if (f.actionFrame >= DEAD_FRAMES) {
      const spawns = ctx.stage.spawns;
      const spawn = spawns[f.port % spawns.length];
      f.x = spawn.x;
      f.y = spawn.y;
      kineticClear(f);
      f.grounded = false;
      f.platform = -1;
      f.jumpsUsed = 0;
      f.airDodged = false;
      f.shortHop = false;
      f.ledgeRegrabs = 0;
      startAction(f, "respawnPlatform");
    }
  },
};

export const STATUS_REBIRTH: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_REBIRTH",
  action: "respawnPlatform",
  kineticType: "NONE",
  pre(f) {
    // Covers the transition frame; the platform then holds it up itself and
    // the departure grant replaces it on the way out.
    f.invincible = RESPAWN_INVINCIBILITY_MAX;
  },
  main(f, intent) {
    const leaving =
      f.actionFrame >= RESPAWN_PLATFORM_FRAMES ||
      intent.jumpPressed ||
      intent.attackPressed ||
      intent.x !== 0 ||
      intent.y !== 0;
    if (leaving) {
      // The grant is decided on the way *out*, from how long the fighter
      // stayed: a player who drops straight back in is protected while they
      // re-enter, and one who waits out the platform's 300 frames gets 60.
      f.invincible = respawnInvincibilityFrames(f.actionFrame);
      startAction(f, "fall");
      return;
    }
    // Held up a frame at a time (as the dodge windows are) rather than
    // counted down from one, because the platform outlasts any grant.
    f.invincible = Math.max(f.invincible, 1);
  },
};

export const META_STATUSES: readonly FighterStatus[] = [STATUS_ENTRY, STATUS_DEAD, STATUS_REBIRTH];
```

Create `src/engine/status/damage.ts`:

```ts
/**
 * Reeling statuses: DAMAGE, DAMAGE_FLY, DOWN_WAIT, DOWN_STAND (Plan 2, Task 6).
 *
 * `main` bodies are the legacy `advanceFighter` cases, moved verbatim.
 */

import { TUMBLE_HITSTUN } from "../constants";
import { DOWNED_FRAMES, GETUP_FRAMES, bufferPress, startAction } from "../states";
import type { Intent, StateContext } from "../states";
import type { FighterState } from "../types";
import type { FighterStatus } from "./kind";

/** Shared by DAMAGE and DAMAGE_FLY: tumble is hitstun past 32 frames, not a different thing. */
function reelMain(f: FighterState, intent: Intent, ctx: StateContext): void {
  if (f.hitstun > 0) {
    if (f.hitstun >= TUMBLE_HITSTUN && f.action !== "tumble") startAction(f, "tumble");
    bufferPress(f, intent, ctx.frame);
    return;
  }
  startAction(f, f.grounded ? "stand" : "fall");
}

export const STATUS_DAMAGE: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_DAMAGE",
  action: "hitstun",
  kineticType: "GROUND_STOP",
  main: reelMain,
};

export const STATUS_DAMAGE_FLY: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_DAMAGE_FLY",
  action: "tumble",
  kineticType: "GROUND_STOP",
  main: reelMain,
};

export const STATUS_DOWN_WAIT: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_DOWN_WAIT",
  action: "downed",
  kineticType: "GROUND_STOP",
  main(f, intent, ctx) {
    if (f.actionFrame >= DOWNED_FRAMES) startAction(f, "getUp");
    else bufferPress(f, intent, ctx.frame);
  },
};

export const STATUS_DOWN_STAND: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_DOWN_STAND",
  action: "getUp",
  kineticType: "GROUND_STOP",
  main(f, intent, ctx) {
    if (f.actionFrame >= GETUP_FRAMES) startAction(f, "stand");
    else bufferPress(f, intent, ctx.frame);
  },
};

export const DAMAGE_STATUSES: readonly FighterStatus[] = [
  STATUS_DAMAGE,
  STATUS_DAMAGE_FLY,
  STATUS_DOWN_WAIT,
  STATUS_DOWN_STAND,
];
```

In `src/engine/states.ts`, delete:

```ts
    /* ---------------------------------------------------------- reeling -- */
    case "hitstun":
    case "tumble": {
      if (f.hitstun > 0) {
        // Tumble is not a different kind of hitstun, it is hitstun past 32
        // frames — the point at which the victim stops being able to land and
        // instantly act, and starts having to survive.
        if (f.hitstun >= TUMBLE_HITSTUN && f.action !== "tumble") startAction(f, "tumble");
        bufferPress(f, intent, ctx.frame);
        return;
      }
      startAction(f, f.grounded ? "stand" : "fall");
      return;
    }

    case "downed": {
      if (f.actionFrame >= DOWNED_FRAMES) startAction(f, "getUp");
      else bufferPress(f, intent, ctx.frame);
      return;
    }

    case "getUp": {
      if (f.actionFrame >= GETUP_FRAMES) startAction(f, "stand");
      else bufferPress(f, intent, ctx.frame);
      return;
    }

    /* ------------------------------------------------------------ meta -- */
    case "entering": {
      if (f.actionFrame >= ENTRY_FRAMES) startAction(f, f.grounded ? "stand" : "fall");
      return;
    }

    case "dead": {
      // Out of stocks is a terminal state: no respawn, and the match-end check
      // in `step` reads it rather than a separate "eliminated" flag.
      if (f.stocks <= 0) return;
      if (f.actionFrame >= DEAD_FRAMES) {
        const spawns = ctx.stage.spawns;
        const spawn = spawns[f.port % spawns.length];
        f.x = spawn.x;
        f.y = spawn.y;
        kineticClear(f);
        f.grounded = false;
        f.platform = -1;
        f.jumpsUsed = 0;
        f.airDodged = false;
        f.shortHop = false;
        f.ledgeRegrabs = 0;
        startAction(f, "respawnPlatform");
        // Covers the transition frame; the platform then holds it up itself and
        // the departure grant replaces it on the way out.
        f.invincible = RESPAWN_INVINCIBILITY_MAX;
      }
      return;
    }

    case "respawnPlatform": {
      const leaving =
        f.actionFrame >= RESPAWN_PLATFORM_FRAMES ||
        intent.jumpPressed ||
        intent.attackPressed ||
        intent.x !== 0 ||
        intent.y !== 0;
      if (leaving) {
        // The grant is decided on the way *out*, from how long the fighter
        // stayed, which is the whole point of it: a player who drops straight
        // back into the fight is protected while they re-enter, and one who
        // waits out the platform's 300 frames gets the 60-frame floor.
        f.invincible = respawnInvincibilityFrames(f.actionFrame);
        startAction(f, "fall");
        return;
      }
      // Standing on the platform is safe for as long as the platform lasts,
      // which is longer than any departure grant — so it is held up a frame at
      // a time (as the dodge windows are) rather than counted down from one.
      f.invincible = Math.max(f.invincible, 1);
      return;
    }

```

In `src/engine/states.ts`, replace:

```ts
  TUMBLE_HITSTUN,
} from "./constants";
```

with:

```ts
} from "./constants";
```

In `src/engine/status/index.ts`, replace:

```ts
import { registerStatus } from "./kind";
import type { FighterStatus } from "./kind";

export const ALL_STATUSES: readonly FighterStatus[] = [];
```

with:

```ts
import { DAMAGE_STATUSES } from "./damage";
import { registerStatus } from "./kind";
import type { FighterStatus } from "./kind";
import { META_STATUSES } from "./meta";

export const ALL_STATUSES: readonly FighterStatus[] = [
  ...META_STATUSES,
  ...DAMAGE_STATUSES,
];
```

- [ ] **Step 4: Run it again**

Run: `pnpm vitest run src/engine/simulate.test.ts src/engine/states.test.ts src/engine/status/groups.test.ts`
Expected: PASS.

- [ ] **Step 5: The golden trace must not move**

Run: `pnpm vitest run src/game/golden.test.ts`
Expected: PASS, unchanged. This task is a refactor: a divergence here is a bug in this task, not a fixture to regenerate.

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0. `pnpm lint` reports no errors and no warning in a file this task touched; any warnings it printed before this plan started (measure once, with Plan 1 merged, before Task 0) are unchanged.

- [ ] **Step 7: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/src/engine/simulate.test.ts \
  super-smash/src/engine/states.test.ts \
  super-smash/src/engine/states.ts \
  super-smash/src/engine/status/damage.ts \
  super-smash/src/engine/status/groups.test.ts \
  super-smash/src/engine/status/index.ts \
  super-smash/src/engine/status/meta.ts
git commit -m "super-smash: statuses group 1 — ENTRY, DEAD, REBIRTH, DAMAGE, DAMAGE_FLY, DOWN_WAIT, DOWN_STAND" -m "Moved verbatim out of the advanceFighter switch. REBIRTH's entry invincibility is now its pre. A hitlag test pins that a status changed during the freeze runs none of its main until the freeze ends." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Statuses, group 2: GUARD_ON, GUARD, GUARD_OFF, GUARD_DAMAGE, FURAFURA, ESCAPE, ESCAPE_F, ESCAPE_AIR

Second group, verbatim. The roll's stop stays in ESCAPE_F's `main`, deliberately not in its `end`: `end` also runs when a hit interrupts the roll and would zero `vx` during the victim's hitlag — invisible on screen, but the CPU reads `vx`, and the golden trace diverges within 200 frames. The comment in `guard.ts` says so.

**Files:**
- Create: `super-smash/src/engine/status/guard.ts`
- Modify: `super-smash/src/engine/states.ts` — the legacy `advanceFighter` switch
- Modify: `super-smash/src/engine/status/groups.test.ts`
- Modify: `super-smash/src/engine/status/index.ts` — imports

**Interfaces:** Produces `GUARD_STATUSES` (`status/guard.ts`: `STATUS_GUARD_ON`, `STATUS_GUARD`, `STATUS_GUARD_OFF`, `STATUS_GUARD_DAMAGE`, `STATUS_FURAFURA`, `STATUS_ESCAPE`, `STATUS_ESCAPE_F`, `STATUS_ESCAPE_AIR`).

- [ ] **Step 1: Write the failing test**

In `src/engine/status/groups.test.ts`, replace:

```ts
  "getUp",
];
```

with:

```ts
  "getUp",
  // Task 7
  "shieldStart",
  "shield",
  "shieldRelease",
  "shieldStun",
  "shieldBroken",
  "spotDodge",
  "roll",
  "airDodge",
];
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/engine/status/groups.test.ts`
Expected: FAIL — "are exactly the groups migrated so far" (the eight guard actions are listed but not registered).

- [ ] **Step 3: Implement**

Create `src/engine/status/guard.ts`:

```ts
/**
 * Guard and escape statuses: GUARD_ON, GUARD, GUARD_OFF, GUARD_DAMAGE,
 * FURAFURA, ESCAPE, ESCAPE_F, ESCAPE_AIR (Plan 2, Task 7).
 *
 * `main` bodies are the legacy `advanceFighter` cases, moved verbatim.
 *
 * The roll's stop stays in `main` rather than moving to ESCAPE_F's `end`, on
 * purpose: `end` also runs when a hit interrupts the roll, which would zero
 * `vx` during the victim's hitlag. Nothing moves while frozen, but the CPU
 * reads `vx`, and the golden trace catches the difference.
 */

import {
  AIR_DODGE_FRAMES,
  DIRECTIONAL_AIR_DODGE_FRAMES,
  ROLL_FRAMES,
  SHIELD_MIN_HOLD,
  SHIELD_RELEASE_FRAMES,
  SPOT_DODGE_FRAMES,
} from "../constants";
import { kineticSetX } from "../kinetic";
import {
  ROLL_DISTANCE,
  SHIELD_START_FRAMES,
  bufferPress,
  hasMove,
  presses,
  startAction,
  startMove,
} from "../states";
import type { FighterStatus } from "./kind";

export const STATUS_GUARD_ON: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_GUARD_ON",
  action: "shieldStart",
  kineticType: "GROUND_STOP",
  main(f) {
    if (f.actionFrame >= SHIELD_START_FRAMES) startAction(f, "shield");
  },
};

export const STATUS_GUARD: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_GUARD",
  action: "shield",
  kineticType: "GROUND_STOP",
  main(f, intent, ctx) {
    // The shield may not be dropped for its first 3 frames, which is what
    // makes a perfect shield a commitment rather than something you mash.
    if (!intent.shieldHeld && f.actionFrame >= SHIELD_MIN_HOLD) {
      startAction(f, "shieldRelease");
      return;
    }
    const p = presses(f, intent, ctx.frame);
    if (p.jump) {
      startAction(f, "jumpSquat");
      return;
    }
    if (p.grab) {
      startMove(f, "grab", "grab");
      return;
    }
    if (p.attack && hasMove(ctx, "usmash")) {
      startMove(f, "attack", "usmash");
      return;
    }
    if (intent.y < 0) {
      startAction(f, "spotDodge");
      return;
    }
    if (intent.x !== 0) {
      startAction(f, "roll");
      kineticSetX(f, intent.x * Math.trunc(ROLL_DISTANCE / ROLL_FRAMES), "stop");
    }
  },
};

export const STATUS_GUARD_OFF: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_GUARD_OFF",
  action: "shieldRelease",
  kineticType: "GROUND_STOP",
  main(f, intent, ctx) {
    if (f.actionFrame >= SHIELD_RELEASE_FRAMES) startAction(f, "stand");
    else bufferPress(f, intent, ctx.frame);
  },
};

export const STATUS_GUARD_DAMAGE: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_GUARD_DAMAGE",
  action: "shieldStun",
  kineticType: "GROUND_STOP",
  main(f, intent, ctx) {
    // Shieldstun reuses the `hitstun` counter: a shielding fighter is never
    // simultaneously in hitstun.
    if (f.hitstun > 0) {
      bufferPress(f, intent, ctx.frame);
      return;
    }
    startAction(f, intent.shieldHeld ? "shield" : "shieldRelease");
  },
};

export const STATUS_FURAFURA: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_FURAFURA",
  action: "shieldBroken",
  kineticType: "GROUND_STOP",
  main(f) {
    if (f.hitstun > 0) return;
    startAction(f, "stand");
  },
};

export const STATUS_ESCAPE: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_ESCAPE",
  action: "spotDodge",
  kineticType: "GROUND_STOP",
  main(f, intent, ctx) {
    if (f.actionFrame >= SPOT_DODGE_FRAMES) startAction(f, "stand");
    else bufferPress(f, intent, ctx.frame);
  },
};

export const STATUS_ESCAPE_F: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_ESCAPE_F",
  action: "roll",
  kineticType: "MOTION",
  main(f, intent, ctx) {
    if (f.actionFrame >= ROLL_FRAMES) {
      kineticSetX(f, 0, "stop");
      startAction(f, "stand");
    } else bufferPress(f, intent, ctx.frame);
  },
};

export const STATUS_ESCAPE_AIR: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_ESCAPE_AIR",
  action: "airDodge",
  kineticType: "AIR_ESCAPE",
  main(f, intent, ctx) {
    // `charge` remembers a directional dodge: 63 frames rather than 50.
    const total = f.charge === 1 ? DIRECTIONAL_AIR_DODGE_FRAMES : AIR_DODGE_FRAMES;
    if (f.actionFrame >= total) startAction(f, "fall");
    else bufferPress(f, intent, ctx.frame);
  },
};

export const GUARD_STATUSES: readonly FighterStatus[] = [
  STATUS_GUARD_ON,
  STATUS_GUARD,
  STATUS_GUARD_OFF,
  STATUS_GUARD_DAMAGE,
  STATUS_FURAFURA,
  STATUS_ESCAPE,
  STATUS_ESCAPE_F,
  STATUS_ESCAPE_AIR,
];
```

In `src/engine/states.ts`, delete the 83 lines from the line

```ts
    /* --------------------------------------------------------- defence -- */
```

(it occurs once in the file) up to, not including, the first line after it that reads exactly

```ts
    /* ---------------------------------------------------------- offence -- */
```


In `src/engine/status/index.ts`, replace:

```ts
import { DAMAGE_STATUSES } from "./damage";
```

with:

```ts
import { DAMAGE_STATUSES } from "./damage";
import { GUARD_STATUSES } from "./guard";
```

In `src/engine/status/index.ts`, replace:

```ts
  ...DAMAGE_STATUSES,
];
```

with:

```ts
  ...DAMAGE_STATUSES,
  ...GUARD_STATUSES,
];
```

In `src/engine/states.ts`, replace:

```ts

  AIR_DODGE_FRAMES,
```

with:

```ts

```

In `src/engine/states.ts`, replace:

```ts

  DIRECTIONAL_AIR_DODGE_FRAMES,
```

with:

```ts

```

In `src/engine/states.ts`, replace:

```ts

  ROLL_FRAMES,
```

with:

```ts

```

In `src/engine/states.ts`, replace:

```ts

  SHIELD_MIN_HOLD,
```

with:

```ts

```

In `src/engine/states.ts`, replace:

```ts

  SHIELD_RELEASE_FRAMES,
```

with:

```ts

```

In `src/engine/states.ts`, replace:

```ts

  SPOT_DODGE_FRAMES,
```

with:

```ts

```

- [ ] **Step 4: Run it again**

Run: `pnpm vitest run src/engine/status/groups.test.ts`
Expected: PASS.

- [ ] **Step 5: The golden trace must not move**

Run: `pnpm vitest run src/game/golden.test.ts`
Expected: PASS, unchanged. This task is a refactor: a divergence here is a bug in this task, not a fixture to regenerate.

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0. `pnpm lint` reports no errors and no warning in a file this task touched; any warnings it printed before this plan started (measure once, with Plan 1 merged, before Task 0) are unchanged.

- [ ] **Step 7: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/src/engine/states.ts \
  super-smash/src/engine/status/groups.test.ts \
  super-smash/src/engine/status/guard.ts \
  super-smash/src/engine/status/index.ts
git commit -m "super-smash: statuses group 2 — GUARD_ON, GUARD, GUARD_OFF, GUARD_DAMAGE, FURAFURA, ESCAPE, ESCAPE_F, ESCAPE_AIR" -m "Moved verbatim. The roll's stop stays in main: as an end hook it would also fire on a hit and zero vx during hitlag, which the CPU reads." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Statuses, group 3: ATTACK, SPECIAL, CATCH, CATCH_WAIT, CATCH_ATTACK, THROW, CAPTURE_WAIT, THROWN

Third group. The one-swing-one-hit record is now reset in the `pre` of every status that swings (ATTACK, SPECIAL, CATCH, CATCH_ATTACK, THROW), where the game resets its AttackModule; `startMove` keeps resetting it too, so an unregistered test fixture behaves the same.

**Files:**
- Create: `super-smash/src/engine/status/attack.ts`
- Modify: `super-smash/src/engine/states.ts` — the legacy `advanceFighter` switch
- Modify: `super-smash/src/engine/status/groups.test.ts`
- Modify: `super-smash/src/engine/status/index.ts` — imports

**Interfaces:** Produces `ATTACK_STATUSES` (`status/attack.ts`: `STATUS_ATTACK`, `STATUS_SPECIAL`, `STATUS_CATCH`, `STATUS_CATCH_WAIT`, `STATUS_CATCH_ATTACK`, `STATUS_THROW`, `STATUS_CAPTURE_WAIT`, `STATUS_THROWN`).

- [ ] **Step 1: Write the failing test**

In `src/engine/status/groups.test.ts`, replace:

```ts
  "airDodge",
];
```

with:

```ts
  "airDodge",
  // Task 8
  "attack",
  "special",
  "grab",
  "grabHold",
  "pummel",
  "throw",
  "grabbed",
  "thrown",
];
```

In `src/engine/status/groups.test.ts`, replace:

```ts
    expect(f.invincible).toBe(RESPAWN_INVINCIBILITY_MAX);
  });
});
```

with:

```ts
    expect(f.invincible).toBe(RESPAWN_INVINCIBILITY_MAX);
  });
});

describe("swinging statuses", () => {
  it.each(["attack", "special", "grab", "pummel", "throw"] as const)(
    "%s resets the one-swing-one-hit record in pre",
    (action) => {
      const f = fighter({ action: "stand", hitThisMove: [1, 8] });
      changeStatus(f, action);
      expect(f.hitThisMove).toEqual([]);
    },
  );

  it("leaves the record alone when the hold resumes after a pummel", () => {
    const f = fighter({ action: "pummel", hitThisMove: [1] });
    changeStatus(f, "grabHold");
    expect(f.hitThisMove).toEqual([1]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/engine/status/groups.test.ts`
Expected: FAIL — the migrated-list test, and the five "resets the one-swing-one-hit record in pre" cases.

- [ ] **Step 3: Implement**

Create `src/engine/status/attack.ts`:

```ts
/**
 * Attack and catch statuses: ATTACK, SPECIAL, CATCH, CATCH_WAIT,
 * CATCH_ATTACK, THROW, CAPTURE_WAIT, THROWN (Plan 2, Task 8).
 *
 * `main` bodies are the legacy `advanceFighter` cases, moved verbatim. The
 * one-swing-one-hit record (`hitThisMove`) is now reset in the `pre` of every
 * status that swings, which is where the game resets its AttackModule; it was
 * reset by `startMove`, the only way into these statuses, on the same frame.
 */

import { SMASH_CHARGE_MAX } from "../constants";
import { clearHitRecord } from "../hitbox";
import {
  GRAB_HOLD_FRAMES,
  PUMMEL_FRAMES,
  THROW_FRAMES,
  bufferPress,
  hasMove,
  presses,
  releaseGrab,
  startAction,
  startMove,
} from "../states";
import type { Intent, StateContext } from "../states";
import type { FighterState, MoveSlot } from "../types";
import type { FighterStatus } from "./kind";

function attackMain(f: FighterState, intent: Intent, ctx: StateContext): void {
  const move = f.move !== null ? ctx.def.moves[f.move] : undefined;
  if (move === undefined) {
    startAction(f, f.grounded ? "stand" : "fall");
    return;
  }
  // Charging a smash holds the animation one frame short of its first hitbox.
  if (move.chargeable && f.charge < SMASH_CHARGE_MAX && intent.attackHeld) {
    const holdFrame = Math.max(1, (move.hitboxes[0]?.startFrame ?? 1) - 1);
    if (f.actionFrame >= holdFrame) {
      f.actionFrame = holdFrame;
      f.charge += 1;
      return;
    }
  }
  if (move.followUp !== undefined && intent.attackPressed && f.actionFrame >= 3 && hasMove(ctx, move.followUp)) {
    startMove(f, "attack", move.followUp);
    return;
  }
  if (f.actionFrame >= move.totalFrames) {
    startAction(f, f.grounded ? "stand" : "fall");
    return;
  }
  bufferPress(f, intent, ctx.frame);
}

export const STATUS_ATTACK: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_ATTACK",
  action: "attack",
  kineticType: "FALL",
  pre: clearHitRecord,
  main: attackMain,
};

export const STATUS_SPECIAL: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_SPECIAL",
  action: "special",
  kineticType: "FALL",
  pre: clearHitRecord,
  main: attackMain,
};

export const STATUS_CATCH: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_CATCH",
  action: "grab",
  kineticType: "FALL",
  pre: clearHitRecord,
  main(f, intent, ctx) {
    if (f.grabbing >= 0) {
      startAction(f, "grabHold");
      f.grabTimer = GRAB_HOLD_FRAMES;
      return;
    }
    const move = f.move !== null ? ctx.def.moves[f.move] : undefined;
    if (f.actionFrame >= (move?.totalFrames ?? 30)) {
      startAction(f, f.grounded ? "stand" : "fall");
    } else bufferPress(f, intent, ctx.frame);
  },
};

export const STATUS_CATCH_WAIT: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_CATCH_WAIT",
  action: "grabHold",
  kineticType: "FALL",
  main(f, intent, ctx) {
    if (f.grabbing < 0) {
      releaseGrab(f, ctx.fighters);
      startAction(f, "stand");
      return;
    }
    f.grabTimer -= 1;
    if (f.grabTimer <= 0) {
      releaseGrab(f, ctx.fighters);
      startAction(f, "stand");
      return;
    }
    const p = presses(f, intent, ctx.frame);
    if (p.attack && hasMove(ctx, "pummel")) {
      startMove(f, "pummel", "pummel");
      return;
    }
    const throwSlot: MoveSlot | null =
      intent.y > 0
        ? "uthrow"
        : intent.y < 0
          ? "dthrow"
          : intent.x === f.facing
            ? "fthrow"
            : intent.x === -f.facing
              ? "bthrow"
              : null;
    if (throwSlot !== null && hasMove(ctx, throwSlot)) {
      startMove(f, "throw", throwSlot);
      // The victim is being carried now, not held.
      const carried = f.grabbing >= 0 ? ctx.fighters[f.grabbing] : undefined;
      if (carried !== undefined && carried.grabbedBy === f.port) startAction(carried, "thrown");
    }
  },
};

export const STATUS_CATCH_ATTACK: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_CATCH_ATTACK",
  action: "pummel",
  kineticType: "FALL",
  pre: clearHitRecord,
  main(f) {
    if (f.actionFrame >= PUMMEL_FRAMES) startAction(f, "grabHold");
  },
};

export const STATUS_THROW: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_THROW",
  action: "throw",
  kineticType: "FALL",
  pre: clearHitRecord,
  main(f, _intent, ctx) {
    const move = f.move !== null ? ctx.def.moves[f.move] : undefined;
    if (f.actionFrame >= (move?.totalFrames ?? THROW_FRAMES)) {
      // The animation finishing is the backstop: nobody is held once the
      // throw is over, even if its hitbox never connected.
      releaseGrab(f, ctx.fighters);
      startAction(f, f.grounded ? "stand" : "fall");
    }
  },
};

export const STATUS_CAPTURE_WAIT: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_CAPTURE_WAIT",
  action: "grabbed",
  kineticType: "GROUND_STOP",
  main(f) {
    if (f.grabbedBy < 0) startAction(f, f.grounded ? "stand" : "fall");
  },
};

export const STATUS_THROWN: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_THROWN",
  action: "thrown",
  kineticType: "GROUND_STOP",
  main(f) {
    // Still in the thrower's hands until the throw's hitbox connects.
    if (f.grabbedBy >= 0) return;
    if (f.hitstun <= 0) startAction(f, f.grounded ? "stand" : "fall");
  },
};

export const ATTACK_STATUSES: readonly FighterStatus[] = [
  STATUS_ATTACK,
  STATUS_SPECIAL,
  STATUS_CATCH,
  STATUS_CATCH_WAIT,
  STATUS_CATCH_ATTACK,
  STATUS_THROW,
  STATUS_CAPTURE_WAIT,
  STATUS_THROWN,
];
```

In `src/engine/states.ts`, delete the 123 lines from the line

```ts
    /* ---------------------------------------------------------- offence -- */
```

(it occurs once in the file) up to, not including, the first line after it that reads exactly

```ts
    /* ------------------------------------------------------------ ledge -- */
```


In `src/engine/status/index.ts`, replace:

```ts
import { DAMAGE_STATUSES } from "./damage";
```

with:

```ts
import { ATTACK_STATUSES } from "./attack";
import { DAMAGE_STATUSES } from "./damage";
```

In `src/engine/status/index.ts`, replace:

```ts
  ...GUARD_STATUSES,
];
```

with:

```ts
  ...GUARD_STATUSES,
  ...ATTACK_STATUSES,
];
```

- [ ] **Step 4: Run it again**

Run: `pnpm vitest run src/engine/status/groups.test.ts`
Expected: PASS.

- [ ] **Step 5: The golden trace must not move**

Run: `pnpm vitest run src/game/golden.test.ts`
Expected: PASS, unchanged. This task is a refactor: a divergence here is a bug in this task, not a fixture to regenerate.

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0. `pnpm lint` reports no errors and no warning in a file this task touched; any warnings it printed before this plan started (measure once, with Plan 1 merged, before Task 0) are unchanged.

- [ ] **Step 7: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/src/engine/states.ts \
  super-smash/src/engine/status/attack.ts \
  super-smash/src/engine/status/groups.test.ts \
  super-smash/src/engine/status/index.ts
git commit -m "super-smash: statuses group 3 — ATTACK, SPECIAL, CATCH, CATCH_WAIT, CATCH_ATTACK, THROW, CAPTURE_WAIT, THROWN" -m "Moved verbatim; the hit record is reset in each swinging status's pre." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Statuses, group 4: CLIFF_WAIT, CLIFF_CLIMB, CLIFF_ATTACK, CLIFF_ESCAPE, CLIFF_JUMP1

Fourth group, verbatim; the four ledge options share one `main` parameterised by length.

**Files:**
- Create: `super-smash/src/engine/status/cliff.ts`
- Modify: `super-smash/src/engine/states.ts` — the legacy `advanceFighter` switch
- Modify: `super-smash/src/engine/status/groups.test.ts`
- Modify: `super-smash/src/engine/status/index.ts` — imports

**Interfaces:** Produces `CLIFF_STATUSES` (`status/cliff.ts`: `STATUS_CLIFF_WAIT`, `STATUS_CLIFF_CLIMB`, `STATUS_CLIFF_ATTACK`, `STATUS_CLIFF_ESCAPE`, `STATUS_CLIFF_JUMP1`).

- [ ] **Step 1: Write the failing test**

In `src/engine/status/groups.test.ts`, replace:

```ts
  "thrown",
];
```

with:

```ts
  "thrown",
  // Task 9
  "ledgeHang",
  "ledgeGetUp",
  "ledgeAttack",
  "ledgeRoll",
  "ledgeJump",
];
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/engine/status/groups.test.ts`
Expected: FAIL — the migrated-list test.

- [ ] **Step 3: Implement**

Create `src/engine/status/cliff.ts`:

```ts
/**
 * Ledge statuses: CLIFF_WAIT, CLIFF_CLIMB, CLIFF_ATTACK, CLIFF_ESCAPE,
 * CLIFF_JUMP1 (Plan 2, Task 9).
 *
 * `main` bodies are the legacy `advanceFighter` cases, moved verbatim. The
 * four ledge options share one `main`, parameterised by their length, as the
 * legacy switch did.
 */

import { LEDGE_REGRAB_LIMIT } from "../constants";
import {
  LEDGE_ATTACK_FRAMES,
  LEDGE_GETUP_FRAMES,
  LEDGE_HANG_MIN,
  LEDGE_JUMP_FRAMES,
  LEDGE_ROLL_FRAMES,
  bufferPress,
  finishLedgeOption,
  presses,
  startAction,
} from "../states";
import type { Intent, StateContext } from "../states";
import type { FighterState } from "../types";
import type { FighterStatus } from "./kind";

export const STATUS_CLIFF_WAIT: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_CLIFF_WAIT",
  action: "ledgeHang",
  kineticType: "GROUND_STOP",
  main(f, intent, ctx) {
    if (f.actionFrame < LEDGE_HANG_MIN) return;
    const p = presses(f, intent, ctx.frame);
    const inward = f.ledge !== null ? -f.ledge.side : f.facing;
    if (p.jump) {
      startAction(f, "ledgeJump");
      return;
    }
    if (p.attack) {
      startAction(f, "ledgeAttack");
      return;
    }
    if (intent.shieldHeld) {
      startAction(f, "ledgeRoll");
      return;
    }
    if (intent.y > 0 || intent.x === inward) {
      startAction(f, "ledgeGetUp");
      return;
    }
    if (intent.y < 0 || intent.x === -inward) {
      f.ledge = null;
      f.intangible = 0;
      startAction(f, "fall");
      return;
    }
    // Six grabs and the game stops letting you hang.
    if (f.ledgeRegrabs > LEDGE_REGRAB_LIMIT) startAction(f, "ledgeGetUp");
  },
};

function ledgeOption(total: number) {
  return (f: FighterState, intent: Intent, ctx: StateContext): void => {
    if (f.actionFrame < total) {
      bufferPress(f, intent, ctx.frame);
      return;
    }
    finishLedgeOption(f, ctx);
  };
}

export const STATUS_CLIFF_CLIMB: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_CLIFF_CLIMB",
  action: "ledgeGetUp",
  kineticType: "GROUND_STOP",
  main: ledgeOption(LEDGE_GETUP_FRAMES),
};

export const STATUS_CLIFF_ATTACK: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_CLIFF_ATTACK",
  action: "ledgeAttack",
  kineticType: "GROUND_STOP",
  main: ledgeOption(LEDGE_ATTACK_FRAMES),
};

export const STATUS_CLIFF_ESCAPE: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_CLIFF_ESCAPE",
  action: "ledgeRoll",
  kineticType: "GROUND_STOP",
  main: ledgeOption(LEDGE_ROLL_FRAMES),
};

export const STATUS_CLIFF_JUMP1: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_CLIFF_JUMP1",
  action: "ledgeJump",
  kineticType: "GROUND_STOP",
  main: ledgeOption(LEDGE_JUMP_FRAMES),
};

export const CLIFF_STATUSES: readonly FighterStatus[] = [
  STATUS_CLIFF_WAIT,
  STATUS_CLIFF_CLIMB,
  STATUS_CLIFF_ATTACK,
  STATUS_CLIFF_ESCAPE,
  STATUS_CLIFF_JUMP1,
];
```

In `src/engine/states.ts`, delete:

```ts
    /* ------------------------------------------------------------ ledge -- */
    case "ledgeHang": {
      if (f.actionFrame < LEDGE_HANG_MIN) return;
      const p = presses(f, intent, ctx.frame);
      const inward = f.ledge !== null ? -f.ledge.side : f.facing;
      if (p.jump) {
        startAction(f, "ledgeJump");
        return;
      }
      if (p.attack) {
        startAction(f, "ledgeAttack");
        return;
      }
      if (intent.shieldHeld) {
        startAction(f, "ledgeRoll");
        return;
      }
      if (intent.y > 0 || intent.x === inward) {
        startAction(f, "ledgeGetUp");
        return;
      }
      if (intent.y < 0 || intent.x === -inward) {
        f.ledge = null;
        f.intangible = 0;
        startAction(f, "fall");
        return;
      }
      // Six grabs and the game stops letting you hang: you get up whether you
      // like it or not, which is what makes ledge-stalling a losing plan.
      if (f.ledgeRegrabs > LEDGE_REGRAB_LIMIT) startAction(f, "ledgeGetUp");
      return;
    }

    case "ledgeGetUp":
    case "ledgeAttack":
    case "ledgeRoll":
    case "ledgeJump": {
      const total =
        f.action === "ledgeGetUp"
          ? LEDGE_GETUP_FRAMES
          : f.action === "ledgeAttack"
            ? LEDGE_ATTACK_FRAMES
            : f.action === "ledgeRoll"
              ? LEDGE_ROLL_FRAMES
              : LEDGE_JUMP_FRAMES;
      if (f.actionFrame < total) {
        bufferPress(f, intent, ctx.frame);
        return;
      }
      finishLedgeOption(f, ctx);
      return;
    }

```

In `src/engine/states.ts`, replace:

```ts

  LEDGE_REGRAB_LIMIT,
```

with:

```ts

```

In `src/engine/status/index.ts`, replace:

```ts
import { ATTACK_STATUSES } from "./attack";
```

with:

```ts
import { ATTACK_STATUSES } from "./attack";
import { CLIFF_STATUSES } from "./cliff";
```

In `src/engine/status/index.ts`, replace:

```ts
  ...ATTACK_STATUSES,
];
```

with:

```ts
  ...ATTACK_STATUSES,
  ...CLIFF_STATUSES,
];
```

- [ ] **Step 4: Run it again**

Run: `pnpm vitest run src/engine/status/groups.test.ts`
Expected: PASS.

- [ ] **Step 5: The golden trace must not move**

Run: `pnpm vitest run src/game/golden.test.ts`
Expected: PASS, unchanged. This task is a refactor: a divergence here is a bug in this task, not a fixture to regenerate.

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0. `pnpm lint` reports no errors and no warning in a file this task touched; any warnings it printed before this plan started (measure once, with Plan 1 merged, before Task 0) are unchanged.

- [ ] **Step 7: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/src/engine/states.ts \
  super-smash/src/engine/status/cliff.ts \
  super-smash/src/engine/status/groups.test.ts \
  super-smash/src/engine/status/index.ts
git commit -m "super-smash: statuses group 4 — CLIFF_WAIT, CLIFF_CLIMB, CLIFF_ATTACK, CLIFF_ESCAPE, CLIFF_JUMP1" -m "Moved verbatim." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Statuses, group 5: WAIT, WALK, DASH, RUN, RUN_BRAKE, TURN_RUN, SQUAT, SQUAT_WAIT, SQUAT_RV

Fifth group, verbatim; WAIT/WALK/DASH/RUN share one `main` as they shared one case. Plan 1's `Btn.Soft` reaches this code through `intent.wantsDash` and needs nothing new here.

**Files:**
- Create: `super-smash/src/engine/status/ground.ts`
- Modify: `super-smash/src/engine/states.ts` — the legacy `advanceFighter` switch
- Modify: `super-smash/src/engine/status/groups.test.ts`
- Modify: `super-smash/src/engine/status/index.ts` — imports

**Interfaces:** Produces `GROUND_STATUSES` (`status/ground.ts`: `STATUS_WAIT`, `STATUS_WALK`, `STATUS_DASH`, `STATUS_RUN`, `STATUS_RUN_BRAKE`, `STATUS_TURN_RUN`, `STATUS_SQUAT`, `STATUS_SQUAT_WAIT`, `STATUS_SQUAT_RV`).

- [ ] **Step 1: Write the failing test**

In `src/engine/status/groups.test.ts`, replace:

```ts
  "ledgeJump",
];
```

with:

```ts
  "ledgeJump",
  // Task 10
  "stand",
  "walk",
  "dashStart",
  "run",
  "runBrake",
  "turnaround",
  "crouchStart",
  "crouch",
  "crouchEnd",
];
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/engine/status/groups.test.ts`
Expected: FAIL — the migrated-list test.

- [ ] **Step 3: Implement**

Create `src/engine/status/ground.ts`:

```ts
/**
 * Grounded neutral statuses: WAIT, WALK, DASH, RUN, RUN_BRAKE, TURN_RUN,
 * SQUAT, SQUAT_WAIT, SQUAT_RV (Plan 2, Task 10).
 *
 * `main` bodies are the legacy `advanceFighter` cases, moved verbatim. WAIT,
 * WALK, DASH and RUN share one `main`, as they shared one case: the
 * walk/dash/run ladder is a single decision read from the same input.
 */

import { DASH_INTERRUPT_FRAME } from "../constants";
import {
  CROUCH_END_FRAMES,
  CROUCH_START_FRAMES,
  RUN_BRAKE_FRAMES,
  TURNAROUND_FRAMES,
  handleActionable,
  startAction,
} from "../states";
import type { Intent, StateContext } from "../states";
import type { FighterState } from "../types";
import type { FighterStatus } from "./kind";

function groundMain(f: FighterState, intent: Intent, ctx: StateContext): void {
  if (!f.grounded) {
    startAction(f, "fall");
    return;
  }
  if (handleActionable(f, intent, ctx)) return;
  if (intent.y < 0 && f.action === "stand") {
    startAction(f, "crouchStart");
    return;
  }
  if (intent.x === 0) {
    if (f.action === "run") startAction(f, "runBrake");
    else if (f.action !== "stand") startAction(f, "stand");
    return;
  }
  if (intent.x !== f.facing) {
    f.facing = intent.x;
    // Reversing out of a run costs a turnaround; reversing out of an initial
    // dash does not, and that asymmetry is exactly what dash-dancing is.
    if (f.action === "run") {
      startAction(f, "turnaround");
      return;
    }
    if (f.action === "dashStart") {
      startAction(f, "dashStart");
      return;
    }
    // From a standstill or a walk, though, a reversal is just a fresh
    // direction press and takes the same walk-then-dash path as any other,
    // below. Committing it to `dashStart` here instead would hand a
    // one-frame tap the full initial-dash burst — around 19 units of slide
    // for Mario, a quarter of Battlefield — and there would be no way at all
    // to make a small movement away from the way you happen to be facing.
  }
  if (f.action === "dashStart") {
    if (f.actionFrame >= DASH_INTERRUPT_FRAME) startAction(f, "run");
    return;
  }
  if (f.action === "run") return;
  /*
   * Held three frames or less is a walk; past that it becomes a dash.
   *
   * This reads oddly against SPEC §6 — if any sustained hold becomes a dash,
   * when does anybody walk? — and the answer is that they do not, and should
   * not. **A key is always a full deflection.** In Ultimate a fully deflected
   * stick dashes and then runs; walking requires a *partial* tilt, which is a
   * distinction a keyboard has no way to express at all (a gamepad's partial
   * tilt arrives as `Btn.Soft`, Plan 1, and clears `wantsDash`). So "hold =
   * dash" is the faithful translation of a held key, not a missing feature.
   *
   * What the window buys is the other half of the analog stick's range. The
   * brief step before the dash commits is what a tap produces, and a tap is
   * therefore the keyboard's micro-spacing tool.
   *
   * Do not "fix" this by inverting it.
   */
  if (intent.wantsDash) startAction(f, "dashStart");
  else if (f.action !== "walk") startAction(f, "walk");
}

export const STATUS_WAIT: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_WAIT",
  action: "stand",
  kineticType: "GROUND_STOP",
  main: groundMain,
};

export const STATUS_WALK: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_WALK",
  action: "walk",
  kineticType: "WALK",
  main: groundMain,
};

export const STATUS_DASH: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_DASH",
  action: "dashStart",
  kineticType: "DASH",
  main: groundMain,
};

export const STATUS_RUN: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_RUN",
  action: "run",
  kineticType: "RUN",
  main: groundMain,
};

export const STATUS_RUN_BRAKE: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_RUN_BRAKE",
  action: "runBrake",
  kineticType: "GROUND_STOP",
  main(f, intent, ctx) {
    if (handleActionable(f, intent, ctx)) return;
    if (f.actionFrame >= RUN_BRAKE_FRAMES) startAction(f, "stand");
  },
};

export const STATUS_TURN_RUN: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_TURN_RUN",
  action: "turnaround",
  kineticType: "GROUND_STOP",
  main(f) {
    if (f.actionFrame >= TURNAROUND_FRAMES) startAction(f, "stand");
  },
};

export const STATUS_SQUAT: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_SQUAT",
  action: "crouchStart",
  kineticType: "GROUND_STOP",
  main(f) {
    if (f.actionFrame >= CROUCH_START_FRAMES) startAction(f, "crouch");
  },
};

export const STATUS_SQUAT_WAIT: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_SQUAT_WAIT",
  action: "crouch",
  kineticType: "GROUND_STOP",
  main(f, intent, ctx) {
    if (handleActionable(f, intent, ctx)) return;
    if (intent.y >= 0) startAction(f, "crouchEnd");
  },
};

export const STATUS_SQUAT_RV: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_SQUAT_RV",
  action: "crouchEnd",
  kineticType: "GROUND_STOP",
  main(f) {
    if (f.actionFrame >= CROUCH_END_FRAMES) startAction(f, "stand");
  },
};

export const GROUND_STATUSES: readonly FighterStatus[] = [
  STATUS_WAIT,
  STATUS_WALK,
  STATUS_DASH,
  STATUS_RUN,
  STATUS_RUN_BRAKE,
  STATUS_TURN_RUN,
  STATUS_SQUAT,
  STATUS_SQUAT_WAIT,
  STATUS_SQUAT_RV,
];
```

In `src/engine/states.ts`, delete the 94 lines from the line

```ts
    case "crouchStart": {
```

(it occurs once in the file) up to, not including, the first line after it that reads exactly

```ts
    case "jump":
```


In `src/engine/states.ts`, replace:

```ts

  DASH_INTERRUPT_FRAME,
```

with:

```ts

```

In `src/engine/status/index.ts`, replace:

```ts
import { DAMAGE_STATUSES } from "./damage";
```

with:

```ts
import { DAMAGE_STATUSES } from "./damage";
import { GROUND_STATUSES } from "./ground";
```

In `src/engine/status/index.ts`, replace:

```ts
  ...CLIFF_STATUSES,
];
```

with:

```ts
  ...CLIFF_STATUSES,
  ...GROUND_STATUSES,
];
```

- [ ] **Step 4: Run it again**

Run: `pnpm vitest run src/engine/status/groups.test.ts`
Expected: PASS.

- [ ] **Step 5: The golden trace must not move**

Run: `pnpm vitest run src/game/golden.test.ts`
Expected: PASS, unchanged. This task is a refactor: a divergence here is a bug in this task, not a fixture to regenerate.

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0. `pnpm lint` reports no errors and no warning in a file this task touched; any warnings it printed before this plan started (measure once, with Plan 1 merged, before Task 0) are unchanged.

- [ ] **Step 7: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/src/engine/states.ts \
  super-smash/src/engine/status/ground.ts \
  super-smash/src/engine/status/groups.test.ts \
  super-smash/src/engine/status/index.ts
git commit -m "super-smash: statuses group 5 — WAIT, WALK, DASH, RUN, RUN_BRAKE, TURN_RUN, SQUAT, SQUAT_WAIT, SQUAT_RV" -m "Moved verbatim." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Statuses, group 6: JUMP_SQUAT, JUMP, FALL, LANDING, LANDING_ATTACK_AIR — and the switch is gone

Last group. The legacy switch is deleted; `advanceFighter` throws a named error for an unregistered status instead of silently doing nothing, and `groups.test.ts` asserts the 42 actions are all migrated.

**Files:**
- Create: `super-smash/src/engine/status/air.ts`
- Modify: `super-smash/src/engine/states.ts`
- Modify: `super-smash/src/engine/status/groups.test.ts` — `"are each registered once"`
- Modify: `super-smash/src/engine/status/index.ts` — imports
- Modify: `super-smash/src/engine/status/status.test.ts` — `"advanceFighter dispatch"`

**Interfaces:** Produces `AIR_STATUSES` (`status/air.ts`: `STATUS_JUMP_SQUAT`, `STATUS_JUMP`, `STATUS_FALL`, `STATUS_LANDING`, `STATUS_LANDING_ATTACK_AIR`). `advanceFighter` now throws `no status registered for "<action>"; import "@/engine/status"`.

- [ ] **Step 1: Write the failing test**

In `src/engine/status/groups.test.ts`, replace:

```ts
  "crouchEnd",
];
```

with:

```ts
  "crouchEnd",
  // Task 11
  "jumpSquat",
  "jump",
  "fall",
  "land",
  "landingLag",
];
```

In `src/engine/status/groups.test.ts`, replace:

```ts
  it("are each registered once", () => {
```

with:

```ts
  it("cover every action the engine has, so the legacy switch is gone for good", () => {
    expect(ALL_STATUSES.map((s) => s.action).sort()).toEqual((Object.keys(STATUS_KIND_OF_ACTION) as string[]).sort());
  });

  it("are each registered once", () => {
```

In `src/engine/status/status.test.ts`, replace:

```ts
describe("advanceFighter dispatch", () => {
```

with:

```ts
describe("advanceFighter dispatch", () => {
  it("fails loudly for a status nobody registered", () => {
    // This file never imports `status/index.ts`, so nothing but the test's own
    // registration below exists here.
    const f = fighter({ action: "crouch" });
    expect(() => advanceFighter(f, {} as Intent, CTX)).toThrow(/no status registered for "crouch"/);
  });
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/engine/status/groups.test.ts src/engine/status/status.test.ts`
Expected: FAIL — 3 tests: "are exactly the groups migrated so far" and "cover every action the engine has" (`ALL_STATUSES` has 35 actions, the engine 40), and "fails loudly for a status nobody registered" (`expected [Function] to throw an error`: the legacy switch silently ignores `crouch`).

- [ ] **Step 3: Implement**

Create `src/engine/status/air.ts`:

```ts
/**
 * Jump and landing statuses: JUMP_SQUAT, JUMP, FALL, LANDING,
 * LANDING_ATTACK_AIR (Plan 2, Task 11).
 *
 * `main` bodies are the legacy `advanceFighter` cases, moved verbatim.
 */

import { JUMP_SQUAT_FRAMES } from "../constants";
import { kineticSetY } from "../kinetic";
import { fastFallVelocity } from "../physics";
import {
  LANDING_ANIMATION_FRAMES,
  bufferPress,
  handleActionable,
  peekBuffer,
  startAction,
} from "../states";
import type { Intent, StateContext } from "../states";
import type { FighterState } from "../types";
import type { FighterStatus } from "./kind";

export const STATUS_JUMP_SQUAT: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_JUMP_SQUAT",
  action: "jumpSquat",
  kineticType: "GROUND_STOP",
  main(f, intent, ctx) {
    if (f.actionFrame < JUMP_SQUAT_FRAMES) {
      // An attack pressed inside jumpsquat is Ultimate's short-hop aerial
      // macro: you cannot buffer a *full*-hop aerial, and an attack during
      // jumpsquat always produces a short hop. Buffering it directly rather
      // than through `bufferPress` because that would prefer a jump press on
      // the same frame, and it is the attack that decides the hop's height.
      if (intent.attackPressed) f.bufferedAction = { kind: "attack", frame: ctx.frame };
      return;
    }
    // Short hop vs. full hop is decided here and nowhere else: whether the
    // button is up on the frame jumpsquat ends — or whether an aerial is
    // already buffered, which forces the hop short whatever the jump key does.
    const a = ctx.def.attributes;
    const short = !intent.jumpHeld || peekBuffer(f, ctx.frame) === "attack";
    kineticSetY(f, short ? a.shortHopVelocity : a.fullHopVelocity);
    // The 0.85× damage penalty rides on this flag for the whole airtime; see
    // `FighterState.shortHop` and SPEC §4.
    f.shortHop = short;
    f.grounded = false;
    f.platform = -1;
    f.jumpsUsed = 1;
    f.fastFalling = false;
    startAction(f, "jump");
  },
};

/** Shared by JUMP and FALL: the airborne neutral state, rising or not. */
function airMain(f: FighterState, intent: Intent, ctx: StateContext): void {
  if (f.grounded) {
    startAction(f, "land");
    return;
  }
  if (handleActionable(f, intent, ctx)) return;
  // Fast fall is only available after the apex, which makes it a read on the
  // defender rather than a free way to shorten every jump.
  if (intent.downPressed && !f.fastFalling && f.vy <= 0 && f.hitstun === 0) {
    f.fastFalling = true;
    kineticSetY(f, fastFallVelocity(ctx.def.attributes));
  }
  if (f.vy <= 0 && f.action === "jump") startAction(f, "fall");
}

export const STATUS_JUMP: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_JUMP",
  action: "jump",
  kineticType: "FALL",
  main: airMain,
};

export const STATUS_FALL: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_FALL",
  action: "fall",
  kineticType: "FALL",
  main: airMain,
};

export const STATUS_LANDING: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_LANDING",
  action: "land",
  kineticType: "GROUND_STOP",
  main(f, intent, ctx) {
    if (f.actionFrame >= LANDING_ANIMATION_FRAMES) startAction(f, "stand");
    else bufferPress(f, intent, ctx.frame);
  },
};

export const STATUS_LANDING_ATTACK_AIR: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_LANDING_ATTACK_AIR",
  action: "landingLag",
  kineticType: "GROUND_STOP",
  main(f, intent, ctx) {
    // `charge` carries the remaining lag; see `onLanded`.
    if (f.actionFrame >= f.charge) {
      f.charge = 0;
      startAction(f, "stand");
    } else bufferPress(f, intent, ctx.frame);
  },
};

export const AIR_STATUSES: readonly FighterStatus[] = [
  STATUS_JUMP_SQUAT,
  STATUS_JUMP,
  STATUS_FALL,
  STATUS_LANDING,
  STATUS_LANDING_ATTACK_AIR,
];
```

In `src/engine/states.ts`, replace:

```ts
  const status = STATUS_TABLE[f.action];
  if (status !== undefined) {
    status.main(f, intent, ctx);
    return;
  }

  // Legacy switch: each status group leaves it as it moves to `status/`.
  switch (f.action) {
    /* ------------------------------------------------------- locomotion -- */
    case "jumpSquat": {
      if (f.actionFrame < JUMP_SQUAT_FRAMES) {
        // An attack pressed inside jumpsquat is Ultimate's short-hop aerial
        // macro: you cannot buffer a *full*-hop aerial, and an attack during
        // jumpsquat always produces a short hop. Buffering it directly rather
        // than through `bufferPress` because that would prefer a jump press on
        // the same frame, and it is the attack that decides the hop's height.
        if (intent.attackPressed) f.bufferedAction = { kind: "attack", frame: ctx.frame };
        return;
      }
      // Short hop vs. full hop is decided here and nowhere else: whether the
      // button is up on the frame jumpsquat ends is the whole test — or whether
      // an aerial is already buffered, which forces the hop short whatever the
      // jump key is doing. Ultimate's universal 3-frame jumpsquat is what makes
      // that a real decision rather than a character-specific execution barrier.
      const a = ctx.def.attributes;
      const short = !intent.jumpHeld || peekBuffer(f, ctx.frame) === "attack";
      kineticSetY(f, short ? a.shortHopVelocity : a.fullHopVelocity);
      // The 0.85× damage penalty rides on this flag for the whole airtime; see
      // `FighterState.shortHop` and SPEC §4.
      f.shortHop = short;
      f.grounded = false;
      f.platform = -1;
      f.jumpsUsed = 1;
      f.fastFalling = false;
      startAction(f, "jump");
      return;
    }

    case "land": {
      if (f.actionFrame >= LANDING_ANIMATION_FRAMES) startAction(f, "stand");
      else bufferPress(f, intent, ctx.frame);
      return;
    }

    case "landingLag": {
      // `charge` carries the remaining lag; see `onLanded`.
      if (f.actionFrame >= f.charge) {
        f.charge = 0;
        startAction(f, "stand");
      } else bufferPress(f, intent, ctx.frame);
      return;
    }

    case "jump":
    case "fall": {
      if (f.grounded) {
        startAction(f, "land");
        return;
      }
      if (handleActionable(f, intent, ctx)) return;
      // Fast fall is only available after the apex, which makes it a read on the
      // defender rather than a free way to shorten every jump.
      if (intent.downPressed && !f.fastFalling && f.vy <= 0 && f.hitstun === 0) {
        f.fastFalling = true;
        kineticSetY(f, fastFallVelocity(ctx.def.attributes));
      }
      if (f.vy <= 0 && f.action === "jump") startAction(f, "fall");
      return;
    }
  }
}

```

with:

```ts
  const status = STATUS_TABLE[f.action];
  if (status === undefined) {
    // Every status lives in `status/` and registers itself from
    // `status/index.ts`. Reaching here means that module was never imported.
    throw new Error(`no status registered for "${f.action}"; import "@/engine/status"`);
  }
  status.main(f, intent, ctx);
}

```

In `src/engine/states.ts`, replace:

```ts

  JUMP_SQUAT_FRAMES,
```

with:

```ts

```

In `src/engine/states.ts`, replace:

```ts

  fastFallVelocity,
```

with:

```ts

```

In `src/engine/status/index.ts`, replace:

```ts
import { ATTACK_STATUSES } from "./attack";
```

with:

```ts
import { AIR_STATUSES } from "./air";
import { ATTACK_STATUSES } from "./attack";
```

In `src/engine/status/index.ts`, replace:

```ts
  ...GROUND_STATUSES,
];
```

with:

```ts
  ...GROUND_STATUSES,
  ...AIR_STATUSES,
];
```

- [ ] **Step 4: Run it again**

Run: `pnpm vitest run src/engine/status/groups.test.ts src/engine/status/status.test.ts`
Expected: PASS.

- [ ] **Step 5: The golden trace must not move**

Run: `pnpm vitest run src/game/golden.test.ts`
Expected: PASS, unchanged. This task is a refactor: a divergence here is a bug in this task, not a fixture to regenerate.

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0. `pnpm lint` reports no errors and no warning in a file this task touched; any warnings it printed before this plan started (measure once, with Plan 1 merged, before Task 0) are unchanged.

- [ ] **Step 7: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/src/engine/states.ts \
  super-smash/src/engine/status/air.ts \
  super-smash/src/engine/status/groups.test.ts \
  super-smash/src/engine/status/index.ts \
  super-smash/src/engine/status/status.test.ts
git commit -m "super-smash: statuses group 6 — JUMP_SQUAT, JUMP, FALL, LANDING, LANDING_ATTACK_AIR; the switch is gone" -m "Every action is a registered status object; advanceFighter throws for an unregistered one." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: ACMD game_ scripts: command types, authoring DSL, deterministic interpreter

ACMD `game_` scripts: the command union (names from smash-script `macros.rs` — `ATTACK`, `CATCH`, `frame`, `wait`, `AttackModule::clear_all`, `FT_MOTION_RATE` …), authoring builders that convert decimals with `fx()` at load, and a pure interpreter. The interpreter replays a script from its first command to the requested game frame — no cursor in `GameState`, so nothing new to clone, hash or roll back. It keeps the motion frame as an exact fraction: FSM 0.9 accumulated in Q12 reaches 10.99976 after nine frames and would fire `frame(11)` a frame late (Review Focus #3).

**Files:**
- Create: `super-smash/src/engine/acmd/dsl.ts`
- Create: `super-smash/src/engine/acmd/interpreter.test.ts`
- Create: `super-smash/src/engine/acmd/interpreter.ts`
- Create: `super-smash/src/engine/acmd/types.ts`

**Interfaces:** Produces (`src/engine/acmd/types.ts`): `BoneName`, `MotionKind`, `AttackSetoff`, `AttackLr`, `CollisionSituation`, `HitStatus`, `AttackParams`, `CatchParams`, `Rate`, `AcmdCommand`, `AcmdScript` (full definitions in "Interfaces for later phases"). `dsl.ts`: `ATTACK(spec)`, `CATCH(spec)`, `frame(n)`, `wait(n)`, `clearAll()`, `clear(id)`, `catchClearAll()`, `catchClear(id)`, `atkPower(id, dmg)`, `shieldSetoffMul(id, mul)`, `setFlag(flag, on?)`, `superArmour(on)`, `wholeHit(status)`, `intangible(on)`, `spawnProjectile(id)`, `reverseLr()`, `loop(n, body)`, `unknown(raw)`, `momentum(x, y, hold?, order?)`, `motionRate(fsm | Rate)`, `decimalRatio(v)`, `script(name, motion, commands)`. `interpreter.ts`:
```ts
export interface ScriptFrameState { attacks: readonly AttackParams[]; catches: readonly CatchParams[]; shieldSetoff: ReadonlyMap<number, number>; flags: readonly string[]; superArmour: boolean; wholeHit: HitStatus; momentum: ActiveMomentum | null; motionFrame: number; fired: readonly AcmdCommand[] }
export function flatten(script: AcmdScript): readonly AcmdCommand[];
export function runScript(script: AcmdScript, gameFrame: number): ScriptFrameState;
```

- [ ] **Step 1: Write the failing test**

Create `src/engine/acmd/interpreter.test.ts`:

```ts
import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { fx } from "../fixed";
import {
  ATTACK,
  atkPower,
  clear,
  clearAll,
  decimalRatio,
  frame,
  loop,
  momentum,
  motionRate,
  script,
  setFlag,
  spawnProjectile,
  superArmour,
  wait,
} from "./dsl";
import { runScript } from "./interpreter";
import type { AcmdCommand } from "./types";

const hit = (id: number, damage = 1) =>
  ATTACK({ id, bone: "top", damage, angle: 45, kbg: 100, bkb: 30, size: 2, x: 0, y: 5, z: 4 });

/** Game frames, from 1 to `upTo`, on which attack `id` is live. */
function liveFrames(commands: readonly AcmdCommand[], id: number, upTo = 40): number[] {
  const s = script("game_test", "test", commands);
  const out: number[] = [];
  for (let g = 1; g <= upTo; g++) if (runScript(s, g).attacks.some((a) => a.id === id)) out.push(g);
  return out;
}

describe("frame and wait at the default rate", () => {
  it("opens a hitbox on frame n and closes it n frames after a wait", () => {
    // Mario's jab: frame(2) ATTACK … wait(2) clear_all — active 2–3, as UFD quotes it.
    expect(liveFrames([frame(2), hit(0), wait(2), clearAll()], 0)).toEqual([2, 3]);
  });

  it("runs commands before any frame() on game frame 1", () => {
    expect(liveFrames([hit(0), wait(3), clearAll()], 0)).toEqual([1, 2, 3]);
  });

  it("clears one slot and leaves the others", () => {
    const cmds = [frame(3), hit(0), hit(1), frame(5), clear(0), frame(7), clearAll()];
    expect(liveFrames(cmds, 0)).toEqual([3, 4]);
    expect(liveFrames(cmds, 1)).toEqual([3, 4, 5, 6]);
  });

  it("unrolls a loop: Mario's down air drill hits on 5, 7, 9, 11 and 13", () => {
    // https://rubendal.github.io/ssbu/data/patch/13.0.1/character/Mario/data.json, game_AttackAirLw
    const cmds = [frame(5), loop(5, [hit(0), wait(1), clearAll(), wait(1)]), frame(23), hit(5), wait(1), clearAll()];
    expect(liveFrames(cmds, 0)).toEqual([5, 7, 9, 11, 13]);
    expect(liveFrames(cmds, 5)).toEqual([23]);
  });

  it("treats a frame() already passed as no wait at all", () => {
    expect(liveFrames([frame(6), hit(0), frame(4), clear(0), wait(1), clearAll()], 0)).toEqual([]);
  });
});

describe("FT_MOTION_RATE", () => {
  it("speeds the script up below 1", () => {
    // Two motion frames per game frame: motion 1, 3, 5 … so frame(5) is game frame 3.
    expect(liveFrames([motionRate(0.5), frame(5), hit(0), wait(4), clearAll()], 0)).toEqual([3, 4]);
  });

  it("slows it down above 1", () => {
    expect(liveFrames([motionRate(2), frame(3), hit(0), wait(1), clearAll()], 0)).toEqual([5, 6]);
  });

  it("reaches frame(11) on game frame 10 at FSM 0.9, exactly (Review Focus #3)", () => {
    // 1 + 9 × (10 / 9) = 11. Q12's 1.111084 per frame would reach 10.99976 and fire a frame late.
    expect(liveFrames([motionRate(0.9), frame(11), hit(0), wait(1), clearAll()], 0)[0]).toBe(10);
  });

  it("reaches frame(4) on game frame 2 at three motion frames per game frame", () => {
    expect(liveFrames([motionRate([1, 3]), frame(4), hit(0)], 0)[0]).toBe(2);
  });

  it("changes rate mid-script from the motion frame it is on", () => {
    // Rate 1 to frame 3 (game 3), then 0.5: motion 3, 5, 7 → frame(7) on game 5.
    expect(liveFrames([frame(3), motionRate(0.5), frame(7), hit(0)], 0)[0]).toBe(5);
  });

  it("reports the floored motion frame for the bone table", () => {
    const s = script("game_test", "test", [motionRate(2)]);
    expect([1, 2, 3, 4, 5].map((g) => runScript(s, g).motionFrame)).toEqual([1, 1, 2, 2, 3]);
  });

  it("spells decimals as exact fractions and refuses a rate that is not one", () => {
    expect(decimalRatio(0.91)).toEqual([91, 100]);
    expect(decimalRatio(1.25)).toEqual([5, 4]);
    expect(decimalRatio(2)).toEqual([2, 1]);
    expect(() => motionRate(Number.NaN)).toThrow(/positive rate/);
    expect(() => motionRate(0)).toThrow(/positive rate/);
  });
});

describe("one-shot and stateful commands", () => {
  const s = script("game_test", "test", [
    frame(4),
    spawnProjectile("fireball"),
    superArmour(true),
    setFlag("FIGHTER_STATUS_ATTACK_AIR_FLAG_ENABLE_LANDING"),
    hit(0, 8),
    frame(6),
    atkPower(0, 5),
    frame(9),
    superArmour(false),
    clearAll(),
  ]);

  it("fires a spawn on exactly one frame", () => {
    const frames = [1, 2, 3, 4, 5, 6, 7].filter((g) => runScript(s, g).fired.some((c) => c.op === "spawnProjectile"));
    expect(frames).toEqual([4]);
  });

  it("holds super armour between its on and off", () => {
    expect([3, 4, 8, 9].map((g) => runScript(s, g).superArmour)).toEqual([false, true, true, false]);
  });

  it("keeps a flag once set", () => {
    expect(runScript(s, 3).flags).toEqual([]);
    expect(runScript(s, 12).flags).toEqual(["FIGHTER_STATUS_ATTACK_AIR_FLAG_ENABLE_LANDING"]);
  });

  it("changes a live hitbox's damage with ATK_POWER and keeps the slot", () => {
    expect(runScript(s, 5).attacks[0].damage).toBe(fx(8));
    expect(runScript(s, 6).attacks[0].damage).toBe(fx(5));
  });
});

describe("momentum windows", () => {
  const s = script("game_test", "test", [frame(3), momentum(1, 2, 4, 0), frame(5), momentum(9, 9, 0, 1)]);

  it("is live from its frame through its hold", () => {
    expect([2, 3, 7, 8].map((g) => runScript(s, g).momentum?.until ?? null)).toEqual([null, 7, 7, null]);
  });

  it("lets the lower-order entry win where two overlap, as the legacy list did", () => {
    expect(runScript(s, 5).momentum?.x).toBe(fx(1));
  });
});

describe("purity", () => {
  it("returns the same state for the same frame and never mutates the script", () => {
    const cmds = [frame(2), hit(0), wait(2), clearAll(), frame(6), hit(1), motionRate(0.5), frame(12), clear(1)];
    const s = script("game_test", "test", cmds);
    const snapshot = JSON.stringify(s);
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 40 }), (g) => {
        const a = runScript(s, g);
        const b = runScript(s, g);
        return (
          JSON.stringify({ ...a, shieldSetoff: [...a.shieldSetoff] }) ===
          JSON.stringify({ ...b, shieldSetoff: [...b.shieldSetoff] })
        );
      }),
    );
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/engine/acmd/interpreter.test.ts`
Expected: FAIL — `interpreter.test.ts` cannot resolve `./dsl`.

- [ ] **Step 3: Implement**

Create `src/engine/acmd/types.ts`:

```ts
/**
 * ACMD `game_` scripts — a move as an ordered list of timed commands.
 *
 * Ultimate does not describe a move as a table of hitboxes with start and end
 * frames. It runs a script per motion (`game_attack11`, `game_attackairn` …)
 * whose commands are executed as the animation reaches them: `frame(n)` waits
 * until motion frame n, `wait(n)` waits n more, `ATTACK(...)` opens a hitbox in
 * a numbered slot, `AttackModule::clear_all()` closes them. Hitboxes hang off
 * *bones* and move with the animation. The command and argument names below
 * are smash-script's (HDR-Development/smash-script `src/macros.rs`, `ATTACK`
 * and `CATCH` signatures) — read for the names, never copied.
 *
 * Numbers are Q12 fixed point unless a comment says frames or a count.
 */

/** A bone, as rubendal's data spells it: lowercase, e.g. "top", "hip", "kneer", "handl", "haver", "sword1". */
export type BoneName = string;

/** A motion kind, as rubendal's `Motions` table spells it: "attack_11", "attack_air_n", "special_hi" … */
export type MotionKind = string;

export type AttackSetoff = "ATTACK_SETOFF_KIND_ON" | "ATTACK_SETOFF_KIND_OFF" | "ATTACK_SETOFF_KIND_THRU";
export type AttackLr = "ATTACK_LR_CHECK_F" | "ATTACK_LR_CHECK_B" | "ATTACK_LR_CHECK_POS" | "ATTACK_LR_CHECK_SPEED";
export type CollisionSituation =
  | "COLLISION_SITUATION_MASK_GA"
  | "COLLISION_SITUATION_MASK_G"
  | "COLLISION_SITUATION_MASK_A"
  | "COLLISION_SITUATION_MASK_G_d"
  | "COLLISION_SITUATION_MASK_GA_d";
export type HitStatus = "HIT_STATUS_NORMAL" | "HIT_STATUS_XLU" | "HIT_STATUS_INVINCIBLE" | "HIT_STATUS_OFF";

/**
 * smash-script `ATTACK(id, part, bone, damage, angle, kbg, fkb, bkb, size, x, y, z, x2, y2, z2, hitlag, sdi,
 * clang, facing, set_weight, shield_damage, trip, rehit, reflectable, absorbable, flinchless, disable_hitlag,
 * direct, ground_air, hitbits, collision_part, friendly_fire, effect, sfx_level, collision_sound, _type)`.
 */
export interface AttackParams {
  /** Slot number. A lower id wins when two of one fighter's hitboxes reach a target. */
  readonly id: number;
  readonly part: number;
  readonly bone: BoneName;
  /** Percent. */
  readonly damage: number;
  /** Degrees; 361 is the Sakurai angle. */
  readonly angle: number;
  /** Knockback growth, raw (100 means 100). */
  readonly kbg: number;
  /** Fixed ("set") knockback, raw; 0 when the move uses `bkb`. */
  readonly fkb: number;
  /** Base knockback, raw. */
  readonly bkb: number;
  /** Radius. */
  readonly size: number;
  /** Offset in the bone's local frame. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** The far end of an extended (capsule) hitbox, bone-local; absent for a sphere. */
  readonly x2?: number;
  readonly y2?: number;
  readonly z2?: number;
  /** Hitlag multiplier (ONE = 1.0×). */
  readonly hitlag: number;
  /** SDI multiplier (ONE = 1.0×). */
  readonly sdi: number;
  readonly clang: AttackSetoff;
  readonly facing: AttackLr;
  readonly setWeight: boolean;
  readonly shieldDamage: number;
  /** Trip chance, ONE = certain. */
  readonly trip: number;
  /** Frames between rehits of a multihit; 0 for none. */
  readonly rehit: number;
  readonly reflectable: boolean;
  readonly absorbable: boolean;
  readonly flinchless: boolean;
  readonly noHitlag: boolean;
  readonly direct: boolean;
  readonly situation: CollisionSituation;
  /** `collision_attr_*`, e.g. "collision_attr_normal", "collision_attr_elec", "collision_attr_cutup". */
  readonly collisionAttr: string;
  /** `ATTACK_REGION_*`, e.g. "ATTACK_REGION_PUNCH". */
  readonly region: string;
  /**
   * REPLICA: the legacy `Hitbox.meteor` flag (grounded-meteor knockback ×0.8),
   * carried until Plan 3 derives it from the angle as the game does.
   */
  readonly meteor?: boolean;
}

/** smash-script `CATCH(id, bone, size, x, y, z, x2, y2, z2, status, situation)`. */
export interface CatchParams {
  readonly id: number;
  readonly bone: BoneName;
  readonly size: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly x2?: number;
  readonly y2?: number;
  readonly z2?: number;
  readonly status: string;
  readonly situation: CollisionSituation;
}

/** A rate as an exact fraction: game frames per motion frame (`FT_MOTION_RATE`'s FSM). */
export type Rate = readonly [num: number, den: number];

export type AcmdCommand =
  /** `frame(Frame=n)`: wait until motion frame n (frames). */
  | { readonly op: "frame"; readonly frame: number }
  /** `wait(Frames=n)`: wait n motion frames from where the script is (frames). */
  | { readonly op: "wait"; readonly frames: number }
  | { readonly op: "attack"; readonly params: AttackParams }
  | { readonly op: "catch"; readonly params: CatchParams }
  /** `AttackModule::clear_all()`. */
  | { readonly op: "clearAll" }
  /** `AttackModule::clear(ID=n)`. */
  | { readonly op: "clear"; readonly id: number }
  /** `grab(MA_MSC_CMD_GRAB_CLEAR_ALL)`. */
  | { readonly op: "catchClearAll" }
  /** `grab(MA_MSC_CMD_GRAB_CLEAR, n)`. */
  | { readonly op: "catchClear"; readonly id: number }
  /** `ATK_POWER(id, damage)`: a live hitbox's damage changes, the hitbox does not. */
  | { readonly op: "atkPower"; readonly id: number; readonly damage: number }
  /** `ATK_SET_SHIELD_SETOFF_MUL(ID, ShieldstunMul)`. */
  | { readonly op: "shieldSetoffMul"; readonly id: number; readonly mul: number }
  /** `FT_MOTION_RATE(FSM=r)`. */
  | { readonly op: "motionRate"; readonly rate: Rate }
  /** `WorkModule::on_flag` / `off_flag`. */
  | { readonly op: "setFlag"; readonly flag: string; readonly on: boolean }
  /** `damage(MA_MSC_DAMAGE_DAMAGE_NO_REACTION, …)`: super armour on (ALWAYS) or off (NORMAL). */
  | { readonly op: "superArmour"; readonly on: boolean }
  /** `WHOLE_HIT(HIT_STATUS_*)`: intangible (XLU), invincible, or back to normal. */
  | { readonly op: "wholeHit"; readonly status: HitStatus }
  /**
   * REPLICA: a scripted velocity (Q12, `x` facing-relative) set for this frame
   * and held `hold` more frames — the legacy `MoveDef.momentum`, which the game
   * expresses as animation translation (the MOTION energy). `order` is the
   * entry's position in the legacy list; the lowest live one wins.
   */
  | { readonly op: "momentum"; readonly x: number; readonly y: number; readonly hold: number; readonly order: number }
  /** `ArticleModule::generate_article` — here, a `ProjectileDef` id. */
  | { readonly op: "spawnProjectile"; readonly id: string }
  /** `REVERSE_LR()`. */
  | { readonly op: "reverseLr" }
  /** `for(N Iterations){ … }`. */
  | { readonly op: "loop"; readonly count: number; readonly body: readonly AcmdCommand[] }
  /** Anything the replica does not interpret yet, kept verbatim so nothing is lost on import. */
  | { readonly op: "unknown"; readonly raw: string };

export interface AcmdScript {
  /** `game_<motion>`, e.g. "game_attack11". */
  readonly name: string;
  readonly motion: MotionKind;
  readonly commands: readonly AcmdCommand[];
}
```

Create `src/engine/acmd/dsl.ts`:

```ts
/**
 * Authoring helpers for `game_` scripts, in the shape of smash-script's macros.
 *
 * Fighter data is written in decimals, as the game's scripts are; these turn
 * them into Q12 with `fx()` once, at module load — the same authoring-time
 * conversion every fighter file already does. Nothing here runs inside `step`.
 */

import { fx } from "../fixed";
import type {
  AcmdCommand,
  AcmdScript,
  AttackLr,
  AttackSetoff,
  BoneName,
  CollisionSituation,
  HitStatus,
  MotionKind,
  Rate,
} from "./types";

export interface AttackSpec {
  readonly id: number;
  readonly part?: number;
  readonly bone: BoneName;
  readonly damage: number;
  readonly angle: number;
  readonly kbg: number;
  readonly fkb?: number;
  readonly bkb: number;
  readonly size: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly x2?: number;
  readonly y2?: number;
  readonly z2?: number;
  readonly hitlag?: number;
  readonly sdi?: number;
  readonly clang?: AttackSetoff;
  readonly facing?: AttackLr;
  readonly setWeight?: boolean;
  readonly shieldDamage?: number;
  readonly trip?: number;
  readonly rehit?: number;
  readonly reflectable?: boolean;
  readonly absorbable?: boolean;
  readonly flinchless?: boolean;
  readonly noHitlag?: boolean;
  readonly direct?: boolean;
  readonly situation?: CollisionSituation;
  readonly collisionAttr?: string;
  readonly region?: string;
  readonly meteor?: boolean;
}

/** `ATTACK(...)`. Omitted arguments take the values the game's scripts use most. */
export function ATTACK(s: AttackSpec): AcmdCommand {
  return {
    op: "attack",
    params: {
      id: s.id,
      part: s.part ?? 0,
      bone: s.bone,
      damage: fx(s.damage),
      angle: fx(s.angle),
      kbg: fx(s.kbg),
      fkb: fx(s.fkb ?? 0),
      bkb: fx(s.bkb),
      size: fx(s.size),
      x: fx(s.x),
      y: fx(s.y),
      z: fx(s.z),
      ...(s.x2 !== undefined ? { x2: fx(s.x2) } : {}),
      ...(s.y2 !== undefined ? { y2: fx(s.y2) } : {}),
      ...(s.z2 !== undefined ? { z2: fx(s.z2) } : {}),
      hitlag: fx(s.hitlag ?? 1),
      sdi: fx(s.sdi ?? 1),
      clang: s.clang ?? "ATTACK_SETOFF_KIND_ON",
      facing: s.facing ?? "ATTACK_LR_CHECK_F",
      setWeight: s.setWeight ?? false,
      shieldDamage: fx(s.shieldDamage ?? 0),
      trip: fx(s.trip ?? 0),
      rehit: s.rehit ?? 0,
      reflectable: s.reflectable ?? false,
      absorbable: s.absorbable ?? false,
      flinchless: s.flinchless ?? false,
      noHitlag: s.noHitlag ?? false,
      direct: s.direct ?? true,
      situation: s.situation ?? "COLLISION_SITUATION_MASK_GA",
      collisionAttr: s.collisionAttr ?? "collision_attr_normal",
      region: s.region ?? "ATTACK_REGION_NONE",
      ...(s.meteor ? { meteor: true } : {}),
    },
  };
}

export interface CatchSpec {
  readonly id: number;
  readonly bone: BoneName;
  readonly size: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly x2?: number;
  readonly y2?: number;
  readonly z2?: number;
  readonly status?: string;
  readonly situation?: CollisionSituation;
}

/** `CATCH(...)`. */
export function CATCH(s: CatchSpec): AcmdCommand {
  return {
    op: "catch",
    params: {
      id: s.id,
      bone: s.bone,
      size: fx(s.size),
      x: fx(s.x),
      y: fx(s.y),
      z: fx(s.z),
      ...(s.x2 !== undefined ? { x2: fx(s.x2) } : {}),
      ...(s.y2 !== undefined ? { y2: fx(s.y2) } : {}),
      ...(s.z2 !== undefined ? { z2: fx(s.z2) } : {}),
      status: s.status ?? "FIGHTER_STATUS_KIND_CAPTURE_PULLED",
      situation: s.situation ?? "COLLISION_SITUATION_MASK_GA",
    },
  };
}

export const frame = (n: number): AcmdCommand => ({ op: "frame", frame: n });
export const wait = (n: number): AcmdCommand => ({ op: "wait", frames: n });
export const clearAll = (): AcmdCommand => ({ op: "clearAll" });
export const clear = (id: number): AcmdCommand => ({ op: "clear", id });
export const catchClearAll = (): AcmdCommand => ({ op: "catchClearAll" });
export const catchClear = (id: number): AcmdCommand => ({ op: "catchClear", id });
export const atkPower = (id: number, damage: number): AcmdCommand => ({ op: "atkPower", id, damage: fx(damage) });
export const shieldSetoffMul = (id: number, mul: number): AcmdCommand => ({ op: "shieldSetoffMul", id, mul: fx(mul) });
export const setFlag = (flag: string, on = true): AcmdCommand => ({ op: "setFlag", flag, on });
export const superArmour = (on: boolean): AcmdCommand => ({ op: "superArmour", on });
export const wholeHit = (status: HitStatus): AcmdCommand => ({ op: "wholeHit", status });
export const intangible = (on: boolean): AcmdCommand => wholeHit(on ? "HIT_STATUS_XLU" : "HIT_STATUS_NORMAL");
export const spawnProjectile = (id: string): AcmdCommand => ({ op: "spawnProjectile", id });
export const reverseLr = (): AcmdCommand => ({ op: "reverseLr" });
export const loop = (count: number, body: readonly AcmdCommand[]): AcmdCommand => ({ op: "loop", count, body });
export const unknown = (raw: string): AcmdCommand => ({ op: "unknown", raw });
export const momentum = (x: number, y: number, hold = 0, order = 0): AcmdCommand => ({
  op: "momentum",
  x: fx(x),
  y: fx(y),
  hold,
  order,
});

/**
 * `FT_MOTION_RATE(FSM=r)`. A decimal becomes the exact fraction it spells
 * (0.91 → 91/100), so the interpreter never accumulates a rounded rate; a
 * fraction may also be given directly, e.g. `[1, 3]`.
 */
export function motionRate(fsm: number | Rate): AcmdCommand {
  const rate = typeof fsm === "number" ? decimalRatio(fsm) : fsm;
  if (!(Number.isInteger(rate[0]) && Number.isInteger(rate[1]) && rate[0] > 0 && rate[1] > 0)) {
    throw new Error(`motionRate needs a positive rate, got ${String(fsm)}`);
  }
  return { op: "motionRate", rate };
}

export function decimalRatio(v: number): Rate {
  if (!Number.isFinite(v) || v <= 0) throw new Error(`motionRate needs a positive rate, got ${v}`);
  const text = String(v);
  const dot = text.indexOf(".");
  const den = dot < 0 ? 1 : 10 ** (text.length - dot - 1);
  const num = Math.round(v * den);
  const g = gcd(num, den);
  return [num / g, den / g];
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) [x, y] = [y, x % y];
  return x === 0 ? 1 : x;
}

export function script(name: string, motion: MotionKind, commands: readonly AcmdCommand[]): AcmdScript {
  return { name, motion, commands };
}
```

Create `src/engine/acmd/interpreter.ts`:

```ts
/**
 * Runs a `game_` script to a given game frame, deterministically.
 *
 * Pure: `runScript(script, g)` replays the script from its first command every
 * time it is asked, so there is no per-fighter script cursor in `GameState`
 * to clone, hash or roll back — the move's game frame (`moveFrameOf(actionFrame)`)
 * is the whole state. Scripts are a few dozen commands; replaying is cheaper
 * than the bookkeeping a cursor would need.
 *
 * Timing. Game frame 1 is the first frame of the status. The motion frame
 * starts at 1 and advances by `1 / rate` per game frame, where the rate is the
 * last `FT_MOTION_RATE` (game frames per motion frame). `frame(n)` holds the
 * script until the motion frame reaches n; `wait(n)` holds it until n motion
 * frames past where it is. A command runs on the first game frame on which
 * every hold before it is satisfied. At the default rate, therefore,
 * `frame(n)` runs on game frame n — Ultimate Frame Data's frame n, which is how
 * the community quotes ACMD (DECISIONS D17).
 *
 * The motion frame is kept as an exact fraction, never as Q12: a rate such as
 * 0.9 accumulated in Q12 reaches 10.99976 after nine frames instead of 11, and
 * `frame(11)` would fire a game frame late. Review Focus #3.
 */

import type { AcmdCommand, AcmdScript, AttackParams, CatchParams, HitStatus } from "./types";

export interface ActiveMomentum {
  readonly x: number;
  readonly y: number;
  /** The last game frame of the hold. */
  readonly until: number;
}

export interface ScriptFrameState {
  /** Live ATTACK slots, by id ascending. */
  readonly attacks: readonly AttackParams[];
  /** Live CATCH slots, by id ascending. */
  readonly catches: readonly CatchParams[];
  /** `ATK_SET_SHIELD_SETOFF_MUL` per attack id. */
  readonly shieldSetoff: ReadonlyMap<number, number>;
  readonly flags: readonly string[];
  readonly superArmour: boolean;
  readonly wholeHit: HitStatus;
  /** The live scripted velocity, if any, with the lowest `order`. */
  readonly momentum: ActiveMomentum | null;
  /** The motion frame this game frame shows, floored — what a bone table is indexed by. */
  readonly motionFrame: number;
  /** Commands that ran on exactly this game frame, in script order. */
  readonly fired: readonly AcmdCommand[];
}

const flatCache = new WeakMap<AcmdScript, readonly AcmdCommand[]>();

/** The script with every `loop` unrolled. Cached per script object. */
export function flatten(script: AcmdScript): readonly AcmdCommand[] {
  let flat = flatCache.get(script);
  if (flat === undefined) {
    const out: AcmdCommand[] = [];
    const walk = (cmds: readonly AcmdCommand[]): void => {
      for (const c of cmds) {
        if (c.op === "loop") for (let i = 0; i < c.count; i++) walk(c.body);
        else out.push(c);
      }
    };
    walk(script.commands);
    flat = out;
    flatCache.set(script, flat);
  }
  return flat;
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) [x, y] = [y, x % y];
  return x === 0 ? 1 : x;
}

/** Exact motion position: `n / d` motion frames. */
interface Frac {
  readonly n: number;
  readonly d: number;
}

function reduce(n: number, d: number): Frac {
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}

export function runScript(script: AcmdScript, gameFrame: number): ScriptFrameState {
  const attacks = new Map<number, AttackParams>();
  const catches = new Map<number, CatchParams>();
  const shieldSetoff = new Map<number, number>();
  const flags = new Set<string>();
  const windows: { x: number; y: number; start: number; until: number; order: number }[] = [];
  const fired: AcmdCommand[] = [];
  let superArmour = false;
  let wholeHit: HitStatus = "HIT_STATUS_NORMAL";

  // The current constant-rate segment: from game frame g0 at motion m0, the
  // motion advances rateDen / rateNum per game frame.
  let g0 = 1;
  let m0: Frac = { n: 1, d: 1 };
  let rateNum = 1;
  let rateDen = 1;
  const motionAt = (g: number): Frac => reduce(m0.n * rateNum + (g - g0) * rateDen * m0.d, m0.d * rateNum);

  // Where the script is holding until, as a motion frame.
  let target: Frac = { n: 1, d: 1 };
  let last = 1;
  /** The first game frame, not before the previous command, whose motion reaches `target`. */
  const due = (): number => {
    const gap = target.n * m0.d - m0.n * target.d; // (target − m0) · target.d · m0.d
    let g = g0;
    if (gap > 0) {
      const num = gap * rateNum;
      const den = target.d * m0.d * rateDen;
      g = g0 + Math.floor((num + den - 1) / den);
    }
    return g > last ? g : last;
  };

  for (const c of flatten(script)) {
    if (c.op === "frame") {
      if (c.frame * target.d > target.n) target = { n: c.frame, d: 1 };
      continue;
    }
    const e = due();
    if (e > gameFrame) break;
    last = e;
    if (c.op === "wait") {
      const m = motionAt(e);
      target = { n: m.n + c.frames * m.d, d: m.d };
      continue;
    }
    if (e === gameFrame) fired.push(c);
    switch (c.op) {
      case "attack":
        attacks.set(c.params.id, c.params);
        break;
      case "catch":
        catches.set(c.params.id, c.params);
        break;
      case "clearAll":
        attacks.clear();
        break;
      case "clear":
        attacks.delete(c.id);
        break;
      case "catchClearAll":
        catches.clear();
        break;
      case "catchClear":
        catches.delete(c.id);
        break;
      case "atkPower": {
        const a = attacks.get(c.id);
        if (a !== undefined) attacks.set(c.id, { ...a, damage: c.damage });
        break;
      }
      case "shieldSetoffMul":
        shieldSetoff.set(c.id, c.mul);
        break;
      case "motionRate":
        m0 = motionAt(e);
        g0 = e;
        rateNum = c.rate[0];
        rateDen = c.rate[1];
        break;
      case "setFlag":
        if (c.on) flags.add(c.flag);
        else flags.delete(c.flag);
        break;
      case "superArmour":
        superArmour = c.on;
        break;
      case "wholeHit":
        wholeHit = c.status;
        break;
      case "momentum":
        windows.push({ x: c.x, y: c.y, start: e, until: e + c.hold, order: c.order });
        break;
      case "spawnProjectile":
      case "reverseLr":
      case "unknown":
        break;
    }
  }

  let momentum: ActiveMomentum | null = null;
  let best = Number.POSITIVE_INFINITY;
  for (const w of windows) {
    if (gameFrame < w.start || gameFrame > w.until || w.order >= best) continue;
    best = w.order;
    momentum = { x: w.x, y: w.y, until: w.until };
  }

  const m = motionAt(gameFrame);
  return {
    attacks: [...attacks.values()].sort((a, b) => a.id - b.id),
    catches: [...catches.values()].sort((a, b) => a.id - b.id),
    shieldSetoff,
    flags: [...flags].sort(),
    superArmour,
    wholeHit,
    momentum,
    motionFrame: Math.floor(m.n / m.d),
    fired,
  };
}
```

- [ ] **Step 4: Run it again**

Run: `pnpm vitest run src/engine/acmd/interpreter.test.ts`
Expected: PASS.

- [ ] **Step 5: The golden trace must not move**

Run: `pnpm vitest run src/game/golden.test.ts`
Expected: PASS, unchanged. This task is a refactor: a divergence here is a bug in this task, not a fixture to regenerate.

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0. `pnpm lint` reports no errors and no warning in a file this task touched; any warnings it printed before this plan started (measure once, with Plan 1 merged, before Task 0) are unchanged.

- [ ] **Step 7: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/src/engine/acmd/dsl.ts \
  super-smash/src/engine/acmd/interpreter.test.ts \
  super-smash/src/engine/acmd/interpreter.ts \
  super-smash/src/engine/acmd/types.ts
git commit -m "super-smash: ACMD game_ scripts — command types, authoring DSL, deterministic interpreter" -m "Pure replay to a game frame; motion frames are exact fractions so FT_MOTION_RATE never fires a frame late (Review Focus #3)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: BoneTable: the integer bone-pose interface Plan 4 bakes into, and hitboxes resolved through it

The `BoneTable` interface Plan 4 bakes into: one bone's pose per fighter × motion × frame as a Q12 2×3 matrix plus translation, projected onto the side plane, facing-relative (+x forward, the sim mirrors by `facing` afterwards) and in world units at the fighter's in-game size (the bake folds model scale and `FighterParams.scale` into the matrix; a hitbox `size` is not transformed). The baked storage layout is fixed now (`Int32Array`, frame-major, 8 numbers per pose). `pose()` writes into a caller's `BonePose` and returns a boolean, so a lookup allocates nothing; every table carries a `fingerprint` (FNV-1a over its contents) that online peers compare in Task 27. Plan 2's provider, `LEGACY_BONE_TABLE`, knows only the root bone `top` (script Z forward, Y up — DECISIONS D17), which reproduces today's static offsets exactly. There is no module-global table: Task 15 passes it through `SimContext`. `scriptHitboxes` resolves live ATTACK/CATCH slots through a table into the `Hitbox` records the combat pipeline reads; it refuses a bone it cannot place and an extended (capsule, `x2/y2/z2`) hitbox, which the sphere-only pipeline cannot collide until Plan 3.

**Files:**
- Create: `super-smash/src/engine/acmd/bones.test.ts`
- Create: `super-smash/src/engine/acmd/bones.ts`
- Create: `super-smash/src/engine/acmd/hitboxes.ts`

**Interfaces:** Produces (`acmd/bones.ts`): `BonePose` (mutable fields), `BoneTable { fingerprint; pose(fighterId, motion, frame, bone, out): boolean }`, `newBonePose`, `BONE_POSE_STRIDE`, `BakedMotion`, `BakedFighterBones`, `bakedPoseIndex`, `bakedBoneTable`, `TOP_POSE`, `LEGACY_BONE_TABLE`, `layeredBoneTable`, `bonePoint`. (`acmd/hitboxes.ts`): `EFFECT_OF_ATTR`, `ATTR_OF_EFFECT`, `scriptHitboxes(state, fighterId, motion, gameFrame, bones): Hitbox[]`.

- [ ] **Step 1: Write the failing test**

Create `src/engine/acmd/bones.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { ONE, fx } from "../fixed";
import {
  BONE_POSE_STRIDE,
  LEGACY_BONE_TABLE,
  TOP_POSE,
  bakedBoneTable,
  bakedPoseIndex,
  bonePoint,
  layeredBoneTable,
  newBonePose,
} from "./bones";
import type { BakedFighterBones, BonePose, BoneTable } from "./bones";
import { ATTACK, CATCH, frame, script, shieldSetoffMul } from "./dsl";
import { scriptHitboxes } from "./hitboxes";
import { runScript } from "./interpreter";

/** Two bones, three frames; each Int32 encodes where it sits so a wrong index is obvious. */
function synthetic(): BakedFighterBones {
  const bones = ["top", "kneer"];
  const frames = 3;
  const data = new Int32Array(frames * bones.length * BONE_POSE_STRIDE);
  for (let f = 1; f <= frames; f++) {
    for (let b = 0; b < bones.length; b++) {
      const i = bakedPoseIndex(f, b, bones.length);
      for (let k = 0; k < BONE_POSE_STRIDE; k++) data[i + k] = f * 1000 + b * 100 + k;
    }
  }
  return { fighter: "mario", bones, motions: { attack_air_n: { frames, data } } };
}

/** Ask a table for a pose; null when it has none. */
function poseOf(table: BoneTable, fighter: string, motion: string, frame: number, bone: string): BonePose | null {
  const out = newBonePose();
  return table.pose(fighter, motion, frame, bone, out) ? out : null;
}

describe("baked bone tables (the layout Plan 4 produces)", () => {
  const table = bakedBoneTable([synthetic()]);

  it("indexes frame-major, then bone, then the eight pose numbers", () => {
    const p = poseOf(table, "mario", "attack_air_n", 2, "kneer")!;
    expect([p.tx, p.ty, p.m00, p.m01, p.m02, p.m10, p.m11, p.m12]).toEqual([2100, 2101, 2102, 2103, 2104, 2105, 2106, 2107]);
  });

  it("clamps frames outside the motion to its ends", () => {
    expect(poseOf(table, "mario", "attack_air_n", 0, "top")!.tx).toBe(1000);
    expect(poseOf(table, "mario", "attack_air_n", 99, "top")!.tx).toBe(3000);
  });

  it("knows nothing it was not given, and leaves the output alone then", () => {
    expect(poseOf(table, "fox", "attack_air_n", 1, "top")).toBeNull();
    expect(poseOf(table, "mario", "attack_11", 1, "top")).toBeNull();
    expect(poseOf(table, "mario", "attack_air_n", 1, "handl")).toBeNull();
    const out = newBonePose();
    out.tx = 77;
    expect(table.pose("fox", "attack_air_n", 1, "top", out)).toBe(false);
    expect(out.tx).toBe(77);
  });

  it("writes into the pose it is handed, so a lookup allocates nothing", () => {
    const out = newBonePose();
    expect(table.pose("mario", "attack_air_n", 1, "top", out)).toBe(true);
    expect(table.pose("mario", "attack_air_n", 3, "kneer", out)).toBe(true);
    expect(out.tx).toBe(3100);
  });

  it("falls back to another table where the first has no answer", () => {
    const layered = layeredBoneTable(table, LEGACY_BONE_TABLE);
    expect(poseOf(layered, "fox", "attack_11", 7, "top")).toEqual(TOP_POSE);
  });
});

describe("bone-table fingerprints (compared by online peers, Task 27)", () => {
  it("are 8 hex digits, stable across builds of the same data", () => {
    expect(bakedBoneTable([synthetic()]).fingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect(bakedBoneTable([synthetic()]).fingerprint).toBe(bakedBoneTable([synthetic()]).fingerprint);
  });

  it("change when one Int32 of the bake changes", () => {
    const a = synthetic();
    const b = synthetic();
    b.motions.attack_air_n.data[13] += 1;
    expect(bakedBoneTable([b]).fingerprint).not.toBe(bakedBoneTable([a]).fingerprint);
  });

  it("do not depend on the order fighters are listed in", () => {
    const fox: BakedFighterBones = { ...synthetic(), fighter: "fox" };
    expect(bakedBoneTable([synthetic(), fox]).fingerprint).toBe(bakedBoneTable([fox, synthetic()]).fingerprint);
  });

  it("tell a layered table from either of its layers", () => {
    const baked = bakedBoneTable([synthetic()]);
    const layered = layeredBoneTable(baked, LEGACY_BONE_TABLE);
    expect(new Set([baked.fingerprint, LEGACY_BONE_TABLE.fingerprint, layered.fingerprint]).size).toBe(3);
  });
});

describe("the legacy (Plan 2) bone table", () => {
  it("answers for the root bone only, the same on every frame", () => {
    expect(poseOf(LEGACY_BONE_TABLE, "mario", "attack_11", 1, "top")).toEqual(TOP_POSE);
    expect(poseOf(LEGACY_BONE_TABLE, "kirby", "special_hi", 40, "top")).toEqual(TOP_POSE);
    expect(poseOf(LEGACY_BONE_TABLE, "mario", "attack_11", 1, "kneer")).toBeNull();
  });

  it("puts script Z forward and script Y up, as D17 reads the root bone", () => {
    expect(bonePoint(TOP_POSE, fx(9), fx(6.3), fx(6))).toEqual({ x: fx(6), y: fx(6.3) });
  });

  it("applies a general pose as matrix then translation", () => {
    const p = { tx: fx(1), ty: fx(2), m00: ONE, m01: 0, m02: 0, m10: 0, m11: 0, m12: -ONE };
    expect(bonePoint(p, fx(3), fx(4), fx(5))).toEqual({ x: fx(4), y: fx(-3) });
  });
});

describe("scriptHitboxes", () => {
  const s = script("game_test", "attack_11", [
    frame(2),
    ATTACK({ id: 1, bone: "top", damage: 3, angle: 361, kbg: 30, bkb: 20, size: 1.5, x: 0, y: 6.3, z: 8.7, collisionAttr: "collision_attr_elec" }),
    ATTACK({ id: 0, bone: "top", damage: 2.2, angle: 361, kbg: 30, fkb: 50, bkb: 0, size: 1.2, x: 0, y: 6.3, z: 6, hitlag: 1.5 }),
    shieldSetoffMul(1, 2),
    CATCH({ id: 0, bone: "top", size: 3.3, x: 0, y: 6.6, z: 6.4 }),
  ]);

  it("resolves through the bone table, attacks by id then catches", () => {
    const out = scriptHitboxes(runScript(s, 2), "mario", "attack_11", 2, LEGACY_BONE_TABLE);
    expect(out.map((h) => [h.id, h.x, h.y, h.grabbing === true])).toEqual([
      [0, fx(6), fx(6.3), false],
      [1, fx(8.7), fx(6.3), false],
      [0, fx(6.4), fx(6.6), true],
    ]);
  });

  it("maps ATTACK's arguments onto the Hitbox the combat pipeline reads", () => {
    const [set, elec] = scriptHitboxes(runScript(s, 2), "mario", "attack_11", 2, LEGACY_BONE_TABLE);
    expect(set).toMatchObject({ setKnockback: true, baseKnockback: fx(50), hitlagMultiplier: fx(1.5) });
    expect(elec).toMatchObject({ effect: "electric", baseKnockback: fx(20), shieldstunMultiplier: fx(2) });
    expect(elec.hitlagMultiplier).toBeUndefined();
  });

  it("refuses a bone the table cannot place, rather than guessing", () => {
    const limb = script("game_test", "attack_air_n", [
      ATTACK({ id: 0, bone: "kneer", damage: 8, angle: 361, kbg: 100, bkb: 20, size: 4, x: 0.8, y: 0, z: 0 }),
    ]);
    expect(() => scriptHitboxes(runScript(limb, 1), "mario", "attack_air_n", 1, LEGACY_BONE_TABLE)).toThrow(/kneer/);
  });

  it("refuses an extended (capsule) hitbox until Plan 3 can collide one", () => {
    const capsule = script("game_test", "attack_s3_s", [
      ATTACK({ id: 2, bone: "top", damage: 9, angle: 361, kbg: 100, bkb: 20, size: 3, x: 0, y: 6, z: 4, x2: 0, y2: 6, z2: 12 }),
    ]);
    expect(() => scriptHitboxes(runScript(capsule, 1), "mario", "attack_s3_s", 1, LEGACY_BONE_TABLE)).toThrow(/capsule/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/engine/acmd/bones.test.ts`
Expected: FAIL — `bones.test.ts`: `Failed to resolve import "./hitboxes"` (neither `./bones` nor `./hitboxes` exists yet).

- [ ] **Step 3: Implement**

Create `src/engine/acmd/bones.ts`:

```ts
/**
 * BoneTable — where a fighter's bones are, per motion and frame, as integers.
 *
 * A hitbox in a `game_` script hangs off a bone (`ATTACK(Bone=hash40("kneer"), X, Y, Z)`):
 * its centre is the bone's world transform applied to the offset. The sim may
 * not evaluate animation (it is float and non-deterministic across engines),
 * so Plan 4 bakes every bone's transform for every frame of every motion into
 * integer tables at build time, and the sim reads them through this interface.
 *
 * What a pose means:
 * - **Plane.** The bone's transform projected onto the sim's side plane: a 2×3
 *   matrix plus a translation, all Q12. A bone-local point (lx, ly, lz) lands at
 *
 *     x = (m00·lx + m01·ly + m02·lz) / ONE + tx
 *     y = (m10·lx + m11·ly + m12·lz) / ONE + ty
 *
 * - **Facing.** Facing-relative: +x is the way the fighter faces, +y is up,
 *   the origin is the fighter's feet (`FighterState.x/y`). A pose never depends
 *   on facing; the sim mirrors x by `facing` afterwards, as it does for every
 *   `Hitbox` (`hitboxWorldPos`).
 * - **Scale.** World units at the fighter's in-game size: the bake folds the
 *   model's own scale and `FighterParams.scale` into the matrix and the
 *   translation, so a script offset is scaled exactly as the bone carries it.
 *   A hitbox's `size` is a radius and is not transformed by the pose.
 *
 * Until Plan 4 the only bone the sim uses is `top`, the root, whose forward
 * axis is the script's Z (DECISIONS D17), so `LEGACY_BONE_TABLE` answers for
 * `top` alone and every hitbox keeps exactly the position it has today.
 *
 * The table reaches the sim through `SimContext.bones` (Task 15), never a
 * module global, and its `fingerprint` is what two online peers compare before
 * a match (Task 27): a different bake is a different game.
 */

import { ONE } from "../fixed";
import { mixInt, mixString } from "../hash";
import type { BoneName, MotionKind } from "./types";

/** One bone's pose; `BoneTable.pose` writes into one, so it is mutable on purpose. */
export interface BonePose {
  tx: number;
  ty: number;
  m00: number;
  m01: number;
  m02: number;
  m10: number;
  m11: number;
  m12: number;
}

export interface BoneTable {
  /**
   * A stable hash of everything the table can answer: FNV-1a over its
   * contents, as 8 lowercase hex digits. Equal tables have equal fingerprints.
   */
  readonly fingerprint: string;
  /**
   * Write the pose of `bone` on motion frame `frame` (1-based, integer — the
   * interpreter's floored `motionFrame`) of `motion`, for `fighterId`, into
   * `out` and return true. Frames outside the motion clamp to its first or
   * last. Return false, leaving `out` untouched, when the table does not know
   * that fighter, motion or bone. Allocates nothing.
   */
  pose(fighterId: string, motion: MotionKind, frame: number, bone: BoneName, out: BonePose): boolean;
}

/** A pose to write into. */
export function newBonePose(): BonePose {
  return { tx: 0, ty: 0, m00: 0, m01: 0, m02: 0, m10: 0, m11: 0, m12: 0 };
}

/** Int32s per pose, in the order tx, ty, m00, m01, m02, m10, m11, m12. */
export const BONE_POSE_STRIDE = 8;

/** One motion's bake: `frames × bones.length × BONE_POSE_STRIDE` Int32s, frame-major. */
export interface BakedMotion {
  readonly frames: number;
  readonly data: Int32Array;
}

/** What Plan 4's bake produces per fighter. */
export interface BakedFighterBones {
  readonly fighter: string;
  readonly bones: readonly BoneName[];
  readonly motions: Readonly<Record<MotionKind, BakedMotion>>;
}

/** Index of a pose's first Int32 in `BakedMotion.data`. */
export function bakedPoseIndex(frame: number, boneIndex: number, boneCount: number): number {
  return ((frame - 1) * boneCount + boneIndex) * BONE_POSE_STRIDE;
}

/** FNV-1a's offset basis, the seed `hash.ts` uses too. */
const FINGERPRINT_SEED = 0x811c9dc5;

function hex(h: number): string {
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** The fingerprint of a bake: every fighter, bone name, motion and Int32, in a fixed order. */
function bakeFingerprint(fighters: readonly BakedFighterBones[]): string {
  let h = FINGERPRINT_SEED;
  for (const f of [...fighters].sort((a, b) => (a.fighter < b.fighter ? -1 : a.fighter > b.fighter ? 1 : 0))) {
    h = mixString(h, f.fighter);
    h = mixInt(h, f.bones.length);
    for (const b of f.bones) h = mixString(h, b);
    const names = Object.keys(f.motions).sort();
    h = mixInt(h, names.length);
    for (const name of names) {
      const m = f.motions[name];
      h = mixString(h, name);
      h = mixInt(h, m.frames);
      h = mixInt(h, m.data.length);
      for (let i = 0; i < m.data.length; i++) h = mixInt(h, m.data[i]);
    }
  }
  return hex(h);
}

/** A `BoneTable` over Plan 4's baked data. */
export function bakedBoneTable(fighters: readonly BakedFighterBones[]): BoneTable {
  const byId = new Map(fighters.map((f) => [f.fighter, { f, index: new Map(f.bones.map((b, i) => [b, i])) }]));
  return {
    fingerprint: bakeFingerprint(fighters),
    pose(fighterId, motion, frame, bone, out) {
      const entry = byId.get(fighterId);
      if (entry === undefined) return false;
      const m = entry.f.motions[motion];
      const b = entry.index.get(bone);
      if (m === undefined || b === undefined || m.frames <= 0) return false;
      const fr = frame < 1 ? 1 : frame > m.frames ? m.frames : frame;
      const i = bakedPoseIndex(fr, b, entry.f.bones.length);
      const d = m.data;
      out.tx = d[i];
      out.ty = d[i + 1];
      out.m00 = d[i + 2];
      out.m01 = d[i + 3];
      out.m02 = d[i + 4];
      out.m10 = d[i + 5];
      out.m11 = d[i + 6];
      out.m12 = d[i + 7];
      return true;
    },
  };
}

/** The root bone: script Z is forward, script Y is up, script X is depth (dropped). */
export const TOP_POSE: Readonly<BonePose> = { tx: 0, ty: 0, m00: 0, m01: 0, m02: ONE, m10: 0, m11: ONE, m12: 0 };

/** Plan 2's provider: the root bone only, identical on every frame of every motion. */
export const LEGACY_BONE_TABLE: BoneTable = {
  fingerprint: hex(mixString(FINGERPRINT_SEED, "legacy:top")),
  pose(_fighterId, _motion, _frame, bone, out) {
    if (bone !== "top") return false;
    Object.assign(out, TOP_POSE);
    return true;
  },
};

/**
 * A table that asks `primary` first and `fallback` second — so Plan 4 can
 * supply a bake for some fighters and keep the root bone for the rest.
 */
export function layeredBoneTable(primary: BoneTable, fallback: BoneTable): BoneTable {
  return {
    fingerprint: hex(mixString(mixString(FINGERPRINT_SEED, primary.fingerprint), fallback.fingerprint)),
    pose(fighterId, motion, frame, bone, out) {
      return primary.pose(fighterId, motion, frame, bone, out) || fallback.pose(fighterId, motion, frame, bone, out);
    },
  };
}

/** A bone-local point, in the fighter's facing-relative frame. */
export function bonePoint(p: Readonly<BonePose>, lx: number, ly: number, lz: number): { x: number; y: number } {
  return {
    x: Math.trunc((p.m00 * lx + p.m01 * ly + p.m02 * lz) / ONE) + p.tx,
    y: Math.trunc((p.m10 * lx + p.m11 * ly + p.m12 * lz) / ONE) + p.ty,
  };
}
```

Create `src/engine/acmd/hitboxes.ts`:

```ts
/**
 * From a script's live ATTACK/CATCH slots to the `Hitbox` records the combat
 * pipeline in `simulate.ts` already understands.
 *
 * Plan 2 keeps one combat pipeline: a script hitbox is resolved through the
 * bone table to a facing-relative point and handed on as a `Hitbox`, so
 * clanks, priority, shields and knockback are untouched. Plan 3 extends the
 * pipeline to read `AttackParams` directly (capsules, SDI, set weight, trip…).
 * Until then an extended (capsule) ATTACK or CATCH — one with `x2/y2/z2` — is
 * refused loudly: the pipeline has only spheres, and dropping the far end
 * would quietly shrink the move.
 */

import { ONE } from "../fixed";
import type { HitEffect, Hitbox } from "../types";
import { bonePoint, newBonePose } from "./bones";
import type { BoneTable } from "./bones";
import type { ScriptFrameState } from "./interpreter";
import type { AttackParams, CatchParams, MotionKind } from "./types";

/** `collision_attr_*` ↔ the replica's `HitEffect`. */
export const EFFECT_OF_ATTR: Readonly<Record<string, HitEffect>> = {
  collision_attr_normal: "normal",
  collision_attr_elec: "electric",
  collision_attr_fire: "fire",
  collision_attr_cutup: "slash",
  collision_attr_sting: "stab",
  collision_attr_purple: "darkness",
  collision_attr_aura: "aura",
  collision_attr_ice: "freeze",
  collision_attr_bury: "bury",
  collision_attr_paralyze: "paralyze",
};

export const ATTR_OF_EFFECT: Readonly<Record<HitEffect, string>> = Object.fromEntries(
  Object.entries(EFFECT_OF_ATTR).map(([attr, effect]) => [effect, attr]),
) as Record<HitEffect, string>;

/** Scratch for `BoneTable.pose`, reused so resolving a hitbox allocates no pose. Not state. */
const POSE = newBonePose();

function resolve(
  bones: BoneTable,
  fighterId: string,
  motion: MotionKind,
  frame: number,
  p: Pick<AttackParams, "id" | "bone" | "x" | "y" | "z" | "x2" | "y2" | "z2">,
): { x: number; y: number } {
  if (p.x2 !== undefined || p.y2 !== undefined || p.z2 !== undefined) {
    throw new Error(`capsule hitbox (x2/y2/z2) id ${p.id} of ${fighterId}/${motion}: not supported until Plan 3`);
  }
  if (!bones.pose(fighterId, motion, frame, p.bone, POSE)) {
    throw new Error(`no pose for bone "${p.bone}" of ${fighterId}/${motion} frame ${frame}`);
  }
  return bonePoint(POSE, p.x, p.y, p.z);
}

function attackHitbox(
  a: AttackParams,
  gameFrame: number,
  at: { x: number; y: number },
  setoff: number | undefined,
): Hitbox {
  const effect = EFFECT_OF_ATTR[a.collisionAttr];
  return {
    id: a.id,
    startFrame: gameFrame,
    endFrame: gameFrame,
    x: at.x,
    y: at.y,
    radius: a.size,
    damage: a.damage,
    angle: a.angle,
    baseKnockback: a.fkb > 0 ? a.fkb : a.bkb,
    knockbackGrowth: a.kbg,
    ...(effect !== undefined && effect !== "normal" ? { effect } : {}),
    ...(a.fkb > 0 ? { setKnockback: true } : {}),
    ...(a.clang === "ATTACK_SETOFF_KIND_THRU" ? { transcendent: true } : {}),
    ...(a.hitlag !== ONE ? { hitlagMultiplier: a.hitlag } : {}),
    ...(setoff !== undefined ? { shieldstunMultiplier: setoff } : {}),
    ...(a.meteor ? { meteor: true } : {}),
  };
}

function catchHitbox(c: CatchParams, gameFrame: number, at: { x: number; y: number }): Hitbox {
  return {
    id: c.id,
    startFrame: gameFrame,
    endFrame: gameFrame,
    x: at.x,
    y: at.y,
    radius: c.size,
    damage: 0,
    angle: 0,
    baseKnockback: 0,
    knockbackGrowth: 0,
    grabbing: true,
  };
}

/** Every live hitbox of a script on `gameFrame`: attacks by id, then catches by id. */
export function scriptHitboxes(
  state: ScriptFrameState,
  fighterId: string,
  motion: MotionKind,
  gameFrame: number,
  bones: BoneTable,
): Hitbox[] {
  const out: Hitbox[] = [];
  for (const a of state.attacks) {
    const at = resolve(bones, fighterId, motion, state.motionFrame, a);
    out.push(attackHitbox(a, gameFrame, at, state.shieldSetoff.get(a.id)));
  }
  for (const c of state.catches) {
    out.push(catchHitbox(c, gameFrame, resolve(bones, fighterId, motion, state.motionFrame, c)));
  }
  return out;
}
```

- [ ] **Step 4: Run it again**

Run: `pnpm vitest run src/engine/acmd/bones.test.ts`
Expected: PASS.

- [ ] **Step 5: The golden trace must not move**

Run: `pnpm vitest run src/game/golden.test.ts`
Expected: PASS, unchanged. This task is a refactor: a divergence here is a bug in this task, not a fixture to regenerate.

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0. `pnpm lint` reports no errors and no warning in a file this task touched; any warnings it printed before this plan started (measure once, with Plan 1 merged, before Task 0) are unchanged.

- [ ] **Step 7: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/src/engine/acmd/bones.test.ts \
  super-smash/src/engine/acmd/bones.ts \
  super-smash/src/engine/acmd/hitboxes.ts
git commit -m "super-smash: BoneTable — the integer bone-pose interface Plan 4 bakes into" -m "LEGACY_BONE_TABLE places the root bone exactly where today's static offsets are. Poses are written into the caller's object (no allocation); every table has a content fingerprint. scriptHitboxes resolves script slots through any table and refuses an unknown bone or a capsule hitbox." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Every legacy MoveDef compiled to a game_ script, proven identical

Compile every legacy `MoveDef` into a root-bone `game_` script — hitbox windows, shield-setoff multipliers, catches, armour, momentum, projectile spawns — and prove, for every move of all eight fighters on every frame, that the script produces the same hitboxes in the same order, the same spawns, the same armour and the same momentum. `FighterDef.scripts` lets a later plan override a slot with an imported, bone-attached script.

**Files:**
- Create: `super-smash/src/engine/acmd/legacy.test.ts`
- Create: `super-smash/src/engine/acmd/legacy.ts`
- Modify: `super-smash/src/engine/types.ts` — imports

**Interfaces:** Produces (`acmd/legacy.ts`): `SLOT_MOTION: Readonly<Record<MoveSlot, MotionKind>>`, `attackFromHitbox(hb: Hitbox): AttackParams`, `legacyGameScript(move: MoveDef): AcmdScript`, `gameScriptFor(def: FighterDef, slot: MoveSlot): AcmdScript | null`. `FighterDef.scripts?: Readonly<Partial<Record<MoveSlot, AcmdScript>>>` (`types.ts`).

- [ ] **Step 1: Write the failing test**

Create `src/engine/acmd/legacy.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { FIGHTERS } from "@/fighters";
import { ONE } from "../fixed";
import { activeHitboxes } from "../hitbox";
import { projectilesDueOnFrame } from "../projectile";
import type { Hitbox, MoveDef, MoveSlot } from "../types";
import { LEGACY_BONE_TABLE } from "./bones";
import { scriptHitboxes } from "./hitboxes";
import { runScript } from "./interpreter";
import { SLOT_MOTION, gameScriptFor, legacyGameScript } from "./legacy";

/** A hitbox with its defaults spelled out, so "absent" and "explicitly the default" compare equal. */
function canonical(hb: Hitbox) {
  return {
    id: hb.id,
    x: hb.x,
    y: hb.y,
    radius: hb.radius,
    damage: hb.damage,
    angle: hb.angle,
    baseKnockback: hb.baseKnockback,
    knockbackGrowth: hb.knockbackGrowth,
    effect: hb.effect ?? "normal",
    setKnockback: hb.setKnockback === true,
    transcendent: hb.transcendent === true,
    hitlagMultiplier: hb.hitlagMultiplier ?? ONE,
    shieldstunMultiplier: hb.shieldstunMultiplier ?? ONE,
    meteor: hb.meteor === true,
    grabbing: hb.grabbing === true,
  };
}

const MOVES: [string, MoveSlot, MoveDef][] = FIGHTERS.flatMap((f) =>
  (Object.keys(f.moves) as MoveSlot[]).map((slot): [string, MoveSlot, MoveDef] => [f.id, slot, f.moves[slot]!]),
);

/** The legacy momentum rule (`applyMoveMomentum` before Task 15): first entry whose window holds. */
function legacyMomentum(move: MoveDef, frame: number) {
  for (const m of move.momentum ?? []) {
    const until = m.frame + (m.hold ?? 0);
    if (frame >= m.frame && frame <= until) return { x: m.x, y: m.y, until };
  }
  return null;
}

describe("legacy moves compiled to game_ scripts", () => {
  it("covers the whole roster", () => {
    expect(MOVES.length).toBeGreaterThan(150);
  });

  it.each(MOVES)("%s %s: the same hitboxes, in the same order, on every frame", (fighterId, _slot, move) => {
    const script = legacyGameScript(move);
    for (let g = 1; g <= move.totalFrames + 10; g++) {
      const want = activeHitboxes(move, g).map(canonical);
      const got = scriptHitboxes(runScript(script, g), fighterId, script.motion, g, LEGACY_BONE_TABLE).map(canonical);
      expect(got, `frame ${g}`).toEqual(want);
    }
  });

  it.each(MOVES)("%s %s: the same projectiles, armour and momentum on every frame", (_id, _slot, move) => {
    const script = legacyGameScript(move);
    for (let g = 1; g <= move.totalFrames + 10; g++) {
      const st = runScript(script, g);
      const spawned = st.fired.flatMap((c) => (c.op === "spawnProjectile" ? [c.id] : []));
      expect(spawned, `spawns on frame ${g}`).toEqual(projectilesDueOnFrame(move, g).map((p) => p.id));
      const armour = move.superArmourFrames;
      expect(st.superArmour, `armour on frame ${g}`).toBe(armour !== undefined && g >= armour[0] && g <= armour[1]);
      expect(st.momentum, `momentum on frame ${g}`).toEqual(legacyMomentum(move, g));
    }
  });

  it("names each script after the motion its slot plays", () => {
    const mario = FIGHTERS.find((f) => f.id === "mario")!;
    expect(gameScriptFor(mario, "jab1")?.name).toBe("game_attack11");
    expect(gameScriptFor(mario, "nair")?.motion).toBe(SLOT_MOTION.nair);
  });

  it("compiles once per move and prefers a fighter's own script", () => {
    const mario = FIGHTERS.find((f) => f.id === "mario")!;
    expect(gameScriptFor(mario, "fair")).toBe(gameScriptFor(mario, "fair"));
    const own = { name: "game_attackairf", motion: "attack_air_f", commands: [] };
    expect(gameScriptFor({ ...mario, scripts: { fair: own } }, "fair")).toBe(own);
    expect(gameScriptFor(mario, "rapidJab")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/engine/acmd/legacy.test.ts`
Expected: FAIL — `legacy.test.ts` cannot resolve `./legacy`.

- [ ] **Step 3: Implement**

Create `src/engine/acmd/legacy.ts`:

```ts
/**
 * Every legacy `MoveDef` as a `game_` script (Plan 2, Task 14).
 *
 * The roster's moves were authored as hitbox tables with start and end frames.
 * This compiles each one, mechanically and at load, into the script the game
 * would run: `frame(start) ATTACK(...)`, `frame(end + 1) AttackModule::clear(id)`,
 * armour on and off, momentum, projectile spawns. Every hitbox hangs off the
 * root bone `top` with its legacy offset as the script's Z (forward) and Y (up),
 * so `LEGACY_BONE_TABLE` puts it exactly where it is today.
 *
 * `FighterDef.scripts` overrides a slot with a hand-written or imported script;
 * Plans 3 and 4 move slots onto the imported, bone-attached scripts there.
 */

import { ONE } from "../fixed";
import type { FighterDef, Hitbox, MoveDef, MoveSlot } from "../types";
import { ATTR_OF_EFFECT } from "./hitboxes";
import type { AcmdCommand, AcmdScript, AttackParams, MotionKind } from "./types";

/** Which SSBU motion each move slot plays (rubendal `Motions`, e.g. Mario's `game_attacks3` → `attack_s3_s`). */
export const SLOT_MOTION: Readonly<Record<MoveSlot, MotionKind>> = {
  jab1: "attack_11",
  jab2: "attack_12",
  jab3: "attack_13",
  rapidJab: "attack_100",
  ftilt: "attack_s3_s",
  utilt: "attack_hi3",
  dtilt: "attack_lw3",
  dashAttack: "attack_dash",
  fsmash: "attack_s4_s",
  usmash: "attack_hi4",
  dsmash: "attack_lw4",
  nair: "attack_air_n",
  fair: "attack_air_f",
  bair: "attack_air_b",
  uair: "attack_air_hi",
  dair: "attack_air_lw",
  neutralB: "special_n",
  sideB: "special_s",
  upB: "special_hi",
  downB: "special_lw",
  grab: "catch",
  dashGrab: "catch_dash",
  pummel: "catch_attack",
  fthrow: "throw_f",
  bthrow: "throw_b",
  uthrow: "throw_hi",
  dthrow: "throw_lw",
  ledgeAttack: "cliff_attack_quick",
  getUpAttack: "down_attack_u",
  finalSmash: "final",
};

/** A legacy hitbox as `ATTACK` arguments on the root bone. */
export function attackFromHitbox(hb: Hitbox): AttackParams {
  return {
    id: hb.id,
    part: 0,
    bone: "top",
    damage: hb.damage,
    angle: hb.angle,
    kbg: hb.knockbackGrowth,
    fkb: hb.setKnockback ? hb.baseKnockback : 0,
    bkb: hb.setKnockback ? 0 : hb.baseKnockback,
    size: hb.radius,
    x: 0,
    y: hb.y,
    z: hb.x,
    hitlag: hb.hitlagMultiplier ?? ONE,
    sdi: ONE,
    clang: hb.transcendent ? "ATTACK_SETOFF_KIND_THRU" : "ATTACK_SETOFF_KIND_ON",
    facing: "ATTACK_LR_CHECK_F",
    setWeight: false,
    shieldDamage: 0,
    trip: 0,
    rehit: 0,
    reflectable: false,
    absorbable: false,
    flinchless: false,
    noHitlag: false,
    direct: true,
    situation: "COLLISION_SITUATION_MASK_GA",
    collisionAttr: ATTR_OF_EFFECT[hb.effect ?? "normal"],
    region: "ATTACK_REGION_NONE",
    ...(hb.meteor ? { meteor: true } : {}),
  };
}

interface Beat {
  readonly close: AcmdCommand[];
  readonly open: AcmdCommand[];
}

/** Compile one legacy move. Pure; `gameScriptFor` caches it. */
export function legacyGameScript(move: MoveDef): AcmdScript {
  const beats = new Map<number, Beat>();
  const at = (frame: number): Beat => {
    const f = frame < 1 ? 1 : frame;
    let b = beats.get(f);
    if (b === undefined) {
      b = { close: [], open: [] };
      beats.set(f, b);
    }
    return b;
  };

  for (const hb of move.hitboxes) {
    if (hb.endFrame < hb.startFrame) continue;
    if (hb.grabbing) {
      at(hb.startFrame).open.push({
        op: "catch",
        params: {
          id: hb.id,
          bone: "top",
          size: hb.radius,
          x: 0,
          y: hb.y,
          z: hb.x,
          status: "FIGHTER_STATUS_KIND_CAPTURE_PULLED",
          situation: "COLLISION_SITUATION_MASK_GA",
        },
      });
      at(hb.endFrame + 1).close.push({ op: "catchClear", id: hb.id });
      continue;
    }
    at(hb.startFrame).open.push({ op: "attack", params: attackFromHitbox(hb) });
    if (hb.shieldstunMultiplier !== undefined) {
      at(hb.startFrame).open.push({ op: "shieldSetoffMul", id: hb.id, mul: hb.shieldstunMultiplier });
    }
    at(hb.endFrame + 1).close.push({ op: "clear", id: hb.id });
  }
  if (move.superArmourFrames !== undefined) {
    const [from, to] = move.superArmourFrames;
    at(from).open.push({ op: "superArmour", on: true });
    at(to + 1).close.push({ op: "superArmour", on: false });
  }
  (move.momentum ?? []).forEach((m, order) => {
    at(m.frame).open.push({ op: "momentum", x: m.x, y: m.y, hold: m.hold ?? 0, order });
  });
  for (const p of move.projectiles ?? []) at(p.spawnFrame).open.push({ op: "spawnProjectile", id: p.id });

  const commands: AcmdCommand[] = [];
  for (const frame of [...beats.keys()].sort((a, b) => a - b)) {
    const b = beats.get(frame)!;
    commands.push({ op: "frame", frame }, ...b.close, ...b.open);
  }
  return { name: `game_${SLOT_MOTION[move.slot].replace(/_/g, "")}`, motion: SLOT_MOTION[move.slot], commands };
}

const compiled = new WeakMap<MoveDef, AcmdScript>();

/** The script a fighter runs for a move slot: its override, else the compiled legacy move. */
export function gameScriptFor(def: FighterDef, slot: MoveSlot): AcmdScript | null {
  const own = def.scripts?.[slot];
  if (own !== undefined) return own;
  const move = def.moves[slot];
  if (move === undefined) return null;
  let s = compiled.get(move);
  if (s === undefined) {
    s = legacyGameScript(move);
    compiled.set(move, s);
  }
  return s;
}
```

In `src/engine/types.ts`, replace:

```ts
import type { KineticState } from "./kinetic";
```

with:

```ts
import type { AcmdScript } from "./acmd/types";
import type { KineticState } from "./kinetic";
```

In `src/engine/types.ts`, replace:

```ts
  readonly moves: Readonly<Partial<Record<MoveSlot, MoveDef>>>;
  /** Palette used by the procedural renderer.
```

with:

```ts
  readonly moves: Readonly<Partial<Record<MoveSlot, MoveDef>>>;
  /**
   * `game_` scripts that replace a slot's compiled legacy move (see
   * `acmd/legacy.ts`). Empty for the whole roster in Plan 2.
   */
  readonly scripts?: Readonly<Partial<Record<MoveSlot, AcmdScript>>>;
  /** Palette used by the procedural renderer.
```

- [ ] **Step 4: Run it again**

Run: `pnpm vitest run src/engine/acmd/legacy.test.ts`
Expected: PASS.

- [ ] **Step 5: The golden trace must not move**

Run: `pnpm vitest run src/game/golden.test.ts`
Expected: PASS, unchanged. This task is a refactor: a divergence here is a bug in this task, not a fixture to regenerate.

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0. `pnpm lint` reports no errors and no warning in a file this task touched; any warnings it printed before this plan started (measure once, with Plan 1 merged, before Task 0) are unchanged.

- [ ] **Step 7: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/src/engine/acmd/legacy.test.ts \
  super-smash/src/engine/acmd/legacy.ts \
  super-smash/src/engine/types.ts
git commit -m "super-smash: every legacy move compiled to a game_ script, proven identical frame by frame" -m "411 roster cases: same hitboxes in the same order, same spawns, armour and momentum on every frame. FighterDef.scripts can override a slot." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: step() reads hitboxes, spawns, armour and momentum from game_ scripts

Switch `step()` over: hitboxes, projectile spawns, super armour and scripted momentum now come from the move's script through one helper, so the four can never disagree about the frame. The bone table arrives through `SimContext.bones` (default `LEGACY_BONE_TABLE`, which `registryContext` carries), never a global. The proof that it is a switch and not a rewrite: the golden trace does not move. New tests show the sim really reads the script — a jab whose script puts its hitbox overhead whiffs — and really reads the context's table: a table that lifts the root bone makes the same jab whiff.

**Files:**
- Create: `super-smash/src/engine/acmd/run.ts`
- Modify: `super-smash/src/engine/simulate.test.ts` — `"a status change during hitlag (Review Focus #2)"`, imports
- Modify: `super-smash/src/engine/simulate.ts` — `SimContext`, `candidates`, `move`, imports
- Modify: `super-smash/src/engine/states.ts` — `armour`, `applyMoveMomentum`, imports

**Interfaces:** Produces (`acmd/run.ts`): `interface MoveScriptFrame { script: AcmdScript; gameFrame: number; state: ScriptFrameState }`, `moveScriptFrame(def: FighterDef, f: Pick<FighterState, "move" | "actionFrame">): MoveScriptFrame | null`. `SimContext` gains `readonly bones?: BoneTable` (`registryContext.bones` is `LEGACY_BONE_TABLE`; absent means the same). Consumes `scriptHitboxes`, `LEGACY_BONE_TABLE` (Task 13), `gameScriptFor` (14).

- [ ] **Step 1: Write the failing test**

In `src/engine/simulate.test.ts`, replace:

```ts
describe("a status change during hitlag (Review Focus #2)", () => {
```

with:

```ts
describe("moves run from game_ scripts", () => {
  it("takes a fighter's hitboxes from its script, not its legacy table", () => {
    // The same jab, scripted with its only hitbox fifty units overhead: it must whiff.
    const away: FighterDef = {
      ...DEF,
      scripts: {
        jab1: {
          name: "game_attack11",
          motion: "attack_11",
          commands: [
            { op: "frame", frame: 4 },
            { op: "attack", params: { ...attackFromHitbox(DEF.moves.jab1!.hitboxes[0]), y: fx(50) } },
            { op: "frame", frame: 7 },
            { op: "clearAll" },
          ],
        },
      },
    };
    const ctx: SimContext = { fighter: () => away, stage: () => STAGE };
    let s = standing();
    let prev: readonly InputFrame[] = [0, 0];
    for (let i = 0; i < 10; i++) {
      const inputs = i === 0 ? [Btn.Attack, 0] : [0, 0];
      s = step(s, inputs, { prevInputs: prev, ctx }).state;
      prev = inputs;
    }
    expect(s.fighters[1].damage).toBe(0);
    // …and the unmodified roster entry still lands, so the whiff is the script's doing.
    expect(run(standing(), [Btn.Attack, 0], 8).fighters[1].damage).toBeGreaterThan(0);
  });

  it("places script hitboxes with the SimContext's bone table, not a global one", () => {
    // A table that lifts the root bone fifty units: the same jab must whiff.
    const lifted: BoneTable = {
      fingerprint: "00000000",
      pose(fighterId, motion, frame, bone, out) {
        if (!LEGACY_BONE_TABLE.pose(fighterId, motion, frame, bone, out)) return false;
        out.ty += fx(50);
        return true;
      },
    };
    const ctx: SimContext = { fighter: () => DEF, stage: () => STAGE, bones: lifted };
    let s = standing();
    let prev: readonly InputFrame[] = [0, 0];
    for (let i = 0; i < 10; i++) {
      const inputs = i === 0 ? [Btn.Attack, 0] : [0, 0];
      s = step(s, inputs, { prevInputs: prev, ctx }).state;
      prev = inputs;
    }
    expect(s.fighters[1].damage).toBe(0);
  });

  it("defaults to the root-bone table", () => {
    expect(registryContext.bones).toBe(LEGACY_BONE_TABLE);
  });
});

describe("a status change during hitlag (Review Focus #2)", () => {
```

In `src/engine/simulate.test.ts`, replace:

```ts
import { SHIELD_MAX_HEALTH } from "./constants";
```

with:

```ts
import { LEGACY_BONE_TABLE, type BoneTable } from "./acmd/bones";
import { attackFromHitbox } from "./acmd/legacy";
import { SHIELD_MAX_HEALTH } from "./constants";
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/engine/simulate.test.ts`
Expected: FAIL — 3 tests: "takes a fighter's hitboxes from its script" and "places script hitboxes with the SimContext's bone table" (`expected 43010 to be +0` — the defender is hit, because `gatherHitboxes` still reads `move.hitboxes`), and "defaults to the root-bone table" (`registryContext.bones` is `undefined`).

- [ ] **Step 3: Implement**

In `src/engine/simulate.ts`, replace:

```ts
export interface SimContext {
  fighter(id: string): FighterDef;
  stage(id: string): StageDef;
}
```

with:

```ts
export interface SimContext {
  fighter(id: string): FighterDef;
  stage(id: string): StageDef;
  /**
   * Where fighters' bones are, for script hitboxes (`acmd/bones.ts`). Absent
   * means the root-bone `LEGACY_BONE_TABLE`; Plan 4 passes its bake here.
   */
  readonly bones?: BoneTable;
}
```

In `src/engine/simulate.ts`, replace:

```ts
  stage(id) {
    const s = stageRegistry.get(id);
    if (s === undefined) throw new Error(`unregistered stage: ${id}`);
    return s;
  },
};
```

with:

```ts
  stage(id) {
    const s = stageRegistry.get(id);
    if (s === undefined) throw new Error(`unregistered stage: ${id}`);
    return s;
  },
  bones: LEGACY_BONE_TABLE,
};
```

In `src/engine/simulate.ts`, replace:

```ts
  const candidates = gatherHitboxes(s, defs, prevPos, frozen);
```

with:

```ts
  const candidates = gatherHitboxes(s, defs, prevPos, frozen, ctx.bones ?? LEGACY_BONE_TABLE);
```

In `src/engine/simulate.ts`, replace:

```ts
  prevPos: readonly { x: number; y: number }[],
  frozen: readonly boolean[],
): Candidate[] {
```

with:

```ts
  prevPos: readonly { x: number; y: number }[],
  frozen: readonly boolean[],
  bones: BoneTable,
): Candidate[] {
```

Create `src/engine/acmd/run.ts`:

```ts
/**
 * The one way the sim asks "what is this fighter's move doing this frame?".
 *
 * `step()` reads hitboxes, projectile spawns, super armour and scripted
 * momentum from the move's `game_` script through here (Plan 2, Task 15), so
 * the four can never disagree about which frame the move is on.
 */

import { moveFrameOf } from "../hitbox";
import type { FighterDef, FighterState } from "../types";
import { runScript } from "./interpreter";
import type { ScriptFrameState } from "./interpreter";
import { gameScriptFor } from "./legacy";
import type { AcmdScript } from "./types";

export interface MoveScriptFrame {
  readonly script: AcmdScript;
  /** `moveFrameOf(actionFrame)`: the move's game frame, quoted from 1. */
  readonly gameFrame: number;
  readonly state: ScriptFrameState;
}

export function moveScriptFrame(def: FighterDef, f: Pick<FighterState, "move" | "actionFrame">): MoveScriptFrame | null {
  if (f.move === null) return null;
  const script = gameScriptFor(def, f.move);
  if (script === null) return null;
  const gameFrame = moveFrameOf(f.actionFrame);
  return { script, gameFrame, state: runScript(script, gameFrame) };
}
```

In `src/engine/states.ts`, replace:

```ts
  const armour = def.moves[f.move]?.superArmourFrames;
  if (!armour) return false;
  const frame = moveFrameOf(f.actionFrame);
  return frame >= armour[0] && frame <= armour[1];
}
```

with:

```ts
  return moveScriptFrame(def, f)?.state.superArmour === true;
}
```

In `src/engine/states.ts`, replace:

```ts
function applyMoveMomentum(f: FighterState, ctx: StateContext): boolean {
  if (f.move === null) return false;
  if (f.action !== "attack" && f.action !== "special" && f.action !== "throw") return false;
  const impulses = ctx.def.moves[f.move]?.momentum;
  if (!impulses) return false;

  const frame = moveFrameOf(f.actionFrame);
  for (const m of impulses) {
    const until = m.frame + (m.hold ?? 0);
    if (frame < m.frame || frame > until) continue;
    f.vx = m.x * (f.facing >= 0 ? 1 : -1); // kinetic: legacy-write (Task 18 moves this to MOTION)
    f.vy = m.y; // kinetic: legacy-write (Task 18 moves this to MOTION)
    // The floor still wins. A downward impulse on a grounded fighter drove
    // them straight through the stage — a grounded Stone fell out of the world
    // — because this branch returns before the clamp at the bottom of
    // `applyMovement` that ordinarily stops that. A Stone used on the ground
    // simply sits there, which is also what it does in the real game.
    if (f.grounded && f.vy < 0) f.vy = 0; // kinetic: legacy-write (Task 18 moves this to MOTION)
    f.launchSpeed = 0;
    return frame < until;
  }
  return false;
}

```

with:

```ts
function applyMoveMomentum(f: FighterState, ctx: StateContext): boolean {
  if (f.move === null) return false;
  if (f.action !== "attack" && f.action !== "special" && f.action !== "throw") return false;
  const run = moveScriptFrame(ctx.def, f);
  const m = run?.state.momentum ?? null;
  if (run === null || m === null) return false;
  f.vx = m.x * (f.facing >= 0 ? 1 : -1); // kinetic: legacy-write (Task 18 moves this to MOTION)
  f.vy = m.y; // kinetic: legacy-write (Task 18 moves this to MOTION)
  // The floor still wins. A downward impulse on a grounded fighter drove
  // them straight through the stage — a grounded Stone fell out of the world
  // — because this branch returns before the clamp at the bottom of
  // `applyMovement` that ordinarily stops that. A Stone used on the ground
  // simply sits there, which is also what it does in the real game.
  if (f.grounded && f.vy < 0) f.vy = 0; // kinetic: legacy-write (Task 18 moves this to MOTION)
  f.launchSpeed = 0;
  return run.gameFrame < m.until;
}

```

In `src/engine/states.ts`, replace:

```ts
import { clearHitRecord, moveFrameOf } from "./hitbox";
```

with:

```ts
import { moveScriptFrame } from "./acmd/run";
import { clearHitRecord } from "./hitbox";
```

In `src/engine/simulate.ts`, replace:

```ts
    const move = defs[i].moves[f.move];
    if (move === undefined) continue;
    for (const hb of activeHitboxes(move, moveFrameOf(f.actionFrame))) {
```

with:

```ts
    const run = moveScriptFrame(defs[i], f);
    if (run === null) continue;
    const live = scriptHitboxes(run.state, defs[i].id, run.script.motion, run.gameFrame, bones);
    for (const hb of live) {
```

In `src/engine/simulate.ts`, replace:

```ts
    const move = defs[i].moves[f.move];
    if (move === undefined) continue;
    for (const def of projectilesDueOnFrame(move, f.actionFrame + 1)) {
```

with:

```ts
    const run = moveScriptFrame(defs[i], f);
    if (run === null) continue;
    for (const cmd of run.state.fired) {
      if (cmd.op !== "spawnProjectile") continue;
      const def = findProjectileDef(defs[i], cmd.id);
      if (def === undefined) continue;
```

In `src/engine/simulate.ts`, replace:

```ts
import "./status";
```

with:

```ts
import { LEGACY_BONE_TABLE, type BoneTable } from "./acmd/bones";
import { scriptHitboxes } from "./acmd/hitboxes";
import { moveScriptFrame } from "./acmd/run";
import "./status";
```

In `src/engine/simulate.ts`, replace:

```ts

  activeHitboxes,
```

with:

```ts

```

In `src/engine/simulate.ts`, replace:

```ts

  moveFrameOf,
```

with:

```ts

```

In `src/engine/simulate.ts`, replace:

```ts

  projectilesDueOnFrame,
```

with:

```ts

```

- [ ] **Step 4: Run it again**

Run: `pnpm vitest run src/engine/simulate.test.ts`
Expected: PASS.

- [ ] **Step 5: The golden trace must not move**

Run: `pnpm vitest run src/game/golden.test.ts`
Expected: PASS, unchanged. This task is a refactor: a divergence here is a bug in this task, not a fixture to regenerate.

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0. `pnpm lint` reports no errors and no warning in a file this task touched; any warnings it printed before this plan started (measure once, with Plan 1 merged, before Task 0) are unchanged.

- [ ] **Step 7: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/src/engine/acmd/run.ts \
  super-smash/src/engine/simulate.test.ts \
  super-smash/src/engine/simulate.ts \
  super-smash/src/engine/states.ts
git commit -m "super-smash: step() reads hitboxes, spawns, armour and momentum from game_ scripts" -m "One helper, moveScriptFrame, for all four. The bone table comes from SimContext.bones. Golden trace unchanged: the switch is exact." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Import the published game_ scripts for all eight fighters, self-checked and reconciled

Import the published scripts for all eight fighters. `scripts/import-acmd.mjs` fetches rubendal's Data Viewer JSON (decompiled `game_` text, `Motions` table) and SSBU-Calculator JSON (that project's own reading of each script's windows), parses the text with `src/fighters/acmd/parse.ts` (pure, no runtime imports, so Node can import the `.ts` file directly), and writes `src/fighters/acmd/generated/<fighter>.ts` as DSL source. Two tests keep it honest: the self-check compares our interpreter's windows with the calculator's for every imported script (five known disagreements, each checked against Ultimate Frame Data and documented), and the D17 reconciliation compares every legacy move with its script — first/last active frame, lead hitbox, FAF — against a committed allowlist that later plans may only shrink. The game does not run these scripts yet: they hang hitboxes off limb bones only Plan 4 can place.

**Files:**
- Create: `super-smash/scripts/import-acmd.mjs`
- Create: `super-smash/src/fighters/acmd/generated/donkeyKong.ts` (generated by a command in this task)
- Create: `super-smash/src/fighters/acmd/generated/fox.ts` (generated by a command in this task)
- Create: `super-smash/src/fighters/acmd/generated/kirby.ts` (generated by a command in this task)
- Create: `super-smash/src/fighters/acmd/generated/link.ts` (generated by a command in this task)
- Create: `super-smash/src/fighters/acmd/generated/mario.ts` (generated by a command in this task)
- Create: `super-smash/src/fighters/acmd/generated/marth.ts` (generated by a command in this task)
- Create: `super-smash/src/fighters/acmd/generated/pikachu.ts` (generated by a command in this task)
- Create: `super-smash/src/fighters/acmd/generated/samus.ts` (generated by a command in this task)
- Create: `super-smash/src/fighters/acmd/index.ts`
- Create: `super-smash/src/fighters/acmd/parse.test.ts`
- Create: `super-smash/src/fighters/acmd/parse.ts`
- Create: `super-smash/src/fighters/acmd/reconcile.allow.json` (generated by a command in this task)
- Create: `super-smash/src/fighters/acmd/reconcile.test.ts`
- Create: `super-smash/src/fighters/acmd/reference.test.ts`
- Create: `super-smash/src/fighters/acmd/reference.ts`

**Interfaces:** Produces: `parseArgs`, `unhash`, `parseLine`, `parseScript`, `type RawCommand` (`src/fighters/acmd/parse.ts`); `ReferenceFighter`, `CalculatorWindow` (`reference.ts`); `REFERENCE_SCRIPTS: Readonly<Record<string, ReferenceFighter>>` (`index.ts`); generated `MARIO`, `DONKEY_KONG`, `LINK`, `SAMUS`, `KIRBY`, `FOX`, `PIKACHU`, `MARTH`; `reconcile.allow.json` (`Record<"<fighter> <slot> <fact>", "legacy … / <script> …">`).

- [ ] **Step 1: Write the failing test**

Create `src/fighters/acmd/parse.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { parseArgs, parseLine, parseScript, unhash } from "./parse";

/**
 * Snippets quoted from rubendal's SSBU Data Viewer, patch 13.0.1
 * (https://rubendal.github.io/ssbu/data/patch/13.0.1/character/<Name>/data.json),
 * trimmed to the lines each test is about.
 */

describe("parseArgs", () => {
  it("splits key=value pairs and keeps values verbatim", () => {
    const a = parseArgs('ID=0, Part=0, Bone=hash40("top"), Damage=2.2, X2=LUA_VOID');
    expect(a).toEqual({ ID: "0", Part: "0", Bone: 'hash40("top")', Damage: "2.2", X2: "LUA_VOID" });
    expect(unhash(a.Bone)).toBe("top");
  });
});

describe("parseLine", () => {
  it("reads both spellings of frame and of FT_MOTION_RATE", () => {
    expect(parseLine("frame(Frame=16)")).toEqual({ op: "frame", frame: 16 });
    expect(parseLine("frame(0, 4)")).toEqual({ op: "frame", frame: 4 }); // Fox game_Attack100
    expect(parseLine("FT_MOTION_RATE(FSM=0.9)")).toEqual({ op: "motionRate", rate: 0.9 });
    expect(parseLine("FT_MOTION_RATE(0, 0.77)")).toEqual({ op: "motionRate", rate: 0.77 }); // Pikachu
  });

  it("reads the armour and intangibility commands", () => {
    expect(
      parseLine("damage(MSC=MA_MSC_DAMAGE_DAMAGE_NO_REACTION, Type=DAMAGE_NO_REACTION_MODE_ALWAYS, DamageThreshold=0)"),
    ).toEqual({ op: "superArmour", on: true });
    expect(
      parseLine("damage(MSC=MA_MSC_DAMAGE_DAMAGE_NO_REACTION, Type=DAMAGE_NO_REACTION_MODE_NORMAL, DamageThreshold=0)"),
    ).toEqual({ op: "superArmour", on: false });
    expect(parseLine("WHOLE_HIT(HIT_STATUS_XLU)")).toEqual({ op: "wholeHit", status: "HIT_STATUS_XLU" });
  });

  it("reads clears, grab clears, shield setoff and ATK_POWER", () => {
    expect(parseLine("AttackModule::clear(ID=3)")).toEqual({ op: "clear", id: 3 });
    expect(parseLine("grab(MA_MSC_CMD_GRAB_CLEAR_ALL)")).toEqual({ op: "catchClearAll" });
    expect(parseLine("grab(MA_MSC_CMD_GRAB_CLEAR, 1)")).toEqual({ op: "catchClear", id: 1 });
    expect(parseLine("ATK_SET_SHIELD_SETOFF_MUL(ID=0, ShieldstunMul=1.8)")).toEqual({
      op: "shieldSetoffMul",
      id: 0,
      mul: 1.8,
    });
    expect(parseLine("ATK_POWER(0, 5)")).toEqual({ op: "atkPower", id: 0, damage: 5 });
  });

  it("keeps anything it does not model, verbatim", () => {
    expect(parseLine("CAM_ZOOM_OUT()")).toEqual({ op: "unknown", raw: "CAM_ZOOM_OUT()" });
  });
});

describe("parseScript control flow", () => {
  it("makes is_excute blocks transparent", () => {
    const text = "frame(Frame=2)\nif(is_excute){\n\tAttackModule::clear_all()\n}\nwait(Frames=2)";
    expect(parseScript(text)).toEqual([{ op: "frame", frame: 2 }, { op: "clearAll" }, { op: "wait", frames: 2 }]);
  });

  it("turns for(N Iterations) into a loop — Mario's down air", () => {
    const text = [
      "frame(Frame=5)",
      "for(5 Iterations){",
      "\tif(is_excute){",
      "\t\tAttackModule::clear_all()",
      "\t}",
      "\twait(Frames=1)",
      "}",
    ].join("\n");
    expect(parseScript(text)).toEqual([
      { op: "frame", frame: 5 },
      { op: "loop", count: 5, body: [{ op: "clearAll" }, { op: "wait", frames: 1 }] },
    ]);
  });

  it("takes the first copy of a costume-flagged move and stops at the decompiler's duplicate — Mario's up special", () => {
    const text = [
      "WorkModule::is_flag(FIGHTER_MARIO_STATUS_SPECIAL_HI_FLAG_CAPPY)",
      "if(0xe1ba0(false, true)){",
      "\tframe(Frame=3)",
      "}",
      "wait(Frames=3)",
      "methodlib::L2CValue::operatorbool()const(is_excute)",
      "frame(Frame=1)",
    ].join("\n");
    const out = parseScript(text);
    expect(out.filter((c) => c.op === "frame")).toEqual([{ op: "frame", frame: 3 }]);
    expect(out.at(-1)).toEqual({ op: "wait", frames: 3 });
  });

  it("skips a Kirby-copy branch and takes its else — Marth's Shield Breaker", () => {
    const text = [
      "if(methodlib::L2CValue::operator==(lib::L2CValueconst&)const(FIGHTER_INSTANCE_WORK_ID_INT_KIND, FIGHTER_KIND_KIRBY)){",
      "\tAttackModule::clear(ID=9)",
      "}",
      "else{",
      "\tAttackModule::clear(ID=1)",
      "}",
    ].join("\n");
    expect(parseScript(text)).toEqual([{ op: "clear", id: 1 }]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/fighters/acmd/parse.test.ts`
Expected: FAIL — `parse.test.ts`: `Failed to resolve import "./parse"`.

- [ ] **Step 3: Implement**

Create `src/fighters/acmd/parse.ts`:

```ts
/**
 * Parser for the decompiled ACMD text in rubendal's SSBU Data Viewer
 * (https://rubendal.github.io/ssbu/data/patch/13.0.1/character/<Name>/data.json).
 *
 * Pure and dependency-free on purpose: `scripts/import-acmd.mjs` imports this
 * file straight from Node (which strips the types), and vitest imports it as
 * ordinary TypeScript. So: no runtime imports, no enums, no path aliases.
 *
 * Numbers stay decimal here. The generated TypeScript turns them into Q12 with
 * `fx()` at module load, exactly as the hand-written fighter files do.
 */

export type RawArgs = Readonly<Record<string, string>>;

export type RawCommand =
  | { readonly op: "frame"; readonly frame: number }
  | { readonly op: "wait"; readonly frames: number }
  | { readonly op: "attack"; readonly args: RawArgs }
  | { readonly op: "catch"; readonly args: RawArgs }
  | { readonly op: "clearAll" }
  | { readonly op: "clear"; readonly id: number }
  | { readonly op: "catchClearAll" }
  | { readonly op: "catchClear"; readonly id: number }
  | { readonly op: "motionRate"; readonly rate: number }
  | { readonly op: "setFlag"; readonly flag: string; readonly on: boolean }
  | { readonly op: "wholeHit"; readonly status: string }
  | { readonly op: "superArmour"; readonly on: boolean }
  | { readonly op: "shieldSetoffMul"; readonly id: number; readonly mul: number }
  | { readonly op: "atkPower"; readonly id: number; readonly damage: number }
  | { readonly op: "generateArticle"; readonly article: string }
  | { readonly op: "reverseLr" }
  | { readonly op: "loop"; readonly count: number; readonly body: readonly RawCommand[] }
  | { readonly op: "unknown"; readonly raw: string };

/** Split `A=1, B=hash40("x"), C=LUA_VOID` into a record, keeping values verbatim. */
export function parseArgs(inner: string): RawArgs {
  const out: Record<string, string> = {};
  for (const part of inner.split(/, (?=[A-Za-z_][A-Za-z_0-9]*=)/)) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

/** `hash40("top")` → `top`; anything else verbatim. */
export function unhash(v: string): string {
  const m = /^hash40\("([^"]*)"\)$/.exec(v);
  return m ? m[1] : v;
}

/** The last comma-separated argument as a number: the bare `frame(0, 12)` spelling. */
function lastNumber(inner: string): number {
  return Number(inner.split(",").pop());
}

export function parseLine(line: string): RawCommand {
  const call = /^([A-Za-z_][A-Za-z_0-9:]*)\((.*)\)$/.exec(line);
  if (!call) return { op: "unknown", raw: line };
  const [, name, inner] = call;
  switch (name) {
    case "frame": {
      // Two spellings in the dump: `frame(Frame=12)` and the bare `frame(0, 12)`.
      const named = parseArgs(inner).Frame;
      const n = named !== undefined ? Number(named) : lastNumber(inner);
      return Number.isFinite(n) ? { op: "frame", frame: n } : { op: "unknown", raw: line };
    }
    case "wait":
      return { op: "wait", frames: Number(parseArgs(inner).Frames) };
    case "ATTACK":
    case "ATTACK_IGNORE_THROW":
      return { op: "attack", args: parseArgs(inner) };
    case "CATCH":
      return { op: "catch", args: parseArgs(inner) };
    case "AttackModule::clear_all":
      return { op: "clearAll" };
    case "AttackModule::clear":
      return { op: "clear", id: Number(parseArgs(inner).ID) };
    case "grab": {
      const [cmd, id] = inner.split(",").map((t) => t.trim());
      if (cmd === "MA_MSC_CMD_GRAB_CLEAR_ALL") return { op: "catchClearAll" };
      if (cmd === "MA_MSC_CMD_GRAB_CLEAR") return { op: "catchClear", id: Number(id) };
      return { op: "unknown", raw: line };
    }
    case "FT_MOTION_RATE": {
      // `FT_MOTION_RATE(FSM=0.9)`, or the bare `FT_MOTION_RATE(0, 0.77)`.
      const named = parseArgs(inner).FSM;
      const r = named !== undefined ? Number(named) : lastNumber(inner);
      return Number.isFinite(r) && r > 0 ? { op: "motionRate", rate: r } : { op: "unknown", raw: line };
    }
    case "WorkModule::on_flag":
      return { op: "setFlag", flag: parseArgs(inner).Flag, on: true };
    case "WorkModule::off_flag":
      return { op: "setFlag", flag: parseArgs(inner).Flag, on: false };
    case "WHOLE_HIT":
      return { op: "wholeHit", status: inner.trim() };
    case "damage": {
      const a = parseArgs(inner);
      if (a.MSC !== "MA_MSC_DAMAGE_DAMAGE_NO_REACTION") return { op: "unknown", raw: line };
      return { op: "superArmour", on: a.Type === "DAMAGE_NO_REACTION_MODE_ALWAYS" };
    }
    case "ATK_SET_SHIELD_SETOFF_MUL": {
      const a = parseArgs(inner);
      return { op: "shieldSetoffMul", id: Number(a.ID), mul: Number(a.ShieldstunMul) };
    }
    case "ATK_POWER": {
      const [id, dmg] = inner.split(",").map((s) => Number(s.trim()));
      return { op: "atkPower", id, damage: dmg };
    }
    case "ArticleModule::generate_article":
      return { op: "generateArticle", article: inner.split(",")[0].trim() };
    case "REVERSE_LR":
      return { op: "reverseLr" };
    default:
      return { op: "unknown", raw: line };
  }
}

interface Block {
  /** What closes with the next `}`. */
  readonly kind: "excute" | "loop" | "taken" | "skipped";
  readonly count: number;
  readonly body: RawCommand[];
  /** For a conditional: whether its `else{` should be taken. */
  readonly elseTaken: boolean;
}

/**
 * Turn one script's text into commands.
 *
 * Control flow in the decompiled text is resolved here, once, by rule:
 * - `if(is_excute){ … }` is transparent.
 * - `for(N Iterations){ … }` becomes a `loop`.
 * - Any other `if(cond){ … }` is a branch on runtime state the replica does not
 *   model. Its body is taken unless the condition names `FIGHTER_KIND_KIRBY`
 *   (a copy-ability branch), and a following `else{ … }` takes the other side.
 * - A top-level `methodlib::L2CValue::operatorbool()const(is_excute)` marks the
 *   decompiler's duplicate of the alternative branch; parsing stops there.
 */
export function parseScript(text: string): RawCommand[] {
  const root: RawCommand[] = [];
  const stack: Block[] = [];
  let lastClosed: { elseTaken: boolean } | null = null;
  const target = (): RawCommand[] | null => {
    for (let i = stack.length - 1; i >= 0; i--) if (stack[i].kind === "skipped") return null;
    return stack.length === 0 ? root : stack[stack.length - 1].body;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "") continue;
    if (line === "}") {
      const b = stack.pop();
      if (b === undefined) continue;
      lastClosed = b.kind === "taken" || b.kind === "skipped" ? { elseTaken: b.elseTaken } : null;
      const out = target();
      if (b.kind === "loop" && out !== null && b.body.length > 0) out.push({ op: "loop", count: b.count, body: b.body });
      else if ((b.kind === "excute" || b.kind === "taken") && out !== null) out.push(...b.body);
      continue;
    }
    if (line === "else{") {
      const taken = lastClosed !== null && lastClosed.elseTaken;
      stack.push({ kind: taken ? "taken" : "skipped", count: 0, body: [], elseTaken: false });
      lastClosed = null;
      continue;
    }
    lastClosed = null;
    if (line === "if(is_excute){") {
      stack.push({ kind: "excute", count: 0, body: [], elseTaken: false });
      continue;
    }
    const loop = /^for\((\d+) Iterations\)\{$/.exec(line);
    if (loop) {
      stack.push({ kind: "loop", count: Number(loop[1]), body: [], elseTaken: false });
      continue;
    }
    if (line.startsWith("if(") && line.endsWith("{")) {
      const kirbyOnly = line.includes("FIGHTER_KIND_KIRBY");
      stack.push({ kind: kirbyOnly ? "skipped" : "taken", count: 0, body: [], elseTaken: kirbyOnly });
      continue;
    }
    if (line.startsWith("methodlib::L2CValue::operatorbool()const(is_excute)") && stack.length === 0) break;
    const out = target();
    if (out === null) continue;
    out.push(parseLine(line));
  }
  return root;
}
```

Create `src/fighters/acmd/reference.ts`:

```ts
/**
 * The shape of an imported fighter's reference `game_` scripts (Plan 2, Task 16).
 *
 * Generated by `scripts/import-acmd.mjs` into `generated/<fighter>.ts` from
 * rubendal's published data. Reference only in Plan 2: the sim still runs the
 * compiled legacy moves (`engine/acmd/legacy.ts`), because these scripts hang
 * hitboxes off limb bones that only Plan 4's bake can place. `reconcile.test.ts`
 * compares the two so every disagreement is listed rather than discovered.
 */

import type { AcmdScript } from "@/engine/acmd/types";
import type { MoveSlot } from "@/engine/types";

/** One calculator hitbox window: [ATTACK id, first frame, last frame], inclusive; last −1 = until the script ends. */
export type CalculatorWindow = readonly [id: number, first: number, last: number];

export interface ReferenceFighter {
  readonly fighter: string;
  /** Which script each move slot plays, where the data has one. */
  readonly slots: Readonly<Partial<Record<MoveSlot, string>>>;
  readonly scripts: Readonly<Record<string, AcmdScript>>;
  /** First actionable frame per script (`Motions[*].CancelFrame`), where the data gives one. */
  readonly faf: Readonly<Record<string, number>>;
  /** The calculator's own reading of each script's hitbox windows, for the parser self-check. */
  readonly calculatorWindows: Readonly<Record<string, readonly CalculatorWindow[]>>;
}
```

Create `scripts/import-acmd.mjs`:

```js
/**
 * Import the eight fighters' published `game_` scripts as TypeScript.
 *
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/import-acmd.mjs
 *   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/import-acmd.mjs --offline
 *
 * Sources (published numbers only, DECISIONS D17):
 *   - rubendal's SSBU Data Viewer, patch 13.0.1 — the decompiled `game_` script
 *     text and the `Motions` table:
 *     https://rubendal.github.io/ssbu/data/patch/13.0.1/character/<Name>/data.json
 *   - rubendal's SSBU-Calculator data — that project's own reading of each
 *     script's hitbox windows, used only to self-check our parser:
 *     https://raw.githubusercontent.com/rubendal/SSBU-Calculator/gh-pages/Data/<fighter>/data.json
 *
 * Downloads are cached in $ACMD_CACHE (default node_modules/.cache/import-acmd,
 * never committed). The output, src/fighters/acmd/generated/*.ts, is committed;
 * rerun only to refresh it. Plain Node, no build step: the parser is imported as
 * TypeScript straight from src/ (Node strips the types), which is why
 * `parse.ts` has no runtime imports.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parseScript, unhash } from "../src/fighters/acmd/parse.ts";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = process.env.ACMD_CACHE ?? join(ROOT, "node_modules", ".cache", "import-acmd");
const OUT = join(ROOT, "src", "fighters", "acmd", "generated");
const OFFLINE = process.argv.includes("--offline");

const ROSTER = [
  { id: "mario", viewer: "Mario", calc: "mario", constant: "MARIO" },
  { id: "donkeyKong", viewer: "Donkey Kong", calc: "donkey", constant: "DONKEY_KONG" },
  { id: "link", viewer: "Link", calc: "link", constant: "LINK" },
  { id: "samus", viewer: "Samus", calc: "samus", constant: "SAMUS" },
  { id: "kirby", viewer: "Kirby", calc: "kirby", constant: "KIRBY" },
  { id: "fox", viewer: "Fox", calc: "fox", constant: "FOX" },
  { id: "pikachu", viewer: "Pikachu", calc: "pikachu", constant: "PIKACHU" },
  { id: "marth", viewer: "Marth", calc: "marth", constant: "MARTH" },
];

const viewerUrl = (name) =>
  `https://rubendal.github.io/ssbu/data/patch/13.0.1/character/${encodeURIComponent(name)}/data.json`;
const calcUrl = (name) => `https://raw.githubusercontent.com/rubendal/SSBU-Calculator/gh-pages/Data/${name}/data.json`;

/** Script names each slot may use, in preference order. The first one present wins. */
const SLOT_CANDIDATES = {
  jab1: ["Attack11"],
  jab2: ["Attack12"],
  jab3: ["Attack13"],
  rapidJab: ["Attack100"],
  ftilt: ["AttackS3", "AttackS3S"],
  utilt: ["AttackHi3"],
  dtilt: ["AttackLw3"],
  dashAttack: ["AttackDash"],
  fsmash: ["AttackS4", "AttackS4S"],
  usmash: ["AttackHi4"],
  dsmash: ["AttackLw4"],
  nair: ["AttackAirN"],
  fair: ["AttackAirF"],
  bair: ["AttackAirB"],
  uair: ["AttackAirHi"],
  dair: ["AttackAirLw"],
  neutralB: ["SpecialN", "SpecialNStart"],
  sideB: ["SpecialS", "SpecialS1", "SpecialSStart"],
  upB: ["SpecialHi", "SpecialHi1"],
  downB: ["SpecialLw", "SpecialLwStart"],
  grab: ["Catch"],
  dashGrab: ["CatchDash"],
  pummel: ["CatchAttack"],
  fthrow: ["ThrowF"],
  bthrow: ["ThrowB"],
  uthrow: ["ThrowHi"],
  dthrow: ["ThrowLw"],
  ledgeAttack: ["CliffAttack"],
  getUpAttack: ["DownAttackU"],
  finalSmash: ["Final", "FinalStart"],
};

const HIT_STATUS = new Set(["HIT_STATUS_NORMAL", "HIT_STATUS_XLU", "HIT_STATUS_INVINCIBLE", "HIT_STATUS_OFF"]);

async function fetchJson(url, file) {
  const path = join(CACHE, file);
  if (existsSync(path)) return JSON.parse(readFileSync(path, "utf8"));
  if (OFFLINE) throw new Error(`--offline and no cache for ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  const text = await res.text();
  mkdirSync(CACHE, { recursive: true });
  writeFileSync(path, text);
  return JSON.parse(text);
}

const num = (v) => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) ? n : null;
};
const lit = (v) => JSON.stringify(v);

/** An `ATTACK(...)` argument list as an `AttackSpec` literal, defaults omitted. */
function attackSpec(a) {
  const parts = [`id: ${num(a.ID)}`];
  if (num(a.Part)) parts.push(`part: ${num(a.Part)}`);
  parts.push(`bone: ${lit(unhash(a.Bone))}`);
  for (const [key, field] of [
    ["damage", "Damage"],
    ["angle", "Angle"],
    ["kbg", "KBG"],
  ]) {
    parts.push(`${key}: ${num(a[field]) ?? 0}`);
  }
  if (num(a.FKB)) parts.push(`fkb: ${num(a.FKB)}`);
  parts.push(`bkb: ${num(a.BKB) ?? 0}`, `size: ${num(a.Size) ?? 0}`);
  for (const k of ["X", "Y", "Z"]) parts.push(`${k.toLowerCase()}: ${num(a[k]) ?? 0}`);
  for (const k of ["X2", "Y2", "Z2"]) if (num(a[k]) !== null) parts.push(`${k.toLowerCase()}: ${num(a[k])}`);
  if (num(a.Hitlag) !== null && num(a.Hitlag) !== 1) parts.push(`hitlag: ${num(a.Hitlag)}`);
  if (num(a.SDI) !== null && num(a.SDI) !== 1) parts.push(`sdi: ${num(a.SDI)}`);
  if (a.Clang_Rebound && a.Clang_Rebound !== "ATTACK_SETOFF_KIND_ON") parts.push(`clang: ${lit(a.Clang_Rebound)}`);
  if (a.FacingRestrict && a.FacingRestrict !== "ATTACK_LR_CHECK_F") parts.push(`facing: ${lit(a.FacingRestrict)}`);
  if (a.SetWeight === "true") parts.push("setWeight: true");
  if (num(a.ShieldDamage)) parts.push(`shieldDamage: ${num(a.ShieldDamage)}`);
  if (num(a.Trip)) parts.push(`trip: ${num(a.Trip)}`);
  if (num(a.Rehit)) parts.push(`rehit: ${num(a.Rehit)}`);
  for (const [key, field] of [
    ["reflectable", "Reflectable"],
    ["absorbable", "Absorbable"],
    ["flinchless", "Flinchless"],
    ["noHitlag", "DisableHitlag"],
  ]) {
    if (a[field] === "true") parts.push(`${key}: true`);
  }
  if (a.Direct_Hitbox === "false") parts.push("direct: false");
  if (a.Ground_or_Air && a.Ground_or_Air !== "COLLISION_SITUATION_MASK_GA") parts.push(`situation: ${lit(a.Ground_or_Air)}`);
  const attr = a.Effect ? unhash(a.Effect) : "collision_attr_normal";
  if (attr !== "collision_attr_normal") parts.push(`collisionAttr: ${lit(attr)}`);
  if (a.Type) parts.push(`region: ${lit(a.Type)}`);
  return `{ ${parts.join(", ")} }`;
}

function catchSpec(a) {
  const parts = [`id: ${num(a.ID)}`, `bone: ${lit(unhash(a.Bone))}`, `size: ${num(a.Size) ?? 0}`];
  for (const k of ["X", "Y", "Z"]) parts.push(`${k.toLowerCase()}: ${num(a[k]) ?? 0}`);
  for (const k of ["X2", "Y2", "Z2"]) if (num(a[k]) !== null) parts.push(`${k.toLowerCase()}: ${num(a[k])}`);
  if (a.Status) parts.push(`status: ${lit(a.Status)}`);
  if (a.Ground_or_Air) parts.push(`situation: ${lit(a.Ground_or_Air)}`);
  return `{ ${parts.join(", ")} }`;
}

/** One parsed command as DSL source, recording which builders it used. */
function emit(c, used, indent) {
  const u = (name) => (used.add(name), name);
  switch (c.op) {
    case "frame":
      return `${u("frame")}(${c.frame})`;
    case "wait":
      return `${u("wait")}(${c.frames})`;
    case "attack":
      return `${u("ATTACK")}(${attackSpec(c.args)})`;
    case "catch":
      return `${u("CATCH")}(${catchSpec(c.args)})`;
    case "clearAll":
      return `${u("clearAll")}()`;
    case "clear":
      return `${u("clear")}(${c.id})`;
    case "catchClearAll":
      return `${u("catchClearAll")}()`;
    case "catchClear":
      return `${u("catchClear")}(${c.id})`;
    case "motionRate":
      return `${u("motionRate")}(${c.rate})`;
    case "setFlag":
      return `${u("setFlag")}(${lit(c.flag)}${c.on ? "" : ", false"})`;
    case "wholeHit":
      return HIT_STATUS.has(c.status)
        ? `${u("wholeHit")}(${lit(c.status)})`
        : `${u("unknown")}(${lit(`WHOLE_HIT(${c.status})`)})`;
    case "superArmour":
      return `${u("superArmour")}(${c.on})`;
    case "shieldSetoffMul":
      return `${u("shieldSetoffMul")}(${c.id}, ${c.mul})`;
    case "atkPower":
      return `${u("atkPower")}(${c.id}, ${c.damage})`;
    case "reverseLr":
      return `${u("reverseLr")}()`;
    case "generateArticle":
      return `${u("unknown")}(${lit(`ArticleModule::generate_article(${c.article})`)})`;
    case "loop": {
      const pad = " ".repeat(indent + 2);
      const body = c.body.map((b) => `${pad}${emit(b, used, indent + 2)},`).join("\n");
      return `${u("loop")}(${c.count}, [\n${body}\n${" ".repeat(indent)}])`;
    }
    default:
      return `${u("unknown")}(${lit(c.raw)})`;
  }
}

/** Motion kind and first actionable frame for a script, from the viewer's `Motions` tables. */
function motionOf(viewer, scriptName) {
  const hash = `game_${scriptName.toLowerCase()}`;
  for (const group of Object.values(viewer.Motions)) {
    for (const m of Object.values(group)) {
      if (m.GameHash === hash) return { kind: m.MotionKind, faf: m.CancelFrame };
    }
  }
  return { kind: scriptName.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase(), faf: 0 };
}

async function importFighter(f) {
  const viewer = await fetchJson(viewerUrl(f.viewer), `viewer-${f.id}.json`);
  const calc = await fetchJson(calcUrl(f.calc), `calc-${f.id}.json`);
  const texts = new Map(viewer.Scripts[viewer.GameName].map((s) => [s.Name, s.Data]));

  const slots = {};
  const scripts = [];
  const faf = {};
  const used = new Set(["script"]);
  for (const [slot, candidates] of Object.entries(SLOT_CANDIDATES)) {
    const name = candidates.find((c) => texts.has(c));
    if (name === undefined) continue;
    const key = `game_${name.toLowerCase()}`;
    slots[slot] = key;
    if (scripts.some((s) => s.key === key)) continue;
    const { kind, faf: cancel } = motionOf(viewer, name);
    if (cancel > 0) faf[key] = cancel;
    const body = parseScript(texts.get(name))
      .map((c) => `      ${emit(c, used, 6)},`)
      .join("\n");
    scripts.push({ key, source: `    ${key}: script(${lit(key)}, ${lit(kind)}, [\n${body}\n    ]),` });
  }

  const windows = {};
  const wanted = new Set(Object.values(slots));
  for (const t of calc.MoveTypes) {
    for (const m of t.Moves) {
      for (const h of m.Hitboxes) {
        const key = h.Script.toLowerCase();
        if (h.Article !== viewer.GameName || !wanted.has(key)) continue;
        (windows[key] ??= []).push(`[${Number(h.Id)}, ${h.StartFrame}, ${h.EndFrame === 0 ? -1 : h.EndFrame - 1}]`);
      }
    }
  }

  const lines = [
    "// GENERATED by scripts/import-acmd.mjs — do not edit by hand.",
    `// Scripts and motions: ${viewerUrl(f.viewer)}`,
    `// Calculator windows: ${calcUrl(f.calc)}`,
    "",
    "import {",
    ...[...used].sort().map((name) => `  ${name},`),
    '} from "@/engine/acmd/dsl";',
    'import type { ReferenceFighter } from "../reference";',
    "",
    `export const ${f.constant}: ReferenceFighter = {`,
    `  fighter: ${lit(f.id)},`,
    "  slots: {",
    ...Object.entries(slots).map(([slot, key]) => `    ${slot}: ${lit(key)},`),
    "  },",
    "  scripts: {",
    ...scripts.map((s) => s.source),
    "  },",
    "  faf: {",
    ...Object.entries(faf).map(([key, frame]) => `    ${key}: ${frame},`),
    "  },",
    "  calculatorWindows: {",
    ...Object.entries(windows).map(([k, w]) => `    ${k}: [${w.join(", ")}],`),
    "  },",
    "};",
    "",
  ];
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, `${f.id}.ts`), lines.join("\n"));
  return { id: f.id, scripts: scripts.length };
}

for (const f of ROSTER) {
  const r = await importFighter(f);
  console.log(`${r.id}: ${r.scripts} scripts`);
}
```

- [ ] **Step 4: Run the importer**

Run (needs the network once; downloads are cached): `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/import-acmd.mjs`
Expected output, exactly:

```
mario: 28 scripts
donkeyKong: 28 scripts
link: 29 scripts
samus: 28 scripts
kirby: 29 scripts
fox: 29 scripts
pikachu: 27 scripts
marth: 27 scripts
```

and eight files in `src/fighters/acmd/generated/` (about 284 KB together; each begins with the `// GENERATED by scripts/import-acmd.mjs` header and the two source URLs). If a count differs, the published data changed since 2026-10-24: stop and report the difference rather than editing the generated files.

- [ ] **Step 5: Write the index's tests: self-check and reconciliation**

Create `src/fighters/acmd/reference.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { runScript } from "@/engine/acmd/interpreter";
import type { AcmdScript } from "@/engine/acmd/types";
import { REFERENCE_SCRIPTS } from "./index";

/** How far to run a script looking for windows; longer than any move here. */
const HORIZON = 300;

/**
 * Our interpreter's windows for a script: "id:first-last", last −1 when still
 * open at the horizon. A slot issued again — new arguments, or the same ones
 * after a clear on the same frame (a multihit loop) — starts a new window, as
 * the calculator lists it.
 */
function windows(s: AcmdScript): string[] {
  const out: string[] = [];
  const open = new Map<number, number>();
  for (let g = 1; g <= HORIZON; g++) {
    const st = runScript(s, g);
    const live = new Set(st.attacks.map((a) => a.id));
    const issued = new Set(st.fired.flatMap((c) => (c.op === "attack" ? [c.params.id] : [])));
    for (const [id, from] of [...open]) {
      if (live.has(id) && !issued.has(id)) continue;
      out.push(`${id}:${from}-${g - 1}`);
      open.delete(id);
    }
    for (const id of live) if (!open.has(id)) open.set(id, g);
  }
  for (const [id, from] of open) out.push(`${id}:${from}--1`);
  return out.sort();
}

/**
 * Where the calculator reads a script differently from us, and why we keep
 * ours. Each was checked against Ultimate Frame Data (ultimateframedata.com):
 * - mario game_specialhi: the dump holds two copies of the move behind a
 *   costume flag; we take the first, frame 3 (UFD: Super Jump Punch 3), the
 *   calculator the second, which starts on 1.
 * - fox game_attackhi3: `ATK_POWER` weakens a live hitbox on frame 6; the
 *   calculator splits it into 3–4 and 6–7 and drops frame 5. UFD: 3—5(6—7).
 * - fox game_attack100: a decompiler `wait_loop_clear` the calculator reads as
 *   a zero-length window.
 * - pikachu game_throwlw, game_final: zero-length windows on the calculator's
 *   side (EndFrame before StartFrame).
 * Anything new here is a parser regression or a data change: look before
 * adding it.
 */
const KNOWN_DISAGREEMENTS: readonly string[] = [
  "fox game_attack100",
  "fox game_attackhi3",
  "mario game_specialhi",
  "pikachu game_final",
  "pikachu game_throwlw",
];

describe("the ACMD importer reads scripts as the calculator does", () => {
  it("agrees on every hitbox window except the documented few", () => {
    const disagree: string[] = [];
    let compared = 0;
    for (const ref of Object.values(REFERENCE_SCRIPTS)) {
      for (const [key, calc] of Object.entries(ref.calculatorWindows)) {
        compared += 1;
        const theirs = calc.map(([id, a, b]) => `${id}:${a}-${b}`).sort();
        const ours = windows(ref.scripts[key]);
        const missing = theirs.filter((w) => !ours.includes(w));
        const extra = ours.filter((w) => !theirs.includes(w));
        if (missing.length > 0 || extra.length > 0) disagree.push(`${ref.fighter} ${key}`);
      }
    }
    expect(compared).toBeGreaterThan(100);
    expect(disagree.sort()).toEqual([...KNOWN_DISAGREEMENTS].sort());
  });
});
```

Create `src/fighters/acmd/reconcile.test.ts`:

```ts
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runScript } from "@/engine/acmd/interpreter";
import { toFloat } from "@/engine/fixed";
import { activeHitboxes } from "@/engine/hitbox";
import type { MoveDef, MoveSlot } from "@/engine/types";
import { FIGHTERS } from "../index";
import { REFERENCE_SCRIPTS } from "./index";

/**
 * DECISIONS D17, kept honest: the roster's hand-authored moves against the
 * scripts they were transcribed from.
 *
 * For every move with both, four facts are compared — first active frame,
 * last active frame, the lowest-id hitbox's damage/angle/knockback on that
 * first frame, and first actionable frame (`CancelFrame`, which is the legacy
 * `totalFrames + 1`). Every disagreement is listed in `reconcile.allow.json`
 * with its value on each side. The list is a ratchet: it may shrink (Plan 3
 * adopts the scripts and deletes entries) but a new entry fails this test until
 * a human looks at it. Regenerate after a deliberate change with
 *
 *   UPDATE_RECONCILE=1 pnpm vitest run src/fighters/acmd/reconcile.test.ts
 */

const ALLOW_FILE = join(process.cwd(), "src", "fighters", "acmd", "reconcile.allow.json");
const HORIZON = 300;

interface Facts {
  first: number;
  last: number;
  lead: string;
  faf: number;
}

const fmt = (n: number): string => String(Math.round(toFloat(n) * 1000) / 1000);

function legacyFacts(move: MoveDef): Facts | null {
  let first = -1;
  let last = -1;
  for (let g = 1; g <= move.totalFrames + 1; g++) {
    if (activeHitboxes(move, g).length === 0) continue;
    if (first < 0) first = g;
    last = g;
  }
  if (first < 0) return null;
  const lead = activeHitboxes(move, first).sort((a, b) => a.id - b.id)[0];
  const kb = lead.setKnockback ? `fkb${fmt(lead.baseKnockback)}` : `bkb${fmt(lead.baseKnockback)}`;
  return {
    first,
    last,
    lead: lead.grabbing ? "grab" : `${fmt(lead.damage)}%/${fmt(lead.angle)}°/${kb}/kbg${fmt(lead.knockbackGrowth)}`,
    faf: move.totalFrames + 1,
  };
}

function referenceFacts(fighter: string, key: string): Facts | null {
  const ref = REFERENCE_SCRIPTS[fighter];
  const s = ref.scripts[key];
  let first = -1;
  let last = -1;
  for (let g = 1; g <= HORIZON; g++) {
    const st = runScript(s, g);
    if (st.attacks.length + st.catches.length === 0) continue;
    if (first < 0) first = g;
    last = g;
  }
  if (first < 0) return null;
  const a = runScript(s, first).attacks[0];
  const kb = a === undefined ? "" : a.fkb > 0 ? `fkb${fmt(a.fkb)}` : `bkb${fmt(a.bkb)}`;
  return {
    first,
    last,
    lead: a === undefined ? "grab" : `${fmt(a.damage)}%/${fmt(a.angle)}°/${kb}/kbg${fmt(a.kbg)}`,
    faf: ref.faf[key] ?? -1,
  };
}

function disagreements(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const def of FIGHTERS) {
    const ref = REFERENCE_SCRIPTS[def.id];
    for (const slot of Object.keys(def.moves) as MoveSlot[]) {
      const key = ref.slots[slot];
      const move = def.moves[slot];
      if (key === undefined || move === undefined) continue;
      const mine = legacyFacts(move);
      const theirs = referenceFacts(def.id, key);
      if (mine === null || theirs === null) {
        if (mine !== theirs) {
          out[`${def.id} ${slot} hitboxes`] = `legacy ${mine === null ? "none" : "some"} / ${key} ${theirs === null ? "none" : "some"}`;
        }
        continue;
      }
      for (const k of ["first", "last", "lead", "faf"] as const) {
        if (k === "faf" && theirs.faf < 0) continue;
        if (mine[k] !== theirs[k]) out[`${def.id} ${slot} ${k}`] = `legacy ${mine[k]} / ${key} ${theirs[k]}`;
      }
    }
  }
  return out;
}

describe("legacy moves against their imported scripts (D17)", () => {
  const now = disagreements();

  if (process.env.UPDATE_RECONCILE === "1") {
    it("writes the allowlist", () => {
      writeFileSync(ALLOW_FILE, JSON.stringify(now, null, 2) + "\n");
      expect(Object.keys(now).length).toBeGreaterThanOrEqual(0);
    });
    return;
  }

  it("disagree only where the allowlist says they do, and say how", () => {
    const allowed = JSON.parse(readFileSync(ALLOW_FILE, "utf8")) as Record<string, string>;
    expect(now).toEqual(allowed);
  });
});
```

- [ ] **Step 6: Run them and watch them fail**

Run: `pnpm vitest run src/fighters/acmd/reconcile.test.ts src/fighters/acmd/reference.test.ts`
Expected: FAIL — `reference.test.ts` and `reconcile.test.ts`: `Failed to resolve import "./index"`.

- [ ] **Step 7: Implement the index, then record the reconciliation**

Create `src/fighters/acmd/index.ts`:

```ts
/**
 * Every fighter's imported reference scripts, by fighter id (Plan 2, Task 16).
 * Not imported by the game: only the reconciliation and self-check tests read it.
 */

import { DONKEY_KONG } from "./generated/donkeyKong";
import { FOX } from "./generated/fox";
import { KIRBY } from "./generated/kirby";
import { LINK } from "./generated/link";
import { MARIO } from "./generated/mario";
import { MARTH } from "./generated/marth";
import { PIKACHU } from "./generated/pikachu";
import { SAMUS } from "./generated/samus";
import type { ReferenceFighter } from "./reference";

export const REFERENCE_SCRIPTS: Readonly<Record<string, ReferenceFighter>> = {
  mario: MARIO,
  donkeyKong: DONKEY_KONG,
  link: LINK,
  samus: SAMUS,
  kirby: KIRBY,
  fox: FOX,
  pikachu: PIKACHU,
  marth: MARTH,
};
```

Run: `UPDATE_RECONCILE=1 pnpm vitest run src/fighters/acmd/reconcile.test.ts`
Expected: 1 test passes and `src/fighters/acmd/reconcile.allow.json` is written. When this plan was validated it held 136 entries — by fact: `faf` 28, `lead` 44, `last` 20, `hitboxes` 27, `first` 17 — for example `"mario dair lead": "legacy 1.4%/94°/fkb50/kbg15 / game_attackairlw 1.4%/94°/bkb50/kbg15"` (the roster marks Mario's drill hits as set knockback; the script uses set *weight*). Read it: it is the to-do list Plan 3 works through, not something to fix here.

- [ ] **Step 8: Run it again**

Run: `pnpm vitest run src/fighters/acmd/parse.test.ts src/fighters/acmd/reconcile.test.ts src/fighters/acmd/reference.test.ts`
Expected: PASS.

- [ ] **Step 9: The golden trace must not move**

Run: `pnpm vitest run src/game/golden.test.ts`
Expected: PASS, unchanged. This task is a refactor: a divergence here is a bug in this task, not a fixture to regenerate.

- [ ] **Step 10: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0. `pnpm lint` reports no errors and no warning in a file this task touched; any warnings it printed before this plan started (measure once, with Plan 1 merged, before Task 0) are unchanged.

- [ ] **Step 11: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/scripts/import-acmd.mjs \
  super-smash/src/fighters/acmd/generated/donkeyKong.ts \
  super-smash/src/fighters/acmd/generated/fox.ts \
  super-smash/src/fighters/acmd/generated/kirby.ts \
  super-smash/src/fighters/acmd/generated/link.ts \
  super-smash/src/fighters/acmd/generated/mario.ts \
  super-smash/src/fighters/acmd/generated/marth.ts \
  super-smash/src/fighters/acmd/generated/pikachu.ts \
  super-smash/src/fighters/acmd/generated/samus.ts \
  super-smash/src/fighters/acmd/index.ts \
  super-smash/src/fighters/acmd/parse.test.ts \
  super-smash/src/fighters/acmd/parse.ts \
  super-smash/src/fighters/acmd/reconcile.allow.json \
  super-smash/src/fighters/acmd/reconcile.test.ts \
  super-smash/src/fighters/acmd/reference.test.ts \
  super-smash/src/fighters/acmd/reference.ts
git commit -m "super-smash: import the published game_ scripts for all eight fighters, self-checked and reconciled (D17)" -m "scripts/import-acmd.mjs reads rubendal's Data Viewer and SSBU-Calculator data; generated scripts are reference-only until Plan 4's bone bake. The self-check agrees with the calculator on every window but five documented disagreements; reconcile.allow.json lists every way the legacy moves differ from their scripts, as a ratchet." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: The DAMAGE energy: a launch decays on its own while gravity and drift apply

The first behaviour change. A launch moves to the DAMAGE energy and decays by 0.051 a frame on its own, while gravity builds from zero beside it and — once hitstun ends — the stick drifts CONTROL while the launch keeps decaying (SmashWiki "Knockback": launch speed "decays by 0.051 every frame … air friction [is] disabled; however, falling speed still takes effect"). Before, the decay rescaled `vx`/`vy` together with the gravity already folded into them, and whatever launch speed was left when hitstun ended stayed in `vx` for good. Landing hands the launch's horizontal part to STOP; a wall or ceiling removes its component and re-derives `launchSpeed`.

**Files:**
- Modify: `super-smash/src/engine/kinetic.test.ts` — imports
- Modify: `super-smash/src/engine/kinetic.ts` — imports, `kineticSetX`, `kineticSetY`, `kineticLaunch`
- Modify: `super-smash/src/engine/physics.ts` — imports
- Modify: `super-smash/src/engine/states.ts` — `applyMovement`
- Modify: `super-smash/src/game/__golden__/engine-trace.json` (regenerated by a command in this task)

**Interfaces:** Produces (`kinetic.ts`): `kineticDecayDamage(f, decay)`, `kineticReel(f: FighterState, p: FighterParams, balloon: boolean): void`, `kineticLand(f)`. `kineticLaunch` now writes DAMAGE; `kineticSetX/Y` re-derive `launchSpeed` when they remove a damage component; `kineticExec` decays a live launch every frame.

- [ ] **Step 1: Write the failing test**

In `src/engine/kinetic.test.ts`, replace:

```ts
import { fx } from "./fixed";
import {
  emptyKinetic,
  kineticAdopt,
  kineticClear,
  kineticExec,
  kineticSum,
  kineticSumX,
  kineticSumY,
} from "./kinetic";
```

with:

```ts
import { LAUNCH_SPEED_DECAY } from "./constants";
import { fx } from "./fixed";
import {
  emptyKinetic,
  kineticAdopt,
  kineticClear,
  kineticExec,
  kineticLand,
  kineticLaunch,
  kineticReel,
  kineticSetX,
  kineticSetY,
  kineticSum,
  kineticSumX,
  kineticSumY,
} from "./kinetic";
```

Append to the end of `src/engine/kinetic.test.ts`:

```ts

/* ------------------------------------------------- DAMAGE energy (Task 17) -- */

describe("the DAMAGE energy: a launch decays on its own", () => {
  // SmashWiki "Knockback" (https://www.ssbwiki.com/Knockback): knockback × 0.03 is
  // launch speed, which "then decays by 0.051 every frame … air friction [is]
  // disabled; however, falling speed still takes effect".
  const launch = (): FighterState => {
    const f = body({}, { grounded: false });
    kineticLaunch(f, fx(3), fx(4), fx(5));
    return f;
  };

  it("replaces every other energy at the moment of launch", () => {
    const f = body({ controlX: fx(1), stopX: fx(1), gravityY: -fx(1), motionX: fx(1) }, { grounded: false });
    kineticLaunch(f, fx(3), fx(4), fx(5));
    expect(f.kinetic).toMatchObject({ controlX: 0, stopX: 0, gravityY: 0, motionX: 0, damageX: fx(3), damageY: fx(4) });
    expect([f.vx, f.vy, f.launchSpeed]).toEqual([fx(3), fx(4), fx(5)]);
  });

  it("loses exactly 0.051 of launch speed per frame while gravity builds separately", () => {
    const f = launch();
    for (let frame = 1; frame <= 20; frame++) {
      kineticReel(f, PARAMS, false);
      expect(f.launchSpeed).toBe(fx(5) - frame * LAUNCH_SPEED_DECAY);
      expect(f.kinetic.gravityY).toBe(-Math.min(frame * PARAMS.air_accel_y, PARAMS.air_speed_y_stable));
      expect(f.vy).toBe(f.kinetic.damageY + f.kinetic.gravityY);
    }
  });

  it("keeps the launch's direction as it shrinks", () => {
    const f = launch();
    for (let i = 0; i < 30; i++) kineticReel(f, PARAMS, false);
    // 3:4 at every step, to within one Q12 unit of truncation per frame.
    expect(Math.abs(f.kinetic.damageX * 4 - f.kinetic.damageY * 3)).toBeLessThan(4 * 30);
  });

  it("falls from a vertical launch by the damage_fly_top gravity and fall speed", () => {
    // fighter_param.prc damage_fly_top_air_accel_y / damage_fly_top_speed_y_stable
    // (calculator DamageFlyTopGravity / DamageFlyTopFallSpeed, 1.8 for the whole roster).
    const p = { ...PARAMS, damage_fly_top_air_accel_y: fx(0.05), damage_fly_top_speed_y_stable: fx(1.5) };
    const f = body({}, { grounded: false });
    kineticLaunch(f, 0, fx(1), fx(1));
    kineticReel(f, p, true);
    expect(f.kinetic.gravityY).toBe(-fx(0.05));
    for (let i = 0; i < 200; i++) kineticReel(f, p, true);
    expect(f.kinetic.gravityY).toBe(-fx(1.5));
  });

  it("keeps decaying after hitstun, while the stick drifts and gravity pulls", () => {
    const f = launch();
    for (let i = 0; i < 5; i++) kineticReel(f, PARAMS, false);
    const before = { speed: f.launchSpeed, control: f.kinetic.controlX };
    kineticExec(f, "FALL", { stickX: -1, params: PARAMS, holdVertical: false });
    expect(f.launchSpeed).toBe(before.speed - LAUNCH_SPEED_DECAY);
    expect(f.kinetic.controlX).toBe(before.control - (PARAMS.air_accel_x_add + PARAMS.air_accel_x_mul));
    expect(f.vx).toBe(f.kinetic.controlX + f.kinetic.damageX);
  });

  it("ends on landing, leaving its horizontal part to brake on the ground", () => {
    const f = launch();
    kineticLand(f);
    expect(f.launchSpeed).toBe(0);
    expect(f.kinetic).toMatchObject({ damageX: 0, damageY: 0, stopX: fx(3) });
  });

  it("loses the component a wall or a ceiling stops, and the speed with it", () => {
    const f = launch();
    kineticSetX(f, 0);
    expect(f.launchSpeed).toBe(fx(4));
    kineticSetY(f, 0);
    expect(f.launchSpeed).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/engine/kinetic.test.ts`
Expected: FAIL — 7 tests: five throw `TypeError: kineticReel is not a function` / `kineticLand is not a function`; "replaces every other energy at the moment of launch" and the wall/ceiling test fail on values (`kineticLaunch` still writes CONTROL/GRAVITY).

- [ ] **Step 3: Implement**

In `src/engine/kinetic.ts`, replace:

```ts
import { approach } from "./fixed";
```

with:

```ts
import { LAUNCH_SPEED_DECAY } from "./constants";
import { abs, approach } from "./fixed";
```

In `src/engine/kinetic.ts`, replace:

```ts
export function kineticSetX(f: FighterState, vx: number, carrier: HorizontalCarrier = "control"): void {
  const k = f.kinetic;
  k.controlX = carrier === "control" ? vx : 0;
  k.stopX = carrier === "stop" ? vx : 0;
  k.motionX = 0;
  k.damageX = 0;
  kineticSum(f);
}
```

with:

```ts
export function kineticSetX(f: FighterState, vx: number, carrier: HorizontalCarrier = "control"): void {
  const k = f.kinetic;
  k.controlX = carrier === "control" ? vx : 0;
  k.stopX = carrier === "stop" ? vx : 0;
  k.motionX = 0;
  if (k.damageX !== 0) {
    // A launch stopped along one axis keeps only the other.
    k.damageX = 0;
    f.launchSpeed = abs(k.damageY);
  }
  kineticSum(f);
}
```

In `src/engine/kinetic.ts`, replace:

```ts
export function kineticSetY(f: FighterState, vy: number): void {
  const k = f.kinetic;
  k.gravityY = vy;
  k.motionY = 0;
  k.damageY = 0;
  kineticSum(f);
}
```

with:

```ts
export function kineticSetY(f: FighterState, vy: number): void {
  const k = f.kinetic;
  k.gravityY = vy;
  k.motionY = 0;
  if (k.damageY !== 0) {
    k.damageY = 0;
    f.launchSpeed = abs(k.damageX);
  }
  kineticSum(f);
}
```

In `src/engine/kinetic.ts`, replace:

```ts
/**
 * A knockback launch. Until Task 17 gives it the DAMAGE energy this is the
 * legacy behaviour: the launch *replaces* the velocity and `launchSpeed`
 * carries its magnitude for the legacy decay.
 */
export function kineticLaunch(f: FighterState, vx: number, vy: number, speed: number): void {
  kineticSet(f, vx, vy);
  f.launchSpeed = speed;
}
```

with:

```ts
/**
 * A knockback launch, on the DAMAGE energy. It replaces everything else the
 * fighter was doing — drift, a jump's rise, scripted motion — and decays on its
 * own from here (`kineticDecayDamage`); `launchSpeed` is its magnitude.
 */
export function kineticLaunch(f: FighterState, vx: number, vy: number, speed: number): void {
  const k = f.kinetic;
  k.controlX = 0;
  k.stopX = 0;
  k.gravityY = 0;
  k.motionX = 0;
  k.motionY = 0;
  k.jumpInitial = 0;
  k.damageX = vx;
  k.damageY = vy;
  f.launchSpeed = speed;
  kineticSum(f);
}
```

In `src/engine/kinetic.ts`, replace:

```ts
  const k = f.kinetic;
  const p = input.params;
  kineticTransfer(f, type);
  switch (type) {
```

with:

```ts
  const k = f.kinetic;
  const p = input.params;
  // A launch outlives its hitstun and keeps decaying while the fighter acts.
  if (f.launchSpeed > 0) kineticDecayDamage(f, f.grounded ? LAUNCH_SPEED_DECAY + p.ground_brake : LAUNCH_SPEED_DECAY);
  kineticTransfer(f, type);
  switch (type) {
```

Append to the end of `src/engine/kinetic.ts`:

```ts

/* ------------------------------------------------------------ DAMAGE energy -- */

/**
 * Bleed the launch by a flat `decay` along its own direction (SmashWiki
 * "Knockback": 0.051 per frame). Only the DAMAGE energy moves; gravity and
 * drift are separate energies and keep their own rules.
 */
export function kineticDecayDamage(f: FighterState, decay: number): void {
  const k = f.kinetic;
  const mag = f.launchSpeed;
  const next = mag - decay;
  if (mag <= 0 || next <= 0) {
    k.damageX = 0;
    k.damageY = 0;
    f.launchSpeed = 0;
    return;
  }
  k.damageX = Math.trunc((k.damageX * next) / mag);
  k.damageY = Math.trunc((k.damageY * next) / mag);
  f.launchSpeed = next;
}

/**
 * One frame of a fighter in hitstun: the launch decays, gravity builds toward
 * the fall speed, and nothing the player holds moves them. A vertical
 * ("balloon") launch falls by the fighter's `damage_fly_top_air_accel_y` toward
 * `damage_fly_top_speed_y_stable` (1.8 for every fighter on this roster). On
 * the ground the launch also loses `ground_brake` a frame.
 */
export function kineticReel(f: FighterState, p: FighterParams, balloon: boolean): void {
  const k = f.kinetic;
  kineticDecayDamage(f, f.grounded ? LAUNCH_SPEED_DECAY + p.ground_brake : LAUNCH_SPEED_DECAY);
  if (!f.grounded) {
    k.gravityY = balloon
      ? gravityStep(k.gravityY, p.damage_fly_top_air_accel_y, p.damage_fly_top_speed_y_stable)
      : gravityStep(k.gravityY, p.air_accel_y, p.air_speed_y_stable);
  } else {
    kineticTransfer(f, "GROUND_STOP");
    k.stopX = approach(k.stopX, 0, p.ground_brake);
    const sumY = kineticSumY(f);
    if (sumY < 0) k.gravityY -= sumY;
  }
  kineticSum(f);
}

/** Touching down ends a launch: its horizontal part becomes ordinary sliding (STOP). */
export function kineticLand(f: FighterState): void {
  const k = f.kinetic;
  k.stopX += k.damageX;
  k.damageX = 0;
  k.damageY = 0;
  f.launchSpeed = 0;
  kineticSum(f);
}
```

In `src/engine/states.ts`, replace:

```ts
  if (f.hitstun > 0) {
    decayLaunch(f, LAUNCH_SPEED_DECAY);
    if (!f.grounded) f.vy = applyGravity(f.vy, a, hitstunGravityOptions(f)); // kinetic: legacy-write (Task 17 moves this to DAMAGE)
    else f.vx = applyTraction(f.vx, a); // kinetic: legacy-write (Task 17 moves this to DAMAGE)
    kineticAdopt(f, carrier);
    return;
  }
```

with:

```ts
  if (f.hitstun > 0) {
    kineticReel(f, fighterParams(ctx.def), hitstunGravityOptions(f).balloon === true);
    return;
  }
```

In `src/engine/states.ts`, replace:

```ts
export function applyMovement(f: FighterState, intent: Intent, ctx: StateContext): void {
  const a = ctx.def.attributes;
```

with:

```ts
export function applyMovement(f: FighterState, intent: Intent, ctx: StateContext): void {
```

In `src/engine/states.ts`, replace:

```ts

  LAUNCH_SPEED_DECAY,
```

with:

```ts

```

In `src/engine/states.ts`, replace:

```ts

  applyGravity,
  applyTraction,
  decayLaunch,
```

with:

```ts

```

In `src/engine/states.ts`, replace:

```ts
  kineticJump,
```

with:

```ts
  kineticJump,
  kineticReel,
```

In `src/engine/physics.ts`, replace:

```ts
    f.airTime = 0;
    f.launchSpeed = 0;
    f.ledge = null;
    out.landed = true;
```

with:

```ts
    f.airTime = 0;
    kineticLand(f);
    f.ledge = null;
    out.landed = true;
```

In `src/engine/physics.ts`, replace:

```ts
import { RUN_ACCEL_FACTOR, WALK_ACCEL_FACTOR, kineticSetX, kineticSetY } from "./kinetic";
```

with:

```ts
import { RUN_ACCEL_FACTOR, WALK_ACCEL_FACTOR, kineticLand, kineticSetX, kineticSetY } from "./kinetic";
```

- [ ] **Step 4: Run it again**

Run: `pnpm vitest run src/engine/kinetic.test.ts`
Expected: PASS.

- [ ] **Step 5: Regenerate the golden trace, on purpose**

Run: `pnpm vitest run src/game/golden.test.ts`
Expected: FAIL — every launch now follows the new trajectory. This task changes behaviour by design.

Run: `UPDATE_GOLDEN=1 pnpm vitest run src/game/golden.test.ts && pnpm vitest run src/game/golden.test.ts`
Expected: the second run passes all 5 tests, including "exercises combat, not an idle screen".

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0. `pnpm lint` reports no errors and no warning in a file this task touched; any warnings it printed before this plan started (measure once, with Plan 1 merged, before Task 0) are unchanged.

- [ ] **Step 7: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/src/engine/kinetic.test.ts \
  super-smash/src/engine/kinetic.ts \
  super-smash/src/engine/physics.ts \
  super-smash/src/engine/states.ts \
  super-smash/src/game/__golden__/engine-trace.json
git commit -m "super-smash: the DAMAGE energy — a launch decays on its own while gravity and drift apply" -m "SmashWiki Knockback: launch speed decays 0.051/frame, air friction off, falling speed on. Leftover launch speed no longer sticks in vx after hitstun. Golden trace regenerated." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: The MOTION energy: scripted momentum on its own energy

Scripted momentum moves to the MOTION energy: it replaces every other energy while it holds and hands its velocity to drift and gravity on the hold's last frame, as the legacy code effectively did. The last two marked legacy writes in `states.ts` go. One edge case changes: a scripted move started while a launch is still decaying now ends the launch, instead of leaving it frozen underneath (the old adopt path kept a stale damage energy with `launchSpeed` 0).

**Files:**
- Modify: `super-smash/src/engine/kinetic.test.ts`
- Modify: `super-smash/src/engine/kinetic.ts`
- Modify: `super-smash/src/engine/states.ts` — `applyMoveMomentum`
- Modify: `super-smash/src/game/__golden__/engine-trace.json` (regenerated by a command in this task)

**Interfaces:** Produces (`kinetic.ts`): `kineticMotion(f, vx, vy)`, `kineticEndMotion(f)`.

- [ ] **Step 1: Write the failing test**

In `src/engine/kinetic.test.ts`, replace:

```ts
  kineticClear,
  kineticExec,
```

with:

```ts
  kineticClear,
  kineticEndMotion,
  kineticExec,
```

In `src/engine/kinetic.test.ts`, replace:

```ts
  kineticLaunch,
```

with:

```ts
  kineticLaunch,
  kineticMotion,
```

Append to the end of `src/engine/kinetic.test.ts`:

```ts

/* ------------------------------------------------- MOTION energy (Task 18) -- */

describe("the MOTION energy: a move's scripted velocity", () => {
  it("replaces every other energy while it holds", () => {
    const f = body({ controlX: fx(1), stopX: fx(1), gravityY: -fx(1), damageX: fx(2) }, { launchSpeed: fx(2) });
    kineticMotion(f, fx(0.5), fx(2.9));
    expect(f.kinetic).toMatchObject({ controlX: 0, stopX: 0, gravityY: 0, damageX: 0, motionX: fx(0.5), motionY: fx(2.9) });
    expect([f.vx, f.vy, f.launchSpeed]).toEqual([fx(0.5), fx(2.9), 0]);
  });

  it("hands its velocity to drift and gravity when the hold ends, so the fighter carries on", () => {
    const f = body({}, { grounded: false });
    kineticMotion(f, fx(0.5), fx(2.9));
    kineticEndMotion(f);
    expect(f.kinetic).toMatchObject({ motionX: 0, motionY: 0, controlX: fx(0.5), gravityY: fx(2.9) });
    expect([f.vx, f.vy]).toEqual([fx(0.5), fx(2.9)]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/engine/kinetic.test.ts`
Expected: FAIL — 2 tests: `TypeError: kineticMotion is not a function`.

- [ ] **Step 3: Implement**

Append to the end of `src/engine/kinetic.ts`:

```ts

/* ------------------------------------------------------------ MOTION energy -- */

/**
 * A move's scripted velocity (`momentum` in its `game_` script): set, not
 * added, so a Fox Illusion out of a run goes exactly as far as one from a
 * standstill. Every other energy stops while it holds, the launch included.
 */
export function kineticMotion(f: FighterState, vx: number, vy: number): void {
  const k = f.kinetic;
  k.controlX = 0;
  k.stopX = 0;
  k.gravityY = 0;
  k.damageX = 0;
  k.damageY = 0;
  f.launchSpeed = 0;
  k.motionX = vx;
  k.motionY = vy;
  kineticSum(f);
}

/** The hold is over: the velocity it left becomes drift and gravity's to change. */
export function kineticEndMotion(f: FighterState): void {
  const k = f.kinetic;
  k.controlX += k.motionX;
  k.gravityY += k.motionY;
  k.motionX = 0;
  k.motionY = 0;
  kineticSum(f);
}
```

In `src/engine/states.ts`, replace:

```ts
function applyMoveMomentum(f: FighterState, ctx: StateContext): boolean {
  if (f.move === null) return false;
  if (f.action !== "attack" && f.action !== "special" && f.action !== "throw") return false;
  const run = moveScriptFrame(ctx.def, f);
  const m = run?.state.momentum ?? null;
  if (run === null || m === null) return false;
  f.vx = m.x * (f.facing >= 0 ? 1 : -1); // kinetic: legacy-write (Task 18 moves this to MOTION)
  f.vy = m.y; // kinetic: legacy-write (Task 18 moves this to MOTION)
  // The floor still wins. A downward impulse on a grounded fighter drove
  // them straight through the stage — a grounded Stone fell out of the world
  // — because this branch returns before the clamp at the bottom of
  // `applyMovement` that ordinarily stops that. A Stone used on the ground
  // simply sits there, which is also what it does in the real game.
  if (f.grounded && f.vy < 0) f.vy = 0; // kinetic: legacy-write (Task 18 moves this to MOTION)
  f.launchSpeed = 0;
  return run.gameFrame < m.until;
}

```

with:

```ts
function applyMoveMomentum(f: FighterState, ctx: StateContext): boolean {
  if (f.move === null) return false;
  if (f.action !== "attack" && f.action !== "special" && f.action !== "throw") return false;
  const run = moveScriptFrame(ctx.def, f);
  const m = run?.state.momentum ?? null;
  if (run === null || m === null) return false;
  // The floor still wins. A downward impulse on a grounded fighter drove
  // them straight through the stage — a grounded Stone fell out of the world.
  // A Stone used on the ground simply sits there, as it does in the real game.
  kineticMotion(f, m.x * (f.facing >= 0 ? 1 : -1), f.grounded && m.y < 0 ? 0 : m.y);
  const holding = run.gameFrame < m.until;
  // On the last frame of the hold, drift and gravity take over this very frame.
  if (!holding) kineticEndMotion(f);
  return holding;
}

```

In `src/engine/states.ts`, replace:

```ts
  if (f.hitstun <= 0 && applyMoveMomentum(f, ctx)) {
    kineticAdopt(f, carrier);
    return;
  }
```

with:

```ts
  if (f.hitstun <= 0 && applyMoveMomentum(f, ctx)) return;
```

In `src/engine/states.ts`, replace:

```ts
  kineticClear,
  kineticExec,
```

with:

```ts
  kineticClear,
  kineticEndMotion,
  kineticExec,
```

In `src/engine/states.ts`, replace:

```ts
  kineticJump,
```

with:

```ts
  kineticJump,
  kineticMotion,
```

- [ ] **Step 4: Run it again**

Run: `pnpm vitest run src/engine/kinetic.test.ts`
Expected: PASS.

- [ ] **Step 5: Regenerate the golden trace, on purpose**

Run: `pnpm vitest run src/game/golden.test.ts`
Expected: FAIL — only the Link–Samus match diverges (measured when this plan was written); the other three are unchanged. This task changes behaviour by design.

Run: `UPDATE_GOLDEN=1 pnpm vitest run src/game/golden.test.ts && pnpm vitest run src/game/golden.test.ts`
Expected: the second run passes all 5 tests, including "exercises combat, not an idle screen".

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0. `pnpm lint` reports no errors and no warning in a file this task touched; any warnings it printed before this plan started (measure once, with Plan 1 merged, before Task 0) are unchanged.

- [ ] **Step 7: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/src/engine/kinetic.test.ts \
  super-smash/src/engine/kinetic.ts \
  super-smash/src/engine/states.ts \
  super-smash/src/game/__golden__/engine-trace.json
git commit -m "super-smash: the MOTION energy — scripted momentum on its own energy" -m "Set while it holds, handed to drift and gravity on its last frame. A move started mid-launch now ends the launch. Golden trace regenerated." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 19: Jump arcs: initial height, short hop and air jump from published heights

Jump arcs from published heights (SmashWiki "Jump"): Ultimate stores heights and derives the launch from gravity, `f = √(2gh) + g/2` (the page's own formula; `√(2g(h−i)) + g/2` for a full hop after its initial height i). A full hop rises `jump_initial_y` (0.55 × `jump_y` for all eight) over its first 4 airborne frames — split evenly, which is UNVERIFIED — and then flies as a jump of the remaining height. That formula reaches the published height under exactly one integration order: gravity on every airborne frame, a jump's first included. The peak is then h − g/8 + g·φ(1−φ)/2 (φ the fractional part of v/g), between h − g/8 and h; skipping gravity on the first frame would overshoot by about √(2gh), over two units. This engine already applies gravity and then moves, so a grounded jump simply stops skipping its first frame's gravity. The test measures every fighter's arc through `step()`: all four initial-rise frames, the first airborne frame's speed, the full-hop, short-hop and air-jump peaks — each within [h − g/8 − 0.01, h].

**Files:**
- Create: `super-smash/src/fighters/movement.test.ts`
- Modify: `super-smash/src/engine/kinetic.ts` — imports
- Modify: `super-smash/src/engine/states.test.ts` — imports, `STAGE`
- Modify: `super-smash/src/engine/states.ts` — `airJump`
- Modify: `super-smash/src/engine/status/air.ts` — imports
- Modify: `super-smash/src/game/__golden__/engine-trace.json` (regenerated by a command in this task)

**Interfaces:** Produces (`kinetic.ts`): `jumpLaunchSpeed(g: number, h: number): number` (`√(2gh) + g/2`, Q12), `initialRiseStep(initial: number, frame: number): number`, `kineticGroundJump(f: FighterState, p: FighterParams, full: boolean): void`. `kineticJump` now clears `jumpInitial`. `airJump` reads `fighterParams` (`jump_count_max`, and the first entry of `jump_aerial_y_list`, else `jump_aerial_y`).

- [ ] **Step 1: Write the failing test**

Create `src/fighters/movement.test.ts`:

```ts
import { beforeAll, describe, expect, it } from "vitest";

import { toFloat } from "@/engine/fixed";
import { initialRiseStep, jumpLaunchSpeed } from "@/engine/kinetic";
import { createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { Btn } from "@/engine/types";
import type { FighterState, GameState, InputFrame, MatchRules } from "@/engine/types";
import { STAGES } from "@/stages";
import { FIGHTERS } from "./index";
import { FIGHTER_PARAMS, type RosterId } from "./params";

/**
 * Movement measured through the real `step()`, with the real roster on Final
 * Destination (Plan 2, Tasks 19–24). Every expectation is a published number
 * from `FIGHTER_PARAMS` (rubendal SSBU-Calculator) and cites the page that
 * states the rule; where the rule itself is not published the test says
 * UNVERIFIED.
 */

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: false };
const IDS = FIGHTERS.map((f) => f.id as RosterId);

beforeAll(() => {
  registerFighters(FIGHTERS);
  registerStages(STAGES);
});

/** One fighter standing still on Final Destination, actionable. */
function standing(id: RosterId): GameState {
  let s = createInitialState("finalDestination", [{ defId: id }], RULES, 7);
  for (let i = 0; i < 80; i++) s = step(s, [0], { prevInputs: [0] }).state;
  const f = s.fighters[0];
  expect(f.grounded).toBe(true);
  expect(f.action).toBe("stand");
  return s;
}

/** Play `inputs` one per frame; report the fighter after each. */
function play(s0: GameState, inputs: readonly InputFrame[]): FighterState[] {
  let s = s0;
  let prev: InputFrame = 0;
  const out: FighterState[] = [];
  for (const input of inputs) {
    s = step(s, [input], { prevInputs: [prev] }).state;
    prev = input;
    out.push(s.fighters[0]);
  }
  return out;
}

const hold = (input: InputFrame, n: number): InputFrame[] => Array.from({ length: n }, () => input);

/** Height above the ground, in units, on every frame from the first airborne one. */
function airborneHeights(frames: readonly FighterState[], groundY: number): number[] {
  const start = frames.findIndex((f) => !f.grounded);
  return frames.slice(start).map((f) => toFloat(f.y - groundY));
}

describe("jump arcs (SmashWiki Jump, https://www.ssbwiki.com/Jump)", () => {
  // "the game encodes jump height, and works backwards using gravity to figure
  // out the correct force"; the page's source gives the force as
  // f = sqrt(2g*h) + g/2, and sqrt(2g*(h-i)) + g/2 for a full hop after its
  // "jump initial height … the height that a character will reach in the first
  // 4 frames of a full hop … no affect on short hops or aerial jumps".
  // With gravity on every airborne frame that launch peaks between h − g/8 and
  // h (see `jumpLaunchSpeed`); Q12 truncation takes off less than 0.01 more.
  const ROUNDING = 0.01;

  function expectPeak(peak: number, height: number, gravity: number, label: string): void {
    const h = toFloat(height);
    const g = toFloat(gravity);
    expect(peak, `${label}: below h − g/8`).toBeGreaterThanOrEqual(h - g / 8 - ROUNDING);
    expect(peak, `${label}: above h`).toBeLessThanOrEqual(h);
  }

  it.each(IDS)("%s full hop: the initial height over 4 frames (even split UNVERIFIED), then the published peak", (id) => {
    const p = FIGHTER_PARAMS[id];
    const s = standing(id);
    const frames = play(s, hold(Btn.Jump, 120));
    const start = frames.findIndex((f) => !f.grounded);
    const ground = s.fighters[0].y;
    const rise = [1, 2, 3, 4].map((n) => frames[start + n - 1].y - ground);
    let sum = 0;
    const want = [1, 2, 3, 4].map((n) => (sum += initialRiseStep(p.jump_initial_y, n)));
    expect(rise).toEqual(want);
    expect(rise[3]).toBe(p.jump_initial_y);
    expectPeak(Math.max(...airborneHeights(frames, ground)), p.jump_y, p.air_accel_y, "full hop");
  });

  it.each(IDS)("%s short hop: launched by the published formula, gravity on its first frame, the published peak", (id) => {
    const p = FIGHTER_PARAMS[id];
    const s = standing(id);
    const frames = play(s, [Btn.Jump, ...hold(0, 120)]);
    const first = frames.find((f) => !f.grounded)!;
    expect(first.vy).toBe(jumpLaunchSpeed(p.air_accel_y, p.mini_jump_y) - p.air_accel_y);
    expect(first.y - s.fighters[0].y).toBe(first.vy);
    expectPeak(Math.max(...airborneHeights(frames, s.fighters[0].y)), p.mini_jump_y, p.air_accel_y, "short hop");
  });

  it.each(IDS)("%s air jump: rises the published height of its first midair jump", (id) => {
    const p = FIGHTER_PARAMS[id];
    const s = standing(id);
    // Short hop, then a fresh jump press on its sixth airborne frame, well before it lands.
    const frames = play(s, [Btn.Jump, ...hold(0, 8), Btn.Jump, ...hold(0, 90)]);
    const jumpAt = 9;
    expect(frames[jumpAt].grounded).toBe(false);
    expect(frames[jumpAt].jumpsUsed).toBe(2);
    const from = toFloat(frames[jumpAt - 1].y);
    const peak = Math.max(...frames.slice(jumpAt).map((f) => toFloat(f.y)));
    const first = (p.jump_aerial_y_list ?? [p.jump_aerial_y])[0];
    expectPeak(peak - from, first, p.air_accel_y, "air jump");
  });
});
```

In `src/engine/states.test.ts`, replace:

```ts
    // Gravity has already been applied once, so compare against the initial value.
    expect(f.vy).toBe(ATTRS.shortHopVelocity - ATTRS.gravity);
```

with:

```ts
    // The launch is the published-height formula's, and its first airborne frame has gravity.
    expect(f.vy).toBe(jumpLaunchSpeed(PARAMS.air_accel_y, PARAMS.mini_jump_y) - PARAMS.air_accel_y);
```

In `src/engine/states.test.ts`, replace:

```ts
    hold(f, Btn.Jump, JUMP_SQUAT_FRAMES + 1);
    expect(f.vy).toBe(ATTRS.fullHopVelocity - ATTRS.gravity);
```

with:

```ts
    hold(f, Btn.Jump, JUMP_SQUAT_FRAMES + 1);
    // The fixture has no published initial height, so its full hop launches at once.
    expect(f.vy).toBe(jumpLaunchSpeed(PARAMS.air_accel_y, PARAMS.jump_y) - PARAMS.air_accel_y);
```

In `src/engine/states.test.ts`, replace:

```ts
    expect(f.shortHop).toBe(true);
    expect(f.vy).toBe(ATTRS.shortHopVelocity - ATTRS.gravity);
```

with:

```ts
    expect(f.shortHop).toBe(true);
    expect(f.vy).toBe(jumpLaunchSpeed(PARAMS.air_accel_y, PARAMS.mini_jump_y) - PARAMS.air_accel_y);
```

In `src/engine/states.test.ts`, replace:

```ts
import { emptyKinetic } from "./kinetic";
```

with:

```ts
import { emptyKinetic, jumpLaunchSpeed } from "./kinetic";
import { paramsFromAttributes } from "./params";
```

In `src/engine/states.test.ts`, replace:

```ts
const STAGE: StageDef = {
```

with:

```ts
const PARAMS = paramsFromAttributes(ATTRS, DEF);

const STAGE: StageDef = {
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/engine/states.test.ts src/fighters/movement.test.ts`
Expected: FAIL — 27 tests: the three `states.test.ts` hop tests and every fighter's full-hop and short-hop tests throw `TypeError: jumpLaunchSpeed is not a function` / `initialRiseStep is not a function`; every fighter's air-jump test peaks low (e.g. `air jump: below h − g/8: expected 35.8588… to be greater than or equal to 36.9806…`).

- [ ] **Step 3: Implement**

In `src/engine/kinetic.ts`, replace:

```ts
import { abs, approach } from "./fixed";
```

with:

```ts
import { abs, approach, mul, sqrt } from "./fixed";
```

In `src/engine/kinetic.ts`, replace:

```ts
  kineticSetY(f, vy);
}

/**
 * A knockback launch
```

with:

```ts
  k.jumpInitial = 0;
  kineticSetY(f, vy);
}

/**
 * A knockback launch
```

In `src/engine/kinetic.ts`, replace:

```ts
  if (!f.grounded) {
    if (!input.holdVertical) {
      k.gravityY = gravityStep(k.gravityY, p.air_accel_y, f.fastFalling ? p.dive_speed_y : p.air_speed_y_stable);
    }
  } else {
```

with:

```ts
  if (!f.grounded) {
    const skip = jumpFrame(f, p) || input.holdVertical;
    if (!skip) {
      k.gravityY = gravityStep(k.gravityY, p.air_accel_y, f.fastFalling ? p.dive_speed_y : p.air_speed_y_stable);
    }
  } else {
```

Append to the end of `src/engine/kinetic.ts`:

```ts

/* ------------------------------------------------------------------- jumps -- */

/**
 * SmashWiki "Jump" (https://www.ssbwiki.com/Jump): "In Smash 4 and Ultimate,
 * the game encodes jump height, and works backwards using gravity to figure out
 * the correct force to use." The page's source gives the force as
 * `f = sqrt(2g*h) + g/2` (and `sqrt(2g*(h-i)) + g/2` for a full hop after its
 * initial height i).
 *
 * That formula reaches h under one integration order: every airborne frame,
 * the first included, applies gravity and then moves. The peak of a launch v is
 * then v²/2g − v/2 + g·φ(1−φ)/2 (φ the fractional part of v/g), which for
 * v = √(2gh) + g/2 is h − g/8 + g·φ(1−φ)/2 — between h − g/8 and h. Skipping
 * gravity on the first frame instead would overshoot by about √(2gh), more than
 * two units for every fighter here. So this engine applies gravity on every
 * airborne frame, a jump's first one included (DECISIONS D55 records the
 * SmashWiki sentence that says otherwise).
 */
export function jumpLaunchSpeed(g: number, h: number): number {
  if (h <= 0) return 0;
  return sqrt(2 * mul(g, h)) + (g >> 1);
}

/**
 * The full hop's initial rise: `jump_initial_y` over its first 4 airborne
 * frames (SmashWiki "Jump": "the height that a character will reach in the
 * first 4 frames of a full hop"). UNVERIFIED: how that height is split across
 * the 4 frames is not published; this rises it evenly, the remainder on the 4th.
 */
export function initialRiseStep(initial: number, frame: number): number {
  const q = Math.trunc(initial / 4);
  return frame < 4 ? q : initial - 3 * q;
}

/**
 * Leave the ground. A full hop with a published initial height rises
 * `jump_initial_y` over its first 4 frames and then flies as a jump of the
 * remaining height; a short hop (and a full hop without an initial height)
 * launches at once, at `jumpLaunchSpeed`.
 */
export function kineticGroundJump(f: FighterState, p: FighterParams, full: boolean): void {
  if (full && p.jump_initial_y > 0) {
    kineticJump(f, 0);
    f.kinetic.jumpInitial = 1;
    return;
  }
  kineticJump(f, jumpLaunchSpeed(p.air_accel_y, full ? p.jump_y : p.mini_jump_y));
}

/** The vertical half of a jump frame: true while the initial rise replaces gravity. */
function jumpFrame(f: FighterState, p: FighterParams): boolean {
  const k = f.kinetic;
  if (k.jumpInitial >= 1 && k.jumpInitial <= 4) {
    k.gravityY = initialRiseStep(p.jump_initial_y, k.jumpInitial);
    k.jumpInitial += 1;
    return true;
  }
  if (k.jumpInitial === 5) {
    // The rest of the hop launches here, and this frame's gravity applies to it.
    k.gravityY = jumpLaunchSpeed(p.air_accel_y, p.jump_y - p.jump_initial_y);
    k.jumpInitial = 0;
  }
  return false;
}
```

In `src/engine/status/air.ts`, replace:

```ts
    const a = ctx.def.attributes;
    const short = !intent.jumpHeld || peekBuffer(f, ctx.frame) === "attack";
    kineticSetY(f, short ? a.shortHopVelocity : a.fullHopVelocity);
```

with:

```ts
    const short = !intent.jumpHeld || peekBuffer(f, ctx.frame) === "attack";
    kineticGroundJump(f, fighterParams(ctx.def), !short);
```

In `src/engine/status/air.ts`, replace:

```ts
import { kineticSetY } from "../kinetic";
```

with:

```ts
import { kineticGroundJump, kineticSetY } from "../kinetic";
import { fighterParams } from "../params";
```

In `src/engine/states.ts`, replace:

```ts
export function airJump(f: FighterState, ctx: StateContext): boolean {
  const a = ctx.def.attributes;
  if (f.jumpsUsed >= a.jumps) return false;
  f.jumpsUsed += 1;
  kineticJump(f, a.airJumpVelocity);
```

with:

```ts
export function airJump(f: FighterState, ctx: StateContext): boolean {
  const p = fighterParams(ctx.def);
  if (f.jumpsUsed >= p.jump_count_max) return false;
  f.jumpsUsed += 1;
  // Every midair jump rises the first midair jump's height (Task 20 indexes Kirby's list).
  kineticJump(f, jumpLaunchSpeed(p.air_accel_y, (p.jump_aerial_y_list ?? [p.jump_aerial_y])[0]));
```

In `src/engine/states.ts`, replace:

```ts
  kineticJump,
```

with:

```ts
  jumpLaunchSpeed,
  kineticJump,
```

- [ ] **Step 4: Run it again**

Run: `pnpm vitest run src/engine/states.test.ts src/fighters/movement.test.ts`
Expected: PASS.

- [ ] **Step 5: Regenerate the golden trace, on purpose**

Run: `pnpm vitest run src/game/golden.test.ts`
Expected: FAIL — every jump in the trace has a new arc. This task changes behaviour by design.

Run: `UPDATE_GOLDEN=1 pnpm vitest run src/game/golden.test.ts && pnpm vitest run src/game/golden.test.ts`
Expected: the second run passes all 5 tests, including "exercises combat, not an idle screen".

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0. `pnpm lint` reports no errors and no warning in a file this task touched; any warnings it printed before this plan started (measure once, with Plan 1 merged, before Task 0) are unchanged.

- [ ] **Step 7: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/src/engine/kinetic.ts \
  super-smash/src/engine/states.test.ts \
  super-smash/src/engine/states.ts \
  super-smash/src/engine/status/air.ts \
  super-smash/src/fighters/movement.test.ts \
  super-smash/src/game/__golden__/engine-trace.json
git commit -m "super-smash: jump arcs — initial height, short hop and air jump from published heights" -m "SmashWiki Jump: heights are stored and the launch is sqrt(2gh) + g/2; a full hop rises jump_initial_y over 4 frames (even split UNVERIFIED). Gravity applies on every airborne frame, the order under which that formula reaches the published height. Every fighter's arc measured through step(). Golden trace regenerated." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 20: Midair jumps: jump_count_max for all eight, and Kirby's five published heights

Midair jumps by `jump_count_max` for all eight, and Kirby's per-jump heights from `jump_aerial_y_list` — the five heights SmashWiki's "Jump" page publishes for Ultimate (21.06378125, 18.528125, 15.931125, 13.34569531, 10.82288281). This changes behaviour (Kirby's 2nd–5th midair jumps no longer repeat the first). Review Focus #4 gets its test: down and jump on the same frame while falling is a jump, not a fast fall.

**Files:**
- Modify: `super-smash/src/engine/states.ts`
- Modify: `super-smash/src/fighters/movement.test.ts`

**Interfaces:** `airJump` reads `jump_aerial_y_list[jumpsUsed − 2]` when present.

- [ ] **Step 1: Write the failing test**

Append to the end of `src/fighters/movement.test.ts`:

```ts

describe("midair jumps (SmashWiki Midair jump, https://www.ssbwiki.com/Midair_jump)", () => {
  const PRESS_EVERY = 30;

  /** A full hop, then a jump press every 30 frames; the fighter after each frame. */
  function chain(id: RosterId, presses: number): FighterState[] {
    const inputs: InputFrame[] = [...hold(Btn.Jump, 6), ...hold(0, 9)];
    for (let i = 0; i < presses; i++) inputs.push(Btn.Jump, ...hold(0, PRESS_EVERY - 1));
    return play(standing(id), inputs);
  }

  it.each(IDS)("%s gets exactly jump_count_max − 1 of them", (id) => {
    const p = FIGHTER_PARAMS[id];
    const frames = chain(id, p.jump_count_max + 1);
    expect(Math.max(...frames.map((f) => f.jumpsUsed))).toBe(p.jump_count_max);
  });

  it("gives Kirby five, each rising its own published height (SmashWiki Jump, Ultimate table)", () => {
    // https://www.ssbwiki.com/Jump, Kirby, Air Jump: "21.06378125, 18.528125, 15.931125,
    // 13.34569531, 10.82288281 for each air jump." Each peaks between h − g/8 and h (Task 19).
    const p = FIGHTER_PARAMS.kirby;
    const list = p.jump_aerial_y_list!;
    const g = toFloat(p.air_accel_y);
    const frames = chain("kirby", list.length);
    for (let i = 0; i < list.length; i++) {
      const at = 15 + i * PRESS_EVERY;
      expect(frames[at].jumpsUsed, `jump ${i + 1} taken`).toBe(i + 2);
      const from = toFloat(frames[at - 1].y);
      const gain = Math.max(...frames.slice(at, at + PRESS_EVERY).map((f) => toFloat(f.y))) - from;
      expect(gain, `jump ${i + 1}`).toBeGreaterThanOrEqual(toFloat(list[i]) - g / 8 - 0.01);
      expect(gain, `jump ${i + 1}`).toBeLessThanOrEqual(toFloat(list[i]));
    }
  });

  it("takes the jump, not a fast fall, when down and jump arrive on one frame (Review Focus #4)", () => {
    const s = standing("mario");
    // Short hop, fall past the apex, then down + jump together.
    const frames = play(s, [Btn.Jump, ...hold(0, 25), Btn.Down | Btn.Jump, 0]);
    const f = frames[26];
    expect(f.jumpsUsed).toBe(2);
    expect(f.fastFalling).toBe(false);
    expect(f.vy).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/fighters/movement.test.ts`
Expected: FAIL — 1 test: "gives Kirby five, each rising its own published height" — `jump 2: expected 21.05517578125 to be less than or equal to 18.528076171875` (every midair jump still rises the first one's height). The count and same-frame tests already pass; they guard behaviour.

- [ ] **Step 3: Implement**

In `src/engine/states.ts`, replace:

```ts
  // Every midair jump rises the first midair jump's height (Task 20 indexes Kirby's list).
  kineticJump(f, jumpLaunchSpeed(p.air_accel_y, (p.jump_aerial_y_list ?? [p.jump_aerial_y])[0]));
```

with:

```ts
  // A multi-jumper's midair jumps each have their own height; the first midair
  // jump is the one whose `jumpsUsed` is now 2.
  const list = p.jump_aerial_y_list;
  const height = list === undefined ? p.jump_aerial_y : list[Math.min(f.jumpsUsed - 2, list.length - 1)];
  kineticJump(f, jumpLaunchSpeed(p.air_accel_y, height));
```

- [ ] **Step 4: Run it again**

Run: `pnpm vitest run src/fighters/movement.test.ts`
Expected: PASS.

- [ ] **Step 5: The golden trace must not move**

Run: `pnpm vitest run src/game/golden.test.ts`
Expected: PASS, unchanged. This task does change behaviour, but only for Kirby's second and later midair jumps, which the CPU in the trace never chains, so the digest does not move. If it does on your run, regenerate it and say so in the commit.

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0. `pnpm lint` reports no errors and no warning in a file this task touched; any warnings it printed before this plan started (measure once, with Plan 1 merged, before Task 0) are unchanged.

- [ ] **Step 7: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/src/engine/states.ts \
  super-smash/src/fighters/movement.test.ts
git commit -m "super-smash: midair jumps — jump_count_max for all eight, and Kirby's five published heights" -m "Kirby's midair jumps rise SmashWiki's five published Ultimate heights (Jump page, Ultimate table). Down + jump on one frame is a jump (Review Focus #4)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 21: Air friction: air_brake_x with the stick neutral

Air friction (SmashWiki "Air friction": it "only applies when the player is not holding the Control Stick in a horizontal direction"): with the stick neutral, CONTROL bleeds by `air_brake_x` a frame; an airborne STOP carrier bleeds by it too. The legacy equivalence property still holds because the attribute adapter's `air_brake_x` is 0.

**Files:**
- Modify: `super-smash/src/engine/kinetic.ts` — `airControlX`, `case "GROUND_STOP"`
- Modify: `super-smash/src/fighters/movement.test.ts`
- Modify: `super-smash/src/game/__golden__/engine-trace.json` (regenerated by a command in this task)

**Interfaces:** `airControlX` brakes by `air_brake_x` at stick 0; `GROUND_STOP` brakes STOP by `air_brake_x` in the air.

- [ ] **Step 1: Write the failing test**

Append to the end of `src/fighters/movement.test.ts`:

```ts

describe("air friction (SmashWiki Air friction, https://www.ssbwiki.com/Air_friction)", () => {
  // "Air friction only applies when the player is not holding the Control Stick
  // in a horizontal direction … If the player is attempting to slow down, air
  // acceleration applies instead." Values: calculator `AirFriction` (air_brake_x).

  /** A full hop drifting right for 20 frames (17 of them airborne), then `input` for `n` frames. */
  function drift(id: RosterId, input: InputFrame, n: number): FighterState[] {
    const frames = play(standing(id), [...hold(Btn.Jump | Btn.Right, 20), ...hold(input, n)]);
    expect(frames[19].grounded, `${id} is airborne when the drift ends`).toBe(false);
    expect(frames[19].vx, `${id} is drifting right`).toBeGreaterThan(0);
    return frames.slice(19);
  }

  it.each(IDS)("%s slows by air_brake_x a frame with the stick neutral", (id) => {
    const p = FIGHTER_PARAMS[id];
    const frames = drift(id, Btn.Jump, 15);
    let checked = 0;
    for (let i = 1; i < frames.length && !frames[i].grounded; i++) {
      expect(frames[i - 1].vx - frames[i].vx, `${id} neutral frame ${i}`).toBe(Math.min(p.air_brake_x, frames[i - 1].vx));
      checked += 1;
    }
    expect(checked, `${id}: airborne neutral frames measured`).toBeGreaterThanOrEqual(10);
  });

  it("does not slow a fighter who is holding the way they drift", () => {
    const frames = play(standing("mario"), hold(Btn.Jump | Btn.Right, 40)).slice(20, 40);
    expect(frames.every((f) => !f.grounded)).toBe(true);
    expect(frames.every((f) => f.vx === FIGHTER_PARAMS.mario.air_speed_x_stable)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/fighters/movement.test.ts`
Expected: FAIL — 8 tests, one per fighter: "slows by air_brake_x a frame with the stick neutral" — e.g. `mario neutral frame 1: expected +0 to be 61` (drift never decays).

- [ ] **Step 3: Implement**

In `src/engine/kinetic.ts`, replace:

```ts
/**
 * Air drift: base plus additional acceleration, capped at air speed — but only
 * in the direction being held, so drifting back against a fast launch is
 * allowed while drifting further out is not.
 */
export function airControlX(vx: number, stickX: number, p: FighterParams): number {
  if (stickX === 0) return vx;
```

with:

```ts
/**
 * Air drift: base plus additional acceleration, capped at air speed — but only
 * in the direction being held, so drifting back against a fast launch is
 * allowed while drifting further out is not. With the stick neutral, air
 * friction (`air_brake_x`) bleeds the drift instead (SmashWiki "Air friction").
 */
export function airControlX(vx: number, stickX: number, p: FighterParams): number {
  if (stickX === 0) return approach(vx, 0, p.air_brake_x);
```

In `src/engine/kinetic.ts`, replace:

```ts
    case "GROUND_STOP":
      if (f.grounded) k.stopX = approach(k.stopX, 0, p.ground_brake);
      break;
```

with:

```ts
    case "GROUND_STOP":
      k.stopX = approach(k.stopX, 0, f.grounded ? p.ground_brake : p.air_brake_x);
      break;
```

- [ ] **Step 4: Run it again**

Run: `pnpm vitest run src/fighters/movement.test.ts`
Expected: PASS.

- [ ] **Step 5: Regenerate the golden trace, on purpose**

Run: `pnpm vitest run src/game/golden.test.ts`
Expected: FAIL — every neutral-stick airtime now slows. This task changes behaviour by design.

Run: `UPDATE_GOLDEN=1 pnpm vitest run src/game/golden.test.ts && pnpm vitest run src/game/golden.test.ts`
Expected: the second run passes all 5 tests, including "exercises combat, not an idle screen".

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0. `pnpm lint` reports no errors and no warning in a file this task touched; any warnings it printed before this plan started (measure once, with Plan 1 merged, before Task 0) are unchanged.

- [ ] **Step 7: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/src/engine/kinetic.ts \
  super-smash/src/fighters/movement.test.ts \
  super-smash/src/game/__golden__/engine-trace.json
git commit -m "super-smash: air friction — air_brake_x with the stick neutral" -m "SmashWiki Air friction. Golden trace regenerated." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 22: Walking: walk_accel_add + walk_accel_mul × deflection, toward walk_speed_max × deflection

Walking from the calculator's two walk accelerations: `walk_accel_add` at any deflection plus `walk_accel_mul` scaled by it, toward `walk_speed_max` scaled by it — the same base/additional pattern SmashWiki "Dash" documents for dash and air acceleration. Deflection is ONE for a key and ONE/2 for Plan 1's `Btn.Soft` (Plan 1 already reads a soft stick as half deflection, UNVERIFIED). A walk's first frame, from rest, is therefore exactly base + additional (Mario 0.21; the legacy 2 × traction gave 0.204).

**Files:**
- Modify: `super-smash/src/engine/kinetic.ts` — `KineticInput`, `case "WALK"`, imports
- Modify: `super-smash/src/engine/states.ts`
- Modify: `super-smash/src/fighters/movement.test.ts`
- Modify: `super-smash/src/game/__golden__/engine-trace.json` (regenerated by a command in this task)

**Interfaces:** `KineticInput.stickMag?: number` (Q12, default ONE); `applyMovement` passes `intent.soft ? ONE >> 1 : ONE` (`Intent.soft` from Plan 1 Task 15).

- [ ] **Step 1: Write the failing test**

Append to the end of `src/fighters/movement.test.ts`:

```ts

describe("walking (calculator WalkBaseAcceleration / WalkAddAcceleration / WalkSpeed)", () => {
  // https://github.com/rubendal/SSBU-Calculator/blob/233590e94bc4bd8813f2d1a2af45c8c46648f351/Data/<fighter>/data.json.
  // As with dash and air acceleration (SmashWiki "Dash", https://www.ssbwiki.com/Dash),
  // a base value applies at any deflection and an additional one scales with it.
  // UNVERIFIED: that the walk's top speed scales linearly with deflection. The game's
  // struct also has walk_slow_speed_mul / walk_middle_ratio / walk_fast_ratio, which no
  // source used here publishes for this roster.

  it.each(IDS)("%s starts a walk at base + additional acceleration on its first frame", (id) => {
    const p = FIGHTER_PARAMS[id];
    const [first] = play(standing(id), [Btn.Right]);
    expect(first.action).toBe("walk");
    expect(first.vx).toBe(p.walk_accel_add + p.walk_accel_mul);
  });

  it.each(IDS)("%s walks at half its top speed on a soft stick (UNVERIFIED half-deflection reading, Plan 1)", (id) => {
    const p = FIGHTER_PARAMS[id];
    const frames = play(standing(id), hold(Btn.Right | Btn.Soft, 40));
    expect(frames.at(-1)!.action).toBe("walk");
    expect(frames.at(-1)!.vx).toBe(Math.trunc(p.walk_speed_max / 2));
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/fighters/movement.test.ts`
Expected: FAIL — 16 tests, two per fighter: the first walk frame is 2 × traction, not `walk_accel_add + walk_accel_mul` (e.g. `expected 950 to be 1118`), and a soft stick walks at full speed (e.g. `expected 6451 to be 3225`).

- [ ] **Step 3: Implement**

In `src/engine/kinetic.ts`, replace:

```ts
export interface KineticInput {
  /** Horizontal stick, −1/0/1 from the keyboard. */
  readonly stickX: number;
```

with:

```ts
export interface KineticInput {
  /** Horizontal stick, −1/0/1 from the keyboard. */
  readonly stickX: number;
  /**
   * How far the stick is deflected, Q12: ONE for a key or a full tilt, ONE / 2
   * for `Btn.Soft` (Plan 1's half-deflection reading — UNVERIFIED, the
   * bitfield carries one bit of magnitude). Defaults to ONE.
   */
  readonly stickMag?: number;
```

In `src/engine/kinetic.ts`, replace:

```ts
    case "WALK":
      k.controlX = approach(k.controlX, input.stickX * p.walk_speed_max, p.ground_brake * WALK_ACCEL_FACTOR);
      break;
```

with:

```ts
    case "WALK": {
      // walk_accel_add at any deflection, walk_accel_mul scaled by it; the top
      // speed scales with deflection too. UNVERIFIED: that scaling is linear
      // here; the game's `walk_slow_speed_mul`, `walk_middle_ratio` and
      // `walk_fast_ratio` (skyline-smash FighterParamTable) shape it, and no
      // source used here publishes their values.
      const mag = input.stickMag ?? ONE;
      k.controlX = approach(k.controlX, input.stickX * mul(p.walk_speed_max, mag), p.walk_accel_add + mul(p.walk_accel_mul, mag));
      break;
    }
```

In `src/engine/kinetic.ts`, replace:

```ts
import { abs, approach, mul, sqrt } from "./fixed";
```

with:

```ts
import { ONE, abs, approach, mul, sqrt } from "./fixed";
```

In `src/engine/states.ts`, replace:

```ts
    stickX: intent.x,
```

with:

```ts
    stickX: intent.x,
    stickMag: intent.soft ? ONE >> 1 : ONE,
```

- [ ] **Step 4: Run it again**

Run: `pnpm vitest run src/fighters/movement.test.ts`
Expected: PASS.

- [ ] **Step 5: Regenerate the golden trace, on purpose**

Run: `pnpm vitest run src/game/golden.test.ts`
Expected: FAIL — every walk accelerates differently. This task changes behaviour by design.

Run: `UPDATE_GOLDEN=1 pnpm vitest run src/game/golden.test.ts && pnpm vitest run src/game/golden.test.ts`
Expected: the second run passes all 5 tests, including "exercises combat, not an idle screen".

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0. `pnpm lint` reports no errors and no warning in a file this task touched; any warnings it printed before this plan started (measure once, with Plan 1 merged, before Task 0) are unchanged.

- [ ] **Step 7: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/src/engine/kinetic.ts \
  super-smash/src/engine/states.ts \
  super-smash/src/fighters/movement.test.ts \
  super-smash/src/game/__golden__/engine-trace.json
git commit -m "super-smash: walking — walk_accel_add + walk_accel_mul x deflection" -m "Calculator WalkBase/WalkAddAcceleration; a soft stick (Plan 1) is half deflection, UNVERIFIED. Golden trace regenerated." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 23: Dash into run: run_accel_add + run_accel_mul × deflection, traction above run speed

Dash into run (SmashWiki "Dash"): below run speed, accelerate by `run_accel_add` + `run_accel_mul` × deflection; above it — an initial dash faster than the run — brake by traction down to it. The legacy rule used 3 × traction both ways, so Fox (dash 2.09 < run 2.402) reached his run about twice as fast as he should. The Task 3 equivalence property now excludes DASH and RUN, which have deliberately left the legacy rule.

**Files:**
- Modify: `super-smash/src/engine/kinetic.test.ts` — `TYPES`
- Modify: `super-smash/src/engine/kinetic.ts` — `case "DASH"`
- Modify: `super-smash/src/fighters/movement.test.ts`
- Modify: `super-smash/src/game/__golden__/engine-trace.json` (regenerated by a command in this task)

**Interfaces:** Produces (`kinetic.ts`): `runControlX(vx: number, dir: number, p: FighterParams, mag: number): number`.

- [ ] **Step 1: Write the failing test**

Append to the end of `src/fighters/movement.test.ts`:

```ts

describe("dash into run (SmashWiki Dash, https://www.ssbwiki.com/Dash)", () => {
  // "there exist two acceleration values for each character's initial dash
  // speed until it reaches their run speed: a base value … and an additional
  // value that is scaled based on how much the control stick is tilted … if it
  // is higher, the character's traction value is used to decrease it down to
  // their run speed." Values: calculator DashInitialSpeed, RunBase/AddAcceleration,
  // RunSpeed, GroundFriction. UNVERIFIED: that `dash_speed` is held for exactly one
  // frame before the acceleration rule takes over (the page does not say how long).

  it.each(IDS)("%s leaves its initial dash speed by the published rule, and settles at run speed", (id) => {
    const p = FIGHTER_PARAMS[id];
    // Forty frames: long enough to reach run speed, short enough to stay on the stage.
    const frames = play(standing(id), hold(Btn.Right, 40));
    expect(frames.every((f) => f.grounded)).toBe(true);
    const d = frames.findIndex((f) => f.action === "dashStart");
    const v = frames.slice(d).map((f) => f.vx);
    expect(v[0]).toBe(p.dash_speed);
    const next = v.find((x) => x !== p.dash_speed)!;
    const want =
      p.dash_speed > p.run_speed_max
        ? Math.max(p.dash_speed - p.ground_brake, p.run_speed_max)
        : Math.min(p.dash_speed + p.run_accel_add + p.run_accel_mul, p.run_speed_max);
    expect(next).toBe(want);
    expect(v.at(-1)).toBe(p.run_speed_max);
  });
});
```

In `src/engine/kinetic.test.ts`, replace:

```ts
describe("kineticExec reproduces the legacy single-velocity movement", () => {
  const TYPES: KineticType[] = ["FALL", "GROUND_STOP", "WALK", "DASH", "RUN", "MOTION", "AIR_ESCAPE", "NONE"];
```

with:

```ts
describe("kineticExec reproduces the legacy single-velocity movement", () => {
  // DASH and RUN left the legacy rule in Task 23 (SmashWiki "Dash"; see
  // fighters/movement.test.ts). The rest still match it exactly.
  const TYPES: KineticType[] = ["FALL", "GROUND_STOP", "WALK", "MOTION", "AIR_ESCAPE", "NONE"];
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/engine/kinetic.test.ts src/fighters/movement.test.ts`
Expected: FAIL — 7 tests: the dash test for every fighter except Pikachu (e.g. `expected 9839 to be 9242`: the second distinct dash speed follows 3 × traction). Pikachu passes already — its legacy 3 × traction step happens to equal `run_accel_add + run_accel_mul`.

- [ ] **Step 3: Implement**

In `src/engine/kinetic.ts`, replace:

```ts
    case "DASH":
      k.controlX =
        f.actionFrame <= 1
          ? f.facing * p.dash_speed
          : approach(k.controlX, f.facing * p.run_speed_max, p.ground_brake * RUN_ACCEL_FACTOR);
      break;
    case "RUN":
      k.controlX = approach(k.controlX, f.facing * p.run_speed_max, p.ground_brake * RUN_ACCEL_FACTOR);
      break;
```

with:

```ts
    case "DASH":
      // UNVERIFIED: the initial dash speed is held for the dash's first frame only.
      k.controlX =
        f.actionFrame <= 1 ? f.facing * p.dash_speed : runControlX(k.controlX, f.facing, p, input.stickMag ?? ONE);
      break;
    case "RUN":
      k.controlX = runControlX(k.controlX, f.facing, p, input.stickMag ?? ONE);
      break;
```

Append to the end of `src/engine/kinetic.ts`:

```ts

/**
 * Dash and run acceleration (SmashWiki "Dash"): below run speed, accelerate by
 * `run_accel_add` plus `run_accel_mul` scaled by deflection; above it (an
 * initial dash faster than the run), brake by traction down to it.
 */
export function runControlX(vx: number, dir: number, p: FighterParams, mag: number): number {
  const target = dir * p.run_speed_max;
  if (vx * dir > 0 && abs(vx) > p.run_speed_max) return approach(vx, target, p.ground_brake);
  return approach(vx, target, p.run_accel_add + mul(p.run_accel_mul, mag));
}
```

- [ ] **Step 4: Run it again**

Run: `pnpm vitest run src/engine/kinetic.test.ts src/fighters/movement.test.ts`
Expected: PASS.

- [ ] **Step 5: Regenerate the golden trace, on purpose**

Run: `pnpm vitest run src/game/golden.test.ts`
Expected: FAIL — every dash and run accelerates differently. This task changes behaviour by design.

Run: `UPDATE_GOLDEN=1 pnpm vitest run src/game/golden.test.ts && pnpm vitest run src/game/golden.test.ts`
Expected: the second run passes all 5 tests, including "exercises combat, not an idle screen".

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0. `pnpm lint` reports no errors and no warning in a file this task touched; any warnings it printed before this plan started (measure once, with Plan 1 merged, before Task 0) are unchanged.

- [ ] **Step 7: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/src/engine/kinetic.test.ts \
  super-smash/src/engine/kinetic.ts \
  super-smash/src/fighters/movement.test.ts \
  super-smash/src/game/__golden__/engine-trace.json
git commit -m "super-smash: dash into run — run_accel_add + run_accel_mul, traction above run speed" -m "SmashWiki Dash. Golden trace regenerated." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 24: Light and heavy landings

Light and heavy landings (SmashWiki "Lag": "a heavy landing occurs once a player has been falling at their maximum falling speed for a set amount of time"; an auto-cancelled aerial lands heavily). `kineticExec` counts frames at full fall speed in `fallFrames`; `onLanded` picks `landing_frame_light` or `landing_frame` against `landing_heavy_frame` and stores the length in `charge`, as `landingLag` already does. The renderer's land clip reads the same `charge` (one line in `render/poses/timing.ts`).

**Files:**
- Modify: `super-smash/src/engine/kinetic.ts`
- Modify: `super-smash/src/engine/states.ts` — `onLanded`
- Modify: `super-smash/src/engine/status/air.ts`
- Modify: `super-smash/src/fighters/movement.test.ts` — imports
- Modify: `super-smash/src/game/__golden__/engine-trace.json` (regenerated by a command in this task)
- Modify: `super-smash/src/render/poses/timing.ts` — `case "land"`

**Interfaces:** LANDING's `main` ends at `charge` frames (legacy 4 when `charge` is 0); `timing.ts` `case "land"` returns `f.charge > 0 ? f.charge : LANDING_ANIMATION_FRAMES`.

- [ ] **Step 1: Write the failing test**

Append to the end of `src/fighters/movement.test.ts`:

```ts

describe("light and heavy landings (SmashWiki Lag, https://www.ssbwiki.com/Lag#Landing_lag)", () => {
  // "a heavy landing occurs once a player has been falling at their maximum
  // falling speed for a set amount of time (the amount of time is character
  // dependent)". Values: calculator SoftLandingLag (landing_frame_light),
  // HardLandingLag (landing_frame), FallingFrameToUseHardLandingLag
  // (landing_heavy_frame). UNVERIFIED, both: that a landing's lag is exactly
  // that many frames of the land state, and that the threshold is "at least"
  // (>=) rather than "more than" landing_heavy_frame frames at full fall speed.

  /** Drop a standing fighter from `height` units with no input; the frames that follow. */
  function dropFrom(id: RosterId, height: number): FighterState[] {
    const s = standing(id);
    const f = s.fighters[0];
    Object.assign(f, { y: f.y + fx(height), grounded: false, platform: -1, action: "fall", actionFrame: 0, vx: 0, vy: 0 });
    f.kinetic = emptyKinetic();
    return play(s, hold(0, 200));
  }

  function landing(frames: readonly FighterState[]): { lag: number; frames: number } {
    const at = frames.findIndex((f) => f.action === "land");
    let n = 0;
    while (frames[at + n].action === "land") n += 1;
    return { lag: frames[at].charge, frames: n };
  }

  it.each(IDS)("%s lands lightly from a short drop", (id) => {
    const p = FIGHTER_PARAMS[id];
    expect(landing(dropFrom(id, 2))).toEqual({ lag: p.landing_frame_light, frames: p.landing_frame_light });
  });

  it.each(IDS)("%s lands heavily after falling at full speed long enough", (id) => {
    const p = FIGHTER_PARAMS[id];
    expect(landing(dropFrom(id, 80))).toEqual({ lag: p.landing_frame, frames: p.landing_frame });
  });

  it("makes an auto-cancelled aerial a heavy landing, as the Lag page says", () => {
    // "Any time a character lands while this flag is not activated, they will
    // enter their normal landing animation … landing during this window will
    // result in a heavy landing."
    const s = standing("mario");
    const f = s.fighters[0];
    Object.assign(f, { action: "attack", move: "fair", actionFrame: 50, grounded: true });
    onLanded(f, { def: FIGHTERS[0], stage: STAGES[0], frame: 1, fighters: s.fighters });
    expect([f.action, f.charge]).toEqual(["land", FIGHTER_PARAMS.mario.landing_frame]);
  });
});
```

In `src/fighters/movement.test.ts`, replace:

```ts
import { toFloat } from "@/engine/fixed";
```

with:

```ts
import { fx, toFloat } from "@/engine/fixed";
import { emptyKinetic } from "@/engine/kinetic";
import { onLanded } from "@/engine/states";
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/fighters/movement.test.ts`
Expected: FAIL — 17 tests: every fighter's light and heavy landing (e.g. `expected { lag: +0, frames: 4 } to deeply equal { lag: 1, frames: 1 }`) and the auto-cancel test (`expected [ 'land', +0 ] to deeply equal [ 'land', 3 ]`).

- [ ] **Step 3: Implement**

In `src/engine/kinetic.ts`, replace:

```ts
    if (!skip) {
      k.gravityY = gravityStep(k.gravityY, p.air_accel_y, f.fastFalling ? p.dive_speed_y : p.air_speed_y_stable);
    }
  } else {
```

with:

```ts
    if (!skip) {
      k.gravityY = gravityStep(k.gravityY, p.air_accel_y, f.fastFalling ? p.dive_speed_y : p.air_speed_y_stable);
    }
    // Frames at full fall speed (or faster: a fast fall) decide a heavy landing.
    k.fallFrames = kineticSumY(f) <= -p.air_speed_y_stable ? k.fallFrames + 1 : 0;
  } else {
```

In `src/engine/states.ts`, replace:

```ts
export function onLanded(f: FighterState, ctx: StateContext): void {
  f.fastFalling = false;
```

with:

```ts
export function onLanded(f: FighterState, ctx: StateContext): void {
  const p = fighterParams(ctx.def);
  // Heavy if the fighter spent `landing_heavy_frame` frames at full fall
  // speed (SmashWiki "Lag", normal landing); read before it is reset.
  // UNVERIFIED: ">=" rather than ">" — the threshold's inclusivity is unpublished.
  const heavy = f.kinetic.fallFrames >= p.landing_heavy_frame;
  f.kinetic.fallFrames = 0;
  f.fastFalling = false;
```

In `src/engine/states.ts`, replace:

```ts
      if (early || late) {
        startAction(f, "land");
        return;
      }
```

with:

```ts
      if (early || late) {
        // An auto-cancelled aerial lands heavily (SmashWiki "Lag", aerial landing).
        startAction(f, "land");
        f.charge = p.landing_frame;
        return;
      }
```

In `src/engine/states.ts`, replace:

```ts
    f.charge = directional ? DIRECTIONAL_AIR_DODGE_LANDING_LAG : AIR_DODGE_LANDING_LAG;
    return;
  }
  startAction(f, "land");
}
```

with:

```ts
    f.charge = directional ? DIRECTIONAL_AIR_DODGE_LANDING_LAG : AIR_DODGE_LANDING_LAG;
    return;
  }
  startAction(f, "land");
  // `charge` carries the landing's length, as it does for landingLag.
  // UNVERIFIED: that the published lag is the number of frames spent in `land`.
  f.charge = heavy ? p.landing_frame : p.landing_frame_light;
}
```

In `src/engine/status/air.ts`, replace:

```ts
    if (f.actionFrame >= LANDING_ANIMATION_FRAMES) startAction(f, "stand");
```

with:

```ts
    // `charge` holds the light or heavy landing's length (see `onLanded`); a
    // landing that did not come through there plays the legacy four frames.
    if (f.actionFrame >= (f.charge > 0 ? f.charge : LANDING_ANIMATION_FRAMES)) startAction(f, "stand");
```

In `src/render/poses/timing.ts`, replace:

```ts
    case "land":
      return LANDING_ANIMATION_FRAMES;
```

with:

```ts
    case "land":
      return f.charge > 0 ? f.charge : LANDING_ANIMATION_FRAMES;
```

- [ ] **Step 4: Run it again**

Run: `pnpm vitest run src/fighters/movement.test.ts`
Expected: PASS.

- [ ] **Step 5: Regenerate the golden trace, on purpose**

Run: `pnpm vitest run src/game/golden.test.ts`
Expected: FAIL — every landing has a new length. This task changes behaviour by design.

Run: `UPDATE_GOLDEN=1 pnpm vitest run src/game/golden.test.ts && pnpm vitest run src/game/golden.test.ts`
Expected: the second run passes all 5 tests, including "exercises combat, not an idle screen".

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0. `pnpm lint` reports no errors and no warning in a file this task touched; any warnings it printed before this plan started (measure once, with Plan 1 merged, before Task 0) are unchanged.

- [ ] **Step 7: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/src/engine/kinetic.ts \
  super-smash/src/engine/states.ts \
  super-smash/src/engine/status/air.ts \
  super-smash/src/fighters/movement.test.ts \
  super-smash/src/game/__golden__/engine-trace.json \
  super-smash/src/render/poses/timing.ts
git commit -m "super-smash: light and heavy landings" -m "SmashWiki Lag: heavy after landing_heavy_frame frames at full fall speed, and after an auto-cancelled aerial. Golden trace regenerated." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 25: The ECB seam: four points for walls, ceilings, landings and ledges (partial, completed by Plan 4)

A partial ECB seam, not the finished ECB. The ECB becomes four points (bottom, top, left, right) that walls, ceilings, landings and the ledge grab read: walls stop the side point, landings the bottom, ceilings the top, and the ledge grab box is measured from the near side point. What is *not* done yet, and why the rule is UNVERIFIED: the sizes are the hurtbox's (nothing public gives them per fighter or animation), the bottom stays at the feet in the air too (so landings are unchanged), walls test the side points against the platform's span as a rectangle rather than the diamond's slanted edges, and ceilings keep the platform's own reach. Plan 4 derives the diamond from bones and completes it. What changes now: walls push the body, not the origin, clear, and ledges are reached from the body's side. Review Focus #5 gets its tests: a fighter whose body side is within reach grabs a ledge the origin rule would miss, one just beyond does not, and a fighter who walked off an edge and was pushed clear of the wall still takes that ledge.

**Files:**
- Modify: `super-smash/src/engine/physics.test.ts`
- Modify: `super-smash/src/engine/physics.ts` — `findLedgeGrab`, `facingLedge`
- Modify: `super-smash/src/engine/simulate.ts` — `grab`
- Modify: `super-smash/src/game/__golden__/engine-trace.json` (regenerated by a command in this task)

**Interfaces:** Produces (`physics.ts`): `interface Ecb { bottom; top; half }`, `ecbOf(f: Pick<FighterState, "grounded">, attrs: FighterAttributes): Ecb`, `ecbPoints(f, attrs)`. `findLedgeGrab(f, stage, frame, ecbHalf = 0)` (the default keeps the legacy rule for callers that pass none).

- [ ] **Step 1: Write the failing test**

Append to the end of `src/engine/physics.test.ts`:

```ts

describe("the environment collision box (ECB)", () => {
  // Ultimate collides a fighter with the stage through a four-point diamond —
  // bottom, top, left, right — whose bottom is locked to the feet on the ground
  // (research/rebuild-2026-10/README.md §3, "ECB"). This is a partial seam, and
  // its rule is UNVERIFIED: the size is the hurtbox's, the bottom stays at the
  // feet in the air too, walls test the side points against the platform's
  // span (a rectangle, not the diamond's slanted edges), and ceilings still use
  // the platform's reach. Plan 4 derives the diamond from bones and completes it.

  it("is a diamond on the hurtbox, its bottom at the feet", () => {
    const e = ecbOf(fighter({ grounded: true }), ATTRS);
    expect(e).toEqual({ bottom: 0, top: ATTRS.height, half: ATTRS.width });
    const pts = ecbPoints(fighter({ x: fx(10), y: fx(5) }), ATTRS);
    expect(pts.left).toEqual({ x: fx(10) - ATTRS.width, y: fx(5) + ATTRS.height / 2 });
    expect(pts.right).toEqual({ x: fx(10) + ATTRS.width, y: fx(5) + ATTRS.height / 2 });
    expect(pts.bottom).toEqual({ x: fx(10), y: fx(5) });
    expect(pts.top).toEqual({ x: fx(10), y: fx(5) + ATTRS.height });
  });

  it("reaches a ledge from the side of the body, not the middle of it (Review Focus #5)", () => {
    const half = ATTRS.width;
    const reach = LEDGE_GRAB_RANGE_X;
    // Origin just inside 3.2 + half from the ledge at x = 80: the body's side is within 3.2.
    const near = fighter({ x: fx(80) + reach + half - fx(0.05), y: fx(-2), vy: -fx(1), facing: -1 });
    expect(findLedgeGrab(near, STAGE, 0, half)).toEqual({ platform: 0, side: 1 });
    expect(findLedgeGrab(near, STAGE, 0)).toBeNull(); // the legacy origin rule would not reach
    const far = fighter({ x: fx(80) + reach + half + fx(0.05), y: fx(-2), vy: -fx(1), facing: -1 });
    expect(findLedgeGrab(far, STAGE, 0, half)).toBeNull();
  });

  it("still takes the ledge a fighter walked off, after the wall pushes the body clear", () => {
    // Origin left the platform last frame, body still overlapping the wall.
    const f = fighter({ x: fx(81), y: fx(-1), vy: -fx(1), facing: 1, grounded: false, platform: -1 });
    resolveCollision(f, fx(80.5), 0, STAGE, ATTRS, 0);
    expect(f.x).toBe(fx(80) + ATTRS.width);
    expect(findLedgeGrab({ ...f, facing: -1 }, STAGE, 0, ATTRS.width)).toEqual({ platform: 0, side: 1 });
  });
});
```

In `src/engine/physics.test.ts`, replace:

```ts
    const f = fighter({ x: fx(78), y: fx(-10), vx: -fx(2) });
    const out = resolveCollision(f, fx(82), fx(-10), STAGE, ATTRS, 0);
    expect(out.blocked).toBe(true);
    expect(f.x).toBe(fx(80));
```

with:

```ts
    const f = fighter({ x: fx(78), y: fx(-10), vx: -fx(2) });
    const out = resolveCollision(f, fx(82), fx(-10), STAGE, ATTRS, 0);
    expect(out.blocked).toBe(true);
    // The ECB's left point stops at the wall face, so the origin rests half a body out.
    expect(f.x).toBe(fx(80) + ATTRS.width);
```

In `src/engine/physics.test.ts`, replace:

```ts
  decayLaunch,
```

with:

```ts
  decayLaunch,
  ecbOf,
  ecbPoints,
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/engine/physics.test.ts`
Expected: FAIL — 4 tests: "is a diamond on the hurtbox…" throws `TypeError: ecbOf is not a function`; "stops a fighter that drifts into the side of a hard platform" (`expected 331776 to be 344064`) and "still takes the ledge a fighter walked off" (`expected 327680 to be 344064`) find the origin, not the body, at the wall face; "reaches a ledge from the side of the body" gets `null`.

- [ ] **Step 3: Implement**

In `src/engine/physics.ts`, replace:

```ts
    // The wall stops the fighter's *origin*, not its whole body. Pushing the
    // body out instead would eject a fighter who walked off the edge to a full
    // half-width clear of the stage — past the 3.2-unit ledge grab box, so it
    // could never grab the ledge it just stepped off.
    const reach = p.halfWidth;
    const bottom = p.y - HARD_PLATFORM_DEPTH;
    const head = f.y + attrs.height;
    // Only a fighter that *crossed* a wall face this frame is pushed out. Testing
    // containment instead would shove anybody standing under the stage sideways,
    // and under the stage is where every edgeguard in the game takes place.
    const cameFromOutside = abs(prevX - cx) >= reach;
    if (cameFromOutside && f.y < p.y && head > bottom && abs(f.x - cx) < reach) {
      f.x = prevX <= cx ? cx - reach : cx + reach;
      kineticSetX(f, 0);
      out.blocked = true;
    }
    // Ceiling: rising into the underside of a solid body.
    if (f.vy > 0 && abs(f.x - cx) < reach && prevY + attrs.height <= bottom && head > bottom) {
      f.y = bottom - attrs.height;
      kineticSetY(f, 0);
      out.blocked = true;
    }
```

with:

```ts
    // The wall stops the ECB's side point: the body, not the middle of it.
    // The ledge grab box is measured from the same side point (`findLedgeGrab`),
    // so a fighter pushed clear of the wall is still at the ledge it left.
    const reach = p.halfWidth;
    const body = reach + ecb.half;
    const bottom = p.y - HARD_PLATFORM_DEPTH;
    const head = f.y + ecb.top;
    // Only a fighter whose origin was outside the platform's span last frame is
    // pushed out. Testing containment instead would shove anybody standing under
    // the stage sideways, and under the stage is where every edgeguard happens.
    const cameFromOutside = abs(prevX - cx) >= reach;
    if (cameFromOutside && f.y + ecb.bottom < p.y && head > bottom && abs(f.x - cx) < body) {
      f.x = prevX <= cx ? cx - body : cx + body;
      kineticSetX(f, 0);
      out.blocked = true;
    }
    // Ceiling: the ECB's top rising into the underside of a solid body.
    if (f.vy > 0 && abs(f.x - cx) < reach && prevY + ecb.top <= bottom && head > bottom) {
      f.y = bottom - ecb.top;
      kineticSetY(f, 0);
      out.blocked = true;
    }
```

In `src/engine/physics.ts`, replace:

```ts
  const out: CollisionOutcome = { landed: false, leftGround: false, blocked: false };
```

with:

```ts
  const out: CollisionOutcome = { landed: false, leftGround: false, blocked: false };
  const ecb = ecbOf(f, attrs);
```

In `src/engine/physics.ts`, replace:

```ts
    if (prevY < p.y) continue; // was already below the surface — no landing from under
    if (f.y > p.y) continue; // still above it
    f.y = p.y;
```

with:

```ts
    // The ECB's bottom point does the landing.
    if (prevY + ecb.bottom < p.y) continue; // was already below the surface — no landing from under
    if (f.y + ecb.bottom > p.y) continue; // still above it
    f.y = p.y - ecb.bottom;
```

In `src/engine/physics.ts`, replace:

```ts
export function findLedgeGrab(
  f: FighterState,
  stage: StageDef,
  frame: number,
): LedgeGrab | null {
```

with:

```ts
export function findLedgeGrab(
  f: FighterState,
  stage: StageDef,
  frame: number,
  ecbHalf = 0,
): LedgeGrab | null {
```

In `src/engine/physics.ts`, replace:

```ts
      // Only reachable from outboard of the ledge.
      if ((f.x - lx) * side < 0) continue;
      // Facing the ledge means facing back toward the stage: the opposite of the side.
      const facingLedge = f.facing === -side;
      const rangeX = facingLedge ? LEDGE_GRAB_RANGE_X : mul(LEDGE_GRAB_RANGE_X, LEDGE_GRAB_BACK_PENALTY);
      if (abs(f.x - lx) > rangeX) continue;
```

with:

```ts
      // Only reachable from outboard of the ledge.
      const outboard = (f.x - lx) * side;
      if (outboard < 0) continue;
      // Facing the ledge means facing back toward the stage: the opposite of the side.
      const facingLedge = f.facing === -side;
      const rangeX = facingLedge ? LEDGE_GRAB_RANGE_X : mul(LEDGE_GRAB_RANGE_X, LEDGE_GRAB_BACK_PENALTY);
      // Measured from the ECB's near side point (`ecbHalf` in from the origin).
      if (outboard - ecbHalf > rangeX) continue;
```

Append to the end of `src/engine/physics.ts`:

```ts

/* -------------------------------------------------------------------- ECB -- */

/**
 * The environment collision box: four points relative to the origin — bottom
 * (0, bottom), top (0, top), left (−half, mid) and right (+half, mid), mid
 * halfway up. Ultimate derives it from bones each frame and locks the bottom
 * to the feet on the ground (research/rebuild-2026-10/README.md §3, "ECB").
 *
 * A partial seam, UNVERIFIED as a rule: nothing public gives the sizes per
 * fighter or per animation, so until Plan 4 bakes bones the diamond is the
 * hurtbox's height and half-width with its bottom at the feet in the air as
 * well; `resolveCollision` tests the side points against a platform's span as
 * a rectangle (no slanted diamond edges) and keeps the platform's own reach
 * for ceilings. Plan 4 completes it from bones.
 */
export interface Ecb {
  readonly bottom: number;
  readonly top: number;
  readonly half: number;
}

export function ecbOf(_f: Pick<FighterState, "grounded">, attrs: FighterAttributes): Ecb {
  return { bottom: 0, top: attrs.height, half: attrs.width };
}

export function ecbPoints(
  f: Pick<FighterState, "x" | "y" | "grounded">,
  attrs: FighterAttributes,
): { bottom: { x: number; y: number }; top: { x: number; y: number }; left: { x: number; y: number }; right: { x: number; y: number } } {
  const e = ecbOf(f, attrs);
  const mid = f.y + Math.trunc((e.bottom + e.top) / 2);
  return {
    bottom: { x: f.x, y: f.y + e.bottom },
    top: { x: f.x, y: f.y + e.top },
    left: { x: f.x - e.half, y: mid },
    right: { x: f.x + e.half, y: mid },
  };
}
```

In `src/engine/simulate.ts`, replace:

```ts
      const grab = findLedgeGrab(f, stage, s.frame);
```

with:

```ts
      const grab = findLedgeGrab(f, stage, s.frame, ecbOf(f, defs[i].attributes).half);
```

In `src/engine/simulate.ts`, replace:

```ts
  blastZoneKO,
```

with:

```ts
  blastZoneKO,
  ecbOf,
```

- [ ] **Step 4: Run it again**

Run: `pnpm vitest run src/engine/physics.test.ts`
Expected: PASS.

- [ ] **Step 5: Regenerate the golden trace, on purpose**

Run: `pnpm vitest run src/game/golden.test.ts`
Expected: FAIL — wall push-outs and ledge reach changed. This task changes behaviour by design.

Run: `UPDATE_GOLDEN=1 pnpm vitest run src/game/golden.test.ts && pnpm vitest run src/game/golden.test.ts`
Expected: the second run passes all 5 tests, including "exercises combat, not an idle screen".

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0. `pnpm lint` reports no errors and no warning in a file this task touched; any warnings it printed before this plan started (measure once, with Plan 1 merged, before Task 0) are unchanged.

- [ ] **Step 7: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/src/engine/physics.test.ts \
  super-smash/src/engine/physics.ts \
  super-smash/src/engine/simulate.ts \
  super-smash/src/game/__golden__/engine-trace.json
git commit -m "super-smash: the ECB seam — four points for walls, ceilings, landings and ledges" -m "Walls stop the side point and ledges are reached from it. A partial seam with an UNVERIFIED rule: hurtbox sizes, bottom at the feet in the air, rectangular wall test, platform reach for ceilings; Plan 4 completes it from bones. Review Focus #5 tests. Golden trace regenerated." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 26: The renderer and the animation lab time jumps from FighterParams

The renderer and the animation lab time the `jump` clip by how long the rise lasts, and until now they worked it out from the legacy `fullHopVelocity / gravity` attributes — numbers the engine stopped using in Task 19. Give `kinetic.ts` a pure `jumpRiseSpeeds(p, kind, airJump)` that replays the engine's own jump rule, prove it equals what `step()` produces frame for frame for every fighter, and move `render/poses/timing.ts` (`JumpTiming`, `jumpTimingFor`), `render/renderer.ts` and `app/anim/page.tsx` onto it. Kirby's five midair jumps each get their own rise. Comments in `rise.ts`, `fall.ts` and `rise.test.ts` that quoted the old formula are corrected.

**Files:**
- Create: `super-smash/src/render/poses/jumpTiming.test.ts`
- Modify: `super-smash/src/app/anim/lab.test.ts` — `fox`, imports
- Modify: `super-smash/src/app/anim/page.tsx` — `JumpAttributes`, `lengthOf`, `verticalFor`, `attrs`
- Modify: `super-smash/src/engine/kinetic.ts`
- Modify: `super-smash/src/fighters/movement.test.ts` — imports
- Modify: `super-smash/src/render/poses/fall.ts`
- Modify: `super-smash/src/render/poses/rise.test.ts`
- Modify: `super-smash/src/render/poses/rise.ts`
- Modify: `super-smash/src/render/poses/timing.ts` — `JumpAttributes`, `v`, `clip`, `stateFrames`, `name`, imports
- Modify: `super-smash/src/render/renderer.ts` — `attrs`, `sample`, `PoseSample`

**Interfaces:** Produces (`kinetic.ts`): `type JumpKind = "full" | "short" | "air"`, `jumpRiseSpeeds(p: FighterParams, kind: JumpKind, airJump?: number): number[]`. (`render/poses/timing.ts`): `interface JumpTiming { full: number; short: number; air: readonly number[] }`, `jumpTimingFor(def: FighterDef): JumpTiming`; `actionDurationFor`, `poseTimeFor`, `poseSpinFor`, `samplePoseForFighter` take `jump?: JumpTiming` where they took `attrs?: JumpAttributes`. Removed: `JumpAttributes`. (`app/anim/page.tsx`): `verticalFor(o, def: FighterDef | undefined, frame)`.

- [ ] **Step 1: Write the failing test**

Append to the end of `src/fighters/movement.test.ts`:

```ts

describe("rise timing for the renderer (jumpRiseSpeeds)", () => {
  // The renderer and the animation lab time the `jump` clip by how long the
  // `jump` action lasts. They read it from `jumpRiseSpeeds`, so it must be
  // exactly the vertical speed `step()` gives each frame of that action — the
  // rise, plus the frame the speed stops being positive.

  function risingSpeeds(frames: readonly FighterState[], from: number): number[] {
    const out: number[] = [];
    for (let i = from; i < frames.length && frames[i].action === "jump"; i++) out.push(frames[i].vy);
    return out;
  }

  it.each(IDS)("%s: full hop, short hop and first air jump, frame for frame", (id) => {
    const p = FIGHTER_PARAMS[id];
    const full = play(standing(id), hold(Btn.Jump, 120));
    expect(risingSpeeds(full, full.findIndex((f) => f.action === "jump"))).toEqual(jumpRiseSpeeds(p, "full"));
    const short = play(standing(id), [Btn.Jump, ...hold(0, 120)]);
    expect(risingSpeeds(short, short.findIndex((f) => f.action === "jump"))).toEqual(jumpRiseSpeeds(p, "short"));
    // Short hop, then a midair jump; its rise starts on the frame `jumpsUsed` becomes 2.
    const air = play(standing(id), [Btn.Jump, ...hold(0, 8), Btn.Jump, ...hold(0, 90)]);
    expect(risingSpeeds(air, air.findIndex((f) => f.jumpsUsed === 2))).toEqual(jumpRiseSpeeds(p, "air", 0));
  });
});
```

In `src/fighters/movement.test.ts`, replace:

```ts
import { initialRiseStep, jumpLaunchSpeed } from "@/engine/kinetic";
```

with:

```ts
import { initialRiseStep, jumpLaunchSpeed, jumpRiseSpeeds } from "@/engine/kinetic";
```

Create `src/render/poses/jumpTiming.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { jumpRiseSpeeds } from "@/engine/kinetic";
import { fighterParams } from "@/engine/params";
import { getFighter } from "@/fighters";
import { makeFighter } from "../testFixtures";
import { actionDurationFor, jumpTimingFor } from "./timing";

describe("the jump clip's length comes from the engine's jump rule", () => {
  const fox = getFighter("fox")!;
  const kirby = getFighter("kirby")!;

  it("is the number of rising frames, for each kind of jump", () => {
    const p = fighterParams(fox);
    const t = jumpTimingFor(fox);
    expect(t.full).toBe(jumpRiseSpeeds(p, "full").length);
    expect(t.short).toBe(jumpRiseSpeeds(p, "short").length);
    expect(t.air[0]).toBe(jumpRiseSpeeds(p, "air", 0).length);
    const jump = (over: object) => makeFighter({ action: "jump", actionFrame: 0, ...over });
    expect(actionDurationFor(jump({ jumpsUsed: 1, shortHop: false }), t)).toBe(t.full);
    expect(actionDurationFor(jump({ jumpsUsed: 1, shortHop: true }), t)).toBe(t.short);
    expect(actionDurationFor(jump({ jumpsUsed: 2 }), t)).toBe(t.air[0]);
  });

  it("gives each of Kirby's midair jumps its own, shorter rise", () => {
    const t = jumpTimingFor(kirby);
    expect(t.air).toHaveLength(5);
    for (let i = 1; i < 5; i++) expect(t.air[i]).toBeLessThan(t.air[i - 1]);
    const fifth = makeFighter({ action: "jump", actionFrame: 0, jumpsUsed: 6 });
    expect(actionDurationFor(fifth, t)).toBe(t.air[4]);
  });

  it("is cached per fighter definition", () => {
    expect(jumpTimingFor(fox)).toBe(jumpTimingFor(fox));
  });
});
```

In `src/app/anim/lab.test.ts`, replace:

```ts
  it("uses the second jump's own velocity when the second jump is selected", () => {
    // `airJumpVelocity` differs from `fullHopVelocity` for DK, Fox and Kirby,
    // and the lab offers the choice — so taking the first jump's number for
    // both made the option a lie for exactly the fighters it matters to.
    const fox = getFighter("fox")!.attributes;
    expect(fox.airJumpVelocity, "Fox's two jumps are the same speed").not.toBe(fox.fullHopVelocity);
    const first = verticalFor(opts({ action: "jump", jumpsUsed: 1 }), fox, 0);
    const second = verticalFor(opts({ action: "jump", jumpsUsed: 2 }), fox, 0);
    expect(second, "the second jump borrowed the first's velocity").not.toBe(first);
    expect(second).toBe(fox.airJumpVelocity - fox.gravity * 0);
  });

  it("falls at the fighter's own terminal speed, faster when fast-falling", () => {
    const fox = getFighter("fox")!.attributes;
    const normal = verticalFor(opts({ action: "fall" }), fox, 10);
    const fast = verticalFor(opts({ action: "fall", fastFalling: true }), fox, 10);
    expect(normal, "a fall is not downward").toBeLessThan(0);
    expect(fast, "fast-falling is not faster").toBeLessThan(normal);
  });

  it("leaves a grounded state at rest", () => {
    expect(verticalFor(opts({ action: "stand" }), getFighter("fox")!.attributes, 5)).toBe(0);
  });
```

with:

```ts
  it("uses the second jump's own rise when the second jump is selected", () => {
    // A full hop and a midair jump rise differently for every fighter (a full
    // hop has its initial height) — the lab offers the choice, so it has to
    // honour it, and with the engine's own numbers (`jumpRiseSpeeds`).
    const fox = getFighter("fox")!;
    const p = fighterParams(fox);
    const first = verticalFor(opts({ action: "jump", jumpsUsed: 1 }), fox, 0);
    const second = verticalFor(opts({ action: "jump", jumpsUsed: 2 }), fox, 0);
    expect(second, "the second jump borrowed the first's speed").not.toBe(first);
    expect(first).toBe(jumpRiseSpeeds(p, "full")[0]);
    expect(second).toBe(jumpRiseSpeeds(p, "air", 0)[0]);
    expect(verticalFor(opts({ action: "jump", jumpsUsed: 2 }), fox, 5)).toBe(jumpRiseSpeeds(p, "air", 0)[5]);
  });

  it("falls at the fighter's own terminal speed, faster when fast-falling", () => {
    const fox = getFighter("fox")!;
    const p = fighterParams(fox);
    const normal = verticalFor(opts({ action: "fall" }), fox, 10);
    const fast = verticalFor(opts({ action: "fall", fastFalling: true }), fox, 10);
    expect(normal).toBe(-p.air_speed_y_stable);
    expect(fast).toBe(-p.dive_speed_y);
  });

  it("leaves a grounded state at rest", () => {
    expect(verticalFor(opts({ action: "stand" }), getFighter("fox")!, 5)).toBe(0);
  });
```

In `src/app/anim/lab.test.ts`, replace:

```ts
import { getFighter } from "@/fighters";
```

with:

```ts
import { getFighter } from "@/fighters";
import { jumpRiseSpeeds } from "@/engine/kinetic";
import { fighterParams } from "@/engine/params";
```

In `src/render/poses/rise.test.ts`, replace:

```ts
    // `fullHopVelocity / gravity` — frame 18 for Fox and frame 31 for Samus —
```

with:

```ts
    // rise (`jumpTimingFor`), which differs across the cast by a dozen frames —
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/app/anim/lab.test.ts src/fighters/movement.test.ts src/render/poses/jumpTiming.test.ts src/render/poses/rise.test.ts`
Expected: FAIL — 13 tests: every fighter's "full hop, short hop and first air jump, frame for frame" (`TypeError: jumpRiseSpeeds is not a function`); the three `jumpTiming.test.ts` tests (`TypeError: jumpTimingFor is not a function`); and two `lab.test.ts` tests that now pass a `FighterDef` (`expected NaN to be -8602`, `the second jump borrowed the first's speed: expected NaN not to be NaN`).

- [ ] **Step 3: Implement**

Append to the end of `src/engine/kinetic.ts`:

```ts

/* ------------------------------------------------------------ rise timing -- */

export type JumpKind = "full" | "short" | "air";

/**
 * The vertical speed on every frame of a jump's `jump` action — each rising
 * frame, then the frame whose speed first stops being positive (the status
 * turns to FALL on the frame after) — by exactly the rule `kineticExec` applies
 * (the initial rise, then `jumpLaunchSpeed` with gravity on every frame). Pure and
 * stateless, for the layers that time a clip by the rise: the renderer
 * (`jumpTimingFor`) and the animation lab. `airJump` indexes
 * `jump_aerial_y_list` (0 = the first midair jump).
 */
export function jumpRiseSpeeds(p: FighterParams, kind: JumpKind, airJump = 0): number[] {
  const out: number[] = [];
  const g = p.air_accel_y;
  if (g <= 0) return out;
  let v: number;
  if (kind === "full" && p.jump_initial_y > 0) {
    for (let n = 1; n <= 4; n++) out.push(initialRiseStep(p.jump_initial_y, n));
    v = jumpLaunchSpeed(g, p.jump_y - p.jump_initial_y);
  } else {
    const list = p.jump_aerial_y_list;
    const air = list === undefined ? p.jump_aerial_y : list[Math.min(airJump, list.length - 1)];
    v = jumpLaunchSpeed(g, kind === "full" ? p.jump_y : kind === "short" ? p.mini_jump_y : air);
  }
  for (;;) {
    v -= g;
    out.push(v);
    if (v <= 0) return out;
  }
}
```

In `src/render/poses/timing.ts`, replace:

```ts
/**
 * What the pose layer needs from a fighter's attributes.
 *
 * Only the jump needs any, and it needs them because a jump's length is not a
 * constant: it lasts until the rise runs out, which is the launch velocity
 * divided by the fighter's own gravity. Fox is airborne for 18 frames and Samus
 * for 31. Played over a fixed thirty, Fox's somersault reached 216 degrees
 * before the fall cut in and handed the renderer a fighter tucked on his side.
 */
export type JumpAttributes = Pick<
  FighterDef["attributes"],
  "gravity" | "fullHopVelocity" | "shortHopVelocity" | "airJumpVelocity"
>;
```

with:

```ts
/**
 * How long each kind of jump rises, in frames, for one fighter.
 *
 * Only the jump needs this, because a jump's length is not a constant: it
 * lasts until the rise runs out, and how long that is depends on the
 * fighter's published heights and gravity. Played over a fixed thirty, Fox's
 * somersault reached 216 degrees before the fall cut in and handed the
 * renderer a fighter tucked on his side. The numbers come from the engine's
 * own rule (`jumpRiseSpeeds`), so the clip and the simulation cannot drift.
 */
export interface JumpTiming {
  readonly full: number;
  readonly short: number;
  /** Per midair jump: `air[0]` is the first. One entry unless the fighter has a per-jump list. */
  readonly air: readonly number[];
}

const jumpTimings = new WeakMap<FighterDef, JumpTiming>();

/** The fighter's jump timing, from its `FighterParams`; cached per definition. */
export function jumpTimingFor(def: FighterDef): JumpTiming {
  let t = jumpTimings.get(def);
  if (t === undefined) {
    const p = fighterParams(def);
    const airs = p.jump_aerial_y_list?.length ?? 1;
    t = {
      full: jumpRiseSpeeds(p, "full").length,
      short: jumpRiseSpeeds(p, "short").length,
      air: Array.from({ length: airs }, (_, i) => jumpRiseSpeeds(p, "air", i).length),
    };
    jumpTimings.set(def, t);
  }
  return t;
}
```

In `src/render/poses/timing.ts`, replace:

```ts
  attrs?: JumpAttributes,
): number | undefined {
  switch (f.action) {
    // Frames until the rise runs out. The ratio of two Q12 values is a plain
    // number, so no conversion is needed.
    case "jump": {
      if (!attrs || attrs.gravity <= 0) return undefined;
      const v =
        f.jumpsUsed >= 2
          ? attrs.airJumpVelocity
          : f.shortHop
            ? attrs.shortHopVelocity
            : attrs.fullHopVelocity;
      return Math.max(1, Math.round(v / attrs.gravity));
    }
```

with:

```ts
  jump?: JumpTiming,
): number | undefined {
  switch (f.action) {
    // Frames until the rise runs out (`jumpTimingFor`).
    case "jump": {
      if (!jump) return undefined;
      const n =
        f.jumpsUsed >= 2
          ? jump.air[Math.min(f.jumpsUsed - 2, jump.air.length - 1)]
          : f.shortHop
            ? jump.short
            : jump.full;
      return Math.max(1, n);
    }
```

In `src/render/poses/timing.ts`, replace:

```ts
  timing?: MoveTiming,
  attrs?: JumpAttributes,
): number {
  const clip = clipFor(fighter.defId, name);
```

with:

```ts
  timing?: MoveTiming,
  jump?: JumpTiming,
): number {
  const clip = clipFor(fighter.defId, name);
```

In `src/render/poses/timing.ts`, replace:

```ts
  const stateFrames = actionDurationFor(fighter, attrs);
```

with:

```ts
  const stateFrames = actionDurationFor(fighter, jump);
```

In `src/render/poses/timing.ts`, replace:

```ts
  timing?: MoveTiming,
  attrs?: JumpAttributes,
): number {
  const name = poseNameFor(fighter);
  const spin = clipFor(fighter.defId, name)?.spin;
  if (!spin) return 0;
  return poseTimeFor(name, fighter, frame, timing, attrs) * spin * Math.PI * 2;
```

with:

```ts
  timing?: MoveTiming,
  jump?: JumpTiming,
): number {
  const name = poseNameFor(fighter);
  const spin = clipFor(fighter.defId, name)?.spin;
  if (!spin) return 0;
  return poseTimeFor(name, fighter, frame, timing, jump) * spin * Math.PI * 2;
```

In `src/render/poses/timing.ts`, replace:

```ts
  timing?: MoveTiming,
  attrs?: JumpAttributes,
): PoseSample {
  const name = poseNameFor(fighter);
  return samplePose(clipFor(fighter.defId, name), poseTimeFor(name, fighter, frame, timing, attrs));
```

with:

```ts
  timing?: MoveTiming,
  jump?: JumpTiming,
): PoseSample {
  const name = poseNameFor(fighter);
  return samplePose(clipFor(fighter.defId, name), poseTimeFor(name, fighter, frame, timing, jump));
```

In `src/render/poses/timing.ts`, replace:

```ts
import { toFloat } from "@/engine/fixed";
```

with:

```ts
import { toFloat } from "@/engine/fixed";
import { jumpRiseSpeeds } from "@/engine/kinetic";
import { fighterParams } from "@/engine/params";
```

In `src/render/renderer.ts`, replace:

```ts
  const attrs = d.def?.attributes;
```

with:

```ts
  const jump = d.def ? jumpTimingFor(d.def) : undefined;
```

In `src/render/renderer.ts`, replace:

```ts
  const sample = samplePoseForFighter(posed, frame, timing, attrs);
```

with:

```ts
  const sample = samplePoseForFighter(posed, frame, timing, jump);
```

In `src/render/renderer.ts`, replace:

```ts
poseSpinFor(posed, frame, timing, attrs) },
```

with:

```ts
poseSpinFor(posed, frame, timing, jump) },
```

In `src/render/renderer.ts`, replace:

```ts
import { moveTimingFor, poseNameFor, poseSpinFor, samplePoseForFighter, type PoseSample } from "./poses";
```

with:

```ts
import { jumpTimingFor, moveTimingFor, poseNameFor, poseSpinFor, samplePoseForFighter, type PoseSample } from "./poses";
```

In `src/app/anim/page.tsx`, replace:

```tsx
  samplePoseForFighter,
  type JumpAttributes,
} from "@/render/poses";
```

with:

```tsx
  samplePoseForFighter,
  jumpTimingFor,
  type JumpTiming,
} from "@/render/poses";
import { jumpRiseSpeeds } from "@/engine/kinetic";
import { fighterParams } from "@/engine/params";
```

In `src/app/anim/page.tsx`, replace:

```tsx
function lengthOf(f: FighterState, attrs?: JumpAttributes, moveFrames?: number): number {
```

with:

```tsx
function lengthOf(f: FighterState, jump?: JumpTiming, moveFrames?: number): number {
```

In `src/app/anim/page.tsx`, replace:

```tsx
    return actionDurationFor(f, attrs) ?? (moveFrames && moveFrames > 0 ? moveFrames : OPEN_ENDED);
```

with:

```tsx
    return actionDurationFor(f, jump) ?? (moveFrames && moveFrames > 0 ? moveFrames : OPEN_ENDED);
```

In `src/app/anim/page.tsx`, replace:

```tsx
    vy: verticalFor(o, getFighter(o.fighterId)?.attributes, frame),
```

with:

```tsx
    vy: verticalFor(o, getFighter(o.fighterId), frame),
```

In `src/app/anim/page.tsx`, replace:

```tsx
 * and inventing an arc here would be inventing physics. A fall gets the
 * fighter's own terminal speed, a jump gets its initial velocity decayed by
 * gravity and clamped at that terminal, and everything else stays at zero
 * because everything else genuinely is.
 */
export function verticalFor(
  o: Options,
  attrs: FighterDef["attributes"] | undefined,
  frame: number,
): number {
  if (!attrs) return 0;
  const terminal = -(o.fastFalling ? attrs.fastFallSpeed : attrs.fallSpeed);
  if (o.action === "fall") return terminal;
  if (o.action === "jump") {
    // The second jump is a different number, and markedly so for DK, Fox and
    // Kirby — the lab offers the choice, so it has to honour it.
    const launch = o.jumpsUsed >= 2 ? attrs.airJumpVelocity : attrs.fullHopVelocity;
    return Math.max(terminal, launch - attrs.gravity * frame);
  }
  return 0;
}
```

with:

```tsx
 * and inventing an arc here would be inventing physics. A fall gets the
 * fighter's own terminal speed, a jump the engine's own rise for that frame
 * (`jumpRiseSpeeds`, the same numbers `step()` produces), and everything else
 * stays at zero because everything else genuinely is.
 */
export function verticalFor(o: Options, def: FighterDef | undefined, frame: number): number {
  if (!def) return 0;
  const p = fighterParams(def);
  if (o.action === "fall") return -(o.fastFalling ? p.dive_speed_y : p.air_speed_y_stable);
  if (o.action === "jump") {
    // The second jump is a different rise — the lab offers the choice, so it
    // has to honour it. Past the apex the clip is over; the speed is 0.
    const rise = o.jumpsUsed >= 2 ? jumpRiseSpeeds(p, "air", o.jumpsUsed - 2) : jumpRiseSpeeds(p, "full");
    return rise[frame] ?? 0;
  }
  return 0;
}
```

In `src/app/anim/page.tsx`, replace:

```tsx
  const attrs = def?.attributes;
  const pose = samplePoseForFighter(f, frame, usesMove ? timing : undefined, attrs);
```

with:

```tsx
  const jump = def ? jumpTimingFor(def) : undefined;
  const pose = samplePoseForFighter(f, frame, usesMove ? timing : undefined, jump);
```

In `src/app/anim/page.tsx`, replace:

```tsx
    rotation: pose.rotation + poseSpinFor(f, frame, usesMove ? timing : undefined, attrs),
```

with:

```tsx
    rotation: pose.rotation + poseSpinFor(f, frame, usesMove ? timing : undefined, jump),
```

In `src/app/anim/page.tsx`, replace:

```tsx
      fighterAt(o, 0),
      def?.attributes,
      usesMoveFor(o.action)
```

with:

```tsx
      fighterAt(o, 0),
      def ? jumpTimingFor(def) : undefined,
      usesMoveFor(o.action)
```

In `src/render/poses/rise.ts`, replace:

```ts
 * it a fighter actually sees is `fullHopVelocity / gravity`, which is eighteen
 * frames for Fox and thirty-one for Samus.
```

with:

```ts
 * it a fighter actually sees is its rise (`jumpTimingFor`, from the engine's
 * own jump rule), which differs across the cast by more than a dozen frames.
```

In `src/render/poses/rise.ts`, replace:

```ts
    // handover lands on is `fullHopVelocity / gravity` and differs across the
```

with:

```ts
    // handover lands on is the fighter's rise (`jumpTimingFor`) and differs across the
```

In `src/render/poses/fall.ts`, replace:

```ts
 * cut short by `fullHopVelocity / gravity`, so the crossover lands around three
```

with:

```ts
 * cut short by the fighter's rise (`jumpTimingFor`), so the crossover lands around three
```

- [ ] **Step 4: Run it again**

Run: `pnpm vitest run src/app/anim/lab.test.ts src/fighters/movement.test.ts src/render/poses/jumpTiming.test.ts src/render/poses/rise.test.ts`
Expected: PASS.

- [ ] **Step 5: The golden trace must not move**

Run: `pnpm vitest run src/game/golden.test.ts`
Expected: PASS, unchanged. Only presentation timing changes; the simulation does not.

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0. `pnpm lint` reports no errors and no warning in a file this task touched; any warnings it printed before this plan started (measure once, with Plan 1 merged, before Task 0) are unchanged.

- [ ] **Step 7: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/src/app/anim/lab.test.ts \
  super-smash/src/app/anim/page.tsx \
  super-smash/src/engine/kinetic.ts \
  super-smash/src/fighters/movement.test.ts \
  super-smash/src/render/poses/fall.ts \
  super-smash/src/render/poses/jumpTiming.test.ts \
  super-smash/src/render/poses/rise.test.ts \
  super-smash/src/render/poses/rise.ts \
  super-smash/src/render/poses/timing.ts \
  super-smash/src/render/renderer.ts
git commit -m "super-smash: the renderer and the animation lab time jumps from FighterParams" -m "jumpRiseSpeeds replays the engine's jump rule and matches step() frame for frame for every fighter; JumpTiming replaces the legacy JumpAttributes in the pose layer and the lab." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 27: The game's SimContext carries the bone table, and online peers refuse a different one

Task 15 made the bone table a `SimContext` field; this task gives the game one context and makes the online match depend on it. `src/game/simContext.ts` defines `GAME_SIM_CONTEXT` (the registry plus `LEGACY_BONE_TABLE`; Plan 4 swaps in its bake here and nowhere else) and `engineFingerprint()`. `ENGINE_ROLLBACK_DEPS` and the offline match loop step with it. Two peers whose bone tables differ would place hitboxes differently and desync on the first hit, so the host's `start` now carries `bones` (the fingerprint) and the guest refuses a start that is not its own build's: it sends the host a `refuse` lobby message (reason `engine-mismatch`) and both screens show the same sentence — versions differ, both reload. This is written against Plan 1's online code (Tasks 12, 13, 14, 17, 20): `src/net/online/lobby.ts`, `src/game/onlineConfig.ts`, `src/lib/onlineStore.ts`, `src/game/rollbackDeps.ts`, `src/game/matchRunner.ts` and the `CONFIG` fixtures in their tests.

**Files:**
- Create: `super-smash/src/game/simContext.test.ts`
- Create: `super-smash/src/game/simContext.ts`
- Modify: `super-smash/src/game/matchRunner.ts` — imports, `result`
- Modify: `super-smash/src/game/onlineConfig.test.ts` — imports, `"makes a positive 31-bit seed"`
- Modify: `super-smash/src/game/onlineConfig.ts` — imports
- Modify: `super-smash/src/game/rollbackDeps.test.ts` — imports
- Modify: `super-smash/src/game/rollbackDeps.ts` — `ENGINE_ROLLBACK_DEPS`
- Modify: `super-smash/src/lib/onlineStore.test.ts` — imports, `"explains a full room in words"`
- Modify: `super-smash/src/lib/onlineStore.ts` — `OnlineErrorReason`, `case "start"`, `sendLobby`, `StageForm`
- Modify: `super-smash/src/net/online/lobby.test.ts` — `"reads an away flag"`
- Modify: `super-smash/src/net/online/lobby.ts` — `ID`, `case "away"`
- Modify: `super-smash/src/components/menu/CharacterSelect.online.test.tsx` — `Role`, `CONFIG`

**Interfaces:** Produces (`src/game/simContext.ts`): `GAME_SIM_CONTEXT: SimContext`, `engineFingerprint(ctx?: SimContext): string`. `OnlineMatchConfig` gains `readonly bones: string` (8 lowercase hex digits; `parseLobbyMessage` rejects a start without it). (`onlineConfig.ts`): `startConfigProblem(config: OnlineMatchConfig, local?: string): string | null`. `OnlineErrorReason` gains `"engine-mismatch"`. `ENGINE_ROLLBACK_DEPS.step` passes `ctx: GAME_SIM_CONTEXT`. `LobbyMessage` gains `{ kind: "refuse"; reason: "engine-mismatch" }` (sent by the guest, shown by the host).

- [ ] **Step 1: Write the failing test**

**Plan 1 anchors.** Two edits below land in files only Plan 1 creates and that this plan's scratch validation did not have in their post-Plan-1 form: `src/components/menu/CharacterSelect.online.test.tsx` (Plan 1 Task 20) and the `tick` loop of `src/game/matchRunner.ts` (Plan 1 Task 17, step 8 — the six-space-indented `const result = step(state, inputs, { prevInputs });` inside the `else` branch). Their old text is quoted from Plan 1; if Plan 1 landed it differently, re-anchor by the symbol named and keep the replacement. Every other file here was validated with Plan 1 Tasks 12, 14 and 17 applied.

Create `src/game/simContext.test.ts`:

```ts
import { beforeAll, describe, expect, it } from "vitest";

import { LEGACY_BONE_TABLE } from "@/engine/acmd/bones";
import { registryContext } from "@/engine/simulate";
import { bootstrapEngine } from "./bootstrap";
import { GAME_SIM_CONTEXT, engineFingerprint } from "./simContext";

beforeAll(() => {
  bootstrapEngine();
});

describe("the game's SimContext", () => {
  it("resolves fighters and stages from the registry", () => {
    expect(GAME_SIM_CONTEXT.fighter("mario")).toBe(registryContext.fighter("mario"));
    expect(GAME_SIM_CONTEXT.stage("battlefield")).toBe(registryContext.stage("battlefield"));
  });

  it("carries the root-bone table in Plan 2", () => {
    expect(GAME_SIM_CONTEXT.bones).toBe(LEGACY_BONE_TABLE);
  });

  it("fingerprints its bone table for online peers", () => {
    expect(engineFingerprint()).toBe(LEGACY_BONE_TABLE.fingerprint);
    expect(engineFingerprint()).toMatch(/^[0-9a-f]{8}$/);
    const other = { ...GAME_SIM_CONTEXT, bones: { ...LEGACY_BONE_TABLE, fingerprint: "0badf00d" } };
    expect(engineFingerprint(other)).toBe("0badf00d");
  });
});
```

In `src/game/rollbackDeps.test.ts`, replace:

```ts
import { beforeAll, describe, expect, it } from "vitest";
```

with:

```ts
import { beforeAll, describe, expect, it, vi } from "vitest";
```

In `src/game/rollbackDeps.test.ts`, replace:

```ts
import { ENGINE_ROLLBACK_DEPS } from "./rollbackDeps";
```

with:

```ts
import { ENGINE_ROLLBACK_DEPS } from "./rollbackDeps";
import { GAME_SIM_CONTEXT } from "./simContext";
```

In `src/game/rollbackDeps.test.ts`, replace:

```ts
    expect(ENGINE_ROLLBACK_DEPS.hashState(copy)).toBe(hashState(state));
  });
});
```

with:

```ts
    expect(ENGINE_ROLLBACK_DEPS.hashState(copy)).toBe(hashState(state));
  });

  it("steps with the game's SimContext, so a bone bake reaches online play too", () => {
    const state = landed();
    const spy = vi.spyOn(GAME_SIM_CONTEXT, "fighter");
    ENGINE_ROLLBACK_DEPS.step(state, [0, 0], [0, 0]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
```

In `src/net/online/lobby.test.ts`, replace:

```ts
  fighters: ["mario", "fox"],
  costumes: [0, 1],
};
```

with:

```ts
  fighters: ["mario", "fox"],
  costumes: [0, 1],
  bones: "0123abcd",
};
```

In `src/net/online/lobby.test.ts`, replace:

```ts
      { kind: "start", config: { ...CONFIG, seed: 1.5 } },
```

with:

```ts
      { kind: "start", config: { ...CONFIG, seed: 1.5 } },
      { kind: "start", config: { ...CONFIG, bones: "not-hex!" } },
      { kind: "start", config: { ...CONFIG, bones: undefined } },
      { kind: "refuse", reason: "bored" },
```

In `src/net/online/lobby.test.ts`, replace:

```ts
  it("reads an away flag", () => {
```

with:

```ts
  it("reads a refusal, so a host learns why its start was not played", () => {
    expect(parseLobbyMessage({ kind: "refuse", reason: "engine-mismatch" })).toEqual({ kind: "refuse", reason: "engine-mismatch" });
  });

  it("reads an away flag", () => {
```

In `src/game/onlineConfig.test.ts`, replace:

```ts
import { buildStartConfig, newMatchSeed, runnerSlotsFor } from "./onlineConfig";
```

with:

```ts
import { buildStartConfig, newMatchSeed, runnerSlotsFor, startConfigProblem } from "./onlineConfig";
import { engineFingerprint } from "./simContext";
```

In `src/game/onlineConfig.test.ts`, replace:

```ts
  it("makes a positive 31-bit seed", () => {
```

with:

```ts
  it("carries this build's bone-table fingerprint, and accepts a start that matches it", () => {
    const config = buildStartConfig({ players: players("mario", "fox"), stageId: "battlefield", stageForm: "normal", rules: RULES, seed: 5 });
    expect(config.bones).toBe(engineFingerprint());
    expect(startConfigProblem(config)).toBeNull();
  });

  it("refuses a start built against different bone tables", () => {
    const config = buildStartConfig({ players: players("mario", "fox"), stageId: "battlefield", stageForm: "normal", rules: RULES, seed: 5 });
    expect(startConfigProblem({ ...config, bones: "0badf00d" })).toMatch(/0badf00d/);
  });

  it("makes a positive 31-bit seed", () => {
```

In `src/lib/onlineStore.test.ts`, replace:

```ts
import { useMatchConfig } from "./matchConfig";
```

with:

```ts
import { engineFingerprint } from "@/game/simContext";
import { useMatchConfig } from "./matchConfig";
```

In `src/lib/onlineStore.test.ts`, replace:

```ts
  fighters: ["mario", "fox"],
  costumes: [0, 1],
};
```

with:

```ts
  fighters: ["mario", "fox"],
  costumes: [0, 1],
  bones: engineFingerprint(),
};
```

In `src/lib/onlineStore.test.ts`, replace:

```ts
  it("explains a full room in words", () => {
```

with:

```ts
  it("refuses a start from a peer whose bone tables differ, tells the host, and says why", () => {
    const guest = fakeSession();
    bindSession(guest.session);
    guest.emit({ type: "joined", role: "guest" });
    guest.emit({ type: "lobby", message: { kind: "start", config: { ...CONFIG, bones: "0badf00d" } } });
    expect(useOnlineStore.getState()).toMatchObject({ config: null, status: "error", errorReason: "engine-mismatch" });
    expect(useOnlineStore.getState().error).toMatch(/different build/);
    expect(guest.sent).toEqual([{ kind: "refuse", reason: "engine-mismatch" }]);
  });

  it("shows the host the same reason when the guest refuses its start", () => {
    const host = fakeSession();
    bindSession(host.session);
    host.emit({ type: "joined", role: "host" });
    host.emit({ type: "lobby", message: { kind: "refuse", reason: "engine-mismatch" } });
    expect(useOnlineStore.getState()).toMatchObject({ config: null, status: "error", errorReason: "engine-mismatch" });
    expect(useOnlineStore.getState().error).toMatch(/different build/);
  });

  it("explains a full room in words", () => {
```

In `src/lib/onlineStore.test.ts`, replace:

```ts
"unreachable", "link-failed", "peer-left"] as const) {
```

with:

```ts
"unreachable", "link-failed", "peer-left", "engine-mismatch"] as const) {
```

In `src/components/menu/CharacterSelect.online.test.tsx`, replace:

```tsx
import { ROLE_PORT, type Role } from "@/net/signalProtocol";
import { CharacterSelect } from "./CharacterSelect";
```

with:

```tsx
import { ROLE_PORT, type Role } from "@/net/signalProtocol";
import { engineFingerprint } from "@/game/simContext";
import { CharacterSelect } from "./CharacterSelect";
```

In `src/components/menu/CharacterSelect.online.test.tsx`, replace:

```tsx
const CONFIG: OnlineMatchConfig = {
  seed: 9,
  stageId: "battlefield",
  stageForm: "normal",
  rules: { mode: "stock", stocks: 3, timeLimit: 9000, smashBall: false, oneOnOne: true },
  fighters: ["mario", "fox"],
  costumes: [0, 1],
};
```

with:

```tsx
const CONFIG: OnlineMatchConfig = {
  seed: 9,
  stageId: "battlefield",
  stageForm: "normal",
  rules: { mode: "stock", stocks: 3, timeLimit: 9000, smashBall: false, oneOnOne: true },
  fighters: ["mario", "fox"],
  costumes: [0, 1],
  bones: engineFingerprint(),
};
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/game/onlineConfig.test.ts src/game/rollbackDeps.test.ts src/game/simContext.test.ts src/lib/onlineStore.test.ts src/net/online/lobby.test.ts`
Expected: FAIL — `simContext.test.ts`, `rollbackDeps.test.ts`, `onlineConfig.test.ts` and `onlineStore.test.ts`: `Failed to resolve import "./simContext"` (or `"@/game/simContext"`); `lobby.test.ts`: 3 tests — "reads a start with its whole config" (the parsed config drops `bones`), "reads a refusal" (`expected null to deeply equal { kind: 'refuse', …(1) }`) and "refuses anything a peer could use…" (a start without `bones` is still accepted).

- [ ] **Step 3: Implement**

Create `src/game/simContext.ts`:

```ts
/**
 * The `SimContext` the game runs the engine with — offline in `matchRunner`,
 * online through `ENGINE_ROLLBACK_DEPS`.
 *
 * It is the registry context plus the bone table script hitboxes resolve
 * through (`SimContext.bones`, DECISIONS D55). Plan 2 has only the root bone
 * (`LEGACY_BONE_TABLE`); Plan 4 replaces that one value with its bake
 * (`layeredBoneTable(bakedBoneTable(…), LEGACY_BONE_TABLE)`) and nothing else
 * changes. The table is never a module global inside the engine: a caller that
 * wants a different one passes a different context.
 */

import { LEGACY_BONE_TABLE } from "@/engine/acmd/bones";
import { registryContext, type SimContext } from "@/engine/simulate";

export const GAME_SIM_CONTEXT: SimContext = { ...registryContext, bones: LEGACY_BONE_TABLE };

/**
 * What two online peers compare before a match. A different bone table is a
 * different game — hitboxes land elsewhere — and rollback would desync on the
 * first hit, so a start whose fingerprint differs is refused.
 */
export function engineFingerprint(ctx: SimContext = GAME_SIM_CONTEXT): string {
  return (ctx.bones ?? LEGACY_BONE_TABLE).fingerprint;
}
```

In `src/game/rollbackDeps.ts`, replace:

```ts
import type { RollbackDeps } from "@/net/rollback";

export const ENGINE_ROLLBACK_DEPS: RollbackDeps<GameState> = {
  step: (state, inputs, prevInputs) => step(state, inputs, { prevInputs }),
```

with:

```ts
import type { RollbackDeps } from "@/net/rollback";
import { GAME_SIM_CONTEXT } from "./simContext";

export const ENGINE_ROLLBACK_DEPS: RollbackDeps<GameState> = {
  step: (state, inputs, prevInputs) => step(state, inputs, { prevInputs, ctx: GAME_SIM_CONTEXT }),
```

In `src/game/matchRunner.ts`, replace:

```ts
import { ENGINE_ROLLBACK_DEPS } from "./rollbackDeps";
```

with:

```ts
import { ENGINE_ROLLBACK_DEPS } from "./rollbackDeps";
import { GAME_SIM_CONTEXT } from "./simContext";
```

In `src/game/matchRunner.ts`, replace:

```ts
      const result = step(state, inputs, { prevInputs });
```

with:

```ts
      const result = step(state, inputs, { prevInputs, ctx: GAME_SIM_CONTEXT });
```

In `src/net/online/lobby.ts`, replace:

```ts
  readonly costumes: readonly [number, number];
}
```

with:

```ts
  readonly costumes: readonly [number, number];
  /**
   * The host's bone-table fingerprint (`engineFingerprint`, Plan 2 Task 27).
   * The guest refuses a start whose fingerprint is not its own.
   */
  readonly bones: string;
}
```

In `src/net/online/lobby.ts`, replace:

```ts
const ID = /^[A-Za-z0-9_-]{1,40}$/;
```

with:

```ts
const ID = /^[A-Za-z0-9_-]{1,40}$/;
const FINGERPRINT = /^[0-9a-f]{8}$/;
```

In `src/net/online/lobby.ts`, replace:

```ts
  | { readonly kind: "away"; readonly away: boolean };
```

with:

```ts
  | { readonly kind: "away"; readonly away: boolean }
  /** The guest cannot play the host's start (Plan 2 Task 27): different bone tables. */
  | { readonly kind: "refuse"; readonly reason: "engine-mismatch" };
```

In `src/net/online/lobby.ts`, replace:

```ts
    case "away": {
      const away = payload.away;
      return typeof away === "boolean" ? { kind: "away", away } : null;
    }
```

with:

```ts
    case "away": {
      const away = payload.away;
      return typeof away === "boolean" ? { kind: "away", away } : null;
    }
    case "refuse":
      return payload.reason === "engine-mismatch" ? { kind: "refuse", reason: "engine-mismatch" } : null;
```

In `src/net/online/lobby.ts`, replace:

```ts
  const { seed, stageId, stageForm, rules, fighters, costumes } = value;
```

with:

```ts
  const { seed, stageId, stageForm, rules, fighters, costumes, bones } = value;
  if (typeof bones !== "string" || !FINGERPRINT.test(bones)) return null;
```

In `src/net/online/lobby.ts`, replace:

```ts
  return { seed, stageId, stageForm, rules: parsedRules, fighters: [f0, f1], costumes: [c0, c1] };
```

with:

```ts
  return { seed, stageId, stageForm, rules: parsedRules, fighters: [f0, f1], costumes: [c0, c1], bones };
```

In `src/game/onlineConfig.ts`, replace:

```ts
import type { PlayerSlot as RunnerSlot } from "./matchRunner";
```

with:

```ts
import type { PlayerSlot as RunnerSlot } from "./matchRunner";
import { engineFingerprint } from "./simContext";
```

In `src/game/onlineConfig.ts`, replace:

```ts
    costumes: [p0.costume, p1.costume],
  };
}
```

with:

```ts
    costumes: [p0.costume, p1.costume],
    bones: engineFingerprint(),
  };
}

/**
 * Why this machine cannot play the start it was sent, or null when it can.
 * Today the one reason is a different bone table: hitboxes would land in
 * different places on the two machines and rollback would desync on the first
 * hit, so it is better not to start at all.
 */
export function startConfigProblem(config: OnlineMatchConfig, local: string = engineFingerprint()): string | null {
  return config.bones === local ? null : `bone tables differ: host ${config.bones}, this build ${local}`;
}
```

In `src/lib/onlineStore.ts`, replace:

```ts
export type OnlineErrorReason = SessionError | "link-failed" | "peer-left";
```

with:

```ts
export type OnlineErrorReason = SessionError | "link-failed" | "peer-left" | "engine-mismatch";
```

In `src/lib/onlineStore.ts`, replace:

```ts
    case "peer-left":
      return "The other player left the room.";
```

with:

```ts
    case "peer-left":
      return "The other player left the room.";
    case "engine-mismatch":
      return "The other player is running a different build of David-Smash. Both of you reload the page, then try again.";
```

In `src/lib/onlineStore.ts`, replace:

```ts
    case "start":
      // Only the guest follows a start; the host built it.
      if (session.role === "guest") useOnlineStore.getState().patch({ config: message.config });
      return;
```

with:

```ts
    case "start": {
      // Only the guest follows a start; the host built it. A start built
      // against different bone tables would desync on the first hit: refuse it.
      if (session.role !== "guest") return;
      const problem = startConfigProblem(message.config);
      if (problem !== null) {
        // Tell the host first, so both screens say why; the player then leaves
        // the room from the error screen as for any other room error.
        session.sendLobby({ kind: "refuse", reason: "engine-mismatch" });
        showEngineMismatch(session);
        return;
      }
      useOnlineStore.getState().patch({ config: message.config });
      return;
    }
    case "refuse":
      // The guest could not play the start this host sent.
      if (session.role === "host") showEngineMismatch(session);
      return;
```

In `src/lib/onlineStore.ts`, replace:

```ts
export function sendLobby(message: LobbyMessage): void {
```

with:

```ts
function showEngineMismatch(session: OnlineSessionLike): void {
  useOnlineStore.getState().patch({
    config: null,
    status: "error",
    errorReason: "engine-mismatch",
    error: roomErrorMessage("engine-mismatch", session.roomCode),
  });
}

export function sendLobby(message: LobbyMessage): void {
```

In `src/lib/onlineStore.ts`, replace:

```ts
import { useMatchConfig, type StageForm } from "./matchConfig";
```

with:

```ts
import { startConfigProblem } from "@/game/onlineConfig";
import { useMatchConfig, type StageForm } from "./matchConfig";
```

- [ ] **Step 4: Run it again**

Run: `pnpm vitest run src/game/onlineConfig.test.ts src/game/rollbackDeps.test.ts src/game/simContext.test.ts src/lib/onlineStore.test.ts src/net/online/lobby.test.ts`
Expected: PASS.

- [ ] **Step 5: The golden trace must not move**

Run: `pnpm vitest run src/game/golden.test.ts`
Expected: PASS, unchanged. This task is a refactor: a divergence here is a bug in this task, not a fixture to regenerate.

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0. `pnpm lint` reports no errors and no warning in a file this task touched; any warnings it printed before this plan started (measure once, with Plan 1 merged, before Task 0) are unchanged.

- [ ] **Step 7: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/src/game/matchRunner.ts \
  super-smash/src/game/onlineConfig.test.ts \
  super-smash/src/game/onlineConfig.ts \
  super-smash/src/game/rollbackDeps.test.ts \
  super-smash/src/game/rollbackDeps.ts \
  super-smash/src/game/simContext.test.ts \
  super-smash/src/game/simContext.ts \
  super-smash/src/lib/onlineStore.test.ts \
  super-smash/src/lib/onlineStore.ts \
  super-smash/src/net/online/lobby.test.ts \
  super-smash/src/net/online/lobby.ts \
  super-smash/src/components/menu/CharacterSelect.online.test.tsx
git commit -m "super-smash: one game SimContext carries the bone table; online peers refuse a different one" -m "GAME_SIM_CONTEXT (registry + bone table) drives the offline loop and ENGINE_ROLLBACK_DEPS. The host's start carries the bone-table fingerprint; a guest on a different build refuses it, tells the host with a refuse message, and both screens say to reload." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 28: Retire the legacy seams, and record the decision (D55)

Retire the strangler's scaffolding: `decayLaunch` (and its two marked writes), the `KINETIC_TYPE_OF_ACTION` fallback (the status objects own their kinetic types; the old table moves into `groups.test.ts` as the record they must match), and the accel factors kinetic no longer uses (back to `physics.ts`, beside the legacy helpers that still use them). A test now requires that no marked legacy write remains. Then record the decision (D55, after Plan 1's D54) and add the engine layout to README's Architecture section.

**Files:**
- Modify: `super-smash/DECISIONS.md`
- Modify: `super-smash/README.md`
- Modify: `super-smash/src/engine/kinetic.ts` — `WALK_ACCEL_FACTOR`, imports
- Modify: `super-smash/src/engine/physics.test.ts` — `"launch decay"`
- Modify: `super-smash/src/engine/physics.ts` — imports
- Modify: `super-smash/src/engine/states.ts`
- Modify: `super-smash/src/engine/status/groups.test.ts` — imports
- Modify: `super-smash/src/engine/velocity-writes.test.ts` — `"catches the write it exists to catch"`

**Interfaces:** Removed: `decayLaunch` (`physics.ts`), `KINETIC_TYPE_OF_ACTION` (`kinetic.ts`). `applyMovement` throws for an unregistered status, like `advanceFighter`. `WALK_ACCEL_FACTOR`/`RUN_ACCEL_FACTOR` are defined in `physics.ts` again.

- [ ] **Step 1: Write the failing test**

In `src/engine/velocity-writes.test.ts`, replace:

```ts
  it("catches the write it exists to catch", () => {
```

with:

```ts
  it("has no legacy write left to excuse (Plan 2 is done with them)", () => {
    const marked = sources().flatMap(([file, src]) =>
      src.split("\n").flatMap((line, i) => (line.includes(MARKER) ? [`${file}:${i + 1}`] : [])),
    );
    expect(marked).toEqual([]);
  });

  it("catches the write it exists to catch", () => {
```

In `src/engine/physics.test.ts`, delete:

```ts
describe("launch decay", () => {
  it("bleeds the magnitude at a flat rate and keeps the direction", () => {
    const f = fighter({ vx: fx(3), vy: fx(4), launchSpeed: fx(5) });
    decayLaunch(f, fx(1));
    expect(f.launchSpeed).toBe(fx(4));
    // 3:4 preserved at four fifths of the original magnitude.
    expect(toFloat(f.vx)).toBeCloseTo(2.4, 1);
    expect(toFloat(f.vy)).toBeCloseTo(3.2, 1);
  });

  it("stops rather than reversing", () => {
    const f = fighter({ vx: fx(1), vy: 0, launchSpeed: fx(0.5) });
    decayLaunch(f, fx(1));
    expect(f.launchSpeed).toBe(0);
  });
});

```

In `src/engine/physics.test.ts`, delete:

```ts
  decayLaunch,
```

In `src/engine/status/groups.test.ts`, replace:

```ts
import { KINETIC_TYPE_OF_ACTION, emptyKinetic } from "../kinetic";
import type { FighterState } from "../types";
```

with:

```ts
import { emptyKinetic } from "../kinetic";
import type { KineticType } from "../kinetic";
import type { ActionState, FighterState } from "../types";
```

In `src/engine/status/groups.test.ts`, replace:

```ts
/** Every action migrated so far; each status-group task extends this list first. */
```

with:

```ts
/** The pre-Plan-2 `applyMovement` switch, as a table: what every status must still declare. */
const LEGACY_KINETIC: Readonly<Record<ActionState, KineticType>> = {
  stand: "GROUND_STOP",
  walk: "WALK",
  dashStart: "DASH",
  run: "RUN",
  runBrake: "GROUND_STOP",
  turnaround: "GROUND_STOP",
  crouchStart: "GROUND_STOP",
  crouch: "GROUND_STOP",
  crouchEnd: "GROUND_STOP",
  jumpSquat: "GROUND_STOP",
  jump: "FALL",
  fall: "FALL",
  land: "GROUND_STOP",
  landingLag: "GROUND_STOP",
  attack: "FALL",
  special: "FALL",
  grab: "FALL",
  grabHold: "FALL",
  pummel: "FALL",
  throw: "FALL",
  shieldStart: "GROUND_STOP",
  shield: "GROUND_STOP",
  shieldRelease: "GROUND_STOP",
  shieldStun: "GROUND_STOP",
  shieldBroken: "GROUND_STOP",
  spotDodge: "GROUND_STOP",
  roll: "MOTION",
  airDodge: "AIR_ESCAPE",
  hitstun: "GROUND_STOP",
  tumble: "GROUND_STOP",
  grabbed: "GROUND_STOP",
  thrown: "GROUND_STOP",
  downed: "GROUND_STOP",
  getUp: "GROUND_STOP",
  ledgeHang: "GROUND_STOP",
  ledgeGetUp: "GROUND_STOP",
  ledgeAttack: "GROUND_STOP",
  ledgeRoll: "GROUND_STOP",
  ledgeJump: "GROUND_STOP",
  respawnPlatform: "NONE",
  dead: "NONE",
  entering: "FALL",
};

/** Every action migrated so far; each status-group task extends this list first. */
```

In `src/engine/status/groups.test.ts`, replace:

```ts
      expect(s.kineticType, s.action).toBe(KINETIC_TYPE_OF_ACTION[s.action]);
```

with:

```ts
      expect(s.kineticType, s.action).toBe(LEGACY_KINETIC[s.action]);
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm vitest run src/engine/physics.test.ts src/engine/status/groups.test.ts src/engine/velocity-writes.test.ts`
Expected: FAIL — "has no legacy write left to excuse": `expected [ 'physics.ts:173', 'physics.ts:174' ] to deeply equal []` (the two marked writes inside `decayLaunch`).

- [ ] **Step 3: Implement**

In `src/engine/physics.ts`, delete:

```ts
/**
 * Bleed a launch velocity by a flat amount per frame, keeping its direction.
 *
 * Knockback in Ultimate decays linearly rather than exponentially — 0.051 units
 * off the *magnitude* every frame regardless of how fast the victim is going —
 * which is why survival is about the total distance travelled, not about a
 * half-life. Scaling both components by the same ratio keeps the launch angle
 * intact while gravity bends it separately.
 */
export function decayLaunch(f: FighterState, decay: number): void {
  const mag = f.launchSpeed;
  if (mag <= 0) {
    f.launchSpeed = 0;
    return;
  }
  const next = mag - decay <= 0 ? 0 : mag - decay;
  if (next === 0) {
    f.launchSpeed = 0;
    return;
  }
  f.vx = Math.trunc((f.vx * next) / mag); // kinetic: legacy-write (Task 17 moves this to DAMAGE)
  f.vy = Math.trunc((f.vy * next) / mag); // kinetic: legacy-write (Task 17 moves this to DAMAGE)
  f.launchSpeed = next;
}

```

In `src/engine/kinetic.ts`, delete:

```ts
/**
 * Each action's kinetic type, transcribed from the legacy `applyMovement`
 * switch. The status objects (Tasks 6–11) declare the same values; this table
 * is the fallback until they all exist and is deleted in Task 28.
 */
export const KINETIC_TYPE_OF_ACTION: Readonly<Record<ActionState, KineticType>> = {
  stand: "GROUND_STOP",
  walk: "WALK",
  dashStart: "DASH",
  run: "RUN",
  runBrake: "GROUND_STOP",
  turnaround: "GROUND_STOP",
  crouchStart: "GROUND_STOP",
  crouch: "GROUND_STOP",
  crouchEnd: "GROUND_STOP",
  jumpSquat: "GROUND_STOP",
  jump: "FALL",
  fall: "FALL",
  land: "GROUND_STOP",
  landingLag: "GROUND_STOP",
  attack: "FALL",
  special: "FALL",
  grab: "FALL",
  grabHold: "FALL",
  pummel: "FALL",
  throw: "FALL",
  shieldStart: "GROUND_STOP",
  shield: "GROUND_STOP",
  shieldRelease: "GROUND_STOP",
  shieldStun: "GROUND_STOP",
  shieldBroken: "GROUND_STOP",
  spotDodge: "GROUND_STOP",
  roll: "MOTION",
  airDodge: "AIR_ESCAPE",
  hitstun: "GROUND_STOP",
  tumble: "GROUND_STOP",
  grabbed: "GROUND_STOP",
  thrown: "GROUND_STOP",
  downed: "GROUND_STOP",
  getUp: "GROUND_STOP",
  ledgeHang: "GROUND_STOP",
  ledgeGetUp: "GROUND_STOP",
  ledgeAttack: "GROUND_STOP",
  ledgeRoll: "GROUND_STOP",
  ledgeJump: "GROUND_STOP",
  respawnPlatform: "NONE",
  dead: "NONE",
  entering: "FALL",
};

```

In `src/engine/kinetic.ts`, delete:

```ts
/** Legacy ground acceleration: walking approaches at 2 × traction, running at 3 ×. */
export const WALK_ACCEL_FACTOR = 2;
export const RUN_ACCEL_FACTOR = 3;

```

In `src/engine/kinetic.ts`, replace:

```ts
import type { ActionState, FighterState } from "./types";
```

with:

```ts
import type { FighterState } from "./types";
```

In `src/engine/physics.ts`, replace:

```ts
/** Ground acceleration is a multiple of traction (legacy; now defined in `kinetic.ts`). */
export { RUN_ACCEL_FACTOR, WALK_ACCEL_FACTOR };
```

with:

```ts
/** Legacy ground acceleration (the helpers below): walking at 2 × traction, running at 3 ×. */
export const WALK_ACCEL_FACTOR = 2;
export const RUN_ACCEL_FACTOR = 3;
```

In `src/engine/physics.ts`, replace:

```ts
import { RUN_ACCEL_FACTOR, WALK_ACCEL_FACTOR, kineticLand, kineticSetX, kineticSetY } from "./kinetic";
```

with:

```ts
import { kineticLand, kineticSetX, kineticSetY } from "./kinetic";
```

In `src/engine/states.ts`, replace:

```ts
  const type = STATUS_TABLE[f.action]?.kineticType ?? KINETIC_TYPE_OF_ACTION[f.action];
```

with:

```ts
  const status = STATUS_TABLE[f.action];
  if (status === undefined) {
    throw new Error(`no status registered for "${f.action}"; import "@/engine/status"`);
  }
  const type = status.kineticType;
```

In `src/engine/states.ts`, delete:

```ts
  KINETIC_TYPE_OF_ACTION,
```

In `src/engine/states.ts`, replace:

```ts
  STATUS_TABLE[f.action]?.exec?.(f, intent, ctx);
```

with:

```ts
  status.exec?.(f, intent, ctx);
```

Append to the end of `DECISIONS.md`:

```md

---

## D55 — The engine takes Ultimate's shape: params, energies, statuses, scripts

**Decision.** Plan 2 restructured `src/engine` toward the engine visible through HDR,
skyline-smash and the recomp projects, without changing what `step()` is:

- **`FighterParams`** carry `fighter_param.prc` names and types as skyline-smash's
  `FighterParamTable` declares them (`walk_speed_max`, `jump_initial_y`, `air_brake_x`,
  `landing_frame_light`/`landing_frame`/`landing_heavy_frame` …), with rubendal SSBU-Calculator
  values pinned by test against `research/rebuild-2026-10/ssbu_fighter_params.csv`. Pairing the
  calculator's three landing values with the struct's three landing fields by order and type is
  our reading (UNVERIFIED). One field is the replica's own: `jump_aerial_y_list`.
- **KineticModule.** Velocity is the sum of CONTROL, STOP, GRAVITY, MOTION and DAMAGE energies
  (`FIGHTER_KINETIC_ENERGY_ID_*`). `vx`/`vy` stay, as the sum, for every reader. No engine line
  writes them directly any more; `velocity-writes.test.ts` enforces it in every engine directory.
- **StatusModule.** The 42 actions are status objects with `pre`/`main`/`exec`/`end`, registered
  under SSBU-style `FIGHTER_STATUS_KIND_*` names; a status change is `changeStatus`. The legacy
  switch is gone.
- **ACMD `game_` scripts.** Every move runs as a script (`frame`/`wait`/`ATTACK`/`clear_all` …)
  through a pure interpreter; hitboxes resolve through a `BoneTable` that reaches `step()` only
  through `SimContext.bones` (the game's is `GAME_SIM_CONTEXT`). A table writes poses into the
  caller's object and has a content fingerprint; an online `start` carries the host's and the
  guest refuses a different one. In Plan 2 every legacy move is *compiled* to a root-bone script
  that reproduces it exactly (proven frame by frame for the whole roster), and the published
  scripts for all eight fighters are imported as reference (`src/fighters/acmd/generated`),
  self-checked against the calculator and reconciled against the legacy data in a ratchet
  (`reconcile.allow.json`). Capsule hitboxes are refused until Plan 3.

**How it stayed safe.** A golden trace (`src/game/golden.test.ts`) replays four CPU-vs-CPU matches
and fingerprints what the presentation layers read every 100 frames. Every refactor task left it
untouched; every behaviour task regenerated it on purpose.

**Behaviour that changed, each with a sourced test:** a launch decays on its own energy while
gravity and drift act (SmashWiki "Knockback"), and a vertical launch falls by the
`damage_fly_top_*` params; jumps launch at SmashWiki's `√(2gh) + g/2` (full hops after rising
`jump_initial_y` over 4 frames) and peak within g/8 of their published heights; midair jumps
follow `jump_count_max`, and Kirby's five follow SmashWiki's published Ultimate heights; air
friction with the stick neutral; walk and run acceleration from the calculator's base/additional
values (SmashWiki "Dash"); light and heavy landings (SmashWiki "Lag"); a partial ECB seam for walls,
ceilings, landings and ledges; Link walks at 1.247, not 1.237; a scripted move started while a
launch still decays now ends the launch instead of carrying it frozen underneath. The renderer and
the animation lab time the jump clip from the same rule.

**Gravity on a jump's first frame.** SmashWiki's Jump page states the Smash 4/Ultimate force as
`sqrt(2g*h) + g/2`. That reaches h only if gravity applies on every airborne frame, the first
included (the peak is then h − g/8 + g·φ(1−φ)/2); without gravity on the first frame it would
overshoot by about √(2gh). The same page's general section says "gravity applies to the first frame
of an aerial but not to the first frame of a jump", without naming a game. We follow the formula:
it is the only reading under which the published heights are the heights reached.

**What a review of the refactor caught.** Moving the roll's stop into ESCAPE_F's `end` looked
equivalent and was not: `end` also runs when a hit interrupts the roll, which zeroed `vx` during
hitlag. Nothing moved, but the CPU reads `vx`, so the golden trace diverged within 200 frames. The
stop stayed in `main`.

**Open (UNVERIFIED).** The even split of the full hop's initial rise across 4 frames; linear walk
speed in deflection (the game's `walk_slow_speed_mul`/`walk_*_ratio` are unpublished here); a
1-frame initial-dash hold; landing lag as frames in `land` and the `>=` heavy-landing threshold;
the ECB, which stays a partial seam — hurtbox sizes, bottom at the feet in the air, rectangular
wall test, platform reach for ceilings — until Plan 4 derives it from bones. The calculator
disagrees with our script reading in five places, each documented in `reference.test.ts`. Plan 3
adopts the imported scripts move by move, starting with root-bone moves; Plan 4 bakes the bone
table and completes the ECB.
```

In `README.md`, replace:

```md
replay eight frames of explosions ([D4](DECISIONS.md#d4--cosmetic-state-lives-outside-gamestate)).
```

with:

```md
replay eight frames of explosions ([D4](DECISIONS.md#d4--cosmetic-state-lives-outside-gamestate)).

Inside `engine/` the simulation is laid out the way Super Smash Bros. Ultimate's own engine is,
as far as the public modding projects show it ([D55](DECISIONS.md#d55--the-engine-takes-ultimates-shape-params-energies-statuses-scripts)):
fighter numbers are `FighterParams` with `fighter_param.prc` names (`params.ts`); a fighter's
velocity is a sum of KineticModule energies — control, stop, gravity, motion, damage (`kinetic.ts`);
each action is a status object with `pre`/`main`/`exec`/`end` under a `FIGHTER_STATUS_KIND_*` name
(`status/`); and every move runs as an ACMD `game_` script whose hitboxes hang off bones through a
`BoneTable` (`acmd/`). The published scripts for all eight fighters are imported by
`scripts/import-acmd.mjs` into `src/fighters/acmd/generated/`.
```

- [ ] **Step 4: Run it again**

Run: `pnpm vitest run src/engine/physics.test.ts src/engine/status/groups.test.ts src/engine/velocity-writes.test.ts`
Expected: PASS.

- [ ] **Step 5: The golden trace must not move**

Run: `pnpm vitest run src/game/golden.test.ts`
Expected: PASS, unchanged. This task is a refactor: a divergence here is a bug in this task, not a fixture to regenerate.

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0. `pnpm lint` reports no errors and no warning in a file this task touched; any warnings it printed before this plan started (measure once, with Plan 1 merged, before Task 0) are unchanged.

- [ ] **Step 7: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/DECISIONS.md \
  super-smash/README.md \
  super-smash/src/engine/kinetic.ts \
  super-smash/src/engine/physics.test.ts \
  super-smash/src/engine/physics.ts \
  super-smash/src/engine/states.ts \
  super-smash/src/engine/status/groups.test.ts \
  super-smash/src/engine/velocity-writes.test.ts
git commit -m "super-smash: retire the Plan 2 seams and record D55" -m "decayLaunch and the kinetic-type fallback table go; no marked legacy write remains. DECISIONS D55 and README's Architecture section describe the SSBU-shaped engine." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Self-review

**Spec coverage (spec §1 "extend the current one but make it as similar to the github engine as possible"; §3.4 phase 2; research R§3 movement rows).**
- `fighter_param.prc` params → Task 1 (names and types from skyline-smash's `FighterParamTable`, checked against ultimate-research/param-labels; values = rubendal calculator at a pinned commit, pinned to the CSV; adapter for attribute-only fixtures).
- KineticModule of summed energies → Tasks 2–4 (state, exec, single write path enforced in every engine directory), 17 (DAMAGE, with the `damage_fly_top_*` params for a vertical launch), 18 (MOTION), with CONTROL/STOP/GRAVITY from Task 3.
- Status modules with pre/main/end → Tasks 5–11 (42 statuses; `exec` hook wired; `pre` used for REBIRTH and the swinging statuses; `end` exercised by tests and deliberately not used for the roll — Task 7 explains why).
- ACMD `game_` scripts with bone-attached hitboxes → Tasks 12 (interpreter), 13 (`BoneTable`: out-param poses, content fingerprint, capsules refused), 14 (every legacy move compiled and proven), 15 (`step()` runs scripts, bone table via `SimContext`), 16 (published scripts imported, self-checked, reconciled — D17), 27 (one game `SimContext`, online peers compare fingerprints).
- Movement fidelity (R§3 "Jumps", "Multi-jumps", "Air friction", "Walk / dash", "Landing", "ECB"; "Launch speed" decay kept separate) → Tasks 17, 19, 20, 21, 22, 23, 24, 25. Each test cites SmashWiki and/or the calculator file; each rule that is not published is marked UNVERIFIED in code, test and D55. The renderer and lab follow the same jump rule (Task 26).
- Hash/rollback compatibility → Task 2 reflective tests (nullable fields included); `step` signature, `StepEvents`, `cloneState`, `hashState` unchanged in shape; renderer still reads `action`/`actionFrame`/`move`/`charge`/`vx`/`vy`.
- R§3 rows deliberately left to Plan 3 (combat fidelity): balloon speed-up, hitstun cancel, Sakurai angle values, DI linearity, perfect-shield frames, shield ×1.19, staling table, knockback stacking, tech, glancing blows, SDI ×1.15, ledge trump, the double super-armour damage at `applyHit`, capsule hitboxes. Plan 2 does not touch `knockback.ts` beyond what Plan 1 already does.

**Placeholder scan.** Every step carries its full code or an exact command with its expected output. Every edit quotes the exact text it replaces; a block too long to quote (over 80 lines) is given by its full first line — unique in the file — and the first full line after it that ends it. The three artefacts produced by commands — the golden trace, the generated scripts, the reconciliation allowlist — are deterministic outputs of code given in full, with their expected shape and counts stated. No "TBD", no "similar to Task N".

**Type consistency.** `KineticInput.stickMag` is optional so earlier callers compile unchanged; `findLedgeGrab`'s `ecbHalf` defaults to 0 and `SimContext.bones` is optional for the same reason. `FighterDef.params`/`scripts` are optional so every engine test fixture keeps compiling. `StatusTable`'s keys are `ActionState`, the alias table is total and one-to-one (pinned). `AttackParams` fields are Q12 except `id`, `part`, `rehit`; the DSL converts with `fx()` at load only. `OnlineMatchConfig.bones` is required, so every literal of it (three test fixtures) is updated in Task 27.

**Review Focus placement.** #1 Task 2, #2 Task 6 (+ the Task 7 golden finding), #3 Task 12, #4 Task 20, #5 Task 25.

**Determinism.** New engine code uses integer `mul`/`div`/`sqrt`/`approach` from `fixed.ts`, `Math.trunc`/`Math.floor` on integers, exact fractions for motion rates, and no forbidden call; `layering.test.ts` walks `status/` and `acmd/` too (it recurses), and so does `velocity-writes.test.ts`. The only floats are authoring-time `fx()` in fighter data and the importer, as today. Bone-table fingerprints are integer FNV-1a.

## Open questions (for David)

1. **Gravity on a jump's first frame.** SmashWiki's Jump page gives Ultimate's launch as `√(2gh) + g/2`; that formula reaches the published height only with gravity on every airborne frame, the first included, so Task 19 does that. The same page's general section says gravity does *not* apply to "the first frame of a jump" (no game named). The plan follows the formula; a frame-data source for Ultimate's first jump frame would settle it.
2. **Pairing the landing fields.** skyline-smash's struct lists `landing_frame_light: f32`, `landing_frame: f32`, `landing_heavy_frame: i32`; the calculator publishes `SoftLandingLag`, `HardLandingLag`, `FallingFrameToUseHardLandingLag`. Task 1 pairs them by order and type (the integer is the threshold), which is UNVERIFIED.
3. **Unpublished shapes, all marked UNVERIFIED:** the even split of the full hop's 4-frame initial rise; walk speed linear in deflection (the struct's `walk_slow_speed_mul`, `walk_middle_ratio`, `walk_fast_ratio` have no published values here); the 1-frame hold of `dash_speed`; landing lag counted as frames in `land` and the heavy threshold as `>=`. Any source for these slots straight into the named function.

## Risks

- **Plan 1 drift.** If Plan 1 lands with different text in the regions this plan edits (`simulate.ts` imports, `states.test.ts` imports, test fixtures, and Task 27's online files), an "old" block may not match. Every edit quotes exact text and names its symbol; re-anchor by symbol and keep the replacement. Task 2's fixture `grep` catches any new `FighterState` literal; Task 27 says which of its anchors were run only as their pre-Plan-1 equivalents.
- **The golden trace is only as good as the CPU's coverage.** Measured: 12–20 hits, some shield hits and KOs per match. Rare paths (Kirby's 3rd+ midair jump, ledge trump) are not exercised; the targeted tests cover what changed. A Plan 5 change to the CPU means regenerating the trace.
- **Upstream data changes.** The importer reads live URLs (the Data Viewer's `patch/13.0.1` data). If rubendal republishes it, script counts or windows change; the importer's counts and `reference.test.ts`'s known-disagreement list fail loudly rather than silently absorbing it. Downloads are cached; `--offline` re-runs from the cache.
- **Performance.** `runScript` replays a move's script from the start up to four times per fighter per frame. Scripts are tens of commands; an independent measurement put the worst case at about 90 µs per tick, well inside a rollback budget. Suite time rose from about 8 s to about 12 s, mostly the 2,000-run property test and the roster parity test. If it ever shows, memoise `runScript` per `(script, gameFrame)` — it is pure.
- **Behaviour shifts players will feel.** Launches carry further after hitstun ends; full hops reach their apex sooner; Fox accelerates into his run more slowly; landings are 1 frame (light) or 3–4 (heavy) instead of 4; ledges are reachable from the body's side; Kirby's later midair jumps are lower; vertical launches fall at each fighter's `damage_fly_top` gravity. All are sourced; Plan 3's combat numbers assume them.
- **Online wire format.** Task 27 adds a required `bones` field to the `start` message and a `refuse` message, so a peer on a pre-Task-27 build cannot start a match with one on a later build — which is the point, but it means both players must reload after a deploy. (A pre-Task-27 guest rejects the new `start` as malformed rather than sending `refuse`; that only happens across this one deploy.)
- **Node type stripping.** `scripts/import-acmd.mjs` imports `src/fighters/acmd/parse.ts` directly (Node ≥ 22.18/23.6). `parse.ts` must keep no runtime imports, no enums and no parameter properties, or the importer breaks; its header says so.

---

## Interfaces for later phases

Exact definitions Plans 3 (combat fidelity), 4 (3D renderer and bone bake) and 5 (specials, CPU, controls) build on. All are as committed by the end of this plan.

### `FighterParams` (`src/engine/params.ts`)

```ts
export interface FighterParams {
  readonly walk_speed_max: number;
  readonly walk_accel_mul: number;
  readonly walk_accel_add: number;
  readonly ground_brake: number;
  readonly dash_speed: number;
  readonly run_accel_mul: number;
  readonly run_accel_add: number;
  readonly run_speed_max: number;
  readonly jump_squat_frame: number;
  readonly jump_initial_y: number;
  readonly jump_y: number;
  readonly mini_jump_y: number;
  readonly jump_aerial_y: number;
  readonly jump_aerial_y_list?: readonly number[];
  readonly jump_count_max: number;
  readonly air_accel_x_mul: number;
  readonly air_accel_x_add: number;
  readonly air_speed_x_stable: number;
  readonly air_brake_x: number;
  readonly air_accel_y: number;
  readonly air_speed_y_stable: number;
  readonly dive_speed_y: number;
  readonly damage_fly_top_air_accel_y: number;
  readonly damage_fly_top_speed_y_stable: number;
  readonly weight: number;
  readonly landing_attack_air_frame_n: number;
  readonly landing_attack_air_frame_f: number;
  readonly landing_attack_air_frame_b: number;
  readonly landing_attack_air_frame_hi: number;
  readonly landing_attack_air_frame_lw: number;
  readonly landing_frame_light: number;
  readonly landing_frame: number;
  readonly landing_heavy_frame: number;
  readonly shield_radius: number;
  readonly scale: number;
}
export function fighterParams(def: FighterDef): FighterParams; // def.params, else the attributes adapter
// FighterDef.params?: FighterParams — every roster fighter sets it (src/fighters/params.ts FIGHTER_PARAMS)
```

### KineticModule (`src/engine/kinetic.ts`)

```ts
export interface KineticState {
  controlX: number;
  stopX: number;
  gravityY: number;
  motionX: number;
  motionY: number;
  damageX: number;
  damageY: number;
  fallFrames: number;
  jumpInitial: number;
}
export type KineticType =
  | "FALL"
  | "GROUND_STOP"
  | "WALK"
  | "DASH"
  | "RUN"
  | "MOTION"
  | "AIR_ESCAPE"
  | "NONE";
export interface KineticInput {
  readonly stickX: number;
  readonly stickMag?: number;
  readonly params: FighterParams;
  readonly holdVertical: boolean;
}
export const FIGHTER_KINETIC_ENERGY_ID_MOTION = 0;
export const FIGHTER_KINETIC_ENERGY_ID_GRAVITY = 1;
export const FIGHTER_KINETIC_ENERGY_ID_CONTROL = 2;
export const FIGHTER_KINETIC_ENERGY_ID_STOP = 3;
export const FIGHTER_KINETIC_ENERGY_ID_DAMAGE = 4;
export function emptyKinetic(): KineticState;
export function cloneKinetic(k: KineticState): KineticState;
export function kineticSumX(f: Pick<FighterState, "kinetic">): number;
export function kineticSumY(f: Pick<FighterState, "kinetic">): number;
export function kineticSum(f: FighterState): void;
export type HorizontalCarrier = "control" | "stop";
export function kineticAdopt(f: FighterState, carrier: HorizontalCarrier = "control"): void;
export function kineticClear(f: FighterState): void;
export function kineticSetX(f: FighterState, vx: number, carrier: HorizontalCarrier = "control"): void;
export function kineticSetY(f: FighterState, vy: number): void;
export function kineticSet(f: FighterState, vx: number, vy: number, carrier: HorizontalCarrier = "control"): void;
export function kineticJump(f: FighterState, vy: number): void;
export function kineticLaunch(f: FighterState, vx: number, vy: number, speed: number): void;
export function carrierOf(type: KineticType): HorizontalCarrier;
export function kineticTransfer(f: FighterState, type: KineticType): void;
export function gravityStep(vy: number, g: number, terminal: number): number;
export function airControlX(vx: number, stickX: number, p: FighterParams): number;
export function kineticExec(f: FighterState, type: KineticType, input: KineticInput): void;
export function kineticDecayDamage(f: FighterState, decay: number): void;
export function kineticReel(f: FighterState, p: FighterParams, balloon: boolean): void;
export function kineticLand(f: FighterState): void;
export function kineticMotion(f: FighterState, vx: number, vy: number): void;
export function kineticEndMotion(f: FighterState): void;
export function jumpLaunchSpeed(g: number, h: number): number;
export function initialRiseStep(initial: number, frame: number): number;
export function kineticGroundJump(f: FighterState, p: FighterParams, full: boolean): void;
export function runControlX(vx: number, dir: number, p: FighterParams, mag: number): number;
export function jumpRiseSpeeds(p: FighterParams, kind: JumpKind, airJump = 0): number[];
// FighterState.kinetic: KineticState; FighterState.vx/vy == kineticSumX/Y(f) after every mutator.
// FighterState.launchSpeed == |(damageX, damageY)|. Writes to vx/vy outside kinetic.ts fail velocity-writes.test.ts.
```

Energy rules Plan 3 builds on: `kineticLaunch` replaces every energy with DAMAGE; `kineticReel` (hitstun) decays DAMAGE by `LAUNCH_SPEED_DECAY` (+`ground_brake` on the ground) and builds GRAVITY by `air_accel_y` toward `air_speed_y_stable`, or by `damage_fly_top_air_accel_y` toward `damage_fly_top_speed_y_stable` when `balloon`; `kineticExec` keeps decaying a live launch after hitstun. Jumps launch at `jumpLaunchSpeed(g, h) = √(2gh) + g/2` with gravity on every airborne frame (peak within [h − g/8, h]); `jumpRiseSpeeds` is the same rule as data, for presentation. Knockback stacking, hitstun cancel and the balloon speed-up (Plan 3) change `kineticLaunch`/`kineticReel`, nothing else.

### StatusModule (`src/engine/status/kind.ts`)

```ts
export type StatusKind =
  | "FIGHTER_STATUS_KIND_WAIT"
  | "FIGHTER_STATUS_KIND_WALK"
  | "FIGHTER_STATUS_KIND_DASH"
  | "FIGHTER_STATUS_KIND_RUN"
  | "FIGHTER_STATUS_KIND_RUN_BRAKE"
  | "FIGHTER_STATUS_KIND_TURN_RUN"
  | "FIGHTER_STATUS_KIND_SQUAT"
  | "FIGHTER_STATUS_KIND_SQUAT_WAIT"
  | "FIGHTER_STATUS_KIND_SQUAT_RV"
  | "FIGHTER_STATUS_KIND_JUMP_SQUAT"
  | "FIGHTER_STATUS_KIND_JUMP"
  | "FIGHTER_STATUS_KIND_FALL"
  | "FIGHTER_STATUS_KIND_LANDING"
  | "FIGHTER_STATUS_KIND_LANDING_ATTACK_AIR"
  | "FIGHTER_STATUS_KIND_ATTACK"
  | "FIGHTER_STATUS_KIND_SPECIAL"
  | "FIGHTER_STATUS_KIND_CATCH"
  | "FIGHTER_STATUS_KIND_CATCH_WAIT"
  | "FIGHTER_STATUS_KIND_CATCH_ATTACK"
  | "FIGHTER_STATUS_KIND_THROW"
  | "FIGHTER_STATUS_KIND_GUARD_ON"
  | "FIGHTER_STATUS_KIND_GUARD"
  | "FIGHTER_STATUS_KIND_GUARD_OFF"
  | "FIGHTER_STATUS_KIND_GUARD_DAMAGE"
  | "FIGHTER_STATUS_KIND_FURAFURA"
  | "FIGHTER_STATUS_KIND_ESCAPE"
  | "FIGHTER_STATUS_KIND_ESCAPE_F"
  | "FIGHTER_STATUS_KIND_ESCAPE_AIR"
  | "FIGHTER_STATUS_KIND_DAMAGE"
  | "FIGHTER_STATUS_KIND_DAMAGE_FLY"
  | "FIGHTER_STATUS_KIND_CAPTURE_WAIT"
  | "FIGHTER_STATUS_KIND_THROWN"
  | "FIGHTER_STATUS_KIND_DOWN_WAIT"
  | "FIGHTER_STATUS_KIND_DOWN_STAND"
  | "FIGHTER_STATUS_KIND_CLIFF_WAIT"
  | "FIGHTER_STATUS_KIND_CLIFF_CLIMB"
  | "FIGHTER_STATUS_KIND_CLIFF_ATTACK"
  | "FIGHTER_STATUS_KIND_CLIFF_ESCAPE"
  | "FIGHTER_STATUS_KIND_CLIFF_JUMP1"
  | "FIGHTER_STATUS_KIND_REBIRTH"
  | "FIGHTER_STATUS_KIND_DEAD"
  | "FIGHTER_STATUS_KIND_ENTRY";

export interface FighterStatus {
  readonly kind: StatusKind;
  readonly action: ActionState;
  readonly kineticType: KineticType;
  readonly pre?: (f: FighterState) => void;
  readonly main: (f: FighterState, intent: Intent, ctx: StateContext) => void;
  readonly exec?: (f: FighterState, intent: Intent, ctx: StateContext) => void;
  readonly end?: (f: FighterState) => void;
}
export type StatusTable = { readonly [A in ActionState]?: FighterStatus };
export const STATUS_KIND_OF_ACTION: Readonly<Record<ActionState, StatusKind>>;
export const STATUS_TABLE: StatusTable;
export function registerStatus(s: FighterStatus): void;
export function changeStatus(f: FighterState, action: ActionState, table?: StatusTable): void;
```

Status objects live in `src/engine/status/{meta,damage,guard,attack,cliff,ground,air}.ts` and are registered from `src/engine/status/index.ts` (`ALL_STATUSES`). A new status (Plan 5: counters, reflectors, wall jump, footstool) is a new `ActionState` member, a new `StatusKind` in the alias table, a `FighterStatus` object in a group file, and an entry in `ALL_STATUSES`; `groups.test.ts` and `status.test.ts` will demand all four.

### ACMD `game_` scripts (`src/engine/acmd/types.ts`, `interpreter.ts`)

```ts
/** A bone, as rubendal's data spells it: lowercase, e.g. "top", "hip", "kneer", "handl", "haver", "sword1". */
export type BoneName = string;

/** A motion kind, as rubendal's `Motions` table spells it: "attack_11", "attack_air_n", "special_hi" … */
export type MotionKind = string;

export type AttackSetoff = "ATTACK_SETOFF_KIND_ON" | "ATTACK_SETOFF_KIND_OFF" | "ATTACK_SETOFF_KIND_THRU";
export type AttackLr = "ATTACK_LR_CHECK_F" | "ATTACK_LR_CHECK_B" | "ATTACK_LR_CHECK_POS" | "ATTACK_LR_CHECK_SPEED";
export type CollisionSituation =
  | "COLLISION_SITUATION_MASK_GA"
  | "COLLISION_SITUATION_MASK_G"
  | "COLLISION_SITUATION_MASK_A"
  | "COLLISION_SITUATION_MASK_G_d"
  | "COLLISION_SITUATION_MASK_GA_d";
export type HitStatus = "HIT_STATUS_NORMAL" | "HIT_STATUS_XLU" | "HIT_STATUS_INVINCIBLE" | "HIT_STATUS_OFF";

/**
 * smash-script `ATTACK(id, part, bone, damage, angle, kbg, fkb, bkb, size, x, y, z, x2, y2, z2, hitlag, sdi,
 * clang, facing, set_weight, shield_damage, trip, rehit, reflectable, absorbable, flinchless, disable_hitlag,
 * direct, ground_air, hitbits, collision_part, friendly_fire, effect, sfx_level, collision_sound, _type)`.
 */
export interface AttackParams {
  /** Slot number. A lower id wins when two of one fighter's hitboxes reach a target. */
  readonly id: number;
  readonly part: number;
  readonly bone: BoneName;
  /** Percent. */
  readonly damage: number;
  /** Degrees; 361 is the Sakurai angle. */
  readonly angle: number;
  /** Knockback growth, raw (100 means 100). */
  readonly kbg: number;
  /** Fixed ("set") knockback, raw; 0 when the move uses `bkb`. */
  readonly fkb: number;
  /** Base knockback, raw. */
  readonly bkb: number;
  /** Radius. */
  readonly size: number;
  /** Offset in the bone's local frame. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** The far end of an extended (capsule) hitbox, bone-local; absent for a sphere. */
  readonly x2?: number;
  readonly y2?: number;
  readonly z2?: number;
  /** Hitlag multiplier (ONE = 1.0×). */
  readonly hitlag: number;
  /** SDI multiplier (ONE = 1.0×). */
  readonly sdi: number;
  readonly clang: AttackSetoff;
  readonly facing: AttackLr;
  readonly setWeight: boolean;
  readonly shieldDamage: number;
  /** Trip chance, ONE = certain. */
  readonly trip: number;
  /** Frames between rehits of a multihit; 0 for none. */
  readonly rehit: number;
  readonly reflectable: boolean;
  readonly absorbable: boolean;
  readonly flinchless: boolean;
  readonly noHitlag: boolean;
  readonly direct: boolean;
  readonly situation: CollisionSituation;
  /** `collision_attr_*`, e.g. "collision_attr_normal", "collision_attr_elec", "collision_attr_cutup". */
  readonly collisionAttr: string;
  /** `ATTACK_REGION_*`, e.g. "ATTACK_REGION_PUNCH". */
  readonly region: string;
  /**
   * REPLICA: the legacy `Hitbox.meteor` flag (grounded-meteor knockback ×0.8),
   * carried until Plan 3 derives it from the angle as the game does.
   */
  readonly meteor?: boolean;
}

/** smash-script `CATCH(id, bone, size, x, y, z, x2, y2, z2, status, situation)`. */
export interface CatchParams {
  readonly id: number;
  readonly bone: BoneName;
  readonly size: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly x2?: number;
  readonly y2?: number;
  readonly z2?: number;
  readonly status: string;
  readonly situation: CollisionSituation;
}

/** A rate as an exact fraction: game frames per motion frame (`FT_MOTION_RATE`'s FSM). */
export type Rate = readonly [num: number, den: number];

export type AcmdCommand =
  /** `frame(Frame=n)`: wait until motion frame n (frames). */
  | { readonly op: "frame"; readonly frame: number }
  /** `wait(Frames=n)`: wait n motion frames from where the script is (frames). */
  | { readonly op: "wait"; readonly frames: number }
  | { readonly op: "attack"; readonly params: AttackParams }
  | { readonly op: "catch"; readonly params: CatchParams }
  /** `AttackModule::clear_all()`. */
  | { readonly op: "clearAll" }
  /** `AttackModule::clear(ID=n)`. */
  | { readonly op: "clear"; readonly id: number }
  /** `grab(MA_MSC_CMD_GRAB_CLEAR_ALL)`. */
  | { readonly op: "catchClearAll" }
  /** `grab(MA_MSC_CMD_GRAB_CLEAR, n)`. */
  | { readonly op: "catchClear"; readonly id: number }
  /** `ATK_POWER(id, damage)`: a live hitbox's damage changes, the hitbox does not. */
  | { readonly op: "atkPower"; readonly id: number; readonly damage: number }
  /** `ATK_SET_SHIELD_SETOFF_MUL(ID, ShieldstunMul)`. */
  | { readonly op: "shieldSetoffMul"; readonly id: number; readonly mul: number }
  /** `FT_MOTION_RATE(FSM=r)`. */
  | { readonly op: "motionRate"; readonly rate: Rate }
  /** `WorkModule::on_flag` / `off_flag`. */
  | { readonly op: "setFlag"; readonly flag: string; readonly on: boolean }
  /** `damage(MA_MSC_DAMAGE_DAMAGE_NO_REACTION, …)`: super armour on (ALWAYS) or off (NORMAL). */
  | { readonly op: "superArmour"; readonly on: boolean }
  /** `WHOLE_HIT(HIT_STATUS_*)`: intangible (XLU), invincible, or back to normal. */
  | { readonly op: "wholeHit"; readonly status: HitStatus }
  /**
   * REPLICA: a scripted velocity (Q12, `x` facing-relative) set for this frame
   * and held `hold` more frames — the legacy `MoveDef.momentum`, which the game
   * expresses as animation translation (the MOTION energy). `order` is the
   * entry's position in the legacy list; the lowest live one wins.
   */
  | { readonly op: "momentum"; readonly x: number; readonly y: number; readonly hold: number; readonly order: number }
  /** `ArticleModule::generate_article` — here, a `ProjectileDef` id. */
  | { readonly op: "spawnProjectile"; readonly id: string }
  /** `REVERSE_LR()`. */
  | { readonly op: "reverseLr" }
  /** `for(N Iterations){ … }`. */
  | { readonly op: "loop"; readonly count: number; readonly body: readonly AcmdCommand[] }
  /** Anything the replica does not interpret yet, kept verbatim so nothing is lost on import. */
  | { readonly op: "unknown"; readonly raw: string };

export interface AcmdScript {
  /** `game_<motion>`, e.g. "game_attack11". */
  readonly name: string;
  readonly motion: MotionKind;
  readonly commands: readonly AcmdCommand[];
}

export interface ActiveMomentum {
  readonly x: number;
  readonly y: number;
  readonly until: number;
}
export interface ScriptFrameState {
  readonly attacks: readonly AttackParams[];
  readonly catches: readonly CatchParams[];
  readonly shieldSetoff: ReadonlyMap<number, number>;
  readonly flags: readonly string[];
  readonly superArmour: boolean;
  readonly wholeHit: HitStatus;
  readonly momentum: ActiveMomentum | null;
  readonly motionFrame: number;
  readonly fired: readonly AcmdCommand[];
}
export function runScript(script: AcmdScript, gameFrame: number): ScriptFrameState; // pure; gameFrame = moveFrameOf(actionFrame)
export function moveScriptFrame(def: FighterDef, f: Pick<FighterState, "move" | "actionFrame">): MoveScriptFrame | null; // acmd/run.ts
export function gameScriptFor(def: FighterDef, slot: MoveSlot): AcmdScript | null; // acmd/legacy.ts: def.scripts[slot] ?? compiled legacy move
```

Authoring builders (`src/engine/acmd/dsl.ts`, decimals in, Q12 out): `ATTACK(spec)`, `CATCH(spec)`, `frame`, `wait`, `clearAll`, `clear`, `catchClearAll`, `catchClear`, `atkPower`, `shieldSetoffMul`, `motionRate`, `setFlag`, `superArmour`, `wholeHit`, `intangible`, `momentum`, `spawnProjectile`, `reverseLr`, `loop`, `unknown`, `script`.

**Where scripts live.** Runtime: `FighterDef.scripts?: Readonly<Partial<Record<MoveSlot, AcmdScript>>>` on each fighter; a slot without one runs `legacyGameScript(def.moves[slot])` (root bone, exact legacy behaviour). Reference: `src/fighters/acmd/generated/<fighterId>.ts` exports `<ID>: ReferenceFighter` with `slots: Partial<Record<MoveSlot, "game_…">>`, `scripts: Record<"game_…", AcmdScript>` (motion kinds from rubendal's `Motions`, e.g. `game_attackairn` → `attack_air_n`), `faf`, `calculatorWindows`; `REFERENCE_SCRIPTS[fighterId]` in `src/fighters/acmd/index.ts`. Plan 3 activates a slot by setting `scripts: { nair: MARIO.scripts.game_attackairn }` in `src/fighters/mario.ts` and deleting the slot's lines from `reconcile.allow.json`.

### BoneTable (`src/engine/acmd/bones.ts`) — what Plan 4 produces

```ts
export interface BonePose {
  tx: number;
  ty: number;
  m00: number;
  m01: number;
  m02: number;
  m10: number;
  m11: number;
  m12: number;
}

export interface BoneTable {
  readonly fingerprint: string;
  pose(fighterId: string, motion: MotionKind, frame: number, bone: BoneName, out: BonePose): boolean;
}

export function newBonePose(): BonePose {
  return { tx: 0, ty: 0, m00: 0, m01: 0, m02: 0, m10: 0, m11: 0, m12: 0 };
}

export const BONE_POSE_STRIDE = 8;

export interface BakedMotion {
  readonly frames: number;
  readonly data: Int32Array;
}

export interface BakedFighterBones {
  readonly fighter: string;
  readonly bones: readonly BoneName[];
  readonly motions: Readonly<Record<MotionKind, BakedMotion>>;
}

export function bakedPoseIndex(frame: number, boneIndex: number, boneCount: number): number {
  return ((frame - 1) * boneCount + boneIndex) * BONE_POSE_STRIDE;
}

export function bakedBoneTable(fighters: readonly BakedFighterBones[]): BoneTable;
export const TOP_POSE: Readonly<BonePose>;         // { tx: 0, ty: 0, m00: 0, m01: 0, m02: ONE, m10: 0, m11: ONE, m12: 0 }
export const LEGACY_BONE_TABLE: BoneTable;          // "top" only — Plan 2's provider
export function layeredBoneTable(primary: BoneTable, fallback: BoneTable): BoneTable;
export function bonePoint(p: Readonly<BonePose>, lx: number, ly: number, lz: number): { x: number; y: number };
// src/engine/simulate.ts — the only way the sim reaches a table:
export interface SimContext { fighter(id: string): FighterDef; stage(id: string): StageDef; readonly bones?: BoneTable } // absent = LEGACY_BONE_TABLE
// src/game/simContext.ts — the game's context; Plan 4 changes `bones` here and nowhere else:
export const GAME_SIM_CONTEXT: SimContext;          // { ...registryContext, bones: LEGACY_BONE_TABLE }
export function engineFingerprint(ctx?: SimContext): string; // (ctx.bones ?? LEGACY_BONE_TABLE).fingerprint
// src/net/online/lobby.ts (Plan 1 Task 12, + Task 27):
export interface OnlineMatchConfig {
  readonly seed: number;
  readonly stageId: string;
  readonly stageForm: StageForm;
  readonly rules: MatchRules;
  readonly fighters: readonly [string, string];
  readonly costumes: readonly [number, number];
  readonly bones: string;
}
```

Semantics Plan 4 must honour. A pose is the bone's transform projected onto the side plane, **facing-relative** (+x forward, +y up, origin at the feet; the sim mirrors x by `facing` afterwards, so a pose never depends on facing) and in **world units at the fighter's in-game size** (the bake folds the model's scale and `FighterParams.scale` into the matrix and translation; a hitbox `size` is a radius the pose does not transform). A script offset `(X, Y, Z)` lands at `x = (m00·X + m01·Y + m02·Z)/ONE + tx`, `y = (m10·X + m11·Y + m12·Z)/ONE + ty`. `pose()` writes into the caller's `BonePose` and allocates nothing; `fingerprint` is FNV-1a over the table's contents (8 hex digits), and the host's travels in the online `start` (`OnlineMatchConfig.bones`) — the guest refuses a start that is not its own. Plan 4's bake emits, per fighter, a `BakedFighterBones`: bone names as rubendal spells them (`top`, `hip`, `kneer`, `handl`, `haver`, `sword1` …), and per motion kind an `Int32Array` of `frames × bones.length × 8` Q12 integers, frame-major, each pose `[tx, ty, m00, m01, m02, m10, m11, m12]`. It sets `GAME_SIM_CONTEXT.bones = layeredBoneTable(bakedBoneTable(data), LEGACY_BONE_TABLE)` in `src/game/simContext.ts`; `scriptHitboxes` throws for any bone it cannot place, so a missing bake fails loudly, and for a capsule (`x2/y2/z2`) hitbox until Plan 3 collides capsules. Frames are motion frames (`ScriptFrameState.motionFrame`), so `FT_MOTION_RATE` indexes the bake correctly. The ECB (`ecbOf`, `physics.ts`, a partial seam — Task 25) and hurtboxes are the next consumers of the same table.

### Jump timing for presentation (`src/render/poses/timing.ts`)

```ts
export interface JumpTiming {
  readonly full: number;
  readonly short: number;
  readonly air: readonly number[];
}
export function jumpTimingFor(def: FighterDef): JumpTiming; // cached per definition, from jumpRiseSpeeds
// actionDurationFor / poseTimeFor / poseSpinFor / samplePoseForFighter take `jump?: JumpTiming` (was `attrs?: JumpAttributes`).
```
