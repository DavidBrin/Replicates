# Plan 3 — David-Smash: combat fidelity

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Starts after Plan 2 is merged.** Plan 2 (`docs/superpowers/plans/2026-10-24-plan-2-engine-architecture.md`, Tasks 0–28, DECISIONS D55) lands first, after Plan 1 (D54). This plan is written against the post-Plan-2 engine and keeps everything both add: Plan 1 Task 15's `Btn.Soft`, `Intent.soft`, `applyDI(angle, x, y, soft?)` and `SOFT_DI_SHIFT = 2` (Task 4 here keeps the soft rule exactly and says how it combines with the linear DI); Plan 2's `FighterParams`, KineticModule (`kineticLaunch`, `kineticReel` with `damage_fly_top_*` balloon gravity, the DAMAGE energy), StatusModule (`changeStatus`, the registry, `groups.test.ts`/`status.test.ts`), ACMD interpreter and `BoneTable` reaching the sim as `SimContext.bones`, the golden trace (Task 0), `reconcile.allow.json`, and the recursive `velocity-writes.test.ts` guard (every velocity change in this plan goes through `kinetic.ts`). This plan's DECISIONS entry is **D56**. Code is cited by symbol, not line.

**Goal:** Make combat match Ultimate's published numbers — balloon knockback speed-up, hitstun cancel, the Sakurai angle and flat launches, linear DI, LSI/SDI/ASDI, shields and perfect shields, the staling table, knockback stacking, teching and bouncing, glancing blows, grabs, ledge trump, autolink angles, the super-armour damage bug — run the imported `game_` scripts of every move whose hitboxes hang off the root bone, and make online peers refuse to play across different combat rules.

**Architecture:** Each rule is a pure function pinned against a public source — most of them against `research/rebuild-2026-10/tools/ssbu_ref.mjs`, the reference port the research cross-checked against rubendal's SSBU-Calculator, imported straight into the tests — and then wired into `step()` with a step-level test in a new `src/engine/combat.test.ts`. Plan 3's per-fighter state lives in one `CombatState` sub-object (`combat.ts`), cloned and hashed like Plan 2's `kinetic`; the balloon speed-up lives on the DAMAGE energy, so `f.hitstun` still counts real frames and no reader changes. Every task that changes behaviour regenerates the golden trace and says why; every task that does not leaves it untouched. Tasks 16–18 teach the hitbox pipeline what the imported scripts say (set weight, situation masks, LR checks, `clear_all` without re-staling, capsules) and then switch 38 root-bone moves to their published scripts; limb-bone scripts wait for Plan 4's bone bake. Task 19 adds autolink angles; Task 20 puts an engine-rules version and the running scripts into the online fingerprint.

**Tech Stack:** TypeScript 5 (strict), Next.js 16.3, vitest 4.1 + fast-check 4, Playwright (untouched here), pnpm.

**Spec:** docs/superpowers/specs/2026-10-24-david-smash-design.md — Phase 3 "Combat fidelity" (§3.2), and §3.4: every R§3 "Missing", "Wrong values" or "Verify" combat row is fixed here with a test citing its source.

**Conventions for every task** (as Plans 1 and 2)
- `pnpm …` commands run in `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates/super-smash`; file paths in steps are relative to it.
- `git …` commands run from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`, paths prefixed `super-smash/`, committing straight to `main`. Never `git add -A`; stage the exact paths listed. Never push without David's go.
- Every commit body ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The full gate is `pnpm typecheck && pnpm lint && pnpm test`.
- "Replace X with Y" quotes the file as it stands at that step; every quoted `X` occurs exactly once. If Plan 2 or an earlier task left a region worded differently, re-anchor by the symbol named and keep the replacement.
- Tests import the reference port as `import * as ref from "../../research/rebuild-2026-10/tools/ssbu_ref.mjs"` (`allowJs` is on; the module sits outside `src/engine`, so `layering.test.ts` does not scan it).
- This plan was executed end to end in a scratch copy of the repo (Plan 2 applied through Task 28, with Plan 1 Task 15's engine edits and tests) before it was written: every test fails where it says, with the text quoted, and passes after its implementation; the gate is green after every task (2,937 tests at the end). An independent reviewer then applied every task literally from this text, green throughout, with 512/512 rollback re-simulation checks matching; this version folds in that review. The golden trace was regenerated exactly where a task says so and passed untouched everywhere else.

## Global Constraints

(spec §3.1, verbatim)

- **Determinism:**
  - `src/engine/**` keeps Q12 fixed point, `Ratio` constants and the LUT trig.
  - It must not use `Math.random`, `Date`, `performance.now` or float trig. `src/engine/layering.test.ts` must keep passing and keep its forbidden list.
  - Anything the sim reads from animation (bone positions for hitboxes and hurtboxes) is **baked at build time into integer tables**. The sim never evaluates float animation at runtime.
- **Tests:**
  - Vitest unit/property tests and Playwright e2e (Chromium desktop) stay green after every task.
  - New behaviour is TDD.
  - Commands: `pnpm test`, `pnpm typecheck` (or `pnpm tsc --noEmit` if no script), `pnpm lint`, `pnpm build`, `pnpm e2e` (check `package.json`).
- **Repo:**
  - `DavidBrin/Replicates` is a **public** GitHub repo and is committed **straight to `main`** (repo convention).
  - Nintendo-ripped model and texture files (`.blend`, `.glb` made from them, `.png` textures) are **never committed**. They are fetched by a script into a git-ignored cache (`super-smash/.model-cache/`, `super-smash/public/models/`) and deployed from local disk. **Why:** a DMCA notice against them would take down the whole public Replicates repo with every other replica. This is an operational constraint, not an IP-gating one.
- **Directory:** stays `Replicates/super-smash/`. Renaming the directory would break the David-Internet docs mirror (`content/super-smash/`), the journey slug and the wiki slug `Super_Smash_(replica)`. Only user-visible names change.
- **Hosting:** Cloudflare free plan only, on David's existing account (Davidb.sites@gmail.com, the one hosting `leaders.leaders-game.workers.dev`). Never enable paid features. A step needing a card or a paid plan stops and asks David.
- **Gameplay data:** published sources only (§1).
- **Netcode:** stays P2P rollback (`src/net/rollback.ts`). There is never a server-side sim tick, because a 60 Hz `setInterval` in a Durable Object blocks hibernation.
- **Outward actions need David's go at the step:**
  - Deploying, taking down Vercel, editing the live David-Internet or wiki deploys.
  - `wrangler login` is run by David with `!`.

Plan-specific: the e2e suite (`pnpm test:e2e`) is not touched by this plan; run it once after Task 21 (it drives menus and a local match, which the engine changes do not alter in shape). Every number a test pins cites its URL; a number with no public source is marked `UNVERIFIED:` in code and listed under Open questions.

## Review Focus

Five failure modes a player would hit that no single formula test covers, and the test that now owns each:

1. **A tech input on the exact frame the tumbling fighter lands.** Phase order decides it: the tech input is read in phase 3 for every fighter (frozen or not) before phase 5's collision runs, so a press on the landing frame opens the window in time. Test: `combat.test.ts` "techs on a press made on the frame of landing itself" (Task 12).
2. **A perfect shield against a projectile.** The thrower is a stage away and must not freeze; the defender's hitlag is the published 1 frame short, not the melee +11. Test: `combat.test.ts` "parries a projectile without freezing its thrower, 1 frame short for the defender" (Task 10).
3. **The stale queue across a rollback.** The new shield marks are an array, which the reflective hash test skips. Test: `combat.test.ts` "rolls back with the queue: a re-simulation from a snapshot lands on the same hash" (clone isolation and hash sensitivity included) plus the explicit `hash.test.ts` mutation case (Task 2).
4. **Knockback stacking with multi-hit moves.** Stacking is between *different* sources; every hit of one multi-hit is the same source and must take over the launch, however weak, or a drill would stop launching after its first hit — and the drill must stale once, not once per hit. Tests: `combat.test.ts` "never stacks a source with itself: a multi-hit's every hit takes over" (Task 8), "queues a multi-hit swing once, however many times it re-arms" (Task 16); Task 18's "lands Mario's down air as a multi-hit" and "queues Mario's down air once…" run both with real data.
5. **The balloon speed-up against the per-frame blast-zone check.** A sped-up real frame jumps up to six reaction frames, and the KO check runs once per real frame. The KO must come on the first real frame whose end lies past the line — never skipped, never twice. Test: `combat.test.ts` "KOs on the first sped-up frame past the blast zone, and only once" (Task 6).

---

## File Structure

Created:
- `src/engine/combat.ts` — `CombatState`: Plan 3's per-fighter fields, `emptyCombat`, `cloneCombat` (Task 2; fields added by Tasks 6, 8, 9, 11, 12, 14, 16, 19).
- `src/engine/combat.test.ts` — step-level tests for every task (Task 1 on).
- `src/engine/shield.ts` (+ `shield.test.ts`) — shield damage, size, bubble, pushback, break stun, mashing, perfect-shield hitlag (Tasks 9, 10).
- `src/engine/tech.ts` — tech input, tech-or-bounce on a surface (Task 12).
- `src/engine/status/passive.ts` — PASSIVE, PASSIVE_FB, PASSIVE_WALL, PASSIVE_CEIL (Task 12).
- `src/fighters/acmd/active.ts` (+ `active.test.ts`) — which imported scripts run, and `withReferenceScripts` (Task 18).

Modified:
- `src/engine/knockback.ts` (+ `.test.ts`) — staling table (2), Sakurai angle and flat launches (3), linear DI, `launchDiAble`, LSI bounds, `stickSensibility` (4), hitstun minimum and speed-up arithmetic (5), `knockbackStack` (8), `shieldstunExact` (9).
- `src/engine/kinetic.ts` (+ `.test.ts`) — the speed-up on the DAMAGE energy, `kineticTakeStep` (6), `kineticTurnLaunch` (8).
- `src/engine/simulate.ts` — the armour bug (1), shield staling (2), Sakurai (3), DI/LSI gate (4), speed-up (6), air-dodge refresh (7), stacking (8), shields (9, 10), SDI/ASDI (11), tech wiring (12), glancing (13), grabs (14), ledge trump (15), script-hitbox flags and stale-once (16), capsules (17), autolinks (19).
- `src/engine/constants.ts` — every new constant, each with its source, and `ENGINE_RULES_VERSION` (20).
- `src/engine/types.ts` — `FighterState.combat` (2), `Hitbox.direct` (10), the tech and trump actions (12, 15), `Hitbox.setWeight/situation/lr` (16), `Hitbox.x2/y2` (17).
- `src/engine/hash.ts` — `mixCombat`, the speed-up fields (2, 6 …).
- `src/engine/physics.ts` — `integrate` adds the speed-up step (6); `CollisionOutcome.wall/ceiling` (12).
- `src/engine/hitbox.ts` (+ `.test.ts`) — `sweptHitboxPenetration` (13), `sweptCapsulePenetration` (17).
- `src/engine/states.ts` — `buttonPresses` (9), tech intangibility (12), grab constants (14), `trumpLedge` (15), `startMove` resets `swingQueued` (16).
- `src/engine/status/{damage,guard,attack,cliff,kind,index}.ts` — hitstun cancel (7), shield break (9), grabs (14), CLIFF_ROBBED (15), the new kinds (12, 15).
- `src/engine/acmd/hitboxes.ts`, `legacy.ts` — script flags (16), capsules replace Plan 2's refusal (17).
- `src/fighters/{mario,donkeyKong,link,samus,kirby,fox,pikachu,marth}.ts` — exported through `withReferenceScripts` (18).
- `src/fighters/acmd/{reconcile.test.ts,reconcile.allow.json,reference.ts,index.ts}` — reconcile what runs; 13 entries gone (18, 21).
- `src/render/poses/timing.ts` — the new actions map to existing clips (12, 15).
- `src/game/simContext.ts` (+ `.test.ts`) — `engineFingerprint` covers `ENGINE_RULES_VERSION` and `ACTIVE_SCRIPT_SLOTS` (20); `src/net/online/lobby.ts` — its doc comment (20).
- Fixtures building a `FighterState`: `src/render/testFixtures.ts`, `src/ai/{cpu,behaviours}.test.ts`, `src/engine/{hash,projectile,states,physics}.test.ts`, `src/engine/status/{status,groups}.test.ts` (Task 2).
- `src/engine/simulate.test.ts` (4), `src/engine/acmd/bones.test.ts` (17), `src/fighters/specials.test.ts` (14), `src/game/__golden__/engine-trace.json` (regenerated in 2, 3, 4, 5, 6, 9, 10, 12, 13, 15, 18).
- `DECISIONS.md` (D56), `README.md` (21).

---

### Task 1: Super armour counts a hit's damage once

`applyHit` adds `damage` to the victim, then — inside the super-armour branch — adds it again. Every armoured hit (Donkey Kong's Giant Punch, Kirby's Stone) has dealt double damage since armour was wired (research R§2 "probable bug"). This task also creates `src/engine/combat.test.ts`, the step-level test file every later task appends to, with its own two-fighter fixtures.

**Files:**
- Create: `super-smash/src/engine/combat.test.ts`
- Modify: `super-smash/src/engine/simulate.ts`

**Interfaces:** Produces: `src/engine/combat.test.ts` fixtures — `BASE_DEF`, `STAGE`, `RULES`, `ctxFor(def?, stage?)`, `standing(ctx?)`, `play(state, n, inputs, ctx?)`, `JAB` — that Tasks 2–20 append to. No engine API change.

- [ ] **Step 1: Write the failing tests**

Create `src/engine/combat.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { fx } from "./fixed";
import { createInitialState, step } from "./simulate";
import type { SimContext } from "./simulate";
import { Btn } from "./types";
import type {
  FighterAttributes,
  FighterDef,
  GameState,
  Hitbox,
  InputFrame,
  MatchRules,
  MoveDef,
  StageDef,
  StepEvents,
} from "./types";

/**
 * Plan 3 (combat fidelity), through `step()`: each describe block is one task's
 * behaviour, on a two-fighter flat stage with a hand-built tester whose moves
 * each tests sets up. Formula-level checks live in `knockback.test.ts`.
 */

/* ------------------------------------------------------------- fixtures -- */

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

function hitbox(over: Partial<Hitbox> = {}): Hitbox {
  return {
    id: 0,
    startFrame: 4,
    endFrame: 6,
    x: fx(8),
    y: fx(6),
    radius: fx(5),
    damage: fx(10),
    angle: fx(45),
    baseKnockback: fx(40),
    knockbackGrowth: fx(100),
    ...over,
  };
}

function move(slot: MoveDef["slot"], over: Partial<MoveDef> = {}): MoveDef {
  return { slot, name: slot, totalFrames: 24, hitboxes: [hitbox()], ...over };
}

const BASE_DEF: FighterDef = {
  id: "tester",
  name: "Tester",
  series: "test",
  number: 1,
  attributes: ATTRS,
  moves: {
    jab1: move("jab1"),
    ftilt: move("ftilt"),
    nair: move("nair", { landingLag: 8 }),
    // Armoured on frames 1–30, like Kirby's Stone or Donkey Kong's Giant Punch.
    downB: move("downB", { totalFrames: 40, hitboxes: [], superArmourFrames: [1, 30] }),
    grab: move("grab", { totalFrames: 30, hitboxes: [hitbox({ grabbing: true })] }),
  },
  palette: { primary: "#f00", secondary: "#00f", accent: "#ff0", skin: "#fca", outline: "#000", alts: [] },
  blurb: "test",
};

const STAGE: StageDef = {
  id: "flat",
  name: "Flat",
  series: "test",
  platforms: [{ x: 0, y: 0, halfWidth: fx(80), soft: false, ledges: true }],
  blastZone: { left: fx(-240), right: fx(240), top: fx(192), bottom: fx(-140) },
  spawns: [
    { x: fx(-40), y: fx(20) },
    { x: fx(40), y: fx(20) },
  ],
  theme: "test",
};

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: false };

function ctxFor(def: FighterDef = BASE_DEF, stage: StageDef = STAGE): SimContext {
  return { fighter: () => def, stage: () => stage };
}

/** Both fighters standing 8 units apart, facing each other, free to act. */
function standing(ctx: SimContext = ctxFor()): GameState {
  const s = createInitialState("flat", [{ defId: "tester" }, { defId: "tester" }], RULES, 12345, ctx);
  for (const f of s.fighters) {
    f.action = "stand";
    f.actionFrame = 0;
    f.grounded = true;
    f.platform = 0;
    f.y = 0;
    f.intangible = 0;
  }
  s.fighters[0].x = 0;
  s.fighters[0].facing = 1;
  s.fighters[1].x = fx(8);
  s.fighters[1].facing = -1;
  return s;
}

interface Frame {
  readonly state: GameState;
  readonly events: StepEvents;
}

/** Step `n` frames; `inputs(i)` gives frame i's inputs. Returns every frame. */
function play(
  s: GameState,
  n: number,
  inputs: (i: number) => readonly InputFrame[],
  ctx: SimContext = ctxFor(),
): Frame[] {
  const out: Frame[] = [];
  let state = s;
  let prev: readonly InputFrame[] = [0, 0];
  for (let i = 0; i < n; i++) {
    const now = inputs(i);
    const r = step(state, now, { prevInputs: prev, ctx });
    out.push(r);
    state = r.state;
    prev = now;
  }
  return out;
}

/** Fighter 0 presses attack once (a jab) and nothing else happens. */
const JAB = (i: number): readonly InputFrame[] => (i === 0 ? [Btn.Attack, 0] : [0, 0]);

/* --------------------------------------------- Task 1: super armour -- */

describe("super armour counts the damage once (Plan 3, Task 1)", () => {
  it("adds exactly the damage the hit reports, not twice that", () => {
    const s = standing();
    const v = s.fighters[1];
    v.action = "special";
    v.move = "downB";
    v.actionFrame = 5;
    const frames = play(s, 8, JAB);
    const hit = frames.flatMap((f) => f.events.hits).find((h) => h.victim === 1);
    expect(hit, "the jab should land on the armoured fighter").toBeDefined();
    const after = frames[frames.length - 1].state.fighters[1];
    expect(after.damage).toBe(hit!.damage);
    // Armour: no launch, no hitstun, still in the move.
    expect(after.hitstun).toBe(0);
    expect(after.action).toBe("special");
  });
});
```

- [ ] **Step 2: Run them**

Run: `pnpm vitest run src/engine/combat.test.ts`
Expected: FAIL — `adds exactly the damage the hit reports, not twice that`: `AssertionError: expected 86020 to be 43010` (the damage landed twice).

- [ ] **Step 3: Implement**

In `src/engine/simulate.ts`, replace:

```ts
  // a move like Giant Punch — you walk through the jab and land the punch — and
  // it is why armour has to sit here, after damage and before knockback, rather
  // than at the top with the intangibility checks.
  if (hasSuperArmour(victim, victimDef)) {
    victim.damage += damage;
    // The attacker still freezes. Hitting armour should feel like hitting
    // something solid, and a hit that reports nothing back reads as a whiff.
```

with:

```ts
  // a move like Giant Punch — you walk through the jab and land the punch — and
  // it is why armour has to sit here, after damage and before knockback, rather
  // than at the top with the intangibility checks. The damage was added once,
  // above; adding it again here doubled every armoured hit (Plan 3, Task 1).
  if (hasSuperArmour(victim, victimDef)) {
    // The attacker still freezes. Hitting armour should feel like hitting
    // something solid, and a hit that reports nothing back reads as a whiff.
```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/engine/combat.test.ts`
Expected: PASS.

- [ ] **Step 5: The golden trace**

Run: `pnpm vitest run src/game/golden.test.ts`
Expected: PASS, unchanged — no CPU match lands a hit on armour, so the fingerprint does not move.

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0 (`pnpm lint` reports only the two pre-existing warnings in `research/rebuild-2026-10/tools/sim_bench.mjs`).

- [ ] **Step 7: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/src/engine/combat.test.ts \
  super-smash/src/engine/simulate.ts
git commit -m "super-smash: super armour counts a hit's damage once" -m "applyHit added the damage before the armour check and again inside it, so every armoured hit dealt double. combat.test.ts starts here: Plan 3's step-level tests." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: CombatState, and the published staling table with shield hits at 0.85

Staleness was "9% down to 1%" with the 1.05 freshness bonus added on top of every reduction — a move in the oldest slot dealt 1.04×. SmashWiki's Ultimate table is 0.09, 0.08545, 0.07635, 0.0679, 0.05945, 0.05035, 0.04255, 0.03345, 0.025; the bonus applies only to a move absent from the queue; and an entry whose hit landed on a shield reduces at 0.85. Q12 cannot hold the table, so it is kept in 1/100000 units and applied with one truncation.

Plan 3 needs about a dozen new per-fighter fields. Rather than teach every `FighterState` fixture in the repo about each, they live in one sub-object, `CombatState` (`src/engine/combat.ts`), exactly as Plan 2 did with `kinetic`. This task creates it with its first field, `staleShield` (parallel to `staleQueue`), wires it into `cloneState`, `createInitialState` and `hashState` (`mixCombat`), and adds `combat: emptyCombat()` to the nine files that build a `FighterState` by hand (eight test files and `src/render/testFixtures.ts`). The reflective clone test already walks it; the reflective hash test skips arrays, so `hash.test.ts` gains an explicit case — and `combat.test.ts` gains Review Focus #3, the queue across a rollback.

**Files:**
- Modify: `super-smash/src/ai/behaviours.test.ts`
- Modify: `super-smash/src/ai/cpu.test.ts`
- Modify: `super-smash/src/engine/combat.test.ts`
- Create: `super-smash/src/engine/combat.ts`
- Modify: `super-smash/src/engine/hash.test.ts`
- Modify: `super-smash/src/engine/hash.ts`
- Modify: `super-smash/src/engine/knockback.test.ts`
- Modify: `super-smash/src/engine/knockback.ts`
- Modify: `super-smash/src/engine/physics.test.ts`
- Modify: `super-smash/src/engine/projectile.test.ts`
- Modify: `super-smash/src/engine/simulate.ts`
- Modify: `super-smash/src/engine/states.test.ts`
- Modify: `super-smash/src/engine/status/groups.test.ts`
- Modify: `super-smash/src/engine/status/status.test.ts`
- Modify: `super-smash/src/engine/types.ts`
- Modify: `super-smash/src/game/__golden__/engine-trace.json` (regenerated by a command in this task)
- Modify: `super-smash/src/render/testFixtures.ts`

**Interfaces:** Produces:
```ts
// src/engine/combat.ts
export interface CombatState { staleShield: boolean[] } // later tasks add fields
export function emptyCombat(): CombatState;
export function cloneCombat(c: CombatState): CombatState;
// src/engine/hash.ts
export function mixCombat(h: number, c: CombatState): number;
// src/engine/types.ts — FighterState gains:
combat: CombatState;
// src/engine/knockback.ts
export const STALE_SLOT_REDUCTION_1E5: readonly [9000, 8545, 7635, 6790, 5945, 5035, 4255, 3345, 2500];
export const STALE_SHIELD_RATIO: Ratio; // [17, 20]
export function computeStaleness(queue: readonly MoveSlot[], slot: MoveSlot, shieldQueue?: readonly boolean[]): Staleness;
```

- [ ] **Step 1: Write the failing tests**

In `src/ai/behaviours.test.ts`, replace:

```ts
import { fx, toFloat } from "@/engine/fixed";
import { Btn, held, type FighterState, type GameState, type StageDef } from "@/engine/types";
import { emptyKinetic } from "@/engine/kinetic";
import {
```

with:

```ts
import { fx, toFloat } from "@/engine/fixed";
import { Btn, held, type FighterState, type GameState, type StageDef } from "@/engine/types";
import { emptyCombat } from "@/engine/combat";
import { emptyKinetic } from "@/engine/kinetic";
import {
```

In `src/ai/behaviours.test.ts`, replace:

```ts
    bufferedAction: null,
    kinetic: emptyKinetic(),
    ...over,
  };
```

with:

```ts
    bufferedAction: null,
    kinetic: emptyKinetic(),
    combat: emptyCombat(),
    ...over,
  };
```

In `src/ai/cpu.test.ts`, replace:

```ts
import { fx } from "@/engine/fixed";
import { Btn, held, type FighterState, type GameState } from "@/engine/types";
import { emptyKinetic } from "@/engine/kinetic";
import { DEFAULT_STAGE_VIEW } from "./behaviours";
```

with:

```ts
import { fx } from "@/engine/fixed";
import { Btn, held, type FighterState, type GameState } from "@/engine/types";
import { emptyCombat } from "@/engine/combat";
import { emptyKinetic } from "@/engine/kinetic";
import { DEFAULT_STAGE_VIEW } from "./behaviours";
```

In `src/ai/cpu.test.ts`, replace:

```ts
    bufferedAction: null,
    kinetic: emptyKinetic(),
    ...over,
  };
```

with:

```ts
    bufferedAction: null,
    kinetic: emptyKinetic(),
    combat: emptyCombat(),
    ...over,
  };
```

In `src/engine/combat.test.ts`, replace:

```ts

import { fx } from "./fixed";
import { createInitialState, step } from "./simulate";
import type { SimContext } from "./simulate";
import { Btn } from "./types";
```

with:

```ts

import { fx } from "./fixed";
import { hashState } from "./hash";
import { cloneState, createInitialState, step } from "./simulate";
import type { SimContext } from "./simulate";
import { Btn } from "./types";
```

Append to the end of `src/engine/combat.test.ts`:

```ts
/* ------------------------------------------------- Task 2: staling -- */

/** Fighter 0 jabs once; fighter 1 holds shield the whole time. */
const JAB_INTO_SHIELD = (i: number): readonly InputFrame[] => [i === 0 ? Btn.Attack : 0, Btn.Shield];

describe("the stale queue remembers shield hits (Plan 3, Task 2)", () => {
  it("queues a move that hits a shield, marked as a shield hit", () => {
    const after = play(standing(), 10, JAB_INTO_SHIELD).at(-1)!.state.fighters[0];
    expect(after.staleQueue).toEqual(["jab1"]);
    expect(after.combat.staleShield).toEqual([true]);
  });

  it("queues an ordinary hit unmarked, in front of the shield hit", () => {
    const shielded = play(standing(), 40, JAB_INTO_SHIELD).at(-1)!.state;
    shielded.fighters[1].action = "stand";
    shielded.fighters[1].hitstun = 0;
    shielded.fighters[1].x = fx(8);
    shielded.fighters[0].x = 0;
    const after = play(shielded, 10, JAB).at(-1)!.state.fighters[0];
    expect(after.staleQueue).toEqual(["jab1", "jab1"]);
    expect(after.combat.staleShield).toEqual([false, true]);
  });

  it("trims the marks with the queue at nine", () => {
    const s = standing();
    s.fighters[0].staleQueue = new Array(9).fill("ftilt");
    s.fighters[0].combat.staleShield = new Array(9).fill(true);
    const after = play(s, 10, JAB).at(-1)!.state.fighters[0];
    expect(after.staleQueue).toHaveLength(9);
    expect(after.combat.staleShield).toEqual([false, true, true, true, true, true, true, true, true]);
  });

  it("deals the shield-staled damage: 1 − 0.09 × 0.85 of fresh/1.05", () => {
    const s = standing();
    s.fighters[0].staleQueue = ["jab1"];
    s.fighters[0].combat.staleShield = [true];
    const hit = play(s, 8, JAB).flatMap((f) => f.events.hits)[0];
    // Fresh is 10 × 1.05; one shield-marked slot is 10 × (1 − 0.0765).
    expect(hit.damage / 4096).toBeCloseTo(10 * (1 - 0.09 * 0.85), 2);
  });

  // Review Focus #3: the stale queue across a rollback.
  it("rolls back with the queue: a re-simulation from a snapshot lands on the same hash", () => {
    const frames = play(standing(), 30, JAB_INTO_SHIELD);
    const snapshot = cloneState(frames[4].state);
    let replay = snapshot;
    let prev: readonly InputFrame[] = JAB_INTO_SHIELD(4);
    for (let i = 5; i < 30; i++) {
      const now = JAB_INTO_SHIELD(i);
      replay = step(replay, now, { prevInputs: prev, ctx: ctxFor() }).state;
      prev = now;
    }
    expect(hashState(replay)).toBe(hashState(frames[29].state));
    // The copy shares nothing with the snapshot it came from.
    const copy = cloneState(frames[29].state);
    copy.fighters[0].combat.staleShield[0] = false;
    expect(frames[29].state.fighters[0].combat.staleShield[0]).toBe(true);
    expect(hashState(copy)).not.toBe(hashState(frames[29].state));
  });

  it("empties the queue and its marks on a KO", () => {
    const s = standing();
    s.fighters[1].staleQueue = ["jab1"];
    s.fighters[1].combat.staleShield = [true];
    s.fighters[1].x = fx(300);
    s.fighters[1].grounded = false;
    const after = play(s, 1, () => [0, 0]).at(-1)!.state.fighters[1];
    expect(after.action).toBe("dead");
    expect(after.staleQueue).toEqual([]);
    expect(after.combat.staleShield).toEqual([]);
  });
});
```

In `src/engine/hash.test.ts`, replace:

```ts

import { fx } from "./fixed";
import { emptyKinetic } from "./kinetic";
import { hashState, mixBool, mixInt, mixString } from "./hash";
```

with:

```ts

import { fx } from "./fixed";
import { emptyCombat } from "./combat";
import { emptyKinetic } from "./kinetic";
import { hashState, mixBool, mixInt, mixString } from "./hash";
```

In `src/engine/hash.test.ts`, replace:

```ts
    bufferedAction: null,
    kinetic: emptyKinetic(),
    ...over,
  };
```

with:

```ts
    bufferedAction: null,
    kinetic: emptyKinetic(),
    combat: emptyCombat(),
    ...over,
  };
```

In `src/engine/hash.test.ts`, replace:

```ts
      ["fighter.kinetic.fallFrames", (s) => (s.fighters[0].kinetic.fallFrames += 1)],
      ["fighter.kinetic.jumpInitial", (s) => (s.fighters[0].kinetic.jumpInitial += 1)],
      ["projectiles", (s) => s.projectiles.push(projectile())],
    ];
```

with:

```ts
      ["fighter.kinetic.fallFrames", (s) => (s.fighters[0].kinetic.fallFrames += 1)],
      ["fighter.kinetic.jumpInitial", (s) => (s.fighters[0].kinetic.jumpInitial += 1)],
      ["fighter.combat.staleShield", (s) => s.fighters[0].combat.staleShield.push(true)],
      ["projectiles", (s) => s.projectiles.push(projectile())],
    ];
```

In `src/engine/knockback.test.ts`, replace:

```ts
} from "./knockback";
import type { MoveSlot } from "./types";

/**
```

with:

```ts
} from "./knockback";
import type { MoveSlot } from "./types";
import * as ref from "../../research/rebuild-2026-10/tools/ssbu_ref.mjs";

/**
```

In `src/engine/knockback.test.ts`, replace:

```ts
  });

  it("takes 9% off for the most recent slot and 1% for the oldest", () => {
    const recent = computeStaleness([slot], slot);
    expect(toFloat(recent.damage)).toBeCloseTo(0.96, 3);

    const oldest: MoveSlot[] = ["jab1", "jab1", "jab1", "jab1", "jab1", "jab1", "jab1", "jab1", slot];
    expect(toFloat(computeStaleness(oldest, slot).damage)).toBeCloseTo(1.04, 3);
  });

  it("bottoms out at 0.6x with the whole queue full of one move", () => {
    const queue = new Array<MoveSlot>(9).fill(slot);
    expect(toFloat(computeStaleness(queue, slot).damage)).toBeCloseTo(0.6, 3);
  });

```

with:

```ts
  });

  // SmashWiki "Stale-move negation" (https://www.ssbwiki.com/Stale-move_negation),
  // Ultimate: 0.09, 0.08545, 0.07635, 0.0679, 0.05945, 0.05035, 0.04255, 0.03345,
  // 0.025 — and the freshness bonus only for a move absent from the queue.
  it.each([
    [0, 0.09],
    [1, 0.08545],
    [2, 0.07635],
    [3, 0.0679],
    [4, 0.05945],
    [5, 0.05035],
    [6, 0.04255],
    [7, 0.03345],
    [8, 0.025],
  ])("takes the published %i-th slot reduction off, with no freshness bonus", (i, reduction) => {
    const queue = new Array<MoveSlot>(9).fill("jab1");
    queue[i] = slot;
    expect(toFloat(computeStaleness(queue, slot).damage)).toBeCloseTo(1 - reduction, 3);
  });

  it("bottoms out at 1 − 0.5305 with the whole queue full of one move", () => {
    const queue = new Array<MoveSlot>(9).fill(slot);
    expect(toFloat(computeStaleness(queue, slot).damage)).toBeCloseTo(0.4695, 3);
  });

  it("counts a slot that hit a shield at 0.85 of its reduction", () => {
    const queue: MoveSlot[] = [slot];
    expect(toFloat(computeStaleness(queue, slot, [true]).damage)).toBeCloseTo(1 - 0.09 * 0.85, 3);
    expect(toFloat(computeStaleness(queue, slot, [false]).damage)).toBeCloseTo(0.91, 3);
  });

  it("matches the reference port for any queue and shield pattern", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.boolean(), fc.boolean()), { maxLength: 9 }),
        (entries) => {
          const queue = entries.map(([mine]) => (mine ? slot : "jab1") as MoveSlot);
          const shields = entries.map(([, onShield]) => onShield);
          const ours = toFloat(computeStaleness(queue, slot, shields).damage);
          const theirs = ref.staleMult(entries.map(([mine]) => mine), shields);
          expect(Math.abs(ours - theirs)).toBeLessThan(2 / ONE);
        },
      ),
      { numRuns: 500 },
    );
  });

```

In `src/engine/knockback.test.ts`, replace:

```ts
    const queue = new Array<MoveSlot>(9).fill(slot);
    const s = computeStaleness(queue, slot);
    // Damage falls 40%; knockback should fall only 12%.
    expect(toFloat(s.damage)).toBeCloseTo(0.6, 3);
    expect(toFloat(s.knockback)).toBeCloseTo(0.88, 2);
  });

```

with:

```ts
    const queue = new Array<MoveSlot>(9).fill(slot);
    const s = computeStaleness(queue, slot);
    // Damage falls 53.05%; the knockback formula's d falls only 0.3 of that.
    expect(toFloat(s.knockback)).toBeCloseTo(1 - 0.5305 * 0.3, 3);
  });

```

In `src/engine/physics.test.ts`, replace:

```ts
import { fx, toFloat } from "./fixed";
import { BALLOON_FALL_SPEED, LEDGE_GRAB_BACK_PENALTY, LEDGE_GRAB_RANGE_X } from "./constants";
import { emptyKinetic } from "./kinetic";
import {
```

with:

```ts
import { fx, toFloat } from "./fixed";
import { BALLOON_FALL_SPEED, LEDGE_GRAB_BACK_PENALTY, LEDGE_GRAB_RANGE_X } from "./constants";
import { emptyCombat } from "./combat";
import { emptyKinetic } from "./kinetic";
import {
```

In `src/engine/physics.test.ts`, replace:

```ts
    bufferedAction: null,
    kinetic: emptyKinetic(),
    ...over,
  };
```

with:

```ts
    bufferedAction: null,
    kinetic: emptyKinetic(),
    combat: emptyCombat(),
    ...over,
  };
```

In `src/engine/projectile.test.ts`, replace:

```ts
  spawnProjectile,
} from "./projectile";
import { emptyKinetic } from "./kinetic";
import { Btn } from "./types";
```

with:

```ts
  spawnProjectile,
} from "./projectile";
import { emptyCombat } from "./combat";
import { emptyKinetic } from "./kinetic";
import { Btn } from "./types";
```

In `src/engine/projectile.test.ts`, replace:

```ts
    bufferedAction: null,
    kinetic: emptyKinetic(),
    ...over,
  };
```

with:

```ts
    bufferedAction: null,
    kinetic: emptyKinetic(),
    combat: emptyCombat(),
    ...over,
  };
```

In `src/engine/states.test.ts`, replace:

```ts
} from "./states";
import type { Intent, StateContext } from "./states";
import { emptyKinetic, jumpLaunchSpeed } from "./kinetic";
import { paramsFromAttributes } from "./params";
```

with:

```ts
} from "./states";
import type { Intent, StateContext } from "./states";
import { emptyCombat } from "./combat";
import { emptyKinetic, jumpLaunchSpeed } from "./kinetic";
import { paramsFromAttributes } from "./params";
```

In `src/engine/states.test.ts`, replace:

```ts
    bufferedAction: null,
    kinetic: emptyKinetic(),
    ...over,
  };
```

with:

```ts
    bufferedAction: null,
    kinetic: emptyKinetic(),
    combat: emptyCombat(),
    ...over,
  };
```

In `src/engine/status/groups.test.ts`, replace:

```ts
import { RESPAWN_INVINCIBILITY_MAX } from "../constants";
import { fx } from "../fixed";
import { emptyKinetic } from "../kinetic";
import type { KineticType } from "../kinetic";
```

with:

```ts
import { RESPAWN_INVINCIBILITY_MAX } from "../constants";
import { fx } from "../fixed";
import { emptyCombat } from "../combat";
import { emptyKinetic } from "../kinetic";
import type { KineticType } from "../kinetic";
```

In `src/engine/status/groups.test.ts`, replace:

```ts
    bufferedAction: null,
    kinetic: emptyKinetic(),
    ...over,
  };
```

with:

```ts
    bufferedAction: null,
    kinetic: emptyKinetic(),
    combat: emptyCombat(),
    ...over,
  };
```

In `src/engine/status/status.test.ts`, replace:

```ts

import { fx } from "../fixed";
import { emptyKinetic } from "../kinetic";
import { advanceFighter } from "../states";
```

with:

```ts

import { fx } from "../fixed";
import { emptyCombat } from "../combat";
import { emptyKinetic } from "../kinetic";
import { advanceFighter } from "../states";
```

In `src/engine/status/status.test.ts`, replace:

```ts
    bufferedAction: null,
    kinetic: emptyKinetic(),
    ...over,
  };
```

with:

```ts
    bufferedAction: null,
    kinetic: emptyKinetic(),
    combat: emptyCombat(),
    ...over,
  };
```

In `src/render/testFixtures.ts`, replace:

```ts
} from "@/engine/types";
import { emptyEvents } from "@/engine/types";
import { emptyKinetic } from "@/engine/kinetic";
import { createCamera } from "./camera";
```

with:

```ts
} from "@/engine/types";
import { emptyEvents } from "@/engine/types";
import { emptyCombat } from "@/engine/combat";
import { emptyKinetic } from "@/engine/kinetic";
import { createCamera } from "./camera";
```

In `src/render/testFixtures.ts`, replace:

```ts
    bufferedAction: null,
    kinetic: emptyKinetic(),
    ...over,
  };
```

with:

```ts
    bufferedAction: null,
    kinetic: emptyKinetic(),
    combat: emptyCombat(),
    ...over,
  };
```

- [ ] **Step 2: Run them**

Run: `pnpm vitest run src/ai/behaviours.test.ts src/ai/cpu.test.ts src/engine/combat.test.ts src/engine/hash.test.ts src/engine/knockback.test.ts src/engine/physics.test.ts src/engine/projectile.test.ts src/engine/states.test.ts src/engine/status/groups.test.ts src/engine/status/status.test.ts`
Expected: FAIL — the eight fixture test files cannot resolve `./combat` / `@/engine/combat` / `../combat` ("Failed to resolve import"); in `knockback.test.ts` the nine published-slot cases fail (`expected 0.9599609375 to be close to 0.91` — the old table plus the 1.05 bonus), as do the 0.5305, shield-slot and reference-port cases; the six `combat.test.ts` cases throw `TypeError: Cannot read properties of undefined (reading 'staleShield')`.

- [ ] **Step 3: Implement**

Create `src/engine/combat.ts`:

```ts
/**
 * CombatState — the per-fighter bookkeeping Plan 3's combat rules need.
 *
 * One sub-object, like `KineticState`, so every rule Plan 3 adds is one more
 * field here rather than one more `FighterState` field that every fixture in
 * the repo has to learn about. It is cloned by `cloneState` and hashed by
 * `hashState` (`mixCombat`) like everything else a rollback must reproduce;
 * the reflective tests in `simulate.test.ts` and `hash.test.ts` walk it.
 */

export interface CombatState {
  /**
   * Parallel to `FighterState.staleQueue`: entry i landed on a shield, so it
   * stales at 0.85 (SmashWiki "Stale-move negation"). Pushed and trimmed with
   * the queue, never on its own.
   */
  staleShield: boolean[];
}

export function emptyCombat(): CombatState {
  return {
    staleShield: [],
  };
}

export function cloneCombat(c: CombatState): CombatState {
  return {
    staleShield: c.staleShield.slice(),
  };
}
```

In `src/engine/hash.ts`, replace:

```ts
 */

import type { KineticState } from "./kinetic";
import type {
```

with:

```ts
 */

import type { CombatState } from "./combat";
import type { KineticState } from "./kinetic";
import type {
```

In `src/engine/hash.ts`, replace:

```ts
    x = mixInt(x, f.bufferedAction.frame);
  }
  return mixKinetic(x, f.kinetic);
}

```

with:

```ts
    x = mixInt(x, f.bufferedAction.frame);
  }
  x = mixKinetic(x, f.kinetic);
  return mixCombat(x, f.combat);
}

/** Plan 3's combat bookkeeping, in declaration order. */
export function mixCombat(h: number, c: CombatState): number {
  let x = mixInt(h, c.staleShield.length);
  for (const onShield of c.staleShield) x = mixBool(x, onShield);
  return x;
}

```

In `src/engine/knockback.ts`, replace:

```ts

/**
 * How much each of the nine queue slots takes off a repeated move.
 *
 * Index 0 is the move used most recently, and it costs the most: 9% of the
 * move's damage, tapering to 1% for the one that is about to fall off the end.
 * Spam every slot with the same move and you land 45% below fresh.
 */
const STALE_SLOT_REDUCTION = [
  fx(0.09),
  fx(0.08),
  fx(0.07),
  fx(0.06),
  fx(0.05),
  fx(0.04),
  fx(0.03),
  fx(0.02),
  fx(0.01),
] as const;

/**
```

with:

```ts

/**
 * How much each of the nine queue slots takes off a repeated move, in units of
 * 1/100000 so the published values stay exact (Q12 cannot hold 0.08545).
 *
 * SmashWiki "Stale-move negation" (https://www.ssbwiki.com/Stale-move_negation),
 * Ultimate: 0.09, 0.08545, 0.07635, 0.0679, 0.05945, 0.05035, 0.04255,
 * 0.03345, 0.025 — 0.5305 in all. Index 0 is the move used most recently.
 * rubendal SSBU-Calculator `js/formulas.js` (`parameters.staling.factors`) agrees.
 */
export const STALE_SLOT_REDUCTION_1E5 = [9000, 8545, 7635, 6790, 5945, 5035, 4255, 3345, 2500] as const;

/**
 * A slot whose hit landed on a shield takes off only 0.85 of its reduction
 * ("including if perfect shielded"). SmashWiki "Stale-move negation"; rubendal
 * `StaleNegation` (`S[i] * 0.85` for a shield entry).
 */
export const STALE_SHIELD_RATIO: Ratio = [17, 20];

/**
```

In `src/engine/knockback.ts`, replace:

```ts
 * The freshness bonus is why mixing up your kill options is worth doing rather
 * than merely not-harmful: rotating moves is a live 1.05× on the one you finally
 * commit to.
 */
export const STALE_FRESH_BONUS = fx(1.05);
```

with:

```ts
 * The freshness bonus is why mixing up your kill options is worth doing rather
 * than merely not-harmful: rotating moves is a live 1.05× on the one you finally
 * commit to. It applies only to a move that is not in the queue at all — a
 * move in the oldest slot is 0.975×, not 1.025× (rubendal `StaleNegation`:
 * `if (s == 1) return 1.05`).
 */
export const STALE_FRESH_BONUS = fx(1.05);
```

In `src/engine/knockback.ts`, replace:

```ts
 * because they used it twice in neutral.
 *
 * `queue[0]` is the most recently landed move.
 */
export function computeStaleness(queue: readonly MoveSlot[], slot: MoveSlot): Staleness {
  let reduction = 0;
  const n = Math.min(queue.length, STALE_QUEUE_LENGTH);
  for (let i = 0; i < n; i++) {
    if (queue[i] === slot) reduction += STALE_SLOT_REDUCTION[i];
  }
  const damage = STALE_FRESH_BONUS - reduction;
  const knockback = ONE + mulDiv(damage - ONE, STALE_KNOCKBACK_DAMPING, ONE);
  return { damage, knockback };
```

with:

```ts
 * because they used it twice in neutral.
 *
 * `queue[0]` is the most recently landed move; `shieldQueue[i]` says whether
 * that entry's hit landed on a shield (`CombatState.staleShield`).
 */
export function computeStaleness(
  queue: readonly MoveSlot[],
  slot: MoveSlot,
  shieldQueue: readonly boolean[] = [],
): Staleness {
  // Summed over a common denominator of 100000 × 20, so the 0.85 shield factor
  // (17/20) and the five-digit table stay exact until one final truncation.
  let reduction = 0;
  let present = false;
  const n = Math.min(queue.length, STALE_QUEUE_LENGTH);
  for (let i = 0; i < n; i++) {
    if (queue[i] !== slot) continue;
    present = true;
    const [num, den] = shieldQueue[i] === true ? STALE_SHIELD_RATIO : ([1, 1] as const);
    reduction += (STALE_SLOT_REDUCTION_1E5[i] * num * STALE_SHIELD_RATIO[1]) / den;
  }
  const damage = present
    ? ONE - Math.trunc((reduction * ONE) / (100_000 * STALE_SHIELD_RATIO[1]))
    : STALE_FRESH_BONUS;
  const knockback = ONE + mulDiv(damage - ONE, STALE_KNOCKBACK_DAMPING, ONE);
  return { damage, knockback };
```

In `src/engine/simulate.ts`, replace:

```ts
  SMASH_BALL_HEALTH,
  SMASH_BALL_SPAWN_INTERVAL,
  TUMBLE_HITSTUN,
} from "./constants";
```

with:

```ts
  SMASH_BALL_HEALTH,
  SMASH_BALL_SPAWN_INTERVAL,
  STALE_QUEUE_LENGTH,
  TUMBLE_HITSTUN,
} from "./constants";
```

In `src/engine/simulate.ts`, replace:

```ts
} from "./kinetic";
import { LEGACY_BONE_TABLE, type BoneTable } from "./acmd/bones";
import { scriptHitboxes } from "./acmd/hitboxes";
import { moveScriptFrame } from "./acmd/run";
```

with:

```ts
} from "./kinetic";
import { LEGACY_BONE_TABLE, type BoneTable } from "./acmd/bones";
import { cloneCombat, emptyCombat } from "./combat";
import { scriptHitboxes } from "./acmd/hitboxes";
import { moveScriptFrame } from "./acmd/run";
```

In `src/engine/simulate.ts`, replace:

```ts
          : ({ kind: f.bufferedAction.kind, frame: f.bufferedAction.frame } as FighterState["bufferedAction"]),
      kinetic: cloneKinetic(f.kinetic),
    };
  }
```

with:

```ts
          : ({ kind: f.bufferedAction.kind, frame: f.bufferedAction.frame } as FighterState["bufferedAction"]),
      kinetic: cloneKinetic(f.kinetic),
      combat: cloneCombat(f.combat),
    };
  }
```

In `src/engine/simulate.ts`, replace:

```ts
      bufferedAction: null,
      kinetic: emptyKinetic(),
    };
  });
```

with:

```ts
      bufferedAction: null,
      kinetic: emptyKinetic(),
      combat: emptyCombat(),
    };
  });
```

In `src/engine/simulate.ts`, replace:

```ts
    f.shieldHealth = SHIELD_MAX_HEALTH;
    f.staleQueue.length = 0;
    clearHitRecord(f);
    startAction(f, "dead");
```

with:

```ts
    f.shieldHealth = SHIELD_MAX_HEALTH;
    f.staleQueue.length = 0;
    f.combat.staleShield.length = 0;
    clearHitRecord(f);
    startAction(f, "dead");
```

In `src/engine/simulate.ts`, replace:

```ts
function effectiveDamage(s: GameState, attacker: FighterState, c: Candidate): number {
  const staleness =
    c.slot === null ? ONE : computeStaleness(attacker.staleQueue, c.slot).damage;
  const shortHopped = c.slot !== null && isAerialSlot(c.slot) && attacker.shortHop;
  const charged = mul(c.hitbox.damage, c.chargeScale);
```

with:

```ts
function effectiveDamage(s: GameState, attacker: FighterState, c: Candidate): number {
  const staleness =
    c.slot === null
      ? ONE
      : computeStaleness(attacker.staleQueue, c.slot, attacker.combat.staleShield).damage;
  const shortHopped = c.slot !== null && isAerialSlot(c.slot) && attacker.shortHop;
  const charged = mul(c.hitbox.damage, c.chargeScale);
```

In `src/engine/simulate.ts`, replace:

```ts
  // the staleness queue is keyed by move slot and an arrow has left its move.
  const staleness =
    c.slot === null ? { damage: ONE, knockback: ONE } : computeStaleness(attacker.staleQueue, c.slot);
  // An aerial thrown out of a short hop deals 0.85×, and the reduction is
  // applied to the damage *before* knockback is computed rather than to the
```

with:

```ts
  // the staleness queue is keyed by move slot and an arrow has left its move.
  const staleness =
    c.slot === null
      ? { damage: ONE, knockback: ONE }
      : computeStaleness(attacker.staleQueue, c.slot, attacker.combat.staleShield);
  // An aerial thrown out of a short hop deals 0.85×, and the reduction is
  // applied to the damage *before* knockback is computed rather than to the
```

In `src/engine/simulate.ts`, replace:

```ts
  }

  // A move joins the staleness queue once per swing, on its first connection.
  if (c.slot !== null && attacker.hitThisMove.length === 1) {
    attacker.staleQueue.unshift(c.slot);
    if (attacker.staleQueue.length > 9) attacker.staleQueue.length = 9;
  }

  /* ---- the shield path ---- */
  if (shieldCovers(victim, c.x)) {
    if (isParrying(victim)) {
      // Perfect shield: no shield damage, no shieldstun, and the attacker is the
```

with:

```ts
  }

  // A move joins the staleness queue once per swing, on its first connection —
  // a shield hit included, marked so it stales at 0.85 (SmashWiki "Stale-move
  // negation": hitting a shield enters the queue in Ultimate, perfect shield too).
  const onShield = shieldCovers(victim, c.x);
  if (c.slot !== null && attacker.hitThisMove.length === 1) {
    attacker.staleQueue.unshift(c.slot);
    attacker.combat.staleShield.unshift(onShield);
    if (attacker.staleQueue.length > STALE_QUEUE_LENGTH) attacker.staleQueue.length = STALE_QUEUE_LENGTH;
    if (attacker.combat.staleShield.length > STALE_QUEUE_LENGTH) {
      attacker.combat.staleShield.length = STALE_QUEUE_LENGTH;
    }
  }

  /* ---- the shield path ---- */
  if (onShield) {
    if (isParrying(victim)) {
      // Perfect shield: no shield damage, no shieldstun, and the attacker is the
```

In `src/engine/types.ts`, replace:

```ts

import type { AcmdScript } from "./acmd/types";
import type { KineticState } from "./kinetic";
import type { FighterParams } from "./params";
```

with:

```ts

import type { AcmdScript } from "./acmd/types";
import type { CombatState } from "./combat";
import type { KineticState } from "./kinetic";
import type { FighterParams } from "./params";
```

In `src/engine/types.ts`, replace:

```ts
   */
  kinetic: KineticState;
}

```

with:

```ts
   */
  kinetic: KineticState;
  /** Plan 3's combat bookkeeping (see `combat.ts`): stale shield marks and more. */
  combat: CombatState;
}

```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/ai/behaviours.test.ts src/ai/cpu.test.ts src/engine/combat.test.ts src/engine/hash.test.ts src/engine/knockback.test.ts src/engine/physics.test.ts src/engine/projectile.test.ts src/engine/states.test.ts src/engine/status/groups.test.ts src/engine/status/status.test.ts`
Expected: PASS.

- [ ] **Step 5: The golden trace**

Run: `pnpm vitest run src/game/golden.test.ts`
Expected before regenerating: FAIL in all four matches (Mario–Fox first diverges by frame 700, Donkey Kong–Pikachu by 600, the other two later — Link–Samus by 1700): every repeated move now deals the published staled damage. Regenerate, then it passes.

```bash
UPDATE_GOLDEN=1 pnpm vitest run src/game/golden.test.ts
pnpm vitest run src/game/golden.test.ts
```

Expected: the second run PASSes. This task changes behaviour on purpose; its commit says so.

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0 (`pnpm lint` reports only the two pre-existing warnings in `research/rebuild-2026-10/tools/sim_bench.mjs`).

- [ ] **Step 7: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/src/ai/behaviours.test.ts \
  super-smash/src/ai/cpu.test.ts \
  super-smash/src/engine/combat.test.ts \
  super-smash/src/engine/combat.ts \
  super-smash/src/engine/hash.test.ts \
  super-smash/src/engine/hash.ts \
  super-smash/src/engine/knockback.test.ts \
  super-smash/src/engine/knockback.ts \
  super-smash/src/engine/physics.test.ts \
  super-smash/src/engine/projectile.test.ts \
  super-smash/src/engine/simulate.ts \
  super-smash/src/engine/states.test.ts \
  super-smash/src/engine/status/groups.test.ts \
  super-smash/src/engine/status/status.test.ts \
  super-smash/src/engine/types.ts \
  super-smash/src/game/__golden__/engine-trace.json \
  super-smash/src/render/testFixtures.ts
git commit -m "super-smash: the published staling table, with shield hits at 0.85" -m "STALE_SLOT_REDUCTION_1E5 is SmashWiki's Ultimate table; the 1.05 bonus is for a fresh move only; staleShield marks entries that landed on a shield. CombatState (combat.ts) carries Plan 3's per-fighter fields, cloned and hashed like kinetic. Golden trace regenerated: staled damage changed." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The Sakurai angle: 38° in the air, a knockback ramp on the ground

361 resolved to 0° grounded and 44° airborne. SmashWiki's Ultimate table: airborne 38° at any knockback; grounded 0° below 60 knockback, 38° from 88, linear between; rubendal's `SakuraiAngle` gives the ramp as `min((kb − 60)/28 × 38 + 1, 38)`. `resolveAngle` takes the knockback now, and `applyHit` passes it.

Two more angle rules ride on the same function. SmashWiki "Sakurai angle": in Ultimate "moves with a launch angle of 0 … [change] to 32 degrees if they deal 120 units of knockback or more"; rubendal's `js/knockback.js` applies the same to 180°, and the replica mirrors it to 148° so a backward launch stays backward (UNVERIFIED — rubendal writes 32° for both). And rubendal's `groundedZeroAngle`: a grounded victim launched at 0° leaves at 0.8 of the launch speed (applied to the parked knockback; the hitstun is the hit's).

**Files:**
- Modify: `super-smash/src/engine/combat.test.ts`
- Modify: `super-smash/src/engine/constants.ts`
- Modify: `super-smash/src/engine/knockback.test.ts`
- Modify: `super-smash/src/engine/knockback.ts`
- Modify: `super-smash/src/engine/simulate.ts`
- Modify: `super-smash/src/game/__golden__/engine-trace.json` (regenerated by a command in this task)

**Interfaces:** Changes: `resolveAngle(hitbox: Pick<Hitbox, "angle">, victimGrounded: boolean, kb: number): number` (was two arguments). Adds `SAKURAI_KB_LOW = fx(60)`, `SAKURAI_KB_HIGH = fx(88)`, `FLAT_LIFT_KB = fx(120)`, `FLAT_LIFT_ANGLE = fx(32)`, `GROUNDED_ZERO_LAUNCH_RATIO: Ratio = [4, 5]`; `SAKURAI_AIRBORNE` becomes `fx(38)`.

- [ ] **Step 1: Write the failing tests**

In `src/engine/combat.test.ts`, replace:

```ts
import { describe, expect, it } from "vitest";

import { fx } from "./fixed";
import { hashState } from "./hash";
import { cloneState, createInitialState, step } from "./simulate";
```

with:

```ts
import { describe, expect, it } from "vitest";

import { byRatio, fx, mul } from "./fixed";
import { GROUNDED_ZERO_LAUNCH_RATIO, LAUNCH_SPEED_RATIO } from "./constants";
import { hashState } from "./hash";
import { cloneState, createInitialState, step } from "./simulate";
```

Append to the end of `src/engine/combat.test.ts`:

```ts
/* ------------------------------------------- Task 3: Sakurai angle -- */

describe("the Sakurai angle through a real hit (Plan 3, Task 3)", () => {
  const sakuraiDef: FighterDef = {
    ...BASE_DEF,
    moves: { ...BASE_DEF.moves, jab1: move("jab1", { hitboxes: [hitbox({ angle: fx(361), baseKnockback: fx(10) })] }) },
  };
  const ctx = ctxFor(sakuraiDef);

  function angleAgainst(percent: number, airborne: boolean): number {
    const s = standing(ctx);
    s.fighters[1].damage = fx(percent);
    if (airborne) {
      s.fighters[1].grounded = false;
      s.fighters[1].platform = -1;
      s.fighters[1].y = fx(1);
      s.fighters[1].action = "fall";
    }
    const hit = play(s, 8, JAB, ctx).flatMap((f) => f.events.hits)[0];
    return hit.angle;
  }

  it("slides a lightly hit grounded victim along the floor", () => {
    expect(angleAgainst(0, false)).toBe(0);
  });

  it("lifts a heavily hit grounded victim at 38 degrees", () => {
    expect(angleAgainst(150, false)).toBe(fx(38));
  });

  it("sends an airborne victim at 38 degrees even from a light hit", () => {
    expect(angleAgainst(0, true)).toBe(fx(38));
  });
});

describe("flat launches (Plan 3, Task 3)", () => {
  /** The launch speed fighter 1 leaves the freeze with, after a 0° jab of `bkb` set knockback. */
  function launchOf(airborne: boolean): { speed: number; kb: number } {
    const flat: FighterDef = {
      ...BASE_DEF,
      moves: { ...BASE_DEF.moves, jab1: move("jab1", { hitboxes: [hitbox({ angle: 0, baseKnockback: fx(60), setKnockback: true })] }) },
    };
    const ctx = ctxFor(flat);
    const s = standing(ctx);
    if (airborne) Object.assign(s.fighters[1], { grounded: false, platform: -1, y: fx(1), action: "fall" });
    const frames = play(s, 30, JAB, ctx);
    const hit = frames.findIndex((f) => f.events.hits.length > 0);
    const released = frames.findIndex((f, i) => i > hit && f.state.fighters[1].hitlag === 0);
    return { speed: frames[released].state.fighters[1].launchSpeed, kb: frames[hit].events.hits[0].knockback };
  }

  // rubendal `js/knockback.js`: a grounded victim launched at 0° (`groundedZeroAngle`)
  // leaves at 0.8 of the launch speed.
  it("slides a grounded victim along 0° at 0.8 of the launch speed", () => {
    const grounded = launchOf(false);
    const airborne = launchOf(true);
    expect(airborne.speed).toBe(mul(airborne.kb, LAUNCH_SPEED_RATIO));
    expect(grounded.speed).toBe(mul(byRatio(grounded.kb, GROUNDED_ZERO_LAUNCH_RATIO), LAUNCH_SPEED_RATIO));
  });
});
```

In `src/engine/knockback.test.ts`, replace:

```ts

describe("resolveAngle", () => {
  it("sends a grounded victim flat and an airborne one at 44 degrees", () => {
    expect(resolveAngle({ angle: SAKURAI_ANGLE }, true)).toBe(SAKURAI_GROUNDED);
    expect(resolveAngle({ angle: SAKURAI_ANGLE }, false)).toBe(SAKURAI_AIRBORNE);
  });

  it("leaves an ordinary angle alone", () => {
    expect(resolveAngle({ angle: fx(45) }, true)).toBe(fx(45));
  });
});
```

with:

```ts

describe("resolveAngle", () => {
  // SmashWiki "Sakurai angle" (https://www.ssbwiki.com/Sakurai_angle), Ultimate:
  // aerial victims 38° at any knockback; grounded 0° up to 60 knockback, 38° from
  // 88, linear between. rubendal SSBU-Calculator `SakuraiAngle` adds the 1°
  // offset inside the ramp: min((kb − 60)/(88 − 60) × 38 + 1, 38).
  it("sends an airborne victim at 38 degrees whatever the knockback", () => {
    expect(SAKURAI_AIRBORNE).toBe(fx(38));
    for (const kb of [0, 30, 60, 74, 88, 200]) {
      expect(resolveAngle({ angle: SAKURAI_ANGLE }, false, fx(kb))).toBe(SAKURAI_AIRBORNE);
    }
  });

  it("sends a grounded victim flat below 60 knockback and at 38 degrees from 88", () => {
    expect(resolveAngle({ angle: SAKURAI_ANGLE }, true, fx(59.99))).toBe(SAKURAI_GROUNDED);
    expect(resolveAngle({ angle: SAKURAI_ANGLE }, true, fx(88))).toBe(fx(38));
    expect(resolveAngle({ angle: SAKURAI_ANGLE }, true, fx(150))).toBe(fx(38));
  });

  it("ramps a grounded victim's angle between 60 and 88 knockback, as the calculator does", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 200, noNaN: true }), fc.boolean(), (kb, grounded) => {
        const ours = toFloat(resolveAngle({ angle: SAKURAI_ANGLE }, grounded, fx(kb)));
        const theirs = ref.sakuraiAngle(toFloat(fx(kb)), !grounded);
        expect(Math.abs(ours - theirs)).toBeLessThan(2 / ONE);
      }),
      { numRuns: 1000 },
    );
    // Worked: 74 knockback is halfway up the ramp, (74 − 60)/28 × 38 + 1 = 20°.
    expect(toFloat(resolveAngle({ angle: SAKURAI_ANGLE }, true, fx(74)))).toBeCloseTo(20, 3);
  });

  it("leaves an ordinary angle alone", () => {
    expect(resolveAngle({ angle: fx(45) }, true, fx(100))).toBe(fx(45));
  });

  // SmashWiki "Sakurai angle": "moves with a launch angle of 0 have been given the
  // Sakurai angle-like property of changing to 32 degrees if they deal 120 units of
  // knockback or more"; rubendal `js/knockback.js` applies it to 0 and 180.
  it("lifts a flat launch to 32 degrees from 120 knockback, grounded or not", () => {
    expect(resolveAngle({ angle: fx(0) }, true, fx(119.99))).toBe(fx(0));
    expect(resolveAngle({ angle: fx(0) }, true, fx(120))).toBe(fx(32));
    expect(resolveAngle({ angle: fx(0) }, false, fx(150))).toBe(fx(32));
    // A backward flat launch stays backward: 180° becomes 148° (UNVERIFIED mirror of 32°).
    expect(resolveAngle({ angle: fx(180) }, true, fx(120))).toBe(fx(148));
    expect(resolveAngle({ angle: fx(180) }, true, fx(100))).toBe(fx(180));
  });
});
```

- [ ] **Step 2: Run them**

Run: `pnpm vitest run src/engine/combat.test.ts src/engine/knockback.test.ts`
Expected: FAIL — the three `resolveAngle` cases (`expected 180224 to be 155648`: 44° where 38° is due; `expected +0 to be 155648` at 88 grounded; the property `expected 6 to be less than 0.00048828125`), `lifts a flat launch to 32 degrees from 120 knockback`, and three `combat.test.ts` cases (`lifts a heavily hit grounded victim at 38 degrees`, `sends an airborne victim at 38 degrees even from a light hit`, `slides a grounded victim along 0° at 0.8 of the launch speed` — `expected +0 to be 131072`, the constant not existing yet).

- [ ] **Step 3: Implement**

In `src/engine/constants.ts`, replace:

```ts
/** The angle value meaning "depends on whether the victim is grounded". */
export const SAKURAI_ANGLE = fx(361);
/** What the Sakurai angle resolves to, grounded and airborne. */
export const SAKURAI_GROUNDED = fx(0);
export const SAKURAI_AIRBORNE = fx(44);

/** Two hitboxes within this damage difference clank instead of trading. */
```

with:

```ts
/** The angle value meaning "depends on whether the victim is grounded". */
export const SAKURAI_ANGLE = fx(361);
/**
 * What the Sakurai angle resolves to. SmashWiki "Sakurai angle"
 * (https://www.ssbwiki.com/Sakurai_angle), Ultimate: an airborne victim always
 * goes at 38°; a grounded one goes flat below 60 knockback, at 38° from 88, and
 * on a linear ramp between — rubendal SSBU-Calculator `SakuraiAngle`:
 * `min((kb − 60)/(88 − 60) × 38 + 1, 38)`.
 */
export const SAKURAI_GROUNDED = fx(0);
export const SAKURAI_AIRBORNE = fx(38);
export const SAKURAI_KB_LOW = fx(60);
export const SAKURAI_KB_HIGH = fx(88);
/**
 * A flat launch (0°) of 120 knockback or more goes out at 32° instead
 * (SmashWiki "Sakurai angle", Ultimate; rubendal `js/knockback.js`, which
 * applies it to 0° and 180°). For 180° the replica uses the mirror, 148°, so a
 * backward launch stays backward — UNVERIFIED: rubendal sets 32° for both.
 */
export const FLAT_LIFT_KB = fx(120);
export const FLAT_LIFT_ANGLE = fx(32);
/**
 * A grounded victim launched at 0° leaves at 0.8 of the launch speed
 * (rubendal `js/knockback.js`, `groundedZeroAngle`).
 */
export const GROUNDED_ZERO_LAUNCH_RATIO: Ratio = [4, 5];

/** Two hitboxes within this damage difference clank instead of trading. */
```

In `src/engine/knockback.ts`, replace:

```ts
  SAKURAI_ANGLE,
  SAKURAI_GROUNDED,
  SAKURAI_AIRBORNE,
  STALE_QUEUE_LENGTH,
  STALE_KNOCKBACK_DAMPING,
```

with:

```ts
  SAKURAI_ANGLE,
  SAKURAI_GROUNDED,
  FLAT_LIFT_ANGLE,
  FLAT_LIFT_KB,
  SAKURAI_AIRBORNE,
  SAKURAI_KB_HIGH,
  SAKURAI_KB_LOW,
  STALE_QUEUE_LENGTH,
  STALE_KNOCKBACK_DAMPING,
```

In `src/engine/knockback.ts`, replace:

```ts
 * Resolve the Sakurai angle (361) against the victim's situation.
 *
 * 361 is not a direction, it is an instruction: launch a grounded victim flat
 * along the ground so they slide and can be followed up, and a airborne one at
 * 44° so they are actually sent somewhere. Jab and most tilts use it, which is
 * why the same move combos on the ground and edgeguards in the air.
 */
export function resolveAngle(hitbox: Pick<Hitbox, "angle">, victimGrounded: boolean): number {
  if (hitbox.angle === SAKURAI_ANGLE) {
    return victimGrounded ? SAKURAI_GROUNDED : SAKURAI_AIRBORNE;
  }
  return hitbox.angle;
}

```

with:

```ts
 * Resolve the Sakurai angle (361) against the victim's situation.
 *
 * 361 is not a direction, it is an instruction: launch an airborne victim at
 * 38°, and a grounded one flat when the hit is weak — so they slide and can be
 * followed up — rising to the same 38° as the hit gets strong enough to kill.
 * `kb` is the hit's knockback, fixed-point. See `SAKURAI_AIRBORNE`.
 */
export function resolveAngle(hitbox: Pick<Hitbox, "angle">, victimGrounded: boolean, kb: number): number {
  if (hitbox.angle !== SAKURAI_ANGLE) {
    // A strong flat launch is lifted to 32° (mirrored for a backward one).
    if (kb >= FLAT_LIFT_KB && hitbox.angle === 0) return FLAT_LIFT_ANGLE;
    if (kb >= FLAT_LIFT_KB && hitbox.angle === fx(180)) return fx(180) - FLAT_LIFT_ANGLE;
    return hitbox.angle;
  }
  if (!victimGrounded) return SAKURAI_AIRBORNE;
  if (kb < SAKURAI_KB_LOW) return SAKURAI_GROUNDED;
  if (kb >= SAKURAI_KB_HIGH) return SAKURAI_AIRBORNE;
  // (kb − 60)/28 × 38 + 1, one truncation, capped at 38.
  const ramp = mulDiv(kb - SAKURAI_KB_LOW, SAKURAI_AIRBORNE, SAKURAI_KB_HIGH - SAKURAI_KB_LOW) + ONE;
  return ramp > SAKURAI_AIRBORNE ? SAKURAI_AIRBORNE : ramp;
}

```

In `src/engine/simulate.ts`, replace:

```ts
 */

import { ONE, fx, mul, abs, randomInt, nextRandom } from "./fixed";
import {
  FINAL_SMASH_STANDBY,
  LEDGE_REGRAB_LIMIT,
  ONE_ON_ONE_MULTIPLIER,
```

with:

```ts
 */

import { ONE, fx, mul, abs, byRatio, randomInt, nextRandom } from "./fixed";
import {
  FINAL_SMASH_STANDBY,
  GROUNDED_ZERO_LAUNCH_RATIO,
  LEDGE_REGRAB_LIMIT,
  ONE_ON_ONE_MULTIPLIER,
```

In `src/engine/simulate.ts`, replace:

```ts
  const sourceFacing = c.projectile !== null ? c.projectile.facing : attacker.facing;
  victim.pendingKnockback = kb;
  victim.pendingAngle = resolveAngle(hb, victim.grounded);
  victim.pendingFacing = sourceFacing >= 0 ? 1 : -1;

```

with:

```ts
  const sourceFacing = c.projectile !== null ? c.projectile.facing : attacker.facing;
  victim.pendingKnockback = kb;
  victim.pendingAngle = resolveAngle(hb, victim.grounded, kb);
  // A grounded victim launched flat slides out at 0.8 of the speed (rubendal
  // `groundedZeroAngle`); the hitstun is the hit's, already decided above.
  if (victim.grounded && victim.pendingAngle === 0) victim.pendingKnockback = byRatio(kb, GROUNDED_ZERO_LAUNCH_RATIO);
  victim.pendingFacing = sourceFacing >= 0 ? 1 : -1;

```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/engine/combat.test.ts src/engine/knockback.test.ts`
Expected: PASS.

- [ ] **Step 5: The golden trace**

Run: `pnpm vitest run src/game/golden.test.ts`
Expected before regenerating: FAIL in all four matches — jabs, tilts and flat launches now go out at the published angles and speeds. Regenerate.

```bash
UPDATE_GOLDEN=1 pnpm vitest run src/game/golden.test.ts
pnpm vitest run src/game/golden.test.ts
```

Expected: the second run PASSes. This task changes behaviour on purpose; its commit says so.

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0 (`pnpm lint` reports only the two pre-existing warnings in `research/rebuild-2026-10/tools/sim_bench.mjs`).

- [ ] **Step 7: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/src/engine/combat.test.ts \
  super-smash/src/engine/constants.ts \
  super-smash/src/engine/knockback.test.ts \
  super-smash/src/engine/knockback.ts \
  super-smash/src/engine/simulate.ts \
  super-smash/src/game/__golden__/engine-trace.json
git commit -m "super-smash: the Sakurai angle is 38° airborne and ramps on the ground" -m "SmashWiki 'Sakurai angle' (Ultimate) and rubendal SakuraiAngle: grounded 0° below 60 knockback, 38° from 88, linear between; a flat launch of 120+ goes out at 32°; a grounded 0° launch at 0.8 speed (rubendal groundedZeroAngle). Golden trace regenerated." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: DI is linear in the perpendicular stick, tumble-only, and skips straight-ahead launches; LSI's dead zones are strict

`applyDI` squared the perpendicular component; rubendal's `DI` (the calculator the reference port matches) is linear: `variation = |X·ly − Y·lx| / |L|`, deviation `0.17 × variation`. DI and LSI act only on a launch that tumbles and is not within 0.17 rad of straight ahead (measured on the signed angle, so straight *behind* is not exempt): rubendal's Sm4sh-Calculator wiki, "DI and LSI calculation" — "Conditions for DI: … the attack causes tumble; launch angle is greater than 9.74°" — which Ultimate keeps (SmashWiki "Directional influence": Ultimate "reuses the directional influence mechanics" of Smash 4), and rubendal's SSBU `js/knockback.js` computes LSI only inside `di_able`. So jabs and tilts are not DI'd. LSI's dead zones are strict inequalities (65° and 115° themselves are influenced).

Plan 1's soft-stick semantics are kept exactly: `Btn.Soft` still quarters the deviation (`full >> SOFT_DI_SHIFT`). Under the linear rule that equals a stick at a quarter of its throw — still UNVERIFIED, as D54 says. Plan 1 Task 15's `applyDI with a soft stick` tests launch at 0°, which is now un-DI-able, so they move to a 90° launch with a sideways stick; the assertions are otherwise Plan 1's. (Those anchors exist only once Plan 1 Task 15's tests are in `knockback.test.ts`; if Plan 1 lands without them, add the rewritten block as new.) `stickSensibility` (rubendal's 24/120 dead zone) is added for the day an analog value reaches `InputFrame`; nothing calls it yet. `simulate.test.ts`'s `launched` helper starts the victim at 150% so its DI cases still tumble.

**Files:**
- Modify: `super-smash/src/engine/combat.test.ts`
- Modify: `super-smash/src/engine/constants.ts`
- Modify: `super-smash/src/engine/knockback.test.ts`
- Modify: `super-smash/src/engine/knockback.ts`
- Modify: `super-smash/src/engine/simulate.test.ts`
- Modify: `super-smash/src/engine/simulate.ts`
- Modify: `super-smash/src/game/__golden__/engine-trace.json` (regenerated by a command in this task)

**Interfaces:** Changes: `applyDI(angleFx, stickX, stickY, soft = false)` — same signature, linear, skips |angle| < 0.17 rad; `applyLSI` — strict dead zones. Adds `launchDiAble(angleFx: number): boolean`, `stickSensibility(raw: number): number` (Q12), `DI_STICK_DEAD_ZONE = 24`, `DI_STICK_FULL = 120`. `releasePendingLaunch` applies DI and LSI only when the launch tumbles and `launchDiAble`.

- [ ] **Step 1: Write the failing tests**

Append to the end of `src/engine/combat.test.ts`:

```ts
/* ------------------------------------------------------ Task 4: DI -- */

describe("DI needs a tumbling launch (Plan 3, Task 4)", () => {
  /** Fighter 1's launch velocity after fighter 0's jab, holding `held` once it is frozen in hitlag. */
  function launchAfter(percent: number, held: InputFrame): { vx: number; vy: number } {
    let s = standing();
    s.fighters[1].damage = fx(percent);
    let prev: readonly InputFrame[] = [0, 0];
    for (let i = 0; i < 30; i++) {
      const now = [i === 0 ? Btn.Attack : 0, s.fighters[1].hitlag > 0 ? held : 0];
      s = step(s, now, { prevInputs: prev, ctx: ctxFor() }).state;
      prev = now;
      if (s.fighters[1].launchSpeed > 0) break;
    }
    return { vx: s.fighters[1].kinetic.damageX, vy: s.fighters[1].kinetic.damageY };
  }

  // rubendal SSBU-Calculator `js/knockback.js`: `di_able = tumble && |angle| ≥ 0.17`.
  it("ignores the stick on a hit too weak to tumble", () => {
    expect(launchAfter(0, Btn.Down)).toEqual(launchAfter(0, 0));
  });

  it("bends a tumbling launch", () => {
    const none = launchAfter(150, 0);
    const bent = launchAfter(150, Btn.Down);
    expect(bent.vy).toBeLessThan(none.vy);
  });
  // LSI is computed inside `di_able` too: a tumbling launch straight ahead keeps its speed.
  it("does not scale a tumbling launch straight ahead with LSI", () => {
    const flat: FighterDef = {
      ...BASE_DEF,
      moves: { ...BASE_DEF.moves, jab1: move("jab1", { hitboxes: [hitbox({ angle: 0, baseKnockback: fx(100), setKnockback: true })] }) },
    };
    const speedHolding = (held: InputFrame): number => {
      let s = standing(ctxFor(flat));
      Object.assign(s.fighters[1], { grounded: false, platform: -1, y: fx(1), action: "fall" });
      let prev: readonly InputFrame[] = [0, 0];
      for (let i = 0; i < 30; i++) {
        const now = [i === 0 ? Btn.Attack : 0, s.fighters[1].hitlag > 0 ? held : 0];
        s = step(s, now, { prevInputs: prev, ctx: ctxFor(flat) }).state;
        prev = now;
        if (s.fighters[1].launchSpeed > 0) break;
      }
      return s.fighters[1].launchSpeed;
    };
    expect(speedHolding(Btn.Up)).toBe(speedHolding(0));
  });
});
```

In `src/engine/knockback.test.ts`, replace:

```ts
import fc from "fast-check";

import { ONE, fx, toFloat } from "./fixed";
import {
  BALLOON_ANGLE_MAX,
```

with:

```ts
import fc from "fast-check";

import { ONE, cosDeg, fx, sinDeg, toFloat } from "./fixed";
import {
  BALLOON_ANGLE_MAX,
```

In `src/engine/knockback.test.ts`, replace:

```ts
  normalizeAngle,
  resolveAngle,
  toWorldAngle,
} from "./knockback";
```

with:

```ts
  normalizeAngle,
  resolveAngle,
  stickSensibility,
  toWorldAngle,
} from "./knockback";
```

In `src/engine/knockback.test.ts`, replace:

```ts

  it("bends the angle by the full 9.74 degrees at perpendicular", () => {
    const bent = applyDI(fx(0), 0, 1);
    expect(toFloat(bent - fx(0))).toBeCloseTo(toFloat(DI_MAX_DEVIATION), 2);
  });

  it("bends the other way for the opposite perpendicular", () => {
    expect(applyDI(fx(0), 0, -1)).toBeLessThan(fx(0));
  });

```

with:

```ts

  it("bends the angle by the full 9.74 degrees at perpendicular", () => {
    const bent = applyDI(fx(90), -1, 0);
    expect(toFloat(bent - fx(90))).toBeCloseTo(toFloat(DI_MAX_DEVIATION), 2);
  });

  it("bends the other way for the opposite perpendicular", () => {
    expect(applyDI(fx(90), 1, 0)).toBeLessThan(fx(90));
  });

  // rubendal SSBU-Calculator `DI`: "Cannot DI if launch angle is less than DI
  // angle change param" — |atan2(ly, lx)| < 0.17 rad, so a launch straight ahead.
  it("leaves a launch within 0.17 rad of straight ahead alone", () => {
    expect(applyDI(fx(0), 0, 1)).toBe(fx(0));
    expect(applyDI(fx(9), 0, -1)).toBe(fx(9));
    expect(applyDI(fx(352), 0, 1)).toBe(fx(352));
    // …but not straight behind: atan2 of a backward launch is near ±π.
    expect(applyDI(fx(180), 0, 1)).not.toBe(fx(180));
  });

  // SmashWiki "Directional influence" (https://www.ssbwiki.com/Directional_influence):
  // at most 0.17 rad, less as the stick is tilted less. rubendal `DI`:
  // `variation = |X·ly − Y·lx| / |L|`, linear — not squared.
  it("bends a diagonal stick linearly, by the sine of its angle to the launch", () => {
    const bent = toFloat(applyDI(fx(90), -1, 1) - fx(90));
    // 45° off the launch: sin 45° = 0.7071 of the full bend (squared would be 0.5).
    expect(bent).toBeCloseTo(9.74 * 0.7071, 1);
  });

  it("matches the reference port for every launch angle and digital stick", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 359 }),
        fc.integer({ min: -1, max: 1 }),
        fc.integer({ min: -1, max: 1 }),
        (deg, sx, sy) => {
          const diag = sx !== 0 && sy !== 0 ? Math.SQRT1_2 : 1;
          const lx = toFloat(cosDeg(fx(deg)));
          const ly = toFloat(sinDeg(fx(deg)));
          const theirs = (ref.di(lx, ly, sx * diag, sy * diag) * 180) / Math.PI;
          const ours = toFloat(applyDI(fx(deg), sx, sy));
          const d = ((((ours - theirs) % 360) + 540) % 360) - 180;
          expect(Math.abs(d)).toBeLessThan(0.02);
        },
      ),
      { numRuns: 2000 },
    );
  });

```

In `src/engine/knockback.test.ts`, replace:

```ts
});

describe("applyLSI", () => {
  it("scales a horizontal launch up by 1.095 and down by 0.92", () => {
```

with:

```ts
});

describe("stickSensibility", () => {
  // rubendal SSBU-Calculator `StickSensibility`: |v| < 24 reads 0, beyond 120
  // reads full, v/120 between — the 24/120 dead zone DI and LSI read through.
  it.each([
    [0, 0],
    [23, 0],
    [-23, 0],
    [24, 0.2],
    [60, 0.5],
    [-60, -0.5],
    [120, 1],
    [127, 1],
    [-128, -1],
  ])("reads raw %i as %f", (raw, expected) => {
    expect(toFloat(stickSensibility(raw))).toBeCloseTo(expected, 3);
  });
});

describe("applyLSI", () => {
  it("scales a horizontal launch up by 1.095 and down by 0.92", () => {
```

In `src/engine/knockback.test.ts`, replace:

```ts
  it("mirrors the dead zone for a straight-down launch", () => {
    expect(applyLSI(fx(10), 1, fx(270))).toBe(fx(10));
  });

```

with:

```ts
  it("mirrors the dead zone for a straight-down launch", () => {
    expect(applyLSI(fx(10), 1, fx(270))).toBe(fx(10));
  });

  // SmashWiki "Directional influence": "LSI has no effect if the launch angle is
  // between 65° and 115°, or between 245° and 295°"; rubendal `LSI` uses strict
  // inequalities, so 65° and 115° themselves are still influenced.
  it("still scales a launch at exactly 65 or 115 degrees, as the calculator does", () => {
    for (const deg of [65, 115, 245, 295]) {
      for (const sy of [-1, 1]) {
        expect(toFloat(applyLSI(fx(10), sy, fx(deg)))).toBeCloseTo(10 * ref.lsi(sy, deg), 2);
      }
    }
  });

```

In `src/engine/knockback.test.ts`, replace:

```ts

describe("applyDI with a soft stick", () => {
  it("bends a quarter as far as a full perpendicular push", () => {
    const full = applyDI(fx(0), 0, 1) - fx(0);
    const soft = applyDI(fx(0), 0, 1, true) - fx(0);
    expect(SOFT_DI_SHIFT).toBe(2);
    expect(soft).toBe(full >> SOFT_DI_SHIFT);
```

with:

```ts

describe("applyDI with a soft stick", () => {
  // Plan 1 (D54): Btn.Soft quarters the DI. Under the linear rule a quarter of
  // the bend is a stick at a quarter of its throw (UNVERIFIED, as D54 says).
  // Straight up, because a launch straight ahead cannot be DI'd at all.
  it("bends a quarter as far as a full perpendicular push", () => {
    const full = applyDI(fx(90), -1, 0) - fx(90);
    const soft = applyDI(fx(90), -1, 0, true) - fx(90);
    expect(SOFT_DI_SHIFT).toBe(2);
    expect(soft).toBe(full >> SOFT_DI_SHIFT);
```

In `src/engine/knockback.test.ts`, replace:

```ts

  it("bends the other way just as softly", () => {
    expect(applyDI(fx(0), 0, -1, true) - fx(0)).toBe(-((applyDI(fx(0), 0, 1) - fx(0)) >> SOFT_DI_SHIFT));
  });

```

with:

```ts

  it("bends the other way just as softly", () => {
    expect(applyDI(fx(90), 1, 0, true) - fx(90)).toBe(-((applyDI(fx(90), -1, 0) - fx(90)) >> SOFT_DI_SHIFT));
  });

```

In `src/engine/simulate.test.ts`, replace:

```ts
function launched(atContact: InputFrame, afterContact: InputFrame) {
  let s = standing();
  let prev: readonly InputFrame[] = [0, 0];
  let hitAt = -1;
```

with:

```ts
function launched(atContact: InputFrame, afterContact: InputFrame) {
  let s = standing();
  // Heavy enough to tumble: DI and LSI only bend a tumbling launch (Plan 3, Task 4).
  s.fighters[1].damage = fx(150);
  let prev: readonly InputFrame[] = [0, 0];
  let hitAt = -1;
```

- [ ] **Step 2: Run them**

Run: `pnpm vitest run src/engine/combat.test.ts src/engine/knockback.test.ts src/engine/simulate.test.ts`
Expected: FAIL — `leaves a launch within 0.17 rad of straight ahead alone` (`expected 39895 to be +0`), `bends a diagonal stick linearly` (`expected 4.867… to be close to 6.887…`), the reference-port property, the nine `stickSensibility` cases (`stickSensibility is not a function`), `still scales a launch at exactly 65 or 115 degrees` (`expected 10 to be close to 9.2`), `ignores the stick on a hit too weak to tumble` (`expected { vx: 6305, vy: 5308 } to deeply equal { vx: 5828, vy: 5828 }`), and `does not scale a tumbling launch straight ahead with LSI` (`expected 13468 to be 12300`).

- [ ] **Step 3: Implement**

In `src/engine/constants.ts`, replace:

```ts
export const OFFSCREEN_DAMAGE_CEILING = fx(150);

/** DI can deviate the launch angle by at most this much. */
export const DI_MAX_DEVIATION = fx(9.74);
export const SOFT_DI_SHIFT = 2;
/** Holding up or down at launch scales launch speed. */
```

with:

```ts
export const OFFSCREEN_DAMAGE_CEILING = fx(150);

/**
 * DI can deviate the launch angle by at most 0.17 rad (9.74°), and a launch
 * within 0.17 rad of straight ahead cannot be DI'd. SmashWiki "Directional
 * influence"; rubendal SSBU-Calculator `parameters.di = 0.17`.
 */
export const DI_MAX_DEVIATION = fx(9.74);
/** Raw stick dead zone and full-throw value for DI/LSI (rubendal `StickSensibility`). */
export const DI_STICK_DEAD_ZONE = 24;
export const DI_STICK_FULL = 120;
export const SOFT_DI_SHIFT = 2;
/** Holding up or down at launch scales launch speed. */
```

In `src/engine/knockback.ts`, replace:

```ts
  STALE_KNOCKBACK_DAMPING,
  DI_MAX_DEVIATION,
  SOFT_DI_SHIFT,
  LSI_UP,
```

with:

```ts
  STALE_KNOCKBACK_DAMPING,
  DI_MAX_DEVIATION,
  DI_STICK_DEAD_ZONE,
  DI_STICK_FULL,
  SOFT_DI_SHIFT,
  LSI_UP,
```

In `src/engine/knockback.ts`, replace:

```ts

/**
 * Directional Influence: bend the launch angle by up to 9.74° toward perpendicular.
 *
 * The lever is the component of the stick *perpendicular* to the launch — pushing
 * along the launch direction does nothing at all, pushing square to it does
 * everything — and the game squares that component before scaling, so DI falls
 * off quickly as you drift off perpendicular. This is the single defensive
 * mechanic that decides whether a hit at 120% kills, so it has to be exact.
 *
 * `angleFx` and the stick must be in the same frame of reference; the simulation
```

with:

```ts

/**
 * A raw stick axis (−128…127) as the game reads it for DI and LSI: nothing
 * inside ±24, full from ±120, linear between. rubendal SSBU-Calculator
 * `StickSensibility`. The keyboard and Plan 1's gamepad bits only ever reach
 * the engine as full (or `Btn.Soft`) deflection, so `applyDI` never needs it
 * today; it is here for an analog stick value, should one reach `InputFrame`.
 */
export function stickSensibility(raw: number): number {
  if (raw > -DI_STICK_DEAD_ZONE && raw < DI_STICK_DEAD_ZONE) return 0;
  if (raw > DI_STICK_FULL) return ONE;
  if (raw < -DI_STICK_FULL) return -ONE;
  return Math.trunc((raw * ONE) / DI_STICK_FULL);
}

/**
 * Whether a launch's angle admits DI and LSI at all: not within 0.17 rad of
 * straight ahead, measured on the signed angle (rubendal: "Cannot DI if launch
 * angle is less than DI angle change param"). Straight *behind* is DI-able.
 */
export function launchDiAble(angleFx: number): boolean {
  const a = normalizeAngle(angleFx);
  const signed = a > fx(180) ? a - TURN : a;
  return signed <= -DI_MAX_DEVIATION || signed >= DI_MAX_DEVIATION;
}

/**
 * Directional Influence: bend the launch angle by up to 0.17 rad (9.74°).
 *
 * The lever is the component of the stick *perpendicular* to the launch —
 * pushing along the launch direction does nothing at all, pushing square to it
 * does everything — and the bend is **linear** in that component (rubendal
 * SSBU-Calculator `DI`: `variation = |X·ly − Y·lx| / |L|`; SmashWiki
 * "Directional influence": a smaller tilt, a weaker deviation). A launch within
 * 0.17 rad of straight ahead cannot be DI'd at all (rubendal: "Cannot DI if
 * launch angle is less than DI angle change param") — measured on the signed
 * angle, so a launch straight *behind* is not exempt.
 *
 * `soft` is Plan 1's `Btn.Soft` (D54): the bend is quartered
 * (`SOFT_DI_SHIFT`), which under the linear rule is a stick at a quarter of its
 * throw — UNVERIFIED, as D54 says: the bit carries one level of magnitude.
 *
 * `angleFx` and the stick must be in the same frame of reference; the simulation
```

In `src/engine/knockback.ts`, replace:

```ts
export function applyDI(angleFx: number, stickX: number, stickY: number, soft = false): number {
  if (stickX === 0 && stickY === 0) return angleFx;
  const u = unitStick(stickX, stickY);
  // Cross product of the launch direction with the stick: the signed sine of the
  // angle between them, which is exactly the perpendicular component.
  const perp = mul(cosDeg(angleFx), u.y) - mul(sinDeg(angleFx), u.x);
  const full = mul(DI_MAX_DEVIATION, mul(perp, perp));
  const deviation = soft ? full >> SOFT_DI_SHIFT : full;
  return angleFx + (perp >= 0 ? deviation : -deviation);
}

```

with:

```ts
export function applyDI(angleFx: number, stickX: number, stickY: number, soft = false): number {
  if (stickX === 0 && stickY === 0) return angleFx;
  if (!launchDiAble(angleFx)) return angleFx;
  const a = normalizeAngle(angleFx);
  const u = unitStick(stickX, stickY);
  // Cross product of the launch direction with the stick: the signed sine of the
  // angle between them, which is exactly the perpendicular component.
  const perp = mul(cosDeg(a), u.y) - mul(sinDeg(a), u.x);
  const full = mul(DI_MAX_DEVIATION, perp < 0 ? -perp : perp);
  const deviation = soft ? full >> SOFT_DI_SHIFT : full;
  return angleFx + (perp < 0 ? -deviation : deviation);
}

```

In `src/engine/knockback.ts`, replace:

```ts
 * Up is 1.095× and down 0.92×, which is why survival DI on a horizontal launch is
 * "away and down" rather than just "away". Near-vertical launches are exempt —
 * the 65°–115° dead zone, and its downward mirror — because otherwise every
 * up-throw kill would be decided by whether the victim happened to be holding
 * down, which is not a decision anybody could make in three frames.
 */
export function applyLSI(launchSpeed: number, stickY: number, angleFx: number): number {
  if (stickY === 0) return launchSpeed;
  const a = normalizeAngle(angleFx);
  const inUpDeadZone = a >= LSI_DEAD_ZONE[0] && a <= LSI_DEAD_ZONE[1];
  const inDownDeadZone = a >= TURN - LSI_DEAD_ZONE[1] && a <= TURN - LSI_DEAD_ZONE[0];
  if (inUpDeadZone || inDownDeadZone) return launchSpeed;
  return mul(launchSpeed, stickY > 0 ? LSI_UP : LSI_DOWN);
```

with:

```ts
 * Up is 1.095× and down 0.92×, which is why survival DI on a horizontal launch is
 * "away and down" rather than just "away". Near-vertical launches are exempt —
 * strictly between 65° and 115°, and its downward mirror 245°–295° (SmashWiki
 * "Directional influence"; rubendal `LSI` uses strict inequalities) — because
 * otherwise every up-throw kill would be decided by whether the victim happened
 * to be holding down, which is not a decision anybody could make in three frames.
 */
export function applyLSI(launchSpeed: number, stickY: number, angleFx: number): number {
  if (stickY === 0) return launchSpeed;
  const a = normalizeAngle(angleFx);
  const inUpDeadZone = a > LSI_DEAD_ZONE[0] && a < LSI_DEAD_ZONE[1];
  const inDownDeadZone = a > TURN - LSI_DEAD_ZONE[1] && a < TURN - LSI_DEAD_ZONE[0];
  if (inUpDeadZone || inDownDeadZone) return launchSpeed;
  return mul(launchSpeed, stickY > 0 ? LSI_UP : LSI_DOWN);
```

In `src/engine/simulate.ts`, replace:

```ts
  applyDI,
  applyLSI,
  lsiApplies,
  knockbackToVelocity,
```

with:

```ts
  applyDI,
  applyLSI,
  launchDiAble,
  lsiApplies,
  knockbackToVelocity,
```

In `src/engine/simulate.ts`, replace:

```ts
  const facing = f.pendingFacing;
  const relStick = intent.x * (facing >= 0 ? 1 : -1);
  const angle = applyDI(f.pendingAngle, relStick, intent.y, intent.soft);
  const launch = knockbackToVelocity(f.pendingKnockback, angle, facing);
  // LSI is a survival tool, not a damage buff: it only touches knockback heavy
```

with:

```ts
  const facing = f.pendingFacing;
  const relStick = intent.x * (facing >= 0 ? 1 : -1);
  // DI and LSI only act on a launch that tumbles and is not within 0.17 rad of
  // straight ahead (rubendal Sm4sh-Calculator wiki "DI and LSI calculation",
  // https://github.com/rubendal/Sm4sh-Calculator/wiki/DI-and-LSI-calculation:
  // "Conditions for DI: … the attack causes tumble; launch angle is greater than
  // 9.74°" — Ultimate "reuses the directional influence mechanics" of Smash 4,
  // SmashWiki "Directional influence"; rubendal SSBU-Calculator `js/knockback.js`
  // computes LSI only inside `di_able`). `hitstun` still holds the hit's full value.
  const diAble = lsiApplies(f.hitstun) && launchDiAble(f.pendingAngle);
  const angle = diAble ? applyDI(f.pendingAngle, relStick, intent.y, intent.soft) : f.pendingAngle;
  const launch = knockbackToVelocity(f.pendingKnockback, angle, facing);
  // LSI is a survival tool, not a damage buff: it only touches knockback heavy
```

In `src/engine/simulate.ts`, replace:

```ts
  // have. `hitstun` still holds the full value from the hit here — the hitlag
  // branch that leads to this call never decrements it. See `lsiApplies`.
  const speed = lsiApplies(f.hitstun) ? applyLSI(launch.speed, intent.y, angle) : launch.speed;
  // The one moment the balloon question has an answer: the angle this launch
  // actually goes out at, DI included. See `FighterState.balloon`.
```

with:

```ts
  // have. `hitstun` still holds the full value from the hit here — the hitlag
  // branch that leads to this call never decrements it. See `lsiApplies`.
  const speed = diAble ? applyLSI(launch.speed, intent.y, angle) : launch.speed;
  // The one moment the balloon question has an answer: the angle this launch
  // actually goes out at, DI included. See `FighterState.balloon`.
```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/engine/combat.test.ts src/engine/knockback.test.ts src/engine/simulate.test.ts`
Expected: PASS.

- [ ] **Step 5: The golden trace**

Run: `pnpm vitest run src/game/golden.test.ts`
Expected before regenerating: FAIL in all four matches — the CPUs hold directions through hitlag, and DI is now linear and tumble-only. Regenerate.

```bash
UPDATE_GOLDEN=1 pnpm vitest run src/game/golden.test.ts
pnpm vitest run src/game/golden.test.ts
```

Expected: the second run PASSes. This task changes behaviour on purpose; its commit says so.

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0 (`pnpm lint` reports only the two pre-existing warnings in `research/rebuild-2026-10/tools/sim_bench.mjs`).

- [ ] **Step 7: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/src/engine/combat.test.ts \
  super-smash/src/engine/constants.ts \
  super-smash/src/engine/knockback.test.ts \
  super-smash/src/engine/knockback.ts \
  super-smash/src/engine/simulate.test.ts \
  super-smash/src/engine/simulate.ts \
  super-smash/src/game/__golden__/engine-trace.json
git commit -m "super-smash: DI is linear, tumble-only and skips straight-ahead launches" -m "rubendal DI: variation = |X·ly − Y·lx|/|L|. DI and LSI only on a tumbling launch more than 0.17 rad off straight ahead (rubendal Sm4sh-Calculator wiki). LSI dead zones strict. Btn.Soft still quarters the bend (D54). Golden trace regenerated." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Hitstun: a 4-frame minimum, and the balloon speed-up arithmetic

The base hitstun becomes rubendal's `Hitstun` exactly: `floor(max(KB × 0.4, 5)) − 1`, at least 4 frames (SmashWiki "Hitstun": "a minimum of 4 frames"), with the 0.4 slope at any knockback. The old "(KB − 200) × 0.25" overflow rule moves where it belongs: it is what the balloon speed-up does to a launch past 200, not part of the base.

The speed-up itself is rubendal's port of `FighterStatusDamage_init_damage_speed_up`: a launch of `faf` reaction frames (`base + 1`) starts at `lerp(1, 6, clamp((faf − 30)/50))` and each real frame consumes `damageSpeedUpMag` reaction frames, falling to 1× once 70% of them are spent. This task adds the pure functions and pins them against `research/rebuild-2026-10/tools/ssbu_ref.mjs` at every quarter-knockback up to 500, against SmashWiki's 90 → 33 and 145 → 41, and against the "(KB − 200) × 0.25" slope within a frame. Q12 matches the float reference exactly for every launch up to 500 knockback (reaction frames ≤ 200); past that the two can differ by a frame. Task 6 puts it in the sim.

**Files:**
- Modify: `super-smash/src/engine/constants.ts`
- Modify: `super-smash/src/engine/knockback.test.ts`
- Modify: `super-smash/src/engine/knockback.ts`
- Modify: `super-smash/src/game/__golden__/engine-trace.json` (regenerated by a command in this task)

**Interfaces:** Changes: `computeHitstun(kb)` — minimum 4, no overflow branch. Adds:
```ts
export function damageSpeedUpMaxMag(faf: number): number;           // Q12, ONE..6·ONE
export function damageSpeedUpMag(frame: number, faf: number, maxMag: number): number; // Q12
export function effectiveHitstun(kb: number, speedUp: boolean): number; // real frames
export const HITSTUN_MIN_FAF = 5, SPEED_UP_FAF_MIN = 30, SPEED_UP_FAF_MAX = 80, SPEED_UP_MAX_MAG = 6;
```
Removes `LAUNCH_SPEED_CAP_KB` and `HITSTUN_OVERFLOW_RATIO` (no other reader).

- [ ] **Step 1: Write the failing tests**

In `src/engine/knockback.test.ts`, replace:

```ts
  computeShieldstun,
  computeStaleness,
  knockbackToVelocity,
  normalizeAngle,
```

with:

```ts
  computeShieldstun,
  computeStaleness,
  damageSpeedUpMag,
  damageSpeedUpMaxMag,
  effectiveHitstun,
  knockbackToVelocity,
  normalizeAngle,
```

In `src/engine/knockback.test.ts`, replace:

```ts
  });

  it("grows at 0.25 per unit past 200 knockback", () => {
    // 200*0.4 = 80, then (300-200)*0.25 = 25, minus Ultimate's extra frame.
    expect(computeHitstun(fx(300))).toBe(104);
  });

  it("never goes negative", () => {
    expect(computeHitstun(0)).toBe(0);
    expect(computeHitstun(fx(1))).toBe(0);
  });

```

with:

```ts
  });

  // rubendal SSBU-Calculator `Hitstun`: the base is floor(kb × 0.4) − 1 at any
  // knockback. The shallower slope past 200 is what the balloon speed-up does to
  // it (`effectiveHitstun`), not part of the base.
  it("keeps the 0.4 slope past 200 knockback", () => {
    expect(computeHitstun(fx(300))).toBe(119);
  });

  // SmashWiki "Hitstun" (https://www.ssbwiki.com/Hitstun): flinching attacks
  // "always inflict a minimum of 4 frames of hitstun"; rubendal: `if (hitstun < 5) hitstun = 5`.
  it("never inflicts fewer than 4 frames", () => {
    expect(computeHitstun(0)).toBe(4);
    expect(computeHitstun(fx(1))).toBe(4);
    expect(computeHitstun(fx(12.5))).toBe(4);
    expect(computeHitstun(fx(15))).toBe(5);
  });

```

In `src/engine/knockback.test.ts`, replace:

```ts
    expect(computeHitstun(fx(100))).toBe(39);
    expect(computeHitstun(fx(200))).toBe(79);
  });
});
```

with:

```ts
    expect(computeHitstun(fx(100))).toBe(39);
    expect(computeHitstun(fx(200))).toBe(79);
  });
});

describe("the balloon speed-up (init_damage_speed_up)", () => {
  // rubendal SSBU-Calculator `InitDamageSpeedUp`: 1× at 30 frames of FAF, 6× at 80, linear between.
  it("scales its first-frame multiplier from 1x at 30 FAF to 6x at 80", () => {
    expect(damageSpeedUpMaxMag(30)).toBe(ONE);
    expect(damageSpeedUpMaxMag(55)).toBe(fx(3.5));
    expect(damageSpeedUpMaxMag(80)).toBe(fx(6));
    expect(damageSpeedUpMaxMag(200)).toBe(fx(6));
  });

  // SmashWiki "Hitstun": 90 and 145 knockback give 33 and 41 frames in
  // Ultimate (36 and 58 in Smash 4); rubendal's port gives 49 at 200 and 61 at 250.
  it.each([
    [90, 33],
    [145, 41],
    [200, 49],
    [250, 61],
  ])("turns %i knockback into %i real frames of hitstun", (kb, frames) => {
    expect(effectiveHitstun(fx(kb), true)).toBe(frames);
  });

  it("matches the reference port at every knockback up to 500", () => {
    for (let q = 0; q <= 2000; q++) {
      const kb = fx(q / 4);
      expect(effectiveHitstun(kb, true), `kb ${q / 4}`).toBe(
        Math.max(4, ref.speedUp(toFloat(kb)).framesWithSpeedUp - 1),
      );
    }
  });

  // SmashWiki "Hitstun": past 200 the effect stops scaling and hitstun grows at
  // (kb − 200) × 0.25 — which falls out of the 6× cap, within a frame.
  it("grows by (kb - 200) x 0.25 past 200, within a frame", () => {
    const at200 = effectiveHitstun(fx(200), true);
    for (let kb = 200; kb <= 500; kb += 0.25) {
      const extra = effectiveHitstun(fx(kb), true) - at200;
      expect(Math.abs(extra - Math.floor((kb - 200) * 0.25)), `kb ${kb}`).toBeLessThanOrEqual(1);
    }
  });

  it("never takes a tumbling hit below tumble", () => {
    for (let q = 330; q <= 2000; q++) {
      expect(effectiveHitstun(fx(q / 4), true)).toBeGreaterThanOrEqual(32);
    }
  });

  it("is the plain base when the hit is not sped up (set knockback, no tumble)", () => {
    expect(effectiveHitstun(fx(145), false)).toBe(computeHitstun(fx(145)));
  });

  it("walks the same schedule one real frame at a time", () => {
    for (const kb of [90, 145, 200, 250]) {
      const faf = computeHitstun(fx(kb)) + 1;
      const max = damageSpeedUpMaxMag(faf);
      let frame = faf * ONE;
      let real = 0;
      let mag = max;
      while (mag > ONE) {
        mag = damageSpeedUpMag(frame, faf, max);
        frame -= mag < ONE ? ONE : mag;
        real += 1;
      }
      real += Math.ceil(frame / ONE);
      expect(real - 1).toBe(effectiveHitstun(fx(kb), true));
    }
  });
});
```

- [ ] **Step 2: Run them**

Run: `pnpm vitest run src/engine/knockback.test.ts`
Expected: FAIL — `keeps the 0.4 slope past 200 knockback` (`expected 104 to be 119`), `never inflicts fewer than 4 frames` (`expected +0 to be 4`), and every speed-up case (`damageSpeedUpMaxMag is not a function`, `effectiveHitstun is not a function`).

- [ ] **Step 3: Implement**

In `src/engine/constants.ts`, replace:

```ts
export const LAUNCH_SPEED_DECAY = fx(0.051);

/** Above this knockback, hitstun grows by (kb - 200) * 0.25 instead. */
export const LAUNCH_SPEED_CAP_KB = fx(200);
export const HITSTUN_OVERFLOW_RATIO: Ratio = [1, 4];

/** Vertical launches (70°-110°) get a fixed fall speed — "balloon knockback". */
```

with:

```ts
export const LAUNCH_SPEED_DECAY = fx(0.051);

/**
 * A flinching hit's reaction frames never fall below 5, so hitstun never below
 * 4 (SmashWiki "Hitstun": "a minimum of 4 frames"; rubendal `Hitstun`).
 */
export const HITSTUN_MIN_FAF = 5;

/**
 * The balloon speed-up (`init_damage_speed_up`; rubendal SSBU-Calculator
 * `InitDamageSpeedUp`/`ReactionFrameMulSpeedUp`): a launch of 30 reaction
 * frames or fewer is not sped up, one of 80 or more starts at 6×, and the
 * multiplier falls to nothing once 70% of the reaction frames have passed.
 * The ">200 knockback adds (kb − 200) × 0.25" of SmashWiki "Hitstun" is this
 * schedule's 6× cap, not a separate rule.
 */
export const SPEED_UP_FAF_MIN = 30;
export const SPEED_UP_FAF_MAX = 80;
export const SPEED_UP_MAX_MAG = 6;

/** Vertical launches (70°-110°) get a fixed fall speed — "balloon knockback". */
```

In `src/engine/knockback.ts`, replace:

```ts
  KB_ADDEND,
  HITSTUN_RATIO,
  LAUNCH_SPEED_CAP_KB,
  LAUNCH_SPEED_RATIO,
  HITSTUN_OVERFLOW_RATIO,
  RAGE_START,
  RAGE_CAP,
```

with:

```ts
  KB_ADDEND,
  HITSTUN_RATIO,
  HITSTUN_MIN_FAF,
  LAUNCH_SPEED_RATIO,
  SPEED_UP_FAF_MAX,
  SPEED_UP_FAF_MIN,
  SPEED_UP_MAX_MAG,
  RAGE_START,
  RAGE_CAP,
```

In `src/engine/knockback.ts`, replace:

```ts

/**
 * `hitstun = floor(KB × 0.4) − 1`, with Ultimate's shallower slope above 200.
 *
 * The subtracted frame is Ultimate's own change and is the reason combos are
 * tighter than in Smash 4. Past 200 knockback the victim is dying anyway, so the
 * game stops paying out the full 0.4 frames per unit and grows at 0.25 instead —
 * without that, a 400-unit launch would freeze the victim for over two seconds
 * of screen time they cannot influence.
 */
export function computeHitstun(kb: number): number {
  let stunFx: number;
  if (kb <= LAUNCH_SPEED_CAP_KB) {
    stunFx = byRatio(kb, HITSTUN_RATIO);
  } else {
    stunFx =
      byRatio(LAUNCH_SPEED_CAP_KB, HITSTUN_RATIO) +
      byRatio(kb - LAUNCH_SPEED_CAP_KB, HITSTUN_OVERFLOW_RATIO);
  }
  const frames = Math.floor(stunFx / ONE) - 1;
  return frames < 0 ? 0 : frames;
}

```

with:

```ts

/**
 * `hitstun = floor(max(KB × 0.4, 5)) − 1` — the *base* hitstun, in the game's
 * own reaction frames.
 *
 * The subtracted frame is Ultimate's own change and is the reason combos are
 * tighter than in Smash 4. A flinching hit always inflicts at least 4 frames
 * (SmashWiki "Hitstun", https://www.ssbwiki.com/Hitstun; rubendal
 * SSBU-Calculator `Hitstun`: `if (hitstun < 5) hitstun = 5`). The base keeps
 * its 0.4 slope at any knockback: the real-time length of a tumbling launch is
 * `effectiveHitstun`, which is where the shallower slope past 200 comes from.
 */
export function computeHitstun(kb: number): number {
  const stunFx = byRatio(kb < 0 ? 0 : kb, HITSTUN_RATIO);
  const frames = Math.floor(stunFx / ONE);
  return (frames < HITSTUN_MIN_FAF ? HITSTUN_MIN_FAF : frames) - 1;
}

/**
 * The balloon speed-up's first-frame multiplier, Q12, for a launch whose base
 * FAF (`computeHitstun + 1`) is `faf`: 1× at 30 frames, 6× at 80, linear
 * between (rubendal SSBU-Calculator `InitDamageSpeedUp`, ported from
 * `L2CFighterCommon::FighterStatusDamage_init_damage_speed_up`:
 * `damage_fly_speed_up_reaction_frame_min/max` 30/80, `max_mag` 6). The angle
 * term there is a no-op (`damage_fly_speed_up_angle_rate` 100).
 */
export function damageSpeedUpMaxMag(faf: number): number {
  const over = clamp(faf - SPEED_UP_FAF_MIN, 0, SPEED_UP_FAF_MAX - SPEED_UP_FAF_MIN);
  return ONE + Math.trunc((ONE * (SPEED_UP_MAX_MAG - 1) * over) / (SPEED_UP_FAF_MAX - SPEED_UP_FAF_MIN));
}

/**
 * The speed-up multiplier, Q12, while `frame` (Q12) reaction frames remain of a
 * launch that started at `faf`: rubendal `ReactionFrameMulSpeedUp`,
 * `clamp((faf × 0.3 − frame) / (faf × 0.3 − faf), 0, 1) × maxMag` — full at
 * the start, falling to nothing once 70% of the reaction frames are spent
 * (`damage_fly_speed_up_end_rate` 70). One truncation.
 */
export function damageSpeedUpMag(frame: number, faf: number, maxMag: number): number {
  const num = 10 * frame - 3 * faf * ONE;
  if (num <= 0) return 0;
  const mag = Math.trunc((maxMag * num) / (7 * faf * ONE));
  return mag > maxMag ? maxMag : mag;
}

/**
 * The real frames a launch keeps its victim in hitstun — SmashWiki "Hitstun":
 * 90 and 145 knockback give 33 and 41 frames in Ultimate, not 36 and 58.
 *
 * A tumbling launch is played back faster for its first frames (the "balloon
 * knockback"): each real frame consumes `damageSpeedUpMag` reaction frames, at
 * least one, until the multiplier drops to 1×. `speedUp` is false for a hit
 * that does not tumble or has set knockback (rubendal `js/knockback.js` applies
 * the speed-up only when `tumble && !isFKB`); its hitstun is the base.
 */
export function effectiveHitstun(kb: number, speedUp: boolean): number {
  const base = computeHitstun(kb);
  if (!speedUp) return base;
  const faf = base + 1;
  const maxMag = damageSpeedUpMaxMag(faf);
  let frame = faf * ONE;
  let mag = maxMag;
  let real = 0;
  while (mag > ONE) {
    mag = damageSpeedUpMag(frame, faf, maxMag);
    frame -= mag < ONE ? ONE : mag;
    real += 1;
  }
  return real + Math.ceil(frame / ONE) - 1;
}

```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/engine/knockback.test.ts`
Expected: PASS.

- [ ] **Step 5: The golden trace**

Run: `pnpm vitest run src/game/golden.test.ts`
Expected before regenerating: FAIL in the Mario–Fox match — a hit there lands outside 12.5–200 knockback, the only places the base hitstun changed. Regenerate.

```bash
UPDATE_GOLDEN=1 pnpm vitest run src/game/golden.test.ts
pnpm vitest run src/game/golden.test.ts
```

Expected: the second run PASSes. This task changes behaviour on purpose; its commit says so.

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0 (`pnpm lint` reports only the two pre-existing warnings in `research/rebuild-2026-10/tools/sim_bench.mjs`).

- [ ] **Step 7: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/src/engine/constants.ts \
  super-smash/src/engine/knockback.test.ts \
  super-smash/src/engine/knockback.ts \
  super-smash/src/game/__golden__/engine-trace.json
git commit -m "super-smash: hitstun minimum, and the balloon speed-up arithmetic" -m "computeHitstun is rubendal's Hitstun (minimum 4, 0.4 slope throughout). damageSpeedUpMaxMag / damageSpeedUpMag / effectiveHitstun port init_damage_speed_up; pinned to ssbu_ref.mjs up to 500 knockback and to SmashWiki's 33/41 frames at 90/145." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The balloon speed-up in the sim: sped-up reaction frames on the DAMAGE energy

A tumbling launch without set knockback now plays back sped up. `applyHit` keeps deciding tumble from the base hitstun but stores the *effective* hitstun (`effectiveHitstun`), so `f.hitstun` still counts real frames and every reader of it is unchanged; it parks the launch's reaction frames in `CombatState.launchFaf`, and `releasePendingLaunch` hands them to `kineticLaunch`, which arms the speed-up on the KineticState. Each real frame of reeling then plays `speedUpSteps` reaction frames — `kineticReel`'s old body, now `reelOnce`, run that many times — and the displacement of all but the last rides in `kinetic.stepX/stepY`, which `integrate` adds once (`kineticTakeStep`). This is rubendal's launch visualiser's model: the un-sped path, sampled. Collision still sweeps from the pre-integrate position to the final one.

`reelOnce` is the body of Plan 2's `kineticReel` moved verbatim (with Plan 2's final `damage_fly_top_*` vertical-launch gravity); this task wraps it, it does not change it. Review Focus #5 — the blast-zone check, which runs once per real frame, against a launch that jumps six reaction frames at a time — is the last test here; it launches at 5°, not 0°, because a flat launch of 120 or more is lifted to 32° (Task 3).

**Files:**
- Modify: `super-smash/src/engine/combat.test.ts`
- Modify: `super-smash/src/engine/combat.ts`
- Modify: `super-smash/src/engine/hash.ts`
- Modify: `super-smash/src/engine/kinetic.test.ts`
- Modify: `super-smash/src/engine/kinetic.ts`
- Modify: `super-smash/src/engine/physics.ts`
- Modify: `super-smash/src/engine/simulate.ts`
- Modify: `super-smash/src/game/__golden__/engine-trace.json` (regenerated by a command in this task)

**Interfaces:** Changes: `kineticLaunch(f, vx, vy, speed, speedUpFaf = 0)`; `kineticReel` plays `speedUpSteps` reaction frames per call. Adds `kineticTakeStep(f): { x: number; y: number }`. `KineticState` gains `speedUpFrame` (Q12), `speedUpFaf`, `speedUpMax` (Q12; 0 = off), `stepX`, `stepY`; `CombatState` gains `launchFaf`. `kineticClear`, `kineticLand`, `kineticJump`, `kineticMotion` and `kineticExec` disarm the speed-up.

- [ ] **Step 1: Write the failing tests**

In `src/engine/combat.test.ts`, replace:

```ts
import { GROUNDED_ZERO_LAUNCH_RATIO, LAUNCH_SPEED_RATIO } from "./constants";
import { hashState } from "./hash";
import { cloneState, createInitialState, step } from "./simulate";
import type { SimContext } from "./simulate";
```

with:

```ts
import { GROUNDED_ZERO_LAUNCH_RATIO, LAUNCH_SPEED_RATIO } from "./constants";
import { hashState } from "./hash";
import { computeHitstun, effectiveHitstun } from "./knockback";
import { cloneState, createInitialState, step } from "./simulate";
import type { SimContext } from "./simulate";
```

Append to the end of `src/engine/combat.test.ts`:

```ts
/* ----------------------------------------- Task 6: balloon speed-up -- */

describe("the balloon speed-up through a real hit (Plan 3, Task 6)", () => {
  /**
   * A jab (and neutral air) with fixed (set) knockback: Ultimate never speeds
   * those up. 5°, not 0°: a flat launch of 120 or more is lifted to 32° (Task 3).
   */
  const setKb = hitbox({ angle: fx(5), baseKnockback: fx(150), setKnockback: true });
  const setKbDef: FighterDef = {
    ...BASE_DEF,
    moves: { ...BASE_DEF.moves, jab1: move("jab1", { hitboxes: [setKb] }), nair: move("nair", { hitboxes: [setKb] }) },
  };
  /** The same launch, 150 knockback nearly straight ahead, from growth instead. */
  const growth = hitbox({ angle: fx(5), baseKnockback: fx(150), knockbackGrowth: 0 });
  const growthDef: FighterDef = {
    ...BASE_DEF,
    moves: { ...BASE_DEF.moves, jab1: move("jab1", { hitboxes: [growth] }), nair: move("nair", { hitboxes: [growth] }) },
  };

  function contact(def: FighterDef): { hitstun: number; knockback: number } {
    const frames = play(standing(ctxFor(def)), 8, JAB, ctxFor(def));
    const i = frames.findIndex((f) => f.events.hits.length > 0);
    return { hitstun: frames[i].state.fighters[1].hitstun, knockback: frames[i].events.hits[0].knockback };
  }

  it("holds a tumbling victim in hitstun for the sped-up time, not the base", () => {
    const c = contact(growthDef);
    expect(c.hitstun).toBe(effectiveHitstun(c.knockback, true));
    expect(c.hitstun).toBeLessThan(computeHitstun(c.knockback));
  });

  // rubendal SSBU-Calculator `js/knockback.js`: the speed-up runs only `if (tumble && !isFKB)`.
  it("leaves a set-knockback launch at its base hitstun", () => {
    const c = contact(setKbDef);
    expect(c.hitstun).toBe(computeHitstun(c.knockback));
  });

  // Review Focus #5: the speed-up against the blast-zone check, which runs once
  // per real frame. A sped-up frame jumps several reaction frames; the KO must
  // come on the first real frame whose end lies past the line, once.
  it("KOs on the first sped-up frame past the blast zone, and only once", () => {
    function koFrame(def: FighterDef): { frame: number; kos: number; lastInside: number } {
      const s = standing(ctxFor(def));
      s.fighters[0].x = fx(60);
      s.fighters[1].x = fx(68);
      s.fighters[1].grounded = false;
      s.fighters[1].platform = -1;
      s.fighters[1].y = fx(30);
      s.fighters[0].y = fx(30);
      s.fighters[0].grounded = false;
      s.fighters[0].platform = -1;
      s.fighters[0].action = "fall";
      s.fighters[1].action = "fall";
      const frames = play(s, 120, JAB, ctxFor(def));
      const at = frames.findIndex((f) => f.events.kos.some((k) => k.port === 1));
      const kos = frames.flatMap((f) => f.events.kos).filter((k) => k.port === 1).length;
      return { frame: at, kos, lastInside: frames[at - 1].state.fighters[1].x };
    }
    const sped = koFrame(growthDef);
    const plain = koFrame(setKbDef);
    expect(sped.frame).toBeGreaterThan(0);
    expect(sped.kos).toBe(1);
    expect(sped.lastInside).toBeLessThanOrEqual(STAGE.blastZone.right);
    // Same 150 knockback and angle: the sped-up launch reaches the line sooner.
    expect(sped.frame).toBeLessThan(plain.frame);
  });
});
```

In `src/engine/kinetic.test.ts`, replace:

```ts

import { LAUNCH_SPEED_DECAY } from "./constants";
import { fx } from "./fixed";
import {
  emptyKinetic,
```

with:

```ts

import { LAUNCH_SPEED_DECAY } from "./constants";
import { ONE, fx } from "./fixed";
import {
  emptyKinetic,
```

In `src/engine/kinetic.test.ts`, replace:

```ts
  kineticSumX,
  kineticSumY,
} from "./kinetic";
import type { KineticState, KineticType } from "./kinetic";
import { paramsFromAttributes } from "./params";
```

with:

```ts
  kineticSumX,
  kineticSumY,
  kineticTakeStep,
} from "./kinetic";
import { damageSpeedUpMaxMag } from "./knockback";
import type { KineticState, KineticType } from "./kinetic";
import { paramsFromAttributes } from "./params";
```

In `src/engine/kinetic.test.ts`, replace:

```ts
  it("zeroes every energy, the launch and the velocity", () => {
    const f = body(
      { controlX: 1, stopX: 2, gravityY: 3, motionX: 4, motionY: 5, damageX: 6, damageY: 7, fallFrames: 8, jumpInitial: 2 },
      { vx: 9, vy: 9, launchSpeed: 9 },
    );
```

with:

```ts
  it("zeroes every energy, the launch and the velocity", () => {
    const f = body(
      {
        controlX: 1,
        stopX: 2,
        gravityY: 3,
        motionX: 4,
        motionY: 5,
        damageX: 6,
        damageY: 7,
        fallFrames: 8,
        jumpInitial: 2,
        speedUpFrame: 9,
        speedUpFaf: 10,
        speedUpMax: 11,
        stepX: 12,
        stepY: 13,
      },
      { vx: 9, vy: 9, launchSpeed: 9 },
    );
```

Append to the end of `src/engine/kinetic.test.ts`:

```ts
/* ------------------------------------- the balloon speed-up (Plan 3, Task 6) -- */

describe("the DAMAGE energy, sped up (init_damage_speed_up)", () => {
  // rubendal SSBU-Calculator `js/knockback.js` plays a sped-up launch as the
  // ordinary one, sampled: each real frame shows the position several of the
  // game's reaction frames on. So a real frame must cover exactly the
  // reaction frames it consumes, no more and no less.
  const FAF = 80; // 6x on the first frame
  const sped = (): FighterState => {
    const f = body({}, { grounded: false });
    kineticLaunch(f, fx(3), fx(4), fx(5), FAF);
    return f;
  };
  const plain = (): FighterState => {
    const f = body({}, { grounded: false });
    kineticLaunch(f, fx(3), fx(4), fx(5));
    return f;
  };

  it("arms the speed-up at launch: the reaction frames and the first-frame multiplier", () => {
    const f = sped();
    expect(f.kinetic).toMatchObject({ speedUpFrame: FAF * ONE, speedUpFaf: FAF, speedUpMax: damageSpeedUpMaxMag(FAF) });
    expect(plain().kinetic.speedUpMax).toBe(0);
  });

  it("covers its first frame's six reaction frames in one real frame", () => {
    const f = sped();
    kineticReel(f, PARAMS, false);
    const g = plain();
    let dx = 0;
    let dy = 0;
    for (let i = 0; i < 6; i++) {
      kineticReel(g, PARAMS, false);
      dx += g.vx;
      dy += g.vy;
    }
    expect(f.launchSpeed).toBe(g.launchSpeed);
    expect(f.kinetic.gravityY).toBe(g.kinetic.gravityY);
    // The last of the six is this frame's velocity; the other five ride as a step.
    expect([f.vx + f.kinetic.stepX, f.vy + f.kinetic.stepY]).toEqual([dx, dy]);
  });

  it("hands the step to integrate once, and only once", () => {
    const f = sped();
    kineticReel(f, PARAMS, false);
    const step = kineticTakeStep(f);
    expect(step.x).not.toBe(0);
    expect(kineticTakeStep(f)).toEqual({ x: 0, y: 0 });
  });

  it("slows to one reaction frame a real frame once the multiplier is spent", () => {
    const f = sped();
    let frames = 0;
    while (f.kinetic.speedUpMax > 0) {
      kineticReel(f, PARAMS, false);
      kineticTakeStep(f);
      frames += 1;
      expect(frames).toBeLessThan(FAF);
    }
    const g = { ...f, kinetic: { ...f.kinetic } } as FighterState;
    kineticReel(f, PARAMS, false);
    expect(f.kinetic.stepX).toBe(0);
    expect(f.launchSpeed).toBe(g.launchSpeed - LAUNCH_SPEED_DECAY);
  });

  it("is disarmed by anything that ends the launch", () => {
    for (const end of [kineticClear, kineticLand, (f: FighterState) => kineticMotion(f, 0, 0)]) {
      const f = sped();
      end(f);
      expect(f.kinetic.speedUpMax).toBe(0);
    }
  });
});
```

- [ ] **Step 2: Run them**

Run: `pnpm vitest run src/engine/combat.test.ts src/engine/kinetic.test.ts`
Expected: FAIL — `zeroes every energy…` (`kineticClear` leaves the new fields), `arms the speed-up at launch`, `covers its first frame's six reaction frames…` (`expected 20271 to be 19226`), `hands the step to integrate once` (`kineticTakeStep is not a function`), `slows to one reaction frame…`, `is disarmed by anything that ends the launch`; in `combat.test.ts` `holds a tumbling victim in hitstun for the sped-up time` (`expected 59 to be 42`) and `KOs on the first sped-up frame past the blast zone` (`expected 73 to be less than 73`).

- [ ] **Step 3: Implement**

In `src/engine/combat.ts`, replace:

```ts
   */
  staleShield: boolean[];
}

```

with:

```ts
   */
  staleShield: boolean[];
  /**
   * The parked launch's reaction frames (`computeHitstun + 1`) when it will be
   * sped up — a tumbling launch without set knockback — else 0. Set on contact,
   * handed to `kineticLaunch` when the freeze ends (Plan 3, Task 6).
   */
  launchFaf: number;
}

```

In `src/engine/combat.ts`, replace:

```ts
  return {
    staleShield: [],
  };
}
```

with:

```ts
  return {
    staleShield: [],
    launchFaf: 0,
  };
}
```

In `src/engine/combat.ts`, replace:

```ts
  return {
    staleShield: c.staleShield.slice(),
  };
}
```

with:

```ts
  return {
    staleShield: c.staleShield.slice(),
    launchFaf: c.launchFaf,
  };
}
```

In `src/engine/hash.ts`, replace:

```ts
  let x = mixInt(h, c.staleShield.length);
  for (const onShield of c.staleShield) x = mixBool(x, onShield);
  return x;
}
```

with:

```ts
  let x = mixInt(h, c.staleShield.length);
  for (const onShield of c.staleShield) x = mixBool(x, onShield);
  x = mixInt(x, c.launchFaf);
  return x;
}
```

In `src/engine/hash.ts`, replace:

```ts
  x = mixInt(x, k.fallFrames);
  x = mixInt(x, k.jumpInitial);
  return x;
}
```

with:

```ts
  x = mixInt(x, k.fallFrames);
  x = mixInt(x, k.jumpInitial);
  x = mixInt(x, k.speedUpFrame);
  x = mixInt(x, k.speedUpFaf);
  x = mixInt(x, k.speedUpMax);
  x = mixInt(x, k.stepX);
  x = mixInt(x, k.stepY);
  return x;
}
```

In `src/engine/kinetic.ts`, replace:

```ts
import { LAUNCH_SPEED_DECAY } from "./constants";
import { ONE, abs, approach, mul, sqrt } from "./fixed";
import type { FighterParams } from "./params";
import type { FighterState } from "./types";
```

with:

```ts
import { LAUNCH_SPEED_DECAY } from "./constants";
import { ONE, abs, approach, mul, sqrt } from "./fixed";
import { damageSpeedUpMag, damageSpeedUpMaxMag } from "./knockback";
import type { FighterParams } from "./params";
import type { FighterState } from "./types";
```

In `src/engine/kinetic.ts`, replace:

```ts
  /** Full-hop initial rise (Task 19): 0 none; 1–4 the rise frame about to play; 5 hand over to gravity. */
  jumpInitial: number;
}

```

with:

```ts
  /** Full-hop initial rise (Task 19): 0 none; 1–4 the rise frame about to play; 5 hand over to gravity. */
  jumpInitial: number;
  /**
   * Balloon speed-up (Plan 3, Task 6): the launch's reaction frames still to
   * play, Q12 — rubendal's `damage_reaction_frame`. Meaningful while `speedUpMax > 0`.
   */
  speedUpFrame: number;
  /** The launch's reaction frames at the start (`damage_reaction_frame_last`), an integer. */
  speedUpFaf: number;
  /** The first-frame multiplier, Q12 (`damage_speed_up_max_mag`); 0 when no speed-up is running. */
  speedUpMax: number;
  /**
   * Where this frame's extra reaction frames moved the fighter, Q12: a sped-up
   * real frame plays several of the game's frames, and all but the last land
   * here for `integrate` to add (`kineticTakeStep`). Zero between frames.
   */
  stepX: number;
  stepY: number;
}

```

In `src/engine/kinetic.ts`, replace:

```ts
    fallFrames: 0,
    jumpInitial: 0,
  };
}
```

with:

```ts
    fallFrames: 0,
    jumpInitial: 0,
    speedUpFrame: 0,
    speedUpFaf: 0,
    speedUpMax: 0,
    stepX: 0,
    stepY: 0,
  };
}
```

In `src/engine/kinetic.ts`, replace:

```ts
    fallFrames: k.fallFrames,
    jumpInitial: k.jumpInitial,
  };
}
```

with:

```ts
    fallFrames: k.fallFrames,
    jumpInitial: k.jumpInitial,
    speedUpFrame: k.speedUpFrame,
    speedUpFaf: k.speedUpFaf,
    speedUpMax: k.speedUpMax,
    stepX: k.stepX,
    stepY: k.stepY,
  };
}
```

In `src/engine/kinetic.ts`, replace:

```ts
  k.fallFrames = 0;
  k.jumpInitial = 0;
  f.launchSpeed = 0;
  kineticSum(f);
```

with:

```ts
  k.fallFrames = 0;
  k.jumpInitial = 0;
  k.speedUpFrame = 0;
  k.speedUpFaf = 0;
  k.speedUpMax = 0;
  k.stepX = 0;
  k.stepY = 0;
  f.launchSpeed = 0;
  kineticSum(f);
```

In `src/engine/kinetic.ts`, replace:

```ts
  k.controlX += k.damageX;
  k.damageX = 0;
  f.launchSpeed = 0;
  k.jumpInitial = 0;
```

with:

```ts
  k.controlX += k.damageX;
  k.damageX = 0;
  k.speedUpMax = 0;
  f.launchSpeed = 0;
  k.jumpInitial = 0;
```

In `src/engine/kinetic.ts`, replace:

```ts
 * fighter was doing — drift, a jump's rise, scripted motion — and decays on its
 * own from here (`kineticDecayDamage`); `launchSpeed` is its magnitude.
 */
export function kineticLaunch(f: FighterState, vx: number, vy: number, speed: number): void {
  const k = f.kinetic;
  k.controlX = 0;
  k.stopX = 0;
```

with:

```ts
 * fighter was doing — drift, a jump's rise, scripted motion — and decays on its
 * own from here (`kineticDecayDamage`); `launchSpeed` is its magnitude.
 *
 * `speedUpFaf` > 0 arms the balloon speed-up for a launch of that many
 * reaction frames (`computeHitstun + 1`): the caller passes 0 for a launch
 * that does not tumble or has set knockback (Plan 3, Task 6).
 */
export function kineticLaunch(f: FighterState, vx: number, vy: number, speed: number, speedUpFaf = 0): void {
  const k = f.kinetic;
  const max = speedUpFaf > 0 ? damageSpeedUpMaxMag(speedUpFaf) : 0;
  k.speedUpFaf = speedUpFaf;
  k.speedUpFrame = speedUpFaf * ONE;
  k.speedUpMax = max > ONE ? max : 0;
  k.stepX = 0;
  k.stepY = 0;
  k.controlX = 0;
  k.stopX = 0;
```

In `src/engine/kinetic.ts`, replace:

```ts
  }
  const k = f.kinetic;
  const p = input.params;
  // A launch outlives its hitstun and keeps decaying while the fighter acts.
```

with:

```ts
  }
  const k = f.kinetic;
  // Out of hitstun nothing is sped up any more.
  k.speedUpMax = 0;
  const p = input.params;
  // A launch outlives its hitstun and keeps decaying while the fighter acts.
```

In `src/engine/kinetic.ts`, replace:

```ts

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
```

with:

```ts

/**
 * How many of the game's reaction frames this real frame plays (Plan 3,
 * Task 6): `damageSpeedUpMag` of them while the speed-up runs, at least one,
 * rounded to whole frames by where the count crosses an integer (rubendal
 * `DamageSpeedUpFrames` / `GetFrameWithSpeedUp`). One when nothing is sped up.
 */
function speedUpSteps(f: FighterState): number {
  const k = f.kinetic;
  if (k.speedUpMax <= 0) return 1;
  const before = Math.ceil(k.speedUpFrame / ONE);
  const mag = damageSpeedUpMag(k.speedUpFrame, k.speedUpFaf, k.speedUpMax);
  k.speedUpFrame -= mag < ONE ? ONE : mag;
  if (mag <= ONE) k.speedUpMax = 0;
  const steps = before - Math.ceil(k.speedUpFrame / ONE);
  return steps < 1 ? 1 : steps;
}

/**
 * One reaction frame of reeling — Plan 2's `kineticReel` body, unchanged: the
 * launch decays, gravity builds toward the fall speed (a vertical "balloon"
 * launch by `damage_fly_top_air_accel_y` toward `damage_fly_top_speed_y_stable`),
 * and on the ground the launch also loses `ground_brake`.
 */
function reelOnce(f: FighterState, p: FighterParams, balloon: boolean): void {
  const k = f.kinetic;
  kineticDecayDamage(f, f.grounded ? LAUNCH_SPEED_DECAY + p.ground_brake : LAUNCH_SPEED_DECAY);
```

In `src/engine/kinetic.ts`, replace:

```ts
}

/** Touching down ends a launch: its horizontal part becomes ordinary sliding (STOP). */
export function kineticLand(f: FighterState): void {
```

with:

```ts
}

/**
 * One frame of a fighter in hitstun: `reelOnce`, and nothing the player holds
 * moves them.
 *
 * A tumbling launch plays several reaction frames per real frame at first —
 * the balloon speed-up (SmashWiki "Launch": "the process of the character
 * getting launched is sped up"). Each is a full reaction frame of decay and
 * gravity; the displacement of all but the last is left in `stepX`/`stepY`
 * for `integrate`, so the path is the same as the un-sped launch, sampled.
 */
export function kineticReel(f: FighterState, p: FighterParams, balloon: boolean): void {
  const steps = speedUpSteps(f);
  const k = f.kinetic;
  for (let i = 1; i < steps; i++) {
    reelOnce(f, p, balloon);
    k.stepX += f.vx;
    k.stepY += f.vy;
  }
  reelOnce(f, p, balloon);
}

/**
 * The displacement of this frame's extra reaction frames, handed to
 * `integrate` and zeroed, so it is added exactly once.
 */
export function kineticTakeStep(f: FighterState): { x: number; y: number } {
  const k = f.kinetic;
  const step = { x: k.stepX, y: k.stepY };
  k.stepX = 0;
  k.stepY = 0;
  return step;
}

/** Touching down ends a launch: its horizontal part becomes ordinary sliding (STOP). */
export function kineticLand(f: FighterState): void {
```

In `src/engine/kinetic.ts`, replace:

```ts
  k.damageX = 0;
  k.damageY = 0;
  f.launchSpeed = 0;
  kineticSum(f);
```

with:

```ts
  k.damageX = 0;
  k.damageY = 0;
  k.speedUpMax = 0;
  f.launchSpeed = 0;
  kineticSum(f);
```

In `src/engine/kinetic.ts`, replace:

```ts
  k.damageX = 0;
  k.damageY = 0;
  f.launchSpeed = 0;
  k.motionX = vx;
```

with:

```ts
  k.damageX = 0;
  k.damageY = 0;
  k.speedUpMax = 0;
  f.launchSpeed = 0;
  k.motionX = vx;
```

In `src/engine/physics.ts`, replace:

```ts
  LEDGE_REGRAB_SCALING,
} from "./constants";
import { kineticLand, kineticSetX, kineticSetY } from "./kinetic";
import { TURN } from "./knockback";
import type { FighterAttributes, FighterState, Platform, StageDef } from "./types";
```

with:

```ts
  LEDGE_REGRAB_SCALING,
} from "./constants";
import { kineticLand, kineticSetX, kineticSetY, kineticTakeStep } from "./kinetic";
import { TURN } from "./knockback";
import type { FighterAttributes, FighterState, Platform, StageDef } from "./types";
```

In `src/engine/physics.ts`, replace:

```ts
/** Position integration. Velocities are units per frame, so this is an add. */
export function integrate(f: FighterState): void {
  f.x += f.vx;
  f.y += f.vy;
}

```

with:

```ts
/** Position integration. Velocities are units per frame, so this is an add. */
export function integrate(f: FighterState): void {
  // A sped-up launch frame plays several reaction frames; the extra ones'
  // displacement rides along (Plan 3, Task 6).
  const step = kineticTakeStep(f);
  f.x += f.vx + step.x;
  f.y += f.vy + step.y;
}

```

In `src/engine/simulate.ts`, replace:

```ts
  computeShieldstun,
  computeStaleness,
  applyDI,
  applyLSI,
```

with:

```ts
  computeShieldstun,
  computeStaleness,
  effectiveHitstun,
  applyDI,
  applyLSI,
```

In `src/engine/simulate.ts`, replace:

```ts
      Math.trunc((launch.vy * speed) / launch.speed),
      speed,
    );
  } else {
```

with:

```ts
      Math.trunc((launch.vy * speed) / launch.speed),
      speed,
      f.combat.launchFaf,
    );
  } else {
```

In `src/engine/simulate.ts`, replace:

```ts
  f.pendingAngle = 0;
  f.pendingFacing = 0;
}

```

with:

```ts
  f.pendingAngle = 0;
  f.pendingFacing = 0;
  f.combat.launchFaf = 0;
}

```

In `src/engine/simulate.ts`, replace:

```ts
  });

  const hitstun = computeHitstun(kb);
  // Crouch cancel shortens the freeze for *both* fighters (research §4), which
  // is why one `lag` is computed and handed to each of them below rather than
```

with:

```ts
  });

  // The base decides tumble; a tumbling launch without set knockback is then
  // played back sped up, which shortens the hitstun in real frames (SmashWiki
  // "Hitstun"; rubendal `js/knockback.js`: `tumble && !isFKB`). Plan 3, Task 6.
  const hitstun = computeHitstun(kb);
  const tumbles = hitstun >= TUMBLE_HITSTUN;
  const speedUp = tumbles && hb.setKnockback !== true;
  // Crouch cancel shortens the freeze for *both* fighters (research §4), which
  // is why one `lag` is computed and handed to each of them below rather than
```

In `src/engine/simulate.ts`, replace:

```ts
  victim.pendingFacing = sourceFacing >= 0 ? 1 : -1;

  victim.hitstun = hitstun;
  victim.hitlag = lag;
  victim.intangible = 0;
```

with:

```ts
  victim.pendingFacing = sourceFacing >= 0 ? 1 : -1;

  victim.hitstun = effectiveHitstun(kb, speedUp);
  victim.combat.launchFaf = speedUp ? hitstun + 1 : 0;
  victim.hitlag = lag;
  victim.intangible = 0;
```

In `src/engine/simulate.ts`, replace:

```ts
  // victim in `grabbed` — whose only exit is `grabbedBy < 0` — for good.
  releaseGrab(victim, s.fighters);
  startAction(victim, hitstun >= TUMBLE_HITSTUN ? "tumble" : "hitstun");

  events.hits.push({
```

with:

```ts
  // victim in `grabbed` — whose only exit is `grabbedBy < 0` — for good.
  releaseGrab(victim, s.fighters);
  startAction(victim, tumbles ? "tumble" : "hitstun");

  events.hits.push({
```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/engine/combat.test.ts src/engine/kinetic.test.ts`
Expected: PASS.

- [ ] **Step 5: The golden trace**

Run: `pnpm vitest run src/game/golden.test.ts`
Expected before regenerating: FAIL in all four matches — every tumbling launch is now sped up and shorter. Regenerate.

```bash
UPDATE_GOLDEN=1 pnpm vitest run src/game/golden.test.ts
pnpm vitest run src/game/golden.test.ts
```

Expected: the second run PASSes. This task changes behaviour on purpose; its commit says so.

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0 (`pnpm lint` reports only the two pre-existing warnings in `research/rebuild-2026-10/tools/sim_bench.mjs`).

- [ ] **Step 7: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/src/engine/combat.test.ts \
  super-smash/src/engine/combat.ts \
  super-smash/src/engine/hash.ts \
  super-smash/src/engine/kinetic.test.ts \
  super-smash/src/engine/kinetic.ts \
  super-smash/src/engine/physics.ts \
  super-smash/src/engine/simulate.ts \
  super-smash/src/game/__golden__/engine-trace.json
git commit -m "super-smash: the balloon speed-up runs in the sim" -m "A tumbling launch without set knockback plays several reaction frames per real frame (init_damage_speed_up); hitstun counts real frames (effectiveHitstun). The extra frames' displacement reaches integrate through kineticTakeStep. Golden trace regenerated." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Hitstun cancel: air dodge from frame 41, aerial from 46

SmashWiki "Hitstun canceling" (Ultimate keeps Smash 4's parameters) and rubendal's `parameters.hitstunCancel`: an airborne victim may air dodge after frame 40 of hitstun while the launch is slower than 2.5, and attack after frame 45 while it is slower than 2. `actionFrame` in DAMAGE/DAMAGE_FLY counts real frames since the freeze ended, which is how both sources count ("do not account for the speed-up"). The check sits at the top of the reeling statuses' shared `main`, before the buffer, so a press buffered a few frames early fires when the window opens.

Three details. Only a *press* (fresh or buffered) cancels: a shield held for a ground tech (Task 12) must not spend the air dodge. A fighter whose air dodge is already spent stays in hitstun — nothing is cleared until the dodge is known to start. And being hit gives the air dodge back: "Characters can only air dodge once until they land, get hit, or grab a ledge" (SmashWiki "Air dodge", https://www.ssbwiki.com/Air_dodge), so `applyHit` clears `airDodged` when damage lands. The spent-dodge and held-shield cases pass before this task too (nothing cancels then); they pin the order of the checks.

**Files:**
- Modify: `super-smash/src/engine/combat.test.ts`
- Modify: `super-smash/src/engine/constants.ts`
- Modify: `super-smash/src/engine/simulate.ts`
- Modify: `super-smash/src/engine/status/damage.ts`

**Interfaces:** Adds `HITSTUN_CANCEL_AIR_DODGE_FRAME = 41`, `HITSTUN_CANCEL_AERIAL_FRAME = 46`, `HITSTUN_CANCEL_AIR_DODGE_SPEED = fx(2.5)`, `HITSTUN_CANCEL_AERIAL_SPEED = fx(2)` (`constants.ts`). `status/damage.ts` `reelMain` calls a new local `hitstunCancel`. `applyHit` sets `victim.airDodged = false` on every hit that deals damage.

- [ ] **Step 1: Write the failing tests**

Append to the end of `src/engine/combat.test.ts`:

```ts
/* ------------------------------------------- Task 7: hitstun cancel -- */

describe("hitstun cancel (Plan 3, Task 7)", () => {
  /** Fighter 1 tumbling in the air, `frame` frames into a long hitstun, launch speed `speed`. */
  function tumbling(frame: number, speed: number): GameState {
    const s = standing();
    const v = s.fighters[1];
    v.action = "tumble";
    v.actionFrame = frame;
    v.hitstun = 60;
    v.grounded = false;
    v.platform = -1;
    v.y = fx(60);
    v.kinetic.damageX = speed;
    v.launchSpeed = speed;
    v.vx = speed;
    return s;
  }
  const press = (b: InputFrame) => (i: number): readonly InputFrame[] => [0, i === 0 ? b : 0];

  // SmashWiki "Hitstun canceling" (https://www.ssbwiki.com/Hitstun_canceling):
  // air dodge after frame 40 if launch speed is below 2.5; aerial after frame 45
  // below 2. rubendal `parameters.hitstunCancel` agrees (frames 40/45, speeds 2.5/2).
  it("air dodges out of hitstun from frame 41 when the launch is slower than 2.5", () => {
    const after = play(tumbling(40, fx(2.4)), 1, press(Btn.Shield)).at(-1)!.state.fighters[1];
    expect(after.action).toBe("airDodge");
    expect(after.hitstun).toBe(0);
  });

  it("does not air dodge on frame 40", () => {
    expect(play(tumbling(39, fx(2.4)), 1, press(Btn.Shield)).at(-1)!.state.fighters[1].action).toBe("tumble");
  });

  it("does not air dodge while the launch is still 2.5 or faster", () => {
    expect(play(tumbling(40, fx(2.5)), 1, press(Btn.Shield)).at(-1)!.state.fighters[1].action).toBe("tumble");
  });

  it("attacks out of hitstun from frame 46 when the launch is slower than 2", () => {
    const after = play(tumbling(45, fx(1.9)), 1, press(Btn.Attack)).at(-1)!.state.fighters[1];
    expect(after.action).toBe("attack");
    expect(after.move).toBe("nair");
    expect(after.hitstun).toBe(0);
  });

  it("does not attack on frame 45, or at a launch of 2", () => {
    expect(play(tumbling(44, fx(1.9)), 1, press(Btn.Attack)).at(-1)!.state.fighters[1].action).toBe("tumble");
    expect(play(tumbling(45, fx(2)), 1, press(Btn.Attack)).at(-1)!.state.fighters[1].action).toBe("tumble");
  });

  it("stays in hitstun when the air dodge is already spent", () => {
    const s = tumbling(40, fx(2.2));
    s.fighters[1].airDodged = true;
    const frames = play(s, 3, press(Btn.Shield));
    expect(frames.map((f) => f.state.fighters[1].action)).toEqual(["tumble", "tumble", "tumble"]);
    expect(frames.at(-1)!.state.fighters[1].hitstun).toBe(57);
  });

  // SmashWiki "Air dodge": "Characters can only air dodge once until they land,
  // get hit, or grab a ledge."
  it("gets the air dodge back from being hit", () => {
    const s = standing();
    s.fighters[1].airDodged = true;
    const hit = play(s, 8, JAB).find((f) => f.events.hits.length > 0)!;
    expect(hit.state.fighters[1].airDodged).toBe(false);
  });

  // A shield held since before the hit — for a ground tech (Task 12) — is not a press.
  it("does not air dodge on a shield that is only held, not pressed", () => {
    let s = tumbling(40, fx(2.2));
    for (let i = 0; i < 3; i++) {
      s = step(s, [0, Btn.Shield], { prevInputs: [0, Btn.Shield], ctx: ctxFor() }).state;
    }
    expect(s.fighters[1].action).toBe("tumble");
  });

  it("takes a press buffered a few frames early, when the window opens", () => {
    const after = play(tumbling(37, fx(2)), 4, (i) => [0, i === 0 ? Btn.Shield : 0]).at(-1)!.state.fighters[1];
    expect(after.action).toBe("airDodge");
  });
});
```

- [ ] **Step 2: Run them**

Run: `pnpm vitest run src/engine/combat.test.ts`
Expected: FAIL — `air dodges out of hitstun from frame 41…` (`expected 'tumble' to be 'airDodge'`), `attacks out of hitstun from frame 46…` (`expected 'tumble' to be 'attack'`), `gets the air dodge back from being hit` (`expected true to be false`), `takes a press buffered a few frames early…`.

- [ ] **Step 3: Implement**

In `src/engine/constants.ts`, replace:

```ts
export const LAUNCH_SPEED_RATIO = fx(0.03);
export const LAUNCH_SPEED_DECAY = fx(0.051);

/**
```

with:

```ts
export const LAUNCH_SPEED_RATIO = fx(0.03);
export const LAUNCH_SPEED_DECAY = fx(0.051);

/**
 * Hitstun cancel: an airborne victim may air dodge from hitstun frame 41 while
 * the launch is slower than 2.5, or attack from frame 46 while it is slower than
 * 2. SmashWiki "Hitstun canceling" (https://www.ssbwiki.com/Hitstun_canceling):
 * "after frame 40" / "after frame 45"; rubendal SSBU-Calculator
 * `parameters.hitstunCancel` (frames 40/45, launch speeds 2.5/2).
 */
export const HITSTUN_CANCEL_AIR_DODGE_FRAME = 41;
export const HITSTUN_CANCEL_AERIAL_FRAME = 46;
export const HITSTUN_CANCEL_AIR_DODGE_SPEED = fx(2.5);
export const HITSTUN_CANCEL_AERIAL_SPEED = fx(2);

/**
```

In `src/engine/simulate.ts`, replace:

```ts
  /* ---- the damage path ---- */
  victim.damage += damage;

  /* ---- the super-armour path ---- */
```

with:

```ts
  /* ---- the damage path ---- */
  victim.damage += damage;
  // "Characters can only air dodge once until they land, get hit, or grab a
  // ledge" (SmashWiki "Air dodge", https://www.ssbwiki.com/Air_dodge). Plan 3, Task 7.
  victim.airDodged = false;

  /* ---- the super-armour path ---- */
```

In `src/engine/status/damage.ts`, replace:

```ts
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
```

with:

```ts
 */

import {
  HITSTUN_CANCEL_AERIAL_FRAME,
  HITSTUN_CANCEL_AERIAL_SPEED,
  HITSTUN_CANCEL_AIR_DODGE_FRAME,
  HITSTUN_CANCEL_AIR_DODGE_SPEED,
  TUMBLE_HITSTUN,
} from "../constants";
import {
  DOWNED_FRAMES,
  GETUP_FRAMES,
  aerialSlot,
  bufferPress,
  hasMove,
  peekBuffer,
  startAction,
  startAirDodge,
  startMove,
} from "../states";
import type { Intent, StateContext } from "../states";
import type { FighterState } from "../types";
import type { FighterStatus } from "./kind";

/**
 * Hitstun cancel (Plan 3, Task 7): late in a slowing launch an airborne victim
 * may air dodge (from frame 41, launch slower than 2.5) or attack (from frame
 * 46, slower than 2) before hitstun runs out. SmashWiki "Hitstun canceling";
 * rubendal `parameters.hitstunCancel`. `actionFrame` counts real frames since
 * the hit's freeze ended, which is how both sources count them ("do not
 * account for the speed-up", SmashWiki "Hitstun").
 *
 * Only a *press* (fresh or buffered) cancels: a shield held for a ground tech
 * (Task 12) must not spend the air dodge. A fighter whose air dodge is spent
 * stays in hitstun — nothing is cleared before the dodge is known to start.
 * A buffered press is spent only by the cancel it fires.
 */
function hitstunCancel(f: FighterState, intent: Intent, ctx: StateContext): boolean {
  if (f.grounded) return false;
  const dodge = f.actionFrame >= HITSTUN_CANCEL_AIR_DODGE_FRAME && f.launchSpeed < HITSTUN_CANCEL_AIR_DODGE_SPEED;
  const aerial = f.actionFrame >= HITSTUN_CANCEL_AERIAL_FRAME && f.launchSpeed < HITSTUN_CANCEL_AERIAL_SPEED;
  if (!dodge && !aerial) return false;
  const buffered = peekBuffer(f, ctx.frame);
  if (dodge && !f.airDodged && (intent.shieldPressed || buffered === "shield")) {
    if (buffered === "shield") f.bufferedAction = null;
    f.hitstun = 0;
    f.balloon = false;
    return startAirDodge(f, intent);
  }
  if (aerial && (intent.attackPressed || buffered === "attack")) {
    const slot = aerialSlot(f, intent);
    if (!hasMove(ctx, slot)) return false;
    if (buffered === "attack") f.bufferedAction = null;
    f.hitstun = 0;
    f.balloon = false;
    startMove(f, "attack", slot);
    return true;
  }
  return false;
}

/** Shared by DAMAGE and DAMAGE_FLY: tumble is hitstun past 32 frames, not a different thing. */
function reelMain(f: FighterState, intent: Intent, ctx: StateContext): void {
  if (f.hitstun > 0) {
    if (hitstunCancel(f, intent, ctx)) return;
    if (f.hitstun >= TUMBLE_HITSTUN && f.action !== "tumble") startAction(f, "tumble");
    bufferPress(f, intent, ctx.frame);
```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/engine/combat.test.ts`
Expected: PASS.

- [ ] **Step 5: The golden trace**

Run: `pnpm vitest run src/game/golden.test.ts`
Expected: PASS, unchanged — the CPU never presses shield or attack 41+ frames into a slow launch in these matches.

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0 (`pnpm lint` reports only the two pre-existing warnings in `research/rebuild-2026-10/tools/sim_bench.mjs`).

- [ ] **Step 7: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/src/engine/combat.test.ts \
  super-smash/src/engine/constants.ts \
  super-smash/src/engine/simulate.ts \
  super-smash/src/engine/status/damage.ts
git commit -m "super-smash: hitstun cancel by air dodge or aerial" -m "SmashWiki 'Hitstun canceling' / rubendal parameters.hitstunCancel: air dodge after frame 40 below launch speed 2.5, aerial after 45 below 2 — on a press, with an air dodge left. Being hit restores the air dodge (SmashWiki 'Air dodge')." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Knockback stacking between different sources

SmashWiki "Knockback", stacking (Ultimate): when a target already flying is hit by a *different* source, a new launch at 0.5×–0.9× of its launch speed keeps the first launch (speed, direction, hitstun), and one under 0.5× is armoured through; anything faster takes over. Sources are `candidateKey`'s: the attacker's port, or 1000 + a projectile's instance id — so an archer's arrow and sword are different sources, and every hit of one multi-hit move is the same source and always takes over (Review Focus #4). A launch is *live* while the target still has hitstun or the launch is parked in hitlag; once hitstun is over, what is left of the launch is drift and any hit replaces it. A kept launch keeps its speed and hitstun but turns toward the sum of both launch vectors and is not DI'd ("The resulting angle … is determined by the inverse tangent of both hits' added knockback vectors"); a launch still parked in hitlag has no vector yet and keeps its own.

**Files:**
- Modify: `super-smash/src/engine/combat.test.ts`
- Modify: `super-smash/src/engine/combat.ts`
- Modify: `super-smash/src/engine/constants.ts`
- Modify: `super-smash/src/engine/hash.ts`
- Modify: `super-smash/src/engine/kinetic.ts`
- Modify: `super-smash/src/engine/knockback.test.ts`
- Modify: `super-smash/src/engine/knockback.ts`
- Modify: `super-smash/src/engine/simulate.ts`

**Interfaces:** Adds `knockbackStack(fresh: number, current: number): "replace" | "keep" | "armour"` (`knockback.ts`), `KB_STACK_ARMOUR: Ratio = [1, 2]`, `KB_STACK_KEEP: Ratio = [9, 10]`; `kineticTurnLaunch(f, dx, dy): void` (`kinetic.ts`: a live launch's new direction, same speed); `CombatState.launchSource: number` (−1 none). `sourceFacing` is now decided before the stacking check in `applyHit`.

- [ ] **Step 1: Write the failing tests**

Append to the end of `src/engine/combat.test.ts`:

```ts
/* --------------------------------------- Task 8: knockback stacking -- */

describe("knockback stacking (Plan 3, Task 8)", () => {
  /** A jab live from its first frame with a wide box, so it reaches a victim already flying. */
  const quick: FighterDef = {
    ...BASE_DEF,
    moves: { ...BASE_DEF.moves, jab1: move("jab1", { hitboxes: [hitbox({ startFrame: 1, radius: fx(10) })] }) },
  };
  const ctx = ctxFor(quick);
  /**
   * Three fighters: 0 far away, 2 jabs 1, and 1 is already flying from a launch
   * that fighter 0 (or 2 itself, `sameSource`) gave it, `ratio` times as fast as
   * the jab's own launch would be.
   */
  function stacked(
    ratio: number,
    sameSource = false,
    hitstun = 50,
  ): { victim: GameState["fighters"][number]; untouched: number } {
    const fresh = (): GameState => {
      const s = createInitialState(
        "flat",
        [{ defId: "tester" }, { defId: "tester" }, { defId: "tester" }],
        RULES,
        12345,
        ctx,
      );
      const place = [
        { x: fx(-60), facing: 1 },
        { x: fx(8), facing: -1 },
        { x: 0, facing: 1 },
      ];
      s.fighters.forEach((f, i) => {
        Object.assign(f, place[i], { action: "stand", actionFrame: 0, grounded: true, platform: 0, y: 0, intangible: 0 });
      });
      return s;
    };
    const jab = (i: number): readonly InputFrame[] => [0, 0, i === 0 ? Btn.Attack : 0];
    // The jab's own launch speed, against a victim standing still.
    const dry = play(fresh(), 8, jab, ctx).find((f) => f.events.hits.length > 0)!;
    const jabSpeed = Math.trunc((dry.events.hits[0].knockback * 3) / 100); // knockback × 0.03

    const s = fresh();
    const v = s.fighters[1];
    v.grounded = false;
    v.platform = -1;
    v.y = fx(1);
    v.action = hitstun > 0 ? "tumble" : "fall";
    v.hitstun = hitstun;
    const current = Math.trunc(jabSpeed / ratio);
    // Straight up, so the victim stays in front of the jab while it flies.
    v.kinetic.damageY = current;
    v.launchSpeed = current;
    v.vy = current;
    v.combat.launchSource = sameSource ? 2 : 0;
    const frames = play(s, 8, jab, ctx);
    const hit = frames.findIndex((f) => f.events.hits.length > 0);
    // What the first launch's hitstun reads on the hit frame if nothing touched it.
    return { victim: frames[hit].state.fighters[1], untouched: 50 - (hit + 1) };
  }

  it("keeps the first launch when the new one is 0.5x to 0.9x of it", () => {
    const { victim, untouched } = stacked(0.7);
    expect(victim.hitstun).toBe(untouched);
    expect(victim.pendingFacing).toBe(0);
    expect(victim.damage).toBeGreaterThan(0);
  });

  // SmashWiki "Knockback", stacking: "The resulting angle … is determined by the
  // inverse tangent of both hits' added knockback vectors"; the first hit's launch
  // speed is retained, and the resulting angle cannot be DI'd.
  it("turns a kept launch toward the sum of both launches, at its own speed", () => {
    const { victim } = stacked(0.7);
    const k = victim.kinetic;
    // Straight up, plus the jab's 45° to the right: now up and to the right.
    expect(k.damageX).toBeGreaterThan(0);
    expect(k.damageY).toBeGreaterThan(k.damageX);
    expect(Math.abs(Math.hypot(k.damageX, k.damageY) - victim.launchSpeed)).toBeLessThan(3);
  });

  it("replaces a launch whose hitstun is over, however fast it still drifts", () => {
    const { victim } = stacked(0.4, false, 0);
    expect(victim.pendingFacing).not.toBe(0);
    expect(victim.combat.launchSource).toBe(2);
  });

  it("armours through a hit under 0.5x of the live launch", () => {
    const { victim, untouched } = stacked(0.4);
    expect(victim.hitstun).toBe(untouched);
    expect(victim.pendingFacing).toBe(0);
    expect(victim.damage).toBeGreaterThan(0);
  });

  it("lets a stronger hit take over", () => {
    const { victim, untouched } = stacked(0.95);
    expect(victim.pendingFacing).not.toBe(0);
    expect(victim.hitstun).not.toBe(untouched);
  });

  // Review Focus #4: a multi-hit move is one source, so each of its hits takes
  // over from the last, however weak — it never "stacks" with itself.
  it("never stacks a source with itself: a multi-hit's every hit takes over", () => {
    const { victim } = stacked(0.4, true);
    expect(victim.pendingFacing).not.toBe(0);
    expect(victim.combat.launchSource).toBe(2);
  });
});
```

In `src/engine/knockback.test.ts`, replace:

```ts
  damageSpeedUpMaxMag,
  effectiveHitstun,
  knockbackToVelocity,
  normalizeAngle,
```

with:

```ts
  damageSpeedUpMaxMag,
  effectiveHitstun,
  knockbackStack,
  knockbackToVelocity,
  normalizeAngle,
```

Append to the end of `src/engine/knockback.test.ts`:

```ts
describe("knockbackStack", () => {
  // SmashWiki "Knockback" (https://www.ssbwiki.com/Knockback), stacking: in
  // Ultimate a new launch between 0.5× and 0.9× of the target's launch speed
  // keeps the first launch; below 0.5× the target "armors through" the hit;
  // otherwise the new launch overrides. Different sources only.
  it.each([
    [1, 4, "armour"],
    [1.99, 4, "armour"],
    [2, 4, "keep"],
    [3.59, 4, "keep"],
    [3.61, 4, "replace"],
    [5, 4, "replace"],
    [1, 0, "replace"],
  ])("a new launch of %f against a live one of %f: %s", (fresh, current, verdict) => {
    expect(knockbackStack(fx(fresh), fx(current))).toBe(verdict);
  });
});
```

- [ ] **Step 2: Run them**

Run: `pnpm vitest run src/engine/combat.test.ts src/engine/knockback.test.ts`
Expected: FAIL — the seven `knockbackStack` cases (`knockbackStack is not a function`); `keeps the first launch…` and `armours through…` (`expected 25 to be 49`: the weaker hit replaced the launch); `turns a kept launch toward the sum of both launches…` (`expected 0 to be greater than 0`), `replaces a launch whose hitstun is over…` and `never stacks a source with itself…` (`expected undefined to be 2`).

- [ ] **Step 3: Implement**

In `src/engine/combat.ts`, replace:

```ts
   */
  launchFaf: number;
}

```

with:

```ts
   */
  launchFaf: number;
  /**
   * Who launched this fighter last: the attacker's port, or 1000 + a
   * projectile's instance id (`candidateKey` in `simulate.ts`), −1 for nobody.
   * Knockback stacks only between different sources (Plan 3, Task 8).
   */
  launchSource: number;
}

```

In `src/engine/combat.ts`, replace:

```ts
    staleShield: [],
    launchFaf: 0,
  };
}
```

with:

```ts
    staleShield: [],
    launchFaf: 0,
    launchSource: -1,
  };
}
```

In `src/engine/combat.ts`, replace:

```ts
    staleShield: c.staleShield.slice(),
    launchFaf: c.launchFaf,
  };
}
```

with:

```ts
    staleShield: c.staleShield.slice(),
    launchFaf: c.launchFaf,
    launchSource: c.launchSource,
  };
}
```

In `src/engine/constants.ts`, replace:

```ts
 */
export const GROUNDED_ZERO_LAUNCH_RATIO: Ratio = [4, 5];

/** Two hitboxes within this damage difference clank instead of trading. */
```

with:

```ts
 */
export const GROUNDED_ZERO_LAUNCH_RATIO: Ratio = [4, 5];

/**
 * Knockback stacking (SmashWiki "Knockback", stacking, Ultimate): a new launch
 * from another source at 0.5×–0.9× of the live one keeps the live one; under
 * 0.5× the target armours through it.
 */
export const KB_STACK_ARMOUR: Ratio = [1, 2];
export const KB_STACK_KEEP: Ratio = [9, 10];

/** Two hitboxes within this damage difference clank instead of trading. */
```

In `src/engine/hash.ts`, replace:

```ts
  for (const onShield of c.staleShield) x = mixBool(x, onShield);
  x = mixInt(x, c.launchFaf);
  return x;
}
```

with:

```ts
  for (const onShield of c.staleShield) x = mixBool(x, onShield);
  x = mixInt(x, c.launchFaf);
  x = mixInt(x, c.launchSource);
  return x;
}
```

In `src/engine/kinetic.ts`, replace:

```ts
  k.damageY = vy;
  f.launchSpeed = speed;
  kineticSum(f);
}
```

with:

```ts
  k.damageY = vy;
  f.launchSpeed = speed;
  kineticSum(f);
}

/**
 * Point a live launch along (dx, dy) without changing its speed — knockback
 * stacking's kept launch (Plan 3, Task 8). A zero vector leaves it as it was.
 */
export function kineticTurnLaunch(f: FighterState, dx: number, dy: number): void {
  const len = sqrt(mul(dx, dx) + mul(dy, dy));
  if (len <= 0) return;
  const k = f.kinetic;
  k.damageX = Math.trunc((dx * f.launchSpeed) / len);
  k.damageY = Math.trunc((dy * f.launchSpeed) / len);
  kineticSum(f);
}
```

In `src/engine/knockback.ts`, replace:

```ts
  HITSTUN_RATIO,
  HITSTUN_MIN_FAF,
  LAUNCH_SPEED_RATIO,
  SPEED_UP_FAF_MAX,
```

with:

```ts
  HITSTUN_RATIO,
  HITSTUN_MIN_FAF,
  KB_STACK_ARMOUR,
  KB_STACK_KEEP,
  LAUNCH_SPEED_RATIO,
  SPEED_UP_FAF_MAX,
```

Append to the end of `src/engine/knockback.ts`:

```ts
/* ------------------------------------------------------------- stacking -- */

/**
 * Knockback stacking: what a new launch does to one already flying, from a
 * *different* source (SmashWiki "Knockback", https://www.ssbwiki.com/Knockback):
 * in Ultimate a new launch speed between 0.5× and 0.9× of the target's keeps
 * the first launch — its speed, direction and hitstun — and one under 0.5×
 * is armoured through; anything faster takes over. Speeds are Q12; a target
 * with no live launch (`current` 0) is simply launched.
 */
export function knockbackStack(fresh: number, current: number): "replace" | "keep" | "armour" {
  if (current <= 0) return "replace";
  if (fresh * KB_STACK_ARMOUR[1] < current * KB_STACK_ARMOUR[0]) return "armour";
  if (fresh * KB_STACK_KEEP[1] <= current * KB_STACK_KEEP[0]) return "keep";
  return "replace";
}
```

In `src/engine/simulate.ts`, replace:

```ts
  GROUNDED_ZERO_LAUNCH_RATIO,
  LEDGE_REGRAB_LIMIT,
  ONE_ON_ONE_MULTIPLIER,
  SDI_DISTANCE,
```

with:

```ts
  GROUNDED_ZERO_LAUNCH_RATIO,
  LEDGE_REGRAB_LIMIT,
  LAUNCH_SPEED_RATIO,
  ONE_ON_ONE_MULTIPLIER,
  SDI_DISTANCE,
```

In `src/engine/simulate.ts`, replace:

```ts
  launchDiAble,
  lsiApplies,
  knockbackToVelocity,
  launchWorldAngle,
```

with:

```ts
  launchDiAble,
  lsiApplies,
  knockbackStack,
  knockbackToVelocity,
  launchWorldAngle,
```

In `src/engine/simulate.ts`, replace:

```ts
  kineticClear,
  kineticLaunch,
  kineticSet,
  kineticSetX,
```

with:

```ts
  kineticClear,
  kineticLaunch,
  kineticTurnLaunch,
  kineticSet,
  kineticSetX,
```

In `src/engine/simulate.ts`, replace:

```ts
  });

  // The launch is *parked*, not applied: Ultimate samples DI on the last frame
  // of hitlag, so the direction that bends this angle has not been chosen yet.
```

with:

```ts
  });

  // A projectile launches along the way *it* is pointing, which is the facing its
  // thrower had when it left rather than whichever way they happen to be looking
  // now — the arrow does not turn round when Link does.
  const sourceFacing = c.projectile !== null ? c.projectile.facing : attacker.facing;

  // Knockback stacking (Plan 3, Task 8): against a launch still live — in
  // hitstun, or parked in hitlag — from a *different* source, a weaker new
  // launch either keeps the first (0.5×–0.9×) or is armoured through (< 0.5×).
  // A launch whose hitstun is over is not "live": what is left of it is drift,
  // and any hit replaces it. Either way the damage lands and both fighters
  // freeze. A kept launch keeps its speed and hitstun, but turns toward the sum
  // of both launch vectors, and is not DI'd (SmashWiki "Knockback", stacking).
  const source = candidateKey(c);
  const live = victim.hitstun > 0 || victim.pendingFacing !== 0;
  const current = !live
    ? 0
    : victim.pendingFacing !== 0
      ? mul(victim.pendingKnockback, LAUNCH_SPEED_RATIO)
      : victim.launchSpeed;
  const verdict =
    victim.combat.launchSource === source ? "replace" : knockbackStack(mul(kb, LAUNCH_SPEED_RATIO), current);
  if (verdict !== "replace") {
    if (verdict === "keep" && victim.pendingFacing === 0 && victim.launchSpeed > 0) {
      // A parked launch has no vector yet; it keeps its own, as it was.
      const added = knockbackToVelocity(kb, resolveAngle(hb, victim.grounded, kb), sourceFacing);
      kineticTurnLaunch(victim, victim.kinetic.damageX + added.vx, victim.kinetic.damageY + added.vy);
    }
    victim.hitlag = Math.max(victim.hitlag, lag);
    if (!fromProjectile) attacker.hitlag = lag;
    events.hits.push({
      attacker: attacker.port,
      victim: victim.port,
      damage,
      x: c.x,
      y: c.y,
      knockback: verdict === "keep" ? kb : 0,
      angle: 0,
      hitboxId: hb.id,
    });
    return;
  }
  victim.combat.launchSource = source;

  // The launch is *parked*, not applied: Ultimate samples DI on the last frame
  // of hitlag, so the direction that bends this angle has not been chosen yet.
```

In `src/engine/simulate.ts`, replace:

```ts
  // holding a direction gets the same answer either way, which is exactly why
  // the difference only shows up for the player who is *reacting*.
  //
  // A projectile launches along the way *it* is pointing, which is the facing its
  // thrower had when it left rather than whichever way they happen to be looking
  // now — the arrow does not turn round when Link does.
  const sourceFacing = c.projectile !== null ? c.projectile.facing : attacker.facing;
  victim.pendingKnockback = kb;
  victim.pendingAngle = resolveAngle(hb, victim.grounded, kb);
```

with:

```ts
  // holding a direction gets the same answer either way, which is exactly why
  // the difference only shows up for the player who is *reacting*.
  // `sourceFacing` was decided above, with the stacking check.
  victim.pendingKnockback = kb;
  victim.pendingAngle = resolveAngle(hb, victim.grounded, kb);
```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/engine/combat.test.ts src/engine/knockback.test.ts`
Expected: PASS.

- [ ] **Step 5: The golden trace**

Run: `pnpm vitest run src/game/golden.test.ts`
Expected: PASS, unchanged — in these 1v1 matches no projectile lands on a fighter already flying from its owner's melee hit.

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0 (`pnpm lint` reports only the two pre-existing warnings in `research/rebuild-2026-10/tools/sim_bench.mjs`).

- [ ] **Step 7: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/src/engine/combat.test.ts \
  super-smash/src/engine/combat.ts \
  super-smash/src/engine/constants.ts \
  super-smash/src/engine/hash.ts \
  super-smash/src/engine/kinetic.ts \
  super-smash/src/engine/knockback.test.ts \
  super-smash/src/engine/knockback.ts \
  super-smash/src/engine/simulate.ts
git commit -m "super-smash: knockback stacks only between different sources" -m "SmashWiki 'Knockback' (Ultimate): a new launch from another source at 0.5–0.9× of a live launch keeps it, turned toward the summed vectors; under 0.5× is armoured through. Live means hitstun left or parked in hitlag." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Shields: ×1.19 damage, size, pushback, break stun and reset, mashing

SmashWiki "Shield" (Ultimate): shield damage ×1.19; size `(HP/50) × 0.85 + 0.15` of the radius; defender pushback `min((shieldstun + 1) × 0.09, 1.3)` with shieldstun "not rounded down" (the pushback table; rubendal's `ShieldPushback` agrees), attacker pushback `0.04 × damage + 0.025`; HP after a break 37.5. SmashWiki "Stun": shield-break stun `400 − p`, shortened 5.4 frames a button press and 3 a stick input, then FuraFuraEnd — "33 frames from Smash 4 onward" — before the fighter can act. The 240-frame stand-in becomes the renderer's clip length only. (The wiki also has pushback decay by traction, ×1.1 for the attacker; the replica decays both by `ground_brake` — an open question.)

Shield size is now geometry: a hit reaches the shield only if it overlaps the bubble (`shieldBubble`: `shield_radius × scale × shieldScale(HP)`, centred half-way up the body — UNVERIFIED until Plan 4 provides the shield bone), so a worn shield can be poked. The facing rule in `shieldCovers` is untouched. Mashing is counted in tenths of a frame (`mashFrames`) so 5.4 is exact; Task 14 reuses it for grabs.

**Files:**
- Modify: `super-smash/src/engine/combat.test.ts`
- Modify: `super-smash/src/engine/combat.ts`
- Modify: `super-smash/src/engine/constants.ts`
- Modify: `super-smash/src/engine/hash.ts`
- Modify: `super-smash/src/engine/knockback.ts`
- Create: `super-smash/src/engine/shield.test.ts`
- Create: `super-smash/src/engine/shield.ts`
- Modify: `super-smash/src/engine/simulate.ts`
- Modify: `super-smash/src/engine/states.ts`
- Modify: `super-smash/src/engine/status/guard.ts`
- Modify: `super-smash/src/game/__golden__/engine-trace.json` (regenerated by a command in this task)

**Interfaces:** Adds `src/engine/shield.ts`:
```ts
export function shieldDamage(damage: number): number;           // ×1.19
export function shieldScale(health: number): number;            // Q12
export function shieldPushback(shieldstun: number): number;     // Q12/frame, from unrounded Q12 shieldstun
export function attackerShieldPushback(damage: number): number; // Q12/frame
export function shieldBreakStun(percent: number): number;       // frames
export function mashFrames(c: CombatState, buttons: number, sticks: number, perButton: number, perStick: number): number;
export function shieldBubble(f: Pick<FighterState, "x" | "y" | "shieldHealth">, def: FighterDef): Capsule;
```
`buttonPresses(intent: Intent): number` (`states.ts`); constants `SHIELD_DAMAGE_RATIO`, `SHIELD_SIZE_MIN`, `SHIELD_PUSHBACK_RATIO`, `SHIELD_PUSHBACK_MAX`, `SHIELD_ATTACKER_PUSHBACK_RATIO`, `SHIELD_ATTACKER_PUSHBACK_ADD`, `SHIELD_BREAK_STUN_BASE`, `SHIELD_BREAK_RESET`, `SHIELD_BREAK_MASH_BUTTON = 54`, `SHIELD_BREAK_MASH_STICK = 30` (tenths), `FURAFURA_END_FRAMES = 33`; `shieldstunExact(damage, opts): number` (`knockback.ts`, Q12, unrounded and uncapped — `computeShieldstun` now floors it); `CombatState.mash`. Removes `SHIELD_PUSHBACK` (`simulate.ts`, no other reader).

- [ ] **Step 1: Write the failing tests**

In `src/engine/combat.test.ts`, replace:

```ts

import { byRatio, fx, mul } from "./fixed";
import { GROUNDED_ZERO_LAUNCH_RATIO, LAUNCH_SPEED_RATIO } from "./constants";
import { hashState } from "./hash";
import { computeHitstun, effectiveHitstun } from "./knockback";
import { cloneState, createInitialState, step } from "./simulate";
import type { SimContext } from "./simulate";
```

with:

```ts

import { byRatio, fx, mul } from "./fixed";
import {
  FURAFURA_END_FRAMES,
  GROUNDED_ZERO_LAUNCH_RATIO,
  LAUNCH_SPEED_RATIO,
  SHIELD_BREAK_RESET,
  SHIELD_DECAY_PER_FRAME,
  SHIELD_REGEN_PER_FRAME,
} from "./constants";
import { hashState } from "./hash";
import { STALE_FRESH_BONUS, computeHitstun, effectiveHitstun, shieldstunExact } from "./knockback";
import { attackerShieldPushback, shieldDamage, shieldPushback } from "./shield";
import { cloneState, createInitialState, step } from "./simulate";
import type { SimContext } from "./simulate";
```

Append to the end of `src/engine/combat.test.ts`:

```ts
/* --------------------------------------------------- Task 9: shield -- */

describe("shields (Plan 3, Task 9)", () => {
  /** The frame fighter 1's shield took fighter 0's jab, and the frame before. */
  function shieldHit(prepare: (s: GameState) => void = () => {}): { before: Frame; at: Frame } {
    const s = standing();
    prepare(s);
    const frames = play(s, 12, JAB_INTO_SHIELD);
    const i = frames.findIndex((f) => f.events.shieldHits.length > 0);
    return { before: frames[i - 1], at: frames[i] };
  }
  const JAB_DAMAGE = mul(fx(10), STALE_FRESH_BONUS);

  it("takes 1.19x the hit's damage off the shield", () => {
    const { before, at } = shieldHit();
    const lost = before.state.fighters[1].shieldHealth - at.state.fighters[1].shieldHealth;
    expect(lost).toBe(shieldDamage(JAB_DAMAGE) + SHIELD_DECAY_PER_FRAME);
  });

  it("slides the defender (shieldstun + 1) x 0.09 and a grounded attacker 0.04 x damage + 0.025", () => {
    const { at } = shieldHit();
    const [attacker, defender] = at.state.fighters;
    // Shieldstun *not* rounded down (SmashWiki "Shield", pushback table).
    expect(defender.vx).toBe(shieldPushback(shieldstunExact(JAB_DAMAGE)));
    expect(attacker.vx).toBe(-attackerShieldPushback(JAB_DAMAGE));
  });

  it("lets a hit past a worn-down shield: a shield poke", () => {
    const s = standing();
    s.fighters[1].shieldHealth = fx(2);
    // A jab aimed at the feet, outside a shield shrunk to 15% of its radius.
    const low: FighterDef = {
      ...BASE_DEF,
      moves: { ...BASE_DEF.moves, jab1: move("jab1", { hitboxes: [hitbox({ y: fx(0.5), radius: fx(1.5) })] }) },
    };
    const frames = play(s, 10, JAB_INTO_SHIELD, ctxFor(low));
    expect(frames.flatMap((f) => f.events.shieldHits)).toEqual([]);
    expect(frames.at(-1)!.state.fighters[1].damage).toBeGreaterThan(0);
  });

  it("breaks into 400 - percent frames of stun", () => {
    const { at } = shieldHit((s) => {
      s.fighters[1].shieldHealth = fx(1);
      s.fighters[1].damage = fx(120);
    });
    const v = at.state.fighters[1];
    expect(v.action).toBe("shieldBroken");
    expect(v.hitstun).toBe(280);
  });

  // SmashWiki "Stun": after the stun, every character plays FuraFuraEnd, "33 frames
  // from Smash 4 onward", before it can act; the shield comes back at 37.5.
  it("regains consciousness for 33 frames, then stands with 37.5 HP of shield", () => {
    const s = standing();
    const v = s.fighters[1];
    v.action = "shieldBroken";
    v.hitstun = 1;
    v.shieldHealth = 0;
    // Frame 0 ends the stun and starts FuraFuraEnd; mashing no longer shortens it.
    const frames = play(s, FURAFURA_END_FRAMES + 1, (i) => [0, i % 2 === 0 ? Btn.Attack : 0]);
    expect(frames[FURAFURA_END_FRAMES - 1].state.fighters[1].action).toBe("shieldBroken");
    const after = frames[FURAFURA_END_FRAMES].state.fighters[1];
    expect(after.action).toBe("stand");
    expect(after.shieldHealth).toBe(SHIELD_BREAK_RESET + SHIELD_REGEN_PER_FRAME);
  });

  it("does not regenerate while broken", () => {
    const s = standing();
    s.fighters[1].action = "shieldBroken";
    s.fighters[1].hitstun = 100;
    s.fighters[1].shieldHealth = 0;
    expect(play(s, 10, () => [0, 0]).at(-1)!.state.fighters[1].shieldHealth).toBe(0);
  });

  it("mashes out 5.4 frames a button press faster", () => {
    const s = standing();
    s.fighters[1].action = "shieldBroken";
    s.fighters[1].hitstun = 100;
    const still = play(cloneState(s), 10, () => [0, 0]).at(-1)!.state.fighters[1].hitstun;
    const mashed = play(s, 10, (i) => [0, i % 2 === 0 ? Btn.Attack : 0]).at(-1)!.state.fighters[1].hitstun;
    // Five presses: 27 frames earned.
    expect(still - mashed).toBe(27);
  });
});
```

Create `src/engine/shield.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import fc from "fast-check";

import { ONE, fx, toFloat } from "./fixed";
import {
  attackerShieldPushback,
  mashFrames,
  shieldBreakStun,
  shieldDamage,
  shieldPushback,
  shieldScale,
} from "./shield";
import { emptyCombat } from "./combat";
import { shieldstunExact } from "./knockback";
import * as ref from "../../research/rebuild-2026-10/tools/ssbu_ref.mjs";

describe("shield arithmetic (Plan 3, Task 9)", () => {
  // SmashWiki "Shield" (https://www.ssbwiki.com/Shield), Ultimate: damage ×1.19.
  it("takes 1.19x the hit's damage off the shield", () => {
    expect(toFloat(shieldDamage(fx(10)))).toBeCloseTo(11.9, 3);
    fc.assert(
      fc.property(fc.double({ min: 0, max: 40, noNaN: true }), (d) => {
        expect(Math.abs(toFloat(shieldDamage(fx(d))) - ref.shieldDamage(toFloat(fx(d))))).toBeLessThan(2 / ONE);
      }),
    );
  });

  // SmashWiki "Shield": size = (HP / 50) × 0.85 + 0.15.
  it.each([
    [50, 1],
    [25, 0.575],
    [0, 0.15],
  ])("scales a shield with %f HP to %f of its radius", (hp, scale) => {
    expect(toFloat(shieldScale(fx(hp)))).toBeCloseTo(scale, 3);
  });

  // SmashWiki "Shield": defender pushback (shieldstun + 1) × 0.09, at most 1.3;
  // rubendal `AttackerShieldPushback`: 0.04 × damage + 0.025, none for a projectile.
  // "Shieldstun is not rounded down" (SmashWiki "Shield", pushback table), as in
  // rubendal `ShieldPushback`: ((damage × 0.8 × mults) + 3) × 0.09.
  it("pushes the defender back (shieldstun + 1) x 0.09 on the unrounded shieldstun, capped at 1.3", () => {
    for (let ss = 0; ss <= 30; ss++) {
      expect(toFloat(shieldPushback(ss * ONE))).toBeCloseTo(ref.shieldPushback(ss), 3);
    }
    for (const d of [3, 7.5, 11.2]) {
      expect(toFloat(shieldPushback(shieldstunExact(fx(d))))).toBeCloseTo((d * 0.8 + 3) * 0.09, 3);
    }
    expect(shieldPushback(60 * ONE)).toBe(fx(1.3));
  });

  it("pushes a melee attacker back 0.04 x damage + 0.025", () => {
    expect(toFloat(attackerShieldPushback(fx(10)))).toBeCloseTo(0.425, 3);
  });

  // SmashWiki "Stun" (https://www.ssbwiki.com/Stun): from Brawl on, shield-break
  // stun is 400 − p frames; at 400% or more it ends at once.
  it("stuns a broken shield's owner for 400 - percent frames", () => {
    expect(shieldBreakStun(0)).toBe(400);
    expect(shieldBreakStun(fx(99.5))).toBe(300);
    expect(shieldBreakStun(fx(400))).toBe(0);
    expect(shieldBreakStun(fx(999))).toBe(0);
  });

  // SmashWiki "Stun": mashing takes 5.4 frames a button and 3 a stick input in Ultimate.
  it("turns mash presses into whole frames, carrying the fraction", () => {
    const c = emptyCombat();
    // Tenths of a frame: 5.4 a button, 3 a stick input.
    expect(mashFrames(c, 1, 0, 54, 30)).toBe(5);
    expect(mashFrames(c, 1, 0, 54, 30)).toBe(5);
    expect(mashFrames(c, 1, 0, 54, 30)).toBe(6);
    expect(mashFrames(c, 0, 1, 54, 30)).toBe(3);
    expect(mashFrames(c, 0, 0, 54, 30)).toBe(0);
  });
});
```

- [ ] **Step 2: Run them**

Run: `pnpm vitest run src/engine/combat.test.ts src/engine/shield.test.ts`
Expected: FAIL — both files fail to load: `Failed to resolve import "./shield"`.

- [ ] **Step 3: Implement**

In `src/engine/combat.ts`, replace:

```ts
   */
  launchSource: number;
}

```

with:

```ts
   */
  launchSource: number;
  /** Tenths of a frame mashing has earned but not yet spent (`mashFrames`). */
  mash: number;
}

```

In `src/engine/combat.ts`, replace:

```ts
    launchFaf: 0,
    launchSource: -1,
  };
}
```

with:

```ts
    launchFaf: 0,
    launchSource: -1,
    mash: 0,
  };
}
```

In `src/engine/combat.ts`, replace:

```ts
    launchFaf: c.launchFaf,
    launchSource: c.launchSource,
  };
}
```

with:

```ts
    launchFaf: c.launchFaf,
    launchSource: c.launchSource,
    mash: c.mash,
  };
}
```

In `src/engine/constants.ts`, replace:

```ts
export const SHIELDSTUN_CAP = 60;

/** Frames of stun on a shield break, before the mash-out reduction. */
export const SHIELD_BREAK_STUN = 240;

/* ------------------------------------------------------------- movement -- */
```

with:

```ts
export const SHIELDSTUN_CAP = 60;

/**
 * The shieldBroken clip's length in the renderer (`render/poses/timing.ts`).
 * The engine's stun is `shieldBreakStun` (`shield.ts`): 400 − percent.
 */
export const SHIELD_BREAK_STUN = 240;

/** Shield damage is the hit's ×1.19 (SmashWiki "Shield", Ultimate). */
export const SHIELD_DAMAGE_RATIO: Ratio = [119, 100];
/** Shield size `(HP/50) × 0.85 + 0.15` of the full radius (SmashWiki "Shield"). */
export const SHIELD_SIZE_MIN = fx(0.15);
/** Defender pushback `min((shieldstun + 1) × 0.09, 1.3)` (SmashWiki "Shield"). */
export const SHIELD_PUSHBACK_RATIO: Ratio = [9, 100];
export const SHIELD_PUSHBACK_MAX = fx(1.3);
/** Attacker pushback `0.04 × damage + 0.025` (rubendal SSBU-Calculator `AttackerShieldPushback`). */
export const SHIELD_ATTACKER_PUSHBACK_RATIO: Ratio = [1, 25];
export const SHIELD_ATTACKER_PUSHBACK_ADD = fx(0.025);
/** Shield-break stun `400 − percent` frames (SmashWiki "Stun"). */
export const SHIELD_BREAK_STUN_BASE = 400;
/** A broken shield comes back at 37.5 HP, 75% (SmashWiki "Shield break"). */
export const SHIELD_BREAK_RESET = fx(37.5);
/**
 * Mashing out of shield-break stun, in tenths of a frame: 5.4 frames a button
 * press, 3 a stick input (SmashWiki "Stun").
 */
export const SHIELD_BREAK_MASH_BUTTON = 54;
export const SHIELD_BREAK_MASH_STICK = 30;
/**
 * After the stun, "every character has an animation for regaining
 * consciousness … (known internally as FuraFuraEnd), which lasts … 33 frames
 * from Smash 4 onward" (SmashWiki "Stun").
 */
export const FURAFURA_END_FRAMES = 33;

/* ------------------------------------------------------------- movement -- */
```

In `src/engine/hash.ts`, replace:

```ts
  x = mixInt(x, c.launchFaf);
  x = mixInt(x, c.launchSource);
  return x;
}
```

with:

```ts
  x = mixInt(x, c.launchFaf);
  x = mixInt(x, c.launchSource);
  x = mixInt(x, c.mash);
  return x;
}
```

In `src/engine/knockback.ts`, replace:

```ts
 */
export function computeShieldstun(damage: number, opts: ShieldstunOptions = {}): number {
  // Every multiplier is gathered first and applied as a single exact rational,
  // because the formula has exactly **one** floor and truncating between the
```

with:

```ts
 */
export function computeShieldstun(damage: number, opts: ShieldstunOptions = {}): number {
  const frames = Math.floor(shieldstunExact(damage, opts) / ONE);
  return clamp(frames, 0, SHIELDSTUN_CAP);
}

/**
 * Shieldstun before it is rounded down or capped, Q12: `0.8 × damage × type ×
 * move × projectile + 2`. Shield pushback reads this value — "shieldstun is
 * not rounded down" (SmashWiki "Shield", pushback table) — as rubendal's
 * `ShieldPushback` does.
 */
export function shieldstunExact(damage: number, opts: ShieldstunOptions = {}): number {
  // Every multiplier is gathered first and applied as a single exact rational,
  // because the formula has exactly **one** floor and truncating between the
```

In `src/engine/knockback.ts`, replace:

```ts
  if (opts.projectile) ratios.push(SHIELDSTUN_PROJECTILE);

  const v = byRatios(damage, ratios) + SHIELDSTUN_ADDEND;
  const frames = Math.floor(v / ONE);
  return clamp(frames, 0, SHIELDSTUN_CAP);
}

```

with:

```ts
  if (opts.projectile) ratios.push(SHIELDSTUN_PROJECTILE);

  return byRatios(damage, ratios) + SHIELDSTUN_ADDEND;
}

```

Create `src/engine/shield.ts`:

```ts
/**
 * Shield numbers (Plan 3, Task 9): what a hit costs a shield, how big the
 * shield is, how far both fighters slide apart, and how long a break stuns.
 *
 * Pure functions on Q12 values, like `knockback.ts`, so each published number
 * is pinned by exactly one test in `shield.test.ts`.
 */

import type { CombatState } from "./combat";
import {
  SHIELD_ATTACKER_PUSHBACK_ADD,
  SHIELD_ATTACKER_PUSHBACK_RATIO,
  SHIELD_BREAK_STUN_BASE,
  SHIELD_DAMAGE_RATIO,
  SHIELD_MAX_HEALTH,
  SHIELD_PUSHBACK_MAX,
  SHIELD_PUSHBACK_RATIO,
  SHIELD_SIZE_MIN,
} from "./constants";
import { ONE, byRatio, mul } from "./fixed";
import type { Capsule } from "./hitbox";
import { circle } from "./hitbox";
import { fighterParams } from "./params";
import type { FighterDef, FighterState } from "./types";

/** What a hit of `damage` takes off a shield: ×1.19 (SmashWiki "Shield", Ultimate). */
export function shieldDamage(damage: number): number {
  return byRatio(damage, SHIELD_DAMAGE_RATIO);
}

/**
 * The shield's size as a fraction of its full radius, Q12:
 * `(HP / 50) × 0.85 + 0.15` (SmashWiki "Shield"). A worn shield leaves the
 * body uncovered — a shield poke.
 */
export function shieldScale(health: number): number {
  const hp = health < 0 ? 0 : health > SHIELD_MAX_HEALTH ? SHIELD_MAX_HEALTH : health;
  return SHIELD_SIZE_MIN + Math.trunc(((ONE - SHIELD_SIZE_MIN) * hp) / SHIELD_MAX_HEALTH);
}

/**
 * How far a shielding defender slides, Q12 units a frame:
 * `min((shieldstun + 1) × 0.09, 1.3)` on the shieldstun *before* rounding,
 * Q12 (`shieldstunExact`) — SmashWiki "Shield" (pushback table); rubendal
 * SSBU-Calculator `ShieldPushback`.
 */
export function shieldPushback(shieldstun: number): number {
  const push = byRatio(shieldstun + ONE, SHIELD_PUSHBACK_RATIO);
  return push > SHIELD_PUSHBACK_MAX ? SHIELD_PUSHBACK_MAX : push;
}

/** How far a melee attacker slides off a shield: `0.04 × damage + 0.025` (rubendal `AttackerShieldPushback`). */
export function attackerShieldPushback(damage: number): number {
  return byRatio(damage, SHIELD_ATTACKER_PUSHBACK_RATIO) + SHIELD_ATTACKER_PUSHBACK_ADD;
}

/**
 * Shield-break stun in frames: `400 − p`, none at 400% or more
 * (SmashWiki "Stun", https://www.ssbwiki.com/Stun: "From Brawl onward, the
 * formula is changed to 400 − p"). `percent` is Q12.
 */
export function shieldBreakStun(percent: number): number {
  const frames = Math.floor((SHIELD_BREAK_STUN_BASE * ONE - percent) / ONE);
  return frames < 0 ? 0 : frames;
}

/**
 * Whole frames a mash takes off a struggle this frame: `buttons` presses at
 * `perButton` and `sticks` at `perStick`, both in **tenths of a frame** so the
 * published 5.4 and 14.4 stay exact, with the remainder carried in
 * `CombatState.mash`.
 */
export function mashFrames(c: CombatState, buttons: number, sticks: number, perButton: number, perStick: number): number {
  c.mash += buttons * perButton + sticks * perStick;
  const whole = Math.trunc(c.mash / 10);
  c.mash -= whole * 10;
  return whole;
}

/**
 * The shield bubble: `shield_radius` (calculator `ShieldSize`) × the fighter's
 * `scale` × `shieldScale(health)`, centred half-way up the body. The centre is
 * UNVERIFIED — the game hangs the shield on a bone, which Plan 4's bake will
 * provide; until then the middle of the hurtbox stands in for it.
 */
export function shieldBubble(f: Pick<FighterState, "x" | "y" | "shieldHealth">, def: FighterDef): Capsule {
  const p = fighterParams(def);
  const r = mul(mul(p.shield_radius, p.scale), shieldScale(f.shieldHealth));
  return circle(f.x, f.y + Math.trunc(def.attributes.height / 2), r);
}
```

In `src/engine/simulate.ts`, replace:

```ts
  ONE_ON_ONE_MULTIPLIER,
  SDI_DISTANCE,
  SHIELD_BREAK_STUN,
  SHIELD_DECAY_PER_FRAME,
  SHIELD_MAX_HEALTH,
```

with:

```ts
  ONE_ON_ONE_MULTIPLIER,
  SDI_DISTANCE,
  SHIELD_DECAY_PER_FRAME,
  SHIELD_MAX_HEALTH,
```

In `src/engine/simulate.ts`, replace:

```ts
  computeStaleness,
  effectiveHitstun,
  applyDI,
  applyLSI,
```

with:

```ts
  computeStaleness,
  effectiveHitstun,
  shieldstunExact,
  applyDI,
  applyLSI,
```

In `src/engine/simulate.ts`, replace:

```ts
import { LEGACY_BONE_TABLE, type BoneTable } from "./acmd/bones";
import { cloneCombat, emptyCombat } from "./combat";
import { scriptHitboxes } from "./acmd/hitboxes";
import { moveScriptFrame } from "./acmd/run";
```

with:

```ts
import { LEGACY_BONE_TABLE, type BoneTable } from "./acmd/bones";
import { cloneCombat, emptyCombat } from "./combat";
import {
  attackerShieldPushback,
  shieldBreakStun,
  shieldBubble,
  shieldDamage,
  shieldPushback,
} from "./shield";
import { scriptHitboxes } from "./acmd/hitboxes";
import { moveScriptFrame } from "./acmd/run";
```

In `src/engine/simulate.ts`, replace:

```ts
/** Extra frames an attacker eats for having its move parried. */
export const PARRY_PUNISH_FRAMES = 20;
/** Pushback applied to a shielding fighter, per point of damage absorbed. */
export const SHIELD_PUSHBACK = fx(0.06);
/** The Smash Ball's radius, and how hard it drifts. */
export const SMASH_BALL_RADIUS = fx(6);
```

with:

```ts
/** Extra frames an attacker eats for having its move parried. */
export const PARRY_PUNISH_FRAMES = 20;
/** The Smash Ball's radius, and how hard it drifts. */
export const SMASH_BALL_RADIUS = fx(6);
```

In `src/engine/simulate.ts`, replace:

```ts
        f.shieldHealth = 0;
        startAction(f, "shieldBroken");
        f.hitstun = SHIELD_BREAK_STUN;
        events.shieldBreaks.push(f.port);
      }
    } else if (f.shieldHealth < SHIELD_MAX_HEALTH) {
      f.shieldHealth = Math.min(SHIELD_MAX_HEALTH, f.shieldHealth + SHIELD_REGEN_PER_FRAME);
    }
```

with:

```ts
        f.shieldHealth = 0;
        startAction(f, "shieldBroken");
        f.hitstun = shieldBreakStun(f.damage);
        events.shieldBreaks.push(f.port);
      }
    } else if (f.action !== "shieldBroken" && f.shieldHealth < SHIELD_MAX_HEALTH) {
      // A broken shield does not regrow during the stun; it comes back at 37.5
      // when the stun ends (FURAFURA, SmashWiki "Shield break").
      f.shieldHealth = Math.min(SHIELD_MAX_HEALTH, f.shieldHealth + SHIELD_REGEN_PER_FRAME);
    }
```

In `src/engine/simulate.ts`, replace:

```ts
  // a shield hit included, marked so it stales at 0.85 (SmashWiki "Stale-move
  // negation": hitting a shield enters the queue in Ultimate, perfect shield too).
  const onShield = shieldCovers(victim, c.x);
  if (c.slot !== null && attacker.hitThisMove.length === 1) {
    attacker.staleQueue.unshift(c.slot);
```

with:

```ts
  // a shield hit included, marked so it stales at 0.85 (SmashWiki "Stale-move
  // negation": hitting a shield enters the queue in Ultimate, perfect shield too).
  // The hit must reach the shield bubble too: a worn shield shrinks to 15% of
  // its radius and a hit that misses it lands on the body — a shield poke.
  const bubble = shieldBubble(victim, victimDef);
  const onShield =
    shieldCovers(victim, c.x) && circlesOverlap(c.x, c.y, hb.radius, bubble.x1, bubble.y1, bubble.r);
  if (c.slot !== null && attacker.hitThisMove.length === 1) {
    attacker.staleQueue.unshift(c.slot);
```

In `src/engine/simulate.ts`, replace:

```ts
      moveMultiplier: hb.hitlagMultiplier,
    });
    victim.shieldHealth -= damage;
    victim.hitstun = computeShieldstun(damage, {
      smash: c.slot !== null && isSmashSlot(c.slot),
      aerial: c.slot !== null && isAerialSlot(c.slot),
```

with:

```ts
      moveMultiplier: hb.hitlagMultiplier,
    });
    victim.shieldHealth -= shieldDamage(damage);
    const stunOpts = {
      smash: c.slot !== null && isSmashSlot(c.slot),
      aerial: c.slot !== null && isAerialSlot(c.slot),
```

In `src/engine/simulate.ts`, replace:

```ts
      projectile: fromProjectile,
      moveMultiplier: hb.shieldstunMultiplier,
    });
    victim.hitlag = lag;
    if (!fromProjectile) attacker.hitlag = lag;
    kineticSetX(victim, (victim.x < c.x ? -1 : 1) * mul(damage, SHIELD_PUSHBACK), "stop");
    if (victim.shieldHealth <= 0) {
      victim.shieldHealth = 0;
      startAction(victim, "shieldBroken");
      victim.hitstun = SHIELD_BREAK_STUN;
      events.shieldBreaks.push(victim.port);
    } else {
```

with:

```ts
      projectile: fromProjectile,
      moveMultiplier: hb.shieldstunMultiplier,
    };
    victim.hitstun = computeShieldstun(damage, stunOpts);
    victim.hitlag = lag;
    if (!fromProjectile) attacker.hitlag = lag;
    const away = victim.x < c.x ? -1 : 1;
    // Pushback reads the shieldstun *before* it is rounded (SmashWiki "Shield").
    kineticSetX(victim, away * shieldPushback(shieldstunExact(damage, stunOpts)), "stop");
    // A melee attacker on the ground slides back off the shield too; a
    // projectile's owner is not there to be pushed (rubendal `AttackerShieldPushback`).
    if (!fromProjectile && attacker.grounded) kineticSetX(attacker, -away * attackerShieldPushback(damage));
    if (victim.shieldHealth <= 0) {
      victim.shieldHealth = 0;
      startAction(victim, "shieldBroken");
      victim.hitstun = shieldBreakStun(victim.damage);
      events.shieldBreaks.push(victim.port);
    } else {
```

In `src/engine/states.ts`, replace:

```ts
    soft,
  };
}

```

with:

```ts
    soft,
  };
}

/**
 * Fresh button presses this frame, for a mash (shield-break stun, a grab):
 * attack, special, jump, shield and grab each count once. A stick input is a
 * fresh direction press: `framesSinceDirPress === 0` (Plan 3, Task 9).
 */
export function buttonPresses(intent: Intent): number {
  let n = 0;
  if (intent.attackPressed) n += 1;
  if (intent.specialPressed) n += 1;
  if (intent.jumpPressed) n += 1;
  if (intent.shieldPressed) n += 1;
  if (intent.grabPressed) n += 1;
  return n;
}

```

In `src/engine/status/guard.ts`, replace:

```ts
  AIR_DODGE_FRAMES,
  DIRECTIONAL_AIR_DODGE_FRAMES,
  ROLL_FRAMES,
  SHIELD_MIN_HOLD,
  SHIELD_RELEASE_FRAMES,
```

with:

```ts
  AIR_DODGE_FRAMES,
  DIRECTIONAL_AIR_DODGE_FRAMES,
  FURAFURA_END_FRAMES,
  ROLL_FRAMES,
  SHIELD_BREAK_MASH_BUTTON,
  SHIELD_BREAK_MASH_STICK,
  SHIELD_BREAK_RESET,
  SHIELD_MIN_HOLD,
  SHIELD_RELEASE_FRAMES,
```

In `src/engine/status/guard.ts`, replace:

```ts
} from "../constants";
import { kineticSetX } from "../kinetic";
import {
  ROLL_DISTANCE,
  SHIELD_START_FRAMES,
  bufferPress,
  hasMove,
  presses,
```

with:

```ts
} from "../constants";
import { kineticSetX } from "../kinetic";
import { mashFrames } from "../shield";
import {
  ROLL_DISTANCE,
  SHIELD_START_FRAMES,
  bufferPress,
  buttonPresses,
  hasMove,
  presses,
```

In `src/engine/status/guard.ts`, replace:

```ts
  action: "shieldBroken",
  kineticType: "GROUND_STOP",
  main(f) {
    if (f.hitstun > 0) return;
    startAction(f, "stand");
  },
```

with:

```ts
  action: "shieldBroken",
  kineticType: "GROUND_STOP",
  main(f, intent) {
    // `charge` is free in this status: 0 while stunned, 1 in FuraFuraEnd.
    if (f.hitstun > 0) {
      if (f.charge === 1) return;
      // Mashing: 5.4 frames a button press, 3 a stick input (SmashWiki "Stun").
      const sticks = f.framesSinceDirPress === 0 ? 1 : 0;
      const earned = mashFrames(f.combat, buttonPresses(intent), sticks, SHIELD_BREAK_MASH_BUTTON, SHIELD_BREAK_MASH_STICK);
      f.hitstun = Math.max(0, f.hitstun - earned);
      return;
    }
    if (f.charge === 0) {
      // FuraFuraEnd: the fighter comes to for 33 frames, still unable to act
      // (SmashWiki "Stun"), and mashing no longer helps.
      f.charge = 1;
      f.hitstun = FURAFURA_END_FRAMES;
      f.combat.mash = 0;
      return;
    }
    // The shield comes back at 75% (SmashWiki "Shield break"), not empty.
    f.shieldHealth = SHIELD_BREAK_RESET;
    startAction(f, "stand");
  },
```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/engine/combat.test.ts src/engine/shield.test.ts`
Expected: PASS.

- [ ] **Step 5: The golden trace**

Run: `pnpm vitest run src/game/golden.test.ts`
Expected before regenerating: FAIL in the Donkey Kong–Pikachu and Link–Samus matches — shields drain faster and push both fighters apart by the published amounts. Regenerate.

```bash
UPDATE_GOLDEN=1 pnpm vitest run src/game/golden.test.ts
pnpm vitest run src/game/golden.test.ts
```

Expected: the second run PASSes. This task changes behaviour on purpose; its commit says so.

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0 (`pnpm lint` reports only the two pre-existing warnings in `research/rebuild-2026-10/tools/sim_bench.mjs`).

- [ ] **Step 7: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/src/engine/combat.test.ts \
  super-smash/src/engine/combat.ts \
  super-smash/src/engine/constants.ts \
  super-smash/src/engine/hash.ts \
  super-smash/src/engine/knockback.ts \
  super-smash/src/engine/shield.test.ts \
  super-smash/src/engine/shield.ts \
  super-smash/src/engine/simulate.ts \
  super-smash/src/engine/states.ts \
  super-smash/src/engine/status/guard.ts \
  super-smash/src/game/__golden__/engine-trace.json
git commit -m "super-smash: shields take x1.19, shrink, push back, and break for 400 - p" -m "SmashWiki 'Shield' (pushback on unrounded shieldstun), 'Shield break', 'Stun' (400 - p, then 33 frames of FuraFuraEnd). shield.ts holds the arithmetic; a worn shield can be poked. Golden trace regenerated." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Perfect shield hitlag, direct and indirect

A parry froze the attacker for a flat 20 frames and the defender not at all. SmashWiki "Perfect shield" (Ultimate) gives extra hitlag on top of the hit's *shield* hitlag (×0.67): direct melee attacker +14 / defender +11 — "the defender can act 3 frames earlier than shielding the attack normally" — indirect melee +14 / +2, projectile 0 / +8 direct, 0 / −1 indirect. `Hitbox.direct` (smash-script's flag) decides direct; absent means direct for a fighter's own move and indirect for a projectile. A perfect shield pushes the defender back 0.15 as far (SmashWiki "Shield", pushback table: "0.15 for a perfect shield"). Review Focus #2 (a parried projectile) is here.

**Files:**
- Modify: `super-smash/src/engine/combat.test.ts`
- Modify: `super-smash/src/engine/constants.ts`
- Modify: `super-smash/src/engine/shield.test.ts`
- Modify: `super-smash/src/engine/shield.ts`
- Modify: `super-smash/src/engine/simulate.ts`
- Modify: `super-smash/src/engine/types.ts`
- Modify: `super-smash/src/game/__golden__/engine-trace.json` (regenerated by a command in this task)

**Interfaces:** Adds `perfectShieldHitlag(lag: number, projectile: boolean, direct: boolean): { attacker: number; defender: number }` (`shield.ts`); `PARRY_MELEE_DIRECT = [14, 11]`, `PARRY_MELEE_INDIRECT = [14, 2]`, `PARRY_PROJECTILE_DIRECT = [0, 8]`, `PARRY_PROJECTILE_INDIRECT = [0, -1]`, `PERFECT_SHIELD_PUSHBACK_RATIO: Ratio = [3, 20]`; `Hitbox.direct?: boolean`. The shield path computes its hitlag, shieldstun options and pushback before the parry check, which reuses them. Removes `PARRY_PUNISH_FRAMES` (`simulate.ts`, no other reader).

- [ ] **Step 1: Write the failing tests**

In `src/engine/combat.test.ts`, replace:

```ts
  GROUNDED_ZERO_LAUNCH_RATIO,
  LAUNCH_SPEED_RATIO,
  SHIELD_BREAK_RESET,
  SHIELD_DECAY_PER_FRAME,
  SHIELD_REGEN_PER_FRAME,
} from "./constants";
import { hashState } from "./hash";
import { STALE_FRESH_BONUS, computeHitstun, effectiveHitstun, shieldstunExact } from "./knockback";
import { attackerShieldPushback, shieldDamage, shieldPushback } from "./shield";
import { cloneState, createInitialState, step } from "./simulate";
```

with:

```ts
  GROUNDED_ZERO_LAUNCH_RATIO,
  LAUNCH_SPEED_RATIO,
  PERFECT_SHIELD_PUSHBACK_RATIO,
  SHIELD_BREAK_RESET,
  SHIELD_DECAY_PER_FRAME,
  SHIELD_MAX_HEALTH,
  SHIELD_REGEN_PER_FRAME,
} from "./constants";
import { hashState } from "./hash";
import {
  STALE_FRESH_BONUS,
  computeHitlag,
  computeHitstun,
  effectiveHitstun,
  shieldstunExact,
} from "./knockback";
import { attackerShieldPushback, shieldDamage, shieldPushback } from "./shield";
import { cloneState, createInitialState, step } from "./simulate";
```

Append to the end of `src/engine/combat.test.ts`:

```ts
/* ------------------------------------------- Task 10: perfect shield -- */

describe("perfect shield (Plan 3, Task 10)", () => {
  /**
   * Fighter 0 attacks with `attack`; fighter 1 shields and lets go so that the
   * hit lands on frame 2 of the drop — inside the 5-frame parry window.
   */
  function parried(def: FighterDef, attack: (i: number) => InputFrame, gap: number): Frame {
    const ctx = ctxFor(def);
    const setup = (): GameState => {
      const s = standing(ctx);
      s.fighters[1].x = fx(gap);
      // Shield already up long enough to be dropped (SHIELD_MIN_HOLD).
      s.fighters[1].action = "shield";
      s.fighters[1].actionFrame = 10;
      return s;
    };
    // Where a held shield takes the hit…
    const held = play(setup(), 40, (i) => [attack(i), Btn.Shield], ctx);
    const k = held.findIndex((f) => f.events.shieldHits.length > 0);
    // …and the same exchange with the shield dropped two frames before it.
    return play(setup(), k + 1, (i) => [attack(i), i < k - 2 ? Btn.Shield : 0], ctx)[k];
  }
  // The extra hitlag rides on the *shield* hitlag (×0.67).
  const JAB_DMG = mul(fx(10), STALE_FRESH_BONUS);
  const JAB_LAG = computeHitlag(JAB_DMG, { shielding: true });

  it("freezes a direct melee attacker 14 frames and the defender 11 beyond the hit", () => {
    const at = parried(BASE_DEF, (i) => (i === 0 ? Btn.Attack : 0), 8);
    const [attacker, defender] = at.state.fighters;
    expect(defender.action).toBe("shieldRelease");
    expect(at.events.shieldHits).toHaveLength(1);
    expect(attacker.hitlag).toBe(JAB_LAG + 14);
    expect(defender.hitlag).toBe(JAB_LAG + 11);
    // 0.15 of a normal shield's pushback, away from the attacker.
    expect(defender.vx).toBe(byRatio(shieldPushback(shieldstunExact(JAB_DMG)), PERFECT_SHIELD_PUSHBACK_RATIO));
    expect(defender.shieldHealth).toBe(SHIELD_MAX_HEALTH);
  });

  // Review Focus #2: a parried projectile freezes nobody far away and costs the
  // defender a frame, not eleven.
  it("parries a projectile without freezing its thrower, 1 frame short for the defender", () => {
    const pellet = hitbox({ startFrame: 1, endFrame: 90, x: 0, y: 0, damage: fx(6) });
    const shooter: FighterDef = {
      ...BASE_DEF,
      moves: {
        ...BASE_DEF.moves,
        neutralB: move("neutralB", {
          totalFrames: 30,
          hitboxes: [],
          projectiles: [
            { id: "pellet", spawnFrame: 6, offsetX: fx(6), offsetY: fx(6), vx: fx(4), vy: 0, gravity: 0, lifetime: 90, hitbox: pellet, destroyOnHit: true, visual: "energy" },
          ],
        }),
      },
    };
    const at = parried(shooter, (i) => (i === 0 ? Btn.Special : 0), 40);
    const [owner, defender] = at.state.fighters;
    const pelletLag = computeHitlag(fx(6), { shielding: true });
    expect(at.events.shieldHits).toHaveLength(1);
    expect(owner.hitlag).toBe(0);
    expect(defender.hitlag).toBe(pelletLag - 1);
  });
});
```

In `src/engine/shield.test.ts`, replace:

```ts
  attackerShieldPushback,
  mashFrames,
  shieldBreakStun,
  shieldDamage,
```

with:

```ts
  attackerShieldPushback,
  mashFrames,
  perfectShieldHitlag,
  shieldBreakStun,
  shieldDamage,
```

Append to the end of `src/engine/shield.test.ts`:

```ts
describe("perfect shield hitlag (Plan 3, Task 10)", () => {
  // SmashWiki "Perfect shield" (https://www.ssbwiki.com/Perfect_shield), Ultimate,
  // extra hitlag attacker/defender: direct non-projectile +14/+11, indirect
  // non-projectile +14/+2, direct projectile 0/+8, indirect projectile 0/−1.
  it.each([
    [false, true, 24, 21],
    [false, false, 24, 12],
    [true, true, 0, 18],
    [true, false, 0, 9],
  ])("projectile %s, direct %s: attacker %i, defender %i on a 10-frame hit", (projectile, direct, attacker, defender) => {
    expect(perfectShieldHitlag(10, projectile, direct)).toEqual({ attacker, defender });
  });

  it("never freezes anyone for a negative time", () => {
    expect(perfectShieldHitlag(0, true, false)).toEqual({ attacker: 0, defender: 0 });
  });
});
```

- [ ] **Step 2: Run them**

Run: `pnpm vitest run src/engine/combat.test.ts src/engine/shield.test.ts`
Expected: FAIL — the five `perfectShieldHitlag` cases (`perfectShieldHitlag is not a function`), `freezes a direct melee attacker 14 frames and the defender 11…` (`expected 20 to be 22`), `parries a projectile…` (`expected +0 to be 5`).

- [ ] **Step 3: Implement**

In `src/engine/constants.ts`, replace:

```ts
 */
export const PERFECT_SHIELD_WINDOW = 5;

/** shieldstun = floor(0.8 * damage * typeMult * moveMult * projMult + 2). */
```

with:

```ts
 */
export const PERFECT_SHIELD_WINDOW = 5;

/**
 * Extra hitlag on a perfect shield, [attacker, defender], added to the hit's
 * *shield* hitlag (×0.67) — SmashWiki "Perfect shield" (Ultimate): direct
 * non-projectile +14/+11 ("the defender can act 3 frames earlier than shielding
 * the attack normally"), indirect non-projectile +14/+2, direct projectile
 * 0/+8, indirect projectile 0/−1.
 */
export const PARRY_MELEE_DIRECT = [14, 11] as const;
export const PARRY_MELEE_INDIRECT = [14, 2] as const;
export const PARRY_PROJECTILE_DIRECT = [0, 8] as const;
export const PARRY_PROJECTILE_INDIRECT = [0, -1] as const;
/** A perfect shield's pushback is 0.15 of a normal shield's (SmashWiki "Shield", pushback table: "0.15 for a perfect shield"). */
export const PERFECT_SHIELD_PUSHBACK_RATIO: Ratio = [3, 20];

/** shieldstun = floor(0.8 * damage * typeMult * moveMult * projMult + 2). */
```

In `src/engine/shield.ts`, replace:

```ts
import type { CombatState } from "./combat";
import {
  SHIELD_ATTACKER_PUSHBACK_ADD,
  SHIELD_ATTACKER_PUSHBACK_RATIO,
```

with:

```ts
import type { CombatState } from "./combat";
import {
  PARRY_MELEE_DIRECT,
  PARRY_MELEE_INDIRECT,
  PARRY_PROJECTILE_DIRECT,
  PARRY_PROJECTILE_INDIRECT,
  SHIELD_ATTACKER_PUSHBACK_ADD,
  SHIELD_ATTACKER_PUSHBACK_RATIO,
```

Append to the end of `src/engine/shield.ts`:

```ts
/**
 * Hitlag on a perfect shield (SmashWiki "Perfect shield",
 * https://www.ssbwiki.com/Perfect_shield, Ultimate): on top of the hit's
 * shield hitlag `lag` (`computeHitlag(…, { shielding: true })`), a direct melee hit freezes the attacker 14 more frames
 * and the defender 11; an indirect melee hit 14 and 2; a projectile freezes its
 * thrower not at all and the defender 8 more (direct) or 1 fewer (indirect).
 */
export function perfectShieldHitlag(
  lag: number,
  projectile: boolean,
  direct: boolean,
): { attacker: number; defender: number } {
  const [a, d] = projectile
    ? direct
      ? PARRY_PROJECTILE_DIRECT
      : PARRY_PROJECTILE_INDIRECT
    : direct
      ? PARRY_MELEE_DIRECT
      : PARRY_MELEE_INDIRECT;
  const attacker = projectile ? 0 : lag + a;
  const defender = lag + d;
  return { attacker: attacker < 0 ? 0 : attacker, defender: defender < 0 ? 0 : defender };
}
```

In `src/engine/simulate.ts`, replace:

```ts
  LAUNCH_SPEED_RATIO,
  ONE_ON_ONE_MULTIPLIER,
  SDI_DISTANCE,
  SHIELD_DECAY_PER_FRAME,
```

with:

```ts
  LAUNCH_SPEED_RATIO,
  ONE_ON_ONE_MULTIPLIER,
  PERFECT_SHIELD_PUSHBACK_RATIO,
  SDI_DISTANCE,
  SHIELD_DECAY_PER_FRAME,
```

In `src/engine/simulate.ts`, replace:

```ts
import {
  attackerShieldPushback,
  shieldBreakStun,
  shieldBubble,
```

with:

```ts
import {
  attackerShieldPushback,
  perfectShieldHitlag,
  shieldBreakStun,
  shieldBubble,
```

In `src/engine/simulate.ts`, replace:

```ts
/** Frames the whole game freezes for on a KO, for the drama. */
export const KO_FREEZE_FRAMES = 14;
/** Extra frames an attacker eats for having its move parried. */
export const PARRY_PUNISH_FRAMES = 20;
/** The Smash Ball's radius, and how hard it drifts. */
export const SMASH_BALL_RADIUS = fx(6);
```

with:

```ts
/** Frames the whole game freezes for on a KO, for the drama. */
export const KO_FREEZE_FRAMES = 14;
/** The Smash Ball's radius, and how hard it drifts. */
export const SMASH_BALL_RADIUS = fx(6);
```

In `src/engine/simulate.ts`, replace:

```ts
  /* ---- the shield path ---- */
  if (onShield) {
    if (isParrying(victim)) {
      // Perfect shield: no shield damage, no shieldstun, and the attacker is the
      // one left standing there. This is the whole reward for shielding on
      // release rather than on press — though parrying a projectile punishes
      // nobody, since the fighter who threw it is a stage away.
      if (!fromProjectile) attacker.hitlag = Math.max(attacker.hitlag, PARRY_PUNISH_FRAMES);
      events.shieldHits.push({ victim: victim.port, x: c.x, y: c.y });
      return;
    }
    const lag = computeHitlag(damage, {
      electric: hb.effect === "electric",
```

with:

```ts
  /* ---- the shield path ---- */
  if (onShield) {
    const lag = computeHitlag(damage, {
      electric: hb.effect === "electric",
```

In `src/engine/simulate.ts`, replace:

```ts
      moveMultiplier: hb.hitlagMultiplier,
    });
    victim.shieldHealth -= shieldDamage(damage);
    const stunOpts = {
      smash: c.slot !== null && isSmashSlot(c.slot),
```

with:

```ts
      moveMultiplier: hb.hitlagMultiplier,
    });
    const stunOpts = {
      smash: c.slot !== null && isSmashSlot(c.slot),
```

In `src/engine/simulate.ts`, replace:

```ts
      moveMultiplier: hb.shieldstunMultiplier,
    };
    victim.hitstun = computeShieldstun(damage, stunOpts);
    victim.hitlag = lag;
    if (!fromProjectile) attacker.hitlag = lag;
    const away = victim.x < c.x ? -1 : 1;
    // Pushback reads the shieldstun *before* it is rounded (SmashWiki "Shield").
    kineticSetX(victim, away * shieldPushback(shieldstunExact(damage, stunOpts)), "stop");
    // A melee attacker on the ground slides back off the shield too; a
    // projectile's owner is not there to be pushed (rubendal `AttackerShieldPushback`).
```

with:

```ts
      moveMultiplier: hb.shieldstunMultiplier,
    };
    const away = victim.x < c.x ? -1 : 1;
    // Pushback reads the shieldstun *before* it is rounded (SmashWiki "Shield").
    const pushback = shieldPushback(shieldstunExact(damage, stunOpts));
    if (isParrying(victim)) {
      // Perfect shield: no shield damage, no shieldstun, and the attacker is the
      // one left standing there — frozen longer than the defender, by the
      // published amounts on top of the *shield* hitlag (SmashWiki "Perfect
      // shield": the defender "can act 3 frames earlier than shielding the attack
      // normally"; rubendal `ParryHitlag`). Pushback is 0.15 of a normal shield's.
      // A parried projectile freezes nobody a stage away.
      const parry = perfectShieldHitlag(lag, fromProjectile, hb.direct ?? !fromProjectile);
      victim.hitlag = parry.defender;
      if (!fromProjectile) attacker.hitlag = parry.attacker;
      kineticSetX(victim, away * byRatio(pushback, PERFECT_SHIELD_PUSHBACK_RATIO), "stop");
      if (!fromProjectile && attacker.grounded) kineticSetX(attacker, -away * attackerShieldPushback(damage));
      events.shieldHits.push({ victim: victim.port, x: c.x, y: c.y });
      return;
    }
    victim.shieldHealth -= shieldDamage(damage);
    victim.hitstun = computeShieldstun(damage, stunOpts);
    victim.hitlag = lag;
    if (!fromProjectile) attacker.hitlag = lag;
    kineticSetX(victim, away * pushback, "stop");
    // A melee attacker on the ground slides back off the shield too; a
    // projectile's owner is not there to be pushed (rubendal `AttackerShieldPushback`).
```

In `src/engine/types.ts`, replace:

```ts
  /** This hitbox grabs rather than damages. */
  readonly grabbing?: boolean;
}

```

with:

```ts
  /** This hitbox grabs rather than damages. */
  readonly grabbing?: boolean;
  /**
   * smash-script `direct`: the hit comes from the fighter's own body. Absent
   * means direct for a fighter's move and indirect for a projectile — what a
   * perfect shield's hitlag depends on (Plan 3, Task 10).
   */
  readonly direct?: boolean;
}

```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/engine/combat.test.ts src/engine/shield.test.ts`
Expected: PASS.

- [ ] **Step 5: The golden trace**

Run: `pnpm vitest run src/game/golden.test.ts`
Expected before regenerating: FAIL in the Mario–Fox, Donkey Kong–Pikachu and Link–Samus matches, which have parries. Regenerate.

```bash
UPDATE_GOLDEN=1 pnpm vitest run src/game/golden.test.ts
pnpm vitest run src/game/golden.test.ts
```

Expected: the second run PASSes. This task changes behaviour on purpose; its commit says so.

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0 (`pnpm lint` reports only the two pre-existing warnings in `research/rebuild-2026-10/tools/sim_bench.mjs`).

- [ ] **Step 7: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/src/engine/combat.test.ts \
  super-smash/src/engine/constants.ts \
  super-smash/src/engine/shield.test.ts \
  super-smash/src/engine/shield.ts \
  super-smash/src/engine/simulate.ts \
  super-smash/src/engine/types.ts \
  super-smash/src/game/__golden__/engine-trace.json
git commit -m "super-smash: perfect shield hitlag from the published table" -m "SmashWiki 'Perfect shield' (Ultimate): on top of the shield hitlag, +14/+11 direct melee, +14/+2 indirect, 0/+8 and 0/−1 for projectiles; pushback x0.15. Hitbox.direct carries smash-script's flag. Golden trace regenerated." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: SDI ×1.15 from a string's sixth hit; ASDI for electric and paralyzing hits

SmashWiki "Smash directional influence" (Ultimate): 2 units a pulse, and "for every five consecutive hits a character takes, the SDI distance for the next five hits is increased by 1.15×". Whether it compounds past the tenth hit is not published; here it does not (UNVERIFIED). `CombatState.comboHits` counts hits taken and resets when hitstun ends. Automatic SDI exists in Ultimate only for electric, paralyze, crumple and autoshift hits, and not for a launch between 70° and just under 110°; the replica has electric and paralyze effects, so those shift the victim toward the held stick when the freeze ends. Its distance is not published: half an SDI pulse, UNVERIFIED.

**Files:**
- Modify: `super-smash/src/engine/combat.test.ts`
- Modify: `super-smash/src/engine/combat.ts`
- Modify: `super-smash/src/engine/constants.ts`
- Modify: `super-smash/src/engine/hash.ts`
- Modify: `super-smash/src/engine/simulate.ts`

**Interfaces:** Adds `SDI_COMBO_HITS = 5`, `SDI_COMBO_RATIO: Ratio = [23, 20]`, `ASDI_DISTANCE = fx(1)` (UNVERIFIED), `ASDI_VERTICAL = [fx(70), fx(110)]`; `CombatState.comboHits`, `CombatState.asdi`.

- [ ] **Step 1: Write the failing tests**

In `src/engine/combat.test.ts`, replace:

```ts
import { byRatio, fx, mul } from "./fixed";
import {
  FURAFURA_END_FRAMES,
  GROUNDED_ZERO_LAUNCH_RATIO,
  LAUNCH_SPEED_RATIO,
  PERFECT_SHIELD_PUSHBACK_RATIO,
  SHIELD_BREAK_RESET,
  SHIELD_DECAY_PER_FRAME,
```

with:

```ts
import { byRatio, fx, mul } from "./fixed";
import {
  ASDI_DISTANCE,
  FURAFURA_END_FRAMES,
  GROUNDED_ZERO_LAUNCH_RATIO,
  LAUNCH_SPEED_RATIO,
  PERFECT_SHIELD_PUSHBACK_RATIO,
  SDI_DISTANCE,
  SHIELD_BREAK_RESET,
  SHIELD_DECAY_PER_FRAME,
```

Append to the end of `src/engine/combat.test.ts`:

```ts
/* --------------------------------------------- Task 11: SDI and ASDI -- */

describe("SDI and ASDI (Plan 3, Task 11)", () => {
  /** Fighter 1 frozen in hitlag with `hits` consecutive hits taken, pulsing SDI right. */
  function pulse(hits: number): number {
    const s = standing();
    const v = s.fighters[1];
    v.action = "hitstun";
    v.hitstun = 20;
    v.hitlag = 4;
    v.combat.comboHits = hits;
    const x0 = v.x;
    return play(s, 1, () => [0, Btn.Right]).at(-1)!.state.fighters[1].x - x0;
  }

  // SmashWiki "Smash directional influence" (https://www.ssbwiki.com/Smash_directional_influence):
  // 2 units a pulse in Ultimate, and "for every five consecutive hits a character
  // takes, the SDI distance for the next five hits is increased by 1.15×".
  it("moves 2 units a pulse for the first five hits of a string", () => {
    expect(pulse(5)).toBe(SDI_DISTANCE);
  });

  it("moves 1.15 times as far from the sixth consecutive hit", () => {
    expect(pulse(6)).toBe(Math.trunc((SDI_DISTANCE * 23) / 20));
  });

  it("counts each hit taken, and forgets the string once hitstun is over", () => {
    const hit = play(standing(), 8, JAB);
    const i = hit.findIndex((f) => f.events.hits.length > 0);
    expect(hit[i].state.fighters[1].combat.comboHits).toBe(1);
    const s = standing();
    s.fighters[1].combat.comboHits = 7;
    expect(play(s, 1, () => [0, 0]).at(-1)!.state.fighters[1].combat.comboHits).toBe(0);
  });

  /** Fighter 1's position change on the frame its hitlag from `hb` ends, holding up. */
  function asdi(hb: Hitbox): number {
    const def: FighterDef = { ...BASE_DEF, moves: { ...BASE_DEF.moves, jab1: move("jab1", { hitboxes: [hb] }) } };
    let s = standing(ctxFor(def));
    let prev: readonly InputFrame[] = [0, 0];
    for (let i = 0; i < 30; i++) {
      const v = s.fighters[1];
      const now = [i === 0 ? Btn.Attack : 0, v.hitlag > 0 ? Btn.Up : 0];
      const before = v.y;
      const wasFrozen = v.hitlag === 1;
      s = step(s, now, { prevInputs: prev, ctx: ctxFor(def) }).state;
      prev = now;
      if (wasFrozen) return s.fighters[1].y - before;
    }
    throw new Error("never released");
  }

  // SmashWiki "Smash directional influence": in Ultimate ASDI is "only applicable
  // on moves with an electric, paralyze, crumple, or autoshift effect", and not on
  // a launch between 70° and just under 110°.
  it("shifts the victim of an electric hit as the freeze ends", () => {
    expect(asdi(hitbox({ effect: "electric", angle: fx(45) }))).toBe(ASDI_DISTANCE);
  });

  it("does not shift the victim of an ordinary hit", () => {
    expect(asdi(hitbox({ angle: fx(45) }))).toBe(0);
  });

  it("does not shift the victim of a vertical electric hit", () => {
    expect(asdi(hitbox({ effect: "electric", angle: fx(90) }))).toBe(0);
  });
});
```

- [ ] **Step 2: Run them**

Run: `pnpm vitest run src/engine/combat.test.ts`
Expected: FAIL — `moves 1.15 times as far from the sixth consecutive hit` (`expected 8192 to be 9420`), `counts each hit taken…` (`expected undefined to be 1`), `shifts the victim of an electric hit…`.

- [ ] **Step 3: Implement**

In `src/engine/combat.ts`, replace:

```ts
  /** Tenths of a frame mashing has earned but not yet spent (`mashFrames`). */
  mash: number;
}

```

with:

```ts
  /** Tenths of a frame mashing has earned but not yet spent (`mashFrames`). */
  mash: number;
  /** Hits taken since this fighter was last out of hitstun: SDI grows ×1.15 past five (Task 11). */
  comboHits: number;
  /** The freeze now running is from a hit that grants automatic SDI when it ends (Task 11). */
  asdi: boolean;
}

```

In `src/engine/combat.ts`, replace:

```ts
    launchSource: -1,
    mash: 0,
  };
}
```

with:

```ts
    launchSource: -1,
    mash: 0,
    comboHits: 0,
    asdi: false,
  };
}
```

In `src/engine/combat.ts`, replace:

```ts
    launchSource: c.launchSource,
    mash: c.mash,
  };
}
```

with:

```ts
    launchSource: c.launchSource,
    mash: c.mash,
    comboHits: c.comboHits,
    asdi: c.asdi,
  };
}
```

Append to the end of `src/engine/constants.ts`:

```ts
/**
 * "For every five consecutive hits a character takes, the SDI distance for the
 * next five hits is increased by 1.15×" (SmashWiki "Smash directional
 * influence"). Whether the increase compounds past the tenth hit is not
 * published; here it does not (UNVERIFIED): ×1.15 from the sixth hit on.
 */
export const SDI_COMBO_HITS = 5;
export const SDI_COMBO_RATIO: Ratio = [23, 20];
/**
 * Automatic SDI: on the last frame of hitlag from an electric or paralyzing
 * hit that does not launch between 70° and 110°, the victim shifts toward the
 * held stick (SmashWiki "Smash directional influence", Ultimate). The wiki says
 * only that it is shorter than an SDI pulse; half of one is UNVERIFIED.
 */
export const ASDI_DISTANCE = fx(1);
export const ASDI_VERTICAL = [fx(70), fx(110)] as const;
```

In `src/engine/hash.ts`, replace:

```ts
  x = mixInt(x, c.launchSource);
  x = mixInt(x, c.mash);
  return x;
}
```

with:

```ts
  x = mixInt(x, c.launchSource);
  x = mixInt(x, c.mash);
  x = mixInt(x, c.comboHits);
  x = mixBool(x, c.asdi);
  return x;
}
```

In `src/engine/simulate.ts`, replace:

```ts
import { ONE, fx, mul, abs, byRatio, randomInt, nextRandom } from "./fixed";
import {
  FINAL_SMASH_STANDBY,
  GROUNDED_ZERO_LAUNCH_RATIO,
```

with:

```ts
import { ONE, fx, mul, abs, byRatio, randomInt, nextRandom } from "./fixed";
import {
  ASDI_DISTANCE,
  ASDI_VERTICAL,
  FINAL_SMASH_STANDBY,
  GROUNDED_ZERO_LAUNCH_RATIO,
```

In `src/engine/simulate.ts`, replace:

```ts
  ONE_ON_ONE_MULTIPLIER,
  PERFECT_SHIELD_PUSHBACK_RATIO,
  SDI_DISTANCE,
  SHIELD_DECAY_PER_FRAME,
```

with:

```ts
  ONE_ON_ONE_MULTIPLIER,
  PERFECT_SHIELD_PUSHBACK_RATIO,
  SDI_COMBO_HITS,
  SDI_COMBO_RATIO,
  SDI_DISTANCE,
  SHIELD_DECAY_PER_FRAME,
```

In `src/engine/simulate.ts`, replace:

```ts
      frozen[i] = true;
      if (intent.sdiX !== 0 || intent.sdiY !== 0) {
        f.x += intent.sdiX * SDI_DISTANCE;
        f.y += intent.sdiY * SDI_DISTANCE;
      }
      // ...and then, on the frame the freeze ends, the launch it was holding
```

with:

```ts
      frozen[i] = true;
      if (intent.sdiX !== 0 || intent.sdiY !== 0) {
        const pulse = sdiDistance(f);
        f.x += intent.sdiX * pulse;
        f.y += intent.sdiY * pulse;
      }
      // ...and then, on the frame the freeze ends, the launch it was holding
```

In `src/engine/simulate.ts`, replace:

```ts

    if (f.hitstun > 0) f.hitstun -= 1;
    // The balloon classification belongs to one launch and dies with it, so the
    // next hit is free to classify itself. Clearing it here rather than leaving
```

with:

```ts

    if (f.hitstun > 0) f.hitstun -= 1;
    // A string of hits is over once the fighter is out of hitstun (SDI ×1.15, Task 11).
    if (f.hitstun === 0) f.combat.comboHits = 0;
    // The balloon classification belongs to one launch and dies with it, so the
    // next hit is free to classify itself. Clearing it here rather than leaving
```

In `src/engine/simulate.ts`, replace:

```ts
function releasePendingLaunch(f: FighterState, intent: Intent): void {
  if (f.pendingFacing === 0) return;
  const facing = f.pendingFacing;
  const relStick = intent.x * (facing >= 0 ? 1 : -1);
```

with:

```ts
function releasePendingLaunch(f: FighterState, intent: Intent): void {
  if (f.pendingFacing === 0) return;
  // Automatic SDI: the freeze of an electric or paralyzing hit ends with a
  // shift toward the held stick (Plan 3, Task 11; `ASDI_DISTANCE`).
  if (f.combat.asdi && (intent.x !== 0 || intent.y !== 0)) {
    const diagonal = intent.x !== 0 && intent.y !== 0;
    const step = diagonal ? mul(ASDI_DISTANCE, DIAGONAL) : ASDI_DISTANCE;
    f.x += intent.x * step;
    f.y += intent.y * step;
  }
  f.combat.asdi = false;
  const facing = f.pendingFacing;
  const relStick = intent.x * (facing >= 0 ? 1 : -1);
```

In `src/engine/simulate.ts`, replace:

```ts
}

function clearPendingLaunch(f: FighterState): void {
  f.pendingKnockback = 0;
```

with:

```ts
}

/** One SDI pulse: 2 units, ×1.15 from the sixth consecutive hit taken (Task 11). */
function sdiDistance(f: FighterState): number {
  return f.combat.comboHits > SDI_COMBO_HITS ? byRatio(SDI_DISTANCE, SDI_COMBO_RATIO) : SDI_DISTANCE;
}

/** 1/√2, so a diagonal automatic SDI shift is as long as a straight one. */
const DIAGONAL = fx(0.7071067811865476);

function clearPendingLaunch(f: FighterState): void {
  f.pendingKnockback = 0;
```

In `src/engine/simulate.ts`, replace:

```ts
  f.pendingFacing = 0;
  f.combat.launchFaf = 0;
}

```

with:

```ts
  f.pendingFacing = 0;
  f.combat.launchFaf = 0;
  f.combat.asdi = false;
}

```

In `src/engine/simulate.ts`, replace:

```ts
      kineticTurnLaunch(victim, victim.kinetic.damageX + added.vx, victim.kinetic.damageY + added.vy);
    }
    victim.hitlag = Math.max(victim.hitlag, lag);
    if (!fromProjectile) attacker.hitlag = lag;
```

with:

```ts
      kineticTurnLaunch(victim, victim.kinetic.damageX + added.vx, victim.kinetic.damageY + added.vy);
    }
    victim.combat.comboHits += 1;
    victim.hitlag = Math.max(victim.hitlag, lag);
    if (!fromProjectile) attacker.hitlag = lag;
```

In `src/engine/simulate.ts`, replace:

```ts
  }
  victim.combat.launchSource = source;

  // The launch is *parked*, not applied: Ultimate samples DI on the last frame
```

with:

```ts
  }
  victim.combat.launchSource = source;
  victim.combat.comboHits += 1;

  // The launch is *parked*, not applied: Ultimate samples DI on the last frame
```

In `src/engine/simulate.ts`, replace:

```ts
  // `groundedZeroAngle`); the hitstun is the hit's, already decided above.
  if (victim.grounded && victim.pendingAngle === 0) victim.pendingKnockback = byRatio(kb, GROUNDED_ZERO_LAUNCH_RATIO);
  victim.pendingFacing = sourceFacing >= 0 ? 1 : -1;

```

with:

```ts
  // `groundedZeroAngle`); the hitstun is the hit's, already decided above.
  if (victim.grounded && victim.pendingAngle === 0) victim.pendingKnockback = byRatio(kb, GROUNDED_ZERO_LAUNCH_RATIO);
  const vertical = victim.pendingAngle >= ASDI_VERTICAL[0] && victim.pendingAngle < ASDI_VERTICAL[1];
  victim.combat.asdi = (hb.effect === "electric" || hb.effect === "paralyze") && !vertical;
  victim.pendingFacing = sourceFacing >= 0 ? 1 : -1;

```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/engine/combat.test.ts`
Expected: PASS.

- [ ] **Step 5: The golden trace**

Run: `pnpm vitest run src/game/golden.test.ts`
Expected: PASS, unchanged — none of the four matches has a six-hit string or an ASDI shift (observed: the trace passes untouched).

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0 (`pnpm lint` reports only the two pre-existing warnings in `research/rebuild-2026-10/tools/sim_bench.mjs`).

- [ ] **Step 7: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/src/engine/combat.test.ts \
  super-smash/src/engine/combat.ts \
  super-smash/src/engine/constants.ts \
  super-smash/src/engine/hash.ts \
  super-smash/src/engine/simulate.ts
git commit -m "super-smash: SDI grows x1.15 over a long string; ASDI for electric hits" -m "SmashWiki 'Smash directional influence' (Ultimate). Compounding past the tenth hit and the ASDI distance are UNVERIFIED." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Teching and bouncing: PASSIVE, PASSIVE_FB, PASSIVE_WALL, PASSIVE_CEIL

A tumbling fighter that met the floor always lay down. Now a shield press opens an 11-frame tech window with a 40-frame lockout (SmashWiki "Tech"); a surface met inside it slowly enough — 3 for a floor, 6 for a wall or ceiling (rubendal `js/knockback.js` `techable`; SmashWiki names the 6) — is teched into one of four new statuses under their skyline-smash names. Too fast to tech, or with no tech input, a tumbling fighter bounces at 0.8 (floor) or 1 (wall, ceiling) and up — away from the surface, whichever way its launch pointed (rubendal bounces with `Math.abs`: up off a floor, down off a ceiling, back off a wall) — keeping 0.95 of the launch (SmashWiki "Knockback": "5% in Ultimate") and 0.8 of the hitstun left (SmashWiki "Hitstun"); slower than that, the floor is a missed tech and `onLanded` lays it down (DOWN_WAIT) as before. On the ground a *held* shield techs too: in Ultimate "the shield button can be held for much longer than the 11 frame window and a tech can still be performed on the ground" (SmashWiki "Tech"). Holding is never a press, so it cannot spend the air dodge in a hitstun cancel (Task 7) — a test holds shield through the cancel window and still techs. Teching "while reeling" (SmashWiki) is covered because the replica's `tumble` stands for SSBU's reeling as well.

Tech frame data comes from SmashWiki's Lucario (SSBU) techs page, the one fighter with published numbers, and is used for everyone (UNVERIFIED per fighter): in place 26 frames, roll 40, wall 26 (actionable from 6), ceiling 26, intangible 1–20 (ceiling 1–17, via `dodgeWindow`). The tech input is tracked every frame for every fighter, frozen or not, before anything else in phase 3 — which is what makes Review Focus #1 (the press on the very frame of landing) work: phase 3 sees the press before phase 5's collision. `resolveCollision` now says which surface stopped the fighter (`wall`: which side, `ceiling`). Each status adds the four things `groups.test.ts` and `status.test.ts` demand: an `ActionState`, a `StatusKind`, a `FighterStatus` and a registry entry; the renderer maps them to existing clips.

**Files:**
- Modify: `super-smash/src/engine/combat.test.ts`
- Modify: `super-smash/src/engine/combat.ts`
- Modify: `super-smash/src/engine/constants.ts`
- Modify: `super-smash/src/engine/hash.ts`
- Modify: `super-smash/src/engine/physics.ts`
- Modify: `super-smash/src/engine/simulate.ts`
- Modify: `super-smash/src/engine/states.ts`
- Modify: `super-smash/src/engine/status/groups.test.ts`
- Modify: `super-smash/src/engine/status/index.ts`
- Modify: `super-smash/src/engine/status/kind.ts`
- Create: `super-smash/src/engine/status/passive.ts`
- Modify: `super-smash/src/engine/status/status.test.ts`
- Create: `super-smash/src/engine/tech.ts`
- Modify: `super-smash/src/engine/types.ts`
- Modify: `super-smash/src/game/__golden__/engine-trace.json` (regenerated by a command in this task)
- Modify: `super-smash/src/render/poses/timing.ts`

**Interfaces:** Adds:
```ts
// src/engine/types.ts — ActionState gains "tech" | "techRoll" | "techWall" | "techCeiling"
// src/engine/status/kind.ts — StatusKind gains
//   "FIGHTER_STATUS_KIND_PASSIVE" | "FIGHTER_STATUS_KIND_PASSIVE_FB" | "FIGHTER_STATUS_KIND_PASSIVE_WALL" | "FIGHTER_STATUS_KIND_PASSIVE_CEIL"
// src/engine/status/passive.ts
export const STATUS_PASSIVE, STATUS_PASSIVE_FB, STATUS_PASSIVE_WALL, STATUS_PASSIVE_CEIL: FighterStatus;
export const PASSIVE_STATUSES: readonly FighterStatus[];
// src/engine/tech.ts
export type Surface = "floor" | "wall" | "ceiling";
export interface LaunchBefore { readonly x: number; readonly y: number; readonly speed: number; readonly tumbling: boolean }
export function launchBefore(f: FighterState): LaunchBefore;
export function updateTechInput(f: FighterState, intent: Intent): void;
export function techOrBounce(f: FighterState, surface: Surface, before: LaunchBefore, intent: Intent, wallSide?: number): "tech" | "bounce" | null;
// src/engine/physics.ts — CollisionOutcome gains wall: number (1 right, -1 left, 0 none); ceiling: boolean
// CombatState gains techWindow, techLockout
```
Constants `TECH_WINDOW = 11`, `TECH_LOCKOUT = 40`, `TECH_FLOOR_MAX_SPEED`, `TECH_SURFACE_MAX_SPEED`, `BOUNCE_FLOOR_MIN_SPEED`, `BOUNCE_SURFACE_MIN_SPEED`, `BOUNCE_LAUNCH_RATIO`, `BOUNCE_HITSTUN_RATIO`, `TECH_FRAMES`, `TECH_ROLL_FRAMES`, `TECH_WALL_FRAMES`, `TECH_WALL_INTERRUPT`, `TECH_CEILING_FRAMES`, `TECH_INTANGIBLE`, `TECH_CEILING_INTANGIBLE`, `TECH_ROLL_DISTANCE` (UNVERIFIED).

- [ ] **Step 1: Write the failing tests**

In `src/engine/combat.test.ts`, replace:

```ts
  SHIELD_MAX_HEALTH,
  SHIELD_REGEN_PER_FRAME,
} from "./constants";
import { hashState } from "./hash";
```

with:

```ts
  SHIELD_MAX_HEALTH,
  SHIELD_REGEN_PER_FRAME,
  TECH_LOCKOUT,
  TECH_WINDOW,
} from "./constants";
import { hashState } from "./hash";
```

Append to the end of `src/engine/combat.test.ts`:

```ts
/* -------------------------------------------- Task 12: tech and bounce -- */

describe("tech and bounce (Plan 3, Task 12)", () => {
  /**
   * Fighter 1 tumbling at (x, y) along (vx, vy) — a launch of that speed — with
   * 60 frames of hitstun left. Fighter 0 is parked out of the way. A launch
   * under 0.8 lands; 0.8 or more bounces unless teched.
   */
  function flying(x: number, y: number, vx: number, vy: number): GameState {
    const s = standing();
    s.fighters[0].x = fx(-70);
    const v = s.fighters[1];
    Object.assign(v, { x: fx(x), y: fx(y), grounded: false, platform: -1, action: "tumble", actionFrame: 0, hitstun: 60 });
    v.kinetic.damageX = fx(vx);
    v.kinetic.damageY = fx(vy);
    v.launchSpeed = Math.abs(fx(vx)) + Math.abs(fx(vy)); // every launch here is along one axis
    v.vx = fx(vx);
    v.vy = fx(vy);
    return s;
  }
  /** Run until fighter 1 touches something; `input(i)` is fighter 1's input. */
  function until(s: GameState, input: (i: number) => InputFrame, n = 40): Frame[] {
    return play(s, n, (i) => [0, input(i)]);
  }
  const landing = (frames: Frame[]) => frames.findIndex((f) => f.state.fighters[1].action !== "tumble");

  // SmashWiki "Tech" (https://www.ssbwiki.com/Tech): an 11-frame window, and no
  // second try for 40 frames after an input.
  it("opens an 11-frame window on a shield press, and locks out presses for 40", () => {
    const s = standing();
    const after = play(s, 1, () => [0, Btn.Shield]).at(-1)!.state.fighters[1].combat;
    expect([after.techWindow, after.techLockout]).toEqual([TECH_WINDOW, TECH_LOCKOUT]);
    const again = play(s, 6, (i) => [0, i === 0 || i === 5 ? Btn.Shield : 0]).at(-1)!.state.fighters[1].combat;
    expect(again.techWindow).toBe(TECH_WINDOW - 5);
  });

  it("techs in place when shield was pressed within 11 frames of landing", () => {
    const frames = until(flying(0, 6, 0, -2), (i) => (i === 0 ? Btn.Shield : 0));
    const v = frames[landing(frames)].state.fighters[1];
    expect(v.action).toBe("tech");
    expect(v.hitstun).toBe(0);
    expect(v.launchSpeed).toBe(0);
  });

  // Review Focus #1: the press on the very frame the fighter lands.
  it("techs on a press made on the frame of landing itself", () => {
    const dry = until(flying(0, 6, 0, -2), () => 0);
    const k = landing(dry);

    const frames = until(flying(0, 6, 0, -2), (i) => (i === k ? Btn.Shield : 0));
    expect(frames[k].state.fighters[1].action).toBe("tech");
  });

  it("misses the tech when the press was 12 frames early, and lies down", () => {
    const dry = until(flying(0, 20, 0, -0.6), () => 0);
    const k = landing(dry);
    const frames = until(flying(0, 20, 0, -0.6), (i) => (i === k - TECH_WINDOW ? Btn.Shield : 0));
    expect(frames[k].state.fighters[1].action).toBe("downed");
  });

  it("misses the tech when a press 30 frames early locked the second one out", () => {
    const dry = until(flying(0, 45, 0, -0.6), () => 0, 60);
    const k = landing(dry);
    expect(k).toBeGreaterThan(30);
    const frames = until(flying(0, 45, 0, -0.6), (i) => (i === k - 30 || i === k - 2 ? Btn.Shield : 0), 60);
    expect(frames[k].state.fighters[1].action).toBe("downed");
  });

  it("rolls when the stick is held as it techs", () => {
    const frames = until(flying(0, 6, 0, -2), (i) => (i === 0 ? Btn.Shield | Btn.Right : Btn.Right));
    const k = landing(frames);
    expect(frames[k].state.fighters[1].action).toBe("techRoll");
    expect(frames[k + 3].state.fighters[1].x).toBeGreaterThan(frames[k].state.fighters[1].x);
  });

  it("is intangible from the first frame of the tech", () => {
    const frames = until(flying(0, 6, 0, -2), (i) => (i === 0 ? Btn.Shield : 0));
    const k = landing(frames);
    expect(frames[k + 1].state.fighters[1].intangible).toBeGreaterThan(0);
  });

  // rubendal SSBU-Calculator `js/knockback.js`: the floor is techable at a launch
  // of 3 or less; a tumbling fighter bounces off at 0.8 or more. SmashWiki
  // "Knockback": a bounce costs 5% in Ultimate; SmashWiki "Hitstun": hitstun
  // after a bounce is 0.8× (the Smash 4 value Ultimate keeps).
  it("bounces off the floor when too fast to tech, keeping 0.95 of the launch and 0.8 of the hitstun", () => {
    const frames = until(flying(0, 6, 0, -3.5), (i) => (i === 0 ? Btn.Shield : 0));
    const k = frames.findIndex((f) => f.state.fighters[1].vy > 0);
    const before = frames[k - 1].state.fighters[1];
    const v = frames[k].state.fighters[1];
    expect(v.action).toBe("tumble");
    expect(v.grounded).toBe(false);
    expect(v.hitstun).toBe(Math.floor(((before.hitstun - 1) * 4) / 5));
    expect(v.launchSpeed).toBeLessThan(before.launchSpeed);
  });

  it("lies down after a slow tumbling landing with no tech", () => {
    const frames = until(flying(0, 2, 0, -0.5), () => 0);
    expect(frames[landing(frames)].state.fighters[1].action).toBe("downed");
  });

  // The stage's side is a wall: a hard platform 60 units deep.
  it("techs off a wall at up to 6, and bounces off it otherwise", () => {
    const tech = until(flying(92, -20, -4, 0), (i) => (i === 0 ? Btn.Shield : 0));
    expect(tech[landing(tech)].state.fighters[1].action).toBe("techWall");
    const bounce = until(flying(92, -20, -4, 0), () => 0);
    const k = bounce.findIndex((f) => f.state.fighters[1].vx > 0);
    expect(k).toBeGreaterThan(0);
    expect(bounce[k].state.fighters[1].action).toBe("tumble");
  });

  // rubendal `js/knockback.js`: techable at a launch speed of 3 or less on the
  // floor and 6 or less on a wall or ceiling. The launch decays 0.051 before it
  // meets the surface, so each case starts 0.051 faster.
  it.each([
    [3, "tech"],
    [3.1, "tumble"],
  ])("techs the floor at a launch of %f, or not", (speed, action) => {
    const frames = until(flying(0, 1, 0, -(speed + 0.051)), (i) => (i === 0 ? Btn.Shield : 0), 3);
    expect(frames[0].state.fighters[1].action).toBe(action);
  });

  it.each([
    [6, "techWall"],
    [6.1, "tumble"],
  ])("techs a wall at a launch of %f, or not", (speed, action) => {
    const frames = until(flying(85, -20, -(speed + 0.051), 0), (i) => (i === 0 ? Btn.Shield : 0), 3);
    expect(frames[0].state.fighters[1].action).toBe(action);
    if (action === "tumble") expect(frames[0].state.fighters[1].vx).toBeGreaterThan(0);
  });

  // A tumbling body that meets the floor while its launch still points up a
  // little (gravity carried it down) bounces *up* and leaves the floor — it may
  // skip again later, but never bounces back into the floor frame after frame.
  it("bounces up off the floor even when its launch still pointed upward", () => {
    const s = flying(0, 1, 2, 0.3);
    s.fighters[1].kinetic.gravityY = -fx(1.5);
    s.fighters[1].vy = fx(0.3) - fx(1.5);
    const frames = until(s, () => 0, 12);
    const bounced = frames
      .map((f, i) => (i > 0 && f.state.fighters[1].hitstun < frames[i - 1].state.fighters[1].hitstun - 1 ? i : -1))
      .filter((i) => i >= 0);
    expect(bounced.length).toBeGreaterThan(0);
    for (const i of bounced) {
      expect(frames[i].state.fighters[1].kinetic.damageY).toBeGreaterThan(0);
      expect(frames[i + 1].state.fighters[1].y).toBeGreaterThan(0);
      expect(bounced).not.toContain(i + 1);
    }
  });

  // SmashWiki "Tech" (Ultimate): "the shield button can be held for much longer
  // than the 11 frame window and a tech can still be performed on the ground."
  it("techs the ground with a shield held long past the window", () => {
    const dry = until(flying(0, 20, 0, -0.6), () => 0);
    const k = landing(dry);
    expect(k).toBeGreaterThan(TECH_WINDOW + 5);
    const frames = until(flying(0, 20, 0, -0.6), () => Btn.Shield);
    expect(frames[k].state.fighters[1].action).toBe("tech");
  });

  // …and the held shield is not a press: it does not spend the air dodge through
  // hitstun cancel on the way down (Task 7), so the landing is still a tech.
  it("holds shield through the hitstun-cancel window without air dodging, then techs", () => {
    let s = flying(0, 30, 0, -0.6);
    s.fighters[1].actionFrame = 38;
    let prev: readonly InputFrame[] = [0, Btn.Shield];
    const actions: string[] = [];
    for (let i = 0; i < 60; i++) {
      s = step(s, [0, Btn.Shield], { prevInputs: prev, ctx: ctxFor() }).state;
      prev = [0, Btn.Shield];
      actions.push(s.fighters[1].action);
      if (s.fighters[1].action !== "tumble") break;
    }
    expect(actions).not.toContain("airDodge");
    expect(actions.at(-1)).toBe("tech");
  });

  // SmashWiki "Tech" (Ultimate): "Teching while reeling works on the ground once
  // more." Reeling is a kind of tumble; the replica's `tumble` covers it.
  it("techs a reeling landing (a tumble at 100% or more, along a low angle)", () => {
    const s = flying(0, 3, 1.5, -1.5);
    s.fighters[1].damage = fx(120);
    const frames = until(s, (i) => (i === 0 ? Btn.Shield : 0));
    expect(frames[landing(frames)].state.fighters[1].action).toBe("tech");
  });

  it("techs off the stage's underside", () => {
    const frames = until(flying(0, -78, 0, 4), (i) => (i === 0 ? Btn.Shield : 0));
    expect(frames[landing(frames)].state.fighters[1].action).toBe("techCeiling");
  });
});
```

In `src/engine/status/groups.test.ts`, replace:

```ts
  dead: "NONE",
  entering: "FALL",
};

```

with:

```ts
  dead: "NONE",
  entering: "FALL",
  // Plan 3, Task 12: new statuses, no legacy counterpart.
  tech: "GROUND_STOP",
  techRoll: "MOTION",
  techWall: "GROUND_STOP",
  techCeiling: "GROUND_STOP",
};

```

In `src/engine/status/groups.test.ts`, replace:

```ts
  "land",
  "landingLag",
];

```

with:

```ts
  "land",
  "landingLag",
  // Plan 3, Task 12
  "tech",
  "techRoll",
  "techWall",
  "techCeiling",
];

```

In `src/engine/status/status.test.ts`, replace:

```ts
  it("names an SSBU-style kind for every replica action, one-to-one", () => {
    const actions = Object.keys(STATUS_KIND_OF_ACTION) as ActionState[];
    expect(actions).toHaveLength(42);
    const kinds = new Set(actions.map((a) => STATUS_KIND_OF_ACTION[a]));
    expect(kinds.size).toBe(actions.length);
```

with:

```ts
  it("names an SSBU-style kind for every replica action, one-to-one", () => {
    const actions = Object.keys(STATUS_KIND_OF_ACTION) as ActionState[];
    expect(actions).toHaveLength(46);
    const kinds = new Set(actions.map((a) => STATUS_KIND_OF_ACTION[a]));
    expect(kinds.size).toBe(actions.length);
```

In `src/engine/status/status.test.ts`, replace:

```ts
    expect(statusKindOf({ action: "ledgeHang" })).toBe("FIGHTER_STATUS_KIND_CLIFF_WAIT");
    expect(statusKindOf({ action: "airDodge" })).toBe("FIGHTER_STATUS_KIND_ESCAPE_AIR");
  });
});
```

with:

```ts
    expect(statusKindOf({ action: "ledgeHang" })).toBe("FIGHTER_STATUS_KIND_CLIFF_WAIT");
    expect(statusKindOf({ action: "airDodge" })).toBe("FIGHTER_STATUS_KIND_ESCAPE_AIR");
    expect(statusKindOf({ action: "tech" })).toBe("FIGHTER_STATUS_KIND_PASSIVE");
    expect(statusKindOf({ action: "techRoll" })).toBe("FIGHTER_STATUS_KIND_PASSIVE_FB");
    expect(statusKindOf({ action: "techWall" })).toBe("FIGHTER_STATUS_KIND_PASSIVE_WALL");
    expect(statusKindOf({ action: "techCeiling" })).toBe("FIGHTER_STATUS_KIND_PASSIVE_CEIL");
  });
});
```

- [ ] **Step 2: Run them**

Run: `pnpm vitest run src/engine/combat.test.ts src/engine/status/groups.test.ts src/engine/status/status.test.ts`
Expected: FAIL — `status.test.ts` (`to have a length of 46 but got 42`; `expected undefined to be 'FIGHTER_STATUS_KIND_PASSIVE'`), `groups.test.ts` `are exactly the groups migrated so far` (four actions short), and in `combat.test.ts` the window case (`expected undefined to be NaN`), every tech case (`expected 'downed' to be 'tech'`, `… 'techRoll'`), the bounce, held-shield, boundary (3/3.1 floor, 6/6.1 wall) and wall/ceiling cases.

- [ ] **Step 3: Implement**

In `src/engine/combat.ts`, replace:

```ts
  /** The freeze now running is from a hit that grants automatic SDI when it ends (Task 11). */
  asdi: boolean;
}

```

with:

```ts
  /** The freeze now running is from a hit that grants automatic SDI when it ends (Task 11). */
  asdi: boolean;
  /** Frames left of an open tech window: 11 from a shield press (Task 12). */
  techWindow: number;
  /** Frames before another shield press can open a tech window: 40 from the last (Task 12). */
  techLockout: number;
}

```

In `src/engine/combat.ts`, replace:

```ts
    comboHits: 0,
    asdi: false,
  };
}
```

with:

```ts
    comboHits: 0,
    asdi: false,
    techWindow: 0,
    techLockout: 0,
  };
}
```

In `src/engine/combat.ts`, replace:

```ts
    comboHits: c.comboHits,
    asdi: c.asdi,
  };
}
```

with:

```ts
    comboHits: c.comboHits,
    asdi: c.asdi,
    techWindow: c.techWindow,
    techLockout: c.techLockout,
  };
}
```

In `src/engine/constants.ts`, replace:

```ts
export const DIRECTIONAL_AIR_DODGE_SPEED = fx(3.2);

/* ----------------------------------------------------------------- ledge -- */

```

with:

```ts
export const DIRECTIONAL_AIR_DODGE_SPEED = fx(3.2);

/* ------------------------------------------------------------------ tech -- */

/**
 * Teching (SmashWiki "Tech", https://www.ssbwiki.com/Tech): a shield press opens
 * an 11-frame window, and no new window opens for 40 frames after a press.
 */
export const TECH_WINDOW = 11;
export const TECH_LOCKOUT = 40;
/**
 * A surface can be teched only at a launch speed of 3 or less (floor) or 6 or
 * less (wall, ceiling); a tumbling fighter bounces off at 0.8 or more (floor)
 * or 1 or more (wall, ceiling). rubendal SSBU-Calculator `js/knockback.js`
 * (`techable`, the bounce check); SmashWiki "Tech" names the 6.
 */
export const TECH_FLOOR_MAX_SPEED = fx(3);
export const TECH_SURFACE_MAX_SPEED = fx(6);
export const BOUNCE_FLOOR_MIN_SPEED = fx(0.8);
export const BOUNCE_SURFACE_MIN_SPEED = fx(1);
/**
 * A bounce keeps 0.95 of the launch — "5% in Ultimate" (SmashWiki "Knockback") —
 * and 0.8 of the hitstun left (SmashWiki "Hitstun": Ultimate keeps Smash 4's
 * bounce reduction, "0.8× relative to the initial amount"; applied to what is
 * left, UNVERIFIED).
 */
export const BOUNCE_LAUNCH_RATIO: Ratio = [19, 20];
export const BOUNCE_HITSTUN_RATIO: Ratio = [4, 5];
/**
 * Tech animations, from SmashWiki "Lucario (SSBU)/Techs" — the one fighter with
 * published tech frame data; used for all eight (UNVERIFIED per fighter):
 * in place 26 frames, roll 40, wall 26 (actionable from 6), ceiling 26;
 * intangible on frames 1–20 (ceiling 1–17).
 */
export const TECH_FRAMES = 26;
export const TECH_ROLL_FRAMES = 40;
export const TECH_WALL_FRAMES = 26;
export const TECH_WALL_INTERRUPT = 6;
export const TECH_CEILING_FRAMES = 26;
export const TECH_INTANGIBLE = [1, 20] as const;
export const TECH_CEILING_INTANGIBLE = [1, 17] as const;
/** How far a tech roll travels. UNVERIFIED: the ground roll's distance stands in. */
export const TECH_ROLL_DISTANCE = fx(28);

/* ----------------------------------------------------------------- ledge -- */

```

In `src/engine/hash.ts`, replace:

```ts
  x = mixInt(x, c.comboHits);
  x = mixBool(x, c.asdi);
  return x;
}
```

with:

```ts
  x = mixInt(x, c.comboHits);
  x = mixBool(x, c.asdi);
  x = mixInt(x, c.techWindow);
  x = mixInt(x, c.techLockout);
  return x;
}
```

In `src/engine/physics.ts`, replace:

```ts
  /** The fighter was stopped by a wall or a ceiling. */
  blocked: boolean;
}

```

with:

```ts
  /** The fighter was stopped by a wall or a ceiling. */
  blocked: boolean;
  /**
   * It was a wall, and which way from the fighter: 1 to its right, −1 to its
   * left, 0 none (Plan 3, Task 12: a tumbling fighter techs or bounces off it).
   */
  wall: number;
  /** It was a ceiling — a hard platform's underside. */
  ceiling: boolean;
}

```

In `src/engine/physics.ts`, replace:

```ts
  opts: CollisionOptions = {},
): CollisionOutcome {
  const out: CollisionOutcome = { landed: false, leftGround: false, blocked: false };
  const ecb = ecbOf(f, attrs);

```

with:

```ts
  opts: CollisionOptions = {},
): CollisionOutcome {
  const out: CollisionOutcome = { landed: false, leftGround: false, blocked: false, wall: 0, ceiling: false };
  const ecb = ecbOf(f, attrs);

```

In `src/engine/physics.ts`, replace:

```ts
      kineticSetX(f, 0);
      out.blocked = true;
    }
    // Ceiling: the ECB's top rising into the underside of a solid body.
```

with:

```ts
      kineticSetX(f, 0);
      out.blocked = true;
      out.wall = prevX <= cx ? 1 : -1;
    }
    // Ceiling: the ECB's top rising into the underside of a solid body.
```

In `src/engine/physics.ts`, replace:

```ts
      kineticSetY(f, 0);
      out.blocked = true;
    }
  }
```

with:

```ts
      kineticSetY(f, 0);
      out.blocked = true;
      out.ceiling = true;
    }
  }
```

In `src/engine/simulate.ts`, replace:

```ts
} from "./kinetic";
import { LEGACY_BONE_TABLE, type BoneTable } from "./acmd/bones";
import { cloneCombat, emptyCombat } from "./combat";
import {
```

with:

```ts
} from "./kinetic";
import { LEGACY_BONE_TABLE, type BoneTable } from "./acmd/bones";
import { launchBefore, techOrBounce, updateTechInput } from "./tech";
import { cloneCombat, emptyCombat } from "./combat";
import {
```

In `src/engine/simulate.ts`, replace:

```ts
    const intent = intents[i];

    if (f.intangible > 0) f.intangible -= 1;
    if (f.invincible > 0) f.invincible -= 1;
```

with:

```ts
    const intent = intents[i];

    // Tech input counts on every frame, frozen or not (Plan 3, Task 12).
    updateTechInput(f, intent);
    if (f.intangible > 0) f.intangible -= 1;
    if (f.invincible > 0) f.invincible -= 1;
```

In `src/engine/simulate.ts`, replace:

```ts
    if (f.ledge !== null) continue; // hanging: the ledge holds you, not the floor

    const outcome = resolveCollision(
      f,
```

with:

```ts
    if (f.ledge !== null) continue; // hanging: the ledge holds you, not the floor

    const before = launchBefore(f);
    const outcome = resolveCollision(
      f,
```

In `src/engine/simulate.ts`, replace:

```ts
      s.frame,
    );
    if (outcome.landed) {
      onLanded(f, stateCtx(i));
      events.lands.push({ port: f.port, x: f.x, y: f.y });
    } else if (outcome.leftGround) {
```

with:

```ts
      s.frame,
    );
    // A tumbling body that meets a surface techs or bounces (Plan 3, Task 12);
    // otherwise a landing is a landing — a missed tech lies down in `onLanded`.
    const surface = outcome.landed ? "floor" : outcome.ceiling ? "ceiling" : outcome.wall !== 0 ? "wall" : null;
    const reaction = surface === null ? null : techOrBounce(f, surface, before, intents[i], outcome.wall);
    if (outcome.landed && reaction === null) {
      onLanded(f, stateCtx(i));
      events.lands.push({ port: f.port, x: f.x, y: f.y });
    } else if (outcome.landed && reaction === "tech") {
      events.lands.push({ port: f.port, x: f.x, y: f.y });
    } else if (outcome.leftGround) {
```

In `src/engine/states.ts`, replace:

```ts
  TAP_JUMP_FRAMES,
  SPOT_DODGE_INTANGIBLE,
} from "./constants";
import {
```

with:

```ts
  TAP_JUMP_FRAMES,
  SPOT_DODGE_INTANGIBLE,
  TECH_CEILING_INTANGIBLE,
  TECH_INTANGIBLE,
} from "./constants";
import {
```

In `src/engine/states.ts`, replace:

```ts
    case "airDodge":
      return f.charge === 1 ? DIRECTIONAL_AIR_DODGE_INTANGIBLE : AIR_DODGE_INTANGIBLE;
    default:
      return null;
```

with:

```ts
    case "airDodge":
      return f.charge === 1 ? DIRECTIONAL_AIR_DODGE_INTANGIBLE : AIR_DODGE_INTANGIBLE;
    // Teching (Plan 3, Task 12): SmashWiki "Lucario (SSBU)/Techs".
    case "tech":
    case "techRoll":
    case "techWall":
      return TECH_INTANGIBLE;
    case "techCeiling":
      return TECH_CEILING_INTANGIBLE;
    default:
      return null;
```

In `src/engine/status/index.ts`, replace:

```ts
import type { FighterStatus } from "./kind";
import { META_STATUSES } from "./meta";

export const ALL_STATUSES: readonly FighterStatus[] = [
```

with:

```ts
import type { FighterStatus } from "./kind";
import { META_STATUSES } from "./meta";
import { PASSIVE_STATUSES } from "./passive";

export const ALL_STATUSES: readonly FighterStatus[] = [
```

In `src/engine/status/index.ts`, replace:

```ts
  ...GROUND_STATUSES,
  ...AIR_STATUSES,
];

```

with:

```ts
  ...GROUND_STATUSES,
  ...AIR_STATUSES,
  ...PASSIVE_STATUSES,
];

```

In `src/engine/status/kind.ts`, replace:

```ts
  | "FIGHTER_STATUS_KIND_DOWN_WAIT"
  | "FIGHTER_STATUS_KIND_DOWN_STAND"
  | "FIGHTER_STATUS_KIND_CLIFF_WAIT"
  | "FIGHTER_STATUS_KIND_CLIFF_CLIMB"
```

with:

```ts
  | "FIGHTER_STATUS_KIND_DOWN_WAIT"
  | "FIGHTER_STATUS_KIND_DOWN_STAND"
  | "FIGHTER_STATUS_KIND_PASSIVE"
  | "FIGHTER_STATUS_KIND_PASSIVE_FB"
  | "FIGHTER_STATUS_KIND_PASSIVE_WALL"
  | "FIGHTER_STATUS_KIND_PASSIVE_CEIL"
  | "FIGHTER_STATUS_KIND_CLIFF_WAIT"
  | "FIGHTER_STATUS_KIND_CLIFF_CLIMB"
```

In `src/engine/status/kind.ts`, replace:

```ts
  downed: "FIGHTER_STATUS_KIND_DOWN_WAIT",
  getUp: "FIGHTER_STATUS_KIND_DOWN_STAND",
  ledgeHang: "FIGHTER_STATUS_KIND_CLIFF_WAIT",
  ledgeGetUp: "FIGHTER_STATUS_KIND_CLIFF_CLIMB",
```

with:

```ts
  downed: "FIGHTER_STATUS_KIND_DOWN_WAIT",
  getUp: "FIGHTER_STATUS_KIND_DOWN_STAND",
  tech: "FIGHTER_STATUS_KIND_PASSIVE",
  techRoll: "FIGHTER_STATUS_KIND_PASSIVE_FB",
  techWall: "FIGHTER_STATUS_KIND_PASSIVE_WALL",
  techCeiling: "FIGHTER_STATUS_KIND_PASSIVE_CEIL",
  ledgeHang: "FIGHTER_STATUS_KIND_CLIFF_WAIT",
  ledgeGetUp: "FIGHTER_STATUS_KIND_CLIFF_CLIMB",
```

Create `src/engine/status/passive.ts`:

```ts
/**
 * Tech statuses (Plan 3, Task 12): PASSIVE (tech in place), PASSIVE_FB (tech
 * roll), PASSIVE_WALL, PASSIVE_CEIL — skyline-smash `lua_const.rs` names.
 *
 * A fighter enters one from `techOrBounce` (`tech.ts`) on the frame its
 * tumbling body meets a surface with a tech input live. The intangible frames
 * come from `dodgeWindow` (`states.ts`), like a roll's; velocity changes go
 * through the KineticModule only.
 */

import {
  TECH_CEILING_FRAMES,
  TECH_FRAMES,
  TECH_ROLL_FRAMES,
  TECH_WALL_FRAMES,
  TECH_WALL_INTERRUPT,
} from "../constants";
import { kineticSetX } from "../kinetic";
import { bufferPress, handleActionable, startAction } from "../states";
import type { FighterStatus } from "./kind";

export const STATUS_PASSIVE: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_PASSIVE",
  action: "tech",
  kineticType: "GROUND_STOP",
  main(f, intent, ctx) {
    if (f.actionFrame >= TECH_FRAMES) startAction(f, "stand");
    else bufferPress(f, intent, ctx.frame);
  },
};

export const STATUS_PASSIVE_FB: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_PASSIVE_FB",
  action: "techRoll",
  kineticType: "MOTION",
  main(f, intent, ctx) {
    if (f.actionFrame >= TECH_ROLL_FRAMES) {
      kineticSetX(f, 0, "stop");
      startAction(f, "stand");
    } else bufferPress(f, intent, ctx.frame);
  },
};

export const STATUS_PASSIVE_WALL: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_PASSIVE_WALL",
  action: "techWall",
  kineticType: "GROUND_STOP",
  main(f, intent, ctx) {
    if (f.actionFrame >= TECH_WALL_FRAMES) {
      startAction(f, "fall");
      return;
    }
    if (f.actionFrame >= TECH_WALL_INTERRUPT && handleActionable(f, intent, ctx)) return;
    bufferPress(f, intent, ctx.frame);
  },
};

export const STATUS_PASSIVE_CEIL: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_PASSIVE_CEIL",
  action: "techCeiling",
  kineticType: "GROUND_STOP",
  main(f, intent, ctx) {
    if (f.actionFrame >= TECH_CEILING_FRAMES) startAction(f, "fall");
    else bufferPress(f, intent, ctx.frame);
  },
};

export const PASSIVE_STATUSES: readonly FighterStatus[] = [
  STATUS_PASSIVE,
  STATUS_PASSIVE_FB,
  STATUS_PASSIVE_WALL,
  STATUS_PASSIVE_CEIL,
];
```

Create `src/engine/tech.ts`:

```ts
/**
 * Teching and bouncing (Plan 3, Task 12): what a tumbling fighter does on the
 * frame its body meets a floor, a wall or a ceiling.
 *
 * Tech input is a shield press (SmashWiki "Tech"): it opens an 11-frame window
 * and blocks another window for 40 frames. A surface met inside the window,
 * slowly enough (3 for a floor, 6 for a wall or ceiling — rubendal
 * SSBU-Calculator `js/knockback.js` `techable`), is teched. One met too fast,
 * or with no tech input, bounces the fighter off it if the launch is at least
 * 0.8 (floor) or 1 (wall, ceiling) — keeping 0.95 of the launch and 0.8 of the
 * hitstun. A slow tumbling landing with no tech is the missed tech: `onLanded`
 * lays the fighter down (DOWN_WAIT), as before.
 *
 * On the ground a *held* shield techs too: "the shield button can be held for
 * much longer than the 11 frame window and a tech can still be performed on
 * the ground" (SmashWiki "Tech", Ultimate). Holding is never a press, so it
 * does not spend the air dodge in hitstun cancel (Task 7). "Tumbling" here
 * includes SSBU's reeling, which is a kind of tumble (DAMAGE_FLY_ROLL): the
 * replica's `tumble` action stands for both.
 */

import {
  BOUNCE_FLOOR_MIN_SPEED,
  BOUNCE_HITSTUN_RATIO,
  BOUNCE_LAUNCH_RATIO,
  BOUNCE_SURFACE_MIN_SPEED,
  TECH_FLOOR_MAX_SPEED,
  TECH_LOCKOUT,
  TECH_ROLL_DISTANCE,
  TECH_ROLL_FRAMES,
  TECH_SURFACE_MAX_SPEED,
  TECH_WINDOW,
} from "./constants";
import { byRatio } from "./fixed";
import { kineticLaunch, kineticSet, kineticSetX } from "./kinetic";
import type { Intent } from "./states";
import { startAction } from "./states";
import type { FighterState } from "./types";

export type Surface = "floor" | "wall" | "ceiling";

/** The launch as it was before collision touched it this frame. */
export interface LaunchBefore {
  readonly x: number;
  readonly y: number;
  readonly speed: number;
  readonly tumbling: boolean;
}

export function launchBefore(f: FighterState): LaunchBefore {
  return { x: f.kinetic.damageX, y: f.kinetic.damageY, speed: f.launchSpeed, tumbling: f.action === "tumble" };
}

/**
 * Count the tech window and lockout down, and open a window on a shield press
 * outside the lockout. Runs every frame for every fighter, frozen or not, so a
 * press made during hitlag counts — and spends the lockout — like any other.
 */
export function updateTechInput(f: FighterState, intent: Intent): void {
  const c = f.combat;
  if (c.techWindow > 0) c.techWindow -= 1;
  if (c.techLockout > 0) c.techLockout -= 1;
  if (intent.shieldPressed && c.techLockout === 0) {
    c.techWindow = TECH_WINDOW;
    c.techLockout = TECH_LOCKOUT;
  }
}

/**
 * The fighter's tumbling body just met `surface`: tech, bounce, or neither
 * (null — the caller carries on with the landing or the stop). `intent.x`
 * picks a tech roll on the floor; `wallSide` is `CollisionOutcome.wall`.
 */
export function techOrBounce(
  f: FighterState,
  surface: Surface,
  before: LaunchBefore,
  intent: Intent,
  wallSide = 0,
): "tech" | "bounce" | null {
  if (!before.tumbling || f.hitstun <= 0) return null;
  const floor = surface === "floor";
  const techable = before.speed <= (floor ? TECH_FLOOR_MAX_SPEED : TECH_SURFACE_MAX_SPEED);
  const input = f.combat.techWindow > 0 || (floor && intent.shieldHeld);
  if (input && techable) {
    f.combat.techWindow = 0;
    f.hitstun = 0;
    f.balloon = false;
    if (floor) {
      kineticSet(f, 0, 0, "stop");
      if (intent.x !== 0) {
        startAction(f, "techRoll");
        kineticSetX(f, intent.x * Math.trunc(TECH_ROLL_DISTANCE / TECH_ROLL_FRAMES), "stop");
      } else {
        startAction(f, "tech");
      }
    } else {
      kineticSet(f, 0, 0, "stop");
      startAction(f, surface === "wall" ? "techWall" : "techCeiling");
    }
    return "tech";
  }
  if (before.speed < (floor ? BOUNCE_FLOOR_MIN_SPEED : BOUNCE_SURFACE_MIN_SPEED)) return null;
  // Send the launch away from the surface — up off a floor, down off a ceiling,
  // back off a wall, whichever way its component pointed (rubendal
  // `js/knockback.js` bounces with `Math.abs`) — 5% slower; hitstun to 0.8 of
  // what is left.
  const ax = before.x < 0 ? -before.x : before.x;
  const ay = before.y < 0 ? -before.y : before.y;
  const x = surface === "wall" ? -wallSide * ax : before.x;
  const y = floor ? ay : surface === "ceiling" ? -ay : before.y;
  kineticLaunch(
    f,
    byRatio(x, BOUNCE_LAUNCH_RATIO),
    byRatio(y, BOUNCE_LAUNCH_RATIO),
    byRatio(before.speed, BOUNCE_LAUNCH_RATIO),
  );
  f.hitstun = byRatio(f.hitstun, BOUNCE_HITSTUN_RATIO);
  if (floor) {
    f.grounded = false;
    f.platform = -1;
  }
  return "bounce";
}
```

In `src/engine/types.ts`, replace:

```ts
  | "downed"
  | "getUp"
  // ledge
  | "ledgeHang"
```

with:

```ts
  | "downed"
  | "getUp"
  // teching (Plan 3)
  | "tech"
  | "techRoll"
  | "techWall"
  | "techCeiling"
  // ledge
  | "ledgeHang"
```

In `src/render/poses/timing.ts`, replace:

```ts
      return "crouchEnd";
    case "getUp":
      return "getUp";
    case "jumpSquat":
```

with:

```ts
      return "crouchEnd";
    case "getUp":
    case "tech":
      return "getUp";
    case "jumpSquat":
```

In `src/render/poses/timing.ts`, replace:

```ts
    case "roll":
    case "ledgeRoll":
      return "roll";
    case "airDodge":
```

with:

```ts
    case "roll":
    case "ledgeRoll":
    case "techRoll":
      return "roll";
    case "airDodge":
```

In `src/render/poses/timing.ts`, replace:

```ts
      return "hitstun";
    case "tumble":
      return "tumble";
    case "grabbed":
```

with:

```ts
      return "hitstun";
    case "tumble":
    case "techWall":
    case "techCeiling":
      return "tumble";
    case "grabbed":
```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/engine/combat.test.ts src/engine/status/groups.test.ts src/engine/status/status.test.ts`
Expected: PASS.

- [ ] **Step 5: The golden trace**

Run: `pnpm vitest run src/game/golden.test.ts`
Expected before regenerating: FAIL in the Mario–Fox match — a fast tumbling landing there now bounces. Regenerate.

```bash
UPDATE_GOLDEN=1 pnpm vitest run src/game/golden.test.ts
pnpm vitest run src/game/golden.test.ts
```

Expected: the second run PASSes. This task changes behaviour on purpose; its commit says so.

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0 (`pnpm lint` reports only the two pre-existing warnings in `research/rebuild-2026-10/tools/sim_bench.mjs`).

- [ ] **Step 7: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/src/engine/combat.test.ts \
  super-smash/src/engine/combat.ts \
  super-smash/src/engine/constants.ts \
  super-smash/src/engine/hash.ts \
  super-smash/src/engine/physics.ts \
  super-smash/src/engine/simulate.ts \
  super-smash/src/engine/states.ts \
  super-smash/src/engine/status/groups.test.ts \
  super-smash/src/engine/status/index.ts \
  super-smash/src/engine/status/kind.ts \
  super-smash/src/engine/status/passive.ts \
  super-smash/src/engine/status/status.test.ts \
  super-smash/src/engine/tech.ts \
  super-smash/src/engine/types.ts \
  super-smash/src/game/__golden__/engine-trace.json \
  super-smash/src/render/poses/timing.ts
git commit -m "super-smash: teching and bouncing (PASSIVE, PASSIVE_FB, PASSIVE_WALL, PASSIVE_CEIL)" -m "SmashWiki 'Tech' (11-frame window, 40-frame lockout, a held shield techs the ground); rubendal techable/bounce speeds and bounce directions; Lucario's published tech frames for everyone (UNVERIFIED per fighter). Golden trace regenerated." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Glancing blows do not hit

SmashWiki "Glancing blow": a hitbox that connects "less than 0.1 units through a hurtbox" is a glancing blow — "the attack not hitting" — unchanged from Brawl into Ultimate. The swept hit test now measures depth (`sweptHitboxPenetration`, the sum of radii less the closest spine distance) and a hit less than 0.1 deep is skipped without spending the swing. The lowest-id rule among one source's boxes is unchanged.

**Files:**
- Modify: `super-smash/src/engine/combat.test.ts`
- Modify: `super-smash/src/engine/constants.ts`
- Modify: `super-smash/src/engine/hitbox.ts`
- Modify: `super-smash/src/engine/simulate.ts`
- Modify: `super-smash/src/game/__golden__/engine-trace.json` (regenerated by a command in this task)

**Interfaces:** Adds `sweptHitboxPenetration(prevX, prevY, x, y, radius, target: Capsule): number` (`hitbox.ts`), `GLANCING_BLOW_DEPTH = fx(0.1)`.

- [ ] **Step 1: Write the failing tests**

Append to the end of `src/engine/combat.test.ts`:

```ts
/* ------------------------------------------- Task 13: glancing blows -- */

describe("glancing blows (Plan 3, Task 13)", () => {
  /** Fighter 1 placed so the jab's box (reach 5 + 4) overlaps its body by `overlap`. */
  function jabWithOverlap(overlap: number): Frame[] {
    const s = standing();
    s.fighters[1].x = fx(8 + 5 + 4 - overlap);
    return play(s, 8, JAB);
  }

  // SmashWiki "Glancing blow" (https://www.ssbwiki.com/Glancing_blow): a hitbox
  // that connects "less than 0.1 units through a hurtbox" is a glancing blow —
  // "the attack not hitting" — unchanged from Brawl into Ultimate.
  it("does not hit when the box only grazes the body", () => {
    const frames = jabWithOverlap(0.05);
    expect(frames.flatMap((f) => f.events.hits)).toEqual([]);
    expect(frames.at(-1)!.state.fighters[1].damage).toBe(0);
    // Not spent: the swing may still land if the bodies close in.
    expect(frames.at(-1)!.state.fighters[0].hitThisMove).toEqual([]);
  });

  it("hits once the box is more than 0.1 into the body", () => {
    expect(jabWithOverlap(0.2).flatMap((f) => f.events.hits)).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run them**

Run: `pnpm vitest run src/engine/combat.test.ts`
Expected: FAIL — `does not hit when the box only grazes the body` (`expected [ { attacker: +0, victim: 1, …(6) } ] to deeply equal []`).

- [ ] **Step 3: Implement**

In `src/engine/constants.ts`, replace:

```ts
export const KB_STACK_ARMOUR: Ratio = [1, 2];
export const KB_STACK_KEEP: Ratio = [9, 10];

/** Two hitboxes within this damage difference clank instead of trading. */
```

with:

```ts
export const KB_STACK_ARMOUR: Ratio = [1, 2];
export const KB_STACK_KEEP: Ratio = [9, 10];

/**
 * A hitbox that reaches less than 0.1 units into a hurtbox is a glancing blow and
 * does not hit (SmashWiki "Glancing blow", https://www.ssbwiki.com/Glancing_blow:
 * "less than 0.1 units through a hurtbox"; unchanged from Brawl into Ultimate).
 */
export const GLANCING_BLOW_DEPTH = fx(0.1);

/** Two hitboxes within this damage difference clank instead of trading. */
```

In `src/engine/hitbox.ts`, replace:

```ts
 */

import { ONE, mul, div, clamp } from "./fixed";
import { CLANK_RANGE } from "./constants";
import type { ActiveHit, FighterAttributes, FighterState, Hitbox, MoveDef } from "./types";
```

with:

```ts
 */

import { ONE, mul, div, clamp, sqrt } from "./fixed";
import { CLANK_RANGE } from "./constants";
import type { ActiveHit, FighterAttributes, FighterState, Hitbox, MoveDef } from "./types";
```

In `src/engine/hitbox.ts`, replace:

```ts
}

/* -------------------------------------------------------------- fighters -- */

```

with:

```ts
}

/**
 * How deep a hitbox, swept from its previous position, reaches into the target
 * at its deepest, Q12: the sum of the radii less the closest distance between
 * the two spines. Negative when they do not touch. A hit less than 0.1 deep is a
 * glancing blow (Plan 3, Task 13; `GLANCING_BLOW_DEPTH`).
 */
export function sweptHitboxPenetration(
  prevX: number,
  prevY: number,
  x: number,
  y: number,
  radius: number,
  target: Capsule,
): number {
  return radius + target.r - sqrt(segmentSegmentDistSq(sweptHitboxCapsule(prevX, prevY, x, y, radius), target));
}

/* -------------------------------------------------------------- fighters -- */

```

In `src/engine/simulate.ts`, replace:

```ts
  FINAL_SMASH_STANDBY,
  GROUNDED_ZERO_LAUNCH_RATIO,
  LEDGE_REGRAB_LIMIT,
  LAUNCH_SPEED_RATIO,
```

with:

```ts
  FINAL_SMASH_STANDBY,
  GROUNDED_ZERO_LAUNCH_RATIO,
  GLANCING_BLOW_DEPTH,
  LEDGE_REGRAB_LIMIT,
  LAUNCH_SPEED_RATIO,
```

In `src/engine/simulate.ts`, replace:

```ts
  resolveClank,
  sweptHitboxOverlaps,
} from "./hitbox";
import {
```

with:

```ts
  resolveClank,
  sweptHitboxOverlaps,
  sweptHitboxPenetration,
} from "./hitbox";
import {
```

In `src/engine/simulate.ts`, replace:

```ts
      if (c.projectile !== null && destroyed.has(c.projectile.instanceId)) continue;
      if (recordSaysAlreadyHit(s, c, victim.port)) continue;
      if (!sweptHitboxOverlaps(c.prevX, c.prevY, c.x, c.y, c.hitbox.radius, hurtbox)) continue;
      const key = candidateKey(c);
      const incumbent = perSource.get(key);
```

with:

```ts
      if (c.projectile !== null && destroyed.has(c.projectile.instanceId)) continue;
      if (recordSaysAlreadyHit(s, c, victim.port)) continue;
      // A box that only grazes the body — less than 0.1 deep — is a glancing
      // blow: no hit, and the swing is not spent (Plan 3, Task 13).
      if (sweptHitboxPenetration(c.prevX, c.prevY, c.x, c.y, c.hitbox.radius, hurtbox) < GLANCING_BLOW_DEPTH) continue;
      const key = candidateKey(c);
      const incumbent = perSource.get(key);
```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/engine/combat.test.ts`
Expected: PASS.

- [ ] **Step 5: The golden trace**

Run: `pnpm vitest run src/game/golden.test.ts`
Expected before regenerating: FAIL in the Mario–Fox and Kirby–Marth matches — a few grazing hits no longer land. Regenerate.

```bash
UPDATE_GOLDEN=1 pnpm vitest run src/game/golden.test.ts
pnpm vitest run src/game/golden.test.ts
```

Expected: the second run PASSes. This task changes behaviour on purpose; its commit says so.

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0 (`pnpm lint` reports only the two pre-existing warnings in `research/rebuild-2026-10/tools/sim_bench.mjs`).

- [ ] **Step 7: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/src/engine/combat.test.ts \
  super-smash/src/engine/constants.ts \
  super-smash/src/engine/hitbox.ts \
  super-smash/src/engine/simulate.ts \
  super-smash/src/game/__golden__/engine-trace.json
git commit -m "super-smash: glancing blows (less than 0.1 deep) do not hit" -m "SmashWiki 'Glancing blow'. The swept test measures depth. Golden trace regenerated." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Grabs: floor(90 + 1.7p) frames, mashing, never under 19, 60 frames of immunity

A grab held a flat 60 frames whatever happened. SmashWiki "Grab": from Brawl on the hold is `floor(90 + 1.7p)` frames, fixed when the grab connects; in Ultimate a button press takes 14.4 frames off and a stick input 8; the hold is never shorter than 19 frames; and a fighter who breaks out cannot be grabbed for about a second (60 frames). The escape timer moves to the *victim* (`grabTimer` on the grabbed fighter), counted down in CAPTURE_WAIT, so it keeps running through pummels ("not affected by pummeling"); the holder's CATCH_WAIT already returns to standing when the link breaks. `specials.test.ts`'s held-fixture puts its timer on the victim.

**Files:**
- Modify: `super-smash/src/engine/combat.test.ts`
- Modify: `super-smash/src/engine/combat.ts`
- Modify: `super-smash/src/engine/hash.ts`
- Modify: `super-smash/src/engine/simulate.ts`
- Modify: `super-smash/src/engine/states.ts`
- Modify: `super-smash/src/engine/status/attack.ts`
- Modify: `super-smash/src/engine/types.ts`
- Modify: `super-smash/src/fighters/specials.test.ts`

**Interfaces:** Adds `grabHoldFrames(percent: number): number`, `GRAB_MIN_FRAMES = 19`, `GRAB_MASH_BUTTON = 144`, `GRAB_MASH_STICK = 80` (tenths), `GRAB_RELEASE_IMMUNITY = 60` (`states.ts`); `CombatState.grabImmune`. Changes: `FighterState.grabTimer` is the grabbed fighter's escape timer. Removes `GRAB_HOLD_FRAMES`.

- [ ] **Step 1: Write the failing tests**

In `src/engine/combat.test.ts`, replace:

```ts

import { byRatio, fx, mul } from "./fixed";
import {
  ASDI_DISTANCE,
```

with:

```ts

import { byRatio, fx, mul } from "./fixed";
import { hashState } from "./hash";
import {
  STALE_FRESH_BONUS,
  computeHitlag,
  computeHitstun,
  effectiveHitstun,
  shieldstunExact,
} from "./knockback";
import { GRAB_MIN_FRAMES, GRAB_RELEASE_IMMUNITY, grabHoldFrames } from "./states";
import {
  ASDI_DISTANCE,
```

In `src/engine/combat.test.ts`, replace:

```ts
  TECH_WINDOW,
} from "./constants";
import { hashState } from "./hash";
import {
  STALE_FRESH_BONUS,
  computeHitlag,
  computeHitstun,
  effectiveHitstun,
  shieldstunExact,
} from "./knockback";
import { attackerShieldPushback, shieldDamage, shieldPushback } from "./shield";
import { cloneState, createInitialState, step } from "./simulate";
```

with:

```ts
  TECH_WINDOW,
} from "./constants";
import { attackerShieldPushback, shieldDamage, shieldPushback } from "./shield";
import { cloneState, createInitialState, step } from "./simulate";
```

Append to the end of `src/engine/combat.test.ts`:

```ts
/* ------------------------------------------------------ Task 14: grabs -- */

describe("grab hold, mash and release (Plan 3, Task 14)", () => {
  /** Fighter 0 holding fighter 1, whose escape timer reads `timer`, `held` frames into the hold. */
  function holding(timer: number, held: number): GameState {
    const s = standing();
    const [a, v] = s.fighters;
    a.action = "grabHold";
    a.grabbing = 1;
    v.action = "grabbed";
    v.actionFrame = held;
    v.grabbedBy = 0;
    v.grabTimer = timer;
    return s;
  }

  // SmashWiki "Grab" (https://www.ssbwiki.com/Grab): from Brawl on a grab holds
  // for floor(90 + 1.7p) frames, fixed when it connects.
  it("holds a victim for floor(90 + 1.7 x percent) frames", () => {
    const s = standing();
    s.fighters[1].damage = fx(50);
    const frames = play(s, 8, (i) => [i === 0 ? Btn.Grab : 0, 0]);
    const i = frames.findIndex((f) => f.state.fighters[1].grabbedBy === 0);
    expect(frames[i].state.fighters[1].grabTimer).toBe(175);
    expect(grabHoldFrames(fx(50))).toBe(175);
    expect(grabHoldFrames(fx(33.3))).toBe(146);
  });

  it("lets the victim go when the timer runs out, with 60 frames of grab immunity", () => {
    const frames = play(holding(3, 30), 4, () => [0, 0]);
    const at = frames.findIndex((f) => f.state.fighters[1].grabbedBy < 0);
    expect(at).toBe(2);
    const v = frames[at].state.fighters[1];
    expect(v.action).toBe("stand");
    expect(v.combat.grabImmune).toBe(GRAB_RELEASE_IMMUNITY);
    expect(frames.at(-1)!.state.fighters[0].action).toBe("stand");
  });

  // "The grab time from Brawl onward cannot be lower than 19 frames."
  it("never lets go before the 19th frame of the hold", () => {
    const frames = play(holding(0, 5), 20, () => [0, 0]);
    const at = frames.findIndex((f) => f.state.fighters[1].grabbedBy < 0);
    expect(frames[at].state.fighters[1].actionFrame).toBe(0);
    expect(frames[at - 1].state.fighters[1].actionFrame).toBe(GRAB_MIN_FRAMES - 1);
  });

  // SmashWiki "Grab": a button press takes 14.4 frames off in Ultimate, a stick input 8.
  it("mashes 14.4 frames off a button press and 8 off a stick input", () => {
    const buttons = play(holding(200, 30), 10, (i) => [0, i % 2 === 0 ? Btn.Attack : 0]).at(-1)!.state.fighters[1];
    expect(buttons.grabTimer).toBe(200 - 10 - 72);
    const sticks = play(holding(200, 30), 10, (i) => [0, i % 2 === 0 ? Btn.Left : 0]).at(-1)!.state.fighters[1];
    expect(sticks.grabTimer).toBe(200 - 10 - 40);
  });

  it("whiffs a grab on a fighter who just escaped one, without spending it", () => {
    const s = standing();
    s.fighters[1].combat.grabImmune = 30;
    const after = play(s, 8, (i) => [i === 0 ? Btn.Grab : 0, 0]).at(-1)!.state;
    expect(after.fighters[1].grabbedBy).toBe(-1);
    expect(after.fighters[0].hitThisMove).toEqual([]);
  });
});
```

In `src/fighters/specials.test.ts`, replace:

```ts
    a.action = "grabHold";
    a.grabbing = v.port;
    a.grabTimer = 60;
    v.x = fx(4);
    v.facing = -1;
```

with:

```ts
    a.action = "grabHold";
    a.grabbing = v.port;
    v.grabTimer = 90; // the escape timer is the victim's (Plan 3, Task 14)
    v.x = fx(4);
    v.facing = -1;
```

- [ ] **Step 2: Run them**

Run: `pnpm vitest run src/engine/combat.test.ts src/fighters/specials.test.ts`
Expected: FAIL — `holds a victim for floor(90 + 1.7 x percent) frames` (`expected +0 to be 175`), the release, minimum-19, mash (`expected 200 to be 118`) and immunity cases, and `specials.test.ts` `carries the victim in thrown…` (the holder's own timer, now unset, lets go at once).

- [ ] **Step 3: Implement**

In `src/engine/combat.ts`, replace:

```ts
  /** Frames before another shield press can open a tech window: 40 from the last (Task 12). */
  techLockout: number;
}

```

with:

```ts
  /** Frames before another shield press can open a tech window: 40 from the last (Task 12). */
  techLockout: number;
  /** Frames during which a grab cannot catch this fighter: 60 after breaking out of one (Task 14). */
  grabImmune: number;
}

```

In `src/engine/combat.ts`, replace:

```ts
    techWindow: 0,
    techLockout: 0,
  };
}
```

with:

```ts
    techWindow: 0,
    techLockout: 0,
    grabImmune: 0,
  };
}
```

In `src/engine/combat.ts`, replace:

```ts
    techWindow: c.techWindow,
    techLockout: c.techLockout,
  };
}
```

with:

```ts
    techWindow: c.techWindow,
    techLockout: c.techLockout,
    grabImmune: c.grabImmune,
  };
}
```

In `src/engine/hash.ts`, replace:

```ts
  x = mixInt(x, c.techWindow);
  x = mixInt(x, c.techLockout);
  return x;
}
```

with:

```ts
  x = mixInt(x, c.techWindow);
  x = mixInt(x, c.techLockout);
  x = mixInt(x, c.grabImmune);
  return x;
}
```

In `src/engine/simulate.ts`, replace:

```ts
  applyMovement,
  chargeMultiplier,
  grabLedge,
  hasSuperArmour,
```

with:

```ts
  applyMovement,
  chargeMultiplier,
  grabHoldFrames,
  grabLedge,
  hasSuperArmour,
```

In `src/engine/simulate.ts`, replace:

```ts
    updateTechInput(f, intent);
    if (f.intangible > 0) f.intangible -= 1;
    if (f.invincible > 0) f.invincible -= 1;

```

with:

```ts
    updateTechInput(f, intent);
    if (f.intangible > 0) f.intangible -= 1;
    if (f.combat.grabImmune > 0) f.combat.grabImmune -= 1;
    if (f.invincible > 0) f.invincible -= 1;

```

In `src/engine/simulate.ts`, replace:

```ts
      // wrong outcome that makes dodging strictly better than the real game's.
      if (victim.intangible > 0) continue;
      // Invincible: the fighter *is* there and the hit connects. It is only the
      // consequences that do not land. See `FighterState.invincible`.
```

with:

```ts
      // wrong outcome that makes dodging strictly better than the real game's.
      if (victim.intangible > 0) continue;
      // Fresh out of a grab: grabs pass through, unspent, for 60 frames (Task 14).
      if (c.hitbox.grabbing === true && victim.combat.grabImmune > 0) continue;
      // Invincible: the fighter *is* there and the hit connects. It is only the
      // consequences that do not land. See `FighterState.invincible`.
```

In `src/engine/simulate.ts`, replace:

```ts
    attacker.grabbing = victim.port;
    victim.grabbedBy = attacker.port;
    kineticSet(victim, 0, 0);
    // Being caught cancels a launch that had not fired yet: the victim is held,
```

with:

```ts
    attacker.grabbing = victim.port;
    victim.grabbedBy = attacker.port;
    // The escape timer, fixed now, on the victim (Plan 3, Task 14).
    victim.grabTimer = grabHoldFrames(victim.damage);
    victim.combat.mash = 0;
    kineticSet(victim, 0, 0);
    // Being caught cancels a launch that had not fired yet: the victim is held,
```

In `src/engine/states.ts`, replace:

```ts
export const DOWNED_FRAMES = 40;
export const GETUP_FRAMES = 30;
/** How long a grab holds before the victim escapes on their own. */
export const GRAB_HOLD_FRAMES = 60;
export const PUMMEL_FRAMES = 10;
export const THROW_FRAMES = 40;
```

with:

```ts
export const DOWNED_FRAMES = 40;
export const GETUP_FRAMES = 30;
/**
 * How long a grab holds before the victim escapes on their own: floor(90 + 1.7p)
 * frames, fixed when the grab connects (SmashWiki "Grab",
 * https://www.ssbwiki.com/Grab: "From Brawl onward, the formula is changed to
 * 90 + 1.7p rounded down"). `percent` is Q12.
 */
export function grabHoldFrames(percent: number): number {
  return Math.floor((900 * ONE + 17 * percent) / (10 * ONE));
}
/** No grab lets go sooner than this, however hard the victim mashes (SmashWiki "Grab"). */
export const GRAB_MIN_FRAMES = 19;
/** Mashing out of a grab, in tenths of a frame: 14.4 a button press, 8 a stick input (SmashWiki "Grab", Ultimate). */
export const GRAB_MASH_BUTTON = 144;
export const GRAB_MASH_STICK = 80;
/** Frames a fighter who broke out of a grab cannot be grabbed again: "around one second" (SmashWiki "Grab", Ultimate). */
export const GRAB_RELEASE_IMMUNITY = 60;
export const PUMMEL_FRAMES = 10;
export const THROW_FRAMES = 40;
```

In `src/engine/status/attack.ts`, replace:

```ts
import { SMASH_CHARGE_MAX } from "../constants";
import { clearHitRecord } from "../hitbox";
import {
  GRAB_HOLD_FRAMES,
  PUMMEL_FRAMES,
  THROW_FRAMES,
  bufferPress,
  hasMove,
  presses,
```

with:

```ts
import { SMASH_CHARGE_MAX } from "../constants";
import { clearHitRecord } from "../hitbox";
import { mashFrames } from "../shield";
import {
  GRAB_MASH_BUTTON,
  GRAB_MASH_STICK,
  GRAB_MIN_FRAMES,
  GRAB_RELEASE_IMMUNITY,
  PUMMEL_FRAMES,
  THROW_FRAMES,
  bufferPress,
  buttonPresses,
  hasMove,
  presses,
```

In `src/engine/status/attack.ts`, replace:

```ts
  main(f, intent, ctx) {
    if (f.grabbing >= 0) {
      startAction(f, "grabHold");
      f.grabTimer = GRAB_HOLD_FRAMES;
      return;
    }
```

with:

```ts
  main(f, intent, ctx) {
    if (f.grabbing >= 0) {
      // The escape timer is the victim's, set when the grab connected (Plan 3, Task 14).
      startAction(f, "grabHold");
      return;
    }
```

In `src/engine/status/attack.ts`, replace:

```ts
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
```

with:

```ts
  main(f, intent, ctx) {
    if (f.grabbing < 0) {
      releaseGrab(f, ctx.fighters);
      startAction(f, "stand");
```

In `src/engine/status/attack.ts`, replace:

```ts
  action: "grabbed",
  kineticType: "GROUND_STOP",
  main(f) {
    if (f.grabbedBy < 0) startAction(f, f.grounded ? "stand" : "fall");
  },
};
```

with:

```ts
  action: "grabbed",
  kineticType: "GROUND_STOP",
  main(f, intent, ctx) {
    if (f.grabbedBy < 0) {
      startAction(f, f.grounded ? "stand" : "fall");
      return;
    }
    // The struggle (Plan 3, Task 14): the timer runs down a frame at a time and
    // faster for every press, pummels or not; no escape before frame 19.
    const sticks = f.framesSinceDirPress === 0 ? 1 : 0;
    f.grabTimer -= 1 + mashFrames(f.combat, buttonPresses(intent), sticks, GRAB_MASH_BUTTON, GRAB_MASH_STICK);
    if (f.grabTimer > 0 || f.actionFrame < GRAB_MIN_FRAMES) return;
    // A grab release: the holder's own status sees `grabbing < 0` and stands.
    releaseGrab(f, ctx.fighters);
    f.combat.mash = 0;
    f.combat.grabImmune = GRAB_RELEASE_IMMUNITY;
    startAction(f, f.grounded ? "stand" : "fall");
  },
};
```

In `src/engine/types.ts`, replace:

```ts
  grabbedBy: number;
  grabbing: number;
  grabTimer: number;

```

with:

```ts
  grabbedBy: number;
  grabbing: number;
  /** On a grabbed fighter: frames until it breaks free (`grabHoldFrames`, less mashing). Plan 3, Task 14. */
  grabTimer: number;

```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/engine/combat.test.ts src/fighters/specials.test.ts`
Expected: PASS.

- [ ] **Step 5: The golden trace**

Run: `pnpm vitest run src/game/golden.test.ts`
Expected: PASS, unchanged — the CPUs throw at once and never hold a grab long enough for the timer to matter.

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0 (`pnpm lint` reports only the two pre-existing warnings in `research/rebuild-2026-10/tools/sim_bench.mjs`).

- [ ] **Step 7: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/src/engine/combat.test.ts \
  super-smash/src/engine/combat.ts \
  super-smash/src/engine/hash.ts \
  super-smash/src/engine/simulate.ts \
  super-smash/src/engine/states.ts \
  super-smash/src/engine/status/attack.ts \
  super-smash/src/engine/types.ts \
  super-smash/src/fighters/specials.test.ts
git commit -m "super-smash: grabs hold floor(90 + 1.7p), mash out, and leave 60 frames of immunity" -m "SmashWiki 'Grab' (Ultimate): 14.4 a button, 8 a stick input, never under 19 frames, about a second of grab immunity after a release. The escape timer is the victim's." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Ledge trump: CLIFF_ROBBED

Two fighters could hang on one ledge. SmashWiki "Ledge trump": grabbing an occupied ledge removes the fighter on it, who "cannot take any action for a moment" and loses the ledge's intangibility. The trumped fighter is set just outboard (a hanging fighter stands on the ledge point here; UNVERIFIED placement until Plan 4's ECB) and enters `FIGHTER_STATUS_KIND_CLIFF_ROBBED` for `LEDGE_TRUMPED_FRAMES` (30, UNVERIFIED — no frame count is published), during which it cannot regrab.

**Files:**
- Modify: `super-smash/src/engine/combat.test.ts`
- Modify: `super-smash/src/engine/constants.ts`
- Modify: `super-smash/src/engine/simulate.ts`
- Modify: `super-smash/src/engine/states.ts`
- Modify: `super-smash/src/engine/status/cliff.ts`
- Modify: `super-smash/src/engine/status/groups.test.ts`
- Modify: `super-smash/src/engine/status/kind.ts`
- Modify: `super-smash/src/engine/status/status.test.ts`
- Modify: `super-smash/src/engine/types.ts`
- Modify: `super-smash/src/game/__golden__/engine-trace.json` (regenerated by a command in this task)
- Modify: `super-smash/src/render/poses/timing.ts`

**Interfaces:** Adds `ActionState` `"ledgeTrumped"`, `StatusKind` `"FIGHTER_STATUS_KIND_CLIFF_ROBBED"`, `STATUS_CLIFF_ROBBED` (`status/cliff.ts`), `trumpLedge(f: FighterState, clearance: number): void` (`states.ts`), `LEDGE_TRUMPED_FRAMES = 30` (UNVERIFIED).

- [ ] **Step 1: Write the failing tests**

In `src/engine/combat.test.ts`, replace:

```ts
  GROUNDED_ZERO_LAUNCH_RATIO,
  LAUNCH_SPEED_RATIO,
  PERFECT_SHIELD_PUSHBACK_RATIO,
  SDI_DISTANCE,
```

with:

```ts
  GROUNDED_ZERO_LAUNCH_RATIO,
  LAUNCH_SPEED_RATIO,
  LEDGE_TRUMPED_FRAMES,
  PERFECT_SHIELD_PUSHBACK_RATIO,
  SDI_DISTANCE,
```

Append to the end of `src/engine/combat.test.ts`:

```ts
/* ------------------------------------------------ Task 15: ledge trump -- */

describe("ledge trump (Plan 3, Task 15)", () => {
  /** Fighter 1 hangs on the right ledge; fighter 0 drops onto it from beside. */
  function trump(): Frame[] {
    const s = standing();
    const [a, h] = s.fighters;
    Object.assign(h, { x: fx(80), y: 0, grounded: false, platform: -1, action: "ledgeHang", actionFrame: 5, intangible: 50 });
    h.ledge = { platform: 0, side: 1 };
    h.facing = -1;
    Object.assign(a, { x: fx(84), y: fx(-2), grounded: false, platform: -1, action: "fall", actionFrame: 3, facing: -1 });
    a.kinetic.gravityY = -fx(1);
    a.vy = -fx(1);
    return play(s, LEDGE_TRUMPED_FRAMES + 2, () => [0, 0]);
  }

  // SmashWiki "Ledge trump" (https://www.ssbwiki.com/Ledge_trump): grabbing an
  // occupied ledge removes the fighter on it, who "cannot take any action for a
  // moment" — and loses the ledge's intangibility.
  it("takes the ledge from the fighter on it, who drops off without intangibility", () => {
    const frames = trump();
    const i = frames.findIndex((f) => f.state.fighters[0].ledge !== null);
    const [a, h] = frames[i].state.fighters;
    expect(a.ledge).toEqual({ platform: 0, side: 1 });
    expect(h.ledge).toBeNull();
    expect(h.action).toBe("ledgeTrumped");
    expect(h.intangible).toBe(0);
  });

  it("gives control back after the trump's lag", () => {
    const frames = trump();
    expect(frames.at(-1)!.state.fighters[1].action).toBe("fall");
  });
});
```

In `src/engine/status/groups.test.ts`, replace:

```ts
  dead: "NONE",
  entering: "FALL",
  // Plan 3, Task 12: new statuses, no legacy counterpart.
  tech: "GROUND_STOP",
  techRoll: "MOTION",
```

with:

```ts
  dead: "NONE",
  entering: "FALL",
  // Plan 3, Tasks 12 and 15: new statuses, no legacy counterpart.
  ledgeTrumped: "GROUND_STOP",
  tech: "GROUND_STOP",
  techRoll: "MOTION",
```

In `src/engine/status/groups.test.ts`, replace:

```ts
  "land",
  "landingLag",
  // Plan 3, Task 12
  "tech",
```

with:

```ts
  "land",
  "landingLag",
  // Plan 3, Task 15
  "ledgeTrumped",
  // Plan 3, Task 12
  "tech",
```

In `src/engine/status/status.test.ts`, replace:

```ts
  it("names an SSBU-style kind for every replica action, one-to-one", () => {
    const actions = Object.keys(STATUS_KIND_OF_ACTION) as ActionState[];
    expect(actions).toHaveLength(46);
    const kinds = new Set(actions.map((a) => STATUS_KIND_OF_ACTION[a]));
    expect(kinds.size).toBe(actions.length);
```

with:

```ts
  it("names an SSBU-style kind for every replica action, one-to-one", () => {
    const actions = Object.keys(STATUS_KIND_OF_ACTION) as ActionState[];
    expect(actions).toHaveLength(47);
    const kinds = new Set(actions.map((a) => STATUS_KIND_OF_ACTION[a]));
    expect(kinds.size).toBe(actions.length);
```

In `src/engine/status/status.test.ts`, replace:

```ts
    expect(statusKindOf({ action: "techWall" })).toBe("FIGHTER_STATUS_KIND_PASSIVE_WALL");
    expect(statusKindOf({ action: "techCeiling" })).toBe("FIGHTER_STATUS_KIND_PASSIVE_CEIL");
  });
});
```

with:

```ts
    expect(statusKindOf({ action: "techWall" })).toBe("FIGHTER_STATUS_KIND_PASSIVE_WALL");
    expect(statusKindOf({ action: "techCeiling" })).toBe("FIGHTER_STATUS_KIND_PASSIVE_CEIL");
    expect(statusKindOf({ action: "ledgeTrumped" })).toBe("FIGHTER_STATUS_KIND_CLIFF_ROBBED");
  });
});
```

- [ ] **Step 2: Run them**

Run: `pnpm vitest run src/engine/combat.test.ts src/engine/status/groups.test.ts src/engine/status/status.test.ts`
Expected: FAIL — `status.test.ts` (`to have a length of 47 but got 46`; `expected undefined to be 'FIGHTER_STATUS_KIND_CLIFF_ROBBED'`), `groups.test.ts` (one action short), and both `combat.test.ts` cases (`Cannot read properties of undefined (reading 'state')`: the ledge is never taken).

- [ ] **Step 3: Implement**

In `src/engine/constants.ts`, replace:

```ts
export const LEDGE_REGRAB_SCALING = [fx(1), fx(0.8), fx(0.5), fx(0)] as const;

/** How far from a ledge a fighter may be and still grab it. Fixed. */
export const LEDGE_GRAB_RANGE_X = fx(3.2);
```

with:

```ts
export const LEDGE_REGRAB_SCALING = [fx(1), fx(0.8), fx(0.5), fx(0)] as const;

/**
 * A fighter whose ledge is taken from under it "cannot take any action for a
 * moment" (SmashWiki "Ledge trump"). No frame count is published: UNVERIFIED.
 */
export const LEDGE_TRUMPED_FRAMES = 30;

/** How far from a ledge a fighter may be and still grab it. Fixed. */
export const LEDGE_GRAB_RANGE_X = fx(3.2);
```

In `src/engine/simulate.ts`, replace:

```ts
  shieldCovers,
  startAction,
  updateInputTracking,
} from "./states";
```

with:

```ts
  shieldCovers,
  startAction,
  trumpLedge,
  updateInputTracking,
} from "./states";
```

In `src/engine/simulate.ts`, replace:

```ts
    }

    if (!f.grounded) {
      const grab = findLedgeGrab(f, stage, s.frame, ecbOf(f, defs[i].attributes).half);
      if (grab !== null) {
```

with:

```ts
    }

    // A trumped fighter cannot act, a ledge grab included, until its lag ends.
    if (!f.grounded && f.action !== "ledgeTrumped") {
      const grab = findLedgeGrab(f, stage, s.frame, ecbOf(f, defs[i].attributes).half);
      if (grab !== null) {
```

In `src/engine/simulate.ts`, replace:

```ts
            ? 0
            : ledgeIntangibilityFrames(f.airTime, f.damage, f.ledgeRegrabs);
        grabLedge(f, grab.platform, grab.side, pos.x, pos.y, frames);
      }
```

with:

```ts
            ? 0
            : ledgeIntangibilityFrames(f.airTime, f.damage, f.ledgeRegrabs);
        // Somebody already on it is trumped off it (Plan 3, Task 15).
        for (let j = 0; j < s.fighters.length; j++) {
          const other = s.fighters[j];
          if (j === i || other.ledge === null) continue;
          if (other.ledge.platform !== grab.platform || other.ledge.side !== grab.side) continue;
          trumpLedge(other, defs[j].attributes.width + ONE);
        }
        grabLedge(f, grab.platform, grab.side, pos.x, pos.y, frames);
      }
```

In `src/engine/states.ts`, replace:

```ts
}

/** Snap a fighter onto a ledge it just grabbed. */
export function grabLedge(
```

with:

```ts
}

/**
 * Ledge trump (Plan 3, Task 15): another fighter grabbed the ledge `f` was
 * hanging on, so `f` lets go — losing the ledge's intangibility — and cannot
 * act for a moment (SmashWiki "Ledge trump"). A hanging fighter stands on the
 * ledge point here, so it is set `clearance` outboard first, or it would land
 * on the stage it just fell from (UNVERIFIED placement until Plan 4's ECB).
 */
export function trumpLedge(f: FighterState, clearance: number): void {
  if (f.ledge !== null) f.x += f.ledge.side * clearance;
  f.ledge = null;
  f.intangible = 0;
  kineticClear(f);
  startAction(f, "ledgeTrumped");
}

/** Snap a fighter onto a ledge it just grabbed. */
export function grabLedge(
```

In `src/engine/status/cliff.ts`, replace:

```ts
 */

import { LEDGE_REGRAB_LIMIT } from "../constants";
import {
  LEDGE_ATTACK_FRAMES,
```

with:

```ts
 */

import { LEDGE_REGRAB_LIMIT, LEDGE_TRUMPED_FRAMES } from "../constants";
import {
  LEDGE_ATTACK_FRAMES,
```

In `src/engine/status/cliff.ts`, replace:

```ts
};

export const CLIFF_STATUSES: readonly FighterStatus[] = [
  STATUS_CLIFF_WAIT,
```

with:

```ts
};

/**
 * CLIFF_ROBBED (Plan 3, Task 15): the ledge was taken from under this fighter
 * (`trumpLedge`). It drops, braking, and may not act until the lag is over.
 */
export const STATUS_CLIFF_ROBBED: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_CLIFF_ROBBED",
  action: "ledgeTrumped",
  kineticType: "GROUND_STOP",
  main(f) {
    if (f.actionFrame >= LEDGE_TRUMPED_FRAMES) startAction(f, "fall");
  },
};

export const CLIFF_STATUSES: readonly FighterStatus[] = [
  STATUS_CLIFF_WAIT,
```

In `src/engine/status/cliff.ts`, replace:

```ts
  STATUS_CLIFF_ESCAPE,
  STATUS_CLIFF_JUMP1,
];
```

with:

```ts
  STATUS_CLIFF_ESCAPE,
  STATUS_CLIFF_JUMP1,
  STATUS_CLIFF_ROBBED,
];
```

In `src/engine/status/kind.ts`, replace:

```ts
  | "FIGHTER_STATUS_KIND_CLIFF_ESCAPE"
  | "FIGHTER_STATUS_KIND_CLIFF_JUMP1"
  | "FIGHTER_STATUS_KIND_REBIRTH"
  | "FIGHTER_STATUS_KIND_DEAD"
```

with:

```ts
  | "FIGHTER_STATUS_KIND_CLIFF_ESCAPE"
  | "FIGHTER_STATUS_KIND_CLIFF_JUMP1"
  | "FIGHTER_STATUS_KIND_CLIFF_ROBBED"
  | "FIGHTER_STATUS_KIND_REBIRTH"
  | "FIGHTER_STATUS_KIND_DEAD"
```

In `src/engine/status/kind.ts`, replace:

```ts
  ledgeRoll: "FIGHTER_STATUS_KIND_CLIFF_ESCAPE",
  ledgeJump: "FIGHTER_STATUS_KIND_CLIFF_JUMP1",
  respawnPlatform: "FIGHTER_STATUS_KIND_REBIRTH",
  dead: "FIGHTER_STATUS_KIND_DEAD",
```

with:

```ts
  ledgeRoll: "FIGHTER_STATUS_KIND_CLIFF_ESCAPE",
  ledgeJump: "FIGHTER_STATUS_KIND_CLIFF_JUMP1",
  ledgeTrumped: "FIGHTER_STATUS_KIND_CLIFF_ROBBED",
  respawnPlatform: "FIGHTER_STATUS_KIND_REBIRTH",
  dead: "FIGHTER_STATUS_KIND_DEAD",
```

In `src/engine/types.ts`, replace:

```ts
  | "ledgeRoll"
  | "ledgeJump"
  // meta
  | "respawnPlatform"
```

with:

```ts
  | "ledgeRoll"
  | "ledgeJump"
  | "ledgeTrumped"
  // meta
  | "respawnPlatform"
```

In `src/render/poses/timing.ts`, replace:

```ts
    case "fall":
    case "dead":
      return f.fastFalling ? "fastFall" : "fall";
    case "land":
```

with:

```ts
    case "fall":
    case "dead":
    case "ledgeTrumped":
      return f.fastFalling ? "fastFall" : "fall";
    case "land":
```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/engine/combat.test.ts src/engine/status/groups.test.ts src/engine/status/status.test.ts`
Expected: PASS.

- [ ] **Step 5: The golden trace**

Run: `pnpm vitest run src/game/golden.test.ts`
Expected before regenerating: FAIL in the Mario–Fox, Donkey Kong–Pikachu and Kirby–Marth matches — the CPUs trump each other at the ledge. Regenerate.

```bash
UPDATE_GOLDEN=1 pnpm vitest run src/game/golden.test.ts
pnpm vitest run src/game/golden.test.ts
```

Expected: the second run PASSes. This task changes behaviour on purpose; its commit says so.

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0 (`pnpm lint` reports only the two pre-existing warnings in `research/rebuild-2026-10/tools/sim_bench.mjs`).

- [ ] **Step 7: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/src/engine/combat.test.ts \
  super-smash/src/engine/constants.ts \
  super-smash/src/engine/simulate.ts \
  super-smash/src/engine/states.ts \
  super-smash/src/engine/status/cliff.ts \
  super-smash/src/engine/status/groups.test.ts \
  super-smash/src/engine/status/kind.ts \
  super-smash/src/engine/status/status.test.ts \
  super-smash/src/engine/types.ts \
  super-smash/src/game/__golden__/engine-trace.json \
  super-smash/src/render/poses/timing.ts
git commit -m "super-smash: ledge trump (CLIFF_ROBBED)" -m "SmashWiki 'Ledge trump': the fighter on the ledge is removed without intangibility and cannot act for a moment (length UNVERIFIED). Golden trace regenerated." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Script hitboxes carry set weight, ground/air-only, LR checks, spike angles; clear_all re-arms

Before any imported script runs (Task 18), the hitbox pipeline has to honour what those scripts say that the legacy tables never needed: `set_weight` (knockback as if the victim weighed 100 — Mario's down air is set weight, which the legacy table had transcribed as set knockback), `COLLISION_SITUATION_MASK_G/A` (boxes that only hit grounded or airborne victims), `ATTACK_LR_CHECK_POS/B` (launch away from the attacker by position, or backwards — a down smash's back hit), a downward angle as a meteor (rubendal `spike = angle >= 230 && angle <= 310`) where the script does not say, and `AttackModule::clear_all` re-arming a box the script issues again, which is how every ACMD multi-hit works.

Re-arming must not re-stale. The move joined the stale queue on "the first connection" through `hitThisMove.length === 1`, which `clear_all` resets — so a five-hit drill queued itself five times and each hit dealt progressively staler damage. SmashWiki "Stale Moves": from Brawl on, later hitboxes of a multi-hit move are protected "from being staled while the move is in progress". So a swing now queues once — `CombatState.swingQueued`, set on the first connection and reset by `startMove` — and its later hits (a re-armed box, or a second victim) use the staleness of its first, leaving its own new entry out.

Legacy-compiled scripts clear by id, never `clear_all`, and `attackFromHitbox` now states `meteor` explicitly either way — so the golden trace must not move.

**Files:**
- Modify: `super-smash/src/engine/acmd/hitboxes.ts`
- Modify: `super-smash/src/engine/acmd/legacy.ts`
- Modify: `super-smash/src/engine/combat.test.ts`
- Modify: `super-smash/src/engine/combat.ts`
- Modify: `super-smash/src/engine/hash.ts`
- Modify: `super-smash/src/engine/simulate.ts`
- Modify: `super-smash/src/engine/states.ts`
- Modify: `super-smash/src/engine/types.ts`

**Interfaces:** `Hitbox` gains `setWeight?: boolean`, `situation?: "ground" | "air"`, `lr?: "position" | "back"`. `scriptHitboxes` maps `setWeight`, `situation`, `facing`, `direct` and a spike angle; `attackFromHitbox` sets `meteor: boolean`. `gatherHitboxes` clears the swing's hit record when the frame fired `clearAll`. `CombatState.swingQueued: boolean`, reset in `startMove`; a local `swingStaleness` in `simulate.ts`.

- [ ] **Step 1: Write the failing tests**

In `src/engine/combat.test.ts`, replace:

```ts

import { byRatio, fx, mul } from "./fixed";
import { hashState } from "./hash";
import {
  STALE_FRESH_BONUS,
  computeHitlag,
  computeHitstun,
  effectiveHitstun,
  shieldstunExact,
```

with:

```ts

import { byRatio, fx, mul } from "./fixed";
import { ATTACK, clearAll, frame } from "./acmd/dsl";
import type { AcmdCommand } from "./acmd/types";
import { hashState } from "./hash";
import {
  GROUNDED_METEOR_MULTIPLIER,
  STALE_FRESH_BONUS,
  computeHitlag,
  computeHitstun,
  computeKnockback,
  computeStaleness,
  effectiveHitstun,
  shieldstunExact,
```

Append to the end of `src/engine/combat.test.ts`:

```ts
/* ------------------------------------ Task 16: what a script hitbox says -- */

describe("script hitboxes carry the game's own flags (Plan 3, Task 16)", () => {
  /** The tester with its jab replaced by `commands` (a `game_attack11` script). */
  function scripted(commands: readonly AcmdCommand[]): SimContext {
    const def: FighterDef = { ...BASE_DEF, scripts: { jab1: { name: "game_attack11", motion: "attack_11", commands } } };
    return ctxFor(def);
  }
  const box = (over: Partial<Parameters<typeof ATTACK>[0]> = {}) =>
    ATTACK({ id: 0, bone: "top", damage: 10, angle: 45, kbg: 100, bkb: 40, size: 5, x: 0, y: 6, z: 8, ...over });
  function hits(ctx: SimContext, prepare: (s: GameState) => void = () => {}, n = 12): StepEvents["hits"] {
    const s = standing(ctx);
    prepare(s);
    return play(s, n, JAB, ctx).flatMap((f) => f.events.hits);
  }

  it("weighs every victim as 100 for a set-weight hitbox", () => {
    const heavy = (s: GameState) => {
      s.fighters[1].damage = fx(60);
    };
    const set = hits(scripted([frame(4), box({ setWeight: true }), frame(7), clearAll()]), heavy)[0];
    const plain = hits(scripted([frame(4), box(), frame(7), clearAll()]), heavy)[0];
    // The tester weighs 98: set weight treats it as 100, so a little less knockback.
    expect(set.knockback).toBe(
      computeKnockback({
        percent: fx(60) + set.damage,
        damage: mul(fx(10), computeStaleness([], "jab1").knockback),
        weight: 100,
        baseKnockback: fx(40),
        knockbackGrowth: fx(100),
      }),
    );
    expect(set.knockback).toBeLessThan(plain.knockback);
  });

  it("misses a grounded victim with an air-only hitbox", () => {
    expect(hits(scripted([frame(4), box({ situation: "COLLISION_SITUATION_MASK_A" }), frame(7), clearAll()]))).toEqual([]);
  });

  it("launches away from the attacker with ATTACK_LR_CHECK_POS, even from behind", () => {
    const behind = (s: GameState) => {
      s.fighters[1].x = fx(-8);
    };
    const pos = hits(scripted([frame(4), box({ z: -8, facing: "ATTACK_LR_CHECK_POS" }), frame(7), clearAll()]), behind)[0];
    // World angle: a 45° launch to the left is 135°.
    expect(pos.angle).toBe(fx(135));
    const ahead = hits(scripted([frame(4), box({ z: -8 }), frame(7), clearAll()]), behind)[0];
    expect(ahead.angle).toBe(fx(45));
  });

  it("re-arms a hitbox the script clears with clear_all, as a multi-hit does", () => {
    // Weightless hits (no knockback), so the victim stays inside the box.
    const pinned = (): void => {};
    const twice = hits(scripted([frame(4), box({ bkb: 0, kbg: 0 }), frame(5), clearAll(), frame(9), box({ bkb: 0, kbg: 0 }), frame(10), clearAll()]), pinned, 40);
    expect(twice).toHaveLength(2);
    // One swing stales once, and its second hit is no staler than its first.
    expect(twice[1].damage).toBe(twice[0].damage);
    const once = hits(scripted([frame(4), box({ bkb: 0, kbg: 0 }), { op: "clear", id: 0 }, frame(9), box({ bkb: 0, kbg: 0 }), frame(10), clearAll()]), pinned, 40);
    expect(once).toHaveLength(1);
  });

  // SmashWiki "Stale Moves": from Brawl on, later hitboxes of a multi-hit move are
  // not staled by its earlier ones while the move is in progress.
  it("queues a multi-hit swing once, however many times it re-arms", () => {
    const def: FighterDef = {
      ...BASE_DEF,
      scripts: {
        jab1: {
          name: "game_attack11",
          motion: "attack_11",
          commands: [frame(4), box({ bkb: 0, kbg: 0 }), frame(5), clearAll(), frame(9), box({ bkb: 0, kbg: 0 }), frame(10), clearAll()],
        },
      },
    };
    const after = play(standing(ctxFor(def)), 40, JAB, ctxFor(def)).at(-1)!.state.fighters[0];
    expect(after.staleQueue).toEqual(["jab1"]);
    expect(after.combat.staleShield).toEqual([false]);
  });

  it("treats a downward angle as a meteor on a grounded victim when the script does not say", () => {
    const spike = hits(scripted([frame(4), box({ angle: 270, bkb: 80, kbg: 0 }), frame(7), clearAll()]))[0];
    expect(spike.knockback).toBe(byRatio(fx(80), GROUNDED_METEOR_MULTIPLIER));
  });
});
```

- [ ] **Step 2: Run them**

Run: `pnpm vitest run src/engine/combat.test.ts`
Expected: FAIL — `weighs every victim as 100…` (`expected 485601 to be 483144`), `misses a grounded victim with an air-only hitbox`, `launches away … ATTACK_LR_CHECK_POS` (`expected 184320 to be 552960`), `re-arms a hitbox … clear_all` (`to have a length of 2 but got 1`), `queues a multi-hit swing once…`, `treats a downward angle as a meteor…` (`expected 327680 to be 262144`). Against the re-arm without `swingQueued`, the stale cases fail with `expected 37280 to be 43010` and `expected [ 'jab1', 'jab1' ] to deeply equal [ 'jab1' ]`.

- [ ] **Step 3: Implement**

In `src/engine/acmd/hitboxes.ts`, replace:

```ts
 */

import { ONE } from "../fixed";
import type { HitEffect, Hitbox } from "../types";
import { bonePoint, newBonePose } from "./bones";
```

with:

```ts
 */

import { ONE, fx } from "../fixed";
import type { HitEffect, Hitbox } from "../types";
import { bonePoint, newBonePose } from "./bones";
```

In `src/engine/acmd/hitboxes.ts`, replace:

```ts
    ...(a.hitlag !== ONE ? { hitlagMultiplier: a.hitlag } : {}),
    ...(setoff !== undefined ? { shieldstunMultiplier: setoff } : {}),
    ...(a.meteor ? { meteor: true } : {}),
  };
}

function catchHitbox(c: CatchParams, gameFrame: number, at: { x: number; y: number }): Hitbox {
```

with:

```ts
    ...(a.hitlag !== ONE ? { hitlagMultiplier: a.hitlag } : {}),
    ...(setoff !== undefined ? { shieldstunMultiplier: setoff } : {}),
    ...((a.meteor ?? isSpikeAngle(a.angle)) ? { meteor: true } : {}),
    ...(a.direct ? {} : { direct: false }),
    ...(a.setWeight ? { setWeight: true } : {}),
    ...(SITUATION[a.situation] !== undefined ? { situation: SITUATION[a.situation] } : {}),
    ...(LR[a.facing] !== undefined ? { lr: LR[a.facing] } : {}),
  };
}

/** Which situations a `COLLISION_SITUATION_MASK_*` restricts a box to; GA (both) is no restriction. */
const SITUATION: Readonly<Partial<Record<AttackParams["situation"], "ground" | "air">>> = {
  COLLISION_SITUATION_MASK_G: "ground",
  COLLISION_SITUATION_MASK_G_d: "ground",
  COLLISION_SITUATION_MASK_A: "air",
};

/** `ATTACK_LR_CHECK_*` → launch direction rule; F (forward) is the default. */
const LR: Readonly<Partial<Record<AttackParams["facing"], "position" | "back">>> = {
  ATTACK_LR_CHECK_POS: "position",
  ATTACK_LR_CHECK_B: "back",
};

/**
 * A downward launch (230°–310°) is a meteor, cut to 0.8× against a grounded
 * victim — rubendal SSBU-Calculator `js/knockback.js`: `spike = angle >= 230
 * && angle <= 310`. Legacy-compiled scripts say `meteor` outright, so only
 * imported scripts are classified by angle.
 */
function isSpikeAngle(angle: number): boolean {
  return angle >= SPIKE_ANGLE_MIN && angle <= SPIKE_ANGLE_MAX;
}
const SPIKE_ANGLE_MIN = fx(230);
const SPIKE_ANGLE_MAX = fx(310);

function catchHitbox(c: CatchParams, gameFrame: number, at: { x: number; y: number }): Hitbox {
```

In `src/engine/acmd/legacy.ts`, replace:

```ts
    collisionAttr: ATTR_OF_EFFECT[hb.effect ?? "normal"],
    region: "ATTACK_REGION_NONE",
    ...(hb.meteor ? { meteor: true } : {}),
  };
}
```

with:

```ts
    collisionAttr: ATTR_OF_EFFECT[hb.effect ?? "normal"],
    region: "ATTACK_REGION_NONE",
    // Explicit either way, so the hitbox pipeline never classifies a legacy
    // move's angle as a meteor on its own (Plan 3, Task 16).
    meteor: hb.meteor === true,
  };
}
```

In `src/engine/combat.ts`, replace:

```ts
  /** Frames during which a grab cannot catch this fighter: 60 after breaking out of one (Task 14). */
  grabImmune: number;
}

```

with:

```ts
  /** Frames during which a grab cannot catch this fighter: 60 after breaking out of one (Task 14). */
  grabImmune: number;
  /** The current swing has already joined the stale queue; reset by `startMove` (Task 16). */
  swingQueued: boolean;
}

```

In `src/engine/combat.ts`, replace:

```ts
    techLockout: 0,
    grabImmune: 0,
  };
}
```

with:

```ts
    techLockout: 0,
    grabImmune: 0,
    swingQueued: false,
  };
}
```

In `src/engine/combat.ts`, replace:

```ts
    techLockout: c.techLockout,
    grabImmune: c.grabImmune,
  };
}
```

with:

```ts
    techLockout: c.techLockout,
    grabImmune: c.grabImmune,
    swingQueued: c.swingQueued,
  };
}
```

In `src/engine/hash.ts`, replace:

```ts
  x = mixInt(x, c.techLockout);
  x = mixInt(x, c.grabImmune);
  return x;
}
```

with:

```ts
  x = mixInt(x, c.techLockout);
  x = mixInt(x, c.grabImmune);
  x = mixBool(x, c.swingQueued);
  return x;
}
```

In `src/engine/simulate.ts`, replace:

```ts
    const run = moveScriptFrame(defs[i], f);
    if (run === null) continue;
    const live = scriptHitboxes(run.state, defs[i].id, run.script.motion, run.gameFrame, bones);
    for (const hb of live) {
```

with:

```ts
    const run = moveScriptFrame(defs[i], f);
    if (run === null) continue;
    // `AttackModule::clear_all` ends the swing's hit record with its boxes, so a
    // box the script issues again can hit again — how a multi-hit works. Legacy
    // moves only ever clear by id, and keep one hit per swing (Plan 3, Task 16).
    if (run.state.fired.some((cmd) => cmd.op === "clearAll")) clearHitRecord(f);
    const live = scriptHitboxes(run.state, defs[i].id, run.script.motion, run.gameFrame, bones);
    for (const hb of live) {
```

In `src/engine/simulate.ts`, replace:

```ts
    for (const c of candidates) {
      if (c.suppressed || c.attacker === v) continue;
      if (c.projectile !== null && destroyed.has(c.projectile.instanceId)) continue;
      if (recordSaysAlreadyHit(s, c, victim.port)) continue;
```

with:

```ts
    for (const c of candidates) {
      if (c.suppressed || c.attacker === v) continue;
      if (c.hitbox.situation === "ground" && !victim.grounded) continue;
      if (c.hitbox.situation === "air" && victim.grounded) continue;
      if (c.projectile !== null && destroyed.has(c.projectile.instanceId)) continue;
      if (recordSaysAlreadyHit(s, c, victim.port)) continue;
```

In `src/engine/simulate.ts`, replace:

```ts
 * to be invincible at the time.
 */
function isCrouching(f: FighterState): boolean {
  return f.action === "crouch" || f.action === "crouchStart";
```

with:

```ts
 * to be invincible at the time.
 */
/**
 * How stale this swing is. A move joins the queue once per swing (Plan 3,
 * Task 16): its later hits — a multi-hit re-armed by `clear_all`, or a second
 * victim — are as stale as its first was, not one level more (SmashWiki "Stale
 * Moves": from Brawl on, "later hitboxes of multi-hit moves" are protected
 * "from being staled while the move is in progress"). So once the swing has
 * queued itself, its own entry is left out.
 */
function swingStaleness(attacker: FighterState, slot: MoveSlot) {
  const queued = attacker.combat.swingQueued;
  return computeStaleness(
    queued ? attacker.staleQueue.slice(1) : attacker.staleQueue,
    slot,
    queued ? attacker.combat.staleShield.slice(1) : attacker.combat.staleShield,
  );
}

function isCrouching(f: FighterState): boolean {
  return f.action === "crouch" || f.action === "crouchStart";
```

In `src/engine/simulate.ts`, replace:

```ts
function effectiveDamage(s: GameState, attacker: FighterState, c: Candidate): number {
  const staleness =
    c.slot === null
      ? ONE
      : computeStaleness(attacker.staleQueue, c.slot, attacker.combat.staleShield).damage;
  const shortHopped = c.slot !== null && isAerialSlot(c.slot) && attacker.shortHop;
  const charged = mul(c.hitbox.damage, c.chargeScale);
```

with:

```ts
function effectiveDamage(s: GameState, attacker: FighterState, c: Candidate): number {
  const staleness =
    c.slot === null ? ONE : swingStaleness(attacker, c.slot).damage;
  const shortHopped = c.slot !== null && isAerialSlot(c.slot) && attacker.shortHop;
  const charged = mul(c.hitbox.damage, c.chargeScale);
```

In `src/engine/simulate.ts`, replace:

```ts
  // the staleness queue is keyed by move slot and an arrow has left its move.
  const staleness =
    c.slot === null
      ? { damage: ONE, knockback: ONE }
      : computeStaleness(attacker.staleQueue, c.slot, attacker.combat.staleShield);
  // An aerial thrown out of a short hop deals 0.85×, and the reduction is
  // applied to the damage *before* knockback is computed rather than to the
```

with:

```ts
  // the staleness queue is keyed by move slot and an arrow has left its move.
  const staleness =
    c.slot === null ? { damage: ONE, knockback: ONE } : swingStaleness(attacker, c.slot);
  // An aerial thrown out of a short hop deals 0.85×, and the reduction is
  // applied to the damage *before* knockback is computed rather than to the
```

In `src/engine/simulate.ts`, replace:

```ts
  const onShield =
    shieldCovers(victim, c.x) && circlesOverlap(c.x, c.y, hb.radius, bubble.x1, bubble.y1, bubble.r);
  if (c.slot !== null && attacker.hitThisMove.length === 1) {
    attacker.staleQueue.unshift(c.slot);
    attacker.combat.staleShield.unshift(onShield);
```

with:

```ts
  const onShield =
    shieldCovers(victim, c.x) && circlesOverlap(c.x, c.y, hb.radius, bubble.x1, bubble.y1, bubble.r);
  if (c.slot !== null && !attacker.combat.swingQueued) {
    attacker.combat.swingQueued = true;
    attacker.staleQueue.unshift(c.slot);
    attacker.combat.staleShield.unshift(onShield);
```

In `src/engine/simulate.ts`, replace:

```ts
    percent: victim.damage,
    damage: kbDamage,
    weight: victimDef.attributes.weight,
    baseKnockback: hb.baseKnockback,
    knockbackGrowth: hb.knockbackGrowth,
```

with:

```ts
    percent: victim.damage,
    damage: kbDamage,
    weight: hb.setWeight === true ? 100 : victimDef.attributes.weight,
    baseKnockback: hb.baseKnockback,
    knockbackGrowth: hb.knockbackGrowth,
```

In `src/engine/simulate.ts`, replace:

```ts
  // A projectile launches along the way *it* is pointing, which is the facing its
  // thrower had when it left rather than whichever way they happen to be looking
  // now — the arrow does not turn round when Link does.
  const sourceFacing = c.projectile !== null ? c.projectile.facing : attacker.facing;

  // Knockback stacking (Plan 3, Task 8): against a launch still live — in
```

with:

```ts
  // A projectile launches along the way *it* is pointing, which is the facing its
  // thrower had when it left rather than whichever way they happen to be looking
  // now — the arrow does not turn round when Link does. `ATTACK_LR_CHECK_POS`
  // launches away from the attacker by position; `_B` launches backwards.
  const forward = c.projectile !== null ? c.projectile.facing : attacker.facing;
  const fromX = c.projectile !== null ? c.projectile.x : attacker.x;
  const sourceFacing =
    hb.lr === "position" ? (victim.x === fromX ? forward : victim.x > fromX ? 1 : -1) : hb.lr === "back" ? -forward : forward;

  // Knockback stacking (Plan 3, Task 8): against a launch still live — in
```

In `src/engine/states.ts`, replace:

```ts
  f.charge = 0;
  clearHitRecord(f);
}

```

with:

```ts
  f.charge = 0;
  clearHitRecord(f);
  // A new swing: it will join the stale queue on its first hit (Plan 3, Task 16).
  f.combat.swingQueued = false;
}

```

In `src/engine/types.ts`, replace:

```ts
   */
  readonly direct?: boolean;
}

```

with:

```ts
   */
  readonly direct?: boolean;
  /** smash-script `set_weight`: knockback as if every victim weighed 100 (Plan 3, Task 16). */
  readonly setWeight?: boolean;
  /** `COLLISION_SITUATION_MASK_G`/`_A`: the box hits only grounded, or only airborne, victims. */
  readonly situation?: "ground" | "air";
  /**
   * `ATTACK_LR_CHECK_POS`: launch away from the attacker whichever side the
   * victim is on; `ATTACK_LR_CHECK_B`: launch backwards. Absent: forwards.
   */
  readonly lr?: "position" | "back";
}

```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/engine/combat.test.ts`
Expected: PASS.

- [ ] **Step 5: The golden trace**

Run: `pnpm vitest run src/game/golden.test.ts`
Expected: PASS, unchanged — every running script is still a legacy compilation. A divergence here is a bug in this task.

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0 (`pnpm lint` reports only the two pre-existing warnings in `research/rebuild-2026-10/tools/sim_bench.mjs`).

- [ ] **Step 7: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/src/engine/acmd/hitboxes.ts \
  super-smash/src/engine/acmd/legacy.ts \
  super-smash/src/engine/combat.test.ts \
  super-smash/src/engine/combat.ts \
  super-smash/src/engine/hash.ts \
  super-smash/src/engine/simulate.ts \
  super-smash/src/engine/states.ts \
  super-smash/src/engine/types.ts
git commit -m "super-smash: script hitboxes honour set weight, situation, LR checks, spikes and clear_all" -m "What the imported scripts say and the legacy tables never needed; a swing joins the stale queue once however often clear_all re-arms it (SmashWiki 'Stale Moves'). Legacy-compiled scripts behave exactly as before (golden trace unchanged)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Capsule (extended) hitboxes

Most of the root-bone scripts Task 18 activates — 25 of 38, every grab among them — use extended hitboxes: `ATTACK(…, X, Y, Z, X2, Y2, Z2, …)` is the capsule between two points. Plan 2's `scriptHitboxes` rejects them; this task replaces the rejection with support. A script box resolves both ends through the bone table into `Hitbox.x/y` and `x2/y2`; a candidate carries the far end's offset (`dx, dy`); a capsule moving without turning sweeps a parallelogram, so the hit test is the deepest of its four edges — the near end's sweep, the far end's sweep, the capsule where it was and where it is now — or the full reach when the target's spine lies inside the parallelogram (`sweptCapsulePenetration`); clanks, the shield bubble and the Smash Ball use the capsule too. With no length every test reduces to the sphere's exactly, so legacy moves — and the golden trace — do not move.

**Files:**
- Modify: `super-smash/src/engine/acmd/bones.test.ts`
- Modify: `super-smash/src/engine/acmd/hitboxes.ts`
- Modify: `super-smash/src/engine/combat.test.ts`
- Modify: `super-smash/src/engine/hitbox.test.ts`
- Modify: `super-smash/src/engine/hitbox.ts`
- Modify: `super-smash/src/engine/simulate.ts`
- Modify: `super-smash/src/engine/types.ts`

**Interfaces:** `Hitbox` gains `x2?: number; y2?: number`. Adds `sweptCapsulePenetration(prevX, prevY, x, y, dx, dy, radius, target: Capsule): number` (`hitbox.ts`). `scriptHitboxes` resolves `x2/y2/z2` (an axis left out takes the near end's value) instead of rejecting them.

- [ ] **Step 1: Write the failing tests**

In `src/engine/acmd/bones.test.ts`, replace:

```ts
  });

  it("refuses an extended (capsule) hitbox until Plan 3 can collide one", () => {
    const capsule = script("game_test", "attack_s3_s", [
      ATTACK({ id: 2, bone: "top", damage: 9, angle: 361, kbg: 100, bkb: 20, size: 3, x: 0, y: 6, z: 4, x2: 0, y2: 6, z2: 12 }),
    ]);
    expect(() => scriptHitboxes(runScript(capsule, 1), "mario", "attack_s3_s", 1, LEGACY_BONE_TABLE)).toThrow(/capsule/);
  });
});
```

with:

```ts
  });

  // Plan 3, Task 17: an extended hitbox resolves both ends through the bone table.
  it("resolves both ends of an extended (capsule) hitbox", () => {
    const capsule = script("game_test", "attack_s3_s", [
      ATTACK({ id: 2, bone: "top", damage: 9, angle: 361, kbg: 100, bkb: 20, size: 3, x: 0, y: 6, z: 4, x2: 0, y2: 6, z2: 12 }),
    ]);
    const [hb] = scriptHitboxes(runScript(capsule, 1), "mario", "attack_s3_s", 1, LEGACY_BONE_TABLE);
    expect([hb.x, hb.y, hb.x2, hb.y2]).toEqual([fx(4), fx(6), fx(12), fx(6)]);
  });
});
```

Append to the end of `src/engine/combat.test.ts`:

```ts
/* ------------------------------------------ Task 17: capsule hitboxes -- */

describe("capsule hitboxes through a real hit (Plan 3, Task 17)", () => {
  function hitsWith(attack: ReturnType<typeof ATTACK>): StepEvents["hits"] {
    const def: FighterDef = {
      ...BASE_DEF,
      scripts: { jab1: { name: "game_attack11", motion: "attack_11", commands: [frame(4), attack, frame(7), clearAll()] } },
    };
    const s = standing(ctxFor(def));
    s.fighters[1].x = fx(20);
    return play(s, 8, JAB, ctxFor(def)).flatMap((f) => f.events.hits);
  }

  // smash-script `ATTACK(…, X, Y, Z, X2, Y2, Z2, …)`: an extended hitbox is the
  // capsule between the two points, not a sphere at the first.
  it("hits with the far end of an extended hitbox", () => {
    expect(hitsWith(ATTACK({ id: 0, bone: "top", damage: 5, angle: 45, kbg: 50, bkb: 30, size: 2, x: 0, y: 6, z: 2, z2: 15 }))).toHaveLength(1);
  });

  it("misses with the same box as a sphere at its first point", () => {
    expect(hitsWith(ATTACK({ id: 0, bone: "top", damage: 5, angle: 45, kbg: 50, bkb: 30, size: 2, x: 0, y: 6, z: 2 }))).toEqual([]);
  });
});
```

In `src/engine/hitbox.test.ts`, replace:

```ts
  segmentsIntersect,
  sweptHitboxOverlaps,
} from "./hitbox";
import type { Capsule } from "./hitbox";
```

with:

```ts
  segmentsIntersect,
  sweptHitboxOverlaps,
  sweptCapsulePenetration,
  sweptHitboxPenetration,
} from "./hitbox";
import type { Capsule } from "./hitbox";
```

Append to the end of `src/engine/hitbox.test.ts`:

```ts
describe("capsule hitboxes (Plan 3, Task 17)", () => {
  const body: Capsule = { x1: fx(20), y1: fx(4), x2: fx(20), y2: fx(8), r: fx(4) };

  it("reaches a target its far end touches, though its near end does not", () => {
    // Near end at x 0, far end at x 15: only the far end is within 4 + 2 of the body.
    const depth = sweptCapsulePenetration(0, fx(6), 0, fx(6), fx(15), 0, fx(2), body);
    expect(depth).toBeCloseTo(fx(1), -2);
    expect(sweptHitboxPenetration(0, fx(6), 0, fx(6), fx(2), body)).toBeLessThan(0);
  });

  // A long capsule sweeping sideways passes over a small target in its middle:
  // no edge of the swept area comes near it, but the area covers it.
  it("reaches a target the swept area passes over, though no edge touches it", () => {
    const small: Capsule = circle(fx(10), fx(5), fx(0.5));
    const depth = sweptCapsulePenetration(0, 0, fx(20), 0, 0, fx(10), fx(1), small);
    expect(depth).toBe(fx(1.5));
    // …and a target beside the swept area is missed.
    expect(sweptCapsulePenetration(0, 0, fx(20), 0, 0, fx(10), fx(1), circle(fx(30), fx(5), fx(0.5)))).toBeLessThan(0);
  });

  it("is the swept sphere when it has no length", () => {
    fc.assert(
      fc.property(fc.integer({ min: -40, max: 40 }), fc.integer({ min: -40, max: 40 }), (px, x) => {
        expect(sweptCapsulePenetration(fx(px), fx(6), fx(x), fx(6), 0, 0, fx(2), body)).toBe(
          sweptHitboxPenetration(fx(px), fx(6), fx(x), fx(6), fx(2), body),
        );
      }),
    );
  });
});
```

- [ ] **Step 2: Run them**

Run: `pnpm vitest run src/engine/acmd/bones.test.ts src/engine/combat.test.ts src/engine/hitbox.test.ts`
Expected: FAIL — `reaches a target its far end touches…`, `reaches a target the swept area passes over…` and the property case (`sweptCapsulePenetration is not a function`); `resolves both ends of an extended (capsule) hitbox` and `hits with the far end of an extended hitbox` (`Error: capsule hitbox (x2/y2/z2) id … not supported until Plan 3` — Plan 2's guard, which this task replaces; the `bones.test.ts` case is Plan 2's "refuses an extended (capsule) hitbox" test, rewritten).

- [ ] **Step 3: Implement**

In `src/engine/acmd/hitboxes.ts`, replace:

```ts
 * clanks, priority, shields and knockback are untouched. Plan 3 extends the
 * pipeline to read `AttackParams` directly (capsules, SDI, set weight, trip…).
 * Until then an extended (capsule) ATTACK or CATCH — one with `x2/y2/z2` — is
 * refused loudly: the pipeline has only spheres, and dropping the far end
 * would quietly shrink the move.
 */

```

with:

```ts
 * clanks, priority, shields and knockback are untouched. Plan 3 extends the
 * pipeline to read `AttackParams` directly (capsules, SDI, set weight, trip…).
 * An extended (capsule) ATTACK or CATCH — one with `x2/y2/z2` — resolves both
 * ends, and the pipeline tests the capsule between them (Plan 3, Task 17).
 */

```

In `src/engine/acmd/hitboxes.ts`, replace:

```ts
  motion: MotionKind,
  frame: number,
  p: Pick<AttackParams, "id" | "bone" | "x" | "y" | "z" | "x2" | "y2" | "z2">,
): { x: number; y: number } {
  if (p.x2 !== undefined || p.y2 !== undefined || p.z2 !== undefined) {
    throw new Error(`capsule hitbox (x2/y2/z2) id ${p.id} of ${fighterId}/${motion}: not supported until Plan 3`);
  }
  if (!bones.pose(fighterId, motion, frame, p.bone, POSE)) {
    throw new Error(`no pose for bone "${p.bone}" of ${fighterId}/${motion} frame ${frame}`);
```

with:

```ts
  motion: MotionKind,
  frame: number,
  p: Pick<AttackParams, "bone" | "x" | "y" | "z">,
): { x: number; y: number } {
  if (!bones.pose(fighterId, motion, frame, p.bone, POSE)) {
    throw new Error(`no pose for bone "${p.bone}" of ${fighterId}/${motion} frame ${frame}`);
```

In `src/engine/acmd/hitboxes.ts`, replace:

```ts
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

with:

```ts
  for (const a of state.attacks) {
    const at = resolve(bones, fighterId, motion, state.motionFrame, a);
    const far = farEnd(bones, fighterId, motion, state.motionFrame, a);
    out.push(withFarEnd(attackHitbox(a, gameFrame, at, state.shieldSetoff.get(a.id)), far));
  }
  for (const c of state.catches) {
    const at = resolve(bones, fighterId, motion, state.motionFrame, c);
    out.push(withFarEnd(catchHitbox(c, gameFrame, at), farEnd(bones, fighterId, motion, state.motionFrame, c)));
  }
  return out;
}

/**
 * The far end of an extended hitbox — `X2, Y2, Z2` on the same bone, an axis
 * left out taking the near end's value — or null for a sphere (Plan 3, Task 17).
 */
function farEnd(
  bones: BoneTable,
  fighterId: string,
  motion: MotionKind,
  frame: number,
  p: Pick<AttackParams, "bone" | "x" | "y" | "z" | "x2" | "y2" | "z2">,
): { x: number; y: number } | null {
  if (p.x2 === undefined && p.y2 === undefined && p.z2 === undefined) return null;
  return resolve(bones, fighterId, motion, frame, { bone: p.bone, x: p.x2 ?? p.x, y: p.y2 ?? p.y, z: p.z2 ?? p.z });
}

function withFarEnd(hb: Hitbox, far: { x: number; y: number } | null): Hitbox {
  return far === null ? hb : { ...hb, x2: far.x, y2: far.y };
}
```

In `src/engine/hitbox.ts`, replace:

```ts
}

/* -------------------------------------------------------------- fighters -- */

```

with:

```ts
}

/**
 * The same depth for an extended (capsule) hitbox whose far end sits `dx, dy`
 * from its near end, swept from its previous position. A capsule moving
 * without turning sweeps a parallelogram (with rounded edges): the depth is the
 * deepest of its four edges — the near end's sweep, the far end's sweep, the
 * capsule where it was and where it is now — or the full reach when the
 * target's spine lies inside the parallelogram (Plan 3, Task 17). With no
 * length it is exactly `sweptHitboxPenetration`.
 */
export function sweptCapsulePenetration(
  prevX: number,
  prevY: number,
  x: number,
  y: number,
  dx: number,
  dy: number,
  radius: number,
  target: Capsule,
): number {
  const near = sweptHitboxPenetration(prevX, prevY, x, y, radius, target);
  if (dx === 0 && dy === 0) return near;
  const far = sweptHitboxPenetration(prevX + dx, prevY + dy, x + dx, y + dy, radius, target);
  const now = sweptHitboxPenetration(x, y, x + dx, y + dy, radius, target);
  const was = sweptHitboxPenetration(prevX, prevY, prevX + dx, prevY + dy, radius, target);
  const edges = Math.max(near, far, now, was);
  const inside =
    insideParallelogram(prevX, prevY, x, y, dx, dy, target.x1, target.y1) ||
    insideParallelogram(prevX, prevY, x, y, dx, dy, target.x2, target.y2);
  return inside ? Math.max(edges, radius + target.r) : edges;
}

/**
 * Is (px, py) inside the parallelogram with corners prev, now, now + d,
 * prev + d? Sign tests only; a degenerate (flat) one has no inside.
 */
function insideParallelogram(
  prevX: number,
  prevY: number,
  x: number,
  y: number,
  dx: number,
  dy: number,
  px: number,
  py: number,
): boolean {
  const corners = [
    [prevX, prevY],
    [x, y],
    [x + dx, y + dy],
    [prevX + dx, prevY + dy],
  ];
  if (orientation(prevX, prevY, x, y, prevX + dx, prevY + dy) === 0) return false;
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = corners[i];
    const [bx, by] = corners[(i + 1) % 4];
    const o = orientation(ax, ay, bx, by, px, py);
    if (o === 0) continue;
    if (sign === 0) sign = o;
    else if (o !== sign) return false;
  }
  return true;
}

/* -------------------------------------------------------------- fighters -- */

```

In `src/engine/simulate.ts`, replace:

```ts
  SMASH_BALL_TARGET,
  alreadyHit,
  circle,
  circlesOverlap,
  clearHitRecord,
  hitboxWorldPos,
```

with:

```ts
  SMASH_BALL_TARGET,
  alreadyHit,
  capsulesOverlap,
  circle,
  clearHitRecord,
  hitboxWorldPos,
```

In `src/engine/simulate.ts`, replace:

```ts
  markHit,
  resolveClank,
  sweptHitboxOverlaps,
  sweptHitboxPenetration,
} from "./hitbox";
import {
  advanceProjectile,
```

with:

```ts
  markHit,
  resolveClank,
  sweptCapsulePenetration,
} from "./hitbox";
import type { Capsule } from "./hitbox";
import {
  advanceProjectile,
```

In `src/engine/simulate.ts`, replace:

```ts
  readonly prevX: number;
  readonly prevY: number;
  /** The move this came from, or null when the source is a projectile. */
  readonly slot: MoveSlot | null;
```

with:

```ts
  readonly prevX: number;
  readonly prevY: number;
  /** Far end of an extended hitbox, relative to (x, y); 0, 0 for a sphere (Plan 3, Task 17). */
  readonly dx: number;
  readonly dy: number;
  /** The move this came from, or null when the source is a projectile. */
  readonly slot: MoveSlot | null;
```

In `src/engine/simulate.ts`, replace:

```ts
  readonly destroyOnHit: boolean;
  suppressed: boolean;
}

```

with:

```ts
  readonly destroyOnHit: boolean;
  suppressed: boolean;
}

/** Where a candidate's box is this frame: a capsule, or a circle when it has no length. */
function capsuleOf(c: Candidate): Capsule {
  return { x1: c.x, y1: c.y, x2: c.x + c.dx, y2: c.y + c.dy, r: c.hitbox.radius };
}

```

In `src/engine/simulate.ts`, replace:

```ts
      const now = hitboxWorldPos(f.x, f.y, f.facing, hb);
      const was = hitboxWorldPos(prevPos[i].x, prevPos[i].y, f.facing, hb);
      out.push({
        attacker: i,
```

with:

```ts
      const now = hitboxWorldPos(f.x, f.y, f.facing, hb);
      const was = hitboxWorldPos(prevPos[i].x, prevPos[i].y, f.facing, hb);
      const far =
        hb.x2 === undefined || hb.y2 === undefined
          ? now
          : hitboxWorldPos(f.x, f.y, f.facing, { x: hb.x2, y: hb.y2 });
      out.push({
        attacker: i,
```

In `src/engine/simulate.ts`, replace:

```ts
        prevX: was.x,
        prevY: was.y,
        slot: f.move,
        projectile: null,
```

with:

```ts
        prevX: was.x,
        prevY: was.y,
        dx: far.x - now.x,
        dy: far.y - now.y,
        slot: f.move,
        projectile: null,
```

In `src/engine/simulate.ts`, replace:

```ts
      prevX: was.x + offsetX,
      prevY: was.y + def.hitbox.y,
      slot: null,
      projectile: p,
```

with:

```ts
      prevX: was.x + offsetX,
      prevY: was.y + def.hitbox.y,
      dx: 0,
      dy: 0,
      slot: null,
      projectile: p,
```

In `src/engine/simulate.ts`, replace:

```ts
      if (ca.attacker === cb.attacker) continue;
      if (ca.suppressed && cb.suppressed) continue;
      if (!circlesOverlap(ca.x, ca.y, ca.hitbox.radius, cb.x, cb.y, cb.hitbox.radius)) continue;
      const outcome = resolveClank(ca.hitbox, cb.hitbox);
      if (outcome === "none") continue;
```

with:

```ts
      if (ca.attacker === cb.attacker) continue;
      if (ca.suppressed && cb.suppressed) continue;
      if (!capsulesOverlap(capsuleOf(ca), capsuleOf(cb))) continue;
      const outcome = resolveClank(ca.hitbox, cb.hitbox);
      if (outcome === "none") continue;
```

In `src/engine/simulate.ts`, replace:

```ts
      // A box that only grazes the body — less than 0.1 deep — is a glancing
      // blow: no hit, and the swing is not spent (Plan 3, Task 13).
      if (sweptHitboxPenetration(c.prevX, c.prevY, c.x, c.y, c.hitbox.radius, hurtbox) < GLANCING_BLOW_DEPTH) continue;
      const key = candidateKey(c);
      const incumbent = perSource.get(key);
```

with:

```ts
      // A box that only grazes the body — less than 0.1 deep — is a glancing
      // blow: no hit, and the swing is not spent (Plan 3, Task 13).
      const depth = sweptCapsulePenetration(c.prevX, c.prevY, c.x, c.y, c.dx, c.dy, c.hitbox.radius, hurtbox);
      if (depth < GLANCING_BLOW_DEPTH) continue;
      const key = candidateKey(c);
      const incumbent = perSource.get(key);
```

In `src/engine/simulate.ts`, replace:

```ts
  const bubble = shieldBubble(victim, victimDef);
  const onShield =
    shieldCovers(victim, c.x) && circlesOverlap(c.x, c.y, hb.radius, bubble.x1, bubble.y1, bubble.r);
  if (c.slot !== null && !attacker.combat.swingQueued) {
    attacker.combat.swingQueued = true;
```

with:

```ts
  const bubble = shieldBubble(victim, victimDef);
  const onShield =
    shieldCovers(victim, c.x) && capsulesOverlap(capsuleOf(c), bubble);
  if (c.slot !== null && !attacker.combat.swingQueued) {
    attacker.combat.swingQueued = true;
```

In `src/engine/simulate.ts`, replace:

```ts
    const attacker = s.fighters[c.attacker];
    if (alreadyHit(attacker, SMASH_BALL_TARGET)) continue;
    if (!sweptHitboxOverlaps(c.prevX, c.prevY, c.x, c.y, c.hitbox.radius, target)) continue;
    markHit(attacker, SMASH_BALL_TARGET);
    ball.health -= c.hitbox.damage;
```

with:

```ts
    const attacker = s.fighters[c.attacker];
    if (alreadyHit(attacker, SMASH_BALL_TARGET)) continue;
    if (sweptCapsulePenetration(c.prevX, c.prevY, c.x, c.y, c.dx, c.dy, c.hitbox.radius, target) < 0) continue;
    markHit(attacker, SMASH_BALL_TARGET);
    ball.health -= c.hitbox.damage;
```

In `src/engine/types.ts`, replace:

```ts
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  /** Percent, fixed. */
```

with:

```ts
  readonly x: number;
  readonly y: number;
  /**
   * The far end of an extended hitbox, same frame as `x`/`y`; the box is the
   * capsule between the two (Plan 3, Task 17). Absent for a sphere.
   */
  readonly x2?: number;
  readonly y2?: number;
  readonly radius: number;
  /** Percent, fixed. */
```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/engine/acmd/bones.test.ts src/engine/combat.test.ts src/engine/hitbox.test.ts`
Expected: PASS.

- [ ] **Step 5: The golden trace**

Run: `pnpm vitest run src/game/golden.test.ts`
Expected: PASS, unchanged — no legacy move has a capsule.

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0 (`pnpm lint` reports only the two pre-existing warnings in `research/rebuild-2026-10/tools/sim_bench.mjs`).

- [ ] **Step 7: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/src/engine/acmd/bones.test.ts \
  super-smash/src/engine/acmd/hitboxes.ts \
  super-smash/src/engine/combat.test.ts \
  super-smash/src/engine/hitbox.test.ts \
  super-smash/src/engine/hitbox.ts \
  super-smash/src/engine/simulate.ts \
  super-smash/src/engine/types.ts
git commit -m "super-smash: extended (capsule) hitboxes" -m "smash-script ATTACK/CATCH X2,Y2,Z2: the box is the capsule between the ends, swept as a parallelogram; hit, clank, shield and Smash Ball tests use it. Spheres are unchanged." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: Activate the imported scripts of every root-bone move

Plan 2 imported every fighter's published `game_` scripts and kept the sim on compiled legacy moves. A script can run before Plan 4's bone bake only if the replica can place and honour all of it, and `src/fighters/acmd/active.ts` writes that rule down: every ATTACK/CATCH on the root bone `top`; not a throw or a pummel (their statuses drive them: `ATTACK_ABS`, `set_catch_only_all`); a legacy move with no scripted momentum, projectile, super armour or smash charge (those still come from the legacy table); only commands the interpreter runs or a short list of cosmetic engine calls; and boxes the script clears itself (Fox's Reflector leaves its box for the status to clear). `ACTIVE_SCRIPT_SLOTS` is the rule's output written out — 38 moves — and `active.test.ts` proves it is exactly that. `withReferenceScripts` sets `scripts[slot]` to the reference script and the move's `totalFrames` to the script's published first actionable frame − 1.

`reconcile.test.ts` now compares what each slot *runs* (`gameScriptFor`) with the reference, so the activated slots' 13 allowlist entries disappear when it is regenerated — among them Mario's down air (set weight, not set knockback), Pikachu's neutral and forward air, Link's jabs, down tilt and forward air, Marth's Dancing Blade and three grab FAFs. **Plan 4 boundary:** every script with a box on a limb bone stays on its compiled legacy script; Plan 4's bone bake activates them through the same `withReferenceScripts` and `ACTIVE_SCRIPT_SLOTS`, widening `activatable`'s bone check. The remaining Plan 2 findings (Mario's up special branch, Fox's rapid jab and up tilt, Pikachu's down throw) are excluded by the rule — momentum, limb bones or a throw — and stay listed in `reconcile.allow.json` and `reference.test.ts`.

**Files:**
- Create: `super-smash/src/fighters/acmd/active.test.ts`
- Create: `super-smash/src/fighters/acmd/active.ts`
- Modify: `super-smash/src/fighters/acmd/reconcile.allow.json` (regenerated by a command in this task)
- Modify: `super-smash/src/fighters/acmd/reconcile.test.ts`
- Modify: `super-smash/src/fighters/donkeyKong.ts`
- Modify: `super-smash/src/fighters/fox.ts`
- Modify: `super-smash/src/fighters/kirby.ts`
- Modify: `super-smash/src/fighters/link.ts`
- Modify: `super-smash/src/fighters/mario.ts`
- Modify: `super-smash/src/fighters/marth.ts`
- Modify: `super-smash/src/fighters/pikachu.ts`
- Modify: `super-smash/src/fighters/samus.ts`
- Modify: `super-smash/src/game/__golden__/engine-trace.json` (regenerated by a command in this task)

**Interfaces:** Adds `src/fighters/acmd/active.ts`:
```ts
export function activatable(slot: MoveSlot, move: MoveDef | undefined, script: AcmdScript): boolean;
export function withReferenceScripts(def: FighterDef, ref: ReferenceFighter, slots: readonly MoveSlot[]): FighterDef;
export const ACTIVE_SCRIPT_SLOTS: Readonly<Record<string, readonly MoveSlot[]>>;
```
Each fighter module exports its def through `withReferenceScripts(legacy, <REF>, ACTIVE_SCRIPT_SLOTS.<id>)`. A real-data test lands Mario's down air as a multi-hit and checks it joins the stale queue once, every hit equally stale (Task 16).

- [ ] **Step 1: Write the failing tests**

Create `src/fighters/acmd/active.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { fx } from "@/engine/fixed";
import { createInitialState, step } from "@/engine/simulate";
import type { SimContext } from "@/engine/simulate";
import { Btn } from "@/engine/types";
import type { AcmdCommand, AcmdScript } from "@/engine/acmd/types";
import type { GameState, InputFrame, MoveSlot } from "@/engine/types";
import { FIGHTERS } from "../index";
import { STAGES } from "@/stages";
import { ACTIVE_SCRIPT_SLOTS, activatable } from "./active";
import { REFERENCE_SCRIPTS } from "./index";

/** Every bone a script hangs a box off. */
function bones(commands: readonly AcmdCommand[], out = new Set<string>()): Set<string> {
  for (const c of commands) {
    if (c.op === "attack" || c.op === "catch") out.add(c.params.bone);
    if (c.op === "loop") bones(c.body, out);
  }
  return out;
}

describe("which imported scripts run (Plan 3, Task 18)", () => {
  it("lists exactly the slots the root-bone rule admits", () => {
    for (const def of FIGHTERS) {
      const ref = REFERENCE_SCRIPTS[def.id];
      const admitted = (Object.keys(ref.slots) as MoveSlot[]).filter((slot) => {
        const key = ref.slots[slot] as string;
        return activatable(slot, def.moves[slot], ref.scripts[key]);
      });
      expect([...ACTIVE_SCRIPT_SLOTS[def.id]].sort(), def.id).toEqual(admitted.sort());
    }
  });

  it("runs the imported script itself for every listed slot, and nothing else", () => {
    for (const def of FIGHTERS) {
      const ref = REFERENCE_SCRIPTS[def.id];
      const active = ACTIVE_SCRIPT_SLOTS[def.id];
      expect(Object.keys(def.scripts ?? {}).sort(), def.id).toEqual([...active].sort());
      for (const slot of active) {
        const key = ref.slots[slot] as string;
        expect(def.scripts?.[slot], `${def.id} ${slot}`).toBe(ref.scripts[key]);
        const faf = ref.faf[key];
        if (faf !== undefined) expect(def.moves[slot]?.totalFrames, `${def.id} ${slot}`).toBe(faf - 1);
      }
    }
  });

  // The boundary with Plan 4: a script that hangs a box off a limb bone needs
  // the bone bake to place it, so it stays on its compiled legacy script.
  it("activates no script with a box on any bone but the root", () => {
    for (const def of FIGHTERS) {
      for (const script of Object.values(def.scripts ?? {}) as AcmdScript[]) {
        expect([...bones(script.commands)], `${def.id} ${script.name}`).toEqual(["top"]);
      }
    }
  });

  it("keeps throws and pummels on their legacy scripts: their statuses drive them", () => {
    for (const def of FIGHTERS) {
      for (const slot of ["pummel", "fthrow", "bthrow", "uthrow", "dthrow"] as const) {
        expect(ACTIVE_SCRIPT_SLOTS[def.id]).not.toContain(slot);
      }
    }
  });
});

describe("an activated script in a real match", () => {
  const RULES = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: false } as const;
  const ctx: SimContext = {
    fighter: (id) => FIGHTERS.find((f) => f.id === id)!,
    stage: (id) => STAGES.find((s) => s.id === id)!,
  };

  /** Mario above Pikachu, both in the air, Mario down-airs. */
  function dair(): { hits: number; damages: number[]; mario: GameState["fighters"][number] } {
    let s: GameState = createInitialState("finalDestination", [{ defId: "mario" }, { defId: "pikachu" }], RULES, 7, ctx);
    const [m, p] = s.fighters;
    for (const f of s.fighters) Object.assign(f, { action: "fall", actionFrame: 0, grounded: false, platform: -1, intangible: 0 });
    Object.assign(m, { x: 0, y: fx(40), facing: 1 });
    Object.assign(p, { x: 0, y: fx(33), facing: -1 });
    let prev: readonly InputFrame[] = [0, 0];
    let hits = 0;
    const damages: number[] = [];
    for (let i = 0; i < 40; i++) {
      // Both hang in place: the drill is about the hits, not the fall.
      s.fighters[0].y = fx(40);
      s.fighters[1].y = fx(33);
      const now = [i === 0 ? Btn.Down | Btn.Attack : 0, 0];
      const out = step(s, now, { prevInputs: prev, ctx });
      prev = now;
      s = out.state;
      hits += out.events.hits.length;
      for (const h of out.events.hits) damages.push(h.damage);
    }
    return { hits, damages, mario: s.fighters[0] };
  }

  // Mario's down air, game_attackairlw: five 1.4% set-weight hits two frames
  // apart (the legacy table had them as set knockback and landed only one).
  it("lands Mario's down air as a multi-hit", () => {
    expect(dair().hits).toBeGreaterThan(1);
  });

  // …and stales it once (Task 16): one queue entry, every hit as stale as the first.
  it("queues Mario's down air once, and does not stale its later hits", () => {
    const { damages, mario } = dair();
    expect(mario.staleQueue).toEqual(["dair"]);
    expect(new Set(damages).size).toBe(1);
  });
});
```

In `src/fighters/acmd/reconcile.test.ts`, replace:

```ts

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
```

with:

```ts

import { runScript } from "@/engine/acmd/interpreter";
import { gameScriptFor } from "@/engine/acmd/legacy";
import type { AcmdScript } from "@/engine/acmd/types";
import { toFloat } from "@/engine/fixed";
import type { FighterDef, MoveDef, MoveSlot } from "@/engine/types";
import { FIGHTERS } from "../index";
import { REFERENCE_SCRIPTS } from "./index";

/**
 * DECISIONS D17, kept honest: the moves the roster actually runs against the
 * scripts they were transcribed from.
 *
 * For every move with both, four facts are compared — first active frame,
 * last active frame, the lowest-id hitbox's damage/angle/knockback on that
 * first frame, and first actionable frame (`CancelFrame`, which is the
 * move's `totalFrames + 1`). "Runs" is `gameScriptFor`: the imported script
 * for a slot Plan 3 activated (`acmd/active.ts`), else the compiled legacy
 * move — which `legacy.test.ts` proves frame-identical to its table. Every disagreement is listed in `reconcile.allow.json`
 * with its value on each side. The list is a ratchet: it may shrink (Plan 3
 * adopts the scripts and deletes entries) but a new entry fails this test until
```

In `src/fighters/acmd/reconcile.test.ts`, replace:

```ts
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
```

with:

```ts
const fmt = (n: number): string => String(Math.round(toFloat(n) * 1000) / 1000);

/** The facts of a script, run until `horizon`. */
function scriptFacts(s: AcmdScript, horizon: number): Omit<Facts, "faf"> | null {
  let first = -1;
  let last = -1;
  for (let g = 1; g <= horizon; g++) {
    const st = runScript(s, g);
    if (st.attacks.length + st.catches.length === 0) continue;
```

In `src/fighters/acmd/reconcile.test.ts`, replace:

```ts
    last,
    lead: a === undefined ? "grab" : `${fmt(a.damage)}%/${fmt(a.angle)}°/${kb}/kbg${fmt(a.kbg)}`,
    faf: ref.faf[key] ?? -1,
  };
}

```

with:

```ts
    last,
    lead: a === undefined ? "grab" : `${fmt(a.damage)}%/${fmt(a.angle)}°/${kb}/kbg${fmt(a.kbg)}`,
  };
}

/** What the roster runs for `slot`: its script, until the move ends. */
function runningFacts(def: FighterDef, slot: MoveSlot, move: MoveDef): Facts | null {
  const script = gameScriptFor(def, slot);
  const facts = script === null ? null : scriptFacts(script, move.totalFrames + 1);
  return facts === null ? null : { ...facts, faf: move.totalFrames + 1 };
}

function referenceFacts(fighter: string, key: string): Facts | null {
  const ref = REFERENCE_SCRIPTS[fighter];
  const facts = scriptFacts(ref.scripts[key], HORIZON);
  return facts === null ? null : { ...facts, faf: ref.faf[key] ?? -1 };
}

```

In `src/fighters/acmd/reconcile.test.ts`, replace:

```ts
      const move = def.moves[slot];
      if (key === undefined || move === undefined) continue;
      const mine = legacyFacts(move);
      const theirs = referenceFacts(def.id, key);
      if (mine === null || theirs === null) {
```

with:

```ts
      const move = def.moves[slot];
      if (key === undefined || move === undefined) continue;
      const mine = runningFacts(def, slot, move);
      const theirs = referenceFacts(def.id, key);
      if (mine === null || theirs === null) {
```

- [ ] **Step 2: Run them**

Run: `pnpm vitest run src/fighters/acmd/active.test.ts src/fighters/acmd/reconcile.test.ts`
Expected: FAIL — `active.test.ts` cannot resolve `./active` (`Failed to resolve import "./active"`); `reconcile.test.ts` still passes (it reads the legacy table, which nothing has changed yet).

- [ ] **Step 3: Implement**

Create `src/fighters/acmd/active.ts`:

```ts
/**
 * Which imported `game_` scripts the sim runs (Plan 3, Task 18).
 *
 * Plan 2 imported every fighter's published scripts as reference and kept the
 * sim on the compiled legacy moves. A script can run *now*, before Plan 4's
 * bone bake, only if the replica can place and honour everything in it:
 *
 * - every ATTACK and CATCH hangs off the root bone, `top` — the only bone
 *   `LEGACY_BONE_TABLE` places (limb-bone scripts wait for Plan 4's bake);
 * - the move is not one a status drives rather than its script: a throw
 *   (`ATTACK_ABS`) or a pummel (`set_catch_only_all`);
 * - its legacy move carries nothing the script would drop: no scripted
 *   momentum, projectile, super armour or smash charge (those stay on the
 *   compiled legacy script until the energies and the charge read the script);
 * - every command is one the interpreter runs, or a cosmetic one listed below;
 * - the script clears its own boxes — one that leaves them for its status to
 *   clear (Fox's Reflector) would keep them live for the whole move here.
 *
 * `ACTIVE_SCRIPT_SLOTS` is the rule's output written out, so a reviewer sees
 * the list and `active.test.ts` proves it is exactly the rule's output.
 */

import { runScript } from "@/engine/acmd/interpreter";
import type { AcmdCommand, AcmdScript } from "@/engine/acmd/types";
import type { FighterDef, MoveDef, MoveSlot } from "@/engine/types";
import type { ReferenceFighter } from "./reference";

/** Commands the interpreter runs and the sim honours (or that change nothing). */
const RUN_OPS: ReadonlySet<AcmdCommand["op"]> = new Set([
  "frame",
  "wait",
  "attack",
  "catch",
  "clearAll",
  "clear",
  "catchClearAll",
  "catchClear",
  "setFlag",
  "shieldSetoffMul",
  "motionRate",
  "loop",
]);

/** Engine calls with no effect on the replica's sim: collision pushboxes, hit-height tags, VFX, grab-cut bookkeeping. */
const COSMETIC_PREFIXES: readonly string[] = [
  "FighterAreaModuleImpl::enable_fix_jostle_area",
  "JostleModule::set_status",
  "AttackModule::set_attack_height_all",
  "AttackModule::set_no_damage_fly_smoke_all",
  "GrabModule::set_rebound",
  "methodlua2cpp::L2CFighterAnimcmdGameCommon::game_CaptureCutCommon",
  "FT_START_ADJUST_MOTION_FRAME",
];

/** Longer than any move: a box still live here is never cleared by its script. */
const CLEARED_BY = 300;

const STATUS_DRIVEN: ReadonlySet<MoveSlot> = new Set(["pummel", "fthrow", "bthrow", "uthrow", "dthrow"]);

function runnable(commands: readonly AcmdCommand[], bones: Set<string>): boolean {
  for (const c of commands) {
    if (c.op === "attack" || c.op === "catch") bones.add(c.params.bone);
    if (c.op === "loop") {
      if (!runnable(c.body, bones)) return false;
      continue;
    }
    if (c.op === "unknown") {
      if (!COSMETIC_PREFIXES.some((p) => c.raw.startsWith(p))) return false;
      continue;
    }
    if (!RUN_OPS.has(c.op)) return false;
  }
  return true;
}

/** The rule above, for one slot. */
export function activatable(slot: MoveSlot, move: MoveDef | undefined, script: AcmdScript): boolean {
  if (move === undefined || STATUS_DRIVEN.has(slot)) return false;
  if (move.momentum !== undefined || move.projectiles !== undefined) return false;
  if (move.superArmourFrames !== undefined || move.chargeable === true) return false;
  const bones = new Set<string>();
  if (!runnable(script.commands, bones)) return false;
  if (bones.size === 0 || ![...bones].every((b) => b === "top")) return false;
  const end = runScript(script, CLEARED_BY);
  return end.attacks.length + end.catches.length === 0;
}

/**
 * `def` with `slots` running their imported scripts: `scripts[slot]` is the
 * reference script, and the move's `totalFrames` becomes the script's
 * published first actionable frame − 1 (`CancelFrame`), so the move ends when
 * the game's does. Everything else about the legacy move stays.
 */
export function withReferenceScripts(def: FighterDef, ref: ReferenceFighter, slots: readonly MoveSlot[]): FighterDef {
  const scripts: Partial<Record<MoveSlot, AcmdScript>> = { ...def.scripts };
  const moves: Partial<Record<MoveSlot, MoveDef>> = { ...def.moves };
  for (const slot of slots) {
    const key = ref.slots[slot];
    const move = def.moves[slot];
    if (key === undefined || move === undefined) throw new Error(`${def.id} ${slot}: no reference script or legacy move`);
    scripts[slot] = ref.scripts[key];
    const faf = ref.faf[key];
    if (faf !== undefined) moves[slot] = { ...move, totalFrames: faf - 1 };
  }
  return { ...def, scripts, moves };
}

/**
 * The slots each fighter runs from its imported script — every slot the rule
 * admits, no more (pinned by `active.test.ts`). 38 of the roster's moves.
 */
export const ACTIVE_SCRIPT_SLOTS: Readonly<Record<string, readonly MoveSlot[]>> = {
  mario: ["jab1", "dashAttack", "dair", "grab", "dashGrab"],
  donkeyKong: ["dashAttack", "dair", "grab", "dashGrab"],
  link: ["jab1", "jab2", "dtilt", "fair", "dair", "grab", "dashGrab"],
  samus: ["dashAttack"],
  kirby: ["jab1", "jab2", "dashAttack", "fair", "bair", "dair", "grab", "dashGrab"],
  fox: ["jab1", "jab2", "grab", "dashGrab"],
  pikachu: ["jab1", "dtilt", "nair", "fair", "grab", "dashGrab"],
  marth: ["sideB", "grab", "dashGrab"],
};
```

In `src/fighters/donkeyKong.ts`, replace:

```ts
import { fx } from "@/engine/fixed";
import type { FighterDef } from "@/engine/types";
import { FIGHTER_PARAMS } from "./params";

```

with:

```ts
import { fx } from "@/engine/fixed";
import type { FighterDef } from "@/engine/types";
import { ACTIVE_SCRIPT_SLOTS, withReferenceScripts } from "./acmd/active";
import { DONKEY_KONG } from "./acmd/generated/donkeyKong";
import { FIGHTER_PARAMS } from "./params";

```

In `src/fighters/donkeyKong.ts`, replace:

```ts
const HALF_WIDTH = 3.2;

export const donkeyKong: FighterDef = {
  id: "donkeyKong",
  name: "Donkey Kong",
```

with:

```ts
const HALF_WIDTH = 3.2;

/** The hand-authored moveset; `donkeyKong` below runs its root-bone moves from the imported scripts. */
const legacy: FighterDef = {
  id: "donkeyKong",
  name: "Donkey Kong",
```

Append to the end of `src/fighters/donkeyKong.ts`:

```ts
/** Root-bone moves run their imported `game_` scripts (Plan 3, Task 18; `acmd/active.ts`). */
export const donkeyKong: FighterDef = withReferenceScripts(legacy, DONKEY_KONG, ACTIVE_SCRIPT_SLOTS.donkeyKong);
```

In `src/fighters/fox.ts`, replace:

```ts
import { fx } from "@/engine/fixed";
import type { FighterDef } from "@/engine/types";
import { FIGHTER_PARAMS } from "./params";

```

with:

```ts
import { fx } from "@/engine/fixed";
import type { FighterDef } from "@/engine/types";
import { ACTIVE_SCRIPT_SLOTS, withReferenceScripts } from "./acmd/active";
import { FOX } from "./acmd/generated/fox";
import { FIGHTER_PARAMS } from "./params";

```

In `src/fighters/fox.ts`, replace:

```ts
const HALF_WIDTH = 2.0;

export const fox: FighterDef = {
  id: "fox",
  name: "Fox",
```

with:

```ts
const HALF_WIDTH = 2.0;

/** The hand-authored moveset; `fox` below runs its root-bone moves from the imported scripts. */
const legacy: FighterDef = {
  id: "fox",
  name: "Fox",
```

Append to the end of `src/fighters/fox.ts`:

```ts
/** Root-bone moves run their imported `game_` scripts (Plan 3, Task 18; `acmd/active.ts`). */
export const fox: FighterDef = withReferenceScripts(legacy, FOX, ACTIVE_SCRIPT_SLOTS.fox);
```

In `src/fighters/kirby.ts`, replace:

```ts
import { fx } from "@/engine/fixed";
import type { FighterDef } from "@/engine/types";
import { FIGHTER_PARAMS } from "./params";

```

with:

```ts
import { fx } from "@/engine/fixed";
import type { FighterDef } from "@/engine/types";
import { ACTIVE_SCRIPT_SLOTS, withReferenceScripts } from "./acmd/active";
import { KIRBY } from "./acmd/generated/kirby";
import { FIGHTER_PARAMS } from "./params";

```

In `src/fighters/kirby.ts`, replace:

```ts
const HALF_WIDTH = 1.9;

export const kirby: FighterDef = {
  id: "kirby",
  name: "Kirby",
```

with:

```ts
const HALF_WIDTH = 1.9;

/** The hand-authored moveset; `kirby` below runs its root-bone moves from the imported scripts. */
const legacy: FighterDef = {
  id: "kirby",
  name: "Kirby",
```

Append to the end of `src/fighters/kirby.ts`:

```ts
/** Root-bone moves run their imported `game_` scripts (Plan 3, Task 18; `acmd/active.ts`). */
export const kirby: FighterDef = withReferenceScripts(legacy, KIRBY, ACTIVE_SCRIPT_SLOTS.kirby);
```

In `src/fighters/link.ts`, replace:

```ts
import { fx } from "@/engine/fixed";
import type { FighterDef } from "@/engine/types";
import { FIGHTER_PARAMS } from "./params";

```

with:

```ts
import { fx } from "@/engine/fixed";
import type { FighterDef } from "@/engine/types";
import { ACTIVE_SCRIPT_SLOTS, withReferenceScripts } from "./acmd/active";
import { LINK } from "./acmd/generated/link";
import { FIGHTER_PARAMS } from "./params";

```

In `src/fighters/link.ts`, replace:

```ts
const HALF_WIDTH = 2.1;

export const link: FighterDef = {
  id: "link",
  name: "Link",
```

with:

```ts
const HALF_WIDTH = 2.1;

/** The hand-authored moveset; `link` below runs its root-bone moves from the imported scripts. */
const legacy: FighterDef = {
  id: "link",
  name: "Link",
```

Append to the end of `src/fighters/link.ts`:

```ts
/** Root-bone moves run their imported `game_` scripts (Plan 3, Task 18; `acmd/active.ts`). */
export const link: FighterDef = withReferenceScripts(legacy, LINK, ACTIVE_SCRIPT_SLOTS.link);
```

In `src/fighters/mario.ts`, replace:

```ts
import { fx } from "@/engine/fixed";
import type { FighterDef } from "@/engine/types";
import { FIGHTER_PARAMS } from "./params";

```

with:

```ts
import { fx } from "@/engine/fixed";
import type { FighterDef } from "@/engine/types";
import { ACTIVE_SCRIPT_SLOTS, withReferenceScripts } from "./acmd/active";
import { MARIO } from "./acmd/generated/mario";
import { FIGHTER_PARAMS } from "./params";

```

In `src/fighters/mario.ts`, replace:

```ts
const HALF_WIDTH = 2.0;

export const mario: FighterDef = {
  id: "mario",
  name: "Mario",
```

with:

```ts
const HALF_WIDTH = 2.0;

/** The hand-authored moveset; `mario` below runs its root-bone moves from the imported scripts. */
const legacy: FighterDef = {
  id: "mario",
  name: "Mario",
```

Append to the end of `src/fighters/mario.ts`:

```ts
/** Root-bone moves run their imported `game_` scripts (Plan 3, Task 18; `acmd/active.ts`). */
export const mario: FighterDef = withReferenceScripts(legacy, MARIO, ACTIVE_SCRIPT_SLOTS.mario);
```

In `src/fighters/marth.ts`, replace:

```ts
import { fx } from "@/engine/fixed";
import type { FighterDef } from "@/engine/types";
import { FIGHTER_PARAMS } from "./params";

```

with:

```ts
import { fx } from "@/engine/fixed";
import type { FighterDef } from "@/engine/types";
import { ACTIVE_SCRIPT_SLOTS, withReferenceScripts } from "./acmd/active";
import { MARTH } from "./acmd/generated/marth";
import { FIGHTER_PARAMS } from "./params";

```

In `src/fighters/marth.ts`, replace:

```ts
const BODY_REACH = 6.0;

export const marth: FighterDef = {
  id: "marth",
  name: "Marth",
```

with:

```ts
const BODY_REACH = 6.0;

/** The hand-authored moveset; `marth` below runs its root-bone moves from the imported scripts. */
const legacy: FighterDef = {
  id: "marth",
  name: "Marth",
```

Append to the end of `src/fighters/marth.ts`:

```ts
/** Root-bone moves run their imported `game_` scripts (Plan 3, Task 18; `acmd/active.ts`). */
export const marth: FighterDef = withReferenceScripts(legacy, MARTH, ACTIVE_SCRIPT_SLOTS.marth);
```

In `src/fighters/pikachu.ts`, replace:

```ts
import { fx } from "@/engine/fixed";
import type { FighterDef } from "@/engine/types";
import { FIGHTER_PARAMS } from "./params";

```

with:

```ts
import { fx } from "@/engine/fixed";
import type { FighterDef } from "@/engine/types";
import { ACTIVE_SCRIPT_SLOTS, withReferenceScripts } from "./acmd/active";
import { PIKACHU } from "./acmd/generated/pikachu";
import { FIGHTER_PARAMS } from "./params";

```

In `src/fighters/pikachu.ts`, replace:

```ts
const HALF_WIDTH = 1.8;

export const pikachu: FighterDef = {
  id: "pikachu",
  name: "Pikachu",
```

with:

```ts
const HALF_WIDTH = 1.8;

/** The hand-authored moveset; `pikachu` below runs its root-bone moves from the imported scripts. */
const legacy: FighterDef = {
  id: "pikachu",
  name: "Pikachu",
```

Append to the end of `src/fighters/pikachu.ts`:

```ts
/** Root-bone moves run their imported `game_` scripts (Plan 3, Task 18; `acmd/active.ts`). */
export const pikachu: FighterDef = withReferenceScripts(legacy, PIKACHU, ACTIVE_SCRIPT_SLOTS.pikachu);
```

In `src/fighters/samus.ts`, replace:

```ts
import { fx } from "@/engine/fixed";
import type { FighterDef } from "@/engine/types";
import { FIGHTER_PARAMS } from "./params";

```

with:

```ts
import { fx } from "@/engine/fixed";
import type { FighterDef } from "@/engine/types";
import { ACTIVE_SCRIPT_SLOTS, withReferenceScripts } from "./acmd/active";
import { SAMUS } from "./acmd/generated/samus";
import { FIGHTER_PARAMS } from "./params";

```

In `src/fighters/samus.ts`, replace:

```ts
const HALF_WIDTH = 2.3;

export const samus: FighterDef = {
  id: "samus",
  name: "Samus",
```

with:

```ts
const HALF_WIDTH = 2.3;

/** The hand-authored moveset; `samus` below runs its root-bone moves from the imported scripts. */
const legacy: FighterDef = {
  id: "samus",
  name: "Samus",
```

Append to the end of `src/fighters/samus.ts`:

```ts
/** Root-bone moves run their imported `game_` scripts (Plan 3, Task 18; `acmd/active.ts`). */
export const samus: FighterDef = withReferenceScripts(legacy, SAMUS, ACTIVE_SCRIPT_SLOTS.samus);
```

Regenerate the reconciliation allowlist (the ratchet may only shrink):

```bash
UPDATE_RECONCILE=1 pnpm vitest run src/fighters/acmd/reconcile.test.ts
```

Expected: `reconcile.allow.json` loses exactly these 13 keys and gains or changes none (check with `git diff super-smash/src/fighters/acmd/reconcile.allow.json`):

```
mario dair lead
link jab1 faf
link jab2 faf
link dtilt faf
link fair lead
link fair faf
kirby jab1 faf
kirby grab faf
fox grab faf
fox dashGrab faf
pikachu nair lead
pikachu fair lead
marth sideB lead
```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/fighters/acmd/active.test.ts src/fighters/acmd/reconcile.test.ts`
Expected: PASS.

- [ ] **Step 5: The golden trace**

Run: `pnpm vitest run src/game/golden.test.ts`
Expected before regenerating: FAIL in all four matches — 38 moves now run their published hitboxes, and multi-hits hit more than once. Regenerate.

```bash
UPDATE_GOLDEN=1 pnpm vitest run src/game/golden.test.ts
pnpm vitest run src/game/golden.test.ts
```

Expected: the second run PASSes. This task changes behaviour on purpose; its commit says so.

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0 (`pnpm lint` reports only the two pre-existing warnings in `research/rebuild-2026-10/tools/sim_bench.mjs`).

- [ ] **Step 7: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/src/fighters/acmd/active.test.ts \
  super-smash/src/fighters/acmd/active.ts \
  super-smash/src/fighters/acmd/reconcile.allow.json \
  super-smash/src/fighters/acmd/reconcile.test.ts \
  super-smash/src/fighters/donkeyKong.ts \
  super-smash/src/fighters/fox.ts \
  super-smash/src/fighters/kirby.ts \
  super-smash/src/fighters/link.ts \
  super-smash/src/fighters/mario.ts \
  super-smash/src/fighters/marth.ts \
  super-smash/src/fighters/pikachu.ts \
  super-smash/src/fighters/samus.ts \
  super-smash/src/game/__golden__/engine-trace.json
git commit -m "super-smash: root-bone moves run their imported game_ scripts" -m "38 slots (acmd/active.ts) satisfy the root-bone rule; their reconcile.allow.json entries are gone. Limb-bone scripts wait for Plan 4's bake. Golden trace regenerated." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 19: Autolink angles: 365° and 367°

Angles 365–368 were read as ordinary degrees (367° launched at 7°), and several of the moves Task 18 activates carry them — Pikachu's neutral air, Kirby's forward and down air, Link's forward air (367°). SmashWiki "Autolink angle" publishes two rules. 365°: launch speed "50% of the attacker's momentum", whatever the knockback. 367°: "the opponent's launch speed [set] to the attacker's momentum, plus 20% of the difference" between the hitbox and the opponent's position, calculated "after hitlag is over"; against grounded opponents "always … an angle of 80°"; speed capped at 3 (five frames after launch — here at once, an UNVERIFIED simplification) and vertical speed at −1. No formula is published for 366° or 368°; they run as 367° (UNVERIFIED). The vector is fixed on contact (both fighters are frozen until it is used, so the momentum and positions are the same) and parked in `CombatState`; `releasePendingLaunch` launches it with no DI, LSI or speed-up. "Position" is the fighter's origin. The hit's hitstun is the knockback's, as for any hit.

**Files:**
- Modify: `super-smash/src/engine/combat.test.ts`
- Modify: `super-smash/src/engine/combat.ts`
- Modify: `super-smash/src/engine/constants.ts`
- Modify: `super-smash/src/engine/hash.ts`
- Modify: `super-smash/src/engine/simulate.ts`

**Interfaces:** Adds `AUTOLINK_MIN = fx(365)`, `AUTOLINK_MAX = fx(368)`, `AUTOLINK_HALF_MOMENTUM = fx(365)`, `AUTOLINK_PULL_RATIO: Ratio = [1, 5]`, `AUTOLINK_GROUNDED_ANGLE = fx(80)`, `AUTOLINK_SPEED_CAP = fx(3)`, `AUTOLINK_MIN_VY = fx(-1)` (`constants.ts`); `CombatState.autolink: boolean`, `autolinkX`, `autolinkY` (Q12); a local `parkAutolink` in `simulate.ts`.

- [ ] **Step 1: Write the failing tests**

Append to the end of `src/engine/combat.test.ts`:

```ts
/* --------------------------------------------- Task 19: autolink angles -- */

describe("autolink angles (Plan 3, Task 19)", () => {
  /** Fighter 0 jabs with `angle`; returns the hit frame and the frame its freeze releases fighter 1. */
  function autolinked(angle: number, prepare: (s: GameState) => void): { hit: Frame; released: Frame } {
    const def: FighterDef = {
      ...BASE_DEF,
      moves: {
        ...BASE_DEF.moves,
        jab1: move("jab1", { hitboxes: [hitbox({ angle: fx(angle), damage: fx(2) })] }),
        nair: move("nair", { hitboxes: [hitbox({ angle: fx(angle), damage: fx(2) })] }),
      },
    };
    const ctx = ctxFor(def);
    const s = standing(ctx);
    prepare(s);
    const frames = play(s, 30, JAB, ctx);
    const h = frames.findIndex((f) => f.events.hits.length > 0);
    const r = frames.findIndex((f, i) => i > h && f.state.fighters[1].hitlag === 0);
    return { hit: frames[h], released: frames[r] };
  }
  const airborne = (s: GameState): void => {
    Object.assign(s.fighters[1], { x: fx(12), y: fx(2), grounded: false, platform: -1, action: "fall" });
  };

  // SmashWiki "Autolink angle": 367° sets "the opponent's launch speed to the
  // attacker's momentum, plus 20% of the difference" between the hitbox and the
  // opponent's position — pulling them into the hit.
  it("pulls an airborne victim 20% of the way toward the hitbox (367)", () => {
    const { hit, released } = autolinked(367, airborne);
    const [a, at] = hit.state.fighters;
    const v = released.state.fighters[1];
    const hb = hit.events.hits[0];
    expect(v.kinetic.damageX).toBe(a.vx + Math.trunc((hb.x - at.x) / 5));
    expect(v.kinetic.damageY).toBe(a.vy + Math.trunc((hb.y - at.y) / 5));
    expect(v.kinetic.damageX).toBeLessThan(0);
  });

  // "Against grounded opponents, it always uses an angle of 80°."
  it("launches a grounded victim at 80 degrees instead (367)", () => {
    const { hit } = autolinked(367, () => {});
    expect(hit.events.hits[0].angle).toBe(fx(80));
  });

  // 365°: launch speed is "50% of the attacker's momentum", whatever the knockback.
  it("carries the victim at half the attacker's momentum (365)", () => {
    const { hit, released } = autolinked(365, (s) => {
      airborne(s);
      Object.assign(s.fighters[0], { grounded: false, platform: -1, action: "fall", y: fx(2) });
      s.fighters[0].kinetic.controlX = fx(1);
      s.fighters[0].vx = fx(1);
    });
    const a = hit.state.fighters[0];
    expect(released.state.fighters[1].kinetic.damageX).toBe(Math.trunc(a.vx / 2));
    expect(released.state.fighters[1].kinetic.damageY).toBe(Math.trunc(a.vy / 2));
  });
});
```

- [ ] **Step 2: Run them**

Run: `pnpm vitest run src/engine/combat.test.ts`
Expected: FAIL — `pulls an airborne victim 20% of the way toward the hitbox (367)` (`expected 7152 to be -3276`), `launches a grounded victim at 80 degrees instead (367)` (`expected 28672 to be 327680`), `carries the victim at half the attacker's momentum (365)` (`expected 7178 to be 2048`).

- [ ] **Step 3: Implement**

In `src/engine/combat.ts`, replace:

```ts
  /** The current swing has already joined the stale queue; reset by `startMove` (Task 16). */
  swingQueued: boolean;
}

```

with:

```ts
  /** The current swing has already joined the stale queue; reset by `startMove` (Task 16). */
  swingQueued: boolean;
  /** The parked launch is an autolink, fixed on contact as (autolinkX, autolinkY), Q12 (Task 19). */
  autolink: boolean;
  autolinkX: number;
  autolinkY: number;
}

```

In `src/engine/combat.ts`, replace:

```ts
    grabImmune: 0,
    swingQueued: false,
  };
}
```

with:

```ts
    grabImmune: 0,
    swingQueued: false,
    autolink: false,
    autolinkX: 0,
    autolinkY: 0,
  };
}
```

In `src/engine/combat.ts`, replace:

```ts
    grabImmune: c.grabImmune,
    swingQueued: c.swingQueued,
  };
}
```

with:

```ts
    grabImmune: c.grabImmune,
    swingQueued: c.swingQueued,
    autolink: c.autolink,
    autolinkX: c.autolinkX,
    autolinkY: c.autolinkY,
  };
}
```

In `src/engine/constants.ts`, replace:

```ts
 */
export const GLANCING_BLOW_DEPTH = fx(0.1);

/** Two hitboxes within this damage difference clank instead of trading. */
```

with:

```ts
 */
export const GLANCING_BLOW_DEPTH = fx(0.1);

/**
 * Autolink angles (SmashWiki "Autolink angle"): 365° launches at half the
 * attacker's momentum; 367° at the attacker's momentum plus 20% of the
 * hitbox-to-victim difference, 80° against a grounded victim, launch speed
 * capped at 3 and vertical speed at −1. 366°/368° have no published formula
 * and run as 367° (UNVERIFIED).
 */
export const AUTOLINK_MIN = fx(365);
export const AUTOLINK_MAX = fx(368);
export const AUTOLINK_HALF_MOMENTUM = fx(365);
export const AUTOLINK_PULL_RATIO: Ratio = [1, 5];
export const AUTOLINK_GROUNDED_ANGLE = fx(80);
export const AUTOLINK_SPEED_CAP = fx(3);
export const AUTOLINK_MIN_VY = fx(-1);

/** Two hitboxes within this damage difference clank instead of trading. */
```

In `src/engine/hash.ts`, replace:

```ts
  x = mixInt(x, c.grabImmune);
  x = mixBool(x, c.swingQueued);
  return x;
}
```

with:

```ts
  x = mixInt(x, c.grabImmune);
  x = mixBool(x, c.swingQueued);
  x = mixBool(x, c.autolink);
  x = mixInt(x, c.autolinkX);
  x = mixInt(x, c.autolinkY);
  return x;
}
```

In `src/engine/simulate.ts`, replace:

```ts
 */

import { ONE, fx, mul, abs, byRatio, randomInt, nextRandom } from "./fixed";
import {
  ASDI_DISTANCE,
  ASDI_VERTICAL,
  FINAL_SMASH_STANDBY,
  GROUNDED_ZERO_LAUNCH_RATIO,
```

with:

```ts
 */

import { ONE, fx, mul, abs, byRatio, randomInt, nextRandom, sqrt } from "./fixed";
import {
  ASDI_DISTANCE,
  ASDI_VERTICAL,
  AUTOLINK_GROUNDED_ANGLE,
  AUTOLINK_HALF_MOMENTUM,
  AUTOLINK_MAX,
  AUTOLINK_MIN,
  AUTOLINK_MIN_VY,
  AUTOLINK_PULL_RATIO,
  AUTOLINK_SPEED_CAP,
  FINAL_SMASH_STANDBY,
  GROUNDED_ZERO_LAUNCH_RATIO,
```

In `src/engine/simulate.ts`, replace:

```ts
  }
  f.combat.asdi = false;
  const facing = f.pendingFacing;
  const relStick = intent.x * (facing >= 0 ? 1 : -1);
```

with:

```ts
  }
  f.combat.asdi = false;
  if (f.combat.autolink) {
    // An autolink's launch was fixed on contact: no DI, no LSI, no speed-up.
    const speed = sqrt(mul(f.combat.autolinkX, f.combat.autolinkX) + mul(f.combat.autolinkY, f.combat.autolinkY));
    kineticLaunch(f, f.combat.autolinkX, f.combat.autolinkY, speed);
    f.balloon = false;
    if (f.vy > 0 && f.grounded) {
      f.grounded = false;
      f.platform = -1;
    }
    clearPendingLaunch(f);
    return;
  }
  const facing = f.pendingFacing;
  const relStick = intent.x * (facing >= 0 ? 1 : -1);
```

In `src/engine/simulate.ts`, replace:

```ts
const DIAGONAL = fx(0.7071067811865476);

function clearPendingLaunch(f: FighterState): void {
  f.pendingKnockback = 0;
```

with:

```ts
const DIAGONAL = fx(0.7071067811865476);

/**
 * Autolink angles (Plan 3, Task 19; SmashWiki "Autolink angle",
 * https://www.ssbwiki.com/Autolink_angle). 365° launches at "50% of the
 * attacker's momentum", whatever the knockback. 367° sets "the opponent's launch
 * speed to the attacker's momentum, plus 20% of the difference" between the
 * hitbox and the opponent's position, and against a grounded opponent "always
 * uses an angle of 80°"; its launch speed is capped at 3 and its vertical speed
 * at −1. The page gives no formula for 366° or 368°; they are run as 367°
 * (UNVERIFIED). The cap applies at once rather than five frames after the
 * launch (UNVERIFIED simplification). "Position" is the fighter's origin.
 */
function parkAutolink(victim: FighterState, hb: Hitbox, c: Candidate, attacker: FighterState): void {
  victim.combat.autolink = false;
  if (hb.angle < AUTOLINK_MIN || hb.angle > AUTOLINK_MAX) return;
  if (hb.angle !== AUTOLINK_HALF_MOMENTUM && victim.grounded) {
    victim.pendingAngle = AUTOLINK_GROUNDED_ANGLE;
    return;
  }
  const mx = c.projectile !== null ? c.projectile.vx : attacker.vx;
  const my = c.projectile !== null ? c.projectile.vy : attacker.vy;
  let ax: number;
  let ay: number;
  if (hb.angle === AUTOLINK_HALF_MOMENTUM) {
    ax = Math.trunc(mx / 2);
    ay = Math.trunc(my / 2);
  } else {
    ax = mx + byRatio(c.x - victim.x, AUTOLINK_PULL_RATIO);
    ay = my + byRatio(c.y - victim.y, AUTOLINK_PULL_RATIO);
    if (ay < AUTOLINK_MIN_VY) ay = AUTOLINK_MIN_VY;
    const speed = sqrt(mul(ax, ax) + mul(ay, ay));
    if (speed > AUTOLINK_SPEED_CAP) {
      ax = Math.trunc((ax * AUTOLINK_SPEED_CAP) / speed);
      ay = Math.trunc((ay * AUTOLINK_SPEED_CAP) / speed);
    }
  }
  victim.combat.autolink = true;
  victim.combat.autolinkX = ax;
  victim.combat.autolinkY = ay;
}

function clearPendingLaunch(f: FighterState): void {
  f.pendingKnockback = 0;
```

In `src/engine/simulate.ts`, replace:

```ts
  f.combat.launchFaf = 0;
  f.combat.asdi = false;
}

```

with:

```ts
  f.combat.launchFaf = 0;
  f.combat.asdi = false;
  f.combat.autolink = false;
}

```

In `src/engine/simulate.ts`, replace:

```ts
  victim.combat.asdi = (hb.effect === "electric" || hb.effect === "paralyze") && !vertical;
  victim.pendingFacing = sourceFacing >= 0 ? 1 : -1;

  victim.hitstun = effectiveHitstun(kb, speedUp);
```

with:

```ts
  victim.combat.asdi = (hb.effect === "electric" || hb.effect === "paralyze") && !vertical;
  victim.pendingFacing = sourceFacing >= 0 ? 1 : -1;
  parkAutolink(victim, hb, c, attacker);

  victim.hitstun = effectiveHitstun(kb, speedUp);
```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/engine/combat.test.ts`
Expected: PASS.

- [ ] **Step 5: The golden trace**

Run: `pnpm vitest run src/game/golden.test.ts`
Expected: PASS, unchanged — no autolink hit lands in the four CPU matches (observed: the trace passes untouched).

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0 (`pnpm lint` reports only the two pre-existing warnings in `research/rebuild-2026-10/tools/sim_bench.mjs`).

- [ ] **Step 7: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/src/engine/combat.test.ts \
  super-smash/src/engine/combat.ts \
  super-smash/src/engine/constants.ts \
  super-smash/src/engine/hash.ts \
  super-smash/src/engine/simulate.ts
git commit -m "super-smash: autolink angles 365 and 367" -m "SmashWiki 'Autolink angle': 365 launches at half the attacker's momentum; 367 at its momentum plus 20% of the way to the hitbox, 80 degrees on the ground, capped at 3 and -1 vertical. 366/368 run as 367 (UNVERIFIED)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 20: The online fingerprint covers the engine's rules

Plan 2's `engineFingerprint` (`src/game/simContext.ts`) is what two online peers compare before a match, and it hashes only the bone table. Two builds with the same bones but different combat rules — say one with this plan and one without, or with a different set of activated scripts — would start a match and desync on the first hit. So the fingerprint now also folds in `ENGINE_RULES_VERSION` (3 here; every later plan that changes what `step()` does bumps it) and every fighter's `ACTIVE_SCRIPT_SLOTS`, still as 8 hex digits, so `onlineConfig` and the lobby carry it unchanged. Plan 2's test that the fingerprint *equals* the bone table's becomes "changes with it".

**Files:**
- Modify: `super-smash/src/engine/constants.ts`
- Modify: `super-smash/src/game/simContext.test.ts`
- Modify: `super-smash/src/game/simContext.ts`
- Modify: `super-smash/src/net/online/lobby.ts`

**Interfaces:** Adds `ENGINE_RULES_VERSION = 3` (`constants.ts`); in `src/game/simContext.ts`: `interface EngineRules { readonly version: number; readonly activeSlots: Readonly<Record<string, readonly MoveSlot[]>> }`, `GAME_ENGINE_RULES`, and `engineFingerprint(ctx = GAME_SIM_CONTEXT, rules = GAME_ENGINE_RULES): string`.

- [ ] **Step 1: Write the failing tests**

In `src/game/simContext.test.ts`, replace:

```ts

import { LEGACY_BONE_TABLE } from "@/engine/acmd/bones";
import { registryContext } from "@/engine/simulate";
import { bootstrapEngine } from "./bootstrap";
import { GAME_SIM_CONTEXT, engineFingerprint } from "./simContext";
```

with:

```ts

import { LEGACY_BONE_TABLE } from "@/engine/acmd/bones";
import { ENGINE_RULES_VERSION } from "@/engine/constants";
import { registryContext } from "@/engine/simulate";
import { ACTIVE_SCRIPT_SLOTS } from "@/fighters/acmd/active";
import { bootstrapEngine } from "./bootstrap";
import { GAME_SIM_CONTEXT, engineFingerprint } from "./simContext";
```

In `src/game/simContext.test.ts`, replace:

```ts

  it("fingerprints its bone table for online peers", () => {
    expect(engineFingerprint()).toBe(LEGACY_BONE_TABLE.fingerprint);
    expect(engineFingerprint()).toMatch(/^[0-9a-f]{8}$/);
    const other = { ...GAME_SIM_CONTEXT, bones: { ...LEGACY_BONE_TABLE, fingerprint: "0badf00d" } };
    expect(engineFingerprint(other)).toBe("0badf00d");
  });
});
```

with:

```ts

  it("fingerprints its bone table for online peers", () => {
    expect(engineFingerprint()).toMatch(/^[0-9a-f]{8}$/);
    const other = { ...GAME_SIM_CONTEXT, bones: { ...LEGACY_BONE_TABLE, fingerprint: "0badf00d" } };
    expect(engineFingerprint(other)).not.toBe(engineFingerprint());
  });

  // Plan 3, Task 20: two builds with the same bones but different combat rules,
  // or a different set of running scripts, are different games too.
  it("fingerprints the engine's rules version and the scripts that run", () => {
    const base = engineFingerprint();
    expect(engineFingerprint(GAME_SIM_CONTEXT, { version: ENGINE_RULES_VERSION + 1, activeSlots: ACTIVE_SCRIPT_SLOTS })).not.toBe(base);
    const fewer = { ...ACTIVE_SCRIPT_SLOTS, mario: ACTIVE_SCRIPT_SLOTS.mario.slice(1) };
    expect(engineFingerprint(GAME_SIM_CONTEXT, { version: ENGINE_RULES_VERSION, activeSlots: fewer })).not.toBe(base);
    expect(engineFingerprint(GAME_SIM_CONTEXT, { version: ENGINE_RULES_VERSION, activeSlots: ACTIVE_SCRIPT_SLOTS })).toBe(base);
  });

  it("is Plan 3's rules version", () => {
    expect(ENGINE_RULES_VERSION).toBe(3);
  });
});
```

- [ ] **Step 2: Run them**

Run: `pnpm vitest run src/game/simContext.test.ts`
Expected: FAIL — `fingerprints the engine's rules version and the scripts that run` (`expected 'd6dbbfab' not to be 'd6dbbfab'`: the rules do not reach the fingerprint) and `is Plan 3's rules version` (`expected undefined to be 3`).

- [ ] **Step 3: Implement**

In `src/engine/constants.ts`, replace:

```ts
/** The simulation runs at a fixed 60Hz. Every "frame" in this codebase is 1/60s. */
export const TICK_RATE = 60;

/* ------------------------------------------------------------------ combat -- */
```

with:

```ts
/** The simulation runs at a fixed 60Hz. Every "frame" in this codebase is 1/60s. */
export const TICK_RATE = 60;

/**
 * The version of the engine's combat rules. Two online peers whose builds
 * differ here play different games and desync on the first hit, so the
 * version goes into `engineFingerprint` (`src/game/simContext.ts`). Plan 3
 * sets it to 3; every later plan that changes what `step()` does bumps it.
 */
export const ENGINE_RULES_VERSION = 3;

/* ------------------------------------------------------------------ combat -- */
```

In `src/game/simContext.ts`, replace:

```ts

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

with:

```ts

import { LEGACY_BONE_TABLE } from "@/engine/acmd/bones";
import { ENGINE_RULES_VERSION } from "@/engine/constants";
import { mixInt, mixString } from "@/engine/hash";
import { registryContext, type SimContext } from "@/engine/simulate";
import type { MoveSlot } from "@/engine/types";
import { ACTIVE_SCRIPT_SLOTS } from "@/fighters/acmd/active";

export const GAME_SIM_CONTEXT: SimContext = { ...registryContext, bones: LEGACY_BONE_TABLE };

/** What, besides the bones, makes two builds the same game (Plan 3, Task 20). */
export interface EngineRules {
  /** `ENGINE_RULES_VERSION`. */
  readonly version: number;
  /** Which moves run their imported scripts (`ACTIVE_SCRIPT_SLOTS`). */
  readonly activeSlots: Readonly<Record<string, readonly MoveSlot[]>>;
}

export const GAME_ENGINE_RULES: EngineRules = { version: ENGINE_RULES_VERSION, activeSlots: ACTIVE_SCRIPT_SLOTS };

/**
 * What two online peers compare before a match. A different bone table is a
 * different game — hitboxes land elsewhere — and so is a different rules
 * version or a different set of running scripts: rollback would desync on
 * the first hit, so a start whose fingerprint differs is refused. Eight hex
 * digits over the bone table's fingerprint, the rules version, and every
 * fighter's active slots in a fixed order.
 */
export function engineFingerprint(ctx: SimContext = GAME_SIM_CONTEXT, rules: EngineRules = GAME_ENGINE_RULES): string {
  let h = mixString(0x811c9dc5, (ctx.bones ?? LEGACY_BONE_TABLE).fingerprint);
  h = mixInt(h, rules.version);
  for (const id of Object.keys(rules.activeSlots).sort()) {
    h = mixString(h, id);
    const slots = rules.activeSlots[id];
    h = mixInt(h, slots.length);
    for (const slot of slots) h = mixString(h, slot);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
```

In `src/net/online/lobby.ts`, replace:

```ts
  readonly costumes: readonly [number, number];
  /**
   * The host's bone-table fingerprint (`engineFingerprint`, Plan 2 Task 27).
   * The guest refuses a start whose fingerprint is not its own.
   */
```

with:

```ts
  readonly costumes: readonly [number, number];
  /**
   * The host's engine fingerprint (`engineFingerprint`: the bone table, Plan 2
   * Task 27, and the rules version and running scripts, Plan 3 Task 20).
   * The guest refuses a start whose fingerprint is not its own.
   */
```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/game/simContext.test.ts`
Expected: PASS.

- [ ] **Step 5: The golden trace**

Run: `pnpm vitest run src/game/golden.test.ts`
Expected: PASS, unchanged.

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0 (`pnpm lint` reports only the two pre-existing warnings in `research/rebuild-2026-10/tools/sim_bench.mjs`).

- [ ] **Step 7: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/src/engine/constants.ts \
  super-smash/src/game/simContext.test.ts \
  super-smash/src/game/simContext.ts \
  super-smash/src/net/online/lobby.ts
git commit -m "super-smash: the online fingerprint covers the engine's rules" -m "engineFingerprint hashes ENGINE_RULES_VERSION and ACTIVE_SCRIPT_SLOTS with the bone table, so builds with different combat rules refuse to play each other instead of desyncing." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 21: Record the decision (D56)

DECISIONS D56 records what Plan 3 changed and why, with every source; README's Architecture paragraph points at it; the reference-script module docs stop saying the game never runs them. No behaviour changes, so there is no test to write.

**Files:**
- Modify: `super-smash/DECISIONS.md`
- Modify: `super-smash/README.md`
- Modify: `super-smash/src/fighters/acmd/index.ts`
- Modify: `super-smash/src/fighters/acmd/reference.ts`

**Interfaces:** None (documentation).

- [ ] **Step 1: Write it**

Append to the end of `DECISIONS.md`:

```md
## D56 — Combat numbers match the published game

**Decision.** Plan 3 replaced the replica's combat approximations with Ultimate's published
rules, each pinned by a test against a public source — SmashWiki, rubendal SSBU-Calculator
(`js/formulas.js`, `js/knockback.js`, MIT) and its Sm4sh-Calculator wiki, or the reference port
`research/rebuild-2026-10/tools/ssbu_ref.mjs`, which is checked against the calculator:

- **Hitstun.** The base is `floor(max(KB × 0.4, 5)) − 1` (at least 4 frames). A tumbling launch
  without set knockback is played back sped up (`init_damage_speed_up`: up to 6× on its first
  frame, falling to 1× once 70% of its reaction frames are spent), so 90/145/200/250 knockback
  hold the victim 33/41/49/61 real frames; the "(KB − 200) × 0.25" slope is that schedule's cap.
  Each sped-up real frame plays several of the game's reaction frames of decay and gravity, so the
  path is the un-sped one, sampled; `integrate` adds the extra frames' displacement.
- **Hitstun cancel**: air dodge from frame 41 below launch speed 2.5, aerial from 46 below 2 — on
  a press, never a held shield, and only with an air dodge left. Being hit gives the air dodge back.
- **Angles**: the Sakurai angle is 38° in the air and on the ground 0° below 60 knockback, 38° from
  88, ramped between; a flat (0°) launch of 120 knockback or more goes out at 32°; a grounded victim
  launched at 0° leaves at 0.8 of the speed. **Autolink** angles 365° (half the attacker's momentum)
  and 367° (momentum plus 20% of the way to the hitbox; 80° on the ground) follow SmashWiki; 366° and
  368° have no published formula and run as 367°.
- **DI** bends up to 0.17 rad, linear in the stick's perpendicular component; DI and LSI act only on
  a tumbling launch that is not within 0.17 rad of straight ahead (rubendal's Sm4sh-Calculator wiki,
  "DI and LSI calculation"; Ultimate keeps Smash 4's DI). Plan 1's `Btn.Soft` still quarters the
  bend (D54), UNVERIFIED as before. **LSI** is off strictly between 65°–115° and 245°–295°. **SDI**
  grows ×1.15 from a string's sixth hit; **ASDI** exists only for electric and paralyzing hits.
- **Shields** take ×1.19, shrink to `(HP/50) × 0.85 + 0.15` of their radius (so a worn shield can
  be poked), push the defender `min((shieldstun + 1) × 0.09, 1.3)` on the unrounded shieldstun and a
  grounded attacker `0.04 × d + 0.025`, break into `400 − percent` frames of stun (mashed 5.4 a
  button, 3 a stick input) and 33 frames of FuraFuraEnd, and come back at 37.5. A **perfect shield**
  adds the published hitlag to the *shield* hitlag (direct melee +14/+11, indirect +14/+2,
  projectile 0/+8 or 0/−1) and pushes back 0.15 as far.
- **Staling** uses the published table (0.09 … 0.025), the 1.05 bonus only for a fresh move, 0.85
  for an entry that hit a shield, and one entry per swing: a multi-hit's later hits are as stale as
  its first.
- **Knockback stacking**: against a live launch (hitstun left, or parked in hitlag) from another
  source, a new launch at 0.5×–0.9× keeps the live one's speed and hitstun but turns it toward the
  sum of both vectors; under 0.5× it is armoured through.
- **Teching**: an 11-frame window, a 40-frame lockout; floors techable at launch speed ≤ 3, walls
  and ceilings at ≤ 6; a held shield techs the ground; four new statuses (PASSIVE, PASSIVE_FB,
  PASSIVE_WALL, PASSIVE_CEIL) with Lucario's published tech frame data for everyone (UNVERIFIED per
  fighter); too fast to tech bounces away from the surface (×0.95 launch, ×0.8 hitstun).
  **Glancing blows** (less than 0.1 deep) do not hit.
- **Grabs** hold `floor(90 + 1.7p)` frames (never under 19), mashed 14.4 a button and 8 a stick
  input, and a fighter who breaks out cannot be grabbed for 60 frames. **Ledge trump**: grabbing
  an occupied ledge knocks its holder off without intangibility (CLIFF_ROBBED; its length is
  UNVERIFIED).
- A super-armoured hit counted its damage twice; it counts it once.

**Scripts.** 38 moves whose every box hangs off the root bone now run their imported `game_`
scripts (`src/fighters/acmd/active.ts`): set weight, ground/air-only boxes, `ATTACK_LR_CHECK_POS`,
spike angles, capsule (extended) boxes swept as parallelograms, and `clear_all` re-arming a
multi-hit are honoured, and their `reconcile.allow.json` entries are gone. Limb-bone scripts,
throws, pummels, and moves with legacy momentum, projectiles, armour or a smash charge stay on their
compiled legacy scripts until Plan 4's bake and Plan 5's specials.

**Online.** `ENGINE_RULES_VERSION` (3 here; later plans bump it) and `ACTIVE_SCRIPT_SLOTS` join
the bone table in `engineFingerprint`, so two builds with different combat rules refuse to start a
match together instead of desyncing on the first hit.

**Where it lives.** One `CombatState` sub-object on `FighterState` (`combat.ts`), cloned and
hashed like `kinetic`; shield numbers in `shield.ts`; teching in `tech.ts`.
```

In `README.md`, replace:

```md
(`status/`); and every move runs as an ACMD `game_` script whose hitboxes hang off bones through a
`BoneTable` (`acmd/`). The published scripts for all eight fighters are imported by
`scripts/import-acmd.mjs` into `src/fighters/acmd/generated/`.

---
```

with:

```md
(`status/`); and every move runs as an ACMD `game_` script whose hitboxes hang off bones through a
`BoneTable` (`acmd/`). The published scripts for all eight fighters are imported by
`scripts/import-acmd.mjs` into `src/fighters/acmd/generated/`; the moves whose hitboxes hang off
the root bone already run them (`src/fighters/acmd/active.ts`). Combat follows the published
numbers — balloon speed-up, DI, shields, staling, teching and the rest
([D56](DECISIONS.md#d56--combat-numbers-match-the-published-game)).

---
```

In `src/fighters/acmd/index.ts`, replace:

```ts
/**
 * Every fighter's imported reference scripts, by fighter id (Plan 2, Task 16).
 * Not imported by the game: only the reconciliation and self-check tests read it.
 */

```

with:

```ts
/**
 * Every fighter's imported reference scripts, by fighter id (Plan 2, Task 16).
 * The game imports the scripts it runs straight from `generated/` (each fighter
 * file, through `active.ts`); this table is for the reconciliation and
 * self-check tests.
 */

```

In `src/fighters/acmd/reference.ts`, replace:

```ts
 *
 * Generated by `scripts/import-acmd.mjs` into `generated/<fighter>.ts` from
 * rubendal's published data. Reference only in Plan 2: the sim still runs the
 * compiled legacy moves (`engine/acmd/legacy.ts`), because these scripts hang
 * hitboxes off limb bones that only Plan 4's bake can place. `reconcile.test.ts`
 * compares the two so every disagreement is listed rather than discovered.
 */

```

with:

```ts
 *
 * Generated by `scripts/import-acmd.mjs` into `generated/<fighter>.ts` from
 * rubendal's published data. The sim runs the root-bone ones (Plan 3,
 * `active.ts`); the rest hang hitboxes off limb bones that only Plan 4's bake
 * can place, so those moves still run their compiled legacy scripts
 * (`engine/acmd/legacy.ts`). `reconcile.test.ts` compares what runs with these,
 * so every disagreement is listed rather than discovered.
 */

```

- [ ] **Step 2: The golden trace**

Run: `pnpm vitest run src/game/golden.test.ts`
Expected: PASS, unchanged.

- [ ] **Step 3: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0 (`pnpm lint` reports only the two pre-existing warnings in `research/rebuild-2026-10/tools/sim_bench.mjs`).

- [ ] **Step 4: Commit** (from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates`)

```bash
git add super-smash/DECISIONS.md \
  super-smash/README.md \
  super-smash/src/fighters/acmd/index.ts \
  super-smash/src/fighters/acmd/reference.ts
git commit -m "super-smash: record D56 (combat numbers match the published game)" -m "DECISIONS D56; README Architecture; acmd/reference.ts and acmd/index.ts docs." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review

**Spec coverage (§3.2 Phase 3; R§3 combat rows).**
- Balloon knockback speed-up (`init_damage_speed_up`, up to 6×; 90/145/200/250 → 33/41/49/61; the "(KB − 200) × 0.25" slope; set knockback skipped) → Tasks 5 (arithmetic, pinned to `ssbu_ref.mjs` at every quarter-knockback up to 500) and 6 (in the sim, on the DAMAGE energy).
- Hitstun cancel (press-only, with an air dodge left; air dodge restored by a hit), minimum hitstun, bounce ×0.8 hitstun / −5% → Tasks 7, 5, 12.
- Sakurai angle 361, flat launches lifted to 32° from 120 knockback, grounded 0° at 0.8 speed → Task 3. DI linear, 0.17 rad, 24/120 dead zone, straight-ahead skip, Plan 1's soft rule kept; LSI inside the same DI-able gate → Task 4. LSI dead zones, SDI ×1.15, ASDI → Tasks 4, 11. Autolink 365°/367° → Task 19.
- Shield ×1.19, 37.5 reset, break stun `400 − p` then 33 frames of FuraFuraEnd (SmashWiki "Stun"), both pushbacks (unrounded shieldstun), size; perfect shield table on the shield hitlag, ×0.15 pushback → Tasks 9, 10.
- Staling table, fresh ×1.05, shield ×0.85 → Task 2; one entry per swing → Task 16. Knockback stacking (live launches only; summed direction) → Task 8.
- Tech (11-frame window, 40-frame lockout, held shield on the ground, floor ≤ 3, walls/ceilings ≤ 6 with boundary tests; PASSIVE, PASSIVE_FB, PASSIVE_WALL, PASSIVE_CEIL via Plan 2's registry; missed tech → DOWN_WAIT, which existed; bounces away from the surface) → Task 12.
- Glancing blow (less than 0.1 deep) → Task 13; lowest-id priority kept (`resolveHits` unchanged there).
- Ledge trump; grab release immunity 60, `floor(90 + 1.7p)`, mash → Tasks 15, 14.
- The super-armour double damage → Task 1.
- Imported root-bone scripts activated, legacy data errors corrected by activation, `reconcile.allow.json` entries deleted, the limb-bone boundary stated → Tasks 16–18 (capsules swept as parallelograms, Task 17).
- Online: `ENGINE_RULES_VERSION` and the running scripts in `engineFingerprint` → Task 20.
- Golden trace regenerated only where a task changes behaviour, each saying why; D56 (next after Plan 2's D55; Plan 1 holds D54) → Task 21.

**Review changelog (folded in).** Hitstun cancel no longer clears hitstun before knowing the air dodge can start, needs a press, and a hit restores the air dodge (7); bounces go away from the surface (12); stacking treats a launch as live only with hitstun left or parked (8) and turns a kept launch toward the summed vectors (8); a multi-hit stales once (16, 18); a held shield techs the ground, without spending the air dodge (12, with 7); the online fingerprint covers the rules (20); wall and floor tech boundaries are tested (12); perfect shield builds on the shield hitlag and pushes 0.15 (10); flat launches and grounded 0° speed (3); LSI inside the DI gate, now sourced (4); shield pushback on unrounded shieldstun and FuraFuraEnd (9); capsule sweeps cover the parallelogram's inside (17); autolinks (19); "less than 0.1" glancing (13); text corrections (2, 11, Risks, Task 4's Plan 1 dependency).

**Placeholder scan.** Every step carries its full code or an exact command with its expected output. The two generated artefacts — the golden trace and the reconciliation allowlist — come from commands given in full; the allowlist's change is listed key by key.

**Type consistency.** New `FighterState` data lives in `CombatState` (twelve fields by the end); `cloneState`'s reflective test and the explicit `hash.test.ts` cases cover it. `kineticLaunch`'s new parameter defaults to 0, so Plan 2's callers compile unchanged. `resolveAngle` gains a required `kb` (one caller). `Intent` is not changed (stick mashing reads `framesSinceDirPress === 0`). `ActionState` gains five members; the renderer's `poseNameFor` maps each to an existing clip and its `default` covers anything Plan 5 adds.

**Determinism.** All new engine arithmetic is integer: Q12 with `byRatio`/`mulDiv`-style single truncations, the staling table in 1/100000, mashing in tenths of a frame, the speed-up schedule in Q12 (exact against the float reference up to 500 knockback). No `Math.sin/cos/atan` in `src/engine` (the DI reference test uses the engine's LUT `cosDeg`/`sinDeg`); `layering.test.ts` passes untouched.

**Review Focus placement.** #1 Task 12, #2 Task 10, #3 Task 2, #4 Tasks 8 and 16 (and Task 18), #5 Task 6.

## Open questions (for David)

1. **The speed-up's physics.** Each sped-up real frame plays whole reaction frames of decay and gravity and the fighter is placed where the un-sped launch would be (rubendal's launch visualiser samples the same path). The game may integrate a fractional reaction frame; the difference is under one reaction frame of travel. Acceptable?
2. **UNVERIFIED numbers introduced here:** ASDI distance (half an SDI pulse); whether SDI ×1.15 compounds past the tenth hit (here: no); bounce hitstun ×0.8 applied to the hitstun left (the wiki says "relative to the initial amount"); tech frame data for all eight taken from Lucario's page; tech-roll distance (the ground roll's 28); ledge-trump lag (30 frames) and the trumped fighter's placement; the shield bubble's centre (half-way up the hurtbox until Plan 4's shield bone); 180° flat launches lifted to 148° (rubendal writes 32° for both 0° and 180°); autolink 366°/368° run as 367°, the 367° speed cap applied at once instead of five frames after launch, and "position" taken as the fighter's origin. Any source for these?
3. **The facing-aware shield.** `shieldCovers` still lets a hit from behind through, a replica rule; Ultimate's shield is a sphere and covers both sides. Plan 3 adds the size check on top and leaves the facing rule. Remove it?
4. **Shield pushback decay.** SmashWiki: pushback "is then decayed every frame by the character's traction value", the attacker's at ×1.1; the replica decays both by `ground_brake` (traction), without the ×1.1. Add it?
5. **The shield-break "shield jump" launch** (SmashWiki "Shield break": the fighter is launched upward) has no published speed for Ultimate and is not implemented.
6. **Bundle size.** Activating scripts imports `src/fighters/acmd/generated/*` into the game bundle (about 280 KB of source, minified much smaller). The generated scripts are committed (Plan 2's Global Constraints); if David would rather regenerate them in CI, only the import step moves. Is the bundle cost acceptable?

## Risks

- **Plan 2 drift.** Written against Plan 2's final interfaces (`SimContext.bones`, `jumpLaunchSpeed`, no `gravitySkip`, `kineticReel` with `damage_fly_top_*`, `scriptHitboxes` refusing capsules). If Plan 2 lands with a region worded differently, re-anchor by symbol; Task 6's `reelOnce` must be whatever `kineticReel`'s body is, moved verbatim.
- **Game feel.** Launches are shorter in real time (the speed-up), jabs no longer DI, shields break sooner and stun for `400 − p`, grabs hold much longer at high percent, CPUs now tech when they happen to press shield, and 38 moves change hitboxes (multi-hits hit more than once). All are sourced; the CPU (`src/ai`) is not taught any of it until Plan 5.
- **Golden-trace coverage.** The four CPU matches barely exercise Plan 3's new rules — the reviewer counted no techs, one ledge trump and two shield hits in them — and none of grab mashing, hitstun cancel, autolinks or ASDI. The targeted tests carry those; the trace only guards against unintended change.
- **Renderer timing.** An activated move's `totalFrames` follows its script's published FAF, but the renderer still reads the legacy `MoveDef.hitboxes` for a clip's strike frame (`render/poses/timing.ts`), so a few clips may land a frame or two off their hitbox until Plan 4 drives clips from the bake.
- **Performance.** Capsules add three segment tests and two point-in-parallelogram tests per box; `runScript` replays are unchanged. Suite time stayed about 9–10 s in the scratch run.
- **Plan 1 dependency.** Task 4 rewrites Plan 1 Task 15's `applyDI with a soft stick` block; if Plan 1 lands without those tests, add the block as new rather than replacing it.
- **Version bumps.** `ENGINE_RULES_VERSION` only protects online play if every later plan that changes `step()` bumps it; Plans 4 and 5 should say so in their first engine task.

---

## Interfaces for later phases

Exact definitions Plans 4 (3D renderer and bone bake) and 5 (specials, CPU, controls) build on, as committed by the end of this plan.

### CombatState (`src/engine/combat.ts`)

```ts
export interface CombatState {
  staleShield: boolean[];   // parallel to FighterState.staleQueue
  launchFaf: number;        // parked launch's reaction frames when sped up, else 0
  launchSource: number;     // attacker port, or 1000 + projectile instanceId; -1 none
  mash: number;             // tenths of a frame earned by mashing, not yet spent
  comboHits: number;        // hits taken since last out of hitstun
  asdi: boolean;            // the running freeze ends with automatic SDI
  techWindow: number;       // frames left of an open tech window
  techLockout: number;      // frames before a shield press can open another
  grabImmune: number;       // frames during which grabs pass through
  swingQueued: boolean;     // this swing has joined the stale queue (reset by startMove)
  autolink: boolean;        // the parked launch is an autolink …
  autolinkX: number;        // … fixed on contact, Q12
  autolinkY: number;
}
export function emptyCombat(): CombatState;
export function cloneCombat(c: CombatState): CombatState;
// FighterState.combat: CombatState; hashState mixes it (mixCombat). A field added by Plan 5 goes here,
// in emptyCombat, cloneCombat and mixCombat; the reflective tests demand the first three.
```

### Knockback and hitstun (`src/engine/knockback.ts`, `kinetic.ts`)

```ts
export function computeHitstun(kb: number): number;                         // floor(max(kb*0.4, 5)) - 1
export function damageSpeedUpMaxMag(faf: number): number;                   // Q12
export function damageSpeedUpMag(frame: number, faf: number, maxMag: number): number; // Q12
export function effectiveHitstun(kb: number, speedUp: boolean): number;     // real frames
export function resolveAngle(hitbox: Pick<Hitbox, "angle">, victimGrounded: boolean, kb: number): number; // Sakurai + 0°/180° lift
export function launchDiAble(angleFx: number): boolean;                     // not within 0.17 rad of straight ahead
export function applyDI(angleFx: number, stickX: number, stickY: number, soft?: boolean): number; // linear
export function applyLSI(launchSpeed: number, stickY: number, angleFx: number): number;
export function stickSensibility(raw: number): number;                      // Q12, 24/120 dead zone
export function computeStaleness(queue: readonly MoveSlot[], slot: MoveSlot, shieldQueue?: readonly boolean[]): Staleness;
export function knockbackStack(fresh: number, current: number): "replace" | "keep" | "armour";
export function shieldstunExact(damage: number, opts?: ShieldstunOptions): number; // Q12, unrounded
// kinetic.ts
export function kineticLaunch(f: FighterState, vx: number, vy: number, speed: number, speedUpFaf?: number): void;
export function kineticReel(f: FighterState, p: FighterParams, balloon: boolean): void; // plays the speed-up's reaction frames
export function kineticTakeStep(f: FighterState): { x: number; y: number };             // integrate's extra displacement
export function kineticTurnLaunch(f: FighterState, dx: number, dy: number): void;     // same speed, new direction
// KineticState gains: speedUpFrame (Q12), speedUpFaf, speedUpMax (Q12, 0 = off), stepX, stepY.
```

A tumbling launch without set knockback is sped up; `FighterState.hitstun` is real frames (`effectiveHitstun`); tumble is decided on the base (`computeHitstun(kb) >= TUMBLE_HITSTUN`). A Plan 5 move that launches (a counter's riposte, a reflector) goes through `applyHit` and gets all of this. Being hit restores the air dodge; DI and LSI need a tumbling launch more than 0.17 rad off straight ahead; autolink angles 365–368 bypass DI, LSI and the speed-up.

### Shields (`src/engine/shield.ts`)

```ts
export function shieldDamage(damage: number): number;
export function shieldScale(health: number): number;
export function shieldBubble(f: Pick<FighterState, "x" | "y" | "shieldHealth">, def: FighterDef): Capsule; // Plan 4: centre from the shield bone
export function shieldPushback(shieldstun: number): number; // from unrounded Q12 shieldstun (shieldstunExact)
export function attackerShieldPushback(damage: number): number;
export function shieldBreakStun(percent: number): number;
export function mashFrames(c: CombatState, buttons: number, sticks: number, perButton: number, perStick: number): number;
export function perfectShieldHitlag(lag: number, projectile: boolean, direct: boolean): { attacker: number; defender: number }; // lag = shield hitlag
// states.ts: export function buttonPresses(intent: Intent): number;
```

### Tech (`src/engine/tech.ts`) and the new statuses

```ts
export type Surface = "floor" | "wall" | "ceiling";
export interface LaunchBefore { readonly x: number; readonly y: number; readonly speed: number; readonly tumbling: boolean }
export function launchBefore(f: FighterState): LaunchBefore;
export function updateTechInput(f: FighterState, intent: Intent): void;   // every fighter, every frame, phase 3
export function techOrBounce(f: FighterState, surface: Surface, before: LaunchBefore, intent: Intent, wallSide?: number): "tech" | "bounce" | null;
// physics.ts: CollisionOutcome gains `wall: number` (1 right, -1 left, 0 none) and `ceiling: boolean`.
// A held shield techs the ground; hitstun cancel needs a press, so holding never spends the air dodge.
```

| `ActionState` | `StatusKind` | file | kinetic type |
|---|---|---|---|
| `"tech"` | `FIGHTER_STATUS_KIND_PASSIVE` | `status/passive.ts` | `GROUND_STOP` |
| `"techRoll"` | `FIGHTER_STATUS_KIND_PASSIVE_FB` | `status/passive.ts` | `MOTION` |
| `"techWall"` | `FIGHTER_STATUS_KIND_PASSIVE_WALL` | `status/passive.ts` | `GROUND_STOP` |
| `"techCeiling"` | `FIGHTER_STATUS_KIND_PASSIVE_CEIL` | `status/passive.ts` | `GROUND_STOP` |
| `"ledgeTrumped"` | `FIGHTER_STATUS_KIND_CLIFF_ROBBED` | `status/cliff.ts` | `GROUND_STOP` |

Plan 5's wall-jump tech (`FIGHTER_STATUS_KIND_PASSIVE_WALL_JUMP`, frames 1–5 of a wall tech) slots in beside `STATUS_PASSIVE_WALL`. Plan 4 gives these actions their own clips (they borrow `getUp`, `roll`, `tumble`, `fall` today). Other API: `trumpLedge(f, clearance)`, `grabHoldFrames(percent)`, `GRAB_MIN_FRAMES`, `GRAB_RELEASE_IMMUNITY` (`states.ts`).

### Hitboxes (`src/engine/types.ts`, `hitbox.ts`, `acmd/hitboxes.ts`)

```ts
interface Hitbox {
  // … Plan 2's fields, plus:
  readonly x2?: number; readonly y2?: number;        // far end of an extended hitbox
  readonly direct?: boolean;                          // smash-script `direct`
  readonly setWeight?: boolean;                       // `set_weight`
  readonly situation?: "ground" | "air";              // COLLISION_SITUATION_MASK_G/A
  readonly lr?: "position" | "back";                  // ATTACK_LR_CHECK_POS/B
}
export function sweptHitboxPenetration(prevX: number, prevY: number, x: number, y: number, radius: number, target: Capsule): number;
export function sweptCapsulePenetration(prevX: number, prevY: number, x: number, y: number, dx: number, dy: number, radius: number, target: Capsule): number;
```

`scriptHitboxes` resolves both ends of a capsule through `SimContext.bones`; a spike angle (230°–310°) is a meteor unless the script says otherwise; `AttackModule::clear_all` re-arms a swing's hit record. Plan 4's bake needs nothing more from the pipeline.

### Which scripts run (`src/fighters/acmd/active.ts`)

```ts
export function activatable(slot: MoveSlot, move: MoveDef | undefined, script: AcmdScript): boolean;
export function withReferenceScripts(def: FighterDef, ref: ReferenceFighter, slots: readonly MoveSlot[]): FighterDef;
export const ACTIVE_SCRIPT_SLOTS: Readonly<Record<string, readonly MoveSlot[]>> = {
  mario: ["jab1", "dashAttack", "dair", "grab", "dashGrab"],
  donkeyKong: ["dashAttack", "dair", "grab", "dashGrab"],
  link: ["jab1", "jab2", "dtilt", "fair", "dair", "grab", "dashGrab"],
  samus: ["dashAttack"],
  kirby: ["jab1", "jab2", "dashAttack", "fair", "bair", "dair", "grab", "dashGrab"],
  fox: ["jab1", "jab2", "grab", "dashGrab"],
  pikachu: ["jab1", "dtilt", "nair", "fair", "grab", "dashGrab"],
  marth: ["sideB", "grab", "dashGrab"],
};
```

Every other slot runs its compiled legacy script. **Plan 4** activates limb-bone scripts after its bake by widening `activatable`'s bone check from `top` to "every bone the bake knows" and regenerating `ACTIVE_SCRIPT_SLOTS` (the test proves the table equals the rule) and `reconcile.allow.json` (which may only shrink). **Plan 5** activates the momentum, projectile, armour and charge moves once their energies, spawns and charge hold read the script, by dropping those clauses from `activatable`; throws and pummels move when their statuses read `ATTACK_ABS` and `set_catch_only_all`.

### Online fingerprint (`src/game/simContext.ts`, `src/engine/constants.ts`)

```ts
export const ENGINE_RULES_VERSION = 3; // constants.ts — Plans 4 and 5 bump it when step() changes
export interface EngineRules {
  readonly version: number;
  readonly activeSlots: Readonly<Record<string, readonly MoveSlot[]>>;
}
export const GAME_ENGINE_RULES: EngineRules; // { version: ENGINE_RULES_VERSION, activeSlots: ACTIVE_SCRIPT_SLOTS }
export function engineFingerprint(ctx?: SimContext, rules?: EngineRules): string; // 8 hex digits: bones + version + slots
```
