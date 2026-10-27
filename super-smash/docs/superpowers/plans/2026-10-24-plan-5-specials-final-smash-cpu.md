# Plan 5 — David-Smash: specials, Final Smashes, CPU and controls

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Starts after Plans 1–4 are merged.** Plan 1 (`2026-10-24-plan-1-hosting-online-rename.md`), Plan 2 (`2026-10-24-plan-2-engine-architecture.md`), Plan 3 (`2026-10-24-plan-3-combat-fidelity.md`) and Plan 4 (`2026-10-24-plan-4-3d-renderer.md`) land first, in that order. This plan is written against the code they leave, cited by symbol:
- **Plan 1:** `Btn.Soft` (Task 15); `src/input/gamepad.ts`'s `DIRECTION_MASK`, `mergeKeyboardAndPad`, `padPortMap` and the stick's soft bit (Task 16); the play page's `createGamepadInput({ portForPad: … })` calls (Task 21); the lobby's `pick`/`start` messages, `buildStartConfig`, `runnerSlotsFor`, `useOnlineStore` (Tasks 12–14, 20).
- **Plan 2:** `step(state, inputs, { prevInputs, ctx })`; the status registry (`StatusKind`, `FighterStatus` pre/main/exec/end, `ALL_STATUSES`); kinetic energies (`kineticSum`, `kineticClear`, `kineticGroundJump`); the ACMD interpreter (`runScript`, `moveScriptFrame`, `frame`/`wait`/`clearAll`); legacy moves compiled to scripts (`legacyGameScript`, `attackFromHitbox`); `fighterParams`; `interpretInput`/`Intent`; `poseNameFor`/`SLOT_POSE`/`SLOT_MOTION`.
- **Plan 3 (final, `plan3b`, 21 tasks):** `CombatState` (where per-fighter Plan 5 state goes, cloned by `cloneCombat` and hashed by `mixCombat`; `hash.test.ts`'s walker checks every leaf), `swingQueued`/`autolink*`, the 1.05 fresh-move bonus (melee only; projectiles are unstaled), hitstun cancel (air dodge from frame 41, on a press), the 11-frame tech window and `techOrBounce(f, surface, before, intent, wallSide?)` with `CollisionOutcome.wall` a side number (1/−1/0), grab hold and mash (`floor(90 + 1.7p)`, 14.4/8, 60 frames' release immunity), `FURAFURA_END_FRAMES`, capsule hitboxes (`Hitbox.x2/y2`), `src/fighters/acmd/active.ts` (`activatable`, `withReferenceScripts`, `ACTIVE_SCRIPT_SLOTS`), `reconcile.allow.json`, and Plan 3 Tasks 20–21's `ENGINE_RULES_VERSION` and `engineFingerprint(ctx?, rules?)`. Plan 3's own note sets two of this plan's jobs: Plan 5 activates the momentum, projectile, armour and charge moves by dropping `activatable` clauses (Task 13), and throws and pummels once the statuses read `ATTACK_ABS`/`set_catch_only_all` (Task 7).
- **Plan 4 (final, 23 tasks):** `ENGINE_RULES_VERSION = 4` (this plan sets **5** in Task 2, its first change to what `step()` does); `installBake` and `mergeSlots`, which put `LIMB_SCRIPT_SLOTS` (`limb.json`, via `withLimbScripts(def)`) into `GAME_ENGINE_RULES.activeSlots` and so into the online fingerprint; the bake (`public/bake/roster.bin.gz`, `BAKE_DIGEST`; status motions baked automatically, `statusMotion`/`statusMotionSpecs`); **SSBU sizes (D57)** — hurtboxes, the ECB and limb reach from bones, `hurt.allow.json`, `reach.allow.json` — so every Plan 5 test that touches a body (cargo carry, Inhale range, footstool contact, CPU spacing) was run at those sizes; `GAME_SIM_CONTEXT.bones` (the CPU's reach, Task 19); the overlay's head anchors (`render3d/anchors.ts`) and the 3D presenter's `paint(rs, camera, alpha, hidden)` (Task 17 hides a swallowed fighter through `hidden`; its Final Smash close-up is `cameraTarget`, which Plan 4's side camera follows); three.js only through `useWorld3d`'s `import()` (`chunkSplit.test.ts`: nothing here imports three); the 100-draw-call budget (every Plan 5 effect is a 2D overlay painter or a particle — Plan 4's route 1 — and adds no mesh).

**How Plan 5 meets Plan 4's fingerprint rule.** The specials Plan 5 builds keep their legacy frames (`activatable`'s `PLAN5_BEHAVIOUR` clause, Task 13), so their numbers live in the fighter definitions and change only with `ENGINE_RULES_VERSION`. Every imported script Plan 5 switches on goes through the rule: root-bone slots into `ACTIVE_SCRIPT_SLOTS`, limb-bone slots into `limb.json` (regenerated with `UPDATE_LIMB`), and Plan 4's `installBake` merges both into the rules `engineFingerprint` hashes.

DECISIONS: Plan 1 D54, Plan 2 D55, Plan 3 D56, Plan 4 D57, this plan **D58**.

**Goal:** Implement every special research §2 lists as "data but no engine code" — reflectors, counters, Mario's Cape, F.L.U.D.D., Donkey Kong's cargo, Kirby's Inhale, Samus's stored Charge Shot (and every other charge-on-B special), wall jumps, footstools and crawling — plus a Final Smash for each of the eight fighters, from published numbers; teach the CPU to use all of it (and to tech, escape hitstun and parry) while `cpuInput` stays pure and deterministic; and add Ultimate's control options a player expects: Stick Jump, a gamepad remap on `/controls`, and the right stick as smash attack or special.

**Architecture:** Everything that changes a match is simulation state, so rollback and online play cover it with no new mechanism. Per-fighter state goes in Plan 3's `CombatState` (stored charge, reflect hold, counter damage, copy ability, wall contact, footstool timer, control options); shared state in `GameState` (`cinematic`); projectiles learn their `source` fighter and `charge`. New behaviour lives in small engine modules called from `step()` at fixed points — `reflectProjectiles` before clanks, `triggerCounter` inside `resolveHits`, `resolveThrows`/`resolveInhaleReleases` after hits, `updateCinematic` after the state machines — and in new statuses registered the Plan 2 way (cargo carry and held, inhale hold, swallowed, spat star, footstooled, crawl, Final Smash trapped), each baked as a motion by Plan 4's bake. A Final Smash's cutscene is played in the sim: `GameState.cinematic` freezes everyone but the user and the trapped. The CPU gains `src/ai/specials.ts` and three defensive behaviours, all reading `ctx.rolls` only. Control options that change the sim travel with the match (`CombatState.controls`, the online start config); the gamepad remap is local input mapping and never crosses the wire.

**Tech Stack:** TypeScript 5 (strict), Next.js 16.3 static export, React 19, zustand, vitest 4.1 (jsdom, @testing-library/react), Playwright 1.62 (Chromium), pnpm 11. Nothing new is installed.

**Spec:** docs/superpowers/specs/2026-10-24-david-smash-design.md (§3.1 constraints; §3.2 phase 5; §3.4 "each documented-but-unimplemented special in R§2 is implemented in phase 5")

**Conventions for every task** (as Plans 1–4)
- `pnpm …` commands run in `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates/super-smash`; paths in steps are relative to it.
- `git …` commands run from `/Users/fobrizzlemynizzle/Documents/Personal Projects/Replicates` with paths prefixed `super-smash/`, committing straight to `main`. Never `git add -A`; stage the exact paths listed. Never push without David's go.
- Every commit body ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- The full gate is `pnpm typecheck && pnpm lint && pnpm test`. e2e gates use `PORT=3107 pnpm test:e2e` (Plan 1's convention, including its single-rerun rule for a cold-start timeout).
- **New files are given in full. Edits to existing files are given as `diff` blocks** (unified diff, four lines of context, paths relative to `super-smash/`): apply each by hand, or save it and run `git apply --directory=super-smash <file>` from the Replicates root. Line numbers are the scratch tree's; the context lines and the symbols they name are what to match.
- **Generated artefacts** follow Plans 2–4's `UPDATE_*=1` pattern and are regenerated, never hand-edited, in this order when several change: `UPDATE_LIMB` → `UPDATE_RECONCILE` → `UPDATE_BAKE` → `UPDATE_REACH` → `UPDATE_GOLDEN` (the limb list feeds the reconcile list and the bake; the bake feeds reach). Each step shows the scratch result (the allowlists' and the bake digest's diffs) so a different result stops the executor instead of being committed. The golden trace is regenerated only where a task deliberately changes behaviour, and the step names which of its four traces must change and why.
- Gameplay numbers come only from published sources: SmashWiki's per-move and Moveset pages, rubendal's SSBU Data Viewer scripts (13.0.1), UltimateFrameData and Kurogane Hammer. A number no source publishes is written beside an `UNVERIFIED:` comment saying what stands in for it.

**Sources (read 2026-10-24, rechecked 2026-10-25 after review).** SmashWiki: "Fox (SSBU)/Down special", "Mario (SSBU)/Side special" and "/Down special", "Marth (SSBU)/Down special" and "/Neutral special", "Kirby (SSBU)/Side special", "Donkey Kong (SSBU)/Forward throw" and "/Neutral special", "Kirby (SSBU)/Neutral special", "Copy ability", "Samus (SSBU)/Neutral special", "Link (SSBU)/Neutral special", "Pikachu (SSBU)/Side special", "Mario (SSBU)/Final Smash", "Reflect" ("projectiles can only be reflected up to 7 times"), "Reverse", "Final Smash", "Smash Ball" (standby; "drop" the ball when hit), "Zero Laser", "Ultra Sword" ("a total of 40% damage"), "Team Star Fox", "Volt Tackle", "Critical Hit", "Wall jump" (its Ultimate height ranking), "Footstool jump", "Crawling", "Intangibility", "Air dodge", and the "Stick jump" control option. rubendal's Data Viewer 13.0.1 (`Scripts`, `Articles`, `Motions` with `CancelFrame`) for every `game_special*`, `game_throw*` and `game_final*` script cited; UltimateFrameData for Samus's Charge Shot (125 frames to full: 112 of charge after the 13-frame start). **Not published anywhere found:** the Reflector's maximum hold, the Cape's once-per-airtime rule, Donkey Kong's and Kirby's jump while holding, most Final Smash per-hit damage outside the scripts (Zero Laser, Team Star Fox, Volt Tackle, Critical Hit totals), whether the Smash Ball's power has a time limit (SmashWiki gives the Final Smash Meter's "about 20 seconds" and none for the ball) or is lost on a KO, how hard a hit must be to drop it, the wall jump's push away and its windows, footstool reach, bounce and stun, footstools on a fighter in hitstun, a counter against a windbox or a Final Smash, the Smash Ball's float bounds, and Final Smash box offsets; each is an `UNVERIFIED:` stand-in.

**What was verified in scratch before writing** (`/private/tmp/claude-501/-Users-fobrizzlemynizzle-Documents-Personal-Projects/1b5c93cf-4a75-4d9f-92bb-6a571bd2578b/scratchpad/plan5-a7d3/ws5`: a copy of Plan 4's finished scratch tree `plan4-6258/ws4` — Plan 3's final `plan3b` with Plan 4 applied, `ENGINE_RULES_VERSION` 4, the real bake and SSBU sizes — with a real, private `node_modules`, and this plan's 23 tasks applied on top as one commit each, rebuilt after the independent review): every code block below was copied from that tree by `git show`, where `pnpm typecheck`, `pnpm lint` (0 errors; the two pre-existing warnings in `research/`) and `pnpm test` pass after every task — at the end **159 files, 3,380 tests passed, 1 skipped** (Plan 4's Blender cross-check). Each task's failing step was replayed on the final tree (its tests against the code before it) and its message copied; each regenerated artefact (limb list, reconcile and reach allowlists, the bake digest, the golden trace) is what that tree produced. The whole e2e suite ran in headless Chromium against `next dev` (24 passed, 7 skipped by design, including Task 22's four). Three stand-in commits carry text from Plans 1 and 4 the scratch tree lacked, copied from those plans: Plan 1 Task 16's `gamepad.ts` (before Task 21), Plan 1 Tasks 17/21's pad wiring on `/play` with Task 21's `mappingForPort` edit (before Task 22, so its e2e could run), and Plan 4 Task 23's D57 (before Task 23, which anchors D58 on it). **Not run:** Plan 1's final online page, online store and online character select (Task 20's and Task 21's edits to them are given by symbol, and the logic was run against the scratch tree's versions), real SSBU glbs (Plan 4's Blender STOP; the 3D presenter ran with stand-ins), and a two-browser online match.

---

## Global Constraints

(Spec §3.1, verbatim.)

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

Plan-5 specifics that follow from them: browser storage holds only per-player conveniences (Stick Jump and pad settings, read defensively), never match state; every new engine module (`specialCharge.ts`, `reflect.ts`, `counter.ts`, `held.ts`, `inhale.ts`, `wallJump.ts`, `footstool.ts`, `final.ts`, the new statuses) uses Q12 integers and `nextRandom` on `GameState.rngSeed` only — `layering.test.ts` passes with its forbidden list unchanged (it forbids the word `window`, so the reflector's active frames are `ReflectorDef.active`); no Nintendo file is added (the Final Smash and special effects are painters and particles); online peers on different `ENGINE_RULES_VERSION`s refuse to start a match together.

## Review Focus

Five ways a player gets hurt that no feature test in this plan would catch on its own, and the test that owns each:

1. **A projectile reflected back is reflected again** (two Foxes, or Fox and Mario's Cape, bouncing a laser). Each reflection must take the new reflector's multipliers, change owner, keep the projectile's moveset, and stop after seven — not loop forever or grow without bound. Test: `src/fighters/reflect.test.ts` "Review Focus: a reflected projectile reflected again" — "bounces between two reflectors, stacking ×1.4 each time, and is gone after seven" (Task 3).
2. **Marth counters a projectile.** The projectile must be consumed, Marth unhurt, and the thrower not frozen (a projectile's thrower takes no hitlag), with the riposte whiffing at range rather than teleporting. Test: `src/fighters/counter.test.ts` "Review Focus: counter against a projectile" — "catches Mario's fireball: the fireball is gone, Marth is untouched, and the riposte whiffs at range" (Task 5).
3. **A Final Smash during an online rollback.** A misprediction before or inside the trap must re-simulate to the identical state, scene and launch included — the cutscene is sim state, not presentation. Test: `src/engine/final.test.ts` "Review Focus: a Final Smash under rollback" — "replays the scene to the same state after a misprediction on either side of the trap" (Task 14).
4. **Inhale at the ledge.** Kirby must not swallow a fighter hanging from the ledge, and Kirby with a mouthful must not grab the ledge (the swallowed fighter would be stranded inside a fighter on the ledge). Test: `src/fighters/inhale.test.ts` "Review Focus: Inhale at the ledge" — "does not take a fighter hanging from the ledge, and leaves them hanging" (Task 9).
5. **The CPU and the Smash Ball.** A CPU must go and break the ball, then actually use its Final Smash — not knock the ball off stage for good, chase it into the blast zone, or sit on the power. Tests: `src/ai/specials.test.ts` "Review Focus: a CPU and the Smash Ball" — "goes and breaks the Smash Ball, then uses its Final Smash" and `src/engine/smashBall.test.ts` (Task 19).

---

## File Structure

Created:
- `src/engine/specialCharge.test.ts` (Task 2)
- `src/engine/specialCharge.ts` (Task 2)
- `src/fighters/charge.test.ts` (Task 2)
- `src/engine/reflect.test.ts` (Task 3)
- `src/engine/reflect.ts` (Task 3)
- `src/fighters/reflect.test.ts` (Task 3)
- `src/fighters/cape.test.ts` (Task 4)
- `src/engine/counter.ts` (Task 5)
- `src/fighters/counter.test.ts` (Task 5)
- `src/fighters/fludd.test.ts` (Task 6)
- `src/fighters/acmd/lift.ts` (Task 7)
- `src/fighters/throws.test.ts` (Task 7)
- `src/engine/held.ts` (Task 8)
- `src/engine/status/cargo.ts` (Task 8)
- `src/fighters/cargo.test.ts` (Task 8)
- `src/engine/inhale.test.ts` (Task 9)
- `src/engine/inhale.ts` (Task 9)
- `src/engine/status/inhale.ts` (Task 9)
- `src/fighters/inhale.test.ts` (Task 9)
- `src/engine/wallJump.ts` (Task 10)
- `src/fighters/walljump.test.ts` (Task 10)
- `src/engine/footstool.ts` (Task 11)
- `src/fighters/footstool.test.ts` (Task 11)
- `src/fighters/crawl.test.ts` (Task 12)
- `src/fighters/acmd/activate.test.ts` (Task 13)
- `src/engine/final.test.ts` (Task 14)
- `src/engine/final.ts` (Task 14)
- `src/fighters/finalKit.ts` (Task 15)
- `src/fighters/finalSmash.test.ts` (Task 15)
- `src/render/plan5.test.ts` (Task 17)
- `src/ai/defence.test.ts` (Task 18)
- `src/ai/specials.test.ts` (Task 19)
- `src/ai/specials.ts` (Task 19)
- `src/engine/smashBall.test.ts` (Task 19)
- `src/components/menu/PlayerOptions.test.tsx` (Task 20)
- `src/components/menu/PlayerOptions.tsx` (Task 20)
- `src/engine/controls.test.ts` (Task 20)
- `src/components/ControlPrefsSync.test.tsx` (Task 21)
- `src/components/ControlPrefsSync.tsx` (Task 21)
- `src/components/menu/PadOptions.test.tsx` (Task 21)
- `src/components/menu/PadOptions.tsx` (Task 21)
- `src/input/padRemap.test.ts` (Task 21)
- `src/lib/controlPrefs.test.ts` (Task 21)
- `src/lib/controlPrefs.ts` (Task 21)
- `e2e/padOptions.spec.ts` (Task 22)

Modified:
- `DECISIONS.md` (Task 23)
- `README.md` (Task 23)
- `public/bake/roster.bin.gz` (Tasks 2, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16)
- `src/ai/behaviours.test.ts` (Tasks 1, 18, 19)
- `src/ai/behaviours.ts` (Tasks 18, 19)
- `src/ai/cpu.test.ts` (Task 1)
- `src/ai/cpu.ts` (Tasks 18, 19)
- `src/app/layout.tsx` (Task 21)
- `src/app/play/page.tsx` (Task 20)
- `src/components/menu/ControlsPanel.tsx` (Tasks 20, 21)
- `src/engine/acmd/hitboxes.ts` (Tasks 4, 6, 7)
- `src/engine/acmd/interpreter.ts` (Task 7)
- `src/engine/acmd/legacy.test.ts` (Tasks 7, 8)
- `src/engine/acmd/legacy.ts` (Tasks 4, 5, 6, 7, 8, 9, 14, 16)
- `src/engine/acmd/run.ts` (Task 13)
- `src/engine/acmd/types.ts` (Task 7)
- `src/engine/combat.ts` (Tasks 2, 3, 5, 9, 10, 11, 14, 20)
- `src/engine/constants.ts` (Tasks 2, 12, 14)
- `src/engine/final.ts` (Task 15)
- `src/engine/footstool.ts` (Task 14)
- `src/engine/hash.test.ts` (Task 1)
- `src/engine/hash.ts` (Tasks 1, 2, 3, 5, 9, 10, 11, 14, 20)
- `src/engine/held.ts` (Tasks 9, 14)
- `src/engine/projectile.test.ts` (Task 1)
- `src/engine/projectile.ts` (Tasks 1, 2, 9, 16)
- `src/engine/reflect.ts` (Task 4)
- `src/engine/simulate.test.ts` (Task 1)
- `src/engine/simulate.ts` (Tasks 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 16, 19, 20)
- `src/engine/states.test.ts` (Task 2)
- `src/engine/states.ts` (Tasks 2, 3, 8, 9, 10, 11, 12, 13, 14, 20)
- `src/engine/status/air.ts` (Tasks 10, 11)
- `src/engine/status/attack.ts` (Tasks 2, 3, 4, 8, 13, 14, 15)
- `src/engine/status/cargo.ts` (Task 9)
- `src/engine/status/damage.ts` (Tasks 11, 14)
- `src/engine/status/ground.ts` (Task 12)
- `src/engine/status/groups.test.ts` (Tasks 8, 9, 11, 12, 14)
- `src/engine/status/index.ts` (Tasks 8, 9)
- `src/engine/status/kind.ts` (Tasks 8, 9, 11, 12, 14)
- `src/engine/status/passive.ts` (Task 10)
- `src/engine/status/status.test.ts` (Tasks 8, 9, 11, 12, 14)
- `src/engine/types.ts` (Tasks 1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 14, 15, 16, 20)
- `src/fighters/acmd/activate.test.ts` (Tasks 14, 16)
- `src/fighters/acmd/active.test.ts` (Task 7)
- `src/fighters/acmd/active.ts` (Tasks 2, 7, 8, 13, 14, 16)
- `src/fighters/acmd/lift.ts` (Task 13)
- `src/fighters/acmd/limb.json` (Tasks 7, 13)
- `src/fighters/acmd/limb.test.ts` (Task 7)
- `src/fighters/acmd/reach.allow.json` (Tasks 7, 13)
- `src/fighters/acmd/reconcile.allow.json` (Tasks 2, 4, 5, 7, 13, 15, 16)
- `src/fighters/bake/digest.ts` (Tasks 2, 5, 6, 7, 8, 9, 11, 12, 13, 14, 15, 16)
- `src/fighters/donkeyKong.ts` (Tasks 2, 8, 15)
- `src/fighters/finalSmash.test.ts` (Task 16)
- `src/fighters/footstool.test.ts` (Task 14)
- `src/fighters/fox.ts` (Tasks 3, 4, 10, 15)
- `src/fighters/index.test.ts` (Task 2)
- `src/fighters/kirby.ts` (Tasks 2, 9, 15)
- `src/fighters/link.ts` (Tasks 2, 3, 16)
- `src/fighters/mario.ts` (Tasks 3, 4, 6, 10, 16)
- `src/fighters/marth.ts` (Tasks 2, 5, 15)
- `src/fighters/pikachu.ts` (Tasks 2, 3, 10, 12, 15)
- `src/fighters/samus.ts` (Tasks 2, 3, 10, 16)
- `src/fighters/schema.test.ts` (Tasks 2, 6, 9, 15, 16)
- `src/game/__golden__/engine-trace.json` (Tasks 2, 7, 13, 18, 19)
- `src/game/golden.test.ts` (Task 19)
- `src/game/matchRunner.test.ts` (Task 19)
- `src/game/matchRunner.ts` (Task 19)
- `src/game/onlineConfig.test.ts` (Tasks 20, 21)
- `src/game/onlineConfig.ts` (Task 20)
- `src/game/simContext.test.ts` (Task 2)
- `src/input/gamepad.ts` (Task 21)
- `src/lib/matchConfig.ts` (Tasks 20, 21)
- `src/lib/onlineStore.test.ts` (Task 20)
- `src/lib/onlineStore.ts` (Task 20)
- `src/net/online/lobby.test.ts` (Task 20)
- `src/net/online/lobby.ts` (Task 20)
- `src/render/camera.ts` (Task 17)
- `src/render/chars/donkeyKong/fx.ts` (Task 2)
- `src/render/chars/link/fx.ts` (Task 16)
- `src/render/chars/mario/poses.ts` (Tasks 6, 13)
- `src/render/chars/marth/fx.ts` (Task 2)
- `src/render/chars/samus/fx.ts` (Task 2)
- `src/render/chars/samus/samus.test.ts` (Task 2)
- `src/render/poses/timing.ts` (Tasks 5, 8, 9, 11, 12, 14)
- `src/render/renderer.ts` (Task 17)
- `src/render/specialFx.test.ts` (Task 2)
- `src/render/testFixtures.ts` (Task 1)
- `src/render/vfx.ts` (Task 17)

---

### Task 1: Projectiles know their source and charge; the game state knows a cinematic

Three things every later task leans on. A reflected projectile changes owner but keeps the moveset that defines it, so `ProjectileState` gains `source` (the fighter id whose `projectiles` holds its def), `charge` (a Q12 fraction, for Charge Shot and the bow) and `reflected` (a count; Task 3 caps it). `GameState.cinematic` (−1 when none) is where Task 14 records a Final Smash's scene. All three are cloned and hashed; `hash.test.ts`'s walker covers every leaf.

**Files:**
- Modify: `super-smash/src/ai/behaviours.test.ts`, `super-smash/src/ai/cpu.test.ts`, `super-smash/src/engine/hash.test.ts`, `super-smash/src/engine/hash.ts`, `super-smash/src/engine/projectile.test.ts`, `super-smash/src/engine/projectile.ts`, `super-smash/src/engine/simulate.test.ts`, `super-smash/src/engine/simulate.ts`, `super-smash/src/engine/types.ts`, `super-smash/src/render/testFixtures.ts`

**Interfaces:**
- Consumes: `spawnProjectile`, `ProjectileState` (`src/engine/projectile.ts`), `cloneState`, `hashState` (Plan 2).
- Produces: `ProjectileState.source: string`, `.charge: number`, `.reflected: number`; `GameState.cinematic: number`; `spawnProjectile(def, owner, instanceId, source = owner.defId)` (sets `charge: chargeFraction(owner.charge, SMASH_CHARGE_MAX)`); `chargeFraction(charge, frames)`; `projectileDefOf(ctx, p)` (simulate.ts, looks a projectile's def up by `source`).

- [ ] **Step 1: Write the failing tests**

`src/ai/behaviours.test.ts` — apply:

```diff
--- a/src/ai/behaviours.test.ts
+++ b/src/ai/behaviours.test.ts
@@ -101,8 +101,9 @@ function gameState(fighters: FighterState[], over: Partial<GameState> = {}): Gam
     smashBall: { active: false, x: 0, y: 0, vx: 0, vy: 0, health: 0, driftTimer: 0 },
     timeRemaining: 0,
     outcome: null,
     freezeFrames: 0,
+    cinematic: -1,
     ...over,
   };
 }
 
```

`src/ai/cpu.test.ts` — apply:

```diff
--- a/src/ai/cpu.test.ts
+++ b/src/ai/cpu.test.ts
@@ -75,8 +75,9 @@ function gameState(fighters: FighterState[], over: Partial<GameState> = {}): Gam
     smashBall: { active: false, x: 0, y: 0, vx: 0, vy: 0, health: 0, driftTimer: 0 },
     timeRemaining: 0,
     outcome: null,
     freezeFrames: 0,
+    cinematic: -1,
     ...over,
   };
 }
 
```

`src/engine/hash.test.ts` — apply:

```diff
--- a/src/engine/hash.test.ts
+++ b/src/engine/hash.test.ts
@@ -71,8 +71,11 @@ function projectile(over: Partial<ProjectileState> = {}): ProjectileState {
     bouncesLeft: 0,
     chargeScale: fx(1),
     hitPorts: [],
     returning: false,
+    source: "link",
+    charge: 0,
+    reflected: 0,
     ...over,
   };
 }
 
@@ -88,8 +91,9 @@ function state(over: Partial<GameState> = {}): GameState {
     smashBall: { active: false, x: 0, y: 0, vx: 0, vy: 0, health: 0, driftTimer: 0 },
     timeRemaining: 0,
     outcome: null,
     freezeFrames: 0,
+    cinematic: -1,
     ...over,
   };
 }
 
@@ -147,8 +151,9 @@ describe("hashState", () => {
       ["rngSeed", (s) => (s.rngSeed += 1)],
       ["stageId", (s) => (s.stageId = "final-destination")],
       ["timeRemaining", (s) => (s.timeRemaining += 1)],
       ["freezeFrames", (s) => (s.freezeFrames += 1)],
+      ["cinematic", (s) => (s.cinematic = 1)],
       ["nextProjectileId", (s) => (s.nextProjectileId += 1)],
       ["rules.mode", (s) => (s.rules = { ...s.rules, mode: "time" })],
       ["rules.stocks", (s) => (s.rules = { ...s.rules, stocks: 2 })],
       ["rules.smashBall", (s) => (s.rules = { ...s.rules, smashBall: false })],
@@ -269,8 +274,11 @@ describe("hashState", () => {
     expect(withProjectile({ bouncesLeft: 1 })).not.toBe(base);
     expect(withProjectile({ chargeScale: fx(2) })).not.toBe(base);
     expect(withProjectile({ hitPorts: [1] })).not.toBe(base);
     expect(withProjectile({ returning: true })).not.toBe(base);
+    expect(withProjectile({ source: "samus" })).not.toBe(base);
+    expect(withProjectile({ charge: fx(0.5) })).not.toBe(base);
+    expect(withProjectile({ reflected: 1 })).not.toBe(base);
   });
 
   it("distinguishes two fighters swapped between ports", () => {
     const a = state();
```

`src/engine/projectile.test.ts` — apply:

```diff
--- a/src/engine/projectile.test.ts
+++ b/src/engine/projectile.test.ts
@@ -591,8 +591,43 @@ describe("projectiles and rollback", () => {
     expect(hashState(replay)).toBe(hashState(live));
   });
 });
 
+describe("where a projectile comes from (Plan 5)", () => {
+  it("names the fighter whose moveset defines it, so a new owner can still find it", () => {
+    const p = spawnProjectile(ARROW, fighter({ defId: "zoner" }), 1);
+    expect(p.source).toBe("zoner");
+    expect(p.reflected).toBe(0);
+    expect(p.charge).toBe(0);
+  });
+
+  it("can be told a different source, for a move borrowed from another fighter", () => {
+    expect(spawnProjectile(ARROW, fighter({ defId: "zoner" }), 1, "mario").source).toBe("mario");
+  });
+
+  it("records the fraction of a full charge it was launched with", () => {
+    expect(spawnProjectile(CHARGE_SHOT, fighter({ charge: SMASH_CHARGE_MAX }), 1).charge).toBe(ONE);
+    expect(spawnProjectile(CHARGE_SHOT, fighter({ charge: SMASH_CHARGE_MAX / 2 }), 1).charge).toBe(ONE / 2);
+  });
+
+  it("copies every field of a projectile, and hashes every one of them", () => {
+    const p = spawnProjectile(ARROW, fighter(), 1);
+    const c = cloneProjectile(p);
+    expect(Object.keys(c).sort()).toEqual(Object.keys(p).sort());
+    const s = fire(standing(fx(200)), [Btn.Special, 0], 6);
+    for (const [name, mutate] of [
+      ["source", (q: GameState) => (q.projectiles[0].source = "other")],
+      ["charge", (q: GameState) => (q.projectiles[0].charge += 1)],
+      ["reflected", (q: GameState) => (q.projectiles[0].reflected += 1)],
+    ] as const) {
+      const q = cloneState(s);
+      mutate(q);
+      expect(hashState(q), `hash ignored projectile.${name}`).not.toBe(hashState(s));
+      expect(cloneState(q).projectiles[0], `clone dropped projectile.${name}`).toEqual(q.projectiles[0]);
+    }
+  });
+});
+
 describe("def lookup", () => {
   it("finds a projectile by id across the whole moveset", () => {
     expect(findProjectileDef(DEF, "arrow")).toBe(ARROW);
     expect(findProjectileDef(DEF, "bomb")).toBe(BOMB);
```

`src/engine/simulate.test.ts` — apply:

```diff
--- a/src/engine/simulate.test.ts
+++ b/src/engine/simulate.test.ts
@@ -209,8 +209,12 @@ describe("createInitialState", () => {
     expect(s.fighters[0].facing).toBe(1);
     expect(s.fighters[1].facing).toBe(-1);
   });
 
+  it("starts with no Final Smash cinematic playing (Plan 5)", () => {
+    expect(newState().cinematic).toBe(-1);
+  });
+
   it("starts a timed match with its clock full", () => {
     const s = newState({ ...RULES, mode: "time", timeLimit: 60 * 60 });
     expect(s.timeRemaining).toBe(60 * 60);
   });
@@ -260,8 +264,14 @@ describe("cloneState", () => {
     };
     check(s.fighters, c.fighters, "fighters");
   });
 
+  it("copies the cinematic port (Plan 5)", () => {
+    const s = standing();
+    s.cinematic = 1;
+    expect(cloneState(s).cinematic).toBe(1);
+  });
+
   it("copies the rules and the Smash Ball rather than aliasing them", () => {
     const s = standing();
     const c = cloneState(s);
     c.smashBall.x = fx(99);
```

`src/render/testFixtures.ts` — apply:

```diff
--- a/src/render/testFixtures.ts
+++ b/src/render/testFixtures.ts
@@ -96,8 +96,9 @@ export function makeState(over: Partial<GameState> = {}): GameState {
     nextProjectileId: 1,
     timeRemaining: 60 * 60 * 3,
     outcome: null,
     freezeFrames: 0,
+    cinematic: -1,
     ...over,
   };
 }
 
@@ -115,8 +116,11 @@ export function makeProjectile(over: Partial<ProjectileState> = {}): ProjectileS
     bouncesLeft: 0,
     chargeScale: ONE,
     hitPorts: [],
     returning: false,
+    source: "link",
+    charge: 0,
+    reflected: 0,
     ...over,
   };
 }
 
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/ai/behaviours.test.ts src/ai/cpu.test.ts src/engine/hash.test.ts src/engine/projectile.test.ts src/engine/simulate.test.ts`
Expected: FAIL — 8 failed | 168 passed — `expected undefined to be 'zoner'` and `expected undefined to be 'mario'` (projectile.source), `expected undefined to be -1` (cinematic), `expected 1791913040 not to be 1791913040` (the hash ignores the new fields).

- [ ] **Step 3: Implement**

`src/engine/hash.ts` — apply:

```diff
--- a/src/engine/hash.ts
+++ b/src/engine/hash.ts
@@ -219,8 +219,11 @@ export function mixProjectile(h: number, p: ProjectileState): number {
   x = mixInt(x, p.chargeScale);
   x = mixInt(x, p.hitPorts.length);
   for (const port of p.hitPorts) x = mixInt(x, port);
   x = mixBool(x, p.returning);
+  x = mixString(x, p.source);
+  x = mixInt(x, p.charge);
+  x = mixInt(x, p.reflected);
   return x;
 }
 
 /**
@@ -239,8 +242,9 @@ export function hashState(state: GameState): number {
   h = mixRules(h, state.rules);
   h = mixSmashBall(h, state.smashBall);
   h = mixInt(h, state.timeRemaining);
   h = mixInt(h, state.freezeFrames);
+  h = mixInt(h, state.cinematic);
   if (state.outcome === null) {
     h = mixInt(h, 0);
   } else {
     h = mixString(h, state.outcome.kind);
```

`src/engine/projectile.ts` — apply:

```diff
--- a/src/engine/projectile.ts
+++ b/src/engine/projectile.ts
@@ -87,8 +87,9 @@ export function projectileChargeScale(def: ProjectileDef, charge: number): numbe
 export function spawnProjectile(
   def: ProjectileDef,
   owner: FighterState,
   instanceId: number,
+  source: string = owner.defId,
 ): ProjectileState {
   const facing = owner.facing >= 0 ? 1 : -1;
   const chargeScale = projectileChargeScale(def, owner.charge);
   return {
@@ -104,11 +105,20 @@ export function spawnProjectile(
     bouncesLeft: def.bounces ?? 0,
     chargeScale,
     hitPorts: [],
     returning: false,
+    source,
+    charge: chargeFraction(owner.charge, SMASH_CHARGE_MAX),
+    reflected: 0,
   };
 }
 
+/** `charge` of `frames` as a Q12 fraction of a full charge, clamped to [0, ONE]. */
+export function chargeFraction(charge: number, frames: number): number {
+  if (charge <= 0 || frames <= 0) return 0;
+  return Math.trunc((Math.min(charge, frames) * ONE) / frames);
+}
+
 /** The projectiles a move launches on this frame of its animation. */
 export function projectilesDueOnFrame(move: MoveDef, moveFrame: number): readonly ProjectileDef[] {
   if (move.projectiles === undefined) return [];
   return move.projectiles.filter((p) => p.spawnFrame === moveFrame);
@@ -239,6 +249,9 @@ export function cloneProjectile(p: ProjectileState): ProjectileState {
     // Sliced, not shared: a snapshot whose `hitPorts` is the live array is a
     // rollback that silently remembers hits that were rewound.
     hitPorts: p.hitPorts.slice(),
     returning: p.returning,
+    source: p.source,
+    charge: p.charge,
+    reflected: p.reflected,
   };
 }
```

`src/engine/simulate.ts` — apply:

```diff
--- a/src/engine/simulate.ts
+++ b/src/engine/simulate.ts
@@ -149,8 +149,9 @@ import type {
   Hitbox,
   InputFrame,
   MatchRules,
   MoveSlot,
+  ProjectileDef,
   ProjectileState,
   StageDef,
   StepEvents,
 } from "./types";
@@ -312,8 +313,9 @@ export function cloneState(state: GameState): GameState {
       state.outcome === null
         ? null
         : { kind: state.outcome.kind, placings: state.outcome.placings.slice() },
     freezeFrames: state.freezeFrames,
+    cinematic: state.cinematic,
   };
 }
 
 /* --------------------------------------------------------------- startup -- */
@@ -405,8 +407,9 @@ export function createInitialState(
     smashBall: { active: false, x: 0, y: 0, vx: 0, vy: 0, health: 0, driftTimer: 0 },
     timeRemaining: rules.mode === "time" ? rules.timeLimit : 0,
     outcome: null,
     freezeFrames: 0,
+    cinematic: -1,
   };
 }
 
 /* ------------------------------------------------------------------ step -- */
@@ -665,14 +668,14 @@ export function step(
   /* -- 6. hitboxes: gather, clank, connect --------------------------------- */
 
   // Projectiles fly, then this frame's launches join them, then everything —
   // fists and arrows alike — goes through one clank pass and one hit pass.
-  const projectilePrev = advanceProjectiles(s, defs, stage);
+  const projectilePrev = advanceProjectiles(s, ctx, stage);
   spawnDueProjectiles(s, defs, beforeActionFrame, projectilePrev);
 
   const destroyed = new Set<number>();
   const candidates = gatherHitboxes(s, defs, prevPos, frozen, bones);
-  appendProjectileCandidates(s, defs, candidates, projectilePrev);
+  appendProjectileCandidates(s, ctx, candidates, projectilePrev);
   resolveClanks(s, candidates, events, destroyed);
   resolveHits(s, defs, bake, bones, candidates, intents, events, destroyed);
   if (destroyed.size > 0) {
     s.projectiles = s.projectiles.filter((p) => !destroyed.has(p.instanceId));
@@ -793,23 +796,26 @@ function gatherHitboxes(
 /* ----------------------------------------------------------- projectiles -- */
 
 type PrevPositions = Map<number, { x: number; y: number }>;
 
+/**
+ * A projectile's definition, from the fighter whose moveset holds it (`source`)
+ * rather than from whoever owns it now (Plan 5: reflectors, Kirby's copy).
+ */
+function projectileDefOf(ctx: SimContext, p: ProjectileState): ProjectileDef | undefined {
+  return findProjectileDef(ctx.fighter(p.source), p.defId);
+}
+
 /**
  * Fly every projectile one frame and drop the ones that ran out of life, stage
  * or bounces. Returns where each was before it moved, for the swept hit test.
  */
-function advanceProjectiles(
-  s: GameState,
-  defs: readonly FighterDef[],
-  stage: StageDef,
-): PrevPositions {
+function advanceProjectiles(s: GameState, ctx: SimContext, stage: StageDef): PrevPositions {
   const prev: PrevPositions = new Map();
   if (s.projectiles.length === 0) return prev;
   const survivors: ProjectileState[] = [];
   for (const p of s.projectiles) {
-    const ownerDef = defs[p.owner];
-    const def = ownerDef === undefined ? undefined : findProjectileDef(ownerDef, p.defId);
+    const def = projectileDefOf(ctx, p);
     if (def === undefined) continue;
     const owner = s.fighters[p.owner] ?? null;
     const moved = advanceProjectile(p, def, stage, owner, s.frame);
     prev.set(p.instanceId, { x: moved.prevX, y: moved.prevY });
@@ -849,15 +855,14 @@ function spawnDueProjectiles(
 
 /** Add every live projectile hitbox to the same candidate list as the fists. */
 function appendProjectileCandidates(
   s: GameState,
-  defs: readonly FighterDef[],
+  ctx: SimContext,
   candidates: Candidate[],
   prev: PrevPositions,
 ): void {
   for (const p of s.projectiles) {
-    const ownerDef = defs[p.owner];
-    const def = ownerDef === undefined ? undefined : findProjectileDef(ownerDef, p.defId);
+    const def = projectileDefOf(ctx, p);
     if (def === undefined || !projectileHitboxActive(p, def)) continue;
     const was = prev.get(p.instanceId) ?? { x: p.x, y: p.y };
     const offsetX = p.facing >= 0 ? def.hitbox.x : -def.hitbox.x;
     candidates.push({
```

`src/engine/types.ts` — apply:

```diff
--- a/src/engine/types.ts
+++ b/src/engine/types.ts
@@ -597,8 +597,18 @@ export interface ProjectileState {
   /** Ports it has already hit, so one arrow cannot hit the same fighter twice. */
   hitPorts: number[];
   /** Flipped once a returning projectile turns around. */
   returning: boolean;
+  /**
+   * The fighter whose moveset defines `defId` (Plan 5). Not `owner`: a reflector
+   * makes a projectile its own, and Kirby's copied neutral special launches
+   * another fighter's projectile, so the definition is looked up here.
+   */
+  source: string;
+  /** The fraction of a full charge it was launched with, Q12 (`ONE` = full). Plan 5. */
+  charge: number;
+  /** How many times it has been reflected. SmashWiki "Reflect": seven at most. Plan 5. */
+  reflected: number;
 }
 
 export interface SmashBallState {
   active: boolean;
@@ -654,8 +664,15 @@ export interface GameState {
   /** null while playing; set once the match resolves. */
   outcome: MatchOutcome | null;
   /** Frames of global hitstop, for the dramatic freeze on a heavy hit. */
   freezeFrames: number;
+  /**
+   * The port whose Final Smash cinematic is playing, or -1 (Plan 5). While one
+   * plays, only that fighter and the fighters it trapped advance — everybody
+   * else, every projectile and the Smash Ball wait — exactly as SSBU pauses the
+   * match for the cutscene. It is state, so a rollback replays it.
+   */
+  cinematic: number;
 }
 
 export interface MatchOutcome {
   readonly kind: "stockOut" | "timeUp" | "suddenDeath";
```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/ai/behaviours.test.ts src/ai/cpu.test.ts src/engine/hash.test.ts src/engine/projectile.test.ts src/engine/simulate.test.ts`
Expected: PASS.

- [ ] **Step 5: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0; golden trace untouched.

- [ ] **Step 6: Commit**

```bash
git add super-smash/src/ai/behaviours.test.ts super-smash/src/ai/cpu.test.ts super-smash/src/engine/hash.test.ts super-smash/src/engine/hash.ts super-smash/src/engine/projectile.test.ts super-smash/src/engine/projectile.ts super-smash/src/engine/simulate.test.ts super-smash/src/engine/simulate.ts super-smash/src/engine/types.ts super-smash/src/render/testFixtures.ts
git commit -m "super-smash: projectiles carry source, charge and reflections; GameState.cinematic" -m "A projectile's def is found through the fighter that defines it, not its current owner, so a reflected shot keeps its moveset. GameState.cinematic is -1 until Task 14. All new fields are cloned and hashed. Golden trace unchanged." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Specials charge on B: hold and store

SmashWiki and rubendal's scripts give each chargeable special's uncharged and fully charged numbers, its charge length and its "Charges between a–b" loop. Two modes: **store** (Samus's Charge Shot 112 frames — UltimateFrameData's 125 less the 13-frame loop start; Donkey Kong's Giant Punch 110) keeps a charge interrupted by shield or jump in `CombatState.storedCharge` and fires it on the next B; **hold** (Marth's Shield Breaker 60, loop 11; Kirby's Hammer Flip 120, loop "15-16"; Pikachu's Skull Bash 80, loop "13-14"; Link's bow 60, loop 15) releases on letting go. Below full each move grows by **its own published formula** (`PartialCharge`): Charge Shot linearly in damage, knockback and size ("linearly scaled"); Giant Punch `base + 18·c/110` rounded down; Shield Breaker's damage ×`1 + 1.2·c/60` (17.44% / 19.62% a frame before full); Hammer Flip +0.085% a frame (29.115% a frame before full); Skull Bash `6.2 + 15.2·c/80`; the bow `4 + 8·c/60` rounded down. At full the `full` values replace the boxes outright ("When fully charged, the hitboxes are instead changed directly"), angle included. This is Plan 5's first change to what `step()` does, so it also bumps `ENGINE_RULES_VERSION` to **5** (Plans 3–4's rule).

**Files:**
- Create: `super-smash/src/engine/specialCharge.test.ts`, `super-smash/src/engine/specialCharge.ts`, `super-smash/src/fighters/charge.test.ts`
- Modify: `super-smash/src/engine/combat.ts`, `super-smash/src/engine/constants.ts`, `super-smash/src/engine/hash.ts`, `super-smash/src/engine/projectile.ts`, `super-smash/src/engine/simulate.ts`, `super-smash/src/engine/states.test.ts`, `super-smash/src/engine/states.ts`, `super-smash/src/engine/status/attack.ts`, `super-smash/src/engine/types.ts`, `super-smash/src/fighters/acmd/active.ts`, `super-smash/src/fighters/donkeyKong.ts`, `super-smash/src/fighters/index.test.ts`, `super-smash/src/fighters/kirby.ts`, `super-smash/src/fighters/link.ts`, `super-smash/src/fighters/marth.ts`, `super-smash/src/fighters/pikachu.ts`, `super-smash/src/fighters/samus.ts`, `super-smash/src/fighters/schema.test.ts`, `super-smash/src/game/simContext.test.ts`, `super-smash/src/render/chars/donkeyKong/fx.ts`, `super-smash/src/render/chars/marth/fx.ts`, `super-smash/src/render/chars/samus/fx.ts`, `super-smash/src/render/chars/samus/samus.test.ts`, `super-smash/src/render/specialFx.test.ts`
- Regenerate: `super-smash/public/bake/roster.bin.gz`, `super-smash/src/fighters/acmd/reconcile.allow.json`, `super-smash/src/fighters/bake/digest.ts`, `super-smash/src/game/__golden__/engine-trace.json`

**Interfaces:**
- Consumes: `Intent` (Plan 2 `states.ts`), `STATUS_ATTACK` (`status/attack.ts`), `spawnProjectile` (Task 1).
- Produces: `src/engine/specialCharge.ts`: `chargedHitbox(base, full, fraction, partial?)`, `specialChargeMain(f, intent, ctx, sc)`; types `SpecialCharge { mode: "hold" | "store"; frames; loopFrame; full?; partial? }`, `PartialCharge` (`lerp` / `add` / `multiply`), `ChargedHitbox`, `ProjectileDef.charged?: { hitbox; vx; partial? }`, `MoveDef.specialCharge?`; `Intent.specialHeld`; `CombatState.storedCharge`; `projectileHitbox(p, def)`, `projectileChargeScale` (projectile.ts); `ENGINE_RULES_VERSION = 5`.

- [ ] **Step 1: Write the failing tests**

`src/engine/specialCharge.test.ts` (new file):

```ts
import { describe, expect, it } from "vitest";

import { ONE, fx, toFloat } from "./fixed";
import { chargedHitbox } from "./specialCharge";
import type { Hitbox } from "./types";

const BASE: Hitbox = {
  id: 0,
  startFrame: 1,
  endFrame: 60,
  x: 0,
  y: 0,
  radius: fx(1.9),
  damage: fx(5),
  angle: fx(361),
  baseKnockback: fx(14),
  knockbackGrowth: fx(42),
};
// Samus's Charge Shot, SmashWiki "Samus (SSBU)/Neutral special": 5 + 23·c/112,
// BK 14 + 32·c/112, KS 42 + 8·c/112, radius 1.9 + 6.1·c/112; 28% at angle 40 full.
const FULL = { damage: fx(28), angle: fx(40), baseKnockback: fx(46), knockbackGrowth: fx(50), radius: fx(8) };

describe("chargedHitbox", () => {
  it("is the authored hitbox uncharged", () => {
    expect(chargedHitbox(BASE, FULL, 0)).toEqual(BASE);
  });

  it("is the full-charge hitbox at a full charge, angle included", () => {
    const h = chargedHitbox(BASE, FULL, ONE);
    expect(h.damage).toBe(fx(28));
    expect(h.angle).toBe(fx(40));
    expect(h.baseKnockback).toBe(fx(46));
    expect(h.knockbackGrowth).toBe(fx(50));
    expect(h.radius).toBe(fx(8));
  });

  it("interpolates the numbers linearly, but keeps the uncharged angle until full", () => {
    const h = chargedHitbox(BASE, FULL, ONE / 2);
    expect(h.damage).toBe(fx(5) + Math.trunc((fx(28) - fx(5)) / 2));
    expect(h.baseKnockback).toBe(fx(14) + Math.trunc((fx(46) - fx(14)) / 2));
    expect(h.angle).toBe(fx(361));
  });

  it("leaves a hitbox with no full-charge entry alone", () => {
    expect(chargedHitbox(BASE, undefined, ONE)).toBe(BASE);
  });
});

describe("partly charged, per SmashWiki's formula for the move", () => {
  const SWORD: Hitbox = { ...BASE, damage: fx(9), angle: fx(361), baseKnockback: fx(60), knockbackGrowth: fx(100) };
  const t = (c: number, frames: number) => Math.trunc((c * ONE) / frames);

  it("multiplies the damage alone (Shield Breaker: 1 + 1.2·c/60, 19.62% a frame before full)", () => {
    const h = chargedHitbox(SWORD, { damage: fx(24) }, t(59, 60), { kind: "multiply", by: fx(1.2) });
    expect(toFloat(h.damage)).toBeCloseTo(19.62, 2);
    expect(h.baseKnockback).toBe(fx(60));
    expect(chargedHitbox(SWORD, { damage: fx(24) }, ONE, { kind: "multiply", by: fx(1.2) }).damage).toBe(fx(24));
  });

  it("adds to the damage alone (Hammer Flip: 0.085% a frame, 29.115% a frame before full, then 35%)", () => {
    const hammer: Hitbox = { ...BASE, damage: fx(19), angle: fx(48) };
    const near = chargedHitbox(hammer, { damage: fx(35), angle: fx(361) }, t(119, 120), { kind: "add", total: fx(10.2) });
    expect(toFloat(near.damage)).toBeCloseTo(29.115, 2);
    expect(near.angle).toBe(fx(48));
    const full = chargedHitbox(hammer, { damage: fx(35), angle: fx(361) }, ONE, { kind: "add", total: fx(10.2) });
    expect(full.damage).toBe(fx(35));
    expect(full.angle).toBe(fx(361));
  });

  it("rounds down to a whole percent where the formula does (Giant Punch: 10 + 18·c/110)", () => {
    const punch: Hitbox = { ...BASE, damage: fx(10) };
    const rule = { kind: "add", total: fx(18), floor: true } as const;
    expect(chargedHitbox(punch, { damage: fx(28) }, t(109, 110), rule).damage).toBe(fx(27));
    expect(chargedHitbox(punch, { damage: fx(28) }, t(30, 110), rule).damage).toBe(fx(14));
    expect(chargedHitbox(punch, { damage: fx(28) }, ONE, rule).damage).toBe(fx(28));
  });
});
```

`src/engine/states.test.ts` — apply:

```diff
--- a/src/engine/states.test.ts
+++ b/src/engine/states.test.ts
@@ -422,8 +422,9 @@ describe("tilt versus smash", () => {
       jumpHeld: false,
       attackPressed: false,
       attackHeld: false,
       specialPressed: false,
+      specialHeld: false,
       shieldHeld: false,
       shieldPressed: false,
       shieldReleased: false,
       grabPressed: false,
```

`src/fighters/charge.test.ts` (new file):

```ts
/**
 * Specials that charge, driven through the real `step()` with the real roster
 * (Plan 5, Task 2; the D32 rule: assert on what a player sees).
 *
 * Two kinds, as in SSBU:
 * - **hold**: the charge grows while B is held and the move fires on release —
 *   Hero's Bow, Shield Breaker, Hammer Flip, Skull Bash;
 * - **store**: the charge loops until B is pressed again; shield or jump puts
 *   it away for later, and a full charge stores itself — Charge Shot, Giant
 *   Punch (and F.L.U.D.D. in Task 7).
 *
 * Before this, every chargeable special read the *attack* button, so the bow
 * never charged and Charge Shot always fired at 5%.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { ONE, fx, toFloat } from "@/engine/fixed";
import { chargeFraction } from "@/engine/projectile";
import { createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { chargedHitbox } from "@/engine/specialCharge";
import { Btn } from "@/engine/types";
import type { FighterState, GameState, InputFrame, MatchRules, ProjectileState } from "@/engine/types";
import { STAGES } from "@/stages";
import { FIGHTERS, donkeyKong, kirby, link, marth, pikachu } from "./index";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true };

beforeAll(() => {
  registerFighters(FIGHTERS);
  registerStages(STAGES);
});

/** `defId` standing at centre stage, Mario far away on the right, both actionable. */
function standing(defId: string): GameState {
  const s = createInitialState("finalDestination", [{ defId }, { defId: "mario" }], RULES, 99);
  s.fighters.forEach((f, i) =>
    Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(i === 0 ? -30 : 60), y: 0, facing: 1, intangible: 0 }),
  );
  return s;
}

/** Step with the given per-frame inputs for port 0; port 1 idles. */
function play(
  s: GameState,
  inputs: readonly InputFrame[],
): { state: GameState; trace: FighterState[]; spawned: number[]; shots: ProjectileState[] } {
  let state = s;
  let prev: InputFrame = 0;
  const trace: FighterState[] = [];
  const spawned: number[] = [];
  const shots: ProjectileState[] = [];
  for (const input of inputs) {
    const before = state.nextProjectileId;
    state = step(state, [input, 0], { prevInputs: [prev, 0] }).state;
    prev = input;
    trace.push(state.fighters[0]);
    if (state.nextProjectileId > before) {
      spawned.push(trace.length);
      shots.push(state.projectiles[state.projectiles.length - 1]);
    }
  }
  return { state, trace, spawned, shots };
}

const press = (b: InputFrame, then: InputFrame, frames: number): InputFrame[] => [b, ...Array<InputFrame>(frames - 1).fill(then)];

describe("Charge Shot stores its charge (store mode)", () => {
  it("charges in a loop after pressing B once, and a full charge stores itself", () => {
    const { state, trace } = play(standing("samus"), press(Btn.Special, 0, 200));
    expect(Math.max(...trace.map((f) => f.charge))).toBe(112);
    expect(state.fighters[0].combat.storedCharge).toBe(112);
    expect(state.fighters[0].action).toBe("stand");
    expect(state.projectiles).toHaveLength(0);
  });

  it("puts a partial charge away on shield, and keeps it", () => {
    const inputs = [...press(Btn.Special, 0, 43), Btn.Shield];
    const { state } = play(standing("samus"), inputs);
    expect(state.fighters[0].combat.storedCharge).toBe(30);
    expect(state.fighters[0].action).toBe("shieldStart");
  });

  it("puts it away on a jump too", () => {
    const { state } = play(standing("samus"), [...press(Btn.Special, 0, 33), Btn.Jump]);
    expect(state.fighters[0].combat.storedCharge).toBe(20);
    expect(state.fighters[0].action).toBe("jumpSquat");
  });

  it("fires a stored full charge three frames after B, at full strength", () => {
    const charged = play(standing("samus"), press(Btn.Special, 0, 200)).state;
    const { state, spawned, shots } = play(charged, press(Btn.Special, 0, 10));
    expect(spawned).toEqual([3]);
    expect(shots[0].charge).toBe(ONE);
    expect(state.fighters[0].combat.storedCharge).toBe(0);
  });

  it("fires on a second B press, with the charge built so far", () => {
    const { shots } = play(standing("samus"), [...press(Btn.Special, 0, 69), Btn.Special, 0, 0, 0, 0]);
    expect(shots).toHaveLength(1);
    expect(shots[0].charge).toBe(Math.trunc((56 * ONE) / 112));
  });

  it("is not charged by holding attack", () => {
    const { trace } = play(standing("samus"), press(Btn.Special, Btn.Attack, 40));
    expect(trace.some((f) => f.charge > 0)).toBe(true);
    const held = play(standing("samus"), press(Btn.Attack, Btn.Attack, 40)).trace;
    expect(held.every((f) => f.move !== "neutralB")).toBe(true);
  });
});

describe("Giant Punch stores its charge too", () => {
  it("swings its arms until B, then punches at the charged damage", () => {
    const s = standing("donkeyKong");
    s.fighters[1].x = fx(-18);
    s.fighters[1].facing = 1;
    s.fighters[0].x = fx(-30);
    const { state } = play(s, [...press(Btn.Special, 0, 117), Btn.Special, ...Array<InputFrame>(40).fill(0)]);
    // 110 charge frames: 10% + 18 = 28%; ×1.05 fresh, ×1.2 one-on-one.
    expect(toFloat(state.fighters[1].damage)).toBeCloseTo(28 * 1.05 * 1.2, 2);
  });
});

describe("hold-mode specials charge on B, not on attack", () => {
  it("Hero's Bow looses a stronger, faster arrow the longer B is held", () => {
    const quick = play(standing("link"), [Btn.Special, 0, ...Array<InputFrame>(30).fill(0)]).shots[0];
    const full = play(standing("link"), [...press(Btn.Special, Btn.Special, 90), ...Array<InputFrame>(20).fill(0)]).shots[0];
    expect(quick.charge).toBe(0);
    expect(full.charge).toBe(ONE);
    expect(Math.abs(full.vx)).toBeGreaterThan(Math.abs(quick.vx) * 3);
  });

  it("Shield Breaker waits while B is held, then lands at its full-charge damage", () => {
    const s = standing("marth");
    s.fighters[1].x = fx(-20);
    const { state, trace } = play(s, [...press(Btn.Special, Btn.Special, 75), ...Array<InputFrame>(20).fill(0)]);
    expect(Math.max(...trace.map((f) => f.charge))).toBe(60);
    expect(toFloat(state.fighters[1].damage)).toBeCloseTo(24 * 1.05 * 1.2, 2);
  });
});

describe("the roster", () => {
  it("charges no special on the attack button: `chargeable` is for smashes only", () => {
    for (const def of FIGHTERS) {
      for (const slot of ["neutralB", "sideB", "upB", "downB"] as const) {
        expect(def.moves[slot]?.chargeable, `${def.id} ${slot}`).toBeUndefined();
      }
    }
  });
});

describe("a charge a frame short of full (SmashWiki's partial-charge formulas)", () => {
  /** The move's box `id` after `c` charge frames, as the sim builds it. */
  function box(move: NonNullable<typeof marth.moves.neutralB>, id: number, c: number) {
    const sc = move.specialCharge!;
    const hb = move.hitboxes.find((h) => h.id === id)!;
    return chargedHitbox(hb, sc.full?.[id], chargeFraction(c, sc.frames), sc.partial);
  }

  it("Shield Breaker: 1 + 1.2·c/60 — 19.62% tip, 17.44% body at 59; 24% / 22% at 60", () => {
    const sb = marth.moves.neutralB!;
    expect(toFloat(box(sb, 0, 59).damage)).toBeCloseTo(19.62, 1);
    expect(toFloat(box(sb, 1, 59).damage)).toBeCloseTo(17.44, 1);
    expect(box(sb, 0, 60).damage).toBe(fx(24));
    expect(box(sb, 1, 60).damage).toBe(fx(22));
  });

  it("Hammer Flip: 0.085% a frame — 29.115% at 119; 35% at 361° at 120", () => {
    const hf = kirby.moves.sideB!;
    expect(toFloat(box(hf, 0, 119).damage)).toBeCloseTo(29.115, 2);
    expect(box(hf, 0, 119).angle).toBe(hf.hitboxes[0].angle);
    expect(box(hf, 0, 120).damage).toBe(fx(35));
    expect(box(hf, 0, 120).angle).toBe(fx(361));
  });

  it("Giant Punch: 10 + 18·c/110 rounded down — 27% at 109, 28% at 110", () => {
    const gp = donkeyKong.moves.neutralB!;
    expect(box(gp, 0, 109).damage).toBe(fx(27));
    expect(box(gp, 0, 110).damage).toBe(fx(28));
  });

  it("Skull Bash: 6.2 + 15.2·c/80, unrounded", () => {
    const sk = pikachu.moves.sideB!;
    expect(toFloat(box(sk, 0, 79).damage)).toBeCloseTo(6.2 + (15.2 * 79) / 80, 2);
  });

  it("the bow: 4 + 8·c/60 rounded down — 11% at 59", () => {
    const arrow = link.moves.neutralB!.projectiles![0];
    const at = (c: number) => chargedHitbox(arrow.hitbox, arrow.charged!.hitbox, chargeFraction(c, 60), arrow.charged!.partial);
    expect(at(59).damage).toBe(fx(11));
    expect(at(60).damage).toBe(fx(12));
    expect(at(7).damage).toBe(fx(4));
  });
});
```

`src/fighters/index.test.ts` — apply:

```diff
--- a/src/fighters/index.test.ts
+++ b/src/fighters/index.test.ts
@@ -323,10 +323,11 @@ describe("the other character-defining mechanics", () => {
 
   it("gives Samus a Charge Shot that is chargeable and holds its charge", () => {
     const chargeShot = samus.moves.neutralB!;
     expect(chargeShot.name).toBe("Charge Shot");
-    expect(chargeShot.chargeable).toBe(true);
-    expect(chargeShot.projectiles![0].chargeScaling).toBeGreaterThan(0);
+    // Plan 5: a store-mode special charge, 112 frames, and a full-charge shot.
+    expect(chargeShot.specialCharge).toMatchObject({ mode: "store", frames: 112 });
+    expect(chargeShot.projectiles![0].charged).toBeDefined();
   });
 
   it("makes every smash attack chargeable and nothing else that shouldn't be", () => {
     for (const fighter of FIGHTERS) {
@@ -340,9 +341,9 @@ describe("the other character-defining mechanics", () => {
   });
 
   it("gives Donkey Kong super armour on his charged Giant Punch", () => {
     expect(donkeyKong.moves.neutralB!.superArmourFrames).toEqual([9, 20]);
-    expect(donkeyKong.moves.neutralB!.chargeable).toBe(true);
+    expect(donkeyKong.moves.neutralB!.specialCharge).toMatchObject({ mode: "store", frames: 110 });
   });
 
   it("keeps every fighter's moveset mutually distinguishable", () => {
     // Two fighters sharing a frame-for-frame identical forward smash would mean
```

`src/fighters/schema.test.ts` — apply:

```diff
--- a/src/fighters/schema.test.ts
+++ b/src/fighters/schema.test.ts
@@ -274,20 +274,18 @@ describe("projectiles", () => {
   it("gives Samus and Link the charge scaling their specials are built around", () => {
     const chargeShot = everyProjectile(getFighterOrThrow("samus")).find(
       (p) => p.projectile.id === "chargeShot"
     )!.projectile;
-    // 5% uncharged to 28% at full charge.
-    expect(toFloat(chargeShot.chargeScaling!)).toBeCloseTo(5.6, 2);
-    expect(toFloat(chargeShot.hitbox.damage) * toFloat(chargeShot.chargeScaling!)).toBeCloseTo(
-      28,
-      1
-    );
+    // 5% uncharged to 28% at full charge (Plan 5: interpolated, `charged`).
+    expect(toFloat(chargeShot.hitbox.damage)).toBeCloseTo(5, 2);
+    expect(toFloat(chargeShot.charged!.hitbox.damage!)).toBeCloseTo(28, 2);
 
     const arrow = everyProjectile(getFighterOrThrow("link")).find(
       (p) => p.projectile.id === "arrow"
     )!.projectile;
     // 4% uncharged to 12% at full charge.
-    expect(toFloat(arrow.hitbox.damage) * toFloat(arrow.chargeScaling!)).toBeCloseTo(12, 1);
+    expect(toFloat(arrow.hitbox.damage)).toBeCloseTo(4, 2);
+    expect(toFloat(arrow.charged!.hitbox.damage!)).toBeCloseTo(12, 2);
   });
 
   it("gives Fox's Blaster no knockback, no hitlag and no flinch whatsoever", () => {
     const blaster = everyProjectile(getFighterOrThrow("fox")).find(
```

`src/game/simContext.test.ts` — apply:

```diff
--- a/src/game/simContext.test.ts
+++ b/src/game/simContext.test.ts
@@ -36,8 +36,8 @@ describe("the game's SimContext", () => {
     expect(engineFingerprint(GAME_SIM_CONTEXT, { version: ENGINE_RULES_VERSION, activeSlots: fewer })).not.toBe(base);
     expect(engineFingerprint(GAME_SIM_CONTEXT, { version: ENGINE_RULES_VERSION, activeSlots: ACTIVE_SCRIPT_SLOTS })).toBe(base);
   });
 
-  it("is Plan 4's rules version (bone hurtboxes and ECB change what step() does)", () => {
-    expect(ENGINE_RULES_VERSION).toBe(4);
+  it("is Plan 5's rules version (its specials change what step() does)", () => {
+    expect(ENGINE_RULES_VERSION).toBe(5);
   });
 });
```

`src/render/chars/samus/samus.test.ts` — apply:

```diff
--- a/src/render/chars/samus/samus.test.ts
+++ b/src/render/chars/samus/samus.test.ts
@@ -546,11 +546,11 @@ function biggestSolid(t: Trace, u = 10): number {
   return rs.length ? Math.max(...rs) / u : 0;
 }
 
 describe("the effects paint on the frames they claim to", () => {
-  it("Charge Shot paints nothing before the shot and a flash on frame 3", () => {
+  it("Charge Shot paints nothing before the shot and a flash as it leaves (Plan 5: frame 16)", () => {
     expect(fxAt("neutralB", 0)).toBe(0);
-    expect(fxAt("neutralB", 3)).toBeGreaterThan(0);
+    expect(fxAt("neutralB", 16)).toBeGreaterThan(0);
   });
 
   it("the held charge grows with the charge and is drawn the whole time", () => {
     // The one thing a player has to be able to read against Samus is how full
@@ -792,28 +792,29 @@ describe("Charge Shot", () => {
     return biggestSolid(fxTrace("neutralB", frame, { charge }).under);
   }
 
   /**
-   * The charge pins `actionFrame` to 1 and `frame` is `actionFrame + 1`, so the
-   * whole of the hold is frame 2 and the plasma leaves on frame 3.
+   * Plan 5: the charge loops on game frame 13 (SmashWiki: 13 frames to enter
+   * the charge state), so the whole of the hold is frame 13; 112 frames is full.
    */
-  const HOLDING = 2;
+  const HOLDING = 13;
+  const FULL = 112;
 
   it("holds a ball that is most of her own height at full charge", () => {
     // Measured off the game's own hurtbox renders: the full-charge sphere is
     // around three quarters of her standing height across. At half that it
     // reads as a slightly bigger tap, and the only decision a player makes
     // against Samus is whether the ball is worth respecting yet.
-    const r = biggest(HOLDING, SMASH_CHARGE_MAX);
+    const r = biggest(HOLDING, FULL);
     expect(r * 2, `a full charge is ${(r * 2).toFixed(1)} rig units across`).toBeGreaterThan(8.0);
   });
 
   it("puts the ball off the end of the barrel rather than inside it", () => {
     // The cannon prop is four rig units across. A ball centred on the bore has
     // its inboard half behind the barrel, and since the ball is painted under
     // the fighter that half is not drawn at all — a full charge came out
     // looking like a half one.
-    const t = fxTrace("neutralB", HOLDING, { charge: SMASH_CHARGE_MAX });
+    const t = fxTrace("neutralB", HOLDING, { charge: FULL });
     const centres = t.under.arcs.filter((a) => a.solid).map((a) => (a.x - 400) / 10);
     // The bore is at about 7.2 units. A fully charged ball is 4.4 units in
     // radius, so standing it off by half of that puts its centre past 9.
     expect(Math.min(...centres)).toBeGreaterThan(8.5);
@@ -824,22 +825,22 @@ describe("Charge Shot", () => {
     // it, and that does not happen until the move ends — so a guard on `charge`
     // alone kept a fully charged ball hanging at the muzzle through all
     // forty-one frames of recovery, while the shot it fired was already
     // exploding on somebody.
-    expect(biggest(HOLDING, SMASH_CHARGE_MAX)).toBeGreaterThan(4);
+    expect(biggest(HOLDING, FULL)).toBeGreaterThan(4);
     // Once it has left, nothing on screen may still depend on how full the bar
     // was — the flash and the steam are the same whatever she fired.
-    for (const frame of [4, 9, 20]) {
+    for (const frame of [15, 20, 31]) {
       expect(
-        biggest(frame, SMASH_CHARGE_MAX),
+        biggest(frame, FULL),
         `frame ${frame} still draws something that scales with the charge`,
       ).toBeCloseTo(biggest(frame, 0), 5);
     }
   });
 
   it("still flashes and vents on the frames the shot is leaving", () => {
-    expect(fxAt("neutralB", 3, SMASH_CHARGE_MAX)).toBeGreaterThan(0);
-    expect(fxAt("neutralB", 9, SMASH_CHARGE_MAX)).toBeGreaterThan(0);
+    expect(fxAt("neutralB", 14, FULL)).toBeGreaterThan(0);
+    expect(fxAt("neutralB", 20, FULL)).toBeGreaterThan(0);
   });
 });
 
 /* --------------------------------------------------- the cannon is alive -- */
```

`src/render/specialFx.test.ts` — apply:

```diff
--- a/src/render/specialFx.test.ts
+++ b/src/render/specialFx.test.ts
@@ -96,9 +96,10 @@ describe("Samus's Charge Shot shows its charge", () => {
     for (let i = 1; i < radii.length; i++) expect(radii[i]).toBeGreaterThan(radii[i - 1]);
   });
 
   it("draws nothing of the charge once it has been fired", () => {
-    const { ctx } = draw("samus", "neutralB", 30, { charge: 0 });
+    // Plan 5: the shot leaves 13 frames later than it used to (the charge loop).
+    const { ctx } = draw("samus", "neutralB", 41, { charge: 0 });
     expect(countOf(ctx, "arc")).toBe(0);
   });
 });
 
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/engine/specialCharge.test.ts src/engine/states.test.ts src/fighters/charge.test.ts src/fighters/index.test.ts src/fighters/schema.test.ts src/game/simContext.test.ts src/render/chars/samus/samus.test.ts src/render/specialFx.test.ts`
Expected: FAIL — `specialCharge.test.ts` and `charge.test.ts`: `Failed to resolve import "./specialCharge"` / `"@/engine/specialCharge"`; 7 failed | 526 passed in the rest — `expected undefined to match object { mode: 'store', frames: 112 }` (and `frames: 110`), `expected 3.5 to be greater than 4`, `expected 1.8 to be greater than 8.5`, `a full charge is 7.0 rig units across: expected 7 to be greater than 8`, and `simContext.test.ts`: `expected 4 to be 5`.

- [ ] **Step 3: Implement**

`src/engine/combat.ts` — apply:

```diff
--- a/src/engine/combat.ts
+++ b/src/engine/combat.ts
@@ -44,8 +44,14 @@ export interface CombatState {
   /** The parked launch is an autolink, fixed on contact as (autolinkX, autolinkY), Q12 (Task 19). */
   autolink: boolean;
   autolinkX: number;
   autolinkY: number;
+  /**
+   * Plan 5: frames of a store-mode special's charge put away for later (Charge
+   * Shot, Giant Punch, F.L.U.D.D.); 0 for none. Survives shielding, jumping
+   * and being hit; spent by the next use of that special.
+   */
+  storedCharge: number;
 }
 
 export function emptyCombat(): CombatState {
   return {
@@ -61,8 +67,9 @@ export function emptyCombat(): CombatState {
     swingQueued: false,
     autolink: false,
     autolinkX: 0,
     autolinkY: 0,
+    storedCharge: 0,
   };
 }
 
 export function cloneCombat(c: CombatState): CombatState {
@@ -79,6 +86,7 @@ export function cloneCombat(c: CombatState): CombatState {
     swingQueued: c.swingQueued,
     autolink: c.autolink,
     autolinkX: c.autolinkX,
     autolinkY: c.autolinkY,
+    storedCharge: c.storedCharge,
   };
 }
```

`src/engine/constants.ts` — apply:

```diff
--- a/src/engine/constants.ts
+++ b/src/engine/constants.ts
@@ -19,10 +19,13 @@ export const TICK_RATE = 60;
  * differ here play different games and desync on the first hit, so the
  * version goes into `engineFingerprint` (`src/game/simContext.ts`). Plan 3
  * sets it to 3; every later plan that changes what `step()` does bumps it.
  * Plan 4: 4 — per-bone hurtboxes and the bone-derived ECB.
+ * Plan 5: 5 — from its first behaviour change (charged specials) on: specials,
+ * throws from their scripts, Final Smashes, wall jumps, footstools, crawling
+ * and the Stick Jump option.
  */
-export const ENGINE_RULES_VERSION = 4;
+export const ENGINE_RULES_VERSION = 5;
 
 /* ------------------------------------------------------------------ combat -- */
 
 /**
```

`src/engine/hash.ts` — apply:

```diff
--- a/src/engine/hash.ts
+++ b/src/engine/hash.ts
@@ -175,8 +175,9 @@ export function mixCombat(h: number, c: CombatState): number {
   x = mixBool(x, c.swingQueued);
   x = mixBool(x, c.autolink);
   x = mixInt(x, c.autolinkX);
   x = mixInt(x, c.autolinkY);
+  x = mixInt(x, c.storedCharge);
   return x;
 }
 
 /** The KineticModule energies, in declaration order. */
```

`src/engine/projectile.ts` — apply:

```diff
--- a/src/engine/projectile.ts
+++ b/src/engine/projectile.ts
@@ -18,11 +18,13 @@
 
 import { ONE, fx, abs, mul } from "./fixed";
 import { SMASH_CHARGE_MAX } from "./constants";
 import { HARD_PLATFORM_DEPTH, platformCentreX } from "./physics";
+import { chargedHitbox } from "./specialCharge";
 import type {
   FighterDef,
   FighterState,
+  Hitbox,
   MoveDef,
   ProjectileDef,
   ProjectileState,
   StageDef,
@@ -69,12 +71,12 @@ export function findProjectileDef(def: FighterDef, id: string): ProjectileDef |
  * has to cover the tap and the full charge, and the difference is one scalar
  * applied to both damage and speed. Never below 1 — a mis-authored scaling makes
  * a projectile no weaker than its uncharged self rather than deleting it.
  */
-export function projectileChargeScale(def: ProjectileDef, charge: number): number {
+export function projectileChargeScale(def: ProjectileDef, charge: number, frames: number = SMASH_CHARGE_MAX): number {
   if (def.chargeScaling === undefined || charge <= 0) return ONE;
-  const held = Math.min(charge, SMASH_CHARGE_MAX);
-  const scale = ONE + Math.trunc(((def.chargeScaling - ONE) * held) / SMASH_CHARGE_MAX);
+  const held = Math.min(charge, frames);
+  const scale = ONE + Math.trunc(((def.chargeScaling - ONE) * held) / frames);
   return scale < ONE ? ONE : scale;
 }
 
 /**
@@ -88,27 +90,32 @@ export function spawnProjectile(
   def: ProjectileDef,
   owner: FighterState,
   instanceId: number,
   source: string = owner.defId,
+  chargeFrames: number = SMASH_CHARGE_MAX,
 ): ProjectileState {
   const facing = owner.facing >= 0 ? 1 : -1;
-  const chargeScale = projectileChargeScale(def, owner.charge);
+  const chargeScale = projectileChargeScale(def, owner.charge, chargeFrames);
+  const charge = chargeFraction(owner.charge, chargeFrames);
+  // A full-charge variant interpolates its speed (Plan 5); otherwise the
+  // multiplier scales it, as it scales the damage.
+  const vx = def.charged !== undefined ? def.vx + Math.trunc(((def.charged.vx - def.vx) * charge) / ONE) : mul(def.vx, chargeScale);
   return {
     instanceId,
     defId: def.id,
     owner: owner.port,
     x: owner.x + facing * def.offsetX,
     y: owner.y + def.offsetY,
-    vx: facing * mul(def.vx, chargeScale),
+    vx: facing * vx,
     vy: def.vy,
     facing,
     age: 0,
     bouncesLeft: def.bounces ?? 0,
     chargeScale,
     hitPorts: [],
     returning: false,
     source,
-    charge: chargeFraction(owner.charge, SMASH_CHARGE_MAX),
+    charge,
     reflected: 0,
   };
 }
 
@@ -123,8 +130,13 @@ export function projectilesDueOnFrame(move: MoveDef, moveFrame: number): readonl
   if (move.projectiles === undefined) return [];
   return move.projectiles.filter((p) => p.spawnFrame === moveFrame);
 }
 
+/** This projectile's hitbox, at the charge it was launched with (Plan 5). */
+export function projectileHitbox(p: ProjectileState, def: ProjectileDef): Hitbox {
+  return def.charged === undefined ? def.hitbox : chargedHitbox(def.hitbox, def.charged.hitbox, p.charge, def.charged.partial);
+}
+
 /** Is this projectile's hitbox live? Its frames are counted from the spawn. */
 export function projectileHitboxActive(p: ProjectileState, def: ProjectileDef): boolean {
   return p.age >= def.hitbox.startFrame && p.age <= def.hitbox.endFrame;
 }
```

`src/engine/simulate.ts` — apply:

```diff
--- a/src/engine/simulate.ts
+++ b/src/engine/simulate.ts
@@ -83,11 +83,14 @@ import {
   cloneProjectile,
   findProjectileDef,
   markProjectileHit,
   projectileAlreadyHit,
+  chargeFraction,
+  projectileHitbox,
   projectileHitboxActive,
   spawnProjectile,
 } from "./projectile";
+import { chargedHitbox } from "./specialCharge";
 import {
   blastZoneKO,
   ecbOf,
   findLedgeGrab,
@@ -765,9 +768,14 @@ function gatherHitboxes(
     // box the script issues again can hit again — how a multi-hit works. Legacy
     // moves only ever clear by id, and keep one hit per swing (Plan 3, Task 16).
     if (run.state.fired.some((cmd) => cmd.op === "clearAll")) clearHitRecord(f);
     const live = scriptHitboxes(run.state, defs[i].id, run.script.motion, run.gameFrame, bones);
-    for (const hb of live) {
+    // A charged special's boxes grow towards their full-charge values (Plan 5);
+    // a smash's charge stays the damage multiplier it always was.
+    const sc = defs[i].moves[f.move]?.specialCharge;
+    const chargeT = sc === undefined ? 0 : chargeFraction(f.charge, sc.frames);
+    for (const raw of live) {
+      const hb = sc === undefined ? raw : chargedHitbox(raw, sc.full?.[raw.id], chargeT, sc.partial);
       const now = hitboxWorldPos(f.x, f.y, f.facing, hb);
       const was = hitboxWorldPos(prevPos[i].x, prevPos[i].y, f.facing, hb);
       const far =
         hb.x2 === undefined || hb.y2 === undefined
@@ -783,9 +791,9 @@ function gatherHitboxes(
         dx: far.x - now.x,
         dy: far.y - now.y,
         slot: f.move,
         projectile: null,
-        chargeScale: chargeMultiplier(f.charge),
+        chargeScale: f.action === "attack" ? chargeMultiplier(f.charge) : ONE,
         destroyOnHit: false,
         suppressed: false,
       });
     }
@@ -844,9 +852,10 @@ function spawnDueProjectiles(
     for (const cmd of run.state.fired) {
       if (cmd.op !== "spawnProjectile") continue;
       const def = findProjectileDef(defs[i], cmd.id);
       if (def === undefined) continue;
-      const p = spawnProjectile(def, f, s.nextProjectileId);
+      const sc = defs[i].moves[f.move]?.specialCharge;
+      const p = spawnProjectile(def, f, s.nextProjectileId, defs[i].id, sc?.frames);
       s.nextProjectileId += 1;
       s.projectiles.push(p);
       prev.set(p.instanceId, { x: p.x, y: p.y });
     }
@@ -863,16 +872,17 @@ function appendProjectileCandidates(
   for (const p of s.projectiles) {
     const def = projectileDefOf(ctx, p);
     if (def === undefined || !projectileHitboxActive(p, def)) continue;
     const was = prev.get(p.instanceId) ?? { x: p.x, y: p.y };
-    const offsetX = p.facing >= 0 ? def.hitbox.x : -def.hitbox.x;
+    const hitbox = projectileHitbox(p, def);
+    const offsetX = p.facing >= 0 ? hitbox.x : -hitbox.x;
     candidates.push({
       attacker: p.owner,
-      hitbox: def.hitbox,
+      hitbox,
       x: p.x + offsetX,
-      y: p.y + def.hitbox.y,
+      y: p.y + hitbox.y,
       prevX: was.x + offsetX,
-      prevY: was.y + def.hitbox.y,
+      prevY: was.y + hitbox.y,
       dx: 0,
       dy: 0,
       slot: null,
       projectile: p,
```

`src/engine/specialCharge.ts` (new file):

```ts
/**
 * Specials that charge (Plan 5, Task 2): Hero's Bow, Shield Breaker, Hammer
 * Flip and Skull Bash charge while B is held; Charge Shot, Giant Punch and
 * F.L.U.D.D. loop until B is pressed again and can be put away for later.
 *
 * The charge is `FighterState.charge` (frames), as a smash's is; the loop is
 * the move's `actionFrame` held on its loop frame, so nothing new is cloned or
 * hashed except the stored charge (`CombatState.storedCharge`).
 */

import { ONE, mul } from "./fixed";
import { airJump, startAction, startAirDodge } from "./states";
import type { Intent, StateContext } from "./states";
import type { ChargedHitbox, FighterState, Hitbox, PartialCharge, SpecialCharge } from "./types";

function lerp(a: number, b: number | undefined, t: number): number {
  return b === undefined ? a : a + Math.trunc(((b - a) * t) / ONE);
}

/** Rounded down to a whole percent (Q12). */
function wholePercent(v: number): number {
  return Math.floor(v / ONE) * ONE;
}

const LINEAR: PartialCharge = { kind: "lerp" };

/**
 * A hitbox at a charge of `t` (Q12, `ONE` = full). Below full it grows as the
 * move's `partial` rule says (`PartialCharge`: SmashWiki's per-move charge
 * formulas); at full the `full` values replace the authored ones outright
 * ("When fully charged, the hitboxes are instead changed directly"), angle
 * included. The angle never sweeps between — UNVERIFIED: SmashWiki publishes
 * no angle formula for a charge.
 */
export function chargedHitbox(hb: Hitbox, full: ChargedHitbox | undefined, t: number, partial: PartialCharge = LINEAR): Hitbox {
  if (t <= 0) return hb;
  if (t >= ONE) {
    if (full === undefined) return partial.kind === "lerp" ? hb : { ...hb, damage: partialDamage(hb.damage, ONE, partial) };
    return {
      ...hb,
      damage: full.damage ?? hb.damage,
      baseKnockback: full.baseKnockback ?? hb.baseKnockback,
      knockbackGrowth: full.knockbackGrowth ?? hb.knockbackGrowth,
      radius: full.radius ?? hb.radius,
      angle: full.angle ?? hb.angle,
    };
  }
  if (partial.kind !== "lerp") return { ...hb, damage: partialDamage(hb.damage, t, partial) };
  if (full === undefined) return hb;
  const damage = lerp(hb.damage, full.damage, t);
  return {
    ...hb,
    damage: partial.floor === true ? wholePercent(damage) : damage,
    baseKnockback: lerp(hb.baseKnockback, full.baseKnockback, t),
    knockbackGrowth: lerp(hb.knockbackGrowth, full.knockbackGrowth, t),
    radius: lerp(hb.radius, full.radius, t),
  };
}

function partialDamage(base: number, t: number, partial: Exclude<PartialCharge, { kind: "lerp" }>): number {
  if (partial.kind === "multiply") return mul(base, ONE + mul(partial.by, t));
  const damage = base + mul(partial.total, t);
  return partial.floor === true ? wholePercent(damage) : damage;
}

/**
 * Run one frame of a charging special's loop. Returns true when it consumed
 * the frame (the caller's ordinary move logic must not run).
 *
 * `loopFrame` is quoted as a game frame (SmashWiki "Charges between a–b"), so
 * the move holds on `actionFrame = loopFrame − 1` and the loop is re-entered
 * each time the frame advances onto `loopFrame`. Released, the move simply
 * carries on past it and never comes back.
 */
export function specialChargeMain(f: FighterState, intent: Intent, ctx: StateContext, sc: SpecialCharge): boolean {
  if (f.actionFrame !== sc.loopFrame) return false;

  if (sc.mode === "hold") {
    if (!intent.specialHeld || f.charge >= sc.frames) return false;
    f.actionFrame = sc.loopFrame - 1;
    f.charge += 1;
    return true;
  }

  // Store mode: B fires; shield or jump puts the charge away; a full charge
  // puts itself away (UNVERIFIED: that it auto-stores — SmashWiki's tables give
  // the charge time and the cancels, not what happens at full).
  if (intent.specialPressed) return false;
  if (intent.shieldPressed) {
    storeCharge(f);
    if (f.grounded) startAction(f, "shieldStart");
    else if (!startAirDodge(f, intent)) startAction(f, "fall");
    return true;
  }
  if (intent.jumpPressed) {
    storeCharge(f);
    if (f.grounded) startAction(f, "jumpSquat");
    else if (!airJump(f, ctx)) startAction(f, "fall");
    return true;
  }
  if (f.charge >= sc.frames) {
    storeCharge(f);
    startAction(f, f.grounded ? "stand" : "fall");
    return true;
  }
  f.actionFrame = sc.loopFrame - 1;
  f.charge += 1;
  return true;
}

function storeCharge(f: FighterState): void {
  f.combat.storedCharge = f.charge;
}
```

`src/engine/states.ts` — apply:

```diff
--- a/src/engine/states.ts
+++ b/src/engine/states.ts
@@ -143,8 +143,10 @@ export interface Intent {
   readonly jumpHeld: boolean;
   readonly attackPressed: boolean;
   readonly attackHeld: boolean;
   readonly specialPressed: boolean;
+  /** B is down: what a hold-mode special charge reads (Plan 5). */
+  readonly specialHeld: boolean;
   readonly shieldHeld: boolean;
   readonly shieldPressed: boolean;
   readonly shieldReleased: boolean;
   readonly grabPressed: boolean;
@@ -256,8 +258,9 @@ export function interpretInput(f: FighterState, input: InputFrame, prev: InputFr
     jumpHeld: held(input, Btn.Jump) || held(input, Btn.Up),
     attackPressed: pressed(input, prev, Btn.Attack),
     attackHeld: held(input, Btn.Attack),
     specialPressed: pressed(input, prev, Btn.Special),
+    specialHeld: held(input, Btn.Special),
     shieldHeld: held(input, Btn.Shield),
     shieldPressed: pressed(input, prev, Btn.Shield),
     shieldReleased: released(input, prev, Btn.Shield),
     grabPressed: pressed(input, prev, Btn.Grab),
@@ -472,10 +475,19 @@ export function beginAttack(f: FighterState, ctx: StateContext, slot: MoveSlot):
   return false;
 }
 
 export function beginSpecial(f: FighterState, ctx: StateContext, slot: MoveSlot): boolean {
-  if (!hasMove(ctx, slot)) return false;
+  const move = ctx.def.moves[slot];
+  if (move === undefined) return false;
   startMove(f, "special", slot);
+  // A stored charge comes back out (Plan 5): a full one fires at once, from the
+  // loop frame; a partial one keeps charging from where it left off.
+  const sc = move.specialCharge;
+  if (sc?.mode === "store" && f.combat.storedCharge > 0) {
+    f.charge = f.combat.storedCharge;
+    f.combat.storedCharge = 0;
+    if (f.charge >= sc.frames) f.actionFrame = sc.loopFrame;
+  }
   return true;
 }
 
 /* -------------------------------------------------- actionable behaviour -- */
```

`src/engine/status/attack.ts` — apply:

```diff
--- a/src/engine/status/attack.ts
+++ b/src/engine/status/attack.ts
@@ -10,8 +10,9 @@
 
 import { SMASH_CHARGE_MAX } from "../constants";
 import { clearHitRecord } from "../hitbox";
 import { mashFrames } from "../shield";
+import { specialChargeMain } from "../specialCharge";
 import {
   GRAB_MASH_BUTTON,
   GRAB_MASH_STICK,
   GRAB_MIN_FRAMES,
@@ -35,10 +36,14 @@ function attackMain(f: FighterState, intent: Intent, ctx: StateContext): void {
   if (move === undefined) {
     startAction(f, f.grounded ? "stand" : "fall");
     return;
   }
+  // A charging special reads B, never the attack button (Plan 5).
+  if (f.action === "special" && move.specialCharge !== undefined && specialChargeMain(f, intent, ctx, move.specialCharge)) {
+    return;
+  }
   // Charging a smash holds the animation one frame short of its first hitbox.
-  if (move.chargeable && f.charge < SMASH_CHARGE_MAX && intent.attackHeld) {
+  if (f.action === "attack" && move.chargeable && f.charge < SMASH_CHARGE_MAX && intent.attackHeld) {
     const holdFrame = Math.max(1, (move.hitboxes[0]?.startFrame ?? 1) - 1);
     if (f.actionFrame >= holdFrame) {
       f.actionFrame = holdFrame;
       f.charge += 1;
```

`src/engine/types.ts` — apply:

```diff
--- a/src/engine/types.ts
+++ b/src/engine/types.ts
@@ -273,12 +273,60 @@ export interface ProjectileDef {
   /** Returns to its owner partway through its life, like a boomerang. */
   readonly returns?: boolean;
   /** Charge scales damage and speed by up to this multiplier at full charge. */
   readonly chargeScaling?: number;
+  /**
+   * What a full charge launches instead (Plan 5): the hitbox it interpolates
+   * towards (`chargedHitbox`) and its speed. Samus's Charge Shot is SSBU's
+   * `ATTACK_SET_LERP` between an uncharged and a full-charge box.
+   */
+  readonly charged?: { readonly hitbox: ChargedHitbox; readonly vx: number; readonly partial?: PartialCharge };
   /** Drawing hint for the renderer. */
   readonly visual: "arrow" | "bomb" | "boomerang" | "energy" | "fire" | "spark" | "missile";
 }
 
+/** The numbers a charge changes on a hitbox; the rest of the box stays as authored. */
+export type ChargedHitbox = Partial<Pick<Hitbox, "damage" | "angle" | "baseKnockback" | "knockbackGrowth" | "radius">>;
+
+/**
+ * How a partly charged special's boxes grow before a full charge replaces them
+ * with the `full` values outright (SmashWiki, per move; `c` the charge frames,
+ * `frames` the total charge time):
+ * - `"lerp"`: every number moves linearly from the uncharged box to the full
+ *   one (Charge Shot: "damage, shield damage, base knockback, knockback scaling,
+ *   and radius are linearly scaled"); `floor` rounds the damage down to a whole
+ *   percent;
+ * - `"add"`: the damage alone grows by `total · c / frames` (Giant Punch
+ *   `base + 18·c/110` rounded down, Hammer Flip 0.085% a frame, Skull Bash
+ *   `6.2 + 15.2·c/80`, the bow `4 + 8·c/60` rounded down);
+ * - `"multiply"`: the damage alone is multiplied by `1 + by · c / frames`
+ *   (Shield Breaker `1 + 1.2·c/60`).
+ */
+export type PartialCharge =
+  | { readonly kind: "lerp"; readonly floor?: boolean }
+  | { readonly kind: "add"; readonly total: number; readonly floor?: boolean }
+  | { readonly kind: "multiply"; readonly by: number };
+
+/**
+ * A special move that charges (Plan 5). SSBU has two kinds:
+ * - `"hold"`: charges while B is held, fires on release (Hero's Bow, Shield
+ *   Breaker, Hammer Flip, Skull Bash);
+ * - `"store"`: loops after one press; B fires, shield or jump puts the charge
+ *   away for later (`CombatState.storedCharge`), and a full charge stores
+ *   itself (Charge Shot, Giant Punch, F.L.U.D.D.).
+ */
+export interface SpecialCharge {
+  readonly mode: "hold" | "store";
+  /** Frames from empty to full: SmashWiki's "Total charge time". */
+  readonly frames: number;
+  /** The move frame the charge loops on: SmashWiki's "Charges between a–b", a. */
+  readonly loopFrame: number;
+  /** Full-charge values per hitbox id, reached only at a full charge. */
+  readonly full?: Readonly<Record<number, ChargedHitbox>>;
+  /** How the boxes grow before that (`PartialCharge`); linear in every number when absent. */
+  readonly partial?: PartialCharge;
+}
+
 export interface MoveDef {
   readonly slot: MoveSlot;
   readonly name: string;
   /** First Actionable Frame — the move ends and the fighter may act again. */
@@ -290,8 +338,10 @@ export interface MoveDef {
   readonly autoCancelBefore?: number;
   readonly autoCancelAfter?: number;
   /** Smash attacks may be held to charge. */
   readonly chargeable?: boolean;
+  /** A special that charges (Plan 5): on B, held or stored. See `SpecialCharge`. */
+  readonly specialCharge?: SpecialCharge;
   /** Frames the fighter may not be interrupted, for specials with armour. */
   readonly superArmourFrames?: readonly [number, number];
   /** A jab that loops until the button is released. */
   readonly rapid?: boolean;
```

`src/fighters/acmd/active.ts` — apply:

```diff
--- a/src/fighters/acmd/active.ts
+++ b/src/fighters/acmd/active.ts
@@ -88,9 +88,9 @@ export function activatable(
   placeable: (bone: string) => boolean = ROOT_BONE_ONLY,
 ): boolean {
   if (move === undefined || STATUS_DRIVEN.has(slot)) return false;
   if (move.momentum !== undefined || move.projectiles !== undefined) return false;
-  if (move.superArmourFrames !== undefined || move.chargeable === true) return false;
+  if (move.superArmourFrames !== undefined || move.chargeable === true || move.specialCharge !== undefined) return false;
   const bones = new Set<string>();
   if (!runnable(script.commands, bones)) return false;
   if (bones.size === 0 || ![...bones].every(placeable)) return false;
   const end = runScript(script, CLEARED_BY);
```

`src/fighters/donkeyKong.ts` — apply:

```diff
--- a/src/fighters/donkeyKong.ts
+++ b/src/fighters/donkeyKong.ts
@@ -468,22 +468,31 @@ const legacy: FighterDef = {
 
     neutralB: {
       slot: "neutralB",
       name: "Giant Punch",
-      totalFrames: 62,
-      chargeable: true,
-      // Ultimate replaced the classic ten wind-ups with a continuous 110-frame
-      // charge: damage is `base + 18 * (chargeFrames / 110)`, so the grounded
-      // punch runs 10% → 28%. Full charge is also *faster* — FAF drops from 62
-      // to 47 — and grants super armour on frames 9-20. The charge is stored
-      // until DK takes knockback, and may be cancelled into shield, jump or
-      // roll. The hitbox below is the uncharged punch.
+      totalFrames: 69,
+      // Store mode (Plan 5), SmashWiki "Donkey Kong (SSBU)/Neutral special":
+      // "Total charge time 110 frames (6.0.0 onward)", "Charges between 7-8",
+      // damage "base damage + 18 * (charge frames / 110)" (10% → 28%), hitbox
+      // "26-27 (19-20)" from release, interruptible 70, super armour 9-20
+      // grounded. Shield or jump stores the charge; a stored full charge
+      // punches straight from the loop, so its hitbox comes 19 frames later.
+      // UNVERIFIED-simplified: the full punch's shorter FAF (48) and the
+      // 4-frame charge-cancel lag are not modelled.
+      specialCharge: {
+        mode: "store",
+        frames: 110,
+        loopFrame: 7,
+        // "base damage + 18 * (charge frames / 110), rounded down".
+        partial: { kind: "add", total: fx(18), floor: true },
+        full: { 0: { damage: fx(28.0) } },
+      },
       superArmourFrames: [9, 20],
       hitboxes: [
         {
           id: 0,
-          startFrame: 19,
-          endFrame: 20,
+          startFrame: 26,
+          endFrame: 27,
           x: fx(10.0),
           y: fx(8.0),
           radius: fx(5.5),
           damage: fx(10.0),
```

`src/fighters/kirby.ts` — apply:

```diff
--- a/src/fighters/kirby.ts
+++ b/src/fighters/kirby.ts
@@ -668,10 +668,23 @@ const legacy: FighterDef = {
 
     sideB: {
       slot: "sideB",
       name: "Hammer Flip",
-      totalFrames: 54,
-      chargeable: true,
+      totalFrames: 69,
+      // Hold mode (Plan 5), SmashWiki "Kirby (SSBU)/Side special": "Total
+      // charge time 120 frames", "Charges between 15-16"; before full "each
+      // charge frame adding 0.085% damage to the hitboxes, for a maximum of
+      // 29.115%" (0.085 × 120 = 10.2 over the whole charge); full charge
+      // "changed directly": 35%, angle 361, same BK/KS. Interruptible 70.
+      // UNVERIFIED-simplified: the full-charge recoil (every 26 frames) and the
+      // full-charge intangibility/armour are not modelled.
+      specialCharge: {
+        mode: "hold",
+        frames: 120,
+        loopFrame: 15,
+        partial: { kind: "add", total: fx(10.2) },
+        full: { 0: { damage: fx(35.0), angle: fx(361) } },
+      },
       hitboxes: [
         {
           // Uncharged this launches at 48 degrees for 19%. A **full charge
           // changes the angle to 361 and the damage to 35%** — the single
```

`src/fighters/link.ts` — apply:

```diff
--- a/src/fighters/link.ts
+++ b/src/fighters/link.ts
@@ -538,9 +538,14 @@ const legacy: FighterDef = {
     neutralB: {
       slot: "neutralB",
       name: "Hero's Bow",
       totalFrames: 44,
-      chargeable: true,
+      // Hold mode (Plan 5), SmashWiki "Link (SSBU)/Neutral special": "Total
+      // charge time 60 frames", "Charges between 15-16", arrow "16-61 (1-46)"
+      // from release, damage "4 + 8 * (charge frames / 60)", speed 2.6
+      // uncharged → 10 full. UNVERIFIED-simplified: "with at least 36 charge
+      // frames, the move immediately skips to full charge" is not modelled.
+      specialCharge: { mode: "hold", frames: 60, loopFrame: 15 },
       hitboxes: [],
       projectiles: [
         {
           // Loosed on frame 16, flying flat and fast for 46 frames before
@@ -554,15 +559,16 @@ const legacy: FighterDef = {
           id: "arrow",
           spawnFrame: 16,
           offsetX: fx(9.0),
           offsetY: fx(7.0),
-          vx: fx(3.4),
+          vx: fx(2.6),
           vy: fx(0),
           // Flat for most of its life; the late droop is the small gravity.
           gravity: fx(0.014),
           lifetime: 46,
           destroyOnHit: true,
-          chargeScaling: fx(3),
+          // Damage "4 + 8 * (charge frames / 60), rounded down"; speed linear.
+          charged: { vx: fx(10.0), hitbox: { damage: fx(12.0) }, partial: { kind: "add", total: fx(8), floor: true } },
           visual: "arrow",
           hitbox: {
             id: 0,
             startFrame: 0,
```

`src/fighters/marth.ts` — apply:

```diff
--- a/src/fighters/marth.ts
+++ b/src/fighters/marth.ts
@@ -733,9 +733,20 @@ const legacy: FighterDef = {
     neutralB: {
       slot: "neutralB",
       name: "Shield Breaker",
       totalFrames: 50,
-      chargeable: true,
+      // Hold mode (Plan 5), SmashWiki "Marth (SSBU)/Neutral special": "Total
+      // charge time 60 frames", "Charges between 11-12"; before full "the
+      // damage multiplier is equal to 1 + 1.2 * (charge frames / 60)" (17.44% /
+      // 19.62% at most), and "when fully charged, the hitboxes are instead
+      // changed directly": 24% (tip) and 22% (body), the knockback unchanged.
+      specialCharge: {
+        mode: "hold",
+        frames: 60,
+        loopFrame: 11,
+        partial: { kind: "multiply", by: fx(1.2) },
+        full: { 0: { damage: fx(24.0) }, 1: { damage: fx(22.0) } },
+      },
       // Charge scales **damage and shield damage only** — angle, base knockback
       // and growth are frozen across the whole range (361 / 30 / 90 on the
       // body, 361 / 60 / 100 on the tip). Damage runs 8% → 22% on the body and
       // 9% → 24% on the tip; shield damage runs 25 → 50, which is the actual
```

`src/fighters/pikachu.ts` — apply:

```diff
--- a/src/fighters/pikachu.ts
+++ b/src/fighters/pikachu.ts
@@ -629,9 +629,19 @@ const legacy: FighterDef = {
       slot: "sideB",
       name: "Skull Bash",
       totalFrames: 96,
       momentum: [{ frame: 22, x: fx(4.0), y: fx(0.5), hold: 10 }],
-      chargeable: true,
+      // Hold mode (Plan 5), SmashWiki "Pikachu (SSBU)/Side special": "Total
+      // charge time 80 frames", "Charges between 13-14", damage "6.2 + 15.2 *
+      // (charge frames / 80)" — the damage alone. UNVERIFIED: the release
+      // speed 1.6 → 3.2, which the momentum does not scale.
+      specialCharge: {
+        mode: "hold",
+        frames: 80,
+        loopFrame: 13,
+        partial: { kind: "add", total: fx(15.2) },
+        full: { 0: { damage: fx(21.4) }, 1: { damage: fx(21.4) } },
+      },
       hitboxes: [
         {
           // Charges from frames 13-14 and launches him forward. Damage scales
           // 6.2% uncharged → 10% on a smash input → 21.4% at full charge. FAF
```

`src/fighters/samus.ts` — apply:

```diff
--- a/src/fighters/samus.ts
+++ b/src/fighters/samus.ts
@@ -606,46 +606,52 @@ const legacy: FighterDef = {
     neutralB: {
       slot: "neutralB",
       name: "Charge Shot",
       totalFrames: 44,
-      chargeable: true,
-      // PROJECTILE: a plasma ball spawned at the arm cannon and travelling flat
-      // forward. 13 frames to enter the charge state, **125 frames to fill**,
-      // then release on frame 3 (16 from a stored full charge). Damage runs
-      // 5% → 28%, and the *angle changes with it*: uncharged fires at the
-      // Sakurai angle with KBG 42, fully charged at a fixed 40 degrees with
-      // KBG 50 and BKB 46. Charge is stored between uses and survives shielding
-      // and dodging, and Ultimate is the first game where it can be charged in
-      // midair. Being hit while charging loses the lot.
-      //
-      // UNVERIFIED: whether the charge survives a KO. It is widely believed to,
-      // but SmashWiki's chargeable-specials table lists only Oil Panic and
-      // Wario Waft as surviving a stock loss and gives Charge Shot no such
-      // note, which implies it does not. Not asserted either way.
+      // Store mode (Plan 5): 13 frames to enter the charge state, then 112
+      // charge frames to full — SmashWiki "Samus (SSBU)/Neutral special":
+      // "Total charge time 112 frames"; UFD's "125 frames to reach full charge"
+      // counts the 13 as well. Shield or jump puts the charge away; B fires it,
+      // the shot leaving 3 frames after release (hitbox 16 = 13 + 3); a stored
+      // full charge fires straight from the loop. Being hit while charging
+      // loses the charge built this time. UNVERIFIED-simplified: SSBU's
+      // 4-frame charge-cancel lag and the longer full-charge FAF (61 against
+      // 45) are not modelled.
       //
-      // The projectile below is the uncharged shot; `chargeScaling` 5.6 takes
-      // its 5% to the 28% of a full charge.
+      // UNVERIFIED: whether a stored charge survives a KO. SmashWiki's
+      // chargeable-specials table lists only Oil Panic and Wario Waft as
+      // surviving a stock loss; the replica keeps it.
+      specialCharge: { mode: "store", frames: 112, loopFrame: 13 },
       hitboxes: [],
       projectiles: [
         {
+          // samus_cshot `Shoot` (rubendal Data Viewer 13.0.1): ATTACK 0 is the
+          // uncharged shot, ATTACK 1 the full charge, and
+          // `attack(MA_MSC_CMD_ATTACK_SET_LERP, 0, 1)` interpolates between
+          // them by charge. SmashWiki: damage 5 + 23·c/112, BK 14 + 32·c/112,
+          // KS 42 + 8·c/112, radius 1.9 + 6.1·c/112; speed 1.6 → 3.3;
+          // lifetime 60.
           id: "chargeShot",
-          spawnFrame: 3,
+          spawnFrame: 16,
           offsetX: fx(8.0),
           offsetY: fx(7.0),
-          vx: fx(3.0),
+          vx: fx(1.6),
           vy: fx(0),
           gravity: fx(0),
           lifetime: 60,
           destroyOnHit: true,
-          chargeScaling: fx(5.6),
+          charged: {
+            vx: fx(3.3),
+            hitbox: { damage: fx(28.0), angle: fx(40), baseKnockback: fx(46), knockbackGrowth: fx(50), radius: fx(8.0) },
+          },
           visual: "energy",
           hitbox: {
             id: 0,
             startFrame: 0,
             endFrame: 60,
             x: fx(0),
             y: fx(0),
-            radius: fx(2.5),
+            radius: fx(1.9),
             damage: fx(5.0),
             angle: fx(361),
             baseKnockback: fx(14),
             knockbackGrowth: fx(42),
```

`src/render/chars/donkeyKong/fx.ts` — apply:

```diff
--- a/src/render/chars/donkeyKong/fx.ts
+++ b/src/render/chars/donkeyKong/fx.ts
@@ -82,9 +82,10 @@ export const fx: Partial<Record<MoveSlot, FxFn>> = {
    * glows, and it grows with the charge. The white ring on the armour frames is
    * the tell for "hitting him now will not stop this".
    */
   neutralB: ({ ctx, f, def, x, y, u, dir, frame, height, over }) => {
-    const charge = Math.min(1, f.charge / SMASH_CHARGE_MAX);
+    // Plan 5: a special's charge runs to its own length, not a smash's 60.
+    const charge = Math.min(1, f.charge / (def.moves.neutralB?.specialCharge?.frames ?? SMASH_CHARGE_MAX));
     const full = charge > 0.985;
     // The wind-up is a circle centred on the shoulder — measured at 0.6 of his
     // height in radius, which is the arm — and the fist runs round it up the
     // *front*, over the crown and away behind him. One revolution every eleven
```

`src/render/chars/marth/fx.ts` — apply:

```diff
--- a/src/render/chars/marth/fx.ts
+++ b/src/render/chars/marth/fx.ts
@@ -337,9 +337,9 @@ const tipper: FxFn = (c) => {
   // here. That is the cheaper of the two errors.
   const live = move.hitboxes.filter((hb) => !hb.grabbing);
   if (live.length === 0) return NOTHING;
   const opens = Math.min(...live.map((hb) => hb.startFrame));
-  if (move.chargeable && c.f.charge > 0 && c.frame === opens) return NOTHING;
+  if ((move.chargeable || move.specialCharge !== undefined) && c.f.charge > 0 && c.frame === opens) return NOTHING;
 
   const shoulder = c.height * 0.55;
   // Every window, not only the live one: Down Smash's back hit and Neutral Air's
   // second swing are separate sweetspots fifteen frames apart, and a flash that
```

`src/render/chars/samus/fx.ts` — apply:

```diff
--- a/src/render/chars/samus/fx.ts
+++ b/src/render/chars/samus/fx.ts
@@ -191,11 +191,15 @@ export const fx: Partial<Record<MoveSlot, FxFn>> = {
    *
    * Anchored on the projectile's own spawn point (8.0, 7.0) pulled back to the
    * muzzle, so the ball is born exactly where it was hanging.
    */
-  neutralB: ({ ctx, f, x, y, u, dir, frame }) => {
+  neutralB: ({ ctx, f, def, x, y, u, dir, frame }) => {
     const my = y - u * 7.0;
-    const charge = Math.min(1, f.charge / SMASH_CHARGE_MAX);
+    // Plan 5: a special's charge runs to its own length, not a smash's 60, and
+    // loops on its own frame (13), after which the shot is on its way.
+    const sc = def.moves.neutralB?.specialCharge;
+    const charge = Math.min(1, f.charge / (sc?.frames ?? SMASH_CHARGE_MAX));
+    const loopFrame = sc?.loopFrame ?? 2;
 
     /**
      * Still holding it, as opposed to having just fired it.
      *
@@ -209,9 +213,9 @@ export const fx: Partial<Record<MoveSlot, FxFn>> = {
      * The charge pins `actionFrame` to 1 and `frame` is `actionFrame + 1`, so
      * "she is still charging" is exactly `frame <= 2`, and the plasma leaves on
      * frame 3.
      */
-    if (f.charge > 0 && frame <= 2) {
+    if (f.charge > 0 && frame <= loopFrame) {
       /**
        * Radius runs 1.0 → 4.4 world units, so a full charge is **nine units
        * across against a twelve-unit fighter** — three quarters of her own
        * height. That is not exaggeration: measured off the game's own hurtbox
@@ -283,11 +287,13 @@ export const fx: Partial<Record<MoveSlot, FxFn>> = {
       circle(ctx, mx, my, r * (0.3 + 0.16 * charge));
       return NOTHING;
     }
 
-    // The shot leaving. Frame 3 is the spawn; the flare covers it either side.
+    // The shot leaving: timed from the end of the loop (Plan 5), so `at` is 2
+    // on the last held frame; the flare covers the spawn either side.
+    const at = frame - (loopFrame - 2);
     const mx = x + u * 7.2 * dir;
-    const k = decay(frame, 2, 7);
+    const k = decay(at, 2, 7);
     if (k > 0) {
       muzzleCone(ctx, mx, my, dir, u * 5.5 * k, u * 2.4 * k, k, PLASMA_PALE);
       blast(ctx, mx, my, u * 2.6, k, "#FFFFFF", PLASMA);
     }
@@ -295,9 +301,9 @@ export const fx: Partial<Record<MoveSlot, FxFn>> = {
     // wall of white vents out behind her as it goes — wider and taller than she
     // is, and the reason a Charge Shot reads as heavy from across the stage.
     // It outlives the flash by a long way, which is what separates it from the
     // muzzle bloom rather than doubling it.
-    const s = decay(frame, 3, 20);
+    const s = decay(at, 3, 20);
     if (s > 0) {
       for (let i = 0; i < 6; i++) {
         const age = (1 - s) * 20 - i * 2.2;
         if (age < 0) continue;
```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/engine/specialCharge.test.ts src/engine/states.test.ts src/fighters/charge.test.ts src/fighters/index.test.ts src/fighters/schema.test.ts src/game/simContext.test.ts src/render/chars/samus/samus.test.ts src/render/specialFx.test.ts`
Expected: PASS (`src/engine/specialCharge.test.ts` 7 tests, `src/fighters/charge.test.ts` 15 tests).

- [ ] **Step 5: Regenerate the generated files, in this order**

Each command rewrites one artefact from the code; the order matters (the limb list feeds the reconcile list and the bake, the bake feeds reach). Then review each diff against the scratch result below.

```bash
UPDATE_RECONCILE=1 pnpm vitest run src/fighters/acmd/reconcile.test.ts
UPDATE_BAKE=1 pnpm vitest run src/render3d/bake/roster.test.ts
UPDATE_GOLDEN=1 pnpm vitest run src/game/golden.test.ts
```

`src/fighters/acmd/reconcile.allow.json` — the expected change:

```diff
--- a/src/fighters/acmd/reconcile.allow.json
+++ b/src/fighters/acmd/reconcile.allow.json
@@ -10,8 +10,11 @@
   "mario uthrow hitboxes": "legacy some / game_throwhi none",
   "mario dthrow hitboxes": "legacy some / game_throwlw none",
   "donkeyKong ftilt faf": "legacy 35 / game_attacks3 36",
   "donkeyKong utilt lead": "legacy 10%/100°/bkb40/kbg115 / game_attackhi3 8%/100°/bkb40/kbg105",
+  "donkeyKong neutralB first": "legacy 26 / game_specialn 19",
+  "donkeyKong neutralB last": "legacy 27 / game_specialn 20",
+  "donkeyKong neutralB faf": "legacy 70 / game_specialn 63",
   "donkeyKong upB lead": "legacy 5%/95°/fkb90/kbg30 / game_specialhi 5%/95°/fkb30/kbg90",
   "donkeyKong downB hitboxes": "legacy some / game_speciallwstart none",
   "donkeyKong pummel faf": "legacy 22 / game_catchattack 8",
   "donkeyKong fthrow hitboxes": "legacy some / game_throwf none",
@@ -51,8 +54,9 @@
   "kirby dsmash faf": "legacy 51 / game_attacklw4 54",
   "kirby neutralB last": "legacy 44 / game_specialnstart 300",
   "kirby sideB first": "legacy 26 / game_specials 11",
   "kirby sideB last": "legacy 27 / game_specials 12",
+  "kirby sideB faf": "legacy 70 / game_specials 55",
   "kirby upB hitboxes": "legacy some / game_specialhi none",
   "kirby downB hitboxes": "legacy some / game_speciallw none",
   "kirby pummel faf": "legacy 16 / game_catchattack 6",
   "kirby fthrow hitboxes": "legacy some / game_throwf none",
```

`src/fighters/bake/digest.ts` — the bake's new digest:

```diff
--- a/src/fighters/bake/digest.ts
+++ b/src/fighters/bake/digest.ts
@@ -1,5 +1,5 @@
 // GENERATED by src/render3d/bake/roster.test.ts (UPDATE_BAKE=1) — do not edit by hand.
 /** SHA-256 of the uncompressed public/bake/roster.bin.gz: the bake's fingerprint. */
-export const BAKE_DIGEST = "2083d93d09334cb630c848a8fb9a52fe1f6c572ed1dc5fbc8cd1d60a5601b9ea";
+export const BAKE_DIGEST = "b0083de1f96cad28fd733ee68736aebfd595ba3ca629d8f098baa55da09d78c2";
 /** Its uncompressed length in bytes. */
-export const BAKE_BYTES = 5456779;
+export const BAKE_BYTES = 5461467;
```

**Golden trace — deliberate behaviour change.** donkeyKong-pikachu-finalDestination diverges: the CPUs' neutral specials now charge (Giant Punch stores, Skull Bash holds) instead of firing at once. The other three traces must not change.

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0; golden trace regenerated as above.

- [ ] **Step 7: Commit**

```bash
git add super-smash/public/bake/roster.bin.gz super-smash/src/engine/combat.ts super-smash/src/engine/constants.ts super-smash/src/engine/hash.ts super-smash/src/engine/projectile.ts super-smash/src/engine/simulate.ts super-smash/src/engine/specialCharge.test.ts super-smash/src/engine/specialCharge.ts super-smash/src/engine/states.test.ts super-smash/src/engine/states.ts super-smash/src/engine/status/attack.ts super-smash/src/engine/types.ts super-smash/src/fighters/acmd/active.ts super-smash/src/fighters/acmd/reconcile.allow.json super-smash/src/fighters/bake/digest.ts super-smash/src/fighters/charge.test.ts super-smash/src/fighters/donkeyKong.ts super-smash/src/fighters/index.test.ts super-smash/src/fighters/kirby.ts super-smash/src/fighters/link.ts super-smash/src/fighters/marth.ts super-smash/src/fighters/pikachu.ts super-smash/src/fighters/samus.ts super-smash/src/fighters/schema.test.ts super-smash/src/game/__golden__/engine-trace.json super-smash/src/game/simContext.test.ts super-smash/src/render/chars/donkeyKong/fx.ts super-smash/src/render/chars/marth/fx.ts super-smash/src/render/chars/samus/fx.ts super-smash/src/render/chars/samus/samus.test.ts super-smash/src/render/specialFx.test.ts
git commit -m "super-smash: specials charge on B: Charge Shot and Giant Punch store, the rest hold; rules version 5" -m "Uncharged and full numbers from SmashWiki and the game_ scripts; below full each move follows its own published formula (linear, added, multiplied, rounded down), and a full charge replaces the boxes. Shield or jump stores a store-mode charge; the next B fires it. ENGINE_RULES_VERSION 5: Plan 5's first change to what step() does. Reconcile +4 (DK neutralB first/last/faf, Kirby sideB faf). Bake regenerated (charge loop motions). Golden trace regenerated: donkeyKong-pikachu diverges because both CPUs' neutral specials now charge." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Reflectors: Fox's Reflector, reflectable projectiles, move intangibility

SmashWiki (Fox (SSBU)/Down special): Reflector reflects projectiles ×1.4 speed and ×1.4 damage with lifetime ×1, a 8.5-unit bubble, a 50% damage cap, active frames 4–23 looping while B is held, turnable from frame 5, intangible frames 2–3, and stalls Fox in the air once. A reflected projectile becomes the reflector's, flies back, and counts `reflected`; the eighth reflection deletes it (`MAX_REFLECTIONS = 7`). Reflection is decided before clanks and hits each frame (`reflectProjectiles`). Every projectile in the roster says whether it can be reflected (`reflectable`).

**Files:**
- Create: `super-smash/src/engine/reflect.test.ts`, `super-smash/src/engine/reflect.ts`, `super-smash/src/fighters/reflect.test.ts`
- Modify: `super-smash/src/engine/combat.ts`, `super-smash/src/engine/hash.ts`, `super-smash/src/engine/simulate.ts`, `super-smash/src/engine/states.ts`, `super-smash/src/engine/status/attack.ts`, `super-smash/src/engine/types.ts`, `super-smash/src/fighters/fox.ts`, `super-smash/src/fighters/link.ts`, `super-smash/src/fighters/mario.ts`, `super-smash/src/fighters/pikachu.ts`, `super-smash/src/fighters/samus.ts`

**Interfaces:**
- Consumes: `ProjectileState.source/reflected` (Task 1), `resolveHits` (Plan 3 `simulate.ts`).
- Produces: `src/engine/reflect.ts`: `MAX_REFLECTIONS`, `activeReflector`, `reflectorBubble`, `reflectProjectile`, `reflectProjectiles`, `reflectorMain`, `reflectorStallExec`; `ReflectorDef`; `MoveDef.reflector?`, `MoveDef.intangible?`, `ProjectileDef.reflectable?`; `moveIntangibility`, `updateDodgeIntangibility`; `StepEvents.reflects`; `CombatState.reflectHold`, `.specialStall`, `.stalling`.

- [ ] **Step 1: Write the failing tests**

`src/engine/reflect.test.ts` (new file):

```ts
import { describe, expect, it } from "vitest";

import { ONE, fx, mul } from "./fixed";
import { emptyEvents } from "./types";
import { MAX_REFLECTIONS, activeReflector, reflectProjectile, reflectProjectiles } from "./reflect";
import type { ReflectCandidate } from "./reflect";
import { createInitialState } from "./simulate";
import type { SimContext } from "./simulate";
import type { FighterDef, MatchRules, ProjectileDef, ProjectileState, ReflectorDef, StageDef } from "./types";

const REFLECTOR: ReflectorDef = {
  active: [4, 23],
  radius: fx(8.5),
  x: 0,
  y: fx(6.5),
  damage: fx(1.4),
  speed: fx(1.4),
  lifetime: fx(1),
  maxDamage: fx(50),
  holdAfterReflect: 20,
};

const SHOT: ProjectileDef = {
  id: "shot",
  spawnFrame: 1,
  offsetX: 0,
  offsetY: 0,
  vx: fx(2),
  vy: 0,
  gravity: 0,
  lifetime: 40,
  visual: "energy",
  reflectable: true,
  hitbox: { id: 0, startFrame: 0, endFrame: 40, x: 0, y: 0, radius: fx(2), damage: fx(10), angle: fx(45), baseKnockback: fx(30), knockbackGrowth: fx(50) },
};

const DEF = {
  id: "t",
  name: "T",
  series: "",
  number: 0,
  attributes: {} as FighterDef["attributes"],
  moves: { downB: { slot: "downB", name: "Reflector", totalFrames: 36, hitboxes: [], reflector: REFLECTOR }, neutralB: { slot: "neutralB", name: "Shot", totalFrames: 20, hitboxes: [], projectiles: [SHOT] } },
  palette: {} as FighterDef["palette"],
  blurb: "",
} as unknown as FighterDef;

const STAGE: StageDef = {
  id: "s",
  name: "S",
  series: "",
  platforms: [{ x: 0, y: 0, halfWidth: fx(100), soft: false, ledges: true }],
  blastZone: { left: fx(-200), right: fx(200), top: fx(200), bottom: fx(-100) },
  spawns: [{ x: fx(-20), y: 0 }, { x: fx(20), y: 0 }],
  theme: "",
};
const CTX: SimContext = { fighter: () => DEF, stage: () => STAGE };
const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true };

function shotAt(x: number, over: Partial<ProjectileState> = {}): ProjectileState {
  return { instanceId: 1, defId: "shot", owner: 0, x, y: fx(6), vx: fx(2), vy: 0, facing: 1, age: 10, bouncesLeft: 0, chargeScale: ONE, hitPorts: [0], returning: false, source: "t", charge: 0, reflected: 0, ...over };
}

function scene(p: ProjectileState, damage = SHOT.hitbox.damage) {
  const s = createInitialState("s", [{ defId: "t" }, { defId: "t" }], RULES, 1, CTX);
  const fox = s.fighters[1];
  Object.assign(fox, { action: "special", move: "downB", actionFrame: 5, x: fx(20), y: 0, facing: -1 });
  s.projectiles.push(p);
  const c: ReflectCandidate = { projectile: p, hitbox: { radius: SHOT.hitbox.radius, damage }, x: p.x, y: p.y, prevX: p.x - p.vx, prevY: p.y, suppressed: false };
  const events = emptyEvents();
  const destroyed = new Set<number>();
  reflectProjectiles(s, [DEF, DEF], () => SHOT, [c], events, destroyed);
  return { s, c, events, destroyed };
}

describe("activeReflector", () => {
  it("is up only inside its frames", () => {
    const s = createInitialState("s", [{ defId: "t" }], RULES, 1, CTX);
    const f = s.fighters[0];
    Object.assign(f, { action: "special", move: "downB" });
    f.actionFrame = 2; // game frame 3
    expect(activeReflector(f, DEF)).toBeNull();
    f.actionFrame = 3; // game frame 4
    expect(activeReflector(f, DEF)).toBe(REFLECTOR);
    f.actionFrame = 23; // game frame 24
    expect(activeReflector(f, DEF)).toBeNull();
  });
});

describe("reflectProjectile", () => {
  it("hands it over, reverses and speeds it, multiplies its damage, renews it and clears its record", () => {
    const p = shotAt(fx(15));
    const s = createInitialState("s", [{ defId: "t" }, { defId: "t" }], RULES, 1, CTX);
    reflectProjectile(p, SHOT, s.fighters[1], REFLECTOR);
    expect(p.owner).toBe(1);
    expect(p.vx).toBe(-mul(fx(2), fx(1.4)));
    expect(p.facing).toBe(-1);
    expect(p.chargeScale).toBe(fx(1.4));
    expect(p.age).toBe(0);
    expect(p.hitPorts).toEqual([]);
    expect(p.reflected).toBe(1);
  });

  it("renews a lifetime multiplier below one as that share of the whole (Cape: 0.75)", () => {
    const p = shotAt(fx(15));
    const s = createInitialState("s", [{ defId: "t" }, { defId: "t" }], RULES, 1, CTX);
    reflectProjectile(p, SHOT, s.fighters[1], { ...REFLECTOR, lifetime: fx(0.75) });
    expect(p.age).toBe(10);
  });
});

describe("reflectProjectiles", () => {
  it("reflects a reflectable projectile that reaches the bubble, and the candidate does not hit", () => {
    const { s, c, events } = scene(shotAt(fx(15)));
    expect(c.suppressed).toBe(true);
    expect(s.projectiles[0].owner).toBe(1);
    expect(events.reflects).toEqual([{ port: 1, x: fx(15), y: fx(6) }]);
    expect(s.fighters[1].combat.reflectHold).toBe(20);
  });

  it("lets a projectile past the damage threshold through (SmashWiki: 50%)", () => {
    const { c, s } = scene(shotAt(fx(15)), fx(51));
    expect(c.suppressed).toBe(false);
    expect(s.projectiles[0].owner).toBe(0);
  });

  it("deletes a projectile that has already been reflected seven times", () => {
    const { c, destroyed } = scene(shotAt(fx(15), { reflected: MAX_REFLECTIONS }));
    expect(c.suppressed).toBe(true);
    expect(destroyed.has(1)).toBe(true);
  });

  it("never reflects its owner's own projectile", () => {
    const { c } = scene(shotAt(fx(15), { owner: 1 }));
    expect(c.suppressed).toBe(false);
  });
});
```

`src/fighters/reflect.test.ts` (new file):

```ts
/**
 * Fox's Reflector against real projectiles, through the real `step()` (Plan 5,
 * Task 3). Numbers: SmashWiki "Fox (SSBU)/Down special" — ×1.4 damage, ×1.4
 * speed, reflects frames 4–23, loops while B is held, turns from frame 5,
 * stalls once per airtime; SmashWiki "Reflect" — seven reflections at most.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { fx, toFloat } from "@/engine/fixed";
import { MAX_REFLECTIONS } from "@/engine/reflect";
import { findProjectileDef, spawnProjectile } from "@/engine/projectile";
import { createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { Btn } from "@/engine/types";
import type { GameState, InputFrame, MatchRules, StepEvents } from "@/engine/types";
import { STAGES } from "@/stages";
import { FIGHTERS, fox } from "./index";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true };

beforeAll(() => {
  registerFighters(FIGHTERS);
  registerStages(STAGES);
});

/** Two fighters on Final Destination facing each other `gap` apart; port 0 on the left. */
function duel(left: string, right: string, gap = 40): GameState {
  const s = createInitialState("finalDestination", [{ defId: left }, { defId: right }], RULES, 5);
  s.fighters.forEach((f, i) =>
    Object.assign(f, {
      action: "stand",
      actionFrame: 0,
      grounded: true,
      platform: 0,
      x: fx(i === 0 ? -gap / 2 : gap / 2),
      y: 0,
      facing: i === 0 ? 1 : -1,
      intangible: 0,
    }),
  );
  return s;
}

type Script = (frame: number) => [InputFrame, InputFrame];

function run(s0: GameState, frames: number, script: Script): { state: GameState; events: StepEvents[]; states: GameState[] } {
  let s = s0;
  let prev: [InputFrame, InputFrame] = [0, 0];
  const events: StepEvents[] = [];
  const states: GameState[] = [];
  for (let i = 0; i < frames; i++) {
    const now = script(i);
    const out = step(s, now, { prevInputs: prev });
    s = out.state;
    prev = now;
    events.push(out.events);
    states.push(s);
  }
  return { state: s, events, states };
}

describe("Fox's Reflector", () => {
  it("sends Mario's fireball back at him, faster and 1.4× harder", () => {
    // Mario throws on frame 0; Fox raises the reflector as it nears and holds it.
    const { state, events, states } = run(duel("mario", "fox"), 120, (i) => [i === 0 ? Btn.Special : 0, i >= 14 ? Btn.Down | Btn.Special : 0]);
    const reflected = events.findIndex((e) => e.reflects.length > 0);
    expect(reflected).toBeGreaterThan(0);
    expect(events[reflected].reflects[0].port).toBe(1);
    const after = states[reflected].projectiles[0];
    expect(after.owner).toBe(1);
    expect(after.vx).toBeLessThan(0);
    expect(after.reflected).toBe(1);
    // Mario takes the fireball's 5% × 1.4 × 1.2 (one-on-one); Fox takes nothing.
    expect(toFloat(state.fighters[0].damage)).toBeCloseTo(5 * 1.4 * 1.2, 2);
    expect(state.fighters[1].damage).toBe(0);
  });

  it("stays up while B is held and ends 14 frames after it is let go", () => {
    const held = run(duel("mario", "fox", 80), 90, (i) => [0, i < 70 ? Btn.Down | Btn.Special : 0]).states;
    expect(held[60].fighters[1].move).toBe("downB");
    const release = 70;
    const done = held.findIndex((s, i) => i >= release && s.fighters[1].action !== "special");
    expect(done - release).toBeLessThanOrEqual(36 - 23 + 1);
    expect(done - release).toBeGreaterThanOrEqual(13);
  });

  it("turns round when back is held, from frame 5", () => {
    const { state } = run(duel("mario", "fox", 80), 12, (i) => [0, i === 0 ? Btn.Down | Btn.Special : i >= 6 ? Btn.Special | Btn.Right : Btn.Special]);
    expect(state.fighters[1].facing).toBe(1);
  });

  it("stalls a fall once per airtime, and not a second time", () => {
    const s = duel("mario", "fox", 80);
    Object.assign(s.fighters[1], { action: "fall", grounded: false, platform: -1, y: fx(80), vy: fx(-1.5) });
    const { states } = run(s, 80, (i) => [0, i === 0 || i === 40 ? Btn.Down | Btn.Special : 0]);
    expect(states[2].fighters[1].vy).toBe(0);
    expect(states[42].fighters[1].vy).toBeLessThan(0);
  });

  it("is intangible on frames 2-3", () => {
    const { states } = run(duel("mario", "fox", 80), 4, (i) => [0, i === 0 ? Btn.Down | Btn.Special : 0]);
    expect(states[1].fighters[1].intangible).toBeGreaterThan(0);
    expect(states[3].fighters[1].intangible).toBe(0);
  });
});

describe("Review Focus: a reflected projectile reflected again", () => {
  it("bounces between two reflectors, stacking ×1.4 each time, and is gone after seven", () => {
    // Two Foxes, both holding their reflectors; a laser from the right-hand one
    // is already on its way to the left-hand one.
    const s = duel("fox", "fox", 60);
    const laser = findProjectileDef(fox, "blaster")!;
    s.projectiles.push(spawnProjectile(laser, s.fighters[1], 1));
    s.nextProjectileId = 2;
    const both: [InputFrame, InputFrame] = [Btn.Down | Btn.Special, Btn.Down | Btn.Special];
    const { events, states } = run(s, 200, () => both);
    const reflections = events.flatMap((e) => e.reflects);
    expect(reflections.length).toBe(MAX_REFLECTIONS);
    // Each reflection hands it to the other side.
    expect(reflections.map((r) => r.port)).toEqual([0, 1, 0, 1, 0, 1, 0]);
    const second = events.findIndex((_, i) => events.slice(0, i + 1).flatMap((x) => x.reflects).length === 2);
    expect(toFloat(states[second].projectiles[0].chargeScale)).toBeCloseTo(1.96, 2);
    // The eighth touch deletes it rather than reflecting it again, and nobody was hit.
    expect(states[states.length - 1].projectiles).toHaveLength(0);
    expect(states[states.length - 1].fighters.every((f) => f.damage === 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/engine/reflect.test.ts src/fighters/reflect.test.ts`
Expected: FAIL — Both files fail to load: `Failed to resolve import "./reflect" from "src/engine/reflect.test.ts"` and `Failed to resolve import "@/engine/reflect" from "src/fighters/reflect.test.ts"` (no tests run).

- [ ] **Step 3: Implement**

`src/engine/combat.ts` — apply:

```diff
--- a/src/engine/combat.ts
+++ b/src/engine/combat.ts
@@ -50,8 +50,14 @@ export interface CombatState {
    * Shot, Giant Punch, F.L.U.D.D.); 0 for none. Survives shielding, jumping
    * and being hit; spent by the next use of that special.
    */
   storedCharge: number;
+  /** Plan 5: frames a reflector must stay up after reflecting something (Fox: 20). */
+  reflectHold: number;
+  /** Plan 5: this airtime's one special stall is spent (Reflector, Cape); reset on landing or a ledge. */
+  specialStall: boolean;
+  /** Plan 5: the current move is the one stalling (it took the airtime's stall). */
+  stalling: boolean;
 }
 
 export function emptyCombat(): CombatState {
   return {
@@ -68,8 +74,11 @@ export function emptyCombat(): CombatState {
     autolink: false,
     autolinkX: 0,
     autolinkY: 0,
     storedCharge: 0,
+    reflectHold: 0,
+    specialStall: false,
+    stalling: false,
   };
 }
 
 export function cloneCombat(c: CombatState): CombatState {
@@ -87,6 +96,9 @@ export function cloneCombat(c: CombatState): CombatState {
     autolink: c.autolink,
     autolinkX: c.autolinkX,
     autolinkY: c.autolinkY,
     storedCharge: c.storedCharge,
+    reflectHold: c.reflectHold,
+    specialStall: c.specialStall,
+    stalling: c.stalling,
   };
 }
```

`src/engine/hash.ts` — apply:

```diff
--- a/src/engine/hash.ts
+++ b/src/engine/hash.ts
@@ -176,8 +176,11 @@ export function mixCombat(h: number, c: CombatState): number {
   x = mixBool(x, c.autolink);
   x = mixInt(x, c.autolinkX);
   x = mixInt(x, c.autolinkY);
   x = mixInt(x, c.storedCharge);
+  x = mixInt(x, c.reflectHold);
+  x = mixBool(x, c.specialStall);
+  x = mixBool(x, c.stalling);
   return x;
 }
 
 /** The KineticModule energies, in declaration order. */
```

`src/engine/reflect.ts` (new file):

```ts
/**
 * Reflectors (Plan 5, Task 3): Fox's Reflector and Mario's Cape.
 *
 * A reflector is a bubble a move raises for a span of frames. A reflectable
 * projectile that touches it changes hands: it belongs to the reflector's
 * owner from then on, flies back the way it came, faster and harder by the
 * move's multipliers, with its life renewed by the lifetime multiplier and its
 * hit record cleared so it can hit the fighter who threw it. SmashWiki
 * "Reflect": a projectile can be reflected at most seven times; a projectile
 * past the reflector's damage threshold is not reflected and hits instead.
 *
 * Everything here mutates the projectile and the reflector's fighter only, so
 * it rolls back with them.
 */

import { ONE, mul } from "./fixed";
import { circle, sweptCapsulePenetration } from "./hitbox";
import type { Capsule } from "./hitbox";
import { moveFrameOf } from "./hitbox";
import { kineticSetX, kineticSetY } from "./kinetic";
import { fighterParams } from "./params";
import type { Intent, StateContext } from "./states";
import type { FighterDef, FighterState, GameState, ProjectileDef, ProjectileState, ReflectorDef, StepEvents } from "./types";

/** SmashWiki "Reflect": "projectiles can only be reflected up to 7 times before disappearing." */
export const MAX_REFLECTIONS = 7;

/** The reflector this fighter has up this frame, if any. */
export function activeReflector(f: FighterState, def: FighterDef): ReflectorDef | null {
  if (f.move === null || (f.action !== "special" && f.action !== "attack")) return null;
  const r = def.moves[f.move]?.reflector;
  if (r === undefined) return null;
  const g = moveFrameOf(f.actionFrame);
  return g >= r.active[0] && g <= r.active[1] ? r : null;
}

/** Where the bubble is: `r.y` above the fighter's origin, `r.x` in front. */
export function reflectorBubble(f: FighterState, r: ReflectorDef): Capsule {
  return circle(f.x + (f.facing >= 0 ? r.x : -r.x), f.y + r.y, r.radius);
}

/** The projectile as the reflector sends it back. Pure in the projectile's fields. */
export function reflectProjectile(p: ProjectileState, def: ProjectileDef, by: FighterState, r: ReflectorDef): void {
  p.owner = by.port;
  p.vx = -mul(p.vx, r.speed);
  p.facing = -p.facing;
  p.chargeScale = mul(p.chargeScale, r.damage);
  // Lifetime ×m: it has `lifetime · m` frames left from here. UNVERIFIED
  // reading of SmashWiki's "Lifetime multiplier" — it renews the clock.
  p.age = def.lifetime - Math.trunc((def.lifetime * r.lifetime) / ONE);
  p.hitPorts.length = 0;
  p.returning = false;
  p.reflected += 1;
}

export interface ReflectCandidate {
  readonly projectile: ProjectileState | null;
  readonly hitbox: { readonly radius: number; readonly damage: number };
  readonly x: number;
  readonly y: number;
  readonly prevX: number;
  readonly prevY: number;
  suppressed: boolean;
}

/**
 * Phase 6a: every projectile that touches a raised reflector is reflected
 * before anything clanks or hits. Fighters are tried in port order, so two
 * reflectors meeting one projectile resolve the same way on both peers.
 */
export function reflectProjectiles(
  s: GameState,
  defs: readonly FighterDef[],
  projectileDef: (p: ProjectileState) => ProjectileDef | undefined,
  candidates: ReflectCandidate[],
  events: StepEvents,
  destroyed: Set<number>,
): void {
  for (const c of candidates) {
    const p = c.projectile;
    if (p === null || c.suppressed || destroyed.has(p.instanceId)) continue;
    const def = projectileDef(p);
    if (def === undefined || def.reflectable !== true) continue;
    for (let i = 0; i < s.fighters.length; i++) {
      const f = s.fighters[i];
      if (i === p.owner || f.action === "dead") continue;
      const r = activeReflector(f, defs[i]);
      if (r === null) continue;
      if (sweptCapsulePenetration(c.prevX, c.prevY, c.x, c.y, 0, 0, c.hitbox.radius, reflectorBubble(f, r)) < 0) continue;
      // Past the threshold the projectile goes through and hits (SmashWiki:
      // "Damage threshold 50%"; "the projectile just passes through the
      // reflector and damages Fox normally").
      if (mul(c.hitbox.damage, p.chargeScale) > r.maxDamage) continue;
      c.suppressed = true;
      if (p.reflected >= MAX_REFLECTIONS) {
        destroyed.add(p.instanceId);
      } else {
        reflectProjectile(p, def, f, r);
        // Fox's reflector stays up at least 20 frames after a reflection.
        f.combat.reflectHold = r.holdAfterReflect;
        events.reflects.push({ port: f.port, x: p.x, y: p.y });
      }
      break;
    }
  }
}

/**
 * The reflector's own status logic, run from the special status's `main`.
 * Returns true when it consumed the frame.
 *
 * - **Loop** (`r.loop`, Fox): the reflecting frames repeat while B is held or
 *   a reflection's minimum period runs. After one full pass, letting go skips
 *   to the end (SmashWiki "Fox (SSBU)/Down special": "After one full loop,
 *   releasing the button at any point causes the move to transition into the
 *   ending portion"). `FighterState.charge` counts the passes, as it counts a
 *   smash's charge.
 * - **Turn** (`r.turnFrom`): holding back turns the fighter round from that
 *   frame of the reflecting frames.
 */
export function reflectorMain(f: FighterState, intent: Intent, r: ReflectorDef): boolean {
  if (f.combat.reflectHold > 0) f.combat.reflectHold -= 1;
  const g = moveFrameOf(f.actionFrame);
  if (r.turnFrom !== undefined && g >= r.turnFrom && g <= r.active[1] && intent.x === -f.facing) {
    f.facing = -f.facing;
  }
  if (r.loop === undefined) return false;
  const [from, to] = r.loop;
  const holding = intent.specialHeld || f.combat.reflectHold > 0;
  if (g === to + 1 && holding) {
    // Back to the first reflecting frame (actionFrame is game frame − 1).
    f.actionFrame = from - 1;
    f.charge += 1;
    return true;
  }
  if (f.charge >= 1 && !holding && g >= from && g <= to) {
    f.actionFrame = to;
    return true;
  }
  return false;
}

/**
 * The once-per-airtime stall (Fox: SmashWiki "However, it now only stalls Fox
 * once in midair"; "Horizontal speed multiplier on startup 0.5", "Period
 * before applying gravity 4 frames", "Gravity 0.027"). Run as the special
 * status's `exec`, after the FALL kinetic type has applied ordinary gravity.
 */
export function reflectorStallExec(f: FighterState, ctx: StateContext, r: ReflectorDef): void {
  const stall = r.stall;
  if (stall === undefined || f.grounded) return;
  const g = moveFrameOf(f.actionFrame);
  if (g === 1) {
    if (f.combat.specialStall) return;
    f.combat.specialStall = true;
    f.combat.stalling = true;
    kineticSetX(f, mul(f.vx, stall.startX));
  }
  if (!f.combat.stalling) return;
  if (g <= stall.noGravityFrames) {
    kineticSetY(f, 0);
    return;
  }
  // Undo the fighter's own gravity for this frame and apply the move's instead.
  const p = fighterParams(ctx.def);
  const terminal = -p.air_speed_y_stable;
  if (f.vy > terminal) kineticSetY(f, Math.max(terminal, f.vy + p.air_accel_y - stall.gravity));
}
```

`src/engine/simulate.ts` — apply:

```diff
--- a/src/engine/simulate.ts
+++ b/src/engine/simulate.ts
@@ -89,8 +89,9 @@ import {
   projectileHitboxActive,
   spawnProjectile,
 } from "./projectile";
 import { chargedHitbox } from "./specialCharge";
+import { reflectProjectiles } from "./reflect";
 import {
   blastZoneKO,
   ecbOf,
   findLedgeGrab,
@@ -677,8 +678,10 @@ export function step(
 
   const destroyed = new Set<number>();
   const candidates = gatherHitboxes(s, defs, prevPos, frozen, bones);
   appendProjectileCandidates(s, ctx, candidates, projectilePrev);
+  // Reflectors first: a reflected projectile neither clanks nor hits this frame (Plan 5).
+  reflectProjectiles(s, defs, (p) => projectileDefOf(ctx, p), candidates, events, destroyed);
   resolveClanks(s, candidates, events, destroyed);
   resolveHits(s, defs, bake, bones, candidates, intents, events, destroyed);
   if (destroyed.size > 0) {
     s.projectiles = s.projectiles.filter((p) => !destroyed.has(p.instanceId));
```

`src/engine/states.ts` — apply:

```diff
--- a/src/engine/states.ts
+++ b/src/engine/states.ts
@@ -376,8 +376,18 @@ export function chargeMultiplier(charge: number): number {
  * 0–2, which the real game deliberately does not. Instead the window is
  * re-asserted one frame at a time from inside it, which reproduces `[3, 20]`
  * exactly and leaves a longer grant (a ledge grab, a respawn) untouched.
  */
+/**
+ * A move's own intangible frames (Plan 5: `MoveDef.intangible`, quoted as game
+ * frames), as an `actionFrame` window for `updateDodgeIntangibility`.
+ */
+export function moveIntangibility(f: FighterState, def: FighterDef | undefined): readonly [number, number] | null {
+  if (def === undefined || f.move === null || (f.action !== "special" && f.action !== "attack")) return null;
+  const w = def.moves[f.move]?.intangible;
+  return w === undefined ? null : [w[0] - 1, w[1] - 1];
+}
+
 export function dodgeWindow(f: FighterState): readonly [number, number] | null {
   switch (f.action) {
     case "spotDodge":
       return SPOT_DODGE_INTANGIBLE;
@@ -396,10 +406,10 @@ export function dodgeWindow(f: FighterState): readonly [number, number] | null {
       return null;
   }
 }
 
-export function updateDodgeIntangibility(f: FighterState): void {
-  const w = dodgeWindow(f);
+export function updateDodgeIntangibility(f: FighterState, def?: FighterDef): void {
+  const w = dodgeWindow(f) ?? moveIntangibility(f, def);
   if (w === null) return;
   if (f.actionFrame >= w[0] && f.actionFrame <= w[1]) {
     f.intangible = Math.max(f.intangible, 1);
   }
@@ -629,9 +639,9 @@ export function handleActionable(f: FighterState, intent: Intent, ctx: StateCont
  * already working on its own clone by this point.
  */
 export function advanceFighter(f: FighterState, intent: Intent, ctx: StateContext): void {
   f.actionFrame += 1;
-  updateDodgeIntangibility(f);
+  updateDodgeIntangibility(f, ctx.def);
 
   const status = STATUS_TABLE[f.action];
   if (status === undefined) {
     // Every status lives in `status/` and registers itself from
@@ -850,8 +860,9 @@ export function onLanded(f: FighterState, ctx: StateContext): void {
   f.fastFalling = false;
   f.launchSpeed = 0;
   f.jumpsUsed = 0;
   f.airDodged = false;
+  f.combat.specialStall = false;
   f.airTime = 0;
   // The hop is over, so the next one decides its own height and its own damage.
   f.shortHop = false;
 
@@ -935,8 +946,9 @@ export function grabLedge(
   kineticClear(f);
   f.facing = -side;
   f.jumpsUsed = 0;
   f.airDodged = false;
+  f.combat.specialStall = false;
   f.fastFalling = false;
   f.shortHop = false;
   f.ledgeRegrabs += 1;
   f.intangible = Math.max(f.intangible, intangibility);
```

`src/engine/status/attack.ts` — apply:

```diff
--- a/src/engine/status/attack.ts
+++ b/src/engine/status/attack.ts
@@ -11,8 +11,9 @@
 import { SMASH_CHARGE_MAX } from "../constants";
 import { clearHitRecord } from "../hitbox";
 import { mashFrames } from "../shield";
 import { specialChargeMain } from "../specialCharge";
+import { reflectorMain, reflectorStallExec } from "../reflect";
 import {
   GRAB_MASH_BUTTON,
   GRAB_MASH_STICK,
   GRAB_MIN_FRAMES,
@@ -36,8 +37,10 @@ function attackMain(f: FighterState, intent: Intent, ctx: StateContext): void {
   if (move === undefined) {
     startAction(f, f.grounded ? "stand" : "fall");
     return;
   }
+  // A reflector loops and turns (Plan 5, `reflect.ts`).
+  if (f.action === "special" && move.reflector !== undefined && reflectorMain(f, intent, move.reflector)) return;
   // A charging special reads B, never the attack button (Plan 5).
   if (f.action === "special" && move.specialCharge !== undefined && specialChargeMain(f, intent, ctx, move.specialCharge)) {
     return;
   }
@@ -72,10 +75,19 @@ export const STATUS_ATTACK: FighterStatus = {
 export const STATUS_SPECIAL: FighterStatus = {
   kind: "FIGHTER_STATUS_KIND_SPECIAL",
   action: "special",
   kineticType: "FALL",
-  pre: clearHitRecord,
+  pre(f) {
+    clearHitRecord(f);
+    // Plan 5: a special's per-move bookkeeping starts clean.
+    f.combat.stalling = false;
+    f.combat.reflectHold = 0;
+  },
   main: attackMain,
+  exec(f, _intent, ctx) {
+    const r = f.move === null ? undefined : ctx.def.moves[f.move]?.reflector;
+    if (r !== undefined) reflectorStallExec(f, ctx, r);
+  },
 };
 
 export const STATUS_CATCH: FighterStatus = {
   kind: "FIGHTER_STATUS_KIND_CATCH",
```

`src/engine/types.ts` — apply:

```diff
--- a/src/engine/types.ts
+++ b/src/engine/types.ts
@@ -281,8 +281,37 @@ export interface ProjectileDef {
    */
   readonly charged?: { readonly hitbox: ChargedHitbox; readonly vx: number; readonly partial?: PartialCharge };
   /** Drawing hint for the renderer. */
   readonly visual: "arrow" | "bomb" | "boomerang" | "energy" | "fire" | "spark" | "missile";
+  /** A reflector can send it back (Plan 5): the article's `ATTACK(…, Reflectable=true)`. */
+  readonly reflectable?: boolean;
+}
+
+/**
+ * A reflector a move raises (Plan 5): Fox's Reflector, Mario's Cape. Frames
+ * are game frames of the move, quoted from one; multipliers are Q12.
+ */
+export interface ReflectorDef {
+  /** First and last frame the reflector is up. */
+  readonly active: readonly [number, number];
+  /** The bubble: radius, and its centre's offset from the origin (x facing-relative). */
+  readonly radius: number;
+  readonly x: number;
+  readonly y: number;
+  /** SmashWiki's "Damage multiplier", "Speed multiplier", "Lifetime multiplier". */
+  readonly damage: number;
+  readonly speed: number;
+  readonly lifetime: number;
+  /** "Damage threshold": a projectile hitting harder than this passes through. */
+  readonly maxDamage: number;
+  /** Frames the reflector stays up after a reflection however B is held (Fox: 20). */
+  readonly holdAfterReflect: number;
+  /** The reflecting frames repeat while B is held: first and last frame of the loop. */
+  readonly loop?: readonly [number, number];
+  /** From this frame, holding back turns the fighter round. */
+  readonly turnFrom?: number;
+  /** Once per airtime, the move stalls a fall (Fox's Reflector). */
+  readonly stall?: { readonly startX: number; readonly noGravityFrames: number; readonly gravity: number };
 }
 
 /** The numbers a charge changes on a hitbox; the rest of the box stays as authored. */
 export type ChargedHitbox = Partial<Pick<Hitbox, "damage" | "angle" | "baseKnockback" | "knockbackGrowth" | "radius">>;
@@ -340,8 +369,12 @@ export interface MoveDef {
   /** Smash attacks may be held to charge. */
   readonly chargeable?: boolean;
   /** A special that charges (Plan 5): on B, held or stored. See `SpecialCharge`. */
   readonly specialCharge?: SpecialCharge;
+  /** A reflector this move raises (Plan 5). */
+  readonly reflector?: ReflectorDef;
+  /** First and last move frame the fighter is intangible (Plan 5: SmashWiki "Intangibility a-b"). */
+  readonly intangible?: readonly [number, number];
   /** Frames the fighter may not be interrupted, for specials with armour. */
   readonly superArmourFrames?: readonly [number, number];
   /** A jab that loops until the button is released. */
   readonly rapid?: boolean;
@@ -772,8 +805,10 @@ export interface StepEvents {
   lands: { port: number; x: number; y: number }[];
   shieldBreaks: number[];
   smashBallBroken: number | null;
   finalSmashes: number[];
+  /** Projectiles sent back this frame, by whom and where (Plan 5). */
+  reflects: { port: number; x: number; y: number }[];
 }
 
 export function emptyEvents(): StepEvents {
   return {
@@ -785,6 +820,7 @@ export function emptyEvents(): StepEvents {
     lands: [],
     shieldBreaks: [],
     smashBallBroken: null,
     finalSmashes: [],
+    reflects: [],
   };
 }
```

`src/fighters/fox.ts` — apply:

```diff
--- a/src/fighters/fox.ts
+++ b/src/fighters/fox.ts
@@ -657,8 +657,10 @@ const legacy: FighterDef = {
           gravity: fx(0),
           lifetime: 22,
           destroyOnHit: false,
           visual: "energy",
+          // fox_blaster_bullet `Fly`: `Reflectable=true`.
+          reflectable: true,
           hitbox: {
             id: 0,
             startFrame: 0,
             endFrame: 22,
@@ -760,8 +762,32 @@ const legacy: FighterDef = {
       // Frame 3 hitbox, intangible on frames 2-3, and it **reflects from frame
       // 4 through 23** at 1.4x damage. See the correction in the file header:
       // this is not the frame-1 shine from Melee. Ultimate also lets it stall
       // his momentum only once per airtime.
+      //
+      // Plan 5 — SmashWiki "Fox (SSBU)/Down special": "Damage multiplier 1.4",
+      // "Speed multiplier 1.4", "Lifetime multiplier 1", "Size 8.5u", "Damage
+      // threshold 50%", "Intangibility 2-3", "Reflection 4-23", "Minimum
+      // reflection period 20 frames", "From frame 5 onward, Fox can also turn
+      // around", "Horizontal speed multiplier on startup 0.5", "Period before
+      // applying gravity 4 frames", "Gravity 0.027"; interruptible 37 is 14
+      // frames after the loop's last frame. UNVERIFIED: the bubble's centre,
+      // put where the move's 2% hitbox is (script `top` Y 6.5).
+      intangible: [2, 3],
+      reflector: {
+        active: [4, 23],
+        radius: fx(8.5),
+        x: fx(0),
+        y: fx(6.5),
+        damage: fx(1.4),
+        speed: fx(1.4),
+        lifetime: fx(1),
+        maxDamage: fx(50),
+        holdAfterReflect: 20,
+        loop: [4, 23],
+        turnFrom: 5,
+        stall: { startX: fx(0.5), noGravityFrames: 4, gravity: fx(0.027) },
+      },
       hitboxes: [
         {
           id: 0,
           startFrame: 3,
```

`src/fighters/link.ts` — apply:

```diff
--- a/src/fighters/link.ts
+++ b/src/fighters/link.ts
@@ -568,8 +568,10 @@ const legacy: FighterDef = {
           destroyOnHit: true,
           // Damage "4 + 8 * (charge frames / 60), rounded down"; speed linear.
           charged: { vx: fx(10.0), hitbox: { damage: fx(12.0) }, partial: { kind: "add", total: fx(8), floor: true } },
           visual: "arrow",
+          // link_bowarrow `Fly`: `Reflectable=true`.
+          reflectable: true,
           hitbox: {
             id: 0,
             startFrame: 0,
             endFrame: 46,
@@ -613,8 +615,10 @@ const legacy: FighterDef = {
           lifetime: 151,
           destroyOnHit: false,
           returns: true,
           visual: "boomerang",
+          // link_boomerang `Fly`: `Reflectable=true`.
+          reflectable: true,
           hitbox: {
             id: 0,
             startFrame: 0,
             endFrame: 151,
```

`src/fighters/mario.ts` — apply:

```diff
--- a/src/fighters/mario.ts
+++ b/src/fighters/mario.ts
@@ -612,8 +612,10 @@ const legacy: FighterDef = {
           lifetime: 70,
           destroyOnHit: true,
           bounces: 4,
           visual: "fire",
+          // mario_fireball `Regular`: `Reflectable=true`.
+          reflectable: true,
           hitbox: {
             id: 0,
             startFrame: 0,
             endFrame: 70,
```

`src/fighters/pikachu.ts` — apply:

```diff
--- a/src/fighters/pikachu.ts
+++ b/src/fighters/pikachu.ts
@@ -606,8 +606,10 @@ const legacy: FighterDef = {
           lifetime: 95,
           destroyOnHit: true,
           bounces: 8,
           visual: "spark",
+          // pikachu_dengekidama `Regular`: `Reflectable=true`.
+          reflectable: true,
           hitbox: {
             id: 0,
             startFrame: 0,
             endFrame: 95,
```

`src/fighters/samus.ts` — apply:

```diff
--- a/src/fighters/samus.ts
+++ b/src/fighters/samus.ts
@@ -643,8 +643,10 @@ const legacy: FighterDef = {
             vx: fx(3.3),
             hitbox: { damage: fx(28.0), angle: fx(40), baseKnockback: fx(46), knockbackGrowth: fx(50), radius: fx(8.0) },
           },
           visual: "energy",
+          // samus_cshot `Shoot`: `Reflectable=true`.
+          reflectable: true,
           hitbox: {
             id: 0,
             startFrame: 0,
             endFrame: 60,
@@ -687,8 +689,10 @@ const legacy: FighterDef = {
           gravity: fx(0),
           lifetime: 118,
           destroyOnHit: true,
           visual: "missile",
+          // samus_missile `Homing`: `Reflectable=true`.
+          reflectable: true,
           hitbox: {
             id: 0,
             startFrame: 0,
             endFrame: 118,
@@ -781,8 +785,10 @@ const legacy: FighterDef = {
           lifetime: 83,
           destroyOnHit: true,
           bounces: 1,
           visual: "bomb",
+          // samus_bomb `Fall`: `Reflectable=true`.
+          reflectable: true,
           hitbox: {
             // Live only at the end of its life — that is the detonation.
             id: 0,
             startFrame: 82,
```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/engine/reflect.test.ts src/fighters/reflect.test.ts`
Expected: PASS (`src/engine/reflect.test.ts` 7 tests, `src/fighters/reflect.test.ts` 6 tests).

- [ ] **Step 5: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0; golden trace untouched.

- [ ] **Step 6: Commit**

```bash
git add super-smash/src/engine/combat.ts super-smash/src/engine/hash.ts super-smash/src/engine/reflect.test.ts super-smash/src/engine/reflect.ts super-smash/src/engine/simulate.ts super-smash/src/engine/states.ts super-smash/src/engine/status/attack.ts super-smash/src/engine/types.ts super-smash/src/fighters/fox.ts super-smash/src/fighters/link.ts super-smash/src/fighters/mario.ts super-smash/src/fighters/pikachu.ts super-smash/src/fighters/reflect.test.ts super-smash/src/fighters/samus.ts
git commit -m "super-smash: Fox's Reflector: reflect, turn, loop, stall; reflectable projectiles" -m "x1.4 speed and damage, lifetime x1, 8.5 units, 50% cap, frames 4-23 looping, turnable from 5 (SmashWiki). A projectile reflected seven times is deleted on the eighth. Golden trace unchanged." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Mario's Cape: reflect, turn the victim, stall

SmashWiki (Mario (SSBU)/Side special) and `game_specials`: the Cape hits 7% at 110° (FKB 80, KBG 100) and turns whoever it hits (`collision_attr_turn` → `Hitbox.reverse`, kept through the legacy compiler); its reflector is up on frames 9–20 with SmashWiki's "Damage multiplier 1.5", "Speed multiplier 1", "Lifetime multiplier 0.75", "Size 6.5u" and "Damage threshold 50%"; and in the air it stalls Mario with the page's own numbers — "Horizontal speed divisor 2.5" (×0.4), "Vertical speed added 0.3", "Gravity 0.031", "Falling speed 1" (`StallDef`). UNVERIFIED: that the stall is once per airtime (Super Mario Wiki only), the reflector's centre, and its "Air friction 0.0025" (not modelled).

**Files:**
- Create: `super-smash/src/fighters/cape.test.ts`
- Modify: `super-smash/src/engine/acmd/hitboxes.ts`, `super-smash/src/engine/acmd/legacy.ts`, `super-smash/src/engine/reflect.ts`, `super-smash/src/engine/simulate.ts`, `super-smash/src/engine/status/attack.ts`, `super-smash/src/engine/types.ts`, `super-smash/src/fighters/fox.ts`, `super-smash/src/fighters/mario.ts`
- Regenerate: `super-smash/src/fighters/acmd/reconcile.allow.json`

**Interfaces:**
- Consumes: `reflectorMain`, `specialStallExec` (Task 3), `legacyGameScript` (Plan 2 `acmd/legacy.ts`).
- Produces: `StallDef`, `MoveDef.stall?`; `Hitbox.reverse?: boolean` (hitboxes.ts round-trips `collision_attr_turn`); `specialStallExec`.

- [ ] **Step 1: Write the failing test**

`src/fighters/cape.test.ts` (new file):

```ts
/**
 * Mario's Cape, through the real `step()` (Plan 5, Task 4). SmashWiki "Mario
 * (SSBU)/Side special": reflects frames 9–20 at ×1.5 damage; the hit (7%,
 * angle 110, FKB 80, KBG 100) turns the victim round; the first use in the air
 * stalls ("Vertical speed added 0.3").
 */

import { beforeAll, describe, expect, it } from "vitest";

import { fx, toFloat } from "@/engine/fixed";
import { findProjectileDef, spawnProjectile } from "@/engine/projectile";
import { createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { Btn } from "@/engine/types";
import type { GameState, InputFrame, MatchRules, StepEvents } from "@/engine/types";
import { STAGES } from "@/stages";
import { FIGHTERS, fox } from "./index";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true };

beforeAll(() => {
  registerFighters(FIGHTERS);
  registerStages(STAGES);
});

function duel(gap: number): GameState {
  const s = createInitialState("finalDestination", [{ defId: "mario" }, { defId: "fox" }], RULES, 5);
  s.fighters.forEach((f, i) =>
    Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(i === 0 ? -gap / 2 : gap / 2), y: 0, facing: i === 0 ? 1 : -1, intangible: 0 }),
  );
  return s;
}

function run(s0: GameState, frames: number, mario: (i: number) => InputFrame): { states: GameState[]; events: StepEvents[] } {
  let s = s0;
  let prev: [InputFrame, InputFrame] = [0, 0];
  const states: GameState[] = [];
  const events: StepEvents[] = [];
  for (let i = 0; i < frames; i++) {
    const now: [InputFrame, InputFrame] = [mario(i), 0];
    const out = step(s, now, { prevInputs: prev });
    s = out.state;
    prev = now;
    states.push(s);
    events.push(out.events);
  }
  return { states, events };
}

describe("Mario's Cape", () => {
  it("turns the opponent it hits round, for 7%", () => {
    const { states } = run(duel(10), 30, (i) => (i === 0 ? Btn.Right | Btn.Special : 0));
    const end = states[states.length - 1].fighters[1];
    expect(end.facing).toBe(1);
    expect(toFloat(end.damage)).toBeCloseTo(7 * 1.05 * 1.2, 2);
  });

  it("sends a laser back at ×1.5, Mario's now", () => {
    // Far enough that the laser arrives inside the reflecting frames (9-20).
    const s = duel(100);
    s.projectiles.push(spawnProjectile(findProjectileDef(fox, "blaster")!, s.fighters[1], 1));
    s.nextProjectileId = 2;
    const { states, events } = run(s, 30, (i) => (i === 0 ? Btn.Right | Btn.Special : 0));
    const at = events.findIndex((e) => e.reflects.length > 0);
    expect(at).toBeGreaterThanOrEqual(8);
    const p = states[at].projectiles[0];
    expect(p.owner).toBe(0);
    expect(toFloat(p.chargeScale)).toBeCloseTo(1.5, 3);
    expect(states[states.length - 1].fighters[0].damage).toBe(0);
  });

  it("stalls a fall the first time in an airtime, and only the first", () => {
    const s = duel(80);
    Object.assign(s.fighters[0], { action: "fall", grounded: false, platform: -1, y: fx(90), vy: fx(-1.4) });
    const { states } = run(s, 80, (i) => (i === 0 || i === 40 ? Btn.Right | Btn.Special : 0));
    expect(states[0].fighters[0].vy).toBeGreaterThan(0);
    expect(states[40].fighters[0].vy).toBeLessThan(0);
    // Falling at the Cape's own falling speed, not Mario's 1.5, while it lasts.
    expect(Math.min(...states.slice(1, 34).map((x) => x.fighters[0].vy))).toBeGreaterThanOrEqual(-fx(1));
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run src/fighters/cape.test.ts`
Expected: FAIL — `cape.test.ts`: 3 failed — `expected -1 to be 1` (the victim's facing), `expected -1 to be greater than or equal to 8` (no reflect), `expected -6090 to be greater than 0` (no stall).

- [ ] **Step 3: Implement**

`src/engine/acmd/hitboxes.ts` — apply:

```diff
--- a/src/engine/acmd/hitboxes.ts
+++ b/src/engine/acmd/hitboxes.ts
@@ -78,8 +78,9 @@ function attackHitbox(
     ...(a.direct ? {} : { direct: false }),
     ...(a.setWeight ? { setWeight: true } : {}),
     ...(SITUATION[a.situation] !== undefined ? { situation: SITUATION[a.situation] } : {}),
     ...(LR[a.facing] !== undefined ? { lr: LR[a.facing] } : {}),
+    ...(a.collisionAttr === "collision_attr_turn" ? { reverse: true } : {}),
   };
 }
 
 /** Which situations a `COLLISION_SITUATION_MASK_*` restricts a box to; GA (both) is no restriction. */
```

`src/engine/acmd/legacy.ts` — apply:

```diff
--- a/src/engine/acmd/legacy.ts
+++ b/src/engine/acmd/legacy.ts
@@ -79,9 +79,10 @@ export function attackFromHitbox(hb: Hitbox): AttackParams {
     flinchless: false,
     noHitlag: false,
     direct: true,
     situation: "COLLISION_SITUATION_MASK_GA",
-    collisionAttr: ATTR_OF_EFFECT[hb.effect ?? "normal"],
+    // Plan 5: a turning hit is SSBU's `collision_attr_turn` (Mario's Cape).
+    collisionAttr: hb.reverse === true ? "collision_attr_turn" : ATTR_OF_EFFECT[hb.effect ?? "normal"],
     region: "ATTACK_REGION_NONE",
     // Explicit either way, so the hitbox pipeline never classifies a legacy
     // move's angle as a meteor on its own (Plan 3, Task 16).
     meteor: hb.meteor === true,
```

`src/engine/reflect.ts` — apply:

```diff
--- a/src/engine/reflect.ts
+++ b/src/engine/reflect.ts
@@ -19,9 +19,9 @@ import type { Capsule } from "./hitbox";
 import { moveFrameOf } from "./hitbox";
 import { kineticSetX, kineticSetY } from "./kinetic";
 import { fighterParams } from "./params";
 import type { Intent, StateContext } from "./states";
-import type { FighterDef, FighterState, GameState, ProjectileDef, ProjectileState, ReflectorDef, StepEvents } from "./types";
+import type { FighterDef, FighterState, GameState, ProjectileDef, ProjectileState, ReflectorDef, StallDef, StepEvents } from "./types";
 
 /** SmashWiki "Reflect": "projectiles can only be reflected up to 7 times before disappearing." */
 export const MAX_REFLECTIONS = 7;
 
@@ -140,29 +140,34 @@ export function reflectorMain(f: FighterState, intent: Intent, r: ReflectorDef):
   return false;
 }
 
 /**
- * The once-per-airtime stall (Fox: SmashWiki "However, it now only stalls Fox
- * once in midair"; "Horizontal speed multiplier on startup 0.5", "Period
- * before applying gravity 4 frames", "Gravity 0.027"). Run as the special
- * status's `exec`, after the FALL kinetic type has applied ordinary gravity.
+ * A special's once-per-airtime stall (`MoveDef.stall`): Fox's Reflector
+ * (SmashWiki "However, it now only stalls Fox once in midair"; "Horizontal
+ * speed multiplier on startup 0.5", "Period before applying gravity 4
+ * frames", "Gravity 0.027") and Mario's Cape ("Horizontal speed divisor 2.5",
+ * "Vertical speed added 0.3", "Gravity 0.031", "Falling speed 1"). Run as the
+ * special status's `exec`, after the FALL kinetic type has applied the
+ * fighter's own gravity, which it replaces with the move's.
  */
-export function reflectorStallExec(f: FighterState, ctx: StateContext, r: ReflectorDef): void {
-  const stall = r.stall;
-  if (stall === undefined || f.grounded) return;
+export function specialStallExec(f: FighterState, ctx: StateContext, stall: StallDef): void {
+  if (f.grounded) return;
   const g = moveFrameOf(f.actionFrame);
   if (g === 1) {
     if (f.combat.specialStall) return;
     f.combat.specialStall = true;
     f.combat.stalling = true;
     kineticSetX(f, mul(f.vx, stall.startX));
+    // UNVERIFIED reading of "Vertical speed added": onto a fall stopped dead.
+    if (stall.boostY > 0) kineticSetY(f, Math.max(f.vy, 0) + stall.boostY);
   }
   if (!f.combat.stalling) return;
   if (g <= stall.noGravityFrames) {
     kineticSetY(f, 0);
     return;
   }
-  // Undo the fighter's own gravity for this frame and apply the move's instead.
   const p = fighterParams(ctx.def);
-  const terminal = -p.air_speed_y_stable;
-  if (f.vy > terminal) kineticSetY(f, Math.max(terminal, f.vy + p.air_accel_y - stall.gravity));
+  const terminal = -(stall.fallSpeed ?? p.air_speed_y_stable);
+  // Undo the fighter's own gravity for this frame and apply the move's instead.
+  const vy = g === 1 ? f.vy : f.vy + p.air_accel_y - stall.gravity;
+  kineticSetY(f, Math.max(terminal, vy));
 }
```

`src/engine/simulate.ts` — apply:

```diff
--- a/src/engine/simulate.ts
+++ b/src/engine/simulate.ts
@@ -1568,8 +1568,10 @@ function applyHit(
   // out of `grabHold`, and leaving their `grabbing` set would strand their
   // victim in `grabbed` — whose only exit is `grabbedBy < 0` — for good.
   releaseGrab(victim, s.fighters);
   startAction(victim, tumbles ? "tumble" : "hitstun");
+  // `collision_attr_turn` (Mario's Cape, Plan 5): the victim is turned round.
+  if (hb.reverse === true) victim.facing = -victim.facing;
 
   events.hits.push({
     attacker: attacker.port,
     victim: victim.port,
```

`src/engine/status/attack.ts` — apply:

```diff
--- a/src/engine/status/attack.ts
+++ b/src/engine/status/attack.ts
@@ -11,9 +11,9 @@
 import { SMASH_CHARGE_MAX } from "../constants";
 import { clearHitRecord } from "../hitbox";
 import { mashFrames } from "../shield";
 import { specialChargeMain } from "../specialCharge";
-import { reflectorMain, reflectorStallExec } from "../reflect";
+import { reflectorMain, specialStallExec } from "../reflect";
 import {
   GRAB_MASH_BUTTON,
   GRAB_MASH_STICK,
   GRAB_MIN_FRAMES,
@@ -83,10 +83,10 @@ export const STATUS_SPECIAL: FighterStatus = {
     f.combat.reflectHold = 0;
   },
   main: attackMain,
   exec(f, _intent, ctx) {
-    const r = f.move === null ? undefined : ctx.def.moves[f.move]?.reflector;
-    if (r !== undefined) reflectorStallExec(f, ctx, r);
+    const stall = f.move === null ? undefined : ctx.def.moves[f.move]?.stall;
+    if (stall !== undefined) specialStallExec(f, ctx, stall);
   },
 };
 
 export const STATUS_CATCH: FighterStatus = {
```

`src/engine/types.ts` — apply:

```diff
--- a/src/engine/types.ts
+++ b/src/engine/types.ts
@@ -217,8 +217,10 @@ export interface Hitbox {
   /** Per-move shieldstun scaling. 1.0 (`ONE`) unless stated. */
   readonly shieldstunMultiplier?: number;
   /** Drives downward regardless of the victim's position. */
   readonly meteor?: boolean;
+  /** `collision_attr_turn` (SmashWiki "Reverse"): the victim is turned round (Plan 5: Cape). */
+  readonly reverse?: boolean;
   /** This hitbox grabs rather than damages. */
   readonly grabbing?: boolean;
   /**
    * smash-script `direct`: the hit comes from the fighter's own body. Absent
@@ -308,10 +310,22 @@ export interface ReflectorDef {
   /** The reflecting frames repeat while B is held: first and last frame of the loop. */
   readonly loop?: readonly [number, number];
   /** From this frame, holding back turns the fighter round. */
   readonly turnFrom?: number;
-  /** Once per airtime, the move stalls a fall (Fox's Reflector). */
-  readonly stall?: { readonly startX: number; readonly noGravityFrames: number; readonly gravity: number };
+}
+
+/** A special's once-per-airtime stall (Plan 5): Fox's Reflector, Mario's Cape. Q12. */
+export interface StallDef {
+  /** Horizontal speed multiplier on the first frame (Cape: 1 / 2.5). */
+  readonly startX: number;
+  /** Vertical speed added on the first frame (Cape: 0.3). */
+  readonly boostY: number;
+  /** Frames with no gravity at all (Reflector: 4). */
+  readonly noGravityFrames: number;
+  /** The move's own gravity after that. */
+  readonly gravity: number;
+  /** The move's own falling speed, if it has one (Cape: 1). */
+  readonly fallSpeed?: number;
 }
 
 /** The numbers a charge changes on a hitbox; the rest of the box stays as authored. */
 export type ChargedHitbox = Partial<Pick<Hitbox, "damage" | "angle" | "baseKnockback" | "knockbackGrowth" | "radius">>;
@@ -371,8 +385,10 @@ export interface MoveDef {
   /** A special that charges (Plan 5): on B, held or stored. See `SpecialCharge`. */
   readonly specialCharge?: SpecialCharge;
   /** A reflector this move raises (Plan 5). */
   readonly reflector?: ReflectorDef;
+  /** The move stalls a fall, once per airtime (Plan 5). */
+  readonly stall?: StallDef;
   /** First and last move frame the fighter is intangible (Plan 5: SmashWiki "Intangibility a-b"). */
   readonly intangible?: readonly [number, number];
   /** Frames the fighter may not be interrupted, for specials with armour. */
   readonly superArmourFrames?: readonly [number, number];
```

`src/fighters/fox.ts` — apply:

```diff
--- a/src/fighters/fox.ts
+++ b/src/fighters/fox.ts
@@ -784,10 +784,10 @@ const legacy: FighterDef = {
         maxDamage: fx(50),
         holdAfterReflect: 20,
         loop: [4, 23],
         turnFrom: 5,
-        stall: { startX: fx(0.5), noGravityFrames: 4, gravity: fx(0.027) },
       },
+      stall: { startX: fx(0.5), boostY: 0, noGravityFrames: 4, gravity: fx(0.027) },
       hitboxes: [
         {
           id: 0,
           startFrame: 3,
```

`src/fighters/mario.ts` — apply:

```diff
--- a/src/fighters/mario.ts
+++ b/src/fighters/mario.ts
@@ -637,22 +637,62 @@ const legacy: FighterDef = {
       slot: "sideB",
       name: "Cape",
       totalFrames: 35,
       // The Cape's real job is not its 7%: it reverses an opponent's facing and
-      // reflects projectiles at 1.5x. Neither is expressible in `Hitbox`, so
-      // both are engine behaviour keyed off this slot.
+      // reflects projectiles at 1.5x (Plan 5). SmashWiki "Mario (SSBU)/Side
+      // special": reflects frames 9-20; "Damage multiplier 1.5", "Speed
+      // multiplier 1", "Lifetime multiplier 0.75", "Size 6.5u", "Damage
+      // threshold 50%"; the stall: "Horizontal speed divisor 2.5", "Vertical
+      // speed added 0.3", "Gravity 0.031", "Falling speed 1". UNVERIFIED: that
+      // the stall is once per airtime (Super Mario Wiki only) and the
+      // reflector's centre (put on the hitbox's, `top` Y 6.7, Z 5).
+      //
+      // The hitboxes are `game_specials` (rubendal Data Viewer 13.0.1): 7%,
+      // angle 110, KBG 100, FKB 80, `collision_attr_turn`, frames 12-14 — the
+      // legacy 70°/BKB 50/KBG 60 box was not the game's.
+      reflector: {
+        active: [9, 20],
+        radius: fx(6.5),
+        x: fx(5.0),
+        y: fx(6.7),
+        damage: fx(1.5),
+        speed: fx(1),
+        lifetime: fx(0.75),
+        maxDamage: fx(50),
+        holdAfterReflect: 0,
+      },
+      // The stall, from the same page's aerial parameters: speed ÷ 2.5 (×0.4),
+      // +0.3 up, gravity 0.031, falling speed 1. UNVERIFIED-simplified: its
+      // "Air friction 0.0025" is not modelled (Mario keeps his own).
+      stall: { startX: fx(0.4), boostY: fx(0.3), noGravityFrames: 0, gravity: fx(0.031), fallSpeed: fx(1) },
       hitboxes: [
         {
           id: 0,
           startFrame: 12,
           endFrame: 14,
-          x: fx(5.6),
-          y: fx(6.0),
-          radius: fx(4.0),
+          x: fx(9.7),
+          y: fx(6.7),
+          radius: fx(7.5),
           damage: fx(7.0),
-          angle: fx(70),
-          baseKnockback: fx(50),
-          knockbackGrowth: fx(60),
+          angle: fx(110),
+          baseKnockback: fx(80),
+          knockbackGrowth: fx(100),
+          setKnockback: true,
+          reverse: true,
+        },
+        {
+          id: 1,
+          startFrame: 12,
+          endFrame: 14,
+          x: fx(5.0),
+          y: fx(6.7),
+          radius: fx(5.0),
+          damage: fx(7.0),
+          angle: fx(110),
+          baseKnockback: fx(80),
+          knockbackGrowth: fx(100),
+          setKnockback: true,
+          reverse: true,
         },
       ],
     },
 
```

- [ ] **Step 4: Run it again**

Run: `pnpm vitest run src/fighters/cape.test.ts`
Expected: PASS (`src/fighters/cape.test.ts` 3 tests).

- [ ] **Step 5: Regenerate the generated files, in this order**

Each command rewrites one artefact from the code; the order matters (the limb list feeds the reconcile list and the bake, the bake feeds reach). Then review each diff against the scratch result below.

```bash
UPDATE_RECONCILE=1 pnpm vitest run src/fighters/acmd/reconcile.test.ts
```

`src/fighters/acmd/reconcile.allow.json` — the expected change:

```diff
--- a/src/fighters/acmd/reconcile.allow.json
+++ b/src/fighters/acmd/reconcile.allow.json
@@ -1,6 +1,5 @@
 {
-  "mario sideB lead": "legacy 7%/70°/bkb50/kbg60 / game_specials 7%/110°/fkb80/kbg100",
   "mario upB last": "legacy 18 / game_specialhi 300",
   "mario upB lead": "legacy 5%/86°/fkb150/kbg100 / game_specialhi 5%/60°/fkb160/kbg100",
   "mario pummel faf": "legacy 20 / game_catchattack 7",
   "mario fthrow hitboxes": "legacy some / game_throwf none",
```

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0; golden trace untouched.

- [ ] **Step 7: Commit**

```bash
git add super-smash/src/engine/acmd/hitboxes.ts super-smash/src/engine/acmd/legacy.ts super-smash/src/engine/reflect.ts super-smash/src/engine/simulate.ts super-smash/src/engine/status/attack.ts super-smash/src/engine/types.ts super-smash/src/fighters/acmd/reconcile.allow.json super-smash/src/fighters/cape.test.ts super-smash/src/fighters/fox.ts super-smash/src/fighters/mario.ts
git commit -m "super-smash: Mario's Cape reflects, turns its victim and stalls" -m "7% at 110 degrees with FKB 80 and a turn (game_specials); reflection frames 9-20 at x1.5 damage, x1 speed, x0.75 lifetime; the stall is SmashWiki's speed / 2.5, +0.3, gravity 0.031, falling speed 1. Reconcile -1 (mario sideB lead). Golden trace unchanged." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Marth's Counter

SmashWiki (Marth (SSBU)/Down special): Counter's window is frames 6–27; a hit inside it is answered by the counterattack (`special_lw_hit`, 8% base at 361°, BKB 90, KBG 60) with ×1.2 the countered damage, 8% at least and 50% at most; Marth is intangible through the counterattack's frames 1–8. The attacker freezes (21 frames of the counter's hitlag; UNVERIFIED that the attacker shares it). **A projectile is countered too:** it is consumed and its thrower is not frozen.

**Files:**
- Create: `super-smash/src/engine/counter.ts`, `super-smash/src/fighters/counter.test.ts`
- Modify: `super-smash/src/engine/acmd/legacy.ts`, `super-smash/src/engine/combat.ts`, `super-smash/src/engine/hash.ts`, `super-smash/src/engine/simulate.ts`, `super-smash/src/engine/types.ts`, `super-smash/src/fighters/marth.ts`, `super-smash/src/render/poses/timing.ts`
- Regenerate: `super-smash/public/bake/roster.bin.gz`, `super-smash/src/fighters/acmd/reconcile.allow.json`, `super-smash/src/fighters/bake/digest.ts`

**Interfaces:**
- Consumes: `resolveHits`, `Candidate` (Plan 3 `simulate.ts`), `startMove` (Plan 2 `states.ts`).
- Produces: `src/engine/counter.ts`: `activeCounter`, `counterDamage`, `triggerCounter`; `CounterDef`; `MoveDef.counter?`, `MoveDef.counterDamage?`; `MoveSlot` + `"counterAttack"` (motion `special_lw_hit`, clip `downB`); `CombatState.counterDamage`; `StepEvents.counters`.

- [ ] **Step 1: Write the failing test**

`src/fighters/counter.test.ts` (new file):

```ts
/**
 * Marth's Counter, through the real `step()` (Plan 5, Task 5). SmashWiki
 * "Marth (SSBU)/Down special": catches hits on frames 6–27; returns ×1.2,
 * at least 8%, at most 50%; both freeze 21 frames; a grab goes through.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { fx, toFloat } from "@/engine/fixed";
import { createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { Btn } from "@/engine/types";
import type { GameState, InputFrame, MatchRules, StepEvents } from "@/engine/types";
import { STAGES } from "@/stages";
import { FIGHTERS } from "./index";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true };

beforeAll(() => {
  registerFighters(FIGHTERS);
  registerStages(STAGES);
});

/** `attacker` on the left facing Marth on the right, `gap` apart. */
function duel(attacker: string, gap: number): GameState {
  const s = createInitialState("finalDestination", [{ defId: attacker }, { defId: "marth" }], RULES, 5);
  s.fighters.forEach((f, i) =>
    Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(i === 0 ? -gap / 2 : gap / 2), y: 0, facing: i === 0 ? 1 : -1, intangible: 0 }),
  );
  return s;
}

function run(s0: GameState, frames: number, script: (i: number) => [InputFrame, InputFrame]): { states: GameState[]; events: StepEvents[] } {
  let s = s0;
  let prev: [InputFrame, InputFrame] = [0, 0];
  const states: GameState[] = [];
  const events: StepEvents[] = [];
  for (let i = 0; i < frames; i++) {
    const now = script(i);
    const out = step(s, now, { prevInputs: prev });
    s = out.state;
    prev = now;
    states.push(s);
    events.push(out.events);
  }
  return { states, events };
}

const COUNTER: InputFrame = Btn.Down | Btn.Special;

describe("Marth's Counter", () => {
  it("returns a forward smash at ×1.2, and Marth takes nothing", () => {
    // Marth counters on frame 0; Mario's forward smash (17%, frame 15) lands inside the window.
    const { states, events } = run(duel("mario", 14), 90, (i) => [i === 0 ? Btn.Right : i === 1 ? Btn.Right | Btn.Attack : 0, i === 0 ? COUNTER : 0]);
    expect(events.some((e) => e.counters.length > 0)).toBe(true);
    const end = states[states.length - 1];
    expect(end.fighters[1].damage).toBe(0);
    // Mario's forward smash sweetspot (17.8%, game_attacks4) × 1.2, then the
    // counterattack's own fresh-move ×1.05 and one-on-one ×1.2.
    expect(toFloat(end.fighters[0].damage)).toBeCloseTo(17.8 * 1.2 * 1.05 * 1.2, 1);
  });

  it("returns a weak jab at the 8% floor", () => {
    const { states } = run(duel("mario", 12), 90, (i) => [i === 7 ? Btn.Attack : 0, i === 0 ? COUNTER : 0]);
    const end = states[states.length - 1];
    expect(end.fighters[1].damage).toBe(0);
    expect(toFloat(end.fighters[0].damage)).toBeCloseTo(8 * 1.05 * 1.2, 1);
  });

  it("freezes both fighters for 21 frames when it catches", () => {
    const { states, events } = run(duel("mario", 12), 40, (i) => [i === 7 ? Btn.Attack : 0, i === 0 ? COUNTER : 0]);
    const at = events.findIndex((e) => e.counters.length > 0);
    expect(states[at].fighters[1].hitlag).toBe(21);
    expect(states[at].fighters[0].hitlag).toBe(21);
    expect(states[at].fighters[1].move).toBe("counterAttack");
  });

  it("whiffs harmlessly and ends on frame 64", () => {
    const { states } = run(duel("mario", 60), 70, (i) => [0, i === 0 ? COUNTER : 0]);
    expect(states[62].fighters[1].move).toBe("downB");
    expect(states[64].fighters[1].action).toBe("stand");
  });

  it("catches a multi-hit once: Pikachu's looping jab is countered on its first hit and lands none after", () => {
    // Pikachu mashes its looping jab into Marth's counter.
    const { states, events } = run(duel("pikachu", 9), 60, (i) => [i >= 6 && i % 2 === 0 ? Btn.Attack : 0, i === 0 ? COUNTER : 0]);
    expect(events.filter((e) => e.counters.length > 0)).toHaveLength(1);
    expect(states.every((s) => s.fighters[1].damage === 0)).toBe(true);
    expect(states[states.length - 1].fighters[0].damage).toBeGreaterThan(0);
  });

  it("is beaten by a grab", () => {
    const { states, events } = run(duel("mario", 10), 30, (i) => [i === 6 ? Btn.Grab : 0, i === 0 ? COUNTER : 0]);
    expect(events.some((e) => e.counters.length > 0)).toBe(false);
    expect(states.some((s) => s.fighters[1].action === "grabbed")).toBe(true);
  });
});

describe("Review Focus: counter against a projectile", () => {
  it("catches Mario's fireball: the fireball is gone, Marth is untouched, and the riposte whiffs at range", () => {
    const { states, events } = run(duel("mario", 50), 120, (i) => [i === 0 ? Btn.Special : 0, i === 14 ? COUNTER : 0]);
    const at = events.findIndex((e) => e.counters.length > 0);
    expect(at).toBeGreaterThan(0);
    expect(states[at].projectiles).toHaveLength(0);
    expect(states[at].fighters[1].move).toBe("counterAttack");
    // The thrower is not frozen: the projectile's owner is not a party to it.
    expect(states[at].fighters[0].hitlag).toBe(0);
    const end = states[states.length - 1];
    expect(end.fighters[1].damage).toBe(0);
    expect(end.fighters[0].damage).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run src/fighters/counter.test.ts`
Expected: FAIL — `counter.test.ts`: 5 failed | 2 passed — `TypeError: Cannot read properties of undefined (reading 'length')` (no `counters` event list yet).

- [ ] **Step 3: Implement**

`src/engine/acmd/legacy.ts` — apply:

```diff
--- a/src/engine/acmd/legacy.ts
+++ b/src/engine/acmd/legacy.ts
@@ -48,8 +48,9 @@ export const SLOT_MOTION: Readonly<Record<MoveSlot, MotionKind>> = {
   dthrow: "throw_lw",
   ledgeAttack: "cliff_attack_quick",
   getUpAttack: "down_attack_u",
   finalSmash: "final",
+  counterAttack: "special_lw_hit",
 };
 
 /** A legacy hitbox as `ATTACK` arguments on the root bone. */
 export function attackFromHitbox(hb: Hitbox): AttackParams {
```

`src/engine/combat.ts` — apply:

```diff
--- a/src/engine/combat.ts
+++ b/src/engine/combat.ts
@@ -56,8 +56,10 @@ export interface CombatState {
   /** Plan 5: this airtime's one special stall is spent (Reflector, Cape); reset on landing or a ledge. */
   specialStall: boolean;
   /** Plan 5: the current move is the one stalling (it took the airtime's stall). */
   stalling: boolean;
+  /** Plan 5: the damage a counter caught, × its multiplier, for the counterattack (Q12). */
+  counterDamage: number;
 }
 
 export function emptyCombat(): CombatState {
   return {
@@ -77,8 +79,9 @@ export function emptyCombat(): CombatState {
     storedCharge: 0,
     reflectHold: 0,
     specialStall: false,
     stalling: false,
+    counterDamage: 0,
   };
 }
 
 export function cloneCombat(c: CombatState): CombatState {
@@ -99,6 +102,7 @@ export function cloneCombat(c: CombatState): CombatState {
     storedCharge: c.storedCharge,
     reflectHold: c.reflectHold,
     specialStall: c.specialStall,
     stalling: c.stalling,
+    counterDamage: c.counterDamage,
   };
 }
```

`src/engine/counter.ts` (new file):

```ts
/**
 * Counters (Plan 5, Task 5): Marth's Counter.
 *
 * A counter is a window of frames in which being hit is the point. Whatever
 * reaches the fighter — a swing or a projectile — does nothing to them; both
 * freeze for the counter's hitlag, and then the fighter swings back with a
 * strike whose damage is the caught attack's × the counter's multiplier, never
 * below its minimum nor above its maximum (SmashWiki "Marth (SSBU)/Down
 * special": "Counter damage multiplier 1.2", "Counter minimum damage 8%",
 * "Counter maximum damage 50%", "Counter hitlag on activation 21 frames").
 * A grab is not an attack and goes straight through a counter, as in SSBU.
 */

import { clamp, mul } from "./fixed";
import { moveFrameOf } from "./hitbox";
import { startMove } from "./states";
import type { CounterDef, FighterDef, FighterState } from "./types";

/** The counter this fighter has out this frame, if any. */
export function activeCounter(f: FighterState, def: FighterDef): CounterDef | null {
  if (f.move === null || f.action !== "special") return null;
  const c = def.moves[f.move]?.counter;
  if (c === undefined) return null;
  const g = moveFrameOf(f.actionFrame);
  return g >= c.active[0] && g <= c.active[1] ? c : null;
}

/** The counterattack's damage for a caught hit of `damage` (Q12). */
export function counterDamage(c: CounterDef, damage: number): number {
  return clamp(mul(damage, c.multiplier), c.minDamage, c.maxDamage);
}

/**
 * The counter connects: `f` starts its counterattack, frozen for the counter's
 * hitlag and intangible through it. Returns the freeze, which a melee
 * attacker shares (UNVERIFIED: SmashWiki gives the counter's hitlag, not the
 * attacker's; the replica freezes both, as an ordinary hit does).
 */
export function triggerCounter(f: FighterState, c: CounterDef, caught: number): number {
  startMove(f, "special", c.then);
  f.combat.counterDamage = counterDamage(c, caught);
  f.hitlag = c.freeze;
  f.intangible = Math.max(f.intangible, c.freeze + 1);
  return c.freeze;
}
```

`src/engine/hash.ts` — apply:

```diff
--- a/src/engine/hash.ts
+++ b/src/engine/hash.ts
@@ -179,8 +179,9 @@ export function mixCombat(h: number, c: CombatState): number {
   x = mixInt(x, c.storedCharge);
   x = mixInt(x, c.reflectHold);
   x = mixBool(x, c.specialStall);
   x = mixBool(x, c.stalling);
+  x = mixInt(x, c.counterDamage);
   return x;
 }
 
 /** The KineticModule energies, in declaration order. */
```

`src/engine/simulate.ts` — apply:

```diff
--- a/src/engine/simulate.ts
+++ b/src/engine/simulate.ts
@@ -90,8 +90,9 @@ import {
   spawnProjectile,
 } from "./projectile";
 import { chargedHitbox } from "./specialCharge";
 import { reflectProjectiles } from "./reflect";
+import { activeCounter, triggerCounter } from "./counter";
 import {
   blastZoneKO,
   ecbOf,
   findLedgeGrab,
@@ -775,10 +776,13 @@ function gatherHitboxes(
     // A charged special's boxes grow towards their full-charge values (Plan 5);
     // a smash's charge stays the damage multiplier it always was.
     const sc = defs[i].moves[f.move]?.specialCharge;
     const chargeT = sc === undefined ? 0 : chargeFraction(f.charge, sc.frames);
+    // A counterattack deals what its counter caught (Plan 5).
+    const countered = defs[i].moves[f.move]?.counterDamage === true;
     for (const raw of live) {
-      const hb = sc === undefined ? raw : chargedHitbox(raw, sc.full?.[raw.id], chargeT, sc.partial);
+      const charged = sc === undefined ? raw : chargedHitbox(raw, sc.full?.[raw.id], chargeT, sc.partial);
+      const hb = countered ? { ...charged, damage: f.combat.counterDamage } : charged;
       const now = hitboxWorldPos(f.x, f.y, f.facing, hb);
       const was = hitboxWorldPos(prevPos[i].x, prevPos[i].y, f.facing, hb);
       const far =
         hb.x2 === undefined || hb.y2 === undefined
@@ -1023,8 +1027,18 @@ function resolveHits(
       // Fresh out of a grab: grabs pass through, unspent, for 60 frames (Task 14).
       if (c.hitbox.grabbing === true && victim.combat.grabImmune > 0) continue;
       // Invincible: the fighter *is* there and the hit connects. It is only the
       // consequences that do not land. See `FighterState.invincible`.
+      // A counter catches anything but a grab (Plan 5, `counter.ts`).
+      const counter = c.hitbox.grabbing === true ? null : activeCounter(victim, defs[v]);
+      if (counter !== null) {
+        recordHit(c, attacker, victim.port);
+        const freeze = triggerCounter(victim, counter, mul(c.hitbox.damage, c.chargeScale));
+        if (c.projectile === null) attacker.hitlag = freeze;
+        else destroyed.add(c.projectile.instanceId);
+        events.counters.push({ port: victim.port, x: c.x, y: c.y });
+        continue;
+      }
       if (victim.invincible > 0) applyInvincibleHit(s, attacker, victim, c, events);
       else applyHit(s, attacker, victim, defs[v], c, intents[v], events);
       if (c.destroyOnHit && c.projectile !== null) destroyed.add(c.projectile.instanceId);
     }
```

`src/engine/types.ts` — apply:

```diff
--- a/src/engine/types.ts
+++ b/src/engine/types.ts
@@ -163,9 +163,11 @@ export type MoveSlot =
   | "uthrow"
   | "dthrow"
   | "ledgeAttack"
   | "getUpAttack"
-  | "finalSmash";
+  | "finalSmash"
+  // Plan 5: what a special turns into.
+  | "counterAttack";
 
 /** Non-damage properties a hit can carry. Drives VFX, hitlag and reactions. */
 export type HitEffect =
   | "normal"
@@ -312,8 +314,25 @@ export interface ReflectorDef {
   /** From this frame, holding back turns the fighter round. */
   readonly turnFrom?: number;
 }
 
+/**
+ * A counter a move holds out (Plan 5): Marth's Counter. Frames are game frames
+ * of the move; damages Q12.
+ */
+export interface CounterDef {
+  /** First and last frame a hit is caught. */
+  readonly active: readonly [number, number];
+  /** The counterattack's damage: caught × multiplier, clamped to [min, max]. */
+  readonly multiplier: number;
+  readonly minDamage: number;
+  readonly maxDamage: number;
+  /** Frames both sides freeze when it catches something. */
+  readonly freeze: number;
+  /** The move slot the counterattack is. Its hitboxes deal the counter's damage. */
+  readonly then: MoveSlot;
+}
+
 /** A special's once-per-airtime stall (Plan 5): Fox's Reflector, Mario's Cape. Q12. */
 export interface StallDef {
   /** Horizontal speed multiplier on the first frame (Cape: 1 / 2.5). */
   readonly startX: number;
@@ -387,8 +406,12 @@ export interface MoveDef {
   /** A reflector this move raises (Plan 5). */
   readonly reflector?: ReflectorDef;
   /** The move stalls a fall, once per airtime (Plan 5). */
   readonly stall?: StallDef;
+  /** A counter this move holds out (Plan 5). */
+  readonly counter?: CounterDef;
+  /** Its hitboxes deal the damage the counter caught (Plan 5: the counterattack). */
+  readonly counterDamage?: boolean;
   /** First and last move frame the fighter is intangible (Plan 5: SmashWiki "Intangibility a-b"). */
   readonly intangible?: readonly [number, number];
   /** Frames the fighter may not be interrupted, for specials with armour. */
   readonly superArmourFrames?: readonly [number, number];
@@ -823,8 +846,10 @@ export interface StepEvents {
   smashBallBroken: number | null;
   finalSmashes: number[];
   /** Projectiles sent back this frame, by whom and where (Plan 5). */
   reflects: { port: number; x: number; y: number }[];
+  /** Counters that caught something this frame (Plan 5). */
+  counters: { port: number; x: number; y: number }[];
 }
 
 export function emptyEvents(): StepEvents {
   return {
@@ -837,6 +862,7 @@ export function emptyEvents(): StepEvents {
     shieldBreaks: [],
     smashBallBroken: null,
     finalSmashes: [],
     reflects: [],
+    counters: [],
   };
 }
```

`src/fighters/marth.ts` — apply:

```diff
--- a/src/fighters/marth.ts
+++ b/src/fighters/marth.ts
@@ -868,24 +868,37 @@ const legacy: FighterDef = {
       totalFrames: 64,
       // The counter *window* is frames 6-27 — twenty-two frames, which is
       // generous — and a caught attack is returned at **1.2x** with a floor of
       // 8%. The counterattack itself has **no tipper**: all four of its
-      // hitboxes are identical. The hitbox below is the returned strike; the
-      // window and the multiplier are engine behaviour keyed off this slot.
+      // hitboxes are identical.
+      //
+      // Plan 5 — SmashWiki "Marth (SSBU)/Down special": window "6-27",
+      // "Intangibility 5-6", "Counter damage multiplier 1.2", "Counter minimum
+      // damage 8%", "Counter maximum damage 50%", "Counter hitlag on activation
+      // 21 frames"; UFD total 64. The window is `game_speciallw`'s
+      // FIGHTER_MARTH_STATUS_SPECIAL_LW_FLAG_SHIELD, on at 6, off at 28.
+      // UNVERIFIED-simplified: the aerial version's gravity 0.04 / fall speed
+      // 1.2 are not modelled.
+      intangible: [5, 6],
+      counter: { active: [6, 27], multiplier: fx(1.2), minDamage: fx(8), maxDamage: fx(50), freeze: 21, then: "counterAttack" },
+      hitboxes: [],
+    },
+
+    counterAttack: {
+      slot: "counterAttack",
+      name: "Counter (attack)",
+      // SmashWiki: hitboxes 5-7, intangibility 1-8, interruptible 42.
+      // `game_speciallwhit` (rubendal Data Viewer 13.0.1): four 8% boxes, angle
+      // 361, KBG 60, BKB 90, size 5.5, on sword1/armr/claviclel. The damage is
+      // replaced by the counter's (`counterDamage`). UNVERIFIED: the root-bone
+      // positions, set along the sword's reach until the bake places the
+      // sword (Plan 4's limb scripts).
+      totalFrames: 41,
+      intangible: [1, 8],
+      counterDamage: true,
       hitboxes: [
-        {
-          id: 0,
-          startFrame: 4,
-          endFrame: 6,
-          x: fx(7.0),
-          y: fx(7.5),
-          radius: fx(3.4),
-          damage: fx(8.0),
-          angle: fx(361),
-          baseKnockback: fx(90),
-          knockbackGrowth: fx(60),
-          effect: "slash",
-        },
+        { id: 0, startFrame: 5, endFrame: 7, x: fx(BODY_REACH), y: fx(7.5), radius: fx(5.5), damage: fx(8.0), angle: fx(361), baseKnockback: fx(90), knockbackGrowth: fx(60), hitlagMultiplier: fx(1.4), effect: "slash" },
+        { id: 1, startFrame: 5, endFrame: 7, x: fx(TIP_REACH), y: fx(7.5), radius: fx(5.5), damage: fx(8.0), angle: fx(361), baseKnockback: fx(90), knockbackGrowth: fx(60), hitlagMultiplier: fx(1.4), effect: "slash" },
       ],
     },
 
     grab: {
```

`src/render/poses/timing.ts` — apply:

```diff
--- a/src/render/poses/timing.ts
+++ b/src/render/poses/timing.ts
@@ -138,8 +138,9 @@ export const SLOT_POSE: Record<MoveSlot, PoseName> = {
   dthrow: "dthrow",
   ledgeAttack: "ftilt",
   getUpAttack: "dsmash",
   finalSmash: "neutralB",
+  counterAttack: "downB",
 };
 
 /** A looping clip that names no period of its own runs at half a second. */
 const DEFAULT_PERIOD = 30;
```

- [ ] **Step 4: Run it again**

Run: `pnpm vitest run src/fighters/counter.test.ts`
Expected: PASS (`src/fighters/counter.test.ts` 7 tests).

- [ ] **Step 5: Regenerate the generated files, in this order**

Each command rewrites one artefact from the code; the order matters (the limb list feeds the reconcile list and the bake, the bake feeds reach). Then review each diff against the scratch result below.

```bash
UPDATE_RECONCILE=1 pnpm vitest run src/fighters/acmd/reconcile.test.ts
UPDATE_BAKE=1 pnpm vitest run src/render3d/bake/roster.test.ts
```

`src/fighters/acmd/reconcile.allow.json` — the expected change:

```diff
--- a/src/fighters/acmd/reconcile.allow.json
+++ b/src/fighters/acmd/reconcile.allow.json
@@ -101,9 +101,8 @@
   "marth usmash lead": "legacy 17%/89°/bkb40/kbg95 / game_attackhi4 3%/125°/fkb155/kbg100",
   "marth dsmash lead": "legacy 12%/361°/bkb57/kbg88 / game_attacklw4 8%/361°/bkb60/kbg88",
   "marth dsmash faf": "legacy 56 / game_attacklw4 55",
   "marth bair lead": "legacy 12.5%/361°/bkb40/kbg94 / game_attackairb 9%/361°/bkb40/kbg85",
-  "marth downB hitboxes": "legacy some / game_speciallw none",
   "marth pummel faf": "legacy 20 / game_catchattack 7",
   "marth fthrow hitboxes": "legacy some / game_throwf none",
   "marth bthrow hitboxes": "legacy some / game_throwb none",
   "marth uthrow hitboxes": "legacy some / game_throwhi none",
```

`src/fighters/bake/digest.ts` — the bake's new digest:

```diff
--- a/src/fighters/bake/digest.ts
+++ b/src/fighters/bake/digest.ts
@@ -1,5 +1,5 @@
 // GENERATED by src/render3d/bake/roster.test.ts (UPDATE_BAKE=1) — do not edit by hand.
 /** SHA-256 of the uncompressed public/bake/roster.bin.gz: the bake's fingerprint. */
-export const BAKE_DIGEST = "b0083de1f96cad28fd733ee68736aebfd595ba3ca629d8f098baa55da09d78c2";
+export const BAKE_DIGEST = "5abe6bfb60d7250ec36b97a24c7923bb871baa916e744c68bca2ebf5ef160672";
 /** Its uncompressed length in bytes. */
-export const BAKE_BYTES = 5461467;
+export const BAKE_BYTES = 5470013;
```

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0; golden trace untouched.

- [ ] **Step 7: Commit**

```bash
git add super-smash/public/bake/roster.bin.gz super-smash/src/engine/acmd/legacy.ts super-smash/src/engine/combat.ts super-smash/src/engine/counter.ts super-smash/src/engine/hash.ts super-smash/src/engine/simulate.ts super-smash/src/engine/types.ts super-smash/src/fighters/acmd/reconcile.allow.json super-smash/src/fighters/bake/digest.ts super-smash/src/fighters/counter.test.ts super-smash/src/fighters/marth.ts super-smash/src/render/poses/timing.ts
git commit -m "super-smash: Marth's Counter: frames 6-27, x1.2, 8% to 50%, projectiles too" -m "The counterattack is special_lw_hit's 8% at 361 degrees scaled x1.2 of the countered hit, clamped 8-50% (SmashWiki); a countered projectile is consumed and its thrower not frozen; a multi-hit is caught once. Reconcile -1 (marth downB hitboxes). Bake regenerated (counterAttack motion). Golden trace unchanged." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Windboxes and F.L.U.D.D.

SmashWiki (Mario (SSBU)/Down special): F.L.U.D.D. stores a charge (80 frames, loop from 19) and pumps water in 7 bursts (frames 21, 26 … 51); the water pushes but does no damage and no hitlag, and pushes through shields. `Hitbox.windbox` marks such a box (flinchless, no hitlag); `applyWindbox` pushes the victim along the box's angle; base knockback grows with the charge ("can increase up to 55"), linearly. Marth's Counter does not catch a windbox — UNVERIFIED, no source says either way. Mario's `downB` clip is re-timed to the move (strike 21 of 67).

**Files:**
- Create: `super-smash/src/fighters/fludd.test.ts`
- Modify: `super-smash/src/engine/acmd/hitboxes.ts`, `super-smash/src/engine/acmd/legacy.ts`, `super-smash/src/engine/simulate.ts`, `super-smash/src/engine/types.ts`, `super-smash/src/fighters/mario.ts`, `super-smash/src/fighters/schema.test.ts`, `super-smash/src/render/chars/mario/poses.ts`
- Regenerate: `super-smash/public/bake/roster.bin.gz`, `super-smash/src/fighters/bake/digest.ts`

**Interfaces:**
- Consumes: `specialChargeMain` (Task 2), `resolveHits` (Plan 3).
- Produces: `Hitbox.windbox?: boolean`; `applyWindbox` (simulate.ts).

- [ ] **Step 1: Write the failing tests**

`src/fighters/fludd.test.ts` (new file):

```ts
/**
 * F.L.U.D.D., through the real `step()` (Plan 5, Task 6): a store-mode charge
 * (80 frames) that releases seven windbox pumps. A windbox pushes and does
 * nothing else — no damage, no hitstun — and a shield does not stop it.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { fx } from "@/engine/fixed";
import { createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { Btn } from "@/engine/types";
import type { GameState, InputFrame, MatchRules } from "@/engine/types";
import { STAGES } from "@/stages";
import { FIGHTERS } from "./index";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true };

beforeAll(() => {
  registerFighters(FIGHTERS);
  registerStages(STAGES);
});

function duel(gap: number, other = "fox"): GameState {
  const s = createInitialState("finalDestination", [{ defId: "mario" }, { defId: other }], RULES, 5);
  s.fighters.forEach((f, i) =>
    Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(i === 0 ? -gap / 2 : gap / 2), y: 0, facing: i === 0 ? 1 : -1, intangible: 0 }),
  );
  return s;
}

function run(s0: GameState, script: readonly [InputFrame, InputFrame][]): GameState[] {
  let s = s0;
  let prev: [InputFrame, InputFrame] = [0, 0];
  const out: GameState[] = [];
  for (const now of script) {
    s = step(s, now, { prevInputs: prev }).state;
    prev = now;
    out.push(s);
  }
  return out;
}

const frames = (n: number, mario: (i: number) => InputFrame, fox: (i: number) => InputFrame = () => 0): [InputFrame, InputFrame][] =>
  Array.from({ length: n }, (_, i) => [mario(i), fox(i)]);

describe("F.L.U.D.D.", () => {
  it("charges once pressed and stores a full charge itself", () => {
    const states = run(duel(60), frames(120, (i) => (i === 0 ? Btn.Down | Btn.Special : 0)));
    expect(states[states.length - 1].fighters[0].combat.storedCharge).toBe(80);
  });

  it("pushes the opponent without hurting or stunning them", () => {
    // Tap it: B, then B again as soon as the charge loop starts.
    const states = run(duel(24), frames(80, (i) => (i === 0 || i === 20 ? Btn.Down | Btn.Special : 0)));
    const fox = states.map((s) => s.fighters[1]);
    expect(Math.max(...fox.map((f) => f.x))).toBeGreaterThan(fx(12 + 3));
    expect(fox.every((f) => f.damage === 0)).toBe(true);
    expect(fox.some((f) => f.action === "hitstun" || f.action === "tumble" || f.hitlag > 0)).toBe(false);
  });

  it("pushes further from a full charge than from a tap", () => {
    const tap = run(duel(24), frames(80, (i) => (i === 0 || i === 20 ? Btn.Down | Btn.Special : 0)));
    const full = run(duel(24), frames(170, (i) => (i === 0 || i === 105 ? Btn.Down | Btn.Special : 0)));
    const furthest = (states: GameState[]) => Math.max(...states.map((s) => s.fighters[1].x));
    expect(furthest(full)).toBeGreaterThan(furthest(tap));
  });

  it("pushes through a shield", () => {
    const states = run(duel(24), frames(80, (i) => (i === 0 || i === 20 ? Btn.Down | Btn.Special : 0), () => Btn.Shield));
    expect(Math.max(...states.map((s) => s.fighters[1].x))).toBeGreaterThan(fx(12 + 3));
    // The water costs the shield nothing: it wears exactly as an idle held shield does.
    const idle = run(duel(24), frames(80, () => 0, () => Btn.Shield));
    expect(states[states.length - 1].fighters[1].shieldHealth).toBe(idle[idle.length - 1].fighters[1].shieldHealth);
  });
});

describe("F.L.U.D.D. against Marth's Counter (UNVERIFIED: a windbox is not countered)", () => {
  it("pushes a countering Marth instead of setting the counter off", () => {
    const tap = (i: number) => (i === 0 || i === 20 ? Btn.Down | Btn.Special : 0);
    // When does the water first reach him, standing still?
    const still = run(duel(24, "marth"), frames(80, tap));
    const pushedAt = still.findIndex((s) => s.fighters[1].x > fx(12));
    expect(pushedAt).toBeGreaterThan(10);
    // Counter so its window (frames 6-27) is open as the water arrives.
    const states = run(duel(24, "marth"), frames(80, tap, (i) => (i === pushedAt - 10 ? Btn.Down | Btn.Special : 0)));
    const marth = states.map((s) => s.fighters[1]);
    expect(marth.some((f) => f.move === "counterAttack")).toBe(false);
    expect(Math.max(...marth.map((f) => f.x))).toBeGreaterThan(fx(12 + 3));
    expect(marth.every((f) => f.damage === 0)).toBe(true);
  });
});
```

`src/fighters/schema.test.ts` — apply:

```diff
--- a/src/fighters/schema.test.ts
+++ b/src/fighters/schema.test.ts
@@ -229,9 +229,11 @@ describe("projectiles", () => {
 
   it.each(each)("%s gives every projectile a positive radius and damage", (_name, fighter) => {
     for (const { slot, projectile } of everyProjectile(fighter)) {
       expect(projectile.hitbox.radius, `${fighter.name} ${slot}`).toBeGreaterThan(0);
-      expect(projectile.hitbox.damage, `${fighter.name} ${slot}`).toBeGreaterThan(0);
+      // A windbox (Plan 5: F.L.U.D.D.'s water) pushes and deals nothing.
+      if (projectile.hitbox.windbox === true) expect(projectile.hitbox.damage).toBe(0);
+      else expect(projectile.hitbox.damage, `${fighter.name} ${slot}`).toBeGreaterThan(0);
     }
   });
 
   it.each(each)("%s makes every projectile transcendent", (_name, fighter) => {
@@ -245,10 +247,16 @@ describe("projectiles", () => {
     }
   });
 
   it.each(each)("%s gives every projectile a unique id within its fighter", (_name, fighter) => {
-    const ids = everyProjectile(fighter).map((p) => p.projectile.id);
-    expect(new Set(ids).size).toBe(ids.length);
+    // One definition may be fired on several frames (Plan 5: F.L.U.D.D.'s seven
+    // pumps): an id repeats only for the same projectile at another frame.
+    const byId = new Map<string, string>();
+    for (const { projectile } of everyProjectile(fighter)) {
+      const shape = JSON.stringify({ ...projectile, spawnFrame: 0 });
+      expect(byId.get(projectile.id) ?? shape, `${fighter.name} ${projectile.id}`).toBe(shape);
+      byId.set(projectile.id, shape);
+    }
   });
 
   it("puts a projectile on exactly the specials the spec says have one", () => {
     // SPEC section 7: Link has three at once, Samus charges one.
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/fighters/fludd.test.ts src/fighters/schema.test.ts`
Expected: FAIL — `fludd.test.ts`: 5 failed — `expected +0 to be 80` (no stored charge), `expected 49152 to be greater than 61440` and `expected 49152 to be greater than 49152` (nobody pushed), `expected -1 to be greater than 10` (no water reaches Marth).

- [ ] **Step 3: Implement**

`src/engine/acmd/hitboxes.ts` — apply:

```diff
--- a/src/engine/acmd/hitboxes.ts
+++ b/src/engine/acmd/hitboxes.ts
@@ -79,8 +79,9 @@ function attackHitbox(
     ...(a.setWeight ? { setWeight: true } : {}),
     ...(SITUATION[a.situation] !== undefined ? { situation: SITUATION[a.situation] } : {}),
     ...(LR[a.facing] !== undefined ? { lr: LR[a.facing] } : {}),
     ...(a.collisionAttr === "collision_attr_turn" ? { reverse: true } : {}),
+    ...(a.flinchless && a.noHitlag ? { windbox: true } : {}),
   };
 }
 
 /** Which situations a `COLLISION_SITUATION_MASK_*` restricts a box to; GA (both) is no restriction. */
```

`src/engine/acmd/legacy.ts` — apply:

```diff
--- a/src/engine/acmd/legacy.ts
+++ b/src/engine/acmd/legacy.ts
@@ -76,10 +76,10 @@ export function attackFromHitbox(hb: Hitbox): AttackParams {
     trip: 0,
     rehit: 0,
     reflectable: false,
     absorbable: false,
-    flinchless: false,
-    noHitlag: false,
+    flinchless: hb.windbox === true,
+    noHitlag: hb.windbox === true,
     direct: true,
     situation: "COLLISION_SITUATION_MASK_GA",
     // Plan 5: a turning hit is SSBU's `collision_attr_turn` (Mario's Cape).
     collisionAttr: hb.reverse === true ? "collision_attr_turn" : ATTR_OF_EFFECT[hb.effect ?? "normal"],
```

`src/engine/simulate.ts` — apply:

```diff
--- a/src/engine/simulate.ts
+++ b/src/engine/simulate.ts
@@ -127,8 +127,9 @@ import {
   kineticLaunch,
   kineticTurnLaunch,
   kineticSet,
   kineticSetX,
+  kineticSetY,
 } from "./kinetic";
 import { LEGACY_BONE_TABLE, type BoneTable } from "./acmd/bones";
 import { LEGACY_BAKE, type BakeTables } from "./acmd/bakeTables";
 import { bakedEcb, fighterHurtboxes } from "./acmd/hurtboxes";
@@ -1027,10 +1028,12 @@ function resolveHits(
       // Fresh out of a grab: grabs pass through, unspent, for 60 frames (Task 14).
       if (c.hitbox.grabbing === true && victim.combat.grabImmune > 0) continue;
       // Invincible: the fighter *is* there and the hit connects. It is only the
       // consequences that do not land. See `FighterState.invincible`.
-      // A counter catches anything but a grab (Plan 5, `counter.ts`).
-      const counter = c.hitbox.grabbing === true ? null : activeCounter(victim, defs[v]);
+      // A counter catches anything but a grab (Plan 5, `counter.ts`) — and,
+      // UNVERIFIED (no source says either way), not a windbox: water pushes
+      // straight through Counter, which has nothing to return.
+      const counter = c.hitbox.grabbing === true || c.hitbox.windbox === true ? null : activeCounter(victim, defs[v]);
       if (counter !== null) {
         recordHit(c, attacker, victim.port);
         const freeze = triggerCounter(victim, counter, mul(c.hitbox.damage, c.chargeScale));
         if (c.projectile === null) attacker.hitlag = freeze;
@@ -1315,8 +1318,14 @@ function applyHit(
   const hb = c.hitbox;
   const fromProjectile = c.projectile !== null;
   recordHit(c, attacker, victim.port);
 
+  // A windbox only pushes (Plan 5, F.L.U.D.D.).
+  if (hb.windbox === true) {
+    applyWindbox(attacker, victim, victimDef, c);
+    return;
+  }
+
   // Grabs do not damage; they capture.
   if (hb.grabbing) {
     // Whatever grab either fighter was already part of ends here — a fighter
     // caught while holding somebody drops them, and a second grab on an
@@ -1600,8 +1609,38 @@ function applyHit(
     hitboxId: hb.id,
   });
 }
 
+/**
+ * A windbox's push (Plan 5): the hit's knockback, at its angle, as velocity —
+ * the ground slides a grounded fighter (the stop energy, which traction
+ * brakes), the air carries an airborne one. No hitstun, hitlag, damage or stale
+ * entry, and a shield does not stop it. UNVERIFIED: SSBU's windbox physics are
+ * unpublished; this is the launch with everything but the motion taken out.
+ */
+function applyWindbox(attacker: FighterState, victim: FighterState, victimDef: FighterDef, c: Candidate): void {
+  const hb = c.hitbox;
+  const kb = computeKnockback({
+    percent: victim.damage,
+    damage: mul(hb.damage, c.chargeScale),
+    weight: victimDef.attributes.weight,
+    baseKnockback: hb.baseKnockback,
+    knockbackGrowth: hb.knockbackGrowth,
+    rage: 0,
+    crouchCancel: false,
+    groundedMeteor: false,
+    setKnockback: hb.setKnockback,
+  });
+  const facing = c.projectile !== null ? c.projectile.facing : attacker.facing;
+  const push = knockbackToVelocity(kb, resolveAngle(hb, victim.grounded, kb), facing);
+  if (victim.grounded) {
+    kineticSetX(victim, push.vx, "stop");
+  } else {
+    kineticSetX(victim, push.vx);
+    kineticSetY(victim, push.vy);
+  }
+}
+
 /* ----------------------------------------------------------- smash ball -- */
 
 /**
  * The one item in the game, and the only source of randomness in a match.
```

`src/engine/types.ts` — apply:

```diff
--- a/src/engine/types.ts
+++ b/src/engine/types.ts
@@ -221,8 +221,14 @@ export interface Hitbox {
   /** Drives downward regardless of the victim's position. */
   readonly meteor?: boolean;
   /** `collision_attr_turn` (SmashWiki "Reverse"): the victim is turned round (Plan 5: Cape). */
   readonly reverse?: boolean;
+  /**
+   * A windbox (Plan 5: F.L.U.D.D.): smash-script `Flinchless=true,
+   * DisableHitlag=true`. It pushes by its knockback and does nothing else — no
+   * hitstun, no hitlag, no stale entry — and it pushes through a shield.
+   */
+  readonly windbox?: boolean;
   /** This hitbox grabs rather than damages. */
   readonly grabbing?: boolean;
   /**
    * smash-script `direct`: the hit comes from the fighter's own body. Absent
```

`src/fighters/mario.ts` — apply:

```diff
--- a/src/fighters/mario.ts
+++ b/src/fighters/mario.ts
@@ -40,9 +40,9 @@
  * verbatim.
  */
 
 import { fx } from "@/engine/fixed";
-import type { FighterDef } from "@/engine/types";
+import type { FighterDef, ProjectileDef } from "@/engine/types";
 import { ACTIVE_SCRIPT_SLOTS, withReferenceScripts } from "./acmd/active";
 import { MARIO } from "./acmd/generated/mario";
 import { FIGHTER_PARAMS } from "./params";
 
@@ -54,8 +54,51 @@ import { FIGHTER_PARAMS } from "./params";
  * radius of 11, and his jab sits at chest height y 6.3). */
 const HEIGHT = 11.0;
 const HALF_WIDTH = 2.0;
 
+/**
+ * One F.L.U.D.D. pump (Plan 5). mario_pumpwater `Regular` (rubendal Data
+ * Viewer 13.0.1): 0%, angle 55, KBG 100, FKB 70, size 4, `Flinchless=true`,
+ * `DisableHitlag=true` — a windbox. SmashWiki: "Lifetime 12 frames", "Initial
+ * speed 4.3", "Maximum additional speed 4.3", "Gravity 0.17", size ×0.8–1.2
+ * with charge, "Base knockback can increase up to 55 depending on charge",
+ * "Default shot angle 12°". UNVERIFIED-simplified: the charge's extra
+ * knockback is added to the set knockback (70 → 125); the stick's aim
+ * (+50°/−18°) is not modelled.
+ */
+function waterPump(spawnFrame: number): ProjectileDef {
+  return {
+    id: "water",
+    spawnFrame,
+    offsetX: fx(8.0),
+    offsetY: fx(6.5),
+    vx: fx(4.206), // 4.3 · cos 12°
+    vy: fx(0.894), // 4.3 · sin 12°
+    gravity: fx(0.17),
+    lifetime: 12,
+    destroyOnHit: true,
+    visual: "spark",
+    // mario_pumpwater `Regular`: `Reflectable=true`.
+    reflectable: true,
+    charged: { vx: fx(8.412), hitbox: { baseKnockback: fx(125), radius: fx(4.8) } },
+    hitbox: {
+      id: 0,
+      startFrame: 0,
+      endFrame: 12,
+      x: fx(0),
+      y: fx(0),
+      radius: fx(3.2),
+      damage: fx(0),
+      angle: fx(55),
+      baseKnockback: fx(70),
+      knockbackGrowth: fx(100),
+      setKnockback: true,
+      transcendent: true,
+      windbox: true,
+    },
+  };
+}
+
 /** The hand-authored moveset; `mario` below runs its root-bone moves from the imported scripts. */
 const legacy: FighterDef = {
   id: "mario",
   name: "Mario",
@@ -750,14 +793,27 @@ const legacy: FighterDef = {
 
     downB: {
       slot: "downB",
       name: "F.L.U.D.D.",
-      totalFrames: 48,
-      // Deals no damage at all — it charges, then pushes. The push scales with
-      // charge and is pure horizontal velocity applied to anyone in the stream,
-      // which is engine behaviour with no hitbox to hang it on. The empty array
-      // is correct and deliberate, not an omission.
+      // Deals no damage at all — it charges, then pushes (Plan 5). SmashWiki
+      // "Mario (SSBU)/Down special": "Total charge time 80 frames"; UFD:
+      // "Entering charge state takes 19 frames"; store mode — "pressing a
+      // shield button while charging will cancel and save the charge". On
+      // release, "Number of pumps shot 7", "Delay between pumps 5 frames",
+      // pumps at "2-13, 7-18, …, 32-43" from release, "Interruptible 68 (49
+      // from release)".
+      totalFrames: 67,
+      specialCharge: { mode: "store", frames: 80, loopFrame: 19 },
       hitboxes: [],
+      projectiles: [
+        waterPump(21),
+        waterPump(26),
+        waterPump(31),
+        waterPump(36),
+        waterPump(41),
+        waterPump(46),
+        waterPump(51),
+      ],
     },
 
     grab: {
       slot: "grab",
```

`src/render/chars/mario/poses.ts` — apply:

```diff
--- a/src/render/chars/mario/poses.ts
+++ b/src/render/chars/mario/poses.ts
@@ -1622,16 +1622,19 @@ const upB: PoseClip = {
  * face. Here both hands accumulate to about 75° at the wrist — 2.7 units
  * forward of the shoulder and 2.5 above it — which is exactly beside the head
  * and exactly where `fx.ts` draws the grip.
  *
- * `strike` is 21/48. For a move with no hitbox that is a literal fraction and
+ * `strike` is 21/67 (Plan 5: the move is now 67 frames — a 19-frame charge
+ * entry and 49 after release — and the first pump still leaves on frame 21).
+ * For a move with no hitbox that is a literal fraction and
  * it has to be the same frame `fx.ts` opens the water on; the reference puts
  * the first pump on frame 21, and round one had the brace at 0.52 — four
  * frames early, which read as a flinch before anything happened.
  */
 const downB: PoseClip = {
   loop: false,
-  strike: 0.4375,
+  strike: 21 / 67,
+  // Plan 5: keys re-timed to the 67-frame move at their old frames (×48/67).
   keys: [
     {
       t: 0,
       pose: P({
@@ -1644,9 +1647,9 @@ const downB: PoseClip = {
       ease: "in",
     },
     // Charging. Hunched over the pack, both hands low on it, knees soft.
     {
-      t: 0.26,
+      t: 12.5 / 67,
       pose: P({
         torso: 30, head: -24, hip: -6,
         thighR: 140, shinR: 72, footR: -82,
         thighL: 148, shinL: 68, footL: -80,
@@ -1656,9 +1659,9 @@ const downB: PoseClip = {
       offsetY: -1.25,
       ease: "hold",
     },
     {
-      t: 0.38,
+      t: 18.2 / 67,
       pose: P({
         torso: 30, head: -24, hip: -6,
         thighR: 140, shinR: 72, footR: -82,
         thighL: 148, shinL: 68, footL: -80,
@@ -1672,9 +1675,9 @@ const downB: PoseClip = {
     // accumulated −12 + 22 + 65 = 75 — braced wide with the weight on the back
     // foot and leaning *away* from the muzzle. This is recoil, not a lunge:
     // a full-charge shot shoves him backwards faster than he can fly forwards.
     {
-      t: 0.4375,
+      t: 21 / 67,
       pose: P({
         torso: -12, head: 12, hip: 8,
         thighR: 126, shinR: 44, footR: -80,
         thighL: 228, shinL: 34, footL: -66,
@@ -1686,9 +1689,9 @@ const downB: PoseClip = {
       scaleX: 1.12,
       ease: "hold",
     },
     {
-      t: 0.78,
+      t: 37.4 / 67,
       pose: P({
         torso: -10, head: 10, hip: 8,
         thighR: 128, shinR: 44, footR: -80,
         thighL: 226, shinL: 34, footL: -66,
@@ -1700,9 +1703,9 @@ const downB: PoseClip = {
       scaleX: 1.11,
       ease: "out",
     },
     {
-      t: 0.94,
+      t: 45.1 / 67,
       pose: P({
         torso: 4, head: -2,
         thighR: 146, shinR: 20, footR: -88,
         thighL: 208, shinL: 12, footL: -78,
```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/fighters/fludd.test.ts src/fighters/schema.test.ts`
Expected: PASS (`src/fighters/fludd.test.ts` 5 tests).

- [ ] **Step 5: Regenerate the generated files, in this order**

Each command rewrites one artefact from the code; the order matters (the limb list feeds the reconcile list and the bake, the bake feeds reach). Then review each diff against the scratch result below.

```bash
UPDATE_BAKE=1 pnpm vitest run src/render3d/bake/roster.test.ts
```

`src/fighters/bake/digest.ts` — the bake's new digest:

```diff
--- a/src/fighters/bake/digest.ts
+++ b/src/fighters/bake/digest.ts
@@ -1,5 +1,5 @@
 // GENERATED by src/render3d/bake/roster.test.ts (UPDATE_BAKE=1) — do not edit by hand.
 /** SHA-256 of the uncompressed public/bake/roster.bin.gz: the bake's fingerprint. */
-export const BAKE_DIGEST = "5abe6bfb60d7250ec36b97a24c7923bb871baa916e744c68bca2ebf5ef160672";
+export const BAKE_DIGEST = "723702c7d49d3b22091b1fe8a4b258845bcfac8d7a7cbe4ea751e9eebc2d2164";
 /** Its uncompressed length in bytes. */
-export const BAKE_BYTES = 5470013;
+export const BAKE_BYTES = 5473965;
```

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0; golden trace untouched.

- [ ] **Step 7: Commit**

```bash
git add super-smash/public/bake/roster.bin.gz super-smash/src/engine/acmd/hitboxes.ts super-smash/src/engine/acmd/legacy.ts super-smash/src/engine/simulate.ts super-smash/src/engine/types.ts super-smash/src/fighters/bake/digest.ts super-smash/src/fighters/fludd.test.ts super-smash/src/fighters/mario.ts super-smash/src/fighters/schema.test.ts super-smash/src/render/chars/mario/poses.ts
git commit -m "super-smash: F.L.U.D.D.: a stored charge and a pushing water windbox" -m "Seven pumps at 21-51, push but no damage or hitlag, through shields (SmashWiki); a counter lets the water through (UNVERIFIED). Mario's downB clip re-timed to the move. Bake regenerated. Golden trace unchanged." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Throws read `ATTACK_ABS`; pummels are catch-only; both run their scripts

Plan 3 kept throws and pummels on their legacy moves because the throw status did not read `ATTACK_ABS` (Plan 3's note: "throws/pummels once statuses read ATTACK_ABS / set_catch_only_all"). This task lifts the importer's `unknown` commands at activation (`lift.ts`, so the committed generated files stay byte for byte the importer's): `ATTACK_ABS(Kind=THROW…)` → `attackAbs` (the throw's own damage, angle, KBG/FKB/BKB, released on `ATK_HIT_ABS` → `hitAbs`), `set_catch_only_all` → `catchOnly` (a pummel hits only its grabbed victim). `REVERSE_LR` (a back throw turning the thrower) runs only in a throw. `activatable` drops its `STATUS_DRIVEN` clause, so the rule admits the 28 throws and pummels whose scripts now run; Plan 4's `limb.json` gains the limb-bone ones (run the regeneration in the order below).

**Files:**
- Create: `super-smash/src/fighters/acmd/lift.ts`, `super-smash/src/fighters/throws.test.ts`
- Modify: `super-smash/src/engine/acmd/hitboxes.ts`, `super-smash/src/engine/acmd/interpreter.ts`, `super-smash/src/engine/acmd/legacy.test.ts`, `super-smash/src/engine/acmd/legacy.ts`, `super-smash/src/engine/acmd/types.ts`, `super-smash/src/engine/simulate.ts`, `super-smash/src/fighters/acmd/active.test.ts`, `super-smash/src/fighters/acmd/active.ts`, `super-smash/src/fighters/acmd/limb.test.ts`
- Regenerate: `super-smash/public/bake/roster.bin.gz`, `super-smash/src/fighters/acmd/limb.json`, `super-smash/src/fighters/acmd/reach.allow.json`, `super-smash/src/fighters/acmd/reconcile.allow.json`, `super-smash/src/fighters/bake/digest.ts`, `super-smash/src/game/__golden__/engine-trace.json`

**Interfaces:**
- Consumes: `activatable`, `ACTIVE_SCRIPT_SLOTS`, `withReferenceScripts` (Plan 3 `fighters/acmd/active.ts`), `LIMB_SCRIPT_SLOTS`, `withLimbScripts` (Plan 4 `limb.ts`), `runScript` (Plan 2 interpreter).
- Produces: `AcmdCommand` ops `attackAbs` (`AbsParams { kind; damage; angle; kbg; fkb; bkb; hitlag; collisionAttr }`), `hitAbs`, `catchOnly`; interpreter `throwAbs`/`catchOnly`; `src/fighters/acmd/lift.ts`: `parseAbs`, `liftScript`; `absHitbox`, `absFromHitbox` (hitboxes.ts); `THROW_SLOTS` (legacy.ts); `Candidate.onlyPort`; `applyHeldHit`, `resolveThrows` (simulate.ts).

- [ ] **Step 1: Write the failing tests**

`src/engine/acmd/legacy.test.ts` — apply:

```diff
--- a/src/engine/acmd/legacy.test.ts
+++ b/src/engine/acmd/legacy.test.ts
@@ -7,9 +7,18 @@ import { projectilesDueOnFrame } from "../projectile";
 import type { Hitbox, MoveDef, MoveSlot } from "../types";
 import { LEGACY_BONE_TABLE } from "./bones";
 import { scriptHitboxes } from "./hitboxes";
 import { runScript } from "./interpreter";
-import { SLOT_MOTION, gameScriptFor, legacyGameScript } from "./legacy";
+import { SLOT_MOTION, absFromHitbox, gameScriptFor, legacyGameScript } from "./legacy";
+
+const THROWS: ReadonlySet<MoveSlot> = new Set(["fthrow", "bthrow", "uthrow", "dthrow"]);
+
+/** The box a legacy throw launches with: the last to open. */
+function lastToOpen(move: MoveDef): Hitbox | null {
+  let last: Hitbox | null = null;
+  for (const hb of move.hitboxes) if (!hb.grabbing && (last === null || hb.startFrame >= last.startFrame)) last = hb;
+  return last;
+}
 
 /** A hitbox with its defaults spelled out, so "absent" and "explicitly the default" compare equal. */
 function canonical(hb: Hitbox) {
   return {
@@ -48,12 +57,16 @@ describe("legacy moves compiled to game_ scripts", () => {
   it("covers the whole roster", () => {
     expect(MOVES.length).toBeGreaterThan(150);
   });
 
-  it.each(MOVES)("%s %s: the same hitboxes, in the same order, on every frame", (fighterId, _slot, move) => {
+  it.each(MOVES)("%s %s: the same hitboxes, in the same order, on every frame", (fighterId, slot, move) => {
     const script = legacyGameScript(move);
+    // Plan 5: a throw's launch is an ATTACK_ABS, not a box in the world.
+    const launch = THROWS.has(slot) ? lastToOpen(move) : null;
     for (let g = 1; g <= move.totalFrames + 10; g++) {
-      const want = activeHitboxes(move, g).map(canonical);
+      const want = activeHitboxes(move, g)
+        .filter((hb) => hb !== launch)
+        .map(canonical);
       const got = scriptHitboxes(runScript(script, g), fighterId, script.motion, g, LEGACY_BONE_TABLE).map(canonical);
       expect(got, `frame ${g}`).toEqual(want);
     }
   });
@@ -69,8 +82,25 @@ describe("legacy moves compiled to game_ scripts", () => {
       expect(st.momentum, `momentum on frame ${g}`).toEqual(legacyMomentum(move, g));
     }
   });
 
+  it.each(MOVES.filter(([, slot]) => THROWS.has(slot)))("%s %s: lands its launch on the held fighter, on its frame (Plan 5)", (_id, _slot, move) => {
+    const script = legacyGameScript(move);
+    const launch = lastToOpen(move)!;
+    for (let g = 1; g <= move.totalFrames + 10; g++) {
+      const st = runScript(script, g);
+      expect(st.catchOnly, `catch-only on frame ${g}`).toBe(true);
+      expect(st.fired.some((c) => c.op === "hitAbs"), `ATK_HIT_ABS on frame ${g}`).toBe(g === launch.startFrame);
+      if (g >= launch.startFrame) expect(st.throwAbs).toEqual(absFromHitbox(launch));
+    }
+  });
+
+  it("lets a pummel hit only the fighter held (Plan 5)", () => {
+    for (const [, slot, move] of MOVES) {
+      if (slot === "pummel") expect(runScript(legacyGameScript(move), 1).catchOnly).toBe(true);
+    }
+  });
+
   it("names each script after the motion its slot plays", () => {
     const mario = FIGHTERS.find((f) => f.id === "mario")!;
     expect(gameScriptFor(mario, "jab1")?.name).toBe("game_attack11");
     expect(gameScriptFor(mario, "nair")?.motion).toBe(SLOT_MOTION.nair);
```

`src/fighters/acmd/active.test.ts` — apply:

```diff
--- a/src/fighters/acmd/active.test.ts
+++ b/src/fighters/acmd/active.test.ts
@@ -9,8 +9,9 @@ import type { GameState, InputFrame, MoveSlot } from "@/engine/types";
 import { FIGHTERS } from "../index";
 import { STAGES } from "@/stages";
 import { ACTIVE_SCRIPT_SLOTS, activatable } from "./active";
 import { REFERENCE_SCRIPTS } from "./index";
+import { liftScript } from "./lift";
 
 /** Every bone a script hangs a box off. */
 function bones(commands: readonly AcmdCommand[], out = new Set<string>()): Set<string> {
   for (const c of commands) {
@@ -38,9 +39,9 @@ describe("which imported scripts run (Plan 3, Task 18)", () => {
       const active = ACTIVE_SCRIPT_SLOTS[def.id];
       expect(Object.keys(def.scripts ?? {}).sort(), def.id).toEqual([...active].sort());
       for (const slot of active) {
         const key = ref.slots[slot] as string;
-        expect(def.scripts?.[slot], `${def.id} ${slot}`).toBe(ref.scripts[key]);
+        expect(def.scripts?.[slot], `${def.id} ${slot}`).toBe(liftScript(ref.scripts[key]));
         const faf = ref.faf[key];
         if (faf !== undefined) expect(def.moves[slot]?.totalFrames, `${def.id} ${slot}`).toBe(faf - 1);
       }
     }
@@ -50,17 +51,22 @@ describe("which imported scripts run (Plan 3, Task 18)", () => {
   // the bone bake to place it, so it stays on its compiled legacy script.
   it("activates no script with a box on any bone but the root", () => {
     for (const def of FIGHTERS) {
       for (const script of Object.values(def.scripts ?? {}) as AcmdScript[]) {
-        expect([...bones(script.commands)], `${def.id} ${script.name}`).toEqual(["top"]);
+        // A throw that lands only by ATK_HIT_ABS hangs no box at all (Plan 5).
+        const hung = [...bones(script.commands)];
+        expect(hung.every((b) => b === "top"), `${def.id} ${script.name}: ${hung.join(",")}`).toBe(true);
       }
     }
   });
 
-  it("keeps throws and pummels on their legacy scripts: their statuses drive them", () => {
+  // Plan 5: a throw lands through its ATTACK_ABS, so it may hang no box on a
+  // bone; every active throw lands somewhere.
+  it("runs a throw's script only when it has an ATK_HIT_ABS to land", () => {
     for (const def of FIGHTERS) {
-      for (const slot of ["pummel", "fthrow", "bthrow", "uthrow", "dthrow"] as const) {
-        expect(ACTIVE_SCRIPT_SLOTS[def.id]).not.toContain(slot);
+      for (const slot of ["fthrow", "bthrow", "uthrow", "dthrow"] as const) {
+        if (!ACTIVE_SCRIPT_SLOTS[def.id].includes(slot)) continue;
+        expect(def.scripts?.[slot]?.commands.some((c) => c.op === "hitAbs"), `${def.id} ${slot}`).toBe(true);
       }
     }
   });
 });
```

`src/fighters/acmd/limb.test.ts` — apply:

```diff
--- a/src/fighters/acmd/limb.test.ts
+++ b/src/fighters/acmd/limb.test.ts
@@ -8,8 +8,9 @@ import { scriptBoneNames } from "@/engine/acmd/scriptBones";
 import type { MoveSlot } from "@/engine/types";
 import { FIGHTERS } from "../index";
 import { ACTIVE_SCRIPT_SLOTS, activatable } from "./active";
 import { REFERENCE_SCRIPTS } from "./index";
+import { liftScript } from "./lift";
 import { LIMB_SCRIPT_SLOTS, withLimbScripts } from "./limb";
 
 /**
  * Which limb-bone scripts the game runs (Plan 4, Task 13). Regenerate after a
@@ -71,9 +72,9 @@ describe("running the limb-bone scripts (Plan 4)", () => {
   it("hands the game the imported script for a listed slot and leaves the rest as Plan 3 had them", () => {
     for (const def of FIGHTERS) {
       const game = withLimbScripts(def);
       const ref = REFERENCE_SCRIPTS[def.id];
-      for (const slot of LIMB_SCRIPT_SLOTS[def.id] ?? []) expect(game.scripts?.[slot]).toBe(ref.scripts[ref.slots[slot]!]);
+      for (const slot of LIMB_SCRIPT_SLOTS[def.id] ?? []) expect(game.scripts?.[slot]).toBe(liftScript(ref.scripts[ref.slots[slot]!]));
       for (const slot of ACTIVE_SCRIPT_SLOTS[def.id] ?? []) expect(game.scripts?.[slot]).toBe(def.scripts?.[slot]);
       expect(withLimbScripts(def)).toBe(game);
     }
   });
```

`src/fighters/throws.test.ts` (new file):

```ts
/**
 * Throws and pummels the way SSBU runs them (Plan 5, Task 7): a throw's
 * launch is an `ATTACK_ABS` laid on the held fighter by `ATK_HIT_ABS`, not a
 * hitbox that has to find them, and a pummel (`set_catch_only_all`) hurts the
 * held fighter without letting them go.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { fx, toFloat } from "@/engine/fixed";
import { createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { Btn } from "@/engine/types";
import type { GameState, InputFrame, MatchRules, StepEvents } from "@/engine/types";
import { STAGES } from "@/stages";
import { FIGHTERS } from "./index";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true };

beforeAll(() => {
  registerFighters(FIGHTERS);
  registerStages(STAGES);
});

/** `thrower` holding Fox, as a landed grab leaves them. */
function holding(thrower: string): GameState {
  const s = createInitialState("finalDestination", [{ defId: thrower }, { defId: "fox" }], RULES, 5);
  const [a, v] = s.fighters;
  Object.assign(a, { action: "grabHold", actionFrame: 0, grounded: true, platform: 0, x: fx(-4), y: 0, facing: 1, intangible: 0, grabbing: 1 });
  Object.assign(v, { action: "grabbed", actionFrame: 0, grounded: true, platform: 0, x: fx(4), y: 0, facing: -1, intangible: 0, grabbedBy: 0, grabTimer: 500 });
  return s;
}

function run(s0: GameState, inputs: readonly InputFrame[]): { states: GameState[]; events: StepEvents[] } {
  let s = s0;
  let prev: [InputFrame, InputFrame] = [0, 0];
  const states: GameState[] = [];
  const events: StepEvents[] = [];
  for (const i of inputs) {
    const now: [InputFrame, InputFrame] = [i, 0];
    const out = step(s, now, { prevInputs: prev });
    s = out.state;
    prev = now;
    states.push(s);
    events.push(out.events);
  }
  return { states, events };
}

describe("throws", () => {
  it("land Mario's forward throw on frame 13, wherever Fox is (ATTACK_ABS 8%, angle 45)", () => {
    const s = holding("mario");
    // Even held well away from the hand, the throw lands: no hitbox has to reach.
    s.fighters[1].x = fx(30);
    const { states, events } = run(s, [Btn.Right, ...Array<InputFrame>(30).fill(0)]);
    // Frame 13 of the throw: the twelfth step after the one that started it.
    const at = events.findIndex((e) => e.hits.length > 0);
    expect(at).toBe(12);
    expect(toFloat(events[at].hits[0].damage)).toBeCloseTo(8 * 1.05 * 1.2, 2);
    expect(states[at].fighters[1].grabbedBy).toBe(-1);
    expect(states[states.length - 1].fighters[1].vx).toBeGreaterThan(0);
  });

  it("turns the thrower round for a back throw that reverses (REVERSE_LR)", () => {
    const { states } = run(holding("samus"), [Btn.Left, ...Array<InputFrame>(40).fill(0)]);
    expect(states.some((s) => s.fighters[0].facing === -1)).toBe(true);
    // Launched behind her: to the left of where she was held.
    expect(states[states.length - 1].fighters[1].x).toBeLessThan(fx(-10));
  });
});

describe("pummels", () => {
  it("hurt the fighter held and keep holding them", () => {
    const { states, events } = run(holding("mario"), [Btn.Attack, ...Array<InputFrame>(12).fill(0)]);
    expect(events.some((e) => e.hits.length > 0)).toBe(true);
    const end = states[states.length - 1];
    expect(end.fighters[1].damage).toBeGreaterThan(0);
    expect(end.fighters[1].action).toBe("grabbed");
    expect(end.fighters[0].grabbing).toBe(1);
  });

  it("never hit a bystander", () => {
    const s = createInitialState("finalDestination", [{ defId: "mario" }, { defId: "fox" }, { defId: "kirby" }], { ...RULES, oneOnOne: false }, 5);
    const [a, v, by] = s.fighters;
    Object.assign(a, { action: "grabHold", grounded: true, platform: 0, x: fx(-4), y: 0, facing: 1, intangible: 0, grabbing: 1 });
    // Kirby stands right where the pummel lands, inside Fox.
    Object.assign(v, { action: "grabbed", grounded: true, platform: 0, x: fx(4), y: 0, intangible: 0, grabbedBy: 0, grabTimer: 500 });
    Object.assign(by, { action: "stand", grounded: true, platform: 0, x: fx(5), y: 0, intangible: 0 });
    let st = s;
    let prev: InputFrame[] = [0, 0, 0];
    for (const i of [Btn.Attack, 0, 0, 0, 0, 0]) {
      const now = [i, 0, 0];
      st = step(st, now, { prevInputs: prev }).state;
      prev = now;
    }
    expect(st.fighters[2].damage).toBe(0);
    expect(st.fighters[1].damage).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/engine/acmd/legacy.test.ts src/fighters/acmd/active.test.ts src/fighters/acmd/limb.test.ts src/fighters/throws.test.ts`
Expected: FAIL — 69 failed | 381 passed — `active.test.ts` and `limb.test.ts` cannot load (`Failed to resolve import "./lift"`, `Cannot find module './lift'`); `throws.test.ts` `expected false to be true` (no throw lands); `legacy.test.ts` `frame 13: expected [ { id: +0, x: 16384, …(13) } ] to deeply equal []` and the like for every throw.

- [ ] **Step 3: Implement**

`src/engine/acmd/hitboxes.ts` — apply:

```diff
--- a/src/engine/acmd/hitboxes.ts
+++ b/src/engine/acmd/hitboxes.ts
@@ -14,9 +14,9 @@ import { ONE, fx } from "../fixed";
 import type { HitEffect, Hitbox } from "../types";
 import { bonePoint, newBonePose } from "./bones";
 import type { BoneTable } from "./bones";
 import type { ScriptFrameState } from "./interpreter";
-import type { AttackParams, CatchParams, MotionKind } from "./types";
+import type { AbsParams, AttackParams, CatchParams, MotionKind } from "./types";
 
 /** `collision_attr_*` ↔ the replica's `HitEffect`. */
 export const EFFECT_OF_ATTR: Readonly<Record<string, HitEffect>> = {
   collision_attr_normal: "normal",
@@ -163,4 +163,27 @@ function farEnd(
 
 function withFarEnd(hb: Hitbox, far: { x: number; y: number } | null): Hitbox {
   return far === null ? hb : { ...hb, x2: far.x, y2: far.y };
 }
+
+/**
+ * A throw's `ATTACK_ABS` as the hitbox the hit pipeline takes (Plan 5). It has
+ * no position: the throw status lays it on the held fighter.
+ */
+export function absHitbox(a: AbsParams): Hitbox {
+  const effect = EFFECT_OF_ATTR[a.collisionAttr];
+  return {
+    id: 0,
+    startFrame: 0,
+    endFrame: 0,
+    x: 0,
+    y: 0,
+    radius: 0,
+    damage: a.damage,
+    angle: a.angle,
+    baseKnockback: a.fkb > 0 ? a.fkb : a.bkb,
+    knockbackGrowth: a.kbg,
+    hitlagMultiplier: a.hitlag,
+    ...(effect !== undefined && effect !== "normal" ? { effect } : {}),
+    ...(a.fkb > 0 ? { setKnockback: true } : {}),
+  };
+}
```

`src/engine/acmd/interpreter.ts` — apply:

```diff
--- a/src/engine/acmd/interpreter.ts
+++ b/src/engine/acmd/interpreter.ts
@@ -20,9 +20,9 @@
  * 0.9 accumulated in Q12 reaches 10.99976 after nine frames instead of 11, and
  * `frame(11)` would fire a game frame late. Review Focus #3.
  */
 
-import type { AcmdCommand, AcmdScript, AttackParams, CatchParams, HitStatus } from "./types";
+import type { AbsParams, AcmdCommand, AcmdScript, AttackParams, CatchParams, HitStatus } from "./types";
 
 export interface ActiveMomentum {
   readonly x: number;
   readonly y: number;
@@ -41,8 +41,12 @@ export interface ScriptFrameState {
   readonly superArmour: boolean;
   readonly wholeHit: HitStatus;
   /** The live scripted velocity, if any, with the lowest `order`. */
   readonly momentum: ActiveMomentum | null;
+  /** The live `ATTACK_ABS` throw launch, if any (Plan 5). */
+  readonly throwAbs: AbsParams | null;
+  /** `set_catch_only_all`: the live boxes hit only the held fighter (Plan 5). */
+  readonly catchOnly: boolean;
   /** The motion frame this game frame shows, floored — what a bone table is indexed by. */
   readonly motionFrame: number;
   /** Commands that ran on exactly this game frame, in script order. */
   readonly fired: readonly AcmdCommand[];
@@ -94,8 +98,10 @@ export function runScript(script: AcmdScript, gameFrame: number): ScriptFrameSta
   const windows: { x: number; y: number; start: number; until: number; order: number }[] = [];
   const fired: AcmdCommand[] = [];
   let superArmour = false;
   let wholeHit: HitStatus = "HIT_STATUS_NORMAL";
+  let throwAbs: AbsParams | null = null;
+  let catchOnly = false;
 
   // The current constant-rate segment: from game frame g0 at motion m0, the
   // motion advances rateDen / rateNum per game frame.
   let g0 = 1;
@@ -141,8 +147,9 @@ export function runScript(script: AcmdScript, gameFrame: number): ScriptFrameSta
         catches.set(c.params.id, c.params);
         break;
       case "clearAll":
         attacks.clear();
+        catchOnly = false;
         break;
       case "clear":
         attacks.delete(c.id);
         break;
@@ -178,8 +185,15 @@ export function runScript(script: AcmdScript, gameFrame: number): ScriptFrameSta
         break;
       case "momentum":
         windows.push({ x: c.x, y: c.y, start: e, until: e + c.hold, order: c.order });
         break;
+      case "attackAbs":
+        if (c.params.kind === "throw") throwAbs = c.params;
+        break;
+      case "catchOnly":
+        catchOnly = c.on;
+        break;
+      case "hitAbs":
       case "spawnProjectile":
       case "reverseLr":
       case "unknown":
         break;
@@ -201,8 +215,10 @@ export function runScript(script: AcmdScript, gameFrame: number): ScriptFrameSta
     shieldSetoff,
     flags: [...flags].sort(),
     superArmour,
     wholeHit,
+    throwAbs,
+    catchOnly,
     momentum,
     motionFrame: Math.floor(m.n / m.d),
     fired,
   };
```

`src/engine/acmd/legacy.ts` — apply:

```diff
--- a/src/engine/acmd/legacy.ts
+++ b/src/engine/acmd/legacy.ts
@@ -14,9 +14,9 @@
 
 import { ONE } from "../fixed";
 import type { FighterDef, Hitbox, MoveDef, MoveSlot } from "../types";
 import { ATTR_OF_EFFECT } from "./hitboxes";
-import type { AcmdCommand, AcmdScript, AttackParams, MotionKind } from "./types";
+import type { AbsParams, AcmdCommand, AcmdScript, AttackParams, MotionKind } from "./types";
 
 /** Which SSBU motion each move slot plays (rubendal `Motions`, e.g. Mario's `game_attacks3` → `attack_s3_s`). */
 export const SLOT_MOTION: Readonly<Record<MoveSlot, MotionKind>> = {
   jab1: "attack_11",
@@ -107,10 +107,20 @@ export function legacyGameScript(move: MoveDef): AcmdScript {
     }
     return b;
   };
 
+  // A throw's launch is `ATTACK_ABS` + `ATK_HIT_ABS` (Plan 5): the last box to
+  // open is the launch, applied to the held fighter whatever the geometry, and
+  // any box before it hits the held fighter only, as a pummel does.
+  const isThrow = THROW_SLOTS.has(move.slot);
+  const launch = isThrow ? lastToOpen(move.hitboxes) : null;
+  if (isThrow || move.slot === "pummel") at(1).open.push({ op: "catchOnly", on: true });
   for (const hb of move.hitboxes) {
     if (hb.endFrame < hb.startFrame) continue;
+    if (hb === launch) {
+      at(hb.startFrame).open.push({ op: "attackAbs", params: absFromHitbox(hb) }, { op: "hitAbs" });
+      continue;
+    }
     if (hb.grabbing) {
       at(hb.startFrame).open.push({
         op: "catch",
         params: {
@@ -150,8 +160,30 @@ export function legacyGameScript(move: MoveDef): AcmdScript {
   }
   return { name: `game_${SLOT_MOTION[move.slot].replace(/_/g, "")}`, motion: SLOT_MOTION[move.slot], commands };
 }
 
+const THROW_SLOTS: ReadonlySet<MoveSlot> = new Set(["fthrow", "bthrow", "uthrow", "dthrow"]);
+
+function lastToOpen(hitboxes: readonly Hitbox[]): Hitbox | null {
+  let last: Hitbox | null = null;
+  for (const hb of hitboxes) if (!hb.grabbing && (last === null || hb.startFrame >= last.startFrame)) last = hb;
+  return last;
+}
+
+/** A legacy throw box as `ATTACK_ABS(Kind=FIGHTER_ATTACK_ABSOLUTE_KIND_THROW, …)`. */
+export function absFromHitbox(hb: Hitbox): AbsParams {
+  return {
+    kind: "throw",
+    damage: hb.damage,
+    angle: hb.angle,
+    kbg: hb.knockbackGrowth,
+    fkb: hb.setKnockback ? hb.baseKnockback : 0,
+    bkb: hb.setKnockback ? 0 : hb.baseKnockback,
+    hitlag: hb.hitlagMultiplier ?? ONE,
+    collisionAttr: ATTR_OF_EFFECT[hb.effect ?? "normal"],
+  };
+}
+
 const compiled = new WeakMap<MoveDef, AcmdScript>();
 
 /** The script a fighter runs for a move slot: its override, else the compiled legacy move. */
 export function gameScriptFor(def: FighterDef, slot: MoveSlot): AcmdScript | null {
```

`src/engine/acmd/types.ts` — apply:

```diff
--- a/src/engine/acmd/types.ts
+++ b/src/engine/acmd/types.ts
@@ -102,8 +102,26 @@ export interface CatchParams {
   readonly status: string;
   readonly situation: CollisionSituation;
 }
 
+/**
+ * smash-script `ATTACK_ABS(Kind, ID, Damage, Angle, KBG, FKB, BKB, …)`: a
+ * throw's launch (`FIGHTER_ATTACK_ABSOLUTE_KIND_THROW`) or what the held
+ * fighter takes if let go mid-throw (`…_KIND_CATCH`). It hits no hurtbox: the
+ * throw status applies it to the held fighter on `ATK_HIT_ABS` (Plan 5).
+ */
+export interface AbsParams {
+  readonly kind: "throw" | "catch";
+  readonly damage: number;
+  readonly angle: number;
+  readonly kbg: number;
+  readonly fkb: number;
+  readonly bkb: number;
+  /** Hitlag multiplier (ONE = 1.0×); the published throws use 0. */
+  readonly hitlag: number;
+  readonly collisionAttr: string;
+}
+
 /** A rate as an exact fraction: game frames per motion frame (`FT_MOTION_RATE`'s FSM). */
 export type Rate = readonly [num: number, den: number];
 
 export type AcmdCommand =
@@ -143,8 +161,14 @@ export type AcmdCommand =
   /** `ArticleModule::generate_article` — here, a `ProjectileDef` id. */
   | { readonly op: "spawnProjectile"; readonly id: string }
   /** `REVERSE_LR()`. */
   | { readonly op: "reverseLr" }
+  /** `ATTACK_ABS(…)` (Plan 5). */
+  | { readonly op: "attackAbs"; readonly params: AbsParams }
+  /** `ATK_HIT_ABS(FIGHTER_ATTACK_ABSOLUTE_KIND_THROW, …)`: the throw lands now (Plan 5). */
+  | { readonly op: "hitAbs" }
+  /** `AttackModule::set_catch_only_all(on, …)`: the boxes hit only the held fighter (Plan 5). */
+  | { readonly op: "catchOnly"; readonly on: boolean }
   /** `for(N Iterations){ … }`. */
   | { readonly op: "loop"; readonly count: number; readonly body: readonly AcmdCommand[] }
   /** Anything the replica does not interpret yet, kept verbatim so nothing is lost on import. */
   | { readonly op: "unknown"; readonly raw: string };
```

`src/engine/simulate.ts` — apply:

```diff
--- a/src/engine/simulate.ts
+++ b/src/engine/simulate.ts
@@ -142,9 +142,9 @@ import {
   shieldBubble,
   shieldDamage,
   shieldPushback,
 } from "./shield";
-import { scriptHitboxes } from "./acmd/hitboxes";
+import { absHitbox, scriptHitboxes } from "./acmd/hitboxes";
 import { moveScriptFrame } from "./acmd/run";
 import "./status";
 import { emptyEvents } from "./types";
 import type {
@@ -485,8 +485,13 @@ interface Candidate {
   readonly projectile: ProjectileState | null;
   /** Charge scaling already resolved: Samus's shot, or a charged smash. */
   readonly chargeScale: number;
   readonly destroyOnHit: boolean;
+  /**
+   * `set_catch_only_all` (Plan 5): the one port this box may hit — the held
+   * fighter — and then only for damage; null when it may hit anybody.
+   */
+  readonly onlyPort: number | null;
   suppressed: boolean;
 }
 
 /** Where a candidate's box is this frame: a capsule, or a circle when it has no length. */
@@ -684,8 +689,9 @@ export function step(
   // Reflectors first: a reflected projectile neither clanks nor hits this frame (Plan 5).
   reflectProjectiles(s, defs, (p) => projectileDefOf(ctx, p), candidates, events, destroyed);
   resolveClanks(s, candidates, events, destroyed);
   resolveHits(s, defs, bake, bones, candidates, intents, events, destroyed);
+  resolveThrows(s, defs, frozen, intents, events);
   if (destroyed.size > 0) {
     s.projectiles = s.projectiles.filter((p) => !destroyed.has(p.instanceId));
   }
 
@@ -801,8 +807,9 @@ function gatherHitboxes(
         slot: f.move,
         projectile: null,
         chargeScale: f.action === "attack" ? chargeMultiplier(f.charge) : ONE,
         destroyOnHit: false,
+        onlyPort: run.state.catchOnly ? f.grabbing : null,
         suppressed: false,
       });
     }
   }
@@ -895,8 +902,9 @@ function appendProjectileCandidates(
       slot: null,
       projectile: p,
       chargeScale: p.chargeScale,
       destroyOnHit: def.destroyOnHit === true,
+      onlyPort: null,
       suppressed: false,
     });
   }
 }
@@ -993,8 +1001,9 @@ function resolveHits(
     // Per source, the lowest-id hitbox that reaches this victim.
     const perSource = new Map<number, Candidate>();
     for (const c of candidates) {
       if (c.suppressed || c.attacker === v) continue;
+      if (c.onlyPort !== null && c.onlyPort !== v) continue;
       if (c.hitbox.situation === "ground" && !victim.grounded) continue;
       if (c.hitbox.situation === "air" && victim.grounded) continue;
       if (c.projectile !== null && destroyed.has(c.projectile.instanceId)) continue;
       if (recordSaysAlreadyHit(s, c, victim.port)) continue;
@@ -1318,8 +1327,14 @@ function applyHit(
   const hb = c.hitbox;
   const fromProjectile = c.projectile !== null;
   recordHit(c, attacker, victim.port);
 
+  // A pummel, or a throw's early hits, on the fighter being held (Plan 5).
+  if (c.onlyPort !== null) {
+    applyHeldHit(s, attacker, victim, c, events);
+    return;
+  }
+
   // A windbox only pushes (Plan 5, F.L.U.D.D.).
   if (hb.windbox === true) {
     applyWindbox(attacker, victim, victimDef, c);
     return;
@@ -1609,8 +1624,65 @@ function applyHit(
     hitboxId: hb.id,
   });
 }
 
+/**
+ * A hit on the fighter being held (Plan 5: `set_catch_only_all`): damage and
+ * the freeze, and nothing else — they stay held, as in a pummel.
+ */
+function applyHeldHit(s: GameState, attacker: FighterState, victim: FighterState, c: Candidate, events: StepEvents): void {
+  const damage = effectiveDamage(s, attacker, c);
+  victim.damage += damage;
+  const lag = computeHitlag(damage, { electric: c.hitbox.effect === "electric", moveMultiplier: c.hitbox.hitlagMultiplier });
+  victim.hitlag = lag;
+  attacker.hitlag = lag;
+  events.hits.push({ attacker: attacker.port, victim: victim.port, damage, x: c.x, y: c.y, knockback: 0, angle: 0, hitboxId: c.hitbox.id });
+}
+
+/**
+ * Throws (Plan 5): a throw's `REVERSE_LR` turns the thrower round, and its
+ * `ATK_HIT_ABS` lays the live `ATTACK_ABS` launch on the fighter held — no
+ * hurtbox, no geometry — through the ordinary hit pipeline.
+ */
+function resolveThrows(
+  s: GameState,
+  defs: readonly FighterDef[],
+  frozen: readonly boolean[],
+  intents: readonly Intent[],
+  events: StepEvents,
+): void {
+  for (let i = 0; i < s.fighters.length; i++) {
+    const f = s.fighters[i];
+    if (frozen[i] || f.action !== "throw" || f.move === null) continue;
+    const run = moveScriptFrame(defs[i], f);
+    if (run === null) continue;
+    for (const cmd of run.state.fired) {
+      if (cmd.op === "reverseLr") f.facing = -f.facing;
+      if (cmd.op !== "hitAbs" || run.state.throwAbs === null || f.grabbing < 0) continue;
+      const v = f.grabbing;
+      const victim = s.fighters[v];
+      if (victim === undefined || victim.grabbedBy !== f.port) continue;
+      const c: Candidate = {
+        attacker: i,
+        hitbox: absHitbox(run.state.throwAbs),
+        x: victim.x,
+        y: victim.y,
+        prevX: victim.x,
+        prevY: victim.y,
+        dx: 0,
+        dy: 0,
+        slot: f.move,
+        projectile: null,
+        chargeScale: ONE,
+        destroyOnHit: false,
+        onlyPort: null,
+        suppressed: false,
+      };
+      applyHit(s, f, victim, defs[v], c, intents[v], events);
+    }
+  }
+}
+
 /**
  * A windbox's push (Plan 5): the hit's knockback, at its angle, as velocity —
  * the ground slides a grounded fighter (the stop energy, which traction
  * brakes), the air carries an airborne one. No hitstun, hitlag, damage or stale
```

`src/fighters/acmd/active.ts` — apply:

```diff
--- a/src/fighters/acmd/active.ts
+++ b/src/fighters/acmd/active.ts
@@ -6,10 +6,11 @@
  * bone bake, only if the replica can place and honour everything in it:
  *
  * - every ATTACK and CATCH hangs off the root bone, `top` — the only bone
  *   `LEGACY_BONE_TABLE` places (limb-bone scripts wait for Plan 4's bake);
- * - the move is not one a status drives rather than its script: a throw
- *   (`ATTACK_ABS`) or a pummel (`set_catch_only_all`);
+ * - (Plan 5) a throw's `ATTACK_ABS`/`ATK_HIT_ABS` and a pummel's
+ *   `set_catch_only_all` are lifted into commands the throw status and the
+ *   hit pipeline honour (`lift.ts`), so throws and pummels qualify too;
  * - its legacy move carries nothing the script would drop: no scripted
  *   momentum, projectile, super armour or smash charge (those stay on the
  *   compiled legacy script until the energies and the charge read the script);
  * - every command is one the interpreter runs, or a cosmetic one listed below;
@@ -22,8 +23,9 @@
 
 import { runScript } from "@/engine/acmd/interpreter";
 import type { AcmdCommand, AcmdScript } from "@/engine/acmd/types";
 import type { FighterDef, MoveDef, MoveSlot } from "@/engine/types";
+import { liftScript } from "./lift";
 import type { ReferenceFighter } from "./reference";
 
 /** Commands the interpreter runs and the sim honours (or that change nothing). */
 const RUN_OPS: ReadonlySet<AcmdCommand["op"]> = new Set([
@@ -38,10 +40,17 @@ const RUN_OPS: ReadonlySet<AcmdCommand["op"]> = new Set([
   "setFlag",
   "shieldSetoffMul",
   "motionRate",
   "loop",
+  // Plan 5: lifted from `unknown` by `liftScript`.
+  "attackAbs",
+  "hitAbs",
+  "catchOnly",
 ]);
 
+/** `REVERSE_LR()` runs only in a throw, whose status turns the thrower (Plan 5). */
+const THROW_SLOTS: ReadonlySet<MoveSlot> = new Set(["fthrow", "bthrow", "uthrow", "dthrow"]);
+
 /** Engine calls with no effect on the replica's sim: collision pushboxes, hit-height tags, VFX, grab-cut bookkeeping. */
 const COSMETIC_PREFIXES: readonly string[] = [
   "FighterAreaModuleImpl::enable_fix_jostle_area",
   "JostleModule::set_status",
@@ -49,20 +58,27 @@ const COSMETIC_PREFIXES: readonly string[] = [
   "AttackModule::set_no_damage_fly_smoke_all",
   "GrabModule::set_rebound",
   "methodlua2cpp::L2CFighterAnimcmdGameCommon::game_CaptureCutCommon",
   "FT_START_ADJUST_MOTION_FRAME",
+  // Plan 5: a throw's camera, cut-in and teeter bookkeeping.
+  "CHECK_FINISH_CAMERA",
+  "FighterCutInManager::",
+  "FT_LEAVE_NEAR_OTTOTTO",
+  "FT_CATCH_STOP",
 ];
 
 /** Longer than any move: a box still live here is never cleared by its script. */
 const CLEARED_BY = 300;
 
-const STATUS_DRIVEN: ReadonlySet<MoveSlot> = new Set(["pummel", "fthrow", "bthrow", "uthrow", "dthrow"]);
-
-function runnable(commands: readonly AcmdCommand[], bones: Set<string>): boolean {
+function runnable(commands: readonly AcmdCommand[], bones: Set<string>, throwing: boolean): boolean {
   for (const c of commands) {
     if (c.op === "attack" || c.op === "catch") bones.add(c.params.bone);
     if (c.op === "loop") {
-      if (!runnable(c.body, bones)) return false;
+      if (!runnable(c.body, bones, throwing)) return false;
+      continue;
+    }
+    if (c.op === "reverseLr") {
+      if (!throwing) return false;
       continue;
     }
     if (c.op === "unknown") {
       if (!COSMETIC_PREFIXES.some((p) => c.raw.startsWith(p))) return false;
@@ -86,15 +102,18 @@ export function activatable(
   move: MoveDef | undefined,
   script: AcmdScript,
   placeable: (bone: string) => boolean = ROOT_BONE_ONLY,
 ): boolean {
-  if (move === undefined || STATUS_DRIVEN.has(slot)) return false;
+  if (move === undefined) return false;
   if (move.momentum !== undefined || move.projectiles !== undefined) return false;
   if (move.superArmourFrames !== undefined || move.chargeable === true || move.specialCharge !== undefined) return false;
+  const lifted = liftScript(script);
   const bones = new Set<string>();
-  if (!runnable(script.commands, bones)) return false;
-  if (bones.size === 0 || ![...bones].every(placeable)) return false;
-  const end = runScript(script, CLEARED_BY);
+  if (!runnable(lifted.commands, bones, THROW_SLOTS.has(slot))) return false;
+  // A throw lands by ATK_HIT_ABS and may hang no box on a bone at all.
+  const throws = lifted.commands.some((c) => c.op === "hitAbs");
+  if ((bones.size === 0 && !throws) || ![...bones].every(placeable)) return false;
+  const end = runScript(lifted, CLEARED_BY);
   return end.attacks.length + end.catches.length === 0;
 }
 
 /**
@@ -109,25 +128,26 @@ export function withReferenceScripts(def: FighterDef, ref: ReferenceFighter, slo
   for (const slot of slots) {
     const key = ref.slots[slot];
     const move = def.moves[slot];
     if (key === undefined || move === undefined) throw new Error(`${def.id} ${slot}: no reference script or legacy move`);
-    scripts[slot] = ref.scripts[key];
+    scripts[slot] = liftScript(ref.scripts[key]);
     const faf = ref.faf[key];
     if (faf !== undefined) moves[slot] = { ...move, totalFrames: faf - 1 };
   }
   return { ...def, scripts, moves };
 }
 
 /**
  * The slots each fighter runs from its imported script — every slot the rule
- * admits, no more (pinned by `active.test.ts`). 38 of the roster's moves.
+ * admits, no more (pinned by `active.test.ts`). 66 of the roster's moves; Plan 5
+ * added the 28 throws and pummels whose ATTACK_ABS the throw status now reads.
  */
 export const ACTIVE_SCRIPT_SLOTS: Readonly<Record<string, readonly MoveSlot[]>> = {
-  mario: ["jab1", "dashAttack", "dair", "grab", "dashGrab"],
-  donkeyKong: ["dashAttack", "dair", "grab", "dashGrab"],
-  link: ["jab1", "jab2", "dtilt", "fair", "dair", "grab", "dashGrab"],
-  samus: ["dashAttack"],
-  kirby: ["jab1", "jab2", "dashAttack", "fair", "bair", "dair", "grab", "dashGrab"],
-  fox: ["jab1", "jab2", "grab", "dashGrab"],
-  pikachu: ["jab1", "dtilt", "nair", "fair", "grab", "dashGrab"],
-  marth: ["sideB", "grab", "dashGrab"],
+  mario: ["jab1", "dashAttack", "dair", "grab", "dashGrab", "pummel", "fthrow", "uthrow", "dthrow"],
+  donkeyKong: ["dashAttack", "dair", "grab", "dashGrab", "pummel", "uthrow", "dthrow"],
+  link: ["jab1", "jab2", "dtilt", "fair", "dair", "grab", "dashGrab", "pummel", "dthrow"],
+  samus: ["dashAttack", "pummel", "fthrow", "bthrow", "uthrow", "dthrow"],
+  kirby: ["jab1", "jab2", "dashAttack", "fair", "bair", "dair", "grab", "dashGrab", "pummel", "fthrow", "bthrow", "dthrow"],
+  fox: ["jab1", "jab2", "grab", "dashGrab", "pummel", "fthrow"],
+  pikachu: ["jab1", "dtilt", "nair", "fair", "grab", "dashGrab", "fthrow", "bthrow", "uthrow"],
+  marth: ["sideB", "grab", "dashGrab", "pummel", "fthrow", "bthrow", "uthrow", "dthrow"],
 };
```

`src/fighters/acmd/lift.ts` (new file):

```ts
/**
 * The commands the importer leaves as `unknown` that Plan 5 runs: a throw's
 * `ATTACK_ABS` and `ATK_HIT_ABS`, and a pummel's `set_catch_only_all`.
 *
 * Lifted here, at activation, rather than in the generated files, so the
 * committed imports stay byte-for-byte what `scripts/import-acmd.mjs` wrote.
 * `parseArgs` is the importer's own argument splitter.
 */

import { fx } from "@/engine/fixed";
import type { AbsParams, AcmdCommand, AcmdScript } from "@/engine/acmd/types";
import { parseArgs, unhash } from "./parse";

const ABS = /^ATTACK_ABS\((.*)\)$/;

/** `ATTACK_ABS(Kind=…, ID=0, Damage=8.0, Angle=45, KBG=65, FKB=0, BKB=60, Hitlag=0.0, …)`. */
export function parseAbs(raw: string): AbsParams | null {
  const m = ABS.exec(raw);
  if (m === null) return null;
  const a = parseArgs(m[1]);
  const kind = a.Kind === "FIGHTER_ATTACK_ABSOLUTE_KIND_THROW" ? "throw" : a.Kind === "FIGHTER_ATTACK_ABSOLUTE_KIND_CATCH" ? "catch" : null;
  if (kind === null) return null;
  return {
    kind,
    damage: fx(Number(a.Damage)),
    angle: fx(Number(a.Angle)),
    kbg: fx(Number(a.KBG)),
    fkb: fx(Number(a.FKB)),
    bkb: fx(Number(a.BKB)),
    hitlag: fx(Number(a.Hitlag)),
    collisionAttr: unhash(a.Effect ?? 'hash40("collision_attr_normal")'),
  };
}

function lift(c: AcmdCommand): AcmdCommand {
  if (c.op === "loop") return { ...c, body: c.body.map(lift) };
  if (c.op !== "unknown") return c;
  const abs = parseAbs(c.raw);
  if (abs !== null) return { op: "attackAbs", params: abs };
  if (c.raw.startsWith("ATK_HIT_ABS(FIGHTER_ATTACK_ABSOLUTE_KIND_THROW")) return { op: "hitAbs" };
  if (c.raw.startsWith("AttackModule::set_catch_only_all(true")) return { op: "catchOnly", on: true };
  if (c.raw.startsWith("AttackModule::set_catch_only_all(false")) return { op: "catchOnly", on: false };
  return c;
}

const cache = new WeakMap<AcmdScript, AcmdScript>();

/** `script` with the commands above lifted. The same object for the same script. */
export function liftScript(script: AcmdScript): AcmdScript {
  let out = cache.get(script);
  if (out === undefined) {
    out = { ...script, commands: script.commands.map(lift) };
    cache.set(script, out);
  }
  return out;
}
```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/engine/acmd/legacy.test.ts src/fighters/acmd/active.test.ts src/fighters/acmd/limb.test.ts src/fighters/throws.test.ts`
Expected: PASS (`src/fighters/throws.test.ts` 4 tests).

- [ ] **Step 5: Regenerate the generated files, in this order**

Each command rewrites one artefact from the code; the order matters (the limb list feeds the reconcile list and the bake, the bake feeds reach). Then review each diff against the scratch result below.

```bash
UPDATE_LIMB=1 pnpm vitest run src/fighters/acmd/limb.test.ts
UPDATE_RECONCILE=1 pnpm vitest run src/fighters/acmd/reconcile.test.ts
UPDATE_BAKE=1 pnpm vitest run src/render3d/bake/roster.test.ts
UPDATE_REACH=1 pnpm vitest run src/fighters/acmd/reach.test.ts
UPDATE_GOLDEN=1 pnpm vitest run src/game/golden.test.ts
```

`src/fighters/acmd/limb.json` — the expected change:

```diff
--- a/src/fighters/acmd/limb.json
+++ b/src/fighters/acmd/limb.json
@@ -1,7 +1,8 @@
 {
   "mario": [
     "bair",
+    "bthrow",
     "dtilt",
     "fair",
     "ftilt",
     "jab2",
@@ -18,11 +19,14 @@
     "nair"
   ],
   "link": [
     "bair",
+    "bthrow",
+    "fthrow",
     "ftilt",
     "jab3",
     "nair",
+    "uthrow",
     "utilt"
   ],
   "samus": [
     "bair",
@@ -52,9 +56,11 @@
   "pikachu": [
     "bair",
     "dair",
     "dashAttack",
+    "dthrow",
     "ftilt",
+    "pummel",
     "uair",
     "utilt"
   ],
   "marth": [
```

`src/fighters/acmd/reconcile.allow.json` — the expected change:

```diff
--- a/src/fighters/acmd/reconcile.allow.json
+++ b/src/fighters/acmd/reconcile.allow.json
@@ -1,53 +1,22 @@
 {
   "mario upB last": "legacy 18 / game_specialhi 300",
   "mario upB lead": "legacy 5%/86°/fkb150/kbg100 / game_specialhi 5%/60°/fkb160/kbg100",
-  "mario pummel faf": "legacy 20 / game_catchattack 7",
-  "mario fthrow hitboxes": "legacy some / game_throwf none",
-  "mario bthrow first": "legacy 44 / game_throwb 13",
-  "mario bthrow last": "legacy 44 / game_throwb 39",
-  "mario bthrow lead": "legacy 11%/45°/bkb70/kbg66 / game_throwb 8%/50°/bkb100/kbg70",
-  "mario uthrow hitboxes": "legacy some / game_throwhi none",
-  "mario dthrow hitboxes": "legacy some / game_throwlw none",
   "donkeyKong ftilt faf": "legacy 35 / game_attacks3 36",
   "donkeyKong utilt lead": "legacy 10%/100°/bkb40/kbg115 / game_attackhi3 8%/100°/bkb40/kbg105",
   "donkeyKong neutralB first": "legacy 26 / game_specialn 19",
   "donkeyKong neutralB last": "legacy 27 / game_specialn 20",
   "donkeyKong neutralB faf": "legacy 70 / game_specialn 63",
   "donkeyKong upB lead": "legacy 5%/95°/fkb90/kbg30 / game_specialhi 5%/95°/fkb30/kbg90",
   "donkeyKong downB hitboxes": "legacy some / game_speciallwstart none",
-  "donkeyKong pummel faf": "legacy 22 / game_catchattack 8",
-  "donkeyKong fthrow hitboxes": "legacy some / game_throwf none",
-  "donkeyKong bthrow hitboxes": "legacy some / game_throwb none",
-  "donkeyKong uthrow hitboxes": "legacy some / game_throwhi none",
-  "donkeyKong dthrow hitboxes": "legacy some / game_throwlw none",
   "link fsmash lead": "legacy 14%/361°/bkb30/kbg100 / game_attacks4 7%/69°/bkb45/kbg12",
   "link fsmash faf": "legacy 51 / game_attacks4 49",
   "link dsmash lead": "legacy 17%/78°/bkb40/kbg88 / game_attacklw4 16%/78°/bkb40/kbg88",
   "link dsmash faf": "legacy 57 / game_attacklw4 52",
   "link upB first": "legacy 7 / game_specialhi 4",
   "link upB last": "legacy 39 / game_specialhi 36",
   "link upB faf": "legacy 77 / game_specialhi 74",
-  "link pummel faf": "legacy 19 / game_catchattack 7",
-  "link fthrow first": "legacy 13 / game_throwf 12",
-  "link fthrow lead": "legacy 2.5%/33°/bkb75/kbg85 / game_throwf 3%/361°/bkb55/kbg55",
-  "link bthrow first": "legacy 14 / game_throwb 12",
-  "link bthrow last": "legacy 14 / game_throwb 13",
-  "link bthrow lead": "legacy 2.5%/130°/bkb67/kbg110 / game_throwb 3%/361°/bkb55/kbg55",
-  "link uthrow first": "legacy 28 / game_throwhi 26",
-  "link uthrow last": "legacy 28 / game_throwhi 29",
-  "link uthrow lead": "legacy 2%/90°/bkb24/kbg230 / game_throwhi 5%/20°/bkb50/kbg100",
-  "link dthrow first": "legacy 24 / game_throwlw 22",
-  "link dthrow last": "legacy 24 / game_throwlw 23",
-  "link dthrow lead": "legacy 3%/83°/bkb60/kbg125 / game_throwlw 3%/361°/bkb60/kbg150",
   "samus fsmash lead": "legacy 14%/361°/bkb40/kbg100 / game_attacks4 12%/361°/bkb16/kbg112",
-  "samus pummel faf": "legacy 20 / game_catchattack 7",
-  "samus fthrow hitboxes": "legacy some / game_throwf none",
-  "samus bthrow hitboxes": "legacy some / game_throwb none",
-  "samus uthrow first": "legacy 16 / game_throwhi 15",
-  "samus uthrow last": "legacy 16 / game_throwhi 15",
-  "samus uthrow lead": "legacy 7%/90°/bkb80/kbg80 / game_throwhi 5%/80°/bkb10/kbg100",
-  "samus dthrow hitboxes": "legacy some / game_throwlw none",
   "kirby rapidJab first": "legacy 5 / game_attack100 1",
   "kirby rapidJab last": "legacy 36 / game_attack100 14",
   "kirby usmash faf": "legacy 46 / game_attackhi4 48",
   "kirby dsmash faf": "legacy 51 / game_attacklw4 54",
@@ -56,16 +25,9 @@
   "kirby sideB last": "legacy 27 / game_specials 12",
   "kirby sideB faf": "legacy 70 / game_specials 55",
   "kirby upB hitboxes": "legacy some / game_specialhi none",
   "kirby downB hitboxes": "legacy some / game_speciallw none",
-  "kirby pummel faf": "legacy 16 / game_catchattack 6",
-  "kirby fthrow hitboxes": "legacy some / game_throwf none",
-  "kirby bthrow hitboxes": "legacy some / game_throwb none",
-  "kirby uthrow first": "legacy 58 / game_throwhi 45",
-  "kirby uthrow last": "legacy 58 / game_throwhi 46",
-  "kirby uthrow lead": "legacy 10%/78°/bkb75/kbg74 / game_throwhi 7%/65°/bkb85/kbg95",
-  "kirby uthrow faf": "legacy 87 / game_throwhi 80",
-  "kirby dthrow last": "legacy 58 / game_throwlw 57",
+  "kirby uthrow hitboxes": "legacy none / game_throwhi some",
   "fox rapidJab first": "legacy 5 / game_attack100 1",
   "fox rapidJab last": "legacy 33 / game_attack100 8",
   "fox utilt lead": "legacy 8%/110°/bkb20/kbg110 / game_attackhi3 6%/110°/bkb20/kbg125",
   "fox fair lead": "legacy 1.8%/365°/fkb120/kbg100 / game_attackairf 1.8%/367°/fkb120/kbg100",
@@ -73,38 +35,17 @@
   "fox upB first": "legacy 20 / game_specialhi 1",
   "fox upB last": "legacy 72 / game_specialhi 300",
   "fox upB lead": "legacy 1.8%/105°/bkb20/kbg20 / game_specialhi 16%/60°/bkb70/kbg60",
   "fox downB last": "legacy 3 / game_speciallwstart 300",
-  "fox pummel faf": "legacy 16 / game_catchattack 6",
-  "fox fthrow first": "legacy 11 / game_throwf 10",
-  "fox fthrow last": "legacy 11 / game_throwf 10",
-  "fox fthrow lead": "legacy 3%/40°/bkb35/kbg130 / game_throwf 4%/48°/fkb140/kbg100",
-  "fox bthrow hitboxes": "legacy some / game_throwb none",
-  "fox uthrow hitboxes": "legacy some / game_throwhi none",
-  "fox dthrow hitboxes": "legacy some / game_throwlw none",
   "pikachu sideB first": "legacy 18 / game_specials 5",
   "pikachu sideB last": "legacy 52 / game_specials 300",
   "pikachu sideB lead": "legacy 6.2%/361°/bkb40/kbg78 / game_specials 1%/361°/bkb40/kbg78",
   "pikachu upB first": "legacy 15 / game_specialhi1 1",
   "pikachu upB last": "legacy 33 / game_specialhi1 300",
   "pikachu downB hitboxes": "legacy some / game_speciallw none",
-  "pikachu pummel faf": "legacy 17 / game_catchattack 6",
-  "pikachu fthrow first": "legacy 30 / game_throwf 11",
-  "pikachu fthrow last": "legacy 30 / game_throwf 26",
-  "pikachu fthrow lead": "legacy 2%/45°/bkb55/kbg110 / game_throwf 2%/361°/bkb0/kbg100",
-  "pikachu bthrow hitboxes": "legacy some / game_throwb none",
-  "pikachu uthrow first": "legacy 16 / game_throwhi 14",
-  "pikachu uthrow last": "legacy 16 / game_throwhi 15",
-  "pikachu uthrow lead": "legacy 5%/90°/bkb48/kbg129 / game_throwhi 3%/80°/bkb70/kbg60",
-  "pikachu dthrow hitboxes": "legacy some / game_throwlw none",
   "marth dashAttack lead": "legacy 13%/45°/bkb93/kbg58 / game_attackdash 10%/45°/bkb70/kbg55",
   "marth fsmash lead": "legacy 18%/361°/bkb80/kbg80 / game_attacks4 13%/361°/bkb48/kbg75",
   "marth usmash lead": "legacy 17%/89°/bkb40/kbg95 / game_attackhi4 3%/125°/fkb155/kbg100",
   "marth dsmash lead": "legacy 12%/361°/bkb57/kbg88 / game_attacklw4 8%/361°/bkb60/kbg88",
   "marth dsmash faf": "legacy 56 / game_attacklw4 55",
-  "marth bair lead": "legacy 12.5%/361°/bkb40/kbg94 / game_attackairb 9%/361°/bkb40/kbg85",
-  "marth pummel faf": "legacy 20 / game_catchattack 7",
-  "marth fthrow hitboxes": "legacy some / game_throwf none",
-  "marth bthrow hitboxes": "legacy some / game_throwb none",
-  "marth uthrow hitboxes": "legacy some / game_throwhi none",
-  "marth dthrow hitboxes": "legacy some / game_throwlw none"
+  "marth bair lead": "legacy 12.5%/361°/bkb40/kbg94 / game_attackairb 9%/361°/bkb40/kbg85"
 }
```

`src/fighters/acmd/reach.allow.json` — the expected change:

```diff
--- a/src/fighters/acmd/reach.allow.json
+++ b/src/fighters/acmd/reach.allow.json
@@ -1,6 +1,7 @@
 {
   "mario bair": "legacy -1.9 / baked 3.4",
+  "mario bthrow": "legacy 0.0 / baked 9.7",
   "mario fair": "legacy 9.8 / baked 5.2",
   "mario jab2": "legacy 7.4 / baked 10.8",
   "mario jab3": "legacy 8.9 / baked 17.3",
   "donkeyKong bair": "legacy -4.5 / baked 10.1",
@@ -8,10 +9,12 @@
   "donkeyKong jab1": "legacy 11.5 / baked 15.5",
   "donkeyKong jab2": "legacy 11.0 / baked 21.4",
   "donkeyKong nair": "legacy 11.0 / baked 25.6",
   "link bair": "legacy -4.0 / baked 5.6",
+  "link fthrow": "legacy 0.0 / baked 12.4",
   "link jab3": "legacy 11.3 / baked 19.5",
   "link nair": "legacy 9.5 / baked 13.7",
+  "link uthrow": "legacy 0.0 / baked 8.6",
   "samus dair": "legacy 5.5 / baked 10.8",
   "samus dtilt": "legacy 10.5 / baked 21.6",
   "samus fair": "legacy 10.5 / baked 18.1",
   "samus jab2": "legacy 10.5 / baked 13.8",
@@ -24,6 +27,7 @@
   "fox uair": "legacy 4.5 / baked 7.7",
   "pikachu bair": "legacy -0.8 / baked 5.5",
   "pikachu dair": "legacy 3.0 / baked 11.0",
   "pikachu dashAttack": "legacy 6.6 / baked 11.7",
+  "pikachu pummel": "legacy 3.0 / baked 15.0",
   "marth dtilt": "legacy 13.2 / baked 18.4"
 }
```

`src/fighters/bake/digest.ts` — the bake's new digest:

```diff
--- a/src/fighters/bake/digest.ts
+++ b/src/fighters/bake/digest.ts
@@ -1,5 +1,5 @@
 // GENERATED by src/render3d/bake/roster.test.ts (UPDATE_BAKE=1) — do not edit by hand.
 /** SHA-256 of the uncompressed public/bake/roster.bin.gz: the bake's fingerprint. */
-export const BAKE_DIGEST = "723702c7d49d3b22091b1fe8a4b258845bcfac8d7a7cbe4ea751e9eebc2d2164";
+export const BAKE_DIGEST = "696b019188eb79524cb51e199f49ce82e06e5975f80564802f91f2f208a87419";
 /** Its uncompressed length in bytes. */
-export const BAKE_BYTES = 5473965;
+export const BAKE_BYTES = 5454973;
```

**Golden trace — deliberate behaviour change.** kirby-marth-pokemonStadium2 diverges (Marth's and Kirby's throws now launch from their `ATTACK_ABS`). The other three traces must not change.

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0; golden trace regenerated as above.

- [ ] **Step 7: Commit**

```bash
git add super-smash/public/bake/roster.bin.gz super-smash/src/engine/acmd/hitboxes.ts super-smash/src/engine/acmd/interpreter.ts super-smash/src/engine/acmd/legacy.test.ts super-smash/src/engine/acmd/legacy.ts super-smash/src/engine/acmd/types.ts super-smash/src/engine/simulate.ts super-smash/src/fighters/acmd/active.test.ts super-smash/src/fighters/acmd/active.ts super-smash/src/fighters/acmd/lift.ts super-smash/src/fighters/acmd/limb.json super-smash/src/fighters/acmd/limb.test.ts super-smash/src/fighters/acmd/reach.allow.json super-smash/src/fighters/acmd/reconcile.allow.json super-smash/src/fighters/bake/digest.ts super-smash/src/fighters/throws.test.ts super-smash/src/game/__golden__/engine-trace.json
git commit -m "super-smash: throws read ATTACK_ABS, pummels are catch-only; 28 throws and pummels run their scripts" -m "The importer's unknown ATTACK_ABS / ATK_HIT_ABS / set_catch_only_all are lifted at activation (lift.ts), so the generated files are untouched. ACTIVE_SCRIPT_SLOTS +28; limb.json gains the limb-bone throws and pummels; reach.allow.json +4 (mario bthrow 9.7, link fthrow 12.4, link uthrow 8.6, pikachu pummel 15.0); reconcile -61 throw/pummel entries, +1 (kirby uthrow hitboxes). Bake regenerated. Golden trace regenerated: kirby-marth diverges because throws launch from their scripts." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Donkey Kong's Cargo Carry and cargo throws

SmashWiki (Donkey Kong (SSBU)/Forward throw): DK's forward throw lifts the opponent onto his shoulders (`cargoCarry`, walking at ×1.1 of his walk; "he can move and jump while holding the opponent", UNVERIFIED jump values) and throws in any of four directions (12/13/12/11%, the `game_throwf*` scripts). The victim rides in `cargoHeld`, pinned above him (`pinHeldFighters`), mashing out as from a grab. His back throw (11%, 40°) turns him at frame 15 (`turnAt`). A cargo throw begun in the air finishes when he lands (`onLanded` keeps a `throw`) — without that, a landing mid-throw left the victim held and stuck in `thrown` (UNVERIFIED that SSBU does not cut it short).

**Files:**
- Create: `super-smash/src/engine/held.ts`, `super-smash/src/engine/status/cargo.ts`, `super-smash/src/fighters/cargo.test.ts`
- Modify: `super-smash/src/engine/acmd/legacy.test.ts`, `super-smash/src/engine/acmd/legacy.ts`, `super-smash/src/engine/simulate.ts`, `super-smash/src/engine/states.ts`, `super-smash/src/engine/status/attack.ts`, `super-smash/src/engine/status/groups.test.ts`, `super-smash/src/engine/status/index.ts`, `super-smash/src/engine/status/kind.ts`, `super-smash/src/engine/status/status.test.ts`, `super-smash/src/engine/types.ts`, `super-smash/src/fighters/acmd/active.ts`, `super-smash/src/fighters/donkeyKong.ts`, `super-smash/src/render/poses/timing.ts`
- Regenerate: `super-smash/public/bake/roster.bin.gz`, `super-smash/src/fighters/bake/digest.ts`

**Interfaces:**
- Consumes: `resolveThrows`, `THROW_SLOTS` (Task 7), grab mash (Plan 3 Task 14), the status registry (Plan 2).
- Produces: statuses `STATUS_CARGO_CARRY`, `STATUS_CARGO_HELD`, `CARGO_STATUSES`, `CARGO_WALK`, `liftCargo`, `cargoThrowSlot` (`status/cargo.ts`); `src/engine/held.ts`: `isHeldAloft`, `pinHeldFighters`; `MoveSlot` + `cargoFthrow/Bthrow/Uthrow/Dthrow`; `MoveDef.cargo?`, `MoveDef.turnAt?`; actions `cargoCarry`, `cargoHeld`.

- [ ] **Step 1: Write the failing tests**

`src/engine/acmd/legacy.test.ts` — apply:

```diff
--- a/src/engine/acmd/legacy.test.ts
+++ b/src/engine/acmd/legacy.test.ts
@@ -7,11 +7,9 @@ import { projectilesDueOnFrame } from "../projectile";
 import type { Hitbox, MoveDef, MoveSlot } from "../types";
 import { LEGACY_BONE_TABLE } from "./bones";
 import { scriptHitboxes } from "./hitboxes";
 import { runScript } from "./interpreter";
-import { SLOT_MOTION, absFromHitbox, gameScriptFor, legacyGameScript } from "./legacy";
-
-const THROWS: ReadonlySet<MoveSlot> = new Set(["fthrow", "bthrow", "uthrow", "dthrow"]);
+import { SLOT_MOTION, THROW_SLOTS as THROWS, absFromHitbox, gameScriptFor, legacyGameScript } from "./legacy";
 
 /** The box a legacy throw launches with: the last to open. */
 function lastToOpen(move: MoveDef): Hitbox | null {
   let last: Hitbox | null = null;
@@ -82,9 +80,10 @@ describe("legacy moves compiled to game_ scripts", () => {
       expect(st.momentum, `momentum on frame ${g}`).toEqual(legacyMomentum(move, g));
     }
   });
 
-  it.each(MOVES.filter(([, slot]) => THROWS.has(slot)))("%s %s: lands its launch on the held fighter, on its frame (Plan 5)", (_id, _slot, move) => {
+  // Donkey Kong's forward throw only lifts (Plan 5, cargo): it has no launch.
+  it.each(MOVES.filter(([, slot, move]) => THROWS.has(slot) && move.hitboxes.length > 0))("%s %s: lands its launch on the held fighter, on its frame (Plan 5)", (_id, _slot, move) => {
     const script = legacyGameScript(move);
     const launch = lastToOpen(move)!;
     for (let g = 1; g <= move.totalFrames + 10; g++) {
       const st = runScript(script, g);
```

`src/engine/status/groups.test.ts` — apply:

```diff
--- a/src/engine/status/groups.test.ts
+++ b/src/engine/status/groups.test.ts
@@ -108,8 +108,11 @@ const LEGACY_KINETIC: Readonly<Record<ActionState, KineticType>> = {
   tech: "GROUND_STOP",
   techRoll: "MOTION",
   techWall: "GROUND_STOP",
   techCeiling: "GROUND_STOP",
+  // Plan 5, Task 8: Donkey Kong's carry, and the fighter carried.
+  cargoCarry: "WALK",
+  cargoHeld: "NONE",
 };
 
 /** Every action migrated so far; each status-group task extends this list first. */
 const MIGRATED = [
@@ -167,8 +170,11 @@ const MIGRATED = [
   "tech",
   "techRoll",
   "techWall",
   "techCeiling",
+  // Plan 5, Task 8
+  "cargoCarry",
+  "cargoHeld",
 ];
 
 describe("migrated statuses", () => {
   it("are exactly the groups migrated so far", () => {
```

`src/engine/status/status.test.ts` — apply:

```diff
--- a/src/engine/status/status.test.ts
+++ b/src/engine/status/status.test.ts
@@ -69,9 +69,10 @@ const CTX = { def: {} as FighterDef, stage: { platforms: [] }, frame: 1, fighter
 
 describe("the status alias table", () => {
   it("names an SSBU-style kind for every replica action, one-to-one", () => {
     const actions = Object.keys(STATUS_KIND_OF_ACTION) as ActionState[];
-    expect(actions).toHaveLength(47);
+    // 47 through Plan 3; Plan 5 adds Donkey Kong's carry and the carried.
+    expect(actions).toHaveLength(49);
     const kinds = new Set(actions.map((a) => STATUS_KIND_OF_ACTION[a]));
     expect(kinds.size).toBe(actions.length);
     for (const a of actions) expect(ACTION_OF_STATUS_KIND[STATUS_KIND_OF_ACTION[a]]).toBe(a);
   });
```

`src/fighters/cargo.test.ts` (new file):

```ts
/**
 * Donkey Kong's cargo, through the real `step()` (Plan 5, Task 8). SmashWiki
 * "Donkey Kong (SSBU)/Forward throw": he lifts, carries (walking ×1.1,
 * jumping), and throws from the carry; the carry lasts
 * `((90 + 1.7p) · 11/6) − g` frames unless the held fighter mashes out.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { fx, toFloat } from "@/engine/fixed";
import { createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { Btn } from "@/engine/types";
import type { GameState, InputFrame, MatchRules, StepEvents } from "@/engine/types";
import { STAGES } from "@/stages";
import { FIGHTERS } from "./index";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true };

beforeAll(() => {
  registerFighters(FIGHTERS);
  registerStages(STAGES);
});

/** Donkey Kong holding Mario, as a landed grab leaves them. */
function holding(percent = 0): GameState {
  const s = createInitialState("finalDestination", [{ defId: "donkeyKong" }, { defId: "mario" }], RULES, 5);
  const [dk, m] = s.fighters;
  Object.assign(dk, { action: "grabHold", grounded: true, platform: 0, x: fx(-5), y: 0, facing: 1, intangible: 0, grabbing: 1 });
  Object.assign(m, { action: "grabbed", grounded: true, platform: 0, x: fx(5), y: 0, facing: -1, intangible: 0, grabbedBy: 0, damage: fx(percent) });
  // Ninety frames of hold at 0% (`grabHoldFrames`), none spent yet.
  m.grabTimer = Math.floor((900 * 4096 + 17 * m.damage) / (10 * 4096));
  return s;
}

function run(s0: GameState, dk: readonly InputFrame[], mario: (i: number) => InputFrame = () => 0): { states: GameState[]; events: StepEvents[] } {
  let s = s0;
  let prev: [InputFrame, InputFrame] = [0, 0];
  const states: GameState[] = [];
  const events: StepEvents[] = [];
  dk.forEach((input, i) => {
    const now: [InputFrame, InputFrame] = [input, mario(i)];
    const out = step(s, now, { prevInputs: prev });
    s = out.state;
    prev = now;
    states.push(s);
    events.push(out.events);
  });
  return { states, events };
}

const idle = (n: number): InputFrame[] => Array<InputFrame>(n).fill(0);

describe("Donkey Kong's cargo", () => {
  it("lifts Mario onto his shoulders with a forward throw", () => {
    const { states } = run(holding(), [Btn.Right, ...idle(20)]);
    const end = states[states.length - 1];
    expect(end.fighters[0].action).toBe("cargoCarry");
    expect(end.fighters[1].action).toBe("cargoHeld");
    expect(end.fighters[1].y).toBeGreaterThan(end.fighters[0].y + fx(10));
    expect(end.fighters[1].x).toBe(end.fighters[0].x);
  });

  it("walks with him at 1.1× his walk, carrying him along", () => {
    const { states } = run(holding(), [Btn.Right, ...idle(16), ...Array<InputFrame>(40).fill(Btn.Right)]);
    const end = states[states.length - 1];
    expect(end.fighters[0].action).toBe("cargoCarry");
    expect(toFloat(end.fighters[0].vx)).toBeCloseTo(toFloat(FIGHTERS.find((f) => f.id === "donkeyKong")!.params!.walk_speed_max) * 1.1, 2);
    expect(end.fighters[1].x).toBe(end.fighters[0].x);
  });

  it("jumps with him, and lands still carrying", () => {
    const { states } = run(holding(), [Btn.Right, ...idle(16), Btn.Jump, ...idle(80)]);
    expect(Math.max(...states.map((s) => s.fighters[0].y))).toBeGreaterThan(fx(10));
    expect(states[states.length - 1].fighters[0].action).toBe("cargoCarry");
    expect(states[states.length - 1].fighters[0].grounded).toBe(true);
  });

  it("throws him forward from the carry: the cargo throw's 12% at angle 60", () => {
    const { events, states } = run(holding(), [Btn.Right, ...idle(16), Btn.Attack, ...idle(30)]);
    const hit = events.flatMap((e) => e.hits)[0];
    expect(toFloat(hit.damage)).toBeCloseTo(12 * 1.05 * 1.2, 2);
    expect(states[states.length - 1].fighters[1].vx).toBeGreaterThan(0);
  });

  it("turns round for the cargo back throw and sends him behind", () => {
    const { states } = run(holding(), [Btn.Right, ...idle(16), Btn.Left | Btn.Attack, ...idle(40)]);
    expect(states.some((s) => s.fighters[0].facing === -1)).toBe(true);
    expect(states[states.length - 1].fighters[1].vx).toBeLessThan(0);
  });

  it("throws from the air: the cargo throw launches him, and Donkey Kong lands free", () => {
    // Jump with him, throw at the top of the jump.
    const { states, events } = run(holding(), [Btn.Right, ...idle(16), Btn.Jump, ...idle(12), Btn.Attack, ...idle(80)]);
    const at = events.findIndex((e) => e.hits.length > 0);
    expect(at).toBeGreaterThan(0);
    expect(states[at].fighters[0].grounded).toBe(false);
    expect(toFloat(events[at].hits[0].damage)).toBeCloseTo(12 * 1.05 * 1.2, 2);
    const end = states[states.length - 1];
    expect(end.fighters[0].grabbing).toBe(-1);
    expect(end.fighters[1].grabbedBy).toBe(-1);
    expect(end.fighters[0].grounded).toBe(true);
    expect(["stand", "land", "landingLag"]).toContain(end.fighters[0].action);
  });

  it("lands in the middle of a cargo throw without dropping or freezing the thrown fighter", () => {
    // Throw a frame or two before the jump comes back down.
    const fall = run(holding(), [Btn.Right, ...idle(16), Btn.Jump, ...idle(120)]).states;
    const landsAt = fall.findIndex((st, i) => i > 20 && st.fighters[0].grounded);
    expect(landsAt).toBeGreaterThan(20);
    const { states, events } = run(holding(), [Btn.Right, ...idle(16), Btn.Jump, ...idle(landsAt - 19), Btn.Attack, ...idle(80)]);
    expect(events.some((e) => e.hits.length > 0)).toBe(true);
    const end = states[states.length - 1];
    expect(end.fighters[1].action).not.toBe("thrown");
    expect(end.fighters[1].action).not.toBe("cargoHeld");
    expect(end.fighters[0].grabbing).toBe(-1);
  });

  it("lets Mario struggle free, sooner the harder he mashes", () => {
    const freeAt = (mash: boolean) => {
      const { states } = run(holding(), [Btn.Right, ...idle(400)], (i) => (mash && i % 2 === 0 ? Btn.Attack : 0));
      return states.findIndex((s) => s.fighters[1].action !== "cargoHeld" && s.fighters[1].action !== "grabbed" && s.fighters[1].action !== "thrown");
    };
    const calm = freeAt(false);
    // 90 frames of grab at 0% become 165 of carry, less the frame already spent.
    expect(calm).toBeGreaterThan(150);
    expect(calm).toBeLessThan(190);
    expect(freeAt(true)).toBeLessThan(calm);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/engine/acmd/legacy.test.ts src/engine/status/groups.test.ts src/engine/status/status.test.ts src/fighters/cargo.test.ts`
Expected: FAIL — 8 failed | 19 passed — `expected 'throw' to be 'cargoCarry'` (no carry), the status tables (`expected [ 'stand', 'walk', 'dashStart', …(44) ] to have a length of 49 but got 47`, `groups.test.ts` one group short), and `legacy.test.ts` fails to load.

- [ ] **Step 3: Implement**

`src/engine/acmd/legacy.ts` — apply:

```diff
--- a/src/engine/acmd/legacy.ts
+++ b/src/engine/acmd/legacy.ts
@@ -49,8 +49,12 @@ export const SLOT_MOTION: Readonly<Record<MoveSlot, MotionKind>> = {
   ledgeAttack: "cliff_attack_quick",
   getUpAttack: "down_attack_u",
   finalSmash: "final",
   counterAttack: "special_lw_hit",
+  cargoFthrow: "throw_f_f",
+  cargoBthrow: "throw_f_b",
+  cargoUthrow: "throw_f_hi",
+  cargoDthrow: "throw_f_lw",
 };
 
 /** A legacy hitbox as `ATTACK` arguments on the root bone. */
 export function attackFromHitbox(hb: Hitbox): AttackParams {
@@ -151,8 +155,10 @@ export function legacyGameScript(move: MoveDef): AcmdScript {
   (move.momentum ?? []).forEach((m, order) => {
     at(m.frame).open.push({ op: "momentum", x: m.x, y: m.y, hold: m.hold ?? 0, order });
   });
   for (const p of move.projectiles ?? []) at(p.spawnFrame).open.push({ op: "spawnProjectile", id: p.id });
+  // A throw that turns round before it lands (Plan 5: `REVERSE_LR`).
+  if (move.turnAt !== undefined) at(move.turnAt).close.push({ op: "reverseLr" });
 
   const commands: AcmdCommand[] = [];
   for (const frame of [...beats.keys()].sort((a, b) => a - b)) {
     const b = beats.get(frame)!;
@@ -160,9 +166,19 @@ export function legacyGameScript(move: MoveDef): AcmdScript {
   }
   return { name: `game_${SLOT_MOTION[move.slot].replace(/_/g, "")}`, motion: SLOT_MOTION[move.slot], commands };
 }
 
-const THROW_SLOTS: ReadonlySet<MoveSlot> = new Set(["fthrow", "bthrow", "uthrow", "dthrow"]);
+/** Every slot that is a throw: its launch is an `ATTACK_ABS` (Plan 5). */
+export const THROW_SLOTS: ReadonlySet<MoveSlot> = new Set([
+  "fthrow",
+  "bthrow",
+  "uthrow",
+  "dthrow",
+  "cargoFthrow",
+  "cargoBthrow",
+  "cargoUthrow",
+  "cargoDthrow",
+]);
 
 function lastToOpen(hitboxes: readonly Hitbox[]): Hitbox | null {
   let last: Hitbox | null = null;
   for (const hb of hitboxes) if (!hb.grabbing && (last === null || hb.startFrame >= last.startFrame)) last = hb;
```

`src/engine/held.ts` (new file):

```ts
/**
 * Fighters carried by another (Plan 5): Donkey Kong's cargo. They do not move
 * on their own — no physics, no collision — and after everybody else has moved
 * they are put where their carrier holds them.
 */

import { kineticClear } from "./kinetic";
import type { FighterDef, FighterState, GameState } from "./types";

/** Riding on someone, not moving under their own power. */
export function isHeldAloft(f: Pick<FighterState, "action">): boolean {
  return f.action === "cargoHeld";
}

/**
 * Put every carried fighter where its carrier holds it: on top of Donkey Kong,
 * at his height (UNVERIFIED: SSBU's carry bone is unpublished; the replica
 * stands them on his head).
 */
export function pinHeldFighters(s: GameState, defs: readonly FighterDef[]): void {
  for (const f of s.fighters) {
    if (!isHeldAloft(f) || f.grabbedBy < 0) continue;
    const holder = s.fighters[f.grabbedBy];
    if (holder === undefined) continue;
    f.x = holder.x;
    f.y = holder.y + defs[holder.port].attributes.height;
    f.facing = holder.facing;
    f.grounded = false;
    f.platform = -1;
    kineticClear(f);
  }
}
```

`src/engine/simulate.ts` — apply:

```diff
--- a/src/engine/simulate.ts
+++ b/src/engine/simulate.ts
@@ -91,8 +91,9 @@ import {
 } from "./projectile";
 import { chargedHitbox } from "./specialCharge";
 import { reflectProjectiles } from "./reflect";
 import { activeCounter, triggerCounter } from "./counter";
+import { isHeldAloft, pinHeldFighters } from "./held";
 import {
   blastZoneKO,
   ecbOf,
   findLedgeGrab,
@@ -616,9 +617,9 @@ export function step(
 
   const preIntegrate = s.fighters.map((f) => ({ x: f.x, y: f.y }));
   for (let i = 0; i < s.fighters.length; i++) {
     const f = s.fighters[i];
-    if (frozen[i] || f.action === "dead") continue;
+    if (frozen[i] || f.action === "dead" || isHeldAloft(f)) continue;
     applyMovement(f, intents[i], stateCtx(i));
     preIntegrate[i] = { x: f.x, y: f.y };
     integrate(f);
   }
@@ -626,9 +627,9 @@ export function step(
   /* -- 5. platforms and ledges --------------------------------------------- */
 
   for (let i = 0; i < s.fighters.length; i++) {
     const f = s.fighters[i];
-    if (frozen[i] || f.action === "dead" || f.action === "respawnPlatform") continue;
+    if (frozen[i] || f.action === "dead" || f.action === "respawnPlatform" || isHeldAloft(f)) continue;
     if (f.ledge !== null) continue; // hanging: the ledge holds you, not the floor
 
     const before = launchBefore(f);
     // The ECB from this frame's bones (Plan 4), or Plan 2's box without a bake.
@@ -654,10 +655,11 @@ export function step(
     } else if (outcome.leftGround) {
       onLeftGround(f);
     }
 
-    // A trumped fighter cannot act, a ledge grab included, until its lag ends.
-    if (!f.grounded && f.action !== "ledgeTrumped") {
+    // A trumped fighter cannot act, a ledge grab included, until its lag ends;
+    // a carrier's hands are full (Plan 5).
+    if (!f.grounded && f.action !== "ledgeTrumped" && f.action !== "cargoCarry") {
       const grab = findLedgeGrab(f, stage, s.frame, ecb.half);
       if (grab !== null) {
         const pos = ledgePosition(stage, grab, s.frame);
         const frames =
@@ -675,8 +677,11 @@ export function step(
       }
     }
   }
 
+  // Carried fighters go where they are carried (Plan 5, `held.ts`).
+  pinHeldFighters(s, defs);
+
   /* -- 6. hitboxes: gather, clank, connect --------------------------------- */
 
   // Projectiles fly, then this frame's launches join them, then everything —
   // fists and arrows alike — goes through one clank pass and one hit pass.
```

`src/engine/states.ts` — apply:

```diff
--- a/src/engine/states.ts
+++ b/src/engine/states.ts
@@ -865,8 +865,12 @@ export function onLanded(f: FighterState, ctx: StateContext): void {
   f.airTime = 0;
   // The hop is over, so the next one decides its own height and its own damage.
   f.shortHop = false;
 
+  // Landing from a carry jump keeps carrying, and a cargo throw begun in the
+  // air finishes on the ground rather than leaving its victim held (Plan 5;
+  // UNVERIFIED that SSBU's aerial cargo throw is not cut short by a landing).
+  if (f.action === "cargoCarry" || f.action === "throw") return;
   if (f.action === "tumble") {
     f.hitstun = 0;
     kineticSetX(f, 0, "stop");
     startAction(f, "downed");
```

`src/engine/status/attack.ts` — apply:

```diff
--- a/src/engine/status/attack.ts
+++ b/src/engine/status/attack.ts
@@ -12,8 +12,9 @@ import { SMASH_CHARGE_MAX } from "../constants";
 import { clearHitRecord } from "../hitbox";
 import { mashFrames } from "../shield";
 import { specialChargeMain } from "../specialCharge";
 import { reflectorMain, specialStallExec } from "../reflect";
+import { liftCargo } from "./cargo";
 import {
   GRAB_MASH_BUTTON,
   GRAB_MASH_STICK,
   GRAB_MIN_FRAMES,
@@ -158,8 +159,13 @@ export const STATUS_THROW: FighterStatus = {
   pre: clearHitRecord,
   main(f, _intent, ctx) {
     const move = f.move !== null ? ctx.def.moves[f.move] : undefined;
     if (f.actionFrame >= (move?.totalFrames ?? THROW_FRAMES)) {
+      // A cargo throw ends with the fighter on his shoulders (Plan 5).
+      if (move?.cargo === true && f.grabbing >= 0) {
+        liftCargo(f, ctx.fighters);
+        return;
+      }
       // The animation finishing is the backstop: nobody is held once the
       // throw is over, even if its hitbox never connected.
       releaseGrab(f, ctx.fighters);
       startAction(f, f.grounded ? "stand" : "fall");
```

`src/engine/status/cargo.ts` (new file):

```ts
/**
 * Cargo (Plan 5, Task 8): Donkey Kong's forward throw lifts the held fighter
 * onto his shoulders, and he carries them — walking, turning and jumping — until
 * he throws them in any of four directions or they struggle free.
 *
 * SmashWiki "Donkey Kong (SSBU)/Forward throw": "while carrying an opponent or
 * heavy item, Donkey Kong's walk speed and acceleration are increased by
 * 1.1×"; "The carry's duration is equal to ((90 + 1.7p) * 11 / 6) - g" (g:
 * frames already spent in the grab); "button mashing reduces this amount by 8
 * frames per stick input, and 14.4 frames per button input". SmashWiki "Cargo
 * Throw": he can "move and jump while holding the opponent" (UNVERIFIED: the
 * jump is his own full hop; no carry jump values are published).
 *
 * SSBU's names: FIGHTER_DONKEY_STATUS_KIND_SHOULDER_WAIT (and _WALK, _JUMP —
 * one replica status) and FIGHTER_STATUS_KIND_SHOULDERED_DONKEY.
 */

import { approach, fx, mul } from "../fixed";
import { kineticGroundJump, kineticSum } from "../kinetic";
import { fighterParams } from "../params";
import { mashFrames } from "../shield";
import {
  GRAB_MASH_BUTTON,
  GRAB_MASH_STICK,
  GRAB_RELEASE_IMMUNITY,
  buttonPresses,
  grabHoldFrames,
  hasMove,
  releaseGrab,
  startAction,
  startMove,
} from "../states";
import type { FighterState, MoveSlot } from "../types";
import type { FighterStatus } from "./kind";

/** ×1.1 walk speed and acceleration while carrying (SmashWiki). */
export const CARGO_WALK = fx(1.1);

/** The cargo throw for a direction relative to the carrier's facing, else null. */
export function cargoThrowSlot(x: number, y: number, facing: number): MoveSlot | null {
  if (y > 0) return "cargoUthrow";
  if (y < 0) return "cargoDthrow";
  if (x === -facing) return "cargoBthrow";
  if (x === facing) return "cargoFthrow";
  return null;
}

/**
 * Lift the held fighter: the carrier starts carrying, the held fighter rides,
 * and their struggle timer becomes the carry's (`((90 + 1.7p) · 11/6) − g`).
 */
export function liftCargo(f: FighterState, fighters: readonly FighterState[]): void {
  const held = fighters[f.grabbing];
  if (held === undefined || held.grabbedBy !== f.port) {
    releaseGrab(f, fighters);
    startAction(f, f.grounded ? "stand" : "fall");
    return;
  }
  const whole = grabHoldFrames(held.damage);
  const spent = Math.max(0, whole - held.grabTimer);
  held.grabTimer = Math.floor((whole * 11) / 6) - spent;
  startAction(f, "cargoCarry");
  startAction(held, "cargoHeld");
}

export const STATUS_CARGO_CARRY: FighterStatus = {
  kind: "FIGHTER_DONKEY_STATUS_KIND_SHOULDER_WAIT",
  action: "cargoCarry",
  kineticType: "WALK",
  main(f, intent, ctx) {
    if (f.grabbing < 0) {
      startAction(f, f.grounded ? "stand" : "fall");
      return;
    }
    // A throw: attack or grab with a direction (none is forward), or a smash flick.
    const flick = intent.smash ? cargoThrowSlot(intent.smashX, intent.smashY, f.facing) : null;
    const pressed = intent.attackPressed || intent.grabPressed ? (cargoThrowSlot(intent.x, intent.y, f.facing) ?? "cargoFthrow") : null;
    const slot = flick ?? pressed;
    if (slot !== null && hasMove(ctx, slot)) {
      startMove(f, "throw", slot);
      const held = ctx.fighters[f.grabbing];
      if (held !== undefined && held.grabbedBy === f.port) startAction(held, "thrown");
      return;
    }
    if (intent.x !== 0) f.facing = intent.x;
    if (intent.jumpPressed && f.grounded) {
      kineticGroundJump(f, fighterParams(ctx.def), true);
      f.grounded = false;
      f.platform = -1;
    }
  },
  exec(f, intent, ctx) {
    // The WALK type has run; walk ×1.1 instead (speed and acceleration).
    const p = fighterParams(ctx.def);
    const accel = mul(p.walk_accel_add + p.walk_accel_mul, CARGO_WALK);
    f.kinetic.controlX = approach(f.kinetic.controlX, intent.x * mul(p.walk_speed_max, CARGO_WALK), accel);
    kineticSum(f);
  },
};

export const STATUS_CARGO_HELD: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_SHOULDERED_DONKEY",
  action: "cargoHeld",
  kineticType: "NONE",
  main(f, intent, ctx) {
    if (f.grabbedBy < 0) {
      startAction(f, "fall");
      return;
    }
    // The struggle: one frame, plus whatever mashing has earned (8 a stick
    // input, 14.4 a button press — the grab's own rates).
    const sticks = f.framesSinceDirPress === 0 ? 1 : 0;
    f.grabTimer -= 1 + mashFrames(f.combat, buttonPresses(intent), sticks, GRAB_MASH_BUTTON, GRAB_MASH_STICK);
    if (f.grabTimer > 0) return;
    const carrier = ctx.fighters[f.grabbedBy];
    releaseGrab(f, ctx.fighters);
    f.combat.mash = 0;
    f.combat.grabImmune = GRAB_RELEASE_IMMUNITY;
    startAction(f, "fall");
    if (carrier !== undefined && carrier.action === "cargoCarry") startAction(carrier, carrier.grounded ? "stand" : "fall");
  },
};

export const CARGO_STATUSES: readonly FighterStatus[] = [STATUS_CARGO_CARRY, STATUS_CARGO_HELD];
```

`src/engine/status/index.ts` — apply:

```diff
--- a/src/engine/status/index.ts
+++ b/src/engine/status/index.ts
@@ -6,8 +6,9 @@
  * out of the legacy switch in `states.ts`.
  */
 
 import { AIR_STATUSES } from "./air";
+import { CARGO_STATUSES } from "./cargo";
 import { ATTACK_STATUSES } from "./attack";
 import { CLIFF_STATUSES } from "./cliff";
 import { DAMAGE_STATUSES } from "./damage";
 import { GROUND_STATUSES } from "./ground";
@@ -25,7 +26,8 @@ export const ALL_STATUSES: readonly FighterStatus[] = [
   ...CLIFF_STATUSES,
   ...GROUND_STATUSES,
   ...AIR_STATUSES,
   ...PASSIVE_STATUSES,
+  ...CARGO_STATUSES,
 ];
 
 for (const s of ALL_STATUSES) registerStatus(s);
```

`src/engine/status/kind.ts` — apply:

```diff
--- a/src/engine/status/kind.ts
+++ b/src/engine/status/kind.ts
@@ -64,8 +64,11 @@ export type StatusKind =
   | "FIGHTER_STATUS_KIND_CLIFF_ATTACK"
   | "FIGHTER_STATUS_KIND_CLIFF_ESCAPE"
   | "FIGHTER_STATUS_KIND_CLIFF_JUMP1"
   | "FIGHTER_STATUS_KIND_CLIFF_ROBBED"
+  // Plan 5. SSBU's fighter-specific kind keeps its fighter in the name.
+  | "FIGHTER_DONKEY_STATUS_KIND_SHOULDER_WAIT"
+  | "FIGHTER_STATUS_KIND_SHOULDERED_DONKEY"
   | "FIGHTER_STATUS_KIND_REBIRTH"
   | "FIGHTER_STATUS_KIND_DEAD"
   | "FIGHTER_STATUS_KIND_ENTRY";
 
@@ -114,8 +117,10 @@ export const STATUS_KIND_OF_ACTION: Readonly<Record<ActionState, StatusKind>> =
   ledgeAttack: "FIGHTER_STATUS_KIND_CLIFF_ATTACK",
   ledgeRoll: "FIGHTER_STATUS_KIND_CLIFF_ESCAPE",
   ledgeJump: "FIGHTER_STATUS_KIND_CLIFF_JUMP1",
   ledgeTrumped: "FIGHTER_STATUS_KIND_CLIFF_ROBBED",
+  cargoCarry: "FIGHTER_DONKEY_STATUS_KIND_SHOULDER_WAIT",
+  cargoHeld: "FIGHTER_STATUS_KIND_SHOULDERED_DONKEY",
   respawnPlatform: "FIGHTER_STATUS_KIND_REBIRTH",
   dead: "FIGHTER_STATUS_KIND_DEAD",
   entering: "FIGHTER_STATUS_KIND_ENTRY",
 };
```

`src/engine/types.ts` — apply:

```diff
--- a/src/engine/types.ts
+++ b/src/engine/types.ts
@@ -127,8 +127,11 @@ export type ActionState =
   | "ledgeAttack"
   | "ledgeRoll"
   | "ledgeJump"
   | "ledgeTrumped"
+  // carried (Plan 5)
+  | "cargoCarry"
+  | "cargoHeld"
   // meta
   | "respawnPlatform"
   | "dead"
   | "entering";
@@ -165,9 +168,14 @@ export type MoveSlot =
   | "ledgeAttack"
   | "getUpAttack"
   | "finalSmash"
   // Plan 5: what a special turns into.
-  | "counterAttack";
+  | "counterAttack"
+  // Plan 5: Donkey Kong's cargo throws, from the carry.
+  | "cargoFthrow"
+  | "cargoBthrow"
+  | "cargoUthrow"
+  | "cargoDthrow";
 
 /** Non-damage properties a hit can carry. Drives VFX, hitlag and reactions. */
 export type HitEffect =
   | "normal"
@@ -416,8 +424,12 @@ export interface MoveDef {
   /** A counter this move holds out (Plan 5). */
   readonly counter?: CounterDef;
   /** Its hitboxes deal the damage the counter caught (Plan 5: the counterattack). */
   readonly counterDamage?: boolean;
+  /** A throw that ends by lifting the held fighter to carry (Plan 5: DK's forward throw). */
+  readonly cargo?: boolean;
+  /** The frame a throw turns the thrower round (`REVERSE_LR`, Plan 5). */
+  readonly turnAt?: number;
   /** First and last move frame the fighter is intangible (Plan 5: SmashWiki "Intangibility a-b"). */
   readonly intangible?: readonly [number, number];
   /** Frames the fighter may not be interrupted, for specials with armour. */
   readonly superArmourFrames?: readonly [number, number];
```

`src/fighters/acmd/active.ts` — apply:

```diff
--- a/src/fighters/acmd/active.ts
+++ b/src/fighters/acmd/active.ts
@@ -21,8 +21,9 @@
  * the list and `active.test.ts` proves it is exactly the rule's output.
  */
 
 import { runScript } from "@/engine/acmd/interpreter";
+import { THROW_SLOTS } from "@/engine/acmd/legacy";
 import type { AcmdCommand, AcmdScript } from "@/engine/acmd/types";
 import type { FighterDef, MoveDef, MoveSlot } from "@/engine/types";
 import { liftScript } from "./lift";
 import type { ReferenceFighter } from "./reference";
@@ -47,9 +48,8 @@ const RUN_OPS: ReadonlySet<AcmdCommand["op"]> = new Set([
   "catchOnly",
 ]);
 
 /** `REVERSE_LR()` runs only in a throw, whose status turns the thrower (Plan 5). */
-const THROW_SLOTS: ReadonlySet<MoveSlot> = new Set(["fthrow", "bthrow", "uthrow", "dthrow"]);
 
 /** Engine calls with no effect on the replica's sim: collision pushboxes, hit-height tags, VFX, grab-cut bookkeeping. */
 const COSMETIC_PREFIXES: readonly string[] = [
   "FighterAreaModuleImpl::enable_fix_jostle_area",
```

`src/fighters/donkeyKong.ts` — apply:

```diff
--- a/src/fighters/donkeyKong.ts
+++ b/src/fighters/donkeyKong.ts
@@ -662,106 +662,110 @@ const legacy: FighterDef = {
       ],
     },
 
     /**
-     * The four throws below are DK's **cargo** throws, and that deserves an
-     * explanation rather than a silent substitution.
-     *
      * DK's forward throw is not a throw. It is Kong Karry: he hoists the victim
-     * onto his shoulder and keeps them there — walking, running and jumping
-     * freely — until he picks one of four *cargo* throws, which is what gives
-     * him eight throws instead of four. Carry duration is
-     * `((90 + 1.7p) * 11/6) - g` frames in the victim's percent `p`.
+     * onto his shoulder and keeps them there — walking, turning and jumping —
+     * until he picks one of four *cargo* throws, which is what gives him eight
+     * throws instead of four. Carry duration is `((90 + 1.7p) * 11/6) - g`
+     * frames in the victim's percent `p`.
      *
-     * `MoveSlot` has one throw per direction and no carry state, so what is
-     * encoded here is the cargo set, because those are the throws that actually
-     * launch — the carry itself only drops for 4%. His non-cargo back/up/down
-     * throws exist too (11% / 9% / 7%) and are noted per move.
+     * Plan 5 models the carry (`engine/status/cargo.ts`): `fthrow` is the lift,
+     * `bthrow`/`uthrow`/`dthrow` are the ordinary throws, and `cargoFthrow` …
+     * `cargoDthrow` are thrown from the carry. Before Plan 5, with no carry
+     * state, the four slots held the cargo set.
      */
     fthrow: {
       slot: "fthrow",
+      name: "Cargo Throw (lift)",
+      // Plan 5: the forward throw lifts the held fighter onto his shoulders
+      // (`game_throwf`, rubendal Data Viewer 13.0.1: invincible, then
+      // FIGHTER_DONKEY_STATUS_SHOULDER_START_FLAG_SHOULDER_WAIT on frame 16;
+      // motion throw_f CancelFrame 16). The four cargo throws are thrown from
+      // the carry (`cargoFthrow` …). UNVERIFIED-simplified: the lift's
+      // invincibility (frames 1-15) is not modelled.
+      totalFrames: 15,
+      cargo: true,
+      hitboxes: [],
+    },
+
+    bthrow: {
+      slot: "bthrow",
+      name: "Back Throw",
+      // `game_throwb`: ATTACK_ABS 11%, angle 40, KBG 65, BKB 60; REVERSE_LR and
+      // ATK_HIT_ABS on frame 15; motion throw_b CancelFrame 40. Plan 5: this
+      // was the cargo back throw's numbers, which are `cargoBthrow`'s now.
+      totalFrames: 39,
+      turnAt: 15,
+      hitboxes: [
+        { id: 0, startFrame: 15, endFrame: 15, x: fx(0), y: fx(9.0), radius: fx(4.0), damage: fx(11.0), angle: fx(40), baseKnockback: fx(60), knockbackGrowth: fx(65), hitlagMultiplier: fx(0) },
+      ],
+    },
+
+    uthrow: {
+      slot: "uthrow",
+      name: "Up Throw",
+      // `game_throwhi`: ATTACK_ABS 9%, angle 90, KBG 50, BKB 70, ATK_HIT_ABS on
+      // frame 14; CancelFrame 44. (The running move is the imported script.)
+      totalFrames: 43,
+      hitboxes: [
+        { id: 0, startFrame: 14, endFrame: 14, x: fx(0), y: fx(12.0), radius: fx(4.0), damage: fx(9.0), angle: fx(90), baseKnockback: fx(70), knockbackGrowth: fx(50), hitlagMultiplier: fx(0) },
+      ],
+    },
+
+    dthrow: {
+      slot: "dthrow",
+      name: "Down Throw",
+      // `game_throwlw`: ATTACK_ABS 7%, angle 361, KBG 50, BKB 60, ATK_HIT_ABS on
+      // frame 19; CancelFrame 55. (The running move is the imported script.)
+      totalFrames: 54,
+      hitboxes: [
+        { id: 0, startFrame: 19, endFrame: 19, x: fx(4.0), y: fx(2.0), radius: fx(4.0), damage: fx(7.0), angle: fx(361), baseKnockback: fx(60), knockbackGrowth: fx(50), hitlagMultiplier: fx(0) },
+      ],
+    },
+
+    // Plan 5: the cargo throws, from the carry. SmashWiki "Donkey Kong
+    // (SSBU)/Forward throw" and `game_throwff`/`fb`/`fhi`/`flw` (rubendal Data
+    // Viewer 13.0.1) ATTACK_ABS + ATK_HIT_ABS; FAF from the motions'
+    // CancelFrame (46, 43, 30, 45).
+    cargoFthrow: {
+      slot: "cargoFthrow",
       name: "Cargo Forward Throw",
       totalFrames: 45,
       hitboxes: [
-        {
-          id: 0,
-          startFrame: 15,
-          endFrame: 15,
-          x: fx(6.0),
-          y: fx(9.0),
-          radius: fx(4.0),
-          damage: fx(12.0),
-          angle: fx(60),
-          baseKnockback: fx(90),
-          knockbackGrowth: fx(46),
-        },
+        { id: 0, startFrame: 15, endFrame: 15, x: fx(6.0), y: fx(9.0), radius: fx(4.0), damage: fx(12.0), angle: fx(60), baseKnockback: fx(90), knockbackGrowth: fx(46), hitlagMultiplier: fx(0) },
       ],
     },
 
-    bthrow: {
-      slot: "bthrow",
+    cargoBthrow: {
+      slot: "cargoBthrow",
       name: "Cargo Back Throw",
+      // "Donkey Kong changes direction on frame 16": REVERSE_LR, then the launch.
       totalFrames: 42,
+      turnAt: 16,
       hitboxes: [
-        {
-          // His hardest-hitting throw and his best kill throw. The non-cargo
-          // back throw is 11% at angle 40 (BKB 60, KBG 65).
-          id: 0,
-          startFrame: 16,
-          endFrame: 16,
-          x: fx(-6.0),
-          y: fx(9.0),
-          radius: fx(4.0),
-          damage: fx(13.0),
-          angle: fx(72),
-          baseKnockback: fx(85),
-          knockbackGrowth: fx(52),
-        },
+        { id: 0, startFrame: 16, endFrame: 16, x: fx(6.0), y: fx(9.0), radius: fx(4.0), damage: fx(13.0), angle: fx(72), baseKnockback: fx(85), knockbackGrowth: fx(52), hitlagMultiplier: fx(0) },
       ],
     },
 
-    uthrow: {
-      slot: "uthrow",
+    cargoUthrow: {
+      slot: "cargoUthrow",
       name: "Cargo Up Throw",
       totalFrames: 29,
       hitboxes: [
-        {
-          // The "Ding-Dong" throw of Smash 4, deliberately given more knockback
-          // in Ultimate so it stops being a guaranteed kill confirm. The
-          // non-cargo up throw is 9% at angle 90 (BKB 70, KBG 50).
-          id: 0,
-          startFrame: 15,
-          endFrame: 15,
-          x: fx(0),
-          y: fx(12.0),
-          radius: fx(4.0),
-          damage: fx(12.0),
-          angle: fx(92),
-          baseKnockback: fx(65),
-          knockbackGrowth: fx(53),
-        },
+        { id: 0, startFrame: 15, endFrame: 15, x: fx(0), y: fx(12.0), radius: fx(4.0), damage: fx(12.0), angle: fx(92), baseKnockback: fx(65), knockbackGrowth: fx(53), hitlagMultiplier: fx(0) },
       ],
     },
 
-    dthrow: {
-      slot: "dthrow",
+    cargoDthrow: {
+      slot: "cargoDthrow",
       name: "Cargo Down Throw",
+      // "On frame 17, the move stops Donkey Kong's horizontal momentum, and sets
+      // his vertical momentum to 1.5."
       totalFrames: 44,
+      momentum: [{ frame: 17, x: fx(0), y: fx(1.5) }],
       hitboxes: [
-        {
-          // A semi-spike at 46° — the stage-spike throw. The non-cargo down
-          // throw is 7% at the Sakurai angle (BKB 60, KBG 50).
-          id: 0,
-          startFrame: 17,
-          endFrame: 17,
-          x: fx(4.0),
-          y: fx(2.0),
-          radius: fx(4.0),
-          damage: fx(11.0),
-          angle: fx(46),
-          baseKnockback: fx(70),
-          knockbackGrowth: fx(45),
-        },
+        { id: 0, startFrame: 17, endFrame: 17, x: fx(4.0), y: fx(2.0), radius: fx(4.0), damage: fx(11.0), angle: fx(46), baseKnockback: fx(70), knockbackGrowth: fx(45), hitlagMultiplier: fx(0) },
       ],
     },
   },
 
```

`src/render/poses/timing.ts` — apply:

```diff
--- a/src/render/poses/timing.ts
+++ b/src/render/poses/timing.ts
@@ -139,8 +139,12 @@ export const SLOT_POSE: Record<MoveSlot, PoseName> = {
   ledgeAttack: "ftilt",
   getUpAttack: "dsmash",
   finalSmash: "neutralB",
   counterAttack: "downB",
+  cargoFthrow: "fthrow",
+  cargoBthrow: "bthrow",
+  cargoUthrow: "uthrow",
+  cargoDthrow: "dthrow",
 };
 
 /** A looping clip that names no period of its own runs at half a second. */
 const DEFAULT_PERIOD = 30;
@@ -245,9 +249,14 @@ export function poseNameFor(f: Pick<PosedFighter, "action" | "move" | "jumpsUsed
     case "techWall":
     case "techCeiling":
       return "tumble";
     case "grabbed":
+    // Plan 5: carried on the shoulders, still held.
+    case "cargoHeld":
       return "grabbed";
+    // Plan 5: walking with the cargo; the walk clip reads as the carry.
+    case "cargoCarry":
+      return "walk";
     case "thrown":
       return "thrown";
     case "downed":
       return "downed";
```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/engine/acmd/legacy.test.ts src/engine/status/groups.test.ts src/engine/status/status.test.ts src/fighters/cargo.test.ts`
Expected: PASS (`src/fighters/cargo.test.ts` 8 tests).

- [ ] **Step 5: Regenerate the generated files, in this order**

Each command rewrites one artefact from the code; the order matters (the limb list feeds the reconcile list and the bake, the bake feeds reach). Then review each diff against the scratch result below.

```bash
UPDATE_BAKE=1 pnpm vitest run src/render3d/bake/roster.test.ts
```

`src/fighters/bake/digest.ts` — the bake's new digest:

```diff
--- a/src/fighters/bake/digest.ts
+++ b/src/fighters/bake/digest.ts
@@ -1,5 +1,5 @@
 // GENERATED by src/render3d/bake/roster.test.ts (UPDATE_BAKE=1) — do not edit by hand.
 /** SHA-256 of the uncompressed public/bake/roster.bin.gz: the bake's fingerprint. */
-export const BAKE_DIGEST = "696b019188eb79524cb51e199f49ce82e06e5975f80564802f91f2f208a87419";
+export const BAKE_DIGEST = "97401c361aa4dd243d53878ae21eefab951103c297b0c67e2c40b6e7bbb27590";
 /** Its uncompressed length in bytes. */
-export const BAKE_BYTES = 5454973;
+export const BAKE_BYTES = 5576011;
```

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0; golden trace untouched.

- [ ] **Step 7: Commit**

```bash
git add super-smash/public/bake/roster.bin.gz super-smash/src/engine/acmd/legacy.test.ts super-smash/src/engine/acmd/legacy.ts super-smash/src/engine/held.ts super-smash/src/engine/simulate.ts super-smash/src/engine/states.ts super-smash/src/engine/status/attack.ts super-smash/src/engine/status/cargo.ts super-smash/src/engine/status/groups.test.ts super-smash/src/engine/status/index.ts super-smash/src/engine/status/kind.ts super-smash/src/engine/status/status.test.ts super-smash/src/engine/types.ts super-smash/src/fighters/acmd/active.ts super-smash/src/fighters/bake/digest.ts super-smash/src/fighters/cargo.test.ts super-smash/src/fighters/donkeyKong.ts super-smash/src/render/poses/timing.ts
git commit -m "super-smash: Donkey Kong's Cargo Carry and four cargo throws" -m "Forward throw lifts the victim onto his shoulders; he walks x1.1 and throws any way (SmashWiki, game_throwf* scripts), from the air too; the victim mashes out as from a grab; a throw finishes through a landing. Bake regenerated (two new statuses). Golden trace unchanged." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Kirby's Inhale: swallow, spit a star, Copy Ability

SmashWiki (Kirby (SSBU)/Neutral special): the inhaled fighter stays in his mouth `180 + 1.1t − k` frames (t their percent, k his), less 12 per stick input and 21.6 per button on the ground (16 and 28.8 in the air); he walks ×1.08 with a mouthful; B or down swallows (Copy Ability: the victim's neutral special at ×1.2 damage, lost on a KO or, after a 1,200-frame grace, to a hit with chance damage/70 drawn from the match's seeded RNG so both peers agree), A spits a star that flies `25 + 0.5t` frames (60 at most), its damage from the star table by weight. A mouthful cannot grab a ledge (else the swallowed fighter was stranded there); a fighter hanging from a ledge cannot be inhaled.

**Files:**
- Create: `super-smash/src/engine/inhale.test.ts`, `super-smash/src/engine/inhale.ts`, `super-smash/src/engine/status/inhale.ts`, `super-smash/src/fighters/inhale.test.ts`
- Modify: `super-smash/src/engine/acmd/legacy.ts`, `super-smash/src/engine/combat.ts`, `super-smash/src/engine/hash.ts`, `super-smash/src/engine/held.ts`, `super-smash/src/engine/projectile.ts`, `super-smash/src/engine/simulate.ts`, `super-smash/src/engine/states.ts`, `super-smash/src/engine/status/cargo.ts`, `super-smash/src/engine/status/groups.test.ts`, `super-smash/src/engine/status/index.ts`, `super-smash/src/engine/status/kind.ts`, `super-smash/src/engine/status/status.test.ts`, `super-smash/src/engine/types.ts`, `super-smash/src/fighters/kirby.ts`, `super-smash/src/fighters/schema.test.ts`, `super-smash/src/render/poses/timing.ts`
- Regenerate: `super-smash/public/bake/roster.bin.gz`, `super-smash/src/fighters/bake/digest.ts`

**Interfaces:**
- Consumes: grab statuses and mash (Plan 3 Task 14), `isHeldAloft`/`pinHeldFighters` (Task 8), `projectileDefOf` (Task 1).
- Produces: `src/engine/inhale.ts`: `COPY_GRACE_FRAMES = 1200`, `COPY_DAMAGE`, `starDamage`, `swallowVictim`, `withCopyAbility`, `resolveInhaleReleases`, `pinStarRiders`, `maybeLoseCopy`; `src/engine/status/inhale.ts`: `STATUS_INHALE_HOLD`, `STATUS_SWALLOWED`, `STATUS_SPAT_STAR`, `inhaleHoldFrames`, `starFrames`, mash constants; `InhaleDef`, `MoveDef.inhale?`, `.release?`, `.copyDamage?`; `ProjectileDef.drag?`; `CombatState.copy`, `.copyFrames`, `.ride`; `Candidate.damageMul`; slots `inhaleSwallow`, `inhaleSpit`.

- [ ] **Step 1: Write the failing tests**

`src/engine/inhale.test.ts` (new file):

```ts
import { describe, expect, it } from "vitest";

import { COPY_DAMAGE, withCopyAbility } from "./inhale";
import type { FighterDef, MoveDef } from "./types";

function def(id: string, damage: number): FighterDef {
  const neutralB = { slot: "neutralB", name: `${id} B`, totalFrames: 30, hitboxes: [{ id: 0, startFrame: 5, endFrame: 6, x: 0, y: 0, radius: 1, damage, angle: 0, baseKnockback: 0, knockbackGrowth: 0 }] } as MoveDef;
  return { id, moves: { neutralB } } as unknown as FighterDef;
}

describe("withCopyAbility (Plan 5)", () => {
  it("gives Kirby the copied neutral special at ×1.2", () => {
    const kirby = def("kirby", 1);
    const mario = def("mario", 5);
    const out = withCopyAbility(kirby, mario);
    expect(out.moves.neutralB?.name).toBe("mario B");
    expect(out.moves.neutralB?.copyDamage).toBe(COPY_DAMAGE);
    expect(withCopyAbility(kirby, mario)).toBe(out);
    expect(withCopyAbility(kirby, null)).toBe(kirby);
  });

  it("never hands one context's merged definition to another holding different definitions under the same ids", () => {
    const a = withCopyAbility(def("kirby", 1), def("mario", 5));
    const b = withCopyAbility(def("kirby", 1), def("mario", 9));
    expect(a).not.toBe(b);
    expect(a.moves.neutralB?.hitboxes[0].damage).toBe(5);
    expect(b.moves.neutralB?.hitboxes[0].damage).toBe(9);
  });
});
```

`src/engine/status/groups.test.ts` — apply:

```diff
--- a/src/engine/status/groups.test.ts
+++ b/src/engine/status/groups.test.ts
@@ -111,8 +111,12 @@ const LEGACY_KINETIC: Readonly<Record<ActionState, KineticType>> = {
   techCeiling: "GROUND_STOP",
   // Plan 5, Task 8: Donkey Kong's carry, and the fighter carried.
   cargoCarry: "WALK",
   cargoHeld: "NONE",
+  // Plan 5, Task 9: Kirby's mouthful, the swallowed and the spat.
+  inhaleHold: "WALK",
+  swallowed: "NONE",
+  spatStar: "NONE",
 };
 
 /** Every action migrated so far; each status-group task extends this list first. */
 const MIGRATED = [
@@ -173,8 +177,12 @@ const MIGRATED = [
   "techCeiling",
   // Plan 5, Task 8
   "cargoCarry",
   "cargoHeld",
+  // Plan 5, Task 9
+  "inhaleHold",
+  "swallowed",
+  "spatStar",
 ];
 
 describe("migrated statuses", () => {
   it("are exactly the groups migrated so far", () => {
```

`src/engine/status/status.test.ts` — apply:

```diff
--- a/src/engine/status/status.test.ts
+++ b/src/engine/status/status.test.ts
@@ -69,10 +69,11 @@ const CTX = { def: {} as FighterDef, stage: { platforms: [] }, frame: 1, fighter
 
 describe("the status alias table", () => {
   it("names an SSBU-style kind for every replica action, one-to-one", () => {
     const actions = Object.keys(STATUS_KIND_OF_ACTION) as ActionState[];
-    // 47 through Plan 3; Plan 5 adds Donkey Kong's carry and the carried.
-    expect(actions).toHaveLength(49);
+    // 47 through Plan 3; Plan 5 adds Donkey Kong's carry and the carried, and
+    // Kirby's mouthful, the swallowed and the spat.
+    expect(actions).toHaveLength(52);
     const kinds = new Set(actions.map((a) => STATUS_KIND_OF_ACTION[a]));
     expect(kinds.size).toBe(actions.length);
     for (const a of actions) expect(ACTION_OF_STATUS_KIND[STATUS_KIND_OF_ACTION[a]]).toBe(a);
   });
```

`src/fighters/inhale.test.ts` (new file):

```ts
/**
 * Kirby's Inhale, through the real `step()` (Plan 5, Task 9). SmashWiki "Kirby
 * (SSBU)/Neutral special": swallow 10% and copy; spit 6% and the victim flies
 * as a star whose damage follows their weight (Mario, 98: 15%); the mouthful
 * mashes free sooner; a Copy Ability hurts ×1.2.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { fx, toFloat } from "@/engine/fixed";
import { createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { Btn } from "@/engine/types";
import type { GameState, InputFrame, MatchRules, StepEvents } from "@/engine/types";
import { STAGES } from "@/stages";
import { FIGHTERS } from "./index";

const ONE_V_ONE: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true };

beforeAll(() => {
  registerFighters(FIGHTERS);
  registerStages(STAGES);
});

/** Kirby facing Mario (and anybody else, further right) on Final Destination. */
function lineUp(others: readonly string[], gap = 10, rules = ONE_V_ONE): GameState {
  const s = createInitialState("finalDestination", [{ defId: "kirby" }, ...others.map((defId) => ({ defId }))], rules, 9);
  s.fighters.forEach((f, i) =>
    Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(-20 + i * gap), y: 0, facing: i === 0 ? 1 : -1, intangible: 0 }),
  );
  return s;
}

function run(s0: GameState, frames: number, script: (i: number) => InputFrame[]): { states: GameState[]; events: StepEvents[] } {
  let s = s0;
  let prev: InputFrame[] = s0.fighters.map(() => 0);
  const states: GameState[] = [];
  const events: StepEvents[] = [];
  for (let i = 0; i < frames; i++) {
    const now = script(i);
    const out = step(s, now, { prevInputs: prev });
    s = out.state;
    prev = now;
    states.push(s);
    events.push(out.events);
  }
  return { states, events };
}

/** Kirby inhales on frame 0; `then(i)` is his input after the catch. */
function inhaled(others: readonly string[], then: (i: number) => InputFrame, frames = 80, mario: (i: number) => InputFrame = () => 0, rules = ONE_V_ONE) {
  return run(lineUp(others, 10, rules), frames, (i) => [i === 0 ? Btn.Special : then(i), mario(i), ...others.slice(1).map(() => 0)]);
}

describe("Kirby's Inhale", () => {
  it("swallows Mario whole: he is inside, intangible, and Kirby holds him", () => {
    const { states } = inhaled(["mario"], () => 0, 30);
    const end = states[states.length - 1];
    expect(end.fighters[0].action).toBe("inhaleHold");
    expect(end.fighters[1].action).toBe("swallowed");
    expect(end.fighters[1].x).toBe(end.fighters[0].x);
    expect(end.fighters[1].intangible).toBeGreaterThan(0);
  });

  it("copies Mario on a swallow: 10%, then Kirby throws fireballs that hurt ×1.2", () => {
    const { states } = inhaled(["mario"], (i) => (i === 30 ? Btn.Special : 0), 60);
    const end = states[states.length - 1];
    expect(toFloat(end.fighters[1].damage)).toBeCloseTo(10 * 1.2, 2);
    expect(end.fighters[0].combat.copy).toBe("mario");

    // Now Kirby's neutral special is Mario's Fireball, and it is Mario's projectile.
    const after = run(end, 40, (i) => [i === 0 ? Btn.Special : 0, 0]);
    const fired = after.states.find((s) => s.projectiles.length > 0)!;
    expect(fired.projectiles[0].defId).toBe("fireball");
    expect(fired.projectiles[0].source).toBe("mario");
  });

  it("spits Mario as a star that hits Fox for Mario's weight's 15%", () => {
    const rules: MatchRules = { ...ONE_V_ONE, oneOnOne: false };
    const { states, events } = inhaled(["mario", "fox"], (i) => (i === 30 ? Btn.Attack : 0), 90, () => 0, rules);
    expect(states.some((s) => s.fighters[1].action === "spatStar")).toBe(true);
    const onFox = events.flatMap((e) => e.hits).find((h) => h.victim === 2);
    expect(onFox).toBeDefined();
    expect(toFloat(onFox!.damage)).toBeCloseTo(15, 2);
    // Mario took the spit's 6%, and is himself again by the end.
    const end = states[states.length - 1];
    expect(toFloat(end.fighters[1].damage)).toBeCloseTo(6, 2);
    expect(end.fighters[1].action).not.toBe("spatStar");
  });

  it("finds its own star when another fighter's projectile spawns on the same frame", () => {
    const rules: MatchRules = { ...ONE_V_ONE, oneOnOne: false };
    const spit = (i: number) => (i === 30 ? Btn.Attack : 0);
    const alone = inhaled(["mario", "fox"], spit, 60, () => 0, rules).states;
    const starAt = alone.findIndex((s) => s.fighters[1].action === "spatStar");
    expect(starAt).toBeGreaterThan(30);
    // Fox fires his blaster at every moment that could put his laser out on the star's frame.
    let together = 0;
    for (let k = starAt - 25; k <= starAt; k++) {
      const s = lineUp(["mario", "fox"], 10, rules);
      // Fox shoots away from the others, so his laser only shares the frame.
      s.fighters[2].facing = 1;
      const { states } = run(s, 60, (i) => [i === 0 ? Btn.Special : spit(i), 0, i === k ? Btn.Special : 0]);
      const at = states[starAt];
      if (at.projectiles.filter((p) => p.age === 0).length === 2) together += 1;
      expect(at.fighters[1].action).toBe("spatStar");
      const star = at.projectiles.find((p) => p.instanceId === at.fighters[1].combat.ride);
      expect(star?.owner).toBe(0);
    }
    expect(together).toBeGreaterThan(0);
  });

  it("inhales a shielding fighter: its catch is a grabbox, and grabs beat shields", () => {
    const { states } = inhaled(["mario"], () => 0, 30, () => Btn.Shield);
    expect(states[states.length - 1].fighters[1].action).toBe("swallowed");
  });

  it("does not inhale an invincible fighter, as no grab takes one", () => {
    const s = lineUp(["mario"]);
    s.fighters[1].invincible = 120;
    const { states } = run(s, 30, (i) => [i === 0 ? Btn.Special : 0, 0]);
    expect(states.every((st) => st.fighters[1].action !== "swallowed")).toBe(true);
  });

  it("lets Mario mash his way out sooner", () => {
    const outAt = (mash: boolean) =>
      inhaled(["mario"], () => 0, 300, (i) => (mash && i % 2 === 0 ? Btn.Attack : 0)).states.findIndex(
        (s, i) => i > 15 && s.fighters[1].action !== "swallowed",
      );
    const calm = outAt(false);
    expect(calm).toBeGreaterThan(150); // 180 + 1.1 × 0 − 0 frames, from the catch
    expect(outAt(true)).toBeLessThan(calm);
  });

  it("loses the Copy Ability with a stock", () => {
    const { states } = inhaled(["mario"], (i) => (i === 30 ? Btn.Special : 0), 60);
    const s = states[states.length - 1];
    s.fighters[0].x = fx(400); // past the blast zone
    s.fighters[0].grounded = false;
    s.fighters[0].platform = -1;
    s.fighters[0].action = "fall";
    const after = run(s, 3, () => [0, 0]).states;
    expect(after[after.length - 1].fighters[0].combat.copy).toBe("");
  });
});

describe("Review Focus: Inhale at the ledge", () => {
  it("does not take a fighter hanging from the ledge, and leaves them hanging", () => {
    const s = lineUp(["mario"]);
    const fd = s.fighters;
    // Mario hangs from Final Destination's right ledge; Kirby stands at it.
    const ledgeX = fx(80);
    Object.assign(fd[1], { action: "ledgeHang", actionFrame: 30, grounded: false, platform: -1, x: ledgeX, y: 0, ledge: { platform: 0, side: 1 }, facing: -1, intangible: 0 });
    Object.assign(fd[0], { x: ledgeX - fx(6), facing: 1 });
    const { states } = run(s, 50, (i) => [i === 0 ? Btn.Special : 0, 0]);
    expect(states.every((st) => st.fighters[1].action !== "swallowed")).toBe(true);
    expect(states[20].fighters[1].action).toBe("ledgeHang");
  });

  it("carries a mouthful off the stage and spits it there without stranding anybody", () => {
    const s = lineUp(["mario"]);
    Object.assign(s.fighters[0], { x: fx(70) });
    Object.assign(s.fighters[1], { x: fx(78) });
    // Inhale, walk off the right edge, spit in the air, then let go of everything.
    const { states } = run(s, 260, (i) => [i === 0 ? Btn.Special : i >= 20 && i < 40 ? Btn.Right : i === 45 ? Btn.Attack : 0, 0]);
    expect(states.some((st) => st.fighters[0].action === "inhaleHold" && !st.fighters[0].grounded)).toBe(true);
    const end = states[states.length - 1];
    for (const f of end.fighters) {
      expect(["swallowed", "spatStar", "inhaleHold"]).not.toContain(f.action);
      expect(f.grabbing).toBe(-1);
      expect(f.grabbedBy).toBe(-1);
    }
  });
});
```

`src/fighters/schema.test.ts` — apply:

```diff
--- a/src/fighters/schema.test.ts
+++ b/src/fighters/schema.test.ts
@@ -260,9 +260,10 @@ describe("projectiles", () => {
 
   it("puts a projectile on exactly the specials the spec says have one", () => {
     // SPEC section 7: Link has three at once, Samus charges one.
     const owners = FIGHTERS.filter((f) => everyProjectile(f).length > 0).map((f) => f.id);
-    expect(new Set(owners)).toEqual(new Set(["mario", "link", "samus", "fox", "pikachu"]));
+    // Plan 5: Kirby's spit fires the spat fighter as a star.
+    expect(new Set(owners)).toEqual(new Set(["mario", "link", "samus", "kirby", "fox", "pikachu"]));
 
     const linkProjectiles = everyProjectile(getFighterOrThrow("link"));
     expect(linkProjectiles).toHaveLength(3);
     expect(new Set(linkProjectiles.map((p) => p.slot))).toEqual(
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/engine/inhale.test.ts src/engine/status/groups.test.ts src/engine/status/status.test.ts src/fighters/inhale.test.ts src/fighters/schema.test.ts`
Expected: FAIL — 12 failed | 334 passed; `src/engine/inhale.test.ts` cannot load (`Failed to resolve import "./inhale"`). The rest: `expected false to be true`, `expected undefined to be ''` (no Copy Ability field), `expected +0 to be close to 12` (no star damage), `expected 16 to be greater than 150` (no hold), the status tables (`to have a length of 52 but got 49`), and the projectile list (`Set{…(2)}` vs `Set{…(3)}`).

- [ ] **Step 3: Implement**

`src/engine/acmd/legacy.ts` — apply:

```diff
--- a/src/engine/acmd/legacy.ts
+++ b/src/engine/acmd/legacy.ts
@@ -53,8 +53,10 @@ export const SLOT_MOTION: Readonly<Record<MoveSlot, MotionKind>> = {
   cargoFthrow: "throw_f_f",
   cargoBthrow: "throw_f_b",
   cargoUthrow: "throw_f_hi",
   cargoDthrow: "throw_f_lw",
+  inhaleSwallow: "special_n_swallow",
+  inhaleSpit: "special_n_spit",
 };
 
 /** A legacy hitbox as `ATTACK` arguments on the root bone. */
 export function attackFromHitbox(hb: Hitbox): AttackParams {
```

`src/engine/combat.ts` — apply:

```diff
--- a/src/engine/combat.ts
+++ b/src/engine/combat.ts
@@ -58,8 +58,14 @@ export interface CombatState {
   /** Plan 5: the current move is the one stalling (it took the airtime's stall). */
   stalling: boolean;
   /** Plan 5: the damage a counter caught, × its multiplier, for the counterattack (Q12). */
   counterDamage: number;
+  /** Plan 5: Kirby's Copy Ability — the fighter id whose neutral special he has, or "". */
+  copy: string;
+  /** Plan 5: frames the Copy Ability has been held (it cannot be knocked off for 1200). */
+  copyFrames: number;
+  /** Plan 5: the projectile a spat fighter rides as a star, by instance id; 0 for none. */
+  ride: number;
 }
 
 export function emptyCombat(): CombatState {
   return {
@@ -80,8 +86,11 @@ export function emptyCombat(): CombatState {
     reflectHold: 0,
     specialStall: false,
     stalling: false,
     counterDamage: 0,
+    copy: "",
+    copyFrames: 0,
+    ride: 0,
   };
 }
 
 export function cloneCombat(c: CombatState): CombatState {
@@ -103,6 +112,9 @@ export function cloneCombat(c: CombatState): CombatState {
     reflectHold: c.reflectHold,
     specialStall: c.specialStall,
     stalling: c.stalling,
     counterDamage: c.counterDamage,
+    copy: c.copy,
+    copyFrames: c.copyFrames,
+    ride: c.ride,
   };
 }
```

`src/engine/hash.ts` — apply:

```diff
--- a/src/engine/hash.ts
+++ b/src/engine/hash.ts
@@ -180,8 +180,11 @@ export function mixCombat(h: number, c: CombatState): number {
   x = mixInt(x, c.reflectHold);
   x = mixBool(x, c.specialStall);
   x = mixBool(x, c.stalling);
   x = mixInt(x, c.counterDamage);
+  x = mixString(x, c.copy);
+  x = mixInt(x, c.copyFrames);
+  x = mixInt(x, c.ride);
   return x;
 }
 
 /** The KineticModule energies, in declaration order. */
```

`src/engine/held.ts` — apply:

```diff
--- a/src/engine/held.ts
+++ b/src/engine/held.ts
@@ -8,9 +8,9 @@ import { kineticClear } from "./kinetic";
 import type { FighterDef, FighterState, GameState } from "./types";
 
 /** Riding on someone, not moving under their own power. */
 export function isHeldAloft(f: Pick<FighterState, "action">): boolean {
-  return f.action === "cargoHeld";
+  return f.action === "cargoHeld" || f.action === "swallowed" || f.action === "spatStar";
 }
 
 /**
  * Put every carried fighter where its carrier holds it: on top of Donkey Kong,
@@ -18,13 +18,14 @@ export function isHeldAloft(f: Pick<FighterState, "action">): boolean {
  * stands them on his head).
  */
 export function pinHeldFighters(s: GameState, defs: readonly FighterDef[]): void {
   for (const f of s.fighters) {
-    if (!isHeldAloft(f) || f.grabbedBy < 0) continue;
+    if ((f.action !== "cargoHeld" && f.action !== "swallowed") || f.grabbedBy < 0) continue;
     const holder = s.fighters[f.grabbedBy];
     if (holder === undefined) continue;
     f.x = holder.x;
-    f.y = holder.y + defs[holder.port].attributes.height;
+    // On Donkey Kong's head, or inside Kirby.
+    f.y = f.action === "cargoHeld" ? holder.y + defs[holder.port].attributes.height : holder.y;
     f.facing = holder.facing;
     f.grounded = false;
     f.platform = -1;
     kineticClear(f);
```

`src/engine/inhale.ts` (new file):

```ts
/**
 * Kirby's Inhale (Plan 5, Task 9): the catch, the swallow, the spit, and the
 * Copy Ability. The statuses are in `status/inhale.ts`.
 *
 * SmashWiki "Kirby (SSBU)/Neutral special" and "Copy ability":
 * - swallowing deals 10% and gives Kirby the victim's neutral special, which
 *   he uses at "Copy Ability damage multiplier 1.2" (knockback unaffected);
 * - spitting deals 6% and fires the victim as a star (angle 45, BK 70, KS 78,
 *   radius 2.5) whose damage depends on the victim's weight (10% at 62–68 …
 *   21% at 135); the star slows by 0.05 a frame and lets go below 0.4;
 * - the ability is lost on a KO, or, after "1200 frames", to a hit with
 *   chance "Damage Received/70" (the page's update history; its parameter
 *   table reads "(this * damage / 0.7)" with this = 0.7 — UNVERIFIED which).
 */

import { ONE_ON_ONE_MULTIPLIER } from "./constants";
import { fx, mul, nextRandom } from "./fixed";
import { STAR_MAX_FRAMES, inhaleHoldFrames, starFrames } from "./status/inhale";
import { startAction } from "./states";
import type { FighterDef, FighterState, GameState, MoveDef } from "./types";

/** The Copy Ability's grace: no hit knocks it off for this long (SmashWiki, 6.0.0 onward). */
export const COPY_GRACE_FRAMES = 1200;
/** SmashWiki: "Copy Ability damage multiplier 1.2". */
export const COPY_DAMAGE = fx(1.2);

/**
 * The spit star's damage by the spat fighter's weight (SmashWiki's table).
 * Weights between the published rows take the row below (UNVERIFIED: the
 * table skips 69–74, 114–115 and 119–126).
 */
export function starDamage(weight: number): number {
  const rows: readonly (readonly [number, number])[] = [
    [135, 21],
    [127, 20],
    [116, 18],
    [108, 17],
    [101, 16],
    [95, 15],
    [88, 14],
    [82, 13],
    [75, 12],
    [62, 10],
  ];
  for (const [min, damage] of rows) if (weight >= min) return damage;
  return 10;
}

/** The catch landed: the victim goes into Kirby's mouth. */
export function swallowVictim(kirby: FighterState, victim: FighterState): void {
  victim.grabTimer = inhaleHoldFrames(victim.damage, kirby.damage);
  victim.combat.mash = 0;
  startAction(victim, "swallowed");
  startAction(kirby, "inhaleHold");
}

/**
 * `def` with Kirby's neutral special replaced by the copied fighter's. Cached
 * per pair of definition objects, as `withLimbScripts` caches per definition:
 * two contexts that hold different definitions under the same ids (a test's,
 * the game's with its limb scripts) never share a merged one.
 */
const copied = new WeakMap<FighterDef, WeakMap<FighterDef, FighterDef>>();
export function withCopyAbility(def: FighterDef, copy: FighterDef | null): FighterDef {
  if (copy === null) return def;
  let byCopy = copied.get(def);
  if (byCopy === undefined) {
    byCopy = new WeakMap();
    copied.set(def, byCopy);
  }
  let out = byCopy.get(copy);
  if (out === undefined) {
    const move = copy.moves.neutralB;
    const script = copy.scripts?.neutralB;
    out = {
      ...def,
      moves: { ...def.moves, neutralB: move === undefined ? undefined : ({ ...move, copyDamage: COPY_DAMAGE } as MoveDef) },
      scripts: { ...def.scripts, ...(script !== undefined ? { neutralB: script } : { neutralB: undefined }) },
    };
    byCopy.set(copy, out);
  }
  return out;
}

/**
 * Inhale releases (phase 6, after projectiles spawn): on a swallow's or a
 * spit's release frame the fighter in Kirby's mouth comes out.
 */
export function resolveInhaleReleases(s: GameState, defs: readonly FighterDef[]): void {
  for (let i = 0; i < s.fighters.length; i++) {
    const kirby = s.fighters[i];
    if (kirby.action !== "special" || kirby.move === null || kirby.grabbing < 0) continue;
    const release = defs[i].moves[kirby.move]?.release;
    if (release === undefined || kirby.actionFrame + 1 !== release.frame) continue;
    const victim = s.fighters[kirby.grabbing];
    if (victim === undefined || victim.grabbedBy !== kirby.port) continue;
    victim.damage += s.rules.oneOnOne ? mul(release.damage, ONE_ON_ONE_MULTIPLIER) : release.damage;
    kirby.grabbing = -1;
    victim.grabbedBy = -1;
    victim.grabTimer = 0;
    if (release.kind === "swallow") {
      kirby.combat.copy = victim.defId;
      kirby.combat.copyFrames = 0;
      startAction(victim, "fall");
      continue;
    }
    // The spit: the star this move spawned this very frame carries them —
    // found by its definition and age, never by its place in the list.
    const starId = defs[i].moves[kirby.move]?.projectiles?.[0]?.id;
    const star = s.projectiles.find((p) => p.owner === kirby.port && p.source === kirby.defId && p.defId === starId && p.age === 0);
    if (star === undefined) {
      startAction(victim, "fall");
      continue;
    }
    // The star's box is authored at 10%; its rider's weight scales it.
    star.chargeScale = Math.trunc((fx(starDamage(defs[victim.port].attributes.weight)) * 4096) / fx(10));
    startAction(victim, "spatStar");
    victim.combat.ride = star.instanceId;
    victim.grabTimer = Math.min(STAR_MAX_FRAMES, starFrames(victim.damage));
  }
}

/** Riders go where their star is; a rider whose star is gone lets go. */
export function pinStarRiders(s: GameState): void {
  for (const f of s.fighters) {
    if (f.action !== "spatStar") continue;
    const star = s.projectiles.find((p) => p.instanceId === f.combat.ride);
    if (star === undefined) {
      f.combat.ride = 0;
      continue;
    }
    f.x = star.x;
    f.y = star.y;
    f.grounded = false;
    f.platform = -1;
  }
}

/**
 * A hit may knock the Copy Ability off once its grace is over: chance
 * damage / 70, from the match's seeded RNG so both peers agree.
 */
export function maybeLoseCopy(s: GameState, f: FighterState, damage: number): void {
  if (f.combat.copy === "" || f.combat.copyFrames < COPY_GRACE_FRAMES) return;
  const r = nextRandom(s.rngSeed);
  s.rngSeed = r.seed;
  if (r.value * fx(70) < damage) f.combat.copy = "";
}
```

`src/engine/projectile.ts` — apply:

```diff
--- a/src/engine/projectile.ts
+++ b/src/engine/projectile.ts
@@ -172,8 +172,14 @@ export function advanceProjectile(
     p.vx = -p.vx;
     p.returning = true;
   }
 
+  // A star slows and lets go below its least speed (Plan 5).
+  if (def.drag !== undefined) {
+    const speed = abs(p.vx) - def.drag.perFrame;
+    if (speed < def.drag.minSpeed) return { alive: false, prevX, prevY };
+    p.vx = p.vx >= 0 ? speed : -speed;
+  }
   p.vy -= def.gravity;
   p.x += p.vx;
   p.y += p.vy;
 
```

`src/engine/simulate.ts` — apply:

```diff
--- a/src/engine/simulate.ts
+++ b/src/engine/simulate.ts
@@ -92,8 +92,9 @@ import {
 import { chargedHitbox } from "./specialCharge";
 import { reflectProjectiles } from "./reflect";
 import { activeCounter, triggerCounter } from "./counter";
 import { isHeldAloft, pinHeldFighters } from "./held";
+import { COPY_GRACE_FRAMES, maybeLoseCopy, pinStarRiders, resolveInhaleReleases, swallowVictim, withCopyAbility } from "./inhale";
 import {
   blastZoneKO,
   ecbOf,
   findLedgeGrab,
@@ -491,8 +492,10 @@ interface Candidate {
    * `set_catch_only_all` (Plan 5): the one port this box may hit — the held
    * fighter — and then only for damage; null when it may hit anybody.
    */
   readonly onlyPort: number | null;
+  /** Kirby's Copy Ability, ×1.2 on damage and not on knockback (Plan 5); `ONE` otherwise. */
+  readonly damageMul: number;
   suppressed: boolean;
 }
 
 /** Where a candidate's box is this frame: a capsule, or a circle when it has no length. */
@@ -521,9 +524,13 @@ export function step(
   const ctx = opts.ctx ?? registryContext;
   const s = cloneState(state);
   const events = emptyEvents();
   const stage = ctx.stage(s.stageId);
-  const defs = s.fighters.map((f) => ctx.fighter(f.defId));
+  // Kirby with a Copy Ability runs the copied neutral special (Plan 5).
+  const defs = s.fighters.map((f) => {
+    const def = ctx.fighter(f.defId);
+    return f.combat.copy === "" ? def : withCopyAbility(def, ctx.fighter(f.combat.copy));
+  });
   const bones = ctx.bones ?? LEGACY_BONE_TABLE;
   const bake = ctx.bake ?? LEGACY_BAKE;
   const prevInputs = opts.prevInputs ?? inputs;
 
@@ -573,8 +580,9 @@ export function step(
     const intent = intents[i];
 
     // Tech input counts on every frame, frozen or not (Plan 3, Task 12).
     updateTechInput(f, intent);
+    if (f.combat.copy !== "" && f.combat.copyFrames < COPY_GRACE_FRAMES) f.combat.copyFrames += 1;
     if (f.intangible > 0) f.intangible -= 1;
     if (f.combat.grabImmune > 0) f.combat.grabImmune -= 1;
     if (f.invincible > 0) f.invincible -= 1;
 
@@ -656,10 +664,10 @@ export function step(
       onLeftGround(f);
     }
 
     // A trumped fighter cannot act, a ledge grab included, until its lag ends;
-    // a carrier's hands are full (Plan 5).
-    if (!f.grounded && f.action !== "ledgeTrumped" && f.action !== "cargoCarry") {
+    // a carrier's hands, and a full mouth, are full (Plan 5).
+    if (!f.grounded && f.action !== "ledgeTrumped" && f.action !== "cargoCarry" && f.action !== "inhaleHold") {
       const grab = findLedgeGrab(f, stage, s.frame, ecb.half);
       if (grab !== null) {
         const pos = ledgePosition(stage, grab, s.frame);
         const frames =
@@ -686,8 +694,11 @@ export function step(
   // Projectiles fly, then this frame's launches join them, then everything —
   // fists and arrows alike — goes through one clank pass and one hit pass.
   const projectilePrev = advanceProjectiles(s, ctx, stage);
   spawnDueProjectiles(s, defs, beforeActionFrame, projectilePrev);
+  // A swallow or a spit lets its mouthful out; spat stars carry their riders (Plan 5).
+  resolveInhaleReleases(s, defs);
+  pinStarRiders(s);
 
   const destroyed = new Set<number>();
   const candidates = gatherHitboxes(s, defs, prevPos, frozen, bones);
   appendProjectileCandidates(s, ctx, candidates, projectilePrev);
@@ -748,8 +759,11 @@ export function step(
     releaseGrab(f, s.fighters);
     f.shieldHealth = SHIELD_MAX_HEALTH;
     f.staleQueue.length = 0;
     f.combat.staleShield.length = 0;
+    // A KO costs Kirby his Copy Ability (SmashWiki "Copy ability"; Plan 5).
+    f.combat.copy = "";
+    f.combat.copyFrames = 0;
     clearHitRecord(f);
     startAction(f, "dead");
     s.freezeFrames = KO_FREEZE_FRAMES;
   }
@@ -813,8 +827,9 @@ function gatherHitboxes(
         projectile: null,
         chargeScale: f.action === "attack" ? chargeMultiplier(f.charge) : ONE,
         destroyOnHit: false,
         onlyPort: run.state.catchOnly ? f.grabbing : null,
+        damageMul: defs[i].moves[f.move]?.copyDamage ?? ONE,
         suppressed: false,
       });
     }
   }
@@ -873,9 +888,11 @@ function spawnDueProjectiles(
       if (cmd.op !== "spawnProjectile") continue;
       const def = findProjectileDef(defs[i], cmd.id);
       if (def === undefined) continue;
       const sc = defs[i].moves[f.move]?.specialCharge;
-      const p = spawnProjectile(def, f, s.nextProjectileId, defs[i].id, sc?.frames);
+      // A copied neutral special fires the copied fighter's projectile (Plan 5).
+      const source = f.combat.copy !== "" && f.move === "neutralB" ? f.combat.copy : defs[i].id;
+      const p = spawnProjectile(def, f, s.nextProjectileId, source, sc?.frames);
       s.nextProjectileId += 1;
       s.projectiles.push(p);
       prev.set(p.instanceId, { x: p.x, y: p.y });
     }
@@ -908,8 +925,9 @@ function appendProjectileCandidates(
       projectile: p,
       chargeScale: p.chargeScale,
       destroyOnHit: def.destroyOnHit === true,
       onlyPort: null,
+      damageMul: ONE,
       suppressed: false,
     });
   }
 }
@@ -1007,8 +1025,11 @@ function resolveHits(
     const perSource = new Map<number, Candidate>();
     for (const c of candidates) {
       if (c.suppressed || c.attacker === v) continue;
       if (c.onlyPort !== null && c.onlyPort !== v) continue;
+      // Nobody grabs, or inhales, a fighter hanging from a ledge (Plan 5;
+      // UNVERIFIED: SSBU's grab boxes ignore CLIFF statuses, unpublished).
+      if (c.hitbox.grabbing === true && victim.ledge !== null) continue;
       if (c.hitbox.situation === "ground" && !victim.grounded) continue;
       if (c.hitbox.situation === "air" && victim.grounded) continue;
       if (c.projectile !== null && destroyed.has(c.projectile.instanceId)) continue;
       if (recordSaysAlreadyHit(s, c, victim.port)) continue;
@@ -1055,9 +1076,9 @@ function resolveHits(
         events.counters.push({ port: victim.port, x: c.x, y: c.y });
         continue;
       }
       if (victim.invincible > 0) applyInvincibleHit(s, attacker, victim, c, events);
-      else applyHit(s, attacker, victim, defs[v], c, intents[v], events);
+      else applyHit(s, attacker, defs[c.attacker], victim, defs[v], c, intents[v], events);
       if (c.destroyOnHit && c.projectile !== null) destroyed.add(c.projectile.instanceId);
     }
   }
 
@@ -1322,8 +1343,9 @@ function clearPendingLaunch(f: FighterState): void {
 
 function applyHit(
   s: GameState,
   attacker: FighterState,
+  attackerDef: FighterDef,
   victim: FighterState,
   victimDef: FighterDef,
   c: Candidate,
   victimIntent: Intent,
@@ -1360,8 +1382,13 @@ function applyHit(
     kineticSet(victim, 0, 0);
     // Being caught cancels a launch that had not fired yet: the victim is held,
     // not flying, and a pending launch would go off in their captor's hands.
     clearPendingLaunch(victim);
+    // Kirby's Inhale swallows rather than grabs (Plan 5).
+    if (attacker.move !== null && attackerDef.moves[attacker.move]?.inhale !== undefined) {
+      swallowVictim(attacker, victim);
+      return;
+    }
     startAction(victim, "grabbed");
     return;
   }
 
@@ -1458,9 +1485,12 @@ function applyHit(
     return;
   }
 
   /* ---- the damage path ---- */
+  // A copied move hurts ×1.2 and launches as it would have (Plan 5).
+  damage = mul(damage, c.damageMul);
   victim.damage += damage;
+  maybeLoseCopy(s, victim, damage);
   // "Characters can only air dodge once until they land, get hit, or grab a
   // ledge" (SmashWiki "Air dodge", https://www.ssbwiki.com/Air_dodge). Plan 3, Task 7.
   victim.airDodged = false;
 
@@ -1679,11 +1709,12 @@ function resolveThrows(
         projectile: null,
         chargeScale: ONE,
         destroyOnHit: false,
         onlyPort: null,
+        damageMul: ONE,
         suppressed: false,
       };
-      applyHit(s, f, victim, defs[v], c, intents[v], events);
+      applyHit(s, f, defs[i], victim, defs[v], c, intents[v], events);
     }
   }
 }
 
```

`src/engine/states.ts` — apply:

```diff
--- a/src/engine/states.ts
+++ b/src/engine/states.ts
@@ -865,12 +865,13 @@ export function onLanded(f: FighterState, ctx: StateContext): void {
   f.airTime = 0;
   // The hop is over, so the next one decides its own height and its own damage.
   f.shortHop = false;
 
-  // Landing from a carry jump keeps carrying, and a cargo throw begun in the
-  // air finishes on the ground rather than leaving its victim held (Plan 5;
-  // UNVERIFIED that SSBU's aerial cargo throw is not cut short by a landing).
-  if (f.action === "cargoCarry" || f.action === "throw") return;
+  // Landing from a carry jump keeps carrying, a mouthful too, and a cargo
+  // throw begun in the air finishes on the ground rather than leaving its
+  // victim held (Plan 5; UNVERIFIED that SSBU's aerial cargo throw is not cut
+  // short by a landing).
+  if (f.action === "cargoCarry" || f.action === "inhaleHold" || f.action === "throw") return;
   if (f.action === "tumble") {
     f.hitstun = 0;
     kineticSetX(f, 0, "stop");
     startAction(f, "downed");
```

`src/engine/status/cargo.ts` — apply:

```diff
--- a/src/engine/status/cargo.ts
+++ b/src/engine/status/cargo.ts
@@ -102,18 +102,20 @@ export const STATUS_CARGO_HELD: FighterStatus = {
   kind: "FIGHTER_STATUS_KIND_SHOULDERED_DONKEY",
   action: "cargoHeld",
   kineticType: "NONE",
   main(f, intent, ctx) {
-    if (f.grabbedBy < 0) {
+    const carrier = ctx.fighters[f.grabbedBy];
+    // Nobody is carrying them any more (a hit, a KO): they drop.
+    if (f.grabbedBy < 0 || carrier === undefined || (carrier.action !== "cargoCarry" && carrier.action !== "throw")) {
+      releaseGrab(f, ctx.fighters);
       startAction(f, "fall");
       return;
     }
     // The struggle: one frame, plus whatever mashing has earned (8 a stick
     // input, 14.4 a button press — the grab's own rates).
     const sticks = f.framesSinceDirPress === 0 ? 1 : 0;
     f.grabTimer -= 1 + mashFrames(f.combat, buttonPresses(intent), sticks, GRAB_MASH_BUTTON, GRAB_MASH_STICK);
     if (f.grabTimer > 0) return;
-    const carrier = ctx.fighters[f.grabbedBy];
     releaseGrab(f, ctx.fighters);
     f.combat.mash = 0;
     f.combat.grabImmune = GRAB_RELEASE_IMMUNITY;
     startAction(f, "fall");
```

`src/engine/status/index.ts` — apply:

```diff
--- a/src/engine/status/index.ts
+++ b/src/engine/status/index.ts
@@ -7,8 +7,9 @@
  */
 
 import { AIR_STATUSES } from "./air";
 import { CARGO_STATUSES } from "./cargo";
+import { INHALE_STATUSES } from "./inhale";
 import { ATTACK_STATUSES } from "./attack";
 import { CLIFF_STATUSES } from "./cliff";
 import { DAMAGE_STATUSES } from "./damage";
 import { GROUND_STATUSES } from "./ground";
@@ -27,7 +28,8 @@ export const ALL_STATUSES: readonly FighterStatus[] = [
   ...GROUND_STATUSES,
   ...AIR_STATUSES,
   ...PASSIVE_STATUSES,
   ...CARGO_STATUSES,
+  ...INHALE_STATUSES,
 ];
 
 for (const s of ALL_STATUSES) registerStatus(s);
```

`src/engine/status/inhale.ts` (new file):

```ts
/**
 * Kirby's Inhale (Plan 5, Task 9): the statuses around a mouthful.
 *
 * SmashWiki "Kirby (SSBU)/Neutral special":
 * - the held fighter stays in the mouth "180 + 1.1t - k" frames (t: their
 *   percent, k: Kirby's), less 12 frames a stick input and 21.6 a button press
 *   on the ground (16 and 28.8 in the air);
 * - "Walk speed multiplier with inhaled opponent 1.08";
 * - spat as a star, they fly "25 + 0.5t" frames at most, 60 at most, less 10
 *   a stick input and 18 a button press.
 * UNVERIFIED: jumping with a mouthful (no values are published; Kirby's own
 * full hop, once, from the ground) and what happens when the hold runs out
 * (the replica lets the held fighter go, as a grab does).
 */

import { approach, mul } from "../fixed";
import { kineticGroundJump, kineticSum } from "../kinetic";
import { fighterParams } from "../params";
import { mashFrames } from "../shield";
import { GRAB_RELEASE_IMMUNITY, buttonPresses, releaseGrab, startAction, startMove } from "../states";
import type { FighterState } from "../types";
import type { FighterStatus } from "./kind";

/** Mash rates while inhaled, tenths of a frame (SmashWiki, grounded and aerial). */
export const INHALE_MASH_BUTTON = 216;
export const INHALE_MASH_STICK = 120;
export const INHALE_MASH_BUTTON_AIR = 288;
export const INHALE_MASH_STICK_AIR = 160;
/** A spat star's flight, tenths of a frame per press (SmashWiki). */
export const STAR_MASH_BUTTON = 180;
export const STAR_MASH_STICK = 100;
/** A star flies at most this long, and at least this long however hard its rider mashes. */
export const STAR_MAX_FRAMES = 60;
export const STAR_MIN_FRAMES = 4;

/** `180 + 1.1t − k`, in frames, percents Q12. */
export function inhaleHoldFrames(victimPercent: number, kirbyPercent: number): number {
  return Math.max(1, Math.floor((180 * 4096 + Math.trunc((victimPercent * 11) / 10) - kirbyPercent) / 4096));
}

/** `25 + 0.5t`, at most 60, in frames. */
export function starFrames(victimPercent: number): number {
  return Math.min(STAR_MAX_FRAMES, Math.floor((25 * 4096 + (victimPercent >> 1)) / 4096));
}

/** The mouthful gets out: Kirby lets go and they drop out in front of him. */
function escape(held: FighterState, fighters: readonly FighterState[]): void {
  const kirby = fighters[held.grabbedBy];
  releaseGrab(held, fighters);
  held.combat.mash = 0;
  held.combat.grabImmune = GRAB_RELEASE_IMMUNITY;
  startAction(held, "fall");
  if (kirby !== undefined && kirby.action === "inhaleHold") startAction(kirby, kirby.grounded ? "stand" : "fall");
}

export const STATUS_INHALE_HOLD: FighterStatus = {
  kind: "FIGHTER_KIRBY_STATUS_KIND_SPECIAL_N_EAT_WAIT",
  action: "inhaleHold",
  kineticType: "WALK",
  main(f, intent, ctx) {
    if (f.grabbing < 0) {
      startAction(f, f.grounded ? "stand" : "fall");
      return;
    }
    const inhale = ctx.def.moves.neutralB?.inhale;
    if (inhale === undefined) return;
    // B or down swallows; attack spits.
    if (intent.specialPressed || intent.downPressed) {
      startMove(f, "special", inhale.swallow);
      return;
    }
    if (intent.attackPressed || intent.grabPressed) {
      startMove(f, "special", inhale.spit);
      return;
    }
    if (intent.x !== 0) f.facing = intent.x;
    if (intent.jumpPressed && f.grounded) {
      kineticGroundJump(f, fighterParams(ctx.def), true);
      f.grounded = false;
      f.platform = -1;
    }
  },
  exec(f, intent, ctx) {
    const inhale = ctx.def.moves.neutralB?.inhale;
    if (inhale === undefined) return;
    const p = fighterParams(ctx.def);
    f.kinetic.controlX = approach(
      f.kinetic.controlX,
      intent.x * mul(p.walk_speed_max, inhale.walk),
      mul(p.walk_accel_add + p.walk_accel_mul, inhale.walk),
    );
    kineticSum(f);
  },
};

export const STATUS_SWALLOWED: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_SWALLOWED",
  action: "swallowed",
  kineticType: "NONE",
  main(f, intent, ctx) {
    if (f.grabbedBy < 0) {
      startAction(f, "fall");
      return;
    }
    // Inside Kirby nothing can touch them.
    f.intangible = Math.max(f.intangible, 1);
    const kirby = ctx.fighters[f.grabbedBy];
    // A Kirby who is no longer holding them (a hit, a KO) lets them out.
    if (kirby === undefined || (kirby.action !== "inhaleHold" && kirby.action !== "special")) {
      escape(f, ctx.fighters);
      return;
    }
    const air = kirby !== undefined && !kirby.grounded;
    const sticks = f.framesSinceDirPress === 0 ? 1 : 0;
    f.grabTimer -= 1 + mashFrames(
      f.combat,
      buttonPresses(intent),
      sticks,
      air ? INHALE_MASH_BUTTON_AIR : INHALE_MASH_BUTTON,
      air ? INHALE_MASH_STICK_AIR : INHALE_MASH_STICK,
    );
    if (f.grabTimer <= 0) escape(f, ctx.fighters);
  },
};

export const STATUS_SPAT_STAR: FighterStatus = {
  kind: "FIGHTER_STATUS_KIND_SWALLOWED_THROWN_STAR",
  action: "spatStar",
  kineticType: "NONE",
  main(f, intent) {
    f.intangible = Math.max(f.intangible, 1);
    // `grabTimer` holds what is left of the flight; mashing shortens it.
    const sticks = f.framesSinceDirPress === 0 ? 1 : 0;
    f.grabTimer -= 1 + mashFrames(f.combat, buttonPresses(intent), sticks, STAR_MASH_BUTTON, STAR_MASH_STICK);
    if (f.combat.ride === 0 || (f.grabTimer <= 0 && f.actionFrame >= STAR_MIN_FRAMES)) {
      f.combat.ride = 0;
      f.grabTimer = 0;
      startAction(f, "fall");
    }
  },
};

export const INHALE_STATUSES: readonly FighterStatus[] = [STATUS_INHALE_HOLD, STATUS_SWALLOWED, STATUS_SPAT_STAR];
```

`src/engine/status/kind.ts` — apply:

```diff
--- a/src/engine/status/kind.ts
+++ b/src/engine/status/kind.ts
@@ -67,8 +67,11 @@ export type StatusKind =
   | "FIGHTER_STATUS_KIND_CLIFF_ROBBED"
   // Plan 5. SSBU's fighter-specific kind keeps its fighter in the name.
   | "FIGHTER_DONKEY_STATUS_KIND_SHOULDER_WAIT"
   | "FIGHTER_STATUS_KIND_SHOULDERED_DONKEY"
+  | "FIGHTER_KIRBY_STATUS_KIND_SPECIAL_N_EAT_WAIT"
+  | "FIGHTER_STATUS_KIND_SWALLOWED"
+  | "FIGHTER_STATUS_KIND_SWALLOWED_THROWN_STAR"
   | "FIGHTER_STATUS_KIND_REBIRTH"
   | "FIGHTER_STATUS_KIND_DEAD"
   | "FIGHTER_STATUS_KIND_ENTRY";
 
@@ -119,8 +122,11 @@ export const STATUS_KIND_OF_ACTION: Readonly<Record<ActionState, StatusKind>> =
   ledgeJump: "FIGHTER_STATUS_KIND_CLIFF_JUMP1",
   ledgeTrumped: "FIGHTER_STATUS_KIND_CLIFF_ROBBED",
   cargoCarry: "FIGHTER_DONKEY_STATUS_KIND_SHOULDER_WAIT",
   cargoHeld: "FIGHTER_STATUS_KIND_SHOULDERED_DONKEY",
+  inhaleHold: "FIGHTER_KIRBY_STATUS_KIND_SPECIAL_N_EAT_WAIT",
+  swallowed: "FIGHTER_STATUS_KIND_SWALLOWED",
+  spatStar: "FIGHTER_STATUS_KIND_SWALLOWED_THROWN_STAR",
   respawnPlatform: "FIGHTER_STATUS_KIND_REBIRTH",
   dead: "FIGHTER_STATUS_KIND_DEAD",
   entering: "FIGHTER_STATUS_KIND_ENTRY",
 };
```

`src/engine/types.ts` — apply:

```diff
--- a/src/engine/types.ts
+++ b/src/engine/types.ts
@@ -130,8 +130,12 @@ export type ActionState =
   | "ledgeTrumped"
   // carried (Plan 5)
   | "cargoCarry"
   | "cargoHeld"
+  // Kirby's Inhale (Plan 5)
+  | "inhaleHold"
+  | "swallowed"
+  | "spatStar"
   // meta
   | "respawnPlatform"
   | "dead"
   | "entering";
@@ -173,9 +177,12 @@ export type MoveSlot =
   // Plan 5: Donkey Kong's cargo throws, from the carry.
   | "cargoFthrow"
   | "cargoBthrow"
   | "cargoUthrow"
-  | "cargoDthrow";
+  | "cargoDthrow"
+  // Plan 5: Kirby's swallow and spit, from the inhale.
+  | "inhaleSwallow"
+  | "inhaleSpit";
 
 /** Non-damage properties a hit can carry. Drives VFX, hitlag and reactions. */
 export type HitEffect =
   | "normal"
@@ -301,8 +308,10 @@ export interface ProjectileDef {
   /** Drawing hint for the renderer. */
   readonly visual: "arrow" | "bomb" | "boomerang" | "energy" | "fire" | "spark" | "missile";
   /** A reflector can send it back (Plan 5): the article's `ATTACK(…, Reflectable=true)`. */
   readonly reflectable?: boolean;
+  /** Speed lost per frame, and the speed below which it is gone (Plan 5: Kirby's star). */
+  readonly drag?: { readonly perFrame: number; readonly minSpeed: number };
 }
 
 /**
  * A reflector a move raises (Plan 5): Fox's Reflector, Mario's Cape. Frames
@@ -345,8 +354,17 @@ export interface CounterDef {
   /** The move slot the counterattack is. Its hitboxes deal the counter's damage. */
   readonly then: MoveSlot;
 }
 
+/** Kirby's Inhale (Plan 5): what the mouth holds and how long. */
+export interface InhaleDef {
+  /** Walk speed (and acceleration) multiplier while holding: 1.08. */
+  readonly walk: number;
+  /** The move that swallows, and the one that spits. */
+  readonly swallow: MoveSlot;
+  readonly spit: MoveSlot;
+}
+
 /** A special's once-per-airtime stall (Plan 5): Fox's Reflector, Mario's Cape. Q12. */
 export interface StallDef {
   /** Horizontal speed multiplier on the first frame (Cape: 1 / 2.5). */
   readonly startX: number;
@@ -428,8 +446,14 @@ export interface MoveDef {
   /** A throw that ends by lifting the held fighter to carry (Plan 5: DK's forward throw). */
   readonly cargo?: boolean;
   /** The frame a throw turns the thrower round (`REVERSE_LR`, Plan 5). */
   readonly turnAt?: number;
+  /** Its catch boxes swallow rather than grab (Plan 5: Kirby's Inhale). */
+  readonly inhale?: InhaleDef;
+  /** A copied move's damage multiplier, knockback untouched (Plan 5: Kirby's Copy Ability, ×1.2). */
+  readonly copyDamage?: number;
+  /** The frame an inhaled fighter leaves the mouth, and how (Plan 5: swallow, spit). */
+  readonly release?: { readonly frame: number; readonly kind: "swallow" | "spit"; readonly damage: number };
   /** First and last move frame the fighter is intangible (Plan 5: SmashWiki "Intangibility a-b"). */
   readonly intangible?: readonly [number, number];
   /** Frames the fighter may not be interrupted, for specials with armour. */
   readonly superArmourFrames?: readonly [number, number];
```

`src/fighters/kirby.ts` — apply:

```diff
--- a/src/fighters/kirby.ts
+++ b/src/fighters/kirby.ts
@@ -642,8 +642,15 @@ const legacy: FighterDef = {
     neutralB: {
       slot: "neutralB",
       name: "Inhale",
       totalFrames: 67,
+      // Plan 5: a catch puts the victim in his mouth (`swallowed`); from there
+      // B or down swallows (`inhaleSwallow`) and attack spits (`inhaleSpit`).
+      // SmashWiki: "Walk speed multiplier with inhaled opponent 1.08".
+      // UNVERIFIED-simplified: the loop's pull (`game_specialnloop` windboxes,
+      // angle 160, FKB 30/25, rehit 10) and holding the inhale past frame 44
+      // are not modelled.
+      inhale: { walk: fx(1.08), swallow: "inhaleSwallow", spit: "inhaleSpit" },
       // Not a damaging move — a grab. Suction is active frames 10-44 (longer
       // if held) and pulls anyone caught into Kirby's mouth, from which he can
       // either **swallow** (10%, and he takes the victim's neutral special as
       // a Copy Ability) or **spit** them out as a star projectile (6%; the star
@@ -665,8 +672,65 @@ const legacy: FighterDef = {
         },
       ],
     },
 
+    inhaleSwallow: {
+      slot: "inhaleSwallow",
+      name: "Inhale (swallow)",
+      // SmashWiki "Kirby (SSBU)/Neutral special": swallow — throw release on
+      // frame 8, interruptible 21; UFD: 10%. The victim's neutral special
+      // becomes his Copy Ability (`engine/inhale.ts`).
+      totalFrames: 20,
+      release: { frame: 8, kind: "swallow", damage: fx(10.0) },
+      hitboxes: [],
+    },
+
+    inhaleSpit: {
+      slot: "inhaleSpit",
+      name: "Inhale (spit)",
+      // SmashWiki: spit — throw release on frame 8, interruptible 31
+      // (grounded); `game_specialnspit` ATTACK_ABS 6% and
+      // generate_article(STARMISSILE) on frame 8.
+      totalFrames: 30,
+      release: { frame: 8, kind: "spit", damage: fx(6.0) },
+      hitboxes: [],
+      projectiles: [
+        {
+          // The spat fighter as a star. SmashWiki: angle 45, BK 70, KS 78,
+          // radius 2.5; damage by the rider's weight (10%–21%, applied by
+          // `starDamage`); "2.8 + 0.008(t - k) units per frame, decreasing by
+          // 0.05 per frame; the target is released below 0.4"; at most 60
+          // frames. UNVERIFIED-simplified: the +0.008(t − k) term.
+          id: "star",
+          spawnFrame: 8,
+          offsetX: fx(8.0),
+          offsetY: fx(4.0),
+          vx: fx(2.8),
+          vy: fx(0),
+          gravity: fx(0),
+          lifetime: 60,
+          destroyOnHit: true,
+          drag: { perFrame: fx(0.05), minSpeed: fx(0.4) },
+          visual: "spark",
+          // kirby_starmissile `Fly`: `Reflectable=true`.
+          reflectable: true,
+          hitbox: {
+            id: 0,
+            startFrame: 0,
+            endFrame: 60,
+            x: fx(0),
+            y: fx(0),
+            radius: fx(2.5),
+            damage: fx(10.0),
+            angle: fx(45),
+            baseKnockback: fx(70),
+            knockbackGrowth: fx(78),
+            transcendent: true,
+          },
+        },
+      ],
+    },
+
     sideB: {
       slot: "sideB",
       name: "Hammer Flip",
       totalFrames: 69,
```

`src/render/poses/timing.ts` — apply:

```diff
--- a/src/render/poses/timing.ts
+++ b/src/render/poses/timing.ts
@@ -143,8 +143,10 @@ export const SLOT_POSE: Record<MoveSlot, PoseName> = {
   cargoFthrow: "fthrow",
   cargoBthrow: "bthrow",
   cargoUthrow: "uthrow",
   cargoDthrow: "dthrow",
+  inhaleSwallow: "neutralB",
+  inhaleSpit: "neutralB",
 };
 
 /** A looping clip that names no period of its own runs at half a second. */
 const DEFAULT_PERIOD = 30;
@@ -252,11 +254,16 @@ export function poseNameFor(f: Pick<PosedFighter, "action" | "move" | "jumpsUsed
     case "grabbed":
     // Plan 5: carried on the shoulders, still held.
     case "cargoHeld":
       return "grabbed";
-    // Plan 5: walking with the cargo; the walk clip reads as the carry.
+    // Plan 5: walking with the cargo, or with a mouthful; the walk clip reads as either.
     case "cargoCarry":
+    case "inhaleHold":
       return "walk";
+    // Plan 5: inside Kirby (drawn hidden) or flying as his star.
+    case "swallowed":
+    case "spatStar":
+      return "tumble";
     case "thrown":
       return "thrown";
     case "downed":
       return "downed";
```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/engine/inhale.test.ts src/engine/status/groups.test.ts src/engine/status/status.test.ts src/fighters/inhale.test.ts src/fighters/schema.test.ts`
Expected: PASS (`src/engine/inhale.test.ts` 2 tests, `src/fighters/inhale.test.ts` 10 tests).

- [ ] **Step 5: Regenerate the generated files, in this order**

Each command rewrites one artefact from the code; the order matters (the limb list feeds the reconcile list and the bake, the bake feeds reach). Then review each diff against the scratch result below.

```bash
UPDATE_BAKE=1 pnpm vitest run src/render3d/bake/roster.test.ts
```

`src/fighters/bake/digest.ts` — the bake's new digest:

```diff
--- a/src/fighters/bake/digest.ts
+++ b/src/fighters/bake/digest.ts
@@ -1,5 +1,5 @@
 // GENERATED by src/render3d/bake/roster.test.ts (UPDATE_BAKE=1) — do not edit by hand.
 /** SHA-256 of the uncompressed public/bake/roster.bin.gz: the bake's fingerprint. */
-export const BAKE_DIGEST = "97401c361aa4dd243d53878ae21eefab951103c297b0c67e2c40b6e7bbb27590";
+export const BAKE_DIGEST = "29b841323955506e88627c17fdd2bd627eb89c961d54d661c02f1a21c284b48b";
 /** Its uncompressed length in bytes. */
-export const BAKE_BYTES = 5576011;
+export const BAKE_BYTES = 5760498;
```

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0; golden trace untouched.

- [ ] **Step 7: Commit**

```bash
git add super-smash/public/bake/roster.bin.gz super-smash/src/engine/acmd/legacy.ts super-smash/src/engine/combat.ts super-smash/src/engine/hash.ts super-smash/src/engine/held.ts super-smash/src/engine/inhale.test.ts super-smash/src/engine/inhale.ts super-smash/src/engine/projectile.ts super-smash/src/engine/simulate.ts super-smash/src/engine/states.ts super-smash/src/engine/status/cargo.ts super-smash/src/engine/status/groups.test.ts super-smash/src/engine/status/index.ts super-smash/src/engine/status/inhale.ts super-smash/src/engine/status/kind.ts super-smash/src/engine/status/status.test.ts super-smash/src/engine/types.ts super-smash/src/fighters/bake/digest.ts super-smash/src/fighters/inhale.test.ts super-smash/src/fighters/kirby.ts super-smash/src/fighters/schema.test.ts super-smash/src/render/poses/timing.ts
git commit -m "super-smash: Kirby's Inhale: swallow for a Copy Ability, or spit a star" -m "Hold 180 + 1.1t - k frames, walk x1.08, star flight 25 + 0.5t (max 60), Copy Ability x1.2, lost on a KO or, after 1200 frames, to a hit with chance damage/70 (SmashWiki). A full mouth cannot grab a ledge and a ledge-hanging fighter cannot be inhaled; a shielding one can (a grabbox). The spat star is found by its definition and age; the merged Copy Ability definition is cached per definition object. Bake regenerated (three statuses). Golden trace unchanged." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Wall jumps and wall tech jumps

SmashWiki (Wall jump): Mario, Fox, Pikachu and Samus can wall jump (`canWallJump`); a press away from a wall within a few frames of touching it kicks off it, and "each one performed without touching the ground has its initial velocity reduced to 0.96×, which stacks". The page's Ultimate height ranking gives each one's **wall jump height** — Pikachu 36.89, Mario 31.563, Samus 30.45, Fox 25.35 (`FighterAttributes.wallJumpHeight`; the page marks its Brawl-onward tables for checking, and they are the only published figures) — so the jump launches at the speed that rises that high under the fighter's own gravity (`jumpLaunchSpeed`, as a full hop). A tech on a wall with jump pressed is a wall tech jump (Plan 3's `techWall`). UNVERIFIED: the contact window (`WALL_JUMP_WINDOW` 3), the tech window (`WALL_TECH_JUMP_FRAMES` 5), the speed away from the wall (the air speed) and, for the four without a published height, their air jump's height for a wall tech jump.

**Files:**
- Create: `super-smash/src/engine/wallJump.ts`, `super-smash/src/fighters/walljump.test.ts`
- Modify: `super-smash/src/engine/combat.ts`, `super-smash/src/engine/hash.ts`, `super-smash/src/engine/simulate.ts`, `super-smash/src/engine/states.ts`, `super-smash/src/engine/status/air.ts`, `super-smash/src/engine/status/passive.ts`, `super-smash/src/engine/types.ts`, `super-smash/src/fighters/fox.ts`, `super-smash/src/fighters/mario.ts`, `super-smash/src/fighters/pikachu.ts`, `super-smash/src/fighters/samus.ts`

**Interfaces:**
- Consumes: `CollisionOutcome.wall` (a side number), `techOrBounce` (Plan 3), `kineticAirJump` (Plan 2).
- Produces: `src/engine/wallJump.ts`: `WALL_JUMP_WINDOW`, `WALL_JUMP_DECAY`, `WALL_TECH_JUMP_FRAMES`, `noteWallContact`, `tryWallJump`, `tryWallTechJump`; `FighterAttributes.wallJumpHeight?`; `CombatState.wallSide`, `.wallFrames`, `.wallJumps`.

- [ ] **Step 1: Write the failing test**

`src/fighters/walljump.test.ts` (new file):

```ts
/**
 * Wall jumps, through the real `step()` (Plan 5, Task 10). SmashWiki "Wall
 * jump": touch a wall, press away; Mario, Samus, Fox and Pikachu can; each
 * further one before landing is 0.96× as strong.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { fx } from "@/engine/fixed";
import { createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { Btn } from "@/engine/types";
import type { GameState, InputFrame, MatchRules } from "@/engine/types";
import { STAGES } from "@/stages";
import { FIGHTERS } from "./index";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: false };

beforeAll(() => {
  registerFighters(FIGHTERS);
  registerStages(STAGES);
});

/** `defId` falling just off Final Destination's right side, below the ledge, against the wall. */
function besideTheWall(defId: string): GameState {
  const s = createInitialState("finalDestination", [{ defId }], RULES, 3);
  Object.assign(s.fighters[0], { action: "fall", actionFrame: 0, grounded: false, platform: -1, x: fx(84), y: fx(-20), vx: 0, vy: 0, facing: -1, intangible: 0, jumpsUsed: 2 });
  return s;
}

function run(s0: GameState, inputs: readonly InputFrame[]): GameState[] {
  let s = s0;
  let prev: InputFrame = 0;
  const out: GameState[] = [];
  for (const i of inputs) {
    s = step(s, [i], { prevInputs: [prev] }).state;
    prev = i;
    out.push(s);
  }
  return out;
}

/** Drift into the wall (left), then flick right. */
const KICK_OFF: InputFrame[] = [...Array<InputFrame>(8).fill(Btn.Left), Btn.Right, ...Array<InputFrame>(6).fill(0)];

describe("wall jumps", () => {
  for (const id of ["mario", "samus", "fox", "pikachu"]) {
    it(`${id} kicks off the wall: up and away, facing out`, () => {
      const states = run(besideTheWall(id), KICK_OFF);
      const after = states[9].fighters[0];
      expect(after.action).toBe("jump");
      expect(after.vy).toBeGreaterThan(0);
      expect(after.vx).toBeGreaterThan(0);
      expect(after.facing).toBe(1);
    });
  }

  for (const id of ["donkeyKong", "link", "kirby", "marth"]) {
    it(`${id} cannot`, () => {
      const states = run(besideTheWall(id), KICK_OFF);
      expect(states.every((s) => s.fighters[0].combat.wallJumps === 0)).toBe(true);
    });
  }

  // SmashWiki "Wall jump", Ultimate's ranking. The rise is measured from the
  // kick to the top of the jump, so the fighter's gravity decides it.
  for (const [id, height] of [["pikachu", 36.89], ["mario", 31.563], ["samus", 30.45], ["fox", 25.35]] as const) {
    it(`${id} rises its published wall jump height, ${height}`, () => {
      const states = run(besideTheWall(id), [...KICK_OFF, ...Array<InputFrame>(80).fill(0)]);
      const from = states[7].fighters[0].y;
      const top = Math.max(...states.slice(8).map((s) => s.fighters[0].y));
      expect((top - from) / 4096).toBeCloseTo(height, 0);
    });
  }

  it("weakens each further wall jump before landing to 0.96×", () => {
    // On the frame of the kick, before gravity has had a say.
    const first = run(besideTheWall("mario"), KICK_OFF)[8].fighters[0];
    const s = besideTheWall("mario");
    s.fighters[0].combat.wallJumps = 1;
    const second = run(s, KICK_OFF)[8].fighters[0];
    expect(second.action).toBe("jump");
    expect(second.vy / first.vy).toBeCloseTo(0.96, 2);
  });

  it("needs a fresh press away: drifting away without touching the wall does nothing", () => {
    const s = besideTheWall("mario");
    s.fighters[0].x = fx(120);
    const states = run(s, KICK_OFF);
    expect(states[9].fighters[0].combat.wallJumps).toBe(0);
  });
});

describe("wall tech jumps", () => {
  it("a jump in a wall tech's first frames launches off the wall, for anyone", () => {
    const s = besideTheWall("donkeyKong");
    Object.assign(s.fighters[0], { action: "techWall", actionFrame: 0 });
    s.fighters[0].combat.wallSide = -1;
    const states = run(s, [Btn.Jump, 0, 0]);
    expect(states[0].fighters[0].action).toBe("jump");
    expect(states[0].fighters[0].vx).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run src/fighters/walljump.test.ts`
Expected: FAIL — 15 failed — every test: `expected 'fall' to be 'jump'`, `expected 'techWall' to be 'jump'`, `expected undefined to be +0` (no `wallJumps`), and the heights (`expected -0.782… to be close to 31.563`).

- [ ] **Step 3: Implement**

`src/engine/combat.ts` — apply:

```diff
--- a/src/engine/combat.ts
+++ b/src/engine/combat.ts
@@ -64,8 +64,14 @@ export interface CombatState {
   /** Plan 5: frames the Copy Ability has been held (it cannot be knocked off for 1200). */
   copyFrames: number;
   /** Plan 5: the projectile a spat fighter rides as a star, by instance id; 0 for none. */
   ride: number;
+  /** Plan 5: the wall last touched in the air, 1 right / −1 left, 0 none. */
+  wallSide: number;
+  /** Plan 5: frames since that touch. */
+  wallFrames: number;
+  /** Plan 5: wall jumps since last on the ground (each weaker, ×0.96). */
+  wallJumps: number;
 }
 
 export function emptyCombat(): CombatState {
   return {
@@ -89,8 +95,11 @@ export function emptyCombat(): CombatState {
     counterDamage: 0,
     copy: "",
     copyFrames: 0,
     ride: 0,
+    wallSide: 0,
+    wallFrames: 0,
+    wallJumps: 0,
   };
 }
 
 export function cloneCombat(c: CombatState): CombatState {
@@ -115,6 +124,9 @@ export function cloneCombat(c: CombatState): CombatState {
     counterDamage: c.counterDamage,
     copy: c.copy,
     copyFrames: c.copyFrames,
     ride: c.ride,
+    wallSide: c.wallSide,
+    wallFrames: c.wallFrames,
+    wallJumps: c.wallJumps,
   };
 }
```

`src/engine/hash.ts` — apply:

```diff
--- a/src/engine/hash.ts
+++ b/src/engine/hash.ts
@@ -183,8 +183,11 @@ export function mixCombat(h: number, c: CombatState): number {
   x = mixInt(x, c.counterDamage);
   x = mixString(x, c.copy);
   x = mixInt(x, c.copyFrames);
   x = mixInt(x, c.ride);
+  x = mixInt(x, c.wallSide);
+  x = mixInt(x, c.wallFrames);
+  x = mixInt(x, c.wallJumps);
   return x;
 }
 
 /** The KineticModule energies, in declaration order. */
```

`src/engine/simulate.ts` — apply:

```diff
--- a/src/engine/simulate.ts
+++ b/src/engine/simulate.ts
@@ -92,8 +92,12 @@ import {
 import { chargedHitbox } from "./specialCharge";
 import { reflectProjectiles } from "./reflect";
 import { activeCounter, triggerCounter } from "./counter";
 import { isHeldAloft, pinHeldFighters } from "./held";
+import { WALL_JUMP_WINDOW, noteWallContact } from "./wallJump";
+
+/** A wall touch is forgotten once no wall jump could use it. */
+const WALL_CONTACT_MEMORY = WALL_JUMP_WINDOW + 1;
 import { COPY_GRACE_FRAMES, maybeLoseCopy, pinStarRiders, resolveInhaleReleases, swallowVictim, withCopyAbility } from "./inhale";
 import {
   blastZoneKO,
   ecbOf,
@@ -581,8 +585,13 @@ export function step(
 
     // Tech input counts on every frame, frozen or not (Plan 3, Task 12).
     updateTechInput(f, intent);
     if (f.combat.copy !== "" && f.combat.copyFrames < COPY_GRACE_FRAMES) f.combat.copyFrames += 1;
+    // A wall touch counts for a few frames, and not at all on the ground (Plan 5).
+    if (f.combat.wallSide !== 0) {
+      f.combat.wallFrames += 1;
+      if (f.grounded || f.combat.wallFrames > WALL_CONTACT_MEMORY) f.combat.wallSide = 0;
+    }
     if (f.intangible > 0) f.intangible -= 1;
     if (f.combat.grabImmune > 0) f.combat.grabImmune -= 1;
     if (f.invincible > 0) f.invincible -= 1;
 
@@ -652,8 +661,9 @@ export function step(
       { ecb },
     );
     // A tumbling body that meets a surface techs or bounces (Plan 3, Task 12);
     // otherwise a landing is a landing — a missed tech lies down in `onLanded`.
+    noteWallContact(f, outcome.wall);
     const surface = outcome.landed ? "floor" : outcome.ceiling ? "ceiling" : outcome.wall !== 0 ? "wall" : null;
     const reaction = surface === null ? null : techOrBounce(f, surface, before, intents[i], outcome.wall);
     if (outcome.landed && reaction === null) {
       onLanded(f, stateCtx(i));
```

`src/engine/states.ts` — apply:

```diff
--- a/src/engine/states.ts
+++ b/src/engine/states.ts
@@ -861,8 +861,9 @@ export function onLanded(f: FighterState, ctx: StateContext): void {
   f.launchSpeed = 0;
   f.jumpsUsed = 0;
   f.airDodged = false;
   f.combat.specialStall = false;
+  f.combat.wallJumps = 0;
   f.airTime = 0;
   // The hop is over, so the next one decides its own height and its own damage.
   f.shortHop = false;
 
@@ -952,8 +953,9 @@ export function grabLedge(
   f.facing = -side;
   f.jumpsUsed = 0;
   f.airDodged = false;
   f.combat.specialStall = false;
+  f.combat.wallJumps = 0;
   f.fastFalling = false;
   f.shortHop = false;
   f.ledgeRegrabs += 1;
   f.intangible = Math.max(f.intangible, intangibility);
```

`src/engine/status/air.ts` — apply:

```diff
--- a/src/engine/status/air.ts
+++ b/src/engine/status/air.ts
@@ -8,8 +8,9 @@
 import { JUMP_SQUAT_FRAMES } from "../constants";
 import { kineticGroundJump, kineticSetY } from "../kinetic";
 import { fighterParams } from "../params";
 import { fastFallVelocity } from "../physics";
+import { tryWallJump } from "../wallJump";
 import {
   LANDING_ANIMATION_FRAMES,
   bufferPress,
   handleActionable,
@@ -55,8 +56,10 @@ function airMain(f: FighterState, intent: Intent, ctx: StateContext): void {
   if (f.grounded) {
     startAction(f, "land");
     return;
   }
+  // A fresh press away from a wall just touched (Plan 5, `wallJump.ts`).
+  if (tryWallJump(f, intent, ctx)) return;
   if (handleActionable(f, intent, ctx)) return;
   // Fast fall is only available after the apex, which makes it a read on the
   // defender rather than a free way to shorten every jump.
   if (intent.downPressed && !f.fastFalling && f.vy <= 0 && f.hitstun === 0) {
```

`src/engine/status/passive.ts` — apply:

```diff
--- a/src/engine/status/passive.ts
+++ b/src/engine/status/passive.ts
@@ -7,8 +7,9 @@
  * come from `dodgeWindow` (`states.ts`), like a roll's; velocity changes go
  * through the KineticModule only.
  */
 
+import { tryWallTechJump } from "../wallJump";
 import {
   TECH_CEILING_FRAMES,
   TECH_FRAMES,
   TECH_ROLL_FRAMES,
@@ -49,8 +50,10 @@ export const STATUS_PASSIVE_WALL: FighterStatus = {
     if (f.actionFrame >= TECH_WALL_FRAMES) {
       startAction(f, "fall");
       return;
     }
+    // A jump in the first frames is a wall tech jump (Plan 5).
+    if (tryWallTechJump(f, intent, ctx)) return;
     if (f.actionFrame >= TECH_WALL_INTERRUPT && handleActionable(f, intent, ctx)) return;
     bufferPress(f, intent, ctx.frame);
   },
 };
```

`src/engine/types.ts` — apply:

```diff
--- a/src/engine/types.ts
+++ b/src/engine/types.ts
@@ -502,8 +502,14 @@ export interface FighterAttributes {
   readonly shortHopVelocity: number;
   readonly airJumpVelocity: number;
   readonly jumps: number;
   readonly canWallJump: boolean;
+  /**
+   * How high a wall jump rises, fixed (Plan 5; SmashWiki "Wall jump", "Wall
+   * jump height rankings", Ultimate). Absent: the fighter's air jump height —
+   * UNVERIFIED, for the wall tech jumps of fighters with no published height.
+   */
+  readonly wallJumpHeight?: number;
   /** Half-width and height of the fighter's hurtbox, fixed. */
   readonly width: number;
   readonly height: number;
   /** Frames of jumpsquat. Universally 3 in Ultimate. */
```

`src/engine/wallJump.ts` (new file):

```ts
/**
 * Wall jumps (Plan 5, Task 10).
 *
 * SmashWiki "Wall jump": "It is performed by touching a wall and then pressing
 * the control stick or d-pad" away from it; in Ultimate Mario, Samus, Fox and
 * Pikachu of the eight can (`FighterAttributes.canWallJump`); "each one
 * performed without touching the ground has its initial velocity reduced to
 * 0.96×, which stacks". Its height ranking gives each wall jumper's height
 * (Pikachu 36.89, Mario 31.563, Samus 30.45, Fox 25.35:
 * `FighterAttributes.wallJumpHeight`), so the jump launches at the speed that
 * rises that high under the fighter's own gravity (`jumpLaunchSpeed`, as a
 * full hop's). UNVERIFIED: the speed away from the wall (the fighter's air
 * speed) and the contact window (`WALL_JUMP_WINDOW`).
 *
 * Any fighter's wall tech can become a wall tech jump (SSBU
 * FIGHTER_STATUS_KIND_PASSIVE_WALL_JUMP): jump in the tech's first frames
 * (`WALL_TECH_JUMP_FRAMES`, UNVERIFIED). A fighter with no published wall jump
 * height rises its air jump's height — UNVERIFIED.
 */

import { fx, mul } from "./fixed";
import { jumpLaunchSpeed, kineticJump, kineticSetX } from "./kinetic";
import { fighterParams } from "./params";
import { startAction } from "./states";
import type { Intent, StateContext } from "./states";
import type { FighterState } from "./types";

/** Frames after touching a wall that a press away still wall-jumps. UNVERIFIED. */
export const WALL_JUMP_WINDOW = 3;
/** SmashWiki: each further wall jump before landing launches at 0.96×. */
export const WALL_JUMP_DECAY = fx(0.96);
/** The wall tech's first frames, in which a jump becomes a wall tech jump. UNVERIFIED. */
export const WALL_TECH_JUMP_FRAMES = 5;

/** The collision said a wall is on `side` (1 right, −1 left) this frame. */
export function noteWallContact(f: FighterState, side: number): void {
  if (side === 0) return;
  f.combat.wallSide = side;
  f.combat.wallFrames = 0;
}

/** Launch away from the wall: its wall jump height up, its air speed away, ×0.96 per repeat. */
function launchOffWall(f: FighterState, ctx: StateContext, away: number): void {
  const p = fighterParams(ctx.def);
  let scale = fx(1);
  for (let i = 0; i < f.combat.wallJumps; i++) scale = mul(scale, WALL_JUMP_DECAY);
  const height = ctx.def.attributes.wallJumpHeight ?? p.jump_aerial_y;
  kineticJump(f, mul(jumpLaunchSpeed(p.air_accel_y, height), scale));
  kineticSetX(f, away * mul(p.air_speed_x_stable, scale));
  f.facing = away;
  f.fastFalling = false;
  f.combat.wallJumps += 1;
  f.combat.wallSide = 0;
  startAction(f, "jump");
}

/** From the air: a fresh press away from a wall just touched. Returns true if it jumped. */
export function tryWallJump(f: FighterState, intent: Intent, ctx: StateContext): boolean {
  if (!ctx.def.attributes.canWallJump || f.grounded) return false;
  const side = f.combat.wallSide;
  if (side === 0 || f.combat.wallFrames > WALL_JUMP_WINDOW) return false;
  if (f.framesSinceDirPress !== 0 || intent.x !== -side) return false;
  launchOffWall(f, ctx, -side);
  return true;
}

/** From a wall tech: jump in its first frames. Returns true if it jumped. */
export function tryWallTechJump(f: FighterState, intent: Intent, ctx: StateContext): boolean {
  if (!intent.jumpPressed || f.actionFrame > WALL_TECH_JUMP_FRAMES || f.combat.wallSide === 0) return false;
  launchOffWall(f, ctx, -f.combat.wallSide);
  return true;
}
```

`src/fighters/fox.ts` — apply:

```diff
--- a/src/fighters/fox.ts
+++ b/src/fighters/fox.ts
@@ -59,8 +59,11 @@ const legacy: FighterDef = {
     shortHopVelocity: fx(2.747),
     airJumpVelocity: fx(4.126),
     jumps: 2,
     canWallJump: true,
+    // SmashWiki "Wall jump", Ultimate's height ranking: 25.35. (The page marks its
+    // Brawl-onward table for checking; it is the only published figure.)
+    wallJumpHeight: fx(25.35),
     width: fx(HALF_WIDTH),
     height: fx(HEIGHT),
     jumpSquatFrames: 3,
   },
```

`src/fighters/mario.ts` — apply:

```diff
--- a/src/fighters/mario.ts
+++ b/src/fighters/mario.ts
@@ -124,8 +124,11 @@ const legacy: FighterDef = {
     shortHopVelocity: fx(1.747),
     airJumpVelocity: fx(2.514),
     jumps: 2,
     canWallJump: true,
+    // SmashWiki "Wall jump", Ultimate's height ranking: 31.563. (The page marks its
+    // Brawl-onward table for checking; it is the only published figure.)
+    wallJumpHeight: fx(31.563),
     width: fx(HALF_WIDTH),
     height: fx(HEIGHT),
     jumpSquatFrames: 3,
   },
```

`src/fighters/pikachu.ts` — apply:

```diff
--- a/src/fighters/pikachu.ts
+++ b/src/fighters/pikachu.ts
@@ -55,8 +55,11 @@ const legacy: FighterDef = {
     shortHopVelocity: fx(1.804),
     airJumpVelocity: fx(2.597),
     jumps: 2,
     canWallJump: true,
+    // SmashWiki "Wall jump", Ultimate's height ranking: 36.89. (The page marks its
+    // Brawl-onward table for checking; it is the only published figure.)
+    wallJumpHeight: fx(36.89),
     width: fx(HALF_WIDTH),
     height: fx(HEIGHT),
     jumpSquatFrames: 3,
   },
```

`src/fighters/samus.ts` — apply:

```diff
--- a/src/fighters/samus.ts
+++ b/src/fighters/samus.ts
@@ -51,8 +51,11 @@ const legacy: FighterDef = {
     shortHopVelocity: fx(1.643),
     airJumpVelocity: fx(2.356),
     jumps: 2,
     canWallJump: true,
+    // SmashWiki "Wall jump", Ultimate's height ranking: 30.45. (The page marks its
+    // Brawl-onward table for checking; it is the only published figure.)
+    wallJumpHeight: fx(30.45),
     width: fx(HALF_WIDTH),
     height: fx(HEIGHT),
     jumpSquatFrames: 3,
   },
```

- [ ] **Step 4: Run it again**

Run: `pnpm vitest run src/fighters/walljump.test.ts`
Expected: PASS (`src/fighters/walljump.test.ts` 6 tests).

- [ ] **Step 5: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0; golden trace untouched.

- [ ] **Step 6: Commit**

```bash
git add super-smash/src/engine/combat.ts super-smash/src/engine/hash.ts super-smash/src/engine/simulate.ts super-smash/src/engine/states.ts super-smash/src/engine/status/air.ts super-smash/src/engine/status/passive.ts super-smash/src/engine/types.ts super-smash/src/engine/wallJump.ts super-smash/src/fighters/fox.ts super-smash/src/fighters/mario.ts super-smash/src/fighters/pikachu.ts super-smash/src/fighters/samus.ts super-smash/src/fighters/walljump.test.ts
git commit -m "super-smash: wall jumps and wall tech jumps" -m "For the fighters SmashWiki lists as wall jumpers, at their published wall jump heights, x0.96 a repeat; windows and the push away UNVERIFIED. Golden trace unchanged." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Footstool jumps

SmashWiki (Footstool jump): jumping on an opponent's head jumps again (a full bounce: a short hop's damage penalty ends) and makes them `footstooled` (`TREAD_DAMAGE`: grounded, a short stun; airborne, pushed down into a tumble). Not within 16 frames of attacking (`FOOTSTOOL_AFTER_ATTACK`, `CombatState.sinceAttack`). Nobody who is held, carried or inside Kirby, nor anybody holding or carrying, invincible, intangible, hanging from a ledge, on the respawn platform or (Task 14) trapped in a Final Smash can be stood on; nor — a DECISION, UNVERIFIED — anybody in hitstun or hitlag, so a footstool never overwrites a launch. Who can be stood on is read from everybody's state **before** the state machines run (`footstoolHeads`), and what happens to the one stood on is applied **after** all of them (`applyFootstools`), so the result never depends on ports. The head is the top of the ECB: Plan 4's bone-derived one when the bake is installed, `attributes.height` otherwise. UNVERIFIED: the reach, stun and push.

**Files:**
- Create: `super-smash/src/engine/footstool.ts`, `super-smash/src/fighters/footstool.test.ts`
- Modify: `super-smash/src/engine/combat.ts`, `super-smash/src/engine/hash.ts`, `super-smash/src/engine/simulate.ts`, `super-smash/src/engine/states.ts`, `super-smash/src/engine/status/air.ts`, `super-smash/src/engine/status/damage.ts`, `super-smash/src/engine/status/groups.test.ts`, `super-smash/src/engine/status/kind.ts`, `super-smash/src/engine/status/status.test.ts`, `super-smash/src/engine/types.ts`, `super-smash/src/render/poses/timing.ts`
- Regenerate: `super-smash/public/bake/roster.bin.gz`, `super-smash/src/fighters/bake/digest.ts`

**Interfaces:**
- Consumes: jumps (Plan 2 `kineticAirJump`), `StateContext` (gains optional `defs`).
- Produces: `src/engine/footstool.ts`: `FOOTSTOOL_*` constants, `FootstoolHead`, `Footstool`, `footstoolable`, `footstoolHeads`, `headUnder`, `tryFootstool`, `applyFootstools`; `STATUS_TREAD_DAMAGE` (`status/damage.ts`); action `footstooled`; `CombatState.sinceAttack`; `StateContext.defs?`, `.heads?`, `.footstools?`.

- [ ] **Step 1: Write the failing tests**

`src/engine/status/groups.test.ts` — apply:

```diff
--- a/src/engine/status/groups.test.ts
+++ b/src/engine/status/groups.test.ts
@@ -111,8 +111,10 @@ const LEGACY_KINETIC: Readonly<Record<ActionState, KineticType>> = {
   techCeiling: "GROUND_STOP",
   // Plan 5, Task 8: Donkey Kong's carry, and the fighter carried.
   cargoCarry: "WALK",
   cargoHeld: "NONE",
+  // Plan 5, Task 11: stood on.
+  footstooled: "GROUND_STOP",
   // Plan 5, Task 9: Kirby's mouthful, the swallowed and the spat.
   inhaleHold: "WALK",
   swallowed: "NONE",
   spatStar: "NONE",
@@ -177,8 +179,10 @@ const MIGRATED = [
   "techCeiling",
   // Plan 5, Task 8
   "cargoCarry",
   "cargoHeld",
+  // Plan 5, Task 11
+  "footstooled",
   // Plan 5, Task 9
   "inhaleHold",
   "swallowed",
   "spatStar",
```

`src/engine/status/status.test.ts` — apply:

```diff
--- a/src/engine/status/status.test.ts
+++ b/src/engine/status/status.test.ts
@@ -70,10 +70,10 @@ const CTX = { def: {} as FighterDef, stage: { platforms: [] }, frame: 1, fighter
 describe("the status alias table", () => {
   it("names an SSBU-style kind for every replica action, one-to-one", () => {
     const actions = Object.keys(STATUS_KIND_OF_ACTION) as ActionState[];
     // 47 through Plan 3; Plan 5 adds Donkey Kong's carry and the carried, and
-    // Kirby's mouthful, the swallowed and the spat.
-    expect(actions).toHaveLength(52);
+    // Kirby's mouthful, the swallowed and the spat, and the footstooled.
+    expect(actions).toHaveLength(53);
     const kinds = new Set(actions.map((a) => STATUS_KIND_OF_ACTION[a]));
     expect(kinds.size).toBe(actions.length);
     for (const a of actions) expect(ACTION_OF_STATUS_KIND[STATUS_KIND_OF_ACTION[a]]).toBe(a);
   });
```

`src/fighters/footstool.test.ts` (new file):

```ts
/**
 * Footstool jumps, through the real `step()` (Plan 5, Task 11). SmashWiki
 * "Footstool Jump": jump over a head to bounce off it; no damage; a grounded
 * victim freezes, an airborne one tumbles (and can tech); not within 16 frames
 * of attacking; the jumper keeps their midair jump.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { fx } from "@/engine/fixed";
import { createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { Btn } from "@/engine/types";
import type { GameState, InputFrame, MatchRules } from "@/engine/types";
import { STAGES } from "@/stages";
import { FIGHTERS, fox } from "./index";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true };

beforeAll(() => {
  registerFighters(FIGHTERS);
  registerStages(STAGES);
});

/** Mario falling onto Fox's head; Fox standing, or in the air with him. */
function overHead(foxInAir = false): GameState {
  const s = createInitialState("finalDestination", [{ defId: "mario" }, { defId: "fox" }], RULES, 4);
  const foxY = foxInAir ? fx(40) : 0;
  Object.assign(s.fighters[1], { action: foxInAir ? "fall" : "stand", grounded: !foxInAir, platform: foxInAir ? -1 : 0, x: 0, y: foxY, vy: 0, intangible: 0 });
  const head = foxY + fox.attributes.height;
  Object.assign(s.fighters[0], { action: "fall", grounded: false, platform: -1, x: fx(1), y: head - fx(1), vy: fx(-1), intangible: 0, jumpsUsed: 1 });
  return s;
}

function run(s0: GameState, inputs: readonly InputFrame[]): GameState[] {
  let s = s0;
  let prev: [InputFrame, InputFrame] = [0, 0];
  const out: GameState[] = [];
  for (const i of inputs) {
    const now: [InputFrame, InputFrame] = [i, 0];
    s = step(s, now, { prevInputs: prev }).state;
    prev = now;
    out.push(s);
  }
  return out;
}

describe("footstool jumps", () => {
  it("bounce off a standing head, keep the midair jump, and freeze the one stood on", () => {
    const states = run(overHead(), [Btn.Jump, 0, 0, 0]);
    const [mario, foxNow] = states[0].fighters;
    expect(mario.action).toBe("jump");
    expect(mario.vy).toBeGreaterThan(0);
    expect(mario.jumpsUsed).toBe(1);
    expect(foxNow.action).toBe("footstooled");
    expect(foxNow.damage).toBe(0);
  });

  it("send an airborne victim tumbling down", () => {
    const states = run(overHead(true), [Btn.Jump, 0, 0]);
    expect(states[0].fighters[1].action).toBe("tumble");
    expect(states[2].fighters[1].vy).toBeLessThan(0);
  });

  it("wait 16 frames after an attack", () => {
    const s = overHead();
    s.fighters[0].combat.sinceAttack = 3;
    const states = run(s, [Btn.Jump, 0]);
    expect(states[0].fighters[1].action).not.toBe("footstooled");
  });

  it("need a head under the feet", () => {
    const s = overHead();
    s.fighters[0].x = fx(30);
    const states = run(s, [Btn.Jump, 0]);
    expect(states[0].fighters[1].action).toBe("stand");
    expect(states[0].fighters[0].jumpsUsed).toBe(2);
  });
});

/** Mario (port 0) dropping onto port 1's head; port 2, when given, is a third fighter. */
function stoolOn(victim: string, third?: string): GameState {
  const ids = third === undefined ? ["mario", victim] : ["mario", victim, third];
  const s = createInitialState("finalDestination", ids.map((defId) => ({ defId })), RULES, 4);
  const def = FIGHTERS.find((f) => f.id === victim)!;
  s.fighters.forEach((f, i) => Object.assign(f, { action: "stand", grounded: true, platform: 0, x: i === 2 ? fx(6) : 0, y: 0, vy: 0, intangible: 0 }));
  Object.assign(s.fighters[0], { action: "fall", grounded: false, platform: -1, x: fx(1), y: def.attributes.height - fx(1), vy: fx(-1), jumpsUsed: 1 });
  return s;
}

function step1(s: GameState, inputs: InputFrame[] = [Btn.Jump, 0, 0]): GameState {
  return step(s, inputs.slice(0, s.fighters.length), { prevInputs: s.fighters.map(() => 0) }).state;
}

describe("who cannot be stood on (Plan 5 review)", () => {
  const cases: [string, () => GameState][] = [
    ["a grabbed fighter", () => {
      const s = stoolOn("fox", "donkeyKong");
      Object.assign(s.fighters[1], { action: "grabbed", grabbedBy: 2 });
      Object.assign(s.fighters[2], { action: "grabHold", grabbing: 1 });
      return s;
    }],
    ["a fighter riding Donkey Kong's shoulders", () => {
      const s = stoolOn("fox", "donkeyKong");
      Object.assign(s.fighters[1], { action: "cargoHeld", grabbedBy: 2 });
      Object.assign(s.fighters[2], { action: "cargoCarry", grabbing: 1 });
      return s;
    }],
    ["a fighter holding a grab", () => {
      const s = stoolOn("fox", "mario");
      Object.assign(s.fighters[1], { action: "grabHold", grabbing: 2 });
      Object.assign(s.fighters[2], { action: "grabbed", grabbedBy: 1 });
      return s;
    }],
    ["Donkey Kong carrying cargo", () => {
      const s = stoolOn("donkeyKong", "fox");
      Object.assign(s.fighters[1], { action: "cargoCarry", grabbing: 2 });
      Object.assign(s.fighters[2], { action: "cargoHeld", grabbedBy: 1 });
      return s;
    }],
    ["a fighter inside Kirby", () => {
      const s = stoolOn("fox", "kirby");
      Object.assign(s.fighters[1], { action: "swallowed", grabbedBy: 2 });
      Object.assign(s.fighters[2], { action: "inhaleHold", grabbing: 1 });
      return s;
    }],
    ["a fighter on the respawn platform", () => {
      const s = stoolOn("fox");
      Object.assign(s.fighters[1], { action: "respawnPlatform", grounded: false, platform: -1 });
      return s;
    }],
    ["an invincible fighter", () => {
      const s = stoolOn("fox");
      s.fighters[1].invincible = 60;
      return s;
    }],
    ["a fighter in hitstun (DECISION, UNVERIFIED): the launch is not overwritten", () => {
      const s = stoolOn("fox");
      Object.assign(s.fighters[1], { action: "tumble", grounded: false, platform: -1, hitstun: 20, vx: fx(2), vy: fx(-1) });
      return s;
    }],
  ];
  for (const [name, make] of cases) {
    it(`not ${name}`, () => {
      const s0 = make();
      const before = { ...s0.fighters[1] };
      const after = step1(s0);
      // Mario's jump was his own midair jump, not a footstool...
      expect(after.fighters[0].jumpsUsed).toBe(2);
      // ...and the one under him is not footstooled.
      expect(after.fighters[1].action).not.toBe("footstooled");
      if (before.action === "tumble") {
        expect(after.fighters[1].vx).toBe(before.vx);
        expect(after.fighters[1].hitstun).toBe(before.hitstun - 1);
      }
    });
  }
});

describe("footstool details (Plan 5 review)", () => {
  it("ends a short hop's damage penalty: the bounce is a full jump", () => {
    const s = overHead();
    s.fighters[0].shortHop = true;
    const after = step1(s, [Btn.Jump, 0]);
    expect(after.fighters[0].action).toBe("jump");
    expect(after.fighters[0].jumpsUsed).toBe(1);
    expect(after.fighters[0].shortHop).toBe(false);
  });

  for (const airborne of [false, true]) {
    it(`comes out the same whichever port the jumper and the victim are on (victim ${airborne ? "in the air" : "standing"})`, () => {
      // The victim acts on the very frame it is stood on.
      const layout = (jumperFirst: boolean): GameState => {
        const s = createInitialState("finalDestination", jumperFirst ? [{ defId: "mario" }, { defId: "fox" }] : [{ defId: "fox" }, { defId: "mario" }], RULES, 4);
        const [j, v] = jumperFirst ? [s.fighters[0], s.fighters[1]] : [s.fighters[1], s.fighters[0]];
        const vy = airborne ? fx(40) : 0;
        Object.assign(v, { action: airborne ? "fall" : "stand", grounded: !airborne, platform: airborne ? -1 : 0, x: 0, y: vy, vy: 0, intangible: 0, facing: 1 });
        Object.assign(j, { action: "fall", grounded: false, platform: -1, x: fx(1), y: vy + fox.attributes.height - fx(1), vy: fx(-1), intangible: 0, jumpsUsed: 1 });
        return s;
      };
      const a = step1(layout(true), [Btn.Jump, Btn.Attack]);
      const b = step1(layout(false), [Btn.Attack, Btn.Jump]);
      const pick = (f: GameState["fighters"][number]) => [f.action, f.move, f.x, f.y, f.vx, f.vy, f.jumpsUsed, f.hitstun];
      expect(pick(a.fighters[0])).toEqual(pick(b.fighters[1]));
      expect(pick(a.fighters[1])).toEqual(pick(b.fighters[0]));
      expect(a.fighters[1].action).toBe(airborne ? "tumble" : "footstooled");
    });
  }
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/engine/status/groups.test.ts src/engine/status/status.test.ts src/fighters/footstool.test.ts`
Expected: FAIL — 7 failed | 27 passed — `expected 'attack' to be 'footstooled'`, `expected 'attack' to be 'tumble'`, `expected 'fall' to be 'tumble'`, `expected 2 to be 1` (the jump was a midair jump), the status tables (`expected [ 'stand', 'walk', 'dashStart', …(49) ] to have a length of 53 but got 52`; `groups.test.ts` one group short). The exclusion tests pass here only because nothing footstools yet; against the first draft of this task (no exclusions, applied inside the loop) 10 of them failed (`expected 1 to be 2`, `expected true to be false`, and the airborne port swap: hitstun 29 against 30).

- [ ] **Step 3: Implement**

`src/engine/combat.ts` — apply:

```diff
--- a/src/engine/combat.ts
+++ b/src/engine/combat.ts
@@ -70,8 +70,10 @@ export interface CombatState {
   /** Plan 5: frames since that touch. */
   wallFrames: number;
   /** Plan 5: wall jumps since last on the ground (each weaker, ×0.96). */
   wallJumps: number;
+  /** Plan 5: frames since this fighter last started an attack or special (a footstool waits 16). */
+  sinceAttack: number;
 }
 
 export function emptyCombat(): CombatState {
   return {
@@ -98,8 +100,9 @@ export function emptyCombat(): CombatState {
     ride: 0,
     wallSide: 0,
     wallFrames: 0,
     wallJumps: 0,
+    sinceAttack: 999,
   };
 }
 
 export function cloneCombat(c: CombatState): CombatState {
@@ -127,6 +130,7 @@ export function cloneCombat(c: CombatState): CombatState {
     ride: c.ride,
     wallSide: c.wallSide,
     wallFrames: c.wallFrames,
     wallJumps: c.wallJumps,
+    sinceAttack: c.sinceAttack,
   };
 }
```

`src/engine/footstool.ts` (new file):

```ts
/**
 * Footstool jumps (Plan 5, Task 11).
 *
 * SmashWiki "Footstool Jump": an airborne fighter over another's head "can
 * press the jump button to bounce off of the character's head"; "It does no
 * damage"; a grounded victim is "briefly" frozen, an airborne one is sent to
 * "tumble a set distance" (in Ultimate "teching is possible"); in Ultimate
 * "characters must wait for 16 frames after attacking before they can
 * footstool". Not published, so UNVERIFIED: the bounce (the jumper's own
 * full hop), the grounded freeze (`FOOTSTOOL_GROUND_FRAMES`) and the airborne
 * push (`FOOTSTOOL_AIR_SPEED` down, `FOOTSTOOL_AIR_STUN` frames of tumble).
 * The jump does not spend a midair jump.
 *
 * Who can be stood on is decided from everybody's state **before** anybody's
 * state machine runs this frame (`footstoolHeads`), and what happens to the
 * one stood on is applied **after** all of them have run (`applyFootstools`),
 * so the outcome never depends on which port is which. The head is the top of
 * the fighter's ECB: Plan 4's bone-derived one when the bake is installed,
 * else `attributes.height`.
 */

import { fx } from "./fixed";
import { jumpLaunchSpeed, kineticJump, kineticLaunch } from "./kinetic";
import { fighterParams } from "./params";
import { startAction } from "./states";
import type { Intent, StateContext } from "./states";
import type { ActionState, FighterState } from "./types";

/** SmashWiki: "characters must wait for 16 frames after attacking". */
export const FOOTSTOOL_AFTER_ATTACK = 16;
/** UNVERIFIED: how long a grounded fighter stays footstooled. */
export const FOOTSTOOL_GROUND_FRAMES = 30;
/** UNVERIFIED: an airborne fighter's push down, and its tumble. */
export const FOOTSTOOL_AIR_SPEED = fx(3);
export const FOOTSTOOL_AIR_STUN = 30;
/** UNVERIFIED: how far below a head's top a jumper's feet may be and still footstool. */
export const FOOTSTOOL_REACH = fx(4);

/** A fighter's head this frame, as the footstool reads it. */
export interface FootstoolHead {
  readonly port: number;
  readonly x: number;
  /** World y of the head's top. */
  readonly top: number;
  /** Half the body's width (the ECB's). */
  readonly half: number;
  /** Whether a jump may stand on it (`footstoolable`). */
  readonly open: boolean;
}

/** A footstool decided this frame: who jumped off whom. */
export interface Footstool {
  readonly jumper: number;
  readonly victim: number;
}

/** States nobody can be stood on in: not on the stage, or inside somebody. */
const NOT_STOOD_ON: ReadonlySet<ActionState> = new Set<ActionState>(["dead", "entering", "respawnPlatform", "swallowed", "spatStar"]);

/**
 * Can `f` be footstooled now? Not while hanging from a ledge, intangible or
 * invincible; not while held, carried or swallowed (`grabbedBy`) nor while
 * holding or carrying somebody (`grabbing`) — the pair moves as one; not
 * while frozen or reeling from a hit, so a footstool never overwrites a
 * launch (DECISION, UNVERIFIED: SmashWiki says nothing of footstooling a
 * fighter in hitstun).
 */
export function footstoolable(f: FighterState): boolean {
  if (NOT_STOOD_ON.has(f.action) || f.ledge !== null) return false;
  if (f.intangible > 0 || f.invincible > 0) return false;
  if (f.grabbedBy >= 0 || f.grabbing >= 0) return false;
  if (f.hitstun > 0 || f.hitlag > 0) return false;
  return true;
}

/** Everybody's head, read once before the state machines run. `ecbTop`/`ecbHalf` per port. */
export function footstoolHeads(fighters: readonly FighterState[], ecbTop: readonly number[], ecbHalf: readonly number[]): FootstoolHead[] {
  return fighters.map((f, i) => ({ port: f.port, x: f.x, top: f.y + ecbTop[i], half: ecbHalf[i], open: footstoolable(f) }));
}

/** The fighter whose head `f` is over, if any, from this frame's snapshot. */
export function headUnder(f: FighterState, ctx: StateContext): FootstoolHead | null {
  const heads = ctx.heads;
  if (heads === undefined) return null;
  const own = heads.find((h) => h.port === f.port);
  if (own === undefined) return null;
  for (const head of heads) {
    if (head.port === f.port || !head.open) continue;
    if (f.y <= head.top && f.y >= head.top - FOOTSTOOL_REACH && Math.abs(f.x - head.x) <= head.half + own.half) return head;
  }
  return null;
}

/**
 * From the air: jump pressed over a head. The jumper bounces now; what
 * happens to the one stood on waits for `applyFootstools`. Returns true if
 * it footstooled.
 */
export function tryFootstool(f: FighterState, intent: Intent, ctx: StateContext): boolean {
  if (!intent.jumpPressed || f.grounded || f.combat.sinceAttack < FOOTSTOOL_AFTER_ATTACK || ctx.footstools === undefined) return false;
  const head = headUnder(f, ctx);
  if (head === null) return false;
  const p = fighterParams(ctx.def);
  kineticJump(f, jumpLaunchSpeed(p.air_accel_y, p.jump_y));
  f.fastFalling = false;
  // A full bounce: the short hop's damage penalty ended with the hop.
  f.shortHop = false;
  startAction(f, "jump");
  ctx.footstools.push({ jumper: f.port, victim: head.port });
  return true;
}

/**
 * After every state machine has run: each fighter stood on this frame is
 * footstooled, once however many stood on them, unless what they did this
 * frame made them unfootstoolable after all.
 */
export function applyFootstools(fighters: readonly FighterState[], footstools: readonly Footstool[]): void {
  const victims = [...new Set(footstools.map((s) => s.victim))].sort((a, b) => a - b);
  for (const port of victims) {
    const victim = fighters[port];
    if (victim === undefined || !footstoolable(victim)) continue;
    if (victim.grounded) {
      startAction(victim, "footstooled");
    } else {
      startAction(victim, "tumble");
      victim.hitstun = FOOTSTOOL_AIR_STUN;
      kineticLaunch(victim, 0, -FOOTSTOOL_AIR_SPEED, FOOTSTOOL_AIR_SPEED);
    }
  }
}
```

`src/engine/hash.ts` — apply:

```diff
--- a/src/engine/hash.ts
+++ b/src/engine/hash.ts
@@ -186,8 +186,9 @@ export function mixCombat(h: number, c: CombatState): number {
   x = mixInt(x, c.ride);
   x = mixInt(x, c.wallSide);
   x = mixInt(x, c.wallFrames);
   x = mixInt(x, c.wallJumps);
+  x = mixInt(x, c.sinceAttack);
   return x;
 }
 
 /** The KineticModule energies, in declaration order. */
```

`src/engine/simulate.ts` — apply:

```diff
--- a/src/engine/simulate.ts
+++ b/src/engine/simulate.ts
@@ -138,8 +138,9 @@ import {
 } from "./kinetic";
 import { LEGACY_BONE_TABLE, type BoneTable } from "./acmd/bones";
 import { LEGACY_BAKE, type BakeTables } from "./acmd/bakeTables";
 import { bakedEcb, fighterHurtboxes } from "./acmd/hurtboxes";
+import { applyFootstools, footstoolHeads, type Footstool } from "./footstool";
 import { launchBefore, techOrBounce, updateTechInput } from "./tech";
 import { cloneCombat, emptyCombat } from "./combat";
 import {
   attackerShieldPushback,
@@ -560,13 +561,26 @@ export function step(
     updateInputTracking(f, input, prev);
     intents.push(interpretInput(f, input, prev));
   }
 
+  // Who can be stood on, read before anybody moves (Plan 5, `footstool.ts`):
+  // the head is the ECB's top — the bones' with a bake (Plan 4), else the
+  // fighter's height.
+  const ecbs = s.fighters.map((f, i) => bakedEcb(defs[i], f, s.frame, bake, bones) ?? ecbOf(f, defs[i].attributes));
+  const heads = footstoolHeads(
+    s.fighters,
+    ecbs.map((e) => e.top),
+    ecbs.map((e) => e.half),
+  );
+  const footstools: Footstool[] = [];
   const stateCtx = (i: number): StateContext => ({
     def: defs[i],
     stage,
     frame: s.frame,
     fighters: s.fighters,
+    defs,
+    heads,
+    footstools,
   });
 
   /* -- 3. action state machines ------------------------------------------- */
 
@@ -585,8 +599,12 @@ export function step(
 
     // Tech input counts on every frame, frozen or not (Plan 3, Task 12).
     updateTechInput(f, intent);
     if (f.combat.copy !== "" && f.combat.copyFrames < COPY_GRACE_FRAMES) f.combat.copyFrames += 1;
+    // Frames since the last attack, for the footstool's wait; capped like
+    // `framesSinceDirPress` (Plan 5).
+    if (f.action === "attack" || f.action === "special") f.combat.sinceAttack = 0;
+    else if (f.combat.sinceAttack < 999) f.combat.sinceAttack += 1;
     // A wall touch counts for a few frames, and not at all on the ground (Plan 5).
     if (f.combat.wallSide !== 0) {
       f.combat.wallFrames += 1;
       if (f.grounded || f.combat.wallFrames > WALL_CONTACT_MEMORY) f.combat.wallSide = 0;
@@ -628,8 +646,10 @@ export function step(
     if (before === "jumpSquat" && f.action === "jump") {
       events.jumps.push({ port: f.port, x: f.x, y: f.y });
     }
   }
+  // Whoever was stood on is footstooled now, whatever their port (Plan 5).
+  applyFootstools(s.fighters, footstools);
 
   /* -- 4. physics ---------------------------------------------------------- */
 
   const preIntegrate = s.fighters.map((f) => ({ x: f.x, y: f.y }));
```

`src/engine/states.ts` — apply:

```diff
--- a/src/engine/states.ts
+++ b/src/engine/states.ts
@@ -67,8 +67,9 @@ import {
 } from "./kinetic";
 import { fighterParams } from "./params";
 import { STATUS_TABLE, changeStatus } from "./status/kind";
 import { Btn, held, pressed, released, stickX, stickY } from "./types";
+import type { Footstool, FootstoolHead } from "./footstool";
 import type {
   ActionState,
   BufferedAction,
   FighterDef,
@@ -337,8 +338,14 @@ export interface StateContext {
    * state machine has to be able to reach the other fighter. Nothing else here
    * writes to it. See `releaseGrab`.
    */
   readonly fighters: readonly FighterState[];
+  /** Everybody's definitions, by port (Plan 5). */
+  readonly defs?: readonly FighterDef[];
+  /** Everybody's head as it was before this frame's state machines ran (Plan 5, `footstool.ts`). */
+  readonly heads?: readonly FootstoolHead[];
+  /** Footstools decided this frame, applied to their victims after every state machine has run. */
+  readonly footstools?: Footstool[];
 }
 
 /** Change status through the StatusModule (`status/kind.ts`): end, reset, pre. */
 export function startAction(f: FighterState, action: ActionState): void {
```

`src/engine/status/air.ts` — apply:

```diff
--- a/src/engine/status/air.ts
+++ b/src/engine/status/air.ts
@@ -9,8 +9,9 @@ import { JUMP_SQUAT_FRAMES } from "../constants";
 import { kineticGroundJump, kineticSetY } from "../kinetic";
 import { fighterParams } from "../params";
 import { fastFallVelocity } from "../physics";
 import { tryWallJump } from "../wallJump";
+import { tryFootstool } from "../footstool";
 import {
   LANDING_ANIMATION_FRAMES,
   bufferPress,
   handleActionable,
@@ -56,10 +57,12 @@ function airMain(f: FighterState, intent: Intent, ctx: StateContext): void {
   if (f.grounded) {
     startAction(f, "land");
     return;
   }
-  // A fresh press away from a wall just touched (Plan 5, `wallJump.ts`).
+  // A fresh press away from a wall just touched (Plan 5, `wallJump.ts`), or a
+  // jump over somebody's head (`footstool.ts`).
   if (tryWallJump(f, intent, ctx)) return;
+  if (tryFootstool(f, intent, ctx)) return;
   if (handleActionable(f, intent, ctx)) return;
   // Fast fall is only available after the apex, which makes it a read on the
   // defender rather than a free way to shorten every jump.
   if (intent.downPressed && !f.fastFalling && f.vy <= 0 && f.hitstun === 0) {
```

`src/engine/status/damage.ts` — apply:

```diff
--- a/src/engine/status/damage.ts
+++ b/src/engine/status/damage.ts
@@ -3,8 +3,9 @@
  *
  * `main` bodies are the legacy `advanceFighter` cases, moved verbatim.
  */
 
+import { FOOTSTOOL_GROUND_FRAMES } from "../footstool";
 import {
   HITSTUN_CANCEL_AERIAL_FRAME,
   HITSTUN_CANCEL_AERIAL_SPEED,
   HITSTUN_CANCEL_AIR_DODGE_FRAME,
@@ -107,9 +108,20 @@ export const STATUS_DOWN_STAND: FighterStatus = {
     else bufferPress(f, intent, ctx.frame);
   },
 };
 
+/** Stood on by a footstool jump, on the ground (Plan 5, `footstool.ts`). */
+export const STATUS_TREAD_DAMAGE: FighterStatus = {
+  kind: "FIGHTER_STATUS_KIND_TREAD_DAMAGE",
+  action: "footstooled",
+  kineticType: "GROUND_STOP",
+  main(f) {
+    if (f.actionFrame >= FOOTSTOOL_GROUND_FRAMES) startAction(f, f.grounded ? "stand" : "fall");
+  },
+};
+
 export const DAMAGE_STATUSES: readonly FighterStatus[] = [
+  STATUS_TREAD_DAMAGE,
   STATUS_DAMAGE,
   STATUS_DAMAGE_FLY,
   STATUS_DOWN_WAIT,
   STATUS_DOWN_STAND,
```

`src/engine/status/kind.ts` — apply:

```diff
--- a/src/engine/status/kind.ts
+++ b/src/engine/status/kind.ts
@@ -67,8 +67,9 @@ export type StatusKind =
   | "FIGHTER_STATUS_KIND_CLIFF_ROBBED"
   // Plan 5. SSBU's fighter-specific kind keeps its fighter in the name.
   | "FIGHTER_DONKEY_STATUS_KIND_SHOULDER_WAIT"
   | "FIGHTER_STATUS_KIND_SHOULDERED_DONKEY"
+  | "FIGHTER_STATUS_KIND_TREAD_DAMAGE"
   | "FIGHTER_KIRBY_STATUS_KIND_SPECIAL_N_EAT_WAIT"
   | "FIGHTER_STATUS_KIND_SWALLOWED"
   | "FIGHTER_STATUS_KIND_SWALLOWED_THROWN_STAR"
   | "FIGHTER_STATUS_KIND_REBIRTH"
@@ -122,8 +123,9 @@ export const STATUS_KIND_OF_ACTION: Readonly<Record<ActionState, StatusKind>> =
   ledgeJump: "FIGHTER_STATUS_KIND_CLIFF_JUMP1",
   ledgeTrumped: "FIGHTER_STATUS_KIND_CLIFF_ROBBED",
   cargoCarry: "FIGHTER_DONKEY_STATUS_KIND_SHOULDER_WAIT",
   cargoHeld: "FIGHTER_STATUS_KIND_SHOULDERED_DONKEY",
+  footstooled: "FIGHTER_STATUS_KIND_TREAD_DAMAGE",
   inhaleHold: "FIGHTER_KIRBY_STATUS_KIND_SPECIAL_N_EAT_WAIT",
   swallowed: "FIGHTER_STATUS_KIND_SWALLOWED",
   spatStar: "FIGHTER_STATUS_KIND_SWALLOWED_THROWN_STAR",
   respawnPlatform: "FIGHTER_STATUS_KIND_REBIRTH",
```

`src/engine/types.ts` — apply:

```diff
--- a/src/engine/types.ts
+++ b/src/engine/types.ts
@@ -130,8 +130,10 @@ export type ActionState =
   | "ledgeTrumped"
   // carried (Plan 5)
   | "cargoCarry"
   | "cargoHeld"
+  // stood on (Plan 5)
+  | "footstooled"
   // Kirby's Inhale (Plan 5)
   | "inhaleHold"
   | "swallowed"
   | "spatStar"
```

`src/render/poses/timing.ts` — apply:

```diff
--- a/src/render/poses/timing.ts
+++ b/src/render/poses/timing.ts
@@ -251,10 +251,11 @@ export function poseNameFor(f: Pick<PosedFighter, "action" | "move" | "jumpsUsed
     case "techWall":
     case "techCeiling":
       return "tumble";
     case "grabbed":
-    // Plan 5: carried on the shoulders, still held.
+    // Plan 5: carried on the shoulders, still held; stood on.
     case "cargoHeld":
+    case "footstooled":
       return "grabbed";
     // Plan 5: walking with the cargo, or with a mouthful; the walk clip reads as either.
     case "cargoCarry":
     case "inhaleHold":
```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/engine/status/groups.test.ts src/engine/status/status.test.ts src/fighters/footstool.test.ts`
Expected: PASS (`src/fighters/footstool.test.ts` 7 tests).

- [ ] **Step 5: Regenerate the generated files, in this order**

Each command rewrites one artefact from the code; the order matters (the limb list feeds the reconcile list and the bake, the bake feeds reach). Then review each diff against the scratch result below.

```bash
UPDATE_BAKE=1 pnpm vitest run src/render3d/bake/roster.test.ts
```

`src/fighters/bake/digest.ts` — the bake's new digest:

```diff
--- a/src/fighters/bake/digest.ts
+++ b/src/fighters/bake/digest.ts
@@ -1,5 +1,5 @@
 // GENERATED by src/render3d/bake/roster.test.ts (UPDATE_BAKE=1) — do not edit by hand.
 /** SHA-256 of the uncompressed public/bake/roster.bin.gz: the bake's fingerprint. */
-export const BAKE_DIGEST = "29b841323955506e88627c17fdd2bd627eb89c961d54d661c02f1a21c284b48b";
+export const BAKE_DIGEST = "4f24940f3988ccbe93099bb22eee4b1596caab4361ff435e02ea0adb9529c306";
 /** Its uncompressed length in bytes. */
-export const BAKE_BYTES = 5760498;
+export const BAKE_BYTES = 5795026;
```

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0; golden trace untouched.

- [ ] **Step 7: Commit**

```bash
git add super-smash/public/bake/roster.bin.gz super-smash/src/engine/combat.ts super-smash/src/engine/footstool.ts super-smash/src/engine/hash.ts super-smash/src/engine/simulate.ts super-smash/src/engine/states.ts super-smash/src/engine/status/air.ts super-smash/src/engine/status/damage.ts super-smash/src/engine/status/groups.test.ts super-smash/src/engine/status/kind.ts super-smash/src/engine/status/status.test.ts super-smash/src/engine/types.ts super-smash/src/fighters/bake/digest.ts super-smash/src/fighters/footstool.test.ts super-smash/src/render/poses/timing.ts
git commit -m "super-smash: footstool jumps" -m "A jump on a head jumps again (a full bounce) and footstools the victim (SmashWiki); never a held, holding, swallowed, invincible, respawning or reeling fighter (the last a decision, UNVERIFIED); decided before and applied after the state machines, so ports do not matter; the head is the bone ECB's top with a bake. Reach, stun and push UNVERIFIED. Bake regenerated (footstooled status). Golden trace unchanged." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Pikachu crawls

SmashWiki (Crawling): of the eight, only Pikachu crawls, at the default 0.7 forward and 0.5 back, still facing forward; an attack out of a crawl is the down tilt.

**Files:**
- Create: `super-smash/src/fighters/crawl.test.ts`
- Modify: `super-smash/src/engine/constants.ts`, `super-smash/src/engine/states.ts`, `super-smash/src/engine/status/ground.ts`, `super-smash/src/engine/status/groups.test.ts`, `super-smash/src/engine/status/kind.ts`, `super-smash/src/engine/status/status.test.ts`, `super-smash/src/engine/types.ts`, `super-smash/src/fighters/pikachu.ts`, `super-smash/src/render/poses/timing.ts`
- Regenerate: `super-smash/public/bake/roster.bin.gz`, `super-smash/src/fighters/bake/digest.ts`

**Interfaces:**
- Consumes: crouch statuses (Plan 2 `status/ground.ts`).
- Produces: `FighterAttributes.canCrawl?`; `STATUS_SQUAT_F`; action `crawl`; `CRAWL_FORWARD_SPEED`, `CRAWL_BACK_SPEED` (constants.ts).

- [ ] **Step 1: Write the failing tests**

`src/engine/status/groups.test.ts` — apply:

```diff
--- a/src/engine/status/groups.test.ts
+++ b/src/engine/status/groups.test.ts
@@ -111,8 +111,10 @@ const LEGACY_KINETIC: Readonly<Record<ActionState, KineticType>> = {
   techCeiling: "GROUND_STOP",
   // Plan 5, Task 8: Donkey Kong's carry, and the fighter carried.
   cargoCarry: "WALK",
   cargoHeld: "NONE",
+  // Plan 5, Task 12: crawling.
+  crawl: "WALK",
   // Plan 5, Task 11: stood on.
   footstooled: "GROUND_STOP",
   // Plan 5, Task 9: Kirby's mouthful, the swallowed and the spat.
   inhaleHold: "WALK",
@@ -179,8 +181,10 @@ const MIGRATED = [
   "techCeiling",
   // Plan 5, Task 8
   "cargoCarry",
   "cargoHeld",
+  // Plan 5, Task 12
+  "crawl",
   // Plan 5, Task 11
   "footstooled",
   // Plan 5, Task 9
   "inhaleHold",
```

`src/engine/status/status.test.ts` — apply:

```diff
--- a/src/engine/status/status.test.ts
+++ b/src/engine/status/status.test.ts
@@ -70,10 +70,10 @@ const CTX = { def: {} as FighterDef, stage: { platforms: [] }, frame: 1, fighter
 describe("the status alias table", () => {
   it("names an SSBU-style kind for every replica action, one-to-one", () => {
     const actions = Object.keys(STATUS_KIND_OF_ACTION) as ActionState[];
     // 47 through Plan 3; Plan 5 adds Donkey Kong's carry and the carried, and
-    // Kirby's mouthful, the swallowed and the spat, and the footstooled.
-    expect(actions).toHaveLength(53);
+    // Kirby's mouthful, the swallowed and the spat, the footstooled and the crawl.
+    expect(actions).toHaveLength(54);
     const kinds = new Set(actions.map((a) => STATUS_KIND_OF_ACTION[a]));
     expect(kinds.size).toBe(actions.length);
     for (const a of actions) expect(ACTION_OF_STATUS_KIND[STATUS_KIND_OF_ACTION[a]]).toBe(a);
   });
```

`src/fighters/crawl.test.ts` (new file):

```ts
/**
 * Crawling (Plan 5, Task 12). SmashWiki "Crawling": of the eight only Pikachu
 * crawls, at the default 0.7 forward and 0.5 back; a crawl's attack is the
 * down tilt.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { fx, toFloat } from "@/engine/fixed";
import { createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { Btn } from "@/engine/types";
import type { GameState, InputFrame, MatchRules } from "@/engine/types";
import { STAGES } from "@/stages";
import { FIGHTERS } from "./index";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: false };

beforeAll(() => {
  registerFighters(FIGHTERS);
  registerStages(STAGES);
});

function standing(defId: string): GameState {
  const s = createInitialState("finalDestination", [{ defId }], RULES, 2);
  Object.assign(s.fighters[0], { action: "stand", grounded: true, platform: 0, x: 0, y: 0, facing: 1, intangible: 0 });
  return s;
}

function run(s0: GameState, inputs: readonly InputFrame[]): GameState[] {
  let s = s0;
  let prev: InputFrame = 0;
  const out: GameState[] = [];
  for (const i of inputs) {
    s = step(s, [i], { prevInputs: [prev] }).state;
    prev = i;
    out.push(s);
  }
  return out;
}

const CROUCH: InputFrame[] = Array<InputFrame>(12).fill(Btn.Down);

describe("crawling", () => {
  it("Pikachu crawls forward at 0.7 and back at 0.5, still facing forward", () => {
    const fwd = run(standing("pikachu"), [...CROUCH, ...Array<InputFrame>(10).fill(Btn.Down | Btn.Right)]);
    expect(fwd[fwd.length - 1].fighters[0].action).toBe("crawl");
    expect(toFloat(fwd[fwd.length - 1].fighters[0].vx)).toBeCloseTo(0.7, 3);
    const back = run(standing("pikachu"), [...CROUCH, ...Array<InputFrame>(10).fill(Btn.Down | Btn.Left)]);
    expect(toFloat(back[back.length - 1].fighters[0].vx)).toBeCloseTo(-0.5, 3);
    expect(back[back.length - 1].fighters[0].facing).toBe(1);
  });

  it("down tilts out of a crawl", () => {
    const states = run(standing("pikachu"), [...CROUCH, ...Array<InputFrame>(6).fill(Btn.Down | Btn.Right), Btn.Down | Btn.Right | Btn.Attack]);
    expect(states[states.length - 1].fighters[0].move).toBe("dtilt");
  });

  it("is Pikachu's alone: Mario stays crouched", () => {
    const states = run(standing("mario"), [...CROUCH, ...Array<InputFrame>(10).fill(Btn.Down | Btn.Right)]);
    expect(states[states.length - 1].fighters[0].action).toBe("crouch");
    expect(states[states.length - 1].fighters[0].x).toBe(fx(0));
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/engine/status/groups.test.ts src/engine/status/status.test.ts src/fighters/crawl.test.ts`
Expected: FAIL — 3 failed | 19 passed — `expected 'crouch' to be 'crawl'`, and the status tables (`to have a length of 54 but got 53`, `groups.test.ts` one group short).

- [ ] **Step 3: Implement**

`src/engine/constants.ts` — apply:

```diff
--- a/src/engine/constants.ts
+++ b/src/engine/constants.ts
@@ -401,8 +401,16 @@ export const RESPAWN_PLATFORM_FRAMES = 300;
 /** Minimum invincibility on leaving it — granted if you waited the full time. */
 export const RESPAWN_INVINCIBILITY_MIN = 60;
 export const RESPAWN_INVINCIBILITY_MAX = 180;
 
+/**
+ * Crawling speeds (Plan 5). SmashWiki "Crawling": the default "forward crawl
+ * speed of 0.7 and a backward crawl speed of 0.5 with a few exceptions";
+ * Pikachu is not listed as an exception (UNVERIFIED: no Pikachu value).
+ */
+export const CRAWL_FORWARD_SPEED = fx(0.7);
+export const CRAWL_BACK_SPEED = fx(0.5);
+
 /** Smash Ball: 40 HP, decaying 2 every 60 frames on its own. */
 export const SMASH_BALL_HEALTH = fx(40);
 export const SMASH_BALL_DECAY = fx(2);
 export const SMASH_BALL_DECAY_INTERVAL = 60;
```

`src/engine/states.ts` — apply:

```diff
--- a/src/engine/states.ts
+++ b/src/engine/states.ts
@@ -426,9 +426,9 @@ export function updateDodgeIntangibility(f: FighterState, def?: FighterDef): voi
 
 /** Which ground attack a direction means. Smash direction wins over held direction. */
 export function groundAttackSlot(f: FighterState, intent: Intent): MoveSlot {
   if (f.action === "run" || f.action === "dashStart") return "dashAttack";
-  if (f.action === "crouch" || f.action === "crouchStart") return "dtilt";
+  if (f.action === "crouch" || f.action === "crouchStart" || f.action === "crawl") return "dtilt";
   if (intent.smash) {
     if (intent.smashX !== 0) return "fsmash";
     if (intent.smashY > 0) return "usmash";
     if (intent.smashY < 0) return "dsmash";
```

`src/engine/status/ground.ts` — apply:

```diff
--- a/src/engine/status/ground.ts
+++ b/src/engine/status/ground.ts
@@ -6,9 +6,10 @@
  * WALK, DASH and RUN share one `main`, as they shared one case: the
  * walk/dash/run ladder is a single decision read from the same input.
  */
 
-import { DASH_INTERRUPT_FRAME } from "../constants";
+import { CRAWL_BACK_SPEED, CRAWL_FORWARD_SPEED, DASH_INTERRUPT_FRAME } from "../constants";
+import { kineticSum } from "../kinetic";
 import {
   CROUCH_END_FRAMES,
   CROUCH_START_FRAMES,
   RUN_BRAKE_FRAMES,
@@ -142,8 +143,26 @@ export const STATUS_SQUAT_WAIT: FighterStatus = {
   kineticType: "GROUND_STOP",
   main(f, intent, ctx) {
     if (handleActionable(f, intent, ctx)) return;
     if (intent.y >= 0) startAction(f, "crouchEnd");
+    // Down and to the side crawls, for the fighters who can (Plan 5).
+    else if (intent.x !== 0 && ctx.def.attributes.canCrawl === true) startAction(f, "crawl");
+  },
+};
+
+/** Crawling (Plan 5): forward 0.7, back 0.5 (SmashWiki "Crawling"); attacks are down tilts. */
+export const STATUS_SQUAT_F: FighterStatus = {
+  kind: "FIGHTER_STATUS_KIND_SQUAT_F",
+  action: "crawl",
+  kineticType: "WALK",
+  main(f, intent, ctx) {
+    if (handleActionable(f, intent, ctx)) return;
+    if (intent.y >= 0) startAction(f, "crouchEnd");
+    else if (intent.x === 0) startAction(f, "crouch");
+  },
+  exec(f, intent) {
+    f.kinetic.controlX = intent.x === 0 ? 0 : intent.x * (intent.x === f.facing ? CRAWL_FORWARD_SPEED : CRAWL_BACK_SPEED);
+    kineticSum(f);
   },
 };
 
 export const STATUS_SQUAT_RV: FighterStatus = {
@@ -164,5 +183,6 @@ export const GROUND_STATUSES: readonly FighterStatus[] = [
   STATUS_TURN_RUN,
   STATUS_SQUAT,
   STATUS_SQUAT_WAIT,
   STATUS_SQUAT_RV,
+  STATUS_SQUAT_F,
 ];
```

`src/engine/status/kind.ts` — apply:

```diff
--- a/src/engine/status/kind.ts
+++ b/src/engine/status/kind.ts
@@ -29,8 +29,9 @@ export type StatusKind =
   | "FIGHTER_STATUS_KIND_TURN_RUN"
   | "FIGHTER_STATUS_KIND_SQUAT"
   | "FIGHTER_STATUS_KIND_SQUAT_WAIT"
   | "FIGHTER_STATUS_KIND_SQUAT_RV"
+  | "FIGHTER_STATUS_KIND_SQUAT_F"
   | "FIGHTER_STATUS_KIND_JUMP_SQUAT"
   | "FIGHTER_STATUS_KIND_JUMP"
   | "FIGHTER_STATUS_KIND_FALL"
   | "FIGHTER_STATUS_KIND_LANDING"
@@ -86,8 +87,10 @@ export const STATUS_KIND_OF_ACTION: Readonly<Record<ActionState, StatusKind>> =
   turnaround: "FIGHTER_STATUS_KIND_TURN_RUN",
   crouchStart: "FIGHTER_STATUS_KIND_SQUAT",
   crouch: "FIGHTER_STATUS_KIND_SQUAT_WAIT",
   crouchEnd: "FIGHTER_STATUS_KIND_SQUAT_RV",
+  // Plan 5. SSBU splits crawling forward (SQUAT_F) and back (SQUAT_B); one status here.
+  crawl: "FIGHTER_STATUS_KIND_SQUAT_F",
   jumpSquat: "FIGHTER_STATUS_KIND_JUMP_SQUAT",
   jump: "FIGHTER_STATUS_KIND_JUMP",
   fall: "FIGHTER_STATUS_KIND_FALL",
   land: "FIGHTER_STATUS_KIND_LANDING",
```

`src/engine/types.ts` — apply:

```diff
--- a/src/engine/types.ts
+++ b/src/engine/types.ts
@@ -86,8 +86,9 @@ export type ActionState =
   | "turnaround"
   | "crouchStart"
   | "crouch"
   | "crouchEnd"
+  | "crawl"
   // airborne
   | "jumpSquat"
   | "jump"
   | "fall"
@@ -510,8 +511,10 @@ export interface FighterAttributes {
    * jump height rankings", Ultimate). Absent: the fighter's air jump height —
    * UNVERIFIED, for the wall tech jumps of fighters with no published height.
    */
   readonly wallJumpHeight?: number;
+  /** Can crawl out of a crouch (Plan 5; SmashWiki "Crawling": Pikachu, of the eight). */
+  readonly canCrawl?: boolean;
   /** Half-width and height of the fighter's hurtbox, fixed. */
   readonly width: number;
   readonly height: number;
   /** Frames of jumpsquat. Universally 3 in Ultimate. */
```

`src/fighters/pikachu.ts` — apply:

```diff
--- a/src/fighters/pikachu.ts
+++ b/src/fighters/pikachu.ts
@@ -58,8 +58,10 @@ const legacy: FighterDef = {
     canWallJump: true,
     // SmashWiki "Wall jump", Ultimate's height ranking: 36.89. (The page marks its
     // Brawl-onward table for checking; it is the only published figure.)
     wallJumpHeight: fx(36.89),
+    // SmashWiki "Crawling": Pikachu is the one of the eight who crawls (Plan 5).
+    canCrawl: true,
     width: fx(HALF_WIDTH),
     height: fx(HEIGHT),
     jumpSquatFrames: 3,
   },
```

`src/render/poses/timing.ts` — apply:

```diff
--- a/src/render/poses/timing.ts
+++ b/src/render/poses/timing.ts
@@ -199,8 +199,10 @@ export function poseNameFor(f: Pick<PosedFighter, "action" | "move" | "jumpsUsed
       return "turn";
     case "crouchStart":
       return "crouchStart";
     case "crouch":
+    // Plan 5: a crawl is a crouch on the move.
+    case "crawl":
       return "crouch";
     case "crouchEnd":
       return "crouchEnd";
     case "getUp":
```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/engine/status/groups.test.ts src/engine/status/status.test.ts src/fighters/crawl.test.ts`
Expected: PASS (`src/fighters/crawl.test.ts` 3 tests).

- [ ] **Step 5: Regenerate the generated files, in this order**

Each command rewrites one artefact from the code; the order matters (the limb list feeds the reconcile list and the bake, the bake feeds reach). Then review each diff against the scratch result below.

```bash
UPDATE_BAKE=1 pnpm vitest run src/render3d/bake/roster.test.ts
```

`src/fighters/bake/digest.ts` — the bake's new digest:

```diff
--- a/src/fighters/bake/digest.ts
+++ b/src/fighters/bake/digest.ts
@@ -1,5 +1,5 @@
 // GENERATED by src/render3d/bake/roster.test.ts (UPDATE_BAKE=1) — do not edit by hand.
 /** SHA-256 of the uncompressed public/bake/roster.bin.gz: the bake's fingerprint. */
-export const BAKE_DIGEST = "4f24940f3988ccbe93099bb22eee4b1596caab4361ff435e02ea0adb9529c306";
+export const BAKE_DIGEST = "213935531126717011126b85910e3a0d5fc7de1a89990861ace4a578e8d230da";
 /** Its uncompressed length in bytes. */
-export const BAKE_BYTES = 5795026;
+export const BAKE_BYTES = 5947026;
```

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0; golden trace untouched.

- [ ] **Step 7: Commit**

```bash
git add super-smash/public/bake/roster.bin.gz super-smash/src/engine/constants.ts super-smash/src/engine/states.ts super-smash/src/engine/status/ground.ts super-smash/src/engine/status/groups.test.ts super-smash/src/engine/status/kind.ts super-smash/src/engine/status/status.test.ts super-smash/src/engine/types.ts super-smash/src/fighters/bake/digest.ts super-smash/src/fighters/crawl.test.ts super-smash/src/fighters/pikachu.ts super-smash/src/render/poses/timing.ts
git commit -m "super-smash: Pikachu crawls" -m "0.7 forward, 0.5 back, down tilt out of it (SmashWiki); the other seven stay crouched. Bake regenerated. Golden trace unchanged." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Momentum, projectile, armour and charge moves run their scripts

Plan 3 left on their legacy moves any move with scripted momentum, a projectile, super armour or a smash charge, "until the energies and the charge read the script" (Plan 3's note: Plan 5 activates them by dropping `activatable` clauses). `acmd/run.ts` now falls back to the legacy move's momentum, armour, spawns and smash-hold frame where the script publishes none, so those clauses go. What the script cannot carry keeps a move on its legacy frames — `PLAN5_BEHAVIOUR`: a charge loop, a reflector or counter window, a mouthful, a carry, a stall, the move's own intangibility, a throw's turn, a copied move's damage (Tasks 14 and 16 add a Final Smash phase and a rehit). `generate_article` of a projectile the roster defines (Mario's FIREBALL, Pikachu's DENGEKIDAMA) is lifted to `spawnProjectile`. Mario's fireball clip is re-timed (16 of 42).

**Files:**
- Create: `super-smash/src/fighters/acmd/activate.test.ts`
- Modify: `super-smash/src/engine/acmd/run.ts`, `super-smash/src/engine/simulate.ts`, `super-smash/src/engine/states.ts`, `super-smash/src/engine/status/attack.ts`, `super-smash/src/fighters/acmd/active.ts`, `super-smash/src/fighters/acmd/lift.ts`, `super-smash/src/render/chars/mario/poses.ts`
- Regenerate: `super-smash/public/bake/roster.bin.gz`, `super-smash/src/fighters/acmd/limb.json`, `super-smash/src/fighters/acmd/reach.allow.json`, `super-smash/src/fighters/acmd/reconcile.allow.json`, `super-smash/src/fighters/bake/digest.ts`, `super-smash/src/game/__golden__/engine-trace.json`

**Interfaces:**
- Consumes: `liftScript` (Task 7), `activatable`, `LIMB_SCRIPT_SLOTS` (Plans 3–4).
- Produces: `moveMomentum`, `moveSuperArmour`, `moveSpawns`, `smashHoldFrame` (`acmd/run.ts`); `ARTICLE_PROJECTILES` (`lift.ts`); `PLAN5_BEHAVIOUR` (exported); `ACTIVE_SCRIPT_SLOTS` + Mario dsmash/neutralB, Pikachu fsmash/dsmash/neutralB.

- [ ] **Step 1: Write the failing test**

`src/fighters/acmd/activate.test.ts` (new file):

```ts
/**
 * Moves freed by Plan 5, Task 13: a move with momentum, projectiles, armour
 * or a smash charge may now run its imported script, because the engine reads
 * those from the script — or from the legacy move where the script publishes
 * nothing (`engine/acmd/run.ts`).
 */

import { describe, expect, it } from "vitest";

import { moveMomentum, moveScriptFrame, moveSpawns, moveSuperArmour, smashHoldFrame } from "@/engine/acmd/run";
import { fx } from "@/engine/fixed";
import { createInitialState, step } from "@/engine/simulate";
import type { SimContext } from "@/engine/simulate";
import { Btn } from "@/engine/types";
import type { GameState, InputFrame, MoveSlot } from "@/engine/types";
import { STAGES } from "@/stages";
import { FIGHTERS, donkeyKong, mario, pikachu } from "../index";
import { ACTIVE_SCRIPT_SLOTS, PLAN5_BEHAVIOUR, activatable } from "./active";
import { ARTICLE_PROJECTILES, liftScript } from "./lift";
import { REFERENCE_SCRIPTS } from "./index";

const ctx: SimContext = { fighter: (id) => FIGHTERS.find((f) => f.id === id)!, stage: (id) => STAGES.find((s) => s.id === id)! };

const at = (move: MoveSlot, actionFrame: number) => ({ move, actionFrame });

describe("the freed moves", () => {
  it("now include Mario's Fireball and down smash, Pikachu's Thunder Jolt and smashes", () => {
    expect(ACTIVE_SCRIPT_SLOTS.mario).toEqual(expect.arrayContaining(["neutralB", "dsmash"]));
    expect(ACTIVE_SCRIPT_SLOTS.pikachu).toEqual(expect.arrayContaining(["neutralB", "fsmash", "dsmash"]));
  });

  it("launch a mapped article on the script's own frame (Pikachu: frame 19)", () => {
    expect(ARTICLE_PROJECTILES.FIGHTER_PIKACHU_GENERATE_ARTICLE_DENGEKIDAMA).toBe("thunderJolt");
    expect(pikachu.scripts?.neutralB).toBe(liftScript(REFERENCE_SCRIPTS.pikachu.scripts.game_specialn));
    const spawnsAt = (g: number) => moveSpawns(pikachu, { move: "neutralB" }, moveScriptFrame(pikachu, at("neutralB", g - 1))!);
    expect(spawnsAt(18)).toEqual([]);
    expect(spawnsAt(19)).toEqual(["thunderJolt"]);
  });

  it("hold a smash charge where the script raises START_SMASH_HOLD (Pikachu's forward smash: frame 10)", () => {
    expect(smashHoldFrame(pikachu, { move: "fsmash" })).toBe(9);
  });

  it("keep a legacy move's momentum when the script publishes none, and its armour when the script says nothing", () => {
    // A move running a compiled legacy script carries both as commands; check the
    // fallback on an imported script by hand: Donkey Kong's Giant Punch armour.
    const legacyRun = moveScriptFrame(donkeyKong, at("neutralB", 9))!;
    expect(moveSuperArmour(donkeyKong, { move: "neutralB" }, legacyRun)).toBe(true);
    const upB = moveScriptFrame(mario, at("upB", 4))!;
    expect(moveMomentum(mario, { move: "upB" }, upB)).not.toBeNull();
  });
});

describe("a freed move in a match", () => {
  it("throws Mario's Fireball from its imported script", () => {
    const RULES = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true } as const;
    let s: GameState = createInitialState("finalDestination", [{ defId: "mario" }, { defId: "fox" }], RULES, 3, ctx);
    s.fighters.forEach((f, i) => Object.assign(f, { action: "stand", grounded: true, platform: 0, x: fx(i === 0 ? -40 : 40), y: 0, facing: i === 0 ? 1 : -1, intangible: 0 }));
    let prev: InputFrame[] = [0, 0];
    let spawnedOn = -1;
    for (let i = 0; i < 30 && spawnedOn < 0; i++) {
      const now = [i === 0 ? Btn.Special : 0, 0];
      s = step(s, now, { prevInputs: prev, ctx }).state;
      prev = now;
      if (s.projectiles.length > 0) spawnedOn = i + 1;
    }
    // game_specialn: FT_MOTION_RATE 1.15, generate_article on motion frame 14 → game frame 16.
    expect(spawnedOn).toBe(16);
    expect(s.projectiles[0].defId).toBe("fireball");
  });
});

describe("what keeps a move on its legacy frames (Plan 5 review)", () => {
  it("lists every Plan 5 field the script cannot carry", () => {
    expect(PLAN5_BEHAVIOUR).toEqual(expect.arrayContaining(["intangible", "turnAt", "copyDamage"]));
  });

  it("keeps a move with any of them off its script, even one whose script would run", () => {
    // Mario's jab runs its script (ACTIVE_SCRIPT_SLOTS); with a Plan 5 field it must not.
    const jab = mario.moves.jab1!;
    const script = REFERENCE_SCRIPTS.mario.scripts[REFERENCE_SCRIPTS.mario.slots.jab1!];
    expect(activatable("jab1", jab, script)).toBe(true);
    expect(activatable("jab1", { ...jab, intangible: [1, 3] }, script)).toBe(false);
    expect(activatable("jab1", { ...jab, turnAt: 5 }, script)).toBe(false);
    expect(activatable("jab1", { ...jab, copyDamage: fx(1.2) }, script)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run src/fighters/acmd/activate.test.ts`
Expected: FAIL — 7 failed — `expected [ 'jab1', 'dashAttack', 'dair', …(6) ] to deeply equal ArrayContaining ["neutralB", "dsmash"]`, `TypeError: Cannot read properties of undefined (reading 'FIGHTER_PIKACHU_GENERATE_ARTICLE_DENGEKIDAMA')`, `expected 17 to be 16`, `expected undefined to deeply equal ArrayContaining{…}` (no `PLAN5_BEHAVIOUR`), `expected true to be false` (a jab with a Plan 5 field still activatable).

- [ ] **Step 3: Implement**

`src/engine/acmd/run.ts` — apply:

```diff
--- a/src/engine/acmd/run.ts
+++ b/src/engine/acmd/run.ts
@@ -7,10 +7,10 @@
  */
 
 import { moveFrameOf } from "../hitbox";
 import type { FighterDef, FighterState } from "../types";
-import { runScript } from "./interpreter";
-import type { ScriptFrameState } from "./interpreter";
+import { flatten, runScript } from "./interpreter";
+import type { ActiveMomentum, ScriptFrameState } from "./interpreter";
 import { gameScriptFor } from "./legacy";
 import type { AcmdScript } from "./types";
 
 export interface MoveScriptFrame {
@@ -26,4 +26,71 @@ export function moveScriptFrame(def: FighterDef, f: Pick<FighterState, "move" |
   if (script === null) return null;
   const gameFrame = moveFrameOf(f.actionFrame);
   return { script, gameFrame, state: runScript(script, gameFrame) };
 }
+
+/* ------------------------------------------------ what a script leaves out -- */
+
+const opsCache = new WeakMap<AcmdScript, ReadonlySet<string>>();
+
+/** Which commands a script uses at all (cached). */
+function opsOf(script: AcmdScript): ReadonlySet<string> {
+  let ops = opsCache.get(script);
+  if (ops === undefined) {
+    const found = new Set<string>();
+    for (const c of flatten(script)) {
+      found.add(c.op);
+      if (c.op === "setFlag" && c.flag === "FIGHTER_STATUS_ATTACK_FLAG_START_SMASH_HOLD") found.add("smashHold");
+    }
+    ops = found;
+    opsCache.set(script, ops);
+  }
+  return ops;
+}
+
+/**
+ * A move's scripted movement this frame (Plan 5). An imported `game_` script
+ * publishes none — SSBU moves a fighter by its animation, which no source
+ * publishes — so a move running one keeps its legacy `momentum`; a compiled
+ * legacy script carries it as `momentum` commands already.
+ */
+export function moveMomentum(def: FighterDef, f: Pick<FighterState, "move">, run: MoveScriptFrame): ActiveMomentum | null {
+  if (run.state.momentum !== null || opsOf(run.script).has("momentum") || f.move === null) return run.state.momentum;
+  for (const m of def.moves[f.move]?.momentum ?? []) {
+    const until = m.frame + (m.hold ?? 0);
+    if (run.gameFrame >= m.frame && run.gameFrame <= until) return { x: m.x, y: m.y, until };
+  }
+  return null;
+}
+
+/** Super armour this frame: the script's, or the legacy window when the script says nothing (Plan 5). */
+export function moveSuperArmour(def: FighterDef, f: Pick<FighterState, "move">, run: MoveScriptFrame): boolean {
+  if (run.state.superArmour || opsOf(run.script).has("superArmour") || f.move === null) return run.state.superArmour;
+  const w = def.moves[f.move]?.superArmourFrames;
+  return w !== undefined && run.gameFrame >= w[0] && run.gameFrame <= w[1];
+}
+
+/** The projectiles launched this frame: the script's, or the legacy spawn frames when it has none (Plan 5). */
+export function moveSpawns(def: FighterDef, f: Pick<FighterState, "move">, run: MoveScriptFrame): string[] {
+  if (opsOf(run.script).has("spawnProjectile") || f.move === null) {
+    return run.state.fired.flatMap((c) => (c.op === "spawnProjectile" ? [c.id] : []));
+  }
+  return (def.moves[f.move]?.projectiles ?? []).filter((p) => p.spawnFrame === run.gameFrame).map((p) => p.id);
+}
+
+/**
+ * The `actionFrame` a charging smash holds on: the frame its script raises
+ * FIGHTER_STATUS_ATTACK_FLAG_START_SMASH_HOLD, else one short of its first
+ * legacy hitbox (Plan 5).
+ */
+export function smashHoldFrame(def: FighterDef, f: Pick<FighterState, "move">): number {
+  if (f.move === null) return 1;
+  const script = gameScriptFor(def, f.move);
+  if (script !== null && opsOf(script).has("smashHold")) {
+    for (let g = 1; g < 300; g++) {
+      if (runScript(script, g).fired.some((c) => c.op === "setFlag" && c.flag === "FIGHTER_STATUS_ATTACK_FLAG_START_SMASH_HOLD")) {
+        return Math.max(1, g - 1);
+      }
+    }
+  }
+  return Math.max(1, (def.moves[f.move]?.hitboxes[0]?.startFrame ?? 1) - 1);
+}
```

`src/engine/simulate.ts` — apply:

```diff
--- a/src/engine/simulate.ts
+++ b/src/engine/simulate.ts
@@ -150,9 +150,9 @@ import {
   shieldDamage,
   shieldPushback,
 } from "./shield";
 import { absHitbox, scriptHitboxes } from "./acmd/hitboxes";
-import { moveScriptFrame } from "./acmd/run";
+import { moveScriptFrame, moveSpawns } from "./acmd/run";
 import "./status";
 import { emptyEvents } from "./types";
 import type {
   ActionState,
@@ -913,11 +913,10 @@ function spawnDueProjectiles(
     // the move did not actually advance onto.
     if (f.actionFrame === beforeActionFrame[i]) continue;
     const run = moveScriptFrame(defs[i], f);
     if (run === null) continue;
-    for (const cmd of run.state.fired) {
-      if (cmd.op !== "spawnProjectile") continue;
-      const def = findProjectileDef(defs[i], cmd.id);
+    for (const id of moveSpawns(defs[i], f, run)) {
+      const def = findProjectileDef(defs[i], id);
       if (def === undefined) continue;
       const sc = defs[i].moves[f.move]?.specialCharge;
       // A copied neutral special fires the copied fighter's projectile (Plan 5).
       const source = f.combat.copy !== "" && f.move === "neutralB" ? f.combat.copy : defs[i].id;
```

`src/engine/states.ts` — apply:

```diff
--- a/src/engine/states.ts
+++ b/src/engine/states.ts
@@ -48,9 +48,9 @@ import {
   dropThroughPlatform,
   hitstunGravityOptions,
   platformCentreX,
 } from "./physics";
-import { moveScriptFrame } from "./acmd/run";
+import { moveMomentum, moveScriptFrame, moveSuperArmour } from "./acmd/run";
 import { clearHitRecord } from "./hitbox";
 import {
   carrierOf,
   kineticAdopt,
@@ -772,9 +772,10 @@ export function hasSuperArmour(f: FighterState, def: FighterDef): boolean {
   // the engine, and it is right to — the check is a plain grep, because the
   // rule it enforces is "no browser globals reachable from a simulation that
   // has to run identically on both peers", and a grep cannot be fooled by a
   // clever alias the way a type checker can.
-  return moveScriptFrame(def, f)?.state.superArmour === true;
+  const run = moveScriptFrame(def, f);
+  return run !== null && moveSuperArmour(def, f, run);
 }
 
 /**
  * A move's own scripted movement, if it has one on this frame.
@@ -799,9 +800,9 @@ export function hasSuperArmour(f: FighterState, def: FighterDef): boolean {
 function applyMoveMomentum(f: FighterState, ctx: StateContext): boolean {
   if (f.move === null) return false;
   if (f.action !== "attack" && f.action !== "special" && f.action !== "throw") return false;
   const run = moveScriptFrame(ctx.def, f);
-  const m = run?.state.momentum ?? null;
+  const m = run === null ? null : moveMomentum(ctx.def, f, run);
   if (run === null || m === null) return false;
   // The floor still wins. A downward impulse on a grounded fighter drove
   // them straight through the stage — a grounded Stone fell out of the world.
   // A Stone used on the ground simply sits there, as it does in the real game.
```

`src/engine/status/attack.ts` — apply:

```diff
--- a/src/engine/status/attack.ts
+++ b/src/engine/status/attack.ts
@@ -7,8 +7,9 @@
  * status that swings, which is where the game resets its AttackModule; it was
  * reset by `startMove`, the only way into these statuses, on the same frame.
  */
 
+import { smashHoldFrame } from "../acmd/run";
 import { SMASH_CHARGE_MAX } from "../constants";
 import { clearHitRecord } from "../hitbox";
 import { mashFrames } from "../shield";
 import { specialChargeMain } from "../specialCharge";
@@ -46,9 +47,9 @@ function attackMain(f: FighterState, intent: Intent, ctx: StateContext): void {
     return;
   }
   // Charging a smash holds the animation one frame short of its first hitbox.
   if (f.action === "attack" && move.chargeable && f.charge < SMASH_CHARGE_MAX && intent.attackHeld) {
-    const holdFrame = Math.max(1, (move.hitboxes[0]?.startFrame ?? 1) - 1);
+    const holdFrame = smashHoldFrame(ctx.def, f);
     if (f.actionFrame >= holdFrame) {
       f.actionFrame = holdFrame;
       f.charge += 1;
       return;
```

`src/fighters/acmd/active.ts` — apply:

```diff
--- a/src/fighters/acmd/active.ts
+++ b/src/fighters/acmd/active.ts
@@ -45,8 +45,9 @@ const RUN_OPS: ReadonlySet<AcmdCommand["op"]> = new Set([
   // Plan 5: lifted from `unknown` by `liftScript`.
   "attackAbs",
   "hitAbs",
   "catchOnly",
+  "spawnProjectile",
 ]);
 
 /** `REVERSE_LR()` runs only in a throw, whose status turns the thrower (Plan 5). */
 
@@ -68,8 +69,12 @@ const COSMETIC_PREFIXES: readonly string[] = [
 
 /** Longer than any move: a box still live here is never cleared by its script. */
 const CLEARED_BY = 300;
 
+function flatCommands(commands: readonly AcmdCommand[]): AcmdCommand[] {
+  return commands.flatMap((c) => (c.op === "loop" ? flatCommands(c.body) : [c]));
+}
+
 function runnable(commands: readonly AcmdCommand[], bones: Set<string>, throwing: boolean): boolean {
   for (const c of commands) {
     if (c.op === "attack" || c.op === "catch") bones.add(c.params.bone);
     if (c.op === "loop") {
@@ -88,8 +93,33 @@ function runnable(commands: readonly AcmdCommand[], bones: Set<string>, throwing
   }
   return true;
 }
 
+/**
+ * Fields whose behaviour is timed against the legacy move's frames (Plan 5).
+ * Momentum, projectiles, armour and a smash's charge no longer keep a move on
+ * its legacy script: the engine reads them from the script, or from the legacy
+ * move where the script publishes nothing (`acmd/run.ts` `moveMomentum`,
+ * `moveSpawns`, `moveSuperArmour`, `smashHoldFrame`). These stay, because the
+ * script cannot carry them: a charge loop, a reflector or counter window, a
+ * mouthful, a carry, a stall, the frames of the move's own intangibility, a
+ * throw's turn, a copied move's damage. Later tasks add the Final Smash
+ * phases (`final`, Task 14) and rehits (`rehit`, Task 16).
+ */
+export const PLAN5_BEHAVIOUR: (keyof MoveDef)[] = [
+  "specialCharge",
+  "reflector",
+  "counter",
+  "counterDamage",
+  "inhale",
+  "release",
+  "cargo",
+  "stall",
+  "intangible",
+  "turnAt",
+  "copyDamage",
+];
+
 /** Plan 3's bones: the root alone, the only bone `LEGACY_BONE_TABLE` places. */
 export const ROOT_BONE_ONLY = (bone: string): boolean => bone === "top";
 
 /**
@@ -103,16 +133,18 @@ export function activatable(
   script: AcmdScript,
   placeable: (bone: string) => boolean = ROOT_BONE_ONLY,
 ): boolean {
   if (move === undefined) return false;
-  if (move.momentum !== undefined || move.projectiles !== undefined) return false;
-  if (move.superArmourFrames !== undefined || move.chargeable === true || move.specialCharge !== undefined) return false;
+  // Plan 5's specials are built on their legacy frames (a charge loop, a
+  // reflector or counter window, a mouthful, a carry): they keep them.
+  if (PLAN5_BEHAVIOUR.some((k) => move[k] !== undefined)) return false;
   const lifted = liftScript(script);
   const bones = new Set<string>();
   if (!runnable(lifted.commands, bones, THROW_SLOTS.has(slot))) return false;
-  // A throw lands by ATK_HIT_ABS and may hang no box on a bone at all.
-  const throws = lifted.commands.some((c) => c.op === "hitAbs");
-  if ((bones.size === 0 && !throws) || ![...bones].every(placeable)) return false;
+  // A throw lands by ATK_HIT_ABS, a projectile special by its spawn: either
+  // may hang no box on a bone at all.
+  const lands = flatCommands(lifted.commands).some((c) => c.op === "hitAbs" || c.op === "spawnProjectile");
+  if ((bones.size === 0 && !lands) || ![...bones].every(placeable)) return false;
   const end = runScript(lifted, CLEARED_BY);
   return end.attacks.length + end.catches.length === 0;
 }
 
@@ -137,17 +169,18 @@ export function withReferenceScripts(def: FighterDef, ref: ReferenceFighter, slo
 }
 
 /**
  * The slots each fighter runs from its imported script — every slot the rule
- * admits, no more (pinned by `active.test.ts`). 66 of the roster's moves; Plan 5
- * added the 28 throws and pummels whose ATTACK_ABS the throw status now reads.
+ * admits, no more (pinned by `active.test.ts`). 71 of the roster's moves; Plan 5
+ * added the 28 throws and pummels whose ATTACK_ABS the throw status now reads,
+ * then 5 moves its momentum, spawn, armour and charge fallbacks free.
  */
 export const ACTIVE_SCRIPT_SLOTS: Readonly<Record<string, readonly MoveSlot[]>> = {
-  mario: ["jab1", "dashAttack", "dair", "grab", "dashGrab", "pummel", "fthrow", "uthrow", "dthrow"],
+  mario: ["jab1", "dashAttack", "dsmash", "dair", "neutralB", "grab", "dashGrab", "pummel", "fthrow", "uthrow", "dthrow"],
   donkeyKong: ["dashAttack", "dair", "grab", "dashGrab", "pummel", "uthrow", "dthrow"],
   link: ["jab1", "jab2", "dtilt", "fair", "dair", "grab", "dashGrab", "pummel", "dthrow"],
   samus: ["dashAttack", "pummel", "fthrow", "bthrow", "uthrow", "dthrow"],
   kirby: ["jab1", "jab2", "dashAttack", "fair", "bair", "dair", "grab", "dashGrab", "pummel", "fthrow", "bthrow", "dthrow"],
   fox: ["jab1", "jab2", "grab", "dashGrab", "pummel", "fthrow"],
-  pikachu: ["jab1", "dtilt", "nair", "fair", "grab", "dashGrab", "fthrow", "bthrow", "uthrow"],
+  pikachu: ["jab1", "dtilt", "fsmash", "dsmash", "nair", "fair", "neutralB", "grab", "dashGrab", "fthrow", "bthrow", "uthrow"],
   marth: ["sideB", "grab", "dashGrab", "pummel", "fthrow", "bthrow", "uthrow", "dthrow"],
 };
```

`src/fighters/acmd/lift.ts` — apply:

```diff
--- a/src/fighters/acmd/lift.ts
+++ b/src/fighters/acmd/lift.ts
@@ -1,7 +1,8 @@
 /**
  * The commands the importer leaves as `unknown` that Plan 5 runs: a throw's
- * `ATTACK_ABS` and `ATK_HIT_ABS`, and a pummel's `set_catch_only_all`.
+ * `ATTACK_ABS` and `ATK_HIT_ABS`, a pummel's `set_catch_only_all`, and the
+ * `generate_article` of a projectile the roster defines.
  *
  * Lifted here, at activation, rather than in the generated files, so the
  * committed imports stay byte-for-byte what `scripts/import-acmd.mjs` wrote.
  * `parseArgs` is the importer's own argument splitter.
@@ -11,8 +12,19 @@ import { fx } from "@/engine/fixed";
 import type { AbsParams, AcmdCommand, AcmdScript } from "@/engine/acmd/types";
 import { parseArgs, unhash } from "./parse";
 
 const ABS = /^ATTACK_ABS\((.*)\)$/;
+const ARTICLE = /^ArticleModule::generate_article\(([A-Z_]+)/;
+
+/**
+ * Articles that are a projectile the roster already defines (Plan 5), so
+ * `generate_article` can launch it on the script's own frame. Articles missing
+ * here stay unknown, and a move generating one keeps its compiled legacy move.
+ */
+export const ARTICLE_PROJECTILES: Readonly<Record<string, string>> = {
+  FIGHTER_MARIO_GENERATE_ARTICLE_FIREBALL: "fireball",
+  FIGHTER_PIKACHU_GENERATE_ARTICLE_DENGEKIDAMA: "thunderJolt",
+};
 
 /** `ATTACK_ABS(Kind=…, ID=0, Damage=8.0, Angle=45, KBG=65, FKB=0, BKB=60, Hitlag=0.0, …)`. */
 export function parseAbs(raw: string): AbsParams | null {
   const m = ABS.exec(raw);
@@ -39,8 +51,11 @@ function lift(c: AcmdCommand): AcmdCommand {
   if (abs !== null) return { op: "attackAbs", params: abs };
   if (c.raw.startsWith("ATK_HIT_ABS(FIGHTER_ATTACK_ABSOLUTE_KIND_THROW")) return { op: "hitAbs" };
   if (c.raw.startsWith("AttackModule::set_catch_only_all(true")) return { op: "catchOnly", on: true };
   if (c.raw.startsWith("AttackModule::set_catch_only_all(false")) return { op: "catchOnly", on: false };
+  const article = ARTICLE.exec(c.raw);
+  const id = article === null ? undefined : ARTICLE_PROJECTILES[article[1]];
+  if (id !== undefined) return { op: "spawnProjectile", id };
   return c;
 }
 
 const cache = new WeakMap<AcmdScript, AcmdScript>();
```

`src/render/chars/mario/poses.ts` — apply:

```diff
--- a/src/render/chars/mario/poses.ts
+++ b/src/render/chars/mario/poses.ts
@@ -1239,9 +1239,11 @@ const ftilt: PoseClip = {
  * forward high, one hand back high, and the body driving through underneath.
  */
 const neutralB: PoseClip = {
   loop: false,
-  strike: 0.327,
+  // Plan 5: the move runs its imported script now, FAF 43 (42 frames, not
+  // 49); keys keep their frames up to the release on 16, the rest compressed.
+  strike: 16 / 42,
   keys: [
     {
       t: 0,
       pose: P({
@@ -1255,9 +1257,9 @@ const neutralB: PoseClip = {
     },
     // Guard. Both fists up at the chin, elbows in, weight settling onto the
     // back foot — wound, but not yet committed to anything.
     {
-      t: 0.2,
+      t: 9.8 / 42,
       pose: P({
         torso: -20, head: 18, hip: 8,
         thighR: 172, shinR: 26, footR: -84,
         thighL: 212, shinL: 16, footL: -74,
@@ -1268,9 +1270,9 @@ const neutralB: PoseClip = {
       offsetY: -0.55,
       ease: "hold",
     },
     {
-      t: 0.26,
+      t: 12.7 / 42,
       pose: P({
         torso: -20, head: 18, hip: 8,
         thighR: 172, shinR: 26, footR: -84,
         thighL: 212, shinL: 16, footL: -74,
@@ -1286,9 +1288,9 @@ const neutralB: PoseClip = {
     // forward of the shoulder and a shade above it, which is where the
     // projectile's (5.2, 6.4) spawn is. Off hand flung back and up. Deep lunge
     // under both, rear heel lifted.
     {
-      t: 0.327,
+      t: 16.0 / 42,
       pose: P({
         torso: 22, head: -12, hip: -6,
         thighR: 124, shinR: 22, footR: -94,
         thighL: 236, shinL: 8, footL: -46,
@@ -1302,9 +1304,9 @@ const neutralB: PoseClip = {
     },
     // Frames 17–21. A degree of settle and nothing else: the release reads as
     // *held* for its five frames, which is what the original does.
     {
-      t: 0.42,
+      t: 19.6 / 42,
       pose: P({
         torso: 20, head: -10, hip: -5,
         thighR: 126, shinR: 22, footR: -94,
         thighL: 234, shinL: 9, footL: -48,
@@ -1318,9 +1320,9 @@ const neutralB: PoseClip = {
     },
     // The unwind starts from the middle out — hips first, then the shoulders.
     // The palm is the last thing to leave.
     {
-      t: 0.58,
+      t: 25.8 / 42,
       pose: P({
         torso: 14, head: -6, hip: -2,
         thighR: 138, shinR: 26, footR: -90,
         thighL: 220, shinL: 14, footL: -62,
@@ -1330,9 +1332,9 @@ const neutralB: PoseClip = {
       offsetX: 0.5,
       offsetY: -0.7,
     },
     {
-      t: 0.74,
+      t: 32.0 / 42,
       pose: P({
         torso: 6,
         thighR: 150, shinR: 22, footR: -88,
         thighL: 208, shinL: 12, footL: -76,
@@ -1341,9 +1343,9 @@ const neutralB: PoseClip = {
       }),
       offsetX: 0.2,
       offsetY: -0.3,
     },
-    { t: 0.92, pose: P({ torso: 4, upperArmR: 188, forearmR: -96, upperArmL: 206, forearmL: -98 }) },
+    { t: 38.9 / 42, pose: P({ torso: 4, upperArmR: 188, forearmR: -96, upperArmL: 206, forearmL: -98 }) },
     { t: 1, pose: P({ torso: 4, upperArmR: 200, forearmR: -106, upperArmL: 204, forearmL: -102 }) },
   ],
 };
 
```

- [ ] **Step 4: Run it again**

Run: `pnpm vitest run src/fighters/acmd/activate.test.ts`
Expected: PASS (`src/fighters/acmd/activate.test.ts` 7 tests).

- [ ] **Step 5: Regenerate the generated files, in this order**

Each command rewrites one artefact from the code; the order matters (the limb list feeds the reconcile list and the bake, the bake feeds reach). Then review each diff against the scratch result below.

```bash
UPDATE_LIMB=1 pnpm vitest run src/fighters/acmd/limb.test.ts
UPDATE_RECONCILE=1 pnpm vitest run src/fighters/acmd/reconcile.test.ts
UPDATE_BAKE=1 pnpm vitest run src/render3d/bake/roster.test.ts
UPDATE_REACH=1 pnpm vitest run src/fighters/acmd/reach.test.ts
UPDATE_GOLDEN=1 pnpm vitest run src/game/golden.test.ts
```

`src/fighters/acmd/limb.json` — the expected change:

```diff
--- a/src/fighters/acmd/limb.json
+++ b/src/fighters/acmd/limb.json
@@ -3,8 +3,9 @@
     "bair",
     "bthrow",
     "dtilt",
     "fair",
+    "fsmash",
     "ftilt",
     "jab2",
     "jab3",
     "nair",
@@ -20,39 +21,46 @@
   ],
   "link": [
     "bair",
     "bthrow",
+    "dsmash",
     "fthrow",
     "ftilt",
     "jab3",
     "nair",
+    "upB",
     "uthrow",
     "utilt"
   ],
   "samus": [
     "bair",
     "dair",
     "dashGrab",
+    "dsmash",
     "dtilt",
     "fair",
+    "fsmash",
     "ftilt",
     "grab",
     "jab2",
     "nair",
     "utilt"
   ],
   "kirby": [
     "dtilt",
+    "fsmash",
     "ftilt",
     "nair",
     "uair"
   ],
   "fox": [
     "bair",
     "dair",
+    "fsmash",
     "ftilt",
     "nair",
-    "uair"
+    "uair",
+    "usmash"
   ],
   "pikachu": [
     "bair",
     "dair",
@@ -60,18 +68,22 @@
     "dthrow",
     "ftilt",
     "pummel",
     "uair",
+    "usmash",
     "utilt"
   ],
   "marth": [
     "dair",
+    "dsmash",
     "dtilt",
     "fair",
+    "fsmash",
     "ftilt",
     "jab1",
     "jab2",
     "nair",
     "uair",
+    "usmash",
     "utilt"
   ]
 }
```

`src/fighters/acmd/reconcile.allow.json` — the expected change:

```diff
--- a/src/fighters/acmd/reconcile.allow.json
+++ b/src/fighters/acmd/reconcile.allow.json
@@ -9,14 +9,8 @@
   "donkeyKong upB lead": "legacy 5%/95°/fkb90/kbg30 / game_specialhi 5%/95°/fkb30/kbg90",
   "donkeyKong downB hitboxes": "legacy some / game_speciallwstart none",
   "link fsmash lead": "legacy 14%/361°/bkb30/kbg100 / game_attacks4 7%/69°/bkb45/kbg12",
   "link fsmash faf": "legacy 51 / game_attacks4 49",
-  "link dsmash lead": "legacy 17%/78°/bkb40/kbg88 / game_attacklw4 16%/78°/bkb40/kbg88",
-  "link dsmash faf": "legacy 57 / game_attacklw4 52",
-  "link upB first": "legacy 7 / game_specialhi 4",
-  "link upB last": "legacy 39 / game_specialhi 36",
-  "link upB faf": "legacy 77 / game_specialhi 74",
-  "samus fsmash lead": "legacy 14%/361°/bkb40/kbg100 / game_attacks4 12%/361°/bkb16/kbg112",
   "kirby rapidJab first": "legacy 5 / game_attack100 1",
   "kirby rapidJab last": "legacy 36 / game_attack100 14",
   "kirby usmash faf": "legacy 46 / game_attackhi4 48",
   "kirby dsmash faf": "legacy 51 / game_attacklw4 54",
@@ -42,10 +36,6 @@
   "pikachu upB first": "legacy 15 / game_specialhi1 1",
   "pikachu upB last": "legacy 33 / game_specialhi1 300",
   "pikachu downB hitboxes": "legacy some / game_speciallw none",
   "marth dashAttack lead": "legacy 13%/45°/bkb93/kbg58 / game_attackdash 10%/45°/bkb70/kbg55",
-  "marth fsmash lead": "legacy 18%/361°/bkb80/kbg80 / game_attacks4 13%/361°/bkb48/kbg75",
-  "marth usmash lead": "legacy 17%/89°/bkb40/kbg95 / game_attackhi4 3%/125°/fkb155/kbg100",
-  "marth dsmash lead": "legacy 12%/361°/bkb57/kbg88 / game_attacklw4 8%/361°/bkb60/kbg88",
-  "marth dsmash faf": "legacy 56 / game_attacklw4 55",
   "marth bair lead": "legacy 12.5%/361°/bkb40/kbg94 / game_attackairb 9%/361°/bkb40/kbg85"
 }
```

`src/fighters/acmd/reach.allow.json` — the expected change:

```diff
--- a/src/fighters/acmd/reach.allow.json
+++ b/src/fighters/acmd/reach.allow.json
@@ -9,13 +9,16 @@
   "donkeyKong jab1": "legacy 11.5 / baked 15.5",
   "donkeyKong jab2": "legacy 11.0 / baked 21.4",
   "donkeyKong nair": "legacy 11.0 / baked 25.6",
   "link bair": "legacy -4.0 / baked 5.6",
+  "link dsmash": "legacy 12.5 / baked 17.7",
   "link fthrow": "legacy 0.0 / baked 12.4",
   "link jab3": "legacy 11.3 / baked 19.5",
   "link nair": "legacy 9.5 / baked 13.7",
+  "link upB": "legacy 12.0 / baked 16.6",
   "link uthrow": "legacy 0.0 / baked 8.6",
   "samus dair": "legacy 5.5 / baked 10.8",
+  "samus dsmash": "legacy 11.5 / baked 18.6",
   "samus dtilt": "legacy 10.5 / baked 21.6",
   "samus fair": "legacy 10.5 / baked 18.1",
   "samus jab2": "legacy 10.5 / baked 13.8",
   "samus nair": "legacy 9.5 / baked 16.0",
@@ -24,10 +27,12 @@
   "kirby nair": "legacy 4.0 / baked 9.3",
   "fox dair": "legacy 4.4 / baked 10.0",
   "fox ftilt": "legacy 9.6 / baked 13.3",
   "fox uair": "legacy 4.5 / baked 7.7",
+  "fox usmash": "legacy 6.7 / baked 12.0",
   "pikachu bair": "legacy -0.8 / baked 5.5",
   "pikachu dair": "legacy 3.0 / baked 11.0",
   "pikachu dashAttack": "legacy 6.6 / baked 11.7",
   "pikachu pummel": "legacy 3.0 / baked 15.0",
-  "marth dtilt": "legacy 13.2 / baked 18.4"
+  "marth dtilt": "legacy 13.2 / baked 18.4",
+  "marth usmash": "legacy 5.0 / baked 14.5"
 }
```

`src/fighters/bake/digest.ts` — the bake's new digest:

```diff
--- a/src/fighters/bake/digest.ts
+++ b/src/fighters/bake/digest.ts
@@ -1,5 +1,5 @@
 // GENERATED by src/render3d/bake/roster.test.ts (UPDATE_BAKE=1) — do not edit by hand.
 /** SHA-256 of the uncompressed public/bake/roster.bin.gz: the bake's fingerprint. */
-export const BAKE_DIGEST = "213935531126717011126b85910e3a0d5fc7de1a89990861ace4a578e8d230da";
+export const BAKE_DIGEST = "4f78a857a20ce993cc65487fb98d0dea865439a103bd56e96f513e2a9bbe9000";
 /** Its uncompressed length in bytes. */
-export const BAKE_BYTES = 5947026;
+export const BAKE_BYTES = 5947154;
```

**Golden trace — deliberate behaviour change.** mario-fox-battlefield, donkeyKong-pikachu-finalDestination and link-samus-smashville diverge (smash attacks and Link's Spin Attack now run their scripts). kirby-marth must not change.

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0; golden trace regenerated as above.

- [ ] **Step 7: Commit**

```bash
git add super-smash/public/bake/roster.bin.gz super-smash/src/engine/acmd/run.ts super-smash/src/engine/simulate.ts super-smash/src/engine/states.ts super-smash/src/engine/status/attack.ts super-smash/src/fighters/acmd/activate.test.ts super-smash/src/fighters/acmd/active.ts super-smash/src/fighters/acmd/lift.ts super-smash/src/fighters/acmd/limb.json super-smash/src/fighters/acmd/reach.allow.json super-smash/src/fighters/acmd/reconcile.allow.json super-smash/src/fighters/bake/digest.ts super-smash/src/game/__golden__/engine-trace.json super-smash/src/render/chars/mario/poses.ts
git commit -m "super-smash: momentum, projectile, armour and charge moves run their game_ scripts" -m "The energies, armour, spawns and smash charge fall back to the legacy move where a script publishes none, so Plan 3's four exclusions go; PLAN5_BEHAVIOUR keeps what a script cannot carry. limb.json +smash attacks and Link's upB; reach.allow.json +5 (link dsmash 17.7, link upB 16.6, samus dsmash 18.6, fox usmash 12.0, marth usmash 14.5); reconcile -10. Bake regenerated. Golden trace regenerated: mario-fox, dk-pikachu and link-samus diverge because smash attacks run their scripts." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: The Final Smash engine: trap, cinematic scene, launch

SmashWiki (Final Smash, Smash Ball): breaking the Smash Ball puts its breaker in "Standby Mode", in which "the character's neutral special move is replaced with a single use of their Final Smash" — so only a **neutral** special starts it — and "players can attack a fighter in standby mode to make them 'drop' the Smash Ball, at which point it will begin roaming the stage again" (`dropSmashBall`: UNVERIFIED how hard the hit must be — any damaging hit — and the dropped ball's HP). No source gives the Smash Ball's power a time limit or says a KO loses it: the replica keeps it until used, dropped or KO'd, both UNVERIFIED (Plan 2's `FINAL_SMASH_STANDBY` timeout goes). A cinematic Final Smash's first hit traps whoever it touches ("If the first hit doesn't make contact, the whole attack fails"), letting go of anyone the victim held or was held by (`releaseGrab`), then "the game effectively pauses as an unskippable scene plays out". The replica plays that scene **inside the simulation**: `GameState.cinematic` holds the user's port and freezes everyone else, every projectile, the Smash Ball and the clock; the scene's boxes reach every trapped fighter for damage; the end phase launches. Because it is ordinary state, rollback replays it exactly (Review Focus 3). A counter does not catch a Final Smash (UNVERIFIED); a trapped fighter cannot be footstooled; `final` joins `PLAN5_BEHAVIOUR`, since the scene's boxes hang off `virtualfinalattack` bones no skeleton has.

**Files:**
- Create: `super-smash/src/engine/final.test.ts`, `super-smash/src/engine/final.ts`
- Modify: `super-smash/src/engine/acmd/legacy.ts`, `super-smash/src/engine/combat.ts`, `super-smash/src/engine/constants.ts`, `super-smash/src/engine/footstool.ts`, `super-smash/src/engine/hash.ts`, `super-smash/src/engine/held.ts`, `super-smash/src/engine/simulate.ts`, `super-smash/src/engine/states.ts`, `super-smash/src/engine/status/attack.ts`, `super-smash/src/engine/status/damage.ts`, `super-smash/src/engine/status/groups.test.ts`, `super-smash/src/engine/status/kind.ts`, `super-smash/src/engine/status/status.test.ts`, `super-smash/src/engine/types.ts`, `super-smash/src/fighters/acmd/activate.test.ts`, `super-smash/src/fighters/acmd/active.ts`, `super-smash/src/fighters/footstool.test.ts`, `super-smash/src/render/poses/timing.ts`
- Regenerate: `super-smash/public/bake/roster.bin.gz`, `super-smash/src/fighters/bake/digest.ts`

**Interfaces:**
- Consumes: `GameState.cinematic` (Task 1), `startMove` (Plan 2), `kineticClear` (Plan 2).
- Produces: `src/engine/final.ts`: `FINAL_SMASH_READY`, `trappedBy`, `beginFinalSmash(f, ctx, neutral)`, `trapVictim(user, victim, fighters)`, `nextFinalPhase`, `updateCinematic`, `inCinematic`, `dropSmashBall`; `FinalPhase { phase: "start" | "attack" | "end"; trap?; next? }`, `MoveDef.final?`; `STATUS_FINAL_TRAPPED`, action `finalTrapped`; `CombatState.trappedBy`; slots `finalAttack`, `finalEnd`; `Candidate.final`.

- [ ] **Step 1: Write the failing tests**

`src/engine/final.test.ts` (new file):

```ts
import { describe, expect, it } from "vitest";

import { fx, toFloat } from "./fixed";
import { FINAL_SMASH_READY } from "./final";
import { hashState } from "./hash";
import { cloneState, createInitialState, step } from "./simulate";
import type { SimContext } from "./simulate";
import { Btn } from "./types";
import type { FighterAttributes, FighterDef, GameState, Hitbox, InputFrame, MatchRules, MoveDef, StageDef, StepEvents } from "./types";

/* ------------------------------------------------------------- fixtures -- */

const ATTRS: FighterAttributes = {
  weight: 100,
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
  canWallJump: false,
  width: fx(4),
  height: fx(12),
  jumpSquatFrames: 3,
};

function box(over: Partial<Hitbox>): Hitbox {
  return { id: 0, startFrame: 1, endFrame: 1, x: fx(8), y: fx(6), radius: fx(6), damage: fx(10), angle: fx(45), baseKnockback: fx(80), knockbackGrowth: fx(100), ...over };
}

/**
 * A three-part cinematic Final Smash: a trap box on frame 5, three 2% scene
 * hits, then a 10% launch — the shape of Jungle Rush, Ultra Sword and the rest.
 */
const FINAL: MoveDef = { slot: "finalSmash", name: "Final", totalFrames: 20, intangible: [1, 20], final: { phase: "start", trap: true, next: "finalAttack" }, hitboxes: [box({ startFrame: 5, endFrame: 6, damage: fx(5), baseKnockback: 0, knockbackGrowth: 0 })] };
const SCENE: MoveDef = {
  slot: "finalAttack",
  name: "Scene",
  totalFrames: 30,
  intangible: [1, 30],
  final: { phase: "attack", next: "finalEnd" },
  hitboxes: [5, 12, 19].map((f, i) => box({ id: i, startFrame: f, endFrame: f, damage: fx(2), x: fx(500) })),
};
const END: MoveDef = { slot: "finalEnd", name: "End", totalFrames: 20, intangible: [1, 20], final: { phase: "end" }, hitboxes: [box({ startFrame: 3, endFrame: 3, x: fx(500), damage: fx(10), baseKnockback: fx(90), knockbackGrowth: fx(96), angle: fx(70) })] };
const JAB: MoveDef = { slot: "jab1", name: "Jab", totalFrames: 10, hitboxes: [box({ startFrame: 2, endFrame: 3 })] };
const SHOT = { id: "shot", spawnFrame: 2, offsetX: 0, offsetY: fx(6), vx: fx(1), vy: 0, gravity: 0, lifetime: 200, visual: "energy" as const, hitbox: box({ startFrame: 0, endFrame: 200, damage: fx(1), radius: fx(1) }) };

/** A counter that catches anything in frames 1-30, then answers with a 1% jab. */
const COUNTER: MoveDef = {
  slot: "downB",
  name: "Counter",
  totalFrames: 40,
  hitboxes: [],
  counter: { active: [1, 30], multiplier: fx(1.2), minDamage: fx(1), maxDamage: fx(50), freeze: 5, then: "counterAttack" },
};
const COUNTER_ATTACK: MoveDef = { slot: "counterAttack", name: "Riposte", totalFrames: 20, counterDamage: true, hitboxes: [box({ startFrame: 2, endFrame: 3, damage: fx(1) })] };

const DEF = {
  id: "t",
  name: "T",
  series: "",
  number: 0,
  attributes: ATTRS,
  moves: {
    finalSmash: FINAL,
    finalAttack: SCENE,
    finalEnd: END,
    jab1: JAB,
    downB: COUNTER,
    counterAttack: COUNTER_ATTACK,
    neutralB: { slot: "neutralB", name: "Shot", totalFrames: 10, hitboxes: [], projectiles: [SHOT] },
  },
  palette: {} as FighterDef["palette"],
  blurb: "",
} as unknown as FighterDef;

const STAGE: StageDef = {
  id: "s",
  name: "S",
  series: "",
  platforms: [{ x: 0, y: 0, halfWidth: fx(150), soft: false, ledges: true }],
  blastZone: { left: fx(-300), right: fx(300), top: fx(300), bottom: fx(-200) },
  spawns: [{ x: fx(-10), y: 0 }, { x: fx(0), y: 0 }, { x: fx(80), y: 0 }],
  theme: "",
};
const CTX: SimContext = { fighter: () => DEF, stage: () => STAGE };
const RULES: MatchRules = { mode: "time", stocks: 3, timeLimit: 60 * 60, smashBall: false, oneOnOne: false };

/** The user (port 0) with the Smash Ball's power, a victim in front, a bystander far off. */
function ready(): GameState {
  const s = createInitialState("s", [{ defId: "t" }, { defId: "t" }, { defId: "t" }], RULES, 1, CTX);
  s.fighters.forEach((f, i) => Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, facing: i === 0 ? 1 : -1, intangible: 0, x: [fx(-10), fx(0), fx(80)][i], y: 0 }));
  s.fighters[0].finalSmashReady = FINAL_SMASH_READY;
  return s;
}

function run(s0: GameState, frames: number, script: (i: number) => InputFrame[]): { states: GameState[]; events: StepEvents[] } {
  let s = s0;
  let prev: InputFrame[] = s.fighters.map(() => 0);
  const states: GameState[] = [];
  const events: StepEvents[] = [];
  for (let i = 0; i < frames; i++) {
    const now = script(i);
    const out = step(s, now, { prevInputs: prev, ctx: CTX });
    s = out.state;
    prev = now;
    states.push(s);
    events.push(out.events);
  }
  return { states, events };
}

const USE = (i: number): InputFrame[] => [i === 0 ? Btn.Special : 0, 0, 0];

/* ---------------------------------------------------------------- tests -- */

describe("a Final Smash", () => {
  it("is what the special button does with the Smash Ball's power, and spends it", () => {
    const { states, events } = run(ready(), 2, USE);
    expect(states[0].fighters[0].move).toBe("finalSmash");
    expect(states[0].fighters[0].finalSmashReady).toBe(0);
    expect(events[0].finalSmashes).toEqual([0]);
  });

  it("traps what its first hit touches, plays its scene with everybody else still, then launches", () => {
    const { states } = run(ready(), 90, USE);
    const trappedAt = states.findIndex((s) => s.fighters[1].action === "finalTrapped");
    expect(trappedAt).toBeGreaterThan(0);
    const scene = states.filter((s) => s.cinematic === 0);
    expect(scene.length).toBeGreaterThan(20);
    // The bystander does not move a frame while the scene plays.
    const frames = new Set(scene.map((s) => s.fighters[2].actionFrame));
    expect(frames.size).toBe(1);
    const end = states[states.length - 1];
    expect(end.cinematic).toBe(-1);
    // 5 (trap) + 3 × 2 (scene) + 10 (end), each a fresh move's ×1.05: every
    // box landed once, on the trapped one only.
    expect(toFloat(end.fighters[1].damage)).toBeCloseTo(21 * 1.05, 2);
    expect(end.fighters[2].damage).toBe(0);
    expect(end.fighters[1].action).not.toBe("finalTrapped");
    expect(end.fighters[1].vy !== 0 || end.fighters[1].vx !== 0 || end.fighters[1].hitstun > 0).toBe(true);
  });

  it("stops the clock and every projectile while the scene plays", () => {
    const s = ready();
    // The bystander fires first; its shot hangs in the air through the scene.
    const { states } = run(s, 60, (i) => [i === 4 ? Btn.Special : 0, 0, i === 0 ? Btn.Special : 0]);
    const scene = states.filter((st) => st.cinematic === 0);
    expect(scene.length).toBeGreaterThan(0);
    expect(new Set(scene.map((st) => st.timeRemaining)).size).toBe(1);
    expect(new Set(scene.map((st) => st.projectiles[0]?.x)).size).toBe(1);
  });

  it("whiffs when its first hit touches nobody: no scene, nobody trapped", () => {
    const s = ready();
    s.fighters[1].x = fx(120);
    const { states } = run(s, 40, USE);
    expect(states.every((st) => st.cinematic === -1)).toBe(true);
    expect(states.every((st) => st.fighters[1].action !== "finalTrapped")).toBe(true);
    expect(states[states.length - 1].fighters[0].action).toBe("stand");
  });
});

describe("a Final Smash meets a fighter who is busy (Plan 5 review)", () => {
  /** Port 2 (the bystander) is moved next to the victim and joined to it. */
  function joined(victim: Partial<GameState["fighters"][number]>, other: Partial<GameState["fighters"][number]>): GameState {
    const s = ready();
    Object.assign(s.fighters[1], victim);
    Object.assign(s.fighters[2], { x: fx(6), facing: -1 }, other);
    return s;
  }

  for (const [name, victim, other] of [
    ["being grabbed", { action: "grabbed", grabbedBy: 2 }, { action: "grabHold", grabbing: 1 }],
    ["riding a carrier's shoulders", { action: "cargoHeld", grabbedBy: 2 }, { action: "cargoCarry", grabbing: 1 }],
    ["holding a grab", { action: "grabHold", grabbing: 2 }, { action: "grabbed", grabbedBy: 1 }],
  ] as const) {
    it(`traps a fighter ${name} and lets the other one go`, () => {
      const { states } = run(joined(victim, other), 12, USE);
      const at = states.findIndex((st) => st.fighters[1].action === "finalTrapped");
      expect(at).toBeGreaterThan(0);
      const [, v, o] = states[at].fighters;
      expect(v.grabbedBy).toBe(-1);
      expect(v.grabbing).toBe(-1);
      expect(o.grabbing).toBe(-1);
      expect(o.grabbedBy).toBe(-1);
    });
  }

  it("is not countered (UNVERIFIED): the counter's victim is trapped like anybody else", () => {
    const { states, events } = run(ready(), 12, (i) => [i === 0 ? Btn.Special : 0, i === 0 ? Btn.Down | Btn.Special : 0, 0]);
    expect(events.every((e) => e.counters.length === 0)).toBe(true);
    expect(states.some((st) => st.fighters[1].action === "finalTrapped")).toBe(true);
  });

  it("is a neutral special: B with a direction is that direction's special, and the power is kept", () => {
    const { states } = run(ready(), 2, (i) => [i === 0 ? Btn.Right | Btn.Special : 0, 0, 0]);
    expect(states[0].fighters[0].move).not.toBe("finalSmash");
    expect(states[1].fighters[0].finalSmashReady).toBe(FINAL_SMASH_READY);
  });

  it("is dropped when its holder is hit: the Smash Ball roams again from where they are (SmashWiki \"Smash Ball\")", () => {
    const s = ready();
    // The victim jabs the one in standby before they use it.
    const { states } = run(s, 6, (i) => [0, i === 0 ? Btn.Attack : 0, 0]);
    const end = states[states.length - 1];
    expect(end.fighters[0].damage).toBeGreaterThan(0);
    expect(end.fighters[0].finalSmashReady).toBe(0);
    expect(end.smashBall.active).toBe(true);
    expect(Math.abs(end.smashBall.x - end.fighters[0].x)).toBeLessThan(fx(10));
  });
});

describe("Review Focus: a Final Smash under rollback", () => {
  it("replays the scene to the same state after a misprediction on either side of the trap", () => {
    const truth = (i: number): InputFrame[] => [i === 0 ? Btn.Special : 0, i === 10 ? Btn.Attack : 0, 0];
    const straight = run(ready(), 70, truth).states;
    // Every rollback point, from before the trap to inside the scene: predict
    // "nothing pressed" for eight frames, then rewind to the snapshot and
    // re-simulate with the real inputs, as `RollbackSession` does.
    for (const at of [2, 4, 6, 12, 30]) {
      let s = straight[at - 1];
      const snapshot = cloneState(s);
      let prev = truth(at - 1);
      for (let i = at; i < at + 8; i++) {
        const guess: InputFrame[] = [0, 0, 0];
        s = step(s, guess, { prevInputs: prev, ctx: CTX }).state;
        prev = guess;
      }
      s = snapshot;
      prev = truth(at - 1);
      for (let i = at; i < 70; i++) {
        s = step(s, truth(i), { prevInputs: prev, ctx: CTX }).state;
        prev = truth(i);
        expect(hashState(s), `rolled back to ${at}, frame ${i}`).toBe(hashState(straight[i]));
      }
    }
  });
});
```

`src/engine/status/groups.test.ts` — apply:

```diff
--- a/src/engine/status/groups.test.ts
+++ b/src/engine/status/groups.test.ts
@@ -111,8 +111,10 @@ const LEGACY_KINETIC: Readonly<Record<ActionState, KineticType>> = {
   techCeiling: "GROUND_STOP",
   // Plan 5, Task 8: Donkey Kong's carry, and the fighter carried.
   cargoCarry: "WALK",
   cargoHeld: "NONE",
+  // Plan 5, Task 14: caught in a Final Smash.
+  finalTrapped: "NONE",
   // Plan 5, Task 12: crawling.
   crawl: "WALK",
   // Plan 5, Task 11: stood on.
   footstooled: "GROUND_STOP",
@@ -181,8 +183,10 @@ const MIGRATED = [
   "techCeiling",
   // Plan 5, Task 8
   "cargoCarry",
   "cargoHeld",
+  // Plan 5, Task 14
+  "finalTrapped",
   // Plan 5, Task 12
   "crawl",
   // Plan 5, Task 11
   "footstooled",
```

`src/engine/status/status.test.ts` — apply:

```diff
--- a/src/engine/status/status.test.ts
+++ b/src/engine/status/status.test.ts
@@ -70,10 +70,11 @@ const CTX = { def: {} as FighterDef, stage: { platforms: [] }, frame: 1, fighter
 describe("the status alias table", () => {
   it("names an SSBU-style kind for every replica action, one-to-one", () => {
     const actions = Object.keys(STATUS_KIND_OF_ACTION) as ActionState[];
     // 47 through Plan 3; Plan 5 adds Donkey Kong's carry and the carried, and
-    // Kirby's mouthful, the swallowed and the spat, the footstooled and the crawl.
-    expect(actions).toHaveLength(54);
+    // Kirby's mouthful, the swallowed and the spat, the footstooled, the crawl
+    // and the trapped.
+    expect(actions).toHaveLength(55);
     const kinds = new Set(actions.map((a) => STATUS_KIND_OF_ACTION[a]));
     expect(kinds.size).toBe(actions.length);
     for (const a of actions) expect(ACTION_OF_STATUS_KIND[STATUS_KIND_OF_ACTION[a]]).toBe(a);
   });
```

`src/fighters/acmd/activate.test.ts` — apply:

```diff
--- a/src/fighters/acmd/activate.test.ts
+++ b/src/fighters/acmd/activate.test.ts
@@ -71,9 +71,9 @@ describe("a freed move in a match", () => {
 });
 
 describe("what keeps a move on its legacy frames (Plan 5 review)", () => {
   it("lists every Plan 5 field the script cannot carry", () => {
-    expect(PLAN5_BEHAVIOUR).toEqual(expect.arrayContaining(["intangible", "turnAt", "copyDamage"]));
+    expect(PLAN5_BEHAVIOUR).toEqual(expect.arrayContaining(["intangible", "turnAt", "copyDamage", "final"]));
   });
 
   it("keeps a move with any of them off its script, even one whose script would run", () => {
     // Mario's jab runs its script (ACTIVE_SCRIPT_SLOTS); with a Plan 5 field it must not.
@@ -84,4 +84,22 @@ describe("what keeps a move on its legacy frames (Plan 5 review)", () => {
     expect(activatable("jab1", { ...jab, turnAt: 5 }, script)).toBe(false);
     expect(activatable("jab1", { ...jab, copyDamage: fx(1.2) }, script)).toBe(false);
   });
 });
+
+describe("a Final Smash's cutscene script (Plan 5 review)", () => {
+  it("stays off its script even where a bone table could place `virtualfinalattack`", () => {
+    // A script whose every box hangs off the cutscene bone, as `game_finalattack`'s do.
+    const ref = REFERENCE_SCRIPTS.mario;
+    const jab = ref.scripts[ref.slots.jab1!];
+    const virtual = {
+      ...jab,
+      commands: jab.commands.map((c) => (c.op === "attack" ? { ...c, params: { ...c.params, bone: "virtualfinalattack" } } : c)),
+    };
+    const everyBone = () => true;
+    const scene = { ...mario.moves.jab1!, slot: "finalAttack" as const, final: { phase: "attack" as const } };
+    expect(activatable("finalAttack", { ...scene, final: undefined }, virtual, everyBone)).toBe(true);
+    expect(activatable("finalAttack", scene, virtual, everyBone)).toBe(false);
+    // And no committed skeleton has the bone, so the limb rule could not place it anyway.
+    expect(activatable("finalAttack", { ...scene, final: undefined }, virtual)).toBe(false);
+  });
+});
```

`src/fighters/footstool.test.ts` — apply:

```diff
--- a/src/fighters/footstool.test.ts
+++ b/src/fighters/footstool.test.ts
@@ -127,8 +127,14 @@ describe("who cannot be stood on (Plan 5 review)", () => {
       const s = stoolOn("fox");
       Object.assign(s.fighters[1], { action: "respawnPlatform", grounded: false, platform: -1 });
       return s;
     }],
+    ["a fighter trapped in a Final Smash", () => {
+      const s = stoolOn("fox", "mario");
+      Object.assign(s.fighters[1], { action: "finalTrapped" });
+      s.fighters[1].combat.trappedBy = 2;
+      return s;
+    }],
     ["an invincible fighter", () => {
       const s = stoolOn("fox");
       s.fighters[1].invincible = 60;
       return s;
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/engine/final.test.ts src/engine/status/groups.test.ts src/engine/status/status.test.ts src/fighters/acmd/activate.test.ts src/fighters/footstool.test.ts`
Expected: FAIL — 5 failed | 38 passed; `final.test.ts` cannot load (`Failed to resolve import "./final"`); the rest: `Error: no status registered for "finalTrapped"`, the status tables (`to have a length of 55 but got 54`), `expected [ 'specialCharge', 'reflector', …(9) ] to deeply equal ArrayContaining{…}` (no `final` in `PLAN5_BEHAVIOUR`), `expected true to be false`.

- [ ] **Step 3: Implement**

`src/engine/acmd/legacy.ts` — apply:

```diff
--- a/src/engine/acmd/legacy.ts
+++ b/src/engine/acmd/legacy.ts
@@ -55,8 +55,10 @@ export const SLOT_MOTION: Readonly<Record<MoveSlot, MotionKind>> = {
   cargoUthrow: "throw_f_hi",
   cargoDthrow: "throw_f_lw",
   inhaleSwallow: "special_n_swallow",
   inhaleSpit: "special_n_spit",
+  finalAttack: "final_attack",
+  finalEnd: "final_end",
 };
 
 /** A legacy hitbox as `ATTACK` arguments on the root bone. */
 export function attackFromHitbox(hb: Hitbox): AttackParams {
```

`src/engine/combat.ts` — apply:

```diff
--- a/src/engine/combat.ts
+++ b/src/engine/combat.ts
@@ -72,8 +72,10 @@ export interface CombatState {
   /** Plan 5: wall jumps since last on the ground (each weaker, ×0.96). */
   wallJumps: number;
   /** Plan 5: frames since this fighter last started an attack or special (a footstool waits 16). */
   sinceAttack: number;
+  /** Plan 5: the port whose Final Smash has trapped this fighter, or −1. */
+  trappedBy: number;
 }
 
 export function emptyCombat(): CombatState {
   return {
@@ -101,8 +103,9 @@ export function emptyCombat(): CombatState {
     wallSide: 0,
     wallFrames: 0,
     wallJumps: 0,
     sinceAttack: 999,
+    trappedBy: -1,
   };
 }
 
 export function cloneCombat(c: CombatState): CombatState {
@@ -131,6 +134,7 @@ export function cloneCombat(c: CombatState): CombatState {
     wallSide: c.wallSide,
     wallFrames: c.wallFrames,
     wallJumps: c.wallJumps,
     sinceAttack: c.sinceAttack,
+    trappedBy: c.trappedBy,
   };
 }
```

`src/engine/constants.ts` — apply:

```diff
--- a/src/engine/constants.ts
+++ b/src/engine/constants.ts
@@ -414,10 +414,11 @@ export const CRAWL_BACK_SPEED = fx(0.5);
 export const SMASH_BALL_HEALTH = fx(40);
 export const SMASH_BALL_DECAY = fx(2);
 export const SMASH_BALL_DECAY_INTERVAL = 60;
 export const SMASH_BALL_SPAWN_INTERVAL = 900;
-/** Frames the winner glows in standby before the Final Smash must be used. */
-export const FINAL_SMASH_STANDBY = 600;
+// Plan 5: no standby limit. SmashWiki "Final Smash" gives a Smash Ball Final
+// Smash none (only the Final Smash Meter's lasts "about 20 seconds"); the ready
+// flag is `FINAL_SMASH_READY` in `final.ts`.
 
 /** Sudden death starts everyone here. */
 export const SUDDEN_DEATH_DAMAGE = fx(300);
 
```

`src/engine/final.ts` (new file):

```ts
/**
 * Final Smashes (Plan 5, Task 14).
 *
 * Breaking the Smash Ball sets `finalSmashReady` ("Standby Mode"); SmashWiki
 * "Final Smash": "the character's neutral special move is replaced with a
 * single use of their Final Smash", so the next *neutral* special consumes it
 * and starts the fighter's `finalSmash` move. SmashWiki "Smash Ball": "Players
 * can attack a fighter in standby mode to make them 'drop' the Smash Ball, at
 * which point it will begin roaming the stage again" (`dropSmashBall`). SmashWiki "Final Smash": a
 * cinematic Final Smash traps whoever its first hit touches ("If the first hit
 * doesn't make contact, the whole attack fails"), and then "the game
 * effectively pauses as an unskippable scene plays out". The replica plays
 * that scene in the simulation itself, so a rollback replays it exactly:
 *
 * - `start` — the `finalSmash` move. With `trap`, every box it lands traps
 *   instead of hitting: the victim takes the damage and waits, trapped
 *   (`finalTrapped`, `CombatState.trappedBy`). With nobody trapped it simply
 *   ends: a whiff.
 * - `attack` — the cutscene's hits. `GameState.cinematic` holds the user's port
 *   and everybody else, every projectile, the Smash Ball and the clock stand
 *   still. Its boxes reach every fighter trapped, wherever they are (the
 *   scene places them; SSBU's boxes hang off `virtualfinalattack` bones), for
 *   damage only.
 * - `end` — the finishing blow, also reaching every trapped fighter, launching.
 *
 * A Final Smash with no `trap` (Mario Finale) is an ordinary, very large move.
 * UNVERIFIED-simplified: the cutscene's camera and its 30 fps playback are
 * presentation; the HP-bar of Critical Hit is not drawn.
 */

import { SMASH_BALL_HEALTH } from "./constants";
import { fx } from "./fixed";
import { releaseGrab, startAction, startMove } from "./states";
import type { StateContext } from "./states";
import type { FighterDef, FighterState, GameState, MoveSlot } from "./types";

/**
 * The ready flag the Smash Ball sets. UNVERIFIED: that it lasts until used —
 * SmashWiki gives the Final Smash Meter's version "about 20 seconds" and the
 * Smash Ball's none; the replica keeps it until used, dropped or KO'd.
 */
export const FINAL_SMASH_READY = 1;

/** Ports trapped by `user`'s Final Smash. */
export function trappedBy(s: Pick<GameState, "fighters">, user: number): FighterState[] {
  return s.fighters.filter((f) => f.action === "finalTrapped" && f.combat.trappedBy === user);
}

/** A neutral special with a Final Smash ready starts it. Returns true if it did. */
export function beginFinalSmash(f: FighterState, ctx: StateContext, neutral: boolean): boolean {
  if (!neutral || f.finalSmashReady <= 0 || ctx.def.moves.finalSmash === undefined) return false;
  f.finalSmashReady = 0;
  startMove(f, "special", "finalSmash");
  return true;
}

/**
 * A trap box landed: the victim waits, trapped, for the scene. Anybody it was
 * holding, or being held by, is let go first (`releaseGrab` clears both
 * halves), so nobody is left hanging off a fighter who is in the cutscene.
 */
export function trapVictim(user: FighterState, victim: FighterState, fighters: readonly FighterState[]): void {
  releaseGrab(victim, fighters);
  startAction(victim, "finalTrapped");
  victim.combat.trappedBy = user.port;
}

/**
 * Called when a Final Smash phase's move ends: on to the next phase if anybody
 * is trapped, else the move is over. Returns the slot started, or null.
 */
export function nextFinalPhase(f: FighterState, ctx: StateContext, next: MoveSlot | undefined): MoveSlot | null {
  if (next === undefined) return null;
  const anyone = ctx.fighters.some((o) => o.action === "finalTrapped" && o.combat.trappedBy === f.port);
  if (!anyone) return null;
  startMove(f, "special", next);
  return next;
}

/**
 * The cinematic, decided once a frame after the state machines have run: it
 * plays while a fighter's move is an `attack` phase with somebody trapped.
 */
export function updateCinematic(s: GameState, defs: readonly FighterDef[]): void {
  s.cinematic = -1;
  for (let i = 0; i < s.fighters.length; i++) {
    const f = s.fighters[i];
    if (f.action !== "special" || f.move === null) continue;
    if (defs[i].moves[f.move]?.final?.phase !== "attack") continue;
    if (trappedBy(s, f.port).length > 0) {
      s.cinematic = f.port;
      return;
    }
  }
}

/** Does this fighter play on while `s.cinematic` stands everybody else still? */
export function inCinematic(s: Pick<GameState, "cinematic">, f: FighterState): boolean {
  return f.port === s.cinematic || (f.action === "finalTrapped" && f.combat.trappedBy === s.cinematic);
}

/**
 * A damaging hit on a fighter in standby drops the Smash Ball (SmashWiki
 * "Smash Ball"), which roams from where they are. UNVERIFIED: how hard the
 * hit must be (any damaging hit here) and the dropped ball's HP (a fresh
 * one's 40).
 */
export function dropSmashBall(s: Pick<GameState, "smashBall">, f: FighterState): void {
  if (f.finalSmashReady <= 0) return;
  f.finalSmashReady = 0;
  if (s.smashBall.active) return;
  Object.assign(s.smashBall, { active: true, x: f.x, y: f.y + fx(10), vx: 0, vy: 0, health: SMASH_BALL_HEALTH, driftTimer: 0 });
}
```

`src/engine/footstool.ts` — apply:

```diff
--- a/src/engine/footstool.ts
+++ b/src/engine/footstool.ts
@@ -54,9 +54,9 @@ export interface Footstool {
   readonly victim: number;
 }
 
 /** States nobody can be stood on in: not on the stage, or inside somebody. */
-const NOT_STOOD_ON: ReadonlySet<ActionState> = new Set<ActionState>(["dead", "entering", "respawnPlatform", "swallowed", "spatStar"]);
+const NOT_STOOD_ON: ReadonlySet<ActionState> = new Set<ActionState>(["dead", "entering", "respawnPlatform", "swallowed", "spatStar", "finalTrapped"]);
 
 /**
  * Can `f` be footstooled now? Not while hanging from a ledge, intangible or
  * invincible; not while held, carried or swallowed (`grabbedBy`) nor while
```

`src/engine/hash.ts` — apply:

```diff
--- a/src/engine/hash.ts
+++ b/src/engine/hash.ts
@@ -187,8 +187,9 @@ export function mixCombat(h: number, c: CombatState): number {
   x = mixInt(x, c.wallSide);
   x = mixInt(x, c.wallFrames);
   x = mixInt(x, c.wallJumps);
   x = mixInt(x, c.sinceAttack);
+  x = mixInt(x, c.trappedBy);
   return x;
 }
 
 /** The KineticModule energies, in declaration order. */
```

`src/engine/held.ts` — apply:

```diff
--- a/src/engine/held.ts
+++ b/src/engine/held.ts
@@ -8,9 +8,9 @@ import { kineticClear } from "./kinetic";
 import type { FighterDef, FighterState, GameState } from "./types";
 
 /** Riding on someone, not moving under their own power. */
 export function isHeldAloft(f: Pick<FighterState, "action">): boolean {
-  return f.action === "cargoHeld" || f.action === "swallowed" || f.action === "spatStar";
+  return f.action === "cargoHeld" || f.action === "swallowed" || f.action === "spatStar" || f.action === "finalTrapped";
 }
 
 /**
  * Put every carried fighter where its carrier holds it: on top of Donkey Kong,
```

`src/engine/simulate.ts` — apply:

```diff
--- a/src/engine/simulate.ts
+++ b/src/engine/simulate.ts
@@ -25,9 +25,8 @@ import {
   AUTOLINK_MIN,
   AUTOLINK_MIN_VY,
   AUTOLINK_PULL_RATIO,
   AUTOLINK_SPEED_CAP,
-  FINAL_SMASH_STANDBY,
   GROUNDED_ZERO_LAUNCH_RATIO,
   GLANCING_BLOW_DEPTH,
   LEDGE_REGRAB_LIMIT,
   LAUNCH_SPEED_RATIO,
@@ -93,8 +92,9 @@ import { chargedHitbox } from "./specialCharge";
 import { reflectProjectiles } from "./reflect";
 import { activeCounter, triggerCounter } from "./counter";
 import { isHeldAloft, pinHeldFighters } from "./held";
 import { WALL_JUMP_WINDOW, noteWallContact } from "./wallJump";
+import { FINAL_SMASH_READY, dropSmashBall, inCinematic, trapVictim, updateCinematic } from "./final";
 
 /** A wall touch is forgotten once no wall jump could use it. */
 const WALL_CONTACT_MEMORY = WALL_JUMP_WINDOW + 1;
 import { COPY_GRACE_FRAMES, maybeLoseCopy, pinStarRiders, resolveInhaleReleases, swallowVictim, withCopyAbility } from "./inhale";
@@ -161,8 +161,9 @@ import type {
   GameState,
   Hitbox,
   InputFrame,
   MatchRules,
+  FinalPhase,
   MoveSlot,
   ProjectileDef,
   ProjectileState,
   StageDef,
@@ -499,11 +500,24 @@ interface Candidate {
    */
   readonly onlyPort: number | null;
   /** Kirby's Copy Ability, ×1.2 on damage and not on knockback (Plan 5); `ONE` otherwise. */
   readonly damageMul: number;
+  /**
+   * A Final Smash box (Plan 5, `final.ts`): `trap` traps what it touches;
+   * `hold` and `launch` reach every fighter its user has trapped, wherever they
+   * are, for damage only or to launch; null for every other box.
+   */
+  readonly final: "trap" | "hold" | "launch" | null;
   suppressed: boolean;
 }
 
+/** What a move's boxes do in a Final Smash (Plan 5). */
+function finalKind(final: FinalPhase | undefined): Candidate["final"] {
+  if (final === undefined) return null;
+  if (final.phase === "start") return final.trap === true ? "trap" : null;
+  return final.phase === "attack" ? "hold" : "launch";
+}
+
 /** Where a candidate's box is this frame: a capsule, or a circle when it has no length. */
 function capsuleOf(c: Candidate): Capsule {
   return { x1: c.x, y1: c.y, x2: c.x + c.dx, y2: c.y + c.dy, r: c.hitbox.radius };
 }
@@ -596,8 +610,15 @@ export function step(
   for (let i = 0; i < s.fighters.length; i++) {
     const f = s.fighters[i];
     const intent = intents[i];
 
+    // A Final Smash's scene stands everybody else still: nothing of theirs
+    // runs, counts down or moves this frame (Plan 5, `final.ts`).
+    if (s.cinematic >= 0 && !inCinematic(s, f)) {
+      frozen[i] = true;
+      continue;
+    }
+
     // Tech input counts on every frame, frozen or not (Plan 3, Task 12).
     updateTechInput(f, intent);
     if (f.combat.copy !== "" && f.combat.copyFrames < COPY_GRACE_FRAMES) f.combat.copyFrames += 1;
     // Frames since the last attack, for the footstool's wait; capped like
@@ -645,12 +666,17 @@ export function step(
     advanceFighter(f, intent, stateCtx(i));
     if (before === "jumpSquat" && f.action === "jump") {
       events.jumps.push({ port: f.port, x: f.x, y: f.y });
     }
+    if (f.action === "special" && f.move === "finalSmash" && f.actionFrame === 0) events.finalSmashes.push(f.port);
   }
   // Whoever was stood on is footstooled now, whatever their port (Plan 5).
   applyFootstools(s.fighters, footstools);
 
+  // The scene plays while a Final Smash's attack phase holds somebody (Plan 5).
+  updateCinematic(s, defs);
+  const paused = s.cinematic >= 0;
+
   /* -- 4. physics ---------------------------------------------------------- */
 
   const preIntegrate = s.fighters.map((f) => ({ x: f.x, y: f.y }));
   for (let i = 0; i < s.fighters.length; i++) {
@@ -722,17 +748,17 @@ export function step(
   /* -- 6. hitboxes: gather, clank, connect --------------------------------- */
 
   // Projectiles fly, then this frame's launches join them, then everything —
   // fists and arrows alike — goes through one clank pass and one hit pass.
-  const projectilePrev = advanceProjectiles(s, ctx, stage);
+  const projectilePrev = paused ? new Map<number, { x: number; y: number }>() : advanceProjectiles(s, ctx, stage);
   spawnDueProjectiles(s, defs, beforeActionFrame, projectilePrev);
   // A swallow or a spit lets its mouthful out; spat stars carry their riders (Plan 5).
   resolveInhaleReleases(s, defs);
   pinStarRiders(s);
 
   const destroyed = new Set<number>();
   const candidates = gatherHitboxes(s, defs, prevPos, frozen, bones);
-  appendProjectileCandidates(s, ctx, candidates, projectilePrev);
+  if (!paused) appendProjectileCandidates(s, ctx, candidates, projectilePrev);
   // Reflectors first: a reflected projectile neither clanks nor hits this frame (Plan 5).
   reflectProjectiles(s, defs, (p) => projectileDefOf(ctx, p), candidates, events, destroyed);
   resolveClanks(s, candidates, events, destroyed);
   resolveHits(s, defs, bake, bones, candidates, intents, events, destroyed);
@@ -762,9 +788,9 @@ export function step(
   }
 
   /* -- 8. the Smash Ball --------------------------------------------------- */
 
-  if (s.rules.smashBall) updateSmashBall(s);
+  if (s.rules.smashBall && !paused) updateSmashBall(s);
 
   /* -- 9. blast zones ------------------------------------------------------ */
 
   for (const f of s.fighters) {
@@ -789,9 +815,11 @@ export function step(
     releaseGrab(f, s.fighters);
     f.shieldHealth = SHIELD_MAX_HEALTH;
     f.staleQueue.length = 0;
     f.combat.staleShield.length = 0;
-    // A KO costs Kirby his Copy Ability (SmashWiki "Copy ability"; Plan 5).
+    // A KO costs the Smash Ball's power (UNVERIFIED: no source says) and Kirby his Copy
+    // Ability (SmashWiki "Copy ability"; Plan 5).
+    f.finalSmashReady = 0;
     f.combat.copy = "";
     f.combat.copyFrames = 0;
     clearHitRecord(f);
     startAction(f, "dead");
@@ -799,9 +827,9 @@ export function step(
   }
 
   /* -- 10. is the match over? ---------------------------------------------- */
 
-  if (s.rules.mode === "time" && s.timeRemaining > 0) {
+  if (s.rules.mode === "time" && s.timeRemaining > 0 && !paused) {
     s.timeRemaining -= 1;
   }
   if (s.outcome === null) s.outcome = resolveOutcome(s);
 
@@ -858,8 +886,9 @@ function gatherHitboxes(
         chargeScale: f.action === "attack" ? chargeMultiplier(f.charge) : ONE,
         destroyOnHit: false,
         onlyPort: run.state.catchOnly ? f.grabbing : null,
         damageMul: defs[i].moves[f.move]?.copyDamage ?? ONE,
+        final: finalKind(defs[i].moves[f.move]?.final),
         suppressed: false,
       });
     }
   }
@@ -955,8 +984,9 @@ function appendProjectileCandidates(
       chargeScale: p.chargeScale,
       destroyOnHit: def.destroyOnHit === true,
       onlyPort: null,
       damageMul: ONE,
+      final: null,
       suppressed: false,
     });
   }
 }
@@ -1054,8 +1084,19 @@ function resolveHits(
     const perSource = new Map<number, Candidate>();
     for (const c of candidates) {
       if (c.suppressed || c.attacker === v) continue;
       if (c.onlyPort !== null && c.onlyPort !== v) continue;
+      // A Final Smash's scene reaches exactly the fighters it trapped, and
+      // nothing else reaches them (Plan 5).
+      const scene = c.final === "hold" || c.final === "launch";
+      const trapped = victim.action === "finalTrapped";
+      if (scene ? !(trapped && victim.combat.trappedBy === c.attacker) : trapped) continue;
+      if (scene) {
+        const key = candidateKey(c);
+        const incumbent = perSource.get(key);
+        if (incumbent === undefined || c.hitbox.id < incumbent.hitbox.id) perSource.set(key, c);
+        continue;
+      }
       // Nobody grabs, or inhales, a fighter hanging from a ledge (Plan 5;
       // UNVERIFIED: SSBU's grab boxes ignore CLIFF statuses, unpublished).
       if (c.hitbox.grabbing === true && victim.ledge !== null) continue;
       if (c.hitbox.situation === "ground" && !victim.grounded) continue;
@@ -1095,9 +1136,10 @@ function resolveHits(
       // consequences that do not land. See `FighterState.invincible`.
       // A counter catches anything but a grab (Plan 5, `counter.ts`) — and,
       // UNVERIFIED (no source says either way), not a windbox: water pushes
       // straight through Counter, which has nothing to return.
-      const counter = c.hitbox.grabbing === true || c.hitbox.windbox === true ? null : activeCounter(victim, defs[v]);
+      // Nor, UNVERIFIED, a Final Smash: it traps or hits whatever is out.
+      const counter = c.hitbox.grabbing === true || c.hitbox.windbox === true || c.final !== null ? null : activeCounter(victim, defs[v]);
       if (counter !== null) {
         recordHit(c, attacker, victim.port);
         const freeze = triggerCounter(victim, counter, mul(c.hitbox.damage, c.chargeScale));
         if (c.projectile === null) attacker.hitlag = freeze;
@@ -1383,8 +1425,15 @@ function applyHit(
   const hb = c.hitbox;
   const fromProjectile = c.projectile !== null;
   recordHit(c, attacker, victim.port);
 
+  // A Final Smash's trap, and its scene's hits (Plan 5, `final.ts`).
+  if (c.final === "trap" || c.final === "hold") {
+    applyHeldHit(s, attacker, victim, c, events);
+    if (c.final === "trap") trapVictim(attacker, victim, s.fighters);
+    return;
+  }
+
   // A pummel, or a throw's early hits, on the fighter being held (Plan 5).
   if (c.onlyPort !== null) {
     applyHeldHit(s, attacker, victim, c, events);
     return;
@@ -1518,8 +1567,10 @@ function applyHit(
   // A copied move hurts ×1.2 and launches as it would have (Plan 5).
   damage = mul(damage, c.damageMul);
   victim.damage += damage;
   maybeLoseCopy(s, victim, damage);
+  // Hit in standby, the Smash Ball's power is dropped (Plan 5, `final.ts`).
+  if (damage > 0) dropSmashBall(s, victim);
   // "Characters can only air dodge once until they land, get hit, or grab a
   // ledge" (SmashWiki "Air dodge", https://www.ssbwiki.com/Air_dodge). Plan 3, Task 7.
   victim.airDodged = false;
 
@@ -1739,8 +1790,9 @@ function resolveThrows(
         chargeScale: ONE,
         destroyOnHit: false,
         onlyPort: null,
         damageMul: ONE,
+        final: null,
         suppressed: false,
       };
       applyHit(s, f, defs[i], victim, defs[v], c, intents[v], events);
     }
@@ -1799,9 +1851,8 @@ function updateSmashBall(s: GameState): void {
       ball.y = fx(80);
       ball.health = SMASH_BALL_HEALTH;
       ball.driftTimer = 0;
     }
-    for (const f of s.fighters) if (f.finalSmashReady > 0) f.finalSmashReady -= 1;
     return;
   }
 
   if (ball.driftTimer <= 0) {
@@ -1823,9 +1874,8 @@ function updateSmashBall(s: GameState): void {
     ball.active = false;
     ball.health = 0;
   }
 
-  for (const f of s.fighters) if (f.finalSmashReady > 0) f.finalSmashReady -= 1;
 }
 
 function resolveSmashBallHits(
   s: GameState,
@@ -1845,9 +1895,9 @@ function resolveSmashBallHits(
     ball.vx += (ball.x >= attacker.x ? 1 : -1) * mul(c.hitbox.damage, fx(0.1));
     if (ball.health <= 0) {
       ball.active = false;
       ball.health = 0;
-      attacker.finalSmashReady = FINAL_SMASH_STANDBY;
+      attacker.finalSmashReady = FINAL_SMASH_READY;
       events.smashBallBroken = attacker.port;
       return;
     }
   }
```

`src/engine/states.ts` — apply:

```diff
--- a/src/engine/states.ts
+++ b/src/engine/states.ts
@@ -20,8 +20,9 @@
  *
  * SPEC §6 is the contract for the interpretation half; §4 for the frame counts.
  */
 
+import { beginFinalSmash } from "./final";
 import { ONE, fx, clamp } from "./fixed";
 import {
   AIR_DODGE_INTANGIBLE,
   AIR_DODGE_LANDING_LAG,
@@ -596,8 +597,10 @@ export function startAirDodge(f: FighterState, intent: Intent): boolean {
  * ordinary movement branch.
  */
 export function handleActionable(f: FighterState, intent: Intent, ctx: StateContext): boolean {
   const p = presses(f, intent, ctx.frame);
+  // With the Smash Ball's power, the special button is the Final Smash (Plan 5).
+  if (p.special && beginFinalSmash(f, ctx, intent.x === 0 && intent.y === 0)) return true;
 
   if (f.grounded) {
     if (p.shield || intent.shieldHeld) {
       startAction(f, "shieldStart");
```

`src/engine/status/attack.ts` — apply:

```diff
--- a/src/engine/status/attack.ts
+++ b/src/engine/status/attack.ts
@@ -7,8 +7,9 @@
  * status that swings, which is where the game resets its AttackModule; it was
  * reset by `startMove`, the only way into these statuses, on the same frame.
  */
 
+import { nextFinalPhase } from "../final";
 import { smashHoldFrame } from "../acmd/run";
 import { SMASH_CHARGE_MAX } from "../constants";
 import { clearHitRecord } from "../hitbox";
 import { mashFrames } from "../shield";
@@ -59,8 +60,10 @@ function attackMain(f: FighterState, intent: Intent, ctx: StateContext): void {
     startMove(f, "attack", move.followUp);
     return;
   }
   if (f.actionFrame >= move.totalFrames) {
+    // A Final Smash goes on to its next phase if it trapped anybody (Plan 5).
+    if (move.final !== undefined && nextFinalPhase(f, ctx, move.final.next) !== null) return;
     startAction(f, f.grounded ? "stand" : "fall");
     return;
   }
   bufferPress(f, intent, ctx.frame);
```

`src/engine/status/damage.ts` — apply:

```diff
--- a/src/engine/status/damage.ts
+++ b/src/engine/status/damage.ts
@@ -118,9 +118,29 @@ export const STATUS_TREAD_DAMAGE: FighterStatus = {
     if (f.actionFrame >= FOOTSTOOL_GROUND_FRAMES) startAction(f, f.grounded ? "stand" : "fall");
   },
 };
 
+/**
+ * Trapped by a cinematic Final Smash (Plan 5, `final.ts`): still, until the
+ * scene's last blow launches them — or the Final Smash is over without one.
+ */
+export const STATUS_FINAL_TRAPPED: FighterStatus = {
+  kind: "FIGHTER_STATUS_KIND_FINAL_TRAPPED",
+  action: "finalTrapped",
+  kineticType: "NONE",
+  main(f, _intent, ctx) {
+    const user = ctx.fighters[f.combat.trappedBy];
+    if (user === undefined || user.action !== "special" || user.move === null || ctx.defs?.[user.port]?.moves[user.move]?.final === undefined) {
+      startAction(f, f.grounded ? "stand" : "fall");
+    }
+  },
+  end(f) {
+    f.combat.trappedBy = -1;
+  },
+};
+
 export const DAMAGE_STATUSES: readonly FighterStatus[] = [
+  STATUS_FINAL_TRAPPED,
   STATUS_TREAD_DAMAGE,
   STATUS_DAMAGE,
   STATUS_DAMAGE_FLY,
   STATUS_DOWN_WAIT,
```

`src/engine/status/kind.ts` — apply:

```diff
--- a/src/engine/status/kind.ts
+++ b/src/engine/status/kind.ts
@@ -69,8 +69,10 @@ export type StatusKind =
   // Plan 5. SSBU's fighter-specific kind keeps its fighter in the name.
   | "FIGHTER_DONKEY_STATUS_KIND_SHOULDER_WAIT"
   | "FIGHTER_STATUS_KIND_SHOULDERED_DONKEY"
   | "FIGHTER_STATUS_KIND_TREAD_DAMAGE"
+  // REPLICA name: SSBU hands a trapped fighter to each Final Smash's own capture statuses.
+  | "FIGHTER_STATUS_KIND_FINAL_TRAPPED"
   | "FIGHTER_KIRBY_STATUS_KIND_SPECIAL_N_EAT_WAIT"
   | "FIGHTER_STATUS_KIND_SWALLOWED"
   | "FIGHTER_STATUS_KIND_SWALLOWED_THROWN_STAR"
   | "FIGHTER_STATUS_KIND_REBIRTH"
@@ -127,8 +129,9 @@ export const STATUS_KIND_OF_ACTION: Readonly<Record<ActionState, StatusKind>> =
   ledgeTrumped: "FIGHTER_STATUS_KIND_CLIFF_ROBBED",
   cargoCarry: "FIGHTER_DONKEY_STATUS_KIND_SHOULDER_WAIT",
   cargoHeld: "FIGHTER_STATUS_KIND_SHOULDERED_DONKEY",
   footstooled: "FIGHTER_STATUS_KIND_TREAD_DAMAGE",
+  finalTrapped: "FIGHTER_STATUS_KIND_FINAL_TRAPPED",
   inhaleHold: "FIGHTER_KIRBY_STATUS_KIND_SPECIAL_N_EAT_WAIT",
   swallowed: "FIGHTER_STATUS_KIND_SWALLOWED",
   spatStar: "FIGHTER_STATUS_KIND_SWALLOWED_THROWN_STAR",
   respawnPlatform: "FIGHTER_STATUS_KIND_REBIRTH",
```

`src/engine/types.ts` — apply:

```diff
--- a/src/engine/types.ts
+++ b/src/engine/types.ts
@@ -133,8 +133,10 @@ export type ActionState =
   | "cargoCarry"
   | "cargoHeld"
   // stood on (Plan 5)
   | "footstooled"
+  // caught in a Final Smash (Plan 5)
+  | "finalTrapped"
   // Kirby's Inhale (Plan 5)
   | "inhaleHold"
   | "swallowed"
   | "spatStar"
@@ -183,9 +185,12 @@ export type MoveSlot =
   | "cargoUthrow"
   | "cargoDthrow"
   // Plan 5: Kirby's swallow and spit, from the inhale.
   | "inhaleSwallow"
-  | "inhaleSpit";
+  | "inhaleSpit"
+  // Plan 5: a cinematic Final Smash's scene and its finishing blow.
+  | "finalAttack"
+  | "finalEnd";
 
 /** Non-damage properties a hit can carry. Drives VFX, hitlag and reactions. */
 export type HitEffect =
   | "normal"
@@ -357,8 +362,19 @@ export interface CounterDef {
   /** The move slot the counterattack is. Its hitboxes deal the counter's damage. */
   readonly then: MoveSlot;
 }
 
+/**
+ * One part of a Final Smash (Plan 5, `final.ts`): the `start` (its boxes trap
+ * when `trap`), the scene's `attack` hits, and the `end` that launches. `next`
+ * follows when this one ends with somebody trapped.
+ */
+export interface FinalPhase {
+  readonly phase: "start" | "attack" | "end";
+  readonly trap?: boolean;
+  readonly next?: MoveSlot;
+}
+
 /** Kirby's Inhale (Plan 5): what the mouth holds and how long. */
 export interface InhaleDef {
   /** Walk speed (and acceleration) multiplier while holding: 1.08. */
   readonly walk: number;
@@ -451,8 +467,10 @@ export interface MoveDef {
   /** The frame a throw turns the thrower round (`REVERSE_LR`, Plan 5). */
   readonly turnAt?: number;
   /** Its catch boxes swallow rather than grab (Plan 5: Kirby's Inhale). */
   readonly inhale?: InhaleDef;
+  /** Which part of a Final Smash this move is (Plan 5, `final.ts`). */
+  readonly final?: FinalPhase;
   /** A copied move's damage multiplier, knockback untouched (Plan 5: Kirby's Copy Ability, ×1.2). */
   readonly copyDamage?: number;
   /** The frame an inhaled fighter leaves the mouth, and how (Plan 5: swallow, spit). */
   readonly release?: { readonly frame: number; readonly kind: "swallow" | "spit"; readonly damage: number };
```

`src/fighters/acmd/active.ts` — apply:

```diff
--- a/src/fighters/acmd/active.ts
+++ b/src/fighters/acmd/active.ts
@@ -101,10 +101,11 @@ function runnable(commands: readonly AcmdCommand[], bones: Set<string>, throwing
  * move where the script publishes nothing (`acmd/run.ts` `moveMomentum`,
  * `moveSpawns`, `moveSuperArmour`, `smashHoldFrame`). These stay, because the
  * script cannot carry them: a charge loop, a reflector or counter window, a
  * mouthful, a carry, a stall, the frames of the move's own intangibility, a
- * throw's turn, a copied move's damage. Later tasks add the Final Smash
- * phases (`final`, Task 14) and rehits (`rehit`, Task 16).
+ * throw's turn, a copied move's damage, a Final Smash's phase (whose cutscene
+ * boxes hang off `virtualfinalattack` bones no skeleton has). Task 16 adds
+ * rehits (`rehit`).
  */
 export const PLAN5_BEHAVIOUR: (keyof MoveDef)[] = [
   "specialCharge",
   "reflector",
@@ -116,8 +117,9 @@ export const PLAN5_BEHAVIOUR: (keyof MoveDef)[] = [
   "stall",
   "intangible",
   "turnAt",
   "copyDamage",
+  "final",
 ];
 
 /** Plan 3's bones: the root alone, the only bone `LEGACY_BONE_TABLE` places. */
 export const ROOT_BONE_ONLY = (bone: string): boolean => bone === "top";
```

`src/render/poses/timing.ts` — apply:

```diff
--- a/src/render/poses/timing.ts
+++ b/src/render/poses/timing.ts
@@ -145,8 +145,10 @@ export const SLOT_POSE: Record<MoveSlot, PoseName> = {
   cargoUthrow: "uthrow",
   cargoDthrow: "dthrow",
   inhaleSwallow: "neutralB",
   inhaleSpit: "neutralB",
+  finalAttack: "neutralB",
+  finalEnd: "neutralB",
 };
 
 /** A looping clip that names no period of its own runs at half a second. */
 const DEFAULT_PERIOD = 30;
@@ -256,8 +258,9 @@ export function poseNameFor(f: Pick<PosedFighter, "action" | "move" | "jumpsUsed
     case "grabbed":
     // Plan 5: carried on the shoulders, still held; stood on.
     case "cargoHeld":
     case "footstooled":
+    case "finalTrapped":
       return "grabbed";
     // Plan 5: walking with the cargo, or with a mouthful; the walk clip reads as either.
     case "cargoCarry":
     case "inhaleHold":
```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/engine/final.test.ts src/engine/status/groups.test.ts src/engine/status/status.test.ts src/fighters/acmd/activate.test.ts src/fighters/footstool.test.ts`
Expected: PASS (`src/engine/final.test.ts` 9 tests).

- [ ] **Step 5: Regenerate the generated files, in this order**

Each command rewrites one artefact from the code; the order matters (the limb list feeds the reconcile list and the bake, the bake feeds reach). Then review each diff against the scratch result below.

```bash
UPDATE_BAKE=1 pnpm vitest run src/render3d/bake/roster.test.ts
```

`src/fighters/bake/digest.ts` — the bake's new digest:

```diff
--- a/src/fighters/bake/digest.ts
+++ b/src/fighters/bake/digest.ts
@@ -1,5 +1,5 @@
 // GENERATED by src/render3d/bake/roster.test.ts (UPDATE_BAKE=1) — do not edit by hand.
 /** SHA-256 of the uncompressed public/bake/roster.bin.gz: the bake's fingerprint. */
-export const BAKE_DIGEST = "4f78a857a20ce993cc65487fb98d0dea865439a103bd56e96f513e2a9bbe9000";
+export const BAKE_DIGEST = "2c4d4fda2c30f600b0248ba46cff9305c9d013995f011a8f78c056277e4bb767";
 /** Its uncompressed length in bytes. */
-export const BAKE_BYTES = 5947154;
+export const BAKE_BYTES = 5981690;
```

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0; golden trace untouched.

- [ ] **Step 7: Commit**

```bash
git add super-smash/public/bake/roster.bin.gz super-smash/src/engine/acmd/legacy.ts super-smash/src/engine/combat.ts super-smash/src/engine/constants.ts super-smash/src/engine/final.test.ts super-smash/src/engine/final.ts super-smash/src/engine/footstool.ts super-smash/src/engine/hash.ts super-smash/src/engine/held.ts super-smash/src/engine/simulate.ts super-smash/src/engine/states.ts super-smash/src/engine/status/attack.ts super-smash/src/engine/status/damage.ts super-smash/src/engine/status/groups.test.ts super-smash/src/engine/status/kind.ts super-smash/src/engine/status/status.test.ts super-smash/src/engine/types.ts super-smash/src/fighters/acmd/activate.test.ts super-smash/src/fighters/acmd/active.ts super-smash/src/fighters/bake/digest.ts super-smash/src/fighters/footstool.test.ts super-smash/src/render/poses/timing.ts
git commit -m "super-smash: Final Smash engine: neutral special, trap, an in-sim cinematic, launch; dropped when hit" -m "Standby makes the neutral special the Final Smash and a damaging hit drops the ball (SmashWiki); no time limit and KO loss are UNVERIFIED. A trapping Final Smash's first hit traps, releasing any grab; its scene runs in the sim with everyone else, projectiles, the ball and the clock frozen, so rollback replays it. A counter does not catch it (UNVERIFIED). Bake regenerated (finalTrapped). Golden trace unchanged." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Cinematic Final Smashes: Jungle Rush, Critical Hit, Ultra Sword, Team Star Fox, Volt Tackle

Each fighter's `game_final*` scripts and its SmashWiki Final Smash page give its phases and hits; the scripts hang the cutscene's boxes off `virtualfinalattack` bones the replica does not have, so every box's x/y offset, and any radius no source quotes, is an UNVERIFIED stand-in (`finalKit.ts` defaults: x 10, y 8, radius 10). `finalKit.ts` builds the phase moves (`finalBox`, `barrage`). Donkey Kong's Jungle Rush, Marth's Critical Hit (60%), Kirby's Ultra Sword, Fox's Team Star Fox and Pikachu's Volt Tackle trap and play scenes; a dash that carried the user stops when the scene starts (`kineticClear`), and the scene lasts through the end phase (`nextAt`). Marth's Counter does not catch Jungle Rush (UNVERIFIED, Task 14).

**Files:**
- Create: `super-smash/src/fighters/finalKit.ts`, `super-smash/src/fighters/finalSmash.test.ts`
- Modify: `super-smash/src/engine/final.ts`, `super-smash/src/engine/status/attack.ts`, `super-smash/src/engine/types.ts`, `super-smash/src/fighters/donkeyKong.ts`, `super-smash/src/fighters/fox.ts`, `super-smash/src/fighters/kirby.ts`, `super-smash/src/fighters/marth.ts`, `super-smash/src/fighters/pikachu.ts`, `super-smash/src/fighters/schema.test.ts`
- Regenerate: `super-smash/public/bake/roster.bin.gz`, `super-smash/src/fighters/acmd/reconcile.allow.json`, `super-smash/src/fighters/bake/digest.ts`

**Interfaces:**
- Consumes: `final.ts` (Task 14).
- Produces: `src/fighters/finalKit.ts`: `finalBox`, `barrage`, `Hit`; `FinalPhase.nextAt?`; `finalSmash`/`finalAttack`/`finalEnd` moves for DK, Marth, Kirby, Fox, Pikachu.

- [ ] **Step 1: Write the failing tests**

`src/fighters/finalSmash.test.ts` (new file):

```ts
/**
 * Every fighter's Final Smash, through the real `step()` (Plan 5, Tasks 15–16).
 * The cinematic ones trap with their first hit and deal their published total;
 * every one of them is spent by use and leaves nobody trapped.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { FINAL_SMASH_READY } from "@/engine/final";
import { fx, toFloat } from "@/engine/fixed";
import { createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { Btn } from "@/engine/types";
import type { GameState, InputFrame, MatchRules, StepEvents } from "@/engine/types";
import { STAGES } from "@/stages";
import { FIGHTERS } from "./index";

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

/** Published totals (see each fighter file); every hit is a fresh move's. */
const CINEMATIC: readonly { id: string; gap: number; total: number }[] = [
  { id: "donkeyKong", gap: 18, total: 12 + 18 * 1.2 + 13 * 1.1 + 14 },
  { id: "marth", gap: 60, total: 60 },
  { id: "kirby", gap: 16, total: 3 + 8 * 2.6 + 16 },
  { id: "fox", gap: 22, total: 3 + 10 * 3 + 3 },
  { id: "pikachu", gap: 30, total: 0.3 + 8 * 1.5 + 1 },
];

describe("cinematic Final Smashes", () => {
  for (const { id, gap, total } of CINEMATIC) {
    it(`${id}: traps Mario, stands Fox still through the scene, and deals ${total.toFixed(1)}%`, () => {
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
      expect(end.fighters[2].damage).toBe(0);
      expect(end.fighters.every((f) => f.action !== "finalTrapped")).toBe(true);
      expect(end.fighters[0].finalSmashReady).toBe(0);
    });
  }
});

describe("Jungle Rush against Marth's Counter (UNVERIFIED: a Final Smash is not countered)", () => {
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
```

`src/fighters/schema.test.ts` — apply:

```diff
--- a/src/fighters/schema.test.ts
+++ b/src/fighters/schema.test.ts
@@ -333,8 +333,11 @@ describe("hitbox values", () => {
 
   it.each(each)("%s gives every damaging hitbox a plausible damage", (_name, fighter) => {
     for (const { slot, hitbox } of everyHitbox(fighter)) {
       if (hitbox.grabbing) continue;
+      // A Final Smash's finishing blow is in a class of its own (Plan 5:
+      // Critical Hit is 60%).
+      if (slot === "finalSmash" || slot === "finalAttack" || slot === "finalEnd") continue;
       // Kirby's fully charged Hammer Flip is the largest single hit in the game
       // at 35%; nothing here should exceed it.
       expect(
         toFloat(hitbox.damage),
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/fighters/finalSmash.test.ts src/fighters/schema.test.ts`
Expected: FAIL — 6 failed | 317 passed — `expected false to be true` (nobody trapped: no data yet) and `expected [] to deeply equal [ +0 ]` (no Final Smash started).

- [ ] **Step 3: Implement**

`src/engine/final.ts` — apply:

```diff
--- a/src/engine/final.ts
+++ b/src/engine/final.ts
@@ -29,8 +29,9 @@
  */
 
 import { SMASH_BALL_HEALTH } from "./constants";
 import { fx } from "./fixed";
+import { kineticClear } from "./kinetic";
 import { releaseGrab, startAction, startMove } from "./states";
 import type { StateContext } from "./states";
 import type { FighterDef, FighterState, GameState, MoveSlot } from "./types";
 
@@ -72,22 +73,27 @@ export function trapVictim(user: FighterState, victim: FighterState, fighters: r
 export function nextFinalPhase(f: FighterState, ctx: StateContext, next: MoveSlot | undefined): MoveSlot | null {
   if (next === undefined) return null;
   const anyone = ctx.fighters.some((o) => o.action === "finalTrapped" && o.combat.trappedBy === f.port);
   if (!anyone) return null;
+  // The scene starts where the trap landed: whatever carried the user there
+  // (a dash, a tackle) stops.
+  kineticClear(f);
   startMove(f, "special", next);
   return next;
 }
 
 /**
  * The cinematic, decided once a frame after the state machines have run: it
- * plays while a fighter's move is an `attack` phase with somebody trapped.
+ * plays while a fighter's move is an `attack` or `end` phase with somebody
+ * still trapped — the finishing blow launches them and ends it.
  */
 export function updateCinematic(s: GameState, defs: readonly FighterDef[]): void {
   s.cinematic = -1;
   for (let i = 0; i < s.fighters.length; i++) {
     const f = s.fighters[i];
     if (f.action !== "special" || f.move === null) continue;
-    if (defs[i].moves[f.move]?.final?.phase !== "attack") continue;
+    const phase = defs[i].moves[f.move]?.final?.phase;
+    if (phase !== "attack" && phase !== "end") continue;
     if (trappedBy(s, f.port).length > 0) {
       s.cinematic = f.port;
       return;
     }
```

`src/engine/status/attack.ts` — apply:

```diff
--- a/src/engine/status/attack.ts
+++ b/src/engine/status/attack.ts
@@ -59,10 +59,13 @@ function attackMain(f: FighterState, intent: Intent, ctx: StateContext): void {
   if (move.followUp !== undefined && intent.attackPressed && f.actionFrame >= 3 && hasMove(ctx, move.followUp)) {
     startMove(f, "attack", move.followUp);
     return;
   }
+  // A Final Smash goes on to its next phase once it has trapped anybody (Plan 5).
+  if (move.final?.nextAt !== undefined && f.actionFrame + 1 >= move.final.nextAt && nextFinalPhase(f, ctx, move.final.next) !== null) {
+    return;
+  }
   if (f.actionFrame >= move.totalFrames) {
-    // A Final Smash goes on to its next phase if it trapped anybody (Plan 5).
     if (move.final !== undefined && nextFinalPhase(f, ctx, move.final.next) !== null) return;
     startAction(f, f.grounded ? "stand" : "fall");
     return;
   }
```

`src/engine/types.ts` — apply:

```diff
--- a/src/engine/types.ts
+++ b/src/engine/types.ts
@@ -371,8 +371,10 @@ export interface CounterDef {
 export interface FinalPhase {
   readonly phase: "start" | "attack" | "end";
   readonly trap?: boolean;
   readonly next?: MoveSlot;
+  /** With somebody trapped, go on to `next` from this frame rather than at the move's end (a whiff plays it all). */
+  readonly nextAt?: number;
 }
 
 /** Kirby's Inhale (Plan 5): what the mouth holds and how long. */
 export interface InhaleDef {
```

`src/fighters/donkeyKong.ts` — apply:

```diff
--- a/src/fighters/donkeyKong.ts
+++ b/src/fighters/donkeyKong.ts
@@ -12,8 +12,9 @@
  * game's patch-13.0.1 ACMD scripts, because neither site publishes those.
  */
 
 import { fx } from "@/engine/fixed";
+import { barrage, finalBox } from "./finalKit";
 import type { FighterDef } from "@/engine/types";
 import { ACTIVE_SCRIPT_SLOTS, withReferenceScripts } from "./acmd/active";
 import { DONKEY_KONG } from "./acmd/generated/donkeyKong";
 import { FIGHTER_PARAMS } from "./params";
@@ -766,8 +767,47 @@ const legacy: FighterDef = {
       hitboxes: [
         { id: 0, startFrame: 17, endFrame: 17, x: fx(4.0), y: fx(2.0), radius: fx(4.0), damage: fx(11.0), angle: fx(46), baseKnockback: fx(70), knockbackGrowth: fx(45), hitlagMultiplier: fx(0) },
       ],
     },
+
+    // Plan 5 — Jungle Rush (SmashWiki "Donkey Kong (SSBU)/Final Smash";
+    // rubendal Data Viewer 13.0.1 `game_finalstart`/`finalattack`/`finalend`).
+    // "If the first hit doesn't make contact, the whole attack fails": the
+    // detection punch (12%, frames 29-34, a capsule 8→28 units ahead) traps;
+    // FIGHTER_DONKEY_STATUS_FINAL_FLAG_TO_ATTACK on frame 37 starts the
+    // barrage — 18 × 1.2% then 13 × 1.1%, one every four frames (the scripts'
+    // `for(18 Iterations)` and `for(13 Iterations)`) — and the uppercut is 14%,
+    // angle 70, BKB 90, KBG 96. Whiff FAF 97 (motion final_start); end FAF 70.
+    // UNVERIFIED-simplified: the barrage's own knockback (FKB 40) is the scene's.
+    // UNVERIFIED: every box's x/y offset, and any radius not quoted above —
+    // stand-ins, since the scripts hang the boxes off `virtualfinalattack`.
+    finalSmash: {
+      slot: "finalSmash",
+      name: "Jungle Rush",
+      totalFrames: 96,
+      intangible: [1, 96],
+      final: { phase: "start", trap: true, next: "finalAttack", nextAt: 37 },
+      hitboxes: [{ ...finalBox(0, 29, 34, { damage: 12, angle: 361, kbg: 0, radius: 13, x: 8, y: 10 }), x2: fx(28), y2: fx(10) }],
+    },
+    finalAttack: {
+      slot: "finalAttack",
+      name: "Jungle Rush (barrage)",
+      totalFrames: 131,
+      intangible: [1, 131],
+      final: { phase: "attack", next: "finalEnd" },
+      hitboxes: [
+        ...barrage(0, 6, 18, 4, { damage: 1.2, angle: 135, kbg: 100, fkb: 40, radius: 8.5 }),
+        ...barrage(18, 79, 13, 4, { damage: 1.1, angle: 135, kbg: 100, fkb: 40, radius: 8.5 }),
+      ],
+    },
+    finalEnd: {
+      slot: "finalEnd",
+      name: "Jungle Rush (uppercut)",
+      totalFrames: 69,
+      intangible: [1, 69],
+      final: { phase: "end" },
+      hitboxes: [finalBox(0, 7, 8, { damage: 14, angle: 70, kbg: 96, bkb: 90, radius: 15, y: 11 })],
+    },
   },
 
   palette: {
     primary: "#8B4513", // fur brown
```

`src/fighters/finalKit.ts` (new file):

```ts
/**
 * Building blocks for the Final Smashes (Plan 5, Tasks 15–16).
 *
 * The published `final` scripts hang their scene's boxes off
 * `virtualfinalattack` bones the cutscene puts on each trapped fighter, so the
 * boxes here are root-bone stand-ins: in the scene they reach every trapped
 * fighter wherever they are (`engine/final.ts`), and only their numbers and
 * frames matter. The damage, angle, knockback and frames are quoted in the
 * fighter file that uses them; the defaults here (`x` 10, `y` 8, `radius`
 * 10) and any offset a fighter file does not quote are UNVERIFIED stand-ins.
 */

import { fx } from "@/engine/fixed";
import type { Hitbox } from "@/engine/types";

export interface Hit {
  readonly damage: number;
  readonly angle: number;
  readonly kbg: number;
  readonly bkb?: number;
  /** Set ("fixed") knockback, raw; 0 or absent for none. */
  readonly fkb?: number;
  readonly radius?: number;
  readonly x?: number;
  readonly y?: number;
}

/** One box, live on `from`–`to` (game frames). */
export function finalBox(id: number, from: number, to: number, h: Hit): Hitbox {
  const set = h.fkb !== undefined && h.fkb > 0;
  return {
    id,
    startFrame: from,
    endFrame: to,
    x: fx(h.x ?? 10),
    y: fx(h.y ?? 8),
    radius: fx(h.radius ?? 10),
    damage: fx(h.damage),
    angle: fx(h.angle),
    baseKnockback: fx(set ? (h.fkb as number) : (h.bkb ?? 0)),
    knockbackGrowth: fx(h.kbg),
    ...(set ? { setKnockback: true } : {}),
  };
}

/** `count` one-frame hits, `every` frames apart from `from`: a scene's barrage. Ids from `firstId`. */
export function barrage(firstId: number, from: number, count: number, every: number, h: Hit): Hitbox[] {
  return Array.from({ length: count }, (_, i) => finalBox(firstId + i, from + i * every, from + i * every, h));
}
```

`src/fighters/fox.ts` — apply:

```diff
--- a/src/fighters/fox.ts
+++ b/src/fighters/fox.ts
@@ -21,8 +21,9 @@
  * Sources and conventions as documented at the top of `mario.ts`.
  */
 
 import { fx } from "@/engine/fixed";
+import { barrage, finalBox } from "./finalKit";
 import type { FighterDef } from "@/engine/types";
 import { ACTIVE_SCRIPT_SLOTS, withReferenceScripts } from "./acmd/active";
 import { FOX } from "./acmd/generated/fox";
 import { FIGHTER_PARAMS } from "./params";
@@ -956,8 +957,42 @@ const legacy: FighterDef = {
           knockbackGrowth: fx(100),
         },
       ],
     },
+
+    // Plan 5 — Team Star Fox (rubendal Data Viewer 13.0.1 `game_finallockon`,
+    // fox_arwingshot `Main`; SmashWiki "Team Star Fox": "Anyone hit by the
+    // reticle will be sent into a cutscene"). The reticle (3%, angle 80, FKB
+    // 200, radius 18, frame 28) traps; the Arwings' shots are 3%, angle 80,
+    // FKB 200, the last of them the launch. UNVERIFIED: how many shots the
+    // scene fires (ten here, six frames apart), the reticle's reach and the
+    // phases' lengths — SmashWiki and the scripts publish neither.
+    // UNVERIFIED: every box's x/y offset, and any radius not quoted above —
+    // stand-ins, since the scripts hang the boxes off `virtualfinalattack`.
+    finalSmash: {
+      slot: "finalSmash",
+      name: "Team Star Fox",
+      totalFrames: 60,
+      intangible: [1, 60],
+      final: { phase: "start", trap: true, next: "finalAttack", nextAt: 30 },
+      hitboxes: [finalBox(0, 28, 29, { damage: 3, angle: 80, kbg: 100, fkb: 200, radius: 18, x: 20, y: 8 })],
+    },
+    finalAttack: {
+      slot: "finalAttack",
+      name: "Team Star Fox (Arwings)",
+      totalFrames: 70,
+      intangible: [1, 70],
+      final: { phase: "attack", next: "finalEnd" },
+      hitboxes: barrage(0, 10, 10, 6, { damage: 3, angle: 80, kbg: 100, fkb: 200, radius: 20 }),
+    },
+    finalEnd: {
+      slot: "finalEnd",
+      name: "Team Star Fox (last shot)",
+      totalFrames: 30,
+      intangible: [1, 30],
+      final: { phase: "end" },
+      hitboxes: [finalBox(0, 5, 6, { damage: 3, angle: 80, kbg: 100, fkb: 200, radius: 20 })],
+    },
   },
 
   palette: {
     // Fur, pulled toward tan-gold rather than the pure orange it is usually
```

`src/fighters/kirby.ts` — apply:

```diff
--- a/src/fighters/kirby.ts
+++ b/src/fighters/kirby.ts
@@ -17,8 +17,9 @@
  * Sources and conventions as documented at the top of `mario.ts`.
  */
 
 import { fx } from "@/engine/fixed";
+import { finalBox } from "./finalKit";
 import type { FighterDef } from "@/engine/types";
 import { ACTIVE_SCRIPT_SLOTS, withReferenceScripts } from "./acmd/active";
 import { KIRBY } from "./acmd/generated/kirby";
 import { FIGHTER_PARAMS } from "./params";
@@ -1010,8 +1011,43 @@ const legacy: FighterDef = {
           knockbackGrowth: fx(180),
         },
       ],
     },
+
+    // Plan 5 — Ultra Sword (rubendal Data Viewer 13.0.1 `game_finalstart`,
+    // `game_finalattack`; SmashWiki "Ultra Sword": "a total of 40% damage",
+    // "Make sure the first swing connects with an opponent, or nothing else
+    // happens!"). The first swing (3%, angle 22, FKB 30, frames 17-19) traps;
+    // eight slashes of 2.6% follow on frames 21, 35, 48, 59, 71, 83, 97 and
+    // 109 of the attack, and the last, sword grown, is 16%, angle 45, KBG 95,
+    // BKB 75 on its frame 173 (here frame 63 of the end). 3 + 8 × 2.6 + 16 =
+    // 39.8. FAF: final_start 87 (whiff), final_attack 219.
+    // UNVERIFIED: every box's x/y offset, and any radius not quoted above —
+    // stand-ins, since the scripts hang the boxes off `virtualfinalattack`.
+    finalSmash: {
+      slot: "finalSmash",
+      name: "Ultra Sword",
+      totalFrames: 86,
+      intangible: [1, 86],
+      final: { phase: "start", trap: true, next: "finalAttack", nextAt: 22 },
+      hitboxes: [finalBox(0, 17, 19, { damage: 3, angle: 22, kbg: 100, fkb: 30, radius: 10, x: 15, y: 8 })],
+    },
+    finalAttack: {
+      slot: "finalAttack",
+      name: "Ultra Sword (slashes)",
+      totalFrames: 110,
+      intangible: [1, 110],
+      final: { phase: "attack", next: "finalEnd" },
+      hitboxes: [21, 35, 48, 59, 71, 83, 97, 109].map((f, i) => finalBox(i, f, f, { damage: 2.6, angle: 367, kbg: 140, fkb: 20, radius: 12 })),
+    },
+    finalEnd: {
+      slot: "finalEnd",
+      name: "Ultra Sword (last slash)",
+      totalFrames: 108,
+      intangible: [1, 108],
+      final: { phase: "end" },
+      hitboxes: [finalBox(0, 63, 64, { damage: 16, angle: 45, kbg: 95, bkb: 75, radius: 10 })],
+    },
   },
 
   palette: {
     primary: "#F49AC1", // the pink everyone knows
```

`src/fighters/marth.ts` — apply:

```diff
--- a/src/fighters/marth.ts
+++ b/src/fighters/marth.ts
@@ -47,8 +47,9 @@
  * Sources and conventions as documented at the top of `mario.ts`.
  */
 
 import { fx } from "@/engine/fixed";
+import { finalBox } from "./finalKit";
 import type { FighterDef } from "@/engine/types";
 import { ACTIVE_SCRIPT_SLOTS, withReferenceScripts } from "./acmd/active";
 import { MARTH } from "./acmd/generated/marth";
 import { FIGHTER_PARAMS } from "./params";
@@ -1043,8 +1044,35 @@ const legacy: FighterDef = {
           knockbackGrowth: fx(57),
         },
       ],
     },
+
+    // Plan 5 — Critical Hit (rubendal Data Viewer 13.0.1 `game_finaldash`,
+    // `game_finalend`; SmashWiki "Critical Hit": "If the attack connects, it
+    // has the potential to be a one-hit KO"). The dash's catch box (radius 10
+    // on the sword) traps; the strike is 60%, angle 361, KBG 120, BKB 120,
+    // radius 18, on its frame 2. FAF: final_dash_end 85 (whiff), final_end 60.
+    // UNVERIFIED: the dash itself (frames 25-70, 6 units a frame) — SSBU moves
+    // Marth by animation, which is unpublished.
+    // UNVERIFIED: every box's x/y offset, and any radius not quoted above —
+    // stand-ins, since the scripts hang the boxes off `virtualfinalattack`.
+    finalSmash: {
+      slot: "finalSmash",
+      name: "Critical Hit",
+      totalFrames: 85,
+      intangible: [1, 85],
+      momentum: [{ frame: 25, x: fx(6), y: fx(0), hold: 45 }],
+      final: { phase: "start", trap: true, next: "finalEnd", nextAt: 25 },
+      hitboxes: [finalBox(0, 25, 70, { damage: 0, angle: 361, kbg: 0, radius: 10, x: 8, y: 7 })],
+    },
+    finalEnd: {
+      slot: "finalEnd",
+      name: "Critical Hit (strike)",
+      totalFrames: 59,
+      intangible: [1, 59],
+      final: { phase: "end" },
+      hitboxes: [finalBox(0, 2, 5, { damage: 60, angle: 361, kbg: 120, bkb: 120, radius: 18, x: 16, y: 8 })],
+    },
   },
 
   palette: {
     primary: "#2B4FC9", // the tunic blue
```

`src/fighters/pikachu.ts` — apply:

```diff
--- a/src/fighters/pikachu.ts
+++ b/src/fighters/pikachu.ts
@@ -15,8 +15,9 @@
  * Sources and conventions as documented at the top of `mario.ts`.
  */
 
 import { fx } from "@/engine/fixed";
+import { barrage, finalBox } from "./finalKit";
 import type { FighterDef } from "@/engine/types";
 import { ACTIVE_SCRIPT_SLOTS, withReferenceScripts } from "./acmd/active";
 import { PIKACHU } from "./acmd/generated/pikachu";
 import { FIGHTER_PARAMS } from "./params";
@@ -929,8 +930,47 @@ const legacy: FighterDef = {
           knockbackGrowth: fx(100),
         },
       ],
     },
+
+    // Plan 5 — Volt Tackle (rubendal Data Viewer 13.0.1 `game_final`,
+    // `game_finalattack`, `game_finaldash`; SmashWiki "Volt Tackle": "If the
+    // tackle connects, Pikachu dashes around the stage to deal more damage and
+    // ends with an electric blast", and the game's own description it quotes:
+    // "Finally, Pikachu unleashes a powerful spark"). The tackle's 0.3% box
+    // (angle 70, FKB 20) traps from frame 10; the dashes are 1.5%, angle 366,
+    // FKB 100; the spark is `game_finaldash`'s 1%, angle 90, KBG 45, FKB 125,
+    // radius 13. FAF: final2 80 (whiff), final_dash_end 78. UNVERIFIED: the
+    // tackle's speed (4.5 a frame for frames 10-46), the number of dashes
+    // (eight, eight frames apart) and that the spark is `game_finaldash`'s box
+    // — Ultimate's counts are status-driven and unpublished.
+    // UNVERIFIED: every box's x/y offset, and any radius not quoted above —
+    // stand-ins, since the scripts hang the boxes off `virtualfinalattack`.
+    finalSmash: {
+      slot: "finalSmash",
+      name: "Volt Tackle",
+      totalFrames: 80,
+      intangible: [1, 80],
+      momentum: [{ frame: 10, x: fx(4.5), y: fx(0), hold: 36 }],
+      final: { phase: "start", trap: true, next: "finalAttack", nextAt: 10 },
+      hitboxes: [finalBox(0, 10, 46, { damage: 0.3, angle: 70, kbg: 70, fkb: 20, radius: 5.5, x: 0, y: 5 })],
+    },
+    finalAttack: {
+      slot: "finalAttack",
+      name: "Volt Tackle (dashes)",
+      totalFrames: 70,
+      intangible: [1, 70],
+      final: { phase: "attack", next: "finalEnd" },
+      hitboxes: barrage(0, 6, 8, 8, { damage: 1.5, angle: 366, kbg: 90, fkb: 100, radius: 13 }),
+    },
+    finalEnd: {
+      slot: "finalEnd",
+      name: "Volt Tackle (spark)",
+      totalFrames: 77,
+      intangible: [1, 77],
+      final: { phase: "end" },
+      hitboxes: [finalBox(0, 4, 5, { damage: 1, angle: 90, kbg: 45, fkb: 125, radius: 13 })],
+    },
   },
 
   palette: {
     primary: "#F5D547", // the yellow
```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/fighters/finalSmash.test.ts src/fighters/schema.test.ts`
Expected: PASS (`src/fighters/finalSmash.test.ts` 2 tests).

- [ ] **Step 5: Regenerate the generated files, in this order**

Each command rewrites one artefact from the code; the order matters (the limb list feeds the reconcile list and the bake, the bake feeds reach). Then review each diff against the scratch result below.

```bash
UPDATE_RECONCILE=1 pnpm vitest run src/fighters/acmd/reconcile.test.ts
UPDATE_BAKE=1 pnpm vitest run src/render3d/bake/roster.test.ts
```

`src/fighters/acmd/reconcile.allow.json` — the expected change:

```diff
--- a/src/fighters/acmd/reconcile.allow.json
+++ b/src/fighters/acmd/reconcile.allow.json
@@ -20,8 +20,9 @@
   "kirby sideB faf": "legacy 70 / game_specials 55",
   "kirby upB hitboxes": "legacy some / game_specialhi none",
   "kirby downB hitboxes": "legacy some / game_speciallw none",
   "kirby uthrow hitboxes": "legacy none / game_throwhi some",
+  "kirby finalSmash last": "legacy 19 / game_finalstart 60",
   "fox rapidJab first": "legacy 5 / game_attack100 1",
   "fox rapidJab last": "legacy 33 / game_attack100 8",
   "fox utilt lead": "legacy 8%/110°/bkb20/kbg110 / game_attackhi3 6%/110°/bkb20/kbg125",
   "fox fair lead": "legacy 1.8%/365°/fkb120/kbg100 / game_attackairf 1.8%/367°/fkb120/kbg100",
@@ -29,13 +30,16 @@
   "fox upB first": "legacy 20 / game_specialhi 1",
   "fox upB last": "legacy 72 / game_specialhi 300",
   "fox upB lead": "legacy 1.8%/105°/bkb20/kbg20 / game_specialhi 16%/60°/bkb70/kbg60",
   "fox downB last": "legacy 3 / game_speciallwstart 300",
+  "fox finalSmash hitboxes": "legacy some / game_finalstart none",
   "pikachu sideB first": "legacy 18 / game_specials 5",
   "pikachu sideB last": "legacy 52 / game_specials 300",
   "pikachu sideB lead": "legacy 6.2%/361°/bkb40/kbg78 / game_specials 1%/361°/bkb40/kbg78",
   "pikachu upB first": "legacy 15 / game_specialhi1 1",
   "pikachu upB last": "legacy 33 / game_specialhi1 300",
   "pikachu downB hitboxes": "legacy some / game_speciallw none",
+  "pikachu finalSmash last": "legacy 46 / game_final 49",
   "marth dashAttack lead": "legacy 13%/45°/bkb93/kbg58 / game_attackdash 10%/45°/bkb70/kbg55",
-  "marth bair lead": "legacy 12.5%/361°/bkb40/kbg94 / game_attackairb 9%/361°/bkb40/kbg85"
+  "marth bair lead": "legacy 12.5%/361°/bkb40/kbg94 / game_attackairb 9%/361°/bkb40/kbg85",
+  "marth finalSmash hitboxes": "legacy some / game_finalstart none"
 }
```

`src/fighters/bake/digest.ts` — the bake's new digest:

```diff
--- a/src/fighters/bake/digest.ts
+++ b/src/fighters/bake/digest.ts
@@ -1,5 +1,5 @@
 // GENERATED by src/render3d/bake/roster.test.ts (UPDATE_BAKE=1) — do not edit by hand.
 /** SHA-256 of the uncompressed public/bake/roster.bin.gz: the bake's fingerprint. */
-export const BAKE_DIGEST = "2c4d4fda2c30f600b0248ba46cff9305c9d013995f011a8f78c056277e4bb767";
+export const BAKE_DIGEST = "52113411b3f97bfaac119d23d396d996f88da58b3bb353d5b0c179e9f85cc01b";
 /** Its uncompressed length in bytes. */
-export const BAKE_BYTES = 5981690;
+export const BAKE_BYTES = 6244056;
```

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0; golden trace untouched.

- [ ] **Step 7: Commit**

```bash
git add super-smash/public/bake/roster.bin.gz super-smash/src/engine/final.ts super-smash/src/engine/status/attack.ts super-smash/src/engine/types.ts super-smash/src/fighters/acmd/reconcile.allow.json super-smash/src/fighters/bake/digest.ts super-smash/src/fighters/donkeyKong.ts super-smash/src/fighters/finalKit.ts super-smash/src/fighters/finalSmash.test.ts super-smash/src/fighters/fox.ts super-smash/src/fighters/kirby.ts super-smash/src/fighters/marth.ts super-smash/src/fighters/pikachu.ts super-smash/src/fighters/schema.test.ts
git commit -m "super-smash: five cinematic Final Smashes from their game_final scripts" -m "Jungle Rush, Critical Hit, Ultra Sword, Team Star Fox and Volt Tackle trap, play their scene in the sim and launch; per-hit values from game_final* and SmashWiki, box offsets and unquoted radii UNVERIFIED. Reconcile +4 (start-only references). Bake regenerated. Golden trace unchanged." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Mario Finale, Zero Laser, Ancient Bow and Arrow; rehits and staged projectiles

The three non-cinematic Final Smashes are big projectiles. Mario Finale and Zero Laser are multi-hit beams (`ProjectileDef.rehit`, `stages`: a beam that grows). SmashWiki (Mario (SSBU)/Final Smash): the flames are generated on frame 5 and their hits are "Early 65-104", "Mid 105-154" and "Late 155-224" — so, in the flames' own frames, 60–99, 100–149 and 150–219. Link's Ancient Bow and Arrow is one transcendent 35% arrow (SmashWiki). `MoveDef.rehit` re-arms a move's boxes every n frames, and joins `PLAN5_BEHAVIOUR`. The legacy compiler now keeps a capsule's far end (`x2`/`y2`), which the beams need. UNVERIFIED: Mario Finale's flame speed (0.3) and launch offset, Zero Laser's height (9) and offsets, the arrow's radius.

**Files:**
- Modify: `super-smash/src/engine/acmd/legacy.ts`, `super-smash/src/engine/projectile.ts`, `super-smash/src/engine/simulate.ts`, `super-smash/src/engine/types.ts`, `super-smash/src/fighters/acmd/activate.test.ts`, `super-smash/src/fighters/acmd/active.ts`, `super-smash/src/fighters/finalSmash.test.ts`, `super-smash/src/fighters/link.ts`, `super-smash/src/fighters/mario.ts`, `super-smash/src/fighters/samus.ts`, `super-smash/src/fighters/schema.test.ts`, `super-smash/src/render/chars/link/fx.ts`
- Regenerate: `super-smash/public/bake/roster.bin.gz`, `super-smash/src/fighters/acmd/reconcile.allow.json`, `super-smash/src/fighters/bake/digest.ts`

**Interfaces:**
- Consumes: `spawnProjectile`, `projectileHitbox` (Tasks 1–2), `attackFromHitbox` (Plan 2 `acmd/legacy.ts`).
- Produces: `ProjectileDef.rehit?`, `.stages?`; `MoveDef.rehit?`; `finalSmash` moves for Mario, Samus, Link; Link's `ancientArrow` painter.

- [ ] **Step 1: Write the failing tests**

`src/fighters/acmd/activate.test.ts` — apply:

```diff
--- a/src/fighters/acmd/activate.test.ts
+++ b/src/fighters/acmd/activate.test.ts
@@ -71,9 +71,9 @@ describe("a freed move in a match", () => {
 });
 
 describe("what keeps a move on its legacy frames (Plan 5 review)", () => {
   it("lists every Plan 5 field the script cannot carry", () => {
-    expect(PLAN5_BEHAVIOUR).toEqual(expect.arrayContaining(["intangible", "turnAt", "copyDamage", "final"]));
+    expect(PLAN5_BEHAVIOUR).toEqual(expect.arrayContaining(["intangible", "turnAt", "copyDamage", "final", "rehit"]));
   });
 
   it("keeps a move with any of them off its script, even one whose script would run", () => {
     // Mario's jab runs its script (ACTIVE_SCRIPT_SLOTS); with a Plan 5 field it must not.
```

`src/fighters/finalSmash.test.ts` — apply:

```diff
--- a/src/fighters/finalSmash.test.ts
+++ b/src/fighters/finalSmash.test.ts
@@ -100,4 +100,56 @@ describe("Jungle Rush against Marth's Counter (UNVERIFIED: a Final Smash is not
     expect(states.some((x) => x.fighters[1].action === "finalTrapped")).toBe(true);
     expect(states.some((x) => x.cinematic === 0)).toBe(true);
   });
 });
+
+describe("Final Smashes that are not cinematics", () => {
+  it("Mario Finale: the flames hit again and again, hotter as they go, and trap nobody", () => {
+    const { states, events } = run(ready("mario", 45), 240);
+    // Seven frames between hits: the flame's rehit.
+    const onMario = events.flatMap((e) => e.hits).filter((h) => h.victim === 1);
+    // SmashWiki "Mario (SSBU)/Final Smash": the flames, out on frame 5, first
+    // hit on frame 65 ("Early hits 65-104"); event i is game frame i + 1.
+    const first = events.findIndex((e) => e.hits.some((h) => h.victim === 1));
+    expect(first + 1).toBe(65);
+    expect(onMario.length).toBeGreaterThan(5);
+    const damages = new Set(onMario.map((h) => Math.round(toFloat(h.damage) * 100)));
+    // 2.5% early, then the hotter stages; a projectile is never staled (or freshened).
+    expect(damages.has(250)).toBe(true);
+    expect(damages.has(300)).toBe(true);
+    expect(damages.has(350)).toBe(true);
+    expect(states.every((s) => s.cinematic === -1 && s.fighters[1].action !== "finalTrapped")).toBe(true);
+  });
+
+  it("Zero Laser: the beam hits every 10 frames along its length", () => {
+    const { events } = run(ready("samus", 90), 160);
+    const onMario = events.flatMap((e, i) => e.hits.filter((h) => h.victim === 1).map(() => i));
+    expect(onMario.length).toBeGreaterThan(8);
+    const gaps = onMario.slice(1).map((f, i) => f - onMario[i]);
+    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(10);
+  });
+
+  it("Ancient Bow and Arrow: the first fighter in line takes 35%, the one behind nothing", () => {
+    const s = ready("link", 50);
+    // Fox stands further along the same line, behind Mario.
+    s.fighters[2].x = fx(60);
+    const { events } = run(s, 140);
+    const hits = events.flatMap((e) => e.hits);
+    const onMario = hits.filter((h) => h.victim === 1);
+    expect(onMario).toHaveLength(1);
+    expect(toFloat(onMario[0].damage)).toBeCloseTo(35, 1);
+    expect(hits.filter((h) => h.victim === 2)).toHaveLength(0);
+  });
+});
+
+describe("the Smash Ball's power", () => {
+  it("is not lost to time: a Final Smash ready stays ready until used", () => {
+    const s = ready("mario", 40);
+    let st = s;
+    let prev: InputFrame[] = [0, 0, 0];
+    for (let i = 0; i < 1200; i++) {
+      st = step(st, [0, 0, 0], { prevInputs: prev }).state;
+      prev = [0, 0, 0];
+    }
+    expect(st.fighters[0].finalSmashReady).toBe(FINAL_SMASH_READY);
+  });
+});
```

`src/fighters/schema.test.ts` — apply:

```diff
--- a/src/fighters/schema.test.ts
+++ b/src/fighters/schema.test.ts
@@ -263,9 +263,10 @@ describe("projectiles", () => {
     const owners = FIGHTERS.filter((f) => everyProjectile(f).length > 0).map((f) => f.id);
     // Plan 5: Kirby's spit fires the spat fighter as a star.
     expect(new Set(owners)).toEqual(new Set(["mario", "link", "samus", "kirby", "fox", "pikachu"]));
 
-    const linkProjectiles = everyProjectile(getFighterOrThrow("link"));
+    // Plan 5: a Final Smash's arrows and flames are not specials.
+    const linkProjectiles = everyProjectile(getFighterOrThrow("link")).filter((p) => p.slot !== "finalSmash");
     expect(linkProjectiles).toHaveLength(3);
     expect(new Set(linkProjectiles.map((p) => p.slot))).toEqual(
       new Set(["neutralB", "sideB", "downB"])
     );
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/fighters/acmd/activate.test.ts src/fighters/finalSmash.test.ts src/fighters/schema.test.ts`
Expected: FAIL — 4 failed | 331 passed — `expected 35 to be 65` (no Mario Finale: the first hit is not on frame 65), `expected 0 to be greater than 8` (no Zero Laser), `expected 4 to be close to 35` (no Ancient Arrow), `expected [ 'specialCharge', 'reflector', …(10) ] to deeply equal ArrayContaining{…}` (no `rehit` in `PLAN5_BEHAVIOUR`).

- [ ] **Step 3: Implement**

`src/engine/acmd/legacy.ts` — apply:

```diff
--- a/src/engine/acmd/legacy.ts
+++ b/src/engine/acmd/legacy.ts
@@ -74,8 +74,10 @@ export function attackFromHitbox(hb: Hitbox): AttackParams {
     size: hb.radius,
     x: 0,
     y: hb.y,
     z: hb.x,
+    // An extended box keeps its far end (Plan 5: the Final Smashes' beams).
+    ...(hb.x2 !== undefined && hb.y2 !== undefined ? { x2: 0, y2: hb.y2, z2: hb.x2 } : {}),
     hitlag: hb.hitlagMultiplier ?? ONE,
     sdi: ONE,
     clang: hb.transcendent ? "ATTACK_SETOFF_KIND_THRU" : "ATTACK_SETOFF_KIND_ON",
     facing: "ATTACK_LR_CHECK_F",
```

`src/engine/projectile.ts` — apply:

```diff
--- a/src/engine/projectile.ts
+++ b/src/engine/projectile.ts
@@ -20,8 +20,9 @@ import { ONE, fx, abs, mul } from "./fixed";
 import { SMASH_CHARGE_MAX } from "./constants";
 import { HARD_PLATFORM_DEPTH, platformCentreX } from "./physics";
 import { chargedHitbox } from "./specialCharge";
 import type {
+  ChargedHitbox,
   FighterDef,
   FighterState,
   Hitbox,
   MoveDef,
@@ -132,9 +133,13 @@ export function projectilesDueOnFrame(move: MoveDef, moveFrame: number): readonl
 }
 
 /** This projectile's hitbox, at the charge it was launched with (Plan 5). */
 export function projectileHitbox(p: ProjectileState, def: ProjectileDef): Hitbox {
-  return def.charged === undefined ? def.hitbox : chargedHitbox(def.hitbox, def.charged.hitbox, p.charge, def.charged.partial);
+  const base = def.charged === undefined ? def.hitbox : chargedHitbox(def.hitbox, def.charged.hitbox, p.charge, def.charged.partial);
+  // A staged projectile's box is its latest stage reached (Plan 5).
+  let stage: { readonly from: number; readonly hitbox: ChargedHitbox } | undefined;
+  for (const st of def.stages ?? []) if (p.age >= st.from) stage = st;
+  return stage === undefined ? base : { ...base, ...stage.hitbox };
 }
 
 /** Is this projectile's hitbox live? Its frames are counted from the spawn. */
 export function projectileHitboxActive(p: ProjectileState, def: ProjectileDef): boolean {
@@ -164,8 +169,10 @@ export function advanceProjectile(
   const prevY = p.y;
 
   p.age += 1;
   if (p.age > def.lifetime) return { alive: false, prevX, prevY };
+  // A rehitting projectile forgets whom it hit, every `rehit` frames (Plan 5).
+  if (def.rehit !== undefined && p.age % def.rehit === 0) p.hitPorts.length = 0;
 
   // A boomerang turns at the halfway point of its life, which is what makes its
   // range a fixed distance rather than a function of how long you hold it.
   if (def.returns === true && !p.returning && p.age * 2 >= def.lifetime) {
```

`src/engine/simulate.ts` — apply:

```diff
--- a/src/engine/simulate.ts
+++ b/src/engine/simulate.ts
@@ -855,8 +855,11 @@ function gatherHitboxes(
     // `AttackModule::clear_all` ends the swing's hit record with its boxes, so a
     // box the script issues again can hit again — how a multi-hit works. Legacy
     // moves only ever clear by id, and keep one hit per swing (Plan 3, Task 16).
     if (run.state.fired.some((cmd) => cmd.op === "clearAll")) clearHitRecord(f);
+    // A rehitting move re-arms every `rehit` frames (Plan 5: Zero Laser).
+    const rehit = defs[i].moves[f.move]?.rehit;
+    if (rehit !== undefined && run.gameFrame % rehit === 0) clearHitRecord(f);
     const live = scriptHitboxes(run.state, defs[i].id, run.script.motion, run.gameFrame, bones);
     // A charged special's boxes grow towards their full-charge values (Plan 5);
     // a smash's charge stays the damage multiplier it always was.
     const sc = defs[i].moves[f.move]?.specialCharge;
```

`src/engine/types.ts` — apply:

```diff
--- a/src/engine/types.ts
+++ b/src/engine/types.ts
@@ -316,8 +316,12 @@ export interface ProjectileDef {
   /** Drawing hint for the renderer. */
   readonly visual: "arrow" | "bomb" | "boomerang" | "energy" | "fire" | "spark" | "missile";
   /** A reflector can send it back (Plan 5): the article's `ATTACK(…, Reflectable=true)`. */
   readonly reflectable?: boolean;
+  /** It hits the same fighter again every this many frames (smash-script `Rehit`; Plan 5: Mario Finale). */
+  readonly rehit?: number;
+  /** From these ages on its box changes (Plan 5: Mario Finale's flames grow hotter). */
+  readonly stages?: readonly { readonly from: number; readonly hitbox: ChargedHitbox }[];
   /** Speed lost per frame, and the speed below which it is gone (Plan 5: Kirby's star). */
   readonly drag?: { readonly perFrame: number; readonly minSpeed: number };
 }
 
@@ -469,8 +473,10 @@ export interface MoveDef {
   /** The frame a throw turns the thrower round (`REVERSE_LR`, Plan 5). */
   readonly turnAt?: number;
   /** Its catch boxes swallow rather than grab (Plan 5: Kirby's Inhale). */
   readonly inhale?: InhaleDef;
+  /** Its boxes hit the same fighter again every this many frames (smash-script `Rehit`; Plan 5: Zero Laser). */
+  readonly rehit?: number;
   /** Which part of a Final Smash this move is (Plan 5, `final.ts`). */
   readonly final?: FinalPhase;
   /** A copied move's damage multiplier, knockback untouched (Plan 5: Kirby's Copy Ability, ×1.2). */
   readonly copyDamage?: number;
```

`src/fighters/acmd/active.ts` — apply:

```diff
--- a/src/fighters/acmd/active.ts
+++ b/src/fighters/acmd/active.ts
@@ -102,10 +102,10 @@ function runnable(commands: readonly AcmdCommand[], bones: Set<string>, throwing
  * `moveSpawns`, `moveSuperArmour`, `smashHoldFrame`). These stay, because the
  * script cannot carry them: a charge loop, a reflector or counter window, a
  * mouthful, a carry, a stall, the frames of the move's own intangibility, a
  * throw's turn, a copied move's damage, a Final Smash's phase (whose cutscene
- * boxes hang off `virtualfinalattack` bones no skeleton has). Task 16 adds
- * rehits (`rehit`).
+ * boxes hang off `virtualfinalattack` bones no skeleton has), a box that
+ * hits again every so many frames (`rehit`).
  */
 export const PLAN5_BEHAVIOUR: (keyof MoveDef)[] = [
   "specialCharge",
   "reflector",
@@ -118,8 +118,9 @@ export const PLAN5_BEHAVIOUR: (keyof MoveDef)[] = [
   "intangible",
   "turnAt",
   "copyDamage",
   "final",
+  "rehit",
 ];
 
 /** Plan 3's bones: the root alone, the only bone `LEGACY_BONE_TABLE` places. */
 export const ROOT_BONE_ONLY = (bone: string): boolean => bone === "top";
```

`src/fighters/link.ts` — apply:

```diff
--- a/src/fighters/link.ts
+++ b/src/fighters/link.ts
@@ -876,8 +876,41 @@ const legacy: FighterDef = {
           knockbackGrowth: fx(125),
         },
       ],
     },
+
+    // Plan 5 — Ancient Bow and Arrow (rubendal Data Viewer 13.0.1 `game_final`,
+    // link_ancientbowarrow `Fly`/`Stick`; SmashWiki "Ancient Bow and Arrow":
+    // "fires an Ancient Arrow straight ahead, hitting the first person in his
+    // line of sight"). Shot on frame 60; the explosion on a fighter is 35%,
+    // angle 60, KBG 46, BKB 102. UNVERIFIED-simplified: the arrow's speed (6 a
+    // frame) and the move's length (100); the explosion lands on the fighter
+    // the arrow reaches rather than everybody within its 25 units, and the
+    // 20% blast on a wall or floor is not modelled. UNVERIFIED: the arrow's
+    // box radius (5) and launch offset.
+    finalSmash: {
+      slot: "finalSmash",
+      name: "Ancient Bow and Arrow",
+      totalFrames: 100,
+      intangible: [1, 100],
+      final: { phase: "start" },
+      hitboxes: [],
+      projectiles: [
+        {
+          id: "ancientArrow",
+          spawnFrame: 60,
+          offsetX: fx(10.0),
+          offsetY: fx(7.0),
+          vx: fx(6.0),
+          vy: fx(0),
+          gravity: fx(0),
+          lifetime: 60,
+          destroyOnHit: true,
+          visual: "arrow",
+          hitbox: { id: 0, startFrame: 0, endFrame: 60, x: fx(0), y: fx(0), radius: fx(5.0), damage: fx(35.0), angle: fx(60), baseKnockback: fx(102), knockbackGrowth: fx(46), transcendent: true },
+        },
+      ],
+    },
   },
 
   palette: {
     primary: "#3A8C3A", // the champion's tunic
```

`src/fighters/mario.ts` — apply:

```diff
--- a/src/fighters/mario.ts
+++ b/src/fighters/mario.ts
@@ -963,8 +963,50 @@ const legacy: FighterDef = {
           knockbackGrowth: fx(90),
         },
       ],
     },
+
+    // Plan 5 — Mario Finale (SmashWiki "Mario (SSBU)/Final Smash"; rubendal
+    // Data Viewer 13.0.1 `game_final`, mario_hugeflame `Regular`). Not a
+    // cinematic: two huge flames sweep forward, "Early hits 65-104" 2.5%
+    // (angle 50, BKB 25, KBG 40), then 3.0% (angle 23, BKB 20, KBG 90) and
+    // "Late hits 155-224" 3.5% (angle 23, BKB 10, KBG 120), "rehit rate: 7",
+    // radius 16; "It also has no finishing hitbox". The flames are generated
+    // on frame 5, so in the flames' own frames (from 0 at their spawn) early
+    // hits are 60-99, mid hits ("105-154") 100-149 and late hits 150-219, the
+    // last at the page's frame 224. Intangible throughout (WHOLE_HIT
+    // XLU); FAF 157 (motion final). UNVERIFIED: the flames' speed (0.3 a
+    // frame, so they are still in front of Mario when they start to burn); the
+    // second flame (fire2), a few degrees steeper, is not modelled; the
+    // flames' launch offset (10 ahead, 8 up).
+    finalSmash: {
+      slot: "finalSmash",
+      name: "Mario Finale",
+      totalFrames: 156,
+      intangible: [1, 156],
+      final: { phase: "start" },
+      hitboxes: [],
+      projectiles: [
+        {
+          id: "hugeFlame",
+          spawnFrame: 5,
+          offsetX: fx(10.0),
+          offsetY: fx(8.0),
+          vx: fx(0.3),
+          vy: fx(0),
+          gravity: fx(0),
+          lifetime: 220,
+          destroyOnHit: false,
+          rehit: 7,
+          visual: "fire",
+          stages: [
+            { from: 100, hitbox: { damage: fx(3.0), angle: fx(23), baseKnockback: fx(20), knockbackGrowth: fx(90) } },
+            { from: 150, hitbox: { damage: fx(3.5), angle: fx(23), baseKnockback: fx(10), knockbackGrowth: fx(120) } },
+          ],
+          hitbox: { id: 0, startFrame: 60, endFrame: 219, x: fx(0), y: fx(0), radius: fx(16.0), damage: fx(2.5), angle: fx(50), baseKnockback: fx(25), knockbackGrowth: fx(40), effect: "fire", transcendent: true },
+        },
+      ],
+    },
   },
 
   palette: {
     primary: "#E52521", // the shirt red, sampled from Ultimate's default
```

`src/fighters/samus.ts` — apply:

```diff
--- a/src/fighters/samus.ts
+++ b/src/fighters/samus.ts
@@ -13,8 +13,9 @@
  * Sources and conventions as documented at the top of `mario.ts`.
  */
 
 import { fx } from "@/engine/fixed";
+import { finalBox } from "./finalKit";
 import type { FighterDef } from "@/engine/types";
 import { ACTIVE_SCRIPT_SLOTS, withReferenceScripts } from "./acmd/active";
 import { SAMUS } from "./acmd/generated/samus";
 import { FIGHTER_PARAMS } from "./params";
@@ -954,8 +955,33 @@ const legacy: FighterDef = {
           knockbackGrowth: fx(75),
         },
       ],
     },
+
+    // Plan 5 — Zero Laser (rubendal Data Viewer 13.0.1 `game_final`,
+    // samus_laser `Shoot`; SmashWiki "Zero Laser": "the attack repeatedly hits
+    // any foes caught in its blast"). The muzzle: 1% (angle 20, FKB 22, radius
+    // 13) frames 1-7, then 2% (radius 15) 8-11; the beam: 1.5% (angle 20, FKB
+    // 16, radius 5), rehit 10, for 128 frames from 12; its end: 5.5%, angle
+    // 361, KBG 183, BKB 45, radius 11, for 8 frames. Not a cinematic.
+    // UNVERIFIED: the beam's height (9, the arm cannon's, where the script's
+    // muzzle boxes sit at 15) and reach (150 units) and the move's length; the
+    // upper/lower beams (laser2, 0.5% pulling in) and aiming are not modelled.
+    // UNVERIFIED: every box's x offset (the script's are on the muzzle article).
+    finalSmash: {
+      slot: "finalSmash",
+      name: "Zero Laser",
+      totalFrames: 194,
+      intangible: [1, 194],
+      rehit: 10,
+      final: { phase: "start" },
+      hitboxes: [
+        finalBox(0, 1, 7, { damage: 1, angle: 20, kbg: 100, fkb: 22, radius: 13, x: 20, y: 15 }),
+        finalBox(1, 8, 11, { damage: 2, angle: 20, kbg: 100, fkb: 22, radius: 15, x: 20, y: 15 }),
+        { ...finalBox(2, 12, 139, { damage: 1.5, angle: 20, kbg: 100, fkb: 16, radius: 5, x: 12, y: 9 }), x2: fx(162), y2: fx(9) },
+        { ...finalBox(3, 140, 147, { damage: 5.5, angle: 361, kbg: 183, bkb: 45, radius: 11, x: 12, y: 9 }), x2: fx(162), y2: fx(9), effect: "electric" },
+      ],
+    },
   },
 
   palette: {
     // Power Suit orange, pushed brighter than the sampled shade so it reads
```

`src/render/chars/link/fx.ts` — apply:

```diff
--- a/src/render/chars/link/fx.ts
+++ b/src/render/chars/link/fx.ts
@@ -795,8 +795,16 @@ export const fx: Partial<Record<MoveSlot, FxFn>> = {
 };
 
 /** Painters for this fighter’s own projectiles, keyed by projectile def id. */
 export const projectiles: Readonly<Record<string, ProjectilePainter>> = {
+  /**
+   * Plan 5: the Ancient Arrow of his Final Smash — his arrow at full draw,
+   * glowing Guardian blue.
+   */
+  ancientArrow: (c) => {
+    glow(c.ctx, 0, 0, c.u * 3, "rgba(95,230,224,0.55)");
+    return projectiles.arrow({ ...c, charge: 1.6 });
+  },
   /**
    * The arrow. Translated to the projectile but not rotated, so it noses over
    * as gravity takes it — which for an arrow is the whole tell that the shot is
    * running out of steam.
```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/fighters/acmd/activate.test.ts src/fighters/finalSmash.test.ts src/fighters/schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Regenerate the generated files, in this order**

Each command rewrites one artefact from the code; the order matters (the limb list feeds the reconcile list and the bake, the bake feeds reach). Then review each diff against the scratch result below.

```bash
UPDATE_RECONCILE=1 pnpm vitest run src/fighters/acmd/reconcile.test.ts
UPDATE_BAKE=1 pnpm vitest run src/render3d/bake/roster.test.ts
```

`src/fighters/acmd/reconcile.allow.json` — the expected change:

```diff
--- a/src/fighters/acmd/reconcile.allow.json
+++ b/src/fighters/acmd/reconcile.allow.json
@@ -9,8 +9,9 @@
   "donkeyKong upB lead": "legacy 5%/95°/fkb90/kbg30 / game_specialhi 5%/95°/fkb30/kbg90",
   "donkeyKong downB hitboxes": "legacy some / game_speciallwstart none",
   "link fsmash lead": "legacy 14%/361°/bkb30/kbg100 / game_attacks4 7%/69°/bkb45/kbg12",
   "link fsmash faf": "legacy 51 / game_attacks4 49",
+  "samus finalSmash last": "legacy 147 / game_final 11",
   "kirby rapidJab first": "legacy 5 / game_attack100 1",
   "kirby rapidJab last": "legacy 36 / game_attack100 14",
   "kirby usmash faf": "legacy 46 / game_attackhi4 48",
   "kirby dsmash faf": "legacy 51 / game_attacklw4 54",
```

`src/fighters/bake/digest.ts` — the bake's new digest:

```diff
--- a/src/fighters/bake/digest.ts
+++ b/src/fighters/bake/digest.ts
@@ -1,5 +1,5 @@
 // GENERATED by src/render3d/bake/roster.test.ts (UPDATE_BAKE=1) — do not edit by hand.
 /** SHA-256 of the uncompressed public/bake/roster.bin.gz: the bake's fingerprint. */
-export const BAKE_DIGEST = "52113411b3f97bfaac119d23d396d996f88da58b3bb353d5b0c179e9f85cc01b";
+export const BAKE_DIGEST = "5fbdf70850651d6afe371d54ad62cb185878073a0a56c29eec26433feaf6c4a7";
 /** Its uncompressed length in bytes. */
-export const BAKE_BYTES = 6244056;
+export const BAKE_BYTES = 6339283;
```

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0; golden trace untouched.

- [ ] **Step 7: Commit**

```bash
git add super-smash/public/bake/roster.bin.gz super-smash/src/engine/acmd/legacy.ts super-smash/src/engine/projectile.ts super-smash/src/engine/simulate.ts super-smash/src/engine/types.ts super-smash/src/fighters/acmd/activate.test.ts super-smash/src/fighters/acmd/active.ts super-smash/src/fighters/acmd/reconcile.allow.json super-smash/src/fighters/bake/digest.ts super-smash/src/fighters/finalSmash.test.ts super-smash/src/fighters/link.ts super-smash/src/fighters/mario.ts super-smash/src/fighters/samus.ts super-smash/src/fighters/schema.test.ts super-smash/src/render/chars/link/fx.ts
git commit -m "super-smash: Mario Finale, Zero Laser, Ancient Bow and Arrow; multi-hit and growing projectiles" -m "Projectile rehits and stages; the legacy compiler keeps capsule far ends. Mario Finale's stages on SmashWiki's frames (first hit on 65), a 35% arrow (SmashWiki); flame speed, beam height and offsets UNVERIFIED. Reconcile +1 (samus finalSmash last). Bake regenerated. Golden trace unchanged." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Presentation: swallowed hidden, the Final Smash close-up, reflect and counter flashes

Three player-facing details. A swallowed fighter is not drawn (`drawScene` marks it hidden, so Plan 4's presenter hides its model too). During a Final Smash's scene the camera frames only the user and the trapped (`cameraTarget`), which Plan 4's 3D side camera follows. Reflects and counters spawn overlay sparks (2D overlay route 1 of Plan 4's "Special and Final Smash VFX": no meshes, no extra draw calls).

**Files:**
- Create: `super-smash/src/render/plan5.test.ts`
- Modify: `super-smash/src/render/camera.ts`, `super-smash/src/render/renderer.ts`, `super-smash/src/render/vfx.ts`

**Interfaces:**
- Consumes: `drawScene`, `cameraTarget`, `spawnVfx` (`src/render/`), `Presenter3D.paint(…, hidden)` (Plan 4).
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

`src/render/plan5.test.ts` (new file):

```ts
/**
 * What Plan 5's mechanics look like (Task 17): a fighter Kirby has swallowed
 * is not drawn, a Final Smash's scene fills the screen, and a reflection or a
 * counter flashes where it happened.
 */

import { describe, expect, it } from "vitest";

import { fx } from "@/engine/fixed";
import { cameraTarget, createCamera } from "./camera";
import { createHudState } from "./hud";
import { createMockContext } from "./mockContext";
import { render, type RenderState } from "./renderer";
import { createVfx, stepVfx } from "./vfx";
import { makeDef, makeEvents, makeFighter, makeStage, makeState } from "./testFixtures";

const stage = makeStage();

function renderState(current = makeState()): RenderState {
  return { current, previous: null, stage, fighters: current.fighters.map(() => makeDef()), vfx: createVfx(), hud: createHudState() };
}

describe("a swallowed fighter", () => {
  it("is hidden: it is inside Kirby", () => {
    const state = makeState({ fighters: [makeFighter({ port: 0, action: "inhaleHold" }), makeFighter({ port: 1, action: "swallowed" })] });
    const ctx = createMockContext() as unknown as CanvasRenderingContext2D;
    const { hidden } = render(ctx, renderState(state), null, createCamera(stage), 0);
    expect(hidden).toEqual([false, true]);
  });
});

describe("a Final Smash's scene", () => {
  it("frames only the fighter using it and the fighters it trapped", () => {
    const fighters = [
      makeFighter({ port: 0, x: fx(-20), action: "special", move: "finalAttack" }),
      makeFighter({ port: 1, x: fx(-5), action: "finalTrapped" }),
      makeFighter({ port: 2, x: fx(150) }),
    ];
    fighters[1].combat.trappedBy = 0;
    const playing = cameraTarget(makeState({ fighters, cinematic: 0 }), stage);
    const not = cameraTarget(makeState({ fighters, cinematic: -1 }), stage);
    expect(playing.zoom).toBeGreaterThan(not.zoom);
    expect(playing.x).toBeLessThan(0);
  });
});

describe("reflections and counters", () => {
  it("flash where they happened", () => {
    const v = createVfx();
    stepVfx(v, makeEvents({ reflects: [{ port: 0, x: fx(10), y: fx(6) }] }), makeState());
    const reflected = v.particles.length;
    expect(reflected).toBeGreaterThan(0);
    stepVfx(v, makeEvents({ counters: [{ port: 1, x: fx(-10), y: fx(8) }] }), makeState());
    expect(v.particles.length).toBeGreaterThan(reflected);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run src/render/plan5.test.ts`
Expected: FAIL — `render/plan5.test.ts`: 3 failed — `expected [ false, false ] to deeply equal [ false, true ]` (the swallowed fighter is drawn), `expected 7.63125772604294 to be greater than 7.63125772604294` (no close-up), `expected 0 to be greater than 0` (no flashes).

- [ ] **Step 3: Implement**

`src/render/camera.ts` — apply:

```diff
--- a/src/render/camera.ts
+++ b/src/render/camera.ts
@@ -133,10 +133,13 @@ export function cameraTarget(state: GameState, stage: StageDef): CameraTarget {
   let minY = Infinity;
   let maxY = -Infinity;
   let count = 0;
 
+  // A Final Smash's scene frames its user and whoever it trapped (Plan 5).
+  const scene = state.cinematic >= 0;
   for (const f of state.fighters) {
     if (f.action === "dead") continue;
+    if (scene && f.port !== state.cinematic && !(f.action === "finalTrapped" && f.combat.trappedBy === state.cinematic)) continue;
     const x = toFloat(f.x);
     const y = toFloat(f.y);
     minX = Math.min(minX, x);
     maxX = Math.max(maxX, x);
@@ -163,9 +166,10 @@ export function cameraTarget(state: GameState, stage: StageDef): CameraTarget {
   // edges are allowed to leave the frame during close combat, exactly as they
   // do in the real game; `MIN_ZOOM` and the blast-zone clamp below are what
   // stop the view running off the stage entirely.
   const main = stage.platforms.find((p) => p.ledges) ?? stage.platforms[0];
-  if (main) {
+  // ...but not during a Final Smash's scene, which is a close-up (Plan 5).
+  if (main && !scene) {
     minX = Math.min(minX, toFloat(main.x) - toFloat(main.halfWidth) * 0.32);
     maxX = Math.max(maxX, toFloat(main.x) + toFloat(main.halfWidth) * 0.32);
     minY = Math.min(minY, toFloat(main.y) - 6);
   }
```

`src/render/renderer.ts` — apply:

```diff
--- a/src/render/renderer.ts
+++ b/src/render/renderer.ts
@@ -302,8 +302,13 @@ export function drawScene(
   // is doing keeps the attacker and the launch both readable, and it is stable,
   // so two idle fighters do not swap depth every time one of them twitches.
   for (const d of [...drawn].sort((a, b) => drawDepth(a.fighter) - drawDepth(b.fighter))) {
     if (d.fighter.action === "dead") continue;
+    // Inside Kirby (Plan 5): not drawn, here or by the 3D presenter.
+    if (d.fighter.action === "swallowed") {
+      hidden[d.fighter.port] = true;
+      continue;
+    }
     hidden[d.fighter.port] = drawOneFighter(ctx, state, camera, d, mode);
   }
 
   drawProjectiles(ctx, game, camera, projectileVisual(state));
```

`src/render/vfx.ts` — apply:

```diff
--- a/src/render/vfx.ts
+++ b/src/render/vfx.ts
@@ -254,8 +254,11 @@ export function ingestEvents(v: VfxState, events: StepEvents, state: GameState):
 
   if (events.smashBallBroken !== null) {
     spawnBurst(v, toFloat(state.smashBall.x), toFloat(state.smashBall.y), 46, "#FFE873", 3.6);
   }
+  // A reflection flashes like a clank; a counter bursts white (Plan 5).
+  for (const r of events.reflects) spawnClank(v, toFloat(r.x), toFloat(r.y));
+  for (const c of events.counters) spawnBurst(v, toFloat(c.x), toFloat(c.y), 24, "#FFFFFF", 2.4);
   for (const port of events.finalSmashes) {
     const f = state.fighters.find((x) => x.port === port);
     if (f) spawnBurst(v, toFloat(f.x), toFloat(f.y) + 6, 40, "#FFFFFF", 3.0);
   }
```

- [ ] **Step 4: Run it again**

Run: `pnpm vitest run src/render/plan5.test.ts`
Expected: PASS (`src/render/plan5.test.ts` 3 tests).

- [ ] **Step 5: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0; golden trace untouched.

- [ ] **Step 6: Commit**

```bash
git add super-smash/src/render/camera.ts super-smash/src/render/plan5.test.ts super-smash/src/render/renderer.ts super-smash/src/render/vfx.ts
git commit -m "super-smash: swallowed fighters hidden, a Final Smash close-up, reflect and counter flashes" -m "The camera frames only the Final Smash's user and its trapped during the scene; Plan 4's 3D camera follows it. Overlay sparks only, inside the draw-call budget. Golden trace unchanged." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: CPU: tech, hitstun-cancel air dodge, parry

The CPU's defence gains three published options, each a pure function of its context with every random number from `ctx.rolls` (`cpuInput` stays deterministic): **tech** (shield within Plan 3's 11-frame window before landing in tumble), **escape** (an air dodge once Plan 3's hitstun cancel opens, frame 41), **parry** (a shield released just before a hit arrives). `techSkill`/`parrySkill` scale with level. Two more rolls per decision (`ROLL_TECH`, `ROLL_PARRY`).

**Files:**
- Create: `super-smash/src/ai/defence.test.ts`
- Modify: `super-smash/src/ai/behaviours.test.ts`, `super-smash/src/ai/behaviours.ts`, `super-smash/src/ai/cpu.ts`
- Regenerate: `super-smash/src/game/__golden__/engine-trace.json`

**Interfaces:**
- Consumes: `observe`, `BehaviourContext` (`src/ai/behaviours.ts`), Plan 3's tech window and hitstun cancel.
- Produces: `tech`, `escape`, `parry`, `PARRY_LEAD`, `ROLL_TECH = 6`, `ROLL_PARRY = 7` (`behaviours.ts`); `CpuTuning.techSkill`, `.parrySkill`.

- [ ] **Step 1: Write the failing tests**

`src/ai/behaviours.test.ts` — apply:

```diff
--- a/src/ai/behaviours.test.ts
+++ b/src/ai/behaviours.test.ts
@@ -557,10 +557,14 @@ describe("platformMove", () => {
 
 describe("the behaviour set", () => {
   it("lists the survival behaviours first, so they win ties", () => {
     expect(BEHAVIOURS.map((b) => b.name)).toEqual([
+      // Plan 5: a tech and a hitstun cancel are survival too.
+      "tech",
+      "escape",
       "survive",
       "recover",
+      "parry",
       "shield",
       "edgeguard",
       "attack",
       "platformMove",
```

`src/ai/defence.test.ts` (new file):

```ts
/**
 * The CPU's Plan 5 defence (Task 18): tech the landing, air-dodge out of
 * hitstun when Plan 3's cancel allows it, and parry by letting go of the
 * shield as a swing starts. Pure functions of their context, gated by the
 * level's dials like every other behaviour.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { fx } from "@/engine/fixed";
import { createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { Btn, held, type GameState, type InputFrame } from "@/engine/types";
import { FIGHTERS } from "@/fighters";
import { STAGES } from "@/stages";
import { makeFighter, makeState } from "@/render/testFixtures";
import {
  DECISION_ROLLS,
  DEFAULT_STAGE_VIEW,
  MELEE_RANGE,
  ROLL_PARRY,
  ROLL_TECH,
  escape,
  observe,
  parry,
  stageViewFromDef,
  tech,
  type BehaviourContext,
  type LevelTuning,
} from "./behaviours";
import { cpuInput, tuningForLevel } from "./cpu";

function context(state: GameState, tuning: LevelTuning, rolls: number[] = new Array(DECISION_ROLLS).fill(0)): BehaviourContext {
  return { state, view: observe(state, 0, tuning.reactionFrames), stage: DEFAULT_STAGE_VIEW, tuning, jumps: 1, meleeReach: MELEE_RANGE, rolls };
}

const L9 = tuningForLevel(9);
const L1 = tuningForLevel(1);

describe("tech", () => {
  const falling = () => makeState({ fighters: [makeFighter({ port: 0, action: "tumble", actionFrame: 10, grounded: false, x: fx(20), y: fx(6), vy: fx(-1.5), hitstun: 10 }), makeFighter({ port: 1, x: fx(60) })] });

  it("presses shield toward the middle just before a tumble lands", () => {
    const r = tech(context(falling(), L9));
    expect(r.score).toBeGreaterThan(1000);
    expect(held(r.input, Btn.Shield)).toBe(true);
    expect(held(r.input, Btn.Left)).toBe(true);
  });

  it("does not, while the floor is still far off", () => {
    const s = falling();
    s.fighters[0].y = fx(60);
    expect(tech(context(s, L9)).score).toBe(0);
  });

  it("is never done at level 1, and needs the roll at level 9", () => {
    expect(tech(context(falling(), L1)).score).toBe(0);
    const rolls = new Array(DECISION_ROLLS).fill(0);
    rolls[ROLL_TECH] = 0.99;
    expect(tech(context(falling(), L9, rolls)).score).toBe(0);
  });
});

describe("escape", () => {
  it("air-dodges out of hitstun once the cancel is open", () => {
    const s = makeState({ fighters: [makeFighter({ port: 0, action: "tumble", grounded: false, y: fx(80), hitstun: 20, actionFrame: 45, launchSpeed: fx(1) }), makeFighter({ port: 1, x: fx(60) })] });
    const frames = Array.from({ length: 4 }, (_, i) => escape(context({ ...s, frame: i }, L9)).input);
    expect(frames.some((i) => held(i, Btn.Shield))).toBe(true);
  });

  it("waits while the cancel is shut", () => {
    const s = makeState({ fighters: [makeFighter({ port: 0, action: "tumble", grounded: false, y: fx(80), hitstun: 20, actionFrame: 20, launchSpeed: fx(1) }), makeFighter({ port: 1, x: fx(60) })] });
    expect(escape(context(s, L9)).score).toBe(0);
  });
});

describe("parry", () => {
  it("lets go of the shield the frame after it sees a swing start", () => {
    const s = makeState({ fighters: [makeFighter({ port: 0, action: "shield" }), makeFighter({ port: 1, x: fx(14), action: "attack", move: "fsmash", actionFrame: L9.reactionFrames + 1 })] });
    const r = parry(context(s, L9));
    expect(r.score).toBeGreaterThan(600);
    expect(r.input).toBe(0);
  });

  it("is a read only good CPUs make, and not every time", () => {
    const s = makeState({ fighters: [makeFighter({ port: 0, action: "shield" }), makeFighter({ port: 1, x: fx(14), action: "attack", move: "fsmash", actionFrame: L1.reactionFrames + 1 })] });
    expect(parry(context(s, L1)).score).toBe(0);
    const rolls = new Array(DECISION_ROLLS).fill(0);
    rolls[ROLL_PARRY] = 0.6;
    const nine = makeState({ fighters: [makeFighter({ port: 0, action: "shield" }), makeFighter({ port: 1, x: fx(14), action: "attack", move: "fsmash", actionFrame: L9.reactionFrames + 1 })] });
    expect(parry(context(nine, L9, rolls)).score).toBe(0);
  });
});

describe("a level-9 CPU in a real match", () => {
  beforeAll(() => {
    registerFighters(FIGHTERS);
    registerStages(STAGES);
  });

  it("techs a tumble onto Final Destination", () => {
    const rules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true } as const;
    let s = createInitialState("finalDestination", [{ defId: "mario" }, { defId: "fox" }], rules, 21);
    // Early in its reel, so Plan 3's hitstun cancel is still shut and the press is a tech.
    Object.assign(s.fighters[0], { action: "tumble", actionFrame: 5, grounded: false, platform: -1, x: fx(10), y: fx(30), vy: fx(-2), hitstun: 40, intangible: 0 });
    Object.assign(s.fighters[1], { action: "stand", grounded: true, platform: 0, x: fx(60), y: 0, intangible: 0 });
    const world = { stage: stageViewFromDef(STAGES.find((x) => x.id === "finalDestination")!), jumps: 2 };
    let seed = 7;
    let prev: InputFrame[] = [0, 0];
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const c = cpuInput(s, 0, 9, seed, world);
      seed = c.seed;
      const now = [c.input, 0];
      s = step(s, now, { prevInputs: prev }).state;
      prev = now;
      seen.add(s.fighters[0].action);
    }
    expect(seen.has("tech") || seen.has("techRoll")).toBe(true);
    expect(seen.has("downed")).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/ai/behaviours.test.ts src/ai/defence.test.ts`
Expected: FAIL — 9 failed | 52 passed — `TypeError: tech is not a function` (and `escape`, `parry`), `expected [ Array(9) ] to deeply equal [ 'tech', 'escape', 'survive', …(9) ]`.

- [ ] **Step 3: Implement**

`src/ai/behaviours.ts` — apply:

```diff
--- a/src/ai/behaviours.ts
+++ b/src/ai/behaviours.ts
@@ -34,9 +34,15 @@ import {
   type InputFrame,
   type MoveSlot,
   type StageDef,
 } from "@/engine/types";
-import { SDI_INPUT_INTERVAL, SMASH_INPUT_WINDOW } from "@/engine/constants";
+import {
+  HITSTUN_CANCEL_AIR_DODGE_FRAME,
+  HITSTUN_CANCEL_AIR_DODGE_SPEED,
+  SDI_INPUT_INTERVAL,
+  SMASH_INPUT_WINDOW,
+  TECH_WINDOW,
+} from "@/engine/constants";
 import { abs, fx, magnitude } from "@/engine/fixed";
 
 /* ------------------------------------------------------------------ stage -- */
 
@@ -127,8 +133,12 @@ export interface LevelTuning {
   /** Score jitter, ±this fraction. High at low levels — visible indecision. */
   readonly noise: number;
   /** Chance of dropping a frame's input entirely. The low-level fumble. */
   readonly fumbleChance: number;
+  /** Plan 5: how reliably it techs a landing and air-dodges out of hitstun. */
+  readonly techSkill: number;
+  /** Plan 5: how often it lets go of its shield to parry a swing it sees coming. */
+  readonly parrySkill: number;
 }
 
 /* ------------------------------------------------------------ observation -- */
 
@@ -259,9 +269,12 @@ export const ROLL_DODGE = 1;
 export const ROLL_EDGEGUARD = 2;
 export const ROLL_RECOVER = 3;
 export const ROLL_MOVE = 4;
 export const ROLL_FUMBLE = 5;
-export const DECISION_ROLLS = 6;
+/** Plan 5: teching and hitstun cancels share one roll; parrying has its own. */
+export const ROLL_TECH = 6;
+export const ROLL_PARRY = 7;
+export const DECISION_ROLLS = 8;
 
 export interface BehaviourContext {
   /** Read for `frame` and `rules` only — never for the opponent. */
   readonly state: GameState;
@@ -283,10 +296,13 @@ export interface BehaviourResult {
 
 export type Behaviour = (ctx: BehaviourContext) => BehaviourResult;
 
 export type BehaviourName =
+  | "tech"
+  | "escape"
   | "survive"
   | "recover"
+  | "parry"
   | "shield"
   | "edgeguard"
   | "attack"
   | "platformMove"
@@ -503,8 +519,64 @@ export const survive: Behaviour = (ctx) => {
   if (ctx.rolls[ROLL_MOVE] >= ctx.tuning.diSkill) return { score: 1000, input: 0 };
   return { score: 1000, input: escape };
 };
 
+/**
+ * Tech the landing (Plan 5). A tumbling fighter about to hit the stage presses
+ * shield inside the 11-frame window — toward the middle, so it is a tech roll
+ * inward rather than a tech in place at the edge. Scored above `survive`:
+ * the DI has done its work by now, and a missed tech is the punish.
+ */
+export const tech: Behaviour = (ctx) => {
+  const { self } = ctx.view;
+  if (self.action !== "tumble" || self.grounded || self.vy >= 0) return NOTHING;
+  if (self.combat.techLockout > 0 || self.combat.techWindow > 0) return NOTHING;
+  // Once the hitstun cancel is open a shield press is an air dodge, not a
+  // tech: that is `escape`'s.
+  if (cancelOpen(self)) return NOTHING;
+  if (isOffstage(self, ctx.stage)) return NOTHING;
+  const height = self.y - ctx.stage.groundY;
+  if (height < 0) return NOTHING;
+  // Frames until the floor at this speed; the window has to still be open then.
+  if (height > (TECH_WINDOW - 2) * -self.vy) return NOTHING;
+  if (ctx.rolls[ROLL_TECH] >= ctx.tuning.techSkill) return NOTHING;
+  return { score: 1100, input: Btn.Shield | towardX(self.x, 0) };
+};
+
+/** Plan 3's hitstun cancel is open: frame 41 of the reel, launch speed under 2.5. */
+function cancelOpen(f: FighterState): boolean {
+  return f.hitstun > 0 && f.actionFrame >= HITSTUN_CANCEL_AIR_DODGE_FRAME && f.launchSpeed < HITSTUN_CANCEL_AIR_DODGE_SPEED;
+}
+
+/**
+ * Air-dodge out of hitstun once Plan 3's hitstun cancel allows it — up high
+ * to drift free, near the floor because a dodge lands on its feet where a
+ * missed tech lands on its back.
+ */
+export const escape: Behaviour = (ctx) => {
+  const { self } = ctx.view;
+  if (self.grounded || self.airDodged || !cancelOpen(self)) return NOTHING;
+  if (ctx.rolls[ROLL_TECH] >= ctx.tuning.techSkill) return NOTHING;
+  return { score: 1050, input: pulse(ctx.view.frame, self.port, 4, 1) ? Btn.Shield : 0 };
+};
+
+/** Frames after a swing is seen that a parrying CPU lets go: the parry's window is 5. */
+export const PARRY_LEAD = 1;
+
+/**
+ * Parry (Plan 5): already shielding, it sees a swing start within reach and
+ * lets go of the shield — the perfect shield is on release, so the drop is the
+ * parry. Scored over `shield`, which would otherwise keep holding.
+ */
+export const parry: Behaviour = (ctx) => {
+  const { self, targetAction, targetActionAge, distance } = ctx.view;
+  if (!ctx.view.target || !isShielding(self.action) || self.hitstun > 0) return NOTHING;
+  if (!isAttacking(targetAction) || distance > THREAT_RANGE) return NOTHING;
+  if (targetActionAge !== PARRY_LEAD) return NOTHING;
+  if (ctx.rolls[ROLL_PARRY] >= ctx.tuning.parrySkill) return NOTHING;
+  return { score: 650, input: 0 };
+};
+
 /**
  * Get back to the stage. Jump while jumps remain, up-B once they do not — and
  * at low levels, sometimes neither, which is where level-1 CPUs go to die.
  */
@@ -777,10 +849,13 @@ export const idle: Behaviour = () => ({ score: 1, input: 0 });
  * the survival and recovery behaviours are listed first: when two scores land
  * equal after jitter, not dying is the better default.
  */
 export const BEHAVIOURS: readonly { readonly name: BehaviourName; readonly run: Behaviour }[] = [
+  { name: "tech", run: tech },
+  { name: "escape", run: escape },
   { name: "survive", run: survive },
   { name: "recover", run: recover },
+  { name: "parry", run: parry },
   { name: "shield", run: shield },
   { name: "edgeguard", run: edgeguard },
   { name: "attack", run: attack },
   { name: "platformMove", run: platformMove },
```

`src/ai/cpu.ts` — apply:

```diff
--- a/src/ai/cpu.ts
+++ b/src/ai/cpu.ts
@@ -77,19 +77,25 @@ export interface CpuWorld {
  * broken one; `edgeguardSkill` climbs slowest, because leaving the stage is the
  * highest-risk thing in the game and a CPU that does it badly hands over
  * stocks; and `noise` falls from 0.9 to 0.1, which is what turns visible
  * dithering into visible intent.
+ *
+ * Plan 5 adds two: `techSkill` (teching landings, air-dodging out of hitstun)
+ * climbs with `recoverySkill` because both are survival; `parrySkill` stays
+ * at zero until level 4 and reaches only 0.5, because a parry is a read and a
+ * CPU that parried everything would be reading inputs. UNVERIFIED: the values
+ * are tuning, not data — Ultimate's CPU is not published.
  */
 const TUNING: readonly LevelTuning[] = [
-  { level: 1, reactionFrames: 30, aggression: 0.15, shieldRate: 0.02, dodgeRate: 0.0, diSkill: 0.0, sdiSkill: 0.0, recoverySkill: 0.15, edgeguardSkill: 0.0, moveChoiceSkill: 0.15, noise: 0.9, fumbleChance: 0.3 },
-  { level: 2, reactionFrames: 27, aggression: 0.22, shieldRate: 0.06, dodgeRate: 0.02, diSkill: 0.05, sdiSkill: 0.0, recoverySkill: 0.3, edgeguardSkill: 0.0, moveChoiceSkill: 0.25, noise: 0.8, fumbleChance: 0.24 },
-  { level: 3, reactionFrames: 23, aggression: 0.3, shieldRate: 0.12, dodgeRate: 0.05, diSkill: 0.15, sdiSkill: 0.0, recoverySkill: 0.45, edgeguardSkill: 0.05, moveChoiceSkill: 0.35, noise: 0.7, fumbleChance: 0.19 },
-  { level: 4, reactionFrames: 20, aggression: 0.38, shieldRate: 0.2, dodgeRate: 0.1, diSkill: 0.28, sdiSkill: 0.05, recoverySkill: 0.58, edgeguardSkill: 0.12, moveChoiceSkill: 0.45, noise: 0.6, fumbleChance: 0.15 },
-  { level: 5, reactionFrames: 16, aggression: 0.47, shieldRate: 0.3, dodgeRate: 0.18, diSkill: 0.42, sdiSkill: 0.15, recoverySkill: 0.7, edgeguardSkill: 0.22, moveChoiceSkill: 0.55, noise: 0.5, fumbleChance: 0.11 },
-  { level: 6, reactionFrames: 13, aggression: 0.56, shieldRate: 0.42, dodgeRate: 0.28, diSkill: 0.56, sdiSkill: 0.3, recoverySkill: 0.8, edgeguardSkill: 0.36, moveChoiceSkill: 0.66, noise: 0.4, fumbleChance: 0.08 },
-  { level: 7, reactionFrames: 10, aggression: 0.66, shieldRate: 0.56, dodgeRate: 0.4, diSkill: 0.7, sdiSkill: 0.48, recoverySkill: 0.88, edgeguardSkill: 0.52, moveChoiceSkill: 0.77, noise: 0.3, fumbleChance: 0.05 },
-  { level: 8, reactionFrames: 7, aggression: 0.78, shieldRate: 0.72, dodgeRate: 0.55, diSkill: 0.85, sdiSkill: 0.7, recoverySkill: 0.95, edgeguardSkill: 0.72, moveChoiceSkill: 0.88, noise: 0.2, fumbleChance: 0.02 },
-  { level: 9, reactionFrames: 4, aggression: 0.9, shieldRate: 0.9, dodgeRate: 0.72, diSkill: 1.0, sdiSkill: 0.95, recoverySkill: 1.0, edgeguardSkill: 0.92, moveChoiceSkill: 1.0, noise: 0.1, fumbleChance: 0.0 },
+  { level: 1, reactionFrames: 30, aggression: 0.15, shieldRate: 0.02, dodgeRate: 0.0, diSkill: 0.0, sdiSkill: 0.0, recoverySkill: 0.15, edgeguardSkill: 0.0, moveChoiceSkill: 0.15, noise: 0.9, fumbleChance: 0.3, techSkill: 0.0, parrySkill: 0.0 },
+  { level: 2, reactionFrames: 27, aggression: 0.22, shieldRate: 0.06, dodgeRate: 0.02, diSkill: 0.05, sdiSkill: 0.0, recoverySkill: 0.3, edgeguardSkill: 0.0, moveChoiceSkill: 0.25, noise: 0.8, fumbleChance: 0.24, techSkill: 0.05, parrySkill: 0.0 },
+  { level: 3, reactionFrames: 23, aggression: 0.3, shieldRate: 0.12, dodgeRate: 0.05, diSkill: 0.15, sdiSkill: 0.0, recoverySkill: 0.45, edgeguardSkill: 0.05, moveChoiceSkill: 0.35, noise: 0.7, fumbleChance: 0.19, techSkill: 0.12, parrySkill: 0.0 },
+  { level: 4, reactionFrames: 20, aggression: 0.38, shieldRate: 0.2, dodgeRate: 0.1, diSkill: 0.28, sdiSkill: 0.05, recoverySkill: 0.58, edgeguardSkill: 0.12, moveChoiceSkill: 0.45, noise: 0.6, fumbleChance: 0.15, techSkill: 0.22, parrySkill: 0.02 },
+  { level: 5, reactionFrames: 16, aggression: 0.47, shieldRate: 0.3, dodgeRate: 0.18, diSkill: 0.42, sdiSkill: 0.15, recoverySkill: 0.7, edgeguardSkill: 0.22, moveChoiceSkill: 0.55, noise: 0.5, fumbleChance: 0.11, techSkill: 0.35, parrySkill: 0.05 },
+  { level: 6, reactionFrames: 13, aggression: 0.56, shieldRate: 0.42, dodgeRate: 0.28, diSkill: 0.56, sdiSkill: 0.3, recoverySkill: 0.8, edgeguardSkill: 0.36, moveChoiceSkill: 0.66, noise: 0.4, fumbleChance: 0.08, techSkill: 0.5, parrySkill: 0.1 },
+  { level: 7, reactionFrames: 10, aggression: 0.66, shieldRate: 0.56, dodgeRate: 0.4, diSkill: 0.7, sdiSkill: 0.48, recoverySkill: 0.88, edgeguardSkill: 0.52, moveChoiceSkill: 0.77, noise: 0.3, fumbleChance: 0.05, techSkill: 0.65, parrySkill: 0.2 },
+  { level: 8, reactionFrames: 7, aggression: 0.78, shieldRate: 0.72, dodgeRate: 0.55, diSkill: 0.85, sdiSkill: 0.7, recoverySkill: 0.95, edgeguardSkill: 0.72, moveChoiceSkill: 0.88, noise: 0.2, fumbleChance: 0.02, techSkill: 0.8, parrySkill: 0.35 },
+  { level: 9, reactionFrames: 4, aggression: 0.9, shieldRate: 0.9, dodgeRate: 0.72, diSkill: 1.0, sdiSkill: 0.95, recoverySkill: 1.0, edgeguardSkill: 0.92, moveChoiceSkill: 1.0, noise: 0.1, fumbleChance: 0.0, techSkill: 0.95, parrySkill: 0.5 },
 ];
 
 export function tuningForLevel(level: number): LevelTuning {
   const clamped = Math.min(Math.max(Math.round(level), MIN_LEVEL), MAX_LEVEL);
```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/ai/behaviours.test.ts src/ai/defence.test.ts`
Expected: PASS (`src/ai/defence.test.ts` 8 tests).

- [ ] **Step 5: Regenerate the generated files, in this order**

Each command rewrites one artefact from the code; the order matters (the limb list feeds the reconcile list and the bake, the bake feeds reach). Then review each diff against the scratch result below.

```bash
UPDATE_GOLDEN=1 pnpm vitest run src/game/golden.test.ts
```

**Golden trace — deliberate behaviour change.** all four traces diverge: each CPU decision draws two more rolls, and the CPUs now tech, escape and parry.

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0; golden trace regenerated as above.

- [ ] **Step 7: Commit**

```bash
git add super-smash/src/ai/behaviours.test.ts super-smash/src/ai/behaviours.ts super-smash/src/ai/cpu.ts super-smash/src/ai/defence.test.ts super-smash/src/game/__golden__/engine-trace.json
git commit -m "super-smash: CPU techs, escapes hitstun with an air dodge, and parries" -m "Pure, seeded behaviours; a tech press that would become a hitstun-cancel air dodge is left to escape. Golden trace regenerated: all four traces diverge (two more rolls per decision, new defence)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 19: CPU: Final Smash, Smash Ball, reflect, counter, stored charges, carries, side recovery

`src/ai/specials.ts`: the CPU uses what Plan 5 gave the roster — the Final Smash (at once when it needs no aim, in reach when it traps, a dash one when lined up; the reaches are UNVERIFIED tuning), the Smash Ball (break it while nobody has its power; only over the stage and in a jump's reach), reflectors and counters against what it sees coming, store-mode charges (charge while far, fire a full one lined up), a carry or a mouthful (throw toward the near edge, swallow or spit), and side specials that carry it home. It knows its own moveset (`ctx.def`) — and a Kirby CPU with a Copy Ability the copied one, through the same `withCopyAbility` the simulation uses (`cpuDef`, `CpuWorld.fighter`) — and reads its reach from its active scripts on the installed bones (`meleeReachFromDef(def, GAME_SIM_CONTEXT.bones)` — Plan 4's risk note: "Plan 5 replaces it"). Breaking the Smash Ball used to knock it off stage for good; the engine now keeps it over the stage (`SMASH_BALL_FLOOR`/`CEILING`, UNVERIFIED: SmashWiki says it "floats around the stage").

**Files:**
- Create: `super-smash/src/ai/specials.test.ts`, `super-smash/src/ai/specials.ts`, `super-smash/src/engine/smashBall.test.ts`
- Modify: `super-smash/src/ai/behaviours.test.ts`, `super-smash/src/ai/behaviours.ts`, `super-smash/src/ai/cpu.ts`, `super-smash/src/engine/simulate.ts`, `super-smash/src/game/golden.test.ts`, `super-smash/src/game/matchRunner.test.ts`, `super-smash/src/game/matchRunner.ts`
- Regenerate: `super-smash/src/game/__golden__/engine-trace.json`

**Interfaces:**
- Consumes: `FINAL_SMASH_READY` (Task 14), `MoveDef.reflector/counter/specialCharge` (Tasks 2–5), `GAME_SIM_CONTEXT.bones` (Plan 4).
- Produces: `src/ai/specials.ts`: `finalSmash`, `smashBall`, `reflect`, `counter`, `storeCharge`, `holding`, `sideRecover`, `FINAL_SMASH_RANGE`, `FINAL_SMASH_DASH_RANGE`, `BALL_REACH_HEIGHT`; `ROLL_SPECIAL = 8`, `DECISION_ROLLS = 9`, `CpuTuning.specialSkill`, `BehaviourContext.def`, `CpuWorld.def`, `CpuWorld.fighter`, `cpuDef(self, world)`, `meleeReachFromDef(def, bones)`; `SMASH_BALL_FLOOR`, `SMASH_BALL_CEILING` (simulate.ts).

- [ ] **Step 1: Write the failing tests**

`src/ai/behaviours.test.ts` — apply:

```diff
--- a/src/ai/behaviours.test.ts
+++ b/src/ai/behaviours.test.ts
@@ -561,12 +561,20 @@ describe("the behaviour set", () => {
       // Plan 5: a tech and a hitstun cancel are survival too.
       "tech",
       "escape",
       "survive",
+      // Plan 5, Task 19: the specials, each where its urgency puts it.
+      "sideRecover",
       "recover",
+      "holding",
+      "finalSmash",
       "parry",
+      "reflect",
+      "counter",
       "shield",
       "edgeguard",
+      "storeCharge",
+      "smashBall",
       "attack",
       "platformMove",
       "approach",
       "retreat",
@@ -613,12 +621,15 @@ describe("the approach/attack threshold", () => {
     // A stand-in rather than the real roster, so this stays a test of the
     // function and not of Donkey Kong's frame data: jab reaching 11.5 and ftilt
     // reaching 13.5 must yield 11.5, because the default swing does not choose
     // which of the two comes out.
+    // Plan 5: read through each move's script, so the stand-ins are whole moves.
+    const box = (x: number, radius: number) => ({ id: 0, startFrame: 3, endFrame: 4, x: fx(x), y: fx(6), radius: fx(radius), damage: fx(3), angle: fx(361), baseKnockback: 0, knockbackGrowth: 0 });
     const def = {
+      id: "standIn",
       moves: {
-        jab1: { hitboxes: [{ x: fx(7.5), radius: fx(4) }] },
-        ftilt: { hitboxes: [{ x: fx(9), radius: fx(4.5) }] },
+        jab1: { slot: "jab1", name: "Jab", totalFrames: 10, hitboxes: [box(7.5, 4)] },
+        ftilt: { slot: "ftilt", name: "Tilt", totalFrames: 10, hitboxes: [box(9, 4.5)] },
       },
     } as unknown as Parameters<typeof meleeReachFromDef>[0];
 
     expect(toFloat(meleeReachFromDef(def))).toBeCloseTo(11.5, 1);
```

`src/ai/specials.test.ts` (new file):

```ts
/**
 * The CPU's Plan 5 offence (Task 19): Final Smash, Smash Ball, reflect,
 * counter, stored charges, a mouthful or a carry, sideways recovery — and the
 * Review Focus: a CPU that goes and gets the Smash Ball, and uses it.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { FINAL_SMASH_READY } from "@/engine/final";
import { fx } from "@/engine/fixed";
import { findProjectileDef, spawnProjectile } from "@/engine/projectile";
import { createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { Btn, held, type FighterDef, type GameState, type InputFrame } from "@/engine/types";
import { FIGHTERS, donkeyKong, fox, kirby, mario, marth, samus } from "@/fighters";
import { STAGES } from "@/stages";
import { makeFighter, makeState } from "@/render/testFixtures";
import { DECISION_ROLLS, DEFAULT_STAGE_VIEW, MELEE_RANGE, meleeReachFromDef, observe, stageViewFromDef, type BehaviourContext } from "./behaviours";
import { cpuDef, cpuInput, tuningForLevel } from "./cpu";
import { counter, finalSmash, holding, reflect, sideRecover, smashBall, storeCharge } from "./specials";


function context(state: GameState, def: FighterDef, level = 9, rolls: number[] = new Array(DECISION_ROLLS).fill(0)): BehaviourContext {
  const tuning = tuningForLevel(level);
  return { state, view: observe(state, 0, tuning.reactionFrames), stage: DEFAULT_STAGE_VIEW, tuning, jumps: 1, meleeReach: MELEE_RANGE, rolls, def };
}

describe("the Final Smash", () => {
  it("is used at once when it needs no aim, and only in reach when it traps", () => {
    const ready = (gap: number) => makeState({ fighters: [makeFighter({ port: 0, finalSmashReady: FINAL_SMASH_READY, facing: 1 }), makeFighter({ port: 1, x: fx(gap) })] });
    expect(finalSmash(context(ready(150), mario)).score).toBeGreaterThan(0);
    expect(finalSmash(context(ready(150), kirby)).score).toBe(0);
    const near = [0, 1, 2, 3].map((f) => finalSmash(context({ ...ready(12), frame: f }, kirby)).input);
    expect(near.some((i) => held(i, Btn.Special))).toBe(true);
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

  it("is left alone while somebody holds its power", () => {
    const s = makeState({ fighters: [makeFighter({ port: 0 }), makeFighter({ port: 1, x: fx(80), finalSmashReady: FINAL_SMASH_READY })] });
    s.smashBall = { active: true, x: fx(40), y: fx(4), vx: 0, vy: 0, health: fx(40), driftTimer: 10 };
    expect(smashBall(context(s, mario)).score).toBe(0);
  });
});

describe("reflect and counter", () => {
  it("Fox raises the Reflector as a fireball arrives", () => {
    const s = makeState({ fighters: [makeFighter({ port: 0, x: 0, facing: 1, defId: "fox" }), makeFighter({ port: 1, x: fx(80), defId: "mario" })] });
    const ball = spawnProjectile(findProjectileDef(mario, "fireball")!, s.fighters[1], 1);
    s.projectiles = [{ ...ball, x: fx(10), y: fx(6), vx: -fx(2) }];
    const r = reflect(context(s, fox));
    expect(r.score).toBeGreaterThan(0);
    expect(held(r.input, Btn.Down) && held(r.input, Btn.Special)).toBe(true);
  });

  it("Mario capes it, toward it", () => {
    const s = makeState({ fighters: [makeFighter({ port: 0, x: 0, facing: -1 }), makeFighter({ port: 1, x: fx(80) })] });
    const laser = spawnProjectile(findProjectileDef(fox, "blaster")!, s.fighters[1], 1);
    s.projectiles = [{ ...laser, x: fx(55), y: fx(6), vx: -fx(5.5) }];
    const r = reflect(context(s, mario));
    expect(held(r.input, Btn.Right) && held(r.input, Btn.Special)).toBe(true);
  });

  it("Marth counters a swing he sees start, and a level-1 Marth does not", () => {
    const swing = (level: number) =>
      makeState({ fighters: [makeFighter({ port: 0, facing: 1 }), makeFighter({ port: 1, x: fx(14), action: "attack", move: "fsmash", actionFrame: tuningForLevel(level).reactionFrames + 1 })] });
    expect(held(counter(context(swing(9), marth)).input, Btn.Down)).toBe(true);
    const rolls = new Array(DECISION_ROLLS).fill(0.5);
    expect(counter(context(swing(1), marth, 1, rolls)).score).toBe(0);
  });
});

describe("stored charges, carries and mouthfuls", () => {
  it("Samus charges from afar and fires a full charge when lined up", () => {
    const far = makeState({ fighters: [makeFighter({ port: 0, facing: 1 }), makeFighter({ port: 1, x: fx(90) })] });
    expect(storeCharge(context(far, samus)).score).toBeGreaterThan(0);
    const lined = makeState({ fighters: [makeFighter({ port: 0, facing: 1 }), makeFighter({ port: 1, x: fx(50) })] });
    lined.fighters[0].combat.storedCharge = 112;
    const fire = [0, 1, 2, 3, 4, 5].map((f) => storeCharge(context({ ...lined, frame: f }, samus)).input);
    expect(fire.some((i) => held(i, Btn.Special))).toBe(true);
  });

  it("Donkey Kong throws his cargo; Kirby swallows or spits", () => {
    const dk = makeState({ fighters: [makeFighter({ port: 0, action: "cargoCarry", x: fx(30) }), makeFighter({ port: 1, action: "cargoHeld" })] });
    const dkIn = [0, 1, 2, 3, 4, 5, 6, 7].map((f) => holding(context({ ...dk, frame: f }, donkeyKong)).input);
    expect(dkIn.some((i) => held(i, Btn.Attack))).toBe(true);
    const k = makeState({ fighters: [makeFighter({ port: 0, action: "inhaleHold" }), makeFighter({ port: 1, action: "swallowed" })] });
    const kIn = [0, 1, 2, 3, 4, 5, 6, 7].map((f) => holding(context({ ...k, frame: f }, kirby)).input);
    expect(kIn.some((i) => held(i, Btn.Special) || held(i, Btn.Attack))).toBe(true);
  });

  it("Fox recovers sideways with Fox Illusion when level with the stage and out of jumps", () => {
    const s = makeState({ fighters: [makeFighter({ port: 0, grounded: false, action: "fall", x: fx(140), y: fx(-4), jumpsUsed: 2 }), makeFighter({ port: 1 })] });
    const r = sideRecover(context(s, fox));
    expect(held(r.input, Btn.Left) && held(r.input, Btn.Special)).toBe(true);
  });
});

describe("reach from scripts (Plan 4's limb bones)", () => {
  it("matches the legacy reach where the pokes run legacy scripts", () => {
    const legacyReach = (def: FighterDef) => Math.min(...(["jab1", "ftilt"] as const).flatMap((s) => (def.moves[s] ? [Math.max(...def.moves[s]!.hitboxes.map((h) => h.x + h.radius))] : [])));
    expect(meleeReachFromDef(marth)).toBe(legacyReach(marth));
  });
});

describe("Review Focus: a CPU and the Smash Ball", () => {
  beforeAll(() => {
    registerFighters(FIGHTERS);
    registerStages(STAGES);
  });

  it("goes and breaks the Smash Ball, then uses its Final Smash", () => {
    const rules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: true, oneOnOne: true } as const;
    let s = createInitialState("finalDestination", [{ defId: "mario" }, { defId: "fox" }], rules, 31);
    s.fighters.forEach((f, i) => Object.assign(f, { action: "stand", grounded: true, platform: 0, x: fx(i === 0 ? -30 : 70), y: 0, intangible: 0 }));
    s.smashBall = { active: true, x: fx(0), y: fx(10), vx: 0, vy: 0, health: fx(40), driftTimer: 0 };
    const stage = stageViewFromDef(STAGES.find((x) => x.id === "finalDestination")!);
    let seed = 99;
    let prev: InputFrame[] = [0, 0];
    let broke = -1;
    let used = -1;
    for (let i = 0; i < 1500 && used < 0; i++) {
      const c = cpuInput(s, 0, 9, seed, { stage, jumps: 2, meleeReach: meleeReachFromDef(mario), def: mario });
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

describe("a Kirby CPU with a Copy Ability (Plan 5 review)", () => {
  it("fights with the copied neutral special, as the simulation runs it", () => {
    const self = makeFighter({ port: 0, defId: "kirby" });
    const world = { def: kirby, fighter: (id: string) => FIGHTERS.find((f) => f.id === id) };
    expect(cpuDef(self, world)).toBe(kirby);
    self.combat.copy = "samus";
    const copied = cpuDef(self, world)!;
    expect(copied.moves.neutralB?.name).toBe(samus.moves.neutralB?.name);
    // Charge Shot is a store-mode charge: the copied Kirby now charges it from afar.
    expect(copied.moves.neutralB?.specialCharge?.mode).toBe("store");
    expect(cpuDef(self, { def: kirby })).toBe(kirby);
  });
});
```

`src/engine/smashBall.test.ts` (new file):

```ts
import { describe, expect, it } from "vitest";

import { fx } from "./fixed";
import { SMASH_BALL_CEILING, SMASH_BALL_FLOOR, createInitialState, step } from "./simulate";
import type { SimContext } from "./simulate";
import type { FighterDef, MatchRules, StageDef } from "./types";

const STAGE: StageDef = {
  id: "s",
  name: "S",
  series: "",
  platforms: [{ x: 0, y: 0, halfWidth: fx(80), soft: false, ledges: true }],
  blastZone: { left: fx(-240), right: fx(240), top: fx(190), bottom: fx(-140) },
  spawns: [{ x: fx(-20), y: 0 }],
  theme: "",
};
const DEF = { id: "t", moves: {}, attributes: { width: fx(2), height: fx(11) } } as unknown as FighterDef;
const CTX: SimContext = { fighter: () => DEF, stage: () => STAGE };
const RULES: MatchRules = { mode: "time", stocks: 1, timeLimit: 60 * 60 * 5, smashBall: true, oneOnOne: false };

describe("the Smash Ball (Plan 5)", () => {
  it("floats over the stage and never drifts out of reach", () => {
    let s = createInitialState("s", [{ defId: "t" }], RULES, 77, CTX);
    s.fighters[0].action = "dead";
    s.fighters[0].stocks = 0;
    s.smashBall = { active: true, x: 0, y: fx(30), vx: 0, vy: 0, health: fx(4000), driftTimer: 0 };
    for (let i = 0; i < 3000; i++) {
      s = step(s, [0], { ctx: CTX }).state;
      // One frame of drift past the edge at most, then it turns back.
      expect(Math.abs(s.smashBall.x)).toBeLessThanOrEqual(fx(80) + fx(2));
      expect(s.smashBall.y).toBeLessThanOrEqual(SMASH_BALL_CEILING + fx(2));
      expect(s.smashBall.y).toBeGreaterThanOrEqual(SMASH_BALL_FLOOR - fx(2));
    }
  });
});
```

`src/game/golden.test.ts` — apply:

```diff
--- a/src/game/golden.test.ts
+++ b/src/game/golden.test.ts
@@ -113,9 +113,10 @@ function play(match: (typeof MATCHES)[number]): Played {
     CTX,
   );
   const worlds: CpuWorld[] = match.fighters.map((id) => {
     const def = CTX.fighter(id);
-    return { stage: stageViewFromDef(stage), jumps: def.attributes.jumps, meleeReach: meleeReachFromDef(def) };
+    // Plan 5: the CPU knows its own moveset (and a copied one), and its reach comes from its scripts.
+    return { stage: stageViewFromDef(stage), jumps: def.attributes.jumps, meleeReach: meleeReachFromDef(def, CTX.bones), def, fighter: CTX.fighter };
   });
   let cpuSeed = match.seed ^ 0x1f2e3d4c;
   let prev: InputFrame[] = match.fighters.map(() => 0);
   const digests: number[] = [];
```

`src/game/matchRunner.test.ts` — apply:

```diff
--- a/src/game/matchRunner.test.ts
+++ b/src/game/matchRunner.test.ts
@@ -21,8 +21,12 @@ import {
   type PlayerSlot,
 } from "./matchRunner";
 import { bootstrapEngine, getFighterOrThrow, getStageOrThrow } from "./bootstrap";
 import { meleeReachFromDef } from "@/ai/behaviours";
+import { LEGACY_BONE_TABLE } from "@/engine/acmd/bones";
+import { scriptHitboxes } from "@/engine/acmd/hitboxes";
+import { runScript } from "@/engine/acmd/interpreter";
+import { gameScriptFor } from "@/engine/acmd/legacy";
 import type { MatchRules } from "@/engine/types";
 
 const RULES: MatchRules = {
   mode: "stock",
@@ -185,10 +189,18 @@ describe("a CPU's swing range matches its arms", () => {
       // stops approaching, starts swinging, connects with nothing, and because
       // the state is then identical next frame, decides the same thing forever.
       for (const slot of ["jab1", "ftilt"] as const) {
         const move = def.moves[slot];
-        if (!move || move.hitboxes.length === 0) continue;
-        const furthest = Math.max(...move.hitboxes.map((h) => h.x + h.radius));
+        const script = gameScriptFor(def, slot);
+        if (!move || script === null) continue;
+        // Plan 5: what the move's script really puts out, frame by frame.
+        let furthest = 0;
+        for (let g = 1; g <= move.totalFrames; g++) {
+          for (const h of scriptHitboxes(runScript(script, g), def.id, script.motion, g, LEGACY_BONE_TABLE)) {
+            furthest = Math.max(furthest, h.x + h.radius, (h.x2 ?? h.x) + h.radius);
+          }
+        }
+        if (furthest === 0) continue;
         expect(reach).toBeLessThanOrEqual(furthest);
       }
 
       // And a positive one, or the CPU would walk into the opponent and never
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/ai/behaviours.test.ts src/ai/specials.test.ts src/engine/smashBall.test.ts src/game/golden.test.ts src/game/matchRunner.test.ts`
Expected: FAIL — 6 failed | 67 passed; `specials.test.ts` cannot load (`Failed to resolve import "./specials"`); the rest: `expected [ 'tech', 'escape', 'survive', …(9) ] to deeply equal [ 'tech', 'escape', 'survive', …(16) ]`, `expected 124543 to be less than or equal to NaN` (reach from scripts), and the golden trace (`first divergence by frame 100`) until it is regenerated.

- [ ] **Step 3: Implement**

`src/ai/behaviours.ts` — apply:

```diff
--- a/src/ai/behaviours.ts
+++ b/src/ai/behaviours.ts
@@ -42,8 +42,13 @@ import {
   SMASH_INPUT_WINDOW,
   TECH_WINDOW,
 } from "@/engine/constants";
 import { abs, fx, magnitude } from "@/engine/fixed";
+import { LEGACY_BONE_TABLE, type BoneTable } from "@/engine/acmd/bones";
+import { scriptHitboxes } from "@/engine/acmd/hitboxes";
+import { runScript } from "@/engine/acmd/interpreter";
+import { gameScriptFor } from "@/engine/acmd/legacy";
+import { counter, finalSmash, holding, reflect, sideRecover, smashBall, storeCharge } from "./specials";
 
 /* ------------------------------------------------------------------ stage -- */
 
 /**
@@ -137,8 +142,10 @@ export interface LevelTuning {
   /** Plan 5: how reliably it techs a landing and air-dodges out of hitstun. */
   readonly techSkill: number;
   /** Plan 5: how often it lets go of its shield to parry a swing it sees coming. */
   readonly parrySkill: number;
+  /** Plan 5: how well it uses its specials — reflect, counter, charge, swallow. */
+  readonly specialSkill: number;
 }
 
 /* ------------------------------------------------------------ observation -- */
 
@@ -272,9 +279,11 @@ export const ROLL_MOVE = 4;
 export const ROLL_FUMBLE = 5;
 /** Plan 5: teching and hitstun cancels share one roll; parrying has its own. */
 export const ROLL_TECH = 6;
 export const ROLL_PARRY = 7;
-export const DECISION_ROLLS = 8;
+/** Plan 5: the specials (`specials.ts`) share one roll, gated by `specialSkill`. */
+export const ROLL_SPECIAL = 8;
+export const DECISION_ROLLS = 9;
 
 export interface BehaviourContext {
   /** Read for `frame` and `rules` only — never for the opponent. */
   readonly state: GameState;
@@ -286,8 +295,10 @@ export interface BehaviourContext {
   /** How far this fighter's pokes actually reach. See `meleeReachFromDef`. */
   readonly meleeReach: number;
   /** Pre-drawn randoms in [0,1), one per `ROLL_*` slot. */
   readonly rolls: readonly number[];
+  /** Plan 5: its own fighter — a player knows the moveset they picked. Absent in some tests. */
+  readonly def?: FighterDef;
 }
 
 export interface BehaviourResult {
   readonly score: number;
@@ -300,9 +311,16 @@ export type BehaviourName =
   | "tech"
   | "escape"
   | "survive"
   | "recover"
+  | "sideRecover"
+  | "holding"
+  | "finalSmash"
   | "parry"
+  | "reflect"
+  | "counter"
+  | "storeCharge"
+  | "smashBall"
   | "shield"
   | "edgeguard"
   | "attack"
   | "platformMove"
@@ -350,19 +368,26 @@ const POKE_SLOTS: readonly MoveSlot[] = ["jab1", "ftilt"];
  * Conservative on purpose in one more way: it ignores the victim's hurtbox
  * radius, which only ever adds reach. Standing a little too close costs the CPU
  * nothing; standing a little too far costs it the entire match.
  */
-export function meleeReachFromDef(def: FighterDef): number {
+export function meleeReachFromDef(def: FighterDef, bones: BoneTable = LEGACY_BONE_TABLE): number {
   let reach = 0;
   let found = false;
 
   for (const slot of POKE_SLOTS) {
     const move = def.moves[slot];
-    if (!move) continue;
+    const script = gameScriptFor(def, slot);
+    if (!move || script === null) continue;
 
+    // Plan 5: from the move's script, frame by frame, wherever the bone table
+    // puts its boxes — the reach a limb-bone script really has once Plan 4's
+    // bake places it, not the legacy table's offset.
     let furthest = 0;
-    for (const hitbox of move.hitboxes) {
-      furthest = Math.max(furthest, hitbox.x + hitbox.radius);
+    for (let g = 1; g <= move.totalFrames; g++) {
+      const state = runScript(script, g);
+      for (const hb of scriptHitboxes(state, def.id, script.motion, g, bones)) {
+        furthest = Math.max(furthest, hb.x + hb.radius, (hb.x2 ?? hb.x) + hb.radius);
+      }
     }
     if (furthest <= 0) continue;
 
     reach = found ? Math.min(reach, furthest) : furthest;
@@ -852,12 +877,19 @@ export const idle: Behaviour = () => ({ score: 1, input: 0 });
 export const BEHAVIOURS: readonly { readonly name: BehaviourName; readonly run: Behaviour }[] = [
   { name: "tech", run: tech },
   { name: "escape", run: escape },
   { name: "survive", run: survive },
+  { name: "sideRecover", run: sideRecover },
   { name: "recover", run: recover },
+  { name: "holding", run: holding },
+  { name: "finalSmash", run: finalSmash },
   { name: "parry", run: parry },
+  { name: "reflect", run: reflect },
+  { name: "counter", run: counter },
   { name: "shield", run: shield },
   { name: "edgeguard", run: edgeguard },
+  { name: "storeCharge", run: storeCharge },
+  { name: "smashBall", run: smashBall },
   { name: "attack", run: attack },
   { name: "platformMove", run: platformMove },
   { name: "approach", run: approach },
   { name: "retreat", run: retreat },
```

`src/ai/cpu.ts` — apply:

```diff
--- a/src/ai/cpu.ts
+++ b/src/ai/cpu.ts
@@ -26,9 +26,10 @@
  * four frames, which is roughly a very good human.
  */
 
 import { nextRandom } from "@/engine/fixed";
-import type { GameState, InputFrame } from "@/engine/types";
+import { withCopyAbility } from "@/engine/inhale";
+import type { FighterDef, FighterState, GameState, InputFrame } from "@/engine/types";
 import {
   BEHAVIOURS,
   DECISION_ROLLS,
   DEFAULT_STAGE_VIEW,
@@ -57,8 +58,21 @@ export interface CpuWorld {
    * How far this fighter's pokes reach, from `meleeReachFromDef`. Defaults to
    * `MELEE_RANGE`, which is right for nobody in particular — supply it.
    */
   readonly meleeReach?: number;
+  /** Plan 5: this CPU's own fighter, for its specials (`specials.ts`). */
+  readonly def?: FighterDef;
+  /** Plan 5: any fighter by id, so a Kirby CPU knows the move its Copy Ability gave it. */
+  readonly fighter?: (defId: string) => FighterDef | undefined;
+}
+
+/**
+ * The moveset this CPU fights with now: its own, or — Kirby with a Copy
+ * Ability — the one the simulation runs, through the same `withCopyAbility`.
+ */
+export function cpuDef(self: FighterState, world: CpuWorld): FighterDef | undefined {
+  if (world.def === undefined || self.combat.copy === "" || world.fighter === undefined) return world.def;
+  return withCopyAbility(world.def, world.fighter(self.combat.copy) ?? null);
 }
 
 /**
  * The nine opponents.
@@ -81,21 +95,22 @@ export interface CpuWorld {
  *
  * Plan 5 adds two: `techSkill` (teching landings, air-dodging out of hitstun)
  * climbs with `recoverySkill` because both are survival; `parrySkill` stays
  * at zero until level 4 and reaches only 0.5, because a parry is a read and a
- * CPU that parried everything would be reading inputs. UNVERIFIED: the values
+ * CPU that parried everything would be reading inputs; `specialSkill`
+ * (reflecting, countering, charging, swallowing) climbs like `moveChoiceSkill`. UNVERIFIED: the values
  * are tuning, not data — Ultimate's CPU is not published.
  */
 const TUNING: readonly LevelTuning[] = [
-  { level: 1, reactionFrames: 30, aggression: 0.15, shieldRate: 0.02, dodgeRate: 0.0, diSkill: 0.0, sdiSkill: 0.0, recoverySkill: 0.15, edgeguardSkill: 0.0, moveChoiceSkill: 0.15, noise: 0.9, fumbleChance: 0.3, techSkill: 0.0, parrySkill: 0.0 },
-  { level: 2, reactionFrames: 27, aggression: 0.22, shieldRate: 0.06, dodgeRate: 0.02, diSkill: 0.05, sdiSkill: 0.0, recoverySkill: 0.3, edgeguardSkill: 0.0, moveChoiceSkill: 0.25, noise: 0.8, fumbleChance: 0.24, techSkill: 0.05, parrySkill: 0.0 },
-  { level: 3, reactionFrames: 23, aggression: 0.3, shieldRate: 0.12, dodgeRate: 0.05, diSkill: 0.15, sdiSkill: 0.0, recoverySkill: 0.45, edgeguardSkill: 0.05, moveChoiceSkill: 0.35, noise: 0.7, fumbleChance: 0.19, techSkill: 0.12, parrySkill: 0.0 },
-  { level: 4, reactionFrames: 20, aggression: 0.38, shieldRate: 0.2, dodgeRate: 0.1, diSkill: 0.28, sdiSkill: 0.05, recoverySkill: 0.58, edgeguardSkill: 0.12, moveChoiceSkill: 0.45, noise: 0.6, fumbleChance: 0.15, techSkill: 0.22, parrySkill: 0.02 },
-  { level: 5, reactionFrames: 16, aggression: 0.47, shieldRate: 0.3, dodgeRate: 0.18, diSkill: 0.42, sdiSkill: 0.15, recoverySkill: 0.7, edgeguardSkill: 0.22, moveChoiceSkill: 0.55, noise: 0.5, fumbleChance: 0.11, techSkill: 0.35, parrySkill: 0.05 },
-  { level: 6, reactionFrames: 13, aggression: 0.56, shieldRate: 0.42, dodgeRate: 0.28, diSkill: 0.56, sdiSkill: 0.3, recoverySkill: 0.8, edgeguardSkill: 0.36, moveChoiceSkill: 0.66, noise: 0.4, fumbleChance: 0.08, techSkill: 0.5, parrySkill: 0.1 },
-  { level: 7, reactionFrames: 10, aggression: 0.66, shieldRate: 0.56, dodgeRate: 0.4, diSkill: 0.7, sdiSkill: 0.48, recoverySkill: 0.88, edgeguardSkill: 0.52, moveChoiceSkill: 0.77, noise: 0.3, fumbleChance: 0.05, techSkill: 0.65, parrySkill: 0.2 },
-  { level: 8, reactionFrames: 7, aggression: 0.78, shieldRate: 0.72, dodgeRate: 0.55, diSkill: 0.85, sdiSkill: 0.7, recoverySkill: 0.95, edgeguardSkill: 0.72, moveChoiceSkill: 0.88, noise: 0.2, fumbleChance: 0.02, techSkill: 0.8, parrySkill: 0.35 },
-  { level: 9, reactionFrames: 4, aggression: 0.9, shieldRate: 0.9, dodgeRate: 0.72, diSkill: 1.0, sdiSkill: 0.95, recoverySkill: 1.0, edgeguardSkill: 0.92, moveChoiceSkill: 1.0, noise: 0.1, fumbleChance: 0.0, techSkill: 0.95, parrySkill: 0.5 },
+  { level: 1, reactionFrames: 30, aggression: 0.15, shieldRate: 0.02, dodgeRate: 0.0, diSkill: 0.0, sdiSkill: 0.0, recoverySkill: 0.15, edgeguardSkill: 0.0, moveChoiceSkill: 0.15, noise: 0.9, fumbleChance: 0.3, techSkill: 0.0, parrySkill: 0.0, specialSkill: 0.0 },
+  { level: 2, reactionFrames: 27, aggression: 0.22, shieldRate: 0.06, dodgeRate: 0.02, diSkill: 0.05, sdiSkill: 0.0, recoverySkill: 0.3, edgeguardSkill: 0.0, moveChoiceSkill: 0.25, noise: 0.8, fumbleChance: 0.24, techSkill: 0.05, parrySkill: 0.0, specialSkill: 0.05 },
+  { level: 3, reactionFrames: 23, aggression: 0.3, shieldRate: 0.12, dodgeRate: 0.05, diSkill: 0.15, sdiSkill: 0.0, recoverySkill: 0.45, edgeguardSkill: 0.05, moveChoiceSkill: 0.35, noise: 0.7, fumbleChance: 0.19, techSkill: 0.12, parrySkill: 0.0, specialSkill: 0.12 },
+  { level: 4, reactionFrames: 20, aggression: 0.38, shieldRate: 0.2, dodgeRate: 0.1, diSkill: 0.28, sdiSkill: 0.05, recoverySkill: 0.58, edgeguardSkill: 0.12, moveChoiceSkill: 0.45, noise: 0.6, fumbleChance: 0.15, techSkill: 0.22, parrySkill: 0.02, specialSkill: 0.22 },
+  { level: 5, reactionFrames: 16, aggression: 0.47, shieldRate: 0.3, dodgeRate: 0.18, diSkill: 0.42, sdiSkill: 0.15, recoverySkill: 0.7, edgeguardSkill: 0.22, moveChoiceSkill: 0.55, noise: 0.5, fumbleChance: 0.11, techSkill: 0.35, parrySkill: 0.05, specialSkill: 0.35 },
+  { level: 6, reactionFrames: 13, aggression: 0.56, shieldRate: 0.42, dodgeRate: 0.28, diSkill: 0.56, sdiSkill: 0.3, recoverySkill: 0.8, edgeguardSkill: 0.36, moveChoiceSkill: 0.66, noise: 0.4, fumbleChance: 0.08, techSkill: 0.5, parrySkill: 0.1, specialSkill: 0.5 },
+  { level: 7, reactionFrames: 10, aggression: 0.66, shieldRate: 0.56, dodgeRate: 0.4, diSkill: 0.7, sdiSkill: 0.48, recoverySkill: 0.88, edgeguardSkill: 0.52, moveChoiceSkill: 0.77, noise: 0.3, fumbleChance: 0.05, techSkill: 0.65, parrySkill: 0.2, specialSkill: 0.65 },
+  { level: 8, reactionFrames: 7, aggression: 0.78, shieldRate: 0.72, dodgeRate: 0.55, diSkill: 0.85, sdiSkill: 0.7, recoverySkill: 0.95, edgeguardSkill: 0.72, moveChoiceSkill: 0.88, noise: 0.2, fumbleChance: 0.02, techSkill: 0.8, parrySkill: 0.35, specialSkill: 0.8 },
+  { level: 9, reactionFrames: 4, aggression: 0.9, shieldRate: 0.9, dodgeRate: 0.72, diSkill: 1.0, sdiSkill: 0.95, recoverySkill: 1.0, edgeguardSkill: 0.92, moveChoiceSkill: 1.0, noise: 0.1, fumbleChance: 0.0, techSkill: 0.95, parrySkill: 0.5, specialSkill: 0.95 },
 ];
 
 export function tuningForLevel(level: number): LevelTuning {
   const clamped = Math.min(Math.max(Math.round(level), MIN_LEVEL), MAX_LEVEL);
@@ -157,8 +172,9 @@ export function decideCpu(
     tuning,
     jumps: world.jumps ?? DEFAULT_AIR_JUMPS,
     meleeReach: world.meleeReach ?? MELEE_RANGE,
     rolls,
+    def: cpuDef(self, world),
   };
 
   let bestScore = -1;
   let bestInput: InputFrame = 0;
```

`src/ai/specials.ts` (new file):

```ts
/**
 * The CPU's Plan 5 offence (Task 19): what it does with the specials Plan 5
 * gave the roster, the Final Smash and the Smash Ball.
 *
 * Same rules as `behaviours.ts`: a pure function of the context, every random
 * number from `ctx.rolls`, and the opponent seen only through `ctx.view`. The
 * CPU knows its *own* moveset (`ctx.def`) — what a player knows about the
 * fighter they picked — and sees projectiles and the Smash Ball, which are on
 * screen for everybody.
 */

import { abs, fx } from "@/engine/fixed";
import { Btn, type InputFrame, type MoveDef } from "@/engine/types";
import {
  ROLL_MOVE,
  ROLL_SPECIAL,
  THREAT_RANGE,
  VERTICAL_REACH,
  canAct,
  isAttacking,
  isOffstage,
  pulse,
  towardX,
  type Behaviour,
  type BehaviourContext,
  type BehaviourResult,
} from "./behaviours";

const NOTHING: BehaviourResult = { score: 0, input: 0 };

/** How far ahead a trapping Final Smash's first hit reaches, for the CPU's purposes. UNVERIFIED tuning. */
export const FINAL_SMASH_RANGE = fx(30);
/** A dashing Final Smash (Critical Hit, Volt Tackle) catches anybody ahead, this far. UNVERIFIED tuning. */
export const FINAL_SMASH_DASH_RANGE = fx(120);

function skilled(ctx: BehaviourContext): boolean {
  return ctx.rolls[ROLL_SPECIAL] < ctx.tuning.specialSkill;
}

/** The slot holding a move with this property, and the stick direction that picks it. */
function specialWith(ctx: BehaviourContext, has: (m: MoveDef) => boolean): { slot: "neutralB" | "sideB" | "upB" | "downB"; dir: InputFrame } | null {
  const moves = ctx.def?.moves;
  if (moves === undefined) return null;
  if (moves.downB !== undefined && has(moves.downB)) return { slot: "downB", dir: Btn.Down };
  if (moves.sideB !== undefined && has(moves.sideB)) return { slot: "sideB", dir: 0 };
  if (moves.neutralB !== undefined && has(moves.neutralB)) return { slot: "neutralB", dir: 0 };
  return null;
}

/**
 * Use the Smash Ball's power: at once for a Final Smash that needs no aim,
 * when the target is within the first hit's reach for one that traps.
 */
export const finalSmash: Behaviour = (ctx) => {
  const { self, target, dx, dy, distance, facingTarget } = ctx.view;
  const fs = ctx.def?.moves.finalSmash;
  if (self.finalSmashReady <= 0 || fs === undefined || !canAct(self) || !target) return NOTHING;
  const dashes = fs.momentum !== undefined;
  const inReach = dashes ? facingTarget && abs(dy) < VERTICAL_REACH && abs(dx) <= FINAL_SMASH_DASH_RANGE : distance <= FINAL_SMASH_RANGE;
  if (fs.final?.trap === true && !inReach) return NOTHING;
  if (fs.final?.trap === true && !facingTarget) return { score: 880, input: towardX(0, dx) };
  return { score: 900, input: pulse(ctx.view.frame, self.port, 4, 1) ? Btn.Special : 0 };
};

/** Higher than this above the stage the Smash Ball is out of a jump's reach. UNVERIFIED tuning. */
export const BALL_REACH_HEIGHT = fx(45);

/** Go and break the Smash Ball while nobody has its power. */
export const smashBall: Behaviour = (ctx) => {
  const { self } = ctx.view;
  const ball = ctx.state.smashBall;
  if (!ball.active || !canAct(self) || ctx.state.fighters.some((f) => f.finalSmashReady > 0)) return NOTHING;
  if (isOffstage(self, ctx.stage)) return NOTHING;
  // Not over the stage, or out of a jump's reach: wait for it to drift back.
  if (ball.x < ctx.stage.leftLedge || ball.x > ctx.stage.rightLedge || ball.y > ctx.stage.groundY + BALL_REACH_HEIGHT) return NOTHING;
  const bx = ball.x - self.x;
  const by = ball.y - self.y;
  const toward = towardX(0, bx);
  if (abs(bx) <= ctx.meleeReach && by >= -fx(4) && by <= VERTICAL_REACH) {
    const swinging = pulse(ctx.view.frame, self.port, 10, 3);
    return { score: 470, input: (bx * self.facing < 0 ? toward : 0) | (swinging ? Btn.Attack : 0) };
  }
  // Above: jump for it; otherwise walk under it.
  const jump = by > VERTICAL_REACH && self.grounded && pulse(ctx.view.frame, self.port, 12, 5);
  return { score: 300 + 150 * ctx.tuning.aggression, input: toward | (jump ? Btn.Jump : 0) };
};

/**
 * Reflect a projectile about to arrive (Fox's Reflector, Mario's Cape): raise
 * the reflector so it is up when the projectile gets there.
 */
export const reflect: Behaviour = (ctx) => {
  const { self } = ctx.view;
  const pick = specialWith(ctx, (m) => m.reflector !== undefined);
  if (pick === null || !canAct(self) || !skilled(ctx)) return NOTHING;
  const reflector = ctx.def?.moves[pick.slot]?.reflector;
  if (reflector === undefined) return NOTHING;
  for (const p of ctx.state.projectiles) {
    if (p.owner === self.port || p.vx === 0) continue;
    const dx = self.x - p.x;
    if ((dx > 0) !== (p.vx > 0) || abs(p.y - (self.y + reflector.y)) > reflector.radius) continue;
    const frames = Math.trunc(abs(dx) / abs(p.vx));
    if (frames < reflector.active[0] || frames > reflector.active[0] + 6) continue;
    const face = pick.slot === "sideB" ? towardX(self.x, p.x) : pick.dir;
    return { score: 640, input: face | Btn.Special };
  }
  return NOTHING;
};

/** Counter a swing it sees start in reach (Marth's Counter). */
export const counter: Behaviour = (ctx) => {
  const { self, targetAction, distance } = ctx.view;
  const pick = specialWith(ctx, (m) => m.counter !== undefined);
  if (pick === null || !canAct(self) || !ctx.view.target) return NOTHING;
  if (!isAttacking(targetAction) || distance > THREAT_RANGE || !skilled(ctx)) return NOTHING;
  return { score: 630, input: pick.dir | Btn.Special };
};

/**
 * Store-mode charges (Charge Shot, Giant Punch, F.L.U.D.D.): charge while the
 * opponent is far, and let a full charge go when they are lined up.
 */
export const storeCharge: Behaviour = (ctx) => {
  const { self, target, dx, dy, distance, facingTarget } = ctx.view;
  const move = ctx.def?.moves.neutralB;
  const sc = move?.specialCharge;
  if (sc?.mode !== "store" || !canAct(self) || !target || !self.grounded || !skilled(ctx)) return NOTHING;
  const full = self.combat.storedCharge >= sc.frames;
  if (full && facingTarget && abs(dy) < VERTICAL_REACH && abs(dx) < fx(100)) {
    return { score: 470, input: pulse(ctx.view.frame, self.port, 6, 1) ? Btn.Special : 0 };
  }
  if (!full && distance > fx(60)) return { score: 350, input: pulse(ctx.view.frame, self.port, 30, 1) ? Btn.Special : 0 };
  return NOTHING;
};

/**
 * With a fighter on its shoulders or in its mouth, do something with them
 * before they struggle free: throw the cargo toward the nearer edge, swallow
 * at a good level, spit otherwise.
 */
export const holding: Behaviour = (ctx) => {
  const { self } = ctx.view;
  if (self.action === "cargoCarry") {
    const edge = self.x < 0 ? ctx.stage.leftLedge : ctx.stage.rightLedge;
    const out = towardX(self.x, edge);
    return { score: 500, input: out | (pulse(ctx.view.frame, self.port, 8, 1) ? Btn.Attack : 0) };
  }
  if (self.action === "inhaleHold") {
    const swallow = ctx.rolls[ROLL_MOVE] < ctx.tuning.specialSkill;
    return { score: 500, input: pulse(ctx.view.frame, self.port, 8, 1) ? (swallow ? Btn.Special : Btn.Attack) : 0 };
  }
  return NOTHING;
};

/**
 * Recover sideways with a special that carries the fighter (Fox Illusion,
 * Skull Bash): far out level with the stage, once the jumps are gone.
 */
export const sideRecover: Behaviour = (ctx) => {
  const { self } = ctx.view;
  const side = ctx.def?.moves.sideB;
  const carries = side?.momentum?.some((m) => m.x > fx(2)) === true;
  if (!carries || !canAct(self) || self.grounded || !isOffstage(self, ctx.stage)) return NOTHING;
  if (self.jumpsUsed < ctx.jumps) return NOTHING;
  const ledge = self.x < 0 ? ctx.stage.leftLedge : ctx.stage.rightLedge;
  if (abs(self.x - ledge) < fx(30) || self.y < ctx.stage.groundY - fx(15) || self.y > ctx.stage.groundY + fx(20)) return NOTHING;
  if (ctx.rolls[ROLL_SPECIAL] >= ctx.tuning.recoverySkill) return NOTHING;
  return { score: 960, input: towardX(self.x, ledge) | Btn.Special };
};
```

`src/engine/simulate.ts` — apply:

```diff
--- a/src/engine/simulate.ts
+++ b/src/engine/simulate.ts
@@ -104,8 +104,9 @@ import {
   findLedgeGrab,
   integrate,
   ledgeIntangibilityFrames,
   ledgePosition,
+  platformCentreX,
   resolveCollision,
 } from "./physics";
 import {
   ENTRY_FRAMES,
@@ -165,8 +166,9 @@ import type {
   FinalPhase,
   MoveSlot,
   ProjectileDef,
   ProjectileState,
+  SmashBallState,
   StageDef,
   StepEvents,
 } from "./types";
 
@@ -788,9 +790,9 @@ export function step(
   }
 
   /* -- 8. the Smash Ball --------------------------------------------------- */
 
-  if (s.rules.smashBall && !paused) updateSmashBall(s);
+  if (s.rules.smashBall && !paused) updateSmashBall(s, stage);
 
   /* -- 9. blast zones ------------------------------------------------------ */
 
   for (const f of s.fighters) {
@@ -1840,9 +1842,9 @@ function applyWindbox(attacker: FighterState, victim: FighterState, victimDef: F
  * It drifts on a seeded RNG, loses 2 HP every 60 frames on its own so a stalemate
  * cannot last forever, and awards the Final Smash to whoever lands the hit that
  * takes it to zero.
  */
-function updateSmashBall(s: GameState): void {
+function updateSmashBall(s: GameState, stage: StageDef): void {
   const ball = s.smashBall;
   const anyoneCharged = s.fighters.some((f) => f.finalSmashReady > 0);
 
   if (!ball.active) {
@@ -1868,8 +1870,9 @@ function updateSmashBall(s: GameState): void {
   }
   ball.driftTimer -= 1;
   ball.x += ball.vx;
   ball.y += ball.vy;
+  keepOverStage(ball, stage, s.frame);
 
   // 2 HP every 60 frames on its own, so a Smash Ball nobody commits to hitting
   // eventually leaves rather than turning the match into a stalemate around it.
   if (s.frame % SMASH_BALL_DECAY_INTERVAL === 0) ball.health -= SMASH_BALL_DECAY;
@@ -1879,8 +1882,27 @@ function updateSmashBall(s: GameState): void {
   }
 
 }
 
+/**
+ * The Smash Ball floats over the stage (Plan 5): it turns back at the main
+ * platform's ends and keeps between `SMASH_BALL_FLOOR` and `SMASH_BALL_CEILING`
+ * above it. UNVERIFIED: SmashWiki says the ball "floats around the stage" and
+ * gives no bounds; without any it drifted off the screen for good, out of
+ * every fighter's reach.
+ */
+function keepOverStage(ball: SmashBallState, stage: StageDef, frame: number): void {
+  const main = stage.platforms.find((p) => p.ledges) ?? stage.platforms[0];
+  if (main === undefined) return;
+  const cx = platformCentreX(main, frame);
+  if ((ball.x < cx - main.halfWidth && ball.vx < 0) || (ball.x > cx + main.halfWidth && ball.vx > 0)) ball.vx = -ball.vx;
+  if ((ball.y > main.y + SMASH_BALL_CEILING && ball.vy > 0) || (ball.y < main.y + SMASH_BALL_FLOOR && ball.vy < 0)) ball.vy = -ball.vy;
+}
+
+/** How high over the main platform the Smash Ball may float. UNVERIFIED. */
+export const SMASH_BALL_FLOOR = fx(10);
+export const SMASH_BALL_CEILING = fx(60);
+
 function resolveSmashBallHits(
   s: GameState,
   candidates: readonly Candidate[],
   events: StepEvents,
```

`src/game/matchRunner.ts` — apply:

```diff
--- a/src/game/matchRunner.ts
+++ b/src/game/matchRunner.ts
@@ -189,15 +189,22 @@ export function createMatchRunner(options: MatchRunnerOptions): MatchRunner {
   // writes its seed back — a CPU whose seed is dropped re-rolls the same
   // decision forever and stops looking like a player.
   let cpuSeed = seed ^ 0x1f2e3d4c;
 
-  const cpuWorlds: CpuWorld[] = players.map((p, i) => ({
-    stage: stageViewFromDef(stage),
-    jumps: defs[i]?.attributes.jumps ?? 2,
-    // Per fighter, from its own move data. A shared constant here is what let a
-    // CPU decide it was close enough to punch from further than its arm goes.
-    meleeReach: defs[i] ? meleeReachFromDef(defs[i]) : undefined,
-  }));
+  const cpuWorlds: CpuWorld[] = players.map((p, i) => {
+    // The fighter as the game runs it (Plan 4's limb scripts, Plan 5's reach).
+    const def = defs[i] ? GAME_SIM_CONTEXT.fighter(p.selection.defId) : undefined;
+    return {
+      stage: stageViewFromDef(stage),
+      jumps: defs[i]?.attributes.jumps ?? 2,
+      // Per fighter, from its own scripts and bones. A shared constant here is
+      // what let a CPU decide it was close enough to punch from further than
+      // its arm goes.
+      meleeReach: def ? meleeReachFromDef(def, GAME_SIM_CONTEXT.bones) : undefined,
+      def,
+      fighter: (id: string) => GAME_SIM_CONTEXT.fighter(id),
+    };
+  });
 
   const camera = createCamera(stage);
   const vfx: VfxState = createVfx();
   const hud: HudState = createHudState();
```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/ai/behaviours.test.ts src/ai/specials.test.ts src/engine/smashBall.test.ts src/game/golden.test.ts src/game/matchRunner.test.ts`
Expected: PASS (`src/ai/specials.test.ts` 12 tests, `src/engine/smashBall.test.ts` 1 tests).

- [ ] **Step 5: Regenerate the generated files, in this order**

Each command rewrites one artefact from the code; the order matters (the limb list feeds the reconcile list and the bake, the bake feeds reach). Then review each diff against the scratch result below.

```bash
UPDATE_GOLDEN=1 pnpm vitest run src/game/golden.test.ts
```

**Golden trace — deliberate behaviour change.** all four traces diverge: `DECISION_ROLLS` is 9, the CPUs use their specials, and their reach comes from their scripts.

- [ ] **Step 6: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0; golden trace regenerated as above.

- [ ] **Step 7: Commit**

```bash
git add super-smash/src/ai/behaviours.test.ts super-smash/src/ai/behaviours.ts super-smash/src/ai/cpu.ts super-smash/src/ai/specials.test.ts super-smash/src/ai/specials.ts super-smash/src/engine/simulate.ts super-smash/src/engine/smashBall.test.ts super-smash/src/game/__golden__/engine-trace.json super-smash/src/game/golden.test.ts super-smash/src/game/matchRunner.test.ts super-smash/src/game/matchRunner.ts
git commit -m "super-smash: CPU uses Final Smashes, the Smash Ball, reflectors, counters, charges, carries and side recovery" -m "Seeded, pure behaviours in ai/specials.ts; a Kirby CPU uses its copied move; reach from the fighter's own scripts on the installed bones. The Smash Ball stays over the stage (bounds UNVERIFIED). Golden trace regenerated: all four traces diverge (nine rolls per decision, specials, script reach)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 20: Stick Jump: in the sim, the match config, online and /controls

Ultimate's per-player "Stick Jump" option: off, up on the stick (or the up key) never jumps, so up tilts and up specials never leave the ground by accident. It changes what `step()` does with the same input, so it is simulation state: `CombatState.controls` (a bit set; `CONTROL_STICK_JUMP_OFF`, all known bits `CONTROL_BITS`), set from `FighterSelection.controls` at match start, carried in the online start config (`OnlineMatchConfig.controls`, checked against `CONTROL_BITS`) and in each lobby pick (`stickJump`), and shown on `/controls` (`PlayerOptions`). `configureOnline` starts both online slots with this machine's player's option; the other peer's pick overwrites theirs. A start from a host before Plan 5 (no `controls`) is read as the defaults so that it arrives and the fingerprint check refuses it by name (its rules version differs) — never dropped, which would leave the guest waiting. CPUs play the default. The keyboard schemes are unchanged.

**Files:**
- Create: `super-smash/src/components/menu/PlayerOptions.test.tsx`, `super-smash/src/components/menu/PlayerOptions.tsx`, `super-smash/src/engine/controls.test.ts`
- Modify: `super-smash/src/app/play/page.tsx`, `super-smash/src/components/menu/ControlsPanel.tsx`, `super-smash/src/engine/combat.ts`, `super-smash/src/engine/hash.ts`, `super-smash/src/engine/simulate.ts`, `super-smash/src/engine/states.ts`, `super-smash/src/engine/types.ts`, `super-smash/src/game/onlineConfig.test.ts`, `super-smash/src/game/onlineConfig.ts`, `super-smash/src/lib/matchConfig.ts`, `super-smash/src/lib/onlineStore.test.ts`, `super-smash/src/lib/onlineStore.ts`, `super-smash/src/net/online/lobby.test.ts`, `super-smash/src/net/online/lobby.ts`

**Interfaces:**
- Consumes: `interpretInput` (Plan 2 `states.ts`), `createInitialState`, `FighterSelection`; Plan 1's lobby (`parseLobbyMessage`, `buildStartConfig`, `runnerSlotsFor`), `useOnlineStore`, `useMatchConfig`, `/play`'s selection building, `ControlsPanel`.
- Produces: `CONTROL_STICK_JUMP_OFF = 1`, `CONTROL_BITS`, `CombatState.controls`, `FighterSelection.controls?`; `PlayerSlot.stickJump`, `controlsOf(slot)`, `setStickJump(port, on)` (`lib/matchConfig.ts`); `OnlineMatchConfig.controls`; lobby pick `stickJump?`; `src/components/menu/PlayerOptions.tsx`.

- [ ] **Step 1: Write the failing tests**

`src/components/menu/PlayerOptions.test.tsx` (new file):

```tsx
import { beforeEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

import { CONTROL_STICK_JUMP_OFF } from "@/engine/types";
import { controlsOf, useMatchConfig } from "@/lib/matchConfig";
import { PlayerOptions } from "./PlayerOptions";

beforeEach(() => {
  useMatchConfig.getState().reset();
});

describe("PlayerOptions (Plan 5)", () => {
  it("turns a human's stick jump off, and the match gets the option", () => {
    render(<PlayerOptions />);
    const toggle = screen.getByRole("switch", { name: "P1 stick jump" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(toggle);
    const p1 = useMatchConfig.getState().players[0];
    expect(p1.stickJump).toBe(false);
    expect(controlsOf(p1)).toBe(CONTROL_STICK_JUMP_OFF);
  });

  it("offers nothing for a CPU, which always plays the default", () => {
    render(<PlayerOptions />);
    expect(screen.queryByRole("switch", { name: "P2 stick jump" })).toBeNull();
    expect(controlsOf({ kind: "cpu", stickJump: false })).toBe(0);
  });
});
```

`src/engine/controls.test.ts` (new file):

```ts
import { describe, expect, it } from "vitest";

import { emptyCombat } from "./combat";
import { interpretInput } from "./states";
import { Btn, CONTROL_STICK_JUMP_OFF } from "./types";
import type { FighterState } from "./types";

/** Just what `interpretInput` reads: the press tracking and the control options. */
function tracking(controls: number, framesSinceDirPress: number): FighterState {
  return { lastDirPressed: Btn.Up, framesSinceDirPress, combat: { ...emptyCombat(), controls } } as unknown as FighterState;
}

describe("stick jump (Plan 5)", () => {
  it("jumps off an up flick by default, Ultimate's Stick Jump on", () => {
    const i = interpretInput(tracking(0, 5), Btn.Up, Btn.Up);
    expect(i.jumpPressed).toBe(true);
    expect(i.jumpHeld).toBe(true);
  });

  it("does neither with Stick Jump off: up is only up", () => {
    const i = interpretInput(tracking(CONTROL_STICK_JUMP_OFF, 5), Btn.Up, Btn.Up);
    expect(i.jumpPressed).toBe(false);
    expect(i.jumpHeld).toBe(false);
    expect(i.y).toBe(1);
  });

  it("still jumps on the jump button either way", () => {
    expect(interpretInput(tracking(CONTROL_STICK_JUMP_OFF, 20), Btn.Jump, 0).jumpPressed).toBe(true);
  });
});
```

`src/game/onlineConfig.test.ts` — apply:

```diff
--- a/src/game/onlineConfig.test.ts
+++ b/src/game/onlineConfig.test.ts
@@ -1,19 +1,20 @@
 import { beforeAll, describe, expect, it } from "vitest";
 
-import type { MatchRules } from "@/engine/types";
-import { RANDOM_FIGHTER, RANDOM_STAGE, type PlayerSlot } from "@/lib/matchConfig";
+import { ENGINE_RULES_VERSION } from "@/engine/constants";
+import { CONTROL_STICK_JUMP_OFF, type MatchRules } from "@/engine/types";
+import { RANDOM_FIGHTER, RANDOM_STAGE, useMatchConfig, type PlayerSlot } from "@/lib/matchConfig";
 import { parseLobbyMessage } from "@/net/online/lobby";
 import { FIGHTERS, STAGES, bootstrapEngine, resolveMatchStage } from "./bootstrap";
 import { buildStartConfig, newMatchSeed, runnerSlotsFor, startConfigProblem } from "./onlineConfig";
-import { engineFingerprint } from "./simContext";
+import { GAME_ENGINE_RULES, GAME_SIM_CONTEXT, engineFingerprint } from "./simContext";
 
 const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 9000, smashBall: true, oneOnOne: false };
 
 function players(a: string | null, b: string | null): PlayerSlot[] {
   return [
-    { port: 0, kind: "human", cpuLevel: 3, fighterId: a, costume: 0, scheme: "arrows" },
-    { port: 1, kind: "human", cpuLevel: 3, fighterId: b, costume: 1, scheme: "arrows" },
+    { port: 0, kind: "human", cpuLevel: 3, fighterId: a, costume: 0, scheme: "arrows", stickJump: true },
+    { port: 1, kind: "human", cpuLevel: 3, fighterId: b, costume: 1, scheme: "arrows", stickJump: false },
   ];
 }
 
 beforeAll(() => {
@@ -75,9 +76,37 @@ describe("the host's start config", () => {
 
   it("turns a config into the runner's two human slots", () => {
     const config = buildStartConfig({ players: players("mario", "fox"), stageId: "battlefield", stageForm: "normal", rules: RULES, seed: 5 });
     expect(runnerSlotsFor(config)).toEqual([
-      { selection: { defId: "mario", costume: 0 }, cpuLevel: null, label: "P1" },
-      { selection: { defId: "fox", costume: 1 }, cpuLevel: null, label: "P2" },
+      // Plan 5: the players' control options travel too (P2 has stick jump off).
+      { selection: { defId: "mario", costume: 0, controls: 0 }, cpuLevel: null, label: "P1" },
+      { selection: { defId: "fox", costume: 1, controls: CONTROL_STICK_JUMP_OFF }, cpuLevel: null, label: "P2" },
     ]);
   });
 });
+
+describe("control options online (Plan 5)", () => {
+  it("ships each port's stick jump in the start, and the runner hands it to the sim", () => {
+    const config = buildStartConfig({ players: players("mario", "fox"), stageId: "battlefield", stageForm: "normal", rules: RULES, seed: 5 });
+    expect(config.controls).toEqual([0, CONTROL_STICK_JUMP_OFF]);
+    expect(runnerSlotsFor(config).map((s) => s.selection.controls)).toEqual([0, CONTROL_STICK_JUMP_OFF]);
+  });
+
+  it("refuses, by name, a start from a host on the rules before Plan 5 (no controls, an older version)", () => {
+    const config = buildStartConfig({ players: players("mario", "fox"), stageId: "battlefield", stageForm: "normal", rules: RULES, seed: 5 });
+    const older = engineFingerprint(GAME_SIM_CONTEXT, { version: ENGINE_RULES_VERSION - 1, activeSlots: GAME_ENGINE_RULES.activeSlots });
+    const { controls: _drop, ...rest } = config;
+    void _drop;
+    const wire = parseLobbyMessage(JSON.parse(JSON.stringify({ kind: "start", config: { ...rest, bones: older } })));
+    expect(wire?.kind).toBe("start");
+    if (wire?.kind !== "start") return;
+    expect(startConfigProblem(wire.config)).toMatch(/differ/);
+  });
+
+  it("starts an online match with this machine's Stick Jump, on both ports until the other peer's pick says otherwise", () => {
+    useMatchConfig.getState().reset();
+    useMatchConfig.getState().setStickJump(0, false);
+    useMatchConfig.getState().configureOnline();
+    expect(useMatchConfig.getState().players.map((p) => p.stickJump)).toEqual([false, false]);
+    useMatchConfig.getState().reset();
+  });
+});
```

`src/lib/onlineStore.test.ts` — apply:

```diff
--- a/src/lib/onlineStore.test.ts
+++ b/src/lib/onlineStore.test.ts
@@ -42,8 +42,9 @@ const CONFIG: OnlineMatchConfig = {
   stageForm: "normal",
   rules: { mode: "stock", stocks: 3, timeLimit: 9000, smashBall: false, oneOnOne: true },
   fighters: ["mario", "fox"],
   costumes: [0, 1],
+  controls: [0, 0],
   bones: engineFingerprint(),
 };
 
 beforeEach(() => {
```

`src/net/online/lobby.test.ts` — apply:

```diff
--- a/src/net/online/lobby.test.ts
+++ b/src/net/online/lobby.test.ts
@@ -1,6 +1,7 @@
 import { describe, expect, it } from "vitest";
 
+import { CONTROL_STICK_JUMP_OFF } from "@/engine/types";
 import { parseLobbyMessage, type OnlineMatchConfig } from "./lobby";
 
 const CONFIG: OnlineMatchConfig = {
   seed: 1234,
@@ -8,11 +9,35 @@ const CONFIG: OnlineMatchConfig = {
   stageForm: "omega",
   rules: { mode: "stock", stocks: 3, timeLimit: 9000, smashBall: false, oneOnOne: true },
   fighters: ["mario", "fox"],
   costumes: [0, 1],
+  controls: [0, 1],
   bones: "0123abcd",
 };
 
+describe("control options in the lobby (Plan 5)", () => {
+  it("reads a pick's stick jump, and a pick without one", () => {
+    expect(parseLobbyMessage({ kind: "pick", fighterId: "fox", costume: 2, stickJump: false })).toEqual({ kind: "pick", fighterId: "fox", costume: 2, stickJump: false });
+    expect(parseLobbyMessage({ kind: "pick", fighterId: "fox", costume: 2 })).toEqual({ kind: "pick", fighterId: "fox", costume: 2 });
+    expect(parseLobbyMessage({ kind: "pick", fighterId: "fox", costume: 2, stickJump: "no" })).toBeNull();
+  });
+
+  it("refuses a start whose control options are not two known flag sets", () => {
+    expect(parseLobbyMessage({ kind: "start", config: { ...CONFIG, controls: [0] } })).toBeNull();
+    expect(parseLobbyMessage({ kind: "start", config: { ...CONFIG, controls: [0, 7] } })).toBeNull();
+    expect(parseLobbyMessage({ kind: "start", config: { ...CONFIG, controls: [0, 2] } })).toBeNull();
+    expect(parseLobbyMessage({ kind: "start", config: { ...CONFIG, controls: [0, 0.5] } })).toBeNull();
+    expect(parseLobbyMessage({ kind: "start", config: { ...CONFIG, controls: [CONTROL_STICK_JUMP_OFF, 0] } })).not.toBeNull();
+  });
+
+  it("still reads a start from a build before control options, as the defaults — so the version check can refuse it", () => {
+    const { controls: _drop, ...old } = CONFIG;
+    void _drop;
+    const read = parseLobbyMessage({ kind: "start", config: old });
+    expect(read).toEqual({ kind: "start", config: { ...old, controls: [0, 0] } });
+  });
+});
+
 describe("lobby messages", () => {
   it("reads a pick, including clearing one", () => {
     expect(parseLobbyMessage({ kind: "pick", fighterId: "fox", costume: 2 })).toEqual({ kind: "pick", fighterId: "fox", costume: 2 });
     expect(parseLobbyMessage({ kind: "pick", fighterId: null, costume: 0 })).toEqual({ kind: "pick", fighterId: null, costume: 0 });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/components/menu/PlayerOptions.test.tsx src/engine/controls.test.ts src/game/onlineConfig.test.ts src/lib/onlineStore.test.ts src/net/online/lobby.test.ts`
Expected: FAIL — 8 failed — `PlayerOptions.test.tsx`: `Failed to resolve import "./PlayerOptions"`; `controls.test.ts`: `expected true to be false`; `onlineConfig.test.ts`: `expected [ { selection: { …(2) }, …(2) }, …(1) ] to deeply equal [ { selection: { …(3) }, …(2) }, …(1) ]`, `expected undefined to deeply equal [ +0, undefined ]`, `TypeError: useMatchConfig.getState(...).setStickJump is not a function`; `lobby.test.ts`: the pick's stick jump, `expected { kind: 'start', …(1) } to be null` and two start configs.

- [ ] **Step 3: Implement**

`src/app/play/page.tsx`, `src/lib/onlineStore.ts`, `src/net/online/lobby.ts` and `src/game/onlineConfig.ts` are edited as the scratch tree has them; if Plan 1's final text differs, make the same edits by symbol: each human port's `FighterSelection` gets `controls: controlsOf(p)`; the lobby's `pick` carries `stickJump`, and `onlineStore` applies `setStickJump(remote, message.stickJump ?? true)`; `buildStartConfig` ships `controls: [controlsOf(p0), controlsOf(p1)]` and `runnerSlotsFor` hands `selection.controls` to the runner.

**The guest's pick must carry it (Plan 1 Task 20's `CharacterSelect`, by symbol — the scratch tree has no online character select).** In `src/components/menu/CharacterSelect.tsx`'s `assign` callback, replace `sendLobby({ kind: "pick", fighterId, costume: players[activePort]?.costume ?? activePort });` with `sendLobby({ kind: "pick", fighterId, costume: players[activePort]?.costume ?? activePort, stickJump: players[activePort]?.stickJump ?? true });`; in the keydown handler's `case "Backspace":`, replace `sendLobby({ kind: "pick", fighterId: null, costume: activePort });` with `sendLobby({ kind: "pick", fighterId: null, costume: activePort, stickJump: players[activePort]?.stickJump ?? true });`. In `src/components/menu/CharacterSelect.test.tsx`'s "lets a peer fill only its own panel, and tells the other side", replace `expect(sent).toEqual([{ kind: "pick", fighterId: p1.fighterId, costume: 1 }]);` with `expect(sent).toEqual([{ kind: "pick", fighterId: p1.fighterId, costume: 1, stickJump: true }]);`.

`src/app/play/page.tsx` — apply:

```diff
--- a/src/app/play/page.tsx
+++ b/src/app/play/page.tsx
@@ -24,8 +24,9 @@ import { bootstrapEngine, getFighterOrThrow, resolveFighterId, resolveMatchStage
 import { createKeyboardInput, type KeyboardInput } from "@/input/keyboard";
 import { AudioEngine } from "@/audio";
 import { conflictFreeSelection } from "@/input/schemes";
 import {
+  controlsOf,
   useMatchConfig,
   type PlayerResultStat,
   type PlayerSlot,
 } from "@/lib/matchConfig";
@@ -71,8 +72,10 @@ function toRunnerSlots(players: readonly PlayerSlot[], seed: number): RunnerSlot
   return players.map((p) => ({
     selection: {
       defId: resolveFighterId(p.fighterId, seed, p.port),
       costume: p.costume,
+      // Plan 5: the player's stick jump, which the simulation reads.
+      controls: controlsOf(p),
     },
     cpuLevel: p.kind === "cpu" ? p.cpuLevel : null,
     label: p.kind === "cpu" ? `CPU` : `P${p.port + 1}`,
   }));
```

`src/components/menu/ControlsPanel.tsx` — apply:

```diff
--- a/src/components/menu/ControlsPanel.tsx
+++ b/src/components/menu/ControlsPanel.tsx
@@ -5,8 +5,9 @@ import { useRouter } from "next/navigation";
 
 import { ModeTab, ScreenBanner } from "@/components/ui/Panel";
 import { SkewPanel, SkewTag } from "@/components/ui/SkewPanel";
 import { cn } from "@/lib/cn";
+import { PlayerOptions } from "./PlayerOptions";
 import {
   ACTION_LABELS,
   CONTROL_ACTIONS,
   CONTROL_SCHEMES,
@@ -320,8 +321,10 @@ export function ControlsPanel() {
 
           <p className="mt-2 text-xs text-white/45">{SCHEME_INFO[scheme].hand}. {SCHEME_INFO[scheme].note}</p>
         </section>
 
+        <PlayerOptions />
+
         <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_18rem]">
           <Keyboard bindings={active} />
 
           <section aria-label="Bindings">
```

`src/components/menu/PlayerOptions.tsx` (new file):

```tsx
"use client";

import { Toggle } from "@/components/ui/Toggle";
import { portColour, portTag, useMatchConfig } from "@/lib/matchConfig";

/**
 * Per-player control options (Plan 5): Ultimate's "Stick Jump" — whether up on
 * the stick (or the up key) jumps. It changes what the simulation does with
 * the same keys, so it travels with the player's selection into the match,
 * and online to the other peer. CPUs play the default.
 */
export function PlayerOptions() {
  const players = useMatchConfig((s) => s.players);
  const setStickJump = useMatchConfig((s) => s.setStickJump);
  const humans = players.filter((p) => p.kind === "human");

  return (
    <section aria-label="Player options" className="mt-5">
      <h2 className="font-display text-sm tracking-[0.14em] text-white/70 uppercase">Stick jump</h2>
      <ul className="mt-2 flex flex-wrap gap-4">
        {humans.map((p) => (
          <li key={p.port} className="flex items-center gap-3">
            <span className="font-display text-sm" style={{ color: portColour(p.port) }}>
              Player {p.port + 1}
            </span>
            <Toggle label={`${portTag(p.port)} stick jump`} checked={p.stickJump} onChange={(on) => setStickJump(p.port, on)} />
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-white/45">Off: up never jumps, so up specials and up tilts never leave the ground by accident.</p>
    </section>
  );
}
```

`src/engine/combat.ts` — apply:

```diff
--- a/src/engine/combat.ts
+++ b/src/engine/combat.ts
@@ -74,8 +74,10 @@ export interface CombatState {
   /** Plan 5: frames since this fighter last started an attack or special (a footstool waits 16). */
   sinceAttack: number;
   /** Plan 5: the port whose Final Smash has trapped this fighter, or −1. */
   trappedBy: number;
+  /** Plan 5: this player's control options (`CONTROL_*` bits); 0 is the default. */
+  controls: number;
 }
 
 export function emptyCombat(): CombatState {
   return {
@@ -104,8 +106,9 @@ export function emptyCombat(): CombatState {
     wallFrames: 0,
     wallJumps: 0,
     sinceAttack: 999,
     trappedBy: -1,
+    controls: 0,
   };
 }
 
 export function cloneCombat(c: CombatState): CombatState {
@@ -135,6 +138,7 @@ export function cloneCombat(c: CombatState): CombatState {
     wallFrames: c.wallFrames,
     wallJumps: c.wallJumps,
     sinceAttack: c.sinceAttack,
     trappedBy: c.trappedBy,
+    controls: c.controls,
   };
 }
```

`src/engine/hash.ts` — apply:

```diff
--- a/src/engine/hash.ts
+++ b/src/engine/hash.ts
@@ -188,8 +188,9 @@ export function mixCombat(h: number, c: CombatState): number {
   x = mixInt(x, c.wallFrames);
   x = mixInt(x, c.wallJumps);
   x = mixInt(x, c.sinceAttack);
   x = mixInt(x, c.trappedBy);
+  x = mixInt(x, c.controls);
   return x;
 }
 
 /** The KineticModule energies, in declaration order. */
```

`src/engine/simulate.ts` — apply:

```diff
--- a/src/engine/simulate.ts
+++ b/src/engine/simulate.ts
@@ -338,8 +338,10 @@ export function cloneState(state: GameState): GameState {
 
 export interface FighterSelection {
   readonly defId: string;
   readonly costume?: number;
+  /** The player's control options (`CONTROL_*` bits, Plan 5); 0 for the default. */
+  readonly controls?: number;
 }
 
 /** Default seed. Any integer works; the netcode replaces it with an agreed one. */
 export const DEFAULT_SEED = 0x5eed1e55 | 0;
@@ -400,9 +402,9 @@ export function createInitialState(
       framesSinceDirPress: 999,
       lastDirPressed: 0,
       bufferedAction: null,
       kinetic: emptyKinetic(),
-      combat: emptyCombat(),
+      combat: { ...emptyCombat(), controls: sel.controls ?? 0 },
     };
   });
 
   return {
```

`src/engine/states.ts` — apply:

```diff
--- a/src/engine/states.ts
+++ b/src/engine/states.ts
@@ -67,9 +67,9 @@ import {
   kineticSetY,
 } from "./kinetic";
 import { fighterParams } from "./params";
 import { STATUS_TABLE, changeStatus } from "./status/kind";
-import { Btn, held, pressed, released, stickX, stickY } from "./types";
+import { Btn, CONTROL_STICK_JUMP_OFF, held, pressed, released, stickX, stickY } from "./types";
 import type { Footstool, FootstoolHead } from "./footstool";
 import type {
   ActionState,
   BufferedAction,
@@ -245,9 +245,12 @@ export function interpretInput(f: FighterState, input: InputFrame, prev: InputFr
   // simply never gets asked for; and `framesSinceDirPress` is reset by *any*
   // fresh direction, so it can only equal the window on the press that started
   // it. Both facts mean one press can produce at most one jump, and holding up
   // does not pogo.
+  // Plan 5: with stick jump off, up is only up.
+  const stickJump = (f.combat.controls & CONTROL_STICK_JUMP_OFF) === 0;
   const tapJump =
+    stickJump &&
     f.lastDirPressed === Btn.Up &&
     f.framesSinceDirPress === TAP_JUMP_FRAMES &&
     held(input, Btn.Up);
 
@@ -256,9 +259,9 @@ export function interpretInput(f: FighterState, input: InputFrame, prev: InputFr
     y,
     jumpPressed: pressed(input, prev, Btn.Jump) || tapJump,
     // Holding up holds the jump, so up gives a full hop and a flick gives a
     // short one — the same distinction the stick makes.
-    jumpHeld: held(input, Btn.Jump) || held(input, Btn.Up),
+    jumpHeld: held(input, Btn.Jump) || (stickJump && held(input, Btn.Up)),
     attackPressed: pressed(input, prev, Btn.Attack),
     attackHeld: held(input, Btn.Attack),
     specialPressed: pressed(input, prev, Btn.Special),
     specialHeld: held(input, Btn.Special),
```

`src/engine/types.ts` — apply:

```diff
--- a/src/engine/types.ts
+++ b/src/engine/types.ts
@@ -41,8 +41,18 @@ export const enum Btn {
 
 /** A packed input frame. Zero means "no keys held". */
 export type InputFrame = number;
 
+/**
+ * A player's control options the simulation must agree on (Plan 5), as bits
+ * on `CombatState.controls`. Zero is Ultimate's default. SmashWiki "Stick
+ * jump": "The Tap Jump option is known as "Stick Jump" in Super Smash Bros.
+ * Ultimate." Off, up on the stick neither jumps nor holds a jump.
+ */
+export const CONTROL_STICK_JUMP_OFF = 1;
+/** Every control option bit there is; anything else in a `controls` value is not a control option. */
+export const CONTROL_BITS = CONTROL_STICK_JUMP_OFF;
+
 export function held(input: InputFrame, b: Btn): boolean {
   return (input & b) !== 0;
 }
 
```

`src/game/onlineConfig.ts` — apply:

```diff
--- a/src/game/onlineConfig.ts
+++ b/src/game/onlineConfig.ts
@@ -7,9 +7,9 @@
  * ignores the seed, so both peers land on the same `StageDef`.
  */
 
 import type { MatchRules } from "@/engine/types";
-import { RANDOM_FIGHTER, type PlayerSlot, type StageForm } from "@/lib/matchConfig";
+import { RANDOM_FIGHTER, controlsOf, type PlayerSlot, type StageForm } from "@/lib/matchConfig";
 import type { OnlineMatchConfig } from "@/net/online/lobby";
 import { FIGHTERS, resolveFighterId, resolveMatchStage } from "./bootstrap";
 import type { PlayerSlot as RunnerSlot } from "./matchRunner";
 import { engineFingerprint } from "./simContext";
@@ -33,8 +33,9 @@ export function buildStartConfig(input: StartConfigInput): OnlineMatchConfig {
     stageForm: input.stageForm,
     rules: { ...input.rules, oneOnOne: true },
     fighters: [resolveFighterId(known(p0.fighterId), seed, 0), resolveFighterId(known(p1.fighterId), seed, 1)],
     costumes: [p0.costume, p1.costume],
+    controls: [controlsOf(p0), controlsOf(p1)],
     bones: engineFingerprint(),
   };
 }
 
@@ -54,9 +55,9 @@ export function newMatchSeed(random: () => number = Math.random): number {
 }
 
 export function runnerSlotsFor(config: OnlineMatchConfig): RunnerSlot[] {
   return config.fighters.map((defId, port) => ({
-    selection: { defId, costume: config.costumes[port] },
+    selection: { defId, costume: config.costumes[port], controls: config.controls[port] },
     cpuLevel: null,
     label: `P${port + 1}`,
   }));
 }
```

`src/lib/matchConfig.ts` — apply:

```diff
--- a/src/lib/matchConfig.ts
+++ b/src/lib/matchConfig.ts
@@ -1,8 +1,9 @@
 import { useEffect, useState } from "react";
 import { create } from "zustand";
 
 import { fx } from "@/engine/fixed";
+import { CONTROL_STICK_JUMP_OFF } from "@/engine/types";
 import type {
   FighterDef,
   FighterPalette,
   MatchOutcome,
@@ -622,8 +623,15 @@ export interface PlayerSlot {
   fighterId: string | null;
   costume: number;
   /** Which control preset a human port is using. Ignored for CPUs. */
   scheme: SchemeId;
+  /** Plan 5: Ultimate's "Stick Jump" (tap jump) — up on the stick jumps. On by default. */
+  stickJump: boolean;
+}
+
+/** A slot's control options as the simulation's `CONTROL_*` bits (Plan 5). A CPU plays the default. */
+export function controlsOf(slot: Pick<PlayerSlot, "kind" | "stickJump">): number {
+  return slot.kind === "human" && !slot.stickJump ? CONTROL_STICK_JUMP_OFF : 0;
 }
 
 export const MIN_PLAYERS = 2;
 export const MAX_PLAYERS = 4;
@@ -706,8 +714,10 @@ interface MatchConfigState {
   stepCpuLevel(port: number, delta: number): void;
   setFighter(port: number, fighterId: string | null): void;
   setCostume(port: number, costume: number): void;
   setScheme(port: number, scheme: SchemeId): boolean;
+  /** Plan 5: turn a port's stick jump on or off. */
+  setStickJump(port: number, on: boolean): void;
   /** Two humans, one per machine, each on their own keyboard's Config 1. */
   configureOnline(): void;
   /** Back to the offline default: one human and a CPU. */
   leaveOnline(): void;
@@ -728,17 +738,23 @@ function makePlayer(port: number): PlayerSlot {
     cpuLevel: 3,
     fighterId: null,
     costume: port,
     scheme: CONTROL_SCHEMES[Math.min(port, CONTROL_SCHEMES.length - 1)],
+    stickJump: true,
   };
 }
 
 function initialPlayers(): PlayerSlot[] {
   return [makePlayer(0), makePlayer(1)];
 }
 
-function onlinePlayer(port: number): PlayerSlot {
-  return { port, kind: "human", cpuLevel: 3, fighterId: null, costume: port, scheme: "arrows" };
+/**
+ * An online port. Both start with this machine's player's control options —
+ * the local port keeps them, and the remote one is overwritten by the other
+ * peer's pick (`onlineStore`).
+ */
+function onlinePlayer(port: number, local: Pick<PlayerSlot, "stickJump">): PlayerSlot {
+  return { port, kind: "human", cpuLevel: 3, fighterId: null, costume: port, scheme: "arrows", stickJump: local.stickJump };
 }
 
 /**
  * Ultimate's 1v1 damage bonus is a property of the match, not a setting: it
@@ -850,11 +866,15 @@ export const useMatchConfig = create<MatchConfigState>()((set, get) => ({
       players: s.players.map((p) => (p.port === port ? { ...p, scheme } : p)),
     }));
     return true;
   },
+  setStickJump: (port, on) =>
+    set((s) => ({ players: s.players.map((p) => (p.port === port ? { ...p, stickJump: on } : p)) })),
+
   configureOnline: () =>
     set((s) => {
-      const players = [onlinePlayer(0), onlinePlayer(1)];
+      const local = s.players.find((p) => p.kind === "human") ?? s.players[0];
+      const players = [onlinePlayer(0, local), onlinePlayer(1, local)];
       return { players, rules: withDerivedRules(s.rules, players), result: null };
     }),
 
   // `result` is kept: the results screen calls this on its way out, and
```

`src/lib/onlineStore.ts` — apply:

```diff
--- a/src/lib/onlineStore.ts
+++ b/src/lib/onlineStore.ts
@@ -124,8 +124,9 @@ function applyLobby(message: LobbyMessage, session: OnlineSessionLike): void {
       if (local === null) return;
       const remote = local === 0 ? 1 : 0;
       match.setFighter(remote, message.fighterId);
       match.setCostume(remote, message.costume);
+      match.setStickJump(remote, message.stickJump ?? true);
       return;
     }
     case "stage":
       match.setStage(message.stageId);
```

`src/net/online/lobby.ts` — apply:

```diff
--- a/src/net/online/lobby.ts
+++ b/src/net/online/lobby.ts
@@ -9,9 +9,9 @@
  * Validated hard, because a `start` that names a fighter this build does not
  * have would throw inside `createInitialState` on the other machine.
  */
 
-import type { MatchRules } from "@/engine/types";
+import { CONTROL_BITS, type MatchRules } from "@/engine/types";
 import { MAX_STOCKS, MIN_STOCKS, STAGE_FORMS, type StageForm } from "@/lib/matchConfig";
 
 export interface OnlineMatchConfig {
   readonly seed: number;
@@ -21,8 +21,10 @@ export interface OnlineMatchConfig {
   readonly rules: MatchRules;
   /** Concrete fighter ids for ports 0 and 1. */
   readonly fighters: readonly [string, string];
   readonly costumes: readonly [number, number];
+  /** Each port's control options (`CONTROL_*` bits, Plan 5): the sim reads them on both peers. */
+  readonly controls: readonly [number, number];
   /**
    * The host's engine fingerprint (`engineFingerprint`: the bone table, Plan 2
    * Task 27, and the rules version and running scripts, Plan 3 Task 20).
    * The guest refuses a start whose fingerprint is not its own.
@@ -30,9 +32,9 @@ export interface OnlineMatchConfig {
   readonly bones: string;
 }
 
 export type LobbyMessage =
-  | { readonly kind: "pick"; readonly fighterId: string | null; readonly costume: number }
+  | { readonly kind: "pick"; readonly fighterId: string | null; readonly costume: number; readonly stickJump?: boolean }
   | { readonly kind: "stage"; readonly stageId: string; readonly form: StageForm }
   | { readonly kind: "start"; readonly config: OnlineMatchConfig }
   | { readonly kind: "away"; readonly away: boolean }
   /** The guest cannot play the host's start (Plan 2 Task 27): different bone tables. */
@@ -49,9 +51,12 @@ export function parseLobbyMessage(payload: unknown): LobbyMessage | null {
       const raw = payload.fighterId;
       const fighterId = raw === null ? null : isId(raw) ? raw : undefined;
       const costume = payload.costume;
       if (fighterId === undefined || !isCostume(costume)) return null;
-      return { kind: "pick", fighterId, costume };
+      // Plan 5: the guest's stick jump rides on its pick; absent is the default.
+      const stickJump = payload.stickJump;
+      if (stickJump !== undefined && typeof stickJump !== "boolean") return null;
+      return stickJump === undefined ? { kind: "pick", fighterId, costume } : { kind: "pick", fighterId, costume, stickJump };
     }
     case "stage": {
       const stageId = payload.stageId;
       const form = payload.form;
@@ -73,9 +78,9 @@ export function parseLobbyMessage(payload: unknown): LobbyMessage | null {
 }
 
 function parseConfig(value: unknown): OnlineMatchConfig | null {
   if (!isRecord(value)) return null;
-  const { seed, stageId, stageForm, rules, fighters, costumes, bones } = value;
+  const { seed, stageId, stageForm, rules, fighters, costumes, controls, bones } = value;
   if (typeof bones !== "string" || !FINGERPRINT.test(bones)) return null;
   if (typeof seed !== "number" || !Number.isInteger(seed)) return null;
   if (!isId(stageId) || !isStageForm(stageForm)) return null;
   const parsedRules = parseRules(rules);
@@ -85,9 +90,16 @@ function parseConfig(value: unknown): OnlineMatchConfig | null {
   if (!isId(f0) || !isId(f1)) return null;
   if (!Array.isArray(costumes) || costumes.length !== 2) return null;
   const [c0, c1] = costumes as unknown[];
   if (!isCostume(c0) || !isCostume(c1)) return null;
-  return { seed, stageId, stageForm, rules: parsedRules, fighters: [f0, f1], costumes: [c0, c1], bones };
+  // A start with no `controls` comes from a build before Plan 5: read it as
+  // the defaults, so it arrives and the fingerprint check refuses it by name
+  // (its rules version differs) rather than the guest waiting for nothing.
+  const pair = controls === undefined ? [0, 0] : controls;
+  if (!Array.isArray(pair) || pair.length !== 2) return null;
+  const [k0, k1] = pair as unknown[];
+  if (!isControls(k0) || !isControls(k1)) return null;
+  return { seed, stageId, stageForm, rules: parsedRules, fighters: [f0, f1], costumes: [c0, c1], controls: [k0, k1], bones };
 }
 
 function parseRules(value: unknown): MatchRules | null {
   if (!isRecord(value)) return null;
@@ -102,8 +114,13 @@ function parseRules(value: unknown): MatchRules | null {
 function isId(value: unknown): value is string {
   return typeof value === "string" && ID.test(value);
 }
 
+/** A set of control option bits (Plan 5, `CONTROL_BITS`), and nothing else. */
+function isControls(value: unknown): value is number {
+  return typeof value === "number" && Number.isInteger(value) && value >= 0 && (value & ~CONTROL_BITS) === 0;
+}
+
 function isCostume(value: unknown): value is number {
   return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MAX_COSTUME;
 }
 
```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/components/menu/PlayerOptions.test.tsx src/engine/controls.test.ts src/game/onlineConfig.test.ts src/lib/onlineStore.test.ts src/net/online/lobby.test.ts`
Expected: PASS (`src/components/menu/PlayerOptions.test.tsx` 2 tests, `src/engine/controls.test.ts` 3 tests).

- [ ] **Step 5: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0; golden trace untouched.

- [ ] **Step 6: Commit**

```bash
git add super-smash/src/app/play/page.tsx super-smash/src/components/menu/ControlsPanel.tsx super-smash/src/components/menu/PlayerOptions.test.tsx super-smash/src/components/menu/PlayerOptions.tsx super-smash/src/engine/combat.ts super-smash/src/engine/controls.test.ts super-smash/src/engine/hash.ts super-smash/src/engine/simulate.ts super-smash/src/engine/states.ts super-smash/src/engine/types.ts super-smash/src/game/onlineConfig.test.ts super-smash/src/game/onlineConfig.ts super-smash/src/lib/matchConfig.ts super-smash/src/lib/onlineStore.test.ts super-smash/src/lib/onlineStore.ts super-smash/src/net/online/lobby.test.ts super-smash/src/net/online/lobby.ts
git commit -m "super-smash: Stick Jump option, in the sim and online" -m "CombatState.controls holds per-player control options that change what step() does; Stick Jump off makes up only aim. It travels in the online start config and lobby picks (both pick sends), is checked against the known bits, starts online from this machine's choice, and is set on /controls. A start from a pre-Plan-5 host is refused by fingerprint, not dropped. Golden trace unchanged (CPUs play the default)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 21: Gamepad remap and the right stick on /controls

Ultimate lets each player rebind the pad's buttons and set the right stick to Smash Attack (its default), Tilt Attack, Special, Jump or Off; the replica offers the five action buttons and Smash Attack / Special / Off. A rebind is a swap where it would otherwise leave an action with no button (so jump and attack are never unbound), and a d-pad button bound to an action stops being its direction. `PadSettings` live on the player's slot, carried into an online match for this machine's player (what crosses the wire is only the packed frame), and — with Stick Jump — kept per port in the browser's storage by `ControlPrefsSync` (`lib/controlPrefs.ts`: every access guarded, everything read back schema-checked, defaults on any failure; loaded after hydration so the server and first client render agree). `GamepadInput` takes a mapping per port (`mappingForPort`). A right-stick flick lets go of the left stick's direction for one frame and presses its own direction with attack (or special) on the next, so the sim sees a fresh press — the smash input `SMASH_INPUT_WINDOW` reads (UNVERIFIED-simplified: one frame later than the real game). The capture on `/controls` polls only that port's own pad (`navigator.getGamepads()`; the API has no button events) and ignores a button already held when it starts.

**Files:**
- Create: `super-smash/src/components/ControlPrefsSync.test.tsx`, `super-smash/src/components/ControlPrefsSync.tsx`, `super-smash/src/components/menu/PadOptions.test.tsx`, `super-smash/src/components/menu/PadOptions.tsx`, `super-smash/src/input/padRemap.test.ts`, `super-smash/src/lib/controlPrefs.test.ts`, `super-smash/src/lib/controlPrefs.ts`
- Modify: `super-smash/src/app/layout.tsx`, `super-smash/src/components/menu/ControlsPanel.tsx`, `super-smash/src/game/onlineConfig.test.ts`, `super-smash/src/input/gamepad.ts`, `super-smash/src/lib/matchConfig.ts`

**Interfaces:**
- Consumes: Plan 1 Task 16's `src/input/gamepad.ts` (`DIRECTION_MASK`, `Btn.Soft` from the stick, `mergeKeyboardAndPad`, `padPortMap`) and Plan 1 Task 21's `createGamepadInput` calls on `/play`.
- Produces: `PadAction`, `PAD_ACTIONS`, `RightStickMode`, `RIGHT_STICK_MODES`, `PadSettings`, `DEFAULT_PAD_SETTINGS`, `rebind`, `mappingFrom`, `isPadSettings`, `padButtonName`; `GamepadMapping.rightStick?/rightStickX?/rightStickY?`; `GamepadOptions.mappingForPort?` (`src/input/gamepad.ts`); `PlayerSlot.pad`, `padMappingOf(slot)`, `setPad(port, pad)`, `applyControlPrefs(prefs)` (`lib/matchConfig.ts`); `src/lib/controlPrefs.ts`: `CONTROL_PREFS_KEY`, `PortPrefs`, `browserStorage`, `readControlPrefs`, `writeControlPrefs`; `src/components/ControlPrefsSync.tsx`; `src/components/menu/PadOptions.tsx`.

- [ ] **Step 1: Write the failing tests**

`src/components/ControlPrefsSync.test.tsx` (new file):

```tsx
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_PAD_SETTINGS, rebind } from "@/input/gamepad";
import { CONTROL_PREFS_KEY } from "@/lib/controlPrefs";
import { useMatchConfig } from "@/lib/matchConfig";
import { ControlPrefsSync } from "./ControlPrefsSync";

/** This test environment's window has no `localStorage`; give it one held in a map. */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k: string) => data.get(k) ?? null,
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (k: string) => void data.delete(k),
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

let localStorage: Storage;
beforeEach(() => {
  localStorage = memoryStorage();
  Object.defineProperty(window, "localStorage", { configurable: true, value: localStorage });
  useMatchConfig.getState().reset();
});
afterEach(() => {
  Reflect.deleteProperty(window, "localStorage");
});

describe("ControlPrefsSync (Plan 5)", () => {
  it("brings back a saved Stick Jump and pad, and saves a change", () => {
    const pad = rebind(DEFAULT_PAD_SETTINGS, "attack", 3);
    localStorage.setItem(CONTROL_PREFS_KEY, JSON.stringify({ 0: { stickJump: false, pad } }));
    render(<ControlPrefsSync />);
    expect(useMatchConfig.getState().players[0].stickJump).toBe(false);
    expect(useMatchConfig.getState().players[0].pad).toEqual(pad);
    act(() => useMatchConfig.getState().setStickJump(0, true));
    expect(JSON.parse(localStorage.getItem(CONTROL_PREFS_KEY)!)[0].stickJump).toBe(true);
  });

  it("carries this machine's pad and Stick Jump into an online match", () => {
    const pad = rebind(DEFAULT_PAD_SETTINGS, "jump", 0);
    useMatchConfig.getState().setPad(0, pad);
    useMatchConfig.getState().setStickJump(0, false);
    useMatchConfig.getState().configureOnline();
    const [p0, p1] = useMatchConfig.getState().players;
    expect([p0.pad, p0.stickJump]).toEqual([pad, false]);
    expect([p1.pad, p1.stickJump]).toEqual([pad, false]);
  });

  it("starts from the defaults when nothing valid is saved", () => {
    localStorage.setItem(CONTROL_PREFS_KEY, "garbage");
    render(<ControlPrefsSync />);
    expect(useMatchConfig.getState().players[0].pad).toEqual(DEFAULT_PAD_SETTINGS);
    expect(useMatchConfig.getState().players[0].stickJump).toBe(true);
  });
});
```

`src/components/menu/PadOptions.test.tsx` (new file):

```tsx
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_PAD_SETTINGS } from "@/input/gamepad";
import { useMatchConfig } from "@/lib/matchConfig";
import { PadOptions } from "./PadOptions";

/** Pads the test presses buttons on, behind `navigator.getGamepads`. */
let pressed = new Set<number>();
let pressedOnSecond = new Set<number>();
function fakePad(index = 0): Gamepad {
  const down = index === 0 ? pressed : pressedOnSecond;
  return {
    index,
    connected: true,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: down.has(i), touched: false, value: down.has(i) ? 1 : 0 })),
  } as unknown as Gamepad;
}

beforeEach(() => {
  useMatchConfig.getState().reset();
  pressed = new Set();
  pressedOnSecond = new Set();
  vi.useFakeTimers();
  Object.defineProperty(navigator, "getGamepads", { configurable: true, value: () => [fakePad(0), fakePad(1)] });
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(navigator, "getGamepads");
});

/** Let the capture loop poll a few times. */
function poll(): void {
  act(() => {
    vi.advanceTimersByTime(100);
  });
}

describe("PadOptions (Plan 5)", () => {
  it("rebinds P1's attack to the next button pressed", () => {
    render(<PadOptions />);
    expect(screen.getByRole("button", { name: "P1 attack: A" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "P1 attack: A" }));
    expect(screen.getByText("Press a button on your gamepad…")).toBeInTheDocument();
    pressed = new Set([3]);
    poll();
    expect(useMatchConfig.getState().players[0].pad.buttons.attack).toEqual([3]);
    // Y left jump, so jump is X alone.
    expect(useMatchConfig.getState().players[0].pad.buttons.jump).toEqual([2]);
    expect(screen.getByRole("button", { name: "P1 attack: Y" })).toBeInTheDocument();
  });

  it("ignores a button already held when the capture starts", () => {
    pressed = new Set([5]);
    render(<PadOptions />);
    fireEvent.click(screen.getByRole("button", { name: "P1 special: B" }));
    poll();
    expect(useMatchConfig.getState().players[0].pad.buttons.special).toEqual([1]);
    pressed = new Set([5, 2]);
    poll();
    expect(useMatchConfig.getState().players[0].pad.buttons.special).toEqual([2]);
  });

  it("listens only to the port's own pad: player 2 pressing a button does not rebind player 1", () => {
    useMatchConfig.getState().setPlayerKind(1, "human");
    render(<PadOptions />);
    fireEvent.click(screen.getByRole("button", { name: "P1 attack: A" }));
    pressedOnSecond = new Set([3]);
    poll();
    expect(useMatchConfig.getState().players[0].pad.buttons.attack).toEqual([0]);
    pressed = new Set([2]);
    poll();
    expect(useMatchConfig.getState().players[0].pad.buttons.attack).toEqual([2]);
  });

  it("sets the right stick, and resets to the defaults", () => {
    render(<PadOptions />);
    fireEvent.change(screen.getByRole("combobox", { name: "P1 right stick" }), { target: { value: "special" } });
    expect(useMatchConfig.getState().players[0].pad.rightStick).toBe("special");
    fireEvent.click(screen.getByRole("button", { name: "P1 reset gamepad" }));
    expect(useMatchConfig.getState().players[0].pad).toEqual(DEFAULT_PAD_SETTINGS);
  });

  it("says so when the browser has no gamepad API", () => {
    Reflect.deleteProperty(navigator, "getGamepads");
    render(<PadOptions />);
    expect(screen.getByText(/no gamepad support/i)).toBeInTheDocument();
  });
});
```

`src/game/onlineConfig.test.ts` — apply:

```diff
--- a/src/game/onlineConfig.test.ts
+++ b/src/game/onlineConfig.test.ts
@@ -1,8 +1,9 @@
 import { beforeAll, describe, expect, it } from "vitest";
 
 import { ENGINE_RULES_VERSION } from "@/engine/constants";
 import { CONTROL_STICK_JUMP_OFF, type MatchRules } from "@/engine/types";
+import { DEFAULT_PAD_SETTINGS } from "@/input/gamepad";
 import { RANDOM_FIGHTER, RANDOM_STAGE, useMatchConfig, type PlayerSlot } from "@/lib/matchConfig";
 import { parseLobbyMessage } from "@/net/online/lobby";
 import { FIGHTERS, STAGES, bootstrapEngine, resolveMatchStage } from "./bootstrap";
 import { buildStartConfig, newMatchSeed, runnerSlotsFor, startConfigProblem } from "./onlineConfig";
@@ -11,10 +12,10 @@ import { GAME_ENGINE_RULES, GAME_SIM_CONTEXT, engineFingerprint } from "./simCon
 const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 9000, smashBall: true, oneOnOne: false };
 
 function players(a: string | null, b: string | null): PlayerSlot[] {
   return [
-    { port: 0, kind: "human", cpuLevel: 3, fighterId: a, costume: 0, scheme: "arrows", stickJump: true },
-    { port: 1, kind: "human", cpuLevel: 3, fighterId: b, costume: 1, scheme: "arrows", stickJump: false },
+    { port: 0, kind: "human", cpuLevel: 3, fighterId: a, costume: 0, scheme: "arrows", stickJump: true, pad: DEFAULT_PAD_SETTINGS },
+    { port: 1, kind: "human", cpuLevel: 3, fighterId: b, costume: 1, scheme: "arrows", stickJump: false, pad: DEFAULT_PAD_SETTINGS },
   ];
 }
 
 beforeAll(() => {
```

`src/input/padRemap.test.ts` (new file):

```ts
/**
 * Gamepad remapping and the right stick (Plan 5, Task 21). Ultimate lets each
 * player rebind the pad's buttons and set the right stick to Smash Attack
 * (its default), Special or Off.
 */

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { Btn } from "@/engine/types";
import type { GameState, InputFrame, MatchRules } from "@/engine/types";
import { FIGHTERS } from "@/fighters";
import { STAGES } from "@/stages";
import {
  DEFAULT_PAD_SETTINGS,
  GamepadInput,
  STANDARD_MAPPING,
  isPadSettings,
  mappingFrom,
  padButtonName,
  rebind,
  type GamepadMapping,
  type PadSettings,
} from "./gamepad";

function pad(over: { buttons?: number[]; axes?: number[]; index?: number } = {}): Gamepad {
  const pressed = new Set(over.buttons ?? []);
  return {
    id: "fake",
    index: over.index ?? 0,
    connected: true,
    mapping: "standard",
    timestamp: 0,
    axes: over.axes ?? [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.has(i), touched: pressed.has(i), value: pressed.has(i) ? 1 : 0 })),
    vibrationActuator: null,
  } as unknown as Gamepad;
}

/** A pad whose state the test changes between polls. */
function livePad(): { nav: Navigator; set(next: Gamepad): void } {
  let current: Gamepad = pad();
  return { nav: { getGamepads: () => [current] } as unknown as Navigator, set: (next) => (current = next) };
}

let live: GamepadInput | null = null;
afterEach(() => {
  live?.detach();
  live = null;
});

function input(nav: Navigator, mapping: GamepadMapping): GamepadInput {
  live = new GamepadInput({ navigator: nav, mappingForPort: () => mapping });
  return live;
}

describe("rebinding a button", () => {
  it("gives the action that button alone, and takes it off whatever had it", () => {
    // Y (3) jumps by default; bind it to attack.
    const next = rebind(DEFAULT_PAD_SETTINGS, "attack", 3);
    expect(next.buttons.attack).toEqual([3]);
    expect(next.buttons.jump).toEqual([2]);
    expect(next.buttons.special).toEqual(STANDARD_MAPPING.special);
    expect(DEFAULT_PAD_SETTINGS.buttons.attack).toEqual([0]);
  });

  it("is what the pad reads, port by port", () => {
    const { nav, set } = livePad();
    const pads = input(nav, mappingFrom(rebind(DEFAULT_PAD_SETTINGS, "attack", 3)));
    set(pad({ buttons: [3] }));
    expect(pads.poll(1).frames[0]).toBe(Btn.Attack);
    set(pad({ buttons: [0] }));
    // A is unbound now: it does nothing.
    expect(pads.poll(1).frames[0]).toBe(0);
  });

  it("swaps rather than leave an action unbound: B on attack puts A on special", () => {
    const next = rebind(DEFAULT_PAD_SETTINGS, "attack", 1);
    expect(next.buttons.attack).toEqual([1]);
    expect(next.buttons.special).toEqual([0]);
    // Both jump buttons to shield: jump keeps one of shield's.
    const both = rebind(rebind(DEFAULT_PAD_SETTINGS, "shield", 2), "shield", 3);
    expect(both.buttons.shield).toEqual([3]);
    expect(both.buttons.jump.length).toBeGreaterThan(0);
    for (const a of ["attack", "special", "jump", "shield", "grab"] as const) expect(both.buttons[a].length).toBeGreaterThan(0);
  });

  it("takes a d-pad button off its direction once it is bound to an action", () => {
    const { nav, set } = livePad();
    const pads = input(nav, mappingFrom(rebind(DEFAULT_PAD_SETTINGS, "jump", 12)));
    set(pad({ buttons: [12] }));
    expect(pads.poll(1).frames[0]).toBe(Btn.Jump);
    // The other directions still move.
    set(pad({ buttons: [13] }));
    expect(pads.poll(1).frames[0]).toBe(Btn.Down);
  });

  it("checks settings read back from storage", () => {
    expect(isPadSettings(DEFAULT_PAD_SETTINGS)).toBe(true);
    expect(isPadSettings({ ...DEFAULT_PAD_SETTINGS, rightStick: "tilt" })).toBe(false);
    expect(isPadSettings({ ...DEFAULT_PAD_SETTINGS, buttons: { ...DEFAULT_PAD_SETTINGS.buttons, jump: [] } })).toBe(false);
    expect(isPadSettings({ ...DEFAULT_PAD_SETTINGS, buttons: { ...DEFAULT_PAD_SETTINGS.buttons, attack: ["0"] } })).toBe(false);
    expect(isPadSettings(null)).toBe(false);
  });

  it("names the standard buttons", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(padButtonName)).toEqual(["A", "B", "X", "Y", "LB", "RB", "LT", "RT"]);
    expect(padButtonName(20)).toBe("Button 20");
  });
});

describe("the right stick", () => {
  const RIGHT = [0, 0, 1, 0];
  const UP = [0, 0, 0, -1];

  function flick(settings: PadSettings, axes: number[], left: number[] = [0, 0]): InputFrame[] {
    const { nav, set } = livePad();
    const pads = input(nav, mappingFrom(settings));
    const frames: InputFrame[] = [];
    for (let i = 0; i < 4; i++) {
      set(pad({ axes: [left[0], left[1], axes[2], axes[3]] }));
      frames.push(pads.poll(1).frames[0]);
    }
    return frames;
  }

  it("smash (the default): a flick lets go of the left stick for a frame, then is that direction and attack", () => {
    expect(flick(DEFAULT_PAD_SETTINGS, RIGHT)).toEqual([0, Btn.Right | Btn.Attack, 0, 0]);
  });

  it("does it over a held left stick, so the direction is a fresh press", () => {
    expect(flick(DEFAULT_PAD_SETTINGS, RIGHT, [-1, 0])).toEqual([0, Btn.Right | Btn.Attack, Btn.Left, Btn.Left]);
  });

  it("special: the same with the special button", () => {
    expect(flick({ ...DEFAULT_PAD_SETTINGS, rightStick: "special" }, UP)).toEqual([0, Btn.Up | Btn.Special, 0, 0]);
  });

  it("off: nothing", () => {
    expect(flick({ ...DEFAULT_PAD_SETTINGS, rightStick: "off" }, RIGHT)).toEqual([0, 0, 0, 0]);
  });
});

describe("what the fighter does with a right-stick flick", () => {
  const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: false };

  beforeAll(() => {
    registerFighters(FIGHTERS);
    registerStages(STAGES);
  });

  function standing(): GameState {
    const s = createInitialState("finalDestination", [{ defId: "mario" }], RULES, 2);
    Object.assign(s.fighters[0], { action: "stand", grounded: true, platform: 0, x: 0, y: 0, facing: 1, intangible: 0 });
    return s;
  }

  function moveAfter(frames: readonly InputFrame[]): string | null {
    let s = standing();
    let prev: InputFrame = 0;
    for (const i of frames) {
      s = step(s, [i], { prevInputs: [prev] }).state;
      prev = i;
    }
    return s.fighters[0].move;
  }

  it("is a forward smash on the ground", () => {
    expect(moveAfter([0, Btn.Right | Btn.Attack, 0])).toBe("fsmash");
  });

  it("is an up smash, not a jump, with Stick Jump on", () => {
    expect(moveAfter([0, Btn.Up | Btn.Attack, 0])).toBe("usmash");
  });
});
```

`src/lib/controlPrefs.test.ts` (new file):

```ts
import { describe, expect, it } from "vitest";

import { DEFAULT_PAD_SETTINGS, rebind } from "@/input/gamepad";
import { CONTROL_PREFS_KEY, readControlPrefs, writeControlPrefs } from "./controlPrefs";

/** A `Storage` held in a map. */
function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k: string) => data.get(k) ?? null,
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (k: string) => void data.delete(k),
    setItem: (k: string, v: string) => void data.set(k, v),
  };
}

/** A `Storage` whose every access throws, as a blocked or private one may. */
const THROWING = new Proxy({} as Storage, {
  get() {
    throw new Error("SecurityError: storage is blocked");
  },
});

describe("saved control options (Plan 5)", () => {
  it("round-trips each port's Stick Jump and pad settings", () => {
    const storage = memoryStorage();
    const prefs = { 0: { stickJump: false, pad: rebind(DEFAULT_PAD_SETTINGS, "attack", 3) }, 1: { stickJump: true, pad: { ...DEFAULT_PAD_SETTINGS, rightStick: "special" as const } } };
    writeControlPrefs(prefs, storage);
    expect(readControlPrefs(storage)).toEqual(prefs);
  });

  it("reads nothing from corrupt JSON", () => {
    const storage = memoryStorage();
    storage.setItem(CONTROL_PREFS_KEY, "{not json");
    expect(readControlPrefs(storage)).toEqual({});
    storage.setItem(CONTROL_PREFS_KEY, "[1,2]");
    expect(readControlPrefs(storage)).toEqual({});
  });

  it("keeps the valid ports and drops a port whose saved shape is wrong", () => {
    const storage = memoryStorage();
    storage.setItem(CONTROL_PREFS_KEY, JSON.stringify({ 0: { stickJump: false, pad: DEFAULT_PAD_SETTINGS }, 1: { stickJump: "no", pad: DEFAULT_PAD_SETTINGS }, 2: { stickJump: true, pad: { buttons: {}, rightStick: "smash" } } }));
    expect(readControlPrefs(storage)).toEqual({ 0: { stickJump: false, pad: DEFAULT_PAD_SETTINGS } });
  });

  it("survives a storage that throws, reading the defaults and saving nothing", () => {
    expect(readControlPrefs(THROWING)).toEqual({});
    expect(() => writeControlPrefs({ 0: { stickJump: false, pad: DEFAULT_PAD_SETTINGS } }, THROWING)).not.toThrow();
    expect(readControlPrefs(null)).toEqual({});
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/components/ControlPrefsSync.test.tsx src/components/menu/PadOptions.test.tsx src/game/onlineConfig.test.ts src/input/padRemap.test.ts src/lib/controlPrefs.test.ts`
Expected: FAIL — 10 failed; `PadOptions.test.tsx`, `ControlPrefsSync.test.tsx` and `controlPrefs.test.ts` cannot load (`Failed to resolve import "./PadOptions"`, `"./ControlPrefsSync"`, `"./controlPrefs"`); `padRemap.test.ts`: `TypeError: rebind is not a function`, `mappingFrom is not a function`, `isPadSettings is not a function`, `undefined is not a function` (`padButtonName`). Its two engine tests (a flick is a forward smash; an up flick is an up smash, not a jump, with Stick Jump on) already pass: attack beats tap jump on the same frame.

- [ ] **Step 3: Implement**

**Wire it into `/play` (Plan 1 Tasks 17 and 21, by symbol).** Plan 1's play page creates the pad reader; pass each port's mapping. Local: `createGamepadInput({ portForPad: padPortMap(humans.map((p) => p.port)), mappingForPort: (port) => padMappingOf(players.find((p) => p.port === port) ?? players[0]) })`. Online: `createGamepadInput({ portForPad: () => localPort, mappingForPort: () => padMappingOf(players[localPort]) })`. Add `padMappingOf` to the page's import from `"@/lib/matchConfig"`. The scratch tree predates Plan 1's wiring, so a stand-in commit after this task copied Plan 1 Task 17's `gatherInputs` (`mergeKeyboardAndPad`) and Task 21's local `createGamepadInput` with exactly this edit; Task 22's e2e ran against it. The online call was not run.

`src/app/layout.tsx` — apply:

```diff
--- a/src/app/layout.tsx
+++ b/src/app/layout.tsx
@@ -1,7 +1,9 @@
 import type { Metadata, Viewport } from "next";
 import { Anton, M_PLUS_Rounded_1c } from "next/font/google";
 
+import { ControlPrefsSync } from "@/components/ControlPrefsSync";
+
 import "./globals.css";
 
 /**
  * Ultimate's own faces are proprietary and there is no legitimate way to ship
@@ -76,8 +78,9 @@ export default function RootLayout({ children }: { children: React.ReactNode })
       className={`${anton.variable} ${rounded.variable}`}
       suppressHydrationWarning
     >
       <body className="min-h-full bg-[#101215] antialiased" suppressHydrationWarning>
+        <ControlPrefsSync />
         {children}
       </body>
     </html>
   );
```

`src/components/ControlPrefsSync.tsx` (new file):

```tsx
"use client";

import { useEffect } from "react";

import { readControlPrefs, writeControlPrefs, type PortPrefs } from "@/lib/controlPrefs";
import { useMatchConfig } from "@/lib/matchConfig";

/**
 * Keeps each port's Stick Jump and pad settings across visits (Plan 5):
 * loads them once the page is in the browser (after hydration, so the server
 * render and the first client render agree), then saves on every change.
 * Renders nothing.
 */
export function ControlPrefsSync() {
  useEffect(() => {
    useMatchConfig.getState().applyControlPrefs(readControlPrefs());
    return useMatchConfig.subscribe((state, prev) => {
      if (state.players === prev.players) return;
      const prefs: Record<number, PortPrefs> = {};
      for (const p of state.players) prefs[p.port] = { stickJump: p.stickJump, pad: p.pad };
      writeControlPrefs(prefs);
    });
  }, []);
  return null;
}
```

`src/components/menu/ControlsPanel.tsx` — apply:

```diff
--- a/src/components/menu/ControlsPanel.tsx
+++ b/src/components/menu/ControlsPanel.tsx
@@ -5,8 +5,9 @@ import { useRouter } from "next/navigation";
 
 import { ModeTab, ScreenBanner } from "@/components/ui/Panel";
 import { SkewPanel, SkewTag } from "@/components/ui/SkewPanel";
 import { cn } from "@/lib/cn";
+import { PadOptions } from "./PadOptions";
 import { PlayerOptions } from "./PlayerOptions";
 import {
   ACTION_LABELS,
   CONTROL_ACTIONS,
@@ -322,8 +323,9 @@ export function ControlsPanel() {
           <p className="mt-2 text-xs text-white/45">{SCHEME_INFO[scheme].hand}. {SCHEME_INFO[scheme].note}</p>
         </section>
 
         <PlayerOptions />
+        <PadOptions />
 
         <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_18rem]">
           <Keyboard bindings={active} />
 
```

`src/components/menu/PadOptions.tsx` (new file):

```tsx
"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import {
  DEFAULT_PAD_SETTINGS,
  PAD_ACTIONS,
  RIGHT_STICK_MODES,
  padButtonName,
  rebind,
  type PadAction,
  type RightStickMode,
} from "@/input/gamepad";
import { portColour, portTag, useMatchConfig } from "@/lib/matchConfig";

const ACTION_NAMES: Readonly<Record<PadAction, string>> = {
  attack: "attack",
  special: "special",
  jump: "jump",
  shield: "shield",
  grab: "grab",
};

const STICK_NAMES: Readonly<Record<RightStickMode, string>> = {
  smash: "Smash attack",
  special: "Special",
  off: "Off",
};

/** How often the capture looks at the pads: once a frame. */
const CAPTURE_POLL_MS = 16;

function padsSupported(): boolean {
  return typeof navigator !== "undefined" && typeof navigator.getGamepads === "function";
}

/** Support never changes while the page is open. */
function noSubscription(): () => void {
  return () => {};
}

/** Every button down right now on pad `padIndex` alone (another player's pad is theirs). */
function buttonsDown(padIndex: number): Set<number> {
  const down = new Set<number>();
  for (const pad of navigator.getGamepads()) {
    if (!pad || !pad.connected || pad.index !== padIndex) continue;
    pad.buttons.forEach((b, i) => {
      if (b.pressed) down.add(i);
    });
  }
  return down;
}

/**
 * Calls `onPick` with the first button pressed after it starts. A button held
 * when it starts counts only once let go and pressed again. The Gamepad API
 * has no button events, so this polls, as `GamepadInput` does.
 */
function useButtonCapture(padIndex: number | null, onPick: (button: number) => void): void {
  const pick = useRef(onPick);
  useEffect(() => {
    pick.current = onPick;
  });
  useEffect(() => {
    if (padIndex === null || !padsSupported()) return;
    let held = buttonsDown(padIndex);
    const timer = setInterval(() => {
      const now = buttonsDown(padIndex);
      for (const b of now) {
        if (!held.has(b)) {
          clearInterval(timer);
          pick.current(b);
          return;
        }
      }
      held = now;
    }, CAPTURE_POLL_MS);
    return () => clearInterval(timer);
  }, [padIndex]);
}

/**
 * Per-player gamepad options (Plan 5): rebind the five action buttons, and set
 * the right stick to Ultimate's Smash Attack (default), Special or Off. Kept
 * on the player's slot; the match's `GamepadInput` reads it through
 * `padMappingOf`.
 */
export function PadOptions() {
  const players = useMatchConfig((s) => s.players);
  const setPad = useMatchConfig((s) => s.setPad);
  const humans = players.filter((p) => p.kind === "human");
  const [capturing, setCapturing] = useState<{ port: number; action: PadAction } | null>(null);
  // The server render assumes support; the browser says, without a mismatch.
  const supported = useSyncExternalStore(noSubscription, padsSupported, () => true);

  // Pad 0 is the first human port's, pad 1 the second's (`padPortMap`).
  const padIndex = capturing === null ? null : humans.findIndex((p) => p.port === capturing.port);
  useButtonCapture(padIndex === null || padIndex < 0 ? null : padIndex, (button) => {
    if (capturing === null) return;
    const slot = useMatchConfig.getState().players.find((p) => p.port === capturing.port);
    if (slot) setPad(slot.port, rebind(slot.pad, capturing.action, button));
    setCapturing(null);
  });

  return (
    <section aria-label="Gamepad" className="mt-5">
      <h2 className="font-display text-sm tracking-[0.14em] text-white/70 uppercase">Gamepad</h2>
      {!supported && <p className="mt-2 text-xs text-white/45">This browser has no gamepad support; the keyboard still works.</p>}
      {capturing !== null && <p className="mt-2 text-sm text-white" role="status">Press a button on your gamepad…</p>}
      <ul className="mt-2 flex flex-col gap-3">
        {humans.map((p) => (
          <li key={p.port} className="flex flex-wrap items-center gap-2">
            <span className="font-display w-20 text-sm" style={{ color: portColour(p.port) }}>
              Player {p.port + 1}
            </span>
            {PAD_ACTIONS.map((action) => {
              const names = p.pad.buttons[action].map(padButtonName).join("/") || "none";
              const label = `${portTag(p.port)} ${ACTION_NAMES[action]}: ${names}`;
              const waiting = capturing?.port === p.port && capturing.action === action;
              return (
                <button
                  key={action}
                  type="button"
                  aria-label={label}
                  disabled={!supported}
                  onClick={() => setCapturing(waiting ? null : { port: p.port, action })}
                  className="border-2 border-white/30 px-2 py-1 text-xs text-white/80 hover:border-white"
                >
                  {ACTION_NAMES[action]} <span className="font-display">{waiting ? "…" : names}</span>
                </button>
              );
            })}
            <label className="flex items-center gap-1 text-xs text-white/70">
              Right stick
              <select
                aria-label={`${portTag(p.port)} right stick`}
                value={p.pad.rightStick}
                onChange={(e) => setPad(p.port, { ...p.pad, rightStick: e.target.value as RightStickMode })}
                className="bg-[#2a2d33] px-1 py-1 text-white"
              >
                {RIGHT_STICK_MODES.map((m) => (
                  <option key={m} value={m}>
                    {STICK_NAMES[m]}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              aria-label={`${portTag(p.port)} reset gamepad`}
              onClick={() => setPad(p.port, DEFAULT_PAD_SETTINGS)}
              className="text-xs text-white/50 underline"
            >
              Reset
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

`src/input/gamepad.ts` — apply:

```diff
--- a/src/input/gamepad.ts
+++ b/src/input/gamepad.ts
@@ -108,8 +108,13 @@ export interface GamepadMapping {
   readonly right: readonly number[];
   /** Axis indices for the left stick. Y is inverted below: pads report +Y down. */
   readonly stickX: number;
   readonly stickY: number;
+  /** Plan 5: what a right-stick flick does (Ultimate's default: a smash attack). */
+  readonly rightStick?: RightStickMode;
+  /** Plan 5: axis indices for the right stick; the standard mapping's 2 and 3. */
+  readonly rightStickX?: number;
+  readonly rightStickY?: number;
 }
 
 export const STANDARD_MAPPING: GamepadMapping = {
   attack: [0], // A
@@ -122,8 +127,11 @@ export const STANDARD_MAPPING: GamepadMapping = {
   left: [14],
   right: [15],
   stickX: 0,
   stickY: 1,
+  rightStick: "smash",
+  rightStickX: 2,
+  rightStickY: 3,
 };
 
 const BUTTON_ORDER: readonly (readonly [keyof GamepadMapping, Btn])[] = [
   ["attack", Btn.Attack],
@@ -148,8 +156,13 @@ export interface GamepadOptions {
    * Which pad index drives which port. Defaults to identity — pad 0 is port 0.
    * The player-select screen overwrites it once players pick their seats.
    */
   readonly portForPad?: (padIndex: number) => number;
+  /**
+   * Plan 5: each port's own mapping (the player's remap on /controls).
+   * Overrides `mapping` when given.
+   */
+  readonly mappingForPort?: (port: number) => GamepadMapping;
   readonly onConnectionChange?: (padIndex: number, connected: boolean) => void;
 }
 
 export interface GamepadPoll {
@@ -165,22 +178,26 @@ export interface GamepadPoll {
 
 export class GamepadInput {
   private readonly win: Window | undefined;
   private readonly nav: Navigator | undefined;
-  private readonly mapping: GamepadMapping;
+  private readonly mappingForPort: (port: number) => GamepadMapping;
   private readonly deadzone: number;
   private readonly portForPad: (padIndex: number) => number;
   private readonly onConnectionChange: ((padIndex: number, connected: boolean) => void) | undefined;
 
   /** Last poll's packed frame per pad index, for edge detection. */
   private readonly lastFrames = new Map<number, InputFrame>();
+  /** Plan 5: last poll's right-stick direction per pad, and a flick waiting for its second frame. */
+  private readonly lastRight = new Map<number, InputFrame>();
+  private readonly pendingRight = new Map<number, InputFrame>();
   private readonly connected = new Set<number>();
   private attached = false;
 
   constructor(options: GamepadOptions = {}) {
     this.win = options.window ?? (globalThis as { window?: Window }).window;
     this.nav = options.navigator ?? this.win?.navigator;
-    this.mapping = options.mapping ?? STANDARD_MAPPING;
+    const mapping = options.mapping ?? STANDARD_MAPPING;
+    this.mappingForPort = options.mappingForPort ?? (() => mapping);
     this.deadzone = options.deadzone ?? RADIAL_DEADZONE;
     this.portForPad = options.portForPad ?? ((i) => i);
     this.onConnectionChange = options.onConnectionChange;
   }
@@ -206,8 +223,10 @@ export class GamepadInput {
     this.attached = false;
     this.win.removeEventListener("gamepadconnected", this.onConnected);
     this.win.removeEventListener("gamepaddisconnected", this.onDisconnected);
     this.lastFrames.clear();
+    this.lastRight.clear();
+    this.pendingRight.clear();
     this.connected.clear();
   }
 
   /**
@@ -229,10 +248,11 @@ export class GamepadInput {
       const port = this.portForPad(pad.index);
       if (port < 0 || port >= portCount) continue;
       seen.push(pad.index);
 
-      const stick = this.readStick(pad);
-      const frame = this.packFrame(pad, stick);
+      const mapping = this.mappingForPort(port);
+      const stick = this.readStick(pad, mapping);
+      const frame = this.rightStickFrame(pad, mapping, this.packFrame(pad, stick, mapping));
       const previous = this.lastFrames.get(pad.index) ?? 0;
 
       frames[port] |= frame;
       pressed[port] |= frame & ~previous;
@@ -247,25 +267,31 @@ export class GamepadInput {
     // fighter runs off the stage holding a direction nobody is pressing.
     for (const index of [...this.lastFrames.keys()]) {
       if (!seen.includes(index)) this.lastFrames.delete(index);
     }
+    for (const index of [...this.lastRight.keys()]) {
+      if (!seen.includes(index)) {
+        this.lastRight.delete(index);
+        this.pendingRight.delete(index);
+      }
+    }
 
     return { frames, pressed, released, sticks, connectedPads: seen };
   }
 
-  private readStick(pad: Gamepad): Stick {
-    const rawX = pad.axes[this.mapping.stickX] ?? 0;
+  private readStick(pad: Gamepad, mapping: GamepadMapping): Stick {
+    const rawX = pad.axes[mapping.stickX] ?? 0;
     // Pads report +Y downwards; the simulation's +Y is up (SPEC §8's blast
     // zones are positive at the top), so the axis is negated once, here.
-    const rawY = -(pad.axes[this.mapping.stickY] ?? 0);
+    const rawY = -(pad.axes[mapping.stickY] ?? 0);
     return radialDeadzone(rawX, rawY, this.deadzone);
   }
 
-  private packFrame(pad: Gamepad, stick: Stick): InputFrame {
+  private packFrame(pad: Gamepad, stick: Stick, mapping: GamepadMapping): InputFrame {
     let frame: InputFrame = 0;
 
     for (const [name, bit] of BUTTON_ORDER) {
-      const indices = this.mapping[name] as readonly number[];
+      const indices = mapping[name] as readonly number[];
       for (const i of indices) {
         if (pad.buttons[i]?.pressed) {
           frame |= bit;
           break;
@@ -289,8 +315,38 @@ export class GamepadInput {
 
     return frame;
   }
 
+  /**
+   * Plan 5: a right-stick flick (from neutral past the walk threshold) is a
+   * smash attack, or a special, in its direction — Ultimate's right stick.
+   * The packed frame is digital and the simulation reads a smash as a fresh
+   * direction press with the attack button (`SMASH_INPUT_WINDOW`), so the
+   * flick lets go of the left stick's direction for one frame and presses its
+   * own on the next. UNVERIFIED-simplified: the real game reads the right
+   * stick on the frame it moves; here it costs one frame.
+   */
+  private rightStickFrame(pad: Gamepad, mapping: GamepadMapping, frame: InputFrame): InputFrame {
+    const mode = mapping.rightStick ?? "smash";
+    if (mode === "off") return frame;
+    const r = radialDeadzone(pad.axes[mapping.rightStickX ?? 2] ?? 0, -(pad.axes[mapping.rightStickY ?? 3] ?? 0), this.deadzone);
+    // One of four directions, the larger axis: smash attacks and specials are four-way.
+    const dir: InputFrame = r.magnitude < WALK_THRESHOLD ? 0 : Math.abs(r.x) >= Math.abs(r.y) ? (r.x > 0 ? Btn.Right : Btn.Left) : r.y > 0 ? Btn.Up : Btn.Down;
+    const previous = this.lastRight.get(pad.index) ?? 0;
+    this.lastRight.set(pad.index, dir);
+    const body = frame & ~(DIRECTION_MASK | Btn.Soft);
+    const pending = this.pendingRight.get(pad.index);
+    if (pending !== undefined) {
+      this.pendingRight.delete(pad.index);
+      return body | pending | (mode === "smash" ? Btn.Attack : Btn.Special);
+    }
+    if (dir !== 0 && previous === 0) {
+      this.pendingRight.set(pad.index, dir);
+      return body;
+    }
+    return frame;
+  }
+
   private readonly onConnected = (event: Event): void => {
     const index = (event as GamepadEvent).gamepad?.index;
     if (typeof index !== "number") return;
     this.connected.add(index);
@@ -301,8 +357,10 @@ export class GamepadInput {
     const index = (event as GamepadEvent).gamepad?.index;
     if (typeof index !== "number") return;
     this.connected.delete(index);
     this.lastFrames.delete(index);
+    this.lastRight.delete(index);
+    this.pendingRight.delete(index);
     this.onConnectionChange?.(index, false);
   };
 }
 
@@ -329,4 +387,89 @@ export function mergeKeyboardAndPad(keys: InputFrame, pad: InputFrame): InputFra
 /** Pad 0 drives the first human port, pad 1 the second; extra pads drive nothing. */
 export function padPortMap(ports: readonly number[]): (padIndex: number) => number {
   return (padIndex) => ports[padIndex] ?? -1;
 }
+
+/* ---------------------------------------------------------- remap (Plan 5) -- */
+
+/** The pad actions a player can rebind on /controls. Directions stay on the stick and d-pad. */
+export type PadAction = "attack" | "special" | "jump" | "shield" | "grab";
+export const PAD_ACTIONS: readonly PadAction[] = ["attack", "special", "jump", "shield", "grab"];
+
+/** Ultimate's right-stick settings the replica offers (it also has Tilt Attack and Jump). */
+export type RightStickMode = "smash" | "special" | "off";
+export const RIGHT_STICK_MODES: readonly RightStickMode[] = ["smash", "special", "off"];
+
+/** One player's pad settings: the buttons on each action, and the right stick. */
+export interface PadSettings {
+  readonly buttons: Readonly<Record<PadAction, readonly number[]>>;
+  readonly rightStick: RightStickMode;
+}
+
+export const DEFAULT_PAD_SETTINGS: PadSettings = {
+  buttons: {
+    attack: STANDARD_MAPPING.attack,
+    special: STANDARD_MAPPING.special,
+    jump: STANDARD_MAPPING.jump,
+    shield: STANDARD_MAPPING.shield,
+    grab: STANDARD_MAPPING.grab,
+  },
+  rightStick: "smash",
+};
+
+/**
+ * `button` now does `action` alone: it leaves every other action it was on.
+ * An action that would be left with no button at all takes the buttons
+ * `action` had — a swap — so no action (jump and attack above all) is ever
+ * unbound.
+ */
+export function rebind(settings: PadSettings, action: PadAction, button: number): PadSettings {
+  const before = settings.buttons[action].filter((b) => b !== button);
+  const buttons = {} as Record<PadAction, readonly number[]>;
+  for (const a of PAD_ACTIONS) {
+    if (a === action) {
+      buttons[a] = [button];
+      continue;
+    }
+    const kept = settings.buttons[a].filter((b) => b !== button);
+    buttons[a] = kept.length > 0 || settings.buttons[a].length === 0 ? kept : before;
+  }
+  return { ...settings, buttons };
+}
+
+/**
+ * The mapping `GamepadInput` reads for a player's settings. A d-pad button
+ * bound to an action stops being that direction (it would otherwise do both).
+ */
+export function mappingFrom(settings: PadSettings): GamepadMapping {
+  const bound = new Set(PAD_ACTIONS.flatMap((a) => settings.buttons[a]));
+  const free = (dir: readonly number[]) => dir.filter((b) => !bound.has(b));
+  return {
+    ...STANDARD_MAPPING,
+    ...settings.buttons,
+    up: free(STANDARD_MAPPING.up),
+    down: free(STANDARD_MAPPING.down),
+    left: free(STANDARD_MAPPING.left),
+    right: free(STANDARD_MAPPING.right),
+    rightStick: settings.rightStick,
+  };
+}
+
+/** Is `value` a well-formed `PadSettings` (read back from storage)? */
+export function isPadSettings(value: unknown): value is PadSettings {
+  if (typeof value !== "object" || value === null) return false;
+  const v = value as { buttons?: unknown; rightStick?: unknown };
+  if (!RIGHT_STICK_MODES.includes(v.rightStick as RightStickMode)) return false;
+  if (typeof v.buttons !== "object" || v.buttons === null) return false;
+  const buttons = v.buttons as Record<string, unknown>;
+  return PAD_ACTIONS.every((a) => {
+    const list = buttons[a];
+    return Array.isArray(list) && list.length > 0 && list.length <= 8 && list.every((b) => Number.isInteger(b) && b >= 0 && b < 32);
+  });
+}
+
+const BUTTON_NAMES: readonly string[] = ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "Back", "Start", "LS", "RS", "Up", "Down", "Left", "Right", "Home"];
+
+/** A standard-mapping button's usual name. */
+export function padButtonName(index: number): string {
+  return BUTTON_NAMES[index] ?? `Button ${index}`;
+}
```

`src/lib/controlPrefs.ts` (new file):

```ts
/**
 * Each port's control options, kept between visits (Plan 5): Stick Jump and
 * the gamepad settings a player chose on /controls.
 *
 * Browser storage can be missing, full, blocked or hold anything at all, so
 * every access is guarded and everything read back is checked against the
 * schema; any failure means the defaults, never an error a player sees.
 */

import { isPadSettings, type PadSettings } from "@/input/gamepad";

export const CONTROL_PREFS_KEY = "david-smash.controls.v1";

export interface PortPrefs {
  readonly stickJump: boolean;
  readonly pad: PadSettings;
}

/** The page's `localStorage`, or null where there is none or reading it throws. */
export function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : (window.localStorage ?? null);
  } catch {
    return null;
  }
}

function isPortPrefs(value: unknown): value is PortPrefs {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { stickJump?: unknown; pad?: unknown };
  return typeof v.stickJump === "boolean" && isPadSettings(v.pad);
}

/** Every port's saved options; a port with nothing valid saved is absent. */
export function readControlPrefs(storage: Storage | null = browserStorage()): Partial<Record<number, PortPrefs>> {
  if (storage === null) return {};
  try {
    const raw = storage.getItem(CONTROL_PREFS_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const out: Partial<Record<number, PortPrefs>> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const port = Number(key);
      if (Number.isInteger(port) && port >= 0 && port < 8 && isPortPrefs(value)) out[port] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/** Save every port's options. A storage that refuses is ignored. */
export function writeControlPrefs(prefs: Partial<Record<number, PortPrefs>>, storage: Storage | null = browserStorage()): void {
  if (storage === null) return;
  try {
    storage.setItem(CONTROL_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Full, blocked or private: the options still hold for this visit.
  }
}
```

`src/lib/matchConfig.ts` — apply:

```diff
--- a/src/lib/matchConfig.ts
+++ b/src/lib/matchConfig.ts
@@ -2,8 +2,9 @@ import { useEffect, useState } from "react";
 import { create } from "zustand";
 
 import { fx } from "@/engine/fixed";
 import { CONTROL_STICK_JUMP_OFF } from "@/engine/types";
+import { DEFAULT_PAD_SETTINGS, mappingFrom, type GamepadMapping, type PadSettings } from "@/input/gamepad";
 import type {
   FighterDef,
   FighterPalette,
   MatchOutcome,
@@ -625,8 +626,15 @@ export interface PlayerSlot {
   /** Which control preset a human port is using. Ignored for CPUs. */
   scheme: SchemeId;
   /** Plan 5: Ultimate's "Stick Jump" (tap jump) — up on the stick jumps. On by default. */
   stickJump: boolean;
+  /** Plan 5: this player's gamepad buttons and right stick. Local only: what travels online is the packed frame. */
+  pad: PadSettings;
+}
+
+/** The gamepad mapping for a slot's pad settings (Plan 5). */
+export function padMappingOf(slot: Pick<PlayerSlot, "pad">): GamepadMapping {
+  return mappingFrom(slot.pad);
 }
 
 /** A slot's control options as the simulation's `CONTROL_*` bits (Plan 5). A CPU plays the default. */
 export function controlsOf(slot: Pick<PlayerSlot, "kind" | "stickJump">): number {
@@ -716,8 +724,12 @@ interface MatchConfigState {
   setCostume(port: number, costume: number): void;
   setScheme(port: number, scheme: SchemeId): boolean;
   /** Plan 5: turn a port's stick jump on or off. */
   setStickJump(port: number, on: boolean): void;
+  /** Plan 5: a port's gamepad buttons and right stick. */
+  setPad(port: number, pad: PadSettings): void;
+  /** Plan 5: each port's saved Stick Jump and pad settings (`lib/controlPrefs.ts`). */
+  applyControlPrefs(prefs: Partial<Record<number, { readonly stickJump: boolean; readonly pad: PadSettings }>>): void;
   /** Two humans, one per machine, each on their own keyboard's Config 1. */
   configureOnline(): void;
   /** Back to the offline default: one human and a CPU. */
   leaveOnline(): void;
@@ -739,22 +751,24 @@ function makePlayer(port: number): PlayerSlot {
     fighterId: null,
     costume: port,
     scheme: CONTROL_SCHEMES[Math.min(port, CONTROL_SCHEMES.length - 1)],
     stickJump: true,
+    pad: DEFAULT_PAD_SETTINGS,
   };
 }
 
 function initialPlayers(): PlayerSlot[] {
   return [makePlayer(0), makePlayer(1)];
 }
 
 /**
- * An online port. Both start with this machine's player's control options —
- * the local port keeps them, and the remote one is overwritten by the other
- * peer's pick (`onlineStore`).
+ * An online port. Both start with this machine's player's control options and
+ * pad settings — the local port keeps them, and the remote one's control
+ * options are overwritten by the other peer's pick (`onlineStore`); its pad
+ * settings are never used here (the other peer's pad is on their machine).
  */
-function onlinePlayer(port: number, local: Pick<PlayerSlot, "stickJump">): PlayerSlot {
-  return { port, kind: "human", cpuLevel: 3, fighterId: null, costume: port, scheme: "arrows", stickJump: local.stickJump };
+function onlinePlayer(port: number, local: Pick<PlayerSlot, "stickJump" | "pad">): PlayerSlot {
+  return { port, kind: "human", cpuLevel: 3, fighterId: null, costume: port, scheme: "arrows", stickJump: local.stickJump, pad: local.pad };
 }
 
 /**
  * Ultimate's 1v1 damage bonus is a property of the match, not a setting: it
@@ -868,8 +882,16 @@ export const useMatchConfig = create<MatchConfigState>()((set, get) => ({
     return true;
   },
   setStickJump: (port, on) =>
     set((s) => ({ players: s.players.map((p) => (p.port === port ? { ...p, stickJump: on } : p)) })),
+  setPad: (port, pad) => set((s) => ({ players: s.players.map((p) => (p.port === port ? { ...p, pad } : p)) })),
+  applyControlPrefs: (prefs) =>
+    set((s) => ({
+      players: s.players.map((p) => {
+        const saved = prefs[p.port];
+        return saved === undefined ? p : { ...p, stickJump: saved.stickJump, pad: saved.pad };
+      }),
+    })),
 
   configureOnline: () =>
     set((s) => {
       const local = s.players.find((p) => p.kind === "human") ?? s.players[0];
```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/components/ControlPrefsSync.test.tsx src/components/menu/PadOptions.test.tsx src/game/onlineConfig.test.ts src/input/padRemap.test.ts src/lib/controlPrefs.test.ts`
Expected: PASS (`src/components/ControlPrefsSync.test.tsx` 3 tests, `src/components/menu/PadOptions.test.tsx` 5 tests, `src/input/padRemap.test.ts` 12 tests, `src/lib/controlPrefs.test.ts` 4 tests).

- [ ] **Step 5: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0; golden trace untouched.

- [ ] **Step 6: Commit**

```bash
git add super-smash/src/app/layout.tsx super-smash/src/components/ControlPrefsSync.test.tsx super-smash/src/components/ControlPrefsSync.tsx super-smash/src/components/menu/ControlsPanel.tsx super-smash/src/components/menu/PadOptions.test.tsx super-smash/src/components/menu/PadOptions.tsx super-smash/src/game/onlineConfig.test.ts super-smash/src/input/gamepad.ts super-smash/src/input/padRemap.test.ts super-smash/src/lib/controlPrefs.test.ts super-smash/src/lib/controlPrefs.ts super-smash/src/lib/matchConfig.ts
git commit -m "super-smash: gamepad remap and right-stick smash/special on /controls" -m "Five rebindable pad actions (a swap, never unbound; a bound d-pad button leaves its direction) and Ultimate's right stick (smash attack by default, special, off), per player, captured from that player's own pad; kept per port in browser storage, read defensively, and carried into online play for this machine's player. A right-stick flick releases the left stick for a frame so its direction is a fresh press (UNVERIFIED-simplified). Golden trace unchanged." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 22: e2e: Stick Jump and the gamepad remap in a real browser

The options have to reach a running match, not just the store (the lesson of `e2e/rebinding.spec.ts`). One page session: turn P1's Stick Jump off on `/controls`, start a match from the menu, hold up (nothing jumps) and the jump key (it jumps). The remap tests stand a fake pad behind `navigator.getGamepads()` (`addInitScript`); the page cannot tell, because the API is all it reads: rebind attack to Y on `/controls`, start a match, and Y attacks while A does nothing.

**Files:**
- Create: `super-smash/e2e/padOptions.spec.ts`

**Interfaces:**
- Consumes: `e2e/helpers.ts` (`startFromTitle`, `startMatchFromMenu`, `readFighters`, `P1`, `ROUTES`).
- Produces: `e2e/padOptions.spec.ts`.

- [ ] **Step 1: Write the failing test**

`e2e/padOptions.spec.ts` (new file):

```ts
import { expect, test } from "@playwright/test";
import { P1, ROUTES, readFighters, startFromTitle, startMatchFromMenu } from "./helpers";

/**
 * Plan 5's control options on /controls: Stick Jump per player, and a gamepad
 * remap captured from a real `navigator.getGamepads()` poll. No pad is plugged
 * into the test browser, so a fake one stands behind the API; the page cannot
 * tell the difference, because the API is all it ever reads.
 */

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { __padPressed: number[] };
    w.__padPressed = [];
    Object.defineProperty(navigator, "getGamepads", {
      configurable: true,
      value: () => [
        {
          index: 0,
          id: "e2e pad",
          connected: true,
          mapping: "standard",
          axes: [0, 0, 0, 0],
          buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: w.__padPressed.includes(i), touched: false, value: w.__padPressed.includes(i) ? 1 : 0 })),
        },
      ],
    });
  });
});

test("stick jump can be turned off for player 1", async ({ page }) => {
  await page.goto(ROUTES.controls);
  const toggle = page.getByRole("switch", { name: "P1 stick jump" });
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-checked", "false");
});

test("a gamepad button is rebound by pressing it", async ({ page }) => {
  await page.goto(ROUTES.controls);
  await page.getByRole("button", { name: "P1 attack: A" }).click();
  await expect(page.getByText("Press a button on your gamepad…")).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { __padPressed: number[] }).__padPressed = [3];
  });
  await expect(page.getByRole("button", { name: "P1 attack: Y" })).toBeVisible();
  await expect(page.getByRole("button", { name: "P1 jump: X" })).toBeVisible();
  await page.getByRole("combobox", { name: "P1 right stick" }).selectOption("special");
  await expect(page.getByRole("combobox", { name: "P1 right stick" })).toHaveValue("special");
});

test("stick jump off reaches the match: up no longer jumps, the jump button still does", async ({ page }) => {
  // One page session: the match configuration is a client-side store.
  await startFromTitle(page);
  await page.getByRole("link", { name: /controls/i }).click();
  await page.waitForURL("**/controls");
  await page.getByRole("switch", { name: "P1 stick jump" }).click();
  await page.getByRole("button", { name: /back to the main menu/i }).click();
  await page.waitForURL("**/menu");
  await startMatchFromMenu(page);

  async function statesWhileHolding(code: string): Promise<Set<string>> {
    const seen = new Set<string>();
    await page.keyboard.down(code);
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(40);
      seen.add((await readFighters(page))[0].action);
    }
    await page.keyboard.up(code);
    return seen;
  }

  const jumping = /^(jumpSquat|jump|fall)$/;
  const onUp = await statesWhileHolding(P1.up);
  expect([...onUp].filter((a) => jumping.test(a)), `up jumped: ${[...onUp].join(", ")}`).toEqual([]);
  await page.waitForTimeout(200);
  const onJump = await statesWhileHolding(P1.jump);
  expect([...onJump].some((a) => jumping.test(a)), `the jump button did nothing: ${[...onJump].join(", ")}`).toBe(true);
});

test("a rebound pad button plays the match: the new button attacks, the old one does nothing", async ({ page }) => {
  // One page session: rebind on /controls, then play from the menu.
  await startFromTitle(page);
  await page.getByRole("link", { name: /controls/i }).click();
  await page.waitForURL("**/controls");
  await page.getByRole("button", { name: "P1 attack: A" }).click();
  await page.evaluate(() => {
    (window as unknown as { __padPressed: number[] }).__padPressed = [3];
  });
  await expect(page.getByRole("button", { name: "P1 attack: Y" })).toBeVisible();
  await page.evaluate(() => {
    (window as unknown as { __padPressed: number[] }).__padPressed = [];
  });
  await page.getByRole("button", { name: /back to the main menu/i }).click();
  await page.waitForURL("**/menu");
  await startMatchFromMenu(page);

  async function statesWhilePressing(button: number): Promise<Set<string>> {
    const seen = new Set<string>();
    await page.evaluate((b) => {
      (window as unknown as { __padPressed: number[] }).__padPressed = [b];
    }, button);
    for (let i = 0; i < 6; i++) {
      await page.waitForTimeout(40);
      seen.add((await readFighters(page))[0].action);
    }
    await page.evaluate(() => {
      (window as unknown as { __padPressed: number[] }).__padPressed = [];
    });
    return seen;
  }

  const onOld = await statesWhilePressing(0);
  expect([...onOld].filter((a) => a === "attack"), `A still attacked: ${[...onOld].join(", ")}`).toEqual([]);
  await page.waitForTimeout(300);
  const onNew = await statesWhilePressing(3);
  expect([...onNew].some((a) => a === "attack"), `Y did not attack: ${[...onNew].join(", ")}`).toBe(true);
});
```

- [ ] **Step 2: Prove the match tests can fail** — Tasks 20–21 already make these pass, so break each on purpose: comment out the line `await page.getByRole("switch", { name: "P1 stick jump" }).click();`, and (separately) make `/play`'s `mappingForPort` return `padMappingOf({ pad: DEFAULT_PAD_SETTINGS })`, and run

Run: `PORT=3107 pnpm test:e2e e2e/padOptions.spec.ts`
Expected: FAIL — `up jumped: stand, jumpSquat, jump` (the Stick Jump test, with the option left on). And with `/play` reading the factory mapping instead of the player's: `A still attacked: attack`. Undo both.

- [ ] **Step 3: Run it again**

Run: `PORT=3107 pnpm test:e2e e2e/padOptions.spec.ts`
Expected: PASS (`e2e/padOptions.spec.ts` 4 tests).

- [ ] **Step 4: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0; golden trace untouched.

- [ ] **Step 5: Commit**

```bash
git add super-smash/e2e/padOptions.spec.ts
git commit -m "super-smash: e2e: Stick Jump reaches the match; a pad button rebinds by pressing it" -m "Four Playwright tests on /controls and in a match, with a fake pad behind navigator.getGamepads(): Stick Jump off reaches the match, and a rebound pad button plays it." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 23: D58 and the README

Plan 5's decisions are recorded in D58, after Plan 4's D57, and the README documents Stick Jump and the pad options. `ENGINE_RULES_VERSION` became 5 in Task 2, Plan 5's first change to what `step()` does (Plans 3–4's rule), so two builds on either side of Plan 5 already refuse each other online; this task only records it.

**Files:**
- Modify: `super-smash/DECISIONS.md`, `super-smash/README.md`

**Interfaces:**
- Consumes: `ENGINE_RULES_VERSION`, `engineFingerprint` (Plans 3–4).
- Produces: DECISIONS D58; README.

- [ ] **Step 1: Write them**

In `DECISIONS.md` append D58 after Plan 4 Task 23's D57, whose last paragraph ends `…A checkout without \`pnpm models\` plays with capsule stand-ins.` — the diff below is anchored there (the scratch tree took D57's text from Plan 4 in a stand-in commit).

`DECISIONS.md` — apply:

```diff
--- a/DECISIONS.md
+++ b/DECISIONS.md
@@ -1624,4 +1624,62 @@ own chunk after `/play` mounts. A model that fails to load is a stand-in for tha
 
 **What it is not.** No ripped file is ever committed (spec §3.1): only bone names, bind matrices,
 capsule sizes and SHA-256s; the guard test refuses any tracked file whose name, or whose size and
 hash, is a manifest file's. A checkout without `pnpm models` plays with capsule stand-ins.
+
+## D58 — Every documented special, the Final Smashes, a CPU that uses them, and pad options
+
+**Decision.** Plan 5 implements every special research §2 documents for the eight fighters,
+their Final Smashes and the movement options the replica lacked, from published numbers
+(SmashWiki per-move and Moveset pages, rubendal's Data Viewer scripts, UltimateFrameData);
+what no source publishes is marked `UNVERIFIED:` beside the stand-in.
+
+- **Charge on B** (`specialCharge.ts`): Samus's Charge Shot, Donkey Kong's Giant Punch and
+  Mario's F.L.U.D.D. **store** a charge (112, 110 and 80 frames; shield or jump stores it, the
+  next B fires it); Marth's Shield Breaker, Kirby's Hammer Flip, Pikachu's Skull Bash and Link's
+  bow charge while B is **held**. Below full each grows by its own published formula
+  (`PartialCharge`: Charge Shot every number linearly; Giant Punch `base + 18·c/110` rounded
+  down; Shield Breaker ×`1 + 1.2·c/60`; Hammer Flip +0.085% a frame; Skull Bash
+  `6.2 + 15.2·c/80`; the bow `4 + 8·c/60` rounded down), and a full charge replaces the boxes
+  outright.
+- **Reflectors and counters** (`reflect.ts`, `counter.ts`): Fox's Reflector (×1.4 speed and
+  damage, 50% cap, turned by the stick from frame 5) and Mario's Cape (×1.5 damage, ×1 speed,
+  ×0.75 lifetime; it turns its victim, and its stall is the page's speed ÷ 2.5, +0.3, gravity
+  0.031, falling speed 1) send a projectile back as the reflector's own; a projectile reflected
+  7 times is deleted on the eighth. Marth's Counter takes a hit in frames 6–27 and answers it ×1.2
+  (8% at least, 50% at most); a projectile it counters is gone and its thrower is not frozen. A
+  grab, a windbox and a Final Smash go through a counter (the last two UNVERIFIED).
+- **Grabs that hold** (`status/cargo.ts`, `status/inhale.ts`, `inhale.ts`): Donkey Kong's Cargo
+  Carry (walk ×1.1, four cargo throws, which finish even if he lands mid-throw), Kirby's Inhale
+  (hold `180 + 1.1t − k` frames, walk ×1.08, swallow or spit a star that flies `25 + 0.5t`
+  frames; a Copy Ability at ×1.2 damage, lost on a KO or, after a 1,200-frame grace, to a hit with
+  chance damage/70 from the seeded RNG). Throws and pummels now run their `ATTACK_ABS` scripts.
+- **Final Smashes** (`final.ts`, `finalKit.ts`): breaking the Smash Ball puts its breaker in
+  standby; their next *neutral* special is the Final Smash (SmashWiki). A damaging hit in standby
+  drops the ball, which roams again (SmashWiki "Smash Ball"; how hard a hit must be is
+  UNVERIFIED). The power has no time limit and a KO loses it — both UNVERIFIED. A cinematic Final
+  Smash traps whoever its first hit touches (letting go of anyone they held or were held by) and
+  plays its scene inside the simulation, so the scene rolls back and replays like any frame
+  (`GameState.cinematic` stands everyone else, every projectile, the ball and the clock still).
+  Per-hit numbers come from the fighters' `game_final*` scripts and SmashWiki; the boxes' offsets
+  and any radius no source quotes are UNVERIFIED stand-ins.
+- **Movement**: wall jumps rise each wall jumper's published height (Pikachu 36.89, Mario 31.563,
+  Samus 30.45, Fox 25.35), ×0.96 for each repeat; footstool jumps (never on a fighter who is held,
+  holding, inside Kirby, trapped, invincible, on the respawn platform or in hitstun — the last a
+  DECISION, UNVERIFIED — and decided the same whichever port is which); Pikachu's crawl.
+- **CPU** (`ai/specials.ts`): techs, escapes hitstun with an air dodge, parries, reflects and
+  counters, stores charges, throws cargo, breaks the Smash Ball and uses the Final Smash, and
+  recovers with a side special — a Kirby CPU with a Copy Ability using the copied move; every
+  roll stays from `cpuInput`'s deterministic seed.
+- **Controls**: Ultimate's Stick Jump is a per-player option that travels with the match and
+  online (`CombatState.controls`, the lobby pick and the start config); a gamepad's five action
+  buttons can be rebound on `/controls` (a swap, so no action is ever left unbound; a d-pad
+  button bound to an action stops being a direction) and its right stick does a smash attack
+  (Ultimate's default), a special or nothing. The right stick costs one frame: it lets go of the
+  left stick's direction for a frame so its own is a fresh press (UNVERIFIED-simplified). Each
+  port's options are kept in the browser's storage, read defensively.
+
+**Online.** `ENGINE_RULES_VERSION` is 5 from Plan 5's first behaviour change. The legacy move
+data the specials add is covered by the version; the scripts they switch on (throws, pummels,
+smash attacks with a charge) are in `ACTIVE_SCRIPT_SLOTS` or `limb.json`, both of which
+`engineFingerprint` hashes. A start from an older host is read and refused by that fingerprint,
+never dropped silently.
```

`README.md` — apply:

```diff
--- a/README.md
+++ b/README.md
@@ -177,8 +177,15 @@ rebinds any action in it; the match reads the bindings the player actually chose
 
 Walking is not reachable, and that is correct rather than missing — a key is always a *full*
 deflection, and a fully-deflected stick dashes. Micro-spacing comes from tapping.
 
+**Stick Jump can be turned off, per player** (`/controls`), as in Ultimate: then up only aims,
+and only the jump key jumps. It travels with the match, and online to the other peer.
+
+**A gamepad's buttons are rebindable too.** On `/controls`, click an action and press the pad
+button for it; the right stick does a smash attack (Ultimate's default), a special, or nothing.
+Both options are kept in the browser between visits ([D58](DECISIONS.md#d58--every-documented-special-the-final-smashes-a-cpu-that-uses-them-and-pad-options)).
+
 ---
 
 ## Architecture
 
@@ -287,9 +294,12 @@ round trip (`src/net/rollback.ts`).
    fast-faller, a multi-jumper, a sword spacer.
 6. **No items but the Smash Ball**, no Spirits, no World of Light, no Classic Mode. Cutting
    them is what made the remaining part reproducible properly
    ([D1](DECISIONS.md#d1--only-the-brawl-and-only-one-item)).
-7. **Desktop only.** Every control is a physical key and a phone has none, so a touch device
+7. **Some special and Final Smash numbers are stand-ins.** Where no source publishes a value
+   (a Final Smash's per-hit damage, a wall jump's speed, a footstool's bounce) the code says
+   `UNVERIFIED:` beside it ([D58](DECISIONS.md#d58--every-documented-special-the-final-smashes-a-cpu-that-uses-them-and-pad-options)).
+8. **Desktop only.** Every control is a physical key and a phone has none, so a touch device
    is told so rather than shown a layout nobody can play.
 
 ---
 
```

- [ ] **Step 2: Full gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`
Expected: exit 0; golden trace untouched.

- [ ] **Step 3: Commit**

```bash
git add super-smash/DECISIONS.md super-smash/README.md
git commit -m "super-smash: D58: specials, Final Smashes, the CPU and pad options; README" -m "D58 records Plan 5's decisions and its UNVERIFIED stand-ins (rules version 5 since Task 2); the README documents Stick Jump and the pad options, kept between visits." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: STOP: ask David for go to deploy.** The deploy (Plan 1 Task 24's `pnpm run deploy`) ships rules version 5: a player still on a tab with version 4 cannot start an online match with one on 5 until both reload. Say: "Plan 5 is ready to ship: every special, eight Final Smashes, the CPU using them, Stick Jump and the pad remap; online players on the old tab must reload. Deploy?" On go, run Plan 1 Task 24's deploy steps, then `SMASH_URL=https://david-smash.leaders-game.workers.dev pnpm test:e2e e2e/padOptions.spec.ts`.

---

## Self-review

**Spec coverage (§3.2 phase 5; §3.4; research §2's "specials with data but no engine code").** Reflectors → Task 3; counters → Task 5; Cape → Task 4; F.L.U.D.D. → Task 6; cargo → Task 8; Inhale → Task 9; Samus's charge storage (and every charge-on-B special) → Task 2; Final Smash → Tasks 14–16 (all eight) and its presentation → Task 17; wall jump → Task 10; footstool → Task 11; crawl → Task 12; tech and ledge trump were Plan 3's. Throws and pummels from `ATTACK_ABS` → Task 7, and the momentum, projectile, armour and charge moves Plan 3 left on legacy → Task 13 (Plan 3's note). CPU: tech, hitstun-cancel escape, parry → Task 18; DI and recovery were Plan 2–3's and stay; specials (reflect, counter, charges, carries), the Final Smash, the Smash Ball and side-special recovery → Task 19; `cpuInput` stays pure (every behaviour reads `ctx.rolls`; `DECISION_ROLLS` 9). Controls: Stick Jump → Task 20; gamepad remap UI and the right stick as smash or special → Task 21; keyboard schemes untouched; e2e → Task 22. Online: `ENGINE_RULES_VERSION` 5 → Task 2 (Plan 5's first behaviour change); D58 → Task 23.

**Placeholder scan.** Every code block is the scratch tree's text, by `git show` of that task's commit: new files in full, edits as exact diffs. Every generated artefact a task changes is given as its scratch diff (allowlists, limb list, bake digest) or, for the golden trace, by which of its four traces must change and why. No commit message carries a blank. Edits that depend on Plan 1 code the scratch tree does not have are written by symbol with Plan 1's exact text: the gamepad wiring on `/play` (Task 21; run in scratch against a stand-in of Plan 1's wiring), the online character select's two pick sends and its test (Task 20), and, if Plan 1's final text differs from the scratch tree's, the selection and lobby edits of Task 20.

**Type consistency.** New per-fighter state is on `CombatState` (cloned and hashed; `hash.test.ts`'s walker passes); new shared state is `GameState.cinematic` and `ProjectileState.source/charge/reflected`, all hashed. New `MoveSlot`s (`counterAttack`, `cargoFthrow…cargoDthrow`, `inhaleSwallow`, `inhaleSpit`, `finalAttack`, `finalEnd`) have a `SLOT_MOTION` and a `SLOT_POSE`, so Plan 4's bake bakes them; new actions are registered statuses with `poseNameFor` clips.

**Determinism.** No float in `src/engine/**`; the Copy Ability's loss draws from `GameState.rngSeed`; the Final Smash scene is sim state (Review Focus 3). The CPU draws nine rolls per decision from its seeded stream.

## Task list

1. Projectiles know their source and charge; the game state knows a cinematic
2. Specials charge on B: hold and store
3. Reflectors: Fox's Reflector, reflectable projectiles, move intangibility
4. Mario's Cape: reflect, turn the victim, stall
5. Marth's Counter
6. Windboxes and F.L.U.D.D.
7. Throws read `ATTACK_ABS`; pummels are catch-only; both run their scripts
8. Donkey Kong's Cargo Carry and cargo throws
9. Kirby's Inhale: swallow, spit a star, Copy Ability
10. Wall jumps and wall tech jumps
11. Footstool jumps
12. Pikachu crawls
13. Momentum, projectile, armour and charge moves run their scripts
14. The Final Smash engine: trap, cinematic scene, launch
15. Cinematic Final Smashes: Jungle Rush, Critical Hit, Ultra Sword, Team Star Fox, Volt Tackle
16. Mario Finale, Zero Laser, Ancient Bow and Arrow; rehits and staged projectiles
17. Presentation: swallowed hidden, the Final Smash close-up, reflect and counter flashes
18. CPU: tech, hitstun-cancel air dodge, parry
19. CPU: Final Smash, Smash Ball, reflect, counter, stored charges, carries, side recovery
20. Stick Jump: in the sim, the match config, online and /controls
21. Gamepad remap and the right stick on /controls
22. e2e: Stick Jump and the gamepad remap in a real browser
23. D58 and the README

## Decisions taken (planner's calls, confirmed when David approves this plan) and how the plan applies them

1. **A Final Smash's cutscene runs in the simulation**, not as a presentation-only pause, so rollback and online play need nothing new (Task 14; Review Focus 3). The camera close-up is presentation (Task 17).
2. **Standby follows SmashWiki where it speaks**: only a neutral special uses the Final Smash, and a damaging hit drops the Smash Ball, which roams again. **Where it does not** — a time limit on the power, a KO losing it, how hard a hit must be to drop it, the dropped ball's HP — the plan keeps the power until used, dropped or KO'd, any damaging hit drops it at a fresh ball's 40 HP, all UNVERIFIED (Task 14).
3. **Plan 5's specials keep their legacy frames** (`PLAN5_BEHAVIOUR`), with numbers from SmashWiki and the scripts; imported scripts run only where `activatable` admits them (throws, pummels, smash attacks with charges) (Tasks 7, 13).
4. **The right stick costs one frame** (release, then flick) so the 16-bit input frame stays the wire format (Task 21; UNVERIFIED-simplified).
5. **Stick Jump is sim state** (it changes what the same input does) and travels in the online start config; the pad remap is local only (Tasks 20–21).
6. **The Smash Ball stays over the stage** (floor 10, ceiling 60 units above it; UNVERIFIED) because a struck ball otherwise drifted off for good and no CPU could reach it (Task 19).
7. **No footstool on a fighter in hitstun or hitlag**, so a footstool never overwrites a launch (David's review call; UNVERIFIED) — nor on anyone held, holding, inside Kirby, trapped, invincible or on the respawn platform; footstools are decided before and applied after the state machines so ports never matter (Task 11).
8. **A counter does not catch a windbox or a Final Smash** (David's review call; UNVERIFIED) (Tasks 6, 14).
9. **The footstool's head is the bone-derived ECB's top** when Plan 4's bake is installed, `attributes.height` otherwise (Task 11).
10. **A cargo throw begun in the air finishes through a landing** (UNVERIFIED), which fixes a victim left held in `thrown` (Task 8).

## Open questions (for David)

1. **Final Smash stand-ins.** Zero Laser, Team Star Fox, Volt Tackle and Critical Hit have per-hit numbers in no source the plan could read (their cutscene hits hang off `virtualfinalattack` bones); the plan uses the scripts where they publish and labelled stand-ins elsewhere (Ultra Sword is held to SmashWiki's "a total of 40%"). Acceptable, or should any of them wait for a source?
2. **Right stick modes.** Ultimate also offers Tilt Attack and Jump on the right stick; the plan offers Smash Attack (default), Special and Off. Add the other two?
3. **The Smash Ball in standby.** SmashWiki says a hit makes the holder "drop" the ball, but not how hard the hit must be (the plan: any damaging hit), what HP the dropped ball has (the plan: a fresh one's 40), whether the power has a time limit (the plan: none) or whether a KO loses it (the plan: yes). Keep these, or change any?
4. **Wall jump and footstool numbers.** The wall jump heights are SmashWiki's (a table the page itself marks for checking); the push away from the wall, the contact and wall-tech windows, and the footstool's reach, stun and push are stand-ins. Play-test them before the deploy, or ship as is?

## Risks

- **Plan 1 text drift.** Tasks 20–21 edit the play page, lobby and online store as the scratch tree has them, and give the Plan 1 Task 21 gamepad wiring by symbol; if Plan 1's executor changed those files, apply the same edits by symbol. The gamepad mapping per port is unit-tested and its local wiring ran in the e2e against a stand-in of Plan 1's; the online wiring was not run.
- **SSBU sizes shift every distance.** Every Plan 5 test that depends on a body (cargo offset, Inhale range, footstool contact, CPU spacing, the Smash Ball's reach) passed at Plan 4's sizes, but play-feel at those sizes has not been judged by a human.
- **Golden trace churn.** Tasks 2, 7, 13, 18 and 19 regenerate it, each for a named behaviour change; a different base (Plans 1–4 as executed) may diverge in different traces. Regenerate and check the reason still holds; do not regenerate in any other task.
- **New statuses' clips.** The bake gives each new status a motion; their clips are existing poses (a crawl is the crouch clip, a carry or a mouthful the walk, held, footstooled and trapped the grabbed pose, swallowed and the star the tumble), so they look plain in 3D until someone animates them.
- **CPU difficulty.** Level 9 now techs, parries and reflects; that may feel harder than before at the same level. `specialSkill`, `techSkill` and `parrySkill` scale with level and can be tuned without touching the sim.
- **pnpm 11 and Playwright's web server.** In scratch, `pnpm run dev -- --port N` (the config's `webServer.command`) passed a literal `--` to `next dev`; the suite was run against a dev server started by hand (`pnpm exec next dev --port 3417`). If Plan 1 has not already fixed the command, `PORT=3107 pnpm test:e2e` needs the server started the same way.

## Verification record (scratch)

Scratch tree: `/private/tmp/claude-501/-Users-fobrizzlemynizzle-Documents-Personal-Projects/1b5c93cf-4a75-4d9f-92bb-6a571bd2578b/scratchpad/plan5-a7d3/ws5`, branch `p5` — a copy of Plan 4's finished `plan4-6258/ws4` (Plan 3's `plan3b` with Plan 4 applied, `ENGINE_RULES_VERSION` 4) with a real private `node_modules` copy, and one commit per task (plus the three stand-ins named at the top). The first build of Tasks 1–20 was on an older Plan 4 baseline (`plan5-a7d3/ws`); every commit was then re-applied on the final Plan 4 tree, and after the independent review the branch was rebuilt task by task with each finding fixed in the task that owns it (`tools/fixlog.md`), generated files regenerated in order, and every task gated again; the pre-review branch is kept as `p5-v1`. Notes and helper scripts: `…/plan5-a7d3/tools/` (`notes.md`, `meta.py`, `assemble.py`, which builds this file from the commits).

Could verify: typecheck, lint (0 errors, 2 pre-existing warnings in `research/`) and the whole vitest suite after every task (final: 159 files, 3,380 passed, 1 skipped); each task's failing step and message, replayed on the final tree; negative checks for the review fixes (each fix reverted, its test seen to fail); every regenerated artefact from the real bake, skeletons and scripts; the five Review Focus tests; the e2e suite in headless Chromium (24 passed, 7 skipped) including Task 22's four tests and their negative checks (Stick Jump left on; `/play` on the factory pad mapping); that nothing Plan 5 adds imports three.js (`chunkSplit.test.ts`).

Could not verify: Plan 1's final `/play`, online page, online store and online character select (Tasks 20–21 by symbol); a real gamepad (the remap and right stick ran against a fake `navigator.getGamepads()`); real SSBU glbs (no Blender); a two-browser online match on rules version 5; the deploy.
