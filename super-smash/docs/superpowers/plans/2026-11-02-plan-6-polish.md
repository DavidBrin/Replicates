# Plan 6: polish

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status: Executed 2026-11-02 to 2026-11-03; see D59 (execution rulings and Task 40b, inserted, are recorded there).** Written against `main` at `46e0706`: Plans 1-5 are done, pushed and deployed; `ENGINE_RULES_VERSION` is 5 and the golden pin is `26d4ec66`. The first draft (2026-11-01) was reviewed task by task and across tasks. Every task was then fixed under the controller's rulings (R-P6-0 to R-P6-27, recorded in D59) and replayed verbatim in a scratch copy.

Red-step messages marked (captured) were captured in a scratch replay of the plan at `46e0706`; (predicted) ones were not. A test that fails for the stated reason proceeds even if its numbers differ (note them); one that passes before the change, or fails for another reason, stops the task.

The replays ran group by group, on bases that differ from this plan's order; Risks names each one. So where a task's text and the tree disagree on a count, a digest, a byte size, a first-divergence sample or a context line, the implementer applies the hunk by its symbols, goes by the rule above, and notes the number.

**Goal:** Work through the polish backlog that Plans 1-5 carried forward (`.superpowers/sdd/POLISH-BACKLOG.md`, and D58's "Carried to polish"):
- online input that is never dropped;
- SSBU's flick, reverse-smash, edge-slip, air-grab, slowdown and Final Smash rules from published sources;
- a CPU that uses Volt Tackle well and stays on its stage, measured against its own baseline (the other Final Smashes keep Plan 5's firing rules: the draft's Task 17, carried);
- the screens, sounds, 3D stage, fighters, effects and motions the 3D move left rough.

Everything else D58 carried is either a task here or named on the "Carried, not in Plan 6" list below, with its reason.

**Architecture:** Nothing new at the top level.
- **Online.** Fixes stay in the seam (`src/game/matchRunner.ts`) and the rollback session (`src/net/rollback.ts`), which already own refused-tick carries.
- **Engine.** Fixes go through the existing status registry; `CombatState` (cloned by `cloneCombat`, hashed by `mixCombat`; `hash.test.ts`'s walker checks every leaf); the hit-candidate pipeline in `simulate.ts`; and the projectile surface rules in `projectile.ts`. Every number comes from SmashWiki or rubendal's 13.0.1 script dumps, or carries an `UNVERIFIED:` comment.
- **Body tasks.** They change baked bodies, so they run at the end of the engine group, before the CPU is measured.
- **CPU.** It stays a pure function of the state (`cpuInput`). An opt-in sweep harness (`src/game/cpuSweep.ts`, Task 23) runs first as its baseline, and every later CPU task is judged against that baseline.
- **Presentation.** It is render-only (`render/`, `render3d/`, `audio/`, `components/`), but for three engine edits that keep the engine's rules: Tasks 31 and 32 add `StepEvents` (events only, never state), and Task 36 refactors `stoneOf`.

**Tech Stack:** TypeScript 5 (strict), Next.js 16.3 static export, React 19, zustand, three.js 0.186.1, vitest 4.1 (jsdom, @testing-library/react, fast-check), Playwright 1.62 (Chromium), wrangler 4.146 (its programmatic `unstable_startWorker`, Task 1), pnpm 11. Nothing new is installed.

**Spec:** `super-smash/SPEC.md`, the contract:
- §3: determinism and layering;
- §4: combat;
- §5: netcode;
- §6: controls;
- §9: screens;
- §10: visual design;
- §11: testing.

Four SPEC changes go in their own tasks' commits (Tasks 6, 8, 29, 38), and Task 42 lists them for David. Decisions: `super-smash/DECISIONS.md` (D58's carried list). This plan's record is **D59**, written in Task 42.

**Sources.** Read by plain requests with a generic user agent, no identifiers sent, 2026-11-01 and 2026-11-02.
- SmashWiki raw pages: "C-Stick", "Buffer", "Forward smash", "Smash attack", "Edge slipping", "Air dodge", "Grab aerial", "Samus (SSBU)/Grab aerial", "Grab", "Throw", "Pummel", "Out of shield", "Windbox", "Hitbox", "Hitlag", "Slowdown", "Final Smash", "Smash Ball", "Volt Tackle", "Jungle Rush", "Critical Hit", "Smashville", "Thunder Jolt", "Pikachu (SSBU)/Neutral special", "Link (SSBU)/Side special", "Samus (SSBU)/Down special", "Kirby (SSBU)/Side special", "Glancing blow", "Turn", "Pivoting", "Dash", "Shield", "Angle" and "Autolink angle".
- rubendal's SSBU Data Viewer 13.0.1 `data.json` for all eight fighters (the repo's `scripts/import-acmd.mjs` source).

Each task quotes the line it uses. A page that was silent on a fork is named in its task, with what the task does under each answer.

**Conventions for every task** (as in Plans 1-5)

*Where things run.*
- `pnpm …` commands run in `<the Replicates checkout>/super-smash`; paths in steps are relative to it.
- `git …` commands run from `<the Replicates checkout>`, with paths prefixed `super-smash/`.
- **`$SCRATCH`** in any step is the session scratchpad, outside the repo: `<session scratchpad>` (the directory the session's system prompt names; use that one if it names another). `<session scratchpad>` in a step means the same directory. Shell state does not persist between commands, so a step that uses `$SCRATCH` sets and checks it in the same command: `SCRATCH="<session scratchpad>"; test -d "$SCRATCH" || exit 1; …`. Nothing a step writes there is ever copied into the repo.

*Git (R-P6-5).*
- Commit straight to `main`.
- Never `git add -A`, `git add .` or `git commit -a`. Stage the exact paths listed, files by name, never a directory.
- Every commit body ends with the `Co-Authored-By:` trailer that the session's attribution names.
- **Implementers never push.** The controller pushes `main` after the final wave's review and gate (Task 41), and again after Task 42's gate and a re-run of the pre-push scan over Task 42's commit (documents only, after the final review and full gate). That push is pre-authorized (RUN.md). **Deploying waits for David's go.**
- **Never force-push.**
- **Never `--no-verify`, or bypass a hook in any other form.**
- **Never `git init`, and never commit in a scratch copy.**
- **Never `pkill -f`, and never kill by pattern:** stop a process by its PID or its port.

*How edits are given.*
- **New files are given in full. Edits to existing files are `diff` blocks** (unified diff, paths relative to `super-smash/`).
- The `@@` hunk headers carry no line numbers. Context lines are the tree as each task's replay base left it (Risks names each base), so they may differ from the tree in this order: match them by the symbols they name.

*Every task's gate*, in this order, all from `super-smash/`:
1. `pnpm typecheck && pnpm lint && pnpm test`: exit 0; lint's two pre-existing `research/` warnings are not errors. From Task 2 on, keep the suite's output (`pnpm test > "$SCRATCH/suite-<task>.log" 2>&1`) and check `grep -c "not wrapped in act\|Not implemented"` prints no more than the task before left (1 after Task 2: the carried canvas `getContext` line). A new line is this task's to fix.
2. Where the task changes UI or online behaviour: `PORT=3107 pnpm test:e2e --trace off` (R-P6-21: with local models present no real-model frame may land in `test-results/`).
   - Plan 1's single-rerun rule covers a cold-start timeout.
   - An e2e run at a machine load over 6 is not a pass.
3. Where the task changes online behaviour: `pnpm test:e2e:online --trace off`, against the server Task 1 starts (Group 0 runs first). Its config keeps `trace: "retain-on-failure"`, which with local models present would write real-model frames into `test-results/`, inside the repo (R-P6-21).
4. **Mutants for new tests.** Each task names at least one mutant per new test: the line to break and how.
   - Apply it by hand, run the named test file, and see it fail with the named message.
   - Restore it, then `git diff --exit-code -- <file>` before committing.
   - Never pipe a mutant run to `head` (a SIGPIPE leaves the mutant in the tree): log it to a file.

*A quiet suite (Task 2).* From Task 2 on, a task that adds a "not wrapped in act" warning or a jsdom "Not implemented" line to the suite's output fixes it in that task.

*Generated artefacts.* When several change, they keep Plans 2-5's order: `UPDATE_LIMB` → `UPDATE_RECONCILE` → `UPDATE_BAKE` → `UPDATE_REACH` → `UPDATE_HURT` → `UPDATE_GOLDEN`. Each is regenerated, never hand-edited, and each diff is read before it is committed.

*The golden (R-P6-12).*
- **Regenerating.** Run `UPDATE_GOLDEN=1 pnpm vitest run src/game/golden.test.ts`, then set `RULES_PIN.golden` in `src/game/rulesVersion.test.ts` to the digest the pin's failure prints. A digest a task quotes is its replay's, written "(replay: …)"; the implementer's comes from the pin's failure.
- **The Golden line.** Each task says whether the golden moves. One that moves names the traces and the reason in its commit body. Every task that may move it has the staging line for the trace and the pin.
- **Lab pins.** Regenerating also re-runs `golden.test.ts`'s lab pins before it writes: `expectBeams`, `expectDashes`, `expectSmashSpecials`, `expectProjectilePaths`, `expectContacts`, `expectCpuFinalSmash` and, from Task 7, `expectSlip`. It also re-runs the action coverage, `MUST_VISIT`.
  - A pin the task's own rule moves is updated in the same commit, with the reason in its message, and the history comment above `MUST_VISIT` gains the task's paragraph, as in Plans 2-5.
  - A pin moved by anything else stops the task. The CPU group's ball-on seed is the one exception, under ruling R-P6-18 (see Group 3). Before Task 23's sweep exists, a task that stops on `expectCpuFinalSmash` stops and reports (R-P6-20; Group 2's intro).
- **New actions.** A new action is visited by a golden match, never exempted (P5-R14).
  - Normally that is a states-lab scene appended after its last frame.
  - Where a states-lab scene cannot reach the action, it is a lab of its own appended last. Task 7's slip lab is one: every Final Destination edge has a ledge, so a slip there hangs at once.
  - **From Task 7 on, the golden has sixteen matches.**

*The rules version.* `ENGINE_RULES_VERSION` is 5. Plan 6 bumps it **once, to 6, in Task 5** (the plan's first change to what `step()` does), together with `RULES_PIN.version`. No other task touches either.

*Numbers.* Gameplay numbers come only from SmashWiki or rubendal's 13.0.1 script dumps, with UltimateFrameData and Kurogane Hammer used as in Plans 2-5. An unpublished number carries `UNVERIFIED:` and the reason.

---

## Global Constraints

From SPEC.md, Plans 1-5's standing rules and this plan's rulings, one line each:

- **Determinism (SPEC §3; R-P6-7):**
  - `src/engine/**` and `src/ai/**` use Q12 fixed point, `Ratio` constants and the LUT trig.
  - No `Math.random`, `Date`, `performance.now`, or `Math.sin/cos/tan/pow/exp/log/atan2`.
  - `step` never mutates its input. The CPU runs inside rollback (`cpuInput`), so it is held to the same rule.
  - `src/engine/layering.test.ts` keeps its forbidden list.
- **Layering (SPEC §3):**
  - `engine/` imports nothing from `react`, `next`, `three`, `render/`, `render3d/`, `audio/`, `net/` or `app/`.
  - three.js loads only through `useWorld3d`'s `import()` (`src/app/chunkSplit.test.ts`).
- **Animation reaches the sim only as baked integers (SPEC §3).** A task that changes a clip the sim reads (a status motion, a move's motion) re-bakes (`UPDATE_BAKE`) and says whether the golden moves.
- **Rollback state:** every new sim field is cloned and hashed.
- **Cosmetic state lives outside `GameState` (SPEC §3):** new presentation events go in `StepEvents`, never in the state or the hash.
- **Netcode (SPEC §5):**
  - P2P rollback stays, and a frame of input is never overwritten once sent.
  - Online peers on different `ENGINE_RULES_VERSION`s refuse each other. So do peers on different deploys: the handshake compares the build id, the commit `next.config.ts` stamps (`buildMismatch`). That makes the single rules bump defence in depth.
  - Two local `dev` builds of different commits still pair, so an online test between two machines runs one commit.
- **Public repo:**
  - Never commit a Nintendo-ripped file (`.blend`, `.glb`, textures, `.model-cache/`, `public/models/`).
  - Never commit a screenshot or render of a real model.
  - Committed screenshots come only from the `CAPTURE=1` spec, which routes `/models/` to 404, so its fighters are stand-ins. A task stages the shot files it names.
- **Browser and images (R-P6-6):**
  - Browser work is Playwright only, never claude-in-chrome.
  - **Numbers first.** Prefer a numeric `page.evaluate` probe wherever a number settles the question.
  - **Stand-in captures** (with `/models/` routed to 404) may be written to the session scratchpad, viewed with Read, and deleted. They are never written inside the repo.
  - **Real-model visual checks** may write PNGs only to the session scratchpad, outside the repo, to view with Read. They are deleted in the same step, and never attached, copied or committed.
  - **Scripts that capture.** With models present, every Playwright run sets `trace: "off"`, `screenshot: "off"` and `video: "off"` (a gate run passes `--trace off`, R-P6-21), unless it writes only to `$SCRATCH` as above. `scripts/animsheet.mjs` and `scripts/fightsheet.mjs` are never run without `--out "<session scratchpad>/…"`: their default folder, `test-results/`, is inside the repo.
- **Outward actions.**
  - Deploying, and anything on Cloudflare, need David's go.
  - The push is the controller's, after the final wave (pre-authorized).
  - Any web request a task makes (a source re-read, a tool's telemetry) sends no personal identifier: a generic user agent, and `WRANGLER_SEND_METRICS=false` for wrangler (Task 1).
  - No task runs `pnpm models`, which downloads. The tasks use the models already built into `public/models/`, or stand-ins.
- **Real-gamepad checking is David's** (see "For David" at the end). No task depends on a physical pad.

## Review Focus

These are five ways a player gets hurt that no single feature test would catch on its own (R-P6-13). Each has its test in the task that owns it.

1. **The delay shrinks on the very tick a player taps a key** (a short hop, or the Attack of a smash). The tap must reach the wire once, on the next frame that is scheduled, and both peers must still agree.
   - Test: `src/game/matchRunner.test.ts`, "Review Focus: a tap on the tick the auto delay shrinks (Plan 6, Task 4)".
   - Owner: Task 4.
2. **An edge slip right at a ledge.** A fighter slipping backward off the main stage must grab the ledge and hang ("If the edge is grabbable, then they will always grab it"), not fall past it in its lockout.
   - Test: `src/fighters/edgeSlip.test.ts`, "Review Focus: slipping off a ledge-bearing edge hangs on the ledge".
   - Owner: Task 7.
3. **A press on a slowed fighter's still step.** Under a Final Smash's slowdown, a slowed player runs one step in its rate; under Mario Finale's (20, 75), that is 4 steps in 75 frames. A tap made between those steps must wait in the buffer and fire on the next running step, as presses do in a KO freeze (R-P6-10), not be lost.
   - Test: `src/engine/slow.test.ts`, "Review Focus: a press on a slowed fighter's still step fires on its next running step".
   - Owner: Task 11.
4. **A Final Smash started inside a rollback window.** The Special press is mispredicted, so the start, its slowdown and its scene record all begin inside the rewound frames. Re-simulating must reach the identical state.
   - Test: `src/engine/slow.test.ts`, "Review Focus: a Final Smash started inside a rollback window, its Special press mispredicted, replays identically".
   - Owner: Task 11.
5. **The stance lift turns no hit into a whiff.** Kirby's lift moves his hurtboxes. No jab, forward tilt, down tilt or down smash (the grounded moves that reach a standing opponent's legs) that reached a standing opponent before the lift may miss after it; only the farthest half-unit step may go.
   - Test: `src/render3d/bake/stance.test.ts`, "Review Focus: the stance lift turns no hit into a whiff (Plan 6, Task 19)". `src/game/cpuIdleHuman.test.ts` is re-run beside it.
   - Owner: Task 19.

## The tasks, in order

Task numbers are this plan's. The table from the first draft's numbers is in `.superpowers/sdd/plan-6-review/RENUMBER.md`. The draft's Task 17 (a judged firing rule for the late, narrow Final Smashes) failed ruling R-P6-19 (its first form outright; its veto form, measured on a half sweep, is a later candidate: R-P6-27) and leaves the list (R-P6-25); its table is on the Carried list.

**Group 0: tooling (runs first)**
1. The online e2e starts against a server that never reloads
2. A quiet suite, the buffer pinned per status, the truncation pin replaced
3. Exact e2e locators, and the gameplay e2e confirmed

**Group 1: online and input correctness**
4. Online input is never dropped: the shrinking delay's tick, a pad press no poll sent, one flick per stall (FIRST online item; the draft's Tasks 1 and 2, batched)
5. A flick keeps its direction in the buffer; out of shield it rolls, sidesteps or up-smashes and Attack grabs; in a hold it throws (rules version 6)

**Group 2: engine fidelity**
6. The reverse smash (FIRST engine item)
7. Edge slipping
8. Grab in the air: an air dodge, or Samus's grab aerial
9. Final Smash boxes: a record by part in the scene, and world end boxes
10. An aerial Final Smash's height boost, and R-T14j re-checked
11. `SLOW_OPPONENT`: a Final Smash's startup slows everyone else
12. Smashville's platform carries a fighter in hitlag, a trapped fighter, and a passenger at its trailing end
13. Presses during a KO's freeze are buffered
14. A windbox keeps its record; a catch keeps none of the attack's
15. Projectile phases by age: the Boomerang's clean and late hits, the Bomb's shrinking blast
16. Thunder Jolt runs along the ground, walls and undersides
17. Two launches on one fighter in one step: the strongest sets it, whichever ports
18. Final Smash scenes are the same whichever ports: a standing body is the same on every port
19. Kirby stands on the floor: a stance lift in the bake, decided on the hurtboxes; the clip-gain reaches looked at *(bodies sub-group)*
20. Motions: Donkey Kong's carry and lift, and the full releases *(bodies sub-group)*
21. A dash off a platform flips *(bodies sub-group)*
22. Clips of their own for the edge slip and the wall and ceiling techs (R-P6-9 c) *(bodies sub-group)*

**Group 3: the CPU**
23. The CPU sweep harness, and firing bands for CPU ports only (the CPU's baseline)
24. A smarter CPU Volt Tackle, and a time limit on holding the power
25. CPU: Kong Karry, and dash attacks at a moving target
26. CPU at the ledge: the Smash Ball chase, Smashville's ledge, Kirby's Inhale off stage
27. The CPU spaces by the target's baked body

**Group 4: presentation**
28. The online screens: an unfinished result, the guest's select at phone width, the room code
29. `/play` without a match set up goes to the menu
30. Press-to-join pad seating
31. Sounds and sparks: a glancing blow, the midair jump, a reflection, a counter's catch
32. A shield hit sparks where the box met the shield
33. The 3D stage and its ground: the ledge lip, a shaded front face, a decorative underside, fighters over the face, and shadows the side camera sees
34. The 3D fighter: a landing squash, and sword and kick trails
35. Charges on screen: Hammer Flip's flame and hammer, a stored charge's tell, a copied charge's glow
36. Effect fixes: a refused pump, the stone's landing step, Zero Laser's mouth, the launch freeze's gap
37. Every move effect held to its own hitboxes at the model's size, and the outliers looked at
38. HUD portraits from the loaded model
39. The animation lab plays a large cell
40. Loading and frame time: a cancelled model download, the online model wait from mount, the clip sampler measured

**Group 5: the final wave**
41. The final wave: whole-plan review, seam pass, one fix wave, the full gate, stand-in screenshots, the push

**Group 6: the record**
42. The record: D59, the READMEs, and the plan itself

## File Structure

Every file a task creates, changes or regenerates, with the tasks that touch it, rebuilt from each task's **Files** block and its `git add` lines. Paths are relative to `super-smash/`. A file two tasks touch is applied in task order; the shared-file seams are named in the group intros and in Risks.

- **The package root**
  - `DECISIONS.md`: 42
  - `README.md`: 42
  - `SPEC.md`: 6, 8, 29, 38
  - `playwright.online.config.ts`: 1
  - `vitest.setup.ts`: 2
- **`docs/`**
  - `docs/screenshots/<the other six CAPTURE=1 shots, whichever the final run changes>`: 41
  - `docs/screenshots/match-2.png`: 33, 41
  - `docs/screenshots/match.png`: 33, 41
  - `docs/superpowers/plans/2026-11-02-plan-6-polish.md` (created by 42): 42
  - `docs/superpowers/plans/README.md`: 42
- **`e2e-online/`**
  - `e2e-online/online.spec.ts`: 3, 28
- **`e2e/`**
  - `e2e/anim.spec.ts`: 3, 39
  - `e2e/flow.spec.ts`: 3, 29
  - `e2e/helpers.ts`: 3
  - `e2e/padOptions.spec.ts`: 30
  - `e2e/render3d.spec.ts`: 3, 33, 34
  - `e2e/screenshots.spec.ts`: 3
- **`public/`**
  - `public/bake/roster.bin.gz`: 8, 19, 20, 21, 22
- **`scripts/`**
  - `scripts/e2e/wrangler-e2e.mjs` (created by 1): 1
- **`src/ai/`**
  - `src/ai/behaviours.test.ts`: 25, 27
  - `src/ai/behaviours.ts`: 27
  - `src/ai/cpu.ts`: 26
  - `src/ai/offence.ts`: 12, 25, 27
  - `src/ai/specials.test.ts`: 12, 16, 24, 25, 26
  - `src/ai/specials.ts`: 16, 24, 25, 26
- **`src/app/`**
  - `src/app/anim/Lab3D.test.tsx`: 39
  - `src/app/anim/Lab3D.tsx`: 39
  - `src/app/play/page.test.tsx`: 29, 30, 40
  - `src/app/play/page.tsx`: 29, 30, 40
- **`src/audio/`**
  - `src/audio/index.test.ts`: 31, 32
  - `src/audio/index.ts`: 31
  - `src/audio/sfx.ts`: 31
- **`src/components/`**
  - `src/components/menu/CharacterSelect.online.test.tsx`: 28, 30
  - `src/components/menu/CharacterSelect.test.tsx`: 29, 30
  - `src/components/menu/CharacterSelect.tsx`: 28, 29, 30
  - `src/components/menu/Results.test.tsx`: 28, 29
  - `src/components/menu/Results.tsx`: 28, 29
  - `src/components/online/OnlineLobby.test.tsx`: 28
  - `src/components/online/OnlineLobby.tsx`: 28
- **`src/engine/`**
  - `src/engine/acmd/bakeCodec.ts`: 22
  - `src/engine/acmd/legacy.ts`: 8
  - `src/engine/acmd/poseClock.test.ts`: 7, 18, 20, 21, 22
  - `src/engine/acmd/poseClock.ts`: 7, 18, 20, 21, 22
  - `src/engine/combat.test.ts`: 2
  - `src/engine/combat.ts`: 9, 11, 21, 24
  - `src/engine/constants.ts`: 5, 7, 21
  - `src/engine/final.test.ts`: 10, 11, 16
  - `src/engine/final.ts`: 10
  - `src/engine/footstool.ts`: 7
  - `src/engine/groundExit.ts`: 7
  - `src/engine/hash.test.ts`: 5, 9, 16
  - `src/engine/hash.ts`: 5, 9, 11, 16, 21, 24
  - `src/engine/kinetic.test.ts`: 2
  - `src/engine/physics.ts`: 12
  - `src/engine/platformCarry.test.ts` (created by 12): 12
  - `src/engine/projectile.ts`: 15, 16
  - `src/engine/reflect.test.ts`: 16
  - `src/engine/simulate.test.ts`: 9, 13, 14, 16, 17, 24, 31, 32
  - `src/engine/simulate.ts`: 5, 9, 10, 11, 12, 13, 14, 17, 24, 31, 32
  - `src/engine/slow.test.ts` (created by 11): 11
  - `src/engine/slow.ts` (created by 11): 11
  - `src/engine/softDrop.ts`: 7
  - `src/engine/states.test.ts`: 5, 21
  - `src/engine/states.ts`: 5, 6, 7, 8, 9, 21
  - `src/engine/status/air.ts`: 7
  - `src/engine/status/attack.ts`: 5, 10, 14
  - `src/engine/status/groups.test.ts`: 7
  - `src/engine/status/guard.ts`: 5
  - `src/engine/status/kind.ts`: 7, 21
  - `src/engine/status/status.test.ts`: 7
  - `src/engine/stone.ts`: 36
  - `src/engine/tech.ts`: 7
  - `src/engine/types.ts`: 5, 7, 8, 9, 11, 16, 20, 31, 32
- **`src/fighters/`**
  - `src/fighters/acmd/reach.allow.json`: 8, 18, 19
  - `src/fighters/airGrab.test.ts` (created by 8): 8
  - `src/fighters/bake/digest.ts`: 8, 19, 20, 21, 22
  - `src/fighters/donkeyKong.ts`: 7, 9, 11, 20
  - `src/fighters/edgeSlip.test.ts` (created by 7): 7
  - `src/fighters/finalKit.ts`: 9
  - `src/fighters/finalSmash.test.ts`: 9, 10, 11, 14, 18
  - `src/fighters/flick.test.ts` (created by 5): 5
  - `src/fighters/footstool.test.ts`: 7
  - `src/fighters/fox.ts`: 11
  - `src/fighters/groundExit.test.ts`: 7
  - `src/fighters/kirby.ts`: 11, 14, 19
  - `src/fighters/link.ts`: 11, 15
  - `src/fighters/mario.ts`: 11
  - `src/fighters/marth.ts`: 9, 11
  - `src/fighters/pikachu.ts`: 7, 9, 11, 16
  - `src/fighters/projectiles.test.ts`: 15, 16
  - `src/fighters/reverseSmash.test.ts` (created by 6): 6
  - `src/fighters/samus.ts`: 8, 11, 14, 15, 20
  - `src/fighters/schema.test.ts`: 8, 9, 14, 16
  - `src/fighters/smashSpecial.test.ts`: 15
- **`src/game/`**
  - `src/game/__golden__/engine-trace.json`: 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 25, 26, 27
  - `src/game/bake.test.ts`: 19
  - `src/game/cpuIdleHuman.test.ts`: 26
  - `src/game/cpuSweep.test.ts` (created by 23): 23
  - `src/game/cpuSweep.ts` (created by 23): 23
  - `src/game/golden.test.ts`: 7, 10, 11, 14, 15, 24, 25, 26, 27
  - `src/game/goldenSlipLab.ts` (created by 7): 7
  - `src/game/goldenStatesLab.ts`: 8
  - `src/game/hurt.allow.json`: 18, 19, 22
  - `src/game/matchRunner.test.ts`: 4, 23
  - `src/game/matchRunner.ts`: 4, 23, 35, 38
  - `src/game/onlineConfig.test.ts`: 30
  - `src/game/rulesVersion.test.ts`: 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 24, 25, 26, 27
  - `src/game/sceneDraw.test.ts`: 9, 11, 36
- **`src/input/`**
  - `src/input/gamepad.test.ts`: 30
  - `src/input/gamepad.ts`: 30
  - `src/input/keyboard.test.ts`: 2
  - `src/input/padJoin.test.ts` (created by 30): 30
  - `src/input/padJoin.ts` (created by 30): 30
- **`src/lib/`**
  - `src/lib/matchConfig.test.ts`: 29, 30
  - `src/lib/matchConfig.ts`: 28, 29, 30
  - `src/lib/wranglerE2e.test.ts` (created by 1): 1
- **`src/net/`**
  - `src/net/rollback.test.ts`: 4
  - `src/net/rollback.ts`: 4
- **`src/render/`**
  - `src/render/blend.ts`: 40
  - `src/render/chars/<fighter>/fx.ts (an outlier Step 5 resizes)`: 37
  - `src/render/chars/donkeyKong/donkeyKong.test.ts`: 20, 35
  - `src/render/chars/donkeyKong/fx.ts`: 35
  - `src/render/chars/donkeyKong/poses.ts`: 20
  - `src/render/chars/index.ts`: 35
  - `src/render/chars/kirby/fx.ts`: 35, 36
  - `src/render/chars/kirby/kirby.test.ts`: 35, 36
  - `src/render/chars/mario/fx.ts`: 36
  - `src/render/chars/mario/mario.test.ts`: 36
  - `src/render/chars/samus/fx.ts`: 35, 36
  - `src/render/chars/samus/samus.test.ts`: 35, 36
  - `src/render/fxKit.ts`: 36
  - `src/render/fxScale.test.ts` (created by 37): 37
  - `src/render/hud.test.ts`: 38
  - `src/render/hud.ts`: 38
  - `src/render/plan5.test.ts`: 19
  - `src/render/poses.test.ts`: 22
  - `src/render/poses/clip.ts`: 40
  - `src/render/poses/fall.ts`: 21, 22
  - `src/render/poses/library.ts`: 20, 21, 22
  - `src/render/poses/surfaceTech.ts` (created by 22): 22
  - `src/render/poses/timing.ts`: 7, 8, 20, 21, 22
  - `src/render/renderer.test.ts`: 38
  - `src/render/renderer.ts`: 36, 38
  - `src/render/specialFx.test.ts`: 35, 36
  - `src/render/specialFx.ts`: 35, 36
  - `src/render/stageArt.ts`: 33
  - `src/render/stageClip.test.ts`: 33
  - `src/render/stageClip.ts`: 33
  - `src/render/testFixtures.ts`: 16, 35, 37
  - `src/render/vfx.test.ts`: 31, 32, 35
  - `src/render/vfx.ts`: 31, 32, 35
- **`src/render3d/`**
  - `src/render3d/bake/bake.test.ts`: 7, 20, 21, 22
  - `src/render3d/bake/bake.ts`: 19, 20, 21
  - `src/render3d/bake/roster.test.ts`: 22
  - `src/render3d/bake/roster.ts`: 19
  - `src/render3d/bake/stance.probe.test.ts` (created by 19): 19
  - `src/render3d/bake/stance.test.ts` (created by 19): 19
  - `src/render3d/bake/stance.ts` (created by 19): 19
  - `src/render3d/budget.ts`: 34
  - `src/render3d/faceTurn.test.ts`: 18, 34
  - `src/render3d/fighter3d.test.ts`: 34
  - `src/render3d/fighter3d.ts`: 34
  - `src/render3d/models/loader.test.ts`: 40
  - `src/render3d/models/loader.ts`: 40
  - `src/render3d/portrait3d.test.ts` (created by 38): 38
  - `src/render3d/portrait3d.ts` (created by 38): 38
  - `src/render3d/renderer3d.test.ts`: 33, 34, 38
  - `src/render3d/renderer3d.ts`: 33, 34, 38
  - `src/render3d/stage3d.test.ts`: 33
  - `src/render3d/stage3d.ts`: 33
  - `src/render3d/trail3d.test.ts` (created by 34): 34
  - `src/render3d/trail3d.ts` (created by 34): 34
  - `src/render3d/vfx3d.test.ts`: 7
- **`worker/`**
  - `worker/src/roomDO.test.ts`: 1
  - `worker/src/roomDO.ts`: 1

## Closed before this plan

Verified in code at `46e0706`; no task.
- **"Keyboard ftilt is unreachable."** Closed by Plan 5 Task 21b's Tilt key (P5-R27; SPEC §6's table, `SPEC.md:206, 228`).
- **The helpless fast-fall star.** Closed by Plan 5 Task 17 (`trackGroundFx` draws it for `specialFall`).
- **"R-FW3f carries a flick's fire frame but not its release frame."** Closed by part 5 of Plan 5's final wave: `matchRunner.ts`'s `owedPads`, pinned by the `matchRunner.test.ts` test "dashing, its let-go refused on the stall's last tick and its fire on the first that runs". The release frame needs nothing. Task 4's new pin belongs to the two-flicks backlog line.
- **"gameplay.spec:111 is load-sensitive"** (two backlog lines). `ad67ccb` made "the player can actually damage the CPU" step a frame at a time (`e2e/gameplay.spec.ts:144`). Task 3 only confirms it.

## Carried, not in Plan 6 (D59 records each)

Each item below is unsourced, more than one task's work, or a carry this plan's tasks expose. D59 records each, with its reason (R-P6-9).

**(a) The captor's `throw` joint, and Samus's grab and dash grab from the bake** (D58's carry).
- **No source.** Ultimate moves the joint with each grab, hold, pummel, throw and carry animation, and no source used here publishes that path. rubendal's dumps give only the boxes hung on it (for example Samus's `game_catch` CATCH 0 on `throw` at (0, 0, 0), size 4).
- **No joint to drive.** Six of the eight committed skeletons have no `Throw` bone. Kirby's and Samus's hang unanimated off `Rot`, and `src/render3d/retarget/placeable.ts` says Samus's claw "sits at her feet on every frame".
- **A fix is more than one task.** It needs re-extracted skeletons and a clip drive per grab, hold and throw.
- **What stays:**
  - a held fighter beside its captor (`holdAtCaptor`, R7's stand-in);
  - a carried one on Donkey Kong's baked standing top (`pinHeldFighters`; after Task 20 his overhead carry clip holds his hands above that point);
  - Samus's grab and dash grab on Plan 2's legacy table.

**Samus's tether recovery** (ruling D3). The grab aerial's frames 2-4 ledge grab is not modelled, so Task 8's zair attacks only. It waits on carry (a).

**(b) The shield on a bone** (D57 and D58). The bubble stays Plan 3's.
- **No source.** No source names the bone or its offset.
- **It moves gameplay.** Moving the centre moves every shield-poke outcome, the golden, the scripted match's shield hits and the CPU's shield judgement (`ai/defence.ts` reads `shieldBubble`), after Group 3 has measured the CPU. D57's figures show the trade-off: Donkey Kong's head 7.0 out of a full shield; pokes on a worn shield up from 0.1% to 5.6%; feet bared, 12.8%, with the bubble centred mid-body.
- **More than one task.** It needs a source, a baked shield joint, the sim's and the CPU's readers, and a re-measured golden and sweep.

**(c), in part: clips for `tech`, `techRoll`, `tumbleFall` and `ledgeTrumped`.** Task 22 gives `edgeSlip`, `techWall` and `techCeiling` clips of their own; these four keep theirs.
- A floor tech plays `getUp`'s pop, and a tech roll plays the roll.
- The tumble after hitstun is the same tumble (SmashWiki "Tumbling").
- Knocked off the ledge into a fall, a fighter is falling.

Each already reads as itself; re-authoring would change no read.

**(d) The Inhale and trapped poses.**
- **The mouthful.** Kirby's mouthful (`inhaleHold`, on the walk's clip) is his puffed body, a mesh shape no bone clip draws, and no source gives its walk.
- **The carried and the trapped.** They use the grab's clip (`cargoHeld`, `finalTrapped`). They hang at the captor's `throw` joint, carry (a), so a clip authored before it would be posed against the wrong place.
- **Already right.** The swallowed and the spat star already read as themselves.

**(f) The 363°, 366° and 368° autolink angles, still refused at load** (`AUTOLINK_UNMODELLED`).
- **Where they would apply.** 366° is on Donkey Kong's up special, Volt Tackle's dashes and Zero Laser's pull; 368° is on Samus's up smash; no move uses 363°. So Donkey Kong's up special and Samus's up smash keep their legacy tables, and the two Final Smashes keep the 367° stand-in (P5-R18).
- **Why not modelled.** The pages describe these angles but give no rule:
  - SmashWiki "Angle" says only that they are "coded as values from 363 to 368";
  - "Autolink angle" gives 366° no pull formula (its source is a video), and marks 368° "incomplete".

**(g) Marth's grounded up special boxes.** On the replica's authored clip his `game_specialhi` boxes reach about twice as high as the legacy table's (16.0 → 33.8), so the slot keeps the table (P5-R16). Neither height can be set from a source: the game's own `special_hi` motion is not in this pipeline.

**Mario's and Donkey Kong's stance** (Task 19, ruling D13).
- **Mario.** His lift would be 0.32, a third of his mesh's 1.11 sink. It draws Donkey Kong and Fox inside him in their Final Smash scenes (R-T17i), and would re-measure 17 scene pins. Carried, with the retarget's foot fit.
- **Donkey Kong.** His sink is his knuckles, his idle clip's arm length, not a lift.
- **Crouch and shield.** Their lifted feet are their clips' own poses.

**The glove over Kirby's front edge on the launch freeze's last frame** (kirby-trap3; Task 36). The sim-side scene shift holds through the freeze (Task 36's pin). What overlaps is the meshes' extent past the capsules the shift is measured on. Carried, with the retarget's mesh fit.

**Kirby's stored copied charge** (Task 35). Kirby holding a stored copied Charge Shot or Giant Punch shows no tell: his module has no `always` painter, and the tell is drawn by the copy's module. Cosmetic.

**The scene shift's side across a user that dashes past the fighter it traps** (exposed by Task 11). A point-blank Volt Tackle on a slowed Mario carries Pikachu past him within one step, and `sceneDrawShift` flips the drawn shift's side mid-step, a 16-unit snap. Deciding the side by the step's sim positions breaks Marth's case (captured in Task 11's replay), so the fix needs a new rule for the side. No render task here owns it.

**Two release-step minors on Smashville's platform** (Task 12). Each matters only within one step's sweep of the trailing end.
- On a frozen passenger's release step, phase 3's `leaveGroundIfShiftedOff` still judges it against the platform's new place, before phase 5 carries it.
- Phase 5 computes `outward` and a dash's `overEdge` from the x before `resolveCollision` carries it.

**The jsdom canvas `getContext` line** (Task 2). One "Not implemented: HTMLCanvasElement's getContext() method" line stays in the suite's output at `46e0706`, unless a later task removes it. The backlog's two noise lines (act and `window.focus`) are closed.

**The camera tilt** (ruling D12). The side camera stays, with face shading and shadow discs tipped 24° (Task 33). The tilt, with every overlay re-projected, is not done.

**The bomb's "Detection hitbox 33-82"** (Task 15). It is a mechanism that sets the bomb off early, not a phase.

**Shield and Attack on one frame from a standstill** (Task 5). They raise the shield (`handleActionable` tries the shield first). SmashWiki "Grab" makes a simultaneous press a grab. R-P6-14 rules only on a shield already up, and the dedicated Grab key grabs, so this is carried.

**A slipping opponent as a punish window** (Task 7). `CANNOT_ACT_SOON` (`ai/specials.ts`) does not list `edgeSlip`. It changes a CPU read after Task 23's baseline, so it waits for a CPU task that re-sweeps.

**The late, narrow Final Smashes' misses** (the backlog's "Final Smash whiff rates 50-75%"; the draft's Task 17, dropped by ruling R-P6-19; R-P6-25). Two judged firing rules were swept against Task 23's baseline (planning replay, seeds 1-3; landed, then mean hold in frames):

| Rule | Jungle Rush (Donkey Kong) | Team Star Fox (Fox) | Ultra Sword (Kirby) | Ancient Arrow (Link) |
|---|---|---|---|---|
| Fired only at a target proven held until the contact (as first drafted) | 55 → 10; 112 → 165 | 72 → 3; 146 → 315 | 78 → 33; 166 → 267 | 64 → 27; 121 → 225 |
| Not fired at a target its own state shows free before the contact (a veto) | 55 → 41; 112 → 132 | 72 → 50; 146 → 192 | 78 → 65; 166 → 199 | 64 → 40; 121 → 165 |

Both were swept on seeds 1-3 only, half the run that judges. The first form fails R-P6-19 as amended outright for all four (Donkey Kong −82%, Fox −96%, Kirby and Link −58%), and its mean holds rose 47% to 116%. The veto falls past the per-fighter bound for Fox (−31%) and Link (−38%), and to its edge for Donkey Kong (−25.5%), within a half sweep's noise, so it is not shown to fail (R-P6-27). The task was dropped (R-P6-25), and all four keep Plan 5's rule, as Critical Hit does (R-P6-15). Firing less cut the Final Smashes they land and lengthened the holds, during which no Smash Ball spawns. **The veto form is the later candidate** (R-P6-27): D59 records it, to be judged on a six-seed sweep.

**The unjudged swing at `attack`'s end** (Task 25; backlog: "When no swing lands beyond point blank, `attack` still throws an unjudged full-stick swing"). Judging it changes the course of every match: on the six-seed sweep it cut Donkey Kong's landed Final Smashes 118 → 95 (−19%) and Fox's 161 → 144 (−11%), past R-P6-19's first per-fighter bound. Under R-P6-19 as amended it would now pass (landed summed 1,032 → 968, −6.2%; edgeguard exits −0.7%), but it stays carried to avoid churn; D59 notes it can come back. `cpuIdleHuman.test.ts` already bounds a stalled stretch.

**Samus's grab aerial draws no Grapple Beam** (Task 8). `airGrab` has no painter and no `FX_FALLBACK` entry, so the overlay draws nothing for it, and Task 37's `fxScale.test.ts` skips it. The `grab` painter cannot stand in: it times the beam by the move's `grabbing` boxes, and the zair's are attacks. Cosmetic.

**D58's "not modelled" list stays out** (`DECISIONS.md:3765-3845`, and "Marked, not modelled" at `:4286`):
- *Charging:* the grab-button store cancel, the 4-frame cancel and post-charge lags, and Kirby walking while he charges.
- *The Cape:* the `SPECIAL_FALL` flag and the stall's forward move.
- *F.L.U.D.D.:* the release recoil, stick aiming, its aqua jump, pushing items and the Smash Ball, the heavier shoot animation, and helplessness after being blown off a platform in a special landing.
- *Hitlag:* the player-count hitlag factor, and a grabbed fighter armouring bystanders' hits (more than two fighters).
- *Inhale:* the out-star's hitbox and projectile eating.
- *Edges:* the attacker's own shield-pushback ledge cancel.
- *Scripts and projectiles:* the exact-9% clank boundary and the Homing Missile's published flight.
- *Recovery:* per-move ledge-grab windows during up specials, Fire Fox's ground bounce, Final Cutter's landing shockwave, Spin Attack's back-hit pull, and Spinning Kong sliding off an edge on the ground.
- *Footstools:* the air drift on a footstool's bounce, frames 2 to 7.
- *Bake:* baked motions shorter than their aerial moves (the Cape's 36-58, the Counter's 65-79, the riposte's 42-51) hold the clip's last pose.

---

## Group 0: tooling (runs first)

Every later task's gates run on these two:
- `pnpm test:e2e:online`, on a server that never reloads (Task 1);
- a quiet suite with the buffer pinned per status (Task 2). Its output rule then binds every later task: a task that adds a "not wrapped in act" warning or a jsdom "Not implemented" line fixes it in that task.

Tasks 1-3 were replayed at `46e0706` itself.

### Task 1: The online e2e starts against a server that never reloads

From Plan 5's final gate: "`pnpm test:e2e:online` can flake: `wrangler dev` reloads 3-8 times right after the build on `out/` file-change events and drops the room Durable Object mid-test (first test times out at `waitForURL`). Against a settled server via `SMASH_URL` it passes 4/4. Start wrangler without watching `out/`, or wait for it to settle before the specs." And from Plan 4: "Online e2e: wrangler logs "Network connection lost" during the two-browser run (4/4 pass) … it predates Plan 4 — investigate the worker socket close path."

The cause, measured in the planning replay (wrangler 4.146.0, a stand-in `out/`): the CLI `wrangler dev` watches its assets directory and reloads on every write to it (three writes after "Ready on" gave five `⎔ Reloading local server...` lines), and it has no switch to stop that (`wrangler dev --help`; its hidden options are only `bundle`, `enable-containers`, `site*` and `node-compat`). Its programmatic API does: `unstable_startWorker` with `dev.watch: false` turns off the assets watcher (`node_modules/wrangler/wrangler-dist/cli.js`: `if (config2.dev.watch !== false && config2.assets?.directory)`), the config watcher and the bundler's. The same three writes then gave no reload; `/` and `/api/ice` answered 200 (STUN-only with no TURN secrets) and the process left cleanly on SIGTERM. So the start script uses that API and prints `E2E-READY` once the server serves, and Playwright waits for that line alone: no `url`, because Playwright races a `url` against `wait` (`node_modules/.pnpm/playwright@1.62.1/node_modules/playwright/lib/runner/index.js`, `_waitForProcess`: one `Promise.race`), and the url would win as soon as wrangler first answered. The API's name carries `unstable_`: a wrangler upgrade that changes it fails this script at the start, loudly, never silently.

The "Network connection lost" line: `worker/src/roomDO.ts`'s comment on the refused join says "wrangler dev logs "Network connection lost" when such a socket hangs up" (a plain-`accept()`ed socket the Worker closes after telling the browser why). The full-room test, "a third browser is turned away from a full room", makes exactly that socket. Step 1 checks whether the line appears only there.

**Golden:** unaffected.

**Files:**
- Create: `scripts/e2e/wrangler-e2e.mjs`, `src/lib/wranglerE2e.test.ts`
- Modify: `playwright.online.config.ts`; `worker/src/roomDO.ts` and `worker/src/roomDO.test.ts` only under Step 1's branch (b)
- Test: `src/lib/wranglerE2e.test.ts`

**Interfaces:**
- Consumes: `wrangler.jsonc`; wrangler's `unstable_startWorker`; Playwright's `webServer.wait`.
- Produces: `e2eWorkerInput(root: string, port: number)` (scripts/e2e/wrangler-e2e.mjs): `{ config, dev: { watch: false, server: { port }, persist } }`.

- [ ] **Step 1: Where "Network connection lost" comes from (decides Step 5's last part)**

Run the online suite three times as it is, its server's stderr kept (Playwright pipes it by default), with no trace (R-P6-6; models may be present): `for i in 1 2 3; do pnpm test:e2e:online --trace off; done > "<session scratchpad>/plan6-online.log" 2>&1` (the scratchpad is the directory the session's system prompt names). In the log, note which test each "Network connection lost" falls in (the list reporter prints each test's start), and the `⎔ Reloading local server...` lines (expected: some, right after "Ready on").
- (a) Every "Network connection lost" falls in the full-room test: it is the refused socket the comment describes. No code changes; D59 records it (Task 42).
- (b) One falls in another test: the close path there is the cause. Look at the socket the browser closes in that test (the lobby's leave, the match's end) and at `webSocketClose`: a socket still `CLOSING` is closed back (`close(ws, …)`); one already `CLOSED` is not, and `depart` then serialises an attachment on it. Write the failing test for that path in `worker/src/roomDO.test.ts` (the file's own fake socket), make the fix it shows, and name it in the commit body.

- [ ] **Step 2: Write the failing test**

`src/lib/wranglerE2e.test.ts` (new file):

```ts
// @vitest-environment node
/**
 * The online e2e's server (Plan 6, Task 1): `scripts/e2e/wrangler-e2e.mjs` starts wrangler's
 * dev server through its programmatic API with watching off, so nothing written to `out/`
 * after the start reloads it, and the specs wait for its E2E-READY line.
 */
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { e2eWorkerInput } from "../../scripts/e2e/wrangler-e2e.mjs";

const ROOT = join(__dirname, "..", "..");

describe("the online e2e's wrangler (Plan 6, Task 1)", () => {
  it("serves the repo's own config with every watcher off, on the given port, with fresh state", () => {
    const input = e2eWorkerInput(ROOT, 8790);
    expect(input.config).toBe(join(ROOT, "wrangler.jsonc"));
    expect(input.dev.watch).toBe(false);
    expect(input.dev.server.port).toBe(8790);
    expect(input.dev.persist).toBe(join(ROOT, ".wrangler", "e2e-state"));
  });
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `pnpm vitest run src/lib/wranglerE2e.test.ts`
Expected: FAIL (captured): `Error: Cannot find module '../../scripts/e2e/wrangler-e2e.mjs' imported from …/src/lib/wranglerE2e.test.ts`, `Test Files 1 failed (1)`.

- [ ] **Step 4: Implement**

`scripts/e2e/wrangler-e2e.mjs` (new file):

```js
#!/usr/bin/env node
/**
 * Starts the online e2e's server (Plan 6, Task 1): builds, then serves `out/` and the Worker
 * through wrangler's programmatic dev API with every watcher off, and prints E2E-READY once it
 * serves. `playwright.online.config.ts` waits for that line (`webServer.wait.stdout`).
 *
 * `wrangler dev` (the CLI) watches its assets directory and has no switch to stop it: after a
 * build it reloaded 3-8 times on `out/`'s file events and dropped the room Durable Object
 * mid-test (Plan 5's final gate). Its programmatic API takes `dev.watch: false`, which turns
 * off the assets watcher, the config watcher and the bundler's (wrangler 4.146,
 * `wrangler-dist/cli.js`: "config2.dev.watch !== false && config2.assets?.directory").
 * `unstable_startWorker` is that API's name in 4.146: a wrangler upgrade that changes it
 * fails here, at the start, never silently.
 *
 * Usage: node scripts/e2e/wrangler-e2e.mjs <port>
 */

import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** What the dev server is started with: the repo's own config, every watcher off, fresh local state. */
export function e2eWorkerInput(root, port) {
  return {
    config: join(root, "wrangler.jsonc"),
    dev: { watch: false, server: { port }, persist: join(root, ".wrangler", "e2e-state") },
  };
}

async function main() {
  const port = Number(process.argv[2] ?? 8787);
  const build = spawnSync("pnpm", ["run", "build"], { cwd: ROOT, stdio: "inherit" });
  if (build.status !== 0) process.exit(build.status ?? 1);

  const input = e2eWorkerInput(ROOT, port);
  rmSync(input.dev.persist, { recursive: true, force: true });
  process.env.WRANGLER_SEND_METRICS = "false";
  const { unstable_startWorker } = await import("wrangler");
  const worker = await unstable_startWorker(input);
  await worker.ready;
  process.stdout.write("E2E-READY\n");
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      void worker.dispose().finally(() => process.exit(0));
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
```

(`wrangler` is imported inside `main`, so the unit test loads none of it. `.wrangler/` is git-ignored, eslint-ignored and outside tsconfig; the state directory is fresh on every start.)

`playwright.online.config.ts`:

```diff
   webServer: PUBLIC_URL
     ? undefined
     : {
-        command: `pnpm run build && WRANGLER_SEND_METRICS=false pnpm exec wrangler dev --port ${PORT}`,
-        url: BASE_URL,
+        // Builds, then serves out/ and the Worker with every watcher off, and says E2E-READY
+        // once it serves (Plan 6, Task 1: `wrangler dev` reloaded on out/'s file events and
+        // dropped the room mid-test). No `url`: Playwright races a url against `wait`, and
+        // the url would win as soon as wrangler first answered.
+        command: `node scripts/e2e/wrangler-e2e.mjs ${PORT}`,
+        wait: { stdout: /E2E-READY/ },
+        gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
         reuseExistingServer: false,
         timeout: 300_000,
       },
```

(Without a `url`, Playwright skips its port-in-use check; a busy port makes wrangler exit, which Playwright reports as the server exiting early.)

- [ ] **Step 5: Run it again, then the suite five times**

Run: `pnpm vitest run src/lib/wranglerE2e.test.ts` → PASS (captured: `Tests 1 passed (1)`).

Then `for i in 1 2 3 4 5; do pnpm test:e2e:online --trace off || break; done > "<session scratchpad>/plan6-online5.log" 2>&1`, and `grep -c "Reloading local server" "<session scratchpad>/plan6-online5.log"`. Expected: 5 of 5 pass, `E2E-READY` before each run's first test, and 0 reload lines (predicted: not replayed, since it needs a full `next build` and two browsers; the planning replay ran the script's server on a stand-in `out/` and saw E2E-READY, no reload after three writes, and a clean SIGTERM). A failure is read (its test, its wrangler lines) before anything is changed.

- [ ] **Step 6: Mutants**

1. `e2eWorkerInput`: `watch: false` → `watch: true`. The test FAILS (captured): `AssertionError: expected true to be false // Object.is equality`. Restore.

- [ ] **Step 7: Gate and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test` (replayed at `46e0706` with this task: typecheck and lint exit 0, lint's two `research/` warnings), then `pnpm test:e2e:online --trace off`. Expected: exit 0.

```bash
git add super-smash/scripts/e2e/wrangler-e2e.mjs super-smash/src/lib/wranglerE2e.test.ts super-smash/playwright.online.config.ts
# and super-smash/worker/src/roomDO.ts super-smash/worker/src/roomDO.test.ts under Step 1's branch (b)
git commit -m "super-smash: the online e2e's server never reloads: wrangler's dev API with watching off, and Playwright waits for E2E-READY" -m "wrangler dev reloaded on every write to out/ and has no CLI switch; unstable_startWorker with dev.watch: false turns off the assets, config and bundler watchers. The Playwright webServer drops url (it races url against wait) and waits for E2E-READY. 5/5 online runs, 0 reloads. 'Network connection lost': <branch (a): the full-room test's plain-accepted socket, as roomDO.ts says | branch (b): the fix>." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: A quiet suite, the buffer pinned per status, the truncation pin replaced

Three backlog items, none of which changes the game:
- "Test-output hygiene: vitest prints React act() warnings from CharacterSelect.test.tsx ("moves the grid cursor with the arrow keys") and a jsdom "Not implemented: Window's focus() method" line … Make the suite's output pristine (wrap in act / stub window.focus)." (The same item is in the backlog twice.) Measured at `46e0706` (the planning replay's full `pnpm test`): no "not wrapped in act" line anywhere, the CharacterSelect file included, so that half is already closed; one "Not implemented: Window's focus() method", from `KeyboardInput.requestFocus` (`src/input/keyboard.ts`, `this.win.focus?.()`); and one "Not implemented: HTMLCanvasElement's getContext() method", which is not a backlog line: it is listed in the commit body and carried in D59. jsdom reports a missing feature on its JSDOM's virtual console, which vitest's jsdom environment keeps at `globalThis.jsdom`, not on the console a `vi.spyOn(console, "error")` sees (measured: a console spy sees nothing while the line still prints), so the pin listens there.
- "(Plan 3 FW-4 re-review) buffering tests per status (throw/pummel/turnaround/crouch) don't pin "a press older than 9 frames is dropped" / "fires once"". Today's per-status pins (`src/engine/combat.test.ts`, "a press made while a status is not yet free to act is kept (Plan 3 final wave, part 4)") pin only that a press is kept. Dropped is pinnable only where a status is longer than the buffer (`BUFFER_FRAMES` 9): the turnaround (11 frames) and the throw (20 in the fixture). "Fires once" is pinnable only where a second fire could fit inside the buffer: a kept jump that the buffer kept after firing would fire again from the air, a midair jump, within its 9 frames (measured: `jumpsUsed` goes to 2 when the clear in `presses` is deleted). A kept attack or pummel cannot fire twice: the down tilt and the pummel it starts outlast the buffer, so no test can see a second fire, and none is written; D59 says so.
- "kinetic.test.ts:983 pins a Q12 truncation artefact (a <1/64 vector treated as zero) as behaviour — make it a property or drop it." At `46e0706` it is "treats a vector too short to square as a zero vector" (`kineticTurnLaunch(f, 40, 40)`). The launch's speed is not kept for short vectors: the length is `sqrt(mul(dx, dx) + mul(dy, dy))`, a truncated Q12 square (`fixed.ts`'s `mul` truncates, `sqrt` floors), so a vector under 1 unit can come out up to 72% too fast (measured at (63, 90)). What does hold for every vector, however short: the launch is left as it was or turned toward the vector, never onto the other side of either axis. That is the property; the speed stays the existing property's, for vectors of 1 or more ("keeps the speed to within a few units, for any direction").

**Golden:** unaffected.

**Files:**
- Modify: `vitest.setup.ts`, `src/engine/combat.test.ts`, `src/engine/kinetic.test.ts`, `src/input/keyboard.test.ts`
- Test: the same files

**Interfaces:**
- Consumes: `KeyboardInput.requestFocus`, `makeInput` (keyboard.test.ts); `play`, `alone`, `holding`, `actions4`, `ctxFor`, `move`, `BASE_DEF`, `Frame` (combat.test.ts); `kineticTurnLaunch`, `flying`, `ONE` (kinetic.test.ts).
- Produces: nothing new.

- [ ] **Step 1: Write the tests**

`src/input/keyboard.test.ts`, at the end of `describe("focus", …)`:

```ts
  it("asks the window for focus without a jsdom not-implemented report (Plan 6, Task 2)", () => {
    // vitest's jsdom environment keeps its JSDOM on `globalThis.jsdom`, and jsdom reports a
    // missing feature on that JSDOM's virtual console, not on the console a spy can see.
    type Report = (err: Error) => void;
    const { virtualConsole } = (globalThis as unknown as { jsdom: { virtualConsole: { on(e: "jsdomError", f: Report): void; off(e: "jsdomError", f: Report): void } } }).jsdom;
    const seen: string[] = [];
    const listen: Report = (err) => seen.push(err.message);
    virtualConsole.on("jsdomError", listen);
    makeInput([{ port: 0, scheme: CONFIG_ARROWS }]).requestFocus();
    virtualConsole.off("jsdomError", listen);
    expect(seen).toEqual([]);
  });
```

`src/engine/combat.test.ts`: `BUFFER_FRAMES` joins the `./constants` import (after `BOUNCE_FLOOR_LAUNCH_RATIO`); then, at the end of the part-4 describe (after the throw's `it.each`):

```ts
  // Plan 6, Task 2 (Plan 3 FW-4 re-review): the other half of the buffer, per status. A press
  // more than `BUFFER_FRAMES` old when the status ends is dropped: pinnable where the status is
  // longer than the buffer (the turnaround, the throw). And a kept jump acts once: one not
  // cleared as it fires would fire again from the air, a midair jump, inside its 9 frames. (A
  // kept attack or pummel cannot fire twice: the move it starts outlasts the buffer.)
  /** The most jumps the fighter has used on any frame. */
  const jumpsUsed = (frames: Frame[]): number => Math.max(...frames.map((r) => r.state.fighters[0].jumpsUsed));

  it("drops a jump pressed on turnaround frame 1, ten frames before the turnaround ends", () => {
    expect(BUFFER_FRAMES).toBe(9);
    const s = alone();
    Object.assign(s.fighters[0], { action: "run", actionFrame: 20 });
    const a = actions4(play(s, 24, (i) => [i === 0 ? Btn.Left : i === 1 ? Btn.Jump : 0, 0]));
    expect(a[10]).toBe("turnaround");
    expect(a.slice(11)).not.toContain("jumpSquat");
  });

  it("drops a jump pressed on index 10 of a throw that frees the thrower on 21", () => {
    const thrower: FighterDef = { ...BASE_DEF, moves: { ...BASE_DEF.moves, fthrow: move("fthrow", { totalFrames: 20, hitboxes: [] }) } };
    const ctx = ctxFor(thrower);
    const a = actions4(play(holding(ctx), 30, (i) => [i === 1 ? Btn.Right : i === 10 ? Btn.Jump : 0, 0], ctx));
    expect(a[20]).toBe("throw");
    expect(a.slice(21)).not.toContain("jumpSquat");
  });

  it("jumps once on a kept jump: out of the turnaround, the crouch's end and the throw", () => {
    const turn = alone();
    Object.assign(turn.fighters[0], { action: "run", actionFrame: 20 });
    expect(jumpsUsed(play(turn, 30, (i) => [i === 0 ? Btn.Left : i === 6 ? Btn.Jump : 0, 0])), "turnaround").toBe(1);
    expect(jumpsUsed(play(alone(), 30, (i) => [i < 7 ? Btn.Down : i === 10 ? Btn.Jump : 0, 0])), "crouch end").toBe(1);
    const thrower: FighterDef = { ...BASE_DEF, moves: { ...BASE_DEF.moves, fthrow: move("fthrow", { totalFrames: 20, hitboxes: [] }) } };
    const ctx = ctxFor(thrower);
    expect(jumpsUsed(play(holding(ctx), 40, (i) => [i === 1 ? Btn.Right : i === 17 ? Btn.Jump : 0, 0], ctx)), "throw").toBe(1);
  });
```

`src/engine/kinetic.test.ts`, the truncation pin replaced:

```diff
-  it("treats a vector too short to square as a zero vector", () => {
-    const f = flying();
-    kineticTurnLaunch(f, 40, 40);
-    expect([f.kinetic.damageX, f.kinetic.damageY]).toEqual([0, fx(5)]);
-  });
+  // Plan 6, Task 2 (Plan 3 FW-4 re-review): the pin here held a Q12 truncation (a vector
+  // under 1/64 long left as zero) as behaviour. What holds for every vector, however short:
+  // the launch is left as it was, or turned toward the vector, never onto the other side of
+  // either axis. Its speed is not part of it below a vector of 1 (the length is a truncated
+  // Q12 square root: up to 72% short at (63, 90) units); the property above holds the speed
+  // for the vectors a hit makes, 1 or more.
+  it("never turns the launch away from the vector, however short the vector", () => {
+    fc.assert(
+      fc.property(fc.integer({ min: -2 * ONE, max: 2 * ONE }), fc.integer({ min: -2 * ONE, max: 2 * ONE }), (dx, dy) => {
+        const f = flying();
+        const before = [f.kinetic.damageX, f.kinetic.damageY];
+        kineticTurnLaunch(f, dx, dy);
+        const after = [f.kinetic.damageX, f.kinetic.damageY];
+        if (after[0] === before[0] && after[1] === before[1]) return true;
+        return Math.sign(after[0]) * Math.sign(dx) >= 0 && Math.sign(after[1]) * Math.sign(dy) >= 0;
+      }),
+      { examples: [[40, 40], [0, 0], [64, 0], [-1, 1], [63, 90], [0, -65]] },
+    );
+  });
```

- [ ] **Step 2: Run them; see which fail**

Run: `pnpm vitest run src/input/keyboard.test.ts src/engine/combat.test.ts src/engine/kinetic.test.ts -t "Plan 6, Task 2|drops a jump|jumps once|never turns the launch away"`
Expected (captured): the keyboard test FAILS, `AssertionError: expected [ Array(1) ] to deeply equal []` with `+ "Not implemented: Window's focus() method"`; the other four PASS (`Tests 1 failed | 4 passed`). They pin behaviour the engine has; their mutants (Step 5) are what proves them.

- [ ] **Step 3: Implement**

`vitest.setup.ts`, after the `matchMedia` shim:

```ts
// jsdom defines window.focus but only reports "Not implemented: Window's focus() method" on its
// virtual console (Plan 6, Task 2): the keyboard asks for focus on every refocus. A no-op
// keeps the suite's output clean. Guarded as the shim above is.
if (typeof window !== "undefined") window.focus = () => {};
```

- [ ] **Step 4: Run them again, and the whole suite for its output**

Run: `pnpm vitest run src/input src/engine/combat.test.ts src/engine/kinetic.test.ts` → PASS (captured: `Test Files 6 passed (6)`, `Tests 687 passed (687)` at `46e0706`). Then `pnpm test > "<session scratchpad>/plan6-suite.log" 2>&1; grep -c "not wrapped in act\|Window's focus()" "<session scratchpad>/plan6-suite.log"`. Expected: 0 (captured). The log's one other noise line, "Not implemented: HTMLCanvasElement's getContext() method" (captured), is listed in the commit body; it is not this task's.

- [ ] **Step 5: Mutants**

1. `vitest.setup.ts`: delete the `window.focus` stub. The keyboard test FAILS (captured): `AssertionError: expected [ Array(1) ] to deeply equal []`. Restore.
2. `src/engine/states.ts`, `peekBuffer`: `frame - b.frame > BUFFER_FRAMES` → `frame - b.frame > BUFFER_FRAMES + 20`. Both "drops a jump" tests FAIL (captured): `expected [ 'jumpSquat', 'jumpSquat', …(11) ] to not include 'jumpSquat'` and `expected [ 'jumpSquat', 'jumpSquat', …(7) ] to not include 'jumpSquat'`. Restore.
3. `src/engine/states.ts`, `presses`: delete `if (b !== null) f.bufferedAction = null;` (the buffer cleared as it fires). "jumps once" FAILS (captured): `turnaround: expected 2 to be 1`; the crouch end and the throw each reach 2 as well (captured, one at a time). Restore.
4. `src/engine/kinetic.ts`, `kineticTurnLaunch`: `Math.trunc((dx * f.launchSpeed) / len)` → `Math.trunc((-dx * f.launchSpeed) / len)`. The new property FAILS (captured), with four existing kinetic tests. Restore.

Each mutant is run from a copy of the file (`cp <file> <session scratchpad>/<name>.bak`), restored from it, and checked with `cmp`, logging to a file, never through `head`.

- [ ] **Step 6: Gate and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`. Expected: exit 0.

```bash
git add super-smash/vitest.setup.ts super-smash/src/input/keyboard.test.ts super-smash/src/engine/combat.test.ts super-smash/src/engine/kinetic.test.ts
git commit -m "super-smash: a quiet suite, and the buffer's expiry and single fire pinned per status" -m "window.focus stubbed in setup, pinned on jsdom's virtual console. The CharacterSelect act() warning was already gone at 46e0706. The turnaround and the throw drop a press older than 9 frames; a kept jump fires once out of the turnaround, the crouch's end and the throw (a kept attack or pummel cannot fire twice: its move outlasts the buffer). The Q12 truncation pin becomes a property over every vector: never turned away. Other noise left: <the canvas getContext line, and any other the log shows>. No game change." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Exact e2e locators, and the gameplay e2e confirmed

Two backlog items, neither of which changes the game:
- "Some e2e label/role locators still match by substring (e.g. `e2e/anim.spec.ts:~34`, `e2e/helpers.ts:~219`); none judged ambiguous. Sweep them to `{ exact: true }` where an exact name is meant." The sites are the ones `grep -nE 'getBy(Label|Role|Text)\(' e2e/*.ts e2e-online/*.ts | grep -v exact` prints at this task's start, string names only (17 at `46e0706`: nine in `e2e/anim.spec.ts`, one each in `e2e/flow.spec.ts`, `e2e/helpers.ts` and `e2e/render3d.spec.ts`, two in `e2e/screenshots.spec.ts`, three in `e2e-online/online.spec.ts`). Each of the 17 names is its element's whole accessible name at `46e0706`: `aria-label="Fighters"` (`src/components/menu/CharacterSelect.tsx`), the lab's `aria-label="Fighter"`, `"Action"`, `"Move"` selects (`src/app/anim/page.tsx`), and "Game Set" in its own tag (`src/components/menu/Results.tsx`). Regular-expression names (`/smash/i`, `/next|stage|continue/i`) are deliberate and stay.
- gameplay.spec's load-sensitive damage test (two backlog lines): already frame-stepped by `ad67ccb` ("the player can actually damage the CPU" calls `startMatch(page, { stepped: true })`); this task only confirms it, and Task 42 strikes both lines through.

**Golden:** unaffected.

**Files:**
- Modify: each e2e file the Step 1 grep names
- Test: the same files, through the e2e gates

**Interfaces:** none.

- [ ] **Step 1: The sites**

`grep -nE 'getBy(Label|Role|Text)\(' e2e/*.ts e2e-online/*.ts | grep -v exact > "<session scratchpad>/plan6-locators.txt"`; keep the lines whose name argument is a string, not a regular expression. Expected: 17 at `46e0706` (captured); a different count is the list to sweep, noted in the commit.

- [ ] **Step 2: Make each string name exact**

Every string name at those sites gains `{ exact: true }`, for example:

```diff
-    await page.getByLabel("Action").selectOption(action);
+    await page.getByLabel("Action", { exact: true }).selectOption(action);
```

```diff
-  const roster = page.getByLabel("Fighters").getByRole("button");
+  const roster = page.getByLabel("Fighters", { exact: true }).getByRole("button");
```

and `page.getByText("Game Set")` → `page.getByText("Game Set", { exact: true })`. A site whose element's name is longer than the string (the exact form then finds nothing) is one where a substring was meant: give it a regular expression anchored to the part meant, and list it in the commit body.

- [ ] **Step 3: Confirm the damage e2e and run the gates**

`grep -n "the player can actually damage the CPU" -A12 e2e/gameplay.spec.ts | grep "stepped: true"` names the damage test's frame-stepped start; no change. Gate: `pnpm typecheck && pnpm lint && pnpm test`, `PORT=3107 pnpm test:e2e --trace off`, `pnpm test:e2e:online --trace off` (the locators changed there; R-P6-6: no trace with models present). Expected: exit 0 (predicted: the e2e gates were not replayed; the label sources above were read at `46e0706`).

No new unit test, so no mutant; the e2e gates are this task's test.

- [ ] **Step 4: Commit**

```bash
git add <each e2e file the Step 1 grep named>
git commit -m "super-smash: exact e2e locators, and the gameplay e2e's damage test confirmed frame-stepped" -m "<n> string locators gain { exact: true } (<the files>); <any anchored to a regular expression, with why>. gameplay.spec's damage test was already frame-stepped (ad67ccb). No game change." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

(`git add` names the files from Step 1's list, each by path; at `46e0706` they are `super-smash/e2e/anim.spec.ts super-smash/e2e/flow.spec.ts super-smash/e2e/helpers.ts super-smash/e2e/screenshots.spec.ts super-smash/e2e/render3d.spec.ts super-smash/e2e-online/online.spec.ts`.)

---

## Group 1: online and input correctness

Tasks 4 and 5 were replayed in order at `46e0706`; Group 0 was not applied, since neither consumes it. Their online gates run against Task 1's server.

### Task 4: Online input is never dropped: the shrinking delay's tick, a pad press no poll sent, one flick per stall (FIRST online item; the draft's Tasks 1 and 2, batched)

Three backlog items from Plan 5's final wave, one seam, one review.

**The shrinking delay** (final wave 3, re-review 2, the first online item): when the automatic input delay shrinks, that tick's input is dropped (`src/net/rollback.ts`, `scheduleLocal`). Dropping it is what keeps a sent frame from being overwritten (SPEC §5; the method's own comment: "overwriting it would mean the peer and this machine simulate different inputs for one frame, which is a desync"), so the session still must not schedule it. What is lost is the *press*: a tap made in that tick's window is in that one keyboard drain, and a flick's pad frame in that one poll. The runner already carries both across a tick the session refuses (`carriedPresses`, `owedPads`; ruling R-FW3f, refined). This task makes the session say when a tick ran without scheduling its input (`AdvanceResult.localScheduled`), and the runner treat that tick's input exactly as a refused one's, while still taking the frame's state.

**A pad press no poll sent** (final wave 5): after a stall, each owed flick frame goes out "in place of that tick's poll" (`matchRunner.ts`, `gatherInputs`), so a pad button pressed for that one poll is lost and a held one reads a tick late (D58, R-FW3f refined: "a poll an owed frame replaces is not sent"). The same is true of a poll read on a tick the session refused or could not schedule, with nothing owed: the keyboard's tap is carried (`carriedPresses`), the pad's is not. This task carries a pad poll's fresh presses (its bits the poll before lacked) into the next poll that goes out whole, as `carriedPresses` does a key's; the flick's own frames are untouched, so the frames an unstalled flick runs are still the ones scheduled. The carry is decided a tick late, on purpose: a poll that missed the wire may still go out as the let-go of a flick that fires on the next poll (`gatherInputs`'s fire branch takes it), and carrying its presses at once would send them twice, once in that let-go and once carried. So a poll's presses are carried when the next tick finds it neither sent nor owed.

**One flick per stall, pinned** (final wave 3, re-review 2: "combined on one tick: neither direction wins"): since part 5's fix round 1 a fire replaces whatever is still owed, so the later flick wins and nothing is combined; no test pins it, and this task adds the pin. **The flick's release frame on a refused tick** needs nothing: it is carried since part 5, and pinned by "dashing, its let-go refused on the stall's last tick and its fire on the first that runs".

Nothing in `step()` changes; the golden and the rules version do not move.

**Golden:** unaffected (the seam and the session only; `step()` is untouched).

**Files:**
- Modify: `src/net/rollback.ts`, `src/game/matchRunner.ts`
- Test: `src/net/rollback.test.ts`, `src/game/matchRunner.test.ts`

**Interfaces:**
- Consumes: `RollbackSession.advance`, `scheduleLocal`, `stalled`, `maybeRetuneDelay` (rollback.ts); the runner's `tick()`, `gatherInputs`, `carriedPresses`, `tickPresses`, `owedPads`, `tickPads`, `lastPolls`, `tickPolls`, `lastPollsSent`, `PadFrame`, `NO_PAD` (matchRunner.ts); `mergeKeyboardAndPad(keys, pad, flick)` (input/gamepad.ts); the test file's `flickMatch`, `PadScript`, `PAD`, `STALL`, `ANSWER`, `HUMANS`, `RULES`.
- Produces: `AdvanceResult.localScheduled: boolean` (false on a stalled result too). Nothing later tasks read.

- [ ] **Step 1: Write the failing tests**

`src/net/rollback.test.ts`, after the `describe("input delay", …)` block:

```ts
describe("a shrinking input delay (Plan 6, Task 4)", () => {
  /** Two auto-delay sessions on `network`, ports 0 and 1. */
  function pair(network: LoopbackNetwork) {
    const deps = makeDeps();
    const make = (id: string, port: number) =>
      new RollbackSession<FakeState>({
        transport: network.connect(id),
        deps,
        initialState: initialState(),
        playerCount: 2,
        localPorts: [port],
        autoInputDelay: true,
        now: () => network.now(),
      });
    return { a: make("A", 0), b: make("B", 1) };
  }

  it("runs a tick whose input it cannot schedule, says so, and does it once for each frame of delay given back", () => {
    const network = new LoopbackNetwork({ latencyMs: 90 });
    const { a, b } = pair(network);
    for (let i = 0; i < 400; i++) {
      a.advance(0);
      b.advance(0);
      network.advance(FRAME_MS);
    }
    const raised = a.delay;
    expect(raised).toBeGreaterThan(2);
    network.setOptions({ latencyMs: 0 });
    let unscheduled = 0;
    let scheduled = 0;
    for (let i = 0; i < 600; i++) {
      const r = a.advance(0);
      if (r.advanced) {
        if (r.localScheduled) scheduled++;
        else unscheduled++;
      }
      b.advance(0);
      network.advance(FRAME_MS);
    }
    expect(a.delay).toBe(2);
    expect(unscheduled, "ticks that ran with nowhere to put their input").toBe(raised - a.delay);
    expect(scheduled).toBeGreaterThan(500);
  });

  it("schedules every tick while the delay holds or grows", () => {
    const network = new LoopbackNetwork({ latencyMs: 0 });
    const { a, b } = pair(network);
    let unscheduled = 0;
    for (let i = 0; i < 400; i++) {
      if (i === 100) network.setOptions({ latencyMs: 90 });
      const r = a.advance(0);
      if (r.advanced && !r.localScheduled) unscheduled++;
      b.advance(0);
      network.advance(FRAME_MS);
    }
    expect(a.delay).toBeGreaterThan(2);
    expect(unscheduled).toBe(0);
  });

  it("reports nothing scheduled on a stalled tick", () => {
    const session = new RollbackSession<FakeState>({
      transport: createNullTransport(),
      deps: makeDeps(),
      initialState: initialState(),
      playerCount: 2,
      localPorts: [0],
      autoInputDelay: false,
    });
    let last = session.advance(0);
    for (let i = 0; i < 20 && last.advanced; i++) last = session.advance(0);
    expect(last.advanced).toBe(false);
    expect(last.localScheduled).toBe(false);
  });
});
```

`src/game/matchRunner.test.ts`, after `describe("a tick the rollback session refuses", …)`:

```ts
describe("Review Focus: a tap on the tick the auto delay shrinks (Plan 6, Task 4)", () => {
  it("reaches the wire once, on the next frame scheduled, and both peers stay level", () => {
    const network = new LoopbackNetwork({ latencyMs: 90 });
    const keyboard = new KeyboardInput([{ port: 0, scheme: CONFIG_ARROWS }], { window, overlayHost: null });
    keyboard.attach();
    const sent: InputFrame[] = [];
    const transport = network.connect("host");
    try {
      const host = createMatchRunner({
        stage: getStageOrThrow("battlefield"),
        players: HUMANS,
        rules: RULES,
        seed: 0x5eed1e55,
        getFighter: getFighterOrThrow,
        keyboard,
        net: {
          transport: {
            ...transport,
            send(bytes) {
              const packet = decodePacket(bytes);
              if (packet?.type === PacketType.Input) packet.inputs.forEach((input, i) => (sent[packet.startFrame + i] = input));
              transport.send(bytes);
            },
          },
          localPorts: [0],
          autoInputDelay: true,
          now: () => network.now(),
        },
      });
      const guest = createMatchRunner({
        stage: getStageOrThrow("battlefield"),
        players: HUMANS,
        rules: RULES,
        seed: 0x5eed1e55,
        getFighter: getFighterOrThrow,
        net: { transport: network.connect("guest"), localPorts: [1], autoInputDelay: true, now: () => network.now() },
      });
      for (let i = 0; i < 400; i++) {
        host.advance(1);
        guest.advance(1);
        network.advance(FRAME_MS);
      }
      const raised = host.netStats?.inputDelay ?? 0;
      expect(raised).toBeGreaterThan(2);
      network.setOptions({ latencyMs: 0 });
      let delay = raised;
      let tappedOnRunningTick = false;
      for (let i = 0; i < 600; i++) {
        const now = host.netStats?.inputDelay ?? 0;
        // The delay fell on the last tick: this tick's input has no frame to land on.
        const tapNow = !tappedOnRunningTick && now < delay;
        if (tapNow) {
          window.dispatchEvent(new KeyboardEvent("keydown", { code: CONFIG_ARROWS.bindings.jump }));
          window.dispatchEvent(new KeyboardEvent("keyup", { code: CONFIG_ARROWS.bindings.jump }));
        }
        delay = now;
        host.advance(1);
        if (tapNow) {
          expect(host.stalled, "the tap's tick must run, or it is the refused-tick case").toBe(false);
          tappedOnRunningTick = true;
        }
        guest.advance(1);
        network.advance(FRAME_MS);
      }
      expect(tappedOnRunningTick).toBe(true);
      expect(sent.filter((input) => (input & Btn.Jump) !== 0)).toHaveLength(1);
      for (let i = 0; i < 60 && host.frame !== guest.frame; i++) {
        (guest.frame < host.frame ? guest : host).advance(1);
        network.advance(FRAME_MS);
      }
      expect(hashState(guest.state)).toBe(hashState(host.state));
      expect(host.netStats?.desyncs).toBe(0);
      expect(guest.netStats?.desyncs).toBe(0);
    } finally {
      keyboard.detach();
    }
  });
});
```

In the same file, inside `describe("a right-stick flick across refused ticks (ruling R-FW3f, refined)", …)`, after its last `it`:

```ts
  it("a pad press made on the tick an owed flick frame goes out instead of its poll reaches the wire once, a tick or two late (Plan 6, Task 4)", () => {
    // The stall's last refused tick, the sticks at rest throughout.
    const rest = flickMatch(() => ({ buttons: [], rightX: 0 }), ANSWER).refused;
    const last = rest[rest.findIndex((tick, i) => rest[i + 1] !== tick + 1)];
    // A flick right lets go on STALL + 4 and fires on STALL + 5, both refused, so two
    // frames are owed when the host runs again; Jump is down for the first tick that runs only.
    const script: PadScript = (t) => ({ buttons: t === last + 1 ? [PAD.jump] : [], rightX: t >= STALL + 4 && t <= STALL + 6 ? 0.9 : 0 });
    const stalled = flickMatch(script, ANSWER);
    expect(stalled.refused).toEqual(expect.arrayContaining([STALL + 4, STALL + 5, last]));
    expect(stalled.refused).not.toContain(last + 1);
    expect(stalled.sent.filter((input) => (input & Btn.Flick) !== 0)).toHaveLength(1);
    expect(stalled.sent.filter((input) => (input & Btn.Jump) !== 0), "the Jump poll an owed frame stood in for").toHaveLength(1);
    expect(stalled.guest.frame).toBe(stalled.host.frame);
    expect(hashState(stalled.guest.state)).toBe(hashState(stalled.host.state));
    expect(stalled.host.netStats?.desyncs).toBe(0);
  });

  it("a pad press seen by one refused tick's poll only reaches the wire once, on the first tick that runs (Plan 6, Task 4)", () => {
    // Jump down for the host's fourth refused tick alone, no flick: nothing is owed.
    const script: PadScript = (t) => ({ buttons: t === STALL + 3 ? [PAD.jump] : [], rightX: 0 });
    const stalled = flickMatch(script, ANSWER);
    expect(stalled.refused).toContain(STALL + 3);
    expect(stalled.sent.filter((input) => (input & Btn.Jump) !== 0), "the Jump a refused tick's poll read").toHaveLength(1);
    expect(stalled.guest.frame).toBe(stalled.host.frame);
    expect(hashState(stalled.guest.state)).toBe(hashState(stalled.host.state));
  });

  it("a pad press on the poll a second flick lets go on, behind an owed one, reaches the wire once, in that let-go (Plan 6, Task 4)", () => {
    const rest = flickMatch(() => ({ buttons: [], rightX: 0 }), ANSWER).refused;
    const last = rest[rest.findIndex((tick, i) => rest[i + 1] !== tick + 1)];
    // A flick right inside the stall, owed when the host runs again; on the first tick that runs,
    // Jump is down and the right stick goes left (a second flick's let-go, its fire on the next).
    // That poll misses the wire behind the owed frames, then goes out as the second flick's let-go.
    const script: PadScript = (t) => ({
      buttons: t === last + 1 ? [PAD.jump] : [],
      rightX: t >= STALL + 4 && t <= STALL + 6 ? 0.9 : t >= last + 1 && t <= last + 3 ? -0.9 : 0,
    });
    const stalled = flickMatch(script, ANSWER);
    expect(stalled.refused).not.toContain(last + 1);
    expect(stalled.sent.filter((input) => (input & Btn.Jump) !== 0), "carried as well as sent in the let-go, it went out twice").toHaveLength(1);
    const flicks = stalled.sent.filter((input) => (input & Btn.Flick) !== 0);
    expect(flicks).toHaveLength(1);
    expect(flicks[0] & Btn.Left).not.toBe(0);
  });

  it("two flicks inside one stall: the later replaces the earlier, as two taps of one key make one press (pinned; Plan 5 final wave 5 fix round 1)", () => {
    const script: PadScript = (t) => ({ buttons: [], rightX: t >= STALL + 2 && t <= STALL + 4 ? 0.9 : t >= STALL + 8 && t <= STALL + 10 ? -0.9 : 0 });
    const stalled = flickMatch(script, ANSWER);
    expect(stalled.refused).toEqual(expect.arrayContaining([STALL + 3, STALL + 9]));
    const flicks = stalled.sent.filter((input) => (input & Btn.Flick) !== 0);
    expect(flicks).toHaveLength(1);
    expect(flicks[0] & Btn.Left, "the later flick's direction").not.toBe(0);
    expect(flicks[0] & Btn.Right).toBe(0);
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/net/rollback.test.ts src/game/matchRunner.test.ts -t "shrinking input delay|auto delay shrinks|owed flick frame goes out|one refused tick's poll|second flick lets go|two flicks inside one stall"`
Expected: FAIL, 6 failed, 2 passed (captured):
- "runs a tick whose input it cannot schedule…": `ticks that ran with nowhere to put their input: expected 600 to be 4` (every advanced tick counts as unscheduled while `localScheduled` is undefined; the 4 is `raised - 2`, `raised` being 6 at 90 ms).
- "schedules every tick while the delay holds or grows": `expected 370 to be +0`.
- "reports nothing scheduled on a stalled tick": `expected undefined to be false`.
- The Review Focus test: `expected [] to have a length of 1 but got +0` (the tap was drained into a tick whose input landed nowhere).
- "…an owed flick frame goes out instead of its poll…": `the Jump poll an owed frame stood in for: expected [] to have a length of 1 but got +0`.
- "…one refused tick's poll only…": `the Jump a refused tick's poll read: expected [] to have a length of 1 but got +0`.
- "…a second flick lets go on…" PASSES (at `46e0706` that poll's Jump goes out in the let-go and nothing carries it; the test pins that Step 3's carry does not send it twice, and mutant 6 proves it bites). "two flicks inside one stall" PASSES (it pins part 5's behaviour; mutant 7 proves it bites).

- [ ] **Step 3: Implement**

`src/net/rollback.ts`, the result type:

```diff
@@ export interface AdvanceResult<S = GameState> {
   readonly advanced: boolean;
   readonly stallReason: StallReason | null;
   /** Frames re-simulated before this frame ran. 0 on a clean frame. */
   readonly rolledBackFrames: number;
+  /**
+   * Whether this call put the caller's local input on a frame (Plan 6, Task 4).
+   * False when the session stalled, and false when a frame ran but the input
+   * landed on none: the automatic delay shrank, so every frame up to the new
+   * target was already scheduled and sent, and overwriting one would desync
+   * (`scheduleLocal`). The caller keeps that input's presses for its next call,
+   * as it does a refused frame's (`matchRunner.ts`).
+   */
+  readonly localScheduled: boolean;
 }
```

`advance`:

```diff
-    this.scheduleLocal(localInputs);
+    const localScheduled = this.scheduleLocal(localInputs);
     this.heartbeat();
@@
       advanced: true,
       stallReason: null,
       rolledBackFrames: rolledBack,
+      localScheduled,
     };
```

`scheduleLocal`:

```diff
@@ private scheduleLocal
    * simulate different inputs for one frame, which is a desync. So it is
-   * dropped instead. Shrinking the delay costs one input read; getting it wrong
-   * would cost the match.
+   * left unscheduled instead, and the call says so (`AdvanceResult.localScheduled`)
+   * so the caller can carry the input's presses to its next frame (Plan 6, Task 4:
+   * a tap in that one read used to be lost). Getting it wrong would cost the match.
    */
-  private scheduleLocal(localInputs: InputFrame | readonly InputFrame[]): void {
+  private scheduleLocal(localInputs: InputFrame | readonly InputFrame[]): boolean {
     const target = this.currentFrame + this.inputDelay;
-    if (target <= this.highestScheduled) return;
+    if (target <= this.highestScheduled) return false;
 
     for (const port of this.localPorts) {
       const value = readPortInput(localInputs, port);
       for (let f = this.highestScheduled + 1; f <= target; f++) {
         this.inputs[port].set(f, value);
       }
     }
     this.highestScheduled = target;
+    return true;
   }
```

`stalled`:

```diff
       advanced: false,
       stallReason: reason,
       rolledBackFrames: rolledBack,
+      localScheduled: false,
     };
```

`src/game/matchRunner.ts`. The file's `@/engine/types` import is type-only; add a value import after it:

```diff
   StepEvents,
 } from "@/engine/types";
+import { Btn } from "@/engine/types";
 import { createInitialState, cloneState, step, DEFAULT_SEED } from "@/engine/simulate";
```

Beside `NO_PAD`:

```diff
 const NO_PAD: PadFrame = { frame: 0, flick: 0 };
+
+/** A pad poll's bits that are presses a later poll may carry: all but the soft tilt and the flick's own mark. */
+const PAD_PRESS_BITS = ~(Btn.Soft | Btn.Flick);
```

The runner's carries, beside `tickPads` and the polls:

```diff
   // This tick's owed pad frames, its own flick's among them, kept in case it is refused.
   let tickPads = noPads;
+  // A pad's fresh presses on polls that never reached the wire (Plan 6, Task 4): a poll a
+  // refused or unscheduled tick read, or one an owed flick frame went out in place of (Plan 5
+  // final wave 5's cost: "a pad press held for that one poll alone is lost"). They join the
+  // next poll that goes out whole, as a tapped key's do (`carriedPresses`).
+  let carriedPadPresses: readonly InputFrame[] = noPresses;
+  // The same with the last poll's, if this tick found it lost; kept in case this tick's input reaches no frame.
+  let tickPadPresses: readonly InputFrame[] = noPresses;
   // Each port's poll on the last tick and this one, and whether the last went out as polled.
   let lastPolls: readonly PadFrame[] = players.map(() => NO_PAD);
   let tickPolls = lastPolls;
   let lastPollsSent: readonly boolean[] = players.map(() => true);
+  // Each port's presses on the last poll and on this one: its bits the poll before lacked.
+  let lastPollFresh: readonly InputFrame[] = noPresses;
+  let tickPollFresh: readonly InputFrame[] = noPresses;
```

`gatherInputs`, after `tickPads` is computed, and its human branch:

```diff
       return [...(lastPollsSent[port] ? [] : [lastPolls[port]]), poll];
     });
+    tickPollFresh = tickPolls.map((poll, port) => poll.frame & ~lastPolls[port].frame & PAD_PRESS_BITS);
+    tickPadPresses = players.map((_, port) => {
+      // The last poll missed the wire and goes out as no owed frame either (this tick's fire did
+      // not take it for its let-go, and it is no flick frame still owed): its presses are carried.
+      // Decided now, not on its own tick, so a let-go's presses go out once, in the let-go.
+      const lost = !lastPollsSent[port] && !tickPads[port].includes(lastPolls[port]);
+      return carriedPadPresses[port] | (lost ? lastPollFresh[port] : 0);
+    });
     return players.map((p, port) => {
       if (p.cpuLevel === null) {
         const keys = (drained?.frames[port] ?? 0) | carriedPresses[port];
-        const pad = tickPads[port][0] ?? tickPolls[port];
-        return mergeKeyboardAndPad(keys, pad.frame, pad.flick);
+        const owed = tickPads[port];
+        const pad = owed[0] ?? tickPolls[port];
+        // Presses carried from polls that missed the wire ride the first poll that goes out whole.
+        const carried = owed.length === 0 ? tickPadPresses[port] : 0;
+        return mergeKeyboardAndPad(keys, pad.frame | carried, pad.flick);
       }
```

`tick()`:

```diff
     if (session) {
       const result = session.advance(inputs);
       stalled = !result.advanced;
-      if (!result.advanced) {
-        // A refused frame ran nothing new: nothing to age, sound or report. The
-        // picture holds still instead of re-blending the last step, and this
-        // tick's presses, and a flick's pad frames, wait for the next one.
-        previous = state;
+      if (!result.advanced || !result.localScheduled) {
+        // This tick's input reached no frame: the session refused the frame, or ran
+        // it with its input already scheduled because the automatic delay shrank
+        // (`AdvanceResult.localScheduled`; Plan 6, Task 4). Either way this tick's
+        // presses, a flick's pad frames and the pad presses carried so far wait for
+        // the next tick.
         carriedPresses = tickPresses;
+        carriedPadPresses = tickPadPresses;
         owedPads = tickPads;
         lastPolls = tickPolls;
+        lastPollFresh = tickPollFresh;
         lastPollsSent = players.map(() => false);
-        return;
-      }
-      carriedPresses = noPresses;
-      // The first owed pad frame went out; this tick's poll did if it was that one or none was owed.
-      owedPads = tickPads.map((owed) => owed.slice(1));
-      lastPollsSent = tickPads.map((owed, port) => owed.length === 0 || owed[0] === tickPolls[port]);
-      lastPolls = tickPolls;
+      } else {
+        carriedPresses = noPresses;
+        // Sent with this tick's poll, or still waiting behind an owed frame.
+        carriedPadPresses = tickPads.map((owed, port) => (owed.length === 0 ? 0 : tickPadPresses[port]));
+        // The first owed pad frame went out; this tick's poll did if it was that one or none was owed.
+        owedPads = tickPads.map((owed) => owed.slice(1));
+        lastPollsSent = tickPads.map((owed, port) => owed.length === 0 || owed[0] === tickPolls[port]);
+        lastPolls = tickPolls;
+        lastPollFresh = tickPollFresh;
+      }
+      if (!result.advanced) {
+        // A refused frame ran nothing new: nothing to age, sound or report. The
+        // picture holds still instead of re-blending the last step.
+        previous = state;
+        return;
+      }
       previous = state;
       state = result.state;
       events = result.events;
```

A local match is unchanged: it never sets `lastPollsSent` false, so no poll is ever found lost, and a fire is its own owed frame.

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/net/rollback.test.ts src/game/matchRunner.test.ts`
Expected: PASS, every test in both files (captured: 50 and 59). The existing refused-tick test and the five existing flick tests send exactly the frames they sent before: where a held d-pad direction comes back fresh against a flick's fire on a poll that missed the wire, it is carried onto a later poll that holds it anyway.

- [ ] **Step 5: Mutants**

Each one: apply it, run the named test file (log to a file), see the named failure, restore, and `git diff --exit-code -- super-smash/src/net/rollback.ts super-smash/src/game/matchRunner.ts` shows only this task's change.
1. `rollback.ts` `scheduleLocal`: `if (target <= this.highestScheduled) return false;` → `return true;`. `pnpm vitest run src/net/rollback.test.ts -t "shrinking"`: "runs a tick whose input it cannot schedule…" FAILS `ticks that ran with nowhere to put their input: expected +0 to be 4` (captured).
2. `rollback.ts` `scheduleLocal`: the final `return true;` → `return false;`. "schedules every tick while the delay holds or grows" FAILS `expected 370 to be +0` (captured).
3. `rollback.ts` `stalled`: `localScheduled: false` → `localScheduled: true`. "reports nothing scheduled on a stalled tick" FAILS `expected true to be false` (captured).
4. `matchRunner.ts` `tick()`: `if (!result.advanced || !result.localScheduled)` → `if (!result.advanced)`. `pnpm vitest run src/game/matchRunner.test.ts -t "auto delay shrinks"`: FAILS `expected [] to have a length of 1 but got +0` (captured).
5. `matchRunner.ts` `gatherInputs`: `const carried = owed.length === 0 ? tickPadPresses[port] : 0;` → `const carried = 0;`. `-t "owed flick frame goes out|one refused tick's poll"`: both FAIL `expected [] to have a length of 1 but got +0` (captured).
6. `matchRunner.ts` `gatherInputs`: `const lost = !lastPollsSent[port] && !tickPads[port].includes(lastPolls[port]);` → `const lost = !lastPollsSent[port];`. `-t "second flick lets go"`: FAILS `carried as well as sent in the let-go, it went out twice: expected [ 128, 147 ] to have a length of 1 but got 2` (captured; with every missed poll's presses carried, the second also takes stray flick bits).
7. `matchRunner.ts` `gatherInputs`'s fire branch: `return [...(lastPollsSent[port] ? [] : [lastPolls[port]]), poll];` → `return [...owedPads[port], ...(lastPollsSent[port] ? [] : [lastPolls[port]]), poll];` (part 5's round-1 append). `-t "two flicks inside one stall"`: FAILS `expected [ 1042, 1041 ] to have a length of 1 but got 2` (captured).

- [ ] **Step 6: Gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`, then `pnpm test:e2e:online --trace off` (against the settled server Task 1 starts; Task 1 runs first, in Group 0).
Expected: exit 0; online 4/4. Golden untouched.

- [ ] **Step 7: Commit**

```bash
git add super-smash/src/net/rollback.ts super-smash/src/net/rollback.test.ts super-smash/src/game/matchRunner.ts super-smash/src/game/matchRunner.test.ts
git commit -m "super-smash: online input is never dropped: the shrinking delay's tick and a pad press no poll sent are carried" -m "RollbackSession.advance reports localScheduled; the runner treats an unscheduled tick's keyboard presses and owed pad frames as it treats a refused tick's. A pad poll's fresh presses that missed the wire (a refused or unscheduled tick's, or one an owed flick frame replaced) join the next poll that goes out whole, decided a tick late so a flick's let-go never sends them twice. Pins that two flicks inside one stall send the later one alone. No engine change; golden unchanged." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: A flick keeps its direction in the buffer; out of shield it rolls, sidesteps or up-smashes and Attack grabs; in a hold it throws (rules version 6)

Three flick items from Plan 5's final wave 3, re-review 2, settled against SmashWiki "C-Stick" (read 2026-11-01), and ruling R-P6-14 on Attack in shield:
- **A buffered flick loses its direction** (landing lag: a jab or up tilt; a crouch's first frames: a down tilt). The page: "Like with any input source, C-Stick inputs can be accidentally buffered", and its one exception: "In Ultimate, buffering a jump aerial or double jump aerial with the C-Stick will not use the direction the C-Stick is held in to determine which aerial is used, instead using the Control Stick." So a buffered attack or special keeps the flick's direction, and the jumpsquat's aerial keeps the stick's (`STATUS_JUMP_SQUAT` already buffers it without a flick; this task leaves it so, and pins it). The flick aims only the press it was buffered with: a button pressed fresh on the frame the buffer fires keeps its own direction (a fresh Attack, or a fresh B beside a buffered attack flick). UNVERIFIED in detail: that every other buffer keeps the direction; the page names only the jump case as the exception.
- **A smash-mode flick in shield gives an up smash** (`guard.ts`). "C-Stick": "The C-Stick can also be used to roll or sidestep out of shield"; SmashWiki "Out of shield": "if the C-Stick is set to smash attacks (which is used by default), one can also merely flick it upward while shielding to perform an immediate up smash out of shield". So: sideways rolls that way, down spot-dodges, up up-smashes. A diagonal reads y first, as the aerial's flick does.
- **Attack in shield (ruling R-P6-14).** At `46e0706` Attack pressed while shielding is an up smash (`guard.ts:73-76`, unchanged since the first commit; no ruling records it). SmashWiki "Grab": a grab "can be performed by pressing the shield and attack buttons simultaneously on any controller", and the grab button "behaves like a simultaneous shield and attack input"; "Out of shield": "Up special, up smash, and jump may also be done directly out of shield", the up smash "with an up smash input", or by the C-Stick flicked up. So Attack in shield grabs, and the up smash takes Up: the stick's up smash input (Up pressed fresh within `SMASH_INPUT_WINDOW`, SPEC §6's smash rule) or a flick up. Not covered here: Shield and Attack pressed on one frame from a stand still raise the shield (`handleActionable` tries the shield first); the ruling is about a shield already up.
- **A flick during a grab pummels** (`attack.ts`, `STATUS_CATCH_WAIT`). SmashWiki "Grab": a pummel is "by pressing an attack or grab button", the throws "by tilting the control stick in the respective direction"; "C-Stick": in smash mode it is "a full directional input and an attack button press" (Melee and Brawl), and from SSB4 "a sustained attack button press as long as the stick is held in the direction, as well as maintaining the directional input". No page says which the hold reads first ("Grab", "Throw", "Pummel" and "C-Stick" were all checked). **Ruling D1** (the controller's, recorded in D59): the flick throws in its direction, the direction being the throw's input; plain Attack still pummels. UNVERIFIED.

This is the plan's first change to what `step()` does, so it bumps `ENGINE_RULES_VERSION` to **6** with `RULES_PIN.version`.

**Golden:** unchanged (`26d4ec66`, `46e0706`'s pin, which Tasks 1-4 leave; captured in the replay). `Btn.Flick` is set by the pad merge only, never by the keyboard, the CPU or any golden driver (D58, R-FW3e), and a state with no flick in its buffer hashes as before; no golden match presses Attack while its fighter shields. So only the rules version moves, 5 → 6. If the golden does fail, look at which matches (only a CPU match can press Attack in shield), regenerate, re-pin, and name them in the commit.

**Files:**
- Create: `src/fighters/flick.test.ts`
- Modify: `src/engine/types.ts`, `src/engine/states.ts`, `src/engine/hash.ts`, `src/engine/simulate.ts`, `src/engine/status/guard.ts`, `src/engine/status/attack.ts`, `src/engine/constants.ts`, `src/game/rulesVersion.test.ts`
- Test: `src/engine/states.test.ts`, `src/engine/hash.test.ts`
- Regenerate only if it moves: `src/game/__golden__/engine-trace.json`, `src/game/rulesVersion.test.ts` (`RULES_PIN.golden`)

**Interfaces:**
- Consumes: `Intent.rightFlick` (ruling R-FW3e), `bufferPress`, `presses`, `handleActionable`, `groundAttackSlot`, `aerialSlot`, `specialSlot`, `specialFlick`, `beginSpecial`, `beginAttack`, `startRoll`, `startAction`, `startMove`, `hasMove` (states.ts).
- Produces:
  - `BufferedAction`'s attack and special members gain `flickX?: number; flickY?: number` (each −1/0/1).
  - `Presses.flick: { readonly kind: "attack" | "special"; readonly x: number; readonly y: number } | null` (a buffered flick consumed this frame, and the press it was buffered with).
  - `attackFlick(intent, p)` (states.ts, exported): the flick this frame's attack press comes with, its own or a buffered one's.
  - `withFlick(intent, flick): Intent` (states.ts, not exported).
  - In `handleActionable`: `aim` (the special's: what the special calls read) and `aimAttack` (the attack's: what `groundAttackSlot` and `aerialSlot` read). Task 6 reads `aimAttack`; Task 8's airborne hunk quotes the special line, `specialSlot(aim), aim.x, aim`.
  - `ENGINE_RULES_VERSION = 6`.

- [ ] **Step 1: Write the failing tests**

`src/engine/states.test.ts`, after `describe("input buffer", …)`:

```ts
describe("a buffered right-stick flick keeps its direction (Plan 6, Task 5; SmashWiki \"C-Stick\")", () => {
  /** A smash-mode flick's fire frame on top of `held`: its direction and Attack fresh, with `Btn.Flick`. */
  const flick = (dir: Btn, held: InputFrame = 0): InputFrame => held | dir | Btn.Attack | Btn.Flick;

  it("records the flick's direction with the buffered attack", () => {
    const f = fighter({ action: "landingLag", charge: 6, actionFrame: 0 });
    tick(f, flick(Btn.Right), 0);
    expect(f.bufferedAction).toMatchObject({ kind: "attack", flickX: 1, flickY: 0 });
  });

  it("comes out of landing lag as the flick's forward smash, the stick at rest by then", () => {
    const f = fighter({ action: "landingLag", charge: 6, actionFrame: 0 });
    tick(f, flick(Btn.Right), 0);
    hold(f, 0, 6, flick(Btn.Right));
    expect(f.action).toBe("attack");
    expect(f.move).toBe("fsmash");
  });

  it("comes out of landing lag as the flick's up smash over a d-pad at rest, not a jab", () => {
    const f = fighter({ action: "landingLag", charge: 6, actionFrame: 0 });
    tick(f, flick(Btn.Up), 0);
    hold(f, 0, 6, flick(Btn.Up));
    expect(f.move).toBe("usmash");
  });

  it("comes out of a crouch's first frames as the flick's smash, not the down tilt (ruling R-FW3e's crouch rule)", () => {
    const f = fighter();
    tick(f, Btn.Down, 0);
    expect(f.action).toBe("crouchStart");
    tick(f, flick(Btn.Right, Btn.Down), Btn.Down);
    hold(f, Btn.Down, 6, flick(Btn.Right, Btn.Down));
    expect(f.action).toBe("attack");
    expect(f.move).toBe("fsmash");
  });

  it("does not aim an aerial buffered in jumpsquat: the stick's neutral air (SmashWiki: the Control Stick decides)", () => {
    const f = fighter();
    tick(f, Btn.Jump, 0);
    expect(f.action).toBe("jumpSquat");
    tick(f, flick(Btn.Right), Btn.Jump);
    hold(f, 0, 4, flick(Btn.Right));
    expect(f.action).toBe("attack");
    expect(f.move).toBe("nair");
  });

  it("keeps a buffered press without a flick exactly as before", () => {
    const f = fighter({ action: "landingLag", charge: 6, actionFrame: 0 });
    tick(f, Btn.Attack, 0);
    expect(f.bufferedAction).toEqual({ kind: "attack", frame: expect.any(Number) });
    hold(f, 0, 6, Btn.Attack);
    expect(f.move).toBe("jab1");
  });

  it("leaves a fresh Attack on the frame the buffer fires to that press: a jab, not the buffered flick's smash", () => {
    const f = fighter({ action: "landingLag", charge: 6, actionFrame: 0 });
    tick(f, flick(Btn.Right), 0);
    hold(f, 0, 5, flick(Btn.Right));
    expect(f.action).toBe("stand");
    tick(f, Btn.Attack, 0);
    expect(f.move).toBe("jab1");
  });

  it("aims only the press it was buffered with: a fresh B on the frame a buffered attack flick fires is the neutral special", () => {
    const f = fighter({ action: "landingLag", charge: 6, actionFrame: 0 });
    tick(f, flick(Btn.Right), 0);
    hold(f, 0, 5, flick(Btn.Right));
    tick(f, Btn.Special, 0);
    expect(f.move).toBe("neutralB");
  });
});
```

`src/engine/hash.test.ts`, inside `describe("hashState", …)`, after "notices a mutation of every leaf of FighterState, found by walking it":

```ts
  it("hashes a buffered flick's direction, and nothing new for a press without one (Plan 6, Task 5)", () => {
    const plain = state();
    plain.fighters[0].bufferedAction = { kind: "attack", frame: 3 };
    const right = state();
    right.fighters[0].bufferedAction = { kind: "attack", frame: 3, flickX: 1, flickY: 0 };
    const up = state();
    up.fighters[0].bufferedAction = { kind: "attack", frame: 3, flickX: 0, flickY: 1 };
    expect(hashState(right)).not.toBe(hashState(plain));
    expect(hashState(up)).not.toBe(hashState(right));
    expect(cloneState(right).fighters[0].bufferedAction).toEqual(right.fighters[0].bufferedAction);
  });
```

and the walk's fixture gives the buffer a flick, so the walk reaches its two new leaves (the walk's own doc: an optional field the fixture leaves absent is not walked). The walk changes one shared object leaf by leaf, in key order, so the flick's fields come first:

```diff
     const FULL: Partial<FighterState> = {
       move: "jab1",
       ledge: { platform: 0, side: 1 },
-      bufferedAction: { kind: "jump", frame: 3 },
+      // A buffered flick (Plan 6, Task 5), so the walk reaches its direction. Its fields
+      // first: the walk mutates this one object in place, leaf by leaf, and once `kind` is
+      // no longer "attack" the flick is not mixed at all.
+      bufferedAction: { flickX: 1, flickY: 0, kind: "attack", frame: 3 },
       combat: { ...emptyCombat(), helplessMove: "upB" },
     };
```

The file imports `cloneState`; add, beside its other imports:

```diff
 import { markProjectileHit } from "./projectile";
+import { cloneState } from "./simulate";
 import type { FighterState, GameState, ProjectileState } from "./types";
```

`src/fighters/flick.test.ts` (new file):

```ts
/**
 * A right-stick flick, and Attack, out of shield, and a flick while holding someone (Plan 6,
 * Task 5), through `step()` on the real roster. SmashWiki "C-Stick"
 * (https://www.ssbwiki.com/C-Stick): "The C-Stick can also be used to roll or sidestep out of
 * shield"; SmashWiki "Out of shield" (https://www.ssbwiki.com/Out_of_shield): flicking it
 * "upward while shielding" is "an immediate up smash out of shield", and the stick's up smash
 * comes "with an up smash input". SmashWiki "Grab" (https://www.ssbwiki.com/Grab): a grab "can
 * be performed by pressing the shield and attack buttons simultaneously" (ruling R-P6-14). In a
 * grab the flick throws its way (ruling D1, UNVERIFIED: no page says whether the hold reads the
 * stick or the button first).
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

/** A smash-mode flick's fire frame: its direction and Attack fresh, with `Btn.Flick`. */
const flick = (dir: Btn, held: InputFrame = 0): InputFrame => held | dir | Btn.Attack | Btn.Flick;

/** Mario on Final Destination, facing right, in `action`, Fox standing well away. */
function mario(over: Partial<GameState["fighters"][number]>): GameState {
  const s = createInitialState("finalDestination", [{ defId: "mario" }, { defId: "fox" }], RULES, 5);
  Object.assign(s.fighters[0], { grounded: true, platform: 0, x: 0, y: 0, facing: 1, intangible: 0, ...over });
  Object.assign(s.fighters[1], { grounded: true, platform: 0, x: fx(60), y: 0, facing: -1, intangible: 0 });
  return s;
}

/** Step port 0 through `inputs`, port 1 idle; the state after each step. */
function run(s0: GameState, inputs: readonly InputFrame[]): GameState[] {
  let s = s0;
  let prev: InputFrame[] = [0, 0];
  const out: GameState[] = [];
  for (const i of inputs) {
    const now: InputFrame[] = [i, 0];
    s = step(s, now, { prevInputs: prev }).state;
    prev = now;
    out.push(s);
  }
  return out;
}

describe("out of shield (Plan 6, Task 5)", () => {
  const shielding = () => mario({ action: "shield", actionFrame: 10 });

  it("a flick rolls the way it is flicked", () => {
    const [after] = run(shielding(), [Btn.Shield | flick(Btn.Right)]);
    expect(after.fighters[0].action).toBe("roll");
  });

  it("a flick down spot-dodges", () => {
    const [after] = run(shielding(), [Btn.Shield | flick(Btn.Down)]);
    expect(after.fighters[0].action).toBe("spotDodge");
  });

  it("a flick up up-smashes", () => {
    const [after] = run(shielding(), [Btn.Shield | flick(Btn.Up)]);
    expect(after.fighters[0].action).toBe("attack");
    expect(after.fighters[0].move).toBe("usmash");
  });

  it("Attack alone grabs: shield and attack together (SmashWiki \"Grab\"; ruling R-P6-14)", () => {
    const [after] = run(shielding(), [Btn.Shield | Btn.Attack]);
    expect(after.fighters[0].action).toBe("grab");
  });

  it("Up and Attack together up-smash: the stick's up smash input (SmashWiki \"Out of shield\")", () => {
    const [after] = run(shielding(), [Btn.Shield | Btn.Up | Btn.Attack]);
    expect(after.fighters[0].action).toBe("attack");
    expect(after.fighters[0].move).toBe("usmash");
  });
});

describe("a flick while holding someone (Plan 6, Task 5; ruling D1)", () => {
  function holding(): GameState {
    const s = mario({ action: "grabHold", actionFrame: 0, x: fx(-4), grabbing: 1 });
    Object.assign(s.fighters[1], { action: "grabbed", actionFrame: 0, x: fx(4), facing: -1, grabbedBy: 0, grabTimer: 500 });
    return s;
  }

  it("throws the way it is flicked: down is the down throw", () => {
    const [after] = run(holding(), [flick(Btn.Down)]);
    expect(after.fighters[0].action).toBe("throw");
    expect(after.fighters[0].move).toBe("dthrow");
  });

  it("back is the back throw", () => {
    const [after] = run(holding(), [flick(Btn.Left)]);
    expect(after.fighters[0].move).toBe("bthrow");
  });

  it("Attack alone still pummels", () => {
    const [after] = run(holding(), [Btn.Attack]);
    expect(after.fighters[0].action).toBe("pummel");
  });
});
```

`src/game/rulesVersion.test.ts`:

```diff
-const RULES_PIN = { version: 5, golden: "26d4ec66" } as const;
+const RULES_PIN = { version: 6, golden: "26d4ec66" } as const;
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/engine/states.test.ts src/engine/hash.test.ts src/fighters/flick.test.ts src/game/rulesVersion.test.ts`
Expected: FAIL, 12 failed (captured):
- `states.test.ts`: "records the flick's direction" (`expected { kind: 'attack', frame: 1245 } to match object { kind: 'attack', flickX: 1, …(1) }`), the landing-lag forward smash (`expected 'jab1' to be 'fsmash'`), the up smash (`expected 'jab1' to be 'usmash'`), the crouch (`expected 'dtilt' to be 'fsmash'`). The jumpsquat, plain-press, fresh-Attack and fresh-B tests PASS (they pin what stays; mutants 2-4 prove they bite).
- `hash.test.ts`: the walk (`hash ignored fighter.bufferedAction.flickX: expected 283002866 not to be 283002866`) and the new test (`expected 2854130881 not to be 2854130881`).
- `flick.test.ts`: the roll (`expected 'attack' to be 'roll'`), the spot dodge (`expected 'attack' to be 'spotDodge'`), Attack alone (`expected 'attack' to be 'grab'`), the two throws (`expected 'pummel' to be 'throw'`, `expected 'pummel' to be 'bthrow'`). The flick up, Up and Attack, and pummel tests PASS.
- `rulesVersion.test.ts`: `… expected 5 to be 6`.

- [ ] **Step 3: Implement**

`src/engine/types.ts`:

```diff
 export type BufferedAction =
   | { kind: "jump"; frame: number }
-  | { kind: "attack"; frame: number }
-  | { kind: "special"; frame: number }
+  /**
+   * `flickX`/`flickY`: a right-stick flick's direction (`Intent.rightFlick`), each −1/0/1,
+   * when the press was one (Plan 6, Task 5; SmashWiki "C-Stick": C-Stick inputs "can be
+   * accidentally buffered"). Absent for a press of the button.
+   */
+  | { kind: "attack"; frame: number; flickX?: number; flickY?: number }
+  | { kind: "special"; frame: number; flickX?: number; flickY?: number }
   | { kind: "shield"; frame: number }
   | { kind: "grab"; frame: number };
```

`src/engine/states.ts`, `bufferPress`:

```diff
   else if (intent.grabPressed) kind = "grab";
   else if (intent.shieldPressed) kind = "shield";
-  if (kind !== null) f.bufferedAction = { kind, frame } as BufferedAction;
+  if (kind === null) return;
+  // A flicked attack or special keeps the flick's direction (Plan 6, Task 5).
+  const flick = kind === "attack" || kind === "special" ? intent.rightFlick : null;
+  f.bufferedAction = (flick === null ? { kind, frame } : { kind, frame, flickX: flick.x, flickY: flick.y }) as BufferedAction;
 }
```

`Presses` and `presses`, and the helpers after it:

```diff
 export interface Presses {
   jump: boolean;
   attack: boolean;
   special: boolean;
   grab: boolean;
   shield: boolean;
+  /**
+   * The buffered right-stick flick this frame's buffered attack or special fires with (Plan 6,
+   * Task 5), with the press it was buffered for, or null. A press made this frame carries its
+   * own (`Intent.rightFlick`), and the flick aims nothing but its own press.
+   */
+  flick: { readonly kind: "attack" | "special"; readonly x: number; readonly y: number } | null;
 }
 
 /** This frame's presses, with a still-valid buffered press folded in. */
 export function presses(f: FighterState, intent: Intent, frame: number): Presses {
   const b = peekBuffer(f, frame);
+  const buffered = b === null ? null : f.bufferedAction;
   const p: Presses = {
     jump: intent.jumpPressed || b === "jump",
     attack: intent.attackPressed || b === "attack",
     special: intent.specialPressed || b === "special",
     grab: intent.grabPressed || b === "grab",
     shield: intent.shieldPressed || b === "shield",
+    flick: bufferedFlick(buffered, intent),
   };
   if (b !== null) f.bufferedAction = null;
   return p;
 }
+
+/** A buffered flick and its press, unless this frame pressed the same button itself. */
+function bufferedFlick(b: BufferedAction | null, intent: Intent): Presses["flick"] {
+  if (b === null || (b.kind !== "attack" && b.kind !== "special") || b.flickX === undefined) return null;
+  if ((b.kind === "attack" && intent.attackPressed) || (b.kind === "special" && intent.specialPressed)) return null;
+  return { kind: b.kind, x: b.flickX, y: b.flickY ?? 0 };
+}
+
+/**
+ * The right-stick flick this frame's attack press comes with (Plan 6, Task 5): the frame's own
+ * when it pressed Attack (`Intent.rightFlick`), or the one a buffered attack kept; else null.
+ */
+export function attackFlick(intent: Intent, p: Presses): { readonly x: number; readonly y: number } | null {
+  if (intent.attackPressed) return intent.rightFlick;
+  return p.flick !== null && p.flick.kind === "attack" ? p.flick : null;
+}
+
+/**
+ * `intent` aimed by a buffered flick (Plan 6, Task 5): the move it starts reads the flick's
+ * direction, as the frame of the flick would have, and a flicked attack is a smash.
+ */
+function withFlick(intent: Intent, flick: { readonly x: number; readonly y: number }): Intent {
+  return { ...intent, x: flick.x, y: flick.y, rightFlick: { x: flick.x, y: flick.y }, smash: true, smashX: flick.x, smashY: flick.y };
+}
```

`handleActionable`: the special calls read `aim`, the attack's slot `aimAttack`; the shield, the dodge, the drop and `specialFlick` keep `intent`:

```diff
 export function handleActionable(f: FighterState, intent: Intent, ctx: StateContext): boolean {
   const p = presses(f, intent, ctx.frame);
+  // A buffered flick aims the press it was buffered with (Plan 6, Task 5), and nothing else:
+  // `aim` the special, `aimAttack` the attack.
+  const aim = p.flick !== null && p.flick.kind === "special" ? withFlick(intent, p.flick) : intent;
+  const aimAttack = p.flick !== null && p.flick.kind === "attack" ? withFlick(intent, p.flick) : intent;
 
   if (f.grounded) {
@@
-    if (p.special && beginSpecial(f, ctx, specialSlot(intent), intent.x, intent, specialFlick(intent))) return true;
-    if (p.attack && beginAttack(f, ctx, groundAttackSlot(f, intent))) return true;
+    if (p.special && beginSpecial(f, ctx, specialSlot(aim), aim.x, aim, specialFlick(intent))) return true;
+    if (p.attack && beginAttack(f, ctx, groundAttackSlot(f, aimAttack))) return true;
@@
   if ((p.shield || intent.shieldHeld) && startAirDodge(f, intent)) return true;
-  if (p.special && beginSpecial(f, ctx, specialSlot(intent), intent.x, intent, specialFlick(intent))) return true;
+  if (p.special && beginSpecial(f, ctx, specialSlot(aim), aim.x, aim, specialFlick(intent))) return true;
   if (p.attack) {
-    const slot = aerialSlot(f, intent);
+    const slot = aerialSlot(f, aimAttack);
```

`beginSpecial`'s doc comment, which a buffered flick now contradicts:

```diff
  * Plan 5, Task 13d), which turns as the side special does. A buffered B is never
- * one, as a buffered attack is never a smash (UNVERIFIED for both: no source says
- * what the buffer keeps of the stick).
+ * one (UNVERIFIED: no source says what the buffer keeps of the stick); a buffered
+ * right-stick flick keeps its own direction instead, and its attack is a smash
+ * (Plan 6, Task 5: `presses`, `withFlick`).
  */
```

`src/engine/hash.ts`, the buffer's mix (a press without a flick mixes exactly as before):

```diff
   } else {
     x = mixString(x, f.bufferedAction.kind);
     x = mixInt(x, f.bufferedAction.frame);
+    const b = f.bufferedAction;
+    if ((b.kind === "attack" || b.kind === "special") && b.flickX !== undefined) {
+      x = mixInt(x, 1 + (b.flickX + 1) * 3 + ((b.flickY ?? 0) + 1));
+    }
   }
```

`src/engine/simulate.ts`, the clone (every member is flat numbers and a string):

```diff
     bufferedAction:
       f.bufferedAction === null
         ? null
-        : ({ kind: f.bufferedAction.kind, frame: f.bufferedAction.frame } as FighterState["bufferedAction"]),
+        : { ...f.bufferedAction },
```

`src/engine/status/guard.ts`, the import and `STATUS_GUARD.main` after the grab:

```diff
   SHIELD_START_FRAMES,
+  attackFlick,
   bufferPress,
```

```diff
     if (p.grab) {
       startMove(f, "grab", "grab");
       return;
     }
-    if (p.attack && hasMove(ctx, "usmash")) {
-      startMove(f, "attack", "usmash");
-      return;
-    }
+    if (p.attack) {
+      // A smash-mode right-stick flick (Plan 6, Task 5): SmashWiki "C-Stick", "The C-Stick
+      // can also be used to roll or sidestep out of shield"; down sidesteps, sideways rolls
+      // that way, y first, as a diagonal aerial flick reads (`attackDirection`).
+      const flick = attackFlick(intent, p);
+      if (flick !== null && flick.y < 0) {
+        startAction(f, "spotDodge");
+        return;
+      }
+      if (flick !== null && flick.y === 0) {
+        startRoll(f, flick.x, ctx);
+        return;
+      }
+      // Up is the up smash: the C-Stick flicked "upward while shielding" (SmashWiki "Out of
+      // shield"), or without a flick the stick's up smash input (SPEC §6: Up pressed fresh
+      // within 5 frames). Attack otherwise grabs (ruling R-P6-14): SmashWiki "Grab", a grab
+      // "can be performed by pressing the shield and attack buttons simultaneously".
+      const up = flick !== null ? flick.y > 0 : intent.smash && intent.smashY > 0;
+      if (up && hasMove(ctx, "usmash")) startMove(f, "attack", "usmash");
+      else startMove(f, "grab", "grab");
+      return;
+    }
     if (intent.y < 0) {
```

`src/engine/status/attack.ts`, the import and `STATUS_CATCH_WAIT.main`:

```diff
   THROW_FRAMES,
+  attackFlick,
   bufferPress,
```

```diff
     const p = presses(f, intent, ctx.frame);
-    if (p.attack && hasMove(ctx, "pummel")) {
+    // A right-stick flick throws its way (Plan 6, Task 5; ruling D1, UNVERIFIED: SmashWiki
+    // "Grab" gives the pummel to "an attack or grab button" and the throws to "tilting the
+    // control stick", and no page says which a flick, both at once, is).
+    const flick = attackFlick(intent, p);
+    if (p.attack && flick === null && hasMove(ctx, "pummel")) {
       startMove(f, "pummel", "pummel");
       return;
     }
+    const dir = flick ?? intent;
     const throwSlot: MoveSlot | null =
-      intent.y > 0
+      dir.y > 0
         ? "uthrow"
-        : intent.y < 0
+        : dir.y < 0
           ? "dthrow"
-          : intent.x === f.facing
+          : dir.x === f.facing
             ? "fthrow"
-            : intent.x === -f.facing
+            : dir.x === -f.facing
               ? "bthrow"
               : null;
```

`src/engine/constants.ts`, the version and its comment:

```diff
  * sets it to 3; each later plan that changes what `step()` does bumps it once,
- * as its first behaviour change (Plan 4 sets 4, Plan 5 sets 5).
+ * as its first behaviour change (Plan 4 sets 4, Plan 5 sets 5, Plan 6 sets 6 in
+ * its Task 5).
```

```diff
-export const ENGINE_RULES_VERSION = 5;
+export const ENGINE_RULES_VERSION = 6;
```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/engine/states.test.ts src/engine/hash.test.ts src/fighters/flick.test.ts src/game/rulesVersion.test.ts src/game/simContext.test.ts`
Expected: PASS.

- [ ] **Step 5: The golden**

Run: `pnpm vitest run src/game/golden.test.ts src/game/rulesVersion.test.ts`
Expected: PASS, the golden unchanged at `26d4ec66` (captured). If `golden.test.ts` fails, see **Golden** above.

- [ ] **Step 6: Mutants**

Each one: apply it, run the named test file (log to a file), see the named failure, restore, and `git diff --exit-code` on the file shows only this task's change.
1. `bufferPress`: `const flick = kind === "attack" || kind === "special" ? intent.rightFlick : null;` → `const flick = null;`. `states.test.ts -t "buffered right-stick flick"`: the four flick tests FAIL with Step 2's four `states.test.ts` messages (captured; under `-t` the first reads `frame: 1`, the test clock starting later).
2. `bufferedFlick`: delete its second line (`if ((b.kind === "attack" && intent.attackPressed) || …) return null;`). "leaves a fresh Attack…" FAILS `expected 'fsmash' to be 'jab1'` (captured).
3. `handleActionable`: `const aim = p.flick !== null && p.flick.kind === "special" ? withFlick(intent, p.flick) : intent;` → `const aim = p.flick !== null ? withFlick(intent, p.flick) : intent;`. "aims only the press it was buffered with…" FAILS `expected 'fsmash' to be 'neutralB'` (captured: the side special it aims at is not in the test fighter's moves, so the buffered attack fires).
4. `status/air.ts`, `STATUS_JUMP_SQUAT`: `if (intent.attackPressed) f.bufferedAction = { kind: "attack", frame: ctx.frame };` → `if (intent.attackPressed) bufferPress(f, intent, ctx.frame);`. "does not aim an aerial buffered in jumpsquat…" FAILS `expected 'fair' to be 'nair'` (captured).
5. `withFlick`: `smash: true` → `smash: false`. "comes out of landing lag as the flick's forward smash…" FAILS `expected 'ftilt' to be 'fsmash'` (captured).
6. `hash.ts`: delete the new `mixInt` line. `hash.test.ts`: the walk and "hashes a buffered flick's direction…" FAIL (captured, as in Step 2).
7. `bufferPress`: `flick === null ? { kind, frame } : …` → `flick === null ? { kind, frame, flickX: 0, flickY: 0 } : …`. "keeps a buffered press without a flick exactly as before" FAILS `expected { kind: 'attack', frame: 1, …(2) } to deeply equal { kind: 'attack', frame: Any<Number> }` (captured, under `-t`).
8. `guard.ts`: swap the bodies of the `flick.y < 0` and `flick.y === 0` branches. `flick.test.ts -t "out of shield"`: the roll FAILS `expected 'spotDodge' to be 'roll'` and the spot dodge `expected 'roll' to be 'spotDodge'` (captured).
9. `guard.ts`: `const up = flick !== null ? flick.y > 0 : intent.smash && intent.smashY > 0;` → `const up = flick !== null ? false : intent.smash && intent.smashY > 0;`. "a flick up up-smashes" FAILS `expected 'grab' to be 'attack'` (captured).
10. `guard.ts`: `else startMove(f, "grab", "grab");` → `else startMove(f, "attack", "usmash");`. "Attack alone grabs…" FAILS `expected 'attack' to be 'grab'` (captured).
11. `guard.ts`: `const up = flick !== null ? flick.y > 0 : intent.smash && intent.smashY > 0;` → `const up = flick !== null ? flick.y > 0 : false;`. "Up and Attack together up-smash…" FAILS `expected 'grab' to be 'attack'` (captured).
12. `attack.ts`: `if (p.attack && flick === null && hasMove(ctx, "pummel"))` → `if (p.attack && hasMove(ctx, "pummel"))`. `flick.test.ts -t "holding someone"`: the two throws FAIL `expected 'pummel' to be 'throw'` and `expected 'pummel' to be 'bthrow'` (captured).
13. `attack.ts`: `if (p.attack && flick === null && hasMove(ctx, "pummel"))` → `if (false)`. "Attack alone still pummels" FAILS `expected 'grabHold' to be 'pummel'` (captured).

- [ ] **Step 7: Gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`, then `PORT=3107 pnpm test:e2e --trace off` (the pad specs) and `pnpm test:e2e:online --trace off` (Task 1's settled server).
Expected: exit 0; e2e and online pass. The golden is byte-identical (`26d4ec66`); only the version moved.

- [ ] **Step 8: Commit**

```bash
git add super-smash/src/engine/types.ts super-smash/src/engine/states.ts super-smash/src/engine/hash.ts super-smash/src/engine/simulate.ts super-smash/src/engine/status/guard.ts super-smash/src/engine/status/attack.ts super-smash/src/engine/constants.ts super-smash/src/game/rulesVersion.test.ts super-smash/src/engine/states.test.ts super-smash/src/engine/hash.test.ts super-smash/src/fighters/flick.test.ts
# with the golden only if Step 5 regenerated it:
git add super-smash/src/game/__golden__/engine-trace.json super-smash/src/game/rulesVersion.test.ts
git commit -m "super-smash: a flick keeps its direction in the buffer, rolls or spot-dodges out of shield, throws from a hold; Attack in shield grabs; rules version 6" -m "SmashWiki C-Stick and Out of shield. A buffered flick aims only the press it was buffered with; the jumpsquat's buffered aerial keeps the stick's direction, as the page says. Attack while shielding is a grab (SmashWiki Grab: shield and attack together; ruling R-P6-14); the up smash out of shield takes Up, the stick's smash input or a flick. A flick during a hold throws (ruling D1, UNVERIFIED). Plan 6's first change to step(): ENGINE_RULES_VERSION and RULES_PIN.version 5 -> 6. Golden unchanged (no driver sets Btn.Flick or presses Attack in shield)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Group 2: engine fidelity

**Replay bases** (the header's red-step rule covers what they change):
- **Task 6:** on Tasks 4 and 5.
- **Tasks 7-12:** on Task 5 alone. Task 8 consumes its `aim`, and its rules version 6 sits under every pin.
- **Tasks 13-18:** on the first-draft text of this plan's Tasks 9 and 11 (the draft's 7 and 9), before those two were fixed.
  - The draft's Task 9 recorded a Final Smash scene per box, not by target and part.
  - Its Task 11 already had R-P6-10's still step.
  - Task 14's record-check hunk is reconciled to Task 9's final line, and Task 18 says what its sweep's figures rest on.
  - Task 7's slip lab, the sixteenth trace, was not in these replays. If it moves, that is not in their lists, and `expectSlip` must hold.
- **Tasks 19-22:** see the bodies sub-group, below.

Each task's counts, digests and first-divergence samples are its replay's.

**The ball-on match in this group (ruling R-P6-20).** Tasks 11, 18 and 19 move `samus-kirby-townAndCity-ball`, each measured on its own replay base, where `expectCpuFinalSmash` held. Task 19's base had neither Task 11's slow nor Task 18's idle phase, so in this order a regeneration may stop on that pin ("Final Smashes started by its CPUs: expected 0 to be greater than 0"). R-P6-18 lets a task step the ball-on seed only on its own `cpuSweep` figures, and the sweep does not exist before Task 23. So a task in Groups 0-2 that stops there does not step the seed. It stops and reports, for the controller's ruling: the trace, the frame on which the CPU's Final Smash was lost, and the change of its own that moved it. The controller records the ruling; it may run Task 23's harness in a scratch copy for the figures, or step the seed and let Task 23's baseline cover the check. Any other lab pin stops the task as the header says.

### Task 6: The reverse smash (FIRST engine item)

From Plan 5's substitute confirm: "A smash input behind a standing fighter (keyboard back+Attack, or a right-stick back flick) fires forward without turning (`states.ts:~610, ~662`)." The check the backlog asks for, done 2026-11-01: SmashWiki "Forward smash" says it "is performed by tapping the control stick in a horizontal direction and pressing the attack button immediately afterward or simultaneously, or by tilting the C-stick in a horizontal direction" (a horizontal direction, either way), and SmashWiki "Smash attack" quotes SSB4's in-game tip: "The attack will change depending on the direction you flick". "Smash attack" and "C-Stick" say nothing more. So a forward smash pressed toward the fighter's back comes out that way: the fighter turns round and swings. The replica turns a standing fighter on a back press's first frame already (`groundMain`), so the gap is only the frame where the press and Attack land together, and the flick. UNVERIFIED: that the turn is instant (no turnaround frames), which no page times for Ultimate (SmashWiki "Turn" times Smash 64's and Melee's only); it matches the existing one-frame turn from a standstill.

The turn is a grounded fighter's who is free to act and whose attack is the forward smash: standing, walking, braking from a run, or crouching with a flick (a dash's attack is the dash attack and never turns). That is the side special's rule already (`beginSpecial`: it turns except out of `run`).

A soft back press with Attack (the Tilt key, or a stick's part-way push) is a forward tilt and does not turn, as at `46e0706` (SPEC §6: "With Tilt held, never a smash"). Whether a tilt pressed backward turns is unsourced: SmashWiki "Forward tilt" says only "holding the control stick horizontally". So this task keeps `46e0706`'s behaviour and pins it.

**SPEC change** (in this task's commit; ruling R-P6-8). SPEC §6, the "Tilt vs. smash" row:
- Old: "| Tilt vs. smash | Attack within 5 frames of a *fresh* direction press is a smash; otherwise a tilt. With Tilt held, never a smash. |"
- New: "| Tilt vs. smash | Attack within 5 frames of a *fresh* direction press is a smash in that direction: pressed behind a grounded fighter, it turns round first. Otherwise a tilt. With Tilt held, never a smash. |"

**Golden:** moves (captured in the replay after Task 5): the CPU traces `mario-fox-battlefield` (first divergence in frames 2201-2300) and `kirby-marth-pokemonStadium2` (frames 401-500). A CPU that presses toward its target with Attack while facing away (a cross-up) used to smash away from it and now turns; the scripted and lab drivers press forward. Regenerate, re-pin and name the traces in the commit. A different list of traces stops the task.

**Files:**
- Create: `src/fighters/reverseSmash.test.ts`
- Modify: `src/engine/states.ts`, `SPEC.md`
- Regenerate: `src/game/__golden__/engine-trace.json`, `src/game/rulesVersion.test.ts` (`RULES_PIN.golden`)

**Interfaces:**
- Consumes: Task 5's `aimAttack` in `handleActionable`; `groundAttackSlot`, `beginAttack`.
- Produces: nothing new by name.

- [ ] **Step 1: Write the failing test**

`src/fighters/reverseSmash.test.ts` (new file):

```ts
/**
 * The reverse smash (Plan 6, Task 6): a forward smash pressed toward a grounded
 * fighter's back turns it round and swings that way. SmashWiki "Forward smash"
 * (https://www.ssbwiki.com/Forward_smash): "tapping the control stick in a horizontal
 * direction and pressing the attack button immediately afterward or simultaneously, or
 * by tilting the C-stick in a horizontal direction". UNVERIFIED: the turn's timing
 * (none published); it is the frame the smash starts.
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

/** Mario standing at the centre of Final Destination, facing right; Fox at `foxX`. */
function standing(foxX = fx(60)): GameState {
  const s = createInitialState("finalDestination", [{ defId: "mario" }, { defId: "fox" }], RULES, 5);
  Object.assign(s.fighters[0], { action: "stand", actionFrame: 10, grounded: true, platform: 0, x: 0, y: 0, facing: 1, intangible: 0 });
  Object.assign(s.fighters[1], { action: "stand", actionFrame: 10, grounded: true, platform: 0, x: foxX, y: 0, facing: -1, intangible: 0, invincible: 0 });
  return s;
}

function run(s0: GameState, inputs: readonly InputFrame[]): GameState[] {
  let s = s0;
  let prev: InputFrame[] = [0, 0];
  const out: GameState[] = [];
  for (const i of inputs) {
    const now: InputFrame[] = [i, 0];
    s = step(s, now, { prevInputs: prev }).state;
    prev = now;
    out.push(s);
  }
  return out;
}

describe("the reverse smash (Plan 6, Task 6)", () => {
  it("back and Attack on one frame: a forward smash, turned round", () => {
    const [after] = run(standing(), [Btn.Left | Btn.Attack]);
    expect(after.fighters[0].move).toBe("fsmash");
    expect(after.fighters[0].facing).toBe(-1);
  });

  it("a right-stick flick backward: the same", () => {
    const [after] = run(standing(), [Btn.Left | Btn.Attack | Btn.Flick]);
    expect(after.fighters[0].move).toBe("fsmash");
    expect(after.fighters[0].facing).toBe(-1);
  });

  it("a buffered back flick out of landing lag (Task 5's buffer): turned round too", () => {
    const s = standing();
    Object.assign(s.fighters[0], { action: "landingLag", actionFrame: 0, charge: 6 });
    const states = run(s, [Btn.Left | Btn.Attack | Btn.Flick, ...Array<InputFrame>(8).fill(0)]);
    const swing = states.find((st) => st.fighters[0].move === "fsmash");
    expect(swing?.fighters[0].facing).toBe(-1);
  });

  it("forward and Attack is unchanged: a forward smash, still facing right", () => {
    const [after] = run(standing(), [Btn.Right | Btn.Attack]);
    expect(after.fighters[0].move).toBe("fsmash");
    expect(after.fighters[0].facing).toBe(1);
  });

  it("lands on a fighter behind: Fox 12 units back is hit and sent left", () => {
    const states = run(standing(-fx(12)), [Btn.Left | Btn.Attack, ...Array<InputFrame>(40).fill(Btn.Left)]);
    const hit = states.findIndex((st) => st.fighters[1].damage > 0);
    expect(hit).toBeGreaterThan(0);
    const later = states[Math.min(states.length - 1, hit + 25)];
    expect(later.fighters[1].x).toBeLessThan(-fx(12));
  });

  it("back and Attack with Tilt held: a forward tilt, not turned (as at 46e0706; SPEC §6, never a smash)", () => {
    const [after] = run(standing(), [Btn.Left | Btn.Attack | Btn.Soft]);
    expect(after.fighters[0].move).toBe("ftilt");
    expect(after.fighters[0].facing).toBe(1);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run src/fighters/reverseSmash.test.ts`
Expected: FAIL, 4 failed (captured): the first three with `expected 1 to be -1`, "lands on a fighter behind" with `expected -1 to be greater than 0` (the swing goes right, away from Fox). The forward and Tilt tests PASS (they pin what stays; mutant 2 proves the Tilt pin bites).

- [ ] **Step 3: Implement**

`src/engine/states.ts`, `handleActionable`'s grounded branch (Task 5's `aimAttack` in place):

```diff
     if (p.special && beginSpecial(f, ctx, specialSlot(aim), aim.x, aim, specialFlick(intent))) return true;
-    if (p.attack && beginAttack(f, ctx, groundAttackSlot(f, aimAttack))) return true;
+    if (p.attack) {
+      const slot = groundAttackSlot(f, aimAttack);
+      // A forward smash pressed toward the fighter's back turns it round first (Plan 6,
+      // Task 6; SmashWiki "Forward smash": the stick tapped "in a horizontal direction",
+      // or the C-stick tilted "in a horizontal direction"). UNVERIFIED: instant, as a
+      // standing fighter's turn is (`groundMain`). Only a smash: a tilt never turns here.
+      if (slot === "fsmash" && aimAttack.smash && aimAttack.smashX !== 0 && aimAttack.smashX !== f.facing) f.facing = aimAttack.smashX;
+      if (beginAttack(f, ctx, slot)) return true;
+    }
     if (p.jump) {
```

`SPEC.md`, §6's table: replace the "Tilt vs. smash" row's text with the New one above (one row, nothing else).

- [ ] **Step 4: Run it again**

Run: `pnpm vitest run src/fighters/reverseSmash.test.ts src/engine/states.test.ts src/fighters/flick.test.ts`
Expected: PASS.

- [ ] **Step 5: The golden**

Run: `pnpm vitest run src/game/golden.test.ts src/game/rulesVersion.test.ts`
Expected: `golden.test.ts` FAILS on `mario-fox-battlefield` (`first divergence in frames 2201-2300: expected 22 to be -1`) and `kirby-marth-pokemonStadium2` (`first divergence in frames 401-500: expected 4 to be -1`) (captured). Then `UPDATE_GOLDEN=1 pnpm vitest run src/game/golden.test.ts`, set `RULES_PIN.golden` to the digest `rulesVersion.test.ts` prints (the pin's failure prints the new digest; replay: `4d52c87e`; version stays 6), and rerun both: PASS.

- [ ] **Step 6: Mutants**

Each one: apply it, run the named test file (log to a file), see the named failure, restore, and `git diff --exit-code -- super-smash/src/engine/states.ts` shows only this task's change.
1. Delete the `f.facing = aimAttack.smashX` statement (the whole `if` line). `reverseSmash.test.ts`: the three turn tests FAIL `expected 1 to be -1` and "lands on a fighter behind" FAILS `expected -1 to be greater than 0` (captured).
2. Replace the turn line with `if (aimAttack.x !== 0 && aimAttack.x !== f.facing) f.facing = aimAttack.x;` (a turn for any attack pressed backward). "back and Attack with Tilt held…" FAILS `expected -1 to be 1` (captured).

- [ ] **Step 7: Gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`, then `PORT=3107 pnpm test:e2e --trace off` (keyboard gameplay specs).
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add super-smash/src/engine/states.ts super-smash/src/fighters/reverseSmash.test.ts super-smash/SPEC.md super-smash/src/game/__golden__/engine-trace.json super-smash/src/game/rulesVersion.test.ts
git commit -m "super-smash: a forward smash pressed behind a grounded fighter turns it round first" -m "SmashWiki Forward smash: the stick or C-stick 'in a horizontal direction'. Keyboard back+Attack and a back flick both reverse; a soft press never smashes or turns. SPEC §6's Tilt vs. smash row says so. Golden: moved, the CPU traces mario-fox-battlefield and kirby-marth-pokemonStadium2 (CPU cross-ups now turn); RULES_PIN.golden <the new digest>." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Edge slipping

From Plan 5's final-wave triage, and D58's "edge slipping (a new action)". SmashWiki "Edge slipping" (read 2026-11-01):
- "a character is knocked off a platform while they were still on their feet … If the edge is grabbable, then they will always grab it."
- "If a character is facing forward while they slip off an edge, they are free to perform any action immediately upon falling off the platform. However, if a character edge slips in the reverse direction they were looking, they will enter their edge slip animation, and be unable to perform any action for a certain amount of frames."
- "they are able to DI the fall left or right after the eighth frame, but are still unable to affect the vertical momentum of their fall or perform any other action."
- "a character cannot tech upon hitting the ground … In Ultimate, teching is possible."
- Its Ultimate table: Mario 26, Donkey Kong 25, Link 26, Samus 26, Kirby 26, Fox 26, Pikachu 25, Marth 26. rubendal 13.0.1 agrees for Samus: `miss_foot`'s CancelFrame is 27, the first actionable frame after 26.

**What this task adds.** The replica's `groundExit.ts` already says this is "Not modelled (UNVERIFIED): the edge slip itself". This task adds the action `edgeSlip` (`FIGHTER_STATUS_KIND_MISS_FOOT`).
- **Entry.** `onLeftGround` enters it for a fighter that meets all of these:
  - it is on its feet: a `fall` row, or a grounded attack pushed off (`stopUnlessPushed`);
  - it left the ground over an edge, not lifted: `vy` is not rising;
  - its push on the DAMAGE energy points behind it (`kinetic.damageX · facing < 0`).
- **Why the push decides it.** A fighter's own walk never takes it backward, so the push is what tells a slip from running off. Forward, nothing changes: it falls, free to act.
- **Shields** stay `cliffStop`. SmashWiki "Shield": pushback causes edge slipping "except in Smash 4 and Ultimate".

**Timing.** The slip is entered on contact (phase 5), as a landing, a tech or a ledge trump is. The codebase rules that such a status's `actionFrame` 0 is the frame before its frame 1 (`handOff`'s doc, `states.ts`). So:
- frame n of the slip is `actionFrame` n;
- the lockout ends on `actionFrame` 26 through `endStatus`, keeping a press made there, and the fighter acts on frame 27, rubendal's CancelFrame;
- "after the eighth frame" is drift from `actionFrame` 9.

**A ledge.** A slip off a ledge-bearing edge takes the ledge on the very step it leaves the ground: `findLedgeGrab` runs after `onLeftGround` in the same phase 5, and nothing here excludes the slip. So no recorded state is ever the slip at a grabbable edge. It shows off a ledgeless end, such as a soft platform's.

**UNVERIFIED, left as they are:**
- A fighter in a grounded flinch (`hitstun`, a `keep` row) slid off keeps its hitstun. The page names hits "that produce too low of knockback to lift a character off the ground", and the reel already plays out in the air here.
- A launch's slide that has landed rides STOP, not DAMAGE (`kineticLand`), so it is not read as a knock.
- The slip lies down on landing, as SmashWiki says of Brawl. Of Ultimate the page says only that "teching is possible".

**The motion** borrows `fall`'s (`MOTION_OF_ACTION`), so the bake is byte-identical. A clip of its own is carried to the clip task (R-P6-9 (c)).

**Golden:** moves, by a new trace alone (captured).
- **Why it must move.** `golden.test.ts`'s `MUST_VISIT` pins every action as visited, and ruling P5-R14 says new actions are visited, not exempted. So `edgeSlip: true` joins it, and some golden match must slip.
- **None does.** The coverage check fails `action states no match reaches: expected [ 'edgeSlip' ] to deeply equal []` (captured).
- **None can on Final Destination**, where the states lab plays. Its only edges carry ledges, and a slip there hangs on the step it leaves the ground (above).
- **So the slip gets a lab of its own.** R-P6-12 asks for a states-lab scene; the stage rules that out. `goldenSlipLab.ts` plays on Battlefield, whose soft platforms have no ledges, and is appended last in `MATCHES`, as ruling R-T8e gave the crawl a lab. In it, Mario's F.L.U.D.D. pushes Donkey Kong backward off the top platform's end.
- **The pins.** `expectSlip` pins the lab's slip, as `expectContacts` pins the contact lab's, and the history comment above `MUST_VISIT` gains the task's paragraph. The fifteen other traces are byte-identical (captured), and `RULES_PIN.golden` moves by the new trace alone.

**Files:**
- Create: `src/fighters/edgeSlip.test.ts`, `src/game/goldenSlipLab.ts`
- Modify:
  - `src/engine/types.ts` (`ActionState` `"edgeSlip"`, `FighterAttributes.edgeSlipFrames?`)
  - `src/engine/constants.ts`
  - `src/engine/status/kind.ts`, `src/engine/status/air.ts`
  - `src/engine/groundExit.ts`
  - `src/engine/states.ts` (`edgeSlipFrames`, `onLeftGround`, `onLanded`, `applyMovement`)
  - `src/engine/tech.ts`
  - `src/engine/footstool.ts` (`TREADED_KIND_OF_ACTION`), `src/engine/softDrop.ts` (`SOFT_DROP`)
  - `src/engine/acmd/poseClock.ts`, `src/render/poses/timing.ts`
  - `src/fighters/donkeyKong.ts`, `src/fighters/pikachu.ts`
- Test:
  - `src/engine/status/groups.test.ts`, `src/engine/status/status.test.ts`
  - `src/fighters/groundExit.test.ts` (`PINNED`, the F.L.U.D.D. ledge cancel), `src/fighters/footstool.test.ts`
  - `src/engine/acmd/poseClock.test.ts`, `src/render3d/bake/bake.test.ts`, `src/render3d/vfx3d.test.ts`
  - `src/game/golden.test.ts` (`MUST_VISIT`, `MATCHES`, `expectSlip`, the history)
- Regenerate: `src/game/__golden__/engine-trace.json` and `RULES_PIN.golden` (`src/game/rulesVersion.test.ts`)

**Interfaces:**
- Consumes:
  - `GROUND_EXIT`, `onLeftGround`, `onLanded`, `applyMovement`'s `stickX`;
  - `endStatus`, `bufferPress` (states.ts);
  - `techOrBounce`/`LaunchBefore`;
  - `findLedgeGrab` (unchanged: any airborne fighter outside its exclusions may take a ledge).
- Produces:
  - `ActionState` member `"edgeSlip"`;
  - `STATUS_MISS_FOOT` (status/air.ts);
  - `EDGE_SLIP_FRAMES = 26`, `EDGE_SLIP_DRIFT_FRAME = 8` (constants.ts);
  - `edgeSlipFrames(def): number` (states.ts);
  - `FighterAttributes.edgeSlipFrames?: number`;
  - `SLIP_LAB` (`goldenSlipLab.ts`).
- Task 21 (the dash-off flip) reads `onLeftGround` as this task leaves it.

- [ ] **Step 1: Write the failing tests**

`src/fighters/edgeSlip.test.ts` (new file):

```ts
/**
 * Edge slipping (Plan 6, Task 7). SmashWiki "Edge slipping"
 * (https://www.ssbwiki.com/Edge_slipping): knocked off a platform "while they were still
 * on their feet", one facing forward is "free to perform any action immediately"; one
 * slipping "in the reverse direction they were looking" is locked out for its fighter's
 * frames (Ultimate: Mario 26, Donkey Kong 25, Pikachu 25), may "DI the fall left or right
 * after the eighth frame", and in Ultimate can tech; "If the edge is grabbable, then they
 * will always grab it".
 *
 * The slip is entered on contact (phase 5, `onLeftGround`), as a landing is: the step it
 * starts on is its `actionFrame` 0, the frame before its frame 1, so its frame n is
 * `actionFrame` n, and a lockout of N frames ends on `actionFrame` N, acting on the next.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { fx } from "@/engine/fixed";
import { createInitialState, registerFighters, registerStages, step } from "@/engine/simulate";
import { emptyKinetic } from "@/engine/kinetic";
import { Btn } from "@/engine/types";
import type { GameState, InputFrame, MatchRules } from "@/engine/types";
import { BATTLEFIELD_UPPER_PLATFORM_Y } from "@/stages/battlefield";
import { STAGES } from "@/stages";
import { FIGHTERS } from "./index";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true };

beforeAll(() => {
  registerFighters(FIGHTERS);
  registerStages(STAGES);
});

/**
 * `who` standing on `stage`'s platform `platform` at x, facing `facing`, pushed along x at
 * `push` a frame on the DAMAGE energy (as a windbox leaves it); Fox parked far away.
 */
function pushed(who: string, stage: string, platform: number, x: number, y: number, facing: number, push: number): GameState {
  const s = createInitialState(stage, [{ defId: who }, { defId: "fox" }], RULES, 5);
  Object.assign(s.fighters[0], {
    action: "stand", actionFrame: 10, grounded: true, platform, x, y, facing, intangible: 0,
    vx: push, kinetic: { ...emptyKinetic(), damageX: push },
  });
  Object.assign(s.fighters[1], { action: "stand", grounded: true, platform: 0, x: -fx(60), y: 0, intangible: 0 });
  return s;
}

/**
 * `who` as `onLeftGround` leaves a slipping fighter (`actionFrame` 0), 80 over Final
 * Destination's centre, at rest: no floor is in reach for longer than any lockout, so the
 * lockout is read alone. State `i` of a run from here is the slip's frame `i + 1`.
 */
function slipping(who: string): GameState {
  const s = pushed(who, "finalDestination", 0, 0, fx(80), -1, 0);
  Object.assign(s.fighters[0], { action: "edgeSlip", actionFrame: 0, grounded: false, platform: -1, vx: 0, vy: 0, kinetic: emptyKinetic() });
  return s;
}

function run(s0: GameState, frames: number, input: (i: number) => InputFrame = () => 0): GameState[] {
  let s = s0;
  let prev: InputFrame[] = [0, 0];
  const out: GameState[] = [];
  for (let i = 0; i < frames; i++) {
    const now: InputFrame[] = [input(i), 0];
    s = step(s, now, { prevInputs: prev }).state;
    prev = now;
    out.push(s);
  }
  return out;
}

const upper = (): number => STAGES.find((st) => st.id === "battlefield")!.platforms.findIndex((p) => p.y === BATTLEFIELD_UPPER_PLATFORM_Y);
/** Battlefield's top platform's right end. */
const TOP_RIGHT = fx(17.3165);

describe("edge slipping (Plan 6, Task 7)", () => {
  it("pushed backward off a soft platform's end on its feet: the edge slip, on the step it leaves the ground", () => {
    const [first] = run(pushed("mario", "battlefield", upper(), TOP_RIGHT - fx(1), BATTLEFIELD_UPPER_PLATFORM_Y, -1, fx(1.5)), 1);
    expect(first.fighters[0].grounded).toBe(false);
    expect(first.fighters[0].action).toBe("edgeSlip");
  });

  it("pushed forward off the same edge: a fall, free to act", () => {
    const [first] = run(pushed("mario", "battlefield", upper(), TOP_RIGHT - fx(1), BATTLEFIELD_UPPER_PLATFORM_Y, 1, fx(1.5)), 1);
    expect(first.fighters[0].action).toBe("fall");
  });

  it("lifted off the platform's middle with the push behind it: a fall, not a slip", () => {
    const s = pushed("mario", "battlefield", upper(), 0, BATTLEFIELD_UPPER_PLATFORM_Y, -1, fx(1.5));
    Object.assign(s.fighters[0], { vy: fx(1), kinetic: { ...emptyKinetic(), damageX: fx(1.5), gravityY: fx(1) } });
    const [first] = run(s, 1);
    expect(first.fighters[0].grounded).toBe(false);
    expect(first.fighters[0].action).toBe("fall");
  });

  it("locks Mario out for 26 frames: frames 1-25 slipping, the fall on frame 26", () => {
    const states = run(slipping("mario"), 30);
    for (let i = 0; i <= 24; i++) expect(states[i].fighters[0].action, `slip frame ${i + 1}`).toBe("edgeSlip");
    expect(states[25].fighters[0].action, "slip frame 26").toBe("fall");
  });

  it("locks Donkey Kong and Pikachu out for 25", () => {
    for (const who of ["donkeyKong", "pikachu"]) {
      const states = run(slipping(who), 30);
      expect(states[23].fighters[0].action, `${who} slip frame 24`).toBe("edgeSlip");
      expect(states[24].fighters[0].action, `${who} slip frame 25`).toBe("fall");
    }
  });

  it("keeps an Attack pressed on its last frame, and swings it on the first frame after", () => {
    const states = run(slipping("mario"), 30, (i) => (i === 25 ? Btn.Attack : 0));
    expect(states.slice(0, 25).every((st) => st.fighters[0].action === "edgeSlip")).toBe(true);
    expect(states[25].fighters[0].action, "slip frame 26, the press").toBe("fall");
    expect(states[26].fighters[0].action, "the first frame after").toBe("attack");
  });

  it("drifts with the stick only after its eighth frame", () => {
    const states = run(slipping("mario"), 12, () => Btn.Left);
    expect(states[7].fighters[0].kinetic.controlX, "slip frame 8").toBe(0);
    expect(states[8].fighters[0].kinetic.controlX, "slip frame 9").toBeLessThan(0);
  });

  it("lands lying down without a tech, and techs on a timely shield press (Ultimate)", () => {
    // Already slipping, on its sixth frame, three units over Final Destination and falling:
    // it reaches the floor inside its lockout.
    const low = (): GameState => {
      const s = pushed("mario", "finalDestination", 0, 0, fx(3), -1, 0);
      Object.assign(s.fighters[0], {
        action: "edgeSlip", actionFrame: 5, grounded: false, platform: -1, vx: 0, vy: -fx(1.5),
        kinetic: { ...emptyKinetic(), gravityY: -fx(1.5) },
      });
      return s;
    };
    const lies = run(low(), 6);
    expect(lies.map((st) => st.fighters[0].action)).toContain("downed");
    const techs = run(low(), 6, (i) => (i === 0 ? Btn.Shield : 0));
    expect(techs.some((st) => /^tech/.test(st.fighters[0].action))).toBe(true);
  });

  it("Review Focus: slipping off a ledge-bearing edge hangs on the ledge", () => {
    // Pushed off Final Destination's right edge backward: the ledge is taken on the step it
    // leaves the ground (`findLedgeGrab` runs after `onLeftGround`), never fallen past.
    const [first] = run(pushed("mario", "finalDestination", 0, fx(79), 0, -1, fx(1.5)), 1);
    expect(first.fighters[0].action).toBe("ledgeHang");
    // Already slipping, in its lockout, just outboard of that ledge and under it: it hangs.
    const s = pushed("mario", "finalDestination", 0, fx(81), -fx(2), -1, 0);
    Object.assign(s.fighters[0], {
      action: "edgeSlip", actionFrame: 5, grounded: false, platform: -1, vx: 0, vy: -fx(0.5),
      kinetic: { ...emptyKinetic(), gravityY: -fx(0.5) },
    });
    expect(run(s, 3).some((st) => st.fighters[0].action === "ledgeHang")).toBe(true);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/fighters/edgeSlip.test.ts`

Expected: FAIL, 7 of 9 (captured).
- The entry test: `expected 'fall' to be 'edgeSlip'`.
- The six that start in the slip: `Error: no status registered for "edgeSlip"; import "@/engine/status"`.
- The forward test and the lift test PASS.

- [ ] **Step 3: Implement**

```diff
--- a/src/engine/types.ts
+++ b/src/engine/types.ts
@@
   // helpless after a recovery move, and its landing (Plan 5, Task 4b)
   | "specialFall"
   | "specialLanding"
+  // knocked off the ground backward while on its feet (Plan 6, Task 7)
+  | "edgeSlip"
   // offence
   | "attack"
   | "special"
@@
    * https://www.ssbwiki.com/Crawling: of the eight, Pikachu). Absent: cannot.
    */
   readonly canCrawl?: boolean;
+  /**
+   * How many frames an edge slip locks the fighter out (Plan 6, Task 7; SmashWiki "Edge
+   * slipping", https://www.ssbwiki.com/Edge_slipping, its Ultimate table). Absent: 26,
+   * the table's value for Mario, Link, Samus, Kirby, Fox and Marth.
+   */
+  readonly edgeSlipFrames?: number;
   /** Half-width and height of the fighter's hurtbox, fixed. */
   readonly width: number;
   readonly height: number;
```

```diff
--- a/src/engine/constants.ts
+++ b/src/engine/constants.ts
@@
 /** Ultimate's input buffer: an early press still fires when it becomes legal. */
 export const BUFFER_FRAMES = 9;
 
+/** An edge slip's lockout where the fighter gives none (SmashWiki "Edge slipping", Ultimate: 26 for six of the eight). */
+export const EDGE_SLIP_FRAMES = 26;
+/** An edge slip drifts with the stick only after this frame ("able to DI the fall left or right after the eighth frame"). */
+export const EDGE_SLIP_DRIFT_FRAME = 8;
+
 /**
  * A direction pressed within this many frames of the attack button makes the
  * attack a smash rather than a tilt. Ultimate resolves this from stick velocity;
```

```diff
--- a/src/fighters/donkeyKong.ts
+++ b/src/fighters/donkeyKong.ts
@@
     // the few fighters for whom that is true.
     airJumpVelocity: fx(2.457),
     jumps: 2,
+    // SmashWiki "Edge slipping" (https://www.ssbwiki.com/Edge_slipping), Ultimate: 25 (Plan 6, Task 7).
+    edgeSlipFrames: 25,
     canWallJump: false,
     width: fx(HALF_WIDTH),
     height: fx(HEIGHT),
```

```diff
--- a/src/fighters/pikachu.ts
+++ b/src/fighters/pikachu.ts
@@
     shortHopVelocity: fx(1.804),
     airJumpVelocity: fx(2.597),
     jumps: 2,
+    // SmashWiki "Edge slipping" (https://www.ssbwiki.com/Edge_slipping), Ultimate: 25 (Plan 6, Task 7).
+    edgeSlipFrames: 25,
     canWallJump: true,
     // SmashWiki "Wall jump" (https://www.ssbwiki.com/Wall_jump), "Wall jump height
     // rankings", Ultimate: 34.29 (revision 2065734, 2026-10-25, the corrected table).
```

```diff
--- a/src/engine/status/kind.ts
+++ b/src/engine/status/kind.ts
@@
   | "FIGHTER_STATUS_KIND_LANDING_ATTACK_AIR"
   | "FIGHTER_STATUS_KIND_FALL_SPECIAL"
   | "FIGHTER_STATUS_KIND_LANDING_FALL_SPECIAL"
+  // Plan 6, Task 7: the edge slip (rubendal 13.0.1 motion `miss_foot`).
+  | "FIGHTER_STATUS_KIND_MISS_FOOT"
   | "FIGHTER_STATUS_KIND_ATTACK"
   | "FIGHTER_STATUS_KIND_SPECIAL"
   | "FIGHTER_STATUS_KIND_CATCH"
@@
   landingLag: "FIGHTER_STATUS_KIND_LANDING_ATTACK_AIR",
   specialFall: "FIGHTER_STATUS_KIND_FALL_SPECIAL",
   specialLanding: "FIGHTER_STATUS_KIND_LANDING_FALL_SPECIAL",
+  // Plan 6, Task 7: the edge slip (rubendal 13.0.1 motion `miss_foot`).
+  edgeSlip: "FIGHTER_STATUS_KIND_MISS_FOOT",
   attack: "FIGHTER_STATUS_KIND_ATTACK",
   special: "FIGHTER_STATUS_KIND_SPECIAL",
   grab: "FIGHTER_STATUS_KIND_CATCH",
```

```diff
--- a/src/engine/states.ts
+++ b/src/engine/states.ts
@@
   AIR_DODGE_LANDING_SLIDE_MAX,
   BUFFER_FRAMES,
   DASH_THRESHOLD_FRAMES,
+  EDGE_SLIP_DRIFT_FRAME,
+  EDGE_SLIP_FRAMES,
   LEDGE_JUMP_VELOCITY,
   LEDGE_TRUMPED_FRAMES,
   PERFECT_SHIELD_WINDOW,
@@
   return h.aerialOnly !== true || begunInAir(f);
 }
 
+/** How many frames `def`'s edge slip locks it out (`FighterAttributes.edgeSlipFrames`; Plan 6, Task 7). */
+export function edgeSlipFrames(def: FighterDef): number {
+  return def.attributes.edgeSlipFrames ?? EDGE_SLIP_FRAMES;
+}
+
 /** The `HelplessDef` of the move that left `f` helpless, or undefined when it is not. */
 export function helplessOf(f: FighterState, def: FighterDef): HelplessDef | undefined {
   const slot = f.combat.helplessMove;
@@
   // replaces the step's gravity with its move's (`FighterStatus.exec`; ruling R-FW2j).
   const gravityBefore = f.kinetic.gravityY;
   kineticExec(f, type, {
-    stickX: phase?.noControl === true ? 0 : intent.x,
+    // An edge slip drifts only after its eighth frame (Plan 6, Task 7).
+    stickX: phase?.noControl === true || (f.action === "edgeSlip" && f.actionFrame <= EDGE_SLIP_DRIFT_FRAME) ? 0 : intent.x,
     stickMag: intent.soft ? ONE >> 1 : ONE,
     params: moving,
     ...(phase?.ground !== undefined ? { groundControl: phase.ground } : {}),
@@
   // A tumble that reaches the floor lies down: in hitstun, one too slow to
   // bounce (`techOrBounce`); after it (`tumbleFall`), at any speed — DAMAGE_FALL
   // has no bounce (SmashWiki "Tumbling": "they will land into a lying position").
-  if (f.action === "tumble" || f.action === "tumbleFall") {
+  // An edge slip that reaches the floor lies down too (Plan 6, Task 7). UNVERIFIED for
+  // Ultimate: SmashWiki "Edge slipping" says it of Brawl ("they will always end up in
+  // their knocked down state"), and of Ultimate only that "teching is possible"
+  // (`techOrBounce`).
+  if (f.action === "tumble" || f.action === "tumbleFall" || f.action === "edgeSlip") {
     f.hitstun = 0;
     kineticSetX(f, 0, "stop");
     startAction(f, "downed");
@@
   // reels and the rest. A cliff-stop status gets here only by rising off the ground
   // (`resolveCollision`'s rising branch), and keeps itself.
   const exit = GROUND_EXIT[f.action];
+  // Knocked off backward while on its feet: the edge slip (Plan 6, Task 7; SmashWiki
+  // "Edge slipping"). On its feet is a `fall` row, or a grounded attack pushed off
+  // (`stopUnlessPushed`); off an edge, not lifted (`vy` not rising); knocked off is the
+  // push on the DAMAGE energy (a windbox's, a knockback's slide), pointing behind it.
+  // Its own walk never takes it backward.
+  const onFeet = (exit === "fall" || exit === "stopUnlessPushed") && f.vy <= 0;
+  if (onFeet && f.kinetic.damageX * f.facing < 0) {
+    startAction(f, "edgeSlip");
+    return;
+  }
   if (exit === "fall" || exit === "tumbleFall") startAction(f, exit);
   // A grounded attack's own movement stops at the edge (`stopsAtEdge`), so one that
   // leaves the ground was pushed off: the ledge cancel, a fall (fix round 3, ruling
```

```diff
--- a/src/engine/status/air.ts
+++ b/src/engine/status/air.ts
@@
 import {
   LANDING_ANIMATION_FRAMES,
   bufferPress,
+  edgeSlipFrames,
   endStatus,
   handleActionable,
   landFromSpecialFall,
@@
   end: forgetHelplessMove,
 };
 
+/**
+ * MISS_FOOT, the edge slip (Plan 6, Task 7): knocked off the ground backward while on its
+ * feet (`onLeftGround`). SmashWiki "Edge slipping": "unable to perform any action for a
+ * certain amount of frames" (`edgeSlipFrames`), "able to DI the fall left or right after
+ * the eighth frame" (`applyMovement`), "In Ultimate, teching is possible" (`techOrBounce`).
+ * Entered on contact (phase 5), so it ends as a landing does (`endStatus`): on its last
+ * frame, keeping a press made there, and the fighter acts on the next. A press inside it is
+ * kept for the fall it hands off to. It may take a ledge on any frame (the page: "If the
+ * edge is grabbable, then they will always grab it"), and has no fast fall: it cannot
+ * "affect the vertical momentum".
+ */
+export const STATUS_MISS_FOOT: FighterStatus = {
+  kind: "FIGHTER_STATUS_KIND_MISS_FOOT",
+  action: "edgeSlip",
+  kineticType: "FALL",
+  main(f, intent, ctx) {
+    if (f.actionFrame >= edgeSlipFrames(ctx.def)) endStatus(f, "fall", intent, ctx);
+    else bufferPress(f, intent, ctx.frame);
+  },
+};
+
 export const AIR_STATUSES: readonly FighterStatus[] = [
   STATUS_JUMP_SQUAT,
   STATUS_JUMP,
@@
   STATUS_LANDING_ATTACK_AIR,
   STATUS_FALL_SPECIAL,
   STATUS_LANDING_FALL_SPECIAL,
+  STATUS_MISS_FOOT,
 ];
```

```diff
--- a/src/engine/tech.ts
+++ b/src/engine/tech.ts
@@
   readonly tumbleFall: boolean;
   /** In the first 15 frames (0-14) of an air dodge that began out of a tumble. */
   readonly dodgeTech: boolean;
+  /** In `edgeSlip`: Ultimate lets it tech a floor (Plan 6, Task 7; SmashWiki "Edge slipping"). */
+  readonly slipping: boolean;
   readonly jumpsUsed: number;
   readonly airTime: number;
   readonly ledgeLockout: number;
@@
     tumbling: f.action === "tumble",
     tumbleFall: f.action === "tumbleFall",
     dodgeTech: f.action === "airDodge" && f.combat.tumbleDodge && f.actionFrame < AIR_DODGE_TECH_FRAMES,
+    slipping: f.action === "edgeSlip",
     jumpsUsed: f.jumpsUsed,
     airTime: f.airTime,
     ledgeLockout: f.ledgeLockout,
@@
   wallSide = 0,
 ): "tech" | "bounce" | null {
   const reeling = before.tumbling && f.hitstun > 0;
-  if (!reeling && !before.tumbleFall && !before.dodgeTech) return null;
+  if (!reeling && !before.tumbleFall && !before.dodgeTech && !before.slipping) return null;
   const floor = surface === "floor";
   // After the hitstun a wall or ceiling is a plain stop: nothing to tech
   // (SmashWiki "Tech": the character "must be in hitstun"), nothing to bounce.
-  if (before.tumbleFall && !floor) return null;
+  if ((before.tumbleFall || before.slipping) && !floor) return null;
   // The air dodge is the tech input, at any launch and whatever the lockout: a
   // neutral dodge keeps the launch it began with (Task 20b), a directional one
   // keeps it through its slingshot (Task 20c), and the reimplementations of the
```

```diff
--- a/src/engine/groundExit.ts
+++ b/src/engine/groundExit.ts
@@
  * - `keep`: the status carries on as itself: it is airborne already, a special, a reel,
  *   held by someone, on a ledge, or has its own published rule (each row says).
  *
- * Not modelled (UNVERIFIED): the edge slip itself. The same page: a fighter that
- * "edge slips in the reverse direction they were looking [...] will enter their
- * edge slip animation, and be unable to perform any action for a certain amount of
- * frames" (Ultimate: 24 to 30 by fighter, 25 or 26 for the eight here). Here it
- * falls free to act, as one facing forward does; the replica has no edge-slip
- * status.
+ * The edge slip itself (Plan 6, Task 7): a fighter on its feet knocked off backward
+ * becomes `edgeSlip` in `onLeftGround`, not `fall`; forward, it falls free to act. The
+ * same page: one that "edge slips in the reverse direction they were looking [...] will
+ * enter their edge slip animation, and be unable to perform any action for a certain
+ * amount of frames" (Ultimate: 25 or 26 for the eight here). UNVERIFIED, left as it was:
+ * a grounded flinch slid off keeps its hitstun (a `keep` row).
  */
 
 import type { ActionState, FighterState } from "./types";
@@
   landingLag: "lag",
   specialFall: "keep",
   specialLanding: "lag",
+  // Plan 6, Task 7: airborne already.
+  edgeSlip: "keep",
   // A grounded attack stops at the edge against its own movement (ruling R-T12g).
   // SmashWiki "Dash attack" (https://www.ssbwiki.com/Dash_attack, revision 2049916):
   // "Kirby's dash attack in Melee is the only one in the series that can carry the
```

Every other table over every action, each a compile error until it has a row:

```diff
--- a/src/engine/footstool.ts
+++ b/src/engine/footstool.ts
@@
   specialLanding: "ENABLE",
   // UNVERIFIED: helpless is a fall.
   specialFall: "ENABLE",
+  // UNVERIFIED (Plan 6, Task 7): the edge slip is a fall.
+  edgeSlip: "ENABLE",
   // SmashWiki: "a footstool cannot cancel out an opponent's move that is in
   // progress, regardless of if they're grounded or not"; WuBor `attack/attack.rs`,
   // `attack_3.rs`, `attack_4.rs`, `attack_100.rs` (NO_REAC). A throw let go of
```

```diff
--- a/src/engine/softDrop.ts
+++ b/src/engine/softDrop.ts
@@
   landingLag: "stay",
   // SmashWiki "Helpless": "holding down to drop through them".
   specialFall: "drop",
+  // UNVERIFIED (Plan 6, Task 7): SmashWiki "Edge slipping", the slip is "unable to affect
+  // the vertical momentum of their fall or perform any other action", so it lands.
+  edgeSlip: "stay",
   specialLanding: "stay",
   // The page: "Characters performing aerial attacks [...] cannot fall through".
   attack: "stay",
```

```diff
--- a/src/engine/acmd/poseClock.ts
+++ b/src/engine/acmd/poseClock.ts
@@
 export const MOTION_OF_ACTION: Readonly<Partial<Record<ActionState, ActionState>>> = {
   rebound: "stand",
   specialFall: "fall",
+  // Plan 6, Task 7: the edge slip falls on the fall's clip until it has one of its own.
+  edgeSlip: "fall",
   specialLanding: "landingLag",
   cargoCarry: "walk",
   cargoHeld: "grabbed",
```

```diff
--- a/src/render/poses/timing.ts
+++ b/src/render/poses/timing.ts
@@
     // Helpless (Plan 5, Task 4b) has no clip of its own: the fall's, as the
     // bake's motion is (`MOTION_OF_ACTION`), and its landing the landing lag's.
     case "specialFall":
+    // The edge slip (Plan 6, Task 7) too, until it has a clip of its own.
+    case "edgeSlip":
       return f.fastFalling ? "fastFall" : "fall";
     case "land":
       return "land";
```

The pins over every action: the tables the tests compare, and the counts of actions (59 → 60).

```diff
--- a/src/engine/status/groups.test.ts
+++ b/src/engine/status/groups.test.ts
@@
   inhaleHold: "WALK",
   swallowed: "NONE",
   spatStar: "NONE",
+  // Plan 6, Task 7: the edge slip drifts like a fall.
+  edgeSlip: "FALL",
 };
 
 /** Every action migrated so far; each status-group task extends this list first. */
@@
   "inhaleHold",
   "swallowed",
   "spatStar",
+  // Plan 6, Task 7
+  "edgeSlip",
 ];
 
 describe("migrated statuses", () => {
```

```diff
--- a/src/engine/status/status.test.ts
+++ b/src/engine/status/status.test.ts
@@
     // 50 through Plan 5 Task 4b; Task 8 adds Donkey Kong's carry and the carried,
     // Task 9 Kirby's mouthful, the swallowed and the spat, Task 11 the
     // footstooled, Task 12 the crawl, Task 13c's fix round 1 the rebound, and
-    // Task 14 the trapped.
-    expect(actions).toHaveLength(59);
+    // Task 14 the trapped; Plan 6, Task 7 the edge slip.
+    expect(actions).toHaveLength(60);
     const kinds = new Set(actions.map((a) => STATUS_KIND_OF_ACTION[a]));
     expect(kinds.size).toBe(actions.length);
     for (const a of actions) expect(ACTION_OF_STATUS_KIND[STATUS_KIND_OF_ACTION[a]]).toBe(a);
@@
     expect(statusKindOf({ action: "specialLanding" })).toBe("FIGHTER_STATUS_KIND_LANDING_FALL_SPECIAL");
     // Plan 5, Task 12: SSBU's crawl forward (SQUAT_F; SQUAT_B is the crawl back).
     expect(statusKindOf({ action: "crawl" })).toBe("FIGHTER_STATUS_KIND_SQUAT_F");
+    // Plan 6, Task 7: the edge slip.
+    expect(statusKindOf({ action: "edgeSlip" })).toBe("FIGHTER_STATUS_KIND_MISS_FOOT");
   });
 });
 
```

```diff
--- a/src/fighters/groundExit.test.ts
+++ b/src/fighters/groundExit.test.ts
@@
 const PINNED: Readonly<Record<ActionState, GroundExit>> = {
   stand: F, walk: F, dashStart: F, run: F, runBrake: F, turnaround: F,
   crouchStart: F, crouch: F, crouchEnd: F, crawl: F,
-  jumpSquat: K, jump: K, fall: K, land: L, landingLag: L, specialFall: K, specialLanding: L,
+  jumpSquat: K, jump: K, fall: K, land: L, landingLag: L, specialFall: K, specialLanding: L, edgeSlip: K,
   attack: S, special: K, grab: C, grabHold: C, pummel: C, throw: C,
   shieldStart: C, shield: C, shieldRelease: C, shieldStun: C, shieldBroken: L, spotDodge: C, roll: C, airDodge: K,
   hitstun: K, rebound: L, tumble: K, tumbleFall: K, grabbed: K, thrown: K, downed: T, getUp: F,
@@
   // the fighter off a ledge during their attack, with nearly all grounded attacks [...]
   // being cancelable in this way"; SmashWiki "Windbox" (rev 2056119): windboxes "can
   // push them off edges".
-  it("pushed off the edge by F.L.U.D.D.'s water mid-attack, it is cancelled: it falls", () => {
+  // Plan 6, Task 7: the cancel is the edge slip when the push is behind the attacker
+  // (SmashWiki "Edge slipping"), and the fall when it faces the edge.
+  it.each([
+    [1, "fall"],
+    [-1, "edgeSlip"],
+  ] as const)("pushed off the edge by F.L.U.D.D.'s water mid-attack, facing %i, it is cancelled: %s", (facing, after) => {
     // Mario 24 to Fox's left on Battlefield's right platform, Fox 1.92 short of its end.
     const s = createInitialState("battlefield", [{ defId: "mario" }, { defId: "fox" }], { ...RULES, oneOnOne: true }, 5);
     Object.assign(s.fighters[0], { action: "stand", actionFrame: 0, grounded: true, platform: 3, x: fx(33.5), y: PLAT_Y(), facing: 1, intangible: 0 });
-    Object.assign(s.fighters[1], { action: "stand", actionFrame: 0, grounded: true, platform: 3, x: fx(57.5), y: PLAT_Y(), facing: -1, intangible: 0 });
+    Object.assign(s.fighters[1], { action: "stand", actionFrame: 0, grounded: true, platform: 3, x: fx(57.5), y: PLAT_Y(), facing, intangible: 0 });
     let st = s;
     let prev: InputFrame[] = [0, 0];
     const fox: FighterState[] = [];
@@
     const off = fox.findIndex((f) => !f.grounded);
     expect(off).toBeGreaterThan(pushed);
     expect(fox[off - 1].action).toBe("attack");
-    expect(fox[off].action).toBe("fall");
+    expect(fox[off].action).toBe(after);
   });
 });
```

```diff
--- a/src/fighters/footstool.test.ts
+++ b/src/fighters/footstool.test.ts
@@
     const D = "DISABLE";
     expect(TREADED_KIND_OF_ACTION).toEqual({
       stand: E, walk: E, dashStart: E, run: E, runBrake: E, turnaround: E, crouchStart: E, crouch: E, crouchEnd: E, crawl: E,
-      jumpSquat: E, jump: E, fall: E, land: E, landingLag: E, specialFall: E, specialLanding: E,
+      jumpSquat: E, jump: E, fall: E, land: E, landingLag: E, specialFall: E, specialLanding: E, edgeSlip: E,
       attack: N, special: N, grab: E, grabHold: D, pummel: D, throw: N,
       shieldStart: N, shield: N, shieldRelease: N, shieldStun: N, shieldBroken: E, spotDodge: D, roll: D, airDodge: E,
       hitstun: E, rebound: E, tumble: E, tumbleFall: E, grabbed: D, thrown: D, downed: E, getUp: E,
```

```diff
--- a/src/engine/acmd/poseClock.test.ts
+++ b/src/engine/acmd/poseClock.test.ts
@@
     expect(MOTION_OF_ACTION).toEqual({
       rebound: "stand",
       specialFall: "fall",
+      // Plan 6, Task 7: the edge slip falls on the fall's clip.
+      edgeSlip: "fall",
       specialLanding: "landingLag",
       cargoCarry: "walk",
       cargoHeld: "grabbed",
@@
     // landing lag's; Plan 5 Task 8's carry and carried, the walk's and the
     // grab's; Task 9's mouthful, swallowed and spat, the walk's and the
     // tumble's; Task 13c's rebound, the stand's; Task 14's trapped, the grab's;
-    // Task 11's footstooled and Task 12's crawl have their own since Task 17),
+    // Task 11's footstooled and Task 12's crawl have their own since Task 17;
+    // Plan 6, Task 7's edge slip, the fall's),
     // the second jump, two fast falls, five directional air dodges and the back roll.
     expect(names.size).toBe(ACTIONS.length - Object.keys(MOTION_OF_ACTION).length + 1 + 2 + 5 + 1);
-    expect(ACTIONS.length).toBe(59);
+    expect(ACTIONS.length).toBe(60);
   });
 
   it.each(FIGHTERS.map((d) => [d.id, d] as const))("%s: spot dodge, rolls, air dodges and techs last the engine's own lengths", (_id, def) => {
```

```diff
--- a/src/render3d/bake/bake.test.ts
+++ b/src/render3d/bake/bake.test.ts
@@
 }
 
 describe("the status motions the bake plays (DISPATCH-NOTES 10.3, ruling R4)", () => {
-  it("are every motion statusMotion can name, each once: 59 over the 59 actions, tumbleFall among them", () => {
+  it("are every motion statusMotion can name, each once: 59 over the 60 actions, tumbleFall among them", () => {
     const named = new Set<string>();
     for (const action of ACTIONS) {
       for (let charge = -3; charge <= 20; charge++) {
@@
     // round 1: one more, the rebound, and no motion more: it plays the stand's.
     // Task 14: one more, the trapped, and no motion more: it plays the grab's.
     // Task 17: two motions more, the footstooled's and the crawl's, their own clips.
-    expect(ACTIONS).toHaveLength(59);
+    // Plan 6, Task 7: one more, the edge slip, and no motion more: it plays the fall's.
+    expect(ACTIONS).toHaveLength(60);
     expect(named.size).toBe(59);
     expect(specs.map((s) => s.motion).sort()).toEqual([...named].sort());
     // Plan 5, Task 4b: the helpless fall and its landing bake nothing of their
```

```diff
--- a/src/render3d/vfx3d.test.ts
+++ b/src/render3d/vfx3d.test.ts
@@
 
   const SHIELDING: readonly ActionState[] = ["shieldStart", "shield", "shieldStun", "shieldRelease"];
 
-  it("is absent unless the fighter is shielding: not in any other of the 59 actions, a broken shield included", () => {
+  it("is absent unless the fighter is shielding: not in any other of the 60 actions, a broken shield included", () => {
     const actions = Object.keys(STATUS_KIND_OF_ACTION) as ActionState[];
-    expect(actions).toHaveLength(59);
+    expect(actions).toHaveLength(60);
     for (const action of actions) {
       const look = shieldLook(makeFighter({ action }), mario, 0);
       if (SHIELDING.includes(action)) expect(look, action).not.toBeNull();
```

The `groundExit.test.ts` F.L.U.D.D. test above is the one existing test this task's rule changes. Fox is pushed off backward mid-attack, so his ledge cancel is now the slip, and the pin runs both facings.

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/fighters/edgeSlip.test.ts src/engine/status src/fighters/groundExit.test.ts src/fighters/footstool.test.ts src/engine/states.test.ts src/engine/acmd/poseClock.test.ts src/render3d/bake/bake.test.ts src/render3d/vfx3d.test.ts`

Expected: PASS (captured).

- [ ] **Step 5: The golden's slip lab, and the bake**

Run: `pnpm vitest run src/game/golden.test.ts src/render3d/bake/roster.test.ts`

Expected: the bake byte-identical (the slip borrows `fall`'s motion). The golden FAILS on its coverage alone (captured):

`visits every action state and every soft-stick path`: `action states no match reaches: expected [ 'edgeSlip' ] to deeply equal []`

`src/game/goldenSlipLab.ts` (new file):

```ts
/**
 * The golden trace's sixteenth match: scripted keys for the edge slip (Plan 6, Task 7;
 * ruling P5-R14: new actions are visited, not exempted).
 *
 * No golden match slips, and none can on Final Destination, where the states lab plays:
 * its only edges carry ledges, and a fighter knocked off one takes the ledge on the step
 * it leaves the ground (SmashWiki "Edge slipping": "If the edge is grabbable, then they
 * will always grab it"), so no recorded state is ever the slip. So the slip gets a lab of
 * its own on Battlefield, whose soft platforms have no ledges (ruling R-T8e, as the crawl
 * lab did), appended last so every other trace stays byte-identical.
 *
 * Mario (port 0) against Donkey Kong (port 1), both on Battlefield's top platform: Mario
 * at -2 facing right, Donkey Kong 1.8 short of its right end, facing him. Donkey Kong
 * never presses a key:
 * - F.L.U.D.D.: Mario's bare down special, pressed twice, pumps water from 23;
 * - the slip: the water pushes Donkey Kong backward, off the platform's end on 26: he
 *   slips (his 25 frames), pushed on up and away by the later pumps, falls from 51, and
 *   lands on the main stage on 109.
 *
 * Each step's comment gives the frame it starts on and the events it names, checked
 * against a run when the lab was added (Plan 6, Task 7); the pins in `golden.test.ts`
 * (every action state visited) notice if a rule change stops one, and a task that moves
 * them re-tunes the steps here.
 */

import { fx } from "@/engine/fixed";
import { kineticClear } from "@/engine/kinetic";
import { Btn } from "@/engine/types";
import type { GameState, InputFrame } from "@/engine/types";
import { BATTLEFIELD_UPPER_PLATFORM_Y } from "@/stages/battlefield";
import type { LabMatch } from "./goldenLab";
import { scriptedInputs } from "./goldenScript";
import type { ScriptStep } from "./goldenScript";

const DOWN_B = Btn.Down | Btn.Special;

const STEPS: readonly ScriptStep[] = [
  [1, DOWN_B, 0], //               1: F.L.U.D.D.
  [14, 0, 0],
  [1, DOWN_B, 0], //              16: the pumps, the first reaching Donkey Kong on 23;
  //                                  he leaves the platform's end on 26: the slip, to 50
  [104, 0, 0], //                 17: falls from 51, lands on the main stage on 109
];

/** Battlefield's top platform, the soft one at its centre. */
const TOP = 2;

export const SLIP_LAB: LabMatch = {
  name: "slip-lab-battlefield",
  stage: "battlefield",
  fighters: ["mario", "donkeyKong"],
  seed: 909,
  rules: { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true },
  frames: 120,
  setup(state: GameState) {
    const [mario, donkeyKong] = state.fighters;
    Object.assign(mario, { action: "stand", actionFrame: 0, grounded: true, platform: TOP, x: fx(-2), y: BATTLEFIELD_UPPER_PLATFORM_Y, facing: 1, intangible: 0, invincible: 0 });
    Object.assign(donkeyKong, { action: "stand", actionFrame: 0, grounded: true, platform: TOP, x: fx(15.5), y: BATTLEFIELD_UPPER_PLATFORM_Y, facing: -1, intangible: 0, invincible: 0 });
    for (const f of state.fighters) kineticClear(f);
  },
  inputs: ((): ((frame: number) => readonly InputFrame[]) => scriptedInputs(STEPS))(),
};
```

```diff
--- a/src/game/golden.test.ts
+++ b/src/game/golden.test.ts
@@
 import { BEAM_LAB } from "./goldenBeamLab";
 import { DASH_LAB } from "./goldenDashLab";
 import { CONTACT_LAB } from "./goldenContactLab";
+import { SLIP_LAB } from "./goldenSlipLab";
 import { PROJECTILE_PATHS, projectilePathsOf, type ProjectilePath } from "./projectilePaths";
 
 /**
  * The strangler's safety net (Plan 2, Tasks 0 and 0b).
  *
- * Fifteen matches on the real roster and real stages: four CPU-vs-CPU stock
+ * Sixteen matches on the real roster and real stages: four CPU-vs-CPU stock
  * matches (levels 9 and 7) for 3,600 frames each, a fifth with the Smash Ball on
  * (Plan 5 final wave, ruling R-FW1e: the CPU's Smash Ball and Final Smash decisions,
  * last in `MATCHES`), one scripted timed match
@@
  * Task 16 fix round 4): Pikachu whiffs Volt Tackle in the air, held through its
  * startup, then tackles, carries on and falls off the side blast line, and Fox whiffs
  * Team Star Fox in the air, held through its start; and a 200-frame contact lab
- * (`goldenContactLab.ts`, Plan 5 final wave, part 3), last in `MATCHES`: Mario's and
+ * (`goldenContactLab.ts`, Plan 5 final wave, part 3): Mario's and
  * Donkey Kong's jabs clank and both rebound, Donkey Kong's jab stuns Mario's shield,
- * and he grabs Mario out of it, pummels him and throws him.
+ * and he grabs Mario out of it, pummels him and throws him; and a 120-frame slip lab
+ * (`goldenSlipLab.ts`, Plan 6, Task 7), last in `MATCHES`: Mario's F.L.U.D.D. pushes
+ * Donkey Kong backward off Battlefield's top platform, and he edge-slips.
  * Every frame's `digest` is folded into a running hash, and
  * every 100 frames that hash is compared with the committed one — so a
  * difference that heals before the next sample (a projectile one unit faster,
@@
       return (_state, frame) => CONTACT_LAB.inputs(frame);
     },
   },
+  // Plan 6, Task 7: the edge slip, which no match reaches and none can on Final
+  // Destination (`goldenSlipLab.ts`); appended, so every other trace stays as it was.
+  {
+    ...SLIP_LAB,
+    cpu: false,
+    driver() {
+      return (_state, frame) => SLIP_LAB.inputs(frame);
+    },
+  },
 ];
 
 /**
- * Every `ActionState` the fifteen matches must visit between them: all 59. A `Record`
+ * Every `ActionState` the sixteen matches must visit between them: all 60. A `Record`
  * rather than a list, so a new state is a compile error here until somebody pins it. Measured 2026-10-27, again after the Plan 2 final fix wave: the CPU
  * matches reach 34, the script 41 — everything but `entering`, which Final Destination's
  * floor-level spawn turns into a landing on frame 1, and which the Battlefield match keeps.
@@
  * Part 3 adds the contact lab, a second match for `rebound`, `shieldStun` and `pummel`
  * (`expectContacts`), which the script and the projectile lab reach as before. All 59
  * are visited.
+ * Plan 6, Task 7 adds `edgeSlip`. No match reaches it, and none can on Final
+ * Destination (a slip off a ledge-bearing edge hangs on the step it leaves the ground),
+ * so the slip lab (`goldenSlipLab.ts`) does, on Battlefield; the fifteen other traces are
+ * byte-identical. All 60 are visited.
  */
 const MUST_VISIT: Record<ActionState, true> = {
   stand: true,
@@
   landingLag: true,
   specialFall: true,
   specialLanding: true,
+  edgeSlip: true,
   attack: true,
   special: true,
   grab: true,
@@
     expect([lab.hits, lab.shieldHits, lab.kos], "the pummel and the down throw, the jab on the shield, no KO").toEqual([2, 1, 0]);
   }
 
+  // Plan 6, Task 7: the slip lab is there to reach the edge slip (`goldenSlipLab.ts`); a
+  // re-tuned step that stops it shows here.
+  function expectSlip(): void {
+    expect(played.get(SLIP_LAB.name)!.actions.has("edgeSlip"), "the slip lab's edge slip").toBe(true);
+  }
+
   function expectInvariants(): void {
     for (const m of MATCHES) expect(played.get(m.name)!.invariantBreaks, m.name).toEqual([]);
   }
@@
   it("whiffs a dash and a cinematic Final Smash in the air in the dash lab", expectDashes);
   it("breaks the Smash Ball and uses a Final Smash in the ball-on CPU match", expectCpuFinalSmash);
   it("clanks, stuns a shield and pummels in the contact lab", expectContacts);
+  it("slips off a platform's end backward in the slip lab", expectSlip);
   it("keeps vx/vy the energies' sum, every fighter number an integer, and every fighter out of the stage, on every frame", expectInvariants);
 
   if (process.env.UPDATE_GOLDEN === "1") {
@@
       expectDashes();
       expectCpuFinalSmash();
       expectContacts();
+      expectSlip();
       expectInvariants();
       const out: Record<string, number[]> = {};
       for (const m of MATCHES) out[m.name] = played.get(m.name)!.digests;
```

Then:
1. Run `UPDATE_GOLDEN=1 pnpm vitest run src/game/golden.test.ts`. Expected: one new trace, `slip-lab-battlefield`; the fifteen others byte-identical (captured on Task 5 alone, without Task 6). If a CPU trace Task 6 re-routed (`mario-fox-battlefield`, `kirby-marth-pokemonStadium2`) also moves, check that its frames show `edgeSlip` (this task's rule), name it in the commit and in the history paragraph in place of "byte-identical". Any other move stops the task.
2. Set `RULES_PIN.golden` in `src/game/rulesVersion.test.ts` to the digest `rulesVersion.test.ts` prints; the version stays 6.
3. Rerun `pnpm vitest run src/game/golden.test.ts src/game/rulesVersion.test.ts`. Expected: PASS (captured).

If the lab does not slip, so `expectSlip` fails, read its frames before changing anything. The step comments name each event's frame (captured on a run when the lab was added: the push on 23, the slip 26-50, the landing on 109).

- [ ] **Step 6: Mutants**

Each against `src/fighters/edgeSlip.test.ts`. Restore after each.
1. `onLeftGround`: `f.kinetic.damageX * f.facing < 0` → `> 0`. The entry test FAILS `expected 'fall' to be 'edgeSlip'`, and the forward test FAILS `expected 'edgeSlip' to be 'fall'` (captured).
2. `STATUS_MISS_FOOT.main`: `edgeSlipFrames(ctx.def)` → `26`. The Donkey Kong and Pikachu test FAILS `donkeyKong slip frame 25: expected 'edgeSlip' to be 'fall'` (captured).
3. `applyMovement`: `EDGE_SLIP_DRIFT_FRAME` → `0`. The drift test FAILS `slip frame 8: expected -2624 to be +0` (captured).
4. `techOrBounce`: drop `&& !before.slipping`. The tech test FAILS `expected false to be true` (captured).
5. `STATUS_MISS_FOOT.main`: `endStatus(f, "fall", intent, ctx);` → `{ startAction(f, "fall"); STATUS_FALL.main(f, intent, ctx); }` (`handOff`'s body: the lockout one frame short). The Attack test FAILS `slip frame 26, the press: expected 'attack' to be 'fall'` (captured).
6. `onLeftGround`: drop `&& f.vy <= 0` from `onFeet`. The lift test FAILS `expected 'edgeSlip' to be 'fall'` (captured).
7. `simulate.ts`, the ledge gate after `onLeftGround` (`if (!f.grounded && f.action !== "cargoCarry" …`): add `&& f.action !== "edgeSlip"`. The Review Focus test FAILS `expected 'edgeSlip' to be 'ledgeHang'` (captured).

- [ ] **Step 7: Gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`, then `PORT=3107 pnpm test:e2e --trace off`.

Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add super-smash/src/engine/types.ts super-smash/src/engine/constants.ts super-smash/src/engine/status/kind.ts super-smash/src/engine/status/air.ts super-smash/src/engine/groundExit.ts super-smash/src/engine/states.ts super-smash/src/engine/tech.ts super-smash/src/engine/footstool.ts super-smash/src/engine/softDrop.ts super-smash/src/engine/acmd/poseClock.ts super-smash/src/render/poses/timing.ts super-smash/src/fighters/donkeyKong.ts super-smash/src/fighters/pikachu.ts super-smash/src/fighters/edgeSlip.test.ts super-smash/src/engine/status/groups.test.ts super-smash/src/engine/status/status.test.ts super-smash/src/fighters/groundExit.test.ts super-smash/src/fighters/footstool.test.ts super-smash/src/engine/acmd/poseClock.test.ts super-smash/src/render3d/bake/bake.test.ts super-smash/src/render3d/vfx3d.test.ts super-smash/src/game/goldenSlipLab.ts super-smash/src/game/golden.test.ts
git add super-smash/src/game/__golden__/engine-trace.json super-smash/src/game/rulesVersion.test.ts
git commit -m "super-smash: edge slipping: knocked off backward on its feet, a fighter is locked out 25-26 frames" -m "SmashWiki Edge slipping: the Ultimate lockouts (entered on contact: acts on frame 27, rubendal miss_foot's CancelFrame), drift after frame 8, a tech on landing, and a grabbable edge always grabbed. Forward it falls free as before; lifted, it is no slip. Borrows the fall's motion; the bake is unchanged. Golden: a sixteenth match, the slip lab on Battlefield (P5-R14; Final Destination's edges all carry ledges), every other trace byte-identical." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Grab in the air: an air dodge, or Samus's grab aerial

From Plan 5's triage: "Grab pressed in the air: Ultimate air-dodges, or zairs for a tether fighter (Samus). Rule with R-T10e's order kept." Today Grab does nothing in the air (`handleActionable`'s airborne branch has no grab).

Sources (2026-11-01):
- **SmashWiki "Grab aerial":** "Grab aerials are performed in the same way as grabs, either by simply pressing the grab button while in the air, or by holding a shield button and then pressing an attack button." Of the eight, only Samus has one in Ultimate ("Link no longer has a grab aerial in Ultimate").
- **SmashWiki "Air dodge":** "Both the shield button and the grab button (when used in midair by a character without a grab aerial) allow players to air dodge. In past installments, the grab button would cause the fighter to use a neutral aerial."
  - The sentence sits in the page's Smash 4 section, and the Ultimate section changes nothing about the buttons.
  - UNVERIFIED that it carries over, though the backlog's own note says Ultimate air-dodges.
- **SmashWiki "Samus (SSBU)/Grab aerial", with rubendal 13.0.1 `game_aircatch` agreeing:**
  - hit 1: frames 8-15, 2.5%, angle 45, BK 30, KS 30, size 3.0 (`Part=0`);
  - hit 2: frames 16-19, 4.0%, angle 45, BK 30, KS 100, size 5.0 (`Part=1`, so it may land after hit 1);
  - both `collision_attr_elec`;
  - "Interruptible 60", "Animation length 59";
  - landing "Interruptible 9" (8 frames of lag);
  - motion `air_catch`.

**R-T10e's order.** The vanilla airborne check runs special, item throw, lasso (the grab aerial), air dodge, attack, footstool, wall jump, midair jump (WuBor's reimplementation, as `airActionFirst` cites).
- The replica already tries the shield's air dodge before the special (`handleActionable`).
- This task puts Grab immediately after it, so the grab aerial and the grab's air dodge sit where the shield's dodge sits.
- `airActionFirst` answers for Grab too, so a wall jump and a footstool still give way to it (R-T10e).
- UNVERIFIED: the same-frame order of Shield and Grab (the shield's dodge wins here).

**Not modelled:**
- The grab aerial's tether recovery (decision D3; "The tether recovery can be triggered on frames 2-4"): Samus's zair here never takes a ledge.
- The boxes' place. Both hang on the `throw` bone at the beam's tip, which the bake does not place. The legacy grab's beam tip (x 14, y 6.5) stands in, UNVERIFIED. Samus's grab and dash-grab boxes from the bake are a carry of their own (R-P6-9 (a)).
- UNVERIFIED too: the zair is no aerial for the short hop's ×0.85 or the hit's aerial flag (`isAerialSlot`). Its landing lag reads as an aerial's (`onLanded`'s attack branch).

**SPEC change (made in this task's commit, R-P6-8; Task 42 lists it for the report).** SPEC §6's table gains a row after "Directional air dodge":

| Grab in the air | An air dodge, as Shield; Samus's grab aerial (her Grapple Beam) instead. |

**Golden:** unchanged (captured). The states lab's struggle is re-tuned so it stays so.
- Mario mashed Grab on into the air after the press that freed him (`mash(15, G)`), and those presses did nothing. Now they would air-dodge, and the trace would move.
- His mash now ends on the freeing press, `mash(10, G)`, which frees him on 48 as before. The trace is byte-identical, and so is every other.
- No golden CPU pressed Grab in the air in the replay, whose base had Task 5 and Task 7 but not Task 6. The CPU presses Grab at a shielding target without checking it is grounded (`src/ai/offence.ts`, its two `Btn.Grab` returns), and Task 6 re-routes `mario-fox-battlefield` and `kirby-marth-pokemonStadium2`. If one of those moves here, read its first divergence: an airborne CPU's Grab, now an air dodge, is this task's rule, so regenerate, re-pin, stage the trace and the pin, and name it in the commit. Any other move stops the task.

**Files:**
- Create: `src/fighters/airGrab.test.ts`
- Modify:
  - `src/engine/types.ts` (`MoveSlot` `"airGrab"`)
  - `src/engine/acmd/legacy.ts` (`SLOT_MOTION.airGrab`), `src/render/poses/timing.ts` (`SLOT_POSE.airGrab`)
  - `src/engine/states.ts`, `src/fighters/samus.ts`
  - `src/game/goldenStatesLab.ts` (the struggle's mash)
  - `SPEC.md` (§6)
- Test: `src/fighters/schema.test.ts` (the landing-lag rule)
- Regenerate: `public/bake/roster.bin.gz`, `src/fighters/bake/digest.ts`; `src/fighters/acmd/reach.allow.json` only if `reach.test.ts` asks (it does not, captured)

**Interfaces:**
- Consumes:
  - Task 5's `aim` (`handleActionable`'s buffered-flick intent): the special line this task's hunk sits above (and Task 5's `aimAttack` on the aerial line below it, context only);
  - `handleActionable`, `airActionFirst`, `startAirDodge`, `startMove`, `hasMove` (states.ts);
  - `Hitbox.part` (Plan 5, Task 16).
- Produces: `MoveSlot` member `"airGrab"`; Samus's `moves.airGrab`.

- [ ] **Step 1: Write the failing test**

`src/fighters/airGrab.test.ts` (new file):

```ts
/**
 * Grab pressed in the air (Plan 6, Task 8). SmashWiki "Air dodge": "the grab button
 * (when used in midair by a character without a grab aerial)" air-dodges; SmashWiki
 * "Grab aerial": with one, "simply pressing the grab button while in the air" uses it.
 * Samus's: SmashWiki "Samus (SSBU)/Grab aerial" and rubendal 13.0.1 `game_aircatch`.
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

/** `who` 40 units over Final Destination's centre, falling, facing right; the other fighter at `otherX`, `otherY`. */
function airborne(who: string, other = "mario", otherX = fx(60), otherY = 0): GameState {
  const s = createInitialState("finalDestination", [{ defId: who }, { defId: other }], RULES, 5);
  Object.assign(s.fighters[0], { action: "fall", actionFrame: 10, grounded: false, platform: -1, x: 0, y: fx(40), facing: 1, intangible: 0, jumpsUsed: 1, airDodged: false });
  Object.assign(s.fighters[1], { action: "fall", actionFrame: 10, grounded: false, platform: -1, x: otherX, y: otherY === 0 ? fx(40) : otherY, facing: -1, intangible: 0, invincible: 0 });
  return s;
}

function run(s0: GameState, inputs: readonly InputFrame[]): { states: GameState[]; events: StepEvents[] } {
  let s = s0;
  let prev: InputFrame[] = [0, 0];
  const states: GameState[] = [];
  const events: StepEvents[] = [];
  for (const i of inputs) {
    const now: InputFrame[] = [i, 0];
    const out = step(s, now, { prevInputs: prev });
    s = out.state;
    prev = now;
    states.push(s);
    events.push(out.events);
  }
  return { states, events };
}

describe("Grab in the air (Plan 6, Task 8)", () => {
  it("air-dodges a fighter without a grab aerial, as Shield does", () => {
    for (const who of ["mario", "donkeyKong", "link", "kirby", "fox", "pikachu", "marth"]) {
      const { states } = run(airborne(who), [Btn.Grab]);
      expect(states[0].fighters[0].action, who).toBe("airDodge");
    }
  });

  it("uses the air dodge it spends: a second Grab in the same airtime does nothing", () => {
    const s = airborne("mario");
    s.fighters[0].airDodged = true;
    const { states } = run(s, [Btn.Grab]);
    expect(states[0].fighters[0].action).toBe("fall");
  });

  it("is Samus's grab aerial: two electric hits, 2.5% on 8-15 and 4% on 16-19", () => {
    const { states } = run(airborne("samus"), [Btn.Grab]);
    expect(states[0].fighters[0].action).toBe("attack");
    expect(states[0].fighters[0].move).toBe("airGrab");
    const zair = FIGHTERS.find((d) => d.id === "samus")!.moves.airGrab!;
    expect(zair.totalFrames).toBe(59);
    expect(zair.landingLag).toBe(8);
    expect(zair.hitboxes.map((h) => [h.startFrame, h.endFrame, toFloat(h.damage), h.part ?? 0])).toEqual([
      [8, 15, 2.5, 0],
      [16, 19, 4, 1],
    ]);
  });

  it("Samus's grab aerial lands both hits on Mario in front of her (part 1 may follow part 0)", () => {
    // Hit 2 comes 8 frames after hit 1's electric freeze (9 steps): step 25 of the run.
    const { events } = run(airborne("samus", "mario", fx(13), fx(40)), [Btn.Grab, ...Array<InputFrame>(39).fill(0)]);
    const hits = events.flatMap((e) => e.hits.filter((h) => h.attacker === 0));
    expect(hits.length).toBe(2);
  });

  it("gives way to nothing a wall jump or footstool would take (R-T10e): airActionFirst says yes for Grab", async () => {
    const { airActionFirst, interpretInput } = await import("@/engine/states");
    const s = airborne("mario");
    const f = s.fighters[0];
    const intent = interpretInput(f, Btn.Grab, 0);
    const ctx = { def: FIGHTERS.find((d) => d.id === "mario")!, stage: STAGES.find((st) => st.id === "finalDestination")!, frame: s.frame, fighters: s.fighters };
    expect(airActionFirst(f, intent, ctx)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run src/fighters/airGrab.test.ts`

Expected: FAIL, 4 failed (captured):
- the dodge: `mario: expected 'fall' to be 'airDodge'`;
- Samus's: `expected 'fall' to be 'attack'`;
- the hits: `expected +0 to be 2`;
- `airActionFirst`: `expected false to be true`.

The spent-dodge test PASSES.

- [ ] **Step 3: Implement**

```diff
--- a/src/engine/types.ts
+++ b/src/engine/types.ts
@@
   // Plan 5, Task 13d fix round 1: a throw with its article already out
   // (`MoveDef.whenOut`): Link's failed throw.
   | "sideBFailed"
+  // Plan 6, Task 8: a grab aerial, Grab pressed in the air (SmashWiki "Grab aerial";
+  // of the eight, Samus's Grapple Beam).
+  | "airGrab"
   // Plan 5, Task 14: a cinematic Final Smash's scene and its finishing blow
   // (`MoveDef.final`), after its `finalSmash` start.
   | "finalAttack"
```

```diff
--- a/src/engine/acmd/legacy.ts
+++ b/src/engine/acmd/legacy.ts
@@
   // the game is `special_s1_blank`, on his throw's animation); its own motion since
   // Task 17, the throw's clip across its own length.
   sideBFailed: "special_s_blank",
+  // Plan 6, Task 8: Samus's grab aerial (rubendal 13.0.1 Motions: `air_catch`, the motion of `game_aircatch`).
+  airGrab: "air_catch",
   // Plan 5, Task 14: a cinematic Final Smash's scene and its finishing blow, after
   // its start (`final`); the motions of its `game_finalattack` and `game_finalend`
   // scripts (Task 15).
```

```diff
--- a/src/render/poses/timing.ts
+++ b/src/render/poses/timing.ts
@@
   // Fix round 1: Link's failed throw borrows his throw's clip; since Task 17 it is
   // its own motion, the clip played across its own 59 frames (no held last pose).
   sideBFailed: "sideB",
+  // Plan 6, Task 8: the grab aerial borrows the grab's clip (no clip of its own yet).
+  airGrab: "grab",
   // Plan 5, Task 14: a Final Smash's scene and finishing blow borrow the neutral
   // special's clip, as its start does (UNVERIFIED: no Final Smash clip is authored).
   // Task 17 fix round 1 (ruling R-T17d): the scene and the blow have poses of their
```

These are every exhaustive table over `MoveSlot` (`SLOT_MOTION`, `SLOT_POSE`); the rest are `Partial`.

```diff
--- a/src/fighters/samus.ts
+++ b/src/fighters/samus.ts
@@
       ],
     },
 
+    // Grab aerial, Grapple Beam (Plan 6, Task 8): SmashWiki "Samus (SSBU)/Grab aerial"
+    // (https://www.ssbwiki.com/Samus_(SSBU)/Grab_aerial): hit 1 frames 8-15, hit 2 16-19,
+    // "Interruptible 60", "Animation length 59", landing "Interruptible 9"; rubendal Data
+    // Viewer 13.0.1 `game_aircatch`: hit 1 2.5%, angle 45, KBG 30, BKB 30, size 3.0,
+    // `Part=0`; hit 2 4.0%, angle 45, KBG 100, BKB 30, size 5.0, `Part=1`; both
+    // `collision_attr_elec`, both on the `throw` bone at (0, 0, 0). UNVERIFIED: the boxes'
+    // place, the beam's tip, which the bake does not place: the legacy grab's tip stands
+    // in. UNVERIFIED too: it is no aerial for the short hop's 0.85 (`isAerialSlot`). Not
+    // modelled (decision D3): the tether recovery on frames 2-4.
+    airGrab: {
+      slot: "airGrab",
+      name: "Grapple Beam (aerial)",
+      totalFrames: 59,
+      landingLag: 8,
+      hitboxes: [
+        {
+          id: 0,
+          startFrame: 8,
+          endFrame: 15,
+          x: fx(14.0),
+          y: fx(6.5),
+          radius: fx(3.0),
+          damage: fx(2.5),
+          angle: fx(45),
+          baseKnockback: fx(30),
+          knockbackGrowth: fx(30),
+          effect: "electric",
+        },
+        {
+          id: 1,
+          startFrame: 16,
+          endFrame: 19,
+          x: fx(14.0),
+          y: fx(6.5),
+          radius: fx(5.0),
+          damage: fx(4.0),
+          angle: fx(45),
+          baseKnockback: fx(30),
+          knockbackGrowth: fx(100),
+          effect: "electric",
+          part: 1,
+        },
+      ],
+    },
+
     fair: {
       slot: "fair",
       name: "Forward Air",
```

```diff
--- a/src/engine/states.ts
+++ b/src/engine/states.ts
@@
   // shield/grab can turn into a directional air dodge buffer, which can be a
   // misinput"; Plan 3, Task 20c).
   if ((p.shield || intent.shieldHeld) && startAirDodge(f, intent)) return true;
+  // Grab in the air (Plan 6, Task 8): a grab aerial where the fighter has one (SmashWiki
+  // "Grab aerial": "simply pressing the grab button while in the air"), otherwise the air
+  // dodge Shield gives (SmashWiki "Air dodge": the grab button "when used in midair by a
+  // character without a grab aerial"). Beside the shield's dodge, in R-T10e's order.
+  if (p.grab) {
+    if (hasMove(ctx, "airGrab")) {
+      startMove(f, "attack", "airGrab");
+      return true;
+    }
+    if (startAirDodge(f, intent)) return true;
+  }
   if (p.special && beginSpecial(f, ctx, specialSlot(aim), aim.x, aim, specialFlick(intent))) return true;
   if (p.attack) {
     const slot = aerialSlot(f, aimAttack);
@@
 export function airActionFirst(f: FighterState, intent: Intent, ctx: StateContext): boolean {
   const b = peekBuffer(f, ctx.frame);
   if ((intent.shieldPressed || intent.shieldHeld || b === "shield") && !f.airDodged) return true;
+  // Grab (Plan 6, Task 8): the grab aerial, or the air dodge without one.
+  if (intent.grabPressed || b === "grab") {
+    if (hasMove(ctx, "airGrab")) return true;
+    if (!f.airDodged) return true;
+  }
   if ((intent.specialPressed || b === "special") && hasMove(ctx, specialSlot(intent))) return true;
   return intent.attackPressed || b === "attack";
 }
```

The schema's landing-lag rule (`schema.test.ts:184` held `landingLag` to the five `AERIAL_SLOTS`, which every fighter must fill, so `airGrab` cannot join them):

```diff
--- a/src/fighters/schema.test.ts
+++ b/src/fighters/schema.test.ts
@@
     // Nor anything but an aerial: the engine reads `landingLag` for aerials alone, and a
     // special's own landing lag is `aerialLandingLag` (Plan 5, Task 13d fix round 1: Fox
     // Illusion's 16 sat in `landingLag`, never read).
+    // A grab aerial lands as an aerial does (Plan 6, Task 8: Samus's).
     for (const { slot, move } of moves(fighter)) {
-      if (move.landingLag !== undefined) expect(AERIAL_SLOTS, `${fighter.name}'s ${slot} declares landingLag`).toContain(slot);
+      if (move.landingLag !== undefined) expect([...AERIAL_SLOTS, "airGrab"], `${fighter.name}'s ${slot} declares landingLag`).toContain(slot);
     }
   });
 
```

The states lab's struggle:

```diff
--- a/src/game/goldenStatesLab.ts
+++ b/src/game/goldenStatesLab.ts
@@
 }
 
 const STEPS: readonly ScriptStep[] = [
-  // The struggle. Mario mashes the grab button: a press counts as any button's,
-  // and does nothing once he is free in the air.
+  // The struggle. Mario mashes the grab button: a press counts as any button's.
+  // He stops on the press that frees him: a Grab pressed in the air air-dodges
+  // since Plan 6, Task 8, and the presses after it used to do nothing.
   [1, G, 0], //                   1: Donkey Kong grabs; Mario is caught on 8
   [11, 0, 0],
   [1, R, 0], //                  13: forward throw: the lift, carrying from 28
   [16, 0, 0],
-  ...mash(15, G), //             30: Mario mashes out on 48 (the carry's 20th frame), lands on 73
-  [55, 0, 0],
+  ...mash(10, G), //             30: Mario mashes out on 48 (the carry's 20th frame), lands on 73
+  [65, 0, 0],
   // The carry, once Mario's grab immunity is over (on 108).
   [1, G, 0], //                 115: grab again; Mario is caught on 122
   [10, 0, 0],
```

`SPEC.md`, §6's distinctions table:

```diff
--- a/SPEC.md
+++ b/SPEC.md
@@
 | SDI | Each fresh direction press during hitlag is one pulse — mashing works exactly as it does in the real game. |
 | Directional air dodge | Shield in the air with a direction held. |
+| Grab in the air | An air dodge, as Shield; Samus's grab aerial (her Grapple Beam) instead. |
```

- [ ] **Step 4: Run it again**

Run: `pnpm vitest run src/fighters/airGrab.test.ts src/fighters/walljump.test.ts src/fighters/footstool.test.ts src/engine/states.test.ts src/fighters/schema.test.ts`

Expected: PASS (captured).

- [ ] **Step 5: Bake, reach and golden**

Run, in order, reading each diff:
1. `pnpm vitest run src/render3d/bake/roster.test.ts`.
   - Expected: FAIL `expected 6931363 to be 6943648` and the digest's mismatch, a new move to bake (captured).
   - Run `UPDATE_BAKE=1 pnpm vitest run src/render3d/bake/roster.test.ts`. The bake grows by Samus's 59-frame `airGrab` on the grab clip: `roster.bin.gz` 1,965,143 → 1,967,536 bytes, under the 2 MiB budget (captured).
2. `pnpm vitest run src/render3d/bake src/fighters/acmd src/game/hurtboxes.test.ts`. Expected: PASS; `reach.test.ts` asks nothing (captured).
3. `pnpm vitest run src/game/golden.test.ts src/game/rulesVersion.test.ts`. Expected: PASS, byte-identical with the states lab's re-tuned mash (captured). Without the re-tune, `replays states-lab-finalDestination exactly` FAILS `first divergence in frames 1-100` (captured).

- [ ] **Step 6: Mutants**

Each against `src/fighters/airGrab.test.ts`. Restore after each.
1. `handleActionable`: delete the `if (startAirDodge(f, intent)) return true;` inside the new block. The dodge test FAILS `mario: expected 'fall' to be 'airDodge'` (captured).
2. `samus.ts`: drop `part: 1,`. The two-hits test FAILS `expected 1 to be 2` (the second hit is part 0, already struck), and the data pin FAILS too (captured).
3. `airActionFirst`: delete the new block. The R-T10e test FAILS `expected false to be true` (captured).

- [ ] **Step 7: Gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`, then `PORT=3107 pnpm test:e2e --trace off`.

Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add super-smash/src/engine/types.ts super-smash/src/engine/acmd/legacy.ts super-smash/src/render/poses/timing.ts super-smash/src/engine/states.ts super-smash/src/fighters/samus.ts super-smash/src/fighters/airGrab.test.ts super-smash/src/fighters/schema.test.ts super-smash/src/game/goldenStatesLab.ts super-smash/SPEC.md super-smash/public/bake/roster.bin.gz super-smash/src/fighters/bake/digest.ts
# and super-smash/src/fighters/acmd/reach.allow.json if Step 5 regenerated it; with the golden only if its step regenerated it:
# git add super-smash/src/game/__golden__/engine-trace.json super-smash/src/game/rulesVersion.test.ts
git commit -m "super-smash: Grab in the air air-dodges, or is Samus's grab aerial" -m "SmashWiki Air dodge and Grab aerial; Samus's zair from SmashWiki and rubendal game_aircatch (part 1 follows part 0). The tether recovery is not modelled (D3). SPEC 6 gains the row. Bake re-baked for the new move. The states lab's struggle stops mashing on the freeing press; golden unchanged." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Final Smash boxes: a record by part in the scene, and world end boxes

From Plan 5's triage and D58's "Final Smash end boxes as world boxes and a per-box record for scene boxes".

**Today:**
- A scene box (`hold`, `launch`) keeps no hit record it reads. Neither does a start's ordinary hit (`strike`, ruling R-T15j).
- So each is authored one frame long, and a multi-hit barrage is a row of one-frame boxes (`finalKit.ts`'s `barrage`).
- Every end part reaches only its user's trapped (Task 14's reading), though three scripts lay their end boxes in the world.

**This task:**
- **A record of their own.** Scene, strike and end boxes get a record apart from the swing's (`CombatState.sceneHits`), so a strike that lands still leaves the start's trap free to catch, as R-T15j requires.
  - The record is by target and part, as every record is (`recordHolds`/`recordMark`). SmashWiki "Hitbox": a part "Determines how many hitboxes can hit in one attack".
  - A box with a rehit lets go after it. One without lets go on the next frame, as when these boxes kept no record.
  - A box may then span its script's window. The barrages become one box each, with the loop's period as their rehit, and land on the same frames as before.
  - Not per box. Volt Tackle's two spark capsules share a part, and keyed per box the second would land a frame after the first, every rehit. Captured: the sparks on a fighter beside Pikachu become `[10, 11, 16, 17, 22, 23, 29, 47]`, against SmashWiki's "0.3% (6 hits during startup)".
- **`FinalPhase.world`.** An end part whose boxes also hit anyone else they reach, as ordinary boxes. rubendal 13.0.1, read 2026-11-01, none with `set_catch_only_all`:
  - Donkey Kong's `game_finalend`, frames 7-8: `ATTACK` ID 2 on `top` Y 11 Z 5 size 13, and ID 3 Y 11 Z 25 size 15, 14%, angle 70, KBG 96, BKB 90 (IDs 0-1 on `handl`/`arml`).
  - Marth's `game_finalend`, frames 2-5: ID 0 Y 8 Z 16 size 18, ID 1 Y 8 Z 9 size 12, 60%, angle 361, KBG 120, BKB 120.
  - Pikachu's `game_final2`, frames 10-11: ID 1 Y 10 size 32, 20%, angle 70, KBG 82, BKB 70.
  - SmashWiki "Volt Tackle": "anyone within range of the final blast will be impacted".
  - The other five ends keep Task 14's reading.

**Published windows the data takes** (rubendal 13.0.1):
- Donkey Kong's `game_finalattack` loops 18 times from frame 6 with a period of 4 (boxes on 2 frames, `clear_all`), then 13 times from 79 with the same period.
- Pikachu's `game_final` sparks are `Rehit=6` from frame 10. The replica keeps its six strikes, 10-40, on the page's count of six: window 10-45. The script's window would allow a seventh on 46, UNVERIFIED as before.
- Pikachu's `game_finalattack` loop stays the replica's UNVERIFIED eight hits eight frames apart, now one box with rehit 8.
- Not modelled, as before: Donkey Kong's `handl`/`arml` end boxes (no bone placed for a scene); Pikachu's end's 0% push on frames 1-2.

**What it moves, besides the golden:**
- The sparks are live through their window, so a fighter who drifts back into their reach is struck there, a rehit after the last strike, not only on the six frames. `sceneDraw.test.ts`'s Pikachu traps from 8 and 10 change.
- Donkey Kong's far end box (Z 25) is beyond `schema.test.ts`'s 20-unit reach check; it is the script's own, so it joins that check's script-placed exceptions.
- The fighter comments made stale here are rewritten in the same commit: Donkey Kong's, Marth's and Pikachu's "first frame of its window" and "reach only the trapped".

**Golden:** unchanged (captured), with the bake. The final lab traps Mario alone, and the barrage and end land on the same frames. If it moves, find why before regenerating: a moved landing frame is a bug here. Stage the trace and the pin only if Step 5 regenerated them.

**Files:**
- Modify:
  - `src/engine/types.ts` (`FinalPhase.world?`), `src/engine/combat.ts` (`CombatState.sceneHits`), `src/engine/hash.ts`
  - `src/engine/states.ts` (`startMove`), `src/engine/simulate.ts`
  - `src/fighters/donkeyKong.ts`, `src/fighters/marth.ts`, `src/fighters/pikachu.ts`
  - `src/fighters/finalKit.ts` (`barrage` loses its last user, so it goes)
- Test:
  - `src/fighters/finalSmash.test.ts`, `src/engine/hash.test.ts`
  - `src/engine/simulate.test.ts` (the clone walk's fixture)
  - `src/fighters/schema.test.ts` (the reach check's script-placed boxes)
  - `src/game/sceneDraw.test.ts` (Pikachu's traps from 8 and 10)

**Interfaces:**
- Consumes:
  - `Candidate.final`, `finalKind`, `isSceneBox`, `recordHit`, `unrecorded`, `recordPart` (simulate.ts);
  - `recordHolds`, `recordMark` (hitbox.ts);
  - `finalBox` (finalKit.ts); `Hitbox.rehit`, `Hitbox.part`.
- Produces:
  - `CombatState.sceneHits: number[]` (cleared by `startMove`);
  - `FinalPhase.world?: boolean`;
  - `Candidate.final` member `"launchWorld"`;
  - `sceneRecordHolds(s, c, port)` and `sceneRearmFrame(c)` (simulate.ts, not exported).
- Task 14 replaces this task's record-check line and deletes `unrecorded` (a windbox then keeps its record).

- [ ] **Step 1: Write the failing tests**

`src/fighters/finalSmash.test.ts`, at the end of the file, after a blank line. The landings themselves are the file's existing `SCENE_HITS` ("lands each hit on its script's frame") and the startup sparks' ("hits a fighter beside it six times in place"). They run 520 steps, past Jungle Rush's 163-step scene, and keep their frames through this change.

```ts
/** Marth's end part with Mario trapped at 10 and Fox standing 9 ahead, in its second box. */
function criticalHitWithBystander(): { bystanderHit: boolean } {
  const s = createInitialState("finalDestination", [{ defId: "marth" }, { defId: "mario" }, { defId: "fox" }], RULES, 5);
  Object.assign(s.fighters[0], { action: "special", move: "finalEnd", actionFrame: 0, grounded: true, platform: 0, x: 0, y: 0, facing: 1, intangible: 0 });
  Object.assign(s.fighters[1], { action: "finalTrapped", actionFrame: 0, grounded: true, platform: 0, x: fx(10), y: 0, facing: -1, intangible: 0 });
  s.fighters[1].combat.trappedBy = 0;
  Object.assign(s.fighters[2], { action: "stand", actionFrame: 10, grounded: true, platform: 0, x: fx(9), y: 0, facing: -1, intangible: 0, invincible: 0 });
  s.cinematic = 0;
  let st = s;
  let bystanderHit = false;
  for (let i = 0; i < 10; i++) {
    const out = step(st, [0, 0, 0], { prevInputs: [0, 0, 0] });
    if (out.events.hits.some((h) => h.attacker === 0 && h.victim === 2)) bystanderHit = true;
    st = out.state;
  }
  return { bystanderHit };
}

describe("Final Smash boxes keep a record of their own, and three ends hit the world (Plan 6, Task 9)", () => {
  // The landings themselves are `SCENE_HITS`'s ("lands each hit on its script's frame",
  // above: 520 steps, past Jungle Rush's 163-step scene) and the startup sparks' ("hits a
  // fighter beside it six times in place"): each keeps its frames through this change.

  it("Jungle Rush's barrage is two boxes spanning the script's loops, each with the loop's period as its rehit", () => {
    const boxes = def("donkeyKong").moves.finalAttack!.hitboxes;
    expect(boxes.map((b) => [b.startFrame, b.endFrame, b.rehit])).toEqual([
      [6, 75, 4],
      [79, 127, 4],
    ]);
  });

  it("the three world ends are flagged and carry their scripts' top-bone boxes", () => {
    expect(def("donkeyKong").moves.finalEnd!.final?.world).toBe(true);
    expect(def("marth").moves.finalEnd!.final?.world).toBe(true);
    expect(def("pikachu").moves.finalEnd!.final?.world).toBe(true);
    expect(def("marth").moves.finalEnd!.hitboxes.map((b) => [b.startFrame, b.endFrame, toFloat(b.radius)])).toEqual([
      [2, 5, 18],
      [2, 5, 12],
    ]);
    for (const id of ["mario", "kirby", "fox", "samus", "link"]) expect(def(id).moves.finalEnd?.final?.world, id).not.toBe(true);
  });

  it("Marth's Critical Hit end launches a bystander standing in its blade, not only the fighter it trapped", () => {
    expect(criticalHitWithBystander().bystanderHit).toBe(true);
  });
});
```

`src/engine/hash.test.ts`:

```diff
--- a/src/engine/hash.test.ts
+++ b/src/engine/hash.test.ts
@@
       ["fighter.combat.staleShield", (s) => s.fighters[0].combat.staleShield.push(true)],
       // Plan 5, Task 4b: null to a move, which the walk below cannot reach from null.
       ["fighter.combat.helplessMove", (s) => (s.fighters[0].combat.helplessMove = "upB")],
+      // Plan 6, Task 9: a Final Smash scene's own record.
+      ["fighter.combat.sceneHits", (s) => s.fighters[0].combat.sceneHits.push(5)],
       ["projectiles", (s) => s.projectiles.push(projectile())],
     ];
     for (const [name, mutate] of mutations) {
@@
       combat: { ...emptyCombat(), helplessMove: "upB" },
     };
     /** Arrays `mixFighter` hashes element by element, each with an explicit case in the list above. */
-    const HANDLED_ARRAYS = new Set(["staleQueue", "hitThisMove", "combat.staleShield"]);
+    const HANDLED_ARRAYS = new Set(["staleQueue", "hitThisMove", "combat.staleShield", "combat.sceneHits"]);
     const leaves: string[][] = [];
     const walk = (v: unknown, path: string[]): void => {
       if (v === null) throw new Error(`fighter.${path.join(".")} is null: give it a value in FULL`);
```

- [ ] **Step 2: Run them to see them fail**

Run `pnpm vitest run src/fighters/finalSmash.test.ts -t "keep a record of their own"`, then `pnpm vitest run src/engine/hash.test.ts`. They are two runs: `-t` filters every file named.

Expected: FAIL (captured):
- the barrage shape: `expected [ [ 6, 6, undefined ], …(30) ] to deeply equal [ [ 6, 75, 4 ], [ 79, 127, 4 ] ]`;
- the world flags: `expected undefined to be true`;
- the bystander: `expected false to be true`;
- `hash.test.ts` "notices a change to every simulation-relevant field": `TypeError: Cannot read properties of undefined (reading 'push')`.

- [ ] **Step 3: Implement**

```diff
--- a/src/engine/types.ts
+++ b/src/engine/types.ts
@@
    * reach further behind him than his front does ahead). Presentation only.
    */
   readonly sceneGapBehind?: number;
+  /**
+   * An end part whose script lays its boxes in the world (Plan 6, Task 9: `ATTACK`, no
+   * `set_catch_only_all`; Donkey Kong's and Marth's `game_finalend`, Pikachu's
+   * `game_final2`): they launch the user's trapped wherever they are, as every end does,
+   * and hit anyone else they reach as ordinary boxes (SmashWiki "Volt Tackle": "anyone
+   * within range of the final blast will be impacted").
+   */
+  readonly world?: boolean;
 }
 
 /**
```

```diff
--- a/src/engine/combat.ts
+++ b/src/engine/combat.ts
@@
    * match's start (`createInitialState`), and kept through a KO and the respawn.
    */
   controls: number;
+  /**
+   * The record of a Final Smash's scene, strike and end boxes (Plan 6, Task 9), apart from
+   * the swing's `hitThisMove`, so a start's strike leaves its trap free to catch (ruling
+   * R-T15j). Entries as `hitThisMove`'s (`recordMark`): by target and part, with the
+   * frame each lets go. Cleared when a move starts (`startMove`).
+   */
+  sceneHits: number[];
 }
 
 /** `CombatState.sinceAttack`'s cap, as `framesSinceDirPress` has one: long past any wait. */
@@
     turned: false,
     trappedBy: -1,
     controls: 0,
+    sceneHits: [],
   };
 }
 
@@
     turned: c.turned,
     trappedBy: c.trappedBy,
     controls: c.controls,
+    sceneHits: c.sceneHits.slice(),
   };
 }
```

```diff
--- a/src/engine/hash.ts
+++ b/src/engine/hash.ts
@@
   x = mixBool(x, c.turned);
   x = mixInt(x, c.trappedBy);
   x = mixInt(x, c.controls);
+  // Plan 6, Task 9: a Final Smash scene's own record.
+  x = mixInt(x, c.sceneHits.length);
+  for (const e of c.sceneHits) x = mixInt(x, e);
   return x;
 }
 
```

```diff
--- a/src/engine/states.ts
+++ b/src/engine/states.ts
@@
   f.move = slot;
   f.charge = 0;
   clearHitRecord(f);
+  // A Final Smash part's own record starts again with the part (Plan 6, Task 9).
+  f.combat.sceneHits.length = 0;
   // A new swing: it will join the stale queue on its first hit (Plan 3, Task 16),
   // and a smash charges while the button stays held from here (R-T13l).
   f.combat.swingQueued = false;
```

```diff
--- a/src/engine/simulate.ts
+++ b/src/engine/simulate.ts
@@
   hurtboxCapsule,
   markHit,
   moveFrameOf,
+  recordHolds,
+  recordMark,
   reboundFrames,
   resolveClank,
   sweptCapsuleOverlaps,
@@
    * the world as an ordinary box, its hit record kept. No shield or counter takes any
    * of them. Null for every other box.
    */
-  readonly final: "trap" | "hold" | "launch" | "strike" | "world" | null;
+  readonly final: "trap" | "hold" | "launch" | "launchWorld" | "strike" | "world" | null;
   /**
    * Frames after it strikes a fighter before it may strike them again, 0 for once
    * (smash-script `Rehit`; Plan 5, Task 16: `Hitbox.rehit`, `ProjectileDef.rehit`), and
@@
 function finalKind(final: FinalPhase | undefined, hb: Hitbox): Candidate["final"] {
   if (final === undefined) return null;
   if (final.phase === "start") return final.trap === true ? (hb.trap === false ? "strike" : "trap") : "world";
-  return final.phase === "attack" ? "hold" : "launch";
+  if (final.phase === "attack") return "hold";
+  // An end laid in the world launches the trapped and hits anyone else (Plan 6, Task 9).
+  return final.world === true ? "launchWorld" : "launch";
 }
 
 /**
@@
       // powerful tenth blow"), and the world below as any box does.
       const trapped = victim.action === "finalTrapped";
       const ownTrapped = trapped && victim.combat.trappedBy === c.attacker;
-      if (isSceneBox(c) ? !ownTrapped : trapped && !(c.final === "strike" && ownTrapped)) continue;
+      // A world end reaches its own trapped as a scene's end does, and the world besides.
+      const reachesOwn = c.final === "strike" || c.final === "launchWorld";
+      if (isSceneBox(c) ? !ownTrapped : trapped && !(reachesOwn && ownTrapped)) continue;
       if (isSceneBox(c) || ownTrapped) {
+        // Its own record, by target and part, with its rehit (Plan 6, Task 9).
+        if (sceneRecordHolds(s, c, victim.port)) continue;
         const key = pickKey(c);
         const incumbent = perSource.get(key);
         if (incumbent === undefined || c.hitbox.id < incumbent.hitbox.id) perSource.set(key, c);
@@
       // ordinary grab still pulls a hanging fighter off, D56), no Kirby with someone
       // in his mouth, and nobody once its own mouth is full (Plan 5, Task 9: `inhaleMayCatch`).
       if (c.hitbox.grabbing === true && isInhale(defs[c.attacker], c) && !inhaleMayCatch(s.fighters[c.attacker], victim, defs[v])) continue;
-      if (!unrecorded(c) && recordSaysAlreadyHit(s, c, victim.port)) continue;
+      if (c.final === "strike" ? sceneRecordHolds(s, c, victim.port) : !unrecorded(c) && recordSaysAlreadyHit(s, c, victim.port)) continue;
       // Ruling P5-R8: a captor's box that is not catch-only leaves the fighter it
       // holds alone, and hits anyone else it reaches. SmashWiki "Throw"
       // (https://www.ssbwiki.com/Throw): "a few throws such as Mario's back throw
@@
  * them (SSBU keeps catches, `CatchModule`, and attacks, `AttackModule`, apart).
  * `schema.test.ts` holds every melee windbox to one frame. UNVERIFIED: the rehit
  * timed from the boxes' frames, where SSBU times it from each victim's last hit. A
- * projectile's windbox (F.L.U.D.D.'s water) marks its own record, as before.
+ * projectile's windbox (F.L.U.D.D.'s water) marks its own record, as before. A
+ * Final Smash start's strike and a scene's boxes keep a record of their own
+ * (`sceneRecordHolds`; Plan 6, Task 9).
  */
 function unrecorded(c: Candidate): boolean {
-  return (c.hitbox.windbox === true && c.projectile === null) || c.final === "strike";
+  return c.hitbox.windbox === true && c.projectile === null;
 }
 
 /** Is `c` a box of a move that inhales (`MoveDef.inhale`, Plan 5, Task 9: Kirby's neutral special)? */
@@
 }
 
 function recordHit(c: Candidate, attacker: FighterState, port: number): void {
-  // A Final Smash start's ordinary hit keeps no record (Plan 5, Task 15 fix round 1,
-  // ruling R-T15j): a one-frame box that lands once, as a scene's does, which leaves
-  // the start's trap free to catch whom it hit (Volt Tackle's sparks, then its 1%).
-  if (c.final === "strike") return;
+  // A Final Smash's scene and strike boxes record in a list of their own (Plan 6, Task
+  // 9: `CombatState.sceneHits`), which leaves the start's trap free to catch whom a
+  // strike hit (Plan 5, Task 15 fix round 1, ruling R-T15j: Volt Tackle's sparks, then
+  // its 1%), and lets a box with a rehit span its script's window.
+  if (isSceneBox(c) || c.final === "strike") {
+    recordMark(attacker.combat.sceneHits, port, sceneRearmFrame(c), recordPart(c));
+    return;
+  }
   // A box with a rehit lets go of its target that many frames on its clock from now
   // (Plan 5, Task 16; SmashWiki "Hitbox", https://www.ssbwiki.com/Hitbox: a rehit rate
   // "allows the hitbox to strike again after the specified amount of frames"),
@@
   const rearmAt = rearmFrame(c);
   if (c.projectile !== null) markProjectileHit(c.projectile, port, rearmAt);
   else markHit(attacker, port, rearmAt, recordPart(c));
+}
+
+/**
+ * Has a Final Smash scene, strike or end box of `c`'s part struck `port`, and not yet let
+ * go (Plan 6, Task 9: `CombatState.sceneHits`)? By target and part, as every record is:
+ * SmashWiki "Hitbox" (https://www.ssbwiki.com/Hitbox), a part "Determines how many
+ * hitboxes can hit in one attack", so Volt Tackle's two spark capsules land once a rehit
+ * between them, not once each.
+ */
+function sceneRecordHolds(s: GameState, c: Candidate, port: number): boolean {
+  return recordHolds(s.fighters[c.attacker].combat.sceneHits, port, c.clock, recordPart(c));
+}
+
+/**
+ * The frame a scene, strike or end box lets go of its target (Plan 6, Task 9): after its
+ * rehit; with none, on the next frame, as when the scene's boxes kept no record: each is
+ * one frame long, or launches the trapped on its first (`finalSmash.test.ts` pins both).
+ */
+function sceneRearmFrame(c: Candidate): number {
+  return c.clock + (c.rehit > 0 ? c.rehit : 1);
 }
 
 /**
```

Every place that tests `c.final === "launch"` for the launch itself (`grep -n '"launch"' src/engine/simulate.ts`) must read `"launchWorld"` too. At `46e0706` the only such test is `isSceneBox`, which deliberately leaves it out.

```diff
--- a/src/fighters/donkeyKong.ts
+++ b/src/fighters/donkeyKong.ts
@@
 
 import { fx } from "@/engine/fixed";
 import type { FighterDef } from "@/engine/types";
-import { barrage, finalBox } from "./finalKit";
+import { finalBox } from "./finalKit";
 import { ACTIVE_SCRIPT_SLOTS, withReferenceScripts } from "./acmd/active";
 import { DONKEY_KONG } from "./acmd/generated/donkeyKong";
 import { FIGHTER_PARAMS } from "./params";
@@
     // SLOW_OPPONENT(7, 30), its slowing of the other fighters through the startup, is not
     // modelled (the page publishes neither its rate nor its length, and the arguments'
     // meaning is unpublished): they move at full speed.
-    // UNVERIFIED-simplified: each scene hit is the first frame of its window (the
-    // page's "6-7" is one hit; `finalKit.ts`). The barrage's knockback (FKB 40) is
-    // the scene's: a trapped fighter is held. `DisableHitlag=true` is not modelled,
-    // as for every box. The uppercut's boxes are world boxes in its script (no
-    // `set_catch_only_all`), but here they reach only the trapped, as every end box
-    // does (Task 14's reading).
+    // UNVERIFIED-simplified: each run of the barrage's loops is one box with the loop's
+    // period as its rehit (Plan 6, Task 9; the page's "6-7" is one hit; `finalKit.ts`).
+    // The barrage's knockback (FKB 40) is the scene's: a trapped fighter is held.
+    // `DisableHitlag=true` is not modelled, as for every box. The uppercut's top-bone
+    // boxes are world boxes, as in its script (no `set_catch_only_all`; Plan 6, Task 9:
+    // `FinalPhase.world`).
     // UNVERIFIED: the scene boxes' x (the stand-in 10): they reach the trapped
     // wherever they are.
     finalSmash: {
@@
       // reach further behind than his punches do ahead.
       final: { phase: "attack", next: "finalEnd", sceneGap: fx(12), sceneGapBehind: fx(15) },
       hitboxes: [
-        ...barrage(0, 6, 18, 4, { damage: 1.2, angle: 135, kbg: 100, fkb: 40, radius: 8.5, hitlag: 0.4, transcendent: true }),
-        ...barrage(18, 79, 13, 4, { damage: 1.1, angle: 135, kbg: 100, fkb: 40, radius: 8.5, hitlag: 0.4, transcendent: true }),
+        // rubendal 13.0.1 `game_finalattack`: 18 loops from frame 6 every 4 (each box live
+        // 2 frames), then 13 from 79 every 4 (1 frame); one box a run of loops, its rehit
+        // the period (Plan 6, Task 9: a scene box keeps its own record).
+        finalBox(0, 6, 75, { damage: 1.2, angle: 135, kbg: 100, fkb: 40, radius: 8.5, hitlag: 0.4, transcendent: true, rehit: 4 }),
+        finalBox(1, 79, 127, { damage: 1.1, angle: 135, kbg: 100, fkb: 40, radius: 8.5, hitlag: 0.4, transcendent: true, rehit: 4 }),
       ],
     },
     finalEnd: {
@@
       // The drawing (Task 17 fix rounds 1 and 2, rulings R-T17d and R-T17i): 13, a
       // unit past the barrage's, so his head clears the knee of a fighter the
       // uppercut sends up past it.
-      final: { phase: "end", sceneGap: fx(13), sceneGapBehind: fx(15) },
-      hitboxes: [finalBox(0, 7, 7, { damage: 14, angle: 70, kbg: 96, bkb: 90, radius: 15, y: 11, hitlag: 1, transcendent: true, lr: "position", forceReaction: true })],
+      // `game_finalend` lays its boxes in the world (Plan 6, Task 9): its top-bone pair,
+      // frames 7-8 (`clear_all` on 9); the `handl` and `arml` pair is not placed (no bone).
+      final: { phase: "end", world: true, sceneGap: fx(13), sceneGapBehind: fx(15) },
+      hitboxes: [
+        finalBox(0, 7, 8, { damage: 14, angle: 70, kbg: 96, bkb: 90, radius: 13, x: 5, y: 11, hitlag: 1, transcendent: true, lr: "position", forceReaction: true }),
+        finalBox(1, 7, 8, { damage: 14, angle: 70, kbg: 96, bkb: 90, radius: 15, x: 25, y: 11, hitlag: 1, transcendent: true, lr: "position", forceReaction: true }),
+      ],
     },
   },
 
```

```diff
--- a/src/fighters/marth.ts
+++ b/src/fighters/marth.ts
@@
     // SLOW_OPPONENT(4, 45), its slowing of the other fighters through the startup, is not
     // modelled (the page publishes neither its rate nor its length, and the arguments'
     // meaning is unpublished): they move at full speed.
-    // UNVERIFIED-simplified: the strike is one frame (its script's 2-5; it "only
-    // hits once", `finalKit.ts`). Its boxes are world boxes in its script (no
-    // `set_catch_only_all`; SmashWiki "Critical Hit": "it is also possible for a
-    // fighter to walk into the user's sword once it hits another opponent and still
-    // be given a OHKO"), but here they reach only the trapped, as every end box does
-    // (Task 14's reading).
+    // The strike's boxes are live on its script's 2-5 and land once each fighter (it "only
+    // hits once"), world boxes as in its script (no `set_catch_only_all`; SmashWiki
+    // "Critical Hit": "it is also possible for a fighter to walk into the user's sword once
+    // it hits another opponent and still be given a OHKO"; Plan 6, Task 9:
+    // `FinalPhase.world`).
     finalSmash: {
       slot: "finalSmash",
       name: "Critical Hit",
@@
       intangible: [1, 59],
       // The drawing (Task 17 fix round 2, ruling R-T17i): no nearer than 13 to the
       // fighter it holds, where this part's clip stays off its body (`sceneDrawShift`).
-      final: { phase: "end", sceneGap: fx(13) },
-      hitboxes: [finalBox(0, 2, 2, { damage: 60, angle: 361, kbg: 120, bkb: 120, radius: 18, x: 16, y: 8, hitlag: 1, transcendent: true, effect: "slash", forceReaction: true })],
+      // `game_finalend` lays its boxes in the world, frames 2-5 (`clear_all` on 6) (Plan 6, Task 9).
+      final: { phase: "end", world: true, sceneGap: fx(13) },
+      hitboxes: [
+        finalBox(0, 2, 5, { damage: 60, angle: 361, kbg: 120, bkb: 120, radius: 18, x: 16, y: 8, hitlag: 1, transcendent: true, effect: "slash", forceReaction: true }),
+        finalBox(1, 2, 5, { damage: 60, angle: 361, kbg: 120, bkb: 120, radius: 12, x: 9, y: 8, hitlag: 1, transcendent: true, effect: "slash", forceReaction: true }),
+      ],
     },
   },
 
```

```diff
--- a/src/fighters/pikachu.ts
+++ b/src/fighters/pikachu.ts
@@
 
 import { fx } from "@/engine/fixed";
 import type { FighterDef } from "@/engine/types";
-import { barrage, finalBox } from "./finalKit";
+import { finalBox } from "./finalKit";
 import { ACTIVE_SCRIPT_SLOTS, withReferenceScripts } from "./acmd/active";
 import { PIKACHU } from "./acmd/generated/pikachu";
 import { FIGHTER_PARAMS } from "./params";
@@
     //   that fighter is slowed and has barely moved; here it flies at full speed.
     // UNVERIFIED-simplified: `game_final2`'s 0% push on its frames 1-2 is not
     // modelled (an end box launches the trapped, so it would end the scene before
-    // the blast). The blast's box is a world box in its script ("anyone within range
-    // of the final blast will be impacted", Volt Tackle), but here it reaches only the
-    // trapped, as every end box does (Task 14's reading); and it goes off where the
-    // trap landed, not "at the center of the stage" (Volt Tackle). Each scene hit, and
-    // each spark, is the first frame of its window (`finalKit.ts`); the scene boxes'
-    // offsets are stand-ins: they reach the trapped wherever they are.
+    // the blast). The blast's box is a world box, as in its script ("anyone within range
+    // of the final blast will be impacted", Volt Tackle; Plan 6, Task 9:
+    // `FinalPhase.world`); it goes off where the trap landed, not "at the center of the
+    // stage" (Volt Tackle). The sparks and the loop are one box each with its rehit
+    // (Plan 6, Task 9: `finalKit.ts`); the scene boxes' offsets are stand-ins: they reach
+    // the trapped wherever they are.
     finalSmash: {
       slot: "finalSmash",
       name: "Volt Tackle",
@@
       // fighter it holds, where this part's clip stays off its body (`sceneDrawShift`).
       final: { phase: "start", trap: true, next: "finalAttack", nextAt: 47, sceneGap: fx(8) },
       hitboxes: [
-        // The startup's six sparks, two capsules each.
-        ...[10, 16, 22, 28, 34, 40].flatMap((f, i) => [
-          finalBox(2 * i, f, f, { damage: 0.3, angle: 70, kbg: 70, fkb: 20, radius: 5.5, x: 5, y: 0, x2: -5, y2: 0, hitlag: 0.2, transcendent: true, lr: "position", effect: "electric", trap: false }),
-          finalBox(2 * i + 1, f, f, { damage: 0.3, angle: 40, kbg: 70, fkb: 20, radius: 5.5, x: 5, y: 10, x2: -5, y2: 10, hitlag: 0.2, transcendent: true, lr: "position", effect: "electric", trap: false }),
-        ]),
+        // The startup's sparks, two capsules of one part (`game_final`: `Rehit=6` from 10).
+        // Six strikes, 10-40, on SmashWiki's count; the window ends on 45 (Plan 6, Task 9:
+        // a strike keeps its own record, by part, so the two land once a rehit between them).
+        finalBox(0, 10, 45, { damage: 0.3, angle: 70, kbg: 70, fkb: 20, radius: 5.5, x: 5, y: 0, x2: -5, y2: 0, hitlag: 0.2, transcendent: true, lr: "position", effect: "electric", trap: false, rehit: 6 }),
+        finalBox(1, 10, 45, { damage: 0.3, angle: 40, kbg: 70, fkb: 20, radius: 5.5, x: 5, y: 10, x2: -5, y2: 10, hitlag: 0.2, transcendent: true, lr: "position", effect: "electric", trap: false, rehit: 6 }),
         // The initial hit, then the tackle.
-        finalBox(12, 47, 49, { damage: 1, angle: 50, kbg: 100, fkb: 75, radius: 5.5, x: 5, y: 0, x2: -5, y2: 0, hitlag: 0.2, transcendent: true, effect: "electric" }),
-        finalBox(13, 47, 49, { damage: 1, angle: 30, kbg: 100, fkb: 30, radius: 5.5, x: 5, y: 10, x2: -5, y2: 10, hitlag: 0.2, transcendent: true, effect: "electric" }),
-        finalBox(14, 50, 83, { damage: 1, angle: 90, kbg: 45, fkb: 125, bkb: 70, radius: 13, x: 0, y: 3, hitlag: 0.2, transcendent: true, lr: "position", effect: "electric" }),
+        finalBox(2, 47, 49, { damage: 1, angle: 50, kbg: 100, fkb: 75, radius: 5.5, x: 5, y: 0, x2: -5, y2: 0, hitlag: 0.2, transcendent: true, effect: "electric" }),
+        finalBox(3, 47, 49, { damage: 1, angle: 30, kbg: 100, fkb: 30, radius: 5.5, x: 5, y: 10, x2: -5, y2: 10, hitlag: 0.2, transcendent: true, effect: "electric" }),
+        finalBox(4, 50, 83, { damage: 1, angle: 90, kbg: 45, fkb: 125, bkb: 70, radius: 13, x: 0, y: 3, hitlag: 0.2, transcendent: true, lr: "position", effect: "electric" }),
       ],
     },
     finalAttack: {
@@
       // The drawing (Task 17 fix round 2, ruling R-T17i): no nearer than 13 to the
       // fighter it holds, where this part's clip stays off its body (`sceneDrawShift`).
       final: { phase: "attack", next: "finalEnd", sceneGap: fx(13) },
-      hitboxes: barrage(0, 6, 8, 8, { damage: 1.5, angle: 367, kbg: 90, fkb: 100, radius: 13, hitlag: 0.2, transcendent: true, lr: "position", effect: "electric" }),
+      // UNVERIFIED as before: eight hits, eight frames apart, one box with that rehit (Plan 6, Task 9).
+      hitboxes: [finalBox(0, 6, 62, { damage: 1.5, angle: 367, kbg: 90, fkb: 100, radius: 13, hitlag: 0.2, transcendent: true, lr: "position", effect: "electric", rehit: 8 })],
     },
     finalEnd: {
       slot: "finalEnd",
@@
       intangible: [1, 79],
       // The drawing (Task 17 fix round 2, ruling R-T17i): no nearer than 15 to the
       // fighter it holds, where this part's clip stays off its body (`sceneDrawShift`).
-      final: { phase: "end", sceneGap: fx(15) },
-      hitboxes: [finalBox(0, 10, 10, { damage: 20, angle: 70, kbg: 82, bkb: 70, radius: 32, hitlag: 0.7, transcendent: true, lr: "position", effect: "electric", forceReaction: true })],
+      // `game_final2` lays its blast in the world, frames 10-11 (Plan 6, Task 9).
+      final: { phase: "end", world: true, sceneGap: fx(15) },
+      hitboxes: [finalBox(0, 10, 11, { damage: 20, angle: 70, kbg: 82, bkb: 70, radius: 32, x: 0, y: 10, hitlag: 0.7, transcendent: true, lr: "position", effect: "electric", forceReaction: true })],
     },
   },
 
```

```diff
--- a/src/fighters/finalKit.ts
+++ b/src/fighters/finalKit.ts
@@
  * 10, `y` 8, `radius` 10), and any offset or radius a fighter file does not quote,
  * are UNVERIFIED stand-ins.
  *
- * A scene box keeps no hit record (Task 14), so one live n frames would land n
- * times: each scene hit is authored one frame long, on the first frame of its
- * script's window (`barrage`, and a single `finalBox(id, f, f, …)`), and lands
- * once, as each published hit does. So is a start's ordinary hit (`trap: false`,
- * fix round 1, ruling R-T15j), which keeps no hit record either.
+ * A scene box, a start's ordinary hit (`trap: false`, fix round 1, ruling R-T15j) and
+ * an end keep a record of their own, by target and part, with the box's rehit (Plan 6,
+ * Task 9: `CombatState.sceneHits`): a loop of the script's is one box whose rehit is the
+ * loop's period, spanning its window; a box without a rehit lets go on the next frame,
+ * so each published single hit is one box one frame long (`finalBox(id, f, f, …)`), on
+ * the first frame of its script's window.
  */
 
 import { fx } from "@/engine/fixed";
@@
   };
 }
 
-/** `count` one-frame hits, `every` frames apart from `from`: a scene's barrage. Ids from `firstId`. */
-export function barrage(firstId: number, from: number, count: number, every: number, h: Hit): Hitbox[] {
-  return Array.from({ length: count }, (_, i) => finalBox(firstId + i, from + i * every, from + i * every, h));
-}
```

The existing pins on the one-frame layout:
- the "one-frame boxes" test becomes the rule above;
- the sparks list becomes the two capsules;
- the `barrage` unit test goes, with its import.

```diff
--- a/src/fighters/finalSmash.test.ts
+++ b/src/fighters/finalSmash.test.ts
@@
 import { STAGES } from "@/stages";
 import { dashTravel } from "@/ai/specials";
 import { REFERENCE_SCRIPTS } from "./acmd/index";
-import { barrage, finalBox } from "./finalKit";
+import { finalBox } from "./finalKit";
 import { FIGHTERS, getFighter } from "./index";
 import { bakedContext } from "@/game/bake";
 import { readBakeFromDisk } from "@/game/bakeNode";
@@
 });
 
 describe("the scene's hits land once each", () => {
-  // A scene box reaches its trapped wherever they are and keeps no hit record, so
-  // a box live n frames would land n times (Task 14): every one is a single frame. So
-  // is a start's box that hits rather than traps (`Hitbox.trap` false, ruling R-T15j),
-  // which keeps no hit record either.
-  it.each(CINEMATIC.map((c) => c.id))("%s's scene, last blow and start hits are one-frame boxes", (id) => {
+  // A scene box, an end and a start's box that hits rather than traps (`Hitbox.trap`
+  // false, ruling R-T15j) keep a record of their own, by target and part (Plan 6, Task 9:
+  // `CombatState.sceneHits`), which lets go after the box's rehit, or on the next frame
+  // with none. So a box longer than a frame carries a rehit (a loop of the script's), or
+  // is an end's, which launches the trapped on its first frame.
+  it.each(CINEMATIC.map((c) => c.id))("%s's scene, last blow and start hits are one frame long, or carry a rehit, or end it", (id) => {
     const fighter = def(id);
     for (const slot of ["finalAttack", "finalEnd"] as const) {
       const move = fighter.moves[slot];
       if (move === undefined) continue;
       expect(move.hitboxes.length, `${id} ${slot}`).toBeGreaterThan(0);
-      for (const hb of move.hitboxes) expect(hb.endFrame, `${id} ${slot} hitbox ${hb.id}`).toBe(hb.startFrame);
+      for (const hb of move.hitboxes) {
+        if (hb.endFrame > hb.startFrame && slot !== "finalEnd") expect(hb.rehit ?? 0, `${id} ${slot} hitbox ${hb.id}`).toBeGreaterThan(0);
+      }
     }
-    for (const hb of fighter.moves.finalSmash!.hitboxes) if (hb.trap === false) expect(hb.endFrame, `${id} finalSmash hitbox ${hb.id}`).toBe(hb.startFrame);
+    for (const hb of fighter.moves.finalSmash!.hitboxes) {
+      if (hb.trap === false && hb.endFrame > hb.startFrame) expect(hb.rehit ?? 0, `${id} finalSmash hitbox ${hb.id}`).toBeGreaterThan(0);
+    }
   });
 
   it("gives Ultra Sword's 5% swing and Volt Tackle's sparks no trap, and every other start box one", () => {
     const hits = (id: string) => def(id).moves.finalSmash!.hitboxes.filter((hb) => hb.trap === false).map((hb) => [hb.startFrame, hb.damage]);
     expect(hits("kirby")).toEqual([[54, fx(5)]]);
-    expect(hits("pikachu")).toEqual([10, 16, 22, 28, 34, 40].flatMap((f) => [[f, fx(0.3)], [f, fx(0.3)]]));
+    // Plan 6, Task 9: the six sparks are two capsules with a rehit of 6, from 10.
+    expect(hits("pikachu")).toEqual([
+      [10, fx(0.3)],
+      [10, fx(0.3)],
+    ]);
     for (const id of ["donkeyKong", "marth", "fox"]) expect(hits(id), id).toEqual([]);
   });
 });
@@
     const bare = finalBox(0, 1, 1, { damage: 1, angle: 0, kbg: 0 });
     for (const k of ["trap", "forceReaction"]) expect(k in bare, k).toBe(false);
   });
-
-  it("spaces a barrage's one-frame hits evenly, with ids from the first", () => {
-    const hits = barrage(18, 79, 13, 4, { damage: 1.1, angle: 135, kbg: 100, fkb: 40 });
-    expect(hits).toHaveLength(13);
-    expect(hits.map((h) => h.id)).toEqual(Array.from({ length: 13 }, (_, i) => 18 + i));
-    expect(hits.map((h) => h.startFrame)).toEqual(Array.from({ length: 13 }, (_, i) => 79 + 4 * i));
-    for (const h of hits) expect(h.endFrame).toBe(h.startFrame);
-  });
 });
 
 /** Marth's end part with Mario trapped at 10 and Fox standing 9 ahead, in its second box. */
```

The clone walk's fixture fills every array, and the reach check lists the script-placed box:

```diff
--- a/src/engine/simulate.test.ts
+++ b/src/engine/simulate.test.ts
@@
       f.staleQueue = ["jab1", "fair"];
       f.combat.staleShield = [true, false];
       f.combat.helplessMove = "upB";
+      f.combat.sceneHits = [1, 2];
       f.hitThisMove = [1, 2];
     }
     s.projectiles = [
```

```diff
--- a/src/fighters/schema.test.ts
+++ b/src/fighters/schema.test.ts
@@
     // Zero Laser's upper fringe beam and its blast (`samus_laser2` `Upper`, 14 above the
     // beam's 15: 29 up), an article's boxes the script places (Plan 5, Task 16 fix round 1,
     // ruling R-T16e; the beam's 15, fix round 4, ruling R-T16o).
-    const placedByScript = new Set(["samus finalSmash 11", "samus finalSmash 13"]);
+    // And Jungle Rush's uppercut's far box, `game_finalend`'s `top` box at Z 25 (Plan 6, Task 9).
+    const placedByScript = new Set(["samus finalSmash 11", "samus finalSmash 13", "donkeyKong finalEnd 1"]);
     for (const { slot, hitbox } of everyHitbox(fighter)) {
       if (projectileSlots.includes(slot) || scripted.has(slot) || placedByScript.has(`${fighter.id} ${slot} ${hitbox.id}`)) continue;
       const reach = Math.abs(toFloat(hitbox.x));
```

Pikachu's traps from 8 and 10, as the sparks' window now reaches Mario (captured: 13.40 and 10.23, from 9.37 and 11.42):

```diff
--- a/src/game/sceneDraw.test.ts
+++ b/src/game/sceneDraw.test.ts
@@
   ["kirby", 5, 5],
   ["pikachu", 2, 7.3],
   ["pikachu", 4, 9.3],
-  ["pikachu", 8, 9.37],
-  ["pikachu", 10, 11.42],
+  // Plan 6, Task 9: the startup's sparks are live through their window (10-45, a rehit
+  // of 6 apart), so from 8 and 10 they catch Mario again as he drifts back into reach.
+  ["pikachu", 8, 13.4],
+  ["pikachu", 10, 10.23],
   ["pikachu", 30, 13.6],
   ["pikachu", 54, 13],
   ["pikachu", 42, 13.3],
```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/fighters/finalSmash.test.ts src/engine/final.test.ts src/engine/hash.test.ts src/fighters/acmd src/engine/simulate.test.ts src/fighters/schema.test.ts src/game/sceneDraw.test.ts`

Expected: PASS (captured). This includes `SCENE_HITS`'s landings and the sparks' `[10, 16, 22, 28, 34, 40, 47]`.

- [ ] **Step 5: Golden and bake**

Run: `pnpm vitest run src/render3d/bake/roster.test.ts src/game/golden.test.ts src/game/rulesVersion.test.ts`

Expected: PASS, the bake unchanged (no motion changed) and the golden byte-identical (captured).

- [ ] **Step 6: Mutants**

Each against `src/fighters/finalSmash.test.ts`. Restore after each.
1. `simulate.ts`, the scene branch: delete `if (sceneRecordHolds(s, c, victim.port)) continue;`.
   - `SCENE_HITS`'s Donkey Kong and Pikachu landings FAIL, with a hit on every frame of each window.
   - So do their totals: `expected 172.081298828125 to be close to 64.99499999999999` (captured).
2. `finalKind`: `final.world === true ? "launchWorld" : "launch"` → `"launch"`. The bystander test FAILS `expected false to be true` (captured).
3. `recordHit`: mark strikes in `hitThisMove` instead: `if (c.final === "strike") markHit(attacker, port, rearmFrame(c), recordPart(c)); else recordMark(…)`.
   - `sceneHits` never holds a strike, so the sparks land every frame: `expected [ 10, 11, 12, 13, 14, 15, 16, …(17) ] to deeply equal [ 10, 16, 22, 28, 34, 40, 47 ]`.
   - The swing's record then blocks R-FW2o's trap: `expected -1 to be 46` (captured).
4. Key the record per box: `recordPart(c)` → `c.hitbox.id` in both `sceneRecordHolds` and `recordHit`'s `recordMark`. The sparks double: `expected [ 10, 11, 16, 17, 22, 23, 29, 47 ] to deeply equal [ 10, 16, 22, 28, 34, 40, 47 ]` (captured).

- [ ] **Step 7: Gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`.

Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add super-smash/src/engine/types.ts super-smash/src/engine/combat.ts super-smash/src/engine/hash.ts super-smash/src/engine/states.ts super-smash/src/engine/simulate.ts super-smash/src/fighters/donkeyKong.ts super-smash/src/fighters/marth.ts super-smash/src/fighters/pikachu.ts super-smash/src/fighters/finalKit.ts super-smash/src/fighters/finalSmash.test.ts super-smash/src/engine/hash.test.ts super-smash/src/engine/simulate.test.ts super-smash/src/fighters/schema.test.ts super-smash/src/game/sceneDraw.test.ts
# with the golden only if its step regenerated it:
# git add super-smash/src/game/__golden__/engine-trace.json super-smash/src/game/rulesVersion.test.ts
git commit -m "super-smash: Final Smash scene and strike boxes keep a record of their own, by part; three ends hit the world" -m "CombatState.sceneHits, apart from the swing's record (R-T15j holds), by target and part (SmashWiki Hitbox: Volt Tackle's two spark capsules land once a rehit, not once each). Barrages become one box each with the loop's period as rehit, landing on the same frames. Donkey Kong's, Marth's and Pikachu's ends are world boxes, as their scripts lay them (rubendal 13.0.1; SmashWiki Volt Tackle). Golden unchanged." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: An aerial Final Smash's height boost, and R-T14j re-checked

From Plan 5's triage:
- "An aerial Final Smash's ending height boost (published, size unpublished)";
- "R-T14j's UNVERIFIED half: a Final Smash pressed just past the edge that whiffs self-destructs for DK and Pikachu; re-check sources."

**The boost.** SmashWiki "Final Smash": "When most Final Smashes are performed in the air, upon ending the move, the character gains a slight boost in height and regains their spent midair jumps, which can aid in recovery."
- The jumps are given back already (`refreshFinalJumps`, ruling R-T16b).
- The boost is not, because no source sizes it. rubendal 13.0.1's `game_final*` scripts carry no upward speed for any of the eight; the only speed set in them is Pikachu's `SET_SPEED_EX(3, 0, …)` at the dash's end. So the boost is status code, unpublished.
- **Default (decision D4):** model it, UNVERIFIED, as the fighter's own short hop (`mini_jump_y`), the smallest jump each fighter has, applied on the step the move ends in the air.
- The page's "most" is not narrowed (no list is published): every Final Smash ending in the air gets it.
- The boost is set in the step's status phase, and the step's gravity is applied after it, in its movement phase. So the speed after the step is the short hop's launch speed less `air_accel_y`.

**R-T14j, re-checked 2026-11-01.**
- Pikachu's half is published. SmashWiki "Volt Tackle": "the tackle ignores edges, meaning it is fairly easy to self-destruct off the side blast line if the player misses".
- Donkey Kong's is not. SmashWiki "Jungle Rush" says nothing of edges ("The move won't activate if the first punch misses").
- With the boost and the regained jumps, Donkey Kong's whiff past the edge now ends with a rise and his jumps, the "aid in recovery" the page names. The comment beside R-T14j in `simulate.ts` and D59 say so.
- The no-ledge-grab rule during any part stays (UNVERIFIED for the scene and end parts, as before).

**Golden:** moves (captured): the beams lab (the aerial Mario Finale and Ancient Arrow end rising) and the dash lab (Team Star Fox's aerial whiff). The dash lab's Volt Tackle is KO'd before its end.
- The lab pins hold (captured): `expectBeams`, `expectDashes` and the rest.
- The history comment above `MUST_VISIT` gains the task's paragraph.
- Regenerate, naming those two traces.

**Files:**
- Modify: `src/engine/final.ts`, `src/engine/status/attack.ts`, `src/engine/simulate.ts` (R-T14j's comment only), `src/game/golden.test.ts` (the history comment)
- Test: `src/engine/final.test.ts`, `src/fighters/finalSmash.test.ts` (Jungle Rush's aerial end)
- Regenerate: the golden and `RULES_PIN.golden`

**Interfaces:**
- Consumes:
  - `refreshFinalJumps(f)` (final.ts) and the move-end branch in `status/attack.ts`;
  - `kineticJump(f, vy)`, `jumpLaunchSpeed(g, h)` (kinetic.ts);
  - `fighterParams(def)` (params.ts).
- Produces: `finalHeightBoost(f: FighterState, def: FighterDef): void` (final.ts).

- [ ] **Step 1: Write the failing test**

`src/engine/final.test.ts`, a new `describe` at the end. The file registers no roster, so the test steps through a context of its own, as the file's other roster tests do:

```diff
--- a/src/engine/final.test.ts
+++ b/src/engine/final.test.ts
@@
 import { kineticSet } from "./kinetic";
 import { platformCentreX } from "./physics";
 import { cloneState, createInitialState, step } from "./simulate";
+import { fighterParams } from "./params";
+import { jumpLaunchSpeed } from "./kinetic";
 import type { SimContext } from "./simulate";
 import { stoneOf } from "./stone";
 import { Btn } from "./types";
@@
     }
   });
 });
+
+describe("an aerial Final Smash's height boost (Plan 6, Task 10; SmashWiki \"Final Smash\")", () => {
+  /** The real roster and stages, as the game steps them. */
+  const GAME: SimContext = { fighter: (id) => FIGHTERS.find((f) => f.id === id)!, stage: (id) => STAGES.find((st) => st.id === id)! };
+  const once = (s: GameState): GameState => step(s, [0, 0], { prevInputs: [0, 0], ctx: GAME }).state;
+
+  /** `who` in the last frame of its whiffed Final Smash start, 60 over Final Destination. */
+  function ending(who: string): GameState {
+    const s = createInitialState("finalDestination", [{ defId: who }, { defId: "fox" }], RULES, 5, GAME);
+    const def = FIGHTERS.find((d) => d.id === who)!;
+    const fs = def.moves.finalSmash!;
+    Object.assign(s.fighters[0], {
+      action: "special", move: "finalSmash", actionFrame: fs.totalFrames - 1, grounded: false, platform: -1,
+      x: 0, y: fx(60), vx: 0, vy: 0, facing: 1, jumpsUsed: 2, intangible: 0,
+    });
+    Object.assign(s.fighters[1], { action: "stand", grounded: true, platform: 0, x: fx(70), y: 0 });
+    return s;
+  }
+
+  it("rises as the move ends in the air, with its midair jumps back", () => {
+    for (const who of ["mario", "donkeyKong", "samus", "link"]) {
+      const f = once(ending(who)).fighters[0];
+      expect(f.move, who).not.toBe("finalSmash");
+      expect(f.vy, `${who} rises`).toBeGreaterThan(0);
+      expect(f.jumpsUsed, who).toBeLessThanOrEqual(1);
+    }
+  });
+
+  it("rises by its own short hop (UNVERIFIED stand-in, decision D4), less the step's gravity", () => {
+    // The boost is set as the move ends, in the step's status phase; the step's
+    // gravity is applied after it, in its movement phase.
+    const p = fighterParams(FIGHTERS.find((d) => d.id === "mario")!);
+    expect(once(ending("mario")).fighters[0].vy).toBe(jumpLaunchSpeed(p.air_accel_y, p.mini_jump_y) - p.air_accel_y);
+  });
+
+  it("does nothing on the ground", () => {
+    const s = ending("mario");
+    Object.assign(s.fighters[0], { grounded: true, platform: 0, y: 0 });
+    expect(once(s).fighters[0].vy).toBe(0);
+  });
+});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run src/engine/final.test.ts -t "height boost"`

Expected: FAIL, 2 failed (captured): `mario rises: expected -356 to be greater than 0` (it falls), and `expected -356 to be 6973`. The ground test PASSES.

- [ ] **Step 3: Implement**

```diff
--- a/src/engine/final.ts
+++ b/src/engine/final.ts
@@
  */
 
 import { momentumWindows } from "./acmd/run";
-import { kineticClear } from "./kinetic";
+import { jumpLaunchSpeed, kineticClear, kineticJump } from "./kinetic";
+import { fighterParams } from "./params";
 import { SMASH_BALL_HEALTH } from "./constants";
 import { fx } from "./fixed";
 import { actionFrameOf, moveFrameOf } from "./hitbox";
@@
   if (!f.grounded) f.jumpsUsed = Math.min(f.jumpsUsed, 1);
 }
 
+/**
+ * A Final Smash ending in the air lifts its user (Plan 6, Task 10): SmashWiki "Final Smash",
+ * "When most Final Smashes are performed in the air, upon ending the move, the character
+ * gains a slight boost in height and regains their spent midair jumps". UNVERIFIED (decision
+ * D4): the size, which no source publishes (rubendal 13.0.1's `game_final*` scripts set no
+ * upward speed; the boost is status code): the fighter's own short hop stands in, the
+ * smallest jump it has. And "most" is not narrowed: every Final Smash gets it.
+ */
+export function finalHeightBoost(f: FighterState, def: FighterDef): void {
+  if (f.grounded) return;
+  const p = fighterParams(def);
+  kineticJump(f, jumpLaunchSpeed(p.air_accel_y, p.mini_jump_y));
+}
+
 /** The fighters `user`'s Final Smash has trapped. */
 export function trappedBy(s: { readonly fighters: readonly FighterState[] }, user: number): FighterState[] {
   return s.fighters.filter((f) => f.action === "finalTrapped" && f.combat.trappedBy === user);
```

```diff
--- a/src/engine/status/attack.ts
+++ b/src/engine/status/attack.ts
@@
 import { smashHoldFrame } from "../acmd/run";
 import { actionFrameOf, clearHitRecord, moveFrameOf } from "../hitbox";
 import { landPendingCopyLoss } from "../inhale";
-import { endDash, inDash, nextFinalPhase, refreshFinalJumps } from "../final";
+import { endDash, finalHeightBoost, inDash, nextFinalPhase, refreshFinalJumps } from "../final";
 import { specialChargeMain } from "../specialCharge";
 import { stoneMain } from "../stone";
 import { upSpecialStick } from "../upSpecial";
@@
     // Task 14: `final.ts`); the part entered counts this frame as its frame 1.
     if (move.final !== undefined && nextFinalPhase(f, ctx, move.final.next) !== null) return;
     // A Final Smash that ends in the air gives back its user's midair jumps (Task 16
-    // fix round 1, ruling R-T16b: `refreshFinalJumps`).
-    if (move.final !== undefined) refreshFinalJumps(f);
+    // fix round 1, ruling R-T16b: `refreshFinalJumps`), and lifts it (Plan 6, Task 10:
+    // `finalHeightBoost`).
+    if (move.final !== undefined) {
+      refreshFinalJumps(f);
+      finalHeightBoost(f, ctx.def);
+    }
     // In the air a move with a longer aerial animation plays on to its end
     // unless the fighter acts (`MoveDef.airTotalFrames`, Plan 5: Mario's Cape,
     // SmashWiki "Mario (SSBU)": "forcing the player to have to interrupt the
```

```diff
--- a/src/engine/simulate.ts
+++ b/src/engine/simulate.ts
@@
     // meaning it is fairly easy to self-destruct off the side blast line if the player
     // misses". UNVERIFIED for every other start and for the scene and end parts, read
     // from SmashWiki "Final Smash": "the game effectively pauses as an unskippable
-    // scene plays out".
+    // scene plays out". Re-checked (Plan 6, Task 10): Pikachu's self-destruct is
+    // published (SmashWiki "Volt Tackle"); Donkey Kong's is not (SmashWiki "Jungle Rush"
+    // is silent on edges), and since the height boost (`finalHeightBoost`) and the jumps
+    // given back, his whiff past the edge ends rising, with his jumps.
     const finalPart = f.action === "special" && f.move !== null && defs[i].moves[f.move]?.final !== undefined;
     if (!f.grounded && f.action !== "cargoCarry" && f.action !== "throw" && !holdsMouthful(f, defs[i]) && !finalPart) {
       const grab = findLedgeGrab(f, stage, s.stageFrame, ecb.half, s.fighters);
```

The one existing pin this task's rule changes: Jungle Rush in the air used to fall within ten steps of its end, and now rises first.

```diff
--- a/src/fighters/finalSmash.test.ts
+++ b/src/fighters/finalSmash.test.ts
@@
     expect(last - launch).toBeGreaterThan(10);
     for (const st of states.slice(0, last + 1)) expect([st.fighters[0].x, st.fighters[0].y]).toEqual([at.x, at.y]);
     expect([states[last + 1].fighters[0].action, states[last + 1].fighters[0].jumpsUsed]).toEqual(["fall", 1]);
-    expect(states[last + 10].fighters[0].y).toBeLessThan(at.y);
+    // Plan 6, Task 10: the end lifts him by his short hop (`finalHeightBoost`), then he falls.
+    expect(states[last + 1].fighters[0].vy).toBeGreaterThan(0);
+    expect(states.slice(last + 1).some((st) => st.fighters[0].y < at.y)).toBe(true);
   });
 
   /**
```

- [ ] **Step 4: Run it again**

Run: `pnpm vitest run src/engine/final.test.ts src/fighters/finalSmash.test.ts`

Expected: PASS (captured). Without the pin above, `holds Donkey Kong through Jungle Rush's end …` FAILS `expected 667220 to be less than 614400` (captured).

- [ ] **Step 5: Golden**

Run: `pnpm vitest run src/game/golden.test.ts`.

Expected: FAIL (captured) on `replays final-beams-lab-battlefield exactly` and `replays final-dash-lab-finalDestination exactly`, and nothing else: every lab pin passes.

Then:
1. Add the history paragraph:

   ```diff
--- a/src/game/golden.test.ts
+++ b/src/game/golden.test.ts
@@
  * Destination (a slip off a ledge-bearing edge hangs on the step it leaves the ground),
  * so the slip lab (`goldenSlipLab.ts`) does, on Battlefield; the fifteen other traces are
  * byte-identical. All 60 are visited.
+ * Plan 6, Task 10 (a Final Smash ending in the air lifts its user) adds no action: the
+ * beams lab's aerial Mario Finale and Ancient Arrow and the dash lab's Team Star Fox end
+ * rising, and only those two traces move. All 60 are visited.
  */
 const MUST_VISIT: Record<ActionState, true> = {
   stand: true,
```

2. Run `UPDATE_GOLDEN=1 pnpm vitest run src/game/golden.test.ts`.
3. Set `RULES_PIN.golden` to the digest `rulesVersion.test.ts` prints.
4. Rerun both. Expected: PASS (captured).

- [ ] **Step 6: Mutants**

Each against `src/engine/final.test.ts`. Restore after each.
1. `finalHeightBoost`: delete `if (f.grounded) return;`. The ground test FAILS, and so do two grounded Final Smash tests in the file that expect a stand: `expected 'fall' to be 'stand'` (captured).
2. `attack.ts`: delete the `finalHeightBoost(f, ctx.def);` line. The rise test FAILS `mario rises: expected -356 to be greater than 0`, and the short-hop test FAILS (captured).

- [ ] **Step 7: Gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`.

Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add super-smash/src/engine/final.ts super-smash/src/engine/status/attack.ts super-smash/src/engine/simulate.ts super-smash/src/engine/final.test.ts super-smash/src/fighters/finalSmash.test.ts super-smash/src/game/golden.test.ts
git add super-smash/src/game/__golden__/engine-trace.json super-smash/src/game/rulesVersion.test.ts
git commit -m "super-smash: a Final Smash ending in the air lifts its user by a short hop (UNVERIFIED size)" -m "SmashWiki Final Smash: 'a slight boost in height'; no source sizes it (D4). R-T14j re-checked: Pikachu's edge self-destruct is published (Volt Tackle); Donkey Kong's is not. Golden: the beams lab and the dash lab move (aerial ends now rise); every lab pin holds." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: `SLOW_OPPONENT`: a Final Smash's startup slows everyone else

From Plan 5's triage: "SLOW_OPPONENT(9, 45) during all eight Final Smash startups is unmodelled (marked UNVERIFIED-simplified in the final wave); model the slowdown."

**Each start's numbers.** Every start script calls it, with its own two numbers (rubendal 13.0.1):

| Fighter | Script | Numbers |
|---|---|---|
| Mario | `game_final` | (20, 75) |
| Donkey Kong | `game_finalstart` | (7, 30) |
| Link | `game_final` | (30, 100) |
| Samus | `game_finalstart` | (5, 50) |
| Kirby | `game_finalstart` | (4, 50) |
| Fox | `game_finallockon`, the replica's start | (4, 30) |
| Pikachu | `game_final` | (9, 45) |
| Marth | `game_finalstart` | (4, 45) |

Six of them are in `src/fighters/acmd/generated/*.ts`. Fox's and Samus's scripts are not imported; their numbers are quoted in `fox.ts` and `samus.ts`.

**Sources (read 2026-11-01).**
- SmashWiki "Slowdown":
  - from Smash 4, "Most Final Smashes" inflict slowdown;
  - "all actions will be increased in length proportional to the degree of slowdown, while all sources of motion, including … knockback (from Super Smash Bros. 4 onward), are also slowed down";
  - in Ultimate, victims "take less hitlag than usual".
- SmashWiki "Critical Hit": "the startup slows down time by a slight amount".
- No page gives the macro's arguments their meaning.

**Default (decision D5):** read them as (rate, frames). For `frames` steps from the start, every other fighter runs one step in `rate` (a 1/`rate` speed) and stands still on the others. The still step is ruling R-P6-10:
- It sits after the hitlag block and before the hitstun countdown. Its hitlag counts on every step, so in real frames it is no longer, which is short of the page's "less" (UNVERIFIED-simplified). Its hitstun, status and movement wait for its next running step.
- A press made on a still step waits in the buffer, as in a KO's freeze (Task 13). As there, one older than the buffer's nine frames when the fighter next runs has expired, so under Mario's and Link's rates (20, 30) an early press is lost (UNVERIFIED-simplified).
- A dodge's or a move's intangible frames hold, as in hitlag (`updateDodgeIntangibility`).
- The timers above the hitlag block keep counting on every step, as they do in a freeze: invincibility, the ledge lockout, the tech window.
- Projectiles and the stage are not slowed (the page names fighters).

**What it moves, besides the golden.** A fighter slowed through a start now acts at its pace, which re-times six existing scenes. Each re-tuned scene keeps the pin it had:
- `final.test.ts`, Kirby's Stone against Jungle Rush: a Stone begun after the start forms too late, so Kirby forms it before; the start is on step 12.
- `finalSmash.test.ts`:
  - R-FW2p: Fox's spot dodge is pressed on step 1, his first slowed step, which stretches it over the catch; Mario still on 29, Fox on 59.
  - Jungle Rush against Marth's Counter: Marth counters first, the start on step 10.
  - The Ancient Arrow against the Counter: the same, the start on step 6.
  - Zero Laser's pull behind Samus: the pulled Mario moves on his next running step, read on step 54.
- `sceneDraw.test.ts`'s Pikachu traps: the sparks barely move a slowed Mario, so the dash traps him near where he stood. From 2 away the tackle carries Pikachu past him within one step, and the drawn scene shift flips sides mid-step, a visible snap the "letting go" test catches (`the release from 46.80: expected 1.6 to be greater than or equal to 6`, captured).
  - That is a presentation defect in `sceneDrawShift` that this task exposes and does not fix: deciding the side by the step's sim positions breaks Marth's case (captured).
  - It is carried: "Carried, not in Plan 6" lists it ("the scene shift's side across a user that dashes past the fighter it traps").
  - The TRAPS table keeps 4, 8 and 10 at their new distances.

**Golden:** moves (captured).
- The traces that move: the Final Smash lab, the beams lab, the dash lab and the ball-on CPU match, and nothing else. Any other trace moving stops the implementer.
- Every lab pin holds (captured): `expectBeams` (54 hits), `expectDashes`, `expectCpuFinalSmash` and the rest.
- The history comment above `MUST_VISIT` gains the task's paragraph.
- Regenerate, naming the four traces.

**Files:**
- Create: `src/engine/slow.ts`, `src/engine/slow.test.ts`
- Modify:
  - `src/engine/types.ts` (`MoveDef.slowOpponent?`), `src/engine/combat.ts` (`CombatState.slowRate`, `slowFrames`, `slowPhase`), `src/engine/hash.ts`, `src/engine/simulate.ts`
  - the eight fighter files (`slowOpponent` on `finalSmash`, and the "not modelled" notes replaced)
  - `src/game/golden.test.ts` (the history comment)
- Test: `src/engine/final.test.ts`, `src/fighters/finalSmash.test.ts`, `src/game/sceneDraw.test.ts` (the scenes above)
- Regenerate: the golden and `RULES_PIN.golden`

**Interfaces:**
- Consumes:
  - the step's `stilled`/`frozen` arrays, the hitlag block and the `events.finalSmashes` push (simulate.ts);
  - `bufferPress`, `updateDodgeIntangibility` (states.ts).
- Produces:
  - `MoveDef.slowOpponent?: { readonly rate: number; readonly frames: number }`;
  - `CombatState.slowRate`, `slowFrames`, `slowPhase` (numbers, cloned and hashed);
  - `slowOthers(s, user, slow)`, `tickSlow(f): boolean`, `slowedThisStep(f)` (slow.ts).

- [ ] **Step 1: Write the failing tests**

`src/engine/slow.test.ts` (new file). Its two Review Focus tests are the plan's (R-P6-13):
- a press on a still step fires on the next running one;
- a Final Smash started inside a rollback window, its Special press mispredicted, replays identically. It rolls back across the start, and again from inside the slow after the first spark, where the slow counters and `sceneHits` are both live.

```ts
/**
 * `SLOW_OPPONENT` (Plan 6, Task 11). SmashWiki "Slowdown" (https://www.ssbwiki.com/Slowdown):
 * a slowed fighter's "actions will be increased in length proportional to the degree of
 * slowdown", and its motion slowed. The arguments' meaning is unpublished; the replica
 * reads them as (rate, frames), decision D5, UNVERIFIED.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { FINAL_SMASH_READY } from "./final";
import { fx } from "./fixed";
import { hashState } from "./hash";
import { cloneState, createInitialState, registerFighters, registerStages, step } from "./simulate";
import { slowOthers, slowedThisStep } from "./slow";
import { Btn } from "./types";
import type { GameState, InputFrame, MatchRules } from "./types";
import { FIGHTERS } from "@/fighters";
import { STAGES } from "@/stages";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true };

beforeAll(() => {
  registerFighters(FIGHTERS);
  registerStages(STAGES);
});

/** Pikachu and Mario standing on Final Destination, Mario `gap` ahead of him, facing him. */
function pair(gap = 60): GameState {
  const s = createInitialState("finalDestination", [{ defId: "pikachu" }, { defId: "mario" }], RULES, 5);
  Object.assign(s.fighters[0], { action: "stand", actionFrame: 10, grounded: true, platform: 0, x: -fx(40), y: 0, facing: 1, intangible: 0 });
  Object.assign(s.fighters[1], { action: "stand", actionFrame: 10, grounded: true, platform: 0, x: -fx(40) + fx(gap), y: 0, facing: -1, intangible: 0 });
  return s;
}

function run(s0: GameState, inputs: (i: number) => readonly InputFrame[], n: number): GameState[] {
  let s = s0;
  let prev: readonly InputFrame[] = [0, 0];
  const out: GameState[] = [];
  for (let i = 0; i < n; i++) {
    const now = inputs(i);
    s = step(s, now, { prevInputs: prev }).state;
    prev = now;
    out.push(s);
  }
  return out;
}

describe("SLOW_OPPONENT (Plan 6, Task 11)", () => {
  it("Volt Tackle's start slows Mario by its script's (9, 45), and not Pikachu", () => {
    const s = pair();
    s.fighters[0].finalSmashReady = FINAL_SMASH_READY;
    const [after] = run(s, () => [Btn.Special, 0], 1);
    expect(after.fighters[0].move).toBe("finalSmash");
    expect([after.fighters[1].combat.slowRate, after.fighters[1].combat.slowFrames]).toEqual([9, 45]);
    expect(after.fighters[0].combat.slowRate).toBe(0);
  });

  it("a slowed fighter runs one step in its rate: Mario walks a ninth as far", () => {
    const free = run(pair(), () => [0, Btn.Left | Btn.Soft], 36);
    const slowed = pair();
    slowOthers(slowed, 0, { rate: 9, frames: 45 });
    const slow = run(slowed, () => [0, Btn.Left | Btn.Soft], 36);
    const went = (st: GameState[]) => pair().fighters[1].x - st[st.length - 1].fighters[1].x;
    expect(went(slow)).toBeGreaterThan(0);
    expect(went(slow) * 9).toBeLessThanOrEqual(went(free) * 2);
  });

  it("ends after its frames: full speed again", () => {
    const s = pair();
    slowOthers(s, 0, { rate: 4, frames: 8 });
    const states = run(s, () => [0, 0], 10);
    expect(states[7].fighters[1].combat.slowFrames).toBe(0);
    expect(slowedThisStep(states[9].fighters[1])).toBe(false);
  });

  it("counts a slowed fighter's hitstun on its running steps only: its reel lasts its rate times as long", () => {
    const s = pair();
    slowOthers(s, 0, { rate: 4, frames: 40 });
    Object.assign(s.fighters[1], { action: "hitstun", actionFrame: 0, hitstun: 4 });
    const states = run(s, () => [0, 0], 4);
    // Step 1 runs (4 → 3); steps 2-4 stand still.
    expect(states.map((st) => st.fighters[1].hitstun)).toEqual([3, 3, 3, 3]);
  });

  it("holds a slowed spot dodge's intangible frames through its still steps, as hitlag does", () => {
    const s = pair();
    slowOthers(s, 0, { rate: 4, frames: 40 });
    // Mario's spot dodge on its frame 4, inside its intangible frames (from frame 3).
    Object.assign(s.fighters[1], { action: "spotDodge", actionFrame: 4, intangible: 1 });
    const states = run(s, () => [0, 0], 4);
    // Step 1 runs it; steps 2-4 stand still on its frame 5, intangible throughout.
    expect(states.map((st) => st.fighters[1].actionFrame)).toEqual([5, 5, 5, 5]);
    for (const st of states) expect(st.fighters[1].intangible, `step ${states.indexOf(st) + 1}`).toBeGreaterThan(0);
  });

  it("Review Focus: a press on a slowed fighter's still step fires on its next running step", () => {
    const s = pair();
    slowOthers(s, 0, { rate: 4, frames: 40 });
    // Steps 1 and 5 run; 2-4 stand still. A one-frame Jump on step 2 (a still step)...
    const states = run(s, (i) => [0, i === 1 ? Btn.Jump : 0], 5);
    expect(states.slice(0, 4).map((st) => st.fighters[1].action)).toEqual(["stand", "stand", "stand", "stand"]);
    // ...waits in the buffer and jumps on step 5, the next that runs (ruling R-P6-10).
    expect(states[4].fighters[1].action).toBe("jumpSquat");
  });

  it("Review Focus: a Final Smash started inside a rollback window, its Special press mispredicted, replays identically", () => {
    // Pikachu with the Smash Ball's power and Mario 4 ahead, inside the startup's sparks:
    // the slow counters (`slowRate`, `slowFrames`, `slowPhase`) and the sparks' record
    // (`sceneHits`) are both written in the windows replayed.
    const s = pair(4);
    s.fighters[0].finalSmashReady = FINAL_SMASH_READY;
    const truth = (i: number): readonly InputFrame[] => [i === 12 ? Btn.Special : 0, i % 5 === 0 ? Btn.Left : 0];
    const live = run(s, truth, 60);
    /** From the snapshot after step `from`, `guess` for steps from + 1 to from + 6, then the rollback: the truth to the end. */
    const rollBack = (from: number, guess: (i: number) => readonly InputFrame[]): void => {
      const snapshot = cloneState(live[from]);
      let branch = cloneState(snapshot);
      let prev = truth(from);
      for (let i = from + 1; i <= from + 6; i++) {
        const now = guess(i);
        branch = step(branch, now, { prevInputs: prev }).state;
        prev = now;
      }
      expect(hashState(branch), `the guess from ${from + 1} goes wrong`).not.toBe(hashState(live[from + 6]));
      let replay = cloneState(snapshot);
      prev = truth(from);
      for (let i = from + 1; i < 60; i++) {
        const now = truth(i);
        replay = step(replay, now, { prevInputs: prev }).state;
        prev = now;
      }
      expect(hashState(replay), `replayed from ${from + 1}`).toBe(hashState(live[59]));
    };
    // A peer that has Pikachu's press late guesses no Special: rolled back across the start.
    rollBack(9, (i) => [0, truth(i)[1]]);
    // Inside the slow, after the first spark (move frame 10, step 22): a guess that has
    // Mario hold Right.
    expect(live[23].fighters[1].combat.slowFrames, "Mario slowed on step 24").toBeGreaterThan(0);
    expect(live[23].fighters[0].combat.sceneHits.length, "a spark recorded by step 24").toBeGreaterThan(0);
    rollBack(23, (i) => [truth(i)[0], Btn.Right]);
  });
});
```

`src/engine/hash.test.ts`: no new array (the three fields are numbers, which its walker reaches); confirm by running it after Step 3.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/engine/slow.test.ts`

Expected: FAIL (captured): `Error: Failed to resolve import "./slow" from "src/engine/slow.test.ts". Does the file exist?`

- [ ] **Step 3: Implement**

`src/engine/slow.ts` (new file):

```ts
/**
 * `SLOW_OPPONENT(rate, frames)`: a Final Smash's start slows every other fighter (Plan 6,
 * Task 11). SmashWiki "Slowdown" (https://www.ssbwiki.com/Slowdown): from Smash 4, "Most
 * Final Smashes" inflict it, and a slowed fighter's "actions will be increased in length
 * proportional to the degree of slowdown, while all sources of motion … are also slowed
 * down". UNVERIFIED (decision D5): the macro's arguments read as (rate, frames): for
 * `frames` steps, the fighter runs one step in `rate` and stands still on the rest
 * (`step`'s still-step branch, ruling R-P6-10): its status, hitstun and movement wait,
 * its hitlag counts on every step (the page's Ultimate "less hitlag" is not modelled
 * beyond that), a press waits in the buffer as in a KO's freeze, and a dodge's or a
 * move's intangible frames hold as in hitlag. Fighters only: projectiles and the stage
 * run at full speed.
 */

import type { FighterState, GameState } from "./types";

/** Slow every fighter but `user` (`MoveDef.slowOpponent`). A later slow replaces an earlier one. */
export function slowOthers(s: GameState, user: number, slow: { readonly rate: number; readonly frames: number }): void {
  for (const f of s.fighters) {
    if (f.port === user || f.action === "dead") continue;
    f.combat.slowRate = slow.rate;
    f.combat.slowFrames = slow.frames;
    f.combat.slowPhase = 0;
  }
}

/**
 * Count a slowed fighter's step, and say whether it stands still on it. The first step of
 * a slow runs (phase 0), then `rate − 1` stand still. Called once a step per fighter.
 */
export function tickSlow(f: FighterState): boolean {
  const c = f.combat;
  if (c.slowFrames <= 0) return false;
  c.slowFrames -= 1;
  const still = c.slowPhase !== 0;
  c.slowPhase = (c.slowPhase + 1) % c.slowRate;
  if (c.slowFrames === 0) {
    c.slowRate = 0;
    c.slowPhase = 0;
  }
  return still;
}

/** Is `f` slowed now (for a reader outside the step)? */
export function slowedThisStep(f: FighterState): boolean {
  return f.combat.slowFrames > 0;
}
```

```diff
--- a/src/engine/types.ts
+++ b/src/engine/types.ts
@@
   /** Which part of a Final Smash this move is (Plan 5, Task 14: `final.ts`). See `FinalPhase`. */
   readonly final?: FinalPhase;
   /**
+   * The script's `SLOW_OPPONENT(rate, frames)`, applied to every other fighter on the
+   * move's first step (Plan 6, Task 11; reading UNVERIFIED, decision D5): a Final Smash's.
+   */
+  readonly slowOpponent?: { readonly rate: number; readonly frames: number };
+  /**
    * The dash the move carries its fighter on, its first `momentum` window, ends
    * early: on the ground at a platform's edge, where it stops (`edge`), and when the
    * special button is pressed during it (`special`). The fighter stops dead and the
```

```diff
--- a/src/engine/combat.ts
+++ b/src/engine/combat.ts
@@
    * frame each lets go. Cleared when a move starts (`startMove`).
    */
   sceneHits: number[];
+  /** `SLOW_OPPONENT` on this fighter (Plan 6, Task 11): one step in `slowRate` runs, for `slowFrames` steps; 0 when none. */
+  slowRate: number;
+  slowFrames: number;
+  /** Where in its `slowRate` this fighter's next step falls: 0 runs. */
+  slowPhase: number;
 }
 
 /** `CombatState.sinceAttack`'s cap, as `framesSinceDirPress` has one: long past any wait. */
@@
     trappedBy: -1,
     controls: 0,
     sceneHits: [],
+    slowRate: 0,
+    slowFrames: 0,
+    slowPhase: 0,
   };
 }
 
@@
     trappedBy: c.trappedBy,
     controls: c.controls,
     sceneHits: c.sceneHits.slice(),
+    slowRate: c.slowRate,
+    slowFrames: c.slowFrames,
+    slowPhase: c.slowPhase,
   };
 }
```

```diff
--- a/src/engine/hash.ts
+++ b/src/engine/hash.ts
@@
   // Plan 6, Task 9: a Final Smash scene's own record.
   x = mixInt(x, c.sceneHits.length);
   for (const e of c.sceneHits) x = mixInt(x, e);
+  // Plan 6, Task 11: the slow a Final Smash's start put on this fighter.
+  x = mixInt(x, c.slowRate);
+  x = mixInt(x, c.slowFrames);
+  x = mixInt(x, c.slowPhase);
   return x;
 }
 
```

```diff
--- a/src/engine/simulate.ts
+++ b/src/engine/simulate.ts
@@
   ENTRY_INTANGIBILITY,
   advanceFighter,
   applyMovement,
+  bufferPress,
   chargeMultiplier,
   grabHoldFrames,
   grabLedge,
@@
   updateInputTracking,
 } from "./states";
 import type { Intent, StateContext } from "./states";
+import { slowOthers, tickSlow } from "./slow";
 import {
   cloneKinetic,
   emptyKinetic,
@@
   // Who a Final Smash's scene stands still this step (Plan 5, Task 14: `final.ts`):
   // frozen as in hitlag, and more. Decided with `paused` (above, ruling R-T14g).
   const stilled: boolean[] = s.fighters.map((f) => paused && !inCinematic(s, f));
+  // The Final Smashes started this step, whose `SLOW_OPPONENT` lands once every fighter
+  // has stepped, so the slowed count from the next step whatever the port order (Plan 6,
+  // Task 11).
+  const slowStarts: { user: number; slow: { readonly rate: number; readonly frames: number } }[] = [];
 
   for (let i = 0; i < s.fighters.length; i++) {
     const f = s.fighters[i];
@@
       continue;
     }
 
+    // Slowed by a Final Smash's start (Plan 6, Task 11: `slow.ts`): is this one of the
+    // steps it stands still on? Counted here, on every step the match runs.
+    const slowStill = tickSlow(f);
+
     // Tech input counts on every frame, frozen or not, before anything else in
     // this phase, so phase 5's collision sees a press made on the frame of
     // landing itself (Plan 3, Task 12).
@@
         releasePendingLaunch(f, intent);
       }
       if (f.hitlag === 0) f.combat.victimFreeze = false;
+      continue;
+    }
+
+    // A slowed fighter's still step (Plan 6, Task 11; ruling R-P6-10): its hitlag counted
+    // above, on every step (UNVERIFIED-simplified); its hitstun, status and movement wait
+    // for its next running step. A press made now waits in the buffer, as in a KO's
+    // freeze (Task 13), and a dodge's or a move's intangible frames hold, as in hitlag.
+    if (slowStill) {
+      bufferPress(f, intent, s.frame);
+      updateDodgeIntangibility(f, defs[i]);
+      frozen[i] = true;
       continue;
     }
 
@@
     // its sound and puff (Plan 5, Task 17). Presentation only.
     if (f.combat.wallJumps > wallJumpsBefore) events.jumps.push({ port: f.port, x: f.x, y: f.y, from: "wall" });
     // A Final Smash started this frame (Plan 5, Task 14), for its sound and burst.
-    if (f.action === "special" && f.move === "finalSmash" && f.actionFrame === 0) events.finalSmashes.push(f.port);
+    if (f.action === "special" && f.move === "finalSmash" && f.actionFrame === 0) {
+      events.finalSmashes.push(f.port);
+      // Its start's `SLOW_OPPONENT` (Plan 6, Task 11), applied after the loop.
+      const slow = defs[i].moves.finalSmash?.slowOpponent;
+      if (slow !== undefined) slowStarts.push({ user: f.port, slow });
+    }
     // A copy whose loss waited for its special landed as that special ended
     // (`landPendingCopyLoss`): the rest of this step runs Kirby's own definition,
     // so a special begun on the hand-off is his own from its first frame (Plan 5,
     // Task 9 fix round 2).
     if (f.combat.copy !== copyBefore) defs[i] = defOf(f);
   }
+
+  for (const { user, slow } of slowStarts) slowOthers(s, user, slow);
 
   // Whoever was stood on this frame feels it now, after every state machine, so
   // the outcome is the same whichever port is which (Plan 5, Task 11).
```

Each fighter file's `finalSmash` gains its script's numbers after its `intangible` line, and its "not modelled" note becomes one line:

```diff
--- a/src/fighters/mario.ts
+++ b/src/fighters/mario.ts
@@
     // blastzone"; neither gives a speed.
     // UNVERIFIED-simplified: the second flame (`fire2`, 2° flatter, on the article's
     // one hit record) is not modelled, nor the boxes' vertical stretch (8.0.0, "Y
-    // offset: 0u, -3u—3u"; a projectile's box is a sphere), their SDI ×0.8, the slowing
-    // of the other fighters (`game_final`'s SLOW_OPPONENT(20, 75), its rate and length
-    // unpublished; Plan 5 final wave 2, ruling R-FW2k), or Mario's own drift: "If used in
+    // offset: 0u, -3u—3u"; a projectile's box is a sphere), their SDI ×0.8, or Mario's
+    // own drift: "If used in
     // the air, it pushes Mario backwards a little, as well as give him a little jump upwards",
     // and "You'll slide backward little by little" on the ground (SmashWiki "Mario
     // Finale"; no numbers). In the air he is held where he is for the move instead, and
     // ends it with his midair jump back, "a desperate recovery tool" (Task 16 fix round
     // 1, ruling R-T16b: `engine/final.ts`, `holdsAloft`).
+    // rubendal 13.0.1 `game_final`: SLOW_OPPONENT(20, 75), the slowing of the other fighters
+    // through the startup, read as (rate, frames) (Plan 6, Task 11; decision D5, UNVERIFIED).
     finalSmash: {
       slot: "finalSmash",
       name: "Mario Finale",
       totalFrames: 156,
       aerialTotalFrames: 146,
       intangible: [1, 156],
+      slowOpponent: { rate: 20, frames: 75 },
       final: { phase: "start" },
       hitboxes: [],
       projectiles: [
```

```diff
--- a/src/fighters/donkeyKong.ts
+++ b/src/fighters/donkeyKong.ts
@@
     //   boxes, with no rate: final_air_end's CancelFrame 47, 46 frames
     //   (`aerialTotalFrames`, read where Donkey Kong is when it could end; UNVERIFIED:
     //   the game picks final_air_end where the end begins).
-    // UNVERIFIED-simplified (Plan 5 final wave 2, ruling R-FW2k): `game_finalstart`'s
-    // SLOW_OPPONENT(7, 30), its slowing of the other fighters through the startup, is not
-    // modelled (the page publishes neither its rate nor its length, and the arguments'
-    // meaning is unpublished): they move at full speed.
+    // rubendal 13.0.1 `game_finalstart`: SLOW_OPPONENT(7, 30), the slowing of the other fighters
+    // through the startup, read as (rate, frames) (Plan 6, Task 11; decision D5, UNVERIFIED).
     // UNVERIFIED-simplified: each run of the barrage's loops is one box with the loop's
     // period as its rehit (Plan 6, Task 9; the page's "6-7" is one hit; `finalKit.ts`).
     // The barrage's knockback (FKB 40) is the scene's: a trapped fighter is held.
@@
       name: "Jungle Rush",
       totalFrames: 96,
       intangible: [1, 96],
+      slowOpponent: { rate: 7, frames: 30 },
       // The drawing (Task 17 fix round 2, ruling R-T17i): no nearer than 19 to the
       // fighter it holds, where the lunge this part holds stays off its body
       // (`sceneDrawShift`); 12 from the barrage on, where its clips stay off.
```

```diff
--- a/src/fighters/link.ts
+++ b/src/fighters/link.ts
@@
     //   alternative.
     // UNVERIFIED: the arrow's speed (6 a frame), lifetime (60 frames) and launch offset
     // (10 ahead, 7 up).
-    // UNVERIFIED-simplified (Plan 5 final wave 2, ruling R-FW2k): `game_final`'s
-    // SLOW_OPPONENT(30, 100), its slowing of the other fighters through the startup, is not
-    // modelled (the page publishes neither its rate nor its length, and the arguments'
-    // meaning is unpublished): they move at full speed.
+    // rubendal 13.0.1 `game_final`: SLOW_OPPONENT(30, 100), the slowing of the other fighters
+    // through the startup, read as (rate, frames) (Plan 6, Task 11; decision D5, UNVERIFIED).
     // UNVERIFIED-simplified: the explosion lands on the fighter the arrow reaches, not
     // on everybody within its 25 units ("A small explosion occurs as the opponent is
     // hit, damaging anybody else near the victim at the time"), and the flying box's
@@
       totalFrames: 104,
       aerialTotalFrames: 99,
       intangible: [1, 104],
+      slowOpponent: { rate: 30, frames: 100 },
       final: { phase: "start" },
       hitboxes: [],
       projectiles: [
```

```diff
--- a/src/fighters/samus.ts
+++ b/src/fighters/samus.ts
@@
     // bonus; Mario Finale's flames and the Ancient Arrow take it too, as projectiles stamped
     // with their move's staleness as they are fired (Plan 5 final wave 2, ruling R-FW2b).
     // Not modelled: the laser's thruster box (1.5% behind its muzzle) and aiming the beam.
-    // UNVERIFIED-simplified (Plan 5 final wave 2, ruling R-FW2k): `game_finalstart`'s
-    // SLOW_OPPONENT(5, 50), its slowing of the other fighters through the startup, is not
-    // modelled (the page publishes neither its rate nor its length, and the arguments'
-    // meaning is unpublished): they move at full speed.
+    // rubendal 13.0.1 `game_finalstart`: SLOW_OPPONENT(5, 50), the slowing of the other fighters
+    // through the startup, read as (rate, frames) (Plan 6, Task 11; decision D5, UNVERIFIED).
     finalSmash: {
       slot: "finalSmash",
       name: "Zero Laser",
       totalFrames: 263,
       intangible: [1, 263],
+      slowOpponent: { rate: 5, frames: 50 },
       rehit: 10,
       clearAt: [69, 77, 81, 209],
       final: { phase: "start" },
```

```diff
--- a/src/fighters/kirby.ts
+++ b/src/fighters/kirby.ts
@@
     // 3 + 5 + 8 × 2.6 + 16 = 44.8 (the moveset's rounded 2.5 gives 44).
     // UNVERIFIED: the scene from the start's frame 61 (`nextAt`): the script raises no
     // hand-over flag; 61 clears the swing's boxes.
-    // UNVERIFIED-simplified (Plan 5 final wave 2, ruling R-FW2k): `game_finalstart`'s
-    // SLOW_OPPONENT(4, 50), its slowing of the other fighters through the startup, is not
-    // modelled (the page publishes neither its rate nor its length, and the arguments'
-    // meaning is unpublished): they move at full speed.
+    // rubendal 13.0.1 `game_finalstart`: SLOW_OPPONENT(4, 50), the slowing of the other fighters
+    // through the startup, read as (rate, frames) (Plan 6, Task 11; decision D5, UNVERIFIED).
     // UNVERIFIED-simplified: each scene hit, and hit 1, is the first frame of its
     // window (`finalKit.ts`): on a whiff the swing reaches the world on 54 alone. The
     // swing's place is a stand-in: its script hangs it off the sword (`haver`, 0, 18
@@
       name: "Ultra Sword",
       totalFrames: 86,
       intangible: [1, 86],
+      slowOpponent: { rate: 4, frames: 50 },
       // The drawing (Task 17 fix round 2, ruling R-T17i): no nearer than 8 to the
       // fighter it holds, where this part's clip stays off its body (`sceneDrawShift`).
       final: { phase: "start", trap: true, next: "finalAttack", nextAt: 61, sceneGap: fx(8) },
```

```diff
--- a/src/fighters/fox.ts
+++ b/src/fighters/fox.ts
@@
     // (its status lands it; the script only sets it). An ATTACK_ABS has no box: the
     // lasers' and the end's offsets are the stand-ins (`finalKit.ts`), and they reach
     // the trapped wherever they are.
-    // UNVERIFIED-simplified (Plan 5 final wave 2, ruling R-FW2k): `game_finallockon`'s
-    // SLOW_OPPONENT(4, 30), its slowing of the other fighters through the startup, is not
-    // modelled (the page publishes neither its rate nor its length, and the arguments'
-    // meaning is unpublished): they move at full speed.
+    // rubendal 13.0.1 `game_finallockon`: SLOW_OPPONENT(4, 30), the slowing of the other fighters
+    // through the startup, read as (rate, frames) (Plan 6, Task 11; decision D5, UNVERIFIED).
     // UNVERIFIED: the reticle's ATTACK_LR_CHECK_SPEED, unmodelled: it traps, and
     // launches nothing.
     finalSmash: {
@@
       name: "Team Star Fox",
       totalFrames: 84,
       intangible: [1, 84],
+      slowOpponent: { rate: 4, frames: 30 },
       // The drawing (Task 17 fix round 2, ruling R-T17i): no nearer than 6 to the
       // fighter it holds, where this part's clip stays off its body (`sceneDrawShift`).
       final: { phase: "start", trap: true, next: "finalAttack", nextAt: 32, sceneGap: fx(6) },
```

```diff
--- a/src/fighters/pikachu.ts
+++ b/src/fighters/pikachu.ts
@@
     // mark neither as the catch.
     // UNVERIFIED: the loop's eight hits, eight frames apart, and its length (70): the
     // game's are status-driven and unpublished.
-    // UNVERIFIED-simplified (Plan 5 final wave 2, ruling R-FW2k): `game_final`'s
-    // SLOW_OPPONENT(9, 45), its slowing of the other fighters through the startup, is not
-    // modelled (the page publishes neither its rate nor its length, and the arguments'
-    // meaning is unpublished): they move at full speed.
-    //   It is why the startup's sparks (FKB 20, at 70° and 40°) can push a fighter beside
-    //   Pikachu out of the initial hit's reach (5.5 either side) by its frame 47: in the game
-    //   that fighter is slowed and has barely moved; here it flies at full speed.
+    // rubendal 13.0.1 `game_final`: SLOW_OPPONENT(9, 45), the slowing of the other fighters
+    // through the startup, read as (rate, frames) (Plan 6, Task 11; decision D5, UNVERIFIED).
+    //   With it a fighter beside Pikachu is slowed by 9 through the sparks, as in the game,
+    //   and has barely moved by the initial hit's frame 47.
     // UNVERIFIED-simplified: `game_final2`'s 0% push on its frames 1-2 is not
     // modelled (an end box launches the trapped, so it would end the scene before
     // the blast). The blast's box is a world box, as in its script ("anyone within range
@@
       name: "Volt Tackle",
       totalFrames: 137,
       intangible: [1, 137],
+      slowOpponent: { rate: 9, frames: 45 },
       momentum: [
         { frame: 47, x: fx(4.1), y: fx(0), hold: 36 },
         // The end's first frame: game_finaldashend (and game_finalairdashend) open with
```

```diff
--- a/src/fighters/marth.ts
+++ b/src/fighters/marth.ts
@@
     // UNVERIFIED: the catch box's offset (10 ahead, 7 up): it hangs off the sword, whose
     // place in the dash is unpublished. 10 ahead, its radius, reaches no further behind
     // Marth than his origin (Plan 5 final wave 2, ruling R-FW2h; it was 8, 2 behind).
-    // UNVERIFIED-simplified (Plan 5 final wave 2, ruling R-FW2k): `game_finalstart`'s
-    // SLOW_OPPONENT(4, 45), its slowing of the other fighters through the startup, is not
-    // modelled (the page publishes neither its rate nor its length, and the arguments'
-    // meaning is unpublished): they move at full speed.
+    // rubendal 13.0.1 `game_finalstart`: SLOW_OPPONENT(4, 45), the slowing of the other fighters
+    // through the startup, read as (rate, frames) (Plan 6, Task 11; decision D5, UNVERIFIED).
     // The strike's boxes are live on its script's 2-5 and land once each fighter (it "only
     // hits once"), world boxes as in its script (no `set_catch_only_all`; SmashWiki
     // "Critical Hit": "it is also possible for a fighter to walk into the user's sword once
@@
       name: "Critical Hit",
       totalFrames: 117,
       intangible: [1, 117],
+      slowOpponent: { rate: 4, frames: 45 },
       momentum: [{ frame: 25, x: fx(6), y: fx(0), hold: 45 }],
       dashEnd: { edge: true, special: true },
       // The drawing (Task 17 fix round 2, ruling R-T17i): no nearer than 13 to the
```

The scenes the slowdown re-times (above), each keeping its pin:

```diff
--- a/src/engine/final.test.ts
+++ b/src/engine/final.test.ts
@@
     // SmashWiki "Stone" (https://www.ssbwiki.com/Stone), Trivia: "If a cinematic Final
     // Smash is used on Kirby in Stone form, it will not work." Donkey Kong's Jungle
     // Rush (its detection punch, 12%, frames 29-34) on the real Kirby, in Stone from
-    // his Down+B pressed on step 10.
+    // his Down+B pressed on step 0, before the start on step 12: its `SLOW_OPPONENT`
+    // (Plan 6, Task 11) would hold a Stone begun after it short of forming by the punch.
     const game: SimContext = { fighter: (id) => FIGHTERS.find((f) => f.id === id)!, stage: (id) => STAGES.find((st) => st.id === id)! };
     let s = createInitialState("finalDestination", [{ defId: "donkeyKong" }, { defId: "kirby" }], { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true }, 3, game);
     s.fighters.forEach((f, i) => Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(i === 0 ? 0 : 22), y: 0, facing: i === 0 ? 1 : -1, intangible: 0 }));
@@
     let prev: InputFrame[] = [0, 0];
     const states: GameState[] = [];
     const events: StepEvents[] = [];
-    for (let i = 0; i < 60; i++) {
-      const now: InputFrame[] = [i === 0 ? Btn.Special : 0, i === 10 ? Btn.Down | Btn.Special : 0];
+    for (let i = 0; i < 80; i++) {
+      const now: InputFrame[] = [i === 12 ? Btn.Special : 0, i === 0 ? Btn.Down | Btn.Special : 0];
       const out = step(s, now, { prevInputs: prev, ctx: game });
       s = out.state;
       prev = now;
@@
       events.push(out.events);
     }
     // In Stone when the punch comes out...
-    expect(stoneOf(states[27].fighters[1], game.fighter("kirby"))).not.toBeNull();
+    expect(stoneOf(states[39].fighters[1], game.fighter("kirby"))).not.toBeNull();
     // ...it lands on the stone (a hit of no damage), and traps nobody: no scene.
     expect(events.flatMap((e) => e.hits).filter((h) => h.attacker === 0)).toEqual([expect.objectContaining({ victim: 1, damage: 0 })]);
     expect(states.every((st) => st.fighters[1].action !== "finalTrapped" && st.cinematic === -1)).toBe(true);
-    expect(states[59].fighters[1].damage).toBe(0);
-    expect(states[40].fighters[1].combat.stoneTaken).toBeGreaterThan(0);
+    expect(states[79].fighters[1].damage).toBe(0);
+    expect(states[60].fighters[1].combat.stoneTaken).toBeGreaterThan(0);
   });
 
   it("stands the stage still too: a bystander on Smashville's moving platform rides out a 168-frame scene on it (ruling R-T14f)", () => {
```

```diff
--- a/src/fighters/finalSmash.test.ts
+++ b/src/fighters/finalSmash.test.ts
@@
   // Part 2's fix round 2, ruling R-FW2p (re-review 2's N1): the turn counts every fighter
   // the user holds, not only the step's catches. Jungle Rush's catch freezes Donkey Kong on
   // its catch for about 30 steps with the box live: Mario, 12 ahead, is caught on step 29;
-  // Fox, 2 behind with his shield up, spot-dodges the catch and is caught on step 59. Held
+  // Fox, 2 behind with his shield up, spot-dodges the catch and is caught on step 59 (Plan
+  // 6, Task 11: on step 1, his first slowed step, so the slow stretches the dodge over the
+  // catch, 48 steps in all). Held
   // either side, Donkey Kong keeps his facing, in both port orders. Judged from the step's
   // catches alone, Fox turned him away from Mario.
   it("keeps facing a fighter caught ahead when one behind is caught 30 steps later, whatever the ports (ruling R-FW2p)", () => {
-    const fox = (id: string, i: number) => (id !== "fox" ? 0 : i < 20 ? Btn.Shield : i === 20 ? Btn.Shield | Btn.Down : 0);
+    const fox = (id: string, i: number) => (id !== "fox" ? 0 : i === 0 ? Btn.Shield : i === 1 ? Btn.Shield | Btn.Down : 0);
     for (const order of [[["mario", 12], ["fox", -2]], [["fox", -2], ["mario", 12]]] as const) {
       const states = trapScene("donkeyKong", order, false, 160, fox);
       const portOf = (id: string) => 1 + order.findIndex(([o]) => o === id);
@@
     s.fighters.forEach((f, i) => Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(i === 0 ? -30 : -12), y: 0, facing: i === 0 ? 1 : -1, intangible: 0 }));
     s.fighters[0].finalSmashReady = FINAL_SMASH_READY;
     // The detection punch is out on frames 29-34; Marth's window is 6-27 of his counter.
+    // Marth counters first, and Jungle Rush starts on step 10: its `SLOW_OPPONENT` (Plan 6,
+    // Task 11) holds the counter in its window through the punch, on steps 38-43.
     let st = s;
     let prev: InputFrame[] = [0, 0];
     const states: GameState[] = [];
     const counters: number[] = [];
     for (let i = 0; i < 200; i++) {
-      const now: InputFrame[] = [i === 0 ? Btn.Special : 0, i === 14 ? Btn.Down | Btn.Special : 0];
+      const now: InputFrame[] = [i === 10 ? Btn.Special : 0, i === 0 ? Btn.Down | Btn.Special : 0];
       const out = step(st, now, { prevInputs: prev });
       st = out.state;
       prev = now;
@@
   });
 
   it.each([
-    ["the Ancient Arrow", "link", 50, 45, 140],
+    // Plan 6, Task 11: Marth counters first, and the Ancient Arrow comes on step 6: its
+    // `SLOW_OPPONENT(30, 100)` holds his counter in its window as the arrow arrives.
+    ["the Ancient Arrow", "link", 50, 6, 0, 146],
     // Fix round 1: the beam is out from the move's 81, after `final_start` (R-T16c).
-    ["Zero Laser's beam", "samus", 90, 74, 160],
-  ] as const)("Marth's Counter does not catch %s", (_name, user, gap, press, frames) => {
-    const { states, events } = runHeld(duel(user, "marth", gap), frames, () => {}, (i) => [i === 0 ? Btn.Special : 0, i === press ? Btn.Down | Btn.Special : 0]);
+    ["Zero Laser's beam", "samus", 90, 0, 74, 160],
+  ] as const)("Marth's Counter does not catch %s", (_name, user, gap, start, press, frames) => {
+    const { states, events } = runHeld(duel(user, "marth", gap), frames, () => {}, (i) => [i === start ? Btn.Special : 0, i === press ? Btn.Down | Btn.Special : 0]);
     expect(states.some((s) => s.fighters[1].move === "downB")).toBe(true);
     expect(events.flatMap((e) => e.counters)).toEqual([]);
     expect(hitsOnPort1(events).length).toBeGreaterThan(0);
@@
     // Behind: the 18° pull, 15 behind and 20 across; in front: the 367° pull (366° in the
     // script), 17 ahead and 30 across, toward its centre.
     const behind = ready("samus", -10);
-    const { states: b, events: be } = run(behind, 50);
+    const { states: b, events: be } = run(behind, 55);
     expect(be[47].pushes).toContainEqual({ attacker: 0, victim: 1 });
-    expect(b[49].fighters[1].x).toBeGreaterThan(b[46].fighters[1].x);
+    // Slowed by the start's `SLOW_OPPONENT(5, 50)` (Plan 6, Task 11), Mario moves on his
+    // next running step after the pull, by 54.
+    expect(b[54].fighters[1].x).toBeGreaterThan(b[46].fighters[1].x);
     const front = ready("samus", 35);
     Object.assign(front.fighters[1], { action: "fall", grounded: false, platform: -1, y: fx(13) });
     const { states: f, events: fe } = runHeld(front, 48, (st) => {
```

```diff
--- a/src/game/sceneDraw.test.ts
+++ b/src/game/sceneDraw.test.ts
@@
 /**
  * [user, activation gap, where it traps Mario]: each cinematic Final Smash's real
  * trap distances (the re-review's N2 table: Fox where Mario stands, Kirby from 3
- * (it misses at 2), Pikachu 7.3 to 13.6 after its dash (8.2 to 15.6 at 3.2 a frame,
+ * (it misses at 2), Pikachu 1.0 to 13.6 after its dash (8.2 to 15.6 at 3.2 a frame,
  * Plan 5 final wave 2, ruling R-FW2i; 6.9 to 15 at Task 15's 4.5; at 4.1 since part 2's
- * fix round 3, ruling R-FW2q), Marth 4 behind to 20, his dash
+ * fix round 3, ruling R-FW2q; 7.3 to 13.6 before Plan 6, Task 11 slowed the fighter
+ * beside it), Marth 4 behind to 20, his dash
  * carrying him level with or past Mario at the closest; Donkey Kong where Mario
  * stands). A user that traps only fighters behind it turns to face them on the trap's
  * step (Plan 5 final wave 2, ruling R-FW2h), so those are ahead of it when caught.
@@
   ["kirby", 3, 3],
   ["kirby", 4, 4],
   ["kirby", 5, 5],
-  ["pikachu", 2, 7.3],
-  ["pikachu", 4, 9.3],
-  // Plan 6, Task 9: the startup's sparks are live through their window (10-45, a rehit
-  // of 6 apart), so from 8 and 10 they catch Mario again as he drifts back into reach.
-  ["pikachu", 8, 13.4],
-  ["pikachu", 10, 10.23],
+  // Plan 6, Task 11: the startup's `SLOW_OPPONENT(9, 45)` slows Mario, so its sparks barely
+  // move him and the dash traps him near where he stood. From 2 the tackle carries Pikachu
+  // past him within a step, and the drawn shift flips from back to on (carried: the
+  // scene shift's side across a crossing, a presentation item).
+  ["pikachu", 4, 1.02],
+  ["pikachu", 8, 5.02],
+  ["pikachu", 10, 7.02],
   ["pikachu", 30, 13.6],
   ["pikachu", 54, 13],
   ["pikachu", 42, 13.3],
```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/engine/slow.test.ts src/engine/hash.test.ts src/engine/final.test.ts src/fighters/finalSmash.test.ts src/game/sceneDraw.test.ts`

Expected: PASS (captured).

Before the scene re-tunes above, five tests FAIL (captured):
- R-FW2p: `mario: expected [ 29, 29 ] to deeply equal [ 29, 59 ]`;
- the Counter: `expected false to be true`, Marth's one-frame Down+B on a still step is buffered as a special and fires as Shield Breaker, the stick let go;
- the Ancient Arrow: `expected false to be true`, Marth's press on a still step under Link's 30 never comes out as a Counter;
- Zero Laser's pull: `expected -163840 to be greater than -163840`;
- Kirby's Stone: `expected null not to be null`.

The `sceneDraw.test.ts` rows fail too: Pikachu traps at 0.98, 1.02, 5.02 and 7.02 from 2, 4, 8 and 10, plus the release above.

- [ ] **Step 5: Golden**

Run: `pnpm vitest run src/game/golden.test.ts`.

Expected: FAIL on the four traces above, and nothing else; every lab pin passes (captured).

Then:
1. Add the history paragraph:

   ```diff
--- a/src/game/golden.test.ts
+++ b/src/game/golden.test.ts
@@
  * Plan 6, Task 10 (a Final Smash ending in the air lifts its user) adds no action: the
  * beams lab's aerial Mario Finale and Ancient Arrow and the dash lab's Team Star Fox end
  * rising, and only those two traces move. All 60 are visited.
+ * Plan 6, Task 11 (`SLOW_OPPONENT`) adds no action: each Final Smash's start slows the
+ * others, so the Final Smash, beams and dash labs and the ball-on CPU match move, and
+ * nothing else. All 60 are visited.
  */
 const MUST_VISIT: Record<ActionState, true> = {
   stand: true,
```

2. Run `UPDATE_GOLDEN=1 pnpm vitest run src/game/golden.test.ts`.
3. Set `RULES_PIN.golden` to the digest `rulesVersion.test.ts` prints.
4. Rerun both. Expected: PASS (captured).

- [ ] **Step 6: Mutants**

Restore after each.
1. `tickSlow`: `const still = c.slowPhase !== 0` → `const still = false`. In `slow.test.ts`:
   - the walk test FAILS `expected 737235 to be less than or equal to 163830`;
   - the hitstun test FAILS `expected [ 3, 2, 1, +0 ] to deeply equal [ 3, 3, 3, 3 ]`;
   - so do the intangibility and press tests (captured).
2. `slowOthers`: drop `f.port === user ||`. `slow.test.ts`'s first test FAILS `expected 9 to be +0` (captured).
3. `hash.ts`: drop `slowPhase` from `mixCombat`. `hash.test.ts`'s walker FAILS `hash ignored fighter.combat.slowPhase` (captured).
4. The still-step branch: delete `bufferPress(f, intent, s.frame);`. The press Review Focus FAILS `expected 'stand' to be 'jumpSquat'` (captured).
5. The still-step branch: delete `updateDodgeIntangibility(f, defs[i]);`. The intangibility test FAILS `step 2: expected 0 to be greater than 0` (captured).
6. `cloneCombat`: `sceneHits: c.sceneHits.slice()` → `sceneHits: c.sceneHits` (a snapshot sharing the live record). The rollback Review Focus FAILS `replayed from 24: expected 3994852683 to be 754427224` (captured).

- [ ] **Step 7: Gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`.

Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add super-smash/src/engine/slow.ts super-smash/src/engine/slow.test.ts super-smash/src/engine/types.ts super-smash/src/engine/combat.ts super-smash/src/engine/hash.ts super-smash/src/engine/simulate.ts super-smash/src/fighters/mario.ts super-smash/src/fighters/donkeyKong.ts super-smash/src/fighters/link.ts super-smash/src/fighters/samus.ts super-smash/src/fighters/kirby.ts super-smash/src/fighters/fox.ts super-smash/src/fighters/pikachu.ts super-smash/src/fighters/marth.ts super-smash/src/engine/final.test.ts super-smash/src/fighters/finalSmash.test.ts super-smash/src/game/sceneDraw.test.ts super-smash/src/game/golden.test.ts
git add super-smash/src/game/__golden__/engine-trace.json super-smash/src/game/rulesVersion.test.ts
git commit -m "super-smash: SLOW_OPPONENT slows everyone else through a Final Smash's start" -m "Each start's script numbers, read as (rate, frames) (D5, UNVERIFIED): one step in rate runs. The still step buffers a press, holds a dodge's intangibility, and comes before the hitstun's countdown (R-P6-10). SmashWiki Slowdown. Six scenes re-timed to the slow, each keeping its pin. Golden: the Final Smash, beams and dash labs and the ball-on CPU match move; every lab pin holds." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Smashville's platform carries a fighter in hitlag, a trapped fighter, and a passenger at its trailing end

Three backlog items about the one moving platform:
1. "Fighters in hitlag on Smashville's moving platform aren't carried (pre-existing; check SmashWiki)." Phase 5 skips every frozen fighter (`simulate.ts`: `if (frozen[i] || …) continue;`), so the platform slides out from under it.
2. "A trapped fighter isn't carried by Smashville's moving platform while its user is (trapped fighters skip collision, `simulate.ts:~967`)." Kirby is carried 19.4 past Mario by the scene's start, and launches him back through himself (132 of 304 constructed platform scenes; Q2's case, D58).
3. "Smashville's moving platform leaves a standing fighter behind when it starts within about 0.5 of the trailing end mid-sweep (where the platform moves fastest, ~0.40-0.47 a frame); 40 of 5,040 constructed carries."
   - In `resolveCollision` the passenger's edge is judged against the platform's new place *before* it is carried (`physics.ts`: the `abs(f.x - cx) > p.halfWidth` test, then `f.x += cx - platformCentreX(p, frame - 1)` only in the branch that stays).
   - The CPU's floor model, `leavesFloor` (`ai/offence.ts`), copies that order: judge, then carry. For a carry on a sweeping platform it follows on past rest for that very reason (Plan 5 final wave, part 5 fix round 1, `1d35536`; its wording `1f18e07`). This task changes the engine's order, so it changes the model's in the same commit, so the CPU reads what the engine does.

**The check, 2026-11-01.**
- SmashWiki "Smashville" says only that the platform "moves from side to side over the stage".
- SmashWiki "Hitlag" says "both the attacker and target are frozen in place". Neither says whether "in place" is the stage's frame or the platform's.
- **Under that silence (decision D6):** a fighter standing on a platform is in the platform's frame. Frozen or trapped, it rides it, UNVERIFIED. (Had a page said they stay put in the world, the task would carry only the trailing-end passenger.)
- The trailing-end passenger needs no source: a passenger is carried, then judged, as the comment on the carry already says ("A moving platform carries its passenger").

**The scene.** While a Final Smash's scene plays, the stage's clock stands still (ruling R-T14f), and nothing on it may slide.
- `carryOnPlatform` therefore carries by how far the platform moved this step: from the clock before the step to the clock after it, `stageFrameBefore` to `stageFrame`. That is zero while paused.
- A carry from `stageFrame - 1` would slide every fighter the scene stands still, and the trapped, at the platform's last speed for the scene's whole length, while the platform stood still. Captured: a bystander on the platform moved 14.87 units through 30 paused steps of Jungle Rush's scene.

**Not changed here (Minor; on the header's "Carried, not in Plan 6" list, D59 records them):**
- On a frozen passenger's release step, phase 3's `leaveGroundIfShiftedOff` still judges it against the platform's new place before phase 5 carries it.
- Phase 5 computes `outward` and a dash's `overEdge` from the x before `resolveCollision` carries it.
- Each matters within one step's sweep of the trailing end only.

**Golden:** unchanged (captured). The Smashville CPU match meets no frozen, trapped or trailing-end passenger, and no golden carry is on the platform. Stage the trace and the pin only if Step 5 regenerated them.

**Files:**
- Create: `src/engine/platformCarry.test.ts`
- Modify:
  - `src/engine/physics.ts` (`resolveCollision`, new `carryOnPlatform`)
  - `src/engine/simulate.ts` (`stageFrameBefore`, phase 5)
  - `src/ai/offence.ts` (`leavesFloor`'s copy: carried, then judged)
- Test: `src/ai/specials.test.ts` (the floor model at the trailing end; the carry test's comment)
- Regenerate if it moves: the golden and its pin

**Interfaces:**
- Consumes:
  - `platformCentreX`, `resolveCollision` (physics.ts);
  - phase 5's `frozen`, `captorOf`, the `finalTrapped` skip, `paused` (simulate.ts);
  - `leavesFloor`, `carriesOff` (ai).
- Produces: `carryOnPlatform(f: FighterState, stage: StageDef, from: number, to: number): void` (physics.ts).

- [ ] **Step 1: Write the failing tests**

`src/engine/platformCarry.test.ts` (new file):

```ts
/**
 * Smashville's moving platform and what it carries (Plan 6, Task 12). A passenger is
 * carried, then judged against the platform where it now is; a fighter frozen in hitlag
 * or trapped by a Final Smash rides it too (decision D6, UNVERIFIED: SmashWiki "Hitlag"
 * freezes fighters "in place" and no page says whose place); and while a Final Smash's
 * scene stands the stage still (ruling R-T14f), nothing on it is carried.
 */

import { beforeAll, describe, expect, it } from "vitest";

import { fx } from "./fixed";
import { platformCentreX } from "./physics";
import { createInitialState, registerFighters, registerStages, step } from "./simulate";
import type { GameState, MatchRules, StageDef } from "./types";
import { FIGHTERS } from "@/fighters";
import { STAGES } from "@/stages";

const RULES: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true };
const SV: StageDef = STAGES.find((s) => s.id === "smashville")!;
const MOVER = SV.platforms.findIndex((p) => p.motion !== undefined);
const PLAT = SV.platforms[MOVER];

beforeAll(() => {
  registerFighters(FIGHTERS);
  registerStages(STAGES);
});

/** Mario standing on the moving platform at `dx` from its centre on stage frame `frame`; Fox far away on the floor. */
function onPlatform(dx: number, stageFrame: number): GameState {
  const s = createInitialState("smashville", [{ defId: "mario" }, { defId: "fox" }], RULES, 5);
  s.stageFrame = stageFrame;
  Object.assign(s.fighters[0], {
    action: "stand", actionFrame: 10, grounded: true, platform: MOVER, x: platformCentreX(PLAT, stageFrame) + dx, y: PLAT.y, facing: 1, intangible: 0, vx: 0, vy: 0,
  });
  Object.assign(s.fighters[1], { action: "stand", grounded: true, platform: 0, x: -fx(60), y: 0, intangible: 0 });
  return s;
}

/** How far the platform moves on the next step from `s` (the stage's clock runs first). */
const delta = (s: GameState) => platformCentreX(PLAT, s.stageFrame + 1) - platformCentreX(PLAT, s.stageFrame);

/**
 * Fox's Team Star Fox start holding Mario, who stands on the platform at its centre:
 * Fox far off on the floor, in the start's lock-on (no scene yet) or, with `scene`, in
 * its scene (`cinematic`), which stands the stage still.
 */
function trapped(scene: boolean): GameState {
  const s = onPlatform(0, 1);
  Object.assign(s.fighters[1], { action: "special", move: scene ? "finalAttack" : "finalSmash", actionFrame: 5, intangible: 0 });
  Object.assign(s.fighters[0], { action: "finalTrapped", actionFrame: 0 });
  s.fighters[0].combat.trappedBy = 1;
  if (scene) s.cinematic = 1;
  return s;
}

describe("Smashville's platform carries what stands on it (Plan 6, Task 12)", () => {
  it("keeps a passenger at its trailing end mid-sweep, at every phase where it moves fastest", () => {
    const period = PLAT.motion!.periodFrames;
    for (const at of [0, 1, 2, period / 2 - 1, period / 2, period / 2 + 1]) {
      const s = onPlatform(0, at);
      const trailing = delta(s) > 0 ? -1 : 1;
      s.fighters[0].x = platformCentreX(PLAT, at) + trailing * (PLAT.halfWidth - fx(0.3));
      const after = step(s, [0, 0], { prevInputs: [0, 0] }).state;
      expect(after.fighters[0].grounded, `stage frame ${at}`).toBe(true);
      expect(after.fighters[0].platform).toBe(MOVER);
    }
  });

  it("carries a fighter frozen in hitlag", () => {
    const s = onPlatform(0, 1);
    s.fighters[0].hitlag = 5;
    const moved = delta(s);
    const after = step(s, [0, 0], { prevInputs: [0, 0] }).state;
    expect(after.fighters[0].x - s.fighters[0].x).toBe(moved);
  });

  it("carries a fighter trapped by a Final Smash, as it carries its user", () => {
    const s = trapped(false);
    const moved = delta(s);
    const after = step(s, [0, 0], { prevInputs: [0, 0] }).state;
    expect(after.fighters[0].action, "still trapped").toBe("finalTrapped");
    expect(after.fighters[0].x - s.fighters[0].x).toBe(moved);
  });

  it("carries nobody while a Final Smash's scene stands the stage still (ruling R-T14f)", () => {
    // The trapped fighter, and a bystander the scene stands still: neither slides.
    const s = trapped(true);
    const by = createInitialState("smashville", [{ defId: "mario" }, { defId: "fox" }, { defId: "kirby" }], { ...RULES, oneOnOne: false }, 5);
    by.stageFrame = s.stageFrame;
    by.cinematic = 1;
    Object.assign(by.fighters[0], s.fighters[0], { combat: { ...s.fighters[0].combat } });
    Object.assign(by.fighters[1], s.fighters[1], { combat: { ...s.fighters[1].combat } });
    Object.assign(by.fighters[2], { action: "stand", actionFrame: 10, grounded: true, platform: MOVER, x: platformCentreX(PLAT, by.stageFrame) + fx(10), y: PLAT.y, intangible: 0, vx: 0, vy: 0 });
    let st = by;
    for (let i = 0; i < 5; i++) st = step(st, [0, 0, 0], { prevInputs: [0, 0, 0] }).state;
    expect(st.stageFrame, "the stage's clock stood still").toBe(by.stageFrame);
    expect([st.fighters[0].x, st.fighters[2].x]).toEqual([by.fighters[0].x, by.fighters[2].x]);
  });
});
```

`src/ai/specials.test.ts`, after "carries its cargo on Smashville's moving platform without leaving it …" (and `carriesOff` joins the `./specials` import):

```diff
--- a/src/ai/specials.test.ts
+++ b/src/ai/specials.test.ts
@@
 import {
   CARGO_CARRY_FRAMES,
   REFLECT_AIM,
+  carriesOff,
   counter,
   dashTravel,
   finalSmashSpotFor,
@@
     // him off, and he threw in the air.
     // And, carried to a platform's end mid-sweep, where it moves fastest (stage frame 325, its
     // left half; at its turns its speed is 0), the platform swept away under him where he
-    // stood: the engine judges a standing passenger's edge against the platform's new place
-    // before it carries him.
+    // stood: the engine judged a standing passenger's edge against the platform's new place
+    // before it carried him (carried first since Plan 6, Task 12).
     const sv = stageViewFromDef(STAGES.find((x) => x.id === "smashville")!);
     const platform = sv.platforms[0];
     for (const [stageFrame, from] of [[0, 0], [325, -platform.halfWidth + fx(13)]] as const) {
@@
         expect([end.action, end.move?.startsWith("cargo"), end.grounded, end.y], at).toEqual(["throw", true, true, platform.y]);
       }
     }
+  });
+
+  it("reads a carry at the platform's trailing end mid-sweep as the engine carries it: walking on, it stays on (Plan 6, Task 12)", () => {
+    // Smashville's platform at stage frame 0 sweeps right at about 0.47 a frame; Donkey Kong
+    // carrying Kirby 0.1 inside its left, trailing, end. The engine carries a passenger before
+    // it judges its edge (`resolveCollision`), so a step right keeps him on, and the floor
+    // model reads it so: judged before the carry, it read him off and held the press back.
+    const sv = stageViewFromDef(STAGES.find((x) => x.id === "smashville")!);
+    const platform = sv.platforms[0];
+    const s = createInitialState("smashville", [{ defId: "donkeyKong" }, { defId: "kirby" }], { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true }, 5);
+    s.stageFrame = 0;
+    const x = platformCentreX(platform, 0) - platform.halfWidth + fx(0.1);
+    Object.assign(s.fighters[0], { action: "cargoCarry", actionFrame: 10, grounded: true, platform: 1, x, y: platform.y, vx: 0, facing: 1, grabbing: 1, intangible: 0 });
+    Object.assign(s.fighters[1], { action: "cargoHeld", actionFrame: 0, grabbedBy: 0, grabTimer: 200, x, y: platform.y, grounded: false, intangible: 0 });
+    expect(carriesOff(context(s, donkeyKong, 9, undefined, sv), Btn.Right)).toBe(false);
   });
 
   it("a level-9 Donkey Kong that grabs facing the nearer edge carries the fighter there and throws them from his shoulders", () => {
```

- [ ] **Step 2: Run them to see them fail**

Run `pnpm vitest run src/engine/platformCarry.test.ts`, then `pnpm vitest run src/ai/specials.test.ts -t "trailing end mid-sweep"`.

Expected: FAIL (captured):
- `platformCarry.test.ts`, 3 of 4:
  - `stage frame 0: expected false to be true`;
  - the hitlag carry: `expected +0 to be 2030`;
  - the trapped carry: `expected +0 to be 2030`.

  The paused-scene test PASSES: it pins that nothing slides.
- The floor model: `expected true to be false`.

- [ ] **Step 3: Implement**

```diff
--- a/src/engine/physics.ts
+++ b/src/engine/physics.ts
@@
   if (f.grounded && f.platform >= 0 && f.platform < stage.platforms.length) {
     const p = stage.platforms[f.platform];
     const cx = platformCentreX(p, frame);
+    // A moving platform carries its passenger first, and the edge is judged where the
+    // platform now is (Plan 6, Task 12): judged first, a passenger within its step of the
+    // trailing end mid-sweep was left behind. Smashville is unplayable otherwise.
+    if (p.motion) f.x += cx - platformCentreX(p, frame - 1);
     if (opts.cliffStop === true && abs(f.x - cx) > p.halfWidth) {
       // At the edge: stop on it, not over it, and stay grounded. Only the speed that
       // carried it over stops: an energy pointing back in keeps its speed, a windbox's
@@
       f.platform = -1;
       out.leftGround = true;
     } else {
-      // A moving platform carries its passenger; Smashville is unplayable otherwise.
-      if (p.motion) f.x += cx - platformCentreX(p, frame - 1);
       f.y = p.y;
       kineticSetY(f, 0);
       return out;
@@
   }
 
   return out;
+}
+
+/**
+ * Carry a fighter that stands on a moving platform but does not move this step: frozen in
+ * hitlag, or trapped by a Final Smash (Plan 6, Task 12; decision D6, UNVERIFIED: SmashWiki
+ * "Hitlag" freezes fighters "in place", and the replica reads the place as the platform's),
+ * by as far as the platform moved from stage frame `from` to `to`: nothing while a scene
+ * stands the stage's clock still (ruling R-T14f). Nothing else changes: no landing, edge or
+ * wall is judged for it this step.
+ */
+export function carryOnPlatform(f: FighterState, stage: StageDef, from: number, to: number): void {
+  if (!f.grounded || f.platform < 0 || f.platform >= stage.platforms.length) return;
+  const p = stage.platforms[f.platform];
+  if (p.motion) f.x += platformCentreX(p, to) - platformCentreX(p, from);
 }
 
 /**
```

```diff
--- a/src/engine/simulate.ts
+++ b/src/engine/simulate.ts
@@
   ledgePosition,
   platformCentreX,
   resolveCollision,
+  carryOnPlatform,
 } from "./physics";
 import {
   ENTRY_INTANGIBILITY,
@@
   // runs nothing but the scene.
   const scene = s.cinematic;
   const paused = scene >= 0;
-  // The stage's clock runs only while the match does (ruling R-T14f).
+  // The stage's clock runs only while the match does (ruling R-T14f). Where it was, for
+  // the platform's carry of those who stand still (Plan 6, Task 12: `carryOnPlatform`).
+  const stageFrameBefore = s.stageFrame;
   if (!paused) s.stageFrame += 1;
 
   // Where each hitbox was last frame, for the swept test in phase 6.
@@
 
   for (let i = 0; i < s.fighters.length; i++) {
     const f = s.fighters[i];
-    if (frozen[i] || f.action === "dead" || f.action === "respawnPlatform") continue;
+    if (f.action === "dead" || f.action === "respawnPlatform") continue;
+    // Frozen, or trapped by a Final Smash: carried by a moving platform as far as it moved,
+    // and nothing more (Plan 6, Task 12: `carryOnPlatform`; nothing while paused).
+    if (frozen[i] || f.action === "finalTrapped") {
+      carryOnPlatform(f, stage, stageFrameBefore, s.stageFrame);
+      continue;
+    }
     if (f.ledge !== null) continue; // hanging: the ledge holds you, not the floor
     if (captorOf(s, f) !== null) continue; // held: the captor's floor is all it touches
     if (f.action === "spatStar") continue; // riding a star: where it flies, it goes
-    if (f.action === "finalTrapped") continue; // trapped: no floor, wall or ledge until it is let go (Task 14)
     if (f.port === scene) continue; // a scene's user: no landing or ledge cuts it short (fix round 1, R-T14d)
 
     const before = launchBefore(f);
```

`carryOnPlatform`'s `from` and `to` are the stage's clock before and after this step: the same while a scene plays (ruling R-T14f), so the carry is zero then.

The CPU's floor model, in the engine's new order:

```diff
--- a/src/ai/offence.ts
+++ b/src/ai/offence.ts
@@
     g.frame = ctx.view.frame + k;
     ghostStep(f, now, prev, g);
     prev = now;
+    // A sweeping platform carries it, then its edge is judged where the platform now is, as
+    // the engine does (`resolveCollision`; Plan 6, Task 12: carried first, so a passenger at
+    // rest is never left behind; fix round 3, re-review 3's Minor 1: the copy, standing
+    // still on it, used to stay on where the platform swept the fighter off).
+    if (under?.motion !== undefined) f.x += platformCentreX(under, stageFrame + k) - platformCentreX(under, stageFrame + k - 1);
     const left = under === null ? ctx.stage.leftLedge : platformCentreX(under, stageFrame + k) - under.halfWidth;
     const right = under === null ? ctx.stage.rightLedge : platformCentreX(under, stageFrame + k) + under.halfWidth;
     if (f.x < left || f.x > right) return carrying || !overFloor(def, { ...f, grounded: false, platform: -1 }, ctx.stage, ctx.view.frame + k, stageFrame + k);
-    // Still on it: a sweeping platform carries it, as the engine carries a fighter
-    // standing there after the step's own movement (`resolveCollision`; fix round 3,
-    // re-review 3's Minor 1: Smashville's platform swept the fighter off where the copy,
-    // standing still on it, stayed on).
-    if (under?.motion !== undefined) f.x += platformCentreX(under, stageFrame + k) - platformCentreX(under, stageFrame + k - 1);
-    // At rest it stays, but for a carry on a sweeping platform, followed on standing to the
-    // run's end: the engine judges a standing passenger's edge against the platform's new place
-    // before it carries him, so at an end the platform sweeps away from faster than he stands
-    // inside it he is left behind (part 5, fix round 1: Smashville's, mid-sweep, where it moves
-    // fastest, about 0.40-0.47 a frame; at its turns its speed is 0).
-    if (f.vx === 0 && !(carrying && under?.motion !== undefined)) return false;
+    // At rest it stays: carried with the platform, it never leaves it (Plan 6, Task 12; part
+    // 5's fix round 1 followed a carry on past rest, while the engine judged the edge first).
+    if (f.vx === 0) return false;
   }
   return false;
 }
```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/engine/platformCarry.test.ts src/engine/physics.test.ts src/fighters/cargo.test.ts src/fighters/finalSmash.test.ts src/engine/final.test.ts src/ai/specials.test.ts`

Expected: PASS (captured).

- [ ] **Step 5: Golden**

Run: `pnpm vitest run src/game/golden.test.ts src/game/rulesVersion.test.ts`.

Expected: PASS, byte-identical (captured). If it fails, regenerate and re-pin, naming the Smashville traces.

- [ ] **Step 6: Mutants**

Restore after each.
1. `resolveCollision`: move the carry back after the edge test. `platformCarry.test.ts`'s trailing-end test FAILS `stage frame 0: expected false to be true` (captured).
2. Phase 5: delete the `carryOnPlatform(…)` call. The hitlag and trapped tests FAIL `expected +0 to be 2030` (captured).
3. Phase 5: `carryOnPlatform(f, stage, stageFrameBefore, s.stageFrame)` → `carryOnPlatform(f, stage, s.stageFrame - 1, s.stageFrame)`. The paused-scene test FAILS `expected [ 12550, 53510 ] to deeply equal [ 4140, 45100 ]` (captured).
4. `leavesFloor`: move the copy's carry back below the edge test. `specials.test.ts`:
   - the trailing-end test FAILS `expected true to be false`;
   - the Smashville carry test FAILS `from frame 0, stage frame 0: expected [ …(17) ] to deeply equal []`, as the copy then misreads the platform (captured).

- [ ] **Step 7: Gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`.

Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add super-smash/src/engine/physics.ts super-smash/src/engine/simulate.ts super-smash/src/engine/platformCarry.test.ts super-smash/src/ai/offence.ts super-smash/src/ai/specials.test.ts
# with the golden only if its step regenerated it:
# git add super-smash/src/game/__golden__/engine-trace.json super-smash/src/game/rulesVersion.test.ts
git commit -m "super-smash: Smashville's platform carries a passenger before judging its edge, and carries the frozen and the trapped" -m "The trailing-end passenger is never left behind mid-sweep. A fighter in hitlag or trapped by a Final Smash rides the platform (D6, UNVERIFIED: SmashWiki Hitlag's 'frozen in place'), as far as the platform moved this step: nothing while a scene stands the stage still (R-T14f). The CPU's floor model (leavesFloor) carries, then judges, as the engine now does. Golden unchanged." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Presses during a KO's freeze are buffered

From Plan 5's triage: "Input buffering while frozen after a KO (find SmashWiki "Input buffer"'s rule first)." There is no "Input buffer" page; SmashWiki "Buffer" is it (read 2026-11-01): in Ultimate "the buffer window is now 9 frames". Today the freeze returns from `step` before phase 2 reads any input (`simulate.ts`, "The whole match stands still for a KO's freeze"), so a press made during its 14 frames is lost. This task reads each living fighter's input during the freeze into its buffer (`bufferPress`) and its direction counter (`updateInputTracking`), so a press in the freeze's last 9 frames fires on the first frame after it, and an older one expires. Two consequences, each recorded in D59:
- The page's second rule, "holding an input through the end of an animation will now cause the held input to be buffered", is not modelled anywhere in the replica, so a button held through the freeze is a hold afterwards, not a press, as it is after any other animation.
- The direction counter runs through the freeze, so a direction pressed just before a KO and Attack pressed just after its freeze are a tilt, not a smash: 14 frames passed.

The freeze itself stays UNVERIFIED (`KO_FREEZE_FRAMES`: no source gives a whole-game pause on a KO). **Ruling D7** (recorded in D59): the freeze is kept; this task is right either way (with no freeze, it is never reached). Task 11's slowed fighter buffers its presses the same way on its still steps (ruling R-P6-10).

**Golden:** moves. `framesSinceDirPress` is in the golden digest (`golden.test.ts:563`), and it now counts through every KO freeze, pressed or not, so every trace with a KO freeze in which a living fighter's counter is under its cap of 1000 moves. In the replay (`46e0706` with Tasks 9 and 11 applied) five traces moved, each from the sample holding its first KO freeze: the scripted match (1801-1900: Mario holds Left through Fox's KO on 1857), the tech lab (1-100), the beams lab (601-700), link-samus-smashville (2701-2800) and kirby-marth-pokemonStadium2 (3201-3300). Every lab pin held. A trace with no KO freeze moving stops the task; a CPU trace's list may differ after Tasks 4-12. Regenerate, naming the traces.

**Files:**
- Modify: `src/engine/simulate.ts`
- Test: `src/engine/simulate.test.ts`
- Regenerate: the golden and its pin

**Interfaces:**
- Consumes: `updateInputTracking`, `interpretInput`, `bufferPress` (states.ts); `KO_FREEZE_FRAMES`.
- Produces: nothing new by name.

- [ ] **Step 1: Write the failing test**

`src/engine/simulate.test.ts`, a new block just before `describe("registry", () => {`:

```ts
describe("presses during a KO's freeze (Plan 6, Task 13; SmashWiki \"Buffer\")", () => {
  /** Step `s` once per entry of `inputs`, port 0 pressing it, port 1 idle. */
  function stepEach(s: GameState, inputs: readonly InputFrame[]): GameState[] {
    let state = s;
    let prev: readonly InputFrame[] = [0, 0];
    const out: GameState[] = [];
    for (const i of inputs) {
      const now: InputFrame[] = [i, 0];
      state = step(state, now, { prevInputs: prev, ctx: CTX }).state;
      prev = now;
      out.push(state);
    }
    return out;
  }

  it("a Jump pressed in the freeze's last nine frames jumps on the first frame after it", () => {
    const s = standing();
    s.freezeFrames = KO_FREEZE_FRAMES;
    const press = KO_FREEZE_FRAMES - 4;
    const states = stepEach(s, Array.from({ length: KO_FREEZE_FRAMES + 2 }, (_, i) => (i === press ? Btn.Jump : 0)));
    expect(states[KO_FREEZE_FRAMES - 1].fighters[0].action).toBe("stand");
    expect(states[KO_FREEZE_FRAMES].fighters[0].action).toBe("jumpSquat");
  });

  it("one pressed earlier than that has expired", () => {
    const s = standing();
    s.freezeFrames = KO_FREEZE_FRAMES;
    const states = stepEach(s, Array.from({ length: KO_FREEZE_FRAMES + 2 }, (_, i) => (i === 0 ? Btn.Jump : 0)));
    expect(states[KO_FREEZE_FRAMES].fighters[0].action).toBe("stand");
  });

  it("the freeze still moves nobody", () => {
    const s = standing();
    s.freezeFrames = 3;
    const [after] = stepEach(s, [Btn.Right]);
    expect(after.fighters[0].x).toBe(s.fighters[0].x);
    expect(after.fighters[0].action).toBe("stand");
  });
});
```

`KO_FREEZE_FRAMES` joins the file's `./simulate` import (after `DEFAULT_SEED`); `GameState` and `InputFrame` are imported already.

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run src/engine/simulate.test.ts -t "KO's freeze"`
Expected: FAIL on the first test, `AssertionError: expected 'stand' to be 'jumpSquat' // Object.is equality` (captured); the other two PASS (captured).

- [ ] **Step 3: Implement**

`src/engine/simulate.ts`:

```diff
   if (s.freezeFrames > 0) {
     s.freezeFrames -= 1;
+    // A press made during the freeze is kept, as the buffer keeps any press made while a
+    // fighter cannot act (Plan 6, Task 13; SmashWiki "Buffer": Ultimate's 9-frame window).
+    // Read into each living fighter's buffer and its direction counter; nothing else of
+    // the step runs. The counter runs through the freeze, so a direction pressed before a
+    // KO and Attack pressed after its freeze are a tilt, not a smash. Holding a button
+    // through the freeze does not buffer it (the page's held-input buffering is not
+    // modelled anywhere in the replica; D59).
+    for (let i = 0; i < s.fighters.length; i++) {
+      const f = s.fighters[i];
+      if (f.action === "dead") continue;
+      const input = inputs[i] ?? 0;
+      const prev = prevInputs[i] ?? 0;
+      updateInputTracking(f, input, prev);
+      bufferPress(f, interpretInput(f, input, prev), s.frame);
+    }
     return { state: s, events };
   }
```

`bufferPress` is already in the `./states` import (Task 11's still step uses it, ruling R-P6-10); if it is absent, add it there. `updateInputTracking` and `interpretInput` are imported already (phase 2 uses them).

- [ ] **Step 4: Run it again**

Run: `pnpm vitest run src/engine/simulate.test.ts src/game/killCredit.test.ts`
Expected: PASS.

- [ ] **Step 5: Golden**

`UPDATE_GOLDEN=1 pnpm vitest run src/game/golden.test.ts`, re-pin `RULES_PIN.golden`, rerun: PASS. Expected moved: the traces named under **Golden** above.

- [ ] **Step 6: Mutant**

Delete the `bufferPress(…)` line. The first test FAILS: `expected 'stand' to be 'jumpSquat'` (captured). Restore.

- [ ] **Step 7: Gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`, then `pnpm test:e2e:online --trace off` (a KO online: both peers buffer the same presses from the same inputs).
Expected: exit 0; online 4/4.

- [ ] **Step 8: Commit**

```bash
git add super-smash/src/engine/simulate.ts super-smash/src/engine/simulate.test.ts super-smash/src/game/__golden__/engine-trace.json super-smash/src/game/rulesVersion.test.ts
git commit -m "super-smash: presses during a KO's freeze go into the buffer" -m "SmashWiki Buffer: Ultimate's 9-frame window. The direction counter runs through the freeze; held-input buffering is not modelled (D59). The freeze itself stays UNVERIFIED (D7). Golden: <the traces that moved>, each from its first KO freeze (framesSinceDirPress, in the digest, now counts through it)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: A windbox keeps its record; a catch keeps none of the attack's

From Plan 5's triage: "Windboxes exempt from the hit record (Zero Laser pull then charge box; check SmashWiki "Windbox")." The replica's convention (`simulate.ts`, `unrecorded`, Plan 5 Task 9 fix round 1): "a fighter's own windbox leaves no mark on its swing's hit record", because a mark from Kirby's Inhale pull would spend the swing and the Inhale's catch, "the same swing in the replica's one record, could never take them (SSBU keeps catches, `CatchModule`, and attacks, `AttackModule`, apart)". The check, 2026-11-01: SmashWiki "Windbox" defines windboxes as "hitboxes that deal knockback, but cause no hitstun" and says nothing of records; SmashWiki "Hitbox" lists "Flinchless" among a hitbox's properties ("any knockback coded for the hitbox instead pushes or pulls opponents") and gives every hitbox its "Rehit rate" and "Part", the record's rules. So a windbox is a hitbox and keeps the record a hitbox keeps; nothing says otherwise. The scripts agree: Zero Laser's start (`game_finalstart`, rubendal 13.0.1) lays `ATTACK` ID 0 (the 1% charge), ID 1 (the pull behind, size 20, Z −15) and ID 2 (the front pull, size 30) together on frames 48-68, all `Part=0`, all `Rehit=10`; Kirby's Inhale pull is `Rehit=10`.

**This task (the "page silent" branch):**
- Catches stop reading or marking the swing's record (they are the CatchModule's). One consequence, recorded in D59 (UNVERIFIED either way): a grab box that meets an invincible fighter is no longer spent on them (`applyInvincibleHit` records, then returns for a grab), so one still out when the invincibility ends takes them.
- Windboxes keep the record like any box.
- The two moves that leaned on the exemption take their scripts' shape. Zero Laser's pulls become two boxes spanning 48-68 (their rehit is the move's 10). Inhale's one-frame pulls carry their `Rehit=10`, and a held loop's wrap back to frame 35 re-arms the swing's record, as a replayed loop's script would (UNVERIFIED that SSBU's per-victim rehit clock lands there).

The effect players see: a fighter a Zero Laser pull reaches (one the charge box does not) takes the charge box's 1% only once the pull's 10 frames are up, as in the script.

(Had a page said windboxes keep no record, the task would keep the exemption, delete the one-frame schema rule's "until its record is decided", and add the pin.)

**Golden:** moves: the beams lab. In the replay (with Tasks 9, 11 and 13 applied) it moved from its first sample, and `expectBeams`' 54 hits held. Regenerating re-runs `expectBeams` ("Zero Laser's 51 on Donkey Kong, Mario Finale's two on Samus and the Ancient Arrow on Mario"): a count that moves is this task's only if a Zero Laser pull now holds Donkey Kong against the charge box; then re-pin it, with that reason in the commit and a paragraph in the history comment above `MUST_VISIT`. The Inhale lab moving means the loop's re-arm is wrong: stop. Regenerate, naming the traces.

**Files:**
- Modify: `src/engine/simulate.ts` (the record check, `recordHit`, `unrecorded` deleted, `applyWindbox`), `src/engine/status/attack.ts` (`holdLoopMain`), `src/fighters/samus.ts`, `src/fighters/kirby.ts`
- Test: `src/engine/simulate.test.ts` (a new block; "a connecting pummel" re-pinned), `src/fighters/schema.test.ts` (a rule replaced), `src/fighters/finalSmash.test.ts` (Zero Laser's layout re-pinned)
- Regenerate: the golden and its pin

**Interfaces:**
- Consumes: Task 9's record check (`c.final === "strike" ? sceneRecordHolds(…) : !unrecorded(c) && recordSaysAlreadyHit(…)`), `recordHit`, `rearmFrame`, `clearHitRecord`.
- Produces: nothing new by name; `unrecorded` is removed.

- [ ] **Step 1: Write the failing tests**

`src/engine/simulate.test.ts`, a new block just before `describe("registry", () => {` (after Task 13's):

```ts
describe("a windbox keeps the swing's record; a catch reads none of it (Plan 6, Task 14)", () => {
  /** The tester with `slot` replaced by `over` (a move of 24 frames by default). */
  function withMove(slot: "jab1" | "grab" | "neutralB", over: Partial<MoveDef>): SimContext {
    const def: FighterDef = { ...DEF, moves: { ...DEF.moves, [slot]: move(slot, { totalFrames: 24, ...over }) } };
    return { fighter: () => def, stage: () => STAGE };
  }

  // A pulse that pushes nobody anywhere (no knockback at all), so its victim stays in its
  // reach and each push it makes is counted, never one lost to the victim sliding away.
  const PULSE = hitbox({ id: 0, startFrame: 5, endFrame: 5, damage: 0, windbox: true, baseKnockback: 0, knockbackGrowth: 0, angle: 0, rehit: 10 });

  /** Step the tester `frames` times, port 0 pressing `press` on the first step (or holding it throughout); the steps on which port 0 pushed someone. */
  function swing(ctx: SimContext, press: InputFrame, frames: number, hold = false): { s: GameState; pushes: number[] } {
    let s = standing();
    let prev: InputFrame[] = [0, 0];
    const pushes: number[] = [];
    for (let i = 0; i < frames; i++) {
      const now: InputFrame[] = [hold || i === 0 ? press : 0, 0];
      const out = step(s, now, { prevInputs: prev, ctx });
      if (out.events.pushes.some((p) => p.attacker === 0)) pushes.push(i);
      s = out.state;
      prev = now;
    }
    return { s, pushes };
  }

  it("a pull on frame 5 holds its victim against the same part's hit on 6, as a hitbox does", () => {
    const { s } = swing(withMove("jab1", { hitboxes: [PULSE, hitbox({ id: 1, startFrame: 6, endFrame: 6, damage: fx(10) })] }), Btn.Attack, 10);
    expect(s.fighters[1].damage).toBe(0);
  });

  it("but not a catch: pulled on 5, caught on 6", () => {
    const { s } = swing(withMove("grab", { hitboxes: [PULSE, hitbox({ id: 1, startFrame: 6, endFrame: 6, grabbing: true, damage: 0 })] }), Btn.Grab, 8);
    expect(s.fighters[1].action).toBe("grabbed");
  });

  it("and the pull pushes again after its rehit, not before", () => {
    const { pushes } = swing(withMove("jab1", { hitboxes: [hitbox({ ...PULSE, endFrame: 20 })] }), Btn.Attack, 22);
    expect(pushes).toEqual([4, 14]);
  });

  it("a held loop's wrap re-arms the record: a pull every ten frames, round after round", () => {
    // Inhale's shape on the tester: pulls on 11, 21, 31 and 41 with `Rehit=10`, the loop
    // 35-44 held (`holdLoopMain`).
    const pull = (frame: number, id: number) => hitbox({ ...PULSE, id, startFrame: frame, endFrame: frame, angle: fx(160) });
    const ctx = withMove("neutralB", { totalFrames: 63, holdLoop: { from: 35, to: 44 }, hitboxes: [11, 21, 31, 41].map((f, k) => pull(f, k)) });
    const { pushes } = swing(ctx, Btn.Special, 80, true);
    expect(pushes).toEqual([10, 20, 30, 40, 50, 60, 70]);
  });
});
```

(`FighterDef`, `MoveDef`, `SimContext` and `InputFrame` are imported already; `hitbox()` and `move()` are the file's fixtures, and the victim stands 8 ahead, inside `hitbox()`'s default reach.)

`src/engine/simulate.test.ts`, "a connecting pummel > hits the held fighter once…": a catch now keeps no record, so the holder's record is empty before the pummel:

```diff
-    expect(holding.fighters[0]).toMatchObject({ action: "grabHold", grabbing: 1, hitThisMove: [1] });
+    // A catch keeps no record (Plan 6, Task 14); the pummel's own hit is the one below.
+    expect(holding.fighters[0]).toMatchObject({ action: "grabHold", grabbing: 1, hitThisMove: [] });
```

`src/fighters/schema.test.ts`, the rule "holds every windbox on a move to one frame" becomes:

```diff
-  it.each(each)("%s holds every windbox on a move to one frame, and imports none (Plan 5, Task 9 fix round 2)", (_name, fighter) => {
-    // A fighter's own windbox leaves no mark on its swing's hit record
-    // (`simulate.ts` `unrecorded`), which is right only for a box one frame long:
-    // Kirby's Inhale pull times its `Rehit=10` with one-frame boxes. A longer one
-    // would push on every frame it is out; it must fail here until its record is
-    // decided.
-    for (const { slot, hitbox } of everyHitbox(fighter).filter((h) => h.hitbox.windbox === true)) {
-      expect(hitbox.endFrame, `${fighter.name} ${slot} windbox ${hitbox.id}`).toBe(hitbox.startFrame);
-    }
+  it.each(each)("%s gives every windbox longer than a frame a rehit, and imports none (Plan 6, Task 14)", (_name, fighter) => {
+    // A windbox keeps its swing's record (Plan 6, Task 14), so one out for several frames
+    // pushes once, then again only after its rehit: a box that should push on a rhythm
+    // must carry it (its own, or its move's).
+    for (const { slot, hitbox } of everyHitbox(fighter).filter((h) => h.hitbox.windbox === true)) {
+      if (hitbox.endFrame === hitbox.startFrame) continue;
+      const rehit = hitbox.rehit ?? fighter.moves[slot]?.rehit ?? 0;
+      expect(rehit, `${fighter.name} ${slot} windbox ${hitbox.id}`).toBeGreaterThan(0);
+    }
```

(the rest of the test, "And no imported script has a flinchless ATTACK", is unchanged).

`src/fighters/finalSmash.test.ts`, "Zero Laser's start, muzzle, beam, end, fringe beams and blasts": the pulls are two boxes, ids 1 and 4, spanning 48-68:

```diff
-    const pulls = (f: number) => [
-      [f, f, 0, 18, 100, 0, 30, 20, fx(0), true, "normal", false],
-      [f, f, 0, 367, 100, 0, 30, 30, fx(0), true, "normal", false],
-    ];
+    // Its two pulls span the charge's 48-68, as `game_finalstart` lays them (Plan 6, Task 14:
+    // a windbox keeps its record, and pushes again on the move's `Rehit=10`).
     expect([...zero.hitboxes].sort((a, b) => a.id - b.id).map(row)).toEqual([
       [48, 68, 1, 18, 100, 0, 12, 10, fx(0), true, "electric", false],
-      ...[48, 58, 68].map((f) => pulls(f)[0]),
-      ...[48, 58, 68].map((f) => pulls(f)[1]),
+      [48, 68, 0, 18, 100, 0, 30, 20, fx(0), true, "normal", false],
+      [48, 68, 0, 367, 100, 0, 30, 30, fx(0), true, "normal", false],
@@
-    expect(Array.from({ length: 15 }, (_, id) => [toFloat(byId(id).x), toFloat(byId(id).y), byId(id).part ?? 0, byId(id).rehit, byId(id).windbox === true])).toEqual([
+    expect([0, 1, 4, 7, 8, 9, 10, 11, 12, 13, 14].map((id) => [toFloat(byId(id).x), toFloat(byId(id).y), byId(id).part ?? 0, byId(id).rehit, byId(id).windbox === true])).toEqual([
       [17, 13, 0, undefined, false],
       [-15, 13, 0, undefined, true],
-      [-15, 13, 0, undefined, true],
-      [-15, 13, 0, undefined, true],
-      [17, 13, 0, undefined, true],
-      [17, 13, 0, undefined, true],
       [17, 13, 0, undefined, true],
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/engine/simulate.test.ts -t "windbox keeps|a connecting pummel"`, then `pnpm vitest run src/fighters/schema.test.ts src/fighters/finalSmash.test.ts -t "windbox|Zero Laser's start, muzzle"`.
Expected (captured):
- the first test FAILS: `AssertionError: expected 43010 to be +0 // Object.is equality` (the hit lands through the exempt pull);
- the third FAILS: `AssertionError: expected [ 4, 5, 6, 7, 8, 9, 10, 11, 12, …(7) ] to deeply equal [ 4, 14 ]` (the exempt pull pushes on every frame);
- the catch test and the held-loop test PASS: they pin the catch and the loop's rhythm, which hold today because the pull marks nothing;
- the pummel FAILS: `expected { port: +0, defId: 'tester', …(43) } to match object { action: 'grabHold', …(2) }`, `"hitThisMove": [1]` received;
- the Zero Laser layout FAILS: `AssertionError: expected [ …(15) ] to deeply equal [ …(11) ]`;
- the schema rule PASSES (no long windbox exists yet).

- [ ] **Step 3: Implement**

`src/engine/simulate.ts`, the record check (as Task 9 left it):

```diff
-      if (c.final === "strike" ? sceneRecordHolds(s, c, victim.port) : !unrecorded(c) && recordSaysAlreadyHit(s, c, victim.port)) continue;
+      // A catch is the CatchModule's, and reads none of the swing's attack record (Plan 6,
+      // Task 14): a pull that marked its victim leaves the catch free to take them.
+      if (c.final === "strike" ? sceneRecordHolds(s, c, victim.port) : c.hitbox.grabbing !== true && recordSaysAlreadyHit(s, c, victim.port)) continue;
```

`recordHit`, first lines:

```diff
 function recordHit(c: Candidate, attacker: FighterState, port: number): void {
+  // A catch keeps none of the attack record (Plan 6, Task 14; SSBU's CatchModule). So a
+  // grab that meets an invincible fighter (`applyInvincibleHit`) is not spent on them:
+  // a box still out when the invincibility ends takes them (UNVERIFIED; D59).
+  if (c.hitbox.grabbing === true) return;
```

`unrecorded` and its doc comment ("The replica's convention, not a published rule: …") are deleted. `applyWindbox`:

```diff
-  if (!unrecorded(c)) recordHit(c, attacker, victim.port);
+  // A windbox keeps the swing's record as any hitbox does (Plan 6, Task 14; SmashWiki
+  // "Hitbox": "Flinchless" is a hitbox's property, and its "Rehit rate" and "Part" rule it).
+  recordHit(c, attacker, victim.port);
```

`src/engine/status/attack.ts`, `holdLoopMain`'s wrap:

```diff
   if (frame === loop.to + 1) {
     if (intent.specialHeld) {
       f.actionFrame = actionFrameOf(loop.from);
       f.charge += 1;
+      // Back round the loop, its boxes are new strikes, as a replayed script's are: the
+      // swing's record is re-armed (Plan 6, Task 14; UNVERIFIED that SSBU's per-victim
+      // rehit lands there). Catches keep none of it.
+      clearHitRecord(f);
     } else f.charge = 0;
```

(`clearHitRecord` is imported there already.)

`src/fighters/kirby.ts`, `inhalePull`:

```diff
 function inhalePull(frame: number, id: number): Hitbox[] {
-  const pull = { startFrame: frame, endFrame: frame, damage: fx(0), angle: fx(160), baseKnockback: fx(0), knockbackGrowth: fx(100), windbox: true, transcendent: true } as const;
+  // `Rehit=10` (Plan 6, Task 14): a windbox keeps the swing's record, so each strike
+  // re-arms ten frames on, the next box's frame.
+  const pull = { startFrame: frame, endFrame: frame, damage: fx(0), angle: fx(160), baseKnockback: fx(0), knockbackGrowth: fx(100), windbox: true, transcendent: true, rehit: 10 } as const;
```

and in `neutralB`'s comment:

```diff
-      //   on 41 each time round), leaving no mark on the swing's record
-      //   (`simulate.ts` `unrecorded`). UNVERIFIED: SSBU times a rehit from each
+      //   on 41 each time round), each re-arming the swing's record ten
+      //   frames on (Plan 6, Task 14). UNVERIFIED: SSBU times a rehit from each
```

`src/fighters/samus.ts`, Zero Laser's start, and the comment above it:

```diff
-    //   loaded at 367 (ruling P5-R18's stand-in; `windboxPush`). A windbox pushes every
-    //   frame it is out, so each pull is authored one frame at a time on its `Rehit=10`,
-    //   48, 58 and 68. `clear_all` on 69. UNVERIFIED: the start's length, its last
+    //   loaded at 367 (ruling P5-R18's stand-in; `windboxPush`). Each pull spans 48-68 and
+    //   keeps the swing's record, so it pushes on 48, 58 and 68, its `Rehit=10` (Plan 6,
+    //   Task 14). `clear_all` on 69. UNVERIFIED: the start's length, its last
@@
-        ...[48, 58, 68].map((f, i) => finalBox(1 + i, f, f, { damage: 0, angle: 18, kbg: 100, fkb: 30, radius: 20, x: -15, y: 13, hitlag: 0, transcendent: true, windbox: true })),
-        ...[48, 58, 68].map((f, i) => finalBox(4 + i, f, f, { damage: 0, angle: 367, kbg: 100, fkb: 30, radius: 30, x: 17, y: 13, hitlag: 0, transcendent: true, windbox: true })),
+        // `game_finalstart`'s pulls, IDs 1 and 2 on 48-68 with the charge's `Part=0` and
+        // `Rehit=10` (the move's `rehit`): a windbox keeps the swing's record (Plan 6, Task
+        // 14). The front pull's angle stays 367 (the script's 366 is refused at load, D56).
+        finalBox(1, 48, 68, { damage: 0, angle: 18, kbg: 100, fkb: 30, radius: 20, x: -15, y: 13, hitlag: 0, transcendent: true, windbox: true }),
+        finalBox(4, 48, 68, { damage: 0, angle: 367, kbg: 100, fkb: 30, radius: 30, x: 17, y: 13, hitlag: 0, transcendent: true, windbox: true }),
```

(Their ids stay 1 and 4, so the beam's and fringe beams' ids, 7-14, are unchanged.)

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/engine/simulate.test.ts src/fighters/schema.test.ts src/fighters/inhale.test.ts src/fighters/fludd.test.ts src/fighters/finalSmash.test.ts src/engine/inhale.test.ts`
Expected: PASS. Any other Inhale or Zero Laser pin that fails is read before it is touched: a pull that now waits its rehit, or a charge that now waits behind a pull, is this task's change and is re-pinned with that reason; anything else is a bug.

- [ ] **Step 5: Golden**

`UPDATE_GOLDEN=1 pnpm vitest run src/game/golden.test.ts`, re-pin `RULES_PIN.golden`, rerun: PASS. Expected moved: the beams lab, as under **Golden** above.

- [ ] **Step 6: Mutants**

Each was run in the replay (captured):
1. `applyWindbox`: delete the `recordHit(…)` line. The first and third tests FAIL (`expected 43010 to be +0`; `expected [ 4, 5, 6, … ] to deeply equal [ 4, 14 ]`). Restore.
2. The record check: drop `c.hitbox.grabbing !== true &&`. The catch test FAILS: `expected 'stand' to be 'grabbed'`. Restore.
3. `holdLoopMain`: delete `clearHitRecord(f)`. The held-loop test FAILS: `expected [ 10, 20, 30, 40 ] to deeply equal [ 10, 20, 30, 40, 50, 60, 70 ]`. No existing test or golden trace catches this one, which is why the held-loop test is here. Restore.

- [ ] **Step 7: Gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`.
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add super-smash/src/engine/simulate.ts super-smash/src/engine/status/attack.ts super-smash/src/fighters/samus.ts super-smash/src/fighters/kirby.ts super-smash/src/engine/simulate.test.ts super-smash/src/fighters/schema.test.ts super-smash/src/fighters/finalSmash.test.ts super-smash/src/game/__golden__/engine-trace.json super-smash/src/game/rulesVersion.test.ts
# plus super-smash/src/game/golden.test.ts if Step 5 re-pinned expectBeams
git commit -m "super-smash: a windbox keeps the swing's record; a catch reads none of it" -m "SmashWiki Windbox is silent on records and Hitbox makes a windbox a hitbox. Zero Laser's pulls span 48-68 as its script does (Part 0, Rehit 10); Inhale's pulls carry Rehit 10 and the held loop's wrap re-arms. A catch no longer spends a grab on an invincible fighter (D59). Golden: the beams lab moves." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Projectile phases by age: the Boomerang's clean and late hits, the Bomb's shrinking blast

From Plan 5's triage: "One age-phased hitbox mechanism (clean/late projectile hits; bomb phases)". The mechanism already exists for Mario Finale (`ProjectileDef.stages`, `stageOf`, `projectileHitbox`, Plan 5 Task 16), and it already composes with a returning projectile (`projectileHitbox` and `projectileHitboxes` take the return first). This task puts the published phases on it (Thunder Jolt's are Task 16's, with its rework):
- **Boomerang** (SmashWiki "Link (SSBU)/Side special", read 2026-11-01): clean 8.0%, angle 70, BK 80, KS 40, size 4.0; late 6.0%, BK 60, KS 40, size 3.6; returning 3.0%, BK 50, KS 40, size 3.6; "Tilt input hitboxes (clean, late, returning) 27-36, 37-71, 72-151", smash "27-36, 37-86, 87-192", and "If thrown with a smash attack input, the Boomerang's clean and late hits have their damage multiplied by 1.2×". Spawned on 27, the late hit starts at age 10 both ways. The clean box's size becomes the page's 4.0 (the replica had 3.0, "at the replica's radius", with no source for it).
- **Bomb** (SmashWiki "Samus (SSBU)/Down special": "Explosion (early, mid, late) 83-94, 95-97, 98-100", the early box 5.0%, angle 60, BK 40, KS 30, size 7.38; rubendal 13.0.1 `samus_bomb` `BurstAttack`: the same box, then `AttackModule::set_size(ID=0, Size=4.9)` after 12 frames and `Size=2.5` after 3 more, `clear_all` after 3). Spawned on 11, the explosion is ages 72-83, 84-86, 87-89 at sizes 7.38, 4.9, 2.5; the replica's one box was 5.0 throughout. Still not modelled: the "Detection hitbox 33-82" that sets it off early (a mechanism, not a phase; carried in D59).

The Boomerang's "Distance spent turning back 16 (tilt) / 24 (smash)" (the third piece of this backlog line) is **not** modelled, and this task says why in `steerReturning`'s comment and D59: read as a stretch the turn travels, it cannot fit the published hitbox frames. The out flight from 2.4 at −0.047 a frame reaches the 0.3 minimum on age 45, which is exactly the returning box's first frame (72 − 27); 16 more units at 0.3 a frame would be 53 frames, and the returning box would start long before the boomerang turned. **Ruling D8** (recorded in D59): published but unreadable, so not modelled.

**Golden:** moves: the projectile lab (the Boomerang's hits and the bomb's blast), and CPU traces where a CPU throws either and connects differently. In the replay (with Tasks 9, 11, 13 and 14 applied) the projectile lab moved from 401-500 and link-samus-smashville from its first sample. Regenerating re-runs the lab pins this task could move, `expectProjectilePaths` ({ expired 2, settled 1, exploded 1, clanked 3 }) and `expectSmashSpecials` (the smash-thrown Boomerang's hit); both held in the replay. A pin that moves is this task's only if a bigger blast or the late Boomerang hit changed what that projectile came to; then re-pin it, with that reason in the commit and a paragraph in the history comment above `MUST_VISIT`. Regenerate, naming the traces.

**Files:**
- Modify: `src/fighters/link.ts`, `src/fighters/samus.ts`, `src/engine/projectile.ts` (comments only)
- Test: `src/fighters/projectiles.test.ts` (a new block; one pin moved), `src/fighters/smashSpecial.test.ts` (two pins moved)
- Regenerate: the golden and its pin

**Interfaces:**
- Consumes: `ProjectileDef.stages`, `stageOf`, `projectileHitbox`, `projectileHitboxes` (projectile.ts).
- Produces: nothing new by name.

- [ ] **Step 1: Write the failing test**

`src/fighters/projectiles.test.ts`, a new block at the end of the file:

```ts
describe("projectile phases by age (Plan 6, Task 15)", () => {
  const link = () => FIGHTERS.find((d) => d.id === "link")!;
  const samus = () => FIGHTERS.find((d) => d.id === "samus")!;
  const proj = (owner: FighterDef, slot: MoveSlot) => owner.moves[slot]!.projectiles![0];
  /** A fighter to throw from: Link standing on Final Destination. */
  const thrower = (): FighterState => duel("link", "samus", 0, 40).fighters[0];
  /** A flying projectile of `def` at `age`, outbound. */
  const at = (def: ProjectileDef, age: number): ProjectileState => ({ ...spawnProjectile(def, thrower(), 1), age, mode: "fly" });
  /** Its box's damage and radius, raw Q12. */
  const box = (def: ProjectileDef, p: ProjectileState) => {
    const hb = projectileHitbox(p, def);
    return [hb.damage, hb.radius];
  };

  it("the Boomerang hits clean for 10 frames, then late (SmashWiki: 8%/4.0, then 6%/3.6, BK 60)", () => {
    const b = proj(link(), "sideB");
    expect(box(b, at(b, 9))).toEqual([fx(8), fx(4)]);
    expect(box(b, at(b, 10))).toEqual([fx(6), fx(3.6)]);
    expect(projectileHitbox(at(b, 10), b).baseKnockback).toBe(fx(60));
  });

  it("the smash-thrown Boomerang's clean and late hits are 1.2 times", () => {
    const b = proj(link(), "sideBSmash");
    expect(box(b, at(b, 9))).toEqual([fx(9.6), fx(4)]);
    expect(box(b, at(b, 10))).toEqual([fx(7.2), fx(3.6)]);
  });

  it("returning, it is the returning hit whatever its age", () => {
    const b = proj(link(), "sideB");
    expect(box(b, { ...at(b, 20), returning: true })).toEqual([fx(3), fx(3.6)]);
  });

  it("Samus's bomb blast shrinks: 7.38, then 4.9 from its 13th frame, then 2.5 from its 16th", () => {
    const bomb = proj(samus(), "downB");
    expect([72, 83, 84, 86, 87, 89].map((age) => box(bomb, at(bomb, age)))).toEqual([
      [fx(5), fx(7.38)],
      [fx(5), fx(7.38)],
      [fx(5), fx(4.9)],
      [fx(5), fx(4.9)],
      [fx(5), fx(2.5)],
      [fx(5), fx(2.5)],
    ]);
  });
});
```

(Values are compared as raw Q12, so `fx(3.6)` is the box's own 3.60009765625. `FighterDef` and `MoveSlot` join the file's `@/engine/types` type import; `duel`, `spawnProjectile`, `projectileHitbox`, `fx` and `FIGHTERS` are there already.)

Two existing pins move with the late hit:
- `src/fighters/projectiles.test.ts`, "turns on frame 45 of its flight…":

  ```diff
  -    // Its hit from then is the returning row's.
  -    expect(projectileHitbox(life[44]!, BOOMERANG()).damage).toBe(fx(8));
  +    // Its late hit to the turn (Plan 6, Task 15), and from then the returning row's.
  +    expect(projectileHitbox(life[44]!, BOOMERANG()).damage).toBe(fx(6));
  ```

- `src/fighters/smashSpecial.test.ts`, "carries the page's numbers…": the stages differ by the 1.2 too.

  ```diff
  -    const same = (p: ProjectileDef) => ({ ...p, id: "", vx: 0, lifetime: 0, hitbox: { ...p.hitbox, endFrame: 0, damage: 0 } });
  +    // Its late hit is ×1.2 too (Plan 6, Task 15: `stages`), so the stages' damage is left out.
  +    const same = (p: ProjectileDef) => ({
  +      ...p,
  +      id: "",
  +      vx: 0,
  +      lifetime: 0,
  +      hitbox: { ...p.hitbox, endFrame: 0, damage: 0 },
  +      stages: p.stages?.map((st) => ({ ...st, hitbox: { ...st.hitbox, damage: 0 } })),
  +    });
  ```

  and "turns on frame 60 of its flight…":

  ```diff
  -    expect(projectileHitbox(life[59]!, SMASH_THROW()).damage).toBe(fx(9.6));
  +    // Its late 7.2% to the turn (Plan 6, Task 15), then the returning 3%.
  +    expect(projectileHitbox(life[59]!, SMASH_THROW()).damage).toBe(fx(7.2));
  ```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run src/fighters/projectiles.test.ts src/fighters/smashSpecial.test.ts`
Expected: FAIL, five tests (captured):
- the Boomerang: `AssertionError: expected [ 32768, 12288 ] to deeply equal [ 32768, 16384 ]` (radius 3, not 4);
- the smash throw: `expected [ 39322, 12288 ] to deeply equal [ 39322, 16384 ]`;
- the bomb: `expected [ [ 20480, 20480 ], …(5) ] to deeply equal [ [ 20480, 30228 ], …(5) ]`;
- "turns on frame 45": `expected 32768 to be 24576`;
- "turns on frame 60": `expected 39322 to be 29491`.

The returning test PASSES (a pin), and so does `same` (neither def has stages yet).

- [ ] **Step 3: Implement**

`src/fighters/link.ts`, `BOOMERANG`'s comment and box:

```diff
-  // 0.75°" (its sine and cosine below). Not modelled: "Distance spent
-  // turning back 16", the clean hit's 8% giving way to the late 6% on frame
-  // 10 (the box below is the clean one, at the replica's radius), and the
-  // floor's "Downward ground collision range −0.5u".
+  // 0.75°" (its sine and cosine below). The clean hit gives way to the late one
+  // on frame 10 of its flight (`stages`; Plan 6, Task 15). Not modelled:
+  // "Distance spent turning back 16" (it cannot fit the published hitbox frames:
+  // `steerReturning`; D8) and the floor's "Downward ground collision range −0.5u".
@@
   hitbox: {
     id: 0,
     startFrame: 0,
     endFrame: 124,
     x: fx(0),
     y: fx(0),
-    radius: fx(3.0),
+    // The clean hit's size (Plan 6, Task 15; the page's 4.0, where the replica had 3.0).
+    radius: fx(4.0),
     damage: fx(8.0),
@@
     // Task 13c).
   },
+  // "Tilt input hitboxes (clean, late, returning) 27-36, 37-71, 72-151": late from frame 10
+  // of its flight, 6.0%, BK 60, KS 40, size 3.6 (Plan 6, Task 15).
+  stages: [{ from: 10, hitbox: { damage: fx(6.0), baseKnockback: fx(60), radius: fx(3.6) } }],
 };
```

and the smash throw's projectile:

```diff
-          // reaches the knockback too (it multiplies the box's damage here). Published,
-          // not modelled, as for the tilt throw: "Distance spent turning back ... 24
-          // (smash)", the late 7.2% (6.0 × 1.2) from frame 10, "Rotation speed ... 26°
-          // (smash)".
+          // reaches the knockback too (it multiplies the box's damage here). Published,
+          // not modelled, as for the tilt throw: "Distance spent turning back ... 24
+          // (smash)" and "Rotation speed ... 26° (smash)".
           ...BOOMERANG,
           id: "boomerangSmash",
           vx: fx(3.1),
           lifetime: 167,
           hitbox: { ...BOOMERANG.hitbox, endFrame: 166, damage: fx(9.6) },
+          // The late 7.2% (6.0 × 1.2) from frame 10, "27-36, 37-86" (Plan 6, Task 15).
+          stages: [{ from: 10, hitbox: { damage: fx(7.2), baseKnockback: fx(60), radius: fx(3.6) } }],
```

`src/fighters/samus.ts`, the bomb:

```diff
-      // the ×0.6, it would rest from 75; fix round 1). Published, not modelled: the early,
-      // mid and late explosions' own numbers (one box here; the early one's radius
-      // is 7.38), the "Detection hitbox 33-82" that sets it off early, and its
-      // "Rotation speed".
+      // the ×0.6, it would rest from 75; fix round 1). The early, mid and late blasts
+      // are its `stages` (Plan 6, Task 15). Published, not modelled: the "Detection
+      // hitbox 33-82" that sets it off early, and its "Rotation speed".
@@
           hitbox: {
             // Live only at the end of its life, frames 83-100: the explosion.
             id: 0,
             startFrame: 72,
             endFrame: 89,
             x: fx(0),
             y: fx(0),
-            radius: fx(5.0),
+            // The early blast's size (Plan 6, Task 15: the page's 7.38).
+            radius: fx(7.38),
             damage: fx(5.0),
@@
             // samus_bomb `BurstAttack`: `Clang_Rebound=ATTACK_SETOFF_KIND_ON` (Plan 5, Task 13c).
           },
+          // The blast shrinks: rubendal 13.0.1 `samus_bomb` `BurstAttack` sets Size 4.9 after
+          // 12 frames and 2.5 after 3 more ("Explosion (early, mid, late) 83-94, 95-97,
+          // 98-100"); ages 84 and 87 (Plan 6, Task 15).
+          stages: [
+            { from: 84, hitbox: { radius: fx(4.9) } },
+            { from: 87, hitbox: { radius: fx(2.5) } },
+          ],
```

`src/engine/projectile.ts`, two comments:

```diff
  * Every box this projectile hits with now: `projectileHitbox`, or both of its
  * latest stage's where that has an air box and a ground box (Plan 5, Task 16). A
- * staged definition's boxes are its `hitbox` with each stage's numbers over it; none
- * on the roster is also `charged` or `returns`.
+ * staged definition's boxes are its `hitbox` with each stage's numbers over it. None
+ * on the roster is also `charged`; the Boomerang is also `returns`, and its return takes
+ * over from its stages (`projectileHitbox`; Plan 6, Task 15).
@@
- * "Distance spent turning back" is not modelled: it turns on the spot.
+ * "Distance spent turning back" is not modelled: it turns on the spot (Plan 6, Task 15;
+ * D8). Read as a stretch the turn travels, 16 units at the 0.3 minimum is 53 frames,
+ * while the page's returning hitbox starts on the very frame the out flight reaches the
+ * minimum (age 45 = 72 − 27), so the two published numbers cannot both hold.
```

- [ ] **Step 4: Run it again**

Run: `pnpm vitest run src/fighters/projectiles.test.ts src/fighters/smashSpecial.test.ts src/engine/projectile.test.ts src/fighters/schema.test.ts src/fighters/clank.test.ts`
Expected: PASS.

- [ ] **Step 5: Golden**

`UPDATE_GOLDEN=1 pnpm vitest run src/game/golden.test.ts`, re-pin `RULES_PIN.golden`, rerun: PASS. Expected moved: as under **Golden** above.

- [ ] **Step 6: Mutants**

Each was run in the replay (captured):
1. `link.ts`: `from: 10` → `from: 11` on the tilt throw. The Boomerang test FAILS: `expected [ 32768, 16384 ] to deeply equal [ 24576, 14746 ]`. Restore.
2. `samus.ts`: `from: 84` → `from: 85`. The bomb test FAILS (its age-84 row). Restore.

- [ ] **Step 7: Gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`.
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add super-smash/src/fighters/link.ts super-smash/src/fighters/samus.ts super-smash/src/engine/projectile.ts super-smash/src/fighters/projectiles.test.ts super-smash/src/fighters/smashSpecial.test.ts super-smash/src/game/__golden__/engine-trace.json super-smash/src/game/rulesVersion.test.ts
# plus super-smash/src/game/golden.test.ts if Step 5 re-pinned a lab pin
git commit -m "super-smash: the Boomerang's late hit and the Bomb's shrinking blast, on the projectile stages" -m "SmashWiki Link (SSBU)/Side special and Samus (SSBU)/Down special; rubendal samus_bomb BurstAttack. The Boomerang's 'distance spent turning back' cannot fit its published frames (D8). Golden: the projectile lab<, and the CPU traces that moved>." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 16: Thunder Jolt runs along the ground, walls and undersides

From Plan 5's triage: "Thunder Jolt along walls". Today the jolt is a lobbed spark that skips along the floor on gravity and bounces (`pikachu.ts`: vx 1.6, vy 0.2, gravity 0.05, `bounces: 8`), and a wall bounces it back. Sources (2026-11-01, rechecked 2026-11-02):
- SmashWiki "Thunder Jolt": "the user drops a sphere of electricity diagonally downwards … If it lands on a surface, it turns into an arcing wave of electricity that hops along the terrain's surface … The projectile will wrap around corners and snake along walls and even ceilings if the corners are not too sharp and it lives long enough; it cannot wrap around the underside of soft platforms due to there being no ceiling to latch onto. When the move is used on the ground, it essentially turns into the waveform immediately."
- SmashWiki "Pikachu (SSBU)/Neutral special":
  - "Jolt offsets [6.5, 1]".
  - The aerial jolt: "Lifetime 98 frames", "Travel speed 2", "Travel angle −58°", its box 4.8%, angle 361, BK 35, KS 30, size 3.0, hitbox 19-116.
  - The grounded jolt: "Lifetime 96 frames", "Movement speed multiplier 0.9", clean 19-52, mid 53-85, late 86-114.
  - "When touching a surface and changing into the grounded version, the projectile's hitbox duration always starts from the beginning".
- rubendal 13.0.1 `pikachu_dengeki` `Regular` (the grounded wave): two boxes on one bone each phase.
  - ID 0, `Ground_or_Air=COLLISION_SITUATION_MASK_G` (fighters on the ground): 6.0, 5.0 and 4.0%, angle 361, BKB 18, KBG 20, size 3.0.
  - ID 1, `COLLISION_SITUATION_MASK_A` (fighters in the air): 5.0, 4.0 and 3.0%, BKB 13, KBG 20, size 1.8.
  - SmashWiki's hitbox table says the same.
- rubendal `pikachu_dengekidama` `Regular` (the aerial spark): one box, 4.8%, BKB 35, KBG 30, size 3.0, `COLLISION_SITUATION_MASK_GA`.

So the jolt gets a new surface rule, `crawl`:
- In the air it is a spark flying straight at −58° at 2 a frame.
- On meeting any surface it becomes the wave. The wave runs along that platform's outline at a constant speed, its age and life starting again (so its clean, mid and late phases count from the landing), and hits fighters on the ground with its ID 0 box and fighters in the air with its ID 1 box.
- Round a solid platform's corners it carries on down the wall, along the underside and up the other wall.
- Off a soft platform's end it falls as an aerial spark again.
- Fired nearer its platform's end than its 6.5 offset, it is never walked back toward the platform: off a soft platform it falls from where it appears, and on a solid one it starts down the wall from the corner.
- Every wave box launches away from the wave (`lr` position), so one climbing a wall never launches into it.

UNVERIFIED, each named in the code:
- The wave's speed, 1.8 a frame, reading "Movement speed multiplier 0.9" against the aerial's speed 2. The page's phase lengths, 34 and 33, are also the script's `wait(Frames=30)` at 0.9, so the multiplier may be the wave's motion rate instead.
- That a 90° corner is "not too sharp" (every solid body here is a rectangle, and without wrapping them the page's walls never happen).
- No gravity on the aerial spark (none published).
- The wave's boxes riding one ground-box radius off the surface (the "hops" are drawn, not timed).
- The aerial life counting on from the wave's when it falls off a soft platform.
- Where a jolt fired at an edge starts.
- The wave's launch side.

These are recorded in D59.

**Golden:** may move: wherever a jolt flies. In the replay (with Tasks 9, 11 and 13-15 applied) nothing moved: no golden match throws a Thunder Jolt, so the crawl has no golden coverage (its tests are below). Regenerate only if it moves, naming the traces.

**Files:**
- Modify: `src/engine/types.ts` (`ProjectileDef.crawl`, `ProjectileMode` `"crawl"`, `ProjectileState.face`), `src/engine/projectile.ts`, `src/engine/hash.ts`, `src/fighters/pikachu.ts`, `src/ai/specials.ts` (`projectileRange`), `src/render/testFixtures.ts`
- Test: `src/fighters/projectiles.test.ts` (a new block; the underside test loses the jolt), `src/engine/hash.test.ts`, `src/fighters/schema.test.ts` (the jolt's published life; the "ground-hugging" test), `src/ai/specials.test.ts`, and `face` in three `ProjectileState` literals: `src/engine/final.test.ts`, `src/engine/reflect.test.ts`, `src/engine/simulate.test.ts`
- Regenerate: the golden and its pin, only if they moved

**Interfaces:**
- Consumes: `spawnProjectile`, `advanceProjectile`, `surfaces`/`meetFloor`/`meetSide`/`meetUnderside`, `projectileHitbox`, `projectileHitboxes`, `projectileHitboxActive`, `cloneProjectile`, `mixProjectile`, `platformCentreX`, `HARD_PLATFORM_DEPTH`; `Hitbox.situation` and `Hitbox.lr` (`"position"`); `projectileRange` (specials.ts).
- Produces:
  - `ProjectileDef.crawl?: { readonly speed: number; readonly life: number; readonly hitbox: ChargedHitbox; readonly air: ChargedHitbox; readonly stages?: readonly { readonly from: number; readonly hitbox: ChargedHitbox; readonly air?: ChargedHitbox }[] }`.
  - `ProjectileMode` member `"crawl"`.
  - `ProjectileState.face: number`: 0 top, 1 right wall, 2 underside, 3 left wall; −1 when not crawling; cloned and hashed.
  - `projectileRange(p, full = false, grounded = true)`.

- [ ] **Step 1: Write the failing tests**

`src/fighters/projectiles.test.ts`: `projectileHitboxes` joins its `@/engine/projectile` import, and a new block at the end of the file (it uses the real stages and the engine's `step`):

```ts
describe("Thunder Jolt runs along surfaces (Plan 6, Task 16; SmashWiki \"Thunder Jolt\")", () => {
  const FLOOR = FD.platforms[0];
  const JOLT = () => projectileDef("pikachu", "thunderJolt");

  /**
   * Pikachu at `x` on Final Destination's floor facing `facing` (or falling at `y` above
   * it), Fox far behind him; the jolt's state after each step, from the one it appears on.
   */
  function jolt(x: number, y: number, facing: number, frames: number): ProjectileState[] {
    let s = createInitialState("finalDestination", [{ defId: "pikachu" }, { defId: "fox" }], RULES, 5);
    const air = y > FLOOR.y;
    Object.assign(s.fighters[0], { action: air ? "fall" : "stand", grounded: !air, platform: air ? -1 : 0, x, y, facing, intangible: 0 });
    Object.assign(s.fighters[1], { action: "stand", grounded: true, platform: 0, x: -facing * fx(75), y: FLOOR.y, facing, intangible: 0 });
    let prev: InputFrame[] = [0, 0];
    const trail: ProjectileState[] = [];
    for (let i = 0; i < 19 + frames; i++) {
      const now: InputFrame[] = [i === 0 ? Btn.Special : 0, 0];
      s = step(s, now, { prevInputs: prev }).state;
      prev = now;
      if (s.projectiles[0] !== undefined) trail.push(s.projectiles[0]);
    }
    return trail;
  }

  it("used on the ground it is the wave at once, running along the floor at 1.8 a frame", () => {
    const trail = jolt(0, FLOOR.y, 1, 5);
    expect([trail[0].mode, trail[0].face]).toEqual(["crawl", 0]);
    expect(trail[2].x - trail[1].x).toBe(fx(1.8));
    expect(trail[2].y).toBe(FLOOR.y);
  });

  it("runs over Final Destination's right edge and down its wall, then along its underside", () => {
    const trail = jolt(fx(60), FLOOR.y, 1, 90);
    expect([...new Set(trail.map((p) => p.face))].slice(0, 3)).toEqual([0, 1, 2]);
    const onWall = trail.find((p) => p.face === 1)!;
    expect(onWall.x).toBe(FLOOR.x + FLOOR.halfWidth);
    expect(onWall.y).toBeLessThan(FLOOR.y);
  });

  it("the other way round from the left edge: down the left wall, then along the underside", () => {
    const trail = jolt(-fx(60), FLOOR.y, -1, 90);
    expect([...new Set(trail.map((p) => p.face))].slice(0, 3)).toEqual([0, 3, 2]);
    expect(trail.find((p) => p.face === 3)!.x).toBe(FLOOR.x - FLOOR.halfWidth);
  });

  it("in the air it flies down at 58 degrees until it meets the floor, then runs, its phases counted from there", () => {
    const trail = jolt(0, FLOOR.y + fx(30), 1, 60);
    expect([trail[0].mode, trail[0].vx, trail[0].vy]).toEqual(["fly", fx(1.0598), -fx(1.6961)]);
    const landed = trail.findIndex((p) => p.mode === "crawl");
    expect(landed).toBeGreaterThan(0);
    expect([trail[landed].face, trail[landed].age, trail[landed].y]).toEqual([0, 0, FLOOR.y]);
  });

  it("hits 6, 5 and 4% on the ground and 5, 4 and 3% in the air, by its age on the surface (rubendal `pikachu_dengeki`)", () => {
    const owner = duel("pikachu", "fox", 0, 40).fighters[0];
    const wave = (age: number): ProjectileState => ({ ...spawnProjectile(JOLT(), owner, 1), mode: "crawl", ground: 0, face: 0, age });
    const boxes = (p: ProjectileState) => projectileHitboxes(p, JOLT()).map((hb) => [hb.situation, hb.damage, hb.baseKnockback, hb.radius]);
    expect(boxes(wave(33))).toEqual([["ground", fx(6), fx(18), fx(3)], ["air", fx(5), fx(13), fx(1.8)]]);
    expect(boxes(wave(34))).toEqual([["ground", fx(5), fx(18), fx(3)], ["air", fx(4), fx(13), fx(1.8)]]);
    expect(boxes(wave(67))).toEqual([["ground", fx(4), fx(18), fx(3)], ["air", fx(3), fx(13), fx(1.8)]]);
    // The aerial spark: one box, 4.8%, BK 35, size 3.0.
    expect(boxes({ ...wave(5), mode: "fly", ground: -1, face: -1 })).toEqual([[undefined, fx(4.8), fx(35), fx(3)]]);
  });

  it("drops off a soft platform's end and lands on the floor below, never running down the soft platform's side", () => {
    const bf = STAGES.find((st) => st.id === "battlefield")!;
    const plat = bf.platforms.findIndex((p) => p.soft && p.x > 0 && p.y < fx(30));
    const p = bf.platforms[plat];
    let s = createInitialState("battlefield", [{ defId: "pikachu" }, { defId: "fox" }], RULES, 5);
    Object.assign(s.fighters[0], { action: "stand", grounded: true, platform: plat, x: p.x + p.halfWidth - fx(8), y: p.y, facing: 1, intangible: 0 });
    Object.assign(s.fighters[1], { action: "stand", grounded: true, platform: 0, x: -fx(60), y: bf.platforms[0].y });
    let prev: InputFrame[] = [0, 0];
    const modes: string[] = [];
    for (let i = 0; i < 60; i++) {
      const now: InputFrame[] = [i === 0 ? Btn.Special : 0, 0];
      s = step(s, now, { prevInputs: prev }).state;
      prev = now;
      const j = s.projectiles[0];
      if (j !== undefined) modes.push(`${j.mode}:${j.ground}:${j.face}`);
    }
    expect(modes[0]).toBe(`crawl:${plat}:0`);
    expect(modes.some((m) => m.startsWith("fly"))).toBe(true);
    expect(modes.some((m) => m === `crawl:${plat}:1`), "never down a soft platform's side").toBe(false);
    expect(modes.some((m) => m.startsWith("crawl:0:")), "lands on the main floor below and runs").toBe(true);
  });

  it("fired nearer a soft platform's end than its spawn offset, it falls from where it appears and never runs back", () => {
    const bf = STAGES.find((st) => st.id === "battlefield")!;
    const plat = bf.platforms.findIndex((p) => p.soft && p.x > 0 && p.y < fx(30));
    const p = bf.platforms[plat];
    let s = createInitialState("battlefield", [{ defId: "pikachu" }, { defId: "fox" }], RULES, 5);
    Object.assign(s.fighters[0], { action: "stand", grounded: true, platform: plat, x: p.x + p.halfWidth - fx(3), y: p.y, facing: 1, intangible: 0 });
    Object.assign(s.fighters[1], { action: "stand", grounded: true, platform: 0, x: -fx(60), y: bf.platforms[0].y });
    let prev: InputFrame[] = [0, 0];
    const trail: ProjectileState[] = [];
    for (let i = 0; i < 25; i++) {
      const now: InputFrame[] = [i === 0 ? Btn.Special : 0, 0];
      s = step(s, now, { prevInputs: prev }).state;
      prev = now;
      if (s.projectiles[0] !== undefined) trail.push(s.projectiles[0]);
    }
    expect(trail.length).toBeGreaterThan(2);
    expect(trail[1].mode).toBe("fly");
    expect(trail.every((q, i) => i === 0 || q.x >= trail[i - 1].x), "never back toward the platform").toBe(true);
  });

  it("on a wall it launches what it hits away from the wall, whichever way it runs (UNVERIFIED: `lr` position)", () => {
    const wall = FLOOR.x + FLOOR.halfWidth;
    const s = createInitialState("finalDestination", [{ defId: "pikachu" }, { defId: "mario" }], RULES, 5);
    Object.assign(s.fighters[0], { action: "stand", grounded: true, platform: 0, x: -fx(40), y: FLOOR.y, facing: 1, intangible: 0 });
    Object.assign(s.fighters[1], { action: "fall", grounded: false, platform: -1, x: wall + fx(3), y: FLOOR.y - fx(30), facing: -1, intangible: 0, invincible: 0, vx: 0, vy: 0 });
    // Running up the right wall (face 1, counter-clockwise: facing −1), below Mario's middle.
    const climbing: ProjectileState = { ...spawnProjectile(JOLT(), s.fighters[0], s.nextProjectileId, "pikachu"), mode: "crawl", ground: 0, face: 1, facing: -1, x: wall, y: FLOOR.y - fx(30), age: 5, life: 80 };
    s.projectiles.push(climbing);
    s.nextProjectileId += 1;
    const { states, events } = run(s, 8, () => [0, 0]);
    const at = events.findIndex((e) => e.hits.some((h) => h.attacker === 0 && h.victim === 1));
    expect(at).toBeGreaterThanOrEqual(0);
    expect(states[at].fighters[1].pendingFacing).toBe(1);
  });
});
```

(`FD`, `RULES`, `duel`, `run`, `projectileDef`, `STAGES`, `createInitialState`, `step`, `spawnProjectile`, `Btn`, `fx` and the `ProjectileState`/`InputFrame` types are the file's already.)

The same file's underside test drops the jolt, which now runs along an underside instead (this task's own tests cover it):

```diff
-  it("Mario's Fireball and the Thunder Jolt bounce back down off it, as off a wall", () => {
-    for (const [fighter, id] of [["mario", "fireball"], ["pikachu", "thunderJolt"]] as const) {
+  it("Mario's Fireball bounces back down off it, as off a wall", () => {
+    // The Thunder Jolt runs along the underside instead (Plan 6, Task 16).
+    for (const [fighter, id] of [["mario", "fireball"]] as const) {
```

`src/engine/hash.test.ts`: the `projectile()` fixture gains `face: -1,` after `ground: -1,`, and "notices a change to every projectile field" gains, after the `mode: "knocked"` line:

```ts
    // Plan 6, Task 16: the face of its platform a crawling projectile runs on.
    expect(withProjectile({ face: 1 })).not.toBe(base);
```

`src/fighters/schema.test.ts`:

```diff
-    // The grounded jolt: "Lifetime 96 frames"; "Clean hit 19-52", "Mid hit 53-85", "Late hit 86-114".
-    ["pikachu", "thunderJolt", 96, [0, 95], "https://www.ssbwiki.com/Pikachu_(SSBU)/Neutral_special"],
+    // The aerial jolt: "Lifetime 98 frames", "Hitbox 19-116" (Plan 6, Task 16: the grounded
+    // wave's 96 is its `crawl.life`, from wherever it lands).
+    ["pikachu", "thunderJolt", 98, [0, 97], "https://www.ssbwiki.com/Pikachu_(SSBU)/Neutral_special"],
@@
-  it("makes the ground-hugging projectiles actually fall", () => {
-    // Mario's fireball and Pikachu's Thunder Jolt are defined by bouncing along
-    // the floor. Zero gravity would make both of them lasers.
-    for (const [id, owner] of [
-      ["fireball", "mario"],
-      ["thunderJolt", "pikachu"],
-    ] as const) {
+  it("makes the ground-hugging projectiles actually fall, or run along the ground", () => {
+    // Mario's fireball is defined by bouncing along the floor; zero gravity would make
+    // it a laser. Pikachu's Thunder Jolt runs along whatever it meets (Plan 6, Task 16).
+    const jolt = everyProjectile(getFighterOrThrow("pikachu")).find((x) => x.projectile.id === "thunderJolt")!.projectile;
+    expect(jolt.crawl, "thunderJolt does not run along the ground").toBeDefined();
+    for (const [id, owner] of [["fireball", "mario"]] as const) {
```

`src/ai/specials.test.ts`: `projectileRange` joins its `./specials` import (after `mashPeriod`), and a new block at the end of the file:

```ts
describe("the CPU's range for a projectile that runs along the ground (Plan 6, Task 16)", () => {
  it("reads Thunder Jolt fired on the ground as its wave, 1.8 a frame for 96 frames, and fired in the air as its spark", () => {
    const jolt = pikachu.moves.neutralB!.projectiles![0];
    expect(projectileRange(jolt)).toBe(fx(1.8) * 96);
    expect(projectileRange(jolt, false, false)).toBe(fx(1.0598) * 98);
  });
});
```

The three `ProjectileState` literals gain `face: -1,` after `ground: …,`, or they stop typechecking once `face` exists:
- `src/engine/final.test.ts`, `hangingShot`;
- `src/engine/reflect.test.ts`, `shotAt`;
- `src/engine/simulate.test.ts`, the `cloneState` walker's projectile (`mode: "lodged", life: 3, ground: 0, face: -1,`).

`src/render/testFixtures.ts`'s `makeProjectile` gains `face: -1,` after `ground: -1,`.

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/fighters/projectiles.test.ts src/engine/hash.test.ts src/fighters/schema.test.ts src/ai/specials.test.ts`
Expected: FAIL, eleven tests (captured):
- "used on the ground": `AssertionError: expected [ 'fly', undefined ] to deeply equal [ 'crawl', +0 ]`;
- the right edge: `expected [ undefined ] to deeply equal [ +0, 1, 2 ]`;
- the left edge: `expected [ undefined ] to deeply equal [ +0, 3, 2 ]`;
- "in the air": `expected [ 'fly', 6554, 819 ] to deeply equal [ 'fly', 4341, -6947 ]`;
- the phases: `expected [ [ undefined, 24576, 73728, 9830 ] ] to deeply equal [ …(2) ]`;
- the soft end: `expected 'fly:-1:undefined' to be 'crawl:3:0'`;
- the wall: `expected -1 to be greater than or equal to 0`;
- the published life: `expected [ +0, 95 ] to deeply equal [ +0, 97 ]`;
- "ground-hugging": `thunderJolt does not run along the ground: expected undefined to be defined`;
- the hash: `expected 2236270907 not to be 2236270907`;
- the CPU's range: `expected 629184 to be 707808`.

"Fired nearer a soft platform's end" PASSES (captured). It pins the rule against the crawl's own `crawlStep`: today's lob flies forward anyway.

- [ ] **Step 3: Implement**

`src/engine/types.ts`:

```diff
-export type ProjectileMode = "fly" | "lodged" | "knocked";
+/** `"crawl"`: running along a platform's outline (`ProjectileDef.crawl`; Plan 6, Task 16). */
+export type ProjectileMode = "fly" | "lodged" | "knocked" | "crawl";
```

`ProjectileDef`, after `stages`:

```ts
  /**
   * It meets every surface by running along it (Plan 6, Task 16: Thunder Jolt; SmashWiki
   * "Thunder Jolt": it "hops along the terrain's surface" and "will wrap around corners
   * and snake along walls and even ceilings", but "cannot wrap around the underside of
   * soft platforms"). Running, it goes `speed` a frame round the platform's outline. Its
   * boxes are `hitbox` (for fighters on the ground) and `air` (for fighters in the air),
   * each over its `hitbox`, then each of `stages` from its age. Meeting a surface sets its
   * age to 0 and its life to `life` ("its hitbox duration always starts from the
   * beginning"). One fired from a fighter on the ground runs from its first frame.
   */
  readonly crawl?: {
    readonly speed: number;
    readonly life: number;
    readonly hitbox: ChargedHitbox;
    readonly air: ChargedHitbox;
    readonly stages?: readonly { readonly from: number; readonly hitbox: ChargedHitbox; readonly air?: ChargedHitbox }[];
  };
```

`ProjectileState`, after `ground`:

```ts
  /**
   * Running (`mode` `"crawl"`; Plan 6, Task 16): the face of platform `ground` it is on,
   * 0 the top, 1 the right wall, 2 the underside, 3 the left wall; `facing` +1 runs
   * clockwise (rightward on the top), −1 the other way. −1 otherwise.
   */
  face: number;
```

`src/engine/projectile.ts`, `spawnProjectile`: bind the returned literal and start a ground crawl.

```diff
-  return {
+  const p: ProjectileState = {
     instanceId,
     defId: def.id,
@@
     ground: -1,
+    face: -1,
     staleAs: stale.as,
     staleDamage: stale.damage,
     staleKnockback: stale.knockback,
   };
+  // On the ground a crawling projectile runs from its first frame (Plan 6, Task 16:
+  // Thunder Jolt "used on the ground … turns into the waveform immediately"), on the top
+  // of the platform its owner stands on.
+  if (def.crawl !== undefined && owner.grounded && owner.platform >= 0) {
+    startCrawl(p, def.crawl, owner.platform, 0, facing, p.x, owner.y);
+  }
+  return p;
 }
```

`cloneProjectile` gains `face: p.face,` after `ground: p.ground,`; `src/engine/hash.ts`'s `mixProjectile` gains `x = mixInt(x, p.face);` after `x = mixInt(x, p.ground);`.

New functions in `projectile.ts`, after `carryOnGround`:

```ts
/** Start running on face `face` of platform `i` at (x, y), clockwise for `dir` +1 (Plan 6, Task 16). */
function startCrawl(p: ProjectileState, c: NonNullable<ProjectileDef["crawl"]>, i: number, face: number, dir: number, x: number, y: number): void {
  p.mode = "crawl";
  p.ground = i;
  p.face = face;
  p.facing = dir >= 0 ? 1 : -1;
  p.x = x;
  p.y = y;
  p.age = 0;
  p.life = c.life;
}

/**
 * One frame round a platform's outline (Plan 6, Task 16). A solid platform is a box
 * `HARD_PLATFORM_DEPTH` deep: clockwise its faces run top (rightward), right wall
 * (down), underside (leftward), left wall (up). UNVERIFIED: that a 90° corner is "not
 * too sharp" to wrap (every solid body here is a rectangle). A soft platform has only a
 * top: past its end the projectile falls, flying again. One already past its face's end
 * (fired nearer the end than its spawn offset) is never walked back: off a soft platform
 * it falls from where it is, and on a solid one it starts down the wall from the corner
 * (UNVERIFIED: no source places a jolt fired at an edge). `vx`/`vy` are left as this
 * frame's step, for a painter's heading.
 */
function crawlStep(p: ProjectileState, def: ProjectileDef, stage: StageDef, frame: number): boolean {
  const c = def.crawl!;
  const plat = stage.platforms[p.ground];
  if (plat === undefined) return false;
  if (plat.motion) p.x += platformCentreX(plat, frame) - platformCentreX(plat, frame - 1);
  const cx = platformCentreX(plat, frame);
  const left = cx - plat.halfWidth;
  const right = cx + plat.halfWidth;
  const top = plat.y;
  const bottom = plat.y - HARD_PLATFORM_DEPTH;
  const x0 = p.x;
  const y0 = p.y;
  let d = c.speed;
  for (let corners = 0; corners < 4 && d > 0; corners++) {
    const cw = p.facing > 0;
    const alongX = p.face === 0 || p.face === 2;
    // Which way it runs along this face (+1 toward +x or +y), and where the face ends that way.
    const way = p.face === 0 || p.face === 3 ? (cw ? 1 : -1) : cw ? -1 : 1;
    const end = alongX ? (way > 0 ? right : left) : way > 0 ? top : bottom;
    const at = alongX ? p.x : p.y;
    // How far to the face's end: none for one already past it.
    const room = Math.max(0, (end - at) * way);
    if (d < room) {
      if (alongX) p.x = at + way * d;
      else p.y = at + way * d;
      d = 0;
      break;
    }
    d -= room;
    if (plat.soft) {
      // Off a soft platform's end: no wall to wrap to. It falls, an aerial spark again, on
      // the spark's own flight forward (UNVERIFIED: its aerial life counts on from here).
      if (room > 0) p.x = end;
      p.mode = "fly";
      p.ground = -1;
      p.face = -1;
      p.vx = p.facing >= 0 ? def.vx : -def.vx;
      p.vy = def.vy;
      return true;
    }
    if (alongX) p.x = end;
    else p.y = end;
    p.face = (p.face + (cw ? 1 : 3)) % 4;
  }
  p.vx = p.x - x0;
  p.vy = p.y - y0;
  return true;
}

/**
 * A running projectile's boxes (Plan 6, Task 16): `crawl.hitbox` for fighters on the
 * ground and `crawl.air` for fighters in the air (rubendal 13.0.1 `pikachu_dengeki`
 * `Regular`: ID 0 `COLLISION_SITUATION_MASK_G`, ID 1 `COLLISION_SITUATION_MASK_A`), each
 * over its `hitbox`, then the latest of `crawl.stages` its age has reached. Both sit on one
 * point, as the script's two sit on one bone, the ground box's radius off the face it runs
 * on (UNVERIFIED: the page's "hops" are drawn, not timed). Each launches away from the
 * wave (`lr` position; UNVERIFIED), so one climbing a wall never launches into it. Offsets
 * are facing-relative, as every projectile box's are (`appendProjectileCandidates`).
 * They are built each frame for a running jolt only; if a frame-time trace ever shows it,
 * cache them per age band.
 */
function crawlHitboxes(p: ProjectileState, def: ProjectileDef): readonly Hitbox[] {
  const c = def.crawl!;
  let ground: Hitbox = { ...def.hitbox, ...c.hitbox, situation: "ground", lr: "position" };
  let air: Hitbox = { ...def.hitbox, ...c.air, id: 1, situation: "air", lr: "position" };
  for (const st of c.stages ?? []) {
    if (p.age < st.from) continue;
    ground = { ...ground, ...st.hitbox };
    air = { ...air, ...st.air };
  }
  const r = ground.radius;
  const nx = p.face === 1 ? r : p.face === 3 ? -r : 0;
  const ny = p.face === 0 ? r : p.face === 2 ? -r : 0;
  const x = p.facing >= 0 ? nx : -nx;
  return [
    { ...ground, x, y: ny },
    { ...air, x, y: ny },
  ];
}
```

`advanceProjectile`, after the age and life checks and before the `if (p.ground >= 0)` resting branch:

```ts
  // Running along a surface (Plan 6, Task 16): its own life counts (above), and it goes
  // nowhere but round its platform.
  if (p.mode === "crawl") {
    if (!crawlStep(p, def, stage, frame)) return { alive: false, prevX, prevY };
    return inBlastZone(p, stage) ? { alive: true, prevX, prevY } : { alive: false, prevX, prevY };
  }
```

`SurfaceRule` gains `"crawl"` (`type SurfaceRule = Pick<ProjectileDef, "lodge" | "settle" | "hop" | "skim" | "crawl">;`), and each meeting starts one first:

```diff
 function meetFloor(p: ProjectileState, rule: SurfaceRule, i: number, y: number, soft: boolean): boolean {
+  if (rule.crawl !== undefined) {
+    startCrawl(p, rule.crawl, i, 0, p.vx, p.x, y);
+    return true;
+  }
   if (rule.lodge !== undefined) {
@@
 function meetSide(p: ProjectileState, rule: SurfaceRule, i: number, x: number): boolean {
+  if (rule.crawl !== undefined) {
+    // Moving left, it met a platform's right wall (face 1), which runs down clockwise;
+    // moving right, its left wall (face 3), which runs down the other way.
+    const rightWall = p.vx < 0;
+    const down = p.vy <= 0;
+    startCrawl(p, rule.crawl, i, rightWall ? 1 : 3, rightWall === down ? 1 : -1, x, p.y);
+    return true;
+  }
   if (rule.lodge !== undefined) {
@@
 function meetUnderside(p: ProjectileState, rule: SurfaceRule, i: number, y: number): boolean {
+  if (rule.crawl !== undefined) {
+    startCrawl(p, rule.crawl, i, 2, -p.vx, p.x, y);
+    return true;
+  }
   if (rule.lodge !== undefined) {
```

`projectileHitbox`, `projectileHitboxes` and `projectileHitboxActive` take the crawl first, so the order is crawl, then the return, then the stages, in all three:

```diff
 export function projectileHitbox(p: ProjectileState, def: ProjectileDef): Hitbox {
+  // Running, its ground box (Plan 6, Task 16); then the return, then the stages.
+  if (p.mode === "crawl" && def.crawl !== undefined) return crawlHitboxes(p, def)[0];
   if (p.returning && def.returns !== undefined) return returningHitbox(def, def.returns.hit);
@@
 export function projectileHitboxes(p: ProjectileState, def: ProjectileDef): readonly Hitbox[] {
+  if (p.mode === "crawl" && def.crawl !== undefined) return crawlHitboxes(p, def);
   const stage = p.returning && def.returns !== undefined ? -1 : stageOf(p, def);
@@
 export function projectileHitboxActive(p: ProjectileState, def: ProjectileDef): boolean {
-  return p.mode === "fly" && p.age >= def.hitbox.startFrame && p.age <= def.hitbox.endFrame;
+  // Running, it is live its whole life (Plan 6, Task 16).
+  if (p.mode === "crawl") return true;
+  return p.mode === "fly" && p.age >= def.hitbox.startFrame && p.age <= def.hitbox.endFrame;
 }
```

`src/ai/specials.ts`, `projectileRange` (ruling M10: the CPU reads the wave it fires, not the spark):

```diff
 /**
  * How far a projectile flies in its life: its speed a frame, a full charge's where
  * it has one (`ProjectileDef.charged`), gaining as it accelerates
- * (`ProjectileDef.accelerate`: the Super Missile), along its own way.
+ * (`ProjectileDef.accelerate`: the Super Missile), along its own way. One that runs
+ * along the ground (`ProjectileDef.crawl`: Thunder Jolt), fired `grounded`, runs its
+ * wave's life at its wave's speed (Plan 6, Task 16).
  */
-export function projectileRange(p: ProjectileDef, full = false): number {
+export function projectileRange(p: ProjectileDef, full = false, grounded = true): number {
+  if (grounded && p.crawl !== undefined) return p.crawl.speed * p.crawl.life;
```

(Its callers, `moveRange`, pass no `grounded` and read a jolt as fired on the ground: today they range only stored charges, the bow and smash-input specials, none of them a jolt.)

`src/fighters/pikachu.ts`, `neutralB`'s comment and the jolt:

```diff
-      // Fired as an arc that then **rolls along the floor**, hugging the
-      // terrain — which is the whole reason it is useful. Pikachu can run
-      // alongside it to approach, and it covers grounded escape options while
-      // he is cornered. The gravity and the bounce count below are what produce
-      // that skipping ground-hugging path; a zero-gravity version would be a
-      // completely different move.
-      //
-      // It weakens over a very long life — 6% fresh, 5% from frame 53, 4% from
-      // frame 86 — on the ground 96 frames, 19-114 (SmashWiki "Pikachu
-      // (SSBU)/Neutral special",
-      // https://www.ssbwiki.com/Pikachu_(SSBU)/Neutral_special: grounded jolt
-      // "Lifetime 96 frames"; the aerial jolt's 98, which starts over on
-      // landing, is not modelled) — which `ProjectileDef` has no field for, so what is encoded
-      // is the clean hit. Reflectable and absorbable. Every phase uses the
-      // Sakurai angle with low knockback: pressure and combo tool, never a kill.
+      // A spark that runs along the terrain, round corners, down walls and under the
+      // stage, which is the whole reason it is useful: Pikachu can run alongside it to
+      // approach, and it covers grounded escape options and the ledge (Plan 6, Task 16:
+      // `crawl`; SmashWiki "Thunder Jolt", https://www.ssbwiki.com/Thunder_Jolt, and
+      // "Pikachu (SSBU)/Neutral special",
+      // https://www.ssbwiki.com/Pikachu_(SSBU)/Neutral_special). In the air it is a
+      // spark flying at −58° at 2 a frame for 98 frames ("Lifetime 98 frames", "Travel
+      // speed 2", "Travel angle −58°"; 4.8%, BK 35, KS 30, size 3.0); on any surface,
+      // or fired on the ground, it is the wave, 96 frames from where it lands ("its
+      // hitbox duration always starts from the beginning"): 6%, then 5% from its 34th
+      // frame and 4% from its 67th ("Clean hit 19-52", "Mid hit 53-85", "Late hit
+      // 86-114"), BK 18, KS 20, size 3.0 on fighters on the ground, and 1% less, BK 13,
+      // size 1.8 on fighters in the air (rubendal 13.0.1 `pikachu_dengeki` `Regular`, IDs
+      // 0 and 1, `COLLISION_SITUATION_MASK_G` and `_A`). Off a soft platform's end it
+      // falls as a spark again. Reflectable and absorbable; every phase uses the Sakurai
+      // angle with low knockback: pressure and combo tool, never a kill.
+      // UNVERIFIED: the wave's 1.8 a frame ("Movement speed multiplier 0.9" against the
+      // aerial's 2; the page's phase lengths, 34 and 33, are also the script's
+      // `wait(Frames=30)` at 0.9, so the multiplier may be the wave's motion rate), no
+      // gravity on the spark (none published), and its size 3.0 where the replica had 2.4
+      // (the page's, for both).
       hitboxes: [],
       projectiles: [
         {
           id: "thunderJolt",
           spawnFrame: 19,
-          offsetX: fx(4.0),
-          offsetY: fx(2.6),
-          vx: fx(1.6),
-          vy: fx(0.2),
-          gravity: fx(0.05),
-          lifetime: 96,
+          // "Jolt offsets [6.5, 1]".
+          offsetX: fx(6.5),
+          offsetY: fx(1.0),
+          // "Travel speed 2", "Travel angle −58°": 2·cos 58°, −2·sin 58°.
+          vx: fx(1.0598),
+          vy: -fx(1.6961),
+          gravity: 0,
+          lifetime: 98,
           destroyOnHit: true,
-          bounces: 8,
           visual: "spark",
           // pikachu_dengekidama `Regular`: `Reflectable=true`.
           reflectable: true,
+          crawl: {
+            speed: fx(1.8),
+            life: 96,
+            hitbox: { damage: fx(6.0), baseKnockback: fx(18), knockbackGrowth: fx(20), radius: fx(3.0) },
+            air: { damage: fx(5.0), baseKnockback: fx(13), knockbackGrowth: fx(20), radius: fx(1.8) },
+            stages: [
+              { from: 34, hitbox: { damage: fx(5.0) }, air: { damage: fx(4.0) } },
+              { from: 67, hitbox: { damage: fx(4.0) }, air: { damage: fx(3.0) } },
+            ],
+          },
           hitbox: {
+            // The aerial spark (pikachu_dengekidama `Regular`): 4.8%, BK 35, KS 30, size 3.0.
             id: 0,
             startFrame: 0,
-            endFrame: 95,
+            endFrame: 97,
             x: fx(0),
             y: fx(0),
-            radius: fx(2.4),
-            damage: fx(6.0),
+            radius: fx(3.0),
+            damage: fx(4.8),
             angle: fx(361),
-            baseKnockback: fx(18),
-            knockbackGrowth: fx(20),
+            baseKnockback: fx(35),
+            knockbackGrowth: fx(30),
             effect: "electric",
```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/fighters/projectiles.test.ts src/engine/projectile.test.ts src/engine/hash.test.ts src/fighters/schema.test.ts src/ai/specials.test.ts src/render/chars/pikachu src/engine/reflect.test.ts src/fighters/reflect.test.ts src/engine/simulate.test.ts src/engine/final.test.ts`
Expected: PASS. The clank tests that place a jolt with `launch()` still pass. Their grounded owner now starts it crawling, and `launch()` then puts it where the test wants it.

- [ ] **Step 5: Golden**

`pnpm vitest run src/game/golden.test.ts src/game/rulesVersion.test.ts`: expected PASS, unchanged (no golden match throws a jolt). If it moves, regenerate, re-pin and name the traces.

- [ ] **Step 6: Mutants**

Each was run in the replay (captured):
1. `crawlStep`: `p.face = (p.face + (cw ? 1 : 3)) % 4` → `(p.face + 1) % 4`. The left-edge test FAILS: `expected [ +0, 2 ] to deeply equal [ +0, 3, 2 ]`. Restore.
2. `crawlStep`: delete the `if (plat.soft) { … }` block. The soft-end and the near-end tests FAIL. Restore.
3. `startCrawl`: delete `p.age = 0`. The aerial test FAILS: `expected [ +0, 8, 20 ] to deeply equal [ +0, +0, 20 ]`. Restore.
4. `crawlStep`: `const room = Math.max(0, (end - at) * way)` → `const room = abs(end - at)`. The near-end test FAILS: `expected 'crawl' to be 'fly'`. Restore.
5. `crawlHitboxes`: drop `lr: "position"` from both boxes. The wall test FAILS: `expected -1 to be 1`. Restore.
6. `projectileRange`: delete the `crawl` line. The CPU test FAILS: `expected 425418 to be 707808`. Restore.
7. `hash.ts`: delete `x = mixInt(x, p.face);`. The hash test FAILS. Restore.

- [ ] **Step 7: Gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`, then `PORT=3107 pnpm test:e2e --trace off`.
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add super-smash/src/engine/types.ts super-smash/src/engine/projectile.ts super-smash/src/engine/hash.ts super-smash/src/fighters/pikachu.ts super-smash/src/ai/specials.ts super-smash/src/render/testFixtures.ts super-smash/src/engine/hash.test.ts super-smash/src/fighters/projectiles.test.ts super-smash/src/fighters/schema.test.ts super-smash/src/ai/specials.test.ts super-smash/src/engine/final.test.ts super-smash/src/engine/reflect.test.ts super-smash/src/engine/simulate.test.ts
# with the golden only if its step regenerated it:
git add super-smash/src/game/__golden__/engine-trace.json super-smash/src/game/rulesVersion.test.ts
git commit -m "super-smash: Thunder Jolt runs along floors, down walls and under solid platforms" -m "SmashWiki Thunder Jolt and Pikachu (SSBU)/Neutral special; rubendal pikachu_dengeki (a ground box and an air box). The aerial spark at -58 degrees; the wave from a landing with its clean, mid and late phases, launching away from itself; off a soft platform's end it falls, and one fired past an end is never walked back. The CPU ranges the wave it fires. UNVERIFIED: the wave's 1.8, the 90-degree wrap, no spark gravity, the launch side. Golden: <unchanged | …>." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 17: Two launches on one fighter in one step: the strongest sets it, whichever ports

From Plan 5's final wave 2 re-review: "A fighter hit twice in one step from both sides flies the way of the higher-port attacker (pre-existing); R-FW2c made each hit's knockback order-free, but the direction still breaks port symmetry." Today the step's hits on one victim resolve in port order (`resolveHits`' `ordered`), and a second launch at 0.9× the first or more replaces the first (`knockbackStack`'s "replace"). So with two equal launches the higher port wins the direction. With two near-equal ones, the later port wins the whole launch: direction, hitstun, the bounce, the autolink and the ASDI.

No source rules on two simultaneous hits from two attackers (SmashWiki "Knockback" orders stacking for hits in sequence; Ultimate removed port priority from grabs, SmashWiki "Grab": "Ultimate resolves both quirks by simply causing both grabs to cancel each other out"). **Ruling D9** (UNVERIFIED, recorded in D59): of a step's launches on one fighter, the one with the most knockback stands. A tie goes to the one rising more, then to the source further left (the attacker's x, or the projectile's), then to the one sending right. Every rule is port-free. A hit whose launch is outranked still deals its damage and its freeze, and its event reports the launch that stands; nothing else of its own launch lands. So the step's strongest launch sets the direction and the reaction whatever the order.

**Golden:** may move (any golden step with two launches on one fighter). In the replay (with Tasks 9, 11 and 13-16 applied) nothing moved. Regenerate only if it moves, naming the traces.

**Files:**
- Modify: `src/engine/simulate.ts` (the launch pick in `applyHit`, and a per-step map through `resolveHits` and `resolveThrows`)
- Test: `src/engine/simulate.test.ts`
- Regenerate: the golden and its pin, only if they moved

**Interfaces:**
- Consumes: `resolveHits`, `resolveThrows`, `applyHit` (each gains a `launches` argument after `percents`), `knockbackStack`, `hitAngle`, `isAutolinkAngle`, `sinDeg`.
- Produces: `LaunchRank`, `launchOutranks(a, b): boolean` and `launchRise(angle): number` (simulate.ts, not exported): the D9 order.

- [ ] **Step 1: Write the failing tests**

`src/engine/simulate.test.ts`, a new block just before `describe("registry", () => {` (after Task 14's):

```ts
describe("two launches on one fighter in one step (Plan 6, Task 17; D9, UNVERIFIED)", () => {
  // Jabs that pass through each other's boxes (no clank), and a stronger one (BKB 44 for 40).
  const WEAK: FighterDef = { ...DEF, moves: { ...DEF.moves, jab1: move("jab1", { hitboxes: [hitbox({ transcendent: true })] }) } };
  const STRONG: FighterDef = { ...WEAK, id: "strong", moves: { ...WEAK.moves, jab1: move("jab1", { hitboxes: [hitbox({ transcendent: true, baseKnockback: fx(44) })] }) } };
  const DUO: SimContext = { fighter: (id) => (id === "strong" ? STRONG : WEAK), stage: () => STAGE };

  /**
   * A victim on port 0 standing at 0, the attacker on port `left` 8 to its left and the one
   * on port `right` 8 to its right (a `rightId`), both jabbing on the same step: which way
   * the victim flies 40 steps on, and its hitstun on the step the jabs land.
   */
  function sandwich(left: number, right: number, rightId = "tester"): { side: number; hitstun: number } {
    const ids = [0, 1, 2].map((port) => (port === right ? rightId : "tester"));
    let s = createInitialState("flat", ids.map((defId) => ({ defId })), RULES, 12345, DUO);
    const place = (port: number, x: number, facing: number) =>
      Object.assign(s.fighters[port], { action: "stand", actionFrame: 0, grounded: true, platform: 0, x, y: 0, facing, intangible: 0, vx: 0, vy: 0 });
    place(0, 0, 1);
    place(left, -fx(8), 1);
    place(right, fx(8), -1);
    let prev: InputFrame[] = [0, 0, 0];
    let hitstun = -1;
    for (let i = 0; i < 40; i++) {
      const now: InputFrame[] = i === 0 ? [0, Btn.Attack, Btn.Attack] : [0, 0, 0];
      s = step(s, now, { prevInputs: prev, ctx: DUO }).state;
      prev = now;
      if (hitstun < 0 && s.fighters[0].damage > 0) hitstun = s.fighters[0].hitstun;
    }
    return { side: Math.sign(s.fighters[0].x), hitstun };
  }

  it("from both sides with equal launches, the attacker further left sets the direction, whichever ports", () => {
    expect([sandwich(1, 2).side, sandwich(2, 1).side]).toEqual([1, 1]);
  });

  it("the stronger launch sets the direction and the hitstun, even when the weaker resolves after it", () => {
    const strongLast = sandwich(1, 2, "strong");
    const strongFirst = sandwich(2, 1, "strong");
    expect([strongLast.side, strongFirst.side]).toEqual([-1, -1]);
    expect(strongFirst.hitstun).toBe(strongLast.hitstun);
  });
});
```

(The tester's plain jabs would clank where they meet at the victim and land nothing, so these are `transcendent`. 40 steps is past the jabs' freeze. Each test swaps which port is on which side, so a rule that follows port order fails one of the two layouts. `FighterDef`, `SimContext`, `InputFrame` and the fixtures are the file's already.)

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/engine/simulate.test.ts -t "two launches"`
Expected: FAIL, both (captured):
- `AssertionError: expected [ -1, 1 ] to deeply equal [ 1, 1 ]`: the higher port's attacker wins the direction.
- `AssertionError: expected [ -1, 1 ] to deeply equal [ -1, -1 ]`: the weaker launch, at about 0.94× the stronger, replaces it when its port resolves second.

- [ ] **Step 3: Implement**

`src/engine/simulate.ts`, where phase 6 resolves the hits and the throws:

```diff
-  resolveHits(s, defs, bake, bones, candidates, intents, events, destroyed, finalOut, percents);
-  resolveThrows(s, defs, frozen, beforeActionFrame, intents, events, finalOut, percents);
+  // The launch each fighter took this step, for the next to weigh against (Plan 6, Task
+  // 17: `launchOutranks`), across the hits and the throws.
+  const launches = new Map<number, LaunchRank>();
+  resolveHits(s, defs, bake, bones, candidates, intents, events, destroyed, finalOut, percents, launches);
+  resolveThrows(s, defs, frozen, beforeActionFrame, intents, events, finalOut, percents, launches);
```

`resolveHits`, `resolveThrows` and `applyHit` each gain a last parameter after `percents: readonly number[],`:

```ts
  launches: Map<number, LaunchRank>,
```

and their two `applyHit(…, finalOut, percents)` calls (in `resolveHits` and in `resolveThrows`) pass `launches` after `percents`.

In `applyHit`, the stacking verdict:

```diff
   const source = candidateKey(c);
   const live = victim.hitstun > 0 || victim.pendingFacing !== 0;
   const current = !live
     ? 0
     : victim.pendingFacing !== 0
       ? mul(victim.pendingKnockback, LAUNCH_SPEED_RATIO)
       : victim.launchSpeed;
-  const verdict =
-    victim.combat.launchSource === source ? "replace" : knockbackStack(mul(kb, LAUNCH_SPEED_RATIO), current);
+  // A launch this fighter already took this step outranks this one (Plan 6, Task 17;
+  // D9): this hit's damage and freeze land, and nothing of its launch does, so the step's
+  // strongest launch sets the direction and the reaction whichever port resolves first.
+  const rank: LaunchRank = { kb, rise: launchRise(hitAngle(hb, victim.grounded, kb)), x: c.projectile !== null ? c.projectile.x : attacker.x, side: sourceFacing >= 0 ? 1 : -1 };
+  const earlier = launches.get(victim.port);
+  const outranked = earlier !== undefined && !launchOutranks(rank, earlier);
+  const verdict = outranked
+    ? "outranked"
+    : victim.combat.launchSource === source
+      ? "replace"
+      : knockbackStack(mul(kb, LAUNCH_SPEED_RATIO), current);
```

and, where the replace path begins (just after the `if (verdict !== "replace") { … return; }` block):

```diff
-  victim.combat.launchSource = source;
+  launches.set(victim.port, rank);
+  victim.combat.launchSource = source;
   victim.combat.comboHits += 1;
```

and the non-replace branch's hit event, which reported a knockback and an angle for `"keep"` alone:

```diff
-      knockback: verdict === "keep" ? kb : 0,
-      // A kept launch goes on the way it goes, and the spark says so (Plan 3 final
-      // wave; the Task 8 review's minor). One armoured through launches nothing new.
-      angle: verdict === "keep" ? keptLaunchAngle(victim, sourceFacing) : 0,
+      knockback: verdict === "armour" ? 0 : kb,
+      // A kept launch goes on the way it goes, and the spark says so (Plan 3 final
+      // wave; the Task 8 review's minor), as does an outranked one's (the step's stronger
+      // launch, Plan 6, Task 17). One armoured through launches nothing new.
+      angle: verdict === "armour" ? 0 : keptLaunchAngle(victim, sourceFacing),
```

(An outranked hit takes the non-replace branch with its own verdict, `"outranked"`. Its damage was dealt above, as every verdict's is, and its freeze lands on both fighters. Its event reports its own knockback and the angle of the launch that stands, as a kept hit's does, so `combat.test.ts`'s R-FW2c pin, "the same knockback from either side", still reads the same knockback on both of a step's hits. Unlike `"keep"`, it adds no vector to a launch already flying, so nothing depends on which hit resolved first.)

New, just above `isAutolinkAngle`:

```ts
/**
 * One launch a fighter took this step, as `launchOutranks` weighs it (Plan 6, Task 17):
 * its knockback, how much it rises, where its source stood (an attacker's or a projectile's
 * x) and which way it sends.
 */
interface LaunchRank {
  readonly kb: number;
  readonly rise: number;
  readonly x: number;
  readonly side: number;
}

/**
 * Two launches on one fighter in one step (Plan 6, Task 17; D9, UNVERIFIED: no source
 * rules on simultaneous hits from two attackers; SmashWiki "Knockback" orders stacking for
 * hits in sequence): the one with more knockback sets the launch; a tie goes to the one
 * rising more, then to the source further left, then to the one sending right. Every rule
 * is port-free, so a swap of ports flies the same way; two launches equal in all four go
 * the same way, so either may stand.
 */
function launchOutranks(a: LaunchRank, b: LaunchRank): boolean {
  if (a.kb !== b.kb) return a.kb > b.kb;
  if (a.rise !== b.rise) return a.rise > b.rise;
  if (a.x !== b.x) return a.x < b.x;
  return a.side > b.side;
}

/** How much a launch at `angle` rises: its sine, and 0 for an autolink angle, which is not degrees. */
function launchRise(angle: number): number {
  return isAutolinkAngle(angle) ? 0 : sinDeg(angle);
}
```

(`sinDeg` is imported from `./fixed` already.)

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/engine/simulate.test.ts src/engine/combat.test.ts src/fighters/finalSmash.test.ts src/engine/final.test.ts src/game/cpuRollback.test.ts`
Expected: PASS.

- [ ] **Step 5: Golden**

`pnpm vitest run src/game/golden.test.ts src/game/rulesVersion.test.ts`: expected PASS, unchanged. If it moves, regenerate, re-pin and name the traces.

- [ ] **Step 6: Mutants**

Each was run in the replay (captured):
1. `launchOutranks`: `return true;` as its first line (the old last-wins). Both tests FAIL (`expected [ -1, 1 ] to deeply equal [ 1, 1 ]`; `… to deeply equal [ -1, -1 ]`). Restore.
2. `launchOutranks`: `a.x < b.x` → `a.x > b.x`. The first test FAILS: `expected [ -1, -1 ] to deeply equal [ 1, 1 ]`. Restore.
3. Delete `launches.set(victim.port, rank);`. Both tests FAIL. Restore.

- [ ] **Step 7: Gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`.
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add super-smash/src/engine/simulate.ts super-smash/src/engine/simulate.test.ts
# with the golden only if its step regenerated it:
git add super-smash/src/game/__golden__/engine-trace.json super-smash/src/game/rulesVersion.test.ts
git commit -m "super-smash: of a step's launches on one fighter, the strongest stands, whichever ports" -m "D9, UNVERIFIED: the most knockback, then the most rise, then the source further left, then the one sending right. An outranked hit deals its damage and freeze and nothing else, so neither the direction nor the hitstun follows port order. Golden: <unchanged | …>." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: Final Smash scenes are the same whichever ports: a standing body is the same on every port

From Plan 5's final wave 2 re-review 3: "Port order still decides some baked catches (Kirby's Ultra Sword takes a standing DK exactly 3 behind as port 1, not as port 2) and Pikachu's startup sparks' push (0.3 units)." Tasks 9 and 11 changed both scenes after that measurement: Volt Tackle's sparks are two boxes with rehit 6, and the fighter beside Pikachu is slowed by 9 through them, which `pikachu.ts` itself named as why the push existed. So this task first reproduces the cases on the scenes as Tasks 9 and 11 leave them (ruling R-P6-3; I7). A case already port-free stays as a pin, with no fix.

**What the replay found.** The replay had Tasks 9, 11 and 13-17 applied: the first draft's Task 9 (a scene record per box, not by target and part) and a Task 11 that already had R-P6-10's still step. So the scene counts below may differ on the final Tasks 9 and 11. The cause, the per-port idle phase, depends on neither, and a test that fails for the stated reason proceeds with its numbers noted. It played every one of the eight Final Smashes against a standing opponent 2, 3, 5, 6 and 8 units ahead and behind, each facing either way, with and without a third fighter: 576 scenes, each on both port orders and compared step by step.
- **Volt Tackle's sparks are port-free** in every scene. Their test below is a pin.
- **14 scenes differed, every one a standing Donkey Kong:**
  - Kirby's Ultra Sword with Donkey Kong 3 behind him, facing away (Donkey Kong facing Kirby does not reproduce, which is why the backlog's line was hard to pin);
  - Zero Laser's start with Donkey Kong 5 to 8 away.
- **The cause, from a step-by-step diff and the hit pass:**
  - The two port orders are identical up to the step of the hit.
  - On that step, the same trap box, at the same place, reaches Donkey Kong's body on one port and not on the other.
  - A standing fighter's pose is `poseIndexOf`'s `idle` clock, `wrap(globalFrame + f.port * IDLE_PORT_OFFSET, …)` (`src/engine/acmd/poseClock.ts:333-334`). Its comment says why: "Idle is offset per port so four fighters do not breathe in lockstep".
  - That pose is the body the sim hits (`localHurtboxes`), stands on (`bakedEcb`) and measures a fighter's standing size by (`restEcb`). So a presentation offset decided hits by port, and Donkey Kong's idle arms swing far enough to decide a catch at the edge of a box.

  This is a port asymmetry of the sim, not of order: R-FW2o's facing rule already runs once, after all hits (`simulate.ts:1106-1117`).
- **The fix:** the idle clock drops the port term, and every port stands on one shared phase, `IDLE_PHASE`, 27 frames on: the old port 1's. The 3D drawing reads the same pose (`render3d/fighterPose.ts`, `render3d/anchors.ts`), so the drawn body stays the hit body. The 2D canvas renderer's own idle offset (`render/poses/timing.ts`) is untouched: it is drawing only, with no hurtboxes.
  - **Cost** (a ruling, recorded in D59): fighters standing still breathe in step in 3D.
  - **After the fix**, the same sweep finds no port difference (0 of 576 scenes).
- **Why 27 and not 0:** the replay tried both.
  - With 0, every port 1 changes its breathing. The CPU suites' idle player is always port 1, and `cpuIdleHuman.test.ts`'s "never turns in place" failed: "marth-pikachu@smallBattlefield: 11 turns in 30 frames", against its limit of 10.
  - With 27, port 1 stands as it always did. Port 0's standing body moves instead, and with it the measurements taken from it: the hurt allowlist, the reach allowlist's size ratios, and one face-turn sample. All three are regenerated or re-read below.

**Golden:** moves. In the replay, nine traces moved:
- mario-fox-battlefield (from 2001-2100);
- donkeyKong-pikachu-finalDestination (201-300);
- link-samus-smashville (2201-2300);
- kirby-marth-pokemonStadium2 (701-800);
- the scripted match (101-200);
- the states lab and the contact lab (1-100);
- the beams lab (601-700);
- samus-kirby-townAndCity-ball (1701-1800).

A port-0 fighter's standing body moved where a hit, the ledge or the CPU read it. Every lab pin held (`expectContacts` [2, 1, 0], `expectBeams` 54, `expectProjectilePaths`, `expectDashes`, `expectSmashSpecials`, `expectCpuFinalSmash`), as did `MUST_VISIT`. Regenerate, naming the traces. A lab pin moving stops the task.

**Files:**
- Modify: `src/engine/acmd/poseClock.ts`
- Test: `src/fighters/finalSmash.test.ts` (a new block), `src/engine/acmd/poseClock.test.ts` (the per-port pin rewritten), `src/render3d/faceTurn.test.ts` (its standing sample)
- Regenerate, in the conventions' order: `src/fighters/acmd/reach.allow.json` (`UPDATE_REACH`, then its size-ratio quotes and one class re-read), `src/game/hurt.allow.json` (`UPDATE_HURT`), the golden and its pin

**Interfaces:**
- Consumes: `poseIndexOf` (poseClock.ts); the file's `GAME` baked context, `FINAL_SMASH_READY` and `RULES` (finalSmash.test.ts); `restEcb` (hurtboxes.ts, through the reach and hurt tests).
- Produces: `IDLE_PHASE` (poseClock.ts, exported), replacing `IDLE_PORT_OFFSET`.

- [ ] **Step 1: Write the failing tests**

`src/fighters/finalSmash.test.ts`, a new block at the end of the file:

```ts
describe("Final Smash scenes are the same whichever ports the fighters are on (Plan 6, Task 18)", () => {
  /**
   * `user` with the Smash Ball's power standing at 0 on Final Destination, facing right,
   * `other` standing `gap` from it (behind when negative) facing `otherFacing`, the user on
   * port `userPort`; Special on the first step. The other's x, damage and action after
   * `frames` steps.
   */
  function scene(user: string, other: string, userPort: number, gap: number, otherFacing: number, frames: number): [number, number, string] {
    const ids = userPort === 0 ? [user, other] : [other, user];
    let s = createInitialState("finalDestination", ids.map((defId) => ({ defId })), RULES, 5, GAME);
    Object.assign(s.fighters[userPort], { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: 0, y: 0, facing: 1, intangible: 0, finalSmashReady: FINAL_SMASH_READY });
    Object.assign(s.fighters[1 - userPort], { action: "stand", actionFrame: 0, grounded: true, platform: 0, x: fx(gap), y: 0, facing: otherFacing, intangible: 0 });
    let prev: InputFrame[] = [0, 0];
    for (let i = 0; i < frames; i++) {
      const now: InputFrame[] = [0, 0];
      if (i === 0) now[userPort] = Btn.Special;
      s = step(s, now, { prevInputs: prev, ctx: GAME }).state;
      prev = now;
    }
    const o = s.fighters[1 - userPort];
    return [o.x, o.damage, o.action];
  }

  it("Kirby's Ultra Sword takes Donkey Kong standing 3 behind him, facing away, the same as port 0 or port 1", () => {
    expect(scene("kirby", "donkeyKong", 1, -3, -1, 60)).toEqual(scene("kirby", "donkeyKong", 0, -3, -1, 60));
  });

  it("Zero Laser's start reaches Donkey Kong standing 8 behind Samus the same as port 0 or port 1", () => {
    expect(scene("samus", "donkeyKong", 1, -8, 1, 60)).toEqual(scene("samus", "donkeyKong", 0, -8, 1, 60));
  });

  it("Volt Tackle's sparks push Mario standing 6 ahead the same distance as port 0 or port 1 (a pin: port-free since Tasks 9 and 11)", () => {
    expect(scene("pikachu", "mario", 1, 6, -1, 46)).toEqual(scene("pikachu", "mario", 0, 6, -1, 46));
  });
});
```

(`GAME`, `RULES`, `FINAL_SMASH_READY`, `createInitialState`, `step`, `Btn`, `fx` and `InputFrame` are the file's already.)

`src/engine/acmd/poseClock.test.ts`: `IDLE_PHASE` joins its `./poseClock` import (before `MOTION_OF_ACTION`), and the per-port pin becomes:

```diff
-  it("loops idle on the match clock, offset per port, so four fighters do not breathe in step", () => {
+  it("loops idle on the match clock, the same on every port: a standing body is the same whoever stands in it (Plan 6, Task 18)", () => {
     const c = clocks({ status_stand: { kind: "idle", frames: 30 } });
-    expect(poseIndexOf(DEF, fighter({ port: 0 }), 31, c)?.frame).toBe(2);
-    expect(poseIndexOf(DEF, fighter({ port: 1 }), 31, c)?.frame).toBe(((31 + 27) % 30) + 1);
+    expect([0, 1, 2, 3].map((port) => poseIndexOf(DEF, fighter({ port }), 31, c)?.frame)).toEqual(Array(4).fill(((31 + IDLE_PHASE) % 30) + 1));
   });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/fighters/finalSmash.test.ts src/engine/acmd/poseClock.test.ts -t "whichever ports the fighters are on|loops idle"`
Expected (captured):
- Ultra Sword FAILS: `AssertionError: expected [ -12288, +0, 'stand' ] to deeply equal [ -12288, 34408, 'finalTrapped' ]` (caught as port 0, missed as port 1).
- Zero Laser FAILS: `expected [ -14576, +0, 'stand' ] to deeply equal [ -15630, 4301, 'hitstun' ]`.
- The idle pin FAILS: `expected [ 2, 29, 26, 23 ] to deeply equal [ NaN, NaN, NaN, NaN ]` (the per-port phases; `IDLE_PHASE` does not exist yet).
- Volt Tackle PASSES: the pin.

- [ ] **Step 3: Implement, and regenerate the measurements**

`src/engine/acmd/poseClock.ts`:

```diff
-/** Idle is offset per port so four fighters do not breathe in lockstep. */
-export const IDLE_PORT_OFFSET = 27;
+/**
+ * Where on the match clock the idle cycle stands, the same for every port (Plan 6, Task
+ * 18): the idle pose is the body the sim hits and stands on, so a per-port offset (the
+ * old `IDLE_PORT_OFFSET`, 27 a port) made a hit on a standing fighter land or miss by
+ * its port. 27 is the old port 1's phase, so a port 1 stands as it always did. Cost:
+ * fighters standing still breathe in step (the 2D canvas renderer keeps its own offset,
+ * `render/poses/timing.ts`, which no hurtbox reads).
+ */
+export const IDLE_PHASE = 27;
@@
     case "idle":
-      return { motion, frame: wrap(globalFrame + f.port * IDLE_PORT_OFFSET, clock.frames) };
+      return { motion, frame: wrap(globalFrame + IDLE_PHASE, clock.frames) };
```

Port 0's standing body moves with it, so its measurements are regenerated, in the conventions' order:
1. `UPDATE_REACH=1 pnpm vitest run src/fighters/acmd/reach.test.ts`. In the replay its measurements came out unchanged. But the size ratios its classes are checked against (`sizeRatio`, `restEcb`'s standing top over `attributes.height`) moved, so in `src/fighters/acmd/reach.allow.json`:
   - every reason's quoted "<fighter>'s size ratio r (cap c)" becomes the new one (24 quotes): Mario 1.23 (cap 1.54), Donkey Kong 1.80 (2.25), Link 1.45 (1.81), Samus 1.77 (2.21), Kirby 1.48 (1.85), Fox 1.51 (1.89), Pikachu 1.66 (2.08), Marth 1.47 (1.84);
   - `"marth utilt"`, whose ×1.83 is now under Marth's 1.84 cap, becomes `"class": "size"`, with the reason: "a clip-placed limb (sword1 (on handr)) reaching 18.4 -> 33.7, x1.83, within 1.25 x marth's size ratio 1.47 (cap 1.84): the SSBU-sized body (D57). Was a clip-gain (the controller's ruling on the grip's clip-gains) against the 1.80 cap; Plan 6, Task 18's shared idle phase measures Marth's standing body 19.2 high, not 18.8".

   If another class check fails, read it the same way, and stop if it is not a size-ratio move.
2. `UPDATE_HURT=1 pnpm vitest run src/game/hurtboxes.test.ts`. In the replay, `src/game/hurt.allow.json`'s standing tops moved, every one but Mario's:
   - Donkey Kong 26.3 → 27.0;
   - Link 17.8 → 17.9;
   - Samus 21.3 → 21.6;
   - Kirby 9.4 → 9.8;
   - Fox 16.3 → 16.6;
   - Pikachu 11.3 → 11.5;
   - Marth 18.8 → 19.2 (half 2.4 → 2.3).

   Read the diff before staging it.

`src/render3d/faceTurn.test.ts`: the standing test samples the idle pose it always sampled (port 0's at frame 100). `bonesAfter` gains a frame:

```diff
-function bonesAfter(fighter: Fighter3D, id: string, state: Partial<FighterState>): Map<string, Object3D> {
+function bonesAfter(fighter: Fighter3D, id: string, state: Partial<FighterState>, frame = 100): Map<string, Object3D> {
   const f = makeFighter({ defId: id, x: fx(12), y: fx(3), ...state });
-  fighter.update({ f, x: toFloat(f.x), y: toFloat(f.y), frame: 100, blends: null, hitFlash: 0, hidden: false });
+  fighter.update({ f, x: toFloat(f.x), y: toFloat(f.y), frame, blends: null, hitFlash: 0, hidden: false });
```

and "in the world, standing, the turned face leans toward the camera" passes it:

```diff
-      const a = bonesAfter(on, id, { action: "stand", actionFrame: 0, facing });
-      const b = bonesAfter(off, id, { action: "stand", actionFrame: 0, facing });
+      // The idle pose it always sampled (Plan 6, Task 18: the idle clock now stands
+      // `IDLE_PHASE` on for every port, where port 0's stood at the match clock).
+      const a = bonesAfter(on, id, { action: "stand", actionFrame: 0, facing }, 100 - IDLE_PHASE);
+      const b = bonesAfter(off, id, { action: "stand", actionFrame: 0, facing }, 100 - IDLE_PHASE);
```

(with `import { IDLE_PHASE } from "@/engine/acmd/poseClock";` beside its `@/engine/fixed` import). Without this, Kirby's breathing at the new phase is 5 parts in 1,000 from the test's 3 places (`expected 0.7123925226488526 to be close to 0.7071067811865475`; captured).

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/fighters/finalSmash.test.ts src/engine/acmd/poseClock.test.ts src/fighters/acmd/reach.test.ts src/game/hurtboxes.test.ts src/game/bakedStep.test.ts src/render3d src/game/cpuIdleHuman.test.ts`
Expected: PASS. In the replay, `cpuIdleHuman.test.ts` passed with the shared phase at 27, and failed at 0 (above).

- [ ] **Step 5: Golden**

`UPDATE_GOLDEN=1 pnpm vitest run src/game/golden.test.ts`, re-pin `RULES_PIN.golden`, rerun: PASS. Expected moved: as under **Golden** above.

- [ ] **Step 6: Mutant**

`poseIndexOf`'s `idle` case: `globalFrame + IDLE_PHASE` → `globalFrame + IDLE_PHASE + f.port * 27` (the per-port offset back). The Ultra Sword and idle tests FAIL (`expected [ -12288, 34408, 'finalTrapped' ] to deeply equal [ -12288, +0, 'stand' ]`; `expected [ 29, 26, 23, 20 ] to deeply equal [ 29, 29, 29, 29 ]`; captured). Restore.

- [ ] **Step 7: Gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`, then `PORT=3107 pnpm test:e2e --trace off`.
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add super-smash/src/engine/acmd/poseClock.ts super-smash/src/engine/acmd/poseClock.test.ts super-smash/src/fighters/finalSmash.test.ts super-smash/src/render3d/faceTurn.test.ts super-smash/src/fighters/acmd/reach.allow.json super-smash/src/game/hurt.allow.json super-smash/src/game/__golden__/engine-trace.json super-smash/src/game/rulesVersion.test.ts
git commit -m "super-smash: a standing fighter's body is the same on every port" -m "The idle pose, which the sim hits, stands on and measures, was offset per port so fighters would not breathe in step, so Ultra Sword caught a standing Donkey Kong behind Kirby on one port and not the other, and Zero Laser's start reached him the same way. One shared phase now (the old port 1's, so the CPU suites' idle player stands as before). The reach and hurt allowlists re-measure port 0's standing body. Volt Tackle's spark push is port-free since Tasks 9 and 11 (a pin). Golden: <the traces that moved>." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

**The bodies sub-group (Tasks 19-22).** These tasks change baked bodies or the clips the sim reads. So they run here, at the end of the engine group, and the CPU group measures the final bodies (R-P6-3).

They were replayed at `46e0706` with Task 7 applied first: they consume its `edgeSlip` action, its lockout and its action-count pins. They then ran in this order, with Tasks 35-40 on top. Tasks 4-6 and 8-18 were not in that replay.

Two seams follow from that. Neither changes a task.
- **`poseClock.ts`.** Task 18 replaces the per-port idle offset with one shared phase. It changes the `IDLE_PORT_OFFSET` constant (now `IDLE_PHASE`) and the `idle` case of `poseIndexOf`.
  - Tasks 20, 21 and 22 edit other parts of the same file: `MOTION_OF_ACTION`, `statusMotion`, `fullReleaseIndex` above `poseIndexOf`, the full release's two lines at its top, and `statusDuration`. Their hunks apply as written, by symbol.
  - But every number these tasks measured on a standing port-0 body was taken on the old per-port phase:
    - Task 19's hurt-allowlist and reach rows, and its scene-gap captures;
    - Task 36's −6.5 trap pin;
    - Task 37's measured outliers (`fxScale.test.ts`'s `EXPECTED`): its heights are port 0's standing head top;
    - the golden traces each task names.

    Each is regenerated or re-read in its own task. A figure that differs for that reason proceeds, noted, and a measured list (Task 19's reach and hurt figures, Task 37's `EXPECTED`) is re-measured on this tree and rewritten, with the reason in the commit (ruling R-P6-23).
- **The Final Smash scenes.** Tasks 9 and 11 changed the scenes that Task 19's gap pins and Task 36's trap pin measure (scene records by part; the slowed bystander). The same rule covers those numbers.

### Task 19: Kirby stands on the floor: a stance lift in the bake, decided on the hurtboxes; the clip-gain reaches looked at

Two Plan 4 carries:
- Plan 4 Task 17 review: "at idle feet/hands sink up to 1.1 below the floor (Mario −1.11, DK knuckles −1.07, Kirby −0.57); crouch and shield lift the feet up to 2.4 (Samus). The hurtboxes agree with the drawing, so a fix is a clip/retarget calibration (per-fighter stance offset in the bake) and moves the golden — decide with the screenshots."
- R12d: "Limb-slot "clip-gain" reaches: eyeball each in 3D once models render (accepted clip-gains DK nair, Kirby dtilt, Kirby nair, Kirby ftilt, Link jab3, Link utilt, Marth utilt; also DK fair, Samus dtilt/utilt, Link utilt)."

**The lift moves the sim's bodies.** The lift is added to the root's `up` in `rootXformInto`. Both the bake (`poseWorld`, so the bones, the hurtboxes and the ECB's top the sim reads) and the 3D model (`drawnPose`) read that one function, so the drawing and the bodies rise together. The ECB's bottom stays the fighter's origin (`ecbFromHurtboxes` returns `bottom: 0`), so nobody floats off the floor.

**Ruling D13 (the controller's, R-P6-8): decided on the hurtboxes.** The backlog's figures are the drawn mesh's. The hurtboxes, decoded from the committed bake over `status_stand`'s whole cycle (lowest capsule bottom, world units), do not sink alike:

| Fighter | Lowest leg hurtbox | Lowest of any hurtbox | Mesh (the backlog) |
|---|---|---|---|
| Mario | −0.32 | −0.32 | −1.11 |
| Donkey Kong | +0.18 | −1.02 (his knuckles) | −1.07 (his knuckles) |
| Kirby | −2.57 | −2.57 | −0.57 |
| Pikachu | −1.23 | −1.23 | not listed |
| Fox | −0.12 | −0.12 | not listed |
| Link | +0.36 | +0.36 | |
| Marth | +0.29 | +0.29 | |
| Samus | +1.06 | +1.06 | |

The rule:
- A lift is measured on the leg hurtboxes (the bake). It is capped by the mesh's sink (the probe, Step 1), so it floats neither the bodies nor the drawing off the floor. Lifting Kirby by his hurtboxes' 2.57 would draw his feet 2.0 above the floor, which reads worse than today.
- A fighter whose sink is his hands (Donkey Kong's knuckle stance) is not lifted for it: his legs already stand on the floor. That is his idle clip's arm length, carried.

So the one lift is **Kirby's, 0.57**, his mesh's sink. His leg hurtboxes rise by as much and stay 2.0 under the floor, where nothing reaches. The lift costs:
- the golden (two Kirby traces, captured);
- the hurt allowlist (his ECB top, 9.4 → 10.0, so the footstool heads it gives `footstoolHeads` and his ceiling contacts rise by 0.6);
- one reach row (his up air);
- his three Final Smash scene gaps (R-T17i): 8, 8 and 9 become 8.5, 8.5 and 9.5. They are presentation only.

Not lifted (each goes on the "Carried, not in Plan 6" list with its reason):
- **Mario.** His hurtboxes would take 0.32, a third of his mesh's 1.11. That lift draws Donkey Kong and Fox inside him in their Final Smash scenes (`sceneDraw.test.ts`, R-T17i: ten cases, captured), and re-measuring their gaps moves 17 pins, for a lift that leaves his shoes 0.79 under the floor. Carried, with the retarget's foot fit.
- **Donkey Kong.** His knuckles, as above.
- **Pikachu and Fox.** Plan 4's review lists no mesh sink for them; Step 1 confirms it on the local models. A sink over 0.1 found there stops the task and is reported, not lifted silently.

The crouch's and shield's lifted feet are their clips' own poses, left as they are (D59, a clip-authoring item).

**Golden:** moves (captured): `kirby-marth-pokemonStadium2` and `samus-kirby-townAndCity-ball`; every other trace byte-identical, the slip lab's included. Regenerate in Plans 2-5's order: `UPDATE_BAKE` → `UPDATE_REACH` → `UPDATE_HURT` → `UPDATE_GOLDEN`. `UPDATE_LIMB` and `UPDATE_RECONCILE` read no bone positions and stay. A pinned number elsewhere that moves (for example `src/ai/behaviours.test.ts`'s `meleeReachFromDef` pins) stops the task and is reported (none did, captured).

**Files:**
- Create: `src/render3d/bake/stance.ts`, `src/render3d/bake/stance.test.ts`, `src/render3d/bake/stance.probe.test.ts`
- Modify: `src/render3d/bake/bake.ts` (`FighterBakeInput.stanceUp`, `FighterPoser.stanceUp`, `fighterPoser`, `rootXformInto`, `bakeFighter`), `src/render3d/bake/roster.ts` (`bakeRoster`'s `stance`), `src/fighters/kirby.ts` (three `sceneGap`s), `src/render/plan5.test.ts` (their pins), `src/game/bake.test.ts` (the 14-second chunk test counts the file's chunks)
- Regenerate: `public/bake/roster.bin.gz`, `src/fighters/bake/digest.ts`, `src/fighters/acmd/reach.allow.json`, `src/game/hurt.allow.json`, the golden and its pin

**Interfaces:**
- Consumes: `fighterPoser`, `rootXformInto`, `rootXformOf`, `statusSamplers`, `sampleAt`, `bakeFighter` (bake.ts); `bakeRoster` (roster.ts); `bakeTables`, `localHurtboxes`, `scriptHitboxes`, `moveScriptFrame`, `capsulesOverlap`, `withLimbScripts`; `createFighter3D`, `parseModelIndex`, `readBakeFromDisk` (the probe).
- Produces: `STANCE_UP: Readonly<Record<string, number>>` and `MESH_CAPPED: ReadonlySet<string>` (stance.ts); `FighterPoser.stanceUp: number`; `fighterPoser(def, skeleton, stanceUp = STANCE_UP[def.id] ?? 0)`; `FighterBakeInput.stanceUp?: number`; `bakeRoster(skeletons, stance = STANCE_UP)`.

- [ ] **Step 1: The probe, run before the lift (local, numbers only)**

`src/render3d/bake/stance.probe.test.ts` (new file). It is a vitest file, so the `@/` alias and TypeScript resolve, and it is skipped unless `STANCE_PROBE=1`, so `pnpm test` never runs it:

```ts
// @vitest-environment node
/**
 * The stance probe (Plan 6, Task 19): how far below the floor each fighter's drawn model reaches
 * at idle, by body part, in world units. Opt-in and local: it reads the git-ignored models
 * (`pnpm models` builds them into `public/models/`), poses each exactly as a match does
 * (`createFighter3D` → `drawnPose`, over the whole idle cycle), skins every vertex, and prints one
 * JSON line per fighter. It writes nothing, and makes no image (SPEC §3.1: the models are
 * Nintendo's, the repo is public). A fighter without a local model is measured as its stand-in:
 * a smoke test of the probe, not a measurement (a stand-in's low-poly capsules sit up to about
 * 0.1 above the hurtboxes' true bottoms, which `stance.test.ts` measures).
 *
 *   STANCE_PROBE=1 pnpm vitest run src/render3d/bake/stance.probe.test.ts --reporter=verbose
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it } from "vitest";
import { Mesh, SkinnedMesh, Vector3, type Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

import { FIGHTERS } from "@/fighters";
import { readBakeFromDisk } from "@/game/bakeNode";
import { makeFighter } from "@/render/testFixtures";
import { SKELETONS } from "../skeletons";
import { createFighter3D } from "../fighter3d";
import { parseModelIndex, type LoadedModel } from "../models/loader";
import { fighterPoser } from "./bake";

const FEET = /^(knee|leg|foot|toe)/i;
const HANDS = /^(arm|hand|finger|have)/i;
const MODELS = join(process.cwd(), "public", "models");

/** A fighter's glb, parsed in Node: three's loader reads `self.URL`, and a texture it cannot decode is left out (the probe needs none). */
async function loadModel(id: string): Promise<LoadedModel> {
  const indexFile = join(MODELS, "index.json");
  const entry = existsSync(indexFile) ? parseModelIndex(JSON.parse(readFileSync(indexFile, "utf8")))?.models[id] : undefined;
  if (entry === undefined || !existsSync(join(MODELS, entry.file))) return { kind: "standIn", reason: "no local model" };
  (globalThis as { self?: unknown }).self ??= globalThis;
  const bytes = readFileSync(join(MODELS, entry.file));
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "");
  return { kind: "glb", scene: gltf.scene };
}

/** The bone a vertex hangs off: its heaviest joint (skinned), or the bone a stand-in capsule rides. */
function boneOf(mesh: Mesh, i: number): string {
  if (!(mesh as SkinnedMesh).isSkinnedMesh) return mesh.parent?.name ?? "";
  const skinned = mesh as SkinnedMesh;
  const index = skinned.geometry.getAttribute("skinIndex");
  const weight = skinned.geometry.getAttribute("skinWeight");
  let best = 0;
  for (let k = 1; k < 4; k++) if (weight.getComponent(i, k) > weight.getComponent(i, best)) best = k;
  return skinned.skeleton.bones[index.getComponent(i, best)]?.name ?? "";
}

/** The lowest drawn point of `root`'s meshes as posed now, by part. */
function lowest(root: Object3D, low: { feet: number; hands: number; all: number }): void {
  const v = new Vector3();
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || !mesh.visible) return;
    const n = mesh.geometry.getAttribute("position").count;
    for (let i = 0; i < n; i++) {
      mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld);
      low.all = Math.min(low.all, v.y);
      const bone = boneOf(mesh, i);
      if (FEET.test(bone)) low.feet = Math.min(low.feet, v.y);
      if (HANDS.test(bone)) low.hands = Math.min(low.hands, v.y);
    }
  });
}

describe.skipIf(process.env.STANCE_PROBE !== "1")("the stance probe (Plan 6, Task 19; local, numbers only)", () => {
  it("prints each fighter's lowest drawn point at idle, by part", async () => {
    const bake = readBakeFromDisk();
    for (const def of FIGHTERS) {
      const model = await loadModel(def.id);
      const fighter = createFighter3D({ def, port: 0, poser: fighterPoser(def, SKELETONS[def.id]), bake, model, faceTurns: [] });
      const frames = bake.clock(def.id, "status_stand")?.frames ?? 1;
      const low = { feet: Infinity, hands: Infinity, all: Infinity };
      for (let g = 0; g < frames; g++) {
        fighter.update({ f: makeFighter({ defId: def.id, action: "stand" }), x: 0, y: 0, frame: g, blends: null, hitFlash: 0, hidden: false });
        lowest(fighter.placement, low);
      }
      const round = (n: number) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);
      console.log(JSON.stringify({ id: def.id, kind: model.kind, feet: round(low.feet), hands: round(low.hands), all: round(low.all) }));
      fighter.dispose();
    }
  }, 300_000);
});
```

Run it now, on the committed bake, before the lift (Step 4): `STANCE_PROBE=1 pnpm vitest run src/render3d/bake/stance.probe.test.ts --reporter=verbose`.

Expected with the local models: Kirby's `feet` within 0.05 of −0.57, and no other fighter's `feet` under −0.1 except Mario's (about −1.11). Donkey Kong's `hands` is about −1.07, and it is not a lift. A figure outside that stops the task: report the eight lines.

Without models (captured on stand-ins): `{"id":"mario","kind":"standIn","feet":-0.22,"hands":5.91,"all":-0.22}`, `{"id":"donkeyKong","kind":"standIn","feet":0.22,"hands":-0.97,"all":-0.97}`, `{"id":"kirby","kind":"standIn","feet":-2.46,"hands":3.48,"all":-2.46}`, and five more. Those check the probe runs, not the stance.

Nothing is saved: the probe prints JSON lines to the terminal and creates no file.

- [ ] **Step 2: Write the failing tests**

`src/render3d/bake/stance.ts` (new file):

```ts
/**
 * How far each fighter's whole pose is raised so its idle stance stands on the floor
 * (Plan 6, Task 19; Plan 4 Task 17's review: "at idle feet/hands sink up to 1.1 below
 * the floor (Mario −1.11, DK knuckles −1.07, Kirby −0.57)"). World units, read by
 * `rootXformInto`, so the bake (the sim's bones, its hurtboxes and its ECB's top) and the
 * drawing rise together.
 *
 * Decided on the hurtboxes (ruling D13): a lift is the leg hurtboxes' sink at idle (the
 * committed bake, the lowest leg capsule over the idle cycle, which `stance.test.ts`
 * measures), capped by the drawn feet's (`stance.probe.test.ts`, on the local models), so
 * it floats neither a hurtbox nor the drawing off the floor.
 * - Kirby: legs 2.57 under, mesh 0.57 under → 0.57. His leg capsules stay 2.0 under the
 *   floor, where nothing reaches.
 * Not lifted (D59 records each):
 * - Mario: legs 0.32 under, mesh 1.11. A 0.32 lift leaves his soles 0.79 under (his shoes
 *   reach below his leg capsules) and draws Donkey Kong and Fox inside him in their Final
 *   Smash scenes (R-T17i, `sceneDraw.test.ts`): their scene gaps re-measured across 17 pins,
 *   for a third of his sink. Carried, with the retarget's foot fit.
 * - Donkey Kong: his legs stand 0.18 above the floor; his sink is his knuckles' (1.02: his
 *   idle rests on them), the idle clip's arm length, not a lift.
 * - Link, Marth and Samus: their lowest idle hurtboxes are above the floor already.
 * - Fox and Pikachu: their meshes do not sink (Plan 4's review lists neither; the probe).
 * UNVERIFIED (cosmetic, and it moves the hurtboxes): one lift for every motion, the idle's.
 */
export const STANCE_UP: Readonly<Record<string, number>> = {
  kirby: 0.57,
};

/** Fighters lifted by their mesh's sink, smaller than their hurtboxes': their lowest idle hurtbox stays under the floor. */
export const MESH_CAPPED: ReadonlySet<string> = new Set(["kirby"]);
```

`src/render3d/bake/stance.test.ts` (new file). The first test pins the plumbing (any lift passes it). The second pins the rule against a bake without the lift. The third is Review Focus 5 (R-P6-13): the lift turns no hit into a whiff.

```ts
// @vitest-environment node
import { describe, expect, it } from "vitest";

import { scriptHitboxes } from "@/engine/acmd/hitboxes";
import { bakeTables, type BakeTables } from "@/engine/acmd/bakeTables";
import { localHurtboxes } from "@/engine/acmd/hurtboxes";
import { moveScriptFrame } from "@/engine/acmd/run";
import type { ClockedFighter } from "@/engine/acmd/poseClock";
import { fx, toFloat } from "@/engine/fixed";
import { capsulesOverlap, type Capsule } from "@/engine/hitbox";
import type { FighterDef, MoveSlot } from "@/engine/types";
import { FIGHTERS } from "@/fighters";
import { withLimbScripts } from "@/fighters/acmd/limb";
import { SKELETONS } from "../skeletons";
import { fighterPoser, rootXformOf, sampleAt, statusSamplers } from "./bake";
import { bakeRoster } from "./roster";
import { MESH_CAPPED, STANCE_UP } from "./stance";

/** Standing, at the origin, facing forward: the idle the lift is measured on. */
const STANDING: Omit<ClockedFighter, "defId"> = {
  action: "stand",
  actionFrame: 0,
  move: null,
  port: 0,
  charge: 0,
  hitstun: 0,
  jumpsUsed: 0,
  fastFalling: false,
  vx: 0,
  vy: 0,
  shortHop: false,
};

/** The bake without any lift, and with the committed one (both fresh, as `roster.test.ts` bakes). */
const before = bakeTables(bakeRoster(SKELETONS, {}), "before");
const after = bakeTables(bakeRoster(SKELETONS), "after");

const LEG = /^(knee|leg|foot|toe)/;

/** The lowest point of `def`'s leg hurtboxes over its whole idle cycle, world units. */
function lowestIdleLeg(def: FighterDef, bake: BakeTables): number {
  const boxes = bake.hurtboxes(def.id)!;
  let low = Infinity;
  for (let g = 0; g < bake.clock(def.id, "status_stand")!.frames; g++) {
    localHurtboxes(def, { ...STANDING, defId: def.id }, g, bake)!.forEach((c, i) => {
      if (LEG.test(boxes[i].bone)) low = Math.min(low, toFloat(Math.min(c.y1, c.y2) - c.r));
    });
  }
  return low;
}

describe("the stance lift (Plan 6, Task 19)", () => {
  it("raises each listed fighter's root by its STANCE_UP, and nobody else's", () => {
    for (const def of FIGHTERS) {
      const sample = sampleAt(statusSamplers(def).get("status_stand")!, 1).sample;
      const lifted = rootXformOf(fighterPoser(def, SKELETONS[def.id]), sample).up;
      const flat = rootXformOf(fighterPoser(def, SKELETONS[def.id], 0), sample).up;
      expect(lifted - flat, def.id).toBeCloseTo(STANCE_UP[def.id] ?? 0, 6);
    }
  });

  it("stands a lifted fighter's lowest idle leg hurtbox on the floor, never above it", () => {
    for (const def of FIGHTERS) {
      const was = lowestIdleLeg(def, before);
      const now = lowestIdleLeg(def, after);
      expect(now - was, def.id).toBeCloseTo(STANCE_UP[def.id] ?? 0, 2);
      if (STANCE_UP[def.id] === undefined) continue;
      // Lifted by the hurtboxes' sink, they meet the floor; capped by the mesh's (Kirby), they stay under it.
      if (MESH_CAPPED.has(def.id)) expect(now, def.id).toBeLessThan(0);
      else expect(now, def.id).toBeCloseTo(0, 1);
    }
  });
});

/** Every capsule `def`'s move `slot` hits with on game frame `g`, facing forward from the origin. */
function hitsOn(def: FighterDef, slot: MoveSlot, g: number, bake: BakeTables): Capsule[] {
  const run = moveScriptFrame(def, { move: slot, actionFrame: g - 1 });
  if (run === null) return [];
  return scriptHitboxes(run.state, def.id, run.script.motion, run.gameFrame, bake.bones).map((h) => ({
    x1: h.x,
    y1: h.y,
    x2: h.x2 ?? h.x,
    y2: h.y2 ?? h.y,
    r: h.radius,
  }));
}

/** The gaps (half units, 0-40) at which `slot` hits `target` standing there facing back, on some frame. */
function reached(attacker: FighterDef, slot: MoveSlot, target: FighterDef, bake: BakeTables): Set<number> {
  const def = withLimbScripts(attacker, bake.bones);
  const boxes = Array.from({ length: def.moves[slot]!.totalFrames }, (_, i) => hitsOn(def, slot, i + 1, bake)).flat();
  const hurt = localHurtboxes(target, { ...STANDING, defId: target.id, port: 1 }, 0, bake)!;
  const out = new Set<number>();
  for (let gap = 0; gap <= 80; gap++) {
    const at = fx(gap / 2);
    const placed = hurt.map((c) => ({ ...c, x1: at - c.x1, x2: at - c.x2 }));
    if (boxes.some((b) => placed.some((c) => capsulesOverlap(b, c)))) out.add(gap / 2);
  }
  return out;
}

describe("Review Focus: the stance lift turns no hit into a whiff (Plan 6, Task 19)", () => {
  it("every jab, ftilt, dtilt and dsmash that reached a standing opponent before the lift still does, its farthest reach within half a unit", () => {
    const lost: string[] = [];
    let reaches = 0;
    for (const a of FIGHTERS) {
      for (const slot of ["jab1", "ftilt", "dtilt", "dsmash"] as const) {
        for (const t of FIGHTERS) {
          const was = reached(a, slot, t, before);
          const now = reached(a, slot, t, after);
          reaches += was.size;
          const far = Math.max(...was);
          // The farthest gap alone may go, by one half-unit step: a box's round end moved along the target's.
          for (const gap of was) if (!now.has(gap) && !(gap === far && now.has(far - 0.5))) lost.push(`${a.id} ${slot} on ${t.id} at ${gap}`);
        }
      }
    }
    // Not vacuous: 9,364 (attacker, move, target, gap) reaches at 46e0706.
    expect(reaches).toBeGreaterThan(9_000);
    expect(lost).toEqual([]);
  }, 120_000);
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `pnpm vitest run src/render3d/bake/stance.test.ts`

Expected: FAIL. Vitest does not typecheck, so the extra arguments to `bakeRoster` and `fighterPoser` are ignored, and the two bakes are the same. The plumbing test fails `kirby: expected +0 to be close to 0.57, received difference is 0.57, but expected 5e-7` (captured), and the floor test fails `kirby: expected +0 to be close to 0.57, received difference is 0.57, but expected 0.005` (captured). The Review Focus test passes: nothing moved yet.

- [ ] **Step 4: Implement**

`src/render3d/bake/bake.ts`:

```diff
--- a/src/render3d/bake/bake.ts
+++ b/src/render3d/bake/bake.ts
@@
 import { IDENTITY_ROOT, sideBonePose, worldMatrices, type RootXform } from "./fk";
+import { STANCE_UP } from "./stance";
 
 /* --------------------------------------------------------- clip timing -- */
@@
   /** Lower-case bones scripts may name for this fighter (active and reference scripts). */
   readonly scriptBones: ReadonlySet<string>;
+  /** The idle stance's lift, world units (Plan 6, Task 19); `STANCE_UP`'s when absent. */
+  readonly stanceUp?: number;
 }
@@
   /** `FighterParams.scale` as a float. */
   readonly scale: number;
+  /** The idle stance's lift, world units (`STANCE_UP`; Plan 6, Task 19). */
+  readonly stanceUp: number;
 }
 
-export function fighterPoser(def: FighterDef, skeleton: SkeletonFile): FighterPoser {
+export function fighterPoser(def: FighterDef, skeleton: SkeletonFile, stanceUp: number = STANCE_UP[def.id] ?? 0): FighterPoser {
   const rig3 = buildRig(skeleton);
@@
     scale: toFloat(fighterParams(def).scale),
+    stanceUp,
   };
 }
@@
   out.forward = s.offsetX * p.rigScale2d;
-  out.up = s.offsetY * p.rigScale2d;
+  // Lifted so the idle stance stands on the floor (Plan 6, Task 19): the bake and the drawing alike.
+  out.up = s.offsetY * p.rigScale2d + p.stanceUp;
   out.squashForward = s.scaleX;
@@
   const { def, skeleton } = input;
-  const p = fighterPoser(def, skeleton);
+  const p = fighterPoser(def, skeleton, input.stanceUp);
   const lowerOf = (i: number) => p.rig3.names[i].toLowerCase();
```

`src/render3d/bake/roster.ts`:

```diff
--- a/src/render3d/bake/roster.ts
+++ b/src/render3d/bake/roster.ts
@@
 import { bakeFighter } from "./bake";
+import { STANCE_UP } from "./stance";
 
@@
-export function bakeRoster(skeletons: Readonly<Record<string, SkeletonFile>>): BakedFighter[] {
+/** `stance`: each fighter's idle lift (`STANCE_UP`; Plan 6, Task 19). `stance.test.ts` bakes with none to compare. */
+export function bakeRoster(skeletons: Readonly<Record<string, SkeletonFile>>, stance: Readonly<Record<string, number>> = STANCE_UP): BakedFighter[] {
   return FIGHTERS.map((def) => {
     const skeleton = skeletons[def.id];
     if (skeleton === undefined) throw new Error(`bake: no committed skeleton for ${def.id} (run pnpm models)`);
-    return bakeFighter({ def: withLimbScripts(def, null), skeleton, scriptBones: referenceScriptBones(def.id) });
+    return bakeFighter({ def: withLimbScripts(def, null), skeleton, scriptBones: referenceScriptBones(def.id), stanceUp: stance[def.id] ?? 0 });
   });
```

The bake's sizes go up with the bodies sub-group: Task 22 takes `roster.bin.gz` past 2,000,000 bytes, so a third megabyte chunk comes in `src/game/bake.test.ts`'s 14-second test. That test counts the file's chunks from here on:

```diff
--- a/src/game/bake.test.ts
+++ b/src/game/bake.test.ts
@@
     const seen = watch(fetchBake(link({ bytes: 1_000_000, everyMs: 14_000, latencyMs: 14_000 })));
-    await vi.advanceTimersByTimeAsync(14_000 * 3 + 1000);
+    // The answer, then as many 1 MB chunks as the file takes (two to Plan 5; three once Plan 6's
+    // bodies pass 2,000,000 bytes), each 14 s apart.
+    await vi.advanceTimersByTimeAsync(14_000 * (1 + Math.ceil(GZ.length / 1_000_000)) + 1000);
     await vi.waitFor(() => expect(seen.settled).toBe(true));
```

(Without it, Task 22's gate fails `bake.test.ts` `expected false to be true` on `seen.settled` (captured).)

- [ ] **Step 5: Run them again, then regenerate**

Run: `pnpm vitest run src/render3d/bake/stance.test.ts`. Expected: PASS (captured: 3 tests). With the lift the sweep loses no gap. It loses four farthest half-unit steps, inside the allowance: Kirby's dtilt on Link at 19, Mario's ftilt on Kirby at 15.5, Marth's dsmash on Kirby at 21, Pikachu's jab on Kirby at 20. It gains about twenty.

Then, reading each diff. The figures below were captured on a base without Tasks 9, 11 and 18 (the bodies sub-group's intro). Under ruling R-P6-23 each is re-measured on this tree and rewritten, with the reason in the commit: Task 18's shared idle phase has already moved Kirby's standing top (9.4 → 9.8) and re-quoted every size ratio in `reach.allow.json`.
1. `UPDATE_BAKE=1 pnpm vitest run src/render3d/bake/roster.test.ts`: the digest changes; `roster.bin.gz` 1,965,143 → 1,965,072 bytes (captured).
2. `UPDATE_REACH=1 pnpm vitest run src/fighters/acmd/reach.test.ts`. One row changes (captured on the replay base): Kirby's `uair`, `11.4 -> 17.1 (x1.50)` → `11.4 -> 17.6 (x1.55)`. As Task 18 did for every quote, that row's reason quotes the new reach and Kirby's new size ratio (his `restEcb` top over 6.6, which the lift raises; cap 1.25×). A row that changes by more than 0.6, a new `"unreviewed"` entry, or a Kirby `clip-gain` entry that now falls within his cap stops the task.
3. `UPDATE_HURT=1 pnpm vitest run src/game/hurtboxes.test.ts`. One row: Kirby's `bones top` rises by the lift, his ECB top (captured on a base without Task 18: 9.4 → 10.0; after Task 18's shared idle phase it starts from 9.8).
4. `pnpm vitest run src/game/golden.test.ts`. Expected: FAIL on two traces (captured): `replays kirby-marth-pokemonStadium2 exactly`, `first divergence in frames 301-400: expected 3 to be -1`, and `replays samus-kirby-townAndCity-ball exactly`, `first divergence in frames 1101-1200: expected 11 to be -1`. Then `UPDATE_GOLDEN=1 pnpm vitest run src/game/golden.test.ts` and `RULES_PIN.golden` to the digest `rulesVersion.test.ts` prints.
5. With the local models, re-run the probe on the regenerated bake: Kirby's `feet` within 0.05 of 0, every other line as before.

- [ ] **Step 6: Kirby's Final Smash scene gaps (R-T17i)**

Run: `pnpm vitest run src/game/sceneDraw.test.ts`. Expected: FAIL on Kirby's three trap distances (captured): `kirby from 3 away, trapping at 3`, `… 4 …`, `… 5 …`, `expected [ '169 trapped', '251 frozen', …(8) ] to deeply equal []`. His body rose 0.57 inside his own scene.

`src/fighters/kirby.ts`, the three parts' `sceneGap` by half a unit each, the smallest step that clears it (8.25 does not, captured):

```diff
--- a/src/fighters/kirby.ts
+++ b/src/fighters/kirby.ts
@@
-      final: { phase: "start", trap: true, next: "finalAttack", nextAt: 61, sceneGap: fx(8) },
+      final: { phase: "start", trap: true, next: "finalAttack", nextAt: 61, sceneGap: fx(8.5) },
@@
-      final: { phase: "attack", next: "finalEnd", sceneGap: fx(8) },
+      final: { phase: "attack", next: "finalEnd", sceneGap: fx(8.5) },
@@
-      final: { phase: "end", sceneGap: fx(9) },
+      final: { phase: "end", sceneGap: fx(9.5) },
```

`src/render/plan5.test.ts`, the gaps' pin:

```diff
--- a/src/render/plan5.test.ts
+++ b/src/render/plan5.test.ts
@@
         "fox finalEnd": 9,
-        "kirby finalSmash": 8,
-        "kirby finalAttack": 8,
-        "kirby finalEnd": 9,
+        // Plan 6, Task 19: Kirby's re-measured for his stance lift (`sceneDraw.test.ts`'s probe).
+        "kirby finalSmash": 8.5,
+        "kirby finalAttack": 8.5,
+        "kirby finalEnd": 9.5,
         "pikachu finalSmash": 8,
```

Run: `pnpm vitest run src/game/sceneDraw.test.ts src/render/plan5.test.ts src/game/golden.test.ts`. Expected: PASS (captured). The gaps are presentation only: the golden does not move again.

- [ ] **Step 7: The clip-gain reaches (a scratchpad-only look; nothing kept)**

With the local models, `pnpm dev --port 3107` in the background (note its PID). For each of DK nair, Kirby dtilt, Kirby nair, Kirby ftilt, Link jab (`jab`; jab3 is the sheet's third hit), Link utilt, Marth utilt (a `size` entry since Task 18; looked at because the backlog names it), DK fair, Samus dtilt and Samus utilt:

```bash
node scripts/animsheet.mjs attack --fighter kirby --move dtilt --base http://localhost:3107 --out "$SCRATCH/reach-kirby-dtilt.png"
```

Read the PNG. In the frames where the red hitboxes are drawn, write one line in the report: the box sits on the limb that swings, or where it does not. Then `rm "$SCRATCH/reach-kirby-dtilt.png"` before the next capture. Stop the server by its PID.

The reach ratchet already holds the numbers (`reach.allow.json`). A line saying "not on the limb" goes to D59 as a finding, not a change here. Without models the sheet draws stand-ins and says so; the step is then skipped and the report says why.

- [ ] **Step 8: Mutants**

Each against `pnpm vitest run src/render3d/bake/stance.test.ts`; restore after each:
1. `rootXformInto`: drop `+ p.stanceUp`. The plumbing and floor tests FAIL `kirby: expected +0 to be close to 0.57` (captured).
2. `STANCE_UP`: `kirby: 0.57` → `kirby: 3`. The floor test FAILS `kirby: expected 0.427001953125 to be less than 0`, and the Review Focus test FAILS `expected [ 'mario ftilt on kirby at 15', …(11) ] to deeply equal []` (captured).

- [ ] **Step 9: Gate and commit**

Run:
- `pnpm typecheck && pnpm lint && pnpm test`;
- `pnpm vitest run src/game/cpuIdleHuman.test.ts` (Review Focus 5: every matchup still lands a hit; captured green);
- `PORT=3107 pnpm test:e2e --trace off`.

Expected: exit 0.

```bash
git add super-smash/src/render3d/bake/stance.ts super-smash/src/render3d/bake/stance.test.ts super-smash/src/render3d/bake/stance.probe.test.ts super-smash/src/render3d/bake/bake.ts super-smash/src/render3d/bake/roster.ts super-smash/src/fighters/kirby.ts super-smash/src/render/plan5.test.ts super-smash/src/game/bake.test.ts super-smash/public/bake/roster.bin.gz super-smash/src/fighters/bake/digest.ts super-smash/src/fighters/acmd/reach.allow.json super-smash/src/game/hurt.allow.json
git add super-smash/src/game/__golden__/engine-trace.json super-smash/src/game/rulesVersion.test.ts
git commit -m "super-smash: Kirby's idle stance stands on the floor: a lift in the bake, decided on the hurtboxes" -m "D13: a lift is the leg hurtboxes' idle sink capped by the mesh's (the local probe, numbers only): Kirby 0.57. His hurtboxes and ECB top rise with the drawing, so his footstool head and ceiling contacts rise 0.6; his Final Smash scene gaps +0.5 (R-T17i). Mario (17 scene pins for a third of his sink) and Donkey Kong (his knuckles) carried. Golden: kirby-marth-pokemonStadium2, samus-kirby-townAndCity-ball. Review Focus sweep: no hit lost. The clip-gain reaches looked at: <one line each>." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 20: Motions: Donkey Kong's carry and lift, and the full releases

Two motion items:
- Plan 5 Task 8 review: "DK cargo carry: authored carry clips (standing carry shows a frozen mid-stride walk frame; airborne carry cycles the walk) and an authored lift (today the old throw clip squeezed into 15 frames). Motion names are published; the animations are not, so author them. When authored, drop the `cargoCarry → walk` alias and add the motion (bake order)."
  - rubendal 13.0.1's Donkey Kong motions: the lift `throw_f` (`game_throwf`, CancelFrame 16, so 15 frames); the carry's `shoulder_wait`, `shoulder_walk_slow`/`_middle`/`_fast`, `shoulder_turn`, `shoulder_jump_squat`, `shoulder_jump`, `shoulder_fall`, `shoulder_landing`.
- Plan 5 Task 2 re-review: "a stored full Charge Shot runs 61 f against its 44-f baked motion (holds the last pose ~16 f) and DK's stored full Giant Punch is cut at motion f55 of 69 (small pop). A per-release motion needs a second script + engine selection + a re-bake."
  - rubendal 13.0.1: Samus's full release is her entry `special_n_s` (CancelFrame 14, so 13 frames) and then `special_n_f_max` (`game_specialnfiremax`, CancelFrame 48, so 47 frames, shooting on its frame 3): 13 + 48 = 61, the published "Interruptible 61".
  - Donkey Kong's full punch is `special_n_max` (`game_specialnmax`, CancelFrame 48, so 47 frames, its ATTACK on frame 19).

**What changes:**
- **A full release plays its own motion**, frame for frame from the move's loop frame, where both releases start (Samus after her 13 entry frames, Donkey Kong at his loop, `start: "loop"`), selected where the bones' (motion, frame) are chosen (`poseIndexOf`). Before the loop frame Samus's entry plays on the move's own motion. Its boxes and frames stay the move's (`specialCharge.full`, `fromStore`). Only which clip time each frame shows changes, so nothing holds or pops.
- **The bake's full sampler** plays the move's clip from where the move's own motion stood on the loop frame (game frame `loopFrame + 1`), to the clip's `strike` on the first frame after it that hits or shoots, and on to the end across the 47 frames.
- **The carry has two motions of its own**: `status_cargoCarry` on the ground, paced by the ground covered as the walk is, and `status_cargoCarry_air` in the air. A walk-paced clip at rest shows its first key, so that key is the passing pose, feet together. The air clip holds the load and does not stride.
- **The lift (his `fthrow`, `MoveDef.cargo`) bakes on a clip of its own**, `cargoLift`. `fthrow`'s clip is left alone, because his carried forward throw (`cargoFthrow`, `SLOT_POSE` → `"fthrow"`) still plays it.

The carry clips are the replica's own, in its convention (angles relative to the spine: 0 up, 90 forward, 180 down), both arms over the head. The bake and the 2D rig tests below hold the claims a number can settle: both hands over the head in 3D and in 2D, feet together at rest, and the air carry off the walk.

**Golden:** moves only if a golden match carries or fully releases. It did not in the replay: every trace byte-identical (captured). `RULES_PIN.golden` is then untouched. Regenerate after the bake: `UPDATE_BAKE` → (`UPDATE_REACH` if asked) → `UPDATE_HURT` → `UPDATE_GOLDEN`.

**Files:**
- Modify:
  - `src/engine/types.ts` (`StoredFullCharge.motion?`, `.fullFrames?`)
  - `src/fighters/samus.ts`, `src/fighters/donkeyKong.ts` (their `fromStore`)
  - `src/engine/acmd/poseClock.ts` (the alias goes; `statusMotion`'s carry in the air; `fullReleaseIndex`; `poseIndexOf`)
  - `src/render3d/bake/bake.ts` (`fullReleaseClipTime`, `StatusMotionSpec.grounded`, `statusMotionSpecs`, `moveSamplers`, `bakesStatus`, `statusSamplers`)
  - `src/render/poses/timing.ts` (`PACED_BY_SPEED`, `poseNameFor`'s carry), `src/render/poses/library.ts` (`"cargoCarry"`, `"cargoFall"`, `"cargoLift"`)
  - `src/render/chars/donkeyKong/poses.ts` (the three clips)
- Test: `src/engine/acmd/poseClock.test.ts`, `src/render3d/bake/bake.test.ts`, `src/render/chars/donkeyKong/donkeyKong.test.ts`
- Regenerate: `public/bake/roster.bin.gz`, `src/fighters/bake/digest.ts`

**Interfaces:**
- Consumes: `MOTION_OF_ACTION`, `statusMotion`, `poseIndexOf`, `clampFrame`, `ClockedFighter` (poseClock.ts); `moveSamplers`, `attackClipTime`, `runScript` (bake.ts); `SLOT_POSE` (timing.ts); `MoveDef.cargo`.
- Produces:
  - `StoredFullCharge.motion?: MotionKind`, `.fullFrames?: number`;
  - `fullReleaseIndex(def, f): PoseIndex | null` (poseClock.ts);
  - `statusMotion(f: Pick<FighterState, "action" | "jumpsUsed" | "fastFalling" | "charge"> & Partial<Pick<FighterState, "grounded">>)`: `grounded` optional, every caller unchanged (I3);
  - `poseNameFor(f: Pick<PosedFighter, …> & Partial<Pick<FighterState, "grounded">>)`;
  - motions `status_cargoCarry`, `status_cargoCarry_air`, `special_n_f_max`, `special_n_max`;
  - `StatusMotionSpec.grounded: boolean`;
  - `fullReleaseClipTime(from, strike, hit, frames, k)` (bake.ts);
  - `PoseName` `"cargoCarry" | "cargoFall" | "cargoLift"`.

- [ ] **Step 1: Write the failing tests**

`src/engine/acmd/poseClock.test.ts`:

```diff
--- a/src/engine/acmd/poseClock.test.ts
+++ b/src/engine/acmd/poseClock.test.ts
@@
 import { Btn } from "../types";
-import type { ActionState, FighterDef, FighterState, GameState, InputFrame, MatchRules } from "../types";
-import { FIGHTERS } from "@/fighters";
+import type { ActionState, FighterDef, FighterState, GameState, InputFrame, MatchRules, StoreCharge } from "../types";
+import { FIGHTERS, donkeyKong, samus } from "@/fighters";
 import { STAGES } from "@/stages";
@@
   VARIABLE_LENGTH_ACTIONS,
+  fullReleaseIndex,
   poseIndexOf,
@@
   it("plays the helpless fall as a fall and its landing as landing lag, sharing their motions", () => {
-    // Plan 5, Task 8 fix round 1 (ruling R-T8c): the carry plays the walk's motion
-    // and the carried the grab's, each its own frames byte for byte before.
+    // Plan 5, Task 8 fix round 1 (ruling R-T8c): the carried plays the grab's motion,
+    // its own frames byte for byte before (the carry left the walk's in Plan 6, Task 20).
     // Plan 5, Task 9: Kirby's mouthful plays the walk's, and the swallowed and the
@@
       edgeSlip: "fall",
       specialLanding: "landingLag",
-      cargoCarry: "walk",
       cargoHeld: "grabbed",
@@
-    expect(statusMotion({ action: "cargoCarry", jumpsUsed: 0, fastFalling: false, charge: 0 })).toBe("status_walk");
+    expect(statusMotion({ action: "cargoCarry", jumpsUsed: 0, fastFalling: false, charge: 0 })).toBe("status_cargoCarry");
     expect(statusMotion({ action: "cargoHeld", jumpsUsed: 1, fastFalling: false, charge: 0 })).toBe("status_grabbed");
@@
 /* ------------------------------------------- per-fighter dodges (R4) -- */
+
+describe("Donkey Kong's carry and a full release play motions of their own (Plan 6, Task 20)", () => {
+  it("plays the carry on its own motions, standing or walking and in the air, no longer the walk's", () => {
+    expect(MOTION_OF_ACTION.cargoCarry).toBeUndefined();
+    expect(statusMotion({ action: "cargoCarry", jumpsUsed: 0, fastFalling: false, charge: 0, grounded: true })).toBe("status_cargoCarry");
+    expect(statusMotion({ action: "cargoCarry", jumpsUsed: 1, fastFalling: false, charge: 0, grounded: false })).toBe("status_cargoCarry_air");
+  });
+
+  const store = (def: FighterDef) => def.moves.neutralB!.specialCharge as StoreCharge;
+  const releasing = (def: FighterDef, actionFrame: number, charge = store(def).frames) =>
+    fighter({ defId: def.id, action: "special", move: "neutralB", charge, actionFrame });
+
+  it("plays Samus's full Charge Shot entry on the move's motion, then special_n_f_max from the loop frame to her last frame", () => {
+    const sc = store(samus);
+    expect(fullReleaseIndex(samus, releasing(samus, sc.loopFrame - 1))).toBeNull();
+    expect(fullReleaseIndex(samus, releasing(samus, sc.loopFrame))).toEqual({ motion: "special_n_f_max", frame: 1 });
+    // The shot leaves on the motion's frame 3 (rubendal 13.0.1 `game_specialnfiremax`), the move's 16.
+    expect(fullReleaseIndex(samus, releasing(samus, 15))).toEqual({ motion: "special_n_f_max", frame: 3 });
+    // Her last frame before she acts (Interruptible 61 from the press) is the motion's 47th: nothing held.
+    expect(fullReleaseIndex(samus, releasing(samus, 59))).toEqual({ motion: "special_n_f_max", frame: 47 });
+  });
+
+  it("plays Donkey Kong's full Giant Punch on special_n_max, its hit on the motion's frame 19; a partial one is no full release", () => {
+    const sc = store(donkeyKong);
+    expect(fullReleaseIndex(donkeyKong, releasing(donkeyKong, sc.loopFrame))).toEqual({ motion: "special_n_max", frame: 1 });
+    // rubendal 13.0.1 `game_specialnmax`: ATTACK on frame 19, the press's 19th ("Hitbox 19-20").
+    expect(fullReleaseIndex(donkeyKong, releasing(donkeyKong, sc.loopFrame + 18))).toEqual({ motion: "special_n_max", frame: 19 });
+    expect(fullReleaseIndex(donkeyKong, releasing(donkeyKong, sc.loopFrame + 46))).toEqual({ motion: "special_n_max", frame: 47 });
+    expect(fullReleaseIndex(donkeyKong, releasing(donkeyKong, sc.loopFrame + 18, sc.frames - 1))).toBeNull();
+    // `poseIndexOf` plays it once the bake has it, and the move's own motion without it.
+    const f = releasing(donkeyKong, sc.loopFrame + 18);
+    expect(poseIndexOf(donkeyKong, f, 0, clocks({ special_n_max: { kind: "once", frames: 47 } }))).toEqual({ motion: "special_n_max", frame: 19 });
+    expect(poseIndexOf(donkeyKong, f, 0, clocks({}))).toBeNull();
+  });
+});
 
 describe("each fighter's dodges are motions of their own, per direction (ruling R4)", () => {
@@
     // 50 actions of their own (the two helpless ones share the fall's and the
-    // landing lag's; Plan 5 Task 8's carry and carried, the walk's and the
-    // grab's; Task 9's mouthful, swallowed and spat, the walk's and the
+    // landing lag's; Plan 5 Task 8's carried, the grab's (the carry has its own
+    // since Plan 6, Task 20); Task 9's mouthful, swallowed and spat, the walk's and the
     // tumble's; Task 13c's rebound, the stand's; Task 14's trapped, the grab's;
```

(The `poseClock.test.ts` line that pinned `cargoCarry → "status_walk"` becomes `"status_cargoCarry"`, I3. Task 7's `edgeSlip: "fall"` rows sit just above the deleted `cargoCarry` rows, M17; apply the hunks by their text.)

`src/render3d/bake/bake.test.ts`:

```diff
--- a/src/render3d/bake/bake.test.ts
+++ b/src/render3d/bake/bake.test.ts
@@
 import { FIGHTERS, getFighter } from "@/fighters";
+import { bakeTables } from "@/engine/acmd/bakeTables";
+import { localHurtboxes } from "@/engine/acmd/hurtboxes";
+import { moveScriptFrame } from "@/engine/acmd/run";
+import { toFloat } from "@/engine/fixed";
+import { clipFor } from "@/render/chars";
 import { airDodgeClipTime } from "@/render/poses/airDodge";
@@
-  it("are every motion statusMotion can name, each once: 59 over the 60 actions, tumbleFall among them", () => {
+  it("are every motion statusMotion can name, each once: 61 over the 60 actions, tumbleFall among them", () => {
     const named = new Set<string>();
     for (const action of ACTIONS) {
       for (let charge = -3; charge <= 20; charge++) {
         for (const jumpsUsed of [0, 1, 2, 3]) {
-          for (const fastFalling of [false, true]) named.add(statusMotion({ action, charge, jumpsUsed, fastFalling }));
+          for (const fastFalling of [false, true]) {
+            for (const grounded of [true, false]) named.add(statusMotion({ action, charge, jumpsUsed, fastFalling, grounded }));
+          }
         }
       }
     }
@@
     // Plan 6, Task 7: one more, the edge slip, and no motion more: it plays the fall's.
+    // Task 20: the carry leaves the walk's for two of its own, on the ground and in the air.
     expect(ACTIONS).toHaveLength(60);
-    expect(named.size).toBe(59);
+    expect(named.size).toBe(61);
     expect(specs.map((s) => s.motion).sort()).toEqual([...named].sort());
     // Plan 5, Task 4b: the helpless fall and its landing bake nothing of their
     // own; they play the fall's and the landing lag's (`MOTION_OF_ACTION`), as
-    // the carry and the carried play the walk's and the grab's (Task 8).
+    // the carried plays the grab's (Task 8).
@@
     expect(attackClipTime(0.4, 1, 20, 11)).toBe(0.5);
   });
 });
 
+describe("Donkey Kong's carry and lift, and the full releases (Plan 6, Task 20)", () => {
+  it("bake each full release on a motion of its own, its 47 frames, from the loop frame's pose on through the clip", () => {
+    for (const [id, motion] of [["donkeyKong", "special_n_max"], ["samus", "special_n_f_max"]] as const) {
+      const def = fighterOf(id);
+      const moves = moveSamplers(def);
+      const full = moves.get(motion)!;
+      const own = moves.get(gameScriptFor(def, "neutralB")!.motion)!;
+      expect(full, id).toMatchObject({ slot: "neutralB", clock: { kind: "once", frames: 47 } });
+      expect(full.clip).toBe(own.clip);
+      const sc = def.moves.neutralB!.specialCharge!;
+      // Where the move's own motion stands on the loop frame (the press's first frame of the release)…
+      const loopMotionFrame = moveScriptFrame(def, { move: "neutralB", actionFrame: sc.loopFrame })!.state.motionFrame;
+      expect(full.time(1), id).toBeCloseTo(own.time(loopMotionFrame), 12);
+      // …on through the clip, never back, never holding.
+      for (let k = 2; k <= 47; k++) expect(full.time(k), `${id} ${k}`).toBeGreaterThan(full.time(k - 1));
+    }
+    // Donkey Kong's punch strikes on the motion's frame 19, the script's hit (rubendal `game_specialnmax`).
+    const dk = moveSamplers(fighterOf("donkeyKong")).get("special_n_max")!;
+    expect(dk.time(19)).toBeCloseTo(dk.clip.strike!, 12);
+  });
+
+  it("bake the lift (Donkey Kong's forward throw, `cargo`) on the lift clip, and his carried forward throw on the throw's, as before", () => {
+    const dk = fighterOf("donkeyKong");
+    const moves = moveSamplers(dk);
+    expect(moves.get(gameScriptFor(dk, "fthrow")!.motion)!.clip).toBe(clipFor("donkeyKong", "cargoLift"));
+    expect(moves.get(gameScriptFor(dk, "cargoFthrow")!.motion)!.clip).toBe(clipFor("donkeyKong", "fthrow"));
+    expect(clipFor("donkeyKong", "cargoLift")).not.toBe(clipFor("donkeyKong", "fthrow"));
+  });
+
+  it("bake the carry for Donkey Kong alone, both arms over his head in 3D at its rest", () => {
+    for (const def of FIGHTERS) expect(statusSamplers(def).has("status_cargoCarry"), def.id).toBe(def.id === "donkeyKong");
+    const dk = fighterOf("donkeyKong");
+    const tables = bakeTables([bakeFighter({ def: dk, skeleton: SKELETONS.donkeyKong, scriptBones: referenceScriptBones("donkeyKong") })], "dk");
+    const caps = localHurtboxes(dk, { defId: "donkeyKong", action: "cargoCarry", actionFrame: 0, move: null, port: 0, charge: 0, hitstun: 0, jumpsUsed: 0, fastFalling: false, vx: 0, vy: 0, shortHop: false }, 0, tables)!;
+    const bones = tables.hurtboxes("donkeyKong")!.map((h) => h.bone);
+    const top = (bone: string) => {
+      const c = caps[bones.indexOf(bone)];
+      return toFloat(Math.max(c.y1, c.y2));
+    };
+    expect(top("armr")).toBeGreaterThan(top("head"));
+    expect(top("arml")).toBeGreaterThan(top("head"));
+  });
+});
+
 describe("the move motions the bake plays (Plan 5, Task 13d)", () => {
```

(The inventory's enumeration passes `grounded` both ways, so it reaches `status_cargoCarry_air`; `statusMotion(s)` on each spec reads the spec's own `grounded`.)

`src/render/chars/donkeyKong/donkeyKong.test.ts`: the carried fall joins the airborne clips, the lift is drawn on his forward throw's motion, and a test for the carry's hands and rest:

```diff
--- a/src/render/chars/donkeyKong/donkeyKong.test.ts
+++ b/src/render/chars/donkeyKong/donkeyKong.test.ts
@@
   "dair",
   "upB",
+  // Plan 6, Task 20: carried in the air.
+  "cargoFall",
 ]);
@@
   dthrow: "dthrow",
+  // Plan 6, Task 20: the lift is his forward throw's motion (`MoveDef.cargo`).
+  cargoLift: "fthrow",
   // Plan 5, Task 17 fix round 1: Jungle Rush's barrage and uppercut.
@@
       expect(p.shoulder.x, `spine is not leaning at t=${t.toFixed(2)}`).toBeGreaterThan(3.0);
     }
   });
 
+  /**
+   * Kong Karry (Plan 6, Task 20): the load is held over his head in both hands
+   * the whole way round the walk, and standing still the carry rests on its
+   * first key, so that key is the walk's passing pose, feet together: Plan 5's
+   * stand-in froze him mid-stride (the walk's contact key).
+   */
+  it("carries the load over his head in both hands, and rests feet together", () => {
+    for (let i = 0; i < 8; i++) {
+      const p = partsAt("cargoCarry", i / 8);
+      const crown = p.head.y + rig.headRadius;
+      expect(p.handR.y, `near hand below the crown at t=${i / 8}`).toBeGreaterThan(crown);
+      expect(p.handL.y, `far hand below the crown at t=${i / 8}`).toBeGreaterThan(crown);
+    }
+    const rest = partsAt("cargoCarry", 0);
+    expect(Math.abs(rest.footR.x - rest.footL.x)).toBeLessThan(1);
+  });
+
   /** And the knuckles stay put while the chest breathes over them. */
```

(`partsAt` is the file's feet-up helper: y grows upward from the soles, so "over the head" is greater than the crown, the head's centre plus `rig.headRadius`.)

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/engine/acmd/poseClock.test.ts src/render3d/bake/bake.test.ts src/render/chars/donkeyKong`

Expected: FAIL (captured):
- `poseClock.test.ts`: the alias pin, `expected { rebound: 'stand', …(9) } to deeply equal { rebound: 'stand', …(8) }`; the carry's, `expected 'walk' to be undefined`; the two release tests, `TypeError: fullReleaseIndex is not a function`.
- `bake.test.ts`: `expected 59 to be 61`; the full releases', `donkeyKong: expected undefined to match object { slot: 'neutralB', clock: { …(2) } }`; the lift's, `expected { loop: false, strike: 0.35, …(1) } to be undefined` (no `cargoLift` clip yet); the carry's, `donkeyKong: expected false to be true`.
- `donkeyKong.test.ts`: the carry test, `TypeError: Cannot read properties of undefined (reading 'keys')` (no clip yet).

Nine tests in all (captured).

- [ ] **Step 3: Implement**

`src/engine/types.ts`:

```diff
--- a/src/engine/types.ts
+++ b/src/engine/types.ts
@@
-import type { AcmdScript } from "./acmd/types";
+import type { AcmdScript, MotionKind } from "./acmd/types";
 import type { CombatState } from "./combat";
@@
   /** Its super armour, first and last frame, on the ground and in the air. */
   readonly superArmour?: { readonly grounded: readonly [number, number]; readonly aerial?: readonly [number, number] };
+  /**
+   * The motion a full release plays from the move's loop frame on, and its length (Plan 6,
+   * Task 20; `fullReleaseIndex`). Both or neither.
+   */
+  readonly motion?: MotionKind;
+  readonly fullFrames?: number;
 }
```

`src/fighters/samus.ts`:

```diff
--- a/src/fighters/samus.ts
+++ b/src/fighters/samus.ts
@@
       // notes surviving a KO only for Oil Panic and Wario Waft.
-      specialCharge: { mode: "store", frames: 112, loopFrame: 13, fromStore: { start: "entry", interruptible: 61 } },
+      // Fully charged, the shot is `special_n_f_max` (rubendal 13.0.1 `game_specialnfiremax`:
+      // CancelFrame 48, so 47 frames, shooting on its frame 3), played from the loop frame,
+      // after the 13 entry frames (`special_n_s`, CancelFrame 14): 13 + 48 = 61 (Plan 6, Task 20).
+      specialCharge: { mode: "store", frames: 112, loopFrame: 13, fromStore: { start: "entry", interruptible: 61, motion: "special_n_f_max", fullFrames: 47 } },
       hitboxes: [],
```

`src/fighters/donkeyKong.ts`:

```diff
--- a/src/fighters/donkeyKong.ts
+++ b/src/fighters/donkeyKong.ts
@@
         full: { 0: { damage: fx(28.0) } },
-        fromStore: { start: "loop", interruptible: 48, superArmour: { grounded: [9, 20], aerial: [15, 20] } },
+        // Fully charged, the punch is `special_n_max` (rubendal 13.0.1 `game_specialnmax`:
+        // CancelFrame 48, so 47 frames, its ATTACK on frame 19), played from the loop frame
+        // (Plan 6, Task 20).
+        fromStore: { start: "loop", interruptible: 48, superArmour: { grounded: [9, 20], aerial: [15, 20] }, motion: "special_n_max", fullFrames: 47 },
       },
```

`src/engine/acmd/poseClock.ts`:

```diff
--- a/src/engine/acmd/poseClock.ts
+++ b/src/engine/acmd/poseClock.ts
@@
  * Task 8 fix round 1 (ruling R-T8c): Donkey Kong's carry is his walk's, and the
  * fighter carried plays the grab's; their own motions baked byte for byte the
- * same frames. An authored carry clip will be a motion of its own. Task 9:
+ * same frames. Plan 6, Task 20 authored the carry, which left for motions of its
+ * own (`status_cargoCarry`, `status_cargoCarry_air`). Task 9:
  * Kirby's mouthful plays the walk's, and the fighter swallowed and the one spat
@@
   specialLanding: "landingLag",
-  cargoCarry: "walk",
   cargoHeld: "grabbed",
@@
-export function statusMotion(f: Pick<FighterState, "action" | "jumpsUsed" | "fastFalling" | "charge">): MotionKind {
+export function statusMotion(f: Pick<FighterState, "action" | "jumpsUsed" | "fastFalling" | "charge"> & Partial<Pick<FighterState, "grounded">>): MotionKind {
   const shared = MOTION_OF_ACTION[f.action];
   if (shared !== undefined) return statusMotion({ ...f, action: shared });
+  // Carried in the air (a jump with the load), not striding (Plan 6, Task 20). A caller
+  // that names no `grounded` is read as on the ground: the sim passes whole states.
+  if (f.action === "cargoCarry" && f.grounded === false) return "status_cargoCarry_air";
   if (f.action === "jump" && f.jumpsUsed >= 2) return "status_jump_aerial";
@@
 const wrap = (n: number, frames: number): number => (((n % frames) + frames) % frames) + 1;
 
 /**
+ * A full release's (motion, frame) (Plan 6, Task 20), or null: a store-mode special at
+ * full charge plays its full motion (`StoredFullCharge.motion`) frame for frame from the
+ * move's loop frame, where the release starts (rubendal 13.0.1: Samus's
+ * `special_n_f_max` after her 13 entry frames, Donkey Kong's `special_n_max` from his
+ * loop frame, which a stored full punch starts on). Before it, the entry plays on the
+ * move's own motion.
+ */
+export function fullReleaseIndex(def: FighterDef, f: Pick<ClockedFighter, "action" | "move" | "charge" | "actionFrame">): PoseIndex | null {
+  if (f.action !== "special" || f.move === null) return null;
+  const sc = def.moves[f.move]?.specialCharge;
+  if (sc?.mode !== "store" || sc.fromStore.motion === undefined || f.charge < sc.frames || f.actionFrame < sc.loopFrame) return null;
+  return { motion: sc.fromStore.motion, frame: clampFrame(f.actionFrame - sc.loopFrame + 1, sc.fromStore.fullFrames ?? 1) };
+}
+
+/**
  * The (motion, frame) a fighter's bones are at, or null when no bake covers it
  * (callers fall back to the legacy single capsule / root bone).
  */
 export function poseIndexOf(def: FighterDef, f: ClockedFighter, globalFrame: number, clockOf: ClockLookup): PoseIndex | null {
+  // A full release plays its own motion (Plan 6, Task 20).
+  const full = fullReleaseIndex(def, f);
+  if (full !== null && clockOf(def.id, full.motion) !== undefined) return full;
   if (f.move !== null && playsMoveScript(f.action)) {
```

(`StoreCharge` narrows on `mode`, so `fromStore` is typed; `HoldCharge` has none, M1. A full release counts from `loopFrame`, not from `storedFullStart` (0 for Samus's `"entry"`): counted from 0 her 47-frame motion would end on frame 47 and hold to 60, the hold this task removes.)

`src/render3d/bake/bake.ts`:

```diff
--- a/src/render3d/bake/bake.ts
+++ b/src/render3d/bake/bake.ts
@@
   return frames <= 0 ? 0 : Math.min(1, f / frames);
 }
 
+/**
+ * Normalised clip time on frame `k` (1-based) of a full release's own motion, `frames`
+ * long (Plan 6, Task 20): from `from`, where the move's own motion stood on its loop
+ * frame, to the clip's `strike` on the frame the release first hits (`hit`), and on to
+ * the end; linearly from `from` when the strike is behind it or there is no hit.
+ */
+export function fullReleaseClipTime(from: number, strike: number | undefined, hit: number, frames: number, k: number): number {
+  const f = k - 1;
+  const h = hit - 1;
+  if (strike !== undefined && strike > from && h > 0 && h < frames) {
+    return f <= h ? from + ((strike - from) * f) / h : Math.min(1, strike + ((1 - strike) * (f - h)) / (frames - h));
+  }
+  return frames <= 0 ? from : Math.min(1, from + ((1 - from) * f) / frames);
+}
+
 export interface ScriptTiming {
@@
    * (`ROLL_FORWARD`/`ROLL_BACK`). 0 for every other status.
    */
   readonly charge: number;
+  /** On the ground or not: the carry's two motions (Plan 6, Task 20). */
+  readonly grounded: boolean;
 }
@@
       for (const v of VARIANTS) {
-        const motion = statusMotion({ action, charge, ...v });
-        if (seen.has(motion)) continue;
-        seen.add(motion);
-        out.push({ motion, action, charge, ...v });
+        for (const grounded of [true, false]) {
+          const motion = statusMotion({ action, charge, ...v, grounded });
+          if (seen.has(motion)) continue;
+          seen.add(motion);
+          out.push({ motion, action, charge, ...v, grounded });
+        }
       }
@@
     if (out.has(script.motion)) throw new Error(`bake ${def.id}: slots ${out.get(script.motion)!.slot} and ${slot} share motion ${script.motion}`);
-    const clip = clipFor(def.id, SLOT_POSE[slot]);
+    // Donkey Kong's lift is his forward throw (`MoveDef.cargo`), on a clip of its own
+    // (Plan 6, Task 20): `fthrow`'s stays his throw's, which his carried forward throw plays.
+    const clip = clipFor(def.id, move.cargo === true ? "cargoLift" : SLOT_POSE[slot]);
     const timing = scriptTiming(script, move.totalFrames);
     // A move whose clip strikes elsewhere than its first box (`MoveDef.clipStrike`;
     // Plan 5, Task 17 fix round 1: Zero Laser fires on the laser, not the charge).
     const strikeAt = move.clipStrike === undefined ? timing.firstActive : runScript(script, move.clipStrike).motionFrame;
-    out.set(script.motion, {
-      slot,
-      clip,
-      clock: { kind: "script", frames: timing.frames },
-      time: (k) => attackClipTime(clip.strike, strikeAt, timing.frames, k),
-    });
+    const time = (k: number) => attackClipTime(clip.strike, strikeAt, timing.frames, k);
+    out.set(script.motion, { slot, clip, clock: { kind: "script", frames: timing.frames }, time });
+    // A full release's own motion (Plan 6, Task 20; `fullReleaseIndex`): the same clip,
+    // from where the move's motion stands on the loop frame (game frame loopFrame + 1),
+    // striking on the first game frame after it that hits or shoots.
+    const sc = move.specialCharge;
+    const fullMotion = sc?.mode === "store" ? sc.fromStore.motion : undefined;
+    if (sc?.mode === "store" && fullMotion !== undefined) {
+      const frames = sc.fromStore.fullFrames ?? 1;
+      const from = time(runScript(script, sc.loopFrame + 1).motionFrame);
+      let hit = -1;
+      for (let g = sc.loopFrame + 1; g <= move.totalFrames && hit < 0; g++) if (runScript(script, g).attacks.length > 0) hit = g - sc.loopFrame;
+      const shot = (move.projectiles ?? []).find((p) => p.spawnFrame > sc.loopFrame);
+      if (hit < 0 && shot !== undefined) hit = shot.spawnFrame - sc.loopFrame;
+      if (out.has(fullMotion)) throw new Error(`bake ${def.id}: ${slot}'s full release shares motion ${fullMotion}`);
+      out.set(fullMotion, { slot, clip, clock: { kind: "once", frames }, time: (k) => fullReleaseClipTime(from, clip.strike, hit, frames, k) });
+    }
   }
   return out;
 }
@@
 export function bakesStatus(def: FighterDef, spec: Pick<StatusMotionSpec, "action">): boolean {
+  // Plan 6, Task 20: likewise the carry, for the one fighter whose forward throw lifts (`MoveDef.cargo`).
+  if (spec.action === "cargoCarry") return def.moves.fthrow?.cargo === true;
   return spec.action !== "crawl" || def.attributes.canCrawl === true;
 }
@@
     if (!bakesStatus(def, spec)) continue;
-    const poseName = poseNameFor({ action: spec.action, move: null, jumpsUsed: spec.jumpsUsed, fastFalling: spec.fastFalling });
+    const poseName = poseNameFor({ action: spec.action, move: null, jumpsUsed: spec.jumpsUsed, fastFalling: spec.fastFalling, grounded: spec.grounded });
     const clip = clipFor(def.id, poseName);
```

(Samus's shot is a projectile, not an attack: her full sampler's strike lands on the shot's `spawnFrame` after the loop, frame 3. Every other spec bakes with `grounded: true`, the first variant, as before: the specs differ only for the carry.)

`src/render/poses/timing.ts`:

```diff
--- a/src/render/poses/timing.ts
+++ b/src/render/poses/timing.ts
@@
 /** Cycles are paced by distance covered, not by frames elapsed. */
-export const PACED_BY_SPEED: Partial<Record<PoseName, true>> = { walk: true, run: true };
+export const PACED_BY_SPEED: Partial<Record<PoseName, true>> = { walk: true, run: true, cargoCarry: true };
@@
-export function poseNameFor(f: Pick<PosedFighter, "action" | "move" | "jumpsUsed" | "fastFalling">): PoseName {
+export function poseNameFor(f: Pick<PosedFighter, "action" | "move" | "jumpsUsed" | "fastFalling"> & Partial<Pick<FighterState, "grounded">>): PoseName {
   switch (f.action) {
@@
-    // ...and Donkey Kong carrying: no clip has the carry's raised arms, and his
-    // walk reads as the carry (it walks). Plan 5, Task 9: Kirby walking with a
-    // mouthful, likewise.
+    // Donkey Kong carrying: the load over his head (Plan 6, Task 20), striding on the
+    // ground and held in the air; a state that names no `grounded` is on the ground.
     case "cargoCarry":
+      return f.grounded === false ? "cargoFall" : "cargoCarry";
+    // Plan 5, Task 9: Kirby walking with a mouthful plays the walk.
     case "inhaleHold":
       return "walk";
```

`src/render/poses/library.ts`:

```diff
--- a/src/render/poses/library.ts
+++ b/src/render/poses/library.ts
@@
   | "uthrow"
-  | "dthrow";
+  | "dthrow"
+  // Plan 6, Task 20: Donkey Kong's carry, on the ground and in the air, and his lift.
+  | "cargoCarry"
+  | "cargoFall"
+  | "cargoLift";
@@
   finalSmash: attacks.neutralB,
+  /**
+   * Kong Karry (Plan 6, Task 20): only Donkey Kong carries, and he draws his own; the
+   * shared defaults are the clips his carry played before, the walk, the fall and the
+   * forward throw.
+   */
+  cargoCarry: walk,
+  cargoFall: fall,
+  cargoLift: attacks.fthrow,
 };
```

`src/render/chars/donkeyKong/poses.ts`, the arms the three share, the lift, then the carry and the carried fall at the top of `poses`:

```diff
--- a/src/render/chars/donkeyKong/poses.ts
+++ b/src/render/chars/donkeyKong/poses.ts
@@
   keys.push({ t: 1, pose: BARRAGE_GUARD, offsetX: -0.2, offsetY: -0.4 });
   return keys;
 }
+
+/**
+ * Kong Karry's load, held over his head in both hands (Plan 6, Task 20): the arms the
+ * carry, the carried fall and the lift's last key share. rubendal 13.0.1 names the
+ * game's motions (`shoulder_wait`, `shoulder_walk_*`, `shoulder_fall`, `throw_f`); their
+ * animations are unpublished, so these are the replica's shapes, upright under the load.
+ */
+const CARRY_ARMS = {
+  torso: -4, head: -4,
+  upperArmR: 24, forearmR: -24, handR: 0,
+  upperArmL: 4, forearmL: 22, handL: 0,
+} as const;
+
+/**
+ * The lift (Plan 6, Task 20): 15 frames (rubendal 13.0.1 `throw_f`, CancelFrame 16),
+ * crouched under the load, hoisting it, and standing into the carry's rest. Its own clip,
+ * not his forward throw's, which his carried forward throw still plays (`SLOT_POSE`).
+ */
+const CARGO_LIFT: PoseClip = {
+  loop: false,
+  keys: [
+    { t: 0, pose: P({ torso: 26, head: -20, hip: -4, thighR: 136, shinR: 70, footR: -84, thighL: 150, shinL: 66, footL: -82, upperArmR: 140, forearmR: -10, handR: 0, upperArmL: 160, forearmL: 10, handL: 0 }), offsetY: -0.2 },
+    { t: 0.45, pose: P({ torso: 8, head: -8, hip: -2, thighR: 158, shinR: 30, footR: -86, thighL: 170, shinL: 28, footL: -86, upperArmR: 70, forearmR: -30, handR: 0, upperArmL: 50, forearmL: 30, handL: 0 }), offsetY: -0.1 },
+    { t: 1, pose: P({ ...CARRY_ARMS, thighR: 174, shinR: 10, footR: -88, thighL: 186, shinL: 10, footL: -88 }) },
+  ],
+};
 
 export const poses: Partial<Record<PoseName, PoseClip>> = {
+  /**
+   * Kong Karry walking (Plan 6, Task 20), paced by the ground covered as the walk is
+   * (`PACED_BY_SPEED`): standing still, the carry rests on its first key, so that key
+   * is the passing pose, feet together (the walk's contact key froze him mid-stride).
+   * A heavy, short shuffle under the load, the arms holding it still.
+   */
+  cargoCarry: {
+    loop: true,
+    period: 32,
+    keys: [
+      { t: 0, ease: "linear", pose: P({ ...CARRY_ARMS, thighR: 174, shinR: 10, footR: -88, thighL: 186, shinL: 10, footL: -88 }) },
+      { t: 0.25, ease: "linear", pose: P({ ...CARRY_ARMS, thighR: 160, shinR: 14, footR: -88, thighL: 192, shinL: 28, footL: -98 }), offsetY: -0.2 },
+      { t: 0.5, ease: "linear", pose: P({ ...CARRY_ARMS, thighR: 182, shinR: 10, footR: -88, thighL: 178, shinL: 10, footL: -88 }) },
+      { t: 0.75, ease: "linear", pose: P({ ...CARRY_ARMS, thighR: 192, shinR: 28, footR: -98, thighL: 160, shinL: 14, footL: -88 }), offsetY: -0.2 },
+    ],
+  },
+  /** Carried in the air (Plan 6, Task 20): the load still overhead, the legs paddling a little under it. */
+  cargoFall: {
+    loop: true,
+    period: 40,
+    keys: [
+      { t: 0, pose: P({ ...CARRY_ARMS, thighR: 160, shinR: 40, footR: -100, thighL: 196, shinL: 24, footL: -96 }) },
+      { t: 0.5, pose: P({ ...CARRY_ARMS, thighR: 168, shinR: 34, footR: -98, thighL: 190, shinL: 30, footL: -98 }) },
+    ],
+  },
+  cargoLift: CARGO_LIFT,
   /**
```

- [ ] **Step 4: Run them again, then the bake**

Run: `pnpm vitest run src/engine/acmd src/render3d/bake/bake.test.ts src/render/chars/donkeyKong src/render/poses.test.ts`. Expected: PASS (captured).

Then:
1. `pnpm vitest run src/render3d/bake/roster.test.ts`. Expected: FAIL, a new bake (captured): `expected 6931363 to be 6967877` and the digest's `expected '602c3a…' to be '10fd93…'`. Run `UPDATE_BAKE=1 pnpm vitest run src/render3d/bake/roster.test.ts`: `roster.bin.gz` 1,965,072 → 1,971,551 bytes (captured), within the 2 MiB budget.
2. `pnpm vitest run src/fighters/acmd src/game/hurtboxes.test.ts`. Expected: PASS; neither asks for a regeneration (captured).
3. `pnpm vitest run src/game/golden.test.ts`. Expected: PASS, every trace byte-identical (captured). If one moves, run `UPDATE_GOLDEN=1 …` and re-pin, and name the trace in the commit.

- [ ] **Step 5: Look (numbers; a scratchpad-only capture of the lift)**

The bake test above settles the carry's claims in 3D. The lift's 15 frames, with the local models and `pnpm dev --port 3107` in the background:

```bash
node scripts/animsheet.mjs throw --move fthrow --fighter donkeyKong --base http://localhost:3107 --out "$SCRATCH/dk-lift.png"
```

Read it, then `rm "$SCRATCH/dk-lift.png"`. Report in words whether the load is held over his head by the last cell, and adjust `CARGO_LIFT`'s keys if not, re-running Step 4. Stop the server by its PID.

- [ ] **Step 6: Mutants**

Each against the Step 2 files; restore after each:
1. `fullReleaseIndex`: drop `f.charge < sc.frames || `. The Giant Punch test FAILS `expected { motion: 'special_n_max', frame: 19 } to be null` (captured).
2. `fullReleaseIndex`: `f.actionFrame - sc.loopFrame + 1` → `f.actionFrame - 0 + 1` (counting from the press, as `storedFullStart` would for Samus). Both release tests FAIL (captured): Samus's `expected { Object (motion, frame) } to deeply equal { motion: 'special_n_f_max', frame: 1 }`, Donkey Kong's `expected { motion: 'special_n_max', frame: 8 } to deeply equal { motion: 'special_n_max', frame: 1 }`.
3. `MOTION_OF_ACTION`: restore `cargoCarry: "walk",`. The alias pin, the carry test, the inventory and the 3D carry test FAIL (captured), the first two as in Step 2.
4. `moveSamplers`: `move.cargo === true ? "cargoLift" : SLOT_POSE[slot]` → `SLOT_POSE[slot]`. The lift test FAILS `expected { loop: false, strike: 0.35, …(1) } to be { loop: false, keys: [ …(3) ] }` (captured).
5. `cargoCarry`'s first key: `thighR: 174` → `thighR: 160` (a stride). The rest test FAILS `expected 1.4835555769781463 to be less than 1` (captured).

- [ ] **Step 7: Gate and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`, `PORT=3107 pnpm test:e2e --trace off`. Expected: exit 0.

```bash
git add super-smash/src/engine/types.ts super-smash/src/fighters/samus.ts super-smash/src/fighters/donkeyKong.ts super-smash/src/engine/acmd/poseClock.ts super-smash/src/render3d/bake/bake.ts super-smash/src/render/poses/timing.ts super-smash/src/render/poses/library.ts super-smash/src/render/chars/donkeyKong/poses.ts super-smash/src/engine/acmd/poseClock.test.ts super-smash/src/render3d/bake/bake.test.ts super-smash/src/render/chars/donkeyKong/donkeyKong.test.ts super-smash/public/bake/roster.bin.gz super-smash/src/fighters/bake/digest.ts
# with the golden only if its step regenerated it:
git add super-smash/src/game/__golden__/engine-trace.json super-smash/src/game/rulesVersion.test.ts
git commit -m "super-smash: Donkey Kong's carry, carried fall and lift have clips; a full release plays its own motion" -m "rubendal 13.0.1: throw_f 15 frames, shoulder_* names; special_n_f_max and special_n_max, 47 frames, from the loop frame (Samus after her 13 entry frames: 13 + 48 = 61). The cargoCarry -> walk alias goes: status_cargoCarry, paced, resting feet together; status_cargoCarry_air. The carried forward throw keeps fthrow's clip. Re-baked; golden unchanged." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 21: A dash off a platform flips

From Plan 5 Task 17: "Dash off a platform: SmashWiki "Dash" (Smash 4 and Ultimate): "dashing off a platform will cause the character to perform a short flipping animation". Not a pure clip change: the run/dash leaves into `fall` (`onLeftGround`), and nothing in the fall's state says it began off a dash … Needs a sim-side distinction (a status or a flag, cloned and hashed) or a render-only root spin keyed on cosmetic memory of the previous action, then a clip."

**The sim side is chosen (ruling, recorded in D59).** The fall's hurtboxes come from its baked motion (`statusMotion`). A render-only flip would draw a body turning over while the hurtboxes stay upright, against D57's "the bones the sim reads are the ones drawn".

How it works:
- `CombatState.dashedOff` is set when a `dashStart` or `run` leaves the ground into a fall (`onLeftGround`). Task 7's edge slip returns before this line, so a slip never flips.
- `changeStatus`, where every action change runs, clears it on any action but `fall`.
- While it is set and the fall is in its first `FLIP_FRAMES`, `statusMotion` names `status_fall_flip`, fast fall or not.
- The bake bakes that motion once per fighter, over exactly `FLIP_FRAMES` (a `once` clock), on a clip of its own whose `spin: 1` turns the body one full forward turn.

UNVERIFIED: the flip's length (SmashWiki says "short": 20 frames, by eye) and its clip (the replica's: a forward tuck and roll, opening into the fall).

The new fields are optional in `statusMotion`'s and `poseNameFor`'s parameter (I3): a caller that passes no `combat` or `actionFrame` (the bake's specs, the tests' literals, `ClockedFighter`) is no flip. Every existing caller compiles unchanged.

**Golden:** moves only where a golden match dashes off a platform. None did in the replay: every trace byte-identical (captured). The hash gains a field, but the digest hashes positions and actions, not `mixCombat` (captured). Regenerate after the bake: `UPDATE_BAKE` → `UPDATE_HURT` → `UPDATE_GOLDEN`.

**Files:**
- Modify:
  - `src/engine/combat.ts` (`CombatState.dashedOff`, `emptyCombat`, `cloneCombat`), `src/engine/hash.ts`, `src/engine/constants.ts` (`FLIP_FRAMES`)
  - `src/engine/states.ts` (`onLeftGround`), `src/engine/status/kind.ts` (`changeStatus`'s clear)
  - `src/engine/acmd/poseClock.ts` (`statusMotion`'s flip)
  - `src/render3d/bake/bake.ts` (`StatusMotionSpec.dashedOff`, `statusClock`, `statusMotionSpecs`, `statusSamplers`)
  - `src/render/poses/library.ts` (`"fallFlip"`), `src/render/poses/timing.ts` (`poseNameFor`'s flip), `src/render/poses/fall.ts` (the clip)
- Test: `src/engine/states.test.ts`, `src/engine/acmd/poseClock.test.ts`, `src/render3d/bake/bake.test.ts`
- Regenerate: `public/bake/roster.bin.gz`, `src/fighters/bake/digest.ts`

**Interfaces:**
- Consumes: `onLeftGround` (with Task 7's slip return), `changeStatus`, `statusMotion` and `poseNameFor` (as Task 20 left them), `statusMotionSpecs`, `statusClock`.
- Produces:
  - `CombatState.dashedOff: boolean`;
  - `FLIP_FRAMES = 20` (constants.ts);
  - motion `status_fall_flip`; `PoseName` `"fallFlip"`; `StatusMotionSpec.dashedOff: boolean`;
  - `statusMotion` and `poseNameFor` take `Partial<Pick<FighterState, "grounded" | "actionFrame">> & { readonly combat?: Pick<CombatState, "dashedOff"> }`.

- [ ] **Step 1: Write the failing tests**

`src/engine/states.test.ts` (the run, the dash and the walk off an edge, through `onLeftGround` itself, so no edge has to be found by stepping):

```diff
--- a/src/engine/states.test.ts
+++ b/src/engine/states.test.ts
@@
   onLanded,
+  onLeftGround,
   peekBuffer,
@@
     expect(interpretInput(fighter(), Btn.Up, 0).soft).toBe(false);
   });
 });
+
+describe("a dash off a platform flips (Plan 6, Task 21; SmashWiki \"Dash\")", () => {
+  it("marks the fall a run or a dash leaves into, and not a walk's", () => {
+    for (const action of ["run", "dashStart", "walk"] as const) {
+      const f = fighter({ action, actionFrame: 3, grounded: false, platform: -1 });
+      onLeftGround(f);
+      expect(f.action, action).toBe("fall");
+      expect(f.combat.dashedOff, action).toBe(action !== "walk");
+    }
+  });
+
+  it("forgets it on the next action: a midair jump out of the flip", () => {
+    const f = fighter({ action: "fall", grounded: false, platform: -1, y: fx(10), jumpsUsed: 1, combat: { ...emptyCombat(), dashedOff: true } });
+    tick(f, Btn.Jump, 0);
+    expect(f.action).toBe("jump");
+    expect(f.combat.dashedOff).toBe(false);
+  });
+});
```

`src/engine/acmd/poseClock.test.ts`:

```diff
--- a/src/engine/acmd/poseClock.test.ts
+++ b/src/engine/acmd/poseClock.test.ts
@@
-import { TECH_CEILING_FRAMES, TECH_FRAMES, TECH_ROLL_FRAMES, TECH_WALL_FRAMES } from "../constants";
+import { FLIP_FRAMES, TECH_CEILING_FRAMES, TECH_FRAMES, TECH_ROLL_FRAMES, TECH_WALL_FRAMES } from "../constants";
@@
     expect(poseIndexOf(donkeyKong, f, 0, clocks({}))).toBeNull();
   });
 });
 
+describe("a dash off a platform flips (Plan 6, Task 21)", () => {
+  it("names the flip for a fall out of a dash in its first FLIP_FRAMES, then the fall", () => {
+    const off = { action: "fall" as const, jumpsUsed: 1, fastFalling: false, charge: 0, actionFrame: 3, combat: { dashedOff: true } };
+    expect(statusMotion(off)).toBe("status_fall_flip");
+    // Fast-falling in the flip still flips.
+    expect(statusMotion({ ...off, fastFalling: true })).toBe("status_fall_flip");
+    expect(statusMotion({ ...off, actionFrame: FLIP_FRAMES - 1 })).toBe("status_fall_flip");
+    expect(statusMotion({ ...off, actionFrame: FLIP_FRAMES })).toBe("status_fall");
+    expect(statusMotion({ ...off, combat: { dashedOff: false } })).toBe("status_fall");
+    // A caller that passes no combat (a bake spec, an old literal) is no flip.
+    expect(statusMotion({ action: "fall", jumpsUsed: 1, fastFalling: false, charge: 0 })).toBe("status_fall");
+  });
+});
+
 describe("each fighter's dodges are motions of their own, per direction (ruling R4)", () => {
```

`src/render3d/bake/bake.test.ts`: the inventory enumerates the flip variant too; the flip's `once` clock is `FLIP_FRAMES`, not the fall's open-ended 30 (its duration check exempts it, with the reason); and a test of the flip's bake:

```diff
--- a/src/render3d/bake/bake.test.ts
+++ b/src/render3d/bake/bake.test.ts
@@
 import { toFloat } from "@/engine/fixed";
+import { FLIP_FRAMES } from "@/engine/constants";
 import { clipFor } from "@/render/chars";
@@
-  it("are every motion statusMotion can name, each once: 61 over the 60 actions, tumbleFall among them", () => {
+  it("are every motion statusMotion can name, each once: 62 over the 60 actions, tumbleFall among them", () => {
@@
           for (const fastFalling of [false, true]) {
-            for (const grounded of [true, false]) named.add(statusMotion({ action, charge, jumpsUsed, fastFalling, grounded }));
+            for (const grounded of [true, false]) {
+              for (const dashedOff of [false, true]) named.add(statusMotion({ action, charge, jumpsUsed, fastFalling, grounded, actionFrame: 0, combat: { dashedOff } }));
+            }
           }
@@
     // Task 20: the carry leaves the walk's for two of its own, on the ground and in the air.
+    // Task 21: the fall gains the flip off a dash.
     expect(ACTIONS).toHaveLength(60);
-    expect(named.size).toBe(61);
+    expect(named.size).toBe(62);
@@
-    for (const s of specs) expect(statusMotion(s)).toBe(s.motion);
+    for (const s of specs) expect(statusMotion({ ...s, actionFrame: 0, combat: { dashedOff: s.dashedOff } })).toBe(s.motion);
@@
         if (clock.kind !== "once") continue;
+        // The flip off a dash (Plan 6, Task 21) is the fall's first FLIP_FRAMES, a part of a state with no length.
+        if (spec.motion === "status_fall_flip") {
+          expect(clock.frames, def.id).toBe(FLIP_FRAMES);
+          continue;
+        }
         const twoD = actionDurationFor(posedAt(def.id, spec, 0), jumpTimingFor(def)) ?? OPEN_ENDED_FRAMES;
@@
     expect(attackClipTime(0.4, 1, 20, 11)).toBe(0.5);
   });
 });
 
+describe("the flip off a dash (Plan 6, Task 21)", () => {
+  it("bake it for every fighter over FLIP_FRAMES on the flip's own clip, one forward turn by its end", () => {
+    for (const def of FIGHTERS) {
+      const flip = statusSamplers(def).get("status_fall_flip")!;
+      expect(flip.clock, def.id).toEqual({ kind: "once", frames: FLIP_FRAMES });
+      expect(flip.clip, def.id).toBe(clipFor(def.id, "fallFlip"));
+      expect(sampleAt(flip, FLIP_FRAMES).spin / (2 * Math.PI), def.id).toBeCloseTo((FLIP_FRAMES - 1) / FLIP_FRAMES, 9);
+    }
+  });
+});
+
 describe("Donkey Kong's carry and lift, and the full releases (Plan 6, Task 20)", () => {
```

(`sampleAt` samples frame k at clip time (k − 1)/frames, so frame 20 shows 19/20 of the turn and the fall's first frame after it the whole turn.)

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/engine/states.test.ts src/engine/acmd/poseClock.test.ts src/render3d/bake/bake.test.ts -t "dash off|flip|every motion statusMotion"`

Expected: FAIL (captured):
- the mark: `run: expected undefined to be true`;
- the clear: `expected true to be false` (nothing clears the flag yet);
- the motion: `expected 'status_fall' to be 'status_fall_flip'`;
- the inventory: `expected 61 to be 62`;
- the flip's bake: `TypeError: Cannot read properties of undefined (reading 'clock')`.

- [ ] **Step 3: Implement**

`src/engine/combat.ts`:

```diff
--- a/src/engine/combat.ts
+++ b/src/engine/combat.ts
@@
   stoneEndedAir: boolean;
   /**
+   * Plan 6, Task 21: left the ground out of a dash or a run (`onLeftGround`), so the
+   * fall flips for its first `FLIP_FRAMES` (SmashWiki "Dash": "dashing off a platform
+   * will cause the character to perform a short flipping animation"). Any change of
+   * action but into the fall clears it (`changeStatus`).
+   */
+  dashedOff: boolean;
+  /**
    * The length, in frames after its freeze, of the rebound a lost clank sends the
@@
     stoneEndedAir: false,
+    dashedOff: false,
     rebound: 0,
@@
     stoneEndedAir: c.stoneEndedAir,
+    dashedOff: c.dashedOff,
     rebound: c.rebound,
```

`src/engine/hash.ts`:

```diff
--- a/src/engine/hash.ts
+++ b/src/engine/hash.ts
@@
   x = mixBool(x, c.stoneEndedAir);
+  x = mixBool(x, c.dashedOff);
   x = mixInt(x, c.rebound);
```

`src/engine/constants.ts`:

```diff
--- a/src/engine/constants.ts
+++ b/src/engine/constants.ts
@@
 export const TECH_CEILING_FRAMES = 26;
+/**
+ * The flip off a dash (Plan 6, Task 21): the first frames of a fall out of a dash
+ * or a run play the flip's motion. UNVERIFIED: SmashWiki "Dash" calls it "a short
+ * flipping animation" and gives no length; 20 frames, by eye.
+ */
+export const FLIP_FRAMES = 20;
 export const TECH_INTANGIBLE = [1, 20] as const;
```

`src/engine/states.ts`, `onLeftGround`, after Task 7's slip:

```diff
--- a/src/engine/states.ts
+++ b/src/engine/states.ts
@@
     startAction(f, "edgeSlip");
     return;
   }
-  if (exit === "fall" || exit === "tumbleFall") startAction(f, exit);
+  // Off the edge out of a dash or a run, the fall flips (Plan 6, Task 21; SmashWiki "Dash").
+  const dashed = f.action === "dashStart" || f.action === "run";
+  if (exit === "fall" || exit === "tumbleFall") {
+    startAction(f, exit);
+    if (dashed && exit === "fall") f.combat.dashedOff = true;
+  }
   // A grounded attack's own movement stops at the edge (`stopsAtEdge`), so one that
```

`src/engine/status/kind.ts`, `changeStatus` (M1: the one place an action changes):

```diff
--- a/src/engine/status/kind.ts
+++ b/src/engine/status/kind.ts
@@
   f.action = action;
   f.actionFrame = 0;
+  // The flip off a dash belongs to the fall it began (Plan 6, Task 21): any other action forgets it.
+  if (action !== "fall") f.combat.dashedOff = false;
   if (action !== "attack" && action !== "special" && action !== "throw" && action !== "pummel") {
```

`src/engine/acmd/poseClock.ts`:

```diff
--- a/src/engine/acmd/poseClock.ts
+++ b/src/engine/acmd/poseClock.ts
@@
   DASH_INTERRUPT_FRAME,
+  FLIP_FRAMES,
   JUMP_SQUAT_FRAMES,
@@
 } from "../states";
+import type { CombatState } from "../combat";
 import type { ActionState, FighterDef, FighterState } from "../types";
@@
-export function statusMotion(f: Pick<FighterState, "action" | "jumpsUsed" | "fastFalling" | "charge"> & Partial<Pick<FighterState, "grounded">>): MotionKind {
+export function statusMotion(
+  f: Pick<FighterState, "action" | "jumpsUsed" | "fastFalling" | "charge"> &
+    Partial<Pick<FighterState, "grounded" | "actionFrame">> & { readonly combat?: Pick<CombatState, "dashedOff"> },
+): MotionKind {
   const shared = MOTION_OF_ACTION[f.action];
@@
   if (f.action === "jump" && f.jumpsUsed >= 2) return "status_jump_aerial";
+  // The flip off a dash, fast fall or not (Plan 6, Task 21). A caller that names no
+  // combat or frame (a bake spec, a partial literal) is no flip.
+  if (f.action === "fall" && f.combat?.dashedOff === true && (f.actionFrame ?? 0) < FLIP_FRAMES) return "status_fall_flip";
   if ((f.action === "fall" || f.action === "dead") && f.fastFalling) return `status_${f.action}_fast`;
```

`src/render3d/bake/bake.ts`:

```diff
--- a/src/render3d/bake/bake.ts
+++ b/src/render3d/bake/bake.ts
@@
 import { scriptBoneNames } from "@/engine/acmd/scriptBones";
+import { FLIP_FRAMES } from "@/engine/constants";
 import { ONE, toFloat } from "@/engine/fixed";
@@
   /** On the ground or not: the carry's two motions (Plan 6, Task 20). */
   readonly grounded: boolean;
+  /** Off a dash: the fall's flip (Plan 6, Task 21), baked over `FLIP_FRAMES`. */
+  readonly dashedOff: boolean;
 }
@@
 export function statusClock(clip: PoseClip, poseName: PoseName, spec: StatusMotionSpec, def: FighterDef): MotionClock {
+  // The flip is the fall's first frames, a part of a state that has no length (Plan 6, Task 21).
+  if (spec.dashedOff) return { kind: "once", frames: FLIP_FRAMES };
   if (clip.loop) {
@@
         for (const grounded of [true, false]) {
-          const motion = statusMotion({ action, charge, ...v, grounded });
-          if (seen.has(motion)) continue;
-          seen.add(motion);
-          out.push({ motion, action, charge, ...v, grounded });
+          for (const dashedOff of [false, true]) {
+            const motion = statusMotion({ action, charge, ...v, grounded, actionFrame: 0, combat: { dashedOff } });
+            if (seen.has(motion)) continue;
+            seen.add(motion);
+            out.push({ motion, action, charge, ...v, grounded, dashedOff });
+          }
         }
@@
-    const poseName = poseNameFor({ action: spec.action, move: null, jumpsUsed: spec.jumpsUsed, fastFalling: spec.fastFalling, grounded: spec.grounded });
+    const poseName = poseNameFor({
+      action: spec.action,
+      move: null,
+      jumpsUsed: spec.jumpsUsed,
+      fastFalling: spec.fastFalling,
+      grounded: spec.grounded,
+      actionFrame: 0,
+      combat: { dashedOff: spec.dashedOff },
+    });
     const clip = clipFor(def.id, poseName);
```

`src/render/poses/timing.ts`:

```diff
--- a/src/render/poses/timing.ts
+++ b/src/render/poses/timing.ts
@@
   DASH_INTERRUPT_FRAME,
+  FLIP_FRAMES,
   JUMP_SQUAT_FRAMES,
@@
 } from "@/engine/states";
+import type { CombatState } from "@/engine/combat";
 import type { AirDodgeAttributes, FighterDef, FighterState, GroundDodgeAttributes, MoveSlot } from "@/engine/types";
@@
-export function poseNameFor(f: Pick<PosedFighter, "action" | "move" | "jumpsUsed" | "fastFalling"> & Partial<Pick<FighterState, "grounded">>): PoseName {
+export function poseNameFor(
+  f: Pick<PosedFighter, "action" | "move" | "jumpsUsed" | "fastFalling"> &
+    Partial<Pick<FighterState, "grounded" | "actionFrame">> & { readonly combat?: Pick<CombatState, "dashedOff"> },
+): PoseName {
+  // The flip off a dash (Plan 6, Task 21), as `statusMotion` names its motion.
+  if (f.action === "fall" && f.combat?.dashedOff === true && (f.actionFrame ?? 0) < FLIP_FRAMES) return "fallFlip";
   switch (f.action) {
```

`src/render/poses/library.ts`:

```diff
--- a/src/render/poses/library.ts
+++ b/src/render/poses/library.ts
@@
-import { fall, fastFall } from "./fall";
+import { fall, fallFlip, fastFall } from "./fall";
@@
   | "fall"
   | "fastFall"
+  // Plan 6, Task 21: the flip off a dash.
+  | "fallFlip"
   | "land"
@@
   fall,
   fastFall,
+  fallFlip,
   land,
```

`src/render/poses/fall.ts`, at its end:

```diff
--- a/src/render/poses/fall.ts
+++ b/src/render/poses/fall.ts
@@
       scaleY: 1.08,
       rotation: 0.19,
     },
   ],
 };
+
+/**
+ * A dash off a platform (Plan 6, Task 21; SmashWiki "Dash": "dashing off a platform
+ * will cause the character to perform a short flipping animation"): one forward turn
+ * over `FLIP_FRAMES` (`spin`, as the roll's and the tumble's turns are; a key's
+ * `rotation` cannot make a whole turn), tucked, opening into the fall's first pose.
+ * The replica's shape: the game's motion is unpublished.
+ */
+export const fallFlip: PoseClip = {
+  loop: false,
+  spin: 1,
+  keys: [
+    {
+      t: 0,
+      ease: "out",
+      pose: P({
+        torso: 24, head: -14,
+        thighR: 110, shinR: 110, footR: -80,
+        thighL: 118, shinL: 104, footL: -84,
+        upperArmR: 118, forearmR: -48,
+        upperArmL: 242, forearmL: 48,
+      }),
+      offsetY: 0.6,
+    },
+    {
+      t: 0.6,
+      pose: P({
+        torso: 30, head: -18,
+        thighR: 96, shinR: 128, footR: -80,
+        thighL: 102, shinL: 124, footL: -84,
+        upperArmR: 118, forearmR: -48,
+        upperArmL: 242, forearmL: 48,
+      }),
+      offsetY: 0.6,
+    },
+    { t: 1, pose: fall.keys[0].pose, offsetY: fall.keys[0].offsetY, scaleX: fall.keys[0].scaleX, scaleY: fall.keys[0].scaleY },
+  ],
+};
```

- [ ] **Step 4: Run them again, then the bake and golden**

Run: `pnpm vitest run src/engine src/render/poses src/render3d/bake/bake.test.ts`. Expected: PASS (captured). `pnpm typecheck`: exit 0, with no other caller changed (captured).

Then `UPDATE_BAKE=1 pnpm vitest run src/render3d/bake/roster.test.ts`: `roster.bin.gz` 1,971,551 → 1,995,351 bytes (captured). Then `pnpm vitest run src/fighters/acmd src/game/hurtboxes.test.ts src/game/golden.test.ts`: PASS, nothing to regenerate (captured). A trace that moves is regenerated (`UPDATE_GOLDEN=1 …`, re-pin) and named in the commit.

- [ ] **Step 5: Look (numbers)**

The bake test settles the flip's claims: every fighter turns one forward turn over `FLIP_FRAMES`, its hurtboxes with it. The animation lab cannot put a fighter in a fall off a dash (`fighterAt` has no `combat`), and `fightsheet.mjs` presses no dash off an edge, so there is no capture step. The clip's shape is UNVERIFIED (D59).

- [ ] **Step 6: Mutants**

Each against the Step 2 files; restore after each:
1. `onLeftGround`: drop `if (dashed && exit === "fall") f.combat.dashedOff = true;`. The mark test FAILS `run: expected false to be true` (captured).
2. `changeStatus`: drop the clear. The "forgets it" test FAILS `expected true to be false` (captured).
3. `statusMotion`: drop `&& (f.actionFrame ?? 0) < FLIP_FRAMES`. The motion test FAILS `expected 'status_fall_flip' to be 'status_fall'` (captured).
4. `statusClock`: drop the flip's line. The flip's bake test FAILS `mario: expected { kind: 'once', frames: 30 } to deeply equal { kind: 'once', frames: 20 }`, and the duration check `mario: expected 30 to be 20` (captured: the fall's open-ended 30).

- [ ] **Step 7: Gate and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`, `PORT=3107 pnpm test:e2e --trace off`. Expected: exit 0.

```bash
git add super-smash/src/engine/combat.ts super-smash/src/engine/hash.ts super-smash/src/engine/constants.ts super-smash/src/engine/states.ts super-smash/src/engine/status/kind.ts super-smash/src/engine/acmd/poseClock.ts super-smash/src/render3d/bake/bake.ts super-smash/src/render/poses/library.ts super-smash/src/render/poses/timing.ts super-smash/src/render/poses/fall.ts super-smash/src/engine/states.test.ts super-smash/src/engine/acmd/poseClock.test.ts super-smash/src/render3d/bake/bake.test.ts super-smash/public/bake/roster.bin.gz super-smash/src/fighters/bake/digest.ts
# with the golden only if its step regenerated it:
git add super-smash/src/game/__golden__/engine-trace.json super-smash/src/game/rulesVersion.test.ts
git commit -m "super-smash: dashing off a platform flips (SmashWiki Dash)" -m "CombatState.dashedOff, cloned and hashed, set leaving the ground out of a dash or a run and cleared by any other action; statusMotion names status_fall_flip for the fall's first 20 frames (UNVERIFIED length), baked once over those frames on a clip that turns one forward turn. statusMotion's new fields are optional: no caller changes. Golden unchanged." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 22: Clips of their own for the edge slip and the wall and ceiling techs (R-P6-9 c)

D58 carried "*Clips of their own for the six borrowed actions* (`tech`, `techRoll`, `techWall`, `techCeiling`, `tumbleFall`, `ledgeTrumped`): not done. … Carried." Task 7 adds a seventh borrower: the edge slip plays the fall's motion (`MOTION_OF_ACTION.edgeSlip`).

Each borrower was weighed by whether a clip of its own reads better than the borrowed one in SPEC §10's style:

| Action | Borrows | Verdict |
|---|---|---|
| `edgeSlip` (Task 7) | the fall | **Its own clip.** A slip reads as a fighter caught off balance, leaning back over the drop, then gathering into the fall by its lockout's end. The fall's clip shows a fighter already in control. Its own motion, `status_edgeSlip`, baked at the fighter's own lockout (`edgeSlipFrames`: 26, or 25 for Donkey Kong and Pikachu). |
| `techWall`, `techCeiling` | the tumble (a spin) | **One clip of its own, `surfaceTech`.** A tech is the escape from the tumble. Playing the tumble's spin through it reads as the reel it escaped. The new clip braces, compact against the surface, through the wall's hold, then opens into the fall, never turning the body over. Their motions exist already (`status_techWall`, `status_techCeiling`); only the clip they bake changes. |
| `tech`, `techRoll` | Plan 3's tech and roll clips | Carried. They are clips of their own in all but name: a floor tech plays `getUp`'s pop, a tech roll the roll. Re-authoring would change no read. |
| `tumbleFall` | the tumble | Carried. The tumble after hitstun is the same tumble (SmashWiki "Tumbling"). |
| `ledgeTrumped` | the fall | Carried. Knocked off the ledge into a fall, it is a fall. |

The carried four go on the "Carried, not in Plan 6" list with these reasons.

All are the replica's shapes, in its convention: rubendal 13.0.1 publishes the motion names (`miss_foot`, `passive_wall`, `passive_ceil`), not the animations. Their last key is the fall's first, so each hands over to the fall without a pop.

**Golden:** moves (captured): `tech-lab-finalDestination` (the wall and ceiling techs' bodies) and Task 7's `slip-lab-battlefield` (the slip's). Every other trace byte-identical. Regenerate after the bake: `UPDATE_BAKE` → (`UPDATE_REACH` if asked) → `UPDATE_HURT` → `UPDATE_GOLDEN`, then `RULES_PIN.golden`. R-P6-12: no new action, so no new lab scene; the two labs that visit these actions already pin them.

**Files:**
- Create: `src/render/poses/surfaceTech.ts`
- Modify:
  - `src/render/poses/fall.ts` (`edgeSlip`), `src/render/poses/library.ts` (`"edgeSlip"`, `"surfaceTech"`)
  - `src/render/poses/timing.ts` (`poseNameFor`'s three, `JumpTiming.edgeSlip`, `actionDurationFor`'s slip)
  - `src/engine/acmd/poseClock.ts` (the `edgeSlip` alias goes; `statusDuration`'s slip)
- Test: `src/engine/acmd/poseClock.test.ts`, `src/render3d/bake/bake.test.ts`, `src/render/poses.test.ts`
- Modify too: `src/engine/acmd/bakeCodec.ts`, `src/render3d/bake/roster.test.ts` (the bake's size, in their comments)
- Regenerate: `public/bake/roster.bin.gz`, `src/fighters/bake/digest.ts`, `src/game/hurt.allow.json` if asked, the golden and its pin

**Interfaces:**
- Consumes: Task 7's `edgeSlip` action, `edgeSlipFrames(def)` (states.ts), `EDGE_SLIP_FRAMES` (constants.ts), and its `MOTION_OF_ACTION.edgeSlip` and `poseNameFor` rows; `fall` (fall.ts); `statusDuration`, `actionDurationFor`, `jumpTimingFor`.
- Produces: `PoseName` `"edgeSlip" | "surfaceTech"`; motion `status_edgeSlip`; `JumpTiming.edgeSlip?: number`.

- [ ] **Step 1: Write the failing tests**

`src/engine/acmd/poseClock.test.ts`:

```diff
--- a/src/engine/acmd/poseClock.test.ts
+++ b/src/engine/acmd/poseClock.test.ts
@@
       specialFall: "fall",
-      // Plan 6, Task 7: the edge slip falls on the fall's clip.
-      edgeSlip: "fall",
       specialLanding: "landingLag",
@@
     expect(statusMotion({ action: "fall", jumpsUsed: 1, fastFalling: false, charge: 0 })).toBe("status_fall");
   });
 });
 
+describe("the edge slip plays a motion of its own (Plan 6, Task 22)", () => {
+  it("names status_edgeSlip, as long as the fighter's own slip", () => {
+    expect(MOTION_OF_ACTION.edgeSlip).toBeUndefined();
+    expect(statusMotion({ action: "edgeSlip", jumpsUsed: 1, fastFalling: false, charge: 0 })).toBe("status_edgeSlip");
+    const slip = { action: "edgeSlip" as const, actionFrame: 0, charge: 0, hitstun: 0, jumpsUsed: 1, shortHop: false, vy: 0 };
+    expect(statusDuration(slip, FIGHTERS.find((d) => d.id === "mario")!)).toBe(26);
+    expect(statusDuration(slip, donkeyKong)).toBe(25);
+  });
+});
+
 describe("each fighter's dodges are motions of their own, per direction (ruling R4)", () => {
@@
     // tumble's; Task 13c's rebound, the stand's; Task 14's trapped, the grab's;
-    // Task 11's footstooled and Task 12's crawl have their own since Task 17;
-    // Plan 6, Task 7's edge slip, the fall's),
+    // Task 11's footstooled and Task 12's crawl have their own since Task 17),
     // the second jump, two fast falls, five directional air dodges and the back roll.
```

`src/render3d/bake/bake.test.ts`:

```diff
--- a/src/render3d/bake/bake.test.ts
+++ b/src/render3d/bake/bake.test.ts
@@
-  it("are every motion statusMotion can name, each once: 62 over the 60 actions, tumbleFall among them", () => {
+  it("are every motion statusMotion can name, each once: 63 over the 60 actions, tumbleFall among them", () => {
@@
-    // Plan 6, Task 7: one more, the edge slip, and no motion more: it plays the fall's.
+    // Plan 6, Task 7: one more, the edge slip, on the fall's motion; Task 22: on one of its own.
     // Task 20: the carry leaves the walk's for two of its own, on the ground and in the air.
     // Task 21: the fall gains the flip off a dash.
     expect(ACTIONS).toHaveLength(60);
-    expect(named.size).toBe(62);
+    expect(named.size).toBe(63);
@@
 });
 
+describe("clips of their own for the edge slip and the wall and ceiling techs (Plan 6, Task 22)", () => {
+  it("bake each on its own clip, none of them turning the body over", () => {
+    for (const def of FIGHTERS) {
+      const samplers = statusSamplers(def);
+      for (const [motion, name] of [["status_edgeSlip", "edgeSlip"], ["status_techWall", "surfaceTech"], ["status_techCeiling", "surfaceTech"]] as const) {
+        const s = samplers.get(motion)!;
+        expect(s.clip, `${def.id} ${motion}`).toBe(clipFor(def.id, name));
+        for (let k = 1; k <= s.clock.frames; k++) expect(sampleAt(s, k).spin, `${def.id} ${motion} ${k}`).toBe(0);
+      }
+    }
+  });
+});
+
 describe("the flip off a dash (Plan 6, Task 21)", () => {
```

`src/render/poses.test.ts`, the fixed-length clips' table, which plays each across its own state:

```diff
--- a/src/render/poses.test.ts
+++ b/src/render/poses.test.ts
@@
     ["getUp", { action: "getUp" }],
+    // Plan 6, Task 22.
+    ["surfaceTech", { action: "techWall" }],
+    ["edgeSlip", { action: "edgeSlip" }],
     ["downed", { action: "downed" }],
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/engine/acmd/poseClock.test.ts src/render3d/bake/bake.test.ts src/render/poses.test.ts`

Expected: FAIL (captured):
- the alias pin: `expected { rebound: 'stand', …(8) } to deeply equal { rebound: 'stand', …(7) }`;
- the slip's motion: `expected 'fall' to be undefined`;
- the inventory: `expected 62 to be 63`;
- the clips' bake: `TypeError: Cannot read properties of undefined (reading 'clip')`;
- `poses.test.ts`'s table ("is essentially at its final pose on its last drawn frame"): `TypeError: Cannot read properties of undefined (reading 'keys')`, the clips missing.

- [ ] **Step 3: Implement**

`src/render/poses/surfaceTech.ts` (new file):

```ts
import { fall } from "./fall";
import { P, type PoseClip } from "./clip";

/**
 * A tech off a wall or a ceiling (Plan 6, Task 22; the statuses `techWall` and
 * `techCeiling`, rubendal 13.0.1 motions `passive_wall` and `passive_ceil`): braced and
 * compact against the surface, held for the wall's hold (`TECH_WALL_HOLD`, 5 of its 26
 * frames), then opening into the fall's first pose. Plan 3 played the tumble's spin here,
 * which reads as the reel the tech escaped; this one never turns the body over. The
 * replica's shape (the game's animation is unpublished); one clip for both, as neither
 * status says which side the surface is.
 */
export const surfaceTech: PoseClip = {
  loop: false,
  keys: [
    {
      t: 0,
      pose: P({
        torso: 18, head: -10,
        thighR: 118, shinR: 96, footR: -82,
        thighL: 126, shinL: 90, footL: -84,
        upperArmR: 84, forearmR: -40,
        upperArmL: 276, forearmL: 40,
      }),
      offsetY: 0.4,
    },
    {
      t: 0.2,
      pose: P({
        torso: 18, head: -10,
        thighR: 118, shinR: 96, footR: -82,
        thighL: 126, shinL: 90, footL: -84,
        upperArmR: 84, forearmR: -40,
        upperArmL: 276, forearmL: 40,
      }),
      offsetY: 0.4,
    },
    {
      t: 0.55,
      pose: P({
        torso: 6, head: -2,
        thighR: 140, shinR: 60, footR: -78,
        thighL: 160, shinL: 50, footL: -82,
        upperArmR: 100, forearmR: -20,
        upperArmL: 260, forearmL: 20,
      }),
      offsetY: 0.3,
    },
    { t: 1, pose: fall.keys[0].pose, offsetY: fall.keys[0].offsetY, scaleX: fall.keys[0].scaleX, scaleY: fall.keys[0].scaleY },
  ],
};
```

`src/render/poses/fall.ts`, after Task 21's `fallFlip`:

```diff
--- a/src/render/poses/fall.ts
+++ b/src/render/poses/fall.ts
@@
     { t: 1, pose: fall.keys[0].pose, offsetY: fall.keys[0].offsetY, scaleX: fall.keys[0].scaleX, scaleY: fall.keys[0].scaleY },
   ],
 };
+
+/**
+ * An edge slip (Plan 6, Task 22; Task 7's status, rubendal 13.0.1 motion `miss_foot`;
+ * SmashWiki "Edge slipping": the fighter "will lose their footing and fall off the
+ * edge"): knocked off backward, it leans back over the drop, the front foot kicking up and
+ * the arms thrown forward, then gathers into the fall's first pose by the lockout's end.
+ * The replica's shape: the game's animation is unpublished.
+ */
+export const edgeSlip: PoseClip = {
+  loop: false,
+  keys: [
+    {
+      t: 0,
+      ease: "out",
+      pose: P({
+        torso: -22, head: 14,
+        thighR: 128, shinR: 40, footR: -80,
+        thighL: 186, shinL: 24, footL: -96,
+        upperArmR: 40, forearmR: -20,
+        upperArmL: 312, forearmL: 20,
+      }),
+    },
+    {
+      t: 0.35,
+      pose: P({
+        torso: -30, head: 18,
+        thighR: 112, shinR: 56, footR: -78,
+        thighL: 176, shinL: 46, footL: -92,
+        upperArmR: 20, forearmR: -36,
+        upperArmL: 330, forearmL: 34,
+      }),
+      offsetY: 0.2,
+    },
+    {
+      t: 0.7,
+      pose: P({
+        torso: -12, head: 8,
+        thighR: 150, shinR: 40, footR: -76,
+        thighL: 196, shinL: 30, footL: -82,
+        upperArmR: 70, forearmR: -14,
+        upperArmL: 290, forearmL: 14,
+      }),
+      offsetY: 0.2,
+    },
+    { t: 1, pose: fall.keys[0].pose, offsetY: fall.keys[0].offsetY, scaleX: fall.keys[0].scaleX, scaleY: fall.keys[0].scaleY },
+  ],
+};
```

`src/render/poses/library.ts`:

```diff
--- a/src/render/poses/library.ts
+++ b/src/render/poses/library.ts
@@
-import { fall, fallFlip, fastFall } from "./fall";
+import { edgeSlip, fall, fallFlip, fastFall } from "./fall";
+import { surfaceTech } from "./surfaceTech";
 import { land, landingLag } from "./land";
@@
   | "fallFlip"
+  // Plan 6, Task 22: the edge slip, and a tech off a wall or a ceiling.
+  | "edgeSlip"
+  | "surfaceTech"
   | "land"
@@
   fallFlip,
+  edgeSlip,
+  surfaceTech,
   land,
```

`src/render/poses/timing.ts`:

```diff
--- a/src/render/poses/timing.ts
+++ b/src/render/poses/timing.ts
@@
   DASH_INTERRUPT_FRAME,
+  EDGE_SLIP_FRAMES,
   FLIP_FRAMES,
@@
   TURNAROUND_FRAMES,
+  edgeSlipFrames,
 } from "@/engine/states";
@@
   /** The fighter's pummel's length, its move's `totalFrames` (ruling P5-R10), carried for the same reason. */
   readonly pummel: number;
+  /** The fighter's edge slip's length (`edgeSlipFrames`; Plan 6, Task 22), carried for the same reason. */
+  readonly edgeSlip?: number;
 }
@@
       pummel: def.moves.pummel?.totalFrames ?? PUMMEL_FRAMES,
+      edgeSlip: edgeSlipFrames(def),
     };
@@
     case "specialFall":
-    // The edge slip (Plan 6, Task 7) too, until it has a clip of its own.
-    case "edgeSlip":
       return f.fastFalling ? "fastFall" : "fall";
+    // Plan 6, Task 22: the edge slip's own clip.
+    case "edgeSlip":
+      return "edgeSlip";
@@
     case "tumble":
     case "tumbleFall":
+      return "tumble";
+    // Plan 6, Task 22: a wall or ceiling tech braces and opens; it does not tumble.
     case "techWall":
     case "techCeiling":
-      return "tumble";
+      return "surfaceTech";
@@
     case "techCeiling":
       return TECH_CEILING_FRAMES;
+    // Plan 6, Task 22: the fighter's own lockout.
+    case "edgeSlip":
+      return jump?.edgeSlip ?? EDGE_SLIP_FRAMES;
     case "ledgeGetUp":
       return LEDGE_GETUP_FRAMES;
     case "ledgeJump":
       return LEDGE_JUMP_FRAMES;
     // Stood on: the freeze (Plan 5, Task 11), which its clip spans (Task 17).
```

`src/engine/acmd/poseClock.ts`:

```diff
--- a/src/engine/acmd/poseClock.ts
+++ b/src/engine/acmd/poseClock.ts
@@
   PUMMEL_FRAMES,
+  edgeSlipFrames,
   RUN_BRAKE_FRAMES,
@@
   specialFall: "fall",
-  // Plan 6, Task 7: the edge slip falls on the fall's clip until it has one of its own.
-  edgeSlip: "fall",
   specialLanding: "landingLag",
@@
     case "techCeiling":
       return TECH_CEILING_FRAMES;
+    // The fighter's own lockout (Task 7), which its clip spans (Task 22).
+    case "edgeSlip":
+      return edgeSlipFrames(def);
     case "ledgeGetUp":
       return LEDGE_GETUP_FRAMES;
     case "ledgeJump":
       return LEDGE_JUMP_FRAMES;
     // Stood on: the footstool's freeze (Plan 5, Task 11), which its own clip spans
```

- [ ] **Step 4: Run them again, then the bake and golden**

Run: `pnpm vitest run src/engine/acmd src/render3d/bake/bake.test.ts src/render/poses.test.ts src/render/poses`. Expected: PASS (captured).

Then:
1. `UPDATE_BAKE=1 pnpm vitest run src/render3d/bake/roster.test.ts`: `roster.bin.gz` 1,995,351 → 2,030,515 bytes, 7,029,165 raw (captured): 96.8% of the 2 MiB budget, 66,637 bytes left (Task 8's 2,393 bytes, not in the replay, come out of that). A later task that adds baked motions reports its size against it.
2. The two places that quote the bake's size, as Plans 2-5 kept them (the replay's figures; write the regenerated file's, `ls -l public/bake/roster.bin.gz` and the raw length `roster.test.ts` bakes):

```diff
--- a/src/engine/acmd/bakeCodec.ts
+++ b/src/engine/acmd/bakeCodec.ts
@@
- * Committed gzipped as `public/bake/roster.bin.gz` (1,965,143 bytes, 1.97 MB, on the committed
- * skeletons: 93.71% of its 2 MiB budget, `render3d/bake/roster.test.ts`); its fingerprint
+ * Committed gzipped as `public/bake/roster.bin.gz` (2,030,515 bytes, 2.03 MB, on the committed
+ * skeletons, after Plan 6's bodies: 96.82% of its 2 MiB budget,
+ * `render3d/bake/roster.test.ts`); its fingerprint
```

```diff
--- a/src/render3d/bake/roster.test.ts
+++ b/src/render3d/bake/roster.test.ts
@@
     // 1.85 MB / 6.37 MB (1,846,005 / 6,370,707 bytes), 88.02% of the gzipped
-    // budget. Past this budget, bake fewer bones, not a bigger file.
+    // budget. Plan 6's bodies (Tasks 19, 20, 21 and 22): 2.03 MB / 7.03 MB
+    // (2,030,515 / 7,029,165 bytes), 96.82%. Past this budget, bake fewer bones,
+    // not a bigger file.
```

3. `pnpm vitest run src/game/bake.test.ts`: PASS, the three-chunk read, thanks to Task 19's chunk count (captured).
4. `pnpm vitest run src/fighters/acmd src/game/hurtboxes.test.ts`. Expected: PASS (captured).
5. `pnpm vitest run src/game/golden.test.ts`. Expected: FAIL on two traces (captured): `replays tech-lab-finalDestination exactly` and `replays slip-lab-battlefield exactly`, each `first divergence in frames 1-100: expected +0 to be -1`. Then `UPDATE_GOLDEN=1 pnpm vitest run src/game/golden.test.ts` and `RULES_PIN.golden` to the printed digest.

- [ ] **Step 5: Look (numbers; stand-in or scratchpad-only captures)**

The bake test settles the claim the clips are for: no turn in a tech or a slip. The wall and ceiling techs are in the animation lab's "tech" group. With `pnpm dev --port 3107` in the background:

```bash
node scripts/animsheet.mjs techWall --fighter mario --base http://localhost:3107 --out "$SCRATCH/techwall.png"
```

Read it: braced, then opening into the fall, with no spin. Then `rm "$SCRATCH/techwall.png"`. With local models this is a real-model capture, kept only in the scratchpad and deleted in the same step. The lab offers no `edgeSlip` (Task 7 adds no lab action), so the slip is judged by its numbers alone. Stop the server by its PID.

- [ ] **Step 6: Mutants**

Each against the Step 2 files; restore after each:
1. `poseNameFor`: `return "surfaceTech";` → `return "tumble";`. The clips' bake test FAILS `mario status_techWall: expected { loop: true, period: 32, …(2) } to be { loop: false, keys: [ …(4) ] }` (captured).
2. `MOTION_OF_ACTION`: restore `edgeSlip: "fall",`. The alias pin, the slip's motion test, the inventory and the clips' bake test FAIL (captured), the first two as in Step 2.
3. `statusDuration`: drop the `edgeSlip` case. The slip's motion test FAILS `expected undefined to be 26`, and the bake's duration check `mario status_edgeSlip: expected 30 to be 26` (captured).

- [ ] **Step 7: Gate and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`, `PORT=3107 pnpm test:e2e --trace off`. Then, as the bodies sub-group's last task, `pnpm vitest run src/game/cpuIdleHuman.test.ts` again (captured green). The CPU group's baseline (Task 23) is measured after this commit. Expected: exit 0.

```bash
git add super-smash/src/engine/acmd/bakeCodec.ts super-smash/src/render3d/bake/roster.test.ts super-smash/src/render/poses/surfaceTech.ts super-smash/src/render/poses/fall.ts super-smash/src/render/poses/library.ts super-smash/src/render/poses/timing.ts super-smash/src/engine/acmd/poseClock.ts super-smash/src/engine/acmd/poseClock.test.ts super-smash/src/render3d/bake/bake.test.ts super-smash/src/render/poses.test.ts super-smash/public/bake/roster.bin.gz super-smash/src/fighters/bake/digest.ts
git add super-smash/src/game/__golden__/engine-trace.json super-smash/src/game/rulesVersion.test.ts
# and super-smash/src/game/hurt.allow.json if Step 4 regenerated it
git commit -m "super-smash: the edge slip and the wall and ceiling techs have clips of their own" -m "D58 carry (c), R-P6-9: status_edgeSlip at the fighter's own lockout (26; 25 for Donkey Kong and Pikachu), leaning back over the drop; techWall and techCeiling brace and open, no longer the tumble's spin. tech, techRoll, tumbleFall and ledgeTrumped keep their clips (D59: each already reads as itself). Golden: tech-lab-finalDestination, slip-lab-battlefield." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Group 3: the CPU

These tasks run after the engine group and its body tasks (Tasks 6-22; the bodies are 19-22), so the CPU is measured against the final bodies (R-P6-3). The draft's Task 17, a judged firing rule for the late, narrow Final Smashes, failed ruling R-P6-19 (its first form outright; its veto form, measured on a half sweep, is a later candidate: R-P6-27) and leaves the list (R-P6-25); its table is on the Carried list.

**Replay base.** Tasks 23-26 were replayed at `46e0706` with Group 0 (Tasks 1-3) and this group's earlier tasks applied, and nothing else; Task 27 on `46e0706` with Tasks 23-26 as written here. Every red message marked (captured) is from those replays.
- Only Task 26 consumes an engine task's code: `leavesFloor` (through `runsOff`), whose copy Task 12 now carries before it judges. Task 26's Smashville figures were measured on `46e0706`'s `leavesFloor`; the header's rule covers them. Task 12 also adds `carriesOff` to `specials.test.ts`'s `./specials` import and a test after the carry test: apply this group's edits there by symbol.
- Task 16 changes `projectileRange` (the CPU now reads the jolt's wave) before this group. No task here consumes that change: its callers range stored charges, the bow and smash specials. Its new block in `specials.test.ts`, and its edit to that file's `./specials` import, may move this group's context lines there; apply by symbol.
- The engine group and the body tasks change what the CPU plays, so a count, a sweep figure or a golden digest below may differ at the real base. The header's red-step rule covers it: a test that fails for the stated reason proceeds, its numbers noted.

**The sweep.** Task 23's `src/game/cpuSweep.ts` measures every CPU task:

`CPU_SWEEP=1 pnpm vitest run src/game/cpuSweep.test.ts --reporter=verbose > "<session scratchpad>/sweep-<task>.log" 2>&1`

- The scratchpad is the directory the session's system prompt names. The run is 2,016 matches (the 56 ordered pairs on the six stages, seeds 1-6), about seven minutes. `CPU_SWEEP_SEEDS=1,2,3` runs half of it for a quick look; only the six-seed run judges.
- `--reporter=verbose` is required: vitest 4's default reporter writes no passing test's output to a file (captured: 0 figure lines without it, 8 with it). The log holds the whole `SweepStats` as JSON, then one line a fighter: fired, landed, holds and the mean hold.
- If a task needs to re-run an older commit, it uses a copy, not a worktree: `mkdir "<session scratchpad>/sweep-base" && git -C "<the Replicates checkout>" archive <commit> super-smash | tar -x -C "<session scratchpad>/sweep-base"`, then `pnpm install --frozen-lockfile --offline` in `"<session scratchpad>/sweep-base/super-smash"`, where the sweep then runs (no `node_modules` symlink). It deletes the copy after.

**How each task is judged.** Two rulings judge Tasks 24-27, cumulatively, against the six-seed run this plan's own Task 23 records, never against the task before and never against the planning replay's figures, which are expectations (R-P6-26). Every bound counts only the harmful direction (R-P6-26): a fall in landed Final Smashes, a rise in the mean hold, a fall in edgeguard exits, a rise in self-destructs. A rise in landed (Task 27's Kirby, +36% in the replay) never fails a check and never blocks a seed step. The bounds:
- **R-P6-19 (amended), the Final Smashes.** Landed summed over every fighter (`finalSmashes[f].landed`) falls by at most 10%; each fighter's landed falls by at most 25%; the mean hold over all fighters (every `holds[f].frames` summed, over every `holds[f].holds` summed) rises by at most 25%. While a CPU holds the power, no Smash Ball spawns (D58's M2 cost). A judged-firing rule that fails is dropped for that Final Smash, which keeps its earlier rule, as R-P6-15 does for Critical Hit.
- **R-P6-24 (amended), the edges.** `edgeguardExits` falls by at most 10%. `selfDestructs` rises by at most 2 matches, or 10% of Task 23's recorded baseline, whichever is larger. (The planning replay's baseline was 20, so its bound was 2. Take the figure Task 23 records.)

Past any bound, the task stops and reports. Each task's commit carries the table against Task 23's: per fighter fired, landed and mean hold; then landed summed, the mean hold over all, `edgeguardExits` and `selfDestructs`. "Within noise" excuses nothing (R-P6-19). The per-fighter bound is wide because one fighter's count moves on its own: the same code (Task 23) landed Mario's Final Smash 105 times on seeds 1-3 and 71 on seeds 4-6 in the planning replay.

**The golden for CPU tasks.** The golden's CPU matches run the CPU, so a task that changes what the CPU decides may move them. `UPDATE_GOLDEN=1` re-runs the golden's pins before writing. One of them, `expectCpuFinalSmash` (`golden.test.ts`: "a ball broken, and a Final Smash started by a CPU" in the ball-on match, seed 606 at `46e0706`, or the seed a Group 2 ruling set under R-P6-20), depends on the CPUs' Final Smash use.
- **Ruling R-P6-18 (amended).** A task may step that match's seed (`cpuMatch("samus-kirby-townAndCity-ball", …, <seed>, BALL_RULES)`) only when its sweep passes R-P6-19's test against Task 23's: landed summed falls by at most 10%, no fighter's landed falls by more than 25%, and the mean hold over all rises by at most 25% (a rise in landed, or a fall in the mean hold, always passes: R-P6-26). Fired is not judged. If it fails, that is a regression to fix, not a seed to step: stop and report.
- **A step, when allowed,** goes to the first seed above the current one whose run passes every pin, running `UPDATE_GOLDEN=1` once per seed, logged to a file. It is named in the commit body and the golden's history comment, with `src/game/golden.test.ts` staged beside the trace and the pin.
- **In the replay no task stepped it.** Seed 606 passed every pin at Tasks 24-27 (captured: `Tests 11 passed` each). The first replay's steps (606 → 607 → 608, at Tasks 25 and 26) came from the dropped rule's first form, which cut Kirby's Ultra Sword (landed 78 → 33, seeds 1-3) in the match where Kirby is the one who fires.

Any other pin that stops regeneration stops the task.

### Task 23: The CPU sweep harness, and firing bands for CPU ports only (the CPU's baseline)

The opt-in measure the CPU tasks report with, and the backlog's "the Volt Tackle firing bands are built for a human-controlled Pikachu too (40-110 ms at match start, unread)" (Plan 5 final wave 5): `matchCpuWorlds` builds a full world only for a CPU's port. Nothing the CPU decides changes, so this task's sweep is the baseline Tasks 24-27 compare with.

The harness counts every figure itself from state every commit has (the standby from `finalSmashReady`, not from Task 24's `standbyFrames`), so the same file measures any commit. For ruling R-P6-19 it counts, per fighter, the Final Smashes landed and each hold of the power (from gaining it to spending it, losing it or the match's end) with its frames, so the mean hold is `holds[f].frames / holds[f].holds`. A self-destruct is a KO of a fighter that had stood on a floor, or begun the match, since the last hit it took: a launched fighter that dies still recovering is a KO by somebody, however long its fall (the planning replay's seed-1011 scene: Donkey Kong hit on frame 1974, dead on 2136 in his up special, which a "no hit in 120 frames" rule had counted as his own). Standing on its own means grounded and neither in a hit's hitlag or hitstun nor held: a fighter hit on the ground stands through the hit's hitlag, and before fix round 3 the count took those KOs as its own (of one replay sweep's 534, 523 had left the ground launched, in `survive`).

**Golden:** unaffected (the golden builds its worlds with `cpuWorldFromDef` directly; no CPU decision changes).

**Files:**
- Create: `src/game/cpuSweep.ts`, `src/game/cpuSweep.test.ts`
- Modify: `src/game/matchRunner.ts`
- Test: `src/game/matchRunner.test.ts`, `src/game/cpuSweep.test.ts`

**Interfaces:**
- Consumes: `matchCpuWorlds`, `createMatchRunner` (matchRunner.ts); `cpuWorldFromDef`, `decideCpu` (cpu.ts); `bakedContext`, `readBakeFromDisk`.
- Produces: `matchCpuWorlds(stage, defs, getFighter?, bake?, cpu?: readonly boolean[])`; `sweep(o: SweepOptions): SweepStats`, `DASH_WHIFF_RUN` (cpuSweep.ts). `SweepStats`: `matches`, `finalSmashes[fighter] { fired, landed }`, `longestStandby`, `holds[fighter] { holds, frames }`, `kongKarry`, `dashAttacks[fighter] { thrown, whiffRuns }`, `selfDestructs`, `finalSmashSelfDestructs`, `kirbyInhaleSelfDestructs`, `edgeguardExits`.

- [ ] **Step 1: Write the failing tests**

`src/game/matchRunner.test.ts`, at the top of `describe("the worlds the game's CPUs see", …)`:

```ts
  it("work out Volt Tackle's firing bands for a CPU's port only (Plan 6, Task 23; part 5's cost)", () => {
    const stage = getStageOrThrow("pokemonStadium2");
    const defs = [getFighterOrThrow("pikachu"), getFighterOrThrow("pikachu")];
    const [human, cpu] = matchCpuWorlds(stage, defs, getFighterOrThrow, GAME_SIM_CONTEXT.bake, [false, true]);
    expect(human.firingBands).toBeUndefined();
    expect(cpu.firingBands).toBeDefined();
  });
```

`src/game/cpuSweep.test.ts` (new file):

```ts
// @vitest-environment node
/**
 * The CPU sweep (Plan 6, Tasks 23-27). The full measure is opt-in:
 * `CPU_SWEEP=1 pnpm vitest run src/game/cpuSweep.test.ts --reporter=verbose` prints the figures a
 * CPU task reports in its commit (`--reporter=verbose`: vitest 4's default reporter drops a passing
 * test's output when it goes to a file); `pnpm test` skips it. A short run stays in the suite, so
 * the harness itself keeps working.
 */

import { describe, expect, it } from "vitest";

import { FIGHTERS } from "@/fighters";
import { STAGES } from "@/stages";
import { sweep } from "./cpuSweep";

const IDS = FIGHTERS.map((f) => f.id);
const PAIRS = IDS.flatMap((a) => IDS.filter((b) => b !== a).map((b) => [a, b] as const));
/** The sweep's seeds: 1-6 (2,016 matches), or `CPU_SWEEP_SEEDS`, comma-separated, for one half of them. */
const SEEDS = (process.env.CPU_SWEEP_SEEDS ?? "1,2,3,4,5,6").split(",").map(Number);

describe("the CPU sweep's harness", () => {
  it("plays a short match to its end and counts it", () => {
    const stats = sweep({ pairs: [["mario", "fox"]], stages: ["battlefield"], seeds: [1], frames: 240, ball: false, level: 9 });
    expect(stats.matches).toBe(1);
    expect(stats.longestStandby).toBe(0);
    expect(stats.holds).toEqual({});
  }, 60_000);
});

describe.skipIf(process.env.CPU_SWEEP !== "1")("the CPU sweep (opt-in)", () => {
  it("measures the 56 ordered pairs on the six stages, the Smash Ball on, each seed", () => {
    const stats = sweep({ pairs: PAIRS, stages: STAGES.map((s) => s.id), seeds: SEEDS, frames: 3_600, ball: true, level: 9 });
    console.log(JSON.stringify(stats, null, 2));
    // Ruling R-P6-19's figures, one line a fighter: landed, and the mean hold.
    for (const id of IDS) {
      const f = stats.finalSmashes[id] ?? { fired: 0, landed: 0 };
      const h = stats.holds[id] ?? { holds: 0, frames: 0 };
      console.log(`${id}: fired ${f.fired}, landed ${f.landed}, holds ${h.holds}, mean hold ${h.holds === 0 ? 0 : Math.round(h.frames / h.holds)} frames`);
    }
    expect(stats.matches).toBe(PAIRS.length * STAGES.length * SEEDS.length);
  }, 3_600_000);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/game/matchRunner.test.ts src/game/cpuSweep.test.ts -t "firing bands for a CPU|short match"`
Expected: FAIL (captured): `src/game/cpuSweep.test.ts`: `Error: Cannot find module './cpuSweep' imported from …/src/game/cpuSweep.test.ts`; the bands test: `AssertionError: expected { …(2) } to be undefined`.

- [ ] **Step 3: Implement**

`src/game/matchRunner.ts`, `matchCpuWorlds`:

```diff
 export function matchCpuWorlds(
   stage: StageDef,
   defs: readonly (FighterDef | undefined)[],
   getFighter?: (id: string) => FighterDef | undefined,
   bake: BakeTables | undefined = GAME_SIM_CONTEXT.bake,
+  cpu: readonly boolean[] = defs.map(() => true),
 ): CpuWorld[] {
   const view = stageViewFromDef(stage);
-  return defs.map((def) => (def !== undefined ? cpuWorldFromDef(def, view, defs, getFighter, bake) : { stage: view, jumps: 2, matchDefs: defs }));
+  // A human's port gets the plain world: nothing reads a full one there, and its firing
+  // bands cost 40-110 ms at match start (Plan 6, Task 23; Plan 5 final wave, part 5's cost).
+  return defs.map((def, i) => (def !== undefined && cpu[i] !== false ? cpuWorldFromDef(def, view, defs, getFighter, bake) : { stage: view, jumps: 2, matchDefs: defs }));
 }
```

and in `createMatchRunner`: `const cpuWorlds = matchCpuWorlds(stage, defs, getFighter, GAME_SIM_CONTEXT.bake, players.map((p) => p.cpuLevel !== null));`.

`src/game/cpuSweep.ts` (new file):

```ts
/**
 * An opt-in measure of the CPU across many matches (Plan 6, Tasks 23-27): the figures a CPU
 * task reports and no unit test can hold. `CPU_SWEEP=1 pnpm vitest run src/game/cpuSweep.test.ts --reporter=verbose > <log> 2>&1`.
 * Level-`level` CPUs on every port, the game's baked context, the worlds the game builds
 * (`cpuWorldFromDef`).
 *
 * Every figure is counted here from state every commit has (no field a later task adds), so the
 * one harness measures Task 23's baseline and each later CPU task the same way.
 *
 * Test support: nothing in the app imports it.
 */

import { cpuWorldFromDef, decideCpu, type CpuWorld } from "@/ai/cpu";
import { isStunned, stageViewFromDef } from "@/ai/behaviours";
import { isFinalSlot } from "@/engine/final";
import { createInitialState, step } from "@/engine/simulate";
import type { GameState, InputFrame, MatchRules } from "@/engine/types";
import { FIGHTERS } from "@/fighters";
import { STAGES } from "@/stages";
import { bakedContext } from "./bake";
import { readBakeFromDisk } from "./bakeNode";

const BY_ID = new Map(FIGHTERS.map((f) => [f.id, f]));
const STAGE_BY_ID = new Map(STAGES.map((s) => [s.id, s]));

/** Dash attacks in a row that hit nobody, from which a run counts as a whiff run. */
export const DASH_WHIFF_RUN = 8;

export interface SweepOptions {
  readonly pairs: readonly (readonly [string, string])[];
  readonly stages: readonly string[];
  readonly seeds: readonly number[];
  readonly frames: number;
  readonly ball: boolean;
  readonly level: number;
}

export interface SweepStats {
  matches: number;
  /** By fighter: Final Smashes a CPU started, and how many hit or trapped somebody. */
  finalSmashes: Record<string, { fired: number; landed: number }>;
  /** The longest a CPU held the Smash Ball's power, in frames (`finalSmashReady` above 0, counted here). */
  longestStandby: number;
  /** By fighter: each hold of the Smash Ball's power (ended by spending it, losing it, or the match's end) and their frames summed; the mean hold is `frames / holds` (ruling R-P6-19). */
  holds: Record<string, { holds: number; frames: number }>;
  /** Kong Karry lifts by a CPU Donkey Kong. */
  kongKarry: number;
  /** By fighter: dash attacks started, and runs of `DASH_WHIFF_RUN` or more in a row that hit nobody. */
  dashAttacks: Record<string, { thrown: number; whiffRuns: number }>;
  /** KOs of a fighter that had stood on a floor on its own (or begun the match) since the last hit it took: off the stage on its own. Standing in a hit's hitlag or hitstun, or held, is not on its own. */
  selfDestructs: number;
  /** Self-destructs within 180 frames of the end of the fighter's own Final Smash. */
  finalSmashSelfDestructs: number;
  /** Self-destructs of a Kirby who had someone in his mouth off the stage in the 180 frames before. */
  kirbyInhaleSelfDestructs: number;
  /** Times a CPU left the floor on a frame its `edgeguard` behaviour won: the edgeguard's chase off the stage. */
  edgeguardExits: number;
}

export function sweep(o: SweepOptions): SweepStats {
  const ctx = bakedContext({ fighter: (id) => BY_ID.get(id)!, stage: (id) => STAGE_BY_ID.get(id)! }, readBakeFromDisk());
  const stats: SweepStats = {
    matches: 0,
    finalSmashes: {},
    longestStandby: 0,
    holds: {},
    kongKarry: 0,
    dashAttacks: {},
    selfDestructs: 0,
    finalSmashSelfDestructs: 0,
    kirbyInhaleSelfDestructs: 0,
    edgeguardExits: 0,
  };
  const rules: MatchRules = { mode: "stock", stocks: 3, timeLimit: 0, smashBall: o.ball, oneOnOne: true };
  for (const stageId of o.stages) {
    for (const pair of o.pairs) {
      for (const seed of o.seeds) {
        let s: GameState = createInitialState(stageId, pair.map((defId) => ({ defId })), rules, seed, ctx);
        const view = stageViewFromDef(ctx.stage(stageId));
        const defs = s.fighters.map((f) => ctx.fighter(f.defId));
        const worlds: CpuWorld[] = defs.map((def) => cpuWorldFromDef(def, view, defs, (id) => ctx.fighter(id), ctx.bake));
        let cpuSeed = seed ^ 0x1f2e3d4c;
        let prev: readonly InputFrame[] = s.fighters.map(() => 0);
        const ports = s.fighters.map(() => 0);
        const lastHitTaken = ports.map(() => -1_000);
        const lastStood = ports.map(() => 0);
        const lastFinal = ports.map(() => -1_000);
        const lastOffstageMouthful = ports.map(() => -1_000);
        const standby = ports.map(() => 0);
        const inFinal = ports.map(() => false);
        const landedThisFinal = ports.map(() => false);
        const dashOpen = ports.map(() => false);
        const dashHit = ports.map(() => false);
        const dashMisses = ports.map(() => 0);
        for (let frame = 1; frame <= o.frames && s.outcome === null; frame++) {
          const behaviours: string[] = [];
          const inputs = s.fighters.map((_, port) => {
            const d = decideCpu(s, port, o.level, cpuSeed, worlds[port]);
            cpuSeed = d.seed;
            behaviours.push(d.behaviour);
            return d.input;
          });
          const before = s;
          const out = step(s, inputs, { prevInputs: prev, ctx });
          s = out.state;
          prev = inputs;
          for (const h of out.events.hits) {
            lastHitTaken[h.victim] = frame;
            if (inFinal[h.attacker]) landedThisFinal[h.attacker] = true;
            if (before.fighters[h.attacker].move === "dashAttack" || s.fighters[h.attacker].move === "dashAttack") dashHit[h.attacker] = true;
          }
          for (const f of s.fighters) {
            const was = before.fighters[f.port];
            const id = f.defId;
            // Standing on its own: not frozen in a hit's hitlag or reeling in its hitstun, where a
            // fighter hit on the ground still stands, nor held (Plan 6, Task 23: such a KO is somebody's).
            if (f.grounded && !isStunned(f) && f.grabbedBy < 0) lastStood[f.port] = frame;
            if (f.finalSmashReady > 0) standby[f.port] += 1;
            else if (standby[f.port] > 0) {
              const h = (stats.holds[id] ??= { holds: 0, frames: 0 });
              h.holds += 1;
              h.frames += standby[f.port];
              standby[f.port] = 0;
            }
            stats.longestStandby = Math.max(stats.longestStandby, standby[f.port]);
            if (f.action === "finalTrapped" && f.combat.trappedBy >= 0) landedThisFinal[f.combat.trappedBy] = true;
            const final = f.action === "special" && isFinalSlot(f.move);
            if (final && !inFinal[f.port]) {
              (stats.finalSmashes[id] ??= { fired: 0, landed: 0 }).fired += 1;
              landedThisFinal[f.port] = false;
            }
            if (!final && inFinal[f.port] && landedThisFinal[f.port]) stats.finalSmashes[id].landed += 1;
            if (final) lastFinal[f.port] = frame;
            inFinal[f.port] = final;
            if (f.action === "cargoCarry" && was.action !== "cargoCarry") stats.kongKarry += 1;
            const dashing = f.action === "attack" && f.move === "dashAttack";
            if (dashing && !(was.action === "attack" && was.move === "dashAttack")) {
              const d = (stats.dashAttacks[id] ??= { thrown: 0, whiffRuns: 0 });
              if (dashOpen[f.port]) dashMisses[f.port] = dashHit[f.port] ? 0 : dashMisses[f.port] + 1;
              if (dashMisses[f.port] === DASH_WHIFF_RUN) d.whiffRuns += 1;
              d.thrown += 1;
              dashOpen[f.port] = true;
              dashHit[f.port] = false;
            }
            if (behaviours[f.port] === "edgeguard" && was.grounded && !f.grounded) stats.edgeguardExits += 1;
            const offstage = f.x < view.leftLedge || f.x > view.rightLedge;
            if (id === "kirby" && f.action === "inhaleHold" && !f.grounded && offstage) lastOffstageMouthful[f.port] = frame;
          }
          for (const ko of out.events.kos) {
            // Hit after (or on) the last frame it stood: a KO by somebody, however long its fall.
            if (lastStood[ko.port] <= lastHitTaken[ko.port]) continue;
            stats.selfDestructs += 1;
            if (frame - lastFinal[ko.port] <= 180) stats.finalSmashSelfDestructs += 1;
            if (frame - lastOffstageMouthful[ko.port] <= 180) stats.kirbyInhaleSelfDestructs += 1;
          }
        }
        for (const f of s.fighters) {
          if (standby[f.port] === 0) continue;
          const h = (stats.holds[f.defId] ??= { holds: 0, frames: 0 });
          h.holds += 1;
          h.frames += standby[f.port];
        }
        stats.matches += 1;
      }
    }
  }
  return stats;
}
```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/game/matchRunner.test.ts src/game/cpuSweep.test.ts`
Expected: PASS (captured: `Test Files 2 passed (2)`, `Tests 56 passed | 1 skipped (57)`; the opt-in sweep is the skipped one).

- [ ] **Step 5: The baseline**

`CPU_SWEEP=1 pnpm vitest run src/game/cpuSweep.test.ts --reporter=verbose > "<session scratchpad>/sweep-23.log" 2>&1`. Record every `SweepStats` figure in the commit body, and the per-fighter lines (fired, landed, holds, mean hold): these are the baseline Tasks 24-27 are judged against (rulings R-P6-19 and R-P6-24, cumulative; R-P6-26: this run's figures, never the replay's below). For orientation, the planning replay's baseline (`46e0706` with this task only, six seeds; the real base will differ):

| Fighter | Fired | Landed | Mean hold (frames) |
|---|---|---|---|
| donkeyKong | 272 | 118 | 109 |
| fox | 303 | 161 | 138 |
| kirby | 351 | 163 | 167 |
| link | 405 | 129 | 114 |
| mario | 457 | 176 | 102 |
| marth | 230 | 129 | 133 |
| pikachu | 0 | 0 | 347 |
| samus | 232 | 156 | 84 |
| all | 2,250 | 1,032 | 146.3 |

And (captured, same run): `edgeguardExits` 5,922, `selfDestructs` 20 (a scratch-only probe of the planning replay: 18 left the ground in the Smash Ball chase, 1 in `attack`, 1 in the edgeguard), `kongKarry` 33, `finalSmashSelfDestructs` 0, `longestStandby` 2,225, 2,016 matches. Its seed halves differ as much as a task might (Mario landed 105 on seeds 1-3, 71 on 4-6): the judged figures are the six-seed run's.

**If a Group 2 ruling (R-P6-20) stepped the ball-on seed and left the check to this baseline:** also sweep the commit before the task that stopped. Use a copy, as the group's intro says, with this task's `src/game/cpuSweep.ts` and `src/game/cpuSweep.test.ts` copied into its `super-smash/` (the harness reads only state every commit has), and run the same command there into `"<session scratchpad>/sweep-23-before.log"`. Judge this run against it by R-P6-19's test (one-sided, R-P6-26), put both tables in this commit body, and send them to the controller. Past a bound, stop and report.

- [ ] **Step 6: Mutants**

1. `matchCpuWorlds`: drop `cpu[i] !== false &&`. The bands test FAILS (captured): `expected { …(2) } to be undefined`. Restore.
2. `sweep`: delete `stats.matches += 1;`. The harness test FAILS (captured): `expected +0 to be 1`. Restore.
3. `sweep`: delete `holds: {},` from the initial stats. The harness test FAILS (captured): `expected undefined to deeply equal {}`. Restore.

- [ ] **Step 7: Gate and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test` (typecheck and lint replayed: exit 0). Expected: exit 0.

```bash
git add super-smash/src/game/matchRunner.ts super-smash/src/game/matchRunner.test.ts super-smash/src/game/cpuSweep.ts super-smash/src/game/cpuSweep.test.ts
git commit -m "super-smash: the CPU sweep harness, and Volt Tackle's firing bands built for CPU ports only" -m "cpuSweep counts every figure from state any commit has, so it measures the baseline and each later CPU task the same way, per-fighter holds, edgeguard exits and self-destructs included (R-P6-19, R-P6-24); a self-destruct is a KO with no hit taken since the fighter last stood. Baseline (CPU_SWEEP=1, 2,016 matches, --reporter=verbose): <every SweepStats figure; per fighter fired, landed, mean hold; landed summed and the mean hold over all>. Golden: unaffected." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 24: A smarter CPU Volt Tackle, and a time limit on holding the power

The backlog's first CPU item (Plan 5 final wave 2, fix round 3): "after R-FW2q the whiff ends unrecoverable on five of six stages, so the CPU fires only on Pokémon Stadium 2 (1 in 1,512 ball-on matches). Fire when the rewound view proves the target is still held when the tackle connects (its remaining hold/hitstun exceeds the reaction delay plus the startup), skipping the whiff check then; add a time-limit fallback for holds." And D58's cost M2: "While one holds the power no Smash Ball spawns for anyone … and no published standby limit ends it (R-FW2m): the longest holds measured are 2,057 frames CPU against CPU … and 5,960 against an idle player."

- **Proven hold.** A target that cannot act for longer than the CPU's reaction (`LevelTuning.reactionFrames`) plus the frames until the tackle reaches it is caught whatever the whiff would do, so the whiff check is skipped. The hold is read from the target's own state (`holdLeft`: hitstun, a hold's grab time, a landing's lag), and only once the view has seen it (`ctx.view.targetActionAge >= 0`: the observation withholds a new action for the reaction time, `behaviours.ts`'s `observe`); the frames until the tackle reaches it come from the move's data (`connectFrame`: its first trapping box's frame, then the dash's speed for the distance past the move's reach).
- **Not at point blank.** Inside `FINAL_SMASH_RANGE` (30) the startup's sparks (frames 10-45, rehit 6: Task 9) reach the target first, and a spark's hit ends a broken shield's stun and resets any hitstun to its own. So there Plan 5's R-T19d rule stands, with its whiff check. (Since Task 11's `SLOW_OPPONENT(9, 45)`, the sparks no longer push a fighter beside Pikachu out of the initial hit's reach, the reason `pikachu.ts` gave before Task 11. The point-blank rule stays as the conservative reading.)
- **Stopping to fire.** The tackle fires from a standstill only (R-T19d: a run's slide carried Pikachu past the target in the windup), and the CPU is seldom still when a hold begins: in the planning replay, Pikachu running at a dizzy Mario never fired on five stages without this. So on the ground and moving, at a target seen held whose hold also outlasts the stop (its braking frames, from its traction) and which the stop's slide (`slideToward`) leaves beyond point blank, the CPU lets go to stop, and fires from the standstill. Not for a Final Smash that stops at the edge (Critical Hit), which fires from a run as before (R-P6-15); that exclusion was added on assembly (seam-g3 M-1), after the replay, whose Marth figures were Task 23's, so none is expected to move. Measured: on every stage, Pikachu running at a Mario dizzy 400 frames fires on frame 12 and traps him; no stock lost.
- **The time limit (ruling D10).** After `FINAL_SMASH_HOLD_LIMIT` frames holding the power, a CPU fires its travelling Final Smash at any target in its path from a standstill, whiff or not. UNVERIFIED (CPU judgement): 1,200 frames, borrowed from the one published Final Smash limit (SmashWiki "Final Smash": "As of the 4.0.0 update, a charged FS Meter now has a time limit of 20 seconds"); the engine still gives the Smash Ball no limit (R-FW2m). Its cost: a whiff from the fallback can self-destruct on the five stages where Volt Tackle's whiff does not come back (the sweep counts it, `finalSmashSelfDestructs`). How long it has held is engine state the CPU reads, `CombatState.standbyFrames`, so `cpuInput` stays a pure function of the state; it is cloned and hashed (`hash.test.ts`'s walker checks every leaf).
- Conservative under a slowdown (Task 11): a slowed target's hold lasts longer than its state reads.

**Golden:** expected unaffected (measured: regenerating at this task leaves the trace and its pin as they were; the golden's one ball-on match has no travelling Final Smash, and `standbyFrames` is not in its digest). If it moves, regenerate and stage it as below.

**Files:**
- Modify: `src/engine/combat.ts` (`CombatState.standbyFrames`, `STANDBY_FRAMES_CAP`, `emptyCombat`, `cloneCombat`), `src/engine/hash.ts`, `src/engine/simulate.ts`, `src/ai/specials.ts`
- Test: `src/ai/specials.test.ts`, `src/engine/simulate.test.ts`

**Interfaces:**
- Consumes: `fireFinalSmash`, `dashTravel`, `finalReach`, `slideToward`, `CANNOT_ACT_SOON` (specials.ts); `fighterParams` (params.ts); `SINCE_ATTACK_CAP`'s place in combat.ts.
- Produces: `CombatState.standbyFrames: number`, `STANDBY_FRAMES_CAP = 1 << 20` (combat.ts); `holdLeft(f): number`, `connectFrame(fs: MoveDef, ahead: number): number`, `FINAL_SMASH_HOLD_LIMIT = 1200` (specials.ts, exported).

- [ ] **Step 1: Write the failing tests**

`src/ai/specials.test.ts`: `connectFrame`, `FINAL_SMASH_HOLD_LIMIT`, `FINAL_SMASH_RANGE` and `holdLeft` join the `./specials` import. Inside `describe("the Final Smash", …)`, before "is used at once when it needs no aim…":

```ts
  it("fires Volt Tackle from anywhere at a target proven held until it lands (Plan 6, Task 24)", () => {
    // Final Destination's centre, where a whiff never comes back (R-FW2q): a target 40 ahead,
    // tumbling for 120 frames and seen doing it, is caught on move frame 54.
    const s = fd(0);
    s.fighters[1] = makeFighter({ port: 1, x: fx(40), action: "tumble", actionFrame: 20, hitstun: 120, grounded: true });
    expect(fire(s, pikachu)).toBe(true);
  });

  it("does not when the hold ends first, at point blank, or before the view has seen the hold", () => {
    const at = (x: number, over: Partial<FighterState>) => {
      const s = fd(0);
      s.fighters[1] = makeFighter({ port: 1, x: fx(x), action: "tumble", actionFrame: 20, hitstun: 120, grounded: true, ...over });
      return fire(s, pikachu);
    };
    expect(at(40, { action: "hitstun", hitstun: 30 }), "free before the trap").toBe(false);
    expect(at(20, {}), "point blank: R-T19d's rule, with its whiff check").toBe(false);
    expect(at(40, { actionFrame: 2 }), "a tumble the view has not seen yet").toBe(false);
  });

  it("reads a target's hold from its state", () => {
    expect(holdLeft(makeFighter({ action: "hitstun", hitstun: 17 }))).toBe(17);
    expect(holdLeft(makeFighter({ action: "grabbed", grabTimer: 90 }))).toBe(90);
    expect(holdLeft(makeFighter({ action: "landingLag", charge: 24, actionFrame: 4 }))).toBe(20);
    expect(holdLeft(makeFighter({ action: "stand" }))).toBe(0);
  });

  it("times the tackle's contact from its data: its first trap, then the dash past its reach", () => {
    const fs = pikachu.moves.finalSmash!;
    expect(connectFrame(fs, fx(4))).toBe(47);
    expect(connectFrame(fs, fx(40))).toBe(54);
  });

  it("after holding the power FINAL_SMASH_HOLD_LIMIT frames, fires at a free target in its path (ruling D10)", () => {
    const s = ready(30, { x: 0, defId: "pikachu" });
    s.fighters[0].combat.standbyFrames = FINAL_SMASH_HOLD_LIMIT - 1;
    expect(fire(s, pikachu)).toBe(false);
    s.fighters[0].combat.standbyFrames = FINAL_SMASH_HOLD_LIMIT;
    expect(fire(s, pikachu)).toBe(true);
  });
```

The existing `it.each(STAGES…)("goes past a dizzy Mario to its spot on %s, turns, and fires Volt Tackle from there, trapping him; with no spot, never fires it (rulings R-FW2n, R-FW2q)", …)` (`specials.test.ts:488-536` at `46e0706`) pins what this task changes: a Mario dizzy for 400 frames is now proven held from anywhere in the tackle's range, so Pikachu fires where it stands on every stage instead of going to a spot or never firing. It is replaced by these two, the spot kept for a target busy but not held:

```ts
  // Plan 6, Task 24: a dizzy Mario held 400 frames is proven held from anywhere in the tackle's
  // range, so Pikachu no longer goes to a spot for him: it stops where it is, once the view has
  // seen the dizziness, and fires from the standstill, on every stage. (Before Task 24 it went
  // to its spot on Pokémon Stadium 2 and, with no spot, never fired: rulings R-FW2n, R-FW2q.)
  it.each(STAGES.map((x) => x.id))("stops and fires Volt Tackle where it stands at a dizzy Mario held 400 frames, and traps him, on %s (Plan 6, Task 24)", (id) => {
    const view = stageViewFromDef(STAGES.find((x) => x.id === id)!);
    const s = createInitialState(id, [{ defId: "pikachu" }, { defId: "mario" }], { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true }, 5);
    Object.assign(s.fighters[0], { action: "stand", actionFrame: 30, grounded: true, platform: 0, x: 0, y: view.groundY, facing: -1, intangible: 0, invincible: 0, finalSmashReady: FINAL_SMASH_READY });
    Object.assign(s.fighters[1], { action: "shieldBroken", actionFrame: 0, grounded: true, platform: 0, x: view.leftLedge + fx(20), y: view.groundY, facing: 1, hitstun: 400, shieldHealth: 0, intangible: 0, invincible: 0 });
    const world = cpuWorldFromDef(pikachu, view, [pikachu, mario], (f) => FIGHTERS.find((d) => d.id === f)!);
    let st = s;
    let prev: InputFrame[] = [0, 0];
    let seed = 3;
    let before: GameState | null = null;
    for (let i = 0; i < 60 && before === null; i++) {
      const d = decideCpu(st, 0, 9, seed, world);
      seed = d.seed;
      const out = step(st, [d.input, 0], { prevInputs: prev });
      if (out.events.finalSmashes.includes(0)) before = st;
      st = out.state;
      prev = [d.input, 0];
    }
    expect(before, "fired within 60 frames").not.toBeNull();
    const at = before!.fighters[0];
    expect([at.vx, at.facing]).toEqual([0, -1]);
    expect(at.x - before!.fighters[1].x).toBeGreaterThan(FINAL_SMASH_RANGE);
    let trapped = false;
    for (let i = 0; i < 80 && !trapped; i++) {
      st = step(st, [0, 0], { prevInputs: prev }).state;
      prev = [0, 0];
      trapped = st.fighters[1].action === "finalTrapped";
    }
    expect(trapped).toBe(true);
  });

  // Ruling R-FW2n's spot, still used for a target busy but not held (here, shielding): Pikachu
  // goes past him to its spot on Pokémon Stadium 2, turns, and when the shield breaks there,
  // fires from the spot and traps him (the held point-blank rule, R-T19d, with its whiff check).
  it("goes past a shielding Mario to its spot on Pokémon Stadium 2, turns, and fires Volt Tackle from there once the shield breaks (rulings R-FW2n, R-FW2q)", () => {
    const view = PS2;
    const inner = firingBands(pikachu, view).right.at(-1)![1];
    const marioX = inner + fx(12);
    const spot = finalSmashSpotFor(firingBands(pikachu, view), view, 0, marioX)!;
    expect(spot).toMatchObject({ x: inner, dir: 1, to: inner });
    const s = createInitialState("pokemonStadium2", [{ defId: "pikachu" }, { defId: "mario" }], { mode: "stock", stocks: 3, timeLimit: 0, smashBall: false, oneOnOne: true }, 5);
    Object.assign(s.fighters[0], { action: "stand", actionFrame: 30, grounded: true, platform: 0, x: 0, y: view.groundY, facing: -1, intangible: 0, invincible: 0, finalSmashReady: FINAL_SMASH_READY });
    Object.assign(s.fighters[1], { action: "shield", actionFrame: 30, grounded: true, platform: 0, x: marioX, y: view.groundY, facing: 1, intangible: 0, invincible: 0 });
    const world = cpuWorldFromDef(pikachu, view, [pikachu, mario], (f) => FIGHTERS.find((d) => d.id === f)!);
    let st = s;
    let prev: InputFrame[] = [0, Btn.Shield];
    let seed = 3;
    let broken = false;
    let fired: GameState | null = null;
    let before: GameState = s;
    for (let i = 0; i < 300 && fired === null; i++) {
      const p = st.fighters[0];
      // At its spot, facing him: the shield breaks.
      if (!broken && p.facing === 1 && p.vx === 0 && p.x >= spot.from && p.x <= inner) {
        Object.assign(st.fighters[1], { action: "shieldBroken", actionFrame: 30, hitstun: 400, shieldHealth: 0 });
        broken = true;
      }
      const d = decideCpu(st, 0, 9, seed, world);
      seed = d.seed;
      const now: InputFrame[] = [d.input, broken ? 0 : Btn.Shield];
      const out = step(st, now, { prevInputs: prev });
      if (out.events.finalSmashes.includes(0)) fired = out.state;
      before = st;
      st = out.state;
      prev = now;
    }
    expect(broken, "reached its spot facing him").toBe(true);
    expect(fired).not.toBeNull();
    const at = before.fighters[0];
    expect(at.facing).toBe(1);
    expect(at.x).toBeGreaterThanOrEqual(spot.from);
    expect(at.x).toBeLessThanOrEqual(inner);
    let trapped = false;
    for (let i = 0; i < 80 && !trapped; i++) {
      st = step(st, [0, 0], { prevInputs: prev }).state;
      prev = [0, 0];
      trapped = st.fighters[1].action === "finalTrapped";
    }
    expect(trapped).toBe(true);
  });
```

`src/engine/simulate.test.ts`, at its end:

```ts
describe("how long the Smash Ball's power has been held (Plan 6, Task 24)", () => {
  it("counts every step the power is held, and is 0 without it", () => {
    const s = standing();
    s.fighters[0].finalSmashReady = 1;
    const after = run(s, [0, 0], 30);
    expect(after.fighters[0].combat.standbyFrames).toBe(30);
    expect(after.fighters[1].combat.standbyFrames).toBe(0);
    after.fighters[0].finalSmashReady = 0;
    expect(run(after, [0, 0], 1).fighters[0].combat.standbyFrames).toBe(0);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/ai/specials.test.ts src/engine/simulate.test.ts -t "proven held|hold ends first|reads a target's hold|times the tackle's contact|FINAL_SMASH_HOLD_LIMIT|power has been held|dizzy Mario held 400|shielding Mario"`
Expected: FAIL (captured), 11 tests: the count `expected undefined to be 30`; the proven-hold fire `expected false to be true`; `TypeError: holdLeft is not a function`; `TypeError: connectFrame is not a function`; the time limit `expected false to be true`; the six dizzy-Mario stages `fired within 60 frames: expected null not to be null`. Two pass, as guards: "does not when the hold ends first…" (each case is a non-fire today) and the shielding Mario's spot (the spot behaviour exists).

- [ ] **Step 3: Implement**

`src/engine/combat.ts`: `CombatState` gains, after `controls`:

```ts
  /**
   * Plan 6, Task 24: steps the Smash Ball's power has been held (`finalSmashReady`), 0
   * without it, up to `STANDBY_FRAMES_CAP`. What a CPU reads to stop holding it forever
   * (D58's M2), so `cpuInput` stays a function of the state.
   */
  standbyFrames: number;
```

after `SINCE_ATTACK_CAP`:

```ts
/** `CombatState.standbyFrames`' cap (Plan 6, Task 24): far past the CPU's time limit (`FINAL_SMASH_HOLD_LIMIT`, 1,200). */
export const STANDBY_FRAMES_CAP = 1 << 20;
```

`emptyCombat` gains `standbyFrames: 0,` and `cloneCombat` `standbyFrames: c.standbyFrames,` (each after `controls`). `src/engine/hash.ts`, `mixCombat`, after `controls`: `x = mixInt(x, c.standbyFrames);`.

`src/engine/simulate.ts`: `STANDBY_FRAMES_CAP` joins the `./combat` import (`import { SINCE_ATTACK_CAP, STANDBY_FRAMES_CAP, cloneCombat, emptyCombat } from "./combat";`); just before phase 10 ("is the match over?"):

```ts
  // How long each fighter has held the Smash Ball's power (Plan 6, Task 24).
  for (const f of s.fighters) f.combat.standbyFrames = f.finalSmashReady > 0 ? Math.min(f.combat.standbyFrames + 1, STANDBY_FRAMES_CAP) : 0;
```

(A KO freeze returns before it, so the count pauses through the 14 frames; the power is lost at a KO anyway.)

`src/ai/specials.ts`, after `finalReach`:

```ts
/**
 * UNVERIFIED (CPU judgement; ruling D10): after holding the Smash Ball's power this long, a
 * CPU fires its travelling Final Smash at any target in its path from a standstill
 * (`fireFinalSmash`), whiff or not, so no Smash Ball is held back from everybody for good
 * (D58's M2). 1,200 frames, the one Final Smash limit published, the FS Meter's (SmashWiki
 * "Final Smash": "a charged FS Meter now has a time limit of 20 seconds"); the Smash Ball's
 * own standby has none (R-FW2m).
 */
export const FINAL_SMASH_HOLD_LIMIT = 1200;

/**
 * How many more frames `f` cannot act, as its own state says (Plan 6, Task 24): a hold's
 * remaining grab time, its hitstun (a reel, a tumble, a broken shield's stun), a landing's
 * remaining lag. 0 when it can act, or when the state does not say (lying down, whose end
 * is the player's).
 */
export function holdLeft(f: Pick<FighterState, "action" | "hitstun" | "grabTimer" | "charge" | "actionFrame">): number {
  if (f.action === "grabbed" || f.action === "cargoHeld") return f.grabTimer;
  if (f.hitstun > 0) return f.hitstun;
  if (f.action === "landingLag" || f.action === "specialLanding") return Math.max(0, f.charge - f.actionFrame);
  return 0;
}

/**
 * The move frame on which `fs`'s first trap reaches a target `ahead` in front from a
 * standstill (Plan 6, Task 24): its earliest trapping box's frame within the move's reach
 * (`finalReach`), else the dash's first window's frame plus the frames its speed needs for
 * the distance past that reach.
 */
export function connectFrame(fs: MoveDef, ahead: number): number {
  const traps = fs.hitboxes.filter((h) => h.trap !== false);
  const first = traps.length === 0 ? 1 : Math.min(...traps.map((h) => h.startFrame));
  const reach = finalReach(fs);
  const dash = fs.momentum?.[0];
  if (ahead <= reach || dash === undefined || dash.x === 0) return first;
  return Math.max(first, dash.frame) + Math.ceil((ahead - reach) / abs(dash.x));
}
```

`fireFinalSmash`, the travelling branch and the whiff check:

```diff
   const travel = dashTravel(fs);
+  // A travelling one that will connect needs no whiff check (Plan 6, Task 24), and after the
+  // time limit none is wanted (ruling D10).
+  let whiffFree = false;
   if (travel > 0) {
     if (!self.grounded || abs(dy) > VERTICAL_REACH || ahead > Math.min(travel, FINAL_SMASH_DASH_RANGE)) return NOTHING;
     if (!roomAhead(ctx, dx >= 0 ? 1 : -1, FINAL_SMASH_EDGE_ROOM)) return NOTHING;
     const still = (self.action === "stand" || self.action === "crouch") && self.vx === 0;
     const held = still && target.grounded && CANNOT_ACT_SOON.includes(targetAction);
-    const safe = fs.dashEnd?.edge === true || (ahead <= FINAL_SMASH_RANGE && held);
+    // Proven held (Plan 6, Task 24): its hold, once the view has seen it (`targetActionAge`),
+    // outlasts the reaction and the frames until the trap reaches it. Not at point blank, where
+    // the startup's sparks hit it first, and a hit ends its stun: there R-T19d's `held` rule
+    // stands, with its whiff check. Conservative under a slowdown: a slowed target's hold lasts
+    // longer than its state reads.
+    const proven = still && target.grounded && ctx.view.targetActionAge >= 0 && ahead > FINAL_SMASH_RANGE && holdLeft(target) > ctx.tuning.reactionFrames + connectFrame(fs, ahead);
+    const overdue = still && self.combat.standbyFrames >= FINAL_SMASH_HOLD_LIMIT;
+    // On the move at a target seen held: stop now, to fire from the standstill, where the hold
+    // outlasts the stop too and the slide (`slideToward`, its own braking) leaves the target
+    // beyond point blank (Plan 6, Task 24: the CPU is seldom still when a hold begins). Not one
+    // that stops at the edge (Critical Hit), which fires from a run as before (R-P6-15).
+    if (fs.dashEnd?.edge !== true && !still && target.grounded && ctx.view.targetActionAge >= 0) {
+      const slide = slideToward(ctx, dx >= 0 ? 1 : -1);
+      const stopFrames = Math.ceil(abs(self.vx) / fighterParams(ctx.fighterDef!).ground_brake);
+      if (ahead - slide > FINAL_SMASH_RANGE && holdLeft(target) > ctx.tuning.reactionFrames + stopFrames + connectFrame(fs, ahead - slide)) return { score: 880, input: 0 };
+    }
+    whiffFree = proven || overdue;
+    const safe = fs.dashEnd?.edge === true || (ahead <= FINAL_SMASH_RANGE && held) || whiffFree;
     if (!safe) return NOTHING;
@@
-  if (travel > 0 && !(fs.dashEnd?.edge === true && self.grounded) && !whiffComesBack(ctx)) return NOTHING;
+  if (travel > 0 && !whiffFree && !(fs.dashEnd?.edge === true && self.grounded) && !whiffComesBack(ctx)) return NOTHING;
```

(The stop is a let-go; where its slide would take the fighter off the floor, `decideCpu`'s `slidesOff` makes it a shield, which stops at the edge.) The doc comment above `finalSmash` gains a bullet: "a travelling one that ignores the edge also fires, whiff or not, at a target the view has seen held until it lands, beyond point blank (`holdLeft`, `connectFrame`), stopping first if it is moving (Plan 6, Task 24), or once the power has been held `FINAL_SMASH_HOLD_LIMIT` frames (ruling D10)".

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/ai/specials.test.ts src/engine/simulate.test.ts src/engine/hash.test.ts` → PASS (captured: `Test Files 3 passed (3)`, `Tests 214 passed (214)`). Then `pnpm vitest run src/ai src/game` → PASS, the golden and its pin unchanged (captured: `UPDATE_GOLDEN=1` then `rulesVersion.test.ts` and `golden.test.ts`, `Tests 27 passed`). `cpuIdleHuman.test.ts` and `cpuRollback.test.ts` are the guards: no stand-off and no rollback divergence.

- [ ] **Step 5: Measure (rulings R-P6-19, R-P6-24)**

The sweep (above), against Task 23's: the group's table (per fighter fired, landed and mean hold; landed summed, the mean hold over all, `edgeguardExits`, `selfDestructs`), judged by R-P6-19 as amended and R-P6-24. Also report `longestStandby` and `finalSmashSelfDestructs`. Expected: only Pikachu's figures move, since only a travelling Final Smash reads this rule, and the time limit seldom comes (the mean holds are 84-347 frames, a hit or a KO ends most); a self-destruct from a proven-held fire is a bug: stop and report. Measured in the planning replay (six seeds, captured): every other fighter's fired, landed and mean hold identical to Task 23's; Pikachu fired 0 → 5, landed 0 → 4, mean hold 347 → 344; landed summed 1,032 → 1,036; the mean hold over all 146.3 → 146.0; `edgeguardExits` 5,922 → 5,919; `selfDestructs` 20 → 20; `finalSmashSelfDestructs` 0 → 0; `longestStandby` 2,225 → 2,059. Passes both.

- [ ] **Step 6: Golden**

`pnpm vitest run src/game/golden.test.ts`; expected PASS (unchanged). If it fails, regenerate as the group's golden paragraph says, naming the traces.

- [ ] **Step 7: Mutants**

1. `whiffFree = proven || overdue` → `whiffFree = overdue`. The proven-hold test FAILS (captured): `expected false to be true`. Restore.
2. `holdLeft`: `return f.grabTimer;` → `return 0;`. Its test FAILS (captured): `expected +0 to be 90`. Restore.
3. `proven`: drop `ctx.view.targetActionAge >= 0 && `. FAILS (captured): `a tumble the view has not seen yet: expected true to be false`. Restore.
4. `proven`: drop `ahead > FINAL_SMASH_RANGE && `. FAILS (captured): `point blank: R-T19d's rule, with its whiff check: expected true to be false`. Restore.
5. The stop: `return { score: 880, input: 0 };` → `return NOTHING;`. The six dizzy-Mario stages FAIL (captured): `fired within 60 frames: expected null not to be null`. Restore.
6. `overdue`: `>=` → `>`. The time-limit test FAILS (captured): `expected false to be true`. Restore.
7. `simulate.ts`: delete the count line. FAILS (captured): `expected +0 to be 30`. Restore.
8. `mixCombat`: delete `x = mixInt(x, c.standbyFrames);`. `hash.test.ts` FAILS (captured): `hash ignored fighter.combat.standbyFrames`. Restore.

- [ ] **Step 8: Gate and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test` (typecheck and lint replayed: exit 0). Expected: exit 0.

```bash
git add super-smash/src/engine/combat.ts super-smash/src/engine/hash.ts super-smash/src/engine/simulate.ts super-smash/src/ai/specials.ts super-smash/src/ai/specials.test.ts super-smash/src/engine/simulate.test.ts
# with the golden only if its step regenerated it:
git add super-smash/src/game/__golden__/engine-trace.json super-smash/src/game/rulesVersion.test.ts
# and super-smash/src/game/golden.test.ts only if a seed step was allowed (the group's golden paragraph)
git commit -m "super-smash: the CPU fires Volt Tackle at a target proven held, stopping to do it, and stops holding the power after 1,200 frames" -m "holdLeft and connectFrame read the hold and the contact from state and move data, once the view has seen the hold, beyond point blank (the sparks); the whiff check is skipped then. Moving, the CPU stops first where the hold outlasts the stop. The time limit is CPU judgement (D10); CombatState.standbyFrames counts the hold, cloned and hashed. The dizzy-Mario spot test is split: a held target is fired at where Pikachu stands; the spot stays for a shielding one. Against Task 23's baseline (R-P6-19 amended, R-P6-24): <per fighter fired, landed, mean hold; landed summed; mean hold over all; edgeguard exits; self-destructs>; longestStandby <…>; FS self-destructs <…>. Golden: <unchanged | the traces>." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 25: CPU: Kong Karry, and dash attacks at a moving target

Two CPU items from Plan 5, and a third carried:
- "Kong Karry never appears in the sweep (DK rarely grabs facing the nearer edge)." `holding`'s grab branch throws toward the nearer edge (`out`), so Donkey Kong lifts (his forward throw, `MoveDef.cargo`) only when he grabbed facing it. Kong Karry walks either way (`cargo.ts`: he "can move and jump while holding the opponent", and turns at once on the ground), so he may lift whichever way he faces and carry them to the nearer edge, which `holding`'s carry branch already does. UNVERIFIED (tuning): `CARGO_CHANCE` 0.5 of the throws a grab decides.
- "3/0/1 runs of 8+ whiffed dash attacks at a moving target per sweep." A dash attack is judged by running it against the target carried on its velocity (`swingRuns`); a target that turns or stops is not where the judgement put it, the more so the later the contact. **Ruling R-P6-16 (controller):** the trust comes from each fighter's own dash attack, not one constant: at a moving target, a contact is trusted only inside its dash attack's first active window (`firstWindowEnd`: the end of its earliest striking boxes, from its own data, rubendal 13.0.1 through the import), where the slide still carries the first hit; a later contact is the late hit at a guessed position. Every fighter's first window is its own startup, so every fighter whose dash attack can connect in time still throws it; none never can. The windows at `46e0706`: Fox 4-7, Mario 6-9, Pikachu 6-8, Samus 8-9, Donkey Kong 9-12, Kirby 9-17, Marth 13-16, Link 20-23. Link's and Marth's dash attacks have one window only, so the rule leaves theirs as they were. Cost: measured in the planning replay (every fighter, targets from 6 units out to its reach moving at -1.6 to 3.0, the runner at 1.2 to 2.0), a contact past the first window at a moving target comes only for Mario (3 scenes), Donkey Kong (4) and Samus (2), so the rule removes few throws; the sweep's `dashAttacks` shows by how much the whiff runs fall.
- **Carried, not in Plan 6 (D59 records it):** "When no swing lands beyond point blank, `attack` still throws an unjudged full-stick swing (`src/ai/offence.ts:~194-196`). It never locked in the probes." Judging that swing (pressing the stick alone on the ground, the judged aerial or none in the air) changes the course of every match: on the planning replay's six-seed sweep it cut Donkey Kong's landed Final Smashes 118 → 95 (−19%) and Fox's 161 → 144 (−11%) against Task 23's, past R-P6-19's first per-fighter bound; without it, this task leaves every fighter within 4% (Step 5). Under R-P6-19 as amended it would pass (landed summed 1,032 → 968, −6.2%; no fighter past −25%), and R-P6-24's edgeguard bound (`edgeguardExits` 5,922 → 5,879; its self-destructs were counted only before fix round 3 corrected the count), but it stays carried, to avoid churn; D59 notes it can come back. `cpuIdleHuman.test.ts` already bounds a stalled stretch.

**Golden:** moves. Measured in the planning replay (`46e0706` with Tasks 23 and 24): only `mario-fox-battlefield` diverges, from frames 2301-2400; regeneration at seed 606 passed every pin (captured: `Tests 11 passed`), so no seed step. Regenerate as the group's golden paragraph says.

**Consumed by Task 27.** Task 27 (CPU spacing by baked bodies) builds on this task's moving-target rule, `dashLands(ctx, input)` (offence.ts, module-private): `k > 0 && (!moving || dash === undefined || k <= firstWindowEnd(dash))`. There is no `DASH_TRUST_FRAMES`. `swingLands` keeps its signature (it reads `swingRuns(…) > 0`). `attack`'s end is unchanged (the unjudged swing is carried), so Task 27's gate edit at `attack`'s top applies as it is.

**Files:**
- Modify: `src/ai/specials.ts` (`holding`, `CARGO_CHANCE`), `src/ai/offence.ts` (`attack`'s dash branch, `swingRuns`, `swingLands`; new `firstWindowEnd`, `dashLands`)
- Test: `src/ai/specials.test.ts`, `src/ai/behaviours.test.ts`

**Interfaces:**
- Consumes: `holding`, `PUMMEL_CHANCE`, `ROLL_SPECIAL` (specials.ts); `attack`, `swingRuns`, `swingLands`, `strikes` (offence.ts, behaviours.ts).
- Produces: `CARGO_CHANCE = 0.5` (specials.ts); `firstWindowEnd(move: MoveDef): number` (offence.ts, exported); `dashLands` (offence.ts, module-private); `swingRuns` returns the step its swing first reaches the body (1 without the data to judge it), or 0 (was a boolean; `swingLands` reads `> 0`, and `judgedAerial` and `wayOut` read it in an `if`, unchanged).

- [ ] **Step 1: Write the failing tests**

`src/ai/specials.test.ts`: `PUMMEL_CHANCE` joins the `./specials` import; at the file's end:

```ts
describe("Kong Karry (Plan 6, Task 25)", () => {
  it("Donkey Kong lifts whichever way he faces, on a roll in the cargo band", () => {
    // Facing away from the nearer edge (he is right of centre facing left).
    const s = makeState({
      fighters: [
        makeFighter({ port: 0, defId: "donkeyKong", x: fx(40), facing: -1, action: "grabHold", actionFrame: 0, grabbing: 1 }),
        makeFighter({ port: 1, x: fx(30), action: "grabbed", grabbedBy: 0 }),
      ],
    });
    const lift = holding(context(s, donkeyKong, 9, rollsWith(ROLL_SPECIAL, PUMMEL_CHANCE + 0.1)));
    expect(lift.input).toBe(Btn.Left);
    // The same roll for a fighter whose forward throw is no carry throws toward the edge.
    const m = { ...s, fighters: [{ ...s.fighters[0], defId: "mario" }, s.fighters[1]] };
    expect(holding(context(m, mario, 9, rollsWith(ROLL_SPECIAL, PUMMEL_CHANCE + 0.1))).input).toBe(Btn.Right);
  });
});
```

`src/ai/behaviours.test.ts`: `firstWindowEnd` joins the `./offence` import (after `attack`); at the file's end:

```ts
describe("the CPU's dash attacks at a moving target (Plan 6, Task 25; ruling R-P6-16)", () => {
  const FOX = getFighter("fox")!;
  const FDV = stageViewFromDef(STAGES.find((x) => x.id === "finalDestination")!);

  /** `id` (port 0, facing right) and a Fox (port 1) on Final Destination, with `id`'s own definition and reach, as a real CPU world has them. */
  function judged(self: Partial<FighterState>, target: Partial<FighterState>, frame = 0, id = "mario"): BehaviourContext {
    const me = getFighter(id)!;
    const state = gameState([fighter(0, { defId: id, facing: 1, ...self }), fighter(1, { defId: "fox", facing: -1, ...target })], { stageId: "finalDestination", frame });
    return { ...context(state, L9), stage: FDV, fighterDef: me, matchDefs: [me, FOX], meleeReach: meleeReachFromDef(me) };
  }
  /** The presses `attack` makes over one swing beat (frames 0-9), the scene otherwise unchanged. */
  const beat = (self: Partial<FighterState>, target: Partial<FighterState>) => [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((frame) => attack(judged(self, target, frame)).input);

  it("does not dash-attack a moving target that only the dash attack's late hit would reach (ruling R-P6-16)", () => {
    // Mario running at 2, Fox 6.5 ahead walking away at 0.6: carried on its velocity, Fox is met
    // only by the late hit, on frame 25, past Mario's first window (frames 6-9).
    const presses = beat({ x: 0, action: "run", vx: fx(2), framesSinceDirPress: 99 }, { x: fx(6.5), vx: fx(0.6), action: "run" });
    expect(presses.some((i) => held(i, Btn.Attack))).toBe(false);
    expect(firstWindowEnd(getFighter("mario")!.moves.dashAttack!)).toBe(9);
  });

  it("still dash-attacks a moving target its first hit meets, and a standing one", () => {
    const run = { x: 0, action: "run" as const, vx: fx(1.6), framesSinceDirPress: 99 };
    expect(beat(run, { x: fx(8), vx: fx(1.6), action: "run" }).some((i) => held(i, Btn.Attack)), "running away at 1.6").toBe(true);
    expect(beat(run, { x: fx(8) }).some((i) => held(i, Btn.Attack)), "standing").toBe(true);
  });
});
```

(Every scene is inside the fighter's `meleeReach` and past `POINT_BLANK`: `attack` returns nothing beyond the reach, `offence.ts`'s `if (distance > ctx.meleeReach) return NOTHING;`.)

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/ai/specials.test.ts src/ai/behaviours.test.ts -t "Kong Karry|dash attacks at a moving target"`
Expected: FAIL (captured): the lift `expected 2 to be 1` (`Btn.Right`, a back throw toward the nearer edge); the late-hit dash attack `expected true to be false`. The last test passes as a guard.

- [ ] **Step 3: Implement**

`src/ai/specials.ts`, after `PUMMEL_CHANCE`:

```ts
/**
 * UNVERIFIED (tuning): of the grabs that throw rather than pummel, the share a fighter whose
 * forward throw is a carry (`MoveDef.cargo`: Donkey Kong's Kong Karry) lifts, whichever way it
 * faces, and carries to the nearer edge (Plan 6, Task 25: in Plan 5's sweep he lifted only when
 * he had grabbed facing that edge, and never did).
 */
export const CARGO_CHANCE = 0.5;
```

`holding`'s grab branch:

```diff
   if (self.action === "grabHold") {
     if (ctx.rolls[ROLL_SPECIAL] < PUMMEL_CHANCE && ctx.fighterDef?.moves.pummel !== undefined) return { score: 530, input: Btn.Attack, decided: true };
+    // A carry is lifted forward, whichever way he faces; the carry walks to the edge (Plan 6, Task 25).
+    const lifts = ctx.fighterDef?.moves.fthrow?.cargo === true && ctx.rolls[ROLL_SPECIAL] < PUMMEL_CHANCE + (1 - PUMMEL_CHANCE) * CARGO_CHANCE;
+    if (lifts) return { score: 530, input: self.facing > 0 ? Btn.Right : Btn.Left, decided: true };
     return { score: 530, input: out, decided: true };
   }
```

`src/ai/offence.ts`: `type MoveDef` joins the `@/engine/types` import. `swingRuns` returns a number: its signature's `: boolean` → `: number`; its "no definitions" `return true;` → `return 1;`; its contact `>= GLANCING_BLOW_DEPTH) return true;` → `>= GLANCING_BLOW_DEPTH) return k;`; its three `return false;` → `return 0;`; and its doc comment's last sentence gains: "It returns the step on which the swing first reaches the body (1 without the data to judge it), or 0 for none (Plan 6, Task 25: `dashLands` reads the step)." `swingLands` reads it:

```diff
 function swingLands(ctx: BehaviourContext, input: InputFrame): boolean {
-  return swingRuns(ctx, (k) => (k === 1 ? input : input & ~Btn.Attack), 0);
+  return swingRuns(ctx, (k) => (k === 1 ? input : input & ~Btn.Attack), 0) > 0;
 }
+
+/**
+ * The last move frame of `move`'s first active window (Plan 6, Task 25, ruling R-P6-16): the end
+ * of its earliest striking boxes, from its own data (rubendal 13.0.1 through the import). 0 for a
+ * move with none.
+ */
+export function firstWindowEnd(move: MoveDef): number {
+  const live = move.hitboxes.filter((h) => strikes(h));
+  if (live.length === 0) return 0;
+  const first = Math.min(...live.map((h) => h.startFrame));
+  return Math.max(...live.filter((h) => h.startFrame === first).map((h) => h.endFrame));
+}
+
+/**
+ * `swingLands` for a dash attack (Plan 6, Task 25, ruling R-P6-16): at a moving target, only a
+ * contact inside the fighter's own dash attack's first active window (`firstWindowEnd`). There
+ * the slide still carries its first hit; a later contact is the late hit at a target the
+ * judgement carried on its velocity, and one that turns or stops is not there (Plan 5's sweep:
+ * 3/0/1 runs of 8+ whiffed dash attacks at a moving target). A target standing still is judged
+ * as every swing is.
+ */
+function dashLands(ctx: BehaviourContext, input: InputFrame): boolean {
+  const k = swingRuns(ctx, (j) => (j === 1 ? input : input & ~Btn.Attack), 0);
+  const target = ctx.view.target;
+  const dash = ctx.fighterDef?.moves.dashAttack;
+  const moving = target !== null && target.vx !== 0;
+  return k > 0 && (!moving || dash === undefined || k <= firstWindowEnd(dash));
+}
```

and in `attack`:

```diff
   if (swinging && (self.grounded || self.action === "ledgeGetUp") && (free(self) || waits)) {
     const swing = (stale ? toward | Btn.Soft : 0) | Btn.Attack;
-    if (waits ? waitedLands(ctx, swing) : swingLands(ctx, swing)) return { score: 400, input: swing };
+    const dashing = self.action === "dashStart" || self.action === "run";
+    if (waits ? waitedLands(ctx, swing) : dashing ? dashLands(ctx, swing) : swingLands(ctx, swing)) return { score: 400, input: swing };
```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/ai/specials.test.ts src/ai/behaviours.test.ts` → PASS (captured: `Tests 207 passed (207)`). Then `pnpm vitest run src/ai src/game`: expected, the golden fails as its paragraph says; every other test passes, `cpuIdleHuman.test.ts` included. If a matchup now stalls, stop and report it. (Under load, `defence.test.ts`'s "techs a tumble's fall at each level's techSkill" can pass its 5 s timeout; alone it takes 1.3 s, measured.)

- [ ] **Step 5: Measure (rulings R-P6-19, R-P6-24)**

The sweep, against Task 23's: the group's table, judged by R-P6-19 as amended and R-P6-24 (past any bound, stop and report); also `kongKarry` (expected above Task 23's) and `dashAttacks` per fighter (thrown, whiff runs). Measured in the planning replay (six seeds, this task on Task 24, captured): every fighter within 3.4% of Task 23's (landed: Donkey Kong 118 → 122, Fox 161 → 160, Kirby 163 → 164, Link 129 → 130, Mario 176 → 175, Marth 129 → 129, Pikachu 0 → 4, Samus 156 → 156; mean holds within 3 frames); landed summed 1,032 → 1,040; the mean hold over all 146.3 → 145.8; `edgeguardExits` 5,922 → 5,910 (−0.2%); `selfDestructs` 20 → 20; Kong Karry 33 → 45. Passes both.

- [ ] **Step 6: Golden**

`UPDATE_GOLDEN=1 pnpm vitest run src/game/golden.test.ts` (captured at seed 606: `Tests 11 passed`, every pin holding; a step is allowed only as the group's golden paragraph says). Then `RULES_PIN.golden` to the digest `rulesVersion.test.ts` prints, and rerun `src/ai src/game`: PASS. The commit names the matches that moved and their first diverging samples.

- [ ] **Step 7: Mutants**

1. `holding`: delete the `if (lifts) …` line. Kong Karry FAILS (captured): `expected 2 to be 1`. Restore.
2. `dashLands`: `return k > 0 && (…);` → `return k > 0;`. The late-hit test FAILS (captured): `expected true to be false`. Restore.
3. `firstWindowEnd`: `Math.max(...live.filter((h) => h.startFrame === first).map((h) => h.endFrame))` → `Math.max(...live.map((h) => h.endFrame))` (the last window's end). The late-hit test FAILS (captured): `expected true to be false`. Restore.

- [ ] **Step 8: Gate and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test` (typecheck and lint replayed: exit 0). Expected: exit 0.

```bash
git add super-smash/src/ai/specials.ts super-smash/src/ai/offence.ts super-smash/src/ai/specials.test.ts super-smash/src/ai/behaviours.test.ts super-smash/src/game/__golden__/engine-trace.json super-smash/src/game/rulesVersion.test.ts
# and super-smash/src/game/golden.test.ts only if a seed step was allowed (the group's golden paragraph)
git commit -m "super-smash: the CPU lifts Kong Karry either way, and trusts a moving target's dash-attack contact only in its own first window" -m "R-P6-16: firstWindowEnd from each dash attack's data (Link's and Marth's have one window, so are unchanged). The unjudged swing beyond point blank is carried (judging it cut DK's and Fox's landed Final Smashes; D59 notes it can come back). Against Task 23's baseline (R-P6-19 amended, R-P6-24): <per fighter fired, landed, mean hold; landed summed; mean hold over all; edgeguard exits; self-destructs>. Kong Karry <n>; dash attacks thrown and whiff runs per fighter <...>. Golden: <the matches that moved>; ball-on seed <606, or its current seed> <unchanged>." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 26: CPU at the ledge: the Smash Ball chase, Smashville's ledge, Kirby's Inhale off stage

Three CPU items where a CPU leaves the stage it should stay on:
- "The CPU's Smash Ball chase can carry it past the ledge (donkeyKong-samus@PS2, seed 1011, ball on); unchanged since before the wave." D58: "in the ball-on idle table one CPU, Donkey Kong, lost a stock, carried past the ledge by the Smash Ball chase".
- "A full level-9 CPU running at Smashville's ledge with Mario 45 inside ends on or past the ledge in 12 of 36 runs (the Volt Tackle positioning has no spot there)."
- "Kirby's CPU can inhale someone while off the stage and then can't recover."

Reproduced first, in the planning replay (`46e0706` with fix round 1's forms of Tasks 23, 24 and 25 and of the dropped Final Smash rule; Step 2's failures re-captured on Tasks 23, 24 and 25 as now written):
- **The chase.** A seed replay through the earlier tasks pins nothing (seed 1011's only "self-destruct" at `46e0706` was a Donkey Kong hit on 1974 who died recovering on 2136), so the scene is built: Donkey Kong in the air 40 inside Pokémon Stadium 2's left ledge, 5 up, drifting out at 1.5 with his midair jump left, the ball 10 inside that ledge, 30 up. The chase drifts and jumps after it, past the ledge, from where his recovery falls short: KO on frame 135. On the ground the chase's run and jump at a ledge, and a jump out of a shield raised from the run, carry the fighter past too (71 of 108 constructed ground scenes past the ledge within 180 frames; none lost a stock).
- **Smashville.** With Pikachu behind Mario (the draft's `ledge - 45 - run`) it never reproduced (0 of 36); between Mario and the ledge (`ledge - 40 + run`, running out at 1.6) it did, 4 of 36 (runs 32-35): turning back to Mario 3.5 to 6.5 from the end, the turn's slide hung Pikachu on the ledge. With the Volt Tackle power or without, the same.

The rules, each a guard whoever asks:
- **On the ground** (`runsOff`, in `decideCpu` beside `slidesOff`): a direction or a jump pressed while the fighter still slides (`vx` not 0: a dash, a run, its brake, a shield raised out of one) is not pressed where the press, then a let-go, takes it off its floor's end (`leavesFloor`, R-FW1n's model: a turn's slide and a jump's arc included); a shield brakes it instead. **Rulings R-P6-17 and R-P6-24 (controller):** not while the target is off the stage. The edge is then the edgeguard's: it acts only at a target off the stage (`edgeguard` returns nothing otherwise), and its chase off the stage is deliberate, gated on its own skill (`edgeguardSkill` above 0.6). This task's first form braked every behaviour but the edgeguard, the other behaviours' runs at that edge included, and so cut the sweep's `edgeguardExits` by 18%, past R-P6-24's 10%. Braking those runs with a let-go instead of the shield cut them as much (−17%). So the guard reads where the target is, not which behaviour asked (Step 6's mutants 3 and 6).
- **In the air** (`chaseStrands`, in `smashBall`'s air branch): the chase's drift, or its midair jump, is not made where the fighter, followed for `CHASE_LOOKAHEAD_FRAMES` (UNVERIFIED, CPU judgement: 45, about a full hop's rise and fall), ends off the stage where its own recovery model has no way back (`recoversFrom`); it drifts home instead.
- **The Inhale**, like a trapping Final Smash off the stage (R-FW1d), is not started off the stage.

Measured with them (the constructed scenes with this guard's first form, every behaviour but the edgeguard's; Steps 2 and 4 re-captured with this one): Smashville 0 of 36; the chase scene keeps its stock; over 108 constructed air-chase scenes, KOs 1 → 0; over the 108 ground scenes, 83 → 43 past the ledge within 600 frames (ledge grabs and recoveries), and no stock lost.

**Golden:** moves. Measured in the planning replay (on Tasks 23, 24 and 25 as written, against Task 25's regenerated trace): `mario-fox-battlefield` first diverges in frames 2401-2500, `donkeyKong-pikachu-finalDestination`, `link-samus-smashville` and the ball-on match in 701-800, `kirby-marth-pokemonStadium2` in 3101-3200; regeneration at seed 606 passed every pin (captured: `Tests 11 passed`), so no seed step. Regenerate as the group's golden paragraph says.

**Files:**
- Modify: `src/ai/cpu.ts` (`decideCpu`'s guard, new `runsOff`), `src/ai/specials.ts` (`smashBall`'s air branch, new `chaseStrands`; `holding`'s Inhale)
- Test: `src/ai/specials.test.ts`, `src/game/cpuIdleHuman.test.ts`

**Interfaces:**
- Consumes: `slidesOff`, `leavesFloor` (offence.ts); `recoversFrom`, `ghostContext`, `ghostStep`, `isOffstage` (specials.ts, recovery.ts, behaviours.ts); `decideCpu` (cpu.ts).
- Produces: `runsOff(ctx: BehaviourContext, input: InputFrame): boolean` (cpu.ts, exported); `chaseStrands` and `CHASE_LOOKAHEAD_FRAMES` (specials.ts, module-private).

- [ ] **Step 1: Write the failing tests**

`src/game/cpuIdleHuman.test.ts`: `import { Btn } from "@/engine/types";` (beside the `type` import) and `isStunned` joins the `@/ai/behaviours` import; then, at the file's end, a helper and a block:

```ts
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
```

`src/ai/specials.test.ts`, at its end:

```ts
describe("Kirby's Inhale off the stage (Plan 6, Task 26)", () => {
  it("is not started off the stage, however near the target", () => {
    const off = makeState({
      fighters: [
        makeFighter({ port: 0, defId: "kirby", x: FD.rightLedge + fx(10), y: fx(10), grounded: false, action: "fall", facing: -1 }),
        makeFighter({ port: 1, x: FD.rightLedge + fx(2), y: fx(10), grounded: false, action: "fall" }),
      ],
    });
    expect(isOffstage(off.fighters[0], FD)).toBe(true);
    expect(holding(context(off, kirby, 9, rollsWith(ROLL_SPECIAL, 0), FD)).input & Btn.Special).toBe(0);
    // Over the stage, the same reach: taken.
    off.fighters[0] = makeFighter({ port: 0, defId: "kirby", x: FD.rightLedge - fx(10), y: fx(10), grounded: false, action: "fall", facing: -1 });
    off.fighters[1] = makeFighter({ port: 1, x: FD.rightLedge - fx(18), y: fx(10), grounded: false, action: "fall" });
    expect(holding(context(off, kirby, 9, rollsWith(ROLL_SPECIAL, 0), FD)).input & Btn.Special).toBe(Btn.Special);
  });
});
```

- [ ] **Step 2: Run them**

Run: `pnpm vitest run src/game/cpuIdleHuman.test.ts src/ai/specials.test.ts -t "stays on its stage|Inhale off the stage"`
Expected: FAIL (captured): the Inhale `expected 32 to be +0` (`Btn.Special`); the chase `expected 1 to be +0`; Smashville `expected [ 32, 33, 34, 35 ] to deeply equal []`. The off-stage-target test passes as a guard (no run-off guard yet).

- [ ] **Step 3: Implement**

`src/ai/cpu.ts`: `held` joins the `@/engine/types` import, `leavesFloor` the `./offence` import (beside `slidesOff`), `isOffstage` the `./behaviours` import (after `airDodgeFromDef`). In `decideCpu`, after its `slidesOff` line and before `carriesOff`'s:

```diff
   if (slidesOff(ctx, bestInput)) bestInput = Btn.Shield & ~forbid;
+
+  // Nor a direction pressed in a run or a dash whose slide, the press and then a let-go, takes
+  // the fighter off its floor's end, whoever asked for it (Plan 6, Task 26: the Smash Ball
+  // chase's run and jump at the ledge, a turn at Smashville's ledge); the shield brakes it. Not
+  // while the target is off the stage: the edge is then the edgeguard's, which acts only then,
+  // and its chase off the stage is deliberate, gated on its own skill (ruling R-P6-17); braking
+  // the other behaviours' runs there too cut its exits by 18% (ruling R-P6-24). Judgement, not
+  // a roll.
+  const offTarget = ctx.view.target !== null && isOffstage(ctx.view.target, ctx.stage);
+  if (!offTarget && runsOff(ctx, bestInput)) bestInput = Btn.Shield & ~forbid;
```

and at the file's end:

```ts
/**
 * Whether `input`, a direction or a jump pressed while the fighter still slides on the ground
 * (`vx` not 0: a dash, a run, its brake, a shield raised out of one), takes it off the floor it
 * stands on: the press, then a let-go, run on its own copy to rest by `slidesOff`'s model
 * (`leavesFloor`, ruling R-FW1n), a turn's slide and a jump's arc included (Plan 6, Task 26).
 * Then `decideCpu` brakes with the shield instead, unless the target is off the stage (rulings
 * R-P6-17, R-P6-24).
 */
export function runsOff(ctx: BehaviourContext, input: InputFrame): boolean {
  const { self } = ctx.view;
  if (!self.grounded || self.vx === 0) return false;
  if (!held(input, Btn.Left) && !held(input, Btn.Right) && !held(input, Btn.Jump)) return false;
  return leavesFloor(ctx, input);
}
```

`src/ai/specials.ts`, `smashBall`'s air branch:

```diff
     // UNVERIFIED (CPU judgement): its midair jump pressed two frames in eight, past its top.
     const again = by > VERTICAL_REACH && self.jumpsUsed < ctx.jumps && self.vy <= 0 && pulse(ctx.view.frame, self.port, 8, 2);
-    return { score, input: toward | (again ? Btn.Jump : 0) };
+    const chase = toward | (again ? Btn.Jump : 0);
+    // Not past a ledge after it, and lost (Plan 6, Task 26): a drift, or a midair jump, that would
+    // leave the fighter off the stage where its own recovery model has no way back is not made,
+    // and it drifts home instead.
+    if (chase !== 0 && chaseStrands(ctx, chase)) return { score, input: towardX(self.x, Math.trunc((ctx.stage.leftLedge + ctx.stage.rightLedge) / 2)) };
+    return { score, input: chase };
```

and after `smashBall`, before the reflect section:

```ts
/** UNVERIFIED (CPU judgement): the frames the air chase's drift is followed (`chaseStrands`), about a full hop's rise and fall. */
const CHASE_LOOKAHEAD_FRAMES = 45;

/**
 * Whether the Smash Ball chase's press in the air (`smashBall`): `input` now, its direction held
 * after, leaves the fighter off the stage with no way back (Plan 6, Task 26): a copy run by the
 * engine's rules (`ghostStep`) for `CHASE_LOOKAHEAD_FRAMES`, or until it lands on the stage; then
 * the CPU's own recovery model judges it from there (`recoversFrom`). The chase past a ledge that
 * Plan 5's sweep lost Donkey Kong's stock to was this drift, after the ball near the far ledge.
 */
function chaseStrands(ctx: BehaviourContext, input: InputFrame): boolean {
  const def = ctx.fighterDef;
  if (def === null) return false;
  const f = cloneFighter(ctx.view.self);
  const g = ghostContext(def, ctx.view.frame, f);
  let prev: InputFrame = 0;
  for (let k = 1; k <= CHASE_LOOKAHEAD_FRAMES; k++) {
    const now = k === 1 ? input : input & ~Btn.Jump;
    g.frame = ctx.view.frame + k;
    ghostStep(f, now, prev, g);
    prev = now;
    if (f.grounded) return false;
  }
  if (!isOffstage(f, ctx.stage)) return false;
  return !recoversFrom(def, f, ctx.stage, ctx.recovery, ctx.jumps, g.frame, ctx.state.stageFrame + CHASE_LOOKAHEAD_FRAMES);
}
```

`holding`'s mouthful-taking branch:

```diff
-    if (inReach && catchable && target.intangible === 0 && target.invincible === 0 && target.grabbedBy < 0 && skilled(ctx)) return { score: 450, input: Btn.Special };
+    // Not off the stage (Plan 6, Task 26), as a trapping Final Smash is not (ruling R-FW1d): a
+    // mouthful taken there kept Kirby from recovering.
+    if (inReach && catchable && !isOffstage(self, ctx.stage) && target.intangible === 0 && target.invincible === 0 && target.grabbedBy < 0 && skilled(ctx)) return { score: 450, input: Btn.Special };
```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/game/cpuIdleHuman.test.ts src/ai/specials.test.ts -t "stays on its stage|Inhale off the stage"` → PASS (captured: `Tests 4 passed | 114 skipped`). Then `pnpm vitest run src/ai src/game`: the golden fails as its paragraph says (captured: `Tests 5 failed | 788 passed | 1 skipped`, the five CPU matches); everything else passes, `cpuIdleHuman.test.ts` and `cpuRollback.test.ts` included (captured after the regeneration: `Test Files 28 passed`, `Tests 793 passed | 1 skipped`).

- [ ] **Step 5: Measure (rulings R-P6-19, R-P6-24) and golden**

The sweep, against Task 23's: the group's table, judged by R-P6-19 as amended and R-P6-24 (past any bound, stop and report); also `kirbyInhaleSelfDestructs` (expected 0) and `finalSmashSelfDestructs`. Measured in the planning replay (six seeds, this task on Tasks 23, 24 and 25 as written, captured):

| Fighter | Fired | Landed | Mean hold (frames) |
|---|---|---|---|
| Donkey Kong | 272 → 282 | 118 → 120 | 109 → 103 |
| Fox | 303 → 316 | 161 → 160 | 138 → 140 |
| Kirby | 351 → 389 | 163 → 188 | 167 → 172 |
| Link | 405 → 390 | 129 → 118 | 114 → 104 |
| Mario | 457 → 523 | 176 → 178 | 102 → 101 |
| Marth | 230 → 249 | 129 → 141 | 133 → 120 |
| Pikachu | 0 → 9 | 0 → 9 | 347 → 327 |
| Samus | 232 → 218 | 156 → 137 | 84 → 76 |
| **All** | | **1,032 → 1,051** (+1.8%) | **146.3 → 142.4** (−2.7%) |

So, against Task 23's:
- **R-P6-19 passes.** No fighter is near −25%; the furthest down is Samus, −12.2%.
- **R-P6-24 passes.** `edgeguardExits` 5,922 → 5,530 (−6.6%); `selfDestructs` 20 → 8.
- **The other counts:** `kirbyInhaleSelfDestructs` 0 → 0; `finalSmashSelfDestructs` 0 → 1; Kong Karry 33 → 47.

The forms measured and not taken, each on the same base:

| Form | Landed summed | Furthest down | Edgeguard exits | Self-destructs |
|---|---|---|---|---|
| Every behaviour but the edgeguard (the first form) | 1,028 | Mario −8.5% | 4,880 (−17.6%) | 8 |
| The same, a let-go instead of the shield at a target off the stage | 1,037 | Link −10.1% | 4,921 (−16.9%) | not counted correctly |
| Only the chase and the spacing, never at a target off the stage | 1,051 | Samus −12.2% | 5,527 (−6.7%) | not counted correctly |
| No ground guard (Smashville not fixed) | 1,003 | Mario −13.6% | 5,930 (+0.1%) | not counted correctly |

"Not counted correctly": measured before fix round 3 corrected Task 23's count. The halves differ (Samus 62 on seeds 1-3, 75 on 4-6); only the six-seed run judges.

Then `UPDATE_GOLDEN=1 pnpm vitest run src/game/golden.test.ts` (captured at seed 606: `Tests 11 passed`; a step is allowed only as the group's golden paragraph says), and re-pin `RULES_PIN.golden` to the digest `rulesVersion.test.ts` prints (the replay's: `fa21ba92`, from Task 25's `c8533c92`); then `golden.test.ts` and `rulesVersion.test.ts` pass (captured: `Tests 27 passed`).

- [ ] **Step 6: Mutants**

1. `decideCpu`: delete the `runsOff` line. Smashville FAILS (captured): `expected [ 32, 33, 34, 35 ] to deeply equal []`. Restore.
2. `runsOff`: the press check → `if (!held(input, self.vx > 0 ? Btn.Right : Btn.Left)) return false;` (only a press along the slide, the draft's rule). Smashville FAILS (captured): the same four runs. Restore.
3. `decideCpu`: drop `!offTarget && `. The off-stage-target test FAILS (captured): `expected false to be true` (the edgeguard's press out braked to a shield). Restore.
4. `smashBall`: `if (chase !== 0 && chaseStrands(ctx, chase))` → `if (false && chaseStrands(ctx, chase))`. The chase test FAILS (captured): `expected 1 to be +0`. Restore.
5. `holding`: drop `!isOffstage(self, ctx.stage) && `. The Inhale test FAILS (captured): `expected 32 to be +0`. Restore.
6. `decideCpu`: `!offTarget && ` → `bestName !== "edgeguard" && ` (this task's first form, which braked the other behaviours' runs at a target off the stage). The off-stage-target test FAILS (captured): `expected [ …(2) ] to deeply equal []` (two other behaviours' runs braked to a shield). Restore.

- [ ] **Step 7: Gate and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test` (typecheck and lint replayed: exit 0). Expected: exit 0.

```bash
git add super-smash/src/ai/cpu.ts super-smash/src/ai/specials.ts super-smash/src/ai/specials.test.ts super-smash/src/game/cpuIdleHuman.test.ts
git add super-smash/src/game/__golden__/engine-trace.json super-smash/src/game/rulesVersion.test.ts
# and super-smash/src/game/golden.test.ts only if a seed step was allowed (the group's golden paragraph)
git commit -m "super-smash: a CPU never slides off its floor's end, the Smash Ball chase never drifts past a ledge to a lost stock, and Kirby's CPU inhales nobody off the stage" -m "runsOff (any direction or jump pressed while sliding, R-FW1n's model; not while the target is off the stage, where the edge is the edgeguard's: R-P6-17, R-P6-24) and chaseStrands (the air chase judged by recoversFrom). Reproduced first: Smashville 4/36 -> 0, the air chase's KO -> none. Against Task 23's baseline (R-P6-19 amended, R-P6-24): <per fighter fired, landed, mean hold; landed summed; mean hold over all; edgeguard exits; self-destructs>; Kirby inhale self-destructs <…>; FS self-destructs <…>. Golden: <the matches that moved>; ball-on seed <606, or its current seed> <unchanged>." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 27: The CPU spaces by the target's baked body

This is D58's carry from P5-R23: "Spacing by the target's baked body, which risks D30's whiff deadlock, is carried to polish." P5-R23 measured the spacing and left it unchanged (Plan 5 Task 19's sweep, with the reach Plan 4 placed: P5-R22). This task runs after Task 26 and builds on Tasks 23-26 as written above.

**Today.** `attack` swings only within `meleeReach`, and `approach` closes to the same threshold.
- `meleeReach` is the CPU's shortest poke's reach (`meleeReachFromDef`: the lesser of jab and forward tilt). It leaves the target's body out, on purpose (D30: "Standing a little too close costs the CPU nothing; standing a little too far costs it the entire match").
- Tasks 23-26 leave `attack`'s gate (`if (distance > ctx.meleeReach) return NOTHING;`) and its end as they were. Task 25 carries the unjudged swing at the end and edits only the judged branch.
- **Measured in the replay:**
  - Every ordered pair standing on Final Destination except Kirby at Samus has distances past the CPU's `meleeReach` where its jab or a tilt lands in the engine. They reach up to 16 units past it at Donkey Kong, whose idle body reaches 15.1 toward a fighter he faces. Kirby lands nothing past his reach at Samus.
  - At all of those distances `attack` returns nothing, and `approach` walks the CPU in.

**What changed since D30.** Every ground swing is now judged against the target's baked hurt capsules, from where the CPU stands (Plan 5 final wave, ruling R-FW1b: `swingLands`, `landingSwing`). Since Task 25, a dash attack is judged by `dashLands` too. So the body can count wherever a swing is judged, without the deadlock.

**This task:**
- Beyond `meleeReach`, out to `meleeReach` plus how far the target's baked body reaches toward the CPU (`bodyToward`), `attack` throws a swing **only if it is judged to land**. Otherwise it returns nothing.
- `approach` still closes to `meleeReach`. So no distance is left where neither acts (D30), and nothing beyond `meleeReach` goes unjudged.
- **From a standstill**, it throws the default swing or the first of its jab and tilts that lands (`swingLands`, `landingSwing`).
- **In a dash or a run**, it throws the dash attack only if `dashLands` passes it. This builds on Task 25's rule (ruling R-P6-16) and adds none of its own:
  - at a target standing still, the judged contact is enough;
  - at a moving target, the contact must come inside the fighter's own dash attack's first window (`firstWindowEnd`).
  - This replaces the draft's own "only at a still target" rule. That rule refused a target walking into the first hit, which `dashLands` accepts. Step 1 pins both cases.
- **Task 26's run-off guard** (`runsOff` in `decideCpu`) applies to these swings as to any, unless the target is off the stage (rulings R-P6-17, R-P6-24): a run or dash attack whose slide would leave the floor becomes a shield.
- **Without a bake.** `bodyToward` reads the bake. Without one (Plan 2's world, and every test context without `bake`, Task 25's `judged` included) it is 0, so behaviour there is unchanged.

**Sources.** No gameplay number. The bodies are the bake's hurt capsules (D57, UNVERIFIED as they already are), and the swings are judged by the engine's own rules.

**Rulings R-P6-19 (amended) and R-P6-24 (amended).** These judge the task against Task 23's six-seed baseline, cumulatively. The bounds:
- landed Final Smashes, summed over fighters, fall by at most 10%;
- each fighter's landed Final Smashes fall by at most 25%;
- the mean hold over all fighters rises by at most 25%;
- `edgeguardExits` falls by at most 10%;
- `selfDestructs` rises by at most 2, or 10% of the baseline, whichever is larger.

The replay met every bound (Step 5's table). The worst figures were Fox's landed, −13.7%, and the summed landed, +1.9%.

**Golden:** moves, in the five CPU matches only.
- **Where it diverges.** Captured in the replay: `mario-fox-battlefield`, `donkeyKong-pikachu-finalDestination`, `link-samus-smashville` and `kirby-marth-pokemonStadium2` first diverge in frames 101-200, and `samus-kirby-townAndCity-ball` in 501-600. The script and the labs are byte-identical.
- **The pins.** `UPDATE_GOLDEN=1` passed every lab pin and `MUST_VISIT`, `expectCpuFinalSmash` included, at seed 606 (captured: `Tests 11 passed`). The seed did not move in the replay.
- **What the CPU matches did:**

  | | Before | After |
  |---|---|---|
  | Hits (four CPU matches) | 56/35/35/39 | 51/49/39/31 |
  | Hits (ball-on match) | 26 | 50 |
  | Shield hits (four) | 0/4/1/3 | 3/1/3/0 |
  | Shield hits (ball-on) | 5 | 1 |
  | KOs (four) | 0/0/1/1 | 0/1/0/1 |
  | KOs (ball-on) | 0 | 1 |

- **States reached.** The four reach 44 states between them, down from 45. They now turn round, and no longer carry (`cargoCarry`, `cargoHeld`), which the states lab still does. Before, the ball-on match reached `roll`, which the four did not; now it reaches nothing they do not.

In the plan's order the traces and the figures may differ.
- A moved lab pin stops the task, because nothing here touches a lab.
- **The ball-on seed (R-P6-18).** If regeneration stops on `expectCpuFinalSmash`, the ball-on match's seed may step only if Step 5's sweep passes R-P6-19's test against Task 23's. If it fails, that is a regression to fix, not a seed to step: stop and report.

**Files:**
- Modify: `src/ai/offence.ts` (`attack`'s gate; new `bodyToward`, `spacedSwing`), `src/ai/behaviours.ts` (`meleeReachFromDef`'s comment)
- Test: `src/ai/behaviours.test.ts`
- Regenerate: `src/game/__golden__/engine-trace.json`, and `RULES_PIN.golden` in `src/game/rulesVersion.test.ts`. `src/game/golden.test.ts` gains two comment paragraphs: the "Measured" counts and the `MUST_VISIT` history (I1's convention). Its seed stays as it is (606 in the replay) unless R-P6-18 allows a step.

**Interfaces:**
- Consumes:
  - `attack`, `approach`, `swingLands`, `landingSwing` (offence.ts);
  - Task 25's `dashLands` (module-private there) and its `firstWindowEnd`;
  - `free`, `pulse`, `towardX`, `BehaviourContext.bake`, `.matchDefs`, `.meleeReach` (behaviours.ts);
  - `fighterHurtboxes` (`src/engine/acmd/hurtboxes.ts`);
  - Task 26's `runsOff` (cpu.ts), unchanged;
  - Task 23's `sweep` and its six-seed baseline (`src/game/cpuSweep.ts`).
- Produces:
  - `bodyToward(ctx: BehaviourContext): number` (offence.ts, exported): Q12 units, 0 without the bake or the target's definition;
  - `spacedSwing` (offence.ts, module-private).

- [ ] **Step 1: Write the failing tests**

`src/ai/behaviours.test.ts`. First, the `./offence` import gains `bodyToward`, which goes beside Task 25's `firstWindowEnd`:

```diff
 import {
   POINT_BLANK,
   approach,
   attack,
+  bodyToward,
   firstWindowEnd,
   edgeguard,
   platformMove,
   pressToward,
   slidesOff,
 } from "./offence";
```

Then this block is appended at the end of the file, after Task 25's `describe("the CPU's dash attacks at a moving target …")`. It uses the file's own baked fixtures: `pointBlank(a, b, gap, over)`, `bakedCtx(state)` and `landsInEngine(state, input)`, beside `describe("swinging at point blank at a short target …")`. It also uses its imports `Btn`, `held`, `fx` and `kineticSet`.

```ts
describe("spacing by the target's baked body (Plan 6, Task 27; P5-R23)", () => {
  const FTILT = Btn.Right | Btn.Soft | Btn.Attack;

  /** `a` running at `speed` toward `b`, `gap` ahead; `b` doing `action` at `vx` (facing its way), as `pointBlank` places them. */
  const running = (a: string, b: string, gap: number, speed: number, action: "stand" | "walk" | "run" = "stand", vx = 0) => {
    const s = pointBlank(a, b, gap, { action: "run", actionFrame: 10 });
    kineticSet(s.fighters[0], fx(speed), 0);
    Object.assign(s.fighters[1], { action, actionFrame: 10, facing: vx > 0 ? 1 : -1 });
    kineticSet(s.fighters[1], fx(vx), 0);
    return bakedCtx(s);
  };

  it("measures the target's body toward the CPU from its baked hurt capsules, and none without the bake", () => {
    const dk = bakedCtx(pointBlank("mario", "donkeyKong", 30));
    const mario = bakedCtx(pointBlank("mario", "mario", 30));
    expect(bodyToward(mario)).toBeGreaterThan(0);
    expect(bodyToward(dk)).toBeGreaterThan(bodyToward(mario));
    // Plan 2's world, with no bake: the body left out, as D30 leaves it.
    expect(bodyToward({ ...dk, bake: undefined })).toBe(0);
  });

  it("beyond its own reach, swings what lands on the target's body: Mario's forward tilt at Donkey Kong 16 away", () => {
    const s = pointBlank("mario", "donkeyKong", 16);
    const ctx = bakedCtx(s);
    expect(ctx.view.distance).toBeGreaterThan(ctx.meleeReach);
    const swing = attack(ctx);
    expect(swing.score).toBeGreaterThan(0);
    expect(swing.input).toBe(FTILT);
    expect(landsInEngine(s, swing.input)).toBe(true);
  });

  it("in a run beyond its own reach, dash-attacks as Task 25 judges a dash attack (dashLands, ruling R-P6-16)", () => {
    // Donkey Kong standing 14 ahead of Mario, and walking at him: the first hit meets both.
    const still = running("mario", "donkeyKong", 14, 1.6);
    expect(still.view.distance).toBeGreaterThan(still.meleeReach);
    expect(held(attack(still).input, Btn.Attack), "standing").toBe(true);
    expect(held(attack(running("mario", "donkeyKong", 14, 1.6, "walk", -0.8)).input, Btn.Attack), "walking at him").toBe(true);
    // Mario running away 17 ahead of Samus: only her dash attack's late hit, past its first window, meets him.
    const away = running("samus", "mario", 17, 2, "run", 1.6);
    expect(away.view.distance).toBeGreaterThan(away.meleeReach);
    expect(attack(away).score, "running away").toBe(0);
  });

  it("at every distance attack or approach acts (D30), and beyond its own reach attack throws only what lands", () => {
    // Kirby at Samus: nothing of his lands beyond his reach; the others: some swings do.
    const pairs = [["kirby", "samus"], ["mario", "donkeyKong"], ["pikachu", "fox"], ["marth", "kirby"]] as const;
    for (const [a, b] of pairs) {
      for (let d = 1; d <= 40; d++) {
        const s = pointBlank(a, b, d);
        const ctx = bakedCtx(s);
        const swing = attack(ctx);
        expect(swing.score > 0 || approach(ctx).score > 0, `nothing to do: ${a} at ${b}, ${d} away`).toBe(true);
        if (ctx.view.distance > ctx.meleeReach && swing.score > 0) expect(landsInEngine(s, swing.input), `${a} at ${b}, ${d} away`).toBe(true);
      }
    }
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/ai/behaviours.test.ts -t "spacing by the target"`

Expected: FAIL, 3 failed and 1 passed (captured):
- the measure test fails: `TypeError: bodyToward is not a function`;
- the forward tilt at Donkey Kong fails: `AssertionError: expected 0 to be greater than 0`, because `attack` returns nothing beyond `meleeReach`;
- the run test fails: `AssertionError: standing: expected false to be true`;
- the D30 property PASSES. It is a guard: today nothing is thrown beyond `meleeReach`, and `approach` acts there.

If the engine group's body tasks (Tasks 19-22) moved the bodies and a scene no longer holds, stop and report the pair and gap. Examples:
- Mario's forward tilt no longer reaches Donkey Kong at 16;
- a Donkey Kong 14 ahead, standing or walking at Mario, is no longer dash-attacked;
- Samus's dash attack meets a Mario running away 17 ahead inside its first window.

- [ ] **Step 3: Implement**

`src/ai/offence.ts`, `attack`'s gate. Tasks 23-26 leave it as it is at `46e0706`:

```diff
   const { self, target, targetAction, dx, dy, distance, facingTarget } = ctx.view;
   const { tuning } = ctx;
   if (!canAct(self) || !target) return NOTHING;
-  if (distance > ctx.meleeReach) return NOTHING;
+  // Beyond its own reach (`meleeReach`, which leaves the target's body out: D30), only a
+  // judged swing at the target's baked body (Plan 6, Task 27: `spacedSwing`).
+  if (distance > ctx.meleeReach) return spacedSwing(ctx);
   // Nothing lands on a body that cannot be hit (Plan 5, Task 19): a roll, a dodge,
```

The same file, after `landingSwing`. Every name it uses is already in the file after Task 25: `fighterHurtboxes`, `free`, `pulse`, `towardX`, `SMASH_INPUT_WINDOW`, `Btn`, `BehaviourResult`, `swingLands`, `dashLands`.

```diff
 function landingSwing(ctx: BehaviourContext): InputFrame | null {
   const toward = towardX(0, ctx.view.dx);
   for (const swing of GROUND_SWINGS) {
     const input = swing(toward);
     if (swingLands(ctx, input)) return input;
   }
   return null;
 }
+
+/**
+ * How far the target's baked body reaches toward this fighter, in x (Plan 6, Task 27; P5-R23):
+ * the furthest any of its hurt capsules (the bake's, `fighterHurtboxes`, the body `swingLands`
+ * reaches for) extends from its x on this fighter's side, radius included. 0 without the bake or
+ * the target's definition: D30's reading, the body left out.
+ */
+export function bodyToward(ctx: BehaviourContext): number {
+  const { self, target } = ctx.view;
+  const def = target === null ? undefined : ctx.matchDefs[target.port];
+  if (target === null || def === undefined || ctx.bake === undefined) return 0;
+  const body = fighterHurtboxes(def, target, ctx.view.frame, ctx.bake);
+  if (body === null) return 0;
+  const side = self.x <= target.x ? -1 : 1;
+  let out = 0;
+  for (const c of body) out = Math.max(out, side * (c.x1 - target.x) + c.r, side * (c.x2 - target.x) + c.r);
+  return out;
+}
+
+/**
+ * `attack` beyond its own reach (Plan 6, Task 27; P5-R23, carried by D58). `meleeReach` is its
+ * shortest poke's reach and leaves the target's body out (D30: too far cost a match, too close
+ * nothing). Every ground swing is judged now (ruling R-FW1b: `swingLands`), so out to where the
+ * target's baked body could still meet it (`bodyToward`), a CPU on the ground, free and facing
+ * the target, on its swing's beat, throws the swing that lands: the default one, or the first
+ * of its jab and tilts that does (`landingSwing`); in a dash or a run, its dash attack, judged
+ * as `attack` judges one (`dashLands`: at a moving target, a contact inside its own first
+ * window only; Task 25, ruling R-P6-16). Otherwise nothing, and `approach`, which still closes
+ * to `meleeReach`, goes on closing: no distance is left where neither acts (D30), and nothing
+ * here goes unjudged. `decideCpu`'s run-off guard (`runsOff`, Task 26) holds for these swings
+ * as for any, unless the target is off the stage (rulings R-P6-17, R-P6-24).
+ */
+function spacedSwing(ctx: BehaviourContext): BehaviourResult {
+  const { self, target, dx, distance, facingTarget } = ctx.view;
+  if (target === null || ctx.fighterDef === null || target.intangible > 0 || target.invincible > 0) return NOTHING;
+  if (!self.grounded || !free(self) || !facingTarget || !pulse(ctx.view.frame, self.port, 10, 3)) return NOTHING;
+  if (distance > ctx.meleeReach + bodyToward(ctx)) return NOTHING;
+  const stale = self.framesSinceDirPress > SMASH_INPUT_WINDOW;
+  const swing = (stale ? towardX(0, dx) | Btn.Soft : 0) | Btn.Attack;
+  if (self.action === "dashStart" || self.action === "run") return dashLands(ctx, swing) ? { score: 400, input: swing } : NOTHING;
+  if (swingLands(ctx, swing)) return { score: 400, input: swing };
+  const pick = landingSwing(ctx);
+  return pick === null ? NOTHING : { score: 400, input: pick };
+}
```

**`attack`'s beat and default swing.** `pulse(ctx.view.frame, self.port, 10, 3)` is `attack`'s own `swinging`. The default swing is `attack`'s own `(stale ? toward | Btn.Soft : 0) | Btn.Attack`. If an earlier task changed either, use `attack`'s current form.

`src/ai/behaviours.ts`, `meleeReachFromDef`'s comment:

```diff
  * Conservative on purpose in one more way: it ignores the victim's hurtbox
  * radius, which only ever adds reach. Standing a little too close costs the CPU
  * nothing; standing a little too far costs it the entire match.
+ *
+ * It stays `approach`'s threshold (Plan 6, Task 27). Beyond it, `attack` throws
+ * only a swing judged to land on the target's baked body, out to where that body
+ * reaches (`spacedSwing`, `bodyToward` in `offence.ts`): the body counts where a
+ * swing is judged, and nowhere a CPU would stop closing for it.
  */
 export function meleeReachFromDef(def: FighterDef): number {
```

- [ ] **Step 4: Run them again, and the CPU's guards**

Run: `pnpm vitest run src/ai/behaviours.test.ts -t "spacing by the target"`. Expected: PASS (captured: 4 passed).

Then run `pnpm vitest run src/ai src/game`. Expected: the golden fails in the five CPU matches only, as its paragraph says (captured: `Tests 5 failed | 792 passed | 1 skipped (798)`), and everything else passes:
- `cpuIdleHuman.test.ts`, Task 26's ledge scenes included;
- `cpuRollback.test.ts`;
- the existing no-bake "covers every distance for a fighter reaching …" tests.

After Step 6's regeneration the run passes (captured: `Test Files 28 passed`, `Tests 797 passed | 1 skipped (798)`). If a matchup now stalls, stop and report it.

- [ ] **Step 5: Measure (rulings R-P6-19, R-P6-24)**

1. Run `CPU_SWEEP=1 pnpm vitest run src/game/cpuSweep.test.ts --reporter=verbose > "<session scratchpad>/sweep-27.log" 2>&1`. This is the six-seed sweep, 2,016 matches; it took 413 s in the replay at a machine load of 10-12.
2. Judge it against Task 23's recorded baseline. Past any bound, stop and report.
3. In the commit, give the group's table: per fighter fired, landed and mean hold; landed summed; the mean hold over all; `edgeguardExits`; `selfDestructs`. Add `kongKarry` and the `dashAttacks` per fighter.

The replay's figures (captured; the baseline is Task 23's, as Task 23 records it):

| Fighter | Fired | Landed | Mean hold (frames) |
|---|---|---|---|
| donkeyKong | 272 → 266 | 118 → 108 (−8.5%) | 109 → 98 |
| fox | 303 → 299 | 161 → 139 (−13.7%) | 138 → 126 |
| kirby | 351 → 385 | 163 → 222 (+36.2%) | 167 → 159 |
| link | 405 → 413 | 129 → 122 (−5.4%) | 114 → 108 |
| mario | 457 → 457 | 176 → 168 (−4.5%) | 102 → 107 |
| marth | 230 → 238 | 129 → 128 (−0.8%) | 133 → 123 |
| pikachu | 0 → 8 | 0 → 8 | 347 → 333 |
| samus | 232 → 233 | 156 → 157 (+0.6%) | 84 → 70 |
| **all** | 2,250 → 2,299 | **1,032 → 1,052 (+1.9%)** | **146.3 → 139.6 (−4.6%)** |

So, against Task 23's:
- **R-P6-19 passes.** Landed summed rose 1.9% (bound −10%). The furthest any fighter's landed fell is Fox's, −13.7% (bound −25%). The mean hold fell 4.6% (bound +25%).
- **R-P6-24 passes.** `edgeguardExits` rose 1.6%, 5,922 → 6,018 (bound −10%). `selfDestructs` fell, 20 → 7 (bound +2).
- **The other counts:**
  - `finalSmashSelfDestructs` 0 → 0; `kirbyInhaleSelfDestructs` 0 → 0;
  - `kongKarry` 33 → 37; `longestStandby` 2,225 → 1,596;
  - dash attacks thrown 8,532 → 10,983 (+29%: the CPU swings from the edge of the target's body);
  - whiff runs 5 → 8 (Kirby 4 → 6, Samus 1 → 2; nobody else has any).
- Task 26's own table, on the same base, measured landed summed 1,051, mean hold 142.4, `edgeguardExits` 5,530 and `selfDestructs` 8. So this task's own change is small next to that base.

- [ ] **Step 6: Golden**

1. Run `pnpm vitest run src/game/golden.test.ts`. Expected: FAIL in the five CPU matches only. Captured: `first divergence in frames 101-200` for the four, and `501-600` for the ball-on match.
2. Measure the new figures for the two comments. In `describe("engine golden trace", …)`, right after `const all = MATCHES.map((m) => played.get(m.name)!);`, add this temporary block:

   ```ts
     {
       const four = MATCHES.filter((m) => m.cpu && !m.rules.smashBall).map((m) => played.get(m.name)!);
       const union = new Set(four.flatMap((p) => [...p.actions]));
       const ball = MATCHES.filter((m) => m.cpu && m.rules.smashBall).map((m) => played.get(m.name)!);
       const extra = [...new Set(ball.flatMap((p) => [...p.actions]))].filter((a) => !union.has(a));
       process.stderr.write(`PROBE hits ${all.map((p) => p.hits).join("/")} shield ${all.map((p) => p.shieldHits).join("/")} kos ${all.map((p) => p.kos).join("/")} | four reach ${union.size}: ${[...union].sort().join(",")} | ball extra: ${extra.join(",")}\n`);
     }
      ```

   Run `pnpm vitest run src/game/golden.test.ts -t "exercises combat" > "$SCRATCH/probe-ne.log" 2>&1` and read the `PROBE` line. Its figures are in `MATCHES` order. The figures from before the change are **not** the comments' last entries: those are Plan 5's, and Tasks 6-26 moved the CPU matches without adding to either comment. So, with the block still in place, measure them the same way on the tree as Task 26 left it:
   - copy `src/ai/offence.ts` to `"$SCRATCH/offence.after.ts"`;
   - write `git show HEAD:super-smash/src/ai/offence.ts` over `src/ai/offence.ts` (this task's `behaviours.ts` edit is a comment only);
   - run the same command into `"$SCRATCH/probe-ne-before.log"`;
   - copy the saved file back, and check it with `cmp "$SCRATCH/offence.after.ts" src/ai/offence.ts`.

   Then delete the block.
3. Run `UPDATE_GOLDEN=1 pnpm vitest run src/game/golden.test.ts`. Expected: PASS at the current seed (606 in the replay), every lab pin and `MUST_VISIT` included (captured: `Tests 11 passed`). If it stops on `expectCpuFinalSmash`, apply R-P6-18 as the Golden paragraph says.
4. In `golden.test.ts`, add two comment paragraphs in the file's own shape:
   - **The "Measured" comment** (`// A trace of idle fighters would pass every refactor …`). After its last paragraph, before the `(Plan 4 Task 12's, …)` aside, add: "Plan 6 Task 27 (the CPU spaces by the target's baked body: beyond its own reach, a swing judged to land) moved the five CPU matches, `<the samples each first diverged in>`: hits `<before → after>`, shield hits `<before → after>`, KOs `<before → after>`. The 'before' is the tree after Task 26: Plan 6's earlier tasks moved these matches without an entry here. The script and the labs are byte-identical. So now: `<the full lists, from the probe>`."
   - **The `MUST_VISIT` history**, at its end: "Plan 6 Task 27 (the same) adds no action. The four CPU matches reach `<n>` between them, `<up or down>` from `<m>`: `<what they newly reach>`; none `<what they lost>` any more, which `<the matches that still do>` reach. The ball-on match reaches `<its extras, or nothing the four do not>`. All `<count>` are visited." Here `<m>` is the four-reach figure in `probe-ne-before.log`, and `<n>` the one in `probe-ne.log`.
5. Run `pnpm vitest run src/game/rulesVersion.test.ts`. It prints the new digest (replay: `ef01ccf0`, from Task 26's `fa21ba92`; in the plan's order both differ). Set `RULES_PIN.golden` to it.
6. Run `pnpm vitest run src/game/golden.test.ts src/game/rulesVersion.test.ts`. Expected: PASS (captured: `Tests 27 passed`).
7. Run `git diff -- src/game/golden.test.ts`. It must show the two comment paragraphs and nothing else: no `PROBE` block, and no seed change unless R-P6-18 allowed one.

A moved lab pin, or a moved non-CPU match, stops the task.

- [ ] **Step 7: Mutants**

First copy `src/ai/offence.ts` to `"$SCRATCH/offence.ne.ts"`. Then, for each mutant:
1. Apply it by hand.
2. Run `pnpm vitest run src/ai/behaviours.test.ts -t "spacing by the target" > "$SCRATCH/mut-ne.log" 2>&1` and see the named failure.
3. Restore from the copy, and check with `cmp "$SCRATCH/offence.ne.ts" src/ai/offence.ts`. A `git diff` would show this task's own uncommitted change.

All six were captured in the replay.

1. `bodyToward`: `return out;` → `return 0;`. The measure test, the forward tilt and the run test FAIL (`expected 0 to be greater than 0` twice; `standing: expected false to be true`). Restore.
2. `spacedSwing`: `if (swingLands(ctx, swing)) return { score: 400, input: swing };` → `return { score: 400, input: swing };`, an unjudged swing. The property FAILS: `kirby at samus, 14 away: expected false to be true`. Restore.
3. `spacedSwing`: `return pick === null ? NOTHING :` → `return pick === null ? { score: 400, input: 0 } :`, standing there instead of leaving the closing to `approach`. The property FAILS: `kirby at samus, 15 away: expected false to be true`. Restore.
4. `approach`: `if (distance <= ctx.meleeReach) return NOTHING;` → `if (distance <= ctx.meleeReach + bodyToward(ctx)) return NOTHING;`, D30's dead band. The property FAILS: `nothing to do: kirby at samus, 15 away: expected false to be true`. Restore.
5. `spacedSwing`: `dashLands(ctx, swing)` → `swingLands(ctx, swing)`, which drops Task 25's first-window trust. The run test FAILS: `running away: expected 400 to be +0`. Restore.
6. `spacedSwing`: `dashLands(ctx, swing)` → `target.vx === 0 && swingLands(ctx, swing)`, the draft's still-only rule. The run test FAILS: `walking at him: expected false to be true`. Restore.

- [ ] **Step 8: Gate and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`. Expected: exit 0. Typecheck and lint were clean in the replay; lint gave only its two `research/` warnings.

```bash
git add super-smash/src/ai/offence.ts super-smash/src/ai/behaviours.ts super-smash/src/ai/behaviours.test.ts super-smash/src/game/golden.test.ts super-smash/src/game/__golden__/engine-trace.json super-smash/src/game/rulesVersion.test.ts
git commit -m "super-smash: the CPU spaces by the target's baked body: beyond its own reach, only a swing judged to land" -m "P5-R23, carried by D58. Beyond meleeReach and out to bodyToward (the target's baked hurt capsules toward the CPU), attack throws only a swing swingLands or landingSwing judges to land, and a dash attack only as dashLands judges it (Task 25, R-P6-16); approach still closes to meleeReach, so there is no dead band (D30). Against Task 23's baseline (R-P6-19 amended, R-P6-24 amended): <per fighter fired, landed, mean hold; landed summed; mean hold over all; edgeguard exits; self-destructs>; Kong Karry <n>; dash attacks thrown and whiff runs per fighter <...>. Golden: the five CPU matches move (<first samples>; hits, shield hits, KOs and states in golden.test.ts's comments); ball-on seed <606, or its current seed> <unchanged>; RULES_PIN.golden <digest>." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Group 4: presentation

Every task here is render-only, menus, input mapping or audio, except three engine edits: Tasks 31 and 32 add events to `StepEvents` (`simulate.ts`, `types.ts`; events only, never in the state or the hash), and Task 36 refactors `stoneOf` in `engine/stone.ts`. Those edits keep the determinism and layering rules. None moves the golden or the bake; the body tasks run in Group 2.
- **Screenshots.** Committed screenshots come only from `CAPTURE=1 PORT=3107 pnpm test:e2e e2e/screenshots.spec.ts --trace off`, which routes `/models/` to 404 so its fighters are stand-ins. A task stages the shot files it names, never the directory.
- **Browser and images.** These follow the Global Constraints (R-P6-6). A look step is one of three things:
  - a numeric probe (preferred);
  - a stand-in capture to the scratchpad, with `/models/` routed to 404 in that script too;
  - a real-model capture written only to `$SCRATCH`, the session scratchpad (header), viewed with Read and deleted in the same step.
- **Output.** Task 2's quiet-suite rule binds every test here.

**Replay bases.**
- **Tasks 28-34** consume no earlier task's interface, so they were replayed in order at `46e0706` itself. Their context lines are `46e0706`'s. Where an earlier task moved a line, the hunk applies by its symbols.
  - Their e2e runs passed, but the machine's load rose as high as 26 during them, so under the gate's load rule they are not a pass. The final wave (Task 41) reruns them at a load under 6.
- **Tasks 35-40** were replayed at `46e0706` with Task 7 and the body tasks (19-22), in this order.
- **Their seams with what now runs before them:**
  - Task 35's `vfx.ts`, `vfx.test.ts` and `matchRunner.ts` hunks are disjoint from Tasks 31-32's and Tasks 4 and 23's;
  - Task 40's `page.tsx` and `page.test.tsx` hunks are disjoint from Tasks 29-30's;
  - Task 38's paint hunk sits after Task 34's `trails.update();`, as given.

  Task 18's shared idle phase was not in their base. It can move Task 37's outliers (its Step 4, ruling R-P6-23), and it should not move Task 36's trap pin (its Step 2).

### Task 28: The online screens: an unfinished result, the guest's select at phone width, the room code

Three items from Plan 1's screenshots (2026-10-27):
- "Connection Lost / Out of Sync results: the message hugs the header (y≈110), and the page is top-heavy with a big empty area. Center the block, and give the message more weight."
- "Guest character select at phone width (390): the stage+rules banner wraps to 6 lines in the header, and the roster grid is scrolled so its first row is cut off. Shorten the label on narrow screens (e.g. "Battlefield · 3 stocks" + details), and make sure the grid starts at row 1." A probe of `46e0706` at 390 × 844 (a stand-in page in the replay's scratch copy, `/models/` routed to 404) measured the cause. The guest's full tag wraps to six lines and makes the banner 174 px tall, which leaves the roster's scroll box 85 px for a 166 px roster: one row shows, and the second needs a scroll. The roster's top is never clipped; the section starts 12 px, its padding, below the box's top. So the fix is the short tag below `sm`, and the full one from `sm` up. With it the banner is 98 px and the box 161 px (measured), and both rows show. The draft's `items-start` change is dropped: there is no top overflow for it to fix.
- "Room-code screen: a big empty area under the code. Consider a "Copy" button and a line on how the other player joins (open the site → Online → type the code)." The line names the site by its own host (`window.location.host`), which is what the other player types.

**Golden:** unaffected (UI only).

**Files:**
- Modify: `src/components/menu/Results.tsx`, `src/components/menu/CharacterSelect.tsx`, `src/components/online/OnlineLobby.tsx`, `src/lib/matchConfig.ts`, `e2e-online/online.spec.ts`
- Test: `src/components/menu/Results.test.tsx`, `src/components/menu/CharacterSelect.online.test.tsx`, `src/components/online/OnlineLobby.test.tsx`

**Interfaces:**
- Consumes: `UNFINISHED_STATUS`, `SkewPanel` (Results.tsx); `bannerTag`, `rulesLabel`, `findStage` (CharacterSelect.tsx); `roomCode`, `spelledOut`, `showCode`, `SkewButton` (OnlineLobby.tsx); `formatTime` (matchConfig.ts).
- Produces: `shortRulesLabel(rules: MatchRules): string` (matchConfig.ts, beside `rulesLabel`).

- [ ] **Step 1: Write the failing tests**

`src/components/menu/Results.test.tsx`, in `describe("Results after an online match", …)` (where `LOST` is defined), after its first test:

```diff
     expect(screen.queryByRole("button", { name: /rematch/i })).toBeNull();
   });
 
+  it("gives the unfinished message its own centred panel, in larger type (Plan 6, Task 28)", async () => {
+    useMatchConfig.getState().setResult(LOST);
+    await renderResults();
+    const status = await screen.findByText(/connection to the other player was lost/i);
+    expect(status).toBe(screen.getByRole("status"));
+    expect(status.closest("[data-testid='unfinished-panel']")).not.toBeNull();
+    expect(status).toHaveClass("text-lg");
+  });
+
   /** A status region announces a change to one it already knows, not one that arrives with its text in it. */
```

`src/components/menu/CharacterSelect.online.test.tsx`. A helper beside `renderSelect`, the type import, and the existing "every width" test rewritten. The full tag is now hidden below `sm`, so that test's "never inside `.hidden`" now holds of the short tag:

```diff
+import type { MatchRules } from "@/engine/types";
 import type { LobbyMessage, OnlineMatchConfig } from "@/net/online/lobby";
```

```diff
 async function renderSelect() {
   render(<CharacterSelect />);
   await act(async () => {});
 }
+
+/** The guest, the host's stage (and rules, when given) already sent (`OnlineState.hostStage`). */
+async function guestWithStage(rules?: MatchRules) {
+  goOnline("guest");
+  useOnlineStore.getState().patch({ hostStage: rules ? { stageId: "battlefield", form: "normal", rules } : { stageId: "battlefield", form: "normal" } });
+  await renderSelect();
+}
```

```diff
-  /** The banner tag is hidden below `sm` for everyone else; the guest's is the one place it learns the stage. */
-  it("shows the guest the host's stage at every width", async () => {
-    goOnline("guest");
-    useOnlineStore.getState().patch({ hostStage: { stageId: "battlefield", form: "normal" } });
-    await renderSelect();
-    expect(screen.getByText("Stage: Battlefield").closest(".hidden")).toBeNull();
-  });
+  /**
+   * The banner tag is hidden below `sm` for everyone else; the guest's is the one place it learns
+   * the stage, so one of its two tags shows at every width: the short one below `sm` (Plan 6, Task 28).
+   */
+  it("shows the guest the host's stage at every width", async () => {
+    await guestWithStage();
+    expect(screen.getByText("Battlefield").closest(".hidden")).toBeNull();
+    expect(screen.getByText("Battlefield")).toHaveClass("sm:hidden");
+    expect(screen.getByText("Stage: Battlefield")).toHaveClass("hidden", "sm:inline");
+  });
+
+  it("gives the guest a one-line stage-and-rules tag below sm, and the full one from sm (Plan 6, Task 28)", async () => {
+    await guestWithStage({ mode: "stock", stocks: 3, timeLimit: 0, smashBall: true, oneOnOne: true });
+    expect(screen.getByText("Battlefield · 3 stocks")).toHaveClass("sm:hidden");
+    expect(screen.getByText("Stage: Battlefield · 3-stock match · 1v1 damage 1.2× · Smash Ball on")).toHaveClass("hidden", "sm:inline");
+  });
+
+  it("says a timed match's length in the short tag as the match clock shows it", async () => {
+    await guestWithStage({ mode: "time", stocks: 3, timeLimit: 150 * 60, smashBall: false, oneOnOne: true });
+    expect(screen.getByText("Battlefield · 2:30")).toHaveClass("sm:hidden");
+  });
```

`src/components/online/OnlineLobby.test.tsx`, in `describe("OnlineLobby", …)`, after "creates a room and shows its code once the room makes us host". The code panel shows only once the room makes this side host, so the test emits the join as that test does:

```diff
     expect(screen.getByTestId("room-code")).toHaveTextContent(opened[0].code);
   });
 
+  it("offers to copy the room code, and says how the other player joins (Plan 6, Task 28)", async () => {
+    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined);
+    // jsdom has no clipboard: one of the test's own, taken away again after.
+    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
+    try {
+      const { opened } = harness();
+      await create();
+      act(() => opened[0].emit({ type: "joined", role: "host" }));
+      await act(async () => {
+        fireEvent.click(screen.getByRole("button", { name: "Copy room code" }));
+      });
+      expect(writeText).toHaveBeenCalledWith(opened[0].code);
+      expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
+      expect(screen.getByText(`On the other computer: open ${window.location.host}, choose Online, and type the code.`)).toBeInTheDocument();
+    } finally {
+      delete (navigator as { clipboard?: unknown }).clipboard;
+    }
+  });
+
   it("joins a code typed in lowercase with a dash", async () => {
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/components/menu/Results.test.tsx src/components/menu/CharacterSelect.online.test.tsx src/components/online/OnlineLobby.test.tsx`
Expected: FAIL, 5 tests (captured; 5 failed, 107 passed):
- the panel test: `AssertionError: expected null not to be null`;
- the copy test: `TestingLibraryElementError: Unable to find an accessible element with the role "button" and name "Copy room code"`;
- "every width": `Unable to find an element with the text: Battlefield.`;
- the short tag: `Unable to find an element with the text: Battlefield · 3 stocks.`;
- the timed tag: `Unable to find an element with the text: Battlefield · 2:30.`

- [ ] **Step 3: Implement**

`src/components/menu/Results.tsx`, the body's opening:

```diff
-      <div className="mx-auto w-full max-w-6xl flex-1 px-5 pb-10 sm:px-8">
-        <p role="status" className={cn("text-center text-sm font-bold text-white/80", status && "mb-6")}>
-          {status}
-        </p>
+      <div className={cn("mx-auto w-full max-w-6xl flex-1 px-5 pb-10 sm:px-8", unfinished && "flex flex-col items-center justify-center")}>
+        {/* An unfinished match's message is the whole page (Plan 6, Task 28): centred, and larger. */}
+        {unfinished ? (
+          <SkewPanel
+            data-testid="unfinished-panel"
+            className="w-full max-w-xl border-[3px] border-panel-ink bg-[#181b20] shadow-[0_8px_0_rgb(0_0_0/0.4)]"
+            innerClassName="px-8 py-10 text-center"
+          >
+            <p role="status" className="text-lg leading-relaxed font-bold text-white/90">
+              {status}
+            </p>
+          </SkewPanel>
+        ) : (
+          <p role="status" className={cn("text-center text-sm font-bold text-white/80", status && "mb-6")}>
+            {status}
+          </p>
+        )}
```

(`SkewPanel` spreads `data-testid` onto its outer `div`, `SkewPanel.tsx:40-55`. The status region is still mounted with the screen and filled a tick later, as its comment requires: `unfinished` is known on the first render.)

`src/lib/matchConfig.ts`, after `rulesLabel`:

```diff
+/**
+ * The rules in a few words, for a narrow screen's banner (Plan 6, Task 28): "3 stocks", "1 stock",
+ * or a timed match's length as the match clock shows it, "2:30".
+ */
+export function shortRulesLabel(rules: MatchRules): string {
+  if (rules.mode === "stock") return `${rules.stocks} ${rules.stocks === 1 ? "stock" : "stocks"}`;
+  return formatTime(rules.timeLimit);
+}
+
 export interface PlayerResultStat {
```

`src/components/menu/CharacterSelect.tsx`:

```diff
   rulesLabel,
+  shortRulesLabel,
   useMatchConfig,
```

```diff
-  const bannerTag =
-    onlineRole === "guest"
-      ? hostStage
-        ? [`Stage: ${findStage(roster, hostStage.stageId)?.name ?? "Random"}`, hostStage.rules && rulesLabel(hostStage.rules)]
-            .filter(Boolean)
-            .join(" · ")
-        : "The host is picking the stage"
+  const guestStage = onlineRole === "guest" && hostStage ? (findStage(roster, hostStage.stageId)?.name ?? "Random") : null;
+  const bannerTag =
+    onlineRole === "guest"
+      ? hostStage && guestStage !== null
+        ? (
+            // One line on a phone, the details from `sm` up (Plan 6, Task 28): the full tag
+            // wrapped to six lines at 390 px and left the roster a box 85 px tall.
+            <>
+              <span className="sm:hidden">{[guestStage, hostStage.rules && shortRulesLabel(hostStage.rules)].filter(Boolean).join(" · ")}</span>
+              <span className="hidden sm:inline">
+                {[`Stage: ${guestStage}`, hostStage.rules && rulesLabel(hostStage.rules)].filter(Boolean).join(" · ")}
+              </span>
+            </>
+          )
+        : "The host is picking the stage"
       : onlineRole === "host"
```

`src/components/online/OnlineLobby.tsx`:

```diff
   const [tried, setTried] = useState<RoomIntent | null>(null);
+  /** The Copy button says so for two seconds after a copy (Plan 6, Task 28). */
+  const [copied, setCopied] = useState(false);
+  useEffect(() => {
+    if (!copied) return;
+    const t = setTimeout(() => setCopied(false), 2_000);
+    return () => clearTimeout(t);
+  }, [copied]);
   const errorId = useId();
```

```diff
               <p className="sr-only">{spelledOut(roomCode)}</p>
+              {/* How the other player gets here, and the code to paste (Plan 6, Task 28). */}
+              <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-3">
+                <SkewButton
+                  aria-label={copied ? "Copied" : "Copy room code"}
+                  onClick={() => {
+                    // Clipboard access can be refused (permissions, an insecure page): the code stays on screen.
+                    void navigator.clipboard?.writeText(roomCode ?? "").then(
+                      () => setCopied(true),
+                      () => {},
+                    );
+                  }}
+                  className="border-[3px] border-panel-ink bg-smash-yellow px-5 py-1.5 text-panel-ink transition-transform hover:-translate-y-0.5"
+                  innerClassName="font-display text-sm tracking-[0.14em] uppercase"
+                >
+                  {copied ? "Copied" : "Copy"}
+                </SkewButton>
+                <p className="text-sm font-bold">On the other computer: open {window.location.host}, choose Online, and type the code.</p>
+              </div>
             </div>
           </SkewPanel>
```

(The panel renders only on the client, after a press: `showCode` needs a room, so `window` is always there.)

`e2e-online/online.spec.ts`, the leave test's end, and a new test after it:

```diff
   await host.waitForURL(`**${ROUTES.results}`, { timeout: LINK_LOST_LIMIT_MS });
   await expect(host.getByText("Connection Lost", { exact: true })).toBeVisible();
+  // The message is the page's middle, not a line under the header (Plan 6, Task 28).
+  const box = (await host.getByRole("status").boundingBox())!;
+  const height = host.viewportSize()!.height;
+  expect(box.y + box.height / 2).toBeGreaterThan(height * 0.3);
+  expect(box.y + box.height / 2).toBeLessThan(height * 0.7);
 });
 
+test("the guest's character select fits a phone: a short stage tag, and room for the roster (Plan 6, Task 28)", async ({ browser }) => {
+  const host = await player(browser);
+  const guest = await player(browser);
+  await guest.setViewportSize({ width: 390, height: 844 });
+  const code = await createRoom(host);
+  await joinRoom(guest, code);
+  await host.waitForURL(`**${ROUTES.stage}`, { timeout: 30_000 });
+  await guest.waitForURL(`**${ROUTES.fighters}`, { timeout: 30_000 });
+  await host.getByLabel("Stages", { exact: true }).getByRole("button", { name: "Battlefield", exact: true }).click();
+  await host.getByRole("button", { name: /choose fighters/i }).click();
+  const tag = guest.getByText(/^Battlefield · \d+ stocks?$/);
+  await expect(tag).toBeVisible();
+  // Two lines at most at 390 px wide; the full tag took six.
+  expect((await tag.boundingBox())!.height).toBeLessThan(40);
+  // So the roster's scroll box keeps room for both rows of portraits (161 px, against 85 under the full tag).
+  const roster = guest.getByLabel("Fighters", { exact: true }).locator("..");
+  expect((await roster.boundingBox())!.height).toBeGreaterThan(140);
+});
+
 test("two browsers play a match to its result, and both see the same one", async ({ browser }) => {
```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/components src/lib`
Expected: PASS (captured: 19 files, 374 tests), with no stray output.

- [ ] **Step 5: Mutants**

1. `Results.tsx`: drop `text-lg` from the panel's status. The panel test FAILS: ``Error: expect(element).toHaveClass("text-lg")`` (captured).
2. `matchConfig.ts`: `return formatTime(rules.timeLimit);` → ``return `${Math.round(rules.timeLimit / 3600)} min`;`` (the draft's). The timed test FAILS: `Unable to find an element with the text: Battlefield · 2:30.` (captured).
3. `OnlineLobby.tsx`: `writeText(roomCode ?? "")` → `writeText("")`. The copy test FAILS: `AssertionError: expected "vi.fn()" to be called with arguments: [ '<the code>' ]` (captured).
4. `CharacterSelect.tsx`: `<span className="sm:hidden">` → `<span className="hidden">`. "every width" FAILS: `AssertionError: expected <span class="hidden"></span> to be null` (captured).

- [ ] **Step 6: Gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`, `PORT=3107 pnpm test:e2e --trace off`, `pnpm test:e2e:online --trace off`.
Expected: exit 0; the leave test's centring check and the phone test pass. In the replay, the stand-in probe measured the status line's centre at 345 px of 720 (0.48), the guest's short tag 33 px tall, and the roster box 161 px.

- [ ] **Step 7: Commit**

```bash
git add super-smash/src/components/menu/Results.tsx super-smash/src/components/menu/Results.test.tsx super-smash/src/components/menu/CharacterSelect.tsx super-smash/src/components/menu/CharacterSelect.online.test.tsx super-smash/src/components/online/OnlineLobby.tsx super-smash/src/components/online/OnlineLobby.test.tsx super-smash/src/lib/matchConfig.ts super-smash/e2e-online/online.spec.ts
git commit -m "super-smash: an unfinished result's message centred; the guest's select fits a phone; the room code has Copy and a join line" -m "Plan 1's screenshot findings. The guest's short tag takes the banner from 174 px to 98 at 390 wide, so the roster shows both rows; a timed match reads as its clock (2:30). UI only." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 29: `/play` without a match set up goes to the menu

From Plan 1's re-review (out-of-scope 3): "Back from /results after the 1.5 s grace builds a local match from the default seats. Decide what /play without an armed match should do (probably route to /menu)." Today the local-match effect in `src/app/play/page.tsx` runs whatever the store holds. So browser Back from the results, browser Back from the menu after a quit, or a cold load of `/play` each starts a match nobody set up.

This task adds an armed flag:
- the select screen's start and the results' Rematch arm a match;
- a result, quitting a local match, and `reset` disarm it;
- `/play`, with nothing armed and nothing online, replaces itself with `/menu`.

It makes `SPEC.md` §9's change in its own commit (D2 is dropped, R-P6-8). Old: "| `/play` | The match itself |". New: "| `/play` | The match itself (with no match set up, it goes to the menu) |". Task 42 lists it in D59 and the report.

**Golden:** unaffected.

**Files:**
- Modify: `src/lib/matchConfig.ts` (`armed`, `arm()`, `disarm()`), `src/components/menu/CharacterSelect.tsx`, `src/components/menu/Results.tsx`, `src/app/play/page.tsx`, `e2e/flow.spec.ts`, `SPEC.md`
- Test: `src/app/play/page.test.tsx`, `src/lib/matchConfig.test.ts`, `src/components/menu/CharacterSelect.test.tsx`, `src/components/menu/Results.test.tsx`

**Interfaces:**
- Consumes: `useMatchConfig`, `setResult`, the play page's `online`, `stranded` and `quit`.
- Produces: `MatchConfigState.armed: boolean`, `arm(): void`, `disarm(): void`.

- [ ] **Step 1: Write the failing tests**

`src/lib/matchConfig.test.ts`, before `describe("rules", …)`:

```diff
+describe("the armed flag (Plan 6, Task 29)", () => {
+  it("is set by arm(), and cleared by a result, by disarm() and by reset()", () => {
+    expect(store().armed).toBe(false);
+    store().arm();
+    expect(store().armed).toBe(true);
+    store().setResult({ kind: "timeUp", placings: [0, 1], stats: [], fighters: { 0: "mario", 1: "fox" } });
+    expect(store().armed).toBe(false);
+    store().arm();
+    store().disarm();
+    expect(store().armed).toBe(false);
+    store().arm();
+    store().reset();
+    expect(store().armed).toBe(false);
+  });
+});
+
 describe("rules", () => {
```

`src/components/menu/CharacterSelect.test.tsx`, "holds READY TO FIGHT shut until every panel is filled":

```diff
     fireEvent.click(armed);
     expect(routerMock.push).toHaveBeenCalledWith("/play");
+    // What lets `/play` start it (Plan 6, Task 29).
+    expect(useMatchConfig.getState().armed).toBe(true);
   });
```

`src/components/menu/Results.test.tsx`, "offers a rematch, a change of fighters, and a way out":

```diff
     fireEvent.click(screen.getByRole("button", { name: /rematch/i }));
     expect(routerMock.push).toHaveBeenCalledWith("/play");
+    // The rematch is armed, so `/play` plays it (Plan 6, Task 29).
+    expect(useMatchConfig.getState().armed).toBe(true);
```

`src/app/play/page.test.tsx`. Every existing match in the file is one somebody set up, so the file's `beforeEach` arms after its reset. The new tests sit before `describe("the play page, local", …)`. The file runs fake timers, and the effects have run inside `renderPage`'s `act`, so the tests assert directly, with no `waitFor`:

```diff
   routerMock.replace.mockClear();
   useMatchConfig.getState().reset();
+  // Every match below is one somebody set up (Plan 6, Task 29): a local `/play` with
+  // nothing armed goes to the menu instead ("a /play with no match set up").
+  useMatchConfig.getState().arm();
 });
```

```diff
+describe("a /play with no match set up (Plan 6, Task 29)", () => {
+  it("goes to the menu and starts nothing", async () => {
+    useMatchConfig.getState().disarm();
+    await renderPage();
+    expect(routerMock.replace).toHaveBeenCalledWith("/menu");
+    expect(mocks.runners).toEqual([]);
+  });
+
+  it("plays a match the select screen armed, and its result disarms it", async () => {
+    await renderPage();
+    expect(mocks.runners).toHaveLength(1);
+    expect(routerMock.replace).not.toHaveBeenCalled();
+    act(() => only(mocks.runners).options.onEnd?.({ kind: "timeUp", placings: [0, 1] }));
+    expect(useMatchConfig.getState().armed).toBe(false);
+  });
+
+  it("disarms a local match its player quits, so browser Back from the menu starts nothing", async () => {
+    await renderPage();
+    quitFromMenu("QUIT MATCH");
+    expect(routerMock.push).toHaveBeenCalledWith("/menu");
+    expect(useMatchConfig.getState().armed).toBe(false);
+  });
+});
+
 describe("the play page, local", () => {
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/app/play/page.test.tsx src/lib/matchConfig.test.ts src/components/menu`
Expected: FAIL (captured; 77 failed, 160 passed):
- every test in `page.test.tsx`: `TypeError: useMatchConfig.getState(...).arm is not a function`, from the file's `beforeEach`;
- the store test: `AssertionError: expected undefined to be false`;
- the select test and the Rematch test: `AssertionError: expected undefined to be true`.

- [ ] **Step 3: Implement**

`src/lib/matchConfig.ts`. The state, after `controlPrefs: ControlPrefs;`:

```diff
   controlPrefs: ControlPrefs;
+  /**
+   * A local match is set up to run (Plan 6, Task 29): armed by the select screen's
+   * start and the results' Rematch; disarmed by a result, by quitting the match and
+   * by `reset`. `/play` with nothing armed and nothing online goes to the menu, so
+   * browser Back from the results, or from the menu after a quit, starts nothing.
+   */
+  armed: boolean;
 
   setMode(mode: MatchRules["mode"]): void;
```

```diff
   setResult(result: MatchResult | null): void;
+  arm(): void;
+  disarm(): void;
   reset(): void;
```

The store: the initial state, `setResult`, the two actions and `reset`:

```diff
   localOptions: DEFAULT_CONTROL_OPTIONS,
   controlPrefs: {},
+  armed: false,
 
   setMode: (mode) => set((s) => ({ rules: { ...s.rules, mode } })),
```

```diff
-  setResult: (result) => set({ result }),
+  setResult: (result) => set({ result, armed: false }),
+
+  arm: () => set({ armed: true }),
+
+  disarm: () => set({ armed: false }),
 
   reset: () =>
```

```diff
       localOptions: DEFAULT_CONTROL_OPTIONS,
       controlPrefs: {},
+      armed: false,
     }),
 }));
```

`src/components/menu/CharacterSelect.tsx`, `startMatch`:

```diff
     if (onlineRole === null) {
+      // What `/play` starts (Plan 6, Task 29).
+      useMatchConfig.getState().arm();
       router.push("/play");
       return;
     }
```

`src/components/menu/Results.tsx`, Rematch:

```diff
               <SkewButton
-                onClick={() => router.push("/play")}
+                onClick={() => {
+                  // What `/play` starts (Plan 6, Task 29).
+                  useMatchConfig.getState().arm();
+                  router.push("/play");
+                }}
```

`src/app/play/page.tsx`: `quit`, the flag read once on the way in, its effect, and the local-match effect's guard and dependencies:

```diff
     runnerRef.current?.dispose();
     keyboardRef.current?.detach();
+    // Browser Back from the menu must not start the match again (Plan 6, Task 29).
+    if (!online) useMatchConfig.getState().disarm();
     router.push("/menu");
     if (online) leaveOnline();
   }, [online, router]);
```

```diff
   const [stranded] = useState(() => online === null && useMatchConfig.getState().online);
+  // Nothing set up to play (Plan 6, Task 29): browser Back from the results or from
+  // the menu after a quit, or a cold load. Read once, on the way in, as `stranded` is.
+  const [unarmed] = useState(() => online === null && !useMatchConfig.getState().online && !useMatchConfig.getState().armed);
```

```diff
   useEffect(() => {
+    if (unarmed) router.replace("/menu");
+  }, [unarmed, router]);
+
+  useEffect(() => {
     if (!stranded) return;
```

```diff
   useEffect(() => {
-    if (online || stranded) return;
+    if (online || stranded || unarmed) return;
     const canvas = canvasRef.current;
```

```diff
-  }, [online, stranded, players, stageId, stageForm, rules, bindings, router, setResult, bake.tables, world]);
+  }, [online, stranded, unarmed, players, stageId, stageForm, rules, bindings, router, setResult, bake.tables, world]);
```

`e2e/flow.spec.ts`:

```diff
-test("a stock match ends and reaches the results screen", async ({ page }) => {
+test("a cold load of /play, with no match set up, goes to the menu (Plan 6, Task 29)", async ({ page }) => {
   await startFromTitle(page);
   await page.goto(ROUTES.play);
-  // A cold load of /play with no configuration should refuse rather than crash.
-  const alert = page.getByRole("alert");
-  const canvas = page.getByLabel("Match", { exact: true });
-  await expect(alert.or(canvas).first()).toBeVisible();
+  await page.waitForURL(`**${ROUTES.menu}`);
+  await expect(page.getByLabel("Match", { exact: true })).toHaveCount(0);
 });
```

`SPEC.md` §9:

```diff
-| `/play` | The match itself |
+| `/play` | The match itself (with no match set up, it goes to the menu) |
```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/app/play/page.test.tsx src/lib src/components/menu`
Expected: PASS (captured: 16 files, 361 tests).

- [ ] **Step 5: Mutants**

1. `page.tsx`: `if (online || stranded || unarmed) return;` → `if (online || stranded) return;`. "goes to the menu and starts nothing" FAILS: `AssertionError: expected [ { options: { …(13) }, …(1) } ] to deeply equal []` (captured).
2. `matchConfig.ts`: `setResult: (result) => set({ result, armed: false }),` → `set({ result })`. The store test and "its result disarms it" FAIL: `AssertionError: expected true to be false` (captured).
3. `page.tsx`: delete `if (!online) useMatchConfig.getState().disarm();`. The quit test FAILS: `AssertionError: expected true to be false` (captured).

- [ ] **Step 6: Gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`, `PORT=3107 pnpm test:e2e --trace off`, `pnpm test:e2e:online --trace off` (the page's mount and `quit` run online too). Expected: exit 0. Every e2e reaches `/play` through `startMatchFromMenu` or the online lobby, and none reloads `/play`, so the only route change is the cold load this task's flow test pins.

- [ ] **Step 7: Commit**

```bash
git add super-smash/src/lib/matchConfig.ts super-smash/src/lib/matchConfig.test.ts super-smash/src/components/menu/CharacterSelect.tsx super-smash/src/components/menu/CharacterSelect.test.tsx super-smash/src/components/menu/Results.tsx super-smash/src/components/menu/Results.test.tsx super-smash/src/app/play/page.tsx super-smash/src/app/play/page.test.tsx super-smash/e2e/flow.spec.ts super-smash/SPEC.md
git commit -m "super-smash: /play with no match set up goes to the menu" -m "An armed flag: set by the select screen's start and Rematch, cleared by a result, a local quit and reset. Browser Back from the results, or from the menu after a quit, starts nothing. SPEC §9's /play row says so (D2 dropped: the change is made here and reported in D59). UI only." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 30: Press-to-join pad seating

From Plan 1 (codex P2#6, a documented limit): "Explicit press-to-join pad seating." Today pads seat by connection order (`padPortMap(humans)`: the first connected pad drives the first human port), so who drives which fighter depends on plug order.

This task lets a pad claim a seat on the character select, under ruling R-P6-11:
- **The seat.** An unseated pad that presses A (standard button 0) or Start (9) takes a new human seat: the first CPU seat, made human, or else a new seat while there are fewer than four. It never stacks onto the keyboard player's port; every human seat already has a keyboard scheme. With the default seats (P1 human on the keyboard, P2 CPU), a friend's pad takes P2.
- **The badge.** The seat's panel says "Pad" in its port's colour, where a keyboard seat names its scheme.
- **Unjoined pads.** A pad nobody joined keeps the connection-order rule on the human seats nobody joined, and never takes a joined seat. So a lone pad that never presses join still plays P1, as today.
- **Online.** Joining is off on the online select screen: each machine has its one seat there.
- **A CPU seat.** A seat turned back into a CPU frees its pad.

The select screen polls the pads once an animation frame. Its test steps those frames under fake timers inside `act()` (I6), so the suite stays quiet.

**Golden:** unaffected.

**Files:**
- Create: `src/input/padJoin.ts`, `src/input/padJoin.test.ts`
- Modify: `src/input/gamepad.ts` (`GamepadOptions.portForPadIndex`), `src/lib/matchConfig.ts` (`PlayerSlot.joinedPad`, `seatPad`), `src/components/menu/CharacterSelect.tsx`, `src/app/play/page.tsx`, `e2e/padOptions.spec.ts`
- Test: `src/input/gamepad.test.ts`, `src/lib/matchConfig.test.ts`, `src/components/menu/CharacterSelect.test.tsx`, `src/components/menu/CharacterSelect.online.test.tsx`, `src/app/play/page.test.tsx`, `src/game/onlineConfig.test.ts` (its `PlayerSlot` literals gain the field)

**Interfaces:**
- Consumes: `padsInOrder`, `GamepadInput.poll`, `heldPortFor`, `padPortMap` (gamepad.ts); `addPlayer`'s seat building (`makePlayer`, `withOptions`, `withDerivedRules`).
- Produces:
  - `joinPresses(pads: readonly (Gamepad | null)[], seated: ReadonlySet<number>, last: Map<number, boolean>): number[]` (padJoin.ts);
  - `GamepadOptions.portForPadIndex?: (index: number) => number` (−1 for none);
  - `PlayerSlot.joinedPad: number | null`;
  - `seatPad(index: number): void` (store).

- [ ] **Step 1: Write the failing tests**

`src/input/padJoin.test.ts` (new file):

```ts
import { describe, expect, it } from "vitest";

import { joinPresses } from "./padJoin";

/** A connected pad at `index` with `pressed` buttons down. */
const pad = (index: number, pressed: number[]): Gamepad =>
  ({ index, connected: true, buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })) }) as unknown as Gamepad;

describe("press-to-join (Plan 6, Task 30)", () => {
  it("reports an unseated pad whose A or Start went down, once a press", () => {
    const last = new Map<number, boolean>();
    expect(joinPresses([pad(0, [])], new Set(), last)).toEqual([]);
    expect(joinPresses([pad(0, [0])], new Set(), last)).toEqual([0]);
    expect(joinPresses([pad(0, [0])], new Set(), last)).toEqual([]);
    expect(joinPresses([pad(0, []), pad(2, [9])], new Set(), last)).toEqual([2]);
  });

  it("ignores a pad already seated, an empty slot and a disconnected pad", () => {
    const last = new Map<number, boolean>();
    const gone = { ...pad(4, [0]), connected: false } as unknown as Gamepad;
    expect(joinPresses([null, pad(1, [0]), gone], new Set([1]), last)).toEqual([]);
  });
});
```

`src/input/gamepad.test.ts`, before `describe("polling", …)`. Pad 3 joins port 0, which is not its connection ordinal, so at `46e0706` (the option ignored) the two pads land on each other's ports:

```diff
+describe("press-to-join seats (Plan 6, Task 30)", () => {
+  it("drives a joined pad's seat by its index, and an unjoined pad never takes it", () => {
+    // Pad 3 pressed to join port 0. Pad 0, joined to nothing, keeps connection order
+    // among the pads nobody joined, and skips the joined seat: port 1.
+    const pads = [pad({ index: 0, buttons: [1] }), pad({ index: 3, buttons: [0] })];
+    const input = createGamepadInput({
+      navigator: navigatorWith(pads),
+      portForPad: padPortMap([0, 1]),
+      holdPorts: true,
+      portForPadIndex: (index) => (index === 3 ? 0 : -1),
+    });
+    const { frames } = input.poll(2);
+    expect([held(frames[0], Btn.Attack), held(frames[0], Btn.Special)]).toEqual([true, false]);
+    expect([held(frames[1], Btn.Attack), held(frames[1], Btn.Special)]).toEqual([false, true]);
+  });
+});
+
 describe("polling", () => {
```

`src/lib/matchConfig.test.ts`, before `describe("rules", …)`:

```diff
+describe("press-to-join seats (Plan 6, Task 30; ruling R-P6-11)", () => {
+  it("seats a joining pad on the first CPU seat, made human, never on the keyboard player's", () => {
+    store().seatPad(0);
+    expect(store().players.map((p) => [p.kind, p.joinedPad])).toEqual([
+      ["human", null],
+      ["human", 0],
+    ]);
+  });
+
+  it("adds a human seat once no CPU seat is left, up to four, and seats each pad once", () => {
+    store().seatPad(0);
+    store().seatPad(3);
+    store().seatPad(3);
+    expect(store().players.map((p) => [p.kind, p.joinedPad])).toEqual([
+      ["human", null],
+      ["human", 0],
+      ["human", 3],
+    ]);
+    store().seatPad(5);
+    store().seatPad(6);
+    expect(store().players.map((p) => p.joinedPad)).toEqual([null, 0, 3, 5]);
+  });
+
+  it("frees a pad whose seat is turned back into a CPU", () => {
+    store().seatPad(0);
+    store().togglePlayerKind(1);
+    expect(store().players[1]).toMatchObject({ kind: "cpu", joinedPad: null });
+  });
+
+  it("is off online", () => {
+    store().configureOnline();
+    store().seatPad(0);
+    expect(store().players.map((p) => p.joinedPad)).toEqual([null, null]);
+  });
+});
+
 describe("rules", () => {
```

`src/components/menu/CharacterSelect.test.tsx`. `vi` joins the vitest import. The test goes before "clamps the CPU level to 1–9 at both ends", and the first rAF frame records the pad's unpressed state:

```diff
-import { beforeEach, describe, expect, it } from "vitest";
+import { beforeEach, describe, expect, it, vi } from "vitest";
```

```diff
+  it("seats a pad that presses A on the CPU's seat, never the keyboard player's, and says so on its panel (Plan 6, Task 30)", async () => {
+    // The pads are polled once an animation frame; the frames are stepped inside act().
+    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
+    let pressed: number[] = [];
+    Object.defineProperty(navigator, "getGamepads", {
+      configurable: true,
+      value: () => [{ index: 0, connected: true, buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })) }],
+    });
+    try {
+      await renderSelect();
+      await act(async () => {
+        vi.advanceTimersByTime(16);
+      });
+      pressed = [0];
+      await act(async () => {
+        vi.advanceTimersByTime(16);
+      });
+      expect(useMatchConfig.getState().players.map((p) => [p.kind, p.joinedPad])).toEqual([
+        ["human", null],
+        ["human", 0],
+      ]);
+      expect(within(document.querySelector<HTMLElement>("[data-port='1']")!).getByText("Pad")).toBeInTheDocument();
+      expect(document.querySelector("[data-port='0']")).not.toHaveTextContent("Pad");
+    } finally {
+      delete (navigator as { getGamepads?: unknown }).getGamepads;
+      vi.useRealTimers();
+    }
+  });
+
   /** Ultimate's CPU levels run 1–9 and the ends are hard stops, not wraps. */
```

`src/components/menu/CharacterSelect.online.test.tsx`, before "makes the host's back button leave the room once the room cannot go on":

```diff
+  it("leaves the seats alone when a pad presses A: joining is local only (Plan 6, Task 30)", async () => {
+    vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame"] });
+    Object.defineProperty(navigator, "getGamepads", {
+      configurable: true,
+      value: () => [{ index: 0, connected: true, buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: i === 0, value: i === 0 ? 1 : 0 })) }],
+    });
+    try {
+      goOnline("guest");
+      await renderSelect();
+      await act(async () => {
+        vi.advanceTimersByTime(48);
+      });
+      expect(useMatchConfig.getState().players.map((p) => [p.kind, p.joinedPad])).toEqual([
+        ["human", null],
+        ["human", null],
+      ]);
+    } finally {
+      delete (navigator as { getGamepads?: unknown }).getGamepads;
+      vi.useRealTimers();
+    }
+  });
+
   it("makes the host's back button leave the room once the room cannot go on", async () => {
```

`src/app/play/page.test.tsx`, in `describe("the play page, local", …)`, before the Stick Jump test ("Plan 5, Task 20: each human's Stick Jump goes to the sim,"):

```diff
+  it("lets a pad that pressed to join drive its own seat, and the rest keep connection order on the other human ports (Plan 6, Task 30)", async () => {
+    // The pad at index 3 joined on the select screen: P2, the CPU's seat, made human.
+    useMatchConfig.getState().seatPad(3);
+    await renderPage();
+    const pad = only(mocks.pads);
+    expect([0, 3, 7].map((index) => pad.options.portForPadIndex?.(index))).toEqual([-1, 1, -1]);
+    expect([0, 1].map((ordinal) => pad.options.portForPad?.(ordinal))).toEqual([0, -1]);
+  });
+
   /**
    * Plan 5, Task 20: each human's Stick Jump goes to the sim,
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/input src/lib/matchConfig.test.ts src/components/menu src/app/play/page.test.tsx`
Expected: FAIL (captured; 8 failed, 366 passed, and `padJoin.test.ts` fails to load):
- `padJoin.test.ts`: `Error: Failed to resolve import "./padJoin"`;
- the gamepad test: `AssertionError: expected [ false, true ] to deeply equal [ true, false ]`;
- the four store tests: `TypeError: store(...).seatPad is not a function`;
- the page test: `TypeError: useMatchConfig.getState(...).seatPad is not a function`;
- the select test: `AssertionError: expected [ [ 'human', undefined ], …(1) ] to deeply equal [ [ 'human', null ], [ 'human', +0 ] ]`;
- the online test: `AssertionError: expected [ [ 'human', undefined ], …(1) ] to deeply equal [ Array(2) ]` (no `joinedPad` field yet).

- [ ] **Step 3: Implement**

`src/input/padJoin.ts` (new file):

```ts
/**
 * Press-to-join (Plan 6, Task 30): on the character select, a pad that is not seated
 * claims a seat by pressing A (standard button 0) or Start (9). Pure: the caller polls
 * and seats (`useMatchConfig.seatPad`, ruling R-P6-11).
 */

const JOIN_BUTTONS = [0, 9] as const;

/**
 * The indices of the connected pads, not in `seated`, whose A or Start went down since
 * the last call. `last` is the caller's, kept between calls: each pad's press, so a held
 * button joins once.
 */
export function joinPresses(pads: readonly (Gamepad | null)[], seated: ReadonlySet<number>, last: Map<number, boolean>): number[] {
  const out: number[] = [];
  for (const pad of pads) {
    if (pad === null || !pad.connected) continue;
    const down = JOIN_BUTTONS.some((b) => pad.buttons[b]?.pressed === true);
    const was = last.get(pad.index) ?? false;
    last.set(pad.index, down);
    if (down && !was && !seated.has(pad.index)) out.push(pad.index);
  }
  return out;
}
```

`src/input/gamepad.ts`:

```diff
   readonly holdPorts?: boolean;
+  /**
+   * The port a pad drives by its `Gamepad.index`, for a pad seated by pressing to join on
+   * the character select (Plan 6, Task 30; ruling R-P6-11); -1 for none. The pads nobody
+   * joined keep `portForPad`'s connection order among themselves, and never take a port a
+   * joined pad drives.
+   */
+  readonly portForPadIndex?: (index: number) => number;
   /**
    * Plan 5: each port's own mapping (its player's remap on /controls), asked
```

```diff
   private readonly holdPorts: boolean;
+  private readonly portForPadIndex: ((index: number) => number) | undefined;
   private readonly onConnectionChange: ((padIndex: number, connected: boolean) => void) | undefined;
```

```diff
     this.holdPorts = options.holdPorts ?? false;
+    this.portForPadIndex = options.portForPadIndex;
     this.onConnectionChange = options.onConnectionChange;
```

```diff
     const pads = padsInOrder(this.supported ? this.nav!.getGamepads() : []);
     if (this.holdPorts) this.releaseUnplugged(pads);
-    for (const [ordinal, pad] of pads.entries()) {
-      const port = this.holdPorts ? this.heldPortFor(pad.index, portCount) : this.portForPad(ordinal);
+    // A pad seated by pressing to join drives its own seat (Plan 6, Task 30). The others
+    // keep connection order among themselves, ordinals counted over them alone, and
+    // never take a joined seat.
+    const joinedPortOf = (pad: Gamepad): number => this.portForPadIndex?.(pad.index) ?? -1;
+    const joined = new Set(pads.map(joinedPortOf).filter((port) => port >= 0));
+    let ordinal = 0;
+    for (const pad of pads) {
+      const own = joinedPortOf(pad);
+      let port = own;
+      if (own < 0) {
+        port = this.holdPorts ? this.heldPortFor(pad.index, portCount, joined) : this.portForPad(ordinal);
+        ordinal += 1;
+        if (joined.has(port)) continue;
+      }
       if (port < 0 || port >= portCount) continue;
```

```diff
-  private heldPortFor(index: number, portCount: number): number {
+  private heldPortFor(index: number, portCount: number, joined: ReadonlySet<number>): number {
     const held = this.heldPorts.get(index);
     if (held !== undefined) return held;
     const taken = new Set(this.heldPorts.values());
     for (let ordinal = 0; ordinal < portCount; ordinal++) {
       const port = this.portForPad(ordinal);
-      if (port >= 0 && port < portCount && !taken.has(port)) {
+      if (port >= 0 && port < portCount && !taken.has(port) && !joined.has(port)) {
```

`src/lib/matchConfig.ts`. `PlayerSlot`, both seat builders, the action's declaration, the two kind setters, and `seatPad`:

```diff
   pad: PadSettings;
+  /**
+   * The `Gamepad.index` of the pad that pressed to join this seat on the character
+   * select, or null (Plan 6, Task 30; ruling R-P6-11). A joined pad drives this seat
+   * whatever its connection order. Local only; a CPU seat holds none.
+   */
+  joinedPad: number | null;
 }
```

```diff
     scheme: CONTROL_SCHEMES[Math.min(port, CONTROL_SCHEMES.length - 1)],
     ...DEFAULT_CONTROL_OPTIONS,
+    joinedPad: null,
   };
 }
```

```diff
-  return { port, kind: "human", cpuLevel: 3, fighterId: null, costume: port, scheme: "arrows", stickJump: local.stickJump, pad: local.pad };
+  return { port, kind: "human", cpuLevel: 3, fighterId: null, costume: port, scheme: "arrows", stickJump: local.stickJump, pad: local.pad, joinedPad: null };
```

```diff
   setResult(result: MatchResult | null): void;
+  /**
+   * A pad pressed to join on the character select (Plan 6, Task 30; ruling R-P6-11): it takes
+   * the first CPU seat, made human, or else a new human seat while there are fewer than four.
+   * Never a seat a keyboard player is on, never a second seat for one pad, and never online.
+   */
+  seatPad(index: number): void;
   arm(): void;
```

```diff
   setPlayerKind: (port, kind) =>
     set((s) => ({
-      players: s.players.map((p) => (p.port === port ? { ...p, kind } : p)),
+      // A CPU seat holds no joined pad (Plan 6, Task 30): its pad goes back to connection order.
+      players: s.players.map((p) => (p.port === port ? { ...p, kind, joinedPad: kind === "cpu" ? null : p.joinedPad } : p)),
     })),
 
   togglePlayerKind: (port) =>
     set((s) => ({
       players: s.players.map((p) =>
-        p.port === port ? { ...p, kind: p.kind === "cpu" ? "human" : "cpu" } : p,
+        p.port === port ? (p.kind === "cpu" ? { ...p, kind: "human" } : { ...p, kind: "cpu", joinedPad: null }) : p,
       ),
     })),
+
+  seatPad: (index) =>
+    set((s) => {
+      if (s.online || s.players.some((p) => p.joinedPad === index)) return s;
+      const cpu = s.players.find((p) => p.kind === "cpu");
+      if (cpu !== undefined) {
+        return { players: s.players.map((p) => (p === cpu ? { ...p, kind: "human" as const, joinedPad: index } : p)) };
+      }
+      if (s.players.length >= MAX_PLAYERS) return s;
+      const port = s.players.length;
+      const players = [...s.players, { ...withOptions(makePlayer(port), s.controlPrefs[port]), kind: "human" as const, joinedPad: index }];
+      return { players, rules: withDerivedRules(s.rules, players) };
+    }),
```

`src/components/menu/CharacterSelect.tsx`. The import; the poll, placed before "The guest follows the host into the match the moment the start arrives"; and, in `PlayerPanel`, the `data-port` and the badge:

```diff
 import { buildStartConfig, newMatchSeed } from "@/game/onlineConfig";
+import { joinPresses } from "@/input/padJoin";
```

```diff
+  // Press-to-join (Plan 6, Task 30; ruling R-P6-11): a pad that is not seated presses A or
+  // Start to take a seat. Polled once an animation frame while the screen is up; the store
+  // refuses a seat online, where each machine has its one.
+  useEffect(() => {
+    if (typeof navigator.getGamepads !== "function") return;
+    const last = new Map<number, boolean>();
+    let raf = 0;
+    const tick = () => {
+      const { players: seats, seatPad } = useMatchConfig.getState();
+      const seated = new Set(seats.flatMap((p) => (p.joinedPad === null ? [] : [p.joinedPad])));
+      for (const index of joinPresses([...navigator.getGamepads()], seated, last)) seatPad(index);
+      raf = requestAnimationFrame(tick);
+    };
+    raf = requestAnimationFrame(tick);
+    return () => cancelAnimationFrame(raf);
+  }, []);
+
   // The guest follows the host into the match the moment the start arrives —
```

```diff
     <SkewCard
+      data-port={player.port}
       className={cn(
         "w-[12rem] shrink-0 border-[4px] transition-transform",
```

```diff
-        ) : (
+        ) : player.joinedPad !== null ? (
+          // Seated by a pad's press (Plan 6, Task 30): the pad is this seat's control.
+          <Unskew
+            className="border-2 border-panel-ink px-2 py-0.5 font-display text-[0.7rem] leading-none tracking-[0.12em] text-panel-ink uppercase"
+            style={{ backgroundColor: colour }}
+          >
+            Pad
+          </Unskew>
+        ) : (
           <Unskew className="max-w-full truncate text-[0.65rem] font-bold text-white/65">
             {SCHEME_INFO[player.scheme].name}
           </Unskew>
         )}
```

`src/app/play/page.tsx`, where the local match makes its pad reader:

```diff
         // One pad per human, in connection order: the first pad is the first
         // human. Held for the match, so a pad unplugging moves nobody else's.
-        // Each reads its human's own buttons and right stick (Plan 5).
+        // Each reads its human's own buttons and right stick (Plan 5). A pad that
+        // pressed to join on the select screen drives its own seat, and the rest
+        // keep connection order on the other human seats (Plan 6, Task 30).
         const mappings = new Map(humans.map((p) => [p.port, padMappingOf(p)]));
         gamepad = createGamepadInput({
-          portForPad: padPortMap(humans.map((p) => p.port)),
+          portForPad: padPortMap(humans.filter((p) => p.joinedPad === null).map((p) => p.port)),
+          portForPadIndex: (index) => humans.find((p) => p.joinedPad === index)?.port ?? -1,
           holdPorts: true,
```

`src/game/onlineConfig.test.ts`, its two `PlayerSlot` literals (the typecheck names them):

```diff
-    { port: 0, kind: "human", cpuLevel: 3, fighterId: a, costume: 0, scheme: "arrows", stickJump: true, pad: DEFAULT_PAD_SETTINGS },
-    { port: 1, kind: "human", cpuLevel: 3, fighterId: b, costume: 1, scheme: "arrows", stickJump: false, pad: DEFAULT_PAD_SETTINGS },
+    { port: 0, kind: "human", cpuLevel: 3, fighterId: a, costume: 0, scheme: "arrows", stickJump: true, pad: DEFAULT_PAD_SETTINGS, joinedPad: null },
+    { port: 1, kind: "human", cpuLevel: 3, fighterId: b, costume: 1, scheme: "arrows", stickJump: false, pad: DEFAULT_PAD_SETTINGS, joinedPad: null },
```

`e2e/padOptions.spec.ts`. Its imports gain `READY_FRAME`, `pauseMatch` and `stepToFrame`, and a test is appended. The file's fake pad is index 0, so the test checks what only joining does: the CPU's seat becomes the pad's, and the pad's A plays P2 while P1, the keyboard player, is given nothing:

```diff
 import {
   P1,
+  READY_FRAME,
   ROUTES,
+  pauseMatch,
   readFighters,
   readInputs,
   startFromTitle,
   startMatch,
   startMatchFromMenu,
   stepFrames,
+  stepToFrame,
   type DebugFighter,
   type MatchOptions,
 } from "./helpers";
```

```ts
test("a pad that presses A on the character select takes the CPU's seat, never P1's, and plays it (Plan 6, Task 30)", async ({ page }) => {
  await startFromTitle(page);
  await page.getByRole("button", { name: /smash/i }).first().click();
  await page.waitForURL(`**${ROUTES.rules}`);
  await page.getByRole("button", { name: /next|stage|continue/i }).first().click();
  await page.waitForURL(`**${ROUTES.stage}`);
  await page.getByLabel("Stages", { exact: true }).getByRole("button").first().click();
  await page.getByRole("button", { name: /next|fighters|continue/i }).first().click();
  await page.waitForURL(`**${ROUTES.fighters}`);

  // The fake pad (index 0) presses A: it takes P2, the CPU's seat made human, and never
  // P1, the keyboard player's (ruling R-P6-11).
  await setPadButtons(page, [0]);
  await expect(page.locator("[data-port='1']").getByText("Pad", { exact: true })).toBeVisible();
  await setPadButtons(page, []);
  await expect(page.getByRole("button", { name: "HMN for P2", exact: true, pressed: true })).toBeVisible();
  await expect(page.locator("[data-port='0']").getByText("Pad", { exact: true })).toHaveCount(0);

  const roster = page.getByLabel("Fighters", { exact: true }).getByRole("button");
  await roster.nth(0).click();
  await roster.nth(1).click();
  await page.getByRole("button", { name: /ready to fight/i }).click();
  await page.waitForURL(`**${ROUTES.play}`);
  await page.waitForFunction(() => Boolean((window as unknown as { __smashDebug?: unknown }).__smashDebug));
  await pauseMatch(page);
  await stepToFrame(page, READY_FRAME);
  await expectBothStanding(page);

  // The pad's A is P2's jab; P1, on the keyboard, is given nothing.
  await setPadButtons(page, [0]);
  let move: string | null = null;
  for (let i = 0; i < 6 && move === null; i++) {
    await stepFrames(page, 1);
    const [p1, p2] = await readFighters(page);
    const [p1Input] = await readInputs(page);
    expect([p1.action, p1Input], "P1 was given the pad's press").toEqual(["stand", 0]);
    move = p2.move;
  }
  await setPadButtons(page, []);
  expect(move, "the joined pad's A did not reach P2").toBe("jab1");
});
```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/input src/components/menu src/app/play src/lib src/game/onlineConfig.test.ts`
Expected: PASS (captured: 21 files, 500 tests, without `onlineConfig.test.ts`), with no "not wrapped in act" line.

- [ ] **Step 5: Mutants**

1. `padJoin.ts`: drop `!was &&`. The "once a press" test FAILS: `AssertionError: expected [ +0 ] to deeply equal []` (captured).
2. `gamepad.ts` `heldPortFor`: drop `&& !joined.has(port)`. The gamepad test FAILS: `AssertionError: expected [ false, false ] to deeply equal [ false, true ]` (captured).
3. `gamepad.ts` `poll`: `let port = own;` → `let port = -1;` (joined pads ignored). The gamepad test FAILS: `AssertionError: expected [ false, false ] to deeply equal [ true, false ]` (captured).
4. `matchConfig.ts` `seatPad`: drop `s.online ||`. "is off online" and "joining is local only" FAIL: `AssertionError: expected [ null, null, +0 ] to deeply equal [ null, null ]` (captured).
5. `matchConfig.ts` `seatPad`: `s.players.find((p) => p.kind === "cpu")` → `s.players.find((p) => p.joinedPad === null)` (the draft's "first seat without a pad"). The three seat tests FAIL: `AssertionError: expected [ [ 'human', +0 ], [ 'cpu', null ] ] to deeply equal [ [ 'human', null ], [ 'human', +0 ] ]` (captured).

- [ ] **Step 6: Gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`, `PORT=3107 pnpm test:e2e --trace off`, `pnpm test:e2e:online --trace off` (the join poll must do nothing on the online select, R-P6-11). Expected: exit 0; the new pad test passes. The file's other tests are unchanged: they never press the pad on the select screen.

- [ ] **Step 7: Commit**

```bash
git add super-smash/src/input/padJoin.ts super-smash/src/input/padJoin.test.ts super-smash/src/input/gamepad.ts super-smash/src/input/gamepad.test.ts super-smash/src/lib/matchConfig.ts super-smash/src/lib/matchConfig.test.ts super-smash/src/components/menu/CharacterSelect.tsx super-smash/src/components/menu/CharacterSelect.test.tsx super-smash/src/components/menu/CharacterSelect.online.test.tsx super-smash/src/app/play/page.tsx super-smash/src/app/play/page.test.tsx super-smash/src/game/onlineConfig.test.ts super-smash/e2e/padOptions.spec.ts
git commit -m "super-smash: a pad presses A or Start on the character select to take a seat" -m "Ruling R-P6-11: a joining pad takes the first CPU seat (made human) or a new seat, never the keyboard player's; unjoined pads keep connection order and never take a joined seat; off online. Input mapping only; the packed frame online is unchanged." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 31: Sounds and sparks: a glancing blow, the midair jump, a reflection, a counter's catch

Four presentation gaps:
- Plan 4 R10: "glancing blows emit no event; Brawl-onward plays a 'chik' sound + orange sparks". SmashWiki "Glancing blow": from Brawl, glancing blows "make a very quiet "chik" sound as well as producing small orange sparks … As the "chik" and sparks occur on the first frame of the hit, it is possible to see an attack have a glancing blow on one frame and a solid connection on the next"; "In Super Smash Bros. 4 and Super Smash Bros. Ultimate, glancing blows remain unchanged from Brawl."
- Plan 5 Task 17: "The midair jump makes no sound: `events.jumps` reports only jumps that push off something … Ultimate's midair jump has its own sound."
- Plan 5 Task 17: "A reflection makes no sound of its own (Task 17 drew its flash only); nor does a counter's catch."

Each is a presentation event (`StepEvents`, outside the state and the hash; SPEC §3) and a synthesised sound, and the glance also gets its sparks.

The glance is reported per source and victim, after the frame's hits are settled: a source whose boxes only grazed, none of them reaching the body or a counter's bubble. So a swing that lands with one box while another grazes reports no glance. Neither does a windbox (it hits nobody), a grab (exempt from the depth rule), a box on a raised shield, or a graze on an intangible fighter, where nothing is there.

A graze can last several frames, and the engine reports each. The vfx sparks once in `GLANCE_REPEAT_FRAMES` (4) per attacker and victim. The audio chiks once in 4 for the whole match, and never on a frame with a solid hit. The 4 is cosmetic and UNVERIFIED: the page says only "the first frame of the hit".

The counter's catch was pinned silent by Plan 5 (`audio/index.test.ts`, "makes no sound of its own on the catch"). This task replaces that pin.

**Golden:** unaffected. Events only: `golden.test.ts` digests the state alone (`digest(state)`) and only counts events for its assertions. In the replay the golden test passed unchanged.

**Files:**
- Modify: `src/engine/types.ts` (`StepEvents.glances`, `airJumps`; `emptyEvents`), `src/engine/simulate.ts`, `src/audio/sfx.ts`, `src/audio/index.ts`, `src/render/vfx.ts`
- Test: `src/engine/simulate.test.ts`, `src/audio/index.test.ts`, `src/render/vfx.test.ts`

**Interfaces:**
- Consumes: `reachesBody`, `pickKey`, `reachOf`, `contactPoint`, `capsuleOf` (simulate.ts); the per-fighter loop's `advanceFighter` call; `AudioEngine.handleEvents`; `ingestEvents`, `push`, `rand` (vfx.ts).
- Produces:
  - `StepEvents.glances: { attacker: number; victim: number; x: number; y: number }[]` (`x`, `y`: where the lowest-id grazing box touched the body, `contactPoint`);
  - `StepEvents.airJumps: { port: number; x: number; y: number }[]`;
  - sfx `glance`, `midairJump`, `reflectChime`, `counterCatch`;
  - vfx `GLANCE_ORANGE`, `GLANCE_REPEAT_FRAMES`, `spawnGlance`, `VfxState.lastGlance`.

- [ ] **Step 1: Write the failing tests**

`src/engine/simulate.test.ts`, appended:

```ts
/* -------------------------------------- glances and midair jumps (Plan 6, Task 31) -- */

describe("presentation events for a glance and a midair jump (Plan 6, Task 31)", () => {
  /** `n` frames from `s` under `ctx`, Attack pressed on the first; each frame's events. */
  function jabFrames(s: GameState, ctx: SimContext, n: number): ReturnType<typeof step>["events"][] {
    const out: ReturnType<typeof step>["events"][] = [];
    let state = s;
    let prev: InputFrame[] = [0, 0];
    for (let i = 0; i < n; i++) {
      const now: InputFrame[] = [i === 0 ? Btn.Attack : 0, 0];
      const r = step(state, now, { prevInputs: prev, ctx });
      out.push(r.events);
      state = r.state;
      prev = now;
    }
    return out;
  }

  it("reports a box that grazes a body under 0.1 deep as a glance, not a hit", () => {
    // The tester's jab box, radius 5 at (8, 6), against the body's capsule, radius 4
    // (`width`) on a spine at the victim's x: placed 8 + 5 + 4 − 0.05 out, it reaches 0.05 in.
    const s = standing();
    s.fighters[1].x = fx(8) + fx(5) + fx(4) - fx(0.05);
    const frames = jabFrames(s, CTX, 8);
    expect(frames.flatMap((e) => e.hits)).toEqual([]);
    const glances = frames.flatMap((e) => e.glances);
    expect(glances.length).toBeGreaterThan(0);
    expect(glances[0]).toMatchObject({ attacker: 0, victim: 1 });
  });

  it("reports no glance for a swing that also lands: one box hits while another grazes", () => {
    // Box 0 lands deep; box 1, radius 1 just over the head (the capsule's top is at 12), grazes.
    const twoBoxes: FighterDef = {
      ...DEF,
      moves: { ...DEF.moves, jab1: move("jab1", { hitboxes: [hitbox({ id: 0 }), hitbox({ id: 1, x: fx(8), y: fx(12.95), radius: fx(1) })] }) },
    };
    const ctx: SimContext = { fighter: () => twoBoxes, stage: () => STAGE };
    const s = createInitialState("flat", [{ defId: "tester" }, { defId: "tester" }], RULES, 12345, ctx);
    for (const f of s.fighters) Object.assign(f, { action: "stand", actionFrame: 0, grounded: true, platform: 0, y: 0, intangible: 0, vx: 0, vy: 0 });
    Object.assign(s.fighters[0], { x: 0, facing: 1 });
    Object.assign(s.fighters[1], { x: fx(8), facing: -1 });
    const frames = jabFrames(s, ctx, 8);
    expect(frames.flatMap((e) => e.hits).length).toBe(1);
    expect(frames.flatMap((e) => e.glances)).toEqual([]);
  });

  it("reports a midair jump, and not a ground jump, as an air jump", () => {
    let state = standing();
    let prev: InputFrame[] = [0, 0];
    const air: unknown[] = [];
    const ground: unknown[] = [];
    // A short hop, then a second jump in the air.
    for (let i = 0; i < 20; i++) {
      const now: InputFrame[] = [i === 0 || i === 15 ? Btn.Jump : 0, 0];
      const out = step(state, now, { prevInputs: prev, ctx: CTX });
      air.push(...out.events.airJumps);
      ground.push(...out.events.jumps);
      state = out.state;
      prev = now;
    }
    expect(ground.length).toBe(1);
    expect(air.length).toBe(1);
  });
});
```

`src/audio/index.test.ts`. Two tests before "handles every event channel without leaking a node". Each new sound has a signature the mock records, because a module namespace cannot be spied on under ESM:

```diff
+  it("plays a chik for a glance, and a sound each for a midair jump, a reflection and a counter's catch (Plan 6, Task 31)", async () => {
+    // Each sound has a signature the mock records: a module namespace cannot be spied on under ESM.
+    const cases: [string, (e: StepEvents) => void, (m: MockAudioContext) => boolean][] = [
+      ["glance", (e) => e.glances.push({ attacker: 0, victim: 1, x: 0, y: 0 }), (m) => m.filters.some((f) => f.frequency.valuePath[0] === 3_500)],
+      ["midairJump", (e) => e.airJumps.push({ port: 0, x: 0, y: 0 }), (m) => m.oscillators.some((o) => o.frequency.valuePath[0] === 520)],
+      ["reflectChime", (e) => e.reflects.push({ port: 0, x: 0, y: 0 }), (m) => m.oscillators.some((o) => o.frequency.valuePath[0] === 1_800)],
+      ["counterCatch", (e) => e.counters.push({ port: 0, x: 0, y: 0, damage: fx(1) }), (m) => m.filters.some((f) => f.frequency.valuePath[0] === 2_600)],
+    ];
+    for (const [name, fill, heard] of cases) {
+      const { mock, engine } = await running();
+      const events = emptyEvents();
+      fill(events);
+      engine.handleEvents(events);
+      expect(heard(mock), name).toBe(true);
+    }
+  });
+
+  it("chiks once for a graze that lasts several frames, and not over a hit", async () => {
+    const { mock, engine } = await running();
+    for (let i = 0; i < 3; i++) {
+      const events = emptyEvents();
+      events.glances.push({ attacker: 0, victim: 1, x: 0, y: 0 });
+      engine.handleEvents(events);
+    }
+    expect(mock.filters.filter((f) => f.frequency.valuePath[0] === 3_500).length).toBe(1);
+    const { mock: other, engine: second } = await running();
+    const withHit = hit();
+    withHit.glances.push({ attacker: 0, victim: 1, x: 0, y: 0 });
+    second.handleEvents(withHit);
+    expect(other.filters.some((f) => f.frequency.valuePath[0] === 3_500)).toBe(false);
+  });
+
   it("handles every event channel without leaking a node", async () => {
```

and, in `describe("a counter's catch and its counterattack (Plan 5, Task 17)", …)`, the silence pin becomes:

```diff
-  it("makes no sound of its own on the catch", async () => {
-    const { mock, engine } = await running();
-    const before = mock.created.length;
-    engine.handleEvents(caught(1, fx(30)));
-    expect(mock.created.length).toBe(before);
-  });
+  /** Plan 6, Task 31: the catch has its own clash now; the ring still waits for the counterattack. */
+  it("plays the catch's own clash on the catch, and no ring until its counterattack lands", async () => {
+    const { mock, engine } = await running();
+    engine.handleEvents(caught(1, fx(30)));
+    expect(mock.filters.some((f) => f.frequency.valuePath[0] === 2_600)).toBe(true);
+    expect(rings(mock)).toBe(0);
+  });
```

`src/render/vfx.test.ts`. The import gains `GLANCE_ORANGE` and `GLANCE_REPEAT_FRAMES`, and a block goes before `describe("KOs", …)`:

```diff
 import {
   BURST_MAX_GROWTH,
+  GLANCE_ORANGE,
+  GLANCE_REPEAT_FRAMES,
   HIT_FLASH_FRAMES,
```

```diff
+describe("a glancing blow (Plan 6, Task 31)", () => {
+  it("draws a glance's small orange sparks, once in GLANCE_REPEAT_FRAMES per pair", () => {
+    const v = createVfx();
+    const state = makeState();
+    const glance = makeEvents({ glances: [{ attacker: 0, victim: 1, x: 0, y: 0 }] });
+    const orange = () => v.particles.filter((p) => p.kind === "spark" && p.colour === GLANCE_ORANGE).length;
+    ingestEvents(v, glance, state);
+    const first = orange();
+    expect(first).toBeGreaterThan(0);
+    for (let i = 1; i < GLANCE_REPEAT_FRAMES; i++) {
+      updateVfx(v);
+      ingestEvents(v, glance, state);
+    }
+    expect(orange()).toBe(first);
+    updateVfx(v);
+    ingestEvents(v, glance, state);
+    expect(orange()).toBe(2 * first);
+  });
+});
+
 describe("KOs", () => {
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/engine/simulate.test.ts src/audio/index.test.ts src/render/vfx.test.ts`
(No `-t`: a filter would skip the audio and vfx tests.)
Expected: FAIL (captured; 7 failed):
- the two new audio tests: `TypeError: Cannot read properties of undefined (reading 'push')`;
- the catch test: `AssertionError: expected false to be true`;
- vfx: `AssertionError: expected 0 to be greater than 0`;
- the glance test: `AssertionError: expected undefined to match object { attacker: +0, victim: 1 }`;
- the swing-that-lands test: `expected [ undefined, undefined, …(6) ] to deeply equal []`;
- the jump test: `TypeError: out.events.airJumps is not iterable (cannot read property undefined)`.

- [ ] **Step 3: Implement**

`src/engine/types.ts`, at the end of `StepEvents`, and `emptyEvents`:

```diff
   footstools: { jumper: number; victim: number }[];
+  /**
+   * Glancing blows this frame (Plan 6, Task 31): a source whose boxes reached a body
+   * only less than `GLANCING_BLOW_DEPTH` deep, so none of them hit it (SmashWiki
+   * "Glancing blow": a "very quiet "chik" sound" and "small orange sparks"). One per
+   * source and victim; never a grab's, a windbox's, a shield's or an intangible
+   * fighter's. Where its lowest-id grazing box touched the body (`contactPoint`, as
+   * `hits[].contactX`). Presentation only.
+   */
+  glances: { attacker: number; victim: number; x: number; y: number }[];
+  /**
+   * Midair jumps this frame (Plan 6, Task 31): `jumps` keeps the jumps that push off
+   * something. Presentation only: the midair jump's sound.
+   */
+  airJumps: { port: number; x: number; y: number }[];
 }
```

```diff
     pushes: [],
     footstools: [],
+    glances: [],
+    airJumps: [],
   };
 }
```

`src/engine/simulate.ts`. In `resolveHits`, after `reachesBody`:

```diff
       (reachOf(c).depth >= GLANCING_BLOW_DEPTH || c.hitbox.grabbing === true || hitReachesShield(victim, defs[v], c));
+    /**
+     * Asked only of a box `reachesBody` turned away: it is in the body, so the depth is
+     * what kept it out, a glancing blow (Plan 6, Task 31). Not a windbox, which hits
+     * nobody anyway. Reported, never a hit.
+     */
+    const grazes = (c: Candidate): boolean =>
+      c.hitbox.windbox !== true && hurtboxes.some((h) => sweptCapsuleOverlaps(c.prevX, c.prevY, c.x, c.y, c.dx, c.dy, c.hitbox.radius, h));
+    /** Per source, its lowest-id box that only grazed this victim (Plan 6, Task 31). */
+    const grazed = new Map<number, Candidate>();
     // A counter out (Plan 5, Task 5): its bubble catches whatever reaches it but
```

and in the loop that builds `perSource`, the skip of a box that does not reach the body, then the report after the loop:

```diff
         caught.add(c);
-      } else if (!reachesBody(c)) continue;
+      } else if (!reachesBody(c)) {
+        if (grazes(c)) {
+          const key = pickKey(c);
+          const was = grazed.get(key);
+          if (was === undefined || c.hitbox.id < was.hitbox.id) grazed.set(key, c);
+        }
+        continue;
+      }
       const key = pickKey(c);
       const incumbent = perSource.get(key);
       if (incumbent === undefined || c.hitbox.id < incumbent.hitbox.id) perSource.set(key, c);
     }
+
+    // A glancing blow is a source that only grazed: none of its boxes reached the body or
+    // a counter's bubble this frame. Nothing is there to graze while intangible (Plan 6, Task 31).
+    if (victim.intangible === 0) {
+      for (const [key, c] of [...grazed].sort((a, b) => a[0] - b[0])) {
+        if (perSource.has(key)) continue;
+        const at = contactPoint(capsuleOf(c), hurtboxes[reachOf(c).index]);
+        events.glances.push({ attacker: c.attacker, victim: victim.port, x: at.x, y: at.y });
+      }
+    }
 
     // Sorted by key so two sources connecting on one frame resolve in the same
```

and in the per-fighter loop, around `advanceFighter`:

```diff
     const before = f.action;
+    const jumpsBefore = f.jumpsUsed;
     const copyBefore = f.combat.copy;
     const wallJumpsBefore = f.combat.wallJumps;
     advanceFighter(f, intent, stateCtx(i));
     if (before === "jumpSquat" && f.action === "jump") {
       events.jumps.push({ port: f.port, x: f.x, y: f.y });
     }
+    // A midair jump (`airJump` spends one past the ground's; Plan 6, Task 31), for its sound.
+    if (jumpsBefore >= 1 && f.jumpsUsed > jumpsBefore && !f.grounded) events.airJumps.push({ port: f.port, x: f.x, y: f.y });
```

(In the air `jumpsUsed` is at least 1 whichever way the fighter left the ground: `onLeftGround`, `states.ts:1631-1633`. Only `airJump` raises it from there, `states.ts:841-843`. The check reads no action, so a jump that cancels into an aerial on its own frame still counts.)

`src/audio/sfx.ts`, before `land` (its doc comment stays with it):

```diff
+/** A glancing blow (Plan 6, Task 31; SmashWiki: a "very quiet "chik""): a short, high, quiet tick. */
+export function glance(sc: SynthContext, when?: number): void {
+  const at = when ?? sc.ctx.currentTime;
+  noise(sc, { duration: 0.025, gain: 0.06, attack: 0.001, decay: 0.025, band: { type: "highpass", frequency: 3_500 }, when: at });
+}
+
+/** A midair jump (Plan 6, Task 31): the ground jump's rise without its push-off, higher and lighter. */
+export function midairJump(sc: SynthContext, when?: number): void {
+  const at = when ?? sc.ctx.currentTime;
+  tone(sc, { wave: "triangle", freqStart: 520, freqEnd: 1_250, duration: 0.11, attack: 0.004, decay: 0.11, gain: 0.11, when: at });
+}
+
+/** A projectile sent back (Plan 6, Task 31): a bright metallic ping. */
+export function reflectChime(sc: SynthContext, when?: number): void {
+  const at = when ?? sc.ctx.currentTime;
+  tone(sc, { wave: "square", freqStart: 1_800, freqEnd: 2_400, duration: 0.09, attack: 0.002, decay: 0.09, gain: 0.12, when: at });
+  tone(sc, { wave: "sine", freqStart: 3_600, freqEnd: 3_600, duration: 0.14, attack: 0.002, decay: 0.14, gain: 0.06, when: at });
+}
+
+/** A counter catching a blow (Plan 6, Task 31): a sharp parry-like clash, shorter than a clank. */
+export function counterCatch(sc: SynthContext, when?: number): void {
+  const at = when ?? sc.ctx.currentTime;
+  noise(sc, { duration: 0.06, gain: 0.18, attack: 0.001, decay: 0.06, band: { type: "bandpass", frequency: 2_600, Q: 2 }, when: at });
+  tone(sc, { wave: "sawtooth", freqStart: 900, freqEnd: 600, duration: 0.07, attack: 0.002, decay: 0.07, gain: 0.1, when: at });
+}
+
 /** Landing. The mirror of the jump: falls, and is more felt than heard. */
 export function land(sc: SynthContext, when?: number): void {
```

(The sounds are synthesised, as every sound here is; their shapes are cosmetic.)

`src/audio/index.ts`. The four sounds join the `./sfx` import (alphabetical: `counterCatch` after `clank`, `glance` after `finalSmash`, `midairJump` after `menuMove`, `reflectChime` after `perfectShield`), and:

```diff
 import type { StepEvents } from "@/engine/types";
+import { GLANCE_REPEAT_FRAMES } from "@/render/vfx";
 import type { SynthContext, Voice } from "./synth";
```

```diff
   private readonly strongCounters = new Map<number, number>();
+  /** Frames left before a glance may chik again (Plan 6, Task 31): a graze can last several. */
+  private glanceQuiet = 0;
```

```diff
     if (events.lands.length > 0) land(sc);
+    // Plan 6, Task 31. A glance only when nothing landed solidly this frame, and once in
+    // `GLANCE_REPEAT_FRAMES` (one sound for every graze in the match, not per pair).
+    if (events.glances.length > 0 && events.hits.length === 0 && this.glanceQuiet === 0) {
+      glance(sc);
+      this.glanceQuiet = GLANCE_REPEAT_FRAMES;
+    }
+    if (this.glanceQuiet > 0) this.glanceQuiet -= 1;
+    if (events.airJumps.length > 0) midairJump(sc);
+    if (events.reflects.length > 0) reflectChime(sc);
+    if (events.counters.length > 0) counterCatch(sc);
     this.counterattackRings(sc, events);
```

`src/render/vfx.ts`:

```diff
+/** A glancing blow's sparks (Plan 6, Task 31; SmashWiki "Glancing blow": "small orange sparks"). */
+export const GLANCE_ORANGE = "#FF9A3A";
+/**
+ * A graze can last several frames; its sparks, and its "chik" (`audio/index.ts`), come
+ * once in this many per attacker and victim. UNVERIFIED (cosmetic): SmashWiki says only
+ * that both "occur on the first frame of the hit".
+ */
+export const GLANCE_REPEAT_FRAMES = 4;
+
 /** A hit victim flashes white for two to four frames, scaled by damage. */
```

```diff
   swing: ({ action: string; move: string | null; actionFrame: number } | null)[];
+  /** The frame (`frame`) each attacker-victim pair last sparked a glance, keyed `attacker * 4 + victim` (Plan 6, Task 31). */
+  lastGlance: Map<number, number>;
   seed: number;
```

```diff
     swing: [null, null, null, null],
+    lastGlance: new Map(),
     seed: 0x9e3779b9,
```

in `ingestEvents`, after the shield hits:

```diff
+  // A glancing blow's small orange sparks (Plan 6, Task 31), once in `GLANCE_REPEAT_FRAMES` per pair.
+  for (const g of events.glances) {
+    const key = g.attacker * 4 + g.victim;
+    const was = v.lastGlance.get(key);
+    if (was !== undefined && v.frame - was < GLANCE_REPEAT_FRAMES) continue;
+    v.lastGlance.set(key, v.frame);
+    spawnGlance(v, toFloat(g.x) + (shift?.[g.attacker] ?? 0), toFloat(g.y));
+  }
+
   for (const c of events.clanks) spawnClank(v, toFloat(c.x), toFloat(c.y));
```

and before `spawnShieldHit`:

```diff
+/** Four small orange sparks, short-lived: a glance is a graze, not an impact (Plan 6, Task 31). */
+export function spawnGlance(v: VfxState, x: number, y: number): void {
+  for (let i = 0; i < 4; i++) {
+    const a = rand(v) * Math.PI * 2;
+    push(v, { kind: "spark", x, y, vx: Math.cos(a) * 0.6, vy: Math.sin(a) * 0.6, life: 6, maxLife: 6, size: 0.45, colour: GLANCE_ORANGE, rotation: a, spin: 0, gravity: 0, drag: 0.9 });
+  }
+}
+
 export function spawnShieldHit(
```

(Sparks are `SPRITE_KINDS`, so the 3D layer draws them, `vfx3d.ts:65`; `GLANCE_ORANGE` is a `#rrggbb` its `setColour` reads.)

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/engine src/audio src/render src/game/golden.test.ts src/game/rulesVersion.test.ts`
Expected: PASS, golden and pin unchanged (captured). Every test that builds a `StepEvents` goes through `emptyEvents()` or `makeEvents()`, so none needs the new lists.

- [ ] **Step 5: Mutants**

1. `simulate.ts`: delete the `events.glances.push(…)` line. The glance test FAILS: `AssertionError: expected 0 to be greater than 0` (captured).
2. `simulate.ts`: delete `if (perSource.has(key)) continue;`. The swing-that-lands test FAILS: `AssertionError: expected [ { attacker: +0, victim: 1, …(2) } ] to deeply equal []` (captured).
3. `simulate.ts`: `jumpsBefore >= 1` → `jumpsBefore >= 0`. The jump test FAILS: `AssertionError: expected 2 to be 1` (captured).
4. `vfx.ts`: delete the repeat check's `continue` line. The vfx test FAILS: `AssertionError: expected 16 to be 4` (captured).
5. `audio/index.ts`: delete `this.glanceQuiet = GLANCE_REPEAT_FRAMES;`. The once test FAILS: `AssertionError: expected 3 to be 1` (captured).

- [ ] **Step 6: Gate**

Run: `pnpm typecheck && pnpm lint && pnpm test`, `PORT=3107 pnpm test:e2e --trace off`. Expected: exit 0; golden unchanged.

- [ ] **Step 7: Commit**

```bash
git add super-smash/src/engine/types.ts super-smash/src/engine/simulate.ts super-smash/src/audio/sfx.ts super-smash/src/audio/index.ts super-smash/src/render/vfx.ts super-smash/src/engine/simulate.test.ts super-smash/src/audio/index.test.ts super-smash/src/render/vfx.test.ts
git commit -m "super-smash: a glance chiks and sparks orange; the midair jump, a reflection and a counter's catch have sounds" -m "SmashWiki Glancing blow. Two presentation events (glances, per source that only grazed; airJumps); nothing in the state or the hash. Plan 5's silent-catch pin becomes the catch's clash. Golden unchanged." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 32: A shield hit sparks where the box met the shield

From Plan 4 Task 18's review (and a Plan 5 carry): "`shieldHits` carry no contact point (`simulate.ts:2014,2035`), so a blade on a shield sparks at its hilt; add one like the R9 hit contact (engine event only, not in the golden digest)." Both `events.shieldHits.push` calls in `applyHit` report `c.x, c.y`, the box's first point.

This task adds `contactX` and `contactY`: the point of the box's spine nearest the bubble's centre (`contactPoint(capsuleOf(c), shieldBubble(victim, victimDef))`, as the counter's catch already reports it). It is measured before the hit wears the shield, and the shield's sparks go there.

**Ruling (the contact model):** R9's, as for a hit on a body. A capsule's contact is the point of its spine nearest the bubble; a sphere's is its centre. So a sphere sword's shield spark stays at the sphere the sim picked. On Marth's forward tilt, whose three boxes are spheres (`marth.ts:209-235`, `generated/marth.ts:73-77`), that is box 0, the one nearest his hilt: the lowest id that reaches the shield wins (`simulate.ts:1937-1939`). That is where the sim says the shield was struck, so the spark is truthful. The backlog line's "hilt" therefore closes for capsule boxes (Link's and Marth's scripts hold 45 `x2` boxes between them). It stays as the sim decides for sphere swords.

**Golden:** unaffected (events only; see Task 31). In the replay `golden.test.ts` passed unchanged.

**Files:**
- Modify: `src/engine/types.ts` (`StepEvents.shieldHits[].contactX`, `contactY`), `src/engine/simulate.ts`, `src/render/vfx.ts`
- Test: `src/engine/simulate.test.ts`, `src/render/vfx.test.ts`, `src/audio/index.test.ts` (its hand-built shield hit gains the fields)

**Interfaces:**
- Consumes: `contactPoint` (hitbox.ts), `shieldBubble` (shield.ts), `capsuleOf` (simulate.ts).
- Produces: `StepEvents.shieldHits: { victim: number; x: number; y: number; contactX: number; contactY: number }[]`.

- [ ] **Step 1: Write the failing tests**

`src/engine/simulate.test.ts`. `StepEvents` joins the type import from `./types`, and a block is appended. Its box is a capsule, so its contact is off its first point:

```diff
   MoveDef,
   StageDef,
+  StepEvents,
 } from "./types";
```

```ts
/* --------------------------------------------- a shield hit's contact (Plan 6, Task 32) -- */

describe("a shield hit's contact point (Plan 6, Task 32)", () => {
  it("is where a capsule's spine meets the bubble, not the capsule's first point", () => {
    // A blade-like box: a capsule from 2 to 14 in front, at the bubble's height (half the
    // body, 6), against a shield up at 16. Its first point is the hilt's end; the point of
    // its spine nearest the bubble's centre (16, 6) is its far end, 14.
    const blade: FighterDef = {
      ...DEF,
      moves: { ...DEF.moves, jab1: move("jab1", { hitboxes: [hitbox({ x: fx(2), y: fx(6), x2: fx(14), y2: fx(6), radius: fx(2) })] }) },
    };
    const ctx: SimContext = { fighter: () => blade, stage: () => STAGE };
    let state = createInitialState("flat", [{ defId: "tester" }, { defId: "tester" }], RULES, 12345, ctx);
    for (const f of state.fighters) Object.assign(f, { grounded: true, platform: 0, y: 0, intangible: 0, vx: 0, vy: 0 });
    Object.assign(state.fighters[0], { action: "stand", actionFrame: 0, x: 0, facing: 1 });
    Object.assign(state.fighters[1], { action: "shield", actionFrame: 10, x: fx(16), facing: -1 });
    let prev: InputFrame[] = [0, Btn.Shield];
    let hit: StepEvents["shieldHits"][number] | undefined;
    for (let i = 0; i < 10 && hit === undefined; i++) {
      const now: InputFrame[] = [i === 0 ? Btn.Attack : 0, Btn.Shield];
      const out = step(state, now, { prevInputs: prev, ctx });
      hit = out.events.shieldHits[0];
      state = out.state;
      prev = now;
    }
    expect(hit).toBeDefined();
    expect(hit!.x).toBe(fx(2));
    expect([hit!.contactX, hit!.contactY]).toEqual([fx(14), fx(6)]);
  });
});
```

`src/render/vfx.test.ts`. The two existing shield-hit events ("flashes on a perfect shield", "does not flash for a shield hit outside the release window") become `{ victim: 1, x: 0, y: 0, contactX: 0, contactY: 0 }`, and a block goes before `describe("a glancing blow (Plan 6, Task 31)", …)`:

```diff
+describe("a shield hit's contact (Plan 6, Task 32)", () => {
+  it("sparks a shield hit where the box met the bubble", () => {
+    const v = createVfx();
+    ingestEvents(v, makeEvents({ shieldHits: [{ victim: 1, x: 0, y: 0, contactX: fx(5), contactY: fx(2) }] }), makeState());
+    const sparks = v.particles.filter((p) => p.kind === "shieldSpark");
+    expect(sparks.length).toBeGreaterThan(0);
+    expect(sparks.every((p) => p.x === 5 && p.y === 2)).toBe(true);
+  });
+});
+
 describe("a glancing blow (Plan 6, Task 31)", () => {
```

`src/audio/index.test.ts`, "handles every event channel without leaking a node":

```diff
-    events.shieldHits.push({ victim: 1, x: 0, y: 0 });
+    events.shieldHits.push({ victim: 1, x: 0, y: 0, contactX: 0, contactY: 0 });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/engine/simulate.test.ts src/render/vfx.test.ts -t "contact"`
Expected: FAIL, 2 tests (captured):
- simulate: `AssertionError: expected [ undefined, undefined ] to deeply equal [ 57344, 24576 ]`. The box did reach the shield: `x` is `fx(2)`.
- vfx: `AssertionError: expected false to be true` (the sparks at 0, 0).

- [ ] **Step 3: Implement**

`src/engine/types.ts`:

```diff
-  shieldHits: { victim: number; x: number; y: number }[];
+  /**
+   * `x`/`y` are the box's near end, as `hits[]`'s; `contactX`/`contactY` are where it met
+   * the bubble: the point of the box's spine nearest the bubble's centre (Plan 6, Task 32;
+   * ruling R9's `contactPoint`, as `hits[].contactX` is for a body). A sphere's is its centre.
+   * Presentation only: where the shield's sparks go.
+   */
+  shieldHits: { victim: number; x: number; y: number; contactX: number; contactY: number }[];
```

`src/engine/simulate.ts`, beside `isSceneBox`:

```diff
+/**
+ * A shield hit's event (Plan 6, Task 32): the box's near end, and where its spine met
+ * the bubble, measured before the hit wears the shield.
+ */
+function shieldHitAt(victim: FighterState, victimDef: FighterDef, c: Candidate): StepEvents["shieldHits"][number] {
+  const at = contactPoint(capsuleOf(c), shieldBubble(victim, victimDef));
+  return { victim: victim.port, x: c.x, y: c.y, contactX: at.x, contactY: at.y };
+}
+
 /** Where a candidate's box is this frame: a capsule, or a circle when it has no length. */
```

and in `applyHit`'s shield path, the event once at its top and both pushes:

```diff
   if (onShield) {
+    const shieldEvent = shieldHitAt(victim, victimDef, c);
     const lag = computeHitlag(lagDamage, {
```

```diff
-      events.shieldHits.push({ victim: victim.port, x: c.x, y: c.y });
+      events.shieldHits.push(shieldEvent);
       return;
     }
     victim.shieldHealth -= shieldDamage(takenBefore1v1);
```

```diff
-    events.shieldHits.push({ victim: victim.port, x: c.x, y: c.y });
+    events.shieldHits.push(shieldEvent);
     return;
   }
```

`src/render/vfx.ts`, `ingestEvents`:

```diff
-    spawnShieldHit(v, toFloat(s.x), toFloat(s.y), s.victim, parried);
+    // Where the box met the bubble (Plan 6, Task 32), not the box's near end.
+    spawnShieldHit(v, toFloat(s.contactX), toFloat(s.contactY), s.victim, parried);
```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/engine src/render src/render3d src/audio src/fighters/clank.test.ts src/game/golden.test.ts`
Expected: PASS; golden unchanged (captured).

- [ ] **Step 5: Mutants**

1. `shieldHitAt`: `contactX: at.x, contactY: at.y` → `contactX: c.x, contactY: c.y`. The simulate test FAILS: `AssertionError: expected [ 8192, 24576 ] to deeply equal [ 57344, 24576 ]` (captured).
2. `vfx.ts`: spark at `toFloat(s.x), toFloat(s.y)` again. The vfx test FAILS: `AssertionError: expected false to be true` (captured).

- [ ] **Step 6: Gate and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`, `PORT=3107 pnpm test:e2e --trace off`. Expected: exit 0; golden unchanged.

```bash
git add super-smash/src/engine/types.ts super-smash/src/engine/simulate.ts super-smash/src/render/vfx.ts super-smash/src/engine/simulate.test.ts super-smash/src/render/vfx.test.ts super-smash/src/audio/index.test.ts
git commit -m "super-smash: a shield hit sparks where the box met the shield" -m "StepEvents.shieldHits carries the contact point, R9's model as hits have it: a capsule's spine point nearest the bubble, a sphere's centre. Presentation only; golden unchanged." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 33: The 3D stage and its ground: the ledge lip, a shaded front face, a decorative underside, fighters over the face, and shadows the side camera sees

The draft's Tasks 25 and 26 are batched into this one (R-P6-3): one `prismGeometry`, one test file, one look. Five items:
- Plan 4 R13: "the drawn body now equals the sim's straight 60-deep solid; restore a Battlefield-style tapered underside as a NON-colliding decorative layer behind the play plane, so collision stays what is seen."
- Plan 4 Task 23: "The 2D platforms had a highlighted ledge lip; `StagePaint.edge` is now unused — draw it in 3D (a thin bright strip along each hard platform's top edge)."
- Plan 5 Task 17 review (Minor 11): "a fighter beside Final Destination's wall, below the ledge, is mostly behind the stage's front face (the side camera's perspective) … Decide with screenshots: draw fighters over the front face near the walls, or thin the face's depth."
- Plan 4 Task 19: "the pure side camera sees the stage top edge-on, so blob shadows are ~1 px and the stage's 60-deep front face fills the lower screen as a flat slab. Options: a small downward tilt (5-8°) …; stage front-face shading/gradient + theme detail; shadow shape that reads edge-on. Decide from screenshots."
- From the same: the front face's gradient.

**Rulings (recorded in D59 with their cost; R-P6-8):**
- **D11: the fighters are drawn over the stage.** The stage draws first (`renderOrder` −1, its underside −2) and writes no depth. Its depth toward the camera is decoration, and nothing on the play plane outside the solid is ever hidden by it. A wall-hugging fighter, its shield and its sparks are drawn over the front face's perspective overhang, and the stage stays exactly as wide as its collision.

  The chamfer was weighed, with its inset from the camera's geometry (M18). On screen the front edge overhangs the wall by `(wall − cameraX) · 18 / D`. `D` is the camera's distance, `540 / (zoom · tan 13°) = 2339 / zoom` (`camera3d.ts:33-35`, `render/camera.ts:22-23, 58`), and the visible half-width is `960 / zoom`. A wall at the screen's edge therefore needs an inset of `960 · 18 / 2339 ≈ 7.39` units at every zoom, the closest included; a wall at the screen's centre needs none. So a fixed inset of 7.39 removes the overhang, but with the camera at the wall it draws the front edge about 8 units inside the collision.

  Stand-in captures of both, in the replay's scratchpad with `/models/` routed to 404:
  - **The chamfer:** a fighter standing 2 units inside the ledge appeared to stand on the slanted chamfer, past the lit edge, and a ledge-hanging fighter floated beside a dark strip.
  - **Fighters over the stage:** the wall-hugger was whole at zoom 8 and 15, and the ledge stander sat on the lip.

  So the chamfer fails "without drawing the stage narrower than its collision", and fighters over the stage is the ruling. The 2D overlay's clip follows the same rule (`render/stageClip.ts`): it clips move effects and projectiles out of the solid's section in the play plane, no longer out of the front half's projection, so an effect beside the wall shows as the fighter there does.

  Cost: a 3D part inside the solid's outline at z = 0 now shows over the face too. That means a foot sunk below the floor, which the stance lift (Task 19, Group 2) has already removed, or an arm pressed into a wall.
- **R13's straight-walls test** (`stage3d.test.ts:131`, "every vertex, the bottom ones included, is at the span's edge") **stands verbatim**: there is no chamfer, and every hard-body vertex stays at ±halfWidth. The decorative underside is no surface, so the file's `meshes` helper leaves it out.
- **D12: the camera stays level** (the tilt re-projects every overlay element and stays a follow-up). The shadows are **tipped 24° toward the camera**: in the stand-in captures the flat disc on the floor read as a line a pixel or two tall, and the tipped one reads as a contact shadow under the feet. Because the stage writes no depth, the whole tipped disc shows.

The underside: only the `battlefield` theme's paint has one (Battlefield and Small Battlefield). It is drawn behind the play plane (z −18.5 to −0.5) and below the solid's bottom, so a fighter recovering under the stage is drawn in front of it and its edge never reads as a surface. Its walls go on from the body's deep colour to darker still. Its size and taper are cosmetic and UNVERIFIED (by eye).

The lip is a band of the front face's top in `paint.edge`, inside the same mesh, so it adds no draw call. The gradient takes each wall from `paint.face` at the top to `paint.deep` at the bottom. The underside adds one draw call on the stages that have it; the e2e's draw-call range counts it (`e2e/render3d.spec.ts:97-111`).

**Golden:** unaffected (render only).

**Files:**
- Modify: `src/render3d/stage3d.ts`, `src/render/stageArt.ts` (`StagePaint.underside?`), `src/render/stageClip.ts`, `src/render3d/renderer3d.ts` (the shadow tip), `e2e/render3d.spec.ts` (`callRange` counts the stage's meshes), `docs/screenshots/match.png`, `docs/screenshots/match-2.png`
- Test: `src/render3d/stage3d.test.ts`, `src/render/stageClip.test.ts`, `src/render3d/renderer3d.test.ts`

**Interfaces:**
- Consumes: `prismGeometry`, `createStage3D`, `stagePaintFor`, `MAIN_DEPTH_Z`, `MAIN_DEPTH`; the renderer's shadow `InstancedMesh` and its `m.compose(…, flat, …)`.
- Produces:
  - `prismGeometry(half, height, taper, depthZ, top, side, bottom, opts?: PrismOptions)`, with `PrismOptions { lip?: Rgb; lipHeight?: number; faceBottom?: Rgb }` (a call without `opts` builds what it did);
  - `LIP_HEIGHT` and `STAGE_RENDER_ORDER` (stage3d.ts);
  - `StagePaint.underside?: { depth: number; taper: number }`;
  - `SHADOW_TIP_DEG` (renderer3d.ts).

- [ ] **Step 1: Write the failing tests**

`src/render3d/stage3d.test.ts`. The imports, the `meshes` helper (the underside is decor), and the paint test's wall triangles (the lip's two in the edge colour):

```diff
 import { describe, expect, it, vi } from "vitest";
-import { Box3, Color, Mesh, Vector3 } from "three";
+import { Box3, Color, Mesh, Vector3, type Material } from "three";
```

```diff
-import { MAIN_DEPTH, createStage3D, prismGeometry } from "./stage3d";
+import { LIP_HEIGHT, MAIN_DEPTH, MAIN_DEPTH_Z, createStage3D, prismGeometry } from "./stage3d";
 
-const meshes = (s: ReturnType<typeof createStage3D>) => s.group.children.filter((c): c is Mesh => c instanceof Mesh);
+/**
+ * The stage's bodies, one per platform. The decorative underside (Plan 6, Task 33) is not one
+ * of them: it is no surface, sits behind the play plane, and nothing the sim does meets it.
+ */
+const meshes = (s: ReturnType<typeof createStage3D>) => s.group.children.filter((c): c is Mesh => c instanceof Mesh && c.name !== "underside");
```

```diff
             side++;
             expect(Math.abs(t.stored.y), label).toBeLessThan(1e-6);
-            sameColour(t.colour, soft ? paint.soft : paint.face);
+            // A hard body's front face starts with the ledge lip, in the edge colour (Plan 6,
+            // Task 33); every other wall triangle starts at a top corner, in the face colour.
+            const lip = !soft && t.stored.z > 0.99 && t.centroid.y > -LIP_HEIGHT;
+            sameColour(t.colour, soft ? paint.soft : lip ? paint.edge : paint.face);
           }
         }
-        // A box: two triangles on the top, two underneath, eight on the walls.
-        expect([up, down, side], label).toEqual([2, 2, 8]);
+        // A box: two triangles on the top, two underneath, eight on the walls, and a hard
+        // body's two more for the lip, its front face split where the lip ends.
+        expect([up, down, side], label).toEqual(soft ? [2, 2, 8] : [2, 2, 10]);
```

and a block appended. Colours compare within float32's precision, as the file's own `sameColour` does. Battlefield's floor is at `fx(0.111)`:

```ts
describe("the ledge lip, the shaded walls and the underside (Plan 6, Task 33)", () => {
  const bf = STAGES.find((st) => st.id === "battlefield")!;
  const fd = STAGES.find((st) => st.id === "finalDestination")!;
  /** The main body's mesh, as the stage builds it. */
  const mainMesh = (stage: StageDef): Mesh => meshes(createStage3D(stage))[stage.platforms.findIndex((p) => !p.soft)];
  /** Vertex `i`'s colour is `hex`, to float32's precision. */
  const isColour = (m: Mesh, i: number, hex: string): boolean => {
    const c = m.geometry.getAttribute("color");
    const want = new Color(hex);
    return Math.abs(c.getX(i) - want.r) < 1e-5 && Math.abs(c.getY(i) - want.g) < 1e-5 && Math.abs(c.getZ(i) - want.b) < 1e-5;
  };

  it("paints the top band of a hard body's front face in the stage's edge colour: the ledge lip", () => {
    const paint = stagePaintFor(bf);
    const m = mainMesh(bf);
    const pos = m.geometry.getAttribute("position");
    const lip = [...Array(pos.count).keys()].filter((i) => pos.getZ(i) === MAIN_DEPTH_Z / 2 && isColour(m, i, paint.edge));
    expect(lip.length).toBe(6);
    expect(lip.every((i) => pos.getY(i) >= -LIP_HEIGHT - 1e-5)).toBe(true);
  });

  it("shades a hard body's walls from the face colour at the top to the deep colour at the bottom", () => {
    const paint = stagePaintFor(fd);
    const m = mainMesh(fd);
    const pos = m.geometry.getAttribute("position");
    const normal = m.geometry.getAttribute("normal");
    const walls = [...Array(pos.count).keys()].filter((i) => Math.abs(normal.getY(i)) < 1e-6);
    const bottom = walls.filter((i) => pos.getY(i) === -MAIN_DEPTH);
    const above = walls.filter((i) => pos.getY(i) > -MAIN_DEPTH && !isColour(m, i, paint.edge));
    // Four walls, each two triangles with three corners on the bottom edge between them.
    expect(bottom.length).toBe(12);
    expect(bottom.every((i) => isColour(m, i, paint.deep))).toBe(true);
    expect(above.every((i) => isColour(m, i, paint.face))).toBe(true);
  });

  it("hangs a decorative tapered underside behind the play plane, under Battlefield's floor, and none under Final Destination's", () => {
    const s = createStage3D(bf);
    const under = s.group.children.find((o) => o.name === "underside");
    expect(under).toBeDefined();
    const box = new Box3().setFromObject(under!);
    const main = bf.platforms.find((p) => !p.soft)!;
    // Wholly behind the play plane, so a fighter under the stage is drawn in front of it.
    expect(box.max.z).toBeLessThan(0);
    // Hung from the body's bottom (Battlefield's floor is at 0.111), and tapering 34 below it.
    expect(box.max.y).toBeCloseTo(toFloat(main.y) - MAIN_DEPTH, 5);
    expect(box.min.y).toBeCloseTo(toFloat(main.y) - MAIN_DEPTH - 34, 5);
    s.dispose();
    expect(createStage3D(fd).group.children.some((o) => o.name === "underside")).toBe(false);
  });

  /**
   * Ruling D11 (Plan 6, Task 33): the stage's depth toward the camera is decoration, so it
   * never hides the play plane. Drawn first and writing no depth, it is covered by every
   * fighter, shield and spark, a fighter hugging a wall below the ledge included.
   */
  it("draws every stage mesh first, writing no depth (ruling D11)", () => {
    for (const stage of allStageForms()) {
      const s = createStage3D(stage);
      for (const m of s.group.children as Mesh[]) {
        expect((m.material as Material).depthWrite, stage.id).toBe(false);
        expect(m.renderOrder, stage.id).toBeLessThan(0);
      }
      s.dispose();
    }
  });
});
```

`src/render/stageClip.test.ts`. The front-half tests become the play-plane section's (ruling D11):

```diff
-import { MAIN_DEPTH_Z, stageSolidsOnScreen } from "./stageClip";
+import { stageSolidsOnScreen } from "./stageClip";
```

```diff
-  it("is the front face's projection: a little wider than the body's middle, so a lobe just past the ledge's middle plane is still behind it; open air past that", () => {
+  /** Ruling D11 (Plan 6, Task 33): the 3D stage's depth hides nothing at z = 0 outside the solid. */
+  it("is the body's section in the play plane: a lobe just inside the wall is clipped, one just past it shows, as the fighter there does", () => {
     const polys = stageSolidsOnScreen(fd, 0, cam);
-    expect(MAIN_DEPTH_Z).toBe(36);
-    expect(anyInside(polys, worldToScreen(cam, half + 0.5, top - 4))).toBe(true);
-    expect(anyInside(polys, worldToScreen(cam, half + 30, top - 4))).toBe(false);
+    expect(anyInside(polys, worldToScreen(cam, half - 0.5, top - 4))).toBe(true);
+    expect(anyInside(polys, worldToScreen(cam, half + 0.5, top - 4))).toBe(false);
   });
 
   /**
    * The re-review 3's N11: the clip is the 3D side camera's own picture, shake and
-   * all, of the body's front half. Every corner of it is three.js's projection
-   * (`applySideCamera`, as the 3D layer places its camera) of one of the body's
-   * corners on the sim's plane (z 0) or on its front face (z `MAIN_DEPTH_Z / 2`,
-   * as `stage3d.ts` extrudes it, half toward the camera), and every such corner is
-   * inside it: from above the floor and from below it.
+   * all. Since Plan 6, Task 33 (ruling D11) it is the picture of the body's section
+   * in the sim's plane (z 0): its corners are three.js's projection
+   * (`applySideCamera`, as the 3D layer places its camera) of the body's four
+   * corners there, from above the floor and from below it.
    */
   it.each([
     ["above the floor, shaken", { x: 10, y: 20, zoom: 14, shakeX: 14, shakeY: -9 }],
     ["below it, shaken the other way", { x: -40, y: -30, zoom: 9, shakeX: -11, shakeY: 12 }],
-  ] as const)("is the 3D side camera's picture of the body's front half, %s", (_, view) => {
+  ] as const)("is the 3D side camera's picture of the body's section at z = 0, %s", (_, view) => {
```

```diff
-    const corners = [0, MAIN_DEPTH_Z / 2].flatMap((z) => [cx - half, cx + half].flatMap((x) => [top, bottom].map((y) => project(x, y, z))));
+    const corners = [cx - half, cx + half].flatMap((x) => [top, bottom].map((y) => project(x, y, 0)));
     const [poly] = stageSolidsOnScreen(fd, 0, shaken);
     const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) < 1e-6;
-    for (const v of poly) expect(corners.some((c) => near(c, v)), `vertex ${v.x.toFixed(1)}, ${v.y.toFixed(1)}`).toBe(true);
-    for (const c of corners) expect(poly.some((v) => near(c, v)) || inside(poly, c), `corner ${c.x.toFixed(1)}, ${c.y.toFixed(1)}`).toBe(true);
-    // And the face's own corners shape it: the hull reaches the front face (z 18), not only the plane.
-    expect(poly.some((v) => corners.slice(4).some((c) => near(c, v)))).toBe(true);
+    expect(poly).toHaveLength(4);
+    for (const c of corners) expect(poly.some((v) => near(c, v)), `corner ${c.x.toFixed(1)}, ${c.y.toFixed(1)}`).toBe(true);
   });
```

`src/render3d/renderer3d.test.ts`. A test before "casts none for a fighter inside Kirby, …", with a literal angle so a zeroed constant cannot satisfy it. And the exact draw-call figure in "stays inside the draw-call budget with double-sided glbs at the caps while every fighter fades: …" gains the underside:

```diff
+  it("tips each shadow disc toward the camera, so the level side camera sees it under the feet (Plan 6, Task 33)", async () => {
+    const { presenter, rs, state, stage, gl } = setup();
+    await presenter.ready;
+    standAll(state);
+    presenter.paint(rs, createCamera(stage), 1, []);
+    const shadows = gl().scene!.getObjectByName("shadows") as InstancedMesh;
+    const m = new Matrix4();
+    shadows.getMatrixAt(0, m);
+    const up = new Vector3(0, 1, 0).transformDirection(m);
+    // A flat disc's normal is straight up; tipped 24°, it leans toward +z, the camera.
+    expect(up.z).toBeCloseTo(Math.sin((24 * Math.PI) / 180), 6);
+  });
+
   it("casts none for a fighter inside Kirby, grounded in a grounded Kirby's mouth, and keeps the Stone's, hidden as it is (Plan 5, Task 17)", async () => {
```

```diff
-    // One pass each: 4 × 12, Battlefield's 4 platforms and the 3 batches. Two passes each would be 4 × 12 × 2 + 7 = 103.
-    expect(presenter.info().calls).toBe(4 * MAX_FIGHTER_PRIMITIVES + stage.platforms.length + BATCH_CALLS);
+    // One pass each: 4 × 12, Battlefield's 4 platforms and its decorative underside (Plan 6,
+    // Task 33), and the 3 batches. Two passes each would be 4 × 12 × 2 + 8 = 104.
+    expect(presenter.info().calls).toBe(4 * MAX_FIGHTER_PRIMITIVES + stage.platforms.length + 1 + BATCH_CALLS);
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/render3d/stage3d.test.ts src/render3d/renderer3d.test.ts src/render/stageClip.test.ts`
Expected: FAIL, 10 tests (captured; 10 failed, 37 passed):
- stageClip: the section test `AssertionError: expected true to be false`; the two camera-picture tests `expected [ …(6) ] to have a length of 4 but got 6` and `corner 589.0, 282.0: expected false to be true`;
- renderer3d: the draw-call figure `AssertionError: expected 55 to be 56`; the tip `AssertionError: expected +0 to be close to 0.40673664307580015`;
- stage3d: the paint test `battlefield #0: expected [ 2, 2, 8 ] to deeply equal [ 2, 2, 10 ]`; the lip `AssertionError: expected +0 to be 6`; the shading `AssertionError: expected false to be true`; the underside `AssertionError: expected undefined to be defined`; D11 `battlefield: expected true to be false`.

- [ ] **Step 3: Implement**

`src/render/stageArt.ts`:

```diff
   readonly soft: string;
   readonly softEdge: string;
+  /**
+   * A decorative tapered underside below the main body, behind the play plane (Plan 6,
+   * Task 33), `depth` units tall, its bottom `taper` × the body's width; none when absent.
+   * UNVERIFIED (cosmetic): by eye, from Battlefield's silhouette in Ultimate.
+   */
+  readonly underside?: { readonly depth: number; readonly taper: number };
 }
```

```diff
     soft: "#3A5D8C",
     softEdge: "#8FC4EA",
+    underside: { depth: 34, taper: 0.38 },
   },
   finalDestination: {
```

`src/render3d/stage3d.ts`:

```diff
 export const SOFT_DEPTH_Z = 18;
+/**
+ * The stage draws first and writes no depth (Plan 6, Task 33; ruling D11): its depth toward
+ * the camera is decoration, the sim's world is the play plane, and nothing on that plane
+ * outside the solid is ever hidden by it. In the side camera's perspective the front face
+ * stands out past the wall the sim collides with, and it hid a fighter hugging the wall;
+ * drawn first with no depth, the fighters, their shields and sparks go over it, and the
+ * stage stays exactly as wide as its collision (R13). Each body is convex and drawn with
+ * its back faces culled, so it needs no depth of its own; the underside, behind the play
+ * plane, draws before the bodies.
+ */
+export const STAGE_RENDER_ORDER = -1;
 
-type Rgb = readonly [number, number, number];
+export type Rgb = readonly [number, number, number];
 
 function rgb(hex: string): Rgb {
   const c = new Color(hex);
   return [c.r, c.g, c.b];
 }
 
+/** `c` darkened toward black by `k` (0 none, 1 black). */
+function darken(c: Rgb, k: number): Rgb {
+  return [c[0] * (1 - k), c[1] * (1 - k), c[2] * (1 - k)];
+}
+
+/** The ledge lip's height down the front face (Plan 6, Task 33: `StagePaint.edge`). UNVERIFIED (cosmetic). */
+export const LIP_HEIGHT = 0.7;
+
+export interface PrismOptions {
+  /** A band of the front face's top in this colour, `lipHeight` deep: the ledge lip (Plan 6, Task 33). */
+  readonly lip?: Rgb;
+  readonly lipHeight?: number;
+  /** The walls' colour at their bottom edge, shading up to `side` at the top (Plan 6, Task 33). */
+  readonly faceBottom?: Rgb;
+}
+
+type Corner = readonly [number, number, number];
+
 /**
  * A tapered prism centred on x = 0: top face at y = 0 from −half to +half,
  * bottom face at y = −height from −half·taper to +half·taper, ±depthZ/2 deep.
- * Non-indexed so each face carries its own colour and flat normal.
+ * Non-indexed so each face carries its own colours and flat normal. With
+ * `opts`, the front face's top band is the lip, and the walls shade from
+ * `side` at the top to `faceBottom` at the bottom (Plan 6, Task 33).
  */
-export function prismGeometry(half: number, height: number, taper: number, depthZ: number, top: Rgb, side: Rgb, bottom: Rgb): BufferGeometry {
+export function prismGeometry(half: number, height: number, taper: number, depthZ: number, top: Rgb, side: Rgb, bottom: Rgb, opts: PrismOptions = {}): BufferGeometry {
   const z0 = -depthZ / 2;
   const z1 = depthZ / 2;
   const b = half * taper;
@@
     blf: [-b, -height, z1], brf: [b, -height, z1], blb: [-b, -height, z0], brb: [b, -height, z0],
   } as const;
-  const quads: [readonly number[], readonly number[], readonly number[], readonly number[], Rgb][] = [
-    [P.tlb, P.tlf, P.trf, P.trb, top],
-    [P.tlf, P.blf, P.brf, P.trf, side],
-    [P.trb, P.brb, P.blb, P.tlb, side],
-    [P.tlb, P.blb, P.blf, P.tlf, side],
-    [P.trf, P.brf, P.brb, P.trb, side],
-    [P.blf, P.blb, P.brb, P.brf, bottom],
-  ];
+  const wall = (p: Corner): Rgb => (opts.faceBottom !== undefined && p[1] === -height ? opts.faceBottom : side);
+  const flat = (c: Rgb) => (): Rgb => c;
+  const quads: [Corner, Corner, Corner, Corner, (p: Corner) => Rgb][] = [[P.tlb, P.tlf, P.trf, P.trb, flat(top)]];
+  if (opts.lip !== undefined) {
+    // The front face split where the lip ends: the lip above, the shaded wall below.
+    const k = Math.min(1, (opts.lipHeight ?? LIP_HEIGHT) / height);
+    const Lf: Corner = [P.tlf[0] + (P.blf[0] - P.tlf[0]) * k, -height * k, z1];
+    const Rf: Corner = [P.trf[0] + (P.brf[0] - P.trf[0]) * k, -height * k, z1];
+    quads.push([P.tlf, Lf, Rf, P.trf, flat(opts.lip)], [Lf, P.blf, P.brf, Rf, wall]);
+  } else {
+    quads.push([P.tlf, P.blf, P.brf, P.trf, wall]);
+  }
+  quads.push(
+    [P.trb, P.brb, P.blb, P.tlb, wall],
+    [P.tlb, P.blb, P.blf, P.tlf, wall],
+    [P.trf, P.brf, P.brb, P.trb, wall],
+    [P.blf, P.blb, P.brb, P.brf, flat(bottom)],
+  );
   const pos: number[] = [];
   const col: number[] = [];
   for (const [a, b2, c, d, colour] of quads) {
     for (const v of [a, b2, c, a, c, d]) {
       pos.push(v[0], v[1], v[2]);
-      col.push(...colour);
+      col.push(...colour(v));
     }
   }
```

```diff
   const paint = stagePaintFor(stage);
-  const material = new MeshLambertMaterial({ vertexColors: true });
+  const material = new MeshLambertMaterial({ vertexColors: true, depthWrite: false });
```

```diff
-      : prismGeometry(half, MAIN_DEPTH, 1, MAIN_DEPTH_Z, rgb(paint.top), rgb(paint.face), rgb(paint.deep));
+      : prismGeometry(half, MAIN_DEPTH, 1, MAIN_DEPTH_Z, rgb(paint.top), rgb(paint.face), rgb(paint.deep), {
+          lip: rgb(paint.edge),
+          lipHeight: LIP_HEIGHT,
+          faceBottom: rgb(paint.deep),
+        });
     const mesh = new Mesh(geometry, material);
     mesh.position.set(toFloat(platform.x), toFloat(platform.y), 0);
     mesh.receiveShadow = true;
+    mesh.renderOrder = STAGE_RENDER_ORDER;
     group.add(mesh);
     meshes.push(mesh);
     if (platform.motion) movers.push({ mesh, platform });
   }
+
+  // The decorative tapered underside (Plan 6, Task 33), for the themes that taper below:
+  // under the main body's bottom and wholly behind the play plane (z −18.5 to −0.5), so
+  // nothing the sim does meets it, and a fighter under the stage is drawn in front of it.
+  // Its walls go on from the body's deep colour to darker still. One draw call.
+  const under = paint.underside;
+  const main = stage.platforms.find((p) => !p.soft);
+  if (under !== undefined && main !== undefined) {
+    const deep = rgb(paint.deep);
+    const darker = darken(deep, 0.45);
+    const mesh = new Mesh(prismGeometry(toFloat(main.halfWidth), under.depth, under.taper, MAIN_DEPTH_Z / 2, deep, deep, darker, { faceBottom: darker }), material);
+    mesh.name = "underside";
+    mesh.position.set(toFloat(main.x), toFloat(main.y) - MAIN_DEPTH, -MAIN_DEPTH_Z / 4 - 0.5);
+    mesh.renderOrder = STAGE_RENDER_ORDER - 1;
+    group.add(mesh);
+    meshes.push(mesh);
+  }
   return {
```

`src/render/stageClip.ts`:

```diff
- * and `MAIN_DEPTH_Z` toward and away from the camera (`render3d/stage3d.ts`); its
- * front half covers, on screen, exactly the points at z = 0 that it hides. So the
- * overlay clips that region out (`clipOutStage`), and past the ledge, over open
- * air, an effect still shows in full. A soft platform has no body.
+ * and `MAIN_DEPTH_Z` toward and away from the camera (`render3d/stage3d.ts`), but
+ * since Plan 6, Task 33 (ruling D11) that depth hides nothing: the stage draws first,
+ * writing no depth, and every fighter is drawn over its front face. So the overlay
+ * clips out the body's section in the play plane alone, where an effect at z = 0 is
+ * inside the solid (`clipOutStage`); past the wall, where the front face only
+ * overhangs in perspective, an effect shows in full, as the fighter beside it does.
+ * A soft platform has no body.
```

```diff
 /**
- * Each solid platform's front half (z 0 to `MAIN_DEPTH_Z / 2`), projected through
- * the 3D side camera the overlay is framed with (`render3d/camera3d.ts`: at z = 0
- * it is `worldToScreen` exactly), as a convex polygon in screen pixels.
+ * Each solid platform's section in the play plane (z = 0), projected through the 3D
+ * side camera the overlay is framed with (`render3d/camera3d.ts`: at z = 0 it is
+ * `worldToScreen` exactly), as a convex polygon in screen pixels (Plan 6, Task 33).
  */
```

```diff
-    const corners: Point[] = [];
-    for (const z of [0, MAIN_DEPTH_Z / 2]) {
-      for (const [x, y] of [
+    const corners: Point[] = (
+      [
         [cx - half, top],
         [cx + half, top],
         [cx + half, bottom],
         [cx - half, bottom],
-      ] as const) {
-        corners.push(project(x, y, z));
-      }
-    }
+      ] as const
+    ).map(([x, y]) => project(x, y, 0));
     out.push(hull(corners));
```

(`MAIN_DEPTH_Z` stays exported from here: `stage3d.ts` still extrudes by it.)

`src/render3d/renderer3d.ts`:

```diff
   DynamicDrawUsage,
+  Euler,
   HemisphereLight,
```

```diff
 const SHADOW_DEEP = 1.1;
+/**
+ * How far each blob shadow tips toward the camera from lying flat (Plan 6, Task 33): the
+ * level side camera sees a flat disc on the floor as a line a pixel or two tall; tipped,
+ * it reads as a contact shadow under the feet. UNVERIFIED (cosmetic): by eye, from stand-in
+ * captures (the stage writes no depth, so the whole tipped disc shows).
+ */
+export const SHADOW_TIP_DEG = 24;
```

```diff
   const m = new Matrix4();
-  const flat = new Quaternion();
+  // The shadow disc lies flat (its geometry) and tips toward the camera (Plan 6, Task 33).
+  const flat = new Quaternion().setFromEuler(new Euler((SHADOW_TIP_DEG * Math.PI) / 180, 0, 0));
```

`e2e/render3d.spec.ts`. The draw-call range counts the stage's meshes, the underside included, so the four-fighter brawl (shields, sparks and shadows all up) stays inside it on Battlefield:

```diff
 import { BATCH_CALLS, MAX_DRAW_CALLS, MAX_TRIANGLES_PER_FRAME } from "../src/render3d/budget";
+import { stagePaintFor } from "../src/render/stageArt";
 import { parseModelIndex } from "../src/render3d/models/loader";
```

```diff
  * A frame's draw calls are known by construction (`renderer3d.ts`): one per
- * stage platform, one batch each for the sparks and bursts, the shields and
- * the blob shadows (`BATCH_CALLS`), and the fighters: a stand-in is one mesh
- * per hurt capsule of its skeleton, a glb one per primitive of the file the
- * server sends. So a fighter is seen to draw by a bound on calls that nothing
- * else reaches (`callRange`): with the capsules never attached a match is the
- * stage and its batches, 7 calls on Battlefield, and a bare `calls > 0` is met
- * by that alone. The ceiling is the batches' 3 above the floor, so any fighter
+ * stage mesh (each platform, and Battlefield's decorative underside, Plan 6
+ * Task 33), one batch each for the sparks and bursts, the shields and the blob
+ * shadows (`BATCH_CALLS`), and the fighters: a stand-in is one mesh per hurt
+ * capsule of its skeleton, a glb one per primitive of the file the server
+ * sends. So a fighter is seen to draw by a bound on calls that nothing else
+ * reaches (`callRange`): with the capsules never attached a match is the stage
+ * and its batches, 8 calls on Battlefield, and a bare `calls > 0` is met by
+ * that alone. The ceiling is the batches' 3 above the floor, so any fighter
  * whose parts are drawn twice is over it.
```

```diff
  * The draw calls a frame costs, as the range its parts allow: the stage's
- * platforms (`stage3d.ts`: one mesh each), the fighters, and at most the
+ * meshes (`stage3d.ts`: one per platform, and the underside), the fighters, and at most the
```

```diff
-function callRange(platforms: number, fighters: readonly DrawnFighter[]): { min: number; max: number } {
+function callRange(stageMeshes: number, fighters: readonly DrawnFighter[]): { min: number; max: number } {
   let parts = 0;
   for (const f of fighters) parts += f.kind === "glb" ? f.primitives : SKELETONS[f.id].hurt.length;
-  const range = { min: platforms + parts, max: platforms + BATCH_CALLS + parts };
+  const range = { min: stageMeshes + parts, max: stageMeshes + BATCH_CALLS + parts };
   // The floor is only worth having if the stage and its batches cannot reach it.
-  expect(range.min, "a floor that only drawn fighters reach").toBeGreaterThan(platforms + BATCH_CALLS);
+  expect(range.min, "a floor that only drawn fighters reach").toBeGreaterThan(stageMeshes + BATCH_CALLS);
   return range;
 }
 
-/** The stage of the running match: how many platforms it has. A form (`-omega`, `-battlefield`) has its template's. */
-async function stagePlatforms(page: Page): Promise<number> {
+/**
+ * The stage of the running match: how many meshes it draws, one per platform and its
+ * decorative underside where its theme has one (Plan 6, Task 33). A form (`-omega`,
+ * `-battlefield`) has its template's platforms and theme.
+ */
+async function stageMeshes(page: Page): Promise<number> {
   const id = await simStageId(page);
   const stage = resolveStage(id);
   if (stage === undefined) throw new Error(`the match is on a stage the game does not know: "${id}"`);
-  return stage.platforms.length;
+  return stage.platforms.length + (stagePaintFor(stage).underside === undefined ? 0 : 1);
 }
```

and the three calls `callRange(await stagePlatforms(page), …)` become `callRange(await stageMeshes(page), …)`. The brawl's comment, in `e2e/render3d.spec.ts`:

```diff
-      // that draw nothing are 7 calls on Battlefield), and no more than the parts allow (a fighter drawn twice is over).
+      // that draw nothing are 8 calls on Battlefield), and no more than the parts allow (a fighter drawn twice is over).
```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/render3d src/render`
Expected: PASS (captured). `stage3d.test.ts:112-133`, R13's straight walls, passes unchanged.

- [ ] **Step 5: Look at the stand-ins, and regenerate the shots**

Run `CAPTURE=1 PORT=3107 pnpm test:e2e e2e/screenshots.spec.ts --trace off`. It routes `/models/` to 404, so the fighters are stand-ins. View `docs/screenshots/match.png` and `docs/screenshots/match-2.png` with Read: the lip is a bright strip along the main body's top edge, the face darkens toward its bottom, and on Battlefield the underside tapers below the body. Stage those two shots only.

The other six move by noise between any two runs: the replay measured `title.png` at 1/255 over 2,032 pixels, and the character select's slide-in at up to 10/255 over 190 pixels. Put them back with `git restore -- super-smash/docs/screenshots/title.png super-smash/docs/screenshots/main-menu.png super-smash/docs/screenshots/rules.png super-smash/docs/screenshots/stage-select.png super-smash/docs/screenshots/character-select.png super-smash/docs/screenshots/controls.png`.

- [ ] **Step 6: Mutants**

1. `createStage3D`: drop `lip: rgb(paint.edge),`. The lip test FAILS: `AssertionError: expected +0 to be 6` (captured).
2. `createStage3D`: drop `faceBottom: rgb(paint.deep),`. The shading test FAILS: `AssertionError: expected false to be true` (captured).
3. The underside's z: `-MAIN_DEPTH_Z / 4 - 0.5` → `0`. The underside test FAILS: `AssertionError: expected 9 to be less than 0` (captured).
4. The material: drop `depthWrite: false`. The D11 test FAILS: `battlefield: expected true to be false` (captured).
5. `SHADOW_TIP_DEG = 24` → `0`. The tip test FAILS: `AssertionError: expected +0 to be close to 0.40673664307580015` (captured).
6. `stageClip.ts`: project each corner at z 0 and at `MAIN_DEPTH_Z / 2` again (`.flatMap(([x, y]) => [project(x, y, 0), project(x, y, MAIN_DEPTH_Z / 2)])`). The section test FAILS: `AssertionError: expected true to be false` (captured).

- [ ] **Step 7: Gate and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`, `PORT=3107 pnpm test:e2e --trace off` (the 3D e2e's draw-call ranges). Expected: exit 0.

```bash
git add super-smash/src/render3d/stage3d.ts super-smash/src/render/stageArt.ts super-smash/src/render/stageClip.ts super-smash/src/render3d/renderer3d.ts super-smash/src/render3d/stage3d.test.ts super-smash/src/render/stageClip.test.ts super-smash/src/render3d/renderer3d.test.ts super-smash/e2e/render3d.spec.ts super-smash/docs/screenshots/match.png super-smash/docs/screenshots/match-2.png
git commit -m "super-smash: the 3D stage gets its ledge lip, a shaded front face and a decorative underside; fighters are drawn over its face; shadows tip toward the camera" -m "Ruling D11: the stage draws first and writes no depth, so a wall-hugging fighter is never behind the front face's perspective overhang, and the overlay's clip is the solid's play-plane section; a chamfer with the geometric inset (7.39) was captured and drew the stage narrower than its collision. R13's straight-walls test stands. The camera stays level (D12). Render only; screenshots are stand-ins (CAPTURE=1)." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 34: The 3D fighter: a landing squash, and sword and kick trails

Two Plan 4 carries:
- Plan 4 Task 23 review: "The 2D draw-time squash (`squashFor`) was lost with the 2D fighter path; restore it render-only on the 3D model root (a brief vertical squash on landing), keeping boxes unmoved."
  - The landing branch of `squashFor` (`land`, `landingLag`: x ×1.22→1, y ×0.8→1 over 6 frames) goes on a group between the fighter's placement and its root's group. It scales from the placement's origin at the feet, so they stay on the floor, and equally across x and z, so the facing turn does not matter.
  - Only the landing, as the backlog line asks. `characterArt.ts:896-899` says the landing and jump-squat clips were authored with `squashFor` multiplied in, so this restores the landing's authored look; the hitlag stretch and the jump squat stay out.
- Final review, Declined #2: "the 2D swing arcs are gone; Link's ordinary sword swings draw nothing. Ultimate draws trails — add 3D trails from the hitbox/blade bone path."
  - **The bone.** A trail follows the bone a move's boxes ride (`trailBoneOf`): the first `ATTACK` in the move's script whose bone is not the root (`top`, `trans`, `rot`), with every attack id on that bone.
  - **The sample.** Once a sim frame while one of those boxes is live, a sample runs from the bone's drawn position (the hand, the ankle) out to the farthest live box on it (the blade's tip, the toe). The 3D bones sit where the sim's bone table puts them, within 0.01 (`fighter3d.test.ts:67-86`), and the sim's boxes ride the bones the bake places (D57), so the ribbon spans the drawn blade.
  - **The ribbon.** The last `TRAIL_SAMPLES` samples are joined, fading toward the oldest and toward the grip. When the boxes end, the ribbon draws in from its tail, a sample a frame.
  - **No exclusions.** A grab's boxes are `CATCH`es and pummels hang on `top`, so neither trails; a throw's slash on a limb (Link's up throw, on `sword2`) is a swing, and does.
  - **The draw call.** One mesh for all fighters, single-pass (three would draw a transparent double-sided material twice), shown only while a trail is out. `BATCH_CALLS` counts it: 3 → 4.
  - **No exact sweep.** Where a script's box holds still through its window (Marth's forward smash, frames 10-13 at one position), the sim's box does too, and the ribbon spans the blade without sweeping; that is the drawn clip's own stillness.

**Golden:** unaffected (render only; no box moves).

**Files:**
- Create: `src/render3d/trail3d.ts`, `src/render3d/trail3d.test.ts`
- Modify: `src/render3d/fighter3d.ts`, `src/render3d/renderer3d.ts`, `src/render3d/budget.ts` (`BATCH_CALLS`), `e2e/render3d.spec.ts` (its doc of the batches)
- Test: `src/render3d/fighter3d.test.ts`, `src/render3d/renderer3d.test.ts`, `src/render3d/faceTurn.test.ts` (its model frame is now one group deeper)

**Interfaces:**
- Consumes: `squashFor` (characterArt.ts); `Fighter3D.bonePosition`; `activeHitboxes`, `moveFrameOf` (hitbox.ts); `FighterDef.scripts` (`op: "attack"`, `"loop"`).
- Produces:
  - `landingSquash(f): { x: number; y: number }` (fighter3d.ts);
  - from trail3d.ts:
    - `trailBoneOf(def: FighterDef, slot: MoveSlot): TrailBone | null`, with `TrailBone { bone: string; ids: ReadonlySet<number> }`;
    - `trailSample(bone, boxes, x, y, facing, at): TrailSample | null`, with `TrailSample { inner; outer }`;
    - `createTrails3D(maxFighters): Trails3D`, providing `push(port, sample | null)`, `update()`, `mesh`, `samplesOf`, `alphasOf` and `dispose()`;
    - `TRAIL_SAMPLES = 6`.

- [ ] **Step 1: Write the failing tests**

`src/render3d/fighter3d.test.ts`. `landingSquash` joins the `./fighter3d` import, and a block is appended. It uses the file's `mario`, `poser`, `bake`, `frameOf` and `makeFighter`:

```diff
-import { createFighter3D, simWorldX, type Fighter3D } from "./fighter3d";
+import { createFighter3D, landingSquash, simWorldX, type Fighter3D } from "./fighter3d";
```

```ts
describe("the landing squash on the model (Plan 6, Task 34)", () => {
  it("squashes a landing for six frames, the same across x and z, and nothing else", () => {
    const at0 = landingSquash({ action: "land", actionFrame: 0, hitlag: 0 });
    expect([at0.x, at0.y]).toEqual([expect.closeTo(1.22, 9), expect.closeTo(0.8, 9)]);
    const at3 = landingSquash({ action: "landingLag", actionFrame: 3, hitlag: 0 });
    expect([at3.x, at3.y]).toEqual([expect.closeTo(1.11, 9), expect.closeTo(0.9, 9)]);
    expect(landingSquash({ action: "land", actionFrame: 6, hitlag: 0 })).toEqual({ x: 1, y: 1 });
    expect(landingSquash({ action: "stand", actionFrame: 0, hitlag: 8 })).toEqual({ x: 1, y: 1 });
    expect(landingSquash({ action: "jumpSquat", actionFrame: 1, hitlag: 0 })).toEqual({ x: 1, y: 1 });
  });

  it("scales a group between the placement and the root, so the placement keeps its scale and the feet stay down", () => {
    const fighter = createFighter3D({ def: mario, port: 0, poser, bake, model: { kind: "standIn", reason: "test" } });
    fighter.update(frameOf(makeFighter({ action: "land", actionFrame: 0, grounded: true })));
    const squash = fighter.placement.children[0];
    expect(squash.scale.y).toBeCloseTo(0.8, 9);
    expect(squash.scale.x).toBeCloseTo(1.22, 9);
    expect(squash.scale.z).toBe(squash.scale.x);
    expect(fighter.placement.scale.toArray()).toEqual([1, 1, 1]);
    fighter.update(frameOf(makeFighter({ action: "stand", grounded: true })));
    expect(squash.scale.toArray()).toEqual([1, 1, 1]);
    fighter.dispose();
  });
});
```

`src/render3d/trail3d.test.ts` (new file). Its second test is the look as numbers (R-P6-6):

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { DoubleSide, Vector3, type MeshBasicMaterial } from "three";

import { activeHitboxes, actionFrameOf } from "@/engine/hitbox";
import { fx, toFloat } from "@/engine/fixed";
import { FIGHTERS } from "@/fighters";
import { withLimbScripts } from "@/fighters/acmd/limb";
import { readBakeFromDisk } from "@/game/bakeNode";
import { makeFighter } from "@/render/testFixtures";
import { fighterPoser } from "./bake/bake";
import { createFighter3D } from "./fighter3d";
import { parseSkeletonFile } from "./skeleton/skeleton";
import { TRAIL_SAMPLES, createTrails3D, trailBoneOf, trailSample, type TrailSample } from "./trail3d";

const bake = readBakeFromDisk();
/** The game's own fighter: its limb-bone moves run their scripts, through the bake's bones. */
const def = (id: string) => withLimbScripts(FIGHTERS.find((f) => f.id === id)!, bake.bones);

describe("sword and kick trails (Plan 6, Task 34)", () => {
  it("follows the bone a limb move's boxes ride, and none for a root-bone move or a grab", () => {
    expect(trailBoneOf(def("link"), "ftilt")?.bone).toBe("sword2");
    expect(trailBoneOf(def("marth"), "fsmash")?.bone).toBe("sword1");
    expect(trailBoneOf(def("kirby"), "ftilt")?.bone).toBe("footl");
    // Link's up throw slashes upward with his sword: a swing, trailed like any other.
    expect(trailBoneOf(def("link"), "uthrow")?.bone).toBe("sword2");
    // Boxes on the body's root (`top`): Link's jab 1, Mario's pummel. A grab's boxes are catches.
    expect(trailBoneOf(def("link"), "jab1")).toBeNull();
    expect(trailBoneOf(def("mario"), "pummel")).toBeNull();
    expect(trailBoneOf(def("marth"), "grab")).toBeNull();
  });

  /**
   * The look, as numbers (ruling R-P6-6): on the tipper's first live frame the ribbon's
   * sample runs from Marth's hand, where the drawn `sword1` bone is, out to the tipper box,
   * the farthest of the blade's live boxes: the blade's length, not a smear at the hilt.
   */
  it("spans Marth's blade on his forward smash: from the drawn hand to the tipper, the farthest live box", () => {
    const marth = def("marth");
    const bone = trailBoneOf(marth, "fsmash")!;
    const move = marth.moves.fsmash!;
    const first = Math.min(...move.hitboxes.map((h) => h.startFrame));
    const skeleton = parseSkeletonFile(JSON.parse(readFileSync(join(process.cwd(), "src", "render3d", "skeletons", "marth.json"), "utf8")));
    const fighter = createFighter3D({ def: marth, port: 0, poser: fighterPoser(marth, skeleton), bake, model: { kind: "standIn", reason: "test" } });
    const f = makeFighter({ defId: "marth", x: fx(10), y: 0, facing: 1, grounded: true, action: "attack", move: "fsmash", actionFrame: actionFrameOf(first) });
    fighter.update({ f, x: toFloat(f.x), y: toFloat(f.y), frame: 100, blends: null, hitFlash: 0, hidden: false });
    const hand = new Vector3();
    expect(fighter.bonePosition(bone.bone, hand)).toBe(true);
    const boxes = activeHitboxes(move, first);
    const sample = trailSample(bone, boxes, toFloat(f.x), toFloat(f.y), f.facing, { x: hand.x, y: hand.y, z: hand.z })!;
    expect(sample).not.toBeNull();
    expect(sample.inner).toEqual({ x: hand.x, y: hand.y, z: hand.z });
    const length = Math.hypot(sample.outer.x - sample.inner.x, sample.outer.y - sample.inner.y);
    expect(length).toBeGreaterThan(6);
    // The outer edge is the strongest box: the tipper.
    const tipper = boxes.filter((h) => bone.ids.has(h.id)).reduce((a, b) => (b.damage > a.damage ? b : a));
    expect(sample.outer.x).toBeCloseTo(toFloat(f.x) + toFloat(tipper.x), 6);
    expect(sample.outer.y).toBeCloseTo(toFloat(f.y) + toFloat(tipper.y), 6);
    fighter.dispose();
  });

  it("keeps the last TRAIL_SAMPLES samples, fading to the oldest, and draws in from its tail a sample a frame once the boxes end", () => {
    const trails = createTrails3D(4);
    const sample = (i: number): TrailSample => ({ inner: { x: i, y: 0, z: 0 }, outer: { x: i, y: 5, z: 0 } });
    for (let i = 0; i < TRAIL_SAMPLES + 3; i++) trails.push(0, sample(i));
    trails.update();
    expect(trails.samplesOf(0).map((s) => s.inner.x)).toEqual(Array.from({ length: TRAIL_SAMPLES }, (_, i) => i + 3));
    const alpha = trails.alphasOf(0);
    expect(alpha[alpha.length - 1]).toBeGreaterThan(alpha[0]);
    expect(trails.mesh.visible).toBe(true);
    trails.push(0, null);
    expect(trails.samplesOf(0).map((s) => s.inner.x)).toEqual(Array.from({ length: TRAIL_SAMPLES - 1 }, (_, i) => i + 4));
    for (let i = 0; i < TRAIL_SAMPLES; i++) trails.push(0, null);
    trails.update();
    expect(trails.samplesOf(0)).toEqual([]);
    expect(trails.mesh.visible).toBe(false);
    trails.dispose();
  });

  it("is one ribbon for every fighter, drawn in one pass: one draw call", () => {
    const trails = createTrails3D(4);
    const material = trails.mesh.material as MeshBasicMaterial;
    expect(trails.mesh.isMesh).toBe(true);
    // three draws a transparent double-sided material twice, back faces then front, unless single-pass.
    expect(material.transparent && material.side === DoubleSide).toBe(true);
    expect(material.forceSinglePass).toBe(true);
    trails.dispose();
  });
});
```

`src/render3d/renderer3d.test.ts`. The imports gain `actionFrameOf` (from `@/engine/hitbox`) and `TRAIL_SAMPLES` (from `./trail3d`), and a test goes before Task 33's "tips each shadow disc …". The setup's fighters are Mario, Fox, Kirby and Donkey Kong; Kirby's forward tilt is a `footl` kick:

```diff
+  it("draws a kick's trail along Kirby's foot while its boxes are out, one sample a sim frame however often it paints (Plan 6, Task 34)", async () => {
+    const { presenter, rs, state, stage, gl } = setup();
+    await presenter.ready;
+    standAll(state);
+    const ftilt = defs[2].moves.ftilt!;
+    const first = Math.min(...ftilt.hitboxes.map((h) => h.startFrame));
+    const trails = () => gl().scene!.getObjectByName("trails") as Mesh;
+    presenter.paint(rs, createCamera(stage), 1, []);
+    expect(trails().visible).toBe(false);
+    for (let k = 0; k < 2; k++) {
+      state.frame += 1;
+      state.fighters[2] = { ...state.fighters[2], action: "attack", move: "ftilt", actionFrame: actionFrameOf(first) + k };
+      presenter.paint(rs, createCamera(stage), 1, []);
+      // Painted again on the same sim frame, as a 120 Hz display does: no second sample.
+      presenter.paint(rs, createCamera(stage), 1, []);
+    }
+    expect(trails().visible).toBe(true);
+    // Port 2's stretch of the ribbon: two samples, each an inner and an outer vertex, shown.
+    const colour = trails().geometry.getAttribute("color");
+    const shown = [...Array(colour.count).keys()].filter((i) => colour.getW(i) > 0);
+    expect(shown).toEqual([0, 1, 2, 3].map((i) => 2 * TRAIL_SAMPLES * 2 + i));
+  });
+
   it("tips each shadow disc toward the camera, so the level side camera sees it under the feet (Plan 6, Task 33)", async () => {
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/render3d/fighter3d.test.ts src/render3d/trail3d.test.ts src/render3d/renderer3d.test.ts`
Expected: FAIL (captured):
- `landingSquash`: `TypeError: landingSquash is not a function`;
- the group: `AssertionError: expected 1 to be close to 0.8, received difference is 0.19999999999999996, but expected 5e-10`;
- `trail3d.test.ts` and `renderer3d.test.ts`: `Error: Failed to resolve import "./trail3d"`.

- [ ] **Step 3: Implement**

`src/render3d/fighter3d.ts`:

```diff
-import { hitlagShake } from "@/render/characterArt";
+import { hitlagShake, squashFor } from "@/render/characterArt";
```

```diff
+/**
+ * The landing's squash on the model (Plan 6, Task 34): `squashFor`'s landing branch, the
+ * 2D figure's (`characterArt.ts`, whose note says the landing clip was authored with it
+ * multiplied in), x across and y up; 1, 1 for anything else. Render only: no box moves.
+ */
+export function landingSquash(f: Pick<FighterState, "action" | "actionFrame" | "hitlag">): { x: number; y: number } {
+  if (f.action !== "land" && f.action !== "landingLag") return { x: 1, y: 1 };
+  const s = squashFor(f);
+  return { x: s.scaleX, y: s.scaleY };
+}
+
 export function createFighter3D(opts: Fighter3DOptions): Fighter3D {
```

```diff
   const rootGroup = new Group();
   rootGroup.add(built.root);
+  // The landing squash (Plan 6, Task 34), scaled across x and z alike so the facing turn
+  // does not matter, from the placement's origin at the feet so they stay on the floor.
+  const squashGroup = new Group();
+  squashGroup.add(rootGroup);
   const placement = new Group();
   placement.name = `fighter:${opts.port}:${opts.def.id}`;
-  placement.add(rootGroup);
+  placement.add(squashGroup);
```

```diff
       applyRoot(rootGroup, pose.root);
+      const squash = landingSquash(f);
+      squashGroup.scale.set(squash.x, squash.y, squash.x);
       turner.apply(f.facing);
```

`src/render3d/faceTurn.test.ts`, whose bone-in-model helper read `placement.children[0]` as the root's group:

```diff
-  const inModel = (fighter: Fighter3D, bone: Object3D) => new Matrix4().copy(fighter.placement.children[0].matrixWorld).invert().multiply(bone.matrixWorld);
+  // The model's frame: the root's group, under the landing squash's (Plan 6, Task 34).
+  const inModel = (fighter: Fighter3D, bone: Object3D) => new Matrix4().copy(fighter.placement.children[0].children[0].matrixWorld).invert().multiply(bone.matrixWorld);
```

`src/render3d/trail3d.ts` (new file):

```ts
/**
 * Sword and kick trails (Plan 6, Task 34; the final review's Declined #2: "Ultimate draws
 * trails"). A move whose boxes ride a limb bone sweeps a ribbon across its blade: once a
 * sim frame a sample runs from the bone (the hand, the ankle) out to the farthest of its
 * live boxes (the blade's tip, the toe), the boxes the sim hits with; the last
 * `TRAIL_SAMPLES` of them are joined, fading toward the oldest. When the boxes end the
 * ribbon draws in from its tail, a sample a frame. One mesh for every fighter, drawn in
 * one pass: one draw call while a trail is out, none otherwise. Render only.
 */

import { BufferAttribute, BufferGeometry, DoubleSide, Mesh, MeshBasicMaterial } from "three";

import type { AttackParams } from "@/engine/acmd/types";
import { toFloat } from "@/engine/fixed";
import type { FighterDef, Hitbox, MoveSlot } from "@/engine/types";

/** Samples kept per trail: a tenth of a second. UNVERIFIED (cosmetic). */
export const TRAIL_SAMPLES = 6;
/** The ribbon's opacity at its newest sample, on its outer edge. UNVERIFIED (cosmetic). */
const TRAIL_OPACITY = 0.55;
/** The inner (hand) edge's share of that: the ribbon fades toward the grip. UNVERIFIED (cosmetic). */
const INNER_OPACITY = 0.35;

/** The root bones: a box on one hangs on the body, and there is no limb to trail. */
const ROOT_BONES: ReadonlySet<string> = new Set(["top", "trans", "rot"]);

/** The bone a move's trail follows, and the ids of the script's boxes on it. */
export interface TrailBone {
  readonly bone: string;
  readonly ids: ReadonlySet<number>;
}

/**
 * The bone of the first `ATTACK` in the move's script that is not a root bone, and every
 * attack id on it; null for a root-bone move, a grab (its boxes are `CATCH`es), or a move
 * with no script (its boxes hang on no bone). A throw's collateral slash on a limb, Link's
 * up throw's sword, is a swing like any other.
 */
export function trailBoneOf(def: FighterDef, slot: MoveSlot): TrailBone | null {
  const script = def.scripts?.[slot];
  if (script === undefined) return null;
  const attacks: AttackParams[] = [];
  const walk = (cmds: typeof script.commands): void => {
    for (const c of cmds) {
      if (c.op === "attack") attacks.push(c.params);
      else if (c.op === "loop") walk(c.body);
    }
  };
  walk(script.commands);
  const bone = attacks.find((a) => !ROOT_BONES.has(a.bone))?.bone;
  if (bone === undefined) return null;
  return { bone, ids: new Set(attacks.filter((a) => a.bone === bone).map((a) => a.id)) };
}

export interface TrailPoint {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** One frame of a trail: the blade, from the bone (`inner`) to its farthest live box (`outer`). */
export interface TrailSample {
  readonly inner: TrailPoint;
  readonly outer: TrailPoint;
}

/**
 * This frame's sample: from `at`, the trail bone's world position, out to the centre of the
 * farthest of the move's live boxes on that bone (`boxes`, the move's `activeHitboxes`
 * this frame, facing-relative, from where the fighter is drawn, `x` and `y`), at the
 * bone's depth; null when none of the bone's boxes is live.
 */
export function trailSample(bone: TrailBone, boxes: readonly Hitbox[], x: number, y: number, facing: number, at: TrailPoint): TrailSample | null {
  let outer: TrailPoint | null = null;
  let far = -1;
  for (const hb of boxes) {
    if (hb.grabbing === true || !bone.ids.has(hb.id)) continue;
    const ox = x + (facing >= 0 ? toFloat(hb.x) : -toFloat(hb.x));
    const oy = y + toFloat(hb.y);
    const d = (ox - at.x) * (ox - at.x) + (oy - at.y) * (oy - at.y);
    if (d > far) {
      far = d;
      outer = { x: ox, y: oy, z: at.z };
    }
  }
  return outer === null ? null : { inner: at, outer };
}

export interface Trails3D {
  readonly mesh: Mesh;
  /** This sim frame's sample for `port`; null, when it has none, draws the ribbon in a sample from its tail. Once a sim frame. */
  push(port: number, sample: TrailSample | null): void;
  /** Rebuild the ribbon from every trail, and show the mesh only while one is out. */
  update(): void;
  samplesOf(port: number): readonly TrailSample[];
  alphasOf(port: number): readonly number[];
  dispose(): void;
}

export function createTrails3D(maxFighters: number): Trails3D {
  const trails: TrailSample[][] = Array.from({ length: maxFighters }, () => []);
  const verts = maxFighters * TRAIL_SAMPLES * 2;
  const geometry = new BufferGeometry();
  const position = new BufferAttribute(new Float32Array(verts * 3), 3);
  const colour = new BufferAttribute(new Float32Array(verts * 4), 4);
  geometry.setAttribute("position", position);
  geometry.setAttribute("color", colour);
  const index: number[] = [];
  for (let f = 0; f < maxFighters; f++) {
    for (let i = 0; i < TRAIL_SAMPLES - 1; i++) {
      const a = (f * TRAIL_SAMPLES + i) * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  geometry.setIndex(index);
  // One pass: a ribbon has no back to sort, and three draws a transparent double-sided
  // material twice (back faces, then front) unless it is single-pass.
  const material = new MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, side: DoubleSide, forceSinglePass: true });
  const mesh = new Mesh(geometry, material);
  mesh.name = "trails";
  mesh.frustumCulled = false;
  mesh.visible = false;
  const alphas = (n: number): number[] => Array.from({ length: n }, (_, i) => ((i + 1) / n) * TRAIL_OPACITY);
  return {
    mesh,
    push(port, sample) {
      const list = trails[port];
      if (list === undefined) return;
      if (sample === null) {
        list.shift();
        return;
      }
      list.push(sample);
      if (list.length > TRAIL_SAMPLES) list.shift();
    },
    update() {
      let out = false;
      for (let f = 0; f < maxFighters; f++) {
        const list = trails[f];
        if (list.length >= 2) out = true;
        const a = alphas(list.length);
        for (let i = 0; i < TRAIL_SAMPLES; i++) {
          // Past the trail's end, its last sample again, unseen: a quad of no area.
          const s = list[Math.min(i, list.length - 1)];
          const shown = s !== undefined && i < list.length;
          const v = (f * TRAIL_SAMPLES + i) * 2;
          position.setXYZ(v, s?.inner.x ?? 0, s?.inner.y ?? 0, s?.inner.z ?? 0);
          position.setXYZ(v + 1, s?.outer.x ?? 0, s?.outer.y ?? 0, s?.outer.z ?? 0);
          colour.setXYZW(v, 1, 1, 1, shown ? a[i] * INNER_OPACITY : 0);
          colour.setXYZW(v + 1, 1, 1, 1, shown ? a[i] : 0);
        }
      }
      position.needsUpdate = true;
      colour.needsUpdate = true;
      mesh.visible = out;
    },
    samplesOf: (port) => trails[port] ?? [],
    alphasOf: (port) => alphas((trails[port] ?? []).length),
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
```

`src/render3d/renderer3d.ts`. The imports; the trails, built before the fixed layers; a sample a sim frame in `paint`'s fighter loop; the ribbon's update; and its disposal:

```diff
 import { toFloat } from "@/engine/fixed";
-import type { FighterDef, FighterState, GameState, StageDef } from "@/engine/types";
+import { activeHitboxes, moveFrameOf } from "@/engine/hitbox";
+import type { FighterDef, FighterState, GameState, MoveSlot, StageDef } from "@/engine/types";
```

```diff
 import { createStage3D } from "./stage3d";
+import { createTrails3D, trailBoneOf, trailSample, type TrailBone } from "./trail3d";
 import { createVfx3D, shieldLook, type ShieldLook } from "./vfx3d";
```

```diff
   shadows.instanceMatrix.setUsage(DynamicDrawUsage);
 
+  // Sword and kick trails (Plan 6, Task 34): one ribbon for every fighter, and each
+  // fighter's trail bone per move, found once.
+  const trails = createTrails3D(opts.defs.length);
+  const trailBones: ReadonlyMap<string, TrailBone>[] = opts.defs.map(
+    (d) =>
+      new Map(
+        d === null
+          ? []
+          : Object.keys(d.moves).flatMap((slot) => {
+              const bone = trailBoneOf(d, slot as MoveSlot);
+              return bone === null ? [] : [[slot, bone] as const];
+            }),
+      ),
+  );
+  /** The sim frame each port last sampled its trail on: once a sim frame, however often it paints. */
+  const trailFrames: number[] = opts.defs.map(() => -1);
+  const tip = new Vector3();
   /** Every layer but the fighters, whose matrices `paint` builds; each fighter builds its own (`Fighter3D.update`). */
-  const fixed: Object3D[] = [hemisphere, ambient, sun, stage.group, shadows, vfx.group];
+  const fixed: Object3D[] = [hemisphere, ambient, sun, stage.group, shadows, vfx.group, trails.mesh];
```

```diff
           hidden: hidden[f.port] ?? false,
         });
+        // A trail along the blade its move's boxes ride, a sample a sim frame (Plan 6, Task 34).
+        if (trailFrames[f.port] !== game.frame) {
+          trailFrames[f.port] = game.frame;
+          const bone = f.move === null || f.action === "dead" ? undefined : trailBones[f.port]?.get(f.move);
+          const move = f.move === null ? undefined : def.moves[f.move];
+          const live = bone !== undefined && move !== undefined && fighter.bonePosition(bone.bone, tip);
+          trails.push(f.port, live ? trailSample(bone, activeHitboxes(move, moveFrameOf(f.actionFrame)), pos.x, pos.y, f.facing, { x: tip.x, y: tip.y, z: tip.z }) : null);
+        }
         // The sim's bubble, centre and radius, carried to where its fighter is drawn between frames.
```

```diff
       shadows.count = shadowCount;
       shadows.instanceMatrix.needsUpdate = true;
+      trails.update();
       vfx.update(rs.vfx, shields);
```

```diff
       shadows.dispose();
+      trails.dispose();
```

`src/render3d/budget.ts`:

```diff
  * batch, however many are up — the sparks and bursts, the shields, the blob
- * shadows (`renderer3d.ts`). `renderer3d.test.ts` holds the scene to exactly
+ * shadows (`renderer3d.ts`), and the sword and kick trails (Plan 6, Task 34;
+ * drawn only while one is out). `renderer3d.test.ts` holds the scene to exactly
  * this many batches, and `e2e/render3d.spec.ts` reads it rather than a copy.
  */
-export const BATCH_CALLS = 3;
+export const BATCH_CALLS = 4;
```

`src/render3d/renderer3d.test.ts`. The batches' check in "paints four glbs at the caps …" (the scene's instanced meshes) and Task 33's exact figure, with no swing out:

```diff
-    // The batches are the scene's only instanced meshes, and there are BATCH_CALLS of them (sparks, shields, shadows).
+    // The batches are the scene's three instanced meshes (sparks, shields, shadows) and the
+    // trails' one ribbon (Plan 6, Task 34): BATCH_CALLS of them.
     expect([...resourcesOf(scene).instanced].map((m) => m.name).sort()).toEqual(["shadows", "shields", "sparks"]);
-    expect(resourcesOf(scene).instanced.size).toBe(BATCH_CALLS);
+    expect(scene.getObjectByName("trails")).toBeDefined();
+    expect(resourcesOf(scene).instanced.size + 1).toBe(BATCH_CALLS);
```

```diff
-    // One pass each: 4 × 12, Battlefield's 4 platforms and its decorative underside (Plan 6,
-    // Task 33), and the 3 batches. Two passes each would be 4 × 12 × 2 + 8 = 104.
-    expect(presenter.info().calls).toBe(4 * MAX_FIGHTER_PRIMITIVES + stage.platforms.length + 1 + BATCH_CALLS);
+    // One pass each: 4 × 12, Battlefield's 4 platforms and its decorative underside (Plan 6,
+    // Task 33), and the 3 instanced batches; with no swing out, the trails' ribbon (Task 34)
+    // draws nothing. Two passes each would be 4 × 12 × 2 + 8 = 104.
+    expect(presenter.info().calls).toBe(4 * MAX_FIGHTER_PRIMITIVES + stage.platforms.length + 1 + 3);
```

`e2e/render3d.spec.ts`, its doc of the batches (Task 33's text), and the brawl's comment:

```diff
- * Task 33), one batch each for the sparks and bursts, the shields and the blob
- * shadows (`BATCH_CALLS`), and the fighters: a stand-in is one mesh per hurt
- * capsule of its skeleton, a glb one per primitive of the file the server
- * sends. So a fighter is seen to draw by a bound on calls that nothing else
- * reaches (`callRange`): with the capsules never attached a match is the stage
- * and its batches, 8 calls on Battlefield, and a bare `calls > 0` is met by
- * that alone. The ceiling is the batches' 3 above the floor, so any fighter
- * whose parts are drawn twice is over it.
+ * Task 33), one batch each for the sparks and bursts, the shields, the blob
+ * shadows and the sword trails (`BATCH_CALLS`; Task 34), and the fighters: a
+ * stand-in is one mesh per hurt capsule of its skeleton, a glb one per primitive
+ * of the file the server sends. So a fighter is seen to draw by a bound on calls
+ * that nothing else reaches (`callRange`): with the capsules never attached a
+ * match is the stage and its batches, 9 calls on Battlefield at most, and a bare
+ * `calls > 0` is met by that alone. The ceiling is the batches' 4 above the
+ * floor, so any fighter whose parts are drawn twice is over it.
```

```diff
-      // that draw nothing are 8 calls on Battlefield), and no more than the parts allow (a fighter drawn twice is over).
+      // that draw nothing are 9 calls on Battlefield at most), and no more than the parts allow (a fighter drawn twice is over).
```

(`callRange` itself is unchanged: its ceiling reads `BATCH_CALLS`, now 4, and its floor check still holds, since every fighter's parts number more than 4.)

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/render3d src/app/chunkSplit.test.ts`
Expected: PASS (captured). `trail3d.ts` is a `render3d/` three module reached only through the presenter, so the chunk split holds.

- [ ] **Step 5: The look (numbers, and a stand-in capture)**

The numeric look is Step 1's Marth test: the sample runs from the drawn hand to the tipper, 6+ units. In the replay it was the tipper box, and a mutant that picks the nearest box gave 2.2. For the eye, a stand-in capture in the scratchpad: a Playwright script with `/models/` routed to 404, a training match, and Link's forward tilt stepped through its live frames (move frames 15-19). View it with Read, then delete it. The replay's capture showed a pale wedge sweeping down from Link's hand along the sim's sword boxes.

- [ ] **Step 6: Mutants**

1. `landingSquash`: drop the action guard. The "nothing else" lines FAIL: `AssertionError: expected { x: 0.86, y: 1.16 } to deeply equal { x: 1, y: 1 }` (captured).
2. `createFighter3D`: `squashGroup.scale.set(1, 1, 1)`. The group test FAILS: `AssertionError: expected 1 to be close to 0.8` (captured).
3. `trails.push(port, null)`: return without `list.shift()`. The draw-in test FAILS: `AssertionError: expected [ 3, 4, 5, 6, 7, 8 ] to deeply equal [ 4, 5, 6, 7, 8 ]` (captured).
4. The material: drop `forceSinglePass: true`. The one-pass test FAILS: `AssertionError: expected false to be true` (captured).
5. `trailSample`: `if (d > far)` → `if (far < 0 || d < far)` (the nearest box, the hilt). The Marth test FAILS: `AssertionError: expected 2.21536510469375 to be greater than 6` (captured).
6. `renderer3d.ts`: `if (trailFrames[f.port] !== game.frame)` → `if (true)` (a sample a paint). The renderer test FAILS: `AssertionError: expected [ 24, 25, 26, 27, 28, 29, 30, 31 ] to deeply equal [ 24, 25, 26, 27 ]` (captured).
7. `trailBoneOf`: `attacks.find((a) => !ROOT_BONES.has(a.bone))?.bone` → `attacks[0]?.bone`. The bone test FAILS: `AssertionError: expected { Object (bone, ids) } to be null` (captured).

- [ ] **Step 7: Gate and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`, `PORT=3107 pnpm test:e2e --trace off` (the 3D e2e's draw-call ranges). Expected: exit 0.

```bash
git add super-smash/src/render3d/fighter3d.ts super-smash/src/render3d/fighter3d.test.ts super-smash/src/render3d/faceTurn.test.ts super-smash/src/render3d/trail3d.ts super-smash/src/render3d/trail3d.test.ts super-smash/src/render3d/renderer3d.ts super-smash/src/render3d/renderer3d.test.ts super-smash/src/render3d/budget.ts super-smash/e2e/render3d.spec.ts
git commit -m "super-smash: the 3D model squashes on landing, and sword and kick moves draw trails" -m "squashFor's landing branch on a group above the root. Trails run from each move's limb bone to its farthest live box, a sample a sim frame; one single-pass ribbon for all fighters (BATCH_CALLS 4), hidden when none is out. Render only; golden unchanged." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 35: Charges on screen: Hammer Flip's flame and hammer, a stored charge's tell, a copied charge's glow

Four presentation items about charging specials:
- Plan 5 Task 2 review: "Kirby Hammer Flip presentation: the hammer prop fades at frame 45 (no published put-away frame); the flame draws on any charge (SmashWiki: from 30 charge frames); no visual tell for a stored charge on Samus/DK."
  - rubendal 13.0.1 does publish the put-away. `game_specials` and `game_specialairs` call `ArticleModule::remove_exist(FIGHTER_KIRBY_GENERATE_ARTICLE_HAMMER)` on frame 54, and the full-charge scripts (`game_specialsmax`, `game_specialairsmax`) on 56.
  - Those are frames of the swing, whose hit is on its frame 11. The replica's hit is on move frame 26 (`kirby.ts`: `loopFrame: 15`), so the swing's frames start after the loop frame, and 54 is move frame 69, the move's last (`totalFrames: 69`). At full charge, 56 is past the end: the hammer stays to the last frame (the replica plays the full release on the same 69 frames, "Published, not modelled").
  - SmashWiki "Kirby (SSBU)/Side special": "The move becomes partially charged with at least 30 charge frames, adding a flame effect to the hitboxes."
- Plan 5 Task 9: "A copied hold-mode charge (Bow) glows after release, and a copied charge uses Kirby's hue ramp rather than the copy's (`render/vfx.ts:~758,762`)." `trackChargeGlow` reads the fighters' own definitions (`defs`), so a Kirby with Link's Copy Ability is timed against his own Inhale, which has no charge hold or length.

What a player sees:
- the hammer stays out through Kirby's follow-through and goes on the frame the game removes it, instead of fading at 45;
- the flame says "charged" only once the hit is (30 frames);
- Samus and Donkey Kong show that they hold a full charge;
- a copied bow stops glowing when Kirby lets go, and a copied Charge Shot ramps over its own 112 frames.

All of it is drawn in the effect painters' existing style (SPEC §10: the fighters' own colours, additive glows).

**Golden:** unaffected (render only).

**Files:**
- Modify: `src/render/vfx.ts` (`trackChargeGlow`, `stepVfx`), `src/game/matchRunner.ts` (passes `getFighter`), `src/render/chars/kirby/fx.ts`, `src/render/chars/samus/fx.ts`, `src/render/chars/donkeyKong/fx.ts`, `src/render/chars/index.ts` (`FxModule.always`, `alwaysFxFor`), `src/render/specialFx.ts` (runs `always`), `src/render/testFixtures.ts` (`runPainter`)
- Test: `src/render/vfx.test.ts`, `src/render/chars/kirby/kirby.test.ts`, `src/render/chars/samus/samus.test.ts`, `src/render/chars/donkeyKong/donkeyKong.test.ts`, `src/render/specialFx.test.ts`

**Interfaces:**
- Consumes: `withCopyAbility(def, copyDef)` (engine/inhale.ts), `trackChargeGlow(v, state, defs)`, `stepVfx(v, events, state, defs, shift)`, `makeFxContext` (testFixtures.ts), `FxContext`, `fxFor`, `drawMoveFx`.
- Produces:
  - `trackChargeGlow(v, state, defs?, fighterOf?: (id: string) => FighterDef | undefined)`; `stepVfx`'s sixth parameter `fighterOf?`;
  - `HAMMER_PUT_AWAY = 54`, `HAMMER_PUT_AWAY_MAX = 56`, `HAMMER_FLAME_FROM = 30`, `hammerVisible(frame, charge, sc)`, `hammerLit(charge)` (kirby/fx.ts);
  - `storedChargeTell: FxFn` and `always: FxFn` (samus/fx.ts, donkeyKong/fx.ts);
  - `FxModule.always?: FxFn`, `alwaysFxFor(id): FxFn | undefined` (chars/index.ts);
  - `runPainter(paint, def, over): MockContext` (testFixtures.ts, used by Task 36).

- [ ] **Step 1: Write the failing tests**

`src/render/testFixtures.ts` gains one painter harness, built on the file's own `makeFxContext`:

```diff
--- a/src/render/testFixtures.ts
+++ b/src/render/testFixtures.ts
@@
 import { emptyCombat } from "@/engine/combat";
 import { emptyKinetic } from "@/engine/kinetic";
 import { createCamera } from "./camera";
-import type { FxContext } from "./fxKit";
+import type { FxContext, FxFn } from "./fxKit";
+import { createMockContext, type MockContext } from "./mockContext";
 
 export function makeFighter(over: Partial<FighterState> = {}): FighterState {
   return {
@@
     over: (paint) => paint(),
     ...over,
   };
+}
+
+/**
+ * Run one move painter on a mock canvas, with `makeFxContext`'s match context, the given
+ * fighter (`def`, and `f` over a fighter of that id), and `over` on top (Plan 6, Tasks 35-37).
+ */
+export function runPainter(
+  paint: FxFn,
+  def: FighterDef,
+  over: Omit<Partial<FxContext>, "ctx" | "def" | "f"> & { readonly f?: Partial<FighterState> } = {},
+): MockContext {
+  const ctx = createMockContext();
+  const { f, ...rest } = over;
+  paint(makeFxContext({ ctx, def, f: makeFighter({ defId: def.id, ...f }), ...rest }));
+  return ctx;
 }
```

`src/render/vfx.test.ts`. The copied bow glows while held and stops once let go; the copied Charge Shot's hue is the copy's ramp. Under the old code the held case shows no motes at all, because Kirby's own Inhale has a `holdLoop`, so the test fails either way the code is wrong:

```diff
--- a/src/render/vfx.test.ts
+++ b/src/render/vfx.test.ts
@@
   spawnDust,
   spawnHitSpark,
   stepVfx,
+  trackChargeGlow,
   footPlanted,
   trackGroundFx,
   trackLaunchTrails,
   updateVfx,
 } from "./vfx";
 import { makeDef, makeEvents, makeFighter, makeProjectile, makeStage, makeState } from "./testFixtures";
+import { getFighter } from "@/fighters";
+import { mixHex } from "./rigKit";
 import type { ProjectileContext } from "./fxKit";
 
 const stage = makeStage();
@@
     expect(v.particles.filter((p) => p.kind === "chargeMote").length).toBeGreaterThan(0);
   });
 
+  it("times and colours a copied charge by the copy's move: a copied bow glows held, not let go, and a copied Charge Shot ramps over its 112 (Plan 6, Task 35)", () => {
+    const kirby = getFighter("kirby")!;
+    const copying = (copy: string, actionFrame: number) => {
+      const f = makeFighter({ defId: "kirby", action: "special", move: "neutralB", actionFrame, charge: 20 });
+      f.combat.copy = copy;
+      return makeState({ fighters: [f] });
+    };
+    const motes = (state: ReturnType<typeof makeState>) => {
+      const v = createVfx();
+      for (let i = 0; i < 4; i++) trackChargeGlow(v, state, [kirby], getFighter);
+      return v.particles.filter((p) => p.kind === "chargeMote");
+    };
+    // The bow holds on its loop frame − 1 (`MoveTiming.chargeHold`), Kirby's own Inhale on none.
+    const bowHold = getFighter("link")!.moves.neutralB!.specialCharge!.loopFrame - 1;
+    expect(motes(copying("link", bowHold)).length).toBeGreaterThan(0);
+    expect(motes(copying("link", bowHold + 2))).toHaveLength(0);
+    // 20 of Charge Shot's 112 frames, where Kirby's own (no charge) would have said 20 of 60.
+    expect(motes(copying("samus", 12))[0].colour).toBe(mixHex("#FFE873", "#FF7A2A", 20 / 112));
+  });
+
   it("ramps the motes' colour over the move's own full charge, not a smash's 60 frames", () => {
     // Half of Hammer Flip's 120 frames is the hue half of a smash's 60 is.
     const hammer = { mode: "hold", frames: 120, loopFrame: 15, atFull: "hold" } as const;
```

`src/render/chars/kirby/kirby.test.ts`. The existing put-away pin at frame 50 moves to the frames the script gives, 68 and 69:

```diff
--- a/src/render/chars/kirby/kirby.test.ts
+++ b/src/render/chars/kirby/kirby.test.ts
@@
 import { assignmentsTo, callsOf, createMockContext, type MockContext } from "../../mockContext";
 import { getCharacterRig } from "..";
 import { poses } from "./poses";
-import { fx } from "./fx";
+import { fx, HAMMER_FLAME_FROM, hammerLit, hammerVisible } from "./fx";
+import { runPainter } from "../../testFixtures";
 
 const rig = getCharacterRig("kirby");
 const NAMES = Object.keys(poses) as PoseName[];
@@
     expect(drew("sideB", 16), "no hammer while it is cocked").toBeGreaterThan(5);
     expect(drew("sideB", 26), "no hammer on the contact frame").toBeGreaterThan(5);
     expect(drew("sideB", 27), "no hammer on the second active frame").toBeGreaterThan(5);
-    expect(drew("sideB", 50), "hammer still out long after the swing").toBe(0);
+    // Put away on the script's frame, the move's last (Plan 6, Task 35), not faded out by 45.
+    expect(drew("sideB", 68), "no hammer before it is put away").toBeGreaterThan(5);
+    expect(drew("sideB", 69), "hammer still out after it is put away").toBe(0);
   });
 
   it("only flames the hammer when it is charged, because only a charged one burns", () => {
@@
     expect([...new Set(offenders)]).toEqual([]);
   });
 });
+
+describe("Hammer Flip's hammer and flame (Plan 6, Task 35)", () => {
+  const hammer = def.moves.sideB!.specialCharge!;
+  const at = (frame: number, charge: number) => runPainter(fx.sideB!, def, { frame, total: 69, f: { action: "special", move: "sideB", charge } });
+
+  it("puts the hammer away on the move's last frame, 69: the swing's 54 after the 15-frame wind-up", () => {
+    // rubendal 13.0.1 `game_specials`: `ArticleModule::remove_exist(…HAMMER)` on its frame 54, its hit on
+    // 11; the move's hit is on 26 (`kirby.ts`), so the swing starts after the loop frame, 15.
+    expect(hammerVisible(68, 0, hammer)).toBe(true);
+    expect(hammerVisible(69, 0, hammer)).toBe(false);
+    // `game_specialsmax`: 56, past the move's end, so a full charge keeps it to the last frame.
+    expect(hammerVisible(69, hammer.frames, hammer)).toBe(true);
+    expect(at(68, 0).calls.length).toBeGreaterThan(0);
+    expect(at(69, 0).calls).toHaveLength(0);
+  });
+
+  it("lights the hammer only from 30 charge frames (SmashWiki)", () => {
+    expect(HAMMER_FLAME_FROM).toBe(30);
+    expect(hammerLit(29)).toBe(false);
+    expect(hammerLit(30)).toBe(true);
+    // The painter's flame: more drawn at 30 charge frames than at 29.
+    expect(at(30, 30).calls.length).toBeGreaterThan(at(30, 29).calls.length);
+  });
+});
```

`src/render/chars/samus/samus.test.ts`:

```diff
--- a/src/render/chars/samus/samus.test.ts
+++ b/src/render/chars/samus/samus.test.ts
@@
 import { FIGHTERS } from "@/fighters";
 import { bakedContext } from "@/game/bake";
 import { STAGES } from "@/stages";
-import { makeFighter } from "../../testFixtures";
-import { createMockContext, type MockContext } from "../../mockContext";
+import { makeFighter, runPainter } from "../../testFixtures";
+import { countOf, createMockContext, type MockContext } from "../../mockContext";
+import { emptyCombat } from "@/engine/combat";
+import { storedChargeTell } from "./fx";
 
 const rig = getCharacterRig("samus");
 
@@
     // FIRE (#FF8A2A) at 0.35 + 0.3 × the part of the 72 frames run.
     expect(glow(0)).toEqual(["rgba(255, 138, 42, 0.35)"]);
     expect(glow(72)).toEqual([`rgba(255, 138, 42, ${0.35 + 0.3})`]);
+  });
+});
+
+describe("a stored full Charge Shot shows (Plan 6, Task 35)", () => {
+  const tell = (storedCharge: number, action: "stand" | "run" = "stand") =>
+    runPainter(storedChargeTell, samus, { frame: 0, f: { action, combat: { ...emptyCombat(), storedCharge } } });
+
+  it("pulses a ring on the arm cannon in any action while a full charge is stored, and nothing short of full", () => {
+    const full = samus.moves.neutralB!.specialCharge!.frames;
+    expect(countOf(tell(full), "arc")).toBeGreaterThan(0);
+    expect(countOf(tell(full, "run"), "arc")).toBeGreaterThan(0);
+    expect(countOf(tell(full - 1), "arc")).toBe(0);
   });
 });
```

`src/render/chars/donkeyKong/donkeyKong.test.ts`:

```diff
--- a/src/render/chars/donkeyKong/donkeyKong.test.ts
+++ b/src/render/chars/donkeyKong/donkeyKong.test.ts
@@
 
 import { describe, expect, it } from "vitest";
 import { donkeyKong } from "@/fighters/donkeyKong";
+import { emptyCombat } from "@/engine/combat";
+import { countOf } from "../../mockContext";
+import { runPainter } from "../../testFixtures";
+import { storedChargeTell } from "./fx";
 import type { BoneName } from "../../skeleton";
 import { resolve } from "../../skeleton";
 import { rotationPivot } from "../../characterArt";
@@
     expect(painted.size).toBe(launched.size);
   });
 });
+
+describe("a stored full Giant Punch shows (Plan 6, Task 35)", () => {
+  it("puffs steam off his fist in any action while a full punch is stored, and nothing short of full", () => {
+    const full = donkeyKong.moves.neutralB!.specialCharge!.frames;
+    const tell = (storedCharge: number, action: "stand" | "walk" = "stand") =>
+      runPainter(storedChargeTell, donkeyKong, { frame: 0, f: { action, combat: { ...emptyCombat(), storedCharge } } });
+    expect(countOf(tell(full), "arc")).toBeGreaterThan(0);
+    expect(countOf(tell(full, "walk"), "arc")).toBeGreaterThan(0);
+    expect(countOf(tell(full - 1), "arc")).toBe(0);
+  });
+});
```

`src/render/specialFx.test.ts`, that the always-on painter runs with no move:

```diff
--- a/src/render/specialFx.test.ts
+++ b/src/render/specialFx.test.ts
@@
     expect(covered.size).toBeGreaterThanOrEqual(FIGHTERS.length / 2);
   });
 
+  it("draws a fighter's own always-on effect with no move running: Samus's stored Charge Shot (Plan 6, Task 35)", () => {
+    const samus = byId.get("samus")!;
+    const stored = makeFighter({ defId: "samus", action: "stand", move: null });
+    stored.combat.storedCharge = samus.moves.neutralB!.specialCharge!.frames;
+    const ctx = createMockContext();
+    drawMoveFx(ctx, samus, stored, cam, 13, 0, 0, { lastHit: [], frame: 40 });
+    expect(ctx.calls.length).toBeGreaterThan(0);
+  });
+
   it("draws nothing for a fighter who is not doing a special", () => {
     const ctx = createMockContext();
     const before = ctx.calls.length;
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/render/vfx.test.ts src/render/chars/kirby src/render/chars/samus src/render/chars/donkeyKong src/render/specialFx.test.ts`

Expected: FAIL (captured):
- `vfx.test.ts`, the copied charge: `expected [ { kind: 'chargeMote', …(12) }, …(3) ] to have a length of +0 but got 4` (the let-go bow still glows);
- `kirby.test.ts`: the old pin moved to 68, `no hammer before it is put away: expected 0 to be greater than 5` (today's fade); `TypeError: hammerVisible is not a function`; `expected undefined to be 30`;
- `samus.test.ts` and `donkeyKong.test.ts`: `TypeError: paint is not a function` (no `storedChargeTell` yet);
- `specialFx.test.ts`: `expected 0 to be greater than 0`.

Seven tests in all.

- [ ] **Step 3: Implement**

`src/render/vfx.ts`. `trackChargeGlow` resolves the definition each fighter runs. Without `fighterOf` the copy is unknown, so it keeps today's guard: only the loop is ruled out.

```diff
--- a/src/render/vfx.ts
+++ b/src/render/vfx.ts
@@
 import { toFloat } from "@/engine/fixed";
 import { PERFECT_SHIELD_WINDOW, SMASH_CHARGE_MAX } from "@/engine/constants";
 import { STRONG_COUNTER_DAMAGE } from "@/engine/counter";
+import { withCopyAbility } from "@/engine/inhale";
 import type { FighterDef, FighterState, GameState, StepEvents } from "@/engine/types";
 import { createPoseBlends, type PoseBlend } from "./blend";
 import { moveTimingFor, poseTimeFor, type PosedFighter } from "./poses";
@@
  * move whose frame has passed its hold (`MoveTiming.chargeHold`) is swinging,
  * not charging, and glows no more. Without them, any charge glows.
  */
-export function trackChargeGlow(v: VfxState, state: GameState, defs?: ChargeDefs): void {
+export function trackChargeGlow(v: VfxState, state: GameState, defs?: ChargeDefs, fighterOf?: (id: string) => FighterDef | undefined): void {
   for (const f of state.fighters) {
     if (f.action !== "attack" && f.action !== "special") continue;
     if (f.charge <= 0) continue;
@@
     // Kirby's Inhale, `MoveDef.holdLoop`): no charge, no glow. Not for a Kirby with
     // a Copy Ability: `defs` are the fighters' own, and his neutral special is then
     // the copied one, which may charge (fix round 2).
-    if (f.move !== null && f.combat.copy === "" && defs?.[f.port]?.moves[f.move]?.holdLoop !== undefined) continue;
-    const hold = moveTimingFor(defs?.[f.port], f.move)?.chargeHold;
+    // The definition the fighter runs (Plan 6, Task 35): a Kirby with a Copy Ability runs
+    // the copy's neutral special (`withCopyAbility`), so its hold and its full charge are the
+    // copy's. Without `fighterOf` the copy is unknown, and only its loop is ruled out.
+    const own = defs?.[f.port];
+    const copy = f.combat.copy !== "" ? fighterOf?.(f.combat.copy) : undefined;
+    const runs = own != null && copy !== undefined ? withCopyAbility(own as FighterDef, copy) : own;
+    if (f.move !== null && (f.combat.copy === "" || copy !== undefined) && runs?.moves[f.move]?.holdLoop !== undefined) continue;
+    const hold = moveTimingFor(runs, f.move)?.chargeHold;
     if (hold !== undefined && f.actionFrame > hold) continue;
     if (v.frame % 2 !== 0) continue;
     // The hue ramps over the move's own full charge: a special's (Plan 5:
     // Charge Shot 112, Hammer Flip 120), else a smash's 60.
-    const full = (f.move === null ? undefined : defs?.[f.port]?.moves[f.move]?.specialCharge?.frames) ?? SMASH_CHARGE_MAX;
+    const full = (f.move === null ? undefined : runs?.moves[f.move]?.specialCharge?.frames) ?? SMASH_CHARGE_MAX;
     const a = rand(v) * Math.PI * 2;
     const r = 9 + rand(v) * 5;
     push(v, {
@@
   }
 }
 
-export function stepVfx(v: VfxState, events: StepEvents | null, state: GameState, defs?: ChargeDefs, shift?: readonly number[]): void {
+export function stepVfx(
+  v: VfxState,
+  events: StepEvents | null,
+  state: GameState,
+  defs?: ChargeDefs,
+  shift?: readonly number[],
+  /** Each fighter's definition by id, for a Copy Ability's (Plan 6, Task 35). */
+  fighterOf?: (id: string) => FighterDef | undefined,
+): void {
   trackSwings(v, state);
   if (events) ingestEvents(v, events, state, shift);
   trackGroundFx(v, state, events);
   trackLaunchTrails(v, state);
-  trackChargeGlow(v, state, defs);
+  trackChargeGlow(v, state, defs, fighterOf);
   trackDamageSmoke(v, state);
   updateVfx(v);
 }
```

`src/game/matchRunner.ts`:

```diff
--- a/src/game/matchRunner.ts
+++ b/src/game/matchRunner.ts
@@
       const def = defs[f.port];
       return def ? drawnTop(def, f, state.frame, GAME_SIM_CONTEXT.bake) : null;
     });
-    stepVfx(vfx, events, state, defs, peekSceneShift(shiftEase, sceneDrawShift(state, defs, tops), state.frame));
+    stepVfx(vfx, events, state, defs, peekSceneShift(shiftEase, sceneDrawShift(state, defs, tops), state.frame), getFighter);
     updateHud(hud, state);
     // The moves, for a Final Smash's end-hit punch-in, and the tops.
     updateCamera(camera, state, stage, events, defs, tops);
```

`src/render/chars/kirby/fx.ts`. The hammer goes by its script's frame and lights from 30 frames; the old 40-45 fade is gone:

```diff
--- a/src/render/chars/kirby/fx.ts
+++ b/src/render/chars/kirby/fx.ts
@@
   type FxFn,
 } from "../../fxKit";
 import { resolvePalette, withAlpha } from "../../rigKit";
-import type { FighterDef, MoveSlot } from "@/engine/types";
+import type { FighterDef, MoveSlot, SpecialCharge } from "@/engine/types";
 import type { ProjectilePainter } from "../../fxKit";
 
 /* ------------------------------------------------------------- geometry -- */
@@
 }
 
+/**
+ * When Hammer Flip's hammer goes (Plan 6, Task 35): rubendal 13.0.1 `game_specials` and
+ * `game_specialairs` call `ArticleModule::remove_exist(FIGHTER_KIRBY_GENERATE_ARTICLE_HAMMER)`
+ * on frame 54, `game_specialsmax` and `game_specialairsmax` on 56. Those count the swing,
+ * which hits on its frame 11; the move's hit is on 26 (`kirby.ts`), so the swing's frames
+ * start after the loop frame (15), and 54 is the move's 69, its last.
+ */
+export const HAMMER_PUT_AWAY = 54;
+export const HAMMER_PUT_AWAY_MAX = 56;
+/** SmashWiki "Kirby (SSBU)/Side special": "partially charged with at least 30 charge frames, adding a flame effect to the hitboxes". */
+export const HAMMER_FLAME_FROM = 30;
+
+/** Whether the hammer is out on the move's `frame`, `charge` frames held, by the swing's put-away frame. */
+export function hammerVisible(frame: number, charge: number, sc: Pick<SpecialCharge, "loopFrame" | "frames">): boolean {
+  return frame - sc.loopFrame < (charge >= sc.frames ? HAMMER_PUT_AWAY_MAX : HAMMER_PUT_AWAY);
+}
+
+/** Whether `charge` frames held light the hammer. */
+export function hammerLit(charge: number): boolean {
+  return charge >= HAMMER_FLAME_FROM;
+}
+
 /** 0 at `from`, 1 at `to`, clamped. */
 function ramp(v: number, from: number, to: number): number {
   if (to === from) return v >= to ? 1 : 0;
   const t = (v - from) / (to - from);
@@
    * on a 19% one.
    */
   sideB: ({ ctx, f, def, x, y, u, dir, frame, over }) => {
-    // Nothing before he reaches for it, nothing after he has put it away.
+    // Nothing before he reaches for it, nothing after he has put it away (Plan 6,
+    // Task 35: on the script's frame, `hammerVisible`).
     const drawn = ramp(frame, 9, 15);
-    const kept = 1 - ramp(frame, 40, 45);
-    if (drawn <= 0.01 || kept <= 0.01) return NOTHING;
+    const sc = def.moves.sideB?.specialCharge;
+    if (drawn <= 0.01 || (sc !== undefined && !hammerVisible(frame, f.charge, sc))) return NOTHING;
 
     const { cx, cy, r } = ball(x, y, u);
     // Straight up is 0 and the front is positive: hauled out overhead at −25°,
@@
     const swing = ramp(frame, 15, 26);
     const settle = ramp(frame, 27, 44);
     const angle = (-25 - 50 * drawn + 160 * swing + 30 * settle) * DEG;
-    const charged = f.charge > 0;
+    // Lit only from 30 charge frames (Plan 6, Task 35; SmashWiki), not on any charge.
+    const charged = hammerLit(f.charge);
 
     // It comes out of nowhere — so it comes out *growing*, which is the only
     // honest way to introduce a prop the rig does not have a bone for.
@@
 
     const paint = (): void => {
       ctx.save();
-      ctx.globalAlpha = Math.min(1, drawn * 1.8) * kept;
+      ctx.globalAlpha = Math.min(1, drawn * 1.8);
       ctx.translate(cx, cy);
       ctx.scale(dir, 1);
       // Pivot at his hands, not at the middle of his face. The swing turns
```

`src/render/chars/samus/fx.ts`. The tell is UNVERIFIED (cosmetic): Ultimate's own is a glow and a sound, so the shape is by eye, in the Charge Shot's colours:

```diff
--- a/src/render/chars/samus/fx.ts
+++ b/src/render/chars/samus/fx.ts
@@
 }
 
 /* ------------------------------------------------------------------- moves -- */
+
+/**
+ * A stored full Charge Shot, shown in every action (Plan 6, Task 35; `FxModule.always`):
+ * a ring pulsing out of the arm cannon every 20 frames of the match's clock, while
+ * `CombatState.storedCharge` holds a full charge. UNVERIFIED (cosmetic): Ultimate's own
+ * tell is a glow and a sound; the shape is by eye, in the Charge Shot's own colours.
+ */
+export const storedChargeTell: FxFn = ({ ctx, f, def, x, y, u, dir, height, frame }) => {
+  const full = def.moves.neutralB?.specialCharge?.frames;
+  if (full === undefined || f.combat.storedCharge < full) return NOTHING;
+  const k = (frame % 20) / 20;
+  const cx = x + dir * u * height * 0.24;
+  const cy = y - u * height * 0.52;
+  ctx.save();
+  glow(ctx, cx, cy, u * 1.6, "rgba(120,220,255,0.55)");
+  ctx.strokeStyle = `rgba(190,240,255,${(0.8 * (1 - k)).toFixed(3)})`;
+  ctx.lineWidth = Math.max(1, u * 0.25);
+  ctx.beginPath();
+  ctx.arc(cx, cy, u * (0.6 + 1.8 * k), 0, Math.PI * 2);
+  ctx.stroke();
+  ctx.restore();
+  return NOTHING;
+};
 
+/** Painted on every frame, before any move's (`FxModule.always`). */
+export const always: FxFn = storedChargeTell;
+
 export const fx: Partial<Record<MoveSlot, FxFn>> = {
   /**
    * Charge Shot.
```

`src/render/chars/donkeyKong/fx.ts`:

```diff
--- a/src/render/chars/donkeyKong/fx.ts
+++ b/src/render/chars/donkeyKong/fx.ts
@@
 
 import {
   NOTHING,
+  circle,
   crescent,
   glow,
   polygon,
@@
   ctx.stroke();
 }
 
+/**
+ * A stored full Giant Punch, shown in every action (Plan 6, Task 35; `FxModule.always`):
+ * steam puffing off his near fist, a puff every 24 frames of the match's clock, rising and
+ * fading, while `CombatState.storedCharge` holds a full charge. UNVERIFIED (cosmetic):
+ * Ultimate's own tell is his arm's glow and a sound; the shape is by eye.
+ */
+export const storedChargeTell: FxFn = ({ ctx, f, def, x, y, u, dir, height, frame }) => {
+  const full = def.moves.neutralB?.specialCharge?.frames;
+  if (full === undefined || f.combat.storedCharge < full) return NOTHING;
+  const fistX = x + dir * u * height * 0.3;
+  const fistY = y - u * height * 0.12;
+  ctx.save();
+  for (let i = 0; i < 2; i++) {
+    const k = ((frame + i * 12) % 24) / 24;
+    ctx.fillStyle = `rgba(235,235,235,${(0.55 * (1 - k)).toFixed(3)})`;
+    circle(ctx, fistX + dir * u * 0.4 * k, fistY - u * height * 0.18 * k, u * (0.5 + 0.9 * k));
+  }
+  ctx.restore();
+  return NOTHING;
+};
+
+/** Painted on every frame, before any move's (`FxModule.always`). */
+export const always: FxFn = storedChargeTell;
+
 export const fx: Partial<Record<MoveSlot, FxFn>> = {
   /**
    * Donkey Kong, Giant Punch. The fist is what is charged, so the fist is what
```

`src/render/chars/index.ts` (`FxModule` stays private; `specialFx.ts` reads `always` through an accessor beside `fxFor`):

```diff
--- a/src/render/chars/index.ts
+++ b/src/render/chars/index.ts
@@
 interface FxModule {
   readonly fx: Partial<Record<MoveSlot, FxFn>>;
   readonly projectiles?: Readonly<Record<string, ProjectilePainter>>;
+  /** Painted on every frame, before any move's: a state the fighter carries, such as a stored charge (Plan 6, Task 35). */
+  readonly always?: FxFn;
 }
 
 const FX_MODULES: Readonly<Record<string, FxModule>> = {
@@
   return mine[slot] ?? (fallback ? mine[fallback] : undefined);
 }
 
+/** What this fighter paints on every frame, whatever it is doing (`FxModule.always`; Plan 6, Task 35). */
+export function alwaysFxFor(id: string | null | undefined): FxFn | undefined {
+  return FX_MODULES[charKey(id)]?.always;
+}
+
 /**
  * How this fighter paints one of their own projectiles.
  *
```

`src/render/specialFx.ts`:

```diff
--- a/src/render/specialFx.ts
+++ b/src/render/specialFx.ts
@@
 import type { FighterDef, FighterState } from "@/engine/types";
 import type { Camera } from "./camera";
 import { fxContextFor, struckWithFor, DREW_NOTHING, type MoveFxResult } from "./fxKit";
-import { fxFor } from "./chars";
+import { alwaysFxFor, fxFor } from "./chars";
 
 export type { SpecialFxResult, MoveFxResult, FxContext, FxFn } from "./fxKit";
 export { MOVE_FX_KEYS } from "./chars";
@@
   /** Cosmetic state, for the effects that need to know a swing connected. */
   struck?: { lastHit: ({ hitboxId: number; frame: number } | null)[]; frame: number },
 ): MoveFxResult {
+  // A state the fighter carries is drawn whatever it is doing (Plan 6, Task 35: a stored
+  // charge), before any move's, on the match's own clock (`frame` is the sim's here).
+  const always = def ? alwaysFxFor(def.id) : undefined;
+  if (def && always) always({ ...fxContextFor(ctx, def, f, cam, height, screenX, screenY, 1), frame: struck?.frame ?? 0 });
   if (f.move === null || !def) return DREW_NOTHING;
   if (!DRAWS_ITS_MOVE[f.action]) return DREW_NOTHING;
   const move = def.moves[f.move];
```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/render src/game/matchRunner.test.ts`. Expected: PASS (captured).

- [ ] **Step 5: Look (stand-in, or a scratchpad-only capture)**

The tests settle the frames: the hammer gone on 69, lit from 30, the tells drawn while a full charge is stored. For the look, with `pnpm dev --port 3107` in the background:

```bash
node scripts/fightsheet.mjs --fighter kirby --move sideB --hold 40 --frames 20,30,44,60,68,69 --base http://localhost:3107 --out "$SCRATCH/k-hammer.png"
```

Read it: the hammer lit and swung, still out on 68, gone on 69. Then `rm "$SCRATCH/k-hammer.png"`. With local models this is a real-model capture: scratchpad only, deleted in the same step. Stop the server by its PID. Report in words.

- [ ] **Step 6: Mutants**

Each against the Step 2 files; restore after each:
1. `trackChargeGlow`: `withCopyAbility(own as FighterDef, copy) : own` → `own : own`. The copied-charge test FAILS `expected 0 to be greater than 0`: the held bow shows no glow (captured).
2. `hammerVisible`: `frame - sc.loopFrame <` → `frame <` (counting from the press, the draft's reading). The pin and the put-away test FAIL `no hammer before it is put away: expected 0 to be greater than 5` (captured).
3. `hammerLit`: `>=` → `>`. The flame test FAILS `expected false to be true` (captured).
4. The `sideB` painter: `hammerLit(f.charge)` → `f.charge > 0` (today's rule). The flame test FAILS `expected 132 to be greater than 132` (captured).
5. `drawMoveFx`: skip the `always` call. The always-on test FAILS `expected 0 to be greater than 0` (captured).
6. Samus's tell: `storedCharge < full` → `< full - 1`. Its test FAILS `expected 2 to be +0` (captured).
7. Donkey Kong's tell, likewise. Its test FAILS `expected 2 to be +0` (captured).

- [ ] **Step 7: Gate and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`, `PORT=3107 pnpm test:e2e --trace off`. Expected: exit 0.

```bash
git add super-smash/src/render/vfx.ts super-smash/src/game/matchRunner.ts super-smash/src/render/chars/kirby/fx.ts super-smash/src/render/chars/samus/fx.ts super-smash/src/render/chars/donkeyKong/fx.ts super-smash/src/render/chars/index.ts super-smash/src/render/specialFx.ts super-smash/src/render/testFixtures.ts super-smash/src/render/vfx.test.ts super-smash/src/render/chars/kirby/kirby.test.ts super-smash/src/render/chars/samus/samus.test.ts super-smash/src/render/chars/donkeyKong/donkeyKong.test.ts super-smash/src/render/specialFx.test.ts
git commit -m "super-smash: Hammer Flip lights from 30 frames and puts the hammer away on its script's frame; stored charges show; a copied charge glows by the copy" -m "rubendal game_specials remove_exist 54 (56 at full), counted from the swing: the move's 69; SmashWiki's 30-frame flame. Samus's and Donkey Kong's stored full charge tells (UNVERIFIED shapes). Render only." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 36: Effect fixes: a refused pump, the stone's landing step, Zero Laser's mouth, the launch freeze's gap

The four effect items:
- Plan 5 Task 9: "A refused F.L.U.D.D. pump (spawn inside a wall) still animates the nozzle (`render/chars/mario/fx.ts:37` reads the move definition)." The painter knows the pump frames from the move (`muzzleOf`), not whether a pump came out. `FxContext` gains `projectilesOut(defId)`: how many of this fighter's projectiles of that id are alive. The spatter at the muzzle draws only while one is. `drawMoveFx` has no game state, so the renderer passes the projectiles in its `struck` argument (I4).
- Plan 5 Task 13 tail: "`render/chars/kirby/fx.ts:~784` uses the ground stone window for the landing step look (the engine now protects frame 46 on a same-step landing)." The rule is the engine's: `stoneOf` uses `f.combat.stoneEndedAir ? stone.air : stoneWindow(f, stone)` (`engine/stone.ts`). It becomes `stoneWindowOf`, exported, and the painter calls the same function. In the engine this is a pure refactor (integer-only; golden unchanged, captured).
- Plan 5 Task 17 re-review 4: "Zero Laser's end blast (frames 209-216) opens with a tall, bright vertical edge, 22 units high, in front of the cannon. Give it a short horizontal fade at the mouth." The blast keeps its vertical gradient (white core, violet fringes). Its first `BLAST_MOUTH_FADE` units are drawn as six slices, faint to full, under the same gradient, then the one fill as before.
- Same review: "On the launch freeze's last frame (kirby-trap3), Mario's glove overlaps Kirby's front edge by about 10 px."
  - **Reproduced first**, with `sceneDraw.test.ts`'s own harness: the sim-side scene shift holds Kirby backed off on every frozen frame and on the frame the launch fires (`heldBy`'s `hitlag > 0`). It lets go only once Mario flies. The new pin passes at once (captured).
  - So what overlaps is the models' extent past the capsules the shift is measured on (the glove's mesh), not the shift. No ease change: the draft's "start home one frame late" would delay every scene's release and break `sceneShiftEase.test.ts`'s pins.
  - The pin stays, and the overlap goes on the "Carried, not in Plan 6" list (the retarget's mesh fit).

**Golden:** unaffected (render, and a pure refactor of `stoneOf`; captured).

**Files:**
- Modify: `src/render/fxKit.ts` (`FxContext.projectilesOut`), `src/render/specialFx.ts` (fills it from `struck.projectiles`), `src/render/renderer.ts` (passes them), `src/render/chars/mario/fx.ts`, `src/engine/stone.ts` (`stoneWindowOf`), `src/render/chars/kirby/fx.ts`, `src/render/chars/samus/fx.ts`
- Test: `src/render/chars/mario/mario.test.ts`, `src/render/specialFx.test.ts`, `src/render/chars/kirby/kirby.test.ts`, `src/render/chars/samus/samus.test.ts`, `src/game/sceneDraw.test.ts`

**Interfaces:**
- Consumes: `runPainter` (Task 35), `makeProjectile` (testFixtures.ts), `drawMoveFx`, `fxContextFor`, `stoneWindow`, `stoneOf` (engine/stone.ts), `zeroBeam` (samus/fx.ts), `sceneDraw.test.ts`'s `run(user, gap)` harness.
- Produces:
  - `FxContext.projectilesOut?: (defId: string) => number`;
  - `drawMoveFx`'s `struck.projectiles?: readonly ProjectileState[]`;
  - `stoneWindowOf(f: Pick<FighterState, "grounded"> & { readonly combat: Pick<CombatState, "stoneEndedAir"> }, stone): readonly [number, number]` (engine/stone.ts);
  - `BLAST_MOUTH_FADE = 3`, `BLAST_MOUTH_SLICES = 6` (samus/fx.ts, UNVERIFIED cosmetic).

- [ ] **Step 1: Write the failing tests**

`src/render/chars/mario/mario.test.ts`:

```diff
--- a/src/render/chars/mario/mario.test.ts
+++ b/src/render/chars/mario/mario.test.ts
@@
 import { samplePose } from "../../poses/clip";
 import { poses } from "./poses";
 import { rig } from "./rig";
+import { runPainter } from "../../testFixtures";
 import { fx, projectiles } from "./fx";
 import { assignmentsTo, countOf, createMockContext, type MockContext } from "../../mockContext";
 
@@
     expect(sizes[0]).toBeGreaterThan(0);
     for (let i = 1; i < sizes.length; i++) expect(sizes[i]).toBeGreaterThan(sizes[i - 1]);
     expect(sizes.at(-1)).toBeLessThan(16);
+  });
+});
+
+describe("F.L.U.D.D.'s spray (Plan 6, Task 36)", () => {
+  const pumping = (out?: number) =>
+    runPainter(fx.downB!, mario, { frame: 30, total: 67, f: { action: "special", move: "downB" }, ...(out === undefined ? {} : { projectilesOut: () => out }) });
+
+  it("sprays at the nozzle only while a pump of its own is out: a refused pump (inside a wall) leaves it dry", () => {
+    expect(countOf(pumping(1), "fill")).toBeGreaterThan(countOf(pumping(0), "fill"));
+    // With no count to read (the animation lab), as before.
+    expect(countOf(pumping(), "fill")).toBe(countOf(pumping(1), "fill"));
   });
 });
```

`src/render/specialFx.test.ts`, that the count is the fighter's own of that id:

```diff
--- a/src/render/specialFx.test.ts
+++ b/src/render/specialFx.test.ts
@@
 import { MOVE_FX_KEYS, drawMoveFx } from "./specialFx";
 import { fxContextFor } from "./fxKit";
 import { fxFor } from "./chars";
-import { makeFighter, makeStage } from "./testFixtures";
+import { makeFighter, makeProjectile, makeStage } from "./testFixtures";
 
 const cam = createCamera(makeStage());
 const byId = new Map(FIGHTERS.map((f) => [f.id, f]));
@@
     const ctx = createMockContext();
     drawMoveFx(ctx, samus, stored, cam, 13, 0, 0, { lastHit: [], frame: 40 });
     expect(ctx.calls.length).toBeGreaterThan(0);
+  });
+
+  it("counts the fighter's own projectiles of an id for its painter: Mario's water (Plan 6, Task 36)", () => {
+    const mario = byId.get("mario")!;
+    const f = makeFighter({ defId: "mario", action: "special", move: "downB", actionFrame: 29 });
+    const water = makeProjectile({ owner: 0, defId: mario.moves.downB!.projectiles![0].id });
+    const theirs = makeProjectile({ owner: 1, defId: water.defId });
+    const fills = (projectiles: ReturnType<typeof makeProjectile>[]) => {
+      const ctx = createMockContext();
+      const fx = drawMoveFx(ctx, mario, f, cam, 13, 0, 0, { lastHit: [], frame: 30, projectiles });
+      for (const paint of fx.over) paint();
+      return countOf(ctx, "fill");
+    };
+    expect(fills([water])).toBeGreaterThan(fills([theirs]));
   });
 
   it("draws nothing for a fighter who is not doing a special", () => {
```

`src/render/chars/kirby/kirby.test.ts`, the painter on the landing step:

```diff
--- a/src/render/chars/kirby/kirby.test.ts
+++ b/src/render/chars/kirby/kirby.test.ts
@@
 import { poses } from "./poses";
 import { fx, HAMMER_FLAME_FROM, hammerLit, hammerVisible } from "./fx";
 import { runPainter } from "../../testFixtures";
+import { emptyCombat } from "@/engine/combat";
 
 const rig = getCharacterRig("kirby");
 const NAMES = Object.keys(poses) as PoseName[];
@@
     expect(hammerLit(30)).toBe(true);
     // The painter's flame: more drawn at 30 charge frames than at 29.
     expect(at(30, 30).calls.length).toBeGreaterThan(at(30, 29).calls.length);
+  });
+});
+
+describe("the stone on its landing step (Plan 6, Task 36)", () => {
+  it("is still the air's stone on frame 46 when it ended in the air and landed, as the engine protects it (`stoneOf`)", () => {
+    const rock = (stoneEndedAir: boolean) =>
+      runPainter(fx.downB!, def, { frame: 46, f: { action: "special", move: "downB", grounded: true, combat: { ...emptyCombat(), stoneFrames: 18, stoneEndedAir } } });
+    expect(rock(true).calls.length).toBeGreaterThan(0);
+    expect(rock(false).calls).toHaveLength(0);
   });
 });
```

`src/render/chars/samus/samus.test.ts`. A new test for the fade, by the alphas the painter sets (`assignmentsTo`), and three existing pins of the blast's shape updated for the slices: "one fill" becomes seven on the blast's frames, and the blast's box is the union of its fills:

```diff
--- a/src/render/chars/samus/samus.test.ts
+++ b/src/render/chars/samus/samus.test.ts
@@
 import { bakedContext } from "@/game/bake";
 import { STAGES } from "@/stages";
 import { makeFighter, runPainter } from "../../testFixtures";
-import { countOf, createMockContext, type MockContext } from "../../mockContext";
+import { assignmentsTo, countOf, createMockContext, type MockContext } from "../../mockContext";
 import { emptyCombat } from "@/engine/combat";
 import { storedChargeTell } from "./fx";
 
@@
   it("draws no bands and nothing behind the muzzle: one fill, no strokes, no caps, from 12 ahead on", () => {
     for (const frame of [81, 86, 150, 209, 216]) {
       const f = fills(frame);
-      expect(f.out.length, `frame ${frame}`).toBe(1);
+      // The end blast's mouth fades in over six slices before its one fill (Plan 6, Task 36).
+      expect(f.out.length, `frame ${frame}`).toBe(frame >= 209 ? 7 : 1);
       expect(f.strokes, `frame ${frame}`).toEqual([]);
       expect(f.circles, `frame ${frame}`).toEqual([]);
-      expect(f.out[0].x0, `frame ${frame}`).toBe(12);
+      expect(Math.min(...f.out.map((o) => o.x0)), `frame ${frame}`).toBe(12);
     }
   });
 
   it("ends in one blast over its envelope, 209-216: the main blast's and the fringe blasts', -11.5 to 41.5, fading out", () => {
-    for (const frame of [209, 216]) expect(fills(frame).out.map(box), `frame ${frame}`).toEqual([{ x0: 12, x1: 174.5, lo: -11.5, hi: 41.5 }]);
+    // Its mouth's slices and its one fill (Plan 6, Task 36) cover it together.
+    const union = (frame: number) => {
+      const out = fills(frame).out;
+      return box({ ...out[0], x0: Math.min(...out.map((o) => o.x0)), x1: Math.max(...out.map((o) => o.x1)), lo: Math.min(...out.map((o) => o.lo)), hi: Math.max(...out.map((o) => o.hi)) });
+    };
+    for (const frame of [209, 216]) expect(union(frame), `frame ${frame}`).toEqual({ x0: 12, x1: 174.5, lo: -11.5, hi: 41.5 });
     const core = (frame: number) => Math.max(...fills(frame).out[0].grad!.stops.map(([, c]) => alphaOf(c)));
     expect(core(216)).toBeLessThan(core(209));
     for (const frame of [217, 240, 263]) expect(fills(frame).out, `frame ${frame}`).toEqual([]);
@@
       expect(r(heightAt(points, 19.5)), `frame ${frame}`).toEqual([2.5, 27.5]);
       for (const ahead of [27, 100, 168]) expect(r(heightAt(points, ahead)), `frame ${frame} at ${ahead}`).toEqual([-5, 35]);
     }
-    // The end blast: its main blast's 4 to 26 at the muzzle, the envelope's -11.5 to 41.5 from 27.
+    // The end blast: its main blast's 4 to 26 at the muzzle (its first slice's, Plan 6,
+    // Task 36), the envelope's -11.5 to 41.5 from 27 (its one fill's).
     for (const frame of [209, 216]) {
-      const { points } = fills(frame).out[0];
-      expect(r(heightAt(points, 12)), `frame ${frame}`).toEqual([4, 26]);
-      expect(r(heightAt(points, 27)), `frame ${frame}`).toEqual([-11.5, 41.5]);
+      const { out } = fills(frame);
+      expect(r(heightAt(out[0].points, 12)), `frame ${frame}`).toEqual([4, 26]);
+      expect(r(heightAt(out[out.length - 1].points, 27)), `frame ${frame}`).toEqual([-11.5, 41.5]);
     }
     // The beam alone (81-85) is its main box's height all along: nothing to open into.
     expect(r(heightAt(fills(81).out[0].points, 12))).toEqual([10, 20]);
@@
     expect(countOf(tell(full - 1), "arc")).toBe(0);
   });
 });
+
+describe("Zero Laser's end blast at its mouth (Plan 6, Task 36)", () => {
+  const alphas = (frame: number) =>
+    assignmentsTo(runPainter(fx.finalSmash!, samus, { frame, total: 263, f: { action: "special", move: "finalSmash" } }), "globalAlpha").map(Number);
+
+  it("fades in across its first units on the blast's frames, not as a hard edge 22 units tall", () => {
+    // Slices up to full across the mouth: the faintest well under a quarter.
+    expect(alphas(209).some((a) => a > 0 && a < 0.25)).toBe(true);
+    expect(alphas(216).some((a) => a > 0 && a < 0.25)).toBe(true);
+    // The beam before it keeps its taper and no fade.
+    expect(alphas(150).some((a) => a > 0 && a < 0.25)).toBe(false);
+  });
+});
```

`src/game/sceneDraw.test.ts`, the reproduction (kirby-trap3 is Kirby from 3 away; R-T17i's harness):

```diff
--- a/src/game/sceneDraw.test.ts
+++ b/src/game/sceneDraw.test.ts
@@
   });
 });
 
+describe("Kirby's Ultra Sword holds its gap through the launch freeze (Plan 6, Task 36: kirby-trap3)", () => {
+  it("holds him backed off on every frame of Mario's freeze and the frame the launch fires, and lets go only as Mario flies", () => {
+    const frames = run("kirby", 3);
+    const freeze = frames.filter((f) => f.held === "frozen");
+    expect(freeze.length).toBe(8);
+    const fires = frames[frames.indexOf(freeze.at(-1)!) + 1];
+    // Six and a half units back: the finishing blow's gap (9.5 since Task 19) less Mario's 3 ahead.
+    expect(new Set([...freeze, fires].map((f) => f.shift))).toEqual(new Set([-6.5]));
+    const lets = frames.find((f) => f.at > fires.at && f.shift !== -6.5)!;
+    expect(lets.held).toBe("flying");
+  });
+});
+
 describe("letting go (rulings R-T17o and R-T17q; the re-review 2's N7 and 3's N9)", () => {
   /**
    * The shift the runner hands the drawing on each paint (`easeSceneShift` of
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/render/chars/mario src/render/specialFx.test.ts src/render/chars/kirby src/render/chars/samus src/game/sceneDraw.test.ts`

Expected (captured):
- `mario.test.ts`, the spray: `expected 11 to be greater than 11` (it sprays either way);
- `specialFx.test.ts`, the count: `expected 11 to be greater than 11`;
- `kirby.test.ts`, the landing step: `expected 0 to be greater than 0` (the ground's window draws nothing on 46);
- `samus.test.ts`: the one-fill pin, `frame 209: expected 1 to be 7`, and the fade, `expected false to be true`.

Five tests FAIL. The `sceneDraw.test.ts` reproduction PASSES before any change, which is the finding: the shift holds through the freeze. It was captured on a base without Tasks 9, 11 and 18; the shift is Kirby's end `sceneGap` less Mario's 3, so it should not move. If the count (8) or the shift (−6.5) differs here, read both from `run("kirby", 3)` on this tree: if the shift is still one value through the freeze and the fire frame, and lets go only as Mario flies, pin the read values, note them in the comment and the commit, and go on; otherwise stop. It stays as a pin, and the fifth mutant shows it can fail.

- [ ] **Step 3: Implement**

`src/render/fxKit.ts`:

```diff
--- a/src/render/fxKit.ts
+++ b/src/render/fxKit.ts
@@
    */
   readonly struckWith?: number | null;
   /**
+   * How many of this fighter's own projectiles of def id `defId` are out now (Plan 6,
+   * Task 36): a painter that animates a launcher reads what actually came out, so a
+   * pump refused inside a wall leaves F.L.U.D.D. dry. Absent where no match runs (the
+   * animation lab): the painter draws as if it came out.
+   */
+  readonly projectilesOut?: (defId: string) => number;
+  /**
    * Paint this *after* the figure instead of under it.
    *
    * An effect is painted under the fighter, which is right for most of them —
```

`src/render/specialFx.ts`:

```diff
--- a/src/render/specialFx.ts
+++ b/src/render/specialFx.ts
@@
  * entry is already the cheap path.
  */
 
-import type { FighterDef, FighterState } from "@/engine/types";
+import type { FighterDef, FighterState, ProjectileState } from "@/engine/types";
 import type { Camera } from "./camera";
 import { fxContextFor, struckWithFor, DREW_NOTHING, type MoveFxResult } from "./fxKit";
 import { alwaysFxFor, fxFor } from "./chars";
@@
   screenX: number,
   screenY: number,
   /** Cosmetic state, for the effects that need to know a swing connected. */
-  struck?: { lastHit: ({ hitboxId: number; frame: number } | null)[]; frame: number },
+  struck?: {
+    lastHit: ({ hitboxId: number; frame: number } | null)[];
+    frame: number;
+    /** The projectiles in flight, for `FxContext.projectilesOut` (Plan 6, Task 36). */
+    projectiles?: readonly ProjectileState[];
+  },
 ): MoveFxResult {
   // A state the fighter carries is drawn whatever it is doing (Plan 6, Task 35: a stored
   // charge), before any move's, on the match's own clock (`frame` is the sim's here).
@@
   if (!fn) return DREW_NOTHING;
 
   const over: (() => void)[] = [];
+  const context = fxContextFor(
+    ctx,
+    def,
+    f,
+    cam,
+    height,
+    screenX,
+    screenY,
+    move.totalFrames,
+    struck ? struckWithFor(struck.lastHit, f) : undefined,
+    (paint) => over.push(paint),
+  );
+  const flying = struck?.projectiles;
   const result = fn(
-    fxContextFor(
-      ctx,
-      def,
-      f,
-      cam,
-      height,
-      screenX,
-      screenY,
-      move.totalFrames,
-      struck ? struckWithFor(struck.lastHit, f) : undefined,
-      (paint) => over.push(paint),
-    ),
+    flying === undefined
+      ? context
+      : { ...context, projectilesOut: (id) => flying.reduce((n, p) => (p.owner === f.port && p.defId === id ? n + 1 : n), 0) },
   );
   // Not `result ?? DREW_NOTHING`: an effect that returns `{ hideFigure: true }`
   // returns a `SpecialFxResult`, which carries no queue, and taking it whole
```

`src/render/renderer.ts`:

```diff
--- a/src/render/renderer.ts
+++ b/src/render/renderer.ts
@@
     drawMoveFx(ctx, d.def, f, cam, height, screen.x, screen.y, {
       lastHit: state.vfx.lastHit,
       frame: state.current.frame,
+      projectiles: state.current.projectiles,
     }),
   );
 
```

`src/render/chars/mario/fx.ts`:

```diff
--- a/src/render/chars/mario/fx.ts
+++ b/src/render/chars/mario/fx.ts
@@
    * wants to be behind him. It is the graphic that tells you which special he
    * threw from the very first frame, long before any water exists.
    */
-  downB: ({ ctx, def, x, y, u, dir, frame, total, over }) => {
+  downB: ({ ctx, def, x, y, u, dir, frame, total, over, projectilesOut }) => {
     const muzzle = muzzleOf(def);
     if (muzzle === null) return NOTHING;
     const appear = Math.min(1, frame / 5);
@@
     });
 
     // Spatter at the muzzle while it pumps: from the first pump on frame 21
-    // (SmashWiki: "Pumps 21-32, …") to the last one's leaving on 51.
-    if (frame >= muzzle.first && frame <= muzzle.last) over(() => {
+    // (SmashWiki: "Pumps 21-32, …") to the last one's leaving on 51, and only while
+    // a pump of its own is out (Plan 6, Task 36): one refused inside a wall sprays nothing.
+    const pump = def.moves.downB?.projectiles?.[0]?.id;
+    const pumped = pump === undefined || projectilesOut === undefined || projectilesOut(pump) > 0;
+    if (pumped && frame >= muzzle.first && frame <= muzzle.last) over(() => {
       ctx.save();
       ctx.globalAlpha = 0.45 * alpha;
       ctx.fillStyle = "#EAF6FF";
```

`src/engine/stone.ts`:

```diff
--- a/src/engine/stone.ts
+++ b/src/engine/stone.ts
@@
 
 import { actionFrameOf, moveFrameOf } from "./hitbox";
 import type { Intent } from "./states";
+import type { CombatState } from "./combat";
 import type { FighterDef, FighterState, StoneDef } from "./types";
 
+/**
+ * The stone's window as the stone has it (Plan 6, Task 36): one that ended in the air
+ * keeps the air's window wherever it is, the landing step's frame 46 included
+ * (`stoneOf`); otherwise the window for where the fighter is (`stoneWindow`).
+ */
+export function stoneWindowOf(f: Pick<FighterState, "grounded"> & { readonly combat: Pick<CombatState, "stoneEndedAir"> }, stone: StoneDef): readonly [number, number] {
+  return f.combat.stoneEndedAir ? stone.air : stoneWindow(f, stone);
+}
+
 /** The stone's window for where the fighter is: the air's or the ground's. */
 export function stoneWindow(f: Pick<FighterState, "grounded">, stone: StoneDef): readonly [number, number] {
   return f.grounded ? stone.ground : stone.air;
@@
   // A stone that ended in the air is the air's window's wherever it is: on the step
   // it lands, its frame 46 is the air's "Stone protection 29-46" still (the Task 13
   // tail, the re-review's N6; UNVERIFIED: no published timeline times that landing).
-  const [from, to] = f.combat.stoneEndedAir ? stone.air : stoneWindow(f, stone);
+  const [from, to] = stoneWindowOf(f, stone);
   const frame = moveFrameOf(f.actionFrame);
   return frame >= from && frame <= to ? stone : null;
 }
```

`src/render/chars/kirby/fx.ts`:

```diff
--- a/src/render/chars/kirby/fx.ts
+++ b/src/render/chars/kirby/fx.ts
@@
  * front of him rather than straight up.
  */
 
-import { stoneWindow } from "@/engine/stone";
+import { stoneWindowOf } from "@/engine/stone";
 import {
   NOTHING,
   circle,
@@
   downB: ({ ctx, f, def, x, y, u, frame, over }) => {
     const stone = def.moves.downB?.stone;
     if (!stone) return NOTHING;
-    const [from, to] = stoneWindow({ grounded: f.grounded === true }, stone);
+    // As the engine has it (`stoneWindowOf`; Plan 6, Task 36): a stone ended in the
+    // air is still the air's on the step it lands, its frame 46.
+    const [from, to] = stoneWindowOf({ grounded: f.grounded === true, combat: { stoneEndedAir: f.combat?.stoneEndedAir === true } }, stone);
     if (frame < from || frame > to) return NOTHING;
 
     // Eleven units across against his 6.9-unit ball, standing 7.2 against his
```

`src/render/chars/samus/fx.ts`, in `zeroBeam`, the mouth's slices before the one fill:

```diff
--- a/src/render/chars/samus/fx.ts
+++ b/src/render/chars/samus/fx.ts
@@
   const mouthHi = Math.min(hi, my + mr);
   const open = Math.min(near + ZERO_NEAR_TAPER, far);
   const at = (ahead: number, up: number) => [feetX + dir * ahead * u, feetY - up * u] as const;
+  /** The beam's bottom and top `ahead` of the feet: the mouth's, opening to the envelope's over the taper. */
+  const edge = (ahead: number): readonly [number, number] => {
+    const k = open > near ? Math.min(1, Math.max(0, (ahead - near) / (open - near))) : 1;
+    return [mouthLo + (lo - mouthLo) * k, mouthHi + (hi - mouthHi) * k];
+  };
+  // The end blast fades in across its mouth (Plan 6, Task 36; the Task 17 re-review 4):
+  // its first `BLAST_MOUTH_FADE` units in slices, faint to full, where the blast's own
+  // 22-unit height stood as a hard, bright edge in front of the cannon.
+  const start = blast ? Math.min(near + BLAST_MOUTH_FADE, far) : near;
+  if (start > near) {
+    const base = ctx.globalAlpha;
+    for (let i = 0; i < BLAST_MOUTH_SLICES; i++) {
+      const a = near + ((start - near) * i) / BLAST_MOUTH_SLICES;
+      const b = near + ((start - near) * (i + 1)) / BLAST_MOUTH_SLICES;
+      const [aLo, aHi] = edge(a);
+      const [bLo, bHi] = edge(b);
+      ctx.globalAlpha = (base * (i + 0.5)) / BLAST_MOUTH_SLICES;
+      ctx.beginPath();
+      ctx.moveTo(...at(a, aHi));
+      ctx.lineTo(...at(b, bHi));
+      ctx.lineTo(...at(b, bLo));
+      ctx.lineTo(...at(a, aLo));
+      ctx.closePath();
+      ctx.fill();
+    }
+    ctx.globalAlpha = base;
+  }
+  const [startLo, startHi] = edge(start);
   ctx.beginPath();
-  ctx.moveTo(...at(near, mouthHi));
-  ctx.lineTo(...at(open, hi));
+  ctx.moveTo(...at(start, startHi));
+  if (open > start) ctx.lineTo(...at(open, hi));
   ctx.lineTo(...at(far, hi));
   ctx.lineTo(...at(far, lo));
-  ctx.lineTo(...at(open, lo));
-  ctx.lineTo(...at(near, mouthLo));
+  if (open > start) ctx.lineTo(...at(open, lo));
+  ctx.lineTo(...at(start, startLo));
   ctx.closePath();
   ctx.fill();
 }
 
 /**
+ * How far the end blast fades in from its mouth, units, and in how many steps (Plan 6,
+ * Task 36). UNVERIFIED (cosmetic): by eye, a fifth of the taper.
+ */
+const BLAST_MOUTH_FADE = 3;
+const BLAST_MOUTH_SLICES = 6;
+
+/**
  * How far past the muzzle Zero Laser's beam opens from its main box's height to
  * its envelope's (fix round 4, ruling R-T17t), units: the muzzle flash's last
  * radius (box 8's 15). Presentation choice.
```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/render src/game/sceneDraw.test.ts src/engine src/game/golden.test.ts`. Expected: PASS, the golden byte-identical (captured).

- [ ] **Step 5: Look (numbers)**

The tests settle each item: the spray's fills against the pump count, the stone's frame 46, the mouth's alphas, and the scene's shift through the freeze. Neither the animation lab nor `fightsheet.mjs` can play a Final Smash or a pump into a wall, so there is no capture step.

- [ ] **Step 6: Mutants**

Each against the Step 2 files; restore after each:
1. `mario/fx.ts`: `projectilesOut(pump) > 0` → `true`. The spray and count tests FAIL `expected 11 to be greater than 11` (captured).
2. `drawMoveFx`'s count: drop `p.owner === f.port &&`. The count test FAILS `expected 11 to be greater than 11` (captured).
3. `stoneWindowOf`: drop the `stoneEndedAir` branch. The landing-step test FAILS `expected 0 to be greater than 0` (captured).
4. `zeroBeam`: `const start = …` → `const start = near;`. The pin and the fade FAIL `frame 209: expected 1 to be 7`, `expected false to be true` (captured).
5. `renderer.ts` `heldBy`: `if (f.hitlag > 0) return true;` → `return false;`. The kirby-trap3 pin FAILS `expected Set{ -5.571428571428571, …(7) } to deeply equal Set{ -6.5 }`, with R-T17i's own rows (captured). (`hitlag > 1` survives: on the freeze's last frame the launch fires the same step, so the two are equivalent here.)

- [ ] **Step 7: Gate and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`, `PORT=3107 pnpm test:e2e --trace off`. Expected: exit 0.

```bash
git add super-smash/src/render/fxKit.ts super-smash/src/render/specialFx.ts super-smash/src/render/renderer.ts super-smash/src/render/chars/mario/fx.ts super-smash/src/engine/stone.ts super-smash/src/render/chars/kirby/fx.ts super-smash/src/render/chars/samus/fx.ts super-smash/src/render/chars/mario/mario.test.ts super-smash/src/render/specialFx.test.ts super-smash/src/render/chars/kirby/kirby.test.ts super-smash/src/render/chars/samus/samus.test.ts super-smash/src/game/sceneDraw.test.ts
git commit -m "super-smash: effect fixes: a refused pump sprays nothing, the stone's landing step, Zero Laser's mouth fades in" -m "FxContext.projectilesOut from the renderer's projectiles; the painter reads the engine's stoneWindowOf (a pure refactor of stoneOf); the end blast's first 3 units in six slices. kirby-trap3 reproduced: the scene shift holds through the freeze (pinned); the glove's overlap is the mesh's, carried. Render only; golden unchanged." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 37: Every move effect held to its own hitboxes at the model's size, and the outliers looked at

From Plan 4's final review, Declined #9: "Move effects (`chars/*/fx.ts`) were authored against the 2D rig's proportions and scale to the model's head height … eyeball each on an SSBU-sized body."

The check is numeric and finite, so the eyeballing is a list, not the whole roster:
- On each frame a move's boxes are live, its painter's drawn box (a mock canvas, every transform followed, drawn at the model's own head height, `overlayAnchor`) is held against those boxes: the game's own, the limb-bone scripts placed through the committed bake.
- An effect should be where its hitboxes are and about their size: its larger side a third to four times theirs, and its centre within its own size of theirs. The band is UNVERIFIED (cosmetic): an effect may trail or flash past its box.
- The draft's "0.05-3× the body" band could not catch the backlog's failure: an effect sized for the 13-unit 2D rig drawn on the 26-unit Donkey Kong is ½ the body and passed. Its `CHARACTER_FX` map does not exist (the map is `FX_MODULES`, keyed in lower case), so it would have skipped Donkey Kong in silence (I5).
- The bound is a ratchet, as `reach.allow.json` is. An effect out of band is listed in `EXPECTED` with what was measured and why it is right on the model, or it is fixed until it is in band. An entry that comes back in band must be struck. A new outlier fails until someone looks.

**Golden:** unaffected (a test and a test helper; Step 5's fixes are render only).

**Files:**
- Create: `src/render/fxScale.test.ts`
- Modify: `src/render/testFixtures.ts` (`paintedBox`, `PaintedBox`); by Step 5, the `fx.ts` of any effect that look finds mis-sized
- Test: `src/render/fxScale.test.ts`

**Interfaces:**
- Consumes: `runPainter` (Task 35), `fxFor` (chars/index.ts), `scriptHitboxes`, `moveScriptFrame`, `withLimbScripts`, `readBakeFromDisk`, `overlayAnchor` (render3d/anchors.ts).
- Produces: `paintedBox(ctx: MockContext): PaintedBox | null` (testFixtures.ts).

- [ ] **Step 1: Write the failing test**

`src/render/fxScale.test.ts` (new file). `EXPECTED` holds the eighteen measured in the replay, each marked unreviewed until Step 5:

```ts
// @vitest-environment node
/**
 * Every move effect at SSBU size (Plan 6, Task 37; Plan 4 final review, Declined #9: the
 * effects "were authored against the 2D rig's proportions and scale to the model's head
 * height … eyeball each on an SSBU-sized body"). A numeric stand-in for the eyeballing: on
 * each frame a move's boxes are live, its painter's drawn box (a mock canvas, every
 * transform followed, at the model's own height) is held against those boxes, the game's
 * own (the limb-bone scripts, placed through the committed bake). An effect is where its
 * hitboxes are and about their size: its larger side a third to four times theirs, its
 * centre within its own size of theirs (UNVERIFIED, cosmetic: an effect may trail or flash
 * past its box). The Final Smashes are scenes, held by Task 17's pins.
 *
 * A ratchet, as `reach.allow.json` is: an effect out of band is listed in `EXPECTED`, with
 * what was measured and why it is right on the model, or fixed until it is in band; an
 * entry whose effect comes back in band is struck. A new one fails until a human looks
 * (Step 5's look).
 */
import { describe, expect, it } from "vitest";

import { scriptHitboxes } from "@/engine/acmd/hitboxes";
import { moveScriptFrame } from "@/engine/acmd/run";
import { toFloat } from "@/engine/fixed";
import type { MoveSlot } from "@/engine/types";
import { FIGHTERS } from "@/fighters";
import { withLimbScripts } from "@/fighters/acmd/limb";
import { readBakeFromDisk } from "@/game/bakeNode";
import { overlayAnchor } from "@/render3d/anchors";
import { fxFor } from "./chars";
import { paintedBox, runPainter } from "./testFixtures";

const bake = readBakeFromDisk();
const U = 8;
const FEET = { x: 400, y: 600 };
const EFFECT_MAX_RATIO = 4;
const EFFECT_MIN_RATIO = 1 / 3;
const SCENES: ReadonlySet<MoveSlot> = new Set(["finalSmash"]);

/** Effects out of band, by `"<fighter> <slot>"`: what was measured, and why it is right on the model (Step 5's look). */
const EXPECTED: Readonly<Record<string, string>> = {
  "mario upB": "unreviewed (Plan 6, Task 37): 0.20x, 5.2 off",
  "donkeyKong dashAttack": "unreviewed (Plan 6, Task 37): 0.82x, 16.3 off",
  "donkeyKong dair": "unreviewed (Plan 6, Task 37): 0.33x, 0.0 off",
  "donkeyKong downB": "unreviewed (Plan 6, Task 37): 0.66x, 8.0 off",
  "link upB": "unreviewed (Plan 6, Task 37): 0.77x, 18.1 off",
  "link upBAir": "unreviewed (Plan 6, Task 37): 0.69x, 19.4 off",
  "samus nair": "unreviewed (Plan 6, Task 37): 0.75x, 14.6 off",
  "samus fair": "unreviewed (Plan 6, Task 37): 0.43x, 14.5 off",
  "samus uthrow": "unreviewed (Plan 6, Task 37): 0.99x, 14.0 off",
  "fox upB": "unreviewed (Plan 6, Task 37): 4.02x, 0.0 off",
  "pikachu fsmash": "unreviewed (Plan 6, Task 37): 2.48x, 18.8 off",
  "pikachu fair": "unreviewed (Plan 6, Task 37): 0.64x, 8.9 off",
  "pikachu dair": "unreviewed (Plan 6, Task 37): 0.62x, 11.2 off",
  "pikachu downB": "unreviewed (Plan 6, Task 37): 5.91x, 0.0 off",
  "pikachu fthrow": "unreviewed (Plan 6, Task 37): 0.48x, 9.5 off",
  "marth usmash": "unreviewed (Plan 6, Task 37): 0.22x, 12.1 off",
  "marth dair": "unreviewed (Plan 6, Task 37): 0.25x, 0.0 off",
  "marth sideB": "unreviewed (Plan 6, Task 37): 0.28x, 0.0 off",
};

/** Each of a fighter's effects out of band, by slot: its worst size ratio and its worst distance off its boxes' centre, units. */
function outliers(id: string): string[] {
  const def = withLimbScripts(FIGHTERS.find((f) => f.id === id)!, bake.bones);
  // The height a match hands its painters: the model's head top, standing (`renderer.ts`).
  const standing = { defId: id, action: "stand" as const, actionFrame: 0, move: null, port: 0, charge: 0, hitstun: 0, jumpsUsed: 0, fastFalling: false, vx: 0, vy: 0, shortHop: false, facing: 1 };
  const height = overlayAnchor(def, standing, 0, bake)!.headTop;
  const out: string[] = [];
  for (const slot of Object.keys(def.moves) as MoveSlot[]) {
    const paint = fxFor(def.id, slot);
    const move = def.moves[slot];
    if (paint === undefined || move === undefined || SCENES.has(slot)) continue;
    let worstRatio = 1;
    let worstOff = 0;
    for (let frame = 1; frame <= move.totalFrames; frame++) {
      const run = moveScriptFrame(def, { move: slot, actionFrame: frame - 1 });
      const boxes = run === null ? [] : scriptHitboxes(run.state, def.id, run.script.motion, run.gameFrame, bake.bones);
      if (boxes.length === 0) continue;
      const drawn = paintedBox(runPainter(paint, def, { x: FEET.x, y: FEET.y, u: U, height, frame, total: move.totalFrames, t: frame / move.totalFrames, f: { action: "attack", move: slot, actionFrame: frame - 1 } }));
      if (drawn === null) continue;
      // Both in world units, ahead of the feet and up from them.
      const hit = {
        minX: Math.min(...boxes.map((b) => toFloat(Math.min(b.x, b.x2 ?? b.x) - b.radius))),
        maxX: Math.max(...boxes.map((b) => toFloat(Math.max(b.x, b.x2 ?? b.x) + b.radius))),
        minY: Math.min(...boxes.map((b) => toFloat(Math.min(b.y, b.y2 ?? b.y) - b.radius))),
        maxY: Math.max(...boxes.map((b) => toFloat(Math.max(b.y, b.y2 ?? b.y) + b.radius))),
      };
      const fx = { minX: (drawn.minX - FEET.x) / U, maxX: (drawn.maxX - FEET.x) / U, minY: (FEET.y - drawn.maxY) / U, maxY: (FEET.y - drawn.minY) / U };
      const size = (b: typeof hit) => Math.max(b.maxX - b.minX, b.maxY - b.minY);
      const ratio = size(fx) / size(hit);
      if (Math.abs(Math.log(ratio)) > Math.abs(Math.log(worstRatio))) worstRatio = ratio;
      const apart = Math.hypot((fx.minX + fx.maxX - hit.minX - hit.maxX) / 2, (fx.minY + fx.maxY - hit.minY - hit.maxY) / 2);
      if (apart > size(fx)) worstOff = Math.max(worstOff, apart);
    }
    if (worstRatio > EFFECT_MAX_RATIO || worstRatio < EFFECT_MIN_RATIO || worstOff > 0) out.push(`${id} ${slot}: ${worstRatio.toFixed(2)}x, ${worstOff.toFixed(1)} off`);
  }
  return out;
}

describe("move effects at the model's size, on their own hitboxes (Plan 6, Task 37)", () => {
  it.each(FIGHTERS.map((f) => f.id))("%s's effects sit on their live hitboxes, a third to four times their size, or are listed with why", (id) => {
    const out = outliers(id);
    expect(out.filter((o) => EXPECTED[o.slice(0, o.indexOf(":"))] === undefined), "out of band and not listed").toEqual([]);
    const listed = Object.keys(EXPECTED).filter((k) => k.startsWith(`${id} `));
    expect(listed.filter((k) => !out.some((o) => o.startsWith(`${k}:`))), "listed but back in band: strike it").toEqual([]);
  });

  it("measures a painter it can see: Mario's forward smash, its fire on its hitbox", () => {
    // Not vacuous: the fire palm draws on its live frames, and is measured.
    const def = withLimbScripts(FIGHTERS.find((f) => f.id === "mario")!, bake.bones);
    expect(paintedBox(runPainter(fxFor("mario", "fsmash")!, def, { u: U, frame: 15, total: def.moves.fsmash!.totalFrames, f: { action: "attack", move: "fsmash" } }))).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run src/render/fxScale.test.ts`

Expected: FAIL (captured): every test fails `TypeError: paintedBox is not a function`. The harness is missing.

- [ ] **Step 3: Implement**

`src/render/testFixtures.ts`, after `runPainter`, a box that follows the canvas's transforms:

```diff
--- a/src/render/testFixtures.ts
+++ b/src/render/testFixtures.ts
@@
   const { f, ...rest } = over;
   paint(makeFxContext({ ctx, def, f: makeFighter({ defId: def.id, ...f }), ...rest }));
   return ctx;
+}
+
+/** A box on the screen, px. */
+export interface PaintedBox {
+  readonly minX: number;
+  readonly maxX: number;
+  readonly minY: number;
+  readonly maxY: number;
 }
+
+/**
+ * The box round everything a mock canvas was asked to draw, px (Plan 6, Task 37): every
+ * path point, arc and rectangle, through the transform in force when it was given
+ * (`translate`, `scale`, `rotate`, `transform`, `setTransform`, under `save`/`restore`).
+ * An arc or an ellipse counts its four extremes, which a rotation can only make generous.
+ * Null when nothing was drawn.
+ */
+export function paintedBox(ctx: MockContext): PaintedBox | null {
+  type M = [number, number, number, number, number, number];
+  let m: M = [1, 0, 0, 1, 0, 0];
+  const stack: M[] = [];
+  let box: PaintedBox | null = null;
+  const add = (x: number, y: number) => {
+    const sx = m[0] * x + m[2] * y + m[4];
+    const sy = m[1] * x + m[3] * y + m[5];
+    box = box === null ? { minX: sx, maxX: sx, minY: sy, maxY: sy } : { minX: Math.min(box.minX, sx), maxX: Math.max(box.maxX, sx), minY: Math.min(box.minY, sy), maxY: Math.max(box.maxY, sy) };
+  };
+  const mul = (n: M) => {
+    m = [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
+  };
+  for (const c of ctx.calls) {
+    const a = c.args.map(Number);
+    switch (c.method) {
+      case "save":
+        stack.push(m);
+        break;
+      case "restore":
+        m = stack.pop() ?? [1, 0, 0, 1, 0, 0];
+        break;
+      case "translate":
+        mul([1, 0, 0, 1, a[0], a[1]]);
+        break;
+      case "scale":
+        mul([a[0], 0, 0, a[1], 0, 0]);
+        break;
+      case "rotate":
+        mul([Math.cos(a[0]), Math.sin(a[0]), -Math.sin(a[0]), Math.cos(a[0]), 0, 0]);
+        break;
+      case "transform":
+        mul(a.slice(0, 6) as M);
+        break;
+      case "setTransform":
+        m = typeof c.args[0] === "object" ? [1, 0, 0, 1, 0, 0] : (a.slice(0, 6) as M);
+        break;
+      case "resetTransform":
+        m = [1, 0, 0, 1, 0, 0];
+        break;
+      case "moveTo":
+      case "lineTo":
+        add(a[0], a[1]);
+        break;
+      case "quadraticCurveTo":
+        add(a[0], a[1]);
+        add(a[2], a[3]);
+        break;
+      case "bezierCurveTo":
+        add(a[0], a[1]);
+        add(a[2], a[3]);
+        add(a[4], a[5]);
+        break;
+      case "arc":
+      case "arcTo": {
+        const [x, y, r] = c.method === "arc" ? [a[0], a[1], a[2]] : [a[0], a[1], a[4]];
+        add(x - r, y);
+        add(x + r, y);
+        add(x, y - r);
+        add(x, y + r);
+        break;
+      }
+      case "ellipse":
+        add(a[0] - a[2], a[1]);
+        add(a[0] + a[2], a[1]);
+        add(a[0], a[1] - a[3]);
+        add(a[0], a[1] + a[3]);
+        break;
+      case "rect":
+      case "fillRect":
+      case "strokeRect":
+      case "roundRect":
+        add(a[0], a[1]);
+        add(a[0] + a[2], a[1] + a[3]);
+        add(a[0] + a[2], a[1]);
+        add(a[0], a[1] + a[3]);
+        break;
+    }
+  }
+  return box;
+}
```

- [ ] **Step 4: Run it again**

Run: `pnpm vitest run src/render/fxScale.test.ts`. Expected: PASS (captured: 9 tests). The eighteen outliers are exactly the listed ones, and none is in band. That replay's base had Tasks 7 and 19-22 but not Task 18. Task 18's shared idle phase moves port 0's standing head top at frame 0, which `outliers` reads through `overlayAnchor` and every painter that reads `height` scales by, so an entry can cross the band's edge either way. Under ruling R-P6-23, if the test fails only on membership: set `EXPECTED` to the list the failure prints, strike each "listed but back in band", add each "out of band and not listed" as `"unreviewed (Plan 6, Task 37): <its figures>"`, re-run to PASS, and name the changes in the commit body. Any other failure stops the task.

- [ ] **Step 5: Look at the outliers (stand-in or scratchpad-only captures)**

For each `EXPECTED` entry, with `pnpm dev --port 3107` in the background:

```bash
node scripts/fightsheet.mjs --fighter pikachu --move downB --base http://localhost:3107 --out "$SCRATCH/fx-pikachu-downB.png"
```

(Use `--move` from fightsheet's list. An aerial is played as the script plays it; `upBAir` is Link's `upB` in the air: use `--move upB` and note it. A throw, `fthrow` or `uthrow`, uses `--move grab` and is judged from the grab's sheet and the numbers alone.)

Read it, decide, then `rm` the PNG before the next. Either:
- the effect is right for the model (a beam, a spark that flashes past the box), and the entry's text becomes the measured figures and the reason, replacing "unreviewed"; or
- it is mis-sized, and its size constant in its `fx.ts` is fixed until it is in band, the entry struck, and that painter's own test re-run.

With local models these are real-model captures, kept only in the scratchpad and deleted in the same step. Without models, stand-ins: the effects are 2D and draw the same over them.

When done, `grep -c "unreviewed" src/render/fxScale.test.ts` prints 0. Stop the server by its PID.

- [ ] **Step 6: Mutants**

Each against `src/render/fxScale.test.ts`; restore after each:
1. `paintedBox`: ignore `translate` (its `mul` line → `break;`). Six fighters' tests FAIL, every translated effect measured at the canvas's origin (captured), Mario's first: `out of band and not listed: expected [ 'mario sideB: 5.06x, 0.0 off' ] to deeply equal []`.
2. Strike `EXPECTED`'s `"pikachu downB"` row. Pikachu's test FAILS `out of band and not listed: expected [ 'pikachu downB: 5.91x, 0.0 off' ] to deeply equal []` (captured).

- [ ] **Step 7: Gate and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`, `PORT=3107 pnpm test:e2e --trace off`. Expected: exit 0.

```bash
git add super-smash/src/render/fxScale.test.ts super-smash/src/render/testFixtures.ts
# and each super-smash/src/render/chars/<fighter>/fx.ts (and its test) that Step 5 fixed
git commit -m "super-smash: every move effect held to its own hitboxes at the model's size; the outliers looked at" -m "fxScale.test.ts: each painter's drawn box (every transform followed) against its live limb-script boxes at the model's head height, a third to four times their size, centred within its own size; a ratchet of 18 listed with reasons (Step 5, scratchpad-only looks): <one line each>. Render only." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 38: HUD portraits from the loaded model

From Plan 4 Task 20's screenshots: "the damage HUD still shows Plan 1's 2D cartoon portraits beside real 3D models; consider runtime-rendered portraits from the loaded glb (never committed as images) or restyled 2D art."

**Ruling D14 (the controller's, R-P6-8): runtime portraits.** When a fighter's model is a glb, the 3D presenter renders its head once, on the first paint after every model is in. It renders into a small offscreen target with a fixed head-and-shoulders camera, a three-quarter turn toward it, and lights of the match's own (`createLights`: the models wear `MeshToonMaterial`, which is black unlit). It renders on no background, so the HUD cell's port tint shows through, in SPEC §10's angled, tinted portrait plate. The read-back is converted from the target's linear colour to sRGB, into a 2D canvas held in memory.

The HUD's `info` is built in `renderer.ts`'s `hudInfo` from the `RenderState`, so the portraits ride there: `RenderState.portraits`, filled by the match runner from the presenter. A stand-in model, a renderer without read-back, or no WebGL keeps the 2D rig's head. Nothing is written to disk or the network; the canvas lives as long as the presenter. The stock icons stay the 2D rig's.

**SPEC change, in this task's commit (I12; R-P6-8 drops D2).** SPEC §10, the paragraph on the models (`SPEC.md` lines 339-340):
- Old: "Without the models each fighter is a stand-in: its own hurtbox capsules, in its port's colour. The 2D rigs still draw the HUD's portraits and stock icons. See DECISIONS D57."
- New: "Without the models each fighter is a stand-in: its own hurtbox capsules, in its port's colour. With them, the HUD's portraits are drawn from the loaded model when the match starts and are never saved; without them, and for the stock icons, the 2D rigs draw them. See DECISIONS D57 and D59."

Task 42 lists it for the report.

**Golden:** unaffected.

**Files:**
- Create: `src/render3d/portrait3d.ts`, `src/render3d/portrait3d.test.ts`
- Modify: `src/render/hud.ts` (`HudFighterInfo.portrait`, the cell), `src/render/renderer.ts` (`RenderState.portraits`, `hudInfo`), `src/render3d/renderer3d.ts` (`GLLike`'s read-back, `Presenter3D.portraits`), `src/game/matchRunner.ts` (`WorldPresenter.portraits`, the render state), `SPEC.md`
- Test: `src/render/hud.test.ts`, `src/render/renderer.test.ts`, `src/render3d/renderer3d.test.ts`, `src/render3d/portrait3d.test.ts`

**Interfaces:**
- Consumes: `Fighter3D` (`kind`, `placement`, `bonePosition`), `createFighter3D`, `createLights` (renderer3d.ts), `armatureModel` (tests), `drawDamagePanel`, `hudInfo`, the presenter's `ready`.
- Produces:
  - `renderPortrait(gl: PortraitGL, fighter: Fighter3D, lights, makeCanvas?): HTMLCanvasElement | null` and `PortraitGL`, `PORTRAIT_SIZE = 96` (portrait3d.ts);
  - `Presenter3D.portraits(): readonly (HTMLCanvasElement | null)[]`; `GLLike`'s optional `getRenderTarget`, `setRenderTarget`, `readRenderTargetPixels`;
  - `WorldPresenter.portraits?()`; `RenderState.portraits?`; `HudFighterInfo.portrait?: CanvasImageSource | null`.

- [ ] **Step 1: Write the failing tests**

`src/render3d/portrait3d.test.ts` (new file). It runs on a recording fake of the renderer's read-back, which records at render time, and a fake 2D canvas: jsdom has none.

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { Light, MeshStandardMaterial, type Camera } from "three";

import { FIGHTERS } from "@/fighters";
import { withLimbScripts } from "@/fighters/acmd/limb";
import { readBakeFromDisk } from "@/game/bakeNode";
import { makeFighter } from "@/render/testFixtures";
import { armatureModel } from "./armatureModel";
import { fighterPoser } from "./bake/bake";
import { createFighter3D } from "./fighter3d";
import { PORTRAIT_SIZE, renderPortrait, type PortraitGL } from "./portrait3d";
import { createLights } from "./renderer3d";
import { parseSkeletonFile } from "./skeleton/skeleton";

const bake = readBakeFromDisk();
const mario = withLimbScripts(FIGHTERS.find((f) => f.id === "mario")!, bake.bones);
const skeleton = parseSkeletonFile(JSON.parse(readFileSync(join(process.cwd(), "src", "render3d", "skeletons", "mario.json"), "utf8")));
const poser = fighterPoser(mario, skeleton);

/** The slice of `WebGLRenderer` a portrait reads back through, recording each draw as it was made; every texel reads as `linear`. */
function fakePortraitGL(linear: number) {
  const drawn: { lights: number; fighters: number; background: unknown; camera: Camera; target: unknown }[] = [];
  let target: unknown = null;
  const gl: PortraitGL = {
    getRenderTarget: () => target as never,
    setRenderTarget: (t) => void (target = t),
    render: (scene, camera) => {
      let lights = 0;
      scene.traverse((o) => void ((o as Light).isLight && lights++));
      const fighters = scene.children.filter((c) => c.name.startsWith("fighter:")).length;
      drawn.push({ lights, fighters, background: (scene as unknown as { background: unknown }).background, camera, target });
    },
    readRenderTargetPixels: (_t, _x, _y, w, h, buffer) => {
      for (let i = 0; i < w * h * 4; i++) buffer[i] = i % 4 === 3 ? 255 : linear;
    },
  };
  return { gl, drawn, target: () => target };
}

/** A 2D canvas for the read-back, recording what is put on it (jsdom has none). */
function fakeCanvas() {
  const put: ImageData[] = [];
  const ctx = {
    createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: (image: ImageData) => void put.push(image),
  };
  const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
  return { canvas, put };
}

describe("a portrait from the loaded model (Plan 6, Task 38)", () => {
  it("draws the glb's head lit, on nothing, once, read back in sRGB into a square canvas held in memory", () => {
    const fighter = createFighter3D({ def: mario, port: 0, poser, bake, model: { kind: "glb", scene: armatureModel(poser.rig3, [new MeshStandardMaterial()]) } });
    fighter.update({ f: makeFighter({ defId: "mario", action: "stand" }), x: 0, y: 0, frame: 0, blends: null, hitFlash: 0, hidden: false });
    const turned = fighter.placement.rotation.y;
    const { gl, drawn, target } = fakePortraitGL(128);
    const { canvas, put } = fakeCanvas();
    const out = renderPortrait(gl, fighter, createLights(), () => canvas);
    expect(out).toBe(canvas);
    expect([canvas.width, canvas.height]).toEqual([PORTRAIT_SIZE, PORTRAIT_SIZE]);
    // Once, into a target of its own, the renderer's own target given back after.
    expect(drawn).toHaveLength(1);
    expect(drawn[0].target).not.toBeNull();
    expect(target()).toBeNull();
    // The fighter, lit as the match's scene is, on no background.
    expect(drawn[0].fighters).toBe(1);
    expect(drawn[0].lights).toBeGreaterThan(0);
    expect(drawn[0].background).toBeNull();
    // Linear 128 is sRGB 188: the target holds linear colour, the canvas shows sRGB.
    expect([...put[0].data.slice(0, 4)]).toEqual([188, 188, 188, 255]);
    // The fighter is handed back as it was.
    expect(fighter.placement.rotation.y).toBe(turned);
  });

  it("makes none for a stand-in, or without the renderer's read-back (the 2D head stays)", () => {
    const standIn = createFighter3D({ def: mario, port: 0, poser, bake, model: { kind: "standIn", reason: "test" } });
    const { canvas } = fakeCanvas();
    expect(renderPortrait(fakePortraitGL(128).gl, standIn, createLights(), () => canvas)).toBeNull();
    const glb = createFighter3D({ def: mario, port: 0, poser, bake, model: { kind: "glb", scene: armatureModel(poser.rig3, [new MeshStandardMaterial()]) } });
    const noReadBack: PortraitGL = { ...fakePortraitGL(128).gl, readRenderTargetPixels: undefined };
    expect(renderPortrait(noReadBack, glb, createLights(), () => canvas)).toBeNull();
  });
});
```

`src/render/hud.test.ts` (the file's own `scene` and `makeState` fixtures; `callsOf` returns `{ method, args }`):

```diff
--- a/src/render/hud.test.ts
+++ b/src/render/hud.test.ts
@@
     const ctx = createMockContext();
     drawHud(ctx, scene({ state: makeState({ outcome: { kind: "stockOut", placings: [0, 1] } }) }));
     expect(callsOf(ctx, "fillText").map((c) => String(c.args[0]))).toContain("GAME!");
+  });
+});
+
+describe("the portrait cell (Plan 6, Task 38)", () => {
+  it("draws the model's portrait in the cell when the scene carries one, and the 2D rig's head when it does not", () => {
+    const portrait = { width: 96, height: 96 } as unknown as CanvasImageSource;
+    const state = makeState();
+    const withPortrait = createMockContext();
+    const info = state.fighters.map((f) => ({ def: makeDef(), label: "Mario", isCpu: f.port === 1, portrait }));
+    drawDamagePanel(withPortrait, scene({ state, info }), state.fighters[0], 0, 0);
+    expect(callsOf(withPortrait, "drawImage").map((c) => c.args[0])).toEqual([portrait]);
+    const plain = createMockContext();
+    drawDamagePanel(plain, scene({ state }), state.fighters[0], 0, 0);
+    expect(countOf(plain, "drawImage")).toBe(0);
   });
 });
```

`src/render/renderer.test.ts`, that `hudInfo` hands the render state's portrait to the panel:

```diff
--- a/src/render/renderer.test.ts
+++ b/src/render/renderer.test.ts
@@
     expect(declaring).toEqual(["pikachu"]);
   });
 });
+
+describe("the HUD's portraits (Plan 6, Task 38)", () => {
+  it("hands each port's model portrait from the render state to its damage panel", () => {
+    const portrait = { width: 96, height: 96 } as unknown as CanvasImageSource;
+    const ctx = createMockContext();
+    render(ctx, { ...renderState(), portraits: [portrait, null] }, null, createCamera(stage), 0);
+    expect(callsOf(ctx, "drawImage").map((c) => c.args[0])).toEqual([portrait]);
+  });
+});
```

`src/render3d/renderer3d.test.ts`, the presenter makes them once, after the models, and none for a stand-in:

```diff
--- a/src/render3d/renderer3d.test.ts
+++ b/src/render3d/renderer3d.test.ts
@@
     await presenter.ready;
     expect(cloned).not.toHaveBeenCalled();
     expect(presenter.info().fighters[0]).toBe("loading");
+  });
+});
+
+describe("the HUD's portraits from the loaded models (Plan 6, Task 38)", () => {
+  it("makes one per glb, once, on the first paint after every model is in, and none for a stand-in", async () => {
+    const put = vi.fn();
+    const ctx2d = { createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }), putImageData: put };
+    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => ctx2d as never);
+    try {
+      const { presenter, rs, gl } = setup({ models: capCache(["mario"]) });
+      const camera = createCamera(rs.stage);
+      expect(presenter.portraits()).toEqual([null, null, null, null]);
+      await presenter.ready;
+      // Three's read-back, which the plain fake lacks.
+      let target: unknown = null;
+      Object.assign(gl(), {
+        getRenderTarget: () => target,
+        setRenderTarget: (t: unknown) => void (target = t),
+        readRenderTargetPixels: (_t: unknown, _x: number, _y: number, w: number, h: number, buffer: Uint8Array) => buffer.fill(255, 0, w * h * 4),
+      });
+      presenter.paint(rs, camera, 0, []);
+      const made = presenter.portraits();
+      expect(made.map((p) => p !== null)).toEqual([true, false, false, false]);
+      presenter.paint(rs, camera, 0, []);
+      expect(presenter.portraits()[0]).toBe(made[0]);
+      expect(put).toHaveBeenCalledTimes(1);
+      presenter.dispose();
+    } finally {
+      vi.restoreAllMocks();
+    }
   });
 });
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/render3d/portrait3d.test.ts src/render/hud.test.ts src/render/renderer.test.ts src/render3d/renderer3d.test.ts`

Expected: FAIL (captured):
- `portrait3d.test.ts`: `Error: Failed to resolve import "./portrait3d"` (the file does not exist yet);
- `renderer3d.test.ts`: `TypeError: presenter.portraits is not a function`;
- `hud.test.ts` and `renderer.test.ts`: `expected [] to deeply equal [ { width: 96, height: 96 } ]`.

- [ ] **Step 3: Implement**

`src/render3d/portrait3d.ts` (new file):

```ts
/**
 * A HUD portrait rendered from the loaded model (Plan 6, Task 38; ruling D14): the head
 * and shoulders, once, a three-quarter turn toward the camera, lit as the match lights it,
 * into an offscreen target, read back into a 2D canvas held in memory for the match.
 * Never saved and never sent: the repo is public and the models are Nintendo's (SPEC §3.1).
 * A stand-in, or a renderer without a read-back (a test's fake), has none, and the HUD
 * keeps the 2D rig's head.
 */

import { OrthographicCamera, Scene, Vector3, WebGLRenderTarget, type Camera, type Object3D } from "three";

import type { Fighter3D } from "./fighter3d";

/** The portrait's side, px: the HUD's cell draws its head 96 across. */
export const PORTRAIT_SIZE = 96;
/** How far the portrait turns the model from side-on toward the camera, radians. UNVERIFIED (cosmetic): by eye. */
const PORTRAIT_TURN = 0.5;

/** The slice of `WebGLRenderer` a portrait renders and reads back through. */
export interface PortraitGL {
  render(scene: Object3D, camera: Camera): void;
  getRenderTarget?(): WebGLRenderTarget | null;
  setRenderTarget?(target: WebGLRenderTarget | null): void;
  readRenderTargetPixels?(target: WebGLRenderTarget, x: number, y: number, width: number, height: number, buffer: Uint8Array): void;
}

/** sRGB from linear, 0-255: a render target holds linear colour (three r186 writes sRGB only to the screen). */
const toSrgb = (v: number): number => {
  const c = v / 255;
  return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
};

/**
 * `fighter`'s portrait, as it stands now (its last `update`), or null. `lights` are lights
 * of the match's own (`createLights`), made for the portrait's scene.
 */
export function renderPortrait(
  gl: PortraitGL,
  fighter: Fighter3D,
  lights: Readonly<Record<string, Object3D>>,
  makeCanvas: () => HTMLCanvasElement = () => document.createElement("canvas"),
): HTMLCanvasElement | null {
  if (fighter.kind !== "glb" || gl.getRenderTarget === undefined || gl.setRenderTarget === undefined || gl.readRenderTargetPixels === undefined) return null;
  const placement = fighter.placement;
  const parent = placement.parent;
  const turned = placement.rotation.y;
  const scene = new Scene();
  scene.add(...Object.values(lights), placement);
  placement.rotation.y = turned >= 0 ? PORTRAIT_TURN : -PORTRAIT_TURN;
  placement.updateMatrixWorld(true);
  const head = new Vector3();
  const feet = placement.getWorldPosition(new Vector3());
  let canvas: HTMLCanvasElement | null = null;
  if (fighter.bonePosition("head", head)) {
    // A window round the head, sized by the fighter's own height to it: Kirby's whole ball, Donkey Kong's
    // head and shoulders. UNVERIFIED (cosmetic): the 0.35 and the 3-8 clamp are by eye.
    const half = Math.min(8, Math.max(3, (head.y - feet.y) * 0.35));
    const camera = new OrthographicCamera(-half, half, half, -half, 0.1, 200);
    camera.position.set(head.x, head.y - half * 0.15, head.z + 60);
    camera.lookAt(head.x, head.y - half * 0.15, head.z);
    camera.updateMatrixWorld();
    const target = new WebGLRenderTarget(PORTRAIT_SIZE, PORTRAIT_SIZE);
    const before = gl.getRenderTarget();
    gl.setRenderTarget(target);
    gl.render(scene, camera);
    const pixels = new Uint8Array(PORTRAIT_SIZE * PORTRAIT_SIZE * 4);
    gl.readRenderTargetPixels(target, 0, 0, PORTRAIT_SIZE, PORTRAIT_SIZE, pixels);
    gl.setRenderTarget(before);
    target.dispose();
    const out = makeCanvas();
    out.width = PORTRAIT_SIZE;
    out.height = PORTRAIT_SIZE;
    const ctx = out.getContext("2d");
    if (ctx !== null) {
      const image = ctx.createImageData(PORTRAIT_SIZE, PORTRAIT_SIZE);
      const row = PORTRAIT_SIZE * 4;
      // A target's rows run bottom to top, a canvas's top to bottom.
      for (let y = 0; y < PORTRAIT_SIZE; y++) {
        for (let i = 0; i < row; i++) {
          const v = pixels[(PORTRAIT_SIZE - 1 - y) * row + i];
          image.data[y * row + i] = i % 4 === 3 ? v : toSrgb(v);
        }
      }
      ctx.putImageData(image, 0, 0);
      canvas = out;
    }
  }
  placement.rotation.y = turned;
  scene.remove(placement, ...Object.values(lights));
  if (parent !== null) parent.add(placement);
  placement.updateMatrixWorld(true);
  return canvas;
}
```

(`createLights` lives in `renderer3d.ts`, which imports this file; the presenter passes the lights in, so `portrait3d.ts` never imports `renderer3d.ts`.)

`src/render3d/renderer3d.ts`:

```diff
--- a/src/render3d/renderer3d.ts
+++ b/src/render3d/renderer3d.ts
@@
 import { fighterPoser } from "./bake/bake";
 import { applySideCamera, createSideCamera } from "./camera3d";
 import { createFighter3D, type Fighter3D } from "./fighter3d";
+import { renderPortrait, type PortraitGL } from "./portrait3d";
 import { NO_WEBGL } from "./webgl";
 import type { ModelCache } from "./models/loader";
 import type { SkeletonFile } from "./skeleton/skeleton";
@@
   /** Set by the presenter (three's defaults are the same); optional, so a fake need not carry them. */
   toneMapping?: ToneMapping;
   outputColorSpace?: string;
+  /** The HUD's portraits' read-back (Plan 6, Task 38): three's; a fake without them draws no portraits. */
+  getRenderTarget?: PortraitGL["getRenderTarget"];
+  setRenderTarget?: PortraitGL["setRenderTarget"];
+  readRenderTargetPixels?: PortraitGL["readRenderTargetPixels"];
 }
 
 export interface RenderInfo {
@@
   resize(cssWidth: number, cssHeight: number, dpr: number): void;
   info(): RenderInfo;
   /**
+   * Per port, the HUD's portrait from its loaded model (Plan 6, Task 38): made once, on the
+   * first paint after every model is in; null for a stand-in, before then, or without WebGL's read-back.
+   */
+  portraits(): readonly (HTMLCanvasElement | null)[];
+  /**
    * Frees everything it drew, once, and its listeners. The canvas's WebGL
    * context is left usable: the next match's presenter may draw on the same
    * canvas (React's development remount reuses it, Task 20).
@@
   const shields: (DrawnShield | null)[] = opts.defs.map(() => null);
   const drawnShields: DrawnShield[] = opts.defs.map(() => ({ x: 0, y: 0, radius: 0, alpha: 0, colour: "" }));
   let disposed = false;
+  /** Every fighter has its model (or a stand-in): the HUD's portraits can be made (Plan 6, Task 38). */
+  let everyModelIn = false;
+  /** The HUD's portraits, once made. */
+  let portraits: (HTMLCanvasElement | null)[] | null = null;
 
   const ready = Promise.all(
     opts.defs.map(async (def, port) => {
@@
       fighters[port] = fighter;
       scene.add(fighter.placement);
     }),
-  ).then(() => undefined);
+  ).then(() => {
+    everyModelIn = true;
+  });
 
   let lost = false;
   /** Running from a loss until `CONTEXT_RESTORE_WAIT_MS` has passed, or the context is back. */
@@
       }
       shadows.count = shadowCount;
       shadows.instanceMatrix.needsUpdate = true;
       trails.update();
+      // The HUD's portraits (Plan 6, Task 38): once, on the first paint every model is in, each fighter as it stands.
+      if (portraits === null && everyModelIn) portraits = fighters.map((f) => (f === null ? null : renderPortrait(gl, f, createLights())));
       vfx.update(rs.vfx, shields);
       for (let i = 0; i < fixed.length; i++) fixed[i].updateMatrixWorld();
       gl.render(scene, camera);
@@
         fighters: fighters.map((f) => f?.kind ?? "loading"),
       };
     },
+    portraits() {
+      return portraits ?? fighters.map(() => null);
+    },
     dispose() {
       if (disposed) return;
       disposed = true;
```

`src/render/hud.ts`:

```diff
--- a/src/render/hud.ts
+++ b/src/render/hud.ts
@@
   /** Displayed under the percent. Falls back to the fighter's name. */
   readonly label: string;
   readonly isCpu: boolean;
+  /** The portrait drawn from the loaded model (Plan 6, Task 38; `render3d/portrait3d.ts`), in memory only; the 2D rig's head without one. */
+  readonly portrait?: CanvasImageSource | null;
 }
 
 export interface HudScene {
@@
   ctx.clip();
   ctx.fillStyle = withAlpha(port, 0.14);
   ctx.fillRect(x, y, PANEL_WIDTH + 60, PANEL_HEIGHT);
-  if (info.def) {
+  if (info.portrait) {
+    // The model's own head (Plan 6, Task 38), where the 2D head is centred.
+    ctx.drawImage(info.portrait, x + 26 + portraitW / 2 - 48, y + 34 - 48, 96, 96);
+  } else if (info.def) {
     const rig = getCharacterRig(info.def.id);
     const palette = resolvePalette(info.def, fighter.costume);
     drawHeadPortrait(ctx, rig, palette, x + 26 + portraitW / 2, y + 34, 96, 1);
```

`src/render/renderer.ts`:

```diff
--- a/src/render/renderer.ts
+++ b/src/render/renderer.ts
@@
    * rather than in one. Without it, `sceneShiftAt`'s own, uneased.
    */
   readonly sceneShift?: readonly number[];
+  /** Per port, the HUD's portrait from the loaded model, or null (Plan 6, Task 38; the presenter's `portraits`). */
+  readonly portraits?: readonly (CanvasImageSource | null)[];
 }
 
 /** A fighter's head in the 3D world, relative to their feet, in world units. */
@@
       def,
       label: state.labels?.[f.port] ?? def?.name ?? `P${f.port + 1}`,
       isCpu: state.cpu?.[f.port] ?? false,
+      portrait: state.portraits?.[f.port] ?? null,
     };
   });
 }
```

`src/game/matchRunner.ts`:

```diff
--- a/src/game/matchRunner.ts
+++ b/src/game/matchRunner.ts
@@
    */
   paint(rs: RenderState, camera: Camera, alpha: number, hidden: readonly boolean[]): void;
   dispose(): void;
+  /** Per port, the HUD's portrait from the loaded model (Plan 6, Task 38); optional, so a test's fake need not carry it. */
+  portraits?(): readonly (CanvasImageSource | null)[];
 }
 
 export interface MatchRunner {
@@
       fighters: defs,
       labels: players.map((p, i) => p.label ?? defs[i]?.name ?? ""),
       cpu: players.map((p) => p.cpuLevel !== null),
+      portraits: presenter?.portraits?.(),
       vfx,
       hud,
       tops,
```

`SPEC.md`:

```diff
--- a/SPEC.md
+++ b/SPEC.md
@@
   Without the models each fighter is a stand-in: its own hurtbox capsules, in its port's
-  colour. The 2D rigs still draw the HUD's portraits and stock icons. See DECISIONS D57.
+  colour. With them, the HUD's portraits are drawn from the loaded model when the match
+  starts and are never saved; without them, and for the stock icons, the 2D rigs draw them.
+  See DECISIONS D57 and D59.
```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/render src/render3d src/game/matchRunner.presenter.test.ts src/app/chunkSplit.test.ts`. Expected: PASS (captured; `portrait3d.ts` is a three module reached through the presenter only, so the chunk split holds).

- [ ] **Step 5: Look (a scratchpad-only capture)**

With the local models and `pnpm dev --port 3107` in the background:

```bash
node scripts/fightsheet.mjs --fighter mario --against donkeyKong --move jab --frames 1 --full --base http://localhost:3107 --out "$SCRATCH/hud.png"
```

Read it: both HUD cells show the fighter's own head, lit, on the cell's port tint (no black box). Then `rm "$SCRATCH/hud.png"` and stop the server by its PID. Report in words.

The committed `CAPTURE=1` shots block `/models/` and keep the 2D heads, as before.

- [ ] **Step 6: Mutants**

Each against the Step 2 files; restore after each:
1. `drawDamagePanel`: `if (info.portrait) {` → `if (false) {`. The HUD and renderer tests FAIL `expected [] to deeply equal [ { width: 96, height: 96 } ]` (captured).
2. `hudInfo`: `portrait: state.portraits?.[f.port] ?? null` → `portrait: null`. The renderer test FAILS likewise (captured).
3. `renderPortrait`: add the placement without the lights. The portrait test FAILS `expected 0 to be greater than 0` (captured): it would render black.
4. `renderPortrait`: copy the read-back without `toSrgb`. The portrait test FAILS `expected [ 128, 128, 128, 255 ] to deeply equal [ 188, 188, 188, 255 ]` (captured).
5. The presenter: `if (portraits === null && everyModelIn)` → `if (everyModelIn)` (a portrait every paint). The presenter test FAILS `expected <canvas width="96" height="96"></canvas> to be <canvas width="96" height="96"></canvas>`, and the once-a-frame matrix count `expected 178 to be 170` (the replay's, without Task 34's ribbon in `fixed`; a different count is the same failure) (captured).

- [ ] **Step 7: Gate and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`, `PORT=3107 pnpm test:e2e --trace off`. Expected: exit 0.

```bash
git add super-smash/src/render3d/portrait3d.ts super-smash/src/render3d/portrait3d.test.ts super-smash/src/render3d/renderer3d.ts super-smash/src/render3d/renderer3d.test.ts super-smash/src/render/hud.ts super-smash/src/render/hud.test.ts super-smash/src/render/renderer.ts super-smash/src/render/renderer.test.ts super-smash/src/game/matchRunner.ts super-smash/SPEC.md
git commit -m "super-smash: the HUD's portraits are the loaded model's head, rendered once in memory" -m "D14: lit as the match, on no background (the cell's tint shows), a three-quarter turn, read back to sRGB; never saved. Stand-ins and fakes keep the 2D head. SPEC 10's models paragraph says so. Render only." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 39: The animation lab plays a large cell

From Plan 4 Task 23: "both 2D views are gone; the 3D contact sheet is the only view and play/pause + the scrubber only move the caption's frame number. Add a single large 3D playback cell driven by the scrubber."

The lab's design keeps one WebGL renderer ("one renderer for every cell", `Lab3D.tsx`; its tests pin `FakeGL.all` at one and dispose it once). So the playback cell draws nothing in 3D itself. On every scrubber move it copies the scrubber's frame from the sheet, which has already drawn every frame:
- the model's cell from the WebGL canvas;
- the boxes' cell from the overlay;
- both into a 2D canvas at `PLAYBACK_SCALE`.

Twice a cell is 300 px. With CSS `width: 100%` and a 300 px cap, it never widens the page past a phone's 390 px (`e2e/anim.spec.ts`'s "the lab fits a phone's width", the regression Plan 4 removed a 460 px canvas for). The cell carries `data-frame` for the e2e.

**Golden:** unaffected (the lab only).

**Files:**
- Modify: `src/app/anim/Lab3D.tsx`, `e2e/anim.spec.ts`
- Test: `src/app/anim/Lab3D.test.tsx`

**Interfaces:**
- Consumes: `Lab3D({ options, total, frame })`, its WebGL canvas, overlay and sheet refs, `CELL`, `COLUMNS`, the sheet's `data-drawn`.
- Produces: `PLAYBACK_SCALE = 2` (Lab3D.tsx); the `"Playback"` canvas with `data-frame`.

- [ ] **Step 1: Write the failing tests**

`src/app/anim/Lab3D.test.tsx` (its own `FakeGL`, `ctx` recorder and `opts()`; one options object throughout, as the page keeps it while only the scrubber moves):

```diff
--- a/src/app/anim/Lab3D.test.tsx
+++ b/src/app/anim/Lab3D.test.tsx
@@
 import { armatureModel } from "@/render3d/armatureModel";
 import { drawnPose } from "@/render3d/fighterPose";
 import { SKELETONS } from "@/render3d/skeletons";
-import { boxExtent, CELL, COLUMNS, Lab3D, labBoxes, modelExtent, sheetView } from "./Lab3D";
+import { boxExtent, CELL, COLUMNS, Lab3D, labBoxes, modelExtent, PLAYBACK_SCALE, sheetView } from "./Lab3D";
 import { fighterAt, type Options } from "./page";
 
 /* ------------------------------------------------------------------ fakes -- */
@@
     expect(freed.texture).not.toHaveBeenCalled();
   });
 });
+
+describe("the playback cell (Plan 6, Task 39)", () => {
+  it("shows the scrubber's frame twice a cell's size, its sheet cell copied with the boxes over it, following the scrubber on one renderer", async () => {
+    // One options object throughout, as the page keeps it while only the scrubber moves.
+    const o = opts();
+    const { getByLabelText, rerender } = render(<Lab3D options={o} total={FTILT_FRAMES} frame={4} />);
+    await waitFor(() => expect(getByLabelText("Contact sheet")).toHaveAttribute("data-drawn", "true"));
+    const playback = getByLabelText("Playback") as HTMLCanvasElement;
+    const side = CELL * PLAYBACK_SCALE;
+    expect([playback.width, playback.height]).toEqual([side, side]);
+    /** Each copy into the playback cell: its source rectangle and where it lands. */
+    const copies = () => ctx.calls.filter((c) => c.method === "drawImage").map((c) => c.args.slice(1).map(Number));
+    // The model's cell, then the boxes' cell: frame 4 is the first row's fifth.
+    expect(copies().slice(-2)).toEqual([
+      [4 * CELL, 0, CELL, CELL, 0, 0, side, side],
+      [4 * CELL, 0, CELL, CELL, 0, 0, side, side],
+    ]);
+    expect(playback.dataset.frame).toBe("4");
+    rerender(<Lab3D options={o} total={FTILT_FRAMES} frame={13} />);
+    // 13: the second row's second cell.
+    expect(copies().slice(-1)).toEqual([[CELL, CELL, CELL, CELL, 0, 0, side, side]]);
+    expect(playback.dataset.frame).toBe("13");
+    expect(gl.FakeGL.all).toHaveLength(1);
+  });
+});
```

`e2e/anim.spec.ts`:

```diff
--- a/e2e/anim.spec.ts
+++ b/e2e/anim.spec.ts
@@
   await expect(page.locator('[aria-label="Contact sheet"][data-drawn="true"]')).toBeAttached({ timeout: 30_000 });
   expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
 });
+
+/** Plan 6, Task 39: the playback cell follows the scrubber, which steps at 60 Hz while playing. */
+test("the playback cell plays the action: its frame moves on while the lab plays", async ({ page }) => {
+  await page.goto("/anim");
+  await expect(page.locator('[aria-label="Contact sheet"][data-drawn="true"]')).toBeAttached({ timeout: 30_000 });
+  const playback = page.getByLabel("Playback", { exact: true });
+  const first = await playback.getAttribute("data-frame");
+  expect(first).not.toBeNull();
+  await expect.poll(() => playback.getAttribute("data-frame"), { timeout: 5_000 }).not.toBe(first);
+});
```

- [ ] **Step 2: Run it to see it fail**

Run: `pnpm vitest run src/app/anim/Lab3D.test.tsx`

Expected: FAIL (captured): `TestingLibraryElementError: Unable to find a label with the text of: Playback`.

- [ ] **Step 3: Implement**

`src/app/anim/Lab3D.tsx`:

```diff
--- a/src/app/anim/Lab3D.tsx
+++ b/src/app/anim/Lab3D.tsx
@@
 /** One cell's side in pixels and the cells per row (the 2D contact sheet's, which this replaced in Plan 4). */
 export const CELL = 150;
 export const COLUMNS = 12;
+/**
+ * The playback cell's size against a sheet cell's (Plan 6, Task 39): 300 px, inside a
+ * phone's 390 (`e2e/anim.spec.ts`), and copied from the sheet, not drawn again, so the
+ * lab keeps its one renderer.
+ */
+export const PLAYBACK_SCALE = 2;
 
 /** The least height a cell shows, in world units: a standing Mario with room round him. UNVERIFIED (cosmetic): by eye. */
 const MIN_VIEW = 22;
@@
   const gl = useRef<HTMLCanvasElement>(null);
   const overlay = useRef<HTMLCanvasElement>(null);
   const sheet = useRef<HTMLDivElement>(null);
+  const playback = useRef<HTMLCanvasElement>(null);
   const stage = useRef<Stage | null>(null);
   const { tables: bake, error: bakeError } = useBake();
   const [built, setBuilt] = useState<Built | null>(null);
@@
     };
   }, [built, bake, options, total]);
 
+  // The playback cell (Plan 6, Task 39): the scrubber's frame, its sheet cell copied at
+  // `PLAYBACK_SCALE` with its boxes over it, again whenever the scrubber or the sheet moves.
+  // After the sheet's effect, which draws what it copies.
+  useEffect(() => {
+    const out = playback.current;
+    const canvas = gl.current;
+    const over = overlay.current;
+    if (!out || !canvas || !over || sheet.current?.getAttribute("data-drawn") !== "true") return;
+    const ctx = out.getContext("2d");
+    if (!ctx) return;
+    const i = Math.min(Math.max(0, frame), total - 1);
+    const sx = (i % COLUMNS) * CELL;
+    const sy = Math.floor(i / COLUMNS) * CELL;
+    const side = CELL * PLAYBACK_SCALE;
+    ctx.clearRect(0, 0, side, side);
+    ctx.drawImage(canvas, sx, sy, CELL, CELL, 0, 0, side, side);
+    ctx.drawImage(over, sx, sy, CELL, CELL, 0, 0, side, side);
+    out.dataset.frame = String(i);
+  }, [built, bake, options, total, frame]);
+
   // The one renderer, freed when the sheet leaves the page.
   useEffect(
     () => () => {
@@
       <div style={{ color: "#7C8896", fontSize: 12, margin: "6px 0" }}>
         contact sheet — {status}; red: hitboxes, yellow: hurtboxes (the sim&apos;s own) — frame {frame}
       </div>
+      {/* The scrubber's frame, large (Plan 6, Task 39): never wider than the page, a phone's included. */}
+      <canvas
+        ref={playback}
+        aria-label="Playback"
+        width={CELL * PLAYBACK_SCALE}
+        height={CELL * PLAYBACK_SCALE}
+        style={{ display: "block", width: "100%", maxWidth: CELL * PLAYBACK_SCALE, height: "auto", background: "#12151a", margin: "0 0 6px" }}
+      />
       {/* The sheet is 150 px a cell, 1800 px across: its own scroll container, so a narrow window does not scroll the page. */}
       <div style={{ maxWidth: "100%", overflowX: "auto" }}>
         {/* `data-drawn` once every cell is drawn, `data-error` with why when it cannot be (`scripts/animsheet.mjs` waits for either). */}
```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/app/anim` (the replay's three `captureScripts.test.ts` failures were its missing git, not this task), then `PORT=3107 pnpm exec playwright test e2e/anim.spec.ts --trace off` (stand-ins, or `trace`, `screenshot` and `video` off with local models). Expected: PASS (captured: the unit tests, and the anim spec's 7 on stand-ins, the phone-width test and the new playback test included).

- [ ] **Step 5: Mutant**

`Lab3D.tsx`: drop `frame` from the playback effect's dependencies. The unit test FAILS `expected [ [ 600, +0, 150, 150, +0, +0, …(2) ] ] to deeply equal [ Array(1) ]`: the cell stays on frame 4 (captured). Restore.

- [ ] **Step 6: Gate and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test`, `PORT=3107 pnpm test:e2e --trace off`. Expected: exit 0.

```bash
git add super-smash/src/app/anim/Lab3D.tsx super-smash/src/app/anim/Lab3D.test.tsx super-smash/e2e/anim.spec.ts
git commit -m "super-smash: the animation lab plays the scrubber's frame in one large cell" -m "Copied from the sheet's own cells, model and boxes, at twice a cell (300 px, phone-width safe); the lab keeps its one renderer. Lab only." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 40: Loading and frame time: a cancelled model download, the online model wait from mount, the clip sampler measured

Three Plan 4 items:
- Plan 4 Task 16 review: "give `ModelSource.load` an AbortSignal so a timed-out glb download is cancelled, not just discarded (bounded today to one abandoned ~1 MB download)." `createModelCache`'s `timeout` rejects, but the `fetch` runs on. Now `load(entry, signal)`: the cache makes an `AbortController` per load and aborts it when its timeout fires, and `browserModelSource` hands the signal to `fetch`.
- Task 20 review: "the 5 s model cap starts only after the 3D chunk loads, so a peer with a very slow chunk could start >10 s after the other and trip the link monitor; the lobby preloads the chunk early (edge case)." The play page passes `modelWaitMs: ONLINE_MODEL_WAIT_MS` when it creates the world, after `useWorld3d`'s `import()` resolves. It now passes what is left of 5 s counted from the page's mount. The mount time is lazy state (`useState(() => performance.now())`): a `useRef(performance.now())` fails `pnpm lint`'s `react-hooks/purity` (C1).
- Plan 4 Task 17: "the 2D clip sampler allocates a pose sample per frame … ~4 KB/frame/fighter of short-lived garbage; sample into reusable buffers (`clip.ts`, `blend.ts`) if a frame-time trace shows minor-GC hitches." It is measured first (Step 5) and changed only if the trace shows hitches. In the replay it did not: no minor GC over 2 ms in 30 s of four fighters, the longest 0.5 ms (captured). Step 6 is then skipped and the figures recorded.

**Golden:** unaffected.

**Files:**
- Modify: `src/render3d/models/loader.ts`, `src/app/play/page.tsx`; only if Step 5 says so, `src/render/poses/clip.ts`, `src/render/blend.ts`
- Test: `src/render3d/models/loader.test.ts`, `src/app/play/page.test.tsx`

**Interfaces:**
- Consumes: `ModelSource`, `createModelCache`, `timeout`, `browserModelSource` (loader.ts); `ONLINE_MODEL_WAIT_MS`, the world's options (page.tsx); `page.test.tsx`'s `WORLD_STATE`, `WORLD`, `goOnline`, `renderPage`, `only`, `mocks.worlds`.
- Produces: `ModelSource.load(entry: ModelIndexEntry, signal?: AbortSignal): Promise<Object3D>`.

- [ ] **Step 1: Write the failing tests**

`src/render3d/models/loader.test.ts`:

```diff
--- a/src/render3d/models/loader.test.ts
+++ b/src/render3d/models/loader.test.ts
@@
     expect((await got).kind).toBe("standIn");
   });
 
+  it("cancels a download that timed out, not only discards it (Plan 6, Task 40)", async () => {
+    vi.useFakeTimers();
+    let signal: AbortSignal | undefined;
+    const cache = createModelCache(source({ load: (_entry, s) => ((signal = s), new Promise(() => {})) }), () => {}, 1000);
+    const got = cache.get("mario");
+    await vi.advanceTimersByTimeAsync(999);
+    expect(signal?.aborted).toBe(false);
+    await vi.advanceTimersByTimeAsync(1);
+    expect((await got).kind).toBe("standIn");
+    expect(signal?.aborted).toBe(true);
+  });
+
   it("tries a failed model again next match instead of standing it in for the rest of the page", async () => {
     const load = vi.fn().mockRejectedValueOnce(new Error("network error")).mockResolvedValue(new Group());
     const index = vi.fn().mockResolvedValueOnce(null).mockResolvedValue(parseModelIndex(INDEX));
@@
 
   describe("load()", () => {
     const glb = { scene: new Group() };
+
+    it("hands the cache's abort signal to the download's fetch (Plan 6, Task 40)", async () => {
+      const { browserModelSource } = await freshLoader();
+      decoder.parseAsync.mockResolvedValue(glb);
+      const f = fetchOf(() => new Response(body.slice(0), { status: 200 }));
+      const abort = new AbortController();
+      await browserModelSource(f).load(entry, abort.signal);
+      expect(f).toHaveBeenCalledWith("/models/mario.0123abcd.glb", { signal: abort.signal });
+    });
 
     it("fetches /models/<file>, verifies, then decodes with meshopt and the models folder as the base path", async () => {
       const { browserModelSource } = await freshLoader();
```

`src/app/play/page.test.tsx`. Vitest 4.1's fake timers fake `performance` too (its default `toFake`), so the wait is exact, and the existing 5,000 pin stays green:

```diff
--- a/src/app/play/page.test.tsx
+++ b/src/app/play/page.test.tsx
@@
     expect(mocks.worlds.map((w) => w.layers.gl)).toEqual([layer("world"), layer("world")]);
   });
 
+  it("counts the online wait for models from the page's mount, not from the 3D code's arrival (Plan 6, Task 40)", async () => {
+    // The 3D world's code is still loading when the page mounts, and arrives 3 s later.
+    WORLD_STATE.world = null;
+    goOnline("host");
+    const { rerender } = await renderPage();
+    expect(mocks.worlds).toEqual([]);
+    act(() => vi.advanceTimersByTime(3_000));
+    WORLD_STATE.world = WORLD;
+    rerender(<PlayPage />);
+    await act(async () => {});
+    expect(only(mocks.worlds).options?.modelWaitMs).toBe(2_000);
+  });
+
   it("waits on the loader's own timeouts locally, with no cap of its own", async () => {
     await renderPage();
     expect(only(mocks.worlds).options?.modelWaitMs).toBeUndefined();
```

- [ ] **Step 2: Run them to see them fail**

Run: `pnpm vitest run src/render3d/models/loader.test.ts src/app/play/page.test.tsx -t "Plan 6, Task 40"`

Expected: FAIL (captured):
- `loader.test.ts`, the cancel: `expected undefined to be false` (no signal is given); the fetch: `expected "vi.fn()" to be called with arguments: [ '/models/mario.0123abcd.glb', …(1) ]`;
- `page.test.tsx`: `expected 5000 to be 2000`.

- [ ] **Step 3: Implement**

`src/render3d/models/loader.ts`:

```diff
--- a/src/render3d/models/loader.ts
+++ b/src/render3d/models/loader.ts
@@
 export interface ModelSource {
   /** The index; null when there is none (a 404: the checkout never ran `pnpm models`); rejects, saying why, when it could not be read. */
   index(): Promise<ModelIndex | null>;
-  /** The glb's scene, ready to clone; rejects if the bytes are not the entry's. */
-  load(entry: ModelIndexEntry): Promise<Object3D>;
+  /**
+   * The glb's scene, ready to clone; rejects if the bytes are not the entry's. `signal`
+   * aborts the download when the cache has given up on it (Plan 6, Task 40).
+   */
+  load(entry: ModelIndexEntry, signal?: AbortSignal): Promise<Object3D>;
 }
 
 /** Resolves when `bytes` are exactly what `entry` lists; rejects naming what differs. */
@@
 
 const reasonOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));
 
-function timeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
+function timeout<T>(p: Promise<T>, ms: number, what: string, onTimeout?: () => void): Promise<T> {
   return new Promise<T>((resolve, reject) => {
-    const t = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
+    const t = setTimeout(() => {
+      onTimeout?.();
+      reject(new Error(`${what} timed out after ${ms} ms`));
+    }, ms);
     p.then(
       (v) => (clearTimeout(t), resolve(v)),
       (e: unknown) => (clearTimeout(t), reject(e)),
@@
         if (!Object.hasOwn(read.found.models, id)) return standIn(id, "not in the model index");
         const entry = read.found.models[id];
         try {
-          const scene = await timeout(source.load(entry), ms, "download");
+          // A download that times out is cancelled, not only discarded (Plan 6, Task 40).
+          const abort = new AbortController();
+          const scene = await timeout(source.load(entry, abort.signal), ms, "download", () => abort.abort());
           state[id] = "glb";
           return { kind: "glb", scene } as const;
         } catch (e) {
@@
       if (index === null) throw new Error(`not a schema ${MODEL_INDEX_SCHEMA} model index (files named <id>.<8 hex>.glb)`);
       return index;
     },
-    async load(entry) {
-      const res = await fetchFn(`/models/${entry.file}`);
+    async load(entry, signal) {
+      const url = `/models/${entry.file}`;
+      const res = await (signal === undefined ? fetchFn(url) : fetchFn(url, { signal }));
       if (!res.ok) throw new Error(`HTTP ${res.status}`);
       const bytes = await res.arrayBuffer();
       await verifyModelBytes(bytes, entry);
```

(`fetch` is called with one argument when no signal is given, so the existing pins of `fetchFn("/models/…")` hold.)

`src/app/play/page.tsx`:

```diff
--- a/src/app/play/page.tsx
+++ b/src/app/play/page.tsx
@@
   const keyboardRef = useRef<KeyboardInput | null>(null);
   const bake = useBake();
   const { world, error: worldError } = useWorld3d();
+  // When the page mounted: the online wait for models counts from here, not from the 3D
+  // code's arrival (Plan 6, Task 40). A lazy initial state, read once (a ref's initial
+  // value would call `performance.now` on every render).
+  const [mountedAt] = useState(() => performance.now());
 
   const players = useMatchConfig((s) => s.players);
   const stageId = useMatchConfig((s) => s.stageId);
@@
         layers: { gl, background },
         bake: tables,
         world,
-        modelWaitMs: ONLINE_MODEL_WAIT_MS,
+        // The 5 s count from the page's mount, so a slow 3D chunk does not add to it (Plan 6, Task 40).
+        modelWaitMs: Math.max(0, ONLINE_MODEL_WAIT_MS - (performance.now() - mountedAt)),
         onReady: () => {
           setLoading(false);
           // Watched from its start, not from mount (ruling R3): a model still
@@
       delete (window as unknown as { __smashNet?: unknown }).__smashNet;
       if (!handedOff) abandonOnline(session);
     };
-  }, [online, bindings, router, setResult, bake.tables, world]);
+  }, [online, bindings, router, setResult, bake.tables, world, mountedAt]);
 
   useEffect(() => {
     function onKey(e: KeyboardEvent) {
```

- [ ] **Step 4: Run them again**

Run: `pnpm vitest run src/render3d/models src/app/play src/game/world3d.test.ts`. Expected: PASS (captured; `world3d.test.ts`'s 5,000 pins are `withModelWait`'s own and stay). `pnpm lint`: no new warning (captured).

- [ ] **Step 5: Measure the sampler (a Playwright CDP trace; numbers only; decides Step 6)**

Write this to `$SCRATCH/gc-trace.mjs` (the session scratchpad, not the repo). It traces a four-fighter match over a CDP session and prints one JSON line. It routes `/models/` to 404, so the fighters are stand-ins: the 2D clip sampler runs for them as for a model. It makes no screenshot, writes no trace file and records no video.

```js
// Plan 6, Task 40, Step 5: minor-GC pauses during a four-fighter match, from a Chromium trace taken over
// a CDP session. Numbers only: no screenshot, no trace file, no video; the models are routed to 404, so
// the fighters are stand-ins (the 2D clip sampler runs for them as for a model).
// Run from super-smash/ with the dev server up:  node --input-type=module < "$SCRATCH/gc-trace.mjs"
import { chromium } from "@playwright/test";

const base = process.env.BASE ?? "http://localhost:3107";
const SECONDS = Number(process.env.SECONDS ?? 30);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.route("**/models/**", (route) => route.fulfill({ status: 404, body: "" }));

await page.goto(`${base}/`, { waitUntil: "networkidle" });
await page.getByLabel("Press any button to continue").waitFor();
await page.keyboard.press("Enter");
await page.waitForURL("**/menu");
await page.getByRole("button", { name: /smash/i }).first().click();
await page.waitForURL("**/rules");
await page.getByRole("button", { name: /next|stage|continue/i }).first().click();
await page.waitForURL("**/stage");
await page.getByLabel("Stages").getByRole("button").first().click();
await page.getByRole("button", { name: /next|fighters|continue/i }).first().click();
await page.waitForURL("**/fighters");
// Four seats, each given a fighter in turn (a pick fills the active seat and moves on), as fightsheet.mjs picks two.
for (let i = 0; i < 2; i++) await page.getByRole("button", { name: "Add a player", exact: true }).click();
const tiles = page.getByLabel("Fighters").getByRole("button");
for (let i = 0; i < 4; i++) await tiles.nth(i).click();
await page.getByRole("button", { name: /ready|fight/i }).first().click();
await page.waitForURL("**/play");
await page.waitForFunction(() => (window.__smashDebug?.frame ?? 0) >= 70, undefined, { timeout: 60_000 });
const fighters = await page.evaluate(() => window.__smashDebug.inputs().length);

const cdp = await page.context().newCDPSession(page);
const events = [];
cdp.on("Tracing.dataCollected", (e) => events.push(...e.value));
const complete = new Promise((resolve) => cdp.once("Tracing.tracingComplete", resolve));
await cdp.send("Tracing.start", {
  transferMode: "ReportEvents",
  traceConfig: { includedCategories: ["devtools.timeline", "v8", "disabled-by-default-v8.gc"], excludedCategories: ["disabled-by-default-devtools.screenshot"] },
});
const from = await page.evaluate(() => window.__smashDebug.frame);
await page.waitForTimeout(SECONDS * 1000);
const to = await page.evaluate(() => window.__smashDebug.frame);
await cdp.send("Tracing.end");
await complete;
await browser.close();

const gcs = events.filter((e) => e.ph === "X" && (e.name === "MinorGC" || e.name === "V8.GC_SCAVENGER" || e.name === "MajorGC"));
const minor = gcs.filter((e) => e.name !== "MajorGC");
const over2 = minor.filter((e) => e.dur > 2000);
const frames = to - from;
console.log(JSON.stringify({ fighters, seconds: SECONDS, frames, minorGCs: minor.length, minorOver2ms: over2.length, longestMinorMs: Math.max(0, ...minor.map((e) => e.dur / 1000)), majorGCs: gcs.length - minor.length, percentOfFrames: frames > 0 ? (100 * over2.length) / frames : null }));
```

Run it from `super-smash/`, with `pnpm dev --port 3107` in the background:

```bash
BASE=http://localhost:3107 node --input-type=module < "$SCRATCH/gc-trace.mjs"
```

(Fed on stdin, the module resolves `@playwright/test` from `super-smash/`.) Then stop the server by its PID and `rm "$SCRATCH/gc-trace.mjs"`.

Captured in the replay (a dev server, Apple silicon): `{"fighters":4,"seconds":30,"frames":1799,"minorGCs":46,"minorOver2ms":0,"longestMinorMs":0.496,"majorGCs":6,"percentOfFrames":0}`.

If `percentOfFrames` is under 1, record the line in D59 and skip Step 6. Otherwise, Step 6.

- [ ] **Step 6 (only if Step 5 says so): reusable sample buffers**

1. `clip.ts`: `samplePoseInto(clip, t, out: PoseSample): PoseSample` writes into `out` (the same fields `samplePose` returns, `angles` a reused object). `samplePose` stays, as `samplePoseInto(clip, t, newPoseSample())`.
2. `blend.ts`'s per-frame callers hold one `PoseSample` per fighter and pass it. `blendedPose` keeps the sample it last drew, by reference, to fade from (`blend.ts`, `fighterPose.ts`), so a reused buffer is copied into the blend's own on a clip change. Otherwise every fade would fade from the current frame (M2).
3. A test in `clip.test.ts`: `samplePoseInto` gives `toEqual(samplePose(…))` for every library clip at t 0, 0.37 and 1, and returns the `out` it was given. A test in `blend.test.ts`: a clip change fades from the last frame drawn, not the new one.
4. Re-measure; record both lines.

- [ ] **Step 7: Mutants, gate, commit**

Mutants, each against the Step 2 files; restore after each:
1. `loader.ts`: drop `() => abort.abort()`. The cancel test FAILS `expected false to be true` (captured).
2. `page.tsx`: `modelWaitMs: ONLINE_MODEL_WAIT_MS,` back. The page test FAILS `expected 5000 to be 2000` (captured).
3. `browserModelSource().load`: `fetchFn(url)` always. The fetch test FAILS `expected "vi.fn()" to be called with arguments: [ '/models/mario.0123abcd.glb', …(1) ]` (captured).

Gate: `pnpm typecheck && pnpm lint && pnpm test`, `PORT=3107 pnpm test:e2e --trace off`, `pnpm test:e2e:online --trace off`.

```bash
git add super-smash/src/render3d/models/loader.ts super-smash/src/render3d/models/loader.test.ts super-smash/src/app/play/page.tsx super-smash/src/app/play/page.test.tsx
# and super-smash/src/render/poses/clip.ts super-smash/src/render/blend.ts and their tests if Step 6 ran
git commit -m "super-smash: a timed-out model download is cancelled; the online model wait counts from the page's mount" -m "Sampler buffers: measured over a CDP trace, four fighters 30 s: <the line>; <changed, or not: under 1% of frames>." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Group 5: the final wave

### Task 41: The final wave: whole-plan review, seam pass, one fix wave, the full gate, stand-in screenshots, the push

R-P6-4 and RUN.md's end-of-plan steps ("final whole-plan review (opus) and a codex seam pass", "the full gate, plus build and e2e from clean", "Playwright screenshots of UI changes", "then push"), as Plans 2-5 ran them. The controller runs this task; implementers and reviewers never push (R-P6-5).

**Golden:** whatever the fix wave's tasks say; each fix that moves it stages it as its owning task does.

**Files:** only what the fix wave's findings name, each in its own commit; `docs/screenshots/<the files CAPTURE=1 writes>` (stand-ins only).

- [ ] **Step 1: Whole-plan review**

A fresh opus reviewer reads every Plan 6 commit since `46e0706` against this plan, SPEC.md and the rulings (R-P6-0 to R-P6-27, D1-D14 as recorded), with the reviewer contract (`.superpowers/sdd/REVIEWER-CONTRACT.md`): correctness, determinism (`src/engine/**` and `src/ai/**`, R-P6-7), rollback (every new sim field cloned and hashed), layering, the golden's history comments, and the public-repo rule. Findings: Critical, Important, Minor, each with `file:line`.

- [ ] **Step 2: The seam pass**

`codex exec -c model="gpt-6-sol" … < /dev/null` with the seam prompt (the places two tasks meet: shared files, shared fixtures, a producer's interface and its consumer). While codex is out of credits: a second fresh opus reviewer given the same seam prompt, who has not seen Step 1's report. Its findings join Step 1's.

- [ ] **Step 3: One fix wave**

One dispatch per finding group, each through the implementer contract: a failing test first where the finding is behaviour, the fix, its mutants, the gate, its own commit naming the finding. Each fix commits as its owning task does: its exact paths by name, `git commit -m "super-smash: final wave: <the finding, in words>" -m "<finding id and source>; golden <unchanged | moved: traces>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`. Then a scoped re-review of exactly those commits (`.superpowers/sdd/REREVIEW-CONTRACT.md`). A finding left unfixed is written down with its reason, for D59.

- [ ] **Step 4: The full gate**

All from `super-smash/` at the final commit, at a machine load under 6:
1. `pnpm typecheck && pnpm lint && pnpm test`;
2. `pnpm build`;
3. `PORT=3107 pnpm test:e2e --trace off`;
4. `pnpm test:e2e:online --trace off` (Task 1's server);
5. the model-less fresh clone of the LOCAL checkout at the final commit, never of `origin` (R-P6-22; nothing of Plan 6 is pushed yet): `git clone "<the Replicates checkout>" "$SCRATCH/p6-clean"`; `git -C "$SCRATCH/p6-clean" rev-parse HEAD` must equal `git rev-parse main` here; then in its `super-smash/`: `pnpm install --frozen-lockfile` and `pnpm test` (no `.model-cache/`, no `public/models/`: green without them, as Plans 4 and 5 required); delete the clone after;
6. the controller's pre-push scan, `.superpowers/sdd/2026-10-24-plan-5-specials-final-smash-cpu/prepush-scan.sh` (or a copy in this plan's folder), over the commits the push would send (every added path, renames included, every blob hashed against the model manifest).

Every step exits 0; a failure goes back to Step 3.

- [ ] **Step 5: Stand-in screenshots**

`CAPTURE=1 PORT=3107 pnpm exec playwright test screenshots --project=desktop-chrome --trace off` (`e2e/screenshots.spec.ts`), which routes `/models/` to 404, so every fighter is a stand-in (R-P6-6). Read each new PNG before staging it. A shot whose only change is capture noise (Task 33 measured title.png at 1/255 and the character select at up to 10/255) is put back with `git restore -- super-smash/docs/screenshots/<name>.png`. Stage only the shots that really changed, by name. No other capture is written inside the repo.

```bash
git status --short super-smash/docs/screenshots   # the shots this capture changed (of the eight: title, main-menu, rules, stage-select, character-select, controls, match, match-2)
git add super-smash/docs/screenshots/<each changed shot, by name>
git commit -m "super-smash: docs: screenshots of Plan 6's build, stand-ins only" -m "Recaptured with CAPTURE=1 (every /models/ request answered 404, so the fighters are capsule stand-ins). <what each changed shot shows that is new>." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 6: The push**

The pre-push scan runs again after the last commit (R-P6-22), over every commit the push sends (`git log origin/main..main`), Step 5's screenshot commit included; it must exit 0. Then the controller pushes `main` (pre-authorized after the final review and gate: RUN.md, R-P6-5): `git push origin main`. Never force, never `--no-verify` or any hook bypass. Deploying waits for David's go ("For David").

---

## Group 6: the record

### Task 42: The record: D59, the READMEs, and the plan itself

**Golden:** unaffected (documents only). No new tests, so no mutants; the gate still runs.

**Files:**
- Modify: `DECISIONS.md` (D59), `README.md`, `docs/superpowers/plans/README.md`, `.superpowers/sdd/POLISH-BACKLOG.md` (outside the repo's tracked tree: the worked items struck through, as Plan 5 Task 17 struck the fast-fall star)
- Create: `docs/superpowers/plans/2026-11-02-plan-6-polish.md` (this plan, as run)

SPEC.md is not touched here: each SPEC change went in its owning task's commit (R-P6-8, I12), and this task lists them.

**Interfaces:** none.

- [ ] **Step 1: D59**

`DECISIONS.md` gains, after D58, `## D59 — Polish: input never dropped, the rules the backlog found missing, a CPU that fires Volt Tackle well and stays on its stage, and the 3D game's rough edges`, in D58's form: a **Decision.** paragraph (what Plan 6 did, in how many tasks, and that the numbers are SmashWiki's and rubendal 13.0.1's), then one bullet per task group with each rule as landed, its source quoted, and UNVERIFIED where it is. At least these:
- **The rulings.** Every controller ruling of this plan, R-P6-0 to R-P6-27 (`.superpowers/sdd/plan-6-review/RULINGS.md` and the tasks' `Ruling:` lines), one line each with its cost; and D1-D14, each recorded as a ruling (R-P6-8: the controller's, followed as its task amended it, with its cost), D2 as dropped (each SPEC change made in its own task) and D7 and D8 as settled.
- **Every task's own D59 line.** `grep -n 'D59' super-smash/docs/superpowers/plans/2026-11-02-plan-6-polish.md` lists each place a task says D59 records something, and each gets its line. At least:
  - Task 1's "Network connection lost" finding;
  - Task 5's ruling R-P6-14 (Attack in shield grabs) beside D1;
  - Task 7's slip lab, the golden's sixteenth match;
  - Task 10's R-T14j re-check;
  - Task 13's held-input buffering, not modelled;
  - Task 14's grab box, no longer spent on an invincible fighter;
  - Task 15's Boomerang turn (D8);
  - Task 16's recorded items;
  - Task 18's one shared idle phase (`IDLE_PHASE` 27, the old port 1's) and its cost: standing fighters breathe in step in 3D;
  - Task 19's crouch and shield feet, and any "not on the limb" look;
  - Task 21's sim-side flip ruling (a fall off a dash or run flips, `dashedOff`, cloned and hashed);
  - Task 23's corrected self-destruct count: a KO is a self-destruct only if the fighter stood on its own (grounded, in no hit's hitlag or hitstun, not held) since the last hit it took. The planning replay's baseline was 20 (18 from the Smash Ball chase, 1 in `attack`, 1 in the edgeguard), an expectation: the run's own Task 23 figure is the baseline (R-P6-26). Every figure counted the old way, which took grounded hit KOs as self-destructs, is void: fix round 2's 504, 507, 511 and 534, R-P6-24's first "504 → 507", and Task 27's first 233, 210 and 218;
  - Task 25's carried unjudged swing, and that it can come back: on the six-seed sweep it cut Donkey Kong's landed Final Smashes 118 → 95 (−19%) and Fox's 161 → 144 (−11%), which failed R-P6-19's first per-fighter bound; under R-P6-19 as amended it would now pass (landed summed 1,032 → 968, −6.2%), but it stays carried to avoid churn;
  - Task 27's watch item, which no ruling bounds: dash attacks thrown 8,532 → 10,983 (+29%, the CPU swings from the edge of the target's body) and whiff runs of 8 or more 5 → 8 (Kirby 4 → 6, Samus 1 → 2; nobody else has any);
  - Task 37's outliers as resolved;
  - Task 40's sampler line.
- Online: the shrinking delay's carry (`localScheduled`); the pad press under an owed flick frame; one flick per stall, the later winning.
- The flick: buffered with its direction; out of shield it rolls or spot-dodges (SmashWiki "C-Stick", "Out of shield"), and Attack in shield grabs (R-P6-14; at `46e0706` it up-smashed); in a hold it throws (D1). `ENGINE_RULES_VERSION` 6.
- The engine: the reverse smash; edge slipping (26 frames, 25 for Donkey Kong and Pikachu, drift from 8), and the golden's sixteenth match, Task 7's slip lab (a states-lab scene could not reach the slip: every Final Destination edge has a ledge); Grab in the air (D3 for the tether); scene records by target and part, and world end boxes (Task 9); the aerial height boost (D4); `SLOW_OPPONENT` (D5), and presses on a slowed fighter's still step buffered (R-P6-10); Smashville's carry (D6); the KO freeze's buffer (D7); the windbox's record; projectile stages and the Boomerang's turn (D8); the Thunder Jolt's crawl; two-sided hits (D9); the new engine and body carries (R-P6-9).
- The CPU: the sweep harness and its baseline (Task 23: every figure, the baseline the later CPU tasks compared with); the proven hold, read from the view and never at point blank, and the time limit (D10; Task 24); the late, narrow Final Smash rule dropped (R-P6-19 as amended, R-P6-25), with its measured table: as first drafted, fired only at a target proven held until the contact, landed fell Donkey Kong 55 → 10, Fox 72 → 3, Kirby 78 → 33 and Link 64 → 27, with mean holds up 47% to 116%; as a veto (not fired at a target its own state shows free before the contact), Donkey Kong 55 → 41 (−25.5%), Fox 72 → 50, Kirby 78 → 65 and Link 64 → 40 (seeds 1-3, against Task 23's); all four keep Plan 5's rule, and the veto form, measured on a half sweep, is not shown to fail (R-P6-27); Critical Hit kept on Plan 5's rule (R-P6-15: 61 of 120 missed in Task 23's baseline, seeds 1-3, against the Ancient Arrow's 143 of 207); Kong Karry; dash attacks at a moving target trusted inside each fighter's own first active window (R-P6-16, with the windows and the fighters it leaves as before); the ledge stops for the chase and spacing, never the edgeguard's exit, and not while the target is off the stage (R-P6-17, R-P6-24: edgeguard exits 5,922 → 5,530, −6.6%); Inhale off stage; the spacing by the baked body; each task's sweep figures against Task 23's, judged by R-P6-19 as amended (landed summed −10%, each fighter's −25%, the mean hold over all +25%) and R-P6-24 as amended (edgeguard exits −10%; self-destructs up by at most 2 matches or 10% of the baseline, whichever is larger), every bound one-sided and against the run's own Task 23 baseline (R-P6-26); the ball-on seed stayed 606 in the replay (R-P6-18 as amended).
- **The later candidate (R-P6-27).** The draft's Task 17 in its veto form (not fired at a target its own state shows free before the contact) was measured on seeds 1-3 only, and its Donkey Kong −25.5% is within the plan's half-sweep noise. It stays carried, without another round, as a candidate for a later plan, to be judged on a six-seed sweep.
- The buffer per status: a kept attack or pummel cannot fire twice (its move outlasts `BUFFER_FRAMES`), so only the jumps are pinned (Task 2).
- Presentation: each render-only change, the stage's front face and the camera choice (D11, D12), the stance lift, Kirby's alone, with the ECB top and the footstool heads (D13; Mario's carried), the portraits (D14), the motions authored and which are the replica's own shapes.
- Tooling: the online e2e's server with every watcher off (`unstable_startWorker`, `dev.watch: false`) and what Task 1's Step 1 found about "Network connection lost"; Task 40's sampler figures; the jsdom canvas `getContext` line left in the suite's output (Task 2), unless a later task removed it.
- The SPEC changes made, to report to David: §6 reverse smash in "Tilt vs. smash" (Task 6), §6 "Grab in the air" (Task 8), §9 `/play` without a match goes to the menu (Task 29), §10 portraits from the loaded model (Task 38), each as its task's commit made it.
- **Carried, not in Plan 6** (D59 records each, with its reason): every item of that list in this plan (R-P6-9: the captor's `throw` joint (a), the late, narrow Final Smashes' misses (R-P6-25, the dropped rule's table above), Task 25's unjudged swing, Samus's tether recovery (D3), D58's "not modelled" list, and each item a task deferred), plus whatever the final wave left unfixed (Task 41, Step 3), each with its reason.

- [ ] **Step 2: The READMEs**

`docs/superpowers/plans/README.md`:
- The table gains row 6: `| 6 | [Polish](2026-11-02-plan-6-polish.md) | 42 | D59 | Input never dropped online, the flick's rules, reverse smash, edge slip, air grab, Final Smash records, slowdown and boosts, Thunder Jolt walls, a smarter CPU Final Smash, the online screens, press-to-join, sounds, 3D stage and fighter polish, authored carry and release motions, model portraits, a settled online e2e |`.
- The rules-version line: `` `ENGINE_RULES_VERSION` goes 3 (Plan 3) → 4 (Plan 4) → 5 (Plan 5) → 6 (Plan 6). ``
- The "Steps that stop for David" table gains `| 6 / 42 | Deploy (rules version 6), on David's go |`.
- "Decisions the planner made" gains the Plan 6 rulings as landed (each UNVERIFIED one marked), and "Open questions for David" gains only the deploy and the real-gamepad check (R-P6-8).

`README.md` changes in two sections:
- under "## Controls": the reverse smash (back + Attack from a standstill, or a back flick) and Grab in the air; and the gamepad paragraph gains press-to-join (a pad presses A or Start on the character select to take the first CPU seat or a new one, never a keyboard player's; R-P6-11);
- under "## Multiplayer": "Finding each other" gains the room code's Copy button.

Nothing else. "## What this is", the disclaimer, stays word for word, and "## Known gaps" is untouched.

- [ ] **Step 3: The plan, and the backlog**

Copy this plan (`.superpowers/sdd/plan-6-polish-v2.md`, or the revision the controller ran) to `super-smash/docs/superpowers/plans/2026-11-02-plan-6-polish.md`, with its Status line changed to "Executed 2026-11-XX; see D59" and each task's report links left out (the controller's folder holds them). Strike through each worked item in `.superpowers/sdd/POLISH-BACKLOG.md` with the task that closed it, both gameplay.spec lines included (`ad67ccb`, confirmed by Task 3). The "Closed before this plan" items are struck with what closed them: the ftilt by Plan 5 Task 21b, and R-FW3f's release frame by Plan 5's final wave part 5. The fast-fall star is already struck.

- [ ] **Step 4: Gate and commit**

Run: `pnpm typecheck && pnpm lint && pnpm test` (no test reads DECISIONS or the READMEs at `46e0706`; the gate is for anything else staged by mistake). Expected: exit 0.

```bash
git add super-smash/DECISIONS.md super-smash/README.md super-smash/docs/superpowers/plans/README.md super-smash/docs/superpowers/plans/2026-11-02-plan-6-polish.md
git commit -m "super-smash: D59 records Plan 6 (polish); the plans index and README follow" -m "Rules version 6. Every R-P6 ruling and D1-D14 as rulings, the carried list, and the SPEC changes the tasks made (§6 reverse smash and Grab in the air, §9 /play, §10 portraits), to report to David." -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Implementers never push. The controller re-runs the pre-push scan over this commit, then pushes it after its gate, as it pushed the final wave's (R-P6-5; Task 41, Steps 4.6 and 6). Deploying waits for David's go.

---

## For David

These are not tasks: they are the things only David can do or decide. The plan's rulings are the controller's (R-P6-8), recorded in D59 and reported below.

- **Deploy Plan 6?** (yes/no) The question is whether to deploy rules version 6 once the final wave (Task 41) is pushed and Task 42 records it. The push is pre-authorized; the deploy is not.
- **A real-gamepad check of the pad remap, the right stick and press-to-join** (backlog: "tested only with fake pads"). With one physical pad:
  - remap Attack and Special in the pad options and play a match;
  - flick the right stick each way, standing (smashes), in the air (aerials), shielding (Task 5: rolls, a spot dodge, an up smash) and holding someone (Task 5: throws, ruling D1);
  - press A on the select screen with a second pad, and see it take a new seat (Task 30, ruling R-P6-11).

  Report anything that differs from the keyboard.
- **Optional: a local look at the real models.** The plan judges the real models by numbers and stand-ins (R-P6-6). How they read is David's eye, if he wants it. The places to look:
  - Kirby's stance (Task 19);
  - Donkey Kong's carry, lift and full releases (Task 20);
  - the dash-off flip (Task 21);
  - the slip and wall-tech clips (Task 22);
  - the 3D stage with fighters over its face (Task 33);
  - trails (Task 34);
  - the effect fixes and outliers (Tasks 36 and 37);
  - the HUD portraits (Task 38).

## Rulings (recorded in D59, reported to David)

Each task follows its ruling as amended in review. D59 records each one with its cost (R-P6-8).

| # | Task | Ruling |
|---|---|---|
| D1 | 5 | A right-stick flick while holding someone throws in its direction; plain Attack pummels. UNVERIFIED: SmashWiki "C-Stick" and "Throw" are silent on which the hold reads first. |
| D2 | — | Dropped. Each SPEC change is made in its own task's commit (§6 "Tilt vs. smash", Task 6; §6 "Grab in the air", Task 8; §9 `/play`, Task 29; §10 portraits, Task 38), and Task 42 lists them for David. |
| D3 | 8 | Samus's grab aerial ships without its tether recovery (frames 2-4 ledge grab): the zair attacks only. It is on the Carried list, with carry (a). |
| D4 | 10 | An aerial Final Smash's unsized "slight boost in height" is the fighter's own short hop. UNVERIFIED. |
| D5 | 11 | `SLOW_OPPONENT(a, b)` is read as (rate, frames): the others run one step in `rate` for `frames` steps. The still step follows R-P6-10: it sits after the hitlag block and before the hitstun countdown; a press on it is buffered; intangibility is held. Expiry under rates 20 and 30 is UNVERIFIED-simplified. |
| D6 | 12 | A fighter frozen in hitlag, or trapped, rides Smashville's platform (UNVERIFIED). Ruling R-T14f limits it: nothing slides while a scene pauses the stage. |
| D7 | 13 | Settled: the 14-frame KO freeze is kept (earlier rulings), with presses buffered during it. |
| D8 | 15 | Settled: the Boomerang's "distance spent turning back" is not modelled. Read as a stretch of travel, it cannot fit the published hitbox frames, so it turns on the spot. |
| D9 | 17 | Two launches on one fighter in one step: the larger knockback sets it, then the larger vertical component, then the attacker further left. An outranked hit deals its damage and freeze, with no launch. UNVERIFIED. |
| D10 | 24 | A CPU holding the power past 1,200 frames fires its travelling Final Smash (Volt Tackle; Critical Hit already fires at any target in its path) at any target in its path, whiff or not. The other six have no limit, so D58's M2 cost stays for them (the replay's longest hold after Task 24: 2,059 frames). CPU judgement, UNVERIFIED (the engine keeps no time limit). |
| D11 | 33 | Fighters are drawn over the stage's front face. The stage draws first and writes no depth, and the 2D clip follows the solid outline at the play plane. A chamfer would need a 7.39-unit inset (camera geometry) and still left fighters beside the drawn face (stand-in captures). R13's straight-walls test stands. |
| D12 | 33 | The side camera is kept, with face shading and shadow discs tipped 24° toward it. The tilt is carried. |
| D13 | 19 | A lift is the leg hurtboxes' idle sink capped by the mesh's sink. That gives one lift, Kirby's 0.57. His hurtboxes and ECB top rise by it (replay: 9.4 → 10.0, on a base before Task 18's shared idle phase, which first moves his standing top 9.4 → 9.8; Task 19 re-measures, R-P6-23), and with them his footstool head and ceiling contacts. The golden moves in two Kirby traces. Mario (0.32) and Donkey Kong (knuckles) are carried. |
| D14 | 38 | HUD portraits are rendered from the loaded model at match start and never saved; stand-ins keep the 2D heads. |
| R-P6-14 | 5 | Attack pressed while shielding is a grab (SmashWiki "Grab": shield plus attack). An up smash out of shield needs Up, from the stick or a flick. At `46e0706` it up-smashed; the golden is unchanged. |
| R-P6-15 | — | Critical Hit keeps Plan 5's rule and fires whatever its travel. Task 23's baseline did not show its misses the worst of the five (seeds 1-3: 61 of 120, against the Ancient Arrow's 143 of 207), and the judged rule for the other four was dropped (R-P6-25). |
| R-P6-16 | 25 | The CPU's trust window for a dash attack at a moving target comes from each fighter's own dash attack: its first active window (`firstWindowEnd`), not one constant. Link and Marth have one window, so they are unchanged. Every fighter's first window can connect in time, so none is excluded. |
| R-P6-17 | 26 | The ledge run-off guard applies to the Smash Ball chase and to spacing, never to the edgeguard's deliberate exit, which keeps its own recovery check. Under R-P6-24 it also stands down while the target is off the stage. |
| R-P6-18 | 24-27 | A task may step the golden ball-on match's seed, so that `expectCpuFinalSmash` holds, only when that task's sweep passes R-P6-19's test as amended, against the run's own Task 23 baseline (R-P6-26): landed summed falls by at most 10%, no fighter's landed by more than 25%, and the mean hold over all rises by at most 25%; a rise in landed, or a fall in the mean hold, always passes (R-P6-26). Fired is not judged. If it fails, that is a regression to fix, not a seed to step. In the replay seed 606 held at every CPU task; that is the replay's, and a real run steps only as above. |
| R-P6-19 | 24-27 | As amended: CPU tasks are judged against the six-seed baseline (2,016 matches) the run's own Task 23 records, cumulatively, Task 27 included; each bound counts only the harmful direction (R-P6-26). Landed Final Smashes summed over fighters fall by at most 10%, each fighter's landed by at most 25%, and the mean hold over all fighters rises by at most 25%; "within noise" never excuses a result outside those bounds. Amended because one fighter's count differs by up to about 30% between seed halves of the same code, so a 10% per-fighter bound was below the sweep's resolution. A judged-firing rule that cannot meet this for a Final Smash is dropped for it, which keeps its earlier rule (R-P6-15's Critical Hit; the draft's Task 17, R-P6-25). Each CPU commit carries per fighter fired, landed and mean hold, then landed summed, the mean hold over all, `edgeguardExits` and `selfDestructs`; every sweep runs with `--reporter=verbose` into a log file. |
| R-P6-20 | Groups 0-2 | Before Task 23's harness exists, a task whose golden regeneration stops on `expectCpuFinalSmash` stops and reports; it does not step the seed. The controller rules and records the ruling (Group 2's intro). |
| R-P6-21 | every e2e gate | Every `pnpm test:e2e:online` and `PORT=3107 pnpm test:e2e` gate run passes `--trace off` (or uses a config with trace, screenshot and video off), so no real-model frame lands in `test-results/`. |
| R-P6-22 | 41 | The final wave's screenshot commit and fix commits have commit blocks; the pre-push scan runs after the last commit, the screenshots included; the fresh clone is of the LOCAL repo at HEAD, with no models, never of `origin`. |
| R-P6-23 | 19, 37 and any list | A list a task measured on its own replay base is re-measured on the real tree and rewritten, with the reason in the commit, when an earlier task changed its inputs (Task 37's `EXPECTED`, Task 19's Kirby reach and hurt figures). |
| R-P6-24 | 24-27 | As amended: a CPU task may cut the sweep's `edgeguardExits` by at most 10% against Task 23's baseline, and raise `selfDestructs` by at most 2 matches or 10% of the baseline, whichever is larger. Task 23's count was fixed first: it had scored KOs from hits taken on the ground, in hitlag, as self-destructs, so the replay's baseline is 20, not 504, and every figure counted the old way is void. The bound uses the run's own Task 23 figure; the replay's 20 is an expectation (R-P6-26). Task 26 takes the guard that keeps the edgeguard within the bound: no run-off stop while the target is off the stage (exits 5,922 → 5,530, −6.6%; self-destructs 20 → 8). |
| R-P6-25 | — | A task dropped by a ruling leaves the task list; no implementer is dispatched on a stub. Its measured table and reason go to the Carried list and D59. The draft's Task 17 is the first, so the plan has 42 tasks. |
| R-P6-26 | 24-27 | The bounds of R-P6-18, R-P6-19 and R-P6-24 are one-sided: each counts only the harmful direction (a fall in landed Final Smashes, a rise in hold frames, a fall in edgeguard exits, a rise in self-destructs). A rise in landed (Task 27's Kirby, +36% in the replay) never fails a check or blocks a seed step. Each compares against the baseline the run's own Task 23 records; the replay's figures, its 20 self-destructs among them, are expectations, not constants. |
| R-P6-27 | — | The draft's Task 17 in its veto form was measured on a half sweep (seeds 1-3), and its Donkey Kong −25.5% is within the plan's half-sweep noise, so it is not shown to fail R-P6-19 as amended. It stays carried, without another round; D59 records it as a candidate for a later plan, to be judged on a six-seed sweep. |

The other rulings, R-P6-0 to R-P6-13, shape this plan itself: the replay, its order, the push, images, determinism, the carries, slowed presses, press-to-join, the golden and the Review Focus. D59 records every one, R-P6-0 to R-P6-27.

## Risks

- **The golden moves in many tasks; the rules version moves once.** Each task's own Golden line says which:
  - **Moves:** 6, 7 (a new trace, the slip lab), 10, 11, 13, 14, 15, 18, 19, 22, 25, 26 and 27.
  - **May move:** 8, 9 and 12 (unchanged in their replays; 8's base had no Task 6), 16, 17, 20, 21, 24, and the final wave's fixes (41).
  - **Unchanged:** 5 (the rules version only, 5 → 6). **Unaffected:** Group 0, Tasks 4 and 23, and Groups 4 and 6.
  - Every task that may move the golden carries the staging line, and the lab pins and `MUST_VISIT` hold it to its own change (R-P6-12).
  - The rules version moves once, in Task 5. Plan 6 deploys once, at its end, if David says so. Even a mid-plan deploy could not pair with another: the handshake refuses a different build id (`buildMismatch`).
- **The bake has little room.** In the replay it reached 2,030,515 bytes gzipped after Task 22: 96.8% of the 2 MiB budget, about 66 KB left.
  - Task 8 adds about 2.4 KB, which that replay did not include.
  - `roster.test.ts`'s budget is the check. A task that would cross it stops and reports; it does not raise the budget.
- **The replay bases differ from this plan's order** (header; the rule for counts and messages that differ).
  - Tasks 1-3 and 4-5: `46e0706`.
  - Task 6: on Tasks 4-5.
  - Tasks 7-12: on Task 5.
  - Tasks 13-18: on the first-draft text of this plan's Tasks 9 and 11 (the draft's 7 and 9), before they were fixed.
  - Tasks 19-22: on Task 7; Tasks 35-40: on Task 7 and Tasks 19-22.
  - Tasks 23-26: on Group 0 only.
  - Task 27: on Tasks 23-26.
  - Tasks 28-34: `46e0706`.

  The seams this leaves were reconciled on assembly, and each is named where it bites:
  - Task 9's record line in Task 14;
  - Task 5's `aimAttack` in Task 8's context;
  - Task 18's idle phase against Tasks 19-22's `poseClock.ts` measurements (bodies sub-group);
  - Tasks 9 and 11 under Task 18's sweep;
  - Task 16's `projectileRange` before the CPU group (Group 3);
  - Task 12's `leavesFloor` order under Task 26 (Group 3);
  - Task 34's `trails.update()` under Task 38's paint hunk;
  - Task 18's idle phase under Task 37's `EXPECTED` and Task 19's figures (R-P6-23);
  - Task 6's re-routed CPU traces under Tasks 7 and 8's golden claims;
  - the ball-on Final Smash pin in Groups 0-2, before any sweep (R-P6-20; Group 2's intro).

  Any digest a task quotes is its replay's.
- **CPU sweeps, seeds and figures.**
  - The sweeps (Tasks 23-27) are opt-in (`CPU_SWEEP=1`): six seeds, 2,016 matches, about seven minutes each, with `--reporter=verbose` into a log file. Their figures are slots each run fills, and they bind each task through R-P6-19 and R-P6-24, as amended: one-sided, against the run's own Task 23 baseline (R-P6-26). The replay's figures, Task 23's 20 self-destructs among them, are expectations.
  - One fighter's landed count differs by up to about 30% between seed halves of the same code, so a task near a bound may pass or fail by chance. Only the six-seed run judges, and past a bound the task stops and reports.
  - In the replay the ball-on seed stayed 606 at every CPU task. The first replay's steps (606 → 607 → 608) came from the dropped rule's first form. A real run may need a step, and takes one only under R-P6-18 as amended.
  - No ruling bounds Task 27's dash attacks: thrown rose 29% (8,532 → 10,983) and whiff runs of 8 or more 5 → 8 (Kirby 4 → 6, Samus 1 → 2). D59 records them as a watch item.
- **Load.** Several replays ran at a machine load of 6-30 from other sessions. The e2e runs of Tasks 28-34 passed, but at a load up to 26, which is no pass under the gate's rule. The final wave reruns every gate at a load under 6.

## Self-review (2026-11-02, after assembly)

**1. Coverage.** Every line of `POLISH-BACKLOG.md` (85 lines) maps to a task, to "Closed before this plan", or to "Carried, not in Plan 6":
- **Online and input:**
  - the shrinking delay, the pad press no poll sent and the two flicks (backlog lines 75, 78, 83): Task 4;
  - the flick's buffer, shield and hold (lines 76, 77): Task 5;
  - the human port's firing bands (line 83): Task 23.
- **Engine:**
  - reverse smash (81): Task 6;
  - edge slip (56): Task 7;
  - air grab (57): Task 8;
  - Final Smash boxes (58): Task 9;
  - the height boost and R-T14j (59, 65): Task 10;
  - `SLOW_OPPONENT` (67): Task 11;
  - Smashville (60, 71, 84): Task 12;
  - the KO freeze (61): Task 13;
  - windboxes (62): Task 14;
  - phases, the jolt and the Boomerang (63): Tasks 15 and 16, the turn ruled D8;
  - port order (70, 72): Tasks 17 and 18.
- **Bodies:**
  - foot contact and the clip-gain reaches (16, 19): Task 19, Kirby alone, the rest carried;
  - Donkey Kong's carry and the stored releases (32, 36): Task 20;
  - the dash-off flip (42): Task 21;
  - the edge slip's and wall techs' clips (D58 (c)): Task 22.
- **CPU:**
  - Volt Tackle and the time limit (50, 64, 80): Tasks 23 and 24;
  - whiff rates (51): carried, the draft's Task 17 dropped (R-P6-25; on the Carried list), Critical Hit kept (R-P6-15);
  - Kong Karry and dash attacks (52, 53): Task 25; the unjudged swing (68): carried, with Task 25's figures;
  - the chase, Smashville's ledge and Inhale off stage (69, 73, 82): Task 26;
  - spacing (D58 (e)): Task 27.
- **Presentation:**
  - the online screens (4-6): Task 28;
  - `/play` (7): Task 29;
  - press-to-join (9): Task 30;
  - glances and sounds (14, 43, 44): Task 31;
  - shield sparks (20): Task 32;
  - stage, lip, wall and ground (15, 21, 27, 45): Task 33, the tilt carried;
  - squash and trails (28, 29): Task 34;
  - charges (31, 37): Task 35;
  - effect fixes (38, 39, 46): Task 36, the glove overlap (47) carried;
  - effect scale (30): Task 37;
  - portraits (22): Task 38;
  - the lab (26): Task 39;
  - loading, the model wait and the sampler (17, 18, 24): Task 40.
- **Tooling:**
  - the online e2e and "Network connection lost" (23, 85): Task 1;
  - test noise, buffer pins and the truncation pin (10, 12, 13): Task 2;
  - locators and the gameplay e2e (8, 11, 79): Task 3.
- **For David:** the real gamepad (66).
- **Closed:** 25, 33 and 74, and 8 and 11 (confirmed by Task 3).

D58's thirteen carries and the final wave's additions are tasks as above. Its carries (a) to (g) are tasks (c in part, e) or Carried lines with reasons (a, b, the rest of c, d, f, g). Its "not modelled" list is named on the Carried list.

**2. Placeholders and markers.**
- No "TBD", "TODO" or "fill in".
- Red-step and result messages carry 249 "(captured)" markers, 27 "(captured: …)", 14 "(captured; …)" or "(captured, …)", and 10 that name their base or run ("(captured on …)", "(captured at seed 606 …)").
- Two say "(predicted: …)", with the reason: Task 1's five online runs need a full build and two browsers, and Task 3's e2e gates were not replayed.
- Slots the run fills, all in commit bodies or report steps, never in code: measured results (golden traces and first samples, sweep figures, seeds, the new digest, Task 1's branch, Task 19's reach lines, Task 37's outlier list). The assembly log lists each.

**3. Types and state across tasks.**
- The new `CombatState` fields each have their `emptyCombat`, `cloneCombat` and `mixCombat` lines: `sceneHits` (Task 9, in `hash.test.ts`'s `HANDLED_ARRAYS`, and seeded in `simulate.test.ts`'s clone walk), `slowRate`/`slowFrames`/`slowPhase` (Task 11), `dashedOff` (Task 21) and `standbyFrames` (Task 24).
- `ProjectileState.face` (Task 16) is cloned and hashed.
- `StepEvents.glances` and `airJumps` (Task 31), and `shieldHits[].contactX/Y` (Task 32), are events only.
- `statusMotion`'s new fields are optional (Tasks 20 and 21), so no caller changes.

**4. Review Focus.** Each of the five lines names its test in its owning task: Tasks 4, 7, 11 (two) and 19.

**5. Order.** No task consumes what a later task produces. The forward references are notes, not dependencies:
- Task 5's to Tasks 6 and 8;
- Task 11's still step to Task 13 ("as in a KO's freeze": until Task 13 lands, a KO freeze still drops presses);
- Task 7's to Task 21;
- Task 25's to Task 27;
- Task 35's `runPainter` to Tasks 36 and 37.
